"""Which saved sections feed which rule fields, for a residential district like "RM-M" or "R1D-H".

A residential district name is <Use Subdistrict>-<Development Subdistrict> (§903.01.B). Both halves
are resolved from the saved text, not from a hand-typed table:
- the Use Subdistrict's name comes from §903.02 ("A. R1D, Single-Unit Detached Residential.");
- the Development Subdistrict's lettered part of §903.03 is the one whose "Map Designation"
  paragraph names the suffix ('... shall be the letter "M" ...' -> §903.03.C).

Each call sends only the relevant section text. Long sections may be trimmed to the relevant rows
(the use table, the parking schedule); the quote guard still runs against the full saved file and
the full cited section span.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field

from .source import locate_section, read_code, section_text

C903 = "data/code/ch903.txt"
C911 = "data/code/ch911.txt"
C914 = "data/code/ch914.txt"
C915 = "data/code/ch915.txt"
C921 = "data/code/ch921.txt"
C925 = "data/code/ch925.txt"

# Fields the team's notes mark † (not yet checked by a person): use table, parking, grading,
# lots of record. They stay pencil until a named person signs them in the UI.
DAGGER_FIELDS = {
    "use_detached",
    "use_two",
    "use_row",
    "use_three",
    "parking_detached",
    "parking_two",
    "parking_row",
    "parking_three",
    "grading_review",
    "lot_of_record",
}


@dataclass(frozen=True)
class District:
    name: str  # "RM-M"
    use: str  # "RM"
    use_name: str  # "Multi-Unit Residential"
    use_section: str  # "903.02.E"
    density: str  # "M"
    density_name: str  # "Moderate Density"
    density_section: str  # "903.03.C"

    @property
    def slug(self) -> str:
        return self.name.lower()


def _lettered_parts(section: str, text: str) -> list[tuple[str, str]]:
    """[(letter, raw text)] for the capital-letter parts A., B., ... of a section."""
    out = []
    for letter in "ABCDEFGHIJ":
        span = locate_section(text, f"{section}.{letter}")
        if span is None:
            break
        out.append((letter, text[span.start : span.end]))
    return out


def resolve_district(name: str) -> District:
    name = name.strip().upper()
    m = re.match(r"^([A-Z0-9]+)-([A-Z]+)$", name)
    if not m:
        raise ValueError(f"expected a residential district like RM-M or R1D-H, got {name!r}")
    use, dens = m.group(1), m.group(2)
    t = read_code(C903)

    use_hit = None
    for letter, body in _lettered_parts("903.02", t):
        mm = re.search(rf"^\s*{re.escape(use)}, ([^\n]+?)\.\s*$", body, re.M)
        if mm:
            use_hit = (letter, mm.group(1).strip())
            break
    if not use_hit:
        raise LookupError(f"Use Subdistrict {use!r} not found in §903.02 of {C903}")

    dens_hit = None
    for letter, body in _lettered_parts("903.03", t):
        mm = re.search(r'letters? "([A-Z]+)"', body, re.I)
        if mm and mm.group(1) == dens:
            title = next((ln.strip().rstrip(".") for ln in body.split("\n")[1:] if ln.strip()), "")
            dens_hit = (letter, title)
            break
    if not dens_hit:
        raise LookupError(f"Development Subdistrict suffix {dens!r} not found in §903.03 of {C903}")

    return District(
        name=name,
        use=use,
        use_name=use_hit[1],
        use_section=f"903.02.{use_hit[0]}",
        density=dens,
        density_name=dens_hit[1],
        density_section=f"903.03.{dens_hit[0]}",
    )


@dataclass(frozen=True)
class SectionInput:
    section: str
    source_file: str
    text: str
    trimmed: str | None = None  # how the text was trimmed, if it was


@dataclass
class CallPlan:
    id: str
    fields: list[str]
    sections: list[SectionInput]
    guidance: str
    dagger: set[str] = field(default_factory=set)


def _cut_before(text: str, anchor: str, what: str) -> str:
    i = text.find(anchor)
    if i < 0:
        raise LookupError(f"trim anchor {anchor!r} not found while trimming {what}")
    return text[:i]


def _drop_ordinance_history(text: str) -> str:
    """Drop the bracketed ordinance-history line(s) ("[Ord. ...]"); they carry no standards."""
    return "\n".join(ln for ln in text.split("\n") if not re.match(r"^\s*\[Ord\..*\]\s*$", ln))


def plan(d: District) -> list[CallPlan]:
    dens = d.density_section
    use_tbl = _drop_ordinance_history(
        _cut_before(section_text("911.02", C911), "Assisted Living means", "the §911.02 use table")
    )
    parking = _cut_before(section_text("914.02.A", C914), "Non-Residential Uses", "Parking Schedule A")

    return [
        CallPlan(
            id="dimensional",
            fields=[
                "min_lot_area",
                "front_setback",
                "rear_setback",
                "side_setback_exterior",
                "side_setback_interior",
                "max_height_ft",
                "max_stories",
                "party_wall_side",
            ],
            sections=[SectionInput(dens, C903, section_text(dens, C903))],
            guidance=(
                f"This is the {d.density_name} Subdistrict (§{dens}). In its site development table, "
                f"read the row whose label names the {d.use} Subdistrict (labels list use subdistricts, "
                f'e.g. "R1D, R1A, R2 & R3 Subdistricts" or "RM Subdistrict"). '
                "party_wall_side is the interior side setback on the party-wall or abutting-wall side "
                "of an attached dwelling."
            ),
        ),
        CallPlan(
            id="contextual",
            fields=["contextual_side", "contextual_rear", "narrow_lot_side_table"],
            sections=[
                SectionInput("925.06.C", C925, section_text("925.06.C", C925)),
                SectionInput("925.06.I", C925, section_text("925.06.I", C925)),
            ],
            guidance=(
                "These clauses apply in every district. contextual_side: value = the minimum contextual "
                "side setback in feet; put every limit on when it may be used in `condition`, and quote "
                "the sentences that state them. contextual_rear: value = its minimum in feet if the text "
                "states one, else null; same treatment of its limits. narrow_lot_side_table: "
                "value_table = every row of the lot-width table (max_width = the row's lot width in "
                "feet; the last row covers that width and below), quote = the sentence that introduces "
                "the table."
            ),
        ),
        CallPlan(
            id="use",
            fields=["use_detached", "use_row", "use_two", "use_three"],
            sections=[
                SectionInput("911.02", C911, use_tbl, trimmed="residential rows only; ordinance history dropped"),
                SectionInput("911.04.A.69A", C911, _cut_before(section_text("911.04.A.69A", C911), "70.", "§911.04.A.69A")),
            ],
            guidance=(
                f"Read the column for the {d.use} Use Subdistrict ({d.use_name}, §{d.use_section}). "
                "The district's suffix (e.g. -H) is a Development Subdistrict of §903.03, not a column "
                "of the use table. use_detached = Single-Unit Detached Residential, use_row = "
                "Single-Unit Attached Residential, use_two = Two-Unit Residential, use_three = "
                "Three-Unit Residential. value_use: P = permitted by right, S = special exception, "
                "N = not permitted (a blank cell), SPR = site plan review. If a cell holds more than "
                "one code (e.g. \"P/S\"), use the more restrictive code, state the condition that "
                "decides it in `condition` and cite the standard that sets it. applies_to = the one "
                "matching building type (detached, row, two, three). Quote the use's row starting at "
                "its name, far enough to include the cell you read."
            ),
        ),
        CallPlan(
            id="parking",
            fields=["parking_detached", "parking_row", "parking_two", "parking_three"],
            sections=[SectionInput("914.02.A", C914, parking, trimmed="residential rows only")],
            guidance=(
                "Minimum off-street automobile spaces per dwelling unit. parking_detached = Single-Unit "
                "Detached, parking_row = Single-Unit Attached, parking_two = Two-Unit, parking_three = "
                "Three-Unit. unit = spaces_per_unit; applies_to = the one matching building type."
            ),
        ),
        CallPlan(
            id="grading",
            fields=["grading_review"],
            sections=[SectionInput("915.02.A", C915, section_text("915.02.A", C915))],
            guidance=(
                "grading_review: a flag (value null, unit flag) that grading standards apply to "
                "building on sloped ground; put the thresholds and what they trigger in `condition`."
            ),
        ),
        CallPlan(
            id="lot_of_record",
            fields=["lot_of_record"],
            sections=[
                SectionInput("925.01.C", C925, section_text("925.01.C", C925)),
                SectionInput("921.04", C921, section_text("921.04", C921)),
            ],
            guidance=(
                "lot_of_record: a flag (value null, unit flag) for building on a lot that is smaller "
                "than the district minimum but was recorded before the Code; put who approves it and "
                "under what conditions in `condition`. Return one rule, citing the clause that most "
                "directly allows it."
            ),
        ),
    ]
