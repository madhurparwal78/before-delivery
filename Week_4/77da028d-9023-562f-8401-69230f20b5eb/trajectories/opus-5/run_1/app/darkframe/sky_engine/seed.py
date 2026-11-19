"""Applies the sky engine's share of the seed workspaces, once."""

from __future__ import annotations

from typing import Any

from ..domain import timeutil
from ..seed import SEED_MARKER
from .store import DATABASE


async def apply_seed(imagers: list[dict[str, Any]]) -> None:
    async with DATABASE.transaction() as connection:
        claimed = await connection.fetchval(
            "insert into sky_engine.seeded (marker) values ($1) "
            "on conflict do nothing returning marker",
            SEED_MARKER,
        )
        if claimed is None:
            return
        for imager in imagers:
            site = imager["site"]
            await connection.execute(
                """
                insert into sky_engine.sites (imager_id, label, latitude, longitude,
                    elevation_m, time_zone, min_altitude_deg, push_topic,
                    horizon_altitudes)
                values ($1, $2, $3, $4, $5, $6, $7, $8, $9)
                """,
                imager["imager_id"],
                site["label"],
                site["latitude"],
                site["longitude"],
                site["elevation_m"],
                site["time_zone"],
                site["min_altitude_deg"],
                site["push_topic"],
                imager["horizon"],
            )
            reminder = imager["reminder"]
            await connection.execute(
                """
                insert into sky_engine.reminders
                    (imager_id, enabled, local_time, enabled_at)
                values ($1, $2, $3, $4)
                """,
                imager["imager_id"],
                reminder["enabled"],
                timeutil.parse_hhmm(reminder["local_time"]),
                timeutil.now_utc() if reminder["enabled"] else None,
            )
