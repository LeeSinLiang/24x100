# pipeline/

Python fetches public records, joins them, reconciles them, and writes JSON for the engine. It never
computes an envelope. Every output file carries its pull time and sources.

## Commands

Run from the repo root (the uv env is Python 3.12).

| Command | Does |
|---|---|
| `uv run python -m pipeline block --id 10K` | Fetch anything missing from today's raw cache (`data/raw/<today>/`), then write `data/blocks/10K.json` and the G1 cross-check `data/blocks/10K.crosscheck.json`. |
| `uv run python -m pipeline block --id 10K --offline` | No network. Process the newest raw cache that has every input. |
| `uv run python -m pipeline money [--offline]` | Write `data/money/comps_ward5.json` and `data/money/hud_fy2026.json`. Exits 1 if the HUD file could not be fetched; comps are still written. |
| `uv run python -m pipeline money --offline --snapshot pipeline/tests/fixtures/ward5_sales_<date>.json` | Also write the filtered, joined sales snapshot used by the tests. |
| `uv run python -m pipeline money --hud-file ~/Downloads/Section8-FY26.xlsx` | Ingest a HUD workbook a person downloaded in a browser (huduser.gov challenges scripts; see below). It is cached with its sha256 and a `manual_download` note, then processed. |
| `uv run python -m pipeline crosscheck --id 10K [--fixture PATH]` | Re-run only the G1 comparison against the research fixture. |
| `uv run python -m pipeline all [--offline]` | Runs `block --id 10K` and then `money`. |
| `uv run pytest -q pipeline/tests` | Tests (no network). The determinism test and the raw-cache privacy test skip when `data/raw/` is absent. |

`--date YYYY-MM-DD` pins a specific raw cache folder.

## Raw cache and determinism

- Every response is saved once to `data/raw/<YYYY-MM-DD>/<key>.<ext>`, which is gitignored.
- `manifest.json` records the `url`, `params` (or `post_data`), `fetched_at` (UTC), `sha256` and byte count of each file.
- If a key is requested with different parameters, the cached file is stale. Online it is refetched; with `--offline` the run stops with an error.
- Processing reads only the cache, so re-running it gives byte-identical JSON (a test checks this):
  - parcels are sorted by PIN;
  - coordinates are rounded to 0.01 ft and areas to 0.1 sf;
  - JSON is written with `sort_keys=True, indent=1`;
  - `pulled` comes from the manifest, never from `now()`.
- Failures are retried with backoff and then reported. No value is ever invented.

## Privacy

- **Never requested:** owner names and mailing addresses. The pipeline never asks for `PROPERTYOWNER`, `CHANGENOTICE*` or `TAXBILL*`. `OWNERDESC` (the owner *category*) is the only owner field kept; it is output as `ownercat`.
- **City-Owned Properties:** the CSV's `owner` column is dropped before the file is cached, and dropped again on read. The manifest records `sha256_response` for the original bytes and a note on the transform.
- **Sales:** we request only `PARID, FULL_ADDRESS, MUNICODE, SALEDATE, PRICE, SALEDESC, INSTRTYPDESC`. The sales file has no party names.
- **Not used:** the County `AlCoParcels` service, because it carries owner names.
- **Enforced:** `tests/test_privacy.py` walks every JSON file under `data/blocks`, `data/money` and the test fixtures, and fails on owner, mailing, change-notice or tax-bill keys, or on "City of Pittsburgh" as a value. It also checks that it catches those on mutated input.

## Sources (all verified 26 Sep 2026)

| id | Source | URL |
|---|---|---|
| `pgh_parcels` | City PGHParcels (`pin, mapblocklo, parid`) | `https://services1.arcgis.com/YZCmUqbcsUpOKfj7/arcgis/rest/services/PGHParcels/FeatureServer/0/query` |
| `lot_dimensions` | City Residential Lot Dimensions (Feb 2025) | `…/Parcels_Exp_02052025_Residential_Lot_Dimensions/FeatureServer/0/query` |
| `building_footprints` | City Building Footprints (2023) | `…/Building_Footprints_Adjacency/FeatureServer/0/query` |
| `zoning` | City zoning (`zon_new`) | `…/PGHWebZoning/FeatureServer/0/query` |
| `zoning_overlays` | City zoning overlays | `…/PGHWebZoningOverlays/FeatureServer/0/query` |
| `slope25` | City 25%+ slope | `…/PGHWebSlope25/FeatureServer/0/query` |
| `undermined` | City undermined areas | `…/PGHWebUndermined/FeatureServer/0/query` |
| `wprdc_assessments` | Allegheny County Property Assessments (CKAN `datastore_search`, ≤ 60 PINs per call) | `https://data.wprdc.org/api/3/action/datastore_search?resource_id=65855e14-549e-4992-b5be-d629afc676fa` |
| `city_owned` | City-Owned Properties (CSV dump) | `https://data.wprdc.org/datastore/dump/e1dcee82-9179-4306-8167-5891915b62a7` |
| `osm_streets` | OpenStreetMap via Overpass (ODbL) | `https://overpass.kumi.systems/api/interpreter` |
| `hist_zoning_1927/1958/1967` | WPRDC historic zoning GeoJSON | see `sources.py` `HIST_ZONING` |
| sales | Allegheny County Real Estate Sales (CKAN, `MUNICODE` 105 = Ward 5) | `https://data.wprdc.org/api/3/action/datastore_search?resource_id=5bbe6c55-bce6-4edb-9d04-68edeb6bf7b1` |
| HUD | FY2026 Section 8 Income Limits (xlsx) | `https://www.huduser.gov/portal/datasets/il/il26/Section8-FY26.xlsx` |

