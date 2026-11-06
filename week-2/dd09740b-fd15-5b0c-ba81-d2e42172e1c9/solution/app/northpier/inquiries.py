"""Sending an inquiry: key claim, form check, the hourly limit and the confirmation email, in one transaction."""
import datetime as dt
import json
import math
import secrets
from typing import Any

from northpier import db, outbox
from northpier.bodies import canonical_json
from northpier.config import SETTINGS
from northpier.domain import validate_inquiry
from northpier.errors import Refusal
from northpier.records import INQUIRY_COLUMNS

REFERENCE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
FLOOD_LIMIT = 5


def new_key() -> str:
    """An Idempotency-Key for a composer form that has no script to make one."""
    return secrets.token_urlsafe(18)


def _flood_retry_after(tx: db.Tx, email: str, now: dt.datetime) -> int | None:
    """Seconds until the oldest counted inquiry leaves the window when the email already has five, else None."""
    window = dt.timedelta(seconds=SETTINGS.flood_window)
    counted = tx.rows("SELECT created_at FROM inquiries WHERE lower(email) = :email AND created_at > :since "
                      "ORDER BY created_at", email=email, since=now - window)
    if len(counted) < FLOOD_LIMIT:
        return None
    oldest = counted[len(counted) - FLOOD_LIMIT]["created_at"]
    return max(1, math.ceil((oldest + window - now).total_seconds()))


def _mint_reference() -> str:
    return "NP-" + "".join(secrets.choice(REFERENCE_ALPHABET) for _ in range(6))


def submit(body: dict[str, Any], key: str | None) -> tuple[int, dict[str, Any]]:
    """Store a valid inquiry as new at version 1 with its confirmation email; a keyed replay answers 200."""
    request_body = canonical_json(body)
    with db.transaction() as tx:
        if key is not None:
            tx.lock(f"inquiry-key:{key}")
            now = tx.clock()
            stored = tx.one("SELECT request_body, response_body, created_at FROM idempotency_keys WHERE key = :key",
                            key=key)
            if stored and stored["created_at"] > now - dt.timedelta(seconds=SETTINGS.idempotency_ttl):
                if stored["request_body"] != request_body:
                    raise Refusal("inquiry_key")
                return 200, json.loads(stored["response_body"])
            tx.run("DELETE FROM idempotency_keys WHERE key = :key", key=key)
        fields = validate_inquiry(body)
        tx.lock(f"inquiry-email:{fields.email}")
        now = tx.clock()
        retry_after = _flood_retry_after(tx, fields.email, now)
        if retry_after is not None:
            raise Refusal("flood", retry_after=retry_after)
        inquiry = None
        while inquiry is None:  # a reference collision inserts nothing and mints again
            inquiry = tx.one(
                f"INSERT INTO inquiries (reference, status_token, name, email, company, services, budget, timeline, "
                f"message, status, version, created_at, updated_at) VALUES (:reference, :token, :name, :email, "
                f":company, :services, :budget, :timeline, :message, 'new', 1, :now, :now) "
                f"ON CONFLICT (reference) DO NOTHING RETURNING {INQUIRY_COLUMNS}",
                reference=_mint_reference(), token=secrets.token_urlsafe(24), name=fields.name, email=fields.email,
                company=fields.company, services=fields.services, budget=fields.budget, timeline=fields.timeline,
                message=fields.message, now=now)
        tx.run("INSERT INTO status_events (inquiry_id, to_status, created_at) VALUES (:id, 'new', :now)",
               id=inquiry["id"], now=now)
        outbox.enqueue_confirmation(tx, inquiry, now)
        response = {"reference": inquiry["reference"], "status": "new", "status_token": inquiry["status_token"],
                    "status_url": outbox.status_url(inquiry["status_token"])}
        if key is not None:
            tx.run("INSERT INTO idempotency_keys (key, request_body, response_body, inquiry_id, created_at) "
                   "VALUES (:key, :request, :response, :id, :now)", key=key, request=request_body,
                   response=json.dumps(response), id=inquiry["id"], now=now)
    outbox.wake()
    return 201, response
