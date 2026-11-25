// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1 (Rowan, 2026-11-25): every Ultrastable system keeps a knowledge graph of all its data and reads insights out of it on its own.
// What Works' graph is built, not typed: every hourly beat derives it from the curated programmes (programmes.js), the trials read in by the
// evidence loop (leads accepted under the verbatim-quote guard) and the computed grades. Extraction is deterministic (a small controlled vocabulary
// for outcomes and places, author and venue names as published), so no model can invent a node. Every fact carries provenance.
// The platform's analytics (vendor/ultrastable/kgraph.js, from workers/core/kgraph/insight.js) keep it bitemporal (facts are retired, never deleted),
// and rank insights: programmes worth comparing, programmes that disagree on the same outcome, bridges between areas, and gaps in the atlas.
// Served at /graph.json (kg/1 contract, read by the platform's tick step) and /connections.
import { analyze, sync, track, VERSION } from "../vendor/ultrastable/kgraph.js";
import { PROGRAMMES, AREAS } from "./programmes.js";
import { DESIGNS, VERDICTS } from "./grade.js";
import { COUNTRIES, INCOME, STRUCTURE, EXECUTIVE, REGIONS, countriesOf } from "./countries.js";

export const SITE_URL = "https://what-works.ultrastable.org";
// Outcome concepts: what a programme is graded on, grouped so programmes in different areas that aim at the same thing meet in the graph.
export const OUTCOMES = {
  offending: { name: "Crime and offending", terms: ["offend", "crime", "criminal", "arrest", "justice", "delinquen"] },
  schooling: { name: "Schooling and learning", terms: ["school", "test score", "achievement", "enrol", "attendance", "learning", "readiness"] },
  income: { name: "Income and poverty", terms: ["income", "poverty", "earning", "consumption", "assets", "self-sufficiency", "welfare"] },
  health: { name: "Health and substance use", terms: ["health", "drug", "alcohol", "maltreatment"] },
  housing: { name: "Housing", terms: ["housing", "homeless"] },
  "life-course": { name: "Long-run life outcomes", terms: ["life outcome", "life course", "long-run", "later life", "adulthood"] },
  corruption: { name: "Corruption and leakage", terms: ["corrupt", "bribe", "leakage", "embezzle", "irregularit"] },
  services: { name: "Public service delivery", terms: ["service delivery", "absentee", "public service", "waiting time", "red tape"] },
  compliance: { name: "Compliance with law and regulation", terms: ["complian", "tax evasion", "enforcement", "violation", "inspection"] },
  justice: { name: "Access to justice and the courts", terms: ["court", "legal aid", "dispute", "judicial", "access to justice"] },
  participation: { name: "Political participation and elections", terms: ["turnout", "vote", "voting", "election", "electoral", "civic participation"] },
  representation: { name: "Representation and accountability", terms: ["accountab", "representation", "responsiveness", "politician"] },
  environment: { name: "Environment and energy use", terms: ["deforest", "emission", "pollution", "energy use", "electricity consumption"] },
};
const slug = s => String(s).toLowerCase().normalize("NFKD").replace(/[^\w\s-]/g, "").trim().replace(/\s+/g, "-").slice(0, 60);
export function outcomesOf(text) { const t = String(text || "").toLowerCase(); return Object.keys(OUTCOMES).filter(k => OUTCOMES[k].terms.some(w => t.includes(w))); }
// "Petrosino A, Turpin-Petrosino C" -> [{ id: 'author:petrosino-a', name: 'Petrosino A' }]
export function authorsOf(s) {
  return String(s || "").split(/,\s*|;\s*/).map(x => x.trim()).filter(x => x && !/^et al\.?$/i.test(x)).map(x => {
    const parts = x.split(/\s+/), init = parts.length > 1 && /^[A-Z]{1,3}$/.test(parts.at(-1)) ? parts.pop()[0] : "";
    return { id: "author:" + slug(parts.join(" ") + (init ? " " + init : "")), name: x };
  });
}

