import csv
import io
import json
import os
import re
import socket
import subprocess
import threading
import time
import uuid
from contextlib import closing, contextmanager, suppress
from datetime import date, timedelta
from http.cookies import SimpleCookie
from pathlib import Path
from select import select as wait_readable
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import expect

import conftest
from conftest import (
    S3,
    Postgres,
    advance,
    axe,
    capture,
    decode,
    difference,
    fill,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    settle,
    shipped_packages,
    style,
    until,
)

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEW_IDS = ["phone", "tablet", "desktop"]
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}

QUICK_MS = 150
CLICK_LIMIT_MS = 5000
ZOOM_PRESSES = 10
ACTION_TIMEOUT_MS = 5000
NAVIGATION_TIMEOUT_MS = 15000
CLOCK_LEAD_SECONDS = 10
STEP_MS = 200
FRAME_MS = 16
POLL_LIMIT_MS = 30000
GRACE_SECONDS = 5
HTTP_SECONDS = 30
RELAY_CHUNK = 65536
RELAY_TICK_SECONDS = 0.1
TAP_PX = 44
ENTRY_MS = 250
COLUMN_MIN_PX = 140
CHIP_MIN_PX = 120
OFFLINE_READY_MS = 3000
FILTER_MS = 200
SAVED_MS = 1000
QUEUED_SAVED_MS = 3000
TAB_LIMIT_MS = 2000
ONLINE_LIMIT_MS = 10000
LIFT_GAP_MS = 30
LAST_LIFT_MS = 600
CROSSFADE_MS = 120
DEAL_SPAN_MS = 1100
FILE_LIMIT = 5000000
CSV_LIMIT = 1000000
JSON_LIMIT = 5000000
FIT_MARGIN_PX = 40
ZOOM_MIN = 0.25
ZOOM_MAX = 4
SHARE_EXPIRY_DEADLINE = 15
SHORT_QUOTA = 1000
SEED_TOTAL = "393.95"
PASSWORD = "plain-long-pass-1"
APP_ROOT = Path("/app")
MOD = "Control"
ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "OFL-1.1"}
FOREIGN_ORIGIN = "http://elsewhere.example"
UNKNOWN_UUID = "00000000-0000-4000-8000-000000000000"
SEED_DOCS = [
    ("seed-welcome", "Welcome to Oddment", "", "guide", True,
     "Everything here lives on this device Write first and worry later. Each change is saved here before "
     "anything else happens. Try these Switch this page to the canvas Open this document The table stays put. "
     "The blocks move. Sign in only if you want a second device."),
    ("seed-lisbon", "Trip to Lisbon", "Plans", "travel", True,
     "Three days in Lisbon Tram 28 before nine Walk down through Alfama Stop at the viewpoint Still to book "
     "Ferry to Cacilhas Room near the river Bring shoes with grip."),
    ("seed-shelf", "Kitchen shelf ideas", "Plans", "home", False,
     "Measure the alcove twice. Options Oak board on brackets Steel rail with hooks"),
    ("seed-overview", "Household overview", "", "home", False, "Bills for the month, pulled from the table."),
    ("seed-note-05", "Library books to return", "", "reading", False, "Two books are due back on Saturday."),
    ("seed-note-06", "Birthday list", "", "family", False, "Ask what size the new gloves should be."),
    ("seed-note-07", "Garden jobs", "", "home", False, "Cut back the lavender before the first frost."),
    ("seed-note-08", "Recipes to try", "", "home", False, "Lentil soup with lemon, and the plum cake."),
    ("seed-note-09", "Car notes", "", "home", False, "Tyres were last rotated in the spring."),
    ("seed-note-10", "Books I lent", "", "reading", False, "The atlas is with the neighbours at number 12."),
    ("seed-note-11", "Packing list", "Plans", "travel", False, "Adapters, rain jacket, and the blue notebook."),
    ("seed-note-12", "Questions for the dentist", "", "family", False, "Ask about the crown on the upper left."),
]
SEED_TITLES = [row[1] for row in SEED_DOCS]
SHARE_PATH = f"/api/documents/{SEED_DOCS[1][0]}/share"
BILLS_NAME = "Household bills"
BILL_COLUMNS = ["Name", "Amount", "Due", "Paid", "Category"]
FILTER_NAME = "Packing view"
FORMULA_HEAD = "=Head"
FORMULA_OPTION = "=Opt"
FORMULA_AMOUNT = -5
WHEN, DONE, KIND, MEMO = "When", "Done", "Kind", "Memo"
RAIL, ROAD = "Rail", "Road"
PORTO, FARO = "Porto", "Faro"
DRAFT = "Broadband draft"
CORS_HEADER = "access-control-allow-origin"
FLIGHT_POINTS = 24
WELCOME = [
    ("Heading 1", "Everything here lives on this device"),
    ("Paragraph", "Write first and worry later. Each change is saved here before anything else happens."),
    ("Heading 2", "Try these"),
    ("To-do", "Switch this page to the canvas"),
    ("To-do", "Open this document"),
    ("Quote", "The table stays put. The blocks move."),
    ("Divider", ""),
    ("Paragraph", "Sign in only if you want a second device."),
]
TEMPLATES = [
    ("Daily note", "Journal", "A short note for one day.",
     [("Heading 2", "Today"), ("To-do", "One thing to finish"), ("Heading 2", "Notes"), ("Paragraph", "")]),
    ("Weekly review", "Journal", "Look back at the week in ten minutes.",
     [("Heading 2", "What went well"), ("Paragraph", ""), ("Heading 2", "What to change"),
      ("To-do", "Pick one change for next week")]),
    ("Meeting notes", "Planning", "Who came, what was decided, what is next.",
     [("Heading 2", "Who was there"), ("Bulleted list", "Name"), ("Heading 2", "Decisions"), ("To-do", "Next step")]),
    ("Trip plan", "Planning", "Travel, beds and bookings on one page.",
     [("Heading 2", "Getting there"), ("Heading 2", "Where to stay"), ("To-do", "Book the first night")]),
    ("Book notes", "Reading", "Keep the lines and thoughts from a book.",
     [("Heading 2", "Why I picked it up"), ("Quote", "A line worth keeping"), ("Heading 2", "What stays with me")]),
    ("Reading list", "Reading", "Books to read next, ticked off as you go.",
     [("To-do", "First book on the list"), ("To-do", "Second book on the list")]),
]
BILLS = [
    ("Electricity", "64.20", "2026-11-03", "false", "Home"),
    ("Water", "31.75", "2026-11-05", "true", "Home"),
    ("Broadband", "39.00", "2026-11-07", "false", "Home"),
    ("Library fine", "2.40", "2026-11-09", "true", "Leisure"),
    ("Train pass", "88.00", "2026-11-12", "false", "Travel"),
    ("Gym", "27.50", "2026-11-15", "false", "Leisure"),
    ("Ferry tickets", "46.10", "2026-11-21", "false", "Travel"),
    ("Boiler service", "95.00", "2026-11-28", "false", "Home"),
]
MAIN_ROUTES = [
    "/", "/trash", "/doc/seed-welcome", "/doc/seed-welcome?view=canvas", "/records",
    "/records/seed-bills", "/records/seed-bills?view=board", "/journal", "/templates", "/settings",
]
NAV_LINKS = ["Documents", "Journal", "Records", "Templates", "Trash", "Settings"]
HAS_FOCUS = "el => el === document.activeElement || el.contains(document.activeElement)"
ENTRY_WATCH = """() => {
  if (window.__entries) return;
  window.__entries = [];
  const note = animation => {
    const target = animation.effect && animation.effect.target;
    const ms = animation.effect ? animation.effect.getComputedTiming().endTime : 0;
    if (target && ms > 0) window.__entries.push({target, ms});
  };
  for (const kind of ['animationstart', 'transitionrun']) {
    document.addEventListener(kind, event => event.target.getAnimations().forEach(note), true);
  }
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) {
    const made = animate.apply(this, args);
    note(made);
    return made;
  };
}"""
ENTERED = """(panel, limit) => {
  const box = panel.getBoundingClientRect();
  const large = el => {
    const r = el.getBoundingClientRect();
    return r.width * r.height >= box.width * box.height / 2;
  };
  return window.__entries.some(({target, ms}) => ms <= limit && target !== document.body
    && target !== document.documentElement
    && (target === panel || target.contains(panel) || (panel.contains(target) && large(target))));
}"""
PANEL_STATE = """el => {
  const r = el.getBoundingClientRect();
  return [Math.round(r.x), Math.round(r.y), getComputedStyle(el).opacity];
}"""
FINGER_ZONE = """(el, reach) => {
  const zones = [el, ...(el.labels || [])];
  const area = each => { const r = each.getBoundingClientRect(); return r.width * r.height; };
  const zone = zones.reduce((best, each) => (area(each) > area(best) ? each : best));
  zone.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const r = zone.getBoundingClientRect();
  const x = r.x + r.width / 2;
  const y = r.y + r.height / 2;
  const fits = [[-reach, 0], [reach, 0], [0, -reach], [0, reach]].every(([dx, dy]) => {
    const hit = document.elementFromPoint(x + dx, y + dy);
    return !!hit && zones.some(each => each === hit || each.contains(hit));
  });
  return {x, y, fits};
}"""
CLOSED_PANEL = """el => !!el.closest('[inert]')
  || !el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})"""
FOCUSED_COLUMN = """() => {
  const el = document.activeElement;
  const cell = el && el.closest('[role="gridcell"], td');
  return cell ? [...cell.parentElement.children].indexOf(cell) : null;
}"""
FOCUS_CELL = "cell => (cell.tabIndex >= 0 ? cell : cell.querySelector('a, button, [tabindex]') || cell).focus()"
FOCUS_MARK = """() => {
  const seen = el => { const s = getComputedStyle(el);
    return (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none'; };
  const el = document.activeElement;
  return !!el && (seen(el) || (!!el.parentElement && seen(el.parentElement)));
}"""
FOCUS_STOP = """() => {
  const el = document.activeElement;
  if (!el || el === document.body || el === document.documentElement) return false;
  window.__focusSeen = window.__focusSeen || new WeakSet();
  if (window.__focusSeen.has(el)) return false;
  window.__focusSeen.add(el);
  return true;
}"""
ANNOUNCE_LOG = """() => {
  if (window.__statusLog) return;
  window.__statusLog = [];
  new MutationObserver(records => {
    for (const record of records) {
      const from = record.target.nodeType === 1 ? record.target : record.target.parentElement;
      const region = from && from.closest('[role="status"], output');
      if (region && !region.hasAttribute('data-sync-state')) window.__statusLog.push(region.textContent);
    }
  }).observe(document, {subtree: true, childList: true, characterData: true});
}"""
BOARD_REVEAL = """grip => {
  let el = grip.parentElement;
  while (el && !(el.scrollWidth > el.clientWidth + 1 && /auto|scroll/.test(getComputedStyle(el).overflowX))) {
    el = el.parentElement;
  }
  if (!el) return;
  el.style.scrollSnapType = 'none';
  const edge = Math.min(el.getBoundingClientRect().right, window.innerWidth);
  const left = el.scrollLeft + grip.getBoundingClientRect().right + 8 - edge;
  el.scrollTo({left, behavior: 'instant'});
}"""
GRIP_HIT = """el => {
  const r = el.getBoundingClientRect();
  const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2);
  return !!hit && (hit === el || el.contains(hit));
}"""
DROP_POINT = """(target, y) => {
  const r = target.getBoundingClientRect();
  for (const row of [y, r.top + r.height / 2, r.top + 16]) {
    const hits = [];
    for (let x = Math.max(r.left + 2, 0); x < Math.min(r.right, window.innerWidth); x += 6) {
      const el = document.elementFromPoint(x, row);
      if (el && target.contains(el)) hits.push(x);
    }
    if (hits.length) return [hits[hits.length >> 1], row];
  }
  return null;
}"""
SCROLL_BESIDE_SEARCH = """(el, search) => {
  const top = el === document.scrollingElement ? 0 : el.getBoundingClientRect().top;
  el.scrollTop = Math.min(30, Math.max(search.getBoundingClientRect().top - top, 8));
  return el.scrollTop;
}"""
BLOCK_PROBE = """ids => ids.map(id => {
  const el = [...document.querySelectorAll(`[data-block-id="${id}"]`)].find(e => e.getClientRects().length
    && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const moving = el.getAnimations({subtree: true}).filter(a => a.playState === 'running' && a.effect
    && a.effect.getKeyframes().some(k => 'transform' in k || 'translate' in k || 'left' in k || 'top' in k));
  return {x: r.x, y: r.y, delay: moving.length ? Math.min(...moving.map(a => a.effect.getTiming().delay || 0)) : null};
})"""
PRESS_IN_FLIGHT = """async ([id, control, surface, home, least]) => {
  const rect = () => {
    const el = [...document.querySelectorAll(`[data-block-id="${id}"]`)].find(e => e.getClientRects().length
    && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}));
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return {x: r.x, y: r.y};
  };
  const before = rect();
  if (!before || Math.hypot(before.x - home[0], before.y - home[1]) < least) return null;
  control.click();
  await new Promise(done => {
    const channel = new MessageChannel();
    channel.port1.onmessage = done;
    channel.port2.postMessage(0);
  });
  return {before, after: rect(), state: surface.getAttribute('data-view-state')};
}"""
TRAVEL_PROBE = """() => document.getAnimations().filter(a => a.effect && a.effect.getKeyframes()
  .some(k => 'transform' in k || 'translate' in k || 'left' in k || 'top' in k)
  ) .filter(a => a.effect.target && a.effect.target.closest('[data-block-id]')).length"""
EMPTY_POINT = """region => {
  const r = region.getBoundingClientRect();
  for (let y = r.top + 12; y < r.bottom - 90; y += 12) for (let x = r.left + 60; x < r.right - 60; x += 12) {
    const el = document.elementFromPoint(x, y);
    if (el && region.contains(el) && !el.closest('[data-block-id]') && !el.closest('button')) return [x, y];
  }
  return null;
}"""
SCROLLER = """list => { let el = list;
  while (el && el !== document.body
         && !(/auto|scroll/.test(getComputedStyle(el).overflowY) && el.scrollHeight > el.clientHeight)) {
    el = el.parentElement;
  }
  return el && el !== document.body ? el : document.scrollingElement; }"""

ROOT_ATTR = "name => document.documentElement.getAttribute(name)"
VISIBLE_BLOCKS = """() => [...document.querySelectorAll('[data-block-id]')]
  .filter(e => e.getClientRects().length)
  .map(e => ({id: e.getAttribute('data-block-id'), type: e.getAttribute('data-block-type'),
              indent: e.getAttribute('data-indent')}))"""
BLOCK_RECT = """id => {
  const el = [...document.querySelectorAll(`[data-block-id="${id}"]`)].find(e => e.getClientRects().length
    && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}));
  if (!el) return null;
  const r = el.getBoundingClientRect();
  return {x: r.x, y: r.y};
}"""
CONNECTORS = """() => [...document.querySelectorAll('[data-connector-id]')]
  .map(e => ({from: e.getAttribute('data-from'), to: e.getAttribute('data-to')}))"""
FLIGHT_SEEK = """([id, points]) => {
  const el = [...document.querySelectorAll(`[data-block-id="${id}"]`)].find(e => e.getClientRects().length
    && e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}));
  if (!el) return [];
  const group = document.getAnimations().filter(a => a.effect && a.effect.target
    && (a.effect.target === el || el.contains(a.effect.target) || a.effect.target.contains(el))
    && a.effect.getKeyframes().some(k => 'transform' in k || 'translate' in k || 'left' in k || 'top' in k));
  if (!group.length) return [];
  const plans = group.map(a => {
    const rate = a.playbackRate < 0 ? -1 : 1;
    const start = a.currentTime || 0;
    const stop = rate < 0 ? 0 : a.effect.getComputedTiming().endTime;
    return {a, rate, start, span: Math.abs(stop - start)};
  });
  const longest = Math.max(...plans.map(p => p.span));
  plans.forEach(p => p.a.pause());
  const path = [];
  for (let i = 0; i <= points; i++) {
    const t = longest * i / points;
    plans.forEach(p => { p.a.currentTime = p.start + p.rate * Math.min(t, p.span); });
    const r = el.getBoundingClientRect();
    path.push({x: r.x, y: r.y});
  }
  plans.forEach(p => p.a.finish());
  return path;
}"""

expect.set_options(timeout=QUICK_MS)


def poll(pages, check, limit_ms=POLL_LIMIT_MS, step_ms=STEP_MS):
    group = pages if isinstance(pages, (list, tuple)) else [pages]
    spent = 0
    deadline = None
    while True:
        try:
            return check()
        except (AssertionError, PlaywrightError):
            if spent >= limit_ms:
                deadline = deadline or time.monotonic() + GRACE_SECONDS
                if time.monotonic() > deadline:
                    raise
        if spent < limit_ms:
            for each in group:
                advance(each, step_ms)
            spent += step_ms


def steady(locator):
    assert locator.bounding_box() == locator.bounding_box(), "still moving"


def click(locator):
    def press():
        steady(locator)
        conftest.click(locator)
    poll(locator.page, press, CLICK_LIMIT_MS)


def tap(locator):
    def press():
        steady(locator)
        conftest.tap(locator)
    poll(locator.page, press, CLICK_LIMIT_MS)


def layout(page):
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and not control.evaluate("el => !!el.closest('[inert]')"):
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            size = control.bounding_box()
            assert size and size["x"] >= -1 and size["x"] + size["width"] <= page.viewport_size["width"] + 1


def closed(page, panel):
    def check():
        for index in range(panel.count()):
            assert panel.nth(index).evaluate(CLOSED_PANEL)
    poll(page, check)
    advance(page, ENTRY_MS)


def unreachable(page, marker):
    def check():
        names = ax_links(page) if marker in NAV_LINKS else ax_names(page)
        assert marker not in names, marker
        assert marker not in tab_order(page, 12), marker
    poll(page, check, ENTRY_MS)


def tab_order(page, presses):
    return [name.split("\n")[0] for name in conftest.tab_order(page, presses)]


def see(page, locator, limit_ms=POLL_LIMIT_MS):
    poll(page, lambda: expect(locator).to_be_visible(), limit_ms)


def reads(page, locator, text, limit_ms=POLL_LIMIT_MS):
    poll(page, lambda: expect(locator).to_have_text(text), limit_ms)


