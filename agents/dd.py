"""Due diligence: the free public checks a lot needs before anyone spends money, each run with a real tool against public
data and written as a finding with its source (URL, pull time, sha256 of what came back), or "couldn't check: ask …".

The model (when there is one) picks which checks apply and says why; the tools run them; the finding's words are
fixed templates filled from the records, so every number in them comes from a record or from code that counts records
(`derived`, with its formula). Paid studies (a Phase I, a survey, a geotechnical report) are never marked done: a
request is drafted and a spend gate waits for a person.
"""
from __future__ import annotations

import hashlib
from collections import Counter
from pathlib import Path
from typing import Any

from .model import why as _why
from pydantic import BaseModel, Field

from pipeline.fetch import REPO

from .case import CASES, Case
from .sources import DATASETS, Http, http_get, now_utc, pull

FREE = {
    "permits": "PLI permits on this parcel: a recent permit means work, or a building, is coming",
    "violations": "code-enforcement case files on this parcel (weeds, debris, dangerous structures)",
    "condemned": "whether the parcel is on the City's condemned or dead-end list",
    "liens": "unsatisfied tax liens on this parcel (they follow the land)",
    "311": "311 requests on the street near the lot (dumping, drainage, road work)",
    "undermining": "the City's undermined-areas layer (old mines under the lot)",
    "slope": "the City's 25%+ slope layer (grading and retaining walls cost)",
}
PAID = {
    "phase1": ("a Phase I Environmental Site Assessment", "an environmental consultant", "what the land was used for, and whether anything was left in the ground"),
    "survey": ("a boundary survey", "a licensed surveyor", "where the lot lines and any encroachments really are (the parcel shapes come from GIS)"),
    "geotech": ("a geotechnical report", "a geotechnical engineer", "what the soil, fill and slope will bear"),
}


class Picks(BaseModel):
    checks: list[str] = Field(description="the free checks that apply, by key")
    why: dict[str, str] = Field(description="one short reason per picked check")
    skipped: dict[str, str] = Field(default_factory=dict, description="each free check left out, with why it cannot apply")
    paid: list[str] = Field(description="the paid studies worth drafting a request for, by key")


def pick(model: Any, reading: dict[str, Any], case: Case) -> tuple[list[str], list[str]]:
    lot = reading["lot"]
    if model is None:
        case.step("due-diligence", "plan", "Planned by rule, no model: every free check applies to a vacant lot; the paid studies are drafted, not run.",
                  input={"checks": list(FREE), "paid": list(PAID)})
        return list(FREE), list(PAID)
    system = ("You are the due-diligence agent of 24x100, a tool for Pittsburgh's City-owned vacant lots. Pick the free public "
              "checks to run on this lot before anyone spends money: they cost nothing, so leave one out only if it cannot apply, "
              "and say why. Pick which paid studies are worth drafting a request for. Use only the keys given. Never state a number.")
    user = (f"Lot: {lot['addr']} (lot {lot['lot']}, block {lot['block']}, {lot['hood']}), zoned {lot['zone']}, vacant, "
            f"City sale status: {(lot.get('city') or {}).get('status')}. Goal: a {reading['type_name']}.\n"
            f"Free checks: {FREE}\nPaid studies: { {k: v[0] for k, v in PAID.items()} }")
    try:
        p, call = model.ask(Picks, system, user)
    except Exception as e:  # noqa: BLE001 - the plan falls back to the rule, and says why
        case.step("due-diligence", "plan", f"The model didn't answer ({_why(e)}); planned by rule: every free check.", input={"checks": list(FREE)}, ok=False)
        return list(FREE), list(PAID)
    checks = [c for c in (p.checks if p else []) if c in FREE] or list(FREE)
    paid = [c for c in (p.paid if p else []) if c in PAID]
    why = {k: v for k, v in (p.why if p else {}).items() if k in checks}
    skipped = {k: (p.skipped or {}).get(k, "no reason given") for k in FREE if k not in checks} if p else {}
    left = f" (left out: {', '.join(skipped)})" if skipped else ""
    case.step("due-diligence", "plan", f"The model picked the free checks to run{left} and the paid studies to draft.",
              input={"checks": checks, "why": why, "skipped": skipped, "paid": paid, "count": {"picked": len(checks), "free": len(FREE), "paid": len(paid)}}, call=call)
    return checks, paid


