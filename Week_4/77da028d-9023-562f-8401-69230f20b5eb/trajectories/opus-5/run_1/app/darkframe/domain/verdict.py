"""Usable minutes, the verdict, the best target and the clear window."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime

from . import astro, filters, horizon, rounding, timeutil
from .conditions import Conditions
from .night import Night

GO = "go"
NO_GO = "no-go"
UNKNOWN = "unknown"
GO_MINUTES = 60
ARC_STEP_MINUTES = 5


@dataclass(frozen=True)
class PlannedFilter:
    filter: str
    planned_seconds: int
    logged_seconds: int
    owed_seconds: int


@dataclass(frozen=True)
class PlanTarget:
    project_id: str
    project_name: str
    target_name: str
    ra_deg: float
    dec_deg: float
    counts: bool
    total_integration_seconds: int
    planned_filters: tuple[PlannedFilter, ...]


@dataclass(frozen=True)
class PlanInputs:
    night: Night
    mask: list[int]
    min_altitude_deg: int
    targets: tuple[PlanTarget, ...]
    conditions: Conditions
    minute: int
    now: datetime
    stale_seconds: int


class _Sampler:
    """Positions for every night minute the filter windows can reach."""

    def __init__(self, inputs: PlanInputs) -> None:
        night = inputs.night
        self.inputs = inputs
        first, last = night.narrowband_bounds()
        self.moon: dict[int, astro.Horizontal] = {}
        self.positions: dict[str, dict[int, astro.Horizontal]] = {}
        self.separations: dict[str, dict[int, float]] = {}
        self.status: dict[str, dict[int, str]] = {}
        self.sky_clear: dict[int, bool] = {}

        place = night.site.place
        precessed = {
            target.project_id: astro.precess_from_j2000(
                target.ra_deg, target.dec_deg, night.origin
            )
            for target in inputs.targets
        }
        for target in inputs.targets:
            self.positions[target.project_id] = {}
            self.separations[target.project_id] = {}
            self.status[target.project_id] = {}

        for minute in range(first, max(last, night.minutes) + 1):
            instant = night.instant_at(minute)
            sidereal = astro.local_sidereal_time_deg(instant, night.site.longitude)
            moon = astro.moon_topocentric(astro.moon_position(instant), place, sidereal)
            self.moon[minute] = moon
            self.sky_clear[minute] = inputs.conditions.sky_clear_at(instant)
            for target in inputs.targets:
                ra, dec = precessed[target.project_id]
                position = astro.to_horizontal(ra, dec, sidereal, night.site.latitude)
                self.positions[target.project_id][minute] = position
                self.separations[target.project_id][minute] = astro.angular_separation(
                    position, moon
                )
                self.status[target.project_id][minute] = horizon.position_status(
                    position.altitude_deg,
                    position.azimuth_deg,
                    inputs.mask,
                    inputs.min_altitude_deg,
                )

    def moon_clear(self, project_id: str, minute: int, filter_name: str) -> bool:
        if self.moon[minute].altitude_deg < 0:
            return True
        if self.inputs.night.moon_illumination < 0.25:
            return True
        return (
            self.separations[project_id][minute]
            >= filters.MOON_MINIMUM_SEPARATION_DEG[filter_name]
        )

    def usable(self, project_id: str, minute: int, filter_name: str) -> bool:
        return (
            self.status[project_id][minute] == horizon.CLEAR
            and self.moon_clear(project_id, minute, filter_name)
            and self.sky_clear[minute]
        )


def usable_range(night: Night, filter_name: str, minute: int) -> range:
    """The instants a filter's usable minutes are counted over from minute `m`."""
    window_start, window_end = filters.filter_window(filter_name, night.minutes)
    start = window_start if minute == 0 else minute
    return range(start, max(start, window_end))


