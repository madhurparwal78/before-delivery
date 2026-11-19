"""The verifier's review, the registry cancellations and the signature."""

from __future__ import annotations

from typing import Any

from flask import Blueprint, Response

from .. import clock, db, engine, sealing, store, views
from ..db import Cursor
from ..domain import states
from ..domain.model import PENDING, REJECTED, UNSUBMITTED, WindowRecord
from ..domain.review import missing_results
from ..errors import (
    ApiError,
    field_error,
    lot_expired,
    not_found,
    registry_unavailable,
    sample_incomplete,
    store_unavailable,
    wrong_state,
)
from ..services import objectstore, registry
from ..services.http import ProviderUnavailable
from . import (
    ANALYST,
    VERIFIER,
    Account,
    envelope,
    read_body,
    readable_window,
    require_account,
    require_role,
    require_state,
    text_field,
)

review = Blueprint("review", __name__)

NOTE_LIMIT = 2000
RESULTS = ("agree", "exception")


def _reload(cursor: Cursor, window_id: str) -> WindowRecord:
    window = store.load_window(cursor, window_id)
    assert window is not None
    return window


def _assigned_verifier(
    cursor: Cursor, window_id: str, action: str
) -> tuple[Account, WindowRecord]:
    account = require_account(cursor)
    window = readable_window(cursor, account, window_id, lock=True)
    require_role(account, VERIFIER)
    require_state(window, action)
    return account, window


@review.get("/windows/<window_id>/sample")
def read_sample(window_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        rows = store.sample_rows(cursor, window.id)
        if not rows:
            raise wrong_state(window.state)
        figs = engine.figures(window)
        matched = {hour.hour_utc: hour.matched_wh for hour in figs.hours}
        consumed = {hour.hour_utc: hour.consumed_wh for hour in window.hours}
        quality = {hour.hour_utc: hour.quality for hour in window.hours}
        return envelope(
            {
                "allocation_digest": rows[0]["allocation_digest"],
                "hours": [
                    {
                        "hour_utc": clock.hour(row["hour_utc"]),
                        "consumed_wh": consumed.get(row["hour_utc"]),
                        "matched_wh": matched.get(row["hour_utc"], 0),
                        "quality": quality.get(row["hour_utc"]),
                        "lines": views.lines_json(
                            window,
                            [
                                line
                                for line in window.lines
                                if line.hour_utc == row["hour_utc"]
                                and line.status != REJECTED
                            ],
                        ),
                        "result": row["result"],
                        "note": row["note"],
                    }
                    for row in rows
                ],
            }
        )


@review.put("/windows/<window_id>/sample/<hour>")
def record_result(window_id: str, hour: str):
    body = read_body()
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id, lock=True)
        try:
            hour_utc = clock.parse_hour(hour)
        except ValueError:
            raise not_found() from None
        drawn = [row["hour_utc"] for row in store.sample_rows(cursor, window.id)]
        if hour_utc not in drawn:
            raise not_found()
        require_role(account, VERIFIER)
        require_state(window, "sample_result")
        result = body.get("result")
        if result not in RESULTS:
            raise field_error("result")
        note = body.get("note")
        if result == "exception":
            note = text_field(body, "note", NOTE_LIMIT)
        elif note is not None:
            note = text_field(body, "note", NOTE_LIMIT)
        cursor.execute(
            "UPDATE sample_hours SET result = %s, note = %s"
            " WHERE window_id = %s AND hour_utc = %s",
            (result, note, window.id, hour_utc),
        )
        return envelope(
            {"hour_utc": clock.hour(hour_utc), "result": result, "note": note}
        )


