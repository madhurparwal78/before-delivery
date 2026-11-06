"""Matching notes to frames, the alignment proposal, counters and roll states."""

from __future__ import annotations

from dataclasses import dataclass

from .frames import is_unexposed
from .rounding import round_half_away

OFFSETS = (-2, -1, 0, 1, 2)
MIN_PAIRS = 3
SLIP_MARGIN = 0.10
RHO_PRECISION = 6
CURVE_READY_FRAMES = 7
CURVE_READY_SPAN = 6.0


@dataclass(frozen=True)
class EntryFacts:
    """What matching and scoring need to know about one shooting-log entry."""

    id: str
    counter: int
    misfire: bool
    relative_stops: float


@dataclass(frozen=True)
class FrameFacts:
    """What matching and scoring need to know about one frame."""

    id: str
    number: int
    net_density: float | None
    blank_slot: bool

    @property
    def unexposed(self) -> bool:
        return self.net_density is None or is_unexposed(self.net_density)


def offset_match(
    entries: list[EntryFacts],
    frames: list[FrameFacts],
    offset: int,
    slip_after: int | None,
    claimed: frozenset[str] = frozenset(),
) -> dict[str, str]:
    """Step 3 of matching: counter plus offset, with one optional slip."""
    by_number = {frame.number: frame for frame in frames}
    taken: set[str] = set(claimed)
    matches: dict[str, str] = {}
    for entry in sorted(entries, key=lambda item: item.counter):
        number = entry.counter + offset
        if slip_after is not None and entry.counter > slip_after:
            number += 1
        frame = by_number.get(number)
        if frame is None or frame.id in taken:
            continue
        matches[entry.id] = frame.id
        taken.add(frame.id)
    return matches


def apply_alignment(
    entries: list[EntryFacts],
    frames: list[FrameFacts],
    offset: int | None,
    slip_after: int | None,
    overrides: dict[str, str | None],
) -> dict[str, str | None]:
    """The saved alignment, overrides first. None means explicitly unmatched."""
    matches: dict[str, str | None] = {}
    claimed: set[str] = set()
    for entry_id, frame_id in overrides.items():
        matches[entry_id] = frame_id
        if frame_id is not None:
            claimed.add(frame_id)
    if offset is None:
        return matches
    rest = [entry for entry in entries if entry.id not in overrides]
    matches.update(offset_match(rest, frames, offset, slip_after, frozenset(claimed)))
    return matches


def _ranks(values: list[float]) -> list[float]:
    order = sorted(range(len(values)), key=lambda index: values[index])
    ranks = [0.0] * len(values)
    position = 0
    while position < len(order):
        stop = position
        while stop + 1 < len(order) and values[order[stop + 1]] == values[order[position]]:
            stop += 1
        average = (position + stop) / 2 + 1
        for index in range(position, stop + 1):
            ranks[order[index]] = average
        position = stop + 1
    return ranks


def spearman(xs: list[float], ys: list[float]) -> float | None:
    """The rank correlation, with tied values given their average rank."""
    if len(xs) < MIN_PAIRS or len(set(xs)) < 2 or len(set(ys)) < 2:
        return None
    rank_x = _ranks(xs)
    rank_y = _ranks(ys)
    n = len(xs)
    mean_x = sum(rank_x) / n
    mean_y = sum(rank_y) / n
    covariance = sum((a - mean_x) * (b - mean_y) for a, b in zip(rank_x, rank_y))
    spread_x = sum((a - mean_x) ** 2 for a in rank_x) ** 0.5
    spread_y = sum((b - mean_y) ** 2 for b in rank_y) ** 0.5
    if spread_x == 0 or spread_y == 0:
        return None
    return covariance / (spread_x * spread_y)


@dataclass(frozen=True)
class Candidate:
    offset: int
    slip_after: int | None
    rho: float | None
    pairs: int


def score_candidate(
    entries: list[EntryFacts],
    frames: list[FrameFacts],
    offset: int,
    slip_after: int | None,
) -> Candidate:
    matches = offset_match(entries, frames, offset, slip_after)
    by_id = {frame.id: frame for frame in frames}
    entries_by_id = {entry.id: entry for entry in entries}
    stops: list[float] = []
    densities: list[float] = []
    for entry_id, frame_id in matches.items():
        entry = entries_by_id[entry_id]
        frame = by_id[frame_id]
        if entry.misfire or frame.unexposed:
            continue
        stops.append(entry.relative_stops)
        densities.append(frame.net_density if frame.net_density is not None else 0.0)
    return Candidate(offset, slip_after, spearman(stops, densities), len(stops))


@dataclass(frozen=True)
class Proposal:
    proposed_offset: int | None
    proposed_slip_after: int | None
    candidates: list[Candidate]
    slip_candidates: list[Candidate]


def propose(entries: list[EntryFacts], frames: list[FrameFacts]) -> Proposal:
    candidates = [
        score_candidate(entries, frames, offset, None) for offset in OFFSETS
    ]
    counters = sorted(entry.counter for entry in entries)
    slip_counters = counters[:-1] if counters else []
    slip_candidates = [
        score_candidate(entries, frames, offset, slip)
        for offset in OFFSETS
        for slip in slip_counters
    ]
    best_no_slip = _best(candidates)
    best_slip = _best(slip_candidates)
    if best_slip is not None and (
        best_no_slip is None
        or round_half_away(best_slip.rho or 0.0, RHO_PRECISION)
        - round_half_away(best_no_slip.rho or 0.0, RHO_PRECISION)
        >= SLIP_MARGIN
    ):
        return Proposal(
            best_slip.offset, best_slip.slip_after, candidates, slip_candidates
        )
    if best_no_slip is None:
        return Proposal(None, None, candidates, slip_candidates)
    return Proposal(best_no_slip.offset, None, candidates, slip_candidates)


def _best(candidates: list[Candidate]) -> Candidate | None:
    scored = [item for item in candidates if item.rho is not None]
    if not scored:
        return None
    return min(
        scored,
        key=lambda item: (
            -round_half_away(item.rho or 0.0, RHO_PRECISION),
            abs(item.offset),
            item.offset,
            item.slip_after if item.slip_after is not None else -1,
        ),
    )


def counters(
    entries: list[EntryFacts],
    frames: list[FrameFacts],
    matches: dict[str, str | None],
) -> dict[str, int]:
    matched = sum(1 for entry in entries if matches.get(entry.id) is not None)
    return {
        "detected": len(frames),
        "aligned": matched,
        "unexposed": sum(1 for frame in frames if frame.unexposed),
        "unmatched_notes": len(entries) - matched,
    }


def normal_roll_state(
    has_scan: bool,
    alignment_saved: bool,
    entries: list[EntryFacts],
    matches: dict[str, str | None],
) -> str:
    if (
        alignment_saved
        and entries
        and all(entry.id in matches for entry in entries)
    ):
        return "aligned"
    if has_scan:
        return "developed"
    return "logging"


def bracket_stops(
    entries: list[EntryFacts], matches: dict[str, str | None]
) -> list[float]:
    """The relative stops of a test roll's matched, non-misfire entries."""
    return [
        entry.relative_stops
        for entry in entries
        if not entry.misfire and matches.get(entry.id) is not None
    ]


def test_roll_state(stops: list[float]) -> str:
    if len(stops) >= CURVE_READY_FRAMES and (max(stops) - min(stops)) >= CURVE_READY_SPAN:
        return "curve-ready"
    return "logging"
