#!/usr/bin/env python3
"""Browser interaction checks: scoring by keyboard, ball tick, pen, dialogs."""
import json
import sys
import time
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
        print(f"FAIL {name}\n  got  {str(got)[:250]}\n  want {str(want)[:250]}")

def check_true(name, value):
    check(name, bool(value), True)

# --- seed a match with one over started ---
tag = uuid.uuid4().hex[:8]
seed = {
    "users": [
        {"key": "olga", "email": f"kb{tag}@example.test", "display_name": "Olga Fernandes", "password": "long-password-1"},
        {"key": "mira", "email": f"kbm{tag}@example.test", "display_name": "Mira Joshi", "password": "long-password-2"},
    ],
    "teams": [
        {"key": "kes", "organiser": "olga", "name": "Kestrels",
         "players": [{"key": f"kes{i}", "name": f"K{i}", "short_name": f"K{i}"} for i in range(1, 7)]},
        {"key": "her", "organiser": "olga", "name": "Herons",
         "players": [{"key": f"her{i}", "name": f"H{i}", "short_name": f"H{i}"} for i in range(1, 7)]},
    ],
    "matches": [{
        "key": "m", "organiser": "olga", "home": "kes", "away": "her", "overs": 5, "players_per_side": 6,
        "super_over": False, "batting_first": "kes", "tournament": None,
        "xi": {"kes": [f"kes{i}" for i in range(1, 7)], "her": [f"her{i}" for i in range(1, 7)]},
        "scorers": ["mira"], "viewer_link": True,
        "innings": [{"striker": "kes1", "non_striker": "kes2", "bowlers": ["her1"], "deliveries": []}],
        "summary": None,
    }],
}
status, resp = req("POST", "/api/grading/seed", seed, {"X-Grading-Key": KEY})
check("seed", status, 201)
match_id = resp["matches"]["m"]["id"]
code = resp["matches"]["m"]["viewer_code"]
olga_session = resp["users"]["olga"]["session"]
mira_session = resp["users"]["mira"]["session"]

