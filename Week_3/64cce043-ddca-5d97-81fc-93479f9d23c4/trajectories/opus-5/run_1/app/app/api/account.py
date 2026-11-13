"""The owner's password, and the sessions a change ends."""
from __future__ import annotations

from starlette.responses import Response

from .. import errors
from ..errors import ApiError, json_response
from ..identity import IdentityUnavailable, WrongPassword
from ..validate import Fields
from .base import Ctx

EDITABLE = ("current_password", "new_password")
MIN_PASSWORD = 12
MAX_PASSWORD = 128


async def change_password(ctx: Ctx) -> Response:
    if not ctx.state.identity.reachable:
        raise ApiError("identity_unavailable")

    fields = Fields(ctx.body, EDITABLE)
    current_password = fields.password("current_password")
    new_password = fields.password("new_password")
    if new_password and not MIN_PASSWORD <= len(new_password) <= MAX_PASSWORD:
        fields.fail("new_password", errors.FIELD_PASSWORD_LENGTH)
    elif new_password and new_password == current_password:
        fields.fail("new_password", errors.FIELD_PASSWORD_SAME)
    fields.done()

    try:
        await ctx.state.identity.verify_password(ctx.caller.email, current_password)
    except WrongPassword as wrong:
        raise ApiError(
            "validation", {"current_password": errors.FIELD_WRONG_PASSWORD}
        ) from wrong
    except IdentityUnavailable as outage:
        raise ApiError("identity_unavailable") from outage

    try:
        await ctx.state.identity.set_password(
            ctx.caller.realm_user_id, new_password, temporary=False
        )
    except IdentityUnavailable as outage:
        raise ApiError("identity_unavailable") from outage

    async with ctx.db.transaction() as connection:
        contacts = [
            row["id"]
            for row in await connection.fetch(
                """select distinct accounts.id, accounts.realm_user_id from accounts
                   join grants on grants.contact_account_id = accounts.id
                   where grants.vault_id = $1""",
                ctx.vault_id,
            )
        ]
        realm_user_ids = [
            row["realm_user_id"]
            for row in await connection.fetch(
                "select realm_user_id from accounts where id = any($1::text[])", contacts
            )
        ]
        await connection.execute(
            """delete from sessions
               where id <> $1 and (account_id = $2 or account_id = any($3::text[]))""",
            ctx.caller.session_id,
            ctx.caller.account_id,
            contacts,
        )
    for realm_user_id in [ctx.caller.realm_user_id, *realm_user_ids]:
        await ctx.state.end_realm_sessions(realm_user_id)
    return json_response({"status": "changed"})
