// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// CITE-VERIFIED-1: no curated citation ships unchecked. The atlas launched on 2026-11-25 with 33 curated trials none of which had been checked
// against Crossref. This resolves every curated trial with the Worker's own matcher (evidence.js resolveTrial: title match >= 0.8 and year
// within one) and exits 1 when a trial matches nothing and carries no `unindexed` reason. Run by .github/workflows/citations.yml on every
// change to programmes.js and weekly; the Worker keeps the same check live in /health `citations`.
import { PROGRAMMES } from "../worker/programmes.js";
import { resolveTrial } from "../worker/evidence.js";

// What Crossref holds for a pinned DOI, so a failed run says whether the pin or the cited title is wrong.
async function diagnose(t) {
  if (!t.doi) return "";
  try {
    const r = await fetch("https://api.crossref.org/works/" + encodeURIComponent(t.doi), { headers: { "user-agent": "what-works-citations/1" } });
    if (!r.ok) return ` [doi ${t.doi}: HTTP ${r.status}]`;
    const m = (await r.json()).message || {};
    return ` [doi ${t.doi} holds: "${Array.isArray(m.title) ? m.title[0] : m.title}" (${m.issued && m.issued["date-parts"] && m.issued["date-parts"][0][0]})]`;
  } catch (e) { return ` [doi ${t.doi}: ${e.message}]`; }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const out = { verified: [], unmatched: [], unindexed: [], errors: [] };
for (const p of PROGRAMMES) for (const [i, t] of p.trials.entries()) {
  const key = p.id + "#" + i;
  if (t.unindexed) { out.unindexed.push(key + " (" + t.unindexed + ")"); continue; }
  let hit = null, err = null;
  for (let a = 0; a < 3 && !hit; a++) {
    try { hit = await resolveTrial(t, fetch); err = null; break; } catch (e) { err = e; await sleep(2000 * (a + 1)); }
  }
  if (err) out.errors.push(key + ": " + err.message);
  else if (hit) out.verified.push(key + " doi:" + hit.doi);
  else out.unmatched.push(key + ": " + t.title + " (" + t.year + ")" + await diagnose(t));
  await sleep(400);
}
for (const k of ["verified", "unindexed", "unmatched", "errors"]) { console.log(`${k}: ${out[k].length}`); for (const x of out[k]) console.log("  " + x); }
// An index that cannot be reached proves nothing either way: it fails the run too, so a check never passes by not running.
process.exit(out.unmatched.length || out.errors.length ? 1 : 0);
