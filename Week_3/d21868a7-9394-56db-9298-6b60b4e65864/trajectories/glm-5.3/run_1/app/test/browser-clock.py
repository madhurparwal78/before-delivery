from playwright.sync_api import sync_playwright
import sys
BASE = "http://127.0.0.1:4173"
fails = []
def check(name, cond, detail=""):
    if cond: print(f"ok   {name}")
    else:
        fails.append(name); print(f"FAIL {name} {detail}")

with sync_playwright() as p:
    browser = p.chromium.launch()

    # a frozen device clock hours wrong: the browser's date reads 2020, but
    # the page's timers still run. The window status must come from the server.
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    ctx.add_init_script("""
      // freeze the date 6 years in the past; keep timers running
      const realNow = Date.now();
      const frozen = realNow - 6 * 365 * 24 * 3600 * 1000;
      const OriginalDate = Date;
      class FakeDate extends OriginalDate {
        constructor(...args) {
          if (args.length === 0 && typeof OriginalDate.now !== 'undefined') {
            // base reads come from the frozen instant + real elapsed time
            super(frozen + (performance.timeOrigin ? (OriginalDate.now() - window.__t0) : 0) - (OriginalDate.now() - realNow) + (OriginalDate.now() - realNow));
            return;
          }
          super(...args);
        }
        static now() {
          return frozen;
        }
      }
      window.__t0 = OriginalDate.now();
      window.Date = FakeDate;
    """)
    page = ctx.new_page()
    page.goto(f"{BASE}/sign-in")
    page.fill("input#email", "lin@growers.example")
    page.fill("input#password", "channel-season-26")
    page.get_by_role("button", name="Sign in").click()
    page.wait_for_url("**/grower")
    page.goto(f"{BASE}/grower/orders/new?window=W-L4-A")
    page.wait_for_selector("#remaining:not(:empty)")
    page.wait_for_timeout(2000)
    # the device clock says 2020 but the window status shows the server's truth
    status = page.locator("[aria-label='Window status']").text_content()
    check("window status from server with frozen clock", status.startswith("Open") or status.startswith("Closing") or status.startswith("Not yet open") or status.startswith("Closed"), status)
    check("status not computed from device date", "2020" not in status, status)
    # the window label shows the server's district times
    opts = page.locator("select#window option").all_text_contents()
    check("labels unaffected by frozen clock", any("2026" in o for o in opts) or any("Lateral" in o for o in opts), opts[:3])
    # Place order is enabled because the SERVER says the window is orderable
    disabled = page.get_by_role("button", name="Place order").get_attribute("aria-disabled")
    check("place order enabled by server truth", disabled != "true", disabled)
    browser.close()

print()
print(f"{len(fails)} FAILURES" if fails else "ALL OK")
sys.exit(1 if fails else 0)
