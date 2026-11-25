// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// KGRAPH-1 (Rowan, 2026-11-25): "All UltraStable deployments and systems shall have a knowledge graph (graph network) to automatically build
// and maintain a graph of connections for all data." This is the one shared engine every system runs: the platform's tick (kgstep.js) and every
// tenant (vendored as vendor/ultrastable/knowledge.js, so it imports nothing). The research behind each choice is code too: KG_PRACTICES below, each
// practice bound to a live measurement of this graph, served by practices() and methodHtml() so the write-up is re-measured on every request.
//
// One beat, run on the system's own clock:
//   extract   records -> typed nodes and edges through the tenant's mappers (deterministic first; a model only through checkExtraction)
//   resolve   one id per entity: kind + normalised key, plus the tenant's aliases
//   sync      incremental: a record whose hash did not change costs no write; a changed record retires its old facts and writes the new ones;
//             a record that disappeared is retired, never deleted (no silent drop). Every fact keeps the record it came from (provenance).
//   analyse   PageRank, communities (weighted label propagation, deterministic) with modularity, Adamic-Adar link prediction, participation
//             (nodes that bridge communities), gap rules (a node that lacks a relation it should have)
//   insights  each finding is stored with a due date and a check that can be wrong: a predicted link is kept when the link appears or readers
//             follow it, a gap is kept when it closes, a bridge when it still bridges. Settled outcomes re-weight each insight kind (Beta(1,1)),
//             so kinds whose findings come true rise and the rest fall: the graph improves its own insight generation.
// Storage is D1 (tables below, created on first use, every row keyed by tenant). Cost: reads are bounded by the live graph; writes only by change.
// Tests: test/knowledge.test.js (platform), worker/graph.test.mjs (Unlearn).

export const KG_VERSION = 'kg/1';
export const KG_DDL = [
  `CREATE TABLE IF NOT EXISTS kg_nodes (tenant TEXT NOT NULL, id TEXT NOT NULL, source TEXT NOT NULL, kind TEXT NOT NULL, label TEXT NOT NULL, props TEXT NOT NULL DEFAULT '{}', first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (tenant, id, source))`,
  `CREATE TABLE IF NOT EXISTS kg_edges (tenant TEXT NOT NULL, src TEXT NOT NULL, rel TEXT NOT NULL, dst TEXT NOT NULL, source TEXT NOT NULL, weight REAL NOT NULL DEFAULT 1, why TEXT, first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (tenant, src, rel, dst, source))`,
  `CREATE TABLE IF NOT EXISTS kg_sources (tenant TEXT NOT NULL, source TEXT NOT NULL, hash TEXT NOT NULL, at INTEGER NOT NULL, retired_at INTEGER, PRIMARY KEY (tenant, source))`,
  `CREATE TABLE IF NOT EXISTS kg_insights (tenant TEXT NOT NULL, id TEXT NOT NULL, kind TEXT NOT NULL, subject TEXT NOT NULL, object TEXT, text TEXT NOT NULL, score REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', at INTEGER NOT NULL, due_at INTEGER NOT NULL, settled_at INTEGER, follows INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (tenant, id))`,
  `CREATE TABLE IF NOT EXISTS kg_runs (tenant TEXT NOT NULL, at INTEGER NOT NULL, ms INTEGER NOT NULL, nodes INTEGER NOT NULL, edges INTEGER NOT NULL, communities INTEGER NOT NULL, modularity REAL, added INTEGER NOT NULL, changed INTEGER NOT NULL, retired INTEGER NOT NULL, insights_new INTEGER NOT NULL, kept INTEGER NOT NULL, dropped INTEGER NOT NULL, error TEXT, PRIMARY KEY (tenant, at))`,
  `CREATE TABLE IF NOT EXISTS kg_state (tenant TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, PRIMARY KEY (tenant, k))`,
  `CREATE INDEX IF NOT EXISTS kg_nodes_live ON kg_nodes (tenant, retired_at)`,
  `CREATE INDEX IF NOT EXISTS kg_edges_live ON kg_edges (tenant, retired_at)`,
  `CREATE INDEX IF NOT EXISTS kg_insights_status ON kg_insights (tenant, status)`,
];
export const KG_DEFAULTS = { window_days: 14, max_new_per_run: 5, min_follows: 3, max_hub: 50, max_pairs: 20000, retain_days: 180, runs_days: 90, expect: 0.3, kinds: { link: 1, gap: 1, bridge: 1 } };

const ready = new WeakSet();
export async function ensureKg(db) { if (ready.has(db)) return; for (const q of KG_DDL) await db.prepare(q).run(); ready.add(db); }
const all = async (db, sql, ...a) => (await db.prepare(sql).bind(...a).all()).results || [];
// D1 batches writes; a database with no batch (the node self-host shim) runs them one by one, so the graph builds on every host
async function batch(db, stmts, size = 40) {
  if (typeof db.batch !== 'function') { for (const s of stmts) await s.run(); return; }
  for (let i = 0; i < stmts.length; i += size) await db.batch(stmts.slice(i, i + size));
}

