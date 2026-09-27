"""The policy agent, with no network: a fake model and a fake count tool (plus one real run of the builder, when Node is here).
It can say no: a quote that isn't word for word is rejected, a change no stored rule carries is refused, and the
counts are whatever the builder returns, never the model's."""

import json
import shutil

import pytest

from agents.policy import core
from agents.policy import tools as T

SIGNED = ["R1D-H", "RM-M", "R2-L", "R1D-L", "R2-H", "R1D-M"]
Q = "What if R2-L's rear setback were 20 ft instead of 30?"
GOOD_QUOTE = "Minimum Rear Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft."
BY_TYPE = {t: {"opens": n, "for_sale": n // 2, "pencil": 0, "was_width": 0, "by_hood": [["Upper Hill", n]], "by_district": [["R2-L", n]], "pins": []} for t, n in (("two", 11), ("three", 0))}


def plan(**kw):
    return core.Plan(**{"decision": "change", "reason": "a stored rule", "district": "R2-L", "field": "rear_setback", "new_value": 20, "name": "R2-L rear 30 → 20 ft", **kw})


def redline(**kw):
    return core.Redline(**{"quote": GOOD_QUOTE, "strike": "30 ft.", "insert": "20 ft.", "change": "30 ft read as 20 ft.", "caveats": ["Other rules may still block a lot."], **kw})


class FakeModel:
    def __init__(self, *answers):
        self.answers, self.calls = list(answers), []

    def __call__(self, schema, messages):
        self.calls.append(schema.__name__)
        return self.answers.pop(0), {"tokens_in": 100, "tokens_out": 20}


class FakeCount:
    def __init__(self):
        self.calls = []

    def __call__(self, override):
        self.calls.append(override)
        v = override.get("value")
        return {"districts": SIGNED, "matched_rules": [{"id": "r2-l.x.rear_setback"}] if v else [], "by_type": BY_TYPE if v else {t: {**BY_TYPE[t], "opens": 0} for t in BY_TYPE}}


def test_the_guard_rejects_a_quote_that_is_not_word_for_word():
    m, c = FakeModel(plan(), redline(quote="Minimum rear setback: 30 feet."), redline(quote="The rear setback is 30 ft.")), FakeCount()
    out = core.run(Q, "two", model=m, count=c)
    assert out["status"] == "refused" and "verbatim guard" in out["reason"] and "word for word" in out["reason"]
    assert m.calls == ["Plan", "Redline", "Redline"]              # one retry, with the guard's reason
    assert [s["ok"] for s in out["steps"] if s.get("tool") == "quote_guard"] == [False, False]
    assert all("value" not in x for x in c.calls)                # nothing was counted


def test_a_change_no_stored_rule_carries_is_refused_not_faked():
    m, c = FakeModel(plan(field="min_lot_width", new_value=20, name="two-unit minimum lot width")), FakeCount()
    out = core.run("What if a two-unit house needed only 20 ft of lot width?", "two", model=m, count=c)
    assert out["status"] == "refused" and "no stored, signed rule 'min_lot_width'" in out["reason"]
    assert "by_type" not in out and all("value" not in x for x in c.calls)


def test_the_model_can_refuse_and_the_reason_is_kept():
    out = core.run("What if duplexes were allowed in R1D-L?", "two", model=FakeModel(core.Plan(decision="refuse", reason="a use permission, not a dimension")), count=FakeCount())
    assert out["status"] == "refused" and out["reason"] == "a use permission, not a dimension"


def test_a_redline_that_disagrees_with_the_override_is_refused():
    out = core.run(Q, "two", model=FakeModel(plan(), redline(insert="25 ft."), redline(insert="25 ft.")), count=FakeCount())
    assert out["status"] == "refused" and "disagree" in out["reason"]


def test_the_override_compiles_and_the_counts_come_from_the_builder():
    c = FakeCount()
    out = core.run(Q, "two", model=FakeModel(plan(), redline()), count=c)
    assert out["status"] == "counted" and out["verified"] is True
    assert out["override"] == {"district": "R2-L", "field": "rear_setback", "to": 20}
    assert c.calls[1:] == [{"value": out["override"]}] * 2          # counted, then re-counted by the verify step
    assert out["by_type"] == BY_TYPE                                 # the builder's numbers, untouched
    assert "11 City-owned vacant lots" in out["memo_md"]
    assert {s["action"] for s in out["steps"]} == {"plan", "tool", "draft", "verify"} and [s["n"] for s in out["steps"]] == list(range(1, len(out["steps"]) + 1))


def test_the_memo_carries_both_labels_and_the_verify_step_checks_its_numbers():
    out = core.run(Q, "two", model=FakeModel(plan(), redline(caveats=["About 40 lots may be affected."])), count=FakeCount())
    memo = out["memo_md"].lower()
    assert "what-if, not the law" in memo and "drafted by an ai agent; check before sending" in memo
    assert out["verified"] is False                                  # "40" traces to nothing: the verify step says so
    assert "untraced: 40" in out["steps"][-1]["summary"]


def test_a_hand_plan_runs_with_no_model_and_says_so():
    hand = {"plan": plan().model_dump(), "redline": redline().model_dump()}
    out = core.run(Q, "two", model=None, hand=hand, count=FakeCount())
    assert out["status"] == "counted" and out["model"]["planned_by"] == "hand" and out["model"]["note"] == core.HAND
    assert "Planned by hand, no model" in out["memo_md"] and out["usage"]["calls"] == 0


def test_a_duplicate_of_an_existing_what_if_is_refused():
    s3 = next(s for s in T.existing_scenarios() if s["id"] == "S3")
    ov = s3["override"]
    p = plan(district=ov["district"], field=ov["field"], new_value=ov["to"])
    r = redline(quote=s3["quote"], strike=s3["strike"], insert=s3["insert"])
    out = core.run("What if RM's interior side setback were 5 ft?", "two", model=FakeModel(p, r), count=FakeCount())
    assert out["status"] == "refused" and "already rule what-if S3" in out["reason"]


@pytest.mark.skipif(not shutil.which("npx"), reason="Node isn't installed, so the scenario builder can't run")
def test_the_real_count_tool_is_the_builder_behind_s1_s3():
    """policy-count.ts on S3's override gives exactly scenarios.json's S3 counts: the same code path, not a copy."""
    s3 = next(s for s in T.existing_scenarios() if s["id"] == "S3")
    got = T.count({"value": s3["override"]})
    assert got["by_type"] == s3["by_type"]
    assert {r["id"] for r in got["matched_rules"]} >= {"rm-m.side_interior"}
