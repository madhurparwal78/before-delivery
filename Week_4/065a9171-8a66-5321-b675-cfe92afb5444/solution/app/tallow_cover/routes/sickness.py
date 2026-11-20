"""Report sickness, upload a fit note, open it through a signed link, record the return."""

import secrets
from datetime import timedelta

from .. import db, shifts, storage
from ..access import CW, HR, UM
from ..errors import REASON_MSG, ApiError, reason, unsupported_file
from ..ids import new_id
from ..projections import sickness as project
from ..sickness import (
    FIT_NOTE_MAX_BYTES,
    STATUS_LABELS,
    can_close,
    file_name,
    fit_note_kind,
    require_fit_notes,
)
from ..web import Call, api, multipart_file, reply

SICK_BACK_DAYS = 28
SICKNESS_SQL = "SELECT s.*, p.display_name FROM sickness s JOIN people p ON p.id = s.person_id"
FIT_NOTE_SQL = "SELECT *, held IS NOT NULL AS pending FROM fit_notes WHERE sickness_id = $1"


async def body_of(conn, me, record_id: str) -> dict:
    record = await conn.fetchrow(SICKNESS_SQL + " WHERE s.id = $1", record_id)
    return project(record, me, await conn.fetchrow(FIT_NOTE_SQL, record_id))


async def visible(conn, me, record_id: str, *, lock: bool = False):
    """The record for its owner, an HR admin or a unit manager of its home; otherwise not_found."""
    await require_fit_notes(conn, record_id=record_id)
    record = await conn.fetchrow(SICKNESS_SQL + " WHERE s.id = $1" + (" FOR UPDATE OF s" if lock else ""), record_id)
    if record is None or not (record["person_id"] == me["id"] or me["role"] == HR
                              or (me["role"] == UM and me["home_id"] == record["home_id"])):
        raise ApiError("not_found")
    return record


def require_owner(me, record) -> None:
    if record["person_id"] != me["id"]:
        raise ApiError("forbidden")


def refuse(record, action: str) -> ApiError:
    return ApiError("invalid_transition",
                    f"This sickness record is {STATUS_LABELS[record['status']]} and can't be {action}.",
                    status=record["status"])


@api("GET", "/api/me/sickness", roles=(CW,))
async def mine(call: Call):
    async with db.pool.acquire() as conn:
        await require_fit_notes(conn, call.me["id"])
        ids = [r["id"] for r in await conn.fetch("SELECT id FROM sickness WHERE person_id = $1"
                                                 " ORDER BY start_date DESC, created_at DESC", call.me["id"])]
        return reply({"items": [await body_of(conn, call.me, i) for i in ids]})


@api("POST", "/api/sickness", roles=(CW,), keys=("start_date", "reason"))
async def report(call: Call):
    start = shifts.parse_date(call.body.get("start_date"))
    why = reason(call.body.get("reason"))
    fields = call.fields()
    today = shifts.today()
    if start is None or not today - timedelta(days=SICK_BACK_DAYS) <= start <= today:
        fields.fail("start_date", "Sickness can start up to 28 days ago and not in the future.")
    if why is None:
        fields.fail("reason", REASON_MSG)
    fields.check()
    async with db.pool.acquire() as conn:
        record_id = new_id("sk")
        await conn.execute("INSERT INTO sickness (id, person_id, home_id, start_date, status, reason)"
                           " VALUES ($1, $2, $3, $4, 'reported', $5)",
                           record_id, call.me["id"], call.me["home_id"], start, why)
        await require_fit_notes(conn, call.me["id"])
        return reply(await body_of(conn, call.me, record_id), 201)


@api("GET", "/api/sickness/{id}")
async def one(call: Call):
    async with db.pool.acquire() as conn:
        await visible(conn, call.me, call.path("id"))
        return reply(await body_of(conn, call.me, call.path("id")))


@api("POST", "/api/sickness/{id}/fit-note", multipart=True)
async def upload_fit_note(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        record = await visible(conn, call.me, call.path("id"), lock=True)
        require_owner(call.me, record)
        if record["status"] not in ("reported", "fit_note_required"):
            raise refuse(record, "given a fit note")
        part = multipart_file(call, "file")
        if part is None:
            raise unsupported_file()
        name, data = part
        if len(data) > FIT_NOTE_MAX_BYTES:
            raise ApiError("too_large")
        kind = fit_note_kind(data)
        if kind is None:
            raise unsupported_file()
        extension, content_type = kind
        upload_id = secrets.token_hex(12)
        key = f"fit-notes/{record['home_id']}/{record['id']}/{upload_id}.{extension}"
        stored = await storage.put(key, data, content_type)
        await conn.execute("INSERT INTO fit_notes (id, sickness_id, file_name, content_type, storage_key, held)"
                           " VALUES ($1, $2, $3, $4, $5, $6)",
                           upload_id, record["id"], file_name(name), content_type, key, None if stored else data)
        await conn.execute("UPDATE sickness SET status = 'evidenced' WHERE id = $1", record["id"])
        return reply(await body_of(conn, call.me, record["id"]), 201)


@api("GET", "/api/sickness/{id}/fit-note")
async def fit_note_link(call: Call):
    async with db.pool.acquire() as conn:
        record = await visible(conn, call.me, call.path("id"))
        if not (record["person_id"] == call.me["id"] or call.me["role"] == HR):
            raise ApiError("forbidden")
        note = await conn.fetchrow(FIT_NOTE_SQL, record["id"])
        if note is None:
            raise ApiError("not_found")
        if note["pending"]:
            raise ApiError("storage_pending")
        return reply({"url": storage.presigned_get(note["storage_key"], note["content_type"], note["file_name"]),
                      "expires_in_seconds": storage.SIGNED_SECONDS})


@api("POST", "/api/sickness/{id}/return", keys=("last_sick_date",))
async def record_return(call: Call):
    async with db.pool.acquire() as conn, conn.transaction():
        record = await visible(conn, call.me, call.path("id"), lock=True)
        require_owner(call.me, record)
        if record["status"] == "closed":
            raise refuse(record, "closed")
        last = shifts.parse_date(call.body.get("last_sick_date"))
        fields = call.fields()
        if last is None or not record["start_date"] <= last <= shifts.today():
            fields.fail("last_sick_date", "The last day off sick must be between the first day and today.")
        elif not can_close(record["status"], (last - record["start_date"]).days + 1):
            raise ApiError("fit_note_missing")
        fields.check()
        await conn.execute("UPDATE sickness SET status = 'closed', last_sick_date = $2 WHERE id = $1",
                           record["id"], last)
        return reply(await body_of(conn, call.me, record["id"]))
