// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1: the atlas also runs on the platform's shared engine; the old insight ledger is renamed once, data kept, and both live side by side.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle, beat } from './index.js';
import { buildGraph, refreshGraph } from './graph.js';
import { records, graphTick, TENANT } from './kg.js';
import { PROGRAMMES } from './programmes.js';
import { currentGrade } from './grade.js';

function d1() {
  const raw = new DatabaseSync(':memory:');
  const stmt = (sql) => { let a = []; const o = { bind(...x) { a = x; return o; },
    async all() { return { results: raw.prepare(sql).all(...a).map(r => ({ ...r })) }; },
    async first() { const r = raw.prepare(sql).get(...a); return r ? { ...r } : null; },
    async run() { const r = raw.prepare(sql).run(...a); return { meta: { changes: Number(r.changes) } }; } }; return o; };
  return { raw, prepare: stmt, async batch(list) { const out = []; for (const s of list) out.push(await s.run()); return out; } };
}
const T0 = Date.UTC(2026, 11, 1);
const snap = () => buildGraph(Object.fromEntries(PROGRAMMES.map(p => [p.id, currentGrade(p, [])])), {}, T0);

test('every programme becomes a record whose edges declare both ends', () => {
  const recs = records(snap());
  for (const p of PROGRAMMES) assert.ok(recs.some(r => r.source === 'node/programme:' + p.id), p.id);
  for (const r of recs) for (const e of r.data.out) assert.ok(e.dst.id && e.dst.kind && e.dst.label);
});

test('the shared engine builds the atlas once an hour, writes nothing when nothing changed, and files findings', async () => {
  const db = d1();
  const r = await graphTick(db, snap(), T0);
  assert.ok(r.ok, r.error); assert.ok(r.nodes > PROGRAMMES.length * 2); assert.ok(r.insights_new > 0);
  assert.equal((await graphTick(db, snap(), T0 + 10 * 60e3)).skipped, true);
  const again = await graphTick(db, snap(), T0 + 3600e3);
  assert.ok(again.ok); assert.equal(again.added + again.changed + again.retired, 0);
});

test('the atlas ledger created under the engine names is renamed once with its rows, and both run side by side', async () => {
  const db = d1();
  db.raw.exec("CREATE TABLE kg_insights (id TEXT PRIMARY KEY, type TEXT NOT NULL, title TEXT NOT NULL, first_seen TEXT NOT NULL, last_seen TEXT NOT NULL, gone_at TEXT)");
  db.raw.exec("CREATE TABLE kg_runs (id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, report TEXT NOT NULL)");
  db.raw.prepare("INSERT INTO kg_insights VALUES ('i1','gap','old finding','2026-11-25','2026-11-25',NULL)").run();
  await refreshGraph(db, snap(), T0);
  assert.equal(db.raw.prepare("SELECT title FROM ww_kg_insights WHERE id='i1'").get().title, 'old finding');
  const r = await graphTick(db, snap(), T0);
  assert.ok(r.ok, r.error);
  assert.ok(db.raw.prepare('SELECT COUNT(*) n FROM kg_insights WHERE tenant = ?').get(TENANT).n > 0);
  await refreshGraph(db, snap(), T0 + 3600e3);  // the rename runs once: the engine's tables are left alone
  assert.ok(db.raw.prepare('SELECT COUNT(*) n FROM kg_insights WHERE tenant = ?').get(TENANT).n > 0);
});

test('the beat runs the shared engine and /api/graph serves it', async () => {
  const env = { DB: d1() };
  const b = await beat(env, T0, { skipNetwork: true });
  assert.ok(b.report.kg && !b.report.kg.error, JSON.stringify(b.report.kg));
  const h = await handle(new Request('https://w.test/api/graph/health'), env, T0 + 60e3);
  assert.equal(h.status, 200);
  const m = await (await handle(new Request('https://w.test/api/graph/method'), env, T0 + 60e3)).json();
  assert.ok(JSON.stringify(m).includes('provenance'));
});

test('a graph read before the first beat on an atlas with the older graph tables is served, not refused', async () => {
  const e = { DB: d1() };
  e.DB.raw.exec("CREATE TABLE kg_insights (id TEXT PRIMARY KEY, kind TEXT); CREATE TABLE kg_runs (at INTEGER PRIMARY KEY, summary TEXT)");
  const r = await handle(new Request('https://w.test/api/graph/insights'), e, T0);
  assert.equal(r.status, 200);
});
