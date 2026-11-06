import csv
import hashlib
import io
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    center,
    held,
    idempotency_key,
    layout,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    text,
    unique,
)
import conftest as kit

APP_DIR = Path("/app")
PASSWORD = "Hourline-Seed-2027"
NEW_PASSWORD = "Sea-glass-window-27"
IDA = "ida.holm@marenvale.example"
JONAS = "jonas.berg@marenvale.example"
SOFIE = "sofie.lund@marenvale.example"
AMIR = "amir.haddad@marenvale.example"
LEA = "lea.krogh@osterroom.example"
NOOR = "noor.vik@kestrelrow.example"
EMIL = "emil.sand@kestrelrow.example"
MARKETS = ("copenhagen", "stockholm", "paris", "london", "new_york", "tokyo")
CITY = {"copenhagen": "Copenhagen", "stockholm": "Stockholm", "paris": "Paris", "london": "London", "new_york": "New York", "tokyo": "Tokyo"}
ZONE = {"copenhagen": ZoneInfo("Europe/Copenhagen"), "stockholm": ZoneInfo("Europe/Stockholm"), "paris": ZoneInfo("Europe/Paris"), "london": ZoneInfo("Europe/London"), "new_york": ZoneInfo("America/New_York"), "tokyo": ZoneInfo("Asia/Tokyo")}
CPH = ZONE["copenhagen"]

SWEEP_S = 10
MAIL_S = 10
WAIT_S = 30
HTTP_TIMEOUT_S = 30
BOOT_S = 240
STOP_S = 20
POLL_S = 0.25
STEP_MS = 250
QUICK_MS = 1000
FAR_DAYS = 60
GO_LIVE_LEAD_S = 8
SEARCH_SETTLE_MS = 400
DRAFT_SETTLE_MS = 2000
ENTRANCE_WAIT_S = 3
FRAME_SETTLE_MS = 1000
LONG_PRESS_MS = 400
TOUCH_EDGE = 8
JSON_LIMIT = 256000
LINE_SHEET_LIMIT = 1000000
LOOK_LIMIT = 8000000
NAME_MAX = 60
ALT_MAX = 250
TITLE_MAX = 80
HOLD_S = 20
OPT_IN_TTL_S = 20
RATE_WINDOW_S = 12
SESSION_TTL_S = 12
PREVIEW_TTL_S = 15
QUARTER_MIN = 15
HOUR_MIN = 60
LAST_MIN = 23 * 60 + 45
DEFAULT_MIN = 10 * 60
GAP_MIN = 2 * 60 + 30
LATE_MIN = 23 * 60
NIGHT_FROM = 22
NIGHT_UNTIL = 7
RESTOCK_HOUR = 18
ORDINARY_MONTH_DAY = (3, 18)
VAT_PERCENT = 25
RESTOCK_LEAD_S = 20
TICK_MS = 1000
OVER_LIMIT = 100
PAGE_CAP = 50
PRICE_EARLY = 14200
PRICE_NOW = 7500
PRICE_TOMORROW = 5800
DKK_A = 123450
DKK_B = 49950
JPY_A = 26800
SECRET_PRICE = 135795
SECRET_RRP = 189900
HARBOUR = "harbour-wool-edit"
LANTERN = "lantern-ceramics"
REFERENCE = r"HL-[A-Z0-9]{6}"
WRONG_PASSWORD = "Wrong-password-000"
CHOSEN_PASSWORD = "Harbour-tide-lamp-41"
FAR_ZONES = ("Pacific/Kiritimati", "Pacific/Pago_Pago")
WEST_ZONE = "America/Los_Angeles"
PROXIES = ("192.0.2.10", "192.0.2.11")
INJECTED = ("Ana", "Bcc:", "Subject: Free")
FAMILY = "\U0001F468\u200D\U0001F469\u200D\U0001F467"
DRAFT_NOTE = "Keep me"
DRAFT_HOLD_S = 600
FRACTION = ".500"
FORMULA_CELLS = ("=SUM(1,2)", "+Red", "-Dock", "@Fog", "\tInk")
COMMA_CELL = "Coat, long"
SIZED_ROW_END = b";Ink;1;1,00\n"
PNG_PART = ("look.png", "image/png")
JPEG_PART = ("look.jpg", "image/jpeg")
EXIF_MARK = b"Exif"
SVG_SCRIPT = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML_RENAMED = b"<html><body>hi</body></html>"
LOOK_ALT = "A coat at night on the pier"
SECRET_NOTE = "Secret note"
FOREIGN_ORIGIN = "http://elsewhere.example"
ENV_PATH = "/.env"
WRONG_TYPE = "text/plain"
BAD_EMAIL = "not-an-address"
SAVED_ELSEWHERE = "<p>Saved elsewhere.</p>"
MINE = "<p>Mine.</p>"
TYPED = "Typed on the harbour"
MORE = " More."
STORY_HEADING = "Harbour nights"
DRAFT_TEXT = "Draft across the session"
DANISH_WORDS = ("Atlas", "Bo", "Zu", "Æble", "Øst", "Aalborg", "Åsted")
DANISH_ADDED = ("Abe", "Cy")
RATE_LIMIT = 5
FEEDBACK_MS = 140
STATE_MS = 280
ENTRANCE_MS = 560
NEXT_RESTOCKS = 8
RING_REACH = 0.92
SIZES = {"phone": {"width": 375, "height": 812}, "tablet": {"width": 768, "height": 1024}, "desktop": {"width": 1280, "height": 800}}
PHONE = SIZES["phone"]
VIEWPORTS = ["phone", "tablet", "desktop"]

SIGNIN_REFUSED = "That email and password don't match."
SESSION_ENDED = "Your session ended. Sign in again to continue — your draft is kept."
ACCESS_REMOVED = "Your access to this workspace was removed."
UNREACHABLE = "Hourline can't be reached. Nothing was saved. Check your connection and try again."
REQUIRED = "This field is required."
INVITE_SUBJECT = "You're invited to Maren Vale on Hourline"
RESET_SUBJECT = "Reset your Hourline password"

RECORDER = """() => {
  if (window.__motion) return;
  window.__motion = [];
  const push = window.__motion.push.bind(window.__motion);
  window.__motion.push = record => {
    // record_motion() pages also report each duration to the test, so a reload or navigation never hides one
    if (typeof window.__motion_seen === 'function') window.__motion_seen(record.ms);
    return push(record);
  };
  const ms = (list, index) => {
    const parts = list.split(',').map(s => s.trim());
    const v = parts[index % parts.length] || '0s';
    return v.endsWith('ms') ? parseFloat(v) : parseFloat(v) * 1000;
  };
  const keys = a => {
    if (!a || !a.effect || !a.effect.getKeyframes) return ['unknown'];
    const out = new Set();
    for (const frame of a.effect.getKeyframes()) {
      for (const k of Object.keys(frame)) {
        if (!['offset', 'computedOffset', 'easing', 'composite'].includes(k)) out.add(k.replace(/[A-Z]/g, c => '-' + c.toLowerCase()));
      }
    }
    return out.size ? [...out] : ['unknown'];
  };
  document.addEventListener('transitionrun', e => {
    const cs = getComputedStyle(e.target, e.pseudoElement || null);
    const props = cs.transitionProperty.split(',').map(s => s.trim());
    let i = props.indexOf(e.propertyName);
    if (i < 0) i = props.indexOf('all');
    window.__motion.push({target: e.target, ms: ms(cs.transitionDuration, Math.max(i, 0)), props: [e.propertyName]});
  }, true);
  const GROUP = '-ua-view-transition-group-anim-';
  const stillGroup = (name, running) => {
    // the browser's own group tween from an old box to an identical new box moves nothing
    if (!name.startsWith(GROUP) || !running || !running.effect) return false;
    const group = name.slice(GROUP.length);
    const from = running.effect.getKeyframes()[0] || {};
    const shift = from.transform || 'none';
    const m = /matrix\\(([^)]+)\\)/.exec(shift);
    if (!m && shift !== 'none') return false;
    const [a, b, c, d, x, y] = m ? m[1].split(',').map(Number) : [1, 0, 0, 1, 0, 0];
    let box = null;
    if (group === 'root') box = {left: 0, top: 0, width: window.innerWidth, height: window.innerHeight};
    else {
      const el = [...document.querySelectorAll('*')].find(n => getComputedStyle(n).viewTransitionName === group);
      if (el) box = el.getBoundingClientRect();
    }
    const near = (p, q) => Math.abs(p - q) <= 1;
    return !!box && a === 1 && b === 0 && c === 0 && d === 1 && near(x, box.left) && near(y, box.top)
      && near(parseFloat(from.width), box.width) && near(parseFloat(from.height), box.height);
  };
  document.addEventListener('animationstart', e => {
    // a View Transitions route wipe animates ::view-transition-* pseudo-elements of <html>: read their own style
    const pseudo = e.pseudoElement || null;
    const cs = getComputedStyle(e.target, pseudo);
    const i = cs.animationName.split(',').map(s => s.trim()).indexOf(e.animationName);
    const running = (pseudo ? document.getAnimations() : e.target.getAnimations())
      .find(a => a.animationName === e.animationName && (!pseudo || (a.effect && a.effect.pseudoElement === pseudo)));
    const timing = pseudo && running && running.effect ? running.effect.getComputedTiming().duration : null;
    const length = typeof timing === 'number' ? timing : ms(cs.animationDuration, Math.max(i, 0));
    if (pseudo && stillGroup(e.animationName, running)) return;
    window.__motion.push({target: e.target, ms: length, props: keys(running)});
  }, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = original.apply(this, args);
    const d = a.effect.getComputedTiming().duration;
    window.__motion.push({target: this, ms: typeof d === 'number' ? d : 0, props: keys(a)});
    return a;
  };
}"""


RECORDER_INIT = "(" + RECORDER + ")();"
NAME_FIELD = re.compile(r"^Name\b")
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
MOTION_MS = (FEEDBACK_MS, STATE_MS, ENTRANCE_MS)
DOWNLOAD_PUMP_MS = 200
DRAG_STEP_MS = 32
UNSAFE_TAGS = {"script", "style", "iframe", "img", "h1"}
STEADY = """() => document.getAnimations().forEach(a => {
  const end = a.effect && a.effect.getComputedTiming().endTime;
  if (Number.isFinite(end) && a.playState !== 'finished') a.finish();
})"""
LABEL_POINT = """e => {
  const owner = (e.labels && e.labels[0]) || e.closest('label');
  if (!owner) return null;
  owner.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'});
  const r = owner.getBoundingClientRect();
  const p = {x: r.x + r.width / 2, y: r.y + r.height / 2};
  const hit = document.elementFromPoint(p.x, p.y);
  return hit && (hit === owner || owner.contains(hit)) ? p : null;
}"""
TO_CENTRE = "e => e.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'})"
BOTH_IN_VIEW = """(handle, first) => {
  const h = handle.getBoundingClientRect(), f = first.getBoundingClientRect();
  window.scrollBy({top: (h.top + h.height / 2 + f.top + f.height / 2) / 2 - innerHeight / 2, behavior: 'instant'});
}"""


def settled_read(page, script):
    for attempt in range(3):
        try:
            return page.evaluate(script)
        except PlaywrightError as error:
            if "Execution context was destroyed" not in str(error) or attempt == 2:
                raise
            page.wait_for_load_state("load")


def settled_goto(page, url):
    for attempt in range(3):
        try:
            return page.goto(url)
        except PlaywrightError as error:
            if "interrupted by another navigation" not in str(error) or attempt == 2:
                raise
            page.wait_for_load_state("load")


SEEN_MOTION = {}


def record_motion(page):
    if page not in SEEN_MOTION:
        seen = SEEN_MOTION[page] = []
        page.expose_function("__motion_seen", lambda ms: seen.append(ms))
    page.add_init_script(RECORDER_INIT)


def steady(page):
    settled_read(page, STEADY)


def press_point(locator):
    page = locator.page
    for attempt in range(6):
        steady(page)
        try:
            return kit.center(locator)
        except AssertionError:
            if attempt == 5:
                raise
            locator.evaluate(TO_CENTRE)
            advance(page, 48)


def click(locator):
    locator.page.mouse.click(*press_point(locator))


def tap(locator):
    locator.page.touchscreen.tap(*press_point(locator))


def fill(locator, value):
    click(locator)
    locator.fill(value)


def check(locator):
    page = locator.page
    if not locator.is_checked():
        steady(page)
        try:
            page.mouse.click(*kit.center(locator))
        except AssertionError:
            point = locator.evaluate(LABEL_POINT)
            assert point, "control is obscured and its label cannot be pressed"
            page.mouse.click(point["x"], point["y"])
    eventually(page, lambda: expect(locator).to_be_checked(timeout=QUICK_MS))


def axe(page):
    steady(page)
    kit.axe(page)


def visible_one(page, locator):
    def pick():
        steady(page)
        size = page.viewport_size
        for index in range(locator.count()):
            item = locator.nth(index)
            box = item.bounding_box() if item.is_visible() else None
            if box and box["width"] > 0 and box["height"] > 0 and in_viewport(box, size):
                return item
        return None
    return wait_for(pick, WAIT_S, "a control inside the viewport")


def attach(scope, label, payload):
    def put():
        matches = scope.get_by_label(label)
        for index in range(matches.count()):
            try:
                matches.nth(index).set_input_files(payload, timeout=QUICK_MS)
                return True
            except PlaywrightError:
                continue
        return False
    wait_for(put, WAIT_S, f"a file field labelled {label}")


def unknown_like(real):
    text_id = str(real)
    if len(text_id) == 36 and text_id.count("-") == 4:
        fresh = str(uuid.uuid4())
        return fresh if fresh != text_id else str(uuid.uuid4())
    if text_id.isdigit():
        return str(int(text_id) + 10 ** 9)

    def turn(ch):
        if ch.isdigit():
            return str((int(ch) + 5) % 10)
        if "a" <= ch <= "z":
            return chr((ord(ch) - 97 + 13) % 26 + 97)
        if "A" <= ch <= "Z":
            return chr((ord(ch) - 65 + 13) % 26 + 65)
        return ch
    return text_id[:-4] + "".join(turn(ch) for ch in text_id[-4:])


def whole_second_instants(value, where="response"):
    bad = []

    def walk(node, path):
        if isinstance(node, dict):
            for key, item in node.items():
                if isinstance(item, str) and key.endswith(("At", "Until")) and not INSTANT.match(item):
                    bad.append(f"{path}.{key}={item}")
                walk(item, f"{path}.{key}")
        elif isinstance(node, list):
            for index, item in enumerate(node):
                walk(item, f"{path}[{index}]")
    walk(value, where)
    assert not bad, f"instants without whole seconds and a Z: {bad[:8]}"


def motion_kept(page):
    current = settled_read(page, "() => (window.__motion || []).map(m => m.ms)")
    durations = SEEN_MOTION.get(page, []) + current
    off = sorted({round(ms, 2) for ms in durations if ms > 0 and round(ms) not in MOTION_MS})
    assert not off, f"motion outside 140, 280 and 560 ms: {off}"


def recording(page, url):
    record_motion(page)
    page.goto(url)


def wait_for(fn, seconds=WAIT_S, what="condition"):
    end = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        if time.monotonic() > end:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}")
        threading.Event().wait(POLL_S)


def eventually(page, assertion, seconds=WAIT_S):
    end = time.monotonic() + seconds
    while True:
        try:
            assertion()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(page, STEP_MS)


def sees(page, locator):
    eventually(page, lambda: expect(locator).to_be_visible(timeout=QUICK_MS))


def sees_text(page, locator, value):
    eventually(page, lambda: expect(locator).to_have_text(value, timeout=QUICK_MS))


def sees_value(page, locator, value):
    eventually(page, lambda: expect(locator).to_have_value(value, timeout=QUICK_MS))


def sees_focus(page, locator):
    eventually(page, lambda: expect(locator).to_be_focused(timeout=QUICK_MS))


def sees_url(page, pattern):
    eventually(page, lambda: expect(page).to_have_url(pattern, timeout=QUICK_MS))


def heading(page, name, level=1):
    return page.get_by_role("heading", level=level, name=name, exact=True)


def status(page, name):
    return page.get_by_role("status", name=name, exact=True)


def press(locator, key="Enter"):
    locator.focus()
    locator.press(key)


def client(base):
    return httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)


def staff(base, email, password=PASSWORD):
    c = client(base)
    r = c.post("/api/auth/sign-in", json={"email": email, "password": password})
    assert r.status_code == 200, r.text
    return c


def ok(r, expected=200):
    assert r.status_code == expected, f"{r.status_code} {r.text[:800]}"
    return r.json() if r.content else None


ERROR_EXTRAS = ("fields", "savedBy", "savedAt", "current", "claimedAt", "retryAfterSeconds")


def refused(r, expected, error_code):
    assert r.status_code == expected, f"{r.status_code} {r.text[:800]}"
    body = r.json()
    assert body["error"]["code"] == error_code, body
    assert isinstance(body["error"]["message"], str)
    for key in ERROR_EXTRAS:
        if key in body:
            body["error"].setdefault(key, body[key])
    return body


def now_utc():
    return datetime.now(timezone.utc).replace(microsecond=0)


def instant(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_instant(value):
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def cph_today():
    return datetime.now(CPH).date()


def local(day, hh, mm, zone=CPH):
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=zone)


def wall(day, hh, mm):
    return f"{day.isoformat()}T{hh:02d}:{mm:02d}"


def day_text(d):
    return f"{d:%a} {d.day} {d:%b} {d.year}"


def market_time(value, market="copenhagen"):
    dt = parse_instant(value) if isinstance(value, str) else value
    loc = dt.astimezone(ZONE[market])
    return f"{day_text(loc)}, {loc:%H:%M} {CITY[market]} time"


def week_label(dt):
    year, week, _ = dt.astimezone(CPH).isocalendar()
    return f"Week {week} · {year}"


def week_value(dt):
    year, week, _ = dt.astimezone(CPH).isocalendar()
    return f"{year}-W{week:02d}"


def money(minor, currency):
    if currency == "JPY":
        return f"JPY {minor:,}"
    return f"{currency} {minor // 100:,}.{minor % 100:02d}"


