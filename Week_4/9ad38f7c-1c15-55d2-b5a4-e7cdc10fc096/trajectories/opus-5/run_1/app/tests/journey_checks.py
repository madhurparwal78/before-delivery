"""The player journeys in the browser: teams, flags, captains and certificates."""

from __future__ import annotations

import os
import re
import sys
import uuid

from playwright.sync_api import sync_playwright
from support import BASE, call, check, report

LAPTOP = {"width": 1280, "height": 800}
SHOTS = "/tmp/downtime-shots"
FLAGS = {
    "repossessed": "flag{nine_alerts_one_build}",
    "quiet-as-the-grave": "flag{hypothesis_held}",
    "deadmen-tell-no-logs": "flag{irregularities_logged}",
    "handbook-for-the-recently-compromised": "flag{timeline_rebuilt}",
    "the-waiting-room": "flag{payment_run_traced}",
    "day-o": "flag{payload_unpacked}",
    "strange-and-unusual-activity": "flag{dns_whispers}",
    "dead-endpoint": "flag{gallery_restored}",
}
WEBINAR_FLAG = "flag{comfort_zone_exit}"


os.makedirs(SHOTS, exist_ok=True)
os.makedirs("/tmp/downtime-downloads", exist_ok=True)


def fresh_email(label: str) -> str:
    return f"{label}-{uuid.uuid4().hex[:8]}@example.com"


def make_player(label: str) -> tuple[str, str]:
    email = fresh_email(label)
    answer = call(
        "POST",
        "/api/auth/signup",
        {"email": email, "display_name": label.title(), "password": "sturdy-pw-2026"},
    )
    assert answer.status == 201, answer
    return email, answer.json["token"]


def signed_in_page(context, token: str, path: str = "/downtime"):
    page = context.new_page()
    page.goto(f"{BASE}/")
    page.evaluate("(value) => localStorage.setItem('downtime.token', value)", token)
    page.goto(f"{BASE}{path}")
    page.wait_for_timeout(900)
    return page


def team_journey(browser) -> None:
    context = browser.new_context(viewport=LAPTOP)
    _, captain_token = make_player("captain")
    name = f"Attic Crew {uuid.uuid4().hex[:4]}"
    page = signed_in_page(context, captain_token, "/downtime#registration")
    page.get_by_role("button", name="Create a team").first.click()
    create = page.get_by_role("dialog", name="Create a team")
    check("create dialog opens for a signed-in player", create.is_visible())
    page.get_by_role("textbox", name="Team name").fill("ab")
    page.get_by_role("button", name="Create team").click()
    page.wait_for_timeout(700)
    check(
        "a short team name is refused in the dialog",
        create.is_visible()
        and "3 to 24"
        in page.get_by_role("status", name="Team messages").first.inner_text(),
        page.get_by_role("status", name="Team messages").first.inner_text(),
    )
    page.get_by_role("textbox", name="Team name").fill(name)
    page.get_by_role("button", name="Create team").click()
    page.wait_for_url(re.compile(r"/downtime/team"), timeout=15000)
    page.wait_for_selector(".member-list li", timeout=15000)
    check("creating a team opens the team room", page.url.endswith("/downtime/team"))
    check(
        "the room shows the team name", page.get_by_text(name, exact=False).count() >= 1
    )
    code = page.locator("[data-room-code]").inner_text().strip()
    check("the room shows an eight-character invite code", len(code) == 8, code)
    check(
        "the creator is marked captain",
        page.locator(".captain-marker").count() == 1
        and page.locator(".captain-marker").inner_text() == "Captain",
        page.locator(".member-list").inner_html()[:200],
    )
    check(
        "the room starts at zero",
        page.locator("[data-room-score]").inner_text() == "0",
        page.locator("[data-room-score]").inner_text(),
    )
    check(
        "joined times are written in UTC",
        bool(
            re.search(
                r"Joined \d{1,2} [A-Z][a-z]+ \d{4}, \d\d:\d\d UTC",
                page.locator(".member-list").inner_text(),
            )
        ),
        page.locator(".member-list").inner_text()[:120],
    )
    check(
        "the captain sees the new invite code control",
        page.get_by_role("button", name="New invite code").is_visible(),
    )
    check(
        "an unfinished team has no certificate link",
        page.get_by_role("link", name="Collect your certificate").count() == 0
        or not page.get_by_role("link", name="Collect your certificate").is_visible(),
    )

    mate_context = browser.new_context(viewport=LAPTOP)
    _, mate_token = make_player("teammate")
    mate = signed_in_page(mate_context, mate_token, "/downtime#registration")
    mate.get_by_role("button", name="Join an existing team").first.click()
    mate.get_by_role("textbox", name="Invite code").fill(code.lower())
    mate.get_by_role("button", name="Join team").click()
    mate.wait_for_url(re.compile(r"/downtime/team"), timeout=15000)
    mate.wait_for_timeout(500)
    check(
        "a lower-case code joins the same team",
        mate.get_by_text(name, exact=False).count() >= 1,
    )

    page.wait_for_timeout(2000)
    check(
        "the captain's open room lists the newcomer without a reload",
        page.locator(".member-list li").count() == 2,
        page.locator(".member-list li").count(),
    )

    page.get_by_role("button", name="Copy code").click()
    page.wait_for_timeout(300)
    check(
        "copy code answers in team messages",
        "Code copied"
        in page.get_by_role("status", name="Team messages").first.inner_text(),
    )
    page.get_by_role("button", name="Copy invite link").click()
    page.wait_for_timeout(300)
    check(
        "copy invite link answers in team messages",
        "Invite link copied"
        in page.get_by_role("status", name="Team messages").first.inner_text(),
    )

    return context, page, mate_context, mate, code, name


