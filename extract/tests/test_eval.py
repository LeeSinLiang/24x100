"""The eval scores agreement correctly on small fixtures (it can say no)."""

import copy
import json

from extract.eval import KEY_FIELDS, answer_key, compare, narrow_flag, quote_stats, trust_counts
from extract.source import REPO


def key_as_extracted():
    """The answer key reshaped as if extracted: every field should agree."""
    key = answer_key()
    return [dict(copy.deepcopy(r), id=f"rm-m.x.{f}", origin="extracted") for f, r in key.items()]


def score(rules):
    rows = compare(rules, answer_key())
    return sum(r["agree"] for r in rows), len(rows), {r["field"]: r for r in rows}


def test_perfect_fixture_scores_11_of_11():
    a, n, _ = score(key_as_extracted())
    assert (a, n) == (11, 11) and n == len(KEY_FIELDS)


def test_a_wrong_value_costs_one_field():
    rules = key_as_extracted()
    next(r for r in rules if r["field"] == "side_setback_interior")["value"] = 5
    a, n, rows = score(rules)
    assert (a, n) == (10, 11)
    assert not rows["side_setback_interior"]["agree"] and "5 != 10" in rows["side_setback_interior"]["why"]
    assert a / n >= 0.90  # 10/11 still meets the 90% target


def test_two_misses_fail_the_target():
    rules = [r for r in key_as_extracted() if r["field"] not in ("party_wall_side",)]
    next(r for r in rules if r["field"] == "max_stories")["value"] = 3
    a, n, rows = score(rules)
    assert (a, n) == (9, 11) and a / n < 0.90
    assert rows["party_wall_side"]["why"].startswith("not extracted")


def test_contextual_needs_the_vacant_clause():
    rules = key_as_extracted()
    cs = next(r for r in rules if r["field"] == "contextual_side")
    cs["quote"] = "A Contextual Side Setback may fall at any point between the required side setback and the side setback that exists on a lot that is adjacent and oriented to the same street as the subject lot, but shall be a minimum of three (3) feet."
    cs["condition"] = "next to a built lot"
    _, _, rows = score(rules)
    assert not rows["contextual_side"]["agree"]
    cs["condition"] = "Not available when the lots on either side are vacant."
    _, _, rows = score(rules)
    assert rows["contextual_side"]["agree"]


def test_narrow_table_must_match_every_row():
    rules = key_as_extracted()
    t = next(r for r in rules if r["field"] == "narrow_lot_side_table")
    t["value"][0]["streetside"] = 30  # the 59 ft row
    _, _, rows = score(rules)
    assert not rows["narrow_lot_side_table"]["agree"]
    assert "37-and-below row matches" in rows["narrow_lot_side_table"]["why"]


def test_quote_stats_and_trust_counts():
    rules = key_as_extracted()
    for r in rules:
        r["verification"] = {"level": "unreviewed", "reviewer": None, "role": None, "at": None, "note": None, "reference": None}
        r["dagger"] = r["field"] == "max_stories"
    doc = {"rules": rules, "rejected": [{"rule": {}, "reason": "quote guard: x"}, {"rule": {}, "reason": "unit 'ft' is wrong"}]}
    s = quote_stats(doc)
    assert (s["proposed"], s["rejected_quote"], s["rejected_other"]) == (13, 1, 1)
    assert abs(s["quote_pass_rate"] - 12 / 13) < 1e-9 and s["accepted_recheck_failures"] == []
    assert trust_counts(rules, []) == {"pencil": 11, "ink": 0, "struck": 0}
    sign = lambda rid, role: {"rule_id": rid, "action": "source_checked", "reviewer": "A. Person", "role": role, "reason": "matches", "at": "2026-09-27T01:00:00Z"}
    audit = [sign("rm-m.x.front_setback", "Housing lead"), sign("rm-m.x.max_stories", "AI agent"),
             {"rule_id": "rm-m.x.rear_setback", "action": "struck", "reviewer": "B", "role": "r", "reason": "wrong", "at": "2026-09-27T01:00:00Z"}]
    # max_stories is † and only an AI signed it -> still pencil
    assert trust_counts(rules, audit) == {"pencil": 9, "ink": 1, "struck": 1}


def test_narrow_flag_reports_who_asked():
    rules = key_as_extracted()
    t = next(r for r in rules if r["field"] == "narrow_lot_side_table")
    t["question_for_city"] = "Does it include single-unit attached houses?"
    doc = {"rules": rules, "checks": [{"id": t["id"], "ambiguous": True, "question_source": "model"}]}
    assert narrow_flag(doc)["flagged_by_model"] is True
    doc["checks"][0]["question_source"] = "guard"
    assert narrow_flag(doc)["flagged_by_model"] is False
