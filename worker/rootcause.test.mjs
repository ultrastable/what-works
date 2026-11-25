// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Root-cause guards for the failures of launch day (2026-11-25), one test per failure. Each test reproduces the failure as it happened and
// proves the code now prevents it or reports it in /health, so the platform's tenant-health detector files it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { beat, health, handle, modelInput, replyText, UNREADABLE_TRIES, READER_MIN, DISCOVER_STALL_MS } from './index.js';
import { PROGRAMMES } from './programmes.js';
import { EVIDENCE, openAlexLeads, europePmcLeads, checkProgrammes } from './evidence.js';

function d1() {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const T0 = Date.UTC(2026, 11, 1), H = 3600e3;
const ABS = 'We report a randomized controlled trial of a school-based cognitive behavioral programme for adolescent boys. Boys assigned to the programme had fewer violent-crime arrests than the control group during the programme year.';
const quiet = async () => Response.json({ results: [], meta: { count: 3 }, message: { items: [] }, hitCount: 0, resultList: { result: [] } });
const seedLead = (raw, n = 1) => { for (let i = 0; i < n; i++) raw.prepare("INSERT INTO leads (programme, ref, title, abstract, via, found, status) VALUES ('becoming-a-man', ?, 'A CBT trial', ?, 'openalex', ?, 'new')").run('doi:10.9/x' + i, ABS, T0); };
// gpt-oss as seen on launch day: the whole token cap spent reasoning, content null, finish_reason "length"
const lengthOut = { choices: [{ finish_reason: 'length', message: { content: null, reasoning: '...' } }] };
const good = { choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ relevant: true, design: 'rct', direction: 'positive',
  design_quote: 'a randomized controlled trial of a school-based cognitive behavioral programme',
  direction_quote: 'Boys assigned to the programme had fewer violent-crime arrests than the control group during the programme year.' }) } }] };

test('MODEL-REPLY-1: a reasoning model gets room to think, and an empty reply falls through to the next model', async () => {
  const gpt = modelInput('@cf/openai/gpt-oss-120b', []);
  assert.ok(gpt.max_tokens >= 1200, 'launch used 400, all of it spent reasoning'); assert.equal(gpt.reasoning_effort, 'low');
  assert.equal(modelInput('@cf/meta/llama-3.3-70b-instruct-fp8-fast', []).reasoning_effort, undefined);
  assert.equal(replyText(lengthOut), ''); assert.match(replyText(good), /relevant/);
  assert.equal(replyText({ output: [{ type: 'message', content: [{ type: 'output_text', text: '{"a":1}' }] }] }), '{"a":1}');
  const seen = [], AI = { async run(model) { seen.push(model); return seen.length === 1 ? lengthOut : good; } };
  const e = { DB: d1(), AI }; await beat(e, T0); seedLead(e.DB.raw);
  await beat(e, T0 + 2 * H);
  assert.ok(seen.length >= 2, 'the empty first answer was not taken as the answer');
  assert.equal(e.DB.raw.prepare("SELECT status FROM leads").get().status, 'accepted');
});

test('MODEL-REPLY-1: an unreadable reply is the model\'s failure: the lead is retried, set aside only after the tries, and /health says so', async () => {
  const AI = { async run() { return { response: 'I think this study is relevant.' }; } };   // an answer no guard can read
  const e = { DB: d1(), AI }; await beat(e, T0); seedLead(e.DB.raw, 1);
  for (let i = 1; i < UNREADABLE_TRIES; i++) {
    await beat(e, T0 + i * 2 * H);
    assert.equal(e.DB.raw.prepare("SELECT status FROM leads").get().status, 'new', 'still queued after try ' + i);
  }
  await beat(e, T0 + UNREADABLE_TRIES * 2 * H);
  const row = e.DB.raw.prepare("SELECT status, why FROM leads").get();
  assert.equal(row.status, 'rejected'); assert.equal(row.why, `model reply unreadable (${UNREADABLE_TRIES})`);
  // every model answering empty, every time (launch day): no reading reaches the guard, the lead stays queued, and /health is not ok
  const z = { DB: d1(), AI: { async run() { return lengthOut; } } }; await beat(z, T0); seedLead(z.DB.raw, READER_MIN);
  for (let i = 1; i <= READER_MIN; i++) await beat(z, T0 + i * 2 * H);
  assert.ok(z.DB.raw.prepare("SELECT status FROM leads").all().every(r => r.status === 'new'));
  const hz = await health(z, T0 + READER_MIN * 2 * H + 60e3); assert.equal(hz.reader.ok, false); assert.ok(hz.reader.no_answer_48h >= READER_MIN);
  // all model calls came back empty, so no reading was counted unreadable: the readings never reached the guard. Count readings that did:
  const g = { DB: d1(), AI: { async run() { return { response: 'I think this study is relevant.' }; } } }; await beat(g, T0); seedLead(g.DB.raw, READER_MIN);
  await beat(g, T0 + 2 * H);
  const h = await health(g, T0 + 2 * H + 60e3);
  assert.equal(h.reader.ok, false); assert.equal(h.ok, false); assert.match(h.working, /not working: .*reader/);
  const r = await handle(new Request('https://w.test/health'), g, T0 + 2 * H + 60e3); assert.equal(r.status, 503);
});

