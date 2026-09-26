# 24×100 · Storyboard

The three-minute demo, shot by shot. Every shot is a deep link into the real app. `scripts/demo.mjs
--record` walks these beats in order and saves one 1920×1080 clip per beat to `film/clips/`.
`film/facts.json` holds every number the film says, generated from the engine, so the voice-over and
the sketchbook can never disagree with the app.

All links are relative to the app root and add `&present=1&record=1` when recording.
`lot=` is the County lot number inside the block (the PIN's lot part). Beats marked **(G4)** get
their final link when the held-out block is generated.

The film frames the app in a pen-and-wash sketchbook (a later phase, not built here). About 70% of
the running time is real app footage.

---

### B01 · The surprise · 0:00–0:16
**Link:** `?view=lot&block=10K&lot=25&type=two`
**On screen:** the lot view. Sentence: "Since May 2025, 2241 Mahon St meets the minimum lot size
exactly. A two-unit house still gets 4 ft." The numeral **4 ft** in red. On the plate, every lot on
Mahon Street carries the same red sliver of envelope inside a red dashed 16 ft proposal outline.
**Viewer notices:** the lot is big enough, and the house still doesn't fit. It isn't one lot; it's
the whole street.
**Action:** none; hold. At 0:10 the pencil items in the ledger boil faintly.

### B02 · Not one lot · 0:16–0:32
**Link:** `?view=city&type=two`
**On screen:** Pittsburgh, every City-owned vacant lot as a dot colored by first blocker for a
two-unit house. Grey dots everywhere rules haven't been loaded. The counts panel: "In RM‑M, width
blocks N lots first; area blocks M." Coverage line in plain words.
**Viewer notices:** the product computes its own citywide number, and it says exactly what it
didn't compute.
**Action:** hover-free; at 0:26 the Middle Hill cluster is highlighted, then cut to B03.

### B03 · Why · 0:32–0:48
**Link:** `?view=lot&block=10K&lot=25&type=two&drawer=rule:pgh.contextual_side`
**On screen:** the evidence drawer over the lot view: §925.06, with the sentence "If lots on either
side of the subject lot are vacant, the setback that is required by the zoning district shall
apply." highlighted in the saved code text. Reviewer, role, date. The edge labels on lot 25 read
`SIDE · 10 FT · LOT 24 VACANT` and `SIDE · 10 FT · LOT 26 VACANT`.
**Viewer notices:** the number comes from quoted law, and the neighbors being empty is the reason.

### B04 · Combine three lots · 0:48–1:16  ← the signature frame
**Link:** `?view=lot&block=10K&lot=25&type=three&lots=25,26,27`
**On screen:** the envelope reflows across lots 25–27 to **52 ft** in ink (the cue). Internal lot
lines go dashed and fade. Then the **money panel opens first**: vertical construction $200–$250/sq ft
(a practitioner's estimate for City single-family infill) × 1,350 sq ft = $270,000–$337,500 per home, against
the newest new build, $240,000: "Nothing left: building alone costs more than the best new-build sale". Beside
it, the same practitioner's speculative production-builder case ($150/sq ft) leaves $37,500, about what site
work alone may take ($25,000–$50,000, not a cap). The Ward 5 median ($155,000) and what an 80% AMI buyer could
pay are context lines, not used. The chip **Only with subsidy (screening estimate)**. The rules panel beside it:
"Fits the dimensional rules as of right. Needs lot 26: not in the City's inventory."
**Viewer notices:** the rules open up; the money doesn't, and the app says how sure it is.
**Action:** start on `type=two`, then click the scenario "Three-unit on lots 25–27" at 0:52.

### B05 · The open question · 1:16–1:32
**Link:** `?view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached`
**On screen:** rowhouses ×3. End units read "14 ft, or 21 ft if the narrow-lot table covers
attached houses", boiling in pencil. The drawer shows the question for the Zoning Administrator.
**Viewer notices:** the app doesn't pretend to know; the range stays open.

### B06 · Assume it, don't decide it · 1:32–1:44
**Link:** `?view=lot&block=10K&lot=25&type=row&lots=25,26,27&assume=q.single_unit_includes_attached:yes`
**On screen:** the end units reflow to 21 ft in **red**, labeled "your assumption". The Rules chip
stays open. The question stays in the inquiry.
**Viewer notices:** exploring an answer is not the same as having one.
**Action:** click "Assume yes" in the drawer at 1:35.

### B07 · The AI reads the code · 1:44–2:06
**Link:** `?view=review&district=R1D-H`
**On screen:** the saved text of §903.03.D on the left; on the right, rules proposed by the model
(model name and prompt hash shown), each with its verbatim quote highlighted in the text. One
rule is ambiguous and stays pencil with a question. A teammate signs one rule (name, role, note);
it dries from graphite to ink. The eval line: "RM‑M: N of M fields agree with the answer key."
**Viewer notices:** the AI proposes; a named person decides; the record keeps who and when.
**Action:** fill the sign form and submit at 1:52.

### B08 · A district nobody typed · 2:06–2:20 **(G4)**
**Link:** `?view=lot&block=0124P&lot=203&type=detached` (511 Lowell St)
**On screen:** a Larimer lot in R1D‑H running on the extracted rules. Numbers are ink where rules
were signed and pencil where they weren't.
**Viewer notices:** the same engine runs on a district nobody typed by hand.

### B09 · Refusal · 2:20–2:30
**Link:** `?view=lot&block=10K&lot=22&type=two`
**On screen:** 2247 Humber Way. Stamp: **Can't score**. "County assessment says 1,200 sf; the City
map measures 2,498 sf (2.08×). Tolerance is ±10%."
**Viewer notices:** it refuses rather than guesses.

### B10 · Site unknowns → what to check next → the letter · 2:30–2:46
**Link:** the lot view scrolled to the Site panel, then "What to check next, in order", then
`?view=inquiry&block=10K&lot=25&type=three&lots=25,26,27`
**First:** the Site panel (soil: lots 25–27 are 53%, 56%, 42% at 25%+ slope; undermining none mapped, not proof;
environmental: 1927 Commercial U3; water and sewer: no parcel data) and "What to check next, in order" (free
calls first, paid studies last).
**On screen:** the draft inquiry: what we want to build; what the code and records say (ink, with
citations); questions for the City; questions about money (City Real Estate, URA); our assumptions
(red); not assessed; disclaimer. "Number check: every number traces to the engine ✓". "Draft ·
you send it."
**Viewer notices:** this is a letter a CDC would actually send, to a real office, about a real next
step.

### B11 · What changed · 2:46–2:54
**Link:** `?view=changes`
**On screen:** the last `npm run refresh`: differences in pencil ("status changed", "new sale"),
newly signed rules, and the watchlist digest in dry-run preview ("not sent").
**Viewer notices:** it keeps watching after the demo.

### B12 · What we don't know · 2:54–3:00
**Link:** `?view=about&block=10K&section=limits`
**On screen:** the limitations, in the app: not assessed items, GIS not survey, 2023 footprints,
the City interprets its own code, no personal data.
**Viewer notices:** it ends on honesty.

---

## Timing check

| Beat | Start | Length |
|---|---|---|
| B01 | 0:00 | 16 s |
| B02 | 0:16 | 16 s |
| B03 | 0:32 | 16 s |
| B04 | 0:48 | 28 s |
| B05 | 1:16 | 16 s |
| B06 | 1:32 | 12 s |
| B07 | 1:44 | 22 s |
| B08 | 2:06 | 14 s |
| B09 | 2:20 | 10 s |
| B10 | 2:30 | 16 s |
| B11 | 2:46 | 8 s |
| B12 | 2:54 | 6 s |
| **Total** | | **3:00** |
