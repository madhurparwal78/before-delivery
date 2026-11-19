"""Accounts, sessions, invitations, roles, plans, audit events."""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import secrets

from . import config, db, domain
from .core import validation


# ---------------------------------------------------------------- sessions

def create_session(conn, user_id: str) -> str:
    token = "wl_" + secrets.token_hex(24)
    digest = hashlib.sha256(token.encode()).hexdigest()
    conn.execute("INSERT INTO sessions (token_hash, user_id) VALUES (%s,%s)", (digest, user_id))
    return token


def session_user(conn, token: str | None):
    if not token:
        return None
    digest = hashlib.sha256(token.encode()).hexdigest()
    row = conn.execute(
        "SELECT u.id, u.email, u.name, u.preferences, m.workspace_id, m.role "
        "FROM sessions s JOIN users u ON u.id = s.user_id "
        "JOIN memberships m ON m.user_id = u.id "
        "WHERE s.token_hash = %s", (digest,)).fetchone()
    return row


def drop_session(conn, token: str) -> None:
    digest = hashlib.sha256(token.encode()).hexdigest()
    conn.execute("DELETE FROM sessions WHERE token_hash = %s", (digest,))


# ---------------------------------------------------------------- sign-in lockout

def _prune_attempts(conn, email: str) -> None:
    horizon = dt.datetime.now(dt.timezone.utc) - dt.timedelta(seconds=config.WAYLINE_LOCKOUT_SECONDS)
    conn.execute("DELETE FROM sign_in_attempts WHERE email = %s AND failed_at < %s",
                 (email, horizon))


def count_recent_failures(conn, email: str) -> int:
    _prune_attempts(conn, email)
    row = conn.execute("SELECT count(*) AS n FROM sign_in_attempts WHERE email = %s",
                       (email,)).fetchone()
    return int(row["n"])


def record_failure(conn, email: str) -> None:
    conn.execute("INSERT INTO sign_in_attempts (email) VALUES (%s)", (email,))


def clear_failures(conn, email: str) -> None:
    conn.execute("DELETE FROM sign_in_attempts WHERE email = %s", (email,))


def lockout_deadline(conn, email: str) -> dt.datetime | None:
    """The moment of the fifth failure within one lockout period, if any."""
    row = conn.execute(
        "SELECT failed_at, count(*) OVER () AS total FROM sign_in_attempts "
        "WHERE email = %s ORDER BY failed_at DESC LIMIT 5", (email,)).fetchall()
    if len(row) < 5:
        return None
    return row[-1]["failed_at"]


# ---------------------------------------------------------------- members & roles

def member_by_id(conn, workspace_id: str, user_id: str):
    return conn.execute(
        "SELECT u.id, u.email, u.name, m.role FROM memberships m JOIN users u ON u.id = m.user_id "
        "WHERE m.workspace_id = %s AND m.user_id = %s", (workspace_id, user_id)).fetchone()


def count_admins(conn, workspace_id: str) -> int:
    row = conn.execute("SELECT count(*) AS n FROM memberships "
                       "WHERE workspace_id = %s AND role = 'admin'", (workspace_id,)).fetchone()
    return int(row["n"])


def set_role(conn, workspace_id: str, user_id: str, role: str) -> None:
    conn.execute("UPDATE memberships SET role = %s WHERE workspace_id = %s AND user_id = %s",
                 (role, workspace_id, user_id))


def list_members(conn, workspace_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT u.id, u.email, u.name, m.role FROM memberships m "
        "JOIN users u ON u.id = m.user_id WHERE m.workspace_id = %s ORDER BY u.created_at, u.id",
        (workspace_id,)).fetchall()
    return [dict(r) for r in rows]


# ---------------------------------------------------------------- invitations

