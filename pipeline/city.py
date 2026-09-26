"""Citywide work file: every City-owned "Vacant Land" parcel with its geometry, neighbours and streets.

Writes data/city/work/lots_work.json (gitignored; the engine's build script makes the compact
data/city/lots.json from it) and the small committed outlines data/city/neighborhoods.json and
data/city/water.json.
"""
from __future__ import annotations

import csv
import io
import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

from shapely import STRtree
from shapely.geometry import LineString, MultiPolygon, Point, Polygon, box, shape
from shapely.ops import unary_union

from . import PIPELINE_VERSION
from . import sources as S
from .block import VACANT_USES, _num_or_none, built_state, parcel_address
from .fetch import REPO, RawCache
from .geo import LocalFrame, fix, lines, polygons, r1, r2
from .legal import legal1_cut, match_osm_street, normalize_street, parse_legal1, pin_lot, split_address, addr_display

OUT_DIR = REPO / "data" / "city"
WORK = OUT_DIR / "work" / "lots_work.json"
NEIGHBOR_FT = 3.0
STREET_FT = 150.0
OUTLINE_TOL_FT = 0.3
SLIVER_FRAC = 0.01          # extra polygon parts below 1% of a parcel's area are slivers
STREET_TYPES_EXCLUDED = {"footway", "path", "steps", "cycleway", "bridleway", "corridor", "track",
                         "pedestrian", "proposed", "construction", "elevator", "platform"}
RES_FAMILIES = ("R1D", "R1A", "R2", "R3", "RM", "RP")


def zone_family(z: str | None) -> str:
    if not z:
        return "(none)"
    m = re.match(r"^(R1D|R1A|R2|R3|RM|RP)\b", z)
    return m.group(1) if m else "other"


# ---------------------------------------------------------------------------------------------
# fetch


def fetch_city(cache: RawCache) -> None:
    S.fetch_city_owned(cache)
    S.fetch_city_layers(cache)
    S.fetch_city_assessments(cache)
    S.fetch_city_osm(cache)
    S.fetch_city_outlines(cache)
    # City lots whose PIN is not in a ward pull (e.g. City-owned land outside the wards): by PARID
    missing = _missing_assessment_pins(cache)
    if missing:
        S.fetch_assessments(cache, "city/assess_extra", missing)


def _keys(cache: RawCache, prefix: str) -> list[str]:
    return sorted(k for k in cache.manifest if k.startswith(prefix))


def _vacant_rows(cache: RawCache) -> list[dict]:
    rows = []
    for r in csv.DictReader(io.StringIO(cache.read("city_owned").decode("utf-8-sig"))):
        r.pop("owner", None)
        if (r.get("class") or "").strip() == "Vacant Land":
            rows.append({k: (v or "").strip() for k, v in r.items()})
    return rows


def _assessments(cache: RawCache) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for k in _keys(cache, "city/assess/") + _keys(cache, "city/assess_extra"):
        for r in cache.read_json(k)["result"]["records"]:
            out.setdefault(r["PARID"], r)
    return out


def _missing_assessment_pins(cache: RawCache) -> list[str]:
    have = _assessments(cache)
    return sorted({r["pin"] for r in _vacant_rows(cache) if r["pin"] and r["pin"] not in have})


# ---------------------------------------------------------------------------------------------
# process


def _features(cache: RawCache, prefix: str) -> list[dict]:
    out = []
    for k in _keys(cache, prefix + "/page_"):
        out += cache.read_json(k)["features"]
    return out


def _parcel_geoms(cache: RawCache) -> dict[str, Any]:
    by_pin: dict[str, list] = {}
    for f in _features(cache, "city/parcels"):
        pin = (f.get("properties") or {}).get("pin")
        if not pin or not f.get("geometry"):
            continue
        by_pin.setdefault(pin, []).append(fix(shape(f["geometry"])))
    return {pin: (gs[0] if len(gs) == 1 else unary_union(gs)) for pin, gs in by_pin.items()}


