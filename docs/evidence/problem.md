# Evidence: the problem, computed by 24×100

Everything below is computed by the app's own engine from public data pulled 26 Sep 2026
(`data/city/lots.json`, `data/blocks/10K.json`), and reproduced by `npx tsx scripts/facts.ts` into
`film/facts.json`. Numbers change when the data is refreshed.

## One real lot

**2241 Mahon St** (Block 10‑K, lot 25; Middle Hill; RM‑M; City-owned, listed Available for Sale, status last
updated 17 Nov 2016).

- Deed 24 × 100 = 2,400 sf: exactly the RM‑M minimum lot size since May 2025 (§903.03.C, Ord. 10‑2025).
- A two-unit house gets **4 ft** of width as of right: 24 − 10 − 10 = 4 (3.4 ft on the City's map). Both
  neighbors (lots 24 and 26) are vacant, so the contextual side setback can't apply (§925.06.C).
- A 16 ft two-unit proposal needs the side setbacks cut from 10 to 4 ft on each side: a variance.
- Detached house alone: 24 − 3 − 3 = **18 ft** with the narrow-lot side yards (§925.06.C), which fits a 16 ft house, but §925.06.C.1 allows 3 ft on both sides only if the neighbours are set back 3 ft or less; with both neighbours vacant that is an open question for the Zoning Administrator. On our reading of "no" (one side at the district setback), 24 − 3 − 10 = **11 ft**, which doesn't fit.
- Three-unit house on lots 25–27: 72 − 10 − 10 = **52 ft**: fits, but lot 26 is not City-owned
  (County owner type: corporation).
- Rowhouses on lots 25–27: end units **14 ft**, or 21 ft if "single-unit house" in §925.06.C covers attached
  houses. That is an open question for the Zoning Administrator.
- On the same street, 13 of the 14 original lots (County lots 21–34) stand empty; 12 of those are exactly
  24 × 100 by deed. Two lots can't be scored because the records disagree: lot 22 (1,200 sf assessed, 2,498 sf
  mapped) and lot 21 (0.89×, just outside the ±10% tolerance).

## The citywide number (H1)

**Scope.** 11,247 City-owned parcels classed "Vacant Land" in the City-Owned Properties dataset. We compute
blockers only in districts whose rules are at least source-checked: today that is **RM‑M only**, 984 lots.
Every other district is grey on the map ("rules not loaded"): 10,263 lots. The held-out district, R1D‑H, has
no signed rules yet, so it is grey too.

**RM‑M, default tolerance ±10%, two-unit house (16 ft wide, 45 ft deep):**

| | Lots |
|---|---:|
| City-owned vacant lots zoned RM‑M | 984 |
| Records disagree (County lot area vs City map beyond ±10%): not scored | 374 |
| Edges could not be computed (mostly paper streets missing from OpenStreetMap): not scored | 47 |
| **Computed** | **563** |
| Too narrow for the proposal (width blocks) | **480** (85% of computed) |
| Under the 2,400 sf minimum (area blocks) | **311** (55%) |
| Big enough by area but too narrow | **178** |
| First blocker is "not listed for sale" | 24 |
| Fits as of right | 29 |

Other building types on the same 563 lots:

| Type | Too narrow | Under the area minimum | Big enough but too narrow | Fits as of right |
|---|---:|---:|---:|---:|
| Detached house (16 ft) | 259 | 311 | 23 | 131 |
| Two-unit house (16 ft) | 480 | 311 | 178 | 29 |
| Rowhouse on its own lot (16 ft) | 480 | 311 | 178 | 30 |
| Three-unit house (30 ft) | 530 | 311 | 220 | 9 |

**Reading it.** H1 said that after the 2025 reform, width and ownership, not area, block most small infill
lots. On RM‑M's computable City-owned lots, width does block more lots than area for every multi-unit type
(480 vs 311 for a two-unit house). But area still blocks more than half of them, so "not area" is too strong.
The honest version: **for anything bigger than a detached house, width is the more common barrier, and area is
still a barrier on most lots too.** Ownership rarely comes first because these lots are City-owned by
construction; it bites when lots are combined (as on Mahon Street, where the middle lot isn't the City's).

**Reconciliation is part of the finding.** At ±10%, 374 of 984 RM‑M lots (38%) are refused because the
County's lot area and the City's parcel map disagree. At ±15% (a user setting), 245 are refused and 683 are
computed; the proportions barely move (two-unit: 589 too narrow, 381 under the area, 218 big enough but too
narrow). Many GIS polygons run a few percent under the nominal deed area; the app shows both values rather than
picking one.

