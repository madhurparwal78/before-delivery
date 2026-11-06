"""Alignment matching, the offset proposal, counters, roll states and curves."""
from __future__ import annotations

import math
from dataclasses import dataclass

from .exposure import LOG_H_PER_STOP, round_half_away

PROPOSAL_OFFSETS = (-2, -1, 0, 1, 2)
SLIP_MARGIN = 0.10
MIN_PROPOSAL_PAIRS = 3
CURVE_MIN_FRAMES = 7
CURVE_MIN_SPAN = 6.0
SPEED_DENSITY = 0.10
CONTRAST_SPAN = 1.30
ZONE_CLAMP = (0, 10)


@dataclass
class EntryView:
    counter: int
    misfire: bool
    relative_stops: float
    id: str = ""


@dataclass
class FrameView:
    number: int
    id: str = ""
    net_density: float | None = None
    unexposed: bool = False
    relative_stops: float | None = None
    misfire: bool = False


@dataclass
class MatchedPair:
    frame_id: str | None
    frame_number: int | None
    source: str


def match_entries(entries: list[EntryView], frames: list[FrameView],
                  offset: int | None, slip_after: int | None,
                  overrides: dict[str, str | None]) -> dict[str, MatchedPair]:
    """Matching steps 1 to 4: overrides always win, one entry per frame."""
    frames_by_id = {f.id: f for f in frames}
    frames_by_number = {f.number: f for f in frames}
    result: dict[str, MatchedPair] = {}
    claimed: set[str] = set()
    for entry in entries:
        if entry.id not in overrides:
            continue
        override = overrides[entry.id]
        frame = frames_by_id.get(override) if override else None
        if frame is not None and frame.id not in claimed:
            result[entry.id] = MatchedPair(frame_id=frame.id, frame_number=frame.number,
                                           source="override")
            claimed.add(frame.id)
        else:
            result[entry.id] = MatchedPair(frame_id=None, frame_number=None,
                                           source="unmatched")
    for entry in entries:
        if entry.id in result:
            continue
        if offset is None:
            result[entry.id] = MatchedPair(frame_id=None, frame_number=None, source="none")
            continue
        target = entry.counter + offset
        if slip_after is not None and entry.counter > slip_after:
            target += 1
        frame = frames_by_number.get(target)
        if frame is not None and frame.id not in claimed:
            result[entry.id] = MatchedPair(frame_id=frame.id, frame_number=frame.number,
                                           source="offset")
            claimed.add(frame.id)
        else:
            result[entry.id] = MatchedPair(frame_id=None, frame_number=None, source="none")
    return result


def pair_for_offset(entries: list[EntryView], frames: list[FrameView],
                    offset: int, slip_after: int | None) -> list[tuple[EntryView, FrameView]]:
    """Matching step 3 only, as the proposal scores it."""
    frames_by_number = {f.number: f for f in frames}
    claimed: set[str] = set()
    pairs: list[tuple[EntryView, FrameView]] = []
    ordered = sorted(entries, key=lambda e: e.counter)
    for entry in ordered:
        target = entry.counter + offset
        if slip_after is not None and entry.counter > slip_after:
            target += 1
        frame = frames_by_number.get(target)
        if frame is not None and frame.id not in claimed:
            pairs.append((entry, frame))
            claimed.add(frame.id)
    return pairs


def spearman_rho(pairs: list[tuple[EntryView, FrameView]]) -> float | None:
    """Rank correlation between relative stops and net density."""
    usable = [(e, f) for e, f in pairs
              if not e.misfire and not f.unexposed and f.net_density is not None]
    if len(usable) < MIN_PROPOSAL_PAIRS:
        return None
    stops = [e.relative_stops for e, _ in usable]
    densities = [f.net_density for _, f in usable]
    if len(set(stops)) < 2 or len(set(densities)) < 2:
        return None
    return _spearman(stops, densities)


def _spearman(xs: list[float], ys: list[float]) -> float:
    rx = _average_ranks(xs)
    ry = _average_ranks(ys)
    mean_x = sum(rx) / len(rx)
    mean_y = sum(ry) / len(ry)
    numerator = sum((a - mean_x) * (b - mean_y) for a, b in zip(rx, ry))
    dx = math.sqrt(sum((a - mean_x) ** 2 for a in rx))
    dy = math.sqrt(sum((b - mean_y) ** 2 for b in ry))
    if dx == 0 or dy == 0:
        return 0.0
    return numerator / (dx * dy)


