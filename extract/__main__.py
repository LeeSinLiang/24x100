"""CLI.

    uv run python -m extract run --district R1D-H [--provider gemini|anthropic] [--model ID]
    uv run python -m extract eval
    uv run python -m extract check          # re-run the quote guard over every rule file (no network)
"""

from __future__ import annotations

import argparse
import sys


def main(argv: list[str] | None = None) -> int:
    ap = argparse.ArgumentParser(prog="python -m extract")
    sub = ap.add_subparsers(dest="cmd", required=True)
    r = sub.add_parser("run", help="extract rules for a district with the configured LLM")
    r.add_argument("--district", required=True, action="append", help="e.g. RM-M, R1D-H (repeatable)")
    r.add_argument("--provider", default=None, help="gemini | anthropic (default: EXTRACT_PROVIDER or gemini)")
    r.add_argument("--model", default=None, help="model id (default: EXTRACT_MODEL or the provider default)")
    r.add_argument("--compare", action="store_true", help="write to data/rules/extracted/compare/ (not loaded by the app)")
    sub.add_parser("eval", help="compare the RM-M extraction with the answer key; write docs/eval.md")
    sub.add_parser("check", help="re-verify every quote in data/rules (base + extracted) with the Python locator")
    a = ap.parse_args(argv)

    if a.cmd == "run":
        from .llm import Config, MissingKey, ProviderRefused
        from .run import run_district

        cfg = Config.from_env(a.provider, a.model)
        try:
            for dist in a.district:
                run_district(dist, cfg, compare=a.compare)
        except MissingKey as e:
            print(f"STOP (gate G2): {e}", file=sys.stderr)
            return 2
        except ProviderRefused as e:
            print(f"STOP: {e}. Nothing was written for this district.", file=sys.stderr)
            return 3
        return 0
    if a.cmd == "eval":
        from .eval import main as eval_main

        return eval_main()
    if a.cmd == "check":
        from .eval import recheck_all

        bad = recheck_all()
        for b in bad:
            print(b)
        print(f"{len(bad)} quote(s) failed")
        return 1 if bad else 0
    return 1


if __name__ == "__main__":
    sys.exit(main())