ArcGIS queries use an envelope in EPSG:4326 (`outSR=4326&f=geojson`). The envelope is the block's
OSM street polygon plus 0.0004°. The seed box in `block.py` only locates the streets.

## Block file · `data/blocks/<id>.json`

The schema is PLAN.md §2.1. What each field means and how it is made:

### meta

| Field | Meaning |
|---|---|
| `pulled` | Latest `fetched_at` of the raw files used. |
| `raw_cache` | The raw cache folder that was processed. |
| `sources[]` | `{id, name, url, pulled, sha256}` for each input. |
| `origin` | `{lat, lon}`: centroid of the selected parcels, rounded to 1e-6°. This is the local frame's origin. |
| `rotation_deg` | Angle of the main street, in degrees counterclockwise from east. |
| `rotation_basis` | How the angle was measured (see below). |
| `frame` | Local feet. `x = e·cos r + n·sin r`, `y = e·sin r − n·cos r`, where `e = (lon − lon0)·cos(lat0)·364000` and `n = (lat − lat0)·364000`. So x runs along the main street and y points down. |
| `north` | North is screen-up rotated clockwise by `rotation_deg`. |
| `selection` | `"rep-point inside OSM street polygon"`: the parcels whose `representative_point()` lies inside the polygon that the four bounding streets' OSM centerlines polygonize into. If that fails, parcels are selected by PIN prefix and this field says so. |
| `counts_note` | Human note on lot and plan counts. `tests/test_block.py` checks every claim in it against the parcels. |
| `recon_tolerance` | `0.10`. |

How `rotation_deg` is measured:

- It is the length-weighted mean direction of the parcel edges that face the main street: edges within 35 ft of its OSM centerline and within 10° of the centerline chord. Those edges form the right-of-way line.
- If fewer than 3 such edges exist, it falls back to the OSM centerline chord.
- The direction is chosen so the block lies to its left. With y pointing down, main-street lots therefore sit **above** the street.

### parcels[]

| Field | Meaning |
|---|---|
| `lot`, `lot_suffix` | County lot number from the PIN: `0010K00028000A00` → `28`, `"A"`. |
| `mapblocklo` | As given by PGHParcels. |
| `addr`, `addr_source` | From City-Owned Properties when the PIN is there (`city_owned`). Otherwise from the assessment house number and street (`assessment`); a house number of 0 displays as "Mahon St (no number)". Title case. |
| `addr_street` | Street name normalized to the OSM form ("Mahon Street"), for front detection. |
| `poly`, `rep_point` | Local-frame rings, outer ring first, closed. |
| `zone`, `zone_frac` | `zon_new` of the zoning polygon with the largest overlap, and the fraction of the lot it covers. |
| `overlays` | Overlay names covering at least 0.5% of the lot. |
| `slope25`, `undermined` | Fraction of the lot covered by the union of those polygons (0–1, 3 decimals). |
| `assess` | `{lotarea, use, class, ownercat, yearbuilt, stories, finish, sqft, legal, asof}`. `sqft` is `FINISHEDLIVINGAREA`. `null` if the assessment has no record. |
| `deed` | LEGAL1 parsed to `{plan, plan_lot, part, front, depth, dims, parsed_from}`. `plan` is the text up to "PLAN", title-cased and never expanded. `plan_lot` is the lot designation between PLAN and LOT: a single number when there is one ("67"), otherwise the text ("79-80-81"). `part` is true when "PT"/"PTS" appears. `front` × `depth` are the first `N X N` in the text; `dims` is the full dimension string ("24X100X24"). A missing plan lot stays `null` and is never inferred. No `N X N` → `deed: null`. |
| `city` | City-Owned Properties row `{status, inventory, status_updated, zoned_as, class, sq_ft}`, or `null` if the parcel is not in City inventory. |
| `built`, `built_evidence`, `building_ids` | `built` is true if a footprint's centroid lies in the lot (`"footprint"`), or if the assessment `YEARBLT` is set and the use is not vacant land (`"assessment"`). |
| `mapped_area` | Shapely area of the local polygon, in sf. |
| `lotdim` | `{width, len}` from the City Residential Lot Dimensions layer by PIN. `null` if the layer has no row for the PIN. |
| `recon` | `{state, ratio, assessed, mapped, deed_area}`. `ratio = mapped / assessed`. State: `no_assessment` (no LOTAREA); `records_disagree` when \|ratio − 1\| > tolerance; `no_deed` when LEGAL1 has no dimensions; otherwise `ok`. `deed_area = front × depth`. For `part` lots this is the plan lot's area, not the parcel's. |

