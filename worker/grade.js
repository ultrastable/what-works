// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The grading rubric, as code. Every verdict on the site is computed here from the trials under a programme; nothing is typed by hand, and
// /rubric renders these same constants, so the words on the page are the code that grades (WORDS-MATCH-CODE-1).
//
// 1. Each trial weighs by its design: randomized evidence counts most, a synthesis of randomized trials most of all.
//    A trial the loop added from a newly published abstract (machine: true) counts at half weight until a curator confirms it.
// 2. Weights are summed by direction (a mixed finding counts half positive, half null).
// 3. Verdict, in order: too little evidence when the total weight is under MIN_WEIGHT; backfires when half or more of the weight points to
//    harm and harm outweighs benefit; works when POS_SHARE or more is positive and the result is replicated; promising when it is positive but not yet replicated;
//    no effect when NULL_SHARE or more finds nothing; otherwise mixed.
// 4. Replicated means two or more independent positive randomized experiments, or a positive synthesis of trials. Follow-ups of one
//    experiment share a `study` id and count once.
// 5. Strength reads the total weight and how many independent experiments stand behind it; studies that disagree (a quarter or more of the
//    weight against the main finding) cap it at moderate; with no randomized evidence it is at most limited.

export const DESIGNS = {
  "meta-rct": { name: "Systematic review or meta-analysis of randomized trials", short: "Review of RCTs", weight: 4, randomized: true, synthesis: true },
  "review": { name: "Systematic review of mixed designs", short: "Systematic review", weight: 2.5, randomized: false, synthesis: true },
  "rct": { name: "Randomized controlled trial (including lotteries)", short: "RCT", weight: 2, randomized: true },
  "cluster-rct": { name: "Cluster-randomized trial (schools, villages or areas randomized)", short: "Cluster RCT", weight: 2, randomized: true },
  "natural-experiment": { name: "Natural experiment (regression discontinuity, difference in differences, instrumental variables)", short: "Natural experiment", weight: 1, randomized: false },
  "observational": { name: "Observational comparison", short: "Observational", weight: 0.5, randomized: false }
};

export const DIRECTIONS = {
  positive: { name: "Improved the outcome", pos: 1, nul: 0, neg: 0 },
  null: { name: "No clear effect", pos: 0, nul: 1, neg: 0 },
  negative: { name: "Made the outcome worse", pos: 0, nul: 0, neg: 1 },
  mixed: { name: "Mixed results", pos: 0.5, nul: 0.5, neg: 0 }
};

export const VERDICTS = {
  works: { name: "Works", say: "The trials agree it improves the outcome, and the result has been replicated.", rank: 5, bucket: "works" },
  promising: { name: "Promising", say: "The evidence points to a benefit, but it has not yet been replicated in an independent trial.", rank: 4, bucket: "works" },
  mixed: { name: "Mixed", say: "Good trials disagree, often because the programme worked in some places or for some people and not others.", rank: 3, bucket: "mixed" },
  "no-effect": { name: "No effect", say: "Good trials find little or no effect on the outcome it was meant to change.", rank: 2, bucket: "none" },
  backfires: { name: "Backfires", say: "The best evidence finds it made the outcome worse.", rank: 1, bucket: "harm" },
  insufficient: { name: "Too little evidence", say: "There is not yet enough rigorous evidence to grade it.", rank: 0, bucket: "mixed" }
};

export const STRENGTHS = {
  strong: { name: "Strong", bars: 3 },
  moderate: { name: "Moderate", bars: 2 },
  limited: { name: "Limited", bars: 1 }
};

// The guess a reader makes before the reveal: four buckets, so a verdict that moves moves the right answer with it.
export const GUESS = [
  { id: "works", label: "It works" },
  { id: "mixed", label: "It depends: mixed or unclear" },
  { id: "none", label: "It makes no difference" },
  { id: "harm", label: "It backfires" }
];

export const RUBRIC = { MIN_WEIGHT: 2, POS_SHARE: 0.7, NULL_SHARE: 0.6, HARM_SHARE: 0.5, MACHINE_FACTOR: 0.5, STRONG_WEIGHT: 6, MODERATE_WEIGHT: 3.5, STRONG_EXPERIMENTS: 2, CONFLICT_SHARE: 0.25 };