with sync_playwright() as pw:
    browser = pw.chromium.launch()

    # ============ the pen: one page holds it, the other is read-only ============
    ctx1 = browser.new_context(viewport={"width": 1280, "height": 800})
    page1 = ctx1.new_page()
    page1.set_extra_http_headers({"Cookie": f"oc_session={mira_session}"})
    errs1 = []
    page1.on("pageerror", lambda e: errs1.append(str(e)))
    page1.goto(f"{BASE}/matches/{match_id}/score")
    page1.wait_for_selector("#pad", timeout=15000)
    page1.wait_for_timeout(1500)
    pen_notice = page1.evaluate("document.getElementById('pen-notice').textContent")
    check("first scoring page gets the pen", pen_notice, "")

    ctx2 = browser.new_context(viewport={"width": 1280, "height": 800})
    page2 = ctx2.new_page()
    page2.set_extra_http_headers({"Cookie": f"oc_session={olga_session}"})
    page2.goto(f"{BASE}/matches/{match_id}/score")
    page2.wait_for_selector("#pad", timeout=15000)
    page2.wait_for_timeout(2500)
    notice2 = page2.evaluate("document.getElementById('pen-notice').textContent")

    check("second page names the holder", notice2, "Mira Joshi is scoring this match. You are viewing it read-only.")
    disabled = page2.evaluate("[...document.querySelectorAll('#pad button')].every((b) => b.disabled)")
    check("read-only page disables the pad", disabled, True)
    take_btn = page2.evaluate("document.getElementById('take-pen') !== null")
    check("read-only page offers Take the pen", take_btn, True)

    # ============ keyboard scoring on the pen-holder page ============
    before_runs = page1.evaluate("document.getElementById('scoreboard').dataset.runs")
    page1.keyboard.press("4")
    page1.wait_for_timeout(800)
    after_runs = page1.evaluate("document.getElementById('scoreboard').dataset.runs")
    check("4 key adds four runs", int(after_runs) - int(before_runs), 4)

    # the announcement is the delivery line plus the score
    announced = page1.evaluate("document.getElementById('announcer').textContent")
    check("delivery announced", "0.1" in announced and "FOUR" in announced and "Kestrels 4/0." in announced, True)

    # a digit rolls exactly one runs digit as a ball-tick animation
    anims = page1.evaluate("document.getAnimations().map((a) => ({ id: a.id, target: a.effect && a.effect.getTargetKeyFrames ? a.effect.getTargetKeyFrames : null }))")
    ticks = page1.evaluate("document.getAnimations().filter((a) => a.id === 'ball-tick').length")
    check("one ball-tick per changed runs digit", ticks, 1)

    # the new chip and commentary appear at once
    chips = page1.evaluate("[...document.querySelectorAll('#this-over li')].map((c) => c.textContent)")
    check("this-over chip appears", chips, ["4"])

    # ============ arming an extra ============
    page1.keyboard.press("d")
    page1.wait_for_timeout(150)
    pressed = page1.evaluate("document.querySelector('#pad button[data-key=\"wide\"]').getAttribute('aria-pressed')")
    check("wide arms", pressed, "true")
    page1.keyboard.press("0")
    page1.wait_for_timeout(800)
    chips = page1.evaluate("[...document.querySelectorAll('#this-over li')].map((c) => c.textContent)")
    check("wide chip appears", chips, ["4", "1wd"])
    page1.wait_for_timeout(400)

    # Escape disarms
    page1.keyboard.press("d")
    page1.wait_for_timeout(150)
    page1.keyboard.press("Escape")
    page1.wait_for_timeout(150)
    pressed = page1.evaluate("document.querySelector('#pad button[data-key=\"wide\"]').getAttribute('aria-pressed')")
    check("escape disarms the extra", pressed, "false")

    # ============ B 0 is refused client-side ============
    page1.keyboard.press("b")
    page1.wait_for_timeout(120)
    page1.keyboard.press("0")
    page1.wait_for_timeout(400)
    alerted = page1.evaluate("document.getElementById('alert').textContent")
    check("B 0 refused with the byes copy", alerted, "Byes need at least 1 run.")
    runs_before_byes = page1.evaluate("document.getElementById('scoreboard').dataset.runs")
    page1.keyboard.press("b")
    page1.wait_for_timeout(120)
    page1.keyboard.press("0")
    page1.wait_for_timeout(500)
    runs_after_byes = page1.evaluate("document.getElementById('scoreboard').dataset.runs")
    check("no delivery sent for B 0", runs_after_byes, runs_before_byes)

    # ============ undo ============
    runs_before_undo = page1.evaluate("document.getElementById('scoreboard').dataset.runs")
    seq_before = page1.evaluate("window.__state.last_seq")
    page1.keyboard.press("u")
    page1.wait_for_timeout(900)
    seq_after = page1.evaluate("window.__state.last_seq")
    check("undo removes the last delivery", seq_after, seq_before - 1)

    # ============ the viewer page: live delay and notice ============
    vctx = browser.new_context(viewport={"width": 390, "height": 844})
    vpage = vctx.new_page()
    vpage.goto(f"{BASE}/live/{code}")
    vpage.wait_for_selector("#scoreboard")
    vpage.wait_for_timeout(600)
    viewer_runs = vpage.evaluate("document.getElementById('scoreboard').dataset.runs")
    check("viewer shows the current score", int(viewer_runs), int(runs_before_undo) - (int(runs_before_undo) - int(page1.evaluate("document.getElementById('scoreboard').dataset.runs"))))

    # a delivery recorded by the scorer appears on the viewer after LIVE_DELAY_MS
    t0 = time.time()
    page1.keyboard.press("2")
    # watch the viewer for the change; it must not appear before the delay
    seen = None
    deadline = t0 + 8
    while time.time() < deadline:
        runs_now = vpage.evaluate("document.getElementById('scoreboard').dataset.runs")
        if runs_now != viewer_runs:
            seen = time.time() - t0
            break
        time.sleep(0.05)
    check("viewer shows the delivery after the delay", seen is not None and seen >= 2.5, True)

    ctx1.close()
    ctx2.close()
    vctx.close()
    browser.close()

    check("no page errors on the scorer page", errs1, [])

print()
print("ALL PASS" if failures == 0 else f"{failures} FAILURES")
sys.exit(0 if failures == 0 else 1)
