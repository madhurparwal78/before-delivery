"""Grant routes: create, read, narrow, revoke; and the contact's own grant."""

from __future__ import annotations

import asyncio
import time
from datetime import timedelta
from typing import Any, Optional

import aiohttp
from aiohttp import web

from ..auth.store import Context, new_id
from ..core.grant_state import GrantView, grant_status
from ..core.projection import contact_grant_for, grant_for
from ..core.vault_writer import VaultWriter, WriteError
from ..domain import DURATIONS
from ..errors import (
    ApiError,
    grant_active,
    identity_unavailable,
    internal_error,
    json_response,
    no_active_grant,
    not_found,
    owner_only,
    validation,
    MSG_AT_LEAST_ONE_LEVEL,
    MSG_CONTACT_EMAIL,
    MSG_NARROW_ONLY,
)
from ..db.base import emit_notification
from ..auth.identity import IdentityError
from .boundary import read_json_body
from ..core.validation import (
    clean_contact_name,
    clean_duration,
    clean_email,
    clean_levels,
    reject_unknown_keys,
)

GRANT_EDITABLE_POST = {"contact_name", "contact_email", "duration", "levels"}
GRANT_EDITABLE_PATCH = {"levels"}


def _ctx(request: web.Request) -> Context:
    return request["ctx"]


def _vault_id(ctx: Context) -> str:
    if ctx.account.vault_id is None:
        raise not_found()
    return ctx.account.vault_id


async def _grant_row(request: web.Request, vault_id: str) -> tuple[GrantView, str, int] | None:
    """The most recent grant, its live status and remaining seconds."""
    reader = request.app["reader"]
    grant = await reader.grant_for_vault(vault_id)
    if grant is None:
        return None
    db_now = await request.app["db"].fetchval("SELECT now()")
    status, remaining = grant_status(grant, db_now)
    return grant, status, remaining


async def get_grant(request: web.Request) -> web.Response:
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    data = await _grant_row(request, vault_id)
    if data is None:
        return json_response({"grant": None})
    grant, status, remaining = data
    return json_response({"grant": grant_for(grant, status, remaining)})


async def post_grant(request: web.Request) -> web.Response:
    """Create the single active grant and the contact's realm account.

    The grant row is won first; only the winner creates or updates the realm
    account, and a failed realm call removes the grant row and answers 503.
    """
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)

    identity = request.app["identity"]
    if not await identity.reachable():
        raise identity_unavailable()

    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"contact_name": "Required."})
    reject_unknown_keys(body, GRANT_EDITABLE_POST)
    contact_name = clean_contact_name(body.get("contact_name"))
    contact_email = clean_email(body.get("contact_email"))
    duration = clean_duration(body.get("duration"))
    levels = clean_levels(body.get("levels"))

    db = request.app["db"]
    reader = request.app["reader"]
    writer: VaultWriter = request.app["writer"]
    cfg = request.app["cfg"]

    # The email must not belong to a realm account outside this vault's past contacts.
    past_contacts = await db.fetch(
        "SELECT DISTINCT contact_email FROM grants WHERE vault_id = $1", vault_id
    )
    past_emails = [r["contact_email"] for r in past_contacts]
    allowed_ids = await identity.known_user_ids(past_emails)
    taken = await identity.user_email_taken_by_other(contact_email, allowed_ids)
    if taken:
        raise validation({"contact_email": MSG_CONTACT_EMAIL})

    grant_hours = DURATIONS[duration]
    grant_id = new_id("grant")

    from ..auth.identity import random_temporary_password

    temporary_password = random_temporary_password()

    async def op(conn) -> None:
        db_now = await conn.fetchval("SELECT now()")
        ends_at = db_now + timedelta(seconds=grant_hours * cfg.grant_hour_seconds)
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"grant:{vault_id}")
        await writer.create_grant(
            conn, vault_id, grant_id, contact_name, contact_email, duration, levels, ends_at
        )

    # 1. Win the grant row (exactly one of simultaneous requests succeeds).
    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await op(conn)
    except WriteError as exc:
        if exc.code == "grant_active":
            raise grant_active()
        raise internal_error()

    # 2. Only the winner creates or updates the contact's realm account.
    realm_user = None
    try:
        realm_user = await identity.upsert_contact_user(contact_email, contact_name, temporary_password)
    except IdentityError:
        # The realm call failed: remove the grant row, send nothing, answer 503.
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await conn.execute("DELETE FROM grants WHERE id = $1", grant_id)
        raise identity_unavailable()

    # Remember the contact's realm sub for later account matching.
    if realm_user is not None:
        await db.execute(
            "UPDATE grants SET contact_sub = $2 WHERE id = $1", grant_id, realm_user["id"]
        )

    data = await _grant_row(request, vault_id)
    grant, status, remaining = data if data else (None, "active", 0)
    return json_response(
        {
            "grant": grant_for(grant, status, remaining),
            "temporary_password": temporary_password,
        },
        status=201,
    )


