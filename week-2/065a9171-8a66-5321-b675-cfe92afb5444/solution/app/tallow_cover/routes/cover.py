"""Open cover for bank carers: the shifts they may claim, and the claim itself (first commit wins)."""

from .. import db, idempotency, shifts
from ..access import BC
from ..errors import ApiError
from ..projections import COVER_SQL, rota_entry
from ..projections import cover as project
from ..staffing import ROTA_SQL, add_assignment
from ..web import Call, api, reply

CREDENTIALED = "EXISTS (SELECT 1 FROM credentials k WHERE k.person_id = $1 AND k.home_id = c.home_id)"


@api("GET", "/api/cover-shifts", roles=(BC,))
async def open_cover(call: Call):
    rows = await db.pool.fetch(
        COVER_SQL + f" WHERE c.status = 'open' AND {CREDENTIALED} AND (c.skill = 'carer' OR $2 = 'senior')"
        " AND c.date >= $3 ORDER BY c.date, array_position(ARRAY['early','late','night'], c.shift), h.name",
        call.me["id"], call.me["skill"], shifts.today())
    return reply({"items": [project(r, call.me) for r in rows]})


@api("POST", "/api/cover-shifts/{id}/claim", roles=(BC,))
async def claim(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        if replayed := await idempotency.replay(conn, call):
            return replayed
        cover = await conn.fetchrow(COVER_SQL + f" WHERE c.id = $2 AND {CREDENTIALED} FOR UPDATE OF c",
                                    call.me["id"], call.path("id"))
        if cover is None:
            raise ApiError("not_found")
        if cover["skill"] == "senior" and call.me["skill"] != "senior":
            raise ApiError("skill_required")
        if cover["status"] == "claimed":
            raise ApiError("already_taken")
        if cover["status"] == "cancelled":
            raise ApiError("cover_closed")
        assignment_id = await add_assignment(conn, call.me["id"], cover["home_id"], cover["unit_id"], cover["date"],
                                             cover["shift"])
        fields = call.fields()
        idempotency.check_key(call, fields)
        fields.check()
        await conn.execute("UPDATE covers SET status = 'claimed', claimed_by = $2, assignment_id = $3 WHERE id = $1",
                           cover["id"], call.me["id"], assignment_id)
        claimed = await conn.fetchrow(COVER_SQL + " WHERE c.id = $1", cover["id"])
        assignment = await conn.fetchrow(ROTA_SQL + " WHERE a.id = $1", assignment_id)
        return await idempotency.remember(conn, call, {"cover": project(claimed, call.me),
                                                       "assignment": rota_entry(assignment, call.me)}, 200)
