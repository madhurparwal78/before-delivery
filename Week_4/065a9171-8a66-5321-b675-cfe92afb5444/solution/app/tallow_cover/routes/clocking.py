"""My shifts and punches: clock in to the current rostered shift and out again, one punch per key."""

from datetime import timedelta

from .. import attendance, db, idempotency, leave, shifts
from ..access import BC, CW, UM
from ..attendance import ATTENDANCE_SQL
from ..errors import ApiError
from ..ids import new_id
from ..projections import attendance as project
from ..projections import rota_entry
from ..staffing import ROTA_SQL
from ..web import Call, api, reply

UPCOMING_DAYS = 14


@api("GET", "/api/me/shifts", roles=(CW, BC, UM))
async def my_shifts(call: Call):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch(ROTA_SQL + " WHERE a.person_id = $1 AND a.ends_at > $2 AND a.date <= $3"
                                " ORDER BY a.starts_at", call.me["id"], shifts.now(),
                                shifts.today() + timedelta(days=UPCOMING_DAYS))
        current = await attendance.open_attendance(conn, call.me["id"])
        return reply({"assignments": [rota_entry(r, call.me) for r in rows],
                      "open_attendance": project(current) if current else None,
                      "holiday": await leave.holiday(conn, call.me["id"]) if call.me["role"] != BC else None})


@api("GET", "/api/me/attendance", roles=(CW, BC))
async def my_attendance(call: Call):
    rows = await db.pool.fetch(ATTENDANCE_SQL + " WHERE a.person_id = $1 ORDER BY t.clock_in_at DESC", call.me["id"])
    return reply({"items": [project(r) for r in rows]})


@api("POST", "/api/punches", roles=(CW, BC), keys=("kind",))
async def punch(call: Call):
    kind = call.body.get("kind")
    async with db.pool.acquire() as conn, conn.transaction():
        if replayed := await idempotency.replay(conn, call):
            return replayed
        # One person's punches run one at a time, so at most one attendance is ever open.
        await conn.execute("SELECT 1 FROM people WHERE id = $1 FOR UPDATE", call.me["id"])
        now = shifts.now()
        current = await attendance.open_attendance(conn, call.me["id"], lock=True)
        assignment = None
        if kind == "in":
            if current:
                raise ApiError("already_clocked_in")
            assignment = await attendance.clockable_assignment(conn, call.me["id"], now)
            if assignment is None:
                raise ApiError("no_rostered_shift")
        elif kind == "out" and current is None:
            raise ApiError("clock_out_window_closed" if await attendance.has_missed(conn, call.me["id"])
                           else "no_open_clock_in")
        fields = call.fields()
        idempotency.check_key(call, fields)
        if kind not in ("in", "out"):
            fields.fail("kind", "Choose in or out.")
        fields.check()
        if kind == "in":
            attendance_id = new_id("at")
            await conn.execute("INSERT INTO attendance (id, assignment_id, clock_in_at, late) VALUES ($1, $2, $3, $4)",
                               attendance_id, assignment["id"], now,
                               attendance.is_late(now, assignment["starts_at"]))
        else:
            attendance_id = current["id"]
            await conn.execute("UPDATE attendance SET clock_out_at = $2, version = version + 1 WHERE id = $1",
                               attendance_id, now)
        punch_id = new_id("pu")
        await conn.execute("INSERT INTO punches (id, person_id, attendance_id, kind, at) VALUES ($1, $2, $3, $4, $5)",
                           punch_id, call.me["id"], attendance_id, kind, now)
        return await idempotency.remember(conn, call, {
            "punch": {"id": punch_id, "kind": kind, "at": shifts.instant(now)},
            "attendance": project(await attendance.fetch(conn, attendance_id))}, 201)
