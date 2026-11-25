#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""BRANCH-CLEANUP-1 (Rowan, 2026-11-25): no branch outlives its pull request in any Ultrastable repository.

For every repository in the org:
  1. enforce the repo settings delete_branch_on_merge=true and allow_auto_merge=true (reset when they drift);
  2. delete every branch whose pull requests are all merged or closed (recoverable from refs/pull/<n>/head);
  3. delete every branch with no pull request once its tip is older than --window-hours, after moving the tip to
     refs/archive/<name> so no unmerged commit is lost;
  4. a branch whose pull requests are all closed but whose tip is not the head of any of them holds commits pushed after the
     last merge (a session reusing its branch name): its tip is moved to refs/archive/<name> first, once it is older than the window.
main, the default branch, *-evidence ledger branches, protected branches and any branch with an open pull request are never touched.
REPO-STANDARD-1: with BRANCH_CLEANUP_SETTINGS=off (the per-repository workflow) the settings are left to the core's
`python3 -m foundation repostd --apply`, which owns them for every repository; a repository's own token may not change them, and a
run that could never succeed taught nothing.
--check exits 1 when a repo has the setting off or holds a stale branch (the probe). --apply does the work.
"""
import argparse, datetime as dt, json, os, subprocess, sys, urllib.parse

ORG = os.environ.get("BRANCH_CLEANUP_ORG", "ultrastable")
# AUTO-MERGE-DEFAULT-1 (Rowan, 2026-11-25): auto-merge and auto-delete of head branches are the default in every Ultrastable repository.
REPO_SETTINGS = {"delete_branch_on_merge": True, "allow_auto_merge": True}


def gh(*args, method="GET", fields=None, paginate=False):
    cmd = ["gh", "api", "-X", method]
    if paginate:
        cmd += ["--paginate", "--slurp"]
    for k, v in (fields or {}).items():
        cmd += ["-F" if isinstance(v, bool) else "-f", f"{k}={str(v).lower() if isinstance(v, bool) else v}"]
    p = subprocess.run(cmd + list(args), capture_output=True, text=True)
    if p.returncode:
        raise RuntimeError(f"{' '.join(args)}: {p.stderr.strip() or p.stdout.strip()}")
    out = p.stdout.strip()
    data = json.loads(out) if out else None
    return [x for page in data for x in page] if paginate and data else data


def repos():
    if os.environ.get("BRANCH_CLEANUP_REPOS"):
        names = os.environ["BRANCH_CLEANUP_REPOS"].split()
        here = os.path.dirname(os.path.abspath(__file__))
        tr = os.path.join(here, "..", "doctrine", "tenant-repos.json")
        if os.path.exists(tr) and len(names) > 1:  # the core's sweep: every registered repository gets the cleanup the moment it exists
            for t in json.load(open(tr)).get("tenants", {}).values():
                n = t.get("repo", "").split("/")[-1]
                if n and n not in names and t.get("state") != "retired":
                    names.append(n)
            fs = os.path.join(here, "..", "doctrine", "full-stack.json")  # seeds with their own repository (REPO-STANDARD-1)
            if os.path.exists(fs):
                for row in json.load(open(fs)).get("systems", {}).values():
                    n = str(row.get("repo", "")).split("/")[-1]
                    if n and n not in names:
                        names.append(n)
        return names
    return [r["name"] for r in gh(f"orgs/{ORG}/repos?per_page=100&type=all", paginate=True) if not r.get("archived")]


def via_admin_app(full):
    """The second route for the two settings (deploy/repo-settings.mjs over the job's OIDC token). None when it is not available or refused."""
    if not os.environ.get("ACTIONS_ID_TOKEN_REQUEST_URL"):
        return None
    script = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "deploy", "repo-settings.mjs")
    p = subprocess.run(["node", script, full], capture_output=True, text=True)
    if p.returncode:
        print(f"::warning::{full}: the admin app route refused too: {p.stderr.strip()[:300]}")
        return None
    return p.stdout.strip() or "unchanged"


