"""Block pipeline: fetch into the raw cache, then process the cache into data/blocks/<id>.json."""
from __future__ import annotations

import csv
import io
import json
import math
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from shapely.geometry import LineString, Point, Polygon, box, shape
from shapely.ops import unary_union

from . import PIPELINE_VERSION
from . import sources as S
from .fetch import REPO, RawCache
from .geo import (
    LocalFrame, fabric_angle, fix, lines, poly_rings, polygons, r1, r2, ring_xy, street_face,
)
from .legal import addr_display, normalize_street, parse_legal1, pin_lot, split_address

OUT_DIR = REPO / "data" / "blocks"
FETCH_PAD_DEG = 0.0004      # ~110-145 ft around the street polygon for layer queries
STREET_MARGIN_FT = 120.0    # streets are clipped to the block's local bbox plus this margin
RECON_TOLERANCE = 0.10


@dataclass(frozen=True)
class BlockConfig:
    id: str
    name: str
    neighborhood: str
    ward: int
    seed_bbox: tuple[float, float, float, float]      # w, s, e, n for the OSM query
    bounding_streets: dict[str, str]                   # display abbreviation -> OSM name
    main_street: str                                   # OSM name
    pin_prefix: str
    pins: tuple[str, ...] = field(default_factory=tuple)  # explicit list (held-out blocks)
    counts_note: str | None = None                         # checked against the output by tests


BLOCKS: dict[str, BlockConfig] = {
    "10K": BlockConfig(
        id="10K",
        name="Block 10-K",
        neighborhood="Middle Hill",
        ward=5,
        seed_bbox=(-79.9775, 40.4440, -79.9715, 40.4480),
        bounding_streets={
            "Wylie Ave": "Wylie Avenue",
            "Soho St": "Soho Street",
            "Mahon St": "Mahon Street",
            "Kirkpatrick St": "Kirkpatrick Street",
        },
        main_street="Mahon Street",
        pin_prefix="0010K",
        counts_note=(
            "Plan lots 63-76 (14 lots) in LEGAL1 are County lots 21-34, now 15 parcels (lot 28 split "
            "into 28 and 28-A). Lot 27's LEGAL1 states no plan lot; lot 24's names the Agnes M Mahon "
            "Plan, the others a Robb plan. Lot 35 (split into 35 and 35-A) is Mahon Plan pt 77. "
            "Mahon St side: 23 parcels on County lots 21-44; Wylie Ave side: 16 parcels on lots 60-83; "
            "39 parcels in all."
        ),
    ),
}


# ---------------------------------------------------------------------------------------------
# street polygon (shared by fetch and process so both select the same parcels)


def _osm_named_ways(osm: dict) -> list[dict]:
    return sorted(
        (e for e in osm["elements"] if e.get("type") == "way" and e.get("tags", {}).get("name") and e.get("geometry")),
        key=lambda e: e["id"],
    )


def _street_polygon_lonlat(cfg: BlockConfig, osm: dict) -> Polygon | None:
    w, s, e, n = cfg.seed_bbox
    fr = LocalFrame((s + n) / 2, (w + e) / 2, 0.0)
    named: dict[str, list[LineString]] = {}
    for way in _osm_named_ways(osm):
        nm = way["tags"]["name"]
        if nm in cfg.bounding_streets.values():
            named.setdefault(nm, []).append(LineString([fr.en(g["lon"], g["lat"]) for g in way["geometry"]]))
    if set(named) != set(cfg.bounding_streets.values()):
        return None
    face = street_face(named)
    if face is None:
        return None
    return Polygon([fr_inverse(fr, x, y) for x, y in face.exterior.coords])


def fr_inverse(fr: LocalFrame, x: float, y: float) -> tuple[float, float]:
    return fr.lon0 + x / fr.kx, fr.lat0 + y / fr.ky


def fetch_bbox(poly_ll: Polygon) -> tuple[float, float, float, float]:
    w, s, e, n = poly_ll.bounds
    p = FETCH_PAD_DEG
    return (round(w - p, 6), round(s - p, 6), round(e + p, 6), round(n + p, 6))


# ---------------------------------------------------------------------------------------------
# fetch


