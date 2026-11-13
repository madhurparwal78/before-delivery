"""Sign-in through the realm: pending sign-ins, callbacks and sign-out."""
from __future__ import annotations

import base64
import hashlib
import secrets

from starlette.requests import Request
from starlette.responses import RedirectResponse, Response

from .config import SESSION_COOKIE, SIGNIN_COOKIE
from .identity import IdentityUnavailable
from .pages import signin_failed_page, signin_unavailable_page
from .sessions import end_session, resolve_caller, safe_return_path, start_session
from .state import AppState

COOKIE_OPTIONS = {"httponly": True, "samesite": "lax", "path": "/"}


def request_origin(state: AppState, request: Request) -> str:
    configured = state.settings.public_url
    if configured:
        return configured.rstrip("/")
    return f"{request.url.scheme}://{request.headers.get('host', '')}"


def _challenge(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).decode("ascii").rstrip("=")


async def login(state: AppState, request: Request) -> Response:
    await state.ensure_seeded_accounts()
    if not state.identity.reachable:
        return signin_unavailable_page()

    pending_id = secrets.token_urlsafe(24)
    state_value = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(16)
    verifier = secrets.token_urlsafe(48)
    await state.db.execute(
        """insert into pending_signins (id, state, nonce, verifier, next_path)
           values ($1, $2, $3, $4, $5)""",
        pending_id,
        state_value,
        nonce,
        verifier,
        request.query_params.get("next"),
    )
    target = state.identity.authorization_url(
        state_value,
        nonce,
        _challenge(verifier),
        f"{request_origin(state, request)}/auth/callback",
    )
    response = RedirectResponse(target, status_code=302)
    response.set_cookie(SIGNIN_COOKIE, pending_id, **COOKIE_OPTIONS)
    return response


async def callback(state: AppState, request: Request) -> Response:
    pending_id = request.cookies.get(SIGNIN_COOKIE)
    code = request.query_params.get("code")
    state_value = request.query_params.get("state")
    if not pending_id or not code or not state_value:
        return signin_failed_page()

    pending = await state.db.fetchrow(
        """update pending_signins set consumed_at = now()
           where id = $1 and state = $2 and consumed_at is null
             and created_at > now() - ($3 * interval '1 second')
           returning nonce, verifier, next_path""",
        pending_id,
        state_value,
        state.settings.signin_pending_seconds,
    )
    if pending is None:
        return signin_failed_page()

    try:
        person = await state.identity.exchange_code(
            code,
            pending["verifier"],
            f"{request_origin(state, request)}/auth/callback",
            pending["nonce"],
        )
    except IdentityUnavailable:
        return signin_unavailable_page()
    if person is None:
        return signin_failed_page()

    session_id, role = await start_session(state.db, person)
    response = RedirectResponse(
        safe_return_path(pending["next_path"], role), status_code=303
    )
    response.set_cookie(SESSION_COOKIE, session_id, **COOKIE_OPTIONS)
    response.delete_cookie(SIGNIN_COOKIE, path="/")
    return response


async def logout(state: AppState, request: Request) -> Response:
    caller = await resolve_caller(
        state.db, state.settings, request.cookies.get(SESSION_COOKIE), touch=False
    )
    if caller is not None:
        await end_session(state.db, caller.session_id)
    response = Response(status_code=204)
    response.delete_cookie(SESSION_COOKIE, path="/")
    return response
