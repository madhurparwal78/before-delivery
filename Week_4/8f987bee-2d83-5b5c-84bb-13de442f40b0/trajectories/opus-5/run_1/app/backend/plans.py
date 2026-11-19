"""Plans and the minimum schedule interval each one allows."""

from __future__ import annotations

from .cron import Cron, smallest_minute_gap

PLANS: tuple[str, ...] = ("starter", "team", "scale", "private")

MIN_INTERVAL_MINUTES: dict[str, int] = {
    "starter": 60,
    "team": 15,
    "scale": 5,
    "private": 5,
}


def min_interval_minutes(plan: str) -> int:
    return MIN_INTERVAL_MINUTES[plan]


def interval_allowed(plan: str, interval_minutes: int) -> bool:
    return interval_minutes >= min_interval_minutes(plan)


def cron_allowed(plan: str, cron: Cron) -> bool:
    return smallest_minute_gap(cron) >= min_interval_minutes(plan)
