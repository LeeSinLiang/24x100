# pipeline/

Python fetches public records, joins them, reconciles them, and writes JSON for the engine. It never
computes an envelope. Every output file carries its pull time and sources.

## Commands

Run from the repo root (the uv env is Python 3.12).

| Command | Does |
|---|---|
| `uv run python -m pipeline block --id 10K` | Fetch anything missing from today's raw cache (`data/raw/<today>/`), then write `data/blocks/10K.json` and the G1 cross-check `data/blocks/10K.crosscheck.json`. |
| `uv run python -m pipeline block --id 0124P` | Held-out block (Larimer, R1D‑H): writes `data/blocks/0124P.json`. |
| `uv run python -m pipeline block --id 10K --offline` | No network. Process the newest raw cache that has every input. |
| `uv run python -m pipeline money [--ward N] [--offline]` | Write `data/money/comps_ward<N>.json` (default Ward 5; `--ward 12` for the held-out block) and `data/money/hud_fy2026.json`. HUD comes from the newest raw cache that holds the workbook (it may be an older pull). Exits 1 only if no raw cache has one; comps are still written. |
| `uv run python -m pipeline money --offline --snapshot pipeline/tests/fixtures/ward5_sales_<date>.json` | Also write the filtered, joined sales snapshot used by the tests. |
| `uv run python -m pipeline money --hud-file ~/Downloads/Section8-FY26.xlsx` | Ingest a HUD workbook a person downloaded in a browser (huduser.gov challenges scripts; see below). It is cached with its sha256 and a `manual_download` note, then processed. |
| `uv run python -m pipeline crosscheck --id 10K [--fixture PATH]` | Re-run only the G1 comparison against the research fixture. |
| `uv run python -m pipeline city [--offline]` | Citywide work file `data/city/work/lots_work.json` (gitignored), plus `data/city/neighborhoods.json` and `data/city/water.json`. A fresh pull takes about 10 minutes; processing about 9. |
| `uv run python -m pipeline refresh` | Re-pull every dataset into a new raw cache, re-process, and diff. Writes `data/refresh/latest.json` and `data/refresh/<YYYY-MM-DDTHHMM>.json`. Add `--no-city` to skip the citywide pull. |
| `uv run python -m pipeline refresh --code` / `--code-dir DIR` | Also compare the saved ecode360 chapters with fresh copies (see below). `data/code/` is never overwritten. |
| `uv run python -m pipeline refresh --baseline research-fixture` | Diff Block 10‑K against the pre-kickoff research fixture: `data/refresh/vs-research-fixture.json`. |
| `uv run python -m pipeline digest --dry-run` | Render the watchlist digest to `data/refresh/digest-preview.md` and print it. The default; nothing is sent. |
| `uv run python -m pipeline digest --send` | Post to Slack or send mail, only if the keys are in `.env`; otherwise it refuses. |
| `uv run python -m pipeline all [--offline] [--no-city]` | Blocks 10K and 0124P, then money for Wards 5 and 12, then city. |
| `uv run pytest -q pipeline/tests` | Tests (no network). Some tests need files that aren't in git (`data/raw/`, `data/city/work/`, the refresh files). When those files are missing, the tests skip and say why. |

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

## Held-out block 0124‑P (Larimer)

County map block 0124‑P is a map sheet: 271 parcels over about two dozen street blocks. So the
block file covers one street block of it, the 23 parcels of 0124‑P inside Lowell / Meadow /
Winfield / Winslow, listed explicitly (spec §5.2). `meta.selection_check` records that the list
equals the OSM street-polygon selection and that no parcel from another map block sits inside
that polygon.

- The main street is chosen from the data. It is the OSM street that the most parcels are
  addressed on: Lowell Street, 8 of 23 (`meta.main_street_basis`).
