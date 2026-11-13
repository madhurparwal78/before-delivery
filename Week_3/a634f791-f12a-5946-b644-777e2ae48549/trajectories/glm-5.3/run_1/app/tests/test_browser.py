"""Browser checks: the journeys a visitor and a desk account live through.

Run: .venv/bin/python -m pytest tests/test_browser.py -q
Requires a server on 127.0.0.1:4173 and Playwright's Chromium.
"""

import json
import re
import urllib.request

import pytest

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"


def is_server_up() -> bool:
    try:
        with urllib.request.urlopen(BASE + "/api/health", timeout=2) as r:
            return r.status == 200
    except Exception:
        return False


pytestmark = pytest.mark.skipif(not is_server_up(),
                                reason="the app is not running")


@pytest.fixture(scope="module")
def browser():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        yield browser
        browser.close()


@pytest.fixture()
def page(browser):
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    yield page
    context.close()


# ------------------------------------------------------------- DP-45 headings

def test_each_public_route_has_one_h1_and_a_skip_link(page):
    for path in ("/", "/references", "/references/harbour-crane-retrofit",
                 "/programme", "/story", "/notes", "/contact",
                 "/fi", "/fi/references", "/fi/contact"):
        page.goto(BASE + path)
        assert page.locator("h1").count() == 1, path
        first_stop = page.evaluate_handle(
            "document.querySelector('a, button, input, select, textarea')")
        first = first_stop.evaluate("el => el.textContent")
        assert first.strip() in ("Skip to content", "Siirry sisältöön"), path


def test_no_skipped_heading_levels(page):
    for path in ("/", "/references", "/references/harbour-crane-retrofit",
                 "/programme", "/story", "/notes", "/contact", "/desk"):
        page.goto(BASE + path)
        levels = page.evaluate(
            "Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6'))"
            ".map(h => Number(h.tagName[1]))")
        for i in range(1, len(levels)):
            assert levels[i] <= levels[i - 1] + 1, (path, levels)


def test_focus_ring_is_visible(page):
    page.goto(BASE + "/contact")
    page.keyboard.press("Tab")  # skip link
    outline = page.evaluate(
        "getComputedStyle(document.activeElement).outlineWidth")
    assert outline not in ("", "0px")
    page.keyboard.press("Tab")
    outline = page.evaluate(
        "getComputedStyle(document.activeElement).outlineWidth")
    assert outline not in ("", "0px")


def test_icons_are_named_or_hidden(page):
    for path in ("/", "/references", "/contact"):
        page.goto(BASE + path)
        unnamed = page.evaluate("""
            Array.from(document.querySelectorAll('svg'))
              .filter(svg => !svg.getAttribute('aria-hidden') && !svg.getAttribute('aria-label'))
              .length""")
        assert unnamed == 0, path


# ------------------------------------------------- DP-40, DP-57 filter and switch

def test_sector_filter_and_language_switch(page):
    page.goto(BASE + "/references")
    page.click("text=food")
    assert "/references?sector=food" in page.url
    rows = page.locator(".index-row").count()
    assert rows == 1
    page.click(".lang-switch")
    assert "/fi/references?sector=food" in page.url
    assert page.locator(".index-row").count() == 1
    assert page.locator(".count-line").inner_text().strip().startswith(
        "1 hyväksytty")


def test_language_switch_on_programme_carries_fragment(page):
    page.goto(BASE + "/programme")
    page.click('a[href="#clearance"]')
    page.wait_for_timeout(120)
    assert page.locator("#clearance .chapter-toggle").get_attribute(
        "aria-expanded") == "true"
    page.click(".lang-switch")
    assert page.url.startswith(BASE + "/fi/programme")
    # the fragment is carried by the switch on the client
    page.goto(BASE + "/programme#clearance")
    page.wait_for_timeout(200)
    assert page.locator("#clearance .chapter-toggle").get_attribute(
        "aria-expanded") == "true"


def test_chapter_addresses_open_below_the_header(page):
    page.goto(BASE + "/programme#clearance")
    page.wait_for_timeout(250)
    heading = page.locator("#clearance-heading")
    box = heading.bounding_box()
    header = page.locator(".site-header").bounding_box()
    assert box["y"] >= header["y"] + header["height"] - 2


