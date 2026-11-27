#!/usr/bin/env python3
# SPDX-License-Identifier: LicenseRef-Ultrastable-USL-1.0
# Copyright (c) Ultrastable
"""REPO-CONFORM-2: every repository carries the machine-readable files in autonomy/repo-conformance.json, each valid against its own standard.

  python3 scripts/repoconform.py --check [PATH] [--only FILE]   exit 1 and list each file that is missing, invalid or unmeasured
  python3 scripts/repoconform.py --json [PATH] [--only FILE]    the same reading as JSON, with the reason per file, for loops
  python3 scripts/repoconform.py --remote OWNER/REPO [--json]   read a repository's default branch through the GitHub contents API
  python3 scripts/repoconform.py --fleet FLEETMAP.json [--json] every repository row of doctrine/fleet-map.json; exit 1 on any fail or unmeasured

Each row names a validator here (stdlib only, no YAML library: descriptor files are read with the block subset in yaml_docs). A file the checker
cannot read is `unmeasured`, never ok. Every file scripts/surfaces.py renders from ultrastable.json must also equal its render; a remote read
fetches every rendered path the tree holds, so the comparison is never against a placeholder. GITHUB_TOKEN (or GH_TOKEN) is used when the
environment holds one; a private repository read without one is unmeasured. --fleet ends with one summary line naming each repository that does
not conform, its file score and the files that fail, so a failure-audit signature moves with the fleet. Tests: tests/test_repoconform.py."""
from __future__ import annotations
import http.client, json, os, re, shlex, sys, tempfile, tomllib, urllib.parse, urllib.request
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
KIT = HERE.parent
RULES = next((p for p in (KIT / "autonomy/repo-conformance.json", HERE / "repo-conformance.json") if p.is_file()), KIT / "autonomy/repo-conformance.json")
API = "https://api.github.com"
SKIP = {".git", "node_modules", "vendor"}
FETCH = {"README.md", "CITATION.cff", "LICENSE", "package.json", "ops/seed-lifecycle.json", "doctrine/deprot.json",
         "standards/system.schema.json", "seed/standards/system.schema.json"}  # what surfaces.py and the validators read; rendered paths follow
READ_ERRORS = (OSError, ValueError, http.client.HTTPException)  # a network or protocol failure on one read (IncompleteRead is not an OSError)


class Unmeasured(Exception):
    """The checker could not read the file: never a pass."""


class YamlError(ValueError):
    """The text is not valid YAML."""


def _kit(name: str):  # surfaces.py and deprot.py sit beside this script, in the kit and where a tenant vendors them
    if str(HERE) not in sys.path:
        sys.path.insert(0, str(HERE))
    return __import__(name)


def rules() -> dict:
    return json.loads(RULES.read_text(encoding="utf-8"))


# --- YAML: the block subset descriptor files use (mappings, sequences, plain, quoted, flow and block scalars, comments, ---) ---
KEY = re.compile(r"""^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#\-?:,\[\]{}&*!|>%@`][^:#]*?|-[^\s:][^:#]*?)\s*:(?:\s+(.*))?$""")


def _uncomment(s: str) -> str:
    q = None
    for i, c in enumerate(s):
        if q:
            if c == q and not (q == '"' and s[i - 1] == "\\"):
                q = None
        elif c in "\"'" and (i == 0 or s[i - 1] in " \t[{,:"):
            q = c
        elif c == "#" and (i == 0 or s[i - 1] in " \t"):
            return s[:i].rstrip()
    return s.rstrip()


def _split_flow(s: str) -> list[str]:
    out, depth, q, cur = [], 0, None, ""
    for c in s:
        if q:
            q = None if c == q else q
        elif c in "\"'":
            q = c
        elif c in "[{":
            depth += 1
        elif c in "]}":
            depth -= 1
        elif c == "," and depth == 0:
            out.append(cur)
            cur = ""
            continue
        cur += c
    return [x.strip() for x in out + [cur] if x.strip()]


def _scalar(s: str):
    s = s.strip()
    if s in ("", "~", "null", "Null", "NULL"):
        return None
    if s[0] == '"':
        try:
            return json.loads(s)  # a one-line YAML double-quoted scalar is a JSON string
        except ValueError:
            raise YamlError(f"bad double-quoted scalar {s[:40]}") from None
    if s[0] == "'":
        if len(s) < 2 or s[-1] != "'":
            raise YamlError(f"unterminated quote {s[:40]}")
        return s[1:-1].replace("''", "'")
    if s[0] in "[{":
        if s[-1] != {"[": "]", "{": "}"}[s[0]]:
            raise Unmeasured(f"a flow collection this reader cannot follow: {s[:40]}")
        parts = _split_flow(s[1:-1])
        if s[0] == "[":
            return [_scalar(p) for p in parts]
        return {_scalar(k) if k.strip()[:1] in "\"'" else k.strip(): _scalar(v) for k, v in (p.split(":", 1) if ":" in p else (p, "") for p in parts)}
    if s[0] in "&*!%@`":
        raise Unmeasured(f"a YAML feature this reader does not take (anchor, alias, tag or directive): {s[:40]}")
    if s in ("true", "True", "TRUE", "false", "False", "FALSE"):
        return s[0] in "tT"
    if re.fullmatch(r"[-+]?\d+", s):
        return int(s)
    if re.fullmatch(r"[-+]?(\d+\.\d*|\.\d+)([eE][-+]?\d+)?", s):
        return float(s)
    return s


def _is_item(s: str) -> bool:
    return s == "-" or s.startswith("- ")


def _block(y, i, ind):
    return _seq(y, i, ind) if _is_item(y["rows"][i][1]) else _map(y, i, ind)


