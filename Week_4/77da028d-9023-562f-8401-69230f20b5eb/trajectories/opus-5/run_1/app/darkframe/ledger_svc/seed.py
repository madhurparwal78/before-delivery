"""Applies the ledger's share of the seed workspaces, once, to an empty database."""

from __future__ import annotations

import hashlib
import json
from datetime import date, timedelta
from typing import Any

import asyncpg

from .. import objectstore
from ..domain import paired_ledger as ledger_rules, timeutil
from ..seed import MASTER_CONTENT_TYPE, MASTER_FILENAME, SEED_MARKER, master_bytes
from .projects import post_movement
from .store import DATABASE


async def apply_seed(imagers: list[dict[str, Any]]) -> None:
    await objectstore.ensure_bucket()
    async with DATABASE.transaction() as connection:
        claimed = await connection.fetchval(
            "insert into ledger.seeded (marker) values ($1) "
            "on conflict do nothing returning marker",
            SEED_MARKER,
        )
        if claimed is None:
            return
        for imager in imagers:
            today = timeutil.to_local(
                timeutil.now_utc(), imager["site"]["time_zone"]
            ).date()
            await _seed_imager(connection, imager, today)


async def _seed_imager(
    connection: asyncpg.Connection, imager: dict[str, Any], today: date
) -> None:
    imager_id = imager["imager_id"]
    for candidate in imager["calibration_sets"]:
        await _seed_set(connection, imager_id, candidate, today)
    for project in imager["projects"]:
        await _seed_project(connection, imager_id, project)
    for session in imager["sessions"]:
        await _seed_session(connection, imager_id, session)


async def _seed_project(
    connection: asyncpg.Connection, imager_id: str, project: dict[str, Any]
) -> None:
    await connection.execute(
        """
        insert into ledger.projects
            (id, imager_id, name, target_name, ra_deg, dec_deg, state)
        values ($1, $2, $3, $4, $5, $6, $7)
        """,
        project["id"],
        imager_id,
        project["name"],
        project["target_name"],
        project["ra_deg"],
        project["dec_deg"],
        project["state"],
    )
    for filter_name, planned in project["allotments"].items():
        await post_movement(
            connection,
            imager_id=imager_id,
            project_id=project["id"],
            kind=ledger_rules.ALLOT,
            filter_name=filter_name,
            entries=ledger_rules.allot_entries(0, planned),
        )


async def _seed_session(
    connection: asyncpg.Connection, imager_id: str, session: dict[str, Any]
) -> None:
    await connection.execute(
        """
        insert into ledger.sessions (id, imager_id, project_id, state,
            previous_state, observing_date, started_at, logged_at, notes)
        values ($1, $2, $3, $4, 'imaging', $5, $6, $7, $8)
        """,
        session["id"],
        imager_id,
        session["project_id"],
        session["state"],
        date.fromisoformat(session["observing_date"]),
        timeutil.parse_offset_instant(session["started_at"]),
        timeutil.now_utc(),
        session["notes"],
    )
    for position, batch in enumerate(session["batches"], start=1):
        calibration = batch["calibration"]
        await connection.execute(
            """
            insert into ledger.batches (id, imager_id, session_id, position,
                filter, sub_count, exposure_s, camera, gain, offset_value,
                temperature_c, binning, dark_set_id, flat_set_id, bias_set_id)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
            """,
            batch["id"],
            imager_id,
            session["id"],
            position,
            batch["filter"],
            batch["sub_count"],
            batch["exposure_s"],
            batch["camera"],
            batch["gain"],
            batch["offset"],
            batch["temperature_c"],
            batch["binning"],
            calibration.get("dark"),
            calibration.get("flat"),
            calibration.get("bias"),
        )
        await post_movement(
            connection,
            imager_id=imager_id,
            project_id=session["project_id"],
            kind=ledger_rules.LOG,
            filter_name=batch["filter"],
            entries=ledger_rules.log_entries(
                ledger_rules.integration_seconds(
                    batch["sub_count"], batch["exposure_s"]
                )
            ),
            session_id=session["id"],
            batch_id=batch["id"],
        )


async def _seed_set(
    connection: asyncpg.Connection,
    imager_id: str,
    candidate: dict[str, Any],
    today: date,
) -> None:
    payload = master_bytes(candidate["name"])
    key = f"calibration/{imager_id}/{candidate['id']}/v1/{MASTER_FILENAME}"
    await objectstore.put_object(key, payload, MASTER_CONTENT_TYPE)
    master = {
        "filename": MASTER_FILENAME,
        "size_bytes": len(payload),
        "sha256": hashlib.sha256(payload).hexdigest(),
        "object_key": key,
        "content_type": MASTER_CONTENT_TYPE,
    }
    await connection.execute(
        """
        insert into ledger.calibration_sets (id, imager_id, kind, status, version)
        values ($1, $2, $3, $4, 1)
        """,
        candidate["id"],
        imager_id,
        candidate["kind"],
        candidate["status"],
    )
    await connection.execute(
        """
        insert into ledger.calibration_versions (set_id, version, created_at, name,
            camera, gain, offset_value, exposure_s, temperature_c, binning, filter,
            frame_count, captured_on, master)
        values ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13::jsonb)
        """,
        candidate["id"],
        timeutil.now_utc(),
        candidate["name"],
        candidate["camera"],
        candidate["gain"],
        candidate["offset"],
        candidate["exposure_s"],
        candidate["temperature_c"],
        candidate["binning"],
        candidate["filter"],
        candidate["frame_count"],
        today - timedelta(days=candidate["captured_days_ago"]),
        json.dumps(master),
    )