- The frame is squared to the Lowell frontage, like 10‑K.
- All 23 parcels are R1D‑H, and 11 are City-owned vacant land.
- Demo lot: 511 Lowell St (`0124P00203000000`). It is City-owned vacant land, Available for Sale,
  with deed 24×100, assessed 2,400 vs mapped 2,390 (0.996).

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
| `neighborhoods` | WPRDC Neighborhoods GeoJSON | `https://data.wprdc.org/dataset/e672f13d-71c4-4a66-8f38-710e75ed80a4/resource/4af8e160-57e9-4ebf-a501-76ca1b42fc99/download/neighborhoods.geojson` |
| `major_rivers` | WPRDC Allegheny County Major Rivers GeoJSON | `https://data.wprdc.org/dataset/d285f358-154e-4115-b2e2-520ccf48a2f1/resource/a749cade-9d56-442b-837f-4a93daa8b62a/download/major_rivers.geojson` |

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
| `deed` | LEGAL1 parsed to `{plan, plan_lot, part, front, depth, depth_avg, dims, parsed_from}`. See "LEGAL1 parsing" below. |
| `deed_note` | Present only when LEGAL1 is cut off inside the dimensions (see below). |
| `city` | City-Owned Properties row `{status, inventory, status_updated, zoned_as, class, sq_ft}`, or `null` if the parcel is not in City inventory. |
| `built`, `built_basis`, `building_ids` | `built` is true if a footprint's centroid lies in the lot, or if the assessment `YEARBLT` is set and the use is not vacant land. `built_basis` says which in plain words. |
| `mapped_area` | Shapely area of the local polygon, in sf. |
| `lotdim` | `{width, len}` from the City Residential Lot Dimensions layer by PIN. `null` if the layer has no row for the PIN. |
| `recon` | `{state, ratio, assessed, mapped, deed_area}`. `ratio = mapped / assessed`. State: `no_assessment` (no LOTAREA); `records_disagree` when \|ratio − 1\| > tolerance; `no_deed` when LEGAL1 has no dimensions; otherwise `ok`. `deed_area = front × depth`. For `part` lots this is the plan lot's area, not the parcel's. |

### LEGAL1 parsing

- **`plan`** is the text up to "PLAN". "PL" also counts when a lot designation follows it. The
  text is title-cased and never expanded.
- **`plan_lot`** is the lot designation between PLAN and LOT: a single number when there is one
  ("67"), otherwise the text ("79-80-81"). A missing plan lot stays `null` and is never
  inferred.
- **`part`** is true when "PT"/"PTS" appears.
- **`front` × `depth`** are the first `N X N` in the text. `N XAVG N` gives an average depth
  and sets `depth_avg: true`.
- **`dims`** is the full dimension string ("24X100X24").
- **No `N X N` in the text** → `deed: null`.
- **Cut-off LEGAL1.** The County field is 47 characters, space-padded. When a value fills all 47
  characters and the text runs out inside the dimensions ("…LOT 30X1", "…LOT 21.04",
  "…23.45XA"), the last number may be cut. No deed is read, and `deed_note` says why.

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

## City · `data/city/`

### `work/lots_work.json` (gitignored)

**What it holds.** Every City-Owned Properties row with `class == "Vacant Land"`. The engine's
`scripts/build-city.ts` turns this into the compact `data/city/lots.json`.

**Per-lot fields.**

