"""G1 cross-check: our block file vs the pre-kickoff research fixture (read-only).

The two files use different frames (the fixture squared the block to Wylie Ave), so we compare
per-lot values that survive a change of frame: mapped area, bounding-box width/height in each
file's own frame, and the order of lots along the street. As diagnostics we also report the
bounding box of our polygon re-rotated into the fixture's rotation, and the minimum rotated
rectangle (fully rotation-invariant).
"""
from __future__ import annotations

import hashlib
import json
import math
import warnings
from pathlib import Path
from typing import Any

from shapely import affinity
from shapely.geometry import LineString, Point, Polygon
from shapely.ops import unary_union

DEFAULT_FIXTURE = Path(
    "/Users/sllee/coding/ai-horizons-research/design-proposals/plate/data/block_10K_mahon.json"
)
TOLERANCE = 0.02


def _bbox_wh(p: Polygon) -> tuple[float, float]:
    minx, miny, maxx, maxy = p.bounds
    return maxx - minx, maxy - miny


def _mrr(p: Polygon) -> tuple[float, float]:
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        r = p.minimum_rotated_rectangle
    cs = list(r.exterior.coords)
    a, b = math.dist(cs[0], cs[1]), math.dist(cs[1], cs[2])
    return (min(a, b), max(a, b))


def _rel(a: float, b: float) -> float:
    return abs(a - b) / b if b else float("inf")


def main_street_row(block: dict) -> set[str]:
    """PINs whose representative point is closer to the main street than to the opposite
    bounding street (the bounding street most nearly parallel to the main street)."""
    from .block import BLOCKS

    cfg = BLOCKS[block["meta"]["id"]]
    main = block["meta"]["main_street"]
    by_name: dict[str, list[LineString]] = {}
    for s in block["streets"]:
        by_name.setdefault(s["name"], []).append(LineString(s["line"]))

    def direction(name: str) -> float:
        ls = unary_union(by_name[name])
        cs = [c for g in getattr(ls, "geoms", [ls]) for c in g.coords]
        a, b = min(cs), max(cs)
        return math.degrees(math.atan2(b[1] - a[1], b[0] - a[0])) % 180.0

    def dd(a: float, b: float) -> float:
        d = abs(a - b) % 180.0
        return min(d, 180.0 - d)

    others = [n for n in cfg.bounding_streets.values() if n != main and n in by_name]
    opposite = min(others, key=lambda n: dd(direction(n), direction(main)))
    m, o = unary_union(by_name[main]), unary_union(by_name[opposite])
    return {p["pin"] for p in block["parcels"] if m.distance(Point(p["rep_point"])) < o.distance(Point(p["rep_point"]))}


