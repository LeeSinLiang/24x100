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
| B04 · Combine three lots | The envelope widens to 52 ft; then the money panel, checked first: vertical construction at a practitioner's $325–$375/sq ft, the three value signals, and "at least $170,283 per home": Only with subsidy (screening estimate). | The rules open up; the money doesn't, and the app says exactly how sure it is. | `lots25_27_three_width`, `lot26_owner`, `vertical_psf`, `vertical_cost_three`, `value_signal_median`, `value_signal_newest`, `value_signal_affordable`, `gap_lower_bound_three`, `verdict_three` |
| B05 · The open question | Rowhouses on 25–27: end units 14 ft, or 21 ft if the City reads "single-unit house" to include attached houses, drawn in trembling pencil. | The app shows what it doesn't know instead of guessing. | `row_end_units` |
| B06 · Assume it | An assumed "yes" turns the end units red at 21 ft; the Rules chip stays open and the question stays in the letter. | Exploring an answer is not the same as having one. | `row_end_units` |
| B07 · The AI reads the code | The review screen for a district nobody typed: the model's proposed rules beside the saved code text, each quote highlighted; a teammate signs one and it dries from pencil to ink. | AI proposes; a named person decides; the log keeps who and when. | `extraction_eval` |
| B08 · A district nobody typed | 511 Lowell St in Larimer (R1D‑H) runs on the extracted rules, ink where signed and pencil where not. | The same engine works on a district it wasn't built around. | `held_out_link` |
| B09 · Refusal | 2247 Humber Way: Can't score; the County says 1,200 sf and the City map measures 2,498 sf. | It refuses rather than guesses. | `lot22_assessed`, `lot22_mapped`, `lot22_ratio` |
| B10 · Site → next checks → the letter | The Site panel (soil, contamination, the pipes under the lot: not assessed, what resolves each), then "What to check next, in order" (free calls first, paid studies last), then the draft letter. | The output is a real next step, in the order that costs least. | `site_soil_slopes_25_27`, `site_environmental_1927`, `gap_lower_bound_three`, `lot25_status_updated` |
| B11 · What changed | The last refresh's differences in pencil, and the watchlist digest in dry-run preview, not sent. | It keeps watching after the demo. | — |
| B12 · What we don't know | The limits page: GIS not survey, not assessed items, the City interprets its own code, no personal data. | It ends on honesty. | — |

Words to avoid in the voice-over: "AI-powered", "smart", "optimize", "insights", "score". Say "screening
estimate" for the money numbers and "at least" for the gap; say "a practitioner at the hackathon" (not a name)
until they agree to be named. Say who signed a rule only if that person really did.
