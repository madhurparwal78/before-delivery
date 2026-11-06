"""Entry point: serve the app on 0.0.0.0 at APP_PUBLIC_PORT."""

import uvicorn

from wardline.app import application
from wardline.config import CONFIG

if __name__ == "__main__":
    uvicorn.run(
        application,
        host="0.0.0.0",
        port=CONFIG.port,
        http="h11",
        loop="asyncio",
        lifespan="on",
        access_log=False,
        server_header=False,
        date_header=True,
        timeout_keep_alive=30,
        h11_max_incomplete_event_size=1_048_576,
    )