def _average_ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda i: values[i])
    ranks = [0.0] * len(values)
    i = 0
    while i < len(order):
        j = i
        while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
            j += 1
        average = (i + j) / 2 + 1
        for k in range(i, j + 1):
            ranks[order[k]] = average
        i = j + 1
    return ranks


@dataclass
class Candidate:
    offset: int
    slip_after: int | None
    rho: float | None
    pairs: int


def propose(entries: list[EntryView], frames: list[FrameView]) -> dict:
    """The whole candidate table and the winning proposal."""
    counters = sorted(e.counter for e in entries)
    highest = counters[-1] if counters else None
    slip_counters = [c for c in counters if highest is None or c != highest]

    candidates: list[Candidate] = []
    for offset in PROPOSAL_OFFSETS:
        pairs = pair_for_offset(entries, frames, offset, None)
        candidates.append(Candidate(offset=offset, slip_after=None,
                                    rho=spearman_rho(pairs), pairs=len(pairs)))

    slip_candidates: list[Candidate] = []
    for offset in PROPOSAL_OFFSETS:
        for slip in slip_counters:
            pairs = pair_for_offset(entries, frames, offset, slip)
            slip_candidates.append(Candidate(offset=offset, slip_after=slip,
                                             rho=spearman_rho(pairs), pairs=len(pairs)))

    best_no_slip = _best(candidates, lambda c: (c.offset,))
    best_slip = _best(slip_candidates, lambda c: (c.offset, c.slip_after or 0))

    if best_no_slip is None and best_slip is None:
        return {"candidates": candidates, "slip_candidates": slip_candidates,
                "proposed_offset": None, "proposed_slip_after": None}
    if best_no_slip is None or (best_slip is not None
                                and round_half_away(best_slip.rho or 0.0, 6)
                                - round_half_away(best_no_slip.rho or 0.0, 6) >= SLIP_MARGIN):
        return {"candidates": candidates, "slip_candidates": slip_candidates,
                "proposed_offset": best_slip.offset,
                "proposed_slip_after": best_slip.slip_after}
    return {"candidates": candidates, "slip_candidates": slip_candidates,
            "proposed_offset": best_no_slip.offset, "proposed_slip_after": None}


def _best(candidates: list[Candidate], tie_key) -> Candidate | None:
    usable = [c for c in candidates if c.rho is not None]
    if not usable:
        return None
    best = usable[0]
    for candidate in usable[1:]:
        if _candidate_better(candidate, best, tie_key):
            best = candidate
    return best


def _candidate_better(candidate: Candidate, best: Candidate, tie_key) -> bool:
    candidate_rho = round_half_away(candidate.rho or 0.0, 6)
    best_rho = round_half_away(best.rho or 0.0, 6)
    if candidate_rho != best_rho:
        return candidate_rho > best_rho
    candidate_offset = abs(candidate.offset)
    best_offset = abs(best.offset)
    if candidate_offset != best_offset:
        return candidate_offset < best_offset
    if candidate.offset != best.offset:
        return candidate.offset < best.offset
    return tie_key(candidate) < tie_key(best)


def counters(frames: list[FrameView], entries: list[EntryView],
             matches: dict[str, MatchedPair]) -> dict[str, int]:
    detected = len(frames)
    aligned = sum(1 for pair in matches.values() if pair.frame_id)
    unexposed = sum(1 for f in frames if f.unexposed)
    unmatched = sum(1 for e in entries if not matches.get(e.id) or not matches[e.id].frame_id)
    return {"detected": detected, "aligned": aligned,
            "unexposed": unexposed, "unmatched_notes": unmatched}


def roll_state(kind: str, has_scan: bool, alignment_saved: bool,
                entries: list[EntryView], matches: dict[str, MatchedPair],
                bracket_frames: list[float]) -> str:
    if kind == "test":
        span = max(bracket_frames) - min(bracket_frames) if bracket_frames else 0.0
        return "curve-ready" if (len(bracket_frames) >= CURVE_MIN_FRAMES
                                 and span >= CURVE_MIN_SPAN) else "logging"
    if not has_scan:
        return "logging"
    if alignment_saved and entries and all(
            matches.get(e.id) and matches[e.id].frame_id for e in entries):
        return "aligned"
    return "developed"


