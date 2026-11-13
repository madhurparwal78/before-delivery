"""Grading: the single place that decides a holding's level from the rules."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Sequence

from ..domain import LEVEL_ORDER, LEVEL_STRICTNESS, Kind, KINDS, match_company


@dataclass(frozen=True)
class GradingRule:
    """A grading rule as used by the grader (independent of storage)."""

    id: str
    priority: int
    data_kind: str  # a kind code or "any"
    company_contains: str
    level: str
    version: int = 1
    created_at: Optional[str] = None

    @property
    def kind_label(self) -> str:
        if self.data_kind == "any":
            return "Any kind"
        return KINDS[self.data_kind].label

    @property
    def label(self) -> str:
        text = self.kind_label
        if self.company_contains:
            text += f" at {self.company_contains}"
        from ..domain import LEVELS

        text += f" is {LEVELS[self.level].label}"
        return text

    def matches(self, kind: str, company_key: str, company: str) -> bool:
        if self.data_kind != "any" and self.data_kind != kind:
            return False
        if self.company_contains:
            if self.company_contains.casefold() not in company.casefold():
                return False
        return True


def order_rules(rules: Sequence[GradingRule]) -> list[GradingRule]:
    """Rules are ordered by priority, then by strictest level, then by creation time."""
    return sorted(
        rules,
        key=lambda r: (r.priority, LEVEL_STRICTNESS[r.level], r.created_at or "", r.id),
    )


def grade(
    rules: Sequence[GradingRule],
    kind: str,
    company: str,
) -> tuple[str, Optional[str]]:
    """Return (level, rule_id) for one holding against the given rules.

    The level comes from the matching rules with the lowest priority number;
    among those, the strictest level wins. rule_id names the deciding rule,
    the earliest created among tied rules that give the same level.
    """
    company_key = match_company(company)
    best_level: Optional[str] = None
    best_priority: Optional[int] = None
    best_rule: Optional[GradingRule] = None
    for rule in order_rules(rules):
        if not rule.matches(kind, company_key, company):
            continue
        if best_priority is None or rule.priority < best_priority:
            best_priority = rule.priority
            best_level = rule.level
            best_rule = rule
        elif rule.priority == best_priority and best_level is not None:
            if LEVEL_ORDER[rule.level] < LEVEL_ORDER[best_level]:
                best_level = rule.level
                best_rule = rule
            elif rule.level == best_level and best_rule is not None:
                if (rule.created_at or "") < (best_rule.created_at or ""):
                    best_rule = rule
    if best_level is None:
        return "low", None
    return best_level, (best_rule.id if best_rule else None)