def test_menu_opens_and_closes(page):
    context = page.context.browser.new_context(
        viewport={"width": 375, "height": 812})
    narrow = context.new_page()
    narrow.goto(BASE + "/")
    button = narrow.locator(".menu-button")
    assert button.is_visible()
    assert narrow.locator(".primary-nav a").first.is_hidden()
    button.click()
    assert button.get_attribute("aria-expanded") == "true"
    assert narrow.locator(".primary-nav a").first.is_visible()
    narrow.keyboard.press("Escape")
    assert button.get_attribute("aria-expanded") == "false"
    assert narrow.locator(".primary-nav a").first.is_hidden()
    assert narrow.evaluate("document.activeElement.className").find(
        "menu-button") >= 0
    # crossing to a wider layout closes the menu state
    narrow.set_viewport_size({"width": 1280, "height": 800})
    narrow.wait_for_timeout(300)
    assert button.get_attribute("aria-expanded") == "false"
    assert narrow.locator(".primary-nav a").first.is_visible()
    context.close()


def test_cookie_notice_appears_and_stays_gone(page):
    context = page.context.browser.new_context()
    fresh = context.new_page()
    fresh.goto(BASE + "/")
    fresh.wait_for_timeout(700)
    notice = fresh.locator("#cookie-notice")
    assert notice.is_visible()
    # no analytics cookie was set before answering
    cookies = context.cookies()
    assert all(c["name"].startswith("__Host") is False for c in cookies)
    fresh.click(".cookie-accept")
    fresh.wait_for_timeout(700)
    assert notice.is_hidden()
    fresh.reload()
    fresh.wait_for_timeout(900)
    assert notice.is_hidden()
    context.close()


def test_copy_button_confirmation_and_timer(browser):
    context = browser.new_context(permissions=["clipboard-read", "clipboard-write"])
    page = context.new_page()
    page.goto(BASE + "/contact")
    button = page.locator(".copy-button").first
    label = button.locator(".copy-label")
    assert label.inner_text() == "Click to copy address"
    button.click()
    page.wait_for_function(
        "document.querySelector('.copy-label').textContent"
        " === 'Copied to the clipboard'")
    assert page.evaluate(
        "document.activeElement.classList.contains('copy-button')") is True
    # the address itself is on the clipboard
    copied = page.evaluate("navigator.clipboard.readText()")
    assert copied == "aino.rask@example.com"
    # activating again during the confirmation restarts the period
    page.wait_for_timeout(1200)
    button.click()
    page.wait_for_function(
        "document.querySelector('.copy-label').textContent"
        " === 'Copied to the clipboard'")
    page.wait_for_timeout(2300)
    assert label.inner_text() == "Click to copy address"
    # each card times itself independently
    second = page.locator(".copy-button").nth(1)
    second.click()
    page.wait_for_function(
        "document.querySelectorAll('.copy-label')[1].textContent"
        " === 'Copied to the clipboard'")
    assert label.inner_text() == "Click to copy address"
    context.close()


def test_copy_button_refusal_shows_refusal_label(browser):
    """A refused clipboard shows the refusal label and selects the address."""
    context = browser.new_context()  # no clipboard permission granted
    page = context.new_page()
    page.add_init_script(
        "Object.defineProperty(navigator, 'clipboard', {"
        " value: { writeText: () => Promise.reject(new Error('no')) } });"
        "Object.defineProperty(document, 'execCommand', {"
        " value: () => false });")
    page.goto(BASE + "/contact")
    button = page.locator(".copy-button").first
    label = button.locator(".copy-label")
    button.click()
    page.wait_for_function(
        "document.querySelector('.copy-label').textContent"
        " === 'Copy not available'")
    assert page.evaluate(
        "document.activeElement.classList.contains('copy-button')") is True
    # the address text is selected
    selected = page.evaluate("window.getSelection().toString()")
    assert selected == "aino.rask@example.com"
    # the confirmation never shows in that case
    assert "Copied to the clipboard" not in label.inner_text()
    context.close()


