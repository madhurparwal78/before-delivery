"""Compliance rules (brief: Business rules). Each rule is decided here and only here."""

import math
import re
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal

from . import clock
from .errors import ApiError

MODELS = {"ATR72-212A": "ATR 72", "DHC-8-402": "Dash 8-400", "ERJ-170-200": "E175"}
AUTHORITIES = ("EASA", "UK CAA", "ATR", "De Havilland", "Embraer")
NUMBER_FORMATS = {
    "EASA": re.compile(r"\d{4}-\d{4}"),
    "UK CAA": re.compile(r"G-\d{4}-\d{4}"),
    "ATR": re.compile(r"ATR72-\d{2}-\d{4}"),
    "De Havilland": re.compile(r"84-\d{2}-\d{4}"),
    "Embraer": re.compile(r"E170-\d{2}-\d{4}"),
}
ROLE_LABELS = {
    "compliance_planner": "Compliance planner",
    "licensed_inspector": "Licensed inspector",
    "certifying_engineer": "Certifying engineer",
    "records_clerk": "Records clerk",
    "regulator_auditor": "Regulator auditor",
}

# Permissions table: the one role allowed to perform each write action.
PERMISSIONS = {
    "ingest": "compliance_planner", "upload_document": "compliance_planner", "withdraw": "compliance_planner",
    "deferral": "compliance_planner", "effectivity": "compliance_planner", "log_hours": "compliance_planner",
    "claim": "licensed_inspector", "release": "licensed_inspector", "attach_evidence": "licensed_inspector",
    "inspection": "licensed_inspector", "countersign": "certifying_engineer",
    "import": "records_clerk", "reopen": "records_clerk", "scope": "records_clerk", "erase": "records_clerk",
    "pack": "records_clerk",
}
HOLDER_ACTIONS = {"release", "attach_evidence", "inspection"}

OPEN_WORK = frozenset({"open", "claimed", "inspected", "superseded_retargeted", "reopened"})
UNCOUNTED = frozenset({"not_applicable", "withdrawn"})

# Stage transitions: action -> {from stage: to stage}. Anything else is invalid_transition.
TRANSITIONS = {
    "claim": {"open": "claimed", "deferred": "claimed", "reopened": "reopened"},
    "release": {"claimed": "open", "reopened": "open"},
    "attach_evidence": {"claimed": "claimed", "reopened": "reopened",
                        "superseded_retargeted": "superseded_retargeted"},
    "inspection": {"claimed": "inspected", "reopened": "inspected"},
    "countersign": {"inspected": "certified"},
    "deferral": {"open": "deferred"},
    "effectivity": {"superseded_retargeted": "superseded_retargeted"},
    "reopen": {"certified": "reopened"},
}
NEEDS_EFFECTIVITY = frozenset({"claim", "inspection", "countersign", "deferral"})

# Transitions the system makes on its own: supersession outcomes, legacy close, erasure releasing a card.
SUPERSESSION = {"added": "open", "retargeted": "superseded_retargeted", "removed": "not_applicable"}
WITHDRAWN = "withdrawn"
LEGACY_CLOSE = {"open": "certified"}
FROZEN = ("limits", "governing", "calendar_used", "hours_used")


def effectivity_outcome(decision: str, has_holder: bool) -> str:
    """Confirming keeps a held card claimed, otherwise reopens the work; rejecting makes the thread not applicable."""
    if decision == "not_applicable":
        return "not_applicable"
    return "claimed" if has_holder else "open"


def released_by_erasure(stage: str) -> str:
    """Erasure clears the holder: a claimed thread returns to open, every other stage keeps its stage."""
    return "open" if stage == "claimed" else stage


def freeze(status: dict) -> dict:
    """Certified threads keep their limits, governing limit and rails as they were at the final countersignature."""
    return {k: status[k] for k in FROZEN}

DEFER_DAYS = 7
DEFER_HOURS = Decimal("25.0")
DUE_SOON_DAYS = 30
DUE_SOON_HOURS = Decimal("50.0")
TWO_PLACES = Decimal("0.01")


def tag(revision: int) -> str:
    return f"R{revision}"


def require_role(user: dict, action: str) -> None:
    if user["role"] != PERMISSIONS[action]:
        raise ApiError("forbidden")


def transition(stage: str, action: str) -> str:
    """The stage an action moves a thread to, or invalid_transition naming the stage and action."""
    target = TRANSITIONS[action].get(stage)
    if target is None:
        raise ApiError("invalid_transition", stage=stage, action=action)
    return target


def in_effectivity(applicability: list[dict], model: str, msn: int) -> bool:
    return any(r["model"] == model and r["msn_from"] <= msn <= r["msn_to"] for r in applicability)


def is_kept(prior_credit: bool, final_countersigned_at: datetime | None, effective: date) -> bool:
    """Credit and effective date: signed before 00:00 base time on the new revision's effective date."""
    return (prior_credit and final_countersigned_at is not None
            and final_countersigned_at < clock.base_instant(effective))


@dataclass(frozen=True)
class Rule:
    effective_date: date
    calendar_days: int
    fh_interval: Decimal


@dataclass(frozen=True)
class Tail:
    registration: str
    model: str
    msn: int
    total: Decimal
    utilisation: Decimal
    log: tuple[tuple[datetime, Decimal], ...]  # (logged_at, total after the entry), oldest first


