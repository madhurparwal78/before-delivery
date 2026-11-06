"""The characteristic curve: points, speed point, contrast index, zones, bias."""

from __future__ import annotations

import statistics
from dataclasses import dataclass

from .exposure import LOG10_2
from .rounding import round_half_away

SPEED_NET_DENSITY = 0.10
CONTRAST_INDEX_SPAN = 1.30
MAX_ZONE = 10


@dataclass(frozen=True)
class CurvePoint:
    log_h: float
    net: float


@dataclass(frozen=True)
class Curve:
    """A curve-ready test roll's curve, or an empty one."""

    points: tuple[CurvePoint, ...]
    base_fog: float | None
    frames_used: int
    stops_span: float

    @property
    def ready(self) -> bool:
        return bool(self.points)

    @property
    def speed_point_log_h(self) -> float | None:
        if not self.points or self.points[0].net >= SPEED_NET_DENSITY:
            return None
        for first, second in zip(self.points, self.points[1:]):
            if second.net >= SPEED_NET_DENSITY:
                if second.net == first.net:
                    return second.log_h
                share = (SPEED_NET_DENSITY - first.net) / (second.net - first.net)
                return first.log_h + share * (second.log_h - first.log_h)
        return None

    @property
    def contrast_index(self) -> float | None:
        speed = self.speed_point_log_h
        if speed is None:
            return None
        upper = speed + CONTRAST_INDEX_SPAN
        if upper > self.points[-1].log_h:
            return None
        net = self.net_at(upper)
        if net is None:
            return None
        return round_half_away((net - SPEED_NET_DENSITY) / CONTRAST_INDEX_SPAN, 2)

    def net_at(self, log_h: float) -> float | None:
        if not self.points:
            return None
        if log_h < self.points[0].log_h or log_h > self.points[-1].log_h:
            return None
        for first, second in zip(self.points, self.points[1:]):
            if first.log_h <= log_h <= second.log_h:
                if second.log_h == first.log_h:
                    return second.net
                share = (log_h - first.log_h) / (second.log_h - first.log_h)
                return first.net + share * (second.net - first.net)
        return self.points[-1].net

    def invert(self, net: float) -> float | None:
        """The log H on the first segment that reaches this net density."""
        if not self.points:
            return None
        if net < self.points[0].net or net > self.points[-1].net:
            return None
        for first, second in zip(self.points, self.points[1:]):
            if first.net <= net <= second.net:
                if second.net == first.net:
                    return first.log_h
                share = (net - first.net) / (second.net - first.net)
                return first.log_h + share * (second.log_h - first.log_h)
        return None

    def zone(self, net: float) -> int | None:
        speed = self.speed_point_log_h
        if speed is None or not self.points:
            return None
        if net < self.points[0].net:
            return 0
        if net > self.points[-1].net:
            return MAX_ZONE
        log_h = self.invert(net)
        if log_h is None:
            return None
        zone = 1 + int(round_half_away((log_h - speed) / LOG10_2, 0))
        return max(0, min(MAX_ZONE, zone))


EMPTY_CURVE = Curve(points=(), base_fog=None, frames_used=0, stops_span=0.0)


def build_curve(
    bracket: list[tuple[float, float]],
    base_fogs: list[float],
    ready: bool,
) -> Curve:
    """`bracket` pairs each bracket frame's relative stops with its net density."""
    stops = [item[0] for item in bracket]
    span = (max(stops) - min(stops)) if stops else 0.0
    if not ready or not bracket:
        return Curve(
            points=(),
            base_fog=None,
            frames_used=len(bracket),
            stops_span=span,
        )
    grouped: dict[float, list[float]] = {}
    for entry_stops, net in bracket:
        grouped.setdefault(entry_stops * LOG10_2, []).append(net)
    points: list[CurvePoint] = []
    running_max: float | None = None
    for log_h in sorted(grouped):
        net = sum(grouped[log_h]) / len(grouped[log_h])
        running_max = net if running_max is None else max(running_max, net)
        points.append(CurvePoint(log_h, running_max))
    return Curve(
        points=tuple(points),
        base_fog=statistics.median(base_fogs) if base_fogs else None,
        frames_used=len(bracket),
        stops_span=span,
    )


def meter_bias(curve: Curve, pairs: list[tuple[float, float]]) -> float | None:
    """`pairs` gives each matched, exposed frame's (relative stops, net density)."""
    differences: list[float] = []
    for stops, net in pairs:
        log_h = curve.invert(net)
        if log_h is None:
            continue
        differences.append(log_h / LOG10_2 - stops)
    if not differences:
        return None
    return round_half_away(statistics.median(differences), 1)


ROMAN_ZONES = ("0", "I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X")


def zone_label(zone: int | None) -> str | None:
    if zone is None:
        return None
    return ROMAN_ZONES[zone]
