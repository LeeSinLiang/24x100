"""The policy agent: a planner's plain-language question → the controlling sentence → a redline → an engine
override → the citywide count → a memo, with a verify step at the end. The model plans and drafts words; it never
counts and never supplies a number the memo prints: counts come from the scenario builder, values from the code.

    plan    model: which stored rule the question is about and the new value, or a refusal with the reason
    tool    find: the section's saved text (and its file's sha256)
    draft   model: the verbatim sentence or table cell, what to strike and what to insert, caveats
    verify  guard: the quote word for word in the section (extract/source.check_quote), strike inside the quote,
            the redline's numbers agree with the override → compile {district, field, to}, or refuse
    tool    count: scripts/policy-count.ts (build-scenarios.ts countScenario, the same code as S1–S3)
    draft   the memo, from a template: only verified numbers
    verify  re-read every quote from its file (same sha256), re-run the count, every number in the memo traced
"""
from __future__ import annotations

import datetime as dt
import json
import re
import time
from typing import Any, Callable, Literal

from pydantic import BaseModel, Field

from extract.guards import RANGES, number_in_text
from extract.source import check_quote, normalize_ws

from . import tools as T

LABELS = ("what-if, not the law", "drafted by an AI agent; check before sending")
HAND = "planned by hand, no model"


class Plan(BaseModel):
    decision: Literal["change", "refuse"] = Field(description="'change' if the question is one stored rule's value changed; else 'refuse'")
    reason: str = Field(description="Why this rule answers the question, or why the question can't be expressed as a change to one stored rule")
    district: str | None = Field(None, description="The district of the rule to change, exactly as in the catalogue")
    field: str | None = Field(None, description="The field of the rule to change, exactly as in the catalogue")
    new_value: float | None = Field(None, description="The new value, in the rule's unit")
    name: str | None = Field(None, description="A short title, e.g. 'R2-L rear setback 30 → 20 ft'")


class Redline(BaseModel):
    quote: str = Field(description="The controlling sentence or table cells, copied word for word from the section text")
    strike: str = Field(description="The exact words of the quote that change (a substring of the quote)")
    insert: str = Field(description="What replaces them")
    change: str = Field(description="The change in one plain sentence")
    caveats: list[str] = Field(default_factory=list, description="What the count can't tell a planner, one sentence each, no numbers")


PLAN_SYS = """You are the policy agent of 24×100, a tool for Pittsburgh's City-owned vacant lots. A City planner asks a
what-if question about the zoning code. You may only answer it as ONE stored rule's value changed: pick the rule from
the catalogue (district and field exactly as written there) and the new value in its unit. If the question needs
anything else (a rule the catalogue doesn't have, a new rule, a use permission, several rules at once, a condition,
or wording that isn't a number), decide 'refuse' and say why in one or two sentences. Never invent a rule."""

DRAFT_SYS = """Write the redline for a zoning what-if. Copy the controlling sentence or table cells WORD FOR WORD from the
section text (keep the ' | ' cell separators; do not fix spelling, do not paraphrase). 'strike' is the exact part of
that quote that changes and must include the current value; 'insert' is its replacement with the new value, in the
same style (e.g. '30 ft.' → '20 ft.'). Caveats: what the count can't tell the Planning Commission, without numbers."""


def now() -> str:
    return dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")


class Log:
    def __init__(self, clock: Callable[[], str] = now):
        self.steps: list[dict] = []
        self.clock = clock

    def add(self, action: str, summary: str, *, tool: str | None = None, input: Any = None, sources: list[dict] | None = None, ok: bool = True, **extra) -> dict:
        s = {"agent": "policy", "n": len(self.steps) + 1, "action": action, **({"tool": tool} if tool else {}), "input": input, "summary": summary,
             "sources": sources or [], "ok": ok, "t": self.clock(), **extra}
        self.steps.append(s)
        return s


def slug(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:60]


def fmt(v: float) -> str:
    return f"{v:,.0f}" if float(v).is_integer() else f"{v:,g}"


def numbers(s: str) -> set[str]:
    return {n.replace(",", "") for n in re.findall(r"\d[\d,]*(?:\.\d+)?", s)}


