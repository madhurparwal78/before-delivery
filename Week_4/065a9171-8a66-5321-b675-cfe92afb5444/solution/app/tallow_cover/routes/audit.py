"""The audit log, newest first. Entries can never be changed or deleted."""

from starlette.requests import Request
from starlette.routing import Route

from .. import access, db, shifts
from ..access import HR, UM, require
from ..errors import ApiError
from ..web import ROUTES, Call, api, reply

LIMIT = 500


@api("GET", "/api/audit")
async def audit_log(call: Call):
    async with db.pool.acquire() as conn:
        home_id = call.query("home")
        if home_id is None and call.me["role"] == HR:
            homes = list(await access.home_ids(conn, call.me))
        else:
            homes = [(await access.home(conn, call.me, home_id or call.me["home_id"]))["id"]]
        require(call.me, UM, HR)
        rows = await conn.fetch(
            "SELECT e.* FROM audit_entries e"
            " WHERE e.home_id = ANY($1::text[]) ORDER BY e.at DESC, e.seq DESC LIMIT $2", homes, LIMIT)
        return reply({"items": [{
            "id": r["id"], "at": shifts.instant(r["at"]),
            "actor": {"id": r["actor_id"], "display_name": r["actor_name"], "role": r["actor_role"]},
            "action": r["action"], "home_id": r["home_id"], "target": {"type": r["target_type"], "id": r["target_id"]},
            "before": r["before"], "after": r["after"], "reason": r["reason"]} for r in rows]})


async def refuse_change(_: Request):
    """Audit entries can never be changed or deleted: every such call is refused the same way."""
    raise ApiError("method_not_allowed")


ROUTES.extend(Route(path, refuse_change, methods=["PUT", "PATCH", "DELETE"]) for path in ("/api/audit", "/api/audit/{id}"))
