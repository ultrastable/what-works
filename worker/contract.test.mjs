// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLEET-CONTRACT-1: What Works serves the fleet contract, and every statement holds front to back and back to front against the real router
// on an in-memory SQLite standing in for D1 (the same stand-in worker.test.mjs uses).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { verify, routesIn } from '../vendor/ultrastable/contract.js';
import { handle, beat } from './index.js';
import { SPEC } from './contract.js';
import { PROGRAMMES } from './programmes.js';

function d1() {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const T0 = Date.UTC(2026, 11, 1);
// A fake network that answers: Crossref confirms each cited title, the searches find nothing new. The loop then runs hourly until every programme
// has been checked, as in production; a system whose sources are down is honestly unwell and would fail the reading.
const net = async (url) => {
  if (url.includes('crossref')) {
    const q = decodeURIComponent(url.split('query.bibliographic=')[1] || '');
    const t = PROGRAMMES.flatMap(p => p.trials).find(x => q.startsWith(x.title));
    return Response.json({ message: { items: t ? [{ DOI: '10.1/' + t.study, title: [t.title], issued: { 'date-parts': [[t.year]] } }] : [] } });
  }
  if (url.includes('openalex')) return Response.json({ results: [] });
  if (url.includes('europepmc')) return Response.json({ resultList: { result: [] } });
  return new Response('?', { status: 404 });
};
// one database for the file: the graph engine sets its tables up once per isolate, as a Worker does
let ready = null;
async function boot() {
  const env = { DB: d1(), FETCH: net };
  let t = T0;
  for (let i = 0; i < 72; i++, t += 3600e3) {
    await beat(env, t);
    if ((await handle(new Request('https://w.test/api/freshness'), env, t)).status === 200 && (await handle(new Request('https://w.test/health'), env, t)).status === 200) break;
  }
  return { env, t };
}
async function site(over = {}) {
  const { env, t } = await (ready = ready || boot());
  return async path => over[path] ? over[path]() : handle(new Request('https://w.test' + path), env, t + 60000);
}
const src = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

test('every surface answers and every statement is backed, both ways; every public endpoint is named', async () => {
  const apis = routesIn(src);
  for (const a of ['/api/programmes', '/api/settings', '/api/graph', '/api/graph/node', '/api/guess']) assert.ok(apis.includes(a), a + ' was read from the router');
  const r = await verify(await site(), SPEC, { apis });
  assert.deepEqual(r.failures, []);
});

test('a statement whose endpoint is removed, and an endpoint nobody states, both fail the reading', async () => {
  const gone = () => new Response('gone', { status: 404 });
  const r = await verify(await site({ '/api/settings': gone }), SPEC, { apis: [...routesIn(src), '/api/unstated'] });
  assert.deepEqual(r.failures.map(f => [f.id, f.direction]), [['settings', 'front-to-back'], ['/api/settings', 'front-to-back'], ['/api/unstated', 'back-to-front']]);
});
