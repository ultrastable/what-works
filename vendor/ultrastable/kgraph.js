// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1 (Rowan, 2026-11-25): "All UltraStable deployments and systems shall have a knowledge graph (graph network) to automatically build and
// maintain a graph of connections for all data." This is the graph's analytic half: pure functions over one snapshot, no imports, no model, no network,
// so a tenant Worker, the tick Worker and a CI job all vendor this file unchanged. The storage half is the tenant's (D1 tables, see README.md).
//
// Snapshot (the `kg/1` contract every system serves at /graph.json):
//   { version: 'kg/1', system, generated_at, nodes: [{ id, kind, label, props?, provenance: [{ source, url?, at? }] }],
//     edges: [{ src, rel, dst, weight?, provenance: [...] }] }
// Every fact carries provenance; a fact without it is a problem, never silently accepted. Kinds and relations are the tenant's data (schema-light:
// a small typed core the tenant declares, not a fixed ontology and not free text).
//
// What it gives:
//   validate(snap)            dangling edges, facts with no provenance, duplicate ids
//   sync(prev, snap, now)     bitemporal upkeep: which facts are new, changed, still seen and retired (a fact that vanishes is retired with a time,
//                             never deleted, so the graph's history stays readable)
//   pagerank, communities     centrality and deterministic label-propagation communities over the undirected graph
//   linkPredict               Adamic-Adar over shared neighbours for node pairs of chosen kinds not yet linked (a lead, never a fact)
//   bridges                   nodes whose neighbours span several communities (participation coefficient)
//   disagreements             nodes that share a neighbour through a relation but carry opposite values of a property
//   gaps                      nodes of a kind that lack an expected relation
//   analyze(snap, spec)       all of the above, ranked into insights with stable ids, a prediction and a closing probe each
export const VERSION = 'kg/1';

