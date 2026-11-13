"""Shared pieces of the API surface: sessions, roles and serialisation."""

from __future__ import annotations

from flask import request

from ..config import SERVED_PROGRAMME
from ..domain.accounts import STEWARD, account_for
from ..domain.clock import helsinki_stamp
from ..domain.fields import is_hostile
from ..domain.references import (
    figures_of,
    is_live,
    programme_id_for,
    quote_of,
    state_of,
)
from ..http import (
    FORBIDDEN,
    NEEDS_SESSION,
    PREVIEW_HEADERS,
    Refusal,
    Store,
    not_found,
)

__all__ = [
    "PREVIEW_HEADERS",
    "desk_account",
    "desk_detail",
    "desk_row",
    "detail_entry",
    "enquiry_row",
    "index_entry",
    "own_reference",
    "require_steward",
    "served_programme_id",
]


def served_programme_id(store: Store) -> int:
    return programme_id_for(store.conn, SERVED_PROGRAMME)


def bearer_token() -> str | None:
    header = request.headers.get("Authorization", "")
    if not header.startswith("Bearer "):
        return None
    token = header[7:].strip()
    return token or None


def desk_account(store: Store) -> dict:
    """The stored account behind this request's session."""
    token = bearer_token()
    if token is None or is_hostile(token):
        raise Refusal(401, NEEDS_SESSION)
    account = account_for(store.conn, token, store.now)
    if account is None:
        raise Refusal(401, NEEDS_SESSION)
    return account


def require_steward(account: dict) -> None:
    if account["role"] != STEWARD:
        raise Refusal(403, FORBIDDEN)


def own_reference(store: Store, account: dict, slug: str) -> dict:
    """A reference of the account's own programme, addressed by its current slug."""
    row = store.conn.execute(
        "SELECT * FROM reference_entry WHERE programme_id = %s AND slug = %s",
        (account["programme_id"], slug),
    ).fetchone()
    if row is None:
        raise not_found()
    return row


def headline_figure(conn, reference_id: int) -> dict | None:
    figures = figures_of(conn, reference_id)
    return figures[0] if figures else None


def index_entry(conn, row, locale: str) -> dict:
    title = row["title"]
    if locale == "fi" and row["title_fi"]:
        title = row["title_fi"]
    return {
        "slug": row["slug"],
        "ordinal": row["ordinal"],
        "sector": row["sector"],
        "title": title,
        "result": headline_figure(conn, row["id"]),
    }


def detail_entry(conn, row, locale: str) -> dict:
    title = row["title"]
    if locale == "fi" and row["title_fi"]:
        title = row["title_fi"]
    payload = {
        "slug": row["slug"],
        "ordinal": row["ordinal"],
        "sector": row["sector"],
        "customer": row["customer"],
        "title": title,
        "summary": row["summary"],
        "challenge": row["challenge"],
        "work": row["work"],
        "figures": figures_of(conn, row["id"]),
        "quote": quote_of(row),
    }
    if locale == "fi":
        payload["translated"] = row["body_fi"] is not None
        payload["body"] = row["body_fi"]
    return payload


def desk_row(row, today) -> dict:
    return {
        "slug": row["slug"],
        "title": row["title"],
        "sector": row["sector"],
        "state": state_of(row, today),
        "published": row["published"],
        "live": is_live(row, today),
        "ordinal": row["ordinal"],
        "clearance_from": _date(row["clearance_from"]),
        "clearance_until": _date(row["clearance_until"]),
    }


def desk_detail(conn, row, today) -> dict:
    payload = desk_row(row, today)
    payload.update(
        {
            "title": row["title"],
            "summary": row["summary"],
            "challenge": row["challenge"],
            "work": row["work"],
            "sector": row["sector"],
            "customer": row["customer"],
            "figures": figures_of(conn, row["id"]),
            "quote": row["quote"],
            "quote_speaker": row["quote_speaker"],
            "quote_role": row["quote_role"],
            "title_fi": row["title_fi"],
            "body_fi": row["body_fi"],
            "version": row["version"],
        }
    )
    return payload


def enquiry_row(row) -> dict:
    return {
        "id": row["id"],
        "email": row["email"],
        "phone": row["phone"],
        "reference": row["reference"],
        "created_at": helsinki_stamp(row["created_at"]),
        "agreed": row["agreed"],
    }


def _date(value) -> str | None:
    return value.isoformat() if value is not None else None
