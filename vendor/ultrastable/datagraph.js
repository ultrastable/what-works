// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) 2026 Rowan Brad Quni-Gudzinas. Non-commercial use free; commercial use requires a license. See LICENSE.
// Usage and contract: core/datagraph/README.md.
// DATAGRAPH-1 (Rowan, 2026-11-25): "All Ultrastable deployments and systems shall have a knowledge graph (graph network) to automatically build and
// maintain a graph of connections for all data." Pure functions, no I/O, no model, no network: a Worker step or a CI job calls them over rows it read.
//   extract(tables)   every row of every table becomes a node; a value that equals another row's key becomes an edge named after its column
//                     (foreign keys found from the data, no schema needed); an id written inside a text field becomes a `mentions` edge
//   analyze(graph)    degree, PageRank, label-propagation communities, components, orphans, hubs, bridges
//   predict(graph)    Adamic-Adar link candidates between nodes two hops apart that are not linked (Liben-Nowell and Kleinberg 2007)
//   insights(...)     findings worded for a loop, each with a stable id, a score, a prediction and a closing probe
//   settle/calibrate  a proposed edge the data later confirms is kept, one that never appears is dropped; kind weights learn from the outcomes
// Bounded everywhere: rows per table, nodes, mentions per row, candidates per node. A secret-shaped table or column is never read into the graph.
export const VERSION = '1.0.0';
export const DEFAULTS = Object.freeze({
  maxRowsPerTable: 400, maxNodes: 20000, maxMentionsPerRow: 12, minKeyLen: 3, maxKeyFanout: 3,
  prIters: 30, damping: 0.85, lpRounds: 15, hubs: 10, candidates: 25, perNode: 2, orphanShare: 0.5, orphanMin: 10,
  keepDays: 14, minOutcomes: 3,
});
// Tables and columns that are never read into the graph: credentials, sessions, tokens, raw visitor hits, the graph's own tables.
// Personal tables (people's own words and contacts: inboxes, interview answers, suggestions, subscribers) stay out too: the graph is of the system's
// data, and a person's message is theirs.
export const SKIP_TABLE = /^(sqlite_|_|d1_|kg_)|cred|secret|token|oauth|session|vault|password|passkey|otp|cookie|^hits$|webhook_secret|sign_?in|login_code|inbox|answer|interview|suggest|subscriber|contact|visitor|mail|meta_ingest/i;
export const SKIP_COL = /token|secret|password|passwd|api_?key|private|cookie|signature|^sig$|email|phone|address|^ip$|ip_addr|^vid$|user_?agent|^ua$|refresh|bearer|nonce|code_hash/i;
const LABEL_COLS = ['title', 'name', 'label', 'subject', 'summary', 'text', 'description', 'kind'];
const TEXT_MIN = 24; // a string at least this long is scanned for mentions
const TOKEN = /[A-Za-z0-9][A-Za-z0-9_.:\/-]{2,79}/g;

export function hash(s) { let h = 0x811c9dc5; s = String(s); for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(16).padStart(8, '0'); }
const nid = (table, key) => `${table}:${key}`;
const isNum = v => typeof v === 'number' || (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v));
const refCol = c => /(_id|_ref|^id_|^ref$|^parent$|^src$|^dst$|^system$|^item$|^tenant$|^loop$|^repo$|^target$|^subject$|^source$)/i.test(c);

