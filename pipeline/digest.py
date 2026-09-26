"""Watchlist digest: a plain message from data/refresh/latest.json + data/watchlist.json.

Off by default. --dry-run writes data/refresh/digest-preview.md and prints it. --send posts to a
Slack incoming webhook (SLACK_WEBHOOK_URL) or sends mail over SMTP (SMTP_HOST, SMTP_PORT,
SMTP_USER, SMTP_PASS, DIGEST_TO) only when those are set; otherwise it refuses. It never sends an
inquiry, and it carries no personal data: lot addresses, statuses and rule ids only (reviews are
summarized by role, never by name).
"""
from __future__ import annotations

import datetime as dt
import json
import os
from pathlib import Path
from typing import Any, Callable

from .fetch import REPO

LATEST = REPO / "data" / "refresh" / "latest.json"
WATCHLIST = REPO / "data" / "watchlist.json"
REVIEWS = REPO / "data" / "rules" / "reviews.json"
PREVIEW = REPO / "data" / "refresh" / "digest-preview.md"
SIGNED = {"source_checked", "city_confirmed"}


class Refused(RuntimeError):
    pass


def _load(p: Path) -> Any:
    return json.loads(p.read_text()) if p.exists() else None


def _fmt(v: Any) -> str:
    if v is None:
        return "none"
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    if isinstance(v, int) and abs(v) >= 1000:
        return f"{v:,}"
    return str(v)


def render(latest: dict, watchlist: dict, reviews: list | None) -> str:
    run_at = latest["meta"]["run_at"]
    watched = {}
    for w in watchlist.get("watch", []):
        for pin in w.get("pins", []):
            watched[pin] = w.get("block")
    changes = latest.get("changes", [])
    mine = [c for c in changes if c.get("pin") in watched]
    status = [c for c in mine if c["field"] == "city.status"]
    other = [c for c in mine if c["field"] != "city.status"]
    city_status = sum(1 for c in changes if c["field"] == "city.status" and c.get("pin") not in watched)

    lines = [f"# 24x100 watchlist digest", "",
             f"Data pulled {latest['meta']['to']} (previous pull {latest['meta']['from']}); refresh run {run_at}.",
             f"Watching {len(watched)} lots: {', '.join(w['label'] for w in watchlist.get('watch', []))}.", ""]
    lines.append("## Lots that changed City status")
    if status:
        for c in status:
            lines.append(f"- {c['addr'] or c['pin']} ({c['pin']}): {_fmt(c['before'])} -> {_fmt(c['after'])}")
    else:
        lines.append("- None of the watched lots changed City status.")
    if city_status:
        lines.append(f"- Elsewhere in the city, {city_status} City-owned lot(s) changed status.")
    lines += ["", "## New pencil differences on watched lots (not reviewed by a person)"]
    if other:
        for c in other:
            what = {"added": "appeared", "removed": "disappeared"}.get(c["kind"])
            if what:
                lines.append(f"- {c['addr'] or c['pin']} ({c['pin']}): {what} in {c['scope']} data")
            else:
                lines.append(f"- {c['addr'] or c['pin']} ({c['pin']}): {c['field']} {_fmt(c['before'])} -> {_fmt(c['after'])}")
    else:
        lines.append("- No record changed on the watched lots.")
    lines += ["", "## Newly signed rules"]
    if reviews is None:
        lines.append("- No review log exported yet (data/rules/reviews.json not found).")
    else:
        end = dt.datetime.fromisoformat(run_at.replace("Z", "+00:00"))
        start = end - dt.timedelta(days=7)
        signed = []
        for r in reviews:
            try:
                at = dt.datetime.fromisoformat(str(r.get("at", "")).replace("Z", "+00:00"))
            except ValueError:
                continue
            if at.tzinfo is None:
                at = at.replace(tzinfo=dt.timezone.utc)
            if r.get("action") in SIGNED and start <= at <= end:
                signed.append(r)
        if signed:
            for r in sorted(signed, key=lambda r: r["at"]):
                label = "checked against the code text" if r["action"] == "source_checked" else "confirmed by the City"
                target = r.get("rule_id") or r.get("question_id")
                lines.append(f"- {target}: {label} ({r.get('role') or 'reviewer'}, {str(r['at'])[:10]})")
        else:
            lines.append("- No rule was checked or confirmed in the 7 days before this refresh.")
    lines += ["", f"Summary: {latest.get('summary', '')}", "",
              "This digest reports public-record changes only. It does not send inquiries."]
    return "\n".join(lines) + "\n"


def build(latest_path: Path = LATEST, watchlist_path: Path = WATCHLIST, reviews_path: Path = REVIEWS) -> str:
    latest = _load(latest_path)
    if latest is None:
        raise Refused(f"{latest_path} not found; run `python -m pipeline refresh` first")
    watchlist = _load(watchlist_path) or {"watch": []}
    reviews = _load(reviews_path)
    if isinstance(reviews, dict):
        reviews = reviews.get("entries") or reviews.get("reviews") or []
    return render(latest, watchlist, reviews)


def channels(env: dict[str, str]) -> list[str]:
    out = []
    if env.get("SLACK_WEBHOOK_URL"):
        out.append("slack")
    if all(env.get(k) for k in ("SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "DIGEST_TO")):
        out.append("smtp")
    return out


def send(text: str, env: dict[str, str] | None = None, post: Callable[[str, dict], None] | None = None,
         mail: Callable[[dict, str], None] | None = None) -> list[str]:
    env = dict(os.environ if env is None else env)
    ch = channels(env)
    if not ch:
        raise Refused("digest --send refused: set SLACK_WEBHOOK_URL, or SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS "
                      "and DIGEST_TO in .env. Nothing was sent. Use --dry-run to preview.")
    sent = []
    if "slack" in ch:
        (post or _post_slack)(env["SLACK_WEBHOOK_URL"], {"text": text})
        sent.append("slack")
    if "smtp" in ch:
        (mail or _send_smtp)(env, text)
        sent.append("smtp")
    return sent


def _post_slack(url: str, payload: dict) -> None:
    import requests

    r = requests.post(url, json=payload, timeout=30)
    if r.status_code >= 300:
        raise RuntimeError(f"Slack webhook answered HTTP {r.status_code}")


def _send_smtp(env: dict, text: str) -> None:
    import smtplib
    from email.message import EmailMessage

    msg = EmailMessage()
    msg["Subject"] = "24x100 watchlist digest"
    msg["From"] = env["SMTP_USER"]
    msg["To"] = env["DIGEST_TO"]
    msg.set_content(text)
    with smtplib.SMTP(env["SMTP_HOST"], int(env["SMTP_PORT"]), timeout=30) as s:
        s.starttls()
        s.login(env["SMTP_USER"], env["SMTP_PASS"])
        s.send_message(msg)


def default_watchlist() -> dict:
    from .block import OUT_DIR

    watch = []
    b10 = _load(OUT_DIR / "10K.json")
    if b10:
        pins = sorted(p["pin"] for p in b10["parcels"] if 21 <= p["lot"] <= 35)
        watch.append({"block": "10K", "label": "Block 10-K lots 21-35 (Mahon St)", "pins": pins})
    b124 = _load(OUT_DIR / "0124P.json")
    if b124:
        watch.append({"block": "0124P", "label": "held-out block 0124-P (Lowell St, Larimer)",
                      "pins": sorted(p["pin"] for p in b124["parcels"])})
    return {"meta": {"note": "Lots the digest reports on. PINs only; edit freely.", "version": 1}, "watch": watch}
