"""The public datasets the due-diligence agent reads, each with a field whitelist.

Only the listed fields are ever requested (CKAN `fields=`), so an owner's name, a contractor, a lien assignee or a
311 case owner never reaches this machine. `scrub` drops anything outside the whitelist again before a record is
kept, and `NAME_LIKE` is the pattern a test holds every case file to.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import re
import urllib.parse
from dataclasses import dataclass, field
from typing import Any, Callable

CKAN = "https://data.wprdc.org/api/3/action/datastore_search"

# A field (or key) that could carry a person's name or mailing address. Nothing matching it is requested or kept.
NAME_LIKE = re.compile(r"owner|name|contractor|assignee|mailing|taxbill|changenotice|party|plaintiff|defendant|applicant", re.I)


@dataclass(frozen=True)
class Dataset:
    key: str
    title: str
    resource: str
    page: str
    fields: tuple[str, ...]
    by: str  # "parcel": filter on the parcel field; "street": neighbourhood + street, then distance
    parcel_field: str | None = None
    office: str = ""  # who to ask when it can't be checked
    excluded: tuple[str, ...] = field(default_factory=tuple)  # fields that exist and are never requested (documented)


DATASETS: dict[str, Dataset] = {
    "permits": Dataset(
        "permits", "PLI Permits (City of Pittsburgh)", "f4d1177a-f597-4c32-8cbf-7885f56253f6", "https://data.wprdc.org/dataset/pli-permits",
        ("permit_id", "permit_type", "work_type", "commercial_or_residential", "total_project_value", "issue_date", "status", "parcel_num"),
        "parcel", "parcel_num", "the Department of Permits, Licenses and Inspections (PLI)",
        excluded=("owner_name", "contractor_name", "work_description"),
    ),
    "violations": Dataset(
        "violations", "PLI/DOMI/ES Violations (City of Pittsburgh)", "70c06278-92c5-4040-ab28-17671866f81c", "https://data.wprdc.org/dataset/pittsburgh-pli-violations-report",
        ("casefile_number", "status", "case_file_type", "investigation_date", "investigation_outcome", "violation_code_section", "violation_code_section_title", "parcel_id"),
        "parcel", "parcel_id", "PLI (code enforcement)",
        excluded=("investigation_findings", "violation_description", "violation_spec_instructions", "docket_number"),
    ),
    "condemned": Dataset(
        "condemned", "Condemned and Dead-End Properties (City of Pittsburgh)", "0a963f26-eb4b-4325-bbbc-3ddf6a871410", "https://data.wprdc.org/dataset/condemned-properties",
        ("parcel_id", "property_type", "create_date", "latest_inspection_result", "inspection_status", "record_number"),
        "parcel", "parcel_id", "PLI (condemnations)",
        excluded=("owner",),
    ),
    "liens": Dataset(
        "liens", "Allegheny County Tax Liens, current status", "65d0d259-3e58-49d3-bebb-80dc75f61245", "https://data.wprdc.org/dataset/allegheny-county-tax-liens-filed-and-satisfied",
        ("pin", "filing_date", "tax_year", "lien_description", "amount", "satisfied"),
        "parcel", "pin", "the Allegheny County Department of Court Records",
        excluded=("assignee", "last_docket_entry", "dtd"),
    ),
    "311": Dataset(
        "311", "Pittsburgh 311 requests", "5202679a-d243-402e-b82a-63189995a942", "https://data.wprdc.org/dataset/pittsburgh-311-data",
        ("case_number", "status", "subject", "created_date_et", "street", "latitude", "longitude"),
        "street", None, "the City's 311 office",
        excluded=("case_owner",),
    ),
}


def assert_whitelist() -> None:
    """Every requested field is clear of the name pattern (a guard the tests run too)."""
    for d in DATASETS.values():
        bad = [f for f in d.fields if NAME_LIKE.search(f)]
        if bad:
            raise ValueError(f"{d.key}: name-like fields requested: {bad}")


def scrub(record: dict[str, Any], allowed: tuple[str, ...]) -> dict[str, Any]:
    return {k: v for k, v in record.items() if k in allowed and not NAME_LIKE.search(k)}


def now_utc() -> str:
    return dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


@dataclass
class Pulled:
    url: str
    pulled_at: str
    sha256: str
    body: bytes

    def source(self) -> dict[str, str]:
        return {"url": self.url, "pulled_at": self.pulled_at, "sha256": self.sha256}


Http = Callable[[str], bytes]


def http_get(url: str) -> bytes:
    import requests

    from pipeline.fetch import USER_AGENT

    r = requests.get(url, timeout=60, headers={"User-Agent": USER_AGENT})
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.content


def query_url(d: Dataset, filters: dict[str, Any], limit: int = 200, sort: str | None = None) -> str:
    p: dict[str, Any] = {"resource_id": d.resource, "fields": ",".join(d.fields), "filters": json.dumps(filters), "limit": limit}
    if sort:
        p["sort"] = sort
    return f"{CKAN}?{urllib.parse.urlencode(p)}"


def pull(d: Dataset, filters: dict[str, Any], http: Http, sort: str | None = None) -> tuple[Pulled, list[dict[str, Any]], int]:
    url = query_url(d, filters, sort=sort)
    body = http(url)
    j = json.loads(body)
    if not j.get("success"):
        raise RuntimeError("CKAN answered success: false")
    res = j["result"]
    recs = [scrub(r, d.fields) for r in res.get("records", [])]
    return Pulled(url, now_utc(), hashlib.sha256(body).hexdigest(), body), recs, int(res.get("total", len(recs)))
