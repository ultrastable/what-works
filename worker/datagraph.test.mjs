// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// DATAGRAPH-1: What Works runs on the platform's one graph engine (core/datagraph), over every D1 table and the atlas's own records.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle, beat } from './index.js';
import { buildGraph, refreshGraph } from './graph.js';
import { atlasTables, datagraphStep, renameEngine, _reset } from './datagraph.js';
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

test('the atlas becomes tables: single relations are reference columns, repeated ones are junction tables', () => {
  const { tables, declared } = atlasTables(snap());
  const t = n => tables.find(x => x.name === 'atlas_' + n);
  assert.ok(t('programme').rows.length === PROGRAMMES.length);
  assert.equal(declared.atlas_country.refs.income_group, 'atlas_income');  // a country has one income group
  assert.ok(t('country').rows.every(r => !r.id.startsWith('country:')));
  const j = t('programme_in_country');  // a programme is tried in several countries
  assert.ok(j && j.rows.length > 0); assert.deepEqual(declared.atlas_programme_in_country.refs, { programme: 'atlas_programme', in_country: 'atlas_country' });
});

test('the engine links programmes to countries and settings, writes nothing when nothing changed, and keeps history', async () => {
  _reset(); const db = d1(), a = atlasTables(snap());
  const r = await datagraphStep({ db, config: { knowledge_graph: { declared: a.declared } }, extra: a.tables, now: T0 });
  assert.ok(r.nodes > PROGRAMMES.length * 5, JSON.stringify(r.changes));
  const viaJunction = db.raw.prepare("SELECT COUNT(*) n FROM kg_edges WHERE src LIKE 'atlas_programme_in_country:%' AND dst LIKE 'atlas_country:%' AND valid_to IS NULL").get().n;
  assert.ok(viaJunction > 0);
  assert.ok(db.raw.prepare("SELECT 1 FROM kg_edges WHERE src LIKE 'atlas_country:%' AND rel='income_group' AND dst LIKE 'atlas_income:%'").get());
  assert.equal((await datagraphStep({ db, config: { knowledge_graph: { declared: a.declared } }, extra: a.tables, now: T0 + 60e3 })).status, 'not-due');
  const again = await datagraphStep({ db, config: { knowledge_graph: { declared: a.declared } }, extra: a.tables, now: T0 + 7 * 3600e3 });
  assert.equal(again.changes.nodes_new + again.changes.nodes_changed + again.changes.nodes_closed + again.changes.edges_new + again.changes.edges_closed, 0);
});

test('the earlier engine tables are renamed to kn_* with their rows, and the atlas ledger is never mistaken for them', async () => {
  _reset(); const db = d1();
  db.raw.exec("CREATE TABLE kg_nodes (tenant TEXT NOT NULL, id TEXT NOT NULL, kind TEXT, PRIMARY KEY (tenant, id))");
  db.raw.exec("CREATE TABLE kg_runs (tenant TEXT NOT NULL, at INTEGER NOT NULL, nodes INTEGER)");
  db.raw.prepare("INSERT INTO kg_nodes VALUES ('what-works','n1','programme')").run();
  assert.deepEqual(await renameEngine(db), ['kg_nodes', 'kg_runs']);
  assert.equal(db.raw.prepare('SELECT id FROM kn_nodes').get().id, 'n1');
  const a = atlasTables(snap());
  await datagraphStep({ db, config: { knowledge_graph: { declared: a.declared } }, extra: a.tables, now: T0 });
  await refreshGraph(db, snap(), T0);  // the atlas's own ledger rename leaves the engine's kg_runs alone
  assert.ok(db.raw.prepare("SELECT COUNT(*) n FROM kg_runs").get().n >= 1);
  assert.ok(!db.raw.prepare("SELECT 1 FROM kg_nodes WHERE id LIKE 'kn_%'").get());  // the renamed tables are not read back in as data
});

test('the beat runs the engine and /api/graph serves the public view', async () => {
  _reset(); const env = { DB: d1() };
  const b = await beat(env, T0, { skipNetwork: true });
  assert.ok(b.report.kg && b.report.kg.nodes > 0, JSON.stringify(b.report.kg));
  const g = await (await handle(new Request('https://w.test/api/graph'), env, T0 + 60e3)).json();
  assert.equal(g.built, true); assert.equal(g.view, 'public');
  const p = PROGRAMMES[0].id;
  const n = await handle(new Request(`https://w.test/api/graph/node?id=atlas_programme:${encodeURIComponent(p)}`), env, T0 + 60e3);
  assert.equal(n.status, 200); assert.ok((await n.json()).neighbors.length > 0);
  const s = await (await handle(new Request('https://w.test/api/graph/search?q=' + encodeURIComponent(PROGRAMMES[0].name.slice(0, 6))), env, T0 + 60e3)).json();
  assert.ok(s.results.every(r => r.kind !== 'leads' && r.kind !== 'locks'));
  assert.equal((await handle(new Request('https://w.test/api/graph/nope'), env, T0 + 60e3)).status, 404);
});
