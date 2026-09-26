"""Output files match the app's Rule schema; a full run works end to end on a fake model."""

import json
import re

import pytest
from langchain_core.messages import AIMessage

from extract.llm import Config, Extractor
from extract.run import run_district
from extract.schema import ALL_FIELDS, ExtractedFile, ExtractionOut, NarrowRowOut, ProposedRule, Rule
from extract.sections import DAGGER_FIELDS
from extract.source import REPO

EXTRACTED = REPO / "data/rules/extracted"


def test_rule_field_list_matches_typescript():
    ts = (REPO / "engine/src/types.ts").read_text()
    union = re.search(r"export type RuleField =([^;]+);", ts).group(1)
    assert re.findall(r"'([a-z_]+)'", union) == ALL_FIELDS


def test_answer_key_validates_against_the_python_rule_schema():
    for p in (REPO / "data/rules/base").glob("*.json"):
        for r in json.loads(p.read_text()):
            Rule.model_validate(r)


def extracted_files():
    return sorted(p for p in EXTRACTED.glob("*.json") if p.name != "eval.json")


@pytest.mark.parametrize("path", extracted_files(), ids=[p.name for p in extracted_files()])
def test_committed_extractions_are_valid_pencil(path):
    doc = json.loads(path.read_text())
    ExtractedFile.model_validate(doc)
    slug = path.stem
    base_ids = {r["id"] for p in (REPO / "data/rules/base").glob("*.json") for r in json.loads(p.read_text())}
    assert doc["meta"]["model"] and doc["meta"]["prompt_sha"] and doc["meta"]["tokens_in"] > 0 and doc["meta"]["tokens_out"] > 0
    for r in doc["rules"]:
        assert r["id"] == f"{slug}.x.{r['field']}" and r["id"] not in base_ids
        assert r["origin"] == "extracted"
        assert r["verification"]["level"] == "unreviewed" and r["verification"]["reviewer"] is None
        assert r["dagger"] == (r["field"] in DAGGER_FIELDS)
        assert r["model"] == doc["meta"]["model"] or r["model"] in doc["meta"]["model"].split(",")
        assert r["source_url"] and r["retrieved"]


def test_eval_json_is_not_mistaken_for_rules():
    p = EXTRACTED / "eval.json"
    if not p.exists():
        pytest.skip("eval not run yet")
    assert "rules" not in json.loads(p.read_text())


class FakeChat:
    def __init__(self, outputs):
        self.outputs = outputs  # call id -> ExtractionOut

    def with_structured_output(self, schema, method=None, include_raw=False):
        return self

    def invoke(self, messages):
        user = messages[-1][1]
        field_line = next(l for l in user.split("\n") if l.startswith("Fields to extract"))
        key = next(k for k in self.outputs if k in field_line)
        raw = AIMessage(content="{}", usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110}, response_metadata={"model_name": "fake-model"})
        return {"raw": raw, "parsed": self.outputs[key], "parsing_error": None}


def test_run_end_to_end_on_a_fake_model(tmp_path):
    good = ProposedRule(field="front_setback", value_number=15, unit="ft", applies_to=["*"], section="903.03.D",
                        quote="Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 15 ft.", ambiguous=False)
    wrong_section = good.model_copy(update={"field": "rear_setback", "section": "903.03.C"})
    dup = good.model_copy()
    use = ProposedRule(field="use_row", value_use="S", unit="use", applies_to=["row"], section="911.02", condition="P for lots 35 ft wide or less",
                       quote="Single-Unit Attached Residential means the use of a zoning lot for one dwelling unit that is attached to one or more dwelling units by a party wall or separate abutting wall and that is located on its own separate lot. | P/S", ambiguous=False)
    outs = {"min_lot_area": ExtractionOut(rules=[good, wrong_section, dup]), "contextual_side": ExtractionOut(rules=[]),
            "use_detached": ExtractionOut(rules=[use]), "parking_detached": ExtractionOut(rules=[]),
            "grading_review": ExtractionOut(rules=[]), "lot_of_record": ExtractionOut(rules=[])}
    ex = Extractor(Config("gemini", "fake-model"), chat_model=FakeChat(outs), sleep=lambda s: None)
    doc = run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex, out_dir=tmp_path)
    ExtractedFile.model_validate(json.loads((tmp_path / "r1d-h.json").read_text()))
    ids = [r["id"] for r in doc["rules"]]
    assert ids == ["r1d-h.x.front_setback", "r1d-h.x.use_row"]
    reasons = [x["reason"] for x in doc["rejected"]]
    assert any("not inside §903.03.C" in r for r in reasons) and any("duplicate" in r for r in reasons)
    use_rule = doc["rules"][1]
    assert use_rule["dagger"] and use_rule["question_for_city"]  # conditional -> a question
    assert doc["meta"]["tokens_in"] == 600 and doc["meta"]["calls"][0]["tokens_out"] == 10 and len(doc["meta"]["calls"]) == 6
    assert "narrow_lot_side_table" in doc["meta"]["note"]  # missing fields are named, not filled in