def run(apply, window_h):
    now = dt.datetime.now(dt.timezone.utc)
    stale, errors, done = 0, 0, []
    for name in repos():
        full = f"{ORG}/{name}"
        try:
            meta = gh(f"repos/{full}")
        except RuntimeError as e:  # a repo this token cannot read is unmeasured, never clean; the run goes on to the next repo
            errors += 1
            print(f"::warning::{full}: unreadable with this token: {e}")
            continue
        default = meta["default_branch"]
        want = dict(REPO_SETTINGS)
        if meta.get("private"):  # GitHub's Free plan has no auto-merge on a private repository: gated, never drift
            want.pop("allow_auto_merge", None)
        drift = {} if os.environ.get("BRANCH_CLEANUP_SETTINGS") == "off" else {k: v for k, v in want.items() if meta.get(k) is not v}
        if drift:
            stale += 1
            if apply:
                try:
                    gh(f"repos/{full}", method="PATCH", fields=drift)
                    done.append(f"{full}: settings on: {', '.join(drift)}")
                except RuntimeError as e:
                    # REPO-SETTINGS-1: this token may not change settings (no ORG_ADMIN_TOKEN); the platform's admin app is the second route
                    via = via_admin_app(full)
                    if via is None:
                        errors += 1
                        print(f"::warning::{full}: setting refused: {e}")
                    else:
                        done.append(f"{full}: settings on through the platform's admin app: {via}")
            else:
                print(f"{full}: settings off: {', '.join(drift)}")
        for b in gh(f"repos/{full}/branches?per_page=100", paginate=True):
            br = b["name"]
            if br in ("main", default) or br.endswith("-evidence") or b.get("protected"):  # loop-evidence, ciwatch-evidence ...: ledgers loops append to
                continue
            prs = gh(f"repos/{full}/pulls?state=all&per_page=100&head={ORG}:{urllib.parse.quote(br)}")
            if any(p["state"] == "open" for p in prs):
                continue
            sha = b["commit"]["sha"]
            # commits pushed after the last pull request closed are unmerged work: same window and same archive as a branch with no pull request
            moved = bool(prs) and sha not in {(p.get("head") or {}).get("sha") for p in prs}
            if not prs or moved:
                c = gh(f"repos/{full}/commits/{sha}")
                age = now - dt.datetime.fromisoformat(c["commit"]["committer"]["date"].replace("Z", "+00:00"))
                if age.total_seconds() < window_h * 3600:
                    continue
            stale += 1
            why = "pr " + ",".join(f"#{p['number']}:{'merged' if p.get('merged_at') else 'closed'}" for p in prs) if prs else "no pr"
            if moved:
                why += "; tip moved past the pull request, archived"
            if not apply:
                print(f"{full}: stale {br} ({why})")
                continue
            try:
                if not prs or moved:  # unmerged work keeps its commits under refs/archive/
                    try:
                        gh(f"repos/{full}/git/refs", method="POST", fields={"ref": f"refs/archive/{br}", "sha": sha})
                    except RuntimeError as e:
                        if "already exists" not in str(e):
                            raise
                        gh(f"repos/{full}/git/refs/archive/{br}", method="PATCH", fields={"sha": sha, "force": True})
                gh(f"repos/{full}/git/refs/heads/{urllib.parse.quote(br)}", method="DELETE")
                done.append(f"{full}: deleted {br} ({why})")
            except RuntimeError as e:
                errors += 1
                print(f"::warning::{full}: {br}: {e}")
    for d in done:
        print(d)
    print(json.dumps({"stale_before": stale, "fixed": len(done), "errors": errors}))
    return 1 if (stale and not apply) or errors else 0


if __name__ == "__main__":
    a = argparse.ArgumentParser()
    a.add_argument("--apply", action="store_true")
    a.add_argument("--check", action="store_true")
    a.add_argument("--window-hours", type=float, default=float(os.environ.get("BRANCH_WINDOW_HOURS", 6)))
    o = a.parse_args()
    sys.exit(run(o.apply, o.window_hours))
