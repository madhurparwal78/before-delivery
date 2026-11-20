"""Leave requests: create, edit, submit, withdraw, decide, cancel, the staffing preview and posting cover."""

from datetime import date, timedelta

from .. import audit, db, leave, mail, shifts
from ..access import CW, HR, UM, require
from ..errors import REASON_MSG, ApiError, invalid, reason
from ..ids import new_id
from ..leave import AWAITING, Draft
from ..projections import COVER_SQL, LEAVE_SQL
from ..projections import cover as project_cover
from ..projections import leave_request as project
from ..staffing import ShiftState, unit_states
from ..web import Call, api, reply


async def fetch(conn, request_id: str, *, lock: bool = False):
    return await conn.fetchrow(LEAVE_SQL + " WHERE lr.id = $1" + (" FOR UPDATE OF lr" if lock else ""), request_id)


async def visible(conn, me, request_id: str, *, lock: bool = False):
    """The request for its owner, an HR admin or a unit manager of its home; otherwise not_found."""
    request = await fetch(conn, request_id, lock=lock)
    if request is None or not (request["requester_id"] == me["id"] or me["role"] == HR
                               or (me["role"] == UM and me["home_id"] == request["home_id"])):
        raise ApiError("not_found")
    return request


def require_owner(me, request) -> None:
    if request["requester_id"] != me["id"]:
        raise ApiError("forbidden")


def require_decider(me, request) -> None:
    require(me, UM, HR)
    if request["requester_id"] == me["id"]:
        raise ApiError("own_request")


async def respond(conn, request_id: str, status: int = 200):
    return reply(project(await fetch(conn, request_id)), status)


def current(request) -> Draft:
    return Draft(request["type"], request["start_date"], request["end_date"], request["note"])


async def lock_person(conn, person_id: str) -> None:
    """Serialises one person's submissions so overlap and balance checks see each other."""
    await conn.execute("SELECT 1 FROM people WHERE id = $1 FOR UPDATE", person_id)


async def cancel_open_covers(conn, request_id: str) -> None:
    await conn.execute("UPDATE covers SET status = 'cancelled' WHERE leave_request_id = $1 AND status = 'open'",
                       request_id)


async def requester_states(conn, request, first: date, last: date) -> list[ShiftState]:
    """The request's unit shifts, with `affected` set only while the request awaits a decision."""
    requester = None
    if request["status"] in AWAITING:
        requester = await conn.fetchrow("SELECT id, skill FROM people WHERE id = $1", request["requester_id"])
    return await unit_states(conn, request["unit_id"], first, last, request, requester)


def read_reason(call: Call) -> str:
    fields = call.fields()
    why = reason(call.body.get("reason"))
    if why is None:
        fields.fail("reason", REASON_MSG)
    fields.check()
    return why


def uncovered(states: list[ShiftState]) -> list[ShiftState]:
    return [s for s in states if s.affected and s.below_floor]


@api("GET", "/api/me/leave-requests", roles=(CW, UM))
async def mine(call: Call):
    rows = await db.pool.fetch(LEAVE_SQL + " WHERE lr.requester_id = $1 ORDER BY lr.start_date DESC, lr.created_at DESC",
                               call.me["id"])
    return reply({"items": [project(r) for r in rows]})


@api("POST", "/api/leave-requests", roles=(CW, UM), keys=("type", "start_date", "end_date", "note", "submit"))
async def create(call: Call):
    fields = call.fields()
    draft = leave.read_draft(fields, call.body)
    submit = call.body.get("submit") is True
    async with db.pool.acquire() as conn, conn.transaction():
        await lock_person(conn, call.me["id"])
        hours = await leave.rostered_seconds(conn, call.me["id"], draft)
        if submit:
            await leave.check_submission(conn, call.me["id"], draft, fields, hours)
        fields.check()
        request_id = new_id("lr")
        await conn.execute(
            "INSERT INTO leave_requests (id, requester_id, home_id, unit_id, type, start_date, end_date, note, status,"
            " hours_seconds, short_notice, submitted_at) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,"
            " CASE WHEN $12::boolean THEN now() END)",
            request_id, call.me["id"], call.me["home_id"], call.me["unit_id"], draft.type, draft.start, draft.end,
            draft.note, "submitted" if submit else "draft", hours,
            submit and await leave.is_short_notice(conn, call.me["home_id"], draft), submit)
        return await respond(conn, request_id, 201)