def flag_journey(page, mate, name) -> None:
    page.goto(f"{BASE}/downtime/scenarios/repossessed")
    page.wait_for_timeout(800)
    check(
        "the scenario page shows its facts",
        page.get_by_role("heading", name="Repossessed").count() == 1
        and page.get_by_text("SOC Sim Scenario").count() >= 1
        and page.get_by_text("500").count() >= 1,
    )
    check(
        "previous is disabled on the first scenario",
        page.get_by_role("button", name="Previous scenario").is_disabled(),
    )
    page.get_by_role("textbox", name="Flag", exact=True).fill("flag{nope}")
    page.get_by_role("button", name="Submit flag").click()
    page.wait_for_timeout(900)
    result = page.get_by_role("status", name="Flag result")
    check(
        "a wrong flag is refused and the typed value stays",
        "That flag is not right" in result.inner_text()
        and page.get_by_role("textbox", name="Flag", exact=True).input_value()
        == "flag{nope}",
        (
            result.inner_text(),
            page.get_by_role("textbox", name="Flag", exact=True).input_value(),
        ),
    )
    check(
        "the wrong flag shows in red",
        page.evaluate(
            "() => getComputedStyle(document.querySelector('[data-region=\"Flag result\"]'))"
            ".color"
        ).replace(" ", "")
        == "rgb(255,138,138)",
        page.evaluate(
            "() => getComputedStyle(document.querySelector('[data-region=\"Flag result\"]')).color"
        ),
    )
    check(
        "the scenario reads attempted",
        "Attempted" in page.locator("[data-scenario-state]").inner_text(),
        page.locator("[data-scenario-state]").inner_text(),
    )
    page.get_by_role("textbox", name="Flag", exact=True).fill(FLAGS["repossessed"])
    page.get_by_role("button", name="Submit flag").click()
    page.wait_for_timeout(1000)
    check(
        "a correct flag names the points",
        result.inner_text().strip()
        == "Solved! +500 for your team and +1 raffle ticket",
        result.inner_text(),
    )
    check(
        "the solved badge shows with a tick",
        page.locator("[data-solved-badge]").is_visible()
        and page.locator("[data-solved-badge] svg").count() == 1,
    )
    check(
        "the scenario reads solved by me",
        "Solved by me" in page.locator("[data-scenario-state]").inner_text(),
        page.locator("[data-scenario-state]").inner_text(),
    )
    page.screenshot(path=f"{SHOTS}/scenario-solved.png")

    mate.wait_for_timeout(2200)
    check(
        "the teammate's room shows the new score without a reload",
        mate.locator("[data-room-score]").inner_text() == "500",
        mate.locator("[data-room-score]").inner_text(),
    )
    check(
        "the teammate's room ticks solved by the team",
        "Solved by the team" in mate.locator("[data-room-scenarios]").inner_text(),
        mate.locator("[data-room-scenarios]").inner_text()[:140],
    )


