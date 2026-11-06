"""Exhibits: registration, quarantine, holds, disposal, redaction, derivatives."""
from __future__ import annotations

import datetime
import hashlib
import io
import os

from .. import ledger, rendering, security
from ..storage import StorageUnavailable
from ..domain import storable_text, trim, validate_regions
from ..errors import (
    REQUIRED,
    ApiError,
    exhibit_in_release,
    exhibit_not_cleared,
    file_too_large,
    hold_exists,
    idempotency_conflict,
    illegal_transition,
    legal_hold,
    not_found,
    not_previewable,
    not_redactable,
    over_length,
    seal_mismatch,
    separation_of_duties,
    stale_marks,
    storage_unavailable,
    validation,
)
from ..errors import forbidden
from ..sniffing import ACCEPTED_TYPES, sniff
from .base import db_ts
from .ctx import Ctx
from .serialisers import derivative, hold as hold_out

EXHIBIT_LOCK_KEY = 771022
MAX_FILE = 20_000_000


def _load_exhibit(ctx: Ctx, eid: str) -> tuple | None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, compartment_id, name, state, sha256, size, sniffed_type, page_count, "
            "registered_by, marks_version, seal_check, disposal_proposed_by "
            "FROM exhibits WHERE id = %s", (eid,),
        )
        return cur.fetchone()


def _require_grant(ctx: Ctx, cid: str, want_scope: str | None = None) -> dict:
    g = ctx.active_grant(cid)
    if g is None:
        ctx.deny_and_raise(not_found(), cid)
    if want_scope and g["scope"] != want_scope:
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), cid)
    return g


