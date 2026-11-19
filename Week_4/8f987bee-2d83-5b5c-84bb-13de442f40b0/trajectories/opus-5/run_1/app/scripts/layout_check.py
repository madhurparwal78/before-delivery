"""Check the console breakpoints, touch targets and reduced motion."""

from __future__ import annotations

import sys

from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173"
PASSWORD = "deku-demo-pw-2026"
failures: list[str] = []


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label} {detail}")
        print(f"  FAIL {label} {detail}")


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        page.goto(f"{BASE}/login")
        page.get_by_label("Email").fill("editor@example.com")
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(f"{BASE}/app", timeout=15000)
        connection = page.get_by_role("link", name="Shop Orders to Warehouse")
        connection.click()
        page.wait_for_url(lambda url: "/app/connections/" in url, timeout=10000)
        connection_url = page.url

        print("console breakpoints")
        for width, rail in [(767, False), (768, False), (991, False), (992, True), (1279, True), (1280, True)]:
            page.set_viewport_size({"width": width, "height": 900})
            page.wait_for_timeout(350)
            has_rail = page.get_by_role("navigation", name="Console").count() == 1
            has_button = page.get_by_role("button", name="Open navigation").count() == 1
            check(f"rail at {width}", has_rail == rail, f"rail={has_rail}")
            check(f"drawer button at {width}", has_button == (not rail), f"button={has_button}")
            overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
            check(f"no sideways scroll at {width}", overflow is False)

        page.set_viewport_size({"width": 1280, "height": 900})
        page.wait_for_timeout(350)
        side_by_side = page.evaluate(
            """() => {
                const panels = [...document.querySelectorAll('.connection-lower > .panel')];
                if (panels.length < 2) return false;
                const [history, log] = panels.map((panel) => panel.getBoundingClientRect());
                return Math.abs(history.top - log.top) < 40 && log.left > history.left;
            }"""
        )
        check("history beside log at 1280", side_by_side is True)
        page.set_viewport_size({"width": 1279, "height": 900})
        page.wait_for_timeout(350)
        stacked = page.evaluate(
            """() => {
                const panels = [...document.querySelectorAll('.connection-lower > .panel')];
                if (panels.length < 2) return false;
                const [history, log] = panels.map((panel) => panel.getBoundingClientRect());
                return log.top > history.top + 20;
            }"""
        )
        check("log below history at 1279", stacked is True)

        print("console touch targets at 375")
        page.set_viewport_size({"width": 375, "height": 812})
        for path in ["/app", connection_url, "/app/sources", "/app/destinations", "/app/builder", "/app/settings", "/app/connections/new"]:
            page.goto(path if path.startswith("http") else f"{BASE}{path}")
            page.wait_for_timeout(900)
            small = page.evaluate(
                """() => [...document.querySelectorAll('button, a.button, select, input, .nav-link, .header-link')]
                    .filter((node) => {
                        const box = node.getBoundingClientRect();
                        if (box.width === 0 && box.height === 0) return false;
                        const measured = node.type === 'checkbox' || node.type === 'radio' ? node.closest('.check-row') ?? node : node;
                        const rect = measured.getBoundingClientRect();
                        return rect.height < 44 || rect.width < 44;
                    })
                    .map((node) => `${node.tagName}.${node.className}:${(node.textContent || node.ariaLabel || '').trim().slice(0, 20)}`)"""
            )
            check(f"touch targets {path.split('://')[-1]}", len(small) == 0, str(small[:6]))
            overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
            check(f"no sideways scroll {path.split('://')[-1]}", overflow is False)

        print("records frame scrolls inside itself")
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(f"{BASE}/app/destinations")
        page.wait_for_timeout(1200)
        page.locator(".data-table a").first.click()
        page.wait_for_timeout(1500)
        measured = page.evaluate(
            """() => {
                const frame = document.querySelector('.records-frame');
                frame.focus();
                const before = frame.scrollLeft;
                frame.scrollLeft = 120;
                return { scrolls: frame.scrollWidth > frame.clientWidth, moved: frame.scrollLeft > before,
                         page: document.documentElement.scrollWidth <= window.innerWidth + 1 };
            }"""
        )
        check("frame scrolls sideways", measured["scrolls"] and measured["moved"], str(measured))
        check("page itself does not", measured["page"] is True)

        print("reduced motion")
        reduced_context = browser.new_context(
            viewport={"width": 1280, "height": 800}, reduced_motion="reduce"
        )
        reduced_page = reduced_context.new_page()
        reduced_page.goto(BASE)
        reduced_page.wait_for_timeout(1200)
        animations = reduced_page.evaluate(
            "() => document.getAnimations().filter((animation) => animation.playState === 'running').length"
        )
        check("no running animations", animations == 0, str(animations))
        paused = reduced_page.evaluate("() => document.querySelector('video').paused")
        check("film does not autoplay", paused is True)
        metrics = reduced_page.evaluate(
            "() => [...document.querySelectorAll('.metric-figure')].map((node) => node.textContent)"
        )
        check("metrics final", "300+" in metrics, str(metrics))
        drawn = reduced_page.evaluate(
            """() => [...document.querySelectorAll('.flow-diagram path')]
                .filter((path) => Number(path.style.strokeDashoffset || 0) > 1).length"""
        )
        check("architecture drawn", drawn == 0, str(drawn))
        reduced_context.close()
        browser.close()
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
