"""Compartments, grants, break-glass (DP-23 to DP-34, DP-67)."""
from __future__ import annotations

import datetime
import json

from .. import ledger, security
from ..db import as_utc_iso
from ..domain import storable_text, trim
from ..errors import (
    REQUIRED,
    ApiError,
    already_granted,
    break_glass_active,
    forbidden,
    grant_exists,
    grant_not_active,
    idempotency_conflict,
    illegal_transition,
    last_case_lead,
    not_found,
    over_length,
    stale_access_list,
    unauthenticated,
    validation,
)
from .base import db_ts, lapse_text
from .ctx import Ctx
from .serialisers import grant

GRANT_LOCK_KEY = 552001
NAME_MAX = 200


def _validate_name(value) -> str | None:
    if value is None or not isinstance(value, str):
        return REQUIRED
    v = trim(value)
    if not v:
        return REQUIRED
    if not storable_text(v):
        return "This field holds characters that cannot be stored."
    if len(v) > NAME_MAX:
        return over_length(NAME_MAX)
    return None


async def list_compartments(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    ids = ctx.caller_grant_compartments()
    out = []
    with ctx.conn.cursor() as cur:
        for cid in ids:
            cur.execute(
                "SELECT c.id, c.name, "
                "(SELECT count(*) FROM exhibits e WHERE e.compartment_id = c.id AND e.state NOT IN ('disposed','refused')), "
                "(SELECT count(*) FROM exhibits e WHERE e.compartment_id = c.id AND e.state = 'quarantined'), "
                "(SELECT coalesce(sum(r.total_bytes), 0) FROM releases r WHERE r.compartment_id = c.id AND r.state <> 'withdrawn') "
                "FROM compartments c WHERE c.id = %s",
                (cid,),
            )
            row = cur.fetchone()
            if row:
                out.append({
                    "id": row[0], "name": row[1], "exhibit_count": int(row[2]),
                    "quarantine_count": int(row[3]), "release_bytes": int(row[4]),
                })
    return ctx.json(200, {"compartments": out})


async def dashboard(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    ids = ctx.caller_grant_compartments()
    exhibits = quarantined = held = releases_in_review = release_bytes = 0
    with ctx.conn.cursor() as cur:
        for cid in ids:
            cur.execute(
                "SELECT "
                "(SELECT count(*) FROM exhibits e WHERE e.compartment_id = %s AND e.state NOT IN ('disposed','refused')), "
                "(SELECT count(*) FROM exhibits e WHERE e.compartment_id = %s AND e.state = 'quarantined'), "
                "(SELECT count(*) FROM exhibits e WHERE e.compartment_id = %s AND e.state = 'held'), "
                "(SELECT count(*) FROM releases r WHERE r.compartment_id = %s AND r.state = 'submitted'), "
                "(SELECT coalesce(sum(r.total_bytes), 0) FROM releases r WHERE r.compartment_id = %s AND r.state <> 'withdrawn')",
                (cid, cid, cid, cid, cid),
            )
            row = cur.fetchone()
            exhibits += int(row[0])
            quarantined += int(row[1])
            held += int(row[2])
            releases_in_review += int(row[3])
            release_bytes += int(row[4])
    return ctx.json(200, {
        "compartments": len(ids),
        "exhibits": exhibits,
        "quarantined": quarantined,
        "held": held,
        "releases_in_review": releases_in_review,
        "release_bytes": release_bytes,
    })


async def search(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    q = ctx.request.query_params.get("q", "")
    if not storable_text(q):
        return ctx.json(200, {"results": []})
    needle = q.strip().lower()
    if not needle:
        return ctx.json(200, {"results": []})
    ids = ctx.caller_grant_compartments()
    out = []
    with ctx.conn.cursor() as cur:
        for cid in ids:
            cur.execute(
                "SELECT id, name, state FROM exhibits "
                "WHERE compartment_id = %s AND lower(name) LIKE %s AND state NOT IN ('disposed','refused') "
                "ORDER BY id",
                (cid, "%" + needle + "%"),
            )
            for eid, name, state in cur.fetchall():
                out.append({"exhibit_id": eid, "compartment_id": cid, "name": name, "state": state})
    return ctx.json(200, {"results": out})


async def create_compartment(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), ctx.request.url.path)
    body = await ctx.request.json()
    err = _validate_name(body.get("name"))
    if err:
        raise validation({"name": err})
    name = trim(body["name"])
    cur = ctx.begin()
    cur.execute(
        "INSERT INTO compartments (id, name, owner_id, access_version) "
        "VALUES (%s, %s, %s, 1) RETURNING id",
        (security.new_id("CMP", ctx.app.next_seq(cur, "cmp")), name, ctx.user_id),
    )
    cid = cur.fetchone()[0]
    ledger.append(cur, ctx.user_id, ctx.session_id, "compartment.created", cid, {})
    gid = security.new_id("GRN", ctx.app.next_seq(cur, "grn"))
    cur.execute(
        "INSERT INTO grants (id, compartment_id, user_id, scope, kind, state) "
        "VALUES (%s, %s, %s, 'full', 'grant', 'active')",
        (gid, cid, ctx.user_id),
    )
    ledger.append(cur, ctx.user_id, ctx.session_id, "grant.issued", gid,
                  {"compartment_id": cid, "user_id": ctx.user_id})
    ctx.commit()
    return ctx.json(201, {"id": cid, "name": name, "owner_id": ctx.user_id,
                          "exhibit_count": 0, "quarantine_count": 0, "release_bytes": 0})


def _load_compartment(ctx: Ctx, cid: str, write: bool = False) -> tuple:
    """Fetch the compartment and check the caller's grant; None when absent."""
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, name, owner_id, access_version FROM compartments WHERE id = %s", (cid,))
        row = cur.fetchone()
    if not row:
        return None, None
    return row, ctx.active_grant(cid)


async def get_compartment(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    cid = ctx.request.scope['path_params']["id"]
    row, my_grant = _load_compartment(ctx, cid)
    if row is None or my_grant is None:
        ctx.deny_and_raise(not_found(), cid)
    access = None
    if ctx.role == "case_lead" and my_grant["kind"] == "grant" and my_grant["scope"] == "full":
        access = _all_grants(ctx, cid)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT (SELECT count(*) FROM exhibits e WHERE e.compartment_id = %s AND e.state NOT IN ('disposed','refused')), "
            "(SELECT count(*) FROM exhibits e WHERE e.compartment_id = %s AND e.state = 'quarantined'), "
            "(SELECT coalesce(sum(r.total_bytes), 0) FROM releases r WHERE r.compartment_id = %s AND r.state <> 'withdrawn')",
            (cid, cid, cid),
        )
        ec, qc, rb = cur.fetchone()
    scope = my_grant["scope"]
    if my_grant["kind"] == "break_glass":
        scope = "full"
    return ctx.json(200, {
        "id": row[0], "name": row[1], "owner_id": row[2], "access_version": row[3],
        "caller_scope": scope,
        "exhibit_count": int(ec), "quarantine_count": int(qc), "release_bytes": int(rb),
        "access": access,
    })


def _all_grants(ctx: Ctx, cid: str) -> list[dict]:
    now = datetime.datetime.now(datetime.timezone.utc)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, compartment_id, user_id, scope, kind, state, expires_at FROM grants "
            "WHERE compartment_id = %s ORDER BY id", (cid,),
        )
        rows = cur.fetchall()
    out = []
    for gid, c2, uid, scope, kind, state, expires_at in rows:
        if kind == "grant" and state == "active" and expires_at is not None \
                and expires_at.astimezone(datetime.timezone.utc) <= now:
            state = "lapsed"
        out.append({"id": gid, "compartment_id": c2, "user_id": uid, "scope": scope,
                    "state": state, "expires_at": db_ts(expires_at), "kind": kind})
    return out


def _check_case_lead_full(ctx: Ctx, cid: str, grant_info: dict) -> None:
    """Case lead with a full grant, or 404/403 per the scope rules."""
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), cid)
    if grant_info is None:
        ctx.deny_and_raise(not_found(), cid)
    if grant_info["scope"] != "full":
        ctx.deny_and_raise(forbidden(), cid)
    if grant_info["kind"] == "break_glass":
        ctx.deny_and_raise(forbidden(), cid)


