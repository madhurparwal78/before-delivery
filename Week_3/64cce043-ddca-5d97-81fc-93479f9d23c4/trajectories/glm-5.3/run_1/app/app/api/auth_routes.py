"""Sign-in routes: /auth/login, /auth/callback and /auth/logout."""

from __future__ import annotations

import logging
import secrets
import urllib.parse
from typing import Optional

from aiohttp import web

from ..auth.identity import IdentityError
from ..auth.store import (
    SIGNIN_COOKIE,
    SESSION_COOKIE,
    Account,
    Store,
    insert_default_rules,
    new_id,
)
from ..auth.tokens import TokenError, TokenVerifier
from ..core.return_path import default_path_for_role, safe_return_path
from ..db.base import emit_notification
from ..errors import ApiError, signed_out
from .boundary import request_origin

log = logging.getLogger("strongroom.auth")

SIGNIN_FAILURE_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in failed</title>
<link rel="stylesheet" href="/static/app.css"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body class="auth-page"><main class="auth-panel">
<h1>Sign-in failed</h1><p>Sign-in could not be completed. Start again.</p>
<p><a href="/auth/login" id="signin-link">Sign in</a></p>
</main></body></html>"""

SIGNIN_UNAVAILABLE_HTML = """<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>Sign-in unavailable</title>
<link rel="stylesheet" href="/static/app.css"><meta name="viewport" content="width=device-width, initial-scale=1"></head>
<body class="auth-page"><main class="auth-panel">
<h1>Sign-in unavailable</h1><p>Sign-in service unavailable. Try again in a few minutes.</p>
<p><a href="/">Back</a></p>
</main></body></html>"""


def _signin_failure(request: web.Request) -> web.Response:
    next_value = request.query.get("next") or ""
    link = f'/auth/login?next={urllib.parse.quote(next_value)}' if next_value else '/auth/login'
    html = SIGNIN_FAILURE_HTML.replace('/auth/login" id="signin-link"', f'{link}" id="signin-link"')
    return web.Response(text=html, status=400, content_type="text/html", charset="utf-8")


def _signin_unavailable() -> web.Response:
    return web.Response(
        text=SIGNIN_UNAVAILABLE_HTML, status=503, content_type="text/html", charset="utf-8"
    )


async def login(request: web.Request) -> web.Response:
    """Start a browser-bound sign-in with a fresh state and PKCE challenge."""
    identity = request.app["identity"]
    if not await identity.reachable():
        return _signin_unavailable()

    next_raw = request.query.get("next") or None
    state = secrets.token_urlsafe(32)
    nonce = secrets.token_urlsafe(32)
    verifier, challenge = identity.make_pkce()

    store: Store = request.app["store"]
    return_path = None
    if next_raw:
        # Store the raw value; the check runs after sign-in, when the role is known.
        return_path = next_raw[:512]
    pending_id = await store.create_pending_signin(state, nonce, verifier, return_path)

    origin = request_origin(request)
    redirect_uri = f"{origin}/auth/callback"
    url = identity.authorization_url(state, nonce, challenge, redirect_uri)
    resp = web.HTTPFound(url)
    resp.del_cookie(SIGNIN_COOKIE)
    resp.set_cookie(
        SIGNIN_COOKIE,
        pending_id,
        httponly=True,
        samesite="Lax",
        path="/",
        max_age=request.app["cfg"].signin_pending_seconds,
    )
    return resp


async def callback(request: web.Request) -> web.Response:
    """Exchange the code, verify the ID token, create the session and redirect."""
    identity = request.app["identity"]
    store: Store = request.app["store"]
    verifier_obj: TokenVerifier = request.app["verifier"]
    db = request.app["db"]

    code = request.query.get("code")
    state = request.query.get("state")
    pending_id = request.cookies.get(SIGNIN_COOKIE)

    if not code or not state:
        log.warning("callback missing code or state")
        return _signin_failure(request)
    if not pending_id:
        log.warning("callback without pending signin cookie")
        return _signin_failure(request)
    if not await identity.reachable():
        return _signin_unavailable()

    pending = await store.consume_pending_signin(pending_id, state)
    if pending is None:
        log.warning("callback pending signin invalid or expired")
        return _signin_failure(request)

    origin = request_origin(request)
    redirect_uri = f"{origin}/auth/callback"
    try:
        tokens = await identity.exchange_code(code, redirect_uri, pending["verifier"])
        claims = await verifier_obj.verify_id_token(tokens["id_token"])
        verifier_obj.check_nonce(claims, pending["nonce"])
    except (IdentityError, TokenError) as exc:
        log.warning("callback token exchange failed: %s", exc)
        return _signin_failure(request)

    sub = claims["sub"]
    email = (claims.get("email") or claims.get("preferred_username") or "").strip().casefold()
    name = (claims.get("name") or claims.get("given_name") or email).strip() or email

    account = await store.account_by_sub(sub)
    if account is None:
        account = await _match_or_create_account(request, sub, email, name)

    if account is None or account.vault_id is None:
        return _signin_failure(request)

    # Decide the return target from the stored next value and the signer's role.
    role = account.role
    target = safe_return_path(role, pending["return_path"]) or default_path_for_role(role)

    session_id = await store.create_session(account.id)
    resp = web.HTTPFound(target)
    resp.set_cookie(
        SESSION_COOKIE, session_id, httponly=True, samesite="Lax", path="/"
    )
    resp.del_cookie(SIGNIN_COOKIE)
    return resp


async def _match_or_create_account(
    request: web.Request, sub: str, email: str, name: str
) -> Optional[Account]:
    """First sign-in: match the account by email to a seeded vault or grant.

    After the first sign-in, accounts are matched by their realm sub. A contact
    account never gets a vault of its own.
    """
    store: Store = request.app["store"]
    db = request.app["db"]

    # 1. An owner account matched by email to a seeded vault.
    owner_by_email = await db.fetchrow(
        "SELECT id, vault_id FROM accounts WHERE email = $1 AND kind = 'owner'",
        email,
    )
    if owner_by_email is not None:
        account = await store.create_account(sub, email, name, "owner", owner_by_email["vault_id"])
        return account

    # 2. A contact account matched by email to an active grant's contact email.
    grant_row = await db.fetchrow(
        """
        SELECT g.vault_id FROM grants g
        JOIN vaults v ON v.id = g.vault_id
        WHERE lower(g.contact_email) = $1
        ORDER BY g.created_at DESC LIMIT 1
        """,
        email,
    )
    if grant_row is not None:
        account = await store.create_account(sub, email, name, "contact", grant_row["vault_id"])
        return account

    # 3. Any other account gets its own empty vault with the default rules,
    #    exactly once, even when several callbacks finish at once.
    vault_id = await store.bootstrap_vault_for_new_owner(email, name)
    if vault_id is None:
        return None
    account = await store.create_account(sub, email, name, "owner", vault_id)
    return account


async def logout(request: web.Request) -> web.Response:
    """End this session and clear its cookie."""
    store: Store = request.app["store"]
    sid = request.cookies.get(SESSION_COOKIE)
    if sid:
        await store.end_session(sid)
    resp = web.Response(status=204)
    resp.del_cookie(SESSION_COOKIE)
    return resp
