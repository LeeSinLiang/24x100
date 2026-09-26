"""Checks on the committed block file data/blocks/10K.json (no network needed)."""
import json
import re
from pathlib import Path

import pytest
from shapely.geometry import LineString, Polygon

from pipeline.crosscheck import main_street_row

REPO = Path(__file__).resolve().parents[2]
BLOCK = REPO / "data" / "blocks" / "10K.json"


@pytest.fixture(scope="module")
def block():
    return json.loads(BLOCK.read_text())


@pytest.fixture(scope="module")
def by_pin(block):
    return {p["pin"]: p for p in block["parcels"]}


def test_meta(block):
    m = block["meta"]
    assert m["id"] == "10K" and m["ward"] == 5 and m["main_street"] == "Mahon Street"
    assert m["recon_tolerance"] == 0.10
    assert m["bounding_streets"] == ["Wylie Ave", "Soho St", "Mahon St", "Kirkpatrick St"]
    assert m["selection"] == "rep-point inside OSM street polygon"
    assert re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$", m["pulled"])
    assert all(s["pulled"] <= m["pulled"] for s in m["sources"])


def test_parcels_sorted_and_unique(block):
    pins = [p["pin"] for p in block["parcels"]]
    assert pins == sorted(pins) and len(pins) == len(set(pins))


def test_lot_22_records_disagree(by_pin):
    p = by_pin["0010K00022000000"]
    assert p["addr"] == "2247 Humber Way" and p["addr_source"] == "city_owned"
    assert p["recon"]["state"] == "records_disagree"
    assert p["recon"]["assessed"] == 1200
    assert 2450 <= p["recon"]["mapped"] <= 2550
    assert 2.0 <= p["recon"]["ratio"] <= 2.2
    assert p["deed"]["plan_lot"] == "64" and p["deed"]["part"] is True
    assert p["built"] is True
    assert "centroid in lot" in p["built_basis"] and "YEARBLT 1910" in p["built_basis"]


def test_lot_25_ok(by_pin):
    p = by_pin["0010K00025000000"]
    assert p["lot"] == 25 and p["lot_suffix"] is None
    assert p["addr"] == "2241 Mahon St" and p["addr_source"] == "city_owned"
    assert p["addr_street"] == "Mahon Street"
    assert p["recon"]["state"] == "ok"
    assert p["recon"]["assessed"] == 2400 and p["recon"]["deed_area"] == 2400
    assert abs(p["recon"]["mapped"] - 2287) / 2287 < 0.01
    assert 0.94 <= p["recon"]["ratio"] <= 0.96
    assert p["deed"] == {"plan": "Robt Robb Plan", "plan_lot": "67", "part": False, "front": 24, "depth": 100,
                         "depth_avg": False, "dims": "24X100", "parsed_from": "LEGAL1"}
    assert p["city"]["status"] == "Available for Sale"
    assert p["city"]["status_updated"] == "2016-11-17"
    assert p["zone"] == "RM-M" and p["zone_frac"] == 1.0
    assert p["overlays"] == ["RCO - Hill CDC & Hill DC & Hill DCG"]
    assert p["built"] is False and p["building_ids"] == []


def test_lot_27_plan_lot_blank(by_pin):
    p = by_pin["0010K00027000000"]
    assert p["deed"]["plan_lot"] is None
    assert p["deed"]["plan"] is None
    assert (p["deed"]["front"], p["deed"]["depth"]) == (24, 100)


def test_lot_28_split_24x62(by_pin):
    p = by_pin["0010K00028000000"]
    assert (p["deed"]["front"], p["deed"]["depth"]) == (24, 62)
    assert p["deed"]["plan_lot"] == "70"
    a = by_pin["0010K00028000A00"]
    assert a["lot"] == 28 and a["lot_suffix"] == "A"
    assert (a["deed"]["front"], a["deed"]["depth"]) == (24, 38)


def test_recon_rule_matches_tolerance(block):
    tol = block["meta"]["recon_tolerance"]
    for p in block["parcels"]:
        r = p["recon"]
        if r["assessed"]:
            ratio = r["mapped"] / r["assessed"]
            if abs(ratio - 1) > tol + 1e-3:
                assert r["state"] == "records_disagree", p["pin"]
            elif abs(ratio - 1) < tol - 1e-3:
                assert r["state"] in ("ok", "no_deed"), p["pin"]


def test_mahon_lots_sit_above_mahon_street(block):
    row = main_street_row(block)
    mahon = [LineString(s["line"]) for s in block["streets"] if s["name"] == "Mahon Street"]
    assert mahon
    street_y = min(y for ls in mahon for _, y in ls.coords)
    lots_y = max(Polygon(p["poly"][0]).bounds[3] for p in block["parcels"] if p["pin"] in row)
    assert street_y > lots_y


def test_frontage_is_horizontal(by_pin):
    # the Mahon edge of lot 25 (largest y) should be level within 0.1 ft over ~23 ft
    ring = by_pin["0010K00025000000"]["poly"][0]
    ys = sorted(y for _, y in ring[:-1])
    assert abs(ys[-1] - ys[-2]) < 0.1


def test_counts_note_claims(block, by_pin):
    """Each claim in meta.counts_note, checked against the parcels."""
    ps = block["parcels"]
    lots_21_34 = [p for p in ps if 21 <= p["lot"] <= 34]
    assert len(lots_21_34) == 15
    assert sorted(p["lot_suffix"] or "" for p in lots_21_34 if p["lot"] == 28) == ["", "A"]
    plan_lots = {p["lot"]: p["deed"]["plan_lot"] for p in lots_21_34}
    assert plan_lots[27] is None
    stated = sorted({int(v) for v in plan_lots.values() if v is not None})
    assert stated == [n for n in range(63, 77) if n != 69]
    assert "Agnes M Mahon" in by_pin["0010K00024000000"]["deed"]["plan"]
    others = [p["deed"]["plan"] for p in lots_21_34 if p["lot"] not in (24, 27)]
    assert all("Robb" in pl for pl in others)
    l35 = [p for p in ps if p["lot"] == 35]
    assert len(l35) == 2 and all(p["deed"]["plan"] == "Mahon Plan" and p["deed"]["plan_lot"] == "77" for p in l35)
    row = main_street_row(block)
    main = [p for p in ps if p["pin"] in row]
    other = [p for p in ps if p["pin"] not in row]
    assert len(main) == 23 and min(p["lot"] for p in main) == 21 and max(p["lot"] for p in main) == 44
    assert len(other) == 16 and min(p["lot"] for p in other) == 60 and max(p["lot"] for p in other) == 83
    assert len(ps) == 39
    note = block["meta"]["counts_note"]
    for s in ("63-76", "21-34", "15 parcels", "23 parcels", "16 parcels", "39 parcels", "Agnes M Mahon"):
        assert s in note


def test_buildings_link_to_lots(block, by_pin):
    for b in block["buildings"]:
        assert b["lot_pin"] in by_pin
        assert b["id"] in by_pin[b["lot_pin"]]["building_ids"]
        assert b["material"] == (by_pin[b["lot_pin"]]["assess"] or {}).get("finish")


def test_hist_zoning(block):
    assert block["hist_zoning"] == {"1927": "Commercial U3.H2.A4", "1958": "R4", "1967": "R4"}