def gone(page, locator, limit_ms=POLL_LIMIT_MS):
    poll(page, lambda: expect(locator).to_have_count(0), limit_ms)


def focused(page, locator, limit_ms=POLL_LIMIT_MS):
    poll(page, lambda: expect(locator).to_be_focused(), limit_ms)


def attribute(page, locator, name, value, limit_ms=POLL_LIMIT_MS):
    poll(page, lambda: expect(locator).to_have_attribute(name, value), limit_ms)


def announcements(page):
    return page.get_by_role("status", name="Announcements", exact=True)


def announced(page, text, limit_ms=POLL_LIMIT_MS):
    def check():
        if not any(text in entry for entry in page.evaluate("() => window.__statusLog || []")):
            expect(announcements(page)).to_contain_text(text)
    poll(page, check, limit_ms)


def forget(page):
    page.evaluate("() => { window.__statusLog = []; }")


def sync_status(page):
    return page.get_by_role("status", name="Sync status", exact=True)


def sentence(page, text, state, limit_ms=POLL_LIMIT_MS):
    def check():
        expect(sync_status(page)).to_have_text(text)
        expect(sync_status(page)).to_have_attribute("data-sync-state", state)
    poll(page, check, limit_ms)


def origin(page):
    parts = urlparse(page.url)
    return f"{parts.scheme}://{parts.netloc}"


def path_of(page):
    return urlparse(page.url).path


def query_of(page):
    return {key: values[0] for key, values in parse_qs(urlparse(page.url).query).items()}


def visit(page, path):
    page.goto(origin(page) + path)
    advance(page, STEP_MS)


def reload(page):
    page.reload()
    advance(page, STEP_MS)


def doc_count(page):
    return page.get_by_role("status", name="Document count", exact=True)


def rows(page):
    return page.get_by_role("list", name="Documents", exact=True).get_by_role("listitem")


def button(scope, name):
    return scope.get_by_role("button", name=name, exact=True)


def link(scope, name):
    return scope.get_by_role("link", name=name, exact=True)


def block_name(label, text=""):
    return f"{label}: {text[:40]}" if text else label


def box(page, name):
    return page.get_by_role("textbox", name=name, exact=True)


def maybe_unsynced(scope, name):
    return scope.get_by_role("textbox", name=re.compile(f"^{re.escape(name)}(, not yet synced)?$"))


def block(page, name):
    return box(page, name).or_(page.get_by_role("group", name=name, exact=True))


def blocks(page):
    return page.evaluate(VISIBLE_BLOCKS)


def block_rect(page, block_id):
    return page.evaluate(BLOCK_RECT, block_id)


def indented(page, block_id, value):
    def check():
        assert {item["id"]: item["indent"] for item in blocks(page)}.get(block_id) == value
    poll(page, check)


def root_is(page, name, value, limit_ms=POLL_LIMIT_MS):
    def check():
        assert page.evaluate(ROOT_ATTR, name) == value
    poll(page, check, limit_ms)


def connectors(page):
    return page.evaluate(CONNECTORS)


def linked(page, start, end, either=False):
    pairs = [(item["from"], item["to"]) for item in connectors(page)]
    assert (start, end) in pairs or (either and (end, start) in pairs), pairs


def flight(page, block_id, span_ms):
    path = []
    spent = 0
    while spent <= span_ms:
        seeked = page.evaluate(FLIGHT_SEEK, [block_id, FLIGHT_POINTS])
        if seeked:
            return path + seeked
        rect = block_rect(page, block_id)
        if rect:
            path.append(rect)
        advance(page, LIFT_GAP_MS)
        spent += LIFT_GAP_MS
    return path


def assert_blocks(page, names):
    def check():
        assert len(blocks(page)) == len(names), names
        tops = []
        for name in names:
            found = block(page, name)
            expect(found).to_have_count(1)
            tops.append(found.bounding_box()["y"])
        assert tops == sorted(tops), names
    poll(page, check)


def ready(page):
    until(page, "() => document.documentElement.getAttribute('data-offline-ready') === 'true'")


def offline_reload(page, path=None):
    ready(page)
    page.context.set_offline(True)
    if path:
        visit(page, path)
    else:
        reload(page)


def ax_nodes(page):
    return session(page).send("Accessibility.getFullAXTree")["nodes"]


def ax_links(page):
    found = []
    for node in ax_nodes(page):
        if not node.get("ignored") and node.get("role", {}).get("value") == "link":
            found.append(node.get("name", {}).get("value", ""))
    return found


def ax_names(page):
    return [n.get("name", {}).get("value", "") for n in ax_nodes(page) if not n.get("ignored")]


def tap_size(locator):
    size = locator.bounding_box()
    assert size["height"] >= TAP_PX and size["width"] >= TAP_PX, size


def tap_height(locator):
    assert locator.bounding_box()["height"] >= TAP_PX


def pick(radio):
    expect(radio).to_be_enabled()
    radio.evaluate("el => el.click()")


def holds_focus(page, locator):
    def check():
        assert locator.evaluate(HAS_FOCUS)
    poll(page, check)


def shown(page, text):
    def check():
        outside = page.get_by_text(text, exact=True).evaluate_all(
            "(found, region) => found.filter(e => e !== region && !region.contains(e)).length",
            announcements(page).element_handle())
        assert outside >= 1, text
    poll(page, check)


def came_in(page, panel):
    poll(page, lambda: expect(panel).to_have_count(1), STEP_MS, FRAME_MS)
    first = panel.evaluate(PANEL_STATE)

    def check():
        assert panel.evaluate(ENTERED, ENTRY_MS) or panel.evaluate(PANEL_STATE) != first
    poll(page, check, ENTRY_MS, FRAME_MS)


def finger_toggle(page, done):
    zone = done.evaluate(FINGER_ZONE, TAP_PX / 2 - 1)
    assert zone["fits"], zone
    after = not done.is_checked()
    page.touchscreen.tap(zone["x"], zone["y"])
    poll(page, lambda: expect(done).to_be_checked(checked=after))
    return after


def trapped(page, dialog, stops):
    holds_focus(page, dialog)
    for key in ("Tab", "Shift+Tab"):
        for _ in range(stops * 2 + 1):
            page.keyboard.press(key)
            assert dialog.evaluate(HAS_FOCUS), key


def chosen(locator):
    return locator.evaluate(
        "el => (el.selectedOptions && el.selectedOptions[0] ? el.selectedOptions[0].text : el.textContent).trim()"
    )


def choose_slash(page, query):
    page.keyboard.type("/" + query)
    advance(page, STEP_MS)
    see(page, page.get_by_role("listbox", name="Insert block", exact=True))
    page.keyboard.press("Enter")
    advance(page, STEP_MS)


def new_document(page, title, text=""):
    click(button(page, "New document"))
    title_box = box(page, "Document title")
    focused(page, title_box)
    page.keyboard.type(title)
    page.keyboard.press("Enter")
    focused(page, box(page, "Paragraph"))
    if text:
        page.keyboard.type(text)
        see(page, box(page, block_name("Paragraph", text)))
    return path_of(page).split("/")[-1]


def attach(page, name, content=b"oddment attachment bytes", mime="text/plain"):
    focused(page, box(page, "Paragraph"))
    choose_slash(page, "File")
    page.get_by_label("Attach a file").set_input_files({"name": name, "mimeType": mime, "buffer": content})
    advance(page, STEP_MS)


def fresh_email():
    return f"{uuid.uuid4().hex}@example.test"


def device_label(number):
    return f"Device {number}"


def welcome_block(number):
    return f"seed-welcome-{number}"


def rows_label(number):
    return f"{number} rows"


def import_summary(imported, skipped):
    return f"Imported {imported} rows. Skipped {skipped} rows."


def fresh_label(prefix):
    return f"{prefix} {uuid.uuid4().hex[:10]}"


@contextmanager
def device(browser, url, viewport=DESKTOP, reduced_motion="no-preference"):
    context = browser.new_context(viewport=viewport, has_touch=True, reduced_motion=reduced_motion,
                                  service_workers="allow")
    with closing(context):
        context.add_init_script(path=conftest.HERE / "instrument.js")
        context.add_init_script(f"({ANNOUNCE_LOG})()")
        page = context.new_page()
        page.set_default_timeout(ACTION_TIMEOUT_MS)
        page.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)
        now = int(time.time())
        page.clock.install(time=now)
        page.clock.pause_at(now + CLOCK_LEAD_SECONDS)
        page.goto(url)
        if urlparse(url).path in ("", "/"):
            see(page, doc_count(page))
        yield page


def account_dialog(page, email, action, password=PASSWORD):
    click(button(page, "Sign in"))
    dialog = page.get_by_role("dialog", name="Sign in", exact=True)
    see(page, dialog)
    fill(dialog.get_by_role("textbox", name="Email"), email)
    fill(dialog.get_by_label("Password"), password)
    click(button(dialog, action))
    return dialog


def join(page, email, action="Create account", choice="Upload this workspace"):
    account_dialog(page, email, action)
    dialog = page.get_by_role("dialog", name="Upload this workspace?", exact=True)
    see(page, dialog)
    click(button(dialog, choice))
    gone(page, dialog)
    if choice == "Upload this workspace":
        sentence(page, "All changes are synced.", "synced")


@contextmanager
def pair(browser, url):
    with device(browser, url) as first, device(browser, url) as second:
        email = fresh_email()
        join(first, email)
        join(second, email, "Sign in")
        yield first, second, email


def client_for(page):
    cookie = next(c for c in page.context.cookies() if c["name"] == "oddment_session")
    return httpx.Client(
        base_url=origin(page), timeout=HTTP_SECONDS, headers={"cookie": f"oddment_session={cookie['value']}"}
    )


def session_cookie(response):
    for header in response.headers.get_list("set-cookie"):
        parsed = SimpleCookie(header)
        if "oddment_session" in parsed:
            return header, parsed["oddment_session"].value
    raise AssertionError("no oddment_session cookie")


def api(base, email=None, path="/api/accounts"):
    plain = httpx.Client(base_url=base, timeout=HTTP_SECONDS)
    answer = plain.post(path, json={"email": email or fresh_email(), "password": PASSWORD})
    assert answer.status_code in (200, 201), answer.text
    _, token = session_cookie(answer)
    return (
        httpx.Client(base_url=base, timeout=HTTP_SECONDS, headers={"cookie": f"oddment_session={token}"}),
        answer.json(),
    )


def put_file(client, attachment_id, content, document_id="doc-1", name="note%20one.txt", mime="text/plain"):
    headers = {"Content-Type": mime, "X-File-Name": name}
    if document_id:
        headers["X-Document-Id"] = document_id
    return client.put(f"/api/attachments/{attachment_id}", content=content, headers=headers)


def tables_holding(db, text):
    found = []
    hexed = text.encode().hex()
    for table in db.tables():
        quoted = '"' + table.replace(".", '"."') + '"'
        sql = f"SELECT count(*) AS n FROM {quoted} AS r WHERE r::text LIKE '%{text}%' OR r::text LIKE '%{hexed}%'"
        if db.rows(sql)[0]["n"]:
            found.append(table)
    return found


def at(point):
    return point.get("x", point.get("left")), point.get("y", point.get("top"))


def distance(one, two):
    return ((one[0] - two[0]) ** 2 + (one[1] - two[1]) ** 2) ** 0.5


def canvas(page):
    return page.get_by_role("region", name="Canvas", exact=True)


def table_surface(page):
    return page.get_by_role("region", name="Table", exact=True)


def view_state(page, state):
    surface = table_surface(page)

    def check():
        settle(surface)
        expect(surface).to_have_attribute("data-view-state", state)
    poll(page, check)


def card(page, name):
    return button(page, name)


def world(locator):
    return float(locator.get_attribute("data-world-x")), float(locator.get_attribute("data-world-y"))


def camera_of(page):
    region = canvas(page)
    return tuple(float(region.get_attribute(k)) for k in ("data-zoom", "data-pan-x", "data-pan-y"))


def assert_screen_rule(page, locator):
    region = canvas(page).bounding_box()
    zoom, pan_x, pan_y = camera_of(page)
    x, y = world(locator)
    size = locator.bounding_box()
    assert abs(size["x"] - (region["x"] + x * zoom + pan_x)) <= 1
    assert abs(size["y"] - (region["y"] + y * zoom + pan_y)) <= 1


def lift_order(page, ids):
    base = page.evaluate(BLOCK_PROBE, ids)
    starts = {}
    elapsed = 0
    while len(starts) < len(ids) and elapsed <= LAST_LIFT_MS + 2 * LIFT_GAP_MS:
        for item, before, now in zip(ids, base, page.evaluate(BLOCK_PROBE, ids)):
            if item in starts or not before or not now:
                continue
            if now["delay"] is not None:
                starts[item] = elapsed + now["delay"]
            elif distance((before["x"], before["y"]), (now["x"], now["y"])) > 0.5:
                starts[item] = elapsed
        advance(page, LIFT_GAP_MS)
        elapsed += LIFT_GAP_MS
    return starts


def touch(page, kind, points):
    session(page).send(
        "Input.dispatchTouchEvent",
        {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]},
    )


def glide(page, start, end, steps=6):
    touch(page, "touchStart", start)
    for step in range(1, steps + 1):
        share = step / steps
        moved = [(a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share) for a, b in zip(start, end)]
        touch(page, "touchMove", moved)
        advance(page, 20)
    touch(page, "touchEnd", [])
    advance(page, STEP_MS)


def middle(locator):
    size = locator.bounding_box()
    return size["x"] + size["width"] / 2, size["y"] + size["height"] / 2


def cell(page, text):
    return page.get_by_role("gridcell", name=text, exact=True)


def total(page, column="Amount"):
    return page.get_by_role("gridcell", name=f"Total {column}", exact=True)


def row_count(page):
    return page.get_by_role("status", name="Row count", exact=True)


def board_card(page, group, title):
    return page.get_by_role("group", name=group, exact=True).get_by_role("button", name=title, exact=True)


def add_column(page, name, kind, options=""):
    click(button(page, "Add column"))
    dialog = page.get_by_role("dialog", name="Add column", exact=True)
    see(page, dialog)
    fill(dialog.get_by_role("textbox", name="Column name"), name)
    select(dialog.get_by_role("combobox", name="Column type"), kind)
    if options:
        fill(dialog.get_by_role("textbox", name="Options"), options)
    click(button(dialog, "Add column"))
    gone(page, dialog)


def on_column(page, number):
    def check():
        assert page.evaluate(FOCUSED_COLUMN) == number
    poll(page, check)


def enter_row(page, values):
    click(button(page, "Add row"))
    advance(page, STEP_MS)
    for number, value in enumerate(values):
        on_column(page, number)
        if value is not None:
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
            if isinstance(value, list):
                select(page.get_by_role("combobox", name=value[0], exact=True), value[1])
            else:
                page.keyboard.type(value)
            page.keyboard.press("Tab")
        else:
            page.keyboard.press("ArrowRight")
        advance(page, STEP_MS)


def new_table(page, name):
    visit(page, "/records")
    click(button(page, "New table"))
    title = box(page, "Table name")
    focused(page, title)
    fill(title, name)
    page.keyboard.press("Tab")
    see(page, page.get_by_role("grid", name=name, exact=True))


def export_csv(page):
    with page.expect_download() as caught:
        click(button(page, "Export CSV"))
    download = caught.value
    return download.suggested_filename, Path(download.path()).read_bytes().decode("utf-8-sig")


def import_csv(page, content):
    click(button(page, "Import CSV"))
    dialog = page.get_by_role("dialog", name="Import CSV", exact=True)
    see(page, dialog)
    dialog.get_by_label("Choose CSV file").set_input_files(
        {"name": "records.csv", "mimeType": "text/csv", "buffer": content.encode()}
    )
    advance(page, STEP_MS)
    click(button(dialog, "Import"))
    return dialog.get_by_role("region", name="Import result", exact=True)


def long_date(day):
    return f"{day:%A}, {day:%B} {day.day}, {day.year}"


def local_day(page):
    return date.fromisoformat(page.evaluate(
        "() => { const d = new Date(); const p = n => String(n).padStart(2, '0');"
        " return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; }"
    ))


def day_cell(page, day):
    return page.get_by_role("grid", name="Calendar", exact=True).get_by_role(
        "gridcell", name=re.compile("^" + re.escape(long_date(day)))
    )


def journal_note(page):
    return page.get_by_role("region", name="Journal note", exact=True)


def assert_template_once(page):
    def check():
        note = journal_note(page)
        for name in ("Heading 2: Today", "To-do: One thing to finish", "Heading 2: Notes"):
            expect(maybe_unsynced(note, name)).to_have_count(1)
    poll(page, check)


def go_offline_edit(page, path, name, value):
    ready(page)
    page.context.set_offline(True)
    visit(page, path)
    fill(box(page, name), value)
    see(page, box(page, f"{block_name('Paragraph', value)}, not yet synced"))


def conflict(first, second, doc, original, value_one, value_two):
    go_offline_edit(first, f"/doc/{doc}", original, value_one)
    go_offline_edit(second, f"/doc/{doc}", original, value_two)
    first.context.set_offline(False)
    sentence(first, "All changes are synced.", "synced")
    second.context.set_offline(False)
    for page in (first, second):
        poll([first, second], lambda page=page: expect(
            page.get_by_role("group", name="Both kept", exact=True)).to_be_visible(), ONLINE_LIMIT_MS)


