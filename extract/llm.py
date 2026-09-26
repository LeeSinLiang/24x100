"""One interface in front of the chat model. Switching providers is a config change.

    EXTRACT_PROVIDER=gemini|anthropic   (default gemini)
    EXTRACT_MODEL=<model id>            (default per provider, below)

Gemini: langchain-google-genai `ChatGoogleGenerativeAI`, key GOOGLE_API_KEY (Google AI Studio).
Claude: langchain-anthropic `ChatAnthropic`, key ANTHROPIC_API_KEY.

Both use `.with_structured_output(<Pydantic model>, method="json_schema", include_raw=True)`, so
we get the parsed object and the raw message (for its text and `usage_metadata`). Token counts
are the provider's own numbers from the response; latency is wall-clock per call. Rate limits are
retried with backoff; anything else, or a limit that doesn't clear, raises. Nothing is ever
substituted for a model answer.
"""

from __future__ import annotations

import os
import random
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable

from pydantic import BaseModel

from .source import REPO

DEFAULT_MODEL = {
    # Google's "recommended default" free-tier model on ai.google.dev/gemini-api/docs/models
    # (page updated 2026-09-24, read 2026-09-26); verified with a live call on 2026-09-26.
    "gemini": "gemini-3.8-flash",
    # Not run (no ANTHROPIC_API_KEY); the model named in the build spec §6.2.
    "anthropic": "claude-opus-5-5",
}
KEY_ENV = {"gemini": "GOOGLE_API_KEY", "anthropic": "ANTHROPIC_API_KEY"}


class MissingKey(RuntimeError):
    pass


class ProviderRefused(RuntimeError):
    """The provider kept refusing (rate limit / quota / overload) after retries. Don't fabricate."""

    def __init__(self, msg: str, *, attempts: int = 0, retries: list[str] | None = None, latency_ms: int = 0, daily: bool = False):
        super().__init__(msg)
        self.attempts = attempts
        self.retries = retries or []
        self.latency_ms = latency_ms
        self.daily = daily


def load_env() -> None:
    from dotenv import load_dotenv

    load_dotenv(REPO / ".env", override=False)


@dataclass
class Config:
    provider: str
    model: str
    thinking: str | None = None  # Gemini 3 thinking_level: minimal|low|medium|high (None = model default)
    min_interval: float = 0.0  # seconds between request starts (pacing for free-tier per-minute limits)

    @classmethod
    def from_env(cls, provider: str | None = None, model: str | None = None) -> "Config":
        load_env()
        p = (provider or os.environ.get("EXTRACT_PROVIDER") or "gemini").strip().lower()
        if p in ("google", "google_genai"):
            p = "gemini"
        if p in ("claude",):
            p = "anthropic"
        if p not in DEFAULT_MODEL:
            raise ValueError(f"EXTRACT_PROVIDER must be gemini or anthropic, got {p!r}")
        m = (model or os.environ.get("EXTRACT_MODEL") or DEFAULT_MODEL[p]).strip()
        th = os.environ.get("EXTRACT_THINKING") or None
        gap = float(os.environ.get("EXTRACT_MIN_INTERVAL") or (10 if p == "gemini" else 0))
        return cls(p, m, th, gap)

    def has_key(self) -> bool:
        return bool(os.environ.get(KEY_ENV[self.provider]))


def make_chat_model(cfg: Config):
    """The LangChain chat model for a provider. Raises MissingKey when its key isn't set."""
    if not cfg.has_key():
        raise MissingKey(f"{KEY_ENV[cfg.provider]} is not set; {cfg.provider} extraction can't run.")
    if cfg.provider == "gemini":
        from langchain_google_genai import ChatGoogleGenerativeAI

        kw: dict[str, Any] = {}
        if cfg.thinking:
            kw["thinking_level"] = cfg.thinking
        # Temperature is left unset: for Gemini 3+ LangChain then uses 1.0, as Google advises (lower values
        # can loop or degrade reasoning), and some models (e.g. gemini-3.6-flash) have fixed sampling.
        # max_retries=0: we retry ourselves so every attempt is counted and logged.
        return ChatGoogleGenerativeAI(model=cfg.model, max_retries=0, timeout=300, **kw)
    if cfg.provider == "anthropic":
        from langchain_anthropic import ChatAnthropic

        return ChatAnthropic(model=cfg.model, max_tokens=16000, max_retries=0, timeout=300)
    raise ValueError(cfg.provider)


@dataclass
class CallResult:
    parsed: BaseModel | None
    raw_text: str
    tokens_in: int
    tokens_out: int
    tokens_reasoning: int
    latency_ms: int
    attempts: int
    model_name: str
    parsing_error: str | None = None
    retries: list[str] = field(default_factory=list)  # short reason for each retried attempt


def message_text(msg: Any) -> str:
    """The text of an AIMessage (Gemini 3 and Claude may return a list of content blocks)."""
    c = getattr(msg, "content", "")
    if isinstance(c, str):
        return c
    out = []
    for b in c or []:
        if isinstance(b, str):
            out.append(b)
        elif isinstance(b, dict) and b.get("type") in (None, "text") and isinstance(b.get("text"), str):
            out.append(b["text"])
        elif isinstance(b, dict) and b.get("type") == "tool_use":
            import json

            out.append(json.dumps(b.get("input")))
    return "".join(out)


