#!/usr/bin/env python3
"""Drives a real browser over the published journeys. Verification only."""
import sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
passed = 0
failed = []


def check(label, got, want):
    global passed
    if got == want:
        passed += 1
        print(f"ok   {label}")
    else:
        failed.append(label)
        print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")


def sign_in(page):
    page.goto(f"{BASE}/sign-in")
    page.fill("#sign-in-email", "agnese@bottega-semenza.example")
    page.fill("#sign-in-password", "tacks-and-hide-2027")
    page.click("#sign-in-submit")
    page.wait_for_url(f"{BASE}/pieces")


def run(p):
    browser = p.chromium.launch()

    # ---------------------------------------------------------- public site
    desktop = browser.new_context(viewport={"width": 1280, "height": 800})
    page = desktop.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    # A refused request the screen handles is not a page error.
    page.on(
        "console",
        lambda m: errors.append(m.text)
        if m.type == "error" and "Failed to load resource" not in m.text
        else None,
    )

    page.goto(BASE)
    check("home h1", page.locator("h1").inner_text(), "ONE CHAIR AT A TIME.")

    # the Work panel is a menu panel: no focus taken, Escape closes
    page.click("#work-button")
    check("work panel expanded", page.get_attribute("#work-button", "aria-expanded"), "true")
    check("work panel keeps focus on Work", page.evaluate("document.activeElement.id"), "work-button")
    check("work panel tiles", page.locator("#work-panel a").count(), 6)
    check("work panel nav name", page.get_attribute("#work-panel nav", "aria-label"), "Work")
    page.keyboard.press("Escape")
    check("escape returns focus", page.evaluate("document.activeElement.id"), "work-button")
    page.wait_for_timeout(400)
    check("work panel hidden after close", page.locator("#work-panel").is_hidden(), True)

    # Down moves into the panel
    page.click("#work-button")
    page.keyboard.press("ArrowDown")
    check("Down enters panel", page.evaluate("document.activeElement.tagName"), "A")
    page.keyboard.press("Escape")

    # the work filter lives in the URL with one history entry per change
    page.goto(f"{BASE}/work")
    before = page.evaluate("history.length")
    page.click("#kind-leather")
    page.wait_for_timeout(400)
    check("filter in URL", page.url, f"{BASE}/work?kind=leather")
    check("one history entry", page.evaluate("history.length") - before, 1)
    check("leather tiles shown", page.locator("li[data-kind]:visible").count(), 3)
    page.click("#kind-all")
    page.wait_for_timeout(400)
    check("all clears the parameter", page.url, f"{BASE}/work")

    # pressing a case moves its drawing to the hero as one element
    page.goto(f"{BASE}/work")
    page.evaluate("""() => {
      window.__moves = [];
      const el = document.querySelector('[data-case="bentwood-armchair"]');
      el.dataset.marker = 'kept';
    }""")
    page.click('[data-case-link="bentwood-armchair"]')
    page.wait_for_timeout(120)
    check(
        "one element for that case during the move",
        page.locator('[data-part="case-drawing"][data-case="bentwood-armchair"]').count(),
        1,
    )
    durations = page.evaluate(
        """() => document.querySelector('[data-case="bentwood-armchair"]')
                .getAnimations().map(a => a.effect.getTiming().duration)"""
    )
    check("shared move runs 320 ms", durations, [320])
    page.wait_for_timeout(400)
    check("the same element became the hero", page.get_attribute('[data-case="bentwood-armchair"]', "data-marker"), "kept")
    check("hero flag", page.get_attribute('[data-case="bentwood-armchair"]', "data-hero"), "true")
    check("case page title", page.title(), "Bentwood armchair — Bottega Semenza")
    check("focus on the new heading", page.evaluate("document.activeElement.tagName"), "H1")

    # the case rail
    check("rail marks 01 at the top", page.get_attribute('[data-rail="as-it-came"]', "aria-current"), "true")
    page.click('[data-rail="the-cover"]')
    check("rail hash in the URL", page.url.endswith("#the-cover"), True)
    check("rail marks the pressed number", page.get_attribute('[data-rail="the-cover"]', "aria-current"), "true")
    check("only one marked", page.locator('[data-rail][aria-current="true"]').count(), 1)
    check("focus on that heading", page.evaluate("document.activeElement.id"), "the-cover")
    heading_top = page.evaluate("document.getElementById('the-cover').getBoundingClientRect().top")
    header_bottom = page.evaluate("document.querySelector('.site-header').getBoundingClientRect().bottom")
    check("heading fully below the sticky header", heading_top >= header_bottom, True)
    check("heading lands on the rail's line", round(heading_top), 96)
    page.evaluate("window.scrollTo(0, document.body.scrollHeight)")
    page.wait_for_timeout(200)
    check("at the very bottom the last section", page.get_attribute('[data-rail="files"]', "aria-current"), "true")

    # the enquiry form
    page.goto(f"{BASE}/enquire")
    page.fill("#enquiry-name", "Tomas Weil")
    page.fill("#enquiry-email", "not-an-address")
    page.fill("#enquiry-message", "A bentwood armchair with a split seat.")
    page.click("#enquiry-send")
    page.wait_for_timeout(500)
    check("problems summary shows", page.locator("#problems").is_visible(), True)
    check("problems link text is the field message", page.locator("#problems a").first.inner_text(), "That is not an email address.")
    check("field marked invalid", page.get_attribute("#enquiry-email", "aria-invalid"), "true")
    page.fill("#enquiry-email", "tomas-browser@example.org")
    page.click("#enquiry-send")
    page.wait_for_timeout(600)
    check("enquiry announced", page.locator("#announcements").inner_text(), "Thank you. Your enquiry is on its way.")

    # ------------------------------------------------------------- the desk
    sign_in(page)
    check("sign-in lands on /pieces", page.url, f"{BASE}/pieces")
    page.wait_for_selector('[aria-label="Pieces table"] tbody tr')
    check("seeded rows", page.locator('[aria-label="Pieces table"] tbody tr').count(), 7)
    check("mint tile due figure", page.locator("#due-soon").inner_text(), "1")
    check("frame has a name and takes focus", page.get_attribute('[aria-label="Pieces table"]', "tabindex"), "0")

    # exactly one mint tile a screen
    check("one mint tile on /pieces", page.locator(".tile-mint").count(), 1)

    # the action menu opens uncut on the last row
    rows = page.locator('[aria-label="Pieces table"] tbody tr')
    last = rows.nth(rows.count() - 1)
    last.locator("button.row-actions").click()
    page.wait_for_selector(".row-menu")
    box = page.locator(".row-menu").bounding_box()
    size = page.viewport_size
    check(
        "menu fully on screen",
        box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= size["width"] and box["y"] + box["height"] <= size["height"],
        True,
    )
    check("menu items", page.locator('.row-menu [role="menuitem"]').count(), 3)
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)

    # filters stay in the URL and Back returns to the same place
    page.select_option("#filter-sort", "dueDate")
    page.wait_for_timeout(400)
    check("sort in the URL", page.url, f"{BASE}/pieces?sort=dueDate")
    first_link = page.locator('[aria-label="Pieces table"] tbody tr a').first
    title = first_link.inner_text()
    first_link.click()
    page.wait_for_timeout(500)
    check("piece screen heading", page.locator("h1").inner_text(), title)
    page.go_back()
    page.wait_for_timeout(700)
    check("Back keeps the sort", page.url, f"{BASE}/pieces?sort=dueDate")

    # the condition map
    page.goto(f"{BASE}/pieces/1/condition")
    page.wait_for_selector('[data-part="pin"]')
    check("three seeded pins", page.locator('[data-part="pin"]').count(), 3)
    names = page.locator('[data-part="pin"]').evaluate_all("els => els.map(e => e.getAttribute('aria-label'))")
    check("reading order", names, ["Pin 1: Tear", "Pin 3: Loose joint", "Pin 2: Stain"])
    stops = page.locator('[data-part="pin"][tabindex="0"]').count()
    check("one Tab stop for the pins", stops, 1)
    page.locator('[data-part="pin"]').first.focus()
    page.keyboard.press("ArrowRight")
    check("Right goes to the next pin", page.evaluate("document.activeElement.getAttribute('aria-label')"), "Pin 3: Loose joint")
    page.keyboard.press("ArrowLeft")
    page.keyboard.press("ArrowLeft")
    check("Left wraps at the start", page.evaluate("document.activeElement.getAttribute('aria-label')"), "Pin 2: Stain")
    page.keyboard.press("Enter")
    page.wait_for_selector(".popover")
    check("popover name", page.get_attribute(".popover", "aria-label"), "Pin 2")
    check("popover is not modal", page.get_attribute(".popover", "aria-modal"), None)
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check("focus back on the pin", page.evaluate("document.activeElement.getAttribute('aria-label')"), "Pin 2: Stain")
    check("markup rendered as bold", page.locator(".pin-note strong").first.inner_text(), "Tear")

    # the keyboard crosshair starts at the centre
    page.locator("#add-a-pin").focus()
    page.keyboard.press("Enter")
    page.wait_for_selector('[data-part="crosshair"]')
    check("crosshair at the centre", page.get_attribute('[data-part="crosshair"]', "data-x"), "50.0")
    page.keyboard.press("ArrowRight")
    check("arrow moves 1%", page.get_attribute('[data-part="crosshair"]', "data-x"), "51.0")
    page.keyboard.press("Shift+ArrowRight")
    check("shift+arrow moves 10%", page.get_attribute('[data-part="crosshair"]', "data-x"), "61.0")
    page.keyboard.press("Escape")
    page.wait_for_timeout(100)
    check("escape leaves no pin", page.locator('[data-part="crosshair"]').count(), 0)
    check("focus back on Add a pin", page.evaluate("document.activeElement.id"), "add-a-pin")

    # the hide
    page.goto(f"{BASE}/pieces/1/hide")
    page.wait_for_selector('[data-part="pattern-piece"]')
    check("five pattern pieces", page.locator('[data-part="pattern-piece"]').count(), 5)
    check("hide is one Tab stop", page.locator('[data-part="hide"][tabindex="0"]').count(), 1)
    check("seeded Seat placed", page.get_attribute('[data-piece="Seat"]', "data-state"), "placed")
    check("figure", page.locator('[data-part="hide-figure"]').inner_text(), "Used 3.87 sq ft of 51.67 sq ft (7.5%)")
    check("two flaws", page.locator('[data-part="flaw"]').count(), 2)
    page.locator('[data-part="hide"]').focus()
    check("first piece chosen", page.get_attribute('[data-piece="Seat"]', "data-chosen"), "true")
    page.keyboard.press("Enter")
    page.wait_for_timeout(300)
    check("Seat lifted", page.get_attribute('[data-piece="Seat"]', "data-state"), "lifted")
    check("lift announced", page.locator("#announcements").inner_text(),
          "Seat lifted. Arrow keys move it, Enter places it, Escape puts it back.")
    page.keyboard.press("ArrowLeft")
    page.wait_for_timeout(250)
    check("data-x follows past the edge", page.get_attribute('[data-piece="Seat"]', "data-x"), "-1")
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    check("off-hide refusal", page.locator("#announcements").inner_text(), "Seat cannot go there. It runs off the hide.")
    check("still lifted after a refusal", page.get_attribute('[data-piece="Seat"]', "data-state"), "lifted")
    page.keyboard.press("ArrowRight")
    page.wait_for_timeout(250)
    page.keyboard.press("Enter")
    page.wait_for_timeout(700)
    check("placed", page.get_attribute('[data-piece="Seat"]', "data-state"), "placed")
    check("place announced", page.locator("#announcements").inner_text(), "Seat placed at 0, 0 cm.")

    # the estimate
    page.goto(f"{BASE}/pieces/1/estimate")
    page.wait_for_selector("#estimate-total")
    check("seeded total", page.locator("#estimate-total").inner_text(), "€2,102.71")
    check("one mint tile on the estimate", page.locator(".tile-mint").count(), 1)

    # the library
    page.goto(f"{BASE}/library")
    page.wait_for_selector(".swatch-holder input")
    check("twelve starting swatches", page.locator(".swatch-holder input").count(), 12)
    check("families as radio groups", page.locator('[role="radiogroup"]').count(), 4)
    page.locator(".swatch-holder input").nth(0).check()
    page.wait_for_timeout(500)
    check("the choice is in the URL", "material=VM-2041" in page.url, True)
    page.locator(".swatch-holder input").nth(11).check()
    page.wait_for_timeout(500)
    checked = page.locator(".swatch-holder input:checked").count()
    check("one choice across the library", checked, 1)
    # the tray holds four
    for i in range(5):
        page.locator(".swatch-holder input").nth(i).check()
        page.wait_for_timeout(120)
        page.click("#add-to-compare")
        page.wait_for_timeout(120)
    check("tray holds four", page.locator("#compare-list li").count(), 4)
    check("fifth announces F-32", page.locator("#announcements").inner_text(), "The tray holds four. Take one out first.")

    # the bench
    page.goto(f"{BASE}/bench")
    page.wait_for_selector('[data-part="job-card"]')
    check("two seeded jobs", page.locator('[data-part="job-card"]').count(), 2)
    check("grid name", page.get_attribute('[role="grid"]', "aria-label"), "Bench week")
    check("one roving Tab stop", page.locator('[role="gridcell"][tabindex="0"]').count(), 1)
    card = page.locator('[data-part="job-card"]').first
    job = card.get_attribute("data-job")
    card.focus()
    page.keyboard.press("Alt+ArrowRight")
    page.wait_for_timeout(900)
    check("focus stays on the card", page.evaluate("document.activeElement.dataset.job"), job)
    check("move announced", "moved to Frame bench on" in page.locator("#announcements").inner_text(), True)

    # the dossier
    page.goto(f"{BASE}/pieces/6/dossier")
    page.wait_for_selector('[data-part="dossier-step"]')
    states = page.locator('[data-part="dossier-step"]').evaluate_all("els => els.map(e => e.dataset.state)")
    check("strip follows the server", states, ["done", "done", "done"])
    check("download shows once stored", page.locator('a[download]').is_visible(), True)

    # change password dialog keeps Tab inside and returns focus
    page.goto(f"{BASE}/pieces")
    page.click("#change-password")
    page.wait_for_selector('[role="dialog"]')
    check("dialog name", page.get_attribute('[role="dialog"]', "aria-label"), "Change password")
    check("focus moved to the first field", page.evaluate("document.activeElement.id"), "current-password")
    for _ in range(6):
        page.keyboard.press("Tab")
    inside = page.evaluate("!!document.activeElement.closest('[role=\"dialog\"]')")
    check("Tab stays inside the dialog", inside, True)
    page.keyboard.press("Escape")
    page.wait_for_timeout(500)
    check("focus returns to the opener", page.evaluate("document.activeElement.id"), "change-password")

    # ---------------------------------------------------- the client page
    api = desktop.request
    answer = api.post(f"{BASE}/api/pieces/4/client-page", data={}).json()
    token = answer["clientPage"]["address"].rsplit("/", 1)[-1]
    japanese = browser.new_context(viewport={"width": 375, "height": 812}, locale="de-DE", timezone_id="Pacific/Auckland")
    jp = japanese.new_page()
    jp.goto(f"{BASE}/c/{token}")
    check("client page lang", jp.evaluate("document.documentElement.lang"), "ja")
    check("client page heading", jp.locator("h1").inner_text(), "お預かりの品")
    check("announcements named in the language", jp.get_attribute("#announcements", "aria-label"), "お知らせ")
    check("main action toolbar named", jp.get_attribute('[role="toolbar"]', "aria-label"), "主な操作")
    jp.click("#your-answer")
    jp.wait_for_selector('[role="dialog"]')
    check("sheet name", jp.get_attribute('[role="dialog"]', "aria-label"), "あなたの回答")
    jp.fill("#answer-height", "４４．５")
    jp.click("text=回答を送信する")
    jp.wait_for_timeout(800)
    check("full-width digits accepted", jp.locator("#announcements").inner_text(), "回答を修復担当者に届けました。")
    japanese.close()

    arabic_answer = api.post(f"{BASE}/api/pieces/5/client-page", data={}).json()
    ar_token = arabic_answer["clientPage"]["address"].rsplit("/", 1)[-1]
    arabic = browser.new_context(viewport={"width": 375, "height": 812})
    ar = arabic.new_page()
    ar.goto(f"{BASE}/c/{ar_token}")
    check("arabic dir", ar.evaluate("document.documentElement.dir"), "rtl")
    check("arabic heading", ar.locator("h1").inner_text(), "قطعتك")
    arabic.close()

    # ------------------------------------------------- no sideways scroll
    for width, height in [(375, 812), (768, 1024), (1280, 800), (320, 568)]:
        narrow = browser.new_context(viewport={"width": width, "height": height})
        np = narrow.new_page()
        for path in ["/", "/work", "/work/bentwood-armchair", "/enquire", "/sign-in"]:
            np.goto(BASE + path)
            over = np.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            check(f"no sideways scroll {width} {path}", over, False)
        narrow.close()

    phone = browser.new_context(viewport={"width": 375, "height": 812})
    pp = phone.new_page()
    pp.goto(f"{BASE}/sign-in")
    pp.fill("#sign-in-email", "agnese@bottega-semenza.example")
    pp.fill("#sign-in-password", "tacks-and-hide-2027")
    pp.click("#sign-in-submit")
    pp.wait_for_url(f"{BASE}/pieces")
    for path in ["/pieces", "/pieces/1", "/pieces/1/condition", "/pieces/1/hide", "/pieces/1/estimate",
                 "/clients", "/library", "/bench", "/workbook", "/rates"]:
        pp.goto(BASE + path)
        pp.wait_for_timeout(600)
        over = pp.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        check(f"no sideways scroll 375 {path}", over, False)
    pp.goto(f"{BASE}/pieces")
    pp.wait_for_timeout(500)
    check("bottom bar at 375", pp.locator('[role="toolbar"][aria-label="Main action"]').is_visible(), True)
    check("Menu button at 375", pp.locator("#menu-button").is_visible(), True)
    pp.goto(f"{BASE}/pieces/1/hide")
    pp.wait_for_timeout(600)
    check("hide bar at 375", pp.get_attribute('[role="toolbar"]', "aria-label"), "Hide controls")
    check("hide bar has every control", pp.locator('[role="toolbar"] button').count(), 14)
    phone.close()

    check("no page errors", errors, [])
    browser.close()


with sync_playwright() as p:
    run(p)

print()
print(f"{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
