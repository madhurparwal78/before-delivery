"""Holiday accrual and pay periods."""

from __future__ import annotations

from datetime import timedelta
from decimal import Decimal

from flask import Blueprint

from .. import projections
from ..db import Unique, execute, rows
from ..domain.accrual import accrued_hours, ledger_worked_hours
from ..domain.attendance import worked_seconds
from ..errors import ApiError
from ..projections import ATTENDANCE_SELECT
from ..responses import api_response
from ..timeutil import iso_instant, now_utc, parse_period, period_bounds, period_of, today_london
from .common import endpoint, new_id, read_body, require_roles

blueprint = Blueprint("accrual", __name__)


def _bank_carers(conn) -> list[dict]:
    return rows(conn, "SELECT id FROM people WHERE role = 'bank_carer' ORDER BY id")


def _worked_seconds_in(conn, person_id: str, period: str, now) -> Decimal:
    first, last = period_bounds(period)
    total = Decimal(0)
    for record in rows(
        conn,
        f"{ATTENDANCE_SELECT} WHERE a.person_id = %s AND a.shift_date BETWEEN %s AND %s",
        (person_id, first, last),
    ):
        total += worked_seconds(record, now)
    return total


@blueprint.get("/api/me/accrual")
@endpoint()
def read_accrual(conn, person):
    require_roles(person, "bank_carer")
    now = now_utc()
    entries = rows(
        conn,
        """SELECT id, period, kind, worked_hours, accrued_hours, created_at
           FROM accrual_ledger WHERE person_id = %s ORDER BY created_at, id""",
        (person["id"],),
    )
    total = sum((Decimal(entry["accrued_hours"]) for entry in entries), Decimal(0))
    period = period_of(today_london())
    open_seconds = _worked_seconds_in(conn, person["id"], period, now)
    return api_response(
        {
            "entries": [projections.ledger_entry(entry) for entry in entries],
            "ledger_total_hours": f"{total:.4f}",
            "open_period": {
                "period": period,
                "worked_hours": f"{open_seconds / Decimal(3600):.2f}",
                "pending_accrual_hours": f"{accrued_hours(open_seconds):.4f}",
            },
        }
    )


@blueprint.get("/api/pay-periods")
@endpoint()
def list_pay_periods(conn, person):
    require_roles(person, "hr_admin")
    closed = {
        record["period"]: record["closed_at"]
        for record in rows(conn, "SELECT period, closed_at FROM pay_periods")
    }
    earliest = rows(conn, "SELECT min(shift_date) AS first_date FROM attendance")
    first_date = earliest[0]["first_date"] if earliest else None
    today = today_london()
    months = []
    cursor = period_of(first_date) if first_date else period_of(today)
    for stored in closed:
        cursor = min(cursor, stored)
    current = period_of(today)
    while cursor <= current:
        months.append(cursor)
        _, last = period_bounds(cursor)
        cursor = period_of(last + timedelta(days=1))
    return api_response(
        {
            "items": [
                {
                    "period": period,
                    "closed_at": iso_instant(closed[period]) if period in closed else None,
                }
                for period in reversed(months)
            ]
        }
    )


@blueprint.post("/api/pay-periods/<period>/close")
@endpoint(write=True)
def close_pay_period(conn, person, period):
    body = read_body()
    require_roles(person, "hr_admin")
    if parse_period(period) is None:
        body.fail("period", "period")
        body.check()
    _, last_day = period_bounds(period)
    if last_day >= today_london():
        raise ApiError("period_not_ended")
    body.check()
    closed_at = now_utc()
    try:
        execute(
            conn,
            "INSERT INTO pay_periods (period, closed_at, closed_by) VALUES (%s, %s, %s)",
            (period, closed_at, person["id"]),
        )
    except Unique as error:
        raise ApiError("period_closed") from error
    now = now_utc()
    earlier_closed = [
        record["period"]
        for record in rows(
            conn,
            "SELECT period FROM pay_periods WHERE period < %s ORDER BY period",
            (period,),
        )
    ]
    entries = []
    for carer in _bank_carers(conn):
        seconds = _worked_seconds_in(conn, carer["id"], period, now)
        entries.append(
            _append_entry(
                conn,
                carer["id"],
                period,
                "period",
                ledger_worked_hours(seconds),
                accrued_hours(seconds),
            )
        )
        for earlier in earlier_closed:
            adjustment = _adjustment_for(conn, carer["id"], earlier, now)
            if adjustment is not None:
                entries.append(adjustment)
    return api_response(
        {
            "period": period,
            "closed_at": iso_instant(closed_at),
            "entries": entries,
        },
        201,
    )


def _append_entry(conn, person_id, period, kind, worked, accrued) -> dict:
    entry = {
        "id": new_id("acr"),
        "period": period,
        "kind": kind,
        "worked_hours": worked,
        "accrued_hours": accrued,
        "created_at": now_utc(),
    }
    execute(
        conn,
        """INSERT INTO accrual_ledger (id, person_id, period, kind, worked_hours,
                                       accrued_hours, created_at)
           VALUES (%s, %s, %s, %s, %s, %s, %s)""",
        (
            entry["id"],
            person_id,
            period,
            kind,
            worked,
            accrued,
            entry["created_at"],
        ),
    )
    return projections.ledger_entry(entry)


def _adjustment_for(conn, person_id: str, period: str, now) -> dict | None:
    """An earlier closed month whose worked seconds have changed since it was written."""
    seconds = _worked_seconds_in(conn, person_id, period, now)
    already = rows(
        conn,
        """SELECT coalesce(sum(worked_hours), 0) AS worked,
                  coalesce(sum(accrued_hours), 0) AS accrued
           FROM accrual_ledger WHERE person_id = %s AND period = %s""",
        (person_id, period),
    )[0]
    worked_delta = ledger_worked_hours(seconds) - Decimal(already["worked"])
    if worked_delta == 0:
        return None
    accrued_delta = accrued_hours(seconds) - Decimal(already["accrued"])
    return _append_entry(conn, person_id, period, "adjustment", worked_delta, accrued_delta)
