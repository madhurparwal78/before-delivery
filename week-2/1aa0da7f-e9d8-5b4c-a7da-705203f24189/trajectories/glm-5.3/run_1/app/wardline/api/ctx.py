"""Request context: one place for authentication, grants, denials and serialising."""
from __future__ import annotations

import datetime
from typing import Any

import psycopg

from .. import ledger, security
from ..auth import SessionInfo, Sessions
from ..config import Config
from ..db import Database
from ..errors import ApiError, not_found
from .base import JSON_BODY_LIMIT, db_ts, read_json

DENIAL_CODES = {
    "not_found", "forbidden", "separation_of_duties", "step_up_required", "unauthenticated"
}


class Ctx:
    """Everything one request needs, with its own transaction helpers."""

    def __init__(self, app, request, conn: psycopg.Connection):
        self.app = app
        self.cfg: Config = app.cfg
        self.db: Database = app.db
        self.request = request
        self.conn = conn
        self.session: SessionInfo | None = None
        self.background = request.headers.get("x-wardline-background") == "1"

    @property
    def user(self) -> dict:
        return self.session.user if self.session else {}

    @property
    def user_id(self) -> str | None:
        return self.session.user_id if self.session else None

    @property
    def role(self) -> str | None:
        return self.session.role if self.session else None

    @property
    def session_id(self) -> str | None:
        return self.session.id if self.session else None

    def touch(self) -> None:
        if self.session and not self.background:
            with self.conn.cursor() as cur:
                cur.execute("UPDATE sessions SET last_activity = now() WHERE id = %s", (self.session.id,))
            self.conn.commit()

    def json(self, status: int, body: dict | list, headers: dict[str, str] | None = None) -> "APIResponse":
        return APIResponse(status, body, headers)

    # ---- transactions ------------------------------------------------
    def begin(self) -> psycopg.Cursor:
        return self.conn.cursor()

    def commit(self) -> None:
        self.conn.commit()

    def rollback(self) -> None:
        try:
            self.conn.rollback()
        except psycopg.Error:
            pass

    # ---- grants ------------------------------------------------------
    def active_grant(self, compartment_id: str) -> dict | None:
        if not self.session:
            return None
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, scope, kind, state, expires_at FROM grants "
                "WHERE user_id = %s AND compartment_id = %s AND state = 'active' "
                "ORDER BY kind DESC, id",
                (self.user_id, compartment_id),
            )
            rows = cur.fetchall()
        now = datetime.datetime.now(datetime.timezone.utc)
        for gid, scope, kind, state, expires_at in rows:
            if kind == "grant" and expires_at is not None:
                if expires_at.astimezone(datetime.timezone.utc) <= now:
                    continue
            return {"id": gid, "scope": scope, "kind": kind, "expires_at": expires_at}
        return None

    def grant_scope(self, compartment_id: str) -> str | None:
        grant = self.active_grant(compartment_id)
        return grant["scope"] if grant else None

    def break_glass_grant(self, compartment_id: str) -> dict | None:
        grant = self.active_grant(compartment_id)
        if grant and grant["kind"] == "break_glass":
            return grant
        return None

    def caller_grant_compartments(self) -> list[str]:
        if not self.session:
            return []
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT DISTINCT compartment_id FROM grants "
                "WHERE user_id = %s AND state = 'active'", (self.user_id,)
            )
            ids = [r[0] for r in cur.fetchall()]
        out = [cid for cid in ids if self.active_grant(cid)]
        return out

    # ---- denial writing ----------------------------------------------
    def deny(self, cur, code: str, target: str) -> None:
        """Write the access.denied entry inside the caller's transaction."""
        ledger.append(
            cur,
            self.user_id or "system",
            self.session_id,
            "access.denied",
            target,
            {
                "method": self.request.method,
                "path": (self.request.url.path or "")[:1000],
                "code": code,
            },
        )

    def deny_and_raise(self, error: ApiError, target: str) -> ApiError:
        """Refuse and record the denial in the same transaction, then raise."""
        self.rollback()
        cur = self.begin()
        try:
            self.deny(cur, error.body["error"], target)
            self.commit()
        except psycopg.Error:
            self.rollback()
        raise error

    # ---- helpers -----------------------------------------------------
    def storage_up(self) -> bool:
        return self.app.storage_status["storage"] == "up"

    def mail_up(self) -> bool:
        return self.app.storage_status["mail"] == "up"

    def json(self, status: int, body: Any, headers: dict[str, str] | None = None) -> "APIResponse":
        from .shims import APIResponse

        return APIResponse(status, body, headers)

    def file_response(self, data: bytes, content_type: str, filename: str):
        from .shims import FileBytesResponse

        return FileBytesResponse(data, content_type, filename)

    def stream_response(self, key: str, size: int, content_type: str, filename: str):
        from .shims import StorageStreamResponse

        return StorageStreamResponse(self.app, key, size, content_type, filename)


class APIResponse:
    def __init__(self, status: int, body: Any, headers: dict[str, str] | None = None):
        self.status = status
        self.body = body
        self.headers = headers or {}

    def to_response(self) -> JSONResponse:
        headers = dict(self.headers)
        headers["X-Content-Type-Options"] = "nosniff"
        if self.status == 204:
            return Response(status_code=204, headers=headers)
        if "set_cookie" in headers:
            cookie = headers.pop("set_cookie")
            resp = JSONResponse(self.body, status_code=self.status, headers=headers)
            resp.headers["Set-Cookie"] = (
                cookie if "Path=" in cookie else f"{cookie}; Path=/"
            )
            return resp
        return JSONResponse(self.body, status_code=self.status, headers=headers)
