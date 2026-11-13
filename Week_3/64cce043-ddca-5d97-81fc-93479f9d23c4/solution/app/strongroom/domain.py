"""Pure domain logic: grading, exposure, steps, masking and the return-path check.

Every rule here is decided once; the API, the previews and the contact view all call these functions.
"""
from __future__ import annotations

import uuid
from dataclasses import dataclass
from datetime import date, datetime
from collections.abc import Iterable
from typing import Literal

from .errors import ApiError


@dataclass(frozen=True, slots=True)
class Kind:
    code: str
    label: str
    steps: tuple[str, str]


@dataclass(frozen=True, slots=True)
class Level:
    code: str
    label: str
    weight: int
    points: int


KINDS: tuple[Kind, ...] = (
    Kind("passport", "Passport", ("Report the passport to the issuing office as compromised", "Apply for a replacement passport")),
    Kind("national_id", "National ID", ("Report the ID number to the issuing authority", "Place a fraud alert with a credit bureau")),
    Kind("driving_licence", "Driving licence", ("Ask the licensing office to flag the licence number", "Request a replacement licence")),
    Kind("bank_account", "Bank account", ("Call the bank fraud line about this account", "Turn on alerts for every transaction")),
    Kind("payment_card", "Payment card", ("Freeze the card in the issuer app", "Order a replacement card with a new number")),
    Kind("health_record", "Health record", ("Ask the provider who accessed your record", "Check insurer statements for care you did not receive")),
    Kind("tax_id", "Tax ID", ("File an identity theft report with the tax office", "Freeze your credit with each credit bureau")),
    Kind("password", "Password", ("Change the password at this company", "Change it anywhere you reused it")),
    Kind("date_of_birth", "Date of birth", ("Add a spoken passphrase to key accounts", "Treat messages that quote your birth date with suspicion")),
    Kind("home_address", "Home address", ("Check for mail redirection you did not request", "Check your credit file for new accounts at this address")),
    Kind("phone", "Phone number", ("Ask your carrier for a port-out lock", "Treat calls that mention this breach with suspicion")),
    Kind("email", "Email address", ("Change the email account password", "Turn on two-step sign-in for the email account")),
)
KIND_BY_CODE: dict[str, Kind] = {k.code: k for k in KINDS}
KIND_ORDER: dict[str, int] = {k.code: i for i, k in enumerate(KINDS)}

LEVELS: tuple[Level, ...] = (
    Level("critical", "Critical", 40, 20),
    Level("high", "High", 20, 10),
    Level("moderate", "Moderate", 8, 4),
    Level("low", "Low", 2, 1),
)
LEVEL_BY_CODE: dict[str, Level] = {lv.code: lv for lv in LEVELS}
LEVEL_RANK: dict[str, int] = {lv.code: i for i, lv in enumerate(LEVELS)}

PERSON_LEVEL_STEPS: frozenset[str] = frozenset({
    "Place a fraud alert with a credit bureau",
    "Freeze your credit with each credit bureau",
    "Add a spoken passphrase to key accounts",
})

DEFAULT_RULES: tuple[tuple[str, str], ...] = (
    ("passport", "critical"), ("national_id", "critical"), ("tax_id", "critical"), ("health_record", "high"),
    ("bank_account", "high"), ("payment_card", "high"), ("driving_licence", "high"), ("password", "high"),
    ("date_of_birth", "moderate"), ("home_address", "moderate"), ("phone", "low"), ("email", "low"),
)

RULE_LIMIT = 50
BAND_EXPOSED = 40
BAND_SEVERE = 100


# --------------------------------------------------------------------------- records


@dataclass(frozen=True, slots=True)
class Holding:
    id: uuid.UUID
    company: str
    company_key: str
    data_kind: str
    value: str
    notes: str
    version: int
    created_at: datetime
    updated_at: datetime
    seq: int


@dataclass(frozen=True, slots=True)
class Rule:
    id: uuid.UUID
    priority: int
    data_kind: str
    company_contains: str
    level: str
    version: int
    seq: int


