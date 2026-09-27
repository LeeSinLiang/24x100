"""The guards reject what they must, and never let an extracted rule out of pencil."""

import json

from extract.guards import guard, normalize_section, number_in_text, table_rows_in_text
from extract.schema import NarrowRowOut, ProposedRule
from extract.source import REPO

FRONT = "Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft."
DIM = ["min_lot_area", "front_setback", "rear_setback", "side_setback_exterior", "side_setback_interior", "max_height_ft", "max_stories", "party_wall_side"]


def P(**kw) -> ProposedRule:
    construct = kw.pop("_construct", False)
    base = dict(field="front_setback", value_number=25, unit="ft", applies_to=["*"], condition=None, section="903.03.C", quote=FRONT, ambiguous=False, question_for_city=None)
    base.update(kw)
    return ProposedRule.model_construct(**base) if construct else ProposedRule(**base)


def G(p, fields=DIM):
    return guard(p, district="RM-M", allowed_fields=fields, model="test-model", prompt_sha="abc")


def test_accepts_a_good_rule_as_pencil():
    v = G(P())
    assert v.reason is None
    r = v.rule
    assert r["id"] == "rm-m.x.front_setback"
    assert r["value"] == 25 and isinstance(r["value"], int)
    assert r["verification"] == {"level": "unreviewed", "reviewer": None, "role": None, "at": None, "note": None, "reference": None}
    assert r["origin"] == "extracted" and r["dagger"] is False
    assert r["source_file"] == "data/code/ch903.txt" and r["source_url"] == "https://ecode360.com/45474194" and r["retrieved"] == "2026-09-26"
    assert r["model"] == "test-model" and r["prompt_sha"] == "abc"
    assert r["question_for_city"] is None


def test_rejects_non_verbatim_quote():
    v = G(P(quote="Minimum Front Setback: RM Subdistrict, 25 feet"))
    assert v.rule is None and v.reason.startswith("quote guard") and "word for word" in v.reason
    # one character off (curly quotes) is still not verbatim
    v = G(P(field="party_wall_side", value_number=0, section="903.03.C.2(c)", quote="When a dwelling is “attached” to one (1) or more separate dwelling units"))
    assert v.rule is None and v.reason.startswith("quote guard")


def test_rejects_quote_outside_cited_section():
    v = G(P(section="903.03.D"))  # the Moderate table's row, cited to High Density
    assert v.rule is None and "not inside §903.03.D" in v.reason
    v = G(P(section="903.03.Q"))
    assert v.rule is None and "not found" in v.reason
    v = G(P(section="Table 5"))
    assert v.rule is None


def test_rejects_out_of_range_values():
    assert "outside the plausible range" in G(P(value_number=150)).reason
    assert "outside the plausible range" in G(P(value_number=-1)).reason
    lot = dict(field="min_lot_area", unit="sf", quote="Minimum Lot Size | 2,400 s.f.", section="903.03.C")
    assert G(P(**lot, value_number=2400)).rule is not None
    assert "outside the plausible range" in G(P(**lot, value_number=24000)).reason
    h = dict(field="max_height_ft", unit="ft", quote="RM Subdistrict | 55 ft. (not to exceed 4 stories)")
    assert G(P(**h, value_number=55)).rule is not None
    assert "outside the plausible range" in G(P(**h, value_number=250)).reason
    s = dict(field="max_stories", unit="stories", quote="RM Subdistrict | 55 ft. (not to exceed 4 stories)")
    assert "outside the plausible range" in G(P(**s, value_number=0)).reason
    assert "outside the plausible range" in G(P(**s, value_number=25)).reason
    assert "not a whole number" in G(P(**s, value_number=3.5)).reason


def test_rejects_wrong_unit_missing_value_bad_use_code_and_unrequested_field():
    assert "unit" in G(P(unit="sf")).reason
    assert "no numeric value" in G(P(value_number=None)).reason
    use = dict(field="use_detached", unit="use", section="911.02", value_number=None, applies_to=["detached"],
               quote="Single-Unit Detached Residential means the use of a zoning lot for one detached housing unit. | P | P")
    ok = guard(P(**use, value_use="P"), district="R1D-H", allowed_fields=["use_detached"], model="m", prompt_sha="s")
    assert ok.rule["value"] == "P" and ok.rule["dagger"] is True and ok.rule["verification"]["level"] == "unreviewed"
    bad = guard(P(**use, value_use="A", _construct=True), district="R1D-H", allowed_fields=["use_detached"], model="m", prompt_sha="s")
    assert bad.rule is None and "not one of P, S, SPR, N" in bad.reason
    assert "not requested" in G(P(**use, value_use="P")).reason


