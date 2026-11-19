"""Read models: thread, board and directive assembly with derived states computed on every read."""
import json
from datetime import datetime, timezone

import asyncpg

from . import rules
from .clock import clock, format_iso, parse_iso
from .domain import AUTHORITIES, MODELS, OPEN_WORK_STAGES, tag_of



class Repo:
    def __init__(self, pool: asyncpg.Pool):
        self.pool = pool

    async def person_by_session(self, token: str):
        row = await self.pool.fetchrow(
            """SELECT p.* FROM sessions s JOIN people p ON p.id = s.person_id
               WHERE s.token = $1""", token)
        return row

    async def people(self):
        return await self.pool.fetch(
            """SELECT * FROM people WHERE username IS NOT NULL ORDER BY display_name""")

    async def person(self, person_id: str):
        return await self.pool.fetchrow("SELECT * FROM people WHERE id = $1", person_id)

    async def tails(self):
        return await self.pool.fetch(
            "SELECT * FROM tails ORDER BY registration")

    async def tail(self, registration: str):
        return await self.pool.fetchrow("SELECT * FROM tails WHERE registration = $1", registration)

    async def last_log_instant(self, registration: str):
        row = await self.pool.fetchrow(
            "SELECT logged_at FROM flight_hours WHERE registration = $1 ORDER BY logged_at DESC, id DESC LIMIT 1",
            registration)
        return row["logged_at"] if row else None

    async def lineages(self):
        return await self.pool.fetch(
            """SELECT l.*, (SELECT json_agg(r ORDER BY r.revision) FROM (
                   SELECT * FROM revisions WHERE lineage_id = l.id) r) AS revisions
               FROM lineages l
               ORDER BY l.authority, l.number""")

    async def lineage(self, lineage_id: str):
        return await self.pool.fetchrow("SELECT * FROM lineages WHERE id = $1", lineage_id)

    async def revisions_of(self, lineage_id: str):
        return await self.pool.fetch(
            "SELECT * FROM revisions WHERE lineage_id = $1 ORDER BY revision", lineage_id)

    async def threads_of_lineage(self, lineage_id: str):
        return await self.pool.fetch(
            """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation
               FROM threads t
               JOIN work_cards w ON w.thread_id = t.id
               JOIN tails tm ON tm.registration = t.registration
               WHERE t.lineage_id = $1 ORDER BY t.registration""", lineage_id)

    async def thread(self, thread_id: str):
        return await self.pool.fetchrow(
            """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation
               FROM threads t
               JOIN work_cards w ON w.thread_id = t.id
               JOIN tails tm ON tm.registration = t.registration
               WHERE t.id = $1""", thread_id)

    async def thread_by_tail(self, lineage_id: str, registration: str):
        return await self.pool.fetchrow(
            """SELECT t.*, w.card_id, tm.model, tm.msn, tm.total_hours, tm.daily_utilisation
               FROM threads t
               JOIN work_cards w ON w.thread_id = t.id
               JOIN tails tm ON tm.registration = t.registration
               WHERE t.lineage_id = $1 AND t.registration = $2""", lineage_id, registration)

    async def signatures_of(self, thread_id: str):
        return await self.pool.fetch(
            """SELECT s.* FROM signatures s WHERE s.thread_id = $1
               ORDER BY s.committed_at, s.id""", thread_id)

    async def evidence_of(self, thread_id: str):
        return await self.pool.fetch(
            "SELECT * FROM evidence WHERE thread_id = $1 ORDER BY attached_at, id", thread_id)

    async def deferral_of(self, thread_id: str):
        return await self.pool.fetchrow(
            "SELECT * FROM deferrals WHERE thread_id = $1", thread_id)

    async def history_of(self, thread_id: str):
        return await self.pool.fetch(
            "SELECT * FROM history_entries WHERE thread_id = $1 ORDER BY revision", thread_id)

    async def legacy_of(self, thread_id: str):
        return await self.pool.fetch(
            "SELECT * FROM legacy_records WHERE thread_id = $1 ORDER BY created_at, id", thread_id)

    async def standby_of(self, model: str):
        return await self.pool.fetch(
            """SELECT s.person_id, p.display_name, p.licence, p.erased, p.signer_token, p.scope
               FROM standby s JOIN people p ON p.id = s.person_id
               WHERE s.model = $1 ORDER BY s.position""", model)

    async def audit_entries(self, directive_id=None, thread_id=None):
        if directive_id:
            return await self.pool.fetch(
                "SELECT * FROM audit WHERE directive_id = $1 ORDER BY id DESC LIMIT 500", directive_id)
        if thread_id:
            return await self.pool.fetch(
                "SELECT * FROM audit WHERE thread_id = $1 ORDER BY id DESC LIMIT 500", thread_id)
        return await self.pool.fetch("SELECT * FROM audit ORDER BY id DESC LIMIT 500")

    async def notices(self, status=None):
        if status:
            return await self.pool.fetch(
                "SELECT * FROM notices WHERE status = $1 ORDER BY queued_at DESC", status)
        return await self.pool.fetch("SELECT * FROM notices ORDER BY queued_at DESC")

    async def packs(self):
        return await self.pool.fetch("SELECT * FROM packs ORDER BY requested_at DESC")

    async def pack(self, pack_id: str):
        return await self.pool.fetchrow("SELECT * FROM packs WHERE id = $1", pack_id)

    async def queued_pack_for(self, lineage_id: str):
        return await self.pool.fetchrow(
            "SELECT * FROM packs WHERE lineage_id = $1 AND status = 'queued'", lineage_id)

    async def import_by_hash(self, file_sha256: str):
        return await self.pool.fetchrow("SELECT * FROM imports WHERE file_sha256 = $1", file_sha256)

    async def imports(self):
        return await self.pool.fetch("SELECT * FROM imports ORDER BY imported_at DESC")


def person_shape(row) -> dict:
    if row is None:
        return None
    if row["erased"]:
        return {"id": row["id"], "display_name": row["signer_token"], "licence": None, "erased": True}
    return {
        "id": row["id"],
        "display_name": row["display_name"],
        "licence": row["licence"],
        "erased": False,
    }


def user_shape(row) -> dict:
    shape = person_shape(row)
    shape.update({
        "username": row["username"],
        "role": row["role"],
        "contractor": row["contractor"],
        "email": None if row["erased"] else row["email"],
        "scope": json.loads(row["scope"]) if row["scope"] else None,
    })
    return shape


def revision_shape(row, ingested_by_person) -> dict:
    return {
        "revision": row["revision"],
        "title": row["title"],
        "method": row["method"],
        "effective_date": row["effective_date"].isoformat(),
        "calendar_days": row["calendar_days"],
        "fh_interval": float(row["fh_interval"]),
        "applicability": json.loads(row["applicability"]),
        "prior_credit": row["prior_credit"],
        "document_key": row["document_key"],
        "ingested_at": format_iso(row["ingested_at"]),
        "ingested_by": ingested_by_person,
    }


def directive_shape(lineage_row, revision_rows, ingested_by: dict) -> dict:
    revisions = [revision_shape(r, ingested_by.get(r["ingested_by"])) for r in revision_rows]
    current = revisions[-1]
    return {
        "id": lineage_row["id"],
        "authority": lineage_row["authority"],
        "number": lineage_row["number"],
        "title": current["title"],
        "revision": lineage_row["revision"],
        "status": lineage_row["status"],
        "revisions": revisions,
    }


def label_of(lineage_row) -> str:
    return f"{lineage_row['authority']} {lineage_row['number']}"
