"""The provider switch, token capture and retry logic, without network."""

import pytest
from langchain_core.messages import AIMessage

from extract import llm
from extract.llm import Config, Extractor, MissingKey, ProviderRefused, make_chat_model, message_text, usage_of
from extract.schema import ExtractionOut, ProposedRule


@pytest.fixture
def no_keys(monkeypatch):
    monkeypatch.setattr(llm, "load_env", lambda: None)
    for k in ("GOOGLE_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY", "EXTRACT_PROVIDER", "EXTRACT_MODEL", "EXTRACT_THINKING"):
        monkeypatch.delenv(k, raising=False)
    return monkeypatch


def test_provider_switch_is_config(no_keys):
    assert Config.from_env().provider == "gemini"
    assert Config.from_env().model == llm.DEFAULT_MODEL["gemini"]
    no_keys.setenv("EXTRACT_PROVIDER", "anthropic")
    c = Config.from_env()
    assert (c.provider, c.model) == ("anthropic", llm.DEFAULT_MODEL["anthropic"])
    no_keys.setenv("EXTRACT_MODEL", "claude-x")
    assert Config.from_env().model == "claude-x"
    assert Config.from_env("gemini", "gemini-y").model == "gemini-y"
    with pytest.raises(ValueError):
        Config.from_env("openai")


def test_missing_key_stops(no_keys):
    for p in ("gemini", "anthropic"):
        with pytest.raises(MissingKey):
            make_chat_model(Config(p, llm.DEFAULT_MODEL[p]))


def test_both_providers_build_structured_output_without_network(no_keys):
    no_keys.setenv("GOOGLE_API_KEY", "test-not-a-real-key")
    no_keys.setenv("ANTHROPIC_API_KEY", "test-not-a-real-key")
    from langchain_anthropic import ChatAnthropic
    from langchain_google_genai import ChatGoogleGenerativeAI

    g = make_chat_model(Config("gemini", "gemini-3.8-flash"))
    a = make_chat_model(Config("anthropic", "claude-opus-5-5"))
    assert isinstance(g, ChatGoogleGenerativeAI) and isinstance(a, ChatAnthropic)
    for m in (g, a):
        m.with_structured_output(ExtractionOut, method="json_schema", include_raw=True)


def test_usage_and_text_from_messages():
    m = AIMessage(
        content=[{"type": "text", "text": '{"rules": []}'}],
        usage_metadata={"input_tokens": 100, "output_tokens": 50, "total_tokens": 150, "output_token_details": {"reasoning": 30}},
    )
    assert usage_of(m) == (100, 50, 30)
    assert message_text(m) == '{"rules": []}'
    assert usage_of(AIMessage(content="x")) == (0, 0, 0)


class RateLimited(Exception):
    pass


class FakeChat:
    """Stands in for a LangChain chat model: with_structured_output(...).invoke(...)."""

    def __init__(self, script):
        self.script = list(script)
        self.calls = 0

    def with_structured_output(self, schema, method=None, include_raw=False):
        assert method == "json_schema" and include_raw is True
        return self

    def invoke(self, messages):
        self.calls += 1
        step = self.script.pop(0)
        if isinstance(step, Exception):
            raise step
        return step


def _ok(n_in=10, n_out=20):
    rule = ProposedRule(field="front_setback", value_number=25, unit="ft", applies_to=["*"], section="903.03.C", quote="q", ambiguous=False)
    raw = AIMessage(content='{"rules": [...]}', usage_metadata={"input_tokens": n_in, "output_tokens": n_out, "total_tokens": n_in + n_out},
                    response_metadata={"model_name": "gemini-3.8-flash"})
    return {"raw": raw, "parsed": ExtractionOut(rules=[rule]), "parsing_error": None}


def test_retries_rate_limits_then_returns_real_counts():
    fake = FakeChat([RateLimited("429 RESOURCE_EXHAUSTED. Please retry in 2s."), RateLimited("503 UNAVAILABLE"), _ok(11, 22)])
    waits = []
    ex = Extractor(Config("gemini", "gemini-3.8-flash"), chat_model=fake, sleep=waits.append)
    r = ex.call(ExtractionOut, [("human", "x")])
    assert r.attempts == 3 and len(r.retries) == 2 and len(waits) == 2
    assert 2 <= waits[0] < 4  # honoured the server's "retry in 2s"
    assert (r.tokens_in, r.tokens_out) == (11, 22)
    assert r.model_name == "gemini-3.8-flash" and r.parsed.rules[0].field == "front_setback"


def test_gives_up_and_never_fabricates():
    fake = FakeChat([RateLimited("429 quota exceeded")] * 3)
    ex = Extractor(Config("gemini", "m"), chat_model=fake, sleep=lambda s: None, max_attempts=3)
    with pytest.raises(ProviderRefused):
        ex.call(ExtractionOut, [("human", "x")])
    assert fake.calls == 3


def test_daily_quota_is_not_retried():
    daily = RateLimited("429 RESOURCE_EXHAUSTED. {'error': {'details': [{'quotaId': 'GenerateRequestsPerDayPerProjectPerModel-FreeTier', 'quotaValue': '20'}]}}")
    fake = FakeChat([daily, _ok()])
    ex = Extractor(Config("gemini", "m"), chat_model=fake, sleep=lambda s: None)
    with pytest.raises(ProviderRefused, match="daily quota"):
        ex.call(ExtractionOut, [("human", "x")])
    assert fake.calls == 1


def test_other_errors_are_not_retried():
    fake = FakeChat([ValueError("bad request: schema"), _ok()])
    ex = Extractor(Config("gemini", "m"), chat_model=fake, sleep=lambda s: None)
    with pytest.raises(ValueError):
        ex.call(ExtractionOut, [("human", "x")])
    assert fake.calls == 1


def test_scrub_removes_keys(monkeypatch):
    monkeypatch.setenv("GOOGLE_API_KEY", "AIzaSECRETSECRETSECRET")
    assert "SECRET" not in llm.scrub("url?key=AIzaSECRETSECRETSECRET failed")
