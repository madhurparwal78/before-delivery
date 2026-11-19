"""Answer times under load, while the database is there and while it is not."""

from __future__ import annotations

import os
import sys
import time
from concurrent.futures import ThreadPoolExecutor
from urllib.parse import urlparse

from cluster_checks import PROXY_PORT, start_instance, start_proxy, wait_healthy
from support import call, check, report

BASE = "http://127.0.0.1:4184"
BURST = 60


def times(paths: list[str], base: str) -> list[tuple[int, float]]:
    def one(path: str) -> tuple[int, float]:
        started = time.monotonic()
        answer = call("GET", path, base=base)
        return answer.status, time.monotonic() - started

    with ThreadPoolExecutor(max_workers=len(paths)) as pool:
        return list(pool.map(one, paths))


def main() -> int:
    parsed = urlparse(os.environ["DATABASE_URL"])
    proxy = start_proxy(parsed)
    proxied = (
        f"postgresql://{parsed.username}:{parsed.password}"
        f"@127.0.0.1:{PROXY_PORT}{parsed.path}"
    )
    instance = start_instance(4184, proxied)
    try:
        check("the instance starts healthy", wait_healthy(BASE), "timeout")
        paths = ["/api/leaderboard?include_feed=1", "/api/scenarios", "/api/event"] * (
            BURST // 3
        )
        answers = times(paths, BASE)
        slowest = max(elapsed for _, elapsed in answers)
        check(
            f"a burst of {BURST} reads all answer quickly",
            all(status == 200 for status, _ in answers) and slowest < 3.0,
            (slowest, sorted({status for status, _ in answers})),
        )

        proxy.terminate()
        proxy.wait(timeout=10)
        time.sleep(0.4)
        answers = times(paths, BASE)
        slowest = max(elapsed for _, elapsed in answers)
        check(
            f"a burst of {BURST} reads during an outage answer 503 within five seconds",
            all(status == 503 for status, _ in answers) and slowest < 5.0,
            (slowest, sorted({status for status, _ in answers})),
        )
        check("the process is still running", instance.poll() is None)

        proxy = start_proxy(parsed)
        deadline = time.monotonic() + 5.0
        back = False
        while time.monotonic() < deadline:
            if call("GET", "/api/leaderboard", base=BASE).status == 200:
                back = True
                break
            time.sleep(0.2)
        check("reads work again within five seconds", back, "timeout")
    finally:
        instance.terminate()
        instance.wait(timeout=10)
        proxy.terminate()
        proxy.wait(timeout=10)
    return report()


if __name__ == "__main__":
    sys.exit(main())
