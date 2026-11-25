// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// The atlas's pages, rendered on the server from programmes.js and the computed grades, so every page works with no script and is indexable.
// Script only adds the guess. Light and dark, 16 px body, 44 px targets, visible focus, reduced motion respected. No cookies, no trackers;
// the reader's last visit is kept in their own browser to mark what was re-graded since.
import { PROGRAMMES, AREAS, areaOf } from "./programmes.js";
import { INCOME } from "./countries.js";
import { DESIGNS, DIRECTIONS, VERDICTS, STRENGTHS, GUESS, RUBRIC } from "./grade.js";
import { EVIDENCE } from "./evidence.js";
import { SITE, HOOK, SIBLINGS } from "./promote.js";

export const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const date = ms => new Date(ms).toISOString().slice(0, 10);

const CSS = `:root{--bg:#f6f7f5;--fg:#17201d;--muted:#56605c;--card:#fff;--line:#dde3df;--accent:#0f6e64;--accent-fg:#fff;--chip:#e9eeeb;
--works:#1d7a3e;--promising:#0f6e64;--mixed:#8a5a00;--none:#5d6670;--harm:#b42318}
@media (prefers-color-scheme:dark){:root{--bg:#121715;--fg:#e9efec;--muted:#a7b3ae;--card:#1b2220;--line:#33403b;--accent:#5fd0c1;--accent-fg:#06201c;--chip:#25302c;
--works:#7fd49a;--promising:#5fd0c1;--mixed:#f2b45c;--none:#aab4bd;--harm:#f39087}}
*{box-sizing:border-box}html{-webkit-text-size-adjust:100%}body{margin:0;background:var(--bg);color:var(--fg);font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif}
a{color:var(--accent)}a:focus-visible,button:focus-visible,summary:focus-visible{outline:3px solid var(--accent);outline-offset:2px}
header.top{border-bottom:1px solid var(--line);background:var(--card)}header.top nav{max-width:1040px;margin:0 auto;padding:6px 16px;display:flex;gap:4px;align-items:center;flex-wrap:wrap}
header.top a{display:inline-flex;align-items:center;min-height:44px;padding:0 10px;border-radius:10px;text-decoration:none;color:var(--fg)}header.top a:hover{background:var(--chip)}
header.top a.brand{font-weight:800;font-size:1.1rem;margin-right:auto}header.top a.brand span{color:var(--accent)}
main{max-width:1040px;margin:0 auto;padding:24px 16px 72px}h1{font-size:clamp(1.7rem,5vw,2.5rem);line-height:1.15;margin:8px 0 10px;letter-spacing:-.02em}
h2{font-size:1.3rem;margin:36px 0 12px}h3{font-size:1.05rem;margin:0 0 4px}.lede{font-size:1.1rem;color:var(--muted);max-width:720px;margin:0 0 20px}.muted{color:var(--muted)}.small{font-size:.9rem}
.grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:14px}.tiles{display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:12px}
.tile{display:block;padding:16px;border-radius:16px;text-decoration:none;color:var(--fg);border:1px solid var(--line);background:linear-gradient(160deg,hsl(var(--h) 60% 50% / .16),hsl(var(--h) 60% 50% / .03));min-height:96px}
.tile b{display:block}.card{display:flex;flex-direction:column;gap:6px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:14px 16px;text-decoration:none;color:var(--fg);min-height:44px}
.card:hover{border-color:var(--accent)}.badge{display:inline-flex;align-items:center;gap:6px;font-weight:750;font-size:.9rem;padding:3px 10px;border-radius:99px;border:2px solid currentColor;align-self:flex-start}
.v-works{color:var(--works)}.v-promising{color:var(--promising)}.v-mixed{color:var(--mixed)}.v-no-effect,.v-insufficient{color:var(--none)}.v-backfires{color:var(--harm)}
.meter{display:inline-flex;gap:3px;vertical-align:middle}.meter i{width:12px;height:12px;border-radius:3px;background:var(--line)}.meter i.on{background:var(--fg)}
.tag{display:inline-block;font-size:.8rem;font-weight:650;padding:2px 9px;border-radius:99px;background:var(--chip);color:var(--muted)}.row{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.stats{display:flex;flex-wrap:wrap;gap:22px;margin:6px 0 24px}.stats b{display:block;font-size:1.6rem;line-height:1.1}
.step{background:var(--card);border:1px solid var(--line);border-radius:16px;padding:16px 18px;margin:16px 0}.step .k{font-size:.78rem;text-transform:uppercase;letter-spacing:.08em;font-weight:800;color:var(--accent);margin-bottom:4px}
.opts{display:grid;gap:8px;margin-top:10px;grid-template-columns:repeat(auto-fit,minmax(200px,1fr))}.opts button{font:inherit;text-align:left;min-height:48px;padding:10px 14px;border-radius:12px;border:1px solid var(--line);background:var(--bg);color:var(--fg);cursor:pointer}
.opts button.right{border-color:var(--works);font-weight:700}.opts button.wrong{border-color:var(--harm)}
.bar{display:flex;height:14px;border-radius:7px;overflow:hidden;background:var(--line);margin:8px 0}.bar span{display:block}.bar .p{background:var(--works)}.bar .n{background:var(--none)}.bar .h{background:var(--harm)}
.trial{border-top:1px solid var(--line);padding:12px 0}.trial:first-child{border-top:0}table{border-collapse:collapse;width:100%}td,th{text-align:left;padding:8px 10px;border-bottom:1px solid var(--line);vertical-align:top}
.wrap{overflow-x:auto}.new{font-size:.78rem;font-weight:800;color:var(--accent-fg);background:var(--accent);padding:1px 7px;border-radius:99px;margin-left:6px}[hidden]{display:none!important}
footer{border-top:1px solid var(--line);margin-top:48px;padding:20px 16px;color:var(--muted);font-size:.9rem}footer div{max-width:1040px;margin:0 auto}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}`;

