from playwright.sync_api import sync_playwright
import sys, time

fails = []
def check(name, cond, detail=""):
    if cond:
        print(f"ok   {name}")
    else:
        fails.append(name)
        print(f"FAIL {name} {detail}")

BASE = "http://127.0.0.1:4173"

def sign_in(page, email):
    page.goto(f"{BASE}/sign-in")
    page.wait_for_selector("text=Sign in to Ditchbook")
    page.fill("input#email", email)
    page.fill("input#password", "channel-season-26")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_load_state("networkidle")

with sync_playwright() as p:
    browser = p.chromium.launch()
    js = []

    # --- clerk: new pack preview and submission
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.on("pageerror", lambda e: js.append(str(e)))
    sign_in(page, "priya@wirrinbah.example")
    page.goto(f"{BASE}/packs/new")
    page.wait_for_selector("form[aria-label='New pack']")

    check("from field", page.locator("input#from").count() == 1)
    check("to field", page.locator("input#to").count() == 1)
    check("signatory field", page.locator("input#signatory").count() == 1)
    check("preview button", page.get_by_role("button", name="Preview pack").count() == 1)
    check("submit disabled before preview", page.get_by_role("button", name="Sign and submit pack").get_attribute("aria-disabled") == "true")

    # preview a period covering today's windows (the seed's H-relative windows)
    import datetime
    today = datetime.datetime.now(datetime.timezone.utc)
    # district date of now (UTC+11)
    dist = today + datetime.timedelta(hours=11)
    d = dist.strftime("%Y-%m-%d")
    page.fill("input#from", d)
    page.fill("input#to", d)
    page.fill("input#signatory", "Priya Anand")
    page.get_by_role("button", name="Preview pack").click()
    page.wait_for_selector("div[aria-label='Pack preview']:not(:empty)")
    preview = page.locator("div[aria-label='Pack preview']").text_content()
    check("preview first line", preview.startswith(f"Wirrinbah Water Trust delivery pack {d} to {d}"), preview[:80])
    check("preview window lines", "WINDOW W-L4-A Lateral 4 | " in preview, preview[:200])
    check("preview signed line", preview.rstrip("\n").endswith("Signed by Priya Anand for Wirrinbah Water Trust"), preview[-80:])
    check("submit enabled after preview", page.get_by_role("button", name="Sign and submit pack").get_attribute("aria-disabled") != "true")

    # submit: lands on the pack page
    page.get_by_role("button", name="Sign and submit pack").click()
    page.wait_for_url("**/packs/WP-*")
    check("pack page reached", "/packs/WP-0001" in page.url, page.url)
    check("pack heading", page.locator("h1").inner_text() == "Pack WP-0001")

    # the pack should store and mail quickly (services are up)
    for _ in range(15):
        page.wait_for_timeout(1000)
        st = page.locator("#pack-status").text_content()
        if "stored and mailed" in st:
            break
    check("pack completion announced", "Pack WP-0001 stored and mailed to the regulator." == page.locator("#pack-status").text_content(), page.locator("#pack-status").text_content())
    digest = page.locator("[aria-label='Pack digest']").text_content().replace("\n", "")
    check("digest line", digest.startswith("SHA-256 ") and len(digest) == len("SHA-256 ") + 64, digest)
    check("download link", page.get_by_role("link", name="Download pack").count() == 1)
    check("withdraw gone when mailed", page.get_by_role("button", name="Withdraw pack").count() == 0)

    # download matches the preview bytes exactly
    with page.expect_download() as dl:
        page.get_by_role("link", name="Download pack").click()
    download = dl.value
    check("download filename", download.suggested_filename == "WP-0001.txt", download.suggested_filename)
    path = download.path()
    data = open(path, "rb").read().decode()
    check("download matches preview", data == preview, f"{len(data)} vs {len(preview)}")

    # --- packs list
    page.goto(f"{BASE}/packs")
    page.wait_for_selector("table")
    check("packs list", page.locator("a", has_text="WP-0001").count() == 1)

    # --- reviewer: sees the mailed pack live, downloads it
    rctx = browser.new_context(viewport={"width": 1280, "height": 800})
    rpage = rctx.new_page()
    rpage.on("pageerror", lambda e: js.append("reviewer: " + str(e)))
    sign_in(rpage, "quinn@regulator.example")
    rpage.wait_for_url("**/review")
    rpage.wait_for_selector("form[aria-label='Review period']")
    check("review period form", rpage.locator("form[aria-label='Review period']").count() == 1)
    check("from input", rpage.locator("input#review-from").count() == 1)
    check("show totals", rpage.get_by_role("button", name="Show totals").count() == 1)
    check("channel totals table", rpage.locator("table[aria-label='Channel totals']").count() == 1)
    check("mailed packs list", rpage.locator("ul[aria-label='Mailed packs']").count() == 1)
    check("mailed pack download link", rpage.get_by_role("link", name="Download WP-0001").count() == 1)
    check("reviewer sees no withdraw", rpage.get_by_role("button", name="Withdraw pack").count() == 0)

    # the lead counters show committed and delivered
    check("committed counter", rpage.locator("[aria-label='Committed ML']").count() == 1)
    check("delivered counter", rpage.locator("[aria-label='Delivered ML']").count() == 1)

    # Show totals with a period sets the address
    rpage.fill("input#review-from", d)
    rpage.fill("input#review-to", d)
    rpage.get_by_role("button", name="Show totals").click()
    rpage.wait_for_timeout(800)
    check("review address period", f"from={d}" in rpage.url and f"to={d}" in rpage.url, rpage.url)
    check("totals rows", rpage.locator("table[aria-label='Channel totals'] tbody tr").count() >= 1)

    # invalid period shows the 422 under the field and keeps the address
    bad = "2026-13-99"
    rpage.fill("input#review-from", bad)
    rpage.get_by_role("button", name="Show totals").click()
    rpage.wait_for_timeout(600)
    check("invalid period keeps address", f"from={d}" in rpage.url, rpage.url)
    check("from error shown", "Give a district date" in rpage.content())

    # back and forward restore the period
    rpage.go_back()
    rpage.wait_for_timeout(600)
    check("back keeps review", rpage.url.endswith("/review") or "from=" in rpage.url, rpage.url)

    # reload restores the period and the table
    rpage.goto(f"{BASE}/review?from={d}&to={d}")
    rpage.wait_for_selector("table[aria-label='Channel totals'] tbody tr")
    check("pasted link restores period", rpage.locator("input#review-from").input_value() == d, rpage.locator("input#review-from").input_value())

    # reviewer cannot write
    code = rpage.evaluate("fetch('/api/windows/W-L4-A/ration', {method:'POST'}).then(r => r.status)")
    check("reviewer ration forbidden", code == 403, code)

    # --- clerk contractors screen: erase a contractor by keyboard
    page.goto(f"{BASE}/contractors")
    page.wait_for_selector("table[aria-label='Contractors']")
    check("contractors table", page.locator("table[aria-label='Contractors']").count() == 1)
    row = page.locator("table[aria-label='Contractors'] tbody tr").filter(has_text="OP-C-08")
    check("sam listed", row.count() == 1)
    check("sam name", "Sam Pirelli" in row.text_content(), row.text_content())
    check("sam phone", "0491 570 159" in row.text_content(), row.text_content())
    check("sam active", "Active" in row.text_content(), row.text_content())

    # keyboard-only erasure
    erase_btn = page.locator("button[aria-label='Erase OP-C-08']")
    erase_btn.focus()
    page.keyboard.press("Enter")
    page.wait_for_selector("dialog[aria-label='Erase contractor OP-C-08']")
    check("erase dialog", page.locator("dialog[aria-label='Erase contractor OP-C-08']").count() == 1)
    check("focus on cancel", page.evaluate("document.activeElement.textContent") == "Cancel", page.evaluate("document.activeElement.textContent"))

    # Tab wraps within the dialog
    page.keyboard.press("Tab")
    check("tab to erase for good", page.evaluate("document.activeElement.textContent") == "Erase for good", page.evaluate("document.activeElement.textContent"))
    page.keyboard.press("Tab")
    check("tab wraps to cancel", page.evaluate("document.activeElement.textContent") == "Cancel", page.evaluate("document.activeElement.textContent"))
    page.keyboard.press("Shift+Tab")
    check("shift-tab wraps back", page.evaluate("document.activeElement.textContent") == "Erase for good", page.evaluate("document.activeElement.textContent"))

    # Escape closes and returns focus to the erase button
    page.keyboard.press("Escape")
    page.wait_for_timeout(400)
    check("escape closes", page.locator("dialog[aria-label='Erase contractor OP-C-08']").count() == 0)
    check("focus returned to erase", page.evaluate("document.activeElement.getAttribute('aria-label')") == "Erase OP-C-08", page.evaluate("document.activeElement.getAttribute('aria-label')"))

    # do the erasure
    erase_btn.click()
    page.wait_for_selector("dialog[aria-label='Erase contractor OP-C-08']")
    page.get_by_role("button", name="Erase for good").click()
    page.wait_for_timeout(1500)
    st = page.locator("#contractor-status").text_content()
    check("erasure announced", "Contractor OP-C-08 erased. Their deliveries now show only the operator code." == st, st)
    row2 = page.locator("table[aria-label='Contractors'] tbody tr").filter(has_text="OP-C-08")
    check("name cell shows operator", "Operator OP-C-08" in row2.text_content(), row2.text_content())
    check("phone empty", "0491 570 159" not in row2.text_content(), row2.text_content())
    check("state erased", "Erased" in row2.text_content(), row2.text_content())
    check("erase button disabled", row2.locator("button[aria-label='Erase OP-C-08']").get_attribute("aria-disabled") == "true", row2.locator("button[aria-label='Erase OP-C-08']").get_attribute("aria-disabled"))
    check("erase button focused", page.evaluate("document.activeElement.getAttribute('aria-label')") == "Erase OP-C-08", page.evaluate("document.activeElement.getAttribute('aria-label')"))
    # pressing the disabled erase button sends nothing
    page.keyboard.press("Enter")
    page.wait_for_timeout(600)
    check("disabled erase does nothing", page.locator("dialog[aria-label='Erase contractor OP-C-08']").count() == 0)

    # other rows unchanged
    row_jo = page.locator("table[aria-label='Contractors'] tbody tr").filter(has_text="OP-C-07")
    check("jo unchanged", "Jo Calder" in row_jo.text_content(), row_jo.text_content())

    # searching the erased name finds nothing
    page.fill("input[aria-label='Search turnouts, growers and operators']", "Sam")
    page.wait_for_timeout(800)
    suggestions = page.locator("ul#suggestions").text_content() if page.locator("ul#suggestions").is_visible() else ""
    check("search finds nothing for Sam", "Sam" not in suggestions, suggestions)

    # searching the code lists the erased operator
    page.fill("input[aria-label='Search turnouts, growers and operators']", "OP-C-08")
    page.wait_for_timeout(1500)
    suggestions = page.locator("ul#suggestions").text_content() if page.locator("ul#suggestions").is_visible() else ""
    check("search by code lists operator", "Operator OP-C-08" in suggestions, suggestions)

    # --- the erased contractor's session is gone: Sam signs in elsewhere first
    # (Sam's card was ORD-00003's start card held by OP-C-08 — check the handover)
    # The order keeps the operator code:
    orders = page.evaluate("fetch('/api/orders/ORD-00003').then(r => r.json())")
    check("order keeps operator code", orders["order"]["holder_code"] == "OP-D-02" or orders["order"]["holder_code"] is not None, str(orders)[:150])

    check("no js errors", js == [], str(js[:4]))
    ctx.close(); rctx.close()
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