// Build the kg/1 snapshot. programmes: curated plus any the atlas found itself (pass the full list), so every programme joins the graph. grades: { programmeId: { verdict, strength } }; accepted: { programmeId: [lead rows read in by the evidence loop] }.
export function buildGraph(grades = {}, accepted = {}, now = Date.now(), programmes = PROGRAMMES) {
  const nodes = new Map(), edges = new Map(), at = new Date(now).toISOString().slice(0, 10);
  const node = (id, kind, label, props, prov) => { const o = nodes.get(id); if (o) { if (prov) o.provenance.push(prov); return; } nodes.set(id, { id, kind, label, props: props || {}, provenance: [prov] }); };
  const edge = (src, rel, dst, prov, props) => { const k = src + "|" + rel + "|" + dst; if (!edges.has(k)) edges.set(k, { src, rel, dst, ...(props ? { props } : {}), provenance: [prov] }); };
  for (const a of AREAS) node("area:" + a.id, "area", a.name, {}, { source: "curated", url: SITE_URL + "/area/" + a.id });
  for (const p of programmes) {
    const pid = "programme:" + p.id, page = { source: "curated", url: SITE_URL + "/p/" + p.id }, g = grades[p.id] || {};
    node(pid, "programme", p.name, { area: p.area, verdict: g.verdict || null, strength: g.strength || null, bucket: g.verdict ? VERDICTS[g.verdict].bucket : null, outcome: p.outcome }, page);
    edge(pid, "in_area", "area:" + p.area, page);
    for (const o of outcomesOf(p.outcome)) { node("outcome:" + o, "outcome", OUTCOMES[o].name, {}, { source: "vocabulary", url: SITE_URL + "/connections" }); edge(pid, "targets", "outcome:" + o, page); }
    // Settings: every country the programme was tried in, and through it the region, income group and form of government, so results meet across borders.
    const incomes = new Set();
    for (const k of countriesOf(p.where)) {
      const c = COUNTRIES[k], cid = "country:" + k, src = { source: "settings", url: SITE_URL + "/connections#settings" };
      node(cid, "country", c.name, { region: c.region, income: c.income, structure: c.structure, executive: c.executive }, src);
      edge(pid, "in_country", cid, page);
      const facet = (kind, key, names, rel) => { if (!key) return; node(kind + ":" + key, kind, names[key], {}, src); edge(cid, rel, kind + ":" + key, src); };
      facet("region", c.region, REGIONS, "in_region"); facet("income", c.income, INCOME, "income_group"); facet("structure", c.structure, STRUCTURE, "state_structure"); facet("executive", c.executive, EXECUTIVE, "executive");
      if (c.income) incomes.add(c.income);
    }
    for (const i of incomes) edge(pid, "tested_in", "income:" + i, page);  // derived from the countries above, kept so programmes in the same kind of setting meet directly
    const studies = [...p.trials.map(t => ({ ...t, sid: "study:" + t.study, prov: page })),
      ...(accepted[p.id] || []).map(l => ({ ...l, sid: "study:lead-" + slug(l.ref), prov: { source: "evidence-loop", url: l.url || page.url, at: l.read_at ? new Date(l.read_at).toISOString() : at } }))];
    for (const t of studies) {
      node(t.sid, "study", t.title || t.ref, { year: t.year || null, design: t.design || null, direction: t.direction || null, randomized: !!(DESIGNS[t.design] && DESIGNS[t.design].randomized) }, t.prov);
      edge(pid, "evaluated_by", t.sid, t.prov, { direction: t.direction || null });
      for (const au of authorsOf(t.authors)) { node(au.id, "author", au.name, {}, t.prov); edge(t.sid, "by", au.id, t.prov); }
      if (t.venue) { const vid = "venue:" + slug(t.venue); node(vid, "venue", t.venue, {}, t.prov); edge(t.sid, "published_in", vid, t.prov); }
    }
  }
  return { version: VERSION, system: "what-works", generated_at: new Date(now).toISOString(), nodes: [...nodes.values()], edges: [...edges.values()] };
}

