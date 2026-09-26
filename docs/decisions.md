# Decisions

Every default chosen where the spec or the brief left a choice open. Newest last.

| # | Date (ET) | Decision | Why |
|---|---|---|---|
| 1 | Sat 26 Sep 15:50 | Only `GOOGLE_API_KEY` is set; no `ANTHROPIC_API_KEY`. Gemini is the only extraction provider run. The Claude path is built and tested for shape, not run; the eval says so. | Spec §0.9: compare both only when both keys are set. |
| 2 | Sat 26 Sep 15:50 | The address "2241 Mahon St" comes from the City-Owned Properties dataset (`address` field). The County assessment lists the lot as "0 MAHON ST". The UI shows the address with its source. | Every label must trace to a source. |
| 3 | Sat 26 Sep 15:50 | City-Owned Properties `last_updated` for lot 25's status is 2016-11-17. The app shows this date beside "Available for Sale" and puts "is it still for sale?" in the inquiry. | Never hide uncertainty. |
| 4 | Sat 26 Sep 15:50 | The first screen (no URL parameters) is the citywide workspace; the lot view is one click away and every storyboard beat is a deep link. | Brief: "open on the whole city"; spec §0.5.5: open on the task. The citywide view is the task at city scale and carries What fits / What blocks it / What to do next. |
| 5 | Sat 26 Sep 15:50 | "Since May 2025 the lot meets the minimum lot size" is stated; "the reform made it legal" is not, because the pre-reform value (3,200 sf) is † unverified. The old value appears in pencil only. | The claim must rest on checked text. |
| 6 | Sat 26 Sep 15:50 | The engine evaluates with ink and pencil rules; every output carries the weakest trust level of its inputs. Pencil outputs render in pencil, never ink, and pencil-dependent approvals only widen the score range. Struck rules are excluded. | Lets the held-out district show a pencil preview before review without any pencil number appearing as ink (spec §0.5.1, §9). |
