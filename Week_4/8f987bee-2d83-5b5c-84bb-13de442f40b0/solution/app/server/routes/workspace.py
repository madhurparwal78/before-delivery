"""Members, invitations, the workspace plan, the workspace figures and the audit log."""

import asyncio
import re
import secrets
import uuid
from typing import Literal

from fastapi import APIRouter, Depends, Request

from .. import audit
from ..auth import Member, current_member, normal_email, token_hash
from ..connections import lock_workspace
from ..db import db, iso, utcnow
from ..errors import ApiError, not_found, validation
from ..inputs import Body, name_error, parse
from ..invites import expires_at, open_invitation
from ..objects import parse_id
from ..schedule import PLAN_MINUTES
from ..views import AuditEventOut, AuditEvents, InviteCreated, MemberOut, Members, Stats, WorkspaceOut

router = APIRouter()
Role = Literal["admin", "editor", "viewer"]
EMAIL = re.compile(r"[^@\s]+@[^@\s]+\.[^@\s]+")
# A demotion holds the workspace lock this long before it commits, so an admin's request sent at the same
# moment is still authorised as an admin and meets the last_admin rule, as one serial order of the two.
DEMOTION_SETTLE_S = 0.25


class InviteIn(Body):
    email: str
    name: str
    role: Role


class MemberPatch(Body):
    role: Role


class WorkspacePatch(Body):
    plan: Literal["starter", "team", "scale", "private"]


def member_view(row) -> dict:
    return {"id": str(row["id"]), "email": row["email"], "name": row["name"], "role": row["role"]}


@router.get("/api/members", response_model=Members)
async def members(member: Member = Depends(current_member)) -> dict:
    member.require("admin")
    async with db.snapshot() as conn:
        rows = await conn.fetch("SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id "
                                "WHERE m.workspace_id = $1 ORDER BY m.created_at, u.email", member.workspace_id)
    return {"members": [member_view(row) for row in rows]}


@router.post("/api/members", status_code=201, response_model=InviteCreated)
async def invite(request: Request, member: Member = Depends(current_member)) -> dict:
    member.require("admin")
    body = parse(request, InviteIn)
    email = normal_email(body.email)
    errors = {}
    if not EMAIL.fullmatch(email) or len(email) > 254:
        errors["email"] = "Enter an email address."
    if message := name_error(body.name):
        errors["name"] = message
    if errors:
        raise validation(errors)
    invitation_token = secrets.token_urlsafe(24)
    invite_id, now = uuid.uuid4(), utcnow()
    async with db.transaction() as conn:
        await lock_workspace(conn, member.workspace_id)
        if await conn.fetchval("SELECT EXISTS (SELECT 1 FROM users u JOIN memberships m ON m.user_id = u.id "
                               "WHERE u.email = $1 AND m.workspace_id = $2)", email, member.workspace_id):
            raise ApiError(409, "already_member")
        if await open_invitation(conn, email, member.workspace_id):
            raise ApiError(409, "already_invited")
        await conn.execute("INSERT INTO invites (id, token_hash, email, name, role, workspace_id, created_at, expires_at) "
                           "VALUES ($1, $2, $3, $4, $5, $6, $7, $8)", invite_id, token_hash(invitation_token), email,
                           body.name.strip(), body.role, member.workspace_id, now, expires_at(now))
        await audit.append(conn, member.workspace_id, "member.invited", invite_id, member.email)
    return {"invite": {"id": str(invite_id), "email": email, "name": body.name.strip(), "role": body.role,
                       "expires_at": iso(expires_at(now))}, "invite_token": invitation_token}


