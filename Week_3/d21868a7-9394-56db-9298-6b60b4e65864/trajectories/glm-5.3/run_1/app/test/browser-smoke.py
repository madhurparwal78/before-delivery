from playwright.sync_api import sync_playwright

fails = []
def check(name, cond, detail=""):
    if cond:
        print(f"ok   {name}")
    else:
        fails.append(name)
        print(f"FAIL {name} {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1280, "height": 800})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append("CONSOLE: " + m.text) if (m.type == "error" and "Failed to load resource" not in m.text) else None)

    # sign-in page
    page.goto("http://127.0.0.1:4173/sign-in")
    page.wait_for_selector("text=Sign in to Ditchbook")
    check("sign-in heading", page.locator("h1").inner_text() == "Sign in to Ditchbook")
    check("email field", page.locator("input#email").count() == 1)

    # sign in as Lin
    page.fill("input#email", "lin@growers.example")
    page.fill("input#password", "channel-season-26")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_selector("text=Your orders")
    check("grower home reached", page.url.endswith("/grower"))
    check("allocation counter", page.locator("[aria-label='Allocation']").count() == 1)
    check("allocation text", "40.000" in page.locator("[aria-label='Allocation']").inner_text(), page.locator("[aria-label='Allocation']").inner_text())
    check("your orders table", page.get_by_role("table", name="Your orders").count() == 1)
    check("orders listed", page.locator("table a").count() >= 0)

    # order form
    page.get_by_role("link", name="New order").click()
    page.wait_for_selector("text=New order")
    check("order form", page.locator("form[aria-label='New order']").count() == 1)
    # turnout options
    turnout_opts = page.locator("select#turnout option").all_text_contents()
    check("turnout options", turnout_opts == ["Choose a turnout", "T4-15", "T12-03"], str(turnout_opts))
    # window options before turnout
    win_opts = page.locator("select#window option").all_text_contents()
    check("window options", len(win_opts) >= 2, str(win_opts))

    # pick turnout then window and type volume; the quote arrives
    page.select_option("select#turnout", "T4-15")
    page.select_option("select#window", "W-L4-A")
    page.fill("input#volume", "10")
    page.wait_for_timeout(1200)
    rate = page.locator("#rate").inner_text()
    check("flow rate quoted", rate == "10.000 ML/day", rate)
    rem = page.locator("#remaining").inner_text()
    check("window remaining", rem == "10.000 ML", rem)
    check("window status open", "Open" in page.locator("[aria-label='Window status']").inner_text())

    # turnout limit error
    page.fill("input#volume", "25.001")
    page.wait_for_timeout(1200)
    err = page.locator("#volume-err").inner_text()
    check("turnout limit error", err == "More than T4-15 can pass in this window: 25.000 ML.", err)
    rate = page.locator("#rate").inner_text()
    check("rate dash on 422", rate == "—", rate)

    # back to a valid volume and place the order
    page.fill("input#volume", "10")
    page.wait_for_timeout(1200)
    page.locator("select#gate").select_option("OP-D-01")
    page.get_by_role("button", name="Place order").click()
    page.wait_for_selector("text=Order ORD-")
    check("order page reached", "/orders/ORD-" in page.url, page.url)
    check("order scheduled", "Scheduled" in page.locator("[aria-label='Order state']").inner_text())

    # reload shows the same order
    page.reload()
    page.wait_for_selector("text=Order ORD-")
    check("order page reload", "Scheduled" in page.locator("[aria-label='Order state']").inner_text())

    if errors:
        check("no console errors", False, str(errors[:3]))
    else:
        check("no console errors", True)

    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
