"""Browser checks for the Downtime event site, run with Playwright."""

from __future__ import annotations

import json
import os
import re
import sys
import urllib.request
import uuid

from playwright.sync_api import expect, sync_playwright
from support import BASE, check, report

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
LAPTOP = {"width": 1280, "height": 800}
SHOTS = "/tmp/downtime-shots"
DOWNLOADS = "/tmp/downtime-downloads"


os.makedirs(SHOTS, exist_ok=True)
os.makedirs(DOWNLOADS, exist_ok=True)


def unique(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}"


def sign_up(page, email: str, name: str = "Browser Player") -> None:
    page.goto(f"{BASE}/signup")
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_role("textbox", name="Display name").fill(name)
    page.get_by_role("textbox", name="Password").fill("sturdy-pw-2026")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_url(re.compile(r"/downtime"), timeout=15000)


def visitor_checks(page) -> None:
    page.goto(f"{BASE}/downtime")
    heading = page.get_by_role("heading", level=1)
    check("one h1", page.locator("h1").count() == 1, page.locator("h1").count())
    check(
        "hero title name",
        heading.inner_text().strip().startswith("It's Downtime!")
        or "It's Downtime!" in heading.inner_text(),
        heading.inner_text(),
    )
    check(
        "hero shows the struck word",
        page.locator("del.title-show").inner_text() == "SHOW"
        and page.locator(".title-down").inner_text() == "DOWN",
    )
    check(
        "skip link is first focusable",
        page.evaluate(
            "() => { const first = document.querySelector('a, button, input');"
            " return first ? first.textContent.trim() : ''; }"
        )
        == "Skip to main content",
    )
    for copy in (
        "Thu 22nd to Mon 26th Oct. Join any day. Simulator-Led CTF Event.",
        "Strange & Unusual Activity Detected",
        "say it three times and it shows up in your logs",
        "Nobody likes checking the attic alone!",
        "Form your team",
        "Live Leaderboard",
        "1,384+ security teams already signed up",
        "What are you waiting for?",
        "Dig up your team's capability gaps before something darker does",
        "Every room is a mission. Every mission builds a skill.",
        "Invite your manager to our exclusive webinar",
        "Over $40,000 in prizes",
    ):
        found = page.get_by_text(copy, exact=False).count()
        check(f"copy present: {copy[:38]}", found >= 1, found)

    check(
        "chant appears three times",
        page.locator(".hero-chant span", has_text="Strange & Unusual Activity").count()
        == 3,
    )
    check(
        "tail canvas is hidden from assistive technology",
        page.locator("canvas[data-tail]").get_attribute("aria-hidden") == "true",
    )
    check(
        "twenty orbiting dots",
        page.locator(".join-dots .dot").count() >= 20,
        page.locator(".join-dots .dot").count(),
    )
    check(
        "event bar is absent while the hero shows",
        page.get_by_role("region", name="Event bar").count() == 0,
    )
    page.mouse.wheel(0, 1400)
    page.wait_for_timeout(600)
    check(
        "event bar arrives once the hero leaves",
        page.get_by_role("region", name="Event bar").count() == 1,
    )
    page.mouse.wheel(0, -2000)
    page.wait_for_timeout(600)
    check(
        "event bar leaves again",
        page.get_by_role("region", name="Event bar").count() == 0,
    )

    pills = page.locator(".pill").all_inner_texts()
    check(
        "topic pills",
        [pill.strip() for pill in pills[:4]]
        == [
            "Alert Triaging",
            "Digital Forensics",
            "Threat Hunting",
            "Malware Analysis",
        ],
        pills,
    )
    page.get_by_role("button", name="View prizes").click()
    prizes = page.get_by_role("dialog", name="Prizes")
    expect(prizes).to_be_visible()
    check("prizes dialog opens", prizes.is_visible())
    page.keyboard.press("Escape")
    page.wait_for_timeout(200)
    check("prizes dialog closes on escape", not prizes.is_visible())

    questions = page.locator(".faq-question")
    check("seventeen faq questions", questions.count() == 17, questions.count())
    first = questions.first
    check("faq starts collapsed", first.get_attribute("aria-expanded") == "false")
    first.click()
    page.wait_for_timeout(150)
    check("faq expands", first.get_attribute("aria-expanded") == "true")
    answer = page.get_by_text(
        "Downtime's free five-day defensive security capture the flag event",
        exact=False,
    )
    check("faq answer shows", answer.count() >= 1)
    check(
        "winner answer copy",
        page.get_by_text(
            "The team with the highest score when the event closes on Monday 26 "
            "October wins.",
            exact=False,
        ).count()
        >= 1,
    )

    film = page.locator("video[data-film]")
    check(
        "film plays muted, looping and inline",
        film.get_attribute("muted") is not None
        or page.evaluate("() => document.querySelector('video[data-film]').muted"),
    )
    check(
        "film loops inline",
        page.evaluate(
            "() => { const film = document.querySelector('video[data-film]');"
            " return film.loop && film.playsInline; }"
        ),
    )
    track = page.locator("video[data-film] track")
    check(
        "english captions track",
        track.get_attribute("kind") == "captions"
        and track.get_attribute("srclang") == "en"
        and track.get_attribute("label") == "English",
    )
    page.get_by_role("button", name="Pause briefing").click()
    page.wait_for_timeout(200)
    check(
        "pause briefing becomes play briefing",
        page.get_by_role("button", name="Play briefing").count() == 1,
    )


