"""Releases, sign-off, sharing and link collection."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from . import auth, db, ledger, mail, storage
from .access import (
    load_compartment,
    load_release,
    take_exhibit_lock,
    take_release_lock,
)
from .errors import ApiError, ValidationFailed, illegal_transition
from .http import Context, route, target_from_text
from .rules import RELEASE_TRANSITIONS, ROLE_LEAD, WRITABLE_STATES
from .validation import FieldChecker, REQUIRED, trim
from .views import format_time, manifest_digest, release_items, release_view

GRANT_SECONDS = 60
LINK_HEADERS = {"Referrer-Policy": "no-referrer", "Cache-Control": "no-store"}
THROTTLE_LIMIT = 10
THROTTLE_WINDOW = 60


@route("/api/reviews", ["GET"])
def review_queue(ctx: Context):
    if ctx.user["role"] != ROLE_LEAD:
        raise ApiError("forbidden")
    with db.tx() as cur:
        cur.execute(
            """
            SELECT r.* FROM releases r
            JOIN grants g ON g.compartment_id = r.compartment_id
            WHERE r.state = 'submitted' AND g.user_id = %s AND g.kind = 'grant'
              AND g.scope = 'full' AND g.state = 'active'
              AND (g.expires_at IS NULL OR g.expires_at > now())
            ORDER BY r.id
            """,
            (ctx.user["id"],),
        )
        rows = [dict(row) for row in cur.fetchall()]
        return 200, {
            "releases": [release_view(cur, row, ctx.user["id"]) for row in rows]
        }


@route("/api/compartments/{id}/releases", ["GET"])
def list_releases(ctx: Context):
    with db.tx() as cur:
        compartment, _ = load_compartment(cur, ctx, "read")
        cur.execute(
            "SELECT * FROM releases WHERE compartment_id = %s ORDER BY id",
            (compartment["id"],),
        )
        rows = [dict(row) for row in cur.fetchall()]
        return 200, {
            "releases": [release_view(cur, row, ctx.user["id"]) for row in rows]
        }


@route("/api/compartments/{id}/releases", ["POST"], json_body=True)
def create_release(ctx: Context):
    with db.tx() as cur:
        compartment, _ = load_compartment(cur, ctx, "assemble")
        checker = FieldChecker(ctx.body)
        name = checker.free_text("name")
        matter_ref = checker.free_text("matter_ref")
        recipient = checker.choice("recipient_kind", ("counsel", "requester"))
        checker.done()
        release_id = db.next_id(cur, "REL")
        cur.execute(
            """
            INSERT INTO releases
                (id, compartment_id, name, matter_ref, recipient_kind, state,
                 assembler_id, created_at)
            VALUES (%s, %s, %s, %s, %s, 'assembling', %s, %s)
            """,
            (
                release_id,
                compartment["id"],
                name,
                matter_ref,
                recipient,
                ctx.user["id"],
                datetime.now(timezone.utc),
            ),
        )
        ctx.log(cur, "release.created", release_id)
        cur.execute("SELECT * FROM releases WHERE id = %s", (release_id,))
        return 201, release_view(cur, dict(cur.fetchone()), ctx.user["id"])


@route("/api/releases/{id}", ["GET"])
def read_release(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "read")
        return 200, release_view(cur, release, ctx.user["id"])


def _add_contributor(cur, release_id: str, user_id: str | None) -> None:
    if user_id is None:
        return
    cur.execute(
        """
        INSERT INTO release_contributors (release_id, user_id) VALUES (%s, %s)
        ON CONFLICT DO NOTHING
        """,
        (release_id, user_id),
    )


@route("/api/releases/{id}/items", ["POST"], json_body=True)
def add_item(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "assemble")
        raw = ctx.body.get("derivative_id")
        derivative = None
        if isinstance(raw, str) and trim(raw) != "":
            cur.execute(
                "SELECT * FROM derivatives WHERE id = %s AND compartment_id = %s",
                (trim(raw), release["compartment_id"]),
            )
            row = cur.fetchone()
            if row is None:
                raise ApiError("not_found", target=target_from_text(trim(raw)))
            derivative = dict(row)
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        if release["state"] != "assembling":
            raise ApiError("release_locked", extra={"state": release["state"]})
        if derivative is not None:
            take_exhibit_lock(cur, derivative["exhibit_id"])
            cur.execute(
                "SELECT * FROM exhibits WHERE id = %s", (derivative["exhibit_id"],)
            )
            exhibit = dict(cur.fetchone())
            if exhibit["state"] not in WRITABLE_STATES:
                raise ApiError(
                    "exhibit_not_cleared", extra={"state": exhibit["state"]}
                )
            if exhibit["marks_version"] > derivative["marks_version"]:
                raise ApiError(
                    "derivative_superseded",
                    extra={"derivative_id": derivative["id"]},
                )
        checker = FieldChecker(ctx.body)
        label = checker.free_text("label")
        if derivative is None:
            checker.fail("derivative_id", REQUIRED)
        checker.done()
        item_id = db.next_id(cur, "ITM")
        cur.execute(
            """
            INSERT INTO release_items (id, release_id, derivative_id, label, created_at)
            VALUES (%s, %s, %s, %s, %s)
            """,
            (
                item_id,
                release["id"],
                derivative["id"],
                label,
                datetime.now(timezone.utc),
            ),
        )
        _add_contributor(cur, release["id"], ctx.user["id"])
        _add_contributor(cur, release["id"], derivative["created_by"])
        _add_contributor(cur, release["id"], derivative["marks_saved_by"])
        ctx.log(
            cur,
            "release.item_added",
            release["id"],
            {
                "item_id": item_id,
                "derivative_id": derivative["id"],
                "exhibit_id": derivative["exhibit_id"],
            },
        )
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 201, release_view(cur, dict(cur.fetchone()), ctx.user["id"])


@route("/api/releases/{id}/items/{item_id}", ["DELETE"])
def remove_item(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "assemble")
        item = ctx.param("item_id")
        row = None
        if item.text is not None:
            cur.execute(
                "SELECT * FROM release_items WHERE id = %s AND release_id = %s",
                (item.text, release["id"]),
            )
            row = cur.fetchone()
        if row is None:
            raise ApiError("not_found", target=item.target)
        stored = dict(row)
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        if release["state"] != "assembling":
            raise ApiError("release_locked", extra={"state": release["state"]})
        cur.execute("DELETE FROM release_items WHERE id = %s", (stored["id"],))
        cur.execute(
            "SELECT exhibit_id FROM derivatives WHERE id = %s",
            (stored["derivative_id"],),
        )
        exhibit_id = cur.fetchone()["exhibit_id"]
        ctx.log(
            cur,
            "release.item_removed",
            release["id"],
            {
                "item_id": stored["id"],
                "derivative_id": stored["derivative_id"],
                "exhibit_id": exhibit_id,
            },
        )
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 200, release_view(cur, dict(cur.fetchone()), ctx.user["id"])


def require_state(release: dict, action: str) -> str:
    """Allows only the published release transitions."""
    expected, result = RELEASE_TRANSITIONS[action]
    if release["state"] != expected:
        raise illegal_transition(release["state"], result)
    return result


def _superseded_item(items: list[dict]) -> dict | None:
    for item in items:
        if item["exhibit_marks"] > item["derivative_marks"]:
            return item
    return None


def _is_worker(cur, release: dict, user_id: str) -> bool:
    if release["assembler_id"] == user_id:
        return True
    cur.execute(
        "SELECT 1 FROM release_contributors WHERE release_id = %s AND user_id = %s",
        (release["id"], user_id),
    )
    return cur.fetchone() is not None


@route("/api/releases/{id}/submit", ["POST"], json_body=True)
def submit_release(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "assemble")
        if not _is_worker(cur, release, ctx.user["id"]):
            raise ApiError("forbidden", target=ctx.last_path_target())
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        require_state(release, "submit")
        items = release_items(cur, release["id"])
        if not items:
            raise ApiError("release_empty")
        stale = _superseded_item(items)
        if stale is not None:
            raise ApiError(
                "derivative_superseded", extra={"derivative_id": stale["derivative_id"]}
            )
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE releases SET state = 'submitted' WHERE id = %s", (release["id"],)
        )
        ctx.log(cur, "release.submitted", release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 200, release_view(cur, dict(cur.fetchone()), ctx.user["id"])


@route("/api/releases/{id}/sign-off", ["POST"], json_body=True)
def sign_off(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "lead_decide")
        if _is_worker(cur, release, ctx.user["id"]):
            raise ApiError("separation_of_duties", target=ctx.last_path_target())
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        require_state(release, "sign-off")
        items = release_items(cur, release["id"])
        current = manifest_digest(items)
        sent = ctx.body.get("manifest_digest")
        usable = isinstance(sent, str) and trim(sent) != ""
        if usable and trim(sent) != current:
            raise ApiError("release_changed", extra={"manifest_digest": current})
        stale = _superseded_item(items)
        if stale is not None:
            raise ApiError(
                "derivative_superseded", extra={"derivative_id": stale["derivative_id"]}
            )
        unopened = _unopened_items(cur, items, ctx.user["id"])
        if unopened:
            raise ApiError("items_unopened", extra={"item_ids": unopened})
        if not usable:
            raise ValidationFailed({"manifest_digest": REQUIRED})
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE releases SET state = 'signed off' WHERE id = %s", (release["id"],)
        )
        ctx.log(
            cur,
            "release.signed_off",
            release["id"],
            {
                "manifest_digest": current,
                "opened_items": [item["id"] for item in items],
            },
        )
        notice = _queue_decision(cur, release, "signed off", ctx.user["name"])
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 200, release_view(cur, dict(cur.fetchone()), ctx.user["id"], notice)


def _unopened_items(cur, items: list[dict], user_id: str) -> list[str]:
    if not items:
        return []
    cur.execute(
        """
        SELECT DISTINCT derivative_id FROM download_grants
        WHERE user_id = %s AND claimed_at IS NOT NULL AND derivative_id = ANY(%s)
        """,
        (user_id, [item["derivative_id"] for item in items]),
    )
    opened = {row["derivative_id"] for row in cur.fetchall()}
    return sorted(
        item["id"] for item in items if item["derivative_id"] not in opened
    )


def _queue_decision(cur, release: dict, decision: str, reviewer_name: str) -> str:
    cur.execute("SELECT email FROM users WHERE id = %s", (release["assembler_id"],))
    email = cur.fetchone()["email"]
    mail.decision_notice(cur, email, release["id"], decision, reviewer_name)
    return mail.notice_state()


@route("/api/releases/{id}/reject", ["POST"], json_body=True)
def reject_release(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "lead_decide")
        if _is_worker(cur, release, ctx.user["id"]):
            raise ApiError("separation_of_duties", target=ctx.last_path_target())
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        require_state(release, "reject")
        checker = FieldChecker(ctx.body)
        reason = checker.reason()
        checker.done()
        ctx.consume_proof(cur)
        cur.execute(
            "UPDATE releases SET state = 'rejected', rejection_reason = %s WHERE id = %s",
            (reason, release["id"]),
        )
        ctx.log(cur, "release.rejected", release["id"], {"reason": reason})
        notice = _queue_decision(cur, release, "rejected", ctx.user["name"])
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 200, release_view(cur, dict(cur.fetchone()), ctx.user["id"], notice)


@route("/api/releases/{id}/reopen", ["POST"], json_body=True)
def reopen_release(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "assemble")
        if release["assembler_id"] != ctx.user["id"]:
            raise ApiError("forbidden", target=ctx.last_path_target())
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        require_state(release, "reopen")
        cur.execute(
            "UPDATE releases SET state = 'assembling' WHERE id = %s", (release["id"],)
        )
        ctx.log(cur, "release.reopened", release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 200, release_view(cur, dict(cur.fetchone()), ctx.user["id"])


def _confirm_objects(cur, release_id: str) -> None:
    """Every derivative must be present in storage at its recorded size."""
    cur.execute(
        """
        SELECT d.object_key, d.size FROM release_items i
        JOIN derivatives d ON d.id = i.derivative_id
        WHERE i.release_id = %s ORDER BY i.id
        """,
        (release_id,),
    )
    rows = [dict(row) for row in cur.fetchall()]
    if not storage.storage_up():
        raise ApiError("storage_unavailable")
    try:
        for row in rows:
            if row["object_key"] is None:
                raise ApiError("derivative_missing")
            size = storage.object_size(row["object_key"])
            if size is None or size != int(row["size"]):
                raise ApiError("derivative_missing")
    except storage.StorageDown:
        raise ApiError("storage_unavailable") from None


def _kill_links(cur, release_id: str, new_state: str = "revoked") -> str | None:
    cur.execute(
        "SELECT id FROM links WHERE release_id = %s AND state = 'active'",
        (release_id,),
    )
    killed = None
    for row in cur.fetchall():
        cur.execute(
            "UPDATE links SET state = %s WHERE id = %s", (new_state, row["id"])
        )
        killed = row["id"]
    return killed


def _issue_link(cur, release_id: str, expires_at: datetime) -> tuple[str, str]:
    token = auth.new_token(32)
    link_id = db.next_id(cur, "LNK")
    cur.execute(
        """
        INSERT INTO links (id, release_id, token_hash, state, expires_at, created_at)
        VALUES (%s, %s, %s, 'active', %s, %s)
        """,
        (
            link_id,
            release_id,
            auth.token_digest(token),
            expires_at,
            datetime.now(timezone.utc),
        ),
    )
    return link_id, token


@route("/api/releases/{id}/share", ["POST"], json_body=True)
def share_release(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "lead_decide")
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        require_state(release, "share")
        items = release_items(cur, release["id"])
        stale = _superseded_item(items)
        if stale is not None:
            raise ApiError(
                "derivative_superseded", extra={"derivative_id": stale["derivative_id"]}
            )
        _confirm_objects(cur, release["id"])
        checker = FieldChecker(ctx.body)
        expires_at = checker.link_expires_at()
        checker.done()
        ctx.consume_proof(cur)
        link_id, token = _issue_link(cur, release["id"], expires_at)
        cur.execute(
            "UPDATE releases SET state = 'shared' WHERE id = %s", (release["id"],)
        )
        ctx.log(cur, "release.shared", release["id"], {"link_id": link_id})
        return 201, {
            "release_id": release["id"],
            "state": "shared",
            "link_id": link_id,
            "token": token,
            "url": f"/l/{token}",
            "expires_at": format_time(expires_at),
        }


@route("/api/releases/{id}/link/revoke", ["POST"], json_body=True)
def revoke_link(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "lead_decide")
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        cur.execute(
            """
            SELECT * FROM links
            WHERE release_id = %s AND state = 'active' AND expires_at > now()
            """,
            (release["id"],),
        )
        link = cur.fetchone()
        if release["state"] != "shared" or link is None:
            raise illegal_transition(release["state"], "shared")
        ctx.consume_proof(cur)
        cur.execute("UPDATE links SET state = 'revoked' WHERE id = %s", (link["id"],))
        ctx.log(cur, "link.revoked", release["id"], {"link_id": link["id"]})
        return 200, {"link_id": link["id"], "state": "revoked"}


@route("/api/releases/{id}/link/regenerate", ["POST"], json_body=True)
def regenerate_link(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "lead_decide")
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        if release["state"] != "shared":
            raise illegal_transition(release["state"], "shared")
        items = release_items(cur, release["id"])
        stale = _superseded_item(items)
        if stale is not None:
            raise ApiError(
                "derivative_superseded", extra={"derivative_id": stale["derivative_id"]}
            )
        _confirm_objects(cur, release["id"])
        checker = FieldChecker(ctx.body)
        expires_at = checker.link_expires_at()
        checker.done()
        ctx.consume_proof(cur)
        _kill_links(cur, release["id"])
        link_id, token = _issue_link(cur, release["id"], expires_at)
        ctx.log(cur, "link.regenerated", release["id"], {"link_id": link_id})
        return 201, {
            "release_id": release["id"],
            "state": "shared",
            "link_id": link_id,
            "token": token,
            "url": f"/l/{token}",
            "expires_at": format_time(expires_at),
        }


@route("/api/releases/{id}/withdraw", ["POST"], json_body=True)
def withdraw_release(ctx: Context):
    with db.tx() as cur:
        release, _ = load_release(cur, ctx, "lead_decide")
    ctx.check_step_up()
    with db.tx() as cur:
        take_release_lock(cur, release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s FOR UPDATE", (release["id"],))
        release = dict(cur.fetchone())
        require_state(release, "withdraw")
        ctx.consume_proof(cur)
        _kill_links(cur, release["id"], "withdrawn")
        cur.execute(
            "UPDATE releases SET state = 'withdrawn' WHERE id = %s", (release["id"],)
        )
        ctx.log(cur, "release.withdrawn", release["id"])
        cur.execute("SELECT * FROM releases WHERE id = %s", (release["id"],))
        return 200, release_view(cur, dict(cur.fetchone()), ctx.user["id"])


def live_link(cur, token: str | None) -> dict | None:
    if token is None:
        return None
    cur.execute(
        """
        SELECT * FROM links
        WHERE token_hash = %s AND state = 'active' AND expires_at > now()
        """,
        (auth.token_digest(token),),
    )
    row = cur.fetchone()
    return dict(row) if row else None


@route("/api/links/{token}", ["GET"], auth_required=False, denials=False)
def read_link(ctx: Context):
    with db.tx() as cur:
        link = live_link(cur, ctx.id_of("token"))
        if link is None:
            raise ApiError("not_found", headers=dict(LINK_HEADERS))
        cur.execute("SELECT * FROM releases WHERE id = %s", (link["release_id"],))
        release = dict(cur.fetchone())
        items = release_items(cur, release["id"])
        body = {
            "reference": release["id"],
            "name": release["name"],
            "matter_ref": release["matter_ref"],
            "recipient_kind": release["recipient_kind"],
            "manifest_digest": manifest_digest(items),
            "items": [
                {
                    "id": item["id"],
                    "label": item["label"],
                    "sha256": item["sha256"],
                    "size": int(item["size"]),
                }
                for item in items
            ],
        }
    return 200, body, dict(LINK_HEADERS)


@route(
    "/api/links/{token}/items/{item_id}/grant",
    ["POST"],
    auth_required=False,
    json_body=True,
    denials=False,
)
def collect_grant(ctx: Context):
    with db.tx() as cur:
        link = live_link(cur, ctx.id_of("token"))
        if link is None:
            raise ApiError("not_found", headers=dict(LINK_HEADERS))
        item = ctx.param("item_id")
        row = None
        if item.text is not None:
            cur.execute(
                """
                SELECT i.*, d.object_key FROM release_items i
                JOIN derivatives d ON d.id = i.derivative_id
                WHERE i.id = %s AND i.release_id = %s
                """,
                (item.text, link["release_id"]),
            )
            row = cur.fetchone()
        if row is None:
            raise ApiError("not_found", headers=dict(LINK_HEADERS))
        stored = dict(row)
        db.take_lock(cur, db.LOCK_LINK, link["id"])
        now = datetime.now(timezone.utc)
        window_start = now - timedelta(seconds=THROTTLE_WINDOW)
        cur.execute(
            "SELECT count(*) AS n, min(at) AS oldest FROM collection_events WHERE link_id = %s AND at > %s",
            (link["id"], window_start),
        )
        counted = cur.fetchone()
        if counted["n"] >= THROTTLE_LIMIT:
            wait = max(
                1,
                min(
                    THROTTLE_WINDOW,
                    int(
                        THROTTLE_WINDOW
                        - (now - counted["oldest"]).total_seconds()
                        + 1
                    ),
                ),
            )
            if counted["n"] == THROTTLE_LIMIT:
                ledger.append(
                    cur,
                    action="collection.throttled",
                    actor_id=f"link:{link['id']}",
                    session_id=None,
                    target=link["id"],
                    detail={"release_id": link["release_id"]},
                )
                ledger.raise_signal(cur, "bulk_collection", link["id"])
            cur.execute(
                "INSERT INTO collection_events (link_id, at) VALUES (%s, %s)",
                (link["id"], now),
            )
            raise ApiError(
                "throttled",
                headers={"Retry-After": str(wait), **LINK_HEADERS},
            )
        if not storage.storage_up():
            raise ApiError("storage_unavailable", headers=dict(LINK_HEADERS))
        cur.execute(
            "INSERT INTO collection_events (link_id, at) VALUES (%s, %s)",
            (link["id"], now),
        )
        cur.execute(
            "SELECT exhibit_id FROM derivatives WHERE id = %s",
            (stored["derivative_id"],),
        )
        exhibit_id = cur.fetchone()["exhibit_id"]
        token = auth.new_token()
        cur.execute(
            """
            INSERT INTO download_grants
                (id, token_hash, kind, link_id, exhibit_id, derivative_id,
                 expires_at, created_at)
            VALUES (%s, %s, 'file', %s, %s, %s, %s, %s)
            """,
            (
                db.next_id(cur, "DLG", width=8),
                auth.token_digest(token),
                link["id"],
                exhibit_id,
                stored["derivative_id"],
                now + timedelta(seconds=GRANT_SECONDS),
                now,
            ),
        )
    return (
        201,
        {"token": token, "expires_in_seconds": GRANT_SECONDS},
        dict(LINK_HEADERS),
    )
