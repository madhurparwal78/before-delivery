"""Serve the browser app and the API from one origin."""

from __future__ import annotations

import sys

from gunicorn.app.base import BaseApplication

from .config import CONFIG


class TallowServer(BaseApplication):
    """Gunicorn with one threaded worker, so the sweeps run exactly once."""

    def load_config(self):
        self.cfg.set("bind", f"0.0.0.0:{CONFIG.port}")
        self.cfg.set("workers", 1)
        self.cfg.set("threads", 32)
        self.cfg.set("timeout", 120)
        self.cfg.set("accesslog", None)
        self.cfg.set("errorlog", "-")
        self.cfg.set("limit_request_field_size", 0)

    def load(self):
        from .app import create_app
        from .seed import prepare_database
        from .workers import start_workers

        prepare_database()
        start_workers()
        return create_app()


def main() -> int:
    TallowServer().run()
    return 0


if __name__ == "__main__":
    sys.exit(main())
