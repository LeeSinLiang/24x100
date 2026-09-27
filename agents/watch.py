"""The watch agent, on the digest (scripts/digest.ts): when a watched lot's records, rules or map verdict change, it
re-runs the engine, explains the change in one sentence with the math, and drafts the next move, which waits at a send
gate. A SIMULATION ("if lot 24 got a building permit") is computed by the same engine and labelled simulated.
"""
from __future__ import annotations

import json
from typing import Any

from .model import why as _why
from pydantic import BaseModel, Field

from . import engine, verifier
from .case import Case
from .sources import now_utc


class Explain(BaseModel):
    sentence: str = Field(description="one sentence: what changed for the lot and why, with the math exactly as given")


class Letter(BaseModel):
    subject: str
    text: str = Field(description="a short letter, only facts and numbers given; ask, don't commit")


def _items(ch: dict[str, Any]) -> dict[str, dict[str, Any]]:
    return {i["kind"]: i for i in ch["items"]}


def explain_rule(ch: dict[str, Any]) -> str:
    it = _items(ch)
    v, r = it.get("verdict"), it.get("rules")
    s = f"{ch['addr']} ({ch['hood']}) now reads \"{v['after']}\"" if v else f"{ch['addr']} changed"
    if v:
        s += f"; before, \"{v['before']}\""
    if r:
        s += f", because {r['what']} went from \"{r['before']}\" to \"{r['after']}\""
    return s + "."


def letter_rule(ch: dict[str, Any]) -> dict[str, Any]:
    now = ch["now"]
    rec = now["records"]
    v = now["verdict"]
    text = (f"To City Real Estate, City of Pittsburgh:\n\nWe are screening {ch['addr']} ({ch['hood']}), a City-owned lot listed "
            f"\"{rec['status']}\" (last updated {rec['status_updated']}), for a {now['type'] if now['type'] != 'two' else 'two-unit'} home. "
            f"Under the {now['zone']} rules its buildable width is {v['formula']} ft, so we are looking at a narrower design. "
            "Could you tell us the asking price, the disposition process and anything we should know about the lot? "
            "This is an inquiry, not an offer.\n")
    return {"kind": "letter", "to": "City Real Estate, City of Pittsburgh", "subject": f"Inquiry: {ch['addr']} ({ch['hood']})", "text": text, "numbers_ok": True, "by": "rule template", "gate": "send"}


