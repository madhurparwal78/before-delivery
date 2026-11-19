"""Foreground server: binds 0.0.0.0 on APP_PUBLIC_PORT (default 4173)."""

import logging

import uvicorn

from .config import settings


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    logging.getLogger("httpx").setLevel(logging.WARNING)
    uvicorn.run("tailboard.app:app", host="0.0.0.0", port=settings.port, access_log=False, log_level="info",
                timeout_graceful_shutdown=3, proxy_headers=False)


if __name__ == "__main__":
    main()
