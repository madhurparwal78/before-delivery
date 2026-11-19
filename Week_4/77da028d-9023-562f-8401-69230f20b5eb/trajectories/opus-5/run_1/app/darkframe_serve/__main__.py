"""`serve`: one command, four operating-system processes."""

from __future__ import annotations

import signal
import subprocess
import sys
import time
from types import FrameType

from darkframe.config import (
    CONFIG,
    GATEWAY,
    LEDGER,
    PUSH_DISPATCHER,
    SKY_ENGINE,
)

PUBLIC_HOST = "0.0.0.0"
PRIVATE_HOST = "127.0.0.1"

SERVICES: tuple[tuple[str, str, str], ...] = (
    (SKY_ENGINE, "darkframe.sky_engine.app:app", PRIVATE_HOST),
    (LEDGER, "darkframe.ledger_svc.app:app", PRIVATE_HOST),
    (PUSH_DISPATCHER, "darkframe.push_dispatcher.app:app", PRIVATE_HOST),
    (GATEWAY, "darkframe.gateway.app:app", PUBLIC_HOST),
)

_children: list[subprocess.Popen[bytes]] = []


def _spawn(target: str, host: str, port: int) -> subprocess.Popen[bytes]:
    return subprocess.Popen(
        [
            sys.executable,
            "-m",
            "uvicorn",
            target,
            "--host",
            host,
            "--port",
            str(port),
            "--log-level",
            "warning",
            "--no-access-log",
            "--timeout-graceful-shutdown",
            "2",
        ]
    )


def _stop(signal_number: int, frame: FrameType | None) -> None:
    for child in _children:
        if child.poll() is None:
            child.send_signal(signal.SIGTERM)
    for child in _children:
        try:
            child.wait(timeout=5)
        except subprocess.TimeoutExpired:
            child.kill()
    sys.exit(0)


def main() -> None:
    signal.signal(signal.SIGTERM, _stop)
    signal.signal(signal.SIGINT, _stop)
    for name, target, host in SERVICES:
        _children.append(_spawn(target, host, CONFIG.port_of(name)))
    while True:
        for child in _children:
            if child.poll() is not None:
                _stop(signal.SIGTERM, None)
        time.sleep(0.5)


if __name__ == "__main__":
    main()
