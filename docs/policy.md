# The policy agent

A City planner asks a what-if in plain words. The agent finds the sentence of the zoning code that controls it,
writes the redline, compiles it into the same engine override the rule what-ifs (S1–S3) use, runs the same
citywide count, and drafts a one-page memo to the Planning Commission. Its runs show in the app under
**What-ifs → Asked by the policy agent**.

```
uv run python -m agents.policy "What if R2-L's rear setback were 20 ft instead of 30?" --building two
uv run python -m agents.policy "…" --plan data/policy/plans/q1-r2-l-rear.json   # a hand-written plan, no model
uv run python -m agents.policy --recheck        # every committed run's quote and count against today's code and data
```

Each run writes `data/policy/<id>-<slug>.json` (the `scenarios.json` entry format, plus `steps`, `usage`, `model`
and `memo_md`) and, when it counts, `<id>-<slug>.md` (the memo).

## What the model does, and what it doesn't

| Step | Who | What |
|---|---|---|
| plan | model | Picks one stored rule in a district a person has signed, and the new value, or refuses with the reason. |
| find | code | Reads that section of the saved code (`data/code/*.txt`) and hashes the file. |
| draft | model | Copies the controlling sentence or table cells and says what to strike and insert; caveats in words. |
| verify | code | The quote must be word for word inside the section (`extract/source.check_quote`, the extractor's guard; one retry with the reason), the strike inside the quote, today's value in the strike and the new value in the insert, the value inside `extract/guards.RANGES`, and not a duplicate of S1–S3. Else: refused. |
| count | code | `scripts/policy-count.ts` → `countScenario()` in `scripts/build-scenarios.ts`, the code path behind S1–S3. |
| draft | code | The memo is a template: every number in it comes from the count or the code. |
| verify | code | Re-hashes the code file, re-checks the quote, re-runs the count, and traces every number in the memo. |

A change the code can't express as one stored rule's value (a lot-width minimum the code doesn't have, a use
permission, several rules at once) is refused, never counted. When the quoted table cell also sets another signed
district, the memo says so and whether it changes the count. Labels on every memo: **what-if, not the law** and
**drafted by an AI agent; check before sending**.

## Model and cost

Gemini through LangChain (`extract/llm.py`). The agent probes free models (`POLICY_MODELS`, or the list in
`agents/policy/__main__.py`) and hands over to the next one when a model keeps refusing (503s, quotas); each run
names the models that answered, the ones that refused, the tokens, and the paid-tier price equivalent where
`extract/eval.py` records one (the free tier charges nothing). No key needs billing.

## Tests

`uv run pytest -q agents/tests`: no network (a fake model and a fake count tool, plus one real run of the builder
when Node is installed). The guard rejects a quote that isn't word for word; a change no stored rule carries is
refused; the counts are the builder's; the memo carries both labels and an untraced number fails the verify step;
a hand plan runs with no model; S3 asked again is refused; `policy-count.ts` on S3's override equals S3 in
`scenarios.json`.
