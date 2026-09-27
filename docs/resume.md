# Resume here

Updated Sun 27 Sep ~00:20. Resumed after the usage pause; items 1, 2 (engine, city/search) and 5 (C15) below are
**done** (commits `f32967c`, `94eeeaa`, `f9c5e65`; decisions 42–46). Still open: sections 3 and 4 (publishing path,
letter polish), the watchlist UI and readable street-name diffs (2.5–2.6), the phone plate label and scale bar
(held for the §0.15 readability pass), and section 6 (film, judges; recording waits for the team's go-ahead).
The text below is the original plan, kept for reference.

## 1. Engine correctness (judge round 1; groundwork merged in `4065aeb`)

Merged: approval kinds `use_variance`, `special_exception`, `lot_consolidation`; refusal codes `not_adjacent`,
`mixed_districts`; labels and weights in `templates.ts`. Nothing the app shows has changed yet.

1. **Use permission drives suggestions** (lot 203, Larimer, suggests a three-unit house R1D‑H doesn't permit).
   In `evaluate.ts`'s use check: value N → a `use_variance` approval, S → `special_exception`, pencil when the
   reading is pencil; keep status `open` for pencil so the letter still asks. `unlock.ts`: sort options with
   `use_variance` last, label "needs a use variance (Zoning Board of Adjustment)", exclude from `recommended`
   and `nextStep().fewest`. `verdict.ts`: Rules chip `blocks` (pencil evidence), never "fits". Also drop the
   "lots 203, 208" option (208 is built and fronts Winslow St).
2. **Contiguous lots only** (`lots=25,30` is combined as one). Add `sharesEdge(a, b)` in `edges.ts` (the
   `labelEdges` test: ≥ 2 of 9 edge samples within `SHARE_TOL`). In `evaluate()`: refuse lots missing from the
   block (name them) before `orderAlongStreet`, then refuse `not_adjacent` if the group isn't connected
   ("Lots 25 and 30 don't touch; they can't form one zoning lot"), then use `mixed_districts`. `model.ts`
   `scenarioFrom`: selected lot first, pass unknown lot keys through. `sentence.ts` headline uses
   `r.scenario.pins[0]`; `verdict.ts` "Can't tell yet" follows the refusal code; `LotView.tsx` uses
   `selectedLot`. `Plate.tsx`: one label for adjacent narrow refused lots (41/43 overlap).
3. **Duplicate "Ways forward" rows** (lot 28 vs 28A both print "28"). In `candidateGroups`, keep only lots
   with a street edge on the selected lot's front street; `lotLabel` keeps suffixes (28A); dedupe on (type,
   sorted pins, hypothesis/pending/variance).
4. **§925.06.C.1** ("reduce the side setback to three (3) feet on both sides only if adjacent properties have
   setbacks of three (3) feet or less"; quote passes `checkQuote` at `925.06.C.1`). Add
   `q.narrow_both_sides_3ft` to `data/rules/questions.json` **and** `scripts/seed-answer-key.ts` (which
   rewrites it), `affects: ['pgh.narrow_lot_side']`. In `build()`, both interior sides at the table's 3 ft →
   pencil unless the City confirmed; alternative reading 24 − 10 − 3 = 11 ft (C.1 restricts only "both
   sides"). Width status `open` with the alternative; question in `r.questions`. Rowhouse ends unaffected
   (0 ft party wall). Generalise `withQuestion` in `unlock.ts` to take a question id. `Walls.tsx`: its "Depends
   on an open question" sentence is hard-coded to the rowhouse question. **Headline change:** detached on lot
   25 becomes pencil 18 ft (or 11 ft); tell the film session.
5. **Wrong citation**: `sentence.ts` cites the narrow-lot table (§925.06.C) plus the open C.1 question;
   `evaluate.ts` stops saying "the district setback stands" when the table sets the side yards.
6. **Lot consolidation**: no consolidation section exists in `data/code/*.txt`. For non-row scenarios with ≥ 2
   lots add a pencil `lot_consolidation` approval; +1 to `change_size` in `unlock.ts`. Not for rowhouses
   (§911: a single-unit attached house is on its own lot).
7. **Console "Infinity" errors**: only when the plate's container is 0 px wide (hidden pane). `Plate.tsx`
   ResizeObserver: ignore widths ≤ 0; guard `k` against 0 / non-finite.
8. **Parameters**: `url.ts` clamps `tol` to 0.01–0.5; the refusal text says "(the default; change it with
   &tol= in the link)" when it is the default.
9. **Phone plate**: `.env-width` halo is `stroke-width: 3px` in SVG units (3 ft); set inline
   `strokeWidth: px(3)`. Scale bar: choose 100/50/25/10 ft to fit `frame.w − px(72)`.
10. `evaluate.ts` grammar: "Is it still current?" for two lots → "Are they…"; "Its actual setback" for two
    neighbours.

Tests with mutation checks for each.

## 2. City view and search (classifier + search module merged in `c5d18fc`, `ef63aac`)

1. **Wire search into the header.** `cityData.ts`: `useCityData` takes `enabled`, loads on search focus.
   `Header.tsx`: `buildSearchIndex(Object.values(BLOCKS), city.lots)` and `searchLots`; a detailed lot →
   `update({view:'lot', block, lot})`, else `update({view:'city', pin})`. Fix the uncaught ranking mutation
   (a test query where a lot without detail would outrank a detailed one).
2. **CityView**: drive `focus`/`pin` from `s.hood`/`s.pin` via `update()`; "Loading" instead of zeros while
   `data.state === 'loading'`; `summarize()` on the neighbourhood's rows, "in Middle Hill"; the width split in
   the sentence ("width blocks 115 (ink); 42 more depend on a built neighbour's setback (pencil); 21 more on
   frontage from the City map").
3. **LotCard/LotTable**: use `widthTrust`/`areaTrust`/`widthNote`; replace the raw JSON link with "Lot detail
   isn't generated for this block yet" plus `cityRoutes()` lines (API link small).
4. **build-api.ts** (city part): add `width_trust`, `contextual`, `routes` per lot and the split to the summary;
   `scripts/facts.ts`: `put()` lines for `widthNotAreaInk`, `widthNotAreaContext`, `widthNotAreaMapped`.
5. **ChangesView**: show street-name array diffs as names added/removed; `changed: null` → "not re-pulled".
6. **Watchlist**: `web/src/lib/watch.ts` (localStorage in try/catch); "Watch this lot" on LotCard and rows;
   export matching `pipeline/digest.py`: `{meta:{note, version:1}, watch:[{block, label, pins}]}`; check with
   `pipeline.digest.build(watchlist_path=…)` (writes nothing).

## 3. Review publishing and labels (UI merged in `3b5b353`)

1. **Tests**: add `resolve.alias` for `@engine` in `vitest.config.ts`; `engine/test/review-publish.test.ts`
   for `formProblems`, `cityReferenceProblems`, `checkEntry`, `mergeLog`, `reviewDistricts()` excluding "XX";
   mutation-check each.
2. **`scripts/check-reviews.ts`** (+ `"check-reviews"` npm script): load rules/questions/code from fs; reuse
   `checkEntry`, `publishFlags` (fail unless `--allow-flagged`), `mergeLog`, `stateChanges`; `--write`,
   `--reviews`, `--uploads`; write `$GITHUB_STEP_SUMMARY`. Test in a temp dir; committed data untouched.
3. **`.github/workflows/publish-reviews.yml`**: build with `npx tsx scripts/build-api.ts && npx vite build
   --config web/vite.config.ts` (not `npm run build`: `build-city.ts` needs the gitignored work file). Validate
   YAML with `.venv/bin/python -c "import yaml…"`. Add `data/rules/uploads/.gitkeep`. Untested on GitHub (no
   repo yet).
4. **Docs**: `docs/pilot.md` steward runbook (≤ 10 steps, time labelled an estimate, owner roles only, never
   claim agreement); README "Keeping it running"; README evaluation wording; `docs/eval.md` is generated by
   `extract/eval.py` (change strings there, re-render from `eval.json`, diff).
5. **About page** ink legend still says "A rule a named person matched…"; add `<AiTag/>` to `Walls.tsx`
   `sourceChips`, `city/LotCard.tsx`, `inquiry/Letter.tsx` rule chips.
6. **CSS**: `.field-error`, `[aria-invalid]`, `.rv-steward`, `.local-tag`, `.confirmation-by`.
7. `no-score.mjs` never opens the Assume form or the review view: add them. "hand-checked" remains in
   `scripts/facts.ts` / `film/facts.json` and `DESIGN_GUIDE.md` §5.

## 4. Letters (merged in `40746ee`)

1. Screenshots at 1440×900 and 390×844, light and dark: `?view=inquiry&block=10K&lot=25&type=three&lots=25,26,27`,
   `…&lot=22&type=two`, `?view=inquiry&block=0124P&lot=203&type=detached`; check the phone tab grid.
2. `DESIGN_GUIDE.md` Inquiry section: one letter per office, tabs, checklist, neutral variance wording.
3. Dark mode, print and record mode beyond the smoke check.

## 5. C15 assembly finder (spec §0.14; branch `worktree-agent-a355a715a850082e8`, not merged)

Committed on the branch: `pipeline/assembly.py` (writes `data/city/work/assembly_work.json`, gitignored; owner
fields read: OWNERDESC, CLASSDESC, USEDESC, LOTAREA, LEGAL1, YEARBLT; never names). Its last change (street
selection by real line intersection) is **unverified**: re-run
`uv run --offline python -m pipeline.assembly --pins data/city/work/assembly_candidates.json` (~67 s) and check.
No public by-PIN dataset for URA or Land Bank ownership was found: label "public body" from the County's
GOVERNMENT class with its use words verbatim; never assert URA/Land Bank/County.

Next, in order: `engine/src/assembly.ts` (same-face test via `labelEdges`, runs of 2–3 vacant same-zone lots,
owner type, qualify via `classifyCityLot` alone vs `evaluate()` combined, pencil if the contextual check is
pencil, drop runs containing a smaller qualifying run) → `scripts/build-assemblies.ts` (writes
`data/city/assemblies.json` with meta; `assemblyFacts()` for `facts.ts`; cross-check inside Block 10‑K) →
`engine/test/assembly.test.ts` (adjacency cases; Mahon 25–27 three-unit, 52 ft, 1 non-City lot; mutations) →
UI `AssemblyLayer.tsx`/`AssemblyList.tsx` on `?view=city&layer=assemble&type=three&run=<pins>` → honesty lines
verbatim → screenshots → facts `assemblies_citywide`, `assemblies_all_city_owned` → film B13 (after the team
approves recording).

## 6. Film and judges (on hold)

- No recording until the team approves the site. Then: regenerate facts; re-record the beats whose words or
  numbers changed (B02 if the city sentence changes; B10 letter view; B08 Larimer letter; any beat showing the
  detached 18 ft once §925.06.C.1 lands); record B13; update `cues.json`; send the film session the changed
  facts.
- B07 still has a placeholder signer. The team (relayed Sat 26 Sep, ~20:00) says Sin Liang Lee checked the
  first R1D‑H rule (minimum lot size 1,200 sf, §903.03.D) against the saved code text. After the go-ahead:
  `REVIEWER_NAME="Sin Liang Lee" REVIEWER_ROLE="Student, team 24×100" node scripts/demo.mjs --record --base <recording build> --only B07`,
  then check `cues.json` B07 has no placeholder note (the script writes the real-signer note itself). The
  signature lives in the recording browser only; publishing it to `data/rules/reviews.json` goes through the
  steward path. The team name is 24×100.
- Judge panel round 2 after the above (docs/judge-panel.md has round 1).
- A teammate should sign the 11 RM‑M rules in the review screen (about 15 minutes) before submission.
