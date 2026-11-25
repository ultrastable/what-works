// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// What Works: a living atlas of what works in public policy. Every programme is graded by its trials (grade.js) and re-graded as evidence lands
// (evidence.js finds new trials, reader.js reads them in under a verbatim-quote guard). One Worker, one D1 database, one hourly cron, no secret.
// It runs with no model: without one, new publications are listed on the programme as unread leads and the curated grade stands.
// Year-long safeguards: ../runway.json. Tests: grade.test.mjs, worker.test.mjs.
import MODELS from "../vendor/ultrastable/models.json" with { type: "json" };
import { PROGRAMMES, AREAS, byId, syncFound } from "./programmes.js";
import { DISCOVER, SKIP_TITLE, routesFor, anyDesignFor, discoverPrompt, checkDiscovery, matchProgramme, slugOf, abstractByDoi } from "./discover.js";
import { currentGrade, moved, VERDICTS, DESIGNS, DIRECTIONS, GUESS } from "./grade.js";
import { checkProgrammes, freshness, EVIDENCE, SOURCES } from "./evidence.js";
import { READER, readerPrompt, checkReading } from "./reader.js";
import { worldPage, home, areaPage, programmePage, rubricPage, changesPage, connectionsPage, notFound, sitemap, jsonFeed } from "./site.js";
import { socialQueue } from "./promote.js";
import { contractRoute } from "../vendor/ultrastable/contract.js";
import { SPEC } from "./contract.js";
import { settingsReport, programmeSettings } from "./learn.js";
import { buildGraph, refreshGraph, readGraph } from "./graph.js";
import * as dg from "./datagraph.js";
import { claimReview, catalog, provChanges, openapi } from "./linked.js";  // STANDARDS-1: schema.org, DCAT, PROV-O, OpenAPI  // DATAGRAPH-1: the platform's one graph engine (core/datagraph)

export const LIMITS = { ai_calls_day: 60, taps_per_source_day: 300, beat_stale_ms: 2 * 3600000, beat_lock_ms: 10 * 60000, visit_budget_ms: 20000, cron_budget_ms: 10 * 60000 };

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS checks (programme TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS citations (key TEXT PRIMARY KEY, programme TEXT NOT NULL, doi TEXT, found_title TEXT, tried INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, programme TEXT NOT NULL, ref TEXT NOT NULL, title TEXT, venue TEXT, year INTEGER, url TEXT, abstract TEXT, via TEXT, found INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', design TEXT, direction TEXT, finding TEXT, why TEXT, read_at INTEGER, UNIQUE(programme, ref))",
  "CREATE INDEX IF NOT EXISTS ix_leads_status ON leads(status)",
  "CREATE TABLE IF NOT EXISTS grades (programme TEXT PRIMARY KEY, verdict TEXT NOT NULL, strength TEXT NOT NULL, weight REAL NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS grade_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, programme TEXT NOT NULL, at INTEGER NOT NULL, from_verdict TEXT, from_strength TEXT, to_verdict TEXT NOT NULL, to_strength TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ix_changes_at ON grade_changes(at)",
  // ONE-FIRST-1: a programme is first graded once. Overlapping launch beats logged some first grades three times; the lock stopped the race,
  // and this index makes a second "first" row impossible whatever runs (the DELETE before it keeps the earliest, so the index always builds).
  "DELETE FROM grade_changes WHERE kind='first' AND id NOT IN (SELECT MIN(id) FROM grade_changes WHERE kind='first' GROUP BY programme)",
  "CREATE UNIQUE INDEX IF NOT EXISTS ux_changes_first ON grade_changes(programme) WHERE kind='first'",
  "CREATE TABLE IF NOT EXISTS reader_counts (programme TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (programme, key))",
  "CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key))",
  "CREATE TABLE IF NOT EXISTS beats (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, started_at TEXT NOT NULL, report TEXT NOT NULL, error TEXT)",
  "CREATE TABLE IF NOT EXISTS locks (name TEXT PRIMARY KEY, until INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS kv (key TEXT PRIMARY KEY, v TEXT NOT NULL)",
  "CREATE TABLE IF NOT EXISTS candidates (ref TEXT PRIMARY KEY, title TEXT NOT NULL, abstract TEXT, year INTEGER, venue TEXT, url TEXT, via TEXT, found INTEGER NOT NULL, status TEXT NOT NULL, why TEXT, programme TEXT, read_at INTEGER)",
  "CREATE INDEX IF NOT EXISTS ix_candidates_status ON candidates(status)",
  "CREATE TABLE IF NOT EXISTS found_programmes (id TEXT PRIMARY KEY, name TEXT NOT NULL, area TEXT NOT NULL, what TEXT NOT NULL, outcome TEXT NOT NULL, place TEXT, ref TEXT NOT NULL UNIQUE, url TEXT, added_at INTEGER NOT NULL)"
];
const ready = new WeakMap();
async function ensure(db) { if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { ready.delete(db); throw e; })); return ready.get(db); }
const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
const LD = o => new Response(JSON.stringify(o), { headers: { "content-type": "application/ld+json; charset=utf-8", "cache-control": "public, max-age=900", "access-control-allow-origin": "*" } });
const say = (code, message, s = 400) => J({ ok: false, code, message }, s);  // USER-BACKEND-1: plain words for the reader; detail stays in the log
// Kinds anyone may read record by record in the graph: the atlas (public on every page) and its grading history. Operational tables (leads, checks,
// counters, locks) show only as counts.
const GRAPH_PUBLIC_KINDS = ["programme", "area", "outcome", "country", "region", "income", "structure", "executive", "study", "author", "venue", "grades", "grade_changes", "citations"];
export function halted(env) { const v = String((env && env.HALT) || "").trim().toLowerCase(); return v === "1" || v === "true" || v === "on"; }
export function modelOrder() { const avail = new Set(MODELS.available || []); return (MODELS.fallback_order || []).filter(m => avail.has(m)); }

