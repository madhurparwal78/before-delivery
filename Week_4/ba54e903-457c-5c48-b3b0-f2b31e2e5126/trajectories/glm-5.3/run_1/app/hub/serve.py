"""Production server entry point: python -m hub.serve."""
from __future__ import annotations

import threading
import time

import uvicorn

from .app import create_app
from .config import load_config
from .schema import ensure_schema, seed_if_needed


def main() -> None:
    config = load_config()
    app = create_app()
    state = app.state.hub

    def boot() -> None:
        """Retry the database until it is ready, then create schema and seed once."""
        while True:
            if state.db.ping():
                try:
                    ensure_schema(state.db)
                    seed_if_needed(state.db, "/static/")
                except Exception:
                    pass
                break
            time.sleep(2)
        state.live.start()
        state.mailer.start()

        def health_loop():
            while True:
                state.db.ping()
                time.sleep(3)

        threading.Thread(target=health_loop, daemon=True, name="hub-health").start()

    threading.Thread(target=boot, daemon=True, name="hub-boot").start()

    uvicorn.run(
        app,
        host="0.0.0.0",
        port=config.port,
        log_level="warning",
        access_log=False,
        timeout_keep_alive=65,
    )


if __name__ == "__main__":
    main()
