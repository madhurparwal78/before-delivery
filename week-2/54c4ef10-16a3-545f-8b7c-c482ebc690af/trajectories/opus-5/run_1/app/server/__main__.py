"""Start the server: wait for PostgreSQL, prepare storage, then serve."""

from __future__ import annotations

import signal
import threading
from types import FrameType

from . import db, seed, storage, web


def _prepare(stop: threading.Event) -> None:
    db.wait_for_database(stop)
    if stop.is_set():
        return
    seed.seed_if_empty()
    try:
        storage.ensure_bucket()
    except storage.StorageUnavailable:
        pass


def main() -> None:
    stop = threading.Event()

    def shutdown(signum: int, frame: FrameType | None) -> None:
        del signum, frame
        stop.set()

    signal.signal(signal.SIGTERM, shutdown)
    signal.signal(signal.SIGINT, shutdown)

    threading.Thread(target=_prepare, args=(stop,), daemon=True).start()
    web.serve_forever(stop)


if __name__ == "__main__":
    main()
