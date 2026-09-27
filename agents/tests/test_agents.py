"""The agents, with no network: fake HTTP for the public datasets, a fake chat model, and the engine's readings captured
from scripts/case-engine.ts (fixtures/). Nothing here calls a model or WPRDC."""
import json
from pathlib import Path

import pytest
from langchain_core.messages import AIMessage

from agents import dd, sources, steward, verifier, watch
from agents.case import CASES, Case
from agents.model import connect

FIX = Path(__file__).parent / "fixtures"
LOT25 = json.loads((FIX / "lot25.json").read_text())
SIM24 = json.loads((FIX / "lot25-sim24.json").read_text())
WATCH = json.loads((FIX / "watch-d87dce4.json").read_text())


def ckan(records, total=None):
    return json.dumps({"success": True, "result": {"records": records, "total": len(records) if total is None else total}}).encode()


def fake_http(by_resource):
    """A WPRDC stand-in. It ignores `fields=`, the way a careless server might, so scrub() has to do its job."""
    seen = []

    def get(url):
        seen.append(url)
        for res, body in by_resource.items():
            if res in url:
                return body
        return ckan([])

    get.seen = seen
    return get


VIOLATION = {"casefile_number": "CF-PLI-2022-045315", "status": "Clean & Lien", "case_file_type": "Weeds/Debris", "investigation_date": "2022-11-08",
             "investigation_outcome": "DPW to Correct Issue", "violation_code_section": None, "violation_code_section_title": None, "parcel_id": "0010K00025000000",
             "investigation_findings": "free text a person wrote", "owner_name": "A PERSON"}


def http_lot25():
    return fake_http({
        sources.DATASETS["violations"].resource: ckan([VIOLATION]),
        sources.DATASETS["permits"].resource: ckan([]),
        sources.DATASETS["condemned"].resource: ckan([]),
        sources.DATASETS["liens"].resource: ckan([{"pin": "0010K00025000000", "tax_year": 1999, "amount": 100.5, "satisfied": True, "assignee": "SOMEONE"}]),
        sources.DATASETS["311"].resource: ckan([{"case_number": "1", "status": "closed", "subject": "Litter on Public Property", "created_date_et": "2024-07-25T10:00:00",
                                                 "street": "MAHON ST", "latitude": 40.4462, "longitude": -79.9747, "case_owner": "A PERSON"}]),
    })


# ── names ────────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_no_dataset_requests_a_name_like_field():
    sources.assert_whitelist()
    for d in sources.DATASETS.values():
        assert not any(sources.NAME_LIKE.search(f) for f in d.fields), d.key
        assert all(sources.NAME_LIKE.search(x) or x in ("work_description", "investigation_findings", "violation_description", "violation_spec_instructions", "docket_number", "last_docket_entry", "dtd") for x in d.excluded)


def test_the_whitelist_guard_can_fail(monkeypatch):
    bad = dict(sources.DATASETS)
    bad["permits"] = sources.Dataset(**{**sources.DATASETS["permits"].__dict__, "fields": sources.DATASETS["permits"].fields + ("owner_name",)})
    monkeypatch.setattr(sources, "DATASETS", bad)
    with pytest.raises(ValueError):
        sources.assert_whitelist()


def test_a_name_field_a_server_sends_anyway_never_reaches_a_finding(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)
    c = Case("t", "g", {}, "now", {})
    f = dd.check("violations", LOT25, c, http_lot25())
    assert f["status"] == "found" and f["records"]
    assert all("owner_name" not in r and "investigation_findings" not in r for r in f["records"])
    lien = dd.check("liens", LOT25, c, http_lot25())
    assert all("assignee" not in r for r in lien["records"])


def test_every_committed_case_file_is_clear_of_name_like_keys():
    files = list(CASES.glob("*.json")) + list(CASES.glob("raw/*/*.json"))  # the case files and the responses they cite
    for p in files:
        doc = json.loads(p.read_text())
        assert verifier._names(doc) == [], p.name
    # and the check itself bites
    assert verifier._names({"findings": [{"records": [{"owner_name": "X"}]}]}) == ["findings[0].records[0].owner_name"]


