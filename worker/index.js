// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// What Works: a living atlas of what works in public policy. Every programme is graded by its trials (grade.js) and re-graded as evidence lands
// (evidence.js finds new trials, reader.js reads them in under a verbatim-quote guard). One Worker, one D1 database, one hourly cron, no secret.
// It runs with no model: without one, new publications are listed on the programme as unread leads and the curated grade stands.
// Year-long safeguards: ../runway.json. Tests: grade.test.mjs, worker.test.mjs.
import MODELS from "../vendor/ultrastable/models.json" with { type: "json" };
import { PROGRAMMES, AREAS, byId } from "./programmes.js";
import { currentGrade, moved, VERDICTS, DESIGNS, DIRECTIONS, GUESS } from "./grade.js";
import { checkProgrammes, freshness, EVIDENCE } from "./evidence.js";
import { READER, readerPrompt, checkReading } from "./reader.js";
import { home, areaPage, programmePage, rubricPage, changesPage, notFound, sitemap, jsonFeed } from "./site.js";
import { socialQueue } from "./promote.js";

export const LIMITS = { ai_calls_day: 60, taps_per_source_day: 300, beat_stale_ms: 2 * 3600000 };

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS checks (programme TEXT PRIMARY KEY, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS citations (key TEXT PRIMARY KEY, programme TEXT NOT NULL, doi TEXT, found_title TEXT, tried INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS leads (id INTEGER PRIMARY KEY AUTOINCREMENT, programme TEXT NOT NULL, ref TEXT NOT NULL, title TEXT, venue TEXT, year INTEGER, url TEXT, abstract TEXT, via TEXT, found INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'new', design TEXT, direction TEXT, finding TEXT, why TEXT, read_at INTEGER, UNIQUE(programme, ref))",
  "CREATE INDEX IF NOT EXISTS ix_leads_status ON leads(status)",
  "CREATE TABLE IF NOT EXISTS grades (programme TEXT PRIMARY KEY, verdict TEXT NOT NULL, strength TEXT NOT NULL, weight REAL NOT NULL, at INTEGER NOT NULL)",
  "CREATE TABLE IF NOT EXISTS grade_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, programme TEXT NOT NULL, at INTEGER NOT NULL, from_verdict TEXT, from_strength TEXT, to_verdict TEXT NOT NULL, to_strength TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ix_changes_at ON grade_changes(at)",
  "CREATE TABLE IF NOT EXISTS reader_counts (programme TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (programme, key))",
  "CREATE TABLE IF NOT EXISTS counters (day TEXT NOT NULL, key TEXT NOT NULL, n INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (day, key))",
  "CREATE TABLE IF NOT EXISTS beats (id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, started_at TEXT NOT NULL, report TEXT NOT NULL, error TEXT)"
];
const ready = new WeakMap();
async function ensure(db) { if (!ready.has(db)) ready.set(db, db.batch(SCHEMA.map(s => db.prepare(s))).catch(e => { ready.delete(db); throw e; })); return ready.get(db); }
const day = (ms = Date.now()) => new Date(ms).toISOString().slice(0, 10);
const J = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "access-control-allow-origin": "*" } });
const say = (code, message, s = 400) => J({ ok: false, code, message }, s);  // USER-BACKEND-1: plain words for the reader; detail stays in the log
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

// ---------- reading the evidence ----------
async function accepted(db) {
  const rows = (await db.prepare("SELECT id, programme, ref, title, venue, year, url, design, direction, finding, read_at FROM leads WHERE status='accepted' ORDER BY read_at").all()).results || [];
  const by = {}; for (const r of rows) (by[r.programme] = by[r.programme] || []).push({ ...r, study: r.ref, machine: true });
  return by;
}
export async function grades(db) {
  const acc = await accepted(db);
  return Object.fromEntries(PROGRAMMES.map(p => [p.id, currentGrade(p, acc[p.id] || [])]));
}
async function storedGrades(db) { return Object.fromEntries((((await db.prepare("SELECT programme, verdict, strength, weight, at FROM grades").all()).results) || []).map(r => [r.programme, r])); }

// A model call: daily cap, models in the platform's fallback order; any failure returns null and the loop moves on.
async function ask(env, db, messages, now) {
  if (!env.AI || env.AI_OFF === "1") return null;
  if ((await bump(db, "ai_calls", now)) > Number(env.AI_DAILY_CAP || LIMITS.ai_calls_day)) return null;
  for (const model of modelOrder()) {
    try {
      const r = await env.AI.run(model, { messages, max_tokens: 400 });
      return typeof r === "string" ? r : (r && (typeof r.response === "string" ? r.response : r.response ? JSON.stringify(r.response) : (r.choices && r.choices[0] && r.choices[0].message && r.choices[0].message.content))) || "";
    } catch (e) { await bump(db, "ai_error:" + model, now); console.error("what-works ai", model, e && e.message); }
  }
  return null;
}

