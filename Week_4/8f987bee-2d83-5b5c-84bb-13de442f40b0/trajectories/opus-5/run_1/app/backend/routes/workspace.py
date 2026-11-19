"""Members, invitations, the plan, the workspace figures and the audit log."""

from __future__ import annotations

import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any

from fastapi import APIRouter, Request

from ..audit import append_event
from ..config import settings
from ..context import iso, require_admin, require_session
from ..db import database
from ..errors import ApiError
from ..models import InviteMemberBody, MemberRoleBody, WorkspaceBody
from ..plans import min_interval_minutes
from ..security import new_token, token_fingerprint
from ..validation import parse_body
from .auth import normalized_email
from .common import ok, path_uuid, raw_body

router = APIRouter()


@router.get("/api/workspace")
async def read_workspace(request: Request) -> Any:
    caller = await require_session(request)
    row = await database.fetchrow("SELECT * FROM workspaces WHERE id = $1", caller.workspace_id)
    return ok({"workspace": _workspace_payload(row)})


@router.patch("/api/workspace")
async def change_plan(request: Request) -> Any:
    caller = await require_session(request)
    require_admin(caller)
    body = parse_body(await raw_body(request), WorkspaceBody)
    async with database.transaction() as conn:
        row = await conn.fetchrow(
            "UPDATE workspaces SET plan = $2 WHERE id = $1 RETURNING *", caller.workspace_id, body.plan
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="workspace.plan_changed",
            target_id=str(caller.workspace_id),
            actor_email=caller.email,
        )
    return ok({"workspace": _workspace_payload(row)})


def _workspace_payload(row: Any) -> dict[str, Any]:
    return {
        "id": str(row["id"]),
        "name": row["name"],
        "plan": row["plan"],
        "min_interval_minutes": min_interval_minutes(row["plan"]),
    }


@router.get("/api/stats")
async def read_stats(request: Request) -> Any:
    caller = await require_session(request)
    async with database.acquire() as conn:
        records_synced = await conn.fetchval(
            """
            SELECT coalesce(sum(records_committed), 0) FROM jobs
            WHERE workspace_id = $1 AND status = 'succeeded'
            """,
            caller.workspace_id,
        )
        latency = await conn.fetchval(
            """
            SELECT avg(extract(epoch FROM (ended_at - started_at))) FROM (
                SELECT started_at, ended_at FROM jobs
                WHERE workspace_id = $1 AND status = 'succeeded'
                ORDER BY ended_at DESC LIMIT 10
            ) recent
            """,
            caller.workspace_id,
        )
        freshness = await conn.fetchval(
            """
            SELECT extract(epoch FROM (now() - max(ended_at))) FROM jobs
            WHERE workspace_id = $1 AND status = 'succeeded'
            """,
            caller.workspace_id,
        )
    return ok(
        {
            "records_synced": int(records_synced),
            "latency_seconds": float(latency) if latency is not None else None,
            "freshness_seconds": float(freshness) if freshness is not None else None,
        }
    )


@router.get("/api/members")
async def list_members(request: Request) -> Any:
    caller = await require_session(request)
    require_admin(caller)
    rows = await database.fetch(
        """
        SELECT u.id, u.email, u.name, m.role FROM memberships m
        JOIN users u ON u.id = m.user_id
        WHERE m.workspace_id = $1
        ORDER BY u.name
        """,
        caller.workspace_id,
    )
    return ok(
        {
            "members": [
                {"id": str(row["id"]), "email": row["email"], "name": row["name"], "role": row["role"]}
                for row in rows
            ]
        }
    )


