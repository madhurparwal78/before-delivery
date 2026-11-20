"""Floors and leave policy: effective-dated versions per home, added only by group HR admins."""

import asyncpg

from .. import access, audit, db, shifts
from ..access import HR, UM, require
from ..errors import ApiError, Fields
from ..ids import new_id
from ..projections import person
from ..web import Call, api, reply

VERSION_SQL = "SELECT v.*, p.display_name AS created_by_name FROM {table} v LEFT JOIN people p ON p.id = v.created_by"


def whole(value, low: int, high: int) -> bool:
    return isinstance(value, int) and not isinstance(value, bool) and low <= value <= high


def floor_body(v: asyncpg.Record) -> dict:
    return {"id": v["id"], "unit_id": v["unit_id"], "shift": v["shift"], "min_staff": v["min_staff"],
            "min_seniors": v["min_seniors"], "effective_from": v["effective_from"].isoformat(),
            "created_by": person(v["created_by"], v["created_by_name"]), "created_at": shifts.instant(v["created_at"])}


def policy_body(v: asyncpg.Record) -> dict:
    return {"id": v["id"], "notice_multiplier": v["notice_multiplier"],
            "effective_from": v["effective_from"].isoformat(),
            "created_by": person(v["created_by"], v["created_by_name"]), "created_at": shifts.instant(v["created_at"])}


def read_effective_from(fields: Fields):
    """The date as given (it still identifies a duplicate version); a date not after today is a field error."""
    proposed = shifts.parse_date(fields.body.get("effective_from"))
    if proposed is None or proposed <= shifts.today():
        fields.fail("effective_from", "Choose a date after today.")
    return proposed


@api("GET", "/api/homes/{home_id}/floors")
async def floors(call: Call):
    async with db.pool.acquire() as conn:
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, UM, HR)
        rows = await conn.fetch(VERSION_SQL.format(table="floor_versions") + " JOIN units u ON u.id = v.unit_id"
                                " WHERE v.home_id = $1 ORDER BY u.position,"
                                " array_position(ARRAY['early','late','night'], v.shift), v.effective_from",
                                home["id"])
        return reply({"versions": [floor_body(v) for v in rows]})


@api("POST", "/api/homes/{home_id}/floors", keys=("unit_id", "shift", "min_staff", "min_seniors", "effective_from"))
async def add_floor(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, HR)
        fields = call.fields()
        unit_id, shift = call.body.get("unit_id"), call.body.get("shift")
        if not await conn.fetchval("SELECT EXISTS (SELECT 1 FROM units WHERE id = $1 AND home_id = $2)",
                                   unit_id if isinstance(unit_id, str) else "", home["id"]):
            fields.fail("unit_id", "Choose a unit in this home.")
        if shift not in shifts.SHIFTS:
            fields.fail("shift", "Choose early, late or night.")
        effective_from = read_effective_from(fields)
        if fields.ok("unit_id", "shift") and effective_from and await conn.fetchval(
                "SELECT EXISTS (SELECT 1 FROM floor_versions WHERE unit_id = $1 AND shift = $2 AND effective_from = $3)",
                unit_id, shift, effective_from):
            raise ApiError("version_exists")
        min_staff, min_seniors = call.body.get("min_staff"), call.body.get("min_seniors")
        if not whole(min_staff, 0, 30):
            fields.fail("min_staff", "Use a whole number from 0 to 30.")
        if not whole(min_seniors, 0, min_staff if whole(min_staff, 0, 30) else 30):
            fields.fail("min_seniors", "Use a whole number no larger than the minimum staff.")
        fields.check()
        version_id = new_id("fv")
        if not await conn.fetchval("INSERT INTO floor_versions (id, home_id, unit_id, shift, min_staff, min_seniors,"
                                   " effective_from, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)"
                                   " ON CONFLICT DO NOTHING RETURNING id", version_id, home["id"], unit_id, shift,
                                   min_staff, min_seniors, effective_from, call.me["id"]):
            raise ApiError("version_exists")
        body = floor_body(await conn.fetchrow(VERSION_SQL.format(table="floor_versions") + " WHERE v.id = $1",
                                              version_id))
        await audit.record(conn, call.me, "floor_version_added", home["id"], ("floor_version", version_id), None, body,
                           None)
        return reply(body, 201)


@api("GET", "/api/homes/{home_id}/leave-policy")
async def policies(call: Call):
    async with db.pool.acquire() as conn:
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, UM, HR)
        rows = await conn.fetch(VERSION_SQL.format(table="policy_versions") + " WHERE v.home_id = $1"
                                " ORDER BY v.effective_from", home["id"])
        return reply({"versions": [policy_body(v) for v in rows]})


@api("POST", "/api/homes/{home_id}/leave-policy", keys=("notice_multiplier", "effective_from"))
async def add_policy(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, HR)
        fields = call.fields()
        effective_from = read_effective_from(fields)
        if effective_from and await conn.fetchval("SELECT EXISTS (SELECT 1 FROM policy_versions WHERE home_id = $1"
                                            " AND effective_from = $2)", home["id"], effective_from):
            raise ApiError("version_exists")
        multiplier = call.body.get("notice_multiplier")
        if not whole(multiplier, 0, 6):
            fields.fail("notice_multiplier", "Use a whole number from 0 to 6.")
        fields.check()
        version_id = new_id("lp")
        if not await conn.fetchval("INSERT INTO policy_versions (id, home_id, notice_multiplier, effective_from,"
                                   " created_by) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id",
                                   version_id, home["id"], multiplier, effective_from, call.me["id"]):
            raise ApiError("version_exists")
        body = policy_body(await conn.fetchrow(VERSION_SQL.format(table="policy_versions") + " WHERE v.id = $1",
                                               version_id))
        await audit.record(conn, call.me, "policy_version_added", home["id"], ("policy_version", version_id), None,
                           body, None)
        return reply(body, 201)
