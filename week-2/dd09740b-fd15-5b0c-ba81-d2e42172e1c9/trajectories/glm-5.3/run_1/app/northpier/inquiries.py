"""Inquiry storage, transitions, notes, queue reads and the seeding."""
from __future__ import annotations

import datetime as dt
import json
import secrets
from typing import Any

import psycopg
from psycopg.rows import dict_row
from psycopg.types.json import Json

from . import emails, rules
from .config import CONFIG
from .labels import (
    BUDGETS, DECLINE_REASONS, SERVICES, STATUS_LABELS, TIMELINES,
)

STUDIO_STATUSES = ("new", "in_review", "call_booked", "won", "declined")

REF_ALPHABET = rules.REFERENCE_ALPHABET
TOKEN_ALPHABET = rules.TOKEN_ALPHABET


def utc_now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def iso(moment) -> str:
    return moment.astimezone(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def iso_or_none(moment) -> str | None:
    return iso(moment) if moment is not None else None


def mint_reference() -> str:
    return "NP-" + "".join(secrets.choice(REF_ALPHABET) for _ in range(6))


def mint_status_token() -> str:
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(26))


def mint_session_token() -> str:
    return "".join(secrets.choice(TOKEN_ALPHABET) for _ in range(40))


# ---------------------------------------------------------------- validation


class FieldRefusal(Exception):
    def __init__(self, field: str, status: int, message: str):
        super().__init__(message)
        self.field = field
        self.status = status
        self.message = message


def validate_inquiry(data: dict) -> dict:
    """Validate in form order, raising FieldRefusal on the first failing field."""
    fields = ("name", "email", "company", "services", "budget", "timeline", "message")
    for field in fields:
        if field not in data:
            if field == "company":
                continue
            raise _missing_refusal(field)
    checked: dict[str, Any] = {}

    name = data["name"]
    if not isinstance(name, str):
        raise _field("name", 422, "Name is required.")
    if rules.has_unsupported_character(name, False):
        raise _field("name", 422, "Remove the unsupported characters.")
    name = name.strip()
    if not name:
        raise _field("name", 422, "Name is required.")
    if len(name) > 80:
        raise _field("name", 422, "Name must be 80 characters or fewer.")
    checked["name"] = name

    email = data["email"]
    if not isinstance(email, str):
        raise _field("email", 422, "Enter a valid email address.")
    if rules.has_unsupported_character(email, False):
        raise _field("email", 422, "Remove the unsupported characters.")
    email = email.strip()
    if not rules.valid_email(email):
        raise _field("email", 422, "Enter a valid email address.")
    checked["email"] = email.lower()

    if "company" in data and data["company"] is not None:
        company = data["company"]
        if not isinstance(company, str):
            raise _field("company", 422, "Company must be 120 characters or fewer.")
        if rules.has_unsupported_character(company, False):
            raise _field("company", 422, "Remove the unsupported characters.")
        company = company.strip()
        if len(company) > 120:
            raise _field("company", 422, "Company must be 120 characters or fewer.")
        checked["company"] = company or None
    else:
        checked["company"] = None

    services = data["services"]
    if not isinstance(services, list) or not services:
        raise _field("services", 422, "Choose at least one service.")
    for item in services:
        if not isinstance(item, str) or item not in SERVICES:
            raise _field("services", 422, "Choose at least one service.")
    if len(set(services)) != len(services):
        raise _field("services", 422, "Choose at least one service.")
    checked["services"] = list(dict.fromkeys(services))

    budget = data["budget"]
    if not isinstance(budget, str) or budget not in BUDGETS:
        raise _field("budget", 422, "Choose a budget.")
    checked["budget"] = budget

    timeline = data["timeline"]
    if not isinstance(timeline, str) or timeline not in TIMELINES:
        raise _field("timeline", 422, "Choose a timeline.")
    checked["timeline"] = timeline

    message = data["message"]
    if not isinstance(message, str):
        raise _field("message", 422, "Tell us a little more: at least 20 characters.")
    if rules.has_unsupported_character(message, True):
        raise _field("message", 422, "Remove the unsupported characters.")
    message = rules.normalise_newlines(message)
    trimmed = message.strip()
    if len(trimmed) < 20:
        raise _field("message", 422, "Tell us a little more: at least 20 characters.")
    if len(trimmed) > 2000:
        raise _field("message", 422, "Message must be 2000 characters or fewer.")
    checked["message"] = trimmed
    return checked


def _field(field: str, status: int, message: str) -> FieldRefusal:
    return FieldRefusal(field, status, message)


def _missing_refusal(field: str) -> FieldRefusal:
    messages = {
        "name": "Name is required.",
        "email": "Enter a valid email address.",
        "services": "Choose at least one service.",
        "budget": "Choose a budget.",
        "timeline": "Choose a timeline.",
        "message": "Tell us a little more: at least 20 characters.",
    }
    return FieldRefusal(field, 422, messages[field])


# ---------------------------------------------------------------- creation


