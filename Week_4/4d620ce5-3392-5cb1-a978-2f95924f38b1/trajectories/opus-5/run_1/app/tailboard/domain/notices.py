"""Staff notices. They wait in a visible queue for the hold period; a supersession or
an erasure that lands meanwhile rewrites or withdraws them before they are sent."""

import datetime
import json

from .. import clock
from ..config import config
from ..ids import new_id


def _name_and_licence(cursor, user_id):
    row = cursor.one(
        "SELECT display_name, licence, erased, signer_token, email FROM users WHERE id = %s",
        (user_id,),
    )
    if row is None:
        return "an unknown person", None, None
    if row["erased"]:
        return row["signer_token"], None, None
    return row["display_name"], row["licence"], row["email"]


def render(cursor, kind, payload):
    """Subject and body from the facts, resolved against people as they are now."""
    directive = payload["directive"]
    tag = payload["tag"]
    registration = payload["registration"]
    if kind == "card_revision":
        subject = f"New revision {directive} {tag} affects your work card {payload['card']}"
        lines = [
            f"Registration: {registration}",
            f"Directive: {directive}",
            f"Revision: {payload['old_tag']} superseded by {tag}",
        ]
        if payload.get("removed"):
            lines.append(f"{registration} has left the effectivity of {directive} {tag}.")
            lines.append("Your work card is closed; no further work is due.")
        else:
            lines.append(f"New deadline date: {payload['deadline_date']}")
            lines.append(f"New flight-hours threshold: {payload['fh_threshold']}")
        return subject, "\n".join(lines)

    inspector, inspector_licence, _ = _name_and_licence(cursor, payload["inspector_id"])
    if kind == "countersignature_request":
        subject = f"Countersignature requested: {registration} {directive} {tag}"
        lines = [
            f"{registration} {directive} {tag} is inspected and awaits your countersignature.",
            f"Inspector: {inspector}" + (f" ({inspector_licence})" if inspector_licence else ""),
        ]
        return subject, "\n".join(lines)

    previous = payload.get("previous_certifier_id")
    previous_name = _name_and_licence(cursor, previous)[0] if previous else "no certifier"
    subject = f"Countersignature passed to you: {registration} {directive} {tag}"
    lines = [
        f"{registration} {directive} {tag} now awaits your countersignature.",
        f"Previous certifier: {previous_name}",
        f"Inspector: {inspector}" + (f" ({inspector_licence})" if inspector_licence else ""),
    ]
    return subject, "\n".join(lines)


def _queue(cursor, kind, to_user_id, payload, at, thread_id, directive_id, card=None):
    subject, body = render(cursor, kind, payload)
    to_email = _name_and_licence(cursor, to_user_id)[2]
    if not to_email:
        return None
    notice_id = new_id("ntc")
    cursor.execute(
        """INSERT INTO notices (id, kind, to_user_id, to_email, subject, body, status,
                                queued_at, send_after, thread_id, directive_id, work_card_id,
                                payload)
           VALUES (%s,%s,%s,%s,%s,%s,'queued',%s,%s,%s,%s,%s,%s::jsonb)""",
        (notice_id, kind, to_user_id, to_email, subject, body, at,
         at + datetime.timedelta(seconds=config.notice_hold_seconds), thread_id, directive_id,
         card, json.dumps(payload)),
    )
    return notice_id


def _thread_facts(cursor, thread_id):
    return cursor.one(
        """SELECT t.id, t.registration, t.work_card_id, t.directive_id, t.holder_id,
                  d.authority || ' ' || d.number AS directive, d.current_revision
             FROM threads t JOIN directives d ON d.id = t.directive_id WHERE t.id = %s""",
        (thread_id,),
    )


def queue_countersignature_request(cursor, thread_id, certifier_id, inspector_id, at):
    facts = _thread_facts(cursor, thread_id)
    payload = {
        "directive": facts["directive"],
        "tag": f"R{facts['current_revision']}",
        "registration": facts["registration"],
        "inspector_id": inspector_id,
    }
    return _queue(cursor, "countersignature_request", certifier_id, payload, at, thread_id,
                  facts["directive_id"])


def queue_succession_notice(cursor, thread_id, certifier_id, previous_id, at):
    facts = _thread_facts(cursor, thread_id)
    inspector_id = cursor.value(
        """SELECT signer_id FROM signatures WHERE thread_id = %s AND kind = 'inspection'
            ORDER BY seq DESC LIMIT 1""",
        (thread_id,),
    )
    payload = {
        "directive": facts["directive"],
        "tag": f"R{facts['current_revision']}",
        "registration": facts["registration"],
        "inspector_id": inspector_id,
        "previous_certifier_id": previous_id,
    }
    return _queue(cursor, "succession", certifier_id, payload, at, thread_id,
                  facts["directive_id"])


def queue_card_revision(cursor, thread_id, holder_id, old_tag, new_tag, limits, removed, at):
    facts = _thread_facts(cursor, thread_id)
    payload = {
        "directive": facts["directive"],
        "tag": new_tag,
        "old_tag": old_tag,
        "registration": facts["registration"],
        "card": facts["work_card_id"],
        "deadline_date": limits["deadline_date"],
        "fh_threshold": limits["fh_threshold"],
        "removed": removed,
    }
    existing = cursor.one(
        """SELECT id FROM notices
            WHERE kind = 'card_revision' AND status = 'queued' AND work_card_id = %s
            ORDER BY queued_at DESC LIMIT 1""",
        (facts["work_card_id"],),
    )
    if existing:
        _rewrite(cursor, existing["id"], "card_revision", payload)
        return existing["id"]
    return _queue(cursor, "card_revision", holder_id, payload, at, thread_id,
                  facts["directive_id"], card=facts["work_card_id"])


def _rewrite(cursor, notice_id, kind, payload):
    subject, body = render(cursor, kind, payload)
    cursor.execute(
        "UPDATE notices SET subject = %s, body = %s, payload = %s::jsonb WHERE id = %s",
        (subject, body, json.dumps(payload), notice_id),
    )


def withdraw_for_thread(cursor, thread_id, kinds):
    cursor.execute(
        """UPDATE notices SET status = 'withdrawn'
            WHERE status = 'queued' AND thread_id = %s AND kind = ANY(%s)""",
        (thread_id, list(kinds)),
    )


def withdraw_for_directive(cursor, directive_id):
    cursor.execute(
        "UPDATE notices SET status = 'withdrawn' WHERE status = 'queued' AND directive_id = %s",
        (directive_id,),
    )


def rewrite_notices_for_person(cursor, user_id, _at):
    cursor.execute(
        "UPDATE notices SET status = 'withdrawn' WHERE status = 'queued' AND to_user_id = %s",
        (user_id,),
    )
    for row in cursor.all(
        "SELECT id, kind, payload FROM notices WHERE status = 'queued'"
    ):
        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)
        _rewrite(cursor, row["id"], row["kind"], payload)


def shape(row):
    return {
        "id": row["id"],
        "kind": row["kind"],
        "to": row["to_email"],
        "subject": row["subject"],
        "body": row["body"],
        "status": row["status"],
        "queued_at": clock.iso(row["queued_at"]),
        "send_after": clock.iso(row["send_after"]),
        "sent_at": clock.iso(row["sent_at"]),
    }


def listed(cursor, status=None):
    rows = cursor.all(
        """SELECT id, kind, to_email, subject, body, status, queued_at, send_after, sent_at
             FROM notices WHERE (%s::text IS NULL OR status = %s)
            ORDER BY queued_at DESC, id DESC""",
        (status, status),
    )
    return [shape(row) for row in rows]
