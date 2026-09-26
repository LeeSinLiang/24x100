"""Endpoints and the fetch step. Fetching writes only to the raw cache (data/raw/<date>/)."""
from __future__ import annotations

import json
from typing import Any

from .fetch import RawCache, drop_csv_columns, validate_ckan, validate_geojson

ARCGIS = "https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/{service}/FeatureServer/0/query"
CKAN_SEARCH = "https://data.wprdc.org/api/3/action/datastore_search"
ASSESSMENT_RESOURCE = "65855e14-549e-4992-b5be-d629afc676fa"
SALES_RESOURCE = "5bbe6c55-bce6-4edb-9d04-68edeb6bf7b1"
CITY_OWNED_RESOURCE = "e1dcee82-9179-4306-8167-5891915b62a7"
CITY_OWNED_CSV = f"https://data.wprdc.org/datastore/dump/{CITY_OWNED_RESOURCE}"
OVERPASS = "https://overpass.kumi.systems/api/interpreter"
HUD_IL_XLSX = "https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx"
HIST_ZONING = {
    "1927": "https://data.wprdc.org/dataset/2706f171-3803-4ee4-bbf7-b8e9014ce490/resource/8e9391ff-e700-49a9-929b-36fe46309ed0/download/pghzoning1927.geojson",
    "1958": "https://data.wprdc.org/dataset/c644fd38-0efb-4e47-896a-886d44d92056/resource/3796160e-2d96-48d6-81a1-088e34e4644d/download/pghzoning1958.geojson",
    "1967": "https://data.wprdc.org/dataset/a946ffe7-2900-42d3-8916-6b0e10f0e415/resource/3be6661e-0435-4b68-b31d-819d09dbce23/download/pghzoning1967.geojson",
}

# Allowed assessment fields. No owner name, mailing address, change notice or tax bill field.
ASSESSMENT_FIELDS = [
    "PARID", "PROPERTYHOUSENUM", "PROPERTYADDRESS", "CLASSDESC", "USEDESC", "LOTAREA", "OWNERDESC",
    "YEARBLT", "STORIES", "EXTFINISH_DESC", "LEGAL1", "ASOFDATE", "MUNICODE", "FINISHEDLIVINGAREA",
]
SALES_FIELDS = [
    "PARID", "FULL_ADDRESS", "MUNICODE", "SALEDATE", "PRICE", "SALEDESC", "INSTRTYPDESC",
]
CITY_OWNED_DROP = {"owner"}

# ArcGIS layers: (service, outFields, source id, display name)
LAYERS = {
    "parcels": ("PGHParcels", "pin,mapblocklo,parid", "City of Pittsburgh PGHParcels"),
    "lotdim": (
        "Parcels_Exp_02052025_Residential_Lot_Dimensions",
        "pin,Parcel_Width,Parcel_Len,Bldg_Width,Bldg_Len,Hood,zone_short",
        "City of Pittsburgh Residential Lot Dimensions (Feb 2025)",
    ),
    "buildings": ("Building_Footprints_Adjacency", "*", "City of Pittsburgh Building Footprints (2023)"),
    "zoning": ("PGHWebZoning", "zon_new,full_zoning_type", "City of Pittsburgh Zoning"),
    "overlays": ("PGHWebZoningOverlays", "overlay", "City of Pittsburgh Zoning Overlays"),
    "slope25": ("PGHWebSlope25", "*", "City of Pittsburgh 25%+ Slope"),
    "undermined": ("PGHWebUndermined", "*", "City of Pittsburgh Undermined Areas"),
}


def arcgis_url(service: str) -> str:
    return ARCGIS.format(service=service)


def arcgis_params(bbox: tuple[float, float, float, float], out_fields: str) -> dict[str, Any]:
    return {
        "where": "1=1",
        "geometry": ",".join(f"{v:.6f}" for v in bbox),
        "geometryType": "esriGeometryEnvelope",
        "inSR": "4326",
        "spatialRel": "esriSpatialRelIntersects",
        "outFields": out_fields,
        "outSR": "4326",
        "f": "geojson",
    }


def fetch_arcgis(cache: RawCache, key: str, layer: str, bbox) -> bytes:
    service, fields, _ = LAYERS[layer]
    return cache.get(key, arcgis_url(service), arcgis_params(bbox, fields), validate=validate_geojson)


def fetch_assessments(cache: RawCache, prefix: str, pins: list[str]) -> list[str]:
    """Batches of <= 60 PINs. Returns the cache keys, in batch order."""
    keys = []
    pins = sorted(set(pins))
    for i in range(0, len(pins), 60):
        batch = pins[i : i + 60]
        key = f"{prefix}/assessments_{i // 60:03d}"
        params = {
            "resource_id": ASSESSMENT_RESOURCE,
            "filters": json.dumps({"PARID": batch}),
            "limit": 200,
            "fields": ",".join(ASSESSMENT_FIELDS),
        }
        cache.get(key, CKAN_SEARCH, params, validate=validate_ckan)
        keys.append(key)
    return keys


def fetch_city_owned(cache: RawCache) -> bytes:
    return cache.get(
        "city_owned",
        CITY_OWNED_CSV,
        ext="csv",
        transform=lambda b: drop_csv_columns(b, CITY_OWNED_DROP),
        transform_note="dropped column 'owner' before caching (no owner names on disk)",
    )


def overpass_query(bbox: tuple[float, float, float, float]) -> str:
    w, s, e, n = bbox
    return f'[out:json][timeout:60];way["highway"]({s:.6f},{w:.6f},{n:.6f},{e:.6f});out geom;'


def fetch_osm(cache: RawCache, key: str, bbox) -> bytes:
    def validate(body: bytes) -> None:
        j = json.loads(body)
        if "elements" not in j:
            raise ValueError("Overpass: no elements")
        if j.get("remark") and "error" in j["remark"].lower():
            raise ValueError(f"Overpass remark: {j['remark']}")

    return cache.get(key, OVERPASS, method="POST", data={"data": overpass_query(bbox)}, validate=validate)


def fetch_hist_zoning(cache: RawCache) -> dict[str, bytes]:
    out = {}
    for year, url in HIST_ZONING.items():
        out[year] = cache.get(f"hist_zoning_{year}", url, ext="geojson")
    return out


def fetch_sales(cache: RawCache, municode: str, page: int = 5000) -> list[str]:
    """All sales records for one MUNICODE (all dates), paged; returns cache keys."""
    keys: list[str] = []
    offset = 0
    total = None
    while total is None or offset < total:
        key = f"sales_{municode}/page_{offset // page:03d}"
        params = {
            "resource_id": SALES_RESOURCE,
            "filters": json.dumps({"MUNICODE": municode}),
            "limit": page,
            "offset": offset,
            "fields": ",".join(SALES_FIELDS),
            "sort": "_id asc",
        }
        body = cache.get(key, CKAN_SEARCH, params, validate=validate_ckan)
        j = json.loads(body)
        total = j["result"]["total"]
        keys.append(key)
        offset += page
    return keys


def fetch_hud(cache: RawCache) -> bytes:
    def validate(body: bytes) -> None:
        if body[:2] != b"PK":
            raise ValueError("HUD file is not an xlsx (zip) payload")

    # huduser.gov sits behind an AWS WAF that answers bursts with a JS challenge (HTTP 202,
    # x-amzn-waf-action: challenge). We do not try to pass the challenge; we wait and retry.
    return cache.get("hud_il_fy2026", HUD_IL_XLSX, ext="xlsx", validate=validate, retries=3, backoff=60.0)