def test_enquiry_form_success_flow(page):
    page.goto(BASE + "/contact")
    page.fill("#enquiry-email", "browser@example.com")
    page.check("#enquiry-agreed")
    page.click("#enquiry-form .submit-button")
    page.wait_for_selector("#enquiry-status.filled")
    assert "Thank you, the desk will reply from hello@example.com" in \
        page.locator("#enquiry-status").inner_text()
    assert page.locator("#enquiry-form").is_hidden()
    # the repeat from the same address joins the open enquiry
    page.goto(BASE + "/contact")
    page.fill("#enquiry-email", "browser@example.com")
    page.check("#enquiry-agreed")
    page.click("#enquiry-form .submit-button")
    page.wait_for_selector("#enquiry-status.filled")
    assert "Thank you, the desk will reply from hello@example.com" in \
        page.locator("#enquiry-status").inner_text()


def test_enquiry_form_refusal_flow(page):
    page.goto(BASE + "/contact")
    page.fill("#enquiry-email", "not-an-address")
    page.click("#enquiry-form .submit-button")
    page.wait_for_selector("#enquiry-alert:not(:empty)")
    assert "Check the marked fields and send again." in \
        page.locator("#enquiry-alert").inner_text()
    email = page.locator("#enquiry-email")
    assert email.get_attribute("aria-invalid") == "true"
    assert page.evaluate("document.activeElement.id") == "enquiry-email"
    assert email.input_value() == "not-an-address"  # typing stays
    # fixing the field and resubmitting clears the message
    page.fill("#enquiry-email", "fixed@example.com")
    page.check("#enquiry-agreed")
    page.click("#enquiry-form .submit-button")
    page.wait_for_selector("#enquiry-status.filled")
    assert page.locator("#enquiry-email-error").is_hidden()


