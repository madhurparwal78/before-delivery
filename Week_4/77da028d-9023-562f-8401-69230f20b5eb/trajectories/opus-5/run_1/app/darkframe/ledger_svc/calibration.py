"""The calibration library: sets, versions, masters and matching."""

from __future__ import annotations

import json
from datetime import date
from typing import Any

import asyncpg

from .. import ids
from ..domain import calibration as rules, states, timeutil
from ..errors import ApiError, conflict, not_found
from .store import DATABASE

EDITABLE_FIELDS = (
    "name",
    "camera",
    "gain",
    "offset",
    "exposure_s",
    "temperature_c",
    "binning",
    "filter",
    "frame_count",
    "captured_on",
)


async def set_row(imager_id: str, set_id: str) -> asyncpg.Record:
    row = await DATABASE.fetchrow(
        """
        select s.*, v.name, v.camera, v.gain, v.offset_value, v.exposure_s,
               v.temperature_c, v.binning, v.filter, v.frame_count, v.captured_on,
               v.master
        from ledger.calibration_sets s
        join ledger.calibration_versions v
          on v.set_id = s.id and v.version = s.version
        where s.id = $1 and s.imager_id = $2
        """,
        set_id,
        imager_id,
    )
    if row is None:
        raise not_found()
    return row


def _master_body(raw: object) -> dict[str, Any] | None:
    if raw is None:
        return None
    stored = json.loads(raw) if isinstance(raw, str) else raw
    return {
        "filename": stored["filename"],
        "size_bytes": stored["size_bytes"],
        "sha256": stored["sha256"],
    }


def set_body(row: asyncpg.Record, today: date) -> dict[str, Any]:
    age_days = (today - row["captured_on"]).days
    return {
        "id": row["id"],
        "name": row["name"],
        "kind": row["kind"],
        "camera": row["camera"],
        "gain": row["gain"],
        "offset": row["offset_value"],
        "exposure_s": row["exposure_s"],
        "temperature_c": float(row["temperature_c"]),
        "binning": row["binning"],
        "filter": row["filter"],
        "frame_count": row["frame_count"],
        "captured_on": row["captured_on"].isoformat(),
        "status": rules.reported_status(row["status"], age_days, row["kind"]),
        "age_days": age_days,
        "max_age_days": rules.MAX_AGE_DAYS[row["kind"]],
        "version": row["version"],
        "master": _master_body(row["master"]),
    }


def _facts(row: asyncpg.Record) -> rules.SetFacts:
    return rules.SetFacts(
        kind=row["kind"],
        camera=row["camera"],
        gain=row["gain"],
        offset=row["offset_value"],
        exposure_s=row["exposure_s"],
        temperature_c=float(row["temperature_c"]),
        binning=row["binning"],
        filter=row["filter"],
    )


def batch_facts(batch: asyncpg.Record) -> rules.BatchFacts:
    return rules.BatchFacts(
        camera=batch["camera"],
        gain=batch["gain"],
        offset=batch["offset_value"],
        exposure_s=batch["exposure_s"],
        temperature_c=float(batch["temperature_c"]),
        binning=batch["binning"],
        filter=batch["filter"],
    )


async def list_sets(imager_id: str, today: date) -> list[dict[str, Any]]:
    rows = await DATABASE.fetch(
        """
        select s.*, v.name, v.camera, v.gain, v.offset_value, v.exposure_s,
               v.temperature_c, v.binning, v.filter, v.frame_count, v.captured_on,
               v.master
        from ledger.calibration_sets s
        join ledger.calibration_versions v
          on v.set_id = s.id and v.version = s.version
        where s.imager_id = $1 order by v.name
        """,
        imager_id,
    )
    return [set_body(row, today) for row in rows]


async def create_set(imager_id: str, kind: str, fields: dict[str, Any]) -> str:
    set_id = ids.record_id("cal")
    async with DATABASE.transaction() as connection:
        await connection.execute(
            """
            insert into ledger.calibration_sets (id, imager_id, kind, status, version)
            values ($1, $2, $3, 'building', 1)
            """,
            set_id,
            imager_id,
            kind,
        )
        await _write_version(connection, set_id, 1, fields, None)
    return set_id


