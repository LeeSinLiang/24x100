# Rule check: the coverage districts (agent's check, for a person to sign off on)

**Signed off by Sin (Student, team 24×100) on 27 Sep 2026**, in this session: 48 `source_checked` entries, one
per rule below, published in `data/rules/reviews.json` with the note "Signed off on the agent's rule check of the
four coverage districts (docs/reviews/rule-check-coverage.md)". Sin approved the check; they did not re-read each
quote.

Written by `uv run python -m extract rulecheck`. For each rule a model proposed, code checked, with no model:
the quote is word for word inside its cited section of the saved code text, and the value agrees with the
table read by position (the §903.03 site development table's row and use-subdistrict sub-row, or the
§911.02 Use Table's column). A rule neither reader covers is marked **read by eye**. Nothing here is signed:
signing is a person's act. Until then every rule below is pencil and colours no lot.

## R2-L

12 rules from `gemini-3.6-flash` (2026-09-27T07:08:01+00:00); 0 rejected by the guards. All quotes verbatim; every positional reading agrees. 1 read by eye.

| Rule | Value | Section | Positional reading | Agrees |
|---|---|---|---|---|
| `r2-l.x.min_lot_area` | 3000 | §903.03.B.2 | §903.03.B.2, Minimum Lot Size: '3,000 s.f.' | yes |
| `r2-l.x.front_setback` | 30 | §903.03.B.2 | §903.03.B.2, Minimum Front Setback: '30 ft.' | yes |
| `r2-l.x.rear_setback` | 30 | §903.03.B.2 | §903.03.B.2, Minimum Rear Setback: '30 ft.' | yes |
| `r2-l.x.side_setback_exterior` | 30 | §903.03.B.2 | §903.03.B.2, Minimum Exterior Sideyard Setback: '30 ft.' | yes |
| `r2-l.x.side_setback_interior` | 5 | §903.03.B.2 | §903.03.B.2, Minimum Interior Sideyard Setback: '5 ft' | yes |
| `r2-l.x.max_height_ft` | 40 | §903.03.B.2 | §903.03.B.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r2-l.x.max_stories` | 3 | §903.03.B.2 | §903.03.B.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r2-l.x.party_wall_side` | 0 | §903.03.B.2(c) | — | read by eye |
| `r2-l.x.use_detached` | P | §911.02 | §911.02, the R2 column: 'P' | yes |
| `r2-l.x.use_row` | P | §911.02 | §911.02, the R2 column: 'P' | yes |
| `r2-l.x.use_two` | P | §911.02 | §911.02, the R2 column: 'P' | yes |
| `r2-l.x.use_three` | N | §911.02 | §911.02, the R2 column: '(empty)' | yes |

## R1D-L

12 rules from `gemini-3.6-flash` (2026-09-27T07:09:35+00:00); 0 rejected by the guards. All quotes verbatim; every positional reading agrees. 1 read by eye.

| Rule | Value | Section | Positional reading | Agrees |
|---|---|---|---|---|
| `r1d-l.x.min_lot_area` | 3000 | §903.03.B.2 | §903.03.B.2, Minimum Lot Size: '3,000 s.f.' | yes |
| `r1d-l.x.front_setback` | 30 | §903.03.B.2 | §903.03.B.2, Minimum Front Setback: '30 ft.' | yes |
| `r1d-l.x.rear_setback` | 30 | §903.03.B.2 | §903.03.B.2, Minimum Rear Setback: '30 ft.' | yes |
| `r1d-l.x.side_setback_exterior` | 30 | §903.03.B.2 | §903.03.B.2, Minimum Exterior Sideyard Setback: '30 ft.' | yes |
| `r1d-l.x.side_setback_interior` | 5 | §903.03.B.2 | §903.03.B.2, Minimum Interior Sideyard Setback: '5 ft' | yes |
| `r1d-l.x.max_height_ft` | 40 | §903.03.B.2 | §903.03.B.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r1d-l.x.max_stories` | 3 | §903.03.B.2 | §903.03.B.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r1d-l.x.party_wall_side` | 0 | §903.03.B.2(c) | — | read by eye |
| `r1d-l.x.use_detached` | P | §911.02 | §911.02, the R1D column: 'P' | yes |
| `r1d-l.x.use_row` | S | §911.02 | §911.02, the R1D column: 'P/S' | yes |
| `r1d-l.x.use_two` | N | §911.02 | §911.02, the R1D column: '(empty)' | yes |
| `r1d-l.x.use_three` | N | §911.02 | §911.02, the R1D column: '(empty)' | yes |

## R2-H

12 rules from `gemini-3.6-flash` (2026-09-27T07:13:17+00:00); 0 rejected by the guards. All quotes verbatim; every positional reading agrees. 1 read by eye.

| Rule | Value | Section | Positional reading | Agrees |
|---|---|---|---|---|
| `r2-h.x.min_lot_area` | 1200 | §903.03.D.2 | §903.03.D.2, Minimum Lot Size: '1,200 s.f.' | yes |
| `r2-h.x.front_setback` | 15 | §903.03.D.2 | §903.03.D.2, Minimum Front Setback: '15 ft.' | yes |
| `r2-h.x.rear_setback` | 15 | §903.03.D.2 | §903.03.D.2, Minimum Rear Setback: '15 ft.' | yes |
| `r2-h.x.side_setback_exterior` | 15 | §903.03.D.2 | §903.03.D.2, Minimum Exterior Sideyard Setback: '15 ft.' | yes |
| `r2-h.x.side_setback_interior` | 5 | §903.03.D.2 | §903.03.D.2, Minimum Interior Sideyard Setback: '5 ft.' | yes |
| `r2-h.x.max_height_ft` | 40 | §903.03.D.2 | §903.03.D.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r2-h.x.max_stories` | 3 | §903.03.D.2 | §903.03.D.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r2-h.x.party_wall_side` | 0 | §903.03.D.2(d) | — | read by eye |
| `r2-h.x.use_detached` | P | §911.02 | §911.02, the R2 column: 'P' | yes |
| `r2-h.x.use_row` | P | §911.02 | §911.02, the R2 column: 'P' | yes |
| `r2-h.x.use_two` | P | §911.02 | §911.02, the R2 column: 'P' | yes |
| `r2-h.x.use_three` | N | §911.02 | §911.02, the R2 column: '(empty)' | yes |

## R1D-M

12 rules from `gemini-3.6-flash` (2026-09-27T07:16:20+00:00); 0 rejected by the guards. All quotes verbatim; every positional reading agrees. 1 read by eye.

| Rule | Value | Section | Positional reading | Agrees |
|---|---|---|---|---|
| `r1d-m.x.min_lot_area` | 2400 | §903.03.C.2 | §903.03.C.2, Minimum Lot Size: '2,400 s.f.' | yes |
| `r1d-m.x.front_setback` | 30 | §903.03.C.2 | §903.03.C.2, Minimum Front Setback: '30 ft.' | yes |
| `r1d-m.x.rear_setback` | 30 | §903.03.C.2 | §903.03.C.2, Minimum Rear Setback: '30 ft.' | yes |
| `r1d-m.x.side_setback_exterior` | 30 | §903.03.C.2 | §903.03.C.2, Minimum Exterior Sideyard Setback: '30 ft.' | yes |
| `r1d-m.x.side_setback_interior` | 5 | §903.03.C.2 | §903.03.C.2, Minimum Interior Sideyard Setback: '5 ft.' | yes |
| `r1d-m.x.max_height_ft` | 40 | §903.03.C.2 | §903.03.C.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r1d-m.x.max_stories` | 3 | §903.03.C.2 | §903.03.C.2, Maximum Height: '40 ft. (not to exceed 3 stories)' | yes |
| `r1d-m.x.party_wall_side` | 0 | §903.03.C.2(c) | — | read by eye |
| `r1d-m.x.use_detached` | P | §911.02 | §911.02, the R1D column: 'P' | yes |
| `r1d-m.x.use_row` | S | §911.02 | §911.02, the R1D column: 'P/S' | yes |
| `r1d-m.x.use_two` | N | §911.02 | §911.02, the R1D column: '(empty)' | yes |
| `r1d-m.x.use_three` | N | §911.02 | §911.02, the R1D column: '(empty)' | yes |

