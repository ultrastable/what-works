// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// What Works end to end on an in-memory SQLite standing in for D1: beat, search, read-in, re-grade, pages, guess, measures, clock, halt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import worker, { handle, beat, health, metrics, modelOrder } from './index.js';
import { PROGRAMMES } from './programmes.js';
import { EVIDENCE } from './evidence.js';

function d1() {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const env = (extra = {}) => ({ DB: d1(), ...extra });
const get = p => new Request('https://w.test' + p);
const post = (p, b, ip = '1.2.3.4') => new Request('https://w.test' + p, { method: 'POST', headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: JSON.stringify(b) });
const DAY = 864e5, T0 = Date.UTC(2026, 11, 1);

const ABSTRACT = 'We report a randomized controlled trial of a school-based cognitive behavioral programme for adolescent boys. Boys assigned to the programme had fewer violent-crime arrests than the control group during the programme year.';
// A fake network: Crossref answers with the cited title; OpenAlex returns one new trial for Becoming a Man; Europe PMC is down.
function net({ crossrefDown = false } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (url.includes('crossref')) {
      if (crossrefDown) return new Response('down', { status: 503 });
      const q = decodeURIComponent(url.split('query.bibliographic=')[1]);
      const t = PROGRAMMES.flatMap(p => p.trials).find(x => q.startsWith(x.title));
      return Response.json({ message: { items: t ? [{ DOI: '10.1/' + t.study, title: [t.title], issued: { 'date-parts': [[t.year]] } }] : [] } });
    }
    if (url.includes('openalex')) {
      const bam = decodeURIComponent(url).includes('Becoming a Man');
      return Response.json({ results: bam ? [{ id: 'https://openalex.org/W1', doi: 'https://doi.org/10.9/bam2', title: 'A replication of a CBT programme for adolescent boys', publication_year: 2026,
        primary_location: { source: { display_name: 'Journal of Replications' } }, abstract_inverted_index: Object.fromEntries([...new Set(ABSTRACT.split(' '))].map(w => [w, ABSTRACT.split(' ').flatMap((x, i) => x === w ? [i] : [])])) }] : [] });
    }
    if (url.includes('europepmc')) return new Response('down', { status: 503 });
    return new Response('?', { status: 404 });
  };
  f.calls = calls; return f;
}
const AI = { async run() { return { response: JSON.stringify({ relevant: true, design: 'rct', direction: 'positive', design_quote: 'a randomized controlled trial of a school-based cognitive behavioral programme',
  direction_quote: 'Boys assigned to the programme had fewer violent-crime arrests than the control group during the programme year.' }) }; } };

test('the first beat grades every programme and logs it with a reason', async () => {
  const e = env(); const b = await beat(e, T0); assert.equal(b.ok, true);
  assert.equal(b.report.regraded.length, PROGRAMMES.length);
  const rows = e.DB.raw.prepare("SELECT kind, reason FROM grade_changes").all();
  assert.ok(rows.every(r => r.kind === 'first' && /^First graded from \d+ trials?\.$/.test(r.reason)));
  assert.equal((await beat(e, T0 + 3600e3)).report.regraded.length, 0, 'nothing moved, nothing logged');
});

test('new evidence lands: found by search, read in under the guard, the grade moves up and the move names the study', async () => {
  const e = env({ AI }); let t = T0;
  await beat(e, t);  // first grading before any search, so the new trial arrives as a re-grade
  e.FETCH = net();
  for (let i = 0; i < PROGRAMMES.length; i++) { t += 3600e3; await beat(e, t); }
  const lead = e.DB.raw.prepare("SELECT status, design, direction, finding, via FROM leads WHERE programme='becoming-a-man'").get();
  assert.equal(lead.status, 'accepted'); assert.equal(lead.via, 'openalex'); assert.match(lead.finding, /^Boys assigned/);
  const ch = e.DB.raw.prepare("SELECT from_verdict, to_verdict, kind, reason FROM grade_changes WHERE programme='becoming-a-man' AND kind != 'first'").get();
  assert.equal(ch.from_verdict, 'promising'); assert.equal(ch.to_verdict, 'works'); assert.equal(ch.kind, 'up');
  assert.match(ch.reason, /A replication of a CBT programme/);
  const m = await metrics(e.DB, t);
  assert.equal(m.programmes_fresh, PROGRAMMES.length, 'every programme checked though Europe PMC was down (second route)');
  assert.ok(m.citations_resolved > 0); assert.equal(m.regrades_30d, 1);
  const page = await (await handle(get('/p/becoming-a-man'), e, t)).text();
  assert.match(page, /Read in by the loop, half weight/); assert.match(page, /promising|Promising/); assert.match(page, /Works/);
  const fr = await handle(get('/api/freshness'), e, t); assert.equal(fr.status, 200);
});

