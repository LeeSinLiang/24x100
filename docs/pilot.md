# Pilot: how 24×100 keeps running after the hackathon

A plan, not a promise. Nothing here has been agreed with anyone yet; the names below are the kinds of owners
that fit, and the first step is asking them.

## Who would own it

| Role | Who could hold it | What they do |
|---|---|---|
| **Rule steward** | A zoning or policy analyst at the Department of City Planning, or a CDC coalition's policy staff | Signs or strikes model-proposed rules in the review screen (name, role, note); records City confirmations with a reference. Owns `data/rules/reviews.json`. |
| **Data steward** | A GIS or open-data analyst (City, WPRDC, or a university partner) | Runs the refresh, reviews the pencil differences, merges the refresh pull request. |
| **Users** | CDCs, small and mid-size developers, City Real Estate / URA land staff, policy analysts | Use the city map and lot views, draft inquiries, and send them themselves. |
| **Maintainer** | A student team or a civic-tech volunteer group | Keeps the code, tests and deploy running. |

The review log is the handover: every decision carries who, role, when, level, the quoted span and the reason,
so a new steward can see exactly what was checked and by whom.

## How often it refreshes

| What | How often | How |
|---|---|---|
| Parcels, assessments, City-owned status, sales, footprints, zoning layers | Nightly (the GitHub Actions workflow is included, disabled until a person enables it), or weekly | `npm run refresh` re-pulls, rebuilds, and opens a pull request; differences show in pencil under **Changes** and never overwrite a person's review |
| HUD income limits | Yearly (HUD publishes each spring) | download the workbook, `uv run python -m pipeline money --hud-file <path>` (the hash is recorded) |
| Zoning code text | When Council passes an amendment to Title 9 (e.g. Bill 2025‑1545 or Bill 2026‑0834 if enacted), or monthly | `uv run python -m pipeline refresh --code` re-saves the chapters with headless Chrome and reports what changed; a person replaces `data/code/`. Any rule whose quote no longer appears in the new text drops back to pencil automatically (tested) |
| Watchlist digest | Weekly, if a steward turns it on | `npm run digest -- --send` with the steward's Slack webhook or SMTP credentials; dry run by default |

## Cost

The app is a static site plus a static JSON API: hosting is free on any static host. Data sources are public
and free. The only metered cost is rule extraction, once per district and again when the code text changes.

Measured from the provider's own token counts (`docs/eval.md`, `data/rules/extracted/*.json` meta), at Google's
published paid-tier prices for these models ($0.75 per 1M input tokens, $3.75 per 1M output tokens including
thinking, through 31 Dec 2026; $1.50 / $7.50 after; https://ai.google.dev/gemini-api/docs/pricing, read 26 Sep
2026):

| District | Model | Calls | Tokens in | Tokens out (thinking) | Time in the API | Cost now | From 2027 |
|---|---|---:|---:|---:|---:|---:|---:|
| RM‑M | gemini-3.8-flash | 6 | 8,261 | 40,361 (35,504) | 218 s | $0.16 | $0.32 |
| R1D‑H | gemini-3.6-flash | 6 | 8,346 | 15,553 (11,918) | 82 s | $0.06 | $0.13 |

So extracting every residential district in the city (about 25 use-and-density combinations) would cost a few
dollars at paid rates, and $0 on the free tier, whose daily limit is about three districts per model per day.
On the free tier, prompts may be used by Google to improve its products; we send only public code text.
Claude as the extraction model is built and tested for shape but was not run (no key), so its cost is not
measured.

## How a City analyst adds a district (about 20 minutes)

1. **Extract (about 1.5–4 minutes of model time, unattended; longer on the free tier when it backs off).** `uv run python -m extract run --district R2-H`. The model reads
   only the saved code sections for that district and writes proposals to `data/rules/extracted/r2-h.json`,
   each with a verbatim quote that code has already checked against the saved text.
2. **Review (about 15 minutes).** Open `?view=review&district=R2-H`. For each of about twenty proposed rules,
   read the highlighted quote beside it and either **sign** it (name, role, a one-line note) or **strike** it
   (with a reason). Ambiguous clauses arrive as questions for the City; leave them open or record a City answer
   with its reference. Signing is the only step that turns pencil into ink.
3. **Publish (about 1 minute).** Export the review log from the review screen, commit it as
   `data/rules/reviews.json`, and run `npm run build`. That district's lots stop being grey on the city map, and
   the static API carries the new rule states.

Step 1's time is measured from the extraction logs (see Cost). Step 2's is an estimate (about 45 seconds to
read one highlighted quote and sign it, times about twenty rules); nobody outside the team has timed it yet.
Asking a City analyst to try it is the first pilot step.

## What a pilot would measure

- Time for a CDC staffer to answer "what blocks this lot and what would move it" (the scripted path takes 3
  actions; we want real people).
- How often a lot's first blocker is width, area, ownership or money (H1 and H5), across more districts once
  their rules are signed.
- Whether City Real Estate and the Zoning Administrator find the inquiry useful as sent.
