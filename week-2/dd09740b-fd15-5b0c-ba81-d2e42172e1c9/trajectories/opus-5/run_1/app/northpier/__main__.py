"""Serve the inquiry desk on `APP_PUBLIC_PORT`, bound to every interface."""

from __future__ import annotations

import logging
from typing import Any

from gunicorn.app.base import BaseApplication

from .app import create_app, start_background_work
from .config import CONFIG


class InquiryDeskServer(BaseApplication):
    def __init__(self, options: dict[str, Any]) -> None:
        self._options = options
        super().__init__()

    def load_config(self) -> None:
        for key, value in self._options.items():
            self.cfg.set(key, value)

    def load(self) -> Any:
        # Runs inside the worker, so the schema watcher and the outbox sender
        # live in the process that serves requests.
        start_background_work()
        return create_app()


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(message)s")
    InquiryDeskServer(
        {
            "bind": f"0.0.0.0:{CONFIG.public_port}",
            "workers": 1,
            "threads": 32,
            "worker_class": "gthread",
            "timeout": 60,
            "graceful_timeout": 10,
            "keepalive": 5,
            "limit_request_line": 8190,
            "limit_request_fields": 100,
            "limit_request_field_size": 16380,
            "accesslog": None,
            "errorlog": "-",
            "loglevel": "info",
            "proc_name": "northpier",
        }
    ).run()


if __name__ == "__main__":
    main()
