"""WCAG 2.2 AA checks with axe-core, which is loaded from outside the app."""

from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright
from support import BASE, SEED_PASSWORD, call, check, report

AXE = "/tmp/axe.min.js"
LAPTOP = {"width": 1280, "height": 800}
PHONE = {"width": 375, "height": 812}
TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]

PATHS = (
    "/downtime",
    "/downtime/team",
    "/downtime/scenarios/repossessed",
    "/downtime/certificate",
    "/signup",
    "/login",
    "/",
    "/about",
    "/community",
    "/nowhere-page",
)


def audit(page, label: str) -> None:
    page.add_script_tag(path=AXE)
    result = page.evaluate(
        "async (tags) => await axe.run(document, {runOnly: {type: 'tag',"
        " values: tags}})",
        TAGS,
    )
    violations = [
        {
            "id": entry["id"],
            "impact": entry["impact"],
            "nodes": [node["target"] for node in entry["nodes"][:3]],
        }
        for entry in result["violations"]
    ]
    check(
        f"no accessibility violations on {label}",
        violations == [],
        json.dumps(violations)[:900],
    )


def main() -> int:
    token = call(
        "POST",
        "/api/auth/login",
        {"email": "captain@example.com", "password": SEED_PASSWORD},
    ).json["token"]
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        for name, viewport in (("laptop", LAPTOP), ("phone", PHONE)):
            context = browser.new_context(viewport=viewport)
            page = context.new_page()
            page.goto(f"{BASE}/")
            page.evaluate(
                "(value) => localStorage.setItem('downtime.token', value)", token
            )
            for path in PATHS:
                page.goto(f"{BASE}{path}")
                page.wait_for_timeout(1200)
                audit(page, f"{path} ({name}, signed in)")
            page.evaluate("() => localStorage.clear()")
            page.goto(f"{BASE}/downtime")
            page.wait_for_timeout(1200)
            audit(page, f"/downtime ({name}, visitor, consent showing)")
            page.get_by_role("button", name="View prizes").click()
            page.wait_for_timeout(400)
            audit(page, f"/downtime prizes dialog ({name})")
            context.close()
        browser.close()
    return report()


if __name__ == "__main__":
    sys.exit(main())
