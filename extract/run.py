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
from .llm import CallResult, Config, Extractor, ProviderRefused
from .prompt import build_messages, prompt_sha
from .schema import ExtractedFile, ExtractionOut
from .sections import plan, resolve_district
from .source import REPO

OUT_DIR = REPO / "data" / "rules" / "extracted"
# Every successful response is also kept here (gitignored), keyed by model + prompt sha. With
# --resume, a re-run re-uses a response for an identical prompt instead of spending free-tier quota;
# the call log says so ("cached_from"). It is the model's real earlier answer, re-parsed and re-guarded.
CACHE = REPO / "extract" / ".cache"


def _cache_path(cache_dir: Path, model: str, sha: str) -> Path:
    return cache_dir / model / f"{sha}.json"


def _save_cache(cache_dir: Path, model: str, sha: str, res: CallResult) -> None:
    p = _cache_path(cache_dir, model, sha)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps({
        "at": datetime.now(timezone.utc).isoformat(timespec="seconds"), "model_name": res.model_name, "raw_text": res.raw_text,
        "tokens_in": res.tokens_in, "tokens_out": res.tokens_out, "tokens_reasoning": res.tokens_reasoning,
        "latency_ms": res.latency_ms, "attempts": res.attempts, "retries": res.retries,
    }, ensure_ascii=False), encoding="utf-8")


def _load_cache(cache_dir: Path, model: str, sha: str) -> tuple[CallResult, str] | None:
    p = _cache_path(cache_dir, model, sha)
    if not p.exists():
        return None
    c = json.loads(p.read_text(encoding="utf-8"))
    try:
        parsed = ExtractionOut.model_validate_json(c["raw_text"])
    except Exception:  # noqa: BLE001 - an unparseable cache entry is a miss
        return None
    res = CallResult(parsed=parsed, raw_text=c["raw_text"], tokens_in=c["tokens_in"], tokens_out=c["tokens_out"], tokens_reasoning=c["tokens_reasoning"],
                     latency_ms=c["latency_ms"], attempts=c["attempts"], model_name=c["model_name"], retries=c.get("retries", []))
    return res, c["at"]


def log(msg: str) -> None:
    print(msg, file=sys.stderr, flush=True)


def run_district(district: str, cfg: Config, extractor: Extractor | None = None, out_dir: Path = OUT_DIR, compare: bool = False, resume: bool = False, cache_dir: Path | None = CACHE, run_note: str | None = None, only: list[str] | None = None) -> dict:
    """Extract one district. compare=True writes data/rules/extracted/compare/<d>.<provider>.<model>.json,
    which the app does not load (for the side-by-side provider table only)."""
    d = resolve_district(district)
    calls = plan(d)
    if only:
        # Only some calls (e.g. dimensional and use: the §925.06 rules are already stored once, citywide).
        unknown = set(only) - {c.id for c in calls}
        if unknown:
            raise ValueError(f"unknown call(s) {sorted(unknown)}; this district's calls are {[c.id for c in calls]}")
        calls = [c for c in calls if c.id in only]
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
    failed: list[str] = []
    stop: str | None = None

    for c in calls:
        msgs = build_messages(d, c)
        sha = prompt_sha(msgs)
        shas.append(sha)
        label = f"{c.id}: " + ", ".join(s.section for s in c.sections)
        log(f"[{d.name}] {label} ...")
        if stop:
            failed.append(c.id)
            call_logs.append({"section": label, "tokens_in": 0, "tokens_out": 0, "latency_ms": 0, "wall_ms": 0, "attempts": 0, "error": f"not attempted: {stop}"})
            log(f"    skipped: {stop}")
            continue
        t0 = time.monotonic()
        cached_from = None
        hit = _load_cache(cache_dir, cfg.model, sha) if (resume and cache_dir) else None
        try:
            if hit:
                res, cached_from = hit
                log(f"    re-using the model's earlier response to this exact prompt ({cached_from})")
            else:
                res = ex.call(ExtractionOut, msgs)
                if res.parsed is not None and cache_dir:
                    _save_cache(cache_dir, cfg.model, sha, res)
        except ProviderRefused as e:
            # A refused call yields no rules. Record it, and keep going unless the refusal is a daily
            # quota (then every later call would be refused too).
            failed.append(c.id)
            call_logs.append({"section": label, "tokens_in": 0, "tokens_out": 0, "latency_ms": e.latency_ms, "wall_ms": int((time.monotonic() - t0) * 1000),
                              "attempts": e.attempts, "retries": e.retries, "error": f"refused: {e}"})
            log(f"    REFUSED: {e}")
            if e.daily:
                stop = "daily quota reached earlier in this run"
            continue
        wall_ms = None if cached_from else int((time.monotonic() - t0) * 1000)
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
                "cached_from": cached_from,
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

    if not model_names:
        raise ProviderRefused(f"every call for {d.name} was refused; nothing written")
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
            "tokens_reasoning": sum(x.get("tokens_reasoning", 0) for x in call_logs),
            "latency_ms": sum(x["latency_ms"] for x in call_logs),
            "wall_ms": None if any(x.get("wall_ms") is None for x in call_logs) else sum(x["wall_ms"] for x in call_logs),
            "calls": call_logs,
            "run_note": run_note,
            "incomplete": bool(failed),
            "failed_calls": failed,
            "note": (
                "Proposed by an LLM from the saved code text only. Every rule is unreviewed (pencil) until a named "
                "person source-checks it in the app."
                + (f" Only these calls were run: {', '.join(only)}." if only else "")
                + " Fields with no accepted rule: " + (", ".join(missing) or "none") + "."
                + (f" Calls refused by the provider (no rules from them): {', '.join(failed)}." if failed else "")
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
