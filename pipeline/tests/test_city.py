"""Citywide outputs: committed outlines always; the gitignored work file when present."""
import json
from pathlib import Path

import pytest
from shapely.geometry import Polygon

REPO = Path(__file__).resolve().parents[2]
WORK = REPO / "data" / "city" / "work" / "lots_work.json"


def test_neighborhoods_shape_and_size():
    p = REPO / "data" / "city" / "neighborhoods.json"
    assert p.stat().st_size < 1_500_000
    hoods = json.loads(p.read_text())
    assert isinstance(hoods, list) and len(hoods) == 90
    names = {h["name"] for h in hoods}
    assert {"Larimer", "Middle Hill", "Garfield"} <= names
    for h in hoods:
        assert h["rings"] and all(r[0] == r[-1] and len(r) >= 4 for r in h["rings"])


def test_water_shape():
    w = json.loads((REPO / "data" / "city" / "water.json").read_text())
    assert {x["name"] for x in w} == {"Allegheny River", "Monongahela River", "Ohio River"}


@pytest.fixture(scope="module")
def work():
    if not WORK.exists():
        pytest.skip("data/city/work/lots_work.json not built on this machine (gitignored); run `python -m pipeline city`")
    return json.loads(WORK.read_text())


def test_work_counts_add_up(work):
    c = work["meta"]["counts"]
    assert c["written"] + c["skipped"] == c["vacant_land_rows"]
    assert c["written"] == len(work["lots"])
    assert len(work["meta"]["skipped"]) == c["skipped"]
    assert all(s["reason"] for s in work["meta"]["skipped"])
    pins = [l["pin"] for l in work["lots"]]
    assert pins == sorted(pins) and len(set(pins)) == len(pins)


def test_work_lot_511_lowell(work):
    lot = next(l for l in work["lots"] if l["pin"] == "0124P00203000000")
    assert lot["addr"] == "511 Lowell St" and lot["addr_street"] == "Lowell Street"
    assert lot["zone"] == "R1D-H" and lot["hood"] == "Larimer" and lot["ward"] == 12
    assert lot["deed"]["front"] == 24 and lot["deed"]["depth"] == 100
    assert abs(lot["mapped_area"] - 2390) < 10
    nb = {n["pin"]: n for n in lot["neighbors"]}
    assert nb["0124P00204000000"]["built"] is True and nb["0124P00202000000"]["built"] is False
    assert any(s["name"] == "Lowell Street" for s in lot["streets"])


def test_work_rings_closed_and_valid(work):
    for lot in work["lots"][::50]:
        assert lot["poly"][0] == lot["poly"][-1]
        assert Polygon(lot["poly"]).is_valid
        assert lot["outline_ll"][0] == lot["outline_ll"][-1]
        for n in lot["neighbors"]:
            assert n["poly"][0] == n["poly"][-1]
