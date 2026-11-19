"""Production entry point: one foreground uvicorn process on 0.0.0.0:$APP_PUBLIC_PORT."""

import logging

import uvicorn

from .config import SETTINGS

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")

uvicorn.run("downtime.app:app", host="0.0.0.0", port=SETTINGS.port, access_log=False, proxy_headers=False,
            timeout_graceful_shutdown=2, log_level="info")
