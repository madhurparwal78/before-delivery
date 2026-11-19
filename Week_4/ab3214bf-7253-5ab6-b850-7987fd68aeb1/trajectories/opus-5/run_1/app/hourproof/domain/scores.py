"""The four grain scores, their buckets, falls and worst finer buckets."""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta

from . import timeline
from .allocation import eligible_by_hour
from .model import ACTUAL, MISSING, WindowRecord
from .numbers import basis_points

MONTH = "month"
WEEK = "week"
DAY = "day"
HOUR = "hour"
GRAINS = (MONTH, WEEK, DAY, HOUR)
COARSER = {HOUR: DAY, DAY: WEEK, WEEK: MONTH}
FINER = {MONTH: WEEK, WEEK: DAY, DAY: HOUR}


@dataclass
class Bucket:
    key: str
    start_utc: datetime
    end_utc: datetime
    consumed_wh: int = 0
    eligible_wh: int = 0
    quality: str | None = None
    hours: list[datetime] = field(default_factory=list)

    @property
    def matched_wh(self) -> int:
        return min(self.consumed_wh, self.eligible_wh)

    @property
    def surplus_wh(self) -> int:
        return self.eligible_wh - self.matched_wh


@dataclass
class HourFigure:
    hour_utc: datetime
    consumed_wh: int
    eligible_wh: int
    quality: str
    known: bool

    @property
    def matched_wh(self) -> int:
        return min(self.consumed_wh, self.eligible_wh)


class Figures:
    """Every grain's buckets for one window, computed from its hours and bundles."""

    def __init__(self, window: WindowRecord, now: datetime) -> None:
        self.window = window
        eligible = eligible_by_hour(window, now)
        self.hours = [
            HourFigure(
                hour_utc=hour.hour_utc,
                consumed_wh=hour.consumed_wh or 0,
                eligible_wh=eligible.get(hour.hour_utc, 0),
                quality=hour.quality,
                known=hour.quality != MISSING,
            )
            for hour in sorted(window.hours, key=lambda hour: hour.hour_utc)
        ]
        self._buckets: dict[str, list[Bucket]] = {}

    @property
    def consumed_wh(self) -> int:
        return sum(hour.consumed_wh for hour in self.hours)

    @property
    def hour_matched_wh(self) -> int:
        return sum(hour.matched_wh for hour in self.hours)

    @property
    def unmatched_wh(self) -> int:
        return self.consumed_wh - self.hour_matched_wh

    @property
    def unmatched_hours(self) -> int:
        return sum(
            1 for hour in self.hours if hour.known and hour.consumed_wh > hour.matched_wh
        )

    @property
    def missing_hours(self) -> int:
        return sum(1 for hour in self.hours if hour.quality == MISSING)

    @property
    def non_actual_bp(self) -> int:
        non_actual = sum(
            hour.consumed_wh for hour in self.hours if hour.quality != ACTUAL
        )
        return basis_points(non_actual, self.consumed_wh)

    def buckets(self, grain: str) -> list[Bucket]:
        if grain not in self._buckets:
            self._buckets[grain] = self._build(grain)
        return self._buckets[grain]

    def score_bp(self, grain: str) -> int:
        matched = sum(bucket.matched_wh for bucket in self.buckets(grain))
        return basis_points(matched, self.consumed_wh)

    def scores(self) -> dict[str, int]:
        return {f"{grain}_bp": self.score_bp(grain) for grain in GRAINS}

    def falls(self, grain: str) -> list[tuple[str, int]]:
        """Each parent bucket's matched watt-hours less its children's."""
        if grain == MONTH:
            return []
        coarser = COARSER[grain]
        parent_of = self._parent_keys(grain, coarser)
        child_matched: dict[str, int] = {}
        for child in self.buckets(grain):
            parent = parent_of[child.key]
            child_matched[parent] = child_matched.get(parent, 0) + child.matched_wh
        return [
            (parent.key, parent.matched_wh - child_matched.get(parent.key, 0))
            for parent in self.buckets(coarser)
        ]

    def worst(self, grain: str, bucket: Bucket) -> list[tuple[str, int]]:
        """Up to three of the next finer buckets inside this one, worst first."""
        if grain == HOUR:
            return []
        finer = FINER[grain]
        parent_of = self._parent_keys(finer, grain)
        ranked = [
            (child.key, child.consumed_wh - child.matched_wh)
            for child in self.buckets(finer)
            if parent_of[child.key] == bucket.key
            and child.consumed_wh > child.matched_wh
        ]
        ranked.sort(key=lambda row: (-row[1], row[0]))
        return ranked[:3]

    def _parent_keys(self, grain: str, coarser: str) -> dict[str, str]:
        hour_parent = {
            hour_utc: bucket.key
            for bucket in self.buckets(coarser)
            for hour_utc in bucket.hours
        }
        return {
            bucket.key: hour_parent[bucket.hours[0]] for bucket in self.buckets(grain)
        }

    def _build(self, grain: str) -> list[Bucket]:
        time_zone = self.window.site.time_zone
        buckets: dict[str, Bucket] = {}
        order: list[str] = []
        for hour in self.hours:
            group = _group_key(grain, hour.hour_utc, time_zone, self.window.month)
            bucket = buckets.get(group)
            if bucket is None:
                bucket = Bucket(
                    key=_display_key(grain, hour.hour_utc, time_zone, self.window.month),
                    start_utc=hour.hour_utc,
                    end_utc=hour.hour_utc + timedelta(hours=1),
                )
                buckets[group] = bucket
                order.append(group)
            bucket.consumed_wh += hour.consumed_wh
            bucket.eligible_wh += hour.eligible_wh
            bucket.end_utc = hour.hour_utc + timedelta(hours=1)
            bucket.hours.append(hour.hour_utc)
            if grain == HOUR:
                bucket.quality = hour.quality
        return [buckets[group] for group in order]


def _group_key(grain: str, hour_utc: datetime, time_zone: str, month: str) -> str:
    if grain == MONTH:
        return month
    if grain == WEEK:
        return timeline.local_week_key(hour_utc, time_zone)
    if grain == DAY:
        return timeline.local_date_key(hour_utc, time_zone)
    return hour_utc.strftime("%Y-%m-%dT%H:00:00Z")


def _display_key(grain: str, first_hour: datetime, time_zone: str, month: str) -> str:
    """A week or day bucket is named by the local date of its first day."""
    if grain in (WEEK, DAY):
        return timeline.local_date_key(first_hour, time_zone)
    return _group_key(grain, first_hour, time_zone, month)
