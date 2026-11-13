"""Grading: the one place a holding's level is decided."""
from __future__ import annotations

from .kinds import ANY_KIND, DEFAULT_LEVEL, LEVEL_RANK, kind_label, level_label
from .records import GradingRule, Holding


def rule_sort_key(rule: GradingRule) -> tuple[int, int, float, str]:
    """Rule order: priority, then strictest level, then creation time."""
    return (rule.priority, LEVEL_RANK[rule.level], rule.created_at.timestamp(), rule.id)


def in_rule_order(rules: list[GradingRule]) -> list[GradingRule]:
    return sorted(rules, key=rule_sort_key)


def rule_label(rule: GradingRule) -> str:
    kind = "Any kind" if rule.data_kind == ANY_KIND else kind_label(rule.data_kind)
    where = f" at {rule.company_contains}" if rule.company_contains else ""
    return f"{kind}{where} is {level_label(rule.level)}"


def matches(rule: GradingRule, holding: Holding) -> bool:
    if rule.data_kind != ANY_KIND and rule.data_kind != holding.data_kind:
        return False
    if rule.company_contains:
        return rule.company_contains.casefold() in holding.company.casefold()
    return True


def grade(holding: Holding, rules: list[GradingRule]) -> tuple[str, str | None]:
    """Return the holding's level and the id of the deciding rule."""
    candidates = [rule for rule in rules if matches(rule, holding)]
    if not candidates:
        return DEFAULT_LEVEL, None
    lowest_priority = min(rule.priority for rule in candidates)
    tied = [rule for rule in candidates if rule.priority == lowest_priority]
    level = min((rule.level for rule in tied), key=lambda code: LEVEL_RANK[code])
    deciding = min(
        (rule for rule in tied if rule.level == level),
        key=lambda rule: (rule.created_at, rule.id),
    )
    return level, deciding.id


def grade_all(
    holdings: list[Holding], rules: list[GradingRule]
) -> dict[str, tuple[str, str | None]]:
    return {holding.id: grade(holding, rules) for holding in holdings}
