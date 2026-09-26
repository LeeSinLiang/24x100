# Static JSON API

Written at build time (`npm run build:data`, part of `npm run build`) by `scripts/build-api.ts`, using the
same engine as the app. Served as static files next to the app (`web/dist/api/…`). No server, no keys.

| Path | What it holds |
|---|---|
| `api/index.json` | What was built, when, and how many lots |
| `api/blocks/<id>.json` | A block's metadata (pull date, sources, frame, counts note) and a one-line summary per lot |
| `api/lots/<pin>.json` | One lot. For lots in a block file: the records (assessment, deed, City inventory, mapped area, reconciliation, slope, undermining, built), and the full engine result for a detached house and a two-unit house on the lot alone: widths and depths with their formula strings, every check with its rules (section, quote, source URL, verification level, reviewer, role, time, AI-checked flag) and records, the specific relief, certain and open approvals, the verdict, the money screen, open questions, and what is not assessed. For other City-owned vacant lots: the first blocker for each building type, all blockers, width/depth/area with the formula, and whether the edges could be computed |
| `api/city/summary.json` | Citywide counts per building type (first blocker, width-but-not-area, district coverage) |

## Trust levels in the API

- `trust: "ink"`: every rule and record behind the number was source-checked or is a dated record.
- `trust: "pencil"`: at least one input is an unreviewed AI proposal or an unresolved question.
- `trust: "red"`: the number depends on the user's proposal or an assumption.
- `verification.ai_checked: true`: source-checked by an AI research pass; a person should re-check it.

Rule states come from the committed rule store (`data/rules/base`, `data/rules/extracted`) and the committed
review log (`data/rules/reviews.json`), not from anyone's browser. Reviews made in the app reach the API when
someone exports the log from the review screen, commits it as `data/rules/reviews.json`, and rebuilds.

There is no score. Each result carries a `verdict` (a headline in words and Money · Rules · Site chips) and,
for Ward 5 lots, a `money_screen` (vertical cost at a practitioner's estimate, three value signals, the gap as a
lower bound, and what is not in the number). Every file carries the disclaimer: decision support, not legal, financial or zoning advice; the City of
Pittsburgh interprets its own code.

## Example

```
curl -s https://<host>/api/lots/0010K00025000000.json | jq '.results_by_type_alone.two.width'
{ "deed": 4, "mapped": 3.4, "formula": "24 − 10 − 10 = 4", "trust": "ink" }
```
