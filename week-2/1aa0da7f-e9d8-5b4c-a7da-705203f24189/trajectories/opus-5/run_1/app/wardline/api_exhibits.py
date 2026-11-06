"""Exhibits: states, holds, disposal, marks, derivatives and grants on files."""

from __future__ import annotations

import json
from datetime import datetime, timedelta, timezone

from . import auth, db, ledger, media, storage
from .access import (
    load_compartment,
    load_custody_reader,
    load_derivative,
    load_exhibit,
    take_exhibit_lock,
)
from .errors import ApiError, ValidationFailed, illegal_transition
from .http import Context, route, target_from_text
from .rules import (
    EXHIBIT_ACTION_RESULT,
    EXHIBIT_TRANSITIONS,
    READABLE_STATES,
    WRITABLE_STATES,
)
from .validation import (
    FieldChecker,
    PAGE_COPY,
    REQUIRED,
    check_regions,
    trim,
)
from .views import derivative_view, exhibit_view

GRANT_SECONDS = 60


def paging(ctx: Context) -> tuple[int, int]:
    after = 0
    limit = 200
    raw_after = ctx.query.get("after")
    if raw_after is not None:
        try:
            value = int(raw_after)
            if 0 <= value < 2**63:
                after = value
        except ValueError:
            pass
    raw_limit = ctx.query.get("limit")
    if raw_limit is not None:
        try:
            value = int(raw_limit)
            if 1 <= value < 2**63:
                limit = min(value, 1000)
        except ValueError:
            pass
    return after, limit


def require_state(exhibit: dict, action: str) -> str:
    """Allows only the published exhibit transitions."""
    result = EXHIBIT_ACTION_RESULT[action]
    if (exhibit["state"], action) not in EXHIBIT_TRANSITIONS:
        raise illegal_transition(exhibit["state"], result)
    return result


def saved_regions(cur, exhibit_id: str) -> list[dict]:
    cur.execute("SELECT regions FROM redactions WHERE exhibit_id = %s", (exhibit_id,))
    row = cur.fetchone()
    return list(row["regions"]) if row else []


def active_holds(cur, exhibit_id: str) -> list[dict]:
    cur.execute(
        "SELECT * FROM holds WHERE exhibit_id = %s AND state = 'active' ORDER BY id",
        (exhibit_id,),
    )
    return [dict(row) for row in cur.fetchall()]


@route("/api/compartments/{id}/exhibits", ["GET"])
def list_exhibits(ctx: Context):
    with db.tx() as cur:
        compartment, grant = load_compartment(cur, ctx, "read")
        state = ctx.query.get("state")
        if state is not None:
            cur.execute(
                "SELECT * FROM exhibits WHERE compartment_id = %s AND state = %s ORDER BY id",
                (compartment["id"], state),
            )
        else:
            cur.execute(
                "SELECT * FROM exhibits WHERE compartment_id = %s ORDER BY id",
                (compartment["id"],),
            )
        rows = [dict(row) for row in cur.fetchall()]
        return 200, {
            "exhibits": [exhibit_view(cur, row, grant["scope"]) for row in rows]
        }


@route("/api/exhibits/{id}", ["GET"])
def read_exhibit(ctx: Context):
    with db.tx() as cur:
        exhibit, grant = load_exhibit(cur, ctx, "read")
        return 200, exhibit_view(cur, exhibit, grant["scope"])


