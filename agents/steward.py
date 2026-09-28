"""The steward: one goal in ("a two-unit house on this lot"), a team of agents works the lot, a person holds the gates.

A LangGraph graph: read the engine → plan → due diligence → policy (only when a rule is the first blocker) → drafts →
verify → gates. The steward never computes a number: the engine's reading (scripts/case-engine.ts) supplies them all,
and the verifier checks every number, quote and source the agents wrote before the case file is published.
"""
from __future__ import annotations

import hashlib
import json
import re
import subprocess
import sys
from typing import Any, TypedDict

from langgraph.graph import END, StateGraph
from .model import why as _why
from pydantic import BaseModel, Field

from pipeline.fetch import REPO

from . import dd, engine, verifier
from .case import Case
from .sources import Http, http_get, now_utc

AGENTS = ("due-diligence", "policy", "watch", "verifier")


class PlanStep(BaseModel):
    agent: str = Field(description="one of: due-diligence, policy, watch, verifier")
    what: str = Field(description="what that agent does for this lot, in one short sentence, no numbers")
    why: str = Field(description="why, in one short sentence, no numbers")


class Plan(BaseModel):
    steps: list[PlanStep]


class Summary(BaseModel):
    text: str = Field(description="three sentences for the case file's header; only numbers given in the input")


class S(TypedDict, total=False):
    case: Case
    reading: dict[str, Any]
    model: Any
    http: Http
    ask_policy: Any  # (question, building) -> exit code; only the CLI passes it (a test never asks)


def ask_policy(question: str, building: str) -> int:
    """Run the policy agent (agents/policy) on one question; it writes data/policy/<id>-<slug>.json."""
    return subprocess.run([sys.executable, "-m", "agents.policy", question, "--building", building], cwd=REPO, capture_output=True, text=True, timeout=900).returncode


def _src_file(rel: str) -> dict[str, str]:
    b = (REPO / rel).read_bytes()
    return {"url": rel, "pulled_at": now_utc(), "sha256": hashlib.sha256(b).hexdigest()}


def read_engine(st: S) -> S:
    c, r = st["case"], st["reading"]
    lot = r["lot"]
    fb = r.get("first_blocker")
    w = r.get("width") or {}
    words = f"{r['headline']} First blocker: {fb['label'].lower()} ({w.get('formula')} ft, against a {r['proposal_width']} ft plan)." if fb else r["headline"]
    money = f" Money: {r['verdict']['words']}." if r.get("money") else ""
    src = f"data/blocks/{lot['block']}.json" if lot.get("block") else "data/city/lots.json"
    c.step("steward", "tool", f"The engine read the lot{' (the citywide reading: no block detail, so no plan or money screen)' if r.get('source') == 'citywide' else ''}. {words}{money}",
           tool="engine:scripts/case-engine.ts lot", input={"pin": lot["pin"], "type": r["type"]}, sources=[_src_file(src), _src_file("data/rules/reviews.json")])
    return st


def plan(st: S) -> S:
    c, r, m = st["case"], st["reading"], st.get("model")
    fb = r.get("first_blocker") or {}
    rule_plan = [
        {"agent": "due-diligence", "what": "Run the free public checks on the parcel and draft the paid studies' requests.", "why": "Records can stop a sale before the zoning does."},
        *([{"agent": "policy", "what": "Ask which sentence of the code blocks the width, and what changing it would open.", "why": "The first blocker is a rule, not the lot."}] if fb.get("is_rule") else []),
        {"agent": "watch", "what": "Watch the lot's records, rules and verdict; re-run the engine when one changes.", "why": "A permit next door or a signed rule can change the answer."},
        {"agent": "verifier", "what": "Check every quote, number and source before the case file is published.", "why": "Agents checking agents."},
    ]
    if m is None:
        c.plan = rule_plan
        c.step("steward", "plan", "Planned by rule, no model: " + "; ".join(p["agent"] for p in rule_plan) + ".", input={"why": c.model.get("why")})
        return st
    system = ("You are the steward of 24x100, a tool for Pittsburgh's City-owned vacant lots. Plan which agents work this lot "
              f"toward the goal. Agents: {', '.join(AGENTS)}. The verifier always runs last. Use the policy agent only when the "
              "first blocker is a rule. Write no numbers: the engine supplies them.")
    user = json.dumps({"goal": r["type_name"], "headline": r["headline"], "first_blocker": fb, "money": r["verdict"]["words"],
                       "route": [x["text"][:120] for x in r.get("route", [])]})
    try:
        p, call = m.ask(Plan, system, user)
        steps = [s.model_dump() for s in (p.steps if p else []) if s.agent in AGENTS]
        if not steps or steps[-1]["agent"] != "verifier":
            steps = [s for s in steps if s["agent"] != "verifier"] + [rule_plan[-1]]
        if not fb.get("is_rule"):
            steps = [s for s in steps if s["agent"] != "policy"]
        c.plan = steps
        c.step("steward", "plan", f"Planned with {call['model']}: " + "; ".join(s["agent"] for s in steps) + ".", input={"goal": r["type_name"]}, call=call)
    except Exception as e:  # noqa: BLE001 - the rule plan runs, and the case file says why
        c.plan = rule_plan
        c.model["planned_by"] = "rule"
        c.model["why"] = f"the model didn't answer ({_why(e)})"
        c.step("steward", "plan", f"The model didn't answer ({_why(e)}); planned by rule.", ok=False)
    return st