def last_sunday(year, month):
    d = date(year, month, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def second_sunday_march(year):
    d = date(year, 3, 1)
    return d + timedelta(days=(6 - d.weekday()) % 7 + 7)


def tag():
    return uuid.uuid4().hex[:8].upper()


def fresh_name():
    return f"Verifier Drop {tag()}"


def count_label(n, noun):
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def step(n):
    return f"Step {n} / 4"


def pos(n, total):
    return f"{n} / {total}"


def pieces_label(market):
    return f"{CITY[market]} pieces"


def at_path(page, path):
    sees_url(page, re.compile(re.escape(path) + r"(\?.*)?$"))


def local_min(day, minutes, zone=CPH):
    hh, mm = divmod(minutes, HOUR_MIN)
    return datetime(day.year, day.month, day.day, hh, mm, tzinfo=zone)


def is_night(moment):
    return moment.hour >= NIGHT_FROM or moment.hour < NIGHT_UNTIL


def vat_minor(net):
    return (net * VAT_PERCENT + 50) // 100


def priced(price, quantity, danish):
    net = price * quantity
    vat = vat_minor(net) if danish else 0
    return net, vat, net + vat


def dial_to(page, minutes):
    page.get_by_role("slider", name="Drop time").focus()
    page.keyboard.press("Home")
    hours, rest = divmod(minutes, HOUR_MIN)
    for _ in range(hours):
        page.keyboard.press("PageUp")
    for _ in range(rest // QUARTER_MIN):
        page.keyboard.press("ArrowUp")


PIN_SCRIPT = r"""el => {
  // L182, L269: what each pin prints. `text` is all of its text, ::before/::after content included; `shown` keeps only
  // what a reader can see, so a Night mark kept in the pin while hidden (for its 140 ms fade-in, L276) is not shown.
  const alpha = value => {
    if (!value || value === 'none' || value === 'transparent') return 0;
    if (value.startsWith('url(')) return 1;
    const slash = /\/\s*([\d.]+)(%?)\s*\)$/.exec(value);
    if (slash) return parseFloat(slash[1]) / (slash[2] ? 100 : 1);
    const rgba = /^rgba\(([^)]*)\)$/.exec(value);
    if (rgba) return parseFloat(rgba[1].split(',')[3]);
    return 1;
  };
  const inked = (node, cs, pin) => {
    if (node instanceof SVGElement) {
      return alpha(cs.fill) * parseFloat(cs.fillOpacity) > 0 || alpha(cs.stroke) * parseFloat(cs.strokeOpacity) > 0;
    }
    if (alpha(cs.webkitTextFillColor || cs.color) > 0) return true;
    if (parseFloat(cs.webkitTextStrokeWidth) > 0 && alpha(cs.webkitTextStrokeColor) > 0) return true;
    // gradient text: a background clipped to the text, on the element or an ancestor inside the pin
    for (let n = node, style = cs; n; n = n === pin ? null : n.parentElement, style = n && getComputedStyle(n)) {
      if (/text/.test(style.backgroundClip || style.webkitBackgroundClip || '')
          && (style.backgroundImage !== 'none' || alpha(style.backgroundColor) > 0)) return true;
    }
    return false;
  };
  const seen = node => !node.checkVisibility || node.checkVisibility(
    {checkOpacity: true, checkVisibilityCSS: true, opacityProperty: true, visibilityProperty: true});
  const quoted = cs => ((cs.content || '').match(/"(?:[^"\\]|\\.)*"/g) || []).map(q => q.slice(1, -1)).join('');
  const area = (rects, stop, start) => {
    // what is left of the text's boxes inside every box that clips them, from their element up to the pin; a box taken
    // out of flow (absolute or fixed) is clipped only from its containing block up
    let boxes = rects.map(r => ({l: r.left, t: r.top, r: r.right, b: r.bottom}));
    let escaping = null;
    for (let node = start; node; node = node === stop ? null : node.parentElement) {
      const cs = getComputedStyle(node);
      const holds = cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none'
        || /paint|layout|strict|content/.test(cs.contain || '') || /transform|filter|perspective/.test(cs.willChange || '');
      if (escaping === 'fixed' ? holds : escaping === 'absolute' && (cs.position !== 'static' || holds)) escaping = null;
      if (cs.clip && cs.clip !== 'auto' && /^(absolute|fixed)$/.test(cs.position)) return 0;
      if (!escaping && (cs.overflowX !== 'visible' || cs.overflowY !== 'visible')) {
        const c = node.getBoundingClientRect();
        boxes = boxes.map(b => ({l: Math.max(b.l, c.left), t: Math.max(b.t, c.top), r: Math.min(b.r, c.right), b: Math.min(b.b, c.bottom)}));
      }
      if (cs.position === 'fixed') escaping = 'fixed';
      else if (cs.position === 'absolute' && escaping !== 'fixed') escaping = 'absolute';
    }
    return boxes.reduce((sum, b) => sum + Math.max(0, b.r - b.l) * Math.max(0, b.b - b.t), 0);
  };
  const printed = pin => {
    const all = [];
    const shown = [];
    const walk = (node, inherited) => {
      const visible = getComputedStyle(node).display === 'contents' ? inherited : seen(node);
      for (const which of ['::before', '::after']) {
        const cs = getComputedStyle(node, which);
        const words = quoted(cs);
        if (!words) continue;
        all.push(words);
        if (visible && cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0 && inked(node, cs, pin)
            && area([node.getBoundingClientRect()], pin, node) > 2) shown.push(words);
      }
      for (const child of node.childNodes) {
        if (child.nodeType === Node.ELEMENT_NODE) {
          walk(child, visible);
        } else if (child.nodeType === Node.TEXT_NODE) {
          all.push(child.nodeValue);
          if (!visible || !child.nodeValue.trim() || !inked(node, getComputedStyle(node), pin)) continue;
          const range = document.createRange();
          range.selectNodeContents(child);
          let rects = Array.from(range.getClientRects());
          if (!rects.length && node instanceof SVGGraphicsElement) rects = [node.getBoundingClientRect()];
          if (area(rects, pin, node) > 2) shown.push(child.nodeValue);
        }
      }
    };
    walk(pin, true);
    return {text: all.join(' '), shown: shown.join(' ')};
  };
  return Array.from(el.getElementsByTagName('*')).filter(n => n.hasAttribute('data-market')).map(n => ({
    market: n.getAttribute('data-market'), local: n.getAttribute('data-local-time'), night: n.getAttribute('data-night'),
    utc: n.getAttribute('data-utc'), ...printed(n)}));
}"""


def prints_night(pin, night):
    return ("Night" in pin["shown"]) == night


def pins(dial):
    return {p["market"]: p for p in dial.evaluate(PIN_SCRIPT)}


def saved_story(page, locator):
    eventually(page, lambda: expect(locator).to_contain_text("Story saved at", timeout=QUICK_MS))


def style(t, n, **over):
    s = {"styleNumber": f"VR-{t}-{n}", "name": "Harbour wool coat", "colour": "Ink", "wholesaleEdition": 120, "rrpDkkMinor": 279900}
    s.update(over)
    return s


def drop_body(**over):
    t = tag()
    body = {
        "name": f"Verifier Drop {t}",
        "type": "simultaneous",
        "goLiveAt": instant(now_utc() + timedelta(days=FAR_DAYS)),
        "holdSeconds": 900,
        "status": "scheduled",
        "palette": ["ink", "vermilion", "sand"],
        "markets": {m: 5 for m in MARKETS},
        "styles": [style(t, 1)],
        "internalNote": f"Internal note {t}",
    }
    body.update(over)
    return {key: value for key, value in body.items() if value is not None}


def create_drop(ida, **over):
    return ok(ida.post("/api/drops", json=drop_body(**over)), 201)


def only(market, pieces):
    return {m: (pieces if m == market else 0) for m in MARKETS}


def public(base, slug):
    return httpx.get(f"{base}/api/public/drops/{slug}", timeout=HTTP_TIMEOUT_S)


def market_of(drop, market="copenhagen"):
    return next(m for m in drop["markets"] if m["market"] == market)


def live_drop(base, pieces, *, hold=900, vip=(), market="copenhagen", swept=False):
    ida = staff(base, IDA)
    go = now_utc() + timedelta(seconds=GO_LIVE_LEAD_S)
    drop = create_drop(ida, goLiveAt=instant(go), holdSeconds=hold, markets=only(market, pieces))
    if vip:
        members = [{"name": n, "email": e} for n, e in vip]
        ok(ida.post(f"/api/drops/{drop['id']}/waitlist/vip", json={"market": market, "members": members}), 201)
    wait_for(lambda: market_of(public(base, drop["slug"]).json(), market)["status"] in ("live", "sold_out"),
             GO_LIVE_LEAD_S + SWEEP_S + 5, "go-live")
    if swept:
        wait_for(lambda: now_utc() >= go + timedelta(seconds=SWEEP_S), GO_LIVE_LEAD_S + SWEEP_S + 5, "the sweep window")
    return ida, drop


def staff_market(ida, drop_id, market="copenhagen"):
    return market_of(ok(ida.get(f"/api/drops/{drop_id}")), market)


def waitlist(ida, drop_id, email):
    items = ok(ida.get(f"/api/drops/{drop_id}/waitlist"))["items"]
    return [i for i in items if i["email"].lower() == email.lower()]


def fresh_ip():
    n = uuid.uuid4().int
    return f"10.{(n >> 16) & 255}.{(n >> 8) & 255}.{n & 255}"


def join(base, slug, email, name="Hana Mori", market="copenhagen", ip=None, consent=True, forwarded=None):
    body = {"market": market, "name": name, "email": email, "consent": consent}
    return post_json(base, f"/api/public/drops/{slug}/waitlist", body, **{"X-Forwarded-For": forwarded or ip or fresh_ip()})


def claim_open(base, slug, email, market="copenhagen", key=None):
    body = {"market": market, "name": "Freja Dahl", "email": email}
    return post_json(base, f"/api/public/drops/{slug}/claims", body, key=key or idempotency_key())


def claim_hold(base, slug, token):
    return post_json(base, f"/api/public/drops/{slug}/claims", {"holdToken": token}, key=idempotency_key())


def mails(mail, address, subject=None):
    found = []
    for m in mail.messages():
        to = [a.lower() for a in addresses(m.get("To"))]
        if address.lower() in to and (subject is None or m.get("Subject") == subject):
            found.append(m)
    return found


def inbox(mail, address, count=1, subject=None, seconds=MAIL_S + 15):
    def got():
        found = mails(mail, address, subject)
        return found if len(found) >= count else None
    return wait_for(got, seconds, f"{count} mail to {address}")


def link_token(message, path):
    match = re.search(re.escape(path) + r"([A-Za-z0-9._~%-]+)", text(message))
    assert match, f"no {path} link in mail"
    return match.group(1)


def new_stockist(jonas, market="copenhagen", **over):
    t = tag()
    body = {"name": f"Verifier Store {t}", "market": market, "contactName": "Sara Holm", "contactEmail": unique("stockist")[1],
            "contactPhone": "+45 31 22 44 10", "notes": "Pays on 30 days"}
    body.update(over)
    return ok(jonas.post("/api/stockists", json=body), 201)


def seeded_stockist(c, name):
    items = ok(c.get("/api/stockists", params={"q": name}))["items"]
    return next(i for i in items if i["name"] == name)


def price_list(sofie, prices, effective=None):
    body = {"name": f"Verifier list {tag()}", "effectiveDate": (effective or cph_today()).isoformat(),
            "prices": [{"styleNumber": s, "currency": c, "unitPriceMinor": p} for s, c, p in prices]}
    return ok(sofie.post("/api/price-lists", json=body), 201)


def allocation(jonas, drop_id, stockist_id, lines, note="Window order"):
    body = {"dropId": drop_id, "stockistId": stockist_id, "lines": [{"styleNumber": s, "quantity": q} for s, q in lines], "internalNote": note}
    return ok(jonas.post("/api/allocations", json=body), 201)


def request(c, drop_id, stockist_id, lines):
    return c.post(f"/api/drops/{drop_id}/requests", json={"stockistId": stockist_id, "lines": [{"styleNumber": s, "quantity": q} for s, q in lines]})


def confirm(sofie, alloc):
    return sofie.post(f"/api/allocations/{alloc['id']}/confirm", json={"version": alloc["version"]})


def line_of(alloc, style_number):
    return next(entry for entry in alloc["lines"] if entry["styleNumber"].lower() == style_number.lower())


def csv_rows(raw):
    return list(csv.DictReader(io.StringIO(raw.decode("utf-8"))))


def invite_member(base, mail, role="merchandiser", stockist_id=None):
    ida = staff(base, IDA)
    name, email = unique("member")
    ok(ida.post("/api/members/invitations", json={"email": email, "role": role, "stockistId": stockist_id}), 202)
    token = link_token(inbox(mail, email, subject=INVITE_SUBJECT)[0], "/invite/")
    c = client(base)
    member = ok(c.post("/api/auth/invitations/accept", json={"token": token, "name": name, "password": NEW_PASSWORD}), 201)["member"]
    return ida, c, member, email


def png(width, height, rgb=(200, 80, 40)):
    raw = b"".join(b"\x00" + bytes(rgb) * width for _ in range(height))

    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def exif_gps(orientation):
    ifd0, entries0 = 8, 2
    gps = ifd0 + 2 + entries0 * 12 + 4
    gps_entries = 2
    lat = gps + 2 + gps_entries * 12 + 4
    t = b"II*\x00" + struct.pack("<I", ifd0) + struct.pack("<H", entries0)
    t += struct.pack("<HHI", 0x0112, 3, 1) + struct.pack("<HH", orientation, 0)
    t += struct.pack("<HHII", 0x8825, 4, 1, gps) + struct.pack("<I", 0)
    t += struct.pack("<H", gps_entries)
    t += struct.pack("<HHI", 0x0001, 2, 2) + b"N\x00\x00\x00"
    t += struct.pack("<HHII", 0x0002, 5, 3, lat) + struct.pack("<I", 0)
    t += struct.pack("<IIIIII", 55, 1, 40, 1, 30, 1)
    return t


def jpeg(width, height, exif=None):
    def seg(marker, payload):
        return b"\xff" + bytes([marker]) + struct.pack(">H", len(payload) + 2) + payload
    out = b"\xff\xd8"
    if exif:
        out += seg(0xE1, b"Exif\x00\x00" + exif)
    out += seg(0xDB, b"\x00" + bytes([1] * 64))
    out += seg(0xC0, b"\x08" + struct.pack(">HH", height, width) + b"\x01\x01\x11\x00")
    out += seg(0xC4, b"\x00" + bytes([1] + [0] * 15) + b"\x00")
    out += seg(0xC4, b"\x10" + bytes([1] + [0] * 15) + b"\x00")
    out += seg(0xDA, b"\x01\x01\x00\x00\x3f\x00")
    blocks = ((width + 7) // 8) * ((height + 7) // 8)
    bits = "00" * blocks
    bits += "1" * ((-len(bits)) % 8)
    data = int(bits, 2).to_bytes(len(bits) // 8, "big").replace(b"\xff", b"\xff\x00")
    return out + data + b"\xff\xd9"


def dims(blob):
    if blob[:8] == b"\x89PNG\r\n\x1a\n":
        return struct.unpack(">II", blob[16:24])
    if blob[:2] == b"\xff\xd8":
        i = 2
        while i < len(blob):
            marker, length = blob[i + 1], struct.unpack(">H", blob[i + 2:i + 4])[0]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3):
                h, w = struct.unpack(">HH", blob[i + 5:i + 9])
                return w, h
            i += 2 + length
    if blob[:4] == b"RIFF" and blob[8:12] == b"WEBP":
        kind = blob[12:16]
        if kind == b"VP8X":
            return 1 + int.from_bytes(blob[24:27], "little"), 1 + int.from_bytes(blob[27:30], "little")
        if kind == b"VP8 ":
            return struct.unpack("<H", blob[26:28])[0] & 0x3FFF, struct.unpack("<H", blob[28:30])[0] & 0x3FFF
        if kind == b"VP8L":
            b = int.from_bytes(blob[21:25], "little")
            return (b & 0x3FFF) + 1, ((b >> 14) & 0x3FFF) + 1
    raise AssertionError("stored object is not a JPEG, PNG or WebP image")


def upload_look(c, drop_id, data, name="look.jpg", ctype="image/jpeg", title="Harbour look", alt="A coat on the pier"):
    return c.post(f"/api/drops/{drop_id}/looks", files={"file": (name, data, ctype)}, data={"title": title, "altText": alt})


def upload_png(c, drop_id, data, **kw):
    name, ctype = PNG_PART
    return upload_look(c, drop_id, data, name=name, ctype=ctype, **kw)


def free_port():
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def tail(log):
    return Path(log).read_text(errors="replace")[-3000:]


def start_copy(**env):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    url = f"http://127.0.0.1:{port}"
    log = tempfile.NamedTemporaryFile(prefix="hourline-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP,
                            env={**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": url, **env},
                            stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    return proc, url, log.name


def await_health(proc, url, log):
    def healthy():
        if proc.poll() is not None:
            raise AssertionError(f"copy exited with {proc.returncode}:\n{tail(log)}")
        try:
            return httpx.get(f"{url}/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False
    try:
        wait_for(healthy, BOOT_S, f"health of {url}")
    except AssertionError as error:
        raise AssertionError(f"{error}\n{tail(log)}") from error


def stop_copy(proc):
    if proc.poll() is None:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=STOP_S)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)
            proc.wait()


@contextmanager
def app_copy(**env):
    proc, url, log = start_copy(**env)
    try:
        await_health(proc, url, log)
        yield url
    finally:
        stop_copy(proc)


@contextmanager
def signed_in(browser, base, email, path, viewport=None, password=PASSWORD, record=False, **options):
    with open_app(browser, f"{base}/sign-in", **options) as page:
        if viewport:
            page.set_viewport_size(viewport)
        r = page.request.post(f"{base}/api/auth/sign-in", data={"email": email, "password": password})
        assert r.status == 200, r.text()
        if record:
            record_motion(page)
        page.goto(f"{base}{path}")
        yield page


class Touch:
    def __init__(self, page):
        self.page = page
        self.cdp = session(page)
        self.cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})

    def _send(self, kind, points):
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})

    def start(self, x, y):
        self._send("touchStart", [{"x": x, "y": y}])

    def move(self, x, y):
        self._send("touchMove", [{"x": x, "y": y}])

    def end(self):
        self._send("touchEnd", [])

    def glide(self, a, b, steps=8):
        for i in range(1, steps + 1):
            self.move(a[0] + (b[0] - a[0]) * i / steps, a[1] + (b[1] - a[1]) * i / steps)
            advance(self.page, DRAG_STEP_MS)

    def swipe(self, a, b):
        self.start(*a)
        self.glide(a, b)
        self.end()

    def tap_at(self, x, y):
        self.start(x, y)
        self.end()


def ring_point(box, hour):
    angle = math.radians(hour / 24 * 360)
    r = min(box["width"], box["height"]) / 2 * RING_REACH
    cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    return cx + r * math.sin(angle), cy - r * math.cos(angle)


def recorded(locator, include_self=True):
    return locator.evaluate(
        "(el, self) => (window.__motion || []).filter(m => el.contains(m.target) && (self || m.target !== el)).map(m => m.ms)",
        include_self)


MOVING = ("transform", "translate", "rotate", "scale", "top", "left", "right", "bottom", "inset", "width", "height",
          "margin", "clip-path", "offset", "unknown")


def records(locator, include_self=True):
    return locator.evaluate(
        "(el, self) => (window.__motion || []).filter(m => el.contains(m.target) && (self || m.target !== el))"
        ".map(m => ({ms: m.ms, props: m.props || ['unknown']}))", include_self)


def slow_moves(entries):
    def moves(prop):
        return any(prop == m or prop.startswith(m + "-") or prop in (f"max-{m}", f"min-{m}") for m in MOVING)
    return [entry for entry in entries if entry["ms"] >= FEEDBACK_MS and any(moves(p) for p in entry["props"])]


NIGHT_FADES = """(root, ms) => (window.__motion || []).filter(m => {
  const t = m.target;
  if (!(t instanceof Element) || !root.contains(t) || m.ms < ms) return false;
  if (!(m.props || []).some(p => ['opacity', 'visibility', 'filter', 'fill-opacity', 'stroke-opacity'].includes(p))) return false;
  const pin = t.closest('[data-night="true"]');
  if (!pin || !root.contains(pin)) return false;
  const says = e => (e.textContent || '').includes('Night');
  if (says(t)) return true;
  if ((t.textContent || '').trim() !== '') return false;
  const icon = t.closest('svg') !== null || t.querySelector('svg') !== null;  // the moon mark
  let up = t.parentElement;  // a moon icon may sit in its own wrapper: read the nearest ancestor that carries text
  while (up && up !== pin && (up.textContent || '').trim() === '') up = up.parentElement;
  return up !== null && says(up) && (up !== pin || icon);  // a blank decoration of the pin is not the Night mark
}).map(m => ({ms: m.ms, props: m.props, text: (m.target.textContent || '').trim()}))"""


def night_fades(locator):
    return locator.evaluate(NIGHT_FADES, FEEDBACK_MS)


SHEET_RISE_INIT = r"""(() => {
  // L278 "bottom sheets rising from the bottom edge". Whatever owns a motion of the Markets sheet (the sheet, any
  // ancestor, a panel filling it, a pseudo-element of the sheet or that panel, or a view-transition snapshot of the
  // sheet or a named ancestor), seek the motion to its start and its end and measure the sheet's visible top.
  window.__sheetRises = [];
  const seen = new WeakSet();  // seeking to the end and back restarts a CSS animation's events; measure each once
  const named = el => {
    const label = el.getAttribute('aria-label');
    if (label) return label;
    return (el.getAttribute('aria-labelledby') || '').split(/\s+/).filter(Boolean)
      .map(id => (document.getElementById(id) || {}).textContent || '').join(' ');
  };
  const sheet = () => Array.from(document.querySelectorAll('[role="region"], section'))
    .find(el => named(el).trim().toLowerCase().includes('markets'));
  const length = (value, height) => /%$/.test(value) ? parseFloat(value) * height / 100 : parseFloat(value) || 0;
  const insetTop = (clip, height) => {
    const m = /^inset\(\s*(-?[\d.]+(?:px|%)?)/.exec(clip || '');
    return m ? length(m[1], height) : 0;
  };
  const shift = cs => {
    const height = parseFloat(cs.height) || 0;
    let y = insetTop(cs.clipPath, height);
    if (cs.transform && cs.transform !== 'none') y += new DOMMatrixReadOnly(cs.transform).m42;
    if (cs.translate && cs.translate !== 'none') y += length(cs.translate.split(/\s+/)[1] || '0', height);
    return y;
  };
  const endOf = a => {
    const t = a.effect.getComputedTiming();
    return Number.isFinite(t.endTime) ? t.endTime : (t.delay || 0) + (typeof t.duration === 'number' ? t.duration : 0);
  };
  const record = (anims, measure, relative) => {
    // relative: measure() gives an offset, not a top; report it against the sheet's settled top
    try {
      const ms = Math.max(...anims.map(a => { const d = a.effect.getComputedTiming().duration; return typeof d === 'number' ? d : 0; }));
      const state = anims.map(a => [a, a.currentTime, a.playState === 'running']);
      anims.forEach(a => a.pause());
      anims.forEach(a => { a.currentTime = 0; });
      const start = measure();
      anims.forEach(a => { a.currentTime = endOf(a); });
      const end = measure();
      state.forEach(([a, time, running]) => { a.currentTime = time; if (running) a.play(); });
      const box = sheet().getBoundingClientRect();
      window.__sheetRises.push(relative ? {ms, start: box.top + start - end, end: box.top, height: box.height, viewport: innerHeight}
        : {ms, start, end, height: box.height, viewport: innerHeight});
    } catch (error) {
      window.__sheetRises.push({ms: 0, start: 0, end: 0, height: 0, viewport: innerHeight, error: String(error)});
    }
  };
  const snapshots = region => {
    let node = region;
    let name = 'none';
    while (node && node !== document.documentElement && name === 'none') {
      name = getComputedStyle(node).viewTransitionName || 'none';
      node = node.parentElement;
    }
    if (name === 'none') return;  // the root snapshot is the whole page, not the sheet
    const parts = ['group', 'image-pair', 'new'].map(part => `::view-transition-${part}(${name})`);
    const anims = document.getAnimations().filter(a => a.effect && parts.includes(a.effect.pseudoElement) && !seen.has(a));
    if (!anims.length) return;
    anims.forEach(a => seen.add(a));
    record(anims, () => parts.reduce((y, part) => y + shift(getComputedStyle(document.documentElement, part)), 0), true);
  };
  const probe = anim => {
    const region = sheet();
    if (!region || !anim || !anim.effect || seen.has(anim)) return;
    const host = anim.effect.target;
    const pseudo = anim.effect.pseudoElement || '';
    if (!(host instanceof Element)) return;
    if (pseudo.startsWith('::view-transition')) return snapshots(region);
    const height = region.getBoundingClientRect().height;
    const panel = host !== region && region.contains(host) && host.getBoundingClientRect().height >= height * 0.8;
    const ancestor = host !== region && host.contains(region);
    if (host !== region && !panel && !ancestor) return;
    if (pseudo && ancestor) return;  // an ancestor's pseudo-element (a route wipe panel, say) is not the sheet
    seen.add(anim);
    if (pseudo) {
      record([anim], () => shift(getComputedStyle(host, pseudo)), true);
      return;
    }
    const el = panel ? host : region;
    record([anim], () => Math.max(el.getBoundingClientRect().top,
      host.getBoundingClientRect().top + insetTop(getComputedStyle(host).clipPath, host.getBoundingClientRect().height)));
  };
  const owned = (e, match) => (e.target.getAnimations ? e.target.getAnimations({subtree: true}) : []).find(a =>
    a.effect && a.effect.target === e.target && (a.effect.pseudoElement || '') === (e.pseudoElement || '') && match(a));
  document.addEventListener('transitionrun', e => probe(owned(e, a => a.transitionProperty === e.propertyName)), true);
  document.addEventListener('animationstart', e => probe(owned(e, a => a.animationName === e.animationName)), true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const a = original.apply(this, args);
    probe(a);
    return a;
  };
  if (document.startViewTransition) {
    const begin = document.startViewTransition.bind(document);
    document.startViewTransition = (...args) => {
      const transition = begin(...args);
      transition.ready.then(() => { const region = sheet(); if (region) snapshots(region); }).catch(() => {});
      return transition;
    };
  }
})();"""
SHEET_RISES = "() => window.__sheetRises || []"


def rises_from_bottom(rise):
    return rise["start"] > rise["end"] and (rise["start"] >= rise["viewport"] or rise["start"] - rise["end"] >= rise["height"] / 2)


def sheet_entrance(page, sheet):
    sees(page, sheet)
    end = time.monotonic() + ENTRANCE_WAIT_S
    while time.monotonic() < end and not any(round(rise["ms"]) == ENTRANCE_MS for rise in page.evaluate(SHEET_RISES)):
        advance(page, STEP_MS)
    return records(sheet), page.evaluate(SHEET_RISES)


def new_drop_to_review(page, app_url, name):
    page.goto(f"{app_url}/studio/drops/new")
    sees(page, page.get_by_text(step(1)))
    fill(page.get_by_role("textbox", name="Drop name"), name)
    click(page.get_by_role("button", name="Next"))
    sees(page, page.get_by_text(step(2)))
    fill(page.get_by_role("spinbutton", name=pieces_label("copenhagen")), "10")
    click(page.get_by_role("button", name="Next"))
    sees(page, page.get_by_text(step(3)))
    click(page.get_by_role("button", name="Add style"))
    fill(page.get_by_role("textbox", name="Style number"), f"VR-{tag()}-1")
    fill(page.get_by_role("textbox", name="Style name"), "Harbour knit")
    fill(page.get_by_role("textbox", name="Colour"), "Sand")
    fill(page.get_by_role("spinbutton", name="Wholesale edition"), "80")
    click(page.get_by_role("button", name="Next"))
    sees(page, page.get_by_text(step(4)))


def overlaps(a, b):
    return not (a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])


def in_viewport(box, size):
    return box["y"] >= 0 and box["y"] + box["height"] <= size["height"] and box["x"] >= 0 and box["x"] + box["width"] <= size["width"]


class Tags(HTMLParser):
    def __init__(self):
        super().__init__()
        self.found = []

    def handle_starttag(self, tag_name, attrs):
        self.found.append((tag_name, dict(attrs)))


def tags_of(html):
    parser = Tags()
    parser.feed(html)
    return parser.found


