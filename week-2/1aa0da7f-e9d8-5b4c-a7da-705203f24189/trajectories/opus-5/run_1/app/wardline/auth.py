"""Sign-in, lockout, sessions and step-up proofs."""

from __future__ import annotations

import base64
import hashlib
import hmac
import os
import secrets
import struct
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import db, ledger
from .config import CONFIG
from .errors import ApiError
from .validation import is_unstorable, trim

SESSION_COOKIE = "wardline_session"
PBKDF2_ROUNDS = 120000
_DUMMY_SALT = "0" * 32


def hash_password(password: str, salt: str | None = None) -> str:
    salt = salt or os.urandom(16).hex()
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ROUNDS
    )
    return f"pbkdf2${PBKDF2_ROUNDS}${salt}${digest.hex()}"


def verify_password(password: str, stored: str) -> bool:
    try:
        _, rounds, salt, want = stored.split("$")
        digest = hashlib.pbkdf2_hmac(
            "sha256", password.encode("utf-8"), bytes.fromhex(salt), int(rounds)
        )
    except (ValueError, TypeError):
        return False
    return hmac.compare_digest(digest.hex(), want)


def _burn_password_work(password: str) -> None:
    """Unknown accounts take the same password work as known ones."""
    hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(_DUMMY_SALT), PBKDF2_ROUNDS
    )