// tables: [{ name, key?: column, rows: [{...}], kind?, label?: column, refs?: { column: table } }]. `key` defaults to `id`, then `_rid` (the rowid the
// reader selected), then the first column. opts.declared lets a tenant name kinds, labels and refs; everything else is found from the data.
export function extract(tables, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, at = o.at || null;
  const nodes = new Map(), keyIndex = new Map(), edges = new Map(), dropped = { tables: [], columns: new Set(), nodes: 0, ambiguous: 0 };
  const use = [];
  for (const t of tables || []) {
    if (!t || !t.name) continue;
    if (SKIP_TABLE.test(t.name) || (o.skip || []).includes(t.name)) { dropped.tables.push(t.name); continue; }
    use.push(t);
  }
  // pass 1: nodes and the key index
  for (const t of use) {
    const d = (o.declared || {})[t.name] || {}, rows = (t.rows || []).slice(0, o.maxRowsPerTable);
    const cols = rows.length ? Object.keys(rows[0]) : [];
    const key = d.key || t.key || (cols.includes('id') ? 'id' : cols.includes('_rid') ? '_rid' : cols[0]);
    const label = d.label || t.label || LABEL_COLS.find(c => cols.includes(c) && !SKIP_COL.test(c)) || key;
    for (const r of rows) {
      if (nodes.size >= o.maxNodes) { dropped.nodes++; continue; }
      const k = r[key]; if (k == null || k === '') continue;
      const id = nid(t.name, k), props = {};
      for (const [c, v] of Object.entries(r)) {
        if (c === '_rid') continue;
        if (SKIP_COL.test(c)) { dropped.columns.add(`${t.name}.${c}`); continue; }
        if (v == null) continue;
        props[c] = typeof v === 'string' && v.length > 200 ? v.slice(0, 200) + '…' : v;
      }
      const lab = String(r[label] ?? k).slice(0, 160);
      nodes.set(id, { id, kind: d.kind || t.kind || t.name, label: lab, props, hash: hash(JSON.stringify(props)), source: `d1:${t.name}` });
      const ks = String(k);
      if (ks.length >= o.minKeyLen && !(isNum(ks) && key === '_rid')) { const l = keyIndex.get(ks) || []; l.push(id); keyIndex.set(ks, l); }
    }
    t._key = key; t._declared = d;
  }
  const add = (src, rel, dst, confidence, source) => {
    if (src === dst || !nodes.has(dst)) return;
    const k = `${src}|${rel}|${dst}`, old = edges.get(k);
    if (!old || old.confidence < confidence) edges.set(k, { src, rel, dst, confidence, source, at });
  };
  // pass 2: edges from reference columns (declared, then found by an exact key match) and from ids mentioned in text
  for (const t of use) {
    const d = t._declared || {}, refs = d.refs || t.refs || {};
    for (const r of (t.rows || []).slice(0, o.maxRowsPerTable)) {
      const k = r[t._key]; if (k == null || k === '') continue;
      const src = nid(t.name, k); if (!nodes.has(src)) continue;
      let mentions = 0;
      for (const [c, v] of Object.entries(r)) {
        if (c === t._key || c === '_rid' || v == null || SKIP_COL.test(c)) continue;
        const s = String(v);
        if (refs[c]) { add(src, c, nid(refs[c], s), 1, `declared:${t.name}.${c}`); continue; }
        if (s.length < o.minKeyLen) continue;
        const hit = keyIndex.get(s);
        if (hit && (!isNum(s) || refCol(c))) {
          const targets = hit.filter(x => x !== src);
          if (targets.length > o.maxKeyFanout) { dropped.ambiguous++; continue; }
          for (const x of targets) add(src, c, x, refCol(c) ? 0.95 : 0.85, `value:${t.name}.${c}`);
          continue;
        }
        if (s.length >= TEXT_MIN && mentions < o.maxMentionsPerRow) {
          const seen = new Set();
          for (const m of s.match(TOKEN) || []) {
            const tok = m.replace(/[.:\/-]+$/, '');
            if (seen.has(tok) || isNum(tok)) continue; seen.add(tok);
            const h = keyIndex.get(tok);
            if (!h || h.length > o.maxKeyFanout) continue;
            for (const x of h) if (x !== src && mentions < o.maxMentionsPerRow) { add(src, 'mentions', x, 0.6, `text:${t.name}.${c}`); mentions++; }
          }
        }
      }
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()], dropped: { ...dropped, columns: [...dropped.columns].sort() } };
}

// Undirected adjacency over confirmed edges (a proposed edge is a lead, never structure).
function adjacency(graph) {
  const ids = graph.nodes.map(n => n.id), adj = new Map(ids.map(i => [i, new Set()]));
  for (const e of graph.edges) if (e.status !== 'proposed' && e.status !== 'rejected' && adj.has(e.src) && adj.has(e.dst) && e.src !== e.dst) { adj.get(e.src).add(e.dst); adj.get(e.dst).add(e.src); }
  return { ids, adj };
}