def _single_polygon(g) -> tuple[Polygon | None, str | None]:
    parts = sorted(polygons(g), key=lambda p: -p.area)
    if not parts:
        return None, "geometry is not a polygon"
    if len(parts) > 1 and parts[1].area >= SLIVER_FRAC * g.area:
        return None, f"multipolygon ({len(parts)} parts)"
    note = f"dropped {len(parts) - 1} sliver part(s) under 1% of the area" if len(parts) > 1 else None
    return parts[0], note


def _ring_local(fr: LocalFrame, p: Polygon) -> list[list[float]]:
    """Exterior ring in local feet (x east, y north), closed, counterclockwise."""
    from shapely.geometry.polygon import orient

    q = orient(Polygon(p.exterior.coords), sign=1.0)
    return [[r2(x), r2(y)] for x, y in (fr.en(lon, lat) for lon, lat in q.exterior.coords)]


def _ll(v: float) -> float:
    return round(v, 7)


def process_city(cache: RawCache) -> dict[str, Any]:
    rows = _vacant_rows(cache)
    geoms = _parcel_geoms(cache)
    pins_all = sorted(geoms)
    tree = STRtree([geoms[p] for p in pins_all])
    assess = _assessments(cache)
    city_rows = {}
    for r in csv.DictReader(io.StringIO(cache.read("city_owned").decode("utf-8-sig"))):
        r.pop("owner", None)
        if r.get("pin", "").strip():
            city_rows.setdefault(r["pin"].strip(), {k: (v or "").strip() for k, v in r.items()})

    fps = []
    for k in _keys(cache, "city/footprints/page_"):
        for f in cache.read_json(k)["features"]:
            c = f.get("centroid")
            if c:
                fps.append((f["attributes"].get("Building_Footprints_OBJECTID") or f["attributes"]["OBJECTID"],
                            Point(c["x"], c["y"])))
    fp_tree = STRtree([p for _, p in fps])

    def footprints_in(g) -> list[str]:
        return sorted(f"b{fps[i][0]}" for i in fp_tree.query(g, predicate="contains"))

    def layer(prefix, field):
        items = [((f.get("properties") or {}).get(field), fix(shape(f["geometry"])))
                 for f in _features(cache, prefix) if f.get("geometry")]
        return items, STRtree([g for _, g in items])

    zoning, z_tree = layer("city/zoning", "zon_new")
    slope_items, s_tree = layer("city/slope25", "objectid_1")
    under_items, u_tree = layer("city/undermined", "objectid")

    osm = json.loads(cache.read("city/osm_named_highways"))
    ways = []
    for e in sorted(osm["elements"], key=lambda e: e["id"]):
        t = e.get("tags", {})
        if e.get("type") != "way" or not t.get("name") or t.get("highway") in STREET_TYPES_EXCLUDED:
            continue
        if len(e.get("geometry") or []) < 2:
            continue
        ways.append((e["id"], t["name"], t.get("highway"), LineString([(g["lon"], g["lat"]) for g in e["geometry"]])))
    w_tree = STRtree([w[3] for w in ways])

    def cover(g, items, tr) -> float:
        idx = tr.query(g)
        if len(idx) == 0:
            return 0.0
        inter = unary_union([items[i][1] for i in idx]).intersection(g).area
        return round(inter / g.area, 3) if g.area > 0 else 0.0

    lots = []
    skipped = []
    seen = set()
    no_pin = 0
    for r in sorted(rows, key=lambda r: (r["pin"], r.get("_id", ""))):
        pin = r["pin"]
        addr_raw = r.get("address", "")
        if not pin:
            no_pin += 1
            skipped.append({"pin": None, "addr": _addr(addr_raw), "reason": "no PIN in the City-Owned Properties row"})
            continue
        if pin in seen:
            skipped.append({"pin": pin, "addr": _addr(addr_raw), "reason": "duplicate PIN row"})
            continue
        seen.add(pin)
        g0 = geoms.get(pin)
        if g0 is None:
            skipped.append({"pin": pin, "addr": _addr(addr_raw), "reason": "no PGHParcels geometry for this PIN"})
            continue
        g, note = _single_polygon(g0)
        if g is None:
            skipped.append({"pin": pin, "addr": _addr(addr_raw), "reason": note})
            continue
        c = g.centroid
        fr = LocalFrame(_ll(c.y), _ll(c.x), 0.0)
        ring = _ring_local(fr, g)
        local = Polygon(ring)
        if not local.is_valid:
            skipped.append({"pin": pin, "addr": _addr(addr_raw), "reason": "ring invalid after rounding to 0.01 ft"})
            continue
        simp = fr.geom_en(g).simplify(OUTLINE_TOL_FT, preserve_topology=True)
        outline_ll = [[_ll(fr.lon0 + x / fr.kx), _ll(fr.lat0 + y / fr.ky)] for x, y in simp.exterior.coords]
        rp = g.representative_point()
        a = assess.get(pin)

        # neighbours: parcels whose boundary comes within 3 ft
        nbrs = []
        pad = 0.0001
        for i in tree.query(box(*g.buffer(pad).bounds)):
            npin = pins_all[i]
            if npin == pin:
                continue
            ng = geoms[npin]
            ng_local = fr.geom_en(ng)
            if ng_local.distance(fr.geom_en(g)) > NEIGHBOR_FT:
                continue
            npoly = max(polygons(ng), key=lambda p: p.area)
            na = assess.get(npin)
            nbuilt, _ = built_state(footprints_in(ng), na)
            naddr, _, _ = parcel_address(city_rows.get(npin), na, ())
            nlot, _ = pin_lot(npin) if len(npin) == 16 else (None, None)
            nbrs.append({"pin": npin, "lot": nlot, "poly": _ring_local(fr, npoly), "built": nbuilt, "addr": naddr})
        nbrs.sort(key=lambda n: n["pin"])

        # streets within 150 ft, clipped to the lot's bbox plus 150 ft
        lg = fr.geom_en(g)
        minx, miny, maxx, maxy = lg.bounds
        clip = box(minx - STREET_FT, miny - STREET_FT, maxx + STREET_FT, maxy + STREET_FT)
        qbox = box(fr.lon0 + clip.bounds[0] / fr.kx, fr.lat0 + clip.bounds[1] / fr.ky,
                   fr.lon0 + clip.bounds[2] / fr.kx, fr.lat0 + clip.bounds[3] / fr.ky)
        streets = []
        for i in w_tree.query(qbox):
            wid, name, hw, ls = ways[i]
            local_ls = fr.geom_en(ls)
            if local_ls.distance(lg) > STREET_FT:
                continue
            for piece in lines(local_ls.intersection(clip)):
                if piece.length >= 1:
                    streets.append({"name": name, "osm_id": wid, "highway": hw,
                                    "line": [[r2(x), r2(y)] for x, y in piece.coords]})
        streets.sort(key=lambda s: (s["name"], s["osm_id"], s["line"]))
        near_names = {s["name"] for s in streets}

        hn, st = split_address(addr_raw) if addr_raw else (None, "")
        addr = addr_display(hn, st) if st else None
        addr_street = match_osm_street(st, near_names) if st else None

        # zoning by largest overlap
        zone, best = None, 0.0
        for i in z_tree.query(g):
            ov = g.intersection(zoning[i][1]).area
            if ov > best:
                best, zone = ov, zoning[i][0]
        raw_legal = a.get("LEGAL1") if a else None
        deed = parse_legal1(raw_legal)
        built, built_basis = built_state(footprints_in(g), a)
        rec = {
            "pin": pin,
            "addr": addr,
            "addr_street": addr_street,
            "hood": r.get("neighborhood_name") or None,
            "ward": _num_or_none(r.get("ward")),
            "zone": zone,
            "zone_frac": round(best / g.area, 3) if g.area else 0.0,
            "city": {
                "status": r.get("current_status") or None,
                "inventory": r.get("inventory_type") or None,
                "status_updated": r.get("last_updated") or None,
                "class": r.get("class") or None,
                "zoned_as": r.get("zoned_as") or None,
            },
            "ll": [_ll(rp.x), _ll(rp.y)],
            "outline_ll": outline_ll,
            "origin": [fr.lon0, fr.lat0],
            "poly": ring,
            "neighbors": nbrs,
            "streets": streets,
            "assess": None if a is None else {
                "lotarea": _num_or_none(a.get("LOTAREA")),
                "use": a.get("USEDESC"),
                "legal": (a.get("LEGAL1") or "").strip() or None,
                "ownercat": a.get("OWNERDESC"),
                "asof": a.get("ASOFDATE"),
                "yearbuilt": _num_or_none(a.get("YEARBLT")),
            },
            "deed": deed,
            "mapped_area": r1(local.area),
            "slope25": cover(g, slope_items, s_tree),
            "undermined": cover(g, under_items, u_tree),
            "built": built,
            "built_basis": built_basis,
        }
        if legal1_cut(raw_legal):
            rec["deed_note"] = "LEGAL1 fills its 47-character field and ends inside the dimensions; not read"
        if note:
            rec["geometry_note"] = note
        lots.append(rec)

    fam = Counter(zone_family(l["zone"]) for l in lots)
    fam_csv = Counter(zone_family(r.get("zoned_as")) for r in rows)
    used = ["city_owned"] + [k for k in cache.manifest if k.startswith("city/")]
    pulled = max(cache.entry(k)["fetched_at"] for k in used)
    meta = {
        "pulled": pulled,
        "raw_cache": f"data/raw/{cache.date}",
        "pipeline_version": PIPELINE_VERSION,
        "frame": "per lot: feet east (x) and north (y) of origin [lon, lat] = the lot centroid; equirectangular",
        "sources": [
            {"id": "city_owned", "name": "City-Owned Properties (WPRDC)", "url": S.CITY_OWNED_CSV,
             "pulled": cache.entry("city_owned")["fetched_at"]},
            {"id": "pgh_parcels", "name": "City PGHParcels (all pages)", "url": S.arcgis_url("PGHParcels"),
             "pulled": cache.entry("city/parcels/page_0000")["fetched_at"]},
            {"id": "building_footprints", "name": "Building footprint centroids (2023)",
             "url": S.arcgis_url("Building_Footprints_Adjacency"),
             "pulled": cache.entry("city/footprints/page_0000")["fetched_at"]},
            {"id": "zoning", "name": "City zoning", "url": S.arcgis_url("PGHWebZoning"),
             "pulled": cache.entry("city/zoning/page_0000")["fetched_at"]},
            {"id": "slope25", "name": "25%+ slope", "url": S.arcgis_url("PGHWebSlope25"),
             "pulled": cache.entry("city/slope25/page_0000")["fetched_at"]},
            {"id": "undermined", "name": "Undermined areas", "url": S.arcgis_url("PGHWebUndermined"),
             "pulled": cache.entry("city/undermined/page_0000")["fetched_at"]},
            {"id": "wprdc_assessments", "name": "Property Assessments, MUNICODE 101-132",
             "url": f"{S.CKAN_SEARCH}?resource_id={S.ASSESSMENT_RESOURCE}",
             "pulled": cache.entry(_keys(cache, "city/assess/")[0])["fetched_at"]},
            {"id": "osm_streets", "name": "OpenStreetMap named highways (Overpass), ODbL", "url": S.OVERPASS,
             "pulled": cache.entry("city/osm_named_highways")["fetched_at"]},
        ],
        "counts": {
            "city_owned_rows": sum(1 for _ in csv.DictReader(io.StringIO(cache.read("city_owned").decode("utf-8-sig")))),
            "vacant_land_rows": len(rows),
            "vacant_land_rows_without_pin": no_pin,
            "written": len(lots),
            "skipped": len(skipped),
            "skipped_by_reason": dict(sorted(Counter(re.sub(r"\(\d+ parts\)", "(n parts)", s["reason"]) for s in skipped).items())),
            "zone_family_by_zoning_layer": dict(sorted(fam.items())),
            "zone_family_by_city_csv_zoned_as": dict(sorted(fam_csv.items())),
            "residential_families": list(RES_FAMILIES),
            "zone_disagrees_with_csv": sum(1 for l in lots if l["city"]["zoned_as"] and l["zone"] != l["city"]["zoned_as"]),
            "neighbors_total": sum(len(l["neighbors"]) for l in lots),
            "lots_without_street_within_150ft": sum(1 for l in lots if not l["streets"]),
        },
        "rules": {
            "neighbor_within_ft": NEIGHBOR_FT, "street_within_ft": STREET_FT, "outline_tolerance_ft": OUTLINE_TOL_FT,
            "built": "a building-footprint centroid (ArcGIS returnCentroid) inside the parcel, or an assessment "
                     "YEARBLT with a use other than vacant land",
            "streets_excluded_highway_types": sorted(STREET_TYPES_EXCLUDED),
        },
        "skipped": skipped,
    }
    return {"meta": meta, "lots": lots}


