"""The auditor's ledger and signals."""

from __future__ import annotations

from . import db
from .api_exhibits import _entry_view, paging
from .errors import ApiError
from .http import Context, route
from .rules import ROLE_AUDITOR
from .validation import is_unstorable
from .views import format_time


@route("/api/ledger", ["GET"])
def read_ledger(ctx: Context):
    if ctx.user["role"] != ROLE_AUDITOR:
        raise ApiError("forbidden")
    after, limit = paging(ctx)
    action = ctx.query.get("action")
    if action is not None and is_unstorable(action):
        action = "\x00"
    with db.tx() as cur:
        cur.execute("SELECT count(*) AS n FROM ledger_entries")
        count = int(cur.fetchone()["n"])
        if action:
            cur.execute(
                """
                SELECT * FROM ledger_entries WHERE seq > %s AND action = %s
                ORDER BY seq LIMIT %s
                """,
                (after, action, limit),
            )
        else:
            cur.execute(
                "SELECT * FROM ledger_entries WHERE seq > %s ORDER BY seq LIMIT %s",
                (after, limit),
            )
        entries = [_entry_view(dict(row)) for row in cur.fetchall()]
    return 200, {"entries": entries, "count": count}


@route("/api/signals", ["GET"])
def read_signals(ctx: Context):
    if ctx.user["role"] != ROLE_AUDITOR:
        raise ApiError("forbidden")
    with db.tx() as cur:
        cur.execute("SELECT * FROM signals ORDER BY id")
        signals = [
            {
                "id": row["id"],
                "kind": row["kind"],
                "at": format_time(row["at"]),
                "target": row["target"],
            }
            for row in cur.fetchall()
        ]
    return 200, {"signals": signals}