def live_board_journey(browser, page, name) -> None:
    watcher = browser.new_context(viewport=LAPTOP)
    board = watcher.new_page()
    board.goto(f"{BASE}/downtime?board=2")
    board.wait_for_timeout(1200)
    before = board.locator("[data-board-rows]").inner_text()
    page.goto(f"{BASE}/downtime/scenarios/quiet-as-the-grave")
    page.wait_for_timeout(600)
    page.get_by_role("textbox", name="Flag", exact=True).fill(
        FLAGS["quiet-as-the-grave"]
    )
    page.get_by_role("button", name="Submit flag").click()
    page.wait_for_timeout(2500)
    check(
        "the watching board keeps its page in the address",
        board.url.endswith("?board=2"),
        board.url,
    )
    feed = board.get_by_role("list", name="Activity feed").inner_text()
    check(
        "the activity feed gains the new solve",
        name in feed and "Quiet As The Grave" in feed,
        feed[:160],
    )
    check(
        "the leaderboard updates live",
        board.locator("[data-board-rows]").inner_text() != before
        or name in board.locator("[data-board-rows]").inner_text(),
    )
    check(
        "the leaderboard updates region names the solve",
        "solved"
        in board.get_by_role("status", name="Leaderboard updates").inner_text(),
        board.get_by_role("status", name="Leaderboard updates").inner_text(),
    )
    watcher.close()


def webinar_journey(page) -> None:
    page.goto(f"{BASE}/downtime#webinar")
    page.wait_for_timeout(800)
    page.get_by_role("button", name="Copy link").click()
    page.wait_for_timeout(300)
    messages = page.get_by_role("status", name="Webinar messages")
    check("copy link answers", "Link copied" in messages.inner_text())
    page.get_by_role("textbox", name="Webinar flag").fill("flag{nope}")
    page.get_by_role("button", name="Claim tickets").click()
    page.wait_for_timeout(800)
    check(
        "a wrong webinar flag is refused",
        "That flag is not right" in messages.inner_text(),
        messages.inner_text(),
    )
    page.get_by_role("textbox", name="Webinar flag").fill(WEBINAR_FLAG)
    page.get_by_role("button", name="Claim tickets").click()
    page.wait_for_timeout(800)
    check(
        "the webinar bonus is claimed",
        "+2 raffle tickets claimed" in messages.inner_text(),
        messages.inner_text(),
    )
    page.get_by_role("button", name="Claim tickets").click()
    page.wait_for_timeout(800)
    check(
        "a second claim is refused",
        "Already claimed" in messages.inner_text(),
        messages.inner_text(),
    )


def captain_journey(page, mate) -> None:
    page.goto(f"{BASE}/downtime/team")
    page.wait_for_timeout(900)
    code_before = page.locator("[data-room-code]").inner_text().strip()
    remove = page.get_by_role("button", name=re.compile(r"^Remove Teammate"))
    check("the captain sees a remove control", remove.count() == 1, remove.count())
    remove.click()
    dialog = page.get_by_role("dialog", name="Remove member")
    check("the remove dialog names the member", "Teammate" in dialog.inner_text())
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check(
        "escape closes the dialog and returns focus",
        not dialog.is_visible()
        and page.evaluate("() => document.activeElement.textContent.trim()").startswith(
            "Remove"
        ),
        page.evaluate("() => document.activeElement.textContent"),
    )
    remove.click()
    page.get_by_role("button", name="Remove", exact=True).click()
    page.wait_for_timeout(1200)
    check(
        "the member leaves the list",
        page.locator(".member-list li").count() == 1,
        page.locator(".member-list li").count(),
    )
    check(
        "the invite code changes at once",
        page.locator("[data-room-code]").inner_text().strip() != code_before,
    )
    check(
        "focus moves to the new invite code control",
        " ".join(page.evaluate("() => document.activeElement.textContent").split())
        == "New invite code",
        page.evaluate("() => document.activeElement.textContent"),
    )
    check(
        "team messages names the removal",
        "was removed"
        in page.get_by_role("status", name="Team messages").first.inner_text(),
        page.get_by_role("status", name="Team messages").first.inner_text(),
    )

    mate.wait_for_timeout(2200)
    check(
        "the removed player's room says so",
        "You are no longer in this team"
        in mate.get_by_role("status", name="Team messages").first.inner_text(),
        mate.get_by_role("status", name="Team messages").first.inner_text(),
    )
    check(
        "the removed player sees the create and join buttons",
        mate.get_by_role("button", name="Create a team").first.is_visible()
        and mate.get_by_role("button", name="Join an existing team").first.is_visible(),
    )

    code_now = page.locator("[data-room-code]").inner_text().strip()
    page.get_by_role("button", name="New invite code").click()
    page.wait_for_timeout(900)
    check(
        "a new invite code replaces the shown code",
        page.locator("[data-room-code]").inner_text().strip() != code_now,
    )
    check(
        "team messages names the new code",
        "New invite code issued"
        in page.get_by_role("status", name="Team messages").first.inner_text(),
    )


