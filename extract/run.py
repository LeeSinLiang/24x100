"""Run extraction for one district and write data/rules/extracted/<district>.json.

    uv run python -m extract run --district R1D-H

Only public code text (the saved sections) goes to the model. If a call is refused after retries,
the run stops and writes nothing: no rule is ever hand-written or substituted.
"""

from __future__ import annotations

import hashlib
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

from .guards import guard
from .llm import Config, Extractor
from .prompt import build_messages, prompt_sha
from .schema import ExtractedFile, ExtractionOut
from .sections import plan, resolve_district
from .source import REPO

OUT_DIR = REPO / "data" / "rules" / "extracted"


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def run_district(district: str, cfg: Config, extractor: Extractor | None = None, out_dir: Path = OUT_DIR, compare: bool = False) -> dict:
    """Extract one district. compare=True writes data/rules/extracted/compare/<d>.<provider>.<model>.json,
    which the app does not load (for the side-by-side provider table only)."""
    d = resolve_district(district)
    calls = plan(d)
    ex = extractor or Extractor(cfg, on_retry=lambda m: log(f"    {m}"))
    run_at = datetime.now(timezone.utc).isoformat(timespec="seconds")

    rules: list[dict] = []
    rejected: list[dict] = []
    checks: list[dict] = []
    raw: list[dict] = []
    call_logs: list[dict] = []
    shas: list[str] = []
    model_names: set[str] = set()
    seen: set[str] = set()

    for c in calls:
        msgs = build_messages(d, c)
        sha = prompt_sha(msgs)
        shas.append(sha)
        label = f"{c.id}: " + ", ".join(s.section for s in c.sections)
        log(f"[{d.name}] {label} ...")
        t0 = time.monotonic()
        res = ex.call(ExtractionOut, msgs)
        wall_ms = int((time.monotonic() - t0) * 1000)
        model_names.add(res.model_name)
        call_logs.append(
            {
                "section": label,
                "tokens_in": res.tokens_in,
                "tokens_out": res.tokens_out,
                "tokens_reasoning": res.tokens_reasoning,
                "latency_ms": res.latency_ms,
                "wall_ms": wall_ms,
                "attempts": res.attempts,
                "retries": res.retries,
                "error": res.parsing_error,
            }
        )
        raw.append({"call": c.id, "prompt_sha": sha, "model": res.model_name, "text": res.raw_text, "parsing_error": res.parsing_error})
        log(f"    {res.tokens_in} in / {res.tokens_out} out ({res.tokens_reasoning} reasoning) tokens, {res.latency_ms} ms, attempts {res.attempts}")
        if res.parsed is None:
            log(f"    no parsed output: {res.parsing_error}")
            continue
        for p in res.parsed.rules:
            v = guard(p, district=d.name, allowed_fields=c.fields, model=res.model_name, prompt_sha=sha)
            proposal = p.model_dump()
            if v.rule is None:
                rejected.append({"rule": proposal, "reason": v.reason, "call": c.id})
                log(f"    REJECTED {p.field}: {v.reason}")
                continue
            if v.rule["id"] in seen:
                rejected.append({"rule": proposal, "reason": "duplicate: an earlier proposal for this field was already accepted", "call": c.id})
                log(f"    REJECTED {p.field}: duplicate")
                continue
            seen.add(v.rule["id"])
            rules.append(v.rule)
            checks.append({"id": v.rule["id"], "call": c.id, "ambiguous": p.ambiguous, "question_source": v.question_source, "notes": v.notes})
            log(f"    ok {p.field} = {json.dumps(v.rule['value'])[:60]} §{v.rule['section']}" + (f"  ({'; '.join(v.notes)})" if v.notes else ""))

    missing = [f for c in calls for f in c.fields if f"{d.slug}.x.{f}" not in seen]
    model = sorted(model_names)[0] if len(model_names) == 1 else ",".join(sorted(model_names))
    doc = {
        "meta": {
            "provider": cfg.provider,
            "model": model,
            "prompt_sha": hashlib.sha256("".join(shas).encode()).hexdigest(),
            "run_at": run_at,
            "district": d.name,
            "sections": [f"{s.section} ({s.source_file}{'; trimmed: ' + s.trimmed if s.trimmed else ''})" for c in calls for s in c.sections],
            "tokens_in": sum(x["tokens_in"] for x in call_logs),
            "tokens_out": sum(x["tokens_out"] for x in call_logs),
            "tokens_reasoning": sum(x["tokens_reasoning"] for x in call_logs),
            "latency_ms": sum(x["latency_ms"] for x in call_logs),
            "wall_ms": sum(x["wall_ms"] for x in call_logs),
            "calls": call_logs,
            "note": (
                "Proposed by an LLM from the saved code text only. Every rule is unreviewed (pencil) until a named "
                "person source-checks it in the app. Fields with no accepted rule: " + (", ".join(missing) or "none") + "."
            ),
        },
        "rules": rules,
        "rejected": rejected,
        "checks": checks,
        "raw": raw,
    }
    ExtractedFile.model_validate(doc)  # the file must load in the app
    if compare:
        out_dir = out_dir / "compare"
    out_dir.mkdir(parents=True, exist_ok=True)
    path = out_dir / (f"{d.slug}.{cfg.provider}.{cfg.model}.json" if compare else f"{d.slug}.json")
    path.write_text(json.dumps(doc, indent=1, ensure_ascii=False) + "\n", encoding="utf-8")
    log(f"[{d.name}] wrote {path.relative_to(REPO) if path.is_relative_to(REPO) else path}: {len(rules)} rules, {len(rejected)} rejected, missing: {missing or 'none'}")
    return doc
