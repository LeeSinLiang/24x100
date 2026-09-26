# 24×100 · Design guide

Rules for the look, motion, words and evidence states of 24×100. Written so a helper agent can
follow it alone. When this guide and `PLAN.md` disagree about data, `PLAN.md` wins. When this
guide and your taste disagree, this guide wins; propose changes to the orchestrator.

The visual reference is the Plate design folio (the old name). Its **look** carries over. Its code,
its hero page and its seven-plate essay structure do not.

---

## 1. What the product must feel like

A Pittsburgh plat atlas that learned to answer questions. It is a working tool, not a poster.

1. **The plate is the interface.** The block drawing is where answers appear: envelopes, edges,
   ownership coins. Text beside it explains the drawing; it never replaces it.
2. **Ink is known. Pencil is not known yet. Red is yours.** Every mark on screen is in exactly
   one of these states (plus the few special states in §5). A reader who learns only this one idea
   can read the whole app.
3. **Uncertainty is visible, never hidden.** If we don't know, the screen says so in plain words
   and names who could answer.
4. **One sentence tells the story.** Each lot view leads with a single sentence that rewrites
   itself from state. If the sentence can't be written honestly, the screen isn't ready.
5. **Every number opens its source.** Any figure is a button. Clicking it opens the evidence
   drawer with the quote or record it came from.

### The signature frame

This is the frame a judge should remember. Everything else is secondary to making it exact,
instant and legible on a projector.

> **2241 Mahon St, two-unit house.** Since May 2025 the lot meets the minimum lot size exactly
> (2,400 sf). A two-unit house still gets **4 ft** of width. Every lot down the street shows the same
> red sliver. Choose **Three-unit on lots 25–27** and the envelope widens to **52 ft**; the rules
> wall names the owner type of lot 26, and the money wall shows what a builder would need to
> build for, against what homes in Ward 5 actually sell for.

Composition at 1440×900 and at 1920×1080 (record mode):

```
┌ header: cartouche · breadcrumb (City › Middle Hill › Block 10‑K › 2241 Mahon St) · search · Present ┐
│ scenario rail: Detached · Two-unit · Rowhouses on 25–27 · Three-unit on 25–27 │ SENTENCE (display serif)   │
│ PLATE (62%): the row, every lot's envelope                                    │ WHAT FITS: numeral          │
│                                                                               │ WHAT BLOCKS IT: verdict +   │
│                                                                               │   Money · Rules · Site chips│
│ explanation · legend                                                          │ WHAT TO DO NEXT: first check│
├──────────────── MONEY (checked first) ───────────┬──────────────── RULES (checked second) ────────────┤
│ vertical cost (practitioner estimate) · three    │ ledger: check · required · available · short ·     │
│ value signals · gap "at least $X" (lower bound)  │ source · relief · approvals · ways forward          │
├──────────────── SITE (not assessed) ─────────────┼──────────────── WHAT TO CHECK NEXT, IN ORDER ──────┤
│ soil · environmental · water and sewer: signal → │ free → free → low cost → paid; draft the letter      │
│ what resolves it                                 │                                                      │
└──────────────────────────────────────────────────┴──────────────────────────────────────────────────────┘
```

The three answers a first-time user needs, **What fits · What blocks it · What to do next**, are
the first three things the eye meets: the numeral (what fits), the verdict with its Money · Rules · Site
chips (what blocks it) and the first check or the smallest unlock (what to do next). Label them with
those exact words. Below them the four panels run in the order a developer checks them (spec §0.12):
**Money → Rules → Site → What to check next**. There is **no score** anywhere.

---

## 2. Color

Two themes. **Atlas** (light) is the plat atlas. **Cyanotype** (dark) is a blueprint, not an
inverted atlas: pale lines on deep blue, washes desaturated.

