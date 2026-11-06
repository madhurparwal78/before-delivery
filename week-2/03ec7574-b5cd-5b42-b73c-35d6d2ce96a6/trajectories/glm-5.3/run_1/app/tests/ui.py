"""Browser UI tests with Playwright against the live Corvo server."""
import re
import sys
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
PW = "deku-demo-pw-2026"

PASS = 0
FAIL = 0
FAILURES = []


def check(name, cond, extra=""):
    global PASS, FAIL
    if cond:
        PASS += 1
    else:
        FAIL += 1
        FAILURES.append(name)
        print(f"FAIL: {name} {extra}")


def login(page, email, next_path=None):
    page.goto(BASE + "/login" + (f"?next={next_path}" if next_path else ""))
    page.fill("#email", email)
    page.fill("#password", PW)
    page.click("button:has-text('Sign in')")
    page.wait_for_load_state("networkidle")


def main():
    with sync_playwright() as p:
        browser = p.chromium.launch()

        # ---------- public pages ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        page.goto(BASE + "/")
        check("landing h1", page.locator("h1").first.inner_text().startswith("Hold, move and govern"))
        check("skip link", page.locator('a:has-text("Skip to main content")').first.is_visible()
              or page.evaluate("document.querySelector('.skip-link') !== null"))
        check("notifications region", page.locator('#notifications[role="status"]').count() == 1)
        check("hero capsules", page.locator('a:has-text("Get started")').count() >= 2)
        check("progress bar", page.locator('[role="progressbar"][aria-label="Approvals"]').count() == 1)
        check("hero text 1 of 2", "1 of 2 approvals" in page.locator("#hero-approval").inner_text())

        # hero scrub with scroll
        page.evaluate("window.scrollTo(0, 300)")
        page.wait_for_timeout(300)
        check("hero scrub executed", "2 of 2 approvals" in page.locator("#hero-approval").inner_text()
              and "executed" in page.locator("#hero-approval").inner_text())
        page.evaluate("window.scrollTo(0, 0)")
        page.wait_for_timeout(300)
        check("hero scrub reverses", "1 of 2 approvals" in page.locator("#hero-approval").inner_text())

        # header menus open on click, one at a time
        page.click('button[aria-controls="menu-products"]')
        page.wait_for_timeout(100)
        check("menu opens", page.locator("#menu-products").is_visible()
              and page.get_attribute('button[aria-controls="menu-products"]', "aria-expanded") == "true")
        page.click('button[aria-controls="menu-solutions"]')
        page.wait_for_timeout(100)
        check("one menu at a time", not page.locator("#menu-products").is_visible()
              and page.locator("#menu-solutions").is_visible())
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        check("escape closes menu", not page.locator("#menu-solutions").is_visible())
        check("focus back on button", page.evaluate("document.activeElement.getAttribute('aria-controls')") == "menu-solutions")

        # sections content
        check("seven product cards", page.locator("#product-cards .card").count() == 7)
        check("treasury card links approvals", page.locator('a[href="/console/approvals"]').count() == 1)
        check("stats row", page.locator(".stats-row .stat").count() == 4)
        check("case cards", page.locator("#cases .case-card").count() == 4)
        check("builders cards", page.locator("#builders .card").count() == 4)

        # pricing
        page.goto(BASE + "/pricing")
        check("pricing h1", "Pricing that grows with you." in page.locator("h1").inner_text())
        check("tier rows", page.locator(".tier-table tbody tr").count() == 3)
        page.click('button:has-text("What counts as an active wallet?")')
        page.wait_for_timeout(100)
        check("faq opens", page.locator("#faq-a-0").is_visible())
        page.click('button:has-text("Do failed transfers count?")')
        page.wait_for_timeout(100)
        check("faq one at a time", not page.locator("#faq-a-0").is_visible()
              and page.locator("#faq-a-1").is_visible())
        check("matrix included labels", page.locator('span.check[role="img"][aria-label="Included"]').count() == 4)

        # contact form validation and focus
        page.goto(BASE + "/contact")
        page.fill("#full_name", "A")
        page.fill("#work_email", "x@gmail.com")
        page.fill("#company", "")
        page.select_option("#monthly_volume", "")
        page.fill("#message", "hi")
        page.click("button:has-text('Send message')")
        page.wait_for_timeout(700)
        check("all field errors shown", page.locator("#err-full_name").is_visible()
              and page.locator("#err-work_email").is_visible()
              and page.locator("#err-company").is_visible()
              and page.locator("#err-monthly_volume").is_visible()
              and page.locator("#err-message").is_visible())
        check("first invalid focused", page.evaluate("document.activeElement.id") == "full_name")
        check("free mail message", page.locator("#err-work_email").inner_text() == "Use your work email")
        check("typed value kept", page.input_value("#work_email") == "x@gmail.com")
        # fix and send
        page.fill("#full_name", "Ada Lovelace")
        page.fill("#work_email", "ada@corp.io")
        page.fill("#company", "Corp")
        page.select_option("#monthly_volume", "Under $1M")
        page.fill("#message", "We would like to hear more about Corvo for our treasury team.")
        page.click("button:has-text('Send message')")
        page.wait_for_timeout(1200)
        check("thanks line replaces form", page.locator("#contact-thanks").is_visible()
              and not page.locator("#contact-form").is_visible())
        check("thanks focused", page.evaluate("document.activeElement.id") == "contact-thanks")

        # login wrong pair keeps email
        page.goto(BASE + "/login")
        page.fill("#email", "nw.operator@example.com")
        page.fill("#password", "wrong")
        page.click("button:has-text('Sign in')")
        page.wait_for_timeout(700)
        check("wrong pair alert", page.locator("#login-alert").is_visible()
              and page.locator("#login-alert").inner_text() == "Email or password is incorrect")
        check("email kept", page.input_value("#email") == "nw.operator@example.com")

        # not found
        page.goto(BASE + "/definitely-not-a-page")
        check("404 page", "Page not found" in page.locator("h1").inner_text()
              and page.locator('a:has-text("Back to home")').count() == 1)
        ctx.close()

        # ---------- console: operator journey ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        # signed-out redirect
        page.goto(BASE + "/console/wallets/wal_operating")
        page.wait_for_load_state()
        check("signed-out redirect", "/login" in page.url and "next=" in page.url)
        login(page, "nw.operator@example.com", "/console/wallets/wal_operating")
        page.wait_for_load_state("networkidle")
        check("next honoured", "/console/wallets/wal_operating" in page.url)

        # wallet page facts and forms
        check("wallet heading", "Operating USDC" in page.locator("h1").inner_text())
        check("copy address button", page.locator('button:has-text("Copy address")').count() == 1)
        check("send form", page.locator('form[aria-label="Send"]').count() == 1)
        check("deposit form", page.locator('form[aria-label="Deposit"]').count() == 1)
        check("payroll batch form", page.locator('form[aria-label="Payroll batch"]').count() == 1)
        check("no create wallet for operator", page.locator("#create-wallet-btn").count() == 0)
        check("no freeze for operator", page.locator("#freeze-btn").count() == 0)
        check("activity table", page.locator('table[aria-label="Activity"]').count() == 1)

        # send a transfer below the floor -> executes at once
        page.fill("#send-destination", "0x3333333333333333333333333333333333333333")
        page.fill("#send-amount", "5")
        page.fill("#send-memo", "Test transfer")
        page.click('form[aria-label="Send"] button:has-text("Send")')
        page.wait_for_selector("#send-result:has-text('Transfer executed')", timeout=5000)
        check("send result executed", "Transfer executed" in page.locator("#send-result").inner_text())
        page.wait_for_timeout(2200)
        page.wait_for_load_state("networkidle")

        # a transfer at the floor waits for approval
        page.fill("#send-destination", "0x1111111111111111111111111111111111111111")
        page.fill("#send-amount", "15000")
        page.fill("#send-memo", "October hardware")
        page.click('form[aria-label="Send"] button:has-text("Send")')
        page.wait_for_selector("#send-result:has-text('Waiting for approval: 0 of 2 approvals')", timeout=5000)
        check("send result waiting", "Waiting for approval: 0 of 2 approvals" in page.locator("#send-result").inner_text())
        page.wait_for_timeout(2200)
        page.wait_for_load_state("networkidle")

        # a denied transfer names the rule and keeps typed values
        page.fill("#send-destination", "0x000000000000000000000000000000000000dead")
        page.fill("#send-amount", "100")
        page.click('form[aria-label="Send"] button:has-text("Send")')
        page.wait_for_selector("#send-result:has-text('Blocked by policy rule Block burn address')", timeout=5000)
        check("block names rule", "Blocked by policy rule Block burn address" in page.locator("#send-result").inner_text())
        check("typed values kept", page.input_value("#send-destination") == "0x000000000000000000000000000000000000dead"
              and page.input_value("#send-amount") == "100")

        # payroll batch builder
        page.fill("#line-1-destination", "0x4444444444444444444444444444444444444444")
        page.fill("#line-1-amount", "10")
        page.click("#add-line-btn")
        page.wait_for_timeout(100)
        check("add line focuses destination", page.evaluate("document.activeElement.className") == "line-destination")
        page.fill("#line-2-destination", "0x5555555555555555555555555555555555555555")
        page.fill("#line-2-amount", "3.5")
        check("running total", "Total: 13.5 USDC" in page.locator("#batch-total").inner_text())
        # remove line 2
        page.click('button:has-text("Remove line 2")')
        page.wait_for_timeout(100)
        check("total after remove", "Total: 10 USDC" in page.locator("#batch-total").inner_text())
        check("renumbered", page.locator("#line-1-destination").count() == 1)
        # last line cannot be removed
        check("last remove disabled", page.locator('button:has-text("Remove line 1")').is_disabled())

        # amount blur validation
        page.fill("#line-1-amount", "abc")
        page.locator("#line-1-amount").blur()
        page.wait_for_timeout(100)
        check("amount message on blur", "Enter an amount like 1250 or 0.5" in page.locator('[data-amount-error]').first.inner_text())

        # approvals inbox is empty for an operator
        page.goto(BASE + "/console/approvals")
        page.wait_for_load_state("networkidle")
        check("operator inbox empty", page.locator(".inbox-empty").count() == 1)

        # intents list, filter, details
        page.goto(BASE + "/console/intents")
        page.wait_for_load_state("networkidle")
        check("intents table", page.locator('table[aria-label="Intents"]').count() == 1)
        page.select_option("#status-filter", "executed")
        page.wait_for_url("**/console/intents?status=executed", timeout=5000)
        page.wait_for_load_state("networkidle")
        check("status filter applied", "executed" in page.url)
        rows = page.locator(".intent-row")
        first_details = page.locator('button:has-text("Details for")').first
        first_details.click()
        page.wait_for_timeout(100)
        check("details expand", page.locator(".details-row").first.is_visible())
        check("details revision text", "Decided under revision" in page.locator(".details-row").first.inner_text())
        ctx.close()

        # ---------- console: approver journey ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        login(page, "nw.approver1@example.com")
        page.goto(BASE + "/console/approvals")
        page.wait_for_load_state("networkidle")
        # the operator's 15000 transfer waits here; the seeded one Ada already decided
        rows = page.locator(".inbox-row")
        check("approver inbox has rows", rows.count() >= 1, rows.count())
        # progress text
        first = rows.first
        check("progress text", re.search(r"\d of \d approvals", first.inner_text()) is not None)
        # reject flow: reveal reason, escape returns focus
        first.locator('.reject-btn').click()
        page.wait_for_timeout(100)
        reason_field = first.locator(".reject-reason")
        check("reject focuses reason", page.evaluate("document.activeElement.className") == "reject-reason")
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        check("escape hides reason", first.locator(".reject-panel").is_hidden())
        check("focus back to reject", "reject-btn" in page.evaluate("document.activeElement.className"))
        # confirm reject with empty reason keeps focus with message
        first.locator('.reject-btn').click()
        first.locator('.confirm-reject').click()
        page.wait_for_timeout(100)
        check("empty reason message", "Enter a reason to reject" in first.locator(".field-error").inner_text())
        check("focus in reason", page.evaluate("document.activeElement.className") == "reject-reason")
        # a real reject on a fresh intent: use Omar to create one first via API? keep UI-only: reject this one
        first.locator(".reject-reason").fill("Not this week")
        first.locator('.confirm-reject').click()
        page.wait_for_timeout(1200)
        check("rejected toast", page.locator('.toast:has-text("Intent rejected")').count() >= 1)
        check("row removed and focus moved", page.evaluate(
            "document.activeElement.className === 'capsule capsule-dark approve-btn' || document.activeElement.className.includes('inbox-empty')"))
        ctx.close()

        # ---------- console: owner journey ----------
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page = ctx.new_page()
        login(page, "nw.owner@example.com")
        page.wait_for_load_state("networkidle")
        check("overview stat cards", page.locator(".stat-card").count() == 4)
        check("wallets table", page.locator('table[aria-label="Wallets"]').count() == 1)
        check("create wallet button", page.locator("#create-wallet-btn").count() == 1)

        # inline create row
        page.click("#create-wallet-btn")
        page.wait_for_timeout(100)
        check("create row opens and focuses name", page.locator("#wallet-create-row").is_visible()
              and page.evaluate("document.activeElement.id") == "new-wallet-name")
        page.fill("#new-wallet-name", "UI test wallet")
        page.click('button:has-text("Save wallet")')
        page.wait_for_timeout(1500)
        check("wallet created toast", "Wallet created" in page.locator(".notifications").inner_text()
              or "UI test wallet" in page.locator("#wallets-tbody").inner_text())

        # freeze dialog on a wallet
        page.goto(BASE + "/console/wallets/wal_operating")
        page.wait_for_load_state("networkidle")
        page.click("#freeze-btn")
        page.wait_for_timeout(200)
        check("freeze dialog opens", page.locator("#freeze-dialog").evaluate("d => d.open"))
        check("freeze dialog text", "Freezing pauses new transfers and approvals." in page.locator("#freeze-dialog").inner_text())
        check("dialog focuses keep active", page.evaluate(
            "document.activeElement.textContent") == "Keep active")
        page.keyboard.press("Escape")
        page.wait_for_timeout(100)
        check("escape closes dialog", not page.locator("#freeze-dialog").evaluate("d => d.open"))
        check("focus back to freeze", page.evaluate("document.activeElement.id") == "freeze-btn")

        # settings: remove member dialog
        page.goto(BASE + "/console/settings")
        page.wait_for_load_state("networkidle")
        check("members table", page.locator('table[aria-label="Members"]').count() == 1)
        check("api keys table", page.locator('table[aria-label="API keys"]').count() == 1)
        check("signing secret panel", page.locator("#reveal-secret-btn").count() == 1)
        page.click('button:has-text("Remove Omar Patel")')
        page.wait_for_timeout(200)
        check("remove dialog opens", page.locator("#remove-member-dialog").evaluate("d => d.open"))
        check("remove dialog safe focus", page.evaluate("document.activeElement.textContent") == "Keep member")
        page.click("#remove-member-dialog .keep-member")
        page.wait_for_timeout(100)
        check("keep member closes", not page.locator("#remove-member-dialog").evaluate("d => d.open"))

        # audit page chain status and tabs
        page.goto(BASE + "/console/audit")
        page.wait_for_load_state("networkidle")
        check("chain status verified", "Chain verified:" in page.locator("#chain-status").inner_text())
        page.click("#tab-events")
        page.wait_for_timeout(100)
        check("signed events tab", page.locator("#panel-events").is_visible()
              and not page.locator("#panel-trail").is_visible())
        page.click("#verify-chain-btn")
        page.wait_for_timeout(800)
        check("verify chain refreshes", "Chain verified:" in page.locator("#chain-status").inner_text())

        # audit forbidden for operator (fresh context)
        opctx = browser.new_context(viewport={"width": 1280, "height": 800})
        page2 = opctx.new_page()
        login(page2, "nw.operator@example.com")
        page2.goto(BASE + "/console/audit")
        page2.wait_for_load_state("networkidle")
        check("operator blocked from audit", "You do not have access to this page" in page2.locator("main").inner_text())
        opctx.close()
        ctx.close()

        # ---------- 375px phone layout ----------
        ctx = browser.new_context(viewport={"width": 375, "height": 812})
        page = ctx.new_page()
        page.goto(BASE + "/")
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        check("landing no sideways scroll at 375", not overflow)
        check("phone menu button", page.locator('.phone-menu-btn[aria-controls="phone-sheet"]').is_visible())
        page.goto(BASE + "/console/approvals")
        page.wait_for_load_state()
        if "/login" in page.url:
            login(page, "nw.approver1@example.com")
            page.goto(BASE + "/console/approvals")
            page.wait_for_load_state("networkidle")
        overflow = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
        check("approvals no sideways scroll at 375", not overflow)
        approve_btn = page.locator(".approve-btn").first
        if approve_btn.count():
            box = approve_btn.bounding_box()
            check("approve inside screen", box is not None and box["x"] >= 0 and box["x"] + box["width"] <= 375, box)
        for path in ["/pricing", "/contact", "/console", "/console/intents", "/console/settings",
                     "/console/wallets/wal_operating", "/console/policies/pol_operating",
                     "/console/quorums", "/console/audit", "/console/approvals"]:
            page.goto(BASE + path)
            page.wait_for_load_state()
            if "/login" in page.url:
                login(page, "nw.approver1@example.com")
                page.goto(BASE + path)
                page.wait_for_load_state("networkidle")
            o = page.evaluate("document.documentElement.scrollWidth > document.documentElement.clientWidth + 1")
            check(f"no sideways scroll {path}", not o)
        ctx.close()

        browser.close()

    print(f"\nUI PASS {PASS} FAIL {FAIL}")
    if FAILURES:
        print("Failures:", *["- " + f for f in FAILURES], sep="\n")
    sys.exit(1 if FAIL else 0)


if __name__ == "__main__":
    main()
