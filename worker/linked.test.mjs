// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// STANDARDS-1: the atlas publishes schema.org, ISO 3166, DCAT, PROV-O and OpenAPI, generated from its own data, and the description matches the router.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle, beat } from './index.js';
import { PROGRAMMES } from './programmes.js';
import { COUNTRIES } from './countries.js';
import { ISO3166 } from './iso3166.js';
import { ROUTES, rating, claimReview, provChanges } from './linked.js';
import { _reset as resetGraph } from './datagraph.js';

function d1() {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const T0 = Date.UTC(2026, 11, 1);
const get = (e, p) => handle(new Request('https://w.test' + p), e, T0 + 60000);

test('every country the atlas records has an ISO 3166-1 alpha-2 code, and codes are unique', () => {
  const missing = Object.keys(COUNTRIES).filter(k => !ISO3166[k]);
  assert.deepEqual(missing, []);
  const codes = Object.values(ISO3166);
  assert.equal(new Set(codes).size, codes.length);
  for (const c of codes) assert.match(c, /^[A-Z]{2}$/);
});

test('a programme page carries a schema.org ClaimReview with the computed verdict, DOI links and ISO countries', async () => {
  const e = { DB: d1() }; await beat(e, T0);
  const p = PROGRAMMES[0];
  const html = await (await get(e, '/p/' + p.id)).text();
  const m = html.match(/<script type="application\/ld\+json">(.*?)<\/script>/s);
  assert.ok(m, 'JSON-LD block present');
  const ld = JSON.parse(m[1]);
  assert.equal(ld['@type'], 'ClaimReview');
  assert.equal(ld.url, 'https://what-works.ultrastable.org/p/' + p.id);
  assert.equal(ld.itemReviewed.appearance.length, p.trials.length);
  assert.ok(ld.reviewRating.alternateName);
  const r = claimReview({ ...p, where: 'Kenya' }, { verdict: 'works', strength: 'strong' }, { citations: { 0: { doi: '10.1/x' } }, settings: [{ id: 'kenya' }] });
  assert.equal(r.itemReviewed.appearance[0].sameAs, 'https://doi.org/10.1/x');
  assert.equal(r.itemReviewed.spatialCoverage[0].identifier.value, 'KE');
  assert.equal(rating({ verdict: 'insufficient', strength: 'limited' }).ratingValue, undefined, 'too little evidence has no numeric rating');
  assert.equal(rating({ verdict: 'works', strength: 'strong' }).ratingValue, 5);
});

test('DCAT catalogue, PROV-O history and OpenAPI are served, and every OpenAPI route answers', async () => {
  resetGraph();  // the graph engine caches its DDL per isolate; this test uses a fresh database
  const e = { DB: d1() }; await beat(e, T0);
  const cat = await get(e, '/api/catalog');
  assert.match(cat.headers.get('content-type'), /application\/ld\+json/);
  const c = await cat.json();
  assert.equal(c['@type'], 'dcat:Catalog');
  assert.ok(c['dcat:dataset'].length >= 3);
  const prov = await (await get(e, '/api/changes.jsonld')).json();
  assert.ok(prov['@graph'].some(n => n['@type'] === 'prov:Activity'));
  assert.ok(prov['@graph'].some(n => n['@type'] === 'prov:Entity' && n['prov:wasGeneratedBy']));
  const api = await (await get(e, '/openapi.json')).json();
  assert.equal(api.openapi, '3.1.0');
  const ids = new Set();
  for (const [path, opId] of ROUTES) {
    assert.ok(!ids.has(opId)); ids.add(opId);
    const res = await get(e, path.replace('{id}', PROGRAMMES[0].id));
    assert.ok([200, 503].includes(res.status), `${path} answers (${res.status})`);
  }
});

test('PROV-O links a re-grade to the grade it was derived from', () => {
  const g = provChanges([{ id: 7, programme: 'x', at: T0, from_verdict: 'promising', from_strength: 'limited', to_verdict: 'works', to_strength: 'moderate', kind: 'evidence', reason: 'r' }])['@graph'];
  const ent = g.find(n => n['@type'] === 'prov:Entity');
  assert.ok(ent['prov:wasDerivedFrom']);
  assert.equal(ent['prov:wasGeneratedBy']['@id'], g[0]['@id']);
});