export function analyze(graph, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, { ids, adj } = adjacency(graph), N = ids.length;
  const kindOf = new Map(graph.nodes.map(n => [n.id, n.kind])), labelOf = new Map(graph.nodes.map(n => [n.id, n.label]));
  const degree = new Map(ids.map(i => [i, adj.get(i).size]));
  // PageRank (power iteration; dangling mass spread evenly)
  let pr = new Map(ids.map(i => [i, N ? 1 / N : 0]));
  for (let it = 0; it < o.prIters && N; it++) {
    let dangling = 0; for (const i of ids) if (!degree.get(i)) dangling += pr.get(i);
    const next = new Map(ids.map(i => [i, (1 - o.damping) / N + o.damping * dangling / N]));
    for (const i of ids) { const d = degree.get(i); if (!d) continue; const share = o.damping * pr.get(i) / d; for (const j of adj.get(i)) next.set(j, next.get(j) + share); }
    pr = next;
  }
  // connected components
  const comp = new Map(); let nComp = 0;
  for (const s of ids) { if (comp.has(s)) continue; const q = [s]; comp.set(s, nComp); while (q.length) { const x = q.pop(); for (const y of adj.get(x)) if (!comp.has(y)) { comp.set(y, nComp); q.push(y); } } nComp++; }
  // label propagation communities, deterministic: sorted order, ties to the smallest label
  const lab = new Map(ids.map(i => [i, i])), order = [...ids].sort();
  for (let r = 0; r < o.lpRounds; r++) {
    let moved = 0;
    for (const i of order) {
      const nb = adj.get(i); if (!nb.size) continue;
      const c = new Map(); for (const j of nb) c.set(lab.get(j), (c.get(lab.get(j)) || 0) + 1);
      let best = lab.get(i), bc = c.get(best) || 0;
      for (const [l, n] of c) if (n > bc || (n === bc && l < best)) { best = l; bc = n; }
      if (best !== lab.get(i)) { lab.set(i, best); moved++; }
    }
    if (!moved) break;
  }
  const commSize = new Map(); for (const i of ids) if (degree.get(i)) commSize.set(lab.get(i), (commSize.get(lab.get(i)) || 0) + 1);
  // bridges: nodes whose neighbours sit in several communities (participation coefficient)
  const bridges = [];
  for (const i of ids) {
    const d = degree.get(i); if (d < 2) continue;
    const c = new Map(); for (const j of adj.get(i)) c.set(lab.get(j), (c.get(lab.get(j)) || 0) + 1);
    if (c.size < 2) continue;
    let s = 0; for (const n of c.values()) s += (n / d) ** 2;
    bridges.push({ id: i, label: labelOf.get(i), kind: kindOf.get(i), participation: +(1 - s).toFixed(3), communities: c.size, degree: d });
  }
  bridges.sort((a, b) => b.participation * Math.log2(1 + b.degree) - a.participation * Math.log2(1 + a.degree) || a.id.localeCompare(b.id));
  const byKind = {};
  for (const i of ids) { const k = kindOf.get(i); const b = byKind[k] || (byKind[k] = { nodes: 0, orphans: 0, edges: 0 }); b.nodes++; if (!degree.get(i)) b.orphans++; b.edges += degree.get(i); }
  const hubs = [...ids].sort((a, b) => pr.get(b) - pr.get(a) || a.localeCompare(b)).slice(0, o.hubs).map(i => ({ id: i, label: labelOf.get(i), kind: kindOf.get(i), pagerank: +pr.get(i).toFixed(5), degree: degree.get(i) }));
  const communities = [...commSize].filter(([, n]) => n > 1).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).slice(0, 20)
    .map(([l, n]) => ({ id: l, size: n, label: labelOf.get(l), kinds: [...new Set(ids.filter(i => lab.get(i) === l).map(i => kindOf.get(i)))].sort() }));
  const nEdges = [...degree.values()].reduce((a, b) => a + b, 0) / 2;
  return {
    nodes: N, edges: nEdges, components: nComp, orphans: ids.filter(i => !degree.get(i)).length, density: N > 1 ? +(2 * nEdges / (N * (N - 1))).toFixed(6) : 0,
    by_kind: byKind, hubs, communities, bridges: bridges.slice(0, o.hubs),
    _community: lab, _pagerank: pr,
  };
}