async function bump(db, key, ms = Date.now()) {
  const r = await db.prepare("INSERT INTO counters (day, key, n) VALUES (?1, ?2, 1) ON CONFLICT(day, key) DO UPDATE SET n = n + 1 RETURNING n").bind(day(ms), key).first();
  return r ? r.n : 0;
}
async function sourceKey(req, ms) {  // a daily one-way key per source: the address itself is never stored
  const ip = req.headers.get("cf-connecting-ip") || "unknown";
  const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ip + "|" + day(ms)));
  return "src:" + [...new Uint8Array(h)].slice(0, 8).map(b => b.toString(16).padStart(2, "0")).join("");
}

// ---------- growing the atlas (STATIC-IS-NOT-AUTONOMOUS-1) ----------
export async function syncProgrammes(db) {
  return syncFound((await db.prepare("SELECT id, name, area, what, outcome, place, ref, url, added_at FROM found_programmes ORDER BY added_at, id").all()).results || []);
}
const kvGet = async (db, k) => { const r = await db.prepare("SELECT v FROM kv WHERE key=?1").bind(k).first(); return r ? r.v : null; };
const kvSet = (db, k, v) => db.prepare("INSERT INTO kv (key, v) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET v=excluded.v").bind(k, String(v)).run();

// Fetch the next page of systematic reviews per journal (Crossref first, OpenAlex second); at most one pass per DISCOVER.every_ms.
export async function discoverFetch(db, now, fetchFn) {
  const last = Number(await kvGet(db, "discover:last_try") || 0);
  if (now - last < DISCOVER.every_ms) return { skipped: "not due" };
  await kvSet(db, "discover:last_try", now);
  const out = { new: 0, routes: {}, errors: [] };
  const turn = Number(await kvGet(db, "discover:turn") || 0);
  for (const j of routesFor(turn)) {
    // journals and prefixes keep their original offset keys ("discover:offset:<issn>"), so a deploy does not re-read what was read
    const okey = "discover:offset:" + (j.key.startsWith("issn:") ? j.key.slice(5) : j.key);
    const off = Number(await kvGet(db, okey) || 0);
    let page = null;
    for (const [name, mk] of j.routes) {
      try { page = await mk(off)(fetchFn); out.routes[j.key.replace(/^issn:/, "")] = name; break; } catch (e) { out.errors.push(j.key + " " + name + ": " + (e && e.message)); }
    }
    if (!page) continue;
    for (const r of page.reviews) {
      if (!r.title || r.ref === "doi:") continue;
      const status = SKIP_TITLE.test(r.title) ? "skipped" : r.abstract ? "new" : "no-abstract";
      const res = await db.prepare("INSERT INTO candidates (ref, title, abstract, year, venue, url, via, found, status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) ON CONFLICT(ref) DO UPDATE SET abstract=excluded.abstract, status='new' WHERE candidates.status='no-abstract' AND excluded.abstract IS NOT NULL")
        .bind(r.ref, r.title, r.abstract, r.year, r.venue || j.name, r.url, r.via + "@" + j.key, now, status).run();
      if (status === "new" && res.meta && res.meta.changes) out.new++;
    }
    if (page.n) await kvSet(db, okey, off + page.n);
    await kvSet(db, "discover:last_ok", now);
  }
  await kvSet(db, "discover:turn", turn + 1);
  return out;
}

// Fill missing abstracts by DOI (OpenAlex, then Europe PMC); a review no route can give an abstract for is set aside after two tries, with its reason.
export async function enrichAbstracts(db, now, fetchFn, n = DISCOVER.reads_per_beat) {
  const out = { filled: 0, missing: 0 };
  const rows = (await db.prepare("SELECT ref, why FROM candidates WHERE status='no-abstract' AND ref LIKE 'doi:%' ORDER BY found, ref LIMIT ?1").bind(n).all()).results || [];
  for (const c of rows) {
    const a = await abstractByDoi(c.ref.slice(4), fetchFn);
    if (a.abstract) { await db.prepare("UPDATE candidates SET abstract=?1, status='new', why=?2 WHERE ref=?3").bind(a.abstract, "abstract from " + a.via, c.ref).run(); out.filled++; continue; }
    const tries = /^tried (\d+)/.exec(c.why || ""), k = (tries ? Number(tries[1]) : 0) + 1;
    await db.prepare("UPDATE candidates SET status=?1, why=?2 WHERE ref=?3").bind(k >= 2 ? "no-abstract-anywhere" : "no-abstract", `tried ${k}: ` + (a.errors || []).join("; ").slice(0, 200), c.ref).run(); out.missing++;
  }
  return out;
}

