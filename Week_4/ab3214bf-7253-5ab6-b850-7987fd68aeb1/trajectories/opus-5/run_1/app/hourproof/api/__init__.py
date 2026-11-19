"""Shared request plumbing: the envelope, the session and the refusal order."""

from __future__ import annotations

import json
import secrets
from dataclasses import dataclass
from typing import Any

from flask import Response, request

from .. import clock, engine, store
from ..db import Cursor
from ..domain import states
from ..errors import ApiError, body_too_large, field_error, forbidden, not_found
from ..errors import stale_revision, unauthenticated, wrong_state
from ..domain.model import WindowRecord

SESSION_COOKIE = "hourproof_session"
MAX_BODY_BYTES = 1000000
JSON_TYPE = "application/json; charset=utf-8"

ANALYST = "analyst"
VERIFIER = "verifier"
LEAD = "lead"

LANDING = {ANALYST: "/windows", VERIFIER: "/review", LEAD: "/group"}


@dataclass(frozen=True)
class Account:
    id: str
    email: str
    name: str
    role: str
    firm_id: str | None

    def json(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "name": self.name,
            "role": self.role,
            "firm_id": self.firm_id,
        }


def envelope(body: dict[str, Any], status: int = 200) -> Response:
    payload = dict(body)
    payload["server_now"] = clock.instant(clock.now())
    return Response(
        json.dumps(payload, ensure_ascii=False),
        status=status,
        content_type=JSON_TYPE,
    )


def read_body() -> dict[str, Any]:
    raw = request.get_data(cache=True)
    if len(raw) > MAX_BODY_BYTES:
        raise body_too_large()
    if not raw:
        return {}
    try:
        parsed = json.loads(raw.decode("utf-8"))
    except (ValueError, UnicodeDecodeError):
        return {}
    return parsed if isinstance(parsed, dict) else {}


def new_session(cursor: Cursor, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    cursor.execute(
        "INSERT INTO sessions (token, user_id, created_at) VALUES (%s, %s, %s)",
        (token, user_id, clock.now()),
    )
    return token


def end_session(cursor: Cursor) -> None:
    token = request.cookies.get(SESSION_COOKIE)
    if token:
        cursor.execute("DELETE FROM sessions WHERE token = %s", (token,))


def signed_in(cursor: Cursor) -> Account | None:
    token = request.cookies.get(SESSION_COOKIE)
    if not token:
        return None
    row = cursor.one(
        "SELECT users.* FROM sessions JOIN users ON users.id = sessions.user_id"
        " WHERE sessions.token = %s",
        (token,),
    )
    if row is None:
        return None
    return Account(
        id=row["id"],
        email=row["email"],
        name=row["name"],
        role=row["role"],
        firm_id=row["firm_id"],
    )


def require_account(cursor: Cursor) -> Account:
    account = signed_in(cursor)
    if account is None:
        raise unauthenticated()
    return account


def require_role(account: Account, *roles: str) -> None:
    if account.role not in roles:
        raise forbidden()


def readable_window(
    cursor: Cursor, account: Account, window_id: str, lock: bool = False
) -> WindowRecord:
    """A window the caller may see; anything else answers exactly as an unknown one."""
    window = store.load_window(cursor, window_id, lock=lock)
    if window is None:
        raise not_found()
    if account.role == VERIFIER and window.verifier_firm_id != account.firm_id:
        raise not_found()
    engine.normalize_state(cursor, window)
    return window


def readable_windows(cursor: Cursor, account: Account) -> list[WindowRecord]:
    windows = store.load_windows(cursor)
    if account.role == VERIFIER:
        windows = [
            window
            for window in windows
            if window.verifier_firm_id == account.firm_id
        ]
    for window in windows:
        engine.normalize_state(cursor, window)
    return windows


def require_state(window: WindowRecord, action: str) -> None:
    if not states.permits(action, window.state):
        raise wrong_state(window.state)


def require_revision(body: dict[str, Any], window: WindowRecord) -> None:
    """The revision guard: a stale write is refused before any field is read."""
    sent = body.get("revision")
    if isinstance(sent, int) and not isinstance(sent, bool):
        if sent != window.revision:
            raise stale_revision(
                window.last_writer_name or "Another analyst",
                clock.instant(window.wrote_at or clock.now()),
            )
        return
    raise field_error("revision")


def whole_number(body: dict[str, Any], field: str, low: int, high: int) -> int:
    value = body.get(field)
    if not isinstance(value, int) or isinstance(value, bool) or not low <= value <= high:
        raise field_error(field)
    return value


def text_field(body: dict[str, Any], field: str, limit: int) -> str:
    value = body.get(field)
    if not isinstance(value, str) or not value.strip() or len(value) > limit:
        raise field_error(field)
    return value


def error_response(failure: ApiError) -> Response:
    return envelope(failure.body(), failure.status)
