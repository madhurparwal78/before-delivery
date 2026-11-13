"""Long-lived server state: the database, the realm client and their background work."""
from __future__ import annotations

import asyncio
import logging
from typing import Coroutine

from .config import REALM_LOGOUT_RETRY_SECONDS, SEED_ACCOUNT_SECONDS, Settings
from .db import Database
from .identity import Identity, IdentityUnavailable
from .seed import SEEDED_CONTACT, SEEDED_OWNERS

log = logging.getLogger("strongroom.state")


class AppState:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings
        self.db = Database(settings)
        self.identity = Identity(settings)
        self._tasks: list[asyncio.Task[None]] = []

    async def startup(self) -> None:
        self.identity.start()
        self._spawn(self.db.start(self._on_database_ready))

    async def shutdown(self) -> None:
        for task in self._tasks:
            task.cancel()
        await self.identity.stop()
        await self.db.stop()

    def _spawn(self, work: Coroutine[None, None, None]) -> None:
        task = asyncio.create_task(work)
        task.add_done_callback(_report_failure)
        self._tasks.append(task)

    async def _on_database_ready(self) -> None:
        self._spawn(self._retry_realm_logouts_forever())
        await self.ensure_seeded_accounts()

    async def ensure_seeded_accounts(self) -> None:
        """Create any missing seeded realm account, at most once every 30 seconds."""
        if not self.db.ready:
            return
        claimed = await self.db.fetchval(
            """insert into service_runs (name, last_run_at) values ('seeded_accounts', now())
               on conflict (name) do update set last_run_at = now()
               where service_runs.last_run_at < now() - ($1 * interval '1 second')
               returning name""",
            SEED_ACCOUNT_SECONDS,
        )
        if claimed is None:
            return
        try:
            for email, password, name in SEEDED_OWNERS + (SEEDED_CONTACT,):
                await self.identity.ensure_seeded_person(email, name, password)
        except IdentityUnavailable:
            log.info("realm unreachable while making sure the seeded accounts exist")

    async def end_realm_sessions(self, realm_user_id: str | None) -> None:
        """End a person's realm sessions, retrying later while the realm is unreachable."""
        if realm_user_id is None:
            return
        try:
            await self.identity.end_sessions(realm_user_id)
        except IdentityUnavailable:
            await self.db.execute(
                """insert into pending_realm_logouts (realm_user_id) values ($1)
                   on conflict (realm_user_id) do nothing""",
                realm_user_id,
            )

    async def _retry_realm_logouts_forever(self) -> None:
        while True:
            await asyncio.sleep(REALM_LOGOUT_RETRY_SECONDS)
            rows = await self.db.fetch("select realm_user_id from pending_realm_logouts")
            for row in rows:
                try:
                    await self.identity.end_sessions(row["realm_user_id"])
                except IdentityUnavailable:
                    continue
                await self.db.execute(
                    "delete from pending_realm_logouts where realm_user_id = $1",
                    row["realm_user_id"],
                )


def _report_failure(task: asyncio.Task[None]) -> None:
    if not task.cancelled() and task.exception() is not None:
        log.error("background work failed", exc_info=task.exception())
