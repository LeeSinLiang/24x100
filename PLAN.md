# 24×100 · Build plan

Contract: `PLATE_BUILD_SPEC.md` (§0–§0.11 non-negotiable) and the team's build brief. Look and
words: `DESIGN_GUIDE.md`. Demo: `STORYBOARD.md`. Decisions left open by the spec:
`docs/decisions.md`.

**Feature-complete target: Sun 27 Sep 2026, 14:00 ET.** Submission closes 23:59 ET.

---

## 1. Architecture

```
public data ──► pipeline/ (Python) ──► data/blocks, data/city, data/money   (JSON, pull dates)
saved code  ──► extract/  (Python, LangChain: Gemini default, Claude optional)
                                   ──► data/rules/extracted/<district>.json (pencil)
answer key  ──► data/rules/base/rm-m.json (pre-seeded source-checked, AI-agent label)
review UI   ──► localStorage audit log ⇄ data/rules/reviews.json (export / import)
engine/ (pure TypeScript) reads blocks + rules + reviews + money ──► one LotResult per scenario
scripts/build-api.ts runs the engine at build time ──► web/public/api/** (static JSON API)
web/ (Vite + React) imports engine/ directly; all state in the URL
```

- One engine. The browser, the tests, the static API and `film/facts.json` all call the same
  functions in `engine/src`. No number is computed anywhere else.
- Python only fetches, joins, reconciles and extracts. It never computes an envelope.
- Every output file carries its pull date and sources.

## 2. Schemas (frozen at G1; only the orchestrator changes them)

TypeScript is the source of truth: `engine/src/types.ts`. The JSON files below match it.

### 2.1 Block file · `data/blocks/<id>.json`

```jsonc
{
  "meta": {
    "id": "10K", "name": "Block 10-K", "neighborhood": "Middle Hill", "ward": 5,
    "pulled": "2026-09-26T20:10:00Z",
    "sources": [{"id":"pgh_parcels","name":"City of Pittsburgh PGHParcels","url":"…","pulled":"…"}],
    "origin": {"lat": 40.4461, "lon": -79.9747},      // local frame origin (block centroid)
    "rotation_deg": 29.16,                              // rotation applied so the main street is horizontal
    "frame": "local feet; x along main street; y down",
    "main_street": "Mahon Street",
    "bounding_streets": ["Wylie Ave","Soho St","Mahon St","Kirkpatrick St"],
    "selection": "rep-point inside OSM street polygon | explicit PIN list",
    "counts_note": "14 lots on the original Robb plan (lots 63–76); 15 current County parcels (21–35, 28 and 35 split)",
    "recon_tolerance": 0.10,
    "pipeline_version": "…"
  },
  "streets": [{"name": "Mahon Street", "osm_id": 123, "line": [[x,y], …]}],
  "parcels": [{
    "pin": "0010K00025000000", "lot": 25, "lot_suffix": null,
    "addr": "2241 Mahon St", "addr_source": "city_owned",          // or "assessment"
    "addr_street": "Mahon Street",                                   // normalized, for front detection
    "poly": [[[x,y], …]],                                            // rings, outer first, closed
    "rep_point": [x,y],
    "zone": "RM-M", "zone_frac": 1.0,
    "overlays": ["RCO - Hill CDC & Hill DC & Hill DCG"],
    "assess": {"lotarea": 2400, "use": "MUNICIPAL GOVERNMENT", "class": "GOVERNMENT",
               "ownercat": "CORPORATION", "yearbuilt": null, "stories": null, "finish": null,
               "legal": "ROBT ROBB PLAN 67 LOT 24X100 MAHON ST BET KIRKP", "asof": "2026-09-01"},
    "deed": {"plan": "Robert Robb Plan", "plan_lot": "67", "front": 24, "depth": 100, "parsed_from": "LEGAL1"},
    "city": {"status": "Available for Sale", "inventory": "URA Transfer",
             "status_updated": "2016-11-17", "zoned_as": "RM-M"} ,       // null = not in City inventory
    "built": false, "building_ids": [],
    "slope25": 0.527, "undermined": 0.0,
    "mapped_area": 2287.4,
    "lotdim": {"width": 23.4, "len": 99.1},                          // City residential lot-dimension layer, if present
    "recon": {"state": "ok", "ratio": 0.95, "assessed": 2400, "mapped": 2287.4, "deed_area": 2400}
  }],
  "buildings": [{"id": "b1", "poly": [[[x,y],…]], "lot_pin": "0010K00022000000", "material": "Frame", "source": "Building_Footprints_Adjacency (2023)"}],
  "slope": [[[[x,y],…]]],
  "undermined": [],
  "hist_zoning": {"1927": "…", "1958": "R4", "1967": "R4"}
}
```

