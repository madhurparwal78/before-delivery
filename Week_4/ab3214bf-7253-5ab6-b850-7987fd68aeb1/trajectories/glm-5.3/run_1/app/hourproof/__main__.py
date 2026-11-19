"""Serve the desk: wait for PostgreSQL, apply the schema, seed once, then
bind 0.0.0.0 on the published port. WireMock, Gotenberg and MinIO may be down;
each is recovered as it returns.
"""
from __future__ import annotations

import asyncio

import uvicorn

from . import config


async def main() -> None:
    from .api.app import create_app
    from .providers.services import STORE
    from .workers import start_workers
    app = await create_app()
    start_workers()
    asyncio.create_task(STORE.ensure_bucket())
    server = uvicorn.Server(uvicorn.Config(
        app, host="0.0.0.0", port=config.APP_PUBLIC_PORT, log_level="info",
    ))
    await server.serve()


def run() -> None:
    asyncio.run(main())


if __name__ == "__main__":
    run()