def due_diligence(st: S) -> S:
    dd.run(st["reading"], st["case"], st.get("model"), st.get("http") or http_get)
    return st


def wants_policy(st: S) -> str:
    return "policy" if any(p["agent"] == "policy" for p in st["case"].plan) else "drafts"


def policy(st: S) -> S:
    c, r = st["case"], st["reading"]
    lot = r["lot"]
    sc = json.loads((REPO / "data" / "city" / "scenarios.json").read_text())
    hits = [s for s in sc.get("scenarios", []) if lot["pin"] in ((s.get("by_type") or {}).get(r["type"]) or {}).get("pins", [])]
    for s in hits:
        c.step("policy", "tool", f"What-if {s['id']} ({s['name']}, §{s['section']}) would open this lot for a {r['type_name']}: a what-if, not the law.",
               tool="scenarios:data/city/scenarios.json", input={"what_if": s["id"]}, sources=[_src_file("data/city/scenarios.json")])
    if not hits:
        c.step("policy", "tool", "None of the computed what-ifs opens this lot.", tool="scenarios:data/city/scenarios.json", sources=[_src_file("data/city/scenarios.json")])
    c.extra.setdefault("links", []).extend({"label": f"What-if {s['id']}: {s['name']}", "href": f"?view=city&type={r['type']}&tab=whatif&whatif={s['id']}"} for s in hits)
    # The policy agent (agents/policy, `python -m agents.policy`): asked once per question, from engine facts only. A
    # committed run that opens this lot, or that already holds this question, is linked instead of asked again.
    runs = {f: json.loads(f.read_text()) for f in sorted((REPO / "data" / "policy").glob("q*.json"))}
    q, derived = question_for(r)
    hits = [(f, d) for f, d in runs.items() if lot["pin"] in (((d.get("by_type") or {}).get(r["type"]) or {}).get("pins") or []) or d.get("question") == q]
    ask = st.get("ask_policy")
    if not hits and st.get("model") is not None and ask is not None:
        c.step("policy", "tool", f"Asked the policy agent: \"{q}\"", tool="agents.policy", input={"question": q, **derived})
        rc = ask(q, r["type"])
        runs = {f: json.loads(f.read_text()) for f in sorted((REPO / "data" / "policy").glob("q*.json"))}
        hits = [(f, d) for f, d in runs.items() if d.get("question") == q]
        if not hits:
            c.step("policy", "tool", f"The policy agent didn't answer (exit {rc}).", tool="agents.policy", ok=False)
    for f, d in hits:
        rel = str(f.relative_to(REPO))
        if d.get("status") == "counted":
            bt = (d.get("by_type") or {}).get(r["type"]) or {}
            opens_here = lot["pin"] in (bt.get("pins") or [])
            c.step("policy", "tool", f"The policy agent's {d['id']}: {d['name']} ({d.get('change', '')}) would open {bt.get('opens', 0)} City-owned lots for a "
                   f"{r['type_name']}, {'this one among them' if opens_here else 'not this one'}. A what-if, not the law; its memo waits for a person.",
                   tool="policy:data/policy", input={"what_if": d["id"], "opens": bt.get("opens", 0), "override": d.get("override")}, sources=[_src_file(rel)])
            c.extra.setdefault("links", []).append({"label": f"Policy agent {d['id']}: {d['name']}", "href": f"?view=city&type={r['type']}&tab=whatif&whatif={d['id']}"})
            c.gates.append({"kind": "send", "what": f"The policy agent's memo on {d['id']} ({d['name']}) to the Planning Commission", "status": "waiting"})
        else:
            c.step("policy", "tool", f"The policy agent's {d['id']} refused: {d.get('reason', 'no single signed rule carries this change')}", tool="policy:data/policy",
                   input={"what_if": d["id"]}, sources=[_src_file(rel)])
    if not hits and (st.get("model") is None or ask is None):
        why = "Planned by rule, no model: the policy agent needs one." if st.get("model") is None else "Not asked in this run."
        c.step("policy", "tool", why + " To ask it: python -m agents.policy \"" + q + "\" --building " + r["type"] + ".", tool="agents.policy", input={"question": q})
    return st
    q = f"Which sentence of the Pittsburgh zoning code keeps {lot['addr']} too narrow for a {r['type_name']}, and what would changing it open?"
    out = subprocess.run([sys.executable, "-m", "agents.policy", q, "--building", r["type"]], cwd=REPO, capture_output=True, text=True, timeout=900)
    ok = out.returncode == 0
    c.step("policy", "tool", "The policy agent answered: see its redline and count." if ok else f"The policy agent failed (exit {out.returncode}).",
           tool="agents.policy", input={"question": q}, ok=ok)
    return st


