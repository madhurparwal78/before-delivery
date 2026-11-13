"""Field projection: the exact keys each role receives."""
from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Final

from .exposure import VaultView
from .grading import rule_label
from .masking import mask_value
from .records import Breach, GradingRule, Holding

OWNER: Final = "owner"
CONTACT: Final = "contact"


def timestamp(moment: datetime) -> str:
    """UTC ISO 8601 with milliseconds and a trailing Z."""
    utc = moment.astimezone(timezone.utc)
    return f"{utc:%Y-%m-%dT%H:%M:%S}.{utc.microsecond // 1000:03d}Z"


def iso_date(day: date) -> str:
    return day.isoformat()


def holding_json(holding: Holding, view: VaultView, role: str) -> dict[str, object]:
    level = view.levels[holding.id]
    if role == CONTACT:
        return {
            "id": holding.id,
            "company": holding.company,
            "data_kind": holding.data_kind,
            "level": level,
            "value": mask_value(holding.value, level),
            "affected": holding.id in view.affected,
        }
    return {
        "id": holding.id,
        "company": holding.company,
        "data_kind": holding.data_kind,
        "value": holding.value,
        "notes": holding.notes,
        "level": level,
        "rule_id": view.rule_ids[holding.id],
        "affected": holding.id in view.affected,
        "version": holding.version,
        "created_at": timestamp(holding.created_at),
        "updated_at": timestamp(holding.updated_at),
    }


def breach_json(breach: Breach, view: VaultView, role: str) -> dict[str, object]:
    affected_ids = view.breach_affected.get(breach.id, [])
    if role == CONTACT:
        return {
            "id": breach.id,
            "company": breach.company,
            "announced_on": iso_date(breach.announced_on),
            "data_kinds": list(breach.data_kinds),
            "affected_holding_ids": affected_ids,
        }
    return {
        "id": breach.id,
        "company": breach.company,
        "announced_on": iso_date(breach.announced_on),
        "data_kinds": list(breach.data_kinds),
        "affected_holding_ids": affected_ids,
        "version": breach.version,
        "created_at": timestamp(breach.created_at),
    }


def rule_json(rule: GradingRule) -> dict[str, object]:
    return {
        "id": rule.id,
        "priority": rule.priority,
        "data_kind": rule.data_kind,
        "company_contains": rule.company_contains,
        "level": rule.level,
        "label": rule_label(rule),
        "version": rule.version,
    }
