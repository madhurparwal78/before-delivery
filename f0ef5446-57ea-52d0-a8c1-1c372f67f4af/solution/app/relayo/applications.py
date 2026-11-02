"""Partner applications: create, the reviewer queue, reading one, and the decision."""

from __future__ import annotations

import json
import re
from typing import Any

from werkzeug.wrappers import Response

from . import db, idempotency, outbound
from .http import ApiError, error_payload, json_text, JSON_TYPE
from .public import utc_text
from .reply_due import reply_due_at
from .validation import SUMMARY_MESSAGE, CleanApplication, check_application, sent_values

STATUSES = ("pending", "approved", "rejected")
SORTS = ("submitted", "reply_due")
# The application state transitions: a decision moves a pending application to its outcome, once.
OUTCOMES = {"approve": "approved", "reject": "rejected"}
DUPLICATE_MESSAGE = "An application for this work email already exists."

APPLICATION_SQL = """
SELECT a.*, o.status AS outcome_email_status
FROM partner_applications a
LEFT JOIN outbound_emails o ON o.application_id = a.id AND o.kind <> 'receipt'
"""


def application_object(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": row["id"], "first_name": row["first_name"], "last_name": row["last_name"],
        "work_email": row["work_email"], "job_title": row["job_title"], "company_name": row["company_name"],
        "website": row["website"], "company_type": row["company_type"], "employee_band": row["employee_band"],
        "markets": row["markets"], "customer_segment": row["customer_segment"],
        "partnership_interests": row["partnership_interests"], "goals": row["goals"], "consent": row["consent"],
        "status": row["status"], "reviewer": row["reviewer"], "decision_note": row["decision_note"],
        "created_at": utc_text(row["created_at"]),
        "decided_at": utc_text(row["decided_at"]) if row["decided_at"] else None,
        "reply_due_at": utc_text(reply_due_at(row["created_at"])),
        "outcome_email_status": row["outcome_email_status"],
    }


# Create --------------------------------------------------------------------------------------------

INSERT = """
INSERT INTO partner_applications (first_name, last_name, work_email, job_title, company_name, website,
    company_type, employee_band, markets, customer_segment, partnership_interests, goals, consent)
VALUES (:first_name, :last_name, :work_email, :job_title, :company_name, :website, :company_type,
    :employee_band, CAST(:markets AS jsonb), :customer_segment, CAST(:partnership_interests AS jsonb), :goals,
    true)
ON CONFLICT (work_email COLLATE "C") DO NOTHING
RETURNING id, first_name, company_name, work_email
"""


def _insert(conn: db.Connection, clean: CleanApplication) -> dict[str, Any] | None:
    return db.one(conn, INSERT, first_name=clean.first_name, last_name=clean.last_name,
                  work_email=clean.work_email, job_title=clean.job_title, company_name=clean.company_name,
                  website=clean.website, company_type=clean.company_type, employee_band=clean.employee_band,
                  markets=json.dumps(clean.markets), customer_segment=clean.customer_segment,
                  partnership_interests=json.dumps(clean.partnership_interests), goals=clean.goals)


def _process(body: dict[str, Any], taken: idempotency.Claim | None) -> tuple[int, str]:
    """Validate, then store the application and its receipt (and the key's answer) in one transaction."""
    errors, clean = check_application(body)
    if clean is None:
        text = json_text(error_payload("validation_failed", message=SUMMARY_MESSAGE, errors=errors,
                                       values=sent_values(body)))
        if taken:
            with db.connection() as conn:
                idempotency.store(conn, taken, 422, text)
        return 422, text
    with db.transaction() as conn:
        row = _insert(conn, clean)
        if row is None:
            status, text = 409, json_text(error_payload("duplicate_application", message=DUPLICATE_MESSAGE))
        else:
            outbound.record(conn, row, "receipt")
            status, text = 201, json_text({"id": row["id"], "status": "pending", "work_email": row["work_email"]})
        if taken:
            idempotency.store(conn, taken, status, text)
    if status == 201:
        outbound.deliverer.wake()
    return status, text


def create(body: dict[str, Any], key: str | None) -> Response:
    taken: idempotency.Claim | None = None
    if key is not None:
        answer = idempotency.claim(key, idempotency.body_hash(body))
        if isinstance(answer, Response):
            return answer
        taken = answer
    try:
        status, text = _process(body, taken)
    except BaseException:
        if taken:
            idempotency.release(taken)
        raise
    return Response(text, status=status, content_type=JSON_TYPE)


# Reviewer reads ------------------------------------------------------------------------------------

def read_queue(status: str | None, sort: str) -> dict[str, Any]:
    """Items and per-status counts from one snapshot."""
    with db.transaction("REPEATABLE READ") as conn:
        counts = db.one(conn, "SELECT count(*) FILTER (WHERE status = 'pending') AS pending, "
                              "count(*) FILTER (WHERE status = 'approved') AS approved, "
                              "count(*) FILTER (WHERE status = 'rejected') AS rejected FROM partner_applications")
        found = db.rows(conn, APPLICATION_SQL + " WHERE (CAST(:status AS text) IS NULL OR a.status = :status) "
                                                "ORDER BY a.created_at DESC, a.id DESC", status=status)
    items = [application_object(row) for row in found]
    if sort == "reply_due":
        items.sort(key=lambda item: (item["reply_due_at"], item["id"]))
    return {"items": items, "counts": {name: int(counts[name]) for name in STATUSES}}


def existing_id(raw: str) -> int:
    """Step 4: an id that is not a positive integer, or names no application, is unknown."""
    if not re.fullmatch(r"[1-9][0-9]{0,9}", raw) or int(raw) > 2**31 - 1:
        raise ApiError(404, "not_found")
    with db.connection() as conn:
        if db.one(conn, "SELECT id FROM partner_applications WHERE id = :id", id=int(raw)) is None:
            raise ApiError(404, "not_found")
    return int(raw)


def read_one(application_id: int) -> dict[str, Any]:
    with db.connection() as conn:
        return application_object(db.one(conn, APPLICATION_SQL + " WHERE a.id = :id", id=application_id))


def decide(application_id: int, decision: str, note: str | None, reviewer: str) -> dict[str, Any]:
    """One conditional update decides the single winner; its outcome email is recorded alongside."""
    outcome = OUTCOMES[decision]
    with db.transaction() as conn:
        decided = db.one(conn, "UPDATE partner_applications SET status = :status, reviewer = :reviewer, "
                               "decision_note = :note, decided_at = clock_timestamp() "
                               "WHERE id = :id AND status = 'pending' RETURNING *",
                         status=outcome, reviewer=reviewer, note=note, id=application_id)
        if decided is None:
            current = db.one(conn, "SELECT status FROM partner_applications WHERE id = :id", id=application_id)
            raise ApiError(409, "already_decided", status=current["status"])
        outbound.record(conn, decided, outcome)
        row = db.one(conn, APPLICATION_SQL + " WHERE a.id = :id", id=application_id)
    outbound.deliverer.wake()
    return application_object(row)
