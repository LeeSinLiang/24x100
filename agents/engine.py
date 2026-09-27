"""The engine, called from Python: scripts/case-engine.ts prints one JSON object. The agents never compute a number."""
from __future__ import annotations

import json
import subprocess
from typing import Any

from pipeline.fetch import REPO


def run(*args: str) -> dict[str, Any]:
    out = subprocess.run(["npx", "--no-install", "tsx", "scripts/case-engine.ts", *args], cwd=REPO, capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise RuntimeError(f"case-engine.ts {' '.join(args)} failed: {out.stderr.strip()[-400:]}")
    return json.loads(out.stdout.strip().splitlines()[-1])


def lot(pin: str, type: str = "two") -> dict[str, Any]:
    return run("lot", pin, "--type", type)


def simulate(pin: str, built: list[str], type: str = "two") -> dict[str, Any]:
    return run("simulate", pin, "--built", ",".join(built), "--type", type)


def watch(baseline: str | None = None) -> dict[str, Any]:
    return run("watch", *(["--baseline", baseline] if baseline else []))
