"""Access rules: grants, break-glass, and the one place each is decided (DP-23..DP-34)."""
from __future__ import annotations

import datetime
from typing import Any

import psycopg

from . import ledger, security
from .auth import SessionInfo
from .errors import ApiError, not_found


class Access:
    """All grant and break-glass decisions live here."""

    def __init__(self, conn: psycopg.Connection, cfg):
        self.conn = conn
        self.cfg = cfg

    def active_grant(self, user_id: str, compartment_id: str) -> dict | None:
        """The caller's live grant, lapsed rows marked as they expire."""
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, scope, kind, state, expires_at, ended_reason FROM grants "
                "WHERE user_id = %s AND compartment_id = %s "
                "AND state = 'active' ORDER BY kind DESC, id",
                (user_id, compartment_id),
            )
            rows = cur.fetchall()
        now = datetime.datetime.now(datetime.timezone.utc)
        for gid, scope, kind, state, expires_at, ended in rows:
            if kind == "grant" and expires_at is not None:
                exp = expires_at.astimezone(datetime.timezone.utc)
                if exp <= now:
                    continue
            return {"id": gid, "scope": scope, "kind": kind, "expires_at": expires_at}
        return None

    def any_active_grant(self, user_id: str, compartment_id: str) -> dict | None:
        return self.active_grant(user_id, compartment_id)

    def caller_grants(self, user_id: str) -> list[dict]:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT g.id, g.compartment_id, g.scope, g.kind, g.expires_at, c.name "
                "FROM grants g JOIN compartments c ON c.id = g.compartment_id "
                "WHERE g.user_id = %s AND g.state = 'active' ORDER BY c.name",
                (user_id,),
            )
            rows = cur.fetchall()
        now = datetime.datetime.now(datetime.timezone.utc)
        out = []
        for gid, cid, scope, kind, expires_at, name in rows:
            if expires_at is not None:
                exp = expires_at.astimezone(datetime.timezone.utc)
                if exp <= now:
                    continue
            out.append({"id": gid, "compartment_id": cid, "scope": scope, "kind": kind,
                        "expires_at": expires_at, "compartment_name": name})
        return out

    def compartment_visible(self, user_id: str, compartment_id: str) -> bool:
        return self.active_grant(user_id, compartment_id) is not None

    def grant_by_id(self, grant_id: str) -> dict | None:
        with self.conn.cursor() as cur:
            cur.execute(
                "SELECT id, compartment_id, user_id, scope, kind, state, expires_at FROM grants WHERE id = %s",
                (grant_id,),
            )
            row = cur.fetchone()
        if not row:
            return None
        return {"id": row[0], "compartment_id": row[1], "user_id": row[2], "scope": row[3],
                "kind": row[4], "state": row[5], "expires_at": row[6]}

    def check_last_case_lead(self, cur, compartment_id: str, excluding_grant_id: str,
                              new_scope: str | None, new_expires_at) -> bool:
        """True when changing this grant still leaves a case lead with an
        active, full, non-lapsing grant of kind grant (DP-25)."""
        narrowing = (new_scope is not None and new_scope != "full") or (new_expires_at is not None)
        if not narrowing:
            return True
        return self.other_lead_keeps_full(cur, compartment_id, excluding_grant_id)

    def other_lead_keeps_full(self, cur, compartment_id: str, excluding_grant_id: str) -> bool:
        cur.execute(
            "SELECT count(*) FROM grants g JOIN people p ON p.id = g.user_id "
            "WHERE g.compartment_id = %s AND g.id <> %s AND g.kind = 'grant' "
            "AND g.state = 'active' AND g.scope = 'full' AND g.expires_at IS NULL "
            "AND p.role = 'case_lead'",
            (compartment_id, excluding_grant_id),
        )
        return cur.fetchone()[0] > 0