async def register_exhibit(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    cid = ctx.request.scope['path_params']["id"]
    if ctx.role != "intake_officer":
        with ctx.conn.cursor() as cur:
            cur.execute("SELECT 1 FROM compartments WHERE id = %s", (cid,))
            if cur.fetchone():
                ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), cid)
        ctx.deny_and_raise(not_found(), cid)
    g = ctx.active_grant(cid)
    if g is None:
        ctx.deny_and_raise(not_found(), cid)
    if g["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), cid)
    form = await ctx.request.form()
    idem_key = ctx.request.headers.get("idempotency-key")
    if idem_key is not None:
        if not (1 <= len(trim(idem_key)) <= 128):
            raise validation({"idempotency_key": "This key cannot be used."})
    errors: dict[str, str] = {}

    name = form.get("name")
    declared = form.get("declared_type")
    source = form.get("source")
    collected_by = form.get("collected_by")
    collected_on = form.get("collected_on")
    capture_notes = form.get("capture_notes")
    submitted_sha = form.get("submitted_sha256")
    upload = form.get("file")

    def text_field(value) -> str | None:
        if value is None:
            return None
        return value if isinstance(value, str) else None

    name = text_field(name)
    declared = text_field(declared)
    source = text_field(source)
    collected_by = text_field(collected_by)
    collected_on = text_field(collected_on)
    capture_notes = text_field(capture_notes)
    submitted_sha = text_field(submitted_sha)

    for label, value, maximum in (("name", name, 200), ("source", source, 500), ("collected_by", collected_by, 200)):
        if value is None or not isinstance(value, str) or not trim(value):
            errors[label] = REQUIRED
        elif not storable_text(trim(value)):
            errors[label] = "This field holds characters that cannot be stored."
        elif len(trim(value)) > maximum:
            errors[label] = over_length(maximum)
    if not declared:
        errors["declared_type"] = REQUIRED
    elif declared not in ACCEPTED_TYPES:
        errors["file"] = "This file type is not accepted."
    if collected_on is None or not isinstance(collected_on, str) or not trim(collected_on):
        errors["collected_on"] = REQUIRED
    else:
        try:
            d = datetime.datetime.strptime(trim(collected_on), "%Y-%m-%d").date()
            if d > datetime.date.today():
                errors["collected_on"] = "Enter a date that is not in the future, as YYYY-MM-DD."
        except ValueError:
            errors["collected_on"] = "Enter a date that is not in the future, as YYYY-MM-DD."
    if capture_notes is not None and isinstance(capture_notes, str):
        if not storable_text(capture_notes):
            errors["capture_notes"] = "This field holds characters that cannot be stored."
        elif len(trim(capture_notes)) > 2000:
            errors["capture_notes"] = over_length(2000)

    data = b""
    filename = None
    if upload is not None and hasattr(upload, "read"):
        filename = upload.filename or ""
        if "/" in filename or "\\" in filename or ".." in filename or any(ord(c) < 32 for c in filename):
            errors["file"] = "This file name is not accepted."
        elif len(filename) > 500:
            errors["file"] = "This file name is not accepted."
        else:
            data = await upload.read(MAX_FILE + 1)
            if len(data) > MAX_FILE:
                raise file_too_large()

    if errors and "file" not in errors and not data:
        errors["file"] = REQUIRED

    if "file" in errors:
        raise validation(errors)

    sniffed = sniff(data)
    if sniffed is None or sniffed not in ACCEPTED_TYPES:
        errors["file"] = "This file type is not accepted."
        raise validation(errors)
    if sniffed != declared:
        errors["file"] = "The declared type does not match the file."
        raise validation(errors)
    digest = hashlib.sha256(data).hexdigest()
    if submitted_sha is not None and isinstance(submitted_sha, str):
        submitted = trim(submitted_sha)
        if submitted and submitted != digest:
            errors["file"] = "The file does not match the submitted digest."
            raise validation(errors)
    if errors:
        raise validation(errors)

    cur = ctx.begin()
    if idem_key:
        fingerprint = security.sha256_hex(
            (digest + "|" + trim(name or "") + "|" + trim(source or "") + "|" + trim(collected_by or "") +
             "|" + trim(collected_on or "") + "|" + (trim(capture_notes or "") or "") + "|" +
             declared + "|" + cid).encode("utf-8")
        )
        stored = ctx.app.idempotent_replay(cur, ctx.user_id, "register", idem_key, fingerprint)
        if stored == "conflict":
            ctx.rollback()
            raise idempotency_conflict()
        if stored and stored != "conflict":
            ctx.commit()
            resp = ctx.json(stored["status"], _loads(stored["body"]))
            resp.headers["Idempotent-Replay"] = "true"
            return resp
    else:
        fingerprint = None
    key = ctx.app.storage.new_key("original")
    try:
        stored_digest, stored_size = ctx.app.storage.put_and_hash(key, data, sniffed)
    except StorageUnavailable:
        ctx.rollback()
        raise storage_unavailable()
    if stored_size != len(data) or stored_digest != digest:
        ctx.app.storage.delete(key)
        ctx.rollback()
        raise storage_unavailable()
    eid = security.new_id("EX", ctx.app.next_seq(cur, "exhibit"))
    cur.execute(
        "INSERT INTO exhibits (id, compartment_id, name, state, sha256, size, sniffed_type, page_count, "
        "storage_key, registered_by, marks_version, provenance_source, provenance_collected_by, "
        "provenance_collected_on, provenance_capture_notes) "
        "VALUES (%s, %s, %s, 'quarantined', %s, %s, %s, %s, %s, %s, 0, %s, %s, %s, %s)",
        (eid, cid, trim(name), digest, len(data), sniffed, _page_count(data, sniffed), key,
         ctx.user_id, trim(source), trim(collected_by), trim(collected_on),
         trim(capture_notes) if capture_notes else None),
    )
    ledger.append(cur, ctx.user_id, ctx.session_id, "exhibit.sealed", eid,
                  {"sha256": digest, "size": len(data)})
    if idem_key:
        body = {"id": eid, "compartment_id": cid, "state": "quarantined", "sealed": True,
                "sha256": digest, "size": len(data), "sniffed_type": sniffed}
        ctx.app.idempotent_store(cur, ctx.user_id, "register", idem_key, 201, body, fingerprint)
    ctx.commit()
    return ctx.json(201, {"id": eid, "compartment_id": cid, "state": "quarantined",
                          "sealed": True, "sha256": digest, "size": len(data),
                          "sniffed_type": sniffed})


def _loads(s: str):
    import json
    return json.loads(s)


def _page_count(data: bytes, sniffed_type: str | None) -> int | None:
    try:
        parsed = rendering.parse(data, sniffed_type)
        if parsed is None:
            return None
        return parsed.page_count
    except rendering.NotPreviewable:
        # still sealed; page count is known for PDFs above the render limits
        if sniffed_type == "application/pdf":
            try:
                import pypdf, io
                return len(pypdf.PdfReader(io.BytesIO(data)).pages)
            except Exception:
                return None
        return None
    except Exception:
        return None


async def list_exhibits(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    cid = ctx.request.scope['path_params']["id"]
    if ctx.active_grant(cid) is None:
        ctx.deny_and_raise(not_found(), cid)
    state = ctx.request.query_params.get("state")
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, compartment_id, name, state, sha256, size, sniffed_type, page_count, registered_by, "
            "marks_version, seal_check, disposal_proposed_by, provenance_source, provenance_collected_by, "
            "provenance_collected_on, provenance_capture_notes FROM exhibits "
            "WHERE compartment_id = %s" + (" AND state = %s" if state else "") + " ORDER BY id",
            (cid, state) if state else (cid,),
        )
        rows = cur.fetchall()
    scope = ctx.grant_scope(cid)
    return ctx.json(200, {"exhibits": [_exhibit_out(r, scope) for r in rows]})


def _exhibit_out(row, scope: str | None) -> dict:
    (eid, cid, name, state, sha, size, sniffed, page_count, registered_by,
     marks_version, seal_check, disposal_proposed_by, source, collected_by,
     collected_on, capture_notes) = row
    return {
        "id": eid,
        "compartment_id": cid,
        "name": name,
        "state": state,
        "sealed": True,
        "sha256": sha,
        "size": size,
        "sniffed_type": sniffed,
        "page_count": page_count,
        "registered_by": registered_by,
        "marks_version": marks_version,
        "seal_check": seal_check,
        "disposal_proposed_by": disposal_proposed_by,
        "holds": [],
        "provenance": (None if scope == "derivatives" else {
            "source": source, "collected_by": collected_by,
            "collected_on": collected_on, "capture_notes": capture_notes,
        }),
    }


async def get_exhibit(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit_full(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid = row[1]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, matter_ref, placed_by FROM holds WHERE exhibit_id = %s AND active = true ORDER BY id",
            (eid,),
        )
        holds = [hold_out(h) for h in cur.fetchall()]
        cur.execute(
            "SELECT provenance_source, provenance_collected_by, provenance_collected_on, provenance_capture_notes "
            "FROM exhibits WHERE id = %s", (eid,),
        )
        src, cby, con, notes = cur.fetchone()
    out = _exhibit_out(row, grant["scope"])
    out["holds"] = holds
    if grant["scope"] != "derivatives":
        out["provenance"] = {"source": src, "collected_by": cby, "collected_on": con, "capture_notes": notes}
    return ctx.json(200, out)


def _load_exhibit_full(ctx: Ctx, eid: str) -> tuple | None:
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, compartment_id, name, state, sha256, size, sniffed_type, page_count, registered_by, "
            "marks_version, seal_check, disposal_proposed_by, provenance_source, provenance_collected_by, "
            "provenance_collected_on, provenance_capture_notes FROM exhibits WHERE id = %s", (eid,),
        )
        return cur.fetchone()


def _proof_or_403(ctx: Ctx, cur) -> None:
    proof = ctx.request.headers.get("x-step-up-proof")
    if not proof or not ctx.app.sessions.consume_proof(cur, ctx.session_id, proof):
        ctx.deny_and_raise(ApiError(403, {"error": "step_up_required"}), ctx.request.url.path)


def _exhibit_with_holds(ctx: Ctx, eid: str, scope: str | None = "full") -> dict:
    """Read the exhibit with its active holds for a mutating response."""
    row = _load_exhibit_full(ctx, eid)
    out = _exhibit_out(row, scope)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, matter_ref, placed_by FROM holds WHERE exhibit_id = %s AND active = true ORDER BY id",
            (eid,),
        )
        out["holds"] = [
            {"id": h[0], "matter_ref": h[1], "placed_by": h[2]} for h in cur.fetchall()
        ]
    return out