function shell(title, desc, inner, { path = "/", script = "", ld = null } = {}) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title><meta name="description" content="${esc(desc)}"><link rel="canonical" href="${SITE}${esc(path)}">
<link rel="alternate" type="application/feed+json" title="What Works: re-grades" href="/feed.json"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}">
<link rel="describedby" type="application/ld+json" href="/api/catalog"><link rel="service-desc" type="application/openapi+json" href="/openapi.json">
${ld ? `<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, "\\u003c")}</script>` : ""}<style>${CSS}</style></head><body><header class="top"><nav aria-label="Main"><a class="brand" href="/">What&nbsp;<span>Works</span></a><a href="/#areas">Areas</a><a href="/changes">Re-grades</a><a href="/rubric">How we grade</a><a href="/connections">Connections</a><a href="/world">Around the world</a></nav></header>
<main>${inner}</main><footer><div>${esc(HOOK)} <a href="https://ultrastable.io/">Ultrastable</a> is the foundation for any autonomous system.${SIBLINGS.length ? " Also running on it: " + SIBLINGS.map(s => `<a href="${esc(s.home)}">${esc(s.name)}</a>`).join(", ") + "." : ""}
No cookies, no trackers. Data: <a href="/api/programmes">/api/programmes</a> · <a href="/api/metrics">/api/metrics</a> · <a href="/feed.json">feed</a> · <a href="/graph.json">graph</a></div></footer>${script}</body></html>`;
}

export function badge(g) { return `<span class="badge v-${esc(g.verdict)}">${esc(VERDICTS[g.verdict].name)}</span>`; }
export function meter(strength) { const n = STRENGTHS[strength].bars; return `<span class="meter" role="img" aria-label="${esc(STRENGTHS[strength].name)} evidence">${[1, 2, 3].map(i => `<i class="${i <= n ? "on" : ""}"></i>`).join("")}</span> <span class="small muted">${esc(STRENGTHS[strength].name)} evidence</span>`; }
function card(p, g, { reveal = true } = {}) {
  return `<a class="card" href="/p/${esc(p.id)}"><h3>${esc(p.name)}</h3><span class="small muted">${esc(p.outcome)}</span>${reveal ? `<div class="row">${badge(g)} ${meter(g.strength)}</div>` : `<span class="tag">Guess the verdict</span>`}</a>`;
}
function changeLine(c) {
  const p = PROGRAMMES.find(x => x.id === c.programme);
  const from = c.from_verdict ? `${esc(VERDICTS[c.from_verdict].name)} → ` : "";
  return `<li data-at="${c.at}"><a href="/p/${esc(c.programme)}">${esc(p ? p.name : c.programme)}</a>: ${from}<b>${esc(VERDICTS[c.to_verdict].name)}</b> (${esc(STRENGTHS[c.to_strength].name.toLowerCase())}) <span class="small muted">${date(c.at)}. ${esc(c.reason)}</span></li>`;
}
const SINCE = `<script>(()=>{let last=0;try{last=Number(localStorage.getItem("ww.last"))||0;localStorage.setItem("ww.last",String(Date.now()))}catch(e){}
if(!last)return;document.querySelectorAll("[data-at]").forEach(li=>{if(Number(li.dataset.at)>last){const s=document.createElement("span");s.className="new";s.textContent="new since your last visit";li.append(s)}})})()</script>`;

export function home({ grades, changes, metrics }) {
  const inner = `<h1>What works in public policy</h1>
