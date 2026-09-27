"""Ask the policy agent a what-if about the zoning code.
    uv run python -m agents.policy "What if R2-L's rear setback were 20 ft instead of 30?" --building two
    uv run python -m agents.policy "…" --plan plan.json      a hand-written plan and redline, no model ("planned by hand, no model")
Writes data/policy/<id>-<slug>.json (the scenarios.json entry format, plus steps, usage and the memo) and <id>-<slug>.md.
The model is Gemini through LangChain (extract/llm.py). It probes the free models in POLICY_MODELS (or the list
below) and uses the first that answers; a key with billing is never required. Tokens and the paid-tier price
equivalent are recorded.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys

from extract.llm import Config, Extractor, load_env, make_chat_model, scrub

from . import core
from . import tools as T

MODELS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.7-flash", "gemini-3.6-flash", "gemini-flash-lite-latest"]
OUT = T.REPO / "data" / "policy"


def probe(models: list[str]) -> tuple[str | None, list[dict]]:
    tried = []
    for m in models:
        try:
            msg = make_chat_model(Config("gemini", m)).invoke("Reply with the single word OK.")
            tried.append({"model": m, "ok": True}); return m, tried
        except Exception as e:  # noqa: BLE001 - a model that doesn't answer is skipped, and the reason kept
            tried.append({"model": m, "ok": False, "error": scrub(re.sub(r"\s+", " ", f"{type(e).__name__}: {e}"))[:160]})
    return None, tried


def price(model: str, tin: int, tout: int) -> dict:
    from extract.eval import PRICING
    p = PRICING.get(model)
    if not p:
        return {"usd": None, "note": f"no published price recorded for {model} in extract/eval.py"}
    return {"usd": round(tin / 1e6 * p["input_per_m"] + tout / 1e6 * p["output_per_m"], 6), "per_m": [p["input_per_m"], p["output_per_m"]],
            "note": "paid-tier (Standard) price equivalent; the free tier charges nothing", "url": p.get("url")}


def next_id() -> str:
    n = [int(m.group(1)) for p in OUT.glob("*.json") if (m := re.match(r"q(\d+)-", p.name))]
    return f"Q{max(n, default=0) + 1}"


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m agents.policy", description=__doc__.split("\n")[0])
    ap.add_argument("question"); ap.add_argument("--building", choices=T.TYPES, default="two")
    ap.add_argument("--plan", help="a JSON file {plan, redline}: no model"); ap.add_argument("--id", help="Q1, Q2, … (default: the next free)")
    ap.add_argument("--model", help="skip the probe and use this model"); ap.add_argument("--dry", action="store_true", help="print, don't write")
    a = ap.parse_args(argv)
    load_env()
    qid = (a.id or next_id()).upper()
    if not re.fullmatch(r"Q\d+", qid):
        ap.error("--id must look like Q1")
    hand, model, info = None, None, {}
    if a.plan:
        hand = json.load(open(a.plan)); info = {"name": None}
        print(f"{qid}: {core.HAND}")
    else:
        name, tried = (a.model, [{"model": a.model, "ok": True, "note": "named with --model"}]) if a.model else probe(os.environ.get("POLICY_MODELS", ",".join(MODELS)).split(","))
        if not name:
            print("No model answered:\n" + "\n".join(f"  {t['model']}: {t.get('error')}" for t in tried) +
                  "\nRun it with a hand-written plan instead: --plan file.json (labelled 'planned by hand, no model').", file=sys.stderr)
            return 2
        ex = Extractor(Config("gemini", name), max_attempts=3, on_retry=lambda m: print("  " + m, file=sys.stderr))
        def model(schema, messages):
            r = ex.call(schema, messages)
            return r.parsed, {"tokens_in": r.tokens_in, "tokens_out": r.tokens_out}
        info = {"provider": "gemini (LangChain)", "name": name, "probe": tried}
        print(f"{qid}: model {name}")
    out = core.run(a.question, a.building, model=model, hand=hand, qid=qid, model_info=info)
    u = out.get("usage", {})
    if not hand:
        out["model"]["cost"] = price(out["model"]["name"], u.get("tokens_in", 0), u.get("tokens_out", 0))
    for s in out["steps"]:
        print(f"  {s['n']:2} {s['action']:6} {'ok ' if s['ok'] else 'NO '} {s['summary'][:150]}")
    stem = f"{qid.lower()}-{core.slug(out.get('name') or a.question)}"
    if out["status"] == "counted":
        b = out["by_type"][a.building]
        print(f"{qid} {out['status']}: {out['name']} · {a.building}-unit opens {b['opens']} ({b['for_sale']} for sale, {b['pencil']} pencil) · verified {out['verified']}")
    else:
        print(f"{qid} refused: {out['reason']}")
    if u.get("calls"):
        c = out["model"].get("cost", {})
        print(f"  tokens {u['tokens_in']:,} in / {u['tokens_out']:,} out over {u['calls']} calls · " + (f"${c['usd']:.4f} at the paid price" if c.get("usd") is not None else c.get("note", "")))
    if a.dry:
        return 0
    OUT.mkdir(parents=True, exist_ok=True)
    for old in OUT.glob(f"{qid.lower()}-*"):
        old.unlink()                                          # one file set per id
    if out.get("memo_md"):
        (OUT / f"{stem}.md").write_text(out["memo_md"])
        out["memo"] = f"data/policy/{stem}.md"
    (OUT / f"{stem}.json").write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    print(f"  → data/policy/{stem}.json" + (f", {stem}.md" if out.get("memo_md") else ""))
    return 0 if out["status"] == "refused" or out.get("verified") else 1


if __name__ == "__main__":
    sys.exit(main())