def fetch_block(cache: RawCache, cfg: BlockConfig) -> None:
    osm = json.loads(S.fetch_osm(cache, f"{cfg.id}/osm", cfg.seed_bbox))
    poly_ll = _street_polygon_lonlat(cfg, osm)
    if poly_ll is None:
        # fall back to the seed bbox; processing will select by PIN prefix and say so
        bbox = cfg.seed_bbox
    else:
        bbox = fetch_bbox(poly_ll)
    for layer in S.LAYERS:
        S.fetch_arcgis(cache, f"{cfg.id}/{layer}", layer, bbox)
    parcels = json.loads(cache.read(f"{cfg.id}/parcels"))
    pins = _select(cfg, parcels, poly_ll)[0]
    S.fetch_assessments(cache, cfg.id, [p for p, _ in pins])
    S.fetch_city_owned(cache)
    S.fetch_hist_zoning(cache)


def _select(cfg: BlockConfig, parcels_fc: dict, poly_ll: Polygon | None):
    """Returns ([(pin, feature)], selection note)."""
    feats = sorted(parcels_fc["features"], key=lambda f: (f["properties"]["pin"], json.dumps(f["geometry"])))
    out = []
    seen = set()
    if cfg.pins:
        want = set(cfg.pins)
        for f in feats:
            pin = f["properties"]["pin"]
            if pin in want and pin not in seen:
                out.append((pin, f))
                seen.add(pin)
        return out, "explicit PIN list"
    if poly_ll is not None:
        for f in feats:
            pin = f["properties"]["pin"]
            g = fix(shape(f["geometry"]))
            if pin not in seen and poly_ll.contains(g.representative_point()):
                out.append((pin, f))
                seen.add(pin)
        return out, "rep-point inside OSM street polygon"
    for f in feats:
        pin = f["properties"]["pin"]
        if pin.startswith(cfg.pin_prefix) and pin not in seen:
            out.append((pin, f))
            seen.add(pin)
    return out, f"PIN prefix {cfg.pin_prefix} inside fetch bbox (street polygon failed)"


# ---------------------------------------------------------------------------------------------
# process

HIST_FIELDS = {
    "1927": lambda p: " ".join(v for v in (p.get("Zoning_District"), p.get("Combined_District")) if v) or None,
    "1958": lambda p: p.get("Zoning_District1958"),
    "1967": lambda p: p.get("Zoning_District"),
}
VACANT_USES = {"VACANT LAND", "VACANT COMMERCIAL LAND", "VACANT INDUSTRIAL LAND", "VACANT RESIDENTIAL LAND"}
FRONT_EDGE_MAX_FT = 35.0      # a parcel edge this close to the main-street centerline is a frontage edge
FRONT_EDGE_MAX_DEG = 10.0     # ... and within this angle of the centerline chord
COVER_MIN_FRAC = 0.005        # overlays covering less than 0.5% of a lot are boundary slivers


def _source_entry(cache: RawCache, key: str, sid: str, name: str, url: str | None = None) -> dict:
    e = cache.entry(key)
    return {"id": sid, "name": name, "url": url or e["url"], "pulled": e["fetched_at"], "sha256": e["sha256"]}


def _assessments(cache: RawCache, cfg: BlockConfig) -> dict[str, dict]:
    out: dict[str, dict] = {}
    for key in sorted(k for k in cache.manifest if k.startswith(f"{cfg.id}/assessments_")):
        for r in cache.read_json(key)["result"]["records"]:
            out[r["PARID"]] = r
    return out


def _assessment_keys(cache: RawCache, cfg: BlockConfig) -> list[str]:
    return sorted(k for k in cache.manifest if k.startswith(f"{cfg.id}/assessments_"))


