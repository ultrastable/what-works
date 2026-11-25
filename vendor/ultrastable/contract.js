// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// FLEET-CONTRACT-1 (Rowan, 2026-11-25): "Make sure everything that is said about ultra stable is true in code, and vice versa ... what users see
// on the front end matches the capabilities on the back end and vice versa." Ultrastable is the foundation for any autonomous system.
//
// One contract every system on Ultrastable serves, so the platform can read any of them the same way and one fix here reaches all of them
// (USER-BACKEND-1). A system declares its statements once; each statement is a sentence a page shows, the page that shows it and the
// endpoint that backs it. From that one declaration this module
//   serves   /.well-known/ultrastable.json  (DISCOVER-1: name, public URL, repository, licence, the contract's surfaces; nothing private)
//            /claims.json                   (WORDS-MATCH-CODE-1: every statement with its page and its endpoint)
//   verifies front to back: every statement's endpoint answers with JSON, and every same-origin /api link a page carries resolves;
//            back to front: every statement's page answers with HTML, and every public GET endpoint the Worker serves is named by a
//            statement or listed as internal with a reason (a capability no page describes is a failure, not a bonus).
// verify() takes a fetch function, so the same code runs in a tenant's own tests against its router (no network) and against the deployed
// origin. The platform's live reading of every tenant is foundation/fleetcontract.py --live; data doctrine/fleet-contract.json.
// Test: seed/worker/test/contract.test.js.
export const CONTRACT_VERSION = 1;
export const PLATFORM = 'https://ultrastable.io';
export const LICENSE = 'LicenseRef-Ultrastable-USL-1.0';
// The surfaces every system serves. `json` surfaces answer 200 or 503 with a JSON body (a health route says 503 with its report when it is unwell).
export const SURFACES = [
  { id: 'home', path: '/', kind: 'html' },
  { id: 'manifest', path: '/.well-known/ultrastable.json', kind: 'json' },
  { id: 'claims', path: '/claims.json', kind: 'json' },
  { id: 'health', path: '/health', kind: 'json' },
  { id: 'social', path: '/social-queue.json', kind: 'json' },
  { id: 'graph', path: '/api/graph', kind: 'json' },
];

