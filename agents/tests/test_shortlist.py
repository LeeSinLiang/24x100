"""The shortlist sweep with no network: a fake CKAN that answers POSTs (and ignores `fields`, so scrub() must work), and
engine candidates given directly."""
import json

from agents import shortlist as SL
from agents.sources import DATASETS, NAME_LIKE

LOTS = [
    {"pin": "A", "addr": "1 Clean St", "hood": "H", "ll": [-80.0, 40.4], "slope25": 0.3, "undermined": 0},
    {"pin": "B", "addr": "2 Lien St", "hood": "H", "ll": [-80.0, 40.4], "slope25": 0, "undermined": 0},
    {"pin": "C", "addr": "3 Mine St", "hood": "H", "ll": [-80.0, 40.4], "slope25": 0, "undermined": 0.002},
    {"pin": "D", "addr": "4 Case St", "hood": "H", "ll": [-80.0, 40.4], "slope25": 0, "undermined": 0},
    {"pin": "E", "addr": "5 Fine St", "hood": "H", "ll": [-80.0, 40.4], "slope25": 0, "undermined": 0},
]
CAND = {"candidates": [dict(pin=p, address=f"{p} St", district="RM-M", hood="H", ward=1, ll=[-80.0, 40.4], for_sale=fs, status="x", verdict={}, link="?")
                       for p, fs in [("A", True), ("B", True), ("C", False), ("D", False), ("E", False)]]}


def fake_ckan(seen):
    def post(url, body):
        q = json.loads(body)
        seen.append(q)
        res = q["resource_id"]
        pins = (q.get("filters") or {}).get(next(iter(q.get("filters") or {"x": 0})), [])
        recs = []
        if res == DATASETS["liens"].resource:
            recs = [{"pin": "B", "tax_year": 1999, "amount": 120.5, "satisfied": False, "assignee": "A PERSON"},
                    {"pin": "A", "tax_year": 1998, "amount": 10, "satisfied": True}]
        elif res == DATASETS["violations"].resource:
            recs = [{"parcel_id": "D", "casefile_number": "CF-1", "status": "Under Investigation", "investigation_date": "2025-01-01", "investigation_findings": "free text"},
                    {"parcel_id": "E", "casefile_number": "CF-2", "status": "Clean & Lien", "investigation_date": "2022-01-01"}]
        elif res == DATASETS["condemned"].resource:
            recs = [{"parcel_id": "Z", "property_type": "Condemned/Dead End Property", "owner": "A PERSON"}]
        recs = [r for r in recs if not pins or r.get("pin", r.get("parcel_id")) in pins]
        return json.dumps({"success": True, "result": {"records": recs, "total": len(recs)}}).encode()
    return post


def test_the_shortlist_is_the_fits_with_nothing_against_them():
    seen = []
    out = SL.run(post=fake_ckan(seen), candidates=CAND, lots=LOTS, write=False, with_311=False)
    assert [l["pin"] for l in out["lots"]] == ["A", "E"]  # for sale first; E's case is Clean & Lien (resolved)
    ex = out["counts"]["excluded_from_fits"]
    assert ex == {"liens": 1, "undermining": 1, "violations": 1}  # C: a 0.2% sliver still counts as undermined
    assert out["counts"]["shortlist_for_sale"] == 1 and out["counts"]["shortlist_not_listed"] == 1
    assert out["lots"][0]["checks"]["liens"]["status"] == "nothing"  # A's only lien is satisfied
    assert out["sweep"]["model"] is None and out["sweep"]["cost_usd"] == 0


def test_every_request_asks_only_for_whitelisted_fields_and_nothing_name_like_is_kept():
    seen = []
    out = SL.run(post=fake_ckan(seen), candidates=CAND, lots=LOTS, write=False, with_311=False)
    assert seen and all(not any(NAME_LIKE.search(f) for f in q["fields"]) for q in seen)
    text = json.dumps(out)
    assert "A PERSON" not in text and "free text" not in text and "assignee" not in text


def test_batches_of_500_pins_and_the_condemned_list_whole():
    seen = []
    lots = [{"pin": f"P{i:05d}", "addr": "1 X St", "hood": "H", "ll": [0, 0], "slope25": 0, "undermined": 0} for i in range(1234)]
    SL.run(post=fake_ckan(seen), candidates={"candidates": []}, lots=lots, write=False, with_311=False)
    per = {}
    for q in seen:
        per.setdefault(q["resource_id"], []).append(len(next(iter(q["filters"].values()))) if q.get("filters") else None)
    assert per[DATASETS["permits"].resource] == [500, 500, 234]
    assert per[DATASETS["condemned"].resource] == [None]


def test_the_definition_travels_with_the_output():
    out = SL.run(post=fake_ckan([]), candidates=CAND, lots=LOTS, write=False, with_311=False)
    assert "two-unit house fits today" in out["definition"]["text"] and "passed the zoning and records checks" in out["definition"]["text"] and "Slope is shown, not excluded" in out["definition"]["text"]