FIELD_WORDS = {"side_setback_interior": "interior side setback", "side_setback_exterior": "exterior side setback", "front_setback": "front setback", "rear_setback": "rear setback"}


def question_for(r: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The policy agent's question, from engine facts only. When a setback rule makes the lot too narrow, the value that
    would let the planned width fit is arithmetic on the engine's own formula ("24 − 10 − 10 = 4", a 16 ft plan →
    (24 − 16) / 2 = 4 ft); the formula is recorded with the question."""
    lot, fb = r["lot"], r.get("first_blocker") or {}
    w = r.get("width") or {}
    rules = {x["id"]: x for x in r.get("rules", [])}
    blocker = next((b for b in r.get("blockers", []) if b["id"] == fb.get("id")), None)
    rule = next((rules[i] for i in (blocker or {}).get("rule_ids", []) if i in rules and rules[i]["field"] in FIELD_WORDS and isinstance(rules[i]["value"], (int, float))), None)
    terms = [float(x) for x in re.findall(r"\d+(?:\.\d+)?", (w.get("formula") or "").split("=")[0])]
    if fb.get("id") == "width" and rule and len(terms) >= 2:
        front, setbacks, v = terms[0], terms[1:], float(rule["value"])
        k = sum(1 for x in setbacks if x == v)
        others = sum(setbacks) - k * v
        target = (front - others - r["proposal_width"]) / k if k else -1
        if target >= 0 and target < v:
            t = int(target) if target == int(target) else round(target, 1)
            formula = f"({front:g} − {others:g} − {r['proposal_width']}) / {k} = {t:g}" if others else f"({front:g} − {r['proposal_width']}) / {k} = {t:g}"
            return (f"What if {lot['zone']}'s {FIELD_WORDS[rule['field']]} were {t:g} ft instead of {v:g}?",
                    {"derived": {"value": t, "formula": formula + f": the {FIELD_WORDS[rule['field']]} that lets a {r['proposal_width']} ft plan fit on this lot"}})
    deed = (lot.get("deed") or {}).get("front")
    return (f"What change to one signed rule would let a {r['proposal_width']} ft {r['type_name']} fit on {lot['addr']} "
            f"(lot {lot['lot']}, a {deed} ft wide lot in {lot['zone']})?", {})


def drafts(st: S) -> S:
    c, r, m = st["case"], st["reading"], st.get("model")
    for L in r.get("letters", []):
        c.drafts.append({"kind": "letter", "to": L["to"], "subject": L["subject"], "text": L["markdown"], "numbers_ok": L["numbers_ok"], "by": "engine (engine/src/inquiry.ts)", "gate": "send"})
        c.gates.append({"kind": "send", "what": f"Letter to {L['tab']}: {L['about']}", "status": "waiting"})
    if r.get("letters"):
        c.step("steward", "draft", f"Drafted {len(r.get('letters', []))} letters from the engine's reading, one per office; none is sent (send gates).", input={"letters": [L["office"] for L in r.get("letters", [])], "count": len(r.get("letters", []))})
    elif (r["lot"].get("city") or {}).get("status"):
        lot = r["lot"]
        # No per-office letters without block detail: the next move is the inquiry to City Real Estate, from engine facts.
        cty = lot["city"]
        formula = (r.get("width") or {}).get("formula")
        updated = f" (last updated {cty['status_updated']})" if cty.get("status_updated") else ""
        fits = f": {formula} ft" if formula else ""
        text = (f"To City Real Estate, City of Pittsburgh:\n\nWe are screening {lot['addr']} ({lot['hood']}), a City-owned lot listed "
                f"\"{cty['status']}\"{updated}, for a {r['type_name']}. Under the {lot['zone']} rules it fits{fits}. Could you tell us the "
                "asking price, the disposition process and anything we should know about the lot? This is an inquiry, not an offer.\n")
        c.drafts.append({"kind": "letter", "to": "City Real Estate, City of Pittsburgh", "subject": f"Inquiry: {lot['addr']} ({lot['hood']})", "text": text, "numbers_ok": True, "by": "rule template", "gate": "send"})
        c.gates.append({"kind": "send", "what": f"Inquiry to City Real Estate about {lot['addr']}", "status": "waiting"})
        c.step("steward", "draft", "Drafted the inquiry to City Real Estate from the engine's reading; not sent (send gate).", input={"letters": ["real_estate"]})
    for rule in r.get("rules", []):
        if rule["state"] != "ink":
            c.gates.append({"kind": "sign", "what": f"{rule['id']} (§{rule['section']}) is pencil: a person signs it before the case relies on it", "status": "waiting"})
    found = [f for f in c.findings if f["status"] == "found"]
    base = (f"{r['headline']} Due diligence found something to know in " + (f"{'; '.join(f['title'] for f in found)}." if found else "none of the checks.")
            + f" Every letter and paid request waits for a person.")
    if m is None:
        c.extra["summary"] = {"text": base, "by": "rule template"}
        return st
    system = ("Write three plain sentences for the top of a case file about a Pittsburgh City-owned vacant lot. Use only the facts and "
              "numbers given; copy numbers exactly; no advice beyond them; mention that letters and paid studies wait for a person.")
    user = json.dumps({"headline": r["headline"], "money": r["verdict"]["words"], "findings": [f["summary"] for f in c.findings]})
    try:
        p, call = m.ask(Summary, system, user)
        text = p.text if p else base
        c.extra["summary"] = {"text": text, "by": call["model"]}
        c.step("steward", "draft", "Wrote the case file's summary from the engine's reading and the findings.", call=call)
    except Exception as e:  # noqa: BLE001
        c.extra["summary"] = {"text": base, "by": "rule template"}
        c.step("steward", "draft", f"The model didn't answer ({_why(e)}); the summary is the rule template.", ok=False)
    return st


def verify(st: S) -> S:
    c, r = st["case"], st["reading"]
    doc = c.to_json()
    doc["plan"] = c.plan
    extra = {"summary": c.extra.get("summary", {}).get("text", "")}
    by = c.extra.get("summary", {}).get("by")
    res = verifier.verify({**doc, "drafts": doc["drafts"] + [{"kind": "summary", "text": extra["summary"]}]}, [r],
                          model_texts=[("summary", extra["summary"])] if by and by != "rule template" else [])
    c.verifier = res
    k = res["checked"]
    c.step("verifier", "verify", (f"Verified: {k['quotes']} quotes verbatim in the saved code, {k['numbers']} numbers traced, {k['findings']} findings sourced, no name-like field."
                                  if res["ok"] else f"Blocked: {len(res['failed'])} problems ({'; '.join(res['failed'][:3])})."), ok=res["ok"])
    return st


def gates(st: S) -> S:
    c = st["case"]
    n = {k: sum(1 for g in c.gates if g["kind"] == k) for k in ("send", "spend", "sign")}
    c.step("steward", "gate", f"Waiting on a person: {n['send']} letters to send, {n['spend']} paid studies to approve, {n['sign']} rules to sign.", input=n)
    return st


def graph():
    g = StateGraph(S)
    for name, fn in (("read_engine", read_engine), ("plan", plan), ("due_diligence", due_diligence), ("policy", policy), ("drafts", drafts), ("verify", verify), ("gates", gates)):
        g.add_node(name, fn)
    g.set_entry_point("read_engine")
    g.add_edge("read_engine", "plan")
    g.add_edge("plan", "due_diligence")
    g.add_conditional_edges("due_diligence", wants_policy, {"policy": "policy", "drafts": "drafts"})
    g.add_edge("policy", "drafts")
    g.add_edge("drafts", "verify")
    g.add_edge("verify", "gates")
    g.add_edge("gates", END)
    return g.compile()


def run(pin: str, goal: str = "two", *, model: Any = None, model_why: str = "", key: str | None = None, http: Http = http_get,
        reading: dict[str, Any] | None = None, write: bool = True, policy: Any = None) -> dict[str, Any]:
    r = reading or engine.lot(pin, goal)
    if r.get("kind") != "lot":
        raise SystemExit(f"{pin}: {r.get('why', 'no block detail')}")
    lot = r["lot"]
    c = Case(id=pin, goal=f"a {r['type_name']}", lot={k: lot[k] for k in ("pin", "addr", "lot", "block", "hood", "zone", "link")}, run_at=now_utc(),
             model={"id": model.name if model else None, "key": key if model else None, "planned_by": "model" if model else "rule", "why": model_why if not model else "ok"})
    graph().invoke({"case": c, "reading": r, "model": model, "http": http, "ask_policy": policy})
    c.extra["rerun"] = f"npm run steward -- {pin} --goal {goal}"
    if write:
        c.write()
    return c.to_json()
