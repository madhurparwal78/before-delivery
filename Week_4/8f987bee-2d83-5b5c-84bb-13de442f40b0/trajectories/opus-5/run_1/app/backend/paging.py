"""Job history paging: positions, not offsets, on a cursor bound to its listing."""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any

from .context import iso
from .errors import ApiError
from .security import read_cursor, sign_cursor


def job_cursor(
    workspace_id: uuid.UUID, connection_id: uuid.UUID | None, created_at: datetime, job_id: uuid.UUID
) -> str:
    return sign_cursor(
        {
            "kind": "jobs",
            "workspace_id": str(workspace_id),
            "connection_id": str(connection_id) if connection_id else None,
            "created_at": iso(created_at),
            "job_id": str(job_id),
        }
    )


def read_job_cursor(
    cursor: str, workspace_id: uuid.UUID, connection_id: uuid.UUID | None
) -> tuple[datetime, uuid.UUID]:
    payload: dict[str, Any] = read_cursor(cursor)
    if (
        payload.get("kind") != "jobs"
        or payload.get("workspace_id") != str(workspace_id)
        or payload.get("connection_id") != (str(connection_id) if connection_id else None)
    ):
        raise ApiError("invalid_cursor")
    try:
        created_at = datetime.fromisoformat(payload["created_at"].replace("Z", "+00:00"))
        job_id = uuid.UUID(payload["job_id"])
    except (KeyError, ValueError, AttributeError) as exc:
        raise ApiError("invalid_cursor") from exc
    return created_at, job_id
