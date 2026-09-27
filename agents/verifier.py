"""The verifier runs last, before a case file is published. Agents checking agents:

  quotes    every rule quote the case rests on is verbatim in the saved code text (extract/source.py, the same guard
            the extractor uses);
  numbers   every number in the words the agents wrote (plan, step summaries, findings, drafts) is one the engine
            computed, one a source record holds, or one code counted from those records (`derived`, with its formula);
  sources   every finding has its source (URL, pull time, sha256), or says who to ask; a paid study is never "done";
  names     no key anywhere in the case file looks like a person's name or mailing address.

Any failure blocks publication (status "blocked") and is listed.
"""
from __future__ import annotations

import re
from typing import Any, Iterable

from extract.source import check_quote, read_code

from .sources import NAME_LIKE

# The same shape as engine/src/inquiry.ts numbersIn: digits with optional thousands separators and decimals.
_NUM = re.compile(r"(?<![\w.])\$?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)")
# Identifiers that aren't quantities: parcel pins, case numbers, sections, dates, record ids, permit ids.
_IDS = re.compile(
    r"\b\d{4}[A-Z]\d{5}\d{6}\b|\b[A-Z]{2,}-[A-Z]*-?\d{4}-\d+\b|§\s*[\d.]+[A-Z]?(?:\.\d+)*|\b\d{4}-\d{2}-\d{2}(?:T[\d:.]+Z?)?\b|"
    r"\b\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b|\b(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b|\b311\b|\b[45]\d{2}(?=:)|\b(?:lot|lots|block|ward|Ward|Lot|Block)\s+[\dA-Z]+(?:[–-]\d+)?\b|\b\d{4}[A-Z]\b|\bIPMC\s+[\d.]+|\b[A-Z]\d?-[A-Z]+\b|\b\d{2,4}\s+[A-Z][a-z]+ (?:St|Ave|Way|Street|Avenue)\b"
)


def numbers_in(text: str) -> list[float]:
    t = _IDS.sub(" ", text)
    return [float(m.group(1).replace(",", "")) for m in _NUM.finditer(t)]


def _walk_numbers(x: Any, out: set[float]) -> None:
    if isinstance(x, bool) or x is None:
        return
    if isinstance(x, (int, float)):
        out.add(float(x))
        out.add(float(round(x)))
        out.add(round(float(x), 2))
        out.add(float(round(x / 1000) * 1000))
        out.add(abs(float(x)))
    elif isinstance(x, str):
        for n in numbers_in(x):
            out.add(n)
    elif isinstance(x, dict):
        for v in x.values():
            _walk_numbers(v, out)
    elif isinstance(x, list):
        for v in x:
            _walk_numbers(v, out)


def allowed_numbers(engine: Iterable[dict[str, Any]], findings: list[dict[str, Any]]) -> set[float]:
    ok: set[float] = {0, 1}  # counts and constants the agents' code produces are recorded in the step's input or `derived`
    for e in engine:
        _walk_numbers(e, ok)
    for f in findings:
        _walk_numbers(f.get("records"), ok)
        _walk_numbers({k: v.get("value") for k, v in (f.get("derived") or {}).items()}, ok)
    return ok


_TOKEN = re.compile(r"\S*\d\S*")


def _tokens(text: str) -> set[str]:
    return {t.strip(".,;:()[]\"'“”‘’!?") for t in _TOKEN.findall(text)}


def _walk_strings(x: Any, out: set[str]) -> None:
    if isinstance(x, str):
        out |= _tokens(x)
    elif isinstance(x, dict):
        for v in x.values():
            _walk_strings(v, out)
    elif isinstance(x, list):
        for v in x:
            _walk_strings(v, out)


def _names(x: Any, path: str = "") -> list[str]:
    bad = []
    if isinstance(x, dict):
        for k, v in x.items():
            if NAME_LIKE.search(str(k)) and k not in ("by",):  # "by": who signed a gate (a role or the steward's own words)
                bad.append(f"{path}.{k}".lstrip("."))
            bad += _names(v, f"{path}.{k}")
    elif isinstance(x, list):
        for i, v in enumerate(x):
            bad += _names(v, f"{path}[{i}]")
    return bad