def board_checks(page) -> None:
    pages = json.loads(
        urllib.request.urlopen(f"{BASE}/api/leaderboard?limit=5").read()
    )["pages"]
    page.goto(f"{BASE}/downtime")
    board = page.get_by_role("navigation", name="Leaderboard pages")
    expect(page.locator("[data-board-rows] tr").first).to_be_visible(timeout=10000)
    check(
        "five rows a page",
        page.locator("[data-board-rows] tr").count() == 5,
        page.locator("[data-board-rows] tr").count(),
    )
    check(
        "first ranks",
        page.locator("[data-board-rows] tr").first.inner_text().startswith("1"),
        page.locator("[data-board-rows] tr").first.inner_text(),
    )
    check(
        "page line",
        page.locator("[data-board-line]").inner_text()
        == f"1 of {pages} available pages",
        page.locator("[data-board-line]").inner_text(),
    )
    check(
        "previous is disabled on page one",
        board.get_by_role("button", name="Previous").is_disabled(),
    )
    check(
        "current page button carries aria-current",
        board.get_by_role("button", name="1").get_attribute("aria-current") == "page",
    )
    page.evaluate("() => { window.__reloaded = false; }")
    board.get_by_role("button", name="Next").click()
    page.wait_for_timeout(400)
    board.get_by_role("button", name="Next").click()
    page.wait_for_timeout(500)
    check("next twice reaches board=3", page.url.endswith("?board=3"), page.url)
    check(
        "page three shows rank eleven",
        page.locator("[data-board-rows] tr").first.inner_text().startswith("11"),
        page.locator("[data-board-rows] tr").first.inner_text(),
    )
    page.go_back()
    page.wait_for_timeout(600)
    check("back reaches board=2", page.url.endswith("?board=2"), page.url)
    check(
        "back shows page two without a reload",
        page.locator("[data-board-rows] tr").first.inner_text().startswith("6")
        and page.evaluate("() => window.__reloaded === false"),
        page.locator("[data-board-rows] tr").first.inner_text(),
    )
    page.reload()
    page.wait_for_timeout(800)
    check(
        "reload keeps page two",
        page.locator("[data-board-rows] tr").first.inner_text().startswith("6")
        and page.url.endswith("?board=2"),
        page.url,
    )
    page.go_forward()
    page.wait_for_timeout(600)
    check("forward reaches board=3", page.url.endswith("?board=3"), page.url)

    for raw in ("0", "abc", "07", "-1", "\uff11", "\u0661", "1"):
        page.goto(f"{BASE}/downtime?board={raw}")
        page.wait_for_timeout(700)
        check(
            f"invalid board {raw!r} normalises",
            page.url == f"{BASE}/downtime"
            and page.locator("[data-board-rows] tr").first.inner_text().startswith("1"),
            page.url,
        )
    page.goto(f"{BASE}/downtime?board=999")
    page.wait_for_timeout(900)
    check(
        "past the end opens the last page",
        page.url.endswith(f"?board={pages}")
        and page.locator("[data-board-line]").inner_text()
        == f"{pages} of {pages} available pages",
        (page.url, page.locator("[data-board-line]").inner_text()),
    )
    page.goto(f"{BASE}/downtime?board=3")
    page.wait_for_timeout(900)
    check(
        "a shared link opens its page",
        page.locator("[data-board-rows] tr").first.inner_text().startswith("11"),
    )
    feed = page.get_by_role("list", name="Activity feed")
    check(
        "activity feed has lines",
        feed.locator("li").count() == 10,
        feed.locator("li").count(),
    )
    check(
        "feed lines read team solved scenario",
        " solved " in feed.locator("li").first.inner_text(),
        feed.locator("li").first.inner_text(),
    )
    check(
        "solved words carry a tick",
        page.locator("[data-board-rows] .state-word.is-solved svg").count() > 0,
    )


