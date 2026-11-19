"""API endpoints. The published surface and nothing more."""
from __future__ import annotations

import datetime as dt
import json
import re
import threading
from typing import Any

from fastapi import APIRouter, Request, Response
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.responses import FileResponse

from . import accounts, builder, catalog, config, connections, db, domain, seed, sync, validation
from .core import ApiError, json_error, validation as validation_error

router = APIRouter()


# ---------------------------------------------------------------- helpers

def bearer_token(request: Request) -> str | None:
    header = request.headers.get("authorization", "")
    if header.startswith("Bearer "):
        return header[7:].strip()
    return None


def need_db() -> None:
    if not db.db_ready():
        raise ApiError("service_unavailable", 503)


def current_user(request: Request):
    """Returns (user_row, workspace_id, role, token) or raises."""
    token = bearer_token(request)
    if not token:
        raise ApiError("unauthenticated", 401)
    with db.connection() as conn:
        row = accounts.session_user(conn, token)
    if row is None:
        raise ApiError("unauthenticated", 401)
    return row, row["workspace_id"], row["role"], token


async def read_json(request: Request) -> bytes:
    return await request.body()


def parse_body(request: Request, raw: bytes, allowed: dict | None, types: dict | None = None) -> dict:
    return validation.validate_body(raw, allowed, types)


def job_payload(row) -> dict:
    return {
        "id": row["id"],
        "connection_id": row["connection_id"],
        "connection_version": int(row["connection_version"]),
        "definition_version": int(row["definition_version"]),
        "status": row["status"],
        "attempts": row["attempts"] or [],
        "records_committed": int(row["records_committed"]),
        "per_stream": row["per_stream"] or [],
        "failure_reason": row["failure_reason"],
        "trigger_request_id": row["trigger_request_id"],
        "created_at": domain.to_zulu(row["created_at"]),
        "started_at": domain.to_zulu(row["started_at"]),
        "ended_at": domain.to_zulu(row["ended_at"]),
    }


def audit_payload(row) -> dict:
    return {
        "seq": int(row["seq"]),
        "action": row["action"],
        "target_id": row["target_id"],
        "actor_email": row["actor_email"],
        "at": domain.to_zulu(row["at"]),
        "prev_hash": row["prev_hash"],
        "hash": row["hash"],
    }


def require_role(role: str, wanted: str) -> None:
    order = {"viewer": 0, "editor": 1, "admin": 2}
    if order[role] < order[wanted]:
        raise ApiError("forbidden", 403)


def get_limit(raw: str | None, default: int) -> int:
    if raw is None:
        return default
    try:
        value = int(raw)
    except (TypeError, ValueError):
        raise validation_error({"limit": "Enter a whole number."})
    if not (1 <= value <= 100):
        raise validation_error({"limit": "Choose a page size from 1 to 100."})
    return value


def idempotency_key(request: Request) -> str | None:
    key = request.headers.get("idempotency-key")
    if key is None:
        return None
    if not (1 <= len(key) <= 255) or not all(32 <= ord(ch) < 127 for ch in key):
        raise validation_error({"Idempotency-Key": "Use visible characters, 1 to 255."})
    return key


def body_fingerprint(raw: bytes) -> dict:
    try:
        parsed = json.loads(raw.decode()) if raw else {}
    except Exception:
        parsed = {}
    return parsed if isinstance(parsed, dict) else {"body": str(type(parsed))}


def idempotent_replay(conn, workspace_id: str, key: str, method: str, path: str, body: dict):
    row = conn.execute(
        "SELECT * FROM idempotency_keys WHERE workspace_id = %s AND key = %s",
        (workspace_id, key)).fetchone()
    if row is None:
        return None
    if row["expires_at"] <= dt.datetime.now(dt.timezone.utc):
        conn.execute("DELETE FROM idempotency_keys WHERE workspace_id = %s AND key = %s",
                     (workspace_id, key))
        return None
    if row["in_flight"]:
        raise ApiError("idempotency_key_in_flight", 409)
    if row["method"] != method or row["path"] != path or row["body"] != body:
        raise ApiError("idempotency_key_reused", 422)
    return row


