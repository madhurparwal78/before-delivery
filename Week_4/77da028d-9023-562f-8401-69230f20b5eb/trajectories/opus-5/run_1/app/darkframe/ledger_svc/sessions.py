"""Sessions, batches, frames and the edit lock."""

from __future__ import annotations

import asyncio
import hashlib
import json
from datetime import timedelta
from typing import Any, Awaitable, Callable

import asyncpg

from .. import ids
from ..config import CONFIG
from ..domain import paired_ledger as ledger_rules, states, timeutil
from ..errors import conflict, not_found
from .calibration import unmatched_kinds
from .projects import (
    latest_unreversed_log_for_batch,
    post_movement,
    reverse_movement,
    unreversed_log_movements,
)
from .store import DATABASE

BATCH_FIELD_NAMES = (
    "filter",
    "sub_count",
    "exposure_s",
    "camera",
    "gain",
    "offset",
    "temperature_c",
    "binning",
)
IDEMPOTENCY_LIFETIME_HOURS = 24
IN_FLIGHT = 0


def batch_body(row: asyncpg.Record, frame_count: int) -> dict[str, Any]:
    return {
        "id": row["id"],
        "filter": row["filter"],
        "sub_count": row["sub_count"],
        "exposure_s": row["exposure_s"],
        "integration_seconds": ledger_rules.integration_seconds(
            row["sub_count"], row["exposure_s"]
        ),
        "camera": row["camera"],
        "gain": row["gain"],
        "offset": row["offset_value"],
        "temperature_c": float(row["temperature_c"]),
        "binning": row["binning"],
        "calibration": {
            "dark": row["dark_set_id"],
            "flat": row["flat_set_id"],
            "bias": row["bias_set_id"],
        },
        "frame_count": frame_count,
    }


def frame_body(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "id": row["id"],
        "batch_id": row["batch_id"],
        "name": row["name"],
        "size_bytes": int(row["size_bytes"]),
        "content_type": row["content_type"],
        "sha256": row["sha256"],
    }


async def session_row(imager_id: str, session_id: str) -> asyncpg.Record:
    row = await DATABASE.fetchrow(
        """
        select s.*, p.name as project_name, p.state as project_state
        from ledger.sessions s join ledger.projects p on p.id = s.project_id
        where s.id = $1 and s.imager_id = $2
        """,
        session_id,
        imager_id,
    )
    if row is None:
        raise not_found()
    return row


async def session_body(row: asyncpg.Record) -> dict[str, Any]:
    batches = await DATABASE.fetch(
        "select * from ledger.batches where session_id = $1 order by position",
        row["id"],
    )
    frames = await DATABASE.fetch(
        "select * from ledger.frames where session_id = $1 order by created_at, id",
        row["id"],
    )
    per_batch: dict[str, int] = {}
    for frame in frames:
        per_batch[frame["batch_id"]] = per_batch.get(frame["batch_id"], 0) + 1
    return {
        "id": row["id"],
        "project_id": row["project_id"],
        "project_name": row["project_name"],
        "state": row["state"],
        "previous_state": row["previous_state"],
        "observing_date": row["observing_date"].isoformat(),
        "started_at": timeutil.iso_utc(row["started_at"]) if row["started_at"] else None,
        "logged_at": timeutil.iso_utc(row["logged_at"]) if row["logged_at"] else None,
        "notes": row["notes"],
        "batches": [
            batch_body(batch, per_batch.get(batch["id"], 0)) for batch in batches
        ],
        "frames": [frame_body(frame) for frame in frames],
        "frame_count": len(frames),
        "integration_seconds": sum(
            ledger_rules.integration_seconds(batch["sub_count"], batch["exposure_s"])
            for batch in batches
        ),
    }


async def body_of(imager_id: str, session_id: str) -> dict[str, Any]:
    return await session_body(await session_row(imager_id, session_id))


