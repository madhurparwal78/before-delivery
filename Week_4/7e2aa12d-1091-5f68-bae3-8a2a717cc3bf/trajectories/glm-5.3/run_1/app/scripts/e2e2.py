"""Browser E2E part 2: co-editing, versions drawer, share dialog, view page, phone tabs."""
import re
import sys
import urllib.parse
import time
from playwright.sync_api import sync_playwright, expect

BASE = "http://127.0.0.1:4173"
failures = []


def check(name, condition, extra=""):
    if condition:
        print(f"ok   {name}")
    else:
        print(f"FAIL {name} {extra}")
        failures.append(name)


with sync_playwright() as p:
    browser = p.chromium.launch()
    ana_context = browser.new_context(viewport={"width": 1280, "height": 800})
    bob_context = browser.new_context(viewport={"width": 1280, "height": 800})
    ana = ana_context.new_page()
    bob = bob_context.new_page()
    ana.set_default_timeout(8000)
    bob.set_default_timeout(8000)

    stamp = int(time.time()) % 1000000
    ana_name = f"co-a{stamp}"
    bob_name = f"co-b{stamp}"

    # Ana creates an account and a Holy Grail layout.
    ana.goto(f"{BASE}/signup")
    ana.get_by_label("Username").fill(ana_name)
    ana.get_by_label("Password").fill("drafting-01")
    ana.get_by_role("button", name="Create account").click()
    ana.wait_for_url(f"{BASE}/")
    ana.get_by_role("button", name="New layout").click()
    ana.get_by_label("Layout name").fill("Co-edit test")
    ana.get_by_label("Holy Grail").check()
    ana.get_by_role("button", name="Create layout").click()
    ana.wait_for_url(re.compile(r"/layouts/"))
    ana.wait_for_selector('[role="gridcell"]')
    layout_url = urllib.parse.urlparse(ana.url).path

    # Ana shares the co-edit link with Bob through the Share dialog.
    ana.get_by_role("button", name="Share").click()
    ana.get_by_role("button", name="Regenerate co-edit link").click()
    ana.wait_for_timeout(800)
    join_link = ana.get_by_label("Co-edit link").input_value()
    check("co-edit link shown", join_link.startswith("/join/"), join_link)
    ana.keyboard.press("Escape")
    ana.wait_for_timeout(300)

    # Bob signs in and joins through the link.
    bob.goto(f"{BASE}/signup")
    bob.get_by_label("Username").fill(bob_name)
    bob.get_by_label("Password").fill("drafting-02")
    bob.get_by_role("button", name="Create account").click()
    bob.wait_for_url(f"{BASE}/")
    bob.goto(f"{BASE}{join_link}")
    bob.wait_for_url(re.compile(r"/layouts/"), timeout=15000)
    bob.wait_for_selector('[role="gridcell"]', timeout=15000)
    check("bob joined editor", bob.get_by_role("heading", name="Co-edit test").count() == 1)

    # Both see each other in Designers here.
    def list_names(page):
        return set(n.strip() for n in page.get_by_label("Designers here").inner_text().split("\n") if n.strip())
    ana_list = list_names(ana)
    for _ in range(30):
        if bob_name in ana_list and ana_name in ana_list:
            break
        ana.wait_for_timeout(500)
        ana_list = list_names(ana)
    bob_list = list_names(bob)
    for _ in range(30):
        if bob_name in bob_list and ana_name in bob_list:
            break
        bob.wait_for_timeout(500)
        bob_list = list_names(bob)
    ana_designers = "\n".join(sorted(ana_list))
    bob_designers = "\n".join(sorted(bob_list))
    check("ana sees both", ana_name in ana_designers and bob_name in ana_designers, ana_designers)
    check("bob sees both", ana_name in bob_designers and bob_name in bob_designers, bob_designers)

    # Bob changes a column; Ana sees the change live and the announcement.
    bob.get_by_label("Column 1 size").fill("2fr")
    bob.get_by_label("Column 1 size").press("Enter")
    expect(bob.get_by_label("Layout updates")).to_have_text("Column 1 set to 2fr.")
    ana.wait_for_timeout(1800)
    check("ana sees bob change live", ana.get_by_label("Column 1 size").input_value() == "2fr", ana.get_by_label("Column 1 size").input_value())
    check("ana announcement names bob", ana.get_by_label("Layout updates").inner_text() == f"{bob_name}: Column 1 set to 2fr.", ana.get_by_label("Layout updates").inner_text())

    # A conflict: both change column 2 at the same moment from the same base.
    ana_column2 = ana.get_by_label("Column 2 size")
    bob_column2 = bob.get_by_label("Column 2 size")
    # Both type the new size and press Enter at the same moment.
    ana_column2.fill("3fr")
    bob_column2.fill("4fr")
    ana_column2.press("Enter")
    bob_column2.press("Enter")
    bob.wait_for_timeout(2200)
    notice = bob.get_by_label("Editor notice").inner_text()
    loser_notice_ok = f"changed column 2 first." in notice
    check("one designer refused", loser_notice_ok, notice)
    check("both show winner size", ana_column2.input_value() == bob_column2.input_value(), (ana_column2.input_value(), bob_column2.input_value()))

    # Versions drawer: save two versions, compare, restore.
    ana.keyboard.press("Escape")
    ana.wait_for_timeout(400)
    ana.get_by_role("button", name="Save version").click()
    ana.get_by_label("Version name").fill("First pass")
    ana.get_by_role("button", name="Save", exact=True).click()
    expect(ana.get_by_label("Layout updates")).to_have_text("Version 1 saved.")

    ana_column2.fill("5fr")
    ana_column2.press("Enter")
    expect(ana.get_by_label("Layout updates")).to_have_text("Column 2 set to 5fr.")
    ana.get_by_role("button", name="Save version").click()
    ana.get_by_label("Version name").fill("Second pass")
    ana.get_by_role("button", name="Save", exact=True).click()
    expect(ana.get_by_label("Layout updates")).to_have_text("Version 2 saved.")

    ana.get_by_role("button", name="Versions").click()
    ana.wait_for_selector('.drawer[data-open]', timeout=8000)
    drawer = ana.get_by_role("dialog", name="Versions")
    expect(drawer).to_be_visible()
    check("drawer lists versions", "Version 1: First pass" in drawer.inner_text() and "Version 2: Second pass" in drawer.inner_text(), drawer.inner_text()[:120])

    ana.get_by_label("Compare from").select_option("1")
    ana.get_by_label("Compare to").select_option("2")
    ana.get_by_role("button", name="Compare").click()
    ana.wait_for_timeout(500)
    diffs = ana.get_by_label("Differences").inner_text()
    check("differences show column change", "5fr" in diffs and "4fr" in diffs and "Columns:" in diffs, diffs[:200])

    # Restore version 1 while Bob is editing.
    ana.get_by_role("button", name="Restore version 1").click()
    ana.get_by_role("button", name="Restore", exact=True).click()
    expect(ana.get_by_label("Layout updates")).to_have_text("Restored version 1.")
    ana.wait_for_timeout(500)
    check("ana restored", ana.get_by_label("Column 2 size").input_value() == "4fr", ana.get_by_label("Column 2 size").input_value())

    bob.wait_for_timeout(1800)
    check("bob sees restore", bob.get_by_label("Column 2 size").input_value() == "4fr", bob.get_by_label("Column 2 size").input_value())
    bob_notice = bob.get_by_label("Editor notice").inner_text()
    check("bob restore notice", bob_notice.startswith(f"{ana_name} restored version 1."), bob_notice)

    # Ana closes the drawer with Escape.
    ana.get_by_role("dialog", name="Versions").press("Escape")
    expect(ana.get_by_role("dialog", name="Versions")).to_have_count(0)
    check("drawer closes on escape", ana.get_by_role("dialog", name="Versions").count() == 0)

    # View page: create a link, open it signed out in a fresh context.
    ana.get_by_role("button", name="Share").click()
    ana.get_by_role("button", name="Create view link").click()
    ana.wait_for_timeout(400)
    view_link = ana.get_by_label("View link").input_value()
    check("view link shown", view_link.startswith("/view/"), view_link)

    view_context = browser.new_context(viewport={"width": 1280, "height": 800})
    viewer = view_context.new_page()
    viewer.goto(f"{BASE}{view_link}")
    viewer.wait_for_selector('[role="gridcell"]')
    check("view page heading", viewer.get_by_role("heading", name="Co-edit test").count() == 1)
    check("view page has no editing controls", viewer.get_by_label("Column 1 size").count() == 0 and viewer.get_by_role("button", name="Save version").count() == 0)
    check("view page has no designers list", viewer.get_by_label("Designers here").count() == 0)
    check("view cells have no aria-selected", viewer.locator('[role="gridcell"][aria-selected]').count() == 0)
    check("view css read-only", viewer.get_by_label("Layout CSS").get_attribute("readonly") is not None)

    # The view page receives live changes.
    ana_column2.fill("7fr")
    ana_column2.press("Enter")
    viewer.wait_for_timeout(1800)
    check("view page updates live", viewer.get_by_label("Layout updates").inner_text() == "Layout updated.", viewer.get_by_label("Layout updates").inner_text())

    # Revoke the view link: the old one shows the not-available page.
    ana.keyboard.press("Escape")
    ana.wait_for_timeout(300)
    ana.get_by_role("button", name="Share").click()
    ana.get_by_role("button", name="Revoke view link").click()
    ana.wait_for_timeout(300)
    viewer.goto(f"{BASE}{view_link}")
    viewer.wait_for_load_state()
    check("revoked view shows not available", viewer.get_by_role("heading", name="This layout is not available.").count() == 1, viewer.url)

    # Phone width: the Editor panes tablist shows one panel at a time.
    phone_context = browser.new_context(viewport={"width": 375, "height": 812})
    phone = phone_context.new_page()
    phone.goto(f"{BASE}/signin")
    phone.get_by_label("Username").fill(ana_name)
    phone.get_by_label("Password").fill("drafting-01")
    phone.get_by_role("button", name="Sign in").click()
    phone.wait_for_url(f"{BASE}/")
    phone.goto(f"{BASE}{layout_url}")
    phone.wait_for_selector('[role="gridcell"]')
    panes = phone.get_by_role("tablist", name="Editor panes")
    check("phone tablist", panes.get_by_role("tab", name="Grid").count() == 1, "tabs")
    check("phone shows grid panel", phone.locator('[role="gridcell"]').first.is_visible())
    phone.get_by_role("tab", name="Tracks").click()
    check("phone tracks panel", phone.get_by_label("Row gap").is_visible())
    phone.get_by_role("tab", name="Preview").click()
    check("phone preview panel", phone.get_by_label("Preview width").is_visible())
    phone.get_by_role("tab", name="Code").click()
    check("phone code panel", phone.get_by_label("Layout CSS").is_visible())
    check("no horizontal overflow", phone.evaluate("document.documentElement.scrollWidth <= 375 + 1"), phone.evaluate("document.documentElement.scrollWidth"))

    browser.close()

print("\nALL PASS" if not failures else f"\n{len(failures)} FAILURES: {', '.join(failures)}")
sys.exit(0 if not failures else 1)
