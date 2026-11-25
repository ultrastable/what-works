#!/usr/bin/env node
// SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
// Copyright (c) Ultrastable
// TENANT-SYNC-1, TENANT-STANDARD-1: the core files a tenant reads are vendored under vendor/ultrastable/ and must not drift from the core.
// Ultrastable is the foundation for any autonomous system. Generic: knows no tenant name. The tenant is read from instance.json `slug`, its
// vendor map from the core's own registry (doctrine/tenant-repos.json `tenants.<slug>.vendor`), so a file the core adds to the map reaches the
// tenant with no change here. A file this repository already records in VENDORED_FROM and the registry does not name yet is kept and refreshed
// from the same core path (so a tenant scaffolded ahead of a core merge loses nothing). Each file is fetched from the public core repository at
// one commit; VENDORED_FROM records that commit and the sha256 of every file, which is what the tenant's own standard check reads offline.
// No credential: the core repository is public. Run from the repository root by .github/workflows/vendor-sync.yml, which tests before it commits.
//   node vendor/ultrastable/tools/vendor_sync.mjs            write the files; prints "changed" or "unchanged"
//   node vendor/ultrastable/tools/vendor_sync.mjs --check    exit 1 when any vendored file differs from core main (the probe)
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = process.env.TENANT_ROOT || process.cwd();
const CORE = process.env.CORE_REPO || "ultrastable/ultrastable";
const RECORD = "vendor/ultrastable/VENDORED_FROM";
const UA = { "user-agent": "ultrastable-vendor-sync" };
// the token only raises the API rate limit; it is sent to api.github.com and never to the raw file host
const API = { ...UA, accept: "application/vnd.github+json", ...(process.env.GITHUB_TOKEN ? { authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}) };
const sha256 = s => createHash("sha256").update(s).digest("hex");

async function local(path) { try { return await readFile(join(ROOT, path), "utf8"); } catch (e) { if (e.code === "ENOENT") return null; throw e; } }

// VENDORED_FROM: `<core repo>@<commit>` then `<core path> -> <tenant path> sha256:<hex>` per file.
export function parseRecord(text) {
  const map = {};
  for (const ln of String(text || "").split("\n").slice(1)) { const m = ln.trim().match(/^(\S+) -> (\S+)(?: sha256:[0-9a-f]{64})?$/); if (m) map[m[1]] = m[2]; }
  return map;
}
export const record = (core, sha, files) => `${core}@${sha}\n${files.map(f => `${f.src} -> ${f.dst} sha256:${sha256(f.body)}`).join("\n")}\n`;

// get(url, as) -> text or parsed JSON; throws with `.status` on a refusal. Injected by the test.
export async function plan({ get, slug, have = local, recorded = "" }) {
  // pin every file to one core commit; when the API cannot be read the branch name is used, and the record says so
  let sha = "main";
  try { sha = (await get(`https://api.github.com/repos/${CORE}/commits/main`, "json")).sha; } catch (e) { console.warn(`vendor_sync: core head unreadable (${e.message}); reading main by name`); }
  const raw = path => `https://raw.githubusercontent.com/${CORE}/${sha}/${path}`;
  const reg = await get(raw("doctrine/tenant-repos.json"), "json");
  const named = reg.tenants?.[slug]?.vendor || {}, kept = parseRecord(recorded);
  const map = { ...kept, ...named };
  if (!Object.keys(map).length) throw new Error(`no vendor map for ${slug}: none in ${CORE} doctrine/tenant-repos.json and none recorded in ${RECORD}`);
  const files = [];
  for (const [src, dst] of Object.entries(map).sort((a, b) => a[1].localeCompare(b[1]))) {
    const mine = await have(dst);
    let body;
    try { body = await get(raw(src)); }
    catch (e) {
      // a recorded file the core's main does not hold yet stays as it is; a file the registry names must exist
      if (e.status === 404 && !(src in named) && mine !== null) { console.warn(`vendor_sync: ${src} is not on core main yet; keeping the local ${dst}`); body = mine; }
      else throw e;
    }
    files.push({ src, dst, body, have: mine });
  }
  return { sha, files };
}

async function fetchGet(url, as = "text") {
  const r = await fetch(url, { headers: url.startsWith("https://api.github.com/") ? API : UA });
  if (!r.ok) throw Object.assign(new Error(`${url}: HTTP ${r.status}`), { status: r.status });
  return as === "json" ? r.json() : r.text();
}

async function main() {
  const check = process.argv.includes("--check");
  const slug = process.env.TENANT_SLUG || JSON.parse(await readFile(join(ROOT, "instance.json"), "utf8")).slug;
  const recorded = (await local(RECORD)) || "";
  const { sha, files } = await plan({ get: fetchGet, slug, recorded });
  const drift = files.filter(f => f.body !== f.have);
  for (const f of drift) console.log(`${check ? "drift" : "update"}: ${f.dst} <- ${CORE}@${sha.slice(0, 12)}:${f.src}`);
  const lines = record(CORE, sha, files).split("\n").slice(1).join("\n");
  const stale = recorded.split("\n").slice(1).join("\n") !== lines;  // the record itself is behind (a file added to the map, a hash not written yet)
  if (check) { console.log(drift.length || stale ? `${drift.length} vendored file(s) behind core${stale ? "; VENDORED_FROM is behind" : ""}` : "vendored files match core main"); process.exit(drift.length || stale ? 1 : 0); }
  for (const f of drift) { await mkdir(dirname(join(ROOT, f.dst)), { recursive: true }); await writeFile(join(ROOT, f.dst), f.body); }
  if (drift.length || stale) { await mkdir(dirname(join(ROOT, RECORD)), { recursive: true }); await writeFile(join(ROOT, RECORD), record(CORE, sha, files)); }
  console.log(drift.length || stale ? "changed" : "unchanged");
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error("vendor_sync:", e.message); process.exit(2); });
