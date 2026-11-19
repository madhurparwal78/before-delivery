"""Run an axe-core WCAG 2.2 AA audit over the public and console pages.

axe-core is fetched to /tmp for this development check only; it is not a shipped dependency.
"""

from __future__ import annotations

import json
import sys
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:4173"
PASSWORD = "deku-demo-pw-2026"
AXE = Path("/tmp/axe.min.js")
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]
failures: list[str] = []


def axe_source() -> str:
    if not AXE.exists():
        AXE.write_bytes(
            urllib.request.urlopen("https://cdn.jsdelivr.net/npm/axe-core@4.10.2/axe.min.js").read()
        )
    return AXE.read_text()


def audit(page: Page, label: str, source: str) -> None:
    page.wait_for_timeout(700)
    page.add_script_tag(content=source)
    report = page.evaluate(
        "async (tags) => await axe.run(document, { runOnly: { type: 'tag', values: tags } })", TAGS
    )
    violations = [
        {
            "id": violation["id"],
            "impact": violation["impact"],
            "nodes": [node["target"] for node in violation["nodes"][:3]],
        }
        for violation in report["violations"]
    ]
    if violations:
        failures.append(f"{label}: {json.dumps(violations)[:600]}")
        print(f"  FAIL {label}: {json.dumps(violations)[:600]}")
    else:
        print(f"  ok   {label}")


def main() -> int:
    source = axe_source()
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
        print("public pages")
        for path in ["/", "/connectors", "/pricing", "/signin", "/login", "/accept-invite", "/mcp", "/nope"]:
            page.goto(f"{BASE}{path}")
            audit(page, path, source)
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(f"{BASE}/pricing")
        audit(page, "/pricing at 375", source)
        page.goto(f"{BASE}/")
        page.get_by_role("button", name="Menu").click()
        audit(page, "menu overlay", source)
        page.set_viewport_size({"width": 1280, "height": 900})

        print("console")
        page.goto(f"{BASE}/login")
        page.get_by_label("Email").fill("admin@example.com")
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(f"{BASE}/app", timeout=15000)
        for path in [
            "/app",
            "/app/sources",
            "/app/destinations",
            "/app/builder",
            "/app/members",
            "/app/audit",
            "/app/settings",
            "/app/connections/new",
        ]:
            page.goto(f"{BASE}{path}")
            audit(page, path, source)
        page.goto(f"{BASE}/app")
        page.get_by_role("link", name="Shop Orders to Warehouse").click()
        page.wait_for_timeout(1500)
        audit(page, "connection page", source)
        page.get_by_role("button", name="Reset").click()
        audit(page, "reset dialog", source)
        page.get_by_role("button", name="Keep tables").click()
        page.keyboard.press("Control+k")
        audit(page, "command palette", source)
        page.keyboard.press("Escape")
        page.goto(f"{BASE}/app/destinations")
        page.wait_for_timeout(1200)
        page.locator(".data-table a").first.click()
        page.wait_for_timeout(1500)
        audit(page, "records page", source)
        page.get_by_role("switch", name="Dark theme").click()
        page.wait_for_timeout(900)
        audit(page, "records page (dark)", source)
        page.goto(f"{BASE}/app")
        audit(page, "dashboard (dark)", source)
        page.get_by_role("switch", name="Dark theme").click()
        page.wait_for_timeout(700)
        browser.close()
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
