"""Partner applications: storing them, reading the queue and deciding them."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

import asyncpg

from . import emails
from .db import DATABASE
from .replydue import reply_due_at
from .validation import ApplicationDraft

PENDING = "pending"
APPROVED = "approved"
REJECTED = "rejected"
STATUSES = (PENDING, APPROVED, REJECTED)

DECISION_OUTCOMES = {"approve": APPROVED, "reject": REJECTED}
OUTCOME_EMAIL_KINDS = {APPROVED: emails.APPROVED, REJECTED: emails.REJECTED}

SORT_SUBMITTED = "submitted"
SORT_REPLY_DUE = "reply_due"
SORTS = (SORT_SUBMITTED, SORT_REPLY_DUE)

_COLUMNS = """
    id, first_name, last_name, work_email, job_title, company_name, website,
    company_type, employee_band, markets, customer_segment,
    partnership_interests, goals, consent, status, reviewer, decision_note,
    created_at, decided_at
"""


class DuplicateApplication(Exception):
    """Another application already holds this stored work email."""


class AlreadyDecided(Exception):
    """The application carries a decision already."""

    def __init__(self, status: str) -> None:
        super().__init__(status)
        self.status = status


def iso_utc(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def application_payload(row: asyncpg.Record, outcome_email_status: str | None) -> dict[str, Any]:
    decided_at = row["decided_at"]
    return {
        "id": row["id"],
        "first_name": row["first_name"],
        "last_name": row["last_name"],
        "work_email": row["work_email"],
        "job_title": row["job_title"],
        "company_name": row["company_name"],
        "website": row["website"],
        "company_type": row["company_type"],
        "employee_band": row["employee_band"],
        "markets": list(row["markets"]),
        "customer_segment": row["customer_segment"],
        "partnership_interests": list(row["partnership_interests"]),
        "goals": row["goals"],
        "consent": row["consent"],
        "status": row["status"],
        "reviewer": row["reviewer"],
        "decision_note": row["decision_note"],
        "created_at": iso_utc(row["created_at"]),
        "decided_at": iso_utc(decided_at) if decided_at is not None else None,
        "reply_due_at": iso_utc(reply_due_at(row["created_at"])),
        "outcome_email_status": outcome_email_status,
    }


async def store_application(draft: ApplicationDraft) -> dict[str, Any]:
    """Write one pending application and its receipt email in one transaction."""
    values = draft.values
    async with DATABASE.acquire() as connection:
        try:
            async with connection.transaction():
                row = await connection.fetchrow(
                    """
                    INSERT INTO partner_applications
                        (first_name, last_name, work_email, job_title, company_name,
                         website, company_type, employee_band, markets,
                         customer_segment, partnership_interests, goals, consent,
                         status, created_at)
                    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, true,
                            'pending', now())
                    RETURNING id, work_email, first_name, company_name
                    """,
                    values["first_name"],
                    values["last_name"],
                    values["work_email"],
                    values["job_title"],
                    values["company_name"],
                    values["website"],
                    values["company_type"],
                    values["employee_band"],
                    values["markets"],
                    values["customer_segment"],
                    values["partnership_interests"],
                    values["goals"],
                )
                await emails.record_email(
                    connection,
                    application_id=row["id"],
                    kind=emails.RECEIPT,
                    recipient=row["work_email"],
                    first_name=row["first_name"],
                    company_name=row["company_name"],
                )
        except asyncpg.UniqueViolationError as exc:
            raise DuplicateApplication(values["work_email"]) from exc
    return {"id": row["id"], "status": PENDING, "work_email": row["work_email"]}


async def read_queue(
    status: str | None,
    sort: str,
) -> tuple[list[dict[str, Any]], dict[str, int]]:
    """The queue and its counts, read from one database snapshot."""
    async with DATABASE.acquire() as connection:
        async with connection.transaction(isolation="repeatable_read", readonly=True):
            rows = await connection.fetch(
                f"""
                SELECT {_COLUMNS},
                       (SELECT e.status FROM outbound_emails e
                        WHERE e.application_id = partner_applications.id
                          AND e.kind IN ('approved', 'rejected')) AS outcome_email_status
                FROM partner_applications
                WHERE $1::text IS NULL OR status = $1
                ORDER BY created_at DESC, id DESC
                """,
                status,
            )
            counts_row = await connection.fetchrow(
                """
                SELECT
                    count(*) FILTER (WHERE status = 'pending') AS pending,
                    count(*) FILTER (WHERE status = 'approved') AS approved,
                    count(*) FILTER (WHERE status = 'rejected') AS rejected
                FROM partner_applications
                """
            )
    items = [application_payload(row, row["outcome_email_status"]) for row in rows]
    if sort == SORT_REPLY_DUE:
        items.sort(key=lambda item: (item["reply_due_at"], item["id"]))
    counts = {name: int(counts_row[name]) for name in STATUSES}
    return items, counts


async def read_application(application_id: int) -> dict[str, Any] | None:
    async with DATABASE.acquire() as connection:
        row = await connection.fetchrow(
            f"""
            SELECT {_COLUMNS},
                   (SELECT e.status FROM outbound_emails e
                    WHERE e.application_id = partner_applications.id
                      AND e.kind IN ('approved', 'rejected')) AS outcome_email_status
            FROM partner_applications
            WHERE id = $1
            """,
            application_id,
        )
    if row is None:
        return None
    return application_payload(row, row["outcome_email_status"])


async def decide_application(
    application_id: int,
    decision: str,
    note: str | None,
    reviewer_email: str,
) -> dict[str, Any] | None:
    """Decide a pending application once, recording its outcome email with it."""
    outcome = DECISION_OUTCOMES[decision]
    async with DATABASE.acquire() as connection:
        async with connection.transaction():
            current = await connection.fetchval(
                "SELECT status FROM partner_applications WHERE id = $1 FOR UPDATE",
                application_id,
            )
            if current is None:
                return None
            if current != PENDING:
                raise AlreadyDecided(str(current))
            row = await connection.fetchrow(
                f"""
                UPDATE partner_applications
                SET status = $2, reviewer = $3, decision_note = $4, decided_at = now()
                WHERE id = $1
                RETURNING {_COLUMNS}
                """,
                application_id,
                outcome,
                reviewer_email,
                note,
            )
            await emails.record_email(
                connection,
                application_id=row["id"],
                kind=OUTCOME_EMAIL_KINDS[outcome],
                recipient=row["work_email"],
                first_name=row["first_name"],
                company_name=row["company_name"],
            )
            email_status = await emails.outcome_email_status(connection, row["id"])
    return application_payload(row, email_status)
