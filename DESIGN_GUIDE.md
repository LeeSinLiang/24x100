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

Atlas (light) is the default whatever the OS setting (spec §0.15). Cyanotype is a toggle in the top
bar ("Dark"), remembered per browser in localStorage (every read and write guarded); `?theme=light|dark`
in the link overrides both. `App.tsx` always sets `data-theme` on `<html>`, and `tokens.css` switches only on
`[data-theme='dark']`, never on `prefers-color-scheme`. Both
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
| **Practitioner estimate** | a number a practitioner gave us, unconfirmed (today: vertical construction cost, $200–$250/sq ft; the $150 production-builder case; typical site work, $25,000–$50,000) | `--est` violet text with a dotted underline, a hollow rotated-square mark ◇, the words "practitioner estimate" and who supplied it; never red, never ink |
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
- **Variance wording, everywhere** (team decision, 27 Sep): "Needs a variance from the Zoning Board. That's not
  guaranteed, and every lot on this street has the same problem. The bigger fix is changing the rule: N City lots
  are stuck the same way." The street clause appears only when true for that street ("every lot we could check"
  when some couldn't be scored); N is the build-time count of City lots big enough but too narrow for the building
  type (`data/city/summary.json`). No practitioner's view in app wording.
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

The lot, city and block screens above are now one workspace (§13). The table stays as the list of
URLs; `view=city`, `view=lot` and `view=block` render the workspace, and review, inquiry, changes and
about stay pages under the same top bar.

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

## 13. The workspace (spec §0.15)

One screen, linked panels, the answer in five seconds and every detail one or two clicks deep. Built in
`web/src/views/WorkspaceView.tsx` and `web/src/components/workspace/*`, styled in `web/src/styles/workspace.css`.

