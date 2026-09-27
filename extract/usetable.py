"""Reads one cell of the §911.02 Use Table from the saved text, by position, with no model involved.

The model reads the use table like any other text; this is the guard's cross-check. The saved table
is one cell per line ("P | ", " | " for an empty cell), so a cell is found by counting: the column
headers come after 'See § 911.04.x' (25 columns, the Downtown column's header is blank), and each use
row is its label cell followed by one cell per column. A reading far down the row (the Hillside
column is the 17th) is easy for a model to miscount and impossible for the quote guard to catch.
"""

from __future__ import annotations

import re

from .source import read_code, section_text

C911 = "data/code/ch911.txt"
ROW_LABEL = {
    "use_detached": "Single-Unit Detached Residential means",
    "use_row": "Single-Unit Attached Residential means",
    "use_two": "Two-Unit Residential means",
    "use_three": "Three-Unit Residential means",
}


def _table() -> str:
    return section_text("911.02", C911)


def columns(text: str | None = None) -> list[str]:
    """The table's district columns, in order: R1D … GT, DT, then the riverfront RIV-RM … RIV-IMU."""
    t = text or _table()
    i = t.index("See § 911.04.x")
    j = t.index("RESIDENTIAL USES", i)
    lines = [ln.strip() for ln in t[i:j].split("\n")[1:]]
    labels = [re.sub(r"\s*\|\s*$", "", ln).strip() for ln in lines]
    # The first "|" line closes the Standards header; the last closes the header row.
    while labels and labels[0] == "":
        labels.pop(0)
    while labels and labels[-1] == "":
        labels.pop()
    out: list[str] = []
    riv = False
    for lb in labels:
        if lb == "":
            out.append("DT")  # the Downtown group has one column and no sub-header
            riv = True
        else:
            out.append(f"RIV-{lb}" if riv else lb)
    return out


def column_for(district: str) -> str:
    """'RM-M' → 'RM' (a residential district's use column is its Use Subdistrict); 'H' → 'H'."""
    d = district.strip().upper()
    m = re.match(r"^(R1D|R1A|R2|R3|RM)-[A-Z]+$", d)
    return m.group(1) if m else d


def cell(field: str, district: str, text: str | None = None) -> str | None:
    """The raw cell ('' for an empty one) in the district's column of the field's use row, or None when the
    row or column can't be found."""
    t = text or _table()
    cols = columns(t)
    col = column_for(district)
    if field not in ROW_LABEL or col not in cols:
        return None
    k = t.find(ROW_LABEL[field])
    if k < 0:
        return None
    # The row: its label line, then one line per cell. Stop at the next row's label ("… means").
    lines = t[k:].split("\n")
    cells: list[str] = []
    for ln in lines[1:]:
        if " means " in ln or len(cells) > len(cols):
            break
        cells.append(re.sub(r"\s*\|\s*$", "", ln).strip())
    if len(cells) < len(cols):
        return None
    return cells[cols.index(col)]


def permission(raw: str) -> str:
    """The class of permission a cell states: 'P' by right, 'N' not permitted (an empty cell, §911.01.F),
    or 'approval' (S, A, C, or a split cell such as 'P/S', where the more restrictive code decides)."""
    r = raw.strip().upper()
    if r == "":
        return "N"
    if r == "P":
        return "P"
    return "approval"


def mismatch(field: str, district: str, value: str) -> str | None:
    """None when the model's reading agrees with the cell's class; else why it doesn't."""
    raw = cell(field, district)
    if raw is None:
        return None  # can't locate: the quote guard still applies, and the caller notes it
    want = permission(raw)
    got = "P" if value == "P" else "N" if value == "N" else "approval"
    if want == got:
        return None
    return f"use table: the {column_for(district)} column of the {ROW_LABEL[field].removesuffix(' means')} row reads {raw or '(empty)'!r}, not {value}"
