"""Holiday accrual for bank carers and pay-period closing for HR."""

from decimal import Decimal

from .. import accrual, db, shifts
from ..access import BC, HR
from ..errors import ApiError, invalid
from ..web import Call, api, reply

LISTED_MONTHS = 12


def entry_body(r) -> dict:
    return {"id": r["id"], "period": r["period"], "kind": r["kind"], "worked_hours": str(r["worked_hours"]),
            "accrued_hours": str(r["accrued_hours"]), "created_at": shifts.instant(r["created_at"])}


def month_before(period: str) -> str:
    year, month = map(int, period.split("-"))
    return f"{year - (month == 1):04d}-{(month - 2) % 12 + 1:02d}"


@api("GET", "/api/me/accrual", roles=(BC,))
async def my_accrual(call: Call):
    async with db.pool.acquire() as conn:
        rows = await conn.fetch("SELECT * FROM ledger_entries WHERE person_id = $1 ORDER BY seq", call.me["id"])
        period = shifts.today().strftime("%Y-%m")
        seconds = (await accrual.worked_seconds(conn, period))[call.me["id"]]
        return reply({
            "entries": [entry_body(r) for r in rows],
            "ledger_total_hours": str(sum((r["accrued_hours"] for r in rows), Decimal("0.0000"))),
            "open_period": {"period": period, "worked_hours": str(accrual.worked_hours(seconds)),
                            "pending_accrual_hours": str(accrual.accrued_hours(seconds))},
        })


@api("GET", "/api/pay-periods", roles=(HR,))
async def pay_periods(call: Call):
    async with db.pool.acquire() as conn:
        closed = {r["period"]: r["closed_at"] for r in await conn.fetch("SELECT * FROM pay_periods")}
        months = [shifts.today().strftime("%Y-%m")]
        while len(months) < LISTED_MONTHS:
            months.append(month_before(months[-1]))
        periods = sorted(set(months) | set(closed), reverse=True)
        return reply({"items": [{"period": p, "closed_at": shifts.instant(closed.get(p))} for p in periods]})


@api("POST", "/api/pay-periods/{period}/close", roles=(HR,))
async def close(call: Call):
    period = call.path("period")
    if not accrual.PERIOD.match(period):
        raise invalid(period="Use a month like 2026-09.")
    async with db.pool.acquire() as conn, conn.transaction():
        closed_at = await conn.fetchval("INSERT INTO pay_periods (period, closed_by) VALUES ($1, $2)"
                                        " ON CONFLICT (period) DO NOTHING RETURNING closed_at", period, call.me["id"])
        if closed_at is None:
            raise ApiError("period_closed")
        if accrual.period_bounds(period)[1] > shifts.today():
            raise ApiError("period_not_ended")
        call.fields().check()
        entries = await accrual.close_period(conn, period)
        return reply({"period": period, "closed_at": shifts.instant(closed_at),
                      "entries": [{**entry_body(e), "person_id": e["person_id"]} for e in entries]}, 201)
