"""Production entry point."""
import argparse

import uvicorn

from .config import PUBLIC_PORT


def main() -> None:
    parser = argparse.ArgumentParser(prog="pacely")
    parser.add_argument("--host", default="0.0.0.0")
    parser.add_argument("--port", type=int, default=PUBLIC_PORT)
    options = parser.parse_args()
    uvicorn.run("server.app:app", host=options.host, port=options.port, log_level="info")


main()
