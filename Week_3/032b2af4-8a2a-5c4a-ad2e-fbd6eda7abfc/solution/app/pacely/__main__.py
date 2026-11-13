"""Production entry point: `python -m pacely`."""

import uvicorn

from .app import app
from .config import load_settings

if __name__ == "__main__":
    settings = load_settings()
    uvicorn.run(app, host="0.0.0.0", port=settings.port, access_log=False, server_header=False, log_level="warning")