def _tail(y, i, ind, first):  # a scalar continues on deeper lines (a multi-line plain or quoted scalar)
    rows, parts = y["rows"], [first]
    while i < len(rows) and rows[i][0] > ind:
        parts.append(rows[i][1])
        i += 1
    return _scalar(" ".join(parts)), i


def _literal(y, i, ind, style):
    rows, start = y["rows"], y["rows"][i - 1][2] + 1
    j = i
    while j < len(rows) and rows[j][0] > ind:
        j += 1
    raw = [ln for ln in y["lines"][start:rows[j][2] if j < len(rows) else len(y["lines"])] if not ln.strip() or len(ln) - len(ln.lstrip()) > ind]
    if not any(ln.strip() for ln in raw):
        return "", j
    cut = min(len(ln) - len(ln.lstrip()) for ln in raw if ln.strip())
    body = [ln[cut:] for ln in raw]
    while body and not body[-1].strip():
        body.pop()
    if style[0] == "|":
        text = "\n".join(body)
    else:  # folded: lines of a paragraph join with a space, a blank line is one newline
        paras, cur = [], []
        for ln in body:
            if ln.strip():
                cur.append(ln.strip())
            else:
                paras.append(" ".join(cur))
                cur = []
        text = "\n".join(paras + [" ".join(cur)])
    return text + ("" if "-" in style else "\n"), j


def _map(y, i, ind):
    rows, out = y["rows"], {}
    while i < len(rows) and rows[i][0] == ind and not _is_item(rows[i][1]):
        m = KEY.match(rows[i][1])
        if not m:
            raise YamlError(f"line {rows[i][2] + 1}: expected `key: value`")
        k = _scalar(m.group(1)) if m.group(1)[0] in "\"'" else m.group(1).strip()
        if k in out:
            raise YamlError(f"line {rows[i][2] + 1}: key {k!r} repeats")
        v, i = (m.group(2) or "").strip(), i + 1
        if re.fullmatch(r"[|>][-+]?\d?", v):
            out[k], i = _literal(y, i, ind, v)
        elif v:
            out[k], i = _tail(y, i, ind, v)
        elif i < len(rows) and (rows[i][0] > ind or (rows[i][0] == ind and _is_item(rows[i][1]))):
            out[k], i = _block(y, i, rows[i][0])
        else:
            out[k] = None
    if i < len(rows) and rows[i][0] > ind:
        raise YamlError(f"line {rows[i][2] + 1}: unexpected indentation")
    return out, i


def _seq(y, i, ind):
    rows, out = y["rows"], []
    while i < len(rows) and rows[i][0] == ind and _is_item(rows[i][1]):
        rest = rows[i][1][1:].lstrip()
        col = ind + len(rows[i][1]) - len(rest)
        if not rest:
            i += 1
            v, i = _block(y, i, rows[i][0]) if i < len(rows) and rows[i][0] > ind else (None, i)
        elif _is_item(rest) or (KEY.match(rest) and not rest.startswith(("[", "{"))):
            rows[i] = [col, rest, rows[i][2]]  # a mapping or sequence that starts on the dash line sits at the dash's content column
            v, i = _block(y, i, col)
        else:
            v, i = _tail(y, i + 1, ind, rest)
        out.append(v)
    return out, i


def yaml_docs(text: str) -> list:
    """Every document of a YAML file. Invalid YAML raises YamlError; a valid feature outside the subset raises Unmeasured."""
    docs, cur = [], []
    for raw in text.replace("\r\n", "\n").lstrip("\ufeff").split("\n"):
        if re.match(r"(---|\.\.\.)(\s|$)", raw):
            docs.append(cur)
            cur = []
        else:
            cur.append(raw)
    out = []
    for lines in docs + [cur]:
        rows = []
        for n, raw in enumerate(lines):
            if "\t" in raw[: len(raw) - len(raw.lstrip())]:
                raise YamlError(f"line {n + 1}: a tab in the indentation")
            s = _uncomment(raw)
            if s.strip():
                rows.append([len(s) - len(s.lstrip()), s.strip(), n])
        if not rows:
            continue
        y = {"rows": rows, "lines": lines}
        if not _is_item(rows[0][1]) and not KEY.match(rows[0][1]):
            out.append(_scalar(" ".join(r[1] for r in rows)))
            continue
        v, i = _block(y, 0, rows[0][0])
        if i != len(rows):
            raise YamlError(f"line {rows[i][2] + 1}: unexpected indentation")
        out.append(v)
    return out


def _mapping(text: str) -> dict:
    docs = [d for d in yaml_docs(text) if d is not None]
    if len(docs) != 1 or not isinstance(docs[0], dict):
        raise YamlError("is not one YAML mapping")
    return docs[0]


# --- shared readings ---
def _identity(root) -> dict:
    try:
        return json.loads((Path(root) / "ultrastable.json").read_text(encoding="utf-8")).get("identity") or {}
    except (OSError, ValueError, AttributeError):
        return {}


def spdx_ids(expr: str) -> list[str]:
    """The license and exception ids of an SPDX expression (split on AND, OR, WITH and parentheses)."""
    ids = [t for t in re.split(r"[\s()]+", expr) if t and t.upper() not in ("AND", "OR", "WITH")]
    bad = [t for t in ids if not re.fullmatch(r"(?:(?:DocumentRef-[A-Za-z0-9.-]+:)?LicenseRef-[A-Za-z0-9.-]+|[A-Za-z0-9][A-Za-z0-9.-]*\+?)", t)]
    if bad or not ids:
        raise ValueError(f"{expr!r} is not an SPDX license expression")
    return [t.rstrip("+") for t in ids]


