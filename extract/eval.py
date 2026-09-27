"""Evaluate extraction against the answer key (team research notes, checked by a person) and write docs/eval.md + eval.json.

    uv run python -m extract eval

- RM-M field-level agreement with data/rules/base/rm-m.json + pgh.json (target >= 90%).
- Verbatim-quote pass rate (the guard's verdicts, re-checked now with the Python locator).
- Rejected count, tokens, latency, and the cost per district at Google's published paid-tier price.
- Held-out districts (R1D-H, R2-H if run): the rules proposed and their pencil/ink counts, folded
  with data/rules/reviews.json if people have signed any in the app.
Everything in the report is computed from the files; nothing is typed in by hand.
"""

from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from pathlib import Path

from .source import REPO, check_quote, normalize_ws, read_code
from .usetable import mismatch as use_mismatch

EXTRACTED = REPO / "data" / "rules" / "extracted"
COMPARE = EXTRACTED / "compare"
BASE = REPO / "data" / "rules" / "base"
DOC = REPO / "docs" / "eval.md"

# The answer key (spec §6.3) as it sits in the rule store. Order = report order.
KEY_FIELDS = [
    "min_lot_area",
    "front_setback",
    "rear_setback",
    "side_setback_exterior",
    "side_setback_interior",
    "max_height_ft",
    "max_stories",
    "party_wall_side",
    "contextual_side",
    "contextual_rear",
    "narrow_lot_side_table",
]
TARGET = 0.90

# Google's published paid-tier prices, per 1M tokens (USD). Output includes thinking tokens.
# Read from the page on 2026-09-26; the page said "Last updated 2026-09-24 UTC".
PRICING = {
    "gemini-3.5-flash": {
        "url": "https://ai.google.dev/gemini-api/docs/pricing",
        "read": "2026-09-27",
        "page_updated": "2026-09-24",
        "input_per_m": 1.50,
        "output_per_m": 9.00,
        "note": "Standard paid tier. Output price includes thinking tokens.",
    },
    "gemini-3.6-flash": {
        "url": "https://ai.google.dev/gemini-api/docs/pricing",
        "read": "2026-09-26",
        "page_updated": "2026-09-24",
        "input_per_m": 0.75,
        "output_per_m": 3.75,
        "note": "Standard paid tier, through 2026-12-31; $1.50 in / $7.50 out from 2027-01-01. Output price includes thinking tokens.",
        "after": {"from": "2027-01-01", "input_per_m": 1.50, "output_per_m": 7.50},
    },
    "gemini-3.8-flash": {
        "url": "https://ai.google.dev/gemini-api/docs/pricing",
        "read": "2026-09-26",
        "page_updated": "2026-09-24",
        "input_per_m": 0.75,
        "output_per_m": 3.75,
        "note": "Standard paid tier, through 2026-12-31; $1.50 in / $7.50 out from 2027-01-01. Output price includes thinking tokens.",
        "after": {"from": "2027-01-01", "input_per_m": 1.50, "output_per_m": 7.50},
    }
}


def _load(p: Path):
    return json.loads(p.read_text(encoding="utf-8"))


def answer_key() -> dict[str, dict]:
    rules = _load(BASE / "rm-m.json") + _load(BASE / "pgh.json")
    return {r["field"]: r for r in rules if r["field"] in KEY_FIELDS}


def _rows(v) -> list[tuple]:
    return sorted((int(r["max_width"]), int(r["interior"]), int(r["streetside"])) for r in v or [])


def _vacant_clause(key: dict[str, dict]) -> str:
    # The answer key's contextual_rear quote is exactly the vacant-neighbor sentence.
    return normalize_ws(key["contextual_rear"]["quote"])


ALL_TYPES = {"detached", "two", "row", "three", "row_end"}


def _types(a: list[str]) -> set[str]:
    return set(ALL_TYPES) if "*" in a else set(a)


def fields_of_calls(district: str, call_ids: list[str]) -> set[str]:
    from .sections import plan, resolve_district

    return {f for c in plan(resolve_district(district)) if c.id in call_ids for f in c.fields}


