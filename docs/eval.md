# Extraction evaluation

Generated 2026-09-26T21:22:19+00:00 by `uv run python -m extract eval` from the files in `data/rules/extracted/`. Every number below is computed from those files; none is typed by hand. The run itself is `uv run python -m extract run --district <D>`.

The City of Pittsburgh interprets its zoning code. This is decision support, not legal, financial or zoning advice. Every extracted rule is **pencil** (unreviewed) until a named person source-checks it in the app.

## Gate G2

**PASS.**

- Key present: yes (`GOOGLE_API_KEY`); provider `gemini`, model `gemini-3.8-flash`.
- RM-M field agreement: **11 / 11 = 100.0%** (target ≥ 90.0%): met.
- Verbatim quotes: 21 of 21 proposed quotes passed the guard (100.0%); every accepted quote re-checks now: yes.
- Held-out R1D-H was extracted with `gemini-3.6-flash`, not `gemini-3.8-flash`: see its section below.
- Ambiguous clause in pencil: narrow-lot table `applies_to` = `['detached']`; the model itself flagged it (see below).

## RM-M against the answer key

Answer key: `data/rules/base/rm-m.json` and `pgh.json` (hand-checked against the saved ecode360 text, 26 Sep 2026). Agreement is on the value; for the contextual setbacks it also requires the vacant-neighbor clause (quoted, or stated in the condition); for the narrow-lot table every row must match.

| Field | Answer key | Extracted | § key → § extracted | Agree | Note | Applies to (key → extracted) |
|---|---|---|---|---|---|---|
| min_lot_area | 2,400 sf | 2,400 sf | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| front_setback | 25 ft | 25 ft | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| rear_setback | 25 ft | 25 ft | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| side_setback_exterior | 25 ft | 25 ft | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| side_setback_interior | 10 ft | 10 ft | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| max_height_ft | 55 ft | 55 ft | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| max_stories | 4 stories | 4 stories | 903.03.C → 903.03.C.2 | yes | value matches | * → * |
| party_wall_side | 0 ft | 0 ft | 903.03.C.2(c) → 903.03.C.2(c) | yes | value matches | row, row_end → row, row_end |
| contextual_side | 3 ft | 3 ft | 925.06.C → 925.06.C | yes | value matches; vacant-neighbor clause quoted and stated in condition | detached, two, row, three, row_end → * |
| contextual_rear | null | null | 925.06.I → 925.06.I | yes | value matches; vacant-neighbor clause quoted and stated in condition | detached, two, row, three, row_end → * |
| narrow_lot_side_table | table, 23 rows; 37 ft and below: 3 / 15 ft | table, 23 rows; 37 ft and below: 3 / 15 ft | 925.06.C → 925.06.C | yes | all 23 rows match | detached → detached |

The headline score is on values. `applies_to` (which building types a rule covers) is shown for information; `*` counts as all five types.

Section paths: 7 of 11 extracted rules cite a different path than the key (903.03.C → 903.03.C.2). The guard found each quote inside the path the model cited; agreement is not scored on the path.

The RM-M run also proposed 10 † rules (use table, parking, grading, lot of record) that have no answer key yet. They are not scored; they stay pencil until a person signs them.

## The ambiguity: "single-unit house" in §925.06.C

- R1D-H (`gemini-3.6-flash`): **asked the City, but still listed row, row_end in applies_to.** applies_to `['detached', 'row', 'row_end']`, ambiguous = True, question written by the model: "Does 'single-unit house' in this subsection apply only to single-unit detached dwellings or also to single-unit attached (rowhouse) dwellings?"
- RM-M (`gemini-3.8-flash`): **flagged as intended (detached only, question asked).** applies_to `['detached']`, ambiguous = True, question written by the model: "Does 'any single-unit house' apply only to single-unit detached houses, or does it also apply to single-unit attached rowhouses?"

A pencil proposal cannot widen the table's reach in the app: the engine picks an ink rule over a pencil one for the same field (`pick()` in engine/src/rules.ts), and the hand-checked `pgh.narrow_lot_side` rule (detached only) is ink. The open question stays in `data/rules/questions.json`.

The system prompt has one general rule about building types ("when the wording leaves doubt about whether a building type is covered, list only the types it clearly covers, set ambiguous = true and ask the City"). It does not name this clause or the answer.

## Providers and models side by side (RM-M)