```
┌ top bar: cartouche · search · crumbs · Detached Two‑unit Rowhouses Three‑unit · Map Plan Graph Table · Dark Rules About Present ┐
│ LEFT RAIL (224)        │ CANVAS                                  │ INSPECTOR (520)                          │
│ Map/Table: layers with │ Map: the city, its layers, selection    │ title · status stamp (click: the verdict) │
│ live counts, filters   │ Plan: the plate                         │ one plain sentence                        │
│ Plan: the plate's key, │ Graph: slot for P1                      │ 4 tiles: width · build cost · newest sale │
│ slope layer            │ Table: lots or runs, sortable           │          · left after building            │
│ Graph: node-type slot  │                                         │ tabs Money · Rules · Site · Next · Sources│
├────────────────────────┴─────────────────────────────────────────┴──────────────────────────────────────────┤
│ TRAY: What to check next · Evidence timeline · Changes            disclaimer                        Hide  │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

**Fit.** At 1440×900 the page never scrolls, in either theme; the rail, the inspector's tab body, the
table canvas and the tray scroll inside. Record mode draws the 1440×810 layout at 1920×1080. Under 1024 px
the workspace stacks: canvas, inspector, tray, then the rail, and the page scrolls; no horizontal scroll at
390 px. `scripts/words.mjs` checks all of this.

**Selection comes from the URL**, never from component state: a lot with block detail (`view=lot&block&lot`,
with `lots` and `type`), a City lot without detail (`view=city&pin=`), a C15 run (`view=city&layer=assemble&run=<pins>`),
the Combine-to-fit list (`layer=assemble`), a block (`view=block&block=`), or nothing (the city). New, optional
parameters (every older link still opens the same selection): `canvas=map|plan|graph|table` (default: map for
the city, plan for a lot or block), `tab=money|rules|site|next|sources`, `tray=next|timeline|changes|closed`,
`hide=<blocker ids>` (map layers off), `sale=1`, `ward=`, `zone=` (filters; `hood=` is the neighbourhood, as
before), and `letter=<office>` on the inquiry page. Clicking a dot on a lot with block detail opens that lot
(the canvas stays the map); any other dot selects the City lot.

**Plain words.** The header, the sentence and the tile labels carry no jargon: "buildable width", "build cost
per home", "newest new-build sale", "left after building", "too narrow", "not checked". RM‑M, *as of right*,
setback, envelope, AMI, RCO and ink/pencil appear only in the tabs, with a dotted-underline glossary tooltip
(`Gloss` in `workspace/plain.tsx`, text from §8). The status stamp keeps the engine's verdict words
(`HEADLINE_WORDS`), so "Doesn't fit as of right" stays, with the glossary in its tooltip. Budgets: ≤ 80 words
in the header and tiles, ≤ 250 on the first screen (a word has a letter; figures are counted apart).

**Tiles.** Four boxed cells, Old Standard figures, trust styling unchanged: the width numeral is ink,
pencil, red or short-red exactly as the old numeral was; build cost and left-after-building are practitioner
estimates in `--est` violet with the ◇ mark and "a practitioner at the hackathon"; the newest sale is ink with
its caveat in a tooltip. A can't-score lot shows "—" with the reason in every tile. The sale tile's value is a
list with room reserved for a **second price line** (the parked two-price framing), and the Money tab's key
values are rows keyed by `data-price`, so adding one is a row, not a relayout. The city, a City lot, a run and a
block have their own tiles, all read from `summarize()`, the classifier or the assembly file.

**Tabs** hold today's panels, unchanged in substance, at concept-v2-1 density: each panel's own header stays,
tables at 12.5 px, and the Money tab leads with the scale and a key-values table (value and source per row), the
full estimates table, context lines and your assumptions one click deeper. All panels are rendered and the
inactive ones hidden, so the trust scan still reads the ledger whichever tab is open. The evidence drawer opens
over the inspector, as before.

**Tray.** *What to check next*: the engine's five steps (`inquiry.sections` → `next`), each with its cost tag
taken from its own words (FREE, FREE OR CHEAP, LOW COST, PAID), its first phrase, the full text on click, and a
link to every letter whose office it names (`?view=inquiry…&letter=<office>`). *Evidence timeline*: real events
only: record pulls grouped by minute (block `meta.sources`, sales, HUD, the citywide file, the assembly finder's
inputs), rule checks grouped by who, when and level, each review-log entry (never a page-link assumption), code
text saved, and the last refresh. *Changes*: the last refresh in plain words, the raw diffs behind "Details". The
disclaimer sits in the tray bar on every workspace screen.

**Theme.** See §2: light by default, the toggle is remembered, the link overrides.

**Graph (P1).** `<GraphSlot/>` says "The graph view is being added" in a dashed pencil box; the rail keeps a
`data-slot="graph-filters"` section for node-type filters. Neither looks finished.

### Nothing lost: old place → new place

Clicks count from the workspace as it opens for that selection (0 = on the first screen).

**Lot page** (`?view=lot…`)

| Old place | New place | Clicks |
|---|---|---|
| Header: cartouche, crumbs, search and its "Lot detail covers …" line, Rules, Present | Top bar; the coverage line heads the search results (and is the input's description) | 0 (coverage: 1) |
| Scenario rail "Try …", with "on lots 25–27" | Top bar building-type switch; the group is in each option's tooltip and in the title once chosen | 0 |
| The plate | Plan canvas (the lot view's default) | 0 |
| Plate legend | Left rail "Key" on the Plan canvas | 0 |
| Slope layer (`slope=1`) | Left rail "Slope 25% or more" | 0 |
| The engine's sentence (headline) | Rules tab, first line; the header carries a plain sentence | 1 |
| Explanation under the plate | Rules tab | 1 |
| Refresh note (changed on the last refresh) | Pencil note under the header sentence; the Changes tray tab | 0 |
| What fits: numeral, "as of right · by deed", City-map value, the alternative | Width tile (numeral, your plan, the alternative); caption and formula in its tooltip and the Rules tab's width line | 0 (caption: 1) |
| What blocks it: verdict headline, Money · Rules · Site chips, detail | Status stamp (headline); click it for the whole verdict block; chip glyphs on the tabs; chip words lead the Rules and Site tabs | 0 / 1 |
| What to do next: the first check, or the unlock with Try it | Next tab, first block | 1 |
| Money panel | Money tab (default): scale and key values; estimates, context lines, your assumptions and notes under "Both estimates, context and your assumptions" | 0 / 1 |
| Rules wall: verdict line, ledger, approvals | Rules tab | 1 |
| Rules wall: ways forward (unlock table, Try it) | Rules tab → "Ways forward" | 2 |
| Site panel | Site tab | 1 |
| What to check next + Draft the letter | Tray (the five steps, tags, letter links; click a step for its text) and the Next tab (list, Draft the letter, one link per letter) | 0 / 1 |
| Lots on the street table | Table canvas | 1 |
| Footer disclaimer | Tray bar (always visible) and the Sources tab | 0 |
| Footer "Not assessed, never scored …" and "What 24×100 doesn't know" | Site tab, last lines | 1 |
| Records, rules and quotes (only in the drawer before) | Sources tab, and the drawer as before | 1 |

**City page** (`?view=city…`)

| Old place | New place | Clicks |
|---|---|---|
| Type rail | Top bar building-type switch | 0 |
| Zoom: "Pittsburgh", neighbourhood select, "N lots in …" | Left rail Filters: Neighborhood ("All of Pittsburgh" is the old button), "N lots shown"; for sale, ward and district are new | 0 |
| The map | Map canvas (the city's default) | 0 |
| Map caption (one dot per lot, colour = first blocker, source) | Left rail "About these dots" | 1 |
| Sentence | Header (plain words); the district-named sentence in the Rules tab | 0 / 1 |
| Coverage (pencil box) | Rules tab, first; the header stamp "Checked in 1 district" carries it as a tooltip | 1 |
| What fits numeral | "Fit now" tile (and "for sale") | 0 |
| What blocks it: width/area line, the pencil breakdown, counts table with glosses | Rules tab; live counts in the left rail's layers | 0 / 1 |
| What to do next: featured lot, another district's rules, Combine to fit | Tray "What to check next" and the Next tab | 0 / 1 |
| Combine to fit panel (`layer=assemble`) | Inspector "Runs" tab (the same panel), Table canvas (sortable runs) and the rail's "Combine to fit" layer | 0 |
| Lot table | Table canvas | 1 |
| Footer: lot count, source, classification note; disclaimer | Sources tab; tray bar | 1 / 0 |
| Selected-lot card (LotCard) | City-lot inspector: header and tiles; Rules tab (first blocker, width formula with rule chips, lot area, City status); Next tab (open lot, routes, record link, check the district's rules); routes also in the tray | 0 / 1 |

**Block page** (`?view=block…`)

| Old place | New place | Clicks |
|---|---|---|
| Title; neighbourhood, ward, bounding streets, parcels, pull date | Inspector title; the rest in the Rules tab | 0 / 1 |
| Sentence | Header (plain); the original in the Rules tab | 0 / 1 |
| Type rail, plate, legend | Top bar, Plan canvas, rail key | 0 |
| Lot tables (the street, the rest of the block) | Table canvas | 1 |
| Why the lot count differs | Rules tab | 1 |
| About this block | Next tab; top bar About | 1 |
| Disclaimer | Tray bar | 0 |

