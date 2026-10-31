"""The licence register (datasets.yaml): load, validate, and refuse sources
that are not cleared. A strict YAML subset is parsed without a YAML library
so the check runs anywhere (also in the engine's Node test suite)."""

from __future__ import annotations

import re
from pathlib import Path

HERE = Path(__file__).resolve().parent.parent
REGISTER_PATH = HERE / "datasets.yaml"

REQUIRED = ["id", "name", "kind", "source", "licence", "commercial", "include", "tasks", "reason"]
KINDS = {"dataset", "corpus", "model", "labeler", "never"}
TASKS = {"redaction", "injection", "claim_support", "clause_type", "relevance", "routing", "in_force", "general"}
NC_RE = re.compile(r"\bNC\b|non-?commercial", re.I)
UNKNOWN_RE = re.compile(r"\b(unknown|unclear)\b", re.I)


class NotCleared(ValueError):
    pass


def _value(raw: str):
    v = raw.strip()
    if v.startswith("[") and v.endswith("]"):
        inner = v[1:-1].strip()
        return [x.strip().strip("'\"") for x in inner.split(",") if x.strip()] if inner else []
    if len(v) >= 2 and v[0] == v[-1] and v[0] in "'\"":
        return v[1:-1]
    return v


def parse(text: str) -> list[dict]:
    """datasets.yaml → list of entries (strict subset: '- key: value' starts an entry)."""
    entries: list[dict] = []
    cur = None
    in_list = False
    for n, line in enumerate(text.splitlines(), 1):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        if line.rstrip() == "datasets:":
            in_list = True
            continue
        if not in_list:
            raise ValueError(f"line {n}: expected 'datasets:' first")
        m = re.match(r"^  - (\w+):\s?(.*)$", line)
        if m:
            cur = {m.group(1): _value(m.group(2))}
            entries.append(cur)
            continue
        m = re.match(r"^    (\w+):\s?(.*)$", line)
        if m and cur is not None:
            if m.group(1) in cur:
                raise ValueError(f"line {n}: {m.group(1)} given twice")
            cur[m.group(1)] = _value(m.group(2))
            continue
        raise ValueError(f"line {n}: not understood: {line.strip()[:60]}")
    return entries


def problems(entries: list[dict]) -> list[str]:
    out = []
    seen = set()
    for e in entries:
        who = e.get("id", "?")
        for k in REQUIRED:
            if k not in e or e[k] in ("", None):
                out.append(f"{who}: missing {k}")
        if who in seen:
            out.append(f"{who}: listed twice")
        seen.add(who)
        if e.get("kind") not in KINDS:
            out.append(f"{who}: kind must be one of {sorted(KINDS)}")
        if e.get("commercial") not in ("yes", "no", "unclear"):
            out.append(f"{who}: commercial must be yes, no or unclear")
        if e.get("include") not in ("yes", "no"):
            out.append(f"{who}: include must be yes or no")
        if not isinstance(e.get("tasks"), list) or any(t not in TASKS for t in e.get("tasks") or []):
            out.append(f"{who}: tasks must be a list of {sorted(TASKS)}")
        if e.get("include") == "yes":
            lic = str(e.get("licence", ""))
            if NC_RE.search(lic):
                out.append(f"{who}: a non-commercial licence can never be included")
            if e.get("kind") == "never":
                out.append(f"{who}: kind 'never' can never be included")
            if e.get("commercial") == "no":
                out.append(f"{who}: commercial use not allowed, cannot be included")
            # A collection with mixed licences is only included through its cleared subsets.
            if e.get("commercial") == "unclear" and "subsets" not in e:
                out.append(f"{who}: commercial use unclear — list cleared subsets or set include: no")
            if UNKNOWN_RE.search(lic) and "subsets" not in e:
                out.append(f"{who}: licence unknown or unclear, cannot be included")
    return out


class Register:
    def __init__(self, path: str | Path = REGISTER_PATH):
        self.path = Path(path)
        self.entries = parse(self.path.read_text(encoding="utf-8"))
        bad = problems(self.entries)
        if bad:
            raise ValueError("licence register has problems:\n  " + "\n  ".join(bad))
        self.by_id = {e["id"]: e for e in self.entries}

    def require(self, source: str) -> dict:
        """The entry for a source id ("lextreme/<subset>" for a subset), or NotCleared."""
        base, _, subset = str(source).partition("/")
        e = self.by_id.get(base)
        if e is None:
            raise NotCleared(f"source {source!r} is not in the licence register (datasets.yaml)")
        if e["include"] != "yes":
            raise NotCleared(f"source {source!r} is excluded: {e['reason']}")
        if "subsets" in e:
            if not subset or subset not in e["subsets"]:
                raise NotCleared(f"source {source!r}: only the cleared subsets of {base} may be used ({e['subsets'] or 'none yet'})")
        return e

    def included(self) -> list[dict]:
        return [e for e in self.entries if e["include"] == "yes"]