def record_idempotency(conn, workspace_id: str, key: str, method: str, path: str,
                       body: dict, resource_id: str) -> None:
    expires = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=config.WAYLINE_IDEMPOTENCY_TTL_SECONDS)
    conn.execute(
        "INSERT INTO idempotency_keys (workspace_id, key, method, path, body, resource_id, expires_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s) ON CONFLICT (workspace_id, key) DO UPDATE SET "
        "method=excluded.method, path=excluded.path, body=excluded.body, "
        "resource_id=excluded.resource_id, expires_at=excluded.expires_at, in_flight=false",
        (workspace_id, key, method, path, json.dumps(body), resource_id, expires))


# ---------------------------------------------------------------- health

@router.get("/api/health")
def health():
    if db.db_ready():
        return JSONResponse({"status": "ok"})
    return JSONResponse({"status": "starting"}, status_code=503)


# ---------------------------------------------------------------- auth

LOGIN_FIELDS = {"email": True, "password": True, "next": True}
LOGIN_TYPES = {"email": str, "password": str, "next": str}


@router.post("/api/auth/login")
async def login(request: Request):
    need_db()
    raw = await request.body()
    body = parse_body(request, raw, LOGIN_FIELDS, LOGIN_TYPES)
    email_raw = body.get("email")
    password = body.get("password")
    errors: dict[str, str] = {}
    if not isinstance(email_raw, str) or email_raw.strip() == "":
        errors["email"] = "Enter your email."
    if not isinstance(password, str) or password == "":
        errors["password"] = "Enter your password."
    next_raw = body.get("next")
    if next_raw is not None and (not isinstance(next_raw, str) or len(next_raw) > 2000):
        errors["next"] = "The return address is too long."
    if errors:
        raise validation_error(errors)
    email = domain.normalize_email(email_raw)
    with db.connection() as conn:
        failures = accounts.count_recent_failures(conn, email)
        deadline = accounts.lockout_deadline(conn, email)
        if failures >= 5 and deadline is not None:
            remaining = int((deadline + dt.timedelta(seconds=config.WAYLINE_LOCKOUT_SECONDS)
                             - dt.datetime.now(dt.timezone.utc)).total_seconds())
            remaining = max(1, min(config.WAYLINE_LOCKOUT_SECONDS, remaining + 1))
            return JSONResponse({"error": "too_many_attempts",
                                 "request_id": request.state.request_id},
                                status_code=429, headers={"Retry-After": str(remaining)})
        user = accounts.user_by_email(conn, email)
        if user is None or not domain.verify_secret(password, user["password_hash"]):
            accounts.record_failure(conn, email)
            raise ApiError("invalid_credentials", 401)
        accounts.clear_failures(conn, email)
        membership = conn.execute("SELECT workspace_id, role FROM memberships WHERE user_id = %s",
                                  (user["id"],)).fetchone()
        token = accounts.create_session(conn, user["id"])
    redirect_to = domain.safe_return_address(next_raw)
    return {
        "token": token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": membership["role"], "workspace_id": membership["workspace_id"],
            "preferences": accounts.preferences_payload(user),
        },
        "redirect_to": redirect_to,
    }


@router.post("/api/auth/logout", status_code=204)
def logout(request: Request):
    need_db()
    token = bearer_token(request)
    if token:
        with db.connection() as conn:
            accounts.drop_session(conn, token)
    return Response(status_code=204)


@router.api_route("/api/auth/signup", methods=["GET", "POST", "PUT", "PATCH", "DELETE",
                                                 "HEAD", "OPTIONS", "TRACE"])
async def signup_not_allowed():
    """There is no sign-up. The path answers 404 for every method."""
    raise ApiError("not_found", 404)


ACCEPT_FIELDS = {"invite_token": True, "password": True}
ACCEPT_TYPES = {"invite_token": str, "password": str}


