"""Tonight's shortlist: the due-diligence agent in bulk, over every City-owned vacant lot, and the lots it leaves.

  uv run python -m agents.shortlist            sweep all 11,247 lots, write data/shortlist/{latest,sweep,history}.json
  uv run python -m agents.shortlist --dry      sweep and print; write nothing

Each WPRDC dataset is pulled once per run: POST batches of 500 PINs with the same field whitelists as the case files
(agents/sources.py), so no owner, contractor, lien assignee or case owner is ever requested; the condemned list is
pulled whole (3,569 rows) and joined here. Slope and the undermined share come from data/city/lots.json (the City's
layers, per lot). 311 is checked for the shortlisted lots only, by street: it doesn't decide the shortlist. No model:
the sweep is a fixed plan and deterministic; it costs nothing but the requests.

The shortlist (DEFINITION, kept in the output): the engine's reading, not a model's. City-owned vacant lots in the
districts a person has signed where a two-unit house fits today, listed for sale or not, that passed the zoning and
records checks (the four risk checks). Site conditions and money still need review. Slope is shown, not excluded; steepest last.
"""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import json
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Callable

from pipeline.fetch import REPO

from . import engine
from .sources import CKAN, DATASETS, NAME_LIKE, now_utc, scrub

OUT = REPO / "data" / "shortlist"
RAW = REPO / "data" / "raw" / "shortlist"  # gitignored: the whitelisted responses, for re-checking a run
BATCH = 500
CLOSED = {"Closed", "Clean & Lien"}  # a case the City has closed, or cleaned and liened (resolved)
HISTORY_KEEP = 14

DEFINITION = {
    "building": "two",
    "text": ("City-owned vacant lots in the districts a person has signed where a two-unit house fits today (the engine's "
             "reading, listed for sale or not) that passed the zoning and records checks: no open code-enforcement case (any "
             "status other than Closed or Clean & Lien), not on the condemned or dead-end list, no unsatisfied tax lien, and no "
             "overlap with the City's mapped undermined areas. Slope is shown, not excluded (steepest last). Site conditions, "
             "water and sewer, and money still need review."),
    "risk_checks": ["violations (open)", "condemned", "liens (unsatisfied)", "undermining"],
    "shown": ["permits", "slope", "311 (shortlisted lots only)"],
}

Post = Callable[[str, bytes], bytes]


def http_post(url: str, body: bytes) -> bytes:
    import requests

    from pipeline.fetch import USER_AGENT

    r = requests.post(url, data=body, headers={"Content-Type": "application/json", "User-Agent": USER_AGENT}, timeout=180)
    if r.status_code != 200:
        raise RuntimeError(f"HTTP {r.status_code}")
    return r.content


