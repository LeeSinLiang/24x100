"""The agent's rule check for extracted districts, written for a person to sign off on (as for the 20-rule check).

For every extracted rule of the named districts it records, with no model involved:
1. the quote is verbatim inside its cited section of the saved code text (the extraction guard, re-run);
2. the value agrees with the table read by position: a §903.03 site development table (the row for the
   field, then the sub-row naming the district's use subdistrict) or the §911.02 Use Table (the district's
   column of the use row);
3. anything neither reader covers is listed as "read by eye".

    uv run python -m extract rulecheck --district R2-L --district R1D-L … [--out docs/reviews/rule-check-coverage.md]

It never signs anything: signing is a person's act in the app, or a sign-off on this document.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from .sections import resolve_district
from .source import REPO, check_quote, read_code, section_text
from .usetable import cell as use_cell
from .usetable import column_for, permission

C903 = "data/code/ch903.txt"
ROW = {
    "min_lot_area": "Minimum Lot Size",
    "front_setback": "Minimum Front Setback",
    "rear_setback": "Minimum Rear Setback",
    "side_setback_exterior": "Minimum Exterior Sideyard Setback",
    "side_setback_interior": "Minimum Interior Sideyard Setback",
    "max_height_ft": "Maximum Height",
    "max_stories": "Maximum Height",
}


def _cells(text: str) -> list[str]:
    return [c.strip() for c in text.split("|")]


def table_value(field: str, district: str) -> str | None:
    """The raw cell the §903.03 site development table gives this field for the district's use subdistrict."""
    d = resolve_district(district)
    if not d.density_section or field not in ROW:
        return None
    t = section_text(f"{d.density_section}.2", C903)
    cells = _cells(t)
    labels = set(ROW.values())
    try:
        i = next(k for k, c in enumerate(cells) if c == ROW[field])
    except StopIteration:
        return None
    # A value straight after the label applies to every use subdistrict; else the sub-rows name them.
    j = i + 1
    while j < len(cells) and cells[j] == "":
        j += 1
    if j < len(cells) and re.match(r"^[\d,.]+\s*(s\.f\.|ft)", cells[j]):
        return cells[j]
    while j + 1 < len(cells) and cells[j] not in labels:
        names = re.findall(r"R1D|R1A|R2|R3|RM", cells[j])
        if names and d.use in names:
            return cells[j + 1]
        j += 1
    return None


def _num(raw: str, field: str) -> float | None:
    if field == "max_stories":
        m = re.search(r"(\d+)\s+stories", raw)
    else:
        m = re.search(r"([\d,]+(?:\.\d+)?)", raw)
    return float(m.group(1).replace(",", "")) if m else None


def check_rule(r: dict) -> dict:
    q = check_quote(read_code(r["source_file"]), r["section"], r["quote"])
    out = {"id": r["id"], "field": r["field"], "value": r["value"], "section": r["section"], "quote_ok": q.ok, "quote_reason": q.reason, "reader": None, "read": None, "agree": None}
    f = r["field"]
    if f.startswith("use_") and str(r["section"]).startswith("911.02"):
        raw = use_cell(f, r["district"])
        if raw is not None:
            got = "P" if r["value"] == "P" else "N" if r["value"] == "N" else "approval"
            out.update(reader=f"§911.02, the {column_for(r['district'])} column", read=raw or "(empty)", agree=permission(raw) == got)
    elif f in ROW:
        raw = table_value(f, r["district"])
        if raw is not None:
            out.update(reader=f"§{resolve_district(r['district']).density_section}.2, {ROW[f]}", read=raw, agree=_num(raw, f) == float(r["value"]))
    return out


def run(districts: list[str]) -> tuple[list[dict], str]:
    rows: list[dict] = []
    md = [
        "# Rule check: the coverage districts (agent's check, for a person to sign off on)",
        "",
        "Written by `uv run python -m extract rulecheck`. For each rule a model proposed, code checked, with no model:",
        "the quote is word for word inside its cited section of the saved code text, and the value agrees with the",
        "table read by position (the §903.03 site development table's row and use-subdistrict sub-row, or the",
        "§911.02 Use Table's column). A rule neither reader covers is marked **read by eye**. Nothing here is signed:",
        "signing is a person's act. Until then every rule below is pencil and colours no lot.",
        "",
    ]
    for dist in districts:
        path = REPO / "data" / "rules" / "extracted" / f"{dist.lower()}.json"
        if not path.exists():
            md += [f"## {dist}", "", "_Not extracted (no file)._", ""]
            continue
        doc = json.loads(path.read_text(encoding="utf-8"))
        meta = doc["meta"]
        res = [check_rule(r) for r in doc["rules"]]
        rows += res
        bad = [x for x in res if not x["quote_ok"] or x["agree"] is False]
        eye = [x for x in res if x["agree"] is None]
        md += [
            f"## {dist}",
            "",
            f"{len(res)} rules from `{meta['model']}` ({meta['run_at']}); {len(doc.get('rejected', []))} rejected by the guards. "
            + (f"**{len(bad)} disagree.** " if bad else "All quotes verbatim; every positional reading agrees. ")
            + (f"{len(eye)} read by eye." if eye else ""),
            "",
            "| Rule | Value | Section | Positional reading | Agrees |",
            "|---|---|---|---|---|",
        ]
        for x in res:
            agree = "yes" if x["agree"] else "**NO**" if x["agree"] is False else "read by eye"
            if not x["quote_ok"]:
                agree = f"**quote: {x['quote_reason']}**"
            md.append(f"| `{x['id']}` | {x['value']} | §{x['section']} | {x['reader'] + ': ' + repr(x['read']) if x['reader'] else '—'} | {agree} |")
        md.append("")
    return rows, "\n".join(md) + "\n"