@router.post("/api/auth/accept-invite")
async def accept_invite(request: Request):
    need_db()
    raw = await request.body()
    body = parse_body(request, raw, ACCEPT_FIELDS, ACCEPT_TYPES)
    token = body.get("invite_token")
    password = body.get("password")
    if not isinstance(token, str) or token == "":
        raise validation_error({"invite_token": "Enter the invitation token."})
    with db.connection() as conn:
        invite = accounts.invite_by_token(conn, token)
        if invite is None:
            raise ApiError("not_found", 404)
        if invite["used_at"] is not None:
            raise ApiError("invite_used", 409)
        if invite["expires_at"] <= dt.datetime.now(dt.timezone.utc):
            raise ApiError("invite_expired", 410)
        existing = accounts.user_by_email(conn, domain.normalize_email(invite["email"]))
        if existing is not None:
            raise ApiError("invite_unusable", 409)
        if not isinstance(password, str) or len(password) < 12:
            raise validation_error({"password": "Use at least twelve characters."})
        with db.tx() as txn:
            user_id = accounts.create_user(conn, domain.normalize_email(invite["email"]),
                                            invite["name"], password)
            accounts.create_membership(conn, user_id, invite["workspace_id"], invite["role"])
            accounts.mark_invite_used(conn, invite["id"])
        user = accounts.user_by_email(conn, domain.normalize_email(invite["email"]))
        session_token = accounts.create_session(conn, user["id"])
    return {
        "token": session_token,
        "user": {
            "id": user["id"], "email": user["email"], "name": user["name"],
            "role": invite["role"], "workspace_id": invite["workspace_id"],
            "preferences": accounts.preferences_payload(user),
        },
    }


@router.get("/api/me")
def me(request: Request):
    need_db()
    row, _, _, _ = current_user(request)
    return {"user": {
        "id": row["id"], "email": row["email"], "name": row["name"],
        "role": row["role"], "workspace_id": row["workspace_id"],
        "preferences": accounts.preferences_payload(row),
    }}


PREF_FIELDS = {"sync_sounds": True, "theme": True}
PREF_TYPES = {"sync_sounds": bool, "theme": str}


@router.patch("/api/me/preferences")
async def update_preferences(request: Request):
    need_db()
    user, _, _, _ = current_user(request)
    raw = await request.body()
    body = parse_body(request, raw, PREF_FIELDS, PREF_TYPES)
    sync_sounds = body.get("sync_sounds")
    theme = body.get("theme")
    if theme is not None and theme not in ("light", "dark"):
        raise validation_error({"theme": "Choose light or dark."})
    with db.connection() as conn:
        prefs = accounts.set_preferences(conn, user["id"], sync_sounds, theme)
    return {"preferences": prefs}


# ---------------------------------------------------------------- members

MEMBER_FIELDS = {"email": True, "name": True, "role": True}
MEMBER_TYPES = {"email": str, "name": str, "role": str}


@router.get("/api/members")
def members(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "admin")
    with db.connection() as conn:
        return {"members": accounts.list_members(conn, workspace_id)}


@router.post("/api/members")
async def invite_member(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "admin")
    raw = await request.body()
    body = parse_body(request, raw, MEMBER_FIELDS, MEMBER_TYPES)
    email = domain.normalize_email(body.get("email", ""))
    errors: dict[str, str] = {}
    if not email or not re.match(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email):
        errors["email"] = "Enter a valid email."
    name = body.get("name")
    if not isinstance(name, str) or not name.strip():
        errors["name"] = "Enter a name."
    role_value = body.get("role")
    if role_value not in ("admin", "editor", "viewer"):
        errors["role"] = "Choose a role."
    if errors:
        raise validation_error(errors)
    with db.tx() as conn:
        member = accounts.user_by_email(conn, email)
        if member is not None and accounts.member_by_id(conn, workspace_id, member["id"]):
            raise ApiError("already_member", 409)
        if accounts.open_invite_for_email(conn, workspace_id, email):
            raise ApiError("already_invited", 409)
        token, invite_row = accounts.create_invite(conn, workspace_id, email,
                                                   name.strip(), role_value)
        accounts.write_audit(conn, workspace_id, "member.invited", invite_row["id"],
                             user["email"])
    return JSONResponse({
        "invite": {
            "id": invite_row["id"], "email": invite_row["email"], "name": invite_row["name"],
            "role": invite_row["role"],
            "expires_at": domain.to_zulu(invite_row["expires_at"]),
        },
        "invite_token": token,
    }, status_code=201)


ROLE_FIELDS = {"role": True}
ROLE_TYPES = {"role": str}


