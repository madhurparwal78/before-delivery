#!/usr/bin/env python3
"""Browser checks: layout at every width, pad key sizes, pinned viewer scoreboard."""
import json
import re
import sys
import urllib.request
import urllib.error
import uuid

from playwright.sync_api import sync_playwright

BASE = "http://127.0.0.1:4173"
KEY = "gk-overcall-7f3a91c2"

def req(method, path, body=None, headers=None):
    url = BASE + path
    data = json.dumps(body).encode() if body is not None else None
    hdrs = {"Content-Type": "application/json"}
    if headers:
        hdrs.update(headers)
    r = urllib.request.Request(url, data=data, method=method, headers=hdrs)
    try:
        with urllib.request.urlopen(r, timeout=60) as resp:
            payload = resp.read().decode()
            return resp.status, json.loads(payload) if payload else {}
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read().decode())
        except Exception:
            return e.code, {}

failures = 0
def check(name, got, want):
    global failures
    if got == want:
        print(f"ok   {name}")
    else:
        failures += 1
        print(f"FAIL {name}\n  got  {str(got)[:200]}\n  want {str(want)[:200]}")

def check_true(name, value):
    check(name, bool(value), True)

# --- seed a match in progress ---
tag = uuid.uuid4().hex[:8]
seed = {
    "users": [{"key": "o", "email": f"br{tag}@example.test", "display_name": "Olga", "password": "long-password-1"}],
    "teams": [
        {"key": "kes", "organiser": "o", "name": "Kestrels",
         "players": [{"key": f"kes{i}", "name": f"K{i}", "short_name": f"K{i}"} for i in range(1, 7)]},
        {"key": "her", "organiser": "o", "name": "Herons",
         "players": [{"key": f"her{i}", "name": f"H{i}", "short_name": f"H{i}"} for i in range(1, 7)]},
    ],
    "matches": [{
        "key": "m", "organiser": "o", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6,
        "super_over": False, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": [], "viewer_link": True,
        "innings": [{"striker": "kes1", "non_striker": "kes2",
                     "bowlers": ["her1", "her2", "her1", "her2", "her1"],
                     "deliveries": (["1", "2", "0", "0", "4", "0"] * 5)}],
        "summary": None,
    }],
}
status, resp = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed", status, 201)
match_id = resp["matches"]["m"]["id"]
code = resp["matches"]["m"]["viewer_code"]
session = resp["users"]["o"]["session"]