async def _write_version(
    connection: asyncpg.Connection,
    set_id: str,
    version: int,
    fields: dict[str, Any],
    master: dict[str, Any] | None,
) -> None:
    await connection.execute(
        """
        insert into ledger.calibration_versions (set_id, version, created_at, name,
            camera, gain, offset_value, exposure_s, temperature_c, binning, filter,
            frame_count, captured_on, master)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14::jsonb)
        """,
        set_id,
        version,
        timeutil.now_utc(),
        fields["name"],
        fields["camera"],
        fields["gain"],
        fields["offset"],
        fields["exposure_s"],
        fields["temperature_c"],
        fields["binning"],
        fields["filter"],
        fields["frame_count"],
        fields["captured_on"],
        json.dumps(master) if master is not None else None,
    )


def _current_fields(row: asyncpg.Record) -> dict[str, Any]:
    return {
        "name": row["name"],
        "camera": row["camera"],
        "gain": row["gain"],
        "offset": row["offset_value"],
        "exposure_s": row["exposure_s"],
        "temperature_c": float(row["temperature_c"]),
        "binning": row["binning"],
        "filter": row["filter"],
        "frame_count": row["frame_count"],
        "captured_on": row["captured_on"],
    }


async def _add_version(
    imager_id: str, set_id: str, fields: dict[str, Any], master: dict[str, Any] | None
) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            "select status, version from ledger.calibration_sets "
            "where id = $1 and imager_id = $2 for update",
            set_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        if row["status"] == rules.RETIRED:
            raise conflict("set_retired", "A retired set cannot be changed.")
        version = row["version"] + 1
        await _write_version(connection, set_id, version, fields, master)
        await connection.execute(
            "update ledger.calibration_sets set version = $2 where id = $1",
            set_id,
            version,
        )


async def edit_set(imager_id: str, set_id: str, changes: dict[str, Any]) -> None:
    row = await set_row(imager_id, set_id)
    fields = _current_fields(row)
    fields.update(changes)
    await _add_version(imager_id, set_id, fields, _stored_master(row))


def _stored_master(row: asyncpg.Record) -> dict[str, Any] | None:
    raw = row["master"]
    if raw is None:
        return None
    return json.loads(raw) if isinstance(raw, str) else raw


async def record_master(
    imager_id: str, set_id: str, master: dict[str, Any]
) -> None:
    row = await set_row(imager_id, set_id)
    await _add_version(imager_id, set_id, _current_fields(row), master)


async def master_object(imager_id: str, set_id: str) -> tuple[str, str]:
    row = await set_row(imager_id, set_id)
    master = _stored_master(row)
    if master is None:
        raise not_found()
    return (master["object_key"], master["content_type"])


async def transition(imager_id: str, set_id: str, to_state: str, today: date) -> None:
    async with DATABASE.transaction() as connection:
        row = await connection.fetchrow(
            """
            select s.status, s.kind, v.captured_on, v.master
            from ledger.calibration_sets s
            join ledger.calibration_versions v
              on v.set_id = s.id and v.version = s.version
            where s.id = $1 and s.imager_id = $2 for update of s
            """,
            set_id,
            imager_id,
        )
        if row is None:
            raise not_found()
        reported = rules.reported_status(
            row["status"], (today - row["captured_on"]).days, row["kind"]
        )
        illegal = states.calibration_transition(reported, to_state)
        if illegal is not None:
            raise illegal
        if to_state == rules.READY and row["master"] is None:
            raise conflict(
                "master_missing", "Upload a master before marking a set ready."
            )
        await connection.execute(
            "update ledger.calibration_sets set status = $2 where id = $1",
            set_id,
            to_state,
        )


