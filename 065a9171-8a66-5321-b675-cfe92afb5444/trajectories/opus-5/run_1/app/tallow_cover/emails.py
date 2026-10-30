"""The five emails the product sends, composed with the names of the moment."""

from __future__ import annotations

from datetime import date, datetime

from .domain.leave import TYPE_LABELS
from .mail import queue
from .timeutil import (
    SHIFT_LABELS,
    format_clock,
    format_date,
    format_shift_label,
    iso_instant,
    shift_window,
)

SKILL_LABELS = {"senior": "Senior", "carer": "Carer"}


def _span(start: date, end: date) -> str:
    return f"{format_date(start)} to {format_date(end)}"


def leave_approved(conn, to_email: str, request: dict, approver_name: str) -> None:
    span = _span(request["start_date"], request["end_date"])
    queue(
        conn,
        to_email,
        f"Leave approved: {span}",
        "\n".join(
            [
                f"Your {TYPE_LABELS[request['leave_type']]} is approved.",
                f"Dates: {span}",
                f"Hours: {request['hours']:.2f}",
                f"Approved by: {approver_name}",
            ]
        ),
    )


def leave_declined(conn, to_email: str, request: dict, reason: str) -> None:
    span = _span(request["start_date"], request["end_date"])
    queue(
        conn,
        to_email,
        f"Leave declined: {span}",
        "\n".join(
            [
                f"Your {TYPE_LABELS[request['leave_type']]} request was declined.",
                f"Dates: {span}",
                f"Reason: {reason}",
            ]
        ),
    )


def leave_cancelled(conn, to_email: str, request: dict, reason: str) -> None:
    span = _span(request["start_date"], request["end_date"])
    queue(
        conn,
        to_email,
        f"Approved leave cancelled: {span}",
        "\n".join(
            [
                f"Your approved {TYPE_LABELS[request['leave_type']]} was cancelled.",
                f"Dates: {span}",
                f"Reason: {reason}",
            ]
        ),
    )


def cover_open(
    conn,
    to_email: str,
    home_name: str,
    unit_name: str,
    shift_date: date,
    shift: str,
    skill: str,
) -> None:
    """Names only the home, unit, date, shift times and skill."""
    starts_at, ends_at = shift_window(shift_date, shift)
    label = format_shift_label(shift_date, shift)
    queue(
        conn,
        to_email,
        f"Cover shift at {home_name}: {label}",
        "\n".join(
            [
                f"A cover shift is open at {home_name}.",
                f"Unit: {unit_name}",
                f"Date: {format_date(shift_date)}",
                f"Shift: {SHIFT_LABELS[shift]} {format_clock(starts_at)}–{format_clock(ends_at)}",
                f"Skill: {SKILL_LABELS[skill]}",
                "Claim it on /cover",
            ]
        ),
    )


def escalation(
    conn,
    to_email: str,
    requester_name: str,
    unit_name: str | None,
    request: dict,
    submitted_at: datetime,
) -> None:
    span = _span(request["start_date"], request["end_date"])
    queue(
        conn,
        to_email,
        f"Leave request awaiting decision: {requester_name}, {span}",
        "\n".join(
            [
                f"{requester_name} is still waiting for a decision.",
                f"Unit: {unit_name or 'No unit'}",
                f"Type: {TYPE_LABELS[request['leave_type']]}",
                f"Dates: {span}",
                f"Submitted: {iso_instant(submitted_at)}",
            ]
        ),
    )