def _save_raw(case_id: str, key: str, body: bytes) -> str:
    d = CASES / "raw" / case_id
    d.mkdir(parents=True, exist_ok=True)
    p = d / f"{key}.json"
    p.write_bytes(body)
    return str(p.relative_to(REPO)) if p.is_relative_to(REPO) else str(p)


def _year(s: str | None) -> str:
    return (s or "")[:4]


def check(key: str, reading: dict[str, Any], case: Case, http: Http) -> dict[str, Any]:
    lot = reading["lot"]
    pin = lot["pin"]
    title = FREE[key]
    if key in ("undermining", "slope"):
        f = Path(REPO / "data" / "blocks" / f"{lot['block']}.json")
        body = f.read_bytes()
        src = {"url": "https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/" + ("PGHWebUndermined" if key == "undermining" else "PGHWebSlope25") + "/FeatureServer/0",
               "pulled_at": lot.get("pulled") or "", "sha256": hashlib.sha256(body).hexdigest(), "via": f"data/blocks/{lot['block']}.json"}
        frac = float(lot.get("undermined" if key == "undermining" else "slope25") or 0)
        pct = round(frac * 100)
        layer = "undermined-areas layer (old mines)" if key == "undermining" else "25%+ slope layer (a derived threshold, not the steep-slope overlay)"
        const = {} if key == "undermining" else {"threshold_pct": {"value": 25, "formula": "the City layer's slope threshold (PGHWebSlope25)"}}
        if pct > 0:
            return {"check": key, "title": title, "status": "found", "summary": f"Found: {pct}% of the lot is in the City's {layer}.", "source": src, "records": [], "derived": {**const, "percent": {"value": pct, "formula": f"round({frac} × 100), the share of the lot's area in the layer"}}}
        return {"check": key, "title": title, "status": "nothing", "summary": f"Checked: none of the lot is in the City's {layer}.", "source": src, "records": [], "derived": const}
    d = DATASETS[key]
    try:
        if d.by == "parcel":
            got, recs, total = pull(d, {d.parcel_field: pin}, http)
        else:
            street = " ".join(lot["addr"].upper().split()[1:]) if lot["addr"][:1].isdigit() else lot["addr"].upper()
            got, recs0, _ = pull(d, {"neighborhood": lot["hood"], "street": street}, http, sort="created_date_et desc")
            lat, lon = (lot.get("ll") or [None, None])[1], (lot.get("ll") or [None, None])[0]
            recs = [r for r in recs0 if lat is not None and r.get("latitude") and abs(float(r["latitude"]) - lat) < 0.0008 and abs(float(r["longitude"]) - lon) < 0.001]
            total = len(recs)
    except Exception as e:  # noqa: BLE001 - a check that can't run says so and names who to ask
        return {"check": key, "title": title, "status": "couldnt", "summary": f"Couldn't check ({_why(e)}): ask {d.office}.", "source": None, "records": [], "derived": {}, "ask": d.office}
    raw = _save_raw(case.id, key, got.body)
    src = {**got.source(), "via": raw, "dataset": d.page}
    derived: dict[str, Any] = {"records": {"value": total, "formula": "records the query returned"}}
    if key == "311":
        derived["radius_m"] = {"value": 80, "formula": "the search box around the lot's centre: ±0.0008° latitude, ±0.001° longitude (about 80 m)"}
    if key == "permits":
        if not recs:
            return {"check": key, "title": title, "status": "nothing", "summary": "Checked: no PLI permit on record for this parcel.", "source": src, "records": [], "derived": derived}
        last = max(recs, key=lambda r: r.get("issue_date") or "")
        s = f"Found: {total} permit(s); the latest, {last.get('permit_type')}, issued {str(last.get('issue_date'))[:10]} ({last.get('status')})."
    elif key == "violations":
        if not recs:
            return {"check": key, "title": title, "status": "nothing", "summary": "Checked: no code-enforcement case file on record for this parcel.", "source": src, "records": [], "derived": derived}
        cases = sorted({r["casefile_number"] for r in recs})
        dated = [r for r in recs if r.get("investigation_date")]
        last = max(dated, key=lambda r: r["investigation_date"]) if dated else recs[0]
        first = min((_year(r.get("investigation_date")) for r in dated), default="")
        derived["case_files"] = {"value": len(cases), "formula": "distinct casefile_number"}
        if first:
            derived["first_year"] = {"value": int(first), "formula": "the year of the earliest investigation_date"}
        kinds = Counter(r.get("case_file_type") for r in recs if r.get("investigation_date"))
        s = (f"Found: {len(cases)} code-enforcement case file{'s' if len(cases) != 1 else ''}{f' since {first}' if first else ''} "
             f"({', '.join(f'{k}' for k, _ in kinds.most_common(2))}); the latest, investigated {last.get('investigation_date')}, "
             f"is \"{last.get('status')}\" ({last.get('investigation_outcome')}).")
    elif key == "condemned":
        if not recs:
            return {"check": key, "title": title, "status": "nothing", "summary": "Checked: not on the City's condemned or dead-end list.", "source": src, "records": [], "derived": derived}
        r = recs[0]
        s = f"Found: {r.get('property_type')} since {str(r.get('create_date'))[:10]}; latest inspection: {r.get('latest_inspection_result')} ({r.get('inspection_status')})."
    elif key == "liens":
        open_ = [r for r in recs if not r.get("satisfied")]
        if not open_:
            return {"check": key, "title": title, "status": "nothing", "summary": f"Checked: no unsatisfied tax lien on record for this parcel{f' ({total} satisfied)' if total else ''}.", "source": src, "records": recs[:25], "derived": derived}
        years = sorted(int(r["tax_year"]) for r in open_ if r.get("tax_year"))
        amt = round(sum(float(r.get("amount") or 0) for r in open_), 2)
        derived["unsatisfied"] = {"value": len(open_), "formula": "liens with satisfied = false"}
        derived["unsatisfied_total"] = {"value": amt, "formula": "sum of amount over unsatisfied liens"}
        kinds = sorted({r.get("lien_description") for r in open_})
        s = f"Found: {len(open_)} unsatisfied tax liens (tax years {years[0]}–{years[-1]}), ${amt:,.2f} in all: {', '.join(kinds)}."
        recs = open_
    else:  # 311
        if not recs:
            return {"check": key, "title": title, "status": "nothing", "summary": "Checked: no 311 request within about 80 m of the lot.", "source": src, "records": [], "derived": derived}
        last = recs[0]
        derived["near"] = {"value": total, "formula": "requests on the street within about 80 m of the lot's centre"}
        kinds = Counter(r.get("subject") for r in recs)
        s = f"Found: {total} request{'s' if total != 1 else ''} to 311 within about 80 m ({', '.join(k for k, _ in kinds.most_common(2))}); the latest on {str(last.get('created_date_et'))[:10]}: {last.get('subject')}."
    return {"check": key, "title": title, "status": "found", "summary": s, "source": src, "records": recs[:25], "derived": derived}


