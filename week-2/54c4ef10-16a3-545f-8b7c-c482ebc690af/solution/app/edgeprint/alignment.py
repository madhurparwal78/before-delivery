"""Matching notes to frames, the alignment proposal and the four roll counters."""

import math
from dataclasses import dataclass

from .exposure import half_away

OFFSET_RANGE = (-2, 2)
OFFSETS = range(OFFSET_RANGE[0], OFFSET_RANGE[1] + 1)
SLIP_MARGIN = 0.10
RHO_TIE_PLACES = 6
MIN_PAIRS = 3


@dataclass(frozen=True, slots=True)
class NoteRow:
    id: str
    counter: int
    relative_stops: float
    misfire: bool


@dataclass(frozen=True, slots=True)
class FrameRow:
    id: str
    number: int
    net_density: float
    unexposed: bool


@dataclass(frozen=True, slots=True)
class Saved:
    """The roll's saved alignment: offset, slip counter and overrides (entry id -> frame id or None)."""

    offset: int | None
    slip_after: int | None
    overrides: dict[str, str | None]


def frame_number_for(counter: int, offset: int, slip_after: int | None) -> int:
    """Step 3 of Matching: counter + offset, one frame further past the slip."""
    return counter + offset + (1 if slip_after is not None and counter > slip_after else 0)


def match(entries: list[NoteRow], frames: list[FrameRow], saved: Saved) -> dict[str, tuple[str | None, str]]:
    """entry id -> (frame id or None, match kind); kinds are none, offset, override and unmatched."""
    by_number = {frame.number: frame.id for frame in frames}
    claimed = {frame_id for frame_id in saved.overrides.values() if frame_id is not None}
    result: dict[str, tuple[str | None, str]] = {}
    taken: set[str] = set()
    for entry in entries:
        if entry.id in saved.overrides:
            frame_id = saved.overrides[entry.id]
            result[entry.id] = (frame_id, "override" if frame_id is not None else "unmatched")
            if frame_id is not None:
                taken.add(frame_id)
    for entry in entries:
        if entry.id in result:
            continue
        frame_id = None
        if saved.offset is not None:
            frame_id = by_number.get(frame_number_for(entry.counter, saved.offset, saved.slip_after))
        if frame_id is None or frame_id in claimed or frame_id in taken:
            result[entry.id] = (None, "none")
        else:
            result[entry.id] = (frame_id, "offset")
            taken.add(frame_id)
    return result


def counters(frames: list[FrameRow], matched: dict[str, tuple[str | None, str]]) -> dict[str, int]:
    return {
        "detected": len(frames),
        "aligned": sum(1 for frame_id, _ in matched.values() if frame_id is not None),
        "unexposed": sum(1 for frame in frames if frame.unexposed),
        "unmatched_notes": sum(1 for frame_id, _ in matched.values() if frame_id is None),
    }


def _average_ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    start = 0
    while start < len(order):
        end = start
        while end + 1 < len(order) and values[order[end + 1]] == values[order[start]]:
            end += 1
        for position in range(start, end + 1):
            ranks[order[position]] = (start + end) / 2 + 1
        start = end + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """Rank correlation with tied values given their average rank; None below 3 pairs or without variation."""
    if len(xs) < MIN_PAIRS or len(set(xs)) < 2 or len(set(ys)) < 2:
        return None
    rank_x, rank_y = _average_ranks(xs), _average_ranks(ys)
    mean_x, mean_y = sum(rank_x) / len(rank_x), sum(rank_y) / len(rank_y)
    covariance = sum((a - mean_x) * (b - mean_y) for a, b in zip(rank_x, rank_y))
    spread = math.sqrt(sum((a - mean_x) ** 2 for a in rank_x) * sum((b - mean_y) ** 2 for b in rank_y))
    return covariance / spread


@dataclass(frozen=True, slots=True)
class Candidate:
    offset: int
    slip_after: int | None
    rho: float | None
    pairs: int


def _score(entries: list[NoteRow], frames: list[FrameRow], offset: int, slip_after: int | None) -> Candidate:
    by_number = {frame.number: frame for frame in frames}
    stops, densities = [], []
    for entry in entries:
        frame = by_number.get(frame_number_for(entry.counter, offset, slip_after))
        if frame is None or entry.misfire or frame.unexposed:
            continue
        stops.append(entry.relative_stops)
        densities.append(frame.net_density)
    return Candidate(offset, slip_after, spearman(stops, densities), len(stops))


@dataclass(frozen=True, slots=True)
class Proposal:
    proposed_offset: int | None
    proposed_slip_after: int | None
    candidates: list[Candidate]
    slip_candidates: list[Candidate]


def _tie_rounded(rho: float) -> float:
    return half_away(rho, RHO_TIE_PLACES)


def propose(entries: list[NoteRow], frames: list[FrameRow]) -> Proposal:
    """Score every offset -2..+2, with and without one slip after a note, and propose the best."""
    ordered = sorted(entries, key=lambda entry: entry.counter)
    plain = [_score(ordered, frames, offset, None) for offset in OFFSETS]
    slips = [_score(ordered, frames, offset, entry.counter) for offset in OFFSETS for entry in ordered[:-1]]
    scored_plain = [c for c in plain if c.rho is not None]
    scored_slips = [c for c in slips if c.rho is not None]
    best_plain = min(scored_plain, key=lambda c: (-_tie_rounded(c.rho), abs(c.offset), c.offset), default=None)
    best_slip = min(scored_slips, key=lambda c: (-_tie_rounded(c.rho), abs(c.offset), c.offset, c.slip_after),
                    default=None)
    if best_slip is not None and (best_plain is None
                                  or half_away(_tie_rounded(best_slip.rho) - _tie_rounded(best_plain.rho),
                                           RHO_TIE_PLACES) >= SLIP_MARGIN):
        return Proposal(best_slip.offset, best_slip.slip_after, plain, slips)
    return Proposal(best_plain.offset if best_plain else None, None, plain, slips)
