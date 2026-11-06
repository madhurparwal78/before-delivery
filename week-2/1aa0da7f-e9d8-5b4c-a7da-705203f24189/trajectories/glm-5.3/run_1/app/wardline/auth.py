"""Session, sign-in lockout and step-up rules (DP-01, DP-03, DP-05, DP-07)."""
from __future__ import annotations

import datetime
import secrets
from typing import Any

import psycopg

from . import ledger, security
from .config import Config
from .db import Database
from .errors import ApiError, sign_in_failed, sign_in_locked, step_up_failed, unauthenticated

BACKGROUND_HEADER = "x-wardline-background"


class SessionInfo:
    def __init__(self, record: dict):
        self.id: str = record["id"]
        self.user: dict = record["user"]
        self.session: dict = record["session"]

    @property
    def user_id(self) -> str:
        return self.user["id"]

    @property
    def role(self) -> str:
        return self.user["role"]


class Sessions:
    def __init__(self, cfg: Config, db: Database):
        self.cfg = cfg
        self.db = db

    def open(self, cur, user: dict) -> dict:
        token = security.new_token()
        cur.execute(
            "INSERT INTO sessions (id, token_sha256, user_id, opened_at, last_activity) "
            "VALUES (%s, %s, %s, now(), now()) RETURNING id",
            (security.new_id("SES", secrets.randbelow(9000) + 1000), security.hash_token(token), user["id"]),
        )
        session_id = cur.fetchone()[0]
        ledger.append(cur, user["id"], session_id, "session.opened", session_id, {})
        return {"token": token, "session_id": session_id}

    def find_active(self, conn: psycopg.Connection, token: str | None) -> SessionInfo | None:
        if not token:
            return None
        digest = security.hash_token(token)
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT s.id, s.closed, s.opened_at, s.last_activity, "
                    "p.id, p.name, p.email, p.role "
                    "FROM sessions s JOIN people p ON p.id = s.user_id "
                    "WHERE s.token_sha256 = %s",
                    (digest,),
                )
                row = cur.fetchone()
        except psycopg.Error:
            raise unauthenticated()
        if not row:
            return None
        sid, closed, opened_at, last_activity, uid, name, email, role = row
        now = datetime.datetime.now(datetime.timezone.utc)
        opened_at = opened_at.astimezone(datetime.timezone.utc)
        last_activity = last_activity.astimezone(datetime.timezone.utc)
        if closed is not None:
            return None
        if (now - opened_at).total_seconds() > self.cfg.session_ttl:
            self._close(conn, sid, uid, "expired")
            return None
        if (now - last_activity).total_seconds() > self.cfg.session_idle:
            self._close(conn, sid, uid, "idle")
            return None
        return SessionInfo({
            "id": sid,
            "user": {"id": uid, "name": name, "email": email, "role": role},
            "session": {"opened_at": opened_at, "last_activity": last_activity},
        })

    def _close(self, conn: psycopg.Connection, session_id: str, user_id: str, reason: str) -> None:
        try:
            with conn.cursor() as cur:
                cur.execute(
                    "UPDATE sessions SET closed = %s WHERE id = %s AND closed IS NULL",
                    (reason, session_id),
                )
                if cur.rowcount:
                    ledger.append(cur, user_id, session_id, "session.closed", session_id, {"reason": reason})
            conn.commit()
        except psycopg.Error:
            try:
                conn.rollback()
            except psycopg.Error:
                pass

    def close(self, cur, session_id: str, user_id: str, reason: str) -> None:
        cur.execute("UPDATE sessions SET closed = %s WHERE id = %s AND closed IS NULL", (reason, session_id))
        if cur.rowcount:
            ledger.append(cur, user_id, session_id, "session.closed", session_id, {"reason": reason})

    def touch(self, cur, session_id: str) -> None:
        cur.execute("UPDATE sessions SET last_activity = now() WHERE id = %s", (session_id,))

    def sign_in(self, conn: psycopg.Connection, email: str, password: str) -> tuple[dict, str]:
        """Check credentials; return (user, session_token) or raise."""
        email_key = security.session_key_of(email) if not email else email
        with conn.cursor() as cur:
            cur.execute("SELECT locked_until FROM sign_in_failures WHERE key = %s", (email_key,))
            row = cur.fetchone()
            if row and row[0] is not None:
                until = row[0].astimezone(datetime.timezone.utc)
                remaining = max(0, int((until - datetime.datetime.now(datetime.timezone.utc)).total_seconds()))
                if remaining > 0:
                    raise sign_in_locked(remaining)
            cur.execute("SELECT id, name, email, role, password_sha256, totp_secret FROM people WHERE email = %s", (email,))
            person = cur.fetchone()
            if person:
                uid, name, pemail, role, password_sha, totp = person
                expected = security.sha256_hex(password.encode("utf-8"))
                ok = secrets.compare_digest(expected, password_sha)
            else:
                # identical password work for unknown accounts (DP-01)
                security.sha256_hex(password.encode("utf-8"))
                ok = False
            if not ok:
                self._register_failure(cur, email_key, person[0] if person else None, email)
                conn.commit()
                raise sign_in_failed()
            user = {"id": uid, "name": name, "email": pemail, "role": role}
            opened = self.open(cur, user)
            cur.execute("DELETE FROM sign_in_failures WHERE key = %s", (email_key,))
            conn.commit()
            return user, opened["token"], opened["session_id"]

    def _register_failure(self, cur, key: str, person_id: str | None, email: str) -> None:
        cur.execute(
            "INSERT INTO sign_in_failures (key, count) VALUES (%s, 1) "
            "ON CONFLICT (key) DO UPDATE SET count = sign_in_failures.count + 1",
            (key,),
        )
        cur.execute("SELECT count FROM sign_in_failures WHERE key = %s", (key,))
        count = cur.fetchone()[0]
        if count >= 5:
            until = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=self.cfg.lockout_seconds)
            cur.execute("UPDATE sign_in_failures SET locked_until = %s WHERE key = %s", (until, key))
            target = person_id or security.session_key_of(email)
            ledger.append(cur, "system", None, "signin.locked", target, {})
            cur.execute("INSERT INTO signals (kind, target) VALUES ('sign_in_lockout', %s)", (target,))

    def step_up(self, conn: psycopg.Connection, session: SessionInfo, password: str, code: str) -> str:
        with conn.cursor() as cur:
            cur.execute("SELECT locked_until FROM sign_in_failures WHERE key = %s", (session.user["email"],))
            row = cur.fetchone()
            if row and row[0] is not None:
                until = row[0].astimezone(datetime.timezone.utc)
                remaining = max(0, int((until - datetime.datetime.now(datetime.timezone.utc)).total_seconds()))
                if remaining > 0:
                    raise sign_in_locked(remaining)
            cur.execute(
                "SELECT password_sha256, totp_secret FROM people WHERE id = %s", (session.user_id,)
            )
            password_sha, totp = cur.fetchone()
            password_ok = secrets.compare_digest(security.sha256_hex(password.encode("utf-8")), password_sha)
            code_ok = security.totp_verify(totp, code)
            if not (password_ok and code_ok):
                self._register_failure(cur, session.user["email"], session.user_id, session.user["email"])
                conn.commit()
                raise step_up_failed()
            cur.execute("DELETE FROM sign_in_failures WHERE key = %s", (session.user["email"],))
            proof = security.new_token()
            cur.execute(
                "INSERT INTO step_up_proofs (digest, session_id, expires_at) VALUES (%s, %s, now() + %s * interval '1 second')",
                (security.hash_token(proof), session.id, self.cfg.step_up_ttl),
            )
            conn.commit()
            return proof

    def consume_proof(self, cur, session_id: str, proof: str | None) -> bool:
        """Consume the proof in the caller's transaction; False when unusable."""
        if not proof:
            return False
        digest = security.hash_token(proof)
        cur.execute(
            "UPDATE step_up_proofs SET spent = true "
            "WHERE digest = %s AND session_id = %s AND spent = false AND expires_at > now()",
            (digest, session_id),
        )
        return cur.rowcount == 1
