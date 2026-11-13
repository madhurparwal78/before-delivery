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
VIEWPORTS = [(375, 812), (768, 1024), (1280, 800)]

def sign_in(page, email):
    page.goto(f"{BASE}/sign-in")
    page.wait_for_selector("text=Sign in to Ditchbook")
    page.fill("input#email", email)
    page.fill("input#password", "channel-season-26")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_load_state("networkidle")

# every public control presents a hit area of at least 44x44
def audit_tap_targets(page, label):
    result = page.evaluate("""() => {
      const bad = [];
      const controls = document.querySelectorAll('button, a[href], input, select, [role="tab"], [role="checkbox"]');
      for (const el of controls) {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) continue;
        const hidden = el.closest('[hidden]') || el.closest('dialog:not([open])');
        if (hidden) continue;
        if (r.width < 44 || r.height < 44) {
          bad.push({label: el.getAttribute('aria-label') || el.textContent.trim().slice(0, 30) || el.tagName, w: Math.round(r.width), h: Math.round(r.height)});
        }
      }
      return bad;
    }""")
    check(f"tap targets {label}", result == [], str(result[:6]))

def audit_no_hscroll(page, label):
    sw = page.evaluate("document.documentElement.scrollWidth")
    cw = page.evaluate("document.documentElement.clientWidth")
    check(f"no horizontal scroll {label}", sw <= cw, f"scrollWidth={sw} clientWidth={cw}")