def compare(extracted: list[dict], key: dict[str, dict], not_run: set[str] = frozenset()) -> list[dict]:
    """One row per answer-key field: expected, extracted, agree, why. `not_run`: fields whose call
    the provider refused (they still count as not agreeing, but the reason says so)."""
    by_field = {r["field"]: r for r in extracted}
    vacant = _vacant_clause(key)
    out = []
    for f in KEY_FIELDS:
        k = key[f]
        x = by_field.get(f)
        row = {
            "field": f,
            "expected": k["value"],
            "expected_section": k["section"],
            "extracted": None if x is None else x["value"],
            "extracted_section": None if x is None else x["section"],
            "agree": False,
            "why": "",
            "expected_applies_to": k["applies_to"],
            "extracted_applies_to": None if x is None else x["applies_to"],
            # secondary (not in the headline score): does it cover the same building types as the key?
            "applies_to_match": None if x is None else _types(x["applies_to"]) == _types(k["applies_to"]),
        }
        row["not_run"] = x is None and f in not_run
        if x is None:
            row["why"] = "not run: the provider refused this call" if f in not_run else "not extracted (missing or rejected)"
        elif f == "narrow_lot_side_table":
            want, got = _rows(k["value"]), _rows(x["value"])
            last_ok = bool(got) and got[0] == want[0]  # smallest width row: 37 ft and below -> 3 / 15
            row["agree"] = want == got
            row["why"] = (
                f"all {len(want)} rows match" if want == got else f"{len(set(want) ^ set(got))} row(s) differ; 37-and-below row {'matches' if last_ok else 'differs'}"
            )
            row["row_37_and_below"] = list(got[0]) if got else None
        elif f in ("contextual_side", "contextual_rear"):
            in_quote = vacant in normalize_ws(x["quote"])
            in_cond = "vacant" in (x.get("condition") or "").lower()
            same_value = x["value"] == k["value"]
            row["vacant_clause_in_quote"] = in_quote
            row["vacant_clause_in_condition"] = in_cond
            row["agree"] = same_value and (in_quote or in_cond)
            row["why"] = (
                ("value matches" if same_value else f"value {x['value']} != {k['value']}")
                + "; vacant-neighbor clause "
                + ("quoted" if in_quote else "not quoted")
                + (" and stated in condition" if in_cond else "")
            )
        else:
            row["agree"] = x["value"] == k["value"]
            row["why"] = "value matches" if row["agree"] else f"value {x['value']} != {k['value']}"
        out.append(row)
    return out


def quote_stats(doc: dict) -> dict:
    """Of everything the model proposed, how many quotes passed the verbatim guard; and do the
    accepted rules' quotes still pass now (re-check with the Python locator)."""
    rules, rejected = doc.get("rules", []), doc.get("rejected", [])
    quote_rejects = [r for r in rejected if str(r.get("reason", "")).startswith("quote guard")]
    proposed = len(rules) + len(rejected)
    recheck_fail = [r["id"] for r in rules if not check_quote(read_code(r["source_file"]), r["section"], r["quote"]).ok]
    return {
        "proposed": proposed,
        "accepted": len(rules),
        "rejected": len(rejected),
        "rejected_quote": len(quote_rejects),
        "rejected_other": len(rejected) - len(quote_rejects),
        "quote_pass_rate": None if proposed == 0 else (proposed - len(quote_rejects)) / proposed,
        "accepted_recheck_failures": recheck_fail,
    }


def _reviews() -> list[dict]:
    p = REPO / "data" / "rules" / "reviews.json"
    if not p.exists():
        return []
    d = _load(p)
    return d.get("entries", []) if isinstance(d, dict) else d


def trust_counts(rules: list[dict], audit: list[dict]) -> dict:
    """Pencil/ink/struck after folding the audit log (same rules as engine/src/rules.ts, reduced):
    unreviewed = pencil; a † rule needs a person (role != "AI agent") to become ink."""
    counts = {"pencil": 0, "ink": 0, "struck": 0}
    for r in rules:
        level = r["verification"]["level"]
        human = level != "unreviewed" and r["verification"].get("role") != "AI agent"
        struck = False
        for e in sorted((e for e in audit if e.get("rule_id") == r["id"]), key=lambda e: e.get("at", "")):
            if not (e.get("reviewer") and e.get("role") and e.get("reason")):
                continue
            a = e.get("action")
            if a in ("source_checked", "city_confirmed"):
                level = "city_confirmed" if a == "city_confirmed" or level == "city_confirmed" else "source_checked"
                struck = False
                human = human or e.get("role") != "AI agent"
            elif a == "struck":
                struck = True
            elif a == "reopened":
                level, struck, human = "unreviewed", False, False
        state = "struck" if struck else ("pencil" if level == "unreviewed" else "ink")
        if state == "ink" and r.get("dagger") and not human:
            state = "pencil"
        counts[state] += 1
    return counts


