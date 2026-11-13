"""The caller's view: the one place that projects API objects for each role.

Owners see every published key; contacts see only the published contact fields,
with Critical and High values masked on the server.
"""

from __future__ import annotations

from typing import Any, Optional

from ..auth.store import Context
from ..core.exposure import Step
from ..core.grant_state import GrantView, grant_status
from ..core.masking import mask_value
from ..domain import LEVELS


def _iso(value: Any) -> Optional[str]:
    if value is None:
        return None
    dt = value
    if hasattr(dt, "strftime"):
        if dt.tzinfo is None:
            from datetime import timezone

            dt = dt.replace(tzinfo=timezone.utc)
        from datetime import timezone

        dt = dt.astimezone(timezone.utc)
        return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"
    return str(value)


def holding_for(ctx: Context, holding: dict) -> dict:
    """Owner shape: every published key. Contact shape: masked, no version."""
    if ctx.account.role == "owner":
        return {
            "id": holding["id"],
            "company": holding["company"],
            "data_kind": holding["data_kind"],
            "value": holding["value"],
            "notes": holding["notes"],
            "level": holding["level"],
            "rule_id": holding.get("rule_id"),
            "affected": holding["affected"],
            "version": holding["version"],
            "created_at": _iso(holding["created_at"]),
            "updated_at": _iso(holding["updated_at"]),
        }
    return {
        "id": holding["id"],
        "company": holding["company"],
        "data_kind": holding["data_kind"],
        "level": holding["level"],
        "value": mask_value(holding["value"], holding["level"]),
        "affected": holding["affected"],
    }


def holding_summary_for(ctx: Context, holding: dict) -> dict:
    """A holding inside the holdings list or preview tables (same shape as detail)."""
    return holding_for(ctx, holding)


def breach_for(ctx: Context, breach: dict) -> dict:
    """Owner shape includes version and created_at; the contact's does not."""
    if ctx.account.role == "owner":
        return {
            "id": breach["id"],
            "company": breach["company"],
            "announced_on": str(breach["announced_on"]),
            "data_kinds": breach["kinds"],
            "affected_holding_ids": breach["affected_holding_ids"],
            "version": breach["version"],
            "created_at": _iso(breach["created_at"]),
        }
    return {
        "id": breach["id"],
        "company": breach["company"],
        "announced_on": str(breach["announced_on"]),
        "data_kinds": breach["kinds"],
        "affected_holding_ids": breach["affected_holding_ids"],
    }


def step_for(step: Step) -> dict:
    """The step shape is the same for owners and contacts."""
    return {
        "id": step.id,
        "holding_id": step.holding_id,
        "company": step.company,
        "data_kind": step.data_kind,
        "level": step.level,
        "number": step.number,
        "text": step.text,
        "status": step.status,
        "points": step.points,
    }


def exposure_for(exposure) -> dict:
    return {
        "score": exposure.score,
        "band": exposure.band,
        "affected_count": exposure.affected_count,
        "open_steps": exposure.open_steps,
        "steps": [step_for(s) for s in exposure.steps],
    }


def rule_for(rule) -> dict:
    return {
        "id": rule.id,
        "priority": rule.priority,
        "data_kind": rule.data_kind,
        "company_contains": rule.company_contains,
        "level": rule.level,
        "label": rule.label,
        "version": rule.version,
    }


def grant_for(grant: GrantView, status: str, remaining_seconds: int) -> dict:
    ends_at = _iso(grant.ends_at) if grant.ends_at is not None else None
    return {
        "id": grant.id,
        "status": status,
        "contact_name": grant.contact_name,
        "contact_email": grant.contact_email,
        "duration": grant.duration,
        "levels": list(grant.levels),
        "created_at": _iso(grant.created_at),
        "ends_at": ends_at,
        "remaining_seconds": remaining_seconds,
    }


def contact_grant_for(status: str, remaining: int, levels: list[str], owner_name: str, ends_at) -> dict:
    return {
        "status": status,
        "ends_at": _iso(ends_at) if ends_at is not None else None,
        "remaining_seconds": remaining,
        "levels": levels,
        "owner_name": owner_name,
    }
