"""A plan for one observing date at one night minute: positions, usable minutes, the verdict, best target and clear
window. This is the only place usable minutes and the verdict are decided."""
from dataclasses import dataclass
from datetime import datetime, timedelta
from math import degrees, floor
from typing import Any

from darkframe.rules.push_text import GO_MINUTES
from darkframe.rules.rounding import round_hundredth, round_tenth
from darkframe.rules.timestamps import utc_text
from darkframe.sky_engine.ephemeris import (
    SIDEREAL_DEGREES_PER_MINUTE,
    Site,
    altitude_azimuth,
    angular_separation,
    julian_date,
    local_sidereal_degrees,
    moon_geocentric,
    moon_illumination,
    moon_topocentric,
    precess,
    sun_altitude_azimuth,
)
from darkframe.sky_engine.night import (
    NARROWBAND_MARGIN_MINUTES,
    Night,
    condition_hours,
    narrowband_window,
)

NARROWBAND_FILTERS = frozenset({"Ha", "OIII", "SII"})
MOON_SEPARATION_MINIMUM = {"L": 60, "R": 60, "G": 60, "B": 60, "OIII": 45, "Ha": 30, "SII": 30}
MOON_ILLUMINATION_LIMIT = 0.25
CLOUD_LIMIT = 30
TRANSPARENCY_MINIMUM = 3
ARC_STEP = 5
MOON_SAMPLE_STEP = 5
MINUTE = timedelta(minutes=1)


@dataclass(frozen=True)
class SiteSettings:
    label: str
    latitude: float
    longitude: float
    elevation_m: float
    time_zone: str
    min_altitude_deg: int
    push_topic: str | None

    @property
    def position(self) -> Site:
        return Site(self.latitude, self.longitude, self.elevation_m)


@dataclass(frozen=True)
class ConditionEntry:
    hour_start: datetime
    cloud_pct: int
    transparency: int
    seeing: int


