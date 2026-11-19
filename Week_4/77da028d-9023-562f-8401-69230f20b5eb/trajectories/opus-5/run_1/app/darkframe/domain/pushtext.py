"""Push titles and messages. Exact coordinates and notes never appear."""

from __future__ import annotations

from datetime import date

from . import rounding

NTFY_TAG = "telescope"
REMINDER_TITLE = "Darkframe: new-moon weekend"


def _site_line(label: str, latitude: float, longitude: float) -> str:
    return (
        f"{label} near {rounding.share_grid_text(latitude)}, "
        f"{rounding.share_grid_text(longitude)}"
    )


def go_push(
    observing_date: date,
    label: str,
    latitude: float,
    longitude: float,
    target_name: str,
    filter_name: str,
    window_start: str,
    window_end: str,
    usable_minutes: int,
) -> tuple[str, str]:
    return (
        f"Darkframe: go for {observing_date.isoformat()}",
        f"{_site_line(label, latitude, longitude)}: {target_name} in {filter_name}, "
        f"clear window {window_start}-{window_end}, {usable_minutes} usable minutes.",
    )


def no_go_push(
    observing_date: date, label: str, latitude: float, longitude: float
) -> tuple[str, str]:
    return (
        f"Darkframe: no-go for {observing_date.isoformat()}",
        f"{_site_line(label, latitude, longitude)}: no clear window of 60 minutes.",
    )


def reminder_push(
    new_moon_local_date: date, label: str, weekend_saturday: date
) -> tuple[str, str]:
    return (
        REMINDER_TITLE,
        f"New Moon {new_moon_local_date.isoformat()}. Dark weekend from {label} "
        f"starts Saturday {weekend_saturday.isoformat()}.",
    )