// Label the next candidate reviews; an accepted one joins its programme or creates a new one. Returns what it did.
export async function discoverRead(env, db, now) {
  const out = { added: [], attached: 0, unrelated: 0, rejected: 0 };
  const todo = (await db.prepare("SELECT ref, title, abstract, year, venue, url, via, why FROM candidates WHERE status='new' ORDER BY found, ref LIMIT ?1").bind(DISCOVER.reads_per_beat).all()).results || [];
  for (const c of todo) {
    const text = await ask(env, db, discoverPrompt(c), now); if (text === null) break;
    const d = checkDiscovery(text, c, { anyDesign: anyDesignFor(c) });
    if (unreadable(d.why)) {
      const r = retryOrReject(c.why); await bump(db, "read:unreadable", now); out.unreadable = (out.unreadable || 0) + 1;
      await db.prepare("UPDATE candidates SET status=?1, why=?2 WHERE ref=?3").bind(r.status, r.why, c.ref).run(); continue;
    }
    await bump(db, "read:ok", now);
    let status = d.status, programme = null;
    if (d.status === "accepted") {
      const hit = matchProgramme(d.programme);
      if (hit) { programme = hit.id; status = "attached"; out.attached++; }
      else {
        let id = slugOf(d.programme); for (let i = 2; byId[id]; i++) id = slugOf(d.programme) + "-" + i;
        const name = d.programme.charAt(0).toUpperCase() + d.programme.slice(1);
        await db.prepare("INSERT OR IGNORE INTO found_programmes (id, name, area, what, outcome, place, ref, url, added_at) VALUES (?1,?2,?3,?4,?5,NULL,?6,?7,?8)")
          .bind(id, name, d.area, c.title, d.outcome, c.ref, c.url, now).run();
        await syncProgrammes(db);
        programme = id; status = "added"; out.added.push(id);
      }
      await db.prepare("INSERT OR IGNORE INTO leads (programme, ref, title, venue, year, url, abstract, via, found, status, design, direction, finding, read_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'accepted',?10,?11,?12,?9)")
        .bind(programme, c.ref, c.title, c.venue, c.year, c.url, c.abstract, "discovery:" + c.via, now, d.design, d.direction, d.finding).run();
    } else out[d.status === "unrelated" ? "unrelated" : "rejected"]++;
    await db.prepare("UPDATE candidates SET status=?1, why=?2, programme=?3, read_at=?4 WHERE ref=?5").bind(status, d.why || null, programme, now, c.ref).run();
  }
  return out;
}

export const DISCOVER_STALL_MS = 48 * 3600000;
export async function discoveryHealth(env, db, now = Date.now()) {
  const lastOk = Number(await kvGet(db, "discover:last_ok") || 0);
  const by = Object.fromEntries((((await db.prepare("SELECT status, COUNT(*) n FROM candidates GROUP BY status").all()).results) || []).map(r => [r.status, r.n]));
  const found = await db.prepare("SELECT COUNT(*) n, MAX(added_at) last FROM found_programmes").first();
  const beats = await db.prepare("SELECT COUNT(*) n FROM beats").first();
  const live = !!evidenceFetch(env);
  // STATIC-IS-NOT-AUTONOMOUS-1: answering sources are not growth. With a model bound, a candidate left unread for STALL_MS means the reading
  // half has stopped and the atlas is static again, whatever the clock says.
  const oldest = await db.prepare("SELECT MIN(found) t FROM candidates WHERE status='new'").first();
  const stalled = !!(env.AI && oldest && oldest.t && now - oldest.t > DISCOVER_STALL_MS);
  return { ok: (!live || !(beats && beats.n) || (lastOk > 0 && now - lastOk < DISCOVER.stale_ms)) && !stalled, reading_stalled: stalled,
    oldest_unread_hours: oldest && oldest.t ? Math.round((now - oldest.t) / 3600000) : null, last_answer_hours: lastOk ? Math.round((now - lastOk) / 3600000) : null,
    candidates: by, programmes_found: (found && found.n) || 0, last_added: found && found.last ? new Date(found.last).toISOString() : null, unread_without_model: !env.AI ? (by.new || 0) : 0 };
}

// ---------- reading the evidence ----------
async function accepted(db) {
  const rows = (await db.prepare("SELECT id, programme, ref, title, venue, year, url, abstract, design, direction, finding, read_at FROM leads WHERE status='accepted' ORDER BY read_at").all()).results || [];
  const by = {}; for (const r of rows) (by[r.programme] = by[r.programme] || []).push({ ...r, study: r.ref, machine: true });
  return by;
}
export async function snapshot(db, now = Date.now()) { return buildGraph(await grades(db), await accepted(db), now); }
export async function grades(db) {
  const acc = await accepted(db);
  return Object.fromEntries(PROGRAMMES.map(p => [p.id, currentGrade(p, acc[p.id] || [])]));
}
async function storedGrades(db) { return Object.fromEntries((((await db.prepare("SELECT programme, verdict, strength, weight, at FROM grades").all()).results) || []).map(r => [r.programme, r])); }

// A reasoning model (gpt-oss) spends tokens thinking before it answers: give it room and ask it to think briefly.
export const MODEL_TOKENS = { max_tokens: 1500, reasoning_effort: "low" };
export function modelInput(model, messages) {
  return /gpt-oss/.test(model) ? { messages, max_tokens: MODEL_TOKENS.max_tokens, reasoning_effort: MODEL_TOKENS.reasoning_effort } : { messages, max_tokens: 600 };
}
export function replyText(r) {
  if (typeof r === "string") return r;
  if (!r) return "";
  if (typeof r.response === "string") return r.response;
  if (r.response && typeof r.response === "object") return JSON.stringify(r.response);
  const c = r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content;
  if (typeof c === "string") return c;
  const out = Array.isArray(r.output) ? r.output.flatMap(o => (o && o.content) || []).filter(x => x && typeof x.text === "string").map(x => x.text).join("") : "";
  return out || "";
}
// A reply no guard can read is the model's failure, not the study's: the item stays queued and is retried, and is set aside only after
// UNREADABLE_TRIES attempts (the reason names the tries). Each reading is counted per day (read:ok, read:unreadable) for /health.
export const UNREADABLE_TRIES = 3;
export function unreadable(why) { return why === "not JSON" || /^model reply unreadable/.test(why || ""); }
function retryOrReject(prev) {
  const m = /^model reply unreadable \((\d+)\)/.exec(prev || ""), k = (m ? Number(m[1]) : 0) + 1;
  return { status: k >= UNREADABLE_TRIES ? "rejected" : "new", why: `model reply unreadable (${k})` };
}