async def create_session(
    imager_id: str,
    project_id: str,
    read_session: Callable[[], Awaitable[tuple[Any, str]]],
) -> str:
    async with DATABASE.transaction() as connection:
        project = await connection.fetchrow(
            "select state from ledger.projects where id = $1 and imager_id = $2",
            project_id,
            imager_id,
        )
        if project is None:
            raise not_found()
        if project["state"] != "active":
            raise conflict(
                "project_not_active", "Only an active project can take sessions."
            )
        observing_date, notes = await read_session()
        session_id = ids.record_id("ses")
        await connection.execute(
            """
            insert into ledger.sessions
                (id, imager_id, project_id, state, observing_date, notes)
            values ($1, $2, $3, 'planned', $4, $5)
            """,
            session_id,
            imager_id,
            project_id,
            observing_date,
            notes,
        )
        return session_id


async def start_session(
    imager_id: str,
    session_id: str,
    read_start: Callable[[], Awaitable[Any]],
    zone: str,
) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            """
            select s.state, p.state as project_state from ledger.sessions s
            join ledger.projects p on p.id = s.project_id
            where s.id = $1 and s.imager_id = $2 for update of s
            """,
            session_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        illegal = states.session_transition(row["state"], "imaging")
        if illegal is not None:
            raise illegal
        if row["project_state"] != "active":
            raise conflict(
                "project_not_active", "Only an active project can take sessions."
            )
        started_at = await read_start()
        await connection.execute(
            """
            update ledger.sessions
            set state = 'imaging', previous_state = $3,
                started_at = $2, observing_date = $4
            where id = $1
            """,
            session_id,
            started_at,
            row["state"],
            timeutil.observing_date_of(started_at, zone),
        )


BatchValidator = Callable[[str], Awaitable[dict[str, Any]]]


async def add_batch(
    imager_id: str, session_id: str, validate_fields: BatchValidator
) -> str:
    """The state guard runs before the field validation, as error precedence asks."""
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state, project_id from ledger.sessions "
            "where id = $1 and imager_id = $2 for update",
            session_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        if row["state"] != "imaging":
            raise conflict("wrong_state", "Batches can only be added while imaging.")
        fields = await validate_fields(row["project_id"])
        position = int(
            await connection.fetchval(
                "select coalesce(max(position), 0) + 1 from ledger.batches "
                "where session_id = $1",
                session_id,
            )
        )
        batch_id = ids.record_id("bat")
        await _insert_batch(
            connection, imager_id, session_id, batch_id, position, fields
        )
        return batch_id


async def _insert_batch(
    connection: asyncpg.Connection,
    imager_id: str,
    session_id: str,
    batch_id: str,
    position: int,
    fields: dict[str, Any],
) -> None:
    await connection.execute(
        """
        insert into ledger.batches (id, imager_id, session_id, position, filter,
            sub_count, exposure_s, camera, gain, offset_value, temperature_c, binning)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
        """,
        batch_id,
        imager_id,
        session_id,
        position,
        fields["filter"],
        fields["sub_count"],
        fields["exposure_s"],
        fields["camera"],
        fields["gain"],
        fields["offset"],
        fields["temperature_c"],
        fields["binning"],
    )


async def log_session(imager_id: str, session_id: str) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state, project_id from ledger.sessions "
            "where id = $1 and imager_id = $2 for update",
            session_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        illegal = states.session_transition(row["state"], "logged")
        if illegal is not None:
            raise illegal
        batches = await connection.fetch(
            "select * from ledger.batches where session_id = $1 order by position",
            session_id,
        )
        if not batches:
            raise conflict("no_batches", "Add at least one batch before logging.")
        for batch in batches:
            await _post_batch_log(connection, imager_id, row["project_id"], session_id, batch)
        await connection.execute(
            """
            update ledger.sessions
            set state = 'logged', previous_state = $2, logged_at = $3
            where id = $1
            """,
            session_id,
            row["state"],
            timeutil.now_utc(),
        )


async def _post_batch_log(
    connection: asyncpg.Connection,
    imager_id: str,
    project_id: str,
    session_id: str,
    batch: asyncpg.Record,
) -> None:
    await post_movement(
        connection,
        imager_id=imager_id,
        project_id=project_id,
        kind=ledger_rules.LOG,
        filter_name=batch["filter"],
        entries=ledger_rules.log_entries(
            ledger_rules.integration_seconds(batch["sub_count"], batch["exposure_s"])
        ),
        session_id=session_id,
        batch_id=batch["id"],
    )


