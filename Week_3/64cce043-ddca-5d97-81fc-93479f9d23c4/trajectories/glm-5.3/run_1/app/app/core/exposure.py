"""Exposure computation: affected holdings, next steps, score and band.

One computation produces the score, band, affected list and step list, and every
surface (dashboard, breach detail, holdings list, previews, contact view) calls
this one place.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Iterable, Optional, Sequence

from ..domain import (
    LEVEL_STRICTNESS,
    PERSON_LEVEL_STEP_TEXTS,
    Kind,
    KINDS,
    KIND_ORDER,
    LEVELS,
    band_for_score,
    match_company,
)


@dataclass(frozen=True)
class HoldingView:
    """A holding as the computation sees it."""

    id: str
    company: str
    data_kind: str
    level: str
    created_at: Optional[str] = None


@dataclass(frozen=True)
class BreachView:
    id: str
    company: str
    data_kinds: tuple[str, ...]


@dataclass
class Step:
    """A next step as published by the API."""

    id: str
    holding_id: str
    company: str
    data_kind: str
    level: str
    number: int
    text: str
    status: str
    points: int


@dataclass
class Exposure:
    score: int
    band: str
    affected_count: int
    open_steps: int
    steps: list[Step] = field(default_factory=list)


def ledger_position(h: HoldingView) -> tuple[int, str]:
    """Ledger order: companies A to Z case-insensitively, then the published kind order."""
    return (KIND_ORDER.get(h.data_kind, 99), h.data_kind)


def sort_holdings(holdings: Iterable[HoldingView]) -> list[HoldingView]:
    def key(h: HoldingView) -> tuple:
        return (match_company(h.company), KIND_ORDER.get(h.data_kind, 99), h.created_at or "", h.id)

    return sorted(holdings, key=key)


def affected_holding_ids(
    holdings: Sequence[HoldingView],
    breaches: Sequence[BreachView],
) -> list[str]:
    """Holdings affected by any breach with the same company and the holding's kind."""
    by_company: dict[str, set[str]] = {}
    for b in breaches:
        by_company.setdefault(match_company(b.company), set()).update(b.data_kinds)
    affected = [h for h in holdings if h.data_kind in by_company.get(match_company(h.company), set())]
    return [h.id for h in sort_holdings(affected)]


def compute_exposure(
    holdings: Sequence[HoldingView],
    breaches: Sequence[BreachView],
    done_marks: Optional[dict[str, bool]] = None,
) -> Exposure:
    """Compute the exposure score, band, affected count and ordered next steps."""
    done_marks = done_marks or {}
    by_id: dict[str, HoldingView] = {h.id: h for h in holdings}
    affected_ids = set(affected_holding_ids(holdings, breaches))
    affected = [by_id[hid] for hid in affected_ids]
    ordered = sort_holdings(affected)
    position = {h.id: i for i, h in enumerate(sort_holdings(holdings))}

    steps: list[Step] = []
    for h in ordered:
        kind: Kind = KINDS[h.data_kind]
        for number, text in enumerate(kind.steps, start=1):
            step_id = f"{h.id}:{number}"
            done = done_marks.get(step_id, False)
            if text in PERSON_LEVEL_STEP_TEXTS:
                continue  # person-level steps merge below
            steps.append(
                Step(
                    id=step_id,
                    holding_id=h.id,
                    company=h.company,
                    data_kind=h.data_kind,
                    level=h.level,
                    number=number,
                    text=text,
                    status="done" if done else "open",
                    points=LEVELS[h.level].step_points,
                )
            )

    # Person-level steps: at most one per text, anchored to the first contributor
    # in ledger order, at the strictest contributor's level, keeping id and done
    # mark while at least one contributor remains.
    contributors: dict[str, list[HoldingView]] = {}
    for h in ordered:
        kind = KINDS[h.data_kind]
        for number, text in enumerate(kind.steps, start=1):
            if text in PERSON_LEVEL_STEP_TEXTS:
                contributors.setdefault(text, []).append(h)

    for text, holders in contributors.items():
        first = holders[0]
        number = KINDS[first.data_kind].steps.index(text) + 1
        strictest = holders[0].level
        for other in holders[1:]:
            if LEVEL_STRICTNESS[other.level] < LEVEL_STRICTNESS[strictest]:
                strictest = other.level
        step_id = f"person:{first.id}:{number}"
        done = done_marks.get(step_id, False)
        steps.append(
            Step(
                id=step_id,
                holding_id=first.id,
                company=first.company,
                data_kind=first.data_kind,
                level=strictest,
                number=number,
                text=text,
                status="done" if done else "open",
                points=LEVELS[strictest].step_points,
            )
        )

    # Order: level (strictest first), then ledger position of holding_id, then number.
    steps.sort(
        key=lambda s: (
            LEVEL_STRICTNESS[s.level],
            position.get(s.holding_id, 10_000),
            s.number,
        )
    )

    score = sum(LEVELS[s.level].step_points for s in steps if s.status == "open")
    open_steps = sum(1 for s in steps if s.status == "open")
    return Exposure(
        score=score,
        band=band_for_score(score),
        affected_count=len(affected_ids),
        open_steps=open_steps,
        steps=steps,
    )
