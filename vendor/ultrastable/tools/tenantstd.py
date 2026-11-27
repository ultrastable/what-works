#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""TENANT-STANDARD-1 (Rowan, 2026-11-25: "even the repos aren't being created correctly ... the system needs the capability and the settings
and all the optimizations to fully run itself ... that needs to be standardized and consistent"): one standard for what a tenant repository
contains, one scaffold that writes it, one check that reads it. Ultrastable is the foundation for any autonomous system.

  python3 -m foundation tenantstd --check                    the core side: every tenant's vendor map carries the standard's base files, every
                                                             scaffold template exists, and a repository scaffolded now passes the standard (in checks)
  python3 -m foundation tenantstd --check --tenant PATH      read one repository against the standard; exit 1 with one line per missing part
  python3 -m foundation tenantstd --measure PATH             the same reading, reported and never failed (an exempt repository)
  python3 -m foundation tenantstd --scaffold PATH --slug S   write every standard file into PATH from scaffold/tenant (repository creation calls this)
  python3 -m foundation tenantstd --table PATH [PATH ...]    one row per standard part, one column per repository
  python3 -m foundation tenantstd --live                     clone each registered tenant's main and read it; exit 1 when one fails
  python3 -m foundation tenantstd --normalize PATH           rewrite PATH/ultrastable.json in the schema's shape (where it runs from doctrine/topology.json)
  python3 -m foundation tenantstd --render PATH              render PATH's identity files with the kit renderer; print each path written

The full machine-readable file set (REPO-CONFORM-2) is one register, seed/autonomy/repo-conformance.json: --check --tenant runs its reader.

This file is also the tool a tenant runs on itself: it is vendored as vendor/ultrastable/tools/tenantstd.py beside
vendor/ultrastable/tenant-standard.json (python3 vendor/ultrastable/tools/tenantstd.py --check --tenant .), so it imports nothing from the core.
Data: doctrine/tenant-standard.json. Tests: tests/foundation/test_tenantstd.py."""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zlib
from pathlib import Path

HERE = Path(__file__).resolve()
STD_CORE = "doctrine/tenant-standard.json"
REG = "doctrine/tenant-repos.json"
ISSUES = "docs/issues/"  # the queue an exception's item lives in (DISPOSE-1)
BLOCKS = {"standard": re.compile(r"<!-- ultrastable:standard[^>]*-->.*?<!-- /ultrastable:standard -->", re.S),
          "live": re.compile(r"<!-- live:start[^>]*-->.*?<!-- live:end -->", re.S)}  # the Live block is foundation/livelinks.py's, one format fleetwide
PLATFORM = "https://ultrastable.io"
PLACE = re.compile(r"\{\{(json:)?([a-z0-9_]+)\}\}")
SKIP_DIRS = {".git", "node_modules", "__pycache__"}
HOW = "deployed from this repository's `main` by the Ultrastable platform"  # the words foundation/livelinks.py renders, so Live blocks agree


def locate() -> tuple[dict, Path | None]:
    """The standard and, when this file runs inside the core, the core's root. In a tenant the standard sits beside the tool's directory."""
    core = HERE.parents[1]
    if (core / STD_CORE).is_file():
        return json.loads((core / STD_CORE).read_text(encoding="utf-8")), core
    return json.loads((HERE.parents[1] / "tenant-standard.json").read_text(encoding="utf-8")), None


def _json(p: Path):
    try:
        return json.loads(p.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def _dig(d, dotted):
    for k in dotted.split("."):
        if not isinstance(d, dict) or k not in d:
            return None
        d = d[k]
    return d


def _sha(p: Path) -> str:
    return hashlib.sha256(p.read_bytes()).hexdigest()


def slug_of(tenant: Path) -> str:
    return str((_json(tenant / "instance.json") or {}).get("slug") or tenant.resolve().name)


def vendored_from(tenant: Path, std: dict) -> tuple[str, dict]:
    """VENDORED_FROM: first line `<core repo>@<commit>`, then `<core path> -> <tenant path> sha256:<hex>` per file. Returns (head, {dst: (src, sha)})."""
    p = tenant / std["vendor"]["dir"] / "VENDORED_FROM"
    if not p.is_file():
        return "", {}
    lines = p.read_text(encoding="utf-8").splitlines()
    out = {}
    for ln in lines[1:]:
        m = re.match(r"^(\S+) -> (\S+)(?: sha256:([0-9a-f]{64}))?$", ln.strip())
        if m:
            out[m.group(2)] = (m.group(1), m.group(3) or "")
    return (lines[0].strip() if lines else ""), out


def _json_rule(val, want) -> bool:
    if want == "*":
        return val not in (None, "", [], {})
    if want == "+":
        return isinstance(val, list) and len(val) > 0
    if isinstance(want, str) and want.startswith(">="):
        return isinstance(val, (int, float)) and val >= float(want[2:])
    if isinstance(want, str) and want.startswith("~"):
        return isinstance(val, str) and want[1:] in val
    return val == want


def lint_workflow(text: str, std: dict) -> list[str]:
    w, bad = std["workflows"], []
    head = "\n".join(ln for ln in text.splitlines() if ln.lstrip().startswith("#"))
    bad += [f"no `{h}` header comment" for h in w["header"] if h not in head]
    bad += [f"no `{n}`" for n in w["needs"] if n not in text]
    for m in re.finditer(r"^\s*-?\s*uses:\s*(\S+)", text, re.M):
        if not m.group(1).startswith("./") and not re.search(r"@[0-9a-f]{40}$", m.group(1)):
            bad.append(f"`uses: {m.group(1)}` is not pinned to a full commit sha")
    jobs = len(re.findall(r"^  [A-Za-z0-9_-]+:\s*$", text.split("\njobs:", 1)[1], re.M)) if "\njobs:" in text else 0
    if jobs and text.count("timeout-minutes:") < jobs:
        bad.append("a job has no timeout-minutes")
    if jobs and text.count("vars.HALT != '1'") < jobs:
        bad.append("a job does not honour the halt (HALT-1)")
    if re.search(r"^\s*matrix:", text, re.M):
        bad.append("uses a matrix")
    return bad


def _tests_text(tenant: Path) -> str:
    return "\n".join(p.read_text(encoding="utf-8", errors="replace") for p in sorted((tenant / "worker").glob("*.test.mjs"))) if (tenant / "worker").is_dir() else ""


def deployment(slug: str, root: Path) -> tuple[bool, str]:
    """Where a tenant runs, from the registries: (deployed, public URL). Deployed is a `frontend`, or a live topology Worker with a route."""
    row = (_json(root / REG) or {}).get("tenants", {}).get(slug, {})
    if row.get("state") in ("planned", "retired", None):
        return False, ""
    if str(row.get("frontend", "")).startswith("https://"):
        return True, row["frontend"].rstrip("/")
    w = next((w for w in (_json(root / "doctrine/topology.json") or {}).get("workers", []) if w.get("id") == row.get("worker")), {})
    return (True, "https://" + w["routes"][0]) if w.get("state") == "live" and w.get("routes") else (False, "")


def live_block(slug: str, root: Path) -> str:
    """The README's Live block, in the one format the fleet uses: foundation/livelinks.py (LIVE-LINKS-1) renders it from the registries."""
    from . import livelinks  # core only: a tenant's vendored copy of this file reads the block, it never writes it
    return livelinks.block(slug, root).strip()