def _batch_fields_of(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "filter": row["filter"],
        "sub_count": row["sub_count"],
        "exposure_s": row["exposure_s"],
        "camera": row["camera"],
        "gain": row["gain"],
        "offset": row["offset_value"],
        "temperature_c": float(row["temperature_c"]),
        "binning": row["binning"],
    }


AmendValidator = Callable[[str], Awaitable[list[dict[str, Any]]]]


async def amend_session(
    imager_id: str,
    session_id: str,
    offered_ids: list[str],
    validate_batches: AmendValidator,
) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state, project_id from ledger.sessions "
            "where id = $1 and imager_id = $2 for update",
            session_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        project_id = row["project_id"]
        existing = {
            batch["id"]: batch
            for batch in await connection.fetch(
                "select * from ledger.batches where session_id = $1 order by position",
                session_id,
            )
        }
        if any(offered not in existing for offered in offered_ids):
            raise not_found()
        illegal = states.session_transition(row["state"], "amended")
        if illegal is not None:
            raise illegal
        kept = set(offered_ids)
        for batch_id in existing:
            if batch_id in kept:
                continue
            frames = await connection.fetchval(
                "select count(*) from ledger.frames where batch_id = $1", batch_id
            )
            if frames:
                raise conflict(
                    "batch_has_frames",
                    "A batch with uploaded frames cannot be removed.",
                )
        wanted = await validate_batches(project_id)
        for batch_id, batch in existing.items():
            if batch_id in kept:
                continue
            await _reverse_batch(connection, imager_id, project_id, session_id, batch)
            await connection.execute(
                "delete from ledger.batches where id = $1", batch_id
            )

        position = 0
        for item in wanted:
            position += 1
            fields = {name: item[name] for name in BATCH_FIELD_NAMES}
            batch_id = item.get("id")
            if batch_id is None:
                batch_id = ids.record_id("bat")
                await _insert_batch(
                    connection, imager_id, session_id, batch_id, position, fields
                )
                batch = await connection.fetchrow(
                    "select * from ledger.batches where id = $1", batch_id
                )
                await _post_batch_log(
                    connection, imager_id, project_id, session_id, batch
                )
                continue
            batch = existing[batch_id]
            await connection.execute(
                "update ledger.batches set position = $2 where id = $1",
                batch_id,
                position,
            )
            if _batch_fields_of(batch) == fields:
                continue
            await _reverse_batch(connection, imager_id, project_id, session_id, batch)
            await connection.execute(
                """
                update ledger.batches
                set filter = $2, sub_count = $3, exposure_s = $4, camera = $5,
                    gain = $6, offset_value = $7, temperature_c = $8, binning = $9
                where id = $1
                """,
                batch_id,
                fields["filter"],
                fields["sub_count"],
                fields["exposure_s"],
                fields["camera"],
                fields["gain"],
                fields["offset"],
                fields["temperature_c"],
                fields["binning"],
            )
            updated = await connection.fetchrow(
                "select * from ledger.batches where id = $1", batch_id
            )
            await _post_batch_log(
                connection, imager_id, project_id, session_id, updated
            )
            await _drop_unmatched_calibration(connection, updated)
        await connection.execute(
            """
            update ledger.sessions set state = 'amended', previous_state = $2
            where id = $1
            """,
            session_id,
            row["state"],
        )


async def _reverse_batch(
    connection: asyncpg.Connection,
    imager_id: str,
    project_id: str,
    session_id: str,
    batch: asyncpg.Record,
) -> None:
    movement = await latest_unreversed_log_for_batch(connection, batch["id"])
    if movement is None:
        return
    await reverse_movement(
        connection,
        imager_id=imager_id,
        project_id=project_id,
        movement_id=movement["movement_id"],
        filter_name=movement["filter"],
        session_id=session_id,
        batch_id=batch["id"],
    )


async def _drop_unmatched_calibration(
    connection: asyncpg.Connection, batch: asyncpg.Record
) -> None:
    for kind in await unmatched_kinds(connection, batch):
        await connection.execute(
            f"update ledger.batches set {kind}_set_id = null where id = $1",
            batch["id"],
        )