def test_wf_workspace_access_sign_in(browser, app_url):
    with open_app(browser, f"{app_url}/sign-in") as page:
        sees(page, heading(page, "Sign in"))
        fill(page.get_by_role("textbox", name="Email"), SOFIE)
        fill(page.get_by_label("Password", exact=True), WRONG_PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        sees_text(page, status(page, "Sign-in status"), SIGNIN_REFUSED)
        assert page.request.get(f"{app_url}/api/auth/session").status == 401
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        at_path(page, "/studio/invoicing")
        sees(page, heading(page, "Invoicing"))
        me = page.request.get(f"{app_url}/api/auth/session")
        assert me.status == 200 and me.json()["member"]["email"] == SOFIE
        click(page.get_by_role("button", name="Sign out"))
        sees(page, heading(page, "Sign in"))
        at_path(page, "/sign-in")
        assert page.request.get(f"{app_url}/api/auth/session").status == 401


def test_wf_workspace_access_invite_and_reset(browser, app_url, mail):
    _, email = unique("invitee")
    with signed_in(browser, app_url, IDA, "/studio/members") as page:
        sees(page, heading(page, "Members"))
        click(page.get_by_role("button", name="Invite member"))
        dialog = page.get_by_role("dialog", name="Invite member")
        fill(dialog.get_by_role("textbox", name="Email"), email)
        click(dialog.get_by_role("button", name="Send invitation"))
        sees_text(page, status(page, "Members status"), f"If {email} can be invited, an invitation is on its way.")
    token = link_token(inbox(mail, email, subject=INVITE_SUBJECT)[0], "/invite/")
    with open_app(browser, f"{app_url}/invite/{token}") as page:
        sees(page, heading(page, "Accept your invitation"))
        fill(page.get_by_role("textbox", name="Your name"), "Mette Aagaard")
        fill(page.get_by_label("Password", exact=True), NEW_PASSWORD)
        click(page.get_by_role("button", name="Join workspace"))
        at_path(page, "/studio/drops")
        sees(page, heading(page, "Drops"))
        member = page.request.get(f"{app_url}/api/auth/session").json()["member"]
        assert member["email"] == email and member["role"] == "merchandiser"
    reuse = post_json(app_url, "/api/auth/invitations/accept", {"token": token, "name": "Mette Aagaard", "password": NEW_PASSWORD})
    refused(reuse, 410, "link_used")
    ok(post_json(app_url, "/api/auth/password-reset", {"email": email}), 202)
    reset_token = link_token(inbox(mail, email, subject=RESET_SUBJECT)[0], "/reset-password/")
    chosen = CHOSEN_PASSWORD
    with open_app(browser, f"{app_url}/reset-password/{reset_token}") as page:
        sees(page, heading(page, "Choose a new password"))
        fill(page.get_by_label("New password", exact=True), chosen)
        click(page.get_by_role("button", name="Save password"))

        def reset_saved():
            if urlparse(page.url).path.startswith("/studio/"):
                return
            expect(status(page, "Reset status")).to_have_text("Password saved.", timeout=QUICK_MS)
        eventually(page, reset_saved)
    assert post_json(app_url, "/api/auth/sign-in", {"email": email, "password": chosen}).status_code == 200
    assert post_json(app_url, "/api/auth/sign-in", {"email": email, "password": NEW_PASSWORD}).status_code == 401
    refused(post_json(app_url, "/api/auth/password-reset/complete", {"token": reset_token, "password": chosen}), 410, "link_used")


def test_same_answer_for_every_address(app_url, mail):
    _, stranger = unique("stranger")
    known = post_json(app_url, "/api/auth/sign-in", {"email": IDA, "password": WRONG_PASSWORD})
    unknown = post_json(app_url, "/api/auth/sign-in", {"email": stranger, "password": WRONG_PASSWORD})
    refused(known, 401, "invalid_credentials")
    assert (unknown.status_code, unknown.content) == (known.status_code, known.content)
    before = len(mails(mail, IDA, RESET_SUBJECT))
    reset_known = post_json(app_url, "/api/auth/password-reset", {"email": IDA})
    reset_unknown = post_json(app_url, "/api/auth/password-reset", {"email": stranger})
    assert reset_known.status_code == 202 and reset_known.json() == {"status": "reset_requested"}
    assert (reset_unknown.status_code, reset_unknown.content) == (reset_known.status_code, reset_known.content)
    inbox(mail, IDA, before + 1, RESET_SUBJECT)
    ida = staff(app_url, IDA)
    _, newcomer = unique("newcomer")
    jonas_invites = len(mails(mail, JONAS, INVITE_SUBJECT))
    fresh = ida.post("/api/members/invitations", json={"email": newcomer, "role": "merchandiser", "stockistId": None})
    existing = ida.post("/api/members/invitations", json={"email": JONAS, "role": "merchandiser", "stockistId": None})
    assert fresh.status_code == 202 and fresh.json() == {"status": "invitation_sent"}
    assert (existing.status_code, existing.content) == (fresh.status_code, fresh.content)
    inbox(mail, newcomer, 1, INVITE_SUBJECT)
    assert mails(mail, stranger) == []
    assert len(mails(mail, JONAS, INVITE_SUBJECT)) == jonas_invites


def test_member_records_stay_in_workspace(app_url):
    noor = staff(app_url, NOOR)
    emil = next(m for m in ok(noor.get("/api/members"))["items"] if m["email"] == EMIL)
    ida = staff(app_url, IDA)
    ghost = unknown_like(emil["id"])
    for method, extra in (("GET", {}), ("PATCH", {"json": {"role": "press_lead"}}), ("DELETE", {})):
        other = ida.request(method, f"/api/members/{emil['id']}", **extra)
        missing = ida.request(method, f"/api/members/{ghost}", **extra)
        refused(other, 404, "not_found")
        assert (missing.status_code, missing.content) == (other.status_code, other.content)
    assert all(m["email"] != EMIL for m in ok(ida.get("/api/members"))["items"])
    assert ok(noor.get(f"/api/members/{emil['id']}"))["role"] == "merchandiser"


def test_only_producer_manages_members(app_url, mail):
    ida, _, target, _ = invite_member(app_url, mail)
    for email in (JONAS, SOFIE, AMIR):
        c = staff(app_url, email)
        _, outsider = unique("blocked")
        refused(c.post("/api/members/invitations", json={"email": outsider, "role": "merchandiser", "stockistId": None}), 403, "forbidden")
        refused(c.patch(f"/api/members/{target['id']}", json={"role": "press_lead"}), 403, "forbidden")
        refused(c.delete(f"/api/members/{target['id']}"), 403, "forbidden")
        assert mails(mail, outsider) == []
    lea = staff(app_url, LEA)
    _, outsider = unique("blocked")
    refused(lea.post("/api/members/invitations", json={"email": outsider, "role": "merchandiser", "stockistId": None}), 403, "forbidden")
    refused(lea.patch(f"/api/members/{target['id']}", json={"role": "press_lead"}), 404, "not_found")
    refused(lea.delete(f"/api/members/{target['id']}"), 404, "not_found")
    assert [m["email"] for m in ok(lea.get("/api/members"))["items"]] == [LEA]
    assert ok(ida.get(f"/api/members/{target['id']}"))["role"] == "merchandiser"
    assert ok(ida.patch(f"/api/members/{target['id']}", json={"role": "press_lead"}))["role"] == "press_lead"
    assert ida.delete(f"/api/members/{target['id']}").status_code == 204
    refused(ida.get(f"/api/members/{target['id']}"), 404, "not_found")


def test_wf_public_calendar_browse(browser, app_url):
    ida = staff(app_url, IDA)
    go = now_utc() + timedelta(days=FAR_DAYS)
    drop = create_drop(ida, goLiveAt=instant(go))
    label = week_label(go)
    with open_app(browser, f"{app_url}/") as page:
        recording(page, f"{app_url}/")
        sees(page, heading(page, "Drop calendar"))
        fill(page.get_by_role("searchbox", name="Search drops"), drop["name"])
        advance(page, SEARCH_SETTLE_MS)
        drops = page.get_by_role("list", name="Drops")
        sees(page, drops.get_by_role("heading", level=2, name=label))
        card_list = drops.get_by_role("list", name=label)
        sees(page, card_list.get_by_role("link", name=drop["name"]))
        expect(card_list.get_by_role("listitem").filter(has_text=drop["name"])).to_contain_text("Upcoming")
        sees_text(page, status(page, "Calendar results"), count_label(1, "drop"))
        page.set_viewport_size(PHONE)
        filters = page.get_by_role("button", name="Filters")
        tap(filters)
        sheet = page.get_by_role("dialog", name="Filters")
        sees(page, sheet)
        steady(page)
        select(sheet.get_by_role("combobox", name="Market"), "Tokyo")
        show = sheet.get_by_role("button", name=f"Show {count_label(1, 'drop')}", exact=True)
        sees(page, show)
        eventually(page, lambda: assertion_true(sheet.bounding_box()["y"] + sheet.bounding_box()["height"] >= PHONE["height"] - 2))
        steady(page)
        assert in_viewport(show.bounding_box(), PHONE)
        axe(page)
        tap(show)
        eventually(page, lambda: expect(sheet).to_be_hidden(timeout=QUICK_MS))
        sees_focus(page, filters)
        assert parse_qs(urlparse(page.url).query)["market"] == ["tokyo"]
        motion_kept(page)
    items = httpx.get(f"{app_url}/api/public/drops", params={"q": drop["name"], "market": "tokyo"}).json()["items"]
    assert [i["slug"] for i in items] == [drop["slug"]] and items[0]["weekLabel"] == label
    whole_second_instants(httpx.get(f"{app_url}/api/public/drops", params={"q": drop["name"]}).json())
    wrong = httpx.post(f"{app_url}/api/public/drops", content="{", headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN})
    refused(wrong, 405, "method_not_allowed")
    assert "GET" in wrong.headers["Allow"]


def assertion_true(value):
    assert value


def test_calendar_state_in_url(browser, app_url):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    with open_app(browser, f"{app_url}/") as page:
        sees(page, heading(page, "Drop calendar"))
        assert urlparse(page.url).query == ""
        start = page.evaluate("() => history.length")
        select(page.get_by_role("combobox", name="Market"), "Tokyo")
        eventually(page, lambda: assertion_true(parse_qs(urlparse(page.url).query).get("market") == ["tokyo"]))
        assert page.evaluate("() => history.length") == start + 1
        select(page.get_by_role("combobox", name="Sort"), "Name A–Z")
        eventually(page, lambda: assertion_true(parse_qs(urlparse(page.url).query).get("sort") == ["name"]))
        assert page.evaluate("() => history.length") == start + 2
        search = page.get_by_role("searchbox", name="Search drops")
        search.focus()
        page.keyboard.type(drop["name"])
        advance(page, SEARCH_SETTLE_MS)
        eventually(page, lambda: assertion_true(parse_qs(urlparse(page.url).query).get("q") == [drop["name"]]))
        assert page.evaluate("() => history.length") == start + 3
        sees(page, page.get_by_role("list", name="Drops").get_by_role("link", name=drop["name"]))
        page.go_back()
        eventually(page, lambda: assertion_true("q" not in parse_qs(urlparse(page.url).query)))
        eventually(page, lambda: expect(search).to_have_value("", timeout=QUICK_MS))
        assert parse_qs(urlparse(page.url).query).get("sort") == ["name"]
        page.go_back()
        eventually(page, lambda: assertion_true("sort" not in parse_qs(urlparse(page.url).query)))
        assert parse_qs(urlparse(page.url).query).get("market") == ["tokyo"]
        page.go_forward()
        eventually(page, lambda: assertion_true(parse_qs(urlparse(page.url).query).get("sort") == ["name"]))
        page.goto(f"{app_url}/?{urlencode({'market': 'tokyo', 'q': drop['name']})}")
        eventually(page, lambda: expect(page.get_by_role("searchbox", name="Search drops")).to_have_value(drop["name"], timeout=QUICK_MS))
        sees(page, page.get_by_role("list", name="Drops").get_by_role("link", name=drop["name"]))
        sees_text(page, status(page, "Calendar results"), count_label(1, "drop"))


def test_status_words_marks_and_contrast(browser, app_url):
    with open_app(browser, f"{app_url}/") as page:
        sees(page, heading(page, "Drop calendar"))
        for name, word in (("Night Ferry Knits", "Live"), ("Salt Linen", "Sold out"), ("Harbour Wool Edit", "Upcoming")):
            fill(page.get_by_role("searchbox", name="Search drops"), name)
            advance(page, SEARCH_SETTLE_MS)
            card = page.get_by_role("list", name="Drops").get_by_role("listitem").filter(has=page.get_by_role("link", name=name)).last
            eventually(page, lambda: expect(card).to_contain_text(word, timeout=QUICK_MS))
        axe(page)
        page.goto(f"{app_url}/drops/{LANTERN}")
        sees(page, heading(page, "This drop was withdrawn"))
        expect(page.get_by_text("Withdrawn", exact=True).first).to_be_visible()
        axe(page)
    ida = staff(app_url, IDA)
    harbour = next(d for d in ok(ida.get("/api/drops"))["items"] if d["slug"] == HARBOUR)
    with signed_in(browser, app_url, IDA, f"/studio/drops/{harbour['id']}") as page:
        dial = page.get_by_role("group", name="Embargo dial")
        sees(page, dial)
        eventually(page, lambda: assertion_true(set(pins(dial)) == set(MARKETS)))

        def night_words():
            steady(page)
            for pin in pins(dial).values():
                assert prints_night(pin, pin["night"] == "true"), pin
        eventually(page, night_words)
        axe(page)


def test_wf_public_calendar_withdrawn(browser, app_url):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    assert f"/drops/{drop['slug']}" in httpx.get(f"{app_url}/sitemap.xml").text
    with signed_in(browser, app_url, IDA, f"/studio/drops/{drop['id']}") as page:
        sees(page, heading(page, f"Plan {drop['name']}"))
        click(page.get_by_role("button", name="Withdraw drop"))
        dialog = page.get_by_role("dialog", name="Withdraw drop")
        fill(dialog.get_by_role("textbox", name="Reason"), "Supplier delay")
        click(dialog.get_by_role("button", name="Withdraw drop"))
        sees_text(page, status(page, "Planner status"), "Drop withdrawn. Its public page now shows it as withdrawn.")
        sees_focus(page, heading(page, f"Plan {drop['name']}"))
        response = page.goto(f"{app_url}/drops/{drop['slug']}")
        assert response.status == 410
        sees(page, heading(page, "This drop was withdrawn"))
        expect(page.get_by_role("link", name="Back to the drop calendar")).to_be_visible()
        page.goto(f"{app_url}/?{urlencode({'q': drop['name']})}")
        sees_text(page, status(page, "Calendar results"), "No drops match these filters.")
        expect(page.get_by_role("link", name=drop["name"])).to_have_count(0)
    refused(public(app_url, drop["slug"]), 410, "drop_withdrawn")
    items = httpx.get(f"{app_url}/api/public/drops", params={"q": drop["name"]}).json()["items"]
    assert all(i["slug"] != drop["slug"] for i in items)
    assert f"/drops/{drop['slug']}" not in httpx.get(f"{app_url}/sitemap.xml").text
    assert ok(ida.get(f"/api/drops/{drop['id']}"))["status"] == "withdrawn"


def test_copenhagen_calendar_dates(browser, app_url):
    ida = staff(app_url, IDA)
    day = cph_today() + timedelta(days=FAR_DAYS)
    day += timedelta(days=(7 - day.weekday()) % 7)
    go = local(day, 0, 30)
    drop = create_drop(ida, goLiveAt=instant(go))
    label = week_label(go)
    listing = httpx.get(f"{app_url}/api/public/drops", params={"q": drop["name"]}).json()
    assert listing["items"][0]["weekLabel"] == label
    today = date.fromisoformat(listing["todayCopenhagen"])
    for zone in FAR_ZONES:
        context = browser.new_context(timezone_id=zone)
        try:
            page = context.new_page()
            page.goto(f"{app_url}/?{urlencode({'q': drop['name']})}")
            expect(page.get_by_text(f"Today in Copenhagen: {day_text(today)}").first).to_be_visible()
            drops = page.get_by_role("list", name="Drops")
            expect(drops.get_by_role("heading", level=2, name=label)).to_be_visible()
            expect(drops.get_by_role("list", name=label).get_by_role("link", name=drop["name"])).to_be_visible()
        finally:
            context.close()


def test_wf_waitlist_join_on_phone(browser, app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    name, email = unique("phone")
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(PHONE)
        page.context.set_extra_http_headers({"X-Forwarded-For": fresh_ip()})
        recording(page, f"{app_url}/drops/{drop['slug']}")
        sees(page, heading(page, drop["name"]))
        form = page.get_by_role("form", name="Join the waitlist")
        fill(form.get_by_role("textbox", name=NAME_FIELD), name)
        field = form.get_by_role("textbox", name="Email")
        fill(field, email)
        select(form.get_by_role("combobox", name="Market"), "Tokyo")
        check(form.get_by_role("checkbox", name="I agree to receive drop emails"))
        field.focus()
        join_button = visible_one(page, page.get_by_role("button", name="Join waitlist"))
        axe(page)
        assert in_viewport(join_button.bounding_box(), PHONE)
        assert not overlaps(field.bounding_box(), join_button.bounding_box())
        tap(join_button)
        sees_text(page, status(page, "Waitlist status"), "Check your inbox. If this address can join, a confirmation link is on its way.")
        motion_kept(page)
    message = inbox(mail, email, subject=f"Confirm your place on the {drop['name']} waitlist")[0]
    token = link_token(message, "/waitlist/confirm/")
    assert waitlist(ida, drop["id"], email)[0]["status"] == "pending"
    with open_app(browser, f"{app_url}/waitlist/confirm/{token}") as page:
        page.set_viewport_size(PHONE)
        sees(page, heading(page, "Waitlist confirmation"))
        tap(page.get_by_role("button", name="Confirm my place"))
        sees_text(page, status(page, "Waitlist status"), f"You're on the waitlist for {drop['name']} in Tokyo.")
    entry = waitlist(ida, drop["id"], email)
    assert len(entry) == 1 and entry[0]["status"] == "confirmed" and entry[0]["market"] == "tokyo"
    whole_second_instants(ok(ida.get(f"/api/drops/{drop['id']}/waitlist")))
    crossed = httpx.post(f"{app_url}/api/public/drops/{drop['slug']}/waitlist", content="{",
                         headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN, "X-Forwarded-For": fresh_ip()})
    refused(crossed, 403, "cross_origin")


def test_wf_waitlist_consent_problems(browser, app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    name, email = unique("consent")
    with open_app(browser, f"{app_url}/") as page:
        page.context.set_extra_http_headers({"X-Forwarded-For": fresh_ip()})
        page.goto(f"{app_url}/drops/{drop['slug']}")
        form = page.get_by_role("form", name="Join the waitlist")
        fill(form.get_by_role("textbox", name=NAME_FIELD), name)
        fill(form.get_by_role("textbox", name="Email"), email)
        click(form.get_by_role("button", name="Join waitlist"))
        problems = page.get_by_role("region", name="Problems")
        sees(page, problems)
        expect(problems.get_by_role("heading", level=2, name="Problems")).to_be_visible()
        consent_label, consent_message = "I agree to receive drop emails", "Tick the box to agree to drop emails."
        problem = problems.get_by_role("link", name=f"{consent_label}: {consent_message}")
        expect(problem).to_be_visible()
        click(problem)
        sees_focus(page, form.get_by_role("checkbox", name="I agree to receive drop emails"))
        assert waitlist(ida, drop["id"], email) == []
        check(form.get_by_role("checkbox", name="I agree to receive drop emails"))
        click(form.get_by_role("button", name="Join waitlist"))
        sees_text(page, status(page, "Waitlist status"), "Check your inbox. If this address can join, a confirmation link is on its way.")
    inbox(mail, email, subject=f"Confirm your place on the {drop['name']} waitlist")
    assert len(waitlist(ida, drop["id"], email)) == 1


def test_waitlist_one_join_one_reply(app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    _, email = unique("double")
    subject = f"Confirm your place on the {drop['name']} waitlist"
    ip = fresh_ip()
    with ThreadPoolExecutor(2) as pool:
        first, second = pool.map(lambda _: join(app_url, drop["slug"], email, ip=ip), range(2))
    assert first.status_code == 202 and first.json() == {"status": "check_email"}
    assert second.content == first.content
    assert len(waitlist(ida, drop["id"], email)) == 1
    token = link_token(inbox(mail, email, subject=subject)[0], "/waitlist/confirm/")
    assert len(inbox(mail, email, subject=subject)) == 1
    ok(post_json(app_url, "/api/public/waitlist/confirm", {"token": token}))
    confirmed = join(app_url, drop["slug"], email, ip=ip)
    _, other = unique("other")
    stranger = join(app_url, drop["slug"], other)
    assert (confirmed.status_code, confirmed.content) == (first.status_code, first.content)
    assert (stranger.status_code, stranger.content) == (first.status_code, first.content)
    inbox(mail, other, subject=subject)
    assert len(mails(mail, email, subject)) == 1
    assert len(waitlist(ida, drop["id"], email)) == 1


def test_opt_in_link_once_and_expiry(app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    subject = f"Confirm your place on the {drop['name']} waitlist"
    _, used = unique("once")
    ok(join(app_url, drop["slug"], used), 202)
    token = link_token(inbox(mail, used, subject=subject)[0], "/waitlist/confirm/")
    body = ok(post_json(app_url, "/api/public/waitlist/confirm", {"token": token}))
    assert body["status"] == "confirmed" and body["dropName"] == drop["name"] and body["market"] == "copenhagen"
    refused(post_json(app_url, "/api/public/waitlist/confirm", {"token": token}), 410, "link_used")
    with app_copy(OPT_IN_LINK_TTL_SECONDS=str(OPT_IN_TTL_S)) as copy:
        _, late = unique("late")
        ok(join(copy, drop["slug"], late), 202)
        issued = time.monotonic()
        stale = link_token(inbox(mail, late, subject=subject)[0], "/waitlist/confirm/")
        wait_for(lambda: time.monotonic() - issued > OPT_IN_TTL_S + 1, OPT_IN_TTL_S + 5, "opt-in expiry")
        refused(post_json(copy, "/api/public/waitlist/confirm", {"token": stale}), 410, "link_expired")
        assert waitlist(ida, drop["id"], late)[0]["status"] == "pending"
        ok(join(copy, drop["slug"], late), 202)
        fresh = inbox(mail, late, 2, subject)
        renewed = [link_token(m, "/waitlist/confirm/") for m in fresh]
        assert len(fresh) == 2 and len(set(renewed)) == 2
        new_token = next(t for t in renewed if t != stale)
        ok(post_json(copy, "/api/public/waitlist/confirm", {"token": new_token}))
    assert waitlist(ida, drop["id"], late)[0]["status"] == "confirmed"


def test_waitlist_rate_limit(app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    ip = fresh_ip()
    with app_copy(WAITLIST_RATE_WINDOW_SECONDS=str(RATE_WINDOW_S)) as copy:
        ok(join(copy, drop["slug"], unique("burst")[1], forwarded=f"{ip}, {PROXIES[0]}"), 202)
        started = time.monotonic()
        for _ in range(RATE_LIMIT - 1):
            ok(join(copy, drop["slug"], unique("burst")[1], forwarded=f"{ip}, {PROXIES[0]}"), 202)
        _, blocked = unique("blocked")
        r = join(copy, drop["slug"], blocked, forwarded=f"{ip} , {PROXIES[1]}")
        body = refused(r, 429, "rate_limited")
        retry = r.headers["Retry-After"]
        assert retry.isdigit() and 1 <= int(retry) <= RATE_WINDOW_S
        assert body["error"]["retryAfterSeconds"] == int(retry)
        wait_copy = {f"Too many sign-ups from this connection. Try again in {retry} seconds.",
                     f"Too many sign-ups from this connection. Try again in {count_label(int(retry), 'second')}."}
        assert body["error"]["message"] in wait_copy
        assert waitlist(ida, drop["id"], blocked) == []
        ok(join(copy, drop["slug"], unique("elsewhere")[1], forwarded=f"{fresh_ip()}, {ip}"), 202)
        wait_for(lambda: time.monotonic() - started > RATE_WINDOW_S + 1, RATE_WINDOW_S + 5, "rate window")
        ok(join(copy, drop["slug"], unique("later")[1], forwarded=ip), 202)
    assert mails(mail, blocked) == []


def test_waitlist_names(app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    _, email = unique("crlf")
    _, evil = unique("evil")
    head, bcc, tail = INJECTED
    name = f"{head}  \r\n  {bcc} {evil}\r\n\r\n{tail}"
    ok(join(app_url, drop["slug"], email, name=name), 202)
    message = inbox(mail, email)[0]
    assert message["Subject"] == f"Confirm your place on the {drop['name']} waitlist"
    assert [a.lower() for a in addresses(message.get("To"))] == [email.lower()]
    assert addresses(message.get("Bcc")) == [] and addresses(message.get("Cc")) == []
    assert mails(mail, evil) == []
    assert waitlist(ida, drop["id"], email)[0]["name"] == f"{head} {bcc} {evil} {tail}"
    family = FAMILY
    _, fits = unique("graphemes")
    ok(join(app_url, drop["slug"], fits, name=family * NAME_MAX), 202)
    _, long_name = unique("toolong")
    body = refused(join(app_url, drop["slug"], long_name, name=family * (NAME_MAX + 1)), 422, "validation_failed")
    assert body["error"]["fields"]["name"] == f"Use at most {NAME_MAX} characters."
    assert len(waitlist(ida, drop["id"], fits)) == 1 and waitlist(ida, drop["id"], long_name) == []


def test_wf_drop_planner_launch_night(browser, app_url):
    t = tag()
    name = fresh_name()
    day = cph_today() + timedelta(days=FAR_DAYS)
    expected = instant(local(day, 10, 0))
    vip = [unique("vip"), unique("vip")]
    with signed_in(browser, app_url, IDA, "/studio/drops", record=True) as page:
        sees(page, heading(page, "Drops"))
        click(page.get_by_role("link", name="New drop"))
        sees(page, heading(page, "New drop"))
        fill(page.get_by_role("textbox", name="Drop name"), name)
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(2)))
        fill(page.get_by_role("spinbutton", name=pieces_label("copenhagen")), "10")
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(3)))
        click(page.get_by_role("button", name="Add style"))
        fill(page.get_by_role("textbox", name="Style number"), f"VR-{t}-1")
        fill(page.get_by_role("textbox", name="Style name"), "Harbour wool coat")
        fill(page.get_by_role("textbox", name="Colour"), "Ink")
        fill(page.get_by_role("spinbutton", name="Wholesale edition"), "120")
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(4)))
        click(page.get_by_role("button", name="Create drop"))
        sees(page, heading(page, f"Plan {name}"))
        advance(page, ENTRANCE_MS + STEP_MS)
        drop_id = urlparse(page.url).path.rstrip("/").split("/")[-1]
        fill(page.get_by_role("textbox", name="Drop date"), day.isoformat())
        page.keyboard.press("Tab")
        dial_to(page, DEFAULT_MIN)
        dial = page.get_by_role("group", name="Embargo dial")
        eventually(page, lambda: expect(dial).to_have_attribute("data-utc", expected, timeout=QUICK_MS))
        assert "Night" in pins(dial)["new_york"]["text"]
        expect(page.get_by_role("table", name="Market times").get_by_role("row")).to_have_count(7)
        press(visible_one(page, page.get_by_role("button", name="Save time")))
        sees_text(page, status(page, "Planner status"), f"Go-live saved: {market_time(expected)}.")
        press(page.get_by_role("button", name="Schedule drop"))
        sees_text(page, status(page, "Planner status"), "Drop scheduled.")
        opener = page.get_by_role("button", name="Add VIP members")
        press(opener)
        dialog = page.get_by_role("dialog", name="Add VIP members")
        sees_focus(page, dialog.get_by_role("combobox", name="Market"))
        page.keyboard.press("Escape")
        sees_focus(page, opener)
        press(opener)
        sees_focus(page, dialog.get_by_role("combobox", name="Market"))
        axe(page)
        fill(dialog.get_by_role("textbox", name="VIP list"), "\n".join(f"{n} <{e}>" for n, e in vip))
        press(dialog.get_by_role("button", name="Add members"))
        sees_text(page, status(page, "Planner status"), f"{count_label(2, 'VIP member')} added to the {CITY['copenhagen']} waitlist.")
        sees_focus(page, opener)
        restock = page.get_by_role("region", name="Weekly restock")
        fill(restock.get_by_role("textbox", name="First restock date"), (day + timedelta(days=7)).isoformat())
        fill(restock.get_by_role("textbox", name="Restock time"), "18:00")
        fill(restock.get_by_role("spinbutton", name=f"{CITY['copenhagen']} restock pieces"), "3")
        press(restock.get_by_role("button", name="Save restock"))
        first_restock = day + timedelta(days=7)
        saved_copy = {f"Weekly restock saved: every {first_restock:%A} at 18:00 Copenhagen time.",
                      f"Weekly restock saved: every {first_restock:%a} at 18:00 Copenhagen time."}
        eventually(page, lambda: assertion_true(status(page, "Planner status").inner_text().strip() in saved_copy))
        eventually(page, lambda: expect(page.get_by_role("table", name="Next restocks").get_by_role("row")).to_have_count(NEXT_RESTOCKS + 1, timeout=QUICK_MS))
        motion_kept(page)
    ida = staff(app_url, IDA)
    drop = ok(ida.get(f"/api/drops/{drop_id}"))
    assert drop["name"] == name and drop["status"] == "scheduled" and drop["goLiveAt"] == expected
    assert drop["copenhagenGoLive"] == wall(day, 10, 0)
    for n, e in vip:
        entry = waitlist(ida, drop_id, e)
        assert len(entry) == 1 and entry[0]["status"] == "confirmed" and entry[0]["market"] == "copenhagen"
    restocks = ok(ida.get(f"/api/drops/{drop_id}/restocks"))["items"]
    assert len(restocks) == 1 and len(restocks[0]["nextInstants"]) == NEXT_RESTOCKS
    assert restocks[0]["pieces"]["copenhagen"] == 3
    whole_second_instants(drop)
    oversized = json.dumps({"internalNote": "x" * (JSON_LIMIT + 1)})
    refused(staff(app_url, JONAS).patch(f"/api/drops/{drop_id}", content=oversized, headers={"Content-Type": "application/json"}), 403, "forbidden")


