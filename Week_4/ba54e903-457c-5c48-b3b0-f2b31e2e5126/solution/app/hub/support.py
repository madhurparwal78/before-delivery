"""Support tickets: at most three per email address in any SUPPORT_WINDOW_SECONDS, decided in the database."""

from __future__ import annotations

import math
from typing import Any

from flask import g

from . import config, db, mail
from .accounts import valid_email
from .errors import invalid, retry_after, ApiError
from .router import route

LIMIT = 3
CATEGORIES = ("account", "billing", "safety", "other")


def _check_window(cur: Any, email: str) -> None:
    """Refuse (429) when the address already has three tickets inside the window; counts nothing itself."""
    db.advisory(cur, "support:" + email)
    cur.execute(
        "SELECT count(*) AS n, min(created_at) + make_interval(secs => %s) - clock_timestamp() AS wait FROM ("
        "  SELECT created_at FROM support_tickets WHERE lower(email) = %s "
        "  AND created_at > clock_timestamp() - make_interval(secs => %s) ORDER BY created_at DESC LIMIT %s"
        ") recent", (config.SUPPORT_WINDOW_SECONDS, email, config.SUPPORT_WINDOW_SECONDS, LIMIT))
    recent = cur.fetchone()
    if recent["n"] >= LIMIT:
        seconds = math.ceil(recent["wait"].total_seconds())
        raise ApiError("rate_limited", headers=retry_after(min(seconds, config.SUPPORT_WINDOW_SECONDS)))


@route("POST", "/api/support/tickets", body="json")
def create_ticket() -> tuple[dict[str, Any], int]:
    raw_email = g.body.raw("email")
    with db.tx() as cur:
        if isinstance(raw_email, str) and "\x00" not in raw_email:
            _check_window(cur, raw_email.lower())
        email = g.body.string("email")
        if not valid_email(email):
            raise invalid("email")
        category = g.body.string("category", "")
        if category not in CATEGORIES:
            raise invalid("category")
        subject = g.body.string("subject", strip=True, min_length=3, max_length=120)
        body = g.body.string("body", strip=True, min_length=10, max_length=5000)
        cur.execute("INSERT INTO support_tickets (email, category, subject, body) VALUES (%s, %s, %s, %s) RETURNING id",
                    (email, category, subject, body))
        ticket_id = cur.fetchone()["id"]
        reference = f"HUB-{ticket_id:06d}"
        cur.execute("UPDATE support_tickets SET reference = %s WHERE id = %s", (reference, ticket_id))
        mail.enqueue(cur, to=email.lower(), name=None, subject=f"We received your request {reference}",
                     body=f"Thank you for contacting Community Hub support.\nYour reference is {reference}.\n")
    return {"id": ticket_id, "reference": reference, "status": "open"}, 201