def calendar_checks(page) -> None:
    page.goto(f"{BASE}/downtime")
    with page.expect_download() as download:
        page.get_by_role("link", name="Add to calendar").click()
    saved = f"{DOWNLOADS}/downtime.ics"
    download.value.save_as(saved)
    text = open(saved, "rb").read().decode()
    check(
        "calendar downloads",
        text.startswith("BEGIN:VCALENDAR") and "DTSTART:20261022T160000Z" in text,
        text[:80],
    )


def redirect_checks(page) -> None:
    page.goto(f"{BASE}/downtime")
    page.get_by_role("link", name="Join event").first.click()
    page.wait_for_url(re.compile(r"/signup"))
    check("join event reaches signup", "redirect=%2Fdowntime" in page.url, page.url)
    cross = page.locator(".account-cross-link a")
    check(
        "signup cross-link carries the redirect",
        "redirect=%2Fdowntime" in cross.get_attribute("href")
        and cross.inner_text().strip() == "Log in",
        cross.get_attribute("href"),
    )

    email = f"{unique('redirect')}@example.com"
    page.goto(f"{BASE}/signup?redirect=%2Fdowntime%23webinar")
    page.get_by_role("textbox", name="Email").fill(email)
    page.get_by_role("textbox", name="Display name").fill("Redirect Player")
    page.get_by_role("textbox", name="Password").fill("sturdy-pw-2026")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_url(re.compile(r"/downtime"), timeout=15000)
    check(
        "same-origin redirect keeps its fragment",
        page.url == f"{BASE}/downtime#webinar",
        page.url,
    )

    for raw in (
        "https%3A%2F%2Fevil.example.com%2F",
        "%2F%2Fevil.example.com",
        "%2F%5Cevil.example.com",
        "%5C%5Cevil.example.com",
        "javascript%3Aalert(1)",
    ):
        page.evaluate("() => localStorage.clear()")
        page.goto(f"{BASE}/login?redirect={raw}")
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("textbox", name="Password").fill("sturdy-pw-2026")
        page.get_by_role("button", name="Log in").click()
        page.wait_for_url(re.compile(r"/downtime"), timeout=15000)
        check(
            f"unsafe redirect {raw[:22]} lands on the event page",
            page.url == f"{BASE}/downtime",
            page.url,
        )

    page.goto(f"{BASE}/login?redirect=%2Fdowntime%23registration")
    page.wait_for_timeout(900)
    check(
        "a signed-in player is sent on from the account page",
        page.url == f"{BASE}/downtime#registration",
        page.url,
    )
    page.goto(f"{BASE}/downtime")
    page.get_by_role("button", name="Log out").click()
    page.wait_for_timeout(600)
    check(
        "log out returns to the event page signed out",
        page.url.endswith("/downtime")
        and page.get_by_role("link", name="Log In", exact=True).count() == 1,
        page.url,
    )


def account_error_checks(page) -> None:
    page.goto(f"{BASE}/signup")
    page.get_by_role("textbox", name="Email").fill("not-an-email")
    page.get_by_role("textbox", name="Display name").fill("Ada")
    page.get_by_role("textbox", name="Password").fill("short")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_timeout(700)
    messages = page.get_by_role("status", name="Account messages")
    check(
        "error summary lists the failing fields",
        "Fix the highlighted fields:" in messages.inner_text()
        and messages.get_by_role("link").count() >= 2,
        messages.inner_text(),
    )
    check(
        "inline field errors",
        page.get_by_text("Enter a valid email").count() >= 1
        and page.get_by_text("Password must be 8 to 128 characters").count() >= 1,
    )
    messages.get_by_role("link").first.click()
    page.wait_for_timeout(200)
    check(
        "summary links move focus to the field",
        page.evaluate("() => document.activeElement.dataset.field") == "email",
        page.evaluate("() => document.activeElement.tagName"),
    )