@router.post("/api/members")
async def invite_member(request: Request) -> Any:
    caller = await require_session(request)
    require_admin(caller)
    body = parse_body(await raw_body(request), InviteMemberBody)
    email = normalized_email(body.email)
    if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", email):
        raise ApiError("validation", fields={"email": "Write a valid email address."})
    now = datetime.now(timezone.utc)
    invite_token = new_token()
    invite_id = uuid.uuid4()
    async with database.transaction() as conn:
        is_member = await conn.fetchval(
            """
            SELECT exists (
                SELECT 1 FROM memberships m JOIN users u ON u.id = m.user_id
                WHERE m.workspace_id = $1 AND u.email = $2
            )
            """,
            caller.workspace_id,
            email,
        )
        if is_member:
            raise ApiError("already_member")
        open_invite = await conn.fetchval(
            """
            SELECT exists (
                SELECT 1 FROM invites
                WHERE workspace_id = $1 AND email = $2 AND used = false AND expires_at > $3
            )
            """,
            caller.workspace_id,
            email,
            now,
        )
        if open_invite:
            raise ApiError("already_invited")
        expires_at = now + timedelta(seconds=settings.invite_ttl_seconds)
        await conn.execute(
            """
            INSERT INTO invites (id, token_hash, email, name, role, workspace_id, created_at, expires_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
            """,
            invite_id,
            token_fingerprint(invite_token),
            email,
            body.name,
            body.role,
            caller.workspace_id,
            now,
            expires_at,
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="member.invited",
            target_id=str(invite_id),
            actor_email=caller.email,
        )
    return ok(
        {
            "invite": {
                "id": str(invite_id),
                "email": email,
                "name": body.name,
                "role": body.role,
                "expires_at": iso(expires_at),
            },
            "invite_token": invite_token,
        },
        status=201,
    )


@router.patch("/api/members/{user_id}")
async def change_role(request: Request, user_id: str) -> Any:
    caller = await require_session(request)
    require_admin(caller)
    member_id = path_uuid(user_id)
    body = parse_body(await raw_body(request), MemberRoleBody)
    async with database.transaction() as conn:
        await conn.execute("SELECT pg_advisory_xact_lock(hashtextextended($1, 1))", str(caller.workspace_id))
        member = await conn.fetchrow(
            """
            SELECT u.id, u.email, u.name, m.role FROM memberships m
            JOIN users u ON u.id = m.user_id
            WHERE m.workspace_id = $1 AND m.user_id = $2
            """,
            caller.workspace_id,
            member_id,
        )
        if member is None:
            raise ApiError("not_found")
        if member["role"] == "admin" and body.role != "admin":
            admins = await conn.fetchval(
                "SELECT count(*) FROM memberships WHERE workspace_id = $1 AND role = 'admin'",
                caller.workspace_id,
            )
            if admins <= 1:
                raise ApiError("last_admin")
        await conn.execute(
            "UPDATE memberships SET role = $3 WHERE workspace_id = $1 AND user_id = $2",
            caller.workspace_id,
            member_id,
            body.role,
        )
        await append_event(
            conn,
            workspace_id=caller.workspace_id,
            action="member.role_changed",
            target_id=str(member_id),
            actor_email=caller.email,
        )
    return ok(
        {
            "member": {
                "id": str(member_id),
                "email": member["email"],
                "name": member["name"],
                "role": body.role,
            }
        }
    )


@router.get("/api/audit")
async def list_audit(request: Request) -> Any:
    caller = await require_session(request)
    require_admin(caller)
    rows = await database.fetch(
        "SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY seq ASC", caller.workspace_id
    )
    return ok({"events": [_audit_payload(row) for row in rows]})


@router.get("/api/audit/{seq}")
async def read_audit_event(request: Request, seq: str) -> Any:
    caller = await require_session(request)
    require_admin(caller)
    if not re.fullmatch(r"[0-9]{1,18}", seq):
        raise ApiError("not_found")
    row = await database.fetchrow(
        "SELECT * FROM audit_events WHERE workspace_id = $1 AND seq = $2", caller.workspace_id, int(seq)
    )
    if row is None:
        raise ApiError("not_found")
    return ok({"event": _audit_payload(row)})


def _audit_payload(row: Any) -> dict[str, Any]:
    return {
        "seq": row["seq"],
        "action": row["action"],
        "target_id": row["target_id"],
        "actor_email": row["actor_email"],
        "at": iso(row["at"]),
        "prev_hash": row["prev_hash"],
        "hash": row["hash"],
    }
