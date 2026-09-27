"""The case file (data/cases/<id>.json): what the agents did, in order, with every source, draft and gate.

{ goal, lot, run_at, model, tokens, cost, plan[], steps[], findings[], drafts[], gates[], verifier, status }
step    = { agent, n, action: plan|tool|draft|verify|gate, tool?, input, summary, sources[{url, pulled_at, sha256}], ok, t,
            model?, tokens? }
gate    = { kind: sign|send|spend, what, status: waiting|approved, by? }
"""
from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from pipeline.fetch import REPO

CASES = REPO / "data" / "cases"


@dataclass
class Case:
    id: str
    goal: str
    lot: dict[str, Any]
    run_at: str
    model: dict[str, Any]
    plan: list[dict[str, Any]] = field(default_factory=list)
    steps: list[dict[str, Any]] = field(default_factory=list)
    findings: list[dict[str, Any]] = field(default_factory=list)
    drafts: list[dict[str, Any]] = field(default_factory=list)
    gates: list[dict[str, Any]] = field(default_factory=list)
    verifier: dict[str, Any] = field(default_factory=dict)
    extra: dict[str, Any] = field(default_factory=dict)
    _t0: float = field(default_factory=time.monotonic, repr=False)

    def step(self, agent: str, action: str, summary: str, *, tool: str | None = None, input: Any = None,
             sources: list[dict[str, str]] | None = None, ok: bool = True, call: Any = None) -> dict[str, Any]:
        s: dict[str, Any] = {"agent": agent, "n": len(self.steps) + 1, "action": action}
        if tool:
            s["tool"] = tool
        s.update({"input": input if input is not None else {}, "summary": summary, "sources": sources or [], "ok": ok,
                  "t": round(time.monotonic() - self._t0, 2)})
        if call is not None:  # a model call: which model, tokens, the paid-rate cost
            s["model"] = call["model"]
            s["tokens"] = {"in": call["tokens_in"], "out": call["tokens_out"]}
            s["cost_usd_paid_rate"] = call["cost"]
        self.steps.append(s)
        return s

    def totals(self) -> dict[str, Any]:
        calls = [s for s in self.steps if "tokens" in s]
        tin = sum(s["tokens"]["in"] for s in calls)
        tout = sum(s["tokens"]["out"] for s in calls)
        usd = round(sum(s.get("cost_usd_paid_rate") or 0 for s in calls), 6)
        return {"tokens": {"in": tin, "out": tout, "calls": len(calls)}, "cost": {"usd_paid_rate": usd, "note": "at the model's published paid Standard rate; what was billed depends on the key's tier"}}

    def to_json(self) -> dict[str, Any]:
        failed = self.verifier.get("failed", [])
        return {
            "id": self.id,
            "goal": self.goal,
            "lot": self.lot,
            "run_at": self.run_at,
            "model": self.model,
            **self.totals(),
            "plan": self.plan,
            "steps": self.steps,
            "findings": self.findings,
            "drafts": self.drafts,
            "gates": self.gates,
            "verifier": self.verifier,
            "status": "blocked" if failed else "published",
            **self.extra,
        }

    def write(self, path: Path | None = None) -> Path:
        CASES.mkdir(parents=True, exist_ok=True)
        p = path or CASES / f"{self.id}.json"
        p.write_text(json.dumps(self.to_json(), indent=1, ensure_ascii=False) + "\n")
        return p
