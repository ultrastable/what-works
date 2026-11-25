// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-PROMO-1: What Works serves its own social queue at /social-queue.json, built by the shared seed/worker/src/promoqueue.js and drained by
// the core publisher within social/gate.json, and links the other live systems on Ultrastable, read from doctrine/stakeholders.json.
import { promoQueue } from "../vendor/ultrastable/promoqueue.js";
import SH from "../vendor/ultrastable/stakeholders.json" with { type: "json" };
import { PROGRAMMES, AREAS } from "./programmes.js";

export const SITE = "https://what-works.ultrastable.org";
export const HOOK = "What Works runs on Ultrastable.";
export const START = "2026-12-01", EVERY_DAYS = 2;

export const SIBLINGS = (SH.showcases || []).filter(c => c.status === "live" && c.home && c.id !== "what-works").map(c => ({ id: c.id, name: c.name, home: c.home }));

// Programmes in turn across areas, so consecutive posts are about different fields.
export function order(list = PROGRAMMES, areas = AREAS) {
  const by = areas.map(a => list.filter(p => p.area === a.id)), out = [];
  for (let i = 0; by.some(l => i < l.length); i++) for (const l of by) if (i < l.length) out.push(l[i]);
  return out;
}

// The post never states the verdict: it asks the reader to guess, and the page reveals the current grade.
export function postText(p, g) {
  return `${p.name}: does it work? ${g.experiments} ${g.experiments === 1 ? "study" : "studies"} graded by design. Guess first, then see the trials:`;
}

export function socialQueue(grades, now = Date.now()) {
  const items = order().map(p => ({ id: p.id, path: "/p/" + p.id, text: postText(p, grades[p.id]), kind: "programme" }));
  return promoQueue({ tenant: "what-works", site: SITE, hook: HOOK, items, start: START, every_days: EVERY_DAYS, now });
}