def _license_file(root, sid: str) -> bool:
    d = Path(root) / "LICENSES"
    return d.is_dir() and any(p.is_file() and p.stem == sid for p in d.iterdir())


def _h1(text: str, first=False) -> list[str]:
    head = re.sub(r"\A(?:\s|<!--.*?-->)*", "", text.lstrip("\ufeff"), flags=re.S)
    m = re.match(r"# \S.*(?:\n|$)", head) if first else re.search(r"(?m)^# \S.*(?:\n|$)", head)
    if not m:
        return ["the first line is not an H1 (# Title)" if first else "has no H1 (# Title)"]
    return [] if (head[:m.start()] + head[m.end():]).strip() else ["has a title and no body"]


# --- validators: (root, text, row) -> list of problems; [] is valid ---
def agents_md(root, text, row):
    o, bad = row.get("options") or {}, []
    if text.startswith("\ufeff"):
        bad.append("starts with a byte-order mark; agents read plain UTF-8")
    if re.match(r"\ufeff?---\s*\n", text):
        bad.append("starts with YAML front matter; AGENTS.md is plain Markdown")
    bad += _h1(text, first=True)
    m = re.search(r"(?mi)^##\s+.*\b(build|test|commands?)", text)
    if m:
        nxt = re.search(r"(?m)^#{1,2}\s", text[m.end():])
        sec = text[m.start(): m.end() + (nxt.start() if nxt else len(text))]
    else:
        sec = "\n".join(re.findall(r"(?mi)^\s*[-*]\s+Test:.*$", text))
    if not sec:
        bad.append("has no commands section (an H2 naming build, test or commands, or a `- Test:` line) giving the commands to run")
    cmds = re.findall(r"(?ms)^```[^\n]*\n(.*?)^```", sec)
    cmds = [c for blk in cmds for c in blk.splitlines() if c.strip() and not c.lstrip().startswith("#")]
    cmds += re.findall(r"`([^`\n]+)`", re.sub(r"(?ms)^```.*?^```", "", sec))
    bad += [f"command `{c}` does not resolve: {why}" for c in cmds for why in [_resolve(root, c)] if why]
    limit, exempt = o.get("max_chain_bytes", 32768), set(o.get("chain_exempt_dirs", []))
    sizes = {p.parent: p.stat().st_size for p in Path(root).rglob("AGENTS.md")
             if not SKIP & set(p.relative_to(root).parts) and p.parent.name not in exempt}
    for d in sizes:
        chain = sum(n for a, n in sizes.items() if a == d or a in d.parents)
        if chain > limit:
            bad.append(f"the AGENTS.md files from the root to {d.relative_to(root).as_posix() or '.'} add up to {chain} bytes, over the {limit} a coding agent reads")
    return bad


def _resolve(root, cmd):
    """Why a command in AGENTS.md would not run from the repository root, or None. Programs other than these are not judged."""
    cwd = Path(root)
    for seg in re.split(r"\s*(?:&&|\|\||;|\|)\s*", cmd.strip()):
        try:
            argv = shlex.split(seg)
        except ValueError:
            return "it cannot be split into words"
        while argv and re.match(r"[A-Za-z_]\w*=", argv[0]):
            argv = argv[1:]
        if not argv:
            continue
        prog, args = argv[0], argv[1:]
        words = [a for a in args if not a.startswith("-")]
        if prog == "cd":
            if words and not (cwd / words[0]).is_dir():
                return f"no directory {words[0]}"
            cwd = cwd / words[0] if words else cwd
        elif prog in ("python3", "python") and args[:1] == ["-m"] and len(args) > 1:
            base = cwd / args[1].replace(".", "/")
            if not (base.with_suffix(".py").is_file() or base.is_dir() or args[1].split(".")[0] in sys.stdlib_module_names):
                return f"no module {args[1]} here"
            sub = args[2] if len(args) > 2 and not args[2].startswith("-") else None
            if sub and (base / "__main__.py").is_file() and not ((base / f"{sub}.py").is_file() or (base / sub).is_dir()):
                return f"{args[1]} has no command {sub}"
        elif prog in ("python3", "python", "node", "bash", "sh"):
            for w in words if prog == "node" and "--test" in args else words[:1]:
                if re.search(r"[A-Z]{3,}", w):
                    continue  # a placeholder such as NAME in test/NAME.test.js, filled in by the reader
                if not (any(cwd.glob(w)) if any(c in w for c in "*?[") else (cwd / w).exists()):
                    return f"no file {w}"
        elif prog in ("npm", "pnpm", "yarn"):
            pkg = cwd / "package.json"
            if not pkg.is_file():
                return f"no package.json in {cwd.relative_to(root).as_posix() or '.'}"
            run = words[1] if words[:1] in (["run"], ["run-script"]) and len(words) > 1 else words[0] if words[:1] in (["test"], ["start"]) else None
            if run and run not in (json.loads(pkg.read_text(encoding="utf-8")).get("scripts") or {}):
                return f"package.json has no script {run}"
        elif prog.startswith("./") and not (cwd / prog).is_file():
            return f"no file {prog}"
    return None


