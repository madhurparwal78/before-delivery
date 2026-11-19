"""serve: bind 0.0.0.0 on APP_PUBLIC_PORT (default 4173), apply schema and seed on every start."""
import os

import uvicorn

from .api import app
from .config import load_config


def main():
    cfg = load_config()
    port = cfg.app_public_port or 4173
    uvicorn.run(app(cfg), host="0.0.0.0", port=port, log_level="warning")


if __name__ == "__main__":
    main()
