"""The production server: a single process, no development reloader."""
from __future__ import annotations

import logging

import uvicorn

from . import config
from .app import build

logging.basicConfig(level=logging.INFO)


def main() -> None:
    uvicorn.run(
        build(),
        host="0.0.0.0",
        port=config.APP_PUBLIC_PORT,
        log_level="warning",
        access_log=False,
    )


if __name__ == "__main__":
    main()