async def clear_exhibit(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, registered_by, sha, size = row[1], row[3], row[8], row[4], row[5]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "intake_officer":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    if grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    if registered_by == ctx.user_id:
        ctx.deny_and_raise(separation_of_duties(), eid)
    if state != "quarantined":
        ctx.rollback()
        raise illegal_transition(state, "cleared")
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT storage_key FROM exhibits WHERE id = %s", (eid,))
        storage_key = cur.fetchone()[0]
    try:
        found_sha, found_size = ctx.app.storage.hash_object(storage_key)
    except Exception:
        ctx.rollback()
        raise storage_unavailable()
    if found_sha != sha or found_size != size:
        cur = ctx.begin()
        cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
        _proof_or_403(ctx, cur)
        cur.execute("SELECT state FROM exhibits WHERE id = %s", (eid,))
        if cur.fetchone()[0] != "quarantined":
            ctx.rollback()
            raise illegal_transition("quarantined", "cleared")
        cur.execute("UPDATE exhibits SET seal_check = 'failed' WHERE id = %s", (eid,))
        ledger.append(cur, ctx.user_id, ctx.session_id, "exhibit.seal_failed", eid,
                      {"sealed_sha256": sha, "sealed_size": size,
                       "found_sha256": found_sha, "found_size": found_size})
        cur.execute("INSERT INTO signals (kind, target) VALUES ('seal_mismatch', %s)", (eid,))
        ctx.commit()
        raise seal_mismatch(sha)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT state, registered_by FROM exhibits WHERE id = %s", (eid,))
    current, reg = cur.fetchone()
    if current != "quarantined":
        ctx.rollback()
        raise illegal_transition("quarantined", "cleared")
    if reg == ctx.user_id:
        ctx.rollback()
        raise separation_of_duties()
    cur.execute("UPDATE exhibits SET state = 'cleared', cleared_by = %s, seal_check = NULL WHERE id = %s",
                (ctx.user_id, eid))
    ledger.append(cur, ctx.user_id, ctx.session_id, "exhibit.cleared", eid, {})
    ctx.commit()
    row = _load_exhibit_full(ctx, eid)
    return ctx.json(200, _exhibit_out(row, "full"))


async def refuse_exhibit(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
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
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, registered_by = row[1], row[3], row[8]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "intake_officer":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    if grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    if registered_by == ctx.user_id:
        ctx.deny_and_raise(separation_of_duties(), eid)
    if state != "quarantined":
        ctx.rollback()
        raise illegal_transition(state, "refused")
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT state, registered_by FROM exhibits WHERE id = %s", (eid,))
    current, reg = cur.fetchone()
    if current != "quarantined":
        ctx.rollback()
        raise illegal_transition("quarantined", "refused")
    if reg == ctx.user_id:
        ctx.rollback()
        raise separation_of_duties()
    cur.execute("UPDATE exhibits SET state = 'refused' WHERE id = %s", (eid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "exhibit.refused", eid, {"reason": reason})
    ctx.commit()
    return ctx.json(200, _exhibit_with_holds(ctx, eid))


async def place_hold(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
    reason = body.get("reason")
    matter = body.get("matter_ref")
    errors = {}
    if not isinstance(reason, str) or not trim(reason):
        errors["reason"] = "Write a reason of at least 10 characters."
    elif not storable_text(trim(reason)):
        errors["reason"] = "This field holds characters that cannot be stored."
    elif len(trim(reason)) > 2000:
        errors["reason"] = over_length(2000)
    elif len(trim(reason)) < 10:
        errors["reason"] = "Write a reason of at least 10 characters."
    if not isinstance(matter, str) or not trim(matter):
        errors["matter_ref"] = REQUIRED
    elif not storable_text(trim(matter)):
        errors["matter_ref"] = "This field holds characters that cannot be stored."
    elif len(trim(matter)) > 200:
        errors["matter_ref"] = over_length(200)
    if errors:
        raise validation(errors)
    reason, matter = trim(reason), trim(matter)
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state = row[1], row[3]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "case_lead" or grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    if state not in ("cleared", "disposal proposed", "held"):
        if state == "disposed":
            ctx.rollback()
            raise illegal_transition(state, "held")
        ctx.rollback()
        raise illegal_transition(state, "held")
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT state FROM exhibits WHERE id = %s", (eid,))
    current = cur.fetchone()[0]
    if current not in ("cleared", "disposal proposed", "held"):
        ctx.rollback()
        raise illegal_transition(current, "held")
    cur.execute("SELECT 1 FROM holds WHERE exhibit_id = %s AND matter_ref = %s AND active = true", (eid, matter))
    if cur.fetchone():
        ctx.rollback()
        raise hold_exists()
    hid = security.new_id("HLD", ctx.app.next_seq(cur, "hold"))
    cur.execute(
        "INSERT INTO holds (id, exhibit_id, matter_ref, reason, placed_by, active) VALUES (%s, %s, %s, %s, %s, true)",
        (hid, eid, matter, reason, ctx.user_id),
    )
    if current == "disposal proposed":
        cur.execute("UPDATE exhibits SET state = 'held', disposal_proposed_by = NULL WHERE id = %s", (eid,))
        ledger.append(cur, ctx.user_id, ctx.session_id, "disposal.cancelled", eid, {})
    else:
        cur.execute("UPDATE exhibits SET state = 'held' WHERE id = %s", (eid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "hold.placed", eid,
                  {"hold_id": hid, "matter_ref": matter})
    ctx.commit()
    return ctx.json(200, _exhibit_with_holds(ctx, eid))


async def lift_hold(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
    hold_id = body.get("hold_id")
    reason = body.get("reason")
    errors = {}
    if not isinstance(hold_id, str) or not trim(hold_id):
        errors["hold_id"] = REQUIRED
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
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state = row[1], row[3]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "case_lead" or grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT id, active FROM holds WHERE id = %s AND exhibit_id = %s", (hold_id, eid))
    h = cur.fetchone()
    if not h or not h[1]:
        ctx.deny_and_raise(not_found(), hold_id)
    cur.execute("UPDATE holds SET active = false WHERE id = %s", (hold_id,))
    cur.execute("SELECT count(*) FROM holds WHERE exhibit_id = %s AND active = true", (eid,))
    remaining = cur.fetchone()[0]
    if remaining == 0:
        cur.execute("UPDATE exhibits SET state = 'cleared' WHERE id = %s", (eid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "hold.lifted", eid,
                  {"hold_id": hold_id, "reason": reason})
    ctx.commit()
    return ctx.json(200, _exhibit_with_holds(ctx, eid))


def _reject_break_glass_disposal(ctx: Ctx, grant: dict, state: str) -> None:
    """Disposal actions under break-glass answer forbidden, except legal_hold
    on a held exhibit (Business rules, DP-69)."""
    if grant and grant.get("kind") == "break_glass":
        if state == "held":
            raise legal_hold()
        raise forbidden()


async def propose_disposal(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
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
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state = row[1], row[3]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "case_lead" or grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    _reject_break_glass_disposal(ctx, grant, state)
    if state == "held":
        ctx.deny_and_raise(legal_hold(), eid)
    if state not in ("cleared",):
        ctx.rollback()
        raise illegal_transition(state, "disposal proposed")
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT state FROM exhibits WHERE id = %s", (eid,))
    current = cur.fetchone()[0]
    if current == "held":
        ctx.rollback()
        raise legal_hold()
    if current != "cleared":
        ctx.rollback()
        raise illegal_transition(current, "disposal proposed")
    cur.execute(
        "SELECT 1 FROM release_items ri JOIN releases r ON r.id = ri.release_id "
        "JOIN derivatives d ON d.id = ri.derivative_id "
        "WHERE d.exhibit_id = %s AND r.state <> 'withdrawn'", (eid,),
    )
    if cur.fetchone():
        ctx.rollback()
        raise exhibit_in_release()
    cur.execute("UPDATE exhibits SET state = 'disposal proposed', disposal_proposed_by = %s WHERE id = %s",
                (ctx.user_id, eid))
    ledger.append(cur, ctx.user_id, ctx.session_id, "disposal.proposed", eid, {"reason": reason})
    ctx.commit()
    return ctx.json(200, _exhibit_with_holds(ctx, eid))


async def confirm_disposal(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, proposed_by = row[1], row[3], row[11]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "case_lead" or grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    _reject_break_glass_disposal(ctx, grant, state)
    if proposed_by == ctx.user_id:
        ctx.deny_and_raise(separation_of_duties(), eid)
    if state == "held":
        ctx.deny_and_raise(legal_hold(), eid)
    if state != "disposal proposed":
        ctx.rollback()
        raise illegal_transition(state, "disposed")
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT storage_key FROM exhibits WHERE id = %s", (eid,))
        original_key = cur.fetchone()[0]
        cur.execute("SELECT id, storage_key FROM derivatives WHERE exhibit_id = %s", (eid,))
        derivatives = cur.fetchall()
    keys = [(original_key, "originals")] + [(dk, "derivatives") for _, dk in derivatives]
    for key, _kind in keys:
        if ctx.app.storage.stat(key) is None:
            ctx.rollback()
            raise ApiError(409, {"error": "derivative_missing"})
    for key, _kind in keys:
        if not ctx.app.storage.delete(key):
            ctx.rollback()
            raise storage_unavailable()
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT state, disposal_proposed_by FROM exhibits WHERE id = %s", (eid,))
    current, proposer = cur.fetchone()
    if current == "held":
        ctx.rollback()
        raise legal_hold()
    if current != "disposal proposed":
        ctx.rollback()
        raise illegal_transition(current, "disposed")
    if proposer == ctx.user_id:
        ctx.rollback()
        raise separation_of_duties()
    cur.execute("UPDATE exhibits SET state = 'disposed', disposal_proposed_by = NULL WHERE id = %s", (eid,))
    cur.execute("DELETE FROM redaction_regions WHERE exhibit_id = %s", (eid,))
    cur.execute("UPDATE derivatives SET disposed = true WHERE exhibit_id = %s", (eid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "exhibit.disposed", eid, {})
    ctx.commit()
    return ctx.json(200, _exhibit_with_holds(ctx, eid))


async def cancel_disposal(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
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
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state = row[1], row[3]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if ctx.role != "case_lead" or grant["scope"] != "full":
        ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
    _reject_break_glass_disposal(ctx, grant, state)
    if state != "disposal proposed":
        ctx.rollback()
        raise illegal_transition(state, "cleared")
    cur = ctx.begin()
    cur.execute("SELECT pg_advisory_xact_lock(%s)", (EXHIBIT_LOCK_KEY ^ (hash(eid) & 0x7FFFFFFF),))
    _proof_or_403(ctx, cur)
    cur.execute("SELECT state FROM exhibits WHERE id = %s", (eid,))
    current = cur.fetchone()[0]
    if current != "disposal proposed":
        ctx.rollback()
        raise illegal_transition(current, "cleared")
    cur.execute("UPDATE exhibits SET state = 'cleared', disposal_proposed_by = NULL WHERE id = %s", (eid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "disposal.cancelled", eid, {"reason": reason})
    ctx.commit()
    return ctx.json(200, _exhibit_with_holds(ctx, eid))


async def preview_grant(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
    page = body.get("page")
    if isinstance(page, bool) or not isinstance(page, int):
        raise validation({"page": REQUIRED})
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, page_count, sniffed = row[1], row[3], row[7], row[6]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if grant["scope"] != "full" or ctx.role not in ("investigator", "case_lead"):
        if ctx.role == "intake_officer" and grant["scope"] == "full":
            ctx.deny_and_raise(ApiError(403, {"error": "forbidden"}), eid)
        ctx.deny_and_raise(not_found(), eid)
    if state not in ("cleared", "held", "disposal proposed"):
        raise exhibit_not_cleared(state)
    if page_count is None or not (1 <= page <= page_count):
        raise validation({"page": "Choose a page of this exhibit."})
    token = security.new_token()
    with ctx.begin() as cur:
        cur.execute(
            "INSERT INTO download_grants (token_sha256, kind, exhibit_id, preview_page, session_id, expires_at) "
            "VALUES (%s, 'preview', %s, %s, %s, now() + interval '60 seconds')",
            (security.hash_token(token), eid, page, ctx.session_id),
        )
        ctx.commit()
    return ctx.json(201, {"token": token, "expires_in_seconds": 60})


async def download_grant(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state = row[1], row[3]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if grant["scope"] != "full" or ctx.role not in ("investigator", "case_lead", "intake_officer"):
        ctx.deny_and_raise(not_found(), eid)
    if state not in ("cleared", "held", "disposal proposed"):
        raise exhibit_not_cleared(state)
    token = security.new_token()
    with ctx.begin() as cur:
        cur.execute(
            "INSERT INTO download_grants (token_sha256, kind, exhibit_id, session_id, scope_required, expires_at) "
            "VALUES (%s, 'file', %s, %s, %s, now() + interval '60 seconds')",
            (security.hash_token(token), eid, ctx.session_id, grant["scope"]),
        )
        ctx.commit()
    return ctx.json(201, {"token": token, "expires_in_seconds": 60})


async def get_redactions(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, page_count = row[1], row[3], row[7]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if grant["scope"] == "derivatives" or ctx.role not in ("investigator", "case_lead", "auditor"):
        ctx.deny_and_raise(not_found(), eid)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT page, x, y, w, h FROM redaction_regions WHERE exhibit_id = %s ORDER BY page, y, x",
            (eid,),
        )
        regions = [{"page": p, "x": x, "y": y, "w": w, "h": h} for p, x, y, w, h in cur.fetchall()]
        cur.execute("SELECT marks_version FROM exhibits WHERE id = %s", (eid,))
        version = cur.fetchone()[0]
    return ctx.json(200, {"regions": regions, "marks_version": version})


async def put_redactions(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
    regions = body.get("regions")
    version = body.get("marks_version")
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, page_count, marks_version = row[1], row[3], row[7], row[9]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if grant["scope"] != "full" or ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(not_found(), eid)
    if state not in ("cleared", "held"):
        raise exhibit_not_cleared(state)
    if isinstance(version, bool) or not isinstance(version, int):
        raise validation({"marks_version": REQUIRED, **({"regions": REQUIRED} if regions is None else {})})
    cur = ctx.begin()
    cur.execute("SELECT state, marks_version, page_count FROM exhibits WHERE id = %s", (eid,))
    current_state, current_version, pc = cur.fetchone()
    if isinstance(version, int) and not isinstance(version, bool) and version != current_version:
        ctx.rollback()
        raise stale_marks(current_version)
    if not validate_regions(regions, pc):
        ctx.rollback()
        raise validation({"regions": "Each region must sit inside its page."})
    if current_state not in ("cleared", "held"):
        ctx.rollback()
        raise exhibit_not_cleared(current_state)
    with ctx.conn.cursor() as c2:
        c2.execute(
            "SELECT page, x, y, w, h FROM redaction_regions WHERE exhibit_id = %s ORDER BY page, y, x", (eid,)
        )
        existing = [{"page": p, "x": x, "y": y, "w": w, "h": h} for p, x, y, w, h in c2.fetchall()]
    from ..domain import regions_equal
    if regions_equal(existing, regions if isinstance(regions, list) else []):
        ctx.commit()
        return ctx.json(200, {"regions": existing, "marks_version": current_version})
    cur.execute("DELETE FROM redaction_regions WHERE exhibit_id = %s", (eid,))
    for r in regions:
        cur.execute(
            "INSERT INTO redaction_regions (exhibit_id, page, x, y, w, h) VALUES (%s, %s, %s, %s, %s, %s)",
            (eid, r["page"], r["x"], r["y"], r["w"], r["h"]),
        )
    cur.execute("UPDATE exhibits SET marks_version = marks_version + 1 WHERE id = %s", (eid,))
    ledger.append(cur, ctx.user_id, ctx.session_id, "redaction.saved", eid,
                  {"marks_version": current_version + 1})
    ctx.commit()
    with ctx.conn.cursor() as cur2:
        cur2.execute(
            "SELECT page, x, y, w, h FROM redaction_regions WHERE exhibit_id = %s ORDER BY page, y, x", (eid,)
        )
        regions = [{"page": p, "x": x, "y": y, "w": w, "h": h} for p, x, y, w, h in cur2.fetchall()]
        cur2.execute("SELECT marks_version FROM exhibits WHERE id = %s", (eid,))
        version = cur2.fetchone()[0]
    return ctx.json(200, {"regions": regions, "marks_version": version})


async def find_text(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    body = await ctx.request.json()
    text = body.get("text")
    if not isinstance(text, str) or not trim(text):
        raise validation({"text": REQUIRED})
    if not storable_text(trim(text)):
        raise validation({"text": "This field holds characters that cannot be stored."})
    if len(trim(text)) > 200:
        raise validation({"text": over_length(200)})
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, page_count, sniffed = row[1], row[3], row[7], row[6]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if grant["scope"] != "full" or ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(not_found(), eid)
    if state not in ("cleared", "held"):
        raise exhibit_not_cleared(state)
    if sniffed in ("audio/wav", "audio/mpeg") or page_count is None:
        raise not_redactable()
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT storage_key FROM exhibits WHERE id = %s", (eid,))
        key = cur.fetchone()[0]
    try:
        data = ctx.app.storage.get(key)
    except Exception:
        ctx.rollback()
        raise storage_unavailable()
    try:
        parsed = rendering.parse(data, sniffed)
    except rendering.NotPreviewable:
        raise not_redactable()
    except rendering.NotRedactable:
        raise not_redactable()
    if parsed is None:
        raise not_redactable()
    matches = parsed.matches(trim(text))
    return ctx.json(200, {"matches": matches})


async def create_derivative(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, state, page_count, sniffed = row[1], row[3], row[7], row[6]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    if grant["scope"] != "full" or ctx.role not in ("investigator", "case_lead"):
        ctx.deny_and_raise(not_found(), eid)
    if state not in ("cleared", "held"):
        raise exhibit_not_cleared(state)
    if sniffed in ("audio/wav", "audio/mpeg"):
        raise not_redactable()
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT storage_key, marks_version FROM exhibits WHERE id = %s", (eid,))
        key, marks_version = cur.fetchone()
        cur.execute("SELECT page, x, y, w, h FROM redaction_regions WHERE exhibit_id = %s ORDER BY page, y, x", (eid,))
        regions = [{"page": p, "x": x, "y": y, "w": w, "h": h} for p, x, y, w, h in cur.fetchall()]
    try:
        data = ctx.app.storage.get(key)
    except Exception:
        ctx.rollback()
        raise storage_unavailable()
    try:
        parsed = rendering.parse(data, sniffed)
    except rendering.NotPreviewable:
        raise not_previewable()
    except rendering.NotRedactable:
        raise not_redactable()
    if parsed is None:
        raise not_redactable()
    try:
        if isinstance(parsed, rendering.ImagePages):
            png = parsed.raster(1, regions)
            pages_out = [(png, parsed.width, parsed.height)]
            content_type = "image/png"
            out_page_count = 1
        else:
            pages_out = []
            for p in range(1, parsed.page_count + 1):
                pages_out.append((parsed.raster(p, regions),) )
            content = rendering.pdf_from_pngs(pages_out)
            content_type = "application/pdf"
            out_page_count = parsed.page_count
    except rendering.NotPreviewable:
        raise not_previewable()
    blob = pages_out[0][0] if content_type == "image/png" else content
    digest = hashlib.sha256(blob).hexdigest()
    dkey = ctx.app.storage.new_key("derivative")
    try:
        ctx.app.storage.put_bytes(dkey, blob, content_type)
    except Exception:
        ctx.rollback()
        raise storage_unavailable()
    cur = ctx.begin()
    did = security.new_id("DV", ctx.app.next_seq(cur, "dv"))
    cur.execute(
        "INSERT INTO derivatives (id, exhibit_id, compartment_id, sha256, size, content_type, page_count, "
        "storage_key, marks_version, created_by) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)",
        (did, eid, cid, digest, len(blob), content_type, out_page_count, dkey, marks_version, ctx.user_id),
    )
    ledger.append(cur, ctx.user_id, ctx.session_id, "derivative.rendered", did, {"exhibit_id": eid})
    marks_saved_by = _marks_saved_by(cur, eid, marks_version)
    ctx.commit()
    return ctx.json(201, {
        "id": did, "exhibit_id": eid, "compartment_id": cid, "sha256": digest,
        "size": len(blob), "content_type": content_type, "page_count": out_page_count,
        "created_by": ctx.user_id, "marks_version": marks_version,
        "marks_saved_by": marks_saved_by, "superseded": False, "disposed": False,
    })


def _marks_saved_by(cur, eid: str, marks_version: int) -> str | None:
    """The person who saved the marks this render came from, or None when none."""
    if marks_version == 0:
        return None
    cur.execute(
        "SELECT actor_id FROM ledger_entries "
        "WHERE action = 'redaction.saved' AND target = %s AND detail ->> 'marks_version' = %s "
        "ORDER BY seq DESC LIMIT 1",
        (eid, str(marks_version)),
    )
    row = cur.fetchone()
    return row[0] if row else None


async def list_derivatives(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    eid = ctx.request.scope['path_params']["id"]
    row = _load_exhibit(ctx, eid)
    if row is None:
        ctx.deny_and_raise(not_found(), eid)
    cid, marks_version = row[1], row[9]
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), eid)
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, exhibit_id, compartment_id, sha256, size, content_type, page_count, created_by, "
            "marks_version, marks_saved_by, disposed FROM derivatives WHERE exhibit_id = %s ORDER BY id",
            (eid,),
        )
        rows = cur.fetchall()
    out = []
    for r in rows:
        d = derivative(r + (r[8] < marks_version,))
        out.append(d)
    return ctx.json(200, {"derivatives": out})


async def get_derivative(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    did = ctx.request.scope['path_params']["id"]
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT id, exhibit_id, compartment_id, sha256, size, content_type, page_count, created_by, "
            "marks_version, marks_saved_by, disposed FROM derivatives WHERE id = %s", (did,),
        )
        row = cur.fetchone()
    if row is None:
        ctx.deny_and_raise(not_found(), did)
    grant = ctx.active_grant(row[2])
    if grant is None:
        ctx.deny_and_raise(not_found(), did)
    with ctx.conn.cursor() as cur:
        cur.execute("SELECT marks_version FROM exhibits WHERE id = %s", (row[1],))
        mv = cur.fetchone()[0]
    return ctx.json(200, derivative(row + (row[8] < mv,)))


async def derivative_download_grant(ctx: Ctx) -> dict:
    if ctx.session is None:
        raise ApiError(401, {"error": "unauthenticated"})
    did = ctx.request.scope['path_params']["id"]
    with ctx.conn.cursor() as cur:
        cur.execute(
            "SELECT d.id, d.exhibit_id, d.compartment_id, d.disposed, e.state FROM derivatives d "
            "JOIN exhibits e ON e.id = d.exhibit_id WHERE d.id = %s", (did,),
        )
        row = cur.fetchone()
    if row is None:
        ctx.deny_and_raise(not_found(), did)
    _, eid, cid, disposed, estate = row
    grant = ctx.active_grant(cid)
    if grant is None:
        ctx.deny_and_raise(not_found(), did)
    if disposed or estate in ("disposed", "refused", "quarantined"):
        raise exhibit_not_cleared(estate)
    token = security.new_token()
    with ctx.begin() as cur:
        cur.execute(
            "INSERT INTO download_grants (token_sha256, kind, derivative_id, session_id, scope_required, expires_at) "
            "VALUES (%s, 'file', %s, %s, %s, now() + interval '60 seconds')",
            (security.hash_token(token), did, ctx.session_id, grant["scope"]),
        )
        ctx.commit()
    return ctx.json(201, {"token": token, "expires_in_seconds": 60})
