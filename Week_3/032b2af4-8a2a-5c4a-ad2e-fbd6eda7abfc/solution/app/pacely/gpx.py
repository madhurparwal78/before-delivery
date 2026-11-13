"""GPX parsing and every figure derived from track points: the only home of the parsing rules."""

import math
import re
import xml.etree.ElementTree as ET
from dataclasses import dataclass
from datetime import datetime, timezone

from .geo import haversine

MOVING_SPEED_MS = 0.5
BEST_EFFORT_TARGETS = (("400m", 400), ("1k", 1000), ("5k", 5000))
DOCTYPE = re.compile(r"<!\s*(DOCTYPE|ENTITY)", re.I)


class GpxError(ValueError):
    """The document is not a usable track."""


@dataclass(frozen=True)
class TrackPoint:
    lat: float
    lon: float
    ele: float
    time: datetime


def half_up(value: float) -> int:
    return math.floor(value + 0.5)


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _child_text(element: ET.Element, name: str) -> str | None:
    for child in element:
        if _local(child.tag) == name:
            return (child.text or "").strip()
    return None


def _parse_time(text: str) -> datetime:
    moment = datetime.fromisoformat(text)
    return moment.replace(tzinfo=timezone.utc) if moment.tzinfo is None else moment.astimezone(timezone.utc)


def parse_gpx(document: str) -> list[TrackPoint]:
    """The timed track points of a GPX document, in file order."""
    if DOCTYPE.search(document):
        raise GpxError("The GPX document must not declare entities")
    try:
        root = ET.fromstring(document)
    except ET.ParseError as error:
        raise GpxError("The GPX document could not be read") from error
    points = []
    for element in root.iter():
        if _local(element.tag) != "trkpt":
            continue
        stamp = _child_text(element, "time")
        if not stamp:
            continue
        try:
            lat, lon = float(element.attrib["lat"]), float(element.attrib["lon"])
            ele = float(_child_text(element, "ele") or 0.0)
            moment = _parse_time(stamp)
        except (KeyError, ValueError) as error:
            raise GpxError("A track point has an unreadable latitude, longitude, elevation or time") from error
        if not (math.isfinite(lat) and math.isfinite(lon) and math.isfinite(ele)) or abs(lat) > 90 or abs(lon) > 180:
            raise GpxError("A track point lies outside the valid coordinates")
        points.append(TrackPoint(lat, lon, ele, moment))
    if len(points) < 2:
        raise GpxError("The GPX document needs at least two track points with a time")
    return points


def running_distances(points: list[TrackPoint]) -> list[float]:
    totals = [0.0]
    for earlier, later in zip(points, points[1:]):
        totals.append(totals[-1] + haversine(earlier.lat, earlier.lon, later.lat, later.lon))
    return totals


def _seconds(points: list[TrackPoint], index: int) -> float:
    return (points[index].time - points[0].time).total_seconds()


def _crossing_time(points: list[TrackPoint], totals: list[float], target: float) -> float:
    """Seconds since the first point at which the running distance first reaches `target`, by interpolation."""
    for i in range(1, len(points)):
        if totals[i] >= target:
            fraction = (target - totals[i - 1]) / (totals[i] - totals[i - 1])
            return _seconds(points, i - 1) + fraction * (_seconds(points, i) - _seconds(points, i - 1))


def _altitude_at(points: list[TrackPoint], totals: list[float], target: float) -> float:
    """Elevation at a running distance, by straight-line interpolation between the points either side."""
    for i in range(1, len(points)):
        if totals[i] >= target:
            span = totals[i] - totals[i - 1]
            fraction = 0.0 if span == 0 else (target - totals[i - 1]) / span
            return points[i - 1].ele + fraction * (points[i].ele - points[i - 1].ele)
    return points[-1].ele


def splits_of(points: list[TrackPoint], totals: list[float]) -> list[dict]:
    total = totals[-1]
    whole = int(total // 1000)
    splits, previous = [], 0.0
    for k in range(1, whole + 1):
        crossing = _crossing_time(points, totals, k * 1000.0)
        elapsed = half_up(crossing - previous)
        splits.append({"split": k, "distance_m": 1000, "elapsed_time_s": elapsed, "pace_s_per_km": elapsed,
                       "elevation_m": half_up(_altitude_at(points, totals, k * 1000.0) - _altitude_at(points, totals, (k - 1) * 1000.0))})
        previous = crossing
    remainder = total - whole * 1000.0
    if remainder >= 1.0:
        metres = half_up(remainder)
        elapsed = half_up(_seconds(points, len(points) - 1) - previous)
        splits.append({"split": whole + 1, "distance_m": metres, "elapsed_time_s": elapsed,
                       "pace_s_per_km": half_up(elapsed / (metres / 1000.0)),
                       "elevation_m": half_up(points[-1].ele - _altitude_at(points, totals, whole * 1000.0))})
    return splits


def best_efforts_of(points: list[TrackPoint], totals: list[float]) -> list[dict]:
    """Fastest point-to-point windows covering at least 400 m, 1000 m and 5000 m, by a two-pointer sweep."""
    efforts = []
    for name, target in BEST_EFFORT_TARGETS:
        if totals[-1] < target:
            continue
        best, j = None, 0
        for i in range(len(points)):
            j = max(j, i + 1)
            while j < len(points) and totals[j] - totals[i] < target:
                j += 1
            if j >= len(points):
                break
            window = (points[j].time - points[i].time).total_seconds()
            best = window if best is None else min(best, window)
        efforts.append({"name": name, "distance_m": target, "elapsed_time_s": half_up(best)})
    return efforts


def measure(points: list[TrackPoint], sport_type: str) -> dict:
    """Every stored figure of an activity, computed from the track points alone."""
    totals = running_distances(points)
    moving = 0.0
    gain = 0.0
    for i in range(1, len(points)):
        gap = (points[i].time - points[i - 1].time).total_seconds()
        if gap > 0 and (totals[i] - totals[i - 1]) / gap >= MOVING_SPEED_MS:
            moving += gap
        rise = points[i].ele - points[i - 1].ele
        if rise > 0:
            gain += rise
    distance_m = half_up(totals[-1])
    moving_time_s = half_up(moving)
    on_foot = sport_type != "ride"
    return {
        "totals": totals,
        "distance_m": distance_m,
        "elapsed_time_s": half_up(_seconds(points, len(points) - 1)),
        "moving_time_s": moving_time_s,
        "elevation_gain_m": half_up(gain),
        "avg_pace_s_per_km": half_up(moving_time_s / (distance_m / 1000.0)) if on_foot and distance_m else None,
        "avg_speed_kmh": round(distance_m / moving_time_s * 3.6, 1) if moving_time_s else 0.0,
        "splits": splits_of(points, totals),
        "best_efforts": best_efforts_of(points, totals) if sport_type == "run" else [],
    }


def export_gpx(name: str, points: list[dict]) -> str:
    """A GPX 1.1 document holding every stored point, written so that uploading it reproduces the figures."""
    rows = "\n".join(
        f'<trkpt lat="{p["lat"]!r}" lon="{p["lon"]!r}"><ele>{p["ele"]!r}</ele>'
        f'<time>{p["time"].astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")}</time></trkpt>'
        for p in points
    )
    title = name.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;")
    return ('<?xml version="1.0" encoding="UTF-8"?>\n'
            '<gpx version="1.1" creator="Pacely" xmlns="http://www.topografix.com/GPX/1/1">\n'
            f"<trk><name>{title}</name><trkseg>\n{rows}\n</trkseg></trk></gpx>\n")