def llms_txt(root, text, row):
    lines, bad, section = text.lstrip("\ufeff").splitlines(), [], False
    filled = [(n, ln) for n, ln in enumerate(lines) if ln.strip()]
    if not filled or not re.match(r"# \S", filled[0][1]):
        return ["the first line is not an H1 with the project's name"]
    if len(filled) < 2 or not filled[1][1].startswith(">"):
        bad.append("has no blockquote summary (> ...) right after the H1")
    for n, ln in filled[1:]:
        if re.match(r"#\s", ln):
            bad.append(f"line {n + 1}: a second H1")
        elif re.match(r"#{3,}\s", ln):
            bad.append(f"line {n + 1}: an H3 or deeper heading; llms.txt sections are H2")
        elif re.match(r"##\s", ln):
            section = True
        elif section and re.match(r"\s*[-*+]\s", ln):
            m = re.match(r"\s*[-*+]\s+\[[^\]]+\]\(([^)\s]+)\)(?::\s*\S.*)?\s*$", ln)
            if not m:
                bad.append(f"line {n + 1}: a list item under an H2 is not `- [name](url): notes`")
            else:
                url = m.group(1).split("#")[0].split("?")[0]
                if url and not url.startswith("/") and not re.match(r"[a-z][a-z0-9+.-]*:", url) and not (Path(root) / url).exists():
                    bad.append(f"line {n + 1}: links to {m.group(1)}, which is not in the repository (Ultrastable rule: relative links resolve)")
    return bad


def reuse_toml(root, text, row):
    try:
        d = tomllib.loads(text)
    except tomllib.TOMLDecodeError as e:
        return [f"is not valid TOML ({e})"]
    bad = [] if type(d.get("version")) is int and d["version"] == 1 else ["version is not the integer 1"]
    ann = d.get("annotations")
    if not isinstance(ann, list) or not ann:
        return bad + ["has no [[annotations]] table"]
    for k, a in enumerate(ann, 1):
        p = a.get("path") if isinstance(a, dict) else None
        if not ((isinstance(p, str) and p) or (isinstance(p, list) and p and all(isinstance(x, str) and x for x in p))):
            bad.append(f"annotation {k}: path is not a string or a list of strings")
        lic = a.get("SPDX-License-Identifier") if isinstance(a, dict) else None
        for expr in lic if isinstance(lic, list) else [lic] if lic is not None else []:
            try:
                bad += [f"annotation {k}: no LICENSES/{i}.<ext> holds the text of {i} (REUSE 3.3 needs one file per license)" for i in spdx_ids(str(expr)) if not _license_file(root, i)]
            except ValueError as e:
                bad.append(f"annotation {k}: {e}")
    return bad


def license_(root, text, row):
    m = re.search(r"(?m)^\W*SPDX-License-Identifier:\s*(.+?)\s*(?:-->|\*/)?\s*$", text)
    expr = m.group(1) if m else _identity(root).get("license")
    if not expr:
        return ["names no SPDX-License-Identifier, and ultrastable.json names no identity.license"]
    try:
        ids = spdx_ids(expr)
    except ValueError as e:
        return [str(e)]
    bad = [f"{i} is a LicenseRef with no LICENSES/{i}.<ext> holding its text" for i in ids if i.startswith(("LicenseRef-", "DocumentRef-")) and not _license_file(root, i)]
    if not m:
        bad += [f"has no SPDX-License-Identifier line and no LICENSES/{i}.<ext> records which license it is" for i in ids if not _license_file(root, i)]
    ident = _identity(root).get("license")
    if m and ident and expr != ident:
        bad.append(f"names {expr}, but ultrastable.json identity.license is {ident}")
    return bad


def cff(root, text, row):
    d, bad = _mapping(text), []
    if d.get("cff-version") != "1.2.0":
        bad.append(f'cff-version is {d.get("cff-version")!r}, not "1.2.0"')
    bad += [f"{k} is missing" for k in ("message", "title") if not (isinstance(d.get(k), str) and d[k].strip())]
    a = d.get("authors")
    if not (isinstance(a, list) and a and all(isinstance(x, dict) and any(x.get(k) for k in ("name", "family-names", "given-names")) for x in a)):
        bad.append("authors is not a list of persons or entities")
    lic = d.get("license")
    for v in lic if isinstance(lic, list) else [lic] if lic is not None else []:
        if not isinstance(v, str) or v.startswith(("LicenseRef-", "DocumentRef-")) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9.+-]*", v):
            bad.append(f"license {v!r} is not an SPDX license list id; a LicenseRef goes in license-url")
    if "license-url" in d and not (isinstance(d["license-url"], str) and re.fullmatch(r"https?://\S+", d["license-url"])):
        bad.append("license-url is not a URL")
    return bad


