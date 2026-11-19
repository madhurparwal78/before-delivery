"""How a job and its log read back."""

from typing import Any

import asyncpg

from .db import iso


def public(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": str(row["id"]), "connection_id": str(row["connection_id"]),
        "connection_version": row["connection_version"], "definition_version": row["definition_version"],
        "status": row["status"], "attempts": row["attempts"], "records_committed": row["records_committed"],
        "per_stream": row["per_stream"], "failure_reason": row["failure_reason"],
        "trigger_request_id": row["trigger_request_id"], "created_at": iso(row["created_at"]),
        "started_at": iso(row["started_at"]), "ended_at": iso(row["ended_at"]),
    }


def job_log_line(row: asyncpg.Record) -> dict[str, Any]:
    return {"at": iso(row["at"]), "level": row["level"], "message": row["message"]}