@router.patch("/api/members/{user_id}")
async def change_role(request: Request, user_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "admin")
    raw = await request.body()
    body = parse_body(request, raw, ROLE_FIELDS, ROLE_TYPES)
    role_value = accounts.validate_role(body.get("role"))
    with db.tx() as conn:
        member = accounts.member_by_id(conn, workspace_id, user_id)
        if member is None or not domain.is_well_formed_id(user_id):
            raise ApiError("not_found", 404)
        if member["role"] == "admin" and role_value != "admin":
            if accounts.count_admins(conn, workspace_id) <= 1:
                raise ApiError("last_admin", 409)
        accounts.set_role(conn, workspace_id, user_id, role_value)
        accounts.write_audit(conn, workspace_id, "member.role_changed", user_id, user["email"])
        updated = accounts.member_by_id(conn, workspace_id, user_id)
    return {"member": {"id": updated["id"], "email": updated["email"], "name": updated["name"],
                       "role": updated["role"]}}


# ---------------------------------------------------------------- workspace

PLAN_FIELDS = {"plan": True}
PLAN_TYPES = {"plan": str}


@router.get("/api/workspace")
def get_workspace(request: Request):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = accounts.workspace(conn, workspace_id)
    return {"workspace": {"id": row["id"], "name": row["name"], "plan": row["plan"],
                          "min_interval_minutes": accounts.min_interval_minutes(row["plan"])}}


@router.patch("/api/workspace")
async def change_plan(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "admin")
    raw = await request.body()
    body = parse_body(request, raw, PLAN_FIELDS, PLAN_TYPES)
    plan = accounts.validate_plan(body.get("plan"))
    with db.tx() as conn:
        accounts.set_plan(conn, workspace_id, plan)
        accounts.write_audit(conn, workspace_id, "workspace.plan_changed", workspace_id,
                             user["email"])
        row = accounts.workspace(conn, workspace_id)
    return {"workspace": {"id": row["id"], "name": row["name"], "plan": row["plan"],
                          "min_interval_minutes": accounts.min_interval_minutes(row["plan"])}}


@router.get("/api/stats")
def stats(request: Request):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = conn.execute(
            "SELECT coalesce(sum(records_committed),0) AS total FROM jobs "
            "WHERE workspace_id = %s AND status='succeeded'", (workspace_id,)).fetchone()
        recent = conn.execute(
            "SELECT started_at, ended_at FROM jobs WHERE workspace_id = %s AND status='succeeded' "
            "ORDER BY ended_at DESC LIMIT 10", (workspace_id,)).fetchall()
        last = conn.execute(
            "SELECT ended_at FROM jobs WHERE workspace_id = %s AND status='succeeded' "
            "ORDER BY ended_at DESC LIMIT 1", (workspace_id,)).fetchone()
    total = int(row["total"])
    latency = None
    if recent:
        durations = [(r["ended_at"] - r["started_at"]).total_seconds()
                     for r in recent if r["ended_at"] and r["started_at"]]
        if durations:
            latency = sum(durations) / len(durations)
    freshness = None
    if last and last["ended_at"]:
        freshness = (dt.datetime.now(dt.timezone.utc) - last["ended_at"]).total_seconds()
    return {"records_synced": total, "latency_seconds": latency,
            "freshness_seconds": freshness}


# ---------------------------------------------------------------- catalog

@router.get("/api/connector-definitions")
def connector_definitions(request: Request):
    need_db()
    token = bearer_token(request)
    workspace_id = None
    if token:
        with db.connection() as conn:
            row = accounts.session_user(conn, token)
        if row is not None:
            workspace_id = row["workspace_id"]
    params = request.query_params
    q_raw = params.get("q")
    q, q_error = validation.parse_q(q_raw)
    if q_error:
        raise validation_error({q_error: "Search text can be at most 100 characters."})
    def split(name: str) -> list[str]:
        values: list[str] = []
        for single in params.getlist(name):
            values.extend([v for v in single.split(",") if v])
        return values
    filters = {"q": q, "type": split("type"), "category": split("category"),
                "availability": split("availability")}
    with db.connection() as conn:
        rows = catalog.list_definitions(conn, workspace_id)
    return {"definitions": catalog.filter_definitions(rows, filters)}


@router.get("/api/connector-definitions/{definition_id}")
def one_definition(request: Request, definition_id: str):
    need_db()
    with db.connection() as conn:
        row = catalog.definition_row(conn, definition_id)
    if row is None:
        raise ApiError("not_found", 404)
    if row["workspace_id"] is not None:
        token = bearer_token(request)
        if not token:
            raise ApiError("not_found", 404)
        with db.connection() as conn:
            user = accounts.session_user(conn, token)
        if user is None or user["workspace_id"] != row["workspace_id"]:
            raise ApiError("not_found", 404)
    return {"definition": catalog.definition_payload(row)}


