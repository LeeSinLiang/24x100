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
    assert sent == ["slack", "email"]
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
    for k in SMTP:  # empty, not unset: main() loads .env, which never overrides a variable already set
        monkeypatch.setenv(k, "")
    monkeypatch.setattr(D, "_send_smtp_html", lambda *a: pytest.fail("network call"))

    def boom(url, payload):
        raise ConnectionError(f"Max retries exceeded with url: {url}")

    monkeypatch.setattr(D, "_post_slack", boom)
    rc = M.main(["digest", "--send", "--outbox", str(box)])
    out = capsys.readouterr()
    assert rc == 3
    assert "SECRET" not in out.out + out.err and "hooks.slack.com" not in out.out + out.err
    assert "ConnectionError" in out.err