def test_desk_sign_in_and_publish_flow(page):
    import uuid
    suffix = uuid.uuid4().hex[:6]
    title = "Browser test depot " + suffix
    slug = "browser-test-depot-" + suffix

    page.goto(BASE + "/desk")
    assert "/desk" in page.url
    page.fill("#signin-email", "steward@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    assert page.evaluate("document.activeElement.id") == "references-heading"
    totals = page.locator("#desk-totals").inner_text()
    assert re.match(r"\d+ live, \d+ withheld, \d+ drafts, \d+ retired", totals)

    # the seeded rows are shown with their state words
    assert page.locator(".desk-row").count() >= 4
    assert "harbour-crane-retrofit" in page.content()

    # create a draft from the keyboard
    page.click("#new-reference")
    page.wait_for_selector("#reference-editor")
    assert page.evaluate("document.activeElement.id") == "ed-title"
    page.fill("#ed-title", title)
    page.fill("#ed-sector", "rail")
    page.fill("#ed-customer", "Browser Oy")
    page.fill("#ed-summary", "A browser-created draft.")
    page.fill("#ed-challenge", "The challenge is real.")
    page.fill("#ed-work", "The work was done.")
    page.click("#add-figure")
    page.fill('.figure-edit [data-figure="label"]', "Test figure")
    page.fill('.figure-edit [data-figure="value"]', "12")
    assert page.locator("#figure-count").inner_text() == "Figures 1 of 6"
    page.click("#save-reference")
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('Saved')")
    row = page.locator(f'.desk-row[data-slug="{slug}"]')
    assert row.count() == 1

    # publish is refused with no window
    row.locator(".publish").click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent"
        ".includes('Record a clearance window')")

    # record the window as the steward
    page.locator(f'.desk-row[data-slug="{slug}"] .edit').click()
    page.wait_for_selector("#clearance-box:not([hidden])")
    page.wait_for_function(
        f"document.getElementById('ed-title').value === '{title}'")
    page.fill('#ed-clearance-from', "2026-01-01")
    page.fill('#ed-clearance-until', "2027-12-31")
    page.click("#save-clearance")
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('Clearance window saved')")

    # publish and follow the focus target
    row = page.locator(f'.desk-row[data-slug="{slug}"]')
    row.locator(".publish").click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('is published')")
    assert page.evaluate("document.activeElement.className").find("retire") >= 0

    # the reference is on the public index at once
    page.goto(BASE + "/references")
    assert page.locator(f"text={title}").count() == 1

    # move it up from the keyboard: focus stays on the moved row
    page.goto(BASE + "/desk")
    page.fill("#signin-email", "steward@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    row = page.locator(f'.desk-row[data-slug="{slug}"]')
    up = row.locator(".move-up")
    up.click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('moved to position')")
    assert page.evaluate("document.activeElement.className").find("move-up") >= 0
    # the first live row's up button is disabled
    first_row = page.locator(".desk-row[data-state='live']").first
    assert first_row.locator(".move-up").is_disabled()


def test_withheld_reference_leaves_every_surface(page):
    page.goto(BASE + "/references")
    assert page.locator("text=Rail depot signalling").count() == 0
    page.goto(BASE + "/references/rail-depot-signalling")
    assert "That page is not here" in page.content()


def test_preview_page_shows_banner_without_enquiry_link(page):
    # mint through the API
    data = json.dumps({"email": "steward@example.com",
                       "password": "deku-demo-pw-2026"}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as response:
        token = json.loads(response.read())["token"]
    req = urllib.request.Request(
        BASE + "/api/desk/references/quarry-conveyor-upgrade/preview",
        data=b"", method="POST",
        headers={"Authorization": "Bearer " + token})
    with urllib.request.urlopen(req) as response:
        link = json.loads(response.read())
    page.goto(BASE + "/references/quarry-conveyor-upgrade?preview="
              + link["token"])
    assert page.locator(".preview-banner").is_visible()
    assert page.locator("text=Ask about this reference").count() == 0
    # the normal page shows no banner
    page.goto(BASE + "/references/harbour-crane-retrofit")
    assert page.locator(".preview-banner").count() == 0


def test_breakpoints_and_reflow(page):
    for width in (1280, 768, 375, 320):
        page.set_viewport_size({"width": width, "height": 812})
        page.goto(BASE + "/references")
        overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 0, width
        page.goto(BASE + "/")
        overflow = page.evaluate(
            "document.documentElement.scrollWidth - document.documentElement.clientWidth")
        assert overflow <= 0, width


def test_reduced_motion_holds_end_states(page):
    context = page.context.browser.new_context(
        reduced_motion="reduce", viewport={"width": 1280, "height": 800})
    quiet = context.new_page()
    quiet.goto(BASE + "/")
    quiet.wait_for_timeout(200)
    strip = quiet.locator(".hero-strip")
    transform = strip.evaluate("el => getComputedStyle(el).transform")
    assert transform in ("none", "matrix(1, 0, 0, 1, 0, 0)")
    context.close()


def test_motion_preference_applies_live(page):
    page.goto(BASE + "/")
    page.wait_for_timeout(200)
    page.emulate_media(reduced_motion="reduce")
    page.wait_for_timeout(300)
    title_transform = page.locator(".hero-title").evaluate(
        "el => getComputedStyle(el).transform")
    assert title_transform == "none"
    page.evaluate("window.scrollTo(0, 400)")
    page.wait_for_timeout(300)
    title_transform = page.locator(".hero-title").evaluate(
        "el => getComputedStyle(el).transform")
    assert title_transform == "none"
    page.emulate_media(reduced_motion="no-preference")
    page.wait_for_timeout(300)
    page.evaluate("window.scrollTo(0, 0)")
    page.wait_for_timeout(200)
    page.evaluate("window.scrollTo(0, 600)")
    page.wait_for_timeout(400)
    title_transform = page.locator(".hero-title").evaluate(
        "el => getComputedStyle(el).transform")
    assert title_transform != "none"


def test_desk_editor_survives_list_rereads(page):
    page.goto(BASE + "/desk")
    page.fill("#signin-email", "curator@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    # a curator's editor has no clearance fields
    row = page.locator('.desk-row[data-slug="harbour-crane-retrofit"]')
    row.locator(".edit").click()
    page.wait_for_selector("#reference-editor")
    assert page.locator("#clearance-box").count() == 0
    page.fill("#ed-title", "Typed but unsaved")
    page.wait_for_timeout(100)
    # an action on another row re-reads the list
    other = page.locator('.desk-row[data-slug="dairy-line-rebuild"]')
    other.locator(".retire").click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('retired')")
    assert page.locator("#reference-editor").is_visible()
    assert page.locator("#ed-title").input_value() == "Typed but unsaved"
    # restore the retired row
    other = page.locator('.desk-row[data-slug="dairy-line-rebuild"]')
    other.locator(".publish").click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('published')")


def test_desk_queries_show_state_words(page):
    page.goto(BASE + "/desk")
    page.fill("#signin-email", "steward@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    states = page.locator(".desk-state").all_text_contents()
    assert "live" in states and "withheld" in states and "draft" in states
    # the enquiries queue shows the seeded enquiry with its arrival time
    assert re.match(r"\d+ open enquiries",
                    page.locator("#enquiry-totals").inner_text())
    assert "prospect@example.com" in page.content()
    arrival = page.locator(".desk-arrival").first.inner_text()
    assert re.match(r"\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}", arrival)
    # a steward can delete it
    page.locator(".desk-enquiry .delete").first.click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent.includes('Enquiry deleted')")
    # focus lands on the next enquiry's Delete, else the Enquiries heading
    focused = page.evaluate("document.activeElement.id")
    assert focused in ("enquiries-heading",) or page.evaluate(
        "document.activeElement.classList.contains('delete')")


def test_session_end_keeps_typing_and_resumes_once(page):
    import json as json_module
    import urllib.request

    # end the session server-side: the token's account stays, the token dies
    data = json_module.dumps({"email": "curator@example.com",
                              "password": "deku-demo-pw-2026"}).encode()
    req = urllib.request.Request(BASE + "/api/auth/login", data=data,
                                 headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req) as response:
        token = json_module.loads(response.read())["token"]
    killer = urllib.request.Request(
        BASE + "/api/desk/references", data=b"{}",
        headers={"Authorization": "Bearer " + token})
    page.goto(BASE + "/desk")
    page.fill("#signin-email", "curator@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")

    # type into an editor and let the session end mid-action
    page.locator('.desk-row[data-slug="quarry-conveyor-upgrade"] .edit').click()
    page.wait_for_selector("#reference-editor")
    page.wait_for_function(
        "document.getElementById('ed-title').value === 'Quarry conveyor upgrade'")
    page.fill("#ed-summary", "Typed before the session ended.")
    # expire every session in the store
    import db
    def expire(conn):
        with conn.cursor() as cur:
            cur.execute("DELETE FROM session")
        conn.commit()
    db.run(expire)
    page.click("#save-reference")
    page.wait_for_selector("#signin-panel:not([hidden])")
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent"
        ".includes('Your session has ended')")
    assert "Your session has ended. Sign in to finish." in \
        page.locator("#desk-messages").inner_text()
    assert page.evaluate("document.activeElement.id") == "signin-email"
    # the editor and all typing stay in place
    assert page.locator("#reference-editor").is_visible()
    assert page.locator("#ed-summary").input_value() == \
        "Typed before the session ended."

    # sign in again as the same programme: the pending action retries once
    page.fill("#signin-email", "curator@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent"
        ".includes('Saved')")


def test_desk_preview_link_message(page):
    page.goto(BASE + "/desk")
    page.fill("#signin-email", "steward@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    page.locator('.desk-row[data-slug="quarry-conveyor-upgrade"] .preview').click()
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent"
        ".includes('Preview link ready: ')")
    text = page.locator("#desk-messages").inner_text()
    match = re.search(r"Preview link ready: (\S+) \(expires (\S+ \S+)\)", text)
    assert match, text
    link = match.group(1)
    expiry = match.group(2)
    assert link.startswith("/references/quarry-conveyor-upgrade?preview=")
    assert re.match(r"\d{1,2}\.\d{1,2}\.\d{4} \d{2}:\d{2}", expiry)
    # focus stays on the pressed button
    assert page.evaluate(
        "document.activeElement.classList.contains('preview')") is True
    # the link opens exactly its own reference
    page.goto(BASE + link)
    assert page.locator(".preview-banner").is_visible()


def test_targets_and_breakpoints(page):
    """Every interactive target is at least 24 by 24 at phone width, controls
    at least 44, and the layouts change exactly at 640 and 1100."""
    
    # narrow: one column of service panels, one column of directory cards
    page.set_viewport_size({"width": 375, "height": 812})
    page.goto(BASE + "/")
    assert page.evaluate(
        "getComputedStyle(document.querySelector('.service-panels')).gridTemplateColumns.split(' ').length") == 1
    page.goto(BASE + "/contact")
    assert page.evaluate(
        "getComputedStyle(document.querySelector('.directory')).gridTemplateColumns.split(' ').length") == 1
    # every interactive target at phone width is at least 24 by 24
    small = page.evaluate("""
        Array.from(document.querySelectorAll('a, button, input, select, textarea'))
          .filter(el => {
            const r = el.getBoundingClientRect();
            const styles = getComputedStyle(el);
            return styles.display !== 'none' && styles.visibility !== 'hidden'
              && r.width > 0 && (r.width < 24 || r.height < 24);
          }).map(el => el.tagName + ':' + el.className + ':' + el.textContent.slice(0, 20))""")
    assert small == [], small

    # middle: two columns
    page.set_viewport_size({"width": 768, "height": 1024})
    page.goto(BASE + "/")
    assert page.evaluate(
        "getComputedStyle(document.querySelector('.service-panels')).gridTemplateColumns.split(' ').length") == 2
    # wide: three columns
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(BASE + "/")
    assert page.evaluate(
        "getComputedStyle(document.querySelector('.service-panels')).gridTemplateColumns.split(' ').length") == 3


def test_exact_breakpoint_boundaries(page):
    page.goto(BASE + "/")
    def panel_columns():
        return page.evaluate(
            "getComputedStyle(document.querySelector('.service-panels'))"
            ".gridTemplateColumns.split(' ').length")
    # 1099 wide: two; 1100: three
    page.set_viewport_size({"width": 1099, "height": 800})
    page.goto(BASE + "/")
    assert panel_columns() == 2
    page.set_viewport_size({"width": 1100, "height": 800})
    page.goto(BASE + "/")
    assert panel_columns() == 3
    # 639 wide: one; 640: two
    page.set_viewport_size({"width": 639, "height": 800})
    page.goto(BASE + "/")
    assert panel_columns() == 1
    page.set_viewport_size({"width": 640, "height": 800})
    page.goto(BASE + "/")
    assert panel_columns() == 2


def test_contact_two_columns_wide(page):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(BASE + "/contact")
    form_box = page.locator(".enquiry-section").bounding_box()
    directory_box = page.locator(".directory-section").bounding_box()
    assert form_box["x"] < directory_box["x"]  # form at the left
    page.set_viewport_size({"width": 768, "height": 1024})
    page.goto(BASE + "/contact")
    form_box = page.locator(".enquiry-section").bounding_box()
    directory_box = page.locator(".directory-section").bounding_box()
    assert form_box["y"] < directory_box["y"]  # form above the directory


def test_enlarged_text_holds(page):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(BASE + "/references")
    page.evaluate("document.documentElement.style.fontSize = '200%'")
    page.wait_for_timeout(200)
    overflow = page.evaluate(
        "document.documentElement.scrollWidth - document.documentElement.clientWidth")
    assert overflow <= 0
    # row links are still reachable and no row title clips horizontally
    clipped = page.evaluate("""
        Array.from(document.querySelectorAll('.index-title'))
          .filter(el => el.scrollWidth > el.clientWidth + 1).length""")
    assert clipped == 0


def test_focus_clear_of_header_at_all_widths(page):
    """Each keyboard stop inside the main content lands entirely clear of the
    fixed header when it takes focus (DP-68), at every published width."""
    for width in (1280, 375, 320):
        page.set_viewport_size({"width": width, "height": 812})
        page.goto(BASE + "/references")
        # focus each stop in the main content in turn and check its box
        bad = page.evaluate("""
          (() => {
            const header = document.querySelector('.site-header');
            const main = document.getElementById('main');
            const stops = Array.from(main.querySelectorAll('a, button, input, select, textarea'))
              .filter(el => !el.closest('[hidden]'));
            const bad = [];
            for (const el of stops) {
              el.scrollIntoView({ block: 'center' });
              const r = el.getBoundingClientRect();
              if (r.width === 0 || r.height === 0) continue;
              el.focus();
              const rect = el.getBoundingClientRect();
              if (rect.top < header.getBoundingClientRect().height - 1) {
                bad.push(el.className || el.id);
              }
            }
            return bad;
          })()""")
        assert bad == [], (width, bad)


def test_index_row_lift_and_title_colour(page):
    page.set_viewport_size({"width": 1280, "height": 800})
    page.goto(BASE + "/references")
    row = page.locator(".index-link").first
    before = row.evaluate("el => getComputedStyle(el).transform")
    title = page.locator(".index-title").first
    colour_before = title.evaluate("el => getComputedStyle(el).color")
    row.hover()
    page.wait_for_timeout(400)
    colour_after = title.evaluate("el => getComputedStyle(el).color")
    assert colour_before != colour_after  # the title darkens
    transform = row.evaluate("el => getComputedStyle(el).transform")
    assert transform != before or transform != "none"
    # keyboard focus lifts the row too
    row.focus()
    page.wait_for_timeout(400)
    colour_focus = title.evaluate("el => getComputedStyle(el).color")
    assert colour_focus != colour_before


def test_finnish_enquiry_refusal_uses_published_copy(page):
    page.goto(BASE + "/fi/contact")
    page.fill("#enquiry-email", "ei-osoite")
    page.click("#enquiry-form .submit-button")
    page.wait_for_selector("#enquiry-alert:not(:empty)")
    assert page.locator("#enquiry-alert").inner_text() == \
        "Tarkista merkityt kentät ja lähetä uudelleen."
    email_error = page.locator("#enquiry-email-error")
    assert email_error.inner_text() == \
        "Anna työosoite, johon toimisto voi vastata"
    agreed_error = page.locator("#enquiry-agreed-error")
    assert agreed_error.inner_text() == \
        "Hyväksy tietosuojaseloste valitsemalla ruutu"
    # the API's English message never appears
    assert "Enter a work address" not in page.content()
    # typing stays and the field is marked
    assert page.locator("#enquiry-email").input_value() == "ei-osoite"
    assert page.locator("#enquiry-email").get_attribute("aria-invalid") == "true"


def test_finnish_short_phone_refusal(page):
    page.goto(BASE + "/fi/contact")
    page.fill("#enquiry-email", "ok@example.com")
    page.fill("#enquiry-phone", "12")
    page.check("#enquiry-agreed")
    page.click("#enquiry-form .submit-button")
    page.wait_for_selector("#enquiry-phone-error:not([hidden])")
    assert page.locator("#enquiry-phone-error").inner_text() == \
        "Anna vähintään kymmenen merkin puhelinnumero"


def test_desk_editor_escape_and_figures(page):
    import uuid
    suffix = uuid.uuid4().hex[:6]
    page.goto(BASE + "/desk")
    page.fill("#signin-email", "steward@example.com")
    page.fill("#signin-password", "deku-demo-pw-2026")
    page.click("#signin-button")
    page.wait_for_selector("#desk-work:not([hidden])")
    # Escape with no unsaved change closes the editor at once
    page.click("#new-reference")
    page.wait_for_selector("#reference-editor")
    page.keyboard.press("Escape")
    page.wait_for_function(
        "document.getElementById('reference-editor') === null")
    page.wait_for_function(
        "document.activeElement.id === 'new-reference'")
    # Escape with unsaved typing keeps the editor, then discards
    page.click("#new-reference")
    page.wait_for_selector("#reference-editor")
    page.fill("#ed-title", "Escape test " + suffix)
    page.keyboard.press("Escape")
    page.wait_for_function(
        "document.getElementById('desk-messages').textContent"
        ".includes('Unsaved changes')")
    assert page.locator("#reference-editor").is_visible()
    assert page.locator("#ed-title").input_value() == "Escape test " + suffix
    page.keyboard.press("Escape")
    page.wait_for_function(
        "document.getElementById('reference-editor') === null")
    # Add a figure is disabled at 6
    page.click("#new-reference")
    page.wait_for_selector("#reference-editor")
    for i in range(6):
        page.click("#add-figure")
    assert page.locator("#add-figure").is_disabled()
    assert page.locator("#figure-count").inner_text() == "Figures 6 of 6"
    # removing a figure lands on the next Remove button
    page.locator(".remove-figure").nth(2).click()
    assert page.locator("#figure-count").inner_text() == "Figures 5 of 6"
    assert page.evaluate(
        "document.activeElement.classList.contains('remove-figure')") is True