def test_wf_drop_planner_pointer_and_touch(browser, app_url):
    ida = staff(app_url, IDA)
    day = cph_today() + timedelta(days=FAR_DAYS)
    drop = create_drop(ida, status="draft", goLiveAt=None, copenhagenGoLive=wall(day, 10, 0))
    with signed_in(browser, app_url, IDA, f"/studio/drops/{drop['id']}") as page:
        dial = page.get_by_role("group", name="Embargo dial")
        sees(page, dial)
        dial.evaluate(TO_CENTRE)
        page.mouse.click(*ring_point(dial.bounding_box(), 3))
        eventually(page, lambda: expect(dial).to_have_attribute("data-utc", instant(local(day, 3, 0)), timeout=QUICK_MS))
        box = dial.bounding_box()
        page.mouse.move(*ring_point(box, 3))
        page.mouse.down()
        for hour in (4, 5, 6):
            page.mouse.move(*ring_point(box, hour))
            advance(page, DRAG_STEP_MS)
        page.mouse.up()
        eventually(page, lambda: expect(dial).to_have_attribute("data-utc", instant(local(day, 6, 0)), timeout=QUICK_MS))
        page.set_viewport_size(PHONE)
        dial.evaluate(TO_CENTRE)
        touch = Touch(page)
        touch.tap_at(*ring_point(dial.bounding_box(), 9))
        eventually(page, lambda: expect(dial).to_have_attribute("data-utc", instant(local(day, 9, 0)), timeout=QUICK_MS))
        save = visible_one(page, page.get_by_role("button", name="Save time"))
        assert in_viewport(save.bounding_box(), PHONE)
        x, y = press_point(save)
        touch.tap_at(x, y)
        sees_text(page, status(page, "Planner status"), f"Go-live saved: {market_time(local(day, 9, 0))}.")
    assert ok(ida.get(f"/api/drops/{drop['id']}"))["copenhagenGoLive"] == wall(day, 9, 0)


def test_dial_slider_keys_and_spoken_value(browser, app_url):
    ida = staff(app_url, IDA)
    day = cph_today() + timedelta(days=FAR_DAYS)
    drop = create_drop(ida, status="draft", goLiveAt=None, copenhagenGoLive=wall(day, 10, 0))
    context = browser.new_context(timezone_id=WEST_ZONE)
    try:
        page = context.new_page()
        assert page.request.post(f"{app_url}/api/auth/sign-in", data={"email": IDA, "password": PASSWORD}).status == 200
        page.goto(f"{app_url}/studio/drops/{drop['id']}")
        expect(page.get_by_role("textbox", name="Drop date")).to_have_value(day.isoformat())
        slider = page.get_by_role("slider", name="Drop time")
        slider.focus()

        def spoken(minutes):
            expect(slider).to_have_attribute("aria-valuetext", market_time(local_min(day, minutes)))
        current = DEFAULT_MIN
        spoken(current)
        moves = {"ArrowUp": QUARTER_MIN, "ArrowRight": QUARTER_MIN, "ArrowDown": -QUARTER_MIN, "ArrowLeft": -QUARTER_MIN,
                 "PageUp": HOUR_MIN, "PageDown": -HOUR_MIN}
        for key in ("ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "PageUp", "PageDown", "Home", "ArrowDown", "PageDown",
                    "ArrowLeft", "End", "ArrowUp", "PageUp", "ArrowRight"):
            page.keyboard.press(key)
            if key == "Home":
                current = 0
            elif key == "End":
                current = LAST_MIN
            else:
                current = min(max(current + moves[key], 0), LAST_MIN)
            spoken(current)
    finally:
        context.close()


def test_dial_pins_local_times_and_night(browser, app_url):
    ida = staff(app_url, IDA)
    day = cph_today() + timedelta(days=FAR_DAYS)
    drop = create_drop(ida, status="draft", goLiveAt=None, copenhagenGoLive=wall(day, 10, 0))
    year = cph_today().year + 1
    gap, us_gap = last_sunday(year, 3), second_sunday_march(year)
    with signed_in(browser, app_url, IDA, f"/studio/drops/{drop['id']}") as page:
        dial = page.get_by_role("group", name="Embargo dial")
        sees(page, dial)
        dial_to(page, LATE_MIN)
        moment = local_min(day, LATE_MIN)
        eventually(page, lambda: expect(dial).to_have_attribute("data-utc", instant(moment), timeout=QUICK_MS))
        ledger = page.get_by_role("table", name="Market times")

        def late_pins():
            steady(page)
            state = pins(dial)
            for market in MARKETS:
                at = moment.astimezone(ZONE[market])
                pin = state[market]
                assert (pin["local"], pin["night"], pin["utc"]) == (f"{at:%H:%M}", "true" if is_night(at) else "false", instant(moment)), pin
                assert CITY[market] in pin["text"] and f"{at:%H:%M}" in pin["text"], pin
                assert prints_night(pin, is_night(at)), pin
        eventually(page, late_pins)
        for market in MARKETS:
            at = moment.astimezone(ZONE[market])
            expect(ledger.get_by_role("row").filter(has_text=CITY[market])).to_contain_text(f"{at:%H:%M}")
        fill(page.get_by_role("textbox", name="Drop date"), gap.isoformat())
        page.keyboard.press("Tab")
        dial_to(page, GAP_MIN)
        expect(page.get_by_text(f"Copenhagen skips from 02:00 to 03:00 on {day_text(gap)}. Choose another time.").first).to_be_visible()
        for save_time in page.get_by_role("button", name="Save time").all():
            expect(save_time).to_be_disabled()
        eventually(page, lambda: assertion_true(not dial.get_attribute("data-utc")))

        def gap_pins():
            state = pins(dial)
            assert set(state) == set(MARKETS)
            for pin in state.values():
                assert not pin["local"] and not pin["utc"] and "—" in pin["text"], pin
        eventually(page, gap_pins)
        fill(page.get_by_role("textbox", name="Drop date"), us_gap.isoformat())
        check(page.get_by_role("radiogroup", name="Drop type").get_by_role("radio", name="Rolling"))
        opens = local_min(us_gap, GAP_MIN, ZONE["new_york"])
        shifted = opens.astimezone(timezone.utc).astimezone(ZONE["new_york"])
        eventually(page, lambda: assertion_true(pins(dial)["new_york"]["utc"] == instant(opens)))
        state = pins(dial)
        assert state["new_york"]["local"] == f"{shifted:%H:%M}"
        assert state["copenhagen"]["local"] == f"{local_min(us_gap, GAP_MIN):%H:%M}"
        expect(page.get_by_text(f"{CITY['new_york']} skips an hour that night, so it opens at {shifted:%H:%M}.").first).to_be_visible()


SIMULTANEOUS_CASES = ["copenhagen_local", "utc_instant", "autumn_repeat", "spring_gap", "not_later", "fractional"]


@pytest.mark.parametrize("case", SIMULTANEOUS_CASES, ids=SIMULTANEOUS_CASES)
def test_simultaneous_go_live_rules(app_url, case):
    ida = staff(app_url, IDA)
    year = cph_today().year + 1
    ordinary = date(year, *ORDINARY_MONTH_DAY)
    autumn = last_sunday(year, 10)
    if case == "copenhagen_local":
        body, expected = {"copenhagenGoLive": wall(ordinary, 10, 0)}, local(ordinary, 10, 0)
    elif case == "utc_instant":
        moment = datetime(year, *ORDINARY_MONTH_DAY, 9, 0, tzinfo=timezone.utc)
        body, expected = {"goLiveAt": instant(moment)}, moment
    elif case == "autumn_repeat":
        body, expected = {"copenhagenGoLive": wall(autumn, *divmod(GAP_MIN, HOUR_MIN))}, local_min(autumn, GAP_MIN)
    elif case == "spring_gap":
        gap = last_sunday(year, 3)
        body, error = {"copenhagenGoLive": wall(gap, *divmod(GAP_MIN, HOUR_MIN))}, ("copenhagenGoLive", f"Copenhagen skips from 02:00 to 03:00 on {day_text(gap)}. Choose another time.")
    elif case == "not_later":
        body, error = {"goLiveAt": instant(now_utc() - timedelta(minutes=1))}, ("goLiveAt", "Choose a time later than now.")
    else:
        whole = instant(datetime(year, *ORDINARY_MONTH_DAY, 9, 0, tzinfo=timezone.utc))
        body, error = {"goLiveAt": whole[:-1] + FRACTION + "Z"}, ("goLiveAt", "Enter an instant like 2027-03-18T09:00:00Z.")
    request_body = drop_body(**{"goLiveAt": None, **body})
    r = ida.post("/api/drops", json=request_body)
    if case in ("copenhagen_local", "utc_instant", "autumn_repeat"):
        drop = ok(r, 201)
        assert drop["goLiveAt"] == instant(expected)
        assert drop["copenhagenGoLive"] == expected.astimezone(CPH).strftime("%Y-%m-%dT%H:%M")
        assert all(m["goLiveAt"] == instant(expected) for m in drop["markets"])
    else:
        payload = refused(r, 422, "validation_failed")
        assert payload["error"]["fields"][error[0]] == error[1]
        assert all(d["name"] != request_body["name"] for d in ok(ida.get("/api/drops"))["items"])


ROLLING_CASES = ["ordinary_day", "europe_gap", "us_gap"]


@pytest.mark.parametrize("case", ROLLING_CASES, ids=ROLLING_CASES)
def test_rolling_go_live_per_market(app_url, case):
    ida = staff(app_url, IDA)
    year = cph_today().year + 1
    day, minutes = {"ordinary_day": (date(year, *ORDINARY_MONTH_DAY), DEFAULT_MIN), "europe_gap": (last_sunday(year, 3), GAP_MIN),
                    "us_gap": (second_sunday_march(year), GAP_MIN)}[case]
    hh, mm = divmod(minutes, HOUR_MIN)
    drop = create_drop(ida, type="rolling", goLiveAt=None, localGoLive=wall(day, hh, mm))
    expected = {m: local_min(day, minutes, ZONE[m]).astimezone(timezone.utc) for m in MARKETS}
    for market in MARKETS:
        assert market_of(drop, market)["goLiveAt"] == instant(expected[market])
    assert drop["goLiveAt"] == instant(min(expected.values()))
    assert drop["localGoLive"] == wall(day, hh, mm) and drop["copenhagenGoLive"] is None
    if case == "europe_gap":
        assert market_of(drop, "copenhagen")["goLiveAt"] == instant(local_min(day, minutes + HOUR_MIN))
        assert market_of(drop, "london")["goLiveAt"] == market_of(drop, "copenhagen")["goLiveAt"]
    if case == "us_gap":
        assert market_of(drop, "new_york")["goLiveAt"] == instant(local_min(day, minutes + HOUR_MIN, ZONE["new_york"]))


def test_weekly_restock_series(app_url):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    year = cph_today().year + 1
    first = date(year, 3, 1)
    first += timedelta(days=(3 - first.weekday()) % 7)
    pieces = {m: (3 if m == "copenhagen" else 0) for m in MARKETS}
    series = ok(ida.post(f"/api/drops/{drop['id']}/restocks", json={"firstRestock": wall(first, RESTOCK_HOUR, 0), "pieces": pieces}), 201)
    expected = [instant(local(first + timedelta(weeks=k), RESTOCK_HOUR, 0)) for k in range(NEXT_RESTOCKS)]
    assert series["nextInstants"] == expected and series["copenhagenTime"] == "18:00"
    assert len({parse_instant(i).hour for i in expected}) == 2
    soon = (datetime.now(CPH) + timedelta(seconds=RESTOCK_LEAD_S)).replace(microsecond=0)
    before = staff_market(ida, drop["id"])["storePieces"]
    ok(ida.post(f"/api/drops/{drop['id']}/restocks", json={"firstRestock": soon.strftime("%Y-%m-%dT%H:%M:%S"), "pieces": pieces}), 201)
    lead = (soon - datetime.now(CPH)).total_seconds()
    wait_for(lambda: staff_market(ida, drop["id"])["storePieces"] == before + 3, lead + SWEEP_S + 5, "restock pieces")
    end = time.monotonic() + SWEEP_S
    while time.monotonic() < end:
        assert staff_market(ida, drop["id"])["storePieces"] == before + 3
        threading.Event().wait(POLL_S)


def test_new_drop_draft_survives_reload(browser, app_url):
    name = fresh_name()
    with signed_in(browser, app_url, IDA, "/studio/drops/new") as page:
        sees(page, page.get_by_text(step(1)))
        fill(page.get_by_role("textbox", name="Drop name"), name)
        fill(page.get_by_role("spinbutton", name="Hold length in seconds"), str(DRAFT_HOLD_S))
        fill(page.get_by_role("textbox", name="Internal note"), DRAFT_NOTE)
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(2)))
        fill(page.get_by_role("spinbutton", name=pieces_label("copenhagen")), "7")
        advance(page, DRAFT_SETTLE_MS)
        page.reload()
        sees(page, page.get_by_text(step(2)))
        sees_value(page, page.get_by_role("spinbutton", name=pieces_label("copenhagen")), "7")
        click(page.get_by_role("button", name="Back"))
        sees(page, page.get_by_text(step(1)))
        sees_value(page, page.get_by_role("textbox", name="Drop name"), name)
        sees_value(page, page.get_by_role("spinbutton", name="Hold length in seconds"), str(DRAFT_HOLD_S))
        sees_value(page, page.get_by_role("textbox", name="Internal note"), DRAFT_NOTE)
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(2)))
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(3)))
        click(page.get_by_role("button", name="Add style"))
        fill(page.get_by_role("textbox", name="Style number"), f"VR-{tag()}-1")
        fill(page.get_by_role("textbox", name="Style name"), "Harbour knit")
        fill(page.get_by_role("textbox", name="Colour"), "Sand")
        fill(page.get_by_role("spinbutton", name="Wholesale edition"), "80")
        advance(page, DRAFT_SETTLE_MS)
        page.reload()
        sees(page, page.get_by_text(step(3)))
        sees_value(page, page.get_by_role("textbox", name="Style name"), "Harbour knit")
        click(page.get_by_role("button", name="Next"))
        sees(page, page.get_by_text(step(4)))
        click(page.get_by_role("button", name="Create drop"))
        sees(page, heading(page, f"Plan {name}"))
        page.goto(f"{app_url}/studio/drops/new")
        sees(page, page.get_by_text(step(1)))
        advance(page, DRAFT_SETTLE_MS)
        expect(page.get_by_role("textbox", name="Drop name")).to_have_value("")
    drop = next(d for d in ok(staff(app_url, IDA).get("/api/drops"))["items"] if d["name"] == name)
    assert drop["holdSeconds"] == DRAFT_HOLD_S and drop["internalNote"] == DRAFT_NOTE and drop["status"] == "draft"
    assert market_of(drop)["storePieces"] == 7 and drop["styles"][0]["name"] == "Harbour knit"


def test_dial_motion_and_reduced_motion(browser, app_url):
    ida = staff(app_url, IDA)
    day = cph_today() + timedelta(days=FAR_DAYS)
    drop = create_drop(ida, status="draft", goLiveAt=None, copenhagenGoLive=wall(day, 10, 0))
    results = {}
    for mode in ("no-preference", "reduce"):
        with signed_in(browser, app_url, IDA, f"/studio/drops/{drop['id']}", reduced_motion=mode) as page:
            dial = page.get_by_role("group", name="Embargo dial")
            sees(page, dial)
            page.evaluate(RECORDER)
            page.get_by_role("slider", name="Drop time").focus()
            for _ in range(5):
                page.keyboard.press("PageUp")
            timer = page.get_by_role("timer", name="Countdown to go-live")
            if mode == "no-preference":
                eventually(page, lambda: assertion_true({STATE_MS, FEEDBACK_MS} <= {round(ms) for ms in recorded(dial)}
                                                        and recorded(timer, include_self=False)))
                eventually(page, lambda: assertion_true(any(round(f["ms"]) == FEEDBACK_MS for f in night_fades(dial))))
            else:
                advance(page, FRAME_SETTLE_MS)
                threading.Event().wait(1)
            dial_ms = recorded(dial)
            timer_ms = recorded(timer, include_self=False)
            dial_moves = slow_moves(records(dial) + records(timer, include_self=False))
            dial_fades = night_fades(dial)
            results[mode] = (dial.get_attribute("data-utc"), pins(dial)["tokyo"]["night"])
            page.set_viewport_size(PHONE)
            page.add_init_script(RECORDER_INIT)
            page.add_init_script(SHEET_RISE_INIT)
            page.reload()
            sheet = page.get_by_role("region", name="Markets")
            entrances = [sheet_entrance(page, sheet)]
            created = fresh_name()
            new_drop_to_review(page, app_url, created)
            click(page.get_by_role("button", name="Create drop"))
            sees(page, heading(page, f"Plan {created}"))
            entrances.append(sheet_entrance(page, sheet))
            sheet_entries = [entry for found, _ in entrances for entry in found]
            sheet_rises = [rise for _, found in entrances for rise in found]
            if mode == "no-preference":
                assert any(round(ms) == STATE_MS for ms in dial_ms), dial_ms
                assert any(round(ms) == FEEDBACK_MS for ms in dial_ms), dial_ms
                assert timer_ms and all(round(ms) == FEEDBACK_MS for ms in timer_ms if ms > 0), timer_ms
                assert any(round(rise["ms"]) == ENTRANCE_MS and rises_from_bottom(rise) for rise in sheet_rises), entrances
            else:
                sheet_moves = slow_moves(sheet_entries) + [rise for rise in sheet_rises
                                                           if rise["ms"] >= FEEDBACK_MS and rise["start"] > rise["end"] + 1]
                assert not dial_moves and not sheet_moves and not dial_fades, (dial_moves, sheet_moves, dial_fades)
    moved = local_min(day, DEFAULT_MIN + 5 * HOUR_MIN)
    tokyo_night = "true" if is_night(moved.astimezone(ZONE["tokyo"])) else "false"
    assert results["reduce"] == results["no-preference"] == (instant(moved), tokyo_night)


def test_go_live_offers_holds(app_url, mail):
    members = [unique("vip"), unique("vip"), unique("vip")]
    ida, drop = live_drop(app_url, 2, vip=members)
    subject = f"A piece of {drop['name']} is held for you"
    for _, email in members[:2]:
        message = inbox(mail, email, subject=subject)[0]
        assert "/claim/" in text(message)
        assert waitlist(ida, drop["id"], email)[0]["hold"]["status"] == "offered"
    third = members[2][1]
    assert waitlist(ida, drop["id"], third)[0]["hold"] is None
    market = market_of(ok(public(app_url, drop["slug"])))
    assert market["status"] == "live" and market["piecesLeft"] == 0
    for _, email in members[:2]:
        assert len(mails(mail, email, subject)) == 1
    assert mails(mail, third, subject) == []


def test_hold_expiry_passes_the_piece_on(app_url, mail):
    first, second = unique("vip"), unique("vip")
    ida, drop = live_drop(app_url, 1, hold=HOLD_S, vip=(first, second))
    subject = f"A piece of {drop['name']} is held for you"
    token = link_token(inbox(mail, first[1], subject=subject)[0], "/claim/")
    hold = ok(httpx.get(f"{app_url}/api/public/holds/{token}"))
    assert hold["status"] == "offered" and hold["market"] == "copenhagen"
    ends = parse_instant(hold["expiresAt"])
    assert ends - parse_instant(hold["offeredAt"]) == timedelta(seconds=HOLD_S)
    wait_for(lambda: datetime.now(timezone.utc) >= ends + timedelta(seconds=1), HOLD_S + 5, "hold expiry")
    body = refused(claim_hold(app_url, drop["slug"], token), 409, "hold_expired")
    assert body["error"]["message"] == f"This hold ended at {market_time(hold['expiresAt'])}. The piece has gone back to the drop."
    next_token = link_token(inbox(mail, second[1], subject=subject)[0], "/claim/")
    assert waitlist(ida, drop["id"], second[1])[0]["hold"]["status"] == "offered"
    claimed = ok(claim_hold(app_url, drop["slug"], next_token), 201)
    assert claimed["piecesLeft"] == 0
    assert len(mails(mail, first[1], subject)) == 1 and len(mails(mail, second[1], subject)) == 1