<p class="lede">A living atlas of public programmes, each graded by its trials and re-graded as new evidence lands. Guess first, then see what the evaluations found.</p>
<div class="stats"><div><b>${metrics.programmes}</b><span class="muted small">programmes</span></div><div><b>${metrics.trials_curated}</b><span class="muted small">trials and reviews</span></div>
<div><b>${metrics.regrades_30d}</b><span class="muted small">re-grades in 30 days</span></div><div><b>${Math.round(metrics.evidence_fresh_share * 100)}%</b><span class="muted small">checked for new evidence this week</span></div></div>
<h2 id="areas">Areas</h2><div class="tiles">${AREAS.filter(a => PROGRAMMES.some(p => p.area === a.id)).map(a => `<a class="tile" style="--h:${a.hue}" href="/area/${a.id}"><b>${esc(a.name)}</b><span class="muted small">${PROGRAMMES.filter(p => p.area === a.id).length} programmes</span></a>`).join("")}</div>
<h2>Latest re-grades</h2>${changes.length ? `<ul>${changes.map(changeLine).join("")}</ul><p><a href="/changes">Every re-grade</a></p>` : `<p class="muted">The first grading pass has not run yet. It runs every hour.</p>`}
<h2>Did it work? Guess first</h2><div class="grid">${PROGRAMMES.map(p => card(p, grades[p.id], { reveal: false })).join("")}</div>`;
  return shell("What Works: a living atlas of public policy evidence", "Public programmes graded by their trials and re-graded as evidence lands.", inner, { script: SINCE });
}

export function areaPage(a, grades) {
  const list = PROGRAMMES.filter(p => p.area === a.id).sort((x, y) => VERDICTS[grades[y.id].verdict].rank - VERDICTS[grades[x.id].verdict].rank);
  return shell(`${a.name}: what works · What Works`, `What the trials say about ${a.name.toLowerCase()} programmes.`,
    `<p class="small"><a href="/">Atlas</a></p><h1>${esc(a.name)}</h1><p class="lede">Ordered from best supported to backfiring. Each grade is computed from the trials below it.</p><div class="grid">${list.map(p => card(p, grades[p.id])).join("")}</div>`, { path: "/area/" + a.id });
}

function trialBlock(t, cite) {
  const d = DESIGNS[t.design], dir = DIRECTIONS[t.direction];
  const doi = cite && cite.doi ? `<a href="https://doi.org/${esc(cite.doi)}">doi:${esc(cite.doi)}</a>` : cite ? `<span class="muted">No exact match in Crossref yet; retried every ${EVIDENCE.retry_unresolved_days} days.</span>` : `<span class="muted">Citation check pending.</span>`;
  return `<div class="trial"><div class="row"><span class="tag">${esc(d.short)}</span><span class="tag">${esc(dir.name)}</span>${t.machine ? `<span class="tag">Read in by the loop, half weight</span>` : ""}</div>