# ── due diligence ───────────────────────────────────────────────────────────────────────────────────────────────────

def test_findings_carry_their_source_and_counted_numbers(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)
    c = Case("t", "g", {}, "now", {})
    f = dd.check("violations", LOT25, c, http_lot25())
    assert f["summary"].startswith("Found: 1 code-enforcement case file since 2022")
    assert f["source"]["url"].startswith(sources.CKAN) and len(f["source"]["sha256"]) == 64 and f["source"]["pulled_at"]
    assert "fields=casefile_number" in f["source"]["url"]
    assert f["derived"]["first_year"]["value"] == 2022
    assert dd.check("permits", LOT25, c, http_lot25())["status"] == "nothing"
    assert dd.check("liens", LOT25, c, http_lot25())["status"] == "nothing"  # the one lien is satisfied
    slope = dd.check("slope", LOT25, c, http_lot25())
    assert slope["status"] == "found" and slope["derived"]["percent"]["value"] == round(LOT25["lot"]["slope25"] * 100)


def test_a_check_that_cannot_run_says_who_to_ask(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)

    def down(url):
        raise ConnectionError("no network")

    f = dd.check("condemned", LOT25, Case("t", "g", {}, "now", {}), down)
    assert f["status"] == "couldnt" and f["ask"] and "ask" in f["summary"]


def test_paid_studies_are_drafted_and_never_done(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)
    c = Case("t", "g", {}, "now", {})
    dd.run(LOT25, c, None, http_lot25())
    paid = [f for f in c.findings if f["check"] in dd.PAID]
    assert len(paid) == 3 and all(f["status"] == "not_done" for f in paid)
    assert sum(1 for g in c.gates if g["kind"] == "spend") == 3 and all(g["status"] == "waiting" for g in c.gates)


# ── the verifier ────────────────────────────────────────────────────────────────────────────────────────────────────

def _case(**over):
    base = {"plan": [], "steps": [], "findings": [], "drafts": []}
    return {**base, **over}


def test_verifier_blocks_a_number_nobody_computed():
    ok = verifier.verify(_case(steps=[{"n": 1, "summary": "The engine says 24 − 10 − 10 = 4 ft.", "action": "tool"}]), [LOT25])
    assert ok["ok"], ok["failed"]
    bad = verifier.verify(_case(steps=[{"n": 1, "summary": "It would leave 17 ft.", "action": "tool"}]), [LOT25])
    assert not bad["ok"] and "17" in bad["failed"][0]


def test_verifier_blocks_a_quote_not_in_the_code():
    r = json.loads(json.dumps(LOT25))
    r["rules"][0]["quote"] = r["rules"][0]["quote"] + " And a sentence nobody wrote."
    res = verifier.verify(_case(), [r])
    assert not res["ok"] and "not verbatim" in res["failed"][0]


def test_verifier_blocks_an_unsourced_finding_and_a_done_paid_study():
    res = verifier.verify(_case(findings=[{"check": "permits", "status": "found", "summary": "Found.", "source": None},
                                          {"check": "phase1", "status": "not_done", "summary": "Paid.", "done": True}]), [LOT25])
    assert len(res["failed"]) == 2


# ── the steward ─────────────────────────────────────────────────────────────────────────────────────────────────────

def test_steward_runs_by_rule_with_no_model(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)
    doc = steward.run(LOT25["lot"]["pin"], "two", model=None, model_why="--no-model", http=http_lot25(), reading=LOT25, write=False)
    assert doc["status"] == "published", doc["verifier"]["failed"]
    assert doc["model"]["planned_by"] == "rule" and doc["steps"][1]["summary"].startswith("Planned by rule, no model")
    assert [p["agent"] for p in doc["plan"]] == ["due-diligence", "policy", "watch", "verifier"]  # a rule is the first blocker
    assert doc["steps"][-1]["action"] == "gate" and any(s["agent"] == "verifier" for s in doc["steps"])
    assert {g["kind"] for g in doc["gates"]} == {"send", "spend", "sign"} and all(g["status"] == "waiting" for g in doc["gates"])
    assert doc["tokens"]["calls"] == 0


