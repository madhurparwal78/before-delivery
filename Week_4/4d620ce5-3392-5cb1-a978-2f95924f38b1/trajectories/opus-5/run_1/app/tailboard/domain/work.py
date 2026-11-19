"""Work on one card: claiming, evidence, signatures, deferral, effectivity and reopen.

Every stage transition of a thread is decided here.
"""

from ..errors import ApiError, invalid_transition
from ..ids import new_id
from . import audit, notices
from . import limits as limit_rules
from . import people as people_rules
from . import threads as thread_rules
from .directives import label_of, revision_number_of, tag_of

TRANSITIONS = {
    "claim": {"open": "claimed", "deferred": "claimed", "reopened": "reopened"},
    "release": {"claimed": "open", "reopened": "open"},
    "inspection": {"claimed": "inspected", "reopened": "inspected"},
    "countersign": {"inspected": "certified"},
    "deferral": {"open": "deferred"},
    "effectivity": {"superseded_retargeted": "open"},
    "reopen": {"certified": "reopened"},
}
EFFECTIVITY_GATED = ("claim", "inspection", "countersign", "deferral")


def lock_thread(cursor, thread_id):
    row = cursor.one("SELECT * FROM threads WHERE id = %s FOR UPDATE", (thread_id,))
    if row is None:
        raise ApiError("not_found", "No such thread.")
    return row


def _directive(cursor, directive_id):
    return cursor.one(
        """SELECT id, authority, number, current_revision, status FROM directives WHERE id = %s""",
        (directive_id,),
    )


def guard(cursor, thread, action):
    """The 409 state conflicts, in the published order."""
    directive = _directive(cursor, thread["directive_id"])
    if directive["status"] == "withdrawn":
        raise ApiError("directive_withdrawn", f"{label_of(directive)} is withdrawn.")
    if thread["stage"] == "superseded_retargeted" and action in EFFECTIVITY_GATED:
        raise ApiError("effectivity_unconfirmed")
    return directive


def check_revision(directive, sent):
    current = tag_of(directive["current_revision"])
    if revision_number_of(sent) != directive["current_revision"]:
        raise ApiError(
            "revision_changed",
            f"This thread moved to {current}. Review the new limits before signing.",
            current=current,
        )


def require_stage(thread, action, message=None):
    target = TRANSITIONS[action].get(thread["stage"])
    if target is None:
        raise invalid_transition(thread["stage"], action, message)
    return target


def claim(cursor, user, thread_id, at):
    thread = lock_thread(cursor, thread_id)
    directive = guard(cursor, thread, "claim")
    if thread["holder_id"] == user["id"]:
        return thread_rules.thread_shape(cursor, thread), []
    if thread["holder_id"] is not None:
        holder = cursor.one("SELECT * FROM users WHERE id = %s", (thread["holder_id"],))
        registry = people_rules.load_people(cursor)
        raise ApiError(
            "card_held",
            f"Already held by {people_rules.display_name(holder)}.",
            holder=people_rules.person(registry[holder["id"]]),
        )
    stage = require_stage(thread, "claim")
    cursor.execute(
        "UPDATE threads SET holder_id = %s, claimed_at = %s, stage = %s WHERE id = %s",
        (user["id"], at, stage, thread_id),
    )
    audit.write(cursor, at, user["id"], "thread.claimed", directive["id"], thread_id,
                f"Work card {thread['work_card_id']} claimed")
    return _reload(cursor, thread_id), [thread_id]


def release(cursor, user, thread_id, at):
    thread = lock_thread(cursor, thread_id)
    _require_holder(thread, user)
    directive = guard(cursor, thread, "release")
    stage = require_stage(thread, "release")
    cursor.execute(
        "UPDATE threads SET holder_id = NULL, claimed_at = NULL, stage = %s WHERE id = %s",
        (stage, thread_id),
    )
    audit.write(cursor, at, user["id"], "thread.released", directive["id"], thread_id,
                f"Work card {thread['work_card_id']} released")
    return _reload(cursor, thread_id), [thread_id]


def _require_holder(thread, user):
    if thread["holder_id"] != user["id"]:
        raise ApiError("not_holder")


def attach_evidence(cursor, user, thread_id, key, digest, content_type, size, at):
    thread = lock_thread(cursor, thread_id)
    _require_holder(thread, user)
    directive = guard(cursor, thread, "evidence")
    evidence_id = new_id("evd")
    cursor.execute(
        """INSERT INTO evidence (id, thread_id, key, sha256, content_type, bytes, attached_by,
                                 attached_at)
           VALUES (%s,%s,%s,%s,%s,%s,%s,%s)""",
        (evidence_id, thread_id, key, digest, content_type, size, user["id"], at),
    )
    audit.write(cursor, at, user["id"], "thread.evidence_attached", directive["id"], thread_id,
                f"{content_type} {size} bytes {digest}")
    row = cursor.one("SELECT * FROM evidence WHERE id = %s", (evidence_id,))
    registry = people_rules.load_people(cursor)
    return thread_rules.evidence_shape(row, registry), [thread_id]


