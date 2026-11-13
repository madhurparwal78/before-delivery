"""Account routes: changing the password; and the misc public routes."""

from __future__ import annotations

import asyncio
from typing import Optional

from aiohttp import web

from ..auth.store import Context
from ..auth.identity import IdentityError
from ..errors import (
    ApiError,
    identity_unavailable,
    internal_error,
    json_response,
    owner_only,
    signed_out,
    validation,
    MSG_CURRENT_PASSWORD,
    MSG_PASSWORD_DIFFERENT,
    MSG_PASSWORD_LENGTH,
)
from .boundary import read_json_body
from ..core.validation import reject_unknown_keys


async def get_me(request: web.Request) -> web.Response:
    ctx = request["ctx"]
    return json_response(
        {
            "role": ctx.account.role,
            "name": ctx.account.name,
            "email": ctx.account.email,
        }
    )


async def get_kinds(request: web.Request) -> web.Response:
    from ..domain import KIND_LIST, LEVEL_LIST

    return json_response(
        {
            "kinds": [
                {"code": k.code, "label": k.label, "steps": list(k.steps)} for k in KIND_LIST
            ],
            "levels": [
                {"code": l.code, "label": l.label, "weight": l.weight} for l in LEVEL_LIST
            ],
        }
    )


async def get_health(request: web.Request) -> web.Response:
    db = request.app["db"]
    if db._pool is None:
        return web.json_response({"status": "starting"}, status=503)
    try:
        await db.fetchval("SELECT 1")
        return json_response({"status": "ok"})
    except Exception:
        return web.json_response({"status": "starting"}, status=503)


async def get_status(request: web.Request) -> web.Response:
    identity = request.app["identity"]
    ok = await identity.reachable()
    return json_response({"identity": "ok" if ok else "down"})


async def post_change_password(request: web.Request) -> web.Response:
    """Change the owner's password; end every other session of owner and contact."""
    ctx = request["ctx"]
    if ctx.account.role != "owner":
        raise owner_only()
    identity = request.app["identity"]
    if not await identity.reachable():
        raise identity_unavailable()

    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"current_password": "Required."})
    reject_unknown_keys(body, {"current_password", "new_password"})
    current_password = body.get("current_password")
    new_password = body.get("new_password")
    if not isinstance(current_password, str) or not current_password:
        raise validation({"current_password": "Required."})
    if not isinstance(new_password, str) or not (12 <= len(new_password) <= 128):
        raise validation({"new_password": MSG_PASSWORD_LENGTH})
    if new_password == current_password:
        raise validation({"new_password": MSG_PASSWORD_DIFFERENT})

    # 1. Check the current password with the realm.
    try:
        ok = await identity.verify_user_password(ctx.account.email, current_password)
    except IdentityError:
        raise identity_unavailable()
    if not ok:
        raise validation({"current_password": MSG_CURRENT_PASSWORD})

    # 2. Set the new password in the realm, non-temporary.
    db = request.app["db"]
    user = await identity.get_user_by_email(ctx.account.email)
    if user is None:
        raise identity_unavailable()
    try:
        await identity.set_password(user["id"], new_password, temporary=False)
    except IdentityError:
        raise identity_unavailable()

    # 3. In one step, end every other app session of the owner and every app
    #    session of their contact, and end both accounts' realm sessions.
    store = request.app["store"]
    session_id = request.cookies.get("strongroom_session")
    contact = await store.account_contact_for_vault(ctx.account.vault_id or "")
    account_ids = [ctx.account.id] + ([contact.id] if contact else [])
    await store.end_sessions_for_accounts(account_ids, keep=session_id)

    realm_ids = [user["id"]]
    if contact is not None:
        contact_sub = await db.fetchval(
            "SELECT contact_sub FROM grants WHERE vault_id = $1 ORDER BY created_at DESC LIMIT 1",
            ctx.account.vault_id or "",
        )
        if contact_sub:
            realm_ids.append(contact_sub)
    try:
        await identity.end_all_sessions(realm_ids)
    except IdentityError:
        pass

    return json_response({"status": "changed"})
