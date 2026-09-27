# Limitations

These are also stated in the app (lot view footer, and "What 24×100 doesn't know" on the About page).

- **The City of Pittsburgh interprets its own code; 24×100 is decision support.** Nothing here is legal,
  financial or zoning advice.
- **Parcel geometry comes from GIS, not surveys.** Lot areas are checked against deeds and the County
  assessment; conflicts beyond the tolerance (±10% by default, your setting) are shown and the lot is not
  scored. Lot 22 (2247 Humber Way: 1,200 sf assessed, about 2,500 sf mapped) is refused. At the default
  tolerance lot 21 (0.89×) is refused too.
- **Not assessed:** water and sewer capacity, soils and old fill, title and liens, and community priorities.
  Water and sewer counts as an unknown in every Development Ease range (below); the others aren't in it.
  24×100 points to the Registered Community Organization instead of scoring what a neighborhood wants.
- **Building footprints come from a 2023 layer.** A house built or demolished since then is not reflected.
- **The slope layer is a derived threshold (25%+), not the steep-slope overlay.** A slope flag raises a
  grading question; it does not decide one.
- **Rules.** The 20 rules the Mahon Street and Larimer results use were checked by the agent (quotes verbatim,
  values matching; `docs/reviews/rule-check-for-sin.md`) and signed off by Sin on that check; a person took
  responsibility for the agent's check without re-reading each quote. None is City-confirmed. Other rules the
  model proposed stay pencil until a named person signs them in the review screen, including the R1D‑H
  lot-of-record, rowhouse and three-unit rows. The narrow-lot question ("does 'single-unit house' include attached houses?") is open; an
  assumption stays red, keeps the Rules chip open, and stays in the inquiry.
- **The Development Ease Score is a range, and its weights are our assumptions.** Each lot gets a range out of
  100, never one number, built from six parts: zoning fit, approvals needed, ownership and assembly, site (the
  mapped slope and mine layers), water and sewer, and money at full cost. It starts at 100. A known step (a
  variance, a City sale, a subsidy gap) takes its weight off both ends; an unknown takes it off the bottom end
  only, so what we don't know widens the range instead of hiding. A fit that rests on pencil geometry (mapped
  lines without deed dimensions, an open reading) or on your own assumption counts as unknown, not clear.
  Water and sewer is unknown on every lot, so every range carries that gap. When 4 or more of the 5 parts we
  can assess are unknown, or the lot is refused (records that disagree, like lot 22, or rules not loaded), it
  says "can't score yet" instead of a number. The weights (a variance 35, a City sale 5, water and sewer 20,
  and so on, in `engine/src/ease.ts`) are ours, not the City's and not measured; they are shown with every
  result, with the arithmetic.
- **The money screen is a screening estimate.** Vertical construction cost ($200–$250 per sq ft, City
  single-family infill) is one practitioner's estimate from the hackathon Slack, unconfirmed, excluding site
  work, and it "varies a lot with builder size"; a builder's price for the building is the decisive check.
  The $150 production-builder line is the same practitioner's speculation, never the default. "Left for site
  work, soft costs and land" is the newest new-build sale in the ward minus that cost: one sale, possibly
  price-restricted, not an appraisal. The ward median is context only (mostly older homes); what an 80% AMI
  buyer could pay is a ceiling, never used as a value. Site work ($25,000–$50,000 for one home, another
  practitioner) is typical, not a cap. Comparable sales are loaded for Wards 5 and 12 only; lots in other
  wards show "Money: not assessed".
- **Money first is an order, not a finding.** A practitioner said developers check whether a project pencils
  before pursuing a variance; which barrier blocks more often is unproven (H5).
- **Site conditions are not assessed.** Soil, environmental and water/sewer unknowns can change the decision;
  the app shows the free public signal (slope share, 1927 zoning, no utility data) and what resolves each,
  never "clean". The ease range's site part reads only the City's mapped slope and mine layers.
- **City sale status may be stale.** The City-Owned Properties dataset last updated lot 25's status on
  2016‑11‑17; the inquiry asks whether it is current.
- **Coverage.** Lot detail covers the blocks with block files (Block 10‑K, Middle Hill; the held-out Larimer
  block). The city map covers City-owned vacant lots, computed only in districts whose rules have been
  checked (RM‑M, R1D‑H, R2‑L, R1D‑L, R2‑H and R1D‑M today, 2,318 lots); other districts are grey. The R1D
  districts don't permit two- or three-unit houses and R2 doesn't permit three-unit houses, so those lots read
  "not permitted here" for those types.
- **No personal data is used.** Owner names and mailing addresses are never requested or stored (tested).
