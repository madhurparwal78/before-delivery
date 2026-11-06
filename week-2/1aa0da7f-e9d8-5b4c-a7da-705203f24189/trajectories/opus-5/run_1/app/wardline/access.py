"""Grant lookup and the one place each access refusal is decided."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Any

from . import db
from .errors import ApiError
from .http import Context
from .rules import (
    KIND_BREAK_GLASS,
    KIND_GRANT,
    NEEDS,
    ROLE_AUDITOR,
    SCOPE_FULL,
    Need,
)

GRANT_SELECT = """
    SELECT * FROM grants
    WHERE compartment_id = %s AND user_id = %s AND state = 'active'
      AND (expires_at IS NULL OR expires_at > now())
    ORDER BY CASE WHEN kind = 'grant' THEN 0 ELSE 1 END
"""


def grant_state(row: dict) -> str:
    if row["state"] != "active":
        return row["state"]
    if row["expires_at"] is not None and row["expires_at"] <= datetime.now(
        timezone.utc
    ):
        return "lapsed" if row["kind"] == KIND_GRANT else "ended"
    return "active"


def caller_grant(cur: Any, user_id: str, compartment_id: str) -> dict | None:
    cur.execute(GRANT_SELECT, (compartment_id, user_id))
    row = cur.fetchone()
    return dict(row) if row else None


def granted_compartments(cur: Any, user_id: str) -> list[dict]:
    cur.execute(
        """
        SELECT c.*, g.scope AS caller_scope, g.kind AS caller_kind
        FROM compartments c
        JOIN grants g ON g.compartment_id = c.id
        WHERE g.user_id = %s AND g.state = 'active'
          AND (g.expires_at IS NULL OR g.expires_at > now())
        ORDER BY c.id
        """,
        (user_id,),
    )
    seen: dict[str, dict] = {}
    for row in cur.fetchall():
        current = seen.get(row["id"])
        if current is None or (
            current["caller_kind"] == KIND_BREAK_GLASS
            and row["caller_kind"] == KIND_GRANT
        ):
            seen[row["id"]] = dict(row)
    return [seen[key] for key in sorted(seen)]


def enforce(ctx: Context, need: Need, grant: dict, target: str) -> None:
    user = ctx.user
    if need.full_scope and grant["scope"] != SCOPE_FULL:
        if need.hidden:
            raise ApiError("not_found", target=target)
    if user["role"] not in need.roles:
        raise ApiError("forbidden", target=target)
    if need.full_scope and grant["scope"] != SCOPE_FULL:
        raise ApiError("forbidden", target=target)
    if not need.break_glass_ok and grant["kind"] == KIND_BREAK_GLASS:
        raise ApiError("forbidden", target=target)


def attach(ctx: Context, grant: dict) -> dict:
    ctx.break_glass_grant = grant if grant["kind"] == KIND_BREAK_GLASS else None
    return grant


def load_compartment(
    cur: Any, ctx: Context, need_name: str, param: str = "id"
) -> tuple[dict, dict]:
    identifier = ctx.param(param)
    compartment = None
    if identifier.text is not None:
        cur.execute("SELECT * FROM compartments WHERE id = %s", (identifier.text,))
        row = cur.fetchone()
        compartment = dict(row) if row else None
    if compartment is None:
        raise ApiError("not_found", target=identifier.target)
    grant = caller_grant(cur, ctx.user["id"], compartment["id"])
    if grant is None:
        raise ApiError("not_found", target=identifier.target)
    attach(ctx, grant)
    enforce(ctx, NEEDS[need_name], grant, identifier.target)
    return compartment, grant


def load_exhibit(
    cur: Any, ctx: Context, need_name: str, param: str = "id", lock: bool = False
) -> tuple[dict, dict]:
    identifier = ctx.param(param)
    exhibit = None
    if identifier.text is not None:
        cur.execute(
            "SELECT * FROM exhibits WHERE id = %s" + (" FOR UPDATE" if lock else ""),
            (identifier.text,),
        )
        row = cur.fetchone()
        exhibit = dict(row) if row else None
    if exhibit is None:
        raise ApiError("not_found", target=identifier.target)
    grant = caller_grant(cur, ctx.user["id"], exhibit["compartment_id"])
    if grant is None:
        raise ApiError("not_found", target=identifier.target)
    attach(ctx, grant)
    enforce(ctx, NEEDS[need_name], grant, identifier.target)
    return exhibit, grant


def load_derivative(
    cur: Any, ctx: Context, need_name: str, param: str = "id"
) -> tuple[dict, dict, dict]:
    identifier = ctx.param(param)
    derivative = None
    if identifier.text is not None:
        cur.execute("SELECT * FROM derivatives WHERE id = %s", (identifier.text,))
        row = cur.fetchone()
        derivative = dict(row) if row else None
    if derivative is None:
        raise ApiError("not_found", target=identifier.target)
    grant = caller_grant(cur, ctx.user["id"], derivative["compartment_id"])
    if grant is None:
        raise ApiError("not_found", target=identifier.target)
    attach(ctx, grant)
    enforce(ctx, NEEDS[need_name], grant, identifier.target)
    cur.execute("SELECT * FROM exhibits WHERE id = %s", (derivative["exhibit_id"],))
    exhibit = dict(cur.fetchone())
    return derivative, exhibit, grant


def load_release(
    cur: Any, ctx: Context, need_name: str, param: str = "id", lock: bool = False
) -> tuple[dict, dict]:
    identifier = ctx.param(param)
    release = None
    if identifier.text is not None:
        cur.execute(
            "SELECT * FROM releases WHERE id = %s" + (" FOR UPDATE" if lock else ""),
            (identifier.text,),
        )
        row = cur.fetchone()
        release = dict(row) if row else None
    if release is None:
        raise ApiError("not_found", target=identifier.target)
    grant = caller_grant(cur, ctx.user["id"], release["compartment_id"])
    if grant is None:
        raise ApiError("not_found", target=identifier.target)
    attach(ctx, grant)
    enforce(ctx, NEEDS[need_name], grant, identifier.target)
    return release, grant


def load_custody_reader(cur: Any, ctx: Context, exhibit_param: str = "id") -> dict:
    """Custody history: the auditor needs no grant, a case lead needs a full one."""
    identifier = ctx.param(exhibit_param)
    exhibit = None
    if identifier.text is not None:
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (identifier.text,))
        row = cur.fetchone()
        exhibit = dict(row) if row else None
    if exhibit is None:
        raise ApiError("not_found", target=identifier.target)
    if ctx.user["role"] == ROLE_AUDITOR:
        return exhibit
    grant = caller_grant(cur, ctx.user["id"], exhibit["compartment_id"])
    if grant is None:
        raise ApiError("not_found", target=identifier.target)
    attach(ctx, grant)
    enforce(ctx, NEEDS["custody"], grant, identifier.target)
    return exhibit


def take_compartment_lock(cur: Any, compartment_id: str) -> None:
    db.take_lock(cur, db.LOCK_COMPARTMENT, compartment_id)


def take_exhibit_lock(cur: Any, exhibit_id: str) -> None:
    db.take_lock(cur, db.LOCK_EXHIBIT, exhibit_id)


def take_release_lock(cur: Any, release_id: str) -> None:
    db.take_lock(cur, db.LOCK_RELEASE, release_id)