@dataclass
class CurvePoint:
    log_h: float
    net: float


def build_curve(bracket_stops: list[float], bracket_nets: list[float]) -> dict:
    """Points, speed point, contrast index, frames used and stop span."""
    frames_used = len(bracket_stops)
    stops_span = (max(bracket_stops) - min(bracket_stops)) if bracket_stops else 0.0
    if frames_used == 0:
        return {"points": [], "base_fog": None, "speed_point_log_h": None,
                "contrast_index": None, "frames_used": 0, "stops_span": 0.0,
                "ready": False}
    ready = frames_used >= CURVE_MIN_FRAMES and stops_span >= CURVE_MIN_SPAN
    if not ready:
        return {"points": [], "base_fog": None, "speed_point_log_h": None,
                "contrast_index": None, "frames_used": frames_used,
                "stops_span": stops_span, "ready": False}

    pairs: dict[float, list[float]] = {}
    for stops, net in zip(bracket_stops, bracket_nets):
        log_h = stops * LOG_H_PER_STOP
        pairs.setdefault(log_h, []).append(net)
    points = [CurvePoint(log_h=log_h, net=sum(nets) / len(nets))
              for log_h, nets in sorted(pairs.items())]
    running = points[0].net
    for point in points:
        running = max(running, point.net)
        point.net = running

    speed_log_h = _speed_point(points)
    contrast = None
    if speed_log_h is not None:
        top = speed_log_h + CONTRAST_SPAN
        if top <= points[-1].log_h:
            contrast = round_half_away((interpolate_curve(points, top) - SPEED_DENSITY)
                                       / CONTRAST_SPAN, 2)
    return {"points": points, "speed_point_log_h": speed_log_h,
            "contrast_index": contrast, "frames_used": frames_used,
            "stops_span": stops_span, "ready": True}


def interpolate_curve(points: list[CurvePoint], log_h: float) -> float:
    """The net density of the curve at a log H, on the first segment reaching it."""
    if log_h <= points[0].log_h:
        return points[0].net
    if log_h >= points[-1].log_h:
        return points[-1].net
    for i in range(len(points) - 1):
        if points[i].log_h <= log_h <= points[i + 1].log_h:
            span = points[i + 1].log_h - points[i].log_h
            if span == 0:
                return points[i].net
            share = (log_h - points[i].log_h) / span
            return points[i].net + share * (points[i + 1].net - points[i].net)
    return points[-1].net


def invert_curve(points: list[CurvePoint], net: float) -> float | None:
    """The first log H where the curve reaches net; off curve is None."""
    if not points:
        return None
    if net < points[0].net:
        return None
    if net > points[-1].net:
        return None
    for i in range(len(points)):
        if points[i].net >= net:
            if i == 0:
                if points[0].net == net:
                    return points[0].log_h
                return None
            prev = points[i - 1]
            current = points[i]
            if current.net == prev.net:
                return prev.log_h
            share = (net - prev.net) / (current.net - prev.net)
            return prev.log_h + share * (current.log_h - prev.log_h)
    return None


def _speed_point(points: list[CurvePoint]) -> float | None:
    if points[0].net >= SPEED_DENSITY:
        return None
    for i in range(len(points) - 1):
        if points[i].net < SPEED_DENSITY <= points[i + 1].net:
            span = points[i + 1].net - points[i].net
            if span == 0:
                return points[i].log_h
            share = (SPEED_DENSITY - points[i].net) / span
            return points[i].log_h + share * (points[i + 1].log_h - points[i].log_h)
    return None


def zone_for(log_h: float | None, speed_log_h: float | None,
             points: list[CurvePoint]) -> int | None:
    if log_h is None or speed_log_h is None:
        return None
    if log_h < points[0].log_h:
        return 0
    if log_h > points[-1].log_h:
        return 10
    value = 1 + round_half_away((log_h - speed_log_h) / LOG_H_PER_STOP, 0)
    return max(ZONE_CLAMP[0], min(ZONE_CLAMP[1], int(value)))


def meter_bias(differences: list[float]) -> float | None:
    if not differences:
        return None
    ordered = sorted(differences)
    n = len(ordered)
    if n % 2 == 1:
        median = ordered[n // 2]
    else:
        median = (ordered[n // 2 - 1] + ordered[n // 2]) / 2
    return round_half_away(median, 1)