@review.post("/windows/<window_id>/review/return")
def return_window(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _assigned_verifier(cursor, window_id, "return")
        reason = text_field(body, "reason", 500)
        store.set_field(cursor, window, "returned_reason", reason)
        store.set_state(cursor, window, states.RETURNED)
        store.bump_revision(cursor, window, account.name)
        return envelope(views.window_json(cursor, _reload(cursor, window_id)))


@review.post("/windows/<window_id>/review/complete")
def complete_review(window_id: str):
    with db.tx() as cursor:
        account, window = _assigned_verifier(cursor, window_id, "complete")
        rows = store.sample_rows(cursor, window.id)
        outstanding = missing_results([row["result"] for row in rows])
        if outstanding > 0:
            raise sample_incomplete(outstanding)
        open_lines = [
            line
            for line in window.lines
            if line.status in (UNSUBMITTED, PENDING)
        ]
        store.set_state(cursor, window, states.after_complete(bool(open_lines)))
        store.bump_revision(cursor, window, account.name)
        return envelope(views.window_json(cursor, _reload(cursor, window_id)))


@review.get("/windows/<window_id>/cancellations")
def read_cancellations(window_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        return envelope({"lines": views.lines_json(window, store.live_lines(window))})


@review.post("/windows/<window_id>/cancellations")
def submit_cancellations(window_id: str):
    failure: ApiError | None = None
    body: dict[str, Any] = {}
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id, lock=True)
        require_role(account, ANALYST)
        require_state(window, "cancellations")
        now = clock.now()
        expiring = [
            line
            for line in window.lines
            if line.status == UNSUBMITTED
            and any(
                lot.lot_id == line.lot_id and now >= lot.cancel_by
                for lot in window.lots
            )
        ]
        if expiring:
            store.set_state(cursor, window, states.RECONCILING)
            store.bump_revision(cursor, window, account.name)
            engine.recompute(cursor, _reload(cursor, window_id))
            failure = lot_expired()
        else:
            submitted, rejected, unreachable = _send_lines(cursor, window)
            if rejected:
                fresh = _reload(cursor, window_id)
                store.set_state(cursor, fresh, states.after_rejected_line(fresh.state))
                store.bump_revision(cursor, fresh, None)
                engine.recompute(cursor, _reload(cursor, window_id))
            if unreachable:
                failure = registry_unavailable()
            else:
                fresh = _reload(cursor, window_id)
                body = {
                    "submitted": submitted,
                    "lines": views.lines_json(fresh, store.live_lines(fresh)),
                    "window": views.window_json(cursor, fresh),
                }
    if failure is not None:
        raise failure
    return envelope(body)


def _send_lines(cursor: Cursor, window: WindowRecord) -> tuple[int, int, bool]:
    """One registry request per Unsubmitted line, in hour order."""
    pending = sorted(
        (line for line in window.lines if line.status == UNSUBMITTED),
        key=lambda line: (line.hour_utc, line.bundle_id),
    )
    submitted = 0
    rejected = 0
    for line in pending:
        try:
            result = registry.submit_cancellation(
                line_id=line.line_id,
                bundle_id=line.bundle_id,
                range_start_wh=line.range_start_wh,
                range_end_wh=line.range_end_wh,
                hour_utc=clock.hour(line.hour_utc),
                beneficiary=window.site.name,
            )
        except ProviderUnavailable:
            store.set_field(cursor, window, "registry_reachable", False)
            return submitted, rejected, True
        store.set_field(cursor, window, "registry_reachable", True)
        submitted += 1
        if result.outcome == registry.REJECTED:
            rejected += 1
            store.set_line_status(
                cursor, line.line_id, REJECTED, reason=result.reason
            )
            line.status = REJECTED
        else:
            store.set_line_status(
                cursor, line.line_id, PENDING, submitted_at=clock.now()
            )
            line.status = PENDING
    return submitted, rejected, False


@review.post("/windows/<window_id>/sign")
def sign_attestation(window_id: str):
    body = read_body()
    with db.tx() as cursor:
        account, window = _assigned_verifier(cursor, window_id, "sign")
        typed_name = body.get("typed_name")
        if not isinstance(typed_name, str) or typed_name != account.name:
            raise field_error("typed_name")
        code = sealing.sign_window(cursor, window, account.id, typed_name)
        seal_status = sealing.advance_seal(cursor, window)
        fresh = _reload(cursor, window_id)
        window_body = views.window_json(cursor, fresh)
    if seal_status == sealing.SEALED:
        return envelope(
            {
                "window": window_body,
                "statement_code": code,
                "landing_url": f"/check/{code}",
            }
        )
    return envelope(
        {
            "window": window_body,
            "statement_code": code,
            "message": sealing.HELD_COPY[seal_status],
        },
        202,
    )


@review.get("/windows/<window_id>/attestation.pdf")
def read_attestation(window_id: str):
    with db.tx() as cursor:
        account = require_account(cursor)
        window = readable_window(cursor, account, window_id)
        if window.state not in (states.SEALED, states.RESTATED):
            raise wrong_state(window.state)
        record = store.signature_for(cursor, window.id)
        assert record is not None
        key = record["pdf_object_key"]
    return _streamed(key)


def _streamed(object_key: str) -> Response:
    try:
        data = objectstore.get(object_key)
    except ProviderUnavailable:
        raise store_unavailable() from None
    return Response(data, content_type="application/pdf")