@dataclass(frozen=True, slots=True)
class Breach:
    id: uuid.UUID | None
    company: str
    company_key: str
    announced_on: date | None
    data_kinds: tuple[str, ...]
    version: int
    created_at: datetime | None
    seq: int


@dataclass(frozen=True, slots=True)
class Snapshot:
    vault_id: uuid.UUID
    holdings: tuple[Holding, ...]
    rules: tuple[Rule, ...]
    breaches: tuple[Breach, ...]
    marks: dict[str, tuple[uuid.UUID, bool]]


@dataclass(frozen=True, slots=True)
class Graded:
    holding: Holding
    level: str
    rule: Rule | None
    affected: bool


@dataclass(frozen=True, slots=True)
class Step:
    key: str
    id: uuid.UUID
    holding_id: uuid.UUID
    company: str
    data_kind: str
    level: str
    number: int
    text: str
    done: bool
    points: int
    person_level: bool
    contributors: tuple[uuid.UUID, ...]


@dataclass(frozen=True, slots=True)
class BreachView:
    breach: Breach
    affected_holding_ids: tuple[uuid.UUID, ...]


@dataclass(frozen=True, slots=True)
class View:
    ledger: tuple[Graded, ...]
    breaches: tuple[BreachView, ...]
    steps: tuple[Step, ...]
    score: int
    band: str
    affected_count: int
    open_steps: int
    spelling: dict[str, str]


# --------------------------------------------------------------------------- text helpers


def collapse(text: str) -> str:
    return " ".join(text.split())


def company_key(text: str) -> str:
    return collapse(text).lower()


def rule_label(rule: Rule) -> str:
    kind = "Any kind" if rule.data_kind == "any" else KIND_BY_CODE[rule.data_kind].label
    at = f" at {rule.company_contains}" if rule.company_contains else ""
    return f"{kind}{at} is {LEVEL_BY_CODE[rule.level].label}"


def band_for(score: int) -> str:
    if score <= 0:
        return "Clear"
    if score < BAND_EXPOSED:
        return "Contained"
    return "Exposed" if score < BAND_SEVERE else "Severe"


def masked(value: str, level: str) -> str:
    """A contact sees Critical and High values masked: every letter and digit except the last four becomes `*`,
    and a value with four or fewer is fully replaced. Moderate and Low values show in full."""
    if level not in ("critical", "high"):
        return value
    positions = [i for i, c in enumerate(value) if c.isalnum()]
    keep = set(positions[-4:]) if len(positions) > 4 else set()
    return "".join("*" if c.isalnum() and i not in keep else c for i, c in enumerate(value))


# --------------------------------------------------------------------------- grading and exposure


def order_rules(rules: Iterable[Rule]) -> list[Rule]:
    return sorted(rules, key=lambda r: (r.priority, LEVEL_RANK[r.level], r.seq))


def reprioritised(rules: Iterable[Rule], order: list[uuid.UUID]) -> list[Rule]:
    """The rules with priorities 1..n in the given order (the reorder and its preview share this)."""
    by_id = {r.id: r for r in rules}
    return [Rule(r.id, i, r.data_kind, r.company_contains, r.level, r.version, r.seq)
            for i, r in ((i, by_id[rid]) for i, rid in enumerate(order, 1))]


def deciding_rule(holding: Holding, ordered_rules: list[Rule]) -> Rule | None:
    """The first matching rule in published order: lowest priority, strictest level, earliest created."""
    company_lower = holding.company.lower()
    for rule in ordered_rules:
        if rule.data_kind not in ("any", holding.data_kind):
            continue
        if rule.company_contains and rule.company_contains.lower() not in company_lower:
            continue
        return rule
    return None


def ledger_sorted(holdings: Iterable[Holding]) -> list[Holding]:
    return sorted(holdings, key=lambda h: (h.company_key, KIND_ORDER[h.data_kind]))


def group_spelling(holdings: Iterable[Holding]) -> dict[str, str]:
    """A company group's heading uses the spelling of its earliest-created holding."""
    first: dict[str, Holding] = {}
    for h in holdings:
        if h.company_key not in first or h.seq < first[h.company_key].seq:
            first[h.company_key] = h
    return {key: h.company for key, h in first.items()}