WIDTHS = [320, 390, 768, 1024, 1280, 1440]

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ---- page structure at every width ----
    ctx = browser.new_context(viewport={"width": 1280, "height": 800})
    page = ctx.new_page()
    page.set_extra_http_headers({"Cookie": f"oc_session={session}"})
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(f"{BASE}/matches/{match_id}/score")
    page.wait_for_selector("#pad")

    for width in WIDTHS:
        page.set_viewport_size({"width": width, "height": 800})
        page.wait_for_timeout(150)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"scoring no sideways scroll at {width}", overflow <= 0, True)

    # ---- pad key sizes at 390x844 ----
    page.set_viewport_size({"width": 390, "height": 844})
    page.wait_for_timeout(150)
    sizes = page.evaluate("""
      () => [...document.querySelectorAll('#pad button')].map((b) => {
        const r = b.getBoundingClientRect();
        return { w: r.width, h: r.height };
      })
    """)
    small = [s for s in sizes if s["w"] < 48 or s["h"] < 48]
    check("all pad keys at least 48x48 at 390", len(small), 0)

    # the pad never covers the scoreboard or this-over
    overlap = page.evaluate("""
      () => {
        const pad = document.querySelector('#pad').getBoundingClientRect();
        const sb = document.getElementById('scoreboard').getBoundingClientRect();
        const over = document.getElementById('this-over').getBoundingClientRect();
        const hits = (a, b) => !(a.right <= b.left || b.right <= a.left || a.bottom <= b.top || b.bottom <= a.top);
        return hits(pad, sb) || hits(pad, over);
      }
    """)
    check_true("pad never covers scoreboard or this over", not overlap)

    # ---- digits and scoreboard ----
    digits = page.evaluate("document.querySelectorAll('#scoreboard .digit').length")
    check_true("scoreboard has digits", digits > 0)

    # ---- landing page layout ----
    page.goto(f"{BASE}/")
    for width in WIDTHS:
        page.set_viewport_size({"width": width, "height": 800})
        page.wait_for_timeout(150)
        overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"landing no sideways scroll at {width}", overflow <= 0, True)

    # ---- viewer page: pinned scoreboard ----
    vctx = browser.new_context(viewport={"width": 390, "height": 844})
    vpage = vctx.new_page()
    vpage.goto(f"{BASE}/live/{code}")
    vpage.wait_for_selector("#commentary")
    for width in WIDTHS:
        vpage.set_viewport_size({"width": width, "height": 800})
        vpage.wait_for_timeout(100)
        overflow = vpage.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
        check(f"viewer no sideways scroll at {width}", overflow <= 0, True)

    vpage.set_viewport_size({"width": 390, "height": 844})
    vpage.evaluate("window.scrollTo(0, 1000)")
    vpage.wait_for_timeout(200)
    scroll_y = vpage.evaluate("window.scrollY")
    check_true("viewer page can scroll past 1000px", scroll_y >= 1000)
    top = vpage.evaluate("""
      () => {
        const sb = document.getElementById('scoreboard').getBoundingClientRect();
        return sb.top;
      }
    """)
    check("viewer scoreboard pinned within 0-1px", -1 <= top <= 1, True)

    # the commentary passes beneath the pinned scoreboard while scrolling
    beneath = vpage.evaluate("""
      () => {
        const sb = document.getElementById('scoreboard').getBoundingClientRect();
        const items = [...document.querySelectorAll('#commentary li')];
        return items.filter((li) => {
          const r = li.getBoundingClientRect();
          return r.top < sb.bottom && r.bottom > sb.top;
        }).length;
      }
    """)
    check("commentary items scroll under the pin", beneath > 0, True)
    vctx.close()

    # ---- scorecard tables scroll inside their sections on a phone ----
    page.set_viewport_size({"width": 390, "height": 844})
    page.goto(f"{BASE}/matches/{match_id}/scorecard")
    page.wait_for_selector(".innings-section")
    overflow = page.evaluate("document.documentElement.scrollWidth - document.documentElement.clientWidth")
    check("scorecard no page sideways scroll at 390", overflow <= 0, True)

    # ---- no page errors ----
    check("no page errors during checks", errors, [])

    # ---- reduced motion: no ball-tick animation ----
    rctx = browser.new_context(viewport={"width": 1280, "height": 800}, reduced_motion="reduce")
    rpage = rctx.new_page()
    rpage.set_extra_http_headers({"Cookie": f"oc_session={session}"})
    rpage.goto(f"{BASE}/matches/{match_id}/score")
    rpage.wait_for_selector("#scoreboard")
    anims = rpage.evaluate("document.getAnimations().map((a) => a.id)")
    check("reduced motion: no ball-tick animations", [a for a in anims if a == "ball-tick"], [])

    # normal motion: opening the page creates no tick (nothing changed yet)
    nctx = browser.new_context(viewport={"width": 1280, "height": 800})
    npage = nctx.new_page()
    npage.set_extra_http_headers({"Cookie": f"oc_session={session}"})
    npage.goto(f"{BASE}/matches/{match_id}/score")
    npage.wait_for_selector("#scoreboard")
    anims = npage.evaluate("document.getAnimations().map((a) => a.id)")
    check("no tick before any change", [a for a in anims if a == "ball-tick"], [])

    # ---- a state update rolls the changed digits ----
    before = npage.evaluate("document.getElementById('scoreboard').dataset.runs")
    npage.evaluate("""
      fetch('/api/config').then(r => r.json()).then((cfg) => { window.__cfg = cfg; });
    """)
    npage.wait_for_timeout(200)
    # simulate a new state arriving through renderState by dispatching through the live socket path:
    # simplest is to call the page's own render path via a fake state.
    rolled = npage.evaluate("""
      async () => {
        const el = document.getElementById('scoreboard');
        const state = window.__state;
        if (!state) return { hasState: false };
        const fresh = JSON.parse(JSON.stringify(state));
        fresh.runs = state.runs + 1;
        fresh.overs_text = '1.1';
        // the page exposes no global render, so drive the pad instead
        return { hasState: true, runs: el.dataset.runs };
      }
    """)
    check_true("page state present", rolled.get("hasState", False))


    ctx.close()
    browser.close()

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
