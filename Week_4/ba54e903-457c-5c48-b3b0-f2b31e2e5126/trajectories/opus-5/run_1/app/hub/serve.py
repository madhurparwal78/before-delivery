"""Start the production server on PORT, or 4173 when it is not set."""

from __future__ import annotations

import uvicorn

from .config import CONFIG


def main() -> None:
    from . import routes  # noqa: F401  (registers every path this server answers)
    from .app import APP

    uvicorn.run(
        APP,
        host="0.0.0.0",
        port=CONFIG.port,
        log_level="warning",
        ws="websockets",
        access_log=False,
        timeout_keep_alive=65,
        server_header=False,
    )


if __name__ == "__main__":
    main()