| Token | Atlas | Cyanotype | Use |
|---|---|---|---|
| `--paper` | #ECE7DB | #10263A | page background |
| `--sheet` | #F2EEE5 | #132C43 | plate, panels, drawer |
| `--ink` | #1E1A15 | #E6EEF3 | sourced facts, lot lines, body text |
| `--ink-2` | #4A443A | #B4C5D2 | secondary text |
| `--graphite` | #7A756B | #8CA3B6 | pencil: AI proposals, unresolved |
| `--red` | #B01E33 | #FF8B7B | the user's proposal and assumptions |
| `--est` | #5A4A9C | #C3B3F2 | a practitioner's estimate (not ink, not pencil, not your red) |
| `--brick` | #E8A596 | #8C4B45 | brick building wash |
| `--frame` | #EDD27D | #8A7632 | wood-frame building wash |
| `--stone` | #A8C3CE | #3A6680 | stone / public building wash |
| `--gold` | #B8892A | #D9B45A | City-owned lot coin |
| `--slope` | #8C7652 | #9DB4C8 | 25%+ slope hatching |

Derived tokens (define once in `web/src/styles/tokens.css`, never hard-code hex elsewhere):

- `--rule`: `--ink` at 18% alpha; hairlines between rows.
- `--wash-alpha`: 0.05 per watercolor layer (Atlas), 0.07 (Cyanotype).
- `--focus`: 2px solid `--red`, 2px offset. Visible on every interactive element.
- Citywide blocker colors reuse the inks: **width** `--red`; **area** `--brick` darkened 25%;
  **depth** `--slope`; **ownership** `--gold`; **records disagree** `--ink` with a red ring;
  **fits as of right** `--ink` hollow; **rules not loaded** `--graphite` at 45%; **edges not
  computed** `--graphite` hollow dashed. The legend always prints the words, never color alone.

Theme switching follows `prefers-color-scheme`, with `?theme=light|dark` overriding it. Both
themes pass WCAG AA for body text (4.5:1) and for map labels (3:1 at their rendered size).

## 3. Type

Load from Google Fonts only. No Inter, no Space Grotesk, no monospace anywhere.

| Face | Role | Notes |
|---|---|---|
| **Old Standard TT** | display: the sentence, the width numeral, cartouche, wall titles, stamp numerals, plan-lot numbers (italic) | Regular, Italic, Bold |
| **Public Sans** | interface: ledger, buttons, drawer, inquiry body | 400, 500, 600; tabular figures (`font-variant-numeric: tabular-nums`) in every table |
| **Barlow Condensed** | map lettering: street names (caps, `letter-spacing: .32em`), dimensions, County lot numbers, small-caps labels (`letter-spacing: .12em`, 600) | 500, 600 |

Scale (desktop; px). Presentation mode multiplies every size by 1.3 and sets a floor of 16px.

| Step | Size / line | Face | Use |
|---|---|---|---|
| numeral | 96 / 0.9 | Old Standard TT | the width numeral ("4 ft"; "ft" at 40%) |
| display | 30 / 1.2 | Old Standard TT | the sentence |
| title | 20 / 1.25 | Old Standard TT | wall titles, screen titles |
| body | 15 / 1.5 | Public Sans | ledger, drawer, inquiry |
| small | 13 / 1.4 | Public Sans | secondary text, source lines |
| label | 12 / 1 | Barlow Condensed 600, caps, .12em | section labels, chips |
| map | 11–14 | Barlow Condensed | on-plate lettering (see §4) |

Numbers: deed-based feet are **integers** ("4 ft", "24 × 100"). Mapped feet get **one decimal** and
appear only as secondary text ("3.3 ft on the City map"). Money is rounded to the nearest $1,000 in
prose ("$155,000") and to $1 in the drawer. Use a real minus (−), a real multiplication sign (×)
and thin spaces around them in formulas: `24 − 10 − 10 = 4`.

## 4. The plate

The plate is SVG on top of a canvas wash layer. SVG geometry is the data. The canvas is
decoration and never feeds a calculation.

- **Frame:** a double rule (1px + 0.5px, 4px apart) around the plate, like an atlas page.
- **Orientation:** the main street runs horizontally along the bottom; y points down. A north arrow
  (thin, Old Standard "N") shows the true rotation from the block file's `rotation_deg`.