def consent_checks(browser) -> None:
    context = browser.new_context(viewport=LAPTOP)
    page = context.new_page()
    page.goto(f"{BASE}/downtime")
    page.wait_for_timeout(500)
    panel = page.get_by_text(
        "We use cookies to ensure you get the best user experience"
    )
    check("cookie panel shows on a first visit", panel.is_visible())
    page.get_by_role("button", name="Cookie Settings").click()
    settings = page.get_by_role("dialog", name="Cookie settings")
    check("cookie settings dialog", settings.is_visible())
    page.get_by_role("button", name="Essential only").click()
    page.wait_for_timeout(300)
    check("essential only closes the panel", not panel.is_visible())
    page.reload()
    page.wait_for_timeout(600)
    check("the panel stays closed", not panel.is_visible())
    check(
        "no analytics identifier is stored",
        page.evaluate(
            "() => Object.keys(localStorage).filter("
            "(key) => !['downtime.token','downtime.consent','downtime.sound']"
            ".includes(key))"
        )
        == [],
        page.evaluate("() => Object.keys(localStorage)"),
    )
    context.close()

    context = browser.new_context(viewport=LAPTOP)
    page = context.new_page()
    page.goto(f"{BASE}/downtime")
    page.wait_for_timeout(500)
    page.get_by_role("button", name="Allow All").click()
    page.reload()
    page.wait_for_timeout(600)
    check(
        "allow all closes the panel for good",
        not page.get_by_text(
            "We use cookies to ensure you get the best user experience"
        ).is_visible(),
    )
    context.close()


def sound_checks(browser) -> None:
    context = browser.new_context(viewport=LAPTOP)
    page = context.new_page()
    fetched = []
    page.on("request", lambda request: fetched.append(request.url))
    page.goto(f"{BASE}/downtime")
    page.wait_for_timeout(800)
    toggle = page.get_by_role("button", name="Sound off").first
    check("sound starts off", toggle.get_attribute("aria-pressed") == "false")
    check(
        "the soundtrack is not fetched while sound is off",
        not any("breathing-down-my-neck" in url for url in fetched),
    )
    toggle.click()
    page.wait_for_timeout(900)
    check(
        "the toggle reports sound on",
        page.get_by_role("button", name="Sound on").first.get_attribute("aria-pressed")
        == "true",
    )
    check(
        "the soundtrack is fetched once sound is on",
        any("breathing-down-my-neck" in url for url in fetched),
    )
    check(
        "the choice is remembered",
        page.evaluate("() => localStorage.getItem('downtime.sound')") == "on",
    )
    context.close()


def responsive_checks(browser) -> None:
    for name, viewport in (("phone", PHONE), ("tablet", TABLET), ("laptop", LAPTOP)):
        context = browser.new_context(viewport=viewport)
        page = context.new_page()
        page.goto(f"{BASE}/downtime")
        page.wait_for_timeout(900)
        overflow = page.evaluate(
            "() => document.documentElement.scrollWidth - window.innerWidth"
        )
        check(f"no sideways scrolling on {name}", overflow <= 1, overflow)
        if name == "phone":
            check(
                "phone shows the menu toggle",
                page.get_by_role("button", name="Menu").is_visible(),
            )
            check(
                "phone hides the simulator columns",
                not page.get_by_role("columnheader", name="SOC Simulator").is_visible(),
            )
            check(
                "phone keeps the challenge column",
                page.get_by_role("columnheader", name="Challenges").is_visible(),
            )
            page.get_by_role("button", name="Menu").click()
            page.wait_for_timeout(200)
            check(
                "menu reports expanded",
                page.get_by_role("button", name="Menu").get_attribute("aria-expanded")
                == "true",
            )
        if name == "laptop":
            check(
                "laptop shows the simulator columns",
                page.get_by_role("columnheader", name="SOC Simulator").is_visible(),
            )
        page.screenshot(path=f"{SHOTS}/{name}-event.png", full_page=False)
        for width in (320, 410, 1024):
            page.set_viewport_size({"width": width, "height": 800})
            page.wait_for_timeout(300)
            overflow = page.evaluate(
                "() => document.documentElement.scrollWidth - window.innerWidth"
            )
            check(f"no sideways scrolling at {width}px", overflow <= 1, overflow)
        context.close()