`recon.state` ∈ `ok | records_disagree | no_deed | no_assessment`. Rule: deed area vs assessed vs
mapped; beyond `recon_tolerance` between assessed and mapped → `records_disagree`. No owner-name,
mailing-address, change-notice or tax-bill field ever appears (tested by grep).

### 2.2 Rules · `data/rules/base/<district>.json`, `data/rules/extracted/<district>.json`

```jsonc
{
  "id": "rm-m.side_interior", "district": "RM-M", "field": "side_setback_interior",
  "value": 10, "unit": "ft",
  "applies_to": ["two","three","row_end","detached"],   // template ids; see 2.4
  "condition": null,
  "section": "903.03.C", "quote": "RM Subdistrict | 10 ft.",
  "source_file": "data/code/ch903.txt", "source_url": "https://ecode360.com/45474194", "retrieved": "2026-09-26",
  "origin": "answer_key",            // answer_key | extracted
  "dagger": false,                   // true = † in zoning-rules-rm.md: not checked by a person
  "question_for_city": null,
  "verification": {"level": "source_checked", "reviewer": "Claude (research pass)", "role": "AI agent",
                   "at": "2026-09-26T16:00:00-04:00", "note": "matched to saved ecode360 text 2026-09-26", "reference": null},
  "model": null, "prompt_sha": null
}
```

Fields: `min_lot_area, front_setback, rear_setback, side_setback_interior, side_setback_exterior,
party_wall_side, contextual_side, contextual_rear, narrow_lot_side_table, max_height_ft,
max_stories, use_<template>, parking_<template>, grading_review, lot_of_record`.
`narrow_lot_side_table.value` is `[{ "max_width": 37, "interior": 3, "streetside": 15 }, …]`.
`use_*` values are `"P" | "S" | "SPR" | "N"`.

Extracted files wrap rules: `{ "meta": {provider, model, prompt_sha, run_at, sections, tokens_in,
tokens_out, latency_ms}, "rules": [...], "rejected": [{"rule", "reason"}], "raw": … }`.

Questions (ambiguities) · `data/rules/questions.json`:
`{ "id": "q.single_unit_includes_attached", "section": "925.06", "quote": "…single-unit house…",
"question": "…", "ask": "Zoning Administrator", "affects": ["rm-m.narrow_lot_side"],
"yes": {"extends_applies_to": ["row_end"]}, "no": {} }`.

### 2.3 Audit log · localStorage `lot24x100.audit.v1` ⇄ `data/rules/reviews.json`

```jsonc
{ "id": "a-2026-09-26T21:04:11Z-3f", "rule_id": "r1d-h.front", "question_id": null,
  "at": "2026-09-26T21:04:11Z", "reviewer": "Jane Doe", "role": "Housing lead",
  "action": "source_checked",        // source_checked | struck | assumed | city_confirmed | reopened
  "quote": "R1D, R1A, R2 & R3 Subdistricts | 15 ft.", "decision": "matches text",
  "reason": "compared with §903.03.D table", "choice": null,
  "reference": null }                // city_confirmed: {"text": "email from …", "date": "…", "who": "Zoning Administrator"}
```

Effective rule state = base/extracted rule folded with its audit entries in time order.
`assumed` only applies to questions and produces **red**, never ink. `city_confirmed` requires a
reference. Every entry needs a non-empty reviewer, role and reason.

### 2.4 Scenarios and templates (red, editable)

