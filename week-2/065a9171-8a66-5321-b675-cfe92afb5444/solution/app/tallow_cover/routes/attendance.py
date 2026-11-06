"""Attendance for managers and HR: a home's day, add or correct with a reason, acknowledge late clock-ins."""

from .. import access, attendance, audit, db, shifts
from ..access import HR, UM, require
from ..attendance import ATTENDANCE_SQL
from ..errors import ApiError, invalid
from ..ids import new_id
from ..projections import attendance as project
from ..web import Call, api, reply


async def visible(conn, me, attendance_id: str, *, lock: bool = False):
    row = await attendance.fetch(conn, attendance_id, lock=lock)
    if row is None:
        raise ApiError("not_found")
    await access.home(conn, me, row["home_id"])
    require(me, UM, HR)
    return row


@api("GET", "/api/homes/{home_id}/attendance")
async def home_day(call: Call):
    async with db.pool.acquire() as conn:
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, UM, HR)
        day = shifts.parse_date(call.query("date", shifts.today().isoformat()))
        if day is None:
            raise invalid(date="Use a date like 2026-09-14.")
        rows = await conn.fetch(ATTENDANCE_SQL + " JOIN units u ON u.id = a.unit_id WHERE a.home_id = $1"
                                " AND a.date = $2 ORDER BY u.position,"
                                " array_position(ARRAY['early','late','night'], a.shift), p.display_name",
                                home["id"], day)
        return reply({"items": [project(r) for r in rows]})


@api("POST", "/api/attendance", keys=("assignment_id", "clock_in_at", "clock_out_at", "reason"))
async def add(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        assignment = await conn.fetchrow("SELECT * FROM assignments WHERE id = $1 FOR UPDATE",
                                         call.body.get("assignment_id"))
        if assignment is None:
            raise ApiError("not_found")
        await access.home(conn, call.me, assignment["home_id"])
        require(call.me, UM, HR)
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM attendance WHERE assignment_id = $1)", assignment["id"]):
            raise ApiError("attendance_exists")
        clock_in, clock_out, reason = attendance.read_correction(call.fields(), assignment["starts_at"])
        attendance_id = new_id("at")
        await conn.execute("INSERT INTO attendance (id, assignment_id, clock_in_at, clock_out_at, late, correction_note)"
                           " VALUES ($1, $2, $3, $4, $5, $6)", attendance_id, assignment["id"], clock_in, clock_out,
                           attendance.is_late(clock_in, assignment["starts_at"]), reason)
        added = project(await attendance.fetch(conn, attendance_id))
        await audit.record(conn, call.me, "attendance_added", assignment["home_id"], ("attendance", attendance_id),
                           None, added, reason)
        return reply(added, 201)


@api("PATCH", "/api/attendance/{id}", keys=("clock_in_at", "clock_out_at", "reason"))
async def correct(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        row = await visible(conn, call.me, call.path("id"), lock=True)
        attendance.check_version(call.header("if-match"), row, project(row))
        clock_in, clock_out, reason = attendance.read_correction(call.fields(), row["starts_at"])
        late = attendance.is_late(clock_in, row["starts_at"])
        await conn.execute(
            "UPDATE attendance SET clock_in_at = $2, clock_out_at = $3, late = $4,"
            " late_acknowledged = late_acknowledged AND late = $4, correction_note = $5, version = version + 1"
            " WHERE id = $1", row["id"], clock_in, clock_out, late, reason)
        corrected = project(await attendance.fetch(conn, row["id"]))
        await audit.record(conn, call.me, "attendance_corrected", row["home_id"], ("attendance", row["id"]),
                           project(row), corrected, reason)
        return reply(corrected)


@api("POST", "/api/attendance/{id}/acknowledge")
async def acknowledge(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        row = await visible(conn, call.me, call.path("id"), lock=True)
        if not row["late"]:
            raise ApiError("not_late")
        call.fields().check()
        await conn.execute("UPDATE attendance SET late_acknowledged = true, version = version + 1 WHERE id = $1",
                           row["id"])
        return reply(project(await attendance.fetch(conn, row["id"])))
