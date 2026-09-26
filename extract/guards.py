"""Guards, enforced in code after the model returns, whatever the provider.

1. Verbatim quote: the quote must appear word for word (whitespace-normalized) in the source file
   AND inside the cited section span (same logic as engine/src/source.ts). Else: rejected.
2. Schema, units and plausible ranges: setbacks 0-100 ft, lot area 0-20,000 sf, height 0-200 ft,
   stories 1-20, parking 0-10 spaces per unit, use in {P, S, SPR, N}. A table's rows must each
   appear as consecutive cells in the cited section. Else: rejected.
3. Trust: every extracted rule is `unreviewed` (pencil), reviewer null. A rule that is ambiguous,
   conditional or cross-referenced must carry a question_for_city; if the model gave none, the
   guard writes one and the check log says so.

Soft check (logged, never a rejection): does the value's number appear in the quote?
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .schema import FIELD_UNIT, UNREVIEWED, ProposedRule
from .sections import DAGGER_FIELDS
from .source import check_quote, header, locate_section, normalize_ws, read_code, source_file_for

SETBACK_FIELDS = {
    "front_setback",
    "rear_setback",
    "side_setback_interior",
    "side_setback_exterior",
    "party_wall_side",
    "contextual_side",
    "contextual_rear",
}
NULLABLE_NUMBER = {"contextual_side", "contextual_rear"}
RANGES: dict[str, tuple[float, float]] = {
    **{f: (0, 100) for f in SETBACK_FIELDS},
    "min_lot_area": (0, 20000),
    "max_height_ft": (0, 200),
    "max_stories": (1, 20),
    **{f"parking_{t}": (0, 10) for t in ("detached", "two", "row", "three")},
}
USE_CODES = {"P", "S", "SPR", "N"}
_XREF = re.compile(r"\b(?:Section|Sections|Chapter|§)\s*\d{3}", re.I)


@dataclass
class Verdict:
    rule: dict | None
    reason: str | None
    notes: list[str] = field(default_factory=list)
    question_source: str | None = None  # "model" | "guard" | None


def normalize_section(s: str) -> str:
    s = s.strip()
    s = re.sub(r"^(?:§+|Section|Sec\.)\s*", "", s, flags=re.I)
    s = s.replace(" ", "")
    s = re.sub(r"\.\(", "(", s)  # "903.03.C.2.(c)" -> "903.03.C.2(c)"
    return s.rstrip(".")


def _num(v: float | None) -> float | int | None:
    if v is None:
        return None
    return int(v) if float(v).is_integer() else float(v)


_WORDS = "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen twenty".split()


def number_in_text(v: float | int, text: str) -> bool:
    t = normalize_ws(text)
    cands = {str(v), f"{v:,}"}
    if isinstance(v, float) and v.is_integer():
        cands |= {str(int(v)), f"{int(v):,}"}
    for c in cands:
        if re.search(rf"(?<![\d,.]){re.escape(c)}(?![\d,])", t):
            return True
    if float(v).is_integer() and 0 <= int(v) < len(_WORDS):
        if re.search(rf"\b{_WORDS[int(v)]}\b", t, re.I):
            return True
    return False


def _cells(text: str) -> list[str]:
    return [c.strip() for c in normalize_ws(text).split("|")]


def _lead_int(cell: str) -> int | None:
    m = re.match(r"^(\d+)", cell)
    return int(m.group(1)) if m else None


def table_rows_in_text(rows: list[tuple[int, int, int]], text: str) -> list[tuple[int, int, int]]:
    """Rows whose three numbers do NOT appear as three consecutive table cells in `text`."""
    nums = [_lead_int(c) for c in _cells(text)]
    have = {(nums[i], nums[i + 1], nums[i + 2]) for i in range(len(nums) - 2) if None not in (nums[i], nums[i + 1], nums[i + 2])}
    return [r for r in rows if r not in have]


def guard(p: ProposedRule, *, district: str, allowed_fields: list[str], model: str, prompt_sha: str) -> Verdict:
    notes: list[str] = []
    fld = p.field
    if fld not in allowed_fields:
        return Verdict(None, f"field {fld} was not requested from these sections")

    # ── 1. Quote, verbatim, inside the cited section ─────────────────────────
    section = normalize_section(p.section)
    try:
        sf = source_file_for(section)
        text = read_code(sf)
    except (ValueError, FileNotFoundError):
        return Verdict(None, f"cited section {p.section!r} does not name a saved code file")
    qc = check_quote(text, section, p.quote)
    if not qc.ok:
        return Verdict(None, f"quote guard: {qc.reason}")

    # ── 2. Schema, units, ranges ─────────────────────────────────────────────
    want_unit = FIELD_UNIT[fld]
    if p.unit != want_unit:
        return Verdict(None, f"unit {p.unit!r} is wrong for {fld} (expected {want_unit!r})")
    value: object
    if want_unit in ("ft", "sf", "stories", "spaces_per_unit"):
        v = _num(p.value_number)
        if v is None:
            if fld not in NULLABLE_NUMBER:
                return Verdict(None, f"{fld} has no numeric value")
        else:
            lo, hi = RANGES[fld]
            if not (lo <= v <= hi):
                return Verdict(None, f"{fld} = {v} {want_unit} is outside the plausible range {lo:g}-{hi:g}")
            if fld == "max_stories" and not float(v).is_integer():
                return Verdict(None, f"max_stories = {v} is not a whole number")
        value = v
        if p.value_use is not None or p.value_table:
            notes.append("ignored a value_use/value_table the model also returned")
    elif want_unit == "use":
        if p.value_use not in USE_CODES:
            return Verdict(None, f"{fld} use permission {p.value_use!r} is not one of P, S, SPR, N")
        value = p.value_use
    elif want_unit == "table":
        rows = p.value_table or []
        if not rows:
            return Verdict(None, f"{fld} has no table rows")
        for r in rows:
            if not (1 <= r.max_width <= 100 and 0 <= r.interior <= 100 and 0 <= r.streetside <= 100):
                return Verdict(None, f"{fld} row {r.model_dump()} is outside plausible ranges")
        if len({r.max_width for r in rows}) != len(rows):
            return Verdict(None, f"{fld} repeats a lot width")
        span = locate_section(text, section)
        missing = table_rows_in_text([(r.max_width, r.interior, r.streetside) for r in rows], text[span.start : span.end])
        if missing:
            return Verdict(None, f"{fld}: {len(missing)} row(s) not found as table cells in §{section}: {missing[:3]}")
        value = [{"max_width": r.max_width, "interior": r.interior, "streetside": r.streetside} for r in rows]
    else:  # flag
        if p.value_number is not None or p.value_use is not None or p.value_table:
            notes.append(f"flag field: dropped a value the model returned ({p.value_number or p.value_use or 'table'})")
        value = None

    applies = list(dict.fromkeys(p.applies_to))
    if not applies:
        return Verdict(None, f"{fld} has an empty applies_to")
    if "*" in applies and len(applies) > 1:
        notes.append(f"applies_to {applies} collapsed to ['*']")
        applies = ["*"]

    if isinstance(value, (int, float)) and not number_in_text(value, p.quote):
        notes.append(f"value {value} does not appear in the quote (check by eye)")

    # ── 3. Trust and questions ───────────────────────────────────────────────
    condition = (p.condition or "").strip() or None
    question = (p.question_for_city or "").strip() or None
    xref = bool(_XREF.search(p.quote))
    needs_q = p.ambiguous or condition is not None or xref
    qsrc = "model" if question else None
    if needs_q and not question:
        why = "the model marked it ambiguous" if p.ambiguous else ("it is conditional" if condition else "it cross-references another section")
        question = f"How does the City apply §{section} to {fld.replace('_', ' ')} here? ({why}{': ' + condition if condition else ''})"
        qsrc = "guard"
        notes.append("question_for_city written by the guard (the model gave none)")

    h = header(sf)
    rule = {
        "id": f"{district.lower()}.x.{fld}",
        "district": district,
        "field": fld,
        "value": value,
        "unit": want_unit,
        "applies_to": applies,
        "condition": condition,
        "section": section,
        "quote": p.quote,
        "source_file": sf,
        "source_url": h.source_url,
        "retrieved": h.retrieved,
        "origin": "extracted",
        "dagger": fld in DAGGER_FIELDS,
        "question_for_city": question,
        "verification": dict(UNREVIEWED),
        "model": model,
        "prompt_sha": prompt_sha,
    }
    return Verdict(rule, None, notes, qsrc)
