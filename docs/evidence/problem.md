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
- Detached house alone: 24 − 3 − 3 = **18 ft** (narrow-lot side yards, §925.06.C): fits.
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

## Money (H5): a hypothesis, not a finding

The team believes both rules and money block small infill. The money wall is built to test that, but nothing
here confirms it:

- Ward 5 comparable sales since 2023: 33 valid sales of 1–2 unit homes, median $155,000, middle half
  $105,000–$235,000; the newest comparable, 2125 Rose St, built 2025, sold for $240,000.
- To break even at the median, a builder would need hard costs at or below about $103/sq ft (two-unit, 1,080 sq
  ft per home) or $82/sq ft (three-unit, 1,350 sq ft per home), with a $15,000 sitework allowance on a steep lot
  and no lot price. The cost range shown ($225–$300/sq ft) is the team's placeholder, not a quote.
- The HUD FY2026 80% income limit for a 3-person household in the Pittsburgh HMFA is $79,500; with our red
  mortgage assumptions that buys about $268,000, more than the median sale. So on these assumptions the gap is
  between cost and value, not between value and what a household can pay.

**What mentors or Slack said.** Nothing yet. The team's questions (`SLACK_QUESTIONS_PROMPT.md`: what usually
stops a project first, realistic 2026 costs per sq ft, whether appraisals come in below cost, which programs
fill the gap) had not been answered when this was written. When answers arrive, quote them here with
permission, including answers that disagree, and put any cost figure a mentor gives into the money wall as a
red assumption with their name and role.

## What this does not show

- It does not count privately owned vacant lots, or lots in districts whose rules haven't been checked.
- Width and area are dimensional tests on deed (or mapped) dimensions; they don't include use permission,
  parking, grading or community priorities, which stay pencil or not assessed.
- It is descriptive. It does not say which rule change would unlock the most lots; that needs the rules of
  more districts signed first.