def verify(case: dict[str, Any], engine: list[dict[str, Any]], model_texts: list[tuple[str, str]] | None = None) -> dict[str, Any]:
    failed: list[str] = []
    checked = {"quotes": 0, "numbers": 0, "findings": 0, "keys": 0}
    # Quotes: every rule the engine's reading rests on, verbatim in its saved chapter.
    for e in engine:
        for r in e.get("rules", []) or []:
            if not r.get("quote") or not r.get("source_file"):
                continue
            checked["quotes"] += 1
            try:
                q = check_quote(read_code(r["source_file"]), r["section"], r["quote"])
                if not q.ok:
                    failed.append(f"quote for {r['id']} is not verbatim in §{r['section']} ({r['source_file']})")
            except Exception as ex:  # noqa: BLE001
                failed.append(f"quote for {r['id']} couldn't be checked: {type(ex).__name__}")
    # Numbers in the words the agents wrote.
    ok = allowed_numbers(engine, case.get("findings", []))
    texts: list[tuple[str, str]] = [("plan", p.get("why", "") + " " + p.get("what", "")) for p in case.get("plan", [])]
    steps = [s for s in case.get("steps", []) if s.get("action") != "verify"]
    texts += [(f"finding {f['check']}", f.get("summary", "")) for f in case.get("findings", [])]
    texts += [(f"draft {i + 1}", d.get("text", "") + " " + d.get("subject", "")) for i, d in enumerate(case.get("drafts", [])) if d.get("kind") != "letter"]
    def held(n: float, extra: set[float]) -> bool:
        return n in ok or round(n) in ok or n in extra or round(n) in extra

    for where, t in texts:
        for n in numbers_in(t):
            checked["numbers"] += 1
            if not held(n, set()):
                failed.append(f"{where}: {n:g} doesn't trace to the engine or a source")
    # A step's own words may also use what its code counted (its `input`); a model's words get no such allowance.
    for s in steps:
        own: set[float] = set()
        if "tokens" not in s:
            _walk_numbers(s.get("input"), own)
        for n in numbers_in(s.get("summary", "")):
            checked["numbers"] += 1
            if not held(n, own):
                failed.append(f"step {s['n']}: {n:g} doesn't trace to the engine or a source")
    # Words a model wrote: every word with a digit in it ("24×100", "25 − 5 − 5 = 15", "2026-08-05") is copied verbatim from
    # what the engine or a source said. A model that garbles one ("24'times100") is caught even when no number is new.
    if model_texts:
        seen: set[str] = {"24×100", "24x100"}  # the product's own name
        for e in engine:
            _walk_strings(e, seen)
        for f in case.get("findings", []):
            _walk_strings([f.get("summary"), f.get("records")], seen)
        for where, t in model_texts:
            for tok in _tokens(t):
                checked["numbers"] += 1
                if tok and tok not in seen and not re.fullmatch(r"[\d,]+(\.\d+)?", tok):
                    failed.append(f"{where}: \"{tok}\" isn't copied from the engine or a source")
    # Engine letters carry their own number check (engine/src/inquiry.ts): they must have passed it.
    for d in case.get("drafts", []):
        if d.get("kind") == "letter" and not d.get("numbers_ok", False):
            failed.append(f"letter to {d.get('to')}: its numbers don't trace (the engine's own check)")
    # Sources.
    for f in case.get("findings", []):
        checked["findings"] += 1
        st = f.get("status")
        if st in ("found", "nothing"):
            s = f.get("source") or {}
            if not (s.get("url") and s.get("pulled_at") and re.fullmatch(r"[0-9a-f]{64}", s.get("sha256", ""))):
                failed.append(f"finding {f['check']}: no source (URL, pull time and sha256)")
        elif st == "couldnt":
            if not f.get("ask"):
                failed.append(f"finding {f['check']}: couldn't check, and doesn't say who to ask")
        elif st == "not_done":
            if f.get("done"):
                failed.append(f"finding {f['check']}: a paid study is marked done")
        else:
            failed.append(f"finding {f['check']}: unknown status {st!r}")
    # Names.
    bad = _names({k: v for k, v in case.items() if k != "verifier"})
    checked["keys"] = 1
    failed += [f"name-like field in the case file: {b}" for b in bad]
    return {"checked": checked, "failed": failed, "ok": not failed}
