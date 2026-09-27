"""The policy agent's tools. None of them uses a model:
  catalogue()  the stored rules a question can change: signed districts, numeric dimensional fields
  section()    the saved code text of a section, with the file's sha256 (the find step)
  count()      the citywide count for one override, by scripts/policy-count.ts (the same code path as S1–S3)
  sha256()     a file's hash, for the sources on each step
"""
from __future__ import annotations

import hashlib
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

from extract.guards import RANGES
from extract.schema import FIELD_UNIT
from extract.source import REPO, read_code, section_text, source_file_for

TYPES = ("two", "three")
COUNT_SCRIPT = "scripts/policy-count.ts"


def sha256(rel: str) -> str:
    return hashlib.sha256((REPO / rel).read_bytes()).hexdigest()


def rule_files() -> list[str]:
    """The same list as RULE_FILES in scripts/build-summary.ts."""
    base = sorted(f"data/rules/base/{p.name}" for p in (REPO / "data/rules/base").glob("*.json"))
    ext = sorted(f"data/rules/extracted/{p.name}" for p in (REPO / "data/rules/extracted").glob("*.json") if p.name != "eval.json")
    return base + ext


def stored_rules() -> list[dict]:
    out = []
    for f in rule_files():
        d = json.loads((REPO / f).read_text())
        for r in d if isinstance(d, list) else d.get("rules", []):
            out.append({**r, "_file": f})
    return out


@dataclass
class Entry:
    district: str
    field: str
    value: float
    unit: str
    section: str
    source_file: str
    quote: str
    applies_to: list[str]
    rule_ids: list[str]
    files: list[str]

    def line(self) -> str:
        who = "all building types" if "*" in self.applies_to else ", ".join(self.applies_to)
        return f"{self.district} · {self.field} = {self.value:g} {self.unit} (§{self.section}; applies to {who}) · quote: {self.quote}"


def catalogue(districts: list[str]) -> list[Entry]:
    """Numeric dimensional rules in the districts whose rules are checked: what a value override can change."""
    by: dict[tuple[str, str], Entry] = {}
    for r in stored_rules():
        f = r.get("field")
        if r.get("district") not in districts or f not in RANGES or FIELD_UNIT.get(f) not in ("ft", "sf", "stories") or not isinstance(r.get("value"), (int, float)):
            continue
        k = (r["district"], f)
        if k in by:
            by[k].rule_ids.append(r["id"]); by[k].files.append(r["_file"])
            continue
        by[k] = Entry(r["district"], f, float(r["value"]), r.get("unit") or FIELD_UNIT[f], r.get("section") or "", r.get("source_file") or "", r.get("quote") or "", list(r.get("applies_to") or ["*"]), [r["id"]], [r["_file"]])
    return sorted(by.values(), key=lambda e: (e.district, e.field))


def uses(district: str) -> dict[str, str]:
    """{building type: P/S/SPR/N} from the stored use rules of a district."""
    return {r["field"][4:]: r["value"] for r in stored_rules() if r.get("district") == district and str(r.get("field", "")).startswith("use_")}


def section(sec: str) -> dict:
    f = source_file_for(sec)
    return {"section": sec, "file": f, "text": section_text(sec, f), "sha256": sha256(f), "full": read_code(f)}


def count(override: dict, *, runner=subprocess.run) -> dict:
    """{districts, matched_rules, by_type} for one override, from the scenario builder (Node, no model)."""
    p = runner(["npx", "--no-install", "tsx", COUNT_SCRIPT], input=json.dumps(override), capture_output=True, text=True, cwd=REPO, timeout=300)
    if p.returncode:
        raise RuntimeError(f"{COUNT_SCRIPT} failed: {p.stderr.strip()[-400:]}")
    return json.loads(p.stdout.strip().splitlines()[-1])


def existing_scenarios() -> list[dict]:
    try:
        return json.loads((REPO / "data/city/scenarios.json").read_text())["scenarios"]
    except (OSError, ValueError, KeyError):
        return []


REPO_PATH: Path = REPO
