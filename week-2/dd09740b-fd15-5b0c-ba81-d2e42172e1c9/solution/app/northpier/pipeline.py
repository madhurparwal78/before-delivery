"""Applying a studio transition: one transaction guarded by the key lock, the row lock, the version predicate
and the calendar lock, with its status event and update email."""
import datetime as dt
import json
from typing import Any

from northpier import db, outbox
from northpier.bodies import canonical_json
from northpier.config import SETTINGS
from northpier.domain import CALL_ACTIONS, DECLINE_REASONS, TRANSITIONS_BY_ACTION, allowed_actions
from northpier.errors import Refusal
from northpier.records import INQUIRY_COLUMNS, history_rows, inquiry_by_id, studio_history, studio_inquiry
from northpier.studio_time import CALL_LENGTH, call_time_problem, parse_call_at


def studio_detail(tx: db.Tx, row: dict[str, Any], role: str) -> dict[str, Any]:
    """The studio inquiry with the caller's allowed actions and the history (the transition answer)."""
    return {**studio_inquiry(row), "allowed_actions": [t.action for t in allowed_actions(row["status"], role)],
            "history": studio_history(history_rows(tx, row["id"]))}


def reopen_window_open(tx: db.Tx, inquiry_id: int, now: dt.datetime) -> bool:
    """True while less than the reopen window has passed since the latest decline history entry."""
    declined_at = tx.value("SELECT max(created_at) FROM status_events WHERE inquiry_id = :id AND action = 'decline'",
                           id=inquiry_id)
    return now - declined_at < dt.timedelta(seconds=SETTINGS.reopen_window)


def call_overlaps(tx: db.Tx, inquiry_id: int, start: dt.datetime) -> bool:
    """Another call_booked inquiry's call overlaps [start, start + 45 min); back-to-back calls do not.
    Callers hold the calendar lock, so the answer stays true until they commit."""
    return tx.value("SELECT count(*) FROM inquiries WHERE status = 'call_booked' AND id <> :id "
                    "AND call_at < :end AND call_at + :length > :start",
                    id=inquiry_id, start=start, end=start + CALL_LENGTH, length=CALL_LENGTH) > 0


def apply_transition(user: dict[str, Any], inquiry_id: int, body: dict[str, Any],
                     key: str | None) -> dict[str, Any]:
    """Apply one action through the Transitions table, or raise its refusal in the brief's order."""
    action = body.get("action")
    transition = TRANSITIONS_BY_ACTION.get(action) if type(action) is str else None
    if transition is not None and user["role"] not in transition.roles:
        raise Refusal("lead_only")
    request_body = canonical_json(body)
    with db.transaction() as tx:
        if key is not None:
            tx.lock(f"transition-key:{user['id']}:{inquiry_id}:{key}")
            now = tx.clock()
            stored = tx.one("SELECT request_body, response_body, created_at FROM transition_keys "
                            "WHERE user_id = :user AND inquiry_id = :id AND key = :key",
                            user=user["id"], id=inquiry_id, key=key)
            if stored and stored["created_at"] > now - dt.timedelta(seconds=SETTINGS.idempotency_ttl):
                if stored["request_body"] != request_body:
                    raise Refusal("change_key")
                return json.loads(stored["response_body"])
            tx.run("DELETE FROM transition_keys WHERE user_id = :user AND inquiry_id = :id AND key = :key",
                   user=user["id"], id=inquiry_id, key=key)
        before = inquiry_by_id(tx, inquiry_id, lock=True)
        version = body.get("version")
        if type(version) is not int or version != before["version"]:
            raise Refusal("stale")
        if transition is None or before["status"] not in transition.from_statuses:
            raise Refusal("not_allowed")
        now = tx.clock()
        if transition.action == "mark_won" and not before["call_at"] < now:
            raise Refusal("not_held")
        if transition.action == "reopen" and not reopen_window_open(tx, inquiry_id, now):
            raise Refusal("window_closed")

        call_at, decline_reason = before["call_at"], before["decline_reason"]
        if transition.action in CALL_ACTIONS:
            problem = call_time_problem(body.get("call_at"), now)
            if problem is not None:
                raise Refusal(problem)
            call_at = parse_call_at(body["call_at"])
            tx.lock("calendar")
            if call_overlaps(tx, inquiry_id, call_at):
                raise Refusal("overlap")
        elif transition.action == "decline":
            decline_reason = body.get("decline_reason")
            if type(decline_reason) is not str or decline_reason not in DECLINE_REASONS:
                raise Refusal("reason")
        elif transition.action == "reopen":
            call_at, decline_reason = None, None

        after = tx.one(
            f"UPDATE inquiries SET status = :status, call_at = :call_at, decline_reason = :reason, "
            f"version = version + 1, updated_at = :now WHERE id = :id AND version = :version "
            f"RETURNING {INQUIRY_COLUMNS}", status=transition.to_status, call_at=call_at, reason=decline_reason,
            now=now, id=inquiry_id, version=version)
        outbox.enqueue_update(tx, before, after, transition.action, now)
        tx.run("INSERT INTO status_events (inquiry_id, action, from_status, to_status, call_at, decline_reason, "
               "actor_id, created_at) VALUES (:id, :action, :from_status, :to_status, :call_at, :reason, :actor, :now)",
               id=inquiry_id, action=transition.action, from_status=before["status"], to_status=transition.to_status,
               call_at=call_at if transition.action in CALL_ACTIONS else None,
               reason=decline_reason if transition.action == "decline" else None, actor=user["id"], now=now)
        response = studio_detail(tx, after, user["role"])
        if key is not None:
            tx.run("INSERT INTO transition_keys (user_id, inquiry_id, key, request_body, response_body, created_at) "
                   "VALUES (:user, :id, :key, :request, :response, :now)", user=user["id"], id=inquiry_id, key=key,
                   request=request_body, response=json.dumps(response), now=now)
    outbox.wake()
    return response
