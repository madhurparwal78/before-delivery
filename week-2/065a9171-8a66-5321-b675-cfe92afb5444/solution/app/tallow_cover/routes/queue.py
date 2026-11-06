"""The approval queue: one home's requests filtered by status and ISO week, with per-status counts."""

import re
from datetime import date, timedelta

from .. import access, db
from ..access import HR, UM
from ..errors import invalid
from ..leave import AWAITING
from ..projections import LEAVE_SQL
from ..projections import leave_request as project
from ..web import Call, api, reply

FILTERS = {"open": tuple(sorted(AWAITING)), "submitted": ("submitted",),
           "escalated": ("escalated",), "cover_pending": ("cover_pending",), "approved": ("approved",),
           "declined": ("declined",), "withdrawn": ("withdrawn",), "cancelled": ("cancelled",)}
COUNTED = ("submitted", "escalated", "cover_pending", "approved", "declined")
WEEK = re.compile(r"^(\d{4})-W(\d{2})$")


def week_span(value: str) -> tuple[date, date] | None:
    match = WEEK.match(value)
    if not match:
        return None
    try:
        monday = date.fromisocalendar(int(match.group(1)), int(match.group(2)), 1)
    except ValueError:
        return None
    return monday, monday + timedelta(days=6)


@api("GET", "/api/queue")
async def queue(call: Call):
    async with db.pool.acquire() as conn:
        default = call.me["home_id"] or await conn.fetchval("SELECT id FROM homes ORDER BY name LIMIT 1")
        home = await access.home(conn, call.me, call.query("home") or default)
        access.require(call.me, UM, HR)
        status, week = call.query("status") or "open", call.query("week") or ""
        errors = {}
        if status not in FILTERS:
            errors["status"] = "Choose a queue status."
        span = week_span(week) if week else (date.min, date.max)
        if span is None:
            errors["week"] = "Choose an ISO week like 2026-W44."
        if errors:
            raise invalid(**errors)
        rows = await conn.fetch(
            LEAVE_SQL + " WHERE lr.home_id = $1 AND lr.status <> 'draft' AND lr.start_date <= $3 AND lr.end_date >= $2"
            " ORDER BY lr.start_date, lr.submitted_at", home["id"], *span)
        return reply({
            "home_id": home["id"],
            "counts": {s: sum(r["status"] == s for r in rows) for s in COUNTED},
            "items": [project(r) for r in rows if r["status"] in FILTERS[status]],
        })
