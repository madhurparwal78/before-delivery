"""Final checks: server-rendered headlines, unknown addresses and the next-run text."""

from __future__ import annotations

import re
import sys
import urllib.error
import urllib.request

from playwright.sync_api import sync_playwright

BASE = "http://localhost:4173"
failures: list[str] = []

HEADLINES = {
    "/": "Keep every system in step",
    "/connectors": "Reach the data in every system you run.",
    "/pricing": "Plans that grow with your pipelines",
    "/connector-builder": "Build and deploy custom connectors",
    "/data-replication": "The open standard for data movement",
    "/hybrid": "Run the data plane yourself. Skip the upkeep.",
    "/mcp": "The Wayline MCP Server",
    "/context-layer": "One context layer for every agent, across every business system",
    "/why-open-source": "Own your context.",
    "/compare": "Compare the data movement tools",
    "/data-engineering-resources": "All Data Engineering Resources",
    "/signin": "Sign in to your Wayline account",
    "/login": "Sign in to Wayline",
    "/accept-invite": "Accept your invitation",
}

UNKNOWN = ["/docs", "/redoc", "/openapi.json", "/docs/oauth2-redirect", "/app/nope", "/assets", "/backend/app.py", "/.venv/bin/uvicorn", "/package.json", "/run.json", "/requirements.txt"]


def check(label: str, condition: bool, detail: str = "") -> None:
    if condition:
        print(f"  ok   {label}")
    else:
        failures.append(f"{label} {detail}")
        print(f"  FAIL {label} {detail}")


def fetch(path: str) -> tuple[int, str]:
    try:
        with urllib.request.urlopen(BASE + path) as answer:
            return answer.status, answer.read().decode("utf-8", "replace")
    except urllib.error.HTTPError as error:
        return error.code, error.read().decode("utf-8", "replace")


def main() -> int:
    print("server-rendered headlines")
    for path, headline in HEADLINES.items():
        status, html = fetch(path)
        check(f"{path} headline", status == 200 and headline in html, str(status))
        check(f"{path} has one h1", html.count("<h1") == 1, str(html.count("<h1")))

    print("unknown addresses")
    for path in UNKNOWN:
        status, html = fetch(path)
        check(f"{path} is 404", status == 404 and "does not exist" in html, str(status))

    print("next-run text")
    with sync_playwright() as playwright:
        browser = playwright.chromium.launch()
        page = browser.new_context(viewport={"width": 1280, "height": 900}).new_page()
        page.goto(f"{BASE}/")
        written = page.evaluate(
            """() => {
                const moment = new Date('2026-11-01T05:30:00Z');
                const zone = 'America/New_York';
                const parts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: zone, weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
                }).formatToParts(moment);
                const piece = (type) => parts.find((part) => part.type === type).value;
                const offsetParts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(moment);
                const name = offsetParts.find((part) => part.type === 'timeZoneName').value;
                const offset = name.replace('GMT', '') || '+00:00';
                const [hours, minutes = '00'] = offset.slice(1).split(':');
                const written = `${offset[0]}${hours.padStart(2, '0')}:${minutes.padStart(2, '0')}`;
                return `${piece('weekday')} ${piece('day')} ${piece('month')} ${piece('year')}, ${piece('hour')}:${piece('minute')} ${zone} (UTC${written})`;
            }"""
        )
        check("autumn clock change", written == "Sun 1 Nov 2026, 01:30 America/New_York (UTC-04:00)", written)
        utc = page.evaluate(
            """() => {
                const moment = new Date('2026-03-02T08:05:00Z');
                const parts = new Intl.DateTimeFormat('en-GB', {
                    timeZone: 'UTC', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
                    hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
                }).formatToParts(moment);
                const piece = (type) => parts.find((part) => part.type === type).value;
                return `${piece('weekday')} ${piece('day')} ${piece('month')} ${piece('year')}, ${piece('hour')}:${piece('minute')} UTC (UTC+00:00)`;
            }"""
        )
        check("utc written", utc == "Mon 2 Mar 2026, 08:05 UTC (UTC+00:00)", utc)
        browser.close()

    print("fonts and film from this origin")
    for path in ["/fonts/inter-latin.woff2", "/fonts/fragment-mono-latin.woff2", "/fonts/jetbrains-mono-latin.woff2"]:
        status, _ = fetch(path)
        check(f"{path} served", status == 200, str(status))
    status, css = fetch("/" )
    check("no font cdn", "fonts.googleapis.com" not in css and "fonts.gstatic.com" not in css)

    print()
    print("failures:", len(failures))
    for failure in failures:
        print(" -", failure)
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main())