def usage_of(msg: Any) -> tuple[int, int, int]:
    """(input, output, reasoning) tokens from a message's usage_metadata. Output includes reasoning
    (thinking) tokens, which providers bill as output."""
    u = getattr(msg, "usage_metadata", None) or {}
    ti = int(u.get("input_tokens") or 0)
    to = int(u.get("output_tokens") or 0)
    tr = int((u.get("output_token_details") or {}).get("reasoning") or 0)
    return ti, to, tr


_RATE = re.compile(r"429|RESOURCE_EXHAUSTED|rate.?limit|quota|503|UNAVAILABLE|overloaded|529", re.I)
_RETRY_IN = re.compile(r"retry(?:Delay)?[^0-9]{0,20}(\d+(?:\.\d+)?)\s*s", re.I)


_DAILY = re.compile(r"PerDay|per day|daily", re.I)


def is_daily_quota(e: BaseException) -> bool:
    """A per-day quota won't clear by retrying (Gemini free tier: GenerateRequestsPerDayPerProjectPerModel)."""
    s = f"{e}"
    for attr in ("details", "response_json", "body"):
        s += f" {getattr(e, attr, '')}"
    return bool(_DAILY.search(s))


def is_rate_limit(e: BaseException) -> bool:
    return bool(_RATE.search(f"{type(e).__name__}: {e}"))


def scrub(s: str) -> str:
    """Remove any API key value from a string before it is logged or written."""
    for k in KEY_ENV.values():
        v = os.environ.get(k)
        if v and len(v) > 8:
            s = s.replace(v, "[redacted]")
    return s


def _short(e: BaseException) -> str:
    return scrub(re.sub(r"\s+", " ", str(e))[:300])


def _retry_after(e: BaseException) -> float | None:
    m = _RETRY_IN.search(str(e))
    return float(m.group(1)) if m else None


class Extractor:
    """Structured-output calls with retry, token and latency capture."""

    def __init__(
        self,
        cfg: Config,
        chat_model: Any | None = None,
        sleep: Callable[[float], None] = time.sleep,
        max_attempts: int = 8,
        on_retry: Callable[[str], None] | None = None,
    ):
        self.cfg = cfg
        self.on_retry = on_retry
        self.chat = chat_model if chat_model is not None else make_chat_model(cfg)
        self.sleep = sleep
        self.max_attempts = max_attempts
        self._last_start: float | None = None

    def _pace(self) -> None:
        if self._last_start is not None and self.cfg.min_interval > 0:
            gap = self.cfg.min_interval - (time.monotonic() - self._last_start)
            if gap > 0:
                self.sleep(gap)
        self._last_start = time.monotonic()

    def call(self, schema: type[BaseModel], messages: list[tuple[str, str]]) -> CallResult:
        runnable = self.chat.with_structured_output(schema, method="json_schema", include_raw=True)
        attempts = 0
        spent_in = spent_out = spent_reason = 0
        t_total = 0.0
        last: BaseException | None = None
        retries: list[str] = []
        while attempts < self.max_attempts:
            attempts += 1
            self._pace()
            t0 = time.monotonic()
            try:
                out = runnable.invoke(messages)
            except Exception as e:  # noqa: BLE001 - classify, then retry or raise
                t_total += time.monotonic() - t0
                last = e
                if not is_rate_limit(e):
                    raise
                if is_daily_quota(e):
                    raise ProviderRefused(
                        scrub(f"{self.cfg.provider} daily quota reached for {self.cfg.model} (not retried): {_short(e)}"),
                        attempts=attempts, retries=retries, latency_ms=int(t_total * 1000), daily=True,
                    ) from e
                if attempts >= self.max_attempts:
                    retries.append(f"{type(e).__name__}: {_short(e)} (gave up)")
                    break
                overloaded = bool(re.search(r"503|UNAVAILABLE|overloaded|high demand|529", str(e), re.I))
                # "high demand" 503s last minutes, not seconds: back off harder so retries don't burn a
                # small free-tier daily request quota.
                wait = _retry_after(e) or (min(180.0, 20.0 * 2 ** (attempts - 1)) if overloaded else min(90.0, 5.0 * 2 ** (attempts - 1)))
                retries.append(f"{type(e).__name__}: {_short(e)} (waited {wait:.0f}s)")
                if self.on_retry:
                    self.on_retry(f"attempt {attempts} refused, retrying in {wait:.0f}s: {retries[-1]}")
                self.sleep(wait + random.uniform(0, 1.5))
                continue
            t_total += time.monotonic() - t0
            raw = out.get("raw")
            ti, to, tr = usage_of(raw)
            spent_in += ti
            spent_out += to
            spent_reason += tr
            perr = out.get("parsing_error")
            name = (getattr(raw, "response_metadata", {}) or {}).get("model_name") or (getattr(raw, "response_metadata", {}) or {}).get("model") or self.cfg.model
            return CallResult(
                parsed=out.get("parsed"),
                raw_text=message_text(raw),
                tokens_in=spent_in,
                tokens_out=spent_out,
                tokens_reasoning=spent_reason,
                latency_ms=int(t_total * 1000),
                attempts=attempts,
                model_name=str(name),
                parsing_error=None if perr is None else f"{type(perr).__name__}: {perr}",
                retries=retries,
            )
        raise ProviderRefused(
            scrub(f"{self.cfg.provider} refused {attempts} times (last: {type(last).__name__}: {str(last)[:300]})"),
            attempts=attempts, retries=retries, latency_ms=int(t_total * 1000),
        )
