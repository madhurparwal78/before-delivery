"""The team rota, rota edits, the colleague picker and the home's Today totals."""

from datetime import timedelta

from starlette.responses import Response

from .. import access, db, shifts
from ..access import BC, CW, HR, UM, require
from ..attendance import ATTENDANCE_SQL, MISSED
from ..errors import ApiError
from ..projections import attendance, rota_entry
from ..staffing import ROTA_SQL, add_assignment, rota_rows, unit_states
from ..web import Call, api, reply

PICKER_LIMIT = 20
MISSED_LISTED_DAYS = 7
# People a home's rota may address: its care workers and the bank carers credentialed there.
ROSTERABLE = """((p.role = 'care_worker' AND p.home_id = $1) OR (p.role = 'bank_carer'
    AND EXISTS (SELECT 1 FROM credentials c WHERE c.person_id = p.id AND c.home_id = $1)))"""


@api("GET", "/api/units/{unit_id}/rota")
async def unit_rota(call: Call):
    async with db.pool.acquire() as conn:
        unit = await access.unit(conn, call.me, call.path("unit_id"))
        require(call.me, CW, UM, HR)
        first = shifts.parse_date(call.query("from")) or shifts.monday(shifts.today())
        last = first + timedelta(days=6)
        rows = await rota_rows(conn, unit["id"], first, last)
        return reply({"unit_id": unit["id"], "from": first.isoformat(), "to": last.isoformat(),
                      "entries": [rota_entry(r, call.me) for r in rows]})


@api("POST", "/api/rota/assignments", keys=("person_id", "unit_id", "date", "shift"))
async def post_assignment(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        unit = await access.unit(conn, call.me, call.body.get("unit_id"))
        require(call.me, UM, HR)
        person = await conn.fetchrow("SELECT * FROM people WHERE id = $1", call.body.get("person_id"))
        if person is None or person["role"] in (CW, BC) and not await conn.fetchval(
                f"SELECT EXISTS (SELECT 1 FROM people p WHERE {ROSTERABLE} AND p.id = $2)", unit["home_id"], person["id"]):
            raise ApiError("not_found")
        fields = call.fields()
        day, shift = shifts.parse_date(call.body.get("date")), call.body.get("shift")
        if day is None:
            fields.fail("date", "Use a date like 2026-09-14.")
        if shift not in shifts.SHIFTS:
            fields.fail("shift", "Choose early, late or night.")
        if person["role"] not in (CW, BC):
            fields.fail("person_id", "Only care workers and bank carers can be rostered.")
        if fields.ok("date", "shift", "person_id"):
            assignment_id = await add_assignment(conn, person["id"], unit["home_id"], unit["id"], day, shift)
        fields.check()
        row = await conn.fetchrow(ROTA_SQL + " WHERE a.id = $1", assignment_id)
        return reply(rota_entry(row, call.me), 201)


@api("DELETE", "/api/rota/assignments/{id}")
async def delete_assignment(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        row = await conn.fetchrow("SELECT * FROM assignments WHERE id = $1 FOR UPDATE", call.path("id"))
        if row is None:
            raise ApiError("not_found")
        await access.home(conn, call.me, row["home_id"])
        require(call.me, UM, HR)
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM attendance WHERE assignment_id = $1)", row["id"]):
            raise ApiError("has_attendance")
        # A claimed cover behind the assignment ends with it; its claimant stays recorded.
        await conn.execute("UPDATE covers SET status = 'cancelled' WHERE assignment_id = $1", row["id"])
        await conn.execute("DELETE FROM assignments WHERE id = $1", row["id"])
        return Response(status_code=204, headers={"Cache-Control": "no-store"})


@api("GET", "/api/homes/{home_id}/people")
async def people_picker(call: Call):
    async with db.pool.acquire() as conn:
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, UM, HR)
        pattern = "%" + (call.query("q") or "").lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        rows = await conn.fetch(f"SELECT p.id, p.display_name, p.role, p.skill FROM people p WHERE {ROSTERABLE}"
                                " AND (lower(p.display_name) LIKE $2 OR lower(p.id) LIKE $2)"
                                " ORDER BY p.display_name LIMIT $3", home["id"], pattern, PICKER_LIMIT)
        return reply({"items": [dict(r) for r in rows]})


@api("GET", "/api/homes/{home_id}/today")
async def today(call: Call):
    async with db.pool.acquire() as conn:
        home = await access.home(conn, call.me, call.path("home_id"))
        require(call.me, UM, HR)
        day = shifts.today()
        units = []
        for unit in await conn.fetch("SELECT * FROM units WHERE home_id = $1 ORDER BY position", home["id"]):
            states = await unit_states(conn, unit["id"], day, day)
            units.append({"unit_id": unit["id"], "name": unit["name"], "shifts": [
                {"shift": s.shift, "on_duty": s.on_duty, "seniors_on_duty": s.seniors_on_duty,
                 "floor": {"min_staff": s.floor.min_staff, "min_seniors": s.floor.min_seniors},
                 "shortfall": s.shortfall, "senior_shortfall": s.senior_shortfall} for s in states]})
        late = await conn.fetch(ATTENDANCE_SQL + " WHERE a.home_id = $1 AND t.late AND NOT t.late_acknowledged"
                                " ORDER BY t.clock_in_at DESC", home["id"])
        missed = await conn.fetch(ATTENDANCE_SQL + f" WHERE a.home_id = $1 AND {MISSED} AND a.date BETWEEN $2 AND $3"
                                  " ORDER BY a.starts_at", home["id"],
                                  day - timedelta(days=MISSED_LISTED_DAYS - 1), day)
        listed = [s for u in units for s in u["shifts"]]
        return reply({"date": day.isoformat(), "units": units,
                      "totals": {"on_duty": sum(s["on_duty"] for s in listed),
                                 "seniors_on_duty": sum(s["seniors_on_duty"] for s in listed),
                                 "below_floor": sum(s["shortfall"] > 0 or s["senior_shortfall"] > 0 for s in listed)},
                      "late_clock_ins": [attendance(r) for r in late],
                      "missed_clock_outs": [attendance(r) for r in missed]})
