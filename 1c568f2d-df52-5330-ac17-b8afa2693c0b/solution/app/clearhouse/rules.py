"""The clearance rules, each decided here once: the state table, the refusal order for a piece write, the
visibility of another maker's draft, Needs my decision, the field rules, the citation checks, the budget
check and the cleared-today count."""

import re
from dataclasses import dataclass
from datetime import date

from . import shapes
from .db import Row, Tx
from .errors import Refusal, invalid, not_found, role_refused
from .money import format_cents
from .timefmt import quarter_bounds, quarter_of, today

STATES = ("draft", "submitted", "in_review", "changes_requested", "cleared",
          "scheduled", "published", "withdrawn", "rejected")
ROLES = ("maker", "licence_reviewer", "access_reviewer", "lead", "auditor")
ACTIONS = ("submit", "start_review", "clear", "reject", "revise", "schedule",
           "unschedule", "publish", "withdraw", "return_for_changes")
ALLOWED_LICENCES = ("CC0", "Public domain", "CC BY 4.0", "CC BY-SA 4.0")
COMMITTED_STATES = ("cleared", "scheduled", "published")
FEE_MAX = 500000
DEFAULT_BUDGET_CENTS = 500000
CITE_MAX = 40


@dataclass(frozen=True, slots=True)
class Step:
    roles: frozenset[str]
    sources: frozenset[str]
    target: str | None = None
    owner_only: bool = False
    own_piece_rule: bool = False
    second_reviewer: bool = False
    needs_reason: bool = False


def _step(roles: set[str], sources: set[str], target: str | None = None, **flags: bool) -> Step:
    return Step(frozenset(roles), frozenset(sources), target, **flags)


# The state table, plus the writes that act on a piece without being a step of it.
STEPS: dict[str, Step] = {
    "submit": _step({"maker"}, {"draft"}, "submitted", owner_only=True),
    "start_review": _step({"licence_reviewer", "access_reviewer"}, {"submitted"}, "in_review"),
    "licence_review": _step({"licence_reviewer"}, {"in_review"}, own_piece_rule=True),
    "accessibility_review": _step({"access_reviewer"}, {"in_review"}, own_piece_rule=True, second_reviewer=True),
    "clear": _step({"lead"}, {"in_review"}, "cleared", own_piece_rule=True),
    "return_for_changes": _step({"lead"}, {"in_review", "changes_requested"}, "changes_requested", needs_reason=True),
    "reject": _step({"lead"}, {"in_review", "changes_requested"}, "rejected", needs_reason=True),
    "revise": _step({"maker"}, {"changes_requested", "withdrawn"}, "draft", owner_only=True),
    "schedule": _step({"lead"}, {"cleared"}, "scheduled"),
    "unschedule": _step({"lead"}, {"scheduled"}, "cleared"),
    "publish": _step({"lead"}, {"scheduled"}, "published", own_piece_rule=True),
    "withdraw": _step({"lead"}, {"published"}, "withdrawn", needs_reason=True),
    "create": _step({"maker"}, set()),
    "edit": _step({"maker"}, {"draft"}, owner_only=True),
    "review": _step({"licence_reviewer", "access_reviewer"}, {"in_review"}),
    "acknowledge": _step({"licence_reviewer"}, {"in_review"}),
    "adjust_fee": _step({"lead"}, set(STATES)),
    "pack": _step({"lead"}, set()),
}
REVIEW_STEP = {"licence": "licence_review", "accessibility": "accessibility_review"}


# Visibility -----------------------------------------------------------------------------------------------

def visible_clause(account: Row, alias: str = "p") -> str:
    """SQL predicate (parameter :me) a maker uses to never see another maker's draft."""
    if account["role"] != "maker":
        return "TRUE"
    return f"NOT ({alias}.state = 'draft' AND {alias}.owner_id <> :me)"


def needs_clause(account: Row) -> str:
    """SQL predicate (parameter :me) for the pieces waiting on this account's decision."""
    no_review = "NOT EXISTS (SELECT 1 FROM reviews r WHERE r.piece_id = p.id AND r.kind = '{kind}'{extra})"
    match account["role"]:
        case "licence_reviewer":
            return ("p.owner_id <> :me AND (p.state = 'submitted' OR (p.state = 'in_review' AND "
                    + no_review.format(kind="licence", extra="") + "))")
        case "access_reviewer":
            return ("p.owner_id <> :me AND (p.state = 'submitted' OR (p.state = 'in_review' AND "
                    + no_review.format(kind="accessibility", extra="") + " AND "
                    + no_review.format(kind="licence", extra=" AND r.reviewer_id = :me") + "))")
        case "lead":
            return ("(p.state IN ('cleared', 'scheduled') OR (p.state = 'in_review' AND "
                    "(SELECT count(*) FROM reviews r WHERE r.piece_id = p.id AND r.result = 'pass') = 2))")
        case "maker":
            return "p.owner_id = :me AND p.state IN ('draft', 'changes_requested')"
        case _:
            return "FALSE"