<p style="margin:6px 0">${esc(t.finding)}</p><p class="small muted" style="margin:0">${esc(t.authors)} (${esc(t.year)}). <i>${esc(t.title)}</i>. ${esc(t.venue)}. ${t.machine ? (t.url ? `<a href="${esc(t.url)}">source</a>` : "") : doi}</p></div>`;
}

export function programmePage(p, g, { citations = {}, leads = [], changes = [], accepted = [], settings = [], ld = null } = {}) {
  const a = areaOf(p.area), pct = x => Math.round(x * 100);
  const unread = leads.filter(l => l.status === "new" || l.status === "rejected");
  const inner = `<p class="small"><a href="/">Atlas</a> · <a href="/area/${a.id}">${esc(a.name)}</a></p><h1>${esc(p.name)}</h1>
<p class="lede">${esc(p.what)}</p><p class="small muted">Graded on: <b>${esc(p.outcome)}</b>. Where: ${esc(p.where)}.</p>${p.found ? `<p class="small muted">Found by the atlas itself on ${esc(new Date(p.found.at).toISOString().slice(0, 10))}, from a systematic review it read${p.found.url ? ` (<a href="${esc(p.found.url)}">source</a>)` : ""}. It is graded only from what that review's abstract states, at half weight, until more evidence lands.</p>` : ""}
<section class="step" id="guess"><div class="k">Your guess</div><p style="margin:0">${p.feels ? esc(p.feels) + " " : ""}What do you think the ${p.found ? "review" : "trials"} found?</p>
<div class="opts">${GUESS.map(o => `<button type="button" data-g="${o.id}">${esc(o.label)}</button>`).join("")}</div><p id="gmsg" class="small muted" role="status"></p>
<noscript><p class="small muted">The verdict is below.</p></noscript><p><button type="button" class="small" id="skip" style="font:inherit;min-height:44px;background:none;border:0;color:var(--accent);cursor:pointer;padding:0">Skip to the verdict</button></p></section>
<section class="step" id="verdict"><div class="k">What the evidence says</div><div class="row">${badge(g)} ${meter(g.strength)}</div>
<p>${esc(VERDICTS[g.verdict].say)}</p><div class="bar" role="img" aria-label="${pct(g.shares.positive)}% of evidence weight positive, ${pct(g.shares.null)}% no effect, ${pct(g.shares.negative)}% harmful">
<span class="p" style="width:${pct(g.shares.positive)}%"></span><span class="n" style="width:${pct(g.shares.null)}%"></span><span class="h" style="width:${pct(g.shares.negative)}%"></span></div>
<p class="small muted">${esc(g.basis)} <a href="/rubric">How the grade is computed</a>.</p></section>
<h2>Where the evidence comes from</h2>${settings.length ? `<p>${settings.map(x => `${esc(x.name)}${x.region !== "pooled" ? ` <span class="small muted">(${esc(INCOME[x.income] || "")}, ${esc(x.region)})</span>` : ""}`).join(" · ")}</p>` : `<p class="muted">The sources do not name a country the atlas recognises yet.</p>`}<p class="small muted"><a href="/world">Lessons across countries</a></p>
<h2>The trials</h2><div>${p.trials.map((t, i) => trialBlock(t, citations[i])).join("")}${accepted.map(t => trialBlock(t, null)).join("")}</div>
${unread.length ? `<h2>New publications not yet read in</h2><p class="small muted">Found by the hourly search. They count toward the grade only once their design and effect are confirmed from the abstract's own words.</p><ul>${unread.map(l => `<li>${l.url ? `<a href="${esc(l.url)}">${esc(l.title)}</a>` : esc(l.title)} <span class="small muted">${esc(l.venue || "")} ${esc(l.year || "")}</span></li>`).join("")}</ul>` : ""}
<h2>Grade history</h2>${changes.length ? `<ul>${changes.map(changeLine).join("")}</ul>` : `<p class="muted">Not graded yet; the first pass runs within the hour.</p>`}`;
  const script = `<script>(()=>{const v=document.getElementById("verdict"),t=document.querySelector(".trial")&&document.querySelector(".trial").parentElement;let seen=false;try{seen=!!sessionStorage.getItem("ww.g.${p.id}")}catch(e){}
if(!seen){v.hidden=true;if(t)t.hidden=true}const show=()=>{v.hidden=false;if(t)t.hidden=false;try{sessionStorage.setItem("ww.g.${p.id}","1")}catch(e){}};
document.getElementById("skip").onclick=()=>{show();v.scrollIntoView({behavior:"smooth"})};
document.querySelectorAll("[data-g]").forEach(b=>b.onclick=async()=>{const m=document.getElementById("gmsg");try{const r=await fetch("/api/guess",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({programme:"${p.id}",guess:b.dataset.g})});const j=await r.json();
if(!j.ok){m.textContent=j.message;return}b.classList.add(j.right?"right":"wrong");const tot=Object.values(j.counts).reduce((a,x)=>a+x,0);m.textContent=(j.right?"Right. ":"Not quite: the verdict is "+j.verdict_name+". ")+tot+" readers have guessed so far.";show()}catch(e){m.textContent="The connection dropped. The verdict is shown below.";show()}})})()</script>${SINCE}`;
  return shell(`${p.name}: does it work? · What Works`, `${p.what} What the trials found, graded by design.`, inner, { path: "/p/" + p.id, script, ld });
}

export function rubricPage() {
  const inner = `<h1>How we grade</h1><p class="lede">Every verdict is computed by the same code from the trials under a programme. Nothing is graded by hand, and this page is rendered from that code's own constants.</p>
