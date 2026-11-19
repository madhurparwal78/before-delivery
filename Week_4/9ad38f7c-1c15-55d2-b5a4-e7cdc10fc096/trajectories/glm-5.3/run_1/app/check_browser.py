"""Browser checks for the event site with Playwright Chromium."""

import json
import os
import re
import sys
import time
import urllib.request

from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
PASSWORD = "deku-demo-pw-2026"
passed = 0
failed = 0
SHOT_DIR = "/app/.browser_screenshots"


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
        print("  ok   " + name)
    else:
        failed += 1
        print("  FAIL " + name + ("  -- " + str(detail)[:220] if detail else ""))


def api(path, body=None, token=None, method=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data,
                                 method=method or ("POST" if data else "GET"))
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    with urllib.request.urlopen(req, timeout=10) as response:
        return response.status, json.loads(response.read() or b"null")


def login_token(email):
    status, data = api("/api/auth/login", {"email": email, "password": PASSWORD})
    return data["token"]


def main():
    os.makedirs(SHOT_DIR, exist_ok=True)
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        print("visitor journey")
        context = browser.new_context(viewport={"width": 1280, "height": 800},
                                      permissions=["clipboard-read", "clipboard-write"])
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda err: errors.append(str(err)))
        page.goto(BASE + "/downtime", wait_until="domcontentloaded")
        expect(page.locator("h1")).to_have_accessible_name("It's Downtime!")
        check("hero accessible name", True)
        h1_count = page.locator("h1").count()
        check("only one h1 on the event page", h1_count == 1, h1_count)
        check("eyebrow copy", page.locator(".eyebrow").inner_text().startswith(
            "Thu 22nd to Mon 26th Oct"), page.locator(".eyebrow").inner_text())
        check("case heading has lime Detected",
              "Detected" in page.locator("#case-heading").inner_text())
        check("topic pills count", page.locator(".topic-pills .pill").count() == 4)
        check("event bar absent while hero in view",
              page.locator("#event-bar").is_hidden())
        check("skip link first", page.evaluate(
            "document.querySelector('a,button,input,[tabindex]')?.id") == "skip-link")
        # leaderboard pagination
        page.wait_for_function("document.querySelector('[data-board-count]')?.textContent.length > 0")
        page.locator("[data-next]").click()
        page.wait_for_function("document.querySelector('[data-board-count]')"
                               "?.textContent.startsWith('2 of ')")
        check("next adds history with board=2",
              page.url.endswith("board=2"), page.url)
        page.locator("[data-next]").click()
        page.wait_for_function("document.querySelector('[data-board-count]')"
                               "?.textContent.startsWith('3 of ')")
        check("second next ends in board=3", page.url.endswith("board=3"), page.url)
        page.go_back()
        page.wait_for_function("!document.querySelector('[data-board-count]')"
                               "?.textContent || document.querySelector('[data-board-count]')"
                               "?.textContent.startsWith('2 of ')")
        check("back shows page 2", "2 of" in page.locator("[data-board-count]").inner_text(),
              page.locator("[data-board-count]").inner_text())
        check("board address after back", page.url.endswith("board=2"), page.url)
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function("document.querySelector('[data-board-count]')?.textContent.length > 0")
        check("reload keeps page 2",
              "2 of" in page.locator("[data-board-count]").inner_text(),
              page.locator("[data-board-count]").inner_text())
        # invalid board value
        page.goto(BASE + "/downtime?board=abc", wait_until="domcontentloaded")
        page.wait_for_function("document.querySelector('[data-board-count]')?.textContent.length > 0")
        check("invalid board normalised to page 1",
              "board" not in page.url and "1 of" in
              page.locator("[data-board-count]").inner_text(), page.url)
        # activity feed
        feed_text = page.locator("[data-feed-list]").inner_text()
        check("activity feed lists solves", "solved" in feed_text, feed_text[:80])
        check("feed is a named list",
              page.locator("[data-feed-list]").get_attribute("aria-label") ==
              "Activity feed")
        check("table caption", page.locator(".board-table caption").inner_text() ==
              "Live Leaderboard")
        # calendar download
        with page.expect_download() as download_info:
            page.locator("[data-calendar]").click()
        download = download_info.value
        check("calendar downloads", download.suggested_filename == "downtime.ics",
              download.suggested_filename)
        # webinar copy link
        page.locator("[data-copy-link]").click()
        page.wait_for_function(
            "document.getElementById('webinar-messages')?.textContent.includes('Link copied')")
        check("webinar link copied message", True)
        page.screenshot(path=SHOT_DIR + "/event-desktop.png", full_page=False)
        check("no page errors so far", not errors, errors[:3])
        context.close()

        print("responsive check")
        phone = browser.new_context(viewport={"width": 375, "height": 812})
        phone_page = phone.new_page()
        phone_page.goto(BASE + "/downtime", wait_until="domcontentloaded")
        phone_page.wait_for_function("document.querySelector('[data-board-count]')?.textContent.length > 0")
        sideways = phone_page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("no sideways scroll at 375", not sideways)
        check("sim columns hidden on phone",
              phone_page.locator(".col-sim").first.is_hidden())
        check("menu toggle visible on phone",
              phone_page.locator(".menu-toggle").is_visible())
        phone_page.screenshot(path=SHOT_DIR + "/event-phone.png")
        phone.close()

        print("narrow check 320")
        narrow = browser.new_context(viewport={"width": 320, "height": 700})
        narrow_page = narrow.new_page()
        narrow_page.goto(BASE + "/downtime", wait_until="domcontentloaded")
        narrow_page.wait_for_function("document.querySelector('[data-board-count]')?.textContent.length > 0")
        sideways = narrow_page.evaluate(
            "document.documentElement.scrollWidth > document.documentElement.clientWidth")
        check("no sideways scroll at 320", not sideways)
        narrow.close()

        print("sign up journey")
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        page.goto(BASE + "/downtime", wait_until="domcontentloaded")
        page.locator(".hero [data-hero-signup]").click()
        page.wait_for_url("**/signup?redirect=%2Fdowntime")
        check("join event carries redirect", page.url.endswith(
            "signup?redirect=%2Fdowntime"), page.url)
        email = "browser-%d@example.com" % int(time.time())
        page.fill("#email", email)
        page.fill("#display_name", "Browser Player")
        page.fill("#password", PASSWORD)
        page.locator("button[type=submit]").click()
        page.wait_for_url("**/downtime")
        check("signup lands back on /downtime", page.url.endswith("/downtime"), page.url)
        page.wait_for_function(
            "document.querySelector('.account-name') && "
            "!document.querySelector('.account-name').hidden")
        check("header shows display name after signup",
              page.locator(".account-name").inner_text() == "Browser Player")
        check("logout button visible", page.locator(".logout-button").is_visible())

        print("team creation")
        page.locator(".team-band [data-open-team-create]").click()
        page.wait_for_selector("#create-team-dialog", state="visible")
        page.fill("#team-name", "Browser Crew %d" % int(time.time()))
        page.locator("[data-team-create-form] button[type=submit]").click()
        page.wait_for_url("**/downtime/team")
        check("team room reached", page.url.endswith("/downtime/team"))
        page.wait_for_selector("[data-invite-code]:not(:empty)")
        code = page.locator("[data-invite-code]").inner_text()
        check("invite code shown", len(code) == 8, code)
        check("team name shown",
              page.locator("[data-team-name]").inner_text().startswith("Browser Crew"))
        check("captain marker for self",
              "Captain" in page.locator("[data-member-list]").inner_text())
        check("score zero at creation",
              page.locator("[data-team-score]").inner_text() == "0")
        page.screenshot(path=SHOT_DIR + "/team-room.png")

        print("captain controls")
        check("new invite code button visible for captain",
              page.locator("[data-new-invite-code]").is_visible())
        page.locator("[data-new-invite-code]").click()
        page.wait_for_function(
            "document.getElementById('team-messages')?.textContent.includes('New invite code issued')")
        new_code = page.locator("[data-invite-code]").inner_text()
        check("invite code changed", new_code != code, (code, new_code))

        print("scenario page and flag")
        page.goto(BASE + "/downtime/scenarios/repossessed",
                  wait_until="domcontentloaded")
        check("scenario title", page.locator(".page-title").inner_text() ==
              "Repossessed")
        check("kind label", page.locator(".kind-label").inner_text() ==
              "SOC Sim Scenario")
        check("points shown", page.locator(".scenario-points").inner_text() ==
              "500 XP")
        check("prev disabled on first",
              page.locator("[data-prev-scenario]").is_disabled())
        page.fill("#flag", "flag{wrong_guess}")
        page.locator("[data-flag-form] button[type=submit]").click()
        page.wait_for_function(
            "document.getElementById('flag-result')?.textContent.includes('not right')")
        check("wrong flag message", True)
        check("typed value kept after wrong flag",
              page.locator("#flag").input_value() == "flag{wrong_guess}")
        page.fill("#flag", "flag{nine_alerts_one_build}")
        page.locator("[data-flag-form] button[type=submit]").click()
        page.wait_for_function(
            "document.getElementById('flag-result')?.textContent.includes('Solved!')")
        check("solved message with points",
              "Solved! +500" in page.locator("#flag-result").inner_text(),
              page.locator("#flag-result").inner_text())
        page.wait_for_selector("[data-solved-badge]", state="visible")
        check("solved badge visible", True)
        page.locator("[data-next-scenario]").click()
        page.wait_for_function(
            "document.querySelector('.page-title')?.textContent === 'Quiet As The Grave'")
        check("next steps in place", page.url.endswith(
            "/downtime/scenarios/quiet-as-the-grave"), page.url)
        check("flag field emptied on step",
              page.locator("#flag").input_value() == "")
        page.go_back()
        page.wait_for_function(
            "document.querySelector('.page-title')?.textContent === 'Repossessed'")
        check("back shows previous scenario", True)

        print("certificate not complete")
        page.goto(BASE + "/downtime/certificate", wait_until="domcontentloaded")
        page.wait_for_selector("[data-not-complete]", state="visible")
        check("not-complete copy shown",
              "not completed" in page.locator("[data-not-complete]").inner_text())
        page.wait_for_function(
            "document.querySelector('[data-remaining]')?.textContent.includes('to go')")
        check("remaining shown", True)

        print("webinar claim")
        page.goto(BASE + "/downtime#webinar", wait_until="domcontentloaded")
        page.wait_for_selector("[data-webinar-form]", state="visible")
        page.fill("#webinar-flag", "flag{comfort_zone_exit}")
        page.locator("[data-webinar-form] button[type=submit]").click()
        page.wait_for_function(
            "document.getElementById('webinar-messages')?.textContent.includes('+2 raffle tickets')")
        check("webinar claim message", True)

        print("dialog behaviour")
        page.goto(BASE + "/downtime", wait_until="domcontentloaded")
        page.locator("[data-open-prizes]").click()
        page.wait_for_selector("#prizes-dialog", state="visible")
        check("prizes dialog opens",
              "Over $40,000 in prizes" in page.locator("#prizes-dialog").inner_text())
        page.keyboard.press("Escape")
        check("escape closes dialog",
              page.locator("#prizes-dialog").is_hidden())

        print("consent")
        fresh = browser.new_context(viewport={"width": 1280, "height": 800})
        fresh_page = fresh.new_page()
        fresh_page.goto(BASE + "/downtime", wait_until="domcontentloaded")
        fresh_page.wait_for_selector("[data-consent-panel]", state="visible")
        check("consent panel shows on first visit", True)
        fresh_page.locator("[data-allow-all]").click()
        check("allow all closes panel",
              fresh_page.locator("[data-consent-panel]").is_hidden())
        fresh_page.reload(wait_until="domcontentloaded")
        check("panel stays closed after reload",
              fresh_page.locator("[data-consent-panel]").is_hidden())
        stored = fresh_page.evaluate("Object.keys(localStorage)")
        check("no analytics identifier stored",
              all("analytics" not in key.lower() for key in stored), stored)
        fresh.close()

        print("logout")
        page.locator(".logout-button").click()
        page.wait_for_url("**/downtime")
        check("logout returns to event page", page.url.endswith("/downtime"))
        page.wait_for_selector(".login-link", state="visible")
        check("signed-out header restored", True)
        ctx.close()
        browser.close()

    print("\n%d passed, %d failed" % (passed, failed))
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