| Field | Meaning |
|---|---|
| `pin`, `addr`, `addr_street` | Address title-cased from the CSV. `addr_street` is matched by base name to an OSM street within 150 ft. |
| `hood`, `ward` | From the CSV. |
| `zone`, `zone_frac` | `zon_new` of the zoning polygon with the largest overlap, and the fraction of the lot it covers. |
| `city` | `{status, inventory, status_updated, class, zoned_as}`. |
| `ll` | Representative point, `[lon, lat]`. |
| `outline_ll` | The outline in lon/lat, simplified at 0.3 ft. |
| `origin` | The lot centroid, `[lon, lat]`. |
| `poly` | Closed, valid ring in feet: x east and y north of `origin`. |
| `neighbors[]` | Every parcel whose boundary comes within 3 ft: `{pin, lot, poly, built, addr}`. |
| `streets[]` | OSM named highways within 150 ft, clipped to the lot bbox plus 150 ft: `{name, osm_id, highway, line}`. Footways, steps and paths are left out. |
| `assess` | `{lotarea, use, legal, ownercat, asof, yearbuilt}`. No names. |
| `deed`, `deed_note` | As in block files. |
| `mapped_area`, `slope25`, `undermined` | As in block files. |
| `built`, `built_basis` | A building-footprint centroid (ArcGIS `returnCentroid`) inside the lot, or `YEARBLT` with a non-vacant use. |
| `geometry_note` | Present when sliver parts were dropped. |

**Meta.** `meta.counts` holds the totals, the zone families from both the zoning layer and the
CSV's `zoned_as`, and the skips grouped by reason. `meta.skipped[]` lists every row not written,
with its reason: no PIN, no PGHParcels geometry, or a multipolygon whose second part is at least
1% of the area. Nothing is dropped silently.

**Inputs** (all paged and checked against `returnCountOnly`):
- PGHParcels, 142,911 features;
- footprint centroids, 117,506;
- zoning, 25%+ slope and undermined areas;
- assessments by ward (MUNICODE 101–132, allowed fields only);
- one Overpass pull of named highways in the City box.

### `neighborhoods.json` and `water.json` (committed)

Both are `[{name, rings: [[[lon, lat], …]]}]`, which is what `web/src/components/city/cityData.ts`
reads. `rings` holds outer rings and holes; draw them with the even-odd fill rule. They are
simplified at 0.000005° (about 1.4 ft) with 6 decimals.

- Neighborhoods: 90, from WPRDC Neighborhoods.
- Water: the Allegheny, Monongahela and Ohio rivers from WPRDC Major Rivers, clipped to the City
  box.

## Refresh · `data/refresh/`

`refresh` works in four steps:

1. Creates a new raw cache: `data/raw/<date>`, or `data/raw/<date>T<HHMM>` (UTC) when today's
   folder exists. Earlier folders are kept.
2. Re-pulls every dataset.
3. Re-processes both blocks, the comps, HUD (when re-pulled) and the city work file.
4. Diffs the new processed outputs against the ones on disk before the run.

It never writes `data/rules/`, because rules are decisions made by people.

`latest.json` (plus a timestamped copy) has four parts:

- **`meta.datasets[]`**: per raw dataset, `{id, raw_before, rows_before, rows_after,
  sha_before, sha_after, changed, bytes_changed}`, plus `osm_base_before/after` for OSM.
  - Pages and batches are grouped: `city/parcels` is all 143 pages.
  - `changed` means the content changed. Feature order, Overpass timestamps and other response
    metadata are ignored; `bytes_changed` records the raw difference.
  - "Before" is the newest earlier raw cache that holds that dataset, because a refresh can fail
    part-way.
  - The Overpass mirror has several backends at different replication points. On 26 Sep three
    pulls came back with OSM base 07-24, 06-01 and 07-15. When a pull is older than the previous
    one, refresh asks once more, keeps the newer answer and flags `osm_older` on the row.
- **`changes[]`**: `{pin, addr, block, scope, field, before, after, kind}` for these fields:
  - block parcels: address, zone, City status/date/inventory, assessment lot area/use/year/legal,
    deed front/depth, recon state, built, mapped area, slope, undermined;
  - city lots: the same kind of fields;
  - comps: counts, median, IQR, newest, added and removed sales;
  - HUD: median and the 50%/80% limits.
- **`code[]`**: the ecode360 chapter check.
- **`summary`**: one plain sentence.

**HUD in a refresh.** Refresh makes one polite HUD request. huduser.gov answers scripts with an
AWS WAF challenge, so the HUD re-pull normally fails. The failure is recorded and the previous
HUD file is kept.

