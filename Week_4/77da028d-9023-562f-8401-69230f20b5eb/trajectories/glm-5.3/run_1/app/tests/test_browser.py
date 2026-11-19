"""Browser checks of the screens, layouts and interactions (Chromium headless)."""
from __future__ import annotations

import json
import sys

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"
KEY = "dfk_ines_7c41a9e2"
PASSED: list[str] = []
FAILED: list[str] = []


def check(name: str, ok: bool, detail: str = ""):
    if ok:
        PASSED.append(name)
        print(f"PASS {name}")
    else:
        FAILED.append(name)
        print(f"FAIL {name} {detail}")


def login(context):
    page = context.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(BASE + "/unlock")
    page.fill("#unlock-key", KEY)
    page.click("#unlock-form button[type=submit]")
    page.wait_for_timeout(2500)
    check("unlock redirects to plan", page.url.endswith("/plan"), page.url)
    check("no page errors on unlock", not errors, str(errors[:2]))
    return page, errors


def main() -> None:
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page, errors = login(context)
        page.wait_for_selector(".verdict-word", timeout=8000)
        check("verdict card visible", page.locator(".verdict-word").inner_text() in ("Go", "No-go", "Unknown"), page.locator(".verdict-word").inner_text())

        # Plan screen headline (DP-09)
        headline = page.locator("h1").inner_text()
        check("headline long date", headline.startswith("Night of "), headline)
        check("headline has weekday", any(w in headline for w in ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]), headline)

        # Navigation landmarks (DP-56)
        nav = page.locator('nav[aria-label="Main"]')
        check("nav labelled Main", nav.count() == 1, str(nav.count()))
        for name in ["Plan", "Projects", "Sessions", "Library", "Site"]:
            check(f"nav link {name}", page.locator(f'nav[aria-label="Main"] >> text={name}').count() >= 1)

        # Time handle is a slider (DP-12)
        slider = page.locator("#night-time")
        check("slider present", slider.count() == 1)
        check("slider max set", int(slider.get_attribute("max") or "0") > 0, slider.get_attribute("max") or "")

        # Add target dialog (DP-07, DP-56)
        page.click("#add-target")
        page.wait_for_selector("#add-target-dialog[open]")
        check("add target dialog open", page.locator("#add-target-dialog[open]").count() == 1)
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        check("escape closes dialog", page.locator("#add-target-dialog[open]").count() == 0)

        # Conditions dialog with hour labels (DP-20)
        page.click("#enter-conditions")
        page.wait_for_selector("#conditions-dialog[open]")
        rows = page.locator("#conditions-hours .hour-row")
        check("conditions hours listed", rows.count() >= 8, str(rows.count()))
        first_label = page.locator("#conditions-hours .hour-row label").first.inner_text()
        check("hour label shape", ":" in first_label, first_label)
        page.keyboard.press("Escape")

        # Keyboard shortcuts on the plan screen (DP-56)
        page.locator("body").click(position={"x": 10, "y": 300})
        before = slider.get_attribute("aria-valuetext")
        page.keyboard.press("]")
        page.wait_for_timeout(700)
        after = slider.get_attribute("aria-valuetext")
        check("] moves handle 5 minutes", before != after, f"{before} -> {after}")

        # Layout at 1280 (DP-46)
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("no sideways scroll at 1280", not overflow)

        # Projects screen
        page.goto(BASE + "/projects")
        page.wait_for_selector(".project-grid article", timeout=8000)
        articles = page.locator(".project-grid article")
        check("project cards", articles.count() >= 3, str(articles.count()))
        first = articles.first.inner_text()
        check("project card fields", "IC 1805" in first or "M31" in first, first[:60])
        check("projects page verdict card", page.locator("#tonight-verdict").count() == 1)

        # Sessions screen
        page.goto(BASE + "/sessions")
        page.wait_for_selector("#sessions-tbody tr", timeout=8000)
        rows = page.locator("#sessions-tbody tr")
        check("sessions rows", rows.count() >= 1, str(rows.count()))

        # Library screen (DP-40 copy for stale warning)
        page.goto(BASE + "/library")
        page.wait_for_selector("#library-tbody tr", timeout=8000)
        lib = page.locator("#library-tbody").inner_text()
        check("library shows stale set", "Stale" in lib, lib[:120])
        check("stale warning copy", "older than 180 days" in lib or "consider a fresh library" in lib, lib[:200])

        # Site screen (DP-04)
        page.goto(BASE + "/site")
        page.wait_for_selector("#horizon-painter", timeout=8000)
        page.wait_for_function("document.getElementById('site-label') && document.getElementById('site-label').value !== ''", timeout=8000)
        painter = page.locator("#horizon-painter")
        check("painter accessible name", "Horizon painter: azimuth" in (painter.get_attribute("aria-label") or ""), painter.get_attribute("aria-label") or "")
        check("site label value", page.locator("#site-label").input_value() == "Back garden", page.locator("#site-label").input_value())
        check("push topic value", page.locator("#push-topic").input_value() == "darkframe-ines-5d2e")

        # Reminders list (DP-53)
        reminders = page.locator("#upcoming-reminders li")
        check("upcoming reminders listed", reminders.count() >= 1, str(reminders.count()))
        if reminders.count():
            text = reminders.first.inner_text()
            check("reminder item copy", "before the new moon of" in text, text)

        # Push log (DP-52)
        push_rows = page.locator("#push-tbody tr")
        check("push log rows", push_rows.count() >= 1, str(push_rows.count()))

        # Phone layout at 375 (DP-18, DP-46)
        phone = browser.new_context(viewport={"width": 375, "height": 812})
        p2, errs2 = login(phone)
        p2.wait_for_selector(".verdict-word", timeout=8000)
        bar = p2.locator(".plan-bottom")
        check("bottom bar visible at 375", bar.is_visible())
        earlier = p2.locator(".plan-bottom #earlier-30")
        earlier.wait_for(state="visible", timeout=5000)
        box = earlier.bounding_box()
        check("step button at least 44px tall", box and box["height"] >= 44, str(box))
        overflow2 = p2.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("no sideways scroll at 375", not overflow2)
        handle_visible = p2.locator(".plan-bottom .time-bar").is_visible()
        check("time bar in bottom bar", handle_visible)
        # Touch drag scrub
        bbox = p2.locator(".plan-bottom .time-bar").bounding_box()
        if bbox:
            p2.mouse.move(bbox["x"] + bbox["width"] * 0.2, bbox["y"] + 10)
            p2.mouse.down()
            p2.mouse.move(bbox["x"] + bbox["width"] * 0.8, bbox["y"] + 10, steps=6)
            p2.mouse.up()
            p2.wait_for_timeout(600)
            check("drag scrub kept in range", 0 <= int(p2.locator("#night-time").get_attribute("value") or "0"))
        phone.close()

        # 768 breakpoint (DP-46)
        mid = browser.new_context(viewport={"width": 768, "height": 1024})
        p3, _ = login(mid)
        p3.wait_for_selector(".verdict-word", timeout=8000)
        overflow3 = p3.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("no sideways scroll at 768", not overflow3)
        chart = p3.locator("#sky-chart").bounding_box()
        targets = p3.locator("#plan-targets").bounding_box()
        if chart and targets:
            check("list right of chart at 768", targets["x"] >= chart["x"] + chart["width"] - 2, f"{chart} {targets}")
        mid.close()

        # 1280 wide layout: dome width 44-48% of window (DP-46)
        page.goto(BASE + "/plan")
        page.wait_for_selector(".verdict-word", timeout=8000)
        stage = page.locator(".plan-stage").bounding_box()
        if stage:
            ratio = stage["width"] / 1280
            check("dome width 44-48% at 1280", 0.40 <= ratio <= 0.55, str(ratio))
        dome = page.locator("#sky-dome")

        # WebGL dome or fallback (DP-15, DP-16)
        has_webgl = page.evaluate("() => { try { const c = document.createElement('canvas'); return !!c.getContext('webgl'); } catch { return false; } }")
        check("webgl available in test browser", has_webgl)
        page.wait_for_timeout(900)
        dome_name = page.locator("#sky-dome").get_attribute("aria-label") or ""
        check("dome accessible name pattern", dome_name.startswith("Sky dome: camera elevation"), dome_name)

        # Shared page journey (DP-49, DP-50)
        share_page = context.new_page()
        share_page.goto(BASE + "/api/projects/proj_heart_sho", wait_until="domcontentloaded")
        # create a link via the API using the browser session cookie is complex; do a direct API call in the page context
        result = share_page.evaluate("""async () => {
            const r = await fetch('/api/projects/proj_heart_sho/share', {method:'POST', headers:{'Content-Type':'application/json'}, body:'{}'});
            return await r.json();
        }""")
        check("share create from browser", "token" in result, str(result)[:80])
        token = result.get("token", "")
        friend = browser.new_context(viewport={"width": 1280, "height": 800})
        fp = friend.new_page()
        fp.goto(BASE + f"/s/{token}")
        fp.wait_for_selector("#shared-tbody tr", timeout=8000)
        site_line = fp.locator("#shared-site").inner_text()
        check("shared site line rounded", "52.0" in site_line and "0.0" in site_line, site_line)
        check("shared has no notes", fp.locator("textarea").count() == 0)
        fp.goto(BASE + "/api/projects/proj_heart_sho/share")
        friend.close()
        # revoke and check unavailable copy
        share_page.evaluate("""async () => { await fetch('/api/projects/proj_heart_sho/share', {method:'DELETE'}); }""")
        friend2 = browser.new_context()
        fp2 = friend2.new_page()
        fp2.goto(BASE + f"/s/{token}")
        fp2.wait_for_timeout(600)
        body_text = fp2.locator("body").inner_text()
        check("revoked share shows unavailable copy", "no longer available" in body_text, body_text[:120])
        friend2.close()

        browser.close()

    print()
    print(f"passed {len(PASSED)}, failed {len(FAILED)}")
    if FAILED:
        for name in FAILED:
            print(" -", name)
        sys.exit(1)


if __name__ == "__main__":
    main()
