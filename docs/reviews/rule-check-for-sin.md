# Rule check for Sin (before signing)

Prepared by the build agent on Sun 27 Sep 2026. These are the 20 rules that the Mahon Street (Block 10‑K) and
Larimer (lot 203) results use. For each one, the agent checked the two things a signature says:

- the quote appears **verbatim** in the saved code text, inside the cited section (the same guard the app uses);
- the rule's value is what the quote says.

**All 20 pass.** For `rm-m.party_wall` the quote writes the value as the word "zero" (value 0). This page is the
agent's check, not a signature. A signature means **you** compared each rule with its quote. Open
`?view=review&district=RM-M` and `?view=review&district=R1D-H`, read each highlighted quote beside its rule, and
sign the ones you agree with (name "Sin", role "Student, team 24×100", note "Quote matches the saved code text").
Then "Send to the steward" and run `npm run check-reviews -- <the file> --write`. The signatures become ink in the
app, the graph and the letters.

| Rule | Field | Value | Section | Quote verbatim in the saved text | Value matches the quote | Signed now by |
|---|---|---|---|---|---|---|
| `pgh.contextual_side` | contextual_side | 3 | §925.06.C | yes | yes | Claude (research pass) |
| `pgh.narrow_lot_side` | narrow_lot_side_table | table (23 rows) | §925.06.C | yes | yes | Claude (research pass) |
| `r1d-h.x.front_setback` | front_setback | 15 | §903.03.D.2 | yes | yes | — |
| `r1d-h.x.grading_review` | grading_review | null | §915.02.A.1 | yes | read it (not a number) | — |
| `r1d-h.x.max_height_ft` | max_height_ft | 40 | §903.03.D.2 | yes | yes | — |
| `r1d-h.x.max_stories` | max_stories | 3 | §903.03.D.2 | yes | yes | — |
| `r1d-h.x.min_lot_area` | min_lot_area | 1200 | §903.03.D.2 | yes | yes | — |
| `r1d-h.x.parking_detached` | parking_detached | 1 | §914.02.A | yes | yes | — |
| `r1d-h.x.parking_two` | parking_two | 1 | §914.02.A | yes | yes | — |
| `r1d-h.x.rear_setback` | rear_setback | 15 | §903.03.D.2 | yes | yes | — |
| `r1d-h.x.side_setback_interior` | side_setback_interior | 5 | §903.03.D.2 | yes | yes | — |
| `r1d-h.x.use_detached` | use_detached | "P" | §911.02 | yes | read it (not a number) | — |
| `r1d-h.x.use_two` | use_two | "N" | §911.02 | yes | read it (not a number) | — |
| `rm-m.front` | front_setback | 25 | §903.03.C | yes | yes | Claude (research pass) |
| `rm-m.max_height` | max_height_ft | 55 | §903.03.C | yes | yes | Claude (research pass) |
| `rm-m.max_stories` | max_stories | 4 | §903.03.C | yes | yes | Claude (research pass) |
| `rm-m.min_lot_area` | min_lot_area | 2400 | §903.03.C | yes | yes | Claude (research pass) |
| `rm-m.party_wall` | party_wall_side | 0 | §903.03.C.2(c) | yes | yes (the quote says "zero") | Claude (research pass) |
| `rm-m.rear` | rear_setback | 25 | §903.03.C | yes | yes | Claude (research pass) |
| `rm-m.side_interior` | side_setback_interior | 10 | §903.03.C | yes | yes | Claude (research pass) |

## The quotes

- `pgh.contextual_side` (§925.06.C): “A Contextual Side Setback may fall at any point between the required side setback and the side setback that exists on a lot that is adjacent and oriented to the same street as the subject lot, but shall be a minimum of three (3) feet. If the subject lot is a corner lot, the Contextual Side Setback may fall at any point between the required side setback required by the zoning district and the side setback that exists on the lot that is adjacent and oriented to the same street as the subject lot, but shall be a minimum of three (3) feet. If lots on either side of the subject lot are vacant, the setback that is required by the zoning district shall apply.”
- `pgh.narrow_lot_side` (§925.06.C): “Regardless of the setbacks of adjacent structures, for any single-unit house on a recorded zoning lot that is less than sixty (60) feet in width, the side yards may be reduced according to the following:”
- `r1d-h.x.front_setback` (§903.03.D.2): “R1D, R1A, R2 & R3 Subdistricts | 15 ft.”
- `r1d-h.x.grading_review` (§915.02.A.1): “The Grading, Cut, and Fill Standards of this Section Shall Apply to All Slopes.”
- `r1d-h.x.max_height_ft` (§903.03.D.2): “R1D, R1A, R2 & R3 Subdistricts | 40 ft. (not to exceed 3 stories)”
- `r1d-h.x.max_stories` (§903.03.D.2): “R1D, R1A, R2 & R3 Subdistricts | 40 ft. (not to exceed 3 stories)”
- `r1d-h.x.min_lot_area` (§903.03.D.2): “Minimum Lot Size | 1,200 s.f.”
- `r1d-h.x.parking_detached` (§914.02.A): “Single-Unit, Detached | 1 per unit | 4 per unit”
- `r1d-h.x.parking_two` (§914.02.A): “Two-Unit | 1 per unit | 2 per unit”
- `r1d-h.x.rear_setback` (§903.03.D.2): “R1D, R1A, R2 & R3 Subdistricts | 15 ft.”
- `r1d-h.x.side_setback_interior` (§903.03.D.2): “R1D, R2 & R3 Subdistricts | 5 ft.”
- `r1d-h.x.use_detached` (§911.02): “Single-Unit Detached Residential means the use of a zoning lot for one detached housing unit. | P”
- `r1d-h.x.use_two` (§911.02): “Two-Unit Residential means the use of a zoning lot for two dwelling units that are contained within a single building.) | |”
- `rm-m.front` (§903.03.C): “Minimum Front Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft.”
- `rm-m.max_height` (§903.03.C): “RM Subdistrict | 55 ft. (not to exceed 4 stories)”
- `rm-m.max_stories` (§903.03.C): “RM Subdistrict | 55 ft. (not to exceed 4 stories)”
- `rm-m.min_lot_area` (§903.03.C): “Moderate Density Subdistrict | Minimum Lot Size | 2,400 s.f.”
- `rm-m.party_wall` (§903.03.C.2(c)): “When a dwelling is "attached" to one (1) or more separate dwelling units on separate lots by a party wall or separate abutting wall the required interior sideyard setback shall be zero on the abutting or party wall side.”
- `rm-m.rear` (§903.03.C): “Minimum Rear Setback | | R1D, R1A, R2 & R3 Subdistricts | 30 ft. | RM Subdistrict | 25 ft.”
- `rm-m.side_interior` (§903.03.C): “Minimum Interior Sideyard Setback | | R1D, R2 & R3 Subdistricts | 5 ft. | R1A Subdistrict | 5 ft. | RM Subdistrict | 10 ft.”

## For B07 (signed on camera, when recording resumes)

| Rule | Field | Value | Section | Quote verbatim in the saved text | Value matches the quote |
|---|---|---|---|---|---|
| `r1d-h.x.side_setback_exterior` | side_setback_exterior | 15 | §903.03.D.2 | yes | yes |

The quote: “R1D, R1A, R2 & R3 Subdistricts | 15 ft.” The recorder signs it as Sin ("Student, team 24×100") in the
recording browser only; it is not published unless Sin signs it in the app too. Sin confirms this rule before the
final pass.
