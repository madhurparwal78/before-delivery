"""Exact parsing rules for GPX track points: one home for every computed figure."""
import math
import re
import xml.etree.ElementTree as ET
from datetime import datetime, timezone

EARTH_RADIUS_M = 6371000.0
MOVING_SPEED_THRESHOLD_MS = 0.5


def haversine_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Great-circle distance in metres on a sphere of radius 6371000 m."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 2 * EARTH_RADIUS_M * math.asin(math.sqrt(a))


def round_half_up(value: float) -> int:
    """Round to the nearest whole number with halves rounding up."""
    return int(math.floor(value + 0.5))


class Point:
    __slots__ = ("lat", "lon", "ele", "time")

    def __init__(self, lat: float, lon: float, ele: float, time: datetime):
        self.lat = lat
        self.lon = lon
        self.ele = ele
        self.time = time


_TIME_RE = re.compile(
    r"^-?(\d{4,})-(\d{2})-(\d{2})[Tt ](\d{2}):(\d{2}):(\d{2})(\.\d+)?(Z|z|[+-]\d{2}:?\d{2})?$")


def parse_iso_time(text: str) -> datetime:
    m = _TIME_RE.match(text.strip())
    if not m:
        raise ValueError("time")
    year, month, day, hour, minute, second = (int(m.group(i)) for i in range(1, 7))
    micro = 0
    if m.group(7):
        frac = float(m.group(7))
        micro = int(round(frac * 1_000_000))
    tz = m.group(8)
    dt = datetime(year, month, day, hour, minute, second, micro, tzinfo=timezone.utc)
    if tz and tz not in ("Z", "z"):
        sign = 1 if tz[0] == "+" else -1
        digits = tz[1:].replace(":", "")
        offset = sign * (int(digits[:2]) * 3600 + int(digits[2:4]) * 60)
        dt = dt.timestamp() - offset
        dt = datetime.fromtimestamp(dt, tz=timezone.utc)
    return dt


def _text(ele):
    return (ele.text or "").strip() if ele is not None else None


def parse_gpx_points(gpx_text: str) -> list[Point]:
    try:
        root = ET.fromstring(gpx_text)
    except ET.ParseError:
        raise ValueError("gpx")
    points = []
    for parent in root.iter():
        tag = parent.tag.rsplit("}", 1)[-1]
        if tag != "trkpt":
            continue
        lat_s, lon_s = parent.get("lat"), parent.get("lon")
        if lat_s is None or lon_s is None:
            continue
        ele = None
        time = None
        for child in parent:
            ctag = child.tag.rsplit("}", 1)[-1]
            if ctag == "ele" and _text(child) is not None:
                try:
                    ele = float(_text(child))
                except ValueError:
                    pass
            elif ctag == "time" and _text(child):
                try:
                    time = parse_iso_time(_text(child))
                except ValueError:
                    pass
        if ele is None or time is None:
            continue
        try:
            points.append(Point(float(lat_s), float(lon_s), ele, time))
        except ValueError:
            continue
    return points


class ParsedTrack:
    """Figures derived exactly from the parsed track points."""

    def __init__(self, points: list[Point]):
        self.points = points
        self.cumulative_m = [0.0]
        for i in range(1, len(points)):
            a, b = points[i - 1], points[i]
            self.cumulative_m.append(self.cumulative_m[-1] + haversine_m(a.lat, a.lon, b.lat, b.lon))
        self.distance_m = round_half_up(self.cumulative_m[-1])
        self.elapsed_time_s = round_half_up((points[-1].time - points[0].time).total_seconds())
        moving = 0.0
        gain = 0.0
        for i in range(1, len(points)):
            a, b = points[i - 1], points[i]
            gap = (b.time - a.time).total_seconds()
            if gap > 0:
                step_m = self.cumulative_m[i] - self.cumulative_m[i - 1]
                if step_m / gap >= MOVING_SPEED_THRESHOLD_MS:
                    moving += gap
            if b.ele > a.ele:
                gain += b.ele - a.ele
        self.moving_time_s = round_half_up(moving)
        self.elevation_gain_m = round_half_up(gain)
        self.start_time = points[0].time
        if self.moving_time_s == 0:
            self.avg_speed_kmh = 0.0
        else:
            self.avg_speed_kmh = round(self.distance_m / self.moving_time_s * 3.6, 1)

    def pace(self, sport: str) -> int | None:
        if sport == "ride":
            return None
        if self.distance_m == 0:
            return 0
        return round_half_up(self.moving_time_s / (self.distance_m / 1000.0))

    def splits(self) -> list[dict]:
        """One entry per whole kilometre crossing plus a remainder split of at least one metre."""
        result = []
        times = [p.time for p in self.points]
        total_m = self.cumulative_m[-1]
        if total_m <= 0:
            return result
        prev_time = times[0]
        k = 1
        while k * 1000 <= total_m + 1e-9:
            cross_t, cross_m = self._crossing(k * 1000, times)
            elapsed = (cross_t - prev_time).total_seconds()
            result.append(self._split(len(result) + 1, 1000, elapsed))
            prev_time = cross_t
            k += 1
        # the remainder covers the distance from the last crossing to the final point
        last_cross_m = (k - 1) * 1000
        remainder_m = self._interpolated_final_distance(last_cross_m)
        if remainder_m >= 1.0:
            elapsed = (times[-1] - prev_time).total_seconds()
            result.append(self._split(len(result) + 1, round_half_up(remainder_m), elapsed))
        return result

    def _interpolated_final_distance(self, last_cross_m: float) -> float:
        """The running distance that remains after the last whole-kilometre crossing."""
        total_m = self.cumulative_m[-1]
        if total_m <= last_cross_m:
            return 0.0
        # the final point is reached by the track itself; use its true running distance
        return total_m - last_cross_m

    def _crossing(self, target_m: float, times):
        """Straight-line interpolation of the time the running distance reaches target_m."""
        for i in range(1, len(self.cumulative_m)):
            if self.cumulative_m[i] >= target_m:
                before_m = self.cumulative_m[i - 1]
                after_m = self.cumulative_m[i]
                span_m = after_m - before_m
                if span_m <= 0:
                    return times[i], target_m
                frac = (target_m - before_m) / span_m
                before_t = times[i - 1].timestamp()
                after_t = times[i].timestamp()
                return (datetime.fromtimestamp(before_t + (after_t - before_t) * frac, tz=timezone.utc), target_m)
        return times[-1], target_m

    @staticmethod
    def _split(number: int, distance_m: int, elapsed_s: float) -> dict:
        elapsed = round_half_up(elapsed_s)
        pace = round_half_up(elapsed / (distance_m / 1000.0)) if distance_m else 0
        return {"split": number, "distance_m": distance_m, "elapsed_time_s": elapsed, "pace_s_per_km": pace}

    def best_efforts(self, sport: str) -> list[dict]:
        if sport != "run":
            return []
        efforts = []
        for name, metres in (("400m", 400), ("1k", 1000), ("5k", 5000)):
            if self.cumulative_m[-1] < metres:
                continue
            best = None
            j = 0
            for i in range(len(self.points)):
                while j < len(self.points) and self.cumulative_m[j] - self.cumulative_m[i] < metres:
                    j += 1
                if j >= len(self.points):
                    break
                gap = (self.points[j].time - self.points[i].time).total_seconds()
                if best is None or gap < best:
                    best = gap
            if best is not None:
                efforts.append({"name": name, "distance_m": metres, "elapsed_time_s": round_half_up(best)})
        return efforts
