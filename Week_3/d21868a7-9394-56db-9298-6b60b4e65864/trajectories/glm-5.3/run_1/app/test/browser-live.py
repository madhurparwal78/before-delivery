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

    # --- DP-79: the grower's open order page shows a dispatcher change live
    lctx = browser.new_context(viewport={"width": 1280, "height": 800})
    lpage = lctx.new_page(); lpage.on("pageerror", lambda e: js.append("lin: " + str(e)))
    sign_in(lpage, "lin@growers.example")
    lpage.goto(f"{BASE}/orders/ORD-00001")  # not Lin's order -> she goes home
    lpage.wait_for_timeout(800)
    # Lin's own order: she has none yet; place one first
    lpage.goto(f"{BASE}/grower/orders/new?window=W-L4-B")
    lpage.wait_for_timeout(1500)
    lpage.select_option("select#turnout", "T4-15")
    lpage.wait_for_timeout(400)
    lpage.select_option("select#window", "W-L4-B")
    lpage.wait_for_timeout(300)
    lpage.fill("input#volume", "10")
    lpage.wait_for_timeout(900)
    lpage.locator("select#gate").select_option("OP-D-01")
    lpage.get_by_role("button", name="Place order").click()
    lpage.wait_for_url("**/orders/ORD-*")
    order_number = lpage.url.rsplit("/", 1)[1]
    print("lin's order:", order_number)

    # the dispatcher closes Lin's order from another context; the open order
    # page must show the change within 5 seconds, announced
    hctx = browser.new_context(viewport={"width": 1280, "height": 800})
    hpage = hctx.new_page()
    sign_in(hpage, "hal@wirrinbah.example")
    hpage.evaluate(f"fetch('/api/orders/{order_number}/close', {{method:'POST'}})")
    changed = False
    for _ in range(8):
        lpage.wait_for_timeout(1000)
        if "Closed" in lpage.locator("[aria-label='Order state']").text_content():
            changed = True
            break
    check("order page shows live close", changed, lpage.locator("[aria-label='Order state']").text_content())
    check("order page announcement", f"Order {order_number} is now Closed." == lpage.locator("#order-status").text_content(), lpage.locator("#order-status").text_content())

    # the Cancel order button is gone for a closed order
    check("cancel gone when closed", lpage.get_by_role("button", name="Cancel order").count() == 0)

    # --- DP-73: the board follows the server's window close. The seed's
    # W-09-A closes at H+11h; create a window that closes within a minute and
    # confirm the open board shows the lapsed row without Schedule/Reopen.
    import datetime, json, urllib.request
    now = datetime.datetime.now(datetime.timezone.utc)
    # a whole number of hours: open 59m55s ago, close in 5s
    opens = (now - datetime.timedelta(seconds=3595)).strftime("%Y-%m-%dT%H:%M:%SZ")
    closes = (now + datetime.timedelta(seconds=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    cookie = hpage.context.cookies()[0]["value"]
    req = urllib.request.Request(f"{BASE}/api/channels/C-12/windows", data=json.dumps({
        "opens_at": opens, "closes_at": closes, "cap_ml_day": "10.000", "rostered_operator": "OP-D-01",
    }).encode(), headers={"Content-Type": "application/json", "Cookie": f"ditchbook_session={cookie}"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        new_window = json.load(resp)["window"]["id"]
    print("closing window:", new_window)

    # Lin orders into it, and the dispatcher opens the board for that window
    req = urllib.request.Request(f"{BASE}/api/orders", data=json.dumps({
        "turnout": "T12-03", "window_id": new_window, "volume_ml": "0.400", "operator_code": "OP-D-01",
    }).encode(), headers={"Content-Type": "application/json", "Cookie": f"ditchbook_session={lpage.context.cookies()[0]['value']}"}, method="POST")
    with urllib.request.urlopen(req) as resp:
        short_order = json.load(resp)["order"]["number"]
    print("short order:", short_order)

    hpage.goto(f"{BASE}/board?channels=C-12&window={new_window}&tab=orders")
    hpage.wait_for_selector("table[aria-label='Window orders'] tbody tr")
    check("row shows Scheduled before close", "Scheduled" in hpage.locator("table[aria-label='Window orders']").text_content())

    # wait past the close; the board must show the lapsed row within 5s of the
    # poll WITHOUT a reload, with the lapsed label and no Schedule/Reopen
    lapsed = False
    for _ in range(20):
        hpage.wait_for_timeout(1000)
        txt = hpage.locator("table[aria-label='Window orders']").text_content()
        if "Closed (lapsed)" in txt:
            lapsed = True
            break
    check("board shows lapsed row live", lapsed, hpage.locator("table[aria-label='Window orders']").text_content()[:200])
    check("no schedule on closed window", hpage.locator("button[aria-label^='Schedule order']").count() == 0)
    check("no reopen on closed window", hpage.locator("button[aria-label^='Reopen order']").count() == 0)
    # the window's remaining ML is restored in the detail pane
    rem = hpage.locator("[aria-label='Remaining ML']").text_content().replace("\n", "")
    check("remaining restored after lapse", rem != "", rem)
    # the grid cell's remaining equals the window's cap volume again
    grid_txt = hpage.locator("[aria-label='Window grid']").text_content().replace("\n", " ")
    check("grid cell shows restored remaining", ".000" in grid_txt, grid_txt[:80])

    # --- DP-64: the reviewer's Review page lists a newly mailed pack live
    qctx = browser.new_context(viewport={"width": 1280, "height": 800})
    qpage = qctx.new_page(); qpage.on("pageerror", lambda e: js.append("quinn: " + str(e)))
    sign_in(qpage, "quinn@regulator.example")
    qpage.wait_for_url("**/review")
    qpage.wait_for_selector("form[aria-label='Review period']")
    packs_before = qpage.get_by_role("link", name="Download WP-0001").count()

    pctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ppage = pctx.new_page()
    sign_in(ppage, "priya@wirrinbah.example")
    doc = ppage.evaluate("""async () => {
      const res = await fetch('/api/packs/preview?from=2026-11-12&to=2026-11-12&signatory=Priya%20Anand');
      return await res.text();
    }""")
    ppage.evaluate("""async (doc) => {
      await fetch('/api/packs', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({from: '2026-11-12', to: '2026-11-12', signatory: 'Priya Anand', document: doc})});
    }""", doc)

    listed = False
    for _ in range(10):
        qpage.wait_for_timeout(1000)
        if qpage.get_by_role("link", name="Download WP-0001").count() > packs_before:
            listed = True
            break
    check("review lists new pack within seconds", listed)
    if listed:
        check("review announces new pack", "Pack WP-0001 received from the district." == qpage.locator("#review-status").text_content(), qpage.locator("#review-status").text_content())

    check("no js errors", js == [], str(js[:4]))
    lctx.close(); hctx.close(); qctx.close(); pctx.close()
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
