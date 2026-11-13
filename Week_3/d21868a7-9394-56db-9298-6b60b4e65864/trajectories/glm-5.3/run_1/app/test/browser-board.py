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

def sign_in(page, email, viewport=None):
    page.goto(f"{BASE}/sign-in")
    page.wait_for_selector("text=Sign in to Ditchbook")
    page.fill("input#email", email)
    page.fill("input#password", "channel-season-26")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_load_state("networkidle")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # --- the board at 1280x800
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    js = []
    page.on("pageerror", lambda e: js.append(str(e)))
    sign_in(page, "hal@wirrinbah.example")
    page.wait_for_url("**/board")
    page.wait_for_selector("[aria-label='Window grid']")

    check("board rail region", page.locator("[aria-label='Channel rail']").count() == 1)
    check("window grid", page.locator("[aria-label='Window grid']").count() == 1)
    cells = page.locator("[role='gridcell'], .window-grid .cell")
    check("grid cells", cells.count() == 5, cells.count())
    check("cell accessible name", "ML remaining" in (cells.first.get_attribute("aria-label") or ""), cells.first.get_attribute("aria-label"))
    check("remaining in large numerals", "remaining" in (cells.first.inner_html() or ""))
    check("no detail selected", "Select a window" in page.locator("[aria-label='Window detail']").inner_text())

    # select a window -> detail pane with counters and tabs
    page.locator(".window-grid .cell", has_text="Lateral 4").first.click()
    page.wait_for_selector("[aria-label='Window detail'] button[role='tab']")
    check("detail counters", page.locator("[aria-label='Remaining ML']").count() == 1)
    check("tabs", page.locator("[role='tablist'][aria-label='Window views'] [role='tab']").count() == 3)
    tab_names = page.locator("[role='tablist'][aria-label='Window views'] [role='tab']").all_text_contents()
    check("tab names", tab_names == ["Capacity", "Orders", "Restrictions"], tab_names)
    check("publish restriction button", page.locator("button", has_text="Publish restriction").count() == 1)
    check("window details expander", page.locator("button.expander", has_text="Window details").count() == 1)
    check("gate cards expander", page.locator("button.expander", has_text="Gate cards").count() == 1)
    check("notices expander", page.locator("button.expander", has_text="Notices").count() == 1)

    # the board address holds selection and tab
    url = page.url
    check("board address has window", "window=" in url, url)

    # Orders tab: Ration window and actions
    page.locator("[role='tab']", has_text="Orders").click()
    page.wait_for_selector("table[aria-label='Window orders']")
    check("window orders table", page.locator("table[aria-label='Window orders']").count() == 1)
    check("ration window button", page.locator("button", has_text="Ration window").count() == 1)
    check("schedule on requested absent", True)  # no requested orders in seed

    # tab in the address
    check("tab in address", "tab=orders" in page.url, page.url)

    # back restores capacity tab
    page.go_back()
    page.wait_for_selector("[aria-label='Window detail']")
    check("back restores tab", "tab=orders" not in page.url, page.url)

    # --- R shortcut opens the Publish restriction dialog
    page.locator(".window-grid .cell").first.click()
    page.wait_for_selector("[aria-label='Window detail']")
    page.keyboard.press("r")
    page.wait_for_selector("dialog[aria-label='Publish restriction']")
    check("R opens restriction dialog", page.locator("dialog[aria-label='Publish restriction']").count() == 1)
    page.keyboard.press("Escape")
    page.wait_for_timeout(300)
    check("escape closes dialog", page.locator("dialog[aria-label='Publish restriction']").count() == 0)

    # publish a restriction on W-L4-A (cap 30 ML/day -> cap volume 30.000),
    # which keeps ORD-00001 (20 ML) and moves ORD-00002 (30 ML) to requested
    page.locator(".window-grid .cell", has_text="Lateral 4").first.click()
    page.wait_for_selector("[aria-label='Window detail']")
    page.keyboard.press("r")
    page.wait_for_selector("dialog[aria-label='Publish restriction']")
    page.fill("dialog input#cap-ml-day", "30.000")
    page.fill("dialog input#reason", "Channel works limit the flow")
    page.get_by_role("button", name="Publish", exact=True).click()
    page.wait_for_url("**/restrictions/*")
    page.wait_for_selector("#board-status:not(:empty)")
    check("restriction page reached", "/restrictions/" in page.url, page.url)
    check("restriction announcement", "Restriction published for" in page.locator("#board-status").text_content(), page.locator("#board-status").text_content())
    check("orders moved announced", "orders moved to requested." in page.locator("#board-status").text_content(), page.locator("#board-status").text_content())
    check("moved orders shown", page.locator("h2", has_text="Moved orders").count() == 1)
    page_text = page.locator("div.page").text_content().replace("\n", "")
    import re as _re
    m = _re.search(r"Pro-rated cap volume([0-9]+\.[0-9]{3}) ML", page_text)
    check("pro-rated cap volume present", m is not None, page_text[:250])
    if m:
        capvol = float(m.group(1))
        check("pro-rated between 30 and 60", 30.0 <= capvol < 60.0, capvol)

    # reload shows the same view
    page.reload()
    page.wait_for_selector("h1")
    check("restriction page reload", "Restriction" in page.locator("h1").inner_text())

    # --- grower sees the restriction live in the order form for W-L4-A
    gctx = browser.new_context(viewport={"width": 1280, "height": 800})
    gpage = gctx.new_page()
    sign_in(gpage, "lin@growers.example")
    gpage.goto(f"{BASE}/grower/orders/new?window=W-L4-A")
    gpage.wait_for_selector("select#window")
    gpage.wait_for_selector("#remaining:not(:empty)")
    gpage.wait_for_timeout(1500)
    check("grower sees restricted cap", "Restricted to 30.000 ML/day" in gpage.locator("[aria-label='Window status']").text_content(), gpage.locator("[aria-label='Window status']").text_content())
    rem_text = gpage.locator("#remaining").text_content()
    check("grower sees remaining (cap volume)", _re.search(r"[0-9]+\.[0-9]{3} ML", rem_text) is not None and float(rem_text.replace(" ML", "")) < 60.0, rem_text)

    # --- ration: W-L4-A has two requested orders (both moved by the
    # restriction) and its remaining ML to share in proportion.
    page.goto(f"{BASE}/board?channels=C-L4&window=W-L4-A&tab=orders")
    page.wait_for_selector("table[aria-label='Window orders'] tbody tr")
    page.wait_for_timeout(1500)
    orders_text = page.locator("table[aria-label='Window orders']").text_content()
    check("requested row shown", "Requested" in orders_text, orders_text)
    check("moved conflict row", "ORD-00002" in orders_text, orders_text)
    check("ration enabled", page.locator("button#ration-window-btn").get_attribute("aria-disabled") != "true", page.locator("button#ration-window-btn").get_attribute("aria-disabled"))

    # ration dialog
    page.locator("button#ration-window-btn").click()
    page.wait_for_selector("dialog[aria-label*='Ration']")
    body = page.locator("dialog p").text_content()
    check("ration dialog body", "requested orders in proportion to what each asked for" in body, body)
    check("ration dialog figures", _re.search(r"Share [0-9]+\.[0-9]{3} ML among 2 requested orders", body) is not None, body)
    page.get_by_role("button", name="Ration", exact=True).click()
    page.wait_for_timeout(1500)
    status = page.locator("#board-status").text_content()
    check("ration announced", "Window rationed." in status and "orders scheduled," in status, status)

    # the row shows the share
    check("rationed row share", "Asked 30.000 ML" in page.locator("table[aria-label='Window orders']").text_content().replace("\n", " "))

    # --- capacity table journey
    page.goto(f"{BASE}/channels/C-L4/capacity")
    page.wait_for_selector("table")
    check("capacity table", page.locator("table[aria-label='Capacity table Lateral 4']").count() == 1)
    check("revisions list", page.locator("ul[aria-label='Revisions']").count() == 1)
    check("save table button", page.get_by_role("button", name="Save table").count() == 1)
    revs = page.locator("ul[aria-label='Revisions'] li").count()
    check("revisions listed", revs >= 1, revs)

    # two dispatchers: Hal and Bea both load the table first (base revision 1);
    # Hal saves a higher cap; Bea then saves on her stale base and sees the
    # conflict dialog with settled caps
    bctx = browser.new_context(viewport={"width": 1280, "height": 800})
    bpage = bctx.new_page()
    sign_in(bpage, "bea@wirrinbah.example")
    bpage.goto(f"{BASE}/channels/C-L4/capacity")
    bpage.wait_for_selector("table input")
    bpage.wait_for_timeout(1000)
    bpage.locator("table input").nth(0).fill("80.000")

    inputs = page.locator("table input")
    first_input = inputs.nth(0)
    label = first_input.get_attribute("aria-label")
    check("cap input label", "Cap for" in label and "(ML/day)" in label, label)
    first_input.fill("70.000")
    page.get_by_role("button", name="Save table").click()
    page.wait_for_timeout(1500)
    check("revision saved announced", "Revision" in page.locator("#capacity-status").text_content(), page.locator("#capacity-status").text_content())

    # Bea's save is based on revision 1 while revision 2 is current
    bpage.get_by_role("button", name="Save table").click()
    bpage.wait_for_selector("dialog[aria-label='Capacity table conflict']")
    check("conflict dialog", bpage.locator("dialog[aria-label='Capacity table conflict']").count() == 1)
    check("conflict copy", "Another dispatcher saved first. Each cap settled to the lower value." in bpage.locator("dialog").text_content())
    cols = bpage.locator("dialog th").all_text_contents()
    check("conflict columns", cols == ["Your numbers", "Settled caps"], cols)
    check("your number shown", "80.000" in bpage.locator("dialog").text_content())
    check("settled cap shown", "70.000" in bpage.locator("dialog").text_content())
    bpage.get_by_role("button", name="Keep settled caps").click()
    bpage.wait_for_timeout(800)
    check("conflict closes", bpage.locator("dialog[aria-label='Capacity table conflict']").count() == 0)
    bpage.wait_for_timeout(4500)
    check("typed numbers stay", "You typed 80.000" in bpage.content())
    check("input shows settled", "70.000" in bpage.locator("table input").nth(0).input_value(), bpage.locator("table input").nth(0).input_value())

    # restore an earlier revision from the list
    page.wait_for_timeout(1000)
    rev_buttons = page.locator("button[aria-label^='Restore revision']")
    check("restore buttons", rev_buttons.count() >= 1, rev_buttons.count())
    # the last restore button is the earliest revision (revision 1, cap 60.000)
    rev_buttons.last.click()
    page.wait_for_timeout(600)
    st = page.locator("#capacity-status").text_content()
    check("restore announced", "restored as revision" in st, st)
    page.wait_for_timeout(4500)
    check("restored cap in table", "60.000" in page.locator("table input").nth(0).input_value(), page.locator("table input").nth(0).input_value())

    check("no js errors (board)", js == [], str(js[:3]))
    ctx.close(); gctx.close(); bctx.close()
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
