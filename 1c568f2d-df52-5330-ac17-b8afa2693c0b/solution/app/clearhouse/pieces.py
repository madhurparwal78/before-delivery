"""Writes on pieces: create, edit, cite, every state step, reviews, duplicate acknowledgements and bookings.
Each runs in one transaction with its audit entry; a refusal rolls the whole write back."""

from datetime import date

from pg8000.exceptions import DatabaseError

from . import rules, shapes
from .audit import record
from .catalogue import flagged_pairs
from .db import Row, Tx, transaction
from .errors import Refusal, invalid, not_found
from .timefmt import iso, now, quarter_of, today

CREATE_FIELDS = ("title", "summary", "fee_cents")
PATCH_FIELDS = ("version", "title", "summary", "fee_cents")
OBJECT_FIELDS = ("version", "object_ids")
TRANSITION_FIELDS = ("version", "action", "reason", "day")
REVIEW_FIELDS = ("version", "kind", "result", "reason")
ACK_FIELDS = ("object_id", "duplicate_object_id")
BOOKING_FIELDS = ("piece_id", "version")


def _unique_title(error: DatabaseError) -> bool:
    return bool(error.args) and isinstance(error.args[0], dict) and error.args[0].get("C") == "23505"


def create(account: Row, body: object) -> dict:
    with transaction() as tx:
        fields = rules.only_published(body, CREATE_FIELDS)
        rules.check_actor(tx, account, None, "create")
        title = rules.title(tx, fields.get("title"))
        summary = rules.summary(fields.get("summary"))
        fee = rules.fee(fields.get("fee_cents"))
        try:
            piece_id = tx.value("INSERT INTO pieces (title, summary, fee_cents, submitted_fee_cents, state, owner_id) "
                                "VALUES (:t, :s, :f, :f, 'draft', :o) RETURNING id",
                                t=title, s=summary, f=fee, o=account["id"])
        except DatabaseError as error:
            if _unique_title(error):
                raise invalid("title", f"A piece named {title} already exists") from None
            raise
        return shapes.piece(tx, piece_id)


def edit(account: Row, piece_id: int, body: object) -> dict:
    with transaction() as tx:
        piece, fields = rules.decide(tx, account, piece_id, body, PATCH_FIELDS, "edit", version_required=True)
        title = rules.title(tx, fields["title"], other_than=piece_id) if "title" in fields else piece["title"]
        summary = rules.summary(fields["summary"]) if "summary" in fields else piece["summary"]
        fee = rules.fee(fields["fee_cents"]) if "fee_cents" in fields else piece["fee_cents"]
        tx.run("UPDATE pieces SET title = :t, summary = :s, fee_cents = :f, version = version + 1, "
               "updated_at = clock_timestamp() WHERE id = :id", t=title, s=summary, f=fee, id=piece_id)
        return shapes.piece(tx, piece_id)


def cite(account: Row, piece_id: int, body: object) -> dict:
    with transaction() as tx:
        _, fields = rules.decide(tx, account, piece_id, body, OBJECT_FIELDS, "edit", version_required=True)
        object_ids = rules.object_ids(tx, fields.get("object_ids"))
        tx.run("DELETE FROM piece_objects WHERE piece_id = :id", id=piece_id)
        for position, object_id in enumerate(object_ids):
            tx.run("INSERT INTO piece_objects (piece_id, object_id, position) VALUES (:p, :o, :n)",
                   p=piece_id, o=object_id, n=position)
        tx.run("UPDATE pieces SET version = version + 1, updated_at = clock_timestamp() WHERE id = :id", id=piece_id)
        return {"piece": shapes.piece(tx, piece_id),
                "objects": [shapes.object_of(o) for o in shapes.cited_objects(tx, piece_id)]}


def move(tx: Tx, account: Row, piece: Row, to_state: str, reason: str | None, **columns: object) -> dict:
    """Store one legal step: the new state, a raised version and exactly one audit entry."""
    sets = "".join(f", {name} = :{name}" for name in columns)
    tx.run(f"UPDATE pieces SET state = :to, version = version + 1, updated_at = clock_timestamp(){sets} "
           "WHERE id = :id", to=to_state, id=piece["id"], **columns)
    record(tx, piece["id"], account["id"], piece["state"], to_state, reason)
    return shapes.piece(tx, piece["id"])


def transition(account: Row, piece_id: int, body: object) -> dict:
    with transaction() as tx:
        action = body.get("action") if isinstance(body, dict) else None
        step_name = action if action in rules.ACTIONS else None
        piece, fields = rules.decide(tx, account, piece_id, body, TRANSITION_FIELDS, step_name,
                                     version_required=True)
        return apply_step(tx, account, piece, step_name, fields.get("reason"), fields.get("day"))


