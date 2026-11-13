from playwright.sync_api import sync_playwright
import sys

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

    # --- journey 5: an order is running; its finish card is held by a contractor
    # (Jo Calder OP-C-07 holds ORD-00001's start card). Start the delivery,
    # then the dispatcher removes Jo from the finish card; the standby (OP-D-02
    # Tess) gets it and finishes.
    joctx = browser.new_context(viewport={"width": 375, "height": 812}, has_touch=True)
    jopage = joctx.new_page(); jopage.on("pageerror", lambda e: js.append("jo: " + str(e)))
    sign_in(jopage, "jo@contractors.example")
    jopage.wait_for_url("**/field")
    jopage.wait_for_selector("article")
    jopage.locator("button[aria-label='Hold to stroke T4-07']").click(delay=1100)
    jopage.wait_for_timeout(2000)
    check("order running", "Stroke stored for T4-07" in jopage.locator("#gate-dwell-status").text_content(), jopage.locator("#gate-dwell-status").text_content())
    # the finish card is in Jo's list
    check("jo holds finish card", jopage.locator("button[aria-label='Hold to stroke T4-07']").count() == 1)

    # Tess Nguyen (OP-D-02) is on her field view
    tessctx = browser.new_context(viewport={"width": 1280, "height": 800})
    tesspage = tessctx.new_page(); tesspage.on("pageerror", lambda e: js.append("tess: " + str(e)))
    sign_in(tesspage, "tess@wirrinbah.example")
    tesspage.wait_for_url("**/field")
    tesspage.wait_for_selector("h1")
    check("tess has no T4-07 card yet", tesspage.locator("article[aria-label='Gate card T4-07']").count() == 0)

    # the dispatcher removes Jo from the finish card
    halctx = browser.new_context(viewport={"width": 1280, "height": 800})
    halpage = halctx.new_page(); halpage.on("pageerror", lambda e: js.append("hal: " + str(e)))
    sign_in(halpage, "hal@wirrinbah.example")
    halpage.wait_for_url("**/board")
    halpage.goto(f"{BASE}/board?channels=C-L4&window=W-L4-A&tab=capacity")
    halpage.wait_for_selector("button.expander")
    halpage.locator("button.expander", has_text="Gate cards").click()
    halpage.wait_for_selector("button[aria-label='Remove holder T4-07']")
    halpage.locator("button[aria-label='Remove holder T4-07']").click()
    halpage.wait_for_timeout(800)
    check("handover announced", "Gate card for T4-07 handed to OP-D-02." == halpage.locator("#board-status").text_content(), halpage.locator("#board-status").text_content())

    # within seconds Jo's view drops the card and Tess's view gains it
    deadline_found = False
    for _ in range(6):
        jopage.wait_for_timeout(1000)
        if jopage.locator("button[aria-label='Hold to stroke T4-07']").count() == 0 and tesspage.locator("button[aria-label='Hold to stroke T4-07']").count() == 1:
            deadline_found = True
            break
    jo_count = jopage.locator("button[aria-label='Hold to stroke T4-07']").count()
    tess_count = tesspage.locator("button[aria-label='Hold to stroke T4-07']").count()
    check("handover reaches open field views", deadline_found, f"jo={jo_count} tess={tess_count}")
    tess_status_now = tesspage.locator("#gate-dwell-status").text_content()
    jo_status_now = jopage.locator("#gate-dwell-status").text_content()
    check("tess handover announcement", "Gate card for T4-07 is now yours." in tess_status_now, tess_status_now)
    check("jo handover announcement", "This gate card has moved to another operator." in jo_status_now, jo_status_now)

    # Jo tries the moved card: refused with not_holder
    # (his view no longer shows the open card, so he cannot dwell on it)
    check("jo view drops open card", jopage.locator("button[aria-label='Hold to stroke T4-07']").count() == 0)

    # Tess finishes the delivery with one stroke
    tesspage.locator("button[aria-label='Hold to stroke T4-07']").click(delay=1100)
    tesspage.wait_for_timeout(2000)
    check("tess finish stored", "Stroke stored for T4-07" in tesspage.locator("#gate-dwell-status").text_content(), tesspage.locator("#gate-dwell-status").text_content())
    delivered = tesspage.locator("[aria-label='Delivered']").first.text_content().replace("\n", "")
    check("delivered counts once", "20.000" in delivered, delivered)
    # the start stroke was never repeated: the channel flow is back to 0
    flow = tesspage.locator("[aria-label='Channel flow']").first.text_content().replace("\n", "")
    check("flow back to zero", "0.000" in flow, flow)

    # Tess held only the finish card: it is spent, and the start card was
    # never hers, so her list keeps exactly one spent T4-07 card
    articles = tesspage.locator("article[aria-label='Gate card T4-07']")
    check("one spent finish card for tess", articles.count() == 1, articles.count())
    check("tess stroke record shown", tesspage.locator("[aria-label='Stroke record T4-07']").count() == 1)

    # Jo's view still shows his spent start card (his own record)
    check("jo keeps his spent start card", jopage.locator("article[aria-label='Gate card T4-07']").count() >= 1)

    # --- journey 1 tail: the session ends while Lin is on the order form
    lctx = browser.new_context(viewport={"width": 1280, "height": 800})
    lpage = lctx.new_page(); lpage.on("pageerror", lambda e: js.append("lin: " + str(e)))
    sign_in(lpage, "lin@growers.example")
    lpage.goto(f"{BASE}/grower/orders/new?window=W-L4-B")
    lpage.wait_for_timeout(1200)
    lpage.select_option("select#turnout", "T4-15")
    lpage.wait_for_timeout(400)
    lpage.select_option("select#window", "W-L4-B")
    lpage.wait_for_timeout(300)
    lpage.fill("input#volume", "12.5")
    lpage.wait_for_timeout(900)
    lpage.locator("select#gate").select_option("OP-D-01")
    lpage.locator("select#standby").select_option("OP-D-02")
    check("draft form filled", lpage.locator("input#volume").input_value() == "12.5")

    # end the session server-side (another tab signs out)
    lpage.evaluate("fetch('/api/session', {method: 'DELETE'})")
    lpage.wait_for_timeout(4500)
    check("ended session goes to sign-in", "/sign-in" in lpage.url, lpage.url)
    check("return path kept", "return=" in lpage.url, lpage.url)

    # sign in again as the same grower
    lpage.fill("input#email", "lin@growers.example")
    lpage.fill("input#password", "channel-season-26")
    lpage.get_by_role("button", name="Sign in").click()
    lpage.wait_for_timeout(1500)
    check("returns to the order form", "/grower/orders/new" in lpage.url, lpage.url)
    check("draft restored notice", "Your session ended. Your order is as you left it. Check it and place it again." == lpage.locator("#order-status-2").text_content(), lpage.locator("#order-status-2").text_content())
    check("draft turnout restored", lpage.locator("select#turnout").input_value() == "T4-15", lpage.locator("select#turnout").input_value())
    check("draft volume restored", lpage.locator("input#volume").input_value() == "12.5", lpage.locator("input#volume").input_value())
    check("draft gate restored", lpage.locator("select#gate").input_value() == "OP-D-01", lpage.locator("select#gate").input_value())
    check("draft standby restored", lpage.locator("select#standby").input_value() == "OP-D-02", lpage.locator("select#standby").input_value())
    check("window restored", lpage.locator("select#window").input_value() == "W-L4-B", lpage.locator("select#window").input_value())
    check("nothing placed yet", "/orders/ORD-" not in lpage.url, lpage.url)

    # a different grower never sees another grower's draft
    dctx = browser.new_context(viewport={"width": 1280, "height": 800})
    dpage = dctx.new_page()
    sign_in(dpage, "dev@growers.example")
    dpage.goto(f"{BASE}/grower/orders/new?window=W-L4-B")
    dpage.wait_for_timeout(1200)
    check("dev sees no foreign draft", dpage.locator("input#volume").input_value() == "", dpage.locator("input#volume").input_value())

    check("no js errors", js == [], str(js[:4]))
    joctx.close(); tessctx.close(); halctx.close(); lctx.close(); dctx.close()
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
