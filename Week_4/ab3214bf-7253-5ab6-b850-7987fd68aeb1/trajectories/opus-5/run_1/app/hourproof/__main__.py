"""Serving Hourproof: wait for PostgreSQL, apply the schema, seed, then listen."""

from __future__ import annotations

from typing import Any

from gunicorn.app.base import BaseApplication

from . import db, seed, workers
from .app import create_app
from .config import CONFIG
from .services import objectstore
from .services.http import ProviderUnavailable


def boot() -> Any:
    db.wait_for_database()
    db.apply_schema()
    seed.apply_seed()
    try:
        objectstore.ensure_bucket()
    except ProviderUnavailable:
        pass
    workers.start()
    return create_app()


class Server(BaseApplication):
    def load_config(self) -> None:
        self.cfg.set("bind", f"0.0.0.0:{CONFIG.port}")
        self.cfg.set("workers", 1)
        self.cfg.set("worker_class", "gthread")
        self.cfg.set("threads", 24)
        self.cfg.set("timeout", 300)
        self.cfg.set("graceful_timeout", 30)
        self.cfg.set("accesslog", None)

    def load(self) -> Any:
        return boot()


if __name__ == "__main__":
    Server().run()
