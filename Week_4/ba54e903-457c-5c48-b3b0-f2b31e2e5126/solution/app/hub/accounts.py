"""Accounts: sign-up, sign-in with lockout, sessions, email confirmation, profile and password change."""

from __future__ import annotations

import re
import secrets
import unicodedata
from datetime import date, datetime, timezone
from typing import Any

from flask import g

from . import auth, catalog, config, db, events, mail
from .errors import ApiError, invalid, retry_after
from .inputs import Body
from .router import route
from .serialize import self_user

EMAIL_PATTERN = re.compile(r"[^@\s\x00-\x1f\x7f]+@[^@\s\x00-\x1f\x7f.]+(?:\.[^@\s\x00-\x1f\x7f.]+)+")
USERNAME_PATTERN = re.compile(r"[a-z0-9_.]{2,32}")
DATE_PATTERN = re.compile(r"[0-9]{4}-[0-9]{2}-[0-9]{2}")
CONTROL = re.compile(r"[\x00-\x1f\x7f]")
LOCKOUT_FAILURES = 5
MINIMUM_AGE = 13


def valid_email(value: str) -> bool:
    return len(value) <= 254 and EMAIL_PATTERN.fullmatch(value) is not None


def clean_display_name(value: str) -> str | None:
    """The trimmed, NFC-normalised name, or None when it breaks the display-name rule."""
    name = unicodedata.normalize("NFC", value.strip())
    if not 1 <= len(name) <= 32 or CONTROL.search(name):
        return None
    return name


def old_enough(value: str) -> bool:
    """A real YYYY-MM-DD date in the past on which the person turned 13 on or before today (UTC)."""
    if not DATE_PATTERN.fullmatch(value):
        return False
    try:
        born = date.fromisoformat(value)
    except ValueError:
        return False
    today = datetime.now(timezone.utc).date()
    if born >= today:
        return False
    try:
        thirteenth = born.replace(year=born.year + MINIMUM_AGE)
    except ValueError:
        thirteenth = date(born.year + MINIMUM_AGE, 3, 1)
    return thirteenth <= today


def queue_confirmation(cur: db.Cursor, member: dict[str, Any]) -> None:
    """Supersede every earlier token of the member and queue one confirmation email."""
    cur.execute("DELETE FROM email_tokens WHERE member_id = %s", (member["id"],))
    token = secrets.token_urlsafe(32)
    cur.execute("INSERT INTO email_tokens (member_id, token_hash) VALUES (%s, %s)", (member["id"], auth.sha256_hex(token)))
    mail.enqueue(
        cur, to=member["email"], name=member["display_name"], subject="Confirm your Community Hub account",
        body=f"Hi {member['display_name']}, confirm your email for @{member['username']}.\n"
             f"Confirm your address: {config.APP_PUBLIC_URL}/verify-email?token={token}\n")


def _session(member: dict[str, Any], token: str, status: int = 200) -> tuple[dict[str, Any], int]:
    return {"access_token": token, "token_type": "bearer", "user": self_user(member)}, status


def _taken_field(cur: db.Cursor, email: str, username: str) -> str | None:
    cur.execute("SELECT 1 FROM members WHERE email = %s", (email.lower(),))
    if cur.fetchone():
        return "email"
    cur.execute("SELECT 1 FROM members WHERE lower(username) = %s", (username.lower(),))
    return "username" if cur.fetchone() else None


@route("POST", "/api/auth/signup", body="json")
def signup() -> tuple[dict[str, Any], int]:
    body: Body = g.body
    email = body.string("email")
    if not valid_email(email):
        raise invalid("email")
    display_name = clean_display_name(body.string("display_name"))
    if display_name is None:
        raise invalid("display_name")
    username = body.string("username")
    if not USERNAME_PATTERN.fullmatch(username):
        raise invalid("username")
    password = body.string("password")
    if not 8 <= len(password) <= 128:
        raise invalid("password")
    if not old_enough(body.string("date_of_birth")):
        raise invalid("date_of_birth")
    email = email.lower()
    password_hash = auth.hash_password(password)
    try:
        with db.tx() as cur:
            cur.execute(
                "INSERT INTO members (email, username, display_name, password_hash, date_of_birth) "
                "VALUES (%s, %s, %s, %s, %s) RETURNING *",
                (email, username, display_name, password_hash, body.string("date_of_birth")))
            member = cur.fetchone()
            queue_confirmation(cur, member)
            token = auth.new_token(cur, member["id"])
    except db.UniqueViolation:
        with db.tx() as cur:
            raise ApiError("conflict", _taken_field(cur, email, username) or "email") from None
    return _session(member, token, 201)


def _lockout_remaining(cur: db.Cursor, email: str) -> int | None:
    """Seconds left on the lock, or None when the email may try.

    Locked: the five newest failures all fall within one lockout period and the newest is still
    younger than that period. Refused attempts add no failure, so the lock never extends.
    """
    cur.execute(
        "WITH newest AS (SELECT created_at FROM login_failures WHERE email = %(email)s ORDER BY created_at DESC LIMIT %(n)s) "
        "SELECT ceil(extract(epoch FROM (max(created_at) + make_interval(secs => %(window)s) - clock_timestamp()))) AS left "
        "FROM newest HAVING count(*) = %(n)s AND max(created_at) - min(created_at) < make_interval(secs => %(window)s) "
        "AND max(created_at) + make_interval(secs => %(window)s) > clock_timestamp()",
        {"email": email, "window": config.LOGIN_LOCKOUT_SECONDS, "n": LOCKOUT_FAILURES})
    row = cur.fetchone()
    return None if row is None else min(max(int(row["left"]), 1), config.LOGIN_LOCKOUT_SECONDS)