def steps_journey(context) -> None:
    page = context.new_page()
    page.goto(f"{BASE}/downtime/scenarios/repossessed")
    page.wait_for_timeout(800)
    page.get_by_role("textbox", name="Flag", exact=True).fill("typed value")
    page.get_by_role("button", name="Next scenario").click()
    page.wait_for_timeout(700)
    check(
        "next scenario steps in place",
        page.url.endswith("/downtime/scenarios/quiet-as-the-grave")
        and page.get_by_role("heading", name="Quiet As The Grave").count() == 1,
        page.url,
    )
    check(
        "the flag field is emptied",
        page.get_by_role("textbox", name="Flag", exact=True).input_value() == "",
    )
    check(
        "focus stays on the pressed button",
        page.evaluate("() => document.activeElement.textContent.trim()").startswith(
            "Next scenario"
        ),
        page.evaluate("() => document.activeElement.textContent"),
    )
    page.get_by_role("button", name="Next scenario").click()
    page.wait_for_timeout(700)
    check(
        "stepping again moves on",
        page.url.endswith("/downtime/scenarios/deadmen-tell-no-logs"),
        page.url,
    )
    page.go_back()
    page.wait_for_timeout(700)
    check(
        "back shows the scenario in the address",
        page.url.endswith("/downtime/scenarios/quiet-as-the-grave")
        and page.get_by_role("heading", name="Quiet As The Grave").count() == 1,
        page.url,
    )
    page.go_forward()
    page.wait_for_timeout(700)
    check(
        "forward shows the next scenario",
        page.url.endswith("/downtime/scenarios/deadmen-tell-no-logs")
        and page.get_by_role("heading", name="Deadmen Tell No Logs").count() == 1,
        page.url,
    )
    page.goto(f"{BASE}/downtime/scenarios/dead-endpoint")
    page.wait_for_timeout(700)
    check(
        "next is disabled on the last scenario",
        page.get_by_role("button", name="Next scenario").is_disabled(),
    )
    page.close()


def invite_link_journey(browser, code) -> None:
    context = browser.new_context(viewport=LAPTOP)
    _, token = make_player("invited")
    page = signed_in_page(context, token, f"/downtime?join={code.lower()}#registration")
    page.wait_for_timeout(1200)
    check(
        "the join parameter is dropped from the address",
        page.url == f"{BASE}/downtime#registration",
        page.url,
    )
    dialog = page.get_by_role("dialog", name="Join an existing team")
    check(
        "the join dialog opens with the code in upper case",
        dialog.is_visible()
        and page.get_by_role("textbox", name="Invite code").input_value()
        == code.upper(),
        page.get_by_role("textbox", name="Invite code").input_value(),
    )
    check(
        "focus is in the invite code field",
        page.evaluate("() => document.activeElement.dataset.inviteCode !== undefined"),
    )
    page.get_by_role("button", name="Join team").click()
    page.wait_for_url(re.compile(r"/downtime/team"), timeout=15000)
    check("joining from an invite link works", page.url.endswith("/downtime/team"))
    context.close()

    visitor = browser.new_context(viewport=LAPTOP)
    page = visitor.new_page()
    page.goto(f"{BASE}/downtime?join={code.lower()}#registration")
    page.wait_for_url(re.compile(r"/login"), timeout=15000)
    check(
        "a visitor is sent through sign-in and back",
        "redirect=%2Fdowntime%3Fjoin%3D" in page.url and code.upper() in page.url,
        page.url,
    )
    page.goto(f"{BASE}/downtime?join=not-valid-code")
    page.wait_for_timeout(1000)
    check(
        "an invalid join value is only removed",
        page.url == f"{BASE}/downtime"
        and page.get_by_role("dialog", name="Join an existing team").count() == 0,
        page.url,
    )
    visitor.close()