const clean = (s, n = 400) => String(s ?? '').replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, n);
const origin = u => { try { const x = new URL(u); return x.protocol === 'https:' ? x.origin : null; } catch { return null; } };
const bare = p => String(p || '').split(/[?#]/)[0].replace(/\/+$/, '') || '/';

// A declaration is wrong before any request is made when a statement lacks its sentence, its page or its endpoint.
export function specProblems(spec = {}) {
  const bad = [], seen = new Set();
  if (!clean(spec.name)) bad.push('no name');
  if (!origin(spec.url)) bad.push('url is not an https origin');
  if (!/^[\w.-]+\/[\w.-]+$/.test(spec.repo || '')) bad.push('repo is not owner/name');
  if (!(spec.statements || []).length) bad.push('no statements');
  for (const s of spec.statements || []) {
    if (!/^[a-z0-9][a-z0-9-]*$/.test(s.id || '')) bad.push(`statement id "${s.id}" is not a slug`);
    if (seen.has(s.id)) bad.push(`statement ${s.id} declared twice`);
    seen.add(s.id);
    if (clean(s.text).length < 12) bad.push(`statement ${s.id}: no sentence`);
    if (!String(s.page || '').startsWith('/')) bad.push(`statement ${s.id}: no page (back to front: a capability no page shows)`);
    // a statement about the page itself (its contrast, that it works without script) is backed by a named test or file, given as `evidence`
    if (!String(s.api || '').startsWith('/') && clean(s.evidence).length < 8) bad.push(`statement ${s.id}: no endpoint and no evidence (front to back: a sentence nothing backs)`);
  }
  for (const i of spec.internal || []) if (!String(i.path || '').startsWith('/') || clean(i.why).length < 8) bad.push(`internal route ${i.path}: needs a path and a reason`);
  return bad;
}

export function manifest(spec = {}) {
  return {
    ultrastable: 1,
    contract: CONTRACT_VERSION,
    name: clean(spec.name, 80),
    summary: clean(spec.summary, 300) || null,
    url: origin(spec.url),
    repo: spec.repo ? 'https://github.com/' + clean(spec.repo, 120) : null,
    license: spec.license || LICENSE,
    discoverable: spec.discoverable !== false,
    platform: PLATFORM,
    directory: PLATFORM + '/directory',
    surfaces: Object.fromEntries(SURFACES.map(s => [s.id, s.path])),
  };
}

export function claims(spec = {}) {
  return {
    contract: CONTRACT_VERSION,
    system: clean(spec.name, 80),
    rule: 'Every statement names the page that shows it and the endpoint that backs it. The platform fetches both.',
    statements: (spec.statements || []).map(s => ({ id: s.id, text: clean(s.text), page: s.page, api: s.api || null, ...(s.evidence ? { evidence: clean(s.evidence, 300) } : {}) })),
    internal: (spec.internal || []).map(i => ({ path: i.path, why: clean(i.why, 200) })),
  };
}

const J = body => new Response(JSON.stringify(body, null, 1), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=600', 'access-control-allow-origin': '*' } });

// The two routes this module owns. Returns null for any other path, so a router calls it first and carries on.
export function contractRoute(pathname, spec) {
  const p = bare(pathname);
  if (p === '/.well-known/ultrastable.json') return J(manifest(spec));
  if (p === '/claims.json') return J(claims(spec));
  return null;
}

// The line every page of a system carries (DISCOVER-1, TENANT-PROMO-1): a link to the platform, the directory and the system's own statements.
export function footerLinks(spec = {}) {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  return `Built on <a href="${PLATFORM}/" rel="noopener">Ultrastable</a> · <a href="${PLATFORM}/directory" rel="noopener">More systems built on it</a>${spec.repo ? ` · <a href="https://github.com/${esc(spec.repo)}" rel="noopener">Source</a>` : ''} · <a href="/claims.json">What this site states, and what backs it</a>`;
}

// The statements a page makes, rendered for that page: each sentence with a link to the endpoint that backs it. A page shell includes this, so
// the words on the page and the words in /claims.json are one string and cannot drift apart.
export function statementsHtml(spec = {}, page = '/') {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const mine = (spec.statements || []).filter(s => bare(s.page) === bare(page));
  if (!mine.length) return '';
  return `<section aria-label="What this page states"><h2>What this page states, and what backs it</h2><ul>${mine.map(s => `<li>${esc(clean(s.text))}${s.api ? ` <a href="${esc(s.api)}">${esc(s.api)}</a>` : ''}</li>`).join('')}</ul></section>`;
}

// A page's readable text: tags and scripts dropped, entities decoded, whitespace collapsed, lower case. A statement is shown when its sentence is in it.
export function pageText(html = '') {
  return String(html).replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim().toLowerCase();
}
export const shows = (html, text) => pageText(html).includes(pageText(text));

// Same-origin /api/... paths a page links or fetches. A write route a page posts to answers a GET with 405 (never 404), which the reading accepts.
// Template pieces (`/api/x/` + id) end in a slash or quote and are dropped: only whole paths are judged.
export function apiLinks(html = '') {
  const out = new Set();
  for (const m of String(html).matchAll(/(?:href|src|action)\s*=\s*["'](\/api\/[^"'#\s<>]*)["']|fetch\(\s*["'`](\/api\/[^"'`#\s<>$]*)["'`]/g)) {
    const p = m[1] || m[2];
    if (p && !p.endsWith('/') && !p.endsWith('=')) out.add(p);
  }
  return [...out];
}

async function read(fetchFn, path) {
  try {
    const r = await fetchFn(path);
    const ct = (r.headers && r.headers.get && r.headers.get('content-type')) || '';
    const body = await r.text();
    return { status: r.status, ct, body };
  } catch (e) {
    return { status: 0, ct: '', body: clean(e && e.message, 160) };
  }
}
const isJson = r => /json/.test(r.ct) || /^[[{]/.test(r.body.trimStart());
const isHtml = r => /html/.test(r.ct) || /<html/i.test(r.body.slice(0, 600));
const parse = r => { try { return JSON.parse(r.body); } catch { return null; } };

// fetchFn(path) -> Response for a path on the system's own origin. `apis`: the public GET endpoints the Worker serves, when the caller can list
// them (a tenant's test reads them out of its router); each must be named by a statement, be a contract surface, or be internal with a reason.
// Returns { ok, checks, failures: [{ id, direction, why }] }; direction is "front-to-back", "back-to-front" or "contract".
export async function verify(fetchFn, spec = {}, { apis = null } = {}) {
  const failures = [], fail = (id, direction, why) => failures.push({ id, direction, why });
  let checks = 0;
  for (const why of specProblems(spec)) fail('declaration', 'contract', why);
  const got = {};
  for (const s of SURFACES) {
    checks++;
    const r = got[s.id] = await read(fetchFn, s.path);
    if (s.kind === 'html') { if (r.status !== 200 || !isHtml(r)) fail(s.id, 'contract', `${s.path} did not answer with a page (${r.status})`); }
    else if (![200, 503].includes(r.status) || !isJson(r) || parse(r) === null) fail(s.id, 'contract', `${s.path} did not answer with JSON (${r.status})`);
    else if (s.id === 'health' && r.status !== 200) fail(s.id, 'contract', `/health says the system is unwell (${r.status})`);
  }
  const m = parse(got.manifest) || {}, c = parse(got.claims) || {};
  if (got.manifest.status === 200) {
    checks++;
    if (m.ultrastable !== 1) fail('manifest', 'contract', 'the manifest does not say ultrastable: 1');
    if (m.url !== origin(spec.url)) fail('manifest', 'contract', `the manifest names ${m.url}, the system is declared at ${origin(spec.url)}`);
  }
  if (got.claims.status === 200) {
    checks++;
    const served = new Set((c.statements || []).map(s => s.id));
    for (const s of spec.statements || []) if (!served.has(s.id)) fail(s.id, 'contract', '/claims.json does not list this statement');
  }
  if (got.home.status === 200) {
    checks++;
    if (!got.home.body.includes(PLATFORM)) fail('home', 'contract', 'the home page does not link the platform it runs on');
  }
  const sq = parse(got.social);
  if (got.social.status === 200 && sq) { checks++; if (!Array.isArray(sq.posts)) fail('social', 'contract', '/social-queue.json has no posts list'); }
  // each statement, both ways
  const pages = {};
  for (const s of spec.statements || []) {
    if (!String(s.page || '').startsWith('/')) continue;
    checks += 2;
    const a = String(s.api || '').startsWith('/') ? await read(fetchFn, s.api) : null;
    if (a && (a.status !== 200 || !isJson(a) || parse(a) === null)) fail(s.id, 'front-to-back', `the page says "${clean(s.text, 80)}" and its endpoint ${s.api} did not answer with JSON (${a.status})`);
    const pg = pages[s.page] = pages[s.page] || (s.page === '/' ? got.home : await read(fetchFn, s.page));
    if (pg.status !== 200 || !isHtml(pg)) fail(s.id, 'back-to-front', `${s.api} is served and its page ${s.page} did not answer (${pg.status})`);
    else if (!shows(pg.body, s.text)) fail(s.id, 'back-to-front', `${s.page} does not show the sentence "${clean(s.text, 80)}" (the words in /claims.json and on the page must be the same words)`);
  }
  // every /api link a declared page carries resolves
  pages['/'] = pages['/'] || got.home;
  const linked = new Set();
  for (const pg of Object.values(pages)) if (pg.status === 200) for (const l of apiLinks(pg.body)) linked.add(l);
  for (const l of linked) {
    checks++;
    const r = await read(fetchFn, l);
    if (r.status === 404 || r.status === 0 || r.status >= 500) fail(l, 'front-to-back', `a page links ${l} and it answers ${r.status}`);
  }
  // every public endpoint is described
  if (apis) {
    const named = new Set([...(spec.statements || []).filter(s => s.api).map(s => bare(s.api)), ...(spec.internal || []).map(i => bare(i.path)), ...SURFACES.map(s => s.path)]);
    const prefixes = (spec.internal || []).filter(i => String(i.path).endsWith('/*')).map(i => String(i.path).slice(0, -1));
    for (const a of apis) {
      checks++;
      if (String(a).endsWith('/*')) {  // a family of routes (startsWith in the router): a statement's endpoint inside it, or the same internal prefix
        const pre = String(a).slice(0, -1);
        if (!prefixes.includes(pre) && ![...named].some(n => n.startsWith(pre))) fail(a, 'back-to-front', `${a} is served and no statement names a route in it (a capability no page describes)`);
        continue;
      }
      const p = bare(a);
      if (!named.has(p) && !prefixes.some(x => p.startsWith(x) || p + '/' === x)) fail(p, 'back-to-front', `${p} is served and no statement names it (a capability no page describes)`);
    }
  }
  return { ok: failures.length === 0, contract: CONTRACT_VERSION, checks, failures };
}

// The public paths a router's source serves, read from its own comparisons: === "/api/x" as a path, startsWith("/api/x/") as the family "/api/x/*". For a tenant's test.
export function routesIn(source = '') {
  const out = new Set();
  for (const m of String(source).matchAll(/(?:pathname|\bp|\bpath)\s*===\s*["'](\/api\/[a-z0-9/_.-]+)["']/gi)) out.add(m[1]);
  for (const m of String(source).matchAll(/(?:pathname|\bp|\bpath)\.startsWith\(\s*["'](\/api\/[a-z0-9/_.-]+\/)["']/gi)) out.add(m[1] + '*');
  return [...out].sort();
}
