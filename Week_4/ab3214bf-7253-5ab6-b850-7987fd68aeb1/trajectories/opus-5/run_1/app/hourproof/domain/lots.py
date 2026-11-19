"""Lot status, cancel-by instants and what a bundle can deliver."""

from __future__ import annotations

from datetime import datetime, timezone

from .model import CONFIRMED, PENDING, Bundle, Line, Lot

BATTERY_ROUND_TRIP_PERCENT = 88

OUT_OF_ZONE = "Out of zone"
LOT_CANCELLED = "Cancelled"
EXPIRED = "Expired"
EXCLUDED = "Excluded"
LOT_CANCELLING = "Cancelling"
AVAILABLE = "Available"


def cancel_by(production_month: str) -> datetime:
    """The first UTC instant of the fourth calendar month after the production month."""
    year, month = int(production_month[0:4]), int(production_month[5:7])
    total = (year * 12 + month - 1) + 4
    return datetime(total // 12, total % 12 + 1, 1, tzinfo=timezone.utc)


def available_wh(bundle: Bundle) -> int:
    """The watt-hours a bundle can deliver, after any round-trip loss."""
    if bundle.battery_shifted:
        return bundle.gross_wh * BATTERY_ROUND_TRIP_PERCENT // 100
    return bundle.gross_wh


def loss_wh(bundle: Bundle) -> int:
    return bundle.gross_wh - available_wh(bundle)


def delivery_hour(bundle: Bundle) -> datetime | None:
    """A battery bundle delivers on its discharge hour, every other on production."""
    if not bundle.battery_shifted:
        return bundle.production_hour
    if bundle.discharge_hour is None or bundle.discharge_hour <= bundle.production_hour:
        return None
    return bundle.discharge_hour


def status_of(lot: Lot, site_zone: str, lines: list[Line], now: datetime) -> str:
    own = [line for line in lines if line.lot_id == lot.lot_id]
    if lot.zone != site_zone:
        return OUT_OF_ZONE
    if own and all(line.status == CONFIRMED for line in own):
        return LOT_CANCELLED
    if now >= lot.cancel_by:
        return EXPIRED
    if lot.excluded:
        return EXCLUDED
    if any(line.status == PENDING for line in own):
        return LOT_CANCELLING
    return AVAILABLE


def takes_new_draws(lot: Lot, site_zone: str, now: datetime) -> bool:
    """A lot draws new watt-hours only in zone, not excluded and before cancel-by."""
    return lot.zone == site_zone and not lot.excluded and now < lot.cancel_by


def free_watt_hours_count(status: str) -> bool:
    """An Expired or Excluded lot keeps only the watt-hours that carry a line."""
    return status not in (OUT_OF_ZONE, EXPIRED, EXCLUDED)
