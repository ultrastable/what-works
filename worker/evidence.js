// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The re-grade loop behind the atlas. Each beat takes the programmes checked longest ago and:
//   1. resolves every curated trial to a DOI through Crossref, accepted only when title and year match (a wrong match is worse than none);
//   2. searches three independent indexes for trials and reviews published since the programme was last checked: OpenAlex (covers economics,
//      criminology and education), Europe PMC (health and social science) and Crossref. Any one route alone keeps the loop running, and a
//      source that answers 429 or 5xx is rested for an hour instead of being hammered;
//   3. hands new leads to the reader (reader.js), which may label a lead's design and direction only with a verbatim quote from its abstract;
//      an accepted lead joins the programme's trials at half weight and the grade is recomputed. Every grade change is logged with its reason.
// Pure functions take an injected fetch, so tests run with no network.
import { PROGRAMMES } from "./programmes.js";

export const EVIDENCE = {
  batch: 3,                 // programmes checked per beat; 15 programmes are each re-checked about every 5 hours
  recheck_days: 7,          // freshness: every programme checked within this many days (GET /api/freshness answers 503 otherwise)
  retry_unresolved_days: 14,
  leads_per_source: 5,
  timeout_ms: 10000,        // one slow index never holds the beat
  cool_minutes: 60,         // a source that answers 429 or 5xx is rested this long, so the loop never hammers a struggling index
  ua: "what-works-evidence-loop/1 (+https://what-works.ultrastable.org/rubric)",
  // QUERY-SCOPE-1: a programme's search since its last check should match tens or hundreds of works. On launch an unanchored query matched about
  // ten million. An index that reports more matches than this refuses the batch: nothing is stored and the error names the query and the count.
  max_hits: 20000
};
export function tooBroad(source, count, p) {
  if (!(Number(count) > EVIDENCE.max_hits)) return null;
  return Object.assign(new Error(`${source} query too broad for ${p.id}: ${count} matches (limit ${EVIDENCE.max_hits})`), { source, broad: true });
}

const words = s => String(s || "").toLowerCase().replace(/<[^>]+>/g, " ").split(/[^a-z0-9]+/).filter(w => w.length > 2);
export function titleMatch(cited, found) {
  const a = words(cited), b = new Set(words(found));
  if (!a.length) return 0;
  return a.filter(w => b.has(w)).length / a.length;
}
export const trialKey = (programmeId, i) => programmeId + "#" + i;

export async function resolveTrial(t, fetchFn) {
  // A pinned DOI is checked directly: the work must exist and carry the cited title and year. A bibliographic search ranks by relevance and
  // can miss a well-known paper (the 1997 Elmira follow-up in JAMA did not come back in the top rows), so a pin is the stronger proof.
  if (t.doi) {
    const r = await get(fetchFn, "https://api.crossref.org/works/" + encodeURIComponent(t.doi));
    if (r.status === 404) return null;
    if (!r.ok) throw SOURCE_ERR("crossref", r);
    const it = (await r.json()).message || {};
    const title = Array.isArray(it.title) ? it.title[0] : it.title;
    const yr = it.issued && it.issued["date-parts"] && it.issued["date-parts"][0] && it.issued["date-parts"][0][0];
    return titleMatch(t.title, title) >= 0.8 && (!yr || Math.abs(Number(yr) - t.year) <= 1) ? { doi: String(it.DOI || t.doi).toLowerCase(), title, year: yr || null } : null;
  }
  const q = [t.title, t.authors, t.venue, t.year].join(" ");
  const url = "https://api.crossref.org/works?rows=3&select=DOI,title,issued,container-title&query.bibliographic=" + encodeURIComponent(q.slice(0, 300));
  const r = await get(fetchFn, url);
  if (!r.ok) throw SOURCE_ERR("crossref", r);
  const items = ((await r.json()).message || {}).items || [];
  for (const it of items) {
    const title = Array.isArray(it.title) ? it.title[0] : it.title;
    const yr = it.issued && it.issued["date-parts"] && it.issued["date-parts"][0] && it.issued["date-parts"][0][0];
    if (titleMatch(t.title, title) >= 0.8 && (!yr || Math.abs(Number(yr) - t.year) <= 1)) return { doi: String(it.DOI).toLowerCase(), title, year: yr || null };
  }
  return null;
}

// OpenAlex stores abstracts as an inverted index; rebuild the text in word order.
export function openAlexAbstract(inv) {
  if (!inv || typeof inv !== "object") return null;
  const at = [];
  for (const [w, pos] of Object.entries(inv)) for (const p of pos) at[p] = w;
  return at.filter(Boolean).join(" ").slice(0, 4000) || null;
}

const known = (p, title) => p.trials.some(t => titleMatch(t.title, title) >= 0.8);

