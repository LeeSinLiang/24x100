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
    return sorted(p for p in EXTRACTED.glob("*.json") if p.name != "eval.json") + sorted((EXTRACTED / "compare").glob("*.json"))


@pytest.mark.parametrize("path", extracted_files(), ids=[p.name for p in extracted_files()])
def test_committed_extractions_are_valid_pencil(path):
    doc = json.loads(path.read_text())
    ExtractedFile.model_validate(doc)
    slug = path.name.split(".")[0]
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
        raw = AIMessage(content=self.outputs[key].model_dump_json(), usage_metadata={"input_tokens": 100, "output_tokens": 10, "total_tokens": 110}, response_metadata={"model_name": "fake-model"})
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
    doc = run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex, out_dir=tmp_path, cache_dir=None)
    ExtractedFile.model_validate(json.loads((tmp_path / "r1d-h.json").read_text()))
    ids = [r["id"] for r in doc["rules"]]
    assert ids == ["r1d-h.x.front_setback", "r1d-h.x.use_row"]
    reasons = [x["reason"] for x in doc["rejected"]]
    assert any("not inside §903.03.C" in r for r in reasons) and any("duplicate" in r for r in reasons)
    use_rule = doc["rules"][1]
    assert use_rule["dagger"] and use_rule["question_for_city"]  # conditional -> a question
    assert doc["meta"]["tokens_in"] == 600 and doc["meta"]["calls"][0]["tokens_out"] == 10 and len(doc["meta"]["calls"]) == 6
    assert "narrow_lot_side_table" in doc["meta"]["note"]  # missing fields are named, not filled in


class Overloaded(Exception):
    pass


class FlakyChat(FakeChat):
    """Refuses every call whose field list contains `bad`; `daily` makes it a daily-quota refusal."""

    def __init__(self, outputs, bad, daily=False):
        super().__init__(outputs)
        self.bad, self.daily, self.calls = bad, daily, 0

    def invoke(self, messages):
        self.calls += 1
        field_line = next(l for l in messages[-1][1].split("\n") if l.startswith("Fields to extract"))
        if self.bad in field_line:
            raise Overloaded("429 RESOURCE_EXHAUSTED GenerateRequestsPerDayPerProjectPerModel-FreeTier" if self.daily else "503 UNAVAILABLE high demand")
        return super().invoke(messages)


def _outs():
    good = ProposedRule(field="front_setback", value_number=15, unit="ft", applies_to=["*"], section="903.03.D",
                        quote="Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 15 ft.", ambiguous=False)
    empty = ExtractionOut(rules=[])
    return {"min_lot_area": ExtractionOut(rules=[good]), "contextual_side": empty, "use_detached": empty,
            "parking_detached": empty, "grading_review": empty, "lot_of_record": empty}


def test_a_refused_call_is_recorded_not_filled_in(tmp_path):
    chat = FlakyChat(_outs(), bad="contextual_side")
    ex = Extractor(Config("gemini", "fake-model"), chat_model=chat, sleep=lambda s: None, max_attempts=2)
    doc = run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex, out_dir=tmp_path, cache_dir=None)
    m = doc["meta"]
    assert m["incomplete"] and m["failed_calls"] == ["contextual"]
    assert [r["field"] for r in doc["rules"]] == ["front_setback"]
    c = next(x for x in m["calls"] if x["section"].startswith("contextual"))
    assert c["attempts"] == 2 and c["tokens_in"] == 0 and c["error"].startswith("refused")
    assert "contextual" in m["note"]
    ExtractedFile.model_validate(json.loads((tmp_path / "r1d-h.json").read_text()))


def test_daily_quota_stops_the_rest_of_the_run(tmp_path):
    chat = FlakyChat(_outs(), bad="contextual_side", daily=True)
    ex = Extractor(Config("gemini", "fake-model"), chat_model=chat, sleep=lambda s: None)
    doc = run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex, out_dir=tmp_path, cache_dir=None)
    assert doc["meta"]["failed_calls"] == ["contextual", "use", "parking", "grading", "lot_of_record"]
    assert chat.calls == 2  # dimensional ok, contextual refused once, nothing after


def test_nothing_is_written_when_every_call_is_refused(tmp_path):
    chat = FlakyChat(_outs(), bad="Fields")  # matches every call
    ex = Extractor(Config("gemini", "fake-model"), chat_model=chat, sleep=lambda s: None, max_attempts=1)
    from extract.llm import ProviderRefused
    with pytest.raises(ProviderRefused):
        run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex, out_dir=tmp_path, cache_dir=None)
    assert not (tmp_path / "r1d-h.json").exists()


def test_resume_reuses_the_saved_real_response(tmp_path):
    cache = tmp_path / "cache"
    chat = FlakyChat(_outs(), bad="contextual_side")
    ex = Extractor(Config("gemini", "fake-model"), chat_model=chat, sleep=lambda s: None, max_attempts=1)
    first = run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex, out_dir=tmp_path, cache_dir=cache)
    n = chat.calls
    assert first["meta"]["failed_calls"] == ["contextual"]
    # second run: contextual works now; the other five prompts are identical, so they come from the cache
    chat2 = FakeChat(_outs())
    ex2 = Extractor(Config("gemini", "fake-model"), chat_model=chat2, sleep=lambda s: None)
    calls = {"n": 0}
    orig = chat2.invoke
    chat2.invoke = lambda m: (calls.__setitem__("n", calls["n"] + 1), orig(m))[1]
    second = run_district("R1D-H", Config("gemini", "fake-model"), extractor=ex2, out_dir=tmp_path, cache_dir=cache, resume=True)
    assert calls["n"] == 1 and not second["meta"]["incomplete"]
    assert sum(1 for c in second["meta"]["calls"] if c["cached_from"]) == 5
    assert second["meta"]["tokens_in"] == first["meta"]["tokens_in"] + 100  # cached calls keep their real counts
    assert [r["id"] for r in second["rules"]] == [r["id"] for r in first["rules"]]
    assert n == 6
