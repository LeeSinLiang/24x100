"""Comparables reproduce the pinned fixture from the pinned snapshot (no network)."""
import json
from pathlib import Path

import pytest

from pipeline.money import comps_file, summarize

REPO = Path(__file__).resolve().parents[2]
SNAP = Path(__file__).parent / "fixtures" / "ward5_sales_2026-09-26.json"
COMPS = REPO / "data" / "money" / "comps_ward5.json"
HUD = REPO / "data" / "money" / "hud_fy2026.json"


@pytest.fixture(scope="module")
def snap():
    return json.loads(SNAP.read_text())


def test_snapshot_is_filtered(snap):
    f = snap["meta"]["record_filter"]
    for r in snap["records"]:
        assert r["saledesc"] == f["SALEDESC"]
        assert r["price"] >= f["PRICE_gte"]
        assert r["saledate"] >= f["SALEDATE_gte"]
        assert r["assessment_found"] is True


def test_reproduces_team_fixture(snap):
    s = summarize(snap)
    assert s["counts"]["valid_1_2_unit"] == 33
    assert s["median"] == 155000
    assert (s["q1"], s["q3"]) == (105000, 235000)
    n = s["newest"]
    assert (n["addr"], n["yearbuilt"], n["price"], n["sqft"]) == ("2125 Rose St", 2025, 240000, 1442)
    assert len(s["sales"]) == 33


def test_fixture_counts_are_all_dates(snap):
    # the team fixture's "of 2,274 transfers, 114 were valid" counts the whole sales file, not 2023+
    s = summarize(snap)
    assert s["counts"]["transfers_all_dates"] == 2274
    assert s["counts"]["valid_all_dates"] == 114
    assert s["counts"]["transfers"] == 517
    assert s["counts"]["valid"] == 34


def test_quantile_method_matters(snap):
    s = summarize(snap)
    assert s["quantile_alternatives"]["exclusive_type6"]["q1"] == 103500


def test_snapshot_numbers_match_committed_comps_of_the_same_pull(snap):
    committed = json.loads(COMPS.read_text())
    if committed["meta"]["pulled"][:10] != snap["meta"]["pulled"][:10]:
        pytest.skip("committed comps come from a later pull; the snapshot stays pinned to 2026-09-26")
    fresh = comps_file(snap)
    assert {k: v for k, v in committed.items() if k != "meta"} == {k: v for k, v in fresh.items() if k != "meta"}


def test_committed_comps_reproduce_from_raw_cache():
    from pipeline.fetch import OfflineMiss, RawCache, latest_raw_date
    from pipeline.money import build_snapshot, dumps

    try:
        cache = RawCache(latest_raw_date(["sales_105/page_000"]), offline=True)
    except OfflineMiss:
        pytest.skip("no raw cache on this machine")
    assert dumps(comps_file(build_snapshot(cache))) == COMPS.read_text()


def test_hud_values():
    if not HUD.exists():
        pytest.skip("data/money/hud_fy2026.json not written (HUD fetch failed; see pipeline/README.md)")
    h = json.loads(HUD.read_text())
    assert h["hud_area_code"] == "METRO38300M38300"
    assert h["median_family_income"] == 110400
    assert [h[f"l80_{n}"] for n in range(1, 9)] == [61850, 70650, 79500, 88300, 95400, 102450, 109500, 116600]
    assert all(h[f"l50_{n}"] < h[f"l80_{n}"] for n in range(1, 9))
    assert len(h["meta"]["file_sha256"]) == 64
