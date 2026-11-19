"""Notices: queued staff notices held for NOTICE_HOLD_SECONDS, sent to Mailpit (DP-45)."""
import json
import secrets

from .clock import clock, format_iso
from .domain import MODELS, tag_of


class Notifier:
    def __init__(self, hold_seconds: int, mailer, authority_mailbox: str):
        self.hold_seconds = hold_seconds
        self.mailer = mailer
        self.authority_mailbox = authority_mailbox

    async def queue_card_revision(self, conn, thread, lineage, old_tag, new_tag,
                                   deadline, threshold, holder_id):
        """A card_revision notice to the holder; a later one rewrites the still-queued notice."""
        holder = await conn.fetchrow("SELECT * FROM people WHERE id = $1", holder_id)
        card = await conn.fetchrow("SELECT card_id FROM work_cards WHERE thread_id = $1", thread["id"])
        registration = thread["registration"]
        directive = f"{lineage['authority']} {lineage['number']}"
        subject = f"New revision {directive} {new_tag} affects your work card {card['card_id']}"
        body = (
            f"Registration: {registration}\n"
            f"Directive: {directive}\n"
            f"Old revision: {old_tag}\n"
            f"New revision: {new_tag}\n"
            f"New deadline date: {deadline}\n"
            f"New flight-hours threshold: {threshold:.1f}\n"
        )
        await self._queue(conn, "card_revision", holder, subject, body,
                          thread_id=thread["id"], lineage_id=lineage["id"],
                          card_id=card["card_id"], rewrite_kind="card_revision")

    async def queue_countersignature_request(self, conn, thread, inspector, certifier_id):
        if certifier_id is None:
            return
        certifier = await conn.fetchrow("SELECT * FROM people WHERE id = $1", certifier_id)
        lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1", thread["lineage_id"])
        card = await conn.fetchrow("SELECT card_id FROM work_cards WHERE thread_id = $1", thread["id"])
        directive = f"{lineage['authority']} {lineage['number']}"
        subject = f"Countersignature requested: {thread['registration']} {directive} {tag_of(thread['revision'])}"
        body = (
            f"Inspector: {inspector['display_name']}\n"
            f"Licence: {inspector['licence']}\n"
            f"Work card: {card['card_id']}\n"
        )
        await self._queue(conn, "countersignature_request", certifier, subject, body,
                          thread_id=thread["id"], lineage_id=lineage["id"],
                          card_id=card["card_id"], rewrite_kind=None)

    async def queue_succession(self, conn, thread, from_person, to_person, replacement_authorized=True):
        lineage = await conn.fetchrow("SELECT * FROM lineages WHERE id = $1", thread["lineage_id"])
        card = await conn.fetchrow("SELECT card_id FROM work_cards WHERE thread_id = $1", thread["id"])
        directive = f"{lineage['authority']} {lineage['number']}"
        subject = f"Countersignature passed to you: {thread['registration']} {directive} {tag_of(thread['revision'])}"
        previous = from_person["display_name"] if from_person else "None"
        inspector = await conn.fetchrow(
            """SELECT p.display_name FROM signatures s JOIN people p ON p.id = s.signer_id
               WHERE s.thread_id = $1 AND s.kind = 'inspection' AND s.status = 'valid'
               ORDER BY s.committed_at DESC LIMIT 1""", thread["id"])
        body = (
            f"Previous certifier: {previous}\n"
            f"Inspector: {inspector['display_name'] if inspector else 'Unknown'}\n"
            f"Work card: {card['card_id']}\n"
        )
        await self._queue(conn, "succession", to_person, subject, body,
                          thread_id=thread["id"], lineage_id=lineage["id"],
                          card_id=card["card_id"], rewrite_kind=None)

    async def _queue(self, conn, kind, to_person, subject, body, thread_id=None,
                     lineage_id=None, card_id=None, rewrite_kind=None):
        now = clock().now()
        from datetime import timedelta
        send_after = now + timedelta(seconds=self.hold_seconds)
        if rewrite_kind == "card_revision" and card_id:
            existing = await conn.fetchrow(
                "SELECT id FROM notices WHERE kind = $1 AND card_id = $2 AND status = 'queued'",
                *(rewrite_kind, card_id))
            if existing:
                await conn.execute(
                    "UPDATE notices SET subject = $1, body = $2, queued_at = $3, send_after = $4, status = 'queued' WHERE id = $5",
                    *(subject, body, now, send_after, existing["id"]))
                return
        await conn.execute(
            """INSERT INTO notices (id, kind, to_person, to_email, subject, body, status,
               queued_at, send_after, thread_id, lineage_id, card_id)
               VALUES ($1, $2, $3, $4, $5, $6, 'queued', $7, $8, $9, $10, $11)""",
            *(f"ntc_{secrets.token_hex(8)}", kind, to_person["id"],
             to_person["email"], subject, body, now, send_after, thread_id, lineage_id, card_id))


def notice_shape(row) -> dict:
    return {
        "id": row["id"],
        "kind": row["kind"],
        "to": row["to_email"],
        "subject": row["subject"],
        "body": row["body"],
        "status": row["status"],
        "queued_at": format_iso(row["queued_at"]),
        "send_after": format_iso(row["send_after"]),
        "sent_at": format_iso(row["sent_at"]) if row["sent_at"] else None,
    }