async def trash_session(imager_id: str, session_id: str) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state, project_id from ledger.sessions "
            "where id = $1 and imager_id = $2 for update",
            session_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        illegal = states.session_transition(row["state"], "trashed")
        if illegal is not None:
            raise illegal
        for movement in await unreversed_log_movements(connection, session_id):
            await reverse_movement(
                connection,
                imager_id=imager_id,
                project_id=row["project_id"],
                movement_id=movement["movement_id"],
                filter_name=movement["filter"],
                session_id=session_id,
                batch_id=movement["batch_id"],
            )
        await connection.execute(
            """
            update ledger.sessions set state = 'trashed', previous_state = $2
            where id = $1
            """,
            session_id,
            row["state"],
        )


async def restore_session(imager_id: str, session_id: str) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select state, previous_state, project_id from ledger.sessions "
            "where id = $1 and imager_id = $2 for update",
            session_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        if row["state"] != "trashed":
            raise conflict(
                "illegal_transition",
                f"A session that is {row['state']} cannot become restored.",
            )
        restored = row["previous_state"]
        if restored in ("logged", "amended"):
            for batch in await connection.fetch(
                "select * from ledger.batches where session_id = $1 order by position",
                session_id,
            ):
                await _post_batch_log(
                    connection, imager_id, row["project_id"], session_id, batch
                )
        await connection.execute(
            "update ledger.sessions set state = $2, previous_state = 'trashed' "
            "where id = $1",
            session_id,
            restored,
        )


async def take_lock(
    imager_id: str, session_id: str, offered_token: str | None
) -> dict[str, Any]:
    async with DATABASE.transaction() as connection:
        session = await connection.fetchrow(
            "select state from ledger.sessions where id = $1 and imager_id = $2",
            session_id,
            imager_id,
        )
        if session is None:
            raise not_found()
        if session["state"] == "trashed":
            raise conflict("wrong_state", "A trashed session cannot be edited.")
        await connection.execute(
            "select pg_advisory_xact_lock(hashtext($1))", f"lock:{session_id}"
        )
        now = timeutil.now_utc()
        expires = now + timedelta(seconds=CONFIG.draft_lock_seconds)
        held = await connection.fetchrow(
            "select lock_token, expires_at from ledger.session_locks "
            "where session_id = $1",
            session_id,
        )
        if (
            held is not None
            and held["expires_at"] > now
            and held["lock_token"] != offered_token
        ):
            raise conflict(
                "session_locked",
                "This session is open for editing on another device.",
            )
        renewing = held is not None and held["lock_token"] == offered_token
        token = held["lock_token"] if renewing else ids.lock_token()
        await connection.execute(
            """
            insert into ledger.session_locks
                (session_id, imager_id, lock_token, expires_at)
            values ($1, $2, $3, $4)
            on conflict (session_id) do update
            set lock_token = excluded.lock_token, expires_at = excluded.expires_at
            """,
            session_id,
            imager_id,
            token,
            expires,
        )
        return {
            "lock_token": token,
            "expires_at": timeutil.iso_utc(expires),
            "expires_in_seconds": CONFIG.draft_lock_seconds,
        }


async def release_lock(imager_id: str, session_id: str, token: str) -> None:
    async with DATABASE.transaction() as connection:
        session = await connection.fetchval(
            "select 1 from ledger.sessions where id = $1 and imager_id = $2",
            session_id,
            imager_id,
        )
        if session is None:
            raise not_found()
        held = await connection.fetchrow(
            "select lock_token from ledger.session_locks where session_id = $1 "
            "for update",
            session_id,
        )
        if held is not None and held["lock_token"] != token:
            raise conflict(
                "session_locked",
                "This session is open for editing on another device.",
            )
        await connection.execute(
            "delete from ledger.session_locks where session_id = $1", session_id
        )


async def save_notes(
    imager_id: str,
    session_id: str,
    read_notes: Callable[[], Awaitable[tuple[str, str]]],
) -> None:
    async with DATABASE.transaction() as connection:
        session = await connection.fetchrow(
            "select state from ledger.sessions where id = $1 and imager_id = $2 "
            "for update",
            session_id,
            imager_id,
        )
        if session is None:
            raise not_found()
        if session["state"] == "trashed":
            raise conflict("wrong_state", "A trashed session cannot be edited.")
        notes, token = await read_notes()
        held = await connection.fetchrow(
            "select lock_token, expires_at from ledger.session_locks "
            "where session_id = $1",
            session_id,
        )
        now = timeutil.now_utc()
        if held is None:
            raise conflict(
                "lock_expired",
                "Your edit lock expired. Your notes are kept; save to take the "
                "lock again.",
            )
        if held["lock_token"] != token:
            raise conflict(
                "session_locked",
                "This session is open for editing on another device.",
            )
        if held["expires_at"] <= now:
            raise conflict(
                "lock_expired",
                "Your edit lock expired. Your notes are kept; save to take the "
                "lock again.",
            )
        await connection.execute(
            "update ledger.sessions set notes = $2 where id = $1", session_id, notes
        )