// A model call: daily cap, models in the platform's fallback order; any failure returns null and the loop moves on.
async function ask(env, db, messages, now) {
  if (!env.AI || env.AI_OFF === "1") return null;
  if ((await bump(db, "ai_calls", now)) > Number(env.AI_DAILY_CAP || LIMITS.ai_calls_day)) return null;
  for (const model of modelOrder()) {
    try {
      const r = await env.AI.run(model, modelInput(model, messages));
      const text = replyText(r);
      // MODEL-REPLY-1: an empty reply is a failed call, not an answer. On launch gpt-oss spent its whole 400-token cap reasoning and returned no
      // content; every reading was logged "not JSON" and nothing was ever read in. Fall through to the next model instead.
      if (text.trim()) return text;
      await bump(db, "ai_empty:" + model, now); console.error("what-works ai", model, "empty reply", r && r.choices && r.choices[0] && r.choices[0].finish_reason);
    } catch (e) { await bump(db, "ai_error:" + model, now); console.error("what-works ai", model, e && e.message); }
  }
  await bump(db, "ask:failed", now);  // every model failed or answered empty: counted, so /health sees a reading half that reads nothing
  return null;
}

export async function readLeads(env, db, now) {
  const out = { accepted: 0, unrelated: 0, rejected: 0 };
  const todo = (await db.prepare("SELECT id, programme, title, abstract, why FROM leads WHERE status='new' AND abstract IS NOT NULL ORDER BY found LIMIT ?1").bind(READER.per_beat).all()).results || [];
  for (const l of todo) {
    const p = byId[l.programme]; if (!p) continue;
    const text = await ask(env, db, readerPrompt(p, l), now); if (text === null) break;
    let c = checkReading(text, l.abstract);
    if (unreadable(c.why)) { c = { ...retryOrReject(l.why) }; await bump(db, "read:unreadable", now); out.unreadable = (out.unreadable || 0) + 1; }
    else await bump(db, "read:ok", now);
    if (c.status === "new") { await db.prepare("UPDATE leads SET why=?1 WHERE id=?2").bind(c.why, l.id).run(); continue; }
    await db.prepare("UPDATE leads SET status=?1, design=?2, direction=?3, finding=?4, why=?5, read_at=?6 WHERE id=?7")
      .bind(c.status, c.design || null, c.direction || null, c.finding || null, c.why || null, now, l.id).run();
    out[c.status]++;
  }
  return out;
}

