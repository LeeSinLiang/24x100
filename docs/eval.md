# Extraction evaluation

Generated 2026-09-26T20:51:30+00:00 by `uv run python -m extract eval` from the files in `data/rules/extracted/`. Every number below is computed from those files; none is typed by hand. The run itself is `uv run python -m extract run --district <D>`.

The City of Pittsburgh interprets its zoning code. This is decision support, not legal, financial or zoning advice. Every extracted rule is **pencil** (unreviewed) until a named person source-checks it in the app.

## Gate G2

**PASS.**

- Key present: yes (`GOOGLE_API_KEY`); provider `gemini`, model `gemini-3.8-flash`.
- RM-M field agreement: **11 / 11 = 100.0%** (target ≥ 90.0%): met.
- Verbatim quotes: 21 of 21 proposed quotes passed the guard (100.0%); every accepted quote re-checks now: yes.
- Ambiguous clause in pencil: narrow-lot table `applies_to` = `['detached']`; the model itself flagged it (see below).

## RM-M against the answer key

Answer key: `data/rules/base/rm-m.json` and `pgh.json` (hand-checked against the saved ecode360 text, 26 Sep 2026). Agreement is on the value; for the contextual setbacks it also requires the vacant-neighbor clause (quoted, or stated in the condition); for the narrow-lot table every row must match.

| Field | Answer key | Extracted | § key → § extracted | Agree | Note |
|---|---|---|---|---|---|
| min_lot_area | 2,400 sf | 2,400 sf | 903.03.C → 903.03.C.2 | yes | value matches |
| front_setback | 25 ft | 25 ft | 903.03.C → 903.03.C.2 | yes | value matches |
| rear_setback | 25 ft | 25 ft | 903.03.C → 903.03.C.2 | yes | value matches |
| side_setback_exterior | 25 ft | 25 ft | 903.03.C → 903.03.C.2 | yes | value matches |
| side_setback_interior | 10 ft | 10 ft | 903.03.C → 903.03.C.2 | yes | value matches |
| max_height_ft | 55 ft | 55 ft | 903.03.C → 903.03.C.2 | yes | value matches |
| max_stories | 4 stories | 4 stories | 903.03.C → 903.03.C.2 | yes | value matches |
| party_wall_side | 0 ft | 0 ft | 903.03.C.2(c) → 903.03.C.2(c) | yes | value matches |
| contextual_side | 3 ft | 3 ft | 925.06.C → 925.06.C | yes | value matches; vacant-neighbor clause quoted and stated in condition |
| contextual_rear | null | null | 925.06.I → 925.06.I | yes | value matches; vacant-neighbor clause quoted and stated in condition |
| narrow_lot_side_table | table, 23 rows; 37 ft and below: 3 / 15 ft | table, 23 rows; 37 ft and below: 3 / 15 ft | 925.06.C → 925.06.C | yes | all 23 rows match |

Section paths: the model often cites a more specific clause than the key (e.g. `903.03.C.2`, the Site Development Standards paragraph that holds the table, where the key says `903.03.C`). Both locate the same quote in the saved text; agreement is not scored on the path.

The RM-M run also proposed 10 † rules (use table, parking, grading, lot of record) that have no answer key yet. They are not scored; they stay pencil until a person signs them.

## The ambiguity: "single-unit house" in §925.06.C

- RM-M: applies_to `['detached']`, ambiguous = True, question written by the model: "Does 'any single-unit house' apply only to single-unit detached houses, or does it also apply to single-unit attached rowhouses?"

The system prompt has one general rule about building types ("when the wording leaves doubt about whether a building type is covered, list only the types it clearly covers, set ambiguous = true and ask the City"). It does not name this clause or the answer.

## Providers and models side by side (RM-M)

| | gemini `gemini-3.8-flash` (app file) | anthropic (Claude) |
|---|---|---|
| Field agreement | 100.0% (11/11) | not run (no key) |
| Verbatim-quote pass rate | 100.0% | not run (no key) |
| Rejected by guards | 0 | not run (no key) |
| Flagged "single-unit house" itself | yes | not run (no key) |
| Tokens in / out | 8,261 / 40,361 | not run (no key) |

Claude comparison not run: no key. The Claude path (`EXTRACT_PROVIDER=anthropic`, `langchain-anthropic` `ChatAnthropic`, same structured output and the same guards) is built and unit-tested without network; with a key, `uv run python -m extract run --district RM-M --provider anthropic --compare` writes `data/rules/extracted/compare/rm-m.anthropic.<model>.json` and this table gains its column.

## Held-out districts (nobody typed these)

## Tokens, latency, rejections

Token counts are the provider's own (`usage_metadata` on each response). Output tokens include the model's thinking tokens, which Google bills as output. Latency is wall-clock time inside the API calls (including any attempts that were rate-limited and retried; the backoff waits are not counted).

| District | Model | Calls (attempts) | Tokens in | Tokens out (of which thinking) | Latency in API | Wall time incl. backoff | Proposed | Rejected |
|---|---|---|---|---|---|---|---|---|
| RM-M | `gemini-3.8-flash` | 6 (12) | 8,261 | 40,361 (35,504) | 218 s | not recorded | 21 | 0 |

Attempts above the call count were refused by the free tier (HTTP 429 rate limit or 503 "high demand") and retried with backoff; each retry is logged in the file's `meta.calls[].retries`.

## Cost per district

On the free tier the cost is **$0**. Google's pricing page says free-tier prompts and responses are "used to improve our products"; we only ever send public zoning-code text (no parcel records, nothing personal).

At Google's published paid-tier price for `gemini-3.8-flash` ($0.75 per 1M input tokens, $3.75 per 1M output tokens including thinking; Standard paid tier, through 2026-12-31; $1.50 in / $7.50 out from 2027-01-01. Output price includes thinking tokens. Source: https://ai.google.dev/gemini-api/docs/pricing, page updated 2026-09-24, read 2026-09-26):

| District | Tokens in | Tokens out | Cost now | Cost from 2027-01-01 |
|---|---|---|---|---|
| RM-M | 8,261 | 40,361 | $0.1575 | $0.3151 |

Only successful responses carry token counts; rate-limited attempts returned no tokens. Thinking tokens dominate the output; one run's count varies with the model's thinking, so treat these as one measured run, not a constant.

## What this does not show

- One run per district at the provider's default temperature (1.0 for Gemini 3, as its docs advise). A re-run can differ; the guards, not the model, decide what is kept.
- The † fields (use table, parking, grading, lots of record) have no answer key; nobody has scored them.
- The guard checks that each quote is verbatim and inside the cited section and that each value is in range; it cannot tell whether the model read the right table row. A person does that in the app.
- Report date: 2026-09-26.

