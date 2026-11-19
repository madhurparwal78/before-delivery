"""Background work: polling the registry for confirmations and finishing held seals."""

from __future__ import annotations

import asyncio
import sys
import traceback
from collections.abc import Awaitable, Callable

import asyncpg

from .cancellation import poll_confirmations
from .desk import Desk
from .providers import ProviderDown
from .sealing import try_seal
from .seed import finish_seed_history

POLL_SECONDS = 2
SEAL_RETRY_SECONDS = 5


# The failures a sweep can meet and the next sweep can recover from; any other error ends the worker loudly.
TRANSIENT = (ProviderDown, asyncpg.PostgresError, asyncpg.InterfaceError, OSError)


async def _every(seconds: float, work: Callable[[], Awaitable[None]]) -> None:
    while True:
        try:
            await work()
        except TRANSIENT:
            traceback.print_exc(file=sys.stderr)
        await asyncio.sleep(seconds)


async def _finish_held_seals(desk: Desk) -> None:
    for row in await desk.pool.fetch("SELECT id FROM windows WHERE state = 'Signed'"):
        await try_seal(desk, row["id"])


def start_workers(desk: Desk) -> list[asyncio.Task[None]]:
    return [
        asyncio.create_task(_every(POLL_SECONDS, lambda: poll_confirmations(desk))),
        asyncio.create_task(_every(SEAL_RETRY_SECONDS, lambda: _finish_held_seals(desk))),
        asyncio.create_task(_every(SEAL_RETRY_SECONDS, lambda: finish_seed_history(desk))),
    ]