def live_problems(tenant: Path, slug: str, std: dict, root: Path | None, ident: dict | None = None) -> list[str]:
    """LIVE-LINKS-1: the README says where the code runs. In the core the block must equal what livelinks renders from the registries; in the
    tenant (no registries) it must agree with ultrastable.json: the public URL linked with its health and statements, or Not deployed yet and no host."""
    p, lv = tenant / "README.md", std["live"]
    m = BLOCKS["live"].search(p.read_text(encoding="utf-8", errors="replace")) if p.is_file() else None
    if not m:
        return ["live: README.md has no Live block (where the code runs; written by the scaffold with foundation/livelinks.py between the live:start and live:end markers)"]
    block, bad = m.group(0), []
    urls = [u.rstrip("/") for u in re.findall(r"https://[^\s<>()\]|]+", block) if not u.startswith((lv["platform"], "https://github.com/"))]
    undeployed = lv["undeployed"] in block
    if lv["platform"] not in block:
        bad.append(f"live: README.md Live block does not link {lv['platform']}")
    if undeployed and urls:
        bad.append(f"live: README.md says {lv['undeployed']} and links {urls[0]} (a dead link)")
    if not undeployed:
        if not urls:
            bad.append("live: README.md Live block has no public URL")
        else:
            bad += [f"live: README.md Live block does not link {urls[0]}{x}" for x in lv["links"] if urls[0] + x not in block]
    want = (ident or {}).get("public_url")
    if ident is not None and (want or "").rstrip("/") != (urls[0] if urls and not undeployed else ""):
        bad.append(f"live: README.md Live URL is {urls[0] if urls and not undeployed else 'missing'}; ultrastable.json says public_url is {want}")
    if root is not None and slug in (_json(root / REG) or {}).get("tenants", {}):
        dep, url = deployment(slug, root)
        if dep and (undeployed or not urls or urls[0] != url):
            bad.append(f"live: README.md Live URL is {urls[0] if urls and not undeployed else 'missing'}; the registry says {slug} runs at {url}")
        if not dep and not undeployed:
            bad.append(f"live: README.md shows a live URL and the registry has {slug} not deployed")
        if live_block(slug, root) not in p.read_text(encoding="utf-8"):
            bad.append(f"live: README.md Live block is not the one the registries render; run python3 -m foundation tenantstd --scaffold on this repository")
    return bad


LOOP_MAX = 400  # identity.loop's maxLength in seed/standards/system.schema.json


def idea_loop(slug: str, tenant: Path, root: Path | None) -> str | None:
    """The loop the system closes, in its owner's words: the `- Loop:` line of IDEA.md's `# System test` (the tenant's own copy, else the core's
    manifest folder). None when IDEA.md states none or the line is longer than the manifest allows; it is never cut or written for the owner."""
    for p in (Path(tenant) / "IDEA.md", root / "instances" / slug / "IDEA.md" if root is not None else None):
        text = p.read_text(encoding="utf-8") if p is not None and p.is_file() else ""
        sec = re.search(r"^# System test[ \t]*\n(.*?)(?=^# |\Z)", text, re.M | re.S)
        line = re.search(r"^- Loop:[ \t]*(\S.*?)\s*$", sec.group(1), re.M) if sec else None
        if line:
            loop = line.group(1)[0].upper() + line.group(1)[1:]
            return loop if len(loop) <= LOOP_MAX else None
    return None


def identity(slug: str, tenant: Path, std: dict, root: Path) -> dict:
    """The one input object of the scaffold, written as ultrastable.json `identity` (IDENTITY-1): who the system is and where it runs, from the
    registries. README, package.json, the contract's SPEC and the wrangler reference are rendered from it, never from literals of their own."""
    row = (_json(root / REG) or {}).get("tenants", {}).get(slug, {}) or {}
    inst = _json(tenant / "instance.json") or _json(root / "instances" / slug / "instance.json") or {}
    name = inst.get("name") or slug.replace("-", " ").title()
    tagline = str((inst.get("brand") or {}).get("tagline") or row.get("description") or name)
    dep, url = deployment(slug, root)
    worker = row.get("worker") or f"ultrastable-{slug}"
    topo = next((w for w in (_json(root / "doctrine/topology.json") or {}).get("workers", []) if w.get("id") == worker), {})
    loop = idea_loop(slug, tenant, root)
    return {
        "name": name, "slug": slug,
        "summary": re.sub(r"\s*Run on Ultrastable, the foundation for any autonomous system\.?\s*$", "", tagline).strip(),
        "repo": row.get("repo") or f"{std['core_repo'].split('/')[0]}/{slug}",
        "public_url": url if dep else None,
        "license": "LicenseRef-Ultrastable-USL-1.0", "topics": ["ultrastable"], "layer": "tenant", "parent": std["core_repo"],
        "visibility": row.get("visibility", "public"), "visibility_reason": "DISCOVER-1: public by default",
        "status": "live" if dep else row.get("state", "planned"),
        **({"loop": loop} if loop else {}),
        "runs_as": [{"provider": "cloudflare", "kind": "worker", "name": worker, "routes": topo.get("routes") or [], "how": HOW}] if dep else [],
    }