| id | Name | Units | Proposal (red) | Setback behavior |
|---|---|---|---|---|
| `detached` | Detached house | 1 | 16 × 32 ft, 2 stories, 28 ft | narrow-lot table when lot < 60 ft wide; contextual pencil if a neighbor is built |
| `two` | Two-unit house | 2 | 16 × 45 ft, 3 stories, 36 ft | district sides |
| `row` | Rowhouses | fitter | unit ≥ 16 ft wide, 45 ft deep, 3 stories | party walls inside the run; end units district side, or narrow-lot under an assumption/confirmation |
| `three` | Three-unit house | 3 | 30 × 45 ft, 3 stories, 36 ft | district sides on the combined lot |

A scenario is `{ type, lots: [pins], proposal overrides }`. URL: `type=three&lots=25,26,27&w=30`.

### 2.5 Result object (one per scenario; every displayed number comes from it)

```ts
LotResult {
  key, scenario, block_id, pins,
  state: 'ok' | 'refused', refusal?: { code, reason, values },
  edges: LabeledEdge[],                    // kind, length, setback, neighbor pin/built, street
  envelope: { poly, area, method },
  width: Measure, depth: Measure,          // { deed, mapped, formula, trust, rule_ids, record_ids }
  checks: Check[],                         // width, depth, area, height, stories, use, parking, grading, undermined, ownership
  relief: Relief[],                        // "side setbacks 10 → 4 ft on each side", approval: 'variance'
  approvals: { ink: Approval[], pencil: Approval[] },
  score: { hi, lo, formula } | null,       // null when refused
  units, questions, not_assessed,
  trust: 'ink' | 'pencil' | 'red'          // weakest input
}
MoneyResult { per_home: { sqft, comps, affordable, cost_range, break_even_psf, gap_range, formulas } , trust }
UnlockOption { lever, label, result: LotResult, money: MoneyResult, discretionary, ownership_rank, change_size }
```

### 2.6 Money · `data/money/`

- `comps_ward5.json`: `{ meta: {source, resource_id, pulled, filters}, counts: {transfers, valid, valid_1_2_unit}, median, q1, q3, newest: {addr, yearbuilt, price, sqft, saledate}, sales: [{parid, saledate, price, use, yearbuilt, sqft}] }` (sale addresses are property addresses, no names).
- `hud_fy2026.json`: Pittsburgh HMFA median family income and 80% limits by household size, with the source file URL and pull date.
- `assumptions.json`: red defaults `{ key, value, unit, supplied_by, role, note }` (hard cost range, soft %, financing %, lot price, slope sitework premium, rate, term, taxes+insurance, down payment, household size, thin-market threshold).

### 2.7 City · `data/city/lots.json` (compact, for the citywide map)

`{ meta: {...counts, coverage}, lots: [{ pin, addr, hood, zone, status, xy: [lon,lat], outline: [[lon,lat],…],
deed: {front, depth}|null, assessed, mapped, edges: {front_len, sides: [{kind, built}], rear_len} | null,
edge_note }] }` plus `data/city/neighborhoods.json` (outlines).

## 3. Who owns what

Each helper owns its folders and edits nothing else. Shared interfaces change only through the
orchestrator.

| Owner | Folders | Starts |
|---|---|---|
| **Orchestrator** (me) | `engine/src/types.ts`, `data/rules/base/`, `data/rules/questions.json`, root configs, `docs/`, `film/`, `README.md`, `PLAN.md`, `DESIGN_GUIDE.md`, `STORYBOARD.md` | now |
| **Data** | `pipeline/`, `data/blocks/`, `data/money/`, `data/city/`, `data/raw/` (gitignored), `data/refresh/` | now (block 10‑K + money for the slice) |
| **Extraction** | `extract/`, `data/rules/extracted/`, `docs/eval.md` | after the slice (G3) |
| **Engine** | `engine/` (except `types.ts`) | orchestrator writes the slice; helper extends after G3 |
| **Interface** | `web/`, `scripts/shoot.mjs`, `scripts/demo.mjs`, `scripts/firstrun.mjs` | orchestrator writes the slice; helper builds wide after G3 |