@route("/api/exhibits/{id}/clear", ["POST"], json_body=True)
def clear_exhibit(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "clear")
        if exhibit["registered_by"] == ctx.user["id"]:
            raise ApiError("separation_of_duties", target=ctx.last_path_target())
    ctx.check_step_up()
    require_state(exhibit, "clear")
    if not storage.storage_up():
        raise ApiError("storage_unavailable")
    try:
        size, digest = storage.measure_object(exhibit["object_key"])
    except storage.StorageDown:
        size, digest = None, None
    if size != int(exhibit["size"]) or digest != exhibit["sha256"]:
        if size is None and not storage.storage_up():
            raise ApiError("storage_unavailable")
        with db.tx() as cur:
            cur.execute(
                "UPDATE exhibits SET seal_check = 'failed' WHERE id = %s",
                (exhibit["id"],),
            )
            ctx.log(
                cur,
                "exhibit.seal_failed",
                exhibit["id"],
                {
                    "sealed_sha256": exhibit["sha256"],
                    "sealed_size": int(exhibit["size"]),
                    "found_sha256": digest,
                    "found_size": size,
                },
            )
            ledger.raise_signal(cur, "seal_mismatch", exhibit["id"])
        raise ApiError("seal_mismatch", extra={"sha256": exhibit["sha256"]})
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        require_state(exhibit, "clear")
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE exhibits SET state = 'cleared', seal_check = NULL WHERE id = %s",
            (exhibit["id"],),
        )
        ctx.log(cur, "exhibit.cleared", exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


@route("/api/exhibits/{id}/refuse", ["POST"], json_body=True)
def refuse_exhibit(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "clear")
        if exhibit["registered_by"] == ctx.user["id"]:
            raise ApiError("separation_of_duties", target=ctx.last_path_target())
    ctx.check_step_up()
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        require_state(exhibit, "refuse")
        checker = FieldChecker(ctx.body)
        reason = checker.reason()
        checker.done()
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE exhibits SET state = 'refused' WHERE id = %s", (exhibit["id"],)
        )
        ctx.log(cur, "exhibit.refused", exhibit["id"], {"reason": reason})
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


@route("/api/exhibits/{id}/hold", ["POST"], json_body=True)
def place_hold(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "lead_full")
    ctx.check_step_up()
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        require_state(exhibit, "hold")
        checker = FieldChecker(ctx.body)
        reason = checker.reason()
        matter_ref = checker.free_text("matter_ref")
        if matter_ref is not None:
            cur.execute(
                """
                SELECT 1 FROM holds
                WHERE exhibit_id = %s AND state = 'active' AND matter_ref = %s
                """,
                (exhibit["id"], matter_ref),
            )
            if cur.fetchone() is not None:
                raise ApiError("hold_exists")
        checker.done()
        ctx.consume_proof(cur)
        hold_id = db.next_id(cur, "HLD")
        cur.execute(
            """
            INSERT INTO holds
                (id, exhibit_id, matter_ref, placed_by, reason, state, placed_at)
            VALUES (%s, %s, %s, %s, %s, 'active', %s)
            """,
            (
                hold_id,
                exhibit["id"],
                matter_ref,
                ctx.user["id"],
                reason,
                datetime.now(timezone.utc),
            ),
        )
        if exhibit["state"] == "disposal proposed":
            cur.execute(
                "UPDATE exhibits SET state = 'held', disposal_proposed_by = NULL WHERE id = %s",
                (exhibit["id"],),
            )
            ctx.log(cur, "disposal.cancelled", exhibit["id"], {"reason": "hold placed"})
        else:
            cur.execute(
                "UPDATE exhibits SET state = 'held' WHERE id = %s", (exhibit["id"],)
            )
        ctx.log(
            cur,
            "hold.placed",
            exhibit["id"],
            {"hold_id": hold_id, "matter_ref": matter_ref, "reason": reason},
        )
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


@route("/api/exhibits/{id}/lift-hold", ["POST"], json_body=True)
def lift_hold(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "lead_full")
        raw_hold = ctx.body.get("hold_id")
        if isinstance(raw_hold, str) and trim(raw_hold) != "":
            cur.execute(
                """
                SELECT * FROM holds
                WHERE id = %s AND exhibit_id = %s AND state = 'active'
                """,
                (trim(raw_hold), exhibit["id"]),
            )
            if cur.fetchone() is None:
                raise ApiError("not_found", target=target_from_text(trim(raw_hold)))
    ctx.check_step_up()
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        checker = FieldChecker(ctx.body)
        reason = checker.reason()
        hold_id = checker.body_id("hold_id")
        checker.done()
        cur.execute(
            "SELECT * FROM holds WHERE id = %s AND exhibit_id = %s AND state = 'active' FOR UPDATE",
            (hold_id, exhibit["id"]),
        )
        hold = cur.fetchone()
        if hold is None:
            raise ApiError("not_found", target=target_from_text(hold_id))
        ctx.consume_proof(cur)
        cur.execute("UPDATE holds SET state = 'lifted' WHERE id = %s", (hold_id,))
        remaining = active_holds(cur, exhibit["id"])
        if not remaining:
            cur.execute(
                "UPDATE exhibits SET state = 'cleared' WHERE id = %s AND state = 'held'",
                (exhibit["id"],),
            )
        ctx.log(
            cur,
            "hold.lifted",
            exhibit["id"],
            {
                "hold_id": hold_id,
                "matter_ref": hold["matter_ref"],
                "reason": reason,
            },
        )
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


