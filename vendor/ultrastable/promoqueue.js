// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-PROMO-1 (Rowan, 2026-11-22): "That's part of the role for an app or tenant is promotion." Ultrastable is the foundation for any autonomous system.
// Every tenant promotes itself through the one social module (social.js): it serves a queue at /social-queue.json in its own voice and core only
// drains it within social/gate.json (kill switch, caps, paused channels). This module builds that queue from a tenant's own content, so no tenant
// writes its own scheduler and one fix here reaches every tenant (USER-BACKEND-1). The rule and its check: doctrine/tenant-promotion.json,
// foundation/tenantpromo.py. Test: seed/worker/test/promoqueue.test.js.
//
// items: [{ id, text, path }] in the tenant's order. Item i is due on start + i * every_days; when every item has gone out the cycle repeats with a
// new post id, so the publisher's one-send-per-id rule keeps working. Only posts dated inside [today - back_days, today + ahead_days] are returned,
// so the queue stays small however many items a tenant holds.

const DAY = 864e5;
const URL_RE = /https?:\/\/\S+/g;

// The honesty guard every tenant post passes before it is queued: the hook and the link are present, no @-mention (no cold messages to people),
// no ridicule, and the length limit holds. Returns a list of reasons; empty means the post may go out.
export const BLOCKED = [/\bstupid\b/i, /\bidiot/i, /\bfool(s|ish)?\b/i, /\bdebunk/i, /\bscam\b/i, /(^|\s)@[a-z0-9_]/i];
export function guard(text, { hook, link, limit = 300 } = {}) {
  const why = [];
  if (!text) return ['empty'];
  if (hook && !text.includes(hook)) why.push('no hook');
  if (link && !text.includes(link)) why.push('no link');
  if (text.length > limit) why.push('over limit ' + limit);
  for (const re of BLOCKED) if (re.test(text.replace(URL_RE, ''))) why.push('blocked ' + re.source);
  return why;
}

// Fit body + link + hook inside the limit by shortening the body only; the hook and the link are never cut.
export function compose(body, url, hook, limit = 300) {
  const tail = '\n' + url + (hook ? '\n' + hook : '');
  const room = limit - tail.length;
  let b = String(body || '').trim();
  if (b.length > room) b = b.slice(0, Math.max(0, room - 1)).replace(/\s+\S*$/, '').replace(/[,;:.]$/, '') + '…';
  return b + tail;
}

export function promoQueue({ tenant, site, hook, items = [], start, every_days = 2, back_days = 7, ahead_days = 30, limit = 300, now = Date.now() } = {}) {
  if (!tenant || !site || !items.length) return { tenant, posts: [], refused: [] };
  const t0 = Date.parse((start || '2026-11-23') + 'T00:00:00Z'), today = Math.floor(now / DAY) * DAY;
  const step = Math.max(1, every_days) * DAY, n = items.length;
  const first = Math.max(0, Math.ceil((today - back_days * DAY - t0) / step)), last = Math.floor((today + ahead_days * DAY - t0) / step);
  const posts = [], refused = [];
  for (let k = first; k <= last; k++) {
    const it = items[k % n], cycle = Math.floor(k / n), link = site.replace(/\/$/, '') + (it.path || '/');
    const text = compose(it.text, link, hook, limit), why = guard(text, { hook, link, limit });
    const id = `${tenant}:${it.id}` + (cycle ? `:c${cycle}` : '');
    if (why.length) { refused.push({ id, why }); continue; }
    posts.push({ id, date: new Date(t0 + k * step).toISOString().slice(0, 10), text, url: link, kind: 'tenant', arm: `${tenant}-${it.kind || 'item'}`, tenant });
  }
  return { tenant, mode: 'tenant-queue', every_days, posts, refused };
}

// Which tenant a calendar post belongs to, so the publisher can take tenants in turn instead of letting one tenant's backlog starve another.
export const tenantOf = p => (p && (p.tenant || (String(p.arm || '').startsWith('ps-') ? 'practical-solutions' : ''))) || '';