@contextmanager
def outage_proxy(target):
    rules = {}
    address = urlparse(target)
    stopping = threading.Event()

    def canned(path):
        return next((rule for prefix, rule in list(rules.items()) if path.startswith(prefix)), None)

    def answer(client, method, head, early, rule):
        length = re.search(rb"(?im)^content-length:\s*(\d+)", head)
        remaining = int(length.group(1)) - len(early) if length else 0
        while remaining > 0:
            data = client.recv(RELAY_CHUNK)
            if not data:
                break
            remaining -= len(data)
        body = rule[1].encode()
        start = (f"HTTP/1.1 {rule[0]} Relay\r\ncontent-type: application/json\r\n"
                 f"content-length: {len(body)}\r\nconnection: close\r\n\r\n")
        client.sendall(start.encode() + (b"" if method == "HEAD" else body))

    def tunnel(client, path, head, early):
        lines = head.split(b"\r\n")
        if not any(line.lower().startswith(b"upgrade:") for line in lines):
            kept = [line for line in lines if not line.lower().startswith(b"connection:")]
            lines = [kept[0], b"connection: close", *kept[1:]]
        with socket.create_connection((address.hostname, address.port or 80), HTTP_SECONDS) as upstream:
            upstream.settimeout(None)
            upstream.sendall(b"\r\n".join(lines) + b"\r\n\r\n" + early)
            peers = {client: upstream, upstream: client}
            while not stopping.is_set() and not canned(path):
                for side in wait_readable(list(peers), [], [], RELAY_TICK_SECONDS)[0]:
                    data = side.recv(RELAY_CHUNK)
                    if not data:
                        return
                    peers[side].sendall(data)

    def serve(client):
        with client, suppress(OSError):
            data = b""
            while b"\r\n\r\n" not in data:
                piece = client.recv(RELAY_CHUNK)
                if not piece:
                    return
                data += piece
            head, _, early = data.partition(b"\r\n\r\n")
            method, path = head.decode("latin-1").split(" ", 2)[:2]
            rule = canned(path)
            if rule:
                answer(client, method, head, early, rule)
            else:
                tunnel(client, path, head, early)

    def accept(listener):
        while True:
            try:
                client, _ = listener.accept()
            except OSError:
                return
            threading.Thread(target=serve, args=(client,), daemon=True).start()

    listener = socket.create_server(("127.0.0.1", 0))
    threading.Thread(target=accept, args=(listener,), daemon=True).start()
    try:
        yield f"http://127.0.0.1:{listener.getsockname()[1]}", rules
    finally:
        stopping.set()
        listener.shutdown(socket.SHUT_RDWR)
        listener.close()


def outage_url(name):
    return os.environ[name].rstrip("/")


def test_wf_first_open_seed(browser, app_url):
    with device(browser, app_url) as page:
        sent = []
        page.on("request", lambda r: sent.append(r) if r.method != "GET" else None)
        assert path_of(page) == "/"
        reads(page, doc_count(page), "12 of 12 documents")
        expect(rows(page)).to_have_count(12)
        for index, title in enumerate(SEED_TITLES):
            expect(link(rows(page).nth(index), title)).to_be_visible()
        for doc_id, title, *_ in SEED_DOCS:
            assert urlparse(link(page, title).get_attribute("href")).path.endswith(f"/doc/{doc_id}")
        for _, title, _, _, starred, _ in SEED_DOCS:
            expect(page.get_by_role("button", name=f"Star {title}", exact=True, pressed=starred)).to_be_visible()
        expect(page.get_by_role("dialog")).to_have_count(0)
        expect(page.get_by_role("progressbar")).to_have_count(0)
        expect(button(page.get_by_role("banner"), "Sign in")).to_be_visible()
        expect(page.get_by_role("radio", name="List", exact=True)).to_be_checked()
        reads(page, sync_status(page), "This workspace is only on this device.")
        reload(page)
        reads(page, doc_count(page), "12 of 12 documents")
        visit(page, "/records")
        see(page, link(page, "Household bills"))
        gone(page, link(page, "Untitled table"))
        assert httpx.get(f"{app_url}/api/session", timeout=HTTP_SECONDS).json() == {}
        assert not [r for r in sent if "/api/" in r.url]


