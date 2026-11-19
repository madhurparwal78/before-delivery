"""The job lifecycle: the only place a job's status, attempts and log are written.

Legal transitions: pending -> running | cancelled | failed (restart recovery);
running -> succeeded | failed | cancelled. Final states never change."""

import uuid
from datetime import datetime
from typing import Any

import asyncpg

from . import audit
from .db import iso, utcnow
from .middleware import log_line

ACTIVE = ("pending", "running")
FINAL = ("succeeded", "failed", "cancelled")


async def has_active(conn: asyncpg.Connection, connection_id: uuid.UUID) -> bool:
    """Whether the connection has a job pending or running (at most one, by the jobs_one_active index)."""
    return await conn.fetchval("SELECT EXISTS (SELECT 1 FROM jobs WHERE connection_id = $1 AND status = ANY($2::text[]))",
                               connection_id, list(ACTIVE))


async def log_if_running(conn: asyncpg.Connection, job_id: uuid.UUID, message: str) -> bool:
    """Write a progress line only while the job still runs; False once it was cancelled."""
    if (await _locked(conn, job_id))["status"] != "running":
        return False
    await write_log(conn, job_id, message)
    return True


async def write_log(conn: asyncpg.Connection, job_id: uuid.UUID, message: str, level: str = "info") -> None:
    at = utcnow()
    trigger = await conn.fetchval(
        """INSERT INTO job_logs (job_id, seq, at, level, message)
           SELECT $1, coalesce(max(seq), 0) + 1, $2, $3, $4 FROM job_logs WHERE job_id = $1
           RETURNING (SELECT trigger_request_id FROM jobs WHERE id = $1)""", job_id, at, level, message)
    log_line({"request_id": trigger, "job_id": str(job_id), "at": iso(at), "level": level, "message": message})


async def _audit_outcome(conn: asyncpg.Connection, job: asyncpg.Record, action: str) -> None:
    starter = await conn.fetchval("SELECT email FROM users WHERE id = $1", job["started_by"])
    await audit.append(conn, job["workspace_id"], action, job["id"], starter)


async def create(conn: asyncpg.Connection, *, workspace_id: uuid.UUID, connection_id: uuid.UUID,
                 connection_version: int, definition_version: int, settings: dict[str, Any], request_id: str,
                 member_id: uuid.UUID, member_email: str) -> uuid.UUID:
    """A new pending job; the partial unique index refuses a second active job for the connection."""
    job_id = uuid.uuid4()
    per_stream = [{"stream": s["name"], "records_committed": 0} for s in settings["streams"]]
    await conn.execute(
        """INSERT INTO jobs (id, workspace_id, connection_id, connection_version, definition_version, status, attempts,
                             per_stream, trigger_request_id, started_by, settings, created_at)
           VALUES ($1, $2, $3, $4, $5, 'pending', '[]', $6, $7, $8, $9, $10)""",
        job_id, workspace_id, connection_id, connection_version, definition_version, per_stream, request_id,
        member_id, settings, utcnow())
    await audit.append(conn, workspace_id, "sync.started", job_id, member_email)
    return job_id


async def start(conn: asyncpg.Connection, job_id: uuid.UUID, snapshot_seq: int | None) -> bool:
    """pending -> running, fixing the source snapshot; False when the job is no longer pending."""
    started = await conn.fetchval(
        """UPDATE jobs SET status = 'running', started_at = $2, snapshot_seq = $3,
                  attempts = '[{"number": 1, "status": "running", "failure_reason": null}]'
           WHERE id = $1 AND status = 'pending' RETURNING id""", job_id, utcnow(), snapshot_seq)
    if started:
        await write_log(conn, job_id, "Sync started")
    return started is not None


async def _locked(conn: asyncpg.Connection, job_id: uuid.UUID) -> asyncpg.Record:
    return await conn.fetchrow("SELECT * FROM jobs WHERE id = $1 FOR UPDATE", job_id)


def _close_attempt(attempts: list[dict[str, Any]], status: str, reason: str | None) -> list[dict[str, Any]]:
    if not attempts:
        return attempts
    return [*attempts[:-1], {**attempts[-1], "status": status, "failure_reason": reason}]


async def retry(conn: asyncpg.Connection, job_id: uuid.UUID, reason: str) -> bool:
    """The running attempt failed and a new one begins; False when the job left `running`."""
    job = await _locked(conn, job_id)
    if job["status"] != "running":
        return False
    attempts = _close_attempt(job["attempts"], "failed", reason)
    number = len(attempts) + 1
    attempts.append({"number": number, "status": "running", "failure_reason": None})
    await conn.execute("UPDATE jobs SET attempts = $2 WHERE id = $1", job_id, attempts)
    await write_log(conn, job_id, f"attempt {number - 1} failed: {reason}", "error")
    return True


async def succeed(conn: asyncpg.Connection, job_id: uuid.UUID, per_stream: list[dict[str, Any]]) -> bool:
    """running -> succeeded inside the commit transaction; False when a cancel was recorded first."""
    job = await _locked(conn, job_id)
    if job["status"] != "running":
        return False
    total = sum(entry["records_committed"] for entry in per_stream)
    await conn.execute(
        """UPDATE jobs SET status = 'succeeded', records_committed = $2, per_stream = $3, ended_at = $4,
                  attempts = $5, failure_reason = NULL WHERE id = $1""",
        job_id, total, per_stream, utcnow(), _close_attempt(job["attempts"], "succeeded", None))
    for entry in per_stream:
        await write_log(conn, job_id, f"stream {entry['stream']}: {entry['records_committed']} records committed")
    await write_log(conn, job_id, "Sync succeeded")
    await _audit_outcome(conn, job, "sync.succeeded")
    return True


async def fail(conn: asyncpg.Connection, job_id: uuid.UUID, reason: str, ended_at: datetime | None = None) -> bool:
    """pending | running -> failed; nothing in the warehouse changes."""
    job = await _locked(conn, job_id)
    if job["status"] not in ACTIVE:
        return False
    attempts = _close_attempt(job["attempts"], "failed", reason)
    await conn.execute(
        """UPDATE jobs SET status = 'failed', failure_reason = $2, ended_at = $3, attempts = $4 WHERE id = $1""",
        job_id, reason, ended_at or utcnow(), attempts)
    if job["status"] == "running":
        await write_log(conn, job_id, f"attempt {len(attempts)} failed: {reason}", "error")
    await write_log(conn, job_id, f"Sync failed: {reason}", "error")
    await _audit_outcome(conn, job, "sync.failed")
    return True


async def cancel(conn: asyncpg.Connection, job_id: uuid.UUID) -> bool:
    """pending | running -> cancelled; False when the job had already finished."""
    job = await _locked(conn, job_id)
    if job["status"] not in ACTIVE:
        return False
    await conn.execute("UPDATE jobs SET status = 'cancelled', ended_at = $2, attempts = $3 WHERE id = $1",
                       job_id, utcnow(), _close_attempt(job["attempts"], "cancelled", None))
    await write_log(conn, job_id, "Sync cancelled")
    await _audit_outcome(conn, job, "sync.cancelled")
    return True


async def recover(conn: asyncpg.Connection, started_at: datetime) -> None:
    """Restart recovery: every job left pending or running fails as interrupted, once."""
    for row in await conn.fetch("SELECT id FROM jobs WHERE status = ANY($1::text[]) ORDER BY created_at", list(ACTIVE)):
        await fail(conn, row["id"], "interrupted", started_at)