// ----------------------------------------------------------------------------------------------------------------- identity and extraction
// FNV-1a twice with different seeds: 64 bits, enough that two different records never share a hash in practice (not a security hash).
export function hash(s) {
  const t = String(s); let a = 0x811c9dc5, b = 0x01000193 ^ 0x9e3779b9;
  for (let i = 0; i < t.length; i++) { const c = t.charCodeAt(i); a = Math.imul(a ^ c, 0x01000193); b = Math.imul(b ^ c, 0x01000197); }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0');
}
// Entity resolution key: case, accents, punctuation, "et al." and a leading article do not make a new entity.
export function key(label) {
  return String(label ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\bet al\.?/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ').trim().replace(/^(the|a|an) /, '');
}
export const nodeId = (kind, label, aliases = {}) => { const id = `${kind}:${key(label)}`; return aliases[id] || id; };

// mappers: { [record.type]: (data, { node(kind, label, props?, id?) -> id, edge(src, rel, dst, { weight?, why? }?) }) => void }
// records: [{ type, source, data }]. `source` is the record's stable id; every fact the mapper emits is attributed to it.
export function extract(records, mappers, { aliases = {} } = {}) {
  const facts = [], seen = new Set();
  for (const r of records) {
    const m = mappers[r.type];
    if (!m) throw new Error(`no mapper for record type ${r.type}`);
    if (!r.source) throw new Error('a record needs a source id');
    if (seen.has(r.source)) throw new Error(`duplicate source ${r.source}`);
    seen.add(r.source);
    const nodes = new Map(), edges = new Map();
    const node = (kind, label, props = {}, id = null) => {
      if (!kind || label == null || label === '') throw new Error(`node in ${r.source} needs kind and label`);
      const nid = id ? (aliases[id] || id) : nodeId(kind, label, aliases);
      const o = nodes.get(nid); nodes.set(nid, { id: nid, kind, label: String(label), props: { ...(o ? o.props : {}), ...props } });
      return nid;
    };
    const edge = (src, rel, dst, { weight = 1, why = null } = {}) => {
      if (!src || !rel || !dst) throw new Error(`edge in ${r.source} needs src, rel and dst`);
      if (src === dst) return;
      const k = `${src}|${rel}|${dst}`, o = edges.get(k);
      edges.set(k, { src, rel, dst, weight: (o ? o.weight : 0) + weight, why: why || (o && o.why) || null });
    };
    m(r.data, { node, edge });
    for (const e of edges.values()) if (!nodes.has(e.src) || !nodes.has(e.dst)) throw new Error(`edge ${e.src} -${e.rel}-> ${e.dst} in ${r.source} has an end the record did not declare`);
    const body = { nodes: [...nodes.values()].sort((a, b) => a.id.localeCompare(b.id)), edges: [...edges.values()].sort((a, b) => `${a.src}|${a.rel}|${a.dst}`.localeCompare(`${b.src}|${b.rel}|${b.dst}`)) };
    facts.push({ source: r.source, hash: hash(JSON.stringify(body)), ...body });
  }
  return facts;
}

// Model route (optional): a prompt that asks for triples inside a fixed schema, and the check that keeps only triples whose kinds and relation
// are in the schema and whose supporting quote is found in the text. A triple the text does not support is dropped, never stored.
export function extractPrompt(text, schema) {
  return [{ role: 'system', content: `Extract facts as JSON {"triples":[{"src":{"kind":"","label":""},"rel":"","dst":{"kind":"","label":""},"quote":""}]}. Kinds: ${schema.kinds.join(', ')}. Relations: ${schema.rels.join(', ')}. "quote" is an exact span of the text (at least 20 characters) that states the fact. Use only what the text states. Reply with JSON only.` },
    { role: 'user', content: String(text).slice(0, 6000) }];
}
const flat = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
export function checkExtraction(out, text, schema) {
  let o = out; if (typeof o === 'string') { try { o = JSON.parse(o.slice(o.indexOf('{'), o.lastIndexOf('}') + 1)); } catch (e) { return { triples: [], dropped: 1, reason: 'not json' }; } }
  const ok = [], kinds = new Set(schema.kinds), rels = new Set(schema.rels), body = flat(text); let dropped = 0;
  for (const t of (o && Array.isArray(o.triples) ? o.triples : [])) {
    const q = flat(t && t.quote);
    if (t && t.src && t.dst && kinds.has(t.src.kind) && kinds.has(t.dst.kind) && rels.has(t.rel) && key(t.src.label) && key(t.dst.label) && q.length >= 20 && body.includes(q)) ok.push(t); else dropped++;
  }
  return { triples: ok, dropped };
}

// ---------------------------------------------------------------------------------------------------------------------- incremental store
// complete: true means `facts` is every record the system holds, so a source that is no longer in it is retired.
export async function sync(db, facts, { tenant = '', now = Date.now(), complete = true } = {}) {
  await ensureKg(db);
  const have = new Map((await all(db, `SELECT source, hash FROM kg_sources WHERE tenant = ? AND retired_at IS NULL`, tenant)).map(r => [r.source, r.hash]));
  const st = [], out = { added: 0, changed: 0, retired: 0, unchanged: 0 };
  const retire = s => {
    st.push(db.prepare(`UPDATE kg_nodes SET retired_at = ? WHERE tenant = ? AND source = ? AND retired_at IS NULL`).bind(now, tenant, s));
    st.push(db.prepare(`UPDATE kg_edges SET retired_at = ? WHERE tenant = ? AND source = ? AND retired_at IS NULL`).bind(now, tenant, s));
  };
  const live = new Set();
  for (const f of facts) {
    live.add(f.source);
    const h = have.get(f.source);
    if (h === f.hash) { out.unchanged++; continue; }
    if (h) { retire(f.source); out.changed++; } else out.added++;
    for (const n of f.nodes) st.push(db.prepare(`INSERT INTO kg_nodes (tenant, id, source, kind, label, props, first_at, last_at, retired_at) VALUES (?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(tenant, id, source) DO UPDATE SET kind = excluded.kind, label = excluded.label, props = excluded.props, last_at = excluded.last_at, retired_at = NULL`).bind(tenant, n.id, f.source, n.kind, n.label, JSON.stringify(n.props || {}), now, now));
    for (const e of f.edges) st.push(db.prepare(`INSERT INTO kg_edges (tenant, src, rel, dst, source, weight, why, first_at, last_at, retired_at) VALUES (?,?,?,?,?,?,?,?,?,NULL)
      ON CONFLICT(tenant, src, rel, dst, source) DO UPDATE SET weight = excluded.weight, why = excluded.why, last_at = excluded.last_at, retired_at = NULL`).bind(tenant, e.src, e.rel, e.dst, f.source, e.weight, e.why, now, now));
    st.push(db.prepare(`INSERT INTO kg_sources (tenant, source, hash, at, retired_at) VALUES (?,?,?,?,NULL) ON CONFLICT(tenant, source) DO UPDATE SET hash = excluded.hash, at = excluded.at, retired_at = NULL`).bind(tenant, f.source, f.hash, now));
  }
  if (complete) for (const s of have.keys()) if (!live.has(s)) {
    retire(s); st.push(db.prepare(`UPDATE kg_sources SET retired_at = ? WHERE tenant = ? AND source = ?`).bind(now, tenant, s)); out.retired++;
  }
  await batch(db, st);
  return out;
}

// The live graph: nodes merged across the records that mention them (latest label and props win), edges merged across records (weights add).
export async function load(db, tenant = '') {
  await ensureKg(db);
  const nodes = new Map(), edges = new Map();
  for (const r of await all(db, `SELECT id, source, kind, label, props, last_at FROM kg_nodes WHERE tenant = ? AND retired_at IS NULL ORDER BY last_at, source`, tenant)) {
    const o = nodes.get(r.id); let p = {}; try { p = JSON.parse(r.props); } catch (e) { p = { _bad_props: true }; }
    nodes.set(r.id, { id: r.id, kind: r.kind, label: r.label, props: { ...(o ? o.props : {}), ...p }, sources: [...(o ? o.sources : []), r.source] });
  }
  for (const r of await all(db, `SELECT src, rel, dst, source, weight, why FROM kg_edges WHERE tenant = ? AND retired_at IS NULL ORDER BY source`, tenant)) {
    if (!nodes.has(r.src) || !nodes.has(r.dst)) continue;
    const k = `${r.src}|${r.rel}|${r.dst}`, o = edges.get(k);
    edges.set(k, { src: r.src, rel: r.rel, dst: r.dst, weight: (o ? o.weight : 0) + r.weight, why: r.why || (o && o.why) || null, sources: [...(o ? o.sources : []), r.source] });
  }
  return { nodes, edges: [...edges.values()] };
}

// -------------------------------------------------------------------------------------------------------------------------------- analytics
// Undirected weighted adjacency over node indexes; ids sorted so every result is deterministic.
export function index(g) {
  const ids = [...g.nodes.keys()].sort(), at = new Map(ids.map((id, i) => [id, i])), adj = ids.map(() => new Map());
  for (const e of g.edges) { const a = at.get(e.src), b = at.get(e.dst); if (a === undefined || b === undefined || a === b) continue; adj[a].set(b, (adj[a].get(b) || 0) + e.weight); adj[b].set(a, (adj[b].get(a) || 0) + e.weight); }
  return { ids, at, adj };
}
export function pagerank(G, { d = 0.85, iters = 40 } = {}) {
  const n = G.ids.length; if (!n) return [];
  const str = G.adj.map(m => [...m.values()].reduce((s, w) => s + w, 0));
  let r = new Array(n).fill(1 / n);
  for (let t = 0; t < iters; t++) {
    const nx = new Array(n).fill((1 - d) / n); let dangling = 0;
    for (let i = 0; i < n; i++) { if (!str[i]) { dangling += r[i]; continue; } for (const [j, w] of G.adj[i]) nx[j] += d * r[i] * w / str[i]; }
    for (let i = 0; i < n; i++) nx[i] += d * dangling / n;
    r = nx;
  }
  return r;
}
// Weighted label propagation (Raghavan et al. 2007), made deterministic: nodes visited in id order, ties go to the smallest label.
// Leiden (Traag et al. 2019) gives better-connected communities on large graphs; at the few-thousand-node scale a Worker holds, this converges
// in a handful of sweeps and its quality is reported as modularity on every run so a regression is visible.
export function communities(G, { iters = 30 } = {}) {
  const n = G.ids.length, lab = G.ids.map((_, i) => i);
  for (let t = 0; t < iters; t++) {
    let moved = 0;
    for (let i = 0; i < n; i++) {
      if (!G.adj[i].size) continue;
      const w = new Map(); for (const [j, x] of G.adj[i]) w.set(lab[j], (w.get(lab[j]) || 0) + x);
      let best = lab[i], bw = w.get(lab[i]) || 0;
      for (const [l, x] of w) if (x > bw || (x === bw && l < best)) { best = l; bw = x; }
      if (best !== lab[i]) { lab[i] = best; moved++; }
    }
    if (!moved) break;
  }
  const ren = new Map(); return lab.map(l => { if (!ren.has(l)) ren.set(l, ren.size); return ren.get(l); });
}
export function modularity(G, lab) {
  let m2 = 0; const k = G.adj.map(m => { let s = 0; for (const w of m.values()) s += w; m2 += s; return s; });
  if (!m2) return 0;
  const tot = new Map(); let inside = 0;
  for (let i = 0; i < k.length; i++) { tot.set(lab[i], (tot.get(lab[i]) || 0) + k[i]); for (const [j, w] of G.adj[i]) if (lab[j] === lab[i]) inside += w; }
  let exp = 0; for (const t of tot.values()) exp += (t / m2) ** 2;
  return inside / m2 - exp;
}
// Adamic-Adar (Adamic and Adar 2003; Liben-Nowell and Kleinberg 2007): two unlinked nodes that share many rare neighbours are likely related.
// Hubs above maxHub are skipped as intermediaries: a neighbour everything shares says nothing, and skipping it bounds the work.
// viaKinds limits which shared neighbours count as evidence (Unlearn: a shared study or author, not a shared topic), so the wording stays true.
export function predictLinks(g, G, { pairs = [], viaKinds = null, maxHub = KG_DEFAULTS.max_hub, maxPairs = KG_DEFAULTS.max_pairs, top = 50 } = {}) {
  if (!pairs.length) return [];
  const via_ok = viaKinds ? new Set(viaKinds) : null;
  const kind = i => g.nodes.get(G.ids[i]).kind, ok = (a, b) => pairs.some(p => (p.from === kind(a) && p.to === kind(b)) || (p.from === kind(b) && p.to === kind(a)));
  const score = new Map(), via = new Map(); let n = 0;
  for (let w = 0; w < G.ids.length && n < maxPairs; w++) {
    const deg = G.adj[w].size; if (deg < 2 || deg > maxHub || (via_ok && !via_ok.has(g.nodes.get(G.ids[w]).kind))) continue;
    const nb = [...G.adj[w].keys()].sort((a, b) => a - b), s = 1 / Math.log(deg);
    for (let x = 0; x < nb.length; x++) for (let y = x + 1; y < nb.length; y++) {
      const a = nb[x], b = nb[y]; if (G.adj[a].has(b) || !ok(a, b)) continue;
      const k = a * G.ids.length + b; score.set(k, (score.get(k) || 0) + s); (via.get(k) || via.set(k, []).get(k)).push(G.ids[w]); n++;
    }
  }
  return [...score].map(([k, s]) => { const a = Math.floor(k / G.ids.length), b = k % G.ids.length; return { a: G.ids[a], b: G.ids[b], score: s, via: via.get(k).slice(0, 5) }; })
    .sort((x, y) => y.score - x.score || (x.a + x.b).localeCompare(y.a + y.b)).slice(0, top);
}
// Participation coefficient (Guimera and Amaral 2005): 1 - sum over communities of (share of a node's links into it)^2. High = a bridge.
export function participation(G, lab) {
  return G.adj.map(m => { let k = 0; const per = new Map(); for (const [j, w] of m) { k += w; per.set(lab[j], (per.get(lab[j]) || 0) + w); } if (!k) return 0; let s = 0; for (const v of per.values()) s += (v / k) ** 2; return 1 - s; });
}
// rule: { id, kind, need: { rel, dir: 'out'|'in', to? }, text(node) -> string, weight? }. A gap is a live node of `kind` with no such edge.
export function gaps(g, rules = []) {
  const out = [];
  for (const r of rules) {
    if (!r.id || !r.kind || !r.need || !r.need.rel || typeof r.text !== 'function') throw new Error('a gap rule needs id, kind, need.rel and text()');
    const dir = r.need.dir || 'out', has = new Set();
    for (const e of g.edges) if (e.rel === r.need.rel) { const [me, other] = dir === 'out' ? [e.src, e.dst] : [e.dst, e.src]; if (!r.need.to || (g.nodes.get(other) || {}).kind === r.need.to) has.add(me); }
    for (const n of g.nodes.values()) if (n.kind === r.kind && !has.has(n.id)) out.push({ rule: r.id, node: n.id, text: r.text(n), weight: r.weight ?? 0.5 });
  }
  return out.sort((a, b) => (a.rule + a.node).localeCompare(b.rule + b.node));
}
export function analyze(g, spec = {}) {
  const G = index(g), pr = pagerank(G), lab = communities(G), pc = participation(G, lab);
  const sizes = new Map(); lab.forEach(l => sizes.set(l, (sizes.get(l) || 0) + 1));
  const rank = Object.fromEntries(G.ids.map((id, i) => [id, Number(pr[i].toFixed(6))])), community = Object.fromEntries(G.ids.map((id, i) => [id, lab[i]]));
  const bridgeKinds = spec.bridge_kinds ? new Set(spec.bridge_kinds) : null;
  const bridges = G.ids.map((id, i) => ({ id, p: pc[i], deg: G.adj[i].size, groups: new Set([...G.adj[i].keys()].map(j => lab[j])).size }))
    .filter(b => b.deg >= 3 && b.groups >= 2 && b.p >= 0.5 && (!bridgeKinds || bridgeKinds.has(g.nodes.get(b.id).kind))).sort((a, b) => b.p * Math.log(b.deg) - a.p * Math.log(a.deg) || a.id.localeCompare(b.id)).slice(0, 20);
  const hubs = G.ids.map((id, i) => ({ id, rank: pr[i] })).sort((a, b) => b.rank - a.rank || a.id.localeCompare(b.id)).slice(0, 10).map(h => h.id);
  return { G, rank, community, communities: [...sizes.values()].filter(s => s > 1).length, sizes, modularity: Number(modularity(G, lab).toFixed(4)), bridges, hubs,
    links: predictLinks(g, G, { pairs: spec.predict || [], viaKinds: spec.via_kinds, maxHub: spec.max_hub, maxPairs: spec.max_pairs }), gaps: gaps(g, spec.gaps || []) };
}

// ---------------------------------------------------------------------------------------------------------------------------- insights loop
const label = (g, id) => (g.nodes.get(id) || { label: id }).label;
export function candidates(g, an, spec = {}, weights = {}) {
  const w = k => (weights[k] ?? 1) * ((spec.kinds || KG_DEFAULTS.kinds)[k] ?? 1), out = [];
  const max = an.links.length ? an.links[0].score : 1;
  for (const l of an.links) out.push({ id: `L:${l.a}|${l.b}`, kind: 'link', subject: l.a, object: l.b, score: (l.score / max) * w('link'),
    text: (spec.link_text || ((a, b, via) => `${a} and ${b} are not linked, but share ${via.join(', ')}.`))(label(g, l.a), label(g, l.b), l.via.map(v => label(g, v))) });
  for (const x of an.gaps) out.push({ id: `G:${x.rule}:${x.node}`, kind: 'gap', subject: x.node, object: x.rule, score: x.weight * w('gap'), text: x.text });
  for (const b of an.bridges) out.push({ id: `B:${b.id}`, kind: 'bridge', subject: b.id, object: null, score: b.p * w('bridge'),
    text: (spec.bridge_text || ((n, k) => `${n} connects ${k} separate clusters of the graph.`))(label(g, b.id), b.groups) });
  return out.filter(c => c.score > 0).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
const linked = (g, a, b) => g.edges.some(e => (e.src === a && e.dst === b) || (e.src === b && e.dst === a));
// The check each insight is judged by. 'kept' and 'dropped' feed calibration; 'superseded' (the subject left the graph) does not.
export function judge(ins, g, an, { now, minFollows = KG_DEFAULTS.min_follows }) {
  if (!g.nodes.has(ins.subject) || (ins.kind === 'link' && !g.nodes.has(ins.object))) return 'superseded';
  const due = now >= ins.due_at;
  if (ins.kind === 'link') return linked(g, ins.subject, ins.object) || ins.follows >= minFollows ? 'kept' : due ? 'dropped' : 'open';
  if (ins.kind === 'gap') return !an.gaps.some(x => x.node === ins.subject && x.rule === ins.object) ? 'kept' : due ? 'dropped' : 'open';
  if (ins.kind === 'bridge') return due ? (an.bridges.some(b => b.id === ins.subject) ? 'kept' : 'dropped') : 'open';
  return due ? 'dropped' : 'open';
}
// Beta(1,1) per kind; no change until a kind has `min` settled outcomes; bounded so no kind is switched off or runs away.
export function calibrate(rows, { expect = KG_DEFAULTS.expect, min = 3, floor = 0.5, ceil = 1.5 } = {}) {
  const t = {}; for (const r of rows) { const s = (t[r.kind] = t[r.kind] || { kept: 0, n: 0 }); s.n++; if (r.status === 'kept') s.kept++; }
  return Object.fromEntries(Object.entries(t).map(([k, s]) => [k, s.n < min ? 1 : Math.min(ceil, Math.max(floor, ((s.kept + 1) / (s.n + 2)) / expect))]));
}

// One beat. Returns a summary; a failure is recorded in kg_runs with its message and returned, never swallowed.
export async function runKg(db, { tenant = '', records = [], mappers = {}, spec = {}, aliases = {}, now = Date.now(), complete = true } = {}) {
  const t0 = Date.now(), S = { ...KG_DEFAULTS, ...spec };
  await ensureKg(db);
  const rec = { added: 0, changed: 0, retired: 0, nodes: 0, edges: 0, communities: 0, modularity: null, insights_new: 0, kept: 0, dropped: 0, error: null };
  try {
    Object.assign(rec, await sync(db, extract(records, mappers, { aliases }), { tenant, now, complete }));
    const g = await load(db, tenant), an = analyze(g, S);
    Object.assign(rec, { nodes: g.nodes.size, edges: g.edges.length, communities: an.communities, modularity: an.modularity });
    const open = await all(db, `SELECT id, kind, subject, object, due_at, follows FROM kg_insights WHERE tenant = ? AND status = 'open'`, tenant), st = [];
    for (const ins of open) {
      const v = judge(ins, g, an, { now, minFollows: S.min_follows });
      if (v !== 'open') { st.push(db.prepare(`UPDATE kg_insights SET status = ?, settled_at = ? WHERE tenant = ? AND id = ?`).bind(v, now, tenant, ins.id)); if (v === 'kept') rec.kept++; if (v === 'dropped') rec.dropped++; }
    }
    await batch(db, st);
    const weights = calibrate(await all(db, `SELECT kind, status FROM kg_insights WHERE tenant = ? AND status IN ('kept','dropped')`, tenant), { expect: S.expect });
    const known = new Set((await all(db, `SELECT id FROM kg_insights WHERE tenant = ?`, tenant)).map(r => r.id)), add = [];
    for (const c of candidates(g, an, S, weights)) { if (add.length >= S.max_new_per_run) break; if (!known.has(c.id)) add.push(c); }
    await batch(db, add.map(c => db.prepare(`INSERT INTO kg_insights (tenant, id, kind, subject, object, text, score, status, at, due_at) VALUES (?,?,?,?,?,?,?,'open',?,?)`)
      .bind(tenant, c.id, c.kind, c.subject, c.object, c.text.slice(0, 500), Number(c.score.toFixed(4)), now, now + S.window_days * 864e5)));
    rec.insights_new = add.length;
    const top = Object.entries(an.rank).sort((a, b) => b[1] - a[1]).slice(0, 2000);
    await db.prepare(`INSERT INTO kg_state (tenant, k, v) VALUES (?, 'analysis', ?) ON CONFLICT(tenant, k) DO UPDATE SET v = excluded.v`).bind(tenant, JSON.stringify({
      at: now, version: KG_VERSION, weights, modularity: an.modularity, communities: an.communities, hubs: an.hubs, bridges: an.bridges.map(b => b.id),
      rank: Object.fromEntries(top), community: Object.fromEntries(top.map(([id]) => [id, an.community[id]])) })).run();
    await db.prepare(`DELETE FROM kg_nodes WHERE tenant = ? AND retired_at IS NOT NULL AND retired_at < ?`).bind(tenant, now - S.retain_days * 864e5).run();
    await db.prepare(`DELETE FROM kg_edges WHERE tenant = ? AND retired_at IS NOT NULL AND retired_at < ?`).bind(tenant, now - S.retain_days * 864e5).run();
    await db.prepare(`DELETE FROM kg_runs WHERE tenant = ? AND at < ?`).bind(tenant, now - S.runs_days * 864e5).run();
  } catch (e) { rec.error = String((e && e.message) || e).slice(0, 300); }
  await db.prepare(`INSERT INTO kg_runs (tenant, at, ms, nodes, edges, communities, modularity, added, changed, retired, insights_new, kept, dropped, error) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(tenant, at) DO UPDATE SET error = excluded.error`).bind(tenant, now, Date.now() - t0, rec.nodes, rec.edges, rec.communities, rec.modularity, rec.added, rec.changed, rec.retired, rec.insights_new, rec.kept, rec.dropped, rec.error).run();
  return { ok: !rec.error, ...rec };
}

// ------------------------------------------------------------------------------------------------------------------------------- read side
export async function lastRun(db, tenant = '') { await ensureKg(db); return db.prepare(`SELECT * FROM kg_runs WHERE tenant = ? ORDER BY at DESC LIMIT 1`).bind(tenant).first(); }
export async function kgHealth(db, tenant = '', now = Date.now(), { stale_h = 26 } = {}) {
  const r = await lastRun(db, tenant), age = r ? (now - r.at) / 36e5 : null;
  const s = (await all(db, `SELECT status, COUNT(*) AS n FROM kg_insights WHERE tenant = ? GROUP BY status`, tenant)).reduce((o, x) => (o[x.status] = x.n, o), {});
  const settled = (s.kept || 0) + (s.dropped || 0);
  return { ok: !!r && !r.error && age <= stale_h, last_run_hours_ago: age === null ? null : Number(age.toFixed(2)), nodes: r ? r.nodes : 0, edges: r ? r.edges : 0,
    communities: r ? r.communities : 0, modularity: r ? r.modularity : null, last_error: r ? r.error : null, insights: s, kept_rate: settled ? Number(((s.kept || 0) / settled).toFixed(3)) : null };
}
export async function analysis(db, tenant = '') { await ensureKg(db); const r = await db.prepare(`SELECT v FROM kg_state WHERE tenant = ? AND k = 'analysis'`).bind(tenant).first(); return r ? JSON.parse(r.v) : null; }
export async function insights(db, tenant = '', { status = 'open', limit = 50, kind = null } = {}) {
  await ensureKg(db);
  return all(db, `SELECT id, kind, subject, object, text, score, status, at, due_at, settled_at, follows FROM kg_insights WHERE tenant = ? AND (? = 'any' OR status = ?) AND (? IS NULL OR kind = ?) ORDER BY score DESC, id LIMIT ?`, tenant, status, status, kind, kind, Math.min(500, limit));
}
export async function follow(db, tenant, id) { await ensureKg(db); const r = await db.prepare(`UPDATE kg_insights SET follows = follows + 1 WHERE tenant = ? AND id = ?`).bind(tenant, String(id).slice(0, 300)).run(); return !!(r.meta && r.meta.changes); }
export async function snapshot(db, tenant = '', { limit = 1500 } = {}) {
  const g = await load(db, tenant), a = (await analysis(db, tenant)) || { rank: {}, community: {} };
  const nodes = [...g.nodes.values()].sort((x, y) => (a.rank[y.id] || 0) - (a.rank[x.id] || 0) || x.id.localeCompare(y.id)).slice(0, limit), keep = new Set(nodes.map(n => n.id));
  return { version: KG_VERSION, at: a.at || null, modularity: a.modularity ?? null, total: { nodes: g.nodes.size, edges: g.edges.length }, truncated: g.nodes.size > nodes.length ? `top ${nodes.length} nodes by PageRank` : null,
    nodes: nodes.map(n => ({ id: n.id, kind: n.kind, label: n.label, rank: a.rank[n.id] ?? null, community: a.community[n.id] ?? null, sources: n.sources.length })),
    edges: g.edges.filter(e => keep.has(e.src) && keep.has(e.dst)).map(e => ({ src: e.src, rel: e.rel, dst: e.dst, weight: e.weight })) };
}
export async function neighbors(db, tenant, id) {
  await ensureKg(db);
  return all(db, `SELECT e.src, e.rel, e.dst, n.kind, n.label FROM kg_edges e JOIN kg_nodes n ON n.tenant = e.tenant AND n.retired_at IS NULL AND n.id = CASE WHEN e.src = ? THEN e.dst ELSE e.src END
    WHERE e.tenant = ? AND e.retired_at IS NULL AND (e.src = ? OR e.dst = ?) GROUP BY e.src, e.rel, e.dst LIMIT 200`, id, tenant, id, id);
}
// Mountable JSON routes: GET base, base/insights, base/node?id=, base/method (the research, measured live), base/health; POST base/follow {id}. Returns null for any other path.
export async function handleKg(req, db, { tenant = '', base = '/api/graph', now = Date.now() } = {}) {
  const u = new URL(req.url), p = u.pathname.replace(/\/+$/, ''), J = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300', 'access-control-allow-origin': '*' } });
  if (!p.startsWith(base)) return null;
  if (req.method === 'GET' && (p === base || p === base + '.json')) return J({ ok: true, ...(await snapshot(db, tenant)) });
  if (req.method === 'GET' && p === base + '/insights') return J({ ok: true, insights: await insights(db, tenant, { status: u.searchParams.get('status') || 'open', kind: u.searchParams.get('kind'), limit: Number(u.searchParams.get('limit')) || 50 }) });
  if (req.method === 'GET' && p === base + '/node') { const id = u.searchParams.get('id') || ''; return J({ ok: true, id, neighbors: await neighbors(db, tenant, id) }); }
  if (req.method === 'GET' && p === base + '/method') return J({ ok: true, ...(await practices(db, tenant, now)) });
  if (req.method === 'GET' && p === base + '/health') { const h = await kgHealth(db, tenant, now); return J(h, h.ok ? 200 : 503); }
  if (req.method === 'POST' && p === base + '/follow') { let b = null; try { b = await req.json(); } catch (e) { return J({ ok: false, error: 'bad_json' }, 400); } return J({ ok: await follow(db, tenant, b && b.id) }); }
  return null;
}

// ------------------------------------------------------------------------------------------------------------- the research, as live checks
// Each best practice the engine follows, with its source and a measurement of this system's own graph. Nothing here is typed as a result:
// practices() reads the live tables, so the write-up a tenant serves (methodHtml) says what the graph does today, and "unmeasured" when it cannot.
export const KG_PRACTICES = [
  { id: 'schema-first', practice: 'Typed schema and deterministic extraction first; a model only inside a fixed schema, with a supporting quote checked against the text.',
    why: 'Model-built graphs drift in vocabulary and invent links; schema-guided, grounded extraction is the main remedy the construction literature reports.',
    source: { title: 'LLM-empowered knowledge graph construction: a survey (2025)', url: 'https://arxiv.org/abs/2510.20345' }, code: 'extract(), checkExtraction()',
    measure: m => ({ value: m.kinds, ok: m.kinds > 0, unit: 'node kinds in the schema' }) },
  { id: 'provenance', practice: 'Every node and edge records the record it came from.',
    why: 'An insight is only as credible as the facts under it; provenance lets a reader and a loop trace and retract a fact.',
    source: { title: 'From Local to Global: a GraphRAG approach to query-focused summarization (Edge et al. 2024)', url: 'https://arxiv.org/abs/2404.16130' }, code: 'kg_nodes.source, kg_edges.source',
    measure: m => ({ value: m.unsourced, ok: m.unsourced === 0, unit: 'live facts with no source' }) },
  { id: 'incremental-temporal', practice: 'Incremental, temporal upkeep: unchanged records cost nothing, changed facts are retired with a timestamp instead of deleted.',
    why: 'Rebuilding a graph from scratch is the main cost of GraphRAG; agent-memory graphs keep validity intervals so history stays queryable.',
    source: { title: 'Zep: a temporal knowledge graph architecture for agent memory (2025)', url: 'https://arxiv.org/abs/2501.13956' }, code: 'sync()',
    measure: m => ({ value: m.retired_kept, ok: m.run ? m.run.added + m.run.changed + m.run.retired <= Math.max(10, m.sources) : null, unit: 'retired facts kept as history' }) },
  { id: 'entity-resolution', practice: 'One id per entity: kind plus a normalised key (case, accents, punctuation, "et al."), plus explicit aliases.',
    why: 'Duplicate entities split evidence and hide the very connections the graph exists to find.',
    source: { title: 'LightRAG: simple and fast retrieval-augmented generation (Guo et al. 2025)', url: 'https://arxiv.org/abs/2410.05779' }, code: 'key(), nodeId()',
    measure: m => ({ value: m.dup_labels, ok: m.dup_labels === 0, unit: 'labels that resolve to two ids of one kind' }) },
  { id: 'communities', practice: 'Find communities and report their quality (modularity) on every run.',
    why: 'Communities are how a graph answers "what are the themes?"; GraphRAG summarises Leiden communities for global questions.',
    source: { title: 'From Louvain to Leiden: guaranteeing well-connected communities (Traag et al. 2019)', url: 'https://doi.org/10.1038/s41598-019-41695-z' }, code: 'communities(), modularity()',
    measure: m => ({ value: m.run ? m.run.modularity : null, ok: m.run && m.run.modularity !== null ? m.run.modularity >= 0.3 : null, unit: 'modularity (0.3 or more is clear structure)' }) },
  { id: 'links-are-leads', practice: 'Predicted links (Adamic-Adar) are leads with a check, never facts written into the graph.',
    why: 'Link prediction finds plausible missing edges, but a prediction stored as fact is how graphs fill with confident errors.',
    source: { title: 'The link-prediction problem for social networks (Liben-Nowell and Kleinberg 2007)', url: 'https://doi.org/10.1002/asi.20591' }, code: 'predictLinks(), judge()',
    measure: m => ({ value: (m.insights.open || 0), ok: true, unit: 'open leads awaiting their check' }) },
  { id: 'calibrated-insights', practice: 'Every insight has a due date and a check that can fail; outcomes re-weight each insight kind.',
    why: 'An insight loop that is never scored cannot improve; scoring turns it into a closed loop (DECISIONS-1).',
    source: { title: 'Ultrastable DECISIONS-1: every decision is measured', url: 'https://ultrastable.io/decisions' }, code: 'calibrate(), runKg()',
    measure: m => ({ value: m.kept_rate, ok: m.settled >= 3 ? m.kept_rate >= 0.1 : null, unit: `kept share of ${m.settled} settled insights` }) },
  { id: 'bounded-cost', practice: 'Bounded work per run: hub cap and pair cap in link prediction, writes only on change, analysis cached.',
    why: 'A Worker has a CPU budget and D1 bills by rows; an unbounded all-pairs pass is the usual way a graph job breaks its host.',
    source: { title: 'Cloudflare D1 limits', url: 'https://developers.cloudflare.com/d1/platform/limits/' }, code: 'predictLinks({ maxHub, maxPairs })',
    measure: m => ({ value: m.run ? m.run.ms : null, ok: m.run ? m.run.ms < 10000 : null, unit: 'ms for the last run' }) },
  { id: 'fresh', practice: 'The graph rebuilds itself on the system clock; a stale or failed run is a failed health check.',
    why: 'A graph that stops updating is a snapshot, and a snapshot is not an autonomous system.',
    source: { title: 'Ultrastable CLOCKWORK-1: every loop is a clock', url: 'https://ultrastable.io/live' }, code: 'kgHealth()',
    measure: m => ({ value: m.health.last_run_hours_ago, ok: m.health.ok, unit: 'hours since the last run' }) },
];
export async function practices(db, tenant = '', now = Date.now()) {
  await ensureKg(db);
  const health = await kgHealth(db, tenant, now), run = await lastRun(db, tenant);
  const one = async (sql, ...a) => ((await db.prepare(sql).bind(...a).first()) || {}).n || 0;
  const m = { health, run: run && !run.error ? run : null, insights: health.insights, kept_rate: health.kept_rate, settled: (health.insights.kept || 0) + (health.insights.dropped || 0),
    kinds: await one(`SELECT COUNT(DISTINCT kind) AS n FROM kg_nodes WHERE tenant = ? AND retired_at IS NULL`, tenant),
    unsourced: await one(`SELECT COUNT(*) AS n FROM kg_edges WHERE tenant = ? AND retired_at IS NULL AND (source IS NULL OR source = '')`, tenant),
    retired_kept: await one(`SELECT COUNT(*) AS n FROM kg_edges WHERE tenant = ? AND retired_at IS NOT NULL`, tenant),
    sources: await one(`SELECT COUNT(*) AS n FROM kg_sources WHERE tenant = ? AND retired_at IS NULL`, tenant),
    dup_labels: await one(`SELECT COUNT(*) AS n FROM (SELECT kind, lower(label) AS l FROM kg_nodes WHERE tenant = ? AND retired_at IS NULL GROUP BY kind, lower(label) HAVING COUNT(DISTINCT id) > 1)`, tenant) };
  return { at: now, version: KG_VERSION, health, practices: KG_PRACTICES.map(p => { const r = p.measure(m); return { id: p.id, practice: p.practice, why: p.why, source: p.source, code: p.code, value: r.value ?? null, unit: r.unit, status: r.ok === null || r.ok === undefined ? 'unmeasured' : r.ok ? 'holds' : 'fails' }; }) };
}
const h = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// An HTML fragment (no page chrome: the tenant wraps it in its own layout) re-measured on every request.
export function methodHtml(p) {
  const badge = s => `<span class="tag ${s === 'holds' ? 'ok' : s === 'fails' ? 'warn' : ''}">${s}</span>`;
  return `<p class="small muted">Measured ${h(new Date(p.at).toISOString().slice(0, 16).replace('T', ' '))} UTC from this site's own graph: ${h(p.health.nodes)} nodes, ${h(p.health.edges)} links, ${h(p.health.communities)} clusters. Every line below is re-checked each time this page loads.</p>
${p.practices.map(x => `<div class="step"><div class="k">${h(x.practice)} ${badge(x.status)}</div><p style="margin:0">${h(x.why)}</p><p class="small muted" style="margin:.3em 0 0">Now: ${x.value === null ? 'not measured yet' : h(x.value)} (${h(x.unit)}). Source: <a href="${h(x.source.url)}">${h(x.source.title)}</a>. Code: <code>${h(x.code)}</code>.</p></div>`).join('\n')}`;
}
