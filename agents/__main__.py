"""  uv run python -m agents steward <pin> [--goal two] [--no-model] [--model gemini-3.8-flash]
  uv run python -m agents watch [--baseline <git ref>] [--simulate <pin>:<built pin>[,<built pin>]] [--no-model]
  uv run python -m agents probe [models…]      which models answer on this key (one tiny call each)

The model key is read from the environment (GOOGLE_API_KEY), else 24x100/.env; set AGENTS_KEY_LABEL to say which key
it was in the case file (a label, never the key)."""
from __future__ import annotations

import argparse
import json
import sys

from pydantic import BaseModel


def _model(args):
    from .model import connect

    if args.no_model:
        return None, "--no-model", None
    m, why = connect(args.model)
    return m, why, (m.key if m else None)


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="agents")
    sub = ap.add_subparsers(dest="cmd", required=True)
    s = sub.add_parser("steward")
    s.add_argument("pin")
    s.add_argument("--goal", default="two")
    s.add_argument("--no-model", action="store_true")
    s.add_argument("--model")
    w = sub.add_parser("watch")
    w.add_argument("--baseline")
    w.add_argument("--simulate", action="append", default=[])
    w.add_argument("--no-model", action="store_true")
    w.add_argument("--model")
    p = sub.add_parser("probe")
    p.add_argument("models", nargs="*")
    args = ap.parse_args(argv)

    if args.cmd == "probe":
        from .model import connect

        class Ok(BaseModel):
            ok: bool

        for name in args.models or ["gemini-3.8-flash", "gemini-3.6-flash", "gemini-flash-lite-latest"]:
            m, why = connect(name)
            if not m:
                print(f"{name}: {why}")
                continue
            m.ex.max_attempts = 1
            try:
                r, call = m.ask(Ok, "Answer ok: true.", "ok?")
                print(f"{name}: answers ({call['tokens_in']} in, {call['tokens_out']} out)")
            except Exception as e:  # noqa: BLE001 - never the key
                from extract.llm import scrub

                print(f"{name}: refused ({type(e).__name__}: {scrub(str(e))[:120]})")
        return 0

    m, why, key = _model(args)
    if args.cmd == "steward":
        from .steward import run

        doc = run(args.pin, args.goal, model=m, model_why=why, key=key)
    else:
        from .watch import run as watch

        sims = []
        for spec in args.simulate:
            pin, built = spec.split(":")
            sims.append((pin, built.split(",")))
        doc = watch(args.baseline, model=m, model_why=why, key=key, simulate=sims)
    v = doc["verifier"]
    print(f"{doc['id']}: {doc['status']} · {len(doc['steps'])} steps · {len(doc['findings'])} findings · {len(doc['drafts'])} drafts · "
          f"{len(doc['gates'])} gates waiting · {doc['tokens']['calls']} model calls, ${doc['cost']['usd_paid_rate']} at the paid rate · "
          f"planned by {doc['model']['planned_by']}{'' if v['ok'] else ' · BLOCKED: ' + '; '.join(v['failed'][:5])}")
    print(f"→ data/cases/{doc['id']}.json")
    return 0 if v["ok"] else 1


if __name__ == "__main__":
    sys.exit(main())
