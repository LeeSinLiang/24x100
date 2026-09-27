"""The model, when there is one: Gemini through LangChain (extract/llm.py's wrapper: retries, token counts, quota
refusals). It plans, picks checks and drafts words; it never supplies a number the engine or a source doesn't hold
(the verifier checks). No key, or a refusal: the caller goes by rule and the case file says so."""
from __future__ import annotations

import html
import os
import re
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel

from extract.eval import PRICING
from extract.llm import Config, Extractor, MissingKey, ProviderRefused

DEFAULT = "gemini-3.8-flash"


def cost(model: str, tin: int, tout: int) -> float | None:
    p = PRICING.get(model)
    return None if not p else round(tin * p["input_per_m"] / 1e6 + tout * p["output_per_m"] / 1e6, 6)


@dataclass
class Model:
    name: str
    key: str  # which key: "track3" / "24x100" (never the key itself)
    ex: Any

    def ask(self, schema: type[BaseModel], system: str, user: str) -> tuple[BaseModel | None, dict[str, Any]]:
        r = self.ex.call(schema, [("system", system), ("human", user)])
        if r.parsed is not None:  # models sometimes answer "24&#215;100": words, not markup
            r.parsed = r.parsed.model_copy(update={k: html.unescape(v) for k, v in r.parsed.model_dump().items() if isinstance(v, str)})
        answered = str(r.model_name or self.name)  # an alias ("gemini-flash-lite-latest") answers as a real model: price that one
        call = {"model": answered, "tokens_in": r.tokens_in, "tokens_out": r.tokens_out, "cost": cost(answered, r.tokens_in, r.tokens_out) or cost(self.name, r.tokens_in, r.tokens_out)}
        return r.parsed, call


def connect(name: str | None = None, fake: Any = None) -> tuple[Model | None, str]:
    """(model, why). `fake` is a chat model for tests. Returns (None, reason) when no model can run."""
    name = name or os.environ.get("AGENTS_MODEL") or DEFAULT
    if fake is not None:
        return Model(name, "test", Extractor(Config("gemini", name), chat_model=fake, sleep=lambda s: None, max_attempts=1)), "fake"
    if os.environ.get("AGENTS_NO_MODEL"):
        return None, "AGENTS_NO_MODEL is set"
    cfg = Config.from_env("gemini", name)
    cfg.thinking = os.environ.get("AGENTS_THINKING") or "low"
    cfg.min_interval = 0
    try:
        ex = Extractor(cfg, max_attempts=3)
    except MissingKey as e:
        return None, str(e)
    return Model(name, os.environ.get("AGENTS_KEY_LABEL", "24x100"), ex), "ok"


def why(e: BaseException) -> str:
    """A refusal, short and without the key: '503 UNAVAILABLE (high demand)', '429 daily quota', or the error type."""
    from extract.llm import scrub

    t = scrub(str(e))
    m = re.search(r"\b(429|503|500|504)\b", t)
    if m and m.group(1) == "429":
        return "429: quota" + (" (daily)" if getattr(e, "daily", False) else "")
    if m and m.group(1) == "503":
        return "503: the model is overloaded (high demand)"
    return type(e).__name__ + (f" {m.group(1)}" if m else "")


__all__ = ["Model", "connect", "cost", "why", "ProviderRefused", "DEFAULT"]