<h2>1. Each study weighs by its design</h2><div class="wrap"><table><thead><tr><th>Design</th><th>Weight</th></tr></thead><tbody>${Object.values(DESIGNS).map(d => `<tr><td>${esc(d.name)}</td><td>${d.weight}</td></tr>`).join("")}</tbody></table></div>
<p class="muted">A study the hourly loop reads in from a new publication counts at ${RUBRIC.MACHINE_FACTOR} of its weight until a curator confirms it. A mixed finding counts half positive and half no effect.</p>
<h2>2. The verdict</h2><ol>
<li><b>${VERDICTS.insufficient.name}</b> when the total weight is under ${RUBRIC.MIN_WEIGHT}.</li>
<li><b>${VERDICTS.backfires.name}</b> when ${Math.round(RUBRIC.HARM_SHARE * 100)}% or more of the weight finds harm and harm outweighs benefit.</li>
<li><b>${VERDICTS.works.name}</b> when ${Math.round(RUBRIC.POS_SHARE * 100)}% or more is positive and the result is replicated: two independent positive randomized trials, or a positive synthesis of trials. <b>${VERDICTS.promising.name}</b> when it is positive but not yet replicated.</li>
<li><b>${VERDICTS["no-effect"].name}</b> when ${Math.round(RUBRIC.NULL_SHARE * 100)}% or more finds no effect.</li><li><b>${VERDICTS.mixed.name}</b> otherwise.</li></ol>
<p class="muted">Follow-ups of the same experiment count as one study, so a famous trial written up many times is not mistaken for replication.</p>
<h2>3. The strength</h2><p><b>Strong</b> when the total weight is ${RUBRIC.STRONG_WEIGHT} or more and rests on at least ${RUBRIC.STRONG_EXPERIMENTS} independent studies or a synthesis; <b>moderate</b> from ${RUBRIC.MODERATE_WEIGHT}, or with any synthesis; <b>limited</b> otherwise. When ${Math.round(RUBRIC.CONFLICT_SHARE * 100)}% or more of the weight disagrees with the main finding, strength is at most moderate. With no randomized evidence, strength is at most limited.</p>
<h2>4. Re-grading as evidence lands</h2><p>Every hour the atlas checks the ${EVIDENCE.batch} programmes checked longest ago, so each is re-checked well inside ${EVIDENCE.recheck_days} days (<a href="/api/freshness">freshness</a>). It matches every cited study to its DOI in Crossref, and searches OpenAlex, Europe PMC and Crossref for trials and reviews published since (a source that refuses is rested for an hour; any one keeps the loop going). A new publication joins the grade only when its design and its effect are each backed by a quote copied word for word from its own abstract. Every change of verdict or strength is logged with the study that moved it (<a href="/changes">re-grades</a>).</p>
<h2>5. What a grade does not say</h2><p class="muted">A grade is about the one outcome named on the programme, in the places it was tested. A programme graded mixed may work well in one setting and not another; the trial notes say where.</p>`;
  return shell("How we grade · What Works", "The rubric that computes every verdict in the atlas.", inner, { path: "/rubric" });
}

export function changesPage(changes) {
  return shell("Re-grades · What Works", "Every change of verdict or strength, with the evidence that moved it.",
    `<h1>Re-grades</h1><p class="lede">Every change of verdict or strength, newest first, with the evidence that moved it.</p>${changes.length ? `<ul>${changes.map(changeLine).join("")}</ul>` : `<p class="muted">No grades recorded yet.</p>`}`, { path: "/changes", script: SINCE });
}

export function notFound() { return shell("Not found · What Works", "Nothing here.", `<h1>Nothing here</h1><p><a href="/">Back to the atlas</a></p>`); }

export function worldPage(r) {
  const byId = Object.fromEntries(r.programmes.map(x => [x.id, x]));
  const kinds = { "gap-poorer": "Works in richer countries, untested in poorer ones", "gap-richer": "Works in low- and middle-income countries, untested in richer ones", contrast: "Same goal, different result, different settings" };
  const groups = ["low", "lower-middle", "upper-middle", "high"];
  const inner = `<h1>Around the world</h1><p class="lede">Where the atlas's evidence comes from, and what countries could learn from each other. Every question below is computed from the grades and from the countries the sources themselves name.</p>
