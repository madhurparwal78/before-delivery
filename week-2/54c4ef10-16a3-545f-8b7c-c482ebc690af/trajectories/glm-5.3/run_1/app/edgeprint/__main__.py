"""Serve the app: schema, seed, storage bucket, then uvicorn."""
from __future__ import annotations

import sys
import time

import psycopg
import uvicorn

from .config import Config
from .db import apply_schema
from .seed import seed_if_empty
from .server import build_app


def main() -> None:
    config = Config.from_env()
    app = build_app(config)

    @app.on_event("startup")
    async def startup() -> None:
        _connect_with_retry(config, app.state)

    uvicorn.run(app, host="0.0.0.0", port=config.port, log_level="warning")


def _connect_with_retry(config: Config, state) -> None:
    """Keep retrying PostgreSQL; health answers 503 starting until it connects."""
    delay = 0.5
    while True:
        try:
            conn = psycopg.connect(config.database_url)
            apply_schema(conn)
            seed_if_empty(conn)
            conn.close()
            state.db_ready = True
            try:
                state.storage.ensure_bucket()
            except OSError:
                pass
            return
        except psycopg.OperationalError:
            sys.stderr.write("PostgreSQL unreachable; retrying\n")
            time.sleep(delay)
            delay = min(delay * 2, 5.0)


if __name__ == "__main__":
    main()