def _validate_grant_body(ctx: Ctx, body: dict, require_user: bool) -> tuple:
    errors = {}
    user_id = body.get("user_id") if require_user else None
    scope = body.get("scope")
    expires_at = body.get("expires_at")
    if require_user:
        if not isinstance(user_id, str) or not trim(user_id):
            errors["user_id"] = REQUIRED
    if scope not in ("full", "derivatives"):
        errors["scope"] = REQUIRED
    if expires_at is not None:
        if not isinstance(expires_at, str) or not expires_at.strip():
            errors["expires_at"] = REQUIRED
        else:
            from ..db import parse_time
            parsed = parse_time(expires_at)
            if parsed == "invalid":
                errors["expires_at"] = "Choose a time in the future."
    if errors:
        raise validation(errors)
    return user_id, scope, expires_at


async def issue_grant(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    cid = ctx.request.scope['path_params']["id"]
    row, my_grant = _load_compartment(ctx, cid)
    if row is None:
        ctx.deny_and_raise(not_found(), cid)
    _check_case_lead_full(ctx, cid, my_grant)
    body = await ctx.request.json()
    user_id, scope, expires_at = _validate_grant_body(ctx, body, require_user=True)
    access_version = body.get("access_version")
    if not isinstance(access_version, int) or isinstance(access_version, bool):
        raise validation({"access_version": REQUIRED})
    expires_dt = None
    if expires_at is not None:
        from ..db import parse_time
        expires_dt = parse_time(expires_at)
        if expires_dt is None or expires_dt == "invalid":
            raise validation({"expires_at": "Choose a time in the future."})
        if expires_dt <= datetime.datetime.now(datetime.timezone.utc):
            raise validation({"expires_at": "Choose a time in the future."})
    cur = ctx.begin()
    _consume_proof_or_raise(ctx, cur)
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (GRANT_LOCK_KEY ^ hash(cid) & 0x7FFFFFFF,))
    cur.execute("SELECT access_version FROM compartments WHERE id = %s", (cid,))
    current_version = cur.fetchone()[0]
    if access_version != current_version:
        ctx.rollback()
        raise stale_access_list(current_version)
    # own authority re-checked after the lock (DP-25)
    cur.execute(
        "SELECT scope, kind FROM grants WHERE user_id = %s AND compartment_id = %s AND state = 'active'",
        (ctx.user_id, cid),
    )
    mine = cur.fetchone()
    if not mine or mine[0] != "full" or mine[1] == "break_glass":
        ctx.rollback()
        ctx.deny_and_raise(not_found(), cid)
    cur.execute("SELECT id FROM people WHERE id = %s", (user_id,))
    if not cur.fetchone():
        ctx.deny_and_raise(not_found(), user_id)
    cur.execute(
        "SELECT 1 FROM grants WHERE user_id = %s AND compartment_id = %s AND state = 'active'",
        (user_id, cid),
    )
    if cur.fetchone():
        ctx.rollback()
        raise grant_exists()
    gid = security.new_id("GRN", ctx.app.next_seq(cur, "grn"))
    cur.execute(
        "INSERT INTO grants (id, compartment_id, user_id, scope, kind, state, expires_at) "
        "VALUES (%s, %s, %s, %s, 'grant', 'active', %s)",
        (gid, cid, user_id, scope, expires_dt),
    )
    cur.execute("UPDATE compartments SET access_version = access_version + 1 WHERE id = %s", (cid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "grant.issued", gid,
                  {"compartment_id": cid, "user_id": user_id})
    ctx.commit()
    return ctx.json(201, {"id": gid, "compartment_id": cid, "user_id": user_id,
                          "scope": scope, "state": "active", "expires_at": db_ts(expires_dt),
                          "kind": "grant"})


def _consume_proof_or_raise(ctx: Ctx, cur) -> None:
    proof = ctx.request.headers.get("x-step-up-proof")
    if not proof or not ctx.app.sessions.consume_proof(cur, ctx.session_id, proof):
        ctx.deny_and_raise(
            ApiError(403, {"error": "step_up_required"}), ctx.request.url.path
        )


async def edit_grant(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    gid = ctx.request.scope['path_params']["id"]
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, compartment_id, user_id, scope, kind, state FROM grants WHERE id = %s", (gid,))
        row = cur.fetchone()
    if not row:
        ctx.deny_and_raise(not_found(), gid)
    g_id, cid, uid, scope, kind, state = row
    if kind == "break_glass":
        ctx.deny_and_raise(forbidden(), gid)
    _check_case_lead_full(ctx, cid, ctx.active_grant(cid))
    body = await ctx.request.json()
    new_scope = body.get("scope")
    expires_at = body.get("expires_at")
    access_version = body.get("access_version")
    errors = {}
    if new_scope not in ("full", "derivatives"):
        errors["scope"] = REQUIRED
    if expires_at is not None:
        if not isinstance(expires_at, str) or not expires_at.strip():
            errors["expires_at"] = REQUIRED
    if not isinstance(access_version, int) or isinstance(access_version, bool):
        errors["access_version"] = REQUIRED
    if errors:
        raise validation(errors)
    expires_dt = None
    if expires_at:
        from ..db import parse_time
        expires_dt = parse_time(expires_at)
        if expires_dt in (None, "invalid"):
            raise validation({"expires_at": "Choose a time in the future."})
        if expires_dt <= datetime.datetime.now(datetime.timezone.utc):
            raise validation({"expires_at": "Choose a time in the future."})
    cur = ctx.begin()
    _consume_proof_or_raise(ctx, cur)
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (GRANT_LOCK_KEY ^ hash(cid) & 0x7FFFFFFF,))
    cur.execute("SELECT access_version FROM compartments WHERE id = %s", (cid,))
    current_version = cur.fetchone()[0]
    if access_version != current_version:
        ctx.rollback()
        raise stale_access_list(current_version)
    cur.execute("SELECT scope, state, kind FROM grants WHERE id = %s", (gid,))
    g = cur.fetchone()
    if not g or g[1] != "active" or g[2] == "break_glass":
        ctx.rollback()
        raise grant_not_active()
    cur.execute(
        "SELECT scope, kind FROM grants WHERE user_id = %s AND compartment_id = %s AND state = 'active'",
        (ctx.user_id, cid),
    )
    mine = cur.fetchone()
    if not mine or mine[0] != "full" or mine[1] == "break_glass":
        ctx.rollback()
        ctx.deny_and_raise(not_found(), cid)
    with ctx.conn.cursor() as c2:
        c2.execute("SELECT role FROM people WHERE id = %s", (uid,))
        target_role = c2.fetchone()[0]
    if target_role == "case_lead":
        has_other = ctx.app.access_helper.other_lead_keeps_full(cur, cid, gid)
        if new_scope != "full" or expires_dt is not None:
            if not has_other:
                ctx.rollback()
                raise last_case_lead()
    cur.execute(
        "UPDATE grants SET scope = %s, expires_at = %s WHERE id = %s",
        (new_scope, expires_dt, gid),
    )
    cur.execute("UPDATE compartments SET access_version = access_version + 1 WHERE id = %s", (cid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "grant.edited", gid,
                  {"compartment_id": cid, "user_id": uid})
    ctx.commit()
    return ctx.json(200, {"id": gid, "compartment_id": cid, "user_id": uid,
                          "scope": new_scope, "state": "active",
                          "expires_at": db_ts(expires_dt), "kind": "grant"})


async def revoke_grant(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    gid = ctx.request.scope['path_params']["id"]
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, compartment_id, user_id, scope, kind, state FROM grants WHERE id = %s", (gid,))
        row = cur.fetchone()
    if not row:
        ctx.deny_and_raise(not_found(), gid)
    g_id, cid, uid, scope, kind, state = row
    if kind == "break_glass":
        ctx.deny_and_raise(forbidden(), gid)
    _check_case_lead_full(ctx, cid, ctx.active_grant(cid))
    cur = ctx.begin()
    _consume_proof_or_raise(ctx, cur)
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (GRANT_LOCK_KEY ^ hash(cid) & 0x7FFFFFFF,))
    cur.execute("SELECT scope, state, kind FROM grants WHERE id = %s", (gid,))
    g = cur.fetchone()
    if not g or g[1] != "active" or g[2] == "break_glass":
        ctx.rollback()
        raise grant_not_active()
    cur.execute(
        "SELECT scope, kind FROM grants WHERE user_id = %s AND compartment_id = %s AND state = 'active'",
        (ctx.user_id, cid),
    )
    mine = cur.fetchone()
    if not mine or mine[0] != "full" or mine[1] == "break_glass":
        ctx.rollback()
        ctx.deny_and_raise(not_found(), cid)
    with ctx.conn.cursor() as c2:
        c2.execute("SELECT role FROM people WHERE id = %s", (uid,))
        target_role = c2.fetchone()[0]
    if target_role == "case_lead" and scope == "full":
        if not ctx.app.access_helper.other_lead_keeps_full(cur, cid, gid):
            ctx.rollback()
            raise last_case_lead()
    cur.execute("UPDATE grants SET state = 'revoked', ended_reason = 'revoked' WHERE id = %s", (gid,))
    cur.execute("UPDATE compartments SET access_version = access_version + 1 WHERE id = %s", (cid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "grant.revoked", gid,
                  {"compartment_id": cid, "user_id": uid})
    ctx.commit()
    return ctx.json(200, {"id": gid, "compartment_id": cid, "user_id": uid,
                          "scope": scope, "state": "revoked",
                          "expires_at": None, "kind": "grant"})


async def open_break_glass(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    cid = ctx.request.scope['path_params']["id"]
    if ctx.role != "case_lead":
        if ctx.role in ("intake_officer", "investigator"):
            with ctx.conn.cursor() as cur:
                cur.execute("SELECT 1 FROM compartments WHERE id = %s", (cid,))
                if cur.fetchone():
                    ctx.deny_and_raise(forbidden(), cid)
        ctx.deny_and_raise(not_found(), cid)
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT id, name, owner_id FROM compartments WHERE id = %s", (cid,))
        comp = cur.fetchone()
    if not comp:
        ctx.deny_and_raise(not_found(), cid)
    body = await ctx.request.json()
    reason = body.get("reason")
    if not isinstance(reason, str) or not trim(reason):
        raise validation({"reason": "Write a reason of at least 20 characters."})
    reason = trim(reason)
    if not storable_text(reason):
        raise validation({"reason": "This field holds characters that cannot be stored."})
    if len(reason) > 2000:
        raise validation({"reason": over_length(2000)})
    if len(reason) < 20:
        raise validation({"reason": "Write a reason of at least 20 characters."})
    idem_key = ctx.request.headers.get("idempotency-key")
    if idem_key is not None:
        if not (1 <= len(trim(idem_key)) <= 128):
            raise validation({"idempotency_key": "This key cannot be used."})
    # already granted?
    if ctx.active_grant(cid) is not None:
        raise already_granted()
    cur = ctx.begin()
    _consume_proof_or_raise(ctx, cur)
    if idem_key:
        stored = ctx.app.idempotent_replay(cur, ctx.user_id, "break-glass", idem_key,
                                           security.sha256_hex((cid + "|" + reason).encode("utf-8")))
        if stored == "conflict":
            ctx.rollback()
            raise idempotency_conflict()
        if stored and stored != "conflict":
            ctx.commit()
            resp = ctx.json(stored["status"], json.loads(stored["body"]))
            resp.headers["Idempotent-Replay"] = "true"
            return resp
    else:
        bg_fingerprint = None
    cur.execute(
        "SELECT 1 FROM grants WHERE user_id = %s AND compartment_id = %s AND kind = 'break_glass' AND state = 'active'",
        (ctx.user_id, cid),
    )
    if cur.fetchone():
        ctx.rollback()
        raise break_glass_active()
    ends_at = datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(seconds=ctx.cfg.break_glass_seconds)
    bgid = security.new_id("BGR", ctx.app.next_seq(cur, "bgr"))
    cur.execute(
        "INSERT INTO grants (id, compartment_id, user_id, scope, kind, state, expires_at, ended_reason) "
        "VALUES (%s, %s, %s, 'full', 'break_glass', 'active', %s, NULL)",
        (bgid, cid, ctx.user_id, ends_at),
    )
    ledger.append(cur, ctx.user_id, ctx.session_id, "break_glass.opened", bgid, {})
    owner_id = comp[2]
    cur.execute("SELECT email FROM people WHERE id = %s", (owner_id,))
    owner_email = cur.fetchone()[0]
    ctx.app.mailer.queue(cur, owner_email, f"Break-glass access opened on {cid}",
                         _break_glass_mail_name(ctx, comp, reason))
    if idem_key:
        status, body = 201, {"id": bgid, "compartment_id": cid,
                             "ends_at": db_ts(ends_at), "state": "active",
                             "notice": "held" if not ctx.mail_up() else "queued"}
        ctx.app.idempotent_store(cur, ctx.user_id, "break-glass", idem_key, status, body,
                                 security.sha256_hex((cid + "|" + reason).encode("utf-8")))
    ctx.commit()
    return ctx.json(201, {"id": bgid, "compartment_id": cid,
                          "ends_at": db_ts(ends_at), "state": "active",
                          "notice": "held" if not ctx.mail_up() else "queued"})


def _break_glass_mail_name(ctx: Ctx, comp, reason: str) -> str:
    flat = reason.replace("\r\n", "\n")
    out = []
    prev_break = False
    for ch in flat:
        if ch in "\n\x85\u2028\u2029":
            if not prev_break:
                out.append(" ")
            prev_break = True
        else:
            out.append(ch)
            prev_break = False
    reason_flat = "".join(out)
    return (
        f"Break-glass access opened.\n"
        f"Actor: {ctx.user['name']}\n"
        f"Reason: {reason_flat}\n"
        f"Compartment: {comp[0]}\n"
    )
