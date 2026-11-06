"""Payroll timesheet exports: CSV per pay period and homes, kept in the private bucket."""

import csv
import io

from .. import accrual, db, shifts, storage
from ..access import HR
from ..errors import ApiError
from ..ids import new_id
from ..projections import worked_seconds
from ..web import Call, api, reply

HEADER = ["home", "unit", "staff_number", "display_name", "role", "shift_date", "shift", "rostered_start",
          "rostered_end", "clock_in", "clock_out", "worked_hours", "late", "correction_note"]
FORMULA_LEADS = ("=", "+", "-", "@")


def neutralise(cell: str) -> str:
    """A cell a spreadsheet would run as a formula is written with a leading apostrophe, so it shows as text."""
    return "'" + cell if cell.startswith(FORMULA_LEADS) else cell


def timesheet(rows) -> str:
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\r\n")
    writer.writerow(HEADER)
    for r in rows:
        seconds = worked_seconds(r["clock_in_at"], r["clock_out_at"])
        writer.writerow([neutralise(cell) for cell in (
            r["home_name"], r["unit_name"], r["person_id"], r["display_name"], r["role"],
            r["date"].isoformat(), shifts.SHIFT_NAMES[r["shift"]], shifts.instant(r["starts_at"]),
            shifts.instant(r["ends_at"]), shifts.instant(r["clock_in_at"]), shifts.instant(r["clock_out_at"]) or "",
            "" if seconds is None else shifts.hours(seconds), "yes" if r["late"] else "no",
            r["correction_note"] or "")])
    return out.getvalue()


def export_body(r) -> dict:
    return {"id": r["id"], "period": r["period"], "home_ids": list(r["home_ids"]), "row_count": r["row_count"],
            "storage": "pending" if r["pending"] else "stored", "created_at": shifts.instant(r["created_at"])}


EXPORT_SQL = "SELECT *, held IS NOT NULL AS pending FROM exports"
TIMESHEET_SQL = """
SELECT t.clock_in_at, t.clock_out_at, t.late, t.correction_note, a.person_id, a.date, a.shift, a.starts_at, a.ends_at,
       p.display_name, p.role, h.name AS home_name, u.name AS unit_name
FROM attendance t JOIN assignments a ON a.id = t.assignment_id JOIN people p ON p.id = a.person_id
JOIN homes h ON h.id = a.home_id JOIN units u ON u.id = a.unit_id
WHERE a.home_id = ANY($1::text[]) AND a.date >= $2 AND a.date < $3
ORDER BY h.name, u.name, a.date, array_position(ARRAY['early','late','night'], a.shift), a.person_id
"""


@api("POST", "/api/exports/timesheets", roles=(HR,), keys=("period", "home_ids"))
async def create(call: Call):
    fields = call.fields()
    period, home_ids = call.body.get("period"), call.body.get("home_ids")
    if not isinstance(period, str) or not accrual.PERIOD.match(period):
        fields.fail("period", "Use a month like 2026-09.")
    async with db.pool.acquire() as conn:
        known = {r["id"] for r in await conn.fetch("SELECT id FROM homes")}
        if not isinstance(home_ids, list) or not home_ids:
            fields.fail("home_ids", "Choose at least one home.")
        elif not all(isinstance(home_id, str) and home_id in known for home_id in home_ids):
            fields.fail("home_ids", "Unknown home.")
        fields.check()
        chosen = list(dict.fromkeys(home_ids))
        first, following = accrual.period_bounds(period)
        rows = await conn.fetch(TIMESHEET_SQL, chosen, first, following)
        data = timesheet(rows).encode()
        export_id = new_id("ex")
        key = f"exports/timesheets/{period}/{export_id}.csv"
        stored = await storage.put(key, data, "text/csv")
        await conn.execute("INSERT INTO exports (id, period, home_ids, row_count, storage_key, held, created_by)"
                           " VALUES ($1, $2, $3, $4, $5, $6, $7)", export_id, period, chosen, len(rows), key,
                           None if stored else data, call.me["id"])
        return reply(export_body(await conn.fetchrow(EXPORT_SQL + " WHERE id = $1", export_id)), 201)


@api("GET", "/api/exports", roles=(HR,))
async def listing(call: Call):
    rows = await db.pool.fetch(EXPORT_SQL + " ORDER BY created_at DESC")
    return reply({"items": [export_body(r) for r in rows]})


@api("GET", "/api/exports/{id}/download", roles=(HR,))
async def download(call: Call):
    row = await db.pool.fetchrow(EXPORT_SQL + " WHERE id = $1", call.path("id"))
    if row is None:
        raise ApiError("not_found")
    if row["pending"]:
        raise ApiError("storage_pending")
    return reply({"url": storage.presigned_get(row["storage_key"], "text/csv", f"timesheets-{row['period']}.csv"),
                  "expires_in_seconds": storage.SIGNED_SECONDS})