def cost(meta: dict) -> dict | None:
    p = PRICING.get(meta.get("model", ""))
    if not p:
        return None
    ti, to = meta["tokens_in"], meta["tokens_out"]
    now = ti / 1e6 * p["input_per_m"] + to / 1e6 * p["output_per_m"]
    later = ti / 1e6 * p["after"]["input_per_m"] + to / 1e6 * p["after"]["output_per_m"]
    return {"usd": round(now, 6), "usd_from_2027": round(later, 6), "tokens_in": ti, "tokens_out": to, "tokens_reasoning": meta.get("tokens_reasoning", 0), "pricing": p}


def narrow_flag(doc: dict) -> dict:
    """Did the model itself flag the §925.06.C "single-unit house" ambiguity?"""
    r = next((x for x in doc.get("rules", []) if x["field"] == "narrow_lot_side_table"), None)
    if r is None:
        return {"present": False}
    chk = next((c for c in doc.get("checks", []) if c["id"] == r["id"]), {})
    q = r.get("question_for_city") or ""
    return {
        "present": True,
        "applies_to": r["applies_to"],
        "applies_to_detached_only": r["applies_to"] == ["detached"],
        "ambiguous": chk.get("ambiguous"),
        "question_source": chk.get("question_source"),
        "question_mentions_attached": any(w in q.lower() for w in ("attached", "rowhouse", "row house")),
        "question_for_city": q or None,
        "flagged_by_model": r["applies_to"] == ["detached"] and chk.get("question_source") == "model" and any(w in q.lower() for w in ("attached", "rowhouse", "row house")),
    }


def reviewer_hints(doc: dict, key: dict[str, dict]) -> list[str]:
    """Automatic hints for the person who reviews the rules. Weak signals, shown, never used to
    reject: applies_to narrower/wider than the RM-M key's for the same field; one quote backing
    several fields (the quote may not show which table row it came from); the guard's soft notes."""
    out: list[str] = []
    for r in doc.get("rules", []):
        k = key.get(r["field"])
        if k and _types(r["applies_to"]) != _types(k["applies_to"]):
            out.append(f"{r['field']}: applies_to {r['applies_to']} differs from the RM-M key's {k['applies_to']}; check whether the clause really limits building types.")
    by_q: dict[str, list[str]] = {}
    for r in doc.get("rules", []):
        by_q.setdefault(normalize_ws(r["quote"]), []).append(r["field"])
    for q, fs in by_q.items():
        if len(fs) > 1:
            out.append(f"{', '.join(fs)} share one quote (\"{q[:70]}{'…' if len(q) > 70 else ''}\"); check which row or clause each value came from.")
    for c in doc.get("checks", []):
        for n in c.get("notes", []):
            out.append(f"{c['id']}: {n}.")
    return out


def recheck_all() -> list[str]:
    bad = []
    files = sorted(BASE.glob("*.json")) + sorted(p for p in EXTRACTED.glob("*.json") if p.name != "eval.json")
    for p in files:
        d = _load(p)
        rules = d if isinstance(d, list) else d.get("rules", [])
        for r in rules:
            c = check_quote(read_code(r["source_file"]), r["section"], r["quote"])
            if not c.ok:
                bad.append(f"{p.relative_to(REPO)}: {r['id']}: {c.reason}")
            if r["field"].startswith("use_") and str(r["section"]).startswith("911.02") and r.get("district") not in (None, "*"):
                why = use_mismatch(r["field"], r["district"], r["value"])
                if why:
                    bad.append(f"{p.relative_to(REPO)}: {r['id']}: {why}")
    return bad


def _fmt_val(v, unit: str | None = None) -> str:
    if isinstance(v, list):
        rows = _rows(v)
        return f"table, {len(rows)} rows; {rows[0][0]} ft and below: {rows[0][1]} / {rows[0][2]} ft" if rows else "empty table"
    if v is None:
        return "null"
    if unit == "sf":
        return f"{v:,} sf"
    if unit in ("ft", "stories"):
        return f"{v} {unit}"
    if unit == "spaces_per_unit":
        return f"{v} per unit"
    return str(v)


def _pct(x: float | None) -> str:
    return "n/a" if x is None else f"{100 * x:.1f}%"


