// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GLOBAL-1: where evidence comes from is read from the sources, tagged by income group, and turned into cross-country questions.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { settingsOf, incomesOf, COUNTRIES } from './countries.js';
import { settingsReport } from './learn.js';
import { handle, beat } from './index.js';
import { PROGRAMMES } from './programmes.js';

test('countries are read from the words, not guessed, and never matched inside another word', () => {
  const ids = t => settingsOf(t).map(s => s.id);
  assert.deepEqual(ids('A cluster RCT in rural Kenya and Uganda'), ['uganda', 'kenya']);
  assert.deepEqual(ids('Nigeria'), ['nigeria'], 'Niger is not read inside Nigeria');
  assert.deepEqual(ids('American Indian communities in Indiana'), [], 'India is not read inside Indian or Indiana');
  assert.deepEqual(ids('Somalia'), ['somalia'], 'Mali is not read inside Somalia');
  assert.ok(ids('trials in low- and middle-income countries').includes('pooled-lmic'));
  assert.deepEqual([...incomesOf(settingsOf('Malawi, Mexico, Chile'))].sort(), ['high', 'low', 'upper-middle']);
  assert.equal(new Set(COUNTRIES.map(c => c.id)).size, COUNTRIES.length, 'one row per country');
  for (const c of COUNTRIES) assert.ok(['low', 'lower-middle', 'upper-middle', 'high'].includes(c.income), c.name);
});

test('the atlas spans every income group and region already, from its curated sources', () => {
  const g = Object.fromEntries(PROGRAMMES.map(p => [p.id, { verdict: 'works' }]));
  const r = settingsReport(PROGRAMMES, g, {});
  for (const i of ['low', 'lower-middle', 'upper-middle', 'high']) assert.ok(r.coverage[i] > 0, 'evidence from ' + i + ' income countries');
  assert.ok(new Set(r.programmes.flatMap(x => x.regions)).size >= 4);
});

test('lessons: works only in rich countries, works only in poorer ones, and same goal with opposite results across settings', () => {
  const P = [
    { id: 'a', name: 'A', outcome: 'school attendance', where: 'United States', trials: [] },
    { id: 'b', name: 'B', outcome: 'school enrolment and attendance', where: 'Kenya', trials: [] },
    { id: 'c', name: 'C', outcome: 'violent crime arrests', where: 'Mexico', trials: [] }
  ];
  const r = settingsReport(P, { a: { verdict: 'works' }, b: { verdict: 'no-effect' }, c: { verdict: 'promising' } });
  assert.ok(r.lessons.some(l => l.kind === 'gap-poorer' && l.programmes[0] === 'a'));
  assert.ok(r.lessons.some(l => l.kind === 'gap-richer' && l.programmes[0] === 'c'));
  const c = r.lessons.find(l => l.kind === 'contrast'); assert.ok(c); assert.deepEqual(c.programmes, ['a', 'b']); assert.match(c.ask, /What can each setting learn/);
});

test('/world and /api/settings render from live data; a programme page names where its evidence comes from', async () => {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; }, async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; }, async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  const e = { DB: { prepare: stmt, async batch(l) { for (const s of l) await s.run(); } } };
  const T = Date.UTC(2026, 11, 1); await beat(e, T);
  const w = await handle(new Request('https://w.test/world'), e, T);
  assert.equal(w.status, 200); const h = await w.text(); assert.match(h, /Around the world/); assert.match(h, /lower-middle income countries/);
  const j = await (await handle(new Request('https://w.test/api/settings'), e, T)).json(); assert.equal(j.ok, true); assert.equal(j.programmes.length, PROGRAMMES.length);
  assert.match(await (await handle(new Request('https://w.test/p/deworming'), e, T)).text(), /Where the evidence comes from[\s\S]*Kenya/);
});
