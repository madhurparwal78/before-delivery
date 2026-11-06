"""Who is on duty, the floor in force, shortfalls and gaps: the one place each staffing rule is decided."""

from dataclasses import dataclass, field
from datetime import date, timedelta

import asyncpg

from . import shifts
from .errors import ApiError
from .ids import new_id
from .projections import COVER_SQL

# A rota assignment with the absence (if any) that makes its holder away on that date.
# Approved leave and sickness covering the date both make a person away; sickness wins the label.
ROTA_SQL = """
SELECT a.id, a.person_id, a.home_id, a.unit_id, a.date, a.shift, a.starts_at, a.ends_at,
       p.display_name, p.skill,
       (SELECT k.kind FROM (
            SELECT 'sickness' AS kind, 0 AS rank WHERE off_sick(a.person_id, a.date)
            UNION ALL
            SELECT lr.type, 1 FROM leave_requests lr
             WHERE lr.requester_id = a.person_id AND lr.status = 'approved'
               AND a.date BETWEEN lr.start_date AND lr.end_date
        ) k ORDER BY k.rank LIMIT 1) AS absence_kind
FROM assignments a JOIN people p ON p.id = a.person_id
"""
ROTA_ORDER = " ORDER BY a.date, array_position(ARRAY['early','late','night'], a.shift), p.display_name"


async def rota_rows(conn: asyncpg.Connection, unit_id: str, first: date, last: date) -> list[asyncpg.Record]:
    return await conn.fetch(ROTA_SQL + " WHERE a.unit_id = $1 AND a.date BETWEEN $2 AND $3" + ROTA_ORDER,
                            unit_id, first, last)


@dataclass(frozen=True, slots=True)
class Floor:
    min_staff: int
    min_seniors: int
    effective_from: date


async def floor_versions(conn: asyncpg.Connection, unit_id: str) -> dict[str, list[Floor]]:
    versions: dict[str, list[Floor]] = {s: [] for s in shifts.SHIFTS}
    for v in await conn.fetch("SELECT shift, min_staff, min_seniors, effective_from FROM floor_versions"
                              " WHERE unit_id = $1 ORDER BY effective_from", unit_id):
        versions[v["shift"]].append(Floor(v["min_staff"], v["min_seniors"], v["effective_from"]))
    return versions


def floor_in_force(versions: dict[str, list[Floor]], day: date, shift: str) -> Floor:
    """The version with the latest effective_from on or before the shift's date."""
    return [v for v in versions[shift] if v.effective_from <= day][-1]


@dataclass(slots=True)
class ShiftState:
    day: date
    shift: str
    floor: Floor
    on_duty: int = 0
    seniors_on_duty: int = 0
    affected: bool = False
    requester_senior: bool = False
    covers: list[asyncpg.Record] = field(default_factory=list)

    @property
    def on_duty_if_approved(self) -> int:
        return self.on_duty - self.affected

    @property
    def seniors_if_approved(self) -> int:
        return self.seniors_on_duty - (self.affected and self.requester_senior)

    @property
    def shortfall(self) -> int:
        return max(0, self.floor.min_staff - self.on_duty_if_approved)

    @property
    def senior_shortfall(self) -> int:
        return max(0, self.floor.min_seniors - self.seniors_if_approved)

    @property
    def below_floor(self) -> bool:
        return self.shortfall > 0 or self.senior_shortfall > 0

    def gaps(self) -> list[tuple[str, asyncpg.Record | None]]:
        """max(shortfall, senior_shortfall) gaps, seniors first, each paired with an open cover or None."""
        skills = ["senior"] * self.senior_shortfall
        skills += ["carer"] * (max(self.shortfall, self.senior_shortfall) - self.senior_shortfall)
        pool = {s: [c for c in self.covers if c["skill"] == s] for s in ("senior", "carer")}
        return [(skill, pool[skill].pop(0) if pool[skill] else None) for skill in skills]

    def breach(self) -> dict:
        return {"date": self.day.isoformat(), "shift": self.shift, "label": shifts.short_label(self.day, self.shift),
                "on_duty": self.on_duty, "on_duty_if_approved": self.on_duty_if_approved,
                "min_staff": self.floor.min_staff, "seniors_on_duty": self.seniors_on_duty,
                "seniors_if_approved": self.seniors_if_approved, "min_seniors": self.floor.min_seniors}


def count_on_duty(state: ShiftState, rows: list[asyncpg.Record]) -> None:
    """on_duty: people with an assignment on the shift minus anyone away; seniors_on_duty likewise."""
    present = [r for r in rows if r["absence_kind"] is None]
    state.on_duty = len(present)
    state.seniors_on_duty = sum(r["skill"] == "senior" for r in present)


async def unit_states(conn: asyncpg.Connection, unit_id: str, first: date, last: date,
                      request: asyncpg.Record | None = None, requester: asyncpg.Record | None = None
                      ) -> list[ShiftState]:
    """Every shift of the unit from first to last, in date order Early, Late, Night.

    With a request, its open covers are attached to their shifts; with its requester too, `affected`
    marks the shifts inside the request's dates where they are rostered and not already away."""
    leave_request_id = request["id"] if request else None
    versions = await floor_versions(conn, unit_id)
    rows = await rota_rows(conn, unit_id, first, last)
    covers = await conn.fetch(COVER_SQL + " WHERE c.leave_request_id = $1 AND c.status = 'open'"
                              " ORDER BY c.created_at", leave_request_id) if leave_request_id else []
    states = []
    day = first
    while day <= last:
        for shift in shifts.SHIFTS:
            here = [r for r in rows if r["date"] == day and r["shift"] == shift]
            state = ShiftState(day, shift, floor_in_force(versions, day, shift))
            count_on_duty(state, here)
            if requester is not None and request["start_date"] <= day <= request["end_date"]:
                state.affected = any(r["person_id"] == requester["id"] and r["absence_kind"] is None for r in here)
                state.requester_senior = requester["skill"] == "senior"
            state.covers = [c for c in covers if c["date"] == day and c["shift"] == shift]
            states.append(state)
        day += timedelta(days=1)
    return states


async def add_assignment(conn: asyncpg.Connection, person_id: str, home_id: str, unit_id: str, day: date,
                         shift: str) -> str:
    """A rota assignment, refused with overlapping_shift when the person already holds one at that time."""
    starts, ends = shifts.window(day, shift)
    await conn.execute("SELECT 1 FROM people WHERE id = $1 FOR UPDATE", person_id)
    if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM assignments WHERE person_id = $1"
                           " AND starts_at < $3 AND ends_at > $2)", person_id, starts, ends):
        raise ApiError("overlapping_shift")
    assignment_id = new_id("as")
    await conn.execute("INSERT INTO assignments (id, person_id, home_id, unit_id, date, shift, starts_at, ends_at)"
                       " VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", assignment_id, person_id, home_id, unit_id, day,
                       shift, starts, ends)
    return assignment_id