export function trialWeight(t) {
  const d = DESIGNS[t.design];
  if (!d || !DIRECTIONS[t.direction]) return 0;
  return d.weight * (t.machine ? RUBRIC.MACHINE_FACTOR : 1);
}

// grade(trials) -> { verdict, strength, weight, shares, experiments, replicated, randomized, basis }
export function grade(trials) {
  const valid = (trials || []).filter(t => trialWeight(t) > 0);
  let W = 0, pos = 0, nul = 0, neg = 0;
  for (const t of valid) { const w = trialWeight(t), d = DIRECTIONS[t.direction]; W += w; pos += w * d.pos; nul += w * d.nul; neg += w * d.neg; }
  const key = t => t.study || t.title;
  const experiments = new Set(valid.map(key)).size;
  const posRandomized = new Set(valid.filter(t => DESIGNS[t.design].randomized && !DESIGNS[t.design].synthesis && t.direction === "positive").map(key)).size;
  const posSynthesis = valid.some(t => DESIGNS[t.design].synthesis && t.direction === "positive");
  const randomized = valid.some(t => DESIGNS[t.design].randomized);
  const replicated = posRandomized >= 2 || (posSynthesis && (posRandomized >= 1 || valid.some(t => t.design === "meta-rct" && t.direction === "positive")));
  const shares = W ? { positive: pos / W, null: nul / W, negative: neg / W } : { positive: 0, null: 0, negative: 0 };
  let verdict;
  if (W < RUBRIC.MIN_WEIGHT) verdict = "insufficient";
  else if (shares.negative >= RUBRIC.HARM_SHARE && shares.negative > shares.positive) verdict = "backfires";
  else if (shares.positive >= RUBRIC.POS_SHARE) verdict = replicated ? "works" : "promising";
  else if (shares.null >= RUBRIC.NULL_SHARE) verdict = "no-effect";
  else verdict = "mixed";
  const synth = valid.some(t => DESIGNS[t.design].synthesis);
  let strength = W >= RUBRIC.STRONG_WEIGHT && (experiments >= RUBRIC.STRONG_EXPERIMENTS || synth) ? "strong" : W >= RUBRIC.MODERATE_WEIGHT || synth ? "moderate" : "limited";
  const minority = 1 - Math.max(shares.positive, shares.null, shares.negative);
  if (minority >= RUBRIC.CONFLICT_SHARE && strength === "strong") strength = "moderate";
  if (!randomized && strength !== "limited") strength = "limited";
  if (verdict === "insufficient") strength = "limited";
  const round = x => Math.round(x * 100) / 100;
  return { verdict, strength, weight: round(W), shares: { positive: round(shares.positive), null: round(shares.null), negative: round(shares.negative) },
    experiments, replicated, randomized, trials: valid.length, basis: basis(verdict, strength, { W, shares, experiments, replicated, randomized }) };
}

// One sentence, generated, saying why this grade: the page shows it under the verdict.
export function basis(verdict, strength, g) {
  const pct = x => Math.round(x * 100) + "%";
  if (verdict === "insufficient") return `Total evidence weight ${round1(g.W)} is under the minimum of ${RUBRIC.MIN_WEIGHT}.`;
  const parts = [`${g.experiments} independent ${g.experiments === 1 ? "study" : "studies"}`, `${pct(g.shares.positive)} of the weight positive, ${pct(g.shares.null)} no effect, ${pct(g.shares.negative)} harmful`];
  if (verdict === "promising") parts.push("not yet replicated");
  if (verdict === "works") parts.push("replicated");
  if (!g.randomized) parts.push("no randomized evidence yet");
  return parts.join("; ") + ".";
}
const round1 = x => Math.round(x * 10) / 10;

// The grade a programme has now: its curated trials plus the trials the loop accepted from new publications.
export function currentGrade(programme, accepted = []) {
  return grade([...(programme.trials || []), ...accepted.map(a => ({ ...a, machine: true }))]);
}

// Did the grade move? A verdict change or a strength change is logged with its reason; a weight change alone is not a re-grade.
export function moved(prev, next) {
  if (!prev) return { moved: true, kind: "first" };
  if (prev.verdict !== next.verdict) return { moved: true, kind: VERDICTS[next.verdict].rank > VERDICTS[prev.verdict].rank ? "up" : "down" };
  if (prev.strength !== next.strength) return { moved: true, kind: "strength" };
  return { moved: false };
}