def sign_inspection(cursor, user, thread_id, body, at):
    from .validate import inspection_body

    thread = lock_thread(cursor, thread_id)
    _require_holder(thread, user)
    directive = guard(cursor, thread, "inspection")
    check_revision(directive, body.get("revision"))
    stage = require_stage(thread, "inspection")
    attached = {
        row["id"]
        for row in cursor.all("SELECT id FROM evidence WHERE thread_id = %s", (thread_id,))
    }
    method_ref, findings, _evidence_ids = inspection_body(body, attached)

    context = thread_rules.load_context(cursor)
    evaluation = thread_rules.evaluate(thread, context, at)
    tail = context["tails"][thread["registration"]]
    timeliness = limit_rules.timeliness_for(evaluation, float(tail["total_hours"]), at)
    signature_id = new_id("sig")
    cursor.execute(
        """INSERT INTO signatures (id, thread_id, kind, signer_id, revision, committed_at,
                                   timeliness, method_ref, findings, status)
           VALUES (%s,%s,'inspection',%s,%s,%s,%s,%s,%s,'valid')""",
        (signature_id, thread_id, user["id"], directive["current_revision"], at, timeliness,
         method_ref, findings),
    )
    certifier_id = people_rules.next_certifier(cursor, tail["model_code"])
    cursor.execute(
        """UPDATE threads SET stage = %s, timeliness = %s, certifier_id = %s,
               certifier_status = %s WHERE id = %s""",
        (stage, timeliness, certifier_id,
         "awaiting_countersignature" if certifier_id else "awaiting_certifier", thread_id),
    )
    if certifier_id:
        notices.queue_countersignature_request(cursor, thread_id, certifier_id, user["id"], at)
    audit.write(cursor, at, user["id"], "thread.inspection_signed", directive["id"], thread_id,
                f"Inspection signed under {tag_of(directive['current_revision'])}, {timeliness}")
    signature = cursor.one("SELECT * FROM signatures WHERE id = %s", (signature_id,))
    registry = people_rules.load_people(cursor)
    return (
        _reload(cursor, thread_id),
        thread_rules.signature_shape(signature, registry),
        [thread_id],
    )


def countersign(cursor, user, thread_id, body, at):
    thread = lock_thread(cursor, thread_id)
    tail = cursor.one(
        "SELECT model_code, total_hours FROM tails WHERE registration = %s",
        (thread["registration"],),
    )
    if not people_rules.covers(cursor, user["id"], tail["model_code"]):
        from ..seed import MODEL_LABELS

        raise ApiError(
            "out_of_scope",
            f"Your certification scope does not cover {MODEL_LABELS[tail['model_code']]}.",
            model=tail["model_code"],
        )
    directive = guard(cursor, thread, "countersign")
    check_revision(directive, body.get("revision"))
    stage = require_stage(thread, "countersign")
    signature_id = new_id("sig")
    cursor.execute(
        """INSERT INTO signatures (id, thread_id, kind, signer_id, revision, committed_at, status)
           VALUES (%s,%s,'countersignature',%s,%s,%s,'valid')""",
        (signature_id, thread_id, user["id"], directive["current_revision"], at),
    )
    cursor.execute(
        """UPDATE threads SET stage = %s, certified_at = %s, certified_hours = %s,
               certifier_id = %s, certifier_status = NULL, holder_id = NULL, claimed_at = NULL
            WHERE id = %s""",
        (stage, at, float(tail["total_hours"]), user["id"], thread_id),
    )
    audit.write(cursor, at, user["id"], "thread.countersigned", directive["id"], thread_id,
                f"Countersigned under {tag_of(directive['current_revision'])}")
    signature = cursor.one("SELECT * FROM signatures WHERE id = %s", (signature_id,))
    registry = people_rules.load_people(cursor)
    return (
        _reload(cursor, thread_id),
        thread_rules.signature_shape(signature, registry),
        [thread_id],
    )


