"""Local frame and geometry helpers (shapely, planar feet)."""
from __future__ import annotations

import math
from dataclasses import dataclass

from shapely.geometry import GeometryCollection, LineString, MultiLineString, MultiPolygon, Polygon, shape
from shapely.geometry.base import BaseGeometry
from shapely.ops import polygonize, transform, unary_union

FT_PER_DEG = 364000.0


@dataclass(frozen=True)
class LocalFrame:
    """Equirectangular feet around (lat0, lon0), rotated so the main street runs along +x.

    rotation_deg is the angle of the main-street direction, counterclockwise from east.
    Local x = along the street, y points DOWN (SVG). North in this frame points along
    (sin r, -cos r): screen-up rotated clockwise by rotation_deg.
    """

    lat0: float
    lon0: float
    rotation_deg: float = 0.0

    @property
    def kx(self) -> float:
        return math.cos(math.radians(self.lat0)) * FT_PER_DEG

    @property
    def ky(self) -> float:
        return FT_PER_DEG

    def en(self, lon: float, lat: float) -> tuple[float, float]:
        """East/north feet (unrotated, y up)."""
        return (lon - self.lon0) * self.kx, (lat - self.lat0) * self.ky

    def xy(self, lon: float, lat: float) -> tuple[float, float]:
        e, n = self.en(lon, lat)
        a = math.radians(self.rotation_deg)
        c, s = math.cos(a), math.sin(a)
        return e * c + n * s, e * s - n * c

    def lonlat(self, x: float, y: float) -> tuple[float, float]:
        a = math.radians(self.rotation_deg)
        c, s = math.cos(a), math.sin(a)
        e = x * c + y * s
        n = x * s - y * c
        return self.lon0 + e / self.kx, self.lat0 + n / self.ky

    def geom_en(self, g: BaseGeometry) -> BaseGeometry:
        return transform(lambda x, y, z=None: self._vec_en(x, y), g)

    def geom_xy(self, g: BaseGeometry) -> BaseGeometry:
        return transform(lambda x, y, z=None: self._vec_xy(x, y), g)

    def _vec_en(self, xs, ys):
        if isinstance(xs, float):
            return self.en(xs, ys)
        pts = [self.en(x, y) for x, y in zip(xs, ys)]
        return [p[0] for p in pts], [p[1] for p in pts]

    def _vec_xy(self, xs, ys):
        if isinstance(xs, float):
            return self.xy(xs, ys)
        pts = [self.xy(x, y) for x, y in zip(xs, ys)]
        return [p[0] for p in pts], [p[1] for p in pts]


def geojson_geom(feature: dict) -> BaseGeometry:
    return shape(feature["geometry"])


def fix(g: BaseGeometry) -> BaseGeometry:
    return g if g.is_valid else g.buffer(0)


def polygons(g: BaseGeometry) -> list[Polygon]:
    if isinstance(g, Polygon):
        return [g]
    if isinstance(g, (MultiPolygon, GeometryCollection)):
        out = []
        for p in g.geoms:
            out += polygons(p)
        return out
    return []


def lines(g: BaseGeometry) -> list[LineString]:
    if isinstance(g, LineString):
        return [g]
    if isinstance(g, (MultiLineString, GeometryCollection)):
        out = []
        for p in g.geoms:
            out += lines(p)
        return out
    return []


def r2(v: float) -> float:
    """Round to 0.01 (coordinates) with -0.0 normalized."""
    v = round(v, 2)
    return 0.0 if v == 0 else v


def r1(v: float) -> float:
    v = round(v, 1)
    return 0.0 if v == 0 else v


def ring_xy(coords) -> list[list[float]]:
    return [[r2(x), r2(y)] for x, y in coords]


def poly_rings(p: Polygon) -> list[list[list[float]]]:
    """Rings, outer first, closed; outer counterclockwise in the y-down frame is not enforced,
    but orientation is normalized so output is stable."""
    from shapely.geometry.polygon import orient

    p = orient(p, sign=1.0)
    return [ring_xy(p.exterior.coords)] + [ring_xy(r.coords) for r in p.interiors]


def street_face(named_lines: dict[str, list[LineString]]) -> Polygon | None:
    """The one face of the polygonized street network whose boundary runs along every named street."""
    all_lines = [ls for v in named_lines.values() for ls in v]
    faces = list(polygonize(unary_union(all_lines)))
    good = []
    for f in faces:
        ok = True
        for name, ls in named_lines.items():
            shared = unary_union(ls).intersection(f.exterior.buffer(0.5))
            if shared.length < 10:
                ok = False
                break
        if ok:
            good.append(f)
    if len(good) != 1:
        return None
    return good[0]


def angle_deg(p0, p1) -> float:
    return math.degrees(math.atan2(p1[1] - p0[1], p1[0] - p0[0]))


def fabric_angle(polys: list[Polygon], near_deg: float) -> float:
    """Dominant edge direction of a set of lot polygons (length-weighted, mod 90°),
    returned as the representative closest to near_deg. Used to square the frame to the
    parcel fabric along the main street."""
    # histogram of edge directions mod 90 with length weights, refine by weighted circular mean
    samples = []
    for p in polys:
        cs = list(p.exterior.coords)
        for a, b in zip(cs, cs[1:]):
            L = math.dist(a, b)
            if L < 3:
                continue
            ang = angle_deg(a, b) % 90.0
            samples.append((ang, L))
    if not samples:
        return near_deg

    def circ_mean(sub):
        sx = sum(L * math.cos(math.radians(a * 4)) for a, L in sub)
        sy = sum(L * math.sin(math.radians(a * 4)) for a, L in sub)
        return (math.degrees(math.atan2(sy, sx)) / 4.0) % 90.0

    m = circ_mean(samples)
    # refine: keep edges within 5° of the mean (mod 90)
    def dd(a, b):
        d = (a - b) % 90.0
        return min(d, 90.0 - d)

    sub = [(a, L) for a, L in samples if dd(a, m) < 5.0]
    m = circ_mean(sub) if sub else m
    # choose the representative m + k*90 closest to near_deg
    best = min((m + k * 90.0 for k in range(-4, 5)), key=lambda v: abs(((v - near_deg + 180) % 360) - 180))
    return ((best + 180) % 360) - 180
