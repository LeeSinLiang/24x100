"""Digest: dry run renders; --send refuses without keys; no network in tests."""
import json

import pytest

from pipeline import digest as D

LATEST = {
    "meta": {"run_at": "2026-09-26T21:00:00Z", "from": "2026-09-26", "to": "2026-09-26T2100", "datasets": []},
    "changes": [
        {"pin": "0010K00025000000", "addr": "2241 Mahon St", "block": "10K", "scope": "block", "field": "city.status",
         "before": "Available for Sale", "after": "Sale Pending", "kind": "changed"},
        {"pin": "0010K00022000000", "addr": "2247 Humber Way", "block": "10K", "scope": "block", "field": "assess.lotarea",
         "before": 1200, "after": 2400, "kind": "changed"},
        {"pin": "0999X00001000000", "addr": "1 Elsewhere St", "block": None, "scope": "city", "field": "city.status",
         "before": "Hold for Study", "after": "Available for Sale", "kind": "changed"},
    ],
    "code": [],
    "summary": "3 processed value(s) changed.",
}
WATCH = {"watch": [{"block": "10K", "label": "Block 10-K lots 21-35", "pins": ["0010K00025000000", "0010K00022000000"]}]}
REVIEWS = {"entries": [
    {"id": "a1", "rule_id": "rm-m.front", "question_id": None, "at": "2026-09-26T18:00:00Z", "reviewer": "Jane Doe",
     "role": "Housing lead", "action": "source_checked", "quote": "q", "decision": "d", "reason": "r", "choice": None,
     "reference": None},
    {"id": "a2", "rule_id": "rm-m.rear", "question_id": None, "at": "2026-08-01T18:00:00Z", "reviewer": "Jane Doe",
     "role": "Housing lead", "action": "source_checked", "quote": "q", "decision": "d", "reason": "r", "choice": None,
     "reference": None},
]}


@pytest.fixture
def files(tmp_path):
    lp, wp, rp = tmp_path / "latest.json", tmp_path / "watch.json", tmp_path / "reviews.json"
    lp.write_text(json.dumps(LATEST))
    wp.write_text(json.dumps(WATCH))
    rp.write_text(json.dumps(REVIEWS))
    return lp, wp, rp


def test_dry_run_renders(files):
    text = D.build(*files)
    assert "2241 Mahon St (0010K00025000000): Available for Sale -> Sale Pending" in text
    assert "assess.lotarea 1,200 -> 2,400" in text
    assert "Elsewhere in the city, 1 City-owned lot(s) changed status." in text
    assert "rm-m.front: checked against the code text (Housing lead, 2026-09-26)" in text
    assert "rm-m.rear" not in text  # older than 7 days
    assert "Jane Doe" not in text  # no personal names
    assert "does not send inquiries" in text


def test_dry_run_without_reviews(files, tmp_path):
    lp, wp, _ = files
    text = D.build(lp, wp, tmp_path / "missing.json")
    assert "No review log exported yet" in text


def test_send_refuses_without_keys():
    with pytest.raises(D.Refused, match="Nothing was sent"):
        D.send("hello", env={})
    with pytest.raises(D.Refused):
        D.send("hello", env={"SMTP_HOST": "x"})  # incomplete SMTP settings


def test_send_uses_injected_transport_only_when_configured():
    calls = []
    sent = D.send("hello", env={"SLACK_WEBHOOK_URL": "https://example.invalid/hook"},
                  post=lambda url, payload: calls.append((url, payload)))
    assert sent == ["slack"] and calls == [("https://example.invalid/hook", {"text": "hello"})]


def test_cli_send_refuses_without_keys(monkeypatch, capsys):
    from pipeline.__main__ import main

    for k in ("SLACK_WEBHOOK_URL", "SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "DIGEST_TO"):
        monkeypatch.setenv(k, "")
    monkeypatch.setattr(D, "_post_slack", lambda *a: pytest.fail("network call"))
    monkeypatch.setattr(D, "_send_smtp", lambda *a: pytest.fail("network call"))
    if not D.LATEST.exists():
        pytest.skip("no data/refresh/latest.json yet")
    assert main(["digest", "--send"]) == 2
    assert "refused" in capsys.readouterr().err
