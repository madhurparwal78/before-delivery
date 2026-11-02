"""Run Relayo behind a production ASGI server."""

from __future__ import annotations

import logging

import uvicorn

from .app import application
from .config import CONFIG


def main() -> None:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    uvicorn.run(
        application,
        host="0.0.0.0",
        port=CONFIG.public_port,
        log_level="info",
        access_log=False,
        lifespan="on",
        server_header=False,
        date_header=True,
    )


if __name__ == "__main__":
    main()