export async function readLeads(env, db, now) {
  const out = { accepted: 0, unrelated: 0, rejected: 0 };
  const todo = (await db.prepare("SELECT id, programme, title, abstract FROM leads WHERE status='new' AND abstract IS NOT NULL ORDER BY found LIMIT ?1").bind(READER.per_beat).all()).results || [];
  for (const l of todo) {
    const p = byId[l.programme]; if (!p) continue;
    const text = await ask(env, db, readerPrompt(p, l), now); if (text === null) break;
    const c = checkReading(text, l.abstract);
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
    await db.prepare("INSERT INTO grade_changes (programme, at, from_verdict, from_strength, to_verdict, to_strength, kind, reason) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
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

export async function beat(env, now = Date.now()) {
  const db = env.DB; await ensure(db);
  const report = {}; let err = null;
  const f = evidenceFetch(env);
  if (f) {
    try { const ev = await checkProgrammes(db, now, f); report.search = { checked: ev.checked, resolved: ev.resolved, new_leads: ev.leads, errors: ev.errors.length }; for (const x of ev.errors) console.error("what-works evidence", x); }
    catch (e) { report.search = { error: String(e && e.message || e) }; console.error("what-works evidence", report.search.error); }
  }
  try { report.read = await readLeads(env, db, now); } catch (e) { report.read = { error: String(e && e.message || e) }; console.error("what-works reader", report.read.error); }
  try {
    report.regraded = await regrade(db, now);
    await db.prepare("DELETE FROM counters WHERE day < ?1").bind(day(now - 30 * 86400000)).run();
    await db.prepare("DELETE FROM beats WHERE at < ?1").bind(now - 90 * 86400000).run();
  } catch (e) { err = String(e && e.message || e); console.error("what-works beat", err); }
  await db.prepare("INSERT INTO beats (at, started_at, report, error) VALUES (?1, ?2, ?3, ?4)").bind(now, new Date(now).toISOString(), JSON.stringify(report), err).run();
  return { ok: !err, report, error: err };
}

// Second route for the clock: when the cron has been silent for two hours, the next visit runs the beat (CLOCKWORK-1).
export async function catchUp(env, ctx, now = Date.now()) {
  const last = await env.DB.prepare("SELECT at FROM beats ORDER BY id DESC LIMIT 1").first();
  if (halted(env) || (last && now - last.at < LIMITS.beat_stale_ms)) return false;
  const p = beat(env, now).then(r => { if (!r.ok) console.error("what-works catch-up beat failed", r.error); });
  if (ctx && ctx.waitUntil) ctx.waitUntil(p); else await p;
  return true;
}

// ---------- measures ----------
async function checkedMap(db) { return Object.fromEntries((((await db.prepare("SELECT programme, at FROM checks").all()).results) || []).map(r => [r.programme, r.at])); }

export async function health(env, now = Date.now()) {
  const db = env.DB; await ensure(db);
  const last = await db.prepare("SELECT at, error FROM beats ORDER BY id DESC LIMIT 1").first();
  const age = last ? Math.round((now - last.at) / 60000) : null;
  const clock = last === null ? "no beat yet" : age <= 90 ? "ticking" : age <= 180 ? "late" : "stopped";
  return { ok: clock !== "stopped" && !(last && last.error), service: "what-works", clock, last_beat_minutes_ago: age, last_error: last ? last.error : null, halted: halted(env),
    programmes: PROGRAMMES.length, areas: AREAS.length, evidence_loop: !!evidenceFetch(env), ai: { binding: !!env.AI, models: modelOrder() } };
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
  return { programmes: PROGRAMMES.length, areas: AREAS.length, trials_curated: trials, citations_resolved: (cit && cit.d) || 0, citations_resolved_share: trials ? ((cit && cit.d) || 0) / trials : 0,
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
  await ensure(db);
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
  if (p === "/") { await catchUp(env, ctx, now); return html(home({ grades: await grades(db), changes: await changes(db, 6), metrics: await metrics(db, now) })); }
  if (p.startsWith("/area/")) { const a = AREAS.find(x => x.id === p.slice(6)); return a ? html(areaPage(a, await grades(db))) : html(notFound(), 404); }
  if (p.startsWith("/p/")) {
    const prog = byId[p.slice(3)]; if (!prog) return html(notFound(), 404);
    const acc = (await accepted(db))[prog.id] || [];
    return html(programmePage(prog, (await grades(db))[prog.id], { citations: await citations(db, prog.id), leads: await leadsFor(db, prog.id), changes: await changes(db, 20, prog.id), accepted: acc }));
  }
  if (p === "/rubric") return html(rubricPage());
  if (p === "/changes") return html(changesPage(await changes(db, 100)));
  if (p === "/api/programmes" || p === "/api/programmes.json") { const g = await grades(db); return J({ ok: true, areas: AREAS, programmes: PROGRAMMES.map(x => programmeJson(x, g[x.id])) }); }
  if (p.startsWith("/api/programme/")) {
    const prog = byId[p.slice(15)]; if (!prog) return say("not_found", "There's no programme with that name.", 404);
    return J({ ok: true, ...programmeJson(prog, (await grades(db))[prog.id], { changes: await changes(db, 20, prog.id), new_evidence: await leadsFor(db, prog.id) }) });
  }
  if (p === "/api/changes") return J({ ok: true, changes: await changes(db, 100) });
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