| | gemini `gemini-3.8-flash` (app file) | gemini `gemini-3.6-flash` (incomplete run) | anthropic (Claude) |
|---|---|---|---|
| Field agreement | 100.0% (11/11) | 72.7% (8/11; 3 not run, 8/8 of those run) | not run (no key) |
| Verbatim-quote pass rate | 100.0% | 100.0% | not run (no key) |
| Rejected by guards | 0 | 0 | not run (no key) |
| applies_to same as key (info) | 11/11 extracted | 8/8 extracted | not run (no key) |
| Flagged "single-unit house" itself | yes | not run | not run (no key) |
| Tokens in / out | 8,261 / 40,361 | 1,306 / 4,656 | not run (no key) |

`gemini-3.6-flash` run was incomplete (calls refused: contextual, use, parking, grading, lot_of_record); its missing fields count as disagreements.

Claude comparison not run: no key. The Claude path (`EXTRACT_PROVIDER=anthropic`, `langchain-anthropic` `ChatAnthropic`, same structured output and the same guards) is built and unit-tested without network; with a key, `uv run python -m extract run --district RM-M --provider anthropic --compare` writes `data/rules/extracted/compare/rm-m.anthropic.<model>.json` and this table gains its column.

## Held-out districts (nobody typed these)

### R1D-H

Model `gemini-3.6-flash` (gemini), run 2026-09-26T21:19:26+00:00.
Run note: Run with gemini-3.6-flash because the free tier refused gemini-3.8-flash (daily limit of 20 requests per model reached, 2026-09-26 ~16:50 ET) and gemini-3.7-flash (repeated 503 'high demand'). Re-run with the default model after the daily reset (midnight Pacific) to replace it.
This is not the model scored on RM-M above (`gemini-3.8-flash`). On RM-M the same model agreed on 8 of the 8 answer-key fields it was able to run (3 not run: provider refused) (side-by-side table).
Re-used saved responses (identical prompts, `--resume`) for: dimensional: 903.03.D; contextual: 925.06.C, 925.06.I; use: 911.02, 911.04.A.69A; parking: 914.02.A; grading: 915.02.A; lot_of_record: 925.01.C, 921.04.

21 rules proposed and accepted by the guards; 0 rejected. After people's reviews (`data/rules/reviews.json`, if any): **21 pencil, 0 ink, 0 struck.** All are pencil until a named person signs them in the app.

| Field | Value | § | Applies to | † | Question for the City |
|---|---|---|---|---|---|
| min_lot_area | 1,200 sf | 903.03.D.2 | detached |  |  |
| front_setback | 15 ft | 903.03.D.2 | detached |  | Can the front setback be modified using Contextual Setbacks per Section 925.06? |
| rear_setback | 15 ft | 903.03.D.2 | detached |  |  |
| side_setback_exterior | 15 ft | 903.03.D.2 | detached |  |  |
| side_setback_interior | 5 ft | 903.03.D.2 | detached |  |  |
| max_height_ft | 40 ft | 903.03.D.2 | detached |  | Can the maximum building height be modified using Contextual Heights per Section 925.07? |
| max_stories | 3 stories | 903.03.D.2 | detached |  |  |
| party_wall_side | 0 ft | 903.03.D.2(d) | row, row_end, two |  | Does the zero interior side setback for attached dwellings apply to lots in the R1D subdistrict? |
| contextual_side | 3 ft | 925.06.C | * |  | Does the contextual side setback minimum of 3 feet apply to both interior side setbacks and streetside setbacks on corner lots? |
| narrow_lot_side_table | table, 23 rows; 37 ft and below: 3 / 15 ft | 925.06.C | detached, row, row_end |  | Does 'single-unit house' in this subsection apply only to single-unit detached dwellings or also to single-unit attached (rowhouse) dwellings? |
| contextual_rear | null | 925.06.I | * |  | Is there a numerical minimum rear setback in feet for contextual rear setbacks, or is it solely bounded by the existing setback on the adjacent lot? |
| use_detached | P | 911.02 | detached | † |  |
| use_row | S | 911.02 | row | † | Is the lot width 35 feet or smaller so that the single-unit attached use is permitted by right, or larger than 35 feet requiring a special exception under Sec. 922.07? |
| use_two | N | 911.02 | two | † |  |
| use_three | N | 911.02 | three | † |  |
| parking_detached | 1 per unit | 914.02.A | detached | † |  |
| parking_row | 0 per unit | 914.02.A | row, row_end | † |  |
| parking_two | 1 per unit | 914.02.A | two | † |  |
| parking_three | 1 per unit | 914.02.A | three | † |  |
| grading_review | null | 915.02.A.1 | * | † | Does the site development involve grading or cut/fill on slopes exceeding 25 percent, triggering the requirement for a geotechnical investigation report? |
| lot_of_record | null | 925.01.C.2 | detached | † | What are the specific standards and criteria required for approval of an Administrator's Exception under Section 922.08 for an undersized lot of record? |

