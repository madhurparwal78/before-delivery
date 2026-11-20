import uvicorn

from .config import settings

uvicorn.run("tallow_cover.app:app", host="0.0.0.0", port=settings.port, log_level="warning", proxy_headers=False,
            server_header=False)
