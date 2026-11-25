// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The rubric and the reader guard: verdicts follow the evidence, replication is counted by experiment, and a model can only label with quotes.
import test from 'node:test';
import assert from 'node:assert/strict';
import { grade, currentGrade, moved, DESIGNS, DIRECTIONS, VERDICTS, GUESS } from './grade.js';
import { PROGRAMMES, AREAS } from './programmes.js';
import { checkReading } from './reader.js';
import { titleMatch, openAlexAbstract } from './evidence.js';

const T = (design, direction, study = Math.random().toString(36)) => ({ title: 't ' + study, design, direction, study });

test('every curated programme is well formed and gets a computed grade', () => {
  const ids = new Set();
  for (const p of PROGRAMMES) {
    assert.ok(!ids.has(p.id), 'unique id ' + p.id); ids.add(p.id);
    assert.ok(AREAS.some(a => a.id === p.area), p.id + ' area');
    for (const k of ['name', 'what', 'outcome', 'where', 'feels', 'query']) assert.ok(p[k] && p[k].length > 5, p.id + ' ' + k);
    assert.ok(p.trials.length >= 1, p.id + ' has trials');
    for (const t of p.trials) {
      assert.ok(DESIGNS[t.design], p.id + ' design ' + t.design); assert.ok(DIRECTIONS[t.direction], p.id + ' direction ' + t.direction);
      for (const k of ['title', 'authors', 'venue', 'finding', 'study']) assert.ok(t[k], p.id + ' trial ' + k);
      assert.ok(t.year >= 1950 && t.year <= 2026, p.id + ' year');
      assert.doesNotMatch(t.finding, /\d/, p.id + ': findings carry no typed numbers; a number enters only from the source');
    }
    assert.ok(VERDICTS[grade(p.trials).verdict], p.id + ' graded');
  }
  for (const a of AREAS) assert.ok(PROGRAMMES.some(p => p.area === a.id), a.id + ' has programmes');
});

test('the curated atlas grades as the rubric says (a change here is a re-grade, and is logged in production)', () => {
  const g = id => grade(PROGRAMMES.find(p => p.id === id).trials).verdict;
  assert.equal(g('scared-straight'), 'backfires');
  assert.equal(g('dare'), 'no-effect');
  assert.equal(g('microcredit'), 'no-effect');
  assert.equal(g('unconditional-cash'), 'works');
  assert.equal(g('becoming-a-man'), 'promising', 'one experiment is not replication');
  assert.equal(g('nurse-home-visiting'), 'mixed');
  assert.equal(g('public-pre-k'), 'mixed', 'a tie between harm and benefit is mixed, not backfires');
});

test('replication counts experiments, not papers', () => {
  const same = grade([T('rct', 'positive', 'star'), T('rct', 'positive', 'star')]);
  assert.equal(same.verdict, 'promising'); assert.equal(same.experiments, 1);
  assert.equal(grade([T('rct', 'positive', 'a'), T('rct', 'positive', 'b')]).verdict, 'works');
  assert.equal(grade([T('meta-rct', 'positive')]).verdict, 'works', 'a positive synthesis of trials is replication');
});

test('too little evidence, design weights, machine half weight and the conflict cap', () => {
  assert.equal(grade([T('natural-experiment', 'positive')]).verdict, 'insufficient');
  assert.equal(grade([]).verdict, 'insufficient');
  const obs = grade([T('observational', 'positive'), T('natural-experiment', 'positive'), T('natural-experiment', 'positive')]);
  assert.equal(obs.strength, 'limited', 'no randomized evidence: at most limited');
  assert.equal(grade([{ ...T('rct', 'positive'), machine: true }]).weight, 1);
  const conflict = grade([T('meta-rct', 'null'), T('rct', 'positive'), T('rct', 'null', 'x')]);
  assert.equal(conflict.verdict, 'no-effect'); assert.equal(conflict.strength, 'moderate');
  assert.equal(grade([T('rct', 'negative'), T('rct', 'positive')]).verdict, 'mixed');
  assert.equal(grade([T('rct', 'negative'), T('rct', 'negative', 'y'), T('rct', 'positive')]).verdict, 'backfires');
});

test('a read-in trial moves the grade and the move is classified', () => {
  const p = PROGRAMMES.find(x => x.id === 'becoming-a-man');
  const before = currentGrade(p), after = currentGrade(p, [{ title: 'Replication', design: 'rct', direction: 'positive', study: 'doi:x' }]);
  assert.equal(before.verdict, 'promising'); assert.equal(after.verdict, 'works');
  assert.deepEqual(moved(before, after), { moved: true, kind: 'up' });
  assert.deepEqual(moved(null, before), { moved: true, kind: 'first' });
  assert.deepEqual(moved(before, before), { moved: false });
});

test('every verdict maps to a guess bucket', () => {
  for (const v of Object.values(VERDICTS)) assert.ok(GUESS.some(g => g.id === v.bucket));
});

const ABS = 'We conducted a cluster randomized trial in 120 schools. Pupils in treatment schools had fewer arrests for violent crime over two years than pupils in control schools.';
test('the reader guard accepts only labels backed by verbatim quotes that name the design', () => {
  const ok = checkReading(JSON.stringify({ relevant: true, design: 'cluster-rct', direction: 'positive', design_quote: 'a cluster randomized trial in 120 schools', direction_quote: 'Pupils in treatment schools had fewer arrests for violent crime over two years than pupils in control schools.' }), ABS);
  assert.equal(ok.status, 'accepted'); assert.match(ok.finding, /^Pupils in treatment schools/);
  const invented = checkReading(JSON.stringify({ relevant: true, design: 'rct', direction: 'positive', design_quote: 'a cluster randomized trial in 120 schools', direction_quote: 'Arrests fell by 45 percent among treated pupils.' }), ABS);
  assert.equal(invented.status, 'rejected'); assert.match(invented.why, /verbatim/);
  const wrongDesign = checkReading(JSON.stringify({ relevant: true, design: 'meta-rct', direction: 'positive', design_quote: 'a cluster randomized trial in 120 schools', direction_quote: 'Pupils in treatment schools had fewer arrests for violent crime' }), ABS);
  assert.equal(wrongDesign.status, 'rejected');
  assert.equal(checkReading('{"relevant": false}', ABS).status, 'unrelated');
  assert.equal(checkReading('I think it is an RCT', ABS).status, 'rejected');
  assert.equal(checkReading(JSON.stringify({ relevant: true, design: 'survey', direction: 'positive' }), ABS).why, 'unknown design');
});

test('title matching and OpenAlex abstracts', () => {
  assert.equal(titleMatch('Experimental analysis of neighborhood effects', 'Experimental Analysis of Neighborhood Effects'), 1);
  assert.ok(titleMatch('Experimental analysis of neighborhood effects', 'Neighborhood watch programs') < 0.8);
  assert.equal(openAlexAbstract({ trial: [1], A: [0], randomized: [2] }), 'A trial randomized');
  assert.equal(openAlexAbstract(null), null);
});