def create_invite(conn, workspace_id: str, email: str, name: str, role: str) -> tuple[str, dict]:
    invite_id = domain.new_id("inv_")
    token = "ivt_" + secrets.token_hex(18)
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    expires_at = dt.datetime.now(dt.timezone.utc) + dt.timedelta(seconds=config.WAYLINE_INVITE_TTL_SECONDS)
    conn.execute(
        "INSERT INTO invites (id, token_hash, email, name, role, workspace_id, expires_at) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (invite_id, token_hash, email, name, role, workspace_id, expires_at))
    row = conn.execute("SELECT * FROM invites WHERE id = %s", (invite_id,)).fetchone()
    return token, dict(row)


def invite_by_token(conn, token: str):
    token_hash = hashlib.sha256(token.encode()).hexdigest()
    return conn.execute("SELECT * FROM invites WHERE token_hash = %s", (token_hash,)).fetchone()


def open_invite_for_email(conn, workspace_id: str, email: str):
    return conn.execute(
        "SELECT * FROM invites WHERE workspace_id = %s AND lower(email) = %s "
        "AND used_at IS NULL AND expires_at > now() ORDER BY created_at DESC LIMIT 1",
        (workspace_id, email)).fetchone()


def mark_invite_used(conn, invite_id: str) -> None:
    conn.execute("UPDATE invites SET used_at = now() WHERE id = %s", (invite_id,))


# ---------------------------------------------------------------- workspace & plans

def workspace(conn, workspace_id: str):
    return conn.execute("SELECT * FROM workspaces WHERE id = %s", (workspace_id,)).fetchone()


def set_plan(conn, workspace_id: str, plan: str) -> None:
    conn.execute("UPDATE workspaces SET plan = %s WHERE id = %s", (plan, workspace_id))


def min_interval_minutes(plan: str) -> int:
    return config.PLANS[plan]


# ---------------------------------------------------------------- users

def create_user(conn, email: str, name: str, password: str) -> str:
    user_id = domain.new_id("usr_")
    hashed = domain.hash_secret(password)
    conn.execute(
        "INSERT INTO users (id, email, name, password_hash, preferences) "
        "VALUES (%s,%s,%s,%s,%s)",
        (user_id, email, name, hashed, json.dumps(default_preferences())))
    return user_id


def default_preferences() -> dict:
    return {"sync_sounds": False, "theme": "light"}


def create_membership(conn, user_id: str, workspace_id: str, role: str) -> None:
    conn.execute("INSERT INTO memberships (user_id, workspace_id, role) VALUES (%s,%s,%s)",
                 (user_id, workspace_id, role))


def user_by_email(conn, email: str):
    return conn.execute("SELECT * FROM users WHERE email = %s", (email,)).fetchone()


def preferences_payload(row) -> dict:
    prefs = row["preferences"] or {}
    return {
        "sync_sounds": bool(prefs.get("sync_sounds", False)),
        "theme": prefs.get("theme") or "light",
    }


def set_preferences(conn, user_id: str, sync_sounds, theme) -> dict:
    row = conn.execute("SELECT preferences FROM users WHERE id = %s", (user_id,)).fetchone()
    prefs = preferences_payload(row)
    if sync_sounds is not None:
        prefs["sync_sounds"] = bool(sync_sounds)
    if theme is not None:
        prefs["theme"] = theme
    conn.execute("UPDATE users SET preferences = %s WHERE id = %s",
                 (json.dumps(prefs), user_id))
    return prefs


# ---------------------------------------------------------------- audit

def write_audit(conn, workspace_id: str, action: str, target_id: str, actor_email: str) -> int:
    row = conn.execute(
        "SELECT seq, hash FROM audit_events WHERE workspace_id = %s "
        "ORDER BY seq DESC LIMIT 1", (workspace_id,)).fetchone()
    prev_hash = domain.GENESIS
    next_seq = 1
    if row:
        prev_hash = row["hash"]
        next_seq = int(row["seq"]) + 1
    digest = domain.audit_hash(prev_hash, next_seq, action, target_id, actor_email)
    conn.execute(
        "INSERT INTO audit_events (workspace_id, seq, action, target_id, actor_email, prev_hash, hash) "
        "VALUES (%s,%s,%s,%s,%s,%s,%s)",
        (workspace_id, next_seq, action, target_id, actor_email, prev_hash, digest))
    return next_seq


def list_audit(conn, workspace_id: str) -> list[dict]:
    rows = conn.execute(
        "SELECT seq, action, target_id, actor_email, at, prev_hash, hash "
        "FROM audit_events WHERE workspace_id = %s ORDER BY seq ASC", (workspace_id,)).fetchall()
    return [dict(r) for r in rows]


def validate_role(value) -> str:
    if value not in ("admin", "editor", "viewer"):
        raise validation({"role": "Choose a role."})
    return value


def validate_plan(value) -> str:
    if value not in config.PLANS:
        raise validation({"plan": "Choose one of the four plans."})
    return value