def store_inquiry(conn, checked: dict, status_token: str | None = None) -> dict:
    now = utc_now()
    reference = mint_reference()
    while True:
        try:
            with conn.transaction():
                row = conn.execute(
                    """
                    INSERT INTO inquiries
                        (reference, name, email, company, services, budget, timeline, message,
                         status, version, status_token, created_at, updated_at)
                    VALUES (%(reference)s, %(name)s, %(email)s, %(company)s, %(services_json)s,
                            %(budget)s, %(timeline)s, %(message)s, 'new', 1, %(status_token)s,
                            %(now)s, %(now)s)
                    RETURNING id
                    """,
                    {
                        "reference": reference,
                        "name": checked["name"],
                        "email": checked["email"],
                        "company": checked["company"],
                        "services_json": Json(checked["services"]),
                        "budget": checked["budget"],
                        "timeline": checked["timeline"],
                        "message": checked["message"],
                        "status_token": status_token or mint_status_token(),
                        "now": now,
                    },
                ).fetchone()
                conn.execute(
                    """
                    INSERT INTO status_events
                        (inquiry_id, action, from_status, to_status, call_at, decline_reason, actor_id, created_at)
                    VALUES (%(inquiry_id)s, NULL, NULL, 'new', NULL, NULL, NULL, %(now)s)
                    """,
                    {"inquiry_id": row["id"], "now": now},
                )
                inquiry = inquiry_row(conn, row["id"])
                email = emails.confirmation_email(inquiry)
                outbox_insert(conn, row["id"], email)
            return inquiry
        except psycopg.errors.UniqueViolation as exc:
            if exc.constraint_name and "reference" in exc.constraint_name:
                reference = mint_reference()
                continue
            if exc.constraint_name and "status_token" in exc.constraint_name:
                status_token = mint_status_token()
                continue
            raise


def outbox_insert(conn, inquiry_id: int, email: dict) -> int:
    row = conn.execute(
        """
        INSERT INTO outbox (inquiry_id, to_address, subject, body, calendar, calendar_method, created_at)
        VALUES (%(i)s, %(to)s, %(subject)s, %(body)s, %(calendar)s, %(method)s, now())
        RETURNING id
        """,
        {
            "i": inquiry_id,
            "to": email["to_address"],
            "subject": email["subject"],
            "body": email["body"],
            "calendar": email["calendar"],
            "method": email["calendar_method"],
        },
    ).fetchone()
    return row["id"]


def inquiry_row(conn, inquiry_id: int) -> dict:
    return conn.execute("SELECT * FROM inquiries WHERE id = %(i)s", {"i": inquiry_id}).fetchone()


def hourly_count(conn, email: str) -> tuple[int, Any]:
    row = conn.execute(
        """
        SELECT COUNT(*) AS n, MIN(created_at) AS oldest
        FROM inquiries
        WHERE lower(email) = lower(%(e)s)
          AND created_at >= now() - (%(w)s || ' seconds')::interval
        """,
        {"e": email, "w": CONFIG.flood_window_seconds},
    ).fetchone()
    return row["n"], row["oldest"]


def retry_after_seconds(oldest) -> int:
    if oldest is None:
        return 1
    gone = (utc_now() - oldest.astimezone(dt.timezone.utc)).total_seconds()
    remaining = CONFIG.flood_window_seconds - gone
    return max(1, int(remaining) + (1 if remaining > int(remaining) else 0))


# ---------------------------------------------------------------- serialisers


def studio_inquiry(row: dict, include_message: bool = True) -> dict:
    data = {
        "id": row["id"],
        "reference": row["reference"],
        "name": row["name"],
        "email": row["email"],
        "company": row["company"],
        "services": json.loads(row["services"]),
        "budget": row["budget"],
        "timeline": row["timeline"],
        "status": row["status"],
        "call_at": iso_or_none(row["call_at"]),
        "decline_reason": row["decline_reason"],
        "version": row["version"],
        "created_at": iso(row["created_at"]),
        "updated_at": iso(row["updated_at"]),
    }
    if include_message:
        data["message"] = row["message"]
    return data


def public_inquiry(row: dict, history: list[dict]) -> dict:
    return {
        "reference": row["reference"],
        "status": row["status"],
        "call_at": iso_or_none(row["call_at"]),
        "decline_reason": row["decline_reason"],
        "company": row["company"],
        "services": json.loads(row["services"]),
        "budget": row["budget"],
        "timeline": row["timeline"],
        "message": row["message"],
        "created_at": iso(row["created_at"]),
        "history": history,
    }


def studio_history(rows: list[dict]) -> list[dict]:
    return [
        {
            "action": row["action"],
            "from_status": row["from_status"],
            "to_status": row["to_status"],
            "call_at": iso_or_none(row["call_at"]),
            "decline_reason": row["decline_reason"],
            "actor_name": row["actor_name"],
            "created_at": iso(row["created_at"]),
        }
        for row in rows
    ]


def public_history(rows: list[dict]) -> list[dict]:
    return [
        {"status": row["to_status"], "created_at": iso(row["created_at"])}
        for row in rows
    ]


def note_json(row: dict) -> dict:
    return {
        "id": row["id"],
        "body": row["body"],
        "author_name": row["author_name"],
        "created_at": iso(row["created_at"]),
    }