def publiccode(root, text, row):
    d, bad = _mapping(text), []
    v = d.get("publiccodeYmlVersion")
    if not (isinstance(v, str) and re.fullmatch(r"0|0\.7(\.\d+)?", v)):
        bad.append(f'publiccodeYmlVersion is {v!r}; Ultrastable rule: use "0" (the reference parser warns on older versions)')
    bad += [f"{k} is missing" for k in ("name", "url") if not (isinstance(d.get(k), str) and d[k].strip())]
    if not (isinstance(d.get("platforms"), list) and d["platforms"]):
        bad.append("platforms is not a list")
    if d.get("developmentStatus") not in ("concept", "development", "beta", "stable", "obsolete"):
        bad.append(f"developmentStatus {d.get('developmentStatus')!r} is not concept, development, beta, stable or obsolete")
    if d.get("softwareType") not in ("standalone/mobile", "standalone/iot", "standalone/desktop", "standalone/web", "standalone/backend",
                                     "standalone/other", "addon", "library", "configurationFiles"):
        bad.append(f"softwareType {d.get('softwareType')!r} is not a publiccode.yml software type")
    if not ((d.get("legal") or {}).get("license") if isinstance(d.get("legal"), dict) else None):
        bad.append("legal.license is missing")
    mt = d.get("maintenance") if isinstance(d.get("maintenance"), dict) else {}
    if mt.get("type") not in ("internal", "contract", "community", "none"):
        bad.append(f"maintenance.type {mt.get('type')!r} is not internal, contract, community or none")
    need = "contacts" if mt.get("type") in ("internal", "community") else "contractors" if mt.get("type") == "contract" else None
    if need and not (isinstance(mt.get(need), list) and mt[need] and all(isinstance(x, dict) and x.get("name") for x in mt[need])):
        bad.append(f"maintenance.{need} (each with a name) is required when maintenance.type is {mt.get('type')}")
    loc = d.get("localisation") if isinstance(d.get("localisation"), dict) else {}
    if not isinstance(loc.get("localisationReady"), bool) or not (isinstance(loc.get("availableLanguages"), list) and loc["availableLanguages"]):
        bad.append("localisation.localisationReady (true or false) and localisation.availableLanguages are required")
    desc = d.get("description") if isinstance(d.get("description"), dict) and d["description"] else None
    if not desc:
        bad.append("description has no language")
    for lang, x in (desc or {}).items():
        x = x if isinstance(x, dict) else {}
        s, lo = x.get("shortDescription"), x.get("longDescription")
        if not (isinstance(s, str) and 0 < len(s) <= 150):
            bad.append(f"description.{lang}.shortDescription is missing or over 150 characters")
        if not (isinstance(lo, str) and 150 <= len(lo) <= 10000):
            bad.append(f"description.{lang}.longDescription is {len(lo) if isinstance(lo, str) else 'not'} characters; the spec needs 150 to 10000")
        if not (isinstance(x.get("features"), list) and x["features"]):
            bad.append(f"description.{lang}.features is not a list")
    return bad


def catalog_info(root, text, row):
    docs, bad = [x for x in yaml_docs(text) if x is not None], []
    if not docs:
        return ["holds no entity"]
    for n, e in enumerate(docs, 1):
        if not isinstance(e, dict):
            bad.append(f"document {n} is not a mapping")
            continue
        av, md = e.get("apiVersion"), e.get("metadata") if isinstance(e.get("metadata"), dict) else {}
        if not (isinstance(av, str) and re.fullmatch(r"(?:[a-z0-9-]+\.)*backstage\.io/v\d+(?:(?:alpha|beta)\d+)?", av)):
            bad.append(f"document {n}: apiVersion {av!r} is not backstage.io/<version>")
        if not (isinstance(e.get("kind"), str) and e["kind"]):
            bad.append(f"document {n}: kind is missing")
        nm = md.get("name")
        if not (isinstance(nm, str) and len(nm) <= 63 and re.fullmatch(r"[A-Za-z0-9]+(?:[-_.][A-Za-z0-9]+)*", nm)):
            bad.append(f"document {n}: metadata.name {nm!r} is not 1 to 63 letters and digits joined by - _ or .")
        if not isinstance(e.get("spec"), dict):
            bad.append(f"document {n}: spec is missing")
    return bad


def manifest(root, text, row):
    try:
        return _kit("surfaces").check_manifest(root)
    except ValueError as e:
        return [f"is not valid JSON ({e})"]
    except FileNotFoundError as e:
        raise Unmeasured(f"no schema to validate against ({e})") from None


EC = {"indent_style": {"tab", "space"}, "end_of_line": {"lf", "cr", "crlf"}, "charset": {"latin1", "utf-8", "utf-8-bom", "utf-16be", "utf-16le"},
      "trim_trailing_whitespace": {"true", "false"}, "insert_final_newline": {"true", "false"}, "root": {"true", "false"}}


def editorconfig(root, text, row):
    bad, section, rooted, star = [], None, False, False
    for n, raw in enumerate(text.lstrip("\ufeff").splitlines(), 1):
        ln = raw.strip()
        if not ln or ln[0] in "#;":
            continue
        if ln.startswith("["):
            if not ln.endswith("]"):
                bad.append(f"line {n}: a section header has no closing ]")
            section = ln[1:-1]
            star |= section == "*"
            continue
        if "=" not in ln:
            bad.append(f"line {n}: not a section, a comment or key = value")
            continue
        k, v = (x.strip().lower() for x in ln.split("=", 1))
        if k == "root" and section is None:
            rooted = v == "true"
        if v == "unset":
            continue
        ok = v in EC[k] if k in EC else v.isdigit() if k == "tab_width" else (v == "tab" or v.isdigit()) if k == "indent_size" else \
            bool(re.fullmatch(r"[a-z]{2}(-[a-z]{2})?", v)) if k == "spelling_language" else True  # unknown keys are allowed by the spec
        if not ok:
            bad.append(f"line {n}: {k} = {v} is not a value EditorConfig defines")
    if not rooted:
        bad.append("root = true is not in the preamble (Ultrastable rule: a repository's settings stop at its root)")
    if not star:
        bad.append("has no [*] section, so a file outside the named globs gets no settings")
    return bad


def dependabot(root, text, row):
    d, bad = _mapping(text), []
    if d.get("version") != 2:
        bad.append("version is not 2")
    u = d.get("updates")
    if not isinstance(u, list):
        return bad + ["updates is not a list"]
    for k, x in enumerate(u, 1):
        x = x if isinstance(x, dict) else {}
        if not x.get("package-ecosystem") or not (x.get("directory") or x.get("directories")):
            bad.append(f"update {k}: package-ecosystem and directory (or directories) are required")
        if not (isinstance(x.get("schedule"), dict) and x["schedule"].get("interval")):
            bad.append(f"update {k}: schedule.interval is required")
    return bad + [f"no entry for {e} at {at}" for e, at in _kit("deprot").missing(root)]