// Adamic-Adar over two-hop pairs not already linked. Shared neighbours of high degree count for little, so a hub cannot fill the list.
export function predict(graph, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, { ids, adj } = adjacency(graph), kindOf = new Map(graph.nodes.map(n => [n.id, n.kind])), labelOf = new Map(graph.nodes.map(n => [n.id, n.label]));
  const known = new Set((opts.known || []).map(p => [p.src, p.dst].sort().join('|')));
  const score = new Map(), via = new Map();
  for (const z of ids) {
    const nb = [...adj.get(z)]; if (nb.length < 2 || nb.length > 200) continue; // a node linked to everything says nothing about any pair
    const w = 1 / Math.log(nb.length);
    for (let a = 0; a < nb.length; a++) for (let b = a + 1; b < nb.length; b++) {
      const [x, y] = nb[a] < nb[b] ? [nb[a], nb[b]] : [nb[b], nb[a]];
      if (adj.get(x).has(y)) continue;
      const k = `${x}|${y}`; if (known.has(k)) continue;
      score.set(k, (score.get(k) || 0) + w); const v = via.get(k) || []; if (v.length < 3) v.push(z); via.set(k, v);
    }
  }
  const per = new Map(), out = [];
  for (const [k, s] of [...score].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
    const [x, y] = k.split('|');
    if ((per.get(x) || 0) >= o.perNode || (per.get(y) || 0) >= o.perNode) continue;
    if ((via.get(k) || []).length < 2 && s < 1) continue; // one shared neighbour is not evidence
    per.set(x, (per.get(x) || 0) + 1); per.set(y, (per.get(y) || 0) + 1);
    out.push({ src: x, dst: y, rel: 'related', score: +s.toFixed(4), via: via.get(k), why: `${(via.get(k) || []).length} shared neighbours (${(via.get(k) || []).map(v => labelOf.get(v)).join(', ').slice(0, 120)})`, kinds: [kindOf.get(x), kindOf.get(y)] });
    if (out.length >= o.candidates) break;
  }
  return out;
}