def run(question: str, building: str, *, model: Callable[[type[BaseModel], list[tuple[str, str]]], tuple[BaseModel | None, dict]] | None,
        hand: dict | None = None, qid: str = "Q1", count: Callable[[dict], dict] = T.count, clock: Callable[[], str] = now,
        model_info: dict | None = None) -> dict:
    """One question, end to end. `model(schema, messages) → (parsed, usage)`; with `hand` ({plan, redline}) no model runs."""
    if building not in T.TYPES:
        raise ValueError(f"building must be one of {T.TYPES}")
    log = Log(clock)
    usage = {"tokens_in": 0, "tokens_out": 0, "calls": 0}
    base = {"id": qid, "question": question, "building": building, "asked_at": clock(), "labels": list(LABELS),
            "model": {**(model_info or {}), "planned_by": "hand" if hand else "model", **({"note": HAND} if hand else {})}}

    def ask(schema, messages, what):
        if hand is not None:
            return schema(**hand[what])
        parsed, u = model(schema, messages)
        usage["tokens_in"] += u.get("tokens_in", 0); usage["tokens_out"] += u.get("tokens_out", 0); usage["calls"] += 1
        return parsed

    def refuse(reason: str) -> dict:
        log.add("verify", f"Refused: {reason}", ok=False)
        return {**base, "status": "refused", "reason": reason, "name": base.get("name") or question[:80], "steps": log.steps, "usage": usage}

    # ── plan ──
    districts = count({})["districts"]
    cat = T.catalogue(districts)
    log.add("tool", f"Read the stored rules of the {len(districts)} districts a person has signed: {len(cat)} numeric rules a what-if can change.",
            tool="catalogue", input={"districts": districts}, sources=[{"file": f, "sha256": T.sha256(f)} for f in T.rule_files()])
    plan = ask(Plan, [("system", PLAN_SYS), ("human", f"Question: {question}\nBuilding type: {building}-unit house\n\nCatalogue:\n" + "\n".join(e.line() for e in cat))], "plan")
    if plan is None:
        return refuse("the model gave no usable plan")
    base["name"] = plan.name or question[:80]
    log.add("plan", plan.reason if plan.decision == "refuse" else f"Change {plan.district} {plan.field} to {fmt(plan.new_value or 0)}: {plan.reason}",
            input={"question": question, "building": building}, ok=plan.decision == "change", decision=plan.decision)
    if plan.decision == "refuse":
        return refuse(plan.reason)
    entry = next((e for e in cat if e.district == plan.district and e.field == plan.field), None)
    if entry is None:
        return refuse(f"there is no stored, signed rule '{plan.field}' for {plan.district}; the change can't be compiled into an override, so it isn't counted")
    if plan.new_value is None:
        return refuse("no new value was given")
    lo, hi = RANGES[entry.field]
    if not lo <= plan.new_value <= hi:
        return refuse(f"{fmt(plan.new_value)} {entry.unit} is outside the plausible range for {entry.field} ({lo:g}–{hi:g})")
    if plan.new_value == entry.value:
        return refuse(f"{entry.district} {entry.field} is already {fmt(entry.value)} {entry.unit}")

    # ── find ──
    sec = T.section(entry.section)
    src = [{"file": sec["file"], "sha256": sec["sha256"]}]
    log.add("tool", f"Found §{entry.section} in {sec['file']} ({len(sec['text']):,} characters), where the stored rule's quote sits.",
            tool="find", input={"section": entry.section, "rule_ids": entry.rule_ids}, sources=src)

    # ── draft the redline, then the guard (one retry with the guard's reason) ──
    msg = [("system", DRAFT_SYS), ("human", f"Question: {question}\nRule: {entry.line()}\nNew value: {fmt(plan.new_value)} {entry.unit}\n\nSection §{entry.section} text:\n{sec['text']}")]
    red, why = None, None
    for attempt in (1, 2):
        red = ask(Redline, msg if why is None else msg + [("human", f"Rejected: {why}. Copy the quote word for word from the section text.")], "redline")
        if red is None:
            why = "the model gave no redline"; continue
        log.add("draft", f"Redline: strike “{red.strike}”, insert “{red.insert}”.", input={"attempt": attempt}, sources=src)
        qc = check_quote(sec["full"], entry.section, red.quote)
        why = qc.reason or (None if normalize_ws(red.strike) in normalize_ws(red.quote) else "the struck words are not in the quote")
        if why is None and not number_in_text(int(entry.value) if entry.value.is_integer() else entry.value, red.strike):
            why = f"the struck words don't carry today's value ({fmt(entry.value)} {entry.unit})"
        if why is None and not number_in_text(int(plan.new_value) if float(plan.new_value).is_integer() else plan.new_value, red.insert):
            why = f"the inserted words don't carry the new value ({fmt(plan.new_value)} {entry.unit}), so the redline and the override would disagree"
        log.add("verify", "Quote word for word in the section; strike inside it; the redline and the override agree." if why is None else f"Guard rejected the redline: {why}.",
                tool="quote_guard", input={"section": entry.section, "quote": red.quote}, sources=src, ok=why is None)
        if why is None or hand is not None:
            break
    if why is not None:
        return refuse(f"the redline failed the verbatim guard ({why})")

    to = int(plan.new_value) if float(plan.new_value).is_integer() else plan.new_value
    override = {"district": entry.district, "field": entry.field, "to": to}
    dup = next((s for s in T.existing_scenarios() if s.get("override") == override), None)
    if dup:
        return refuse(f"this is already rule what-if {dup['id']} ({dup['name']})")

    # ── count ──
    res = count({"value": override})
    if not res["matched_rules"]:
        return refuse(f"the override {override} touches no stored rule")
    count_src = [{"file": f, "sha256": T.sha256(f)} for f in ("scripts/build-scenarios.ts", "data/city/lots.json", *sorted(set(entry.files)))]
    bt = res["by_type"]
    log.add("tool", "; ".join(f"{t}-unit: {bt[t]['opens']} City-owned lots open ({bt[t]['for_sale']} for sale, {bt[t]['pencil']} pencil)" for t in T.TYPES),
            tool="count", input={"value": override}, sources=count_src)

    # ── what else the same text sets ──
    nq = lambda q: normalize_ws(q).strip(' |')
    shared = [e for e in cat if e is not entry and e.field == entry.field and e.section == entry.section and e.value == entry.value
              and (nq(e.quote) in nq(entry.quote) or nq(entry.quote) in nq(e.quote))]            # the same table cell, read for another district
    notes = []
    for e in shared:
        u = T.uses(e.district)
        off = [t for t in T.TYPES if u.get(t) == "N"]
        notes.append(f"The same cell also sets {e.district}, " + ("where two- and three-unit houses aren't permitted, so it adds none to these counts." if len(off) == len(T.TYPES)
                     else "which this count leaves as today (one district per override)."))

    out = {**base, "status": "counted", "section": entry.section, "quote": red.quote, "rule": entry.rule_ids[0], "source_file": sec["file"],
           "change": red.change, "strike": red.strike, "insert": red.insert, "override": override, "by_type": bt, "districts": res["districts"],
           "was": {"value": entry.value, "unit": entry.unit}, "caveats": [*notes, *red.caveats]}
    memo = write_memo(out)
    log.add("draft", f"Memo to the Planning Commission, {len(memo.split())} words.", sources=src + count_src[:1])
    out["memo_md"] = memo
    out["steps"] = log.steps
    out["usage"] = usage
    verify(out, count, log)
    return out