def affected_ids(breach: Breach, ledger: Iterable[Graded]) -> tuple[uuid.UUID, ...]:
    return tuple(g.holding.id for g in ledger
                 if g.holding.company_key == breach.company_key and g.holding.data_kind in breach.data_kinds)


def build_view(
    snapshot: Snapshot,
    *,
    rules: list[Rule] | None = None,
    breaches: tuple[Breach, ...] | None = None,
    scope: frozenset[str] | None = None,
) -> View:
    """The one exposure computation: grading, affected holdings, steps, score and band."""
    ordered = order_rules(snapshot.rules if rules is None else rules)
    spelling = group_spelling(snapshot.holdings)
    graded_all = []
    for h in ledger_sorted(snapshot.holdings):
        rule = deciding_rule(h, ordered)
        graded_all.append((h, rule.level if rule else "low", rule))
    in_scope = [(h, level, rule) for h, level, rule in graded_all if scope is None or level in scope]

    source = snapshot.breaches if breaches is None else breaches
    affected: set[uuid.UUID] = set()
    provisional = tuple(Graded(h, level, rule, False) for h, level, rule in in_scope)
    breach_views: list[BreachView] = []
    for breach in source:
        ids = affected_ids(breach, provisional)
        affected.update(ids)
        if scope is None or ids:
            breach_views.append(BreachView(breach, ids))
    ledger = tuple(Graded(g.holding, g.level, g.rule, g.holding.id in affected) for g in provisional)

    steps = _steps(snapshot, ledger)
    score = sum(s.points for s in steps if not s.done)
    return View(ledger, tuple(breach_views), steps, score, band_for(score), len(affected),
                sum(1 for s in steps if not s.done), spelling)


def step_key(holding: Holding, number: int, text: str) -> str:
    """A person-level step is one per vault; a holding-level step belongs to one holding and kind."""
    return f"p:{text}" if text in PERSON_LEVEL_STEPS else f"h:{holding.id}:{holding.data_kind}:{number}"


def _steps(snapshot: Snapshot, ledger: tuple[Graded, ...]) -> tuple[Step, ...]:
    position = {g.holding.id: i for i, g in enumerate(ledger)}
    merged: dict[str, dict] = {}
    for g in ledger:
        if not g.affected:
            continue
        kind = KIND_BY_CODE[g.holding.data_kind]
        for number, text in enumerate(kind.steps, 1):
            person = text in PERSON_LEVEL_STEPS
            key = step_key(g.holding, number, text)
            merged_step = merged.get(key)
            if merged_step is None:
                merged[key] = {"graded": g, "number": number, "text": text, "person": person, "level": g.level,
                               "contributors": [g.holding.id]}
            else:
                merged_step["contributors"].append(g.holding.id)
                if LEVEL_RANK[g.level] < LEVEL_RANK[merged_step["level"]]:
                    merged_step["level"] = g.level
    steps = []
    for key, merged_step in merged.items():
        # A step not yet stored (only in a preview) is open and gets a stand-in id that never leaves the server.
        step_id, done = snapshot.marks.get(key, (uuid.uuid5(snapshot.vault_id, key), False))
        first: Graded = merged_step["graded"]
        level = merged_step["level"]
        steps.append(Step(key, step_id, first.holding.id, first.holding.company, first.holding.data_kind, level,
                          merged_step["number"], merged_step["text"], done, LEVEL_BY_CODE[level].points,
                          merged_step["person"], tuple(merged_step["contributors"])))
    steps.sort(key=lambda s: (LEVEL_RANK[s.level], position[s.holding_id], s.number))
    return tuple(steps)


# --------------------------------------------------------------------------- step transitions


def _paired_step(steps: tuple[Step, ...], step: Step) -> Step | None:
    """The other step of a holding when both of its steps are holding-level."""
    if step.person_level:
        return None
    other_number = 2 if step.number == 1 else 1
    for s in steps:
        if s.holding_id == step.holding_id and s.number == other_number and not s.person_level:
            return s
    return None


