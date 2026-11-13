"""The one home of the GPX parsing rules: figures, splits and best efforts."""
import math
from dataclasses import dataclass
from datetime import datetime, timezone
from xml.etree import ElementTree

from .geo import haversine_m

BEST_EFFORT_DISTANCES = (("400m", 400.0), ("1k", 1000.0), ("5k", 5000.0))
PACED_SPORTS = ("run", "walk", "hike")
MOVING_SPEED_MIN_M_PER_S = 0.5


class GpxError(ValueError):
    """A GPX document that does not parse into at least two timed track points."""


@dataclass(frozen=True)
class TrackPoint:
    lat: float
    lon: float
    ele: float
    time: datetime


def round_half_up(value: float) -> int:
    return math.floor(value + 0.5)


def round_tenth(value: float) -> float:
    return math.floor(value * 10.0 + 0.5) / 10.0


def _local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def _parse_time(text: str) -> datetime:
    moment = datetime.fromisoformat(text.strip().replace("Z", "+00:00"))
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(timezone.utc)


def parse_gpx(document: str) -> list[TrackPoint]:
    try:
        root = ElementTree.fromstring(document)
    except ElementTree.ParseError as exc:
        raise GpxError("gpx does not parse") from exc
    points: list[TrackPoint] = []
    for element in root.iter():
        if _local_name(element.tag) != "trkpt":
            continue
        lat, lon = element.get("lat"), element.get("lon")
        if lat is None or lon is None:
            continue
        ele, moment = 0.0, None
        for child in element:
            name = _local_name(child.tag)
            if name == "ele" and child.text:
                ele = float(child.text)
            elif name == "time" and child.text:
                try:
                    moment = _parse_time(child.text)
                except ValueError as exc:
                    raise GpxError("track point time does not parse") from exc
        if moment is None:
            continue
        try:
            points.append(TrackPoint(float(lat), float(lon), ele, moment))
        except ValueError as exc:
            raise GpxError("track point coordinate does not parse") from exc
    if len(points) < 2:
        raise GpxError("gpx needs at least two timed track points")
    return points


def cumulative_distances(points: list[TrackPoint]) -> list[float]:
    running = [0.0]
    for previous, current in zip(points, points[1:]):
        running.append(running[-1] + haversine_m(previous.lat, previous.lon, current.lat, current.lon))
    return running


def _seconds_from_start(points: list[TrackPoint]) -> list[float]:
    first = points[0].time
    return [(point.time - first).total_seconds() for point in points]


def _crossing_time(cumulative: list[float], seconds: list[float], target: float) -> float:
    for index in range(1, len(cumulative)):
        if cumulative[index] >= target:
            span = cumulative[index] - cumulative[index - 1]
            fraction = (target - cumulative[index - 1]) / span if span else 0.0
            return seconds[index - 1] + fraction * (seconds[index] - seconds[index - 1])
    return seconds[-1]


def compute_splits(cumulative: list[float], seconds: list[float]) -> list[dict]:
    total = cumulative[-1]
    splits: list[dict] = []
    previous_crossing = 0.0
    whole_kilometres = int(total // 1000)
    for kilometre in range(1, whole_kilometres + 1):
        crossing = _crossing_time(cumulative, seconds, kilometre * 1000.0)
        elapsed = round_half_up(crossing - previous_crossing)
        splits.append(
            {"split": kilometre, "distance_m": 1000, "elapsed_time_s": elapsed, "pace_s_per_km": elapsed}
        )
        previous_crossing = crossing
    remainder = total - whole_kilometres * 1000.0
    if remainder >= 1.0:
        elapsed = round_half_up(seconds[-1] - previous_crossing)
        distance = round_half_up(remainder)
        splits.append(
            {
                "split": whole_kilometres + 1,
                "distance_m": distance,
                "elapsed_time_s": elapsed,
                "pace_s_per_km": round_half_up(elapsed / (distance / 1000.0)),
            }
        )
    return splits


def compute_best_efforts(cumulative: list[float], seconds: list[float], sport_type: str) -> list[dict]:
    if sport_type != "run":
        return []
    total = cumulative[-1]
    efforts: list[dict] = []
    for name, target in BEST_EFFORT_DISTANCES:
        if total < target:
            continue
        best = None
        start = 0
        for end in range(1, len(cumulative)):
            while cumulative[end] - cumulative[start + 1] >= target:
                start += 1
            if cumulative[end] - cumulative[start] >= target:
                span = seconds[end] - seconds[start]
                if best is None or span < best:
                    best = span
        if best is not None:
            efforts.append({"name": name, "distance_m": int(target), "elapsed_time_s": round_half_up(best)})
    return efforts


def summarize(points: list[TrackPoint], sport_type: str) -> dict:
    cumulative = cumulative_distances(points)
    seconds = _seconds_from_start(points)
    distance = cumulative[-1]
    elapsed = seconds[-1]
    moving = 0.0
    climb = 0.0
    for index in range(1, len(points)):
        gap = seconds[index] - seconds[index - 1]
        step = cumulative[index] - cumulative[index - 1]
        if gap > 0 and step / gap >= MOVING_SPEED_MIN_M_PER_S:
            moving += gap
        rise = points[index].ele - points[index - 1].ele
        if rise > 0:
            climb += rise
    moving_time_s = round_half_up(moving)
    distance_m = round_half_up(distance)
    pace = None
    if sport_type in PACED_SPORTS:
        pace = round_half_up(moving_time_s / (distance_m / 1000.0)) if distance_m else 0
    speed = round_tenth(distance_m / moving_time_s * 3.6) if moving_time_s else 0.0
    return {
        "start_time": points[0].time,
        "distance_m": distance_m,
        "elapsed_time_s": round_half_up(elapsed),
        "moving_time_s": moving_time_s,
        "elevation_gain_m": round_half_up(climb),
        "avg_pace_s_per_km": pace,
        "avg_speed_kmh": speed,
        "splits": compute_splits(cumulative, seconds),
        "best_efforts": compute_best_efforts(cumulative, seconds, sport_type),
    }