@route("POST", "/api/auth/login", body="json")
def login() -> tuple[dict[str, Any], int]:
    email = g.body.string("email").lower()
    password = g.body.string("password")
    outcome: tuple[dict[str, Any], int] | int | None = None
    with db.tx() as cur:
        db.advisory(cur, f"login:{email}")
        locked = _lockout_remaining(cur, email)
        if locked is not None:
            outcome = locked
        else:
            cur.execute("SELECT * FROM members WHERE email = %s", (email,))
            member = cur.fetchone()
            if member is not None and auth.verify_password(password, member["password_hash"]):
                cur.execute("DELETE FROM login_failures WHERE email = %s", (email,))
                outcome = _session(member, auth.new_token(cur, member["id"]))
            else:
                cur.execute("INSERT INTO login_failures (email) VALUES (%s)", (email,))
                cur.execute("DELETE FROM login_failures WHERE email = %s AND created_at < clock_timestamp() - make_interval(secs => %s)",
                            (email, 2 * config.LOGIN_LOCKOUT_SECONDS))
    if isinstance(outcome, int):
        raise ApiError("rate_limited", headers=retry_after(outcome))
    if outcome is None:
        raise ApiError("invalid_credentials")
    return outcome


@route("POST", "/api/auth/logout", session="required")
def logout() -> None:
    db.run("UPDATE tokens SET revoked_at = clock_timestamp() WHERE id = %s", (g.token_id,))


@route("POST", "/api/auth/verify-email", body="json")
def verify_email() -> dict[str, bool]:
    token = g.body.string("token")
    with db.tx() as cur:
        cur.execute(
            "DELETE FROM email_tokens WHERE token_hash = %s "
            "AND created_at > clock_timestamp() - make_interval(secs => %s) RETURNING member_id",
            (auth.sha256_hex(token), config.EMAIL_TOKEN_TTL_SECONDS))
        found = cur.fetchone()
        if found is None:
            raise invalid("token")
        cur.execute("DELETE FROM email_tokens WHERE member_id = %s", (found["member_id"],))
        cur.execute("UPDATE members SET email_verified = true WHERE id = %s", (found["member_id"],))
    return {"email_verified": True}


@route("POST", "/api/auth/resend-confirmation", session="required")
def resend_confirmation() -> None:
    with db.tx() as cur:
        db.advisory(cur, f"member:{g.member['id']}")
        cur.execute("SELECT * FROM members WHERE id = %s", (g.member["id"],))
        member = cur.fetchone()
        if member["email_verified"]:
            raise ApiError("conflict")
        queue_confirmation(cur, member)


@route("GET", "/api/users/@me", session="required")
def me() -> dict[str, Any]:
    return self_user(g.member)


@route("PATCH", "/api/users/@me", session="required", body="json")
def update_me() -> dict[str, Any]:
    body: Body = g.body
    icon = body.raw("app_icon")
    if icon in catalog.APP_ICONS and icon != "classic" and "custom_app_icons" not in catalog.ENTITLEMENTS[g.member["tier"]]:
        raise ApiError("entitlement_required")
    changes: dict[str, str] = {}
    if body.has("display_name"):
        name = clean_display_name(body.string("display_name"))
        if name is None:
            raise invalid("display_name")
        changes["display_name"] = name
    if body.has("status"):
        status = body.string("status")
        if status not in catalog.STATUSES:
            raise invalid("status")
        changes["status"] = status
    if body.has("app_icon"):
        if body.string("app_icon") not in catalog.APP_ICONS:
            raise invalid("app_icon")
        changes["app_icon"] = icon
    with db.tx() as cur:
        if changes:
            assignments = ", ".join(f"{column} = %s" for column in changes)
            cur.execute(f"UPDATE members SET {assignments} WHERE id = %s RETURNING *", (*changes.values(), g.member["id"]))
        else:
            cur.execute("SELECT * FROM members WHERE id = %s", (g.member["id"],))
        member = cur.fetchone()
        if changes.keys() & {"status", "display_name"}:
            cur.execute("SELECT community_id FROM memberships WHERE member_id = %s", (member["id"],))
            for row in cur.fetchall():
                events.publish(cur, "members.changed", community_id=row["community_id"])
    return self_user(member)


@route("POST", "/api/users/@me/password", session="required", body="json")
def change_password() -> None:
    current, new = g.body.string("current_password"), g.body.string("new_password")
    failure: str | None = None
    with db.tx() as cur:
        db.advisory(cur, f"member:{g.member['id']}")
        cur.execute("SELECT 1 FROM tokens WHERE id = %s AND revoked_at IS NULL", (g.token_id,))
        if cur.fetchone() is None:
            raise ApiError("unauthorized")
        cur.execute("SELECT * FROM members WHERE id = %s", (g.member["id"],))
        member = cur.fetchone()
        if not auth.verify_password(current, member["password_hash"]):
            failure = "current_password"
        elif not 8 <= len(new) <= 128 or new == current:
            failure = "new_password"
        else:
            cur.execute("UPDATE members SET password_hash = %s WHERE id = %s", (auth.hash_password(new), member["id"]))
            auth.revoke_tokens(cur, member["id"], except_token_id=g.token_id)
            mail.enqueue(cur, to=member["email"], name=member["display_name"],
                         subject="Your Community Hub password was changed",
                         body=f"Hi {member['display_name']}, the password for @{member['username']} was just changed. "
                              "Every other session was signed out. If this was not you, reset it from the login page.\n")
    if failure:
        raise invalid(failure)
