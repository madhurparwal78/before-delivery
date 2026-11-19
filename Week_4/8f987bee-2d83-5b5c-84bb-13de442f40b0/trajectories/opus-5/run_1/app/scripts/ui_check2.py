"""Check the wizard draft, the honest switch, the announced progress and the chime."""

from __future__ import annotations

import json
import re
import sys
import urllib.request

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:4173"
PASSWORD = "deku-demo-pw-2026"
failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label} {detail}")
        print(f"  FAIL {label} {detail}")


def call(method: str, path: str, token: str | None = None, body=None, headers=None):
    data = None if body is None else json.dumps(body).encode()
    request = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        request.add_header("Content-Type", "application/json")
    if token:
        request.add_header("Authorization", f"Bearer {token}")
    for key, value in (headers or {}).items():
        request.add_header(key, value)
    with urllib.request.urlopen(request) as answer:
        raw = answer.read()
        return answer.status, (json.loads(raw) if raw else {})


def api_token(email: str) -> str:
    _, answer = call("POST", "/api/auth/login", body={"email": email, "password": PASSWORD})
    return answer["token"]


def sign_in(page: Page, email: str) -> None:
    page.goto(f"{BASE}/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(re.compile(r"/app"), timeout=15000)


def main() -> int:
    editor_token = api_token("editor@example.com")
    _, connections = call("GET", "/api/connections", editor_token)
    connection = connections["connections"][0]

    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 900})
        page = context.new_page()
        page.add_init_script(
            """
            window.__oscillators = 0;
            const RealContext = window.AudioContext;
            window.AudioContext = class extends RealContext {
              createOscillator() {
                const node = super.createOscillator();
                const start = node.start.bind(node);
                node.start = (...args) => { window.__oscillators += 1; return start(...args); };
                return node;
              }
            };
            """
        )

        print("sync progress and sounds off")
        sign_in(page, "editor@example.com")
        page.goto(f"{BASE}/app/connections/{connection['id']}")
        page.wait_for_timeout(1500)
        announced: list[str] = []
        page.expose_function("recordStatus", lambda text: announced.append(text))
        page.evaluate(
            """() => {
                const region = document.querySelector('[aria-label="Sync status"]');
                const observer = new MutationObserver(() => window.recordStatus(region.textContent));
                observer.observe(region, { childList: true, characterData: true, subtree: true });
            }"""
        )
        page.get_by_role("button", name="Sync now").click()
        expect(page.get_by_role("status", name="Sync status")).to_have_text("Sync succeeded", timeout=45000)
        check("three announcements in order", announced == ["Starting sync…", "Sync running", "Sync succeeded"], str(announced))
        check("no oscillator with sounds off", page.evaluate("() => window.__oscillators") == 0)
        log_lines = page.get_by_role("log", name="Live log").inner_text().strip().split("\n")
        check("each log line once", len(log_lines) == len(set(log_lines)), str(log_lines))
        check("log matches the job", len(log_lines) == 8, str(len(log_lines)))

        print("sounds on")
        page.get_by_role("switch", name="Sync sounds").click()
        page.wait_for_timeout(800)
        page.get_by_role("button", name="Sync now").click()
        expect(page.get_by_role("status", name="Sync status")).to_have_text("Sync succeeded", timeout=45000)
        page.wait_for_timeout(300)
        check("two oscillators with sounds on", page.evaluate("() => window.__oscillators") == 2,
              str(page.evaluate("() => window.__oscillators")))
        page.get_by_role("switch", name="Sync sounds").click()
        page.wait_for_timeout(600)

        print("honest connection switch")
        version = call("GET", f"/api/connections/{connection['id']}", editor_token)[1]["connection"]["version"]
        call(
            "PATCH",
            f"/api/connections/{connection['id']}",
            editor_token,
            body={"name": "Renamed by a colleague"},
            headers={"If-Match": f'"{version}"'},
        )
        page.get_by_role("switch", name="Connection active").click()
        expect(page.get_by_role("status", name="Connection status")).to_have_text(
            "This connection changed since you opened it. Showing the latest version.", timeout=15000
        )
        check("stored name shown", page.get_by_role("heading", level=1).inner_text() == "Renamed by a colleague")
        check("switch still on", page.get_by_role("switch", name="Connection active").get_attribute("aria-checked") == "true")
        page.get_by_role("switch", name="Connection active").click()
        expect(page.get_by_role("status", name="Connection status")).to_have_text("Connection turned off", timeout=15000)
        check("second toggle works", page.get_by_role("switch", name="Connection active").get_attribute("aria-checked") == "false")
        check("paused sync refused", True)
        page.get_by_role("button", name="Sync now").click()
        expect(page.get_by_role("status", name="Sync status")).to_have_text(
            "This connection is paused. Turn it on to sync.", timeout=15000
        )
        page.get_by_role("switch", name="Connection active").click()
        page.wait_for_timeout(1200)

        print("wizard draft across a lost session")
        page.goto(f"{BASE}/app/connections/new")
        page.wait_for_timeout(1200)
        page.get_by_role("button", name="Next").click()
        page.get_by_role("button", name="Next").click()
        page.get_by_label("Sync customers").check()
        page.get_by_role("button", name="Next").click()
        page.get_by_label("Connection name").fill("Draft pipeline")
        page.get_by_label("Namespace prefix").fill("dr_")
        token_in_page = page.evaluate("() => window.localStorage.getItem('wayline.token')")
        call("POST", "/api/auth/logout", token_in_page, body={})
        page.get_by_role("button", name="Create connection").click()
        page.wait_for_url(re.compile(r"/login\?next="), timeout=15000)
        check("lost session sends to sign in", "next=%2Fapp%2Fconnections%2Fnew" in page.url, page.url)
        page.get_by_label("Email").fill("editor@example.com")
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(re.compile("/app/connections/new"), timeout=15000)
        page.wait_for_timeout(1500)
        check("draft restored", page.get_by_label("Connection name").input_value() == "Draft pipeline")
        check("draft step restored", page.get_by_label("Namespace prefix").input_value() == "dr_")
        expect(page.get_by_role("status", name="Connection form status")).to_have_text(
            "Signed in again. Your connection draft is restored."
        )
        page.get_by_role("button", name="Create connection").click()
        page.wait_for_url(re.compile(r"/app/connections/[0-9a-f-]{36}"), timeout=15000)
        check("one press creates it", page.get_by_role("heading", level=1).inner_text() == "Draft pipeline")
        page.goto(f"{BASE}/app/connections/new")
        page.wait_for_timeout(1200)
        check("later visit starts blank", page.get_by_label("Source").count() == 1)

        print("viewer sees no write controls")
        viewer_context = browser.new_context(viewport={"width": 1280, "height": 900})
        viewer = viewer_context.new_page()
        sign_in(viewer, "viewer@example.com")
        viewer.goto(f"{BASE}/app/connections/{connection['id']}")
        viewer.wait_for_timeout(1500)
        check("no sync button", viewer.get_by_role("button", name="Sync now").count() == 0)
        check("no reset button", viewer.get_by_role("button", name="Reset").count() == 0)
        check("no switch", viewer.get_by_role("switch", name="Connection active").count() == 0)
        check("reads the history", viewer.get_by_role("table", name="Job history").count() == 1)
        viewer.goto(f"{BASE}/app")
        viewer.wait_for_timeout(900)
        check("no new connection button", viewer.get_by_role("button", name="New connection").count() == 0)
        viewer.goto(f"{BASE}/app/sources")
        viewer.wait_for_timeout(900)
        check("no create source", viewer.get_by_role("button", name="Create source").count() == 0)

        browser.close()
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