def plan_step_change(steps: tuple[Step, ...], step: Step, action: Literal["done", "reopen"]) -> tuple[list[uuid.UUID], list[uuid.UUID]]:
    """Returns (step ids to mark done, step ids to reopen); raises the published 409 for an illegal move."""
    if action == "done":
        if step.done:
            raise ApiError("step_already_done")
        if step.number == 2:
            first = _paired_step(steps, step)
            if first is not None and not first.done:
                raise ApiError("step_out_of_order")
        return [step.id], []
    if not step.done:
        raise ApiError("step_already_open")
    reopened = [step.id]
    if step.number == 1:
        second = _paired_step(steps, step)
        if second is not None and second.done:
            reopened.append(second.id)
    return [], reopened


# --------------------------------------------------------------------------- return path


def home_for(role: str) -> str:
    return "/vault" if role == "owner" else "/shared"


def safe_return_path(value: str | None, role: str) -> str:
    """The sign-in return target: `value` exactly when it passes every check, else the role's home screen."""
    home = home_for(role)
    if not value or len(value) > 512:
        return home
    if not value.startswith("/") or value[1:2] in ("/", "\\"):
        return home
    if any(c == "\\" or c.isspace() or ord(c) < 32 or ord(c) == 127 for c in value):
        return home
    path = value.split("?", 1)[0]
    if role == "owner":
        allowed = path == "/vault" or path.startswith("/vault/")
    else:
        allowed = path == "/shared"
    return value if allowed else home


# --------------------------------------------------------------------------- grant status


def grant_status(revoked_at: datetime | None, ends_at: datetime, now: datetime) -> str:
    """Decided by the database clock on every request; the end instant itself counts as ended."""
    if revoked_at is not None:
        return "revoked"
    return "expired" if now >= ends_at else "active"


def seconds_left(ends_at: datetime, now: datetime) -> float:
    return (ends_at - now).total_seconds()


def remaining_seconds(status: str, ends_at: datetime, now: datetime) -> int:
    return int(seconds_left(ends_at, now)) if status == "active" else 0


def ordered_levels(levels: Iterable[str]) -> tuple[str, ...]:
    return tuple(sorted(set(levels), key=LEVEL_RANK.__getitem__))


# --------------------------------------------------------------------------- search and facets


@dataclass(frozen=True, slots=True)
class Search:
    q: str
    company: str
    data_kind: str
    level: str


def _matches(g: Graded, search: Search, *, owner: bool, skip: str = "") -> bool:
    h = g.holding
    if search.q:
        needle = search.q.lower()
        fields = [h.company, KIND_BY_CODE[h.data_kind].label] + ([h.value, h.notes] if owner else [])
        if not any(needle in f.lower() for f in fields):
            return False
    if skip != "company" and search.company and company_key(search.company) != h.company_key:
        return False
    if skip != "data_kind" and search.data_kind and search.data_kind != h.data_kind:
        return False
    return skip == "level" or not search.level or search.level == g.level


def search_ledger(view: View, search: Search, *, owner: bool) -> tuple[list[Graded], dict[str, dict[str, int]]]:
    """The matching rows in ledger order and the facet counts; each facet ignores its own filter."""
    holdings = [g for g in view.ledger if _matches(g, search, owner=owner)]
    facets: dict[str, dict[str, int]] = {"company": {}, "data_kind": {}, "level": {}}
    for facet, key_of in (("company", lambda g: view.spelling[g.holding.company_key]),
                          ("data_kind", lambda g: g.holding.data_kind), ("level", lambda g: g.level)):
        for g in view.ledger:
            if _matches(g, search, owner=owner, skip=facet):
                key = key_of(g)
                facets[facet][key] = facets[facet].get(key, 0) + 1
    facets["data_kind"] = dict(sorted(facets["data_kind"].items(), key=lambda kv: KIND_ORDER[kv[0]]))
    facets["level"] = dict(sorted(facets["level"].items(), key=lambda kv: LEVEL_RANK[kv[0]]))
    facets["company"] = dict(sorted(facets["company"].items(), key=lambda kv: kv[0].lower()))
    return holdings, facets
