"""Serves Wardline on the published port."""

from __future__ import annotations

import uvicorn

from .config import CONFIG


def main() -> None:
    uvicorn.run(
        "wardline.app:application",
        host="0.0.0.0",
        port=CONFIG.public_port,
        log_level="warning",
        access_log=False,
        timeout_keep_alive=65,
    )


if __name__ == "__main__":
    main()