def pull_bulk(key: str, pins: list[str] | None, post: Post, run: str, save: bool) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Every record of one dataset for these PINs (or the whole dataset when pins is None), whitelisted fields only."""
    d = DATASETS[key]
    assert not any(NAME_LIKE.search(f) for f in d.fields), key
    recs: list[dict[str, Any]] = []
    bodies = hashlib.sha256()
    asks = hashlib.sha256()
    calls = 0
    groups = [pins[i : i + BATCH] for i in range(0, len(pins), BATCH)] if pins is not None else [None]
    for gi, g in enumerate(groups):
        offset = 0
        while True:
            q: dict[str, Any] = {"resource_id": d.resource, "fields": list(d.fields), "limit": 32000, "offset": offset}
            if g is not None:
                q["filters"] = {d.parcel_field: g}
            ask = json.dumps(q, sort_keys=True).encode()
            body = post(CKAN, ask)
            calls += 1
            asks.update(ask)
            bodies.update(body)
            if save:
                RAW.mkdir(parents=True, exist_ok=True)
                (RAW / f"{run}-{key}-{gi:03d}-{offset}.json").write_bytes(body)
            j = json.loads(body)
            if not j.get("success"):
                raise RuntimeError(f"{key}: CKAN answered success: false")
            res = j["result"]
            got = [scrub(r, d.fields) for r in res.get("records", [])]
            recs += got
            offset += len(got)
            if not got or offset >= int(res.get("total", 0)):
                break
    src = {"dataset": d.title, "page": d.page, "resource": d.resource, "url": CKAN, "method": "POST", "fields": list(d.fields),
           "requests": calls, "rows": len(recs), "pulled_at": now_utc(), "sha256": bodies.hexdigest(), "requests_sha256": asks.hexdigest(),
           "by": f"{BATCH} PINs a request" if pins is not None else "the whole list, joined here"}
    return recs, src


def summarize(lots: list[dict[str, Any]], permits, violations, condemned, liens) -> dict[str, dict[str, Any]]:
    per: dict[str, dict[str, Any]] = {l["pin"]: {"permits": 0, "permit_last": None, "cases": set(), "open": set(), "case_last": None, "condemned": False,
                                                 "liens_open": 0, "liens_total": 0.0, "lien_years": []} for l in lots}
    for r in permits:
        p = per.get(r.get("parcel_num"))
        if p is not None:
            p["permits"] += 1
            p["permit_last"] = max(filter(None, [p["permit_last"], str(r.get("issue_date") or "")[:10]]), default=None)
    for r in violations:
        p = per.get(r.get("parcel_id"))
        if p is None:
            continue
        p["cases"].add(r.get("casefile_number"))
        if r.get("status") not in CLOSED:
            p["open"].add(r.get("casefile_number"))
        if r.get("investigation_date"):
            p["case_last"] = max(filter(None, [p["case_last"], str(r["investigation_date"])[:10]]))
    for r in condemned:
        p = per.get(r.get("parcel_id"))
        if p is not None:
            p["condemned"] = True
    for r in liens:
        p = per.get(r.get("pin"))
        if p is not None and not r.get("satisfied"):
            p["liens_open"] += 1
            p["liens_total"] += float(r.get("amount") or 0)
            if r.get("tax_year"):
                p["lien_years"].append(int(r["tax_year"]))
    return per


def checks_of(lot: dict[str, Any], s: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """The same finding kinds as a case file, each nothing or found, with its one fact."""
    uf, sf = float(lot.get("undermined") or 0), float(lot.get("slope25") or 0)
    # Any share counts (the definition: none of the lot); a sliver under 0.5% shows as "<1%".
    und = max(1, round(uf * 100)) if uf > 0 else 0
    slope = max(1, round(sf * 100)) if sf > 0 else 0
    yrs = s["lien_years"]
    return {
        "permits": {"status": "found" if s["permits"] else "nothing", "fact": f"{s['permits']} on record" if s["permits"] else "none"},
        "violations": {"status": "found" if s["cases"] else "nothing", "open": len(s["open"]), "cases": len(s["cases"]),
                       "fact": (f"{len(s['open'])} open of {len(s['cases'])}" if s["open"] else f"{len(s['cases'])} closed") if s["cases"] else "no case"},
        "condemned": {"status": "found" if s["condemned"] else "nothing", "fact": "on the list" if s["condemned"] else "not listed"},
        "liens": {"status": "found" if s["liens_open"] else "nothing", "open": s["liens_open"], "total": round(s["liens_total"], 2),
                  "fact": f"{s['liens_open']} unsatisfied · ${s['liens_total']:,.0f}" + (f" · {min(yrs)}–{max(yrs)}" if yrs else "") if s["liens_open"] else "none open"},
        "undermining": {"status": "found" if und else "nothing", "percent": und, "fact": (f"{und}% overlaps mapped mines" if uf >= 0.005 else "<1% overlaps mapped mines") if und else "no overlap with mapped mines"},
        "slope": {"status": "found" if slope else "nothing", "percent": slope, "fact": (f"{slope}% of lot mapped ≥25% slope" if sf >= 0.005 else "<1% of lot mapped ≥25% slope") if slope else "none mapped ≥25% slope"},
    }


def risky(c: dict[str, dict[str, Any]]) -> list[str]:
    out = []
    if c["violations"]["open"]:
        out.append("violations")
    if c["condemned"]["status"] == "found":
        out.append("condemned")
    if c["liens"]["open"]:
        out.append("liens")
    if c["undermining"]["percent"]:
        out.append("undermining")
    return out


def street_311(short: list[dict[str, Any]], post_get: Callable[[str], bytes]) -> tuple[dict[str, dict[str, Any]], list[dict[str, Any]]]:
    """311 near each shortlisted lot: one pull per neighbourhood and street, then by distance (about 80 m)."""
    from .sources import pull

    groups: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for l in short:
        a = l["address"].upper().split()
        street = " ".join(a[1:]) if a and a[0][:1].isdigit() else " ".join(a)
        groups[(l["hood"], street)].append(l)
    out: dict[str, dict[str, Any]] = {}
    srcs = []
    for (hood, street), ls in groups.items():
        try:
            got, recs, _ = pull(DATASETS["311"], {"neighborhood": hood, "street": street}, post_get, sort="created_date_et desc")
        except Exception as e:  # noqa: BLE001 - a street that can't be checked says so
            for l in ls:
                out[l["pin"]] = {"status": "couldnt", "fact": f"couldn't check ({type(e).__name__})"}
            continue
        srcs.append({**got.source(), "street": street, "hood": hood})
        for l in ls:
            lon, lat = l["ll"]
            near = [r for r in recs if r.get("latitude") and abs(float(r["latitude"]) - lat) < 0.0008 and abs(float(r["longitude"]) - lon) < 0.001]
            out[l["pin"]] = {"status": "found" if near else "nothing", "near": len(near), "fact": f"{len(near)} requests nearby" if near else "none nearby", "source_sha256": got.sha256}
    return out, srcs


def run(post: Post = http_post, get: Callable[[str], bytes] | None = None, candidates: dict[str, Any] | None = None, lots: list[dict[str, Any]] | None = None,
        write: bool = True, with_311: bool = True) -> dict[str, Any]:
    from .sources import http_get

    t0 = time.monotonic()
    run_id = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    lots = lots if lots is not None else json.loads((REPO / "data" / "city" / "lots.json").read_text())["lots"]
    pins = [l["pin"] for l in lots]
    sources: dict[str, Any] = {}
    permits, sources["permits"] = pull_bulk("permits", pins, post, run_id, write)
    violations, sources["violations"] = pull_bulk("violations", pins, post, run_id, write)
    liens, sources["liens"] = pull_bulk("liens", pins, post, run_id, write)
    condemned, sources["condemned"] = pull_bulk("condemned", None, post, run_id, write)
    per = summarize(lots, permits, violations, condemned, liens)
    checks = {l["pin"]: checks_of(l, per[l["pin"]]) for l in lots}
    # The engine's reading: where a two-unit house fits today (signed districts only).
    cand = candidates or engine.run("shortlist", "-", "--type", DEFINITION["building"])
    short = []
    excluded: dict[str, int] = defaultdict(int)
    for c in cand["candidates"]:
        ch = checks[c["pin"]]
        r = risky(ch)
        for k in r:
            excluded[k] += 1
        if r:
            continue
        short.append({**{k: c[k] for k in ("pin", "address", "district", "hood", "ward", "ll", "for_sale", "status", "verdict", "link")},
                      "slope": ch["slope"]["percent"], "checks": ch})
    short.sort(key=lambda x: (not x["for_sale"], x["slope"], x["address"]))
    srcs_311: list[dict[str, Any]] = []
    if with_311 and short:
        got, srcs_311 = street_311(short, get or http_get)
        for l in short:
            l["checks"]["311"] = got.get(l["pin"], {"status": "couldnt", "fact": "not checked"})
    sources["311"] = {"dataset": DATASETS["311"].title, "page": DATASETS["311"].page, "for": "shortlisted lots only", "pulls": srcs_311}
    any_risk = sum(1 for p in pins if risky(checks[p]))
    counts = {
        "swept": len(pins),
        "fits_today": len(cand["candidates"]),
        "fits_today_for_sale": sum(1 for c in cand["candidates"] if c["for_sale"]),
        "shortlist": len(short),
        "shortlist_for_sale": sum(1 for l in short if l["for_sale"]),
        "shortlist_not_listed": sum(1 for l in short if not l["for_sale"]),
        "excluded_from_fits": dict(excluded),
        "any_risk_finding": any_risk,
        "any_risk_finding_share": round(any_risk / len(pins), 3) if pins else 0,
        "by_check": {k: sum(1 for p in pins if checks[p][k]["status"] == "found") for k in ("permits", "violations", "condemned", "liens", "undermining", "slope")},
        "open_violations": sum(1 for p in pins if checks[p]["violations"]["open"]),
    }
    wall = round(time.monotonic() - t0, 1)
    out = {
        "run_at": now_utc(),
        "definition": DEFINITION,
        "counts": counts,
        "sweep": {"wall_s": wall, "requests": sum(s.get("requests", 0) for s in sources.values() if isinstance(s, dict)) + len(srcs_311),
                  "model": None, "planned_by": "rule, no model", "cost_usd": 0, "note": "public datasets over HTTPS; no model call"},
        "sources": sources,
        "lots": short,
    }
    if write:
        OUT.mkdir(parents=True, exist_ok=True)
        (OUT / "latest.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
        cols = ["permits", "cases", "open_cases", "condemned", "liens_open", "undermined_pct", "slope_pct"]
        compact = {p: [checks[p]["permits"]["status"] == "found" and per[p]["permits"] or 0, checks[p]["violations"]["cases"], checks[p]["violations"]["open"],
                       int(checks[p]["condemned"]["status"] == "found"), checks[p]["liens"]["open"], checks[p]["undermining"]["percent"], checks[p]["slope"]["percent"]] for p in pins}
        (OUT / "sweep.json").write_text(json.dumps({"run_at": out["run_at"], "columns": cols, "sources": {k: v for k, v in sources.items() if k != "311"}, "lots": compact}, separators=(",", ":")) + "\n")
        hist_p = OUT / "history.json"
        hist = json.loads(hist_p.read_text()) if hist_p.exists() else []
        hist.append({"run_at": out["run_at"], "shortlist": [l["pin"] for l in short], "counts": {k: counts[k] for k in ("swept", "fits_today", "shortlist", "shortlist_for_sale", "shortlist_not_listed")}})
        hist_p.write_text(json.dumps(hist[-HISTORY_KEEP:], indent=1) + "\n")
    return out


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m agents.shortlist")
    ap.add_argument("--dry", action="store_true", help="sweep and print; write nothing")
    ap.add_argument("--no-311", action="store_true")
    a = ap.parse_args(argv)
    out = run(write=not a.dry, with_311=not a.no_311)
    c = out["counts"]
    print(f"swept {c['swept']:,} City lots in {out['sweep']['wall_s']} s ({out['sweep']['requests']} requests, no model, $0)")
    print(f"a two-unit house fits today on {c['fits_today']} ({c['fits_today_for_sale']} listed for sale); excluded by: {c['excluded_from_fits']}")
    print(f"shortlist: {c['shortlist']} ({c['shortlist_for_sale']} listed for sale, {c['shortlist_not_listed']} not listed)")
    print(f"any risk finding: {c['any_risk_finding']:,} of {c['swept']:,} ({c['any_risk_finding_share']:.0%}); by check: {c['by_check']}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
