"""The characteristic curve of a test roll, its speed point, contrast index, zones, meter bias and roll states."""

import statistics
from dataclasses import dataclass

from .exposure import LOG_H_PER_STOP, half_away

SPEED_NET = 0.10
CONTRAST_SPAN = 1.30
MIN_BRACKET_FRAMES = 7
MIN_BRACKET_SPAN = 6.0
ROMAN = ("0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X")


@dataclass(frozen=True, slots=True)
class Bracket:
    """A matched, non-misfire note of a test roll with the net density of its frame."""

    relative_stops: float
    net_density: float


@dataclass(frozen=True, slots=True)
class Curve:
    points: list[tuple[float, float]]
    base_fog: float | None
    speed_point: float | None
    contrast_index: float | None
    frames_used: int
    stops_span: float

    @property
    def ready(self) -> bool:
        return is_ready(self.frames_used, self.stops_span)


def is_ready(frames_used: int, stops_span: float) -> bool:
    """A test roll is curve-ready with at least 7 bracket frames spanning at least 6.0 stops."""
    return frames_used >= MIN_BRACKET_FRAMES and stops_span >= MIN_BRACKET_SPAN


def build_curve(brackets: list[Bracket], scan_base_fogs: list[float]) -> Curve:
    """The curve of a test roll; its figures are only filled in when the roll is curve-ready."""
    stops = [b.relative_stops for b in brackets]
    span = max(stops) - min(stops) if stops else 0.0
    frames_used = len(brackets)
    if not is_ready(frames_used, span):
        return Curve([], None, None, None, frames_used, span)
    grouped: dict[float, list[float]] = {}
    for bracket in brackets:
        grouped.setdefault(bracket.relative_stops * LOG_H_PER_STOP, []).append(bracket.net_density)
    points, top = [], float("-inf")
    for log_h in sorted(grouped):
        top = max(top, statistics.fmean(grouped[log_h]))
        points.append((log_h, top))
    speed = speed_point(points)
    return Curve(points, statistics.median(scan_base_fogs) if scan_base_fogs else None, speed,
                 contrast_index(points, speed), frames_used, span)


def speed_point(points: list[tuple[float, float]]) -> float | None:
    """The log H where the curve first rises from below 0.10 net density to 0.10."""
    if not points or points[0][1] >= SPEED_NET:
        return None
    for (h0, d0), (h1, d1) in zip(points, points[1:]):
        if d0 < SPEED_NET <= d1:
            return h0 + (SPEED_NET - d0) * (h1 - h0) / (d1 - d0)
    return None


def density_at(points: list[tuple[float, float]], log_h: float) -> float:
    for (h0, d0), (h1, d1) in zip(points, points[1:]):
        if h0 <= log_h <= h1:
            return d0 if h1 == h0 else d0 + (d1 - d0) * (log_h - h0) / (h1 - h0)
    return points[-1][1]


def contrast_index(points: list[tuple[float, float]], speed: float | None) -> float | None:
    if speed is None or speed + CONTRAST_SPAN > points[-1][0]:
        return None
    return (density_at(points, speed + CONTRAST_SPAN) - SPEED_NET) / CONTRAST_SPAN


def invert(points: list[tuple[float, float]], net: float) -> float | None:
    """The log H on the first segment that reaches `net`; None when the density is off the curve."""
    if net < points[0][1] or net > points[-1][1]:
        return None
    if net == points[0][1]:
        return points[0][0]
    h0, d0 = points[0]
    for h1, d1 in points[1:]:
        if d1 >= net:
            return h0 if d1 == d0 else h0 + (net - d0) * (h1 - h0) / (d1 - d0)
        h0, d0 = h1, d1
    return points[-1][0]


def zone(curve: Curve, net: float) -> str | None:
    """Roman zone of a net density on the curve; None when the curve has no speed point."""
    if curve.speed_point is None:
        return None
    if net < curve.points[0][1]:
        return ROMAN[0]
    if net > curve.points[-1][1]:
        return ROMAN[10]
    log_h = invert(curve.points, net)
    steps = 1 + int(half_away((log_h - curve.speed_point) / LOG_H_PER_STOP, 0))
    return ROMAN[min(10, max(0, steps))]


def meter_bias(curve: Curve, notes: list[Bracket]) -> float | None:
    """Median of (inverted log H / 0.30103 - relative stops) over notes whose frame lies on the curve."""
    differences = []
    for note in notes:
        log_h = invert(curve.points, note.net_density)
        if log_h is not None:
            differences.append(log_h / LOG_H_PER_STOP - note.relative_stops)
    return statistics.median(differences) if differences else None