const lab = n => n.label;
const INCOME_ORDER = ["low", "lower-middle", "upper-middle", "high"];
const SHORT = { low: "low", "lower-middle": "lower-middle", "upper-middle": "upper-middle", high: "high" };
const list = xs => xs.length < 2 ? xs.join("") : xs.slice(0, -1).join(", ") + " and " + xs.at(-1);
const incomeWords = keys => list(keys.map((k, i) => SHORT[k] + (i < keys.length - 1 ? "-" : "-income")));  // "low- and lower-middle-income"
// Income groups a programme was tested in, read from its own edges.
function settingsOf(snap) {
  const by = {};
  for (const e of snap.edges) if (e.rel === "tested_in") (by[e.src] = by[e.src] || new Set()).add(e.dst.slice(7));
  return id => INCOME_ORDER.filter(k => by[id] && by[id].has(k));
}
// Where the evidence comes from: programmes per outcome concept and income group.
export function coverage(snap) {
  const set = settingsOf(snap), rows = {};
  for (const e of snap.edges) if (e.rel === "targets") { const o = e.dst.slice(8), r = rows[o] = rows[o] || Object.fromEntries(INCOME_ORDER.map(k => [k, []])); for (const k of set(e.src)) r[k].push(e.src.slice(10)); }
  return Object.entries(rows).map(([o, r]) => ({ outcome: o, name: OUTCOMES[o].name, ...Object.fromEntries(INCOME_ORDER.map(k => [k, r[k]])) }));
}
// Lessons to carry across settings: a programme that works on an outcome in one kind of country, never tested in another kind where the same outcome
// is graded; and an outcome with no tested programme at all in an income group.
function crossSettings(snap, { node }) {
  const set = settingsOf(snap), out = [], targets = {};
  for (const e of snap.edges) if (e.rel === "targets") (targets[e.dst] = targets[e.dst] || []).push(e.src);
  for (const [o, ps] of Object.entries(targets)) {
    const seen = new Set(ps.flatMap(set)), oname = node.get(o).label.toLowerCase();
    for (const p of ps) {
      const n = node.get(p); if (n.props.bucket !== "works") continue;
      const mine = set(p), missing = INCOME_ORDER.filter(k => seen.has(k) && !mine.includes(k));
      if (!mine.length || !missing.length) continue;
      out.push({ type: "carry", nodes: [p, o, ...missing.map(k => "income:" + k)], score: 3 + missing.length,
        title: `${lab(n)} works on ${oname} in ${incomeWords(mine)} countries; no trial yet in ${incomeWords(missing)} countries, where the atlas grades other ${oname} programmes.`,
        why: `Tested in: ${mine.map(k => INCOME[k]).join(", ")}. The outcome is also graded in: ${missing.map(k => INCOME[k]).join(", ")}.`,
        prediction: `a trial of ${p} in a ${missing[0]} income country is read in within 180 d`, probe: `${p} has a tested_in edge to income:${missing[0]}` });
    }
    for (const k of INCOME_ORDER) if (!seen.has(k)) out.push({ type: "desert", nodes: [o, "income:" + k], score: 2,
      title: `No programme on ${oname} has been tested in ${incomeWords([k])} countries in the atlas yet.`, why: `Tested settings for ${oname}: ${[...seen].map(x => INCOME[x]).join(", ") || "none"}.`,
      prediction: `a programme on ${o} tested in a ${k} income country joins the atlas within 180 d`, probe: `a programme targeting ${o} has a tested_in edge to income:${k}` });
  }
  return out;
}
// The atlas's questions. A link is a lead for a reader or an editor, never a fact.
export const SPEC = {
  top: 60,
  links: [{ id: "compare", kinds: ["programme", "programme"], via: ["targets", "in_country", "tested_in"], top: 15,
    ask: (a, b) => `Compare ${lab(a)} with ${lab(b)}: both aim at the same outcome${a.props.area !== b.props.area ? ", from different areas" : ""}.` }],
  disagreements: [{ id: "split", kind: "programme", via: "targets", prop: "bucket", opposite: [["works", "harm"], ["works", "none"]],
    ask: (a, b, o) => { const [w, x] = a.props.bucket === "works" ? [a, b] : [b, a]; return `${lab(w)} works on ${o.label.toLowerCase()}; ${lab(x)} ${x.props.bucket === "harm" ? "backfires" : "does not"}. What differs?`; } }],
  gaps: [
    { id: "no-outcome", kind: "programme", lacks: { rel: "targets" }, ask: n => `${lab(n)} is graded on an outcome the atlas has no concept for yet.` },
    { id: "no-country", kind: "programme", lacks: { rel: "in_country" }, ask: n => `${lab(n)} names no country the atlas recognises.` },
    { id: "no-income", kind: "country", lacks: { rel: "income_group" }, ask: n => `${lab(n)} has no income group recorded.` },
    { id: "no-author", kind: "study", lacks: { rel: "by" }, ask: n => `"${lab(n)}" has no authors recorded.` },
  ],
  bridges: { top: 5, kinds: ["programme", "outcome", "author", "country"], ask: (n, b) => `${lab(n)} links ${b.communities} otherwise separate parts of the atlas.` },
  extra: crossSettings,
};

// D1 upkeep. Only facts that moved are written, so a quiet beat writes almost nothing.
export const GRAPH_SCHEMA = [
  "CREATE TABLE IF NOT EXISTS kg_facts (id TEXT PRIMARY KEY, hash TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, retired_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ww_kg_insights (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, gone_at TEXT)",
  "CREATE TABLE IF NOT EXISTS ww_kg_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, report TEXT NOT NULL)",
];
async function rows(db, sql) { return (await db.prepare(sql).all()).results || []; }
// The platform's graph engine (DATAGRAPH-1, datagraph.js) owns the names kg_insights and kg_runs in this D1. The atlas's own insight ledger and run
// log were created under those names first; they are renamed once, data kept. Only the atlas's own shape is renamed (kg_insights with gone_at,
// kg_runs with report), never the engine's tables.
const OWN_SHAPE = { kg_insights: "gone_at", kg_runs: "report" };
export async function renameLegacy(db) {
  for (const [t, mark] of Object.entries(OWN_SHAPE)) {
    const cols = (await rows(db, `PRAGMA table_info(${t})`)).map(c => c.name);
    if (cols.includes(mark) && !cols.includes("tenant")) await db.prepare(`ALTER TABLE ${t} RENAME TO ww_${t}`).run();
  }
}
async function writeAll(db, stmts) { for (let i = 0; i < stmts.length; i += 50) await db.batch(stmts.slice(i, i + 50)); }

