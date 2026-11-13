"""Touch targets (DP-44) at the three viewports."""
import sys
from playwright.sync_api import sync_playwright

BASE = 'http://localhost:4173'
failures = []


def check(name, ok, detail=''):
    mark = 'PASS' if ok else 'FAIL'
    print(f'  [{mark}] {name} {detail}')
    if not ok:
        failures.append(f'{name} {detail}')


PAGES = [
    ('/kits/kestrel-lf?pickup=2026-11-13&return=2026-11-16', 'kit sheet'),
    ('/desk', 'desk sign-in'),
    ('/desk/counter', 'counter'),
    ('/desk/owner', 'owner desk'),
]

MEASURE = """
() => {
  const results = [];
  const seen = new Set();
  for (const el of document.querySelectorAll('button, a[href], input, select, textarea, [role="slider"]')) {
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    if (el.disabled) continue;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) continue;
    const key = el.tagName + '|' + (el.id || el.getAttribute('aria-label') || el.textContent.slice(0, 24));
    if (seen.has(key)) continue;
    seen.add(key);
    results.push({
      label: (el.getAttribute('aria-label') || el.textContent || el.id || el.name || '').trim().slice(0, 40),
      w: Math.round(rect.width),
      h: Math.round(rect.height),
    });
  }
  return results;
}
"""

with sync_playwright() as p:
    browser = p.chromium.launch()
    for width, height in [(375, 812), (768, 1024), (1280, 800)]:
        for path, label in PAGES:
            page = browser.new_page(viewport={'width': width, 'height': height})
            page.goto(BASE + path, wait_until='networkidle')
            page.wait_for_timeout(1200)
            controls = page.evaluate(MEASURE)
            small = [c for c in controls if c['w'] < 44 or c['h'] < 44]
            check(f'{width}x{height} {label}: all controls >= 44x44',
                  len(small) == 0, f'({len(controls)} checked; small: {small[:4]})')
            page.close()
    browser.close()

print()
if failures:
    print(f'{len(failures)} FAILURES')
    for f in failures:
        print(' -', f)
    sys.exit(1)
print('Touch targets pass.')
