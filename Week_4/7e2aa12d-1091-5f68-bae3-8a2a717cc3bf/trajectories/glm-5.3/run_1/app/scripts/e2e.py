"""Browser E2E: the keyboard-built layout journey and the main editor surfaces."""
import re
import sys
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
    context = browser.new_context(viewport={"width": 1280, "height": 800})
    page = context.new_page()
    page.set_default_timeout(8000)
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))

    username = f"kb{int(__import__('time').time()) % 1000000}"

    # Sign up through the UI.
    page.goto(f"{BASE}/signup")
    page.get_by_label("Username").fill(username)
    page.get_by_label("Password").fill("drafting-01")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_url(f"{BASE}/")
    check("signup lands on library", page.locator("h1").inner_text() == "Your layouts", page.locator("h1").inner_text())

    # Create a Blank layout through the dialog.
    page.get_by_role("button", name="New layout").click()
    page.get_by_label("Layout name").fill("Keyboard build")
    page.get_by_role("button", name="Create layout").click()
    page.wait_for_url(re.compile(rf"{BASE}/layouts/"))
    check("editor opened", page.get_by_role("link", name="Your layouts").count() == 1)

    # The grid renders 3x3 blank cells.
    cells = page.locator('[role="gridcell"]')
    expect(cells).to_have_count(9)
    check("3x3 grid", cells.count() == 9, cells.count())
    check("cell aria-label", "Row 1, column 1, empty" in cells.first.get_attribute("aria-label"), cells.first.get_attribute("aria-label"))
    check("data attributes", cells.first.get_attribute("data-row") == "1" and cells.first.get_attribute("data-column") == "1")

    # Keyboard: move to row 2 col 2, Shift+Right to select, Enter to name.
    cells.first.focus()
    page.keyboard.press("ArrowDown")
    page.keyboard.press("ArrowRight")
    focused = page.locator('[role="gridcell"]:focus')
    check("cursor moved", focused.get_attribute("data-row") == "2" and focused.get_attribute("data-column") == "2")

    page.keyboard.press("Shift+ArrowRight")
    selected = page.locator('[role="gridcell"][aria-selected="true"]')
    expect(selected).to_have_count(2)
    check("shift selects rectangle", selected.count() == 2, selected.count())

    page.keyboard.press("Enter")
    name_field = page.get_by_label("Area name")
    expect(name_field).to_be_visible()
    name_field.fill("hero")
    page.get_by_role("button", name="Save area").click()

    # The announcement, the area block and the code all show the area.
    expect(page.get_by_label("Layout updates")).to_have_text(re.compile("Area hero created."))
    check("announcement", page.get_by_label("Layout updates").inner_text() == "Area hero created.", page.get_by_label("Layout updates").inner_text())
    blocks = page.locator('[data-area-name="hero"]')
    expect(blocks).to_have_count(1)
    check("area block attrs", blocks.get_attribute("data-row-start") == "2" and blocks.get_attribute("data-column-start") == "2"
          and blocks.get_attribute("data-row-end") == "3" and blocks.get_attribute("data-column-end") == "4", blocks.get_attribute("data-column-end"))
    page.wait_for_function("document.querySelector('[aria-label=\"Layout CSS\"]').value.includes('hero')")
    css_text = page.get_by_label("Layout CSS").input_value()
    check("css shows area", "hero" in css_text, css_text[:300])
    html_text = page.get_by_label("Layout HTML").input_value()
    check("html shows area", 'class="hero"' in html_text, html_text)

    # Grid keys: c adds a column after the cursor's column.
    page.locator('[role="gridcell"]').first.focus()
    page.keyboard.press("ArrowRight")
    page.keyboard.press("c")
    expect(page.locator('[role="gridcell"]')).to_have_count(12)
    check("c adds column", page.locator('[role="gridcell"]').count() == 12)
    page.keyboard.press("r")
    expect(page.locator('[role="gridcell"]')).to_have_count(16)
    check("r adds row", page.locator('[role="gridcell"]').count() == 16)
    page.keyboard.press("Shift+C")
    expect(page.locator('[role="gridcell"]')).to_have_count(12)
    check("Shift+C removes column", page.locator('[role="gridcell"]').count() == 12)
    page.keyboard.press("Shift+R")
    expect(page.locator('[role="gridcell"]')).to_have_count(9)
    check("Shift+R removes row", page.locator('[role="gridcell"]').count() == 9)

    # Undo and redo via keyboard shortcuts.
    page.keyboard.press("Control+z")
    page.wait_for_timeout(400)
    check("undo announcement", "Undone." == page.get_by_label("Layout updates").inner_text(), page.get_by_label("Layout updates").inner_text())
    page.keyboard.press("Control+Shift+z")
    page.wait_for_timeout(400)
    check("redo announcement", "Redone." == page.get_by_label("Layout updates").inner_text(), page.get_by_label("Layout updates").inner_text())

    # Track size by keyboard in the field.
    size_field = page.get_by_label("Column 1 size")
    size_field.fill("minmax(200px, 1fr)")
    size_field.press("Enter")
    expect(page.get_by_label("Layout updates")).to_have_text(re.compile("Column 1 set to minmax\\(200px, 1fr\\)"))
    check("minmax accepted", "minmax(200px, 1fr)" in page.get_by_label("Layout CSS").input_value())

    # Refused size leaves the layout as it was.
    size_field.fill("10em")
    size_field.press("Enter")
    expect(page.get_by_label("Edit problem")).to_have_text("Use a size like 1fr, 200px, 25%, auto or minmax(100px, 1fr).")
    check("refused size message", page.get_by_label("Edit problem").inner_text().startswith("Use a size like"))
    check("field keeps old value", size_field.input_value() == "minmax(200px, 1fr)", size_field.input_value())

    # Reload: the layout is in the library with the same CSS.
    page.reload()
    page.wait_for_selector('[role="gridcell"]')
    check("layout persisted", 'class="hero"' in page.get_by_label("Layout HTML").input_value())

    page.get_by_role("link", name="Your layouts").click()
    page.wait_for_url(f"{BASE}/")
    check("library lists layout", page.get_by_role("link", name="Keyboard build").count() == 1)

    # Breakpoint fold: add a breakpoint and step the preview across it.
    page.get_by_role("link", name="Keyboard build").click()
    page.wait_for_selector('[role="gridcell"]')
    page.get_by_role("button", name="Add breakpoint").click()
    page.get_by_label("Minimum width").fill("768")
    page.get_by_role("button", name="Add", exact=True).click()
    expect(page.get_by_role("tablist", name="Breakpoints").get_by_role("tab", name="From 768px")).to_be_visible()
    check("breakpoint tab", page.get_by_role("tab", name="From 768px").count() == 1)

    slider = page.get_by_label("Preview width")
    slider.focus()
    page.keyboard.press("Home")
    page.wait_for_timeout(300)
    check("home goes to 320", page.locator(".preview-readout").inner_text() == "320px", page.locator(".preview-readout").inner_text())
    page.keyboard.press("PageUp")
    page.wait_for_timeout(300)
    readout = page.locator(".preview-readout").inner_text()
    check("page up jumps to 768", readout == "768px", readout)
    check("scope announcement", "Showing From 768px at 768px." == page.get_by_label("Layout updates").inner_text(), page.get_by_label("Layout updates").inner_text())

    page.keyboard.press("Home")
    page.wait_for_timeout(300)
    check("home back to 320", page.locator(".preview-readout").inner_text() == "320px")
    check("base tab selected", page.get_by_role("tab", name="Base").get_attribute("aria-selected") == "true")

    # Selecting a tab moves the width.
    page.get_by_role("tab", name="From 768px").click()
    page.wait_for_timeout(200)
    check("tab select moves width", page.locator(".preview-readout").inner_text() == "768px", page.locator(".preview-readout").inner_text())

    # Sign out and back in.
    page.goto(f"{BASE}/")
    page.get_by_role("button", name="Sign out").click()
    page.wait_for_url(f"{BASE}/signin")
    check("sign out to signin", True)

    check("no page errors", errors == [], errors)
    browser.close()

print("\nALL PASS" if not failures else f"\n{len(failures)} FAILURES: {', '.join(failures)}")
sys.exit(0 if not failures else 1)
