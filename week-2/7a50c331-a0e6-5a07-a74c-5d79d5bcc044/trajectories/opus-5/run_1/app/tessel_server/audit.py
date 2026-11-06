"""The audit log: writing events, paging them and the CSV answer."""
import base64
import datetime
import json

from . import textutil
from .errors import TesselError, validation_error

ACTIONS = (
    "database.create",
    "database.delete",
    "database.import",
    "member.add",
    "member.role",
    "member.remove",
    "member.password",
    "member.password_reset",
    "member.totp_on",
    "member.totp_off",
    "session.logout_all",
    "key.create",
    "key.rotate",
    "key.revoke",
    "plan.change",
    "export.request",
)

PAGE_DEFAULT = 20
CSV_LIMIT = 1000
NEUTRALISE_FIRST = ("=", "+", "-", "@", "\t", "\r")


def write(cur, organization_id, actor, action, target, detail=""):
    """Write exactly one audit event, in the transaction of the change itself."""
    cur.execute(
        """
        INSERT INTO audit_events (organization_id, at, actor, action, target, detail)
        VALUES (%s, %s, %s, %s, %s, %s)
        """,
        (organization_id, textutil.now(), actor, action, target, detail),
    )


def _epoch_micros(moment):
    return int(moment.timestamp() * 1_000_000)


def _from_micros(value):
    return datetime.datetime.fromtimestamp(value / 1_000_000, datetime.timezone.utc)


def encode_cursor(organization_id, action, actor, at, event_id):
    payload = {
        "o": organization_id,
        "a": action or "",
        "c": (actor or "").lower(),
        "t": _epoch_micros(at),
        "i": event_id,
    }
    raw = json.dumps(payload, separators=(",", ":")).encode("utf-8")
    return base64.urlsafe_b64encode(raw).decode("ascii").rstrip("=")


def decode_cursor(cursor, organization_id, action, actor):
    padding = "=" * (-len(cursor) % 4)
    try:
        payload = json.loads(base64.urlsafe_b64decode(cursor + padding))
        if payload["o"] != organization_id:
            raise ValueError
        if payload["a"] != (action or ""):
            raise ValueError
        if payload["c"] != (actor or "").lower():
            raise ValueError
        return _from_micros(payload["t"]), int(payload["i"])
    except (ValueError, KeyError, TypeError, json.JSONDecodeError):
        raise TesselError("INVALID_CURSOR")


def read_page(cur, organization_id, limit, cursor=None, action=None, actor=None):
    """One page of events, newest first, with the cursor for the next page."""
    clauses = ["organization_id = %s"]
    params = [organization_id]
    if action:
        clauses.append("action = %s")
        params.append(action)
    if actor:
        clauses.append("lower(actor) = %s")
        params.append(actor.lower())
    if cursor:
        at, event_id = decode_cursor(cursor, organization_id, action, actor)
        clauses.append("(at, id) < (%s, %s)")
        params.extend([at, event_id])
    params.append(limit + 1)
    rows = cur.all(
        """
        SELECT id, at, actor, action, target, detail FROM audit_events
         WHERE %s ORDER BY at DESC, id DESC LIMIT %%s
        """
        % " AND ".join(clauses),
        tuple(params),
    )
    more = len(rows) > limit
    rows = rows[:limit]
    next_cursor = None
    if more and rows:
        last = rows[-1]
        next_cursor = encode_cursor(
            organization_id, action, actor, last["at"], last["id"]
        )
    events = [
        {
            "id": str(row["id"]),
            "at": textutil.format_timestamp(row["at"]),
            "actor": row["actor"],
            "action": row["action"],
            "target": row["target"],
            "detail": row["detail"],
        }
        for row in rows
    ]
    return events, next_cursor


def read_all(cur, organization_id, action=None, actor=None):
    events, _ = read_page(cur, organization_id, CSV_LIMIT, None, action, actor)
    return events


def csv_field(value):
    """Neutralise a spreadsheet formula, then quote only when needed."""
    text = "" if value is None else str(value)
    if text[:1] in NEUTRALISE_FIRST:
        text = "'" + text
    if any(char in text for char in (",", '"', "\n", "\r")):
        return '"%s"' % text.replace('"', '""')
    return text


def to_csv(events):
    lines = ["id,at,actor,action,target,detail"]
    for event in events:
        lines.append(
            ",".join(
                csv_field(event[name])
                for name in ("id", "at", "actor", "action", "target", "detail")
            )
        )
    return "".join(line + "\n" for line in lines)


def validate_action(value):
    if value is None or value == "":
        return None
    if value not in ACTIONS:
        raise validation_error("action", "This field must be one of the audit actions")
    return value
