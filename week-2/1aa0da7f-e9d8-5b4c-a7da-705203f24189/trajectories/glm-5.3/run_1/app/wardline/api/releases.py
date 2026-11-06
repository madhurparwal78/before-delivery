"""Releases, review queue, sharing and links (DP-49 to DP-66)."""
from __future__ import annotations

import datetime

from .. import ledger, security
from ..domain import storable_text, trim
from ..errors import (
    REQUIRED,
    ApiError,
    derivative_missing,
    derivative_superseded,
    exhibit_not_cleared,
    forbidden,
    illegal_transition,
    items_unopened,
    last_case_lead,
    not_found,
    not_found as nf,
    over_length,
    release_changed,
    release_empty,
    release_locked,
    separation_of_duties,
    storage_unavailable,
    throttled,
    unauthenticated,
    validation,
)
from .base import db_ts
from .ctx import Ctx
from .serialisers import release

RELEASE_LOCK_KEY = 883033


def _load_release(ctx: Ctx, rid: str, need_grant: bool = True) -> tuple | None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, compartment_id, name, matter_ref, recipient_kind, state, assembler_id, "
            "rejection_reason, manifest_digest FROM releases WHERE id = %s", (rid,),
        )
        row = cur.fetchone()
    if row is None:
        return None
    if need_grant and ctx.active_grant(row[1]) is None:
        return None
    return row


def _load_items(ctx: Ctx, rid: str) -> list[dict]:
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT ri.id, ri.derivative_id, ri.label, d.size, "
            "(d.marks_version < e.marks_version) "
            "FROM release_items ri JOIN derivatives d ON d.id = ri.derivative_id "
            "JOIN exhibits e ON e.id = d.exhibit_id WHERE ri.release_id = %s ORDER BY ri.id",
            (rid,),
        )
        rows = cur.fetchall()
    return [
        {"id": r[0], "derivative_id": r[1], "label": r[2], "size": r[3], "superseded": r[4]}
        for r in rows
    ]


def _contributors(ctx: Ctx, rid: str) -> list[str]:
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT user_id FROM release_contributors WHERE release_id = %s ORDER BY user_id", (rid,))
        return [r[0] for r in cur.fetchall()]


async def list_reviews(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), ctx.request.url.path)
    out = []
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT DISTINCT compartment_id FROM grants WHERE user_id = %s AND state = 'active' "
            "AND kind = 'grant' AND scope = 'full'", (ctx.user_id,),
        )
        cids = [r[0] for r in cur.fetchall()]
        for cid in cids:
            cur.execute(
                "SELECT id, compartment_id, name, matter_ref, recipient_kind, state, assembler_id, "
                "rejection_reason, manifest_digest FROM releases "
                "WHERE compartment_id = %s AND state = 'submitted' ORDER BY id", (cid,),
            )
            for row in cur.fetchall():
                items = _load_items(ctx, row[0])
                out.append(_release_out(ctx, row, items))
    out.sort(key=lambda r: r["id"])
    return ctx.json(200, {"releases": out})


def _release_out(ctx: Ctx, row, items, opened: dict | None = None) -> dict:
    rid, cid, name, matter, kind, state, assembler, rejection, manifest = row[:9]
    total = sum(i["size"] for i in items)
    return {
        "id": rid, "compartment_id": cid, "name": name, "matter_ref": matter,
        "recipient_kind": kind, "state": state, "assembler_id": assembler,
        "contributor_ids": _contributors(ctx, rid),
        "manifest_digest": manifest,
        "items": [dict(i, opened_by_caller=(opened or {}).get(i["id"], False)) for i in items],
        "total_bytes": total, "rejection_reason": rejection,
    }


