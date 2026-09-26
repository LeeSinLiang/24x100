"""Held-out block 0124-P (Larimer, R1D-H): checks on the committed data/blocks/0124P.json."""
import json
from pathlib import Path

import pytest
from shapely.geometry import LineString, Polygon

REPO = Path(__file__).resolve().parents[2]
BLOCK = REPO / "data" / "blocks" / "0124P.json"
DEMO = "0124P00203000000"  # 511 Lowell St


@pytest.fixture(scope="module")
def block():
    return json.loads(BLOCK.read_text())


@pytest.fixture(scope="module")
def by_pin(block):
    return {p["pin"]: p for p in block["parcels"]}


def test_meta(block):
    m = block["meta"]
    assert m["id"] == "0124P" and m["neighborhood"] == "Larimer" and m["ward"] == 12
    assert m["main_street"] == "Lowell Street"
    assert m["main_street_basis"].startswith("8 of 23 parcels are addressed on Lowell Street")
    assert m["selection"].startswith("explicit PIN list")
    assert m["selection_check"]["matches_explicit_list"] is True
    assert m["selection_check"]["other_prefix_pins_in_polygon"] == []


def test_all_r1d_h(block):
    assert len(block["parcels"]) == 23
    assert all(p["pin"].startswith("0124P") for p in block["parcels"])
    assert {p["zone"] for p in block["parcels"]} == {"R1D-H"}
    assert all(p["zone_frac"] >= 0.99 for p in block["parcels"])


def test_city_owned_vacant_lots_exist(block):
    city_vacant = [p for p in block["parcels"] if p["city"] and p["city"]["class"] == "Vacant Land"]
    assert len(city_vacant) == 11


def test_demo_lot_511_lowell(by_pin):
    p = by_pin[DEMO]
    assert p["addr"] == "511 Lowell St" and p["addr_source"] == "city_owned"
    assert p["addr_street"] == "Lowell Street"
    assert p["city"]["status"] == "Available for Sale" and p["city"]["class"] == "Vacant Land"
    assert p["zone"] == "R1D-H"
    assert p["built"] is False
    assert p["deed"]["front"] == 24 and p["deed"]["depth"] == 100 and p["deed"]["plan_lot"] == "45"
    assert p["recon"]["state"] == "ok" and p["recon"]["assessed"] == 2400
    assert abs(p["recon"]["ratio"] - 0.996) < 0.002


def test_recon_states(by_pin):
    assert by_pin["0124P00202000000"]["recon"]["state"] == "records_disagree"  # 509 Lowell, 1,550 vs 2,382
    assert by_pin["0124P00204000000"]["built"] is True  # 513 Lowell, single family
    states = {}
    for p in by_pin.values():
        states[p["recon"]["state"]] = states.get(p["recon"]["state"], 0) + 1
    assert states == {"ok": 14, "records_disagree": 7, "no_deed": 2}


def test_cut_legal1_has_no_deed_and_a_note(block):
    cut = [p for p in block["parcels"] if "deed_note" in p]
    assert len(cut) == 5 and all(p["deed"] is None for p in cut)


def test_lowell_lots_sit_above_lowell_street(block):
    low = [LineString(s["line"]) for s in block["streets"] if s["name"] == "Lowell Street"]
    street_y = min(y for ls in low for _, y in ls.coords)
    lots_y = max(Polygon(p["poly"][0]).bounds[3] for p in block["parcels"] if p["addr_street"] == "Lowell Street")
    assert street_y > lots_y
