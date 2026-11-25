// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// Reading a new publication into the atlas. A model may only label: is this an evaluation of the programme's outcome, what design, which
// direction. Each label must be backed by a quote copied word for word from the abstract, and the design quote must name the design it
// claims. The finding shown on the page is the source's own sentence, so a model never adds a number, a name or a claim (Unlearn's rule).
// Anything that fails the guard stays a lead, listed on the programme page as new evidence not yet read in.
import { DESIGNS, DIRECTIONS } from "./grade.js";

export const READER = { per_beat: 4, min_quote: 20, max_quote: 400 };

const MARKERS = {
  "meta-rct": [/meta-analy|systematic review|pooled/i, /randomi[sz]/i],
  "review": [/meta-analy|systematic review|pooled|synthesis/i],
  "rct": [/randomi[sz]|lotter/i],
  "cluster-rct": [/randomi[sz]/i, /cluster|school|village|district|communit|site/i],
  "natural-experiment": [/discontinuit|difference-in-difference|differences-in-difference|instrumental|natural experiment|quasi-experiment|cutoff|cut-off/i],
  "observational": [/./]
};

export function readerPrompt(p, lead) {
  return [
    { role: "system", content: "You label research abstracts for a public evidence atlas. You never summarise or add facts. Reply with JSON only." },
    { role: "user", content: `Programme: ${p.name}. What it does: ${p.what}\nOutcome graded: ${p.outcome}\n\nTitle: ${lead.title}\nAbstract: ${lead.abstract}\n\n` +
      `Reply with JSON: {"relevant": true|false, "design": one of ${JSON.stringify(Object.keys(DESIGNS))}, "direction": one of ${JSON.stringify(Object.keys(DIRECTIONS))}, ` +
      `"design_quote": "exact words from the abstract that state the study design", "direction_quote": "exact sentence from the abstract that states the effect on the outcome"}. ` +
      `relevant is true only if the study evaluates this programme (or a close variant) on this outcome. Copy quotes exactly.` }
  ];
}

const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

export function parseJson(text) {
  const m = String(text || "").match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch { return null; }
}

// checkReading(modelText, abstract) -> { ok, status: accepted|unrelated|rejected, design, direction, finding, why }
export function checkReading(text, abstract) {
  const j = parseJson(text);
  if (!j) return { ok: false, status: "rejected", why: "not JSON" };
  if (j.relevant === false) return { ok: true, status: "unrelated" };
  if (j.relevant !== true) return { ok: false, status: "rejected", why: "relevance not stated" };
  if (!DESIGNS[j.design]) return { ok: false, status: "rejected", why: "unknown design" };
  if (!DIRECTIONS[j.direction]) return { ok: false, status: "rejected", why: "unknown direction" };
  const abs = norm(abstract);
  for (const k of ["design_quote", "direction_quote"]) {
    const q = norm(j[k]);
    if (q.length < READER.min_quote || q.length > READER.max_quote) return { ok: false, status: "rejected", why: k + " length" };
    if (!abs.includes(q)) return { ok: false, status: "rejected", why: k + " not found verbatim in the abstract" };
  }
  if (!MARKERS[j.design].every(re => re.test(j.design_quote))) return { ok: false, status: "rejected", why: "design quote does not name the design" };
  return { ok: true, status: "accepted", design: j.design, direction: j.direction, finding: String(j.direction_quote).replace(/\s+/g, " ").trim(), design_quote: String(j.design_quote).replace(/\s+/g, " ").trim() };
}
