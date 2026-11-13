from playwright.sync_api import sync_playwright
import sys, datetime, json, urllib.request

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

    # --- DP-22: Space-held dwell works exactly like a pointer hold
    joctx = browser.new_context(viewport={"width": 1280, "height": 800})
    jopage = joctx.new_page(); jopage.on("pageerror", lambda e: js.append(str(e)))
    sign_in(jopage, "jo@contractors.example")
    jopage.wait_for_url("**/field")
    jopage.wait_for_selector("article")

    btn = jopage.locator("button[aria-label='Hold to stroke T4-07']")
    btn.focus()

    # press Space, hold 300ms, release: nothing sent
    jopage.keyboard.down(" ")
    jopage.wait_for_timeout(300)
    jopage.keyboard.up(" ")
    jopage.wait_for_timeout(300)
    progress = jopage.locator("[role=progressbar][aria-label='Dwell progress T4-07']").get_attribute("aria-valuenow")
    check("space release resets progress", progress == "0", progress)
    check("space release announced", "Released early. Stroke not sent." in jopage.locator("#gate-dwell-status").text_content(), jopage.locator("#gate-dwell-status").text_content())

    # hold Space for the full second: the stroke commits (key repeat ignored)
    jopage.keyboard.down(" ")
    jopage.wait_for_timeout(1100)
    jopage.keyboard.up(" ")
    jopage.wait_for_timeout(2000)
    status = jopage.locator("#gate-dwell-status").text_content()
    check("space-held stroke commits", "Stroke stored for T4-07" in status, status)
    check("flow after space stroke", "Flow now 20.000 ML/day." in status, status)

    # --- reduced motion: the sweep steps in quarters and counters jump to
    # their end states
    rmctx = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    rmpage = rmctx.new_page()
    sign_in(rmpage, "rory@wirrinbah.example")
    rmpage.wait_for_url("**/field")
    rmpage.wait_for_selector("h1")
    # Tess holds ORD-00002's start card (rostered holder OP-D-01? check the list)
    check("reduced motion has a card", rmpage.locator("button[aria-label^='Hold to stroke']").count() > 0, "no open card")
    if rmpage.locator("button[aria-label^='Hold to stroke']").count() > 0:
        turnout = rmpage.locator("button[aria-label^='Hold to stroke']").first.get_attribute("aria-label").replace("Hold to stroke ", "")
        rm_btn = rmpage.locator("button[aria-label^='Hold to stroke']").first
        box = rm_btn.bounding_box()
        rmpage.mouse.move(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        rmpage.mouse.down()
        rmpage.wait_for_timeout(120)
        sweep = rmpage.locator("button.dwell .sweep").first.evaluate("el => el.style.height")
        check("reduced motion steps the sweep", sweep in ("0%", "25%"), sweep)
        rmpage.mouse.up()
        rmpage.wait_for_timeout(200)
        check("reduced motion cancels to zero", rmpage.locator("button.dwell .sweep").first.evaluate("el => el.style.height") == "0%")

    # --- the pack withdraw guarantee at the API level: a pack that is still
    # building (submitted with the store momentarily unreachable in the
    # dedicated outage test) can be withdrawn; a mailed one cannot. Here the
    # services are up, so the first pack mails and withdrawal answers
    # pack_mailed, which proves the guard.
    pctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ppage = pctx.new_page(); ppage.on("pageerror", lambda e: js.append("priya: " + str(e)))
    sign_in(ppage, "priya@wirrinbah.example")
    today = (datetime.datetime.now(datetime.timezone.utc) + datetime.timedelta(hours=11)).strftime("%Y-%m-%d")
    ppage.goto(f"{BASE}/packs/new")
    ppage.wait_for_selector("form[aria-label='New pack']")
    ppage.fill("input#from", today)
    ppage.fill("input#to", today)
    ppage.fill("input#signatory", "Priya Anand")
    ppage.get_by_role("button", name="Preview pack").click()
    ppage.wait_for_selector("div[aria-label='Pack preview']:not(:empty)")
    ppage.get_by_role("button", name="Sign and submit pack").click()
    ppage.wait_for_url("**/packs/WP-*")
    pack_number = ppage.locator("h1").inner_text().replace("Pack ", "")
    ppage.wait_for_timeout(1500)
    r = ppage.evaluate(f"""async () => {{
      const res = await fetch('/api/packs/{pack_number}', {{method: 'DELETE'}});
      const body = await res.json();
      return {{status: res.status, error: body.error}};
    }}""")
    check("withdraw of a mailed pack answers pack_mailed", r["status"] == 409 and r["error"] == "pack_mailed", str(r))
    check("pack page shows digest", ppage.locator("[aria-label='Pack digest']").text_content().startswith("SHA-256 "))
    check("no withdraw button when mailed", ppage.get_by_role("button", name="Withdraw pack").count() == 0)
    pctx.close()

    check("no js errors", js == [], str(js[:4]))
    joctx.close(); rmctx.close()
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)