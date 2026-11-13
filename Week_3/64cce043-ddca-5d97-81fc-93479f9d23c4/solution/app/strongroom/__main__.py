"""`python -m strongroom`: serve on 0.0.0.0 and APP_PUBLIC_PORT (default 4173)."""
import logging

import uvicorn

from .app import create_app
from .config import load

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
uvicorn.run(create_app(), host="0.0.0.0", port=load().port, log_level="warning", timeout_graceful_shutdown=2)