def _narrow_rows():
    key = json.loads((REPO / "data/rules/base/pgh.json").read_text())
    return next(r for r in key if r["field"] == "narrow_lot_side_table")["value"]


NARROW = dict(field="narrow_lot_side_table", unit="table", value_number=None, section="925.06.C", applies_to=["detached"],
              quote="for any single-unit house on a recorded zoning lot that is less than sixty (60) feet in width, the side yards may be reduced according to the following:")
CTX = ["contextual_side", "contextual_rear", "narrow_lot_side_table"]


def test_table_rows_must_be_in_the_cited_section():
    rows = [NarrowRowOut(**r) for r in _narrow_rows()]
    ok = G(P(**NARROW, value_table=rows), CTX)
    assert ok.rule is not None and ok.rule["value"][-1] == {"max_width": 37, "interior": 3, "streetside": 15}
    bad = [r.model_copy() for r in rows]
    bad[-1] = NarrowRowOut(max_width=37, interior=2, streetside=15)  # 2 ft is not in the table
    v = G(P(**NARROW, value_table=bad), CTX)
    assert v.rule is None and "not found as table cells" in v.reason
    assert table_rows_in_text([(37, 3, 15), (49, 5, 20)], "37′ and below | 3′ | 15′ | 49 | 5′ | 20′") == []


def test_ambiguous_or_conditional_needs_a_question():
    # model flags ambiguity and asks: kept as the model's question
    v = G(P(**NARROW, value_table=[NarrowRowOut(**r) for r in _narrow_rows()], ambiguous=True,
            question_for_city="Does single-unit house include single-unit attached houses?"), CTX)
    assert v.question_source == "model" and "attached" in v.rule["question_for_city"]
    assert v.rule["verification"]["level"] == "unreviewed"
    # model flags ambiguity without a question: the guard writes one and says so
    v = G(P(**NARROW, value_table=[NarrowRowOut(**r) for r in _narrow_rows()], ambiguous=True), CTX)
    assert v.question_source == "guard" and v.rule["question_for_city"] and any("guard" in n for n in v.notes)
    # conditional (condition set) without a question: guard writes one
    v = G(P(condition="only for lots over 30 ft wide"))
    assert v.question_source == "guard" and "only for lots over 30 ft wide" in v.rule["question_for_city"]
    # plain rule: no question
    assert G(P()).rule["question_for_city"] is None


def test_soft_checks_and_section_normalization():
    v = G(P(value_number=30))  # 30 is in the quote (the R1D row) -> in range, verbatim, accepted; a person reads the row
    assert v.rule is not None
    v = G(P(value_number=26))
    assert v.rule is not None and any("does not appear in the quote" in n for n in v.notes)
    assert number_in_text(0, "shall be zero on the abutting")
    assert number_in_text(2400, "Minimum Lot Size | 2,400 s.f.")
    assert not number_in_text(24, "Minimum Lot Size | 2,400 s.f.")
    assert normalize_section("§ 903.03.C.2.(c)") == "903.03.C.2(c)"
    assert normalize_section("Section 925.06.C") == "925.06.C"


# ── The use table, read by position (extract/usetable.py) ────────────────────
TWO_ROW = "Two-Unit Residential means the use of a zoning lot for two dwelling units that are contained within a single building.)"


def test_use_table_columns_and_cells_by_position():
    from extract.usetable import cell, columns

    cols = columns()
    assert len(cols) == 25 and cols[:5] == ["R1D", "R1A", "R2", "R3", "RM"] and cols[15:18] == ["P", "H", "EMI"] and cols[19] == "DT"
    assert cell("use_two", "RM-M") == "P" and cell("use_two", "R1D-H") == "" and cell("use_three", "R2-L") == ""
    assert cell("use_row", "R1D-H") == "P/S" and cell("use_detached", "H") == "A" and cell("use_detached", "P") == "P"
    assert cell("use_two", "H") == "" and cell("use_three", "P") == ""


def test_a_use_reading_that_disagrees_with_the_table_is_rejected():
    def U(district, value):
        p = P(field="use_two", value_number=None, value_use=value, unit="use", applies_to=["two"], section="911.02", quote=TWO_ROW)
        return guard(p, district=district, allowed_fields=["use_two"], model="m", prompt_sha="s")

    assert U("RM-M", "P").rule is not None  # RM's column reads P
    assert U("R1D-H", "N").rule is not None  # an empty cell: not permitted
    bad = U("H", "P")  # the Hillside column's cell is empty
    assert bad.rule is None and "H column" in bad.reason
    assert U("R2-L", "N").rule is None  # R2 permits a two-unit house
    assert U("H", "N").rule is not None