def _break_glass_disposal_guard(ctx: Context, exhibit: dict) -> None:
    if ctx.break_glass_grant is None:
        return
    if exhibit["state"] == "held":
        raise ApiError("legal_hold")
    raise ApiError("forbidden", target=ctx.last_path_target())


@route("/api/exhibits/{id}/dispose", ["POST"], json_body=True)
def propose_disposal(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "lead_full")
        _break_glass_disposal_guard(ctx, exhibit)
    ctx.check_step_up()
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        if exhibit["state"] == "held":
            raise ApiError("legal_hold")
        cur.execute(
            """
            SELECT 1 FROM release_items i
            JOIN derivatives d ON d.id = i.derivative_id
            JOIN releases r ON r.id = i.release_id
            WHERE d.exhibit_id = %s AND r.state <> 'withdrawn'
            LIMIT 1
            """,
            (exhibit["id"],),
        )
        if cur.fetchone() is not None:
            raise ApiError("exhibit_in_release")
        require_state(exhibit, "dispose")
        checker = FieldChecker(ctx.body)
        reason = checker.reason()
        checker.done()
        ctx.consume_proof(cur)
        cur.execute(
            """
            UPDATE exhibits SET state = 'disposal proposed', disposal_proposed_by = %s
            WHERE id = %s
            """,
            (ctx.user["id"], exhibit["id"]),
        )
        ctx.log(cur, "disposal.proposed", exhibit["id"], {"reason": reason})
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