- **Scale bar:** 0 · 50 · 100 ft, alternating filled/empty segments, Barlow numerals.
- **Lot lines:** 0.8px `--ink`, `vector-effect: non-scaling-stroke`. Selected lot 1.8px. Lots in a
  combined group: outer outline 1.8px; internal lines become 0.8px dashed `--graphite` and fade to
  30% (they are merged away).
- **Lot numbers:** plan-lot number (the 19th-century deed number) in Old Standard italic, centered
  in the lot's rear half; County lot number in Barlow below it, 70% size. A missing plan-lot
  number is never inferred; if the UI offers a reading, it prints `69?` in pencil.
- **Frontage:** deed frontage along the front edge in Barlow ("24"), integer.
- **Street names:** Barlow caps, letter-spaced, set along the centerline. In presentation mode
  vertical street names become horizontal labels at the street end (no rotated text).
- **Buildings:** watercolor wash by material: Frame `--frame`, Brick `--brick`, else `--stone`.
- **City lots:** a gold coin, 7px, at the front-center of the lot: filled if Available for Sale,
  ring if held for another status.
- **Envelope:** 30° hatch, 3px spacing, 0.6px ink stroke, clipped to the envelope polygon, with a
  1px outline. Red hatch and red outline when the envelope is narrower or shallower than the
  proposal. A width ≤ 0 draws nothing and prints "no buildable width".
- **Envelope label:** the width in Old Standard on the envelope when it's ≥ 10px wide on screen; else
  a leader line to a label above the lot. Presentation mode: horizontal labels only.
- **Edge labels (selected lot only):** Barlow 11px along each edge: `FRONT · MAHON ST · 25 FT`,
  `SIDE · 10 FT · LOT 24 VACANT`, `REAR · 25 FT`. Party walls read `PARTY WALL · 0`.
- **Slope 25%+:** diagonal hatch at −30° in `--slope`, 25% opacity, toggleable. Presentation mode
  halves its density.
- **Proposal outline (red):** the proposed building footprint drawn as a red dashed rectangle
  centered in the lot along the front setback line, so the viewer sees 16 ft of building against
  4 ft of envelope.

The camera never moves inside a block view. Lots never move. Only envelopes, washes and labels
change.

## 5. Evidence states

Every visible fact is rendered by one component, `<Evidence state=…>`, which owns the styling.
Nothing else decides how trust looks.

| State | Meaning | Treatment |
|---|---|---|
| **Ink · rule** | a rule a named reviewer matched to the quoted code text | solid `--ink`; section chip (`§903.03.C`) |
| **Ink · record** | a dataset value with its pull date | solid `--ink`; dataset chip (`County assessment · 1 Sep 2026`) |
| **Pencil** | an AI proposal, or anything unresolved | `--graphite`, 1px dashed underline or dashed box, **boiling** (§6.1), italic in prose |
| **Red** | the user's proposal and assumptions, including an *assumed* answer to an ambiguous clause | `--red`, editable control or a red underline; always labeled with who set it |
| **Practitioner estimate** | a number a practitioner gave us, unconfirmed (today: vertical construction cost, $325–$375/sq ft) | `--est` violet text with a dotted underline, a hollow rotated-square mark ◇, the words "practitioner estimate" and who supplied it; never red, never ink |
| **City-confirmed** | an interpretation the City confirmed | ink plus a small seal (a 12px circle, double ring, Old Standard "C") and the reference |
| **Struck** | a rule a reviewer rejected | line-through in `--graphite`; stays visible |
| **Records disagree** | two sources conflict beyond tolerance | both values in ink side by side; red stamp **Can't score** |
| **Not assessed** | no data | dashed box with an em dash and the words "not assessed"; never "0" |

Rules for combining states:

1. **Weakest input wins.** A derived number is ink only if every rule and record it used is ink.
   If any input is pencil, the number is pencil. If any input is red, the number is red. A red
   assumption never appears as ink.