def test_claim_idempotency(app_url):
    ida, drop = live_drop(app_url, 5, swept=True)
    _, email = unique("claimer")
    key = idempotency_key()
    first = claim_open(app_url, drop["slug"], email, key=key)
    body = ok(first, 201)
    assert re.fullmatch(REFERENCE, body["claim"]["reference"]) and body["piecesLeft"] == 4
    replay = claim_open(app_url, drop["slug"], email, key=key)
    assert replay.status_code == 201 and replay.json() == body
    _, other = unique("claimer")
    refused(claim_open(app_url, drop["slug"], other, key=key), 409, "idempotency_key_reused")
    no_key = post_json(app_url, f"/api/public/drops/{drop['slug']}/claims", {"market": "copenhagen", "name": "Freja Dahl", "email": other})
    refused(no_key, 400, "idempotency_key_required")
    assert staff_market(ida, drop["id"])["claimed"] == 1
    assert market_of(ok(public(app_url, drop["slug"])))["piecesLeft"] == 4


def test_one_winner_for_the_last_piece(app_url):
    ida, drop = live_drop(app_url, 1, swept=True)
    shoppers = [unique("racer")[1] for _ in range(6)]
    gate = threading.Barrier(len(shoppers))

    def go(email):
        gate.wait()
        return claim_open(app_url, drop["slug"], email)
    with ThreadPoolExecutor(len(shoppers)) as pool:
        answers = list(pool.map(go, shoppers))
    winners = [a for a in answers if a.status_code == 201]
    losers = [a for a in answers if a.status_code != 201]
    assert len(winners) == 1, [a.status_code for a in answers]
    won_at = winners[0].json()["claim"]["claimedAt"]
    for loser in losers:
        body = refused(loser, 409, "sold_out")
        assert body["error"]["claimedAt"] == won_at
        assert body["error"]["message"] == f"Sorry — the last piece went to another shopper at {market_time(won_at)}."
    assert staff_market(ida, drop["id"])["claimed"] == 1
    assert market_of(ok(public(app_url, drop["slug"])))["piecesLeft"] == 0


def test_pieces_left_exact_across_copies(browser, app_url, mail):
    members = [unique("vip"), unique("vip")]
    ida, drop = live_drop(app_url, 6, vip=members)
    subject = f"A piece of {drop['name']} is held for you"
    token = link_token(inbox(mail, members[0][1], subject=subject)[0], "/claim/")
    inbox(mail, members[1][1], subject=subject)
    with app_copy() as copy:
        assert ok(claim_open(copy, drop["slug"], unique("open")[1]), 201)["piecesLeft"] == 3
        assert ok(claim_hold(app_url, drop["slug"], token), 201)["piecesLeft"] == 3
        assert ok(claim_open(app_url, drop["slug"], unique("open")[1]), 201)["piecesLeft"] == 2
        staff_view = staff_market(ida, drop["id"])
        assert staff_view["storePieces"] - staff_view["claimed"] - staff_view["held"] == 2 == staff_view["piecesLeft"]
        for base in (app_url, copy):
            assert market_of(ok(public(base, drop["slug"])))["piecesLeft"] == 2
    with open_app(browser, f"{app_url}/drops/{drop['slug']}") as page:
        row = page.get_by_role("table", name="Market availability").get_by_role("row").filter(has_text="Copenhagen")
        eventually(page, lambda: expect(row).to_contain_text("2", timeout=QUICK_MS))


def test_wf_go_live_claim_on_phone(browser, app_url, mail):
    member = unique("vip")
    ida, drop = live_drop(app_url, 2, vip=[member])
    token = link_token(inbox(mail, member[1], subject=f"A piece of {drop['name']} is held for you")[0], "/claim/")
    before = staff_market(ida, drop["id"])
    with open_app(browser, f"{app_url}/claim/{token}") as page:
        page.set_viewport_size(PHONE)
        recording(page, f"{app_url}/claim/{token}")
        sees(page, heading(page, "Your held piece"))
        timer = page.get_by_role("timer", name="Hold ends in")
        expect(timer).to_contain_text(re.compile(r"\d{2}:\d{2}:\d{2}"))
        page.evaluate(RECORDER)
        advance(page, TICK_MS)
        eventually(page, lambda: assertion_true(recorded(timer, include_self=False)))
        rolled = recorded(timer, include_self=False)
        assert all(round(ms) == FEEDBACK_MS for ms in rolled if ms > 0), rolled
        assert timer.evaluate("el => (window.__motion || []).every(m => m.target !== el)")
        claim = visible_one(page, page.get_by_role("button", name="Claim piece"))
        axe(page)
        assert in_viewport(claim.bounding_box(), PHONE)
        tap(claim)
        sees_text(page, status(page, "Claim status"), re.compile("^" + re.escape("Claimed. Your reference is ") + REFERENCE + r"\.$"))
        motion_kept(page)
    assert ok(httpx.get(f"{app_url}/api/public/holds/{token}"))["status"] == "claimed"
    whole_second_instants(ok(httpx.get(f"{app_url}/api/public/holds/{token}")))
    keyless = post_json(app_url, f"/api/public/drops/{LANTERN}/claims", {"market": "copenhagen", "name": "Freja Dahl", "email": unique("probe")[1]})
    refused(keyless, 410, "drop_withdrawn")
    after = staff_market(ida, drop["id"])
    assert after["claimed"] == before["claimed"] + 1 and after["held"] == before["held"] - 1


def test_wf_go_live_hold_expired_on_phone(browser, app_url, mail):
    member = unique("vip")
    ida, drop = live_drop(app_url, 1, hold=HOLD_S, vip=[member])
    token = link_token(inbox(mail, member[1], subject=f"A piece of {drop['name']} is held for you")[0], "/claim/")
    hold = ok(httpx.get(f"{app_url}/api/public/holds/{token}"))
    wait_for(lambda: datetime.now(timezone.utc) >= parse_instant(hold["expiresAt"]) + timedelta(seconds=1), HOLD_S + 5, "hold expiry")
    expired_copy = f"This hold ended at {market_time(hold['expiresAt'])}. The piece has gone back to the drop."
    with open_app(browser, f"{app_url}/claim/{token}") as page:
        page.set_viewport_size(PHONE)
        sees(page, heading(page, "Your held piece"))
        steady(page)
        claim = page.get_by_role("button", name="Claim piece")
        if claim.count() and claim.first.is_visible() and claim.first.is_enabled():
            tap(claim.first)
        eventually(page, lambda: expect(page.get_by_text(expired_copy).first).to_be_visible(timeout=QUICK_MS))
    assert staff_market(ida, drop["id"])["claimed"] == 0


def test_wf_allocations_request_and_split(browser, app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1, wholesaleEdition=10)])
    oster = seeded_stockist(jonas, "Øster Room")
    with signed_in(browser, app_url, LEA, "/studio/my-store") as page:
        row = page.get_by_role("table", name="Open drops").get_by_role("row").filter(has_text=drop["name"])
        sees(page, row)
        press(row.get_by_role("button", name="Request quantities"))
        dialog = page.get_by_role("dialog", name="Request quantities")
        fill(dialog.get_by_role("spinbutton", name=f"{sn} quantity"), "6")
        press(dialog.get_by_role("button", name="Send request"))
        sees_text(page, status(page, "Store status"), "Request saved.")
    second, third = new_stockist(jonas), new_stockist(jonas)
    ok(request(jonas, drop["id"], second["id"], [(sn, 4)]), 201)
    ok(request(jonas, drop["id"], third["id"], [(sn, 5)]), 201)
    with signed_in(browser, app_url, JONAS, f"/studio/drops/{drop['id']}/allocations", record=True) as page:
        sees(page, heading(page, f"Allocations · {drop['name']}"))
        press(page.get_by_role("button", name="Split edition"))
        dialog = page.get_by_role("dialog", name="Split edition")
        sees(page, dialog.get_by_role("table", name="Proposed split"))
        expect(dialog.get_by_role("table", name="Proposed split")).to_contain_text(second["name"])
        axe(page)
        press(dialog.get_by_role("button", name="Apply split"))
        sees_text(page, status(page, "Allocation status"), f"Split applied to {count_label(3, 'stockist')}.")
        sees_focus(page, heading(page, "Allocations", level=2))
        expect(page.get_by_role("table", name="Allocations").get_by_role("row").filter(has_text=second["name"])).to_contain_text(pos(4, 3))
        motion_kept(page)
    allocations = {a["stockistId"]: a for a in ok(jonas.get(f"/api/drops/{drop['id']}/allocations"))["items"]}
    shares = {sid: line_of(allocations[sid], sn)["allocatedQuantity"] for sid in (oster["id"], second["id"], third["id"])}
    assert shares == {oster["id"]: 4, second["id"]: 3, third["id"]: 3}
    assert {a["status"] for a in allocations.values()} == {"split"}
    whole_second_instants(ok(jonas.get(f"/api/drops/{drop['id']}/allocations")))
    any_alloc = allocations[second["id"]]["id"]
    refused(staff(app_url, SOFIE).patch(f"/api/allocations/{any_alloc}", content="{", headers={"Content-Type": "application/json"}), 403, "forbidden")


def test_largest_remainder_split(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    a, b, c = f"VR-{t}-1", f"VR-{t}-2", f"VR-{t}-3"
    drop = create_drop(ida, styles=[style(t, 1, wholesaleEdition=10), style(t, 2, wholesaleEdition=7), style(t, 3, wholesaleEdition=50)])
    stores = [new_stockist(jonas) for _ in range(3)]
    for store, quantities in zip(stores, ((5, 2, 10), (5, 4, 10), (5, 4, 10))):
        ok(request(jonas, drop["id"], store["id"], list(zip((a, b, c), quantities))), 201)
    expected = {a: [4, 3, 3], b: [1, 3, 3], c: [10, 10, 10]}
    proposal = {i["stockistId"]: i for i in ok(jonas.get(f"/api/drops/{drop['id']}/split"))["items"]}
    for sn, shares in expected.items():
        assert [line_of(proposal[s["id"]], sn)["allocatedQuantity"] for s in stores] == shares
    applied = {i["stockistId"]: i for i in ok(jonas.post(f"/api/drops/{drop['id']}/split"))["items"]}
    for sn, shares in expected.items():
        assert [line_of(applied[s["id"]], sn)["allocatedQuantity"] for s in stores] == shares
    assert sum(expected[a]) == 10 and sum(expected[b]) == 7
    assert {i["status"] for i in applied.values()} == {"split"}
    refused(request(jonas, drop["id"], stores[0]["id"], [(a, 9)]), 409, "allocation_split")


def test_stockist_buyer_sees_only_their_store(app_url):
    ida, jonas, lea = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, LEA)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    oster, lune = seeded_stockist(jonas, "Øster Room"), seeded_stockist(jonas, "Atelier Lune")
    ok(request(jonas, drop["id"], oster["id"], [(sn, 10)]), 201)
    theirs = ok(request(jonas, drop["id"], lune["id"], [(sn, 8)]), 201)
    stores = ok(lea.get("/api/stockists"))["items"]
    assert [s["id"] for s in stores] == [oster["id"]]
    assert set(stores[0]) == {"id", "name", "market", "city", "currency"}
    ghost = unknown_like(lune["id"])
    other, missing = lea.get(f"/api/stockists/{lune['id']}"), lea.get(f"/api/stockists/{ghost}")
    refused(other, 404, "not_found")
    assert other.content == missing.content
    mine = ok(lea.get(f"/api/drops/{drop['id']}/allocations"))["items"]
    assert len(mine) == 1 and mine[0]["stockistName"] == "Øster Room"
    assert set(mine[0]) == {"id", "dropName", "stockistName", "status", "currency", "lines", "totalMinor", "priceListEffectiveDate", "invoiceNumber", "confirmedAt"}
    assert set(mine[0]["lines"][0]) == {"styleNumber", "styleName", "requestedQuantity", "allocatedQuantity", "unitPriceMinor", "netMinor", "vatMinor", "lineTotalMinor"}
    other_alloc, missing_alloc = lea.get(f"/api/allocations/{theirs['id']}"), lea.get(f"/api/allocations/{unknown_like(theirs['id'])}")
    refused(other_alloc, 404, "not_found")
    assert other_alloc.content == missing_alloc.content
    assert lea.get(f"/api/allocations/{theirs['id']}/line-sheet.csv").status_code == 404
    assert lea.get(f"/api/allocations/{mine[0]['id']}/line-sheet.csv").status_code == 200
    buyer_drop = ok(lea.get(f"/api/drops/{drop['id']}"))
    assert set(buyer_drop) == {"id", "name", "status", "styles"} and set(buyer_drop["styles"][0]) == {"styleNumber", "name", "colour"}
    refused(request(lea, drop["id"], lune["id"], [(sn, 9)]), 404, "not_found")
    assert line_of(ok(jonas.get(f"/api/allocations/{theirs['id']}")), sn)["requestedQuantity"] == 8