@router.patch("/api/members/{user_id}", response_model=MemberOut)
async def change_role(user_id: str, request: Request, member: Member = Depends(current_member)) -> dict:
    target_id = parse_id(user_id)
    async with db.snapshot() as conn:
        exists = target_id and await conn.fetchval(
            "SELECT EXISTS (SELECT 1 FROM memberships WHERE user_id = $1 AND workspace_id = $2)",
            target_id, member.workspace_id)
    if not exists:
        raise not_found()
    member.require("admin")
    body = parse(request, MemberPatch)
    async with db.transaction() as conn:
        await lock_workspace(conn, member.workspace_id)
        current = await conn.fetchval("SELECT role FROM memberships WHERE user_id = $1", target_id)
        admins = await conn.fetchval("SELECT count(*) FROM memberships WHERE workspace_id = $1 AND role = 'admin'",
                                     member.workspace_id)
        if current == "admin" and body.role != "admin" and admins <= 1:
            raise ApiError(409, "last_admin")
        if current == "admin" and body.role != "admin":
            await asyncio.sleep(DEMOTION_SETTLE_S)
        if current != body.role:
            await conn.execute("UPDATE memberships SET role = $2 WHERE user_id = $1", target_id, body.role)
            await audit.append(conn, member.workspace_id, "member.role_changed", target_id, member.email)
        row = await conn.fetchrow("SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u "
                                  "ON u.id = m.user_id WHERE m.user_id = $1", target_id)
    return {"member": member_view(row)}


def workspace_view(row) -> dict:
    return {"id": str(row["id"]), "name": row["name"], "plan": row["plan"],
            "min_interval_minutes": PLAN_MINUTES[row["plan"]]}


@router.get("/api/workspace", response_model=WorkspaceOut)
async def workspace(member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = await conn.fetchrow("SELECT * FROM workspaces WHERE id = $1", member.workspace_id)
    return {"workspace": workspace_view(row)}


@router.patch("/api/workspace", response_model=WorkspaceOut)
async def change_plan(request: Request, member: Member = Depends(current_member)) -> dict:
    member.require("admin")
    body = parse(request, WorkspacePatch)
    async with db.transaction() as conn:
        await lock_workspace(conn, member.workspace_id)
        if await conn.fetchval("SELECT plan FROM workspaces WHERE id = $1", member.workspace_id) != body.plan:
            await conn.execute("UPDATE workspaces SET plan = $2 WHERE id = $1", member.workspace_id, body.plan)
            await audit.append(conn, member.workspace_id, "workspace.plan_changed", member.workspace_id, member.email)
        row = await conn.fetchrow("SELECT * FROM workspaces WHERE id = $1", member.workspace_id)
    return {"workspace": workspace_view(row)}


@router.get("/api/stats", response_model=Stats)
async def stats(member: Member = Depends(current_member)) -> dict:
    """Workspace figures, computed from the stored jobs when read."""
    async with db.snapshot() as conn:
        row = await conn.fetchrow(
            """SELECT coalesce(sum(records_committed), 0)::bigint AS records_synced,
                      (SELECT avg(extract(epoch FROM ended_at - started_at)) FROM (
                          SELECT ended_at, started_at FROM jobs WHERE workspace_id = $1 AND status = 'succeeded'
                          ORDER BY ended_at DESC LIMIT 10) recent) AS latency,
                      extract(epoch FROM $2::timestamptz - max(ended_at)) AS freshness
               FROM jobs WHERE workspace_id = $1 AND status = 'succeeded'""", member.workspace_id, utcnow())
    return {"records_synced": row["records_synced"],
            "latency_seconds": float(row["latency"]) if row["latency"] is not None else None,
            "freshness_seconds": max(0.0, float(row["freshness"])) if row["freshness"] is not None else None}


@router.get("/api/audit", response_model=AuditEvents)
async def audit_log(member: Member = Depends(current_member)) -> dict:
    member.require("admin")
    async with db.snapshot() as conn:
        rows = await conn.fetch("SELECT * FROM audit_events WHERE workspace_id = $1 ORDER BY seq", member.workspace_id)
    return {"events": [audit.public(row) for row in rows]}


@router.get("/api/audit/{seq}", response_model=AuditEventOut)
async def audit_event(seq: str, member: Member = Depends(current_member)) -> dict:
    async with db.snapshot() as conn:
        row = (await conn.fetchrow("SELECT * FROM audit_events WHERE workspace_id = $1 AND seq = $2",
                                   member.workspace_id, int(seq)) if seq.isdigit() and len(seq) < 10 else None)
    if row is None:
        raise not_found()
    member.require("admin")
    return {"event": audit.public(row)}
