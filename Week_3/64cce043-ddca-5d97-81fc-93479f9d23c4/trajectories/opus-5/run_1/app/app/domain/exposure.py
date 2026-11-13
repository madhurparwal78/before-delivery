"""The one exposure computation: grading, affected holdings, next steps, score and band."""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Final

from .kinds import (
    KIND_BY_CODE,
    LEVEL_RANK,
    band_for,
    is_person_level,
    step_points,
    strictest,
)
from .grading import grade, in_rule_order
from .records import Breach, GradingRule, Holding, in_ledger_order

PERSON_STEP_SLUGS: Final[dict[str, str]] = {
    "Place a fraud alert with a credit bureau": "fraud-alert",
    "Freeze your credit with each credit bureau": "credit-freeze",
    "Add a spoken passphrase to key accounts": "passphrase",
}


@dataclass(frozen=True, slots=True)
class NextStep:
    id: str
    holding_id: str
    company: str
    data_kind: str
    level: str
    number: int
    text: str
    status: str
    points: int

    def as_json(self) -> dict[str, object]:
        return {
            "id": self.id,
            "holding_id": self.holding_id,
            "company": self.company,
            "data_kind": self.data_kind,
            "level": self.level,
            "number": self.number,
            "text": self.text,
            "status": self.status,
            "points": self.points,
        }


@dataclass(slots=True)
class VaultView:
    """Everything every surface reads: one computation per vault state and scope."""

    holdings: list[Holding]
    rules: list[GradingRule]
    breaches: list[Breach]
    levels: dict[str, str]
    rule_ids: dict[str, str | None]
    affected: set[str] = field(default_factory=set)
    breach_affected: dict[str, list[str]] = field(default_factory=dict)
    steps: list[NextStep] = field(default_factory=list)
    score: int = 0

    @property
    def band(self) -> str:
        return band_for(self.score)

    @property
    def open_steps(self) -> int:
        return sum(1 for step in self.steps if step.status == "open")

    def holding(self, holding_id: str) -> Holding | None:
        for holding in self.holdings:
            if holding.id == holding_id:
                return holding
        return None

    def breach(self, breach_id: str) -> Breach | None:
        for breach in self.breaches:
            if breach.id == breach_id:
                return breach
        return None

    def step(self, step_id: str) -> NextStep | None:
        for step in self.steps:
            if step.id == step_id:
                return step
        return None

    def exposure_json(self) -> dict[str, object]:
        return {
            "score": self.score,
            "band": self.band,
            "affected_count": len(self.affected),
            "open_steps": self.open_steps,
            "steps": [step.as_json() for step in self.steps],
        }

    def valid_step_ids(self) -> set[str]:
        return {step.id for step in self.steps}


def holding_step_id(holding: Holding, number: int) -> str:
    return f"h.{holding.id}.{holding.data_kind}.{number}"


def person_step_id(vault_id: str, text: str) -> str:
    return f"p.{vault_id}.{PERSON_STEP_SLUGS[text]}"


def compute(
    vault_id: str,
    holdings: list[Holding],
    rules: list[GradingRule],
    breaches: list[Breach],
    done_step_ids: set[str],
    scope_levels: frozenset[str] | None = None,
) -> VaultView:
    """Grade every holding, work out exposure, and order the next steps.

    With `scope_levels` the computation runs only over the holdings a trusted
    contact may see, so their score and steps cover their scope alone.
    """
    ordered_rules = in_rule_order(rules)
    graded = {holding.id: grade(holding, ordered_rules) for holding in holdings}

    visible = in_ledger_order(holdings)
    if scope_levels is not None:
        visible = [h for h in visible if graded[h.id][0] in scope_levels]
    visible_ids = {holding.id for holding in visible}
    position = {holding.id: index for index, holding in enumerate(visible)}

    breached_kinds: dict[str, set[str]] = {}
    for breach in breaches:
        breached_kinds.setdefault(breach.company_key, set()).update(breach.data_kinds)

    affected = {
        holding.id
        for holding in visible
        if holding.data_kind in breached_kinds.get(holding.company_key, ())
    }

    breach_affected: dict[str, list[str]] = {}
    visible_breaches: list[Breach] = []
    for breach in breaches:
        touched = [
            holding.id
            for holding in visible
            if holding.company_key == breach.company_key
            and holding.data_kind in breach.data_kinds
        ]
        breach_affected[breach.id] = touched
        if scope_levels is None or touched:
            visible_breaches.append(breach)

    steps = _next_steps(vault_id, visible, graded, affected, done_step_ids, position)
    score = sum(step.points for step in steps if step.status == "open")

    return VaultView(
        holdings=visible,
        rules=ordered_rules,
        breaches=visible_breaches,
        levels={hid: level for hid, (level, _) in graded.items() if hid in visible_ids},
        rule_ids={hid: rid for hid, (_, rid) in graded.items() if hid in visible_ids},
        affected=affected,
        breach_affected=breach_affected,
        steps=steps,
        score=score,
    )


def _next_steps(
    vault_id: str,
    visible: list[Holding],
    graded: dict[str, tuple[str, str | None]],
    affected: set[str],
    done_step_ids: set[str],
    position: dict[str, int],
) -> list[NextStep]:
    steps: list[NextStep] = []
    person_contributors: dict[str, list[Holding]] = {}

    for holding in visible:
        if holding.id not in affected:
            continue
        level = graded[holding.id][0]
        for number, text in enumerate(KIND_BY_CODE[holding.data_kind].steps, start=1):
            if is_person_level(text):
                person_contributors.setdefault(text, []).append(holding)
                continue
            step_id = holding_step_id(holding, number)
            steps.append(
                NextStep(
                    id=step_id,
                    holding_id=holding.id,
                    company=holding.company,
                    data_kind=holding.data_kind,
                    level=level,
                    number=number,
                    text=text,
                    status="done" if step_id in done_step_ids else "open",
                    points=step_points(level),
                )
            )

    for text, contributors in person_contributors.items():
        anchor = contributors[0]
        level = strictest([graded[holding.id][0] for holding in contributors])
        number = KIND_BY_CODE[anchor.data_kind].steps.index(text) + 1
        step_id = person_step_id(vault_id, text)
        steps.append(
            NextStep(
                id=step_id,
                holding_id=anchor.id,
                company=anchor.company,
                data_kind=anchor.data_kind,
                level=level,
                number=number,
                text=text,
                status="done" if step_id in done_step_ids else "open",
                points=step_points(level),
            )
        )

    steps.sort(key=lambda step: (LEVEL_RANK[step.level], position[step.holding_id], step.number))
    return steps


def is_holding_level_step(step: NextStep) -> bool:
    return not is_person_level(step.text)


def step_contributors(view: VaultView, step: NextStep) -> list[str]:
    """The affected holdings a step stands for: its own, or every contributor of a
    person-level step."""
    if is_holding_level_step(step):
        return [step.holding_id]
    return [
        holding.id
        for holding in view.holdings
        if holding.id in view.affected
        and step.text in KIND_BY_CODE[holding.data_kind].steps
    ]