def test_wf_first_open_drawer_motion(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        nav = page.get_by_role("navigation", name="Workspace", exact=True)
        closed(page, nav)
        assert "Documents" not in tab_order(page, 12)
        page.evaluate(ENTRY_WATCH)
        click(button(page, "Open navigation"))
        came_in(page, nav)


def test_wf_first_open_offline(browser, app_url):
    with device(browser, app_url) as page:
        root_is(page, "data-offline-ready", "true", OFFLINE_READY_MS)
        offline_reload(page)
        reads(page, doc_count(page), "12 of 12 documents")
        expect(link(page, SEED_TITLES[-1])).to_be_visible()
        checks = {
            "/trash": page.get_by_text("Trash is empty.", exact=True),
            "/doc/seed-welcome": box(page, block_name(*WELCOME[0])),
            "/records": link(page, "Household bills"),
            "/records/seed-bills": cell(page, "Electricity"),
            "/journal": journal_note(page),
            "/templates": button(page, "Preview Daily note"),
            "/settings": page.get_by_role("radiogroup", name="Colour scheme", exact=True),
        }
        for route, marker in checks.items():
            visit(page, route)
            see(page, marker)
            expect(page.get_by_role("navigation", name="Workspace", exact=True)).to_be_visible()


def test_wf_first_open_keyboard(browser, app_url):
    with device(browser, app_url) as page:
        assert tab_order(page, 1) == ["Skip to main content"]
        skip = page.get_by_role("link", name="Skip to main content", exact=True)
        def on_screen():
            size = skip.bounding_box()
            assert size["x"] >= 0 and size["y"] >= 0
        poll(page, on_screen)
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        assert page.get_by_role("main").evaluate(HAS_FOCUS)
        expected = ["New document", "Search documents", "Folder filter", "Tag filter", "Saved filter",
                    "Save this filter", "List"]
        for title in SEED_TITLES:
            expected += [title, f"Star {title}", f"Actions for {title}"]
        assert tab_order(page, len(expected)) == expected


def test_wf_first_open_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        expect(button(page, "Open navigation")).to_be_visible()
        closed(page, page.get_by_role("navigation", name="Workspace", exact=True))
        assert not set(NAV_LINKS) & set(ax_links(page))
        order = tab_order(page, 14)
        assert not set(NAV_LINKS) & set(order), order
        layout(page)
        click(button(page, "Open navigation"))
        focused(page, link(page, "Documents"))


def test_wf_block_editing_mixed(browser, app_url):
    title = fresh_label("Mixed")
    with device(browser, app_url) as page:
        new_document(page, title)
        pieces = [("1", "Heading 1", "Top line"), ("2", "Heading 2", "Second line"),
                  ("3", "Heading 3", "Third line"), ("Paragraph", "Paragraph", "Plain line"),
                  ("Bulleted", "Bulleted list", "A bullet"), ("Numbered", "Numbered list", "A number"),
                  ("To-do", "To-do", "A task"), ("Quote", "Quote", "A quotation")]
        expected = []
        for option, label, text in pieces:
            focused(page, page.get_by_role("textbox", name=re.compile(r"^(Paragraph|Bulleted list|Numbered list|To-do|Quote)$")))
            choose_slash(page, option)
            page.keyboard.type(text)
            see(page, box(page, block_name(label, text)))
            expected.append(block_name(label, text))
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
            if label in ("Bulleted list", "Numbered list", "To-do"):
                focused(page, box(page, label))
                choose_slash(page, "Paragraph")
        focused(page, box(page, "Paragraph"))
        choose_slash(page, "Divider")
        focused(page, box(page, "Paragraph"))
        expected.append("Divider")
        choose_slash(page, "Record")
        focused(page, box(page, "Paragraph"))
        expected.append(block_name("Record table", "Untitled table"))
        expected.append("Paragraph")
        assert_blocks(page, expected)
        reload(page)
        assert_blocks(page, expected)
        types = [item["type"] for item in blocks(page)]
        assert types == ["heading1", "heading2", "heading3", "paragraph", "bulleted", "numbered", "todo",
                         "quote", "divider", "table", "paragraph"]
        table_block = block(page, block_name("Record table", "Untitled table"))
        expect(table_block).to_contain_text(rows_label(0))
        expect(link(page, "Open Untitled table")).to_be_visible()


def test_wf_block_editing_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/doc/seed-welcome")
        done = page.get_by_role("checkbox", name="Done", exact=True)
        see(page, done.first)
        layout(page)
        kinds = [item["type"] for item in blocks(page)]
        toggled = finger_toggle(page, done.first)
        advance(page, SAVED_MS)
        reload(page)
        see(page, done.first)
        expect(done.first).to_be_checked(checked=toggled)
        assert [item["type"] for item in blocks(page)] == kinds


def test_wf_block_editing_slash(browser, app_url):
    with device(browser, app_url) as page:
        new_document(page, fresh_label("Slash"))
        focused(page, box(page, "Paragraph"))
        page.keyboard.type("/")
        menu = page.get_by_role("listbox", name="Insert block", exact=True)
        see(page, menu)
        focused(page, page.get_by_role("textbox", name=re.compile("^Paragraph")))
        expect(menu.get_by_role("option")).to_have_count(12)
        expect(menu.get_by_role("option", name="Paragraph", exact=True, selected=True)).to_be_visible()
        page.keyboard.press("ArrowUp")
        expect(menu.get_by_role("option", name="Record table", exact=True, selected=True)).to_be_visible()
        page.keyboard.press("ArrowDown")
        expect(menu.get_by_role("option", name="Paragraph", exact=True, selected=True)).to_be_visible()
        page.keyboard.type("LIST")
        poll(page, lambda: expect(menu.get_by_role("option")).to_have_text(["Bulleted list", "Numbered list"]), FILTER_MS)
        expect(menu.get_by_role("option", name="Bulleted list", exact=True, selected=True)).to_be_visible()
        page.keyboard.press("ArrowDown")
        expect(menu.get_by_role("option", name="Numbered list", exact=True, selected=True)).to_be_visible()
        page.keyboard.press("Enter")
        numbered = box(page, "Numbered list")
        focused(page, numbered)
        gone(page, menu)
        assert [item["type"] for item in blocks(page)].count("numbered") == 1
        expect(numbered).to_have_text("")
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        next_item = box(page, "Numbered list").last
        focused(page, next_item)
        page.keyboard.type("/zzz")
        shown(page, "No blocks match.")
        before = len(blocks(page))
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        shown(page, "No blocks match.")
        assert len(blocks(page)) == before
        page.keyboard.press("Escape")
        gone(page, menu)
        focused(page, box(page, block_name("Numbered list", "/zzz")))


def test_wf_block_editing_indent(browser, app_url):
    with device(browser, app_url) as page:
        new_document(page, fresh_label("Indent"))
        choose_slash(page, "Bulleted")
        for text in ("one", "two"):
            page.keyboard.type(text)
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
        page.keyboard.type("three")
        advance(page, STEP_MS)
        first = box(page, block_name("Bulleted list", "one"))
        second = box(page, block_name("Bulleted list", "two"))
        third = box(page, block_name("Bulleted list", "three"))
        ids = [item["id"] for item in blocks(page) if item["type"] == "bulleted"]
        first.focus()
        page.keyboard.press("Tab")
        advance(page, STEP_MS)
        focused(page, first)
        indented(page, ids[0], "0")
        page.keyboard.press("Shift+Tab")
        indented(page, ids[0], "0")
        focused(page, first)
        second.focus()
        page.keyboard.press("Tab")
        indented(page, ids[1], "1")
        announced(page, "Indented.")
        third.focus()
        page.keyboard.press("Tab")
        indented(page, ids[2], "1")
        page.keyboard.press("Tab")
        indented(page, ids[2], "2")
        page.keyboard.press("Tab")
        advance(page, STEP_MS)
        indented(page, ids[2], "2")
        focused(page, third)
        page.keyboard.press("Shift+Tab")
        indented(page, ids[2], "1")
        announced(page, "Outdented.")
        page.keyboard.press("Escape")
        page.keyboard.press("Tab")
        advance(page, STEP_MS)
        expect(third).not_to_be_focused()
        indented(page, ids[2], "1")


def test_wf_block_editing_saved(browser, app_url):
    text = fresh_label("Durable words")
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-note-06")
        target = box(page, block_name("Paragraph", "Ask what size the new gloves should be."))
        see(page, target)
        expect(announcements(page)).not_to_contain_text("Saved on this device.")
        click(target)
        page.keyboard.press("End")
        page.keyboard.type(text)
        announced(page, "Saved on this device.", SAVED_MS)
        fresh = page.context.new_page()
        address = page.url
        page.close()
        fresh.goto(address)
        see(fresh, fresh.get_by_role("textbox", name=re.compile("^Paragraph: Ask what size")))
        assert text in fresh.get_by_role("textbox", name=re.compile("^Paragraph: Ask what size")).evaluate(
            "el => el.value ?? el.textContent"
        )
        fresh.close()


def test_new_document_online_and_offline(browser, app_url):
    with device(browser, app_url) as page:
        ready(page)
        for offline, shown in ((False, "13 of 13 documents"), (True, "14 of 14 documents")):
            page.context.set_offline(offline)
            if offline:
                visit(page, "/")
                see(page, doc_count(page))
                page.keyboard.press(f"{MOD}+Alt+n")
            else:
                click(button(page, "New document"))
            title = fresh_label("Fresh")
            expect(page.get_by_role("progressbar")).to_have_count(0)
            focused(page, box(page, "Document title"), STEP_MS)
            doc_id = path_of(page).split("/")[-1]
            assert path_of(page) == f"/doc/{doc_id}" and doc_id not in [row[0] for row in SEED_DOCS]
            page.keyboard.type(title)
            page.keyboard.press("Enter")
            focused(page, box(page, "Paragraph"))
            announced(page, "Saved on this device.", QUEUED_SAVED_MS)
            click(link(page.get_by_role("navigation", name="Workspace", exact=True), "Documents"))
            reads(page, doc_count(page), shown)
            expect(link(rows(page).first, title)).to_be_visible()


def test_attachment_waits_on_the_device(browser, app_url):
    name = "plan.txt"
    with device(browser, app_url) as page:
        new_document(page, fresh_label("Files"))
        attach(page, name)
        group = page.get_by_role("group", name=block_name("File", name), exact=True)
        see(page, group)
        poll(page, lambda: expect(group).to_contain_text("Waiting. This file is only on this device."))
        announced(page, f"{name} is waiting on this device.")
        offline_reload(page)
        see(page, group)
        expect(group).to_contain_text("Waiting. This file is only on this device.")
        expect(group).to_contain_text(name)
        page.context.set_offline(False)
        new_document_id = fresh_label("Large")
        visit(page, "/")
        see(page, doc_count(page))
        new_document(page, new_document_id)
        attach(page, "huge.bin", b"x" * (FILE_LIMIT + 1), "application/octet-stream")
        refused = page.get_by_role("group", name=block_name("File", "huge.bin"), exact=True)
        poll(page, lambda: expect(refused).to_contain_text("Refused. This file is larger than 5,000,000 bytes."))
        announced(page, "Refused huge.bin.")


def test_wf_doc_list_narrow(browser, app_url):
    with device(browser, app_url) as page:
        select(page.get_by_role("combobox", name="Folder filter", exact=True), "Plans")
        reads(page, doc_count(page), "3 of 12 documents")
        select(page.get_by_role("combobox", name="Tag filter", exact=True), "travel")
        reads(page, doc_count(page), "2 of 12 documents")
        fill(page.get_by_role("searchbox", name="Search documents", exact=True), "ADAPTERS")
        reads(page, doc_count(page), "1 of 12 documents")
        expect(rows(page)).to_have_count(1)
        expect(link(rows(page).first, "Packing list")).to_be_visible()
        fill(page.get_by_role("searchbox", name="Search documents", exact=True), "nothing like this here")
        shown(page, "No documents match.")
        reload(page)
        reads(page, doc_count(page), "12 of 12 documents")
        star_name = f"Star {SEED_TITLES[2]}"
        star = page.get_by_role("button", name=star_name, exact=True)
        click(star)
        poll(page, lambda: expect(page.get_by_role("button", name=star_name, exact=True, pressed=True)).to_be_visible())
        expect(link(rows(page).nth(2), "Kitchen shelf ideas")).to_be_visible()
        pick(page.get_by_role("radio", name="Grid", exact=True))
        poll(page, lambda: expect(page.get_by_role("radio", name="Grid", exact=True)).to_be_checked())
        reload(page)
        see(page, doc_count(page))
        expect(page.get_by_role("radio", name="Grid", exact=True)).to_be_checked()
        expect(page.get_by_role("button", name=star_name, exact=True, pressed=True)).to_be_visible()
        assert rows(page).nth(0).bounding_box()["y"] == pytest.approx(rows(page).nth(1).bounding_box()["y"], abs=2)
        assert rows(page).nth(0).bounding_box()["x"] != rows(page).nth(1).bounding_box()["x"]


def test_wf_doc_list_live(browser, app_url):
    with device(browser, app_url) as page:
        page.set_viewport_size({"width": 1280, "height": 420})
        page.evaluate("() => { window.__sameDocument = true; }")
        scroller = rows(page).first.evaluate_handle(SCROLLER)
        search = page.get_by_role("searchbox", name="Search documents", exact=True)
        search.focus()
        kept = scroller.evaluate(SCROLL_BESIDE_SEARCH, search.element_handle())
        assert kept > 0
        page.keyboard.type("e")
        reads(page, doc_count(page), "12 of 12 documents", FILTER_MS)
        assert scroller.evaluate("el => el.scrollTop") == kept
        typed = "e"
        for key in "r":
            typed += key
            page.keyboard.type(key)
            hay = [f"{title} {tag} {text}".lower() for _, title, _, tag, _, text in SEED_DOCS]
            shown = sum(typed in item for item in hay)
            reads(page, doc_count(page), f"{shown} of 12 documents", FILTER_MS)
            poll(page, lambda: expect(rows(page)).to_have_count(shown), FILTER_MS)
            announced(page, f"Showing {shown} of 12 documents.")
        assert page.evaluate("() => window.__sameDocument === true")


def test_wf_doc_list_keyboard(browser, app_url):
    with device(browser, app_url) as page:
        title = "Birthday list"
        opener = button(page, f"Actions for {title}")
        opener.focus()
        page.keyboard.press("Enter")
        menu = page.get_by_role("menu", name=f"Actions for {title}", exact=True)
        see(page, menu)
        items = {name: menu.get_by_role("menuitem", name=name, exact=True) for name in ("Open", "Star", "Move to trash")}
        focused(page, items["Open"])
        page.keyboard.press("ArrowDown")
        focused(page, items["Star"])
        page.keyboard.press("End")
        focused(page, items["Move to trash"])
        page.keyboard.press("ArrowDown")
        focused(page, items["Open"])
        page.keyboard.press("ArrowUp")
        focused(page, items["Move to trash"])
        page.keyboard.press("Home")
        focused(page, items["Open"])
        page.keyboard.press("Escape")
        gone(page, menu)
        focused(page, opener)
        page.keyboard.press("Space")
        focused(page, items["Open"])
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        gone(page, menu)
        focused(page, opener)
        poll(page, lambda: expect(page.get_by_role("button", name=f"Star {title}", exact=True, pressed=True)).to_be_visible())
        page.keyboard.press("Enter")
        focused(page, menu.get_by_role("menuitem", name="Open", exact=True))
        expect(menu.get_by_role("menuitem", name="Unstar", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        link(page, title).focus()
        page.keyboard.press("Enter")
        poll(page, lambda: expect(page).to_have_url(re.compile("/doc/seed-note-06")))


def test_wf_doc_list_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        for density in ("List", "Card", "Grid"):
            pick(page.get_by_role("radio", name=density, exact=True))
            advance(page, STEP_MS)
            row = rows(page).nth(1)
            snapshot = row.aria_snapshot()
            assert "Plans" not in snapshot and "travel" not in snapshot, snapshot
            title = SEED_TITLES[1]
            assert title in snapshot
            tap_height(link(row, title))
            tap_size(button(row, f"Star {title}"))
            tap_size(button(row, f"Actions for {title}"))
            assert rows(page).nth(0).bounding_box()["y"] < row.bounding_box()["y"]
            layout(page)


def test_saved_filters(browser, app_url):
    with device(browser, app_url) as page:
        search = page.get_by_role("searchbox", name="Search documents", exact=True)
        folder = page.get_by_role("combobox", name="Folder filter", exact=True)
        tag = page.get_by_role("combobox", name="Tag filter", exact=True)
        saved = page.get_by_role("combobox", name="Saved filter", exact=True)
        opener = button(page, "Save this filter")
        fill(search, "list")
        select(folder, "Plans")
        select(tag, "travel")
        reads(page, doc_count(page), "1 of 12 documents")
        click(opener)
        dialog = page.get_by_role("dialog", name="Save filter", exact=True)
        name = dialog.get_by_role("textbox", name="Filter name")
        see(page, dialog)
        click(button(dialog, "Save filter"))
        see(page, dialog.get_by_text("Enter a filter name.", exact=True))
        focused(page, name)
        fill(name, "  starred ")
        click(button(dialog, "Save filter"))
        see(page, dialog.get_by_text("That filter name is already used.", exact=True))
        focused(page, name)
        fill(name, f"  {FILTER_NAME} ")
        click(button(dialog, "Save filter"))
        gone(page, dialog)
        focused(page, opener)
        announced(page, f'Saved filter "{FILTER_NAME}".')
        assert chosen(saved) == FILTER_NAME
        reload(page)
        see(page, doc_count(page))
        assert chosen(saved) == "All documents"
        reads(page, doc_count(page), "12 of 12 documents")
        select(saved, "Starred")
        reads(page, doc_count(page), "2 of 12 documents")
        select(saved, FILTER_NAME)
        reads(page, doc_count(page), "1 of 12 documents")
        expect(search).to_have_value("list")
        assert chosen(folder) == "Plans" and chosen(tag) == "travel"
        fill(search, "")
        reads(page, doc_count(page), "2 of 12 documents")
        assert chosen(saved) == FILTER_NAME
        select(saved, "All documents")
        reads(page, doc_count(page), "12 of 12 documents")
        expect(search).to_have_value("")
        assert chosen(folder) == "All folders" and chosen(tag) == "All tags"


def row_action(page, title, item):
    click(button(page, f"Actions for {title}"))
    menu = page.get_by_role("menu", name=f"Actions for {title}", exact=True)
    see(page, menu)
    click(menu.get_by_role("menuitem", name=item, exact=True))
    gone(page, menu)


def test_wf_trash_move_restore(browser, app_url):
    title = "Car notes"
    with device(browser, app_url) as page:
        row_action(page, title, "Move to trash")
        reads(page, doc_count(page), "11 of 11 documents")
        gone(page, link(page, title))
        announced(page, f'Moved "{title}" to trash.')
        visit(page, "/doc/seed-note-09")
        see(page, page.get_by_role("heading", name="We could not find that document.", exact=True))
        visit(page, "/trash")
        restore = button(page, f"Restore {title}")
        see(page, restore)
        click(restore)
        gone(page, restore)
        announced(page, f'Restored "{title}".')
        shown(page, "Trash is empty.")
        visit(page, "/")
        reads(page, doc_count(page), "12 of 12 documents")
        click(link(page, title))
        assert_blocks(page, [block_name("Paragraph", "Tyres were last rotated in the spring.")])


def test_wf_trash_dialog_keyboard(browser, app_url):
    title = "Books I lent"
    with device(browser, app_url) as page:
        row_action(page, title, "Move to trash")
        visit(page, "/trash")
        opener = button(page, f"Delete forever {title}")
        see(page, opener)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Delete forever", exact=True)
        see(page, dialog)
        expect(dialog).to_contain_text(f'Delete "{title}" forever? This cannot be undone.')
        trapped(page, dialog, 2)
        page.keyboard.press("Escape")
        gone(page, dialog)
        focused(page, opener)
        expect(button(page, f"Restore {title}")).to_be_visible()


def test_wf_trash_two_tabs(browser, app_url):
    title = "Recipes to try"
    with device(browser, app_url) as page:
        ready(page)
        other = page.context.new_page()
        other.goto(page.url)
        see(other, doc_count(other))
        other.evaluate("() => { window.__sameDocument = true; }")
        row_action(page, title, "Move to trash")
        reads(other, doc_count(other), "11 of 11 documents", TAB_LIMIT_MS)
        gone(other, link(other, title), TAB_LIMIT_MS)
        visit(page, "/trash")
        click(button(page, f"Restore {title}"))
        reads(other, doc_count(other), "12 of 12 documents", TAB_LIMIT_MS)
        see(other, link(other, title), TAB_LIMIT_MS)
        assert other.evaluate("() => window.__sameDocument === true")
        visit(page, "/")
        row_action(page, title, "Move to trash")
        visit(other, "/trash")
        see(other, button(other, f"Restore {title}"))
        other.evaluate("() => { window.__sameDocument = true; }")
        visit(page, "/trash")
        click(button(page, f"Delete forever {title}"))
        click(button(page.get_by_role("dialog", name="Delete forever", exact=True), "Delete forever"))
        gone(other, button(other, f"Restore {title}"), TAB_LIMIT_MS)
        assert other.evaluate("() => window.__sameDocument === true")


def test_wf_trash_phone(browser, app_url):
    title = "Garden jobs"
    with device(browser, app_url, PHONE) as page:
        row_action(page, title, "Move to trash")
        visit(page, "/trash")
        restore = button(page, f"Restore {title}")
        forever = button(page, f"Delete forever {title}")
        see(page, restore)
        layout(page)
        tap_size(restore)
        tap_size(forever)
        assert restore.bounding_box()["y"] > page.get_by_text(title, exact=True).first.bounding_box()["y"]
        tap(forever)
        dialog = page.get_by_role("dialog", name="Delete forever", exact=True)
        see(page, dialog)
        size = dialog.bounding_box()
        assert size["x"] >= 0 and size["x"] + size["width"] <= PHONE["width"]
        tap_size(button(dialog, "Delete forever"))
        tap_size(button(dialog, "Cancel"))
        layout(page)


def test_deleted_forever_leaves_the_device(browser, app_url):
    title = "Garden jobs"
    with device(browser, app_url) as page:
        row_action(page, title, "Move to trash")
        visit(page, "/trash")
        click(button(page, f"Delete forever {title}"))
        dialog = page.get_by_role("dialog", name="Delete forever", exact=True)
        click(button(dialog, "Delete forever"))
        gone(page, dialog)
        announced(page, f'Deleted "{title}" forever.')
        reload(page)
        shown(page, "Trash is empty.")
        for address in ("/doc/seed-note-07", "/doc/seed-note-07?view=canvas"):
            visit(page, address)
            see(page, page.get_by_role("heading", name="We could not find that document.", exact=True))
            expect(link(page, "Back to documents")).to_be_visible()
            expect(page.get_by_text("Cut back the lavender", exact=False)).to_have_count(0)
        visit(page, "/")
        reads(page, doc_count(page), "11 of 11 documents")
        gone(page, link(page, title))
        fill(page.get_by_role("searchbox", name="Search documents", exact=True), "lavender")
        reads(page, doc_count(page), "0 of 11 documents")
        shown(page, "No documents match.")


def test_wf_page_canvas_deal(browser, app_url):
    ids = [f"seed-welcome-{n}" for n in range(1, 9)]
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-welcome")
        quote = box(page, block_name(*WELCOME[5]))
        see(page, quote)
        click(quote)
        target_id = welcome_block(6)
        origin_rect = block_rect(page, target_id)
        surface = table_surface(page)
        attribute(page, surface, "data-view-state", "page")
        click(button(page, "Switch view"))
        expect(surface).to_have_attribute("data-view-state", "dealing")
        assert query_of(page)["view"] == "canvas" and query_of(page)["block"] == target_id
        assert not connectors(page)
        path = flight(page, target_id, DEAL_SPAN_MS)
        view_state(page, "canvas")
        target = card(page, block_name(*WELCOME[5]))
        assert_screen_rule(page, target)
        final = target.bounding_box()
        end = (final["x"], final["y"])
        points = [at(p) for p in path]
        whole = distance((origin_rect["x"], origin_rect["y"]), end)
        assert whole > 20
        assert distance(points[0], (origin_rect["x"], origin_rect["y"])) <= whole * 0.25
        assert distance(points[-1], end) <= 2
        gaps = [distance(p, end) for p in points]
        assert all(later <= earlier + 1.5 for earlier, later in zip(gaps, gaps[1:])), gaps
        assert any(0.05 * whole < gap < 0.95 * whole for gap in gaps), gaps
        poll(page, lambda: linked(page, welcome_block(2), welcome_block(4)))
        announced(page, "Canvas view. 9 cards.")
        click(button(page, "Switch view"))
        poll(page, lambda: assert_empty(connectors(page)), STEP_MS)
        view_state(page, "page")
        focused(page, quote)
        click(button(page, "Switch view"))
        expect(surface).to_have_attribute("data-view-state", "dealing")
        starts = lift_order(page, ids)
        assert set(starts) == set(ids), starts
        ordered = [starts[item] for item in ids]
        assert all(b >= a - 2 * LIFT_GAP_MS for a, b in zip(ordered, ordered[1:])), ordered
        assert ordered[-1] > ordered[0]
        assert ordered[-1] - ordered[0] <= LAST_LIFT_MS + 2 * LIFT_GAP_MS
        view_state(page, "canvas")


def test_wf_page_canvas_shortcut(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-welcome")
        name = block_name(*WELCOME[3])
        target = box(page, name)
        see(page, target)
        target.focus()
        star = button(page, "Star this document")
        star.focus()
        page.keyboard.press(f"{MOD}+Shift+C")
        view_state(page, "canvas")
        focused(page, card(page, name))
        assert query_of(page)["view"] == "canvas" and query_of(page)["block"] == welcome_block(4)
        button(page, "Zoom in").focus()
        page.keyboard.press(f"{MOD}+Shift+C")
        view_state(page, "page")
        focused(page, box(page, name))
        assert query_of(page)["view"] == "page" and query_of(page)["block"] == welcome_block(4)
        announced(page, "Page view. 8 blocks.")


def test_wf_page_canvas_reverse(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-welcome")
        name = block_name(*WELCOME[5])
        click(box(page, name))
        target_id = welcome_block(6)
        home = block_rect(page, target_id)
        click(button(page, "Switch view"))
        view_state(page, "canvas")
        end = card(page, name).bounding_box()
        click(button(page, "Switch view"))
        view_state(page, "page")
        whole = distance((home["x"], home["y"]), (end["x"], end["y"]))
        click(button(page, "Switch view"))

        def mid_flight():
            advance(page, 10)
            control = button(page, "Switch view").element_handle()
            surface = table_surface(page).element_handle()
            pressed = page.evaluate(PRESS_IN_FLIGHT, [target_id, control, surface, [home["x"], home["y"]], whole * 0.3])
            assert pressed
            return pressed
        pressed = poll(page, mid_flight, DEAL_SPAN_MS, 10)
        advance(page, FRAME_MS)
        framed = block_rect(page, target_id)
        assert query_of(page)["view"] == "page"
        if pressed["state"] != "gathering":
            expect(table_surface(page)).to_have_attribute("data-view-state", "gathering")
        start = at(pressed["before"])
        seen = [at(rect) for rect in (pressed["after"], framed) if rect]
        assert seen, "no visible element carries the block's id during the Gather"
        assert min(distance(start, point) for point in seen) <= whole * 0.25
        path = [at(p) for p in flight(page, target_id, DEAL_SPAN_MS)]
        assert distance(path[-1], (home["x"], home["y"])) <= 2
        view_state(page, "page")
        focused(page, box(page, name))
        assert query_of(page)["block"] == target_id


def test_wf_page_canvas_reduced(browser, app_url):
    with device(browser, app_url, reduced_motion="reduce") as page:
        visit(page, "/doc/seed-welcome")
        name = block_name(*WELCOME[5])
        click(box(page, name))
        click(button(page, "Switch view"))
        assert page.evaluate(TRAVEL_PROBE) == 0
        path = [at(p) for p in flight(page, welcome_block(6), CROSSFADE_MS)]
        assert path
        assert all(distance(p, path[0]) <= 1 or distance(p, path[-1]) <= 1 for p in path), path
        assert page.evaluate(TRAVEL_PROBE) == 0
        view_state(page, "canvas")
        poll(page, lambda: linked(page, welcome_block(2), welcome_block(4)), CROSSFADE_MS)
        target = card(page, name)
        focused(page, target)
        assert_screen_rule(page, target)
        assert world(target) == (640, 0)
        assert query_of(page)["view"] == "canvas" and query_of(page)["block"] == welcome_block(6)
        announced(page, "Canvas view. 9 cards.")


def test_wf_canvas_arrange_main(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-welcome?view=canvas")
        first_name = block_name(*WELCOME[0])
        first = card(page, first_name)
        see(page, first)
        first.focus()
        page.keyboard.press("ArrowRight")
        poll(page, lambda: world(first) == (10, 0) or (_ for _ in ()).throw(AssertionError()))
        page.keyboard.press("c")
        page.keyboard.press("Tab")
        focused(page, card(page, block_name(*WELCOME[1])))
        page.keyboard.press("Enter")
        announced(page, "Connected.")
        poll(page, lambda: linked(page, welcome_block(1), welcome_block(2), either=True))
        reload(page)
        see(page, first)
        assert world(first) == (10, 0)
        poll(page, lambda: linked(page, welcome_block(1), welcome_block(2), either=True))
        visit(page, "/doc/seed-welcome")
        names = [block_name(*item) for item in WELCOME]
        assert_blocks(page, names)
        box(page, names[2]).focus()
        page.keyboard.press("Alt+ArrowDown")
        announced(page, "Moved block to position 4.")
        names[2], names[3] = names[3], names[2]
        assert_blocks(page, names)
        visit(page, "/doc/seed-welcome?view=canvas")
        moved = card(page, block_name(*WELCOME[2]))
        see(page, moved)
        assert world(moved) == (320, 0)
        assert world(card(page, block_name(*WELCOME[3]))) == (320, 140)
        assert world(first) == (10, 0)


def test_wf_canvas_arrange_keyboard(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-welcome?view=canvas")
        names = [block_name(*item) for item in WELCOME] + [block_name("Note", "This note is only on the canvas.")]
        first = card(page, names[0])
        see(page, first)
        first.focus()
        assert tab_order(page, len(names) - 1) == names[1:]
        first.focus()
        page.keyboard.press("ArrowDown")
        announced(page, f"Moved {WELCOME[0][1]} to 0, 10.")
        page.keyboard.press("Shift+ArrowRight")
        announced(page, f"Moved {WELCOME[0][1]} to 50, 10.")
        assert world(first) == (50, 10)
        focused(page, first)
        assert_screen_rule(page, first)


def test_wf_canvas_arrange_touch(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/doc/seed-welcome?view=canvas")
        region = canvas(page)
        see(page, region)
        spot = region.evaluate(EMPTY_POINT)
        assert spot
        zoom, pan_x, pan_y = camera_of(page)
        glide(page, [tuple(spot)], [(spot[0] + 30, spot[1] + 40)])
        assert camera_of(page)[0] == zoom
        assert camera_of(page)[1] == pytest.approx(pan_x + 30, abs=3)
        assert camera_of(page)[2] == pytest.approx(pan_y + 40, abs=3)
        size = region.bounding_box()
        mid = (size["x"] + size["width"] / 2, size["y"] + size["height"] / 2)
        zoom, pan_x, pan_y = camera_of(page)
        anchor = ((mid[0] - size["x"] - pan_x) / zoom, (mid[1] - size["y"] - pan_y) / zoom)
        glide(page, [(mid[0] - 40, mid[1]), (mid[0] + 40, mid[1])], [(mid[0] - 80, mid[1]), (mid[0] + 80, mid[1])])
        zoom, pan_x, pan_y = camera_of(page)
        assert zoom == pytest.approx(camera_of(page)[0]) and zoom > 1
        assert (mid[0] - size["x"] - pan_x) / zoom == pytest.approx(anchor[0], abs=4)
        assert (mid[1] - size["y"] - pan_y) / zoom == pytest.approx(anchor[1], abs=4)
        for _ in range(4):
            glide(page, [(mid[0] - 30, mid[1]), (mid[0] + 30, mid[1])], [(mid[0] - 150, mid[1]), (mid[0] + 150, mid[1])])
        assert camera_of(page)[0] == ZOOM_MAX
        for _ in range(6):
            glide(page, [(mid[0] - 150, mid[1]), (mid[0] + 150, mid[1])], [(mid[0] - 30, mid[1]), (mid[0] + 30, mid[1])])
        assert camera_of(page)[0] == ZOOM_MIN
        assert page.evaluate("() => document.documentElement.scrollLeft") == 0


def test_wf_canvas_arrange_fit(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-welcome?view=canvas")
        readout = page.get_by_role("status", name="Zoom level", exact=True)
        reads(page, readout, "100%")
        click(button(page, "Zoom in"))
        reads(page, readout, "125%")
        assert camera_of(page)[0] == pytest.approx(1.25)
        click(button(page, "Zoom out"))
        reads(page, readout, "100%")
        for _ in range(ZOOM_PRESSES):
            zoom_in = button(page, "Zoom in")
            if not zoom_in.is_enabled():
                break
            click(zoom_in)
            advance(page, STEP_MS)
        reads(page, readout, "400%")
        assert camera_of(page)[0] == ZOOM_MAX
        click(button(page, "Fit to view"))
        advance(page, STEP_MS)
        zoom = camera_of(page)[0]
        assert ZOOM_MIN <= zoom <= ZOOM_MAX
        reads(page, readout, f"{round(zoom * 100)}%")
        region = canvas(page).bounding_box()
        names = [block_name(*item) for item in WELCOME] + [block_name("Note", "This note is only on the canvas.")]
        for name in names:
            size = card(page, name).bounding_box()
            assert size["x"] >= region["x"] + FIT_MARGIN_PX - 1
            assert size["y"] >= region["y"] + FIT_MARGIN_PX - 1
            assert size["x"] + size["width"] <= region["x"] + region["width"] - FIT_MARGIN_PX + 1
            assert size["y"] + size["height"] <= region["y"] + region["height"] - FIT_MARGIN_PX + 1


def test_card_slots(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-shelf?view=canvas")
        oak = card(page, block_name("Numbered list", "Oak board on brackets"))
        steel = card(page, block_name("Numbered list", "Steel rail with hooks"))
        see(page, oak)
        assert world(card(page, block_name("Paragraph", "Measure the alcove twice."))) == (0, 0)
        assert world(card(page, block_name("Heading 2", "Options"))) == (300, 100)
        assert world(oak) == (580, 0)
        assert world(steel) == (580, 200)
        reload(page)
        see(page, oak)
        assert world(oak) == (580, 0) and world(steel) == (580, 200)
        visit(page, "/doc/seed-lisbon?view=canvas")
        expected = [("Heading 1", "Three days in Lisbon", 0, 0), ("Bulleted list", "Tram 28 before nine", 0, 200),
                    ("Bulleted list", "Walk down through Alfama", 0, 400), ("Bulleted list", "Stop at the viewpoint", 0, 600),
                    ("Heading 2", "Still to book", 0, 800), ("To-do", "Ferry to Cacilhas", 280, 0),
                    ("To-do", "Room near the river", 280, 200), ("Quote", "Bring shoes with grip.", 280, 400)]
        for label, text, x, y in expected:
            found = card(page, block_name(label, text))
            see(page, found)
            assert world(found) == (x, y), text
        expect(announcements(page)).not_to_contain_text("Saved on this device.")
        visit(page, "/")
        see(page, doc_count(page))
        for index, title in enumerate(SEED_TITLES):
            expect(link(rows(page).nth(index), title)).to_be_visible()


def test_wf_records_main(browser, app_url):
    name = fresh_label("Trips")
    with device(browser, app_url) as page:
        new_table(page, name)
        add_column(page, WHEN, "Date")
        add_column(page, DONE, "Checkbox")
        add_column(page, KIND, "Single select", f" {RAIL}, {ROAD} ,,{RAIL}")
        add_column(page, MEMO, "Text")
        expect(page.get_by_role("columnheader")).to_have_text(["Name", "Amount", WHEN, DONE, KIND, MEMO])
        enter_row(page, [PORTO, "10.5", "2026-12-01", None, [f"Edit {KIND}", ROAD], "by coast"])
        enter_row(page, [FARO, "4.256", "2026-12-02", None, [f"Edit {KIND}", RAIL], "by night"])
        reads(page, total(page), "14.76")
        see(page, cell(page, "10.50"))
        see(page, cell(page, "4.26"))
        reads(page, row_count(page), "2 of 2 rows")
        cell(page, "10.50").focus()
        page.keyboard.press("Enter")
        editor = box(page, "Edit Amount")
        see(page, editor)
        fill(editor, "ten")
        page.keyboard.press("Enter")
        shown(page, "Enter a number.")
        expect(editor).to_be_visible()
        page.keyboard.press("Escape")
        click(button(page, "Add column"))
        dialog = page.get_by_role("dialog", name="Add column", exact=True)
        click(button(dialog, "Add column"))
        see(page, dialog.get_by_text("Enter a column name.", exact=True))
        fill(dialog.get_by_role("textbox", name="Column name"), MEMO)
        click(button(dialog, "Add column"))
        see(page, dialog.get_by_text("That column name is already used.", exact=True))
        page.keyboard.press("Escape")
        pick(page.get_by_role("radio", name="Board", exact=True))
        see(page, page.get_by_role("group", name=ROAD, exact=True))
        expect(page.get_by_role("group", name="No value", exact=True)).to_be_visible()
        expect(board_card(page, ROAD, PORTO)).to_be_visible()
        expect(board_card(page, RAIL, FARO)).to_be_visible()
        pick(page.get_by_role("radio", name="Table", exact=True))
        see(page, cell(page, "by coast"))
        reads(page, total(page), "14.76")
        reload(page)
        see(page, cell(page, "2026-12-02"))
        reads(page, total(page), "14.76")


def test_wf_records_keyboard(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/records/seed-bills")
        start = cell(page, "Electricity")
        see(page, start)
        start.focus()
        page.keyboard.press("ArrowRight")
        poll(page, lambda: assert_inside(cell(page, "64.20")))
        page.keyboard.press("ArrowDown")
        poll(page, lambda: assert_inside(cell(page, "31.75")))
        page.keyboard.press("Enter")
        editor = box(page, "Edit Amount")
        focused(page, editor)
        fill(editor, "1.00")
        page.keyboard.press("Escape")
        gone(page, editor)
        poll(page, lambda: assert_inside(cell(page, "31.75")))
        reads(page, total(page), SEED_TOTAL)
        page.keyboard.press("Enter")
        fill(box(page, "Edit Amount"), "32")
        page.keyboard.press("Enter")
        poll(page, lambda: assert_inside(cell(page, "32.00")))
        reads(page, total(page), "394.20")


def assert_inside(locator):
    assert locator.evaluate(HAS_FOCUS)


def test_wf_records_live(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/records/seed-bills")
        see(page, cell(page, "Electricity"))
        page.evaluate("() => { window.__sameDocument = true; }")
        fill(page.get_by_role("searchbox", name="Filter rows", exact=True), "home")
        reads(page, row_count(page), "4 of 8 rows", FILTER_MS)
        reads(page, total(page), "229.95", FILTER_MS)
        announced(page, "Showing 4 of 8 rows.")
        fill(page.get_by_role("searchbox", name="Filter rows", exact=True), "")
        reads(page, row_count(page), "8 of 8 rows", FILTER_MS)
        cell(page, "2.40").focus()
        page.keyboard.press("Enter")
        fill(box(page, "Edit Amount"), "3.40")
        page.keyboard.press("Enter")
        reads(page, total(page), "394.95", FILTER_MS)
        assert page.evaluate("() => window.__sameDocument === true")
        other = page.context.new_page()
        other.goto(page.url)
        see(other, cell(other, "Broadband"))
        cell(page, "Broadband").focus()
        page.keyboard.press("Enter")
        editor = box(page, "Edit Name")
        focused(page, editor)
        page.keyboard.press("End")
        page.keyboard.type(" draft")
        page.keyboard.press("ArrowLeft")
        caret = "el => el.selectionStart ?? getSelection().anchorOffset"
        before = editor.evaluate(caret)
        cell(other, "Broadband").focus()
        other.keyboard.press("Enter")
        fill(box(other, "Edit Name"), "Fibre")
        other.keyboard.press("Enter")
        cell(other, "Gym").focus()
        cell(other, "27.50").focus()
        other.keyboard.press("Enter")
        fill(box(other, "Edit Amount"), "37.50")
        other.keyboard.press("Enter")
        reads(page, total(page), "404.95", TAB_LIMIT_MS)
        focused(page, editor)
        assert editor.evaluate("el => el.value ?? el.textContent") == DRAFT
        assert editor.evaluate(caret) == before
        page.keyboard.press("Enter")
        see(page, cell(page, DRAFT))
        see(other, cell(other, DRAFT), TAB_LIMIT_MS)


def test_wf_records_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/records/seed-bills")
        region = page.get_by_role("region", name="Table rows", exact=True)
        see(page, cell(page, "Electricity"))
        assert region.evaluate("el => el.scrollWidth > el.clientWidth")
        for header in page.get_by_role("columnheader").all():
            assert header.bounding_box()["width"] >= COLUMN_MIN_PX
        region.evaluate("el => { el.scrollLeft = 120; }")
        assert region.evaluate("el => el.scrollLeft") > 0
        assert page.evaluate("() => document.documentElement.scrollLeft") == 0
        layout(page)


def drag_points(page, grip, target):
    grip.scroll_into_view_if_needed()
    grip.evaluate(BOARD_REVEAL)
    advance(page, STEP_MS)
    assert grip.evaluate(GRIP_HIT), "the grip is covered"
    start = middle(grip)
    end = target.evaluate(DROP_POINT, start[1])
    assert end, "no visible part of the target column"
    return start, tuple(end)


def mouse_drag(page, grip, target):
    start, end = drag_points(page, grip, target)
    page.mouse.move(*start)
    page.mouse.down()
    page.mouse.move((start[0] + end[0]) / 2, (start[1] + end[1]) / 2, steps=4)
    advance(page, STEP_MS)
    page.mouse.move(*end, steps=4)
    advance(page, STEP_MS)
    page.mouse.up()
    advance(page, STEP_MS)


def test_wf_records_board_main(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/records/seed-bills?view=board")
        groups = [page.get_by_role("group", name=name, exact=True) for name in ("Home", "Travel", "Leisure", "No value")]
        see(page, groups[0])
        lefts = [g.bounding_box()["x"] for g in groups]
        assert lefts == sorted(lefts)
        for title in ("Electricity", "Water", "Broadband", "Boiler service"):
            expect(board_card(page, "Home", title)).to_be_visible()
        expect(groups[0]).to_contain_text("4")
        mouse_drag(page, button(page, "Drag Gym"), groups[1])
        see(page, board_card(page, "Travel", "Gym"))
        gone(page, board_card(page, "Leisure", "Gym"))
        pick(page.get_by_role("radio", name="Table", exact=True))
        row = page.get_by_role("row").filter(has=cell(page, "Gym"))
        see(page, row)
        expect(row).to_contain_text("Travel")
        reload(page)
        row = page.get_by_role("row").filter(has=cell(page, "Gym"))
        see(page, row)
        expect(row).to_contain_text("Travel")
        expect(row).not_to_contain_text("Leisure")


def test_wf_records_board_keyboard(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/records/seed-bills?view=board")
        water = board_card(page, "Home", "Water")
        see(page, water)
        water.focus()
        page.keyboard.press("Alt+ArrowRight")
        moved = board_card(page, "Travel", "Water")
        see(page, moved)
        focused(page, moved)
        announced(page, "Moved Water to Travel.")
        page.keyboard.press("Alt+ArrowLeft")
        back = board_card(page, "Home", "Water")
        see(page, back)
        focused(page, back)
        announced(page, "Moved Water to Home.")
        gone(page, board_card(page, "Travel", "Water"))


def test_wf_records_board_touch(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/records/seed-bills?view=board")
        grip = button(page, "Drag Train pass")
        see(page, grip)
        home = page.get_by_role("group", name="Home", exact=True)
        start, end = drag_points(page, grip, home)
        glide(page, [start], [end], 10)
        see(page, board_card(page, "Home", "Train pass"))
        ferry = "Ferry tickets"
        tap(button(page, f"Move {ferry}"))
        menu = page.get_by_role("menu", name=f"Move {ferry}", exact=True)
        see(page, menu)
        tap(menu.get_by_role("menuitem", name="Home", exact=True))
        see(page, board_card(page, "Home", "Ferry tickets"))
        visit(page, "/records/seed-bills?view=table")
        for title in ("Train pass", "Ferry tickets"):
            row = page.get_by_role("row").filter(has=cell(page, title))
            see(page, row)
            expect(row).to_contain_text("Home")


def test_wf_records_board_csv(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/records/seed-bills")
        see(page, cell(page, "Electricity"))
        fill(page.get_by_role("searchbox", name="Filter rows", exact=True), "gym")
        reads(page, row_count(page), "1 of 8 rows")
        filename, text = export_csv(page)
        assert filename == f"{BILLS_NAME}.csv"
        records = list(csv.reader(io.StringIO(text)))
        assert records[0] == ["Name", "Amount", "Due", "Paid", "Category"]
        assert [tuple(row) for row in records[1:]] == BILLS
        fill(page.get_by_role("searchbox", name="Filter rows", exact=True), "")
        result = import_csv(page, text)
        poll(page, lambda: expect(result).to_contain_text(import_summary(8, 0)))
        page.keyboard.press("Escape")
        reads(page, row_count(page), "16 of 16 rows")
        reads(page, total(page), "787.90")
        bad = ("Category,Name,Amount,Due,Paid\n"
               "Home,Kept row,1.00,2026-12-01,true\n"
               "Home,Bad number,1.000.0,2026-12-01,true\n"
               "Home,Bad date,1.00,2026-02-30,true\n"
               "Space,Bad option,1.00,2026-12-01,true\n"
               "Home,Bad checkbox,1.00,2026-12-01,maybe\n"
               "Home,Empty cells,,,\n")
        result = import_csv(page, bad)
        poll(page, lambda: expect(result).to_contain_text(import_summary(2, 4)))
        for number, column, rule in ((2, "Amount", "must be a number."), (3, "Due", "must be a date as YYYY-MM-DD."),
                                     (4, "Category", "must be one of the listed options."),
                                     (5, "Paid", "must be true or false.")):
            poll(page, lambda number=number, column=column, rule=rule: expect(result).to_contain_text(
                f"Row {number}: {column} {rule}"))
        announced(page, import_summary(2, 4))
        page.keyboard.press("Escape")
        reads(page, row_count(page), "18 of 18 rows")
        reads(page, total(page), "788.90")
        expect(cell(page, "Bad number")).to_have_count(0)
        result = import_csv(page, "Name,Amount\nOnly,1.00\n")
        poll(page, lambda: expect(result).to_contain_text(
            f"The first row must match this table's columns: {', '.join(BILL_COLUMNS)}."))
        page.keyboard.press("Escape")
        reads(page, row_count(page), "18 of 18 rows")
        result = import_csv(page, "x" * (CSV_LIMIT + 1))
        poll(page, lambda: expect(result).to_contain_text("That CSV is larger than 1,000,000 bytes."))
        page.keyboard.press("Escape")
        name = fresh_label("Limit")
        new_table(page, name)
        heading = "Name,Amount\n"
        tail = ",1.00\n"
        exact = heading + "a" * (CSV_LIMIT - len(heading) - len(tail)) + tail
        result = import_csv(page, exact)
        poll(page, lambda: expect(result).to_contain_text(import_summary(1, 0)))


def test_csv_cells_cannot_run_as_formulas(browser, app_url):
    name = fresh_label("Formulas")
    texts = ["=1+1", "+2", "-3", "@sum", "'=x", "''+y", "plain", "'quoted"]
    written = ["'=1+1", "'+2", "'-3", "'@sum", "''=x", "'''+y", "plain", "'quoted"]
    with device(browser, app_url) as page:
        new_table(page, name)
        add_column(page, FORMULA_HEAD, "Text")
        add_column(page, "Pick", "Single select", f"{FORMULA_OPTION},Plain")
        for text in texts:
            enter_row(page, [text, str(FORMULA_AMOUNT), "note", ["Edit Pick", FORMULA_OPTION]])
        _, content = export_csv(page)
        records = list(csv.reader(io.StringIO(content)))
        assert records[0] == ["Name", "Amount", f"'{FORMULA_HEAD}", "Pick"]
        assert [row[0] for row in records[1:]] == written
        assert all(row[1] == f"{FORMULA_AMOUNT:.2f}" and row[3] == f"'{FORMULA_OPTION}" for row in records[1:])
        result = import_csv(page, content)
        poll(page, lambda: expect(result).to_contain_text(f"Imported {len(texts)} rows. Skipped 0 rows."))
        page.keyboard.press("Escape")
        for text in texts:
            poll(page, lambda text=text: expect(cell(page, text)).to_have_count(2))


def test_wf_journal_main(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/journal")
        today = local_day(page)
        see(page, journal_note(page))
        expect(journal_note(page).get_by_role("heading", level=1, name=long_date(today), exact=True)).to_be_visible()
        poll(page, lambda: expect(page).to_have_url(re.compile(f"/journal/{today.isoformat()}")))
        assert_template_once(page)
        expect(day_cell(page, today)).to_have_accessible_name(f"{long_date(today)}, has a note")
        writing = fresh_label("Today words")
        fill(box(journal_note(page), "Paragraph"), writing)
        other = today.replace(day=15 if today.day != 15 else 16)
        click(day_cell(page, other))
        heading = journal_note(page).get_by_role("heading", level=1, name=long_date(other), exact=True)
        see(page, heading)
        assert_template_once(page)
        elsewhere = fresh_label("Other words")
        fill(box(journal_note(page), "Paragraph"), elsewhere)
        click(day_cell(page, today))
        see(page, box(journal_note(page), block_name("Paragraph", writing)))
        gone(page, box(journal_note(page), block_name("Paragraph", elsewhere)))
        reload(page)
        see(page, box(journal_note(page), block_name("Paragraph", writing)))
        assert_template_once(page)
        visit(page, f"/journal/{other.isoformat()}")
        see(page, box(journal_note(page), block_name("Paragraph", elsewhere)))


def test_wf_journal_keyboard(browser, app_url):
    start = date(2036, 11, 10)
    with device(browser, app_url) as page:
        visit(page, "/journal/2036-11-10")
        focus_day = day_cell(page, start)
        see(page, focus_day)
        focus_day.evaluate(FOCUS_CELL)
        for key, day in (("ArrowRight", start + timedelta(1)), ("ArrowDown", start + timedelta(8)),
                         ("ArrowUp", start + timedelta(1))):
            page.keyboard.press(key)
            holds_focus(page, day_cell(page, day))
        page.keyboard.press("PageDown")
        holds_focus(page, day_cell(page, date(2036, 12, 11)))
        page.keyboard.press("PageUp")
        moved = date(2036, 11, 11)
        holds_focus(page, day_cell(page, moved))
        expect(day_cell(page, moved)).to_have_accessible_name(long_date(moved))
        page.keyboard.press("Enter")
        poll(page, lambda: expect(page).to_have_url(re.compile("/journal/2036-11-11")))
        see(page, journal_note(page).get_by_role("heading", level=1, name=long_date(moved), exact=True))
        holds_focus(page, day_cell(page, moved))
        poll(page, lambda: expect(day_cell(page, moved)).to_have_accessible_name(f"{long_date(moved)}, has a note"))


def test_wf_journal_phone_targets(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/journal")
        see(page, journal_note(page))
        calendar = page.get_by_role("grid", name="Calendar", exact=True)
        see(page, calendar)
        layout(page)
        top = calendar.bounding_box()
        assert top["y"] + top["height"] <= journal_note(page).bounding_box()["y"] + 1
        days = calendar.get_by_role("gridcell")
        see(page, days.first)
        for index in range(days.count()):
            tap_size(days.nth(index))
        done = journal_note(page).get_by_role("checkbox", name="Done", exact=True)
        see(page, done.first)
        finger_toggle(page, done.first)


def test_wf_journal_two_devices(browser, app_url):
    day = "2037-01-15"
    words_one = fresh_label("Laptop words")
    words_two = fresh_label("Phone words")
    with pair(browser, app_url) as (first, second, email):
        for page, words in ((first, words_one), (second, words_two)):
            ready(page)
            page.context.set_offline(True)
            visit(page, f"/journal/{day}")
            notes = maybe_unsynced(journal_note(page), "Heading 2: Notes")
            see(page, notes)
            click(notes)
            page.keyboard.press("End")
            page.keyboard.press("Enter")
            advance(page, STEP_MS)
            page.keyboard.type(words)
            see(page, box(journal_note(page), f"{block_name('Paragraph', words)}, not yet synced"))
        first.context.set_offline(False)
        sentence(first, "All changes are synced.", "synced")
        second.context.set_offline(False)
        for page in (first, second):
            poll([first, second], lambda page=page: expect(box(journal_note(page), block_name("Paragraph", words_one))).to_be_visible(), ONLINE_LIMIT_MS)
            poll([first, second], lambda page=page: expect(box(journal_note(page), block_name("Paragraph", words_two))).to_be_visible(), ONLINE_LIMIT_MS)
            assert_template_once(page)
        with device(browser, app_url) as third:
            join(third, email, "Sign in")
            visit(third, f"/journal/{day}")
            see(third, box(journal_note(third), block_name("Paragraph", words_one)))
            see(third, box(journal_note(third), block_name("Paragraph", words_two)))
            assert_template_once(third)


def test_wf_journal_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/journal/2036-11-10")
        calendar = page.get_by_role("grid", name="Calendar", exact=True)
        see(page, journal_note(page))
        see(page, calendar)
        top = calendar.bounding_box()
        below = journal_note(page).bounding_box()
        assert top["y"] + top["height"] <= below["y"] + 1
        assert abs(top["x"] - below["x"]) <= 40
        assert below["width"] > PHONE["width"] * 0.7
        layout(page)
        page.set_viewport_size(DESKTOP)
        advance(page, STEP_MS)
        assert journal_note(page).bounding_box()["x"] < calendar.bounding_box()["x"]


def test_journal_date_reads_the_same(browser, app_url):
    words = fresh_label("Island words")
    with pair(browser, app_url) as (first, second, _):
        session(first).send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Kiritimati"})
        session(second).send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Pago_Pago"})
        visit(first, "/journal")
        day = local_day(first)
        heading = journal_note(first).get_by_role("heading", level=1, name=long_date(day), exact=True)
        see(first, heading)
        fill(maybe_unsynced(journal_note(first), "Paragraph"), words)
        assert local_day(second) != day
        visit(second, f"/journal/{day.isoformat()}")
        poll([first, second], lambda: expect(
            maybe_unsynced(journal_note(second), block_name("Paragraph", words))).to_be_visible(), ONLINE_LIMIT_MS)
        expect(journal_note(second).get_by_role("heading", level=1, name=long_date(day), exact=True)).to_be_visible()
        expect(day_cell(second, day)).to_have_accessible_name(f"{long_date(day)}, has a note")


def template_names(blocks):
    return [block_name(label, text) for label, text in blocks]


def test_wf_templates_main(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/templates")
        click(button(page, "Preview Trip plan"))
        dialog = page.get_by_role("dialog", name="Trip plan", exact=True)
        click(button(dialog, "Use this template"))
        title = box(page, "Document title")
        focused(page, title)
        expect(title).to_have_text("Trip plan") if title.evaluate("el => el.value === undefined") else expect(title).to_have_value("Trip plan")
        assert path_of(page).startswith("/doc/")
        edited = fresh_label("My trip")
        fill(box(page, "To-do: Book the first night"), edited)
        visit(page, "/")
        reads(page, doc_count(page), "13 of 13 documents")
        expect(link(rows(page).first, "Trip plan")).to_be_visible()
        visit(page, "/templates")
        click(button(page, "Preview Trip plan"))
        dialog = page.get_by_role("dialog", name="Trip plan", exact=True)
        see(page, dialog)
        expect(dialog).to_contain_text("Book the first night")
        expect(dialog).not_to_contain_text(edited)


def test_wf_templates_preview_motion(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/templates")
        opener = button(page, "Preview Book notes")
        see(page, opener)
        page.evaluate(ENTRY_WATCH)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Book notes", exact=True)
        came_in(page, dialog)
        poll(page, lambda: assert_inside(dialog))
        page.keyboard.press("Escape")
        gone(page, dialog)
        focused(page, opener)


def test_wf_templates_keyboard(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/templates")
        opener = button(page, "Preview Book notes")
        see(page, opener)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Book notes", exact=True)
        see(page, dialog)
        poll(page, lambda: assert_inside(dialog))
        trapped(page, dialog, 2)
        page.keyboard.press("Escape")
        gone(page, dialog)
        focused(page, opener)


def test_wf_templates_text(browser, app_url):
    with device(browser, app_url) as page:
        for index, (name, category, description, blocks) in enumerate(TEMPLATES):
            visit(page, "/templates")
            opener = button(page, f"Preview {name}")
            see(page, opener)
            for earlier, later in zip(TEMPLATES, TEMPLATES[1:]):
                first_box = button(page, f"Preview {earlier[0]}").bounding_box()
                next_box = button(page, f"Preview {later[0]}").bounding_box()
                assert (first_box["y"], first_box["x"]) < (next_box["y"], next_box["x"])
            for text in (name, category, description):
                expect(page.get_by_text(text, exact=True).first).to_be_visible()
            click(opener)
            dialog = page.get_by_role("dialog", name=name, exact=True)
            see(page, dialog)
            for _, text in blocks:
                if text:
                    expect(dialog).to_contain_text(text)
            click(button(dialog, "Use this template"))
            focused(page, box(page, "Document title"))
            assert_blocks(page, template_names(blocks))
            visit(page, "/")
            reads(page, doc_count(page), f"{13 + index} of {13 + index} documents")


def test_wf_templates_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/templates")
        chips = page.get_by_role("group", name="Template categories", exact=True)
        see(page, chips)
        names = ["All", "Journal", "Planning", "Reading"]
        boxes = [button(chips, name).bounding_box() for name in names]
        assert all(size["width"] >= CHIP_MIN_PX for size in boxes)
        assert len({round(size["y"]) for size in boxes}) == 1
        scroller = button(chips, "All").evaluate_handle(
            "el => { while (el && el.scrollWidth <= el.clientWidth) el = el.parentElement; return el; }"
        )
        assert scroller.evaluate("el => el !== document.documentElement && el !== document.body")
        scroller.evaluate("el => { el.scrollLeft = 80; }")
        assert scroller.evaluate("el => el.scrollLeft") > 0
        assert page.evaluate("() => document.documentElement.scrollLeft") == 0
        lefts = {round(button(page, f"Preview {t[0]}").bounding_box()["x"]) for t in TEMPLATES}
        assert len(lefts) == 1
        layout(page)


def test_wf_sign_in_sync_upload(browser, app_url):
    title_one = fresh_label("First device")
    title_two = fresh_label("Second device")
    with device(browser, app_url) as first, device(browser, app_url) as second:
        new_document(first, title_one, "From the laptop")
        visit(first, "/")
        new_document(second, title_two, "From the phone")
        visit(second, "/")
        email = fresh_email()
        join(first, email)
        announced(first, f"Signed in as {email}.")
        announced(first, "Workspace uploaded.")
        expect(first.get_by_role("banner")).to_contain_text(email)
        join(second, email, "Sign in")
        merged = len(SEED_TITLES) + 2
        for page in (first, second):
            poll([first, second], lambda page=page: expect(doc_count(page)).to_have_text(
                f"{merged} of {merged} documents"), ONLINE_LIMIT_MS)
            for title in [*SEED_TITLES, title_one, title_two]:
                expect(link(page, title)).to_have_count(1)
        visit(first, "/doc/seed-lisbon")
        see(first, first.get_by_role("group", name="Document state", exact=True))
        reads(first, first.get_by_role("group", name="Document state", exact=True), "Synced")
        devices = client_for(first).get("/api/devices").json()["devices"]
        assert sorted(item["name"] for item in devices) == [device_label(1), device_label(2)]


def test_wf_sign_in_sync_keep(browser, app_url):
    title = uuid.uuid4().hex
    text = uuid.uuid4().hex
    db = Postgres()
    with device(browser, app_url) as first:
        doc_id = new_document(first, title, text)
        visit(first, "/")
        see(first, doc_count(first))
        email = fresh_email()
        join(first, email, choice="Keep it on this device")
        announced(first, "Keeping this workspace on this device.")
        sentence(first, "This workspace is only on this device.", "offline")
        client = client_for(first)
        assert client.get(f"/api/documents/{doc_id}/share").status_code == 404
        assert client.post(f"/api/documents/{doc_id}/share", json={}).status_code == 404
        visit(first, f"/doc/{doc_id}")
        click(button(first, "Share"))
        see(first, first.get_by_text("Sync this document before sharing it.", exact=True))
        first.keyboard.press("Escape")
        with device(browser, app_url) as second:
            join(second, email, "Sign in")
            assert not tables_holding(db, title) and not tables_holding(db, text)
            advance(first, 5000)
            gone(second, link(second, title))
            reads(second, doc_count(second), "12 of 12 documents")
            visit(first, "/settings")
            see(first, button(first, "Upload this workspace"))


def test_wf_sign_in_sync_phone(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        tap(button(page.get_by_role("banner"), "Sign in"))
        dialog = page.get_by_role("dialog", name="Sign in", exact=True)
        see(page, dialog)
        layout(page)
        create = button(dialog, "Create account")
        tap_size(create)
        fill(dialog.get_by_role("textbox", name="Email"), fresh_email())
        fill(dialog.get_by_label("Password"), PASSWORD)
        tap(create)
        choice = page.get_by_role("dialog", name="Upload this workspace?", exact=True)
        see(page, choice)
        layout(page)
        upload = button(choice, "Upload this workspace")
        tap_size(upload)
        tap(upload)
        gone(page, choice)
        sentence(page, "All changes are synced.", "synced")


def test_wf_sign_in_sync_live(browser, app_url):
    text = fresh_label("Arrives live")
    with pair(browser, app_url) as (first, second, _):
        for page in (first, second):
            visit(page, "/doc/seed-note-08")
        second.evaluate("() => { window.__sameDocument = true; }")
        target = box(first, block_name("Paragraph", "Lentil soup with lemon, and the plum cake."))
        fill(target, text)
        sentence(first, "Syncing 1 item.", "syncing")
        sentence(first, "All changes are synced.", "synced")
        see(second, box(second, block_name("Paragraph", text)), ONLINE_LIMIT_MS)
        assert second.evaluate("() => window.__sameDocument === true")
        sentence(second, "All changes are synced.", "synced")


def test_wf_sign_in_sync_keyboard(browser, app_url):
    email = fresh_email()
    with device(browser, app_url) as page:
        opener = button(page.get_by_role("banner"), "Sign in")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Sign in", exact=True)
        see(page, dialog)
        field = dialog.get_by_role("textbox", name="Email")
        focused(page, field)
        trapped(page, dialog, 5)
        page.keyboard.press("Escape")
        gone(page, dialog)
        focused(page, opener)
        page.keyboard.press("Enter")
        focused(page, field)
        page.keyboard.type(email)
        page.keyboard.press("Tab")
        page.keyboard.type(PASSWORD)
        page.keyboard.press("Enter")
        see(page, dialog.get_by_text("That email and password do not match.", exact=True))
        expect(dialog).to_be_visible()
        create = button(dialog, "Create account")
        create.focus()
        page.keyboard.press("Enter")
        choice = page.get_by_role("dialog", name="Upload this workspace?", exact=True)
        see(page, choice)
        expect(choice).to_contain_text(
            f"This device holds {len(SEED_DOCS)} documents. Nothing leaves this device until you choose.")
        upload = button(choice, "Upload this workspace")
        focused(page, upload)
        trapped(page, choice, 2)
        page.keyboard.press("Escape")
        gone(page, choice)
        reads(page, sync_status(page), "This workspace is only on this device.")
        reload(page)
        see(page, choice)
        focused(page, upload)
        page.keyboard.press("Enter")
        gone(page, choice)
        sentence(page, "All changes are synced.", "synced")
        assert client_for(page).get("/api/session").json()["user"]["email"] == email


def test_account_and_session_api(app_url):
    plain = httpx.Client(base_url=app_url, timeout=HTTP_SECONDS)
    response = plain.get("/api/session")
    assert response.status_code == 200 and response.json() == {}
    email = fresh_email()
    bad = {"errors": {"email": "Enter a valid email address."}}
    response = plain.post("/api/accounts", json={"email": "not-an-email", "password": PASSWORD})
    assert response.status_code == 422 and response.json() == bad
    response = plain.post("/api/accounts", json={"email": email, "password": "seven77"})
    assert response.status_code == 422 and response.json() == {"errors": {"password": "Use at least 8 characters."}}
    assert plain.post("/api/sessions", json={"email": email, "password": PASSWORD}).status_code == 401
    secret = uuid.uuid4().hex
    created = httpx.post(f"{app_url}/api/accounts", json={"email": email, "password": secret}, timeout=HTTP_SECONDS)
    assert created.status_code == 201
    body = created.json()
    assert body["user"]["email"] == email and body["user"]["id"]
    assert body["device"]["name"] == device_label(1) and body["device"]["id"]
    header, token = session_cookie(created)
    assert "HttpOnly".lower() in header.lower() and "SameSite=Lax".lower() in header.lower()
    assert not tables_holding(Postgres(), secret)
    signed = httpx.Client(base_url=app_url, timeout=HTTP_SECONDS, headers={"cookie": f"oddment_session={token}"})
    assert signed.get("/api/session").json() == body
    response = plain.post("/api/accounts", json={"email": email, "password": secret})
    assert response.status_code == 409 and response.json() == {"errors": {"email": "That email already has an account."}}
    response = plain.post("/api/sessions", json={"email": email, "password": "wrong-password"})
    assert response.status_code == 401
    assert response.json() == {"errors": {"form": "That email and password do not match."}}
    response = httpx.post(f"{app_url}/api/sessions", json={"email": email, "password": secret}, timeout=HTTP_SECONDS)
    assert response.status_code == 200 and response.json()["device"]["name"] == device_label(2)
    response = signed.delete("/api/session")
    assert response.status_code == 204
    assert "oddment_session" in response.headers.get("set-cookie", "")
    assert signed.get("/api/session").json() == {}
    assert signed.get("/api/devices").status_code == 401
    assert signed.get("/api/devices").json() == {"errors": {"form": "Sign in again."}}


def test_attachment_api(app_url):
    bucket = S3()
    client, body = api(app_url)
    owner = body["user"]["id"]
    item = str(uuid.uuid4())
    key = f"attachments/{owner}/{item}"
    content = b"attachment body"
    assert httpx.put(f"{app_url}/api/attachments/{item}", content=content, timeout=HTTP_SECONDS).status_code == 401
    assert key not in bucket.keys(f"attachments/{owner}/")
    response = put_file(client, item, content)
    assert response.status_code == 201
    stored = response.json()
    assert stored == {"id": item, "name": "note one.txt", "size": len(content), "contentType": "text/plain", "state": "stored"}
    assert bucket.get(key) == content
    replay = put_file(client, item, content)
    assert replay.status_code == 200 and replay.json() == stored
    clash = put_file(client, item, b"other bytes")
    assert clash.status_code == 409 and clash.json() == {"errors": {"form": "That attachment id is already used."}}
    assert bucket.get(key) == content
    read = client.get(f"/api/attachments/{item}")
    assert read.status_code == 200 and read.content == content
    assert read.headers["content-type"].startswith("text/plain")
    assert read.headers["content-disposition"].startswith("attachment")
    stranger, _ = api(app_url)
    assert stranger.get(f"/api/attachments/{item}").status_code == 404
    assert stranger.get(f"/api/attachments/{item}").json() == {"errors": {"form": "Not found."}}
    assert stranger.delete(f"/api/attachments/{item}").status_code == 404
    assert bucket.get(key) == content
    response = put_file(client, "not-a-uuid", content)
    assert response.status_code == 422 and response.json() == {"errors": {"id": "Use a UUID."}}
    response = put_file(client, str(uuid.uuid4()), content, document_id="")
    assert response.status_code == 422 and response.json() == {"errors": {"documentId": "Enter a document id."}}
    exact = str(uuid.uuid4())
    assert put_file(client, exact, b"a" * FILE_LIMIT).status_code == 201
    over = str(uuid.uuid4())
    response = put_file(client, over, b"a" * (FILE_LIMIT + 1))
    assert response.status_code == 413
    assert response.json() == {"errors": {"file": "That file is larger than 5,000,000 bytes."}}
    assert f"attachments/{owner}/{over}" not in bucket.keys(f"attachments/{owner}/")
    assert client.delete(f"/api/attachments/{item}").status_code == 204
    assert key not in bucket.keys(f"attachments/{owner}/")
    assert client.get(f"/api/attachments/{item}").status_code == 404
    short = outage_url("APP_SHORT_URL")
    limited, limited_body = api(short)
    prefix = f"attachments/{limited_body['user']['id']}/"
    assert put_file(limited, str(uuid.uuid4()), b"a" * SHORT_QUOTA).status_code == 201
    extra = str(uuid.uuid4())
    response = put_file(limited, extra, b"a")
    assert response.status_code == 507 and response.json() == {"errors": {"file": "Your account storage is full."}}
    assert len(S3("-short").keys(prefix)) == 1
    down = outage_url("APP_MINIO_DOWN_URL")
    broken, broken_body = api(down)
    response = put_file(broken, str(uuid.uuid4()), content)
    assert response.status_code == 503 and response.json() == {"errors": {"form": "The server is unavailable."}}
    assert not bucket.keys(f"attachments/{broken_body['user']['id']}/")


def test_wf_both_kept_main(browser, app_url):
    original = block_name("Paragraph", "Two books are due back on Saturday.")
    apple, banana = fresh_label("apple"), fresh_label("Banana")
    with pair(browser, app_url) as (first, second, _):
        conflict(first, second, "seed-note-05", original, banana, apple)
        marked = f"{block_name('Paragraph', apple)}, Both kept"
        for page in (first, second):
            keeps = page.get_by_role("group", name="Both kept", exact=True).get_by_role("button")
            expect(keeps).to_have_count(2)
            expect(keeps.nth(0)).to_have_accessible_name(f"Keep {apple}")
            expect(keeps.nth(1)).to_have_accessible_name(f"Keep {banana}")
            target = box(page, marked)
            see(page, target)
            expect(target).not_to_be_editable()


def test_wf_both_kept_notice(browser, app_url):
    original = block_name("Paragraph", "Two books are due back on Saturday.")
    apple, banana = fresh_label("apple"), fresh_label("Banana")
    plain_text = "Cut back the lavender before the first frost."
    edited = fresh_label("Notched words")
    with pair(browser, app_url) as (first, second, _):
        go_offline_edit(first, "/doc/seed-note-07", block_name("Paragraph", plain_text), edited)
        unsynced = f"{block_name('Paragraph', edited)}, not yet synced"
        click(button(first, "Switch view"))
        view_state(first, "canvas")
        notched = card(first, unsynced)
        see(first, notched)
        first.evaluate("() => document.activeElement.blur()")
        advance(first, STEP_MS)
        before = decode(capture(notched))
        first.context.set_offline(False)
        sentence(first, "All changes are synced.", "synced")
        clean = card(first, block_name("Paragraph", edited))
        see(first, clean)
        advance(first, STEP_MS)
        assert difference(before, decode(capture(clean))) > 0
        conflict(first, second, "seed-note-05", original, banana, apple)
        for page in (first, second):
            expect(page.get_by_role("group", name="Both kept", exact=True)).to_contain_text(
                "Both kept. Two devices changed this block. Pick the one to keep.")
        for page, value in ((first, "Gym pass A"), (second, "Gym pass B")):
            ready(page)
            page.context.set_offline(True)
            visit(page, "/records/seed-bills")
            cell(page, "Gym").focus()
            page.keyboard.press("Enter")
            fill(box(page, "Edit Name"), value)
            page.keyboard.press("Enter")
            see(page, cell(page, value))
        first.context.set_offline(False)
        sentence(first, "All changes are synced.", "synced")
        second.context.set_offline(False)
        for page in (first, second):
            poll([first, second], lambda page=page: expect(
                page.get_by_role("group", name="Both kept", exact=True)
            ).to_contain_text("Both kept. Two devices changed this cell. Pick the one to keep."), ONLINE_LIMIT_MS)


def test_wf_both_kept_phone(browser, app_url):
    original = block_name("Paragraph", "Tyres were last rotated in the spring.")
    apple, banana = fresh_label("apple"), fresh_label("Banana")
    with pair(browser, app_url) as (first, second, _):
        first.set_viewport_size(PHONE)
        conflict(first, second, "seed-note-09", original, apple, banana)
        keep = button(first.get_by_role("group", name="Both kept", exact=True), f"Keep {banana}")
        see(first, keep)
        layout(first)
        tap_size(keep)
        tap(keep)
        focused(first, box(first, block_name("Paragraph", banana)))
        poll([first, second], lambda: expect(
            box(second, block_name("Paragraph", banana))).to_be_visible(), ONLINE_LIMIT_MS)
        gone(first, first.get_by_role("group", name="Both kept", exact=True))


def test_wf_both_kept_keyboard(browser, app_url):
    original = block_name("Paragraph", "Tyres were last rotated in the spring.")
    apple, banana = fresh_label("apple"), fresh_label("Banana")
    with pair(browser, app_url) as (first, second, _):
        conflict(first, second, "seed-note-09", original, apple, banana)
        marked = f"{block_name('Paragraph', apple)}, Both kept"
        group = first.get_by_role("group", name="Both kept", exact=True)
        target = box(first, marked)
        see(first, target)
        target.focus()
        keep = button(group, f"Keep {banana}")
        for _ in range(4):
            first.keyboard.press("Tab")
            if keep.evaluate("el => el === document.activeElement"):
                break
        focused(first, keep)
        first.keyboard.press("Enter")
        final = box(first, block_name("Paragraph", banana))
        focused(first, final)
        expect(final).to_be_editable()
        sentence(first, "All changes are synced.", "synced")
        poll([first, second], lambda: expect(
            box(second, block_name("Paragraph", banana))).to_be_visible(), ONLINE_LIMIT_MS)
        gone(second, second.get_by_role("group", name="Both kept", exact=True))
        gone(second, box(second, block_name("Paragraph", apple)))


def test_wf_both_kept_announcement(browser, app_url):
    original = block_name("Paragraph", "The atlas is with the neighbours at number 12.")
    apple, banana = fresh_label("apple"), fresh_label("Banana")
    with pair(browser, app_url) as (first, second, _):
        conflict(first, second, "seed-note-10", original, apple, banana)
        marked = f"{block_name('Paragraph', apple)}, Both kept"
        for page in (first, second):
            see(page, box(page, marked))
        click(button(first, "Switch view"))
        view_state(first, "canvas")
        see(first, card(first, marked))
        click(button(first, "Switch view"))
        view_state(first, "page")
        click(button(first.get_by_role("group", name="Both kept", exact=True), f"Keep {apple}"))
        announced(first, "Kept one version.")
        see(first, box(first, block_name("Paragraph", apple)))
        gone(first, box(first, marked))


def share_token(page, client, doc_id):
    def check():
        answer = client.post(f"/api/documents/{doc_id}/share", json={})
        assert answer.status_code == 201, answer.text
        return answer.json()["token"]
    return poll(page, check, ONLINE_LIMIT_MS)


def link_answers(page, client, token, status):
    def check():
        assert client.get(f"/api/shared/{token}").status_code == status
    poll(page, check, ONLINE_LIMIT_MS)


def test_share_link_api(browser, app_url):
    title = "Trip to Lisbon"
    with device(browser, app_url) as page:
        join(page, fresh_email())
        client = client_for(page)
        anonymous = httpx.Client(base_url=app_url, timeout=HTTP_SECONDS)
        assert client.get(SHARE_PATH).json() == {"share": None}
        assert anonymous.post(SHARE_PATH, json={}).status_code == 401
        assert client.delete(SHARE_PATH).status_code == 404
        assert client.post(f"/api/documents/{UNKNOWN_UUID}/share", json={}).status_code == 404
        response = client.post(SHARE_PATH, json={})
        assert response.status_code == 201
        share = response.json()
        token = share["token"]
        assert len(token) >= 22 and share["url"] == f"{app_url.rstrip('/')}/s/{token}"
        assert share["expiresAt"]
        assert client.get(SHARE_PATH).json()["share"]["token"] == token
        read = anonymous.get(f"/api/shared/{token}")
        assert read.status_code == 200
        body = read.json()
        assert body["title"] == title and len(body["blocks"]) == 8
        by_text = {item["text"]: item for item in body["blocks"]}
        assert by_text["Stop at the viewpoint"]["indent"] == 1
        assert by_text["Room near the river"]["checked"] is True
        assert by_text["Ferry to Cacilhas"]["checked"] is False
        assert "Tyres were last rotated" not in read.text and "Household bills" not in read.text
        dead = {"errors": {"form": "This link no longer works."}}
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            for path in (f"/api/shared/{token}", f"/api/shared/{token}/blocks"):
                refused = anonymous.request(method, path, json={"title": "changed"})
                assert refused.status_code == 405 and refused.json() == {"errors": {"form": "This link is read only."}}
        assert anonymous.get(f"/api/shared/{token}").json()["title"] == title
        stranger, _ = api(app_url)
        assert stranger.get(SHARE_PATH).status_code == 404
        assert stranger.delete(SHARE_PATH).status_code == 404
        assert anonymous.get(f"/api/shared/{token}/attachments/{UNKNOWN_UUID}").status_code == 404
        renewed = client.post(SHARE_PATH, json={}).json()
        assert renewed["token"] != token
        response = anonymous.get(f"/api/shared/{token}")
        assert response.status_code == 404 and response.json() == dead
        assert anonymous.get(f"/api/shared/{renewed['token']}").status_code == 200
        assert client.delete(SHARE_PATH).status_code == 204
        assert anonymous.get(f"/api/shared/{renewed['token']}").status_code == 404
        assert client.delete(SHARE_PATH).status_code == 404
        doc_id = new_document(page, fresh_label("Shared file"), "Body")
        page.keyboard.press("Enter")
        advance(page, STEP_MS)
        attach(page, "keep.txt", b"shared bytes")
        group = page.get_by_role("group", name=re.compile("^File: keep.txt"))
        poll(page, lambda: expect(group).to_contain_text("Stored."))
        live = share_token(page, client, doc_id)

        def listed_files():
            files = anonymous.get(f"/api/shared/{live}").json()["attachments"]
            assert [item["name"] for item in files] == ["keep.txt"]
            return files
        listed = poll(page, listed_files, ONLINE_LIMIT_MS)
        got = anonymous.get(f"/api/shared/{live}/attachments/{listed[0]['id']}")
        assert got.status_code == 200 and got.content == b"shared bytes"
        click(button(page, "Move to trash"))
        link_answers(page, anonymous, live, 404)
        visit(page, "/trash")
        title_text = page.get_by_role("button", name=re.compile("^Restore Shared file"))
        see(page, title_text)
        click(title_text)
        link_answers(page, anonymous, live, 200)
        visit(page, f"/doc/{doc_id}")
        click(button(page, "Move to trash"))
        visit(page, "/trash")
        click(page.get_by_role("button", name=re.compile("^Delete forever Shared file")))
        click(button(page.get_by_role("dialog", name="Delete forever", exact=True), "Delete forever"))
        link_answers(page, anonymous, live, 404)
    short = outage_url("APP_SHORT_URL")
    with device(browser, short) as page:
        join(page, fresh_email())
        token = client_for(page).post(SHARE_PATH, json={}).json()["token"]
        plain = httpx.Client(base_url=short, timeout=HTTP_SECONDS)
        assert plain.get(f"/api/shared/{token}").status_code == 200
        deadline = time.monotonic() + SHARE_EXPIRY_DEADLINE
        while plain.get(f"/api/shared/{token}").status_code == 200:
            assert time.monotonic() < deadline, "the link did not expire"
        assert plain.get(f"/api/shared/{token}").json() == {"errors": {"form": "This link no longer works."}}


def test_delete_forever_beats_offline_edits(browser, app_url):
    title = uuid.uuid4().hex
    text = uuid.uuid4().hex
    late = uuid.uuid4().hex
    db = Postgres()
    bucket = S3()
    with pair(browser, app_url) as (first, second, _):
        doc_id = new_document(first, title, text)
        first.keyboard.press("Enter")
        advance(first, STEP_MS)
        attach(first, "gone.txt", b"object to remove")
        poll(first, lambda: expect(first.get_by_role("group", name=re.compile("^File: gone.txt"))).to_contain_text("Stored."))
        sentence(first, "All changes are synced.", "synced")
        owner = client_for(first).get("/api/session").json()["user"]["id"]
        prefix = f"attachments/{owner}/"
        assert len(bucket.keys(prefix)) == 1
        assert bucket.get(bucket.keys(prefix)[0]) == b"object to remove"
        visit(second, f"/doc/{doc_id}")
        see(second, box(second, block_name("Paragraph", text)), ONLINE_LIMIT_MS)
        first.context.set_offline(True)
        fill(box(first, block_name("Paragraph", text)), late)
        see(first, box(first, f"{block_name('Paragraph', late)}, not yet synced"))
        click(button(second, "Move to trash"))
        visit(second, "/trash")
        click(button(second, f"Delete forever {title}"))
        click(button(second.get_by_role("dialog", name="Delete forever", exact=True), "Delete forever"))
        sentence(second, "All changes are synced.", "synced")
        poll(second, lambda: assert_empty(bucket.keys(prefix)))
        poll(second, lambda: assert_empty(tables_holding(db, title) + tables_holding(db, text)))
        first.context.set_offline(False)
        notices = first.get_by_role("region", name="Notices", exact=True)
        poll(first, lambda: expect(notices).to_contain_text(
            f'"{title}" was deleted forever on another device, so your changes to it were not kept.'), ONLINE_LIMIT_MS)
        visit(first, "/")
        see(first, doc_count(first))
        gone(first, link(first, title))
        sentence(first, "All changes are synced.", "synced")
        assert not tables_holding(db, late) and not tables_holding(db, title)
        assert not bucket.keys(prefix)
        visit(first, f"/doc/{doc_id}")
        see(first, first.get_by_role("heading", name="We could not find that document.", exact=True))
        visit(second, f"/doc/{doc_id}")
        see(second, second.get_by_role("heading", name="We could not find that document.", exact=True))


def assert_empty(values):
    assert not values, values


def test_wf_cross_cutting_storage_outage(browser, app_url):
    name = "outage.txt"
    down = outage_url("APP_MINIO_DOWN_URL")
    with device(browser, down) as page:
        join(page, fresh_email())
        new_document(page, fresh_label("Waiting file"))
        attach(page, name)
        group = page.get_by_role("group", name=re.compile(f"^File: {name}"))
        poll(page, lambda: expect(group).to_contain_text("Waiting. This file is only on this device."))
        notices = page.get_by_role("region", name="Notices", exact=True)
        poll(page, lambda: expect(notices).to_contain_text(
            "Attachment storage is unavailable. Waiting files stay on this device."))
        attribute(page, sync_status(page), "data-sync-state", "syncing")
        expect(group).not_to_contain_text("Stored.")
        owner = client_for(page).get("/api/session").json()["user"]["id"]
        assert httpx.get(f"{down}/api/status", timeout=HTTP_SECONDS).json() == {"sync": "ok", "storage": "unavailable"}
        assert not S3().keys(f"attachments/{owner}/")
    unavailable = json.dumps({"errors": {"form": "The server is unavailable."}})
    status = json.dumps({"sync": "ok", "storage": "unavailable"})
    with outage_proxy(app_url) as (relay_url, rules), device(browser, relay_url) as page:
        join(page, fresh_email())
        rules["/api/attachments/"] = (503, unavailable)
        rules["/api/status"] = (200, status)
        new_document(page, fresh_label("Recovered file"))
        attach(page, name, b"comes back")
        group = page.get_by_role("group", name=re.compile(f"^File: {name}"))
        poll(page, lambda: expect(group).to_contain_text("Waiting. This file is only on this device."))
        notices = page.get_by_role("region", name="Notices", exact=True)
        poll(page, lambda: expect(notices).to_contain_text(
            "Attachment storage is unavailable. Waiting files stay on this device."))
        page.evaluate("() => { window.__sameDocument = true; }")
        owner = client_for(page).get("/api/session").json()["user"]["id"]
        rules.clear()
        poll(page, lambda: expect(group).to_contain_text("Stored."))
        announced(page, f"Stored {name}.")
        assert page.evaluate("() => window.__sameDocument === true")
        keys = S3().keys(f"attachments/{owner}/")
        assert len(keys) == 1 and S3().get(keys[0]) == b"comes back"


def test_wf_cross_cutting_sync_outage(browser, app_url):
    down = outage_url("APP_POSTGRES_DOWN_URL")
    with device(browser, app_url) as healthy:
        reads(healthy, sync_status(healthy), "This workspace is only on this device.")
        plain = style(sync_status(healthy), "color", "backgroundColor")
    with device(browser, down) as page:
        sentence(page, "Sync is unavailable. This workspace is only on this device.", "error")
        assert style(sync_status(page), "color", "backgroundColor") == plain
        expect(page.get_by_role("alert")).to_have_count(0)
        title = fresh_label("During outage")
        doc_id = new_document(page, title, "Still saved")
        announced(page, "Saved on this device.")
        reload(page)
        see(page, box(page, block_name("Paragraph", "Still saved")))
        visit(page, "/")
        reads(page, doc_count(page), "13 of 13 documents")
        star_name = f"Star {SEED_TITLES[5]}"
        click(page.get_by_role("button", name=star_name, exact=True))
        poll(page, lambda: expect(page.get_by_role("button", name=star_name, exact=True, pressed=True)).to_be_visible())
        assert doc_id
        dialog = account_dialog(page, fresh_email(), "Sign in")
        see(page, dialog.get_by_text("We could not reach the server. Nothing has changed on this device.", exact=True))
        expect(dialog).to_be_visible()
        assert httpx.get(f"{down}/api/status", timeout=HTTP_SECONDS).json()["sync"] == "unavailable"


def test_wf_cross_cutting_share_reader(browser, app_url):
    with device(browser, app_url) as page:
        visit(page, "/doc/seed-lisbon")
        click(button(page, "Share"))
        shown(page, "Sign in to share this document.")
        page.keyboard.press("Escape")
        visit(page, "/")
        see(page, doc_count(page))
        join(page, fresh_email())
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        visit(page, "/doc/seed-lisbon")
        click(button(page, "Share"))
        dialog = page.get_by_role("dialog", name="Share", exact=True)
        click(button(dialog, "Create link"))
        field = dialog.get_by_role("textbox", name="Share link")
        poll(page, lambda: expect(field).to_have_value(re.compile("/s/")))
        announced(page, "Link created.")
        first_link = field.input_value()
        expect(field).not_to_be_editable()
        click(button(dialog, "Copy link"))
        announced(page, "Link copied.")
        assert page.evaluate("() => navigator.clipboard.readText()") == first_link
        with open_app(browser, first_link) as reader:
            see(reader, reader.get_by_text("Tram 28 before nine", exact=True))
            see(reader, reader.get_by_text("Shared from Oddment. Read only.", exact=True))
            expect(reader.get_by_text("Trip to Lisbon", exact=True).first).to_be_visible()
            expect(reader.get_by_text("Tyres were last rotated", exact=False)).to_have_count(0)
            expect(reader.get_by_role("navigation")).to_have_count(0)
            expect(sync_status(reader)).to_have_count(0)
            expect(reader.get_by_role("textbox")).to_have_count(0)
            expect(button(reader, "New document")).to_have_count(0)
        token = first_link.rsplit("/", 1)[-1]
        assert httpx.get(f"{app_url}/api/shared/{token}", timeout=HTTP_SECONDS).json()["title"] == "Trip to Lisbon"


def test_revoked_link_page(browser, app_url):
    with device(browser, app_url) as page:
        join(page, fresh_email())
        visit(page, "/doc/seed-lisbon")
        click(button(page, "Share"))
        dialog = page.get_by_role("dialog", name="Share", exact=True)
        click(button(dialog, "Create link"))
        field = dialog.get_by_role("textbox", name="Share link")
        poll(page, lambda: expect(field).to_have_value(re.compile("/s/")))
        first_link = field.input_value()
        with open_app(browser, first_link) as reader:
            see(reader, reader.get_by_text("Tram 28 before nine", exact=True))
            click(button(dialog, "New link"))
            announced(page, "New link created. The old link no longer works.")
            poll(page, lambda: expect(field).not_to_have_value(first_link))
            second_link = field.input_value()
            reload(reader)
            see(reader, reader.get_by_role("heading", name="This link no longer works.", exact=True))
            expect(reader.get_by_text("Tram 28 before nine", exact=True)).to_have_count(0)
            reader.goto(second_link)
            see(reader, reader.get_by_text("Tram 28 before nine", exact=True))
            click(button(dialog, "Revoke link"))
            announced(page, "Link revoked.")
            reload(reader)
            see(reader, reader.get_by_role("heading", name="This link no longer works.", exact=True))
            expect(reader.get_by_text("Tram 28 before nine", exact=True)).to_have_count(0)
        token = second_link.rsplit("/", 1)[-1]
        assert httpx.get(f"{app_url}/api/shared/{token}", timeout=HTTP_SECONDS).status_code == 404


def test_wf_cross_cutting_device_list(browser, app_url):
    with pair(browser, app_url) as (first, second, _):
        visit(first, "/settings")
        devices = first.get_by_role("list", name="Devices", exact=True)
        see(first, devices)
        expect(devices.get_by_role("listitem")).to_have_count(2)
        current = devices.get_by_role("listitem").filter(has_text="Device 1")
        expect(current).to_contain_text("This device")
        expect(devices.get_by_role("listitem").filter(has_text="Device 2")).not_to_contain_text("This device")
        opener = button(first, "Remove Device 2")
        removed = client_for(second)
        click(opener)
        dialog = first.get_by_role("dialog", name="Remove device", exact=True)
        see(first, dialog)
        click(button(dialog, "Cancel"))
        gone(first, dialog)
        expect(devices.get_by_role("listitem")).to_have_count(2)
        click(opener)
        click(button(dialog, "Remove device"))
        gone(first, dialog)
        announced(first, "Removed Device 2.")
        poll(first, lambda: expect(devices.get_by_role("listitem")).to_have_count(1))
        notices = second.get_by_role("region", name="Notices", exact=True)
        poll(second, lambda: expect(notices).to_contain_text(
            "This device was removed from your account. Your work here stays on this device."), ONLINE_LIMIT_MS)
        assert removed.get("/api/session").json() == {}
        visit(second, "/")
        reads(second, doc_count(second), "12 of 12 documents")


def test_device_removal_api(app_url):
    email = fresh_email()
    one, _ = api(app_url, email)
    two, body = api(app_url, email, "/api/sessions")
    listed = one.get("/api/devices").json()["devices"]
    assert sorted(item["name"] for item in listed) == [device_label(1), device_label(2)]
    assert [item["current"] for item in listed if item["name"] == device_label(1)] == [True]
    assert all(item["lastSeenAt"] for item in listed)
    own = next(item["id"] for item in listed if item["current"])
    other = body["device"]["id"]
    response = one.delete(f"/api/devices/{own}")
    assert response.status_code == 409 and response.json() == {"errors": {"form": "Use Sign out on this device."}}
    stranger, _ = api(app_url)
    response = stranger.delete(f"/api/devices/{other}")
    assert response.status_code == 404 and response.json() == {"errors": {"form": "Not found."}}
    assert two.get("/api/session").json()["device"]["id"] == other
    assert one.delete(f"/api/devices/{other}").status_code == 204
    assert two.get("/api/session").status_code == 200 and two.get("/api/session").json() == {}
    assert two.get("/api/devices").status_code == 401
    assert two.get("/api/devices").json() == {"errors": {"form": "Sign in again."}}
    _, again = api(app_url, email, "/api/sessions")
    assert again["device"]["name"] == device_label(3)


def test_sync_status_sentences(browser, app_url):
    with outage_proxy(app_url) as (relay_url, rules), device(browser, relay_url) as page:
        ready(page)
        sentence(page, "This workspace is only on this device.", "offline")
        page.context.set_offline(True)
        sentence(page, "You are offline. This workspace is only on this device.", "offline")
        announced(page, "You are offline. This workspace is only on this device.")
        page.context.set_offline(False)
        sentence(page, "This workspace is only on this device.", "offline")
        unavailable = (503, json.dumps({"errors": {"form": "The server is unavailable."}}))
        rules["/api/"] = unavailable
        sentence(page, "Sync is unavailable. This workspace is only on this device.", "error")
        announced(page, "Sync is unavailable. This workspace is only on this device.")
        rules.clear()
        sentence(page, "This workspace is only on this device.", "offline")
        join(page, fresh_email())
        announced(page, "All changes are synced.")
        visit(page, "/doc/seed-lisbon")
        heading = box(page, block_name("Heading 1", "Three days in Lisbon"))
        see(page, heading)
        page.context.set_offline(True)
        for text in ("Four days", "Five days"):
            fill(page.get_by_role("textbox", name=re.compile("^Heading 1:")), text)
            advance(page, STEP_MS)
        sentence(page, "You are offline. 1 item waiting to sync.", "offline")
        announced(page, "You are offline. 1 item waiting to sync.")
        fill(box(page, "Document title"), "Trip to Porto")
        sentence(page, "You are offline. 2 items waiting to sync.", "offline")
        visit(page, "/doc/seed-shelf?view=canvas")
        see(page, card(page, "Numbered list: Oak board on brackets, not yet synced"))
        sentence(page, "You are offline. 4 items waiting to sync.", "offline")
        rules["/api/"] = unavailable
        page.context.set_offline(False)
        sentence(page, "Sync is unavailable. 4 items waiting to sync.", "error")
        announced(page, "Sync is unavailable. 4 items waiting to sync.")
        forget(page)
        rules.clear()
        sentence(page, "Syncing 4 items.", "syncing")
        sentence(page, "All changes are synced.", "synced")
        announced(page, "All changes are synced.")


def test_accessibility_main_screens(browser, app_url):
    with device(browser, app_url) as page:
        for scheme in ("light", "dark"):
            page.emulate_media(color_scheme=scheme)
            for route in MAIN_ROUTES:
                visit(page, route)
                poll(page, lambda: expect(page.get_by_role("main")).to_be_visible())
                settle(page.get_by_role("main"))
                axe(page)
        page.emulate_media(color_scheme="light")
        for route in MAIN_ROUTES:
            visit(page, route)
            see(page, page.get_by_role("main"))
            for _ in range(16):
                page.keyboard.press("Tab")
                advance(page, STEP_MS)
                if not page.evaluate(FOCUS_STOP):
                    break
                assert page.evaluate(FOCUS_MARK), route


@pytest.mark.parametrize("viewport", VIEW_IDS, ids=VIEW_IDS)
def test_pane_layouts(browser, app_url, viewport):
    size = VIEWPORTS[viewport]
    with device(browser, app_url, size) as page:
        nav = page.get_by_role("navigation", name="Workspace", exact=True)
        inspector = page.get_by_role("complementary", name="Inspector", exact=True)
        main = page.get_by_role("main")
        for route in ("/doc/seed-welcome", "/records/seed-bills"):
            visit(page, route)
            see(page, main)
            if viewport == "desktop":
                see(page, nav)
                expect(button(page, "Open navigation")).to_have_count(0)
                see(page, inspector)
                assert nav.bounding_box()["x"] < main.bounding_box()["x"] < inspector.bounding_box()["x"]
            elif viewport == "tablet":
                closed(page, nav)
                expect(button(page, "Open navigation")).to_be_visible()
                see(page, inspector)
                assert main.bounding_box()["x"] < inspector.bounding_box()["x"]
                assert main.bounding_box()["x"] <= TABLET["width"] * 0.05
            else:
                closed(page, nav)
                closed(page, inspector)
                expect(button(page, "Open navigation")).to_be_visible()
                expect(button(page, "Open inspector")).to_be_visible()
                assert main.bounding_box()["width"] >= PHONE["width"] * 0.9
        if viewport != "phone":
            visit(page, "/doc/seed-welcome?view=canvas")
            see(page, canvas(page))
            closed(page, inspector)
            expect(button(page, "Open inspector")).to_be_visible()


@pytest.mark.parametrize("viewport", VIEW_IDS, ids=VIEW_IDS)
def test_no_sideways_scrolling(browser, app_url, viewport):
    with device(browser, app_url, VIEWPORTS[viewport]) as page:
        for route in MAIN_ROUTES:
            visit(page, route)
            see(page, page.get_by_role("main"))
            if "view=canvas" in route:
                assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1")
            else:
                layout(page)


def test_inspector_sheet_motion(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/doc/seed-welcome")
        opener = button(page, "Open inspector")
        see(page, opener)
        page.evaluate(ENTRY_WATCH)
        click(opener)
        sheet = page.get_by_role("complementary", name="Inspector", exact=True)
        came_in(page, sheet)
        click(button(page, "Close inspector"))
        closed(page, sheet)
        unreachable(page, "Share")


def test_closed_panels_are_unavailable(browser, app_url):
    with device(browser, app_url, PHONE) as page:
        visit(page, "/doc/seed-welcome")
        for opener, closer, marker in (("Open navigation", "Close navigation", "Documents"),
                                       ("Open inspector", "Close inspector", "Share")):
            see(page, button(page, opener))
            order = tab_order(page, 12)
            assert marker not in order, order
            click(button(page, opener))
            close = button(page, closer)
            see(page, close)
            click(close)
            click_reopen = button(page, opener)
            click(click_reopen)
            see(page, close)
            advance(page, 1000)
            expect(close).to_be_visible()
            click(close)
            closed(page, close)
            unreachable(page, marker)
    with device(browser, app_url, TABLET) as page:
        visit(page, "/doc/seed-welcome?view=canvas")
        see(page, canvas(page))
        assert not set(NAV_LINKS) & set(ax_links(page))
        unreachable(page, "Share")


def test_colour_scheme_remembered(browser, app_url):
    with device(browser, app_url) as page:
        page.emulate_media(color_scheme="light")
        visit(page, "/settings")
        group = page.get_by_role("radiogroup", name="Colour scheme", exact=True)
        see(page, group)
        expect(group.get_by_role("radio", name="System", exact=True)).to_be_checked()
        root_is(page, "data-colour-scheme", "light")
        before = decode(capture(page.get_by_role("main")))
        pick(group.get_by_role("radio", name="Dark", exact=True))
        root_is(page, "data-colour-scheme", "dark", STEP_MS)
        assert difference(before, decode(capture(page.get_by_role("main")))) > 0
        reload(page)
        root_is(page, "data-colour-scheme", "dark")
        expect(group.get_by_role("radio", name="Dark", exact=True)).to_be_checked()
        pick(group.get_by_role("radio", name="Light", exact=True))
        root_is(page, "data-colour-scheme", "light", STEP_MS)
        page.emulate_media(color_scheme="dark")
        advance(page, STEP_MS)
        root_is(page, "data-colour-scheme", "light")
        pick(group.get_by_role("radio", name="System", exact=True))
        root_is(page, "data-colour-scheme", "dark", STEP_MS)
        page.emulate_media(color_scheme="light")
        reload(page)
        expect(group.get_by_role("radio", name="System", exact=True)).to_be_checked()
        root_is(page, "data-colour-scheme", "light")


def test_health_status_and_boot(browser, app_url):
    cases = [(app_url, "ok", {"sync": "ok", "storage": "ok"}),
             (outage_url("APP_SHORT_URL"), "ok", {"sync": "ok", "storage": "ok"}),
             (outage_url("APP_MINIO_DOWN_URL"), "unavailable", {"sync": "ok", "storage": "unavailable"}),
             (outage_url("APP_POSTGRES_DOWN_URL"), "unavailable", {"sync": "unavailable", "storage": "ok"})]
    for base, health, status in cases:
        answer = httpx.get(f"{base}/api/health", timeout=HTTP_SECONDS)
        assert answer.status_code == 200 and answer.json() == {"status": health}
        assert answer.elapsed.total_seconds() < 2
        answer = httpx.get(f"{base}/api/status", timeout=HTTP_SECONDS)
        assert answer.status_code == 200 and answer.json() == status
        answer = httpx.get(f"{base}/api/session", timeout=HTTP_SECONDS)
        assert answer.status_code == 200 and answer.json() == {}
    down = outage_url("APP_POSTGRES_DOWN_URL")
    answer = httpx.post(f"{down}/api/accounts", json={"email": fresh_email(), "password": PASSWORD}, timeout=HTTP_SECONDS)
    assert answer.status_code == 503 and answer.json() == {"errors": {"form": "The server is unavailable."}}
    answer = httpx.get(f"{down}/api/session", headers={"cookie": "oddment_session=stale"}, timeout=HTTP_SECONDS)
    assert answer.status_code == 503
    for base in (outage_url("APP_MINIO_DOWN_URL"), down):
        with device(browser, base) as page:
            reads(page, doc_count(page), "12 of 12 documents")
            new_document(page, fresh_label("Boot check"), "Local work")
            announced(page, "Saved on this device.", QUEUED_SAVED_MS)
            reload(page)
            see(page, box(page, block_name("Paragraph", "Local work")))


def test_server_boundary(browser, app_url):
    answer = httpx.post(f"{app_url}/api/accounts", json={"email": fresh_email(), "password": PASSWORD},
                        headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_SECONDS)
    assert answer.status_code == 403
    assert answer.json() == {"errors": {"form": "Cross-origin requests are not allowed."}}
    assert not answer.cookies
    answer = httpx.get(f"{app_url}/api/status", headers={"Origin": FOREIGN_ORIGIN}, timeout=HTTP_SECONDS)
    assert CORS_HEADER not in answer.headers
    origin_header = app_url.rstrip("/")
    answer = httpx.post(f"{app_url}/api/accounts", json={"email": fresh_email(), "password": PASSWORD},
                        headers={"Origin": origin_header}, timeout=HTTP_SECONDS)
    assert answer.status_code == 201
    shell = b'{"email":"nobody@example.test","password":"","pad":"'
    tail = b'"}'
    exact = shell + b"a" * (JSON_LIMIT - len(shell) - len(tail)) + tail
    headers = {"Content-Type": "application/json"}
    answer = httpx.post(f"{app_url}/api/sessions", content=exact, headers=headers, timeout=HTTP_SECONDS)
    assert answer.status_code != 413
    answer = httpx.post(f"{app_url}/api/sessions", content=exact + b" ", headers=headers, timeout=HTTP_SECONDS)
    assert answer.status_code == 413 and answer.json() == {"errors": {"form": "That request is too large."}}
    answer = httpx.get(f"{app_url}/api/not-a-real-path", timeout=HTTP_SECONDS)
    assert answer.status_code == 404 and answer.json() == {"errors": {"form": "Not found."}}
    unknown = httpx.get(f"{app_url}/not-a-real-path", timeout=HTTP_SECONDS)
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/main.ts",
                 "/server.ts", "/THIRD_PARTY_NOTICES.md"):
        answer = httpx.get(f"{app_url}{path}", timeout=HTTP_SECONDS)
        assert answer.status_code == unknown.status_code, path
        assert answer.text == unknown.text, path
    secrets = [os.environ[name] for name in ("DATABASE_URL", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY") if os.environ.get(name)]
    with open_app(browser, app_url) as page:
        bodies = []
        page.on("response", lambda r: bodies.append(r))
        reload(page)
        for route in ("/doc/seed-welcome", "/records/seed-bills", "/settings"):
            visit(page, route)
        for response in bodies:
            if same_origin(response.url, app_url):
                try:
                    text = response.text()
                except PlaywrightError:
                    continue
                assert not [secret for secret in secrets if secret in text], response.url


def test_if_run_manifest():
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[key], str) and manifest[key] for key in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [package.name for package in shipped_packages() if package.name not in notices]
    assert not missing, missing


def test_if_licences():
    refused = [package for package in shipped_packages() if not licence_allowed(package.licence, ALLOWED)]
    assert not refused, refused


def test_if_no_extra_datastore():
    banned = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3",
              "cassandra-driver", "memcached", "firebase", "firebase-admin"}
    assert not banned & {package.name for package in shipped_packages()}


def test_if_service_configuration_unchanged(app_url):
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_SECONDS).json() == {"status": "ok"}
    assert Postgres().tables()
    assert isinstance(S3().keys(), list)


def test_if_no_venv_or_absolute_symlinks():
    bad = []
    for folder, directories, files in os.walk(APP_ROOT):
        if "pyvenv.cfg" in files:
            bad.append(folder)
        for name in [*directories, *files]:
            path = Path(folder) / name
            if path.is_symlink() and os.path.isabs(os.readlink(path)):
                bad.append(str(path))
        directories[:] = [d for d in directories if d != "node_modules"]
    assert not bad, bad


def test_if_typescript_and_own_origin_assets(browser, app_url):
    sources = [p for p in APP_ROOT.rglob("*.ts*") if "node_modules" not in p.parts and p.suffix in (".ts", ".tsx")]
    assert sources
    with open_app(browser, app_url) as page:
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        for route in MAIN_ROUTES:
            visit(page, route)
        foreign = [u for u in urls if u.startswith("http") and not same_origin(u, app_url)]
        assert not foreign, foreign