# ---------------------------------------------------------------- sources

SOURCE_FIELDS = {"name": True, "definition_id": True, "config": {"api_key": True, "start_date": True}}
SOURCE_TYPES = {"name": str, "definition_id": str, "config": {"api_key": str, "start_date": str}}


@router.get("/api/sources")
def sources(request: Request):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        rows = catalog.list_sources(conn, workspace_id)
    return {"sources": [catalog.source_payload(r) for r in rows]}


@router.post("/api/sources")
async def create_source(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    body = parse_body(request, raw, SOURCE_FIELDS, SOURCE_TYPES)
    errors: dict[str, str] = {}
    name = body.get("name")
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        errors["name"] = "Enter a name of 1 to 80 characters."
    definition_id = body.get("definition_id")
    with db.connection() as conn:
        definition = catalog.definition_row(conn, definition_id) if isinstance(definition_id, str) else None
        if definition is None or definition["workspace_id"] not in (None, workspace_id):
            errors["definition_id"] = "Choose a connector."
        else:
            if definition["type"] != "source":
                errors["definition_id"] = "Choose a source connector."
            elif not definition["runnable"]:
                raise ApiError("connector_not_installed", 422)
        if errors:
            raise validation_error(errors)
        cfg = body.get("config") or {}
        api_key = cfg.get("api_key")
        if not isinstance(api_key, str) or len(api_key) < (1 if definition["custom"] else 8):
            errors["config.api_key"] = "Enter the API key."
        start_date = cfg.get("start_date")
        if definition["custom"]:
            if start_date is not None:
                errors["config.start_date"] = "This field is not accepted here."
        else:
            if not isinstance(start_date, str) or not re.match(r"^\d{4}-\d{2}-\d{2}$", start_date or ""):
                errors["config.start_date"] = "Enter the date as YYYY-MM-DD."
            else:
                try:
                    dt.date.fromisoformat(start_date)
                except ValueError:
                    errors["config.start_date"] = "Enter a real date as YYYY-MM-DD."
        if errors:
            raise validation_error(errors)
        stored = dict(cfg)
        if definition["custom"]:
            stored = {"api_key": api_key}
        stored["api_key"] = domain.seal_secret(stored.get("api_key", ""))
        source_id = catalog.create_source(conn, workspace_id, name.strip(), definition_id, stored)
        accounts.write_audit(conn, workspace_id, "source.created", source_id, user["email"])
        row = catalog.source_by_id(conn, workspace_id, source_id)
    return JSONResponse({"source": catalog.source_payload(row)}, status_code=201)


@router.get("/api/sources/{source_id}")
def one_source(request: Request, source_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = catalog.source_by_id(conn, workspace_id, source_id)
    if row is None or not domain.is_well_formed_id(source_id):
        raise ApiError("not_found", 404)
    return {"source": catalog.source_payload(row)}


@router.post("/api/sources/{source_id}/check")
async def check_source(request: Request, source_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    if raw and raw.strip() not in (b"", b"{}"):
        body = parse_body(request, raw, {}, None)
    with db.connection() as conn:
        row = catalog.source_by_id(conn, workspace_id, source_id)
        if row is None or not domain.is_well_formed_id(source_id):
            raise ApiError("not_found", 404)
        if catalog.key_rejected(row):
            return JSONResponse({"status": "failed",
                                 "message": "The source rejected the API key.",
                                 "request_id": request.state.request_id},
                                status_code=200)
    return {"status": "succeeded"}


@router.get("/api/sources/{source_id}/catalog")
def source_catalog(request: Request, source_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        row = catalog.source_by_id(conn, workspace_id, source_id)
        if row is None or not domain.is_well_formed_id(source_id):
            raise ApiError("not_found", 404)
        if row["definition_id"] == "sample-commerce-api":
            state = catalog.source_state(conn, source_id)
            streams = catalog.sample_catalog(state)
        else:
            definition = catalog.definition_row(conn, row["definition_id"])
            streams = catalog.custom_catalog(definition, int(definition["version"]))
    return {"streams": streams}


SAMPLE_FIELDS = {"stream": True, "append": True, "update_ids": True, "add_field": True}
SAMPLE_TYPES = {"stream": str, "append": int, "update_ids": list, "add_field": str}


@router.post("/api/sources/{source_id}/sample-events")
async def sample_events(request: Request, source_id: str):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    body = parse_body(request, raw, SAMPLE_FIELDS, SAMPLE_TYPES)
    with db.connection() as conn:
        row = catalog.source_by_id(conn, workspace_id, source_id)
        if row is None or not domain.is_well_formed_id(source_id):
            raise ApiError("not_found", 404)
        if row["definition_id"] != "sample-commerce-api":
            raise ApiError("sample_events_unsupported", 422)
    stream = body.get("stream")
    errors: dict[str, str] = {}
    if stream not in catalog.SAMPLE_STREAM_ORDER:
        errors["stream"] = "Choose one of the three streams."
    chosen = sum(1 for key in ("append", "update_ids", "add_field") if key in body)
    if chosen != 1:
        errors["body"] = "Send exactly one of append, update_ids or add_field."
    append = body.get("append")
    if append is not None and (isinstance(append, bool) or not isinstance(append, int)
                               or not (1 <= append <= 500)):
        errors["append"] = "Choose a count from 1 to 500."
    update_ids = body.get("update_ids")
    if update_ids is not None and (not isinstance(update_ids, list)
                                   or not all(isinstance(v, str) for v in update_ids)):
        errors["update_ids"] = "Send a list of record ids."
    add_field = body.get("add_field")
    if add_field is not None and (not isinstance(add_field, str)
                                  or not re.match(r"^[a-z][a-z0-9_]{0,30}$", add_field or "")):
        errors["add_field"] = "Use a lowercase field name."
    if errors:
        raise validation_error(errors)
    if update_ids is not None and stream not in ("orders", "invoices"):
        raise validation_error({"update_ids": "Only orders and invoices can be updated."})
    with db.tx() as conn:
        state = catalog.source_state(conn, source_id)
        state = state or {}
        stream_state = state.setdefault(stream, {})
        appended = 0
        updated = 0
        fields: list[str] = []
        if append is not None:
            existing = stream_state.setdefault("appended", [])
            next_id = len(existing) + ({"customers": 25, "orders": 120, "invoices": 40}[stream]) + 1
            now_z = domain.to_zulu(dt.datetime.now(dt.timezone.utc))
            for offset in range(append):
                record_id = next_id + offset
                existing.append({
                    "id": str(record_id),
                    "updated_at": now_z,
                    "sample": True,
                })
            appended = append
            fields = list(stream_state.get("added_fields", {}).keys())
        if update_ids is not None:
            updates = stream_state.setdefault("updates", {})
            now_z = domain.to_zulu(dt.datetime.now(dt.timezone.utc))
            for record_id in update_ids:
                updates[record_id] = {"status": "refunded", "updated_at": now_z}
            updated = len(update_ids)
        if add_field is not None:
            added = stream_state.setdefault("added_fields", {})
            if add_field not in added:
                added[add_field] = True
            fields = list(added.keys())
        catalog.save_source_state(conn, source_id, state)
    return {"stream": stream, "appended": appended, "updated": updated, "fields": fields}


# ---------------------------------------------------------------- destinations

DEST_FIELDS = {"name": True, "definition_id": True}
DEST_TYPES = {"name": str, "definition_id": str}


@router.get("/api/destinations")
def destinations(request: Request):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        rows = catalog.list_destinations(conn, workspace_id)
    return {"destinations": [catalog.destination_payload(r) for r in rows]}


@router.post("/api/destinations")
async def create_destination(request: Request):
    need_db()
    user, workspace_id, role, _ = current_user(request)
    require_role(role, "editor")
    raw = await request.body()
    body = parse_body(request, raw, DEST_FIELDS, DEST_TYPES)
    errors: dict[str, str] = {}
    name = body.get("name")
    if not isinstance(name, str) or not (1 <= len(name.strip()) <= 80):
        errors["name"] = "Enter a name of 1 to 80 characters."
    definition_id = body.get("definition_id")
    with db.connection() as conn:
        definition = catalog.definition_row(conn, definition_id) if isinstance(definition_id, str) else None
        if definition is None or definition["workspace_id"] not in (None, workspace_id):
            errors["definition_id"] = "Choose a connector."
        else:
            if definition["type"] != "destination":
                errors["definition_id"] = "Choose a destination connector."
            elif not definition["runnable"]:
                raise ApiError("connector_not_installed", 422)
        if errors:
            raise validation_error(errors)
        dest_id = catalog.create_destination(conn, workspace_id, name.strip(), definition_id)
        accounts.write_audit(conn, workspace_id, "destination.created", dest_id, user["email"])
        row = catalog.destination_by_id(conn, workspace_id, dest_id)
    return JSONResponse({"destination": catalog.destination_payload(row)}, status_code=201)


@router.get("/api/destinations/{destination_id}/tables")
def destination_tables(request: Request, destination_id: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    with db.connection() as conn:
        dest = catalog.destination_by_id(conn, workspace_id, destination_id)
        if dest is None or not domain.is_well_formed_id(destination_id):
            raise ApiError("not_found", 404)
        tables = catalog.list_tables(conn, workspace_id, destination_id)
    return {"tables": tables}


@router.get("/api/destinations/{destination_id}/tables/{table}/records")
def destination_records(request: Request, destination_id: str, table: str):
    need_db()
    user, workspace_id, _, _ = current_user(request)
    limit = get_limit(request.query_params.get("limit"), 50)
    cursor_raw = request.query_params.get("cursor")
    with db.connection() as conn:
        dest = catalog.destination_by_id(conn, workspace_id, destination_id)
        if dest is None or not domain.is_well_formed_id(destination_id):
            raise ApiError("not_found", 404)
        if not catalog.table_exists(conn, destination_id, table):
            raise ApiError("not_found", 404)
        schema = catalog.warehouse_schema(destination_id)
        payload = domain.decode_cursor(cursor_raw)
        generation = catalog.generation(conn, destination_id, table)
        if cursor_raw and payload is None:
            raise ApiError("invalid_cursor", 400)
        if payload is not None:
            if (payload.get("d") != destination_id or payload.get("t") != table
                    or payload.get("g") != generation):
                raise ApiError("invalid_cursor", 400)
        total_row = conn.execute(f'SELECT count(*) AS n FROM {schema}."{table}"').fetchone()
        total = int(total_row["n"])
        if payload is None:
            rows = conn.execute(
                f'SELECT * FROM {schema}."{table}" ORDER BY seq LIMIT %s', (limit,)).fetchall()
        elif payload.get("k") == "after":
            rows = conn.execute(
                f'SELECT * FROM {schema}."{table}" WHERE seq > %s ORDER BY seq LIMIT %s',
                (payload["s"], limit)).fetchall()
        else:
            preceding = conn.execute(
                f'SELECT seq FROM {schema}."{table}" WHERE seq < %s ORDER BY seq DESC LIMIT %s',
                (payload["s"], limit)).fetchall()
            keys = [r["seq"] for r in preceding][::-1]
            if not keys:
                rows = []
            else:
                rows = conn.execute(
                    f'SELECT * FROM {schema}."{table}" WHERE seq = ANY(%s) ORDER BY seq',
                    (keys,)).fetchall()
        def make_cursor(kind: str, anchor: int) -> str:
            return domain.encode_cursor({"k": kind, "s": anchor, "d": destination_id,
                                         "t": table, "g": generation})
        records = [record_payload(r) for r in rows]
        next_cursor = None
        has_more = False
        if rows:
            last_seq = rows[-1]["seq"]
            more = conn.execute(f'SELECT 1 FROM {schema}."{table}" WHERE seq > %s LIMIT 1',
                                (last_seq,)).fetchone()
            has_more = more is not None
            if has_more:
                next_cursor = make_cursor("after", last_seq)
        prev_cursor = None
        if rows:
            first_seq = rows[0]["seq"]
            before = conn.execute(f'SELECT 1 FROM {schema}."{table}" WHERE seq < %s LIMIT 1',
                                  (first_seq,)).fetchone()
            if before is not None:
                prev_cursor = make_cursor("before", first_seq)
    return {"records": records, "next_cursor": next_cursor, "prev_cursor": prev_cursor,
            "has_more": has_more, "total_count": total}


def record_payload(row) -> dict:
    data = row["data"] or {}
    out = dict(data)
    out["_wayline_job_id"] = row["_wayline_job_id"]
    out["_wayline_extracted_at"] = domain.to_zulu(row["_wayline_extracted_at"])
    return out