def defer(cursor, user, thread_id, reason, at):
    thread = lock_thread(cursor, thread_id)
    directive = guard(cursor, thread, "deferral")
    context = thread_rules.load_context(cursor)
    evaluation = thread_rules.evaluate(thread, context, at)
    if at > evaluation["due_at"]:
        raise ApiError("past_due")
    if thread["deferred"]:
        raise ApiError(
            "already_deferred",
            f"Already deferred under {tag_of(directive['current_revision'])}.",
        )
    stage = require_stage(thread, "deferral")
    cursor.execute(
        """UPDATE threads SET stage = %s, deferred = true, deferral_by = %s, deferral_at = %s,
               deferral_reason = %s WHERE id = %s""",
        (stage, user["id"], at, reason, thread_id),
    )
    audit.write(cursor, at, user["id"], "thread.deferred", directive["id"], thread_id, reason)
    return _reload(cursor, thread_id), [thread_id]


def decide_effectivity(cursor, user, thread_id, decision, reason, at):
    thread = lock_thread(cursor, thread_id)
    directive = guard(cursor, thread, "effectivity")
    require_stage(thread, "effectivity", "This thread no longer needs confirmation.")
    if decision == "confirmed":
        stage = "claimed" if thread["holder_id"] else "open"
        cursor.execute("UPDATE threads SET stage = %s WHERE id = %s", (stage, thread_id))
        action = "thread.effectivity_confirmed"
    else:
        cursor.execute(
            """UPDATE threads SET stage = 'not_applicable', holder_id = NULL, claimed_at = NULL,
                   certifier_id = NULL, certifier_status = NULL WHERE id = %s""",
            (thread_id,),
        )
        notices.withdraw_for_thread(cursor, thread_id,
                                    ("countersignature_request", "succession", "card_revision"))
        action = "thread.marked_not_applicable"
    audit.write(cursor, at, user["id"], action, directive["id"], thread_id, reason)
    return _reload(cursor, thread_id), [thread_id]


def reopen(cursor, user, thread_id, reason, at):
    """A reopen returns a certified thread to work with the same card and evidence,
    and keeps its prior signatures as void."""
    thread = lock_thread(cursor, thread_id)
    directive = guard(cursor, thread, "reopen")
    require_stage(thread, "reopen", "Only a closed thread can be reopened.")
    cursor.execute(
        """UPDATE signatures SET status = 'void', void_reason = %s
            WHERE thread_id = %s AND status <> 'void'""",
        (reason, thread_id),
    )
    last_inspector = cursor.value(
        """SELECT signer_id FROM signatures WHERE thread_id = %s AND kind = 'inspection'
            ORDER BY seq DESC LIMIT 1""",
        (thread_id,),
    )
    if last_inspector and cursor.value(
        "SELECT erased FROM users WHERE id = %s", (last_inspector,)
    ):
        last_inspector = None
    total_hours = cursor.value(
        "SELECT total_hours FROM tails WHERE registration = %s", (thread["registration"],)
    )
    cursor.execute(
        """UPDATE threads SET stage = 'reopened', pinned_revision = NULL, fh_baseline = %s,
               entered_at = %s, holder_id = %s, claimed_at = %s, timeliness = NULL,
               certifier_id = NULL, certifier_status = NULL, certified_at = NULL,
               certified_hours = NULL, deferred = false, deferral_by = NULL, deferral_at = NULL,
               deferral_reason = NULL
            WHERE id = %s""",
        (float(total_hours), at, last_inspector, at if last_inspector else None, thread_id),
    )
    audit.write(cursor, at, user["id"], "thread.reopened", directive["id"], thread_id, reason)
    return _reload(cursor, thread_id), [thread_id]


def log_flight_hours(cursor, user, registration, hours, at):
    tail = cursor.one(
        "SELECT registration, total_hours FROM tails WHERE registration = %s FOR UPDATE",
        (registration,),
    )
    if tail is None:
        raise ApiError("not_found", "No such tail.")
    total = round(float(tail["total_hours"]) + hours, 1)
    cursor.execute(
        """INSERT INTO flight_hour_logs (id, registration, hours, running_total, logged_at,
                                         actor_id)
           VALUES (%s,%s,%s,%s,%s,%s)""",
        (new_id("fhl"), registration, hours, total, at, user["id"]),
    )
    cursor.execute(
        "UPDATE tails SET total_hours = %s WHERE registration = %s", (total, registration)
    )
    audit.write(cursor, at, user["id"], "tail.hours_logged", None, None,
                f"{registration} +{hours:.1f} FH, now {total:.1f}")
    affected = [
        row["id"]
        for row in cursor.all(
            "SELECT id FROM threads WHERE registration = %s", (registration,)
        )
    ]
    return {"registration": registration, "total_hours": total, "logged_at": None}, affected


def _reload(cursor, thread_id):
    return thread_rules.thread_shape(cursor, cursor.one(
        "SELECT * FROM threads WHERE id = %s", (thread_id,)
    ))
