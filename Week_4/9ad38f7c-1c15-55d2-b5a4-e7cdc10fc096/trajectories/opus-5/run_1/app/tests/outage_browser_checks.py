"""The pages during a database outage, and when it comes back."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from urllib.parse import urlparse

from playwright.sync_api import sync_playwright
from support import check, report

OUTAGE_COPY = "The event server is not answering. Try again in a moment."
BASE = "http://127.0.0.1:4188"
PROXY_PORT = 5442
LAPTOP = {"width": 1280, "height": 800}


def start_proxy(parsed) -> subprocess.Popen:
    proxy = subprocess.Popen(
        [
            ".venv/bin/python",
            "tests/proxy.py",
            str(PROXY_PORT),
            parsed.hostname,
            str(parsed.port or 5432),
        ],
        cwd="/app",
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(0.6)
    return proxy


def main() -> int:
    parsed = urlparse(os.environ["DATABASE_URL"])
    proxy = start_proxy(parsed)
    environment = dict(os.environ)
    environment["DATABASE_URL"] = (
        f"postgresql://{parsed.username}:{parsed.password}"
        f"@127.0.0.1:{PROXY_PORT}{parsed.path}"
    )
    instance = subprocess.Popen(
        [".venv/bin/python", "-m", "server", "--host", "127.0.0.1", "--port", "4188"],
        cwd="/app",
        env=environment,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL,
    )
    time.sleep(6)
    try:
        with sync_playwright() as playwright:
            browser = playwright.chromium.launch()
            page = browser.new_context(viewport=LAPTOP).new_page()
            errors: list[str] = []
            page.on("pageerror", lambda error: errors.append(str(error)))
            page.goto(f"{BASE}/downtime")
            page.wait_for_timeout(1500)
            check(
                "the board loads while the database is there",
                page.locator("[data-board-rows] tr").count() == 5,
                page.locator("[data-board-rows] tr").count(),
            )

            proxy.terminate()
            proxy.wait(timeout=10)
            time.sleep(0.5)
            page.goto(f"{BASE}/downtime")
            page.wait_for_timeout(3000)
            check(
                "the event page still renders during an outage",
                page.get_by_role("heading", level=1).count() == 1
                and page.get_by_text("Form your team").count() >= 1,
            )
            check(
                "the leaderboard shows the outage copy",
                OUTAGE_COPY
                in page.get_by_role("status", name="Leaderboard updates").inner_text(),
                page.get_by_role("status", name="Leaderboard updates").inner_text(),
            )
            page.goto(f"{BASE}/downtime/team")
            page.wait_for_timeout(2500)
            check(
                "the team room shows the outage copy",
                OUTAGE_COPY
                in page.get_by_role("status", name="Team messages").first.inner_text(),
                page.get_by_role("status", name="Team messages").first.inner_text(),
            )
            page.goto(f"{BASE}/downtime/scenarios/repossessed")
            page.wait_for_timeout(2500)
            check(
                "the scenario page shows the outage copy",
                OUTAGE_COPY
                in page.get_by_role("status", name="Flag result").inner_text(),
                page.get_by_role("status", name="Flag result").inner_text(),
            )
            check("no page errors during the outage", errors == [], errors)

            proxy = start_proxy(parsed)
            page.goto(f"{BASE}/downtime")
            deadline = time.monotonic() + 8
            rows = 0
            while time.monotonic() < deadline:
                rows = page.locator("[data-board-rows] tr").count()
                if rows == 5:
                    break
                page.wait_for_timeout(400)
            check("the board returns once the database is back", rows == 5, rows)
            browser.close()
    finally:
        instance.terminate()
        instance.wait(timeout=10)
        proxy.terminate()
        proxy.wait(timeout=10)
    return report()


if __name__ == "__main__":
    sys.exit(main())