def run(baseline: str | None = None, *, model: Any = None, model_why: str = "", key: str | None = None, simulate: list[tuple[str, list[str]]] | None = None,
        watch_json: dict[str, Any] | None = None, sims: list[dict[str, Any]] | None = None, write: bool = True) -> dict[str, Any]:
    w = watch_json or engine.watch(baseline)
    c = Case(id="watch", goal="tell a steward when a watched lot's answer changes, and what to do next", lot={"pin": "watchlist", "addr": "Watched City lots"},
             run_at=now_utc(), model={"id": model.name if model else None, "key": key if model else None, "planned_by": "model" if model else "rule", "why": model_why if not model else "ok"})
    c.step("watch", "tool", f"Re-ran the engine on the watchlist, compared with {w.get('compared_with') or 'nothing (the first run)'}: {len(w['changes'])} lots changed.",
           tool="engine:scripts/case-engine.ts watch", input={"baseline": baseline, "changed": len(w["changes"])})
    events: list[dict[str, Any]] = []
    engine_inputs: list[dict[str, Any]] = [w]
    for ch in w["changes"]:
        sentence, call = explain_rule(ch), None
        if model is not None:
            try:
                it = _items(ch)
                facts = {"lot": ch["addr"], "verdict before": (it.get("verdict") or {}).get("before"), "verdict now": (it.get("verdict") or {}).get("after"),
                         "rules before": (it.get("rules") or {}).get("before"), "rules now": (it.get("rules") or {}).get("after"), "which rules": (it.get("rules") or {}).get("what")}
                p, call = model.ask(Explain, "In one sentence, say what changed for this Pittsburgh lot and why: the map verdict went from its old reading "
                                    "to its new one because the rules changed as given (who signed them). Copy the math exactly; use only the words and "
                                    "numbers given.", json.dumps(facts))
                sentence = p.sentence if p else sentence
            except Exception as e:  # noqa: BLE001
                c.step("watch", "draft", f"The model didn't answer ({_why(e)}); the explanation is the rule template.", ok=False)
        c.step("watch", "draft", sentence, input={"pin": ch["pin"]}, call=call)
        d = letter_rule(ch)
        if model is not None:
            try:
                now = ch["now"]
                facts = {"lot": ch["addr"], "neighbourhood": ch["hood"], "zoning district": now["zone"], "City sale status": now["records"]["status"],
                         "status last updated": now["records"]["status_updated"], "map verdict": next((i["after"] for i in ch["items"] if i["kind"] == "verdict"), None),
                         "what changed": sentence}
                p, call2 = model.ask(Letter, "Draft a short inquiry letter to City Real Estate, City of Pittsburgh, about buying this City-owned vacant lot "
                                     "for a small home. Use only these facts, with their labels' meaning; no parcel ids, no other numbers; ask about the "
                                     "price and process, and say it is an inquiry, not an offer. Sign it 'The 24x100 user' with no name.", json.dumps(facts))
                if p:
                    d = {**d, "subject": p.subject, "text": p.text, "by": call2["model"]}
                c.step("watch", "draft", f"Drafted the next move for {ch['addr']}: an inquiry to City Real Estate (send gate).", input={"pin": ch["pin"]}, call=call2)
            except Exception as e:  # noqa: BLE001
                c.step("watch", "draft", f"The model didn't answer ({_why(e)}); the letter is the rule template.", ok=False)
        else:
            c.step("watch", "draft", f"Drafted the next move for {ch['addr']}: an inquiry to City Real Estate (send gate).", input={"pin": ch["pin"]})
        c.drafts.append(d)
        c.gates.append({"kind": "send", "what": f"Inquiry to City Real Estate about {ch['addr']}", "status": "waiting"})
        events.append({"kind": "real", "pin": ch["pin"], "addr": ch["addr"], "hood": ch["hood"], "link": ch["link"], "items": ch["items"], "explanation": sentence, "draft": len(c.drafts) - 1})
    # The simulation: computed by the engine, labelled simulated, never a record.
    for i, (pin, built) in enumerate(simulate or []):
        base = (sims or [])[2 * i] if sims else engine.lot(pin)
        sim = (sims or [])[2 * i + 1] if sims else engine.simulate(pin, built)
        engine_inputs += [base, sim]
        ctx = sim["contextual"]
        who = " and ".join(_lot_word(b) for b in built)
        s = (f"SIMULATION, not a record: if {who} got a building permit, {sim['lot']['addr']} (lot {sim['lot']['lot']})'s side facing it could take "
             f"the contextual setback (§925.06.C, not below {ctx['minimum']} ft): at best {ctx['formula']} ft, against a {sim['proposal_width']} ft "
             f"{sim['type_name']}. Today it is {base['width']['formula']} ft. Pencil: it depends on the new building's actual setback.")
        c.step("watch", "tool", s, tool="engine:scripts/case-engine.ts simulate", input={"pin": pin, "built": built, "simulated": True})
        events.append({"kind": "simulated", "pin": pin, "addr": sim["lot"]["addr"], "link": sim["lot"]["link"], "built": built, "explanation": s,
                       "before": {"formula": base["width"]["formula"]}, "after": {"formula": ctx["formula"], "best": ctx["best"], "trust": "pencil"}})
    c.extra["events"] = events
    res = verifier.verify(c.to_json(), engine_inputs)
    c.verifier = res
    k = res["checked"]
    c.step("verifier", "verify", f"Verified: {k['numbers']} numbers traced to the engine, no name-like field." if res["ok"] else f"Blocked: {'; '.join(res['failed'][:3])}.", ok=res["ok"])
    c.step("watch", "gate", f"Waiting on a person: {len(c.gates)} letters to send. Nothing is sent without a person.", input={"send": len(c.gates)})
    if write:
        c.write()
    return c.to_json()


def _lot_word(pin: str) -> str:
    # "0010K00024000000" → "lot 24" (the County lot number is digits 6–10 of the pin)
    try:
        return f"lot {int(pin[5:10])}"
    except ValueError:
        return pin
