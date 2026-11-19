"""Walk the judged journeys in a real browser."""

from __future__ import annotations

import re
import sys

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


def sign_in(page: Page, email: str, target: str = "/app") -> None:
    page.goto(f"{BASE}/login")
    page.get_by_label("Email").fill(email)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(re.compile(r"/app"), timeout=15000)


def marketing(page: Page) -> None:
    print("marketing")
    page.goto(BASE)
    check("home h1", page.get_by_role("heading", level=1).inner_text().startswith("Keep every system in step"))
    check("try it free", page.get_by_role("link", name="Try it free").first.is_visible())
    tab = page.get_by_role("tab", name="02 Query")
    tab.click()
    check("story tab selected", tab.get_attribute("aria-selected") == "true")
    check("film present", page.locator("video").count() == 1)
    page.get_by_role("button", name="Unmute film").click()
    check("unmute pressed", page.get_by_role("button", name="Unmute film").get_attribute("aria-pressed") == "true")
    page.get_by_role("button", name="Show transcript").click()
    check("transcript", page.get_by_text("Wayline turns your syncs into signal.").count() > 0)

    page.get_by_role("button", name="Product").click()
    check("menu expanded", page.get_by_role("button", name="Product").get_attribute("aria-expanded") == "true")
    page.keyboard.press("Escape")
    check("menu closed", page.get_by_role("button", name="Product").get_attribute("aria-expanded") == "false")
    check("closed panel has no links", page.locator(".menu-panel").count() == 0)

    page.goto(f"{BASE}/connectors")
    page.wait_for_selector("text=Showing 17")
    page.get_by_label("Search connectors").fill("sql")
    page.wait_for_selector("text=Showing 2")
    check("search narrows", page.get_by_role("status", name="Catalog results").inner_text() == "Showing 2")
    check("address holds search", "q=sql" in page.url)
    page.get_by_label("OSS").check()
    page.wait_for_timeout(600)
    check("filters in address", "availability=oss" in page.url, page.url)
    page.go_back()
    page.wait_for_timeout(600)
    check("back restores", "availability" not in page.url, page.url)
    page.goto(f"{BASE}/connectors?q=%25")
    page.wait_for_selector("text=Showing 0")
    check("percent finds nothing", True)

    page.goto(f"{BASE}/pricing")
    page.get_by_label("Credit package").select_option(label="80 credits · $340/mo")
    check("team price", page.get_by_text("$340").count() > 0)
    table = page.get_by_role("table", name="Compare the plans")
    check("comparison table", table.count() == 1)
    check("included cell words", table.get_by_role("cell", name="Not included").count() == 2)

    page.goto(f"{BASE}/nope")
    check("not found page", page.get_by_role("heading", level=1).inner_text() == "This page does not exist")
    check("link home", page.get_by_role("link", name=re.compile("home", re.I)).count() > 0)


