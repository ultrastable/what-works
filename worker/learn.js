// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// GLOBAL-1: lessons across countries and kinds of economy, computed from the atlas itself. For every programme it reads where its evidence comes
// from (countries.js over its sources' own words) and sets that beside its computed grade. Three kinds of lesson follow, each a question for a
// reader or a policymaker, never a claim:
//   gap-poorer   works, but every trial is from high-income countries: untested where most of the world lives;
//   gap-richer   works, but no trial is from a high-income country: a lesson richer countries have not tried;
//   contrast     two programmes aimed at the same outcome, one works and one does not, tested in different income groups: what differs?
import { VERDICTS } from "./grade.js";
import { settingsOf, incomesOf, INCOME } from "./countries.js";
import { outcomesOf, OUTCOMES } from "./graph.js";

export function programmeSettings(p, accepted = []) {
  const seen = new Map();
  for (const s of settingsOf(p.where, ...p.trials.map(t => `${t.title} ${t.finding || ""}`), ...accepted.map(a => `${a.title || ""} ${a.abstract || ""}`))) seen.set(s.id, s);
  return [...seen.values()];
}

const names = list => list.filter(s => s.region !== "pooled").map(s => s.name).slice(0, 4).join(", ") || list.map(s => s.name).join(", ");
const incomeWords = set => [...set].map(i => INCOME[i].toLowerCase()).join(", ");

export function settingsReport(programmes, grades, accepted = {}) {
  const rows = programmes.map(p => {
    const settings = programmeSettings(p, accepted[p.id] || []), g = grades[p.id];
    return { id: p.id, name: p.name, area: p.area, outcome: p.outcome, verdict: g.verdict, verdict_name: VERDICTS[g.verdict].name, bucket: VERDICTS[g.verdict].bucket,
      settings, incomes: [...incomesOf(settings)], regions: [...new Set(settings.filter(s => s.region !== "pooled").map(s => s.region))], outcomes: outcomesOf(p.outcome) };
  });
  const lessons = [];
  for (const r of rows) {
    if (r.bucket !== "works" || !r.incomes.length) continue;
    if (r.incomes.every(i => i === "high")) lessons.push({ kind: "gap-poorer", programmes: [r.id],
      ask: `${r.name} is graded ${r.verdict_name.toLowerCase()} on evidence from ${names(r.settings)}, all high-income. Would it work in a low- or middle-income country? No trial there is in the atlas yet.` });
    else if (!r.incomes.includes("high")) lessons.push({ kind: "gap-richer", programmes: [r.id],
      ask: `${r.name} is graded ${r.verdict_name.toLowerCase()} on evidence from ${names(r.settings)} (${incomeWords(new Set(r.incomes))}). No high-income country's trial is in the atlas: a lesson richer countries have not tested.` });
  }
  for (let i = 0; i < rows.length; i++) for (let j = 0; j < rows.length; j++) {
    const a = rows[i], b = rows[j];
    if (a.bucket !== "works" || !["none", "harm"].includes(b.bucket) || !a.incomes.length || !b.incomes.length) continue;
    const shared = a.outcomes.filter(o => b.outcomes.includes(o));
    if (!shared.length || a.incomes.some(x => b.incomes.includes(x))) continue;
    lessons.push({ kind: "contrast", programmes: [a.id, b.id], outcome: shared[0],
      ask: `On ${OUTCOMES[shared[0]].name.toLowerCase()}, ${a.name} works in ${names(a.settings)}, while ${b.name} ${b.bucket === "harm" ? "backfired" : "made no difference"} in ${names(b.settings)}. What can each setting learn from the other?` });
  }
  const coverage = {};
  for (const r of rows) for (const i of r.incomes) coverage[i] = (coverage[i] || 0) + 1;
  return { programmes: rows, lessons, coverage, untagged: rows.filter(r => !r.settings.length).map(r => r.id),
    note: "Countries are read from the sources' own words; income groups are the World Bank's classification for fiscal year 2026." };
}