class FakeChat:
    def __init__(self, answers):
        self.answers = answers

    def with_structured_output(self, schema, method=None, include_raw=False):
        self.schema = schema
        return self

    def invoke(self, messages):
        parsed = self.answers[self.schema.__name__]
        raw = AIMessage(content="{}", usage_metadata={"input_tokens": 300, "output_tokens": 150, "total_tokens": 450}, response_metadata={"model_name": "gemini-3.5-flash-lite"})
        return {"raw": raw, "parsed": parsed, "parsing_error": None}


def _answers(summary):
    return {
        "Plan": steward.Plan(steps=[steward.PlanStep(agent="due-diligence", what="Run the checks.", why="Records first."), steward.PlanStep(agent="verifier", what="Check.", why="Last.")]),
        "Picks": dd.Picks(checks=["violations", "slope"], why={"violations": "records", "slope": "grading"}, skipped={}, paid=["survey"]),
        "Summary": steward.Summary(text=summary),
    }


def test_steward_plans_with_a_model_and_records_tokens_and_cost(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)
    m, _ = connect("gemini-flash-lite-latest", fake=FakeChat(_answers("A two-unit house still gets 4 ft on a 2,400 sf lot.")))
    doc = steward.run(LOT25["lot"]["pin"], "two", model=m, http=http_lot25(), reading=LOT25, write=False)
    assert doc["status"] == "published", doc["verifier"]["failed"]
    assert doc["model"]["planned_by"] == "model" and doc["tokens"]["calls"] == 3
    assert doc["cost"]["usd_paid_rate"] == pytest.approx(3 * (300 * 0.30 + 150 * 2.50) / 1e6)
    # the rule decides the policy agent: a rule is the first blocker, so it's in even though the model left it out? no:
    # the plan is the model's, filtered to known agents, verifier last
    assert doc["plan"][-1]["agent"] == "verifier"
    assert [f["check"] for f in doc["findings"]][:2] == ["violations", "slope"]
    left = next(s for s in doc["steps"] if s["agent"] == "due-diligence" and s["action"] == "plan")
    assert "left out: permits, condemned, liens, 311, undermining" in left["summary"]


def test_a_model_that_invents_a_number_blocks_the_case(tmp_path, monkeypatch):
    monkeypatch.setattr(dd, "CASES", tmp_path)
    m, _ = connect("gemini-flash-lite-latest", fake=FakeChat(_answers("A two-unit house could get 19 ft here.")))
    doc = steward.run(LOT25["lot"]["pin"], "two", model=m, http=http_lot25(), reading=LOT25, write=False)
    assert doc["status"] == "blocked" and any("19" in f for f in doc["verifier"]["failed"])


# ── the watch agent ─────────────────────────────────────────────────────────────────────────────────────────────────

def test_watch_explains_the_real_change_and_labels_the_simulation():
    doc = watch.run("d87dce4^", model=None, simulate=[("0010K00025000000", ["0010K00024000000"])], watch_json=WATCH, sims=[LOT25, SIM24], write=False)
    assert doc["status"] == "published", doc["verifier"]["failed"]
    real = [e for e in doc["events"] if e["kind"] == "real"]
    sim = [e for e in doc["events"] if e["kind"] == "simulated"]
    assert {e["addr"] for e in real} == {"324 Curtin Ave", "503 Climax St", "507 Climax St"}
    assert "25 − 5 − 5 = 15 ft" in next(e for e in real if e["addr"] == "503 Climax St")["explanation"]
    assert sim and sim[0]["explanation"].startswith("SIMULATION, not a record") and sim[0]["after"] == {"formula": "24 − 3 − 10 = 11", "best": 11, "trust": "pencil"}
    assert all(g["kind"] == "send" and g["status"] == "waiting" for g in doc["gates"]) and len(doc["gates"]) == 3