Reviewer hints (automatic; weak signals for the person checking, not verdicts):

- min_lot_area: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- front_setback: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- rear_setback: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- side_setback_exterior: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- side_setback_interior: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- max_height_ft: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- max_stories: applies_to ['detached'] differs from the RM-M key's ['*']; check whether the clause really limits building types.
- party_wall_side: applies_to ['row', 'row_end', 'two'] differs from the RM-M key's ['row', 'row_end']; check whether the clause really limits building types.
- narrow_lot_side_table: applies_to ['detached', 'row', 'row_end'] differs from the RM-M key's ['detached']; check whether the clause really limits building types.
- front_setback, rear_setback, side_setback_exterior share one quote ("R1D, R1A, R2 & R3 Subdistricts | 15 ft."); check which row or clause each value came from.
- max_height_ft, max_stories share one quote ("R1D, R1A, R2 & R3 Subdistricts | 40 ft. (not to exceed 3 stories)"); check which row or clause each value came from.

## Tokens, latency, rejections

Token counts are the provider's own (`usage_metadata` on each response). Output tokens include the model's thinking tokens, which Google bills as output. Latency is wall-clock time inside the API calls (including any attempts that were rate-limited and retried; the backoff waits are not counted).

| District | Model | Calls (attempts) | Tokens in | Tokens out (of which thinking) | Latency in API | Wall time incl. backoff | Proposed | Rejected |
|---|---|---|---|---|---|---|---|---|
| R1D-H | `gemini-3.6-flash` | 6 (9) | 8,346 | 15,553 (11,918) | 82 s | 82 s | 21 | 0 |
| RM-M | `gemini-3.8-flash` | 6 (12) | 8,261 | 40,361 (35,504) | 218 s | not recorded | 21 | 0 |

Attempts above the call count were refused by the free tier (HTTP 429 rate limit or 503 "high demand") and retried with backoff; each retry is logged in the file's `meta.calls[].retries`.

## Cost per district

On the free tier the cost is **$0**. Google's pricing page says free-tier prompts and responses are "used to improve our products"; we only ever send public zoning-code text (no parcel records, nothing personal).

Google's published paid-tier (Standard) prices, per 1M tokens:

- `gemini-3.6-flash`: $0.75 input, $3.75 output including thinking tokens, through 2026-12-31; $1.50 / $7.50 from 2027-01-01. Source: https://ai.google.dev/gemini-api/docs/pricing (page updated 2026-09-24, read 2026-09-26).
- `gemini-3.8-flash`: $0.75 input, $3.75 output including thinking tokens, through 2026-12-31; $1.50 / $7.50 from 2027-01-01. Source: https://ai.google.dev/gemini-api/docs/pricing (page updated 2026-09-24, read 2026-09-26).

| District | Model | Tokens in | Tokens out | Cost now | Cost from 2027-01-01 |
|---|---|---|---|---|---|
| R1D-H | `gemini-3.6-flash` | 8,346 | 15,553 | $0.0646 | $0.1292 |
| RM-M | `gemini-3.8-flash` | 8,261 | 40,361 | $0.1575 | $0.3151 |

So one district cost between $0.06 and $0.16 in these runs at today's paid prices. Most of the output is thinking tokens, which vary by model and by run. Only successful responses carry token counts; refused attempts returned none. Treat each figure as one measured run, not a constant.

## What this does not show

- One run per district at the provider's default temperature (1.0 for Gemini 3, as its docs advise). A re-run can differ; the guards, not the model, decide what is kept.
- The † fields (use table, parking, grading, lots of record) have no answer key; nobody has scored them.
- The guard checks that each quote is verbatim and inside the cited section and that each value is in range; it cannot tell whether the model read the right table row. A person does that in the app.
- R1D-H was extracted with `gemini-3.6-flash`, not the model scored above; its proposals carry that model's name. Re-run with `uv run python -m extract run --district R1D-H` when the default model's free-tier quota allows, then `uv run python -m extract eval`.
- Report date: 2026-09-26.

## Commands

```
uv run python -m extract run --district RM-M      # live extraction (EXTRACT_PROVIDER / EXTRACT_MODEL override)
uv run python -m extract run --district R1D-H
uv run python -m extract run --district R1D-H --resume   # re-use saved responses to identical prompts
uv run python -m extract eval                     # this report + data/rules/extracted/eval.json
uv run python -m extract check                    # re-verify every quote in data/rules
uv run pytest -q extract/tests                    # no network
```