def _addr(raw: str) -> str | None:
    if not raw:
        return None
    hn, st = split_address(raw)
    return addr_display(hn, st) if st else None


# ---------------------------------------------------------------------------------------------
# outlines


def _rings_ll(g, tol_deg: float, nd: int) -> list[list[list[float]]]:
    """All rings (outer rings and holes, even-odd fill) of the simplified geometry, rounded."""
    out = []
    for p in polygons(g.simplify(tol_deg, preserve_topology=True)):
        for r in [p.exterior, *p.interiors]:
            out.append([[round(x, nd), round(y, nd)] for x, y in r.coords])
    return out


def neighborhoods_file(cache: RawCache, tol_deg: float = 0.000005, nd: int = 6) -> list[dict[str, Any]]:
    """[{name, rings}] as web/src/components/city/cityData.ts reads it (source: WPRDC Neighborhoods)."""
    fc = json.loads(cache.read("city/neighborhoods"))
    hoods = [{"name": (f["properties"].get("hood") or "").strip(), "rings": _rings_ll(fix(shape(f["geometry"])), tol_deg, nd)}
             for f in fc["features"]]
    return sorted(hoods, key=lambda h: h["name"])


def water_file(cache: RawCache, tol_deg: float = 0.000005, nd: int = 6) -> list[dict[str, Any]]:
    """[{name, rings}] for the three rivers, clipped to the City box (source: WPRDC Major Rivers)."""
    fc = json.loads(cache.read("city/major_rivers"))
    clipbox = box(*S.CITY_BBOX)
    out = []
    for f in fc["features"]:
        g = fix(shape(f["geometry"])).intersection(clipbox)
        if not g.is_empty:
            out.append({"name": (f["properties"].get("NAME") or "").strip() or None, "rings": _rings_ll(g, tol_deg, nd)})
    return sorted(out, key=lambda w: (w["name"] or "", len(w["rings"])))


def dumps(obj: Any, indent: int | None = 1) -> str:
    return json.dumps(obj, sort_keys=True, indent=indent, ensure_ascii=False, separators=(",", ":") if indent is None else None) + "\n"


def write_outlines(cache: RawCache) -> tuple[Path, Path]:
    nb = OUT_DIR / "neighborhoods.json"
    nb.write_text(dumps(neighborhoods_file(cache), indent=None))
    wt = OUT_DIR / "water.json"
    wt.write_text(dumps(water_file(cache), indent=None))
    return nb, wt


def write_all(cache: RawCache) -> dict[str, Any]:
    work = process_city(cache)
    WORK.parent.mkdir(parents=True, exist_ok=True)
    WORK.write_text(dumps(work, indent=None))
    nb, wt = write_outlines(cache)
    return {"work": WORK, "neighborhoods": nb, "water": wt, "_work_obj": work}
