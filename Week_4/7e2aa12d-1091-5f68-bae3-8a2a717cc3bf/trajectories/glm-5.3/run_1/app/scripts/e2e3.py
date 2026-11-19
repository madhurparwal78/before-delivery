"""Browser E2E part 3: touch editing, reduced motion, view-page markup, library."""
import re
import sys
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

    # --- Touch journey at 375x812 with hasTouch ---
    ctx = browser.new_context(viewport={"width": 375, "height": 812}, has_touch=True)
    page = ctx.new_page()
    page.set_default_timeout(10000)
    stamp = int(time.time()) % 1000000

    page.goto(f"{BASE}/signup")
    page.get_by_label("Username").fill(f"tc{stamp}")
    page.get_by_label("Password").fill("drafting-01")
    page.get_by_role("button", name="Create account").click()
    page.wait_for_url(f"{BASE}/")
    page.get_by_role("button", name="New layout").click()
    page.get_by_label("Layout name").fill("Touch build")
    page.get_by_role("button", name="Create layout").click()
    page.wait_for_url(re.compile(r"/layouts/"))
    page.wait_for_selector('[role="gridcell"]')

    # Switch to the Tracks pane and back to the Grid pane.
    page.get_by_role("tab", name="Tracks").click()
    check("tracks pane opens", page.get_by_label("Row gap").is_visible())
    page.get_by_role("tab", name="Grid").click()
    check("grid pane returns", page.locator('[role="gridcell"]').first.is_visible())

    # Tap a cell to place the cursor and anchor.
    cell = page.locator('[data-row="2"][data-column="2"]')
    cell.tap()
    page.wait_for_timeout(200)
    check("cursor moves to tapped cell", page.evaluate("document.querySelector('.cursor')?.getAttribute('data-row')") == "2")
    check("cursor column", page.evaluate("document.querySelector('.cursor')?.getAttribute('data-column')") == "2")
    check("tap opens no dialog", page.locator(".dialog-backdrop").count() == 0, page.locator(".dialog-backdrop").count())

    # Drag a finger across cells and release: that opens Name area for the rectangle.
    page.evaluate("""() => {
      const cells = [...document.querySelectorAll('[role=gridcell]')];
      const a = cells.find(c => c.dataset.row === '2' && c.dataset.column === '2');
      const b = cells.find(c => c.dataset.row === '2' && c.dataset.column === '3');
      a.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 7, pointerType: 'touch', bubbles: true, isPrimary: true }));
      b.dispatchEvent(new PointerEvent('pointerenter', { bubbles: true }));
      b.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7, pointerType: 'touch', bubbles: true }));
    }""")
    page.wait_for_timeout(400)
    check("drag opens one dialog", page.locator(".dialog-backdrop").count() == 1, page.locator(".dialog-backdrop").count())
    name_field = page.get_by_label("Area name").first
    expect(name_field).to_be_visible()
    name_field.fill("touch-area")
    page.get_by_role("button", name="Save area").first.click()
    expect(page.get_by_label("Layout updates")).to_have_text("Area touch-area created.")
    check("touch area created", page.locator('[data-area-name="touch-area"]').count() == 1)

    # The stored layout has the area.
    page.reload()
    page.wait_for_selector('[role="gridcell"]')
    check("area stored after reload", page.locator('[data-area-name="touch-area"]').count() == 1)

    # Every tappable control is at least 44x44.
    small = page.evaluate("""() => {
      const bad = [];
      for (const el of document.querySelectorAll('button, [role="tab"], input, [role="gridcell"], [role="separator"]')) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0 && (r.width < 44 || r.height < 44)) bad.push(`${el.getAttribute('aria-label') ?? el.tagName}: ${r.width}x${r.height}`);
      }
      return bad.slice(0, 6);
    }""")
    check("touch targets 44px", small == [], small)

    # No horizontal page scroll.
    check("no sideways scroll", page.evaluate("document.documentElement.scrollWidth <= 376"), page.evaluate("document.documentElement.scrollWidth"))
    ctx.close()

    # --- Reduced motion: the drawer and notice appear without movement ---
    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    page2 = ctx2.new_page()
    page2.set_default_timeout(10000)
    page2.goto(f"{BASE}/signin")
    page2.get_by_label("Username").fill(f"tc{stamp}")
    page2.get_by_label("Password").fill("drafting-01")
    page2.get_by_role("button", name="Sign in").click()
    page2.wait_for_url(f"{BASE}/")
    page2.get_by_role("link", name="Touch build").click()
    page2.wait_for_selector('[role="gridcell"]')

    page2.get_by_role("button", name="Versions").click()
    page2.wait_for_selector('.drawer[data-open]')
    check("drawer opens under reduced motion", page2.get_by_role("dialog", name="Versions").is_visible())
    page2.get_by_role("dialog", name="Versions").press("Escape")
    page2.wait_for_timeout(400)
    check("drawer closes under reduced motion", page2.get_by_role("dialog", name="Versions").count() == 0,
          page2.get_by_role("dialog", name="Versions").count())
    ctx2.close()

    # --- Library markup ---
    ctx3 = browser.new_context(viewport={"width": 1280, "height": 800})
    page3 = ctx3.new_page()
    page3.goto(f"{BASE}/signin")
    page3.get_by_label("Username").fill(f"tc{stamp}")
    page3.get_by_label("Password").fill("drafting-01")
    page3.get_by_role("button", name="Sign in").click()
    page3.wait_for_url(f"{BASE}/")
    check("library heading", page3.get_by_role("heading", name="Your layouts").count() == 1)
    check("wordmark", page3.locator(".wordmark").inner_text() == "Mullion")
    check("sign out button", page3.get_by_role("button", name="Sign out").count() == 1)
    link = page3.get_by_role("link", name="Touch build")
    cols = link.locator(".cols").inner_text()
    check("library shows columns", cols == "1fr 1fr 1fr", cols)
    ctx3.close()

    browser.close()

print("\nALL PASS" if not failures else f"\n{len(failures)} FAILURES: {', '.join(failures)}")
sys.exit(0 if not failures else 1)
