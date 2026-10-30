"""Browser-level verification of the Ivo Kastrel journeys with Playwright."""
import sys
import json
import urllib.request
import urllib.error
import uuid
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
passed = failed = 0


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
    else:
        failed += 1
        print(f"FAIL: {name} {detail}")


def main():
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        context = browser.new_context(viewport={"width": 1280, "height": 800})
        page = context.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.on("console", lambda m: errors.append(m.text) if m.type == "error" else None)

        # ---------------- journey 1: first look
        page.goto(BASE + "/", wait_until="networkidle")
        check("home title", page.title() == "Ivo Kastrel - Front-End Developer, UI/UX Designer and 3D Web Developer",
              page.title())
        check("lang en", page.eval_on_selector("html", "el => el.lang") == "en")
        check("viewport meta", page.query_selector('meta[name="viewport"][content="width=device-width, initial-scale=1"]') is not None)
        check("description meta", page.query_selector('meta[name="description"]') is not None)
        anchors = ["hero", "about", "services", "work", "process", "journal", "awards", "contact"]
        for anchor in anchors:
            check(f"chapter #{anchor}", page.query_selector(f"#{anchor}") is not None)
        check("hero statement", "IT WAS ALWAYS GOING TO BE THIS WAY" in page.inner_text(".hero-statement"))
        check("figures band present", page.locator(".figure-value").count() == 3)
        check("3D WEB capability list", page.inner_text(".service-card:nth-child(2) .capability-list")
              == "Frontend Engineering\nThree.js / WebGL\nGSAP Animation\nPerformance Optimization")
        check("four process steps", page.locator(".process-steps li").count() == 4)
        check("three journal entries on home", page.locator(".journal-card").count() == 3)
        check("three recognitions", page.locator(".award-card").count() == 3)
        check("featured list links to case studies", page.locator(".featured-item a").count() >= 1)

        # intro cover (DP-56)
        cover = page.query_selector("[data-intro-cover]")
        check("intro cover appears on first page", cover is not None and cover.is_visible())
        page.wait_for_timeout(2200)
        cover = page.query_selector("[data-intro-cover]")
        check("intro cover gone within three seconds", cover is None or not cover.is_visible())
        page.goto(BASE + "/work", wait_until="networkidle")
        check("no cover on next page", page.query_selector("[data-intro-cover]") is None)

        # ---------------- journey 2: filtering
        page.goto(BASE + "/work", wait_until="networkidle")
        check("work page five cards", page.locator(".work-card").count() == 5)
        check("ordinals 01..05",
              page.eval_on_selector_all(".card-ordinal", "els => els.map(e => e.textContent)")
              == ["01", "02", "03", "04", "05"])
        page.click(".discipline-filter a:has-text('3D WEB')")
        page.wait_for_timeout(600)
        check("address follows 3D WEB", "discipline=3d-web" in page.url, page.url)
        check("3D WEB list two cards", page.locator(".work-card").count() == 2,
              page.locator(".work-card").count())
        check("filter keeps ordinals from full set",
              page.eval_on_selector_all(".card-ordinal", "els => els.map(e => e.textContent)") == ["01", "04"])
        check("aria-current moves", page.get_attribute(".discipline-filter a:has-text('3D WEB')", "aria-current") == "true")
        page.click(".discipline-filter a:has-text('UI/UX')")
        page.wait_for_timeout(600)
        check("address follows UI/UX", "discipline=ui-ux" in page.url, page.url)
        page.go_back()
        page.wait_for_timeout(800)
        check("back restores 3D WEB", "discipline=3d-web" in page.url, page.url)
        page.go_back()
        page.wait_for_timeout(800)
        check("second back shows All", page.url.rstrip("/").endswith("/work"), page.url)
        page.go_forward()
        page.wait_for_timeout(800)
        check("forward brings back 3D WEB", "discipline=3d-web" in page.url, page.url)

        # reload renders the same filtered page from the server (DP-37)
        page.reload(wait_until="networkidle")
        check("reload keeps filtered list", page.locator(".work-card").count() == 2)
        check("current marker survives reload",
              page.get_attribute(".discipline-filter a:has-text('3D WEB')", "aria-current") == "true")
        check("catalogue status announced",
              "2 case studies shown." in page.inner_text("[data-catalogue-status]"))
        page.goto(BASE + "/work?discipline=bogus")
        check("unknown discipline redirects to /work", page.url.rstrip("/") == BASE + "/work", page.url)

        # empty discipline (frontend has 1; use unpublished set to force empty via api? use ui-ux after unpublish later)
        # ---------------- case study page
        page.goto(BASE + "/work/hollow-signal", wait_until="networkidle")
        check("case page place line", "01 / 05" in page.inner_text(".case-place"))
        next_href = page.get_attribute(".case-neighbours a:has-text('Next')", "href")
        check("next link is ember-ledger", next_href == "/work/ember-ledger", next_href)
        check("all work link", page.get_attribute(".case-neighbours a:has-text('All work')", "href") == "/work")
        check("previous wraps to low-tide-radio",
              "Previous: Low Tide Radio" in page.inner_text(".case-neighbours"))
        check("case title in document title", "Hollow Signal - Ivo Kastrel" == page.title())

        # ---------------- journey 3: journal
        page.goto(BASE + "/journal", wait_until="networkidle")
        check("journal page three entries", page.locator(".journal-entry-card").count() == 3)
        page.click(".journal-entry-card a:has-text('Motion Beyond Animation')")
        page.wait_for_load_state("networkidle")
        check("journal entry title", page.title() == "Motion Beyond Animation - Ivo Kastrel", page.title())
        check("journal entry date format", "July 1, 2026" in page.inner_text(".entry-date"))
        check("body paragraphs", page.locator(".entry-paragraph").count() >= 3)
        check("all journal entries link", page.get_attribute(".back-link a", "href") == "/journal")
        status = fetch_status(BASE + "/journal/unfinished-light")
        check("future-dated entry page 404", status == 404, status)

        # ---------------- journey 4: inquiry panel
        page.goto(BASE + "/", wait_until="networkidle")
        page.click("[data-connect]")
        dialog = page.locator(".connect-panel")
        check("dialog opens", dialog.is_visible())
        check("focus moves to Name", page.evaluate("document.activeElement.name") == "name")
        page.keyboard.press("Tab")
        page.keyboard.press("Tab")
        active = page.evaluate("document.activeElement.name || document.activeElement.textContent")
        check("tab stays inside dialog (phone -> email)", active in ("phone", "email", "Message", "Project type"), active)
        # mistyped email
        page.fill("[data-dialog] [name='name']", "Vera Visitor")
        page.fill("[data-dialog] [name='phone']", "+64 21 555 0188")
        page.fill("[data-dialog] [name='email']", "vera@@example")
        page.fill("[data-dialog] [name='message']", "I would love a launch film like Hollow Signal.")
        page.click("[data-dialog] button[type='submit']")
        page.wait_for_timeout(800)
        check("email field error marked",
              "Enter a valid email address." in page.inner_text("[data-dialog] [data-field-message='email']"))
        check("error summary lists email", "email" in page.inner_text("[data-dialog] [data-inquiry-error-list]"))
        check("typed values kept", page.input_value("[data-dialog] [name='name']") == "Vera Visitor")
        # fix and submit
        page.fill("[data-dialog] [name='email']", "vera@example.com")
        page.click("[data-dialog] button[type='submit']")
        page.wait_for_timeout(900)
        status_text = page.inner_text("[data-dialog] [data-inquiry-status]")
        check("thanks in status region", "Thanks, your message is in." in status_text, status_text)
        check("thanks focused", page.evaluate(
            "document.activeElement.hasAttribute('data-inquiry-status')"))
        page.keyboard.press("Escape")
        page.wait_for_timeout(400)
        check("dialog closed after Escape", not page.locator(".connect-panel").is_visible())
        check("focus returned to Let's Connect",
              page.evaluate("document.activeElement.textContent") == "Let's Connect")
        page.click("[data-connect]")
        page.wait_for_timeout(300)
        check("reopened dialog shows empty form", page.input_value("[data-dialog] [name='name']") == "")

        # ---------------- journey 5: studio
        draft_slug = "browser-draft-" + uuid.uuid4().hex[:8]
        draft_title = "Browser Test Draft " + uuid.uuid4().hex[:4]
        cleanup_non_seed_case_studies()
        page.goto(BASE + "/studio/login", wait_until="networkidle")
        check("login page has fields", page.query_selector("#login-email") is not None)
        page.fill("#login-email", "owner@example.com")
        page.fill("#login-password", "wrong-password")
        page.click("button[type='submit']")
        page.wait_for_timeout(800)
        check("refused sign-in stays on page with reason",
              "Email or password is incorrect." in page.inner_text("[data-signin-errors]"))
        check("email kept after refusal", page.input_value("#login-email") == "owner@example.com")
        page.fill("#login-password", "deku-demo-pw-2026")
        page.click("button[type='submit']")
        page.wait_for_url("**/studio", timeout=8000)
        check("sign-in reaches /studio", page.url.rstrip("/") == BASE + "/studio", page.url)

        page.wait_for_timeout(1200)
        check("case studies pane", page.locator("[aria-label='Case studies']").count() == 1)
        check("inquiries pane", page.locator("[aria-label='Inquiries']").count() == 1)
        check("six case study rows", page.locator("[data-cases-rows] tr").count() == 6)
        check("studio table shows draft", "Draft" in page.inner_text("[data-cases-rows]"))
        check("editor hints present",
              "Up to 200 characters" in page.inner_text(".studio-editor"))
        check("slug hint", "Lowercase letters, digits and single hyphens, up to 64 characters"
              in page.inner_text(".studio-editor"))

        # create draft
        page.click("[data-create-draft]")
        page.wait_for_timeout(300)
        check("create mode button reads Save draft", page.inner_text("[data-editor-save]") == "Save draft", page.inner_text("[data-editor-save]"))
        page.fill("[name='title']", draft_title)
        page.fill("[name='slug']", draft_slug)
        page.fill("[name='year']", "2026")
        page.fill("[name='position']", "20")
        page.fill("[name='summary']", "A draft made in the browser.")
        page.fill("[name='outcome']", "A draft outcome for the browser.")
        page.click("[data-editor-save]")
        page.wait_for_timeout(1000)
        check("draft created status", "Draft created." in page.inner_text("[data-studio-status]"))
        check("new row appears marked Draft", draft_slug in page.inner_text("[data-cases-rows]"))
        # draft absent from /work
        page.goto(BASE + "/work", wait_until="networkidle")
        check("draft absent from /work", draft_title not in page.inner_text("body"))

        # publish from studio
        page.goto(BASE + "/studio", wait_until="networkidle")
        page.wait_for_timeout(1000)
        row = page.locator("[data-cases-rows] tr", has_text=draft_slug)
        row.locator("button", has_text="Publish").click()
        page.wait_for_timeout(1000)
        check("published status", "Published." in page.inner_text("[data-studio-status]"))
        page.goto(BASE + "/work", wait_until="networkidle")
        check("published draft lists on /work with next ordinal",
              draft_title in page.inner_text("body") and
              "06" in page.eval_on_selector_all(".card-ordinal", "els => els.map(e => e.textContent)"))
        # unpublish
        page.goto(BASE + "/studio", wait_until="networkidle")
        page.wait_for_timeout(1000)
        row = page.locator("[data-cases-rows] tr", has_text=draft_slug)
        row.locator("button", has_text="Unpublish").click()
        page.wait_for_timeout(1000)
        page.goto(BASE + "/work", wait_until="networkidle")
        check("unpublished disappears from /work", draft_title not in page.inner_text("body"))
        check("ordinals contiguous again",
              page.eval_on_selector_all(".card-ordinal", "els => els.map(e => e.textContent)")
              == ["01", "02", "03", "04", "05"])
        # edit title then delete
        page.goto(BASE + "/studio", wait_until="networkidle")
        page.wait_for_timeout(1000)
        row = page.locator("[data-cases-rows] tr", has_text=draft_slug)
        row.locator("button", has_text="Edit").click()
        page.wait_for_timeout(300)
        check("edit shows slug as read-only text",
              not page.is_visible("[name='slug']") and
              draft_slug in page.inner_text("[data-slug-static]"))
        page.fill("[name='title']", draft_title + ", Retitled")
        page.click("[data-editor-save]")
        page.wait_for_timeout(900)
        check("edit saved", "Saved." in page.inner_text("[data-studio-status]"))
        check("retitled row", draft_title in page.inner_text("[data-cases-rows]"))
        row = page.locator("[data-cases-rows] tr", has_text=draft_slug)
        row.locator("button", has_text="Delete").click()
        page.wait_for_timeout(900)
        check("deleted status", "Deleted." in page.inner_text("[data-studio-status]"))
        check("deleted row gone", draft_slug not in page.inner_text("[data-cases-rows]"))

        # inquiries pane
        check("inquiry from visitor visible to owner",
              "Vera Visitor" in page.inner_text("[data-inquiries-list]"))
        new_row = page.locator("[data-inquiries-list] li", has_text="Vera Visitor")
        new_row.locator("button", has_text="Mark resolved").click()
        page.wait_for_timeout(900)
        check("marked resolved status", "Marked resolved." in page.inner_text("[data-studio-status]"))

        # sign out
        page.click("[data-sign-out]")
        page.wait_for_url("**/studio/login", timeout=8000)
        check("sign out returns to login", page.url.rstrip("/") == BASE + "/studio/login", page.url)

        # ---------------- motion toggle (DP-59)
        page.goto(BASE + "/", wait_until="networkidle")
        check("motion starts pressed", page.get_attribute(".motion-button", "aria-pressed") == "true")
        page.click(".motion-button")
        check("motion flips off", page.get_attribute(".motion-button", "aria-pressed") == "false")
        page.reload(wait_until="networkidle")
        check("motion choice survives reload", page.get_attribute(".motion-button", "aria-pressed") == "false")
        page.click(".motion-button")
        check("motion back on", page.get_attribute(".motion-button", "aria-pressed") == "true")

        # reduced motion
        rm = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
        rpage = rm.new_page()
        rpage.goto(BASE + "/", wait_until="networkidle")
        rpage.wait_for_timeout(1200)
        headings_final = rpage.eval_on_selector(
            "[data-split=''] , #about-heading", "el => el.textContent")
        check("reduced motion: headings readable at once", bool(headings_final.strip()))
        check("reduced motion: no cover", rpage.query_selector("[data-intro-cover]") is None or
              not rpage.query_selector("[data-intro-cover]").is_visible())
        check("reduced motion: motion button still starts pressed",
              rpage.get_attribute(".motion-button", "aria-pressed") == "true")
        rm.close()

        # ---------------- keyboard and focus
        page.goto(BASE + "/", wait_until="networkidle")
        page.keyboard.press("Tab")
        first_focused = page.evaluate("document.activeElement.textContent")
        check("first tab reaches a visible control", bool(first_focused.strip()))
        outline = page.evaluate("""() => {
            const el = document.activeElement;
            const style = getComputedStyle(el);
            return style.outlineWidth + ' ' + style.outlineStyle;
        }""")
        check("focus ring visible", "0px none" not in outline, outline)

        # menu button below breakpoint
        menu_ctx = browser.new_context(viewport={"width": 375, "height": 812})
        mpage = menu_ctx.new_page()
        mpage.goto(BASE + "/", wait_until="networkidle")
        check("menu button visible at 375", mpage.is_visible(".menu-button"))
        check("nav folded at 375", not mpage.is_visible(".main-nav"))
        mpage.click(".menu-button")
        mpage.wait_for_timeout(300)
        check("menu opens nav", mpage.is_visible(".main-nav"))
        check("aria-expanded true", mpage.get_attribute(".menu-button", "aria-expanded") == "true")
        mpage.keyboard.press("Escape")
        mpage.wait_for_timeout(200)
        check("escape closes menu", not mpage.is_visible(".main-nav"))

        # no sideways scroll (DP-71) at several widths
        for width in (320, 375, 768, 1280):
            vctx = browser.new_context(viewport={"width": width, "height": 900})
            vpage = vctx.new_page()
            for path in ("/", "/work", "/work/hollow-signal", "/contact"):
                vpage.goto(BASE + path, wait_until="networkidle")
                scroll_width = vpage.evaluate("document.documentElement.scrollWidth")
                client_width = vpage.evaluate("document.documentElement.clientWidth")
                check(f"no sideways scroll {path} @{width}", scroll_width <= client_width + 1,
                      (scroll_width, client_width))
            vctx.close()

        # hero statement shrinks on phone (DP-69)
        phone = browser.new_context(viewport={"width": 375, "height": 812})
        ppage = phone.new_page()
        ppage.goto(BASE + "/", wait_until="networkidle")
        phone_size = ppage.eval_on_selector(".hero-statement", "el => parseFloat(getComputedStyle(el).fontSize)")
        desktop_size = page.eval_on_selector(".hero-statement", "el => parseFloat(getComputedStyle(el).fontSize)")
        check("hero shrinks on phone", phone_size < desktop_size * 0.55, (phone_size, desktop_size))
        phone.close()

        # journal cover brightens on hover (DP-73)
        page.goto(BASE + "/", wait_until="networkidle")
        page.hover(".journal-card")
        page.wait_for_timeout(400)
        bright = page.eval_on_selector(".journal-cover", "el => getComputedStyle(el).filter")
        check("journal cover brightens on hover", "brightness(1)" in bright or bright == "none", bright)

        uncaught = [e for e in errors if "Failed to load resource" not in e]
        check("no page errors", not uncaught, uncaught[:4])

        browser.close()
    print()
    print(f"passed {passed}, failed {failed}")
    return 1 if failed else 0


SEED_SLUGS = {"hollow-signal", "ember-ledger", "night-cartography", "vanta-atelier",
              "low-tide-radio", "red-meridian"}


def cleanup_non_seed_case_studies():
    """Remove case studies left behind by earlier test runs, via the owner API."""
    import json as _json
    status, body = call_json("/api/auth/login", "POST", {"email": "owner@example.com",
                                                         "password": "deku-demo-pw-2026"})
    if status != 200:
        return
    token = _json.loads(body)["token"]
    status, body = call_json("/api/studio/cases", token=token)
    for row in _json.loads(body):
        if row["slug"] not in SEED_SLUGS:
            call_json(f"/api/studio/cases/{row['id']}", "DELETE", token=token)


def call_json(path, method="GET", body=None, token=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", "Bearer " + token)
    try:
        with urllib.request.urlopen(req) as r:
            return r.status, r.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read()


def fetch_status(url):
    try:
        with urllib.request.urlopen(url) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


if __name__ == "__main__":
    sys.exit(main())