// Recompute every grade; log each move with the trial that moved it.
export async function regrade(db, now) {
  const acc = await accepted(db), prev = await storedGrades(db), changes = [];
  for (const p of PROGRAMMES) {
    const g = currentGrade(p, acc[p.id] || []), was = prev[p.id], m = moved(was, g);
    if (!m.moved) continue;
    let reason;
    if (m.kind === "first") reason = `First graded from ${g.trials} ${g.trials === 1 ? "trial" : "trials"}.`;
    else {
      const fresh = (acc[p.id] || []).filter(a => a.read_at > was.at);
      reason = fresh.length ? "New evidence read in: " + fresh.map(a => `${a.title} (${DESIGNS[a.design].short}, ${DIRECTIONS[a.direction].name.toLowerCase()})`).join("; ") + "."
        : "The rubric or the curated trials changed.";
    }
    await db.prepare("INSERT INTO grades (programme, verdict, strength, weight, at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(programme) DO UPDATE SET verdict=excluded.verdict, strength=excluded.strength, weight=excluded.weight, at=excluded.at")
      .bind(p.id, g.verdict, g.strength, g.weight, now).run();
    await db.prepare("INSERT OR IGNORE INTO grade_changes (programme, at, from_verdict, from_strength, to_verdict, to_strength, kind, reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
      .bind(p.id, now, was ? was.verdict : null, was ? was.strength : null, g.verdict, g.strength, m.kind, reason).run();
    changes.push({ programme: p.id, kind: m.kind, to: g.verdict });
  }
  return changes;
}

function evidenceFetch(env) {
  if (env.FETCH) return env.FETCH;
  if (env.EVIDENCE_OFF === "1") return null;
  return typeof navigator !== "undefined" && navigator.userAgent === "Cloudflare-Workers" ? fetch : null;
}

// One beat at a time: a lock row claimed atomically. On launch every visit saw "no beat yet" and started its own beat; the overlapping beats
// logged each first grade up to three times and burst the indexes into 429 and 503. A lock older than beat_lock_ms is stale and is taken over.
export async function claim(db, name, now, ms) {
  const r = await db.prepare("INSERT INTO locks (name, until) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET until=excluded.until WHERE locks.until <= ?3 RETURNING name")
    .bind(name, now + ms, now).first();
  return !!r;
}
const release = (db, name) => db.prepare("UPDATE locks SET until=0 WHERE name=?1").bind(name).run();
async function cooledSources(db, now) {
  const rows = (await db.prepare("SELECT name FROM locks WHERE name LIKE 'cool:%' AND until > ?1").bind(now).all()).results || [];
  return rows.map(r => r.name.slice(5));
}

export async function beat(env, now = Date.now(), opts = {}) {
  const db = env.DB; await ensure(db);
  if (!(await claim(db, "beat", now, LIMITS.beat_lock_ms))) return { ok: true, skipped: "another beat is running", report: {}, error: null };
  try { return await beatLocked(env, db, now, opts); } finally { await release(db, "beat").catch(e => console.error("what-works release", e && e.message)); }
}

async function beatLocked(env, db, now, opts) {
  const report = {}; let err = null;
  await syncProgrammes(db);
  const f = evidenceFetch(env), deadline = Date.now() + (opts.budget_ms || LIMITS.cron_budget_ms);
  // Growth first: find and read in new programmes, then search for new evidence on every programme the atlas now holds.
  if (f) { try { report.discover = await discoverFetch(db, now, f); for (const x of report.discover.errors || []) console.error("what-works discover", x); }
    catch (e) { report.discover = { error: String(e && e.message || e) }; console.error("what-works discover", report.discover.error); } }
  if (f) { try { report.abstracts = await enrichAbstracts(db, now, f); } catch (e) { report.abstracts = { error: String(e && e.message || e) }; console.error("what-works abstracts", report.abstracts.error); } }
  try { report.grow = Date.now() > deadline ? { skipped: "time budget spent" } : await discoverRead(env, db, now); }
  catch (e) { report.grow = { error: String(e && e.message || e) }; console.error("what-works grow", report.grow.error); }
  if (f) {
    try {
      const ev = await checkProgrammes(db, now, f, undefined, { openalex_key: env.OPENALEX_API_KEY, mailto: env.EVIDENCE_MAILTO, deadline, cooled: await cooledSources(db, now),
        onCool: (src) => db.prepare("INSERT INTO locks (name, until) VALUES (?1, ?2) ON CONFLICT(name) DO UPDATE SET until=excluded.until").bind("cool:" + src, now + EVIDENCE.cool_minutes * 60000).run() });
      report.search = { checked: ev.checked, resolved: ev.resolved, new_leads: ev.leads, errors: ev.errors.length, too_broad: ev.errors.filter(x => / too broad /.test(x)).length,
        sources: ev.sources, error_samples: ev.errors.slice(0, 6) };
      for (const x of ev.errors) console.error("what-works evidence", x);
    }
    catch (e) { report.search = { error: String(e && e.message || e) }; console.error("what-works evidence", report.search.error); }
  }
  try { report.read = Date.now() > deadline ? { skipped: "time budget spent" } : await readLeads(env, db, now); } catch (e) { report.read = { error: String(e && e.message || e) }; console.error("what-works reader", report.read.error); }
  try {
    report.regraded = await regrade(db, now);
    // Repair (MODEL-REPLY-1): readings logged "not JSON" were the model's empty replies, not the studies' fault; queue them again once.
    // The new code never writes "not JSON", so this is a no-op once clean.
    for (const t of ["leads", "candidates"]) {
      const r = await db.prepare(`UPDATE ${t} SET status='new', why='model reply unreadable (1)' WHERE status='rejected' AND why='not JSON'`).run();
      if (r.meta && r.meta.changes) report["requeued_unreadable_" + t] = r.meta.changes;
    }
    await db.prepare("DELETE FROM counters WHERE day < ?1").bind(day(now - 30 * 86400000)).run();
    await db.prepare("DELETE FROM beats WHERE at < ?1").bind(now - 90 * 86400000).run();
  } catch (e) { err = String(e && e.message || e); console.error("what-works beat", err); }
  // KGRAPH-1: rebuild the knowledge graph from what the beat just settled. A failure is logged in the report and never stops the beat.
  try {
    const snap = await snapshot(db, now);
    report.graph = await refreshGraph(db, snap, now);
    // DATAGRAPH-1: every D1 table plus the atlas's records in the platform's engine, at most every 6 h; served at /api/graph*
    const atlas = dg.atlasTables(snap);
    const k = await dg.datagraphStep({ db, config: { knowledge_graph: { declared: atlas.declared } }, extra: atlas.tables, now });
    report.kg = k.status ? { status: k.status } : { nodes: k.nodes, edges: k.edges, components: k.components, insights: k.insights, changes: k.changes, read_errors: k.read_errors };
  } catch (e) { report.graph = { error: String(e && e.message || e) }; console.error("what-works graph", report.graph.error); }
  await db.prepare("INSERT INTO beats (at, started_at, report, error) VALUES (?1, ?2, ?3, ?4)").bind(now, new Date(now).toISOString(), JSON.stringify(report), err).run();
  return { ok: !err, report, error: err };
}

// Second route for the clock: when the cron has been silent for two hours, the next visit runs the beat (CLOCKWORK-1).
export async function catchUp(env, ctx, now = Date.now()) {
  const last = await env.DB.prepare("SELECT at FROM beats ORDER BY id DESC LIMIT 1").first();
  if (halted(env) || (last && now - last.at < LIMITS.beat_stale_ms)) return false;
  // A visit's waitUntil lives about 30 s, so the catch-up beat runs on a short budget (the launch beats were cancelled mid-flight).
  const p = beat(env, now, { budget_ms: LIMITS.visit_budget_ms }).then(r => { if (!r.ok) console.error("what-works catch-up beat failed", r.error); });
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  return true;
}

// ---------- measures ----------
async function checkedMap(db) { return Object.fromEntries((((await db.prepare("SELECT programme, at FROM checks").all()).results) || []).map(r => [r.programme, r.at])); }

export async function health(env, now = Date.now()) {
  const db = env.DB; await ensure(db); await syncProgrammes(db);
  const last = await db.prepare("SELECT at, error FROM beats ORDER BY id DESC LIMIT 1").first();
  const age = last ? Math.round((now - last.at) / 60000) : null;
  const clock = last === null ? "no beat yet" : age <= 90 ? "ticking" : age <= 180 ? "late" : "stopped";
  const parts = { evidence: await evidenceHealth(db, now), discovery: await discoveryHealth(env, db, now), reader: await readerHealth(env, db, now), citations: await citationHealth(db, now) };
  // WORK-NOT-PULSE-1: a ticking clock is not a working loop. On launch /health said "ticking" while every source call failed and every model
  // reply was unreadable. ok is the clock AND every part of the loop that reports on its own output; `working` names the parts that are not.
  const failing = Object.entries(parts).filter(([, v]) => v && v.ok === false).map(([k]) => k);
  const clockOk = clock !== "stopped" && !(last && last.error);
  return { ok: clockOk && failing.length === 0, service: "what-works", clock, working: failing.length ? "not working: " + failing.join(", ") : clock === "no beat yet" ? "not yet measured" : "working",
    failing, last_beat_minutes_ago: age, last_error: last ? last.error : null, halted: halted(env),
    programmes: PROGRAMMES.length, areas: AREAS.length, evidence_loop: !!evidenceFetch(env), ...parts, ai: { binding: !!env.AI, models: modelOrder() } };
}

// Is the model half of the loop producing readings? Counted per reading (read:ok, read:unreadable) over the last 24 h. With a model bound and
// at least READER_MIN readings, ok is false when half or more came back unreadable: the loop is spending calls and reading nothing in.
export const READER_MIN = 4;
export async function readerHealth(env, db, now = Date.now()) {
  const rows = (await db.prepare("SELECT key, SUM(n) n FROM counters WHERE day IN (?1, ?2) AND (key IN ('read:ok', 'read:unreadable', 'ask:failed') OR key LIKE 'ai_empty:%' OR key LIKE 'ai_error:%') GROUP BY key")
    .bind(day(now), day(now - 86400000)).all()).results || [];
  const c = Object.fromEntries(rows.map(r => [r.key, r.n])), ok_ = c["read:ok"] || 0, bad = (c["read:unreadable"] || 0) + (c["ask:failed"] || 0), n = ok_ + bad;
  const empty = rows.filter(r => r.key.startsWith("ai_empty:")).reduce((a, r) => a + r.n, 0), errors = rows.filter(r => r.key.startsWith("ai_error:")).reduce((a, r) => a + r.n, 0);
  return { ok: !env.AI || n < READER_MIN || bad / n < 0.5, readings_48h: n, unreadable_48h: c["read:unreadable"] || 0, no_answer_48h: c["ask:failed"] || 0, unreadable_share: n ? Math.round(bad / n * 100) / 100 : null, empty_replies_48h: empty, model_errors_48h: errors };
}

// CITE-VERIFIED-1: every curated trial must resolve to a DOI in Crossref with a matching title and year. The atlas launched with citations that
// had never been checked. A trial tried and not matched is a failing part until it matches, is corrected, or is marked `unindexed` with a
// reason in programmes.js (a report Crossref does not hold); a trial not yet tried is pending, not failing.
export async function citationHealth(db, now = Date.now()) {
  const rows = Object.fromEntries((((await db.prepare("SELECT key, doi, tried FROM citations").all()).results) || []).map(r => [r.key, r]));
  let verified = 0, pending = 0, exempt = 0; const unmatched = [];
  for (const p of PROGRAMMES.filter(p => !p.found)) p.trials.forEach((t, i) => {
    const r = rows[p.id + "#" + i];
    if (t.unindexed) exempt++; else if (r && r.doi) verified++; else if (r) unmatched.push(p.id + "#" + i); else pending++;
  });
  const total = verified + pending + exempt + unmatched.length;
  return { ok: unmatched.length === 0, curated: total, verified, pending, unindexed: exempt, unmatched, verified_share: total ? Math.round(verified / total * 100) / 100 : null };
}

// Is the search half of the loop reaching any index? Read from the last beats' own reports. Liveness (ok) stays the clock's; this is the
// failure signal the platform's detector reads (doctrine/detectors.json what-works-evidence), with /api/freshness as the outcome measure.
export async function evidenceHealth(db, now = Date.now()) {
  const rows = (await db.prepare("SELECT report FROM beats WHERE at >= ?1 ORDER BY id DESC LIMIT 6").bind(now - 6 * 3600000).all()).results || [];
  let checked = 0, errors = 0, beats = 0, broad = 0; const sources = {};
  for (const r of rows) { let j; try { j = JSON.parse(r.report); } catch { continue; } const s = j.search; if (!s || s.error) { if (s) errors++; continue; }
    beats++; checked += (s.checked || []).length; errors += s.errors || 0; broad += s.too_broad || 0; for (const [k, v] of Object.entries(s.sources || {})) if (!sources[k]) sources[k] = v; }
  const fresh = freshness(await checkedMap(db), now);
  return { ok: (beats === 0 || checked > 0) && broad === 0, beats_6h: beats, too_broad_6h: broad, programmes_checked_6h: checked, errors_6h: errors, sources, cooled: await cooledSources(db, now),
    fresh_share: fresh.checked / fresh.programmes, configured: SOURCES.map(x => x[0]) };
}

export async function metrics(db, now = Date.now()) {
  const fresh = freshness(await checkedMap(db), now);
  const trials = PROGRAMMES.reduce((n, p) => n + p.trials.length, 0);
  const cit = await db.prepare("SELECT SUM(CASE WHEN doi IS NOT NULL THEN 1 ELSE 0 END) d FROM citations").first();
  const leads = Object.fromEntries((((await db.prepare("SELECT status, COUNT(*) n FROM leads GROUP BY status").all()).results) || []).map(r => [r.status, r.n]));
  const ch = await db.prepare("SELECT COUNT(*) n FROM grade_changes WHERE kind != 'first' AND at >= ?1").bind(now - 30 * 86400000).first();
  const g = await grades(db);
  let guesses = 0, wrong = 0;
  for (const r of ((await db.prepare("SELECT programme, key, n FROM reader_counts WHERE key LIKE 'guess:%'").all()).results || [])) {
    if (!g[r.programme]) continue; guesses += r.n; if (r.key.slice(6) !== VERDICTS[g[r.programme].verdict].bucket) wrong += r.n;
  }
  const verdicts = {}; for (const x of Object.values(g)) verdicts[x.verdict] = (verdicts[x.verdict] || 0) + 1;
  const found = await db.prepare("SELECT COUNT(*) n FROM found_programmes").first();
  return { programmes: PROGRAMMES.length, programmes_found: (found && found.n) || 0, areas: AREAS.length, trials_curated: trials, citations_resolved: (cit && cit.d) || 0, citations_resolved_share: trials ? ((cit && cit.d) || 0) / trials : 0,
    programmes_fresh: fresh.checked, evidence_fresh_share: fresh.checked / fresh.programmes, leads, regrades_30d: (ch && ch.n) || 0, verdicts,
    guesses, surprise_share: guesses ? wrong / guesses : null, measured_at: new Date(now).toISOString() };
}

async function changes(db, limit = 50, programme = null) {
  const q = programme ? db.prepare("SELECT * FROM grade_changes WHERE programme=?1 ORDER BY at DESC, id DESC LIMIT ?2").bind(programme, limit)
    : db.prepare("SELECT * FROM grade_changes ORDER BY at DESC, id DESC LIMIT ?1").bind(limit);
  return (await q.all()).results || [];
}
async function citations(db, programme) {
  const rows = (await db.prepare("SELECT key, doi FROM citations WHERE programme=?1").bind(programme).all()).results || [];
  return Object.fromEntries(rows.map(r => [Number(r.key.split("#")[1]), r]));
}
async function leadsFor(db, programme) {
  return (await db.prepare("SELECT id, ref, title, venue, year, url, status, design, direction, finding, found FROM leads WHERE programme=?1 AND status IN ('new','accepted','rejected') ORDER BY found DESC LIMIT 20").bind(programme).all()).results || [];
}
async function guessCounts(db, programme) {
  const rows = (await db.prepare("SELECT key, n FROM reader_counts WHERE programme=?1 AND key LIKE 'guess:%'").bind(programme).all()).results || [];
  return Object.fromEntries(rows.map(r => [r.key.slice(6), r.n]));
}
export function programmeJson(p, g, extra = {}) {
  return { id: p.id, name: p.name, area: p.area, what: p.what, outcome: p.outcome, where: p.where,
    grade: { verdict: g.verdict, verdict_name: VERDICTS[g.verdict].name, strength: g.strength, weight: g.weight, shares: g.shares, experiments: g.experiments, replicated: g.replicated, basis: g.basis },
    trials: p.trials.map(t => ({ title: t.title, authors: t.authors, year: t.year, venue: t.venue, design: t.design, direction: t.direction, finding: t.finding })), ...extra };
}

async function body(req) { try { return await req.json(); } catch { return null; } }

export async function handle(req, env, now = Date.now(), ctx = null) {
  const u = new URL(req.url), db = env.DB;
  if (req.method === "OPTIONS") return new Response(null, { headers: { "access-control-allow-origin": "*", "access-control-allow-methods": "GET,POST", "access-control-allow-headers": "content-type" } });
  await ensure(db); await syncProgrammes(db);
  const p = u.pathname.replace(/\/+$/, "") || "/";
  const html = (h, s = 200) => new Response(h, { status: s, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "public, max-age=300" } });
  if (p === "/health") { const h = await health(env, now); return J(h, h.ok ? 200 : 503); }
  if (p === "/pulse/watch" && req.method === "POST") return J({ ok: true, ran: await catchUp(env, null, now) });  // RESILIENCE-1 restart route
  if (req.method === "POST" && p === "/api/guess") {
    if (halted(env)) return say("paused", "The atlas is paused for maintenance. Reading still works.", 503);
    const b = await body(req); const prog = b && byId[b.programme];
    if (!prog || !GUESS.some(x => x.id === b.guess)) return say("bad_guess", "Pick one of the answers first.");
    if ((await bump(db, (await sourceKey(req, now)) + ":tap", now)) > LIMITS.taps_per_source_day) return say("too_many", "That's a lot of guessing for one day. Try again tomorrow.", 429);
    await db.prepare("INSERT INTO reader_counts (programme, key, n) VALUES (?1, ?2, 1) ON CONFLICT(programme, key) DO UPDATE SET n = n + 1").bind(prog.id, "guess:" + b.guess).run();
    const g = (await grades(db))[prog.id];
    return J({ ok: true, right: VERDICTS[g.verdict].bucket === b.guess, verdict: g.verdict, verdict_name: VERDICTS[g.verdict].name, counts: await guessCounts(db, prog.id) });
  }
  if (req.method !== "GET" && req.method !== "HEAD") return say("method", "That doesn't work here.", 405);
  const contract = contractRoute(p, SPEC);  // FLEET-CONTRACT-1: /.well-known/ultrastable.json and /claims.json
  if (contract) return contract;
  if (p === "/") { await catchUp(env, ctx, now); return html(home({ grades: await grades(db), changes: await changes(db, 6), metrics: await metrics(db, now) })); }
  if (p.startsWith("/area/")) { const a = AREAS.find(x => x.id === p.slice(6)); return a ? html(areaPage(a, await grades(db))) : html(notFound(), 404); }
  if (p.startsWith("/p/")) {
    const prog = byId[p.slice(3)]; if (!prog) return html(notFound(), 404);
    const acc = (await accepted(db))[prog.id] || [];
    const g = (await grades(db))[prog.id], cites = await citations(db, prog.id), ch = await changes(db, 20, prog.id), settings = programmeSettings(prog, acc);
    return html(programmePage(prog, g, { citations: cites, leads: await leadsFor(db, prog.id), changes: ch, accepted: acc, settings, ld: claimReview(prog, g, { citations: cites, settings, changes: ch }) }));
  }
  if (p === "/rubric") return html(rubricPage());
  if (p === "/world") return html(worldPage(settingsReport(PROGRAMMES, await grades(db), await accepted(db))));
  if (p === "/api/settings") return J({ ok: true, ...settingsReport(PROGRAMMES, await grades(db), await accepted(db)) });
  if (p === "/changes") return html(changesPage(await changes(db, 100)));
  if (p === "/connections") return html(connectionsPage(await readGraph(db, await snapshot(db, now), now)));
  if (p.startsWith("/api/graph")) {  // DATAGRAPH-1 read side, public view: counts, findings and records of the kinds below (the atlas is public; operational tables are not)
    const v = { open: false, publicKinds: GRAPH_PUBLIC_KINDS }, q = u.searchParams;
    if (p === "/api/graph") return J(await dg.readGraph(db, v));
    if (p === "/api/graph/insights") return J(await dg.readInsights(db, v));
    if (p === "/api/graph/search") return J(await dg.searchGraph(db, q.get("q"), v));
    if (p === "/api/graph/node") { const n = await dg.readNode(db, String(q.get("id") || ""), { ...v, depth: q.get("depth") === "2" ? 2 : 1 }); return n ? J(n) : say("not_found", "No record with that id is in the public graph.", 404); }
    return say("not_found", "Graph routes: /api/graph, /api/graph/insights, /api/graph/node?id=, /api/graph/search?q=.", 404);
  }
  if (p === "/graph.json") return J(await readGraph(db, await snapshot(db, now), now));
  if (p === "/api/programmes" || p === "/api/programmes.json") { const g = await grades(db); return J({ ok: true, areas: AREAS, programmes: PROGRAMMES.map(x => programmeJson(x, g[x.id])) }); }
  if (p.startsWith("/api/programme/")) {
    const prog = byId[p.slice(15)]; if (!prog) return say("not_found", "There's no programme with that name.", 404);
    return J({ ok: true, ...programmeJson(prog, (await grades(db))[prog.id], { changes: await changes(db, 20, prog.id), new_evidence: await leadsFor(db, prog.id) }) });
  }
  if (p === "/api/changes") return J({ ok: true, changes: await changes(db, 100) });
  if (p === "/api/changes.jsonld") return LD(provChanges(await changes(db, 100)));
  if (p === "/api/catalog") return LD(catalog(now));
  if (p === "/openapi.json") return new Response(JSON.stringify(openapi()), { headers: { "content-type": "application/openapi+json; charset=utf-8", "cache-control": "public, max-age=3600", "access-control-allow-origin": "*" } });
  if (p === "/api/metrics") return J({ ok: true, ...(await metrics(db, now)) });
  if (p === "/api/freshness") { const f = freshness(await checkedMap(db), now); return J(f, f.ok ? 200 : 503); }
  if (p === "/feed.json") return new Response(JSON.stringify(jsonFeed(await grades(db), await changes(db, 50))), { headers: { "content-type": "application/feed+json; charset=utf-8", "cache-control": "public, max-age=900" } });
  if (p === "/social-queue.json") return J(socialQueue(await grades(db), now));
  if (p === "/sitemap.xml") return new Response(sitemap(), { headers: { "content-type": "application/xml; charset=utf-8" } });
  if (p === "/robots.txt") return new Response("User-agent: *\nAllow: /\nSitemap: https://what-works.ultrastable.org/sitemap.xml\n", { headers: { "content-type": "text/plain" } });
  if (!p.startsWith("/api/")) return html(notFound(), 404);
  return say("not_found", "There's nothing here.", 404);
}

export default {
  async fetch(req, env, ctx) {
    try { return await handle(req, env, Date.now(), ctx); }
    catch (e) { console.error("what-works fetch", e && e.stack || e); return say("error", "Something went wrong on our side. It has been logged; please try again in a minute.", 500); }
  },
  async scheduled(event, env, ctx) { if (halted(env)) return; ctx.waitUntil(beat(env).then(r => { if (!r.ok) console.error("what-works beat failed", r.error); })); }
};
