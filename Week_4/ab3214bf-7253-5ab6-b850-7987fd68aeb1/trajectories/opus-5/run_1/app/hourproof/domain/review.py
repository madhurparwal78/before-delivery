"""The review window: when it closes and when it is complete."""

from __future__ import annotations

from datetime import datetime, timedelta

from .model import UNSUBMITTED, Line, Lot
from .sample import SAMPLE_SIZE


def deadline(
    submitted_at: datetime, review_seconds: int, lots: list[Lot], lines: list[Line]
) -> datetime:
    """The earlier of the review period's end and the earliest cancel-by in play."""
    latest = submitted_at + timedelta(seconds=review_seconds)
    holding = {line.lot_id for line in lines if line.status == UNSUBMITTED}
    cancel_bys = [lot.cancel_by for lot in lots if lot.lot_id in holding]
    if cancel_bys:
        latest = min(latest, min(cancel_bys))
    return latest


def missing_results(results: list[str | None]) -> int:
    return SAMPLE_SIZE - sum(1 for result in results if result is not None)