**Where.** The RM‑M lots are concentrated in Middle Hill (241), Homewood South (240),
Lincoln‑Lemington‑Belmar (142), Crawford‑Roberts (132) and Homewood North (93).

## Money first: an order, not a finding (H5 unproven)

**What a practitioner said** (hackathon Slack, 26 Sep 2026; one practitioner, role unknown, quoted in the
team's spec §0.12; named in the app only as "a practitioner at the hackathon" until they agree to be named):
cost exceeding market value is the biggest challenge, and a developer typically checks whether a project
pencils financially before deciding to pursue a variance. On the 24 ft lot with 10 ft side setbacks: a clear
hardship case for a variance, but the time and expense of the process make these lots hard to develop.
Site costs (environmental, soil, water and sewer) are the hardest to know without paid due diligence. The same
practitioner first put vertical construction at about $325–$375 per sq ft; see the superseded note below. Second-hand reports (we have not seen the
originals): City staff said financial feasibility and comparable values matter; Pro-Housing Pittsburgh said
there is no predetermined scoring system and understandable categories are one approach.

So 24×100 now checks money first, because a money screen is free and a variance or a site study costs months
and money. That is an order of what to learn first. **It is not a finding that money blocks more often than the
rules: that (hypothesis H5) is unproven.** One practitioner's view is not a measurement.

**Cost, and what's left after building** (spec §0.13; hackathon Slack, 26 Sep 2026; neither practitioner has
agreed to be named, so the app says "a practitioner at the hackathon"):
- A second practitioner, asked by the first for local insight: vertical construction for City single-family
  infill "will vary significantly by scale of the builders"; $200–$250 per sq ft is a reasonable range. Inner-ring
  production builders "would imply even lower costs of $150 sqft should they enter the market" (speculative).
  Leads to check: County and City building-permit valuations, NAHB, RSMeans (we have not checked them).
- The first practitioner: City site work (water and sewer taps, grading, sidewalks, landscaping) runs
  $25,000–$50,000 for a single unit, depending on how deep the lines are, the soil, and over-excavation; many
  City lots held homes demolished into their own basements. Undermining or environmental conditions "can be
  upfront deal killers". Developers compare vertical cost with market value; what's left says how much site and
  soft cost the deal can carry.
- **Superseded:** the first practitioner's $325–$375 per sq ft. The team decided (26 Sep, ~18:25) to follow the
  second estimate only, because the first practitioner deferred to the second for local construction cost. It
  no longer appears in the app, `film/facts.json` or the film.

**The screen on 2241 Mahon St** (all from `film/facts.json`; the value is the newest new build in Ward 5,
2125 Rose St, $240,000, 2025: one sale, may be price-restricted, unverified):

| | Two-unit (1,080 sq ft per home) | Three-unit on lots 25–27 (1,350 sq ft per home) |
|---|---:|---:|
| Vertical construction, $200–$250/sq ft (practitioner estimate, excludes site work) | $216,000–$270,000 | $270,000–$337,500 |
| **Left for site work, soft costs and land** ($240,000 − that) | **$24,000 at best, nothing at the high end** | **nothing: building alone costs more** (−$30,000 to −$97,500) |
| If a production builder came in, $150/sq ft (same practitioner, speculative) | $162,000, leaving $78,000 | $202,500, leaving $37,500 |
| Site work, single unit (another practitioner; typical, not a cap) | $25,000–$50,000 | $25,000–$50,000 |
| Verdict | Only with subsidy (screening estimate) | Only with subsidy (screening estimate) |

Context, not used in the line above: the Ward 5 median of 33 valid 1–2 unit sales since 2023 is $155,000 (mostly
older homes; not an appraisal), and what an 80% AMI household of 3 could pay is about $268,467 (HUD FY2026
$79,500; red mortgage assumptions), a ceiling for an affordable sale. "Only with subsidy" means even $200/sq ft
leaves less than the low end of typical site work. The $200–$250 range alone moves what's left by $67,500 per
home at 1,350 sq ft, which is why a builder's price is the decisive next check. Every lot we can screen in Ward 5
comes out "Only with subsidy" at this range; that says nothing yet about how often the rules would stop the
same project.

**What would change this:** a local cost benchmark (none public that we found), appraisals for new builds, the
City's lot prices, gap-financing programs' real caps, and site investigations. The app's "What to check next"
asks for these in order, cheapest first.

## What this does not show

- It does not count privately owned vacant lots, or lots in districts whose rules haven't been checked.
- Width and area are dimensional tests on deed (or mapped) dimensions; they don't include use permission,
  parking, grading or community priorities, which stay pencil or not assessed.
- It is descriptive. It does not say which rule change would unlock the most lots; that needs the rules of
  more districts signed first.
