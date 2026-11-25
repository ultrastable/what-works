// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// STATIC-IS-NOT-AUTONOMOUS-1 (Rowan, 2026-11-25: "Static content is NOT autonomous and is contrary to objective of an Ultrastable system.")
// The atlas grows its own catalogue. Its fifteen curated programmes are a seed, not the atlas. Each discovery pass:
//   1. walks the systematic reviews of social programmes (Campbell Systematic Reviews, ISSN 1891-1803) through Crossref, with OpenAlex as the
//      second route, oldest first so the whole back catalogue is read in time and each new review joins as it is published; protocols and
//      editorials are skipped because they carry no findings;
//   2. lets a model label a review only under the reader's verbatim guard (reader.js), plus two more: the programme's name must be copied from
//      the review's title and the outcome from its title or abstract, so no name, outcome or claim is invented;
//   3. a labelled review of a programme the atlas already holds joins that programme as read-in evidence; a review of a new programme creates
//      it (D1 found_programmes) graded by the same rubric from that review alone at half weight, and every later beat searches for more.
// Pure functions take an injected fetch, so tests run with no network.
import { DESIGNS, DIRECTIONS } from "./grade.js";
import { AREAS, PROGRAMMES } from "./programmes.js";
import { checkReading, parseJson } from "./reader.js";
import { titleMatch, openAlexAbstract, EVIDENCE } from "./evidence.js";

export const DISCOVER = {
  // GLOBAL-1: Campbell reviews pool trials from every region; the Journal of Development Effectiveness (3ie) carries evaluations of public
  // programmes in low- and middle-income countries, so the catalogue grows beyond the rich countries most famous trials ran in.
  journals: [{ issn: "1891-1803", name: "Campbell Systematic Reviews" }, { issn: "1943-9342", name: "Journal of Development Effectiveness", any_design: true }],
  page: 20,                       // reviews fetched per discovery pass
  every_ms: 6 * 3600000,          // a discovery pass at most every six hours
  reads_per_beat: 2,              // candidate reviews labelled per beat (shares the daily AI cap)
  stale_ms: 30 * 3600000,         // /health discovery.ok goes false when no pass answered for this long
  same_programme: 0.6             // title overlap at which a review is attached to an existing programme instead of creating one
};

export const SKIP_TITLE = /^\s*(protocol|editorial|correction|erratum|retraction|title registration)\b|^\s*(plain language summary)\b/i;
const strip = s => String(s || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const get = (fetchFn, url) => fetchFn(url, { headers: { "user-agent": EVIDENCE.ua, accept: "application/json" },
  ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(EVIDENCE.timeout_ms) } : {}) });

export async function crossrefReviews(issn, offset, fetchFn) {
  const url = `https://api.crossref.org/journals/${issn}/works?rows=${DISCOVER.page}&offset=${offset}&sort=published&order=asc&select=DOI,title,issued,abstract,container-title,type`;
  const r = await get(fetchFn, url);
  if (!r.ok) throw Object.assign(new Error("crossref " + r.status), { status: r.status });
  const items = (((await r.json()).message) || {}).items || [];
  return { n: items.length, reviews: items.map(x => ({
    ref: "doi:" + String(x.DOI || "").toLowerCase(), title: strip(Array.isArray(x.title) ? x.title[0] : x.title).slice(0, 400),
    year: (x.issued && x.issued["date-parts"] && x.issued["date-parts"][0] && x.issued["date-parts"][0][0]) || null,
    venue: strip(Array.isArray(x["container-title"]) ? x["container-title"][0] : x["container-title"]).slice(0, 200),
    abstract: x.abstract ? strip(x.abstract).replace(/^abstract\s*/i, "").slice(0, 4000) : null, url: x.DOI ? "https://doi.org/" + x.DOI : null, via: "crossref" })) };
}

