// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// STATIC-IS-NOT-AUTONOMOUS-1: the atlas grows its own catalogue from systematic reviews, under the verbatim guard, with no hand edits.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle, beat, health, metrics } from './index.js';
import { PROGRAMMES, CURATED } from './programmes.js';
import { checkDiscovery, matchProgramme, SKIP_TITLE, DISCOVER } from './discover.js';

function d1() {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const get = p => new Request('https://w.test' + p);
const T0 = Date.UTC(2026, 11, 1);

const CBT = { DOI: '10.1002/cl2.900', title: ['Cognitive behavioural programmes for people in prison: a systematic review'], issued: { 'date-parts': [[2024]] }, 'container-title': ['Campbell Systematic Reviews'],
  abstract: '<jats:p>This systematic review and meta-analysis of randomised controlled trials assessed cognitive behavioural programmes for people in prison. Participants in cognitive behavioural programmes had lower reoffending than control groups after release.</jats:p>' };
const HF = { DOI: '10.1002/cl2.901', title: ['Housing First for people experiencing homelessness: a systematic review'], issued: { 'date-parts': [[2023]] }, 'container-title': ['Campbell Systematic Reviews'],
  abstract: 'We conducted a systematic review and meta-analysis of randomised controlled trials of Housing First. Housing First programmes increased housing stability compared with treatment as usual.' };
const PROTO = { DOI: '10.1002/cl2.902', title: ['PROTOCOL: Mentoring for young people'], issued: { 'date-parts': [[2025]] }, abstract: 'A protocol.' };

function net({ crossrefDown = false, items = [CBT, HF, PROTO] } = {}) {
  const calls = [];
  const f = async (url) => {
    calls.push(url);
    if (url.includes('api.crossref.org/journals/1891-1803')) {
      if (crossrefDown) return new Response('down', { status: 503 });
      const off = Number(new URL(url).searchParams.get('offset'));
      return Response.json({ message: { items: off === 0 ? items : [] } });
    }
    if (url.includes('openalex.org/works?filter=primary_location.source.issn')) {
      const page = Number(new URL(url).searchParams.get('page'));
      return Response.json({ results: page === 1 ? items.map(x => ({ doi: 'https://doi.org/' + x.DOI, title: x.title[0], publication_year: 2024,
        primary_location: { source: { display_name: 'Campbell Systematic Reviews' } },
        abstract_inverted_index: Object.fromEntries([...new Set(x.abstract.replace(/<[^>]+>/g, ' ').trim().split(/\s+/))].map(w => [w, x.abstract.replace(/<[^>]+>/g, ' ').trim().split(/\s+/).flatMap((y, i) => y === w ? [i] : [])])) })) : [] });
    }
    if (url.includes('crossref')) return Response.json({ message: { items: [] } });
    return Response.json({ results: [], resultList: { result: [] } });
  };
  f.calls = calls; return f;
}
// A model that labels by title, copying names and quotes exactly.
const AI = { async run(model, { messages }) {
  const u = messages[1].content;
  if (u.includes('Cognitive behavioural programmes for people in prison')) return { response: JSON.stringify({ relevant: true, programme: 'Cognitive behavioural programmes for people in prison', outcome: 'reoffending', area: 'crime', design: 'meta-rct', direction: 'positive',
    design_quote: 'systematic review and meta-analysis of randomised controlled trials', direction_quote: 'Participants in cognitive behavioural programmes had lower reoffending than control groups after release.' }) };
  if (u.includes('Housing First for people')) return { response: JSON.stringify({ relevant: true, programme: 'Housing First', outcome: 'housing stability', area: 'housing', design: 'meta-rct', direction: 'positive',
    design_quote: 'systematic review and meta-analysis of randomised controlled trials of Housing First', direction_quote: 'Housing First programmes increased housing stability compared with treatment as usual.' }) };
  return { response: JSON.stringify({ relevant: false }) };
} };

test('the guard: names and outcomes are copied from the review, reviews are labelled as reviews, quotes are verbatim', () => {
  const r = { title: 'Cognitive behavioural programmes for people in prison: a systematic review', abstract: CBT.abstract.replace(/<[^>]+>/g, ' ') };
  const ok = { relevant: true, programme: 'Cognitive behavioural programmes for people in prison', outcome: 'reoffending', area: 'crime', design: 'meta-rct', direction: 'positive',
    design_quote: 'systematic review and meta-analysis of randomised controlled trials', direction_quote: 'Participants in cognitive behavioural programmes had lower reoffending than control groups after release.' };
  assert.equal(checkDiscovery(JSON.stringify(ok), r).status, 'accepted');
  assert.equal(checkDiscovery(JSON.stringify({ ...ok, programme: 'Prison CBT' }), r).status, 'rejected', 'an invented name');
  assert.equal(checkDiscovery(JSON.stringify({ ...ok, outcome: 'employment' }), r).status, 'rejected', 'an invented outcome');
  assert.equal(checkDiscovery(JSON.stringify({ ...ok, design: 'rct' }), r).status, 'rejected', 'a review labelled as a single trial');
  assert.equal(checkDiscovery(JSON.stringify({ ...ok, direction_quote: 'Everyone reoffended less after the programme ended in every prison.' }), r).status, 'rejected', 'a paraphrased quote');
  assert.equal(checkDiscovery(JSON.stringify({ ...ok, area: 'space' }), r).status, 'rejected');
  assert.equal(checkDiscovery(JSON.stringify({ relevant: false }), r).status, 'unrelated');
  assert.ok(SKIP_TITLE.test('PROTOCOL: Mentoring for young people')); assert.ok(!SKIP_TITLE.test('Mentoring for young people'));
  assert.equal(matchProgramme('Housing First').id, 'housing-first'); assert.equal(matchProgramme('Cognitive behavioural programmes for people in prison'), null);
});

test('the atlas grows itself: a new programme is found, graded, published and searched; a known one gains evidence; protocols are skipped', async () => {
  const e = { DB: d1(), FETCH: net(), AI };
  const b = await beat(e, T0); assert.equal(b.ok, true);
  assert.equal(b.report.discover.new, 2); assert.deepEqual(b.report.grow.added, ['cognitive-behavioural-programmes-for-people-in-prison']); assert.equal(b.report.grow.attached, 1);
  const st = Object.fromEntries(e.DB.raw.prepare('SELECT ref, status FROM candidates').all().map(r => [r.ref, r.status]));
  assert.equal(st['doi:10.1002/cl2.902'], 'skipped'); assert.equal(st['doi:10.1002/cl2.901'], 'attached');
  const id = 'cognitive-behavioural-programmes-for-people-in-prison';
  assert.ok(PROGRAMMES.some(p => p.id === id)); assert.equal(PROGRAMMES.length, CURATED.length + 1);
  const j = await (await handle(get('/api/programme/' + id), e, T0 + 1)).json();
  assert.equal(j.ok, true); assert.equal(j.area, 'crime'); assert.equal(j.outcome, 'reoffending'); assert.notEqual(j.grade.verdict, 'insufficient');
  const page = await (await handle(get('/p/' + id), e, T0 + 1)).text();
  assert.match(page, /Found by the atlas itself/); assert.match(page, /What do you think the review found/); assert.match(page, /lower reoffending/);
  assert.match(await (await handle(get('/sitemap.xml'), e, T0 + 1)).text(), new RegExp('/p/' + id));
  assert.ok(e.DB.raw.prepare("SELECT 1 FROM grade_changes WHERE programme=? AND kind='first'").get(id), 'its first grade is logged with a reason');
  assert.ok(e.DB.raw.prepare("SELECT 1 FROM leads WHERE programme='housing-first' AND status='accepted' AND via LIKE 'discovery:%'").get(), 'the known programme gained the review');
  assert.equal((await metrics(e.DB, T0 + 1)).programmes_found, 1);
  const h = await health(e, T0 + 60e3); assert.equal(h.discovery.ok, true); assert.equal(h.discovery.programmes_found, 1); assert.equal(h.programmes, CURATED.length + 1);
  assert.equal(e.DB.raw.prepare("SELECT v FROM kv WHERE key='discover:offset:1891-1803'").get().v, '3', 'the walk moves on through the back catalogue');
  const before = e.FETCH.calls.filter(u => u.includes('journals/1891-1803')).length;
  await beat(e, T0 + 3600e3); assert.equal(e.FETCH.calls.filter(u => u.includes('journals/1891-1803')).length, before, 'at most one discovery pass per six hours');
  await beat(e, T0 + DISCOVER.every_ms + 1); assert.equal(e.FETCH.calls.filter(u => u.includes('journals/1891-1803')).length, before + 1);
});

test('Crossref down: OpenAlex carries discovery; no model: reviews wait and health says so', async () => {
  const e = { DB: d1(), FETCH: net({ crossrefDown: true }) };
  const b = await beat(e, T0);
  assert.equal(b.report.discover.routes['1891-1803'], 'openalex'); assert.equal(b.report.discover.new, 2);
  const h = await health(e, T0 + 60e3); assert.equal(h.discovery.ok, true); assert.equal(h.discovery.unread_without_model, 2); assert.equal(h.discovery.programmes_found, 0);
});

test('a discovery pass that no route answers for a day turns health.discovery false', async () => {
  const e = { DB: d1(), FETCH: async () => new Response('down', { status: 503 }) };
  await beat(e, T0);
  assert.equal((await health(e, T0 + DISCOVER.stale_ms + 1)).discovery.ok, false);
});

test('found programmes belong to their own database: a fresh atlas is the curated seed again', async () => {
  const e = { DB: d1() }; await handle(get('/'), e, T0);
  assert.equal(PROGRAMMES.length, CURATED.length);
});

test('a review Crossref lists without an abstract gets one by DOI from OpenAlex, then is read in', async () => {
  const bare = { ...CBT, abstract: undefined };
  const f0 = net({ items: [bare] });
  const f = async (url, i) => {
    if (url.includes('api.openalex.org/works/doi:')) { const w = CBT.abstract.replace(/<[^>]+>/g, ' ').trim().split(/\s+/);
      return Response.json({ abstract_inverted_index: Object.fromEntries([...new Set(w)].map(x => [x, w.flatMap((y, k) => y === x ? [k] : [])])) }); }
    return f0(url, i);
  };
  const e = { DB: d1(), FETCH: f, AI };
  const b = await beat(e, T0);
  assert.equal(b.report.abstracts.filled, 1); assert.deepEqual(b.report.grow.added, ['cognitive-behavioural-programmes-for-people-in-prison']);
});
