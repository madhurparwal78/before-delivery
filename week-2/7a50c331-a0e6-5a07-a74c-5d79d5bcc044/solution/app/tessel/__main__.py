"""Serve Tessel on 0.0.0.0:APP_PUBLIC_PORT (production server, no reload)."""
import logging

import uvicorn

from . import config
from .web import app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    uvicorn.run(app, host="0.0.0.0", port=config.PORT, log_level="warning", lifespan="on", access_log=False)


if __name__ == "__main__":
    main()