def _jsonc(s: str) -> str:
    """JSON with comments (the Dev Container spec's format) as plain JSON: // and /* */ outside strings and trailing commas removed."""
    out, i, n = [], 0, len(s)
    while i < n:
        if s[i] == '"':
            j = i + 1
            while j < n and s[j] != '"':
                j += 2 if s[j] == "\\" else 1
            out.append(s[i:j + 1])
            i = j + 1
        elif s.startswith("//", i):
            j = s.find("\n", i)
            i = n if j < 0 else j
        elif s.startswith("/*", i):
            j = s.find("*/", i + 2)
            if j < 0:
                raise ValueError("a /* comment is never closed")
            i = j + 2
        else:
            out.append(s[i])
            i += 1
    return re.sub(r",(\s*[}\]])", r"\1", "".join(out))


def devcontainer(root, text, row):
    try:
        d = json.loads(_jsonc(text))
    except ValueError as e:
        return [f"is not JSON with comments ({e})"]
    if not isinstance(d, dict):
        return ["is not a JSON object"]
    src = [k for k in ("image", "build", "dockerComposeFile") if k in d]
    if len(src) != 1:
        return [f"names {len(src)} of image, build and dockerComposeFile; the spec needs exactly one"]
    if src == ["image"] and not (isinstance(d["image"], str) and d["image"].strip()):
        return ["image is empty"]
    if src == ["build"] and not (isinstance(d["build"], dict) and d["build"].get("dockerfile")):
        return ["build has no dockerfile"]
    if src == ["dockerComposeFile"] and not d.get("service"):
        return ["dockerComposeFile needs a service"]
    return []


SEMVER = r"(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?"
KINDS = ("Added", "Changed", "Deprecated", "Removed", "Fixed", "Security")


def _precedence(v: str):
    m = re.fullmatch(SEMVER, v)
    pre = m.group(4)
    return (*map(int, m.group(1, 2, 3)), pre is None, [(0, int(p), "") if p.isdigit() else (1, 0, p) for p in (pre or "").split(".") if pre])


def changelog(root, text, row):
    heads = [(n, ln.rstrip()) for n, ln in enumerate(text.splitlines(), 1) if ln.startswith("## ")]
    bad, seen = [], []
    if not any(h == "## [Unreleased]" for _, h in heads):
        bad.append('has no "## [Unreleased]" heading')
    elif heads[0][1] != "## [Unreleased]":
        bad.append('"## [Unreleased]" is not the first release heading')
    bad += [f'line {n}: a second "## [Unreleased]"' for n, h in heads if h == "## [Unreleased]"][1:]
    for n, h in heads:
        if h == "## [Unreleased]":
            continue
        m = re.fullmatch(rf"## \[({SEMVER})\] - \d{{4}}-\d{{2}}-\d{{2}}(?: \[YANKED\])?", h)
        if not m:
            bad.append(f"line {n}: {h!r} is not `## [MAJOR.MINOR.PATCH] - YYYY-MM-DD`")
        elif m.group(1) in seen:
            bad.append(f"line {n}: version {m.group(1)} is listed twice")
        elif seen and _precedence(m.group(1)) >= _precedence(seen[-1]):
            bad.append(f"line {n}: {m.group(1)} is not older than {seen[-1]}; releases are listed newest first")
        if m:
            seen.append(m.group(1))
    bad += [f"line {n}: {ln.strip()!r} is not one of the sections {', '.join(KINDS)}" for n, ln in enumerate(text.splitlines(), 1)
            if ln.startswith("### ") and ln[4:].strip() not in KINDS]
    return bad


def readme(root, text, row):
    return _h1(text)


CC_TITLE = re.compile(r"`(?:feat|fix|docs|style|refactor|perf|test|build|ci|chore|revert)(?:\([\w./-]+\))?!?: \S[^`]*`")


def contributing(root, text, row):
    """A text check: the file links Conventional Commits 1.0.0 or shows a `type(scope): subject` commit title. The commit history itself is read
    by stdkit.conventional_share; naming the convention in a sentence without the link or an example does not pass."""
    named = re.search(r"conventionalcommits\.org/en/v1\.0\.0", text) or CC_TITLE.search(text)
    return _h1(text) + ([] if named else ["does not link Conventional Commits 1.0.0 (https://www.conventionalcommits.org/en/v1.0.0/) "
                                          "or show a `type(scope): subject` commit title"])


def security(root, text, row):
    route = re.search(r"mailto:|[\w.+-]+@[\w-]+\.[\w.-]+|https?://\S+|security/advisories|report a vulnerability", text, re.I)
    return _h1(text) + ([] if route else ["names no way to report a vulnerability (an address, a link or GitHub private reporting)"])


VALIDATORS = {"agents_md": agents_md, "llms_txt": llms_txt, "reuse_toml": reuse_toml, "license": license_, "cff": cff, "publiccode": publiccode,
              "catalog_info": catalog_info, "manifest": manifest, "editorconfig": editorconfig, "dependabot": dependabot,
              "devcontainer": devcontainer, "changelog": changelog, "readme": readme, "contributing": contributing, "security": security}


