#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""DEPROT-1: dependency rot is watched by a bot, and the watch must cover every manifest. Ultrastable is the foundation for any autonomous system.

  python3 scripts/deprot.py --check [PATH]   every package.json and pyproject.toml directory, and the workflows, has a Dependabot entry

The one copy every system carries (stdlib only, USER-BACKEND-1): scripts/repoconform.py reads it for .github/dependabot.yml and the platform's
foundation/deprot.py imports it. vendor/ (core files a tenant vendors, kept current by vendor-sync, never by Dependabot) and node_modules/ are
not read. Both `directory:` and `directories:` (a list, globs allowed) are read, as Dependabot v2 reads them. A shrink-only baseline
(doctrine/deprot.json) lists manifests that have no entry yet."""
from __future__ import annotations
import fnmatch, json, re, sys
from pathlib import Path

ECO = {"package.json": "npm", "pyproject.toml": "pip"}
SKIP = {"node_modules", ".git", "vendor", "kit", "artifacts", ".selfhost"}


def manifests(root) -> set[tuple[str, str]]:
    root, out = Path(root), set()
    for name, eco in ECO.items():
        for p in root.rglob(name):
            if not SKIP & set(p.relative_to(root).parts):
                d = "/" + p.parent.relative_to(root).as_posix()
                out.add((eco, "/" if d == "/." else d))
    if (root / ".github/workflows").is_dir():
        out.add(("github-actions", "/"))
    return out


def _norm(d: str) -> str:
    d = d.strip().strip("\"'").strip("/")
    return "/" + d if d else "/"


def covered(root) -> set[tuple[str, str]]:
    """(ecosystem, directory or glob) for every entry of .github/dependabot.yml, read line by line with no YAML library."""
    p = Path(root) / ".github/dependabot.yml"
    if not p.is_file():
        return set()
    got, eco, dirs_at = set(), None, None
    for line in p.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        m = re.match(r"\s*-\s*package-ecosystem:\s*[\"']?([\w-]+)", line)
        if m:
            eco, dirs_at = m.group(1), None
            continue
        m = re.match(r"(\s*)(directory|directories):\s*(.*?)\s*(?:#.*)?$", line)
        if m and eco:
            val, dirs_at = m.group(3), None
            if m.group(2) == "directory" and val:
                got.add((eco, _norm(val)))
            elif val.startswith("["):
                got |= {(eco, _norm(x)) for x in val.strip("[]").split(",") if x.strip()}
            elif not val:
                dirs_at = len(m.group(1))
            continue
        m = re.match(r"(\s*)-\s*(\S+)", line)
        if dirs_at is not None and m and len(m.group(1)) >= dirs_at:
            got.add((eco, _norm(m.group(2))))
            continue
        dirs_at = None
    return got


def _covers(pattern: str, d: str) -> bool:
    if pattern == d:
        return True
    if not any(c in pattern for c in "*?["):
        return False
    return (pattern.endswith("/**") and d == (pattern[:-3] or "/")) or fnmatch.fnmatchcase(d, pattern)


def baseline(root) -> set[tuple[str, str]]:
    p = Path(root) / "doctrine/deprot.json"
    return {(b["ecosystem"], b["directory"]) for b in json.loads(p.read_text(encoding="utf-8"))["baseline"]} if p.is_file() else set()


def hit(cov: set, eco: str, d: str) -> bool:
    return any(e == eco and _covers(pat, d) for e, pat in cov)


def missing(root, base=None) -> list[tuple[str, str]]:
    """Manifest directories no Dependabot entry covers and the baseline does not list."""
    cov, base = covered(root), baseline(root) if base is None else base
    return sorted(m for m in manifests(root) if m not in base and not hit(cov, *m))


def check(root) -> list[str]:
    root = Path(root)
    base, cov, have = baseline(root), covered(root), manifests(root)
    bad = [f"no Dependabot entry for {e} at {d}" for e, d in missing(root, base)]
    bad += [f"baseline entry {e} at {d} is covered or gone: remove it from doctrine/deprot.json" for e, d in sorted(b for b in base if hit(cov, *b) or b not in have)]
    return bad


def main(argv=None) -> int:
    a = list(sys.argv[1:] if argv is None else argv)
    root = next((x for x in a if not x.startswith("--")), str(Path(__file__).resolve().parents[1]))
    bad = check(root)
    print("\n".join(bad) or "deprot ok")
    return 1 if bad else 0


if __name__ == "__main__":
    sys.exit(main())
