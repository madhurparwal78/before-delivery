"""The serve command: four OS processes, gateway, sky engine, ledger, push dispatcher."""
from __future__ import annotations

import os
import signal
import subprocess
import sys
import time


def main() -> None:
    # Migrations and seed run first, idempotently, in the parent process.
    from darkframe.common.migrate import apply_migrations, seed

    url = os.environ["DATABASE_URL"]
    try:
        apply_migrations(url)
        seed(url)
    except Exception as exc:  # A down database never stops serve (DP-55).
        print(f"darkframe: database not ready at boot: {exc}", file=sys.stderr)

    procs: list[subprocess.Popen] = []

    def launch(args: list[str]) -> subprocess.Popen:
        proc = subprocess.Popen([sys.executable, "-m", *args])
        procs.append(proc)
        return proc

    launch(["darkframe.services.sky_engine"])
    launch(["darkframe.services.ledger"])
    launch(["darkframe.services.push_dispatcher"])
    launch(["darkframe.services.gateway"])

    stopping = {"flag": False}

    def stop(signum, frame) -> None:
        if stopping["flag"]:
            return
        stopping["flag"] = True
        for proc in procs:
            try:
                proc.terminate()
            except Exception:
                pass
        deadline = time.time() + 5
        for proc in procs:
            try:
                proc.wait(timeout=max(0.1, deadline - time.time()))
            except Exception:
                proc.kill()

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    try:
        while True:
            for proc in procs:
                if proc.poll() is not None:
                    stop(None, None)
                    raise SystemExit(0)
            time.sleep(1)
    except KeyboardInterrupt:
        stop(None, None)


if __name__ == "__main__":
    main()