# The refusal order for a write on one piece (checks 6 to 14) -------------------------------------------------

def find_piece(tx: Tx, account: Row, piece_id: object, *, lock: bool) -> Row:
    """Check 6: the piece exists and this account may see it."""
    if type(piece_id) is not int or piece_id < 1:
        raise not_found()
    row = tx.one(f"SELECT p.* FROM pieces p WHERE p.id = :id AND {visible_clause(account)}"
                 + (" FOR UPDATE" if lock else ""), id=piece_id, me=account["id"])
    if row is None:
        raise not_found()
    return row


def only_published(body: object, published: tuple[str, ...]) -> dict:
    """Check 7: a JSON object holding only this endpoint's published fields."""
    if not isinstance(body, dict):
        raise Refusal(400, "Send a JSON object")
    for key in body:
        if key not in published:
            raise invalid(key, f"{key} cannot be set here")
    return body


def check_actor(tx: Tx, account: Row, piece: Row | None, step_name: str | None) -> None:
    """Checks 8 to 11: auditor, own piece, second reviewer, then the role table."""
    if account["role"] == "auditor":
        raise role_refused()
    step = STEPS.get(step_name or "")
    if step is None:
        return
    owns = piece is not None and piece["owner_id"] == account["id"]
    if step.own_piece_rule and owns:
        raise Refusal(403, "You cannot review your own piece")
    if step.second_reviewer and tx.value(
            "SELECT 1 FROM reviews WHERE piece_id = :id AND kind = 'licence' AND reviewer_id = :me",
            id=piece["id"], me=account["id"]):
        raise Refusal(403, "A second reviewer is required")
    if account["role"] not in step.roles or (step.owner_only and not owns):
        raise role_refused()


def check_version(tx: Tx, piece: Row, body: dict, *, required: bool) -> None:
    """Checks 12 and 13."""
    if "version" not in body:
        if required:
            raise invalid("version", "A version is required")
        return
    version = body["version"]
    if type(version) is not int:
        raise invalid("version", "A version is required")
    if version != piece["version"]:
        raise Refusal(409, "This piece changed while you were deciding. Reload and try again",
                      extra={"current": shapes.piece(tx, piece["id"])})


def check_state(piece: Row, step_name: str | None) -> None:
    """Check 14."""
    step = STEPS.get(step_name or "")
    if step is None or piece["state"] not in step.sources:
        raise illegal_step(piece["state"])


def illegal_step(state: str) -> Refusal:
    return Refusal(409, f"That is not a legal step from {state}")


def decide(tx: Tx, account: Row, piece_id: object, body: object, published: tuple[str, ...],
           step_name: str | None, *, version_required: bool) -> tuple[Row, dict]:
    """Run checks 6 to 14 for a write on one piece, in the published order; returns the locked piece."""
    piece = find_piece(tx, account, piece_id, lock=True)
    fields = only_published(body, published)
    check_actor(tx, account, piece, step_name)
    check_version(tx, piece, fields, required=version_required)
    check_state(piece, step_name)
    return piece, fields


def rail_actions(tx: Tx, account: Row, piece: Row) -> list[str]:
    """The step names this account may take on this piece from its state, as the desk offers them."""
    if account["role"] == "auditor":
        return []
    reviews = {r["kind"]: r for r in tx.rows("SELECT kind, result, reviewer_id FROM reviews WHERE piece_id = :id",
                                              id=piece["id"])}
    offered = []
    for name, step in STEPS.items():
        if name not in ACTIONS and name not in REVIEW_STEP.values() or piece["state"] not in step.sources:
            continue
        owns = piece["owner_id"] == account["id"]
        if account["role"] not in step.roles or (step.owner_only and not owns) or (step.own_piece_rule and owns):
            continue
        if name in ("licence_review", "accessibility_review") and name.removesuffix("_review") in reviews:
            continue
        if step.second_reviewer and reviews.get("licence", {}).get("reviewer_id") == account["id"]:
            continue
        if name == "clear" and [reviews.get(k, {}).get("result") for k in REVIEW_STEP] != ["pass", "pass"]:
            continue
        if name == "publish" and (booked_day(tx, piece["id"]) or today()) > today():
            continue
        offered.append(name)
    return offered


# Field rules (check 15) ------------------------------------------------------------------------------------

def title(tx: Tx, value: object, *, other_than: int | None = None) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not 1 <= len(text) <= 80:
        raise invalid("title", "A title of 1 to 80 characters is required")
    if title_taken(tx, text, other_than=other_than):
        raise invalid("title", f"A piece named {text} already exists")
    return text


def title_taken(tx: Tx, text: str, *, other_than: int | None = None) -> bool:
    return bool(tx.value("SELECT 1 FROM pieces WHERE lower(title) = lower(:t) AND state <> 'rejected' "
                         "AND id <> :other", t=text, other=other_than or 0))


