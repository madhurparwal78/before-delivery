"""The production entry point: python -m server --host 0.0.0.0 --port <port>."""

from __future__ import annotations

import argparse

import uvicorn

from .app import application
from .config import SETTINGS


def main() -> None:
    parser = argparse.ArgumentParser(prog="server")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=SETTINGS.port)
    arguments = parser.parse_args()
    uvicorn.run(
        application,
        host=arguments.host,
        port=arguments.port,
        log_level="warning",
        access_log=False,
        lifespan="on",
        timeout_keep_alive=65,
    )


if __name__ == "__main__":
    main()