const str = v => (v == null ? '' : String(v));
export function hash(s) {  // FNV-1a, 32-bit, hex: stable ids and change detection without crypto
  let h = 0x811c9dc5; s = str(s);
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const edgeKey = e => `${e.src}|${e.rel}|${e.dst}`;
const factHash = f => hash(JSON.stringify([f.kind || f.rel, f.label || '', f.props || {}, f.weight ?? 1]));

export function validate(snap) {
  const problems = [], ids = new Set();
  if (!snap || !Array.isArray(snap.nodes) || !Array.isArray(snap.edges)) return [{ kind: 'shape', detail: 'nodes and edges must be arrays' }];
  for (const n of snap.nodes) {
    if (!n.id || !n.kind) problems.push({ kind: 'node_shape', id: n.id || null });
    else if (ids.has(n.id)) problems.push({ kind: 'duplicate', id: n.id });
    ids.add(n.id);
    if (!Array.isArray(n.provenance) || !n.provenance.length) problems.push({ kind: 'no_provenance', id: n.id });
  }
  for (const e of snap.edges) {
    if (!ids.has(e.src) || !ids.has(e.dst)) problems.push({ kind: 'dangling', id: edgeKey(e) });
    if (!Array.isArray(e.provenance) || !e.provenance.length) problems.push({ kind: 'no_provenance', id: edgeKey(e) });
  }
  return problems;
}

// prev: { [factId]: { hash, first_seen, last_seen, retired_at } } as the tenant stored it. Returns the next map and what moved.
// A retired fact that reappears is revived with a new first_seen, so "when did this become true again" stays answerable.
export function sync(prev = {}, snap, now = Date.now()) {
  const at = new Date(now).toISOString(), next = {}, moved = { added: [], changed: [], retired: [], revived: [], kept: 0 };
  const facts = [...snap.nodes.map(n => ['n:' + n.id, n]), ...snap.edges.map(e => ['e:' + edgeKey(e), e])];
  for (const [id, f] of facts) {
    const h = factHash(f), o = prev[id];
    if (!o) { next[id] = { hash: h, first_seen: at, last_seen: at, retired_at: null }; moved.added.push(id); }
    else if (o.retired_at) { next[id] = { hash: h, first_seen: at, last_seen: at, retired_at: null }; moved.revived.push(id); }
    else { next[id] = { ...o, hash: h, last_seen: at }; if (o.hash !== h) moved.changed.push(id); else moved.kept++; }
  }
  for (const [id, o] of Object.entries(prev)) if (!next[id]) { next[id] = o.retired_at ? o : { ...o, retired_at: at }; if (!o.retired_at) moved.retired.push(id); }
  return { state: next, moved };
}

// Undirected weighted adjacency; `rels` limits which relations count.
export function adjacency(snap, { rels } = {}) {
  const adj = new Map();
  for (const n of snap.nodes) adj.set(n.id, new Map());
  for (const e of snap.edges) {
    if (rels && !rels.includes(e.rel)) continue;
    if (!adj.has(e.src) || !adj.has(e.dst) || e.src === e.dst) continue;
    const w = Number.isFinite(e.weight) ? e.weight : 1;
    adj.get(e.src).set(e.dst, (adj.get(e.src).get(e.dst) || 0) + w);
    adj.get(e.dst).set(e.src, (adj.get(e.dst).get(e.src) || 0) + w);
  }
  return adj;
}

export function pagerank(adj, { d = 0.85, iters = 40, tol = 1e-9 } = {}) {
  const ids = [...adj.keys()].sort(), N = ids.length || 1, out = new Map(ids.map(i => [i, [...adj.get(i).values()].reduce((a, b) => a + b, 0)]));
  let pr = new Map(ids.map(i => [i, 1 / N]));
  for (let k = 0; k < iters; k++) {
    let dangling = 0; for (const i of ids) if (!out.get(i)) dangling += pr.get(i);
    const nx = new Map(ids.map(i => [i, (1 - d) / N + d * dangling / N]));
    for (const i of ids) { const o = out.get(i); if (!o) continue; for (const [j, w] of adj.get(i)) nx.set(j, nx.get(j) + d * pr.get(i) * w / o); }
    let delta = 0; for (const i of ids) delta += Math.abs(nx.get(i) - pr.get(i));
    pr = nx; if (delta < tol) break;
  }
  return pr;
}

// Deterministic label propagation: nodes in id order, ties go to the smallest label, so the same graph always gives the same communities.
export function communities(adj, { iters = 30 } = {}) {
  const ids = [...adj.keys()].sort(), label = new Map(ids.map(i => [i, i]));
  for (let k = 0; k < iters; k++) {
    let changed = false;
    for (const i of ids) {
      const score = new Map();
      for (const [j, w] of adj.get(i)) score.set(label.get(j), (score.get(label.get(j)) || 0) + w);
      if (!score.size) continue;
      let best = null, bw = -1;
      for (const [l, w] of [...score].sort((a, b) => (a[0] < b[0] ? -1 : 1))) if (w > bw) { best = l; bw = w; }
      if (best !== label.get(i)) { label.set(i, best); changed = true; }
    }
    if (!changed) break;
  }
  return label;
}

// Adamic-Adar: sum over shared neighbours z of 1 / log(deg z). Pairs already linked by any relation are skipped. kinds: [kindA, kindB].
export function linkPredict(snap, adj, { kinds, via, top = 20, min = 0 } = {}) {
  const kindOf = new Map(snap.nodes.map(n => [n.id, n.kind])), a = via ? adjacency(snap, { rels: via }) : adj, full = adjacency(snap);
  const want = kinds ? new Set(kinds) : null, scores = new Map();
  for (const [z, nb] of a) {
    const deg = nb.size; if (deg < 2) continue;
    const ns = [...nb.keys()].filter(x => !want || want.has(kindOf.get(x))).sort(), w = 1 / Math.log(deg);
    for (let i = 0; i < ns.length; i++) for (let j = i + 1; j < ns.length; j++) {
      const [x, y] = [ns[i], ns[j]];
      if (kinds && !((kindOf.get(x) === kinds[0] && kindOf.get(y) === kinds[1]) || (kindOf.get(x) === kinds[1] && kindOf.get(y) === kinds[0]))) continue;
      if (full.get(x).has(y)) continue;
      const k = x + '\u0000' + y, s = scores.get(k) || { a: x, b: y, score: 0, via: [] };
      s.score += w; s.via.push(z); scores.set(k, s);
    }
  }
  return [...scores.values()].filter(s => s.score > min).sort((p, q) => q.score - p.score || (p.a + p.b).localeCompare(q.a + q.b)).slice(0, top);
}

// Participation coefficient: 1 - sum over communities (edges into c / degree)^2. High means the node joins otherwise separate groups.
export function bridges(adj, label, { top = 10, minDegree = 3 } = {}) {
  const out = [];
  for (const [i, nb] of adj) {
    if (nb.size < minDegree) continue;
    const by = new Map(); let tot = 0;
    for (const [j, w] of nb) { by.set(label.get(j), (by.get(label.get(j)) || 0) + w); tot += w; }
    if (by.size < 2) continue;
    let s = 0; for (const w of by.values()) s += (w / tot) ** 2;
    out.push({ id: i, participation: 1 - s, communities: by.size });
  }
  return out.sort((a, b) => b.participation - a.participation || a.id.localeCompare(b.id)).slice(0, top);
}

// rule: { kind, via (relation to a shared neighbour), prop, opposite: [[v1, v2], ...] }. Two nodes of `kind` that share a neighbour through `via`
// and carry opposite values of `prop` disagree: the shared neighbour is what to look at.
export function disagreements(snap, { kind, via, prop, opposite = [] }) {
  const node = new Map(snap.nodes.map(n => [n.id, n])), opp = new Set(opposite.flatMap(([x, y]) => [x + '|' + y, y + '|' + x])), at = new Map();
  for (const e of snap.edges) if (e.rel === via && node.get(e.src)?.kind === kind) (at.get(e.dst) || at.set(e.dst, []).get(e.dst)).push(e.src);
  const out = [];
  for (const [shared, ms] of at) {
    const s = [...new Set(ms)].sort();
    for (let i = 0; i < s.length; i++) for (let j = i + 1; j < s.length; j++) {
      const va = str(node.get(s[i]).props?.[prop]), vb = str(node.get(s[j]).props?.[prop]);
      if (opp.has(va + '|' + vb)) out.push({ a: s[i], b: s[j], shared, values: [va, vb] });
    }
  }
  return out;
}

// rule: { id, kind, lacks: { rel, dir: 'out'|'in' } }
export function gaps(snap, rules = []) {
  const out = [];
  for (const r of rules) {
    const dir = (r.lacks && r.lacks.dir) || 'out', have = new Set(snap.edges.filter(e => e.rel === r.lacks.rel).map(e => (dir === 'out' ? e.src : e.dst)));
    for (const n of snap.nodes) if (n.kind === r.kind && !have.has(n.id)) out.push({ rule: r.id, node: n.id });
  }
  return out;
}

// spec (the tenant's): { links: [{ id, kinds, via?, ask(a, b, s) }], disagreements: [{ id, ..., ask(a, b, shared) }], gaps: [{ id, kind, lacks, ask(n) }],
// bridges: { ask(n), kinds?, top? }?, extra?(snap, ctx), top }. ask() words an insight for a reader. Every insight has a stable id (type + sorted nodes), so a ledger can tell a new
// insight from a standing one, and a closing probe naming the fact that would settle it.
export function analyze(snap, spec = {}, { now = Date.now() } = {}) {
  const problems = validate(snap);
  if (problems.some(p => p.kind === 'shape')) return { version: VERSION, ok: false, problems, insights: [] };
  const node = new Map(snap.nodes.map(n => [n.id, n])), adj = adjacency(snap), pr = pagerank(adj), label = communities(adj);
  const groups = new Map(); for (const [i, l] of label) (groups.get(l) || groups.set(l, []).get(l)).push(i);
  const comms = [...groups.values()].filter(g => g.length > 1).sort((a, b) => b.length - a.length).map((g, k) => {
    const lead = g.slice().sort((x, y) => pr.get(y) - pr.get(x))[0], kinds = {};
    for (const i of g) kinds[node.get(i).kind] = (kinds[node.get(i).kind] || 0) + 1;
    return { id: 'c' + k, size: g.length, lead, label: node.get(lead).label, kinds, members: g.sort() };
  });
  const commOf = new Map(); comms.forEach(c => c.members.forEach(m => commOf.set(m, c.id)));
  const lab = id => node.get(id)?.label || id, insights = [];
  // The id names the rule that found the insight as well as its nodes: two gap rules about one node, or two link rules about one pair, are two insights with two ledger entries.
  const push = (type, ids, score, title, why, probe, rule = null) => insights.push({ id: type + ':' + hash(type + '|' + (rule ? rule + '|' : '') + ids.slice().sort().join('|')), type, nodes: ids, score: +score.toFixed(4), title, why, prediction: probe.prediction, probe: probe.probe });
  for (const r of spec.links || []) for (const s of linkPredict(snap, adj, { kinds: r.kinds, via: r.via, top: r.top || 10 })) {
    const cross = commOf.get(s.a) !== commOf.get(s.b);
    push('link', [s.a, s.b], s.score * (cross ? 1.5 : 1), r.ask ? r.ask(node.get(s.a), node.get(s.b), s) : `${lab(s.a)} and ${lab(s.b)} share ${s.via.length} neighbours but are not linked`,
      `Shared: ${s.via.slice(0, 5).map(lab).join(', ')}${cross ? '; they sit in different communities' : ''}.`,
      { prediction: `a link ${s.a} ~ ${s.b} is confirmed or rejected within 30 d`, probe: `edge between ${s.a} and ${s.b} exists, or the lead is dismissed` }, r.id);
  }
  for (const r of spec.disagreements || []) for (const x of disagreements(snap, r)) {
    push('disagree', [x.a, x.b, x.shared], 2 + pr.get(x.shared) * snap.nodes.length, r.ask ? r.ask(node.get(x.a), node.get(x.b), node.get(x.shared)) : `${lab(x.a)} and ${lab(x.b)} disagree on ${r.prop} through ${lab(x.shared)}`,
      `${lab(x.a)} is ${x.values[0]}, ${lab(x.b)} is ${x.values[1]}, both through ${lab(x.shared)}.`,
      { prediction: `the difference between ${x.a} and ${x.b} is explained by a recorded moderator within 30 d`, probe: `a node or edge explaining ${x.a} vs ${x.b} exists` }, r.id);
  }
  const bk = spec.bridges && spec.bridges.kinds ? new Set(spec.bridges.kinds) : null;
  for (const b of bridges(adj, label, { top: 1e9 }).filter(x => !bk || bk.has(node.get(x.id).kind)).slice(0, (spec.bridges && spec.bridges.top) || 5)) {
    push('bridge', [b.id], b.participation * b.communities, spec.bridges && spec.bridges.ask ? spec.bridges.ask(node.get(b.id), b) : `${lab(b.id)} connects ${b.communities} otherwise separate groups`,
      `Participation ${b.participation.toFixed(2)} across ${b.communities} communities.`, { prediction: `${b.id} stays a bridge in the next snapshot`, probe: `participation of ${b.id} >= 0.5` });
  }
  const gapRules = Object.fromEntries((spec.gaps || []).map(r => [r.id, r]));
  for (const g of gaps(snap, spec.gaps || [])) {
    const r = gapRules[g.rule];
    push('gap', [g.node], 1 + pr.get(g.node) * snap.nodes.length, r.ask ? r.ask(node.get(g.node)) : `${lab(g.node)} lacks ${r.lacks.rel}`, `Rule ${g.rule}.`,
      { prediction: `${g.node} gains a ${r.lacks.rel} edge within 30 d`, probe: `${g.node} has a ${r.lacks.rel} edge` }, g.rule);
  }
  // spec.extra(snap, { node, pagerank, community }) -> [{ type, nodes, score, title, why, prediction, probe }]: tenant-specific readings ranked with the rest.
  if (typeof spec.extra === 'function') for (const x of spec.extra(snap, { node, pagerank: pr, community: commOf }) || []) push(x.type, x.nodes, x.score, x.title, x.why || '', { prediction: x.prediction, probe: x.probe });
  insights.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const central = [...pr].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 10).map(([id, s]) => ({ id, label: lab(id), kind: node.get(id).kind, pagerank: +s.toFixed(5) }));
  const kinds = {}, rels = {};
  for (const n of snap.nodes) kinds[n.kind] = (kinds[n.kind] || 0) + 1;
  for (const e of snap.edges) rels[e.rel] = (rels[e.rel] || 0) + 1;
  return { version: VERSION, ok: !problems.length, at: new Date(now).toISOString(), stats: { nodes: snap.nodes.length, edges: snap.edges.length, kinds, rels, communities: comms.length },
    problems, central, communities: comms.map(({ members, ...c }) => ({ ...c, members: members.slice(0, 25) })), insights: insights.slice(0, spec.top || 50) };
}

// Ledger of insights over time: which are new, which stand, which went away (and when). Same bitemporal idea as sync().
export function track(prev = {}, insights, now = Date.now()) {
  const at = new Date(now).toISOString(), next = {}, out = { new: [], standing: [], gone: [] };
  for (const i of insights) { const o = prev[i.id]; next[i.id] = { first_seen: o && !o.gone_at ? o.first_seen : at, last_seen: at, gone_at: null, title: i.title }; (o && !o.gone_at ? out.standing : out.new).push(i.id); }
  for (const [id, o] of Object.entries(prev)) if (!next[id]) { next[id] = o.gone_at ? o : { ...o, gone_at: at }; if (!o.gone_at) out.gone.push(id); }
  return { state: next, moved: out };
}