def certificate_journey(browser) -> None:
    context = browser.new_context(viewport=LAPTOP, accept_downloads=True)
    email = fresh_email("finisher")
    token = call(
        "POST",
        "/api/auth/signup",
        {"email": email, "display_name": "Mara Quill", "password": "sturdy-pw-2026"},
    ).json["token"]
    joined = call("POST", "/api/teams/join", {"invite_code": "COLDLEDG"}, token=token)
    check("a player joins the finished team", joined.status == 200, joined)
    page = signed_in_page(context, token, "/downtime/team")
    page.wait_for_timeout(900)
    check(
        "a finished team room links to the certificate",
        page.get_by_role("link", name="Collect your certificate").is_visible(),
    )
    page.get_by_role("link", name="Collect your certificate").click()
    page.wait_for_url(re.compile(r"/downtime/certificate"), timeout=15000)
    page.wait_for_timeout(900)
    body = page.locator("[data-certificate]").inner_text()
    check(
        "the certificate names the player, team, event and time",
        "Mara Quill" in body
        and "Cold Ledger" in body
        and "Strange & Unusual Activity" in body
        and "22 to 26 October 2026" in body
        and "Completed 23 October 2026, 07:30 UTC" in body,
        body,
    )
    page.screenshot(path=f"{SHOTS}/certificate.png")
    with page.expect_download() as download:
        page.get_by_role("button", name="Download certificate").click()
    saved = "/tmp/downtime-downloads/downtime-certificate.svg"
    download.value.save_as(saved)
    image = open(saved, "rb").read().decode()
    check(
        "the certificate image downloads",
        image.startswith("<?xml") and "Mara Quill" in image and "<script" not in image,
        image[:60],
    )

    unfinished_context = browser.new_context(viewport=LAPTOP)
    _, lone_token = make_player("lonely")
    lone = signed_in_page(unfinished_context, lone_token, "/downtime/certificate")
    lone.wait_for_timeout(900)
    check(
        "an unfinished player is told how many scenarios remain",
        "Your team has not completed the event yet"
        in lone.get_by_role("status", name="Certificate status").inner_text()
        and "8 scenarios to go"
        in lone.get_by_role("status", name="Certificate status").inner_text(),
        lone.get_by_role("status", name="Certificate status").inner_text(),
    )
    check(
        "the certificate and its download are absent",
        not lone.locator("[data-certificate]").is_visible(),
    )
    unfinished_context.close()

    call("POST", "/api/teams/leave", token=token)
    page.wait_for_timeout(2500)
    check(
        "leaving hides the certificate again within two seconds",
        not page.locator("[data-certificate]").is_visible()
        and "has not completed"
        in page.get_by_role("status", name="Certificate status").inner_text(),
        page.get_by_role("status", name="Certificate status").inner_text(),
    )
    context.close()


def leave_journey(page) -> None:
    page.goto(f"{BASE}/downtime/team")
    page.wait_for_timeout(900)
    page.get_by_role("button", name="Leave team").click()
    dialog = page.get_by_role("dialog", name="Leave team")
    check("the leave dialog opens", dialog.is_visible())
    page.get_by_role("button", name="Leave", exact=True).click()
    page.wait_for_url(re.compile(r"/downtime#registration"), timeout=15000)
    check(
        "leaving returns the player to the team band",
        page.url.endswith("/downtime#registration"),
        page.url,
    )


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        context, page, mate_context, mate, code, name = team_journey(browser)
        flag_journey(page, mate, name)
        live_board_journey(browser, page, name)
        webinar_journey(page)
        captain_journey(page, mate)
        steps_journey(context)
        invite_link_journey(
            browser, page.locator("[data-room-code]").inner_text().strip()
        )
        leave_journey(page)
        certificate_journey(browser)
        context.close()
        mate_context.close()
        browser.close()
    return report()


if __name__ == "__main__":
    sys.exit(main())