def trail_checks(page) -> None:
    page.goto(f"{BASE}/downtime")
    page.wait_for_timeout(600)
    blocks = page.locator(".trail-block")
    check("eight trail blocks", blocks.count() == 8, blocks.count())
    check(
        "blocks link to their scenario",
        blocks.first.get_by_role("link").get_attribute("href")
        == "/downtime/scenarios/repossessed",
    )
    check(
        "kind labels",
        page.locator(".kind-label").first.inner_text() == "SOC Sim Scenario",
        page.locator(".kind-label").first.inner_text(),
    )
    check(
        "five dashes on each block",
        page.locator(".block-dashes").first.inner_text().strip() == "-----",
        page.locator(".block-dashes").first.inner_text(),
    )
    running = page.evaluate(
        "() => document.getAnimations().filter((animation) => animation.playState"
        " === 'running' || animation.playState === 'paused').length"
    )
    check("the page runs native animations", running > 0, running)
    scroll_lit = page.evaluate(
        """() => {
          const orb = document.querySelector('[data-orb]');
          return document.getAnimations().some((animation) =>
            animation.effect && animation.effect.target === orb);
        }"""
    )
    check("orbs are driven by animations", scroll_lit)


def reduced_motion_checks(browser) -> None:
    context = browser.new_context(viewport=LAPTOP, reduced_motion="reduce")
    page = context.new_page()
    page.goto(f"{BASE}/downtime")
    page.wait_for_timeout(900)
    running = page.evaluate(
        "() => document.getAnimations().filter((animation) =>"
        " animation.playState === 'running').length"
    )
    check("reduced motion stops every loop", running == 0, running)
    check(
        "reduced motion keeps the film paused",
        page.evaluate("() => document.querySelector('video[data-film]').paused"),
    )
    check(
        "reduced motion draws the trail in full",
        page.evaluate(
            "() => getComputedStyle(document.querySelector('.trail-draw'))"
            ".strokeDashoffset"
        )
        in ("0", "0px"),
        page.evaluate(
            "() => getComputedStyle(document.querySelector('.trail-draw'))"
            ".strokeDashoffset"
        ),
    )
    check(
        "reduced motion shows the title in its final state",
        page.evaluate(
            "() => getComputedStyle(document.querySelector('.title-down')).clipPath"
        )
        in ("inset(0px)", "inset(0%)", "none", "inset(0px 0px 0px 0px)"),
        page.evaluate(
            "() => getComputedStyle(document.querySelector('.title-down')).clipPath"
        ),
    )
    context.close()


def page_links_checks(page) -> None:
    page.goto(f"{BASE}/downtime")
    targets = page.evaluate(
        "() => Array.from(document.querySelectorAll('.site-header a, .site-footer a'))"
        ".map((link) => link.getAttribute('href'))"
    )
    unique_targets = sorted(set(targets))
    for target in unique_targets:
        answer = urllib.request.urlopen(f"{BASE}{target}", timeout=10)
        check(f"chrome link {target} answers 200", answer.status == 200, answer.status)
    missing = urllib.request.Request(f"{BASE}/nowhere")
    try:
        urllib.request.urlopen(missing, timeout=10)
        check("unknown page answers 404", False, "200")
    except urllib.error.HTTPError as error:
        body = error.read().decode()
        check(
            "unknown page answers 404 with a link to the event page",
            error.code == 404 and 'href="/downtime"' in body,
            error.code,
        )


def focus_and_tap_checks(page) -> None:
    page.goto(f"{BASE}/downtime")
    page.wait_for_timeout(500)
    outline = page.evaluate(
        """() => {
          const button = document.querySelector('[data-create-team]');
          button.focus();
          const style = getComputedStyle(button);
          return [style.outlineColor, style.outlineWidth];
        }"""
    )
    check(
        "focused controls show a lime outline",
        outline[0].replace(" ", "") == "rgb(198,255,46)" and outline[1] != "0px",
        outline,
    )
    small = page.evaluate(
        """() => {
          const names = [];
          document.querySelectorAll('main button, main a.button, header button,'
            + ' header a.button').forEach((control) => {
            const box = control.getBoundingClientRect();
            if (box.width > 0 && (box.width < 44 || box.height < 44)) {
              names.push((control.textContent || control.ariaLabel || '').trim()
                + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
            }
          });
          return names;
        }"""
    )
    check("controls are at least 44 pixels square", small == [], small)


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context = browser.new_context(viewport=LAPTOP, accept_downloads=True)
        page = context.new_page()
        page.on("pageerror", lambda error: check("no page error", False, error))
        visitor_checks(page)
        board_checks(page)
        calendar_checks(page)
        trail_checks(page)
        page_links_checks(page)
        focus_and_tap_checks(page)
        account_error_checks(page)
        redirect_checks(page)
        context.close()
        consent_checks(browser)
        sound_checks(browser)
        responsive_checks(browser)
        reduced_motion_checks(browser)
        browser.close()
    return report()


if __name__ == "__main__":
    sys.exit(main())