def paid_request(key: str, reading: dict[str, Any]) -> dict[str, Any]:
    what, who, why = PAID[key]
    lot = reading["lot"]
    text = (f"Request for a quote: {what} for {lot['addr']} (lot {lot['lot']}, block {lot['block']}, {lot['hood']}), "
            f"a vacant City-owned lot we are screening for a {reading['type_name']}. It would tell us {why}. "
            f"Please send a price and a turnaround time. We have not committed to the purchase.")
    return {"kind": "request", "to": who, "subject": f"Quote request: {what}", "text": text, "by": "rule template", "gate": "spend"}


def run(reading: dict[str, Any], case: Case, model: Any = None, http: Http = http_get) -> list[dict[str, Any]]:
    checks, paid = pick(model, reading, case)
    out = []
    for key in checks:
        f = check(key, reading, case, http)
        out.append(f)
        case.findings.append(f)
        case.step("due-diligence", "tool", f["summary"], tool=f"{'wprdc.datastore_search' if key in DATASETS else 'city.layer'}:{key}",
                  input={"pin": reading["lot"]["pin"]}, sources=[f["source"]] if f.get("source") else [], ok=f["status"] != "couldnt")
    for key in paid:
        what = PAID[key][0]
        f = {"check": key, "title": what[0].upper() + what[1:], "status": "not_done", "summary": f"Paid: not done. {what[0].upper() + what[1:]} costs money; a request is drafted and waits for a person.", "source": None, "records": [], "derived": {}}
        case.findings.append(f)
        d = paid_request(key, reading)
        case.drafts.append(d)
        case.gates.append({"kind": "spend", "what": f"{what[0].upper() + what[1:]}: send the quote request", "status": "waiting"})
        case.step("due-diligence", "draft", f"Drafted a quote request for {what}; not sent (spend gate).", input={"study": key})
    return out


__all__ = ["run", "check", "FREE", "PAID", "now_utc"]