def normalize_identity(identity: dict, topology: dict | None = None, repo_standard: dict | None = None, parent: str | None = None) -> dict:
    """An identity in seed/standards/system.schema.json's shape. The older tenant standard wrote runs_as as one object, a planned_url and no
    visibility; only the shape changes, the tenant's own values stay. Where it runs comes from doctrine/topology.json when given (a live Worker
    with routes first, then the GitHub Pages route a worker:null manifest names); deployed false is runs_as [] and status planned; visibility
    follows github/repo-standard.json; a tenant gets the platform repository it runs on as `parent` (the standard's core_repo, when given).
    A manifest already in shape is returned unchanged."""
    i, ra = dict(identity), identity.get("runs_as")
    if (ra is None or isinstance(ra, list)) and "planned_url" not in i and "visibility" in i:
        return i  # the schema's shape; anything else wrong in it is the schema reading's to name, not a conversion's to guess
    i.pop("planned_url", None)
    if parent and i.get("layer") == "tenant" and not i.get("parent"):
        i["parent"] = parent
    if isinstance(ra, dict):
        name = ra.get("worker") or f"ultrastable-{i.get('slug')}"
        w = next((w for w in (topology or {}).get("workers", []) if w.get("id") == name), {})
        runs = []
        if ra.get("deployed") and w.get("state") == "live" and w.get("routes"):
            runs.append({"provider": "cloudflare", "kind": "worker", "name": name, "routes": list(w["routes"]), "how": HOW})
        elif ra.get("deployed") and ra.get("worker") and topology is None:  # no registry to read: the manifest's own statement stands
            runs.append({"provider": "cloudflare", "kind": "worker", "name": ra["worker"], "how": HOW})
        if ra.get("deployed") and not ra.get("worker") and str(ra.get("platform", "")).startswith("github"):
            runs.append({"provider": "github", "kind": "pages", "name": str(i.get("repo", "")).split("/", 1)[-1] or name,
                         "how": ra.get("deployed_by") or "GitHub Actions to GitHub Pages"})
        cf = next((r for r in runs if r["kind"] == "worker" and r.get("routes")), None)
        i["runs_as"] = runs
        i["public_url"] = ("https://" + cf["routes"][0].rstrip("/")) if cf else ((i.get("public_url") or "").rstrip("/") or None) if runs else None
        if i.get("status") != "retired":
            i["status"] = "live" if runs else "planned"
    elif ra is None:
        i["runs_as"] = []
    if "visibility" not in i:  # github/repo-standard.json: public unless named private there, with its written reason
        why = (((repo_standard or {}).get("visibility") or {}).get("private") or {}).get(str(i.get("repo", "")).split("/", 1)[-1])
        i["visibility"], i["visibility_reason"] = ("private", why) if why else ("public", i.get("visibility_reason") or "DISCOVER-1: public by default")
    return i


