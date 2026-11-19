"""Stop and start the production server during development checks."""

from __future__ import annotations

import os
import signal
import subprocess
import sys
import time
from pathlib import Path

MARKER = "uvicorn server:app"


def running_pids() -> list[int]:
    pids: list[int] = []
    for entry in Path("/proc").iterdir():
        if not entry.name.isdigit():
            continue
        try:
            cmdline = (entry / "cmdline").read_bytes().replace(b"\x00", b" ").decode()
        except OSError:
            continue
        if MARKER in cmdline and entry.name != str(os.getpid()):
            pids.append(int(entry.name))
    return pids


def stop() -> None:
    for pid in running_pids():
        print("stopping", pid)
        os.kill(pid, signal.SIGTERM)
    for _ in range(60):
        if not running_pids():
            return
        time.sleep(0.2)
    for pid in running_pids():
        os.kill(pid, signal.SIGKILL)


def start() -> None:
    port = os.environ.get("APP_PUBLIC_PORT", "4173")
    log = open("/tmp/server.log", "ab")
    subprocess.Popen(
        [".venv/bin/uvicorn", "server:app", "--host", "0.0.0.0", "--port", port],
        cwd="/app",
        stdout=log,
        stderr=log,
        start_new_session=True,
    )
    print("started on", port)


if __name__ == "__main__":
    action = sys.argv[1]
    if action in ("stop", "restart"):
        stop()
    if action in ("start", "restart"):
        start()