<div class="stats">${groups.map(i => `<div><b>${r.coverage[i] || 0}</b><span class="muted small">programmes with evidence from ${esc(INCOME[i].toLowerCase())} countries</span></div>`).join("")}</div>
${Object.entries(kinds).map(([k, h]) => { const l = r.lessons.filter(x => x.kind === k); return l.length ? `<h2>${esc(h)}</h2><ul>${l.map(x => `<li>${esc(x.ask)} ${x.programmes.map(id => `<a href="/p/${esc(id)}">${esc(byId[id].name)}</a>`).join(" · ")}</li>`).join("")}</ul>` : ""; }).join("")}
<h2>Every programme by setting</h2><ul>${r.programmes.map(x => `<li><a href="/p/${esc(x.id)}">${esc(x.name)}</a>: ${esc(x.verdict_name)}. ${x.settings.length ? esc(x.settings.map(s => s.name).join(", ")) : `<span class="muted">no country named in its sources yet</span>`}</li>`).join("")}</ul>
<p class="small muted">${esc(r.note)} Data: <a href="/api/settings">/api/settings</a>.</p>`;
  return shell("Around the world · What Works", "What works in which countries, and what countries could learn from each other.", inner, { path: "/world" });
}

export function sitemap() {
  const urls = ["/", "/rubric", "/changes", "/connections", "/world", ...AREAS.map(a => "/area/" + a.id), ...PROGRAMMES.map(p => "/p/" + p.id)];
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.map(u => `<url><loc>${SITE}${u}</loc></url>`).join("")}</urlset>\n`;
}

// JSON Feed: re-grades as they happen, so readers (and the platform's stickiness reading) see the atlas move.
export function jsonFeed(grades, changes) {
  const items = changes.map(c => {
    const p = PROGRAMMES.find(x => x.id === c.programme) || { name: c.programme, area: "" };
    return { id: SITE + "/changes#" + c.id, url: SITE + "/p/" + c.programme, title: `${p.name}: ${VERDICTS[c.to_verdict].name}`, content_text: c.reason, date_published: new Date(c.at).toISOString(), tags: [p.area, c.kind] };
  });
  return { version: "https://jsonfeed.org/version/1.1", title: "What Works: re-grades", home_page_url: SITE + "/", feed_url: SITE + "/feed.json",
    description: "Public programmes graded by their trials and re-graded as evidence lands.", items };
}

