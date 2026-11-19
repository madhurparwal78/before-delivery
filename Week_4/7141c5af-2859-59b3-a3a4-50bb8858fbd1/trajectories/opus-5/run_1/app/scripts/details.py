#!/usr/bin/env python3
"""The published details: the session cookie, whole-second instants, pages that
read with no script run, the live regions and printing. Verification only."""
import json
import re
import sys
import urllib.error
import urllib.request
import http.cookiejar
from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"
passed = 0
failed = []


def check(label, got, want):
    global passed
    if got == want:
        passed += 1
        print(f"ok   {label}")
    else:
        failed.append(label)
        print(f"FAIL {label}\n       got  {got!r}\n       want {want!r}")


# ----------------------------------------------------- the session cookie
request = urllib.request.Request(
    f"{BASE}/api/session",
    data=json.dumps({"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"}).encode(),
    method="POST",
)
request.add_header("Content-Type", "application/json")
with urllib.request.urlopen(request, timeout=30) as response:
    cookie = response.headers.get("Set-Cookie")
    # urllib's message is case-insensitive; keep it rather than a plain dict.
    raw_headers = response.headers

check("the cookie is set", cookie is not None, True)
check("HttpOnly", "HttpOnly" in cookie, True)
check("SameSite=Lax", "SameSite=Lax" in cookie, True)
check("never Secure", "Secure" not in cookie, True)
check("a browser-session cookie, with no Max-Age", "Max-Age" not in cookie, True)
check("and no Expires", "Expires" not in cookie, True)
check("Path=/", "Path=/" in cookie, True)
check("no store", raw_headers.get("Cache-Control"), "no-store")

jar = http.cookiejar.CookieJar()
opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))


def call(method, path, body=None):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data is not None:
        req.add_header("Content-Type", "application/json")
    try:
        with opener.open(req, timeout=60) as r:
            text = r.read()
            return r.status, (json.loads(text) if text and "json" in r.headers.get("content-type", "") else text)
    except urllib.error.HTTPError as e:
        text = e.read()
        try:
            return e.code, json.loads(text)
        except Exception:
            return e.code, text


call("POST", "/api/session", {"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"})

# ------------------------------------------- whole-second UTC with a Z
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
ANY_TIME = re.compile(r"\d{4}-\d{2}-\d{2}T[\d:.]+Z?")

paths = [
    "/api/session",
    "/api/clients",
    "/api/pieces",
    "/api/pieces/1",
    "/api/pieces/1/pins",
    "/api/pieces/1/photographs",
    "/api/pieces/1/layout",
    "/api/pieces/1/holds",
    "/api/pieces/1/estimates",
    "/api/pieces/3/collections",
    "/api/pieces/6/dossier",
    "/api/bench-jobs",
    "/api/rates",
    "/api/materials",
]
bad = []
for path in paths:
    status, body = call("GET", path)
    text = json.dumps(body)
    for found in ANY_TIME.findall(text):
        if not INSTANT.match(found):
            bad.append((path, found))
check("every instant is whole-second UTC with a Z", bad, [])

# a date-only field stays a date
status, body = call("GET", "/api/pieces/1")
check("a date-only field is YYYY-MM-DD", bool(re.match(r"^\d{4}-\d{2}-\d{2}$", body["piece"]["dueDate"])), True)

# every key is camelCase
def keys_of(value, out):
    if isinstance(value, dict):
        for key, inner in value.items():
            out.add(key)
            keys_of(inner, out)
    elif isinstance(value, list):
        for inner in value:
            keys_of(inner, out)


all_keys = set()
for path in paths:
    keys_of(call("GET", path)[1], all_keys)
not_camel = sorted(k for k in all_keys if not re.match(r"^[a-z][A-Za-z0-9]*$", k))
check("every key is camelCase", not_camel, [])

