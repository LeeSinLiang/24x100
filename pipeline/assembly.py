"""Assembly work file (C15): the parcels around each candidate City lot, three neighbour-hops deep.

scripts/build-assemblies.ts looks for runs of two or three contiguous lots on one block face and evaluates
the combined outline with the lot engine. It needs, for every parcel a run could touch, the same facts the
citywide work file carries for a City lot's neighbours (outline, built, address) plus what the engine reads
for a lot in a group: zone, deed (LEGAL1), assessed area, slope and undermining shares, the County owner
type (OWNERDESC) and use (USEDESC), and City-Owned Properties status. Every value comes from the same raw
cache and the same functions as data/city/work/lots_work.json.

No owner names: the raw cache holds no owner-name, mailing-address, change-notice or tax-bill field (see
sources.ASSESSMENT_FIELDS; the City-Owned Properties 'owner' column is dropped before caching and again here).

Writes data/city/work/assembly_work.json (gitignored).
  uv run --offline python -m pipeline.assembly --pins data/city/work/assembly_candidates.json
"""
from __future__ import annotations

import argparse
import csv
import io
import json
import sys
import time
from typing import Any

from shapely import STRtree
from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.geometry.polygon import orient
from shapely.ops import unary_union

from . import sources as S
from .block import built_state, parcel_address, _num_or_none
from .city import NEIGHBOR_FT, STREET_FT, STREET_TYPES_EXCLUDED, WORK, _assessments, _features, _keys, _parcel_geoms, _single_polygon, dumps
from .fetch import RawCache
from .geo import LocalFrame, fix, polygons, r1
from .legal import parse_legal1, pin_lot

OUT = WORK.parent / "assembly_work.json"
HOPS = 3  # a run of three with the candidate at one end touches parcels three hops away


def _ll(v: float) -> float:
    return round(v, 7)