@route("/api/exhibits/{id}/dispose/confirm", ["POST"], json_body=True)
def confirm_disposal(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "lead_full")
        _break_glass_disposal_guard(ctx, exhibit)
        if exhibit["disposal_proposed_by"] == ctx.user["id"]:
            raise ApiError("separation_of_duties", target=ctx.last_path_target())
    ctx.check_step_up()
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        if exhibit["state"] == "held":
            raise ApiError("legal_hold")
        require_state(exhibit, "dispose/confirm")
        if not storage.storage_up():
            raise ApiError("storage_unavailable")
        cur.execute(
            "SELECT * FROM derivatives WHERE exhibit_id = %s ORDER BY id",
            (exhibit["id"],),
        )
        derivatives = [dict(row) for row in cur.fetchall()]
        try:
            keys = [exhibit["object_key"]] + [
                row["object_key"] for row in derivatives if row["object_key"]
            ]
            for key in keys:
                if key:
                    storage.delete_object(key)
            for key in keys:
                if key and storage.object_exists(key):
                    raise ApiError("storage_unavailable")
        except storage.StorageDown:
            raise ApiError("storage_unavailable") from None
        ctx.consume_proof(cur)
        cur.execute(
            """
            UPDATE exhibits SET state = 'disposed', object_key = NULL,
                   disposal_proposed_by = NULL
            WHERE id = %s
            """,
            (exhibit["id"],),
        )
        cur.execute(
            "UPDATE derivatives SET disposed = true, object_key = NULL WHERE exhibit_id = %s",
            (exhibit["id"],),
        )
        cur.execute("DELETE FROM redactions WHERE exhibit_id = %s", (exhibit["id"],))
        ctx.log(cur, "exhibit.disposed", exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


@route("/api/exhibits/{id}/dispose/cancel", ["POST"], json_body=True)
def cancel_disposal(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "lead_full")
        _break_glass_disposal_guard(ctx, exhibit)
    ctx.check_step_up()
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        require_state(exhibit, "dispose/cancel")
        checker = FieldChecker(ctx.body)
        reason = checker.reason()
        checker.done()
        ctx.consume_proof(cur)
        cur.execute(
            """
            UPDATE exhibits SET state = 'cleared', disposal_proposed_by = NULL
            WHERE id = %s
            """,
            (exhibit["id"],),
        )
        ctx.log(cur, "disposal.cancelled", exhibit["id"], {"reason": reason})
        cur.execute("SELECT * FROM exhibits WHERE id = %s", (exhibit["id"],))
        return 200, exhibit_view(cur, dict(cur.fetchone()), "full")


def _issue_grant_row(
    cur,
    ctx: Context,
    *,
    kind: str,
    exhibit_id: str,
    derivative_id: str | None,
    page: int | None,
    grant_id: str | None,
) -> str:
    token = auth.new_token()
    cur.execute(
        """
        INSERT INTO download_grants
            (id, token_hash, kind, user_id, session_id, grant_id, exhibit_id,
             derivative_id, page, expires_at, created_at)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        """,
        (
            db.next_id(cur, "DLG", width=8),
            auth.token_digest(token),
            kind,
            ctx.user["id"],
            ctx.session["id"],
            grant_id,
            exhibit_id,
            derivative_id,
            page,
            datetime.now(timezone.utc) + timedelta(seconds=GRANT_SECONDS),
            datetime.now(timezone.utc),
        ),
    )
    return token


@route("/api/exhibits/{id}/preview-grants", ["POST"], json_body=True)
def preview_grant(ctx: Context):
    with db.tx() as cur:
        exhibit, grant = load_exhibit(cur, ctx, "preview")
        if exhibit["state"] not in READABLE_STATES:
            raise ApiError("exhibit_not_cleared", extra={"state": exhibit["state"]})
        if not exhibit["renderable"]:
            raise ApiError("not_previewable")
        if not storage.storage_up():
            raise ApiError("storage_unavailable")
        raw_page = ctx.body.get("page")
        if raw_page is None or isinstance(raw_page, bool) or not isinstance(raw_page, int):
            raise ValidationFailed({"page": REQUIRED})
        if raw_page < 1 or raw_page > (exhibit["page_count"] or 0):
            raise ValidationFailed({"page": PAGE_COPY})
        token = _issue_grant_row(
            cur,
            ctx,
            kind="preview",
            exhibit_id=exhibit["id"],
            derivative_id=None,
            page=raw_page,
            grant_id=grant["id"],
        )
        return 201, {"token": token, "expires_in_seconds": GRANT_SECONDS}


@route("/api/exhibits/{id}/download-grants", ["POST"], json_body=True)
def original_grant(ctx: Context):
    with db.tx() as cur:
        exhibit, grant = load_exhibit(cur, ctx, "download_original")
        if exhibit["state"] not in READABLE_STATES:
            raise ApiError("exhibit_not_cleared", extra={"state": exhibit["state"]})
        token = _issue_grant_row(
            cur,
            ctx,
            kind="file",
            exhibit_id=exhibit["id"],
            derivative_id=None,
            page=None,
            grant_id=grant["id"],
        )
        return 201, {"token": token, "expires_in_seconds": GRANT_SECONDS}


@route("/api/derivatives/{id}", ["GET"])
def read_derivative(ctx: Context):
    with db.tx() as cur:
        derivative, exhibit, _ = load_derivative(cur, ctx, "read")
        return 200, derivative_view(derivative, exhibit["marks_version"])


@route("/api/derivatives/{id}/download-grants", ["POST"], json_body=True)
def derivative_grant(ctx: Context):
    with db.tx() as cur:
        derivative, exhibit, grant = load_derivative(cur, ctx, "read")
        if exhibit["state"] not in READABLE_STATES:
            raise ApiError("exhibit_not_cleared", extra={"state": exhibit["state"]})
        token = _issue_grant_row(
            cur,
            ctx,
            kind="file",
            exhibit_id=exhibit["id"],
            derivative_id=derivative["id"],
            page=None,
            grant_id=grant["id"],
        )
        return 201, {"token": token, "expires_in_seconds": GRANT_SECONDS}


@route("/api/exhibits/{id}/redactions", ["GET"])
def read_redactions(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "redact")
        return 200, {
            "regions": saved_regions(cur, exhibit["id"]),
            "marks_version": exhibit["marks_version"],
        }


@route("/api/exhibits/{id}/redactions", ["PUT"], json_body=True)
def save_redactions(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "redact")
    with db.tx() as cur:
        take_exhibit_lock(cur, exhibit["id"])
        cur.execute("SELECT * FROM exhibits WHERE id = %s FOR UPDATE", (exhibit["id"],))
        exhibit = dict(cur.fetchone())
        if exhibit["state"] not in WRITABLE_STATES:
            raise ApiError("exhibit_not_cleared", extra={"state": exhibit["state"]})
        if not exhibit["renderable"]:
            raise ApiError("not_redactable")
        raw_version = ctx.body.get("marks_version")
        usable = (
            raw_version is not None
            and not isinstance(raw_version, bool)
            and isinstance(raw_version, int)
        )
        if usable and raw_version != exhibit["marks_version"]:
            raise ApiError(
                "stale_marks", extra={"marks_version": exhibit["marks_version"]}
            )
        fields: dict[str, str] = {}
        regions, failure = check_regions(ctx.body.get("regions"), exhibit["page_count"])
        if failure is not None:
            fields["regions"] = failure
        if not usable:
            fields["marks_version"] = REQUIRED
        if fields:
            raise ValidationFailed(fields)
        current = saved_regions(cur, exhibit["id"])
        if _same_regions(current, regions):
            return 200, {
                "regions": current,
                "marks_version": exhibit["marks_version"],
            }
        version = exhibit["marks_version"] + 1
        cur.execute(
            """
            INSERT INTO redactions (exhibit_id, regions) VALUES (%s, %s)
            ON CONFLICT (exhibit_id) DO UPDATE SET regions = EXCLUDED.regions
            """,
            (exhibit["id"], json.dumps(regions)),
        )
        cur.execute(
            "UPDATE exhibits SET marks_version = %s, marks_saved_by = %s WHERE id = %s",
            (version, ctx.user["id"], exhibit["id"]),
        )
        ctx.log(cur, "redaction.saved", exhibit["id"], {"marks_version": version})
        return 200, {"regions": regions, "marks_version": version}


def _same_regions(left: list[dict], right: list[dict]) -> bool:
    def key(region: dict) -> tuple:
        return (region["page"], region["x"], region["y"], region["w"], region["h"])

    return sorted(map(key, left)) == sorted(map(key, right))


@route("/api/exhibits/{id}/redactions/find", ["POST"], json_body=True)
def find_in_exhibit(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "redact")
        if exhibit["state"] not in WRITABLE_STATES:
            raise ApiError("exhibit_not_cleared", extra={"state": exhibit["state"]})
        if not exhibit["renderable"]:
            raise ApiError("not_redactable")
        if not storage.storage_up():
            raise ApiError("storage_unavailable")
        checker = FieldChecker(ctx.body)
        text = checker.free_text("text")
        checker.done()
    try:
        data = storage.read_object(exhibit["object_key"])
    except storage.StorageDown:
        raise ApiError("storage_unavailable") from None
    try:
        matches = media.find_text(
            data, exhibit["sniffed_type"], exhibit["page_count"] or 1, text
        )
    except media.NotRenderable:
        raise ApiError("not_redactable") from None
    return 200, {"matches": matches}


@route("/api/exhibits/{id}/derivatives", ["GET"])
def list_derivatives(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "read")
        cur.execute(
            "SELECT * FROM derivatives WHERE exhibit_id = %s ORDER BY id",
            (exhibit["id"],),
        )
        rows = [dict(row) for row in cur.fetchall()]
        return 200, {
            "derivatives": [
                derivative_view(row, exhibit["marks_version"]) for row in rows
            ]
        }


@route("/api/exhibits/{id}/derivatives", ["POST"], json_body=True)
def render_derivative(ctx: Context):
    with db.tx() as cur:
        exhibit, _ = load_exhibit(cur, ctx, "redact")
        if exhibit["state"] not in WRITABLE_STATES:
            raise ApiError("exhibit_not_cleared", extra={"state": exhibit["state"]})
        if not exhibit["renderable"]:
            raise ApiError("not_redactable")
        if not storage.storage_up():
            raise ApiError("storage_unavailable")
        regions = saved_regions(cur, exhibit["id"])
        marks_version = exhibit["marks_version"]
        marks_saved_by = exhibit["marks_saved_by"]
    try:
        data = storage.read_object(exhibit["object_key"])
    except storage.StorageDown:
        raise ApiError("storage_unavailable") from None
    try:
        payload, content_type = media.render_derivative(
            data, exhibit["sniffed_type"], exhibit["page_count"] or 1, regions
        )
    except media.NotRenderable:
        raise ApiError("not_redactable") from None
    key = storage.object_key("derivatives")
    try:
        storage.put_object(key, payload)
        size, digest = storage.measure_object(key)
    except storage.StorageDown:
        raise ApiError("storage_unavailable") from None
    pages = exhibit["page_count"] if content_type == "application/pdf" else 1
    with db.tx() as cur:
        derivative_id = db.next_id(cur, "DV")
        cur.execute(
            """
            INSERT INTO derivatives
                (id, exhibit_id, compartment_id, sha256, size, content_type, page_count,
                 created_by, marks_version, marks_saved_by, object_key, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                derivative_id,
                exhibit["id"],
                exhibit["compartment_id"],
                digest,
                size,
                content_type,
                pages,
                ctx.user["id"],
                marks_version,
                marks_saved_by,
                key,
                datetime.now(timezone.utc),
            ),
        )
        ctx.log(
            cur,
            "derivative.rendered",
            derivative_id,
            {"exhibit_id": exhibit["id"], "marks_version": marks_version},
        )
        cur.execute("SELECT marks_version FROM exhibits WHERE id = %s", (exhibit["id"],))
        current = cur.fetchone()["marks_version"]
        cur.execute("SELECT * FROM derivatives WHERE id = %s", (derivative_id,))
        return 201, derivative_view(dict(cur.fetchone()), current)


@route("/api/exhibits/{id}/custody", ["GET"])
def read_custody(ctx: Context):
    after, limit = paging(ctx)
    with db.tx() as cur:
        exhibit = load_custody_reader(cur, ctx)
        cur.execute(
            "SELECT id FROM derivatives WHERE exhibit_id = %s", (exhibit["id"],)
        )
        targets = [exhibit["id"]] + [row["id"] for row in cur.fetchall()]
        cur.execute(
            """
            SELECT * FROM ledger_entries
            WHERE (target = ANY(%s) OR detail->>'exhibit_id' = %s) AND seq > %s
            ORDER BY seq LIMIT %s
            """,
            (targets, exhibit["id"], after, limit),
        )
        rows = [dict(row) for row in cur.fetchall()]
        next_after = None
        if rows:
            cur.execute(
                """
                SELECT 1 FROM ledger_entries
                WHERE (target = ANY(%s) OR detail->>'exhibit_id' = %s) AND seq > %s
                LIMIT 1
                """,
                (targets, exhibit["id"], rows[-1]["seq"]),
            )
            if cur.fetchone() is not None:
                next_after = int(rows[-1]["seq"])
    return 200, {
        "entries": [_entry_view(row) for row in rows],
        "next_after": next_after,
    }


def _entry_view(row: dict) -> dict:
    return {
        "seq": int(row["seq"]),
        "at": row["at"],
        "actor_id": row["actor_id"],
        "session_id": row["session_id"],
        "action": row["action"],
        "target": row["target"],
        "detail": row["detail"],
        "prev_digest": row["prev_digest"],
        "digest": row["digest"],
    }