def body_fingerprint(body: dict[str, Any]) -> str:
    return hashlib.sha256(
        json.dumps(body, sort_keys=True, separators=(",", ":")).encode()
    ).hexdigest()


async def claim_idempotency(
    imager_id: str, key: str, fingerprint: str
) -> tuple[bool, dict[str, Any] | None]:
    """Claims a key, or returns the stored reply of a matching earlier submit."""
    await DATABASE.execute(
        "delete from ledger.idempotency where created_at < $1",
        timeutil.now_utc() - timedelta(hours=IDEMPOTENCY_LIFETIME_HOURS),
    )
    claimed = await DATABASE.fetchval(
        """
        insert into ledger.idempotency (imager_id, key, body_hash, status, response)
        values ($1, $2, $3, $4, null::jsonb)
        on conflict (imager_id, key) do nothing
        returning key
        """,
        imager_id,
        key,
        fingerprint,
        IN_FLIGHT,
    )
    if claimed is not None:
        return (True, None)
    for _ in range(60):
        row = await DATABASE.fetchrow(
            "select body_hash, status, response from ledger.idempotency "
            "where imager_id = $1 and key = $2",
            imager_id,
            key,
        )
        if row is None:
            return (True, None)
        if row["body_hash"] != fingerprint:
            raise conflict(
                "idempotency_conflict",
                "That idempotency key was already used with a different body.",
            )
        if row["status"] != IN_FLIGHT:
            return (False, {"status": row["status"], "body": json.loads(row["response"])})
        await asyncio.sleep(0.05)
    raise conflict(
        "idempotency_conflict", "That idempotency key is still being processed."
    )


async def store_idempotent_reply(
    imager_id: str, key: str, status: int, body: dict[str, Any]
) -> None:
    await DATABASE.execute(
        "update ledger.idempotency set status = $3, response = $4::jsonb "
        "where imager_id = $1 and key = $2",
        imager_id,
        key,
        status,
        json.dumps(body),
    )


async def drop_idempotency_claim(imager_id: str, key: str) -> None:
    await DATABASE.execute(
        "delete from ledger.idempotency where imager_id = $1 and key = $2 "
        "and status = $3",
        imager_id,
        key,
        IN_FLIGHT,
    )


async def batch_row(imager_id: str, batch_id: str) -> asyncpg.Record:
    row = await DATABASE.fetchrow(
        """
        select b.*, s.state as session_state, s.project_id
        from ledger.batches b join ledger.sessions s on s.id = b.session_id
        where b.id = $1 and b.imager_id = $2
        """,
        batch_id,
        imager_id,
    )
    if row is None:
        raise not_found()
    return row


async def batch_body_of(imager_id: str, batch_id: str) -> dict[str, Any]:
    row = await batch_row(imager_id, batch_id)
    frames = await DATABASE.fetchval(
        "select count(*) from ledger.frames where batch_id = $1", batch_id
    )
    return batch_body(row, int(frames))


async def sessions_for(
    imager_id: str, project_id: str | None, include_trashed: bool
) -> list[dict[str, Any]]:
    rows = await DATABASE.fetch(
        """
        select s.*, p.name as project_name from ledger.sessions s
        join ledger.projects p on p.id = s.project_id
        where s.imager_id = $1
          and ($2::text is null or s.project_id = $2)
          and ($3::boolean or s.state <> 'trashed')
        order by s.observing_date desc, s.created_at desc
        """,
        imager_id,
        project_id,
        include_trashed,
    )
    return [await session_body(row) for row in rows]


def guard_frame_upload(session_state: str) -> None:
    if session_state in ("planned", "trashed"):
        raise conflict(
            "wrong_state", "Frames can only be uploaded to a started session."
        )
