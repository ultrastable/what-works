// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// KGRAPH-1: the atlas's knowledge graph is rebuilt by the beat, kept bitemporal in D1, and read for insights at /graph.json and /connections.
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { handle, beat } from './index.js';
import { buildGraph, SPEC, outcomesOf, authorsOf, coverage } from './graph.js';
import { countriesOf, COUNTRIES, INCOME, STRUCTURE, EXECUTIVE, REGIONS } from './countries.js';
import { analyze, validate } from '../vendor/ultrastable/kgraph.js';
import { PROGRAMMES } from './programmes.js';
import { currentGrade } from './grade.js';
import { readFileSync } from 'node:fs';

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
const curated = () => Object.fromEntries(PROGRAMMES.map(p => [p.id, currentGrade(p, [])]));

test('extraction is deterministic and covers every programme', () => {
  assert.deepEqual(outcomesOf('violent-crime arrests and staying in school'), ['offending', 'schooling']);
  assert.deepEqual(countriesOf('Tennessee (Project STAR) and Israel'), ['united-states', 'israel']);
  assert.deepEqual(countriesOf('Nigeria'), ['nigeria'], 'Niger is never read out of Nigeria');
  assert.deepEqual(authorsOf('Sherman LW, Weisburd D').map(a => a.id), ['author:sherman-l', 'author:weisburd-d']);
  const s = buildGraph(curated(), {}, T0);
  assert.deepEqual(validate(s), [], 'every fact has provenance and no edge dangles');
  assert.deepEqual(JSON.stringify(buildGraph(curated(), {}, T0)), JSON.stringify(s));
  const a = analyze(s, SPEC, { now: T0 });
  assert.deepEqual(a.insights.filter(i => i.type === 'gap' && i.nodes[0].startsWith('programme:')), [], 'every programme has an outcome concept and a country');
  assert.ok(a.insights.some(i => i.type === 'disagree' && /Hot spots policing works on crime and offending; Scared Straight prison visits backfires/.test(i.title)));
});

test('the vendored analytics stay identical to the platform copy when it is checked out beside this repo', () => {
  let up; try { up = readFileSync(new URL('../../ultrastable/workers/core/kgraph/insight.js', import.meta.url), 'utf8'); } catch { return; }  // not checked out: nothing to compare
  assert.equal(readFileSync(new URL('../vendor/ultrastable/kgraph.js', import.meta.url), 'utf8').split('\n').slice(1).join('\n'), up);
});

test('the beat rebuilds the graph; a quiet beat writes nothing; a read-in trial joins as a fact with its source', async () => {
  const e = { DB: d1() };
  const b1 = await beat(e, T0); assert.ok(b1.report.graph.nodes > 100, JSON.stringify(b1.report.graph)); assert.equal(b1.report.graph.added, b1.report.graph.nodes + b1.report.graph.edges);
  const b2 = await beat(e, T0 + 3600e3); assert.equal(b2.report.graph.added, 0); assert.equal(b2.report.graph.insights_new, 0);
  e.DB.raw.prepare("INSERT INTO leads (programme, ref, title, url, via, found, status, design, direction, finding, read_at) VALUES ('becoming-a-man','10.9/x','A replication','https://doi.org/10.9/x','openalex',1,'accepted','rct','positive','Fewer arrests.',?)").run(T0 + 5000e3);
  const b3 = await beat(e, T0 + 7200e3); assert.ok(b3.report.graph.added >= 2);
  const g = await (await handle(get('/graph.json'), e, T0 + 7200e3)).json();
  assert.equal(g.version, 'kg/1');
  const lead = g.nodes.find(n => n.id === 'study:lead-109x'); assert.equal(lead.provenance[0].source, 'evidence-loop'); assert.equal(lead.provenance[0].url, 'https://doi.org/10.9/x'); assert.ok(lead.first_seen);
  assert.ok(g.analysis.insights.length > 0 && g.analysis.insights.every(i => i.prediction && i.probe));
  e.DB.raw.prepare("DELETE FROM leads").run();
  const b4 = await beat(e, T0 + 10800e3); assert.ok(b4.report.graph.retired >= 2, 'a fact that drops out is retired, not deleted');
  assert.ok(e.DB.raw.prepare("SELECT retired_at FROM kg_facts WHERE id='n:study:lead-109x'").get().retired_at);
});

test('/connections renders the leads and links to programmes', async () => {
  const e = { DB: d1() }; await beat(e, T0);
  const r = await handle(get('/connections'), e, T0); assert.equal(r.status, 200);
  const h = await r.text(); assert.match(h, /Same outcome, opposite verdicts/); assert.match(h, /href="\/p\/hot-spots-policing"/); assert.match(h, /\/graph\.json/);
});

test('settings are first-class: every country has a region, an income group or an honest null, a state structure and an executive; lessons cross borders', () => {
  for (const c of Object.values(COUNTRIES)) {
    assert.ok(REGIONS[c.region], c.key); assert.ok(c.income === null || INCOME[c.income], c.key); assert.ok(STRUCTURE[c.structure], c.key); assert.ok(c.executive === null || EXECUTIVE[c.executive], c.key);
  }
  for (const p of PROGRAMMES) assert.ok(countriesOf(p.where).length, p.id + ' names a country the settings table knows');
  const s = buildGraph(curated(), {}, T0), a = analyze(s, SPEC, { now: T0 });
  for (const k of ['country', 'region', 'income', 'structure', 'executive']) assert.ok(s.nodes.some(n => n.kind === k), k);
  const carry = a.insights.filter(i => i.type === 'carry');
  assert.ok(carry.some(i => /^Unconditional cash transfers works on income and poverty in low- and lower-middle-income countries/.test(i.title)), carry.map(i => i.title).join('\n'));
  assert.ok(a.insights.some(i => i.type === 'desert'));
  const cov = coverage(s).find(r => r.outcome === 'offending'); assert.ok(cov.high.includes('hot-spots-policing'));
});