def build_plan(inputs: PlanInputs) -> dict[str, object]:
    night = inputs.night
    zone = night.site.time_zone
    sampler = _Sampler(inputs)
    minute = inputs.minute
    instant = night.instant_at(minute)

    sun_equatorial = astro.sun_position(instant)
    sidereal = astro.local_sidereal_time_deg(instant, night.site.longitude)
    sun = astro.to_horizontal(
        sun_equatorial.ra_deg, sun_equatorial.dec_deg, sidereal, night.site.latitude
    )
    moon_now = sampler.moon[minute]

    target_bodies: list[dict[str, object]] = []
    best: dict[str, object] | None = None
    best_rank: tuple[int, int, int] | None = None
    best_identity: tuple[str, str] | None = None
    integration_total = 0

    for order, target in enumerate(inputs.targets):
        position = sampler.positions[target.project_id][minute]
        filter_bodies: list[dict[str, object]] = []
        for planned in target.planned_filters:
            usable_minutes = 0
            if target.counts:
                usable_minutes = sum(
                    1
                    for candidate in usable_range(night, planned.filter, minute)
                    if sampler.usable(target.project_id, candidate, planned.filter)
                )
            owed_after = max(0, planned.owed_seconds - 60 * usable_minutes)
            filter_bodies.append(
                {
                    "filter": planned.filter,
                    "owed_seconds": planned.owed_seconds,
                    "usable_minutes": usable_minutes,
                    "owed_after_tonight_seconds": owed_after,
                }
            )
            if target.counts and planned.owed_seconds > 0:
                rank = (-usable_minutes, order, filters.filter_sort_key(planned.filter))
                if best_rank is None or rank < best_rank:
                    best_rank = rank
                    best_identity = (target.project_id, planned.filter)
                    best = {
                        "project_id": target.project_id,
                        "target_name": target.target_name,
                        "filter": planned.filter,
                        "usable_minutes": usable_minutes,
                    }
        if target.counts:
            integration_total += target.total_integration_seconds
        target_bodies.append(
            {
                "project_id": target.project_id,
                "project_name": target.project_name,
                "target_name": target.target_name,
                "counts": target.counts,
                "altitude_deg": rounding.degrees(position.altitude_deg),
                "azimuth_deg": rounding.degrees(position.azimuth_deg),
                "moon_separation_deg": rounding.degrees(
                    sampler.separations[target.project_id][minute]
                ),
                "position_status": sampler.status[target.project_id][minute],
                "clear_minutes": sum(
                    1
                    for candidate in range(minute, night.minutes)
                    if sampler.status[target.project_id][candidate] == horizon.CLEAR
                ),
                "filters": filter_bodies,
                "arc": _arc(sampler, target.project_id, night),
            }
        )

    verdict, reason = decide_verdict(
        night, inputs.conditions, None if best is None else int(best["usable_minutes"])
    )
    window = (
        _clear_window(sampler, night, best_identity, minute, zone)
        if best_identity is not None
        else None
    )
    is_tonight = night.observing_date == timeutil.observing_date_of(inputs.now, zone)
    if window is not None and is_tonight:
        window["starts_in_minutes"] = _starts_in(
            night, int(window["start_minute"]), inputs.now
        )

    return {
        "date": night.observing_date.isoformat(),
        "is_tonight": is_tonight,
        "server_time": timeutil.iso_utc(inputs.now),
        "minute": minute,
        "time_local": timeutil.hhmm(instant, zone),
        "night": night.body(),
        "site": {"label": night.site.label, "time_zone": zone},
        "min_altitude_deg": inputs.min_altitude_deg,
        "sun": {
            "altitude_deg": rounding.degrees(sun.altitude_deg),
            "azimuth_deg": rounding.degrees(sun.azimuth_deg),
        },
        "local_sidereal_time_deg": rounding.degrees(sidereal),
        "moon": {
            "altitude_deg": rounding.degrees(moon_now.altitude_deg),
            "azimuth_deg": rounding.degrees(moon_now.azimuth_deg),
            "illumination": night.moon_illumination,
        },
        "hours": [timeutil.iso_local(hour, zone) for hour in night.hour_starts()],
        "conditions": {
            "entered_at": timeutil.iso_utc(inputs.conditions.entered_at)
            if inputs.conditions.entered_at
            else None,
            "stale": inputs.conditions.stale_at(inputs.now, inputs.stale_seconds),
            "hours": [
                {
                    "hour_start": timeutil.iso_local(entry.hour_start, zone),
                    "cloud_pct": entry.cloud_pct,
                    "transparency": entry.transparency,
                    "seeing": entry.seeing,
                }
                for entry in inputs.conditions.entries
            ],
        },
        "targets": target_bodies,
        "verdict": verdict,
        "verdict_reason": reason,
        "best": best,
        "clear_window": window,
        "total_integration_seconds": integration_total,
    }


def decide_verdict(
    night: Night, sky: Conditions, best_usable_minutes: int | None
) -> tuple[str, str]:
    """The verdict follows the first rule that matches."""
    if night.minutes == 0:
        return (NO_GO, "no-astronomical-night")
    if sky.is_empty():
        return (UNKNOWN, "no-conditions")
    if best_usable_minutes is None:
        return (NO_GO, "no-targets")
    if best_usable_minutes >= GO_MINUTES:
        return (GO, "go")
    return (NO_GO, "under-60-minutes")


def _arc(sampler: _Sampler, project_id: str, night: Night) -> list[dict[str, object]]:
    minutes = list(range(0, night.minutes + 1, ARC_STEP_MINUTES))
    if minutes[-1] != night.minutes:
        minutes.append(night.minutes)
    return [
        {
            "minute": minute,
            "altitude_deg": rounding.degrees(
                sampler.positions[project_id][minute].altitude_deg
            ),
            "azimuth_deg": rounding.degrees(
                sampler.positions[project_id][minute].azimuth_deg
            ),
        }
        for minute in minutes
    ]


def _clear_window(
    sampler: _Sampler,
    night: Night,
    identity: tuple[str, str],
    minute: int,
    zone: str,
) -> dict[str, object] | None:
    project_id, filter_name = identity
    counted = usable_range(night, filter_name, minute)
    run_start: int | None = None
    for candidate in counted:
        if sampler.usable(project_id, candidate, filter_name):
            if run_start is None:
                run_start = candidate
        elif run_start is not None:
            return _window_body(night, run_start, candidate, zone)
    if run_start is None:
        return None
    return _window_body(night, run_start, counted.stop, zone)


def _window_body(night: Night, start: int, end: int, zone: str) -> dict[str, object]:
    return {
        "start": timeutil.iso_local(night.instant_at(start), zone),
        "end": timeutil.iso_local(night.instant_at(end), zone),
        "start_minute": start,
        "end_minute": end,
        "starts_in_minutes": None,
    }


def _starts_in(night: Night, start_minute: int, now: datetime) -> int:
    return max(0, int((night.instant_at(start_minute) - now).total_seconds() // 60))
