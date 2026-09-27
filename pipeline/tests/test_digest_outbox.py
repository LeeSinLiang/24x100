"""The digest sender for the outbox scripts/digest.ts builds: Slack Block Kit and an HTML + text email, each only when
its variables are set; never a URL or a credential in what it prints. No network: senders are injected."""
import json

import pytest

from pipeline import digest as D

OUTBOX = {
    "subject": "24×100: 1 watched lot changed",
    "text": "24×100: 1 watched lot changed\n503 Climax St …",
    "html": "<!doctype html><html><body>503 Climax St</body></html>",
    "slack": {"text": "24×100: 1 watched lot changed.", "blocks": [{"type": "header", "text": {"type": "plain_text", "text": "24×100"}}]},
}
SMTP = {"SMTP_HOST": "smtp.test", "SMTP_PORT": "587", "SMTP_USER": "me@test", "SMTP_PASS": "app-password", "DIGEST_TO": "me@test"}


def test_sends_block_kit_and_html_email_only_where_configured():
    posts, mails = [], []
    sent = D.send_outbox(OUTBOX, env={"SLACK_WEBHOOK_URL": "https://hooks.test/T/B/x", **SMTP},
                         post=lambda url, p: posts.append((url, p)), mail=lambda env, s, t, h: mails.append((s, t, h)))
    assert sent == ["slack", "email (SMTP)"]
    assert posts[0][1]["blocks"] == OUTBOX["slack"]["blocks"] and posts[0][1]["text"] == OUTBOX["slack"]["text"]
    assert mails == [(OUTBOX["subject"], OUTBOX["text"], OUTBOX["html"])]
    # Slack alone.
    assert D.send_outbox(OUTBOX, env={"SLACK_WEBHOOK_URL": "https://hooks.test/x"}, post=lambda u, p: None) == ["slack"]


def test_refuses_without_credentials():
    with pytest.raises(D.Refused):
        D.send_outbox(OUTBOX, env={}, post=lambda u, p: None, mail=lambda *a: None)


def test_a_failed_send_never_prints_the_webhook_url(tmp_path, monkeypatch, capsys):
    from pipeline import __main__ as M

    secret = "https://hooks.slack.com/services/T000/B000/SECRETSECRET"
    box = tmp_path / "outbox.json"
    box.write_text(json.dumps(OUTBOX))
    monkeypatch.setenv("SLACK_WEBHOOK_URL", secret)
    for k in (*SMTP, "RESEND_API_KEY", "DIGEST_FROM"):  # empty, not unset: main() loads .env, which never overrides
        monkeypatch.setenv(k, "")
    monkeypatch.setattr(D, "_send_smtp_html", lambda *a: pytest.fail("network call"))
    monkeypatch.setattr(D, "_send_resend", lambda *a: pytest.fail("network call"))

    def boom(url, payload):
        raise ConnectionError(f"Max retries exceeded with url: {url}")

    monkeypatch.setattr(D, "_post_slack", boom)
    rc = M.main(["digest", "--send", "--outbox", str(box)])
    out = capsys.readouterr()
    assert rc == 3
    assert "SECRET" not in out.out + out.err and "hooks.slack.com" not in out.out + out.err
    assert "ConnectionError" in out.err


RESEND = {"RESEND_API_KEY": "re_TESTKEY_never_shown", "DIGEST_TO": "owner@test"}


def test_resend_wins_over_smtp_and_sends_the_same_html_and_text():
    via_resend, via_smtp = [], []
    sent = D.send_outbox(OUTBOX, env={**SMTP, **RESEND}, mail=lambda *a: via_smtp.append(a),
                         resend=lambda env, s, t, h: via_resend.append((s, t, h)))
    assert sent == ["email (Resend)"] and not via_smtp
    assert via_resend == [(OUTBOX["subject"], OUTBOX["text"], OUTBOX["html"])]
    # SMTP is the fallback only when no Resend key is set; a key without DIGEST_TO sends nothing by Resend.
    assert D.send_outbox(OUTBOX, env=SMTP, mail=lambda *a: None, resend=lambda *a: pytest.fail("resend")) == ["email (SMTP)"]
    with pytest.raises(D.Refused):
        D.send_outbox(OUTBOX, env={"RESEND_API_KEY": "re_x"}, resend=lambda *a: pytest.fail("resend"))


class _Reply:
    def __init__(self, status, body):
        self.status_code, self._body = status, body

    def json(self):
        return self._body


def test_resend_request_is_the_documented_api_call(monkeypatch):
    import requests

    calls = []
    monkeypatch.setattr(requests, "post", lambda url, **kw: calls.append((url, kw)) or _Reply(200, {"id": "x"}))
    D._send_resend(RESEND, OUTBOX["subject"], OUTBOX["text"], OUTBOX["html"])
    url, kw = calls[0]
    assert url == "https://api.resend.com/emails"
    assert kw["headers"] == {"Authorization": "Bearer re_TESTKEY_never_shown"}
    assert kw["json"] == {"from": "24×100 <onboarding@resend.dev>", "to": ["owner@test"], "subject": OUTBOX["subject"],
                          "text": OUTBOX["text"], "html": OUTBOX["html"]}
    D._send_resend({**RESEND, "DIGEST_FROM": "Digest <d@verified.test>"}, "s", "t", None)
    assert calls[1][1]["json"]["from"] == "Digest <d@verified.test>" and "html" not in calls[1][1]["json"]


def test_a_refused_resend_send_reports_status_and_error_name_only(tmp_path, monkeypatch, capsys):
    import requests

    from pipeline import __main__ as M

    box = tmp_path / "outbox.json"
    box.write_text(json.dumps(OUTBOX))
    for k in ("SLACK_WEBHOOK_URL", "DIGEST_FROM", *SMTP):  # empty, not unset: main() loads .env, which never overrides
        monkeypatch.setenv(k, "")
    for k, v in RESEND.items():
        monkeypatch.setenv(k, v)
    monkeypatch.setattr(D, "_send_smtp_html", lambda *a: pytest.fail("network call"))
    body = {"statusCode": 403, "name": "validation_error",
            "message": "You can only send testing emails to your own email address (owner@test)."}
    monkeypatch.setattr(requests, "post", lambda url, **kw: _Reply(403, body))
    rc = M.main(["digest", "--send", "--outbox", str(box)])
    out = capsys.readouterr()
    said = out.out + out.err
    assert rc == 3
    assert "Resend answered HTTP 403 (validation_error)" in out.err
    assert "re_TESTKEY" not in said and "owner@test" not in said and "testing emails" not in said