test('MODEL-REPLY-1: readings logged "not JSON" on launch are queued again once', async () => {
  const e = { DB: d1() }; await beat(e, T0);
  e.DB.raw.prepare("INSERT INTO leads (programme, ref, title, abstract, via, found, status, why) VALUES ('dare', 'doi:1', 't', 'a', 'x', ?, 'rejected', 'not JSON')").run(T0);
  e.DB.raw.prepare("INSERT INTO candidates (ref, title, found, status, why) VALUES ('doi:2', 't', ?, 'rejected', 'not JSON')").run(T0);
  const b = await beat(e, T0 + 2 * H);
  assert.equal(b.report.requeued_unreadable_leads, 1); assert.equal(b.report.requeued_unreadable_candidates, 1);
  assert.equal(e.DB.raw.prepare("SELECT status FROM leads").get().status, 'new');
  assert.equal((await beat(e, T0 + 4 * H)).report.requeued_unreadable_leads, undefined, 'a no-op once clean');
});

test('WORK-NOT-PULSE-1: a ticking clock with a dead search is not ok (every source 429 and 503 on launch)', async () => {
  const refuse = async (url) => new Response('busy', { status: url.includes('europepmc') ? 503 : 429 });
  const e = { DB: d1(), FETCH: refuse }; await beat(e, T0);
  const h = await health(e, T0 + 60e3);
  assert.equal(h.clock, 'ticking'); assert.equal(h.evidence.ok, false); assert.equal(h.ok, false); assert.ok(h.failing.includes('evidence'));
});

test('QUERY-SCOPE-1: an index reporting millions of matches is refused before anything is stored, and /health names it', async () => {
  const p = PROGRAMMES[0];
  const huge = async () => Response.json({ meta: { count: 10_000_000 }, results: [{ id: 'W1', title: 'Anything at all', publication_year: 2026 }], hitCount: 10_000_000, resultList: { result: [{ title: 'x' }] } });
  await assert.rejects(openAlexLeads(p, '2026-01-01', huge), /too broad .*10000000 matches/);
  await assert.rejects(europePmcLeads(p, '2026-01-01', huge), /too broad/);
  assert.deepEqual(await openAlexLeads(p, '2026-01-01', quiet), []);
  const f = async (url) => url.includes('openalex') ? huge() : quiet();
  const e = { DB: d1(), FETCH: f }; await beat(e, T0);
  assert.equal(e.DB.raw.prepare("SELECT COUNT(*) n FROM leads").get().n, 0, 'nothing from the broad query was stored');
  const h = await health(e, T0 + 60e3); assert.ok(h.evidence.too_broad_6h > 0); assert.equal(h.evidence.ok, false);
  assert.ok(EVIDENCE.max_hits <= 100000);
});

test('CITE-VERIFIED-1: a curated citation Crossref cannot match is a failing part; pending is not; unindexed needs a reason', async () => {
  const e = { DB: d1() }; await beat(e, T0);
  let h = await health(e, T0 + 60e3); assert.equal(h.citations.ok, true); assert.ok(h.citations.pending > 0);
  const p = PROGRAMMES.find(x => !x.found);
  e.DB.raw.prepare("INSERT INTO citations (key, programme, doi, found_title, tried) VALUES (?, ?, NULL, NULL, ?)").run(p.id + '#0', p.id, T0);
  h = await health(e, T0 + 60e3); assert.equal(h.citations.ok, false); assert.deepEqual(h.citations.unmatched, [p.id + '#0']);
  for (const q of PROGRAMMES.filter(x => !x.found)) for (const t of q.trials) if (t.unindexed) assert.ok(String(t.unindexed).length >= 20, q.id + ': unindexed needs a reason');
});

test('STATIC-IS-NOT-AUTONOMOUS-1: with a model bound, a candidate left unread past the stall limit makes discovery not ok', async () => {
  const e = { DB: d1(), AI: { async run() { return null; } }, AI_DAILY_CAP: '0' }; await beat(e, T0);
  e.DB.raw.prepare("INSERT INTO candidates (ref, title, abstract, found, status) VALUES ('doi:9', 'A review', 'An abstract', ?, 'new')").run(T0);
  assert.equal((await health(e, T0 + H)).discovery.ok, true);
  const h = await health(e, T0 + DISCOVER_STALL_MS + H); assert.equal(h.discovery.reading_stalled, true); assert.equal(h.discovery.ok, false);
});

test('STATIC-IS-NOT-AUTONOMOUS-1: the hand-curated seed never grows; the atlas grows only through discovery (shrink-only)', async () => {
  const { CURATED } = await import('./programmes.js');
  // 15 programmes were hand-seeded at launch. Adding one here by hand is the static-content failure; new programmes come from found_programmes.
  assert.ok(CURATED.length <= 15, `CURATED has ${CURATED.length} programmes; grow the atlas through discover.js, not by hand`);
  for (const p of CURATED) for (const t of p.trials) assert.ok(t.title && t.year && t.venue, p.id + ': a curated trial names title, year and venue so Crossref can check it');
});
