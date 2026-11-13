"""The trusted contact's grant: create, narrow, revoke and read."""
from __future__ import annotations

import asyncpg
from starlette.responses import Response

from .. import errors
from ..db import new_id
from ..domain.kinds import LEVEL_CODES
from ..errors import ApiError, json_response
from ..grants import GRANT_HOURS, GRANT_COLUMNS, Grant, from_row, latest_grant
from ..identity import IdentityUnavailable, new_temporary_password
from ..validate import Fields
from .base import Ctx

EDITABLE_POST = ("contact_name", "contact_email", "duration", "levels")
EDITABLE_PATCH = ("levels",)


async def read_grant(ctx: Ctx) -> Response:
    async with ctx.db.pool.acquire() as connection:
        grant = await latest_grant(connection, ctx.vault_id)
    return json_response(
        {"grant": grant.as_json(ctx.caller.db_now) if grant is not None else None}
    )


async def read_contact_grant(ctx: Ctx) -> Response:
    grant = ctx.caller.grant
    if grant is None:
        raise ApiError("not_found")
    owner_name = await ctx.db.fetchval(
        """select accounts.name from vaults
           join accounts on accounts.id = vaults.owner_account_id
           where vaults.id = $1""",
        ctx.vault_id,
    )
    return json_response(grant.as_contact_json(ctx.caller.db_now, owner_name))


async def create_grant(ctx: Ctx) -> Response:
    temporary_password = new_temporary_password()
    try:
        async with ctx.db.transaction() as connection:
            # The vault row is won first: a losing request never reaches the realm.
            await connection.execute(
                "select id from vaults where id = $1 for update", ctx.vault_id
            )
            db_now = await connection.fetchval("select now()")
            existing = await latest_grant(connection, ctx.vault_id)
            if existing is not None and existing.is_active(db_now):
                raise ApiError("grant_active")
            if not ctx.state.identity.reachable:
                raise ApiError("identity_unavailable")

            fields = Fields(ctx.body, EDITABLE_POST)
            contact_name = fields.text("contact_name", required=True, max_length=80)
            contact_email = fields.email()
            duration = fields.duration()
            levels = fields.levels()
            if contact_email and not fields.errors.get("contact_email"):
                await _check_email_is_free(ctx, connection, contact_email, fields)
            fields.done()

            account_id = await _contact_account(connection, contact_email, contact_name)
            grant_id = new_id()
            row = await connection.fetchrow(
                f"""insert into grants (id, vault_id, contact_account_id, contact_name,
                                        contact_email, duration, levels, ends_at)
                    values ($1, $2, $3, $4, $5, $6, $7,
                            now() + ($8 * interval '1 second'))
                    returning {GRANT_COLUMNS}""",
                grant_id,
                ctx.vault_id,
                account_id,
                contact_name,
                contact_email,
                duration,
                levels,
                GRANT_HOURS[duration] * ctx.state.settings.grant_hour_seconds,
            )
            grant = from_row(row)
            assert grant is not None
            realm_user_id = await ctx.state.identity.ensure_person(
                contact_email, contact_name, temporary_password, temporary=True
            )
            await connection.execute(
                "update accounts set realm_user_id = $2, name = $3 where id = $1",
                account_id,
                realm_user_id,
                contact_name,
            )
            await ctx.db.notify(connection, ctx.vault_id, "grant.created", grant_id)
            db_now = await connection.fetchval("select now()")
    except IdentityUnavailable as outage:
        raise ApiError("identity_unavailable") from outage
    return json_response(
        {"grant": grant.as_json(db_now), "temporary_password": temporary_password},
        status_code=201,
    )


async def narrow_grant(ctx: Ctx) -> Response:
    async with ctx.db.transaction() as connection:
        row = await connection.fetchrow(
            f"""select {GRANT_COLUMNS} from grants where vault_id = $1
                order by created_at desc limit 1 for update""",
            ctx.vault_id,
        )
        grant = from_row(row)
        db_now = await connection.fetchval("select now()")
        if grant is None or not grant.is_active(db_now):
            raise ApiError("no_active_grant")

        fields = Fields(ctx.body, EDITABLE_PATCH)
        levels = fields.levels()
        if levels and not set(levels).issubset(grant.scope_levels()):
            fields.fail("levels", errors.FIELD_WIDENING)
        fields.done()

        if set(levels) == grant.scope_levels():
            return json_response({"grant": grant.as_json(db_now)})

        updated = from_row(
            await connection.fetchrow(
                f"update grants set levels = $2 where id = $1 returning {GRANT_COLUMNS}",
                grant.id,
                sorted(levels, key=LEVEL_CODES.index),
            )
        )
        assert updated is not None
        await ctx.db.notify(connection, ctx.vault_id, "grant.updated", grant.id)
    await _end_contact_realm_sessions(ctx, grant)
    return json_response({"grant": updated.as_json(db_now)})


async def revoke_grant(ctx: Ctx) -> Response:
    async with ctx.db.transaction() as connection:
        row = await connection.fetchrow(
            f"""update grants set revoked_at = now()
                where id = (select id from grants where vault_id = $1
                            order by created_at desc limit 1)
                  and revoked_at is null and ends_at > now()
                returning {GRANT_COLUMNS}""",
            ctx.vault_id,
        )
        grant = from_row(row)
        if grant is None:
            raise ApiError("no_active_grant")
        await connection.execute(
            "delete from sessions where account_id = $1", grant.contact_account_id
        )
        await ctx.db.notify(connection, ctx.vault_id, "grant.updated", grant.id)
        db_now = await connection.fetchval("select now()")
    await _end_contact_realm_sessions(ctx, grant)
    return json_response({"grant": grant.as_json(db_now)})


async def _check_email_is_free(
    ctx: Ctx, connection: asyncpg.Connection, email: str, fields: Fields
) -> None:
    """Only this vault's past contact accounts may be reused."""
    past = await connection.fetchval(
        """select exists (select 1 from grants where vault_id = $1 and contact_email = $2)""",
        ctx.vault_id,
        email,
    )
    if past:
        return
    if await ctx.state.identity.find_user(email) is not None:
        fields.fail("contact_email", errors.FIELD_EMAIL_TAKEN)


async def _contact_account(
    connection: asyncpg.Connection, email: str, name: str
) -> str:
    row = await connection.fetchrow("select id, kind from accounts where email = $1", email)
    if row is not None:
        await connection.execute(
            "update accounts set name = $2 where id = $1", row["id"], name
        )
        return row["id"]
    account_id = new_id()
    await connection.execute(
        "insert into accounts (id, email, name, kind) values ($1, $2, $3, 'contact')",
        account_id,
        email,
        name,
    )
    return account_id


async def _end_contact_realm_sessions(ctx: Ctx, grant: Grant) -> None:
    realm_user_id = await ctx.db.fetchval(
        "select realm_user_id from accounts where id = $1", grant.contact_account_id
    )
    await ctx.state.end_realm_sessions(realm_user_id)