async def patch_grant(request: web.Request) -> web.Response:
    """Narrow the active grant's scope; widening answers 422."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    body = await read_json_body(request)
    if not isinstance(body, dict):
        raise validation({"levels": MSG_AT_LEAST_ONE_LEVEL})
    reject_unknown_keys(body, GRANT_EDITABLE_PATCH)
    levels = clean_levels(body.get("levels"))

    db = request.app["db"]
    writer: VaultWriter = request.app["writer"]
    reader = request.app["reader"]

    data = await _grant_row(request, vault_id)
    if data is None:
        raise no_active_grant()
    grant, status, _remaining = data
    if status != "active":
        raise no_active_grant()
    current = set(grant.levels)
    if not set(levels) <= current:
        raise validation({"levels": MSG_NARROW_ONLY})
    if set(levels) == current:
        data = await _grant_row(request, vault_id)
        grant2, status2, remaining2 = data if data else (None, "active", 0)
        return json_response({"grant": grant_for(grant2, status2, remaining2)})

    async def op(conn) -> None:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"grant:{vault_id}")
        await writer.narrow_grant(conn, vault_id, grant.id, list(levels))

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                await op(conn)
    except WriteError as exc:
        if exc.code == "no_active_grant":
            raise no_active_grant()
        if exc.code == "not_found":
            raise not_found()
        raise internal_error()

    # Narrowing ends the contact's realm sessions.
    identity = request.app["identity"]
    contact_account = await request.app["store"].account_contact_for_vault(vault_id)
    if contact_account is not None:
        try:
            sub = await db.fetchval(
                "SELECT contact_sub FROM grants WHERE id = $1", grant.id
            )
            if sub:
                await identity.end_all_sessions([sub])
        except IdentityError:
            pass

    data = await _grant_row(request, vault_id)
    grant2, status2, remaining2 = data if data else (None, "active", 0)
    return json_response({"grant": grant_for(grant2, status2, remaining2)})


async def delete_grant(request: web.Request) -> web.Response:
    """Revoke the active grant; exactly one of simultaneous revokes succeeds."""
    ctx = _ctx(request)
    if ctx.account.role != "owner":
        raise owner_only()
    vault_id = _vault_id(ctx)
    db = request.app["db"]
    writer: VaultWriter = request.app["writer"]
    store = request.app["store"]
    identity = request.app["identity"]

    data = await _grant_row(request, vault_id)
    if data is None:
        raise no_active_grant()
    grant, status, _remaining = data
    if status != "active":
        raise no_active_grant()

    revoked_grant_id = grant.id
    contact_sub = await db.fetchval(
        "SELECT contact_sub FROM grants WHERE id = $1", revoked_grant_id
    )

    async def op(conn) -> bool:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtext($1))", f"grant:{vault_id}")
        ok = await writer.revoke_grant(conn, vault_id, revoked_grant_id)
        if not ok:
            raise no_active_grant()
        # End the contact's app sessions in the same transaction.
        rows = await conn.fetch(
            "SELECT id FROM accounts WHERE vault_id = $1 AND kind = 'contact'", vault_id
        )
        account_ids = [r["id"] for r in rows]
        if account_ids:
            await conn.execute(
                "DELETE FROM sessions WHERE account_id = ANY($1::text[])", account_ids
            )
        # The contact's stream receives exactly one access-ended and no
        # grant.updated before it, so the revoke itself sends no notification
        # through the normal path; the hub pushes access-ended directly below.
        return True

    try:
        async with db.pool.acquire() as conn:
            async with conn.transaction():
                ok = await op(conn)
                if not ok:
                    raise no_active_grant()
    except WriteError as exc:
        if exc.code == "no_active_grant":
            raise no_active_grant()
        raise internal_error()

    # End the contact's realm sessions; the retry rule covers an outage.
    if contact_sub:
        async def _end_realm() -> None:
            try:
                await identity.end_all_sessions([contact_sub])
            except IdentityError:
                await asyncio.sleep(30)
                await _end_realm()

        asyncio.ensure_future(_end_realm())

    # Push the streams: owners see grant.updated, the contact sees exactly one
    # access-ended (their stream then closes, and their next request answers
    # access_ended 403 while the grant row records the revoke).
    hub = request.app["hub"]
    hub.push(vault_id, {"type": "grant.updated", "id": revoked_grant_id, "_access_ended": True})

    data = await _grant_row(request, vault_id)
    grant2, status2, remaining2 = data if data else (None, "revoked", 0)
    return json_response({"grant": grant_for(grant2, status2, remaining2)})


async def get_contact_grant(request: web.Request) -> web.Response:
    """The contact's own grant; also answers after the grant has ended."""
    ctx = _ctx(request)
    if ctx.account.role == "owner":
        raise not_found()
    vault_id = _vault_id(ctx)
    data = await _grant_row(request, vault_id)
    if data is None:
        raise not_found()
    grant, status, remaining = data
    owner_name = await request.app["db"].fetchval(
        "SELECT a.name FROM accounts a WHERE a.vault_id = $1 AND a.kind = 'owner' LIMIT 1",
        vault_id,
    )
    return json_response(
        contact_grant_for(status, remaining, list(grant.levels), owner_name or "", grant.ends_at)
    )