def token_digest(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def new_token(size: int = 32) -> str:
    return secrets.token_urlsafe(size)


def totp_code(secret: str, step: int) -> str:
    key = base64.b32decode(secret.upper() + "=" * (-len(secret) % 8))
    mac = hmac.new(key, struct.pack(">Q", step), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    value = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return f"{value % 1000000:06d}"


def verify_code(secret: str, code: str) -> bool:
    code = trim(code)
    if len(code) != 6 or not code.isdigit():
        return False
    step = int(time.time()) // 30
    return any(
        hmac.compare_digest(totp_code(secret, step + drift), code)
        for drift in (-1, 0, 1)
    )


def identity_target(email: str, user: dict | None) -> str:
    if user is not None:
        return user["id"]
    digest = hashlib.sha256(trim(email).lower().encode("utf-8")).hexdigest()
    return f"email:{digest}"


def _lockout_row(cur: Any, identity: str) -> dict | None:
    cur.execute(
        "SELECT * FROM sign_in_attempts WHERE identity = %s FOR UPDATE", (identity,)
    )
    return cur.fetchone()


def check_lockout(cur: Any, identity: str) -> None:
    row = _lockout_row(cur, identity)
    now = datetime.now(timezone.utc)
    if row and row["locked_until"] and row["locked_until"] > now:
        remaining = max(1, int((row["locked_until"] - now).total_seconds()))
        raise ApiError("sign_in_locked", headers={"Retry-After": str(remaining)})


def record_failure(
    cur: Any, identity: str, target: str, actor_id: str, session_id: str | None
) -> None:
    now = datetime.now(timezone.utc)
    cur.execute(
        """
        INSERT INTO sign_in_attempts (identity, fails, target)
        VALUES (%s, 1, %s)
        ON CONFLICT (identity) DO UPDATE SET fails = sign_in_attempts.fails + 1,
            target = EXCLUDED.target
        RETURNING fails
        """,
        (identity, target),
    )
    fails = cur.fetchone()["fails"]
    if fails >= 5:
        locked_until = now + timedelta(seconds=CONFIG.lockout_seconds)
        cur.execute(
            "UPDATE sign_in_attempts SET locked_until = %s, fails = 0 WHERE identity = %s",
            (locked_until, identity),
        )
        ledger.append(
            cur,
            action="signin.locked",
            actor_id=actor_id,
            session_id=session_id,
            target=target,
            detail={"seconds": CONFIG.lockout_seconds},
        )
        ledger.raise_signal(cur, "sign_in_lockout", target)


def clear_failures(cur: Any, identity: str) -> None:
    cur.execute(
        "UPDATE sign_in_attempts SET fails = 0, locked_until = NULL WHERE identity = %s",
        (identity,),
    )


def find_user_by_email(cur: Any, email: str) -> dict | None:
    cur.execute("SELECT * FROM users WHERE email = %s", (trim(email).lower(),))
    row = cur.fetchone()
    return dict(row) if row else None


def sign_in(email: str, password: str) -> tuple[dict, str, str]:
    """Returns (user, session_id, cookie value)."""
    identity = trim(email).lower()
    if is_unstorable(email) or is_unstorable(password):
        raise ApiError("sign_in_failed")
    opened = _open_session(identity, email, password)
    if opened is None:
        raise ApiError("sign_in_failed")
    return opened


def _open_session(
    identity: str, email: str, password: str
) -> tuple[dict, str, str] | None:
    """Commits the failure count or the new session before anything is refused."""
    with db.tx() as cur:
        check_lockout(cur, identity)
        user = find_user_by_email(cur, email)
        if user is None:
            _burn_password_work(password)
            ok = False
        else:
            ok = verify_password(password, user["password_hash"])
        if not ok:
            record_failure(
                cur, identity, identity_target(email, user), "system", None
            )
            return None
        clear_failures(cur, identity)
        now = datetime.now(timezone.utc)
        session_id = db.next_id(cur, "SES", width=6)
        cookie = new_token()
        cur.execute(
            """
            INSERT INTO sessions
                (id, user_id, cookie_hash, created_at, last_activity_at, state)
            VALUES (%s, %s, %s, %s, %s, 'active')
            """,
            (session_id, user["id"], token_digest(cookie), now, now),
        )
        ledger.append(
            cur,
            action="session.opened",
            actor_id=user["id"],
            session_id=session_id,
            target=session_id,
        )
        return user, session_id, cookie


def close_session(cur: Any, session: dict, reason: str) -> None:
    cur.execute(
        "UPDATE sessions SET state = 'closed', closed_reason = %s WHERE id = %s AND state = 'active'",
        (reason, session["id"]),
    )
    if cur.rowcount == 0:
        return
    ledger.append(
        cur,
        action="session.closed",
        actor_id=session["user_id"],
        session_id=session["id"],
        target=session["id"],
        detail={"reason": reason},
    )


def load_session(cookie: str | None, background: bool) -> tuple[dict, dict] | None:
    """Returns (user, session) for a live session, closing one that has ended."""
    if not cookie:
        return None
    digest = token_digest(cookie)
    now = datetime.now(timezone.utc)
    with db.tx() as cur:
        cur.execute(
            """
            SELECT s.*, u.name, u.role, u.email
            FROM sessions s JOIN users u ON u.id = s.user_id
            WHERE s.cookie_hash = %s
            """,
            (digest,),
        )
        row = cur.fetchone()
        if row is None or row["state"] != "active":
            return None
        session = {
            "id": row["id"],
            "user_id": row["user_id"],
            "created_at": row["created_at"],
            "last_activity_at": row["last_activity_at"],
        }
        if now >= row["created_at"] + timedelta(seconds=CONFIG.session_ttl_seconds):
            close_session(cur, session, "expired")
            return None
        if now >= row["last_activity_at"] + timedelta(
            seconds=CONFIG.session_idle_seconds
        ):
            close_session(cur, session, "idle")
            return None
        if not background:
            cur.execute(
                "UPDATE sessions SET last_activity_at = %s WHERE id = %s", (now, row["id"])
            )
        user = {
            "id": row["user_id"],
            "name": row["name"],
            "role": row["role"],
            "email": row["email"],
        }
        return user, session


def revoke_sessions(cur: Any, user_id: str) -> int:
    cur.execute(
        "SELECT id, user_id FROM sessions WHERE user_id = %s AND state = 'active'",
        (user_id,),
    )
    rows = cur.fetchall()
    for row in rows:
        cur.execute(
            "UPDATE sessions SET state = 'closed', closed_reason = 'revoked' WHERE id = %s",
            (row["id"],),
        )
    return len(rows)


def create_step_up(user: dict, session_id: str, password: str, code: str) -> tuple[str, int]:
    made = _make_proof(user, session_id, password, code)
    if made is None:
        raise ApiError("step_up_failed")
    return made


def _make_proof(
    user: dict, session_id: str, password: str, code: str
) -> tuple[str, int] | None:
    identity = user["email"].lower()
    with db.tx() as cur:
        check_lockout(cur, identity)
        cur.execute("SELECT * FROM users WHERE id = %s", (user["id"],))
        row = cur.fetchone()
        ok = verify_password(password, row["password_hash"]) and verify_code(
            row["totp_secret"], code
        )
        if not ok:
            record_failure(cur, identity, user["id"], user["id"], session_id)
            return None
        clear_failures(cur, identity)
        token = new_token()
        proof_id = db.next_id(cur, "STP", width=6)
        expires_at = datetime.now(timezone.utc) + timedelta(
            seconds=CONFIG.step_up_ttl_seconds
        )
        cur.execute(
            """
            INSERT INTO step_up_proofs (id, user_id, session_id, token_hash, expires_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (proof_id, user["id"], session_id, token_digest(token), expires_at),
        )
        return token, CONFIG.step_up_ttl_seconds


def step_up_present(proof: str | None, session_id: str) -> None:
    """Refuses a missing, malformed, foreign, spent or expired proof."""
    if not proof:
        raise ApiError("step_up_required")
    with db.tx() as cur:
        cur.execute(
            "SELECT * FROM step_up_proofs WHERE token_hash = %s", (token_digest(proof),)
        )
        row = cur.fetchone()
    if (
        row is None
        or row["session_id"] != session_id
        or row["used_at"] is not None
        or row["expires_at"] <= datetime.now(timezone.utc)
    ):
        raise ApiError("step_up_required")


def consume_step_up(cur: Any, proof: str, session_id: str) -> None:
    """Consumes the proof in the action's own transaction; exactly one request wins."""
    cur.execute(
        """
        UPDATE step_up_proofs SET used_at = now()
        WHERE token_hash = %s AND session_id = %s AND used_at IS NULL
          AND expires_at > now()
        RETURNING id
        """,
        (token_digest(proof), session_id),
    )
    if cur.fetchone() is None:
        raise ApiError("step_up_required")