2. **Source-checked by an AI agent** (the pre-seeded RM‑M rules) renders as ink, and its chip
   carries a small `AI-checked · needs a teammate` tag until a person re-signs it.
3. **No † citation is ever ink** until a named person signs it in the review screen.
4. **Assumption ≠ confirmation.** Choosing an answer to an ambiguous clause turns the affected
   numbers red, keeps the Rules chip open, and keeps the question in the inquiry.

## 6. Craft

### 6.1 Boiling pencil
- Pencil lines and pencil text tremble; ink is perfectly still.
- One SVG filter per phase: `feTurbulence` (baseFrequency 0.035, 2 octaves) into
  `feDisplacementMap` (scale 1.4 for lines, 0.8 for text).
- The seed is deterministic: `seed = hash(id) % 5 + floor(t * 8)`. Eight re-seeds a second. No
  `Math.random()` anywhere in rendering.
- `prefers-reduced-motion` or `?record=1&still=1`: no displacement, static dashes.

### 6.2 Watercolor washes
- A `<canvas>` under the SVG, same transform.
- Each wash is 14 layered copies of the polygon at `--wash-alpha`. Each copy is deformed by
  recursive midpoint displacement (three levels, ±1.2 ft) seeded by `hash(pin, layer)`.
- Each wash is clipped to its polygon's outline expanded by 1 ft, so edges bleed slightly.
- Redraw only on resize, theme change or data change. Never on hover.

### 6.3 Paper
A fixed full-page SVG `feTurbulence` grain (baseFrequency 0.9, 3 octaves), 6% opacity,
`mix-blend-mode: multiply` in Atlas and `screen` at 4% in Cyanotype. `pointer-events: none`.

### 6.4 Hatching
Hatches are SVG `<pattern>`s in user space, 30°, defined once per theme. Presentation mode swaps
to a lighter pattern (spacing ×1.6, stroke ×0.8).

## 7. Motion

Exactly three moves. Nothing else animates.

| Move | When | How | Duration |
|---|---|---|---|
| **Ink drying** | a pencil item becomes ink (signed, confirmed) | crossfade: pencil layer fades out while the ink layer goes from `blur(1.5px)` and 40% opacity to sharp and 100% | 500 ms, ease-out |
| **Envelope reflow** | scenario, assumption or rule changes an envelope | polygons resampled to 48 points and tweened in place; numerals count to the new value | 320 ms, ease-in-out |
| **Era change** | switching between views of the same place (before/after a refresh) | washes and labels crossfade in place | 240 ms |

- Never animate `width` or `height`. Use `transform`, `opacity`, `filter` or SVG point tweens.
- `prefers-reduced-motion`: all three become instant.
- Record mode: every move finishes in under 400 ms (ink drying runs at 380 ms).
- Zooming city → block → lot is a cut with a 160 ms opacity crossfade, not a camera flight.

## 8. Words

The reader runs a CDC, builds a few homes a year, or works in City planning. They are smart and
busy. Write the way a good planner talks across a table.

- **Numbers first, with units.** "4 ft", "2,400 sf", "$155,000".
- **Address first, then lot.** "2241 Mahon St (lot 25, Block 10‑K)". Plan lot in italic: *Robb plan
  lot 67*.
- **Say what we don't know, and who can answer.** "We don't know whether 'single-unit house'
  includes attached houses. Ask the Zoning Administrator."