// The programme's anchor terms: its quoted phrases, or else its leading term and any "OR term" alternatives. A bare word list joined with OR
// matched ten million works (an "OR evaluation" tail matched anything), so every index query is anchored on the programme's own name.
export function anchors(query) {
  const phrases = [...String(query).matchAll(/"([^"]+)"/g)].map(m => m[1].trim()).filter(Boolean);
  if (phrases.length) return phrases;
  const w = String(query).trim().split(/\s+/), out = [w[0]];
  for (let i = 1; i + 1 < w.length && w[i] === "OR"; i += 2) out.push(w[i + 1]);
  return out.filter(Boolean);
}
export const DESIGN_TERMS = ["randomized", "randomised", "trial", "regression discontinuity", "systematic review", "meta-analysis", "evaluation"];
const quoteAll = l => l.map(x => '"' + x.replace(/"/g, "") + '"').join(" OR ");
export function openAlexSearch(p) { return "(" + quoteAll(anchors(p.query)) + ") AND (" + quoteAll(DESIGN_TERMS) + ")"; }

const SOURCE_ERR = (name, r) => Object.assign(new Error(name + " " + r.status), { status: r.status, source: name });
const get = (fetchFn, url, opts = {}) => fetchFn(url, { headers: { "user-agent": EVIDENCE.ua, accept: "application/json" },
  ...(typeof AbortSignal !== "undefined" && AbortSignal.timeout ? { signal: AbortSignal.timeout(EVIDENCE.timeout_ms) } : {}), ...opts });

export async function openAlexLeads(p, since, fetchFn, cfg = {}) {
  const url = "https://api.openalex.org/works?per-page=" + EVIDENCE.leads_per_source + "&sort=publication_date:desc&filter=from_publication_date:" + since +
    "&search=" + encodeURIComponent(openAlexSearch(p)) + (cfg.openalex_key ? "&api_key=" + encodeURIComponent(cfg.openalex_key) : "") + (cfg.mailto ? "&mailto=" + encodeURIComponent(cfg.mailto) : "");
  const r = await get(fetchFn, url);
  if (!r.ok) throw SOURCE_ERR("openalex", r);
  const body = await r.json(), wide = tooBroad("openalex", body.meta && body.meta.count, p); if (wide) throw wide;
  return ((body.results) || []).map(x => ({
    ref: x.doi ? "doi:" + String(x.doi).replace(/^https?:\/\/doi\.org\//, "").toLowerCase() : "openalex:" + String(x.id || "").split("/").pop(),
    title: String(x.title || x.display_name || "").slice(0, 400), year: Number(x.publication_year) || null,
    venue: String((x.primary_location && x.primary_location.source && x.primary_location.source.display_name) || "").slice(0, 200),
    abstract: openAlexAbstract(x.abstract_inverted_index), url: x.doi || x.id || null, via: "openalex"
  })).filter(l => l.title && !known(p, l.title));
}

export async function europePmcLeads(p, since, fetchFn, cfg = {}) {
  const q = `(${p.query}) AND (PUB_TYPE:"randomized-controlled-trial" OR PUB_TYPE:"systematic-review" OR PUB_TYPE:"meta-analysis" OR TITLE:"randomized" OR TITLE:"randomised") AND FIRST_PDATE:[${since} TO 3000-01-01]`;
  const url = "https://www.ebi.ac.uk/europepmc/webservices/rest/search?format=json&resultType=core&pageSize=" + EVIDENCE.leads_per_source + "&sort=FIRST_PDATE_D%20desc&query=" + encodeURIComponent(q);
  const r = await get(fetchFn, url);
  if (!r.ok) throw SOURCE_ERR("europepmc", r);
  const body = await r.json(), wide = tooBroad("europepmc", body.hitCount, p); if (wide) throw wide;
  return (((body.resultList) || {}).result || []).map(x => ({
    ref: x.doi ? "doi:" + String(x.doi).toLowerCase() : x.pmid ? "pmid:" + x.pmid : "epmc:" + x.id,
    title: String(x.title || "").slice(0, 400), year: Number(x.pubYear) || null, venue: String(x.journalTitle || "").slice(0, 200),
    abstract: x.abstractText ? String(x.abstractText).replace(/<[^>]+>/g, " ").slice(0, 4000) : null,
    url: x.doi ? "https://doi.org/" + x.doi : x.pmid ? "https://europepmc.org/article/MED/" + x.pmid : null, via: "europepmc"
  })).filter(l => l.title && !known(p, l.title));
}

// Third route, proven from the Worker: Crossref's own index of new journal articles, anchored the same way. Crossref seldom carries an
// abstract, so most of its finds wait as unread leads; it keeps the programme checked when OpenAlex and Europe PMC are both refusing.
export async function crossrefLeads(p, since, fetchFn) {
  const q = anchors(p.query).join(" ") + " randomized trial evaluation";
  const url = "https://api.crossref.org/works?rows=" + EVIDENCE.leads_per_source + "&sort=published&order=desc&select=DOI,title,issued,container-title,abstract" +
    "&filter=from-pub-date:" + since + ",type:journal-article&query.bibliographic=" + encodeURIComponent(q.slice(0, 300));
  const r = await get(fetchFn, url);
  if (!r.ok) throw SOURCE_ERR("crossref", r);
  const anchor = anchors(p.query).map(a => a.toLowerCase());
  return ((((await r.json()).message) || {}).items || []).map(x => ({
    ref: "doi:" + String(x.DOI || "").toLowerCase(), title: String((Array.isArray(x.title) ? x.title[0] : x.title) || "").slice(0, 400),
    year: (x.issued && x.issued["date-parts"] && x.issued["date-parts"][0] && x.issued["date-parts"][0][0]) || null,
    venue: String((Array.isArray(x["container-title"]) ? x["container-title"][0] : x["container-title"]) || "").slice(0, 200),
    abstract: x.abstract ? String(x.abstract).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 4000) : null,
    url: x.DOI ? "https://doi.org/" + x.DOI : null, via: "crossref"
  })).filter(l => l.title && l.ref !== "doi:" && !known(p, l.title) && anchor.some(a => (l.title + " " + (l.abstract || "")).toLowerCase().includes(a.toLowerCase())));
}

export const SOURCES = [["openalex", openAlexLeads], ["europepmc", europePmcLeads], ["crossref", crossrefLeads]];

export function pickBatch(checked, n = EVIDENCE.batch, list = PROGRAMMES) {
  return [...list].sort((a, b) => (checked[a.id] || 0) - (checked[b.id] || 0) || a.id.localeCompare(b.id)).slice(0, n);
}

// One beat of the search half of the loop. A programme counts as checked when at least one index answered; each failure is recorded and the
// loop goes on (a failed source stays unresolved and is retried; a programme no index answered is picked first next time).
// cfg: { openalex_key, mailto, deadline (ms epoch: stop starting programmes after it), cooled: Set of sources resting, onCool(source, status) }
export async function checkProgrammes(db, now, fetchFn, list = PROGRAMMES, cfg = {}) {
  const checked = Object.fromEntries((((await db.prepare("SELECT programme, at FROM checks").all()).results) || []).map(r => [r.programme, r.at]));
  const rows = Object.fromEntries((((await db.prepare("SELECT key, doi, tried FROM citations").all()).results) || []).map(r => [r.key, r]));
  const out = { checked: [], resolved: 0, leads: 0, errors: [], sources: {} };
  const cooled = new Set(cfg.cooled || []), rest = async (e) => {
    const st = e && e.status, src = e && e.source;
    if (src && (st === 429 || st >= 500) && !cooled.has(src)) { cooled.add(src); out.sources[src] = "rested after " + st; if (cfg.onCool) await cfg.onCool(src, st); }
  };
  for (const p of pickBatch(checked, EVIDENCE.batch, list)) {
    if (cfg.deadline && Date.now() > cfg.deadline) { out.errors.push("deadline: stopped before " + p.id); break; }
    for (let i = 0; i < p.trials.length; i++) {
      const k = trialKey(p.id, i), row = rows[k];
      if (row && (row.doi || now - row.tried < EVIDENCE.retry_unresolved_days * 86400000)) continue;
      if (cooled.has("crossref")) continue;
      try {
        const hit = await resolveTrial(p.trials[i], fetchFn);
        await db.prepare("INSERT INTO citations (key, programme, doi, found_title, tried) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(key) DO UPDATE SET doi=excluded.doi, found_title=excluded.found_title, tried=excluded.tried")
          .bind(k, p.id, hit ? hit.doi : null, hit ? String(hit.title).slice(0, 400) : null, now).run();
        if (hit) out.resolved++;
      } catch (e) { out.errors.push(p.id + " citation " + i + ": " + (e && e.message)); await rest(e); }
    }
    const since = new Date(checked[p.id] || Date.UTC(2024, 0, 1)).toISOString().slice(0, 10);
    let answered = 0;
    for (const [name, fn] of SOURCES) {
      if (cooled.has(name)) continue;
      try {
        for (const l of await fn(p, since, fetchFn, cfg)) {
          const r = await db.prepare("INSERT OR IGNORE INTO leads (programme, ref, title, venue, year, url, abstract, via, found, status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'new')")
            .bind(p.id, l.ref, l.title, l.venue, l.year, l.url, l.abstract, l.via, now).run();
          out.leads += (r.meta && r.meta.changes) || 0;
        }
        answered++; out.sources[name] = out.sources[name] || "ok";
      } catch (e) { out.errors.push(p.id + " " + name + ": " + (e && e.message)); await rest(e); }
    }
    if (answered) {
      await db.prepare("INSERT INTO checks (programme, at) VALUES (?1, ?2) ON CONFLICT(programme) DO UPDATE SET at=excluded.at").bind(p.id, now).run();
      out.checked.push(p.id);
    }
  }
  return out;
}

export function freshness(checked, now, list = PROGRAMMES) {
  const max = EVIDENCE.recheck_days * 86400000;
  const stale = list.filter(p => !checked[p.id] || now - checked[p.id] > max).map(p => p.id);
  const ages = list.map(p => checked[p.id] ? (now - checked[p.id]) / 3600000 : null).filter(x => x !== null);
  return { ok: stale.length === 0, programmes: list.length, checked: list.length - stale.length, stale, oldest_check_hours: ages.length ? Math.round(Math.max(...ages)) : null,
    max_age_hours: EVIDENCE.recheck_days * 24, checked_at: new Date(now).toISOString() };
}
