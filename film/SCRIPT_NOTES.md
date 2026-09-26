# Script notes

One plain sentence per beat: what is on screen, and why it matters. The film script is written from these.
Every number comes from `film/facts.json` (fact ids in brackets); if the app changes, regenerate the facts
with `npx tsx scripts/facts.ts` and re-read this page. Clips: `npm run demo -- --record` (one per beat,
1920×1080, `film/clips/`). Links in `STORYBOARD.md`.

| Beat | On screen | Why it matters | Facts |
|---|---|---|---|
| B01 · The surprise | 2241 Mahon St meets the new 2,400 sf minimum exactly, and a two-unit house still gets 4 ft; every lot on Mahon Street shows the same red sliver inside a red 16 ft outline. | The 2025 reform fixed lot size, but width is the next barrier, and it's the whole street, not one lot. | `lot25_two_width`, `rmm_min_lot_area`, `lot25_two_proposal`, `street_lots_empty`, `street_lots_exact_2400` |
| B02 · Not one lot | The city map: 11,247 City-owned vacant lots, RM‑M lots colored by what blocks them, everything else grey because its rules haven't been checked. | The app computes its own citywide number and says exactly what it didn't compute. | `city_lots_total`, `city_width_not_area`, `city_area_any`, `city_districts_computed` |
| B03 · Why | The evidence drawer with the quoted code sentence: if the lots on either side are vacant, the district setback applies. | Every number opens the law it came from; empty neighbors are the reason. | `rmm_side_interior`, `contextual_clause` |
| B04 · Combine three lots | The envelope widens to 52 ft; then the money panel, checked first: vertical construction at a practitioner's $200–$250/sq ft is $270,000–$337,500 per home, against the newest new build at $240,000, so nothing is left for site work, soft costs and land; the speculative production-builder line leaves $37,500; site work runs $25,000–$50,000, not a cap. Only with subsidy (screening estimate). | The rules open up; the money doesn't, and the app says exactly how sure it is. | `lots25_27_three_width`, `lot26_owner`, `vertical_cost_three`, `left_after_building_three`, `vertical_cost_three_prod`, `left_after_building_three_prod`, `site_work_single_unit`, `value_signal_newest`, `verdict_three` |
| B05 · The open question | Rowhouses on 25–27: end units 14 ft, or 21 ft if the City reads "single-unit house" to include attached houses, drawn in trembling pencil. | The app shows what it doesn't know instead of guessing. | `row_end_units` |
| B06 · Assume it | An assumed "yes" turns the end units red at 21 ft; the Rules chip stays open and the question stays in the letter. | Exploring an answer is not the same as having one. | `row_end_units` |
| B07 · The AI reads the code | The review screen for a district nobody typed: the model's proposed rules beside the saved code text, each quote highlighted; a teammate signs one and it dries from pencil to ink. | AI proposes; a named person decides; the log keeps who and when. | `extraction_eval` |
| B08 · A district nobody typed | 511 Lowell St in Larimer (R1D‑H) runs on the extracted rules, ink where signed and pencil where not. | The same engine works on a district it wasn't built around. | `held_out_link` |
| B09 · Refusal | 2247 Humber Way: Can't score; the County says 1,200 sf and the City map measures 2,498 sf. | It refuses rather than guesses. | `lot22_assessed`, `lot22_mapped`, `lot22_ratio` |
| B10 · Site → next checks → the letter | The Site panel, deal-killers first (undermining: none mapped, not proof; environmental: the 1927 map's commercial district), then a basement the old house may have been demolished into, soil and slope, water and sewer; then "What to check next, in order": lot 26 and prices (free), a builder's price (decisive, because costs vary a lot with builder size), the undermining map and environmental records (free), the Zoning Administrator, paid studies last; then the draft letter. | The output is a real next step, in the order that costs least. | `site_soil_slopes_25_27`, `site_environmental_1927`, `left_after_building_three`, `lot25_status_updated` |
| B11 · What changed | The last refresh's differences in pencil, and the watchlist digest in dry-run preview, not sent. | It keeps watching after the demo. | — |
| B12 · What we don't know | The limits page: GIS not survey, not assessed items, the City interprets its own code, no personal data. | It ends on honesty. | — |

Words to avoid in the voice-over: "AI-powered", "smart", "optimize", "insights", "score". Say "screening
estimate" for the money numbers and "what's left after building" for the headline (there is no "gap" any more); say "a practitioner at the hackathon" (not a name)
until they agree to be named. Say who signed a rule only if that person really did.