- **Separate the four kinds of thing:** geometry ("as of right, the widest two-unit here is 4 ft"),
  your proposal ("your 16 ft proposal"), regulation ("needs the side setbacks cut from 10 to 4 ft on
  each side") and procedure ("which is a variance").
- **No score.** A verdict in words: "Can't tell yet", "Only with subsidy (screening estimate)", "Doesn't
  fit as of right", "Worth a closer look, if …". Never a number out of 100, a probability or a rating.
- **Money first is an order, not a finding.** "We check money first because it's the cheapest thing to
  learn (a practitioner's advice); which barrier blocks more often is unproven (H5)." The gap is "at least
  $X per home" and always carries "lower bound: excludes site work, soft costs, financing and land". The
  median is "not an appraisal". Never "$0 lot" or "$0 sitework": say "not in this number".
- **Variance wording, everywhere:** "Doesn't fit as of right. A side-setback variance is a plausible route (a
  practitioner at the hackathon called this a clear hardship case). It is not approval, and it adds time and
  cost we can't estimate."
- **Site is never clean.** "Not assessed, could change the decision", with the free signal and what resolves
  it (geotechnical investigation, Phase I ESA, PWSA inquiry). No dollar amounts.
- **Drafts stay drafts.** "Draft inquiry · you send it". Never "send", never "submitted".
- **Disclaimer, verbatim, on the lot view footer and in every inquiry:** "Decision support, not
  legal, financial or zoning advice. The City of Pittsburgh interprets its own code."
- Banned: "AI-powered", "smart", "insights", "seamless", "unlock the potential", "optimize",
  "revolutionize", exclamation marks, emoji.
- Buttons are verbs: "Sign as source-checked", "Strike", "Assume yes", "Record City
  confirmation", "Copy inquiry", "Export review log", "Try it".
- Refusals are specific: "Can't score: records disagree. County assessment says 1,200 sf; the City
  map measures 2,505 sf (2.09×). Tolerance is ±10% (your setting)."

Glossary (the app shows these on first use of each term, as a dotted-underline tooltip):
**As of right**: allowed without a hearing or special approval. **Setback**: the distance a building
must keep from a lot line. **Variance**: permission from the Zoning Board of Adjustment to depart from
a dimensional rule, after a hearing. **Envelope**: the part of the lot left after setbacks. **RCO**:
Registered Community Organization; hosts the community meeting for a project. **Pencil / ink / red**:
see the legend.

## 9. Components

| Component | Rules |
|---|---|
| **Cartouche** | "24×100" in Old Standard, inside a double-rule rectangle like a plate number. Subtitle in Barlow caps: "PITTSBURGH LOT ATLAS". No other logo. |
| **Sentence** | Display serif, max two lines at 1440. Numbers inside it are `<Evidence>` buttons. Rewrites with the envelope reflow (text crossfade 160 ms). |
| **Width numeral** | Old Standard 96px. Red when below the proposal, ink when it fits, pencil when inputs are pencil. Caption: "as of right · by deed", then the mapped value in small text. |
| **Scenario rail** | A real radio group styled as atlas tabs: Barlow caps, 1px ink border, selected = ink fill, sheet text. Keyboard: arrows move, focus visible. |
| **Unlock button** | Under the sentence: "What to do next → Three-unit on lots 25–27 · 52 ft · lot 26 not City-owned [Try it]". |
| **Ledger row** | Grid: state mark · check · required · available · short · source chip. The state mark is a 10px square: filled ink, dashed pencil, red outline, struck. |
| **Source chip** | Barlow caps 11px, underlined; opens the evidence drawer. Rules: `§903.03.C`. Records: `CITY-OWNED PROPERTIES · 2016-11-17`. |
| **Verdict** | The headline in Old Standard (23px) and three chips, Money · Rules · Site: a glyph (✕ blocks, ? open, ✓ clear, — not assessed), the name in Barlow caps, one line of words in the chip's evidence colour. Can't tell → a "CAN'T SCORE" or grey "RULES NOT LOADED" stamp with the reason. |
| **Evidence drawer** | Right side, 440px, sheet background, focus-trapped, Esc closes. Shows: quote in context (the matched span highlighted with a `--gold` wash), section, file, URL, retrieved date, verification level with reviewer, role, time, note, and the audit history for that rule. |
| **Money panel** | Checked first. Lead: vertical construction per home in `--est` with the ◇ mark and its source. Three value signals as a list (value, label, what it is not). One $ scale: vertical cost as an estimate-hatched range, signals as ticks (median with the middle-half band, the newest build as a dot, the affordable price in red), the gap shaded. "Gap, at least" in Old Standard with its lower-bound label. A red secondary line with soft costs and financing. |
| **Site panel** | Three rows (soil and foundations, environmental, water and sewer), each a not-assessed dashed mark, the free signal, "Resolves it: …", "Cost: ask a professional". |
| **What to check next** | An ordered list, Free · Free · Low cost · Paid, each saying what answer would change the decision; then "Draft the letter". |
| **Review card** | Quote (verbatim), proposed value, section, model name, prompt hash. Actions: Sign as source-checked (needs name, role, note), Strike (needs a reason), Assume (for ambiguous clauses only), Record City confirmation (needs reference, date, who). |
| **Audit log row** | when · who · role · level · rule · decision · reason. Newest first. Export and import buttons. |
| **Inquiry** | One page, memo layout, Old Standard title, Public Sans body, source chips inline, red assumptions section, "not assessed" section, disclaimer, "Draft · not sent" watermark in the header. |
| **Legend** | Always reachable (the `?` key and a footer link): ink, pencil, red, City-confirmed, struck, records disagree, not assessed, and the citywide blocker colors. |

## 10. Screens and layout

| Screen | URL | Purpose |
|---|---|---|
| City | `?view=city` | Every City-owned vacant lot as a dot, colored by first blocker for the chosen type. Coverage line: "Computed for RM‑M only; other districts are grey: rules not loaded." Counts table beside the map. |
| Block | `?view=block&block=10K` | The plate for one block with the lot list table beside it. |
| Lot | `?view=lot&block=10K&lot=25&type=two` | The signature layout (§1). |
| Review | `?view=review&district=RM-M` | Code text left, rules right. |
| Inquiry | `?view=inquiry&block=10K&lot=25&type=three&lots=25,26,27` | The memo. |
| Changes | `?view=changes` | Refresh differences in pencil; digest dry-run preview. |
| About this block | `?view=about&block=10K` | History, year strip, the 14-vs-15 lot count explanation, limitations. |

Breakpoints:

- **≥ 1200px:** as drawn in §1.
- **768–1199px:** plate full width; the walls stack.
- **< 768px (390 target):** order is sentence → numeral → plate cropped to the selected lot and
  its two neighbors → money → rules → site → what to check next. Touch targets ≥ 44px.
  No horizontal page scroll. The lot list replaces hover.

Presentation mode (`?present=1`): type ×1.3, floor 16px, no rotated text, lighter hatching, the
drawer opens at 520px, hover states off.

Record mode (`?record=1`): presentation mode plus a fixed 1920×1080 stage, no cursor, no toasts,
no dev UI, all motion < 400 ms, and the app waits for `document.fonts.ready` before first paint.
The stage sets `data-ready="1"` on `<html>` when fonts, data and the first render are done;
scripts wait for it.

## 11. Accessibility

- Beside every plate, an HTML table of lots (address, lot, width available, status) that selects
  in sync with the map. Interactive lots are `<g role="button" tabindex="0">` with an
  `aria-label`; the plate is not wrapped in `role="img"`.
- After a re-render, focus returns to the control that caused it.
- Every color meaning also has a word or a shape.
- Keyboard: Tab reaches lots in address order; Enter selects; `[` and `]` step through lots;
  `Esc` closes the drawer; `?` opens the legend.

## 12. Self-review checklist (apply to every screenshot)

1. Can a first-time viewer find What fits · What blocks it · What to do next within 5 seconds?
2. Do the plate, the sentence, the ledger and the inquiry show the same numbers?
3. Is anything in ink that depends on pencil or red?
4. Any overlapping or clipped labels? Any envelope drawn outside its lot?
5. Cyanotype: any Atlas color leaking (brown text on blue, black lines)?
6. At 390px: horizontal scroll? text under 13px? targets under 44px?
7. Does anything look templated: default shadows, rounded cards, gradient buttons, a generic
   dashboard grid? Replace it with the atlas vocabulary.
8. Is the disclaimer present on lot views and inquiries?
