"""Compartments, grants and break-glass."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import db, ledger, mail
from .access import (
    caller_grant,
    granted_compartments,
    grant_state,
    load_compartment,
    take_compartment_lock,
)
from .config import CONFIG
from .errors import ApiError
from .http import Context, route, target_from_text
from .idempotency import replay_inside, replay_or_claim, store_response
from .rules import KIND_BREAK_GLASS, ROLE_LEAD, SCOPE_DERIVATIVES, SCOPE_FULL
from .validation import FieldChecker, REQUIRED, is_unstorable, trim
from .views import compartment_counts, format_time, grant_view


def _granted_ids(cur, user_id: str) -> list[str]:
    return [row["id"] for row in granted_compartments(cur, user_id)]


@route("/api/dashboard", ["GET"], denials=False)
def dashboard(ctx: Context):
    with db.tx() as cur:
        ids = _granted_ids(cur, ctx.user["id"])
        if not ids:
            return 200, {
                "compartments": 0,
                "exhibits": 0,
                "quarantined": 0,
                "held": 0,
                "releases_in_review": 0,
                "release_bytes": 0,
            }
        cur.execute(
            """
            SELECT
              count(*) FILTER (WHERE state <> 'disposed') AS exhibits,
              count(*) FILTER (WHERE state = 'quarantined') AS quarantined,
              count(*) FILTER (WHERE state = 'held') AS held
            FROM exhibits WHERE compartment_id = ANY(%s)
            """,
            (ids,),
        )
        counts = cur.fetchone()
        cur.execute(
            "SELECT count(*) AS n FROM releases WHERE compartment_id = ANY(%s) AND state = 'submitted'",
            (ids,),
        )
        in_review = cur.fetchone()["n"]
        cur.execute(
            """
            SELECT coalesce(sum(d.size), 0) AS total
            FROM releases r
            JOIN release_items i ON i.release_id = r.id
            JOIN derivatives d ON d.id = i.derivative_id
            WHERE r.compartment_id = ANY(%s) AND r.state <> 'withdrawn'
            """,
            (ids,),
        )
        release_bytes = int(cur.fetchone()["total"])
    return 200, {
        "compartments": len(ids),
        "exhibits": counts["exhibits"],
        "quarantined": counts["quarantined"],
        "held": counts["held"],
        "releases_in_review": in_review,
        "release_bytes": release_bytes,
    }


@route("/api/search", ["GET"], denials=False)
def search(ctx: Context):
    term = ctx.query.get("q", "")
    if is_unstorable(term) or trim(term) == "":
        return 200, {"results": []}
    pattern = "%" + term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
    with db.tx() as cur:
        ids = _granted_ids(cur, ctx.user["id"])
        if not ids:
            return 200, {"results": []}
        cur.execute(
            """
            SELECT id, compartment_id, name, state FROM exhibits
            WHERE compartment_id = ANY(%s) AND state <> 'disposed'
              AND name ILIKE %s ESCAPE '\\'
            ORDER BY id
            """,
            (ids, pattern),
        )
        results = [
            {
                "exhibit_id": row["id"],
                "compartment_id": row["compartment_id"],
                "name": row["name"],
                "state": row["state"],
            }
            for row in cur.fetchall()
        ]
    return 200, {"results": results}


@route("/api/compartments", ["GET"], denials=False)
def list_compartments(ctx: Context):
    with db.tx() as cur:
        rows = granted_compartments(cur, ctx.user["id"])
        out = []
        for row in rows:
            counts = compartment_counts(cur, row["id"])
            out.append({"id": row["id"], "name": row["name"], **counts})
    return 200, {"compartments": out}


@route("/api/compartments", ["POST"], json_body=True)
def create_compartment(ctx: Context):
    if ctx.user["role"] != ROLE_LEAD:
        raise ApiError("forbidden")
    checker = FieldChecker(ctx.body)
    name = checker.free_text("name")
    checker.done()
    now = datetime.now(timezone.utc)
    with db.tx() as cur:
        compartment_id = db.next_id(cur, "CMP")
        cur.execute(
            """
            INSERT INTO compartments (id, name, owner_id, access_version, created_at)
            VALUES (%s, %s, %s, 1, %s)
            """,
            (compartment_id, name, ctx.user["id"], now),
        )
        grant_id = db.next_id(cur, "GRT")
        cur.execute(
            """
            INSERT INTO grants
                (id, compartment_id, user_id, scope, state, expires_at, kind, created_at)
            VALUES (%s, %s, %s, 'full', 'active', NULL, 'grant', %s)
            """,
            (grant_id, compartment_id, ctx.user["id"], now),
        )
        ctx.log(cur, "compartment.created", compartment_id)
        ctx.log(
            cur,
            "grant.issued",
            grant_id,
            {"compartment_id": compartment_id, "user_id": ctx.user["id"]},
        )
        counts = compartment_counts(cur, compartment_id)
    return 201, {"id": compartment_id, "name": name, **counts}


@route("/api/compartments/{id}", ["GET"])
def read_compartment(ctx: Context):
    with db.tx() as cur:
        compartment, grant = load_compartment(cur, ctx, "read")
        counts = compartment_counts(cur, compartment["id"])
        access = None
        if ctx.user["role"] == ROLE_LEAD and grant["scope"] == SCOPE_FULL:
            cur.execute(
                "SELECT * FROM grants WHERE compartment_id = %s ORDER BY id",
                (compartment["id"],),
            )
            access = [grant_view(dict(row)) for row in cur.fetchall()]
        return 200, {
            "id": compartment["id"],
            "name": compartment["name"],
            "owner_id": compartment["owner_id"],
            "access_version": compartment["access_version"],
            "caller_scope": grant["scope"],
            **counts,
            "access": access,
        }


def _usable_version(ctx: Context, field: str) -> int | None:
    raw = ctx.body.get(field)
    if raw is None or isinstance(raw, bool) or not isinstance(raw, int):
        return None
    return raw


def _recheck_authority(cur, ctx: Context, compartment_id: str, target: str) -> dict:
    grant = caller_grant(cur, ctx.user["id"], compartment_id)
    if (
        grant is None
        or grant["kind"] == KIND_BREAK_GLASS
        or grant["scope"] != SCOPE_FULL
        or ctx.user["role"] != ROLE_LEAD
    ):
        raise ApiError("not_found", target=target)
    return grant


def _keeps_a_case_lead(cur, compartment_id: str, excluded_grant: str) -> bool:
    cur.execute(
        """
        SELECT 1 FROM grants g JOIN users u ON u.id = g.user_id
        WHERE g.compartment_id = %s AND g.id <> %s AND g.kind = 'grant'
          AND g.state = 'active' AND g.scope = 'full' AND g.expires_at IS NULL
          AND u.role = 'case_lead'
        LIMIT 1
        """,
        (compartment_id, excluded_grant),
    )
    return cur.fetchone() is not None


@route("/api/compartments/{id}/grants", ["POST"], json_body=True)
def issue_grant(ctx: Context):
    with db.tx() as cur:
        compartment, _ = load_compartment(cur, ctx, "lead_decide")
        person = None
        raw_user = ctx.body.get("user_id")
        if isinstance(raw_user, str) and trim(raw_user) != "":
            cur.execute("SELECT * FROM users WHERE id = %s", (trim(raw_user),))
            row = cur.fetchone()
            if row is None:
                raise ApiError("not_found", target=target_from_text(trim(raw_user)))
            person = dict(row)
    ctx.check_step_up()
    identifier = ctx.param("id")
    with db.tx() as cur:
        take_compartment_lock(cur, compartment["id"])
        _recheck_authority(cur, ctx, compartment["id"], identifier.target)
        cur.execute(
            "SELECT access_version FROM compartments WHERE id = %s FOR UPDATE",
            (compartment["id"],),
        )
        version = cur.fetchone()["access_version"]
        sent_version = _usable_version(ctx, "access_version")
        if sent_version is not None and sent_version != version:
            raise ApiError("stale_access_list", extra={"access_version": version})
        if person is not None and caller_grant(cur, person["id"], compartment["id"]):
            raise ApiError("grant_exists")
        checker = FieldChecker(ctx.body)
        if person is None:
            checker.fail("user_id", REQUIRED)
        scope = checker.choice("scope", (SCOPE_FULL, SCOPE_DERIVATIVES))
        expires_at, _ok = checker.grant_expires_at()
        if sent_version is None:
            checker.fail("access_version", REQUIRED)
        checker.done()
        ctx.consume_proof(cur)
        grant_id = db.next_id(cur, "GRT")
        cur.execute(
            """
            INSERT INTO grants
                (id, compartment_id, user_id, scope, state, expires_at, kind, created_at)
            VALUES (%s, %s, %s, %s, 'active', %s, 'grant', %s)
            """,
            (
                grant_id,
                compartment["id"],
                person["id"],
                scope,
                expires_at,
                datetime.now(timezone.utc),
            ),
        )
        cur.execute(
            "UPDATE compartments SET access_version = access_version + 1 WHERE id = %s",
            (compartment["id"],),
        )
        ctx.log(
            cur,
            "grant.issued",
            grant_id,
            {"compartment_id": compartment["id"], "user_id": person["id"]},
        )
        cur.execute("SELECT * FROM grants WHERE id = %s", (grant_id,))
        return 201, grant_view(dict(cur.fetchone()))


def _load_grant_for_change(cur, ctx: Context) -> dict:
    identifier = ctx.param("id")
    row = None
    if identifier.text is not None:
        cur.execute("SELECT * FROM grants WHERE id = %s", (identifier.text,))
        row = cur.fetchone()
    if row is None:
        raise ApiError("not_found", target=identifier.target)
    grant = dict(row)
    mine = caller_grant(cur, ctx.user["id"], grant["compartment_id"])
    if mine is None:
        raise ApiError("not_found", target=identifier.target)
    if (
        ctx.user["role"] != ROLE_LEAD
        or mine["scope"] != SCOPE_FULL
        or mine["kind"] == KIND_BREAK_GLASS
        or grant["kind"] == KIND_BREAK_GLASS
    ):
        raise ApiError("forbidden", target=identifier.target)
    return grant


@route("/api/grants/{id}", ["PATCH"], json_body=True)
def edit_grant(ctx: Context):
    with db.tx() as cur:
        grant = _load_grant_for_change(cur, ctx)
    ctx.check_step_up()
    identifier = ctx.param("id")
    with db.tx() as cur:
        take_compartment_lock(cur, grant["compartment_id"])
        _recheck_authority(cur, ctx, grant["compartment_id"], identifier.target)
        cur.execute(
            "SELECT access_version FROM compartments WHERE id = %s FOR UPDATE",
            (grant["compartment_id"],),
        )
        version = cur.fetchone()["access_version"]
        sent_version = _usable_version(ctx, "access_version")
        if sent_version is not None and sent_version != version:
            raise ApiError("stale_access_list", extra={"access_version": version})
        cur.execute("SELECT * FROM grants WHERE id = %s FOR UPDATE", (grant["id"],))
        grant = dict(cur.fetchone())
        if grant_state(grant) != "active":
            raise ApiError("grant_not_active")
        checker = FieldChecker(ctx.body)
        scope = checker.choice("scope", (SCOPE_FULL, SCOPE_DERIVATIVES))
        expires_at, _ok = checker.grant_expires_at()
        if sent_version is None:
            checker.fail("access_version", REQUIRED)
        checker.done()
        narrowing = scope == SCOPE_DERIVATIVES or expires_at is not None
        if narrowing and _is_last_lead_grant(cur, grant):
            raise ApiError("last_case_lead")
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE grants SET scope = %s, expires_at = %s WHERE id = %s",
            (scope, expires_at, grant["id"]),
        )
        cur.execute(
            "UPDATE compartments SET access_version = access_version + 1 WHERE id = %s",
            (grant["compartment_id"],),
        )
        ctx.log(
            cur,
            "grant.edited",
            grant["id"],
            {
                "compartment_id": grant["compartment_id"],
                "user_id": grant["user_id"],
            },
        )
        cur.execute("SELECT * FROM grants WHERE id = %s", (grant["id"],))
        return 200, grant_view(dict(cur.fetchone()))


def _is_last_lead_grant(cur, grant: dict) -> bool:
    if grant["scope"] != SCOPE_FULL or grant["expires_at"] is not None:
        return False
    cur.execute("SELECT role FROM users WHERE id = %s", (grant["user_id"],))
    if cur.fetchone()["role"] != ROLE_LEAD:
        return False
    return not _keeps_a_case_lead(cur, grant["compartment_id"], grant["id"])


@route("/api/grants/{id}/revoke", ["POST"], json_body=True)
def revoke_grant(ctx: Context):
    with db.tx() as cur:
        grant = _load_grant_for_change(cur, ctx)
    ctx.check_step_up()
    identifier = ctx.param("id")
    with db.tx() as cur:
        take_compartment_lock(cur, grant["compartment_id"])
        _recheck_authority(cur, ctx, grant["compartment_id"], identifier.target)
        cur.execute("SELECT * FROM grants WHERE id = %s FOR UPDATE", (grant["id"],))
        grant = dict(cur.fetchone())
        if grant_state(grant) != "active":
            raise ApiError("grant_not_active")
        if _is_last_lead_grant(cur, grant):
            raise ApiError("last_case_lead")
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE grants SET state = 'revoked' WHERE id = %s", (grant["id"],)
        )
        cur.execute(
            "UPDATE compartments SET access_version = access_version + 1 WHERE id = %s",
            (grant["compartment_id"],),
        )
        ctx.log(
            cur,
            "grant.revoked",
            grant["id"],
            {
                "compartment_id": grant["compartment_id"],
                "user_id": grant["user_id"],
            },
        )
        cur.execute("SELECT * FROM grants WHERE id = %s", (grant["id"],))
        return 200, grant_view(dict(cur.fetchone()))


@route("/api/compartments/{id}/break-glass", ["POST"], json_body=True)
def break_glass(ctx: Context):
    identifier = ctx.param("id")
    endpoint = "break-glass"
    replay = replay_or_claim(ctx, endpoint)
    if replay is not None:
        return replay
    with db.tx() as cur:
        compartment = None
        if identifier.text is not None:
            cur.execute("SELECT * FROM compartments WHERE id = %s", (identifier.text,))
            row = cur.fetchone()
            compartment = dict(row) if row else None
        if compartment is None:
            raise ApiError("not_found", target=identifier.target)
        mine = caller_grant(cur, ctx.user["id"], compartment["id"])
        if ctx.user["role"] != ROLE_LEAD:
            if mine is None:
                raise ApiError("not_found", target=identifier.target)
            raise ApiError("forbidden", target=identifier.target)
    ctx.check_step_up()
    with db.tx() as cur:
        replay = replay_inside(cur, ctx, endpoint)
        if replay is not None:
            return replay
        take_compartment_lock(cur, compartment["id"])
        mine = caller_grant(cur, ctx.user["id"], compartment["id"])
        if mine is not None:
            if mine["kind"] == KIND_BREAK_GLASS:
                raise ApiError("break_glass_active")
            raise ApiError("already_granted")
        checker = FieldChecker(ctx.body)
        reason = checker.reason(break_glass=True)
        checker.done()
        now = datetime.now(timezone.utc)
        ends_at = now + timedelta(seconds=CONFIG.break_glass_seconds)
        ctx.consume_proof(cur)
        grant_id = db.next_id(cur, "GRT")
        cur.execute(
            """
            INSERT INTO grants
                (id, compartment_id, user_id, scope, state, expires_at, kind, reason, created_at)
            VALUES (%s, %s, %s, 'full', 'active', %s, 'break_glass', %s, %s)
            """,
            (grant_id, compartment["id"], ctx.user["id"], ends_at, reason, now),
        )
        ledger.append(
            cur,
            action="break_glass.opened",
            actor_id=ctx.user["id"],
            session_id=ctx.session["id"],
            target=grant_id,
            detail={"compartment_id": compartment["id"], "reason": reason},
        )
        cur.execute("SELECT email FROM users WHERE id = %s", (compartment["owner_id"],))
        owner_email = cur.fetchone()["email"]
        mail.break_glass_notice(
            cur, owner_email, ctx.user["name"], reason, compartment["id"]
        )
        body = {
            "id": grant_id,
            "compartment_id": compartment["id"],
            "ends_at": format_time(ends_at),
            "state": "active",
            "notice": mail.notice_state(),
        }
        store_response(cur, ctx, endpoint, 201, body)
    return 201, body