# --- the reading ---
def _row(root: Path, f: dict, unmeasured: dict) -> dict:
    r = {k: f.get(k) for k in ("path", "validator", "standard", "source")}
    p = root / f["path"]
    if f["path"] in unmeasured:
        return {**r, "state": "unmeasured", "ok": False, "why": unmeasured[f["path"]]}
    if not p.is_file():
        return {**r, "state": "fail", "ok": False, "why": "missing"}
    try:
        text = p.read_bytes().decode("utf-8")
    except UnicodeDecodeError:
        return {**r, "state": "fail", "ok": False, "why": "is not UTF-8"}
    if not text.strip():
        return {**r, "state": "fail", "ok": False, "why": "is empty"}
    try:
        bad = VALIDATORS[f["validator"]](root, text, f)
    except Unmeasured as e:
        return {**r, "state": "unmeasured", "ok": False, "why": str(e)}
    except YamlError as e:
        bad = [str(e) if str(e).startswith("is not one") else f"is not valid YAML ({e})"]
    except Exception as e:  # noqa: BLE001  a checker that fails to read a file has not measured it; that is never a pass
        return {**r, "state": "unmeasured", "ok": False, "why": f"the checker could not read it ({type(e).__name__}: {e})"}
    return {**r, "state": "fail" if bad else "ok", "ok": not bad, "why": "; ".join(bad)}


def _render_hint(root: Path) -> str:
    """The render command for the repository being read: the kit's surfaces.py sits at a different path in a seeded system, a tenant and the core."""
    for rel in ("scripts/surfaces.py", "vendor/ultrastable/tools/surfaces.py", "seed/scripts/surfaces.py"):
        if (root / rel).is_file():
            return f"python3 {rel} --render"
    return "the kit's surfaces.py --render: scripts/surfaces.py in a seeded system, vendor/ultrastable/tools/surfaces.py in a tenant"


def _unrendered(rows: list, only, why: str) -> list:
    """The render could not run. A whole reading gets one unmeasured row; a reading of one file the renderer writes is unmeasured, never ok."""
    if not only:
        return [{"path": "(rendered surfaces)", "validator": "render", "standard": "rendered from ultrastable.json",
                 "source": "scripts/surfaces.py", "state": "unmeasured", "ok": False, "why": why}]
    mod = sys.modules.get("surfaces")
    made = set(mod.RENDERED) | {"llms.txt"} if mod is not None and hasattr(mod, "RENDERED") else None  # unknown renderer: assume it writes the file
    if made is not None and only not in made and not only.startswith("LICENSES/"):
        return []
    r = next((x for x in rows if x["path"] == only), None)
    if r is None:
        return [{"path": only, "validator": "render", "standard": "rendered from ultrastable.json", "source": "scripts/surfaces.py",
                 "state": "unmeasured", "ok": False, "why": why}]
    if r["ok"]:
        r.update(state="unmeasured", ok=False, why=why)
    else:
        r["why"] = "; ".join(x for x in (r["why"], "its render cannot be compared: " + why) if x)
    return []


def _rendered(root: Path, rows: list, unmeasured: dict, only=None) -> list:
    """Every file scripts/surfaces.py renders from ultrastable.json must equal its render: a hand-typed copy drifts."""
    extra, by = [], {r["path"]: r for r in rows}
    try:
        s = _kit("surfaces")
        if s.check_manifest(root):
            raise ValueError("ultrastable.json is not valid, so its surfaces cannot be rendered")
        want = s.surfaces(root)
    except Exception as e:  # noqa: BLE001  the manifest row names the defect; the render is unmeasured until it is fixed
        return _unrendered(rows, only, f"cannot render: {e}")
    for rel, text in sorted(want.items()):
        if only and rel != only:
            continue
        p, r = root / rel, by.get(rel)
        if not isinstance(text, str):
            same, why = None, "nothing in the repository to render it from"
        elif rel in unmeasured:
            same, why = None, unmeasured[rel]
        else:
            same = p.is_file() and p.read_bytes() == text.encode("utf-8")
            why = "missing" if not p.is_file() else f"differs from what ultrastable.json renders ({_render_hint(root)})"
        if r is None:
            extra.append({"path": rel, "validator": "render", "standard": "rendered from ultrastable.json", "source": "scripts/surfaces.py",
                          "state": "ok" if same else "unmeasured" if same is None else "fail", "ok": bool(same), "why": "" if same else why})
        elif same is False and r["why"] != "missing":
            r.update(state="fail", ok=False, why="; ".join(x for x in (r["why"], why) if x))
    return extra


def read(root, unmeasured=None, only=None) -> list:
    root, unmeasured = Path(root), unmeasured or {}
    rows = [_row(root, f, unmeasured) for f in rules()["files"] if not only or f["path"] == only]
    return rows + _rendered(root, rows, unmeasured, only)


def _get(url: str, raw=False) -> bytes:
    h = {"User-Agent": "ultrastable-repoconform", "X-GitHub-Api-Version": "2022-11-28",
         "Accept": "application/vnd.github.raw" if raw else "application/vnd.github+json"}
    tok = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if tok:
        h["Authorization"] = "Bearer " + tok
    with urllib.request.urlopen(urllib.request.Request(url, headers=h), timeout=30) as r:  # nosec: fixed https host
        return r.read()


def _why(e: Exception) -> str:
    return f"HTTP {e.code}" if hasattr(e, "code") else f"{type(e).__name__}: {e}"


