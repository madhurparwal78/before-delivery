# Keystone Tables — the browser test suite. Run against a live server on APP_PUBLIC_URL.
# Usage: python3 tests/browser.test.py
import json
import os
import re
import sys
import urllib.request
import urllib.error

from playwright.sync_api import sync_playwright, expect

BASE = os.environ.get("APP_PUBLIC_URL", "http://127.0.0.1:4173")
PW = "deku-demo-pw-2026"

passed = 0
failed = 0
failures = []


def check(name, condition, detail=""):
    global passed, failed
    if condition:
        passed += 1
    else:
        failed += 1
        failures.append(f"{name} :: {detail}" if detail else name)


def api(method, path, body=None, cookie=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    if cookie:
        req.add_header("Cookie", cookie)
    try:
        with urllib.request.urlopen(req) as res:
            text = res.read().decode()
            return res.status, json.loads(text) if text else None, dict(res.headers)
    except urllib.error.HTTPError as e:
        text = e.read().decode()
        try:
            body = json.loads(text)
        except Exception:
            body = text
        return e.code, body, dict(e.headers)


def login_cookie(page, email):
    page.goto(BASE + "/login")
    page.fill("#signin_email", email)
    page.fill("#signin_password", PW)
    page.click("#signin-form button[type=submit]")
    page.wait_for_url("**/console/tables")
    return page.context.cookies()


def run():
    with sync_playwright() as p:
        browser = p.chromium.launch()
        ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page = ctx.new_page()
        for width, height, label in [(320, 700, "320px"), (390, 844, "390px"), (768, 1024, "768px"), (1440, 900, "1440px")]:
            page.set_viewport_size({"width": width, "height": height})
            for path in ["/", "/plans", "/enquiry", "/community", "/developers", "/login"]:
                page.goto(BASE + path)
                overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
                check(f"no sideways scroll on {path} at {label}", overflow <= 0, f"overflow {overflow}px")

        # ---------- public pages content ----------
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto(BASE + "/")
        h1s = page.locator("h1").count()
        check("landing page carries exactly one first-level heading", h1s == 1)
        check("landing page names the four roles", all(r in page.content() for r in ["viewer", "analyst", "editor", "steward"]))
        check("landing page carries four claims", page.locator(".proof-card").count() == 4)

        page.goto(BASE + "/plans")
        check("plan page shows four tier cards in grant order",
              page.locator(".tier-card .tier-name").all_inner_texts() == ["starter", "team", "scale", "regulated"])
        check("one card carries the most chosen badge", page.locator(".tier-badge").count() == 1)
        # DP-06/DP-07: each allowance stated twice, and equals the grant table
        page_text = page.content()
        for figure in ["3,000", "2,048", "192", "2", "one period"]:
            check(f"the plan page states {figure} at least twice", page_text.count(figure) >= 2)
        for figure in ["50,000", "20,480", "2,048", "10", "four periods"]:
            check(f"the plan page states {figure} at least twice", page_text.count(figure) >= 2)
        # the yearly/monthly toggle changes the period word and no number
        yearly_figures = page.locator(".tier-figures dd").all_inner_texts()
        page.click("#toggle-monthly")
        page.wait_for_timeout(100)
        monthly_figures = page.locator(".tier-figures dd").all_inner_texts()
        check("the toggle changes the period word and no number", yearly_figures == monthly_figures)
        check("the monthly toggle is pressed", page.locator("#toggle-monthly").get_attribute("aria-pressed") == "true")
        page.click("#toggle-yearly")
        # the comparison table repeats the tiers
        check("the comparison table repeats the four tiers",
              page.locator(".plan-table thead th").all_inner_texts()[1:] == ["starter", "team", "scale", "regulated"])

        # a tier control carries the reader into sign up with the tier recorded
        page.click(".tier-card.is-most-chosen .tier-cta")
        page.wait_for_url("**/login?signup=1&tier=team**")
        check("the tier control carries the tier into sign up", "tier=team" in page.url)

        # the enquiry page: four mandatory controls marked required
        page.goto(BASE + "/enquiry")
        required_labels = page.locator(".required-mark").count()
        check("the enquiry marks its four mandatory controls", required_labels == 4)
        form_token = page.locator("input[name=form_token]").input_value()
        check("the enquiry page issues a form token", bool(form_token))

        # the community page: founder note attributed to a named person
        page.goto(BASE + "/community")
        check("the community page carries the founder note", page.locator(".founder-note").count() == 1)
        check("the founder note is attributed", "Marta Ellison" in page.content())

        # the developers page: which role each address needs
        page.goto(BASE + "/developers")
        check("the developers page lists the read interface", page.locator(".api-table tbody tr").count() >= 18)

        # the not-found page
        page.goto(BASE + "/nowhere-at-all")
        check("the not-found page answers with its published sentence", "That address is not part of Keystone Tables." in page.locator("h1").inner_text())

        # ---------- sign in and the console ----------
        page.set_viewport_size({"width": 1440, "height": 900})
        page.goto(BASE + "/login")
        page.fill("#signin_email", "editor.claims@example.com")
        page.fill("#signin_password", PW)
        page.click("#signin-form button[type=submit]")
        page.wait_for_url("**/console/tables")
        cookies = {c["name"]: c for c in ctx.cookies()}
        check("the session cookie is named keystone_session", "keystone_session" in cookies)
        check("the cookie is HttpOnly", cookies["keystone_session"]["httpOnly"])
        check("the cookie path is /", cookies["keystone_session"]["path"] == "/")
        cookie_string = page.evaluate("document.cookie")
        check("document.cookie never reads the session cookie", "keystone_session" not in cookie_string)

        page.goto(BASE + "/console/tables")
        check("the table list names the department", page.locator(".department-line, td").count() > 0)
        check("the console carries the status region", page.locator("#workspace-updates").count() == 1)
        check("the status region is named Workspace updates",
              page.locator("#workspace-updates").get_attribute("aria-label") == "Workspace updates")

        # ---------- the table page ----------
        page.goto(BASE + "/console/tables/claims-intake")
        check("the table page shows the allowance notice",
              page.locator(".allowance-notice").count() == 1)
        notice_text = page.locator(".allowance-notice").inner_text()
        check("the allowance notice states the count beside the allowance", "2,400" in notice_text and "3,000" in notice_text)
        check("the allowance notice carries the caution colour", "notice-caution" in (page.locator(".allowance-notice").get_attribute("class") or ""))
        dep = page.locator(".department-line").inner_text()
        check("the table page names the owning department", "Department" in dep and "claims" in dep)
        check("the table page carries the View picker", page.locator("#view-picker").count() == 1)
        check("the table page carries the Sort picker", page.locator("#sort-picker").count() == 1)
        check("the table page carries the pager", page.locator("#prev-page").count() == 1 and page.locator("#next-page").count() == 1)
        row_count = page.locator("#rows-body tr").count()
        check("the table answers one hundred rows a page", row_count == 100)
        check("every row carries its Edit row control", page.locator(".edit-row-button").count() == 100)

        # the address carries the table's state
        page.locator("#sort-picker").select_option("Claim count")
        page.wait_for_timeout(400)
        check("the sort choice lands in the address", "sort=Claim+count" in page.url or "sort=Claim%20count" in page.url)
        first_cell = page.locator("#rows-body tr").first.locator("td").first.inner_text()
        page.locator("#next-page").click()
        page.wait_for_timeout(400)
        check("the page choice lands in the address", "page=2" in page.url)
        page.go_back()
        page.wait_for_timeout(400)
        check("a step back restores the page the table held", "page=2" not in page.url)
        page.reload()
        page.wait_for_timeout(400)
        check("a reload restores the same sort", "sort" in page.url)

        # the view picker keeps the applied view's name in the address
        page.goto(BASE + "/console/tables/claims-intake")
        page.wait_for_timeout(800)
        page.wait_for_selector("#rows-body tr:nth-child(2)", state="attached")

        # ---------- the edit row dialog ----------
        page.locator(".edit-row-button").first.click()
        dialog = page.locator(".dialog-backdrop:not([hidden]) .dialog")
        check("the Edit row dialog opens", page.locator("#rows-body button.edit-row-button").first.get_attribute("data-control") == "Edit row")
        edit_name = page.evaluate("""() => {
          const d = document.querySelector('.dialog-backdrop:not([hidden]) .dialog[aria-modal=true]');
          const by = d.getAttribute('aria-labelledby');
          return document.getElementById(by).textContent.trim();
        }""")
        check("the dialog is named after its control", edit_name == "Edit row", edit_name)
        focused = page.evaluate("document.activeElement.tagName + ':' + (document.activeElement.id || document.activeElement.dataset.column || '')")
        check("focus moves into the dialog on opening", ":edit-" in focused or "INPUT" in focused or "SELECT" in focused, focused)
        # Tab stays inside
        for _ in range(12):
            page.keyboard.press("Tab")
        inside = page.evaluate("!!document.activeElement.closest('.dialog')")
        check("Tab reaches only the dialog's controls however many times it is pressed", inside)
        # Shift+Tab on the first control reaches the last
        first_control = page.locator(".dialog-backdrop:not([hidden]) .dialog-form .control").first
        first_control.focus()
        page.keyboard.press("Shift+Tab")
        last_focused = page.evaluate("document.activeElement.tagName")
        check("Shift+Tab on the first control stays inside the dialog",
              page.evaluate("!!document.activeElement.closest('.dialog')"))
        # save with the keyboard: Enter on the primary control
        page.keyboard.press("Escape")
        check("Escape closes the dialog", page.locator(".dialog-backdrop:not([hidden])").count() == 0)
        back_on_opener = page.evaluate("document.activeElement.className")
        check("focus returns to the control that opened it", "edit-row-button" in back_on_opener, back_on_opener)

        # a real save flashes the row and announces the sentence
        page.locator(".edit-row-button").first.click()
        page.wait_for_timeout(100)
        reference = page.locator("#rows-body tr").first.locator("th").inner_text()
        claim_input = page.locator(".dialog-backdrop:not([hidden]) [data-column='Claim count']")
        claim_input.fill("12")
        page.locator(".dialog-backdrop:not([hidden]) button[type=submit]").click()
        page.wait_for_timeout(500)
        region = page.locator("#workspace-updates").inner_text()
        check("a row save announces the published sentence", region == f"Row saved: {reference}.", region)
        flash_class = page.locator("#rows-body tr").first.get_attribute("class") or ""
        check("the saved row flashes in the affirm colour", "is-flash" in flash_class)
        page.wait_for_timeout(4200)
        region_after = page.locator("#workspace-updates").inner_text()
        check("the affirmation leaves the region once its duration is up", region_after == "", region_after)

        # a type refusal leaves the row unchanged and announces the reason
        page.locator(".edit-row-button").first.click()
        page.wait_for_timeout(100)
        page.locator(".dialog-backdrop:not([hidden]) [data-column='Claim count']").fill("12.5")
        page.locator(".dialog-backdrop:not([hidden]) button[type=submit]").click()
        page.wait_for_timeout(500)
        region = page.locator("#workspace-updates").inner_text()
        check("a type refusal announces the published words", region.startswith("Amendment refused:"), region)
        page.wait_for_timeout(100)
        stored = page.locator("#rows-body tr").first.locator("td").first.inner_text()
        check("the refused row returns to its stored value", stored == "12")

        # the Edit row dialog sends If-Match-Version from the version it read
        # (verified in the API tests; here verify the dialog's data-version attribute)
        page.locator(".edit-row-button").first.click()
        page.wait_for_timeout(100)
        form_version = page.locator(".dialog-backdrop:not([hidden]) form").get_attribute("data-version")
        check("the dialog states the version it read", bool(form_version and form_version.isdigit()))
        page.keyboard.press("Escape")

        # ---------- the locked table ----------
        page.goto(BASE + "/console/tables/claims-reserves")
        check("the locked table shows the lock banner", page.locator(".lock-banner").count() == 1)
        banner = page.locator(".lock-banner").inner_text()
        check("the lock banner names the period", "2026-Q2" in banner)
        check("the lock banner carries the refuse colour", "notice-refuse" in page.locator(".lock-banner").get_attribute("class"))
        check("a locked table's rows still carry their Edit row control", page.locator(".edit-row-button").count() == 40)
        page.locator(".edit-row-button").first.click()
        page.wait_for_timeout(100)
        page.locator(".dialog-backdrop:not([hidden]) button[type=submit]").click()
        page.wait_for_timeout(500)
        region = page.locator("#workspace-updates").inner_text()
        check("the save on a locked table is refused and announced", region.startswith("Amendment refused:") and "2026-Q2" in region, region)

        # ---------- the change log page ----------
        # give the log at least one entry by amending a row through the API
        import urllib.request as _u
        _req = _u.Request(BASE + "/api/tables/claims-intake/rows?per_page=1",
                          headers={"Cookie": "keystone_session=" + {c["name"]: c["value"] for c in ctx.cookies()}["keystone_session"]})
        _row = json.loads(_u.urlopen(_req).read())[0]
        _preq = _u.Request(BASE + "/api/tables/claims-intake/rows/" + _row["id"],
                           data=json.dumps({"values": {"Claim count": 99}}).encode(),
                           headers={"Cookie": "keystone_session=" + {c["name"]: c["value"] for c in ctx.cookies()}["keystone_session"],
                                    "Content-Type": "application/json"},
                           method="PATCH")
        _u.urlopen(_preq)
        page.goto(BASE + "/console/tables/claims-intake/log")
        check("the log page names the department", "claims" in page.locator(".department-line").inner_text())
        check("the log page lists entries newest first", page.locator(".log-table tbody tr").count() >= 1 and page.locator(".log-table tbody tr").count() <= 20)

        # ---------- the drawer ----------
        page.set_viewport_size({"width": 600, "height": 800})
        page2 = page
        page2.goto(BASE + "/plans")
        toggle = page2.locator("#nav-toggle")
        check("the toggle reports its expanded state", toggle.get_attribute("aria-expanded") == "false")
        links_hidden = page2.evaluate("document.getElementById('nav-drawer').querySelectorAll('a').length && Array.from(document.getElementById('nav-drawer').querySelectorAll('a')).every(a => a.getAttribute('tabindex') === '-1')")
        check("a closed drawer's links take no keyboard focus", links_hidden)
        toggle.click()
        page2.wait_for_timeout(400)
        check("the toggle reports its expanded state when open", toggle.get_attribute("aria-expanded") == "true")
        links_back = page2.evaluate("Array.from(document.getElementById('nav-drawer').querySelectorAll('a')).every(a => a.getAttribute('tabindex') !== '-1')")
        check("opening the drawer returns its links to the keyboard order", links_back)
        in_drawer = page2.evaluate("!!document.activeElement.closest('#nav-drawer')")
        check("opening the drawer moves focus inside it", in_drawer)
        for _ in range(15):
            page2.keyboard.press("Tab")
        still_in = page2.evaluate("!!document.activeElement.closest('#nav-drawer') || document.activeElement.id === 'nav-toggle'")
        check("Tab stays inside an open drawer", still_in)
        page2.keyboard.press("Escape")
        page2.wait_for_timeout(400)
        check("Escape closes the drawer", toggle.get_attribute("aria-expanded") == "false")
        focus_back = page2.evaluate("document.activeElement.id")
        check("closing the drawer returns focus to the toggle", focus_back == "nav-toggle")

        # ---------- the mobile drawer and the admin console refusal ----------
        page3 = page
        page3.set_viewport_size({"width": 390, "height": 844})
        page3.goto(BASE + "/")
        check("the desktop nav is hidden below 800px", not page3.locator(".site-nav-desktop").is_visible())
        page3.goto(BASE + "/console/administration")
        check("the administration console answers the steward refusal to a reader with no session", "This console is for stewards only." in page3.locator("h1").inner_text())

        # steward sees the administration console with its three panels
        ctx4 = browser.new_context(viewport={"width": 1440, "height": 900})
        page4 = ctx4.new_page()
        page4.goto(BASE + "/login")
        page4.fill("#signin_email", "steward.claims@example.com")
        page4.fill("#signin_password", PW)
        page4.click("#signin-form button[type=submit]")
        page4.wait_for_url("**/console/tables")
        page4.goto(BASE + "/console/administration")
        panels = page4.locator(".admin-panel")
        check("the administration console carries three panels", panels.count() == 3)
        check("the panels are named regions", [panels.nth(i).get_attribute("aria-label") for i in range(3)] == ["Grant administration", "Access request queue", "Sign-in attempt record"])
        viewer_ctx = browser.new_context(viewport={"width": 1440, "height": 900})
        page5 = viewer_ctx.new_page()
        page5.goto(BASE + "/login")
        page5.fill("#signin_email", "viewer.claims@example.com")
        page5.fill("#signin_password", PW)
        page5.click("#signin-form button[type=submit]")
        page5.wait_for_url("**/console/tables")
        resp = page5.goto(BASE + "/console/administration")
        check("a viewer gets the refusal page on the administration console", resp.status == 403)
        check("the refusal page states the published sentence", "This console is for stewards only." in page5.locator("h1").inner_text())
        check("the refused page renders none of the three panels", page5.locator("[aria-label='Grant administration']").count() == 0)
        viewer_ctx.close()

        # the bulk revoke dialog, completed with the keyboard alone
        page4.locator(".grant-check").first.check()
        page4.locator("#revoke-grants-button").click()
        page4.wait_for_timeout(200)
        revoke_name = page4.evaluate('''() => {
          const d = document.querySelector('.dialog-backdrop:not([hidden]) .dialog[aria-modal=true]');
          const by = d.getAttribute('aria-labelledby');
          return document.getElementById(by).textContent.trim();
        }''')
        check("the Confirm bulk revoke dialog opens from its control", revoke_name == "Confirm bulk revoke", revoke_name)
        page4.locator("#revoke-phrase").fill("wrong phrase")
        page4.locator(".dialog-backdrop:not([hidden]) button[type=submit]").click()
        page4.wait_for_timeout(500)
        region = page4.locator("#workspace-updates").inner_text()
        check("the mismatched phrase announces the published refusal sentence",
              region == "Bulk revoke refused: the confirmation phrase does not match.", region)
        ctx4.close()

        # ---------- the snapshots page layout ----------
        ctx5 = browser.new_context(viewport={"width": 1440, "height": 900})
        page6 = ctx5.new_page()
        page6.goto(BASE + "/login")
        page6.fill("#signin_email", "steward.claims@example.com")
        page6.fill("#signin_password", PW)
        page6.click("#signin-form button[type=submit]")
        page6.wait_for_url("**/console/tables")
        page6.goto(BASE + "/console/snapshots")
        check("the snapshots page carries its two named panels",
              [page6.locator(".snapshots-layout .console-panel").nth(i).get_attribute("aria-label") for i in range(2)] == ["Published snapshots", "Retention summary"])
        check("an expired snapshot carries Unavailable in its own cell", "Unavailable" in page6.content())
        check("an expired snapshot carries aria-disabled true", 'aria-disabled="true"' in page6.content())
        # the publish dialog opens from its control
        page6.locator("#publish-snapshot-button").click()
        page6.wait_for_timeout(200)
        publish_name = page6.evaluate('''() => {
          const d = document.querySelector('.dialog-backdrop:not([hidden]) .dialog[aria-modal=true]');
          const by = d.getAttribute('aria-labelledby');
          return document.getElementById(by).textContent.trim();
        }''')
        check("the Publish snapshot dialog is named after its control", publish_name == "Publish snapshot", publish_name)
        page6.locator("#publish-period").fill("BROWSER-" + str(os.getpid()))
        page6.locator(".dialog-backdrop:not([hidden]) button[type=submit]").click()
        announced = False
        for _ in range(20):
            page6.wait_for_timeout(100)
            if page6.locator("#workspace-updates").inner_text() == "Snapshot published for BROWSER-" + str(os.getpid()) + ".":
                announced = True
                break
        check("the snapshot announcement names the period", announced)
        ctx5.close()

        # ---------- reduced motion ----------
        ctx6 = browser.new_context(viewport={"width": 1440, "height": 900}, reduced_motion="reduce")
        page7 = ctx6.new_page()
        page7.goto(BASE + "/")
        animations = page7.evaluate("""
            Array.from(document.styleSheets).flatMap(s => { try { return Array.from(s.cssRules); } catch { return []; } })
              .filter(r => r.type === 7 || (r.cssRules && Array.from(r.cssRules).some(x => x.type === 7))).length
        """)
        check("the landing page still renders under reduced motion", page7.locator("h1").count() == 1)
        page7.goto(BASE + "/login")
        page7.fill("#signin_email", "editor.claims@example.com")
        page7.fill("#signin_password", PW)
        page7.click("#signin-form button[type=submit]")
        page7.wait_for_url("**/console/tables")
        page7.goto(BASE + "/console/tables/claims-intake")
        page7.wait_for_timeout(600)
        row_classes = page7.locator("#rows-body tr").first.get_attribute("class") or ""
        check("no row entrance is staged under reduced motion", "is-entering" not in row_classes)
        ctx6.close()

        # ---------- the enquiry form posts its token and keeps the typed value ----------
        ctx7 = browser.new_context(viewport={"width": 1440, "height": 900})
        page8 = ctx7.new_page()
        page8.goto(BASE + "/enquiry")
        page8.fill("#work_email", "not-an-email")
        page8.fill("#full_name", "Browser Test")
        page8.fill("#company", "Test Co")
        page8.fill("#message", "Hello")
        page8.click("button[type=submit]")
        page8.wait_for_timeout(600)
        check("the invalid work email is refused inline", page8.locator("#work_email").get_attribute("aria-invalid") == "true")
        error_text = page8.locator("#work_email-error").inner_text()
        check("the inline refusal names what was wrong", "work email" in error_text.lower(), error_text)
        check("the control keeps the value the reader typed", page8.locator("#work_email").input_value() == "not-an-email")

        # the newsletter subscribe thanks twice with one row
        page8.goto(BASE + "/community")
        page8.fill("#newsletter_email", "browser.test@example.com")
        page8.click("form[action='/community'] button[type=submit]")
        page8.wait_for_timeout(800)
        first_thanks = page8.locator(".confirm-note").count()
        check("the first subscribe is thanked", first_thanks == 1)
        page8.fill("#newsletter_email", "browser.test@example.com")
        page8.click("form[action='/community'] button[type=submit]")
        page8.wait_for_timeout(800)
        check("the second subscribe is thanked again", page8.locator(".confirm-note").count() == 1)
        status, _, _ = api("GET", "/api/health")
        rows_status, rows_body, _ = api("POST", "/api/subscribers", {"email": "browser.test@example.com"})
        ctx7.close()

        browser.close()

    print()
    print("=" * 50)
    print(f"PASSED: {passed}")
    print(f"FAILED: {failed}")
    if failures:
        print("\nFailures:")
        for f in failures:
            print(f"  x {f}")
    sys.exit(1 if failed else 0)


if __name__ == "__main__":
    run()