def console_journeys(page: Page) -> None:
    print("sign in and return address")
    page.goto(f"{BASE}/app/sources")
    page.wait_for_url(re.compile(r"/login\?next="), timeout=10000)
    check("signed-out redirect", "next=%2Fapp%2Fsources" in page.url, page.url)
    page.get_by_label("Email").fill("editor@example.com")
    page.get_by_label("Password").fill("wrong-password")
    page.get_by_role("button", name="Sign in").click()
    expect(page.get_by_role("status", name="Sign-in status")).to_have_text("Email or password is incorrect.")
    check("wrong password copy", True)
    page.get_by_label("Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url(f"{BASE}/app/sources", timeout=15000)
    check("return address honoured", page.url.endswith("/app/sources"))

    print("console shell")
    check("rail", page.get_by_role("navigation", name="Console").count() == 1)
    check("sounds switch", page.get_by_role("switch", name="Sync sounds").count() == 1)
    page.set_viewport_size({"width": 375, "height": 812})
    page.wait_for_timeout(300)
    check("drawer button at 375", page.get_by_role("button", name="Open navigation").count() == 1)
    page.get_by_role("button", name="Open navigation").click()
    check("drawer", page.get_by_role("dialog", name="Navigation").count() == 1)
    page.keyboard.press("Escape")
    check("drawer closed", page.get_by_role("dialog", name="Navigation").count() == 0)
    page.set_viewport_size({"width": 1280, "height": 800})
    page.wait_for_timeout(300)

    print("wizard")
    page.goto(f"{BASE}/app")
    page.get_by_role("button", name="New connection").click()
    page.wait_for_url(re.compile("/app/connections/new"))
    page.get_by_label("Source").select_option(label="Shop Orders")
    page.get_by_role("button", name="Next").click()
    page.get_by_label("Destination").select_option(label="Lumen Warehouse")
    page.get_by_role("button", name="Next").click()
    page.get_by_label("Sync orders").check()
    page.get_by_label("Sync mode for orders").select_option(label="Incremental append")
    page.get_by_role("button", name="Next").click()
    page.get_by_label("Schedule").select_option(label="Cron")
    check("time zone shown for cron", page.get_by_label("Time zone").count() == 1)
    page.get_by_label("Cron expression").fill("30 1 * * *")
    page.get_by_label("Time zone").select_option("America/New_York")
    page.get_by_label("Connection name").fill("Browser pipeline")
    page.get_by_label("Namespace prefix").fill("ui_")
    page.get_by_role("button", name="Back").click()
    check("back keeps values", page.get_by_label("Sync orders").is_checked())
    page.get_by_role("button", name="Next").click()
    check("values restored", page.get_by_label("Connection name").input_value() == "Browser pipeline")
    page.get_by_role("button", name="Create connection").click()
    page.wait_for_url(re.compile(r"/app/connections/[0-9a-f-]{36}"), timeout=15000)
    check("connection page", page.get_by_role("heading", level=1).inner_text() == "Browser pipeline")
    check(
        "next run text",
        bool(re.search(r"\w{3} \d{1,2} \w{3} \d{4}, \d{2}:\d{2} America/New_York \(UTC[+-]\d{2}:\d{2}\)", page.content())),
    )
    check("flow diagram", page.get_by_role("img", name=re.compile("^Data flow from ")).count() == 1)
    check("streams table", page.get_by_role("table", name="Streams").count() == 1)
    check("job history table", page.get_by_role("table", name="Job history").count() == 1)

    print("sync")
    page.get_by_role("button", name="Sync now").click()
    expect(page.get_by_role("status", name="Sync status")).to_have_text("Starting sync…", timeout=5000)
    expect(page.get_by_role("status", name="Sync status")).to_have_text("Sync running", timeout=15000)
    check("live log streams", page.get_by_role("log", name="Live log").inner_text().find("Sync started") >= 0)
    expect(page.get_by_role("status", name="Sync status")).to_have_text("Sync succeeded", timeout=40000)
    history = page.get_by_role("table", name="Job history")
    check("job succeeded row", history.get_by_role("cell", name="Succeeded").count() == 1)
    streams = page.get_by_role("table", name="Streams")
    check("stream rows figure", "120" in streams.inner_text(), streams.inner_text())
    check("cursor shown", "2026-" in streams.inner_text())

    print("reset dialog")
    page.get_by_role("button", name="Reset").click()
    dialog = page.get_by_role("alertdialog", name="Reset connection")
    check("reset dialog", dialog.count() == 1)
    page.wait_for_timeout(5500)
    check("dialog survives refresh", dialog.count() == 1)
    page.get_by_role("button", name="Reset tables").click()
    expect(page.get_by_role("status", name="Sync status")).to_have_text("Connection reset", timeout=10000)
    check("dialog closed", page.get_by_role("alertdialog", name="Reset connection").count() == 0)
    check("rows cleared", re.search(r"\b0\b", streams.inner_text()) is not None, streams.inner_text())

    print("sync again after reset")
    page.get_by_role("button", name="Sync now").click()
    expect(page.get_by_role("status", name="Sync status")).to_have_text("Sync succeeded", timeout=40000)
    check("second sync lands", "120" in page.get_by_role("table", name="Streams").inner_text())

    print("warehouse records")
    page.goto(f"{BASE}/app/destinations")
    page.get_by_role("link", name="ui_orders").click()
    page.wait_for_url(re.compile("/tables/ui_orders"))
    check("records table", page.get_by_role("table", name="ui_orders records").count() == 1)
    check("records frame", page.get_by_role("region", name="Scroll ui_orders records").count() == 1)
    page.get_by_role("button", name="Next page").click()
    page.wait_for_timeout(800)
    check("next page in address", "cursor=" in page.url)
    page.reload()
    page.wait_for_timeout(800)
    check("reload keeps page", "cursor=" in page.url)
    page.get_by_role("button", name="Previous page").click()
    page.wait_for_timeout(800)
    check("previous page", "cursor=" in page.url)

    print("table and connection not found")
    page.goto(f"{BASE}/app/connections/not-an-id")
    page.wait_for_timeout(1200)
    check("connection not found", page.get_by_role("heading", name="Connection not found").count() == 1)
    page.goto(f"{BASE}/app/destinations/not-an-id/tables/ui_orders")
    page.wait_for_timeout(1200)
    check("table not found", page.get_by_role("heading", name="Table not found").count() == 1)

    print("command palette")
    page.goto(f"{BASE}/app")
    page.wait_for_timeout(1500)
    page.keyboard.press("Control+k")
    check("palette", page.get_by_role("dialog", name="Command palette").count() == 1)
    page.get_by_label("Search commands").fill("Browser")
    page.wait_for_timeout(300)
    page.keyboard.press("Enter")
    page.wait_for_timeout(800)
    check("palette opens connection", "/app/connections/" in page.url, page.url)

    print("role limits")
    page.goto(f"{BASE}/app/members")
    page.wait_for_timeout(1200)
    check("editor cannot open members", page.url.endswith("/app"), page.url)
    check("permission copy", page.get_by_role("alert").inner_text() == "You don't have permission to do that.")

    print("builder")
    page.goto(f"{BASE}/app/builder")
    page.wait_for_timeout(1200)
    check("yaml tab", page.get_by_role("tab", name="YAML").count() == 1)
    page.get_by_label("API key").fill("sandbox-key-2026")
    page.get_by_role("button", name="Test").click()
    expect(page.get_by_role("status", name="Builder status")).to_have_text(
        "Test read finished: 7 records", timeout=20000
    )
    check("records listed", page.get_by_text("INV-1042").count() > 0)
    page.get_by_role("tab", name="YAML").click()
    page.get_by_label("Manifest YAML").fill("not: [valid")
    page.wait_for_timeout(300)
    check("yaml broken disables test", page.get_by_role("button", name="Test").is_disabled())
    check("yaml copy", page.get_by_text("This YAML can't be read. Fix it before switching tabs.").count() > 0)
    page.get_by_role("tab", name="UI").click()
    check("ui tab refused", page.get_by_role("tab", name="YAML").get_attribute("aria-selected") == "true")

    print("sign out")
    page.goto(f"{BASE}/app")
    page.get_by_role("button", name="Account menu").click()
    page.get_by_role("menuitem", name="Sign out").click()
    page.wait_for_url(f"{BASE}/", timeout=10000)
    check("signed out to home", page.url.rstrip("/") == BASE)


def admin_journeys(page: Page) -> None:
    print("admin")
    sign_in(page, "admin@example.com")
    page.goto(f"{BASE}/app/members")
    page.wait_for_timeout(800)
    check("members page", page.get_by_role("heading", level=1).inner_text() == "Members")
    page.get_by_label("Email", exact=True).fill("browser.invitee@example.com")
    page.get_by_label("Name", exact=True).fill("Browser Invitee")
    page.get_by_label("Role", exact=True).select_option("editor")
    page.get_by_role("button", name="Invite member").click()
    expect(page.get_by_role("status", name="Members status")).to_have_text("Invite created", timeout=10000)
    link = page.get_by_text(re.compile(r"^/accept-invite\?token=")).inner_text()
    check("invite link", link.startswith("/accept-invite?token="))
    select = page.get_by_label("Role for Priya Natarajan")
    select.select_option("viewer")
    expect(page.get_by_role("status", name="Members status")).to_have_text(
        "The workspace needs at least one admin.", timeout=10000
    )
    check("role select honest", select.input_value() == "admin")
    page.goto(f"{BASE}/app/settings")
    page.wait_for_timeout(600)
    page.get_by_label("Plan").select_option("scale")
    expect(page.get_by_role("status", name="Settings status")).to_have_text("Plan updated", timeout=10000)
    check("one dark theme switch", page.get_by_role("switch", name="Dark theme").count() == 1)
    page.get_by_role("switch", name="Dark theme").click()
    page.wait_for_timeout(800)
    check("dark theme", page.locator("html").get_attribute("data-theme") == "dark")
    page.reload()
    page.wait_for_timeout(1500)
    check("theme persists", page.locator("html").get_attribute("data-theme") == "dark")
    page.get_by_role("switch", name="Dark theme").click()
    page.wait_for_timeout(600)
    page.goto(f"{BASE}/app/audit")
    page.wait_for_timeout(800)
    check("audit page", page.get_by_role("heading", level=1).inner_text() == "Audit log")
    check("audit rows", page.get_by_text("connection.created").count() > 0)
    page.goto(f"{BASE}/login")
    page.wait_for_url(f"{BASE}/app", timeout=10000)
    check("signed-in login lands on app", page.url.endswith("/app"))
    page.goto(f"{BASE}/accept-invite?token={link.split('=')[1]}")
    page.get_by_label("Password").fill("short")
    page.get_by_role("button", name="Accept invitation").click()
    page.wait_for_timeout(1500)
    check("short password error", page.get_by_text("This password must be at least twelve characters.").count() > 0)


def touch_targets(page: Page) -> None:
    print("touch targets at 375")
    page.set_viewport_size({"width": 375, "height": 812})
    for path in ["/", "/pricing", "/connectors", "/signin", "/login"]:
        page.goto(f"{BASE}{path}")
        page.wait_for_timeout(500)
        small = page.evaluate(
            """() => {
                const nodes = [...document.querySelectorAll('button, a.button, select, input[type=checkbox], .header-link, .nav-link, .footer-columns a')];
                return nodes.filter((node) => {
                    const box = node.getBoundingClientRect();
                    if (box.width === 0 && box.height === 0) return false;
                    const measured = node.type === 'checkbox' ? node.closest('.check-row') ?? node : node;
                    const rect = measured.getBoundingClientRect();
                    return rect.height < 44 || rect.width < 44;
                }).map((node) => `${node.tagName}:${(node.textContent || node.ariaLabel || '').trim().slice(0, 24)}`);
            }"""
        )
        check(f"touch targets {path}", len(small) == 0, str(small[:6]))
        overflow = page.evaluate("() => document.documentElement.scrollWidth > window.innerWidth + 1")
        check(f"no sideways scroll {path}", overflow is False)


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        page.on("pageerror", lambda error: failures.append(f"page error: {error}"))
        marketing(page)
        console_journeys(page)
        admin_journeys(page)
        touch_targets(page)
        browser.close()
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
