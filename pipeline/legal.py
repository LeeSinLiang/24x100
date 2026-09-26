"""Parsers for County records: LEGAL1 deed text, PIN lot numbers, display addresses.

Rule: never infer a number the record does not state. A missing plan-lot stays null.
"""
from __future__ import annotations

import re
from typing import Any

_PLAN = re.compile(r"^(?P<plan>.*?\b(?:PLANS?|PL(?=\s+(?:PTS?\b|\d))))\b(?P<rest>.*)$")
_DIMS = re.compile(
    r"(?P<front>\d+(?:\.\d+)?)\s*X\s*(?P<avg>AVG\s*)?(?P<depth>\d+(?:\.\d+)?)(?P<more>(?:\s*X\s*\d+(?:\.\d+)?)*)"
)
LEGAL1_WIDTH = 47  # the County field is 47 characters, space-padded; longer values exist but are rare
_LOT_WORD = re.compile(r"\bLOTS?\b")
_SINGLE = re.compile(r"^(?:(?P<pt>PTS?)\s+)?(?P<num>\d+[A-Z]?)$")


def _num(s: str) -> int | float:
    v = float(s)
    return int(v) if v.is_integer() else v


def legal1_cut(legal: str | None) -> bool:
    """True when LEGAL1 fills its 47-character field and the text runs out inside the dimensions:
    either the first NNxNN ends at the last character ('...LOT 30X1' for 30X1xx) or a partial one
    does ('...LOT 21.04', '...LOT 23.45XA')."""
    if not legal or len(legal) != LEGAL1_WIDTH or legal[-1] == " ":
        return False
    up = legal.upper()
    m = _DIMS.search(up)
    if m:
        return m.end() == len(up)
    return bool(re.search(r"\bLOTS?\b.*\d[\d.]*\s*(?:X\s*(?:A(?:VG?)?)?)?$", up))


def parse_legal1(legal: str | None) -> dict[str, Any] | None:
    """LEGAL1 -> {plan, plan_lot, part, front, depth, depth_avg, dims, parsed_from}, or None when
    there is no NNxNN or the dimensions may be cut off at the field width (see legal1_cut).

    >>> parse_legal1("ROBT ROBB PLAN 67 LOT 24X100 MAHON ST BET KIRKP")["plan_lot"]
    '67'
    """
    if not legal or legal1_cut(legal):
        return None
    text = re.sub(r"\s+", " ", legal.strip().upper())
    m = _DIMS.search(text)
    if not m:
        return None
    front, depth = _num(m.group("front")), _num(m.group("depth"))
    dims = re.sub(r"\s+", "", m.group(0))

    plan = None
    plan_lot = None
    part = False
    pm = _PLAN.match(text[: m.start()])
    if pm:
        plan = pm.group("plan").strip().title()
        rest = pm.group("rest")
        lm = _LOT_WORD.search(rest)
        desig = (rest[: lm.start()] if lm else rest).strip()
        desig = re.sub(r"\s*=\s*$", "", desig).strip()
        if desig:
            part = bool(re.search(r"\bPTS?\b", desig))
            sm = _SINGLE.match(desig)
            plan_lot = sm.group("num") if sm else desig
    else:
        part = bool(re.search(r"\bPTS?\b", text[: m.start()]))
    return {
        "plan": plan,
        "plan_lot": plan_lot,
        "part": part,
        "front": front,
        "depth": depth,
        "depth_avg": bool(m.group("avg")),
        "dims": dims,
        "parsed_from": "LEGAL1",
    }


def pin_lot(pin: str) -> tuple[int, str | None]:
    """County lot number and sub-lot suffix from a 16-char PIN.

    0010K00025000000 -> (25, None); 0010K00028000A00 -> (28, "A").
    """
    if len(pin) != 16:
        raise ValueError(f"unexpected PIN format: {pin!r}")
    lot = int(pin[5:10])
    sub = pin[10:14].lstrip("0") or None
    return lot, sub


_SUFFIX = {
    "ST": "Street", "AVE": "Avenue", "AV": "Avenue", "WAY": "Way", "PL": "Place", "DR": "Drive",
    "RD": "Road", "BLVD": "Boulevard", "TER": "Terrace", "LN": "Lane", "CT": "Court", "ALY": "Alley",
    "SQ": "Square", "HWY": "Highway", "PKWY": "Parkway",
}


def _title(s: str) -> str:
    out = []
    for w in s.split():
        out.append(w if any(c.isdigit() for c in w) and not w.isdigit() and w[0].isdigit() else w.capitalize())
    return " ".join(out)


_SUFFIX_WORDS = {v.upper() for v in _SUFFIX.values()} | set(_SUFFIX) | {"AVENUE", "STREET"}


def street_base(name: str) -> str:
    words = re.sub(r"[^A-Z0-9 ]", " ", name.upper()).split()
    while len(words) > 1 and words[-1] in _SUFFIX_WORDS:
        words = words[:-1]
    return " ".join(words)


def match_osm_street(street: str | None, osm_names) -> str | None:
    """Normalize an address street and, when exactly one OSM name shares its base name
    ('SHETLAND AV' -> 'Shetland Street'), return the OSM name; else the normalized street."""
    norm = normalize_street(street)
    if norm is None:
        return None
    base = street_base(norm)
    hits = sorted({n for n in osm_names if street_base(n) == base})
    if norm in hits:
        return norm
    return hits[0] if len(hits) == 1 else norm


def normalize_street(street: str | None) -> str | None:
    """'MAHON ST' -> 'Mahon Street' (matches OSM names)."""
    if not street:
        return None
    words = street.strip().upper().split()
    if not words:
        return None
    if words[-1] in _SUFFIX:
        words = words[:-1] + [_SUFFIX[words[-1]].upper()]
    return _title(" ".join(words))


def split_address(addr: str) -> tuple[str | None, str]:
    """'2241 MAHON ST' -> ('2241', 'MAHON ST')."""
    a = re.sub(r"\s+", " ", addr.strip().upper())
    m = re.match(r"^(\d+[A-Z]?(?:-\d+)?)\s+(.*)$", a)
    if m:
        return m.group(1), m.group(2)
    return None, a


def addr_display(housenum: str | None, street: str) -> str:
    """Title-cased display address; house number 0/blank -> 'Mahon St (no number)'."""
    st = _title(re.sub(r"\s+", " ", street.strip().upper()))
    hn = (housenum or "").strip()
    if not hn or hn.lstrip("0") == "":
        return f"{st} (no number)"
    return f"{hn.lstrip('0')} {st}"