test('with no model, new publications wait as unread leads and the grade stands', async () => {
  const e = env({ FETCH: net() }); let t = T0;
  for (let i = 0; i <= PROGRAMMES.length; i++) { await beat(e, t); t += 3600e3; }
  assert.equal(e.DB.raw.prepare("SELECT status FROM leads WHERE programme='becoming-a-man'").get().status, 'new');
  const j = await (await handle(get('/api/programme/becoming-a-man'), e, t)).json();
  assert.equal(j.grade.verdict, 'promising'); assert.equal(j.new_evidence.length, 1);
  assert.match(await (await handle(get('/p/becoming-a-man'), e, t)).text(), /not yet read in/);
});

test('a search failure is logged and retried: the programme is picked first next time, and freshness reports it', async () => {
  const e = env({ FETCH: async () => new Response('down', { status: 503 }) });
  const b = await beat(e, T0); assert.equal(b.ok, true); assert.ok(b.report.search.errors > 0); assert.deepEqual(b.report.search.checked, []);
  const fr = await handle(get('/api/freshness'), e, T0); assert.equal(fr.status, 503);
  assert.equal((await fr.json()).stale.length, PROGRAMMES.length);
  assert.ok(EVIDENCE.batch * 24 * EVIDENCE.recheck_days >= PROGRAMMES.length, 'the batch covers every programme inside the freshness window');
});

test('pages render from code: home, area, programme, rubric, changes, feed, sitemap, 404', async () => {
  const e = env(); await beat(e, T0);
  const h = await (await handle(get('/'), e, T0)).text();
  assert.match(h, /What works in public policy/); assert.match(h, /Guess the verdict/); assert.match(h, /runs on Ultrastable/);
  assert.match(await (await handle(get('/area/crime'), e, T0)).text(), /Hot spots policing/);
  const p = await (await handle(get('/p/scared-straight'), e, T0)).text();
  assert.match(p, /Backfires/); assert.match(p, /data-g="harm"/); assert.match(p, /Petrosino/);
  const r = await (await handle(get('/rubric'), e, T0)).text(); assert.match(r, /Randomized controlled trial/); assert.match(r, /70%/);
  assert.match(await (await handle(get('/changes'), e, T0)).text(), /First graded/);
  const feed = await (await handle(get('/feed.json'), e, T0)).json(); assert.equal(feed.items.length, PROGRAMMES.length);
  assert.match(await (await handle(get('/sitemap.xml'), e, T0)).text(), /\/p\/housing-first/);
  assert.equal((await handle(get('/p/nope'), e, T0)).status, 404);
  assert.equal((await handle(get('/api/nope'), e, T0)).status, 404);
});

test('a guess is counted anonymously, answered against the current grade, and capped per source', async () => {
  const e = env();
  const right = await (await handle(post('/api/guess', { programme: 'scared-straight', guess: 'harm' }), e, T0)).json();
  assert.equal(right.ok, true); assert.equal(right.right, true); assert.equal(right.counts.harm, 1);
  const wrong = await (await handle(post('/api/guess', { programme: 'scared-straight', guess: 'works' }), e, T0)).json();
  assert.equal(wrong.right, false); assert.equal(wrong.verdict_name, 'Backfires');
  assert.equal((await handle(post('/api/guess', { programme: 'scared-straight', guess: 'maybe' }), e, T0)).status, 400);
  assert.equal((await metrics(e.DB, T0)).surprise_share, 0.5);
  assert.ok(!JSON.stringify(e.DB.raw.prepare('SELECT * FROM counters').all()).includes('1.2.3.4'), 'the address is never stored');
});

