# Pilot: how 24×100 keeps running after the hackathon

A plan, not a promise. Nothing here has been agreed with anyone yet; the names below are the kinds of owners
that fit, and the first step is asking them.

## Who would own it

| Role | Who could hold it | What they do |
|---|---|---|
| **Rule steward** | A zoning or policy analyst at the Department of City Planning, or a CDC coalition's policy staff | Signs or strikes model-proposed rules in the review screen (name, role, note); records City confirmations with a reference. Owns `data/rules/reviews.json`. |
| **Data steward** | A GIS or open-data analyst (City, WPRDC, or a university partner) | Watches the nightly run and reads its commit; reviews the pencil differences; merges the pull request when a refresh is run by hand. |
| **Users** | CDCs, small and mid-size developers, City Real Estate / URA land staff, policy analysts | Use the city map and lot views, draft inquiries, and send them themselves. |
| **Maintainer** | Today: Sin Liang Lee, the author. Later: a student team or a civic-tech volunteer group | Keeps the code, tests and deploy running. |

The review log is the handover: every decision carries who, role, when, level, the quoted span and the reason,
so a new steward can see exactly what was checked and by whom.

## How often it refreshes

| What | How often | How |
|---|---|---|
| Parcels, assessments, City-owned status, sales, footprints, zoning layers, and the shortlist | Nightly at 02:00 ET, once the repository variable `NIGHTLY` is `on` (it stays unset during judging, the hackathon's stop-work rule); or any time by hand | The **nightly** workflow (`.github/workflows/digest.yml`) re-pulls, rebuilds (`npm run build:data`), re-runs the shortlist and **commits straight to `main`**, then sends the digest. It runs on the schedule when `NIGHTLY` is `on`, and whenever someone starts it by hand (Run workflow). A refresh on its own goes through review instead: `npm run refresh` re-pulls and rebuilds on your machine for you to commit, and the **refresh-data** workflow (`refresh.yml`, by hand only) does the same and opens a pull request. Either way, differences show in pencil under **Changes**, and the review log (`data/rules/reviews.json`) is never touched |
| HUD income limits | Yearly (HUD publishes each spring) | download the workbook, `uv run python -m pipeline money --hud-file <path>` (the hash is recorded) |
| Zoning code text | When Council passes an amendment to Title 9 (e.g. Bill 2025‑1545 or Bill 2026‑0834 if enacted), or monthly | `uv run python -m pipeline refresh --code` re-saves the chapters with headless Chrome and reports what changed; a person replaces `data/code/`. Any rule whose quote no longer appears in the new text drops back to pencil automatically (tested) |
| Watchlist digest | With each nightly run, when a Slack webhook or email key is set as a repository secret; it sends only when a watched lot changed or a lot is new on the shortlist | the nightly workflow's last step; by hand, `npm run digest -- --send` with the steward's Slack webhook or email key (Resend, or SMTP); dry run by default |

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
3. **Publish (about 2 minutes, no git needed).** On the review screen, **Send to the steward** downloads the
   reviews signed in that browser. The steward checks the file and publishes it (see the runbook below). That
   district's lots stop being grey on the city map, and the static API carries the new rule states.

Step 1's time is measured from the extraction logs (see Cost). Step 2's is an estimate (about 45 seconds to
read one highlighted quote and sign it, times about twenty rules); nobody outside the team has timed it yet.
Asking a City analyst to try it belongs in a later pilot; the first one we propose is below.

## Steward runbook (publishing reviews)

Reviews are signed in a browser; until they are published they show "signed in this browser · not published"
and nobody else sees them. Publishing is the steward's job. It needs a GitHub account with write access to the
repository, not git on a computer. The workflow below is written but **has not run yet** on the repository
(github.com/LeeSinLiang/24x100); test it with the first real upload.

1. The reviewer opens the review screen, checks each rule against its highlighted quote, signs or strikes it
   with their real name and role, and clicks **Send to the steward**. They email or message the file
   (`reviews-YYYY-MM-DD-HHMM.json`) to the steward.
2. The steward opens the repository on github.com, goes to `data/rules/uploads/`, and uses **Add file → Upload
   files** to add it, committing to `main`.
3. The **Publish reviews** workflow (`.github/workflows/publish-reviews.yml`) runs `npm run check-reviews --
   --write`: every entry is checked with the app's own rules (a named reviewer and role, a rule that exists, the
   quote still found in the saved code text, a real reference and date for a City confirmation).
4. It stops, and publishes nothing, if an entry is invalid, if it would rewrite an entry already published, or
   if a name looks like a placeholder or a test, a role says "AI agent", or the entry is an assumption. The
   run's summary lists each problem.
5. If it stopped only on a flag the steward has looked at and accepts, they run the workflow again from the
   Actions tab with `--allow-flagged` (or locally: `npm run check-reviews -- --allow-flagged --write`); the
   override is recorded on the entry.
6. Otherwise it merges the entries into `data/rules/reviews.json` (entries are never rewritten), removes the
   upload, runs the tests, rebuilds the site and deploys it.
7. The steward opens the site and checks that the signed rules now read ink, with the reviewer's name in each
   rule's drawer.
8. To undo a decision, a reviewer records a new one (reopen or strike); the log keeps both.

Time: our estimate is 10–20 minutes a week while districts are being added, and near zero after; nobody has
timed it. Without a machine: `npm run check-reviews -- path/to/file.json` checks a file and changes nothing
(add `--write` to publish locally).

## Proposed pilot (not yet agreed with anyone)

Nobody has agreed to take part. Partner participation is unconfirmed: the reviewers below are the roles we would
ask, not people who have said yes. This is the first test we would ask for.

- **Owner and maintainer:** Sin Liang Lee. Runs the pilot, keeps the app and its data running through it, and
  writes up the result.
- **Reviewers (to be asked):** one staff member of a Hill District CDC, and one builder who prices infill homes.
- **Parcels:** 10 from the current shortlist (`data/shortlist/latest.json`), chosen by the CDC reviewer rather
  than by us, so we don't pick the easy ones.
- **Length:** two weeks.
- **How:** each reviewer screens each parcel two ways, each timed. By hand means their own knowledge, the public
  records, and a call if they would normally make one. In 24×100 means from the parcel ID to the first blocker and
  the next step. They do five parcels by hand first and the other five in 24×100 first, so neither method always
  gets the head start. The builder also types their own price into the builder's-quote box on each parcel.

**Acceptance criteria.** The pass marks are our proposal, to be agreed with both reviewers before the first
parcel.

1. **Blocker agreement.** For each parcel, does 24×100's first blocker, and what it says would move it, match
   the reviewer's own judgment? Counted per reviewer, out of 10. Proposed pass: 8 of 10 for each reviewer.
2. **Time to screen.** Median minutes per parcel, 24×100 against by hand. Proposed pass: 24×100 takes half the
   time or less.
3. **Disagreements recorded.** Every disagreement gets a line: the parcel, what 24×100 said, what the reviewer
   said, who turned out right once it was checked, and what we changed (a rule, the data, the wording, or
   nothing). Pass: every disagreement has a written outcome by the end of the two weeks.

Also recorded, with no pass mark: how far each builder's price moves the money line from the practitioner's
estimate. The results, misses included, would go in this repository.

## What a longer pilot would measure

- Time for a CDC staffer to answer "what blocks this lot and what would move it" (the scripted path takes 3
  actions; we want real people).
- How often a lot's first blocker is width, area, ownership or money (H1 and H5), across more districts once
  their rules are signed.
- Whether City Real Estate and the Zoning Administrator find the inquiry useful as sent.
