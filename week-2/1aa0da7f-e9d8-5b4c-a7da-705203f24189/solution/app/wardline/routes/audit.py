"""The auditor's ledger and signals, and custody history."""

from __future__ import annotations

import re

from wardline import fields
from wardline.access import authorise, may, require_grant, require_role
from wardline.db import DB
from wardline.ledger import entry_json
from wardline.routes.exhibits import load_exhibit
from wardline.web import Reply, Request, route

_WHOLE = re.compile(r"[0-9]{1,19}")
MAX_INT64 = 2**63 - 1


def _page_params(request: Request) -> tuple[int, int]:
    def number(name: str) -> int | None:
        text = request.query.get(name, "")
        if not _WHOLE.fullmatch(text) or int(text) > MAX_INT64:
            return None
        return int(text)

    after = number("after") or 0
    limit = number("limit")
    if limit is None or limit < 1:
        limit = 200
    return after, min(limit, 1000)


@route("GET", "/api/ledger")
async def read_ledger(request: Request) -> Reply:
    require_role(request, "read_ledger")
    after, limit = _page_params(request)
    action = request.query.get("action") or None
    async with DB.connection() as conn:
        count = await conn.fetchval("SELECT count(*) FROM ledger_entries")
        if action is not None and fields.unstorable(action):
            rows = []
        else:
            rows = await conn.fetch(
                """SELECT * FROM ledger_entries WHERE seq > $1 AND ($3::text IS NULL OR action = $3)
                   ORDER BY seq LIMIT $2""",
                after, limit, action,
            )
    return Reply(200, {"entries": [entry_json(r) for r in rows], "count": count})


@route("GET", "/api/signals")
async def read_signals(request: Request) -> Reply:
    require_role(request, "read_ledger")
    async with DB.connection() as conn:
        rows = await conn.fetch("SELECT * FROM signals ORDER BY at, id")
    return Reply(200, {"signals": [
        {"id": r["id"], "kind": r["kind"], "at": fields.format_time(r["at"]), "target": r["target"]} for r in rows
    ]})


@route("GET", "/api/exhibits/{id}/custody")
async def read_custody(request: Request) -> Reply:
    identifier = request.params["id"]
    after, limit = _page_params(request)
    async with DB.connection() as conn:
        row = await load_exhibit(request, conn)
        if not may(request, "read_any_custody"):
            standing = await require_grant(request, conn, row["compartment_id"], identifier)
            authorise(request, standing, "read_custody", identifier)
        rows = await conn.fetch(
            """SELECT * FROM ledger_entries
               WHERE seq > $1 AND (target = $2 OR detail->>'exhibit_id' = $2
                 OR target IN (SELECT id FROM derivatives WHERE exhibit_id = $2))
               ORDER BY seq LIMIT $3""",
            after, row["id"], limit + 1,
        )
    more = len(rows) > limit
    page = rows[:limit]
    return Reply(200, {"entries": [entry_json(r) for r in page], "next_after": page[-1]["seq"] if more else None})