test('health reads the clock; a silent cron is caught up by the next visit; HALT stops writes but reading goes on', async () => {
  const e = env();
  let h = await health(e, T0); assert.equal(h.clock, 'no beat yet');
  await handle(get('/'), e, T0);  // the visit runs the beat
  h = await health(e, T0 + 60e3); assert.equal(h.clock, 'ticking'); assert.equal(h.ok, true);
  h = await health(e, T0 + 5 * 3600e3); assert.equal(h.clock, 'stopped'); assert.equal(h.ok, false);
  assert.equal((await handle(get('/health'), e, T0 + 5 * 3600e3)).status, 503);
  const hal = env({ HALT: '1' });
  assert.equal((await handle(post('/api/guess', { programme: 'dare', guess: 'none' }), hal, T0)).status, 503);
  assert.equal((await handle(get('/p/dare'), hal, T0)).status, 200);
  assert.equal(await handle(get('/'), hal, T0).then(() => hal.DB.raw.prepare('SELECT COUNT(*) n FROM beats').get().n), 0, 'HALT: no catch-up beat');
  let ran = false; await worker.scheduled({}, { ...hal }, { waitUntil() { ran = true; } }); assert.equal(ran, false);
});

test('a model that fails falls through to the next, and the daily AI cap holds', async () => {
  let calls = 0; const order = modelOrder();
  const flaky = { async run(model) { calls++; if (model === order[0]) throw new Error('5028 model retired'); return AI.run(); } };
  const e = env({ FETCH: net(), AI: flaky, AI_DAILY_CAP: '1' }); let t = T0;
  for (let i = 0; i <= PROGRAMMES.length; i++) { await beat(e, t); t += 3600e3; }
  if (order.length > 1) assert.equal(e.DB.raw.prepare("SELECT status FROM leads WHERE programme='becoming-a-man'").get().status, 'accepted');
  assert.ok(calls <= 2 * (PROGRAMMES.length + 1));
});

test('the social queue asks readers to guess and never states the verdict', async () => {
  const e = env(); const q = await (await handle(get('/social-queue.json'), e, Date.UTC(2026, 11, 3))).json();
  assert.ok(q.posts.length > 0);
  for (const p of q.posts) { assert.match(p.text, /Guess first/); assert.match(p.text, /What Works runs on Ultrastable\./); assert.doesNotMatch(p.text, /Backfires|No effect|Works\b(?! runs)/); }
});

// ---------- failure modes found on the live launch (2026-11-25) ----------
import { claim } from './index.js';
import { anchors, openAlexSearch, crossrefLeads, checkProgrammes } from './evidence.js';

test('overlapping beats: only one runs, so a first grade is logged once (launch race: Housing First logged three times)', async () => {
  const e = env();
  const [a, b, c] = await Promise.all([beat(e, T0), beat(e, T0), beat(e, T0)]);
  assert.equal([a, b, c].filter(x => !x.skipped).length, 1);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM grade_changes").get().n, PROGRAMMES.length);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM beats").get().n, 1);
  assert.equal(await claim(e.DB, 'beat', T0, 600e3), true, 'the lock is released after the beat');
});

test('a stale lock is taken over, a live one is not', async () => {
  const e = env(); await beat(e, T0);
  assert.equal(await claim(e.DB, 'x', T0, 600e3), true);
  assert.equal(await claim(e.DB, 'x', T0 + 60e3, 600e3), false);
  assert.equal(await claim(e.DB, 'x', T0 + 601e3, 600e3), true);
});