def remote(repo: str, get=None) -> dict:
    """OWNER/REPO's default branch, fetched into a temporary directory and read. An unreadable repository or file is unmeasured, never ok."""
    get, q = get or _get, urllib.parse.quote
    try:
        ref = json.loads(get(f"{API}/repos/{repo}"))["default_branch"]
        tree = json.loads(get(f"{API}/repos/{repo}/git/trees/{q(ref, safe='')}?recursive=1"))
    except (*READ_ERRORS, KeyError, TypeError) as e:
        return {"repo": repo, "state": "unmeasured", "ok": False, "why": f"cannot read the repository ({_why(e)})", "files": []}
    blobs = [t["path"] for t in tree.get("tree", []) if t.get("type") == "blob" and ".." not in Path(t["path"]).parts and not t["path"].startswith("/")]
    want = {f["path"] for f in rules()["files"]} | FETCH
    ex = {d for f in rules()["files"] for d in (f.get("options") or {}).get("chain_exempt_dirs", [])}
    fetch = [p for p in blobs if p in want or p.startswith("LICENSES/") or (not SKIP & set(p.split("/")) and (
        (p.endswith("/package.json") and p.count("/") <= 2) or (p.endswith("/AGENTS.md") and Path(p).parent.name not in ex)))]
    unmeasured = {".github/dependabot.yml": "the repository tree is truncated, so its manifests cannot all be listed"} if tree.get("truncated") else {}

    def one(p):
        try:
            return p, get(f"{API}/repos/{repo}/contents/{q(p)}?ref={q(ref, safe='')}", raw=True), None
        except READ_ERRORS as e:
            return p, None, _why(e)

    with tempfile.TemporaryDirectory() as d:
        root, have = Path(d), set()

        def pull(paths):
            with ThreadPoolExecutor(8) as pool:
                for p, body, err in pool.map(one, [p for p in paths if p not in have]):
                    have.add(p)
                    if err:
                        unmeasured[p] = f"cannot read {p} ({err})"
                    else:
                        (root / p).write_bytes(body)

        for p in blobs:  # every path exists, so path checks read the real tree; only fetched files carry their content
            (root / p).parent.mkdir(parents=True, exist_ok=True)
            (root / p).touch()
        pull(fetch)
        try:  # every path the renderer writes is compared with its render, so each one the tree holds is fetched, never left a placeholder
            pull(sorted(set(_kit("surfaces").surfaces(root)) & set(blobs)))
        except Exception:  # noqa: BLE001  an unrenderable manifest is reported by read(): its render row is unmeasured
            pass
        rows = read(root, unmeasured)
    st = "fail" if any(r["state"] == "fail" for r in rows) else "unmeasured" if any(r["state"] == "unmeasured" for r in rows) else "ok"
    return {"repo": repo, "ref": ref, "state": st, "ok": st == "ok", "why": "", "files": rows}


def fleet(path, get=None) -> list:
    out = []
    for repo, row in sorted(json.loads(Path(path).read_text(encoding="utf-8"))["repos"].items()):
        if row.get("state") == "retired":
            out.append({"repo": repo, "state": "skipped", "ok": True, "why": "retired in the fleet map; nothing runs from it", "files": []})
            continue
        try:
            out.append(remote(repo, get))
        except Exception as e:  # noqa: BLE001  one repository the checker failed on is unmeasured; the rest of the fleet is still read
            out.append({"repo": repo, "state": "unmeasured", "ok": False, "why": f"the checker could not read it ({type(e).__name__}: {e})", "files": []})
    return out


def summary(res: list) -> str:
    """One line that changes with the fleet's state: how many repositories conform, then each one that does not with its file score and the
    files that fail. failure_audit hashes the last line of a detector's output and keeps its tail as evidence, so this line is printed last."""
    scored = [r for r in res if r["state"] != "skipped"]

    def one(r):
        if not r["files"]:
            return f"{r['repo']} {r['state']}: {r['why']}"
        failing = [f["path"] for f in r["files"] if not f["ok"]]
        return f"{r['repo']} {sum(f['ok'] for f in r['files'])}/{len(r['files'])} {r['state']} ({', '.join(failing)})"
    bad = [one(r) for r in scored if not r["ok"]]
    return f"repoconform: fleet {sum(r['ok'] for r in scored)}/{len(scored)} repositories conform" + ("; " + "; ".join(bad) if bad else "")


def _print(rows: list, prefix="") -> None:
    for r in rows:
        if not r["ok"]:
            print(f"{prefix}repoconform: {r['path']} {r['state']}: {r['why']} ({r['validator']}, {r['standard']})")
    um = sum(r["state"] == "unmeasured" for r in rows)
    print(f"{prefix}repoconform: {sum(r['ok'] for r in rows)}/{len(rows)} files conform" + (f", {um} unmeasured" if um else ""))


def main(argv) -> int:
    a = list(argv[1:])
    val = lambda flag: a[a.index(flag) + 1] if flag in a and a.index(flag) + 1 < len(a) else None  # noqa: E731
    as_json = "--json" in a
    if "--fleet" in a or "--remote" in a:
        res = fleet(val("--fleet")) if "--fleet" in a else [remote(val("--remote"))]
        read_any = any(r["state"] != "skipped" for r in res)  # a reading of no repository is unmeasured, never a pass
        if as_json:
            print(json.dumps({"ok": read_any and all(r["ok"] for r in res), "repos": res, "summary": summary(res)}, indent=2))
        else:
            for r in sorted(res, key=lambda r: r["state"] != "skipped"):  # skipped rows first, so the summary below is the last line
                print(f"repoconform: {r['repo']} {r['state']}" + (f": {r['why']}" if r["why"] else ""))
                if r["files"]:
                    _print(r["files"], "  ")
            print(summary(res) + ("" if read_any else "; no repository was read, so the fleet is unmeasured"))
        return 0 if read_any and all(r["ok"] for r in res) else 1
    used = {val("--only")}
    root = next((x for x in a if not x.startswith("--") and x not in used), str(KIT))
    rows = read(root, only=val("--only"))
    if as_json:
        print(json.dumps({"ok": all(r["ok"] for r in rows), "files": rows}, indent=2))
    else:
        _print(rows)
    return 0 if rows and all(r["ok"] for r in rows) else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
