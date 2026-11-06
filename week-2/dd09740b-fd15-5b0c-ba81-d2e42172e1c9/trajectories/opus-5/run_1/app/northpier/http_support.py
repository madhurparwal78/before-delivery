"""Shared request plumbing: auth resolution, origin checks and JSON answers."""

from __future__ import annotations

import json
import re
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any
from urllib.parse import urlsplit

from flask import Response, g, request

from . import auth, errors, validation
from .config import CONFIG
from .db import DATABASE, Connection, DatabaseUnavailable

JSON_CONTENT_TYPE = "application/json; charset=utf-8"

STATUS_API_PATH = re.compile(r"^/api/inquiries/status/[^/]*/?$")
STATUS_PAGE_PATH = re.compile(r"^/inquiry/[^/]*/?$")

NEXT_ALLOWED = re.compile(r"^/studio(?:[/?].*)?$")


def json_response(payload: Any, status: int = 200, headers: dict[str, str] | None = None) -> Response:
    return Response(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")),
        status=status,
        content_type=JSON_CONTENT_TYPE,
        headers=headers or {},
    )


def refusal_response(refusal: errors.Refusal) -> Response:
    return json_response(refusal.body(), refusal.status, refusal.headers())


def is_status_address(path: str) -> bool:
    return bool(STATUS_API_PATH.match(path) or STATUS_PAGE_PATH.match(path))


@contextmanager
def database() -> Iterator[Connection]:
    """One connection per use, turning an unreachable server into the outage refusal."""
    try:
        with DATABASE.connection() as conn:
            yield conn
    except DatabaseUnavailable:
        raise errors.database_unavailable() from None


def request_body() -> dict[str, Any]:
    return validation.parse_json_object(request.get_data(cache=True))


def idempotency_key() -> str | None:
    return validation.check_idempotency_key(request.headers.get("Idempotency-Key"))


# ---------------------------------------------------------------------------
# Studio authentication
# ---------------------------------------------------------------------------


def bearer_token() -> str | None:
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        token = header[7:].strip()
        return token or None
    return None


def session_token() -> str | None:
    return request.cookies.get(auth.SESSION_COOKIE) or None


def presented_token() -> tuple[str | None, bool]:
    """The token and whether it came from the session cookie."""
    token = bearer_token()
    if token is not None:
        return token, False
    return session_token(), True


def current_user(conn: Connection) -> dict[str, Any] | None:
    if "studio_user" in g:
        return g.studio_user
    token, from_cookie = presented_token()
    user = auth.resolve_session(conn, token) if token else None
    g.studio_user = user
    g.studio_user_from_cookie = from_cookie if user else False
    return user


def require_studio(conn: Connection) -> dict[str, Any]:
    user = current_user(conn)
    if user is None:
        raise errors.sign_in_required()
    return user


def check_same_origin() -> None:
    """A cookie-authenticated write must come from this origin."""
    if not g.get("studio_user_from_cookie"):
        return
    origin = request.headers.get("Origin")
    if origin is None:
        return
    sent = urlsplit(origin)
    if (sent.hostname, sent.port, sent.scheme) == _own_origin():
        return
    if origin.rstrip("/") == CONFIG.public_origin:
        return
    raise errors.cross_origin()


def _own_origin() -> tuple[str | None, int | None, str]:
    here = urlsplit(request.host_url)
    return here.hostname, here.port, here.scheme


def safe_next(raw: str | None) -> str:
    """`next` is honoured only when it stays inside the studio area."""
    if not raw or raw.startswith("//") or ":" in raw.split("/")[0]:
        return "/studio"
    if not NEXT_ALLOWED.match(raw):
        return "/studio"
    return raw
