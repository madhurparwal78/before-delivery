"""Assembling the application: database, seed, background workers and the ASGI app."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager

from starlette.applications import Starlette

from .api import build_app
from .config import load_settings
from .db import connect
from .desk import Desk
from .seed import finish_seed_history, seed
from .workers import start_workers


@asynccontextmanager
async def lifespan(app: Starlette) -> AsyncIterator[None]:
    settings = load_settings()
    pool = await connect(settings.database_url)
    desk = Desk(settings, pool)
    await seed(desk)
    await finish_seed_history(desk)
    app.state.desk = desk
    workers = start_workers(desk)
    try:
        yield
    finally:
        for worker in workers:
            worker.cancel()
        await pool.close()


app = build_app(lifespan)