def write_memo(o: dict) -> str:
    b = o["by_type"]
    def line(t):
        x = b[t]
        if not x["opens"]:
            return f"- **{t}-unit house:** no City-owned vacant lot changes."
        dist = ", ".join(f"{d} {n}" for d, n in x["by_district"]); hood = ", ".join(f"{h} {n}" for h, n in x["by_hood"])
        return (f"- **{t}-unit house:** {x['opens']} City-owned vacant lots that don't fit the dimensional rules today would ({x['for_sale']} listed for sale; "
                f"{x['pencil']} still pencil). By district: {dist}. Most in: {hood}.")
    L = [f"# Draft for the Planning Commission: {o['name']}", "",
         f"> **{LABELS[0][0].upper() + LABELS[0][1:]}.** **{LABELS[1][0].upper() + LABELS[1][1:]}.**", "",
         f"**Question.** {o['question']}", "",
         f"**The text that controls it.** §{o['section']} ({o['source_file']}, the saved Pittsburgh Code):", "", f"> {o['quote']}", "",
         f"**Redline.** Strike ~~{o['strike']}~~, insert **{o['insert']}** · {o['change']}", "",
         f"**Count.** The app's citywide classifier (scripts/build-scenarios.ts, the code behind the rule what-ifs), with only this change, over the districts whose rules a person has signed ({', '.join(o['districts'])}):",
         line("two"), line("three"), "",
         "**Caveats.**",
         "- A what-if, not the law: changing the code takes City Council. The count is City-owned vacant lots only, dimensional rules only, sale status aside.",
         *[f"- {c}" for c in o["caveats"]], "",
         f"_{'Planned by hand, no model' if o['model'].get('planned_by') == 'hand' else 'Planned and drafted by ' + o['model'].get('name', 'a model')} · 24×100 policy agent · {o['id']}. Check every quote against the code before sending._", ""]
    return "\n".join(L)


def verify(o: dict, count: Callable[[dict], dict], log: Log) -> None:
    checks = []
    sec = T.section(o["section"])
    st = next(s for s in o["steps"] if s.get("tool") == "find")
    checks.append(("code file unchanged since the find step", sec["sha256"] == st["sources"][0]["sha256"]))
    checks.append(("quote word for word in §" + o["section"], check_quote(sec["full"], o["section"], o["quote"]).ok))
    again = count({"value": o["override"]})["by_type"]
    checks.append(("count re-run gives the same numbers", again == o["by_type"]))
    memo = o["memo_md"]
    checks.append(("memo carries both labels", all(l.lower() in memo.lower() for l in LABELS)))
    allowed = set()
    for s in (o["quote"], o["strike"], o["insert"], o["section"], o["source_file"], o["question"], o["name"], json.dumps(o["by_type"]), " ".join(o["districts"]), o["id"],
              str(o["model"].get("name", "")), fmt(o["was"]["value"]), str(o["override"]["to"]), "24×100"):   # the product's name, in the footer
        allowed |= numbers(s)
    loose = sorted(n for n in numbers(memo) if n not in allowed)
    checks.append(("every number in the memo traces to the code, the question or the count" + (f" (untraced: {', '.join(loose)})" if loose else ""), not loose))
    ok = all(c for _, c in checks)
    log.add("verify", ("All checks pass: " if ok else "Failed: ") + "; ".join(n for n, c in checks if c == ok or not ok and not c), tool="recheck",
            sources=[{"file": sec["file"], "sha256": sec["sha256"]}], ok=ok, checks=[{"check": n, "ok": c} for n, c in checks])
    o["verified"] = ok