def process_assembly(cache: RawCache, pins: list[str], hops: int = HOPS) -> dict[str, Any]:
    geoms = _parcel_geoms(cache)
    pins_all = sorted(geoms)
    tree = STRtree([geoms[p] for p in pins_all])

    def neighbours(pin: str) -> list[str]:
        """Parcels whose boundary comes within 3 ft (the citywide work file's rule), in the lot's frame."""
        g = geoms[pin]
        part = max(polygons(g), key=lambda p: p.area)
        c = part.centroid
        fr = LocalFrame(_ll(c.y), _ll(c.x), 0.0)
        gl = fr.geom_en(g)
        out = []
        for i in tree.query(box(*g.buffer(0.0001).bounds)):
            n = pins_all[i]
            if n != pin and fr.geom_en(geoms[n]).distance(gl) <= NEIGHBOR_FT:
                out.append(n)
        return sorted(out)

    missing = sorted(p for p in pins if p not in geoms)
    level = {p: 0 for p in pins if p in geoms}
    nbrs: dict[str, list[str]] = {}
    frontier = sorted(level)
    for h in range(1, hops + 1):
        nxt = []
        for p in frontier:
            nbrs[p] = neighbours(p)
            for n in nbrs[p]:
                if n not in level:
                    level[n] = h
                    nxt.append(n)
        frontier = sorted(nxt)

    assess = _assessments(cache)
    city_rows: dict[str, dict] = {}
    for r in csv.DictReader(io.StringIO(cache.read("city_owned").decode("utf-8-sig"))):
        r.pop("owner", None)
        if r.get("pin", "").strip():
            city_rows.setdefault(r["pin"].strip(), {k: (v or "").strip() for k, v in r.items()})

    fps = []
    for k in _keys(cache, "city/footprints/page_"):
        for f in cache.read_json(k)["features"]:
            c = f.get("centroid")
            if c:
                fps.append((f["attributes"].get("Building_Footprints_OBJECTID") or f["attributes"]["OBJECTID"], Point(c["x"], c["y"])))
    fp_tree = STRtree([p for _, p in fps])

    def footprints_in(g) -> list[str]:
        return sorted(f"b{fps[i][0]}" for i in fp_tree.query(g, predicate="contains"))

    def layer(prefix, field):
        items = [((f.get("properties") or {}).get(field), fix(shape(f["geometry"]))) for f in _features(cache, prefix) if f.get("geometry")]
        return items, STRtree([g for _, g in items])

    zoning, z_tree = layer("city/zoning", "zon_new")
    slope_items, s_tree = layer("city/slope25", "objectid_1")
    under_items, u_tree = layer("city/undermined", "objectid")

    def cover(g, items, tr) -> float:
        idx = tr.query(g)
        if len(idx) == 0:
            return 0.0
        inter = unary_union([items[i][1] for i in idx]).intersection(g).area
        return round(inter / g.area, 3) if g.area > 0 else 0.0

    parcels: dict[str, dict[str, Any]] = {}
    for pin in sorted(level):
        g0 = geoms[pin]
        single, note = _single_polygon(g0)
        part = single if single is not None else max(polygons(g0), key=lambda p: p.area)
        c = part.centroid
        fr = LocalFrame(_ll(c.y), _ll(c.x), 0.0)
        q = orient(Polygon(part.exterior.coords), sign=1.0)
        a = assess.get(pin)
        co = city_rows.get(pin)
        built, basis = built_state(footprints_in(g0), a)
        addr, addr_source, _ = parcel_address(co, a, ())
        lot, sub = pin_lot(pin) if len(pin) == 16 else (None, None)
        zone, best = None, 0.0
        for i in z_tree.query(part):
            ov = part.intersection(zoning[i][1]).area
            if ov > best:
                best, zone = ov, zoning[i][0]
        rec: dict[str, Any] = {
            "pin": pin,
            "hop": level[pin],
            "lot": lot,
            "lot_suffix": sub,
            "addr": addr,
            "addr_source": addr_source,
            "ring_ll": [[_ll(x), _ll(y)] for x, y in q.exterior.coords],
            "multipolygon": note if single is None else None,
            "mapped_area": r1(fr.geom_en(part).area),
            "zone": zone,
            "zone_frac": round(best / part.area, 3) if part.area else 0.0,
            "built": built,
            "built_basis": basis,
            "assess": None if a is None else {
                "lotarea": _num_or_none(a.get("LOTAREA")),
                "use": a.get("USEDESC"),
                "class": a.get("CLASSDESC"),
                "ownercat": a.get("OWNERDESC"),
                "legal": (a.get("LEGAL1") or "").strip() or None,
                "yearbuilt": _num_or_none(a.get("YEARBLT")),
                "asof": a.get("ASOFDATE"),
            },
            "deed": parse_legal1(a.get("LEGAL1")) if a else None,
            "city": None if co is None else {
                "status": co.get("current_status") or None,
                "inventory": co.get("inventory_type") or None,
                "status_updated": co.get("last_updated") or None,
                "class": co.get("class") or None,
            },
            "slope25": cover(g0, slope_items, s_tree),
            "undermined": cover(g0, under_items, u_tree),
        }
        if pin in nbrs:
            rec["nbrs"] = nbrs[pin]
        parcels[pin] = rec

    # Named streets within reach of the pool (the citywide work file's filter), whole ways in lon/lat.
    osm = json.loads(cache.read("city/osm_named_highways"))
    ways = []
    for e in sorted(osm["elements"], key=lambda e: e["id"]):
        t = e.get("tags", {})
        if e.get("type") != "way" or not t.get("name") or t.get("highway") in STREET_TYPES_EXCLUDED or len(e.get("geometry") or []) < 2:
            continue
        ways.append((e["id"], t["name"], t.get("highway"), LineString([(g["lon"], g["lat"]) for g in e["geometry"]])))
    w_tree = STRtree([w[3] for w in ways])
    reach = STREET_FT / 364000.0 * 1.4  # degrees, generous in longitude at this latitude
    keep = set()
    for pin in parcels:
        for i in w_tree.query(geoms[pin].buffer(reach), predicate="intersects"):
            keep.add(int(i))
    streets = [{"osm_id": ways[i][0], "name": ways[i][1], "highway": ways[i][2], "line_ll": [[_ll(x), _ll(y)] for x, y in ways[i][3].coords]} for i in sorted(keep)]

    used = ["city_owned"] + [k for k in cache.manifest if k.startswith("city/")]
    meta = {
        "pulled": max(cache.entry(k)["fetched_at"] for k in used),
        "raw_cache": f"data/raw/{cache.date}",
        "hops": hops,
        "neighbor_within_ft": NEIGHBOR_FT,
        "candidates": len(pins),
        "candidates_without_geometry": missing,
        "pins_sha": _pins_key(pins),
        "parcels": len(parcels),
        "streets": len(streets),
        "sources": [
            {"id": "pgh_parcels", "name": "City PGHParcels (all pages)", "url": S.arcgis_url("PGHParcels"), "pulled": cache.entry("city/parcels/page_0000")["fetched_at"]},
            {"id": "city_owned", "name": "City-Owned Properties (WPRDC); owner column dropped", "url": S.CITY_OWNED_CSV, "pulled": cache.entry("city_owned")["fetched_at"]},
            {"id": "wprdc_assessments", "name": "Property Assessments, MUNICODE 101-132 (fields: PARID, OWNERDESC, CLASSDESC, USEDESC, LOTAREA, LEGAL1, YEARBLT, address)", "url": f"{S.CKAN_SEARCH}?resource_id={S.ASSESSMENT_RESOURCE}", "pulled": cache.entry(_keys(cache, "city/assess/")[0])["fetched_at"]},
            {"id": "building_footprints", "name": "Building footprint centroids (2023)", "url": S.arcgis_url("Building_Footprints_Adjacency"), "pulled": cache.entry("city/footprints/page_0000")["fetched_at"]},
            {"id": "zoning", "name": "City zoning", "url": S.arcgis_url("PGHWebZoning"), "pulled": cache.entry("city/zoning/page_0000")["fetched_at"]},
            {"id": "slope25", "name": "25%+ slope", "url": S.arcgis_url("PGHWebSlope25"), "pulled": cache.entry("city/slope25/page_0000")["fetched_at"]},
            {"id": "undermined", "name": "Undermined areas", "url": S.arcgis_url("PGHWebUndermined"), "pulled": cache.entry("city/undermined/page_0000")["fetched_at"]},
            {"id": "osm_streets", "name": "OpenStreetMap named highways (Overpass), ODbL", "url": S.OVERPASS, "pulled": cache.entry("city/osm_named_highways")["fetched_at"]},
        ],
    }
    return {"meta": meta, "parcels": parcels, "streets": streets}


def _pins_key(pins: list[str]) -> str:
    import hashlib

    return hashlib.sha256(",".join(sorted(pins)).encode()).hexdigest()[:16]


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m pipeline.assembly")
    ap.add_argument("--pins", required=True, help="JSON list of candidate PINs")
    ap.add_argument("--date", help="raw cache folder (default: the one data/city/work/lots_work.json was built from)")
    args = ap.parse_args(argv)
    pins = json.loads(open(args.pins).read())
    date = args.date
    if not date:
        with open(WORK) as f:
            head = json.load(f)["meta"]["raw_cache"]
        date = head.rsplit("/", 1)[-1]
    t = time.time()
    cache = RawCache(date, offline=True)
    out = process_assembly(cache, pins)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(dumps(out, indent=None))
    m = out["meta"]
    print(f"wrote {OUT.name}: {m['parcels']} parcels around {m['candidates']} candidates, {m['streets']} streets; raw {date}; {time.time() - t:.0f} s", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
