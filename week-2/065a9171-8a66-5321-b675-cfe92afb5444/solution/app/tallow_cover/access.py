"""Who may see which home (brief: Visibility and homes) and the role check that follows it."""

import asyncpg

from .errors import ApiError

CW, BC, UM, HR = "care_worker", "bank_carer", "unit_manager", "hr_admin"
MANAGERS = (UM, HR)


def require(me: asyncpg.Record, *roles: str) -> None:
    if me["role"] not in roles:
        raise ApiError("forbidden")


async def home_ids(conn: asyncpg.Connection, me: asyncpg.Record) -> set[str]:
    """The homes whose records the caller may address at all; anything else answers not_found."""
    if me["role"] == HR:
        return {r["id"] for r in await conn.fetch("SELECT id FROM homes")}
    if me["role"] == BC:
        return {r["home_id"] for r in await conn.fetch("SELECT home_id FROM credentials WHERE person_id = $1",
                                                         me["id"])}
    return {me["home_id"]}


async def home(conn: asyncpg.Connection, me: asyncpg.Record, home_id: str | None) -> asyncpg.Record:
    if home_id not in await home_ids(conn, me):
        raise ApiError("not_found")
    return await conn.fetchrow("SELECT * FROM homes WHERE id = $1", home_id)


async def unit(conn: asyncpg.Connection, me: asyncpg.Record, unit_id: str | None) -> asyncpg.Record:
    row = await conn.fetchrow("SELECT * FROM units WHERE id = $1", unit_id)
    if row is None or row["home_id"] not in await home_ids(conn, me):
        raise ApiError("not_found")
    return row