// Findings worded for a loop. Every one has a stable id (same finding, same id), a score, a prediction in the scorer's form and a closing probe.
export function insights({ analysis, candidates = [], previous = null, weights = {} }, opts = {}) {
  const o = { ...DEFAULTS, ...opts }, w = k => (weights[k] == null ? 1 : weights[k]), out = [];
  for (const [kind, b] of Object.entries(analysis.by_kind || {})) {
    if (b.nodes < o.orphanMin) continue;
    const share = b.orphans / b.nodes;
    if (share >= o.orphanShare) out.push({ id: `orphans:${kind}`, kind: 'orphans', subject: kind, score: +(share * w('orphans')).toFixed(3),
      text: `${b.orphans} of ${b.nodes} ${kind} records connect to nothing else in this system's data (${Math.round(share * 100)}%). Link them (a reference column, an id in the text) or stop keeping them.`,
      prediction: `graph_orphan_share_${kind} < ${o.orphanShare} within 168 h`, probe: `datagraph:orphans:${kind}` });
  }
  for (const b of (analysis.bridges || []).slice(0, 3)) out.push({ id: `bridge:${b.id}`, kind: 'bridge', subject: b.id, score: +(b.participation * w('bridge')).toFixed(3),
    text: `"${b.label}" (${b.kind}) joins ${b.communities} otherwise separate clusters of this system's data; a change to it reaches all of them.`, prediction: `graph_bridge_${hash(b.id)} >= 2 within 168 h`, probe: `datagraph:bridge:${b.id}` });
  if (previous && Array.isArray(previous.hubs)) {
    const before = new Set(previous.hubs.map(h => h.id));
    for (const h of (analysis.hubs || []).slice(0, 5)) if (!before.has(h.id)) out.push({ id: `hub:${h.id}`, kind: 'new-hub', subject: h.id, score: +(0.5 * w('new-hub')).toFixed(3),
      text: `"${h.label}" (${h.kind}) became one of the most connected records since the last pass (${h.degree} links).`, prediction: `graph_hub_rank_${hash(h.id)} <= ${o.hubs} within 168 h`, probe: `datagraph:hub:${h.id}` });
    if (previous.components != null && analysis.components > previous.components * 1.25 + 2) out.push({ id: 'components', kind: 'fragmenting', subject: 'graph', score: w('fragmenting'),
      text: `The data split into ${analysis.components} disconnected parts, up from ${previous.components}. New records are arriving without links to what exists.`, prediction: `graph_components <= ${previous.components} within 168 h`, probe: 'datagraph:components' });
  }
  for (const c of candidates.slice(0, 5)) out.push({ id: `link:${c.src}|${c.dst}`, kind: 'link', subject: c.src, score: +(Math.min(1, c.score / 3) * w('link')).toFixed(3),
    text: `${c.src} and ${c.dst} share ${c.why} but are not linked. A lead, not a fact: it is kept only if the data later links them.`, prediction: `graph_edge_confirmed ${c.src}|${c.dst} == 1 within ${o.keepDays * 24} h`, probe: `datagraph:link:${c.src}|${c.dst}` });
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

// A proposed edge is kept when the data later holds a confirmed edge between the same two nodes, dropped when it is older than keepDays without one.
export function settle(proposed, graph, { now = Date.now(), keepDays = DEFAULTS.keepDays } = {}) {
  const linked = new Set(); for (const e of graph.edges) if (e.status !== 'proposed' && e.status !== 'rejected') linked.add([e.src, e.dst].sort().join('|'));
  return proposed.map(p => {
    const k = [p.src, p.dst].sort().join('|');
    if (linked.has(k)) return { ...p, outcome: 'kept' };
    if (now - Date.parse(p.first_seen || p.at || 0) > keepDays * 864e5) return { ...p, outcome: 'dropped' };
    return { ...p, outcome: 'open' };
  });
}

// Weight per insight kind from outcomes: Beta(1,1) prior, unchanged until minOutcomes, bounded to [0.5, 1.5].
export function calibrate(outcomes, { minOutcomes = DEFAULTS.minOutcomes } = {}) {
  const t = {};
  for (const x of outcomes || []) { if (x.outcome !== 'kept' && x.outcome !== 'dropped') continue; const s = t[x.kind] || (t[x.kind] = { kept: 0, dropped: 0 }); s[x.outcome]++; }
  const w = {};
  for (const [k, s] of Object.entries(t)) { const n = s.kept + s.dropped; w[k] = n < minOutcomes ? 1 : +Math.min(1.5, Math.max(0.5, 2 * (s.kept + 1) / (n + 2))).toFixed(3); }
  return { weights: w, tally: t };
}

// The subgraph around a node for retrieval (a GraphRAG local search): breadth-first to `depth`, bounded, edges kept with their relation.
export function neighborhood(graph, id, { depth = 2, limit = 60 } = {}) {
  const out = new Map(), byNode = new Map();
  for (const e of graph.edges) { if (e.status === 'rejected') continue; for (const [a] of [[e.src], [e.dst]]) { const l = byNode.get(a) || []; l.push(e); byNode.set(a, l); } }
  const seen = new Map([[id, 0]]); let frontier = [id];
  for (let d = 1; d <= depth && frontier.length && seen.size < limit; d++) {
    const next = [];
    for (const x of frontier) for (const e of byNode.get(x) || []) {
      out.set(`${e.src}|${e.rel}|${e.dst}`, e);
      const y = e.src === x ? e.dst : e.src;
      if (!seen.has(y) && seen.size < limit) { seen.set(y, d); next.push(y); }
    }
    frontier = next;
  }
  const keep = new Set(seen.keys());
  return { center: id, nodes: graph.nodes.filter(n => keep.has(n.id)).map(n => ({ ...n, distance: seen.get(n.id) })), edges: [...out.values()].filter(e => keep.has(e.src) && keep.has(e.dst)) };
}