export async function refreshGraph(db, snap, now = Date.now()) {
  await renameLegacy(db);
  await db.batch(GRAPH_SCHEMA.map(s => db.prepare(s)));
  const prevF = Object.fromEntries((await rows(db, "SELECT id, hash, first_seen, last_seen, retired_at FROM kg_facts")).map(r => [r.id, r]));
  const f = sync(prevF, snap, now), a = analyze(snap, SPEC, { now });
  const prevI = Object.fromEntries((await rows(db, "SELECT id, title, first_seen, last_seen, gone_at FROM ww_kg_insights")).map(r => [r.id, r]));
  const t = track(prevI, a.insights, now), types = Object.fromEntries(a.insights.map(i => [i.id, i.type]));
  const up = id => { const s = f.state[id]; return db.prepare("INSERT INTO kg_facts (id, hash, first_seen, last_seen, retired_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(id) DO UPDATE SET hash=excluded.hash, first_seen=excluded.first_seen, last_seen=excluded.last_seen, retired_at=excluded.retired_at").bind(id, s.hash, s.first_seen, s.last_seen, s.retired_at); };
  const ins = id => { const s = t.state[id]; return db.prepare("INSERT INTO ww_kg_insights (id, type, title, first_seen, last_seen, gone_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET title=excluded.title, last_seen=excluded.last_seen, gone_at=excluded.gone_at").bind(id, types[id] || prevI[id]?.type || "unknown", s.title, s.first_seen, s.last_seen, s.gone_at); };
  await writeAll(db, [...f.moved.added, ...f.moved.changed, ...f.moved.revived, ...f.moved.retired].map(up));
  await writeAll(db, [...t.moved.new, ...t.moved.gone].map(ins));
  const report = { nodes: a.stats.nodes, edges: a.stats.edges, communities: a.stats.communities, problems: a.problems.length, added: f.moved.added.length, changed: f.moved.changed.length,
    retired: f.moved.retired.length, revived: f.moved.revived.length, insights: a.insights.length, insights_new: t.moved.new.length, insights_gone: t.moved.gone.length };
  await db.prepare("INSERT INTO ww_kg_runs (at, report) VALUES (?1, ?2)").bind(new Date(now).toISOString(), JSON.stringify(report)).run();
  await db.prepare("DELETE FROM ww_kg_runs WHERE at < ?1").bind(new Date(now - 90 * 86400000).toISOString()).run();
  return report;
}

// The public reading: the snapshot with each fact's first-seen date, the analysis and the insight ledger.
export async function readGraph(db, snap, now = Date.now()) {
  await renameLegacy(db);
  await db.batch(GRAPH_SCHEMA.map(s => db.prepare(s)));
  const seen = Object.fromEntries((await rows(db, "SELECT id, first_seen FROM kg_facts WHERE retired_at IS NULL")).map(r => [r.id, r.first_seen]));
  const led = Object.fromEntries((await rows(db, "SELECT id, first_seen FROM ww_kg_insights WHERE gone_at IS NULL")).map(r => [r.id, r.first_seen]));
  const last = await db.prepare("SELECT at, report FROM ww_kg_runs ORDER BY id DESC LIMIT 1").first();
  const retired = await db.prepare("SELECT COUNT(*) n FROM kg_facts WHERE retired_at IS NOT NULL").first();
  const a = analyze(snap, SPEC, { now });
  return { ...snap, nodes: snap.nodes.map(n => ({ ...n, first_seen: seen["n:" + n.id] || null })),
    edges: snap.edges.map(e => ({ ...e, first_seen: seen["e:" + e.src + "|" + e.rel + "|" + e.dst] || null })),
    analysis: { ...a, insights: a.insights.map(i => ({ ...i, first_seen: led[i.id] || null })) }, coverage: coverage(snap),
    upkeep: { last_run: last ? last.at : null, last_report: last ? JSON.parse(last.report) : null, retired_facts: (retired && retired.n) || 0 } };
}
