"""Refresh diff logic (no network) and the committed refresh files."""
import json
from pathlib import Path

import pytest

from pipeline import refresh as R

REPO = Path(__file__).resolve().parents[2]


def test_dataset_ids_collapse_pages():
    assert R.dataset_id("city/parcels/page_0012") == "city/parcels"
    assert R.dataset_id("city/parcels/count") is None
    assert R.dataset_id("10K/assessments_000") == "10K/assessments"
    assert R.dataset_id("city/assess/105_000") == "city/assessments"
    assert R.dataset_id("sales_105/page_000") == "sales_105"
    assert R.dataset_id("city_owned") == "city_owned"


def test_diff_records_changed_added_removed():
    before = {"A": {"addr": "1 X St", "city": {"status": "Available for Sale"}, "zone": "R1D-H"},
              "B": {"addr": "2 X St", "city": None, "zone": "R1D-H"}}
    after = {"A": {"addr": "1 X St", "city": {"status": "Sale Pending"}, "zone": "R1D-H"},
             "C": {"addr": "3 X St", "city": None, "zone": "R2-L"}}
    ch = R.diff_records(before, after, ["city.status", "zone"], "city", None)
    kinds = {(c["pin"], c["field"], c["kind"]) for c in ch}
    assert kinds == {("A", "city.status", "changed"), ("B", "*", "removed"), ("C", "*", "added")}
    a = next(c for c in ch if c["pin"] == "A")
    assert (a["before"], a["after"]) == ("Available for Sale", "Sale Pending")


def test_diff_money_sales_and_numbers():
    b = {"median": 155000, "counts": {"valid_1_2_unit": 33}, "sales": [{"parid": "P1", "saledate": "2024-01-01", "price": 1, "address": "x"}]}
    a = {"median": 160000, "counts": {"valid_1_2_unit": 34}, "sales": [{"parid": "P1", "saledate": "2024-01-01", "price": 1, "address": "x"},
                                                                        {"parid": "P2", "saledate": "2026-09-20", "price": 2, "address": "y"}]}
    ch = R.diff_money(b, a, ["median", "counts.valid_1_2_unit"], "comps")
    assert {(c["field"], c["kind"]) for c in ch} == {("comps.median", "changed"), ("comps.counts.valid_1_2_unit", "changed"),
                                                    ("comps.sales", "added")}


def test_summary_sentence_empty_is_honest():
    s = R.summary_sentence([], [{"id": "x", "changed": False}], ["fetch HUD"])
    assert s.startswith("No processed value changed") and "not re-pulled: fetch HUD" in s


def test_html_to_text_joins_cells():
    t = R.html_to_text("<p>Hello</p><table><tr><td>Minimum Lot Size</td><td>6,000 s.f.</td></tr></table><script>x()</script>")
    assert "Hello" in t and " | Minimum Lot Size | 6,000 s.f." in t and "x()" not in t


def test_committed_latest_schema():
    p = REPO / "data" / "refresh" / "latest.json"
    if not p.exists():
        pytest.skip("no refresh run committed yet")
    rep = json.loads(p.read_text())
    assert set(rep) == {"meta", "changes", "code", "summary"}
    for k in ("run_at", "from", "to", "datasets"):
        assert k in rep["meta"]
    for d in rep["meta"]["datasets"]:
        assert set(d) >= {"id", "rows_before", "rows_after", "sha_before", "sha_after", "changed"}
    for c in rep["changes"]:
        assert set(c) == {"pin", "addr", "block", "scope", "field", "before", "after", "kind"}
        assert c["kind"] in ("changed", "added", "removed") and c["scope"] in ("block", "city", "money")
    assert all(c["file"].startswith("data/code/") for c in rep["code"])
    assert not any("data/rules" in d["id"] for d in rep["meta"]["datasets"])


def test_vs_research_fixture_labelled():
    p = REPO / "data" / "refresh" / "vs-research-fixture.json"
    if not p.exists():
        pytest.skip("vs-research-fixture.json not written")
    rep = json.loads(p.read_text())
    assert "RESEARCH FIXTURE" in rep["meta"]["label"]
    assert set(rep["meta"]["fields"]) == {"status", "lotarea", "use", "yearbuilt", "zone"}
