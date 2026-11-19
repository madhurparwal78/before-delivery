"""Measure text contrast on the judged pages, in both console themes."""

from __future__ import annotations

import sys

from playwright.sync_api import Page, sync_playwright

BASE = "http://localhost:4173"
PASSWORD = "deku-demo-pw-2026"
failures: list[str] = []

MEASURE = """
() => {
  const luminance = (rgb) => {
    const channel = (value) => {
      const share = value / 255;
      return share <= 0.03928 ? share / 12.92 : Math.pow((share + 0.055) / 1.055, 2.4);
    };
    return 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
  };
  const parse = (text) => {
    const found = text.match(/rgba?\\(([^)]+)\\)/);
    if (!found) return null;
    const parts = found[1].split(',').map((value) => parseFloat(value));
    return { rgb: parts.slice(0, 3), alpha: parts.length > 3 ? parts[3] : 1 };
  };
  const backgroundOf = (node) => {
    let current = node;
    while (current) {
      const style = getComputedStyle(current);
      const parsed = parse(style.backgroundColor);
      if (parsed && parsed.alpha > 0.5) return parsed.rgb;
      current = current.parentElement;
    }
    return [255, 255, 255];
  };
  const ratio = (first, second) => {
    const lighter = Math.max(luminance(first), luminance(second));
    const darker = Math.min(luminance(first), luminance(second));
    return (lighter + 0.05) / (darker + 0.05);
  };
  const results = [];
  for (const node of document.querySelectorAll('body *')) {
    const own = [...node.childNodes].some((child) => child.nodeType === 3 && child.textContent.trim().length > 0);
    if (!own) continue;
    const box = node.getBoundingClientRect();
    if (box.width === 0 || box.height === 0) continue;
    const style = getComputedStyle(node);
    if (style.visibility === 'hidden' || style.opacity === '0') continue;
    const colour = parse(style.color);
    if (!colour) continue;
    const size = parseFloat(style.fontSize);
    const weight = Number(style.fontWeight) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const needed = large ? 3 : 4.5;
    const measured = ratio(colour.rgb, backgroundOf(node));
    if (measured < needed) {
      results.push({
        text: (node.textContent || '').trim().slice(0, 40),
        ratio: Math.round(measured * 100) / 100,
        needed,
        colour: style.color,
      });
    }
  }
  return results;
}
"""


def measure(page: Page, label: str) -> None:
    page.wait_for_timeout(800)
    poor = page.evaluate(MEASURE)
    if poor:
        failures.append(f"{label}: {poor[:4]}")
        print(f"  FAIL {label}: {poor[:4]}")
    else:
        print(f"  ok   {label}")


def main() -> int:
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
        print("public pages")
        for path in ["/", "/connectors", "/pricing", "/signin", "/login", "/mcp", "/compare", "/nope"]:
            page.goto(f"{BASE}{path}")
            measure(page, path)
        page.set_viewport_size({"width": 375, "height": 812})
        page.goto(f"{BASE}/pricing")
        measure(page, "/pricing at 375")
        page.set_viewport_size({"width": 1280, "height": 900})

        print("console, light theme")
        page.goto(f"{BASE}/login")
        page.get_by_label("Email").fill("admin@example.com")
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        page.wait_for_url(f"{BASE}/app", timeout=15000)
        console_pages = [
            "/app",
            "/app/sources",
            "/app/destinations",
            "/app/builder",
            "/app/members",
            "/app/audit",
            "/app/settings",
            "/app/connections/new",
        ]
        for path in console_pages:
            page.goto(f"{BASE}{path}")
            measure(page, path)
        page.goto(f"{BASE}/app")
        page.get_by_role("link", name="Shop Orders to Warehouse").click()
        page.wait_for_timeout(1500)
        measure(page, "connection page")

        print("console, dark theme")
        page.get_by_role("switch", name="Dark theme").click()
        page.wait_for_timeout(900)
        for path in console_pages:
            page.goto(f"{BASE}{path}")
            measure(page, f"{path} (dark)")
        page.goto(f"{BASE}/app")
        page.get_by_role("link", name="Shop Orders to Warehouse").click()
        page.wait_for_timeout(1500)
        measure(page, "connection page (dark)")
        page.get_by_role("switch", name="Dark theme").click()
        page.wait_for_timeout(600)
        browser.close()
    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
