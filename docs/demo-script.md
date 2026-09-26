# Demo script (three minutes)

Updated from `Plate_Proposal.md` §9 to match what was built. Shot list and timing: `STORYBOARD.md`. One
sentence per beat for the voice-over: `film/SCRIPT_NOTES.md`. Numbers: `film/facts.json`.

Run the app with `npm run build && npm run preview` (http://localhost:4173) or `npm run dev`
(http://localhost:5173). Add `&present=1` on a projector, `&record=1` for a 1920×1080 recording.

| Time | Beat | Link | Say (plainly) |
|---|---|---|---|
| 0:00 | The surprise | `?view=lot&block=10K&lot=25&type=two` | "Since May 2025, 2241 Mahon Street is big enough. A two-unit house still gets four feet. And so does every lot on the street." |
| 0:16 | Not one lot | `?view=city&type=two` | "Across the City's own vacant lots in this district, width blocks more lots than area does. Grey means we haven't checked those rules yet; we don't guess." |
| 0:32 | Why | `?view=lot&block=10K&lot=25&type=two&drawer=rule:pgh.contextual_side` | "Here's the sentence in the code. Both neighbors are empty, so the full ten-foot setbacks apply." |
| 0:48 | Combine | start at two-unit, click **Three-unit on lots 25–27** | "Combine three lots and you get 52 feet. But the middle lot isn't the City's. And the money wall: homes here sell for about $155,000; a builder would have to build for $82 a square foot or less to break even. That's our hypothesis, not a finding." |
| 1:16 | Open question | `?view=lot&block=10K&lot=25&type=row&lots=25,26,27&drawer=question:q.single_unit_includes_attached` | "Rowhouses depend on a sentence nobody has settled. The app keeps it in pencil and asks the Zoning Administrator." |
| 1:32 | Assume it | add `&assume=q.single_unit_includes_attached:yes` (or click Assume yes) | "You can explore an answer. It turns red. It never becomes ink." |
| 1:44 | The AI reads the code | `?view=review&district=R1D-H` | "For a district nobody typed, the model proposes rules, each tied to the exact words. A person signs them; the record keeps who and when." |
| 2:06 | Held-out lot | `?view=lot&block=0124P&lot=203&type=detached` | "The same engine, on a Larimer lot." |
| 2:20 | Refusal | `?view=lot&block=10K&lot=22&type=two` | "When the records disagree, it refuses to score." |
| 2:30 | The letter | `?view=inquiry&block=10K&lot=25&type=three&lots=25,26,27` | "What you take away is a letter to the right offices. Every number is checked. You send it, not us." |
| 2:46 | What changed | `?view=changes` | "It keeps watching the public data and tells you what moved." |
| 2:54 | Limits | `?view=about&block=10K&section=limits` | "And it tells you what it doesn't know." |

Say only what is true on the day you record: if the R1D‑H rules haven't been signed by a teammate, B07 shows
them in pencil and B08 shows pencil numbers. Never sign a rule on camera unless the person signing actually
checked it.