def crosscheck(block: dict, fixture_path: Path = DEFAULT_FIXTURE) -> dict[str, Any]:
    raw = fixture_path.read_bytes()
    fx = json.loads(raw)
    fx_rot = float(fx["rotation_deg"])
    our_rot = float(block["meta"]["rotation_deg"])
    d_rot = our_rot - fx_rot
    fx_by_pin = {p["pin"]: p for p in fx["parcels"]}
    ours = {p["pin"]: p for p in block["parcels"]}
    main = block["meta"]["main_street"]
    row_pins = main_street_row(block)
    main_row = sorted((p for p in block["parcels"] if p["pin"] in row_pins), key=lambda p: p["pin"])
    rows = []
    for p in block["parcels"]:
        pin = p["pin"]
        f = fx_by_pin.get(pin)
        if f is None:
            continue
        op = Polygon(p["poly"][0], p["poly"][1:])
        fp = Polygon(f["poly"][0])
        ow, oh = _bbox_wh(op)
        fw, fh = _bbox_wh(fp)
        # our polygon expressed in the fixture's rotation: rotate the local frame by d_rot
        # (local frame is y-down; rotating the map by +d_rot CCW east-north is -d_rot in y-down coords)
        rp = affinity.rotate(op, -d_rot, origin=(0, 0))
        rw, rh = _bbox_wh(rp)
        om, fm = _mrr(op), _mrr(fp)
        checks = {
            "area": _rel(op.area, fp.area),
            "bbox_w": _rel(ow, fw),
            "bbox_h": _rel(oh, fh),
        }
        rows.append({
            "pin": pin,
            "lot": p["lot"],
            "lot_suffix": p["lot_suffix"],
            "main_street_row": p in main_row,
            "ours": {"area": round(op.area, 1), "bbox_w": round(ow, 2), "bbox_h": round(oh, 2),
                     "bbox_w_in_fixture_rotation": round(rw, 2), "bbox_h_in_fixture_rotation": round(rh, 2),
                     "mrr": [round(v, 2) for v in om]},
            "fixture": {"area": round(fp.area, 1), "bbox_w": round(fw, 2), "bbox_h": round(fh, 2),
                        "mrr": [round(v, 2) for v in fm]},
            "rel_diff": {k: round(v, 4) for k, v in checks.items()},
            "rel_diff_same_rotation": {"bbox_w": round(_rel(rw, fw), 4), "bbox_h": round(_rel(rh, fh), 4)},
            "rel_diff_mrr": {"short": round(_rel(om[0], fm[0]), 4), "long": round(_rel(om[1], fm[1]), 4)},
            "pass": all(v <= TOLERANCE for v in checks.values()),
        })
    rows.sort(key=lambda r: r["pin"])

    # order along the street: polygon centroid x in each file's own frame, main-street row
    common_main = [p for p in main_row if p["pin"] in fx_by_pin]
    our_order = [p["pin"] for p in sorted(common_main, key=lambda p: Polygon(p["poly"][0]).centroid.x)]
    fx_order = [pin for pin in sorted((p["pin"] for p in common_main), key=lambda q: Polygon(fx_by_pin[q]["poly"][0]).centroid.x)]
    # split lots sit front/back at the same x; compare order of County lot numbers
    def lots_seq(order):
        seq = []
        for pin in order:
            lot = ours[pin]["lot"]
            if not seq or seq[-1] != lot:
                seq.append(lot)
        return seq

    order_ok = lots_seq(our_order) == lots_seq(fx_order)
    main_rows = [r for r in rows if r["main_street_row"]]
    failing = [r["pin"] for r in main_rows if not r["pass"]]
    fail_same_rot = [r["pin"] for r in main_rows
                     if not (r["rel_diff"]["area"] <= TOLERANCE and all(v <= TOLERANCE for v in r["rel_diff_same_rotation"].values()))]
    only_ours = sorted(set(ours) - set(fx_by_pin))
    only_fx = sorted(set(fx_by_pin) - set(ours))
    worst = {k: max((r["rel_diff"][k] for r in main_rows), default=None) for k in ("area", "bbox_w", "bbox_h")}
    worst_same = {k: max((r["rel_diff_same_rotation"][k] for r in main_rows), default=None) for k in ("bbox_w", "bbox_h")}
    explanation = (
        f"Frames differ by {d_rot:.3f} deg (fixture squared to the Wylie Ave centerline, ours to the "
        f"{main} frontage line). Mapped areas agree within {worst['area']:.2%} and bbox heights within "
        f"{worst['bbox_h']:.2%} on every {main} row lot; own-frame bbox widths differ by up to "
        f"{worst['bbox_w']:.2%} because lots are slight parallelograms and a {abs(d_rot):.2f} deg turn moves a "
        f"~100 ft side by ~{100 * math.sin(math.radians(abs(d_rot))):.2f} ft. With our polygons re-rotated into the "
        f"fixture's rotation, bbox widths agree within {worst_same['bbox_w']:.2%} and heights within "
        f"{worst_same['bbox_h']:.2%}."
    )
    return {
        "meta": {
            "block": block["meta"]["id"],
            "block_pulled": block["meta"]["pulled"],
            "fixture": "/".join(fixture_path.parts[-5:]),
            "fixture_sha256": hashlib.sha256(raw).hexdigest(),
            "fixture_pulled": fx.get("meta", {}).get("pulled"),
            "tolerance": TOLERANCE,
            "rotation_ours": our_rot,
            "rotation_fixture": round(fx_rot, 3),
            "rotation_difference_deg": round(d_rot, 3),
            "method": "per-lot mapped area, bbox width/height in each file's own frame, lot order along "
                      f"{main}; pass = every {main} row lot within tolerance on all three and the same order",
        },
        "result": {
            "pass": not failing and order_ok and not only_fx,
            "pass_after_removing_rotation_difference": not fail_same_rot and order_ok and not only_fx,
            "main_street_row_lots": len(main_rows),
            "main_street_row_failing": failing,
            "worst_rel_diff_main_row": worst,
            "worst_rel_diff_main_row_same_rotation": worst_same,
            "explanation": explanation,
            "order_matches": order_ok,
            "order_ours": lots_seq(our_order),
            "order_fixture": lots_seq(fx_order),
            "parcels_compared": len(rows),
            "parcels_failing_any_row": [r["pin"] for r in rows if not r["pass"]],
            "main_row_failing_after_removing_rotation_difference": fail_same_rot,
            "only_in_ours": only_ours,
            "only_in_fixture": only_fx,
        },
        "parcels": rows,
    }