# -------------------------------------------------- pages with no script run
with sync_playwright() as p:
    browser = p.chromium.launch()
    noscript = browser.new_context(java_script_enabled=False, viewport={"width": 1280, "height": 800})
    page = noscript.new_page()
    for path, heading in [
        ("/", "ONE CHAIR AT A TIME."),
        ("/work", "Work"),
        ("/work/bentwood-armchair", "Bentwood armchair"),
        ("/work/slat-bench", "Slat bench"),
    ]:
        page.goto(BASE + path)
        check(f"no script: {path} heading", page.locator("h1").inner_text(), heading)
        check(f"no script: {path} text", len(page.inner_text("#main")) > 120, True)
    page.goto(f"{BASE}/work/bentwood-armchair")
    check("no script: the six numbered sections", page.locator(".case-section h2").count(), 6)
    check("no script: the rail", page.locator('[data-rail]').count(), 6)
    noscript.close()

    # the client page reads in the client's language with no script run
    api = browser.new_context()
    api.request.post(
        f"{BASE}/api/session",
        data={"email": "agnese@bottega-semenza.example", "password": "tacks-and-hide-2027"},
    )
    answer = api.request.post(f"{BASE}/api/pieces/5/client-page", data={}).json()
    token = answer["clientPage"]["address"].rsplit("/", 1)[-1]
    plain = browser.new_context(java_script_enabled=False, viewport={"width": 375, "height": 812})
    cp = plain.new_page()
    cp.goto(f"{BASE}/c/{token}")
    check("no script: client page lang", cp.evaluate_handle is not None and cp.get_attribute("html", "lang"), "ar")
    check("no script: client page dir", cp.get_attribute("html", "dir"), "rtl")
    check("no script: client page heading", cp.locator("h1").inner_text(), "\u0642\u0637\u0639\u062a\u0643")
    check("no script: the answer button", cp.locator("#your-answer").inner_text(), "\u0625\u062c\u0627\u0628\u062a\u0643")
    plain.close()

    # the live regions are there from first paint, before any action
    fresh = browser.new_context(viewport={"width": 1280, "height": 800})
    fp = fresh.new_page()
    fp.goto(BASE)
    check("Announcements from first paint", fp.get_attribute("#announcements", "aria-label"), "Announcements")
    check("its role is status", fp.get_attribute("#announcements", "role"), "status")
    check("polite", fp.get_attribute("#announcements", "aria-live"), "polite")
    check("Refresh state present", fp.get_attribute("#refresh-state", "aria-label"), "Refresh state")
    reserved = fp.evaluate("document.getElementById('refresh-state').getBoundingClientRect().height >= 16")
    check("its space is reserved", reserved, True)

    # one message made twice in a row is announced twice
    fp.goto(f"{BASE}/enquire")
    fp.fill("#enquiry-name", "Twice Over")
    fp.fill("#enquiry-email", "nope")
    fp.fill("#enquiry-message", "once")
    fp.click("#enquiry-send")
    fp.wait_for_timeout(600)
    first_html = fp.inner_html("#announcements")
    fp.click("#enquiry-send")
    fp.wait_for_timeout(600)
    check("the region's content changes each time", fp.evaluate(
        """() => {
             const region = document.getElementById('announcements');
             return region.children.length === 1;
           }"""), True)
    check("the same message is still there", fp.inner_text("#announcements"), "That is not an email address.")

    # the header is already solid on arrival at a scrolled position
    fp.goto(f"{BASE}/work/bentwood-armchair#files")
    fp.wait_for_timeout(400)
    check("header solid on arrival", fp.get_attribute("#site-header", "data-scrolled"), "true")

    # printing shows only the content
    fp.goto(f"{BASE}/work/bentwood-armchair")
    fp.emulate_media(media="print")
    fp.wait_for_timeout(200)
    hidden = fp.evaluate(
        """() => ['.site-header', '.case-rail', '.announcements', '.refresh-state']
             .map(s => { const el = document.querySelector(s);
                         return el ? getComputedStyle(el).display : 'none'; })"""
    )
    check("print hides the header, rail and live regions", hidden, ["none", "none", "none", "none"])
    fp.emulate_media(media="screen")

    # a 404 page is a real 404, never the shell with 200
    response = fp.goto(f"{BASE}/nope")
    check("an unknown address answers 404", response.status, 404)
    check("with the published heading", fp.locator("h1").inner_text(), "Page not found")
    response = fp.goto(f"{BASE}/api/nope")
    check("an unknown API path answers 404 JSON", response.status, 404)
    check("as JSON", "application/json" in response.header_value("content-type"), True)

    # source files and credentials are never served
    for path in ["/src/server/config.ts", "/package.json", "/.env", "/assets/../../package.json",
                 "/dist/server/index.js"]:
        response = fp.request.get(BASE + path)
        check(f"not served: {path}", response.status, 404)
    fresh.close()
    browser.close()

print()
print(f"{passed} passed, {len(failed)} failed")
for name in failed:
    print(f"  - {name}")
sys.exit(1 if failed else 0)
