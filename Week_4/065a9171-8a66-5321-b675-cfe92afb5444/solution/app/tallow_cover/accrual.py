"""Holiday accrual for bank carers: the 12.07% formula, worked time per pay period and period closing."""

import re
from datetime import date
from decimal import ROUND_CEILING, ROUND_HALF_UP, Decimal

import asyncpg

from .ids import new_id

ACCRUAL_RATE = Decimal("0.1207")
FOUR_PLACES = Decimal("0.0001")
PERIOD = re.compile(r"^(\d{4})-(0[1-9]|1[0-2])$")


def accrued_hours(worked_seconds: int) -> Decimal:
    """Worked seconds × 0.1207 ÷ 3,600, rounded up at the fourth decimal place, never down."""
    return (Decimal(worked_seconds) * ACCRUAL_RATE / 3600).quantize(FOUR_PLACES, ROUND_CEILING)


def worked_hours(worked_seconds: int) -> Decimal:
    return (Decimal(worked_seconds) / 3600).quantize(FOUR_PLACES, ROUND_HALF_UP)


def period_bounds(period: str) -> tuple[date, date]:
    year, month = map(int, period.split("-"))
    following = date(year + month // 12, month % 12 + 1, 1)
    return date(year, month, 1), following


async def worked_seconds(conn: asyncpg.Connection, period: str) -> dict[str, int]:
    """Each bank carer's worked seconds in a month: attendances with a clock-out, by shift date."""
    first, following = period_bounds(period)
    rows = await conn.fetch(
        "SELECT p.id, coalesce(sum(extract(epoch FROM t.clock_out_at - t.clock_in_at)), 0)::bigint AS seconds"
        " FROM people p LEFT JOIN assignments a ON a.person_id = p.id AND a.date >= $1 AND a.date < $2"
        " LEFT JOIN attendance t ON t.assignment_id = a.id AND t.clock_out_at IS NOT NULL"
        " WHERE p.role = 'bank_carer' GROUP BY p.id ORDER BY p.id", first, following)
    return {r["id"]: r["seconds"] for r in rows}


async def close_period(conn: asyncpg.Connection, period: str) -> list[asyncpg.Record]:
    """One period entry per bank carer, plus an adjustment for each earlier closed month that has changed."""
    added = []
    for person_id, seconds in (await worked_seconds(conn, period)).items():
        added.append((new_id("le"), person_id, period, "period", seconds, worked_hours(seconds), accrued_hours(seconds)))
    for earlier in await conn.fetch("SELECT period FROM pay_periods WHERE period < $1 ORDER BY period", period):
        current = await worked_seconds(conn, earlier["period"])
        ledger = {r["person_id"]: r for r in await conn.fetch(
            "SELECT person_id, sum(worked_seconds) AS seconds, sum(worked_hours) AS hours, sum(accrued_hours) AS accrued"
            " FROM ledger_entries WHERE period = $1 GROUP BY person_id", earlier["period"])}
        for person_id, seconds in current.items():
            entry = ledger.get(person_id)
            if entry is not None and entry["seconds"] != seconds:
                added.append((new_id("le"), person_id, earlier["period"], "adjustment", seconds - entry["seconds"],
                              worked_hours(seconds) - entry["hours"], accrued_hours(seconds) - entry["accrued"]))
    await conn.executemany("INSERT INTO ledger_entries (id, person_id, period, kind, worked_seconds, worked_hours,"
                           " accrued_hours) VALUES ($1, $2, $3, $4, $5, $6, $7)", added)
    return await conn.fetch("SELECT * FROM ledger_entries WHERE id = ANY($1::text[]) ORDER BY seq",
                            [a[0] for a in added])