### Other top-level keys

| Key | Meaning |
|---|---|
| `buildings[]` | `{id: "b<Building_Footprints_OBJECTID>", poly, lot_pin, material, source}`. A footprint belongs to the lot that contains its centroid. `material` is that lot's assessment `EXTFINISH_DESC`. |
| `streets[]` | OSM ways that have a `name`, clipped to the parcels' bbox plus 120 ft: `{name, osm_id, highway, line}`. A way cut into pieces appears once per piece. |
| `slope`, `undermined` | Hazard polygons clipped to the block's street polygon: a list of polygons, each a list of rings. |
| `hist_zoning` | District at the block centroid. 1927 is `Zoning_District` + `Combined_District`; 1958 is `Zoning_District1958`; 1967 is `Zoning_District`. |

## G1 cross-check · `data/blocks/10K.crosscheck.json`

This compares our file with the pre-kickoff research fixture
(`ai-horizons-research/design-proposals/plate/data/block_10K_mahon.json`, read-only), per lot:

- mapped area;
- bbox width and height, each in its own file's frame;
- order along Mahon St.

Pass = every Mahon-row lot within 2% on all three, and the same order.

The fixture squared its frame to the Wylie Ave centerline (29.157°); ours is squared to the Mahon
frontage (29.537°). The file therefore also reports:

- our bbox after rotating our polygons into the fixture's rotation;
- the minimum rotated rectangle, which does not depend on the frame.

## Money · `data/money/`

### `comps_ward5.json` (PLAN.md §2.6)

**Filter.** Ward 5 (`MUNICODE` 105) sales with `SALEDESC == "VALID SALE"`, `PRICE >= 10000` and
`SALEDATE >= 2023-01-01`. Each is joined to the assessment by PARID, and we keep `USEDESC` in
{SINGLE FAMILY, ROWHOUSE, TOWNHOUSE, TWO FAMILY}.

**Fields.**

| Field | Meaning |
|---|---|
| `counts.transfers` | Ward 5 transfers since 2023-01-01. |
| `counts.valid` | Valid sales at ≥ $10,000 since 2023-01-01. |
| `counts.valid_1_2_unit` | Of those, the 1–2 unit homes. |
| `counts.transfers_all_dates`, `counts.valid_all_dates` | The same counts over the whole sales file (from 2012). The team's 26 Sep fixture quoted these (2,274 / 114) next to "since 2023". |
| `median`, `q1`, `q3` | `statistics.quantiles(n=4, method="inclusive")`: Hyndman-Fan type 7, the numpy and Excel `QUARTILE.INC` default. The exclusive method (type 6) is also recorded; it gives q1 = $103,500. |
| `newest` | The newest-built comparable. |
| `newest_built` | Top 3 by `YEARBLT`, ties broken by sale date. |
| `sales[]` | `{parid, address, saledate, price, use, yearbuilt, sqft}`. `address` is the property address only. |
| `excluded_by_use[]` | Valid recent sales dropped by the use filter. |

**Test snapshot.** `pipeline/tests/fixtures/ward5_sales_2026-09-26.json` holds the 26 Sep snapshot:
the filtered, joined records plus the upstream counts. `tests/test_money.py` checks that it
reproduces the fixture: 33 sales, median $155,000, IQR $105,000–$235,000, newest 2125 Rose St
(built 2025, $240,000, 1,442 sq ft).

### `hud_fy2026.json`

From the HUD FY2026 Section 8 income-limits workbook, the row with
`hud_area_code == METRO38300M38300` and county Allegheny. It holds `median_family_income`,
`l50_1..8` and `l80_1..8`, with the file URL, the file's sha256 and the pull time.

huduser.gov is behind an AWS WAF. Bursts get HTTP 202 with `x-amzn-waf-action: challenge`, a
JavaScript challenge. The pipeline does not try to pass it: it waits (60 s, then 120 s), retries,
and otherwise reports the failure and writes no HUD file.