## 4. Order of work

1. **Design docs** (this file, `DESIGN_GUIDE.md`, `STORYBOARD.md`). Commit.
2. **Vertical slice: the signature moment on real data.**
   - Data: block 10‑K pipeline, reconciliation, comparables, HUD.
   - Orchestrator: RM‑M answer-key rules with verbatim-quote check; engine (edges, envelope,
     templates, checks, relief, approvals, score, combine, money); tests; the lot view with plate,
     sentence, numeral, scenario rail, both walls, evidence drawer; `scripts/shoot.mjs`; three
     review rounds on B01 and B04.
3. **G3.** Then build wide in parallel:
   - Extraction (LangChain, guards, eval, token log).
   - Data (held-out block 0124‑P, citywide lots, refresh + diff, digest).
   - Interface (city view, block view + lot table, review screen, audit log, inquiry, changes,
     about, phone layout, presentation and record modes).
   - Engine (rowhouse fitter, unlock ranking, refusal paths, inquiry number check).
4. **G4** end to end. Then static API, first-run test, screenshot rounds, judge panel ×2, film
   deliverables, docs, `FINAL_REPORT.md`.

## 5. Gates

Any gate may say **no**. When one fails: stop, write why in `docs/decisions.md`, take the fallback,
say so in the README. Building less is fine; faking is not.

| Gate | Passes when | Fallback |
|---|---|---|
| **G1** · schemas + block file | Block 10‑K regenerated by our pipeline; lot bounding boxes within 2% of the research fixture; lot 22 `records_disagree`; lot 27 plan lot blank; comparables reproduce the pinned fixture (33 sales, median $155,000, IQR $105,000–$235,000, newest 2125 Rose St $240,000) or the difference is explained | Use the research fixture file, labeled as such in the UI and README |
| **G2** · extraction | `GOOGLE_API_KEY` present; RM‑M field agreement ≥ 90%; every accepted quote verbatim; ambiguous clause lands in pencil | Hand-checked rules only; show extraction on R1D‑H as proposals; README says so |
| **G3** · engine | All §12 tests pass: lot 25 widths (4 / 18 / 52 / 14 or 21), depth 50, lot 28 depth 12, edge labels on 21/25/34, contextual states, formula-string round trip on lots 21–35, no double counting, preference vs regulation, trust states, and the mutation check fails when the side setback is 10 → 5 | Fix before any UI polish |
| **G4** · end-to-end | Lot 25 flow runs through inquiry export with a persisted review log; held-out lot runs | Cut the Next items (digest, citywide lot views) |
| **G5** · craft | Three screenshot review rounds done; no open visual defects on the main states | — |

## 6. Timeline (ET)

| When | What | Check |
|---|---|---|
| Sat 16:00 | Design docs committed | — |
| Sat 16:00–21:00 | Vertical slice | G1, G3 |
| Sat 21:00–Sun 03:00 | Build wide (four helpers) | G2, G4 |
| Sun 03:00–07:00 | Static API, first-run test, screenshot rounds | G5 |
| Sun 07:00–10:00 | Judge panel round 1, fix two weakest criteria, round 2 | — |
| Sun 10:00–13:00 | Film deliverables, docs, README | — |
| **Sun 14:00** | **Feature-complete.** `FINAL_REPORT.md` | — |

## 7. Commands (target)

| Command | Does |
|---|---|
| `npm install && uv sync` | install |
| `npm run dev` | local app |
| `npm run build` | static API + `web/dist` |
| `npm test` | vitest (engine) + pytest (pipeline, extract) |
| `npm run rebuild` | everything from raw public data: pull → join → reconcile → engine → API |
| `npm run refresh` | re-pull, diff against the last snapshot, write pencil differences |
| `npm run digest -- --dry-run` | render the watchlist digest without sending |
| `npm run shoot` | screenshots of every storyboard state (1440/390 × light/dark) |
| `npm run demo -- --record` | one 1920×1080 clip per beat into `film/clips/` |
| `uv run python -m extract run --district R1D-H` | live extraction |
