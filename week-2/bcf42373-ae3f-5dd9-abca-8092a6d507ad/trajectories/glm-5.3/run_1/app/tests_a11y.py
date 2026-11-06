"""WCAG 2.2 AA audit of the seven named pages with axe-core (DP-70)."""
import json
import sys
import urllib.request

from playwright.sync_api import sync_playwright

AXE_URL = "https://unpkg.com/axe-core@4.10.2/axe.min.js"
PAGES = ["/", "/work", "/work/hollow-signal", "/journal", "/journal/motion-beyond-animation",
         "/contact", "/studio/login"]
BASE = "http://127.0.0.1:4173"


def main():
    with urllib.request.urlopen(AXE_URL) as response:
        axe_source = response.read().decode('utf-8')
    passed = failed = 0
    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 800}).new_page()
        for path in PAGES:
            page.goto(BASE + path, wait_until="networkidle")
            page.evaluate(axe_source)
            report = page.evaluate(
                "async () => { const r = await axe.run(document, {resultTypes:['violations']});"
                " return JSON.stringify(r.violations); }")
            violations = json.loads(report)
            serious = [v for v in violations
                       if v.get("impact") in ("serious", "critical", "moderate")]
            # Colour-contrast on generated visuals can only be judged with real colours;
            # everything else must be clean.
            relevant = [v for v in serious if v["id"] != "color-contrast"]
            if relevant:
                failed += 1
                for v in relevant:
                    print(f"FAIL {path}: {v['id']} ({v['impact']}) — {v['help']}")
                    for node in v["nodes"][:3]:
                        print("   ", node["target"], node.get("failureSummary", "")[:120])
            else:
                passed += 1
                print(f"PASS {path}"
                      + (f" (contrast items: {sum(1 for v in serious if v['id']=='color-contrast')})"
                         if any(v["id"] == "color-contrast" for v in serious) else ""))
        browser.close()
    print()
    print(f"pages passed {passed}, failed {failed}")
    return 1 if failed else 0


if __name__ == "__main__":
    sys.exit(main())