def normalize_file(tenant: Path, root: Path | None = None, std: dict | None = None) -> bool:
    """Rewrite tenant/ultrastable.json in the schema's shape; True when it changed. Without the core's registries the manifest's own statement stands."""
    p = Path(tenant) / "ultrastable.json"
    cfg = _json(p)
    if not isinstance(cfg, dict) or not isinstance(cfg.get("identity"), dict):
        raise SystemExit(f"tenantstd: {p} has no identity object to normalize")
    new = normalize_identity(cfg["identity"], _json(root / "doctrine/topology.json") if root else None, _json(root / "github/repo-standard.json") if root else None,
                             (std or locate()[0])["core_repo"])
    if new != cfg["identity"]:
        p.write_text(json.dumps({**cfg, "identity": new}, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    return new != cfg["identity"]


def worker_of(ident: dict, slug: str) -> str:
    """The Cloudflare Worker an identity's runs_as names (a GitHub Pages route may come first), else the platform's name for the slug."""
    ra = ident.get("runs_as")
    if isinstance(ra, dict):  # the older shape, read until its manifest is normalized
        return ra.get("worker") or f"ultrastable-{slug}"
    w = next((r for r in ra or [] if isinstance(r, dict) and r.get("kind", "worker") == "worker" and r.get("provider", "cloudflare") == "cloudflare"), {})
    return w.get("name") or f"ultrastable-{slug}"


def _tool(tenant: Path, std: dict, root: Path | None, which: str) -> Path | None:
    """The conformance tool `which` (tool, renderer) a reading uses: the tenant's vendored copy, else the core's own when run from the core."""
    c = (std.get("conformance") or {}).get(which) or {}
    for base, key in ((Path(tenant), "tenant"), (root, "core")):
        if base is not None and c.get(key) and (base / c[key]).is_file():
            return base / c[key]
    return None


def conformance(tenant: Path, std: dict, root: Path | None = None) -> list[str]:
    """REPO-CONFORM-2: the register's reader (repoconform.py --json, its own process as in CI); a reading that cannot run is a finding, never a pass."""
    if not std.get("conformance"):
        return []
    tool = _tool(tenant, std, root, "tool")
    if tool is None:
        return [f"conform: {std['conformance']['tool']['tenant']} is not in the repository, so the machine-readable files are not read (REPO-CONFORM-2)"]
    env = {**__import__("os").environ, "PYTHONDONTWRITEBYTECODE": "1"}  # the reading leaves nothing in vendor/ for vendor-sync to commit
    try:
        r = subprocess.run([sys.executable, str(tool), "--json", str(Path(tenant).resolve())], capture_output=True, text=True, timeout=300, env=env)
        rows = json.loads(r.stdout)["files"]
    except (OSError, subprocess.SubprocessError, ValueError, KeyError, TypeError) as e:
        return [f"conform: {tool.name} could not read the repository ({type(e).__name__}); unmeasured, never a pass"]
    return [f"conform: {x['path']} {x['state']}: {x['why']} ({x.get('standard')})" for x in rows if not x.get("ok")]


def check_tenant(tenant: Path, std: dict | None = None, root: Path | None = None, excused: list | None = None) -> list[str]:
    """One repository against the standard. Each line names the part and what is missing; an empty list is a repository that runs itself.
    With the core's root the README's Live URL is also compared with the registries. A finding a dated exception holds goes to `excused`."""
    std = std or locate()[0]
    tenant, slug = Path(tenant), slug_of(Path(tenant))
    sub = {"slug": slug, "worker": f"ultrastable-{slug}", "bootstrap_url": std["bootstrap_url"]}
    fill = lambda s: re.sub(r"\{(slug|worker|bootstrap_url)\}", lambda m: sub[m.group(1)], s)  # noqa: E731
    bad = []
    for f in std["files"]:
        p = tenant / f["path"]
        if not p.is_file():
            bad.append(f"{f['id']}: {f['path']} is missing ({f['why']})")
            continue
        text = p.read_text(encoding="utf-8", errors="replace")
        bad += [f"{f['id']}: {f['path']} does not contain `{fill(n)}`" for n in f.get("contains", []) if fill(n) not in text]
        if "json" in f:
            data = _json(p)
            if data is None:
                bad.append(f"{f['id']}: {f['path']} is not JSON")
                continue
            for key, want in f["json"].items():
                want = fill(want) if isinstance(want, str) else want
                if not _json_rule(_dig(data, key), want):
                    bad.append(f"{f['id']}: {f['path']} `{key}` should be {want!r}, is {json.dumps(_dig(data, key))[:60]}")
    ident = (_json(tenant / "ultrastable.json") or {}).get("identity")
    bad += live_problems(tenant, slug, std, root, ident)
    if isinstance(ident, dict):
        bad += [f"identity: ultrastable.json identity has no `{k}`" for k in std["identity"]["keys"] if k not in ident]
        if ident.get("slug") != slug:
            bad.append(f"identity: ultrastable.json says slug {ident.get('slug')!r}; instance.json says {slug!r}")
        if worker_of(ident, slug) != sub["worker"]:
            bad.append(f"identity: ultrastable.json runs_as names {worker_of(ident, slug)}; the platform runs this tenant as {sub['worker']}")
        if root is not None and slug in (_json(root / REG) or {}).get("tenants", {}) and (ident.get("public_url") or "").rstrip("/") != deployment(slug, root)[1]:
            bad.append(f"identity: ultrastable.json public_url is {ident.get('public_url')}; the registries say {deployment(slug, root)[1] or 'not deployed'}")
    lc, rw, pkg = _json(tenant / "lifecycle.json") or {}, _json(tenant / "runway.json") or {}, _json(tenant / "package.json") or {}
    if lc:
        unanswered = [c for c in std["survival"] if not ((lc.get("survival") or {}).get(c) or {}).keys() & {"inherit", "status"}]
        if unanswered:
            bad.append(f"lifecycle: no answer for survival class {', '.join(unanswered)} (SEED-LIFECYCLE-1)")
        bad += [f"lifecycle: build names {p}, which is not in the repository" for p in ((lc.get("build") or {}).get("paths") or []) + ((lc.get("build") or {}).get("tests") or []) if not (tenant / p).exists()]
    tests = _tests_text(tenant)
    for r in rw.get("risks") or []:
        if not all(str(r.get(k, "")).strip() for k in ("id", "what", "safeguard", "probe")):
            bad.append(f"runway: risk {r.get('id', '?')} needs id, what, safeguard and probe")
            continue
        kind, _, rest = r["probe"].partition(":")
        if kind == "test" and f"test('{rest}'" not in tests and f'test("{rest}"' not in tests:
            bad.append(f"runway: risk {r['id']} names a test that is not in worker/*.test.mjs: {rest[:70]}")
        elif kind == "file" and rest.startswith(("worker/", "vendor/", "scripts/", ".github/")) and not (tenant / rest).exists():
            bad.append(f"runway: risk {r['id']} names {rest}, which is not in the repository")
        elif kind not in ("test", "file", "grep", "cmd"):
            bad.append(f"runway: risk {r['id']} has an unknown probe kind `{kind}`")
    for k in ("dependencies", "devDependencies"):
        if pkg.get(k):
            bad.append(f"package: package.json has {k} ({std['package']['why']})")
    wf = tenant / ".github/workflows"
    for y in sorted(wf.glob("*.y*ml")) if wf.is_dir() else []:
        bad += [f"workflow {y.name}: {b}" for b in lint_workflow(y.read_text(encoding="utf-8"), std)]
    bad += _vendor_problems(tenant, std)
    held = conformance(tenant, std, root)
    if pending(slug, std):  # held by a dated exception: read and handed back as excused, never dropped
        pv = _pending_vendor(std, bad)
        if excused is not None:
            excused.extend(held + pv)
        bad = [b for b in bad if b not in pv]
    else:
        bad += held
    for p in sorted(tenant.rglob("*")):
        if p.is_file() and not (set(p.relative_to(tenant).parts) & SKIP_DIRS) and p.suffix in (".md", ".js", ".mjs", ".json", ".jsonc", ".yml", ".py", ".txt", "") and p.stat().st_size < 2_000_000:
            if re.search(r"^(<<<<<<< |>>>>>>> )", p.read_text(encoding="utf-8", errors="replace"), re.M):
                bad.append(f"merge: {p.relative_to(tenant).as_posix()} carries an unresolved merge marker")
    return bad


def departures(slug: str, std: dict, today: str | None = None) -> list[dict]:
    """The dated exceptions in effect for a tenant: one departure or a list of them, each tied to the item that ends it, held until `until`."""
    import datetime
    e = (std.get("exceptions") or {}).get(slug) or []
    day = today or datetime.date.today().isoformat()
    return [d for d in (e if isinstance(e, list) else [e]) if isinstance(d, dict) and day <= str(d.get("until", ""))]


def excepted(slug: str, std: dict, today: str | None = None) -> set:
    """Vendored paths a tenant may keep outside the vendor directory: a dated exception in the standard, tied to the item that ends it."""
    return {p for d in departures(slug, std, today) for p in d.get("vendor_outside", [])}


def pending(slug: str, std: dict, today: str | None = None) -> bool:
    """True while a dated exception says the tenant does not carry the conformance set yet: the reading still runs and is printed as held."""
    return any(d.get("conformance") == "pending" for d in departures(slug, std, today))


def _pending_vendor(std: dict, bad: list[str]) -> list[str]:
    srcs = set((std.get("conformance") or {}).get("vendor") or [])
    return [b for b in bad if b.startswith("vendor: ") and any(f"(core {s})" in b for s in srcs)]


def _vendor_problems(tenant: Path, std: dict) -> list[str]:
    vdir, bad = std["vendor"]["dir"], []
    allowed = excepted(slug_of(tenant), std)
    head, listed = vendored_from(tenant, std)
    if (tenant / vdir / "VENDORED_FROM").is_file():
        if not re.match(r"^[\w.-]+/[\w.-]+@\S+$", head):
            bad.append(f"vendor: {vdir}VENDORED_FROM does not start with `<core repo>@<commit>`")
        for src, dst in std["vendor"]["base"].items():
            if dst not in listed:
                bad.append(f"vendor: {dst} (core {src}) is not vendored; every tenant carries it")
        for dst, (src, sha) in sorted(listed.items()):
            if not dst.startswith(vdir) and dst not in allowed:
                bad.append(f"vendor: {dst} is vendored outside {vdir}")
            elif not (tenant / dst).is_file():
                bad.append(f"vendor: VENDORED_FROM lists {dst}, which is missing")
            elif not sha:
                bad.append(f"vendor: {dst} has no sha256 in VENDORED_FROM")
            elif _sha(tenant / dst) != sha:
                bad.append(f"vendor: {dst} was edited by hand: it no longer matches the hash of core {src}")
        for p in sorted((tenant / vdir).rglob("*")):
            rel = p.relative_to(tenant).as_posix()
            if p.is_file() and p.name != "VENDORED_FROM" and "__pycache__" not in p.parts and rel not in listed:
                bad.append(f"vendor: {rel} is in {vdir} and not in VENDORED_FROM (a core file with no recorded source)")
    for p in sorted(tenant.rglob("vendor")):
        rel = p.relative_to(tenant).as_posix()
        if p.is_dir() and not (set(p.relative_to(tenant).parts) & SKIP_DIRS) and rel != "vendor" and not rel.startswith(vdir) and not any(a.startswith(rel + "/") for a in allowed):
            bad.append(f"vendor: {rel}/ is a second vendor directory; core files live only under {vdir}")
    return bad


# ---- the scaffold: every standard file from one place ---------------------------------------------------------------------------------

def render(text: str, ctx: dict) -> str:
    def one(m):
        if m.group(2) not in ctx:
            raise KeyError(f"scaffold template names {{{{{m.group(2)}}}}}, which the tenant's context does not carry")
        return json.dumps(ctx[m.group(2)], ensure_ascii=False) if m.group(1) else str(ctx[m.group(2)])
    return PLACE.sub(one, text)


def _cron(slug: str, hours: int) -> str:
    h = zlib.crc32(slug.encode())  # a stable minute per tenant, so the fleet's beats do not all fire together
    minute, hour = h % 60, (h // 60) % 24
    return f"{minute} * * * *" if hours <= 1 else (f"{minute} {hour} * * *" if hours < 168 else f"{minute} {hour} * * 1")


def context(slug: str, tenant: Path, std: dict, root: Path | None, ident: dict | None = None) -> dict:
    """The values every template is rendered with: the identity (the one input object) plus the tenant's declared options and platform rows."""
    ident = ident or identity(slug, tenant, std, root)
    row = (_json(root / REG) or {}).get("tenants", {}).get(slug, {}) or {}
    worker = worker_of(ident, slug)
    topo = next((w for w in (_json(root / "doctrine/topology.json") or {}).get("workers", []) if w.get("id") == worker), {})
    sysd = _json(root / "doctrine/system.json") or {}
    d, opt = std["scaffold"]["defaults"], row.get("scaffold") or {}
    hours, h = int(opt.get("beat_hours", d["beat_hours"])), zlib.crc32(slug.encode())
    return {
        "slug": slug, "name": ident["name"], "summary": ident["summary"], "repo": ident["repo"], "worker": worker,
        "planned_url": "https://" + d["host"].replace("{slug}", slug),
        "d1": f"ultrastable-{slug}", "d1_id": ((sysd.get("resources") or {}).get("d1") or {}).get(slug, {}).get("id", ""),
        "beat_hours": hours, "cron": (topo.get("crons") or [_cron(slug, hours)])[0], "noun": opt.get("noun", d["noun"]),
        "ai": bool(row.get("ai")), "compatibility_date": topo.get("compatibility_date") or d["compatibility_date"],
        "core_repo": std["core_repo"], "bootstrap_url": std["bootstrap_url"], "vendor": dict(row.get("vendor") or {}),
        "sync_cron": f"{h % 50 + 5} 5 * * *", "cleanup_cron": f"{h % 50 + 5} 4 * * *",
    }


def wrangler(ctx: dict) -> str:
    c = {"name": ctx["worker"], "main": "worker/index.js", "compatibility_date": ctx["compatibility_date"], "workers_dev": False,
         "observability": {"enabled": True}, "triggers": {"crons": [ctx["cron"]]},
         "d1_databases": [{"binding": "DB", "database_name": ctx["d1"], "database_id": ctx["d1_id"] or "assigned by the platform when the Worker is first deployed"}]}
    if ctx["ai"]:
        c["ai"] = {"binding": "AI"}
    return ("// Reference copy of the config the platform deploys (doctrine/system.json in " + ctx["core_repo"] + ", rendered by python3 -m foundation system --render).\n"
            "// The platform deploys this Worker from main; nothing reads this file at deploy time.\n" + json.dumps(c, indent=2) + "\n")


def _core_commit(root: Path) -> str:
    r = subprocess.run(["git", "-C", str(root), "rev-parse", "HEAD"], capture_output=True, text=True)
    return r.stdout.strip() if r.returncode == 0 and r.stdout.strip() else "local"


def scaffold(tenant: Path, slug: str, root: Path | None = None, std: dict | None = None, ident: dict | None = None) -> list[str]:
    """Write every standard file into `tenant`. Idempotent: a second run changes nothing. The tenant's own code and words are never overwritten."""
    if std is None or root is None:
        std, root = locate()
    if root is None:
        raise SystemExit("tenantstd: the scaffold runs from the core repository (its templates live in scaffold/tenant)")
    tenant, done = Path(tenant), []
    # the identity is the scaffold's one input: the caller's, else the one the repository already carries (the fleet's reconciler,
    # seed/scripts/surfaces.py, owns its values; an older shape is put in the schema's shape first), else computed from the registries
    have = (_json(tenant / "ultrastable.json") or {}).get("identity")
    if isinstance(have, dict) and have.get("slug") == slug:
        have = normalize_identity(have, _json(root / "doctrine/topology.json"), _json(root / "github/repo-standard.json"), std["core_repo"])
        if "loop" not in have and idea_loop(slug, tenant, root):  # the loop the repository's own IDEA.md states, so its surfaces can say it
            have = {**have, "loop": idea_loop(slug, tenant, root)}
    ident = ident or (have if isinstance(have, dict) and have.get("slug") == slug else None) or identity(slug, tenant, std, root)
    sc, ctx = std["scaffold"], context(slug, tenant, std, root, ident)
    ctx["live_block"] = live_block(slug, root)
    tdir, fresh = root / sc["dir"], not (tenant / "worker/index.js").exists()

    orig: dict[str, bytes | None] = {}  # what each file the scaffold writes held before this run, so the result lists net changes only

    def put(rel: str, body: str, what: str):
        p = tenant / rel
        if p.is_file() and p.read_text(encoding="utf-8") == body:
            return
        orig.setdefault(rel, p.read_bytes() if p.is_file() else None)
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(body, encoding="utf-8")
        done.append(f"{what} {rel}")

    for name in ("IDEA.md", "instance.json", "lifecycle.json", "runway.json"):  # the manifest travels with the code it describes
        src = root / "instances" / slug / name
        if src.is_file() and not (tenant / name).exists():
            put(name, src.read_text(encoding="utf-8"), "manifest")
    cur_id = _json(tenant / "ultrastable.json") or {}
    put("ultrastable.json", json.dumps({**cur_id, "identity": ident}, indent=1, ensure_ascii=False) + "\n", "identity in")
    for f in sc["files"]:
        rel, mode = f["path"], f["mode"]
        body, p = render((tdir / (rel + ".tmpl")).read_text(encoding="utf-8"), ctx), tenant / rel
        if mode == "managed" or (mode == "create" and not p.exists()) or (mode == "starter" and fresh and not p.exists()):
            put(rel, body, "wrote")
        elif mode == "block":
            rx = BLOCKS[f["block"]]
            block = rx.search(body).group(0)
            if not p.exists():
                put(rel, body, "wrote")
                continue
            cur = p.read_text(encoding="utf-8")
            if rx.search(cur):
                new = rx.sub(lambda _m: block, cur)
            elif f.get("at") == "after-title" and re.search(r"^# .*$", cur, re.M):  # right under the title: the first thing a visitor reads
                new = re.sub(r"^(# .*)$", lambda m: m.group(1) + "\n\n" + block, cur, count=1, flags=re.M)
            else:
                new = cur.rstrip("\n") + "\n\n" + block + "\n"
            put(rel, new, f"{f['block']} block in")
        elif mode == "json":
            cur, want = (_json(p) or {}) if p.exists() else {}, json.loads(body)
            new = {**want, **cur} if cur else want  # the tenant's own keys and order win; the standard's keys are then set
            new.update({k: v for k, v in want.items() if k in ("type", "private", "description")})
            new["scripts"] = {**(cur.get("scripts") or {}), "test": want["scripts"]["test"]}
            put(rel, json.dumps(new, indent=2, ensure_ascii=False) + "\n", "set keys in")
    for src, dst in sc["copy"].items():
        put(dst, (root / src).read_text(encoding="utf-8"), "copied")
    for src, dst in (sc.get("copy_if_missing") or {}).items():
        if not (tenant / dst).exists():
            put(dst, (root / src).read_text(encoding="utf-8"), "copied")
    if not (tenant / "wrangler.jsonc").exists():
        put("wrangler.jsonc", wrangler(ctx), "wrote")
    lc = _json(tenant / "lifecycle.json")
    if lc is not None:
        b = lc.setdefault("build", {})
        b["repo"] = ctx["repo"]
        for k in ("paths", "tests"):  # written when the code sat in the core: the same files, at this repository's own paths
            b[k] = [x[len(f"instances/{slug}/"):] if x.startswith(f"instances/{slug}/") else x for x in b.get(k) or []]
        if not b.get("paths"):
            b["paths"] = ["worker/index.js", "worker/site.js", "worker/contract.js", "worker/entries.js"]
        if not b.get("tests"):
            b["tests"] = ["worker/worker.test.mjs", "worker/contract.test.mjs"]
        put("lifecycle.json", json.dumps(lc, indent=1, ensure_ascii=False) + "\n", "build answers in")
    vmap, lines = {**ctx["vendor"], **std["vendor"]["base"]}, []
    for src, dst in sorted(vmap.items(), key=lambda kv: kv[1]):
        if not (root / src).is_file():
            raise SystemExit(f"tenantstd: the vendor map names {src}, which is not in the core")
        (tenant / dst).parent.mkdir(parents=True, exist_ok=True)
        if not (tenant / dst).is_file() or (tenant / dst).read_bytes() != (root / src).read_bytes():
            (tenant / dst).write_bytes((root / src).read_bytes())
            done.append(f"vendored {src} -> {dst}")
        lines.append(f"{src} -> {dst} sha256:{_sha(tenant / dst)}")
    vf = tenant / std["vendor"]["dir"] / "VENDORED_FROM"
    had = vf.read_text(encoding="utf-8").splitlines()[1:] if vf.is_file() else None
    if had != lines:  # the commit line moves only when a vendored file did, so a second run is a no-op
        put(std["vendor"]["dir"] + "VENDORED_FROM", f"{std['core_repo']}@{_core_commit(root)}\n" + "\n".join(lines) + "\n", "wrote")
    try:  # last: the identity files of the full conformance set are rendered from the manifest just written (README keeps the Live block)
        done += [f"rendered {rel}" for rel in render_surfaces(tenant, std, root)]
    except SystemExit as e:  # an identity the renderer refuses is reported, and the conformance reading then names each file it lacks
        done.append(f"not rendered: {e}")
    # net changes: a file a step wrote and the renderer then put back as it was (the README block while the registries and the manifest
    # disagree about where it runs, which check_tenant reports) is not a change, so a second run still reports nothing
    same = {rel for rel, was in orig.items() if was is not None and (tenant / rel).is_file() and (tenant / rel).read_bytes() == was}
    return [x for x in done if x.startswith("not rendered") or x.rsplit(" ", 1)[-1] not in same]


def _module(path: Path, name: str):
    """A kit script loaded by its path, with no bytecode written beside it (a tenant's vendor/ holds only what VENDORED_FROM lists)."""
    import importlib.util
    spec, was = importlib.util.spec_from_file_location(name, path), sys.dont_write_bytecode
    m = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode = True
    try:
        spec.loader.exec_module(m)
    finally:
        sys.dont_write_bytecode = was
    return m


def render_surfaces(tenant: Path, std: dict | None = None, root: Path | None = None) -> list[str]:
    """Render the identity files from tenant/ultrastable.json with the kit renderer (vendored, else the core's); the paths written."""
    if std is None:
        std, root = locate()
    tool = _tool(tenant, std, root, "renderer")
    if tool is None:
        raise SystemExit(f"tenantstd: no renderer ({(std.get('conformance') or {}).get('renderer', {}).get('tenant')}) in this repository")
    try:
        return _module(tool, "tenantstd_surfaces").render(Path(tenant))
    except ValueError as e:  # the kit's Unrenderable: the manifest is not valid, so nothing is rendered and nothing is guessed
        raise SystemExit(f"tenantstd: {tool.name} renders nothing from {Path(tenant) / 'ultrastable.json'}: " + "; ".join(getattr(e, "problems", None) or [str(e)])) from e


# ---- the core side ----------------------------------------------------------------------------------------------------------------------

def tenants(root: Path, std: dict) -> dict:
    """Registered tenants the standard applies to: every state with a repository of its own shape. Retired and exempt ones are named, not read."""
    return {s: t for s, t in (_json(root / REG) or {}).get("tenants", {}).items() if t.get("state") != "retired" and s not in std.get("exempt", {})}


def check_core(root: Path | None = None, std: dict | None = None) -> list[str]:
    if std is None or root is None:
        std, root = locate()
    bad, sc = [], std["scaffold"]
    for f in sc["files"]:
        if not (root / sc["dir"] / (f["path"] + ".tmpl")).is_file():
            bad.append(f"{sc['dir']}/{f['path']}.tmpl: the scaffold has no template for this standard file")
    scaffolded = {f["path"] for f in sc["files"]} | set(sc["copy"].values()) | set((sc.get("copy_if_missing") or {}).values()) | set(sc["generated"]) | {"IDEA.md", "instance.json"}
    bad += [f"{STD_CORE}: standard file {f['path']} is written by no part of the scaffold" for f in std["files"] if f["path"] not in scaffolded]
    c = std.get("conformance") or {}
    named = [c.get("register")] + [c.get(k, {}).get("core") for k in ("tool", "renderer")] if c else []
    for src in list(std["vendor"]["base"]) + list(sc["copy"]) + list(sc.get("copy_if_missing") or {}) + [x for x in named if x]:
        if not (root / src).is_file():
            bad.append(f"{STD_CORE}: names {src}, which is not in the core")
    for k in ("tool", "renderer"):
        src = c.get(k, {}).get("core")
        if src and std["vendor"]["base"].get(src) != c[k].get("tenant"):
            bad.append(f"{STD_CORE}: conformance {k} {src} is not vendored to {c[k].get('tenant')} by vendor.base")
    if c.get("register") and (root / c["register"]).is_file():
        written = scaffolded | _rendered_paths(root, std)
        for f in json.loads((root / c["register"]).read_text(encoding="utf-8"))["files"]:
            if f["path"] not in written:
                bad.append(f"{c['register']}: {f['path']} is written by no part of the scaffold and not by the renderer, so a new tenant would lack it")
    for slug, t in tenants(root, std).items():
        v = t.get("vendor") or {}
        for src, dst in std["vendor"]["base"].items():
            if v.get(src) != dst:  # no exception holds this: vendor_sync.mjs copies only what the map lists, so a missing pair never arrives
                bad.append(f"{slug}: vendor map in {REG} does not carry {src} -> {dst} (every tenant vendors the standard's base files)")
        bad += [f"{slug}: vendors {src} to {dst}, outside {std['vendor']['dir']}" for src, dst in v.items() if not dst.startswith(std["vendor"]["dir"]) and dst not in excepted(slug, std)]
        bad += [f"{slug}: vendor map names {src}, which is not in the core" for src in v if not (root / src).is_file()]
        if t.get("write"):
            bad.append(f"{slug}: hand-typed `write` files in {REG}; a repository's files come from the one scaffold ({sc['dir']})")
    for slug, e in std.get("exceptions", {}).items():
        for d in ([] if slug == "_doc" else e if isinstance(e, list) else [e]):
            if not (isinstance(d, dict) and len(str(d.get("why", ""))) >= 40 and d.get("item") and re.match(r"^\d{4}-\d\d-\d\d$", str(d.get("until", "")))):
                bad.append(f"{STD_CORE}: exception for {slug} needs a reason, a queue item and an `until` date")
            elif not (d.get("vendor_outside") or d.get("conformance") == "pending"):
                bad.append(f"{STD_CORE}: exception for {slug} ({d['item']}) names no rule it departs from (vendor_outside or conformance pending)")
            elif (root / ISSUES).is_dir() and not (root / ISSUES / f"{d['item']}.json").is_file():
                bad.append(f"{STD_CORE}: exception for {slug} names {d['item']}, which is not a queue item ({ISSUES}{d['item']}.json), so no loop owns the step that ends it")
    for slug, e in std.get("exempt", {}).items():
        if len(str(e.get("why", ""))) < 40:
            bad.append(f"{STD_CORE}: exempt {slug} needs a reason")
    return bad


def _rendered_paths(root: Path, std: dict) -> set:
    """The paths the kit renderer writes for a tenant, read by rendering a throwaway tenant whose manifest carries every fact a render needs (a
    live address, the Worker it runs as, its loop, the core's LICENSE), so the set never depends on one registered tenant's data. Nothing is kept."""
    import tempfile
    org, host = std["core_repo"].split("/")[0], std["scaffold"]["defaults"]["host"].replace("{slug}", "sample")
    ident = {"name": "Sample tenant", "slug": "sample", "repo": f"{org}/sample", "public_url": f"https://{host}", "license": "LicenseRef-Ultrastable-USL-1.0",
             "summary": "A throwaway tenant the core renders to learn which files the kit renderer writes for a tenant repository.",
             "loop": "Each hour the tenant's beat reads its sources, records what changed with the source of each change, and files what it could not read.",
             "topics": ["ultrastable"], "layer": "tenant", "parent": std["core_repo"], "visibility": "public", "visibility_reason": "DISCOVER-1: public by default",
             "status": "live", "runs_as": [{"provider": "cloudflare", "kind": "worker", "name": "ultrastable-sample", "routes": [host], "how": HOW}]}
    with tempfile.TemporaryDirectory(prefix="tenantstd-render-") as d:
        t = Path(d)
        (t / "ultrastable.json").write_text(json.dumps({"identity": ident}), encoding="utf-8")
        (t / "LICENSE").write_bytes((root / "LICENSE").read_bytes())
        (t / "README.md").write_text(f"# {ident['name']}\n", encoding="utf-8")
        try:
            return set(render_surfaces(t, std, root))  # the throwaway tenant vendors nothing, so this is the core's renderer
        except SystemExit:
            return set()


def table(paths: list[Path], std: dict) -> str:
    cols = [Path(p) for p in paths]
    rows = [("part", [slug_of(c) for c in cols])]
    for f in std["files"]:
        rows.append((f["path"], ["yes" if (c / f["path"]).is_file() else "-" for c in cols]))
    probs = [check_tenant(c, std) for c in cols]
    rows.append(("README Live block", ["yes" if (c / "README.md").is_file() and BLOCKS["live"].search((c / "README.md").read_text(encoding="utf-8")) else "-" for c in cols]))
    for key, label in (("live", "live block problems"), ("workflow", "workflow lint failures"), ("vendor", "vendor problems"), ("runway", "runway problems"), ("lifecycle", "lifecycle problems"), ("merge", "merge markers")):
        rows.append((label, [str(sum(1 for b in p if b.startswith(key))) for p in probs]))
    rows.append(("other workflows", [",".join(sorted(y.name for y in (c / ".github/workflows").glob("*.y*ml") if y.name not in ("ci.yml", "vendor-sync.yml", "branch-cleanup.yml"))) or "-" if (c / ".github/workflows").is_dir() else "-" for c in cols]))
    rows.append(("problems in all", [str(len(p)) for p in probs]))
    w = max(len(r[0]) for r in rows)
    return "\n".join(r[0].ljust(w) + " | " + " | ".join(str(x).ljust(18) for x in r[1]) for r in rows)


def live(root: Path, std: dict, clone=None) -> dict:
    """Each registered tenant's main, cloned and read. clone(repo, dest) -> bool; an unreadable repository is a failure, never a pass."""
    import tempfile
    def _clone(repo, dest):
        r = subprocess.run(["git", "clone", "-q", "--depth", "1", f"https://github.com/{repo}.git", str(dest)], capture_output=True, text=True, timeout=180)
        if r.returncode:
            print(f"tenantstd: cannot clone {repo}: {r.stderr.strip()[:200]}", file=sys.stderr)
        return r.returncode == 0
    out = {}
    for slug, t in sorted(tenants(root, std).items()):
        with tempfile.TemporaryDirectory(prefix="tenantstd-") as d:
            ok = (clone or _clone)(t["repo"], Path(d) / slug)
            out[slug] = check_tenant(Path(d) / slug, std, root) if ok else [f"repository {t['repo']} could not be read"]
    return out


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(prog="tenantstd")
    ap.add_argument("--check", action="store_true")
    ap.add_argument("--tenant")
    ap.add_argument("--measure")
    ap.add_argument("--scaffold")
    ap.add_argument("--slug")
    ap.add_argument("--table", nargs="+")
    ap.add_argument("--live", action="store_true")
    ap.add_argument("--normalize")
    ap.add_argument("--render")
    a = ap.parse_args(argv)
    std, root = locate()
    if a.normalize:
        changed = normalize_file(Path(a.normalize), root)
        print(f"tenantstd: {Path(a.normalize) / 'ultrastable.json'} " + ("rewritten in the schema's shape" if changed else "is already in the schema's shape"))
        return 0
    if a.render:
        for rel in render_surfaces(Path(a.render), std, root):
            print(rel)
        return 0
    if a.scaffold:
        for line in scaffold(Path(a.scaffold), a.slug or slug_of(Path(a.scaffold)), root, std):
            print(line)
        return 0
    if a.table:
        print(table([Path(p) for p in a.table], std))
        return 0
    if a.live:
        res = live(root, std)
        for slug, bad in res.items():
            print(f"{slug}: {'meets the standard' if not bad else str(len(bad)) + ' problem(s)'}")
            for b in bad:
                print(f"  {b}")
        return 1 if any(res.values()) else 0
    target = a.measure or a.tenant
    if target:
        excused = []
        bad = check_tenant(Path(target), std, root, excused)
        for b in bad:
            print("tenantstd:", b)
        for ex in departures(slug_of(Path(target)), std):
            what = ", ".join(ex.get("vendor_outside", [])) or f"the conformance set is pending ({len(excused)} finding(s) held)"
            print(f"tenantstd: exception in effect until {ex['until']} ({ex['item']}): {what}")
        for b in excused:
            print("tenantstd: held by the exception:", b)
        print(f"tenantstd: {slug_of(Path(target))} meets the standard" if not bad else f"tenantstd: {len(bad)} problem(s) in {slug_of(Path(target))}")
        return 0 if (a.measure or not bad) else 1
    if root is None:
        print("tenantstd: in a tenant repository run --check --tenant .", file=sys.stderr)
        return 2
    bad = check_core(root, std)
    for b in bad:
        print("tenantstd:", b)
    print("tenantstd ok" if not bad else f"tenantstd: {len(bad)} problem(s)")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