async def versions(imager_id: str, set_id: str) -> list[dict[str, Any]]:
    await set_row(imager_id, set_id)
    rows = await DATABASE.fetch(
        "select * from ledger.calibration_versions where set_id = $1 order by version",
        set_id,
    )
    return [
        {
            "version": row["version"],
            "created_at": timeutil.iso_utc(row["created_at"]),
            "name": row["name"],
            "camera": row["camera"],
            "gain": row["gain"],
            "offset": row["offset_value"],
            "exposure_s": row["exposure_s"],
            "temperature_c": float(row["temperature_c"]),
            "binning": row["binning"],
            "filter": row["filter"],
            "frame_count": row["frame_count"],
            "captured_on": row["captured_on"].isoformat(),
            "master": _master_body(row["master"]),
        }
        for row in rows
    ]


async def restore_version(imager_id: str, set_id: str, version: int) -> None:
    await set_row(imager_id, set_id)
    row = await DATABASE.fetchrow(
        "select * from ledger.calibration_versions where set_id = $1 and version = $2",
        set_id,
        version,
    )
    if row is None:
        raise not_found()
    await _add_version(
        imager_id, set_id, _current_fields(row), _stored_master(row)
    )


async def candidates(
    imager_id: str, batch: asyncpg.Record, today: date
) -> list[dict[str, Any]]:
    facts = batch_facts(batch)
    found: list[dict[str, Any]] = []
    for row in await DATABASE.fetch(
        """
        select s.*, v.name, v.camera, v.gain, v.offset_value, v.exposure_s,
               v.temperature_c, v.binning, v.filter, v.frame_count, v.captured_on,
               v.master
        from ledger.calibration_sets s
        join ledger.calibration_versions v
          on v.set_id = s.id and v.version = s.version
        where s.imager_id = $1 order by v.name
        """,
        imager_id,
    ):
        mismatched = rules.mismatches(_facts(row), facts)
        found.append(
            {
                "calibration_set_id": row["id"],
                "name": row["name"],
                "kind": row["kind"],
                "status": rules.reported_status(
                    row["status"], (today - row["captured_on"]).days, row["kind"]
                ),
                "matches": not mismatched,
                "reasons": [item.reason for item in mismatched],
            }
        )
    return found


async def link(
    imager_id: str, batch: asyncpg.Record, set_id: str, today: date
) -> str | None:
    row = await set_row(imager_id, set_id)
    reported = rules.reported_status(
        row["status"], (today - row["captured_on"]).days, row["kind"]
    )
    if not rules.calibrates(reported):
        raise conflict(
            "calibration_not_usable",
            f"A calibration set that is {reported} cannot calibrate a batch.",
        )
    mismatched = rules.mismatches(_facts(row), batch_facts(batch))
    if mismatched:
        raise _mismatch_error(mismatched)
    await DATABASE.execute(
        f"update ledger.batches set {row['kind']}_set_id = $2 where id = $1",
        batch["id"],
        set_id,
    )
    return "stale" if reported == rules.STALE else None


def _mismatch_error(mismatched: list[rules.Mismatch]) -> ApiError:
    return ApiError(
        422,
        "calibration_mismatch",
        rules.refusal_message(mismatched),
        extra={
            "mismatches": [
                {
                    "field": item.field,
                    "set": item.set_value,
                    "batch": item.batch_value,
                }
                for item in mismatched
            ]
        },
    )


async def unlink(imager_id: str, batch: asyncpg.Record, kind: str) -> None:
    if kind not in rules.KINDS or batch[f"{kind}_set_id"] is None:
        raise not_found()
    await DATABASE.execute(
        f"update ledger.batches set {kind}_set_id = null where id = $1", batch["id"]
    )


async def unmatched_kinds(
    connection: asyncpg.Connection, batch: asyncpg.Record
) -> list[str]:
    """The kinds whose linked set no longer matches an amended batch."""
    facts = batch_facts(batch)
    dropped: list[str] = []
    for kind in rules.KINDS:
        set_id = batch[f"{kind}_set_id"]
        if set_id is None:
            continue
        row = await connection.fetchrow(
            """
            select s.kind, v.camera, v.gain, v.offset_value, v.exposure_s,
                   v.temperature_c, v.binning, v.filter
            from ledger.calibration_sets s
            join ledger.calibration_versions v
              on v.set_id = s.id and v.version = s.version
            where s.id = $1
            """,
            set_id,
        )
        if rules.mismatches(_facts(row), facts):
            dropped.append(kind)
    return dropped