export async function openAlexReviews(issn, offset, fetchFn) {
  const page = Math.floor(offset / DISCOVER.page) + 1;
  const url = `https://api.openalex.org/works?filter=primary_location.source.issn:${issn}&sort=publication_date:asc&per-page=${DISCOVER.page}&page=${page}`;
  const r = await get(fetchFn, url);
  if (!r.ok) throw Object.assign(new Error("openalex " + r.status), { status: r.status });
  const items = ((await r.json()).results) || [];
  return { n: items.length, reviews: items.map(x => ({
    ref: x.doi ? "doi:" + String(x.doi).replace(/^https?:\/\/doi\.org\//, "").toLowerCase() : "openalex:" + String(x.id || "").split("/").pop(),
    title: strip(x.title || x.display_name).slice(0, 400), year: Number(x.publication_year) || null,
    venue: strip(x.primary_location && x.primary_location.source && x.primary_location.source.display_name).slice(0, 200),
    abstract: openAlexAbstract(x.abstract_inverted_index), url: x.doi || x.id || null, via: "openalex" })) };
}

export const slugOf = s => String(s || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "programme";

export function discoverPrompt(review) {
  return [
    { role: "system", content: "You label systematic reviews for a public evidence atlas of government and public programmes. You never summarise or add facts. Reply with JSON only." },
    { role: "user", content: `Title: ${review.title}\nAbstract: ${review.abstract}\n\n` +
      `Reply with JSON: {"relevant": true|false, "programme": "the programme or policy, copied word for word from the title", "outcome": "the main outcome, copied word for word from the title or abstract", ` +
      `"area": one of ${JSON.stringify(AREAS.map(a => a.id))}, "design": one of ${JSON.stringify(Object.keys(DESIGNS))}, "direction": one of ${JSON.stringify(Object.keys(DIRECTIONS))}, ` +
      `"design_quote": "exact words from the abstract that state the review design", "direction_quote": "exact sentence from the abstract that states the effect on the outcome"}. ` +
      `relevant is true only if the study evaluates a programme, service or policy that a government or public body runs or funds. Copy every quote and name exactly.` }
  ];
}

const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

// checkDiscovery(modelText, review) -> { status: accepted|unrelated|rejected, programme, outcome, area, design, direction, finding, why }
export function checkDiscovery(text, review, { anyDesign = false } = {}) {
  const j = parseJson(text);
  if (!j) return { status: "rejected", why: "not JSON" };
  if (j.relevant === false) return { status: "unrelated" };
  const name = String(j.programme || "").replace(/\s+/g, " ").trim(), outcome = String(j.outcome || "").replace(/\s+/g, " ").trim();
  if (name.length < 3 || name.length > 90 || !norm(review.title).includes(norm(name))) return { status: "rejected", why: "programme name not copied from the title" };
  if (outcome.length < 3 || outcome.length > 140 || !norm(review.title + " " + review.abstract).includes(norm(outcome))) return { status: "rejected", why: "outcome not copied from the review" };
  if (!AREAS.some(a => a.id === j.area)) return { status: "rejected", why: "unknown area" };
  if (!DESIGNS[j.design] || (!anyDesign && !DESIGNS[j.design].synthesis)) return { status: "rejected", why: "a review must be labelled as a review" };
  const c = checkReading(text, review.abstract);  // relevance, design and direction, each backed by a verbatim quote that names the design
  if (c.status !== "accepted") return { status: c.status, why: c.why };
  return { status: "accepted", programme: name, outcome, area: j.area, design: c.design, direction: c.direction, finding: c.finding };
}

// The programme a review belongs to, if the atlas already holds it: its name overlaps an existing name or one of its quoted search anchors.
export function matchProgramme(name, list = PROGRAMMES) {
  let best = null, score = 0;
  for (const p of list) {
    const s = Math.max(titleMatch(name, p.name), titleMatch(p.name, name), ...[...String(p.query || "").matchAll(/"([^"]+)"/g)].map(m => titleMatch(m[1], name)));
    if (s > score) { best = p; score = s; }
  }
  return score >= DISCOVER.same_programme ? best : null;
}

// Crossref often lacks a review's abstract; the reader needs one. Two more routes find it by DOI: OpenAlex, then Europe PMC.
export async function abstractByDoi(doi, fetchFn) {
  const errors = [];
  try {
    const r = await get(fetchFn, "https://api.openalex.org/works/doi:" + encodeURIComponent(doi));
    if (r.ok) { const a = openAlexAbstract((await r.json()).abstract_inverted_index); if (a) return { abstract: a, via: "openalex" }; } else errors.push("openalex " + r.status);
  } catch (e) { errors.push("openalex " + (e && e.message)); }
  try {
    const r = await get(fetchFn, "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=1&query=" + encodeURIComponent('DOI:"' + doi + '"'));
    if (r.ok) { const x = ((((await r.json()).resultList) || {}).result || [])[0]; if (x && x.abstractText) return { abstract: strip(x.abstractText).slice(0, 4000), via: "europepmc" }; } else errors.push("europepmc " + r.status);
  } catch (e) { errors.push("europepmc " + (e && e.message)); }
  return { abstract: null, errors };
}
