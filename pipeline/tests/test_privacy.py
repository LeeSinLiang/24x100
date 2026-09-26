"""No owner name, mailing address, change notice or tax bill field anywhere in data/blocks or data/money."""
import csv
import io
import json
from pathlib import Path

import pytest

REPO = Path(__file__).resolve().parents[2]
ALLOWED_OWNER_KEYS = {"ownerdesc", "ownercat"}
BANNED_KEY_PARTS = ("propertyowner", "owner", "changenotice", "taxbill", "mailing", "grantor", "grantee",
                    "buyer", "seller")
BANNED_VALUES = {"city of pittsburgh"}  # as an owner value; source names like "City of Pittsburgh PGHParcels" are fine


def violations(obj, path="$"):
    out = []
    if isinstance(obj, dict):
        for k, v in obj.items():
            kl = str(k).lower().replace("_", "")
            if kl not in ALLOWED_OWNER_KEYS and any(b in kl for b in BANNED_KEY_PARTS):
                out.append(f"{path}.{k}: banned key")
            out += violations(v, f"{path}.{k}")
    elif isinstance(obj, list):
        for i, v in enumerate(obj):
            out += violations(v, f"{path}[{i}]")
    elif isinstance(obj, str):
        s = obj.strip().lower()
        if s in BANNED_VALUES:
            out.append(f"{path}: owner-like value {obj!r}")
        for b in ("propertyowner", "changenotice", "taxbill", "mailing"):
            if b in s.replace("_", "").replace(" ", ""):
                out.append(f"{path}: banned field name in value {obj!r}")
    return out


def data_files():
    files = sorted((REPO / "data" / "blocks").glob("*.json")) + sorted((REPO / "data" / "money").glob("*.json"))
    files += sorted((REPO / "data" / "city").glob("*.json")) + sorted((REPO / "data" / "city" / "work").glob("*.json"))
    files += sorted((REPO / "data" / "refresh").glob("*.json"))
    files += [p for p in [REPO / "data" / "watchlist.json"] if p.exists()]
    files += sorted((REPO / "pipeline" / "tests" / "fixtures").glob("*.json"))
    return files


def test_there_are_files_to_check():
    names = {p.name for p in data_files()}
    assert {"10K.json", "0124P.json", "comps_ward5.json", "neighborhoods.json", "water.json"} <= names


@pytest.mark.parametrize("path", data_files(), ids=lambda p: p.name)
def test_no_personal_fields(path):
    v = violations(json.loads(path.read_text()))
    assert v == [], v[:10]


def test_checker_catches_mutations():
    # the guard must actually fire on the things it guards
    assert violations({"PROPERTYOWNER": "x"})
    assert violations({"a": [{"owner": "x"}]})
    assert violations({"CHANGENOTICEADDRESS1": "x"})
    assert violations({"TAXBILLADDRESS2": "x"})
    assert violations({"mailing_address": "x"})
    assert violations({"city": {"owner_name": "City of Pittsburgh"}})
    assert violations({"x": "CITY OF PITTSBURGH"})
    assert not violations({"ownercat": "CORPORATION", "OWNERDESC": "CORPORATION",
                           "name": "City of Pittsburgh PGHParcels"})


def test_digest_preview_has_no_names():
    p = REPO / "data" / "refresh" / "digest-preview.md"
    if not p.exists():
        pytest.skip("no digest preview yet")
    t = p.read_text().lower()
    assert "owner" not in t and "mailing" not in t and "city of pittsburgh" not in t


def test_raw_city_owned_cache_has_no_owner_column():
    raw = REPO / "data" / "raw"
    csvs = sorted(raw.glob("*/city_owned.csv")) if raw.exists() else []
    if not csvs:
        pytest.skip("no raw cache on this machine (data/raw is gitignored)")
    for p in csvs:
        header = next(csv.reader(io.StringIO(p.read_text().split("\n", 1)[0])))
        assert "owner" not in header, p