@api("GET", "/api/leave-requests/{id}")
async def one(call: Call):
    async with db.pool.acquire() as conn:
        return reply(project(await visible(conn, call.me, call.path("id"))))


@api("PATCH", "/api/leave-requests/{id}", keys=("type", "start_date", "end_date", "note"))
async def edit(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require_owner(call.me, request)
        leave.transition(request["status"], "edit")
        fields = call.fields()
        draft = leave.read_draft(fields, call.body, current(request))
        fields.check()
        await conn.execute("UPDATE leave_requests SET type = $2, start_date = $3, end_date = $4, note = $5,"
                           " hours_seconds = $6 WHERE id = $1", request["id"], draft.type, draft.start, draft.end,
                           draft.note, await leave.rostered_seconds(conn, call.me["id"], draft))
        return await respond(conn, request["id"])


@api("POST", "/api/leave-requests/{id}/submit")
async def submit(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require_owner(call.me, request)
        target = leave.transition(request["status"], "submit")
        await lock_person(conn, call.me["id"])
        fields = call.fields()
        draft = leave.read_draft(fields, {}, current(request))
        hours = await leave.rostered_seconds(conn, call.me["id"], draft)
        await leave.check_submission(conn, call.me["id"], draft, fields, hours, request["id"])
        fields.check()
        await conn.execute("UPDATE leave_requests SET status = $2, submitted_at = now(), short_notice = $3,"
                           " hours_seconds = $4 WHERE id = $1", request["id"], target,
                           await leave.is_short_notice(conn, request["home_id"], draft), hours)
        return await respond(conn, request["id"])


@api("POST", "/api/leave-requests/{id}/withdraw")
async def withdraw(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require_owner(call.me, request)
        target = leave.transition(request["status"], "withdraw")
        if request["status"] == "approved":
            first_start = await conn.fetchval(
                "SELECT min(starts_at) FROM assignments WHERE person_id = $1 AND date BETWEEN $2 AND $3",
                request["requester_id"], request["start_date"], request["end_date"])
            if shifts.now() >= leave.first_shift_cutoff(first_start, request["start_date"]):
                raise ApiError("already_started")
        call.fields().check()
        await conn.execute("UPDATE leave_requests SET status = $2 WHERE id = $1", request["id"], target)
        await cancel_open_covers(conn, request["id"])
        return await respond(conn, request["id"])


@api("POST", "/api/leave-requests/{id}/approve", keys=("override_reason",))
async def approve(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require_decider(call.me, request)
        target = leave.transition(request["status"], "approve")
        override = call.body.get("override_reason")
        breaches = []
        if request["unit_id"] is not None:
            await conn.execute("SELECT 1 FROM units WHERE id = $1 FOR UPDATE", request["unit_id"])
            breaches = uncovered(await requester_states(conn, request, request["start_date"], request["end_date"]))
        if breaches and override is None:
            count = len(breaches)
            raise ApiError("floor_breach", f"Approving would leave {count} shift{'' if count == 1 else 's'} below floor.",
                           breaches=[s.breach() for s in breaches])
        fields = call.fields()
        if override is not None and reason(override) is None:
            fields.fail("override_reason", REASON_MSG)
        fields.check()
        await conn.execute("UPDATE leave_requests SET status = $2, decided_at = now(), decided_by = $3,"
                           " decision_reason = $4 WHERE id = $1", request["id"], target, call.me["id"], override)
        approved = await fetch(conn, request["id"])
        if override is not None:
            labels = [shifts.short_label(s.day, s.shift) for s in breaches]
            await audit.record(conn, call.me, "floor_override", request["home_id"], ("leave_request", request["id"]),
                               project(request), {**project(approved), "breach_labels": labels}, override)
        await mail.leave_approved(conn, approved, call.me["display_name"])
        return reply(project(approved))


@api("POST", "/api/leave-requests/{id}/decline", keys=("reason",))
async def decline(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require_decider(call.me, request)
        target = leave.transition(request["status"], "decline")
        why = read_reason(call)
        await conn.execute("UPDATE leave_requests SET status = $2, decided_at = now(), decided_by = $3,"
                           " decision_reason = $4 WHERE id = $1", request["id"], target, call.me["id"], why)
        await cancel_open_covers(conn, request["id"])
        await mail.leave_declined(conn, request, why)
        return await respond(conn, request["id"])


@api("POST", "/api/leave-requests/{id}/cancel", keys=("reason",))
async def cancel(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require(call.me, HR)
        target = leave.transition(request["status"], "cancel")
        why = read_reason(call)
        await conn.execute("UPDATE leave_requests SET status = $2, decided_at = now(), decided_by = $3,"
                           " decision_reason = $4 WHERE id = $1", request["id"], target, call.me["id"], why)
        await cancel_open_covers(conn, request["id"])
        cancelled = await fetch(conn, request["id"])
        await audit.record(conn, call.me, "leave_cancelled", request["home_id"], ("leave_request", request["id"]),
                           project(request), project(cancelled), why)
        await mail.leave_cancelled(conn, request, why)
        return reply(project(cancelled))


def shift_body(state: ShiftState, me) -> dict:
    return {
        "date": state.day.isoformat(), "shift": state.shift, "label": shifts.shift_label(state.day, state.shift),
        "floor": {"min_staff": state.floor.min_staff, "min_seniors": state.floor.min_seniors,
                  "effective_from": state.floor.effective_from.isoformat()},
        "on_duty": state.on_duty, "seniors_on_duty": state.seniors_on_duty, "affected": state.affected,
        "on_duty_if_approved": state.on_duty_if_approved, "seniors_if_approved": state.seniors_if_approved,
        "shortfall": state.shortfall, "senior_shortfall": state.senior_shortfall,
        "gaps": [{"skill": skill, "cover": project_cover(c, me) if c else None} for skill, c in state.gaps()],
    }


@api("GET", "/api/leave-requests/{id}/preview")
async def preview(call: Call):
    async with db.pool.acquire() as conn:
        request = await visible(conn, call.me, call.path("id"))
        require(call.me, UM, HR)
        start, end = request["start_date"], request["end_date"]
        first = shifts.parse_date(call.query("from", start.isoformat()))
        if first is None or not start <= first <= end:
            raise invalid(**{"from": "Choose a date inside this request."})
        last = first + timedelta(days=6)
        body = {"request_id": request["id"], "unit_id": request["unit_id"], "from": first.isoformat(),
                "to": last.isoformat(), "scale_max": 0, "uncovered_breaches": 0, "breach_labels": [],
                "approvable": request["status"] in AWAITING, "shifts": []}
        if request["unit_id"] is None:
            return reply(body)
        states = await requester_states(conn, request, start, max(end, last))
        page = [s for s in states if first <= s.day <= last]
        breaches = uncovered(states)
        body.update(scale_max=max(max(s.on_duty, s.floor.min_staff + 2) for s in page),
                    uncovered_breaches=len(breaches), breach_labels=[shifts.short_label(s.day, s.shift) for s in breaches],
                    approvable=request["status"] in AWAITING and not breaches,
                    shifts=[shift_body(s, call.me) for s in page])
        return reply(body)


@api("POST", "/api/leave-requests/{id}/covers", keys=("date", "shift", "skill"))
async def post_cover(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        request = await visible(conn, call.me, call.path("id"), lock=True)
        require_decider(call.me, request)
        target = leave.transition(request["status"], "post_cover")
        day, shift, skill = shifts.parse_date(call.body.get("date")), call.body.get("shift"), call.body.get("skill")
        if (request["unit_id"] is None or day is None or shift not in shifts.SHIFTS
                or not request["start_date"] <= day <= request["end_date"] + timedelta(days=6)):
            raise ApiError("no_open_gap")
        (state,) = [s for s in await requester_states(conn, request, day, day) if s.shift == shift]
        if not any(gap_skill == skill and c is None for gap_skill, c in state.gaps()):
            raise ApiError("no_open_gap")
        call.fields().check()
        cover_id = new_id("cv")
        await conn.execute("INSERT INTO covers (id, leave_request_id, home_id, unit_id, date, shift, skill, status)"
                           " VALUES ($1, $2, $3, $4, $5, $6, $7, 'open')", cover_id, request["id"],
                           request["home_id"], request["unit_id"], day, shift, skill)
        await conn.execute("UPDATE leave_requests SET status = $2 WHERE id = $1", request["id"], target)
        cover = await conn.fetchrow(COVER_SQL + " WHERE c.id = $1", cover_id)
        await mail.cover_open(conn, cover)
        return reply(project_cover(cover, call.me), 201)