def position_status(altitude: float, azimuth: float, horizon_mask: list[int], minimum_altitude: int) -> str:
    if altitude < 0:
        return "below-horizon"
    treeline = horizon_mask[int(azimuth // 5) % 72]
    if altitude < treeline and treeline >= minimum_altitude:
        return "behind-treeline"
    if altitude < minimum_altitude:
        return "below-minimum"
    return "clear"


class MoonTrack:
    """The Moon's topocentric altitude and azimuth and its lit fraction for each whole night minute in a span."""

    def __init__(self, night: Night, site: Site, first: int, last: int) -> None:
        self.first = first
        samples = list(range(first, last + MOON_SAMPLE_STEP, MOON_SAMPLE_STEP))
        geocentric = []
        for minute in samples:
            jd = julian_date(night.instant(minute))
            position = moon_geocentric(jd)
            geocentric.append((position, moon_illumination(jd, position)))
        self.altitude: list[float] = []
        self.azimuth: list[float] = []
        self.illumination: list[float] = []
        for minute in range(first, last + 1):
            slot, fraction = divmod(minute - first, MOON_SAMPLE_STEP)
            (a, ia), (b, ib) = geocentric[slot], geocentric[min(slot + 1, len(geocentric) - 1)]
            weight = fraction / MOON_SAMPLE_STEP
            ra = (a[0] + ((b[0] - a[0] + 540) % 360 - 180) * weight) % 360
            position = (ra, a[1] + (b[1] - a[1]) * weight, a[2] + (b[2] - a[2]) * weight)
            altitude, azimuth = moon_topocentric(julian_date(night.instant(minute)), site, position)
            self.altitude.append(altitude)
            self.azimuth.append(azimuth)
            self.illumination.append(ia + (ib - ia) * weight)


class TargetTrack:
    """A target's altitude and azimuth at whole night minutes, with its right ascension precessed to the night."""

    def __init__(self, night: Night, site: Site, right_ascension: float, declination: float) -> None:
        jd = julian_date(night.start)
        self.right_ascension, self.declination = precess(right_ascension, declination, jd)
        self.base_sidereal = local_sidereal_degrees(jd, site.longitude)
        self.latitude = site.latitude

    def at(self, minute: int) -> tuple[float, float]:
        return altitude_azimuth(self.right_ascension, self.declination,
                                (self.base_sidereal + SIDEREAL_DEGREES_PER_MINUTE * minute) % 360, self.latitude)


def sky_clear_minutes(night: Night, entries: list[ConditionEntry], first: int, last: int) -> set[int]:
    clear: set[int] = set()
    for entry in entries:
        if entry.cloud_pct <= CLOUD_LIMIT and entry.transparency >= TRANSPARENCY_MINIMUM:
            begin = (entry.hour_start - night.start) // MINUTE
            clear.update(range(max(first, begin), min(last, begin + 60 - 1) + 1))
    return clear


def _window(filter_name: str, minute: int, night_minutes: int) -> range:
    if night_minutes == 0:
        return range(0)
    narrowband = filter_name in NARROWBAND_FILTERS
    lower = (-NARROWBAND_MARGIN_MINUTES if narrowband else 0) if minute == 0 else minute
    upper = night_minutes + (NARROWBAND_MARGIN_MINUTES if narrowband else 0)
    return range(lower, upper)


def _first_run(instants: list[int]) -> tuple[int, int] | None:
    if not instants:
        return None
    end = instants[0]
    members = set(instants)
    while end + 1 in members:
        end += 1
    return instants[0], end + 1


def _round_position(altitude: float, azimuth: float) -> dict[str, float]:
    return {"altitude_deg": round_tenth(altitude), "azimuth_deg": round_tenth(azimuth)}


def build_plan(*, night: Night, minute: int, now: datetime, site: SiteSettings, horizon_mask: list[int],
               projects: list[dict[str, Any]], entries: list[ConditionEntry], entered_at: datetime | None,
               stale_seconds: int, is_tonight: bool) -> dict[str, Any]:
    position = site.position
    first, last = (-NARROWBAND_MARGIN_MINUTES, night.minutes + NARROWBAND_MARGIN_MINUTES - 1) if night.minutes else (0, -1)
    moon = MoonTrack(night, position, first, last) if night.minutes else None
    sky = sky_clear_minutes(night, entries, first, last)
    instant = night.instant(minute)
    jd = julian_date(instant)
    moon_altitude, moon_azimuth = moon_topocentric(jd, position)
    sun_altitude, sun_azimuth = sun_altitude_azimuth(jd, position)
    sidereal = local_sidereal_degrees(jd, position.longitude)

    targets = []
    for project in projects:
        counts = project["state"] == "active"
        track = TargetTrack(night, position, project["ra_deg"], project["dec_deg"])
        altitude, azimuth = track.at(minute)
        status = position_status(altitude, azimuth, horizon_mask, site.min_altitude_deg)
        positions = {i: track.at(i) for i in range(first, last + 1)}
        statuses = {i: position_status(*positions[i], horizon_mask, site.min_altitude_deg) for i in positions}
        moon_matters = {i for i in positions
                        if moon.altitude[i - first] >= 0 and moon.illumination[i - first] >= MOON_ILLUMINATION_LIMIT}
        separations = {i: degrees(angular_separation(*positions[i], moon.altitude[i - first], moon.azimuth[i - first]))
                       for i in moon_matters}
        usable_instants: dict[str, list[int]] = {}
        filters = []
        for row in project["filters"]:
            if row["planned_seconds"] <= 0:
                continue
            name = row["filter"]
            instants = [i for i in _window(name, minute, night.minutes) if counts and statuses[i] == "clear"
                        and i in sky and (i not in moon_matters or separations[i] >= MOON_SEPARATION_MINIMUM[name])]
            usable_instants[name] = instants
            filters.append({"filter": name, "owed_seconds": row["owed_seconds"], "usable_minutes": len(instants),
                            "owed_after_tonight_seconds": max(0, row["owed_seconds"] - 60 * len(instants))})
        arc_minutes = list(range(0, night.minutes + 1, ARC_STEP))
        if arc_minutes[-1] != night.minutes:
            arc_minutes.append(night.minutes)
        separation = degrees(angular_separation(altitude, azimuth, moon_altitude, moon_azimuth))
        targets.append({
            "project_id": project["id"], "project_name": project["name"], "target_name": project["target_name"],
            "counts": counts, **_round_position(altitude, azimuth), "moon_separation_deg": round_tenth(separation),
            "position_status": status,
            "clear_minutes": sum(1 for i in range(minute, night.minutes) if statuses.get(i) == "clear"),
            "filters": filters,
            "arc": [{"minute": m, **_round_position(*(positions[m] if m in positions else track.at(m)))} for m in arc_minutes],
            "_usable": usable_instants, "_counts_total": project["total_integration_seconds"],
        })

    best = None
    for target in targets:
        if not target["counts"]:
            continue
        for row in target["filters"]:
            if row["owed_seconds"] > 0 and (best is None or row["usable_minutes"] > best["usable_minutes"]):
                best = {"project_id": target["project_id"], "target_name": target["target_name"],
                        "filter": row["filter"], "usable_minutes": row["usable_minutes"]}
    run = None
    if best is not None:
        best_target = next(t for t in targets if t["project_id"] == best["project_id"])
        run = _first_run(best_target["_usable"][best["filter"]])
    clear_window = None
    if run is not None:
        starts_in = max(0, int((night.instant(run[0]) - now) / MINUTE)) if is_tonight else None
        clear_window = {"start": night.local_iso(night.instant(run[0])), "end": night.local_iso(night.instant(run[1])),
                        "start_minute": run[0], "end_minute": run[1], "starts_in_minutes": starts_in}

    if not night.has_astronomical_night:
        verdict, reason = "no-go", "no-astronomical-night"
    elif not entries:
        verdict, reason = "unknown", "no-conditions"
    elif best is None:
        verdict, reason = "no-go", "no-targets"
    elif best["usable_minutes"] >= GO_MINUTES:
        verdict, reason = "go", "go"
    else:
        verdict, reason = "no-go", "under-60-minutes"

    total_integration = sum(t["_counts_total"] for t in targets if t["counts"])
    for target in targets:
        del target["_usable"], target["_counts_total"]
    hours = condition_hours(night)
    return {
        "date": night.observing.isoformat(), "is_tonight": is_tonight,
        "server_time": utc_text(now),
        "minute": minute, "time_local": night.local_iso(instant)[11:16],
        "night": night_body(night), "site": {"label": site.label, "time_zone": site.time_zone},
        "min_altitude_deg": site.min_altitude_deg,
        "sun": _round_position(sun_altitude, sun_azimuth),
        "local_sidereal_time_deg": round_tenth(sidereal),
        "moon": {"altitude_deg": round_tenth(moon_altitude), "azimuth_deg": round_tenth(moon_azimuth),
                 "illumination": round_hundredth(moon_illumination(jd))},
        "hours": [night.local_iso(hour) for hour in hours],
        "conditions": {
            "entered_at": utc_text(entered_at) if entered_at else None,
            "stale": entered_at is not None and (now - entered_at).total_seconds() > stale_seconds,
            "hours": [{"hour_start": night.local_iso(entry.hour_start), "cloud_pct": entry.cloud_pct,
                       "transparency": entry.transparency, "seeing": entry.seeing} for entry in entries]},
        "targets": targets, "verdict": verdict, "verdict_reason": reason, "best": best,
        "clear_window": clear_window, "total_integration_seconds": total_integration,
    }


def night_body(night: Night) -> dict[str, Any]:
    if not night.has_astronomical_night:
        return {"date": night.observing.isoformat(), "has_astronomical_night": False, "dusk": None, "dawn": None,
                "minutes": 0, "narrowband_start": None, "narrowband_end": None,
                "moon_illumination": night.moon_illumination, "utc_offset_at_dusk": night.offset_text()}
    begin, end = narrowband_window(night)
    return {"date": night.observing.isoformat(), "has_astronomical_night": True,
            "dusk": night.local_iso(night.start), "dawn": night.local_iso(night.instant(night.minutes)),
            "minutes": night.minutes, "narrowband_start": night.local_iso(begin), "narrowband_end": night.local_iso(end),
            "moon_illumination": night.moon_illumination, "utc_offset_at_dusk": night.offset_text()}


def current_minute(night: Night, now: datetime) -> int:
    return max(0, min(night.minutes, floor((now - night.start) / MINUTE)))