test('a second first grade cannot be written, and a database that already holds duplicates is repaired when it opens (ONE-FIRST-1)', async () => {
  const e = env(); await beat(e, T0);
  assert.throws(() => e.DB.raw.prepare("INSERT INTO grade_changes (programme, at, to_verdict, to_strength, kind, reason) VALUES ('housing-first', ?, 'works', 'strong', 'first', 'dup')").run(T0), /UNIQUE/);
  // An older database: the table without the index, three first grades for one programme (the launch race)
  const old = env();
  old.DB.raw.exec("CREATE TABLE grade_changes (id INTEGER PRIMARY KEY AUTOINCREMENT, programme TEXT NOT NULL, at INTEGER NOT NULL, from_verdict TEXT, from_strength TEXT, to_verdict TEXT NOT NULL, to_strength TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL)");
  for (let i = 0; i < 3; i++) old.DB.raw.prepare("INSERT INTO grade_changes (programme, at, to_verdict, to_strength, kind, reason) VALUES ('housing-first', ?, 'works', 'strong', 'first', 'race')").run(T0 + i);
  await beat(old, T0 + 3600e3);
  assert.equal(old.DB.raw.prepare("SELECT COUNT(*) n FROM grade_changes WHERE programme='housing-first' AND kind='first'").get().n, 1);
  assert.equal(old.DB.raw.prepare("SELECT at FROM grade_changes WHERE programme='housing-first' AND kind='first'").get().at, T0, 'the earliest is kept');
});

test('index queries are anchored on the programme name, never a bare OR tail that matches anything', () => {
  assert.deepEqual(anchors('"Housing First" randomized homeless housing stability'), ['Housing First']);
  assert.deepEqual(anchors('microcredit OR microfinance randomized household income poverty'), ['microcredit', 'microfinance']);
  assert.deepEqual(anchors('deworming school children randomized attendance OR cognition'), ['deworming']);
  for (const p of PROGRAMMES) { const q = openAlexSearch(p); assert.match(q, /^\(".+"\) AND \(/); assert.ok(anchors(p.query).length > 0, p.id); }
});

test('a source answering 429 or 503 is rested and the loop is kept checked by the next route (Crossref)', async () => {
  const e = env(); await beat(e, T0);
  const calls = [];
  e.FETCH = async (url) => {
    calls.push(url);
    if (url.includes('openalex')) return new Response('slow down', { status: 429 });
    if (url.includes('europepmc')) return new Response('down', { status: 503 });
    if (url.includes('filter=from-pub-date')) return Response.json({ message: { items: [{ DOI: '10.5/x', title: ['Housing First for homeless adults: a randomized trial follow-up'], issued: { 'date-parts': [[2026]] } }] } });
    return Response.json({ message: { items: [] } });
  };
  const b = await beat(e, T0 + 3600e3);
  assert.equal(b.report.search.checked.length, 3, 'checked through Crossref alone');
  assert.match(b.report.search.sources.openalex, /rested after 429/); assert.match(b.report.search.sources.europepmc, /rested after 503/);
  assert.equal(calls.filter(u => u.includes('openalex')).length, 1, 'a refusing source is asked once, not once per programme');
  const h = await health(e, T0 + 3600e3 + 60e3);
  assert.equal(h.evidence.ok, true); assert.deepEqual(h.evidence.cooled.sort(), ['europepmc', 'openalex']);
  assert.ok(b.report.search.error_samples.length > 0, 'the error text is kept in the beat report, not only in the log');
});

test('health says plainly when no index has answered for six hours', async () => {
  const e = env({ FETCH: async () => new Response('down', { status: 503 }) }); let t = T0;
  for (let i = 0; i < 3; i++) { await beat(e, t); t += 3600e3 + 1; }
  const h = await health(e, t); assert.equal(h.evidence.ok, false); assert.equal(h.evidence.programmes_checked_6h, 0);
});

test('a short budget stops the beat between programmes instead of being cancelled mid-write', async () => {
  const e = env(); await beat(e, T0);
  const r = await checkProgrammes(e.DB, T0, net(), undefined, { deadline: Date.now() - 1 });
  assert.equal(r.checked.length, 0); assert.match(r.errors[0], /^deadline/);
});

test('crossrefLeads keeps only finds that name the programme', async () => {
  const p = PROGRAMMES.find(x => x.id === 'housing-first');
  const f = async () => Response.json({ message: { items: [{ DOI: '10.1/a', title: ['Housing First and tenancy'] }, { DOI: '10.1/b', title: ['Unrelated nowcasting survey'] }] } });
  const l = await crossrefLeads(p, '2026-01-01', f); assert.equal(l.length, 1); assert.equal(l[0].via, 'crossref');
});
