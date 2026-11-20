"""Leave rules: the transition table, request validation, hours and balance, notice."""

from dataclasses import dataclass
from datetime import date

import asyncpg

from . import shifts
from .errors import ApiError, Fields

LEAVE_TYPES = ("annual", "unpaid", "compassionate")
STATUS_LABELS = {"draft": "Draft", "submitted": "Submitted", "escalated": "Escalated", "cover_pending": "Cover pending",
                 "approved": "Approved", "declined": "Declined", "withdrawn": "Withdrawn", "cancelled": "Cancelled"}
ENTITLEMENT_SECONDS = 168 * 3600
MAX_DAYS = 28
NOTE_MAX = 500


@dataclass(frozen=True, slots=True)
class Transition:
    sources: frozenset[str]
    target: str | None
    action: str


AWAITING = frozenset({"submitted", "escalated", "cover_pending"})
TRANSITIONS = {
    "edit": Transition(frozenset({"draft"}), None, "edited"),
    "submit": Transition(frozenset({"draft"}), "submitted", "submitted"),
    "withdraw": Transition(frozenset({"draft", *AWAITING, "approved"}), "withdrawn", "withdrawn"),
    "escalate": Transition(frozenset({"submitted"}), "escalated", "escalated"),
    "post_cover": Transition(AWAITING, "cover_pending", "given cover"),
    "approve": Transition(AWAITING, "approved", "approved"),
    "decline": Transition(AWAITING, "declined", "declined"),
    "cancel": Transition(frozenset({"approved"}), "cancelled", "cancelled"),
}
# Requests that hold their dates: they count against the balance and block overlapping submissions.
HOLDING = AWAITING | {"approved"}


def transition(status: str, name: str) -> str | None:
    """The target status of a legal transition, else invalid_transition with nothing changed."""
    move = TRANSITIONS[name]
    if status not in move.sources:
        raise ApiError("invalid_transition", f"This request is {STATUS_LABELS[status]} and can't be {move.action}.",
                       status=status)
    return move.target


def leave_year(day: date) -> tuple[date, date]:
    start = shifts.leave_year_start(day)
    return start, date(start.year + 1, 3, 31)


async def booked_seconds(conn: asyncpg.Connection, person_id: str, year_start: date, exclude: str = "") -> int:
    """The summed cost of the leave year's annual requests that hold their dates."""
    return await conn.fetchval(
        "SELECT coalesce(sum(cost_seconds(requester_id, start_date, end_date, hours_seconds)), 0)::bigint"
        " FROM leave_requests"
        " WHERE requester_id = $1 AND type = 'annual' AND status = ANY($2::text[]) AND start_date BETWEEN $3 AND $4"
        " AND id <> $5", person_id, list(HOLDING), *leave_year(year_start), exclude)


async def holiday(conn: asyncpg.Connection, person_id: str) -> dict:
    start, _ = leave_year(shifts.today())
    booked = await booked_seconds(conn, person_id, start)
    return {"leave_year_start": start.isoformat(), "entitlement_hours": shifts.hours(ENTITLEMENT_SECONDS),
            "booked_hours": shifts.hours(booked), "remaining_hours": shifts.hours(ENTITLEMENT_SECONDS - booked)}


@dataclass(slots=True)
class Draft:
    type: str | None
    start: date | None
    end: date | None
    note: str | None


def read_draft(fields: Fields, body: dict, current: Draft | None = None) -> Draft:
    """The request fields from a body (falling back to the current draft's), collecting their field messages."""
    base = current or Draft(None, None, None, None)
    kind = body.get("type", base.type)
    if kind not in LEAVE_TYPES:
        fields.fail("type", "Choose annual, unpaid or compassionate leave.")
    start = shifts.parse_date(body["start_date"]) if "start_date" in body else base.start
    end = shifts.parse_date(body["end_date"]) if "end_date" in body else base.end
    note = body.get("note", base.note)
    if note is not None and (not isinstance(note, str) or len(note) > NOTE_MAX):
        fields.fail("note", "Keep the note to 500 characters or fewer.")
    if start is None or start < shifts.today():
        fields.fail("start_date", "Leave can't start in the past.")
    if end is None or (start is not None and end < start):
        fields.fail("end_date", "The last day can't be before the first day.")
    elif start is not None and (end - start).days + 1 > MAX_DAYS:
        fields.fail("end_date", "Leave can be at most 28 days.")
    elif start is not None and leave_year(start)[1] < end:
        fields.fail("end_date", "Leave can't cross 31 March. Split it into two requests.")
    return Draft(kind if kind in LEAVE_TYPES else None, start, end, note if isinstance(note, str) else None)


async def rostered_seconds(conn: asyncpg.Connection, person_id: str, draft: Draft) -> int:
    """A request's hours: taken from the rota when a draft is saved and again at submission, then fixed."""
    if draft.start is None or draft.end is None:
        return 0
    return await conn.fetchval("SELECT rostered_seconds($1, $2, $3)", person_id, draft.start, draft.end)


async def check_submission(conn: asyncpg.Connection, person_id: str, draft: Draft, fields: Fields, hours: int,
                           request_id: str = "") -> None:
    """Rules that apply when a request is submitted: overlaps (409) and the annual balance (422)."""
    if draft.start is None or draft.end is None:
        return
    if await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM leave_requests WHERE requester_id = $1 AND id <> $2"
            " AND status = ANY($3::text[]) AND start_date <= $5 AND end_date >= $4)",
            person_id, request_id, list(HOLDING), draft.start, draft.end):
        raise ApiError("overlaps_existing_leave")
    if draft.type == "annual" and fields.ok("start_date", "end_date"):
        needed = await conn.fetchval("SELECT cost_seconds($1, $2, $3, $4)", person_id, draft.start, draft.end, hours)
        left = ENTITLEMENT_SECONDS - await booked_seconds(conn, person_id, draft.start, request_id)
        if needed > left:
            fields.fail("end_date", f"This needs {shifts.hours(needed)} hours but you have {shifts.hours(left)} hours left.")


async def is_short_notice(conn: asyncpg.Connection, home_id: str, draft: Draft) -> bool:
    """Judged once, at submission, by the policy in force today."""
    today = shifts.today()
    multiplier = await conn.fetchval(
        "SELECT notice_multiplier FROM policy_versions WHERE home_id = $1 AND effective_from <= $2"
        " ORDER BY effective_from DESC LIMIT 1", home_id, today)
    lead_days = (draft.start - today).days
    return lead_days < multiplier * ((draft.end - draft.start).days + 1)


def first_shift_cutoff(first_start, start_date: date):
    """Withdrawing approved leave is allowed until its first affected shift starts (else 00:00 on day one)."""
    return first_start or shifts.london_midnight(start_date)