async def create_release(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    cid = ctx.request.scope['path_params']["id"]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), cid)
    if ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(forbidden(), cid)
    body = await ctx.request.json()
    name = body.get("name")
    matter = body.get("matter_ref")
    kind = body.get("recipient_kind")
    errors = {}
    for field, value, maximum in (("name", name, 200), ("matter_ref", matter, 200)):
        if not isinstance(value, str) or not trim(value):
            errors[field] = REQUIRED
        elif not storable_text(trim(value)):
            errors[field] = "This field holds characters that cannot be stored."
        elif len(trim(value)) > maximum:
            errors[field] = over_length(maximum)
    if kind not in ("counsel", "requester"):
        errors["recipient_kind"] = REQUIRED
    if errors:
        raise validation(errors)
    cur = ctx.begin()
    rid = security.new_id("REL", ctx.app.next_seq(cur, "rel"))
    cur.execute(
        "INSERT INTO releases (id, compartment_id, name, matter_ref, recipient_kind, state, assembler_id, manifest_digest) "
        "VALUES (%s, %s, %s, %s, %s, 'assembling', %s, %s)",
        (rid, cid, trim(name), trim(matter), kind, ctx.user_id,
         __import__("hashlib").sha256(b"[]").hexdigest()),
    )
    ledger.append(cur, ctx.user_id, ctx.session_id, "release.created", rid, {})
    ctx.commit()
    return ctx.json(201, _release_out(ctx, _load_release(ctx, rid), []))


async def list_releases(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    cid = ctx.request.scope['path_params']["id"]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), cid)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, compartment_id, name, matter_ref, recipient_kind, state, assembler_id, "
            "rejection_reason, manifest_digest FROM releases WHERE compartment_id = %s ORDER BY id", (cid,),
        )
        rows = cur.fetchall()
    return ctx.json(200, {"releases": [_release_out(ctx, r, _load_items(ctx, r[0])) for r in rows]})


