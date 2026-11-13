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
    mail = []

    # --- journey 2: contested megalitres. W-L4-A has 10 ML left. Mara and Lin
    # each order exactly 10 ML at the same moment.
    mctx = browser.new_context(viewport={"width": 1280, "height": 800})
    mpage = mctx.new_page(); mpage.on("pageerror", lambda e: js.append("mara: " + str(e)))
    lctx = browser.new_context(viewport={"width": 1280, "height": 800})
    lpage = lctx.new_page(); lpage.on("pageerror", lambda e: js.append("lin: " + str(e)))

    import urllib.request, json as _json
    urllib.request.urlopen(urllib.request.Request("http://mailpit:8025/api/v1/messages", method="DELETE"))
    sign_in(mpage, "mara@growers.example")
    sign_in(lpage, "lin@growers.example")

    for pg in (mpage, lpage):
        pg.goto(f"{BASE}/grower/orders/new?window=W-L4-A")
        pg.wait_for_timeout(1200)
        pg.select_option("select#turnout", "T4-09" if pg is mpage else "T4-15")
        pg.wait_for_timeout(400)
        pg.select_option("select#window", "W-L4-A")
        pg.wait_for_timeout(300)
        pg.fill("input#volume", "10")
        pg.locator("select#gate").select_option("OP-D-01")

    # both press Place order within milliseconds of each other; the two HTTP
    # requests are in flight at once and the server judges them in one step
    results = {}
    mpage.get_by_role("button", name="Place order").click()
    lpage.get_by_role("button", name="Place order").click()
    for pg, key in ((mpage, "mara"), (lpage, "lin")):
        try:
            pg.wait_for_url("**/orders/ORD-*", timeout=10000)
            results[key] = "scheduled"
        except Exception:
            results[key] = "conflict"

    sorted_res = sorted(results.values())
    check("one scheduled one conflict", sorted_res == ["conflict", "scheduled"], results)

    # the loser sees the Capacity taken dialog
    loser_page = mpage if results.get("mara") == "conflict" else lpage
    winner_page = mpage if results.get("mara") == "scheduled" else lpage
    loser_page.wait_for_selector("dialog[aria-label='Capacity taken']")
    check("capacity taken dialog", loser_page.locator("dialog[aria-label='Capacity taken']").count() == 1)
    dlg_text = loser_page.locator("dialog[aria-label='Capacity taken']").text_content().replace("\n", " ")
    check("dialog heading", "Capacity taken" in dlg_text, dlg_text)
    check("dialog body copy", "Another order took the last of this window's capacity. Nothing was debited from your allocation." in dlg_text, dlg_text)
    check("dialog back button", loser_page.get_by_role("button", name="Back to the order").count() == 1)

    # the loser's Window remaining shows the 409's remaining_ml (0.000)
    check("loser window remaining", "0.000" in loser_page.locator("#remaining").text_content(), loser_page.locator("#remaining").text_content())

    # the winner is on their scheduled order page
    check("winner on order page", "/orders/ORD-" in winner_page.url, winner_page.url)

    # the loser's allocation counter shows their unchanged figure (re-read)
    loser_alloc = loser_page.locator("[aria-label='Allocation']").text_content().replace("\n", "")
    expected = "100.000" if "mara" in str(results) else None
    # the loser keeps their own unchanged figure: Mara 100.000, Lin 40.000
    import urllib.request, json as _j
    with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=50") as r:
        pass
    loser_is_mara = results.get("mara") == "conflict"
    want_alloc = "100.000" if loser_is_mara else "40.000"
    check("loser allocation unchanged", want_alloc in loser_alloc, f"{loser_alloc} want {want_alloc}")

    # closing the dialog returns focus to Place order
    loser_page.get_by_role("button", name="Back to the order").click()
    loser_page.wait_for_timeout(300)
    check("focus back on place order", loser_page.evaluate("document.activeElement.textContent") == "Place order", loser_page.evaluate("document.activeElement.textContent"))

    # the conflict notice carries the loser's unchanged allocation
    found_conflict = None
    for _ in range(12):
        with urllib.request.urlopen("http://mailpit:8025/api/v1/messages?limit=50") as r:
            data = _json.load(r)
        for m in data.get("messages", []):
            if "capacity taken" in m["Subject"]:
                found_conflict = m
                break
        if found_conflict:
            break
        loser_page.wait_for_timeout(1000)
    check("conflict notice sent", found_conflict is not None)
    if found_conflict:
        loser_email = "mara@growers.example" if results.get("mara") == "conflict" else "lin@growers.example"
        check("notice to loser", loser_email in [t["Address"] for t in found_conflict["To"]], found_conflict["To"])
        with urllib.request.urlopen(f"http://mailpit:8025/api/v1/message/{found_conflict['ID']}") as r:
            body = r.read().decode()
        check("notice body copy", "Another order took the last of this window's capacity. Nothing was debited from your allocation." in body)
        check("notice allocation line", "Your allocation is unchanged at 100.000 ML." in body if loser_email.startswith("mara") else "Your allocation is unchanged at 40.000 ML." in body, body[-400:])

    # the two-orders-in-two-windows allocation race is covered by the API e2e
    # suite; the seed leaves only one orderable window per free turnout, so a
    # deterministic browser version is not buildable.


    check("no js errors", js == [], str(js[:4]))
    mctx.close(); lctx.close()
    browser.close()
print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
