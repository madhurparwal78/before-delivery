"""Serve the app."""
from __future__ import annotations

import logging

import uvicorn

from .config import load_settings
from .web import build_app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(levelname)s %(name)s %(message)s")
    settings = load_settings()
    uvicorn.run(
        build_app(settings),
        host="0.0.0.0",
        port=settings.public_port,
        log_level="info",
        timeout_graceful_shutdown=5,
    )


if __name__ == "__main__":
    main()