def test_wf_allocations_stale_edit(browser, app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    alloc = allocation(jonas, drop["id"], new_stockist(jonas)["id"], [(sn, 2)])
    with signed_in(browser, app_url, JONAS, f"/studio/allocations/{alloc['id']}") as page:
        spin = page.get_by_role("spinbutton", name=f"{sn} allocated")
        sees(page, spin)
        newer = ok(jonas.patch(f"/api/allocations/{alloc['id']}", json={"version": alloc["version"], "lines": [{"styleNumber": sn, "quantity": 5}], "internalNote": "Window order"}))
        stale = refused(jonas.patch(f"/api/allocations/{alloc['id']}", json={"version": alloc["version"], "lines": [{"styleNumber": sn, "quantity": 9}], "internalNote": "x"}), 412, "stale_version")
        assert stale["error"]["savedBy"] == "Jonas Berg" and stale["error"]["savedAt"] == newer["savedAt"]
        assert line_of(stale["error"]["current"], sn)["allocatedQuantity"] == 5
        fill(spin, "9")
        click(page.get_by_role("button", name="Save allocation"))
        sees_text(page, status(page, "Allocation status"), f"Not saved: Jonas Berg saved a newer version at {market_time(newer['savedAt'])}. Showing their version.")
        eventually(page, lambda: expect(spin).to_have_value("5", timeout=QUICK_MS))
    current = ok(jonas.get(f"/api/allocations/{alloc['id']}"))
    assert line_of(current, sn)["allocatedQuantity"] == 5 and current["version"] == newer["version"]


def test_wf_wholesale_invoicing_confirm(browser, app_url, killbill, mail):
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    store = new_stockist(jonas)
    price_list(sofie, [(sn, "DKK", 123450)])
    alloc = allocation(jonas, drop["id"], store["id"], [(sn, 2)])
    refused(jonas.post(f"/api/allocations/{alloc['id']}/confirm", content="{}", headers={"Content-Type": WRONG_TYPE}), 403, "forbidden")
    with signed_in(browser, app_url, SOFIE, f"/studio/allocations/{alloc['id']}", record=True) as page:
        title = heading(page, f"Allocation · {store['name']}")
        sees(page, title)
        press(page.get_by_role("button", name="Confirm allocation"))
        dialog = page.get_by_role("dialog", name="Confirm allocation")
        sees(page, dialog.get_by_role("table", name="Quote"))
        axe(page)
        expect(dialog.get_by_text(f"Prices from the list in force on {day_text(cph_today())}").first).to_be_visible()
        press(dialog.get_by_role("button", name="Confirm and invoice"))
        announced = status(page, "Invoicing status")
        sees_text(page, announced, re.compile("^" + re.escape("Allocation confirmed. Invoice ") + r"\S+"
                                              + re.escape(" created; the confirmation email is on its way.") + "$"))
        number = re.search(re.escape("Invoice ") + r"(\S+)" + re.escape(" created"), announced.inner_text()).group(1)
        sees_focus(page, title)
        expect(page.get_by_role("table", name="Allocation lines")).to_contain_text(money(123450, "DKK"))
        motion_kept(page)
    confirmed = ok(sofie.get(f"/api/allocations/{alloc['id']}"))
    assert confirmed["status"] == "confirmed" and confirmed["invoiceNumber"] == number and confirmed["killbillInvoiceId"]
    assert line_of(confirmed, sn)["allocatedQuantity"] == 2
    net, vat, total = priced(123450, 2, True)
    assert (priced_line := (priced_row := priced_line_of(confirmed, sn))) == (123450, net, vat, total), priced_row
    account = killbill.account_by_key(f"hourline-{store['id']}")
    assert account and account["currency"] == "DKK" and account["name"] == store["name"]
    whole_second_instants(confirmed)
    invoice = killbill.client.get(f"/invoices/{confirmed['killbillInvoiceId']}").json()
    assert invoice["accountId"] == account["accountId"] and invoice["status"].lower() == "committed"
    charges = [item for item in invoice["items"] if item.get("itemType") == "EXTERNAL_CHARGE"]
    assert len(charges) == 1 and abs(charges[0]["amount"] - total / 100) < 0.005, charges
    assert charges[0]["description"] == f"{sn} Harbour wool coat × 2"
    message = inbox(mail, store["contactEmail"], subject=f"Allocation confirmed: {drop['name']} for {store['name']}")
    body = text(message[0])
    assert number in body and money(total, "DKK") in body and f"Prices from the list in force on {day_text(cph_today())}" in body
    assert len(mails(mail, store["contactEmail"])) == 1


def priced_line_of(alloc, style_number):
    entry = line_of(alloc, style_number)
    return entry["unitPriceMinor"], entry["netMinor"], entry["vatMinor"], entry["lineTotalMinor"]


def test_wf_wholesale_invoicing_outage(browser, app_url, killbill, mail):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    store = new_stockist(jonas)
    price_list(sofie, [(sn, "DKK", 123450)])
    alloc = allocation(jonas, drop["id"], store["id"], [(sn, 1)])
    with signed_in(browser, down, SOFIE, f"/studio/allocations/{alloc['id']}") as page:
        press(page.get_by_role("button", name="Confirm allocation"))
        dialog = page.get_by_role("dialog", name="Confirm allocation")
        press(dialog.get_by_role("button", name="Confirm and invoice"))
        sees_text(page, status(page, "Invoicing status"), "Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly.")
        expect(dialog).to_be_visible()
    after = ok(sofie.get(f"/api/allocations/{alloc['id']}"))
    assert after["status"] == "split" and after["version"] == alloc["version"] and after["invoiceNumber"] is None
    assert killbill.account_by_key(f"hourline-{store['id']}") is None
    assert mails(mail, store["contactEmail"]) == []


def test_price_list_in_force(app_url, mail):
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    early_store, late_store = new_stockist(jonas, market="london"), new_stockist(jonas, market="london")
    price_list(sofie, [(sn, "GBP", PRICE_EARLY)])
    early = ok(confirm(sofie, allocation(jonas, drop["id"], early_store["id"], [(sn, 2)])))
    assert line_of(early, sn)["unitPriceMinor"] == PRICE_EARLY and early["priceListEffectiveDate"] == cph_today().isoformat()
    price_list(sofie, [(sn, "GBP", PRICE_NOW)])
    price_list(sofie, [(sn, "GBP", PRICE_TOMORROW)], effective=cph_today() + timedelta(days=1))
    past = sofie.post("/api/price-lists", json={"name": fresh_name(), "effectiveDate": (cph_today() - timedelta(days=1)).isoformat(), "prices": [{"styleNumber": sn, "currency": "GBP", "unitPriceMinor": 1}]})
    assert refused(past, 422, "validation_failed")["error"]["fields"]["effectiveDate"] == "Choose today or a later date."
    late = allocation(jonas, drop["id"], late_store["id"], [(sn, 2)])
    assert line_of(ok(sofie.get(f"/api/allocations/{late['id']}/quote")), sn)["unitPriceMinor"] == PRICE_NOW
    late = ok(confirm(sofie, late))
    assert line_of(late, sn)["unitPriceMinor"] == PRICE_NOW and late["totalMinor"] == PRICE_NOW * 2
    kept = ok(sofie.get(f"/api/allocations/{early['id']}"))
    assert line_of(kept, sn)["unitPriceMinor"] == PRICE_EARLY and kept["totalMinor"] == PRICE_EARLY * 2
    assert kept["invoiceNumber"] == early["invoiceNumber"]
    sheet = sofie.get(f"/api/allocations/{early['id']}/line-sheet.csv")
    assert sheet.text.splitlines()[0] == "Style number,Name,Quantity,Unit price (minor units),Net (minor units),VAT (minor units),Line total (minor units),Currency,Price list from"
    row = next(r for r in csv_rows(sheet.content) if r["Style number"] == sn)
    assert (row["Unit price (minor units)"], row["Line total (minor units)"], row["Currency"]) == (str(PRICE_EARLY), str(PRICE_EARLY * 2), "GBP")
    body = text(inbox(mail, early_store["contactEmail"])[0])
    assert money(PRICE_EARLY, "GBP") in body and money(PRICE_EARLY * 2, "GBP") in body


def test_exact_money_and_danish_vat(app_url, mail):
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    a, b = f"VR-{t}-1", f"VR-{t}-2"
    drop = create_drop(ida, styles=[style(t, 1), style(t, 2)])
    price_list(sofie, [(a, "DKK", DKK_A), (b, "DKK", DKK_B), (a, "JPY", JPY_A)])
    danish, tokyo = new_stockist(jonas), new_stockist(jonas, market="tokyo")
    dk = ok(confirm(sofie, allocation(jonas, drop["id"], danish["id"], [(a, 1), (b, 1)])))
    first, second = line_of(dk, a), line_of(dk, b)
    expect_a, expect_b = priced(DKK_A, 1, True), priced(DKK_B, 1, True)
    assert (first["netMinor"], first["vatMinor"], first["lineTotalMinor"]) == expect_a
    assert first["vatMinor"] * 100 - DKK_A * VAT_PERCENT == 50
    assert (second["netMinor"], second["vatMinor"], second["lineTotalMinor"]) == expect_b
    dk_total = expect_a[2] + expect_b[2]
    assert dk["totalMinor"] == dk_total and dk["currency"] == "DKK"
    assert dk_total != DKK_A + DKK_B + vat_minor(DKK_A + DKK_B)
    jp = ok(confirm(sofie, allocation(jonas, drop["id"], tokyo["id"], [(a, 3), (b, 0)])))
    yen = line_of(jp, a)
    expect_yen = priced(JPY_A, 3, False)
    assert jp["currency"] == "JPY" and (yen["netMinor"], yen["vatMinor"], yen["lineTotalMinor"]) == expect_yen
    assert line_of(jp, b)["unitPriceMinor"] is None and jp["totalMinor"] == expect_yen[2]
    for value in (first["netMinor"], first["vatMinor"], dk["totalMinor"], yen["netMinor"]):
        assert isinstance(value, int) and not isinstance(value, bool)
    dk_mail = text(inbox(mail, danish["contactEmail"])[0])
    assert money(expect_a[2], "DKK") in dk_mail and money(expect_a[1], "DKK") in dk_mail and money(dk_total, "DKK") in dk_mail
    assert money(expect_yen[2], "JPY") in text(inbox(mail, tokyo["contactEmail"])[0])


def test_confirmation_all_or_nothing(app_url, killbill, mail):
    down = os.environ["APP_KILLBILL_DOWN_URL"]
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    store = new_stockist(jonas)
    price_list(sofie, [(sn, "DKK", 99900)])
    alloc = allocation(jonas, drop["id"], store["id"], [(sn, 1)])
    body = refused(confirm(staff(down, SOFIE), alloc), 503, "billing_unavailable")
    assert body["error"]["message"] == "Invoicing is unavailable right now. Nothing was confirmed, invoiced or emailed. Try again shortly."
    unchanged = ok(sofie.get(f"/api/allocations/{alloc['id']}"))
    assert unchanged["status"] == "split" and unchanged["version"] == alloc["version"] and unchanged["killbillInvoiceId"] is None
    assert killbill.account_by_key(f"hourline-{store['id']}") is None
    assert mails(mail, store["contactEmail"]) == []
    done = ok(confirm(sofie, unchanged))
    assert done["status"] == "confirmed" and done["killbillInvoiceId"] and done["invoiceNumber"]
    assert killbill.account_by_key(f"hourline-{store['id']}")["currency"] == "DKK"
    assert len(inbox(mail, store["contactEmail"])) == 1


def test_confirm_once(browser, app_url, killbill, mail):
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    price_list(sofie, [(sn, "DKK", 99900)])
    store, clicked_store = new_stockist(jonas), new_stockist(jonas)
    alloc = allocation(jonas, drop["id"], store["id"], [(sn, 1)])
    clients = [staff(app_url, SOFIE) for _ in range(4)]
    gate = threading.Barrier(len(clients))

    def go(c):
        gate.wait()
        return confirm(c, alloc)
    with ThreadPoolExecutor(len(clients)) as pool:
        answers = list(pool.map(go, clients))
    assert [a.status_code for a in answers].count(200) == 1, [a.status_code for a in answers]
    assert all(a.status_code in (409, 412) for a in answers if a.status_code != 200)
    inbox(mail, store["contactEmail"])
    assert len(mails(mail, store["contactEmail"])) == 1
    target = allocation(jonas, drop["id"], clicked_store["id"], [(sn, 1)])
    sent = []
    with signed_in(browser, app_url, SOFIE, f"/studio/allocations/{target['id']}") as page:
        page.on("request", lambda r: sent.append(r.url) if r.method == "POST" and r.url.endswith(f"/api/allocations/{target['id']}/confirm") else None)
        click(page.get_by_role("button", name="Confirm allocation"))
        button = page.get_by_role("dialog", name="Confirm allocation").get_by_role(
            "button", name=re.compile(r"Confirm and invoice|Confirming…"))
        with held(page, f"**/api/allocations/{target['id']}/confirm") as gate_ui:
            button.dblclick()
            expect(button).to_be_disabled()
            gate_ui.release()
        eventually(page, lambda: expect(status(page, "Invoicing status")).to_contain_text("Allocation confirmed.", timeout=QUICK_MS))
    assert len(sent) == 1
    assert ok(sofie.get(f"/api/allocations/{target['id']}"))["status"] == "confirmed"
    inbox(mail, clicked_store["contactEmail"])
    assert len(mails(mail, clicked_store["contactEmail"])) == 1
    assert killbill.account_by_key(f"hourline-{clicked_store['id']}") is not None


def test_line_sheet_export(app_url):
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    a, b, c = f"VR-{t}-1", f"VR-{t}-2", f"VR-{t}-3"
    f1, f2, f3, f4, f5 = FORMULA_CELLS
    drop = create_drop(ida, styles=[style(t, 1, name=f1, colour=f2), style(t, 2, name=f3, colour=f4), style(t, 3, name=COMMA_CELL, colour=f5)])
    price_list(sofie, [(a, "DKK", 129900), (a, "EUR", 16550), (b, "DKK", 64900)])
    r = jonas.get(f"/api/drops/{drop['id']}/line-sheet.csv", params={"currency": "DKK"})
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    raw = r.content
    assert not raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw and re.search(rb"(?<!\r)\n", raw) is None
    assert raw.split(b"\r\n")[0].decode() == "Style number,Name,Colour,Wholesale edition,RRP DKK (minor units),Wholesale price (minor units),Currency,Price list from"
    rows = {row["Style number"]: row for row in csv_rows(raw)}
    stored = {s["styleNumber"]: s for s in drop["styles"]}
    cell = lambda v: f"'{v}" if v[:1] in ("=", "+", "-", "@", "\t", "\r") else v
    for sn in (a, b, c):
        assert (rows[sn]["Name"], rows[sn]["Colour"]) == (cell(stored[sn]["name"]), cell(stored[sn]["colour"])), rows[sn]
    assert rows[a]["Name"] == f"'{f1}" and rows[c]["Name"] == COMMA_CELL
    assert (rows[a]["Wholesale price (minor units)"], rows[a]["Currency"], rows[a]["Price list from"]) == ("129900", "DKK", cph_today().isoformat())
    assert rows[a]["RRP DKK (minor units)"] == "279900" and rows[a]["Wholesale edition"] == "120"
    assert rows[c]["Wholesale price (minor units)"] == ""
    eur = {row["Style number"]: row for row in csv_rows(jonas.get(f"/api/drops/{drop['id']}/line-sheet.csv", params={"currency": "EUR"}).content)}
    assert eur[a]["Wholesale price (minor units)"] == "16550" and eur[b]["Wholesale price (minor units)"] == ""


def test_wf_line_sheets_export_link(browser, app_url):
    ida, sofie = staff(app_url, IDA), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    price_list(sofie, [(sn, "DKK", 129900), (sn, "EUR", 16550)])
    with signed_in(browser, app_url, JONAS, f"/studio/drops/{drop['id']}/line-sheet") as page:
        sees(page, heading(page, f"Line sheet · {drop['name']}"))
        expect(page.get_by_role("table", name="Line sheet")).to_contain_text(sn)
        select(page.get_by_role("combobox", name="Export currency"), "EUR")
        with page.expect_download() as download:
            click(page.get_by_role("link", name="Export CSV"))
            advance(page, DOWNLOAD_PUMP_MS)
        rows = csv_rows(Path(download.value.path()).read_bytes())
    row = next(r for r in rows if r["Style number"] == sn)
    assert (row["Wholesale price (minor units)"], row["Currency"]) == ("16550", "EUR")


LEGACY_ROWS = ["Style no;Name;Colour;Edition;RRP DKK", "{a};Harbour wool coat;Ink;120;2.799,00", " {b_lower} ;Harbour knit;Sand;80;1.499,50", "{b};Harbour knit;Sand;90;1.499,50", "{orphan};Pier scarf;Rust;40;499,00"]


def legacy_file(a, b, orphan):
    lines = [row.format(a=a, b=b, b_lower=b.lower(), orphan=orphan) for row in LEGACY_ROWS]
    return b"\xef\xbb\xbf" + "\n".join(lines).encode() + b"\n"


def import_sheet(c, drop_id, data, ctype="text/csv"):
    return c.post(f"/api/drops/{drop_id}/line-sheet/import", files={"file": ("legacy.csv", data, ctype)})


def test_legacy_line_sheet_import(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    a, b = f"VR-{t}-1", f"VR-{t}-2"
    orphan = f"VR-{t}-9"
    drop = create_drop(ida, styles=[style(t, 1), style(t, 2, name="Harbour knit", colour="Sand", wholesaleEdition=80, rrpDkkMinor=149950)])
    data = legacy_file(a, b, orphan)
    report = ok(import_sheet(jonas, drop["id"], data))
    assert (report["rows"], report["matched"], report["updated"], report["unchanged"]) == (4, 2, 1, 1)
    assert [(m["styleNumber"].lower(), m["lines"]) for m in report["merged"]] == [(b.lower(), [3, 4])]
    assert [(o["line"], o["styleNumber"].strip()) for o in report["orphans"]] == [(5, orphan)]
    assert report["invalid"] == []
    styles = {s["styleNumber"]: s for s in ok(jonas.get(f"/api/drops/{drop['id']}"))["styles"]}
    assert styles[b]["wholesaleEdition"] == 90 and styles[b]["rrpDkkMinor"] == 149950
    assert styles[a]["rrpDkkMinor"] == 279900 and orphan not in styles and len(styles) == 2
    again = ok(import_sheet(jonas, drop["id"], data))
    assert (again["matched"], again["updated"], again["unchanged"]) == (2, 0, 2)
    assert {s["styleNumber"]: s for s in ok(jonas.get(f"/api/drops/{drop['id']}"))["styles"]} == styles


def test_import_limits_and_methods(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    drop = create_drop(ida, styles=[style(t, 1)])
    head = (LEGACY_ROWS[0] + "\n").encode()
    row_start, row_end = f"{t};".encode(), SIZED_ROW_END

    def sized(total):
        return head + row_start + b"a" * (total - len(head) - len(row_start) - len(row_end)) + row_end
    assert ok(import_sheet(jonas, drop["id"], sized(LINE_SHEET_LIMIT)))["rows"] == 1
    body = refused(import_sheet(jonas, drop["id"], sized(LINE_SHEET_LIMIT + 1)), 413, "too_large")
    assert body["error"]["message"] == "The file is larger than 1,000,000 bytes. Nothing was imported."
    path = f"/api/drops/{drop['id']}/line-sheet/import"
    refused(jonas.post(path, json={"file": "x"}), 415, "unsupported_media_type")
    for method in ("GET", "PUT", "DELETE", "PATCH"):
        r = jonas.request(method, path)
        refused(r, 405, "method_not_allowed")
        assert "POST" in r.headers["Allow"]
    assert ok(jonas.get(f"/api/drops/{drop['id']}"))["styles"] == drop["styles"]


def test_wf_line_sheets_import_dialog(browser, app_url):
    ida = staff(app_url, IDA)
    t = tag()
    a, b = f"VR-{t}-1", f"VR-{t}-2"
    drop = create_drop(ida, styles=[style(t, 1), style(t, 2, name="Harbour knit", colour="Sand", wholesaleEdition=80, rrpDkkMinor=149950)])
    with signed_in(browser, app_url, JONAS, f"/studio/drops/{drop['id']}/line-sheet", viewport=PHONE, record=True) as page:
        sees(page, heading(page, f"Line sheet · {drop['name']}"))
        press(page.get_by_role("button", name="Import line sheet"))
        dialog = page.get_by_role("dialog", name="Import line sheet")
        attach(dialog, "Line sheet file", {"name": "legacy.csv", "mimeType": "text/csv", "buffer": legacy_file(a, b, f"VR-{t}-9")})
        axe(page)
        press(dialog.get_by_role("button", name="Import"))
        matched, updated, unchanged = 2, 1, 1
        sees_text(page, status(page, "Line sheet status"),
                  f"Import finished: {matched} matched, {updated} updated, {unchanged} unchanged, {count_label(1, 'orphan row')}.")
        sees_focus(page, heading(page, "Import report", level=2))
        report = page.get_by_role("table", name="Import report")
        expect(report.get_by_role("row").filter(has_text="Orphan")).to_contain_text("5")
        expect(report.get_by_role("row").filter(has_text="Merged")).not_to_have_count(0)
        layout(page)
        line_header = report.get_by_role("columnheader", name="Line")
        before = line_header.bounding_box()["x"]
        report.evaluate("t => { let p = t; while (p && p.scrollWidth <= p.clientWidth) p = p.parentElement; if (p) p.scrollLeft = p.scrollWidth; }")
        assert abs(line_header.bounding_box()["x"] - before) <= 1
        layout(page)
        motion_kept(page)
    styles = {s["styleNumber"]: s for s in ok(ida.get(f"/api/drops/{drop['id']}"))["styles"]}
    assert styles[b]["wholesaleEdition"] == 90
    whole_second_instants(ok(ida.get(f"/api/drops/{drop['id']}")))
    refused(httpx.post(f"{app_url}/api/drops/{drop['id']}/line-sheet/import", json={"file": "x"}), 401, "unauthenticated")


def test_safe_look_uploads(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    drop = create_drop(ida)
    s3 = S3()
    look = ok(upload_look(jonas, drop["id"], jpeg(10, 6, exif_gps(6))), 201)["look"]
    assert (look["width"], look["height"]) == (6, 10)
    keys = [k for k in s3.keys(f"looks/{drop['id']}/") if look["id"] in k]
    assert len(keys) == 1 and keys[0].rsplit(".", 1)[-1] in ("jpg", "png", "webp")
    stored = s3.get(keys[0])
    assert EXIF_MARK not in stored and dims(stored) == (6, 10)
    for data, name, ctype in ((SVG_SCRIPT, *PNG_PART), (HTML_RENAMED, *JPEG_PART)):
        body = refused(upload_look(jonas, drop["id"], data, name=name, ctype=ctype), 422, "validation_failed")
        assert body["error"]["fields"]["file"] == "Use a JPEG, PNG or WebP photo."
    long_alt = refused(upload_png(jonas, drop["id"], png(8, 8), alt="a" * (ALT_MAX + 1)), 422, "validation_failed")
    assert long_alt["error"]["fields"]["altText"] == f"Use at most {ALT_MAX} characters."
    long_title = refused(upload_png(jonas, drop["id"], png(8, 8), title="t" * (TITLE_MAX + 1)), 422, "validation_failed")
    assert long_title["error"]["fields"]["title"] == f"Use at most {TITLE_MAX} characters."
    ok(upload_png(jonas, drop["id"], png(8, 8), alt=FAMILY * ALT_MAX), 201)
    big = refused(upload_look(jonas, drop["id"], b"\x00" * (LOOK_LIMIT + 1), *JPEG_PART), 413, "too_large")
    assert big["error"]["message"] == "The photo is larger than 8,000,000 bytes. Nothing was uploaded."
    count, objects = len(ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"]), set(s3.keys(f"looks/{drop['id']}/"))
    down = staff(os.environ["APP_MINIO_DOWN_URL"], JONAS)
    refused(upload_png(down, drop["id"], png(8, 8)), 503, "storage_unavailable")
    assert len(ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"]) == count == 2
    assert set(s3.keys(f"looks/{drop['id']}/")) == objects


def test_look_reorder_and_stale(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    drop = create_drop(ida)
    ids = [ok(upload_png(jonas, drop["id"], png(8, 8), title=fresh_name()), 201)["look"]["id"] for _ in range(3)]
    listing = ok(jonas.get(f"/api/drops/{drop['id']}/looks"))
    assert [l["id"] for l in listing["items"]] == ids
    reordered = ok(jonas.put(f"/api/drops/{drop['id']}/looks/order", json={"orderVersion": listing["orderVersion"], "lookIds": ids[::-1]}))
    assert [l["id"] for l in reordered["items"]] == ids[::-1] and [l["position"] for l in reordered["items"]] == [1, 2, 3]
    assert reordered["orderVersion"] > listing["orderVersion"] and reordered["savedBy"] == "Jonas Berg"
    stale = refused(jonas.put(f"/api/drops/{drop['id']}/looks/order", json={"orderVersion": listing["orderVersion"], "lookIds": ids}), 412, "stale_version")
    assert [l["id"] for l in stale["error"]["current"]["items"]] == ids[::-1] and stale["error"]["savedBy"] == "Jonas Berg"
    refused(jonas.put(f"/api/drops/{drop['id']}/looks/order", json={"orderVersion": reordered["orderVersion"], "lookIds": ids[:2]}), 422, "validation_failed")
    assert [l["id"] for l in ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"]] == ids[::-1]


def test_wf_lookbook_upload_and_reorder(browser, app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    drop = create_drop(ida)
    earlier = [fresh_name() for _ in range(2)]
    for earlier_title in earlier:
        ok(upload_png(jonas, drop["id"], png(8, 8), title=earlier_title), 201)
    title = fresh_name()
    with signed_in(browser, app_url, JONAS, f"/studio/drops/{drop['id']}/lookbook", record=True) as page:
        press(page.get_by_role("button", name="Add look"))
        dialog = page.get_by_role("dialog", name="Add look")
        attach(dialog, "Look image", {"name": PNG_PART[0], "mimeType": PNG_PART[1], "buffer": png(8, 10)})
        axe(page)
        fill(dialog.get_by_role("textbox", name="Look title"), title)
        fill(dialog.get_by_role("textbox", name="Alt text"), LOOK_ALT)
        press(dialog.get_by_role("button", name="Upload look"))
        sees_text(page, status(page, "Lookbook status"), "Look added.")
        looks = page.get_by_role("list", name="Looks")
        card = looks.get_by_role("listitem").filter(has_text=title)
        expect(card.get_by_role("img", name=LOOK_ALT)).to_be_visible()
        expect(card).to_contain_text(pos(3, 3))
        move = card.get_by_role("button", name="Move")
        lookbook = status(page, "Lookbook status")
        move.focus()
        page.keyboard.press("Space")
        sees_text(page, lookbook, f"Picked up {title}. Position {pos(3, 3)}.")
        page.keyboard.press("ArrowUp")
        sees_text(page, lookbook, f"{title} moved to position {pos(2, 3)}.")
        page.keyboard.press("ArrowLeft")
        sees_text(page, lookbook, f"{title} moved to position {pos(1, 3)}.")
        page.keyboard.press("Space")
        dropped = {f"{title} dropped at position {pos(1, 3)}.", "Look order saved."}
        eventually(page, lambda: assertion_true(lookbook.inner_text().strip() in dropped))
        wait_for(lambda: ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"][0]["title"] == title, WAIT_S, "saved order")
        page.reload()
        sees(page, looks.get_by_role("listitem").first.filter(has_text=title))
        page.get_by_role("list", name="Looks").get_by_role("listitem").filter(has_text=earlier[0]).get_by_role("button", name="Move").focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Escape")
        sees_text(page, lookbook, f"Move cancelled. {earlier[0]} is back at position {pos(2, 3)}.")
        motion_kept(page)
    assert [l["title"] for l in ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"]][0] == title
    whole_second_instants(ok(jonas.get(f"/api/drops/{drop['id']}/looks")))
    unsigned = httpx.post(f"{app_url}/api/drops/{drop['id']}/looks", files={"file": (PNG_PART[0], b"\x00" * (LOOK_LIMIT + 1), PNG_PART[1])},
                          data={"title": "Harbour look", "altText": LOOK_ALT}, timeout=HTTP_TIMEOUT_S)
    refused(unsigned, 401, "unauthenticated")


def test_wf_lookbook_phone(browser, app_url):
    with open_app(browser, f"{app_url}/drops/{HARBOUR}") as page:
        page.set_viewport_size(PHONE)
        carousel = page.get_by_role("region", name="Look carousel")
        counter = carousel.get_by_role("status", name="Look position")
        sees_text(page, counter, pos(1, 3))
        for n in (2, 3):
            tap(carousel.get_by_role("button", name="Next look"))
            sees_text(page, counter, pos(n, 3))
        last = carousel.get_by_role("button", name="Next look")
        if last.count() and last.is_visible() and last.is_enabled():
            tap(last)
            advance(page, 2 * STEP_MS)
        expect(counter).to_have_text(pos(3, 3), timeout=QUICK_MS)
        tap(carousel.get_by_role("button", name="Previous look"))
        sees_text(page, counter, pos(2, 3))
        carousel.evaluate(TO_CENTRE)
        box = carousel.bounding_box()
        y = box["y"] + box["height"] / 2
        right, left = (box["x"] + box["width"] * 0.8, y), (box["x"] + box["width"] * 0.2, y)
        Touch(page).swipe(right, left)
        one_look = re.compile(rf"^\s*({re.escape(pos(1, 3))}|{re.escape(pos(3, 3))})\s*$")
        eventually(page, lambda: expect(counter).to_have_text(one_look, timeout=QUICK_MS))
        forward = (right, left)
        if counter.inner_text().strip() == pos(1, 3):
            forward = (left, right)
            for n in (2, 3):
                Touch(page).swipe(*forward)
                sees_text(page, counter, pos(n, 3))
        Touch(page).swipe(*forward)
        advance(page, 2 * STEP_MS)
        expect(counter).to_have_text(pos(3, 3), timeout=QUICK_MS)
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    drop = create_drop(ida)
    ids = [ok(upload_png(jonas, drop["id"], png(8, 8), title=fresh_name()), 201)["look"]["id"] for _ in range(2)]
    with signed_in(browser, app_url, JONAS, f"/studio/drops/{drop['id']}/lookbook", viewport=PHONE) as page:
        items = page.get_by_role("list", name="Looks").get_by_role("listitem")
        sees(page, items.nth(1))
        handle = items.nth(1).get_by_role("button", name="Move")
        handle.evaluate(BOTH_IN_VIEW, items.nth(0).element_handle())
        steady(page)
        start = center(handle)
        first = items.nth(0).bounding_box()
        touch = Touch(page)
        touch.start(*start)
        advance(page, LONG_PRESS_MS)
        touch.glide(start, (start[0], max(first["y"] + first["height"] / 2 - 10, TOUCH_EDGE)))
        touch.end()
        eventually(page, lambda: assertion_true([l["id"] for l in ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"]] == ids[::-1]))


def new_preview(amir, drop_id, editor=None):
    name, email = editor or unique("editor")
    return ok(amir.post(f"/api/drops/{drop_id}/previews", json={"editorName": name, "editorEmail": email, "outlet": "Nord Mode Journal"}), 201)


def press_token(preview):
    return preview["link"].rsplit("/", 1)[-1]


def test_preview_link_lifecycle(app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    preview = new_preview(amir, drop["id"])
    old = press_token(preview)
    ok(httpx.get(f"{app_url}/api/press/{old}"))
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        r = httpx.request(method, f"{app_url}/api/press/{old}")
        refused(r, 405, "method_not_allowed")
        assert "GET" in r.headers["Allow"]
    renewed = ok(amir.post(f"/api/previews/{preview['id']}/regenerate"))
    new = press_token(renewed)
    assert new != old
    refused(httpx.get(f"{app_url}/api/press/{old}"), 410, "link_replaced")
    ok(httpx.get(f"{app_url}/api/press/{new}"))
    assert ok(amir.post(f"/api/previews/{renewed['id']}/revoke"))["status"] == "revoked"
    refused(httpx.get(f"{app_url}/api/press/{new}"), 410, "link_revoked")
    refused(amir.post(f"/api/previews/{renewed['id']}/revoke"), 409, "preview_revoked")
    refused(amir.post(f"/api/previews/{renewed['id']}/regenerate"), 409, "preview_revoked")
    draft = create_drop(ida, status="draft", goLiveAt=None)
    refused(amir.post(f"/api/drops/{draft['id']}/previews", json={"editorName": "Elin Sund", "editorEmail": unique("editor")[1], "outlet": "Nord Mode Journal"}), 409, "drop_not_public")
    with app_copy(PREVIEW_LINK_TTL_SECONDS=str(PREVIEW_TTL_S)) as copy:
        short = new_preview(staff(copy, AMIR), drop["id"])
        assert parse_instant(short["expiresAt"]) - parse_instant(short["issuedAt"]) == timedelta(seconds=PREVIEW_TTL_S)
        ok(httpx.get(f"{copy}/api/press/{press_token(short)}"))
        wait_for(lambda: datetime.now(timezone.utc) >= parse_instant(short["expiresAt"]) + timedelta(seconds=1), PREVIEW_TTL_S + 5, "preview expiry")
        refused(httpx.get(f"{copy}/api/press/{press_token(short)}"), 410, "link_expired")
    live_link = press_token(new_preview(amir, drop["id"]))
    ok(ida.post(f"/api/drops/{drop['id']}/withdraw", json={"reason": "Supplier delay"}))
    refused(httpx.get(f"{app_url}/api/press/{live_link}"), 410, "drop_withdrawn")


def test_press_surfaces_carry_only_press_fields(browser, app_url, mail):
    ida, jonas, sofie, amir = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE), staff(app_url, AMIR)
    t = tag()
    sn = f"VR-{t}-1"
    note = f"{SECRET_NOTE} {t}"
    drop = create_drop(ida, internalNote=note, styles=[style(t, 1, rrpDkkMinor=SECRET_RRP)])
    price_list(sofie, [(sn, "DKK", SECRET_PRICE)])
    store = new_stockist(jonas)
    ok(request(jonas, drop["id"], store["id"], [(sn, 4)]), 201)
    ok(upload_png(jonas, drop["id"], png(8, 10)), 201)
    editor = unique("editor")
    preview = new_preview(amir, drop["id"], editor)
    payload = ok(httpx.get(f"{app_url}/api/press/{press_token(preview)}"))
    assert set(payload) == {"brand", "dropName", "type", "embargoUntil", "expiresAt", "markets", "storyHtml", "looks"}
    assert all(set(m) == {"market", "city", "goLiveAt"} for m in payload["markets"]) and len(payload["markets"]) == 6
    assert set(payload["looks"][0]) == {"id", "position", "title", "altText", "imageUrl", "width", "height"}
    assert payload["dropName"] == drop["name"] and payload["brand"] == "Maren Vale"
    message = inbox(mail, editor[1])[0]
    assert message["Subject"] == f"Preview: {drop['name']} (embargoed until {market_time(payload['embargoUntil'])})"
    with open_app(browser, f"{app_url}{preview['link']}") as page:
        sees(page, heading(page, f"Press preview: {drop['name']}"))
        rendered = page.content()
    forbidden = [note, store["name"], str(SECRET_PRICE), money(SECRET_PRICE, "DKK")[4:], str(SECRET_RRP), money(SECRET_RRP, "DKK")[4:],
                 AMIR, IDA, JONAS, "Amir Haddad", "Ida Holm"]
    for surface in (json.dumps(payload, ensure_ascii=False), rendered, text(message) + message["Subject"]):
        for secret in forbidden:
            assert secret not in surface, secret


def test_press_zip_and_manifest(app_url):
    ida, jonas, amir = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, AMIR)
    drop = create_drop(ida)
    ok(upload_look(jonas, drop["id"], jpeg(10, 6, exif_gps(6))), 201)
    ok(upload_png(jonas, drop["id"], png(8, 10)), 201)
    looks = ok(jonas.get(f"/api/drops/{drop['id']}/looks"))["items"]
    by_position = {l["position"]: l for l in looks}
    preview = new_preview(amir, drop["id"])
    r = httpx.get(f"{app_url}/api/press/{press_token(preview)}/zip", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/zip")
    archive = zipfile.ZipFile(io.BytesIO(r.content))
    manifest = json.loads(archive.read("manifest.json"))
    assert manifest["dropName"] == drop["name"] and isinstance(manifest["embargoUntil"], str)
    images = sorted(n for n in archive.namelist() if n != "manifest.json")
    assert len(images) == 2
    for name in images:
        stem, ext = name.rsplit(".", 1)
        assert ext in ("jpg", "png", "webp") and stem in {f"look-{p:02d}" for p in by_position}, name
    listed = {f["name"]: f for f in manifest["files"]}
    assert set(listed) == set(images)
    s3 = S3()
    for name in images:
        blob = archive.read(name)
        assert listed[name]["sizeBytes"] == len(blob) and listed[name]["sha256"] == hashlib.sha256(blob).hexdigest()
        assert EXIF_MARK not in blob
        look = by_position[int(name.rsplit(".", 1)[0].rsplit("-", 1)[1])]
        key = next(k for k in s3.keys(f"looks/{drop['id']}/") if look["id"] in k)
        assert s3.get(key) == blob
    assert f"press/{preview['id']}.zip" in s3.keys("press/")
    refused(httpx.get(f"{os.environ['APP_MINIO_DOWN_URL']}/api/press/{press_token(preview)}/zip", timeout=HTTP_TIMEOUT_S), 503, "storage_unavailable")


def test_wf_press_previews_phone_regenerate(browser, app_url, mail):
    ida = staff(app_url, IDA)
    drop = create_drop(ida)
    ok(upload_png(staff(app_url, JONAS), drop["id"], png(8, 10)), 201)
    editor_name, editor_email = unique("editor")
    with signed_in(browser, app_url, AMIR, f"/studio/drops/{drop['id']}/previews", record=True) as studio:
        press(studio.get_by_role("button", name="Send preview"))
        dialog = studio.get_by_role("dialog", name="Send preview")
        sees_focus(studio, dialog.get_by_role("textbox", name="Editor name"))
        axe(studio)
        fill(dialog.get_by_role("textbox", name="Editor name"), editor_name)
        fill(dialog.get_by_role("textbox", name="Editor email"), editor_email)
        fill(dialog.get_by_role("textbox", name="Outlet"), "Nord Mode Journal")
        press(dialog.get_by_role("button", name="Send preview"))
        sees_text(studio, status(studio, "Preview status"), f"Preview link created. The email to {editor_name} is on its way.")
        old = link_token(inbox(mail, editor_email)[0], "/press/")
        with open_app(browser, f"{app_url}/press/{old}") as phone:
            phone.set_viewport_size(PHONE)
            sees(phone, heading(phone, f"Press preview: {drop['name']}"))
            expect(phone.get_by_text("Embargoed until").first).to_be_visible()
            expect(phone.get_by_role("list", name="Looks").get_by_role("listitem")).to_have_count(1)
            download = visible_one(phone, phone.get_by_role("button", name="Download images"))
            assert in_viewport(download.bounding_box(), PHONE)
            with phone.expect_download() as got:
                tap(download)
                advance(phone, DOWNLOAD_PUMP_MS)
            sees_text(phone, status(phone, "Download status"), "Download ready.")
            assert "manifest.json" in zipfile.ZipFile(got.value.path()).namelist()
        row = studio.get_by_role("table", name="Preview links").get_by_role("row").filter(has_text=editor_name)
        press(row.get_by_role("button", name="Regenerate"))
        press(studio.get_by_role("dialog", name="Regenerate link").get_by_role("button", name="Regenerate link"))
        sees_text(studio, status(studio, "Preview status"), f"New link created. The old link no longer works, and the email to {editor_name} is on its way.")
        motion_kept(studio)
    fresh = next(t for t in (link_token(m, "/press/") for m in inbox(mail, editor_email, 2)) if t != old)
    with open_app(browser, f"{app_url}/press/{old}") as phone:
        phone.set_viewport_size(PHONE)
        sees(phone, heading(phone, "This preview is no longer available"))
        expect(phone.get_by_text("This preview link was replaced by a newer one. Check your inbox.").first).to_be_visible()
        phone.goto(f"{app_url}/press/{fresh}")
        sees(phone, heading(phone, f"Press preview: {drop['name']}"))
    refused(httpx.get(f"{app_url}/api/press/{old}"), 410, "link_replaced")
    whole_second_instants(ok(staff(app_url, AMIR).get(f"/api/drops/{drop['id']}/previews")))
    whole_second_instants(ok(httpx.get(f"{app_url}/api/press/{fresh}")))
    refused(staff(app_url, JONAS).post(f"/api/drops/{drop['id']}/previews", content="{", headers={"Content-Type": "application/json"}), 403, "forbidden")


def test_wf_press_previews_revoked(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    editor = unique("editor")
    preview = new_preview(amir, drop["id"], editor)
    with signed_in(browser, app_url, AMIR, f"/studio/drops/{drop['id']}/previews") as studio:
        row = studio.get_by_role("table", name="Preview links").get_by_role("row").filter(has_text=editor[0])
        press(row.get_by_role("button", name="Revoke"))
        press(studio.get_by_role("dialog", name="Revoke link").get_by_role("button", name="Revoke link"))
        sees_text(studio, status(studio, "Preview status"), "Link revoked.")
        settled_goto(studio, f"{app_url}{preview['link']}")
        sees(studio, heading(studio, "This preview is no longer available"))
        expect(studio.get_by_text("This preview link was revoked by the press team.").first).to_be_visible()
    refused(httpx.get(f"{app_url}/api/press/{press_token(preview)}"), 410, "link_revoked")


STORY_INPUT = ('<h2 class="x" onclick="evil()">Harbour</h2><p style="color:red">Knitted <span>on the</span> harbour.'
               '<script>alert(1)</script><style>p{color:red}</style><iframe src="https://x.example">frame text</iframe></p>'
               '<p><a href="javascript:alert(2)">bad link</a> <a href="https://marenvale.example/a" target="_blank">good link</a> '
               '<a href="mailto:press@marenvale.example">mail us</a> <a href="data:text/html,hi">data link</a><img src="x" onerror="alert(3)"></p>'
               '<ul><li><strong>B</strong> <em>I</em></li></ul><h1>Big</h1>')
ALLOWED_TAGS = {"p", "h2", "h3", "strong", "em", "ul", "ol", "li", "br", "a"}
GOOD_HREF = "https://marenvale.example/a"
MAIL_HREF = "mailto:press@marenvale.example"
STORY_DROPPED = ("alert(", "frame text", "color:red", "javascript:", "data:")
STORY_KEPT = ("on the", "bad link", "data link", "Big", "good link")


def story(c, drop_id):
    return ok(c.get(f"/api/drops/{drop_id}/story"))


def save_story(c, drop_id, version, html):
    return c.put(f"/api/drops/{drop_id}/story", json={"version": version, "html": html})


def assert_allowlisted(html):
    for name, attrs in tags_of(html):
        assert name in ALLOWED_TAGS, name
        assert set(attrs) <= ({"href"} if name == "a" else set()), (name, attrs)
        if name == "a":
            assert attrs["href"].startswith(("http:", "https:", "mailto:")), attrs
    for gone in STORY_DROPPED:
        assert gone not in html
    for kept in STORY_KEPT:
        assert kept in html


def assert_rendered_safely(html):
    for name, attrs in tags_of(html):
        assert name not in UNSAFE_TAGS, name
        assert not [a for a in attrs if a.startswith("on")], (name, attrs)
        if name == "a":
            assert (attrs.get("href") or "").startswith(("http:", "https:", "mailto:")), attrs
    for gone in STORY_DROPPED:
        assert gone not in html
    for kept in STORY_KEPT:
        assert kept in html


def test_story_allowlist(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    saved = ok(save_story(amir, drop["id"], story(amir, drop["id"])["version"], STORY_INPUT))
    assert_allowlisted(saved["html"])
    hrefs = [a["href"] for n, a in tags_of(saved["html"]) if n == "a"]
    assert sorted(hrefs) == sorted([GOOD_HREF, MAIL_HREF])
    published = ok(amir.post(f"/api/drops/{drop['id']}/story/publish", json={"version": saved["version"]}))
    assert published["publishedHtml"] == saved["html"]
    assert ok(public(app_url, drop["slug"]))["storyHtml"] == saved["html"]
    with open_app(browser, f"{app_url}/drops/{drop['slug']}") as page:
        article = page.get_by_role("article", name="Story")
        sees(page, article)
        expect(article.get_by_role("link", name=STORY_KEPT[4])).to_have_attribute("href", GOOD_HREF)
        expect(article.get_by_role("link", name=STORY_KEPT[1])).to_have_count(0)
        assert_rendered_safely(article.inner_html())


def test_versioned_story_saves(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    with signed_in(browser, app_url, AMIR, f"/studio/drops/{drop['id']}/story") as page:
        editor = page.get_by_role("textbox", name="Story")
        sees(page, editor)
        start = story(amir, drop["id"])
        newer = ok(save_story(amir, drop["id"], start["version"], SAVED_ELSEWHERE))
        stale = refused(save_story(amir, drop["id"], start["version"], MINE), 412, "stale_version")
        assert stale["error"]["savedBy"] == "Amir Haddad" and stale["error"]["savedAt"] == newer["savedAt"]
        assert stale["error"]["current"]["html"] == newer["html"]
        click(editor)
        page.keyboard.type(TYPED)
        click(page.get_by_role("button", name="Save story"))
        sees_text(page, status(page, "Story status"), f"Not saved: Amir Haddad saved a newer version at {market_time(newer['savedAt'])}. Your text is still in the editor.")
        expect(editor).to_contain_text(TYPED)
        assert TYPED not in story(amir, drop["id"])["html"]
        click(page.get_by_role("button", name="Save story"))
        saved_story(page, status(page, "Story status"))
    final = story(amir, drop["id"])
    assert TYPED in final["html"] and final["version"] > newer["version"]


def test_story_announcements(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    with signed_in(browser, app_url, AMIR, f"/studio/drops/{drop['id']}/story") as page:
        editor = page.get_by_role("textbox", name="Story")
        click(editor)
        page.keyboard.type("Knitted on the harbour.")
        click(page.get_by_role("button", name="Save story"))
        announced = status(page, "Story status")
        saved_story(page, announced)
        saved = story(amir, drop["id"])
        expect(announced).to_have_text(f"Story saved at {market_time(saved['savedAt'])}.")
        click(page.get_by_role("button", name="Publish story"))
        click(page.get_by_role("dialog", name="Publish story").get_by_role("button", name="Publish"))
        sees_text(page, announced, "Story published.")
        assert "Knitted on the harbour." in story(amir, drop["id"])["publishedHtml"]
        page.route("**/api/drops/*/story", lambda route: route.abort())
        click(editor)
        page.keyboard.type(MORE)
        click(page.get_by_role("button", name="Save story"))
        sees_text(page, announced, UNREACHABLE)
        expect(editor).to_contain_text(MORE.strip())


def test_wf_drop_stories_write_publish(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    with signed_in(browser, app_url, AMIR, f"/studio/drops/{drop['id']}/story", record=True) as page:
        sees(page, heading(page, f"Story · {drop['name']}"))
        editor = page.get_by_role("textbox", name="Story")
        editor.focus()
        press(page.get_by_role("toolbar", name="Formatting").get_by_role("button", name=re.compile(r"^Heading\b")))
        editor.focus()
        page.keyboard.type(STORY_HEADING)
        page.keyboard.press("Enter")
        page.keyboard.type("Knitted on the harbour.")
        press(page.get_by_role("button", name="Save story"))
        saved_story(page, status(page, "Story status"))
        press(page.get_by_role("button", name="Publish story"))
        publish = page.get_by_role("dialog", name="Publish story")
        sees(page, publish)
        axe(page)
        press(publish.get_by_role("button", name="Publish"))
        sees_text(page, status(page, "Story status"), "Story published.")
        motion_kept(page)
    published = story(amir, drop["id"])["publishedHtml"]
    assert f"<h2>{STORY_HEADING}</h2>" in published and "Knitted on the harbour." in published
    with open_app(browser, f"{app_url}/drops/{drop['slug']}") as page:
        article = page.get_by_role("article", name="Story")
        sees(page, article.get_by_role("heading", level=2, name=STORY_HEADING))
    whole_second_instants(story(amir, drop["id"]))
    oversized = json.dumps({"version": 1, "html": "<p>" + "x" * JSON_LIMIT + "</p>"})
    refused(staff(app_url, JONAS).put(f"/api/drops/{drop['id']}/story", content=oversized, headers={"Content-Type": "application/json"}), 403, "forbidden")


def test_wf_drop_stories_session_restore(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    path = f"/studio/drops/{drop['id']}/story"
    with app_copy(SESSION_TTL_SECONDS=str(SESSION_TTL_S)) as copy:
        with signed_in(browser, copy, AMIR, path) as page:
            signed_at = time.monotonic()
            editor = page.get_by_role("textbox", name="Story")
            sees(page, editor)
            click(editor)
            page.keyboard.type(DRAFT_TEXT)
            advance(page, DRAFT_SETTLE_MS)
            wait_for(lambda: time.monotonic() - signed_at > SESSION_TTL_S + 1, SESSION_TTL_S + 5, "session end")
            click(page.get_by_role("button", name="Save story"))
            sees_text(page, status(page, "Story status"), re.compile(re.escape(SESSION_ENDED)))
            expect(editor).to_contain_text(DRAFT_TEXT)
            again = page.get_by_role("link", name="Sign in again")
            target = urlparse(again.get_attribute("href") or "")
            assert target.path == "/sign-in" and parse_qs(target.query).get("next") == [path], target
            click(again)
            sees(page, heading(page, "Sign in"))
            fill(page.get_by_role("textbox", name="Email"), AMIR)
            fill(page.get_by_label("Password", exact=True), PASSWORD)
            click(page.get_by_role("button", name="Sign in"))
            at_path(page, path)
            sees(page, page.get_by_text("Your draft is restored.").first)
            expect(page.get_by_role("textbox", name="Story")).to_contain_text(DRAFT_TEXT)
            click(page.get_by_role("button", name="Save story"))
            saved_story(page, status(page, "Story status"))
    assert DRAFT_TEXT in story(amir, drop["id"])["html"]


def test_danish_order_stable_pages(app_url):
    jonas = staff(app_url, JONAS)
    prefix = f"Dq{uuid.uuid4().int % 10 ** 8:08d}"
    order = list(DANISH_WORDS)
    archived_word = DANISH_WORDS[4]
    made = {w: new_stockist(jonas, name=f"{prefix} {w}") for w in reversed(order)}
    first = ok(jonas.get("/api/stockists", params={"q": prefix.upper()}))
    assert [i["name"] for i in first["items"]] == [f"{prefix} {w}" for w in order]
    seen, cursor, page_no = [], None, 0
    while True:
        params = {"q": prefix, "limit": 2}
        if cursor:
            params["cursor"] = cursor
        chunk = ok(jonas.get("/api/stockists", params=params))
        assert len(chunk["items"]) <= 2
        seen.extend(i["name"] for i in chunk["items"])
        page_no += 1
        if page_no == 1:
            for word in DANISH_ADDED:
                new_stockist(jonas, name=f"{prefix} {word}")
            ok(jonas.post(f"/api/stockists/{made[archived_word]['id']}/archive"))
        cursor = chunk["nextCursor"]
        if not cursor:
            break
    assert len(seen) == len(set(seen))
    persistent = [f"{prefix} {w}" for w in order if w != archived_word]
    assert [n for n in seen if n in persistent] == persistent
    assert len(ok(jonas.get("/api/stockists", params={"limit": OVER_LIMIT}))["items"]) <= PAGE_CAP


def test_archive_and_exact_restore(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    store = new_stockist(jonas)
    ok(request(jonas, drop["id"], store["id"], [(sn, 7)]), 201)
    alloc = next(a for a in ok(jonas.get(f"/api/drops/{drop['id']}/allocations"))["items"] if a["stockistId"] == store["id"])
    before = ok(jonas.get(f"/api/stockists/{store['id']}"))
    assert ok(jonas.post(f"/api/stockists/{store['id']}/archive"))["status"] == "archived"
    refused(jonas.get(f"/api/stockists/{store['id']}"), 404, "not_found")
    refused(jonas.get(f"/api/allocations/{alloc['id']}"), 404, "not_found")
    assert store["name"] not in [i["name"] for i in ok(jonas.get("/api/stockists", params={"q": store["name"]}))["items"]]
    assert store["name"] in [i["name"] for i in ok(jonas.get("/api/stockists", params={"q": store["name"], "archived": "true"}))["items"]]
    assert store["name"] not in jonas.get("/api/stockists.csv").text
    assert all(a["id"] != alloc["id"] for a in ok(jonas.get(f"/api/drops/{drop['id']}/allocations"))["items"])
    restored = ok(jonas.post(f"/api/stockists/{store['id']}/restore"))
    assert restored["status"] == "active"
    assert {k: v for k, v in restored.items() if k not in ("status", "archivedAt")} == {k: v for k, v in before.items() if k not in ("status", "archivedAt")}
    assert ok(jonas.get(f"/api/allocations/{alloc['id']}")) == alloc
    assert store["name"] in jonas.get("/api/stockists.csv").text
    refused(jonas.post(f"/api/stockists/{store['id']}/restore"), 409, "stockist_active")


def test_contact_erasure(app_url):
    ida, jonas, sofie = staff(app_url, IDA), staff(app_url, JONAS), staff(app_url, SOFIE)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    store = new_stockist(jonas)
    price_list(sofie, [(sn, "DKK", 44900)])
    confirmed = ok(confirm(sofie, allocation(jonas, drop["id"], store["id"], [(sn, 2)])))
    erased = ok(jonas.post(f"/api/stockists/{store['id']}/erase-contact"))
    assert (erased["contactName"], erased["contactEmail"], erased["contactPhone"], erased["contactErased"]) == (None, None, None, True)
    listed = next(i for i in ok(jonas.get("/api/stockists", params={"q": store["name"]}))["items"] if i["id"] == store["id"])
    assert listed["contactErased"] is True and listed["contactEmail"] is None
    raw = jonas.get("/api/stockists.csv").text
    row = next(r for r in csv.DictReader(io.StringIO(raw)) if r["Name"] == store["name"])
    assert row["Contact name"] == "Contact erased"
    assert store["contactEmail"] not in raw and "+45 31 22 44 10" not in row.values()
    after = ok(sofie.get(f"/api/allocations/{confirmed['id']}"))
    assert after["contactName"] == "Contact erased"
    assert (after["totalMinor"], after["invoiceNumber"]) == (confirmed["totalMinor"], confirmed["invoiceNumber"])


def test_wf_stockist_directory_manage(browser, app_url):
    name = f"Fjord Atelier {tag()}"
    jonas = staff(app_url, JONAS)
    with signed_in(browser, app_url, JONAS, "/studio/stockists", record=True) as page:
        title = heading(page, "Stockists")
        sees(page, title)
        press(page.get_by_role("button", name="Add stockist"))
        dialog = page.get_by_role("dialog", name="Add stockist")
        sees_focus(page, dialog.get_by_role("textbox", name=NAME_FIELD))
        axe(page)
        fill(dialog.get_by_role("textbox", name=NAME_FIELD), name)
        fill(dialog.get_by_role("textbox", name="Contact name"), "Sara Holm")
        fill(dialog.get_by_role("textbox", name="Contact email"), unique("fjord")[1])
        fill(dialog.get_by_role("textbox", name="Contact phone"), "+45 31 22 44 10")
        press(dialog.get_by_role("button", name="Save stockist"))
        sees_text(page, status(page, "Stockist status"), "Stockist added.")
        fill(page.get_by_role("searchbox", name="Search stockists"), name)
        advance(page, SEARCH_SETTLE_MS)
        row = page.get_by_role("table", name=re.compile(r"^Stockists\b")).get_by_role("row").filter(has_text=name)
        sees(page, row)
        press(row.get_by_role("button", name="Archive"))
        press(page.get_by_role("dialog", name="Archive stockist").get_by_role("button", name="Archive stockist"))
        sees_text(page, status(page, "Stockist status"), "Stockist archived.")
        sees_focus(page, title)
        press(page.get_by_role("switch", name="Show archived"), "Space")
        archived = page.get_by_role("table", name="Archived stockists").get_by_role("row").filter(has_text=name)
        sees(page, archived)
        press(archived.get_by_role("button", name="Restore"))
        press(page.get_by_role("dialog", name="Restore stockist").get_by_role("button", name="Restore stockist"))
        sees_text(page, status(page, "Stockist status"), "Stockist restored.")
        sees_focus(page, title)
        store = next(i for i in ok(jonas.get("/api/stockists", params={"q": name}))["items"] if i["name"] == name)
        settled_goto(page, f"{app_url}/studio/stockists/{store['id']}")
        own = heading(page, name)
        sees(page, own)
        press(page.get_by_role("button", name="Erase contact"))
        press(page.get_by_role("dialog", name="Erase contact").get_by_role("button", name="Erase contact"))
        sees_text(page, status(page, "Stockist status"), "Contact erased.")
        sees_focus(page, own)
        expect(page.get_by_text("Contact erased").first).to_be_visible()
        motion_kept(page)
    final = ok(jonas.get(f"/api/stockists/{store['id']}"))
    assert final["status"] == "active" and final["contactErased"] is True and final["contactEmail"] is None
    whole_second_instants(final)
    fjell = seeded_stockist(staff(app_url, EMIL), "Fjell Room")
    refused(staff(app_url, AMIR).post(f"/api/stockists/{fjell['id']}/archive"), 404, "not_found")


def test_wf_stockist_directory_phone(browser, app_url):
    jonas = staff(app_url, JONAS)
    store = new_stockist(jonas)
    with signed_in(browser, app_url, JONAS, "/studio/stockists", viewport=PHONE) as page:
        sees(page, heading(page, "Stockists"))
        fill(page.get_by_role("searchbox", name="Search stockists"), store["name"])
        advance(page, SEARCH_SETTLE_MS)
        cards = page.get_by_role("list", name="Stockists")
        sees(page, cards.get_by_role("listitem").filter(has_text=store["name"]))
        add = visible_one(page, page.get_by_role("button", name="Add stockist"))
        export = visible_one(page, page.get_by_role("link", name="Export CSV"))
        assert in_viewport(add.bounding_box(), PHONE) and in_viewport(export.bounding_box(), PHONE)
        layout(page)
        tap(add)
        dialog = page.get_by_role("dialog", name="Add stockist")
        name_field = dialog.get_by_role("textbox", name=NAME_FIELD)
        sees_focus(page, name_field)
        fill(name_field, fresh_name())
        fill(dialog.get_by_role("textbox", name="Contact name"), "Sara Holm")
        fill(dialog.get_by_role("textbox", name="Contact email"), unique("phone")[1])
        fill(dialog.get_by_role("textbox", name="Contact phone"), "+45 31 22 44 10")
        press(dialog.get_by_role("button", name="Save stockist"))
        sees_text(page, status(page, "Stockist status"), "Stockist added.")


def test_startup_health_and_several_copies(app_url, mail):
    started = [start_copy(), start_copy()]
    try:
        for proc, url, log in started:
            await_health(proc, url, log)
            assert ok(httpx.get(f"{url}/api/health")) == {"status": "ok"}
        assert ok(httpx.get(f"{app_url}/api/health")) == {"status": "ok"}
        members = [unique("vip"), unique("vip")]
        ida, drop = live_drop(started[0][1], 2, vip=members)
        subject = f"A piece of {drop['name']} is held for you"
        for _, email in members:
            inbox(mail, email, subject=subject)
        end = time.monotonic() + SWEEP_S
        while time.monotonic() < end:
            for _, email in members:
                assert len(mails(mail, email, subject)) == 1
            threading.Event().wait(POLL_S)
        assert staff_market(ida, drop["id"])["held"] == 2
    finally:
        for proc, _, _ in started:
            stop_copy(proc)


LADDER_CASES = ["unknown_api_path", "wrong_method", "cross_origin_first", "unauthenticated", "not_found_before_forbidden",
                "forbidden_before_too_large", "too_large_before_media_type", "media_type_before_json", "invalid_json",
                "claim_key_required", "validation", "env_file", "unknown_screen"]


@pytest.mark.parametrize("case", LADDER_CASES, ids=LADDER_CASES)
def test_error_ladder_and_surface(app_url, case):
    probe = uuid.uuid4().hex
    big = json.dumps({"name": "x" * (JSON_LIMIT + 1)})
    if case == "unknown_api_path":
        refused(httpx.get(f"{app_url}/api/{probe}"), 404, "not_found")
    elif case == "wrong_method":
        r = httpx.delete(f"{app_url}/api/health")
        refused(r, 405, "method_not_allowed")
        assert "GET" in r.headers["Allow"]
    elif case == "cross_origin_first":
        r = httpx.post(f"{app_url}/api/stockists", json={}, headers={"Origin": FOREIGN_ORIGIN})
        assert refused(r, 403, "cross_origin")["error"]["message"] == "This request came from another site and was refused."
    elif case == "unauthenticated":
        assert refused(httpx.get(f"{app_url}/api/members"), 401, "unauthenticated")["error"]["message"] == "Sign in to continue."
    elif case == "not_found_before_forbidden":
        emil = next(m for m in ok(staff(app_url, NOOR).get("/api/members"))["items"] if m["email"] == EMIL)
        refused(staff(app_url, AMIR).patch(f"/api/members/{emil['id']}", json={"role": "press_lead"}), 404, "not_found")
    elif case == "forbidden_before_too_large":
        r = staff(app_url, AMIR).post("/api/stockists", content=big, headers={"Content-Type": "application/json"})
        assert refused(r, 403, "forbidden")["error"]["message"] == "Your role can't do this."
    elif case == "too_large_before_media_type":
        refused(staff(app_url, JONAS).post("/api/stockists", content=big, headers={"Content-Type": WRONG_TYPE}), 413, "too_large")
    elif case == "media_type_before_json":
        refused(staff(app_url, JONAS).post("/api/stockists", content="{", headers={"Content-Type": WRONG_TYPE}), 415, "unsupported_media_type")
    elif case == "invalid_json":
        refused(staff(app_url, JONAS).post("/api/stockists", content="{", headers={"Content-Type": "application/json"}), 400, "invalid_json")
    elif case == "claim_key_required":
        refused(post_json(app_url, f"/api/public/drops/{HARBOUR}/claims", {"market": "copenhagen", "name": "Freja Dahl", "email": unique("nokey")[1]}), 400, "idempotency_key_required")
    elif case == "validation":
        body = refused(staff(app_url, JONAS).post("/api/stockists", json={"name": "", "market": "copenhagen"}), 422, "validation_failed")
        assert body["error"]["fields"]["name"] == REQUIRED
    elif case == "env_file":
        r = httpx.get(f"{app_url}{ENV_PATH}")
        assert r.status_code == 404 and "DATABASE_URL" not in r.text
    else:
        r = httpx.get(f"{app_url}/{probe}")
        assert r.status_code == 404


def test_session_ended_and_access_removed(app_url, mail):
    with app_copy(SESSION_TTL_SECONDS=str(SESSION_TTL_S)) as copy:
        c = staff(copy, JONAS)
        signed_at = time.monotonic()
        ok(c.get("/api/auth/session"))
        wait_for(lambda: time.monotonic() - signed_at > SESSION_TTL_S + 1, SESSION_TTL_S + 5, "session end")
        assert refused(c.get("/api/auth/session"), 401, "session_ended")["error"]["message"] == SESSION_ENDED
    ida, member_client, member, _ = invite_member(app_url, mail)
    ok(member_client.get("/api/stockists"))
    assert ida.delete(f"/api/members/{member['id']}").status_code == 204
    assert refused(member_client.get("/api/stockists"), 401, "access_removed")["error"]["message"] == ACCESS_REMOVED


def test_wf_cross_cutting_access_removed(browser, app_url, mail):
    ida, _, member, email = invite_member(app_url, mail)
    name = fresh_name()
    with open_app(browser, f"{app_url}/sign-in") as page:
        assert page.request.post(f"{app_url}/api/auth/sign-in", data={"email": email, "password": NEW_PASSWORD}).status == 200
        page.goto(f"{app_url}/studio/stockists")
        press(page.get_by_role("button", name="Add stockist"))
        dialog = page.get_by_role("dialog", name="Add stockist")
        fill(dialog.get_by_role("textbox", name=NAME_FIELD), name)
        assert ida.delete(f"/api/members/{member['id']}").status_code == 204
        press(dialog.get_by_role("button", name="Save stockist"))
        sees(page, page.get_by_text(ACCESS_REMOVED).first)
        expect(dialog.get_by_role("textbox", name=NAME_FIELD)).to_have_value(name)
    assert ok(staff(app_url, JONAS).get("/api/stockists", params={"q": name}))["items"] == []


def test_wf_cross_cutting_problems(browser, app_url):
    with open_app(browser, f"{app_url}/forgot-password") as page:
        field = page.get_by_role("textbox", name="Email")
        assert field.evaluate("e => !e.required && e.maxLength < 0")
        click(page.get_by_role("button", name="Send reset link"))
        problems = page.get_by_role("region", name="Problems")
        sees_focus(page, problems)
        expect(problems.get_by_role("heading", level=2, name="Problems")).to_be_visible()
        click(problems.get_by_role("link", name=f"Email: {REQUIRED}"))
        sees_focus(page, field)
    with signed_in(browser, app_url, JONAS, "/studio/stockists") as page:
        press(page.get_by_role("button", name="Add stockist"))
        dialog = page.get_by_role("dialog", name="Add stockist")
        fill(dialog.get_by_role("textbox", name="Contact email"), BAD_EMAIL)
        press(dialog.get_by_role("button", name="Save stockist"))
        alert = dialog.get_by_role("alert")
        sees_focus(page, alert)
        expect(dialog).to_contain_text(REQUIRED)
        expect(dialog).to_contain_text("Enter an email address like name@example.com.")
        expect(dialog.get_by_role("textbox", name="Contact email")).to_have_value(BAD_EMAIL)


def test_published_formats(app_url):
    ida, sofie = staff(app_url, IDA), staff(app_url, SOFIE)
    drop = create_drop(ida)
    instant_re = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
    staff_drop = ok(ida.get(f"/api/drops/{drop['id']}"))
    for value in [staff_drop["createdAt"], staff_drop["goLiveAt"]] + [m["goLiveAt"] for m in staff_drop["markets"]]:
        assert instant_re.match(value), value
    go = parse_instant(staff_drop["goLiveAt"])
    item = ok(httpx.get(f"{app_url}/api/public/drops", params={"q": drop["name"], "week": week_value(go)}))["items"][0]
    assert instant_re.match(item["goLiveAt"]) and item["weekLabel"] == week_label(go)
    assert not item["weekLabel"].split(" ")[1].startswith("0")
    for entry in ok(sofie.get("/api/price-lists"))["items"]:
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", entry["effectiveDate"])
        assert all(isinstance(p["unitPriceMinor"], int) for p in entry["prices"])
    assert all(isinstance(s["rrpDkkMinor"], int) for s in staff_drop["styles"])


@pytest.mark.parametrize("size", VIEWPORTS, ids=VIEWPORTS)
def test_viewports_and_accessibility(browser, app_url, size):
    viewport = SIZES[size]
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(viewport)
        for path in ("/", f"/drops/{HARBOUR}", "/sign-in", "/forgot-password"):
            page.goto(f"{app_url}{path}")
            sees(page, page.get_by_role("heading", level=1))
            layout(page)
            axe(page)
        if size == "phone":
            page.goto(f"{app_url}/")
            tap(page.get_by_role("button", name="Filters"))
            sees(page, page.get_by_role("dialog", name="Filters"))
            axe(page)
    with signed_in(browser, app_url, JONAS, "/studio/stockists", viewport=viewport) as page:
        sees(page, heading(page, "Stockists"))
        layout(page)
        axe(page)
        click(page.get_by_role("button", name="Add stockist"))
        sees(page, page.get_by_role("dialog", name="Add stockist"))
        layout(page)
        axe(page)


def test_motion_system(browser, app_url):
    allowed = {FEEDBACK_MS, STATE_MS, ENTRANCE_MS}

    def harbour_card(page):
        fill(page.get_by_role("searchbox", name="Search drops"), "Harbour Wool Edit")
        advance(page, SEARCH_SETTLE_MS)
        card = page.get_by_role("list", name="Drops").get_by_role("link", name="Harbour Wool Edit", exact=True).first
        sees(page, card)
        return card
    with open_app(browser, f"{app_url}/sign-in") as page:
        page.add_init_script(RECORDER_INIT)
        page.goto(f"{app_url}/")
        sees(page, heading(page, "Drop calendar"))
        card = harbour_card(page)
        card.hover()
        click(card)
        target = heading(page, "Harbour Wool Edit")
        sees_focus(page, target)
        durations = page.evaluate("() => window.__motion.map(m => m.ms)")
        assert any(round(ms) == ENTRANCE_MS for ms in durations), durations
        assert all(round(ms) in allowed for ms in durations if ms > 0), durations
        page.goto(f"{app_url}/")
        sees(page, heading(page, "Drop calendar"))
        expect(page.get_by_text(re.compile("Copenhagen time")).first).to_be_visible()
        assert all(round(ms) != ENTRANCE_MS for ms in page.evaluate("() => window.__motion.map(m => m.ms)"))
    with open_app(browser, f"{app_url}/sign-in", reduced_motion="reduce") as page:
        page.add_init_script(RECORDER_INIT)
        page.goto(f"{app_url}/")
        sees(page, heading(page, "Drop calendar"))
        click(harbour_card(page))
        sees_focus(page, heading(page, "Harbour Wool Edit"))
        everything = records(page.locator("html"))
        assert not slow_moves(everything), everything


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}


def test_if_run_manifest():
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert all(isinstance(v, str) and v for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices():
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    packages = [package.name for package in kit.shipped_packages()]
    assert packages
    assert [n for n in packages if n not in notices] == []
    for font in ("Archivo", "Inter", "IBM Plex Mono"):
        assert font in notices


def test_if_licences():
    bad = {package.name: package.licence for package in kit.shipped_packages()
           if not kit.licence_allowed(package.licence, ALLOWED_LICENCES)}
    assert bad == {}


def test_if_only_provided_datastores():
    package = json.loads((APP_DIR / "package.json").read_text())
    deps = set(package.get("dependencies", {})) | set(package.get("devDependencies", {}))
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "lowdb", "nedb", "level", "lmdb", "memcached", "@libsql/client", "pglite", "@electric-sql/pglite"}
    assert deps & banned == set()
    files = [p for p in APP_DIR.rglob("*") if "node_modules" not in p.parts and ".git" not in p.parts and p.suffix in (".sqlite", ".sqlite3", ".db")]
    assert files == []


def test_if_same_origin_assets(browser, app_url):
    urls = []
    with open_app(browser, f"{app_url}/sign-in") as page:
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", f"/drops/{HARBOUR}", "/sign-in"):
            page.goto(f"{app_url}{path}")
            sees(page, page.get_by_role("heading", level=1))
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert foreign == []


def test_if_no_copied_images():
    raster = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".avif", ".heic"}
    found = [p for p in APP_DIR.rglob("*") if "node_modules" not in p.parts and ".git" not in p.parts and p.suffix.lower() in raster]
    assert found == []


def test_if_lockfile_install():
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    package = json.loads((APP_DIR / "package.json").read_text())
    assert lock.get("lockfileVersion") and lock.get("name") == package.get("name")
    assert re.search(r"\bnpm ci\b", json.loads((APP_DIR / "run.json").read_text())["install"])


LAYOUT_WAIT_S = 3
PHONE_EDGE = {"width": 767, "height": 1024}
TABLET_EDGE = {"width": 768, "height": 1024}
CLOCK_SKEW = timedelta(hours=3)
EXPIRY_SKEW = timedelta(days=30)
PRESS_FOLLOW_MS = 10_000
COUNTDOWN_BAND_S = 2
COUNTDOWN = re.compile(r"(?:(\d+)d )?(\d{2}):(\d{2}):(\d{2})")
TWO_SLASHES = "/" * 2
STUCK_BOTTOM = """el => {
  // L106 "sit in a sticky bottom bar": the control or an ancestor is sticky or fixed and anchored to the bottom edge
  for (let n = el; n && n !== document.documentElement; n = n.parentElement) {
    const style = getComputedStyle(n);
    const atBottom = Math.abs(n.getBoundingClientRect().bottom - window.innerHeight) <= 2;
    // a fixed box reports a pixel `bottom` even when it is auto: only its place at the bottom edge counts
    if (style.position === 'fixed') return atBottom;
    if (style.position === 'sticky') return style.bottom !== 'auto' || atBottom;
  }
  return false;
}"""


def soft(failures, label, check):
    try:
        check()
    except (AssertionError, PlaywrightError) as error:
        failures.append(f"{label}: {str(error).strip().splitlines()[0][:300]}")


def soft_layout(failures, page, label, check):
    soft(failures, label, lambda: eventually(page, check, LAYOUT_WAIT_S))


def report(failures):
    assert not failures, "\n".join(failures)


def at_width(page, size):
    page.set_viewport_size(size)
    steady(page)


def visible(locator):
    return [locator.nth(i) for i in range(locator.count()) if locator.nth(i).is_visible()]


def in_bottom_bar(page, locator):
    steady(page)
    shown = visible(locator)
    assert shown, "the control is not visible"
    assert any(item.evaluate(STUCK_BOTTOM) for item in shown), "the control is not in a sticky bottom bar"


def inline_in_content(page, locator):
    steady(page)
    shown = visible(locator)
    assert shown, "the control is not visible"
    assert not any(item.evaluate(STUCK_BOTTOM) for item in shown), "the control is in a sticky bar"


def countdown_seconds(text):
    found = re.search(r"(?:(\d+)d)?(\d{2}):(\d{2}):(\d{2})", "".join(text.split()))
    assert found, text
    days, hours, minutes, seconds = (int(part or 0) for part in found.groups())
    return ((days * 24 + hours) * 60 + minutes) * 60 + seconds


def allocation_page(app_url):
    ida, jonas = staff(app_url, IDA), staff(app_url, JONAS)
    t = tag()
    sn = f"VR-{t}-1"
    drop = create_drop(ida, styles=[style(t, 1)])
    store = new_stockist(jonas)
    price_list(staff(app_url, SOFIE), [(sn, "DKK", 123450)])
    return allocation(jonas, drop["id"], store["id"], [(sn, 2)]), store, drop, sn


def test_wf_workspace_access_landing_route(browser, app_url):
    drop = create_drop(staff(app_url, IDA))
    story_path = f"/studio/drops/{drop['id']}/story"
    cases = [
        (story_path, story_path, f"Story · {drop['name']}"),
        (f"{TWO_SLASHES}evil.example/studio/press", "/studio/press", "Press"),
        ("https://evil.example/studio/press", "/studio/press", "Press"),
        ("/studio/my-store", "/studio/press", "Press"),
    ]
    failures = []
    for target, landing, title in cases:
        def walk(target=target, landing=landing, title=title):
            with open_app(browser, f"{app_url}/sign-in?{urlencode({'next': target})}") as page:
                sees(page, heading(page, "Sign in"))
                fill(page.get_by_role("textbox", name="Email"), AMIR)
                fill(page.get_by_label("Password", exact=True), PASSWORD)
                click(page.get_by_role("button", name="Sign in"))
                at_path(page, landing)
                assert urlparse(page.url).netloc == urlparse(app_url).netloc, page.url
                sees(page, heading(page, title))
                page.reload()
                at_path(page, landing)
                sees(page, heading(page, title))
        soft(failures, f"next={target}", walk)
    report(failures)


def test_wf_public_calendar_layout_widths(browser, app_url):
    failures = []
    with open_app(browser, f"{app_url}/") as page:
        sees(page, heading(page, "Drop calendar"))

        def phone():
            at_width(page, PHONE_EDGE)
            assert visible(page.get_by_role("button", name="Filters")), "no Filters button"
            inline = [m for m in visible(page.get_by_role("combobox", name="Market"))
                      if in_viewport(m.bounding_box(), PHONE_EDGE)]
            assert not inline, "inline Market filter shown"

        def tablet():
            at_width(page, TABLET_EDGE)
            assert visible(page.get_by_role("combobox", name="Market")), "no inline Market filter"
            assert not visible(page.get_by_role("button", name="Filters")), "Filters button shown"
        soft_layout(failures, page, "767 px", phone)
        soft_layout(failures, page, "768 px", tablet)
    report(failures)


def test_wf_waitlist_layout_widths(browser, app_url):
    drop = create_drop(staff(app_url, IDA))
    with open_app(browser, f"{app_url}/drops/{drop['slug']}") as page:
        sees(page, heading(page, drop["name"]))
        at_width(page, PHONE_EDGE)
        eventually(page, lambda: in_bottom_bar(page, page.get_by_role("button", name="Join waitlist")), LAYOUT_WAIT_S)


def test_wf_stockist_directory_layout_widths(browser, app_url):
    failures = []
    with signed_in(browser, app_url, JONAS, "/studio/stockists") as page:
        sees(page, heading(page, "Stockists"))
        table = page.get_by_role("table", name=re.compile(r"^Stockists\b"))
        cards = page.get_by_role("list", name="Stockists")

        def phone():
            at_width(page, PHONE_EDGE)
            assert visible(cards) and not visible(table), "the directory is not shown as cards"
            in_bottom_bar(page, page.get_by_role("button", name="Add stockist"))
            in_bottom_bar(page, page.get_by_role("link", name="Export CSV"))

        def tablet():
            at_width(page, TABLET_EDGE)
            assert visible(table) and not visible(cards), "the directory is not shown as the Stockists table"
        soft_layout(failures, page, "767 px", phone)
        soft_layout(failures, page, "768 px", tablet)
    report(failures)


def test_wf_line_sheets_layout_widths(browser, app_url):
    drop = create_drop(staff(app_url, IDA))
    failures = []
    with signed_in(browser, app_url, JONAS, f"/studio/drops/{drop['id']}/line-sheet") as page:
        sees(page, heading(page, f"Line sheet · {drop['name']}"))
        actions = (page.get_by_role("link", name="Export CSV"), page.get_by_role("button", name="Import line sheet"))
        at_width(page, PHONE_EDGE)
        for n, action in enumerate(actions):
            soft_layout(failures, page, f"767 px action {n + 1}", lambda action=action: in_bottom_bar(page, action))
        at_width(page, TABLET_EDGE)
        for n, action in enumerate(actions):
            soft_layout(failures, page, f"768 px action {n + 1}", lambda action=action: inline_in_content(page, action))
    report(failures)


def test_wf_drop_stories_layout_widths(browser, app_url):
    drop = create_drop(staff(app_url, IDA))
    failures = []
    with signed_in(browser, app_url, AMIR, f"/studio/drops/{drop['id']}/story") as page:
        sees(page, heading(page, f"Story · {drop['name']}"))
        at_width(page, PHONE_EDGE)
        for name in ("Save story", "Publish story"):
            soft_layout(failures, page, f"767 px {name}", lambda name=name: in_bottom_bar(page, page.get_by_role("button", name=name)))
        at_width(page, TABLET_EDGE)
        for name in ("Save story", "Publish story"):
            soft_layout(failures, page, f"768 px {name}", lambda name=name: inline_in_content(page, page.get_by_role("button", name=name)))
    report(failures)


def test_wf_allocations_layout_widths(browser, app_url):
    alloc, store, drop, sn = allocation_page(app_url)
    jonas = staff(app_url, JONAS)
    asking = new_stockist(jonas)
    ok(request(jonas, drop["id"], asking["id"], [(sn, 2)]), 201)
    failures = []
    with signed_in(browser, app_url, JONAS, f"/studio/allocations/{alloc['id']}") as page:
        sees(page, heading(page, f"Allocation · {store['name']}"))
        save = page.get_by_role("button", name="Save allocation")
        at_width(page, PHONE_EDGE)
        soft_layout(failures, page, "767 px", lambda: in_bottom_bar(page, save))
        at_width(page, TABLET_EDGE)
        soft_layout(failures, page, "768 px", lambda: inline_in_content(page, save))
        page.goto(f"{app_url}/studio/drops/{drop['id']}/allocations")
        press(page.get_by_role("button", name="Split edition"))
        split = page.get_by_role("dialog", name="Split edition").get_by_role("table", name="Proposed split")
        sees(page, split)
        proposal = next(i for i in ok(jonas.get(f"/api/drops/{drop['id']}/split"))["items"] if i["stockistId"] == asking["id"])
        share = line_of(proposal, sn)["allocatedQuantity"]
        row = split.get_by_role("row").filter(has_text=asking["name"])
        sees(page, row)
        assert re.search(rf"(?<!\d){share}(?!\d)", row.inner_text().replace(asking["name"], " ")), row.inner_text()
    report(failures)


def test_wf_wholesale_invoicing_layout_widths(browser, app_url):
    alloc, store, _, _ = allocation_page(app_url)
    failures = []
    with signed_in(browser, app_url, SOFIE, f"/studio/allocations/{alloc['id']}") as page:
        sees(page, heading(page, f"Allocation · {store['name']}"))
        confirm_button = page.get_by_role("button", name="Confirm allocation")
        at_width(page, PHONE_EDGE)
        soft_layout(failures, page, "767 px", lambda: in_bottom_bar(page, confirm_button))
        at_width(page, TABLET_EDGE)
        soft_layout(failures, page, "768 px", lambda: inline_in_content(page, confirm_button))
        press(confirm_button)
        dialog = page.get_by_role("dialog", name="Confirm allocation")
        sees(page, dialog.get_by_role("table", name="Quote"))
        expect(dialog.get_by_text(f"Prices from the list in force on {day_text(cph_today())}").first).to_be_visible()
    report(failures)


def test_wf_press_previews_live_dead_link(browser, app_url):
    ida, amir = staff(app_url, IDA), staff(app_url, AMIR)
    drop = create_drop(ida)
    failures = []

    def follows(change, copy):
        preview = new_preview(amir, drop["id"])
        with open_app(browser, f"{app_url}{preview['link']}") as page:
            sees(page, heading(page, f"Press preview: {drop['name']}"))
            path = urlparse(page.url).path
            change(preview)
            advance(page, PRESS_FOLLOW_MS)
            sees(page, heading(page, "This preview is no longer available"))
            expect(page.get_by_text(copy).first).to_be_visible()
            assert urlparse(page.url).path == path, page.url

    def skewed():
        preview = new_preview(amir, drop["id"])
        with open_app(browser, "about:blank") as page:
            page.clock.set_system_time(datetime.now(timezone.utc) + EXPIRY_SKEW)
            page.goto(f"{app_url}{preview['link']}")
            sees(page, heading(page, f"Press preview: {drop['name']}"))
            advance(page, PRESS_FOLLOW_MS)
            sees(page, heading(page, f"Press preview: {drop['name']}"))
    soft(failures, "revoked", lambda: follows(lambda p: ok(amir.post(f"/api/previews/{p['id']}/revoke")),
                                              "This preview link was revoked by the press team."))
    soft(failures, "replaced", lambda: follows(lambda p: ok(amir.post(f"/api/previews/{p['id']}/regenerate")),
                                               "This preview link was replaced by a newer one. Check your inbox."))
    soft(failures, "device clock past the expiry", skewed)
    report(failures)


def test_wf_go_live_hold_countdown_server_clock(browser, app_url, mail):
    member = unique("vip")
    _, drop = live_drop(app_url, 1, vip=[member])
    token = link_token(inbox(mail, member[1], subject=f"A piece of {drop['name']} is held for you")[0], "/claim/")
    expires = parse_instant(ok(httpx.get(f"{app_url}/api/public/holds/{token}"))["expiresAt"])
    with open_app(browser, "about:blank") as page:
        page.clock.set_system_time(datetime.now(timezone.utc) + CLOCK_SKEW)
        opened = datetime.now(timezone.utc)
        page.goto(f"{app_url}/claim/{token}")
        loaded_ms = page.evaluate("Date.now()")
        sees(page, heading(page, "Your held piece"))
        timer = page.get_by_role("timer", name="Hold ends in")
        eventually(page, lambda: expect(timer).to_contain_text(COUNTDOWN, timeout=QUICK_MS))

        def counts_by_the_server():
            text = timer.text_content() or ""
            read = datetime.now(timezone.utc)
            advanced = (page.evaluate("Date.now()") - loaded_ms) / 1000
            shown = countdown_seconds(text)
            low = (expires - read).total_seconds() - COUNTDOWN_BAND_S - advanced
            high = (expires - opened).total_seconds() + COUNTDOWN_BAND_S
            assert low <= shown <= high, (text, round(low), round(high))
        eventually(page, counts_by_the_server)