// KGRAPH-1: what the atlas's knowledge graph found on its own (graph.js). Each item names the programmes it is about; nothing here is a grade.
const TYPE = { carry: "Lessons to carry across countries", disagree: "Same outcome, opposite verdicts", link: "Worth comparing", desert: "Where no evidence exists yet", bridge: "Bridges between areas", gap: "Gaps in the atlas" };
const INCOME_COLS = [["low", "Low"], ["lower-middle", "Lower-middle"], ["upper-middle", "Upper-middle"], ["high", "High"]];
const nodeLink = id => id.startsWith("programme:") ? `<a href="/p/${esc(id.slice(10))}">` : id.startsWith("area:") ? `<a href="/area/${esc(id.slice(5))}">` : null;
const names = (ids, label) => ids.map(id => `<a href="/p/${esc(id)}">${esc(label["programme:" + id] || id)}</a>`).join(", ");
export function connectionsPage(g) {
  const a = g.analysis, by = {};
  for (const i of a.insights) (by[i.type] = by[i.type] || []).push(i);
  const label = Object.fromEntries(g.nodes.map(n => [n.id, n.label]));
  const chips = ids => ids.map(id => { const l = nodeLink(id); return l ? `${l}${esc(label[id] || id)}</a>` : `<span class="tag">${esc(label[id] || id)}</span>`; }).join(" · ");
  const sec = t => by[t] && by[t].length ? `<h2>${esc(TYPE[t])}</h2><div class="grid">${by[t].slice(0, 12).map(i => `<div class="card"><b>${esc(i.title)}</b><span class="small">${chips(i.nodes)}</span><span class="small muted">${esc(i.why)}${i.first_seen ? " First seen " + esc(i.first_seen.slice(0, 10)) + "." : ""}</span></div>`).join("")}</div>` : "";
  const st = a.stats, up = g.upkeep || {};
  return shell("Connections · What Works", "What the atlas's knowledge graph finds on its own: programmes worth comparing, programmes that disagree on the same outcome, and gaps.",
    `<h1>Connections</h1><p class="lede">Every hour the atlas rebuilds a graph of its programmes, trials, authors, outcomes and places, and reads it for patterns nobody typed in, across countries, income levels and forms of government, so a lesson learned in one place can travel to another. These are leads for a reader to follow, not grades.</p>
<div class="stats"><div><b>${st.nodes}</b><span class="muted small">things</span></div><div><b>${st.edges}</b><span class="muted small">connections</span></div><div><b>${st.communities}</b><span class="muted small">clusters</span></div><div><b>${a.insights.length}</b><span class="muted small">leads</span></div></div>
${["carry", "disagree", "link"].map(sec).join("")}
<h2 id="settings">Where the evidence comes from</h2><p class="muted">Programmes in the atlas by the outcome they are graded on and the income group of the countries their trials ran in (World Bank groups). Each country also carries its region and form of government, so a result can be read against the setting it came from.</p>
<div class="wrap"><table><thead><tr><th scope="col">Outcome</th>${INCOME_COLS.map(([, n]) => `<th scope="col">${n} income</th>`).join("")}</tr></thead><tbody>${(g.coverage || []).map(r => `<tr><th scope="row">${esc(r.name)}</th>${INCOME_COLS.map(([k]) => `<td>${r[k].length ? names(r[k], label) : '<span class="muted">none yet</span>'}</td>`).join("")}</tr>`).join("")}</tbody></table></div>
${["desert", "bridge", "gap"].map(sec).join("")}
<h2>Most connected</h2><ol>${a.central.slice(0, 8).map(c => `<li>${nodeLink(c.id) ? nodeLink(c.id) + esc(c.label) + "</a>" : esc(c.label)} <span class="tag">${esc(c.kind)}</span></li>`).join("")}</ol>
<p class="small muted">Graph last rebuilt ${esc(up.last_run ? up.last_run.slice(0, 16).replace("T", " ") + " UTC" : "not yet")}. Facts that drop out are retired with a date, never deleted (${up.retired_facts || 0} so far). The whole graph, with where each fact came from: <a href="/graph.json">/graph.json</a>.</p>`, { path: "/connections" });
}
