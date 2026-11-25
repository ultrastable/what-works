// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1 on the shared engine: the atlas's graph (graph.js, built every beat from the programmes, the trials the evidence loop read in and
// the computed grades) is also kept in the platform's shared D1 knowledge graph (vendor/ultrastable/knowledge.js), the one engine every
// Ultrastable system runs. Each node of the snapshot is a record carrying its out-edges, so a programme, study or country that leaves the atlas
// is retired with its facts, never deleted. The engine adds what the atlas's own reading does not keep: findings with a due date and a check
// that can fail, and insight kinds re-weighted by how often they came true. Served at /api/graph* (method re-measured live).
import { runKg, lastRun, kgHealth, handleKg } from "../vendor/ultrastable/knowledge.js";
import { renameLegacy } from "./graph.js";

export const TENANT = "what-works";

// kg/1 snapshot -> engine records: one per node that has out-edges, declaring both ends of each edge.
export function records(snap) {
  const byId = new Map(snap.nodes.map(n => [n.id, n])), out = new Map();
  for (const e of snap.edges) if (byId.has(e.src) && byId.has(e.dst)) (out.get(e.src) || out.set(e.src, []).get(e.src)).push(e);
  const pick = n => ({ id: n.id, kind: n.kind, label: n.label, props: n.props || {} });
  return [...out.entries()].map(([id, es]) => ({ type: "node", source: "node/" + id,
    data: { n: pick(byId.get(id)), out: es.map(e => ({ rel: e.rel, dst: pick(byId.get(e.dst)), why: e.props && e.props.direction ? "direction: " + e.props.direction : null })) } }));
}

export const MAPPERS = {
  node: (d, { node, edge }) => {
    const me = node(d.n.kind, d.n.label, d.n.props, d.n.id);
    for (const e of d.out) edge(me, e.rel, node(e.dst.kind, e.dst.label, e.dst.props, e.dst.id), e.why ? { why: e.why } : undefined);
  },
};

export const SPEC = {
  predict: [{ from: "programme", to: "programme" }],
  via_kinds: ["outcome", "author", "country"],  // a shared aim, research team or setting is evidence two programmes belong side by side
  bridge_kinds: ["author", "country"],
  max_hub: 12,  // an outcome most programmes target says nothing about any one pair
  gaps: [
    { id: "no-outcome", kind: "programme", need: { rel: "targets", dir: "out" }, weight: 0.6, text: n => `${n.label} is graded on an outcome the atlas has no concept for yet.` },
    { id: "no-country", kind: "programme", need: { rel: "in_country", dir: "out" }, weight: 0.4, text: n => `${n.label} names no country the atlas recognises.` },
  ],
  link_text: (a, b, via) => `${a} and ${b} are not compared anywhere, but share ${via.slice(0, 3).join("; ")}: worth reading side by side.`,
  bridge_text: (n, k) => `${n} ties ${k} otherwise separate parts of the atlas together.`,
  max_new_per_run: 5,
};

// Once an hour from the beat; a beat inside the hour is skipped.
export async function graphTick(db, snap, now = Date.now(), { every_min = 55 } = {}) {
  const last = await lastRun(db, TENANT);
  if (last && now - last.at < every_min * 60e3) return { skipped: true, last_at: last.at };
  return runKg(db, { tenant: TENANT, records: records(snap), mappers: MAPPERS, spec: SPEC, now });
}
export const graphHealth = (db, now = Date.now()) => kgHealth(db, TENANT, now);
// The atlas's older graph tables are renamed first, so a read that comes before the next beat never meets them.
export const graphApi = async (req, db, now = Date.now()) => { await renameLegacy(db); return handleKg(req, db, { tenant: TENANT, now }); };