def apply_step(tx: Tx, account: Row, piece: Row, name: str, reason: object, day: object) -> dict:
    """The field and rule-specific checks of each step (checks 15 and 16), then the step itself."""
    step = rules.STEPS[name]
    why = rules.reason(reason) if step.needs_reason else None
    columns: dict[str, object] = {}
    match name:
        case "submit":
            rules.citation_checks(tx, piece["id"])
            columns["submitted_fee_cents"] = piece["fee_cents"]
        case "clear":
            if [r["result"] for r in shapes.reviews(tx, piece["id"])] != ["pass", "pass"]:
                raise Refusal(409, "Both reviews must pass before clearing")
            quarter = quarter_of((piece["cleared_at"] or now()).date())
            rules.lock_quarter(tx, quarter)
            rules.check_budget(tx, quarter, piece["fee_cents"], "Clearing this piece")
            columns["cleared_at"] = piece["cleared_at"] or now()
        case "schedule":
            booked = rules.day(day)
            if tx.value("INSERT INTO schedule_slots (day, piece_id) VALUES (:d, :p) "
                        "ON CONFLICT DO NOTHING RETURNING day", d=booked, p=piece["id"]) is None:
                raise Refusal(409, f"{booked.isoformat()} already has a featured piece")
        case "publish":
            booked = rules.booked_day(tx, piece["id"])
            if booked > today():
                raise Refusal(409, f"{booked.isoformat()} has not arrived yet")
            columns["published_at"] = now()
        case "unschedule" | "withdraw":
            tx.run("DELETE FROM schedule_slots WHERE piece_id = :id", id=piece["id"])
        case "revise":
            tx.run("DELETE FROM reviews WHERE piece_id = :id", id=piece["id"])
            tx.run("DELETE FROM duplicate_acks WHERE piece_id = :id", id=piece["id"])
    return move(tx, account, piece, step.target, why, **columns)


def review(account: Row, piece_id: int, body: object) -> dict:
    with transaction() as tx:
        kind = body.get("kind") if isinstance(body, dict) else None
        piece, fields = rules.decide(tx, account, piece_id, body, REVIEW_FIELDS,
                                     rules.REVIEW_STEP.get(kind, "review"), version_required=True)
        kind = rules.kind(fields.get("kind"))
        result = rules.result(fields.get("result"))
        note = fields.get("reason")
        why = rules.reason(note) if result == "fail" else (note if isinstance(note, str) and note.strip() else None)
        if tx.value("SELECT 1 FROM reviews WHERE piece_id = :id AND kind = :k", id=piece_id, k=kind):
            raise Refusal(409, "That review is already recorded")
        if result == "pass" and kind == "licence" and unacknowledged_duplicates(tx, piece_id):
            raise Refusal(409, "Acknowledge every flagged duplicate first")
        review_id = tx.value("INSERT INTO reviews (piece_id, kind, reviewer_id, result, reason) "
                             "VALUES (:p, :k, :r, :res, :why) RETURNING id",
                             p=piece_id, k=kind, r=account["id"], res=result, why=why)
        shaped = move(tx, account, piece, "in_review" if result == "pass" else "changes_requested", why)
        stored = tx.one("SELECT * FROM reviews WHERE id = :id", id=review_id)
        return {"id": review_id, "piece_id": piece_id, "kind": kind, "result": result, "reason": why,
                "reviewer_id": account["id"], "created_at": iso(stored["created_at"]), "piece": shaped}


def unacknowledged_duplicates(tx: Tx, piece_id: int) -> int:
    """Flagged duplicates of cited objects not yet acknowledged in this review round."""
    cited = [r["object_id"] for r in tx.rows("SELECT c.object_id FROM piece_objects c WHERE c.piece_id = :id", id=piece_id)]
    acked = {(r["object_id"], r["duplicate_object_id"]) for r in tx.rows(
        "SELECT object_id, duplicate_object_id FROM duplicate_acks WHERE piece_id = :id", id=piece_id)}
    return len(set(flagged_pairs(tx, cited)) - acked)


def acknowledge(account: Row, piece_id: int, body: object) -> dict:
    with transaction() as tx:
        _, fields = rules.decide(tx, account, piece_id, body, ACK_FIELDS, "acknowledge", version_required=False)
        object_id, duplicate_id = fields.get("object_id"), fields.get("duplicate_object_id")
        if type(object_id) is not int or not tx.value(
                "SELECT 1 FROM piece_objects c WHERE c.piece_id = :p AND c.object_id = :o", p=piece_id, o=object_id):
            raise invalid("object_id", "That object is not cited by this piece")
        if (object_id, duplicate_id) not in flagged_pairs(tx, [object_id]):
            raise invalid("duplicate_object_id", "That object is not a flagged duplicate")
        row = tx.one("INSERT INTO duplicate_acks (piece_id, object_id, duplicate_object_id, acknowledged_by) "
                     "VALUES (:p, :o, :d, :a) ON CONFLICT DO NOTHING RETURNING *",
                     p=piece_id, o=object_id, d=duplicate_id, a=account["id"])
        if row is None:
            raise Refusal(409, "That duplicate is already acknowledged")
        return shapes.ack_of(row)


def book(account: Row, day_text: str, body: object) -> dict:
    with transaction() as tx:
        if not isinstance(body, dict):
            rules.only_published(body, BOOKING_FIELDS)
        piece, _ = rules.decide(tx, account, body.get("piece_id"), body, BOOKING_FIELDS, "schedule",
                                version_required=False)
        apply_step(tx, account, piece, "schedule", None, day_text)
        slot = tx.one("SELECT day, piece_id, view_count FROM schedule_slots WHERE piece_id = :id", id=piece["id"])
        return {"day": slot["day"].isoformat(), "piece_id": slot["piece_id"], "view_count": slot["view_count"]}


def unbook(account: Row, day_text: str, version: str | None) -> None:
    try:
        booked = date.fromisoformat(day_text)
    except ValueError:
        raise not_found() from None
    with transaction() as tx:
        holder = tx.value("SELECT s.piece_id FROM schedule_slots s WHERE s.day = :d", d=booked)
        if holder is None:
            raise not_found()
        body = {} if version is None else {"version": int(version) if version.isdigit() else version}
        piece, _ = rules.decide(tx, account, holder, body, ("version",), "unschedule", version_required=False)
        apply_step(tx, account, piece, "unschedule", None, None)
