"""Staff notices: queued, held for NOTICE_HOLD_SECONDS, then mailed (brief: Notices, Services)."""

import logging
from datetime import timedelta

from . import clock, db, mail
from .config import settings

RETRY_SECONDS = 10
log = logging.getLogger("tailboard.notices")


async def _names(conn, *user_ids) -> dict:
    rows = await conn.fetch("SELECT id, display_name, licence FROM users WHERE id = ANY($1)",
                            [u for u in user_ids if u])
    return {r["id"]: r for r in rows}


async def render(conn, kind: str, p: dict) -> tuple[str, str]:
    """Subject and body of a notice from its parameters and the people's current names."""
    if kind == "card_revision":
        subject = f"New revision {p['directive']} {p['new_tag']} affects your work card {p['card']}"
        if p["removed"]:
            change = f"{p['registration']} is no longer in the effectivity of {p['new_tag']}; the thread is not applicable."
        else:
            change = f"New deadline date {p['deadline']}; new flight-hours threshold {p['threshold']:.1f} FH."
        body = (f"{p['directive']} moved from {p['old_tag']} to {p['new_tag']}.\n"
                f"Aircraft {p['registration']}, work card {p['card']}.\n{change}\n")
        return subject, body
    names = await _names(conn, p.get("inspector_id"), p.get("previous_id"))
    inspector = names.get(p["inspector_id"])
    signed_by = (f"{inspector['display_name']}, licence {inspector['licence']}" if inspector and inspector["licence"]
                 else inspector["display_name"] if inspector else "a legacy record")
    where = f"{p['registration']} {p['directive']} {p['tag']}"
    if kind == "countersignature_request":
        return (f"Countersignature requested: {where}",
                f"{where} was inspected by {signed_by} and awaits your countersignature.\n")
    previous = names.get(p.get("previous_id"))
    before = previous["display_name"] if previous else "no certifier"
    return (f"Countersignature passed to you: {where}",
            f"{where} passed to you from {before}. Inspected by {signed_by}.\n")


async def queue(conn, kind: str, to_user_id: str, params: dict, thread_id: str, card_id: str | None = None) -> None:
    address = await conn.fetchval("SELECT email FROM users WHERE id = $1", to_user_id)
    subject, body = await render(conn, kind, params)
    now = clock.now()
    await conn.execute(
        "INSERT INTO notices (id, kind, to_user_id, to_address, subject, body, params, thread_id, card_id, status,"
        " queued_at, send_after) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'queued', $10, $11)",
        db.new_id("ntc"), kind, to_user_id, address, subject, body, params, thread_id, card_id, now,
        now + timedelta(seconds=settings.notice_hold_seconds))


async def card_revision(conn, holder_id: str, thread_id: str, params: dict) -> None:
    """Queue a card notice, or rewrite the still-queued one for the same card to the newest revision."""
    queued = await conn.fetchrow(
        "SELECT id, params FROM notices WHERE kind = 'card_revision' AND card_id = $1 AND status = 'queued' "
        "FOR UPDATE", params["card"])
    if queued is None:
        await queue(conn, "card_revision", holder_id, params, thread_id, params["card"])
        return
    merged = {**params, "old_tag": queued["params"]["old_tag"]}
    subject, body = await render(conn, "card_revision", merged)
    await conn.execute("UPDATE notices SET params = $2, subject = $3, body = $4 WHERE id = $1",
                       queued["id"], merged, subject, body)


async def withdraw_for_threads(conn, thread_ids: list[str], kind: str | None = None) -> None:
    await conn.execute(
        "UPDATE notices SET status = 'withdrawn' WHERE status = 'queued' AND thread_id = ANY($1)"
        " AND ($2::text IS NULL OR kind = $2)", thread_ids, kind)


async def rewrite_naming(conn, user_id: str) -> None:
    """Re-render every queued notice whose body names this person."""
    rows = await conn.fetch(
        "SELECT id, kind, params FROM notices WHERE status = 'queued' AND kind <> 'card_revision' "
        "AND (params->>'inspector_id' = $1 OR params->>'previous_id' = $1) FOR UPDATE", user_id)
    for r in rows:
        subject, body = await render(conn, r["kind"], r["params"])
        await conn.execute("UPDATE notices SET subject = $2, body = $3 WHERE id = $1", r["id"], subject, body)


def notice_json(n) -> dict:
    return {"id": n["id"], "kind": n["kind"], "to": n["to_address"], "subject": n["subject"], "body": n["body"],
            "status": n["status"], "queued_at": clock.iso(n["queued_at"]), "send_after": clock.iso(n["send_after"]),
            "sent_at": clock.iso(n["sent_at"])}


async def send_due() -> None:
    """One pass of the sender: mail every notice whose hold has passed, at most every 10 s while mail is down."""
    now = clock.now()
    async with db.pool.acquire() as conn, conn.transaction():
        due = await conn.fetch(
            "SELECT * FROM notices WHERE status = 'queued' AND send_after <= $1 AND "
            "(last_attempt_at IS NULL OR last_attempt_at <= $2) ORDER BY seq LIMIT 25 FOR UPDATE SKIP LOCKED",
            now, now - timedelta(seconds=RETRY_SECONDS))
        for n in due:
            try:
                await mail.send(n["to_address"], n["subject"], n["body"])
            except mail.MailUnavailable as error:
                log.info("notice %s waits for mail (%s)", n["id"], type(error).__name__)
                await conn.execute("UPDATE notices SET last_attempt_at = $2 WHERE status = 'queued' AND id = ANY($1)",
                                   [x["id"] for x in due], now)
                return
            await conn.execute("UPDATE notices SET status = 'sent', sent_at = $2 WHERE id = $1", n["id"], clock.now())
