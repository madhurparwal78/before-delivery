"""The request boundary: body limits, content type, origin checks, sessions."""

from __future__ import annotations

import json
from typing import Any, Optional

from aiohttp import web

from ..auth.store import Account, Context, Store, SESSION_COOKIE
from ..core.grant_state import GrantView, grant_status
from ..errors import (
    ApiError,
    cross_origin,
    signed_out,
    too_large,
    unsupported_media_type,
)

MAX_BODY_BYTES = 65_536

# Requests that do not count as activity for idle expiry.
NON_ACTIVITY_PATHS = {"/api/events", "/api/status", "/api/health"}


async def read_content_type(request: web.Request) -> None:
    """415 for any body content type other than application/json on writes."""
    if request.method not in ("POST", "PUT", "PATCH"):
        return
    ctype = request.headers.get("Content-Type", "")
    base = ctype.split(";")[0].strip().lower()
    if request.content_length in (None, 0) and not request.body_exists:
        return
    if base != "application/json":
        raise unsupported_media_type()


async def read_json_body(request: web.Request) -> Any:
    """Enforce the boundary checks and return the parsed JSON body."""
    if request.method in ("POST", "PUT", "PATCH"):
        ctype = request.headers.get("Content-Type", "")
        base = ctype.split(";")[0].strip().lower()
        if base and base != "application/json":
            raise unsupported_media_type()
    if request.body_exists:
        if request.content_length is not None and request.content_length > MAX_BODY_BYTES:
            raise too_large()
        raw = await request.read()
        if len(raw) > MAX_BODY_BYTES:
            raise too_large()
        if not raw:
            return None
        try:
            return json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "validation", "Check the highlighted fields.", {"body": "Send JSON."})
    return None


def check_same_origin(request: web.Request) -> None:
    """A write whose Origin header is present and foreign answers 403 cross_origin."""
    if request.method in ("POST", "PUT", "PATCH", "DELETE"):
        origin = request.headers.get("Origin")
        if origin is None:
            return
        own = request.headers.get("Host", "")
        expected = f"{request.scheme}://{own}"
        if origin.rstrip("/") == expected.rstrip("/") or origin.rstrip("/") == own:
            return
        public_url = request.app["cfg"].public_url
        if public_url and origin.rstrip("/") == public_url.rstrip("/"):
            return
        raise cross_origin()


def session_id(request: web.Request) -> Optional[str]:
    return request.cookies.get(SESSION_COOKIE)


def request_origin(request: web.Request) -> str:
    cfg = request.app["cfg"]
    if cfg.public_url:
        return cfg.public_url.rstrip("/")
    host = request.headers.get("Host", f"127.0.0.1:{cfg.public_port}")
    scheme = request.headers.get("X-Forwarded-Proto", request.scheme)
    return f"{scheme}://{host}"


async def current_context(request: web.Request) -> Optional[Context]:
    """Load the caller's account, applying idle expiry, or None when signed out."""
    sid = session_id(request)
    if sid is None:
        return None
    store: Store = request.app["store"]
    account = await store.load_session(sid)
    if account is None:
        return None
    if request.path not in NON_ACTIVITY_PATHS:
        await store.touch_session(sid)
    db_now = await request.app["db"].fetchval("SELECT now()")
    return Context(account=account, db_now=db_now)


def require_context(request: web.Request, ctx: Optional[Context]) -> Context:
    if ctx is None:
        raise signed_out()
    return ctx


async def context_for_request(request: web.Request) -> Context:
    """Read the session, apply the boundary checks, and require a signed-in caller."""
    check_same_origin(request)
    ctx = await current_context(request)
    return require_context(request, ctx)