def read_city_owned(raw: bytes) -> dict[str, dict]:
    """PIN -> kept columns. The 'owner' column is dropped here too (defence in depth)."""
    keep = ["pin", "address", "parc_sq_ft", "class", "zoned_as", "inventory_type", "current_status",
            "last_updated", "latitude", "longitude", "neighborhood_name", "ward"]
    rows: dict[str, dict] = {}
    for r in csv.DictReader(io.StringIO(raw.decode("utf-8-sig"))):
        r.pop("owner", None)
        pin = (r.get("pin") or "").strip()
        if not pin:
            continue
        rec = {k: (r.get(k) or "").strip() for k in keep}
        prev = rows.get(pin)
        # deterministic if a PIN repeats: newest last_updated wins, then larger _id
        if prev is None or (rec["last_updated"], r.get("_id", "")) > (prev["last_updated"], prev.get("_row", "")):
            rec["_row"] = r.get("_id", "")
            rows[pin] = rec
    for v in rows.values():
        v.pop("_row", None)
    return rows


def _frac(a: float, b: float) -> float:
    return round(a / b, 3) if b > 0 else 0.0


def _num_or_none(v):
    if v is None or v == "":
        return None
    f = float(v)
    return int(f) if f.is_integer() else f


def _main_street_rotation(cfg: BlockConfig, osm: dict, face_en, lot_polys_en, fr0: LocalFrame):
    """Rotation (deg CCW from east) of the main street, oriented so the block lies on its left
    (i.e. above it once y points down). Measured from the parcel frontage edges along the street
    (the right-of-way line); falls back to the OSM centerline chord."""
    ways = [w for w in _osm_named_ways(osm) if w["tags"]["name"] == cfg.main_street]
    center = unary_union([LineString([fr0.en(g["lon"], g["lat"]) for g in w["geometry"]]) for w in ways])
    edge = center.intersection(face_en.exterior.buffer(0.5)) if face_en is not None else center
    pts = [c for ln in lines(edge) for c in ln.coords]
    if len(pts) < 2:
        pts = [c for ln in lines(center) for c in ln.coords]
    # chord between the extreme points along the dominant axis
    xs = sorted(pts)
    chord = math.degrees(math.atan2(xs[-1][1] - xs[0][1], xs[-1][0] - xs[0][0]))

    def dd(a, b):
        d = (a - b) % 180.0
        return min(d, 180.0 - d)

    num_c = num_s = tot = 0.0
    n_edges = 0
    for p in lot_polys_en:
        cs = list(p.exterior.coords)
        for a, b in zip(cs, cs[1:]):
            L = math.dist(a, b)
            if L < 3:
                continue
            ang = math.degrees(math.atan2(b[1] - a[1], b[0] - a[0]))
            mid = Point((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)
            if center.distance(mid) <= FRONT_EDGE_MAX_FT and dd(ang, chord) <= FRONT_EDGE_MAX_DEG:
                # double-angle mean so opposite edge directions agree
                num_c += L * math.cos(math.radians(2 * ang))
                num_s += L * math.sin(math.radians(2 * ang))
                tot += L
                n_edges += 1
    if n_edges >= 3:
        ang = math.degrees(math.atan2(num_s, num_c)) / 2.0
        basis = f"parcel frontage along {cfg.main_street} ({n_edges} edges, {tot:.0f} ft); OSM centerline chord {chord:.2f}°"
    else:
        ang = chord
        basis = f"OSM centerline chord of {cfg.main_street} (too few frontage edges)"
    # align with chord direction, then orient so the block is on the left of the direction
    if dd(ang, chord) > 90:
        ang += 180
    ang = ((ang + 180) % 360) - 180
    if face_en is not None:
        c = face_en.centroid
        a = math.radians(ang)
        # left of direction <=> cross(dir, c - p0) > 0
        p0 = xs[0]
        cross = math.cos(a) * (c.y - p0[1]) - math.sin(a) * (c.x - p0[0])
        if cross < 0:
            ang = ((ang + 360) % 360) - 180
    return round(ang, 3), basis


def process_block(cache: RawCache, cfg: BlockConfig) -> dict[str, Any]:
    osm = cache.read_json(f"{cfg.id}/osm")
    poly_ll = _street_polygon_lonlat(cfg, osm)
    parcels_fc = cache.read_json(f"{cfg.id}/parcels")
    selected, selection = _select(cfg, parcels_fc, poly_ll)
    if not selected:
        raise RuntimeError(f"block {cfg.id}: no parcels selected")

    # origin: centroid of the selected parcels (lon/lat, rounded so the frame is reproducible)
    w, s, e, n = cfg.seed_bbox
    fr_tmp = LocalFrame((s + n) / 2, (w + e) / 2, 0.0)
    union_en = unary_union([fr_tmp.geom_en(fix(shape(f["geometry"]))) for _, f in selected])
    c_lon, c_lat = fr_inverse(fr_tmp, union_en.centroid.x, union_en.centroid.y)
    origin = {"lat": round(c_lat, 6), "lon": round(c_lon, 6)}
    fr0 = LocalFrame(origin["lat"], origin["lon"], 0.0)
    face_en = fr0.geom_en(poly_ll) if poly_ll is not None else None
    lots_en = [fr0.geom_en(fix(shape(f["geometry"]))) for _, f in selected]
    rotation, rotation_basis = _main_street_rotation(cfg, osm, face_en, lots_en, fr0)
    fr = LocalFrame(origin["lat"], origin["lon"], rotation)

    def L(g):  # lon/lat geometry -> local frame
        return fr.geom_xy(fix(g))

    # layers in the local frame
    def layer(name):
        return [(f["properties"], L(shape(f["geometry"]))) for f in cache.read_json(f"{cfg.id}/{name}")["features"]
                if f.get("geometry")]

    zoning = layer("zoning")
    overlays = layer("overlays")
    slope = unary_union([g for _, g in layer("slope25")]) if layer("slope25") else None
    under = unary_union([g for _, g in layer("undermined")]) if layer("undermined") else None
    lotdim: dict[str, dict] = {}
    for props, _g in sorted(layer("lotdim"), key=lambda t: (t[0].get("pin") or "", t[1].wkt)):
        pin = props.get("pin")
        if pin and pin not in lotdim:
            lotdim[pin] = props
    blds = sorted(layer("buildings"), key=lambda t: t[0].get("Building_Footprints_OBJECTID") or t[0]["OBJECTID"])
    assess = _assessments(cache, cfg)
    city = read_city_owned(cache.read("city_owned"))

    parcels = []
    lot_geoms: dict[str, Any] = {}
    for pin, f in selected:
        g = L(shape(f["geometry"]))
        lot_geoms[pin] = g
    buildings_out = []
    lot_buildings: dict[str, list[str]] = {pin: [] for pin in lot_geoms}
    face_xy = fr.geom_xy(poly_ll) if poly_ll is not None else None
    for props, g in blds:
        oid = props.get("Building_Footprints_OBJECTID") or props["OBJECTID"]
        cen = g.centroid
        owner_lot = None
        for pin, lg in lot_geoms.items():
            if lg.contains(cen):
                owner_lot = pin
                break
        if owner_lot is None:
            continue
        bid = f"b{oid}"
        lot_buildings[owner_lot].append(bid)
        a = assess.get(owner_lot) or {}
        polys = polygons(g)
        buildings_out.append({
            "id": bid,
            "poly": poly_rings(max(polys, key=lambda p: p.area)) if len(polys) == 1 else [poly_rings(p) for p in polys],
            "lot_pin": owner_lot,
            "material": a.get("EXTFINISH_DESC"),
            "source": "Building_Footprints_Adjacency (2023)",
        })

    for pin, f in selected:
        g = lot_geoms[pin]
        area = g.area
        lot, suffix = pin_lot(pin)
        a = assess.get(pin)
        co = city.get(pin)
        # address
        if co and co.get("address"):
            hn, st = split_address(co["address"])
            addr = addr_display(hn, st)
            addr_source = "city_owned"
            street_raw = st
        elif a:
            street_raw = (a.get("PROPERTYADDRESS") or "").strip()
            addr = addr_display(str(a.get("PROPERTYHOUSENUM") or ""), street_raw) if street_raw else None
            addr_source = "assessment" if street_raw else None
        else:
            addr, addr_source, street_raw = None, None, None
        # zoning
        zone, zone_frac = None, 0.0
        best = 0.0
        for props, zg in zoning:
            ov = g.intersection(zg).area
            if ov > best:
                best, zone = ov, props.get("zon_new")
        zone_frac = _frac(best, area)
        ovl = sorted({props.get("overlay") for props, og in overlays
                      if props.get("overlay") and g.intersection(og).area / area >= COVER_MIN_FRAC})
        deed = parse_legal1(a.get("LEGAL1") if a else None)
        assessed = _num_or_none(a.get("LOTAREA")) if a else None
        deed_area = round(deed["front"] * deed["depth"], 1) if deed else None
        mapped = r1(area)
        if assessed in (None, 0):
            recon = {"state": "no_assessment", "ratio": None}
        else:
            ratio = area / assessed
            if abs(ratio - 1) > RECON_TOLERANCE:
                state = "records_disagree"
            elif deed is None:
                state = "no_deed"
            else:
                state = "ok"
            recon = {"state": state, "ratio": round(ratio, 3)}
        if deed_area is not None and float(deed_area).is_integer():
            deed_area = int(deed_area)
        recon.update({"assessed": assessed, "mapped": mapped, "deed_area": deed_area})
        # built
        use = (a.get("USEDESC") if a else None)
        yb = _num_or_none(a.get("YEARBLT")) if a else None
        evidence = []
        if lot_buildings[pin]:
            evidence.append("footprint")
        if yb is not None and (use or "").upper() not in VACANT_USES:
            evidence.append("assessment")
        ld = lotdim.get(pin)
        rp = g.representative_point()
        parcels.append({
            "pin": pin,
            "lot": lot,
            "lot_suffix": suffix,
            "mapblocklo": f["properties"].get("mapblocklo"),
            "addr": addr,
            "addr_source": addr_source,
            "addr_street": normalize_street(street_raw),
            "poly": poly_rings(max(polygons(g), key=lambda p: p.area)),
            "rep_point": [r2(rp.x), r2(rp.y)],
            "zone": zone,
            "zone_frac": zone_frac,
            "overlays": ovl,
            "assess": None if a is None else {
                "lotarea": assessed,
                "use": use,
                "class": a.get("CLASSDESC"),
                "ownercat": a.get("OWNERDESC"),
                "yearbuilt": yb,
                "stories": _num_or_none(a.get("STORIES")),
                "finish": a.get("EXTFINISH_DESC"),
                "sqft": _num_or_none(a.get("FINISHEDLIVINGAREA")),
                "legal": (a.get("LEGAL1") or "").strip() or None,
                "asof": a.get("ASOFDATE"),
            },
            "deed": deed,
            "city": None if co is None else {
                "status": co["current_status"] or None,
                "inventory": co["inventory_type"] or None,
                "status_updated": co["last_updated"] or None,
                "zoned_as": co["zoned_as"] or None,
                "class": co["class"] or None,
                "sq_ft": _num_or_none(co["parc_sq_ft"]),
            },
            "built": bool(evidence),
            "built_evidence": evidence,
            "building_ids": sorted(lot_buildings[pin]),
            "slope25": _frac(g.intersection(slope).area, area) if slope is not None else 0.0,
            "undermined": _frac(g.intersection(under).area, area) if under is not None else 0.0,
            "mapped_area": mapped,
            "lotdim": None if ld is None else {
                "width": r1(ld["Parcel_Width"]) if ld.get("Parcel_Width") is not None else None,
                "len": r1(ld["Parcel_Len"]) if ld.get("Parcel_Len") is not None else None,
            },
            "recon": recon,
        })
    parcels.sort(key=lambda p: p["pin"])
    buildings_out.sort(key=lambda b: (b["lot_pin"], b["id"]))

    # streets: named OSM ways clipped to the parcels' local bbox plus a margin
    ux = unary_union(list(lot_geoms.values()))
    minx, miny, maxx, maxy = ux.bounds
    clip = box(minx - STREET_MARGIN_FT, miny - STREET_MARGIN_FT, maxx + STREET_MARGIN_FT, maxy + STREET_MARGIN_FT)
    streets = []
    for way in _osm_named_ways(osm):
        ls = LineString([fr.xy(p["lon"], p["lat"]) for p in way["geometry"]])
        for piece in lines(ls.intersection(clip)):
            if piece.length < 1:
                continue
            streets.append({
                "name": way["tags"]["name"],
                "osm_id": way["id"],
                "highway": way["tags"].get("highway"),
                "line": ring_xy(piece.coords),
            })
    streets.sort(key=lambda s: (s["name"], s["osm_id"], s["line"]))

    # hazard polygons clipped to the block face
    region = face_xy if face_xy is not None else clip

    def clip_polys(gg):
        if gg is None:
            return []
        out = [poly_rings(p) for p in polygons(gg.intersection(region)) if p.area >= 1.0]
        return sorted(out)

    # historic zoning at the block centroid
    cpt = Point(origin["lon"], origin["lat"])
    hist = {}
    for year in sorted(S.HIST_ZONING):
        val = None
        for feat in json.loads(cache.read(f"hist_zoning_{year}"))["features"]:
            if feat.get("geometry") and shape(feat["geometry"]).buffer(0).contains(cpt):
                val = HIST_FIELDS[year](feat["properties"])
                break
        hist[year] = val

    # sources and pull date (from the raw manifest, never now())
    src = [
        _source_entry(cache, f"{cfg.id}/parcels", "pgh_parcels", "City of Pittsburgh PGHParcels"),
        *[_source_entry(cache, k, "wprdc_assessments", "WPRDC Allegheny County Property Assessments",
                        f"https://data.wprdc.org/datastore/dump/{S.ASSESSMENT_RESOURCE}")
          for k in _assessment_keys(cache, cfg)[:1]],
        _source_entry(cache, "city_owned", "city_owned", "City of Pittsburgh City-Owned Properties (WPRDC)"),
        _source_entry(cache, f"{cfg.id}/lotdim", "lot_dimensions", S.LAYERS["lotdim"][2]),
        _source_entry(cache, f"{cfg.id}/buildings", "building_footprints", S.LAYERS["buildings"][2]),
        _source_entry(cache, f"{cfg.id}/zoning", "zoning", S.LAYERS["zoning"][2]),
        _source_entry(cache, f"{cfg.id}/overlays", "zoning_overlays", S.LAYERS["overlays"][2]),
        _source_entry(cache, f"{cfg.id}/slope25", "slope25", S.LAYERS["slope25"][2]),
        _source_entry(cache, f"{cfg.id}/undermined", "undermined", S.LAYERS["undermined"][2]),
        _source_entry(cache, f"{cfg.id}/osm", "osm_streets", "OpenStreetMap (Overpass API), ODbL"),
        *[_source_entry(cache, f"hist_zoning_{y}", f"hist_zoning_{y}", f"WPRDC Historic Zoning {y}")
          for y in sorted(S.HIST_ZONING)],
    ]
    used = [f"{cfg.id}/{k}" for k in ("osm", "parcels", *S.LAYERS)] + _assessment_keys(cache, cfg) + \
        ["city_owned"] + [f"hist_zoning_{y}" for y in S.HIST_ZONING]
    pulled = max(cache.entry(k)["fetched_at"] for k in used)

    meta = {
        "id": cfg.id,
        "name": cfg.name,
        "neighborhood": cfg.neighborhood,
        "ward": cfg.ward,
        "pulled": pulled,
        "raw_cache": f"data/raw/{cache.date}",
        "sources": src,
        "origin": origin,
        "rotation_deg": rotation,
        "rotation_basis": rotation_basis,
        "frame": "local feet; x along main street; y down",
        "north": "screen-up rotated clockwise by rotation_deg",
        "main_street": cfg.main_street,
        "bounding_streets": list(cfg.bounding_streets),
        "selection": selection,
        "counts_note": None,  # set below; tests check it against the parcels
        "recon_tolerance": RECON_TOLERANCE,
        "pipeline_version": PIPELINE_VERSION,
    }
    out = {
        "meta": meta,
        "streets": streets,
        "parcels": parcels,
        "buildings": buildings_out,
        "slope": clip_polys(slope),
        "undermined": clip_polys(under),
        "hist_zoning": hist,
    }
    meta["counts_note"] = cfg.counts_note
    return out


def dumps(obj: Any) -> str:
    return json.dumps(obj, sort_keys=True, indent=1, ensure_ascii=False) + "\n"


def write_block(block: dict, out_dir: Path = OUT_DIR) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    p = out_dir / f"{block['meta']['id']}.json"
    p.write_text(dumps(block))
    return p