**`--code`.** ecode360 is behind Cloudflare. Headless Chrome with its own user agent gets the
"Just a moment…" challenge page, and the pipeline does **not** try to pass it. The chapter row
then says "blocked … not bypassed". To compare anyway:

1. A person saves each chapter page from a browser as `<ecode id>.html`.
2. Run `refresh --code-dir DIR`.
3. The pages are converted to text (table cells joined by " | ") and saved under
   `data/raw/<date>/code/`.
4. Each is compared word by word with `data/code/`. Formatting doesn't count as a change.
5. `data/code/` is never overwritten; a person decides.

## Digest

`digest` reads `data/refresh/latest.json`, `data/watchlist.json` and, if present,
`data/rules/reviews.json`. It writes a plain message with three parts:

- City status changes on watched lots, plus a count of status changes elsewhere;
- other, unreviewed ("pencil") differences on watched lots;
- rules that were source-checked or City-confirmed in the 7 days before the refresh, shown by
  role and never by name.

The default watchlist is Block 10‑K lots 21–35 and all of block 0124‑P.

`--send` needs one of these in `.env`, and refuses otherwise:
- `SLACK_WEBHOOK_URL` (posted as `{text}`, or Block Kit for the outbox `npm run digest` builds);
- `RESEND_API_KEY` and `DIGEST_TO`: the email through Resend's API (`POST https://api.resend.com/emails`), HTML
  and plain text. `DIGEST_FROM` defaults to `24×100 <onboarding@resend.dev>`, Resend's test sender, which
  delivers only to the address that owns the Resend account: `DIGEST_TO` must be that address. Another sender
  needs a domain verified with Resend (DNS);
- or, only when no Resend key is set, `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` and `DIGEST_TO`.

A failed send reports the service's HTTP status and error name only: never a key, a webhook URL, an address or
the service's own message (tested in `tests/test_digest_outbox.py`).

It never sends an inquiry.

## Money · `data/money/`

### `comps_ward<N>.json` (PLAN.md §2.6)

There is one file per ward, with the same schema and filters. `MUNICODE` is 100 + ward: Ward 5
is `105` (Block 10‑K) and Ward 12 is `112` (held-out block 0124‑P). `money.WARDS` lists the
wards that `all` and `refresh` produce.

| Ward | Valid 1–2 unit sales since 2023 | Median | IQR | Newest build |
|---|---|---|---|---|
| 5 | 33 | $155,000 | $105,000–$235,000 | 2125 Rose St, built 2025, $240,000, 1,442 sq ft |
| 12 | 51 | $85,000 | $57,500–$122,500 | 22 Mayflower St, built 2024, $240,000, 1,742 sq ft |

Both wards were pulled on 26 Sep 2026. For Ward 12 the exclusive method gives $55,000–$125,000.

The Ward 5 details:

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

**Test snapshots.** `pipeline/tests/fixtures/ward5_sales_2026-09-26.json` and
`ward12_sales_2026-09-26.json` each hold the 26 Sep snapshot for their ward:
the filtered, joined records plus the upstream counts. `tests/test_money.py` checks that each
reproduces the numbers in the table above. It also checks that Ward 12 has exactly the same
schema and filters as Ward 5, apart from `MUNICODE` and `ward`.

### `hud_fy2026.json`

From the HUD FY2026 Section 8 income-limits workbook, the row with
`hud_area_code == METRO38300M38300` and county Allegheny. It holds `median_family_income`,
`l50_1..8` and `l80_1..8`, with the file URL, the file's sha256 and the pull time.

huduser.gov is behind an AWS WAF. Bursts get HTTP 202 with `x-amzn-waf-action: challenge`, a
JavaScript challenge. The pipeline does not try to pass it: it waits (60 s, then 120 s), retries,
and otherwise reports the failure and writes no HUD file.
