# Limitations

These are also stated in the app (lot view footer, and "What 24×100 doesn't know" on the About page).

- **The City of Pittsburgh interprets its own code; 24×100 is decision support.** Nothing here is legal,
  financial or zoning advice.
- **Parcel geometry comes from GIS, not surveys.** Lot areas are checked against deeds and the County
  assessment; conflicts beyond the tolerance (±10% by default, your setting) are shown and the lot is not
  scored. Lot 22 (2247 Humber Way: 1,200 sf assessed, about 2,500 sf mapped) is refused. At the default
  tolerance lot 21 (0.89×) is refused too.
- **Not assessed, never scored:** water and sewer capacity, soils and old fill, title and liens, and
  community priorities. 24×100 points to the Registered Community Organization instead of scoring what a
  neighborhood wants.
- **Building footprints come from a 2023 layer.** A house built or demolished since then is not reflected.
- **The slope layer is a derived threshold (25%+), not the steep-slope overlay.** A slope flag raises a
  grading question; it does not decide one.
- **Rules.** The RM‑M dimensional rules were matched to the saved code text by an AI research pass and are
  flagged for a teammate to re-check. None is City-confirmed. Rules proposed by the model stay pencil until a
  named person signs them in the review screen. The use table, parking, grading and lot-of-record provisions
  are pencil. The narrow-lot question ("does 'single-unit house' include attached houses?") is open; an
  assumption stays red, keeps the Rules chip open, and stays in the inquiry.
- **There is no score.** Each lot gets a verdict in words and Money · Rules · Site chips.
- **The money screen is a screening estimate.** Vertical construction cost ($325–$375 per sq ft) is one
  practitioner's estimate from the hackathon Slack, unconfirmed, excluding site work. The gap is a lower bound
  against the highest of three value signals; site work, land, soft costs and financing are not in it. The
  Ward 5 median is mostly older homes and is not an appraisal; the newest new build is one sale and may be
  price-restricted. Comparable sales are loaded for Ward 5 only, so other wards show "not assessed".
- **Money first is an order, not a finding.** A practitioner said developers check whether a project pencils
  before pursuing a variance; which barrier blocks more often is unproven (H5).
- **Site is not assessed.** Soil, environmental and water/sewer unknowns can change the decision; the app shows
  the free public signal (slope share, 1927 zoning, no utility data) and what resolves each, never "clean".
- **City sale status may be stale.** The City-Owned Properties dataset last updated lot 25's status on
  2016‑11‑17; the inquiry asks whether it is current.
- **Coverage.** Lot detail covers the blocks with block files (Block 10‑K, Middle Hill; the held-out Larimer
  block). The city map covers City-owned vacant lots, computed only in districts whose rules have been
  checked; other districts are grey.
- **No personal data is used.** Owner names and mailing addresses are never requested or stored (tested).