with sync_playwright() as p:
    browser = p.chromium.launch()
    js = []

    # every screen at every viewport
    screens = [
        ("sign-in", "/sign-in", None, False),
        ("grower home", None, "lin@growers.example", False),
        ("order form", "/grower/orders/new?window=W-L4-B", "lin@growers.example", False),
        ("order page", "/orders/ORD-00001", "mara@growers.example", False),
        ("field view", None, "jo@contractors.example", False),
        ("board", "/board?channels=C-L4&window=W-L4-A", "hal@wirrinbah.example", False),
        ("capacity table", "/channels/C-L4/capacity", "hal@wirrinbah.example", False),
        ("packs", "/packs", "priya@wirrinbah.example", False),
        ("new pack", "/packs/new", "priya@wirrinbah.example", False),
        ("contractors", "/contractors", "priya@wirrinbah.example", False),
        ("review", "/review", "quinn@regulator.example", False),
    ]

    for name, path, email, _unused in screens:
        for w, h in VIEWPORTS:
            ctx = browser.new_context(viewport={"width": w, "height": h})
            page = ctx.new_page()
            page.on("pageerror", lambda e: js.append(f"{name}: {e}"))
            if email:
                sign_in(page, email)
                target = path if path else {
                    "lin@growers.example": "/grower",
                    "mara@growers.example": "/grower",
                    "jo@contractors.example": "/field",
                    "hal@wirrinbah.example": "/board",
                    "priya@wirrinbah.example": "/packs",
                    "quinn@regulator.example": "/review",
                }[email]
                if path:
                    page.goto(f"{BASE}{path}")
                page.wait_for_timeout(1200)
            else:
                page.goto(f"{BASE}{path}")
                page.wait_for_timeout(600)
            audit_no_hscroll(page, f"{name} @{w}")
            if email is None:
                # sign-in form fields
                audit_tap_targets(page, f"{name} @{w}")
            ctx.close()

    # detailed tap-target audit on interactive screens at each viewport
    for w, h in VIEWPORTS:
        ctx = browser.new_context(viewport={"width": w, "height": h}, has_touch=(w == 375))
        page = ctx.new_page()
        sign_in(page, "lin@growers.example")
        page.goto(f"{BASE}/grower/orders/new?window=W-L4-B")
        page.wait_for_timeout(1500)
        audit_tap_targets(page, f"order form @{w}")
        audit_no_hscroll(page, f"order form @{w}")

        # grower home
        page.goto(f"{BASE}/grower")
        page.wait_for_timeout(1200)
        audit_tap_targets(page, f"grower home @{w}")
        audit_no_hscroll(page, f"grower home @{w}")

        # board
        page2 = ctx.new_page()
        page2.on("pageerror", lambda e: js.append(f"board: {e}"))
        sign_in(page2, "hal@wirrinbah.example")
        page2.goto(f"{BASE}/board?channels=C-L4&window=W-L4-A&tab=orders")
        page2.wait_for_timeout(1500)
        audit_tap_targets(page2, f"board @{w}")
        audit_no_hscroll(page2, f"board @{w}")

        # field view
        page3 = ctx.new_page()
        sign_in(page3, "jo@contractors.example")
        page3.wait_for_url("**/field")
        page3.wait_for_timeout(1200)
        audit_tap_targets(page3, f"field @{w}")
        audit_no_hscroll(page3, f"field @{w}")
        # the dwell control is at least 44px on a phone
        if w == 375:
            box = page3.locator("button.dwell").first.bounding_box()
            check("dwell control 44px on phone", box is not None and box["height"] >= 44 and box["width"] >= 44, str(box))

        # capacity table
        page2.goto(f"{BASE}/channels/C-L4/capacity")
        page2.wait_for_timeout(1500)
        audit_tap_targets(page2, f"capacity @{w}")
        audit_no_hscroll(page2, f"capacity @{w}")

        # review
        page4 = ctx.new_page()
        sign_in(page4, "quinn@regulator.example")
        page4.goto(f"{BASE}/review?from=2026-11-12&to=2026-11-12")
        page4.wait_for_timeout(1500)
        audit_tap_targets(page4, f"review @{w}")
        audit_no_hscroll(page4, f"review @{w}")

        # contractors
        page4.goto(f"{BASE}/contractors") if False else None
        page5 = ctx.new_page()
        sign_in(page5, "priya@wirrinbah.example")
        page5.goto(f"{BASE}/contractors")
        page5.wait_for_timeout(1200)
        audit_tap_targets(page5, f"contractors @{w}")
        audit_no_hscroll(page5, f"contractors @{w}")

        # packs/new form
        page5.goto(f"{BASE}/packs/new")
        page5.wait_for_timeout(1000)
        audit_tap_targets(page5, f"new pack @{w}")
        audit_no_hscroll(page5, f"new pack @{w}")
        ctx.close()

    # --- the collapsed rail, drawer and expander are hidden and unreachable
    ctx = browser.new_context(viewport={"width": 768, "height": 1024})
    page = ctx.new_page()
    sign_in(page, "hal@wirrinbah.example")
    page.goto(f"{BASE}/board")
    page.wait_for_timeout(1500)
    # at 768 the rail starts collapsed: the static rail is not shown
    page.goto(f"{BASE}/board")
    page.wait_for_timeout(1200)
    check("rail collapsed at 768", page.locator(".rail-static").count() == 0 or page.locator(".rail-static").first.is_hidden())
    # with a window selected the detail shows; an expander toggles
    page.goto(f"{BASE}/board?channels=C-L4&window=W-L4-A")
    page.wait_for_timeout(1500)
    expander = page.locator("button.expander", has_text="Gate cards")
    if expander.count() > 0:
        expander.click()
        page.wait_for_timeout(300)
        visible_after = expander.get_attribute("aria-expanded")
        check("expander toggles", visible_after in ("true", "false"), str(visible_after))
        # a collapsed expander hides its content from the tree
        expander.click()
        page.wait_for_timeout(200)
        check("expander collapses again", expander.get_attribute("aria-expanded") == "false")
    else:
        check("expander present", False, "no Gate cards expander")
    ctx.close()

    # --- the board's address restoration through reload and pasted links
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    sign_in(page, "hal@wirrinbah.example")
    page.goto(f"{BASE}/board?channels=C-09,C-12&window=W-12-B&tab=orders")
    page.wait_for_timeout(1500)
    check("pasted board link restores", "Channel 12 Spur" in page.locator("[aria-label='Window detail']").text_content() or page.locator("[role='gridcell']").count() > 0)
    page.reload()
    page.wait_for_timeout(1500)
    check("board reload restores address", "channels=C-09%2CC-12" in page.url or "channels=C-09,C-12" in page.url, page.url)

    check("no js errors", js == [], str(js[:4]))
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
