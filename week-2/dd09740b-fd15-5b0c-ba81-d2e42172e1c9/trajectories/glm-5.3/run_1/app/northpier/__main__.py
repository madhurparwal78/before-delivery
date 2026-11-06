"""Serve the inquiry desk with gunicorn in the foreground."""
from __future__ import annotations

import logging
import sys

from gunicorn.app.base import BaseApplication

from . import mailer, studio_api  # noqa: F401  (registers the studio routes)
from .app import app, bootstrap
from .config import CONFIG


class DeskApplication(BaseApplication):
    def __init__(self, app_obj, options: dict):
        self.options = options
        self.application = app_obj
        super().__init__()

    def load_config(self) -> None:
        for key, value in self.options.items():
            self.cfg.set(key, value)

    def load(self):
        return self.application


def main() -> None:
    logging.basicConfig(level=logging.WARNING)
    bootstrap()
    mailer.start_sender()
    options = {
        "bind": f"0.0.0.0:{CONFIG.public_port}",
        "workers": 2,
        "threads": 8,
        "timeout": 30,
        "graceful_timeout": 5,
        "accesslog": "-",
        "errorlog": "-",
        "preload_app": True,
    }
    DeskApplication(app, options).run()


if __name__ == "__main__":
    main()
