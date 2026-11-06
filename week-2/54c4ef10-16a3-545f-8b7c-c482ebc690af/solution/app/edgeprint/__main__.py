"""`python -m edgeprint` serves the app on 0.0.0.0 at APP_PUBLIC_PORT."""

import uvicorn

from .app import create_app
from .config import load_settings

if __name__ == "__main__":
    settings = load_settings()
    uvicorn.run(create_app(settings), host="0.0.0.0", port=settings.port, log_level="warning")