def build() -> dict:
    key = answer_key()
    result: dict = {"generated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "target_agreement": TARGET, "districts": {}}
    for p in sorted(EXTRACTED.glob("*.json")):
        if p.name == "eval.json":
            continue
        doc = _load(p)
        m = doc["meta"]
        entry = {
            "file": str(p.relative_to(REPO)),
            "provider": m["provider"],
            "model": m["model"],
            "run_at": m["run_at"],
            "prompt_sha": m["prompt_sha"],
            "calls": len(m["calls"]),
            "tokens_in": m["tokens_in"],
            "tokens_out": m["tokens_out"],
            "tokens_reasoning": m.get("tokens_reasoning", 0),
            "latency_ms": m["latency_ms"],
            "wall_ms": m.get("wall_ms"),
            "attempts": sum(c.get("attempts", 1) for c in m["calls"]),
            "run_note": m.get("run_note"),
            "incomplete": m.get("incomplete", False),
            "failed_calls": m.get("failed_calls", []),
            "cached_calls": [c["section"] for c in m["calls"] if c.get("cached_from")],
            "quotes": quote_stats(doc),
            "trust": trust_counts(doc["rules"], _reviews()),
            "cost": cost(m),
            "narrow_lot_flag": narrow_flag(doc),
            "hints": reviewer_hints(doc, key),
            "rules": [
                {"id": r["id"], "field": r["field"], "value": r["value"], "unit": r["unit"], "section": r["section"], "applies_to": r["applies_to"], "dagger": r["dagger"], "question_for_city": r["question_for_city"]}
                for r in doc["rules"]
            ],
            "rejected": [{"field": x["rule"].get("field"), "reason": x["reason"]} for x in doc.get("rejected", [])],
        }
        if m["district"] == "RM-M":
            rows = compare(doc["rules"], key, fields_of_calls("RM-M", m.get("failed_calls", [])))
            agree = sum(r["agree"] for r in rows)
            entry["agreement"] = {"fields": len(rows), "agree": agree, "rate": agree / len(rows), "rows": rows}
        result["districts"][m["district"]] = entry
        # proposal list is under a different key so the app's loader never mistakes eval.json for rules
        entry["proposed_rules"] = entry.pop("rules")

    # Side-by-side: other providers' / models' runs live in extracted/compare/ (not loaded by the app).
    result["compare"] = []
    for p in sorted(COMPARE.glob("rm-m.*.json")) if COMPARE.exists() else []:
        doc = _load(p)
        rows = compare(doc["rules"], key, fields_of_calls("RM-M", doc["meta"].get("failed_calls", [])))
        result["compare"].append(
            {
                "file": str(p.relative_to(REPO)),
                "provider": doc["meta"]["provider"],
                "model": doc["meta"]["model"],
                "run_at": doc["meta"]["run_at"],
                "agree": sum(r["agree"] for r in rows),
                "fields": len(rows),
                "agreement": sum(r["agree"] for r in rows) / len(rows),
                "rows": rows,
                "quotes": quote_stats(doc),
                "narrow_lot_flag": narrow_flag(doc),
                "tokens_in": doc["meta"]["tokens_in"],
                "tokens_out": doc["meta"]["tokens_out"],
                "tokens_reasoning": doc["meta"].get("tokens_reasoning", 0),
                "cost": cost(doc["meta"]),
                "incomplete": doc["meta"].get("incomplete", False),
                "failed_calls": doc["meta"].get("failed_calls", []),
            }
        )
    from .llm import load_env

    load_env()
    result["anthropic_key_present"] = bool(os.environ.get("ANTHROPIC_API_KEY"))
    rm = result["districts"].get("RM-M")
    if rm:
        flag = rm["narrow_lot_flag"]
        result["gate_g2"] = {
            "key_present": True,
            "agreement_ok": rm["agreement"]["rate"] >= TARGET,
            "quotes_verbatim": not rm["quotes"]["accepted_recheck_failures"],
            "ambiguous_clause_in_pencil": flag.get("present", False) and flag.get("applies_to_detached_only", False),
        }
        result["gate_g2"]["pass"] = all(result["gate_g2"].values())
    return result


def render(res: dict) -> str:
    L: list[str] = []
    today = res["generated_at"][:10]
    L.append("# Extraction evaluation")
    L.append("")
    L.append(f"Generated {res['generated_at']} by `uv run python -m extract eval` from the files in `data/rules/extracted/`. Every number below is computed from those files; none is typed by hand. The run itself is `uv run python -m extract run --district <D>`.")
    L.append("")
    L.append("The City of Pittsburgh interprets its zoning code. This is decision support, not legal, financial or zoning advice. Every extracted rule is **pencil** (unreviewed) until a named person source-checks it in the app.")
    L.append("")
    rm = res["districts"].get("RM-M")
    if not rm:
        L.append("**No RM-M extraction found.** Run `uv run python -m extract run --district RM-M` first.")
        return "\n".join(L) + "\n"

    g = res["gate_g2"]
    ag = rm["agreement"]
    L.append("## Gate G2")
    L.append("")
    L.append(f"**{'PASS' if g['pass'] else 'FAIL'}.**")
    L.append("")
    L.append(f"- Key present: yes (`GOOGLE_API_KEY`); provider `{rm['provider']}`, model `{rm['model']}`.")
    L.append(f"- RM-M field agreement: **{ag['agree']} / {ag['fields']} = {_pct(ag['rate'])}** (target ≥ {_pct(res['target_agreement'])}): {'met' if g['agreement_ok'] else 'NOT met'}.")
    q = rm["quotes"]
    L.append(f"- Verbatim quotes: {q['proposed'] - q['rejected_quote']} of {q['proposed']} proposed quotes passed the guard ({_pct(q['quote_pass_rate'])}); every accepted quote re-checks now: {'yes' if g['quotes_verbatim'] else 'NO: ' + ', '.join(q['accepted_recheck_failures'])}.")
    others = {n: d["model"] for n, d in res["districts"].items() if n != "RM-M"}
    for n, mdl in others.items():
        L.append(f"- Held-out {n} was extracted with `{mdl}`" + (" (the same model)." if mdl == rm["model"] else f", not `{rm['model']}`: see its section below."))
    nf = rm["narrow_lot_flag"]
    L.append(f"- Ambiguous clause in pencil: narrow-lot table `applies_to` = `{nf.get('applies_to')}`; {'the model itself flagged it' if nf.get('flagged_by_model') else 'the model did NOT flag it itself'} (see below).")
    if not g["pass"]:
        L.append("")
        L.append("Fallback (spec §13): keep the answer-key rules; show extraction on R1D-H as proposals only.")
    L.append("")

    L.append("## RM-M against the answer key")
    L.append("")
    L.append("Answer key: `data/rules/base/rm-m.json` and `pgh.json`: the values in the team's research notes (`zoning-rules-rm.md`, marked \"checked by a person against the code text\"; the person isn't named there), matched to the saved ecode360 text by an AI research pass on 26 Sep 2026 and recorded in this app as source-checked by \"Claude (research pass), AI agent\". No one has signed them in this app yet, so this compares the model with a person-checked key that an AI transcribed. Agreement is on the value; for the contextual setbacks it also requires the vacant-neighbor clause (quoted, or stated in the condition); for the narrow-lot table every row must match.")
    L.append("")
    L.append("| Field | Answer key | Extracted | § key → § extracted | Agree | Note | Applies to (key → extracted) |")
    L.append("|---|---|---|---|---|---|---|")
    for r in ag["rows"]:
        unit = {"min_lot_area": "sf", "max_stories": "stories"}.get(r["field"], "ft")
        at = "—" if r["extracted_applies_to"] is None else f"{', '.join(r['expected_applies_to'])} → {', '.join(r['extracted_applies_to'])}" + ("" if r["applies_to_match"] else " (**differs**)")
        L.append(
            f"| {r['field']} | {_fmt_val(r['expected'], unit)} | {_fmt_val(r['extracted'], unit) if r['extracted_section'] else '—'} | {r['expected_section']} → {r['extracted_section'] or '—'} | {'yes' if r['agree'] else '**no**'} | {r['why']} | {at} |"
        )
    L.append("")
    L.append("Agreement is counted on values. `applies_to` (which building types a rule covers) is shown for information; `*` counts as all five types.")
    L.append("")
    diff_path = [r for r in ag["rows"] if r["extracted_section"] and r["extracted_section"] != r["expected_section"]]
    if diff_path:
        L.append(
            f"Section paths: {len(diff_path)} of {ag['fields']} extracted rules cite a different path than the key ("
            + ", ".join(sorted({f"{r['expected_section']} → {r['extracted_section']}" for r in diff_path}))
            + "). The guard found each quote inside the path the model cited; agreement is not scored on the path."
        )
    L.append("")
    dag = [r for r in rm["proposed_rules"] if r["dagger"]]
    L.append(f"The RM-M run also proposed {len(dag)} † rules (use table, parking, grading, lot of record) that have no answer key yet. They are not scored; they stay pencil until a person signs them.")
    L.append("")

    L.append("## The ambiguity: \"single-unit house\" in §925.06.C")
    L.append("")
    for name, d in res["districts"].items():
        f = d["narrow_lot_flag"]
        if not f.get("present"):
            L.append(f"- {name}: no narrow-lot table rule accepted.")
            continue
        verdict = (
            "flagged as intended (detached only, question asked)"
            if f["flagged_by_model"]
            else ("asked the City, but still listed " + ", ".join(t for t in f["applies_to"] if t != "detached") + " in applies_to" if f["question_mentions_attached"] else "NOT flagged")
        )
        L.append(
            f"- {name} (`{d['model']}`): **{verdict}.** applies_to `{f['applies_to']}`, ambiguous = {f['ambiguous']}, question written by the {f['question_source']}"
            + (f": \"{f['question_for_city']}\"" if f["question_for_city"] else "")
        )
    L.append("")
    L.append("A pencil proposal cannot widen the table's reach in the app: the engine picks an ink rule over a pencil one for the same field (`pick()` in engine/src/rules.ts), and the answer-key `pgh.narrow_lot_side` rule (detached only) is ink. The open question stays in `data/rules/questions.json`.")
    L.append("")
    L.append("The system prompt has one general rule about building types (\"when the wording leaves doubt about whether a building type is covered, list only the types it clearly covers, set ambiguous = true and ask the City\"). It does not name this clause or the answer.")
    L.append("")

    L.append("## Providers and models side by side (RM-M)")
    L.append("")
    cols = [{"label": f"{rm['provider']} `{rm['model']}` (app file)", "agree": ag["agree"], "fields": ag["fields"], "rate": ag["rate"], "quotes": q, "tokens_in": rm["tokens_in"], "tokens_out": rm["tokens_out"], "flag": rm["narrow_lot_flag"], "rows": ag["rows"], "incomplete": rm["incomplete"]}]
    for c in res["compare"]:
        cols.append({"label": f"{c['provider']} `{c['model']}`" + (" (incomplete run)" if c.get("incomplete") else ""), "agree": c["agree"], "fields": c["fields"], "rate": c["agreement"], "quotes": c["quotes"], "tokens_in": c["tokens_in"], "tokens_out": c["tokens_out"], "flag": c["narrow_lot_flag"], "rows": c["rows"], "incomplete": c.get("incomplete")})
    claude_run = any(c["provider"] == "anthropic" for c in res["compare"])
    claude_note = "not run (no key)" if not res["anthropic_key_present"] else "key present, not run"
    head = [c["label"] for c in cols] + ([] if claude_run else ["anthropic (Claude)"])
    L.append("| | " + " | ".join(head) + " |")
    L.append("|---|" + "---|" * len(head))
    extra = [] if claude_run else [claude_note]
    def _agree_cell(c):
        nr = sum(1 for r in c["rows"] if r.get("not_run"))
        return f"{_pct(c['rate'])} ({c['agree']}/{c['fields']}" + (f"; {nr} not run, {c['agree']}/{c['fields'] - nr} of those run)" if nr else ")")

    L.append("| Field agreement | " + " | ".join(_agree_cell(c) for c in cols) + "".join(f" | {e}" for e in extra) + " |")
    L.append("| Verbatim-quote pass rate | " + " | ".join(_pct(c["quotes"]["quote_pass_rate"]) for c in cols) + "".join(f" | {e}" for e in extra) + " |")
    L.append("| Rejected by guards | " + " | ".join(str(c["quotes"]["rejected"]) for c in cols) + "".join(f" | {e}" for e in extra) + " |")
    L.append("| applies_to same as key (info) | " + " | ".join(f"{sum(1 for r in c['rows'] if r['applies_to_match'])}/{sum(1 for r in c['rows'] if r['applies_to_match'] is not None)} extracted" for c in cols) + "".join(f" | {e}" for e in extra) + " |")
    def _flag_cell(c):
        if not c["flag"].get("present"):
            nr = any(r.get("not_run") and r["field"] == "narrow_lot_side_table" for r in c["rows"])
            return "not run" if nr else "no rule"
        return "yes" if c["flag"].get("flagged_by_model") else "no"

    L.append("| Flagged \"single-unit house\" itself | " + " | ".join(_flag_cell(c) for c in cols) + "".join(f" | {e}" for e in extra) + " |")
    L.append("| Tokens in / out | " + " | ".join(f"{c['tokens_in']:,} / {c['tokens_out']:,}" for c in cols) + "".join(f" | {e}" for e in extra) + " |")
    L.append("")
    for c in res["compare"]:
        misses = [r for r in c["rows"] if not r["agree"] and not r.get("not_run")]
        if misses:
            L.append(f"`{c['model']}` disagreements: " + "; ".join(f"{r['field']} ({r['why']})" for r in misses) + ".")
            L.append("")
        amiss = [r for r in c["rows"] if r["applies_to_match"] is False]
        if amiss:
            L.append(f"`{c['model']}` applies_to differs from the key on: " + "; ".join(f"{r['field']} ({', '.join(r['expected_applies_to'])} → {', '.join(r['extracted_applies_to'])})" for r in amiss) + ".")
            L.append("")
        if c.get("incomplete"):
            L.append(f"`{c['model']}` run was incomplete (calls refused: {', '.join(c['failed_calls'])}); its missing fields count as disagreements.")
            L.append("")
    if not claude_run:
        L.append("Claude comparison not run: no key. The Claude path (`EXTRACT_PROVIDER=anthropic`, `langchain-anthropic` `ChatAnthropic`, same structured output and the same guards) is built and unit-tested without network; with a key, `uv run python -m extract run --district RM-M --provider anthropic --compare` writes `data/rules/extracted/compare/rm-m.anthropic.<model>.json` and this table gains its column.")
        L.append("")

    L.append("## Held-out districts (nobody typed these)")
    L.append("")
    for name, d in res["districts"].items():
        if name == "RM-M":
            continue
        t = d["trust"]
        L.append(f"### {name}")
        L.append("")
        L.append(f"Model `{d['model']}` ({d['provider']}), run {d['run_at']}.")
        if d.get("run_note"):
            L.append(f"Run note: {d['run_note']}")
        if d["model"] != rm["model"]:
            measured = [c for c in res["compare"] if c["model"] == d["model"]]
            L.append(
                f"This is not the model scored on RM-M above (`{rm['model']}`). "
                + (
                    f"On RM-M the same model agreed on {measured[0]['agree']} of the {sum(1 for r in measured[0]['rows'] if not r.get('not_run'))} answer-key fields it was able to run"
                    + (f" ({sum(1 for r in measured[0]['rows'] if r.get('not_run'))} not run: provider refused)" if any(r.get("not_run") for r in measured[0]["rows"]) else "")
                    + " (side-by-side table)."
                    if measured
                    else "Its RM-M agreement has not been measured."
                )
            )
        if d["incomplete"]:
            L.append(f"**Incomplete:** the provider refused these calls, so their fields are missing (not filled in): {', '.join(d['failed_calls'])}.")
        if d["cached_calls"]:
            L.append(f"Re-used saved responses (identical prompts, `--resume`) for: {'; '.join(d['cached_calls'])}.")
        L.append("")
        L.append(f"{len(d['proposed_rules'])} rules proposed and accepted by the guards; {d['quotes']['rejected']} rejected. After people's reviews (`data/rules/reviews.json`, if any): **{t['pencil']} pencil, {t['ink']} ink, {t['struck']} struck.** All are pencil until a named person signs them in the app.")
        L.append("")
        L.append("| Field | Value | § | Applies to | † | Question for the City |")
        L.append("|---|---|---|---|---|---|")
        for r in d["proposed_rules"]:
            L.append(f"| {r['field']} | {_fmt_val(r['value'], r['unit'])} | {r['section']} | {', '.join(r['applies_to'])} | {'†' if r['dagger'] else ''} | {(r['question_for_city'] or '').replace('|', '/')} |")
        L.append("")
        if d["hints"]:
            L.append("Reviewer hints (automatic; weak signals for the person checking, not verdicts):")
            L.append("")
            for h in d["hints"]:
                L.append(f"- {h}")
            L.append("")
        if d["rejected"]:
            L.append("Rejected by the guards:")
            L.append("")
            for x in d["rejected"]:
                L.append(f"- {x['field']}: {x['reason']}")
            L.append("")

    L.append("## Tokens, latency, rejections")
    L.append("")
    L.append("Token counts are the provider's own (`usage_metadata` on each response). Output tokens include the model's thinking tokens, which Google bills as output. Latency is wall-clock time inside the API calls (including any attempts that were rate-limited and retried; the backoff waits are not counted).")
    L.append("")
    L.append("| District | Model | Calls (attempts) | Tokens in | Tokens out (of which thinking) | Latency in API | Wall time incl. backoff | Proposed | Rejected |")
    L.append("|---|---|---|---|---|---|---|---|---|")
    for name, d in res["districts"].items():
        wall = f"{d['wall_ms'] / 1000:.0f} s" if d.get("wall_ms") else ("n/a (re-used responses)" if d.get("cached_calls") else "not recorded")
        L.append(f"| {name} | `{d['model']}` | {d['calls']} ({d['attempts']}) | {d['tokens_in']:,} | {d['tokens_out']:,} ({d['tokens_reasoning']:,}) | {d['latency_ms'] / 1000:.0f} s | {wall} | {d['quotes']['proposed']} | {d['quotes']['rejected']} |")
    L.append("")
    L.append("Attempts above the call count were refused by the free tier (HTTP 429 rate limit or 503 \"high demand\") and retried with backoff; each retry is logged in the file's `meta.calls[].retries`.")
    L.append("")

    L.append("## Cost per district")
    L.append("")
    L.append("On the free tier the cost is **$0**. Google's pricing page says free-tier prompts and responses are \"used to improve our products\"; we only ever send public zoning-code text (no parcel records, nothing personal).")
    L.append("")
    priced = {d["model"]: d["cost"]["pricing"] for d in res["districts"].values() if d["cost"]}
    if priced:
        L.append("Google's published paid-tier (Standard) prices, per 1M tokens:")
        L.append("")
        for model, p in sorted(priced.items()):
            L.append(f"- `{model}`: ${p['input_per_m']:.2f} input, ${p['output_per_m']:.2f} output including thinking tokens, through 2026-12-31; ${p['after']['input_per_m']:.2f} / ${p['after']['output_per_m']:.2f} from {p['after']['from']}. Source: {p['url']} (page updated {p['page_updated']}, read {p['read']}).")
        L.append("")
        L.append("| District | Model | Tokens in | Tokens out | Cost now | Cost from 2027-01-01 |")
        L.append("|---|---|---|---|---|---|")
        for name, d in res["districts"].items():
            c = d["cost"]
            if c:
                L.append(f"| {name} | `{d['model']}` | {c['tokens_in']:,} | {c['tokens_out']:,} | ${c['usd']:.4f} | ${c['usd_from_2027']:.4f} |")
            else:
                L.append(f"| {name} | `{d['model']}` | {d['tokens_in']:,} | {d['tokens_out']:,} | no price recorded | |")
        L.append("")
        usd = [d["cost"]["usd"] for d in res["districts"].values() if d["cost"]]
        L.append(
            f"So one district cost between ${min(usd):.2f} and ${max(usd):.2f} in these runs at today's paid prices. Most of the output is thinking tokens, which vary by model and by run. "
            "Only successful responses carry token counts; refused attempts returned none. Treat each figure as one measured run, not a constant."
        )
    else:
        L.append("No published price is recorded for these models in `extract/eval.py`; cost not computed.")
    L.append("")

    L.append("## What this does not show")
    L.append("")
    L.append("- One run per district at the provider's default temperature (1.0 for Gemini 3, as its docs advise). A re-run can differ; the guards, not the model, decide what is kept.")
    L.append("- The † fields (use table, parking, grading, lots of record) have no answer key; nobody has scored them.")
    L.append("- The guard checks that each quote is verbatim and inside the cited section and that each value is in range; it cannot tell whether the model read the right table row. A person does that in the app.")
    for n, d in res["districts"].items():
        if n != "RM-M" and d["model"] != rm["model"]:
            L.append(f"- {n} was extracted with `{d['model']}`, not the model scored above; its proposals carry that model's name. Re-run with `uv run python -m extract run --district {n}` when the default model's free-tier quota allows, then `uv run python -m extract eval`.")
    L.append(f"- Report date: {today}.")
    L.append("")
    L.append("## Commands")
    L.append("")
    L.append("```")
    L.append("uv run python -m extract run --district RM-M      # live extraction (EXTRACT_PROVIDER / EXTRACT_MODEL override)")
    L.append("uv run python -m extract run --district R1D-H")
    L.append("uv run python -m extract run --district R1D-H --resume   # re-use saved responses to identical prompts")
    L.append("uv run python -m extract eval                     # this report + data/rules/extracted/eval.json")
    L.append("uv run python -m extract check                    # re-verify every quote in data/rules")
    L.append("uv run pytest -q extract/tests                    # no network")
    L.append("```")
    L.append("")
    return "\n".join(L) + "\n"


def main() -> int:
    res = build()
    (EXTRACTED / "eval.json").write_text(json.dumps(res, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    DOC.parent.mkdir(parents=True, exist_ok=True)
    DOC.write_text(render(res), encoding="utf-8")
    rm = res["districts"].get("RM-M")
    if rm:
        a = rm["agreement"]
        print(f"RM-M agreement {a['agree']}/{a['fields']} = {100 * a['rate']:.1f}%; quote pass {_pct(rm['quotes']['quote_pass_rate'])}; G2 {'PASS' if res['gate_g2']['pass'] else 'FAIL'}")
    for name, d in res["districts"].items():
        print(f"{name}: {len(d['proposed_rules'])} rules, {d['quotes']['rejected']} rejected, trust {d['trust']}, cost ${d['cost']['usd'] if d['cost'] else 'n/a'}")
    print(f"wrote {DOC.relative_to(REPO)} and data/rules/extracted/eval.json")
    return 0
