"""Running allocation, posting its movements and keeping the grid factors."""

from __future__ import annotations

from datetime import datetime

from . import clock, store
from .config import CONFIG
from .db import Cursor
from .domain import allocation, lots as lot_rules, residual, review, states
from .domain.model import REJECTED, UNSUBMITTED, WindowRecord
from .domain.scores import Figures
from .errors import REVIEW_TIMEOUT_COPY
from .services import gridfeed
from .services.http import ProviderUnavailable


def figures(window: WindowRecord, now: datetime | None = None) -> Figures:
    return Figures(window, now or clock.now())


def recompute(
    cursor: Cursor, window: WindowRecord, as_of: datetime | None = None
) -> None:
    """Run allocation and post the movements its changes make."""
    now = as_of or clock.now()
    planned = allocation.allocate(window, now)
    _apply_lines(cursor, window, planned)
    ensure_factors(cursor, window)


def _apply_lines(cursor: Cursor, window: WindowRecord, planned: list) -> None:
    standing = {
        line.line_id: line for line in window.lines if line.status == UNSUBMITTED
    }
    desired = {line.line_id: line for line in planned if line.status == UNSUBMITTED}
    removed = [
        line
        for line_id, line in standing.items()
        if line_id not in desired or desired[line_id].wh != line.wh
    ]
    added = [
        line
        for line_id, line in desired.items()
        if line_id not in standing or standing[line_id].wh != line.wh
    ]
    if not removed and not added:
        return
    for line in removed:
        store.delete_line(cursor, line.line_id)
        store.movement(
            cursor,
            "return",
            "allocated",
            "holdings",
            line.wh,
            window.id,
            line.lot_id,
            line.bundle_id,
            line.line_id,
        )
    for line in added:
        store.insert_line(cursor, window.id, line)
        store.movement(
            cursor,
            "allocate",
            "holdings",
            "allocated",
            line.wh,
            window.id,
            line.lot_id,
            line.bundle_id,
            line.line_id,
        )
    window.lines = planned + [
        line for line in window.lines if line.status == REJECTED
    ]
    _apply_battery_loss(cursor, window)


def _apply_battery_loss(cursor: Cursor, window: WindowRecord) -> None:
    """A battery bundle posts its round-trip loss exactly while it carries a line."""
    standing = store.bundle_loss_standing(cursor, window.id)
    carrying = {line.bundle_id for line in window.lines if line.status != REJECTED}
    for bundle in window.bundles:
        if not bundle.battery_shifted:
            continue
        loss = lot_rules.loss_wh(bundle)
        if loss == 0:
            continue
        has_line = bundle.bundle_id in carrying
        if has_line and bundle.bundle_id not in standing:
            store.movement(
                cursor,
                "battery_loss",
                "holdings",
                "loss",
                loss,
                window.id,
                bundle.lot_id,
                bundle.bundle_id,
            )
        elif not has_line and bundle.bundle_id in standing:
            store.movement(
                cursor,
                "return",
                "loss",
                "holdings",
                loss,
                window.id,
                bundle.lot_id,
                bundle.bundle_id,
            )


def ensure_factors(cursor: Cursor, window: WindowRecord) -> None:
    """Fetch the grid factors this window still lacks; a late feed changes no score."""
    hours = [hour.hour_utc for hour in window.hours]
    if not hours:
        return
    stored = store.stored_factors(cursor, window.site.zone, hours)
    wanted = {hour_utc for hour_utc in hours if hour_utc not in stored}
    if not wanted:
        return
    try:
        found = gridfeed.factors(
            window.site.zone, window.start_utc, window.end_utc, wanted
        )
    except ProviderUnavailable:
        return
    store.save_factors(cursor, window.site.zone, found)


def residual_grams(cursor: Cursor, window: WindowRecord, figs: Figures) -> int | None:
    unmatched = {
        hour.hour_utc: hour.consumed_wh - hour.matched_wh
        for hour in figs.hours
        if hour.known and hour.consumed_wh > hour.matched_wh
    }
    if not unmatched:
        return 0
    factors = store.stored_factors(
        cursor, window.site.zone, [hour.hour_utc for hour in figs.hours]
    )
    return residual.grams(unmatched, factors)


def review_deadline(window: WindowRecord) -> datetime | None:
    if window.submitted_at is None:
        return None
    return review.deadline(
        window.submitted_at, CONFIG.review_seconds, window.lots, window.lines
    )


def normalize_state(cursor: Cursor, window: WindowRecord) -> None:
    """Apply the transitions the server's clock alone decides."""
    if window.state != states.IN_REVIEW:
        return
    deadline = review_deadline(window)
    if deadline is None or clock.now() < deadline:
        return
    locked = cursor.one(
        "SELECT state FROM windows WHERE id = %s FOR UPDATE", (window.id,)
    )
    if locked is None or locked["state"] != states.IN_REVIEW:
        fresh = store.load_window(cursor, window.id)
        if fresh is not None:
            window.state = fresh.state
            window.revision = fresh.revision
            window.returned_reason = fresh.returned_reason
        return
    store.set_state(cursor, window, states.RETURNED)
    store.set_field(cursor, window, "returned_reason", REVIEW_TIMEOUT_COPY)
    store.bump_revision(cursor, window, None)