def summary(value: object) -> str:
    text = value.strip() if isinstance(value, str) else ""
    if not 20 <= len(text) <= 600:
        raise invalid("summary", "A summary of 20 to 600 characters is required")
    return text


def fee_ok(value: object) -> bool:
    return type(value) is int and 0 <= value <= FEE_MAX


def fee(value: object, field_name: str = "fee_cents") -> int:
    if not fee_ok(value):
        raise invalid(field_name, "A fee must be between $0.00 and $5,000.00")
    return value


def reason(value: object) -> str:
    """Validated on its trimmed length; stored exactly as sent."""
    if not isinstance(value, str) or not 10 <= len(value.strip()) <= 400:
        raise invalid("reason", "A reason of 10 to 400 characters is required")
    return value


def object_ids_problem(tx: Tx, value: object) -> str | None:
    if not isinstance(value, list):
        return f"Unknown object {value}"
    if len(value) > CITE_MAX:
        return "Cite at most 40 objects"
    if len(set(value)) != len(value):
        return "Each object may be cited once"
    numbers = [i for i in value if type(i) is int]
    known = {r["id"] for r in tx.rows("SELECT id FROM objects WHERE id = ANY(CAST(:ids AS integer[]))", ids=numbers)}
    missing = next((i for i in value if i not in known), None)
    return None if missing is None else f"Unknown object {missing}"


def object_ids(tx: Tx, value: object) -> list[int]:
    problem = object_ids_problem(tx, value)
    if problem:
        raise invalid("object_ids", problem)
    return value


def kind(value: object) -> str:
    if value not in REVIEW_STEP:
        raise invalid("kind", "Kind must be licence or accessibility")
    return value


def result(value: object) -> str:
    if value not in ("pass", "fail"):
        raise invalid("result", "Result must be pass or fail")
    return value


def day(value: object) -> date:
    if not isinstance(value, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        raise invalid("day", "Use a day written as YYYY-MM-DD")
    try:
        parsed = date.fromisoformat(value)
    except ValueError:
        raise invalid("day", "Use a day written as YYYY-MM-DD") from None
    if parsed < today():
        raise invalid("day", "Pick today or a later date")
    return parsed


# Rule-specific checks (check 16) ---------------------------------------------------------------------------

def unusable_reason(obj: Row) -> str | None:
    if obj["license"] not in ALLOWED_LICENCES:
        return "Licence is not on the allowed list"
    if not (obj["artist"] or "").strip():
        return "No artist is attributed"
    if not obj["license_url"]:
        return "No licence address is recorded"
    return None


def citation_checks(tx: Tx, piece_id: int) -> None:
    cited = tx.rows("SELECT o.title, o.license, o.artist, o.license_url FROM piece_objects po "
                    "JOIN objects o ON o.id = po.object_id WHERE po.piece_id = :id ORDER BY po.position", id=piece_id)
    if not cited:
        raise invalid("object_ids", "Cite at least one object")
    lines = [f"{o['title']}: {why}" for o in cited if (why := unusable_reason(o))]
    if lines:
        raise Refusal(400, "Some cited objects cannot be used", "object_ids", {"lines": lines})


def booked_day(tx: Tx, piece_id: int) -> date | None:
    return tx.value("SELECT s.day FROM schedule_slots s WHERE s.piece_id = :id", id=piece_id)


# Budget ----------------------------------------------------------------------------------------------------

def lock_quarter(tx: Tx, quarter: str) -> int:
    """Serialise every write that can change this quarter's committed total; returns the budget."""
    tx.run("SELECT pg_advisory_xact_lock(hashtext(:key))", key=f"budget:{quarter}")
    return budget_cents(tx, quarter)


def budget_cents(tx: Tx, quarter: str) -> int:
    stored = tx.value("SELECT budget_cents FROM budgets WHERE quarter = :q", q=quarter)
    return DEFAULT_BUDGET_CENTS if stored is None else stored


def committed_cents(tx: Tx, quarter: str) -> int:
    start, end = quarter_bounds(quarter)
    return tx.value("SELECT coalesce(sum(fee_cents), 0)::bigint FROM pieces WHERE state IN ('cleared', 'scheduled', "
                    "'published') AND cleared_at <@ tstzrange(:start, :end)", start=start, end=end)


def check_budget(tx: Tx, quarter: str, added_cents: int, what: str, status: int = 409) -> None:
    """Refuse when committed plus the change would pass the budget; call after lock_quarter."""
    over = committed_cents(tx, quarter) + added_cents - budget_cents(tx, quarter)
    if over > 0:
        raise Refusal(status, f"{what} would exceed the quarter budget by {format_cents(over)}")


def current_quarter() -> str:
    return quarter_of(today())


# Public chrome ---------------------------------------------------------------------------------------------

def cleared_today(tx: Tx) -> int:
    """Pieces whose first clearing (cleared_at, set once) fell on the current UTC day."""
    return tx.value("SELECT count(*) FROM pieces WHERE (cleared_at AT TIME ZONE 'UTC')::date = :day", day=today())