def _fraction(value: float) -> float:
    clamped = min(1.0, max(0.0, value))
    return float(Decimal(repr(clamped)).quantize(TWO_PLACES, rounding=ROUND_HALF_UP))


def evaluate(rule: Rule, baseline: Decimal, deferred: bool, entered_at: datetime, tail: Tail,
             now: datetime) -> dict:
    """Limits, due instant, due-soon start, governing limit and both rails for one thread."""
    deadline = rule.effective_date + timedelta(days=rule.calendar_days + (DEFER_DAYS if deferred else 0))
    calendar_due = clock.base_instant(deadline, 23, 59, 59)
    threshold = baseline + rule.fh_interval + (DEFER_HOURS if deferred else 0)
    hours_passed = tail.total > threshold
    hours_due = next((at for at, total in tail.log if total > threshold), entered_at) if hours_passed else None
    due_at = calendar_due if hours_due is None else min(calendar_due, hours_due)

    soon_mark = threshold - DUE_SOON_HOURS
    soon_by_hours = (entered_at if baseline >= soon_mark
                     else next((at for at, total in tail.log if total >= soon_mark), None))
    soon_by_calendar = clock.base_instant(deadline - timedelta(days=DUE_SOON_DAYS))
    due_soon_from = min(soon_by_calendar, soon_by_hours) if soon_by_hours else soon_by_calendar

    calendar_passed = now > calendar_due
    if calendar_passed and hours_passed:
        governing = "CAL" if calendar_due <= hours_due else "FH"
    elif hours_passed:
        governing = "FH"
    elif calendar_passed:
        governing = "CAL"
    else:
        remaining = threshold - tail.total
        projected = now.astimezone(clock.BASE_ZONE).date() + timedelta(days=math.ceil(remaining / tail.utilisation))
        governing = "CAL" if deadline <= projected else "FH"

    start = clock.base_instant(rule.effective_date)
    return {
        "limits": {
            "effective_date": rule.effective_date.isoformat(),
            "calendar_days": rule.calendar_days,
            "deadline_date": deadline.isoformat(),
            "calendar_due_at": clock.iso(calendar_due),
            "fh_interval": float(rule.fh_interval),
            "fh_baseline": float(baseline),
            "fh_threshold": float(threshold),
            "deferred": deferred,
            "due_at": clock.iso(due_at),
            "due_soon_from": clock.iso(due_soon_from),
        },
        "governing": governing,
        "calendar_used": _fraction((now - start) / (calendar_due - start)),
        "hours_used": _fraction(float((tail.total - baseline) / (threshold - baseline))),
        "past_due": now > due_at or hours_passed,
        "due_soon": now >= due_soon_from,
        "on_time": now <= calendar_due and not hours_passed,
    }


def reported_state(stage: str, past_due: bool) -> str:
    return "overdue" if past_due and (stage in OPEN_WORK or stage == "deferred") else stage


def label(stage: str, state: str, due_soon: bool) -> str:
    """Status label by the published precedence."""
    if stage == "withdrawn":
        return "Withdrawn"
    if stage == "not_applicable":
        return "Not applicable"
    if stage == "certified":
        return "Complied"
    if state == "overdue":
        return "Overdue"
    if stage == "superseded_retargeted":
        return "Superseded"
    if stage == "deferred":
        return "Deferred"
    if due_soon:
        return "Due soon"
    return "Open"


def count_bucket(stage: str, state: str, due_soon: bool) -> str | None:
    """Which board count a thread falls in; None for threads that are not counted."""
    if stage in UNCOUNTED:
        return None
    if stage == "certified":
        return "complied"
    if state == "overdue":
        return "overdue"
    if stage == "deferred":
        return "deferred"
    if due_soon:
        return "due_soon"
    return "open"


def empty_counts() -> dict:
    return {"open": 0, "due_soon": 0, "overdue": 0, "deferred": 0, "complied": 0}


def scope_covers(scope: list[str] | None, model: str) -> bool:
    return model in (scope or [])


def next_certifier(standby: list[dict], model: str, skip: str | None = None) -> dict | None:
    """First engineer on the model's standby list whose current scope covers the model."""
    return next((e for e in standby if e["id"] != skip and scope_covers(e["scope"], model)), None)


# Legacy import normalisation (brief: Legacy import).

_DIRECTIVE_PREFIX = re.compile(r"^(?:(?:EASA|CAA|AD|SB)[ -])+")
_DIRECTIVE_SEPARATORS = re.compile(r"[ /._]+")


def normalise_tail(text: str) -> str:
    return text.upper().replace("-", "").replace(" ", "")


def normalise_directive(text: str) -> str:
    return _DIRECTIVE_SEPARATORS.sub("-", _DIRECTIVE_PREFIX.sub("", text.strip().upper()))


def directive_matches(row_value: str, published: str) -> bool:
    ours, theirs = normalise_directive(row_value).split("-"), normalise_directive(published).split("-")
    return len(ours) == len(theirs) and all(
        a == b or (a.isdigit() and b.isdigit() and int(a) == int(b)) for a, b in zip(ours, theirs, strict=True))


def normalise_revision(text: str) -> int | None:
    value = text.upper().replace(" ", "")
    if value in ("ORIG", "ORIGINAL"):
        return 1
    for prefix in ("REV", "R"):
        if value.startswith(prefix):
            value = value[len(prefix):]
            break
    return int(value) if value.isdigit() and int(value) >= 1 else None
