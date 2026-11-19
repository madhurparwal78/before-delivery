"""Scores, grains and residual emissions, computed on every read from hours, lots, bundles and lines."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime

from .allocation import Allocation
from .timeutil import HOUR, local_of, week_start

GRAINS = ("month", "week", "day", "hour")
GRAM_SCALE = 10_000
MILLI = 1000


def round_half_up(numerator: int, denominator: int) -> int:
    return (2 * numerator + denominator) // (2 * denominator)


@dataclass(frozen=True, slots=True)
class Bucket:
    key: str
    start: datetime
    end: datetime
    consumed: int
    eligible: int
    quality: str | None

    @property
    def matched(self) -> int:
        return min(self.consumed, self.eligible)

    @property
    def surplus(self) -> int:
        return self.eligible - self.matched

    @property
    def unmatched(self) -> int:
        return self.consumed - self.matched


@dataclass(slots=True)
class Fall:
    parent_key: str
    detached: int


def matched_bp(matched: int, consumed: int) -> int:
    """The score rule: matched over consumed in basis points, rounded half up, and 0 with no consumption."""
    return round_half_up(matched * 10000, consumed) if consumed else 0


def score_bp(buckets: list[Bucket]) -> int:
    return matched_bp(sum(bucket.matched for bucket in buckets), sum(bucket.consumed for bucket in buckets))


class Grains:
    """The four grains of one window, built once from the hourly figures."""

    def __init__(
        self,
        zone: str,
        hours: list[datetime],
        consumed: dict[datetime, int],
        qualities: dict[datetime, str],
        allocation: Allocation,
    ) -> None:
        self.zone = zone
        self.hours = hours
        self.first_day = local_of(hours[0], zone).date() if hours else date.min
        self.month_key = f"{local_of(hours[0], zone):%Y-%m}" if hours else ""
        self.by_grain: dict[str, list[Bucket]] = {
            "hour": [
                Bucket(
                    hour.strftime("%Y-%m-%dT%H:00:00Z"),
                    hour,
                    hour + HOUR,
                    consumed.get(hour, 0),
                    allocation.eligible.get(hour, 0),
                    qualities[hour],
                )
                for hour in hours
            ]
        }
        for grain in ("day", "week", "month"):
            self.by_grain[grain] = self._group(grain, self.by_grain["hour"])

    def _key(self, grain: str, bucket: Bucket) -> str:
        day = local_of(bucket.start, self.zone).date()
        if grain == "month":
            return self.month_key
        if grain == "day":
            return day.isoformat()
        return max(week_start(day), self.first_day).isoformat()

    def _group(self, grain: str, hourly: list[Bucket]) -> list[Bucket]:
        groups: dict[str, list[Bucket]] = {}
        for bucket in hourly:
            groups.setdefault(self._key(grain, bucket), []).append(bucket)
        return [
            Bucket(
                key,
                members[0].start,
                members[-1].end,
                sum(m.consumed for m in members),
                sum(m.eligible for m in members),
                None,
            )
            for key, members in groups.items()
        ]

    def score(self, grain: str) -> int:
        return score_bp(self.by_grain[grain])

    def scores(self) -> dict[str, int]:
        return {f"{grain}_bp": self.score(grain) for grain in GRAINS}

    def _parent_key(self, grain: str, bucket: Bucket) -> str:
        return self._key(GRAINS[GRAINS.index(grain) - 1], bucket)

    def falls(self, grain: str) -> list[Fall]:
        if grain == "month":
            return []
        coarser = GRAINS[GRAINS.index(grain) - 1]
        children: dict[str, int] = {}
        for bucket in self.by_grain[grain]:
            key = self._parent_key(grain, bucket)
            children[key] = children.get(key, 0) + bucket.matched
        return [Fall(parent.key, parent.matched - children.get(parent.key, 0)) for parent in self.by_grain[coarser]]

    def worst(self, grain: str) -> dict[str, list[Bucket]]:
        """For each bucket below HOUR, its three worst finer buckets by unmatched watt-hours."""
        finer = GRAINS[GRAINS.index(grain) + 1]
        grouped: dict[str, list[Bucket]] = {bucket.key: [] for bucket in self.by_grain[grain]}
        for bucket in self.by_grain[finer]:
            if bucket.unmatched > 0:
                grouped[self._parent_key(finer, bucket)].append(bucket)
        return {key: sorted(members, key=lambda b: (-b.unmatched, b.key))[:3] for key, members in grouped.items()}


def residual_emissions(buckets: list[Bucket], factors: dict[datetime, int]) -> int | None:
    """Whole grams over the unmatched hours, rounded per hour; None while any unmatched hour lacks a factor."""
    total = 0
    for bucket in buckets:
        if bucket.consumed > bucket.matched:
            factor = factors.get(bucket.start)
            if factor is None:
                return None
            total += round_half_up(bucket.unmatched * factor, GRAM_SCALE * MILLI)
    return total


def parse_factor(text: str) -> int | None:
    """A decimal grams-per-kWh string of up to four places as an integer of ten-thousandths."""
    whole, _, fraction = text.partition(".")
    if not whole.isdigit() or len(fraction) > 4 or (fraction and not fraction.isdigit()):
        return None
    return int(whole) * GRAM_SCALE + int(fraction.ljust(4, "0") or "0")