async def get_release(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    opened = {}
    grant = ctx.active_grant(row[1])
    if ctx.role == "case_lead" and grant and grant["kind"] == "grant" and grant["scope"] == "full":
        opened = _opened_by_caller(ctx, rid)
    return ctx.json(200, _release_out(ctx, row, _load_items(ctx, rid), opened))


def _opened_by_caller(ctx: Ctx, rid: str) -> dict:
    items = _load_items(ctx, rid)
    out = {}
    with ctx.conn.cursor() as cur:
        for item in items:
            cur.execute(
                "SELECT 1 FROM download_claims WHERE user_id = %s AND derivative_id = %s",
                (ctx.user_id, item["derivative_id"]),
            )
            out[item["id"]] = cur.fetchone() is not None
    return out


def _add_contributor(cur, rid: str, user_id: str) -> None:
    cur.execute(
        "INSERT INTO release_contributors (release_id, user_id) VALUES (%s, %s) "
        "ON CONFLICT DO NOTHING", (rid, user_id),
    )


def _refresh_manifest(cur, rid: str) -> str:
    cur.execute(
        "SELECT ri.derivative_id, ri.label, d.sha256 FROM release_items ri "
        "JOIN derivatives d ON d.id = ri.derivative_id WHERE ri.release_id = %s ORDER BY ri.id",
        (rid,),
    )
    items = [{"derivative_id": r[0], "label": r[1], "sha256": r[2]} for r in cur.fetchall()]
    digest = ledger.manifest_digest(items)
    cur.execute(
        "UPDATE releases SET manifest_digest = %s, total_bytes = "
        "(SELECT coalesce(sum(d.size), 0) FROM release_items ri "
        "JOIN derivatives d ON d.id = ri.derivative_id WHERE ri.release_id = %s) "
        "WHERE id = %s",
        (digest, rid, rid),
    )
    return digest


async def add_item(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
    derivative_id = body.get("derivative_id")
    label = body.get("label")
    errors = {}
    if not isinstance(derivative_id, str) or not trim(derivative_id):
        errors["derivative_id"] = REQUIRED
    if not isinstance(label, str) or not trim(label):
        errors["label"] = REQUIRED
    elif not storable_text(trim(label)):
        errors["label"] = "This field holds characters that cannot be stored."
    elif len(trim(label)) > 120:
        errors["label"] = over_length(120)
    if errors:
        raise validation(errors)
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(forbidden(), rid)
    state = row[5]
    if state != "assembling":
        raise release_locked(state)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    cur.execute(
        "SELECT d.id, d.compartment_id, d.exhibit_id, d.marks_version, e.marks_version, e.state, d.disposed "
        "FROM derivatives d JOIN exhibits e ON e.id = d.exhibit_id WHERE d.id = %s", (derivative_id,),
    )
    d = cur.fetchone()
    if not d or d[1] != row[1]:
        ctx.deny_and_raise(not_found(), derivative_id)
    if d[5] in ("disposed",) or d[6] or d[5] == "quarantined" or d[5] == "refused":
        ctx.rollback()
        raise exhibit_not_cleared(d[5])
    if d[3] < d[4]:
        ctx.rollback()
        raise derivative_superseded(derivative_id)
    iid = security.new_id("ITM", ctx.app.next_seq(cur, "itm"))
    cur.execute(
        "INSERT INTO release_items (id, release_id, derivative_id, label, position) VALUES (%s, %s, %s, %s, %s)",
        (iid, rid, derivative_id, trim(label), 0),
    )
    _add_contributor(cur, rid, ctx.user_id)
    cur.execute(
        "SELECT created_by, marks_saved_by FROM derivatives WHERE id = %s", (derivative_id,)
    )
    created_by, marks_saved_by = cur.fetchone()
    for uid in (created_by, marks_saved_by):
        if uid:
            _add_contributor(cur, rid, uid)
    _refresh_manifest(cur, rid)
    ledger.append(cur, ctx.user_id, ctx.session_id, "release.item_added", rid,
                  {"item_id": iid, "derivative_id": derivative_id, "exhibit_id": d[2]})
    ctx.commit()
    row = _load_release(ctx, rid)
    opened = _opened_by_caller(ctx, rid) if ctx.role == "case_lead" else None
    return ctx.json(201, _release_out(ctx, row, _load_items(ctx, rid), opened))


async def remove_item(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    iid = ctx.request.scope['path_params']["item_id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(forbidden(), rid)
    if row[5] != "assembling":
        raise release_locked(row[5])
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    cur.execute("SELECT id, derivative_id, label FROM release_items WHERE id = %s AND release_id = %s", (iid, rid))
    item = cur.fetchone()
    if not item:
        ctx.deny_and_raise(not_found(), iid)
    cur.execute("DELETE FROM release_items WHERE id = %s", (iid,))
    cur.execute("SELECT exhibit_id FROM derivatives WHERE id = %s", (item[1],))
    eid = cur.fetchone()[0]
    _refresh_manifest(cur, rid)
    ledger.append(cur, ctx.user_id, ctx.session_id, "release.item_removed", rid,
                  {"item_id": iid, "derivative_id": item[1], "exhibit_id": eid})
    ctx.commit()
    row = _load_release(ctx, rid)
    return ctx.json(200, _release_out(ctx, row, _load_items(ctx, rid)))


async def submit_release(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(forbidden(), rid)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    _proof(ctx, cur)
    cur.execute("SELECT state, assembler_id FROM releases WHERE id = %s", (rid,))
    state, assembler = cur.fetchone()
    if state != "assembling":
        ctx.rollback()
        raise illegal_transition(state, "submitted")
    if ctx.user_id != assembler and ctx.user_id not in _contributors(ctx, rid):
        ctx.rollback()
        raise forbidden()
    cur.execute("SELECT count(*) FROM release_items WHERE release_id = %s", (rid,))
    if cur.fetchone()[0] == 0:
        ctx.rollback()
        raise release_empty()
    cur.execute(
        "SELECT ri.derivative_id FROM release_items ri JOIN derivatives d ON d.id = ri.derivative_id "
        "JOIN exhibits e ON e.id = d.exhibit_id WHERE ri.release_id = %s AND d.marks_version < e.marks_version "
        "ORDER BY ri.id LIMIT 1", (rid,),
    )
    sup = cur.fetchone()
    if sup:
        ctx.rollback()
        raise derivative_superseded(sup[0])
    cur.execute("UPDATE releases SET state = 'submitted' WHERE id = %s", (rid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "release.submitted", rid, {})
    ctx.commit()
    row = _load_release(ctx, rid)
    return ctx.json(200, _release_out(ctx, row, _load_items(ctx, rid)))


def _proof(ctx: Ctx, cur) -> None:
    proof = ctx.request.headers.get("x-step-up-proof")
    if not proof or not ctx.app.sessions.consume_proof(cur, ctx.session_id, proof):
        ctx.deny_and_raise(ApiError(403, {"error": "step_up_required"}), ctx.request.url.path)


async def decide_release(ctx: Ctx, action: str) -> dict:
    """Sign off or reject (the two submitted-state decisions)."""
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), rid)
    grant = ctx.active_grant(row[1])
    if not grant or grant["scope"] != "full" or grant["kind"] == "break_glass":
        if grant and grant["kind"] == "break_glass":
            ctx.deny_and_raise(forbidden(), rid)
        ctx.deny_and_raise(not_found(), rid)
    body = await ctx.request.json() if action in ("sign_off", "reject") else {}
    reason = None
    if action == "reject":
        reason = body.get("reason")
        errors = {}
        if not isinstance(reason, str) or not trim(reason):
            errors["reason"] = "Write a reason of at least 10 characters."
        elif not storable_text(trim(reason)):
            errors["reason"] = "This field holds characters that cannot be stored."
        elif len(trim(reason)) > 2000:
            errors["reason"] = over_length(2000)
        elif len(trim(reason)) < 10:
            errors["reason"] = "Write a reason of at least 10 characters."
        if errors:
            raise validation(errors)
        reason = trim(reason)
    manifest = body.get("manifest_digest") if action == "sign_off" else None
    if action == "sign_off" and (not isinstance(manifest, str) or not manifest):
        raise validation({"manifest_digest": REQUIRED})
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    _proof(ctx, cur)
    cur.execute("SELECT state, assembler_id, manifest_digest FROM releases WHERE id = %s", (rid,))
    state, assembler, current_manifest = cur.fetchone()
    if ctx.user_id == assembler or ctx.user_id in _contributors(ctx, rid):
        ctx.rollback()
        raise separation_of_duties()
    if state != "submitted":
        ctx.rollback()
        raise illegal_transition(state, "signed off" if action == "sign_off" else "rejected")
    if action == "sign_off":
        if manifest != current_manifest:
            ctx.rollback()
            raise release_changed(current_manifest)
        cur.execute(
            "SELECT ri.id, ri.derivative_id FROM release_items ri "
            "JOIN derivatives d ON d.id = ri.derivative_id "
            "JOIN exhibits e ON e.id = d.exhibit_id WHERE ri.release_id = %s "
            "AND d.marks_version < e.marks_version ORDER BY ri.id", (rid,),
        )
        sup = cur.fetchone()
        if sup:
            ctx.rollback()
            raise derivative_superseded(sup[1])
        cur.execute(
            "SELECT ri.id, ri.derivative_id FROM release_items ri WHERE ri.release_id = %s ORDER BY ri.id",
            (rid,),
        )
        unopened = [
            iid for iid, dv in cur.fetchall()
            if not _has_claim(cur, ctx.user_id, dv)
        ]
        if unopened:
            ctx.rollback()
            raise items_unopened(unopened)
        new_state = "signed off"
        entry = "release.signed_off"
        detail = {"manifest_digest": current_manifest,
                  "opened_items": [i["id"] for i in _load_items(ctx, rid)]}
        subject_state = "signed off"
    else:
        new_state = "rejected"
        entry = "release.rejected"
        detail = {}
        subject_state = "rejected"
    cur.execute(
        "UPDATE releases SET state = %s, rejection_reason = %s WHERE id = %s",
        (new_state, reason, rid),
    )
    ledger.append(cur, ctx.user_id, ctx.session_id, entry, rid, detail)
    cur.execute("SELECT email FROM people WHERE id = %s", (assembler,))
    to_email = cur.fetchone()[0]
    from ..db import as_utc_iso
    subject = f"Release {rid} {subject_state}"
    mail_body = (
        f"Release {rid} was {subject_state} by {ctx.user['name']}.\n"
        f"Open Wardline to read the decision.\n"
    )
    ctx.app.mailer.queue(cur, to_email, subject, mail_body)
    notice = "held" if not ctx.mail_up() else "queued"
    ctx.commit()
    row = _load_release(ctx, rid)
    out = _release_out(ctx, row, _load_items(ctx, rid))
    out["notice"] = notice
    return ctx.json(200, out)


def _has_claim(cur, user_id: str, derivative_id: str) -> bool:
    cur.execute(
        "SELECT 1 FROM download_claims WHERE user_id = %s AND derivative_id = %s",
        (user_id, derivative_id),
    )
    return cur.fetchone() is not None


async def reopen_release(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    cur.execute("SELECT state, assembler_id FROM releases WHERE id = %s", (rid,))
    state, assembler = cur.fetchone()
    if state != "rejected":
        ctx.rollback()
        raise illegal_transition(state, "assembling")
    if ctx.user_id != assembler:
        ctx.rollback()
        raise forbidden()
    cur.execute("UPDATE releases SET state = 'assembling', rejection_reason = NULL WHERE id = %s", (rid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "release.reopened", rid, {})
    ctx.commit()
    row = _load_release(ctx, rid)
    return ctx.json(200, _release_out(ctx, row, _load_items(ctx, rid)))


async def withdraw_release(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), rid)
    grant = ctx.active_grant(row[1])
    if not grant or grant["scope"] != "full":
        if grant and grant["kind"] == "break_glass":
            ctx.deny_and_raise(forbidden(), rid)
        ctx.deny_and_raise(not_found(), rid)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    _proof(ctx, cur)
    cur.execute("SELECT state FROM releases WHERE id = %s", (rid,))
    state = cur.fetchone()[0]
    if state != "shared":
        ctx.rollback()
        raise illegal_transition(state, "withdrawn")
    cur.execute("UPDATE releases SET state = 'withdrawn' WHERE id = %s", (rid,))
    cur.execute("UPDATE links SET state = 'withdrawn' WHERE release_id = %s AND state = 'active'", (rid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "release.withdrawn", rid, {})
    ctx.commit()
    row = _load_release(ctx, rid)
    return ctx.json(200, _release_out(ctx, row, _load_items(ctx, rid)))


async def share_release(ctx: Ctx, regenerate: bool) -> dict:
    """Share, or regenerate the link of an already-shared release."""
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), rid)
    grant = ctx.active_grant(row[1])
    if not grant or grant["scope"] != "full":
        if grant and grant["kind"] == "break_glass":
            ctx.deny_and_raise(forbidden(), rid)
        ctx.deny_and_raise(not_found(), rid)
    body = await ctx.request.json()
    expires_at = body.get("expires_at")
    if not isinstance(expires_at, str) or not expires_at.strip():
        raise validation({"expires_at": REQUIRED})
    from ..db import parse_time
    expires_dt = parse_time(expires_at)
    if expires_dt in (None, "invalid"):
        raise validation({"expires_at": "Choose a time in the future."})
    now = datetime.datetime.now(datetime.timezone.utc)
    if expires_dt <= now:
        raise validation({"expires_at": "Choose a time in the future."})
    if expires_dt > now + datetime.timedelta(days=90):
        raise validation({"expires_at": "Choose a time within 90 days."})
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    _proof(ctx, cur)
    cur.execute("SELECT state FROM releases WHERE id = %s", (rid,))
    state = cur.fetchone()[0]
    cur.execute(
        "SELECT ri.derivative_id, d.size, d.storage_key FROM release_items ri "
        "JOIN derivatives d ON d.id = ri.derivative_id WHERE ri.release_id = %s ORDER BY ri.id", (rid,),
    )
    items = cur.fetchall()
    sup = None
    cur.execute(
        "SELECT ri.derivative_id FROM release_items ri JOIN derivatives d ON d.id = ri.derivative_id "
        "JOIN exhibits e ON e.id = d.exhibit_id WHERE ri.release_id = %s AND d.marks_version < e.marks_version "
        "ORDER BY ri.id LIMIT 1", (rid,),
    )
    sup = cur.fetchone()
    if not regenerate:
        if state != "signed off":
            ctx.rollback()
            raise illegal_transition(state, "shared")
    else:
        if state != "shared":
            ctx.rollback()
            raise illegal_transition(state, "shared")
    if sup:
        ctx.rollback()
        raise derivative_superseded(sup[0])
    # confirm every derivative present in storage before committing
    for dv, size, key in items:
        st = ctx.app.storage.stat(key)
        if st is None or st[0] != size:
            ctx.rollback()
            raise derivative_missing()
    token = security.new_token()
    link_id = security.new_id("LNK", ctx.app.next_seq(cur, "lnk"))
    if regenerate:
        cur.execute("UPDATE links SET state = 'revoked' WHERE release_id = %s AND state = 'active'", (rid,))
        ledger.append(cur, ctx.user_id, ctx.session_id, "link.regenerated", rid, {"link_id": link_id})
    else:
        cur.execute("UPDATE releases SET state = 'shared' WHERE id = %s", (rid,))
    cur.execute(
        "INSERT INTO links (id, release_id, token_sha256, expires_at, state) VALUES (%s, %s, %s, %s, 'active')",
        (link_id, rid, security.hash_token(token), expires_dt),
    )
    if not regenerate:
        ledger.append(cur, ctx.user_id, ctx.session_id, "release.shared", rid, {"link_id": link_id})
    ctx.commit()
    return ctx.json(201, {
        "release_id": rid, "state": "shared", "link_id": link_id, "token": token,
        "url": f"/l/{token}", "expires_at": db_ts(expires_dt),
    })


async def revoke_link(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise unauthenticated()
    rid = ctx.request.scope['path_params']["id"]
    row = _load_release(ctx, rid)
    if row is None:
        ctx.deny_and_raise(not_found(), rid)
    if ctx.role != "case_lead":
        ctx.deny_and_raise(forbidden(), rid)
    grant = ctx.active_grant(row[1])
    if not grant or grant["scope"] != "full" or grant["kind"] == "break_glass":
        ctx.deny_and_raise(forbidden(), rid)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (RELEASE_LOCK_KEY ^ (hash(rid) & 0x7FFFFFFF),))
    _proof(ctx, cur)
    cur.execute("SELECT state FROM releases WHERE id = %s", (rid,))
    state = cur.fetchone()[0]
    if state != "shared":
        ctx.rollback()
        raise illegal_transition(state, "shared")
    cur.execute("SELECT id FROM links WHERE release_id = %s AND state = 'active'", (rid,))
    link = cur.fetchone()
    if not link:
        ctx.rollback()
        raise illegal_transition(state, "shared")
    cur.execute("UPDATE links SET state = 'revoked' WHERE id = %s", (link[0],))
    ledger.append(cur, ctx.user_id, ctx.session_id, "link.revoked", rid, {"link_id": link[0]})
    ctx.commit()
    return ctx.json(200, {"link_id": link[0], "state": "revoked"})
