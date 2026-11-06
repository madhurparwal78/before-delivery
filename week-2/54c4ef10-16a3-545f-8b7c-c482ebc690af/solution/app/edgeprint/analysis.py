"""Decoded scans held in memory only (never on disk), and the one routine that refreshes every frame density."""

import asyncio
import uuid
from collections import OrderedDict
from dataclasses import dataclass

import anyio
import asyncpg
import numpy as np

from . import densitometry, imaging
from .errors import StorageUnavailable
from .storage import Storage

CACHE_BYTES = 400_000_000


@dataclass(frozen=True, slots=True)
class Analysis:
    """A scan's linear values and its per-column band means."""

    linear: np.ndarray
    band: np.ndarray

    @property
    def nbytes(self) -> int:
        return self.linear.nbytes + self.band.nbytes


def original_key(account_id: uuid.UUID, scan_id: uuid.UUID) -> str:
    return f"originals/{account_id}/{scan_id}"


def preview_key(account_id: uuid.UUID, scan_id: uuid.UUID, slice_number: int) -> str:
    return f"previews/{account_id}/{scan_id}/{slice_number}.png"


def _decode(data: bytes) -> Analysis:
    linear = imaging.linear_image(imaging.open_image(data))
    return Analysis(linear, densitometry.band_columns(linear))


class AnalysisCache:
    def __init__(self, storage: Storage) -> None:
        self.storage = storage
        self.entries: OrderedDict[uuid.UUID, Analysis] = OrderedDict()
        self.locks: dict[uuid.UUID, asyncio.Lock] = {}

    async def load(self, account_id: uuid.UUID, scan_id: uuid.UUID) -> Analysis:
        """The scan's analysis, read from the stored original. An unreachable store, or a missing original,
        is StorageUnavailable even when the decoded values are cached."""
        key = original_key(account_id, scan_id)
        if not await self.storage.exists(key):
            raise StorageUnavailable()
        lock = self.locks.setdefault(scan_id, asyncio.Lock())
        async with lock:
            if scan_id in self.entries:
                self.entries.move_to_end(scan_id)
                return self.entries[scan_id]
            analysis = await anyio.to_thread.run_sync(_decode, await self.storage.get(key))
            self.entries[scan_id] = analysis
            while sum(a.nbytes for a in self.entries.values()) > CACHE_BYTES and len(self.entries) > 1:
                self.entries.popitem(last=False)
            return analysis


def calibration_of(row: asyncpg.Record) -> densitometry.Calibration:
    if row["method"] == "clear_light":
        return densitometry.ClearLight(row["reference"])
    return densitometry.StepWedge(tuple(step["value"] for step in sorted(row["steps"], key=lambda s: s["k"])))


async def stored_calibration(connection: asyncpg.Connection, scan: asyncpg.Record) -> tuple[asyncpg.Record, densitometry.Calibration]:
    """The scan's current calibration row and the calibration it describes."""
    row = await connection.fetchrow("SELECT * FROM calibrations WHERE id = $1", scan["calibration_id"])
    return row, calibration_of(row)


async def refresh_from_stored_calibration(connection: asyncpg.Connection, scan: asyncpg.Record, analysis: Analysis) -> None:
    await refresh_densities(connection, scan, analysis, (await stored_calibration(connection, scan))[1])


async def refresh_densities(connection: asyncpg.Connection, scan: asyncpg.Record, analysis: Analysis,
                            calibration: densitometry.Calibration) -> None:
    """Recompute the scan's base plus fog and every frame's mean density, net density and unexposed status."""
    frames = await connection.fetch("SELECT id, x0, x1 FROM frames WHERE scan_id = $1", scan["id"])
    base_fog = densitometry.base_plus_fog(analysis.band, [(f["x0"], f["x1"]) for f in frames], calibration)
    for frame in frames:
        mean = densitometry.frame_density(analysis.band, frame["x0"], frame["x1"], calibration)
        net = mean - base_fog
        await connection.execute(
            "UPDATE frames SET mean_density = $2, net_density = $3, unexposed = $4 WHERE id = $1",
            frame["id"], mean, net, net <= densitometry.UNEXPOSED_NET)
    await connection.execute("UPDATE scans SET base_fog = $2 WHERE id = $1", scan["id"], base_fog)
