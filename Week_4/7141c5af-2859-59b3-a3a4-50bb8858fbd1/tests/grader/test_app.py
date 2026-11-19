from __future__ import annotations

import contextlib
import csv
import hashlib
import html
import io
import json
import math
import os
import random
import re
import struct
import time
import unicodedata
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    Meilisearch,
    Postgres,
    S3,
    WireMock,
    addresses,
    axe as kit_axe,
    center,
    decode,
    difference,
    held,
    layout,
    licence_allowed,
    pdf_pages,
    pdf_text,
    select as kit_select,
    session,
    shipped_packages,
    tap as kit_tap,
    text as mail_text,
    unique,
)


DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
SMALL = {"width": 320, "height": 568}
LANDSCAPE = {"width": 812, "height": 375}
A4_CSS_WIDTH = 794
JSON_LIMIT = 1_000_000
PHOTO_LIMIT = 8_000_000
PHOTO_IN_BIG_REQUEST = 7_990_000
WORKBOOK_LIMIT = 2_000_000
QUERY_LIMIT = 200
DEPTH_LIMIT = 16
PAGE_SIZE = 25
SEARCH_RESULTS = 20
REFRESH_MS = 5000
SEARCH_FINDS_SECONDS = 5
QUICK_ANSWER_SECONDS = 1
MOTION_MS = (160, 320, 640)
STEP_MS = 160
GLIDE_MS = 320
TOUCH_PX = 44
RAIL_LINE_PX = 96
SCROLLED_PX = 24
HIDE_WIDTH_CM = 200
HIDE_HEIGHT_CM = 240
HIDE_AREA_SQCM = Decimal("48000")
SQFT_SQCM = Decimal("929.0304")
PIECE_SIZES = {"Seat": (62, 58), "Back": (62, 74), "Left side": (30, 74), "Right side": (30, 74), "Headrest": (40, 22)}
SHORT_CLIENT_PAGE_SECONDS = 20
SHORT_REMINDER_SECONDS = 10
SHORT_STOCK_SECONDS = 10
SHORT_CLOSURE_SECONDS = 20
SHORT_SESSION_SECONDS = 20
OUTAGE_CLOSURE_SECONDS = 5
PRIMARY_CLIENT_PAGE_SECONDS = 1209600
PRIMARY_CLOSURE_SECONDS = 2592000
ENQUIRY_WINDOW_SECONDS = 3600
FILE_WINDOW_SECONDS = 3600
BENCH_DAY_START_HOUR = 9
GLUE_HOURS = 48
LABEL_BYTES = b"%PDF-1.4 portico label\n"
LABEL_SHA = "10b41b820211bdb162a7ee68a13fc3425999ee467b8e38b9059514da8a66a956"
FOLDED_NAME = "zoe orsted"
FULL_NAME = "Zoë Ørsted"

HTTP_TIMEOUT = 30
API_DEADLINE = 30
UI_DEADLINE = 20
MAIL_DEADLINE = 30
TICK_MS = 50
TAB_LIMIT = 80
TRAP_PRESSES = 20
MID_TOLERANCE_PX = 12
RETRY_AFTER_PROBE = 5
PAGING_PIECES = PAGE_SIZE + 3
PRESS_WAIT_S = 15
PICK_WAIT_S = 10
ENTRANCE_WAIT_S = 10
ACTION_TIMEOUT_MS = 5000
NAVIGATION_TIMEOUT_MS = 15000
LOAD_WAIT_MS = 8000
SLOW_RATE = 0.05
RING_DIFF = 0.5
RING_BAND = 8
RING_STOPS = 6
OUTLINE_BAND = 5
MARK_DIFF = 0.01
HOLD_OPEN_MS = 800
FRAME_WAIT_MS = 120
STILL_GAP_MS = 300
STILL_WAIT_S = 10
A4_CSS_HEIGHT = 1123
PAST_LINE_PX = 1
GRIP_INSET_PX = 10
STRIP_HOLD_MS = 3000
TOKEN_MIN_CHARS = 22

FOREIGN_ORIGIN = "http://elsewhere.example"
PROTOCOL_RELATIVE = FOREIGN_ORIGIN.removeprefix("http:")
BOLD_WORD = "boldword"
ITALIC_WORD = "italicword"
WEB_WORD = "webword"
MAIL_WORD = "mailword"
BAD_WORD = "badword"
FTP_WORD = "ftpword"
WEB_ADDRESS = "https://example.org/a"
MAIL_ADDRESS = "mailto:a@example.org"
BAD_ADDRESS = "javascript:alert(1)"
IMG_OPEN = "<img"
SCRIPT_OPEN = "<script>"
INTERNALS = re.compile(r"(Traceback|node_modules|\bSELECT\b|\bINSERT INTO\b|/app/|\.ts:\d|\.js:\d|\bat [\w.]+ \(|ECONNREFUSED|postgres|prisma|knex)", re.I)
INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$")
LOOKS_LIKE_INSTANT = re.compile(r"^\d{4}-\d{2}-\d{2}T\d")

TOWNS = {
    "Turin": ZoneInfo("Europe/Rome"),
    "London": ZoneInfo("Europe/London"),
    "New York": ZoneInfo("America/New_York"),
    "Kyoto": ZoneInfo("Asia/Tokyo"),
    "Dubai": ZoneInfo("Asia/Dubai"),
}
TURIN = TOWNS["Turin"]
UTC = timezone.utc
DAYS = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
MONTHS = ("Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec")
CASES = {
    "bentwood-armchair": ("Bentwood armchair", "leather"),
    "tubular-lounge": ("Tubular lounge", "leather"),
    "swivel-desk-chair": ("Swivel desk chair", "leather"),
    "folding-deck-chair": ("Folding deck chair", "fabric"),
    "cantilever-side-chair": ("Cantilever side chair", "fabric"),
    "slat-bench": ("Slat bench", "frame-only"),
}
CASE_SECTIONS = ("01 As it came", "02 What we found", "03 The cover", "04 The frame", "05 Keeping it well", "06 Files")
CASE_HASHES = ("#as-it-came", "#what-we-found", "#the-cover", "#the-frame", "#keeping-it-well", "#files")
DOSSIER_SECTIONS = ("01 The piece", "02 Condition", "03 Materials", "04 Photographs", "05 Care card", "06 History")

RECORDER = """
(() => {
  if (window.__motions) return;
  window.__motions = [];
  const seen = new WeakSet();
  const clean = (n) => Math.round(n * 1000) / 1000;
  const declared = (a, timing) => {
    if (!a.transitionProperty) return Number(timing.duration) || 0;
    const style = getComputedStyle(a.effect.target, a.effect.pseudoElement || undefined);
    const names = style.transitionProperty.split(',').map((s) => s.trim());
    const times = style.transitionDuration.split(',').map((s) => s.trim());
    let at = names.lastIndexOf(a.transitionProperty);
    if (at < 0) at = names.lastIndexOf('all');
    if (at < 0) return Number(timing.duration) || 0;
    const value = times[at % times.length];
    return value.endsWith('ms') ? parseFloat(value) : parseFloat(value) * 1000;
  };
  const note = (a, source) => {
    if (seen.has(a) || !a.effect || !a.effect.target) return;
    seen.add(a);
    const t = a.effect.getComputedTiming();
    const el = a.effect.target;
    const near = (q) => (el.closest ? el.closest(q) : null);
    const attr = (q, n) => { const owner = near(q); return owner ? owner.getAttribute(n) : null; };
    const kase = attr('[data-case]', 'data-case');
    window.__motions.push({
      source, part: attr('[data-part]', 'data-part'), piece: attr('[data-piece]', 'data-piece'), kase,
      caseCount: kase ? document.querySelectorAll('[data-part="case-drawing"][data-case="' + kase + '"]').length : null,
      dialog: !!(near('dialog,[role="dialog"]') || (el.querySelector && el.querySelector('dialog,[role="dialog"]'))),
      duration: clean(declared(a, t)), iterations: t.iterations,
    });
  };
  const native = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = native.apply(this, args); note(a, 'waapi'); return a; };
  for (const type of ['transitionrun', 'animationstart']) {
    document.addEventListener(type, (e) => { for (const a of (e.target.getAnimations ? e.target.getAnimations() : [])) note(a, 'css'); }, true);
  }
  window.__sweep = () => { for (const a of document.getAnimations()) note(a, 'sweep'); return window.__motions; };
})();
"""

UNCOVERED = """
() => {
  const a = document.activeElement;
  if (!a || a === document.body) return true;
  const label = a.labels && a.labels.length ? a.labels[0] : null;
  const own = a.getBoundingClientRect();
  const r = (own.width <= 2 || own.height <= 2) && label ? label.getBoundingClientRect() : own;
  const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
  const ys = r.height < innerHeight * 0.6 ? [r.top + 2, r.top + r.height / 2, r.bottom - 2] : [Math.min(innerHeight - 1, Math.max(0, r.top + r.height / 2))];
  return ys.every((y) => {
    if (y < 0 || y >= innerHeight) return false;
    const hit = document.elementFromPoint(x, y);
    return !!hit && (hit === a || a.contains(hit) || hit.contains(a) || (!!label && (label === hit || label.contains(hit))));
  });
}
"""

BOX_JS = """e => { const small = r => r.width <= 2 || r.height <= 2;
  const box = small(e.getBoundingClientRect()) && e.labels && e.labels[0] ? e.labels[0] : e;
  const r = box.getBoundingClientRect(); return {x: r.left, y: r.top, width: r.width, height: r.height}; }"""

FINISH_JS = """() => document.getAnimations().forEach((a) => {
  if (a.effect && Number.isFinite(a.effect.getComputedTiming().endTime)) a.finish(); })"""

PICK_JS = """e => {
  e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
  const at = (el) => {
    const r = el.getBoundingClientRect();
    if (r.width < 3 || r.height < 3) return null;
    const x = r.left + r.width / 2, y = r.top + r.height / 2, hit = document.elementFromPoint(x, y);
    return hit && (hit === el || el.contains(hit)) ? {x, y} : null;
  };
  const own = at(e);
  if (own) return own;
  const label = (e.labels && e.labels[0]) || e.closest('label');
  return label ? at(label) : null;
}"""

ANIMATED_JS = """el => document.getAnimations().some((a) => { const t = a.effect && a.effect.target;
  return t && Number.isFinite(a.effect.getComputedTiming().endTime) && (t === el || t.contains(el) || el.contains(t)); })"""

ENTRANCE_JS = """el => {
  const finite = (a) => a.effect && a.effect.target && Number.isFinite(a.effect.getComputedTiming().endTime);
  const near = (t) => t === el || t.contains(el) || el.contains(t);
  const all = document.getAnimations().filter(finite);
  const nodes = [...new Set([el, ...all.map((a) => a.effect.target).filter(near)])];
  const read = (n) => { const r = n.getBoundingClientRect(); return {left: r.left, top: r.top, width: r.width, height: r.height}; };
  all.forEach((a) => { a.pause(); a.currentTime = 0; });
  const starts = nodes.map(read);
  all.forEach((a) => a.finish());
  const ends = nodes.map(read);
  const moved = (i) => ['left', 'top', 'width', 'height'].some((k) => Math.abs(starts[i][k] - ends[i][k]) > 1);
  let chosen = 0, area = -1;
  nodes.forEach((n, i) => { const size = ends[i].width * ends[i].height; if (moved(i) && size > area) { chosen = i; area = size; } });
  return {start: starts[chosen], end: ends[chosen]};
}"""

MIDWAY_JS = """el => {
  const near = (t) => t === el || t.contains(el) || el.contains(t);
  const moving = document.getAnimations().filter((a) => a.effect && a.effect.target && Number.isFinite(a.effect.getComputedTiming().endTime) && near(a.effect.target));
  if (!moving.length) return null;
  moving.forEach((a) => { a.pause(); a.currentTime = a.effect.getComputedTiming().duration / 2; });
  const r = el.getBoundingClientRect();
  return {left: r.left, top: r.top, width: r.width, height: r.height};
}"""

RECT_JS = """el => { const r = el.getBoundingClientRect(); return {left: r.left, top: r.top, width: r.width, height: r.height}; }"""

LIVE_SELECTOR = '[role="status"],[role="alert"],[aria-live],output'

WATCH_JS = """(live) => { if (window.__said) return; window.__said = [];
  new MutationObserver((records) => { const seen = new Set();
    for (const r of records) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement; const box = t && t.closest(live);
      if (box && !seen.has(box)) { seen.add(box); const text = box.textContent.trim(); if (text) window.__said.push(text); } }
  }).observe(document.documentElement, {subtree: true, childList: true, characterData: true}); }"""

SCROLLER_JS = """h => { for (let n = h.parentElement; n && n !== document.body; n = n.parentElement) {
    const s = getComputedStyle(n).overflowY;
    if ((s === 'auto' || s === 'scroll') && n.scrollHeight > n.clientHeight) return n; }
  return document.scrollingElement; }"""

SMALL_TARGETS = """
(limit) => {
  const out = [];
  const nodes = document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[role="radio"],[role="checkbox"],[role="slider"],[role="combobox"],[role="tab"]');
  for (const el of nodes) {
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || el.type === 'hidden') continue;
    if (el.closest('[inert],[aria-hidden="true"]')) continue;
    const label = el.labels && el.labels.length ? el.labels[0] : null;
    const own = el.getBoundingClientRect();
    const tiny = own.width <= 2 || own.height <= 2;
    if (tiny && !label) continue;
    if ((s.position === 'absolute' || s.position === 'fixed') && (own.right <= 0 || own.bottom <= 0 || own.left >= innerWidth)) continue;
    if (el.tagName === 'A' && el.parentElement) {
      const words = [...el.parentElement.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent).join(' ').trim().split(/\\s+/).filter(Boolean);
      if (words.length >= 3) continue;
    }
    const target = el.tagName === 'INPUT' && label && (['radio', 'checkbox'].includes(el.type) || (el.type === 'file' && tiny)) ? label : el;
    const box = target.getBoundingClientRect();
    if (box.width >= limit - 0.5 && box.height >= limit - 0.5) continue;
    target.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'});
    const r = target.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2, h = limit / 2 - 0.5;
    const owned = [[cx - h, cy], [cx + h, cy], [cx, cy - h], [cx, cy + h]].every(([x, y]) => {
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) return true;
      const hit = document.elementFromPoint(x, y);
      return !!hit && (hit === target || target.contains(hit) || (!!label && (hit === label || label.contains(hit))));
    });
    if (!owned) out.push((el.getAttribute('aria-label') || el.textContent || el.name || el.tagName).trim().slice(0, 60) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
  }
  return out;
}
"""

CUT_TEXT = """() => { const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const owner = n.parentElement;
    if (!owner || !owner.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    if (owner.closest('[aria-hidden="true"],[data-part="hide-figure"],[data-part="estimate-total"]')) continue;
    const range = document.createRange(); range.selectNodeContents(n);
    const text = range.getBoundingClientRect();
    if (text.width < 1 || text.height < 1) continue;
    const label = n.textContent.trim().slice(0, 40);
    if (getComputedStyle(owner).textOverflow === 'ellipsis' && owner.scrollWidth > owner.clientWidth + 1) { bad.push(label); continue; }
    let skipStatic = false, freeX = false, freeY = false;
    for (let box = owner; box && box !== document.body; box = box.parentElement) {
      const s = getComputedStyle(box);
      if (!(skipStatic && s.position === 'static')) {
        skipStatic = false;
        const x = s.overflowX === 'hidden' || s.overflowX === 'clip', y = s.overflowY === 'hidden' || s.overflowY === 'clip';
        if (x || y) {
          const b = box.getBoundingClientRect();
          if (b.width <= 2 || b.height <= 2) break;
          if ((x && !freeX && (text.right > b.right + 1 || text.left < b.left - 1)) || (y && !freeY && (text.bottom > b.bottom + 1 || text.top < b.top - 1))) { bad.push(label); break; }
        }
        freeX = freeX || s.overflowX === 'auto' || s.overflowX === 'scroll';
        freeY = freeY || s.overflowY === 'auto' || s.overflowY === 'scroll';
      }
      if (s.position === 'fixed') break;
      if (s.position === 'absolute') skipStatic = true;
    }
  }
  return bad; }"""

TEXT_SPACING = "*{line-height:1.5 !important;letter-spacing:0.12em !important;word-spacing:0.16em !important} p{margin-bottom:2em !important}"


def http(method: str, url: str, **kw: Any) -> httpx.Response:
    kw.setdefault("timeout", HTTP_TIMEOUT)
    return httpx.request(method, url, **kw)


def word(length: int = 12) -> str:
    return "".join(random.choice("bcdfghjklmnpqrstvwxz") for _ in range(length))


def names(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    return (second, first) if "@" in first else (first, second)


def luhn_stamp() -> str:
    body = [random.randint(0, 9) for _ in range(7)]
    total = 0
    for i, digit in enumerate(reversed(body)):
        doubled = digit * 2 if i % 2 == 0 else digit
        total += doubled - 9 if doubled > 9 else doubled
    return "".join(map(str, body)) + str((10 - total % 10) % 10)


def bad_stamp(stamp: str) -> str:
    return stamp[:-1] + str((int(stamp[-1]) + 1) % 10)


def png(seed: str | None = None, pad_to: int = 0) -> bytes:
    colour = hashlib.sha256((seed or word()).encode()).digest()[:3]
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + colour * 8 for _ in range(8))
    data = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")
    return data + b"\x00" * max(0, pad_to - len(data))


def jpeg(seed: str | None = None) -> bytes:
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + (seed or word()).encode() + b"\xff\xd9"


def turin_today() -> date:
    return datetime.now(TURIN).date()


def date_copy(d: date) -> str:
    return f"{DAYS[d.weekday()]} {d.day} {MONTHS[d.month - 1]} {d.year}"


def parse_instant(value: str) -> datetime:
    assert INSTANT.match(value), f"instant {value!r} is not whole-second UTC with a Z"
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def to_instant(moment: datetime) -> str:
    return moment.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def wall(moment: datetime, town: str = "Turin") -> str:
    return moment.astimezone(TOWNS[town]).strftime("%H:%M")


def minute_labels(low: datetime, high: datetime) -> set[str]:
    labels = set()
    moment = low.replace(second=0, microsecond=0)
    for _ in range(int((high - low).total_seconds() // 60) + 3):
        labels.add(wall(moment))
        moment += timedelta(minutes=1)
    return labels


def next_clock_change(zone: ZoneInfo, after: date) -> date:
    day = after
    for _ in range(400):
        next_day = day + timedelta(days=1)
        if datetime(day.year, day.month, day.day, 12, tzinfo=zone).utcoffset() != datetime(next_day.year, next_day.month, next_day.day, 12, tzinfo=zone).utcoffset():
            return next_day
        day = next_day
    pytest.fail("no clock change found within a year of today")


def clock_change(zone: ZoneInfo, forward: bool) -> date:
    day = next_clock_change(zone, turin_today())
    for _ in range(3):
        before = datetime(day.year, day.month, day.day, 0, tzinfo=zone).utcoffset()
        later = datetime(day.year, day.month, day.day, 12, tzinfo=zone).utcoffset()
        if (later > before) == forward:
            return day
        day = next_clock_change(zone, day)
    pytest.fail("no clock change of the wanted direction found")


def future_monday(weeks: int = 4) -> date:
    today = turin_today()
    return today + timedelta(days=7 - today.weekday() + 7 * weeks)


def poll(fn: Callable[[], Any], contract: str, seconds: float = API_DEADLINE) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            value = fn()
            if value:
                return value
    pytest.fail(f"expected within {seconds}s: {contract}")


def advance(page: Page, milliseconds: float) -> None:
    deadline = time.monotonic() + milliseconds / 1000
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            page.evaluate("() => 0")


def wait_ui(page: Page, predicate: Callable[[], Any], contract: str, seconds: float = UI_DEADLINE) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            if predicate():
                return
        advance(page, TICK_MS)
    pytest.fail(f"expected on screen within {seconds}s: {contract}")


class ScriptsByEvaluate:

    def __init__(self, page: Page) -> None:
        self.page = page

    def add_script_tag(self, path: str) -> None:
        self.page.evaluate(Path(path).read_text())

    def __getattr__(self, name: str) -> Any:
        return getattr(self.page, name)


def axe(page: Page) -> None:
    page.evaluate(FINISH_JS)
    kit_axe(ScriptsByEvaluate(page))


def pressing(locator: Locator, act: Callable[[], Any]) -> None:
    deadline = time.monotonic() + PRESS_WAIT_S
    refused: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            act()
            return
        except (AssertionError, PlaywrightError) as error:
            refused = error
            if "obscured" in str(error):
                with contextlib.suppress(PlaywrightError):
                    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})", timeout=2_000)
    assert refused is not None
    raise refused


def tap(locator: Locator) -> None:
    pressing(locator, lambda: kit_tap(locator))


def select(locator: Locator, choice: str) -> None:
    pressing(locator, lambda: kit_select(locator, choice))


def pick(choice: Locator, touch: bool = False) -> None:
    page = choice.page
    expect(choice).to_be_attached()
    point = poll(lambda: choice.evaluate(PICK_JS), "a hit target for the choice or its label", PICK_WAIT_S)
    (page.touchscreen.tap if touch else page.mouse.click)(point["x"], point["y"])
    expect(choice).to_be_checked()


def loaded(page: Page) -> None:
    with contextlib.suppress(PlaywrightError):
        page.wait_for_load_state("networkidle", timeout=LOAD_WAIT_MS)


def walk_instants(value: Any, where: str = "$") -> None:
    if isinstance(value, dict):
        for key, inner in value.items():
            walk_instants(inner, f"{where}.{key}")
    elif isinstance(value, list):
        for i, inner in enumerate(value):
            walk_instants(inner, f"{where}[{i}]")
    elif isinstance(value, str) and LOOKS_LIKE_INSTANT.match(value):
        assert INSTANT.match(value), f"{where} = {value!r}; expected whole-second UTC with a Z"


def assert_error(resp: httpx.Response, status: int, message: str | re.Pattern[str] | None = None, code: str | None = None) -> dict[str, Any]:
    assert resp.status_code == status, f"expected {status}, got {resp.status_code}: {resp.text[:400]}"
    assert "json" in resp.headers.get("content-type", ""), f"error is not JSON: {resp.headers.get('content-type')}"
    body = resp.json()
    assert set(body) == {"error"}, f"error shape: {body}"
    error = body["error"]
    assert isinstance(error.get("code"), str) and isinstance(error.get("message"), str), f"error shape: {body}"
    assert set(error) <= {"code", "message", "fields"}, f"error shape: {body}"
    assert not INTERNALS.search(resp.text), f"internals in error: {resp.text[:400]}"
    if isinstance(message, str):
        found = [error["message"], *map(str, (error.get("fields") or {}).values())]
        assert message in found, f"expected copy {message!r} in {found}"
    elif message is not None:
        assert message.fullmatch(error["message"]), f"expected {message.pattern!r}, got {error['message']!r}"
    if code is not None:
        assert error["code"] == code, f"expected code {code}, got {error['code']}"
    return error


def copy_url(env: str) -> str:
    return os.environ[env].rstrip("/")


def journal(wiremock: Any, path: str, method: str | None = None) -> list[dict[str, Any]]:
    out = []
    for entry in wiremock.requests(path, method):
        headers = {}
        for key, value in (entry.get("headers") or {}).items():
            if isinstance(value, dict):
                value = value.get("values", [""])
            if isinstance(value, list):
                value = value[0] if value else ""
            headers[key.lower()] = value
        out.append({"query": entry["query"], "method": entry["method"], "body": entry["json"] if entry["json"] is not None else {}, "headers": headers})
    return out


def texts(body: dict[str, Any]) -> dict[str, str]:
    return {key: str(value) for key, value in body.items()}


def unknown_like(real: Any) -> str:
    text = str(real)
    if text.isdigit():
        return str(int(text) + 10_000_000)
    return text[:-1] + ("0" if text[-1] != "0" else "1")


def named(name: str) -> re.Pattern[str]:
    return re.compile(rf"^\s*{re.escape(name)}(?![a-z0-9-]|\s+[a-z0-9])")


def mails_to(mail: Any, address: str, count: int = 1, seconds: float = MAIL_DEADLINE) -> list[dict[str, Any]]:
    def found() -> list[dict[str, Any]]:
        return [m for m in mail.messages(settle=0.2) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
    poll(lambda: len(found()) >= count, f"{count} mail(s) to {address}", seconds)
    return found()


def mails_from_visitor(mail: Any, address: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=0.5) if address.lower() in [a.lower() for a in addresses(m.get("ReplyTo"))]]


class Desk:

    def __init__(self, base: str, email: str, password: str, name: str = "", desk_id: str = "", cookie: str = "") -> None:
        self.base, self.email, self.password, self.name, self.id, self.cookie = base, email, password, name, desk_id, cookie

    def call(self, method: str, path: str, **kw: Any) -> httpx.Response:
        headers = dict(kw.pop("headers", {}))
        if self.cookie:
            headers["Cookie"] = self.cookie
        return http(method, self.base + path, headers=headers, **kw)

    def j(self, method: str, path: str, expected: int = 200, **kw: Any) -> dict[str, Any]:
        resp = self.call(method, path, **kw)
        assert resp.status_code == expected, f"{method} {path}: expected {expected}, got {resp.status_code}: {resp.text[:400]}"
        return resp.json()

    def sign_in(self, page: Page) -> None:
        resp = page.request.post(f"{self.base}/api/session", data={"email": self.email, "password": self.password})
        assert resp.status == 200, f"sign-in answered {resp.status}"

    def add_client(self, town: str = "Turin", language: str | None = None, name: str | None = None, email: str | None = None) -> dict[str, Any]:
        body: dict[str, Any] = {"name": name or f"Client {word()}", "town": town, "email": email or f"{word()}@clients.example"}
        if language:
            body["language"] = language
        return self.j("POST", "/api/clients", 201, json=body)["client"]

    def add_piece(self, client_id: str, title: str | None = None, due_days: int | None = 21, dims: bool = True, **extra: Any) -> dict[str, Any]:
        body: dict[str, Any] = {"clientId": client_id, "title": title or f"Chair {word()}", **extra}
        if dims:
            body.update(widthCm=66, depthCm=70, heightCm=78, weightKg=12.5)
        if due_days is not None:
            body["dueDate"] = (turin_today() + timedelta(days=due_days)).isoformat()
        return self.j("POST", "/api/pieces", 201, json=body)["piece"]

    def add_estimate(self, piece_id: str, code: str | None = "VM-2041", lot: str | None = "L-2041-A", area: str = "14.54", hours: str = "12.50") -> dict[str, Any]:
        body: dict[str, Any] = {"materialCode": code, "lot": lot, "labourHours": hours}
        if code:
            body["patternAreaSqFt"] = area
        return self.j("POST", f"/api/pieces/{piece_id}/estimates", 201, json=body)["estimate"]

    def upload(self, piece_id: str, data: bytes, side: str = "before", name: str = "photo.png", kind: str = "image/png") -> httpx.Response:
        return self.call("POST", f"/api/pieces/{piece_id}/photographs", files={"file": (name, data, kind)}, data={"side": side})

    def layout(self, piece_id: str) -> dict[str, Any]:
        return self.j("GET", f"/api/pieces/{piece_id}/layout")["layout"]

    def place(self, piece_id: str, name: str, x: Any, y: Any, rotation: Any = 0, version: int | None = None) -> httpx.Response:
        if version is None:
            version = self.layout(piece_id)["version"]
        return self.call("PUT", f"/api/pieces/{piece_id}/layout/placements/{quote(name)}", json={"x": x, "y": y, "rotation": rotation, "version": version})

    def search(self, q: str) -> httpx.Response:
        return self.call("GET", "/api/search", params={"q": q})


def new_desk(base: str) -> Desk:
    name, email = names("desk")
    password = f"long-enough-{word(6)}"
    resp = http("POST", f"{base}/api/sign-up", json={"name": name, "email": email, "password": password})
    assert resp.status_code == 201, f"sign-up answered {resp.status_code}: {resp.text[:300]}"
    return Desk(base, email, password, name, resp.json()["session"]["deskId"], resp.headers["set-cookie"].split(";")[0])


def seed_desk(base: str, who: str = "agnese") -> Desk:
    email, password = {"agnese": ("agnese@bottega-semenza.example", "tacks-and-hide-2027"), "ruben": ("ruben@bottega-semenza.example", "second-desk-2027")}[who]
    resp = http("POST", f"{base}/api/session", json={"email": email, "password": password})
    assert resp.status_code == 200, f"seeded sign-in answered {resp.status_code}: {resp.text[:300]}"
    return Desk(base, email, password, resp.json()["session"]["name"], resp.json()["session"]["deskId"], resp.headers["set-cookie"].split(";")[0])


def token_of(address: str) -> str:
    return urlparse(address).path.rsplit("/", 1)[-1]


def client_page_setup(desk: Desk, town: str = "Turin", language: str | None = None, name: str | None = None, due_days: int = 21, code: str | None = "VM-2041", lot: str | None = "L-2041-A", photos: bool = False, send: bool = True) -> SimpleNamespace:
    client = desk.add_client(town, language, name)
    piece = desk.add_piece(client["id"], due_days=due_days)
    desk.j("POST", f"/api/pieces/{piece['id']}/pins", 201, json={"x": 20.0, "y": 30.0, "kind": "tear", "note": "**Tear** along the front seam", "signed": True})
    desk.j("POST", f"/api/pieces/{piece['id']}/pins", 201, json={"x": 80.0, "y": 30.0, "kind": "looseJoint", "note": "Check again before quoting", "signed": False})
    if photos:
        assert desk.upload(piece["id"], png(), "before").status_code == 201
        assert desk.upload(piece["id"], png(), "after").status_code == 201
    estimate = desk.add_estimate(piece["id"], code, lot)
    page_body = desk.j("POST", f"/api/pieces/{piece['id']}/client-page", 201, json={})["clientPage"] if send else None
    return SimpleNamespace(client=client, piece=piece, estimate=estimate, page=page_body, token=token_of(page_body["address"]) if page_body else None)


def signed_off_piece(desk: Desk, town: str = "Turin", language: str | None = None, photos: bool = True) -> SimpleNamespace:
    setup = client_page_setup(desk, town, language, name=f"Owner {word()}", photos=photos)
    resp = http("POST", f"{desk.base}/api/client-pages/{setup.token}/sign-off", json={"estimateId": setup.estimate["id"], "typedName": setup.client["name"]})
    assert resp.status_code == 200, f"sign-off answered {resp.status_code}: {resp.text[:300]}"
    return setup


def dossier_settled(desk: Desk, piece_id: str, wanted: tuple[str, ...] = ("stored", "failed", "signed")) -> dict[str, Any]:
    def read() -> dict[str, Any] | None:
        resp = desk.call("GET", f"/api/pieces/{piece_id}/dossier")
        if resp.status_code == 200 and resp.json()["dossier"]["state"] in wanted:
            return resp.json()["dossier"]
        return None
    return poll(read, f"dossier reaches one of {wanted}")


@contextmanager
def screen(browser: Browser, base: str, path: str | None, desk: Desk | None = None, size: dict[str, int] = DESKTOP, reduced_motion: str = "no-preference") -> Iterator[Page]:
    context = browser.new_context(viewport=size, has_touch=True, reduced_motion=reduced_motion, service_workers="block")
    try:
        context.add_init_script(RECORDER)
        page = context.new_page()
        page.set_default_timeout(ACTION_TIMEOUT_MS)
        page.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)
        if desk:
            desk.sign_in(page)
        if path is not None:
            page.goto(f"{base}{path}")
            loaded(page)
        yield page
    finally:
        context.close()


def writes_layout(response: Any) -> bool:
    return response.request.method != "GET" and "/layout" in urlparse(response.url).path


@contextmanager
def hold_reads(page: Page) -> Iterator[None]:
    waiting: list[Any] = []
    def hold(route: Any) -> None:
        if route.request.method == "GET" and route.request.resource_type in ("fetch", "xhr"):
            waiting.append(route)
        else:
            route.fallback()
    page.route("**/*", hold)
    try:
        yield
    finally:
        page.unroute("**/*", hold)
        for route in waiting:
            with contextlib.suppress(PlaywrightError):
                route.fallback()


def escape_panel(page: Page, panel: Locator) -> None:
    if panel.get_by_role("combobox", expanded=True).count():
        page.keyboard.press("Escape")
        expect(panel).to_be_visible()
    page.keyboard.press("Escape")


def still_open(page: Page, sheet: Locator, press: Callable[[], Any]) -> None:
    page.evaluate(FINISH_JS)
    advance(page, STILL_GAP_MS)
    if sheet.count() == 0:
        press()
        wait_ui(page, lambda: sheet.count() > 0, "the sheet opens again")


def landed(page: Page) -> None:
    advance(page, GLIDE_MS + FRAME_WAIT_MS)


def file_field(page: Page, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True).or_(page.get_by_label(name, exact=True)).first


def press_file_field(field: Locator, touch: bool = False) -> None:
    page = field.page
    expect(field).to_be_attached()
    point = poll(lambda: field.evaluate(PICK_JS), "a hit target for the file field or its label", PICK_WAIT_S)
    (page.touchscreen.tap if touch else page.mouse.click)(point["x"], point["y"])


def has_ring(page: Page) -> bool:
    if not page.evaluate("() => document.activeElement && document.activeElement !== document.body"):
        return False
    box = page.evaluate_handle("() => document.activeElement").as_element().evaluate(BOX_JS)
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - RING_BAND), max(0, box["y"] - RING_BAND)
    clip = {"x": x0, "y": y0, "width": min(view["width"], box["x"] + box["width"] + RING_BAND) - x0,
            "height": min(view["height"], box["y"] + box["height"] + RING_BAND) - y0}
    if clip["width"] < 1 or clip["height"] < 1:
        return False
    page.mouse.move(1, 1)
    shown = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => { window.__ringFocus = document.activeElement; window.__ringFocus.blur(); }")
    hidden = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => window.__ringFocus.focus()")
    return difference(shown, hidden) > RING_DIFF


def entrance(page: Page, act: Callable[[], Any], target: Locator) -> dict[str, Any]:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    try:
        act()
        expect(target).to_be_attached()
        poll(lambda: target.evaluate(ANIMATED_JS), "the opening runs as a browser animation", ENTRANCE_WAIT_S)
        motions(page)
        return target.evaluate(ENTRANCE_JS)
    finally:
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})


def carries_on(page: Page, target: Locator, first: Callable[[], Any], then: Callable[[], Any], allowance: float = MID_TOLERANCE_PX) -> None:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    try:
        first()
        poll(lambda: target.evaluate(ANIMATED_JS), "the motion runs as a browser animation", ENTRANCE_WAIT_S)
        mid = target.evaluate(MIDWAY_JS)
        then()
        now = target.evaluate(RECT_JS)
    finally:
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    assert all(abs(now[key] - mid[key]) <= allowance for key in ("left", "top", "width", "height")), f"it jumped: from {mid} to {now}"


def state_mark(page: Page, control: Locator, act: Callable[[], Any]) -> None:
    page.emulate_media(forced_colors="active")
    def picture(clip: dict[str, float]) -> Any:
        page.mouse.move(1, 1)
        page.evaluate(FINISH_JS)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        return decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    control.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})")
    box = control.evaluate(BOX_JS)
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - OUTLINE_BAND), max(0, box["y"] - OUTLINE_BAND)
    clip = {"x": x0, "y": y0, "width": max(1, min(view["width"], box["x"] + box["width"] + OUTLINE_BAND) - x0),
            "height": max(1, min(view["height"], box["y"] + box["height"] + OUTLINE_BAND) - y0)}
    before = picture(clip)
    act()
    after = picture(clip)
    page.emulate_media(forced_colors="none")
    assert difference(before, after) > MARK_DIFF, "SR18: under forced colours this state shows by a background colour alone"


def assert_touch_targets(page: Page) -> None:
    small = page.evaluate(SMALL_TARGETS, TOUCH_PX)
    assert not small, f"SR4: touch areas under {TOUCH_PX} px: {small}"


def no_cut_text(page: Page) -> None:
    cut = page.evaluate(CUT_TEXT)
    assert not cut, f"SR16: text cut off: {cut}"


def spaced(page: Page) -> None:
    page.evaluate("(css) => { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }", TEXT_SPACING)


def fixed_bottom(bar: Locator, size: dict[str, int]) -> None:
    wait_ui(bar.page, lambda: bar.count() > 0, "the bottom bar shows")
    script = "el => { for (let n = el; n && n !== document.body; n = n.parentElement) { if (getComputedStyle(n).position === 'fixed') return n.getBoundingClientRect().bottom; } return null; }"
    placed = bar.first.evaluate(script)
    assert placed is not None, "SR6: the main action is not in a fixed bar"
    assert size["height"] - 2 <= placed <= size["height"] + 2, f"SR6: the bar's bottom sits at {placed}"


def print_only_content(page: Page, heading: str) -> None:
    page.set_viewport_size({"width": A4_CSS_WIDTH, "height": A4_CSS_HEIGHT})
    page.emulate_media(media="print")
    try:
        expect(page.get_by_role("heading", level=1, name=heading, exact=True)).to_be_visible()
        for role, name in (("banner", None), ("navigation", "Sections"), ("toolbar", "Main action"), ("button", "Sign out")):
            found = page.get_by_role(role, name=name, exact=True) if name else page.get_by_role(role)
            assert found.count() == 0 or not found.first.is_visible(), f"SR26: {name or role} prints"
        spoken = page.evaluate("(q) => [...document.querySelectorAll(q)].filter((e) => e.textContent.trim() && e.checkVisibility() && e.getBoundingClientRect().width > 2).map((e) => e.textContent.trim().slice(0, 40))", LIVE_SELECTOR)
        assert not spoken, f"SR26: a live region prints: {spoken}"
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "SR26: something runs past an A4 page's width"
    finally:
        page.emulate_media(media="screen")
        page.set_viewport_size(DESKTOP)


def images_hold_still(browser: Browser, base: str, path: str, owner: Desk | None, heading: str) -> None:
    held_images: list[Any] = []
    def hold(route: Any) -> None:
        if route.request.resource_type == "image":
            held_images.append(route)
        else:
            route.fallback()
    boxes = "() => [...document.querySelectorAll('h1,h2,button,a')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + scrollY)]; })"
    with screen(browser, base, None, owner) as page:
        page.route("**/*", hold)
        page.goto(base + path, wait_until="domcontentloaded")
        h1(page, heading)
        def settled_boxes() -> Any:
            first = page.evaluate(boxes)
            advance(page, STILL_GAP_MS)
            return first == page.evaluate(boxes)
        poll(settled_boxes, "the screen settling with its pictures held", STILL_WAIT_S)
        before = page.evaluate(boxes)
        for call in held_images:
            call.fallback()
        page.unroute("**/*", hold)
        with contextlib.suppress(PlaywrightError):
            page.wait_for_load_state("load", timeout=LOAD_WAIT_MS)
        advance(page, STILL_GAP_MS)
        after = page.evaluate(boxes)
    assert len(before) != len(after) or all(abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1 for a, b in zip(before, after)), "SR25: something moved when a held picture loaded"


def sweep(browser: Browser, base: str, path: str, owner: Desk | None, heading: str, page_title: str, bar: str | None, action: str | None, prints: bool) -> None:
    with screen(browser, base, path, owner, size=PHONE) as page:
        h1(page, heading)
        expect(page).to_have_title(page_title)
        assert_touch_targets(page)
        axe(page)
        no_cut_text(page)
        if bar:
            toolbar = page.get_by_role("toolbar", name=bar, exact=True)
            fixed_bottom(toolbar, PHONE)
            if action:
                assert action in toolbar.inner_text(), f"SR6: {action} sits in the bar"
        for _ in range(RING_STOPS):
            page.keyboard.press("Tab")
            wait_ui(page, lambda: page.evaluate(UNCOVERED), "SR6: the focused control is in view and uncovered", seconds=3)
        spaced(page)
        no_cut_text(page)
        layout(page)
    with screen(browser, base, path, owner) as page:
        h1(page, heading)
        axe(page)
        no_cut_text(page)
        if prints:
            print_only_content(page, heading)
    with screen(browser, base, path, owner, size=SMALL) as page:
        h1(page, heading)
        layout(page)
    plain, foreign = foreign_text(browser, base, path, owner)
    assert plain == foreign, f"SR14 on {path}"
    images_hold_still(browser, base, path, owner, heading)


def sweep_world(base: str, routes: tuple[str, ...]) -> SimpleNamespace:
    desk = new_desk(base)
    client = desk.add_client(language="en", name="N" * 72 + word(8))
    piece = desk.add_piece(client["id"], title="T" * 72 + word(8))
    pid = piece["id"]
    need = set(routes)
    if need & {"condition", "client-page", "dossier"}:
        desk.j("POST", f"/api/pieces/{pid}/pins", 201, json={"x": 20.0, "y": 30.0, "kind": "tear", "note": "signed", "signed": True})
    if need & {"photographs", "client-page", "dossier"}:
        assert desk.upload(pid, png(), "before").status_code == 201
        assert desk.upload(pid, png(), "after").status_code == 201
    token = None
    if need & {"estimate", "piece", "client-page", "dossier"}:
        estimate = desk.add_estimate(pid)
        if need & {"piece", "client-page", "dossier"}:
            token = token_of(desk.j("POST", f"/api/pieces/{pid}/client-page", 201, json={})["clientPage"]["address"])
        if "dossier" in need:
            resp = http("POST", f"{base}/api/client-pages/{token}/sign-off", json={"estimateId": estimate["id"], "typedName": client["name"]})
            assert resp.status_code == 200, f"sign-off answered {resp.status_code}: {resp.text[:300]}"
            desk.j("POST", f"/api/pieces/{pid}/dossier", 202, json={})
            dossier_settled(desk, pid)
    if "bench" in need:
        today = turin_today()
        desk.j("POST", "/api/bench-jobs", 201, json={"pieceId": pid, "bench": "frame", "day": (today - timedelta(days=today.weekday())).isoformat()})
    if "collection" in need:
        quote_id = desk.j("POST", f"/api/pieces/{pid}/collections/quote", json={})["quote"]["quoteId"]
        desk.j("POST", f"/api/pieces/{pid}/collections", 201, json={"quoteId": quote_id, "localDate": future_monday(3).isoformat(), "localTime": "09:00"})
    return SimpleNamespace(desk=desk, client=client, piece=piece, token=token)


def sweep_route(browser: Browser, base: str, world: SimpleNamespace, key: str) -> None:
    template, heading, action = ROUTE_CASES[key]
    path = template.format(p=world.piece["id"], c=world.client["id"], k=world.token)
    title = heading.format(t=world.piece["title"], n=world.client["name"])
    owner = None if key == "client-page" else world.desk
    sweep(browser, base, path, owner, title, title if owner is None else f"{title} — Semenza Desk", "Hide controls" if action is None else "Main action", action, key in PRINTED_ROUTES)


def sweep_routes(browser: Browser, base: str, *keys: str) -> None:
    world = sweep_world(base, keys)
    for key in keys:
        sweep_route(browser, base, world, key)


def h1(page: Page, name: str) -> Locator:
    heading = page.get_by_role("heading", level=1, name=name, exact=True)
    wait_ui(page, lambda: heading.count() > 0, f"level-one heading {name!r}")
    return heading


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements", exact=True)


def said(page: Page, copy: str | re.Pattern[str]) -> None:
    def matches() -> bool:
        spoken = " ".join(page.evaluate("(q) => [...document.querySelectorAll(q)].map((e) => e.textContent).join(' ')", LIVE_SELECTOR).split())
        return " ".join(copy.split()) in spoken if isinstance(copy, str) else bool(copy.search(spoken))
    wait_ui(page, matches, f"a live region reads {copy!r}")


def listen(page: Page) -> None:
    page.evaluate(WATCH_JS, LIVE_SELECTOR)


def spoken_list(page: Page) -> list[str]:
    return [re.sub("[\u200b-\u200d\u2060\ufeff]", "", spoken) for spoken in page.evaluate("() => window.__said")]


def was_said(page: Page, copy: str) -> None:
    wanted = " ".join(copy.split())
    wait_ui(page, lambda: any(wanted in " ".join(spoken.split()) for spoken in spoken_list(page)), f"a live region read {copy!r}")


def announced_twice(page: Page, act: Callable[[], Any], copy: str | re.Pattern[str]) -> None:
    def heard() -> bool:
        return any(copy in spoken if isinstance(copy, str) else copy.search(spoken) for spoken in spoken_list(page))
    listen(page)
    page.evaluate("() => { window.__said.length = 0; }")
    act()
    wait_ui(page, heard, f"{copy!r} announced")
    page.evaluate("() => { window.__said.length = 0; }")
    act()
    wait_ui(page, heard, f"SR19: {copy!r} announced a second time")


def motions(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__sweep()")


def clear_motions(page: Page) -> None:
    page.evaluate("() => { window.__motions.length = 0; }")


def assert_motion_system(records: list[dict[str, Any]]) -> None:
    for record in records:
        if record["duration"] >= 1:
            assert record["duration"] in MOTION_MS, f"motion lasts {record['duration']} ms: {record}"
        iterations = record["iterations"]
        assert not (isinstance(iterations, float) and math.isinf(iterations)), f"motion loops forever: {record}"


def assert_no_motion(records: list[dict[str, Any]]) -> None:
    moving = [r for r in records if r["duration"] >= 1]
    assert not moving, f"reduced motion still ran: {moving}"


def tab_into(page: Page, target: Locator) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if target.evaluate("t => t === document.activeElement || t.contains(document.activeElement)"):
            return
    pytest.fail("the composite was never reached by Tab")


def press_held(page: Page, scope: Any, name: str, glob: str | re.Pattern[str], method: str | tuple[str, ...] = "POST", touch: bool = False, busy: str = "Working…") -> None:
    sent: list[str] = []
    asked = glob if isinstance(glob, re.Pattern) else re.compile(re.escape(glob).replace(r"\*\*", ".*").replace(r"\*", "[^/]*"))
    def note(request: Any) -> None:
        if request.method in ((method,) if isinstance(method, str) else method) and asked.fullmatch(request.url.split("?")[0]):
            sent.append(request.url)
    page.on("request", note)
    button = scope.get_by_role("button", name=name, exact=True)
    with held(page, glob) as release:
        if touch:
            tap(button)
        else:
            button.focus()
            page.keyboard.press("Enter")
        pending = scope.get_by_role("button", name=busy, exact=True)
        wait_ui(page, lambda: pending.count() > 0, f"button {name!r} reads {busy!r} while its request is open")
        expect(pending).to_have_attribute("aria-disabled", "true")
        assert pending.get_attribute("disabled") is None, "a busy button never carries the disabled attribute"
        if touch:
            box = pending.bounding_box()
            page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        else:
            expect(pending).to_be_focused()
            page.keyboard.press("Enter")
        advance(page, TICK_MS)
        assert len(sent) == 1, f"a further press sent another request: {sent}"
        release()
    page.remove_listener("request", note)


def check_problems(page: Page, scope: Any, field: Locator, message: str) -> None:
    region = scope.get_by_role("region", name="Problems", exact=True)
    wait_ui(page, lambda: region.count() > 0, "a Problems summary shows")
    expect(region.get_by_role("heading", level=2, name="Problems", exact=True)).to_be_visible()
    link = region.get_by_role("link", name=message, exact=True).first
    expect(link).to_be_visible()
    link.focus()
    page.keyboard.press("Enter")
    expect(field).to_be_focused()
    expect(field).to_have_attribute("aria-invalid", "true")
    expect(field).to_have_accessible_description(message)


def assert_contract(base: str, path: str, *, instants_of: Callable[[], Any] | None = None, multipart_limit: int | None = None) -> None:
    if multipart_limit is not None:
        resp = http("POST", base + path, files={"file": ("big.bin", b"\x00" * (multipart_limit + 1), "application/octet-stream")}, headers={"Origin": FOREIGN_ORIGIN})
    else:
        resp = http("POST", base + path, content=b'{"x":"' + b"a" * JSON_LIMIT + b'"}', headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN})
    assert_error(resp, 413)
    if instants_of is not None:
        walk_instants(instants_of())
    desk = new_desk(base)
    signed = http("POST", f"{base}/api/session", json={"email": desk.email, "password": desk.password})
    cookie = signed.headers["set-cookie"].partition(";")[2].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie, f"cookie attributes: {cookie}"
    assert "secure" not in cookie and "max-age" not in cookie and "expires" not in cookie, f"cookie attributes: {cookie}"


def check_dialog(page: Page, opener: Locator, name: str, first: Callable[[Locator], Locator] | None = None, draft: Callable[[Locator], Locator] | None = None, sheet: bool = False, side_sheet: bool = False) -> None:
    dialog = page.get_by_role("dialog", name=name, exact=True)
    clear_motions(page)
    def press() -> None:
        opener.focus()
        page.keyboard.press("Enter")
    opened = entrance(page, press, dialog)
    wait_ui(page, lambda: dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: opening moves focus inside")
    if first is not None:
        expect(first(dialog)).to_be_focused()
    opening = motions(page)
    assert_motion_system(opening)
    assert any(r["duration"] == GLIDE_MS for r in opening), f"SR24: the opening takes {GLIDE_MS} ms; recorded {opening}"
    start, end = opened["start"], opened["end"]
    if sheet:
        assert start["top"] > end["top"], f"SR24: a sheet rises from the bottom at 375: {opened}"
    elif side_sheet:
        assert start["left"] > end["left"], f"SR24: a sheet slides from the right from 768: {opened}"
    else:
        centre = abs((start["left"] + start["width"] / 2) - (end["left"] + end["width"] / 2))
        assert start["width"] < end["width"] and centre <= MID_TOLERANCE_PX, f"SR24: a dialog grows from its centre: {opened}"
    live = announcements(page)
    assert live.count() == 1, "SR28: Announcements stays in the tree while a dialog is open"
    assert live.evaluate("e => !e.closest('[inert],[aria-hidden=\"true\"]')"), "SR28: Announcements is left out of whatever hides the page"
    for press_number in range(TRAP_PRESSES):
        page.keyboard.press("Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: Tab stays inside"
        if press_number < RING_STOPS:
            assert has_ring(page), "SR8: every Tab stop shows a ring"
    for _ in range(TRAP_PRESSES):
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: Shift+Tab stays inside"
    axe(page)
    if draft is not None:
        typed = f"draft {word(6)}"
        field = draft(dialog)
        field.fill(typed)
        field.focus()
        dialog.evaluate("d => { d.__kept = 1; }")
        advance(page, STILL_GAP_MS)
        clear_motions(page)
        reads: list[str] = []
        def note(request: Any) -> None:
            if request.method == "GET" and request.resource_type in ("fetch", "xhr"):
                reads.append(request.url)
        page.on("request", note)
        wait_ui(page, lambda: reads, "SR1: the screen re-reads from the server every 5 seconds", REFRESH_MS / 1000 + 3)
        advance(page, STILL_GAP_MS)
        page.remove_listener("request", note)
        assert dialog.evaluate("d => d.__kept === 1"), "SR1: a refresh keeps the same dialog element"
        expect(field).to_have_value(typed)
        expect(field).to_be_focused()
        assert not [r for r in motions(page) if r["dialog"]], "SR1: a refresh does not replay the opening"
        def refuse(route: Any) -> None:
            if route.request.method == "GET" and route.request.resource_type in ("fetch", "xhr"):
                route.fulfill(status=500, content_type="application/json", body='{"error":{"code":"x","message":"x"}}')
            else:
                route.fallback()
        page.route("**/*", refuse)
        refresh_state = page.get_by_role("status", name="Refresh state", exact=True, include_hidden=True)
        wait_ui(page, lambda: "Couldn't refresh. Trying again." in " ".join(refresh_state.all_text_contents()), "SR20: Refresh state reads F-02", REFRESH_MS / 1000 + 3)
        expect(field).to_have_value(typed)
        expect(field).to_be_focused()
        page.unroute("**/*", refuse)
        wait_ui(page, lambda: "Couldn't refresh" not in " ".join(refresh_state.all_text_contents()), "SR20: the next good refresh clears F-02", REFRESH_MS / 1000 + 3)
    handle = dialog.element_handle()
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    try:
        escape_panel(page, dialog)
        expect(opener).to_be_focused()
        advance(page, FRAME_WAIT_MS)
        mid = handle.evaluate(MIDWAY_JS)
        page.keyboard.press("Enter")
        wait_ui(page, lambda: dialog.count() > 0, "SR2: pressing the opener during the close opens it again")
        now = dialog.evaluate(RECT_JS)
    finally:
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    if mid is not None:
        assert all(abs(now[key] - mid[key]) <= MID_TOLERANCE_PX for key in ("left", "top", "width", "height")), f"SR27: a reopened dialog carries on from {mid}; it read {now}"
    page.evaluate(FINISH_JS)
    advance(page, HOLD_OPEN_MS)
    assert dialog.count() == 1 and dialog.is_visible(), "SR2: no leftover close timer undoes the reopening"
    dialog.evaluate("d => { window.__closing = d; }")
    escape_panel(page, dialog)
    expect(opener).to_be_focused()
    for _ in range(2):
        page.keyboard.press("Tab")
        assert not page.evaluate("() => window.__closing.contains(document.activeElement)"), "SR9: a closing panel is still in the Tab order"
    wait_ui(page, lambda: dialog.count() == 0, "SR9: a closed dialog leaves the accessibility tree")
    axe(page)


def check_screen_rules(browser: Browser, base: str, path: str, desk: Desk | None, heading: str, opener_name: str, dialog_name: str, first: Callable[[Locator], Locator] | None = None, draft: Callable[[Locator], Locator] | None = None, ready: Callable[[Page], Any] | None = None) -> None:
    def arrive(page: Page) -> None:
        h1(page, heading)
        if ready is not None:
            ready(page)
    with screen(browser, base, path, desk) as page:
        arrive(page)
        assert announcements(page).count() == 1, "SR19: Announcements is on the page from first paint"
        opener = page.get_by_role("button", name=opener_name, exact=True)
        check_dialog(page, opener, dialog_name, first, draft)
        assert_motion_system(motions(page))
        page.emulate_media(forced_colors="active")
        opener.focus()
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("Tab")
        assert has_ring(page), "SR18: a Tab stop shows a ring with forced colours on"
        page.emulate_media(forced_colors="none")
        page.evaluate(FINISH_JS)
        page.emulate_media(reduced_motion="reduce")
        clear_motions(page)
        dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens under reduced motion")
        escape_panel(page, dialog)
        expect(dialog).to_have_count(0, timeout=1000)
        assert_no_motion(motions(page))
        page.emulate_media(reduced_motion="no-preference")
    with screen(browser, base, path, desk, reduced_motion="reduce") as page:
        arrive(page)
        opener = page.get_by_role("button", name=opener_name, exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens at once")
        escape_panel(page, dialog)
        expect(dialog).to_have_count(0, timeout=1000)
        assert_no_motion(motions(page))
    with screen(browser, base, path, desk, size=LANDSCAPE) as page:
        arrive(page)
        opener = page.get_by_role("button", name=opener_name, exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens at 812x375")
        page.evaluate(FINISH_JS)
        for _ in range(TRAP_PRESSES):
            page.keyboard.press("Tab")
            wait_ui(page, lambda: page.evaluate(UNCOVERED), "SR17: the focused control is in view and not covered", seconds=3)
        layout(page)


@pytest.fixture(autouse=True)
def provider_baseline() -> Iterator[None]:
    yield
    WireMock()


def test_sign_up_strict(browser: Browser, app_url: str) -> None:
    name, email = names("signup")
    password = f"long-enough-{word(6)}"
    with screen(browser, app_url, "/sign-up") as page:
        h1(page, "Start a desk")
        page.get_by_role("textbox", name=named("Your name")).fill(name)
        page.get_by_role("textbox", name=named("Email")).fill(email)
        page.get_by_role("textbox", name=named("Password")).fill(password)
        page.get_by_role("button", name="Start a desk", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path == "/pieces", "sign-up lands on /pieces")
        h1(page, "Pieces")
        expect(page).to_have_title("Pieces — Semenza Desk")
        assert page.request.get(f"{app_url}/api/session").json()["session"]["email"] == email
        page.get_by_role("button", name="Sign out", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path == "/sign-in", "sign-out lands on /sign-in")
        assert page.request.get(f"{app_url}/api/session").status == 401
        heading = h1(page, "Sign in")
        expect(heading).to_be_focused()
        page.get_by_role("textbox", name=named("Email")).fill(email)
        page.get_by_role("textbox", name=named("Password")).fill("wrong-password-1")
        page.get_by_role("button", name="Sign in", exact=True).click()
        said(page, "That email and password do not match.")
        page.get_by_role("textbox", name=named("Password")).fill(password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path == "/pieces", "sign-in lands on /pieces")
        h1(page, "Pieces")
        assert page.request.get(f"{app_url}/api/session").status == 200, "a live session after the sign-in form"
    resp = http("POST", f"{app_url}/api/sign-up", json={"name": name, "email": email, "password": password})
    assert_error(resp, 409, "That email already has a desk.")
    assert_error(http("POST", f"{app_url}/api/sign-up", json={"name": name, "email": f"{word()}@desk.example", "password": "short"}), 422, "Use at least 10 characters.")
    assert_error(http("POST", f"{app_url}/api/session", json={"email": email, "password": "wrong-password-1"}), 401, "That email and password do not match.")
    assert_error(http("GET", f"{app_url}/api/session"), 401, code="notSignedIn")
    signed = http("POST", f"{app_url}/api/session", json={"email": email, "password": password})
    assert signed.status_code == 200 and signed.json()["session"]["landing"] == "/pieces"
    cookie = signed.headers["set-cookie"].split(";")[0]
    assert http("GET", f"{app_url}/api/session", headers={"Cookie": cookie}).json()["session"]["latestAnswer"] is None
    assert http("DELETE", f"{app_url}/api/session", headers={"Cookie": cookie}).status_code == 204
    assert_error(http("GET", f"{app_url}/api/session", headers={"Cookie": cookie}), 401)


def test_password_strict(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    other = Desk(app_url, desk.email, desk.password, cookie=http("POST", f"{app_url}/api/session", json={"email": desk.email, "password": desk.password}).headers["set-cookie"].split(";")[0])
    assert other.call("GET", "/api/session").status_code == 200
    new_password = f"another-long-{word(6)}"
    with screen(browser, app_url, "/pieces", desk) as page:
        h1(page, "Pieces")
        top = page.get_by_role("button", name="Change password", exact=True)
        top.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Change password", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the password dialog opens")
        expect(dialog.get_by_role("textbox", name=named("Current password"))).to_be_focused()
        dialog.get_by_role("textbox", name=named("Current password")).fill("not-the-password")
        dialog.get_by_role("textbox", name=named("New password")).fill(new_password)
        dialog.get_by_role("button", name="Change password", exact=True).click()
        check_problems(page, dialog, dialog.get_by_role("textbox", name=named("Current password")), "That email and password do not match.")
        assert other.call("GET", "/api/session").status_code == 200, "a refused change ends nothing"
        dialog.get_by_role("textbox", name=named("Current password")).fill(desk.password)
        press_held(page, dialog, "Change password", "**/api/password")
        said(page, "Password changed.")
        wait_ui(page, lambda: dialog.count() == 0, "the dialog closes")
        expect(top).to_be_focused()
        assert page.request.get(f"{app_url}/api/session").status == 200, "the current session stays signed in"
    assert_error(other.call("GET", "/api/session"), 401, code="sessionEnded")
    assert_error(http("POST", f"{app_url}/api/session", json={"email": desk.email, "password": desk.password}), 401)
    signed = http("POST", f"{app_url}/api/session", json={"email": desk.email, "password": new_password})
    assert signed.status_code == 200
    fresh = Desk(app_url, desk.email, new_password, cookie=signed.headers["set-cookie"].split(";")[0])
    assert_error(fresh.call("POST", "/api/password", json={"currentPassword": new_password, "newPassword": "short"}), 422, "Use at least 10 characters.")
    assert_error(fresh.call("POST", "/api/password", json={"currentPassword": "wrong-password-1", "newPassword": "long-enough-pass"}), 422, "That email and password do not match.")


def test_other_desk_strict(app_url: str) -> None:
    owner, intruder = new_desk(app_url), new_desk(app_url)
    client = owner.add_client()
    piece = owner.add_piece(client["id"], stampNumber=luhn_stamp())
    pin = owner.j("POST", f"/api/pieces/{piece['id']}/pins", 201, json={"x": 1.0, "y": 1.0, "kind": "tear", "note": "n", "signed": True})["pin"]
    photo = owner.upload(piece["id"], png()).json()["photograph"]
    unknown = intruder.call("GET", f"/api/clients/{unknown_like(client['id'])}")
    assert_error(unknown, 404)
    shape = set(unknown.json()["error"])
    for method, path, kw in (
        ("GET", f"/api/clients/{client['id']}", {}),
        ("PATCH", f"/api/clients/{client['id']}", {"json": {"name": "Taken"}}),
        ("DELETE", f"/api/clients/{client['id']}", {}),
        ("POST", f"/api/clients/{client['id']}/close", {"json": {}}),
        ("GET", f"/api/pieces/{piece['id']}", {}),
        ("PATCH", f"/api/pieces/{piece['id']}", {"json": {"title": "Taken"}}),
        ("GET", f"/api/pieces/{piece['id']}/pins", {}),
        ("DELETE", f"/api/pieces/{piece['id']}/pins/{pin['id']}", {}),
        ("GET", f"/api/pieces/{piece['id']}/photographs/{photo['id']}/file", {}),
        ("GET", f"/api/pieces/{piece['id']}/layout", {}),
        ("GET", f"/api/pieces/{piece['id']}/estimates", {}),
        ("GET", f"/api/pieces/{piece['id']}/dossier", {}),
        ("POST", "/api/pieces", {"json": {"clientId": client["id"], "title": "Taken"}}),
        ("POST", "/api/pieces", {"json": {"duplicateOf": piece["id"]}}),
        ("POST", "/api/bench-jobs", {"json": {"pieceId": piece["id"], "bench": "frame", "day": future_monday().isoformat()}}),
    ):
        resp = intruder.call(method, path, **kw)
        assert_error(resp, 404)
        assert set(resp.json()["error"]) == shape, f"{method} {path} differs from an unknown id"
    assert owner.j("GET", f"/api/clients/{client['id']}")["client"]["name"] == client["name"], "the other desk changed nothing"
    assert client["id"] not in [c["id"] for c in intruder.j("GET", "/api/clients")["clients"]]


def test_clients_strict(app_url: str, meilisearch: Meilisearch) -> None:
    desk = new_desk(app_url)
    created = desk.j("POST", "/api/clients", 201, json={"name": "Marta Bianchi", "town": "Turin", "email": f"{word()}@clients.example"})["client"]
    assert {"id", "name", "town", "language", "email", "state", "closesAt"} <= set(created)
    assert created["state"] == "active" and created["language"] == "it", "a client's language starts as the town's"
    assert desk.j("GET", f"/api/clients/{created['id']}")["client"]["name"] == "Marta Bianchi"
    renamed = desk.j("PATCH", f"/api/clients/{created['id']}", json={"name": "Marta B. Bianchi"})["client"]
    assert renamed["name"] == "Marta B. Bianchi"
    assert desk.j("GET", f"/api/clients/{created['id']}")["client"]["name"] == "Marta B. Bianchi", "the rename persisted"
    keeper = desk.add_client()
    desk.add_piece(keeper["id"])
    assert_error(desk.call("DELETE", f"/api/clients/{keeper['id']}"), 409, "Close this client instead.")
    assert desk.call("DELETE", f"/api/clients/{created['id']}").status_code == 204
    assert_error(desk.call("GET", f"/api/clients/{created['id']}"), 404)
    assert created["id"] not in [c["id"] for c in desk.j("GET", "/api/clients")["clients"]]
    meilisearch.settled()
    doc_id = f"{desk.id}-client-{created['id']}"
    poll(lambda: meilisearch.document("main_entries", doc_id) is None, "the deleted client's search entry is gone")
    poll(lambda: not desk.search("Bianchi").json()["results"], "GET /api/search no longer finds the deleted client", SEARCH_FINDS_SECONDS)


def plain_session(base: str) -> tuple[str, str, dict[str, str]]:
    name, email = names("plain")
    password = f"long-enough-{word(6)}"
    made = http("POST", f"{base}/api/sign-up", json={"name": name, "email": email, "password": password})
    assert 200 <= made.status_code < 300, f"sign-up answered {made.status_code}"
    signed = http("POST", f"{base}/api/session", json={"email": email, "password": password})
    assert signed.status_code == 200, f"sign-in answered {signed.status_code}"
    return email, password, {"Cookie": signed.headers["set-cookie"].split(";")[0]}


def plain_client(base: str, headers: dict[str, str]) -> str:
    made = http("POST", f"{base}/api/clients", json={"name": f"Client {word()}", "town": "Turin", "language": "it", "email": f"{word()}@clients.example"}, headers=headers)
    assert 200 <= made.status_code < 300, f"creating a client answered {made.status_code}"
    return str(made.json()["client"]["id"])


def test_wf_desk_access_sign_up_and_in(browser: Browser, app_url: str) -> None:
    email, password, headers = plain_session(app_url)
    assert http("POST", f"{app_url}/api/session", json={"email": email, "password": "wrong-password-1"}).status_code == 401
    assert http("GET", f"{app_url}/api/session", headers=headers).status_code == 200
    assert 200 <= http("DELETE", f"{app_url}/api/session", headers=headers).status_code < 300
    assert http("GET", f"{app_url}/api/session", headers=headers).status_code == 401
    with screen(browser, app_url, "/sign-in") as page:
        page.get_by_label("Email").first.fill(email)
        page.get_by_label("Password").first.fill(password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path == "/pieces", "the sign-in form lands on /pieces")
        assert page.request.get(f"{app_url}/api/session").status == 200, "a live session after the sign-in form"
        assert 200 <= page.request.delete(f"{app_url}/api/session").status < 300
        assert page.request.get(f"{app_url}/api/session").status == 401


def test_wf_desk_access_password_change_ends_other_sessions(app_url: str) -> None:
    email, password, headers = plain_session(app_url)
    other = {"Cookie": http("POST", f"{app_url}/api/session", json={"email": email, "password": password}).headers["set-cookie"].split(";")[0]}
    new_password = f"another-long-{word(6)}"
    changed = http("POST", f"{app_url}/api/password", json={"currentPassword": password, "newPassword": new_password}, headers=headers)
    assert 200 <= changed.status_code < 300
    current = {"Cookie": changed.headers["set-cookie"].split(";")[0]} if "set-cookie" in changed.headers else headers
    assert http("GET", f"{app_url}/api/session", headers=other).status_code == 401
    assert http("GET", f"{app_url}/api/session", headers=current).status_code == 200
    assert http("POST", f"{app_url}/api/session", json={"email": email, "password": password}).status_code == 401
    assert http("POST", f"{app_url}/api/session", json={"email": email, "password": new_password}).status_code == 200


def test_wf_desk_access_other_desk_is_404(app_url: str) -> None:
    _, _, owner = plain_session(app_url)
    _, _, intruder = plain_session(app_url)
    client = plain_client(app_url, owner)
    assert http("GET", f"{app_url}/api/clients/{client}", headers=intruder).status_code == 404
    assert http("GET", f"{app_url}/api/clients/{unknown_like(client)}", headers=intruder).status_code == 404
    assert http("GET", f"{app_url}/api/clients/{client}", headers=owner).status_code == 200


def test_wf_desk_access_deleted_client_is_gone(app_url: str) -> None:
    _, _, headers = plain_session(app_url)
    client = plain_client(app_url, headers)
    assert http("GET", f"{app_url}/api/clients/{client}", headers=headers).status_code == 200
    assert http("PATCH", f"{app_url}/api/clients/{client}", json={"name": f"Client {word()}"}, headers=headers).status_code == 200
    assert 200 <= http("DELETE", f"{app_url}/api/clients/{client}", headers=headers).status_code < 300
    assert http("GET", f"{app_url}/api/clients/{client}", headers=headers).status_code == 404


def test_screen_rules_public_site(browser: Browser, app_url: str) -> None:
    assert_contract(app_url, "/api/enquiries")
    with screen(browser, app_url, "/work") as page:
        h1(page, "Work")
        assert announcements(page).count() == 1, "SR19: Announcements present from first paint"
        axe(page)
        header_button = page.get_by_role("button", name="Work", exact=True)
        clear_motions(page)
        header_button.focus()
        page.keyboard.press("Enter")
        panel = page.get_by_role("navigation", name="Work", exact=True)
        wait_ui(page, lambda: panel.count() > 0, "the Work panel opens")
        wait_ui(page, lambda: any(r["duration"] == GLIDE_MS for r in motions(page)), "the panel opens over 320 ms")
        assert_motion_system(motions(page))
        axe(page)
        page.keyboard.press("Escape")
        expect(header_button).to_be_focused()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: panel.count() > 0, "SR2: pressing Work during the close opens it again")
        page.evaluate(FINISH_JS)
        advance(page, HOLD_OPEN_MS)
        assert panel.count() == 1 and panel.is_visible(), "SR2: no leftover close timer"
        page.keyboard.press("Escape")
    with screen(browser, app_url, "/work/bentwood-armchair") as page:
        h1(page, "Bentwood armchair")
        page.evaluate("() => window.scrollTo(0, 400)")
        wait_ui(page, lambda: page.locator('[data-scrolled="true"]').count() == 1, "the header carries data-scrolled past 24 px")
        page.reload()
        h1(page, "Bentwood armchair")
        wait_ui(page, lambda: page.evaluate("() => window.scrollY") <= SCROLLED_PX or page.locator('[data-scrolled="true"]').count() == 1, "SR22: correct on arrival at a scrolled position")
    with screen(browser, app_url, "/work", reduced_motion="reduce") as page:
        h1(page, "Work")
        button = page.get_by_role("button", name="Work", exact=True)
        button.focus()
        page.keyboard.press("Enter")
        panel = page.get_by_role("navigation", name="Work", exact=True)
        wait_ui(page, lambda: panel.count() > 0, "SR3: the panel opens at once")
        page.keyboard.press("Escape")
        expect(panel).to_have_count(0, timeout=1000)
        assert_no_motion(motions(page))
    for path, heading, title, prints in (("/", "ONE CHAIR AT A TIME.", "Bottega Semenza", False), ("/work", "Work", "Work — Bottega Semenza", False),
                                         ("/work/bentwood-armchair", "Bentwood armchair", "Bentwood armchair — Bottega Semenza", True),
                                         ("/enquire", "Send an enquiry", "Enquire — Bottega Semenza", False)):
        sweep(browser, app_url, path, None, heading, title, None, None, prints)


def test_wf_public_site_keyboard(browser: Browser, app_url: str, mail: Any) -> None:
    with screen(browser, app_url, "/") as page:
        h1(page, "ONE CHAIR AT A TIME.")
        work = page.get_by_role("button", name="Work", exact=True)
        work.focus()
        page.keyboard.press("Enter")
        panel = page.get_by_role("navigation", name="Work", exact=True)
        wait_ui(page, lambda: panel.count() > 0, "Work opens its panel")
        expect(work).to_be_focused()
        expect(work).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("ArrowDown")
        assert panel.evaluate("n => n.contains(document.activeElement)"), "Down enters the panel"
        page.keyboard.press("Escape")
        expect(work).to_be_focused()
        expect(work).to_have_attribute("aria-expanded", "false")
        page.keyboard.press("Enter")
        wait_ui(page, lambda: panel.count() > 0, "Work opens again")
        page.keyboard.press("Tab")
        assert panel.evaluate("n => n.contains(document.activeElement)"), "Tab enters the panel"
        for _ in range(len(CASES) - 1):
            page.keyboard.press("Tab")
        page.keyboard.press("Tab")
        wait_ui(page, lambda: panel.count() == 0, "Tab past the last tile closes the panel and moves on")
    _, email = names("visitor")
    visitor = f"Visitor {word()}"
    with screen(browser, app_url, "/enquire") as page:
        h1(page, "Send an enquiry")
        expect(page).to_have_title("Enquire — Bottega Semenza")
        name_box = page.get_by_role("textbox", name=named("Name"))
        email_box = page.get_by_role("textbox", name=named("Email"))
        message_box = page.get_by_role("textbox", name=named("Message"))
        send = page.get_by_role("button", name="Send enquiry", exact=True)
        send.focus()
        page.keyboard.press("Enter")
        check_problems(page, page, name_box, "This field is required.")
        name_box.fill(visitor)
        email_box.fill("not-an-address")
        message_box.fill("A bentwood armchair with a split seat.")
        send.focus()
        page.keyboard.press("Enter")
        check_problems(page, page, email_box, "That is not an email address.")
        email_box.fill(email)
        press_held(page, page, "Send enquiry", "**/api/enquiries")
        said(page, "Thank you. Your enquiry is on its way.")
    poll(lambda: mails_from_visitor(mail, email), f"an enquiry mail with Reply-To {email}")
    sent = mails_from_visitor(mail, email)[0]
    assert sent["Subject"] == f"Enquiry from {visitor}"
    assert "agnese@bottega-semenza.example" in addresses(sent.get("To"))
    assert "A bentwood armchair with a split seat." in mail_text(sent)


def test_wf_public_site_touch(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/", size=PHONE) as page:
        h1(page, "ONE CHAIR AT A TIME.")
        layout(page)
        assert page.get_by_role("toolbar", name="Main action", exact=True).count() == 0, "public pages have no bottom bar"
        assert_touch_targets(page)
        work = page.get_by_role("button", name="Work", exact=True)
        tap(work)
        panel = page.get_by_role("navigation", name="Work", exact=True)
        wait_ui(page, lambda: panel.count() > 0, "the panel opens")
        panel.get_by_role("link").evaluate_all("(links) => links.forEach((link) => { link.__tile = true; })")
        work.focus()
        page.keyboard.press("Escape")
        expect(work).to_be_focused()
        wait_ui(page, lambda: panel.count() == 0, "SR9: the panel leaves the accessibility tree when its closing animation ends")
        for _ in range(8):
            page.keyboard.press("Tab")
            assert not page.evaluate("() => document.activeElement.__tile === true"), "a closed panel's tiles are in the Tab order"
            wait_ui(page, lambda: page.evaluate(UNCOVERED), "SR6: the focused control is fully in view", seconds=3)
        tap(page.get_by_role("link", name="Enquire", exact=True))
        h1(page, "Send an enquiry")
        wait_ui(page, lambda: urlparse(page.url).path == "/enquire", "Enquire goes to /enquire")
        expect(page.get_by_role("heading", level=1, name="Send an enquiry", exact=True)).to_be_focused()
        expect(page).to_have_title("Enquire — Bottega Semenza")
        tap(page.get_by_role("button", name="Send enquiry", exact=True))
        check_problems(page, page, page.get_by_role("textbox", name=named("Name")), "This field is required.")
    with screen(browser, app_url, "/work/slat-bench", size=PHONE) as page:
        h1(page, "Slat bench")
        assert_touch_targets(page)
        layout(page)


def test_wf_public_site_rate_limit(browser: Browser, app_url: str, mail: Any) -> None:
    _, email = names("limited")
    body = {"name": f"Visitor {word()}", "email": email, "message": "A chair."}
    first_at = datetime.now(UTC)
    for address in (email, email.upper(), email):
        resp = http("POST", f"{app_url}/api/enquiries", json={**body, "email": address})
        assert resp.status_code == 202 and resp.json() == {"received": True}, resp.text
    refused = http("POST", f"{app_url}/api/enquiries", json=body)
    now = datetime.now(UTC)
    error = assert_error(refused, 429)
    assert 0 < int(refused.headers["retry-after"]) <= ENQUIRY_WINDOW_SECONDS
    labels = minute_labels(first_at + timedelta(seconds=ENQUIRY_WINDOW_SECONDS), now + timedelta(seconds=ENQUIRY_WINDOW_SECONDS))
    match = re.fullmatch(r"Too many enquiries\. You can try again at (\d\d:\d\d) Turin time\.", error["message"])
    assert match and match.group(1) in labels, f"F-12 minute {error['message']!r}; expected one of {labels}"
    with screen(browser, app_url, "/enquire") as page:
        h1(page, "Send an enquiry")
        page.get_by_role("textbox", name=named("Name")).fill(body["name"])
        page.get_by_role("textbox", name=named("Email")).fill(email)
        page.get_by_role("textbox", name=named("Message")).fill("A chair.")
        send = page.get_by_role("button", name="Send enquiry", exact=True)
        def press_send() -> None:
            send.focus()
            page.keyboard.press("Enter")
        announced_twice(page, press_send, re.compile(r"Too many enquiries\. You can try again at \d\d:\d\d Turin time\."))
    poll(lambda: len(mails_from_visitor(mail, email)) >= 3, "three enquiry mails")
    assert len(mails_from_visitor(mail, email)) == 3, "a refused enquiry sends no mail"
    short = copy_url("APP_SHORT_URL")
    _, short_email = names("window")
    short_body = {"name": "Window", "email": short_email, "message": "A chair."}
    for _ in range(3):
        assert http("POST", f"{short}/api/enquiries", json=short_body).status_code == 202
    assert http("POST", f"{short}/api/enquiries", json=short_body).status_code == 429
    poll(lambda: http("POST", f"{short}/api/enquiries", json=short_body).status_code == 202, "the window ends and the address may send again", 40)


def test_enquiry_line_break_and_known_address(app_url: str, mail: Any) -> None:
    _, email = names("inject")
    token = word()
    resp = http("POST", f"{app_url}/api/enquiries", json={"name": f"Tomas\r\n\r\nBcc: {token}@evil.example\nWeil", "email": email, "message": "Hello."})
    assert resp.status_code == 202
    poll(lambda: mails_from_visitor(mail, email), "the enquiry mail arrives")
    sent = mails_from_visitor(mail, email)[0]
    assert sent["Subject"] == f"Enquiry from Tomas Bcc: {token}@evil.example Weil"
    assert not sent.get("Bcc"), "a line break never adds a header"
    assert addresses(sent.get("To")) == ["agnese@bottega-semenza.example"]
    known = new_desk(app_url)
    _, fresh = names("fresh")
    first = http("POST", f"{app_url}/api/enquiries", json={"name": "A", "email": known.email, "message": "m"})
    second = http("POST", f"{app_url}/api/enquiries", json={"name": "A", "email": fresh, "message": "m"})
    assert first.status_code == second.status_code == 202 and first.content == second.content, "new and known addresses get the same answer"
    assert_error(http("POST", f"{app_url}/api/enquiries", json={"name": "n" * 121, "email": fresh, "message": "m"}), 422, "This is longer than 120 characters.")
    emoji_ok = http("POST", f"{app_url}/api/enquiries", json={"name": "😀" * 120, "email": f"{word()}@example.org", "message": "m"})
    assert emoji_ok.status_code == 202, "field lengths count code points, so an emoji counts as 1"
    assert_error(http("POST", f"{app_url}/api/enquiries", json={"name": "n", "email": "nope", "message": "m"}), 422, "That is not an email address.")


def test_public_pages_in_first_response(app_url: str) -> None:
    def read(path: str) -> str:
        resp = http("GET", app_url + path)
        assert resp.status_code == 200, f"{path} answered {resp.status_code}"
        return resp.text
    def plain(source: str) -> str:
        without = re.sub(r"<(script|style)\b.*?</\1>", " ", source, flags=re.S | re.I)
        return re.sub(r"\s+", " ", html.unescape(re.sub(r"<[^>]+>", " ", without))).strip()
    def heading(source: str) -> str:
        found = re.search(r"<h1\b[^>]*>(.*?)</h1>", source, flags=re.S | re.I)
        assert found, "no level-one heading in the first response"
        return plain(found.group(1))
    def title(source: str) -> str:
        found = re.search(r"<title[^>]*>(.*?)</title>", source, flags=re.S | re.I)
        assert found, "no title in the first response"
        return html.unescape(found.group(1)).strip()
    home = read("/")
    assert heading(home) == "ONE CHAIR AT A TIME." and title(home) == "Bottega Semenza"
    assert "A conservator's desk in Turin, re-covering twentieth-century design chairs for Turin, London, New York, Kyoto and Dubai." in plain(home)
    work = read("/work")
    assert heading(work) == "Work" and title(work) == "Work — Bottega Semenza"
    for slug, (case_title, _) in CASES.items():
        assert case_title in plain(work), f"the work page lists {case_title}"
        case = read(f"/work/{slug}")
        assert heading(case) == case_title and title(case) == f"{case_title} — Bottega Semenza"
        for section in CASE_SECTIONS:
            assert section in plain(case), f"{slug} carries {section}"
    missing = http("GET", f"{app_url}/work/no-such-case-{word()}")
    assert missing.status_code == 404 and heading(missing.text) == "Page not found"


def test_work_panel(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/") as page:
        h1(page, "ONE CHAIR AT A TIME.")
        work = page.get_by_role("button", name="Work", exact=True)
        work.focus()
        page.keyboard.press("Enter")
        panel = page.get_by_role("navigation", name="Work", exact=True)
        wait_ui(page, lambda: panel.count() > 0, "the panel opens")
        titles = [c[0] for c in CASES.values()]
        for title in titles:
            expect(panel.get_by_role("link", name=title, exact=True)).to_be_visible()
        clear_motions(page)
        panel.get_by_role("link", name=titles[1], exact=True).focus()
        expect(page.get_by_role("img", name=f"Preview of {titles[1]}", exact=True)).to_be_visible()
        panel.get_by_role("link", name=titles[2], exact=True).hover()
        expect(page.get_by_role("img", name=f"Preview of {titles[2]}", exact=True)).to_be_visible()
        wait_ui(page, lambda: any(r["duration"] == STEP_MS for r in motions(page)), "the preview cross-fades over 160 ms")
        assert_motion_system(motions(page))
        panel.evaluate("n => { window.__closing = n; }")
        work.focus()
        page.keyboard.press("Escape")
        expect(work).to_be_focused()
        page.keyboard.press("Tab")
        assert not page.evaluate("() => window.__closing.contains(document.activeElement)"), "tiles leave the Tab order the moment the panel starts closing"
        wait_ui(page, lambda: panel.count() == 0, "the panel leaves the accessibility tree")
    with screen(browser, app_url, "/", size=PHONE) as page:
        h1(page, "ONE CHAIR AT A TIME.")
        work = page.get_by_role("button", name="Work", exact=True)
        tap(work)
        panel = page.get_by_role("navigation", name="Work", exact=True)
        wait_ui(page, lambda: panel.count() > 0, "the panel opens at 375")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        box = panel.evaluate("n => { const r = n.getBoundingClientRect(); return {top: r.top, bottom: r.bottom}; }")
        header_bottom = work.evaluate("b => b.closest('header') ? b.closest('header').getBoundingClientRect().bottom : b.getBoundingClientRect().bottom")
        assert box["bottom"] >= PHONE["height"] - 1, f"a full-height panel at 375: {box}"
        assert box["top"] <= header_bottom + 1, f"the panel sits under the header: {box}"
        for title in [c[0] for c in CASES.values()]:
            assert panel.get_by_role("link", name=title, exact=True).count() == 1


def test_work_filter_and_shared_drawing(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/work") as page:
        h1(page, "Work")
        group = page.get_by_role("radiogroup", name="Kind", exact=True)
        expect(group.get_by_role("radio", name="All", exact=True)).to_be_checked()
        page.evaluate("() => document.querySelectorAll('[data-part=\"case-drawing\"]').forEach((e) => { e.__kept = e.getAttribute('data-case'); })")
        before = page.evaluate("() => history.length")
        clear_motions(page)
        pick(group.get_by_role("radio", name="Fabric", exact=True))
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("kind") == ["fabric"], "?kind=fabric")
        assert page.evaluate("() => history.length") == before + 1, "one history entry per change"
        wait_ui(page, lambda: any(r["duration"] == GLIDE_MS for r in motions(page)), "items move over 320 ms")
        assert_motion_system(motions(page))
        wait_ui(page, lambda: page.get_by_role("link", name="Bentwood armchair", exact=True).count() == 0, "a leather case leaves")
        for title in ("Folding deck chair", "Cantilever side chair"):
            expect(page.get_by_role("link", name=title, exact=True)).to_be_visible()
        assert page.evaluate("() => [...document.querySelectorAll('[data-part=\"case-drawing\"]')].every((e) => e.__kept === e.getAttribute('data-case'))"), "staying items keep their elements"
        pick(group.get_by_role("radio", name="Frame only", exact=True))
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("kind") == ["frame-only"], "?kind=frame-only")
        expect(page.get_by_role("link", name="Slat bench", exact=True)).to_be_visible()
        page.go_back()
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("kind") == ["fabric"], "Back returns to the previous filter")
        pick(group.get_by_role("radio", name="All", exact=True))
        wait_ui(page, lambda: urlparse(page.url).query == "", "All shows with no parameter")
    with screen(browser, app_url, "/work") as page:
        h1(page, "Work")
        selector = '[data-part="case-drawing"][data-case="tubular-lounge"]'
        page.locator(selector).evaluate("e => { e.__kept = 1; }")
        clear_motions(page)
        tile = page.get_by_role("link", name="Tubular lounge", exact=True)
        tile.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: urlparse(page.url).path == "/work/tubular-lounge", "the address follows the press")
        heading = h1(page, "Tubular lounge")
        wait_ui(page, lambda: heading.evaluate("h => h === document.activeElement"), "focus lands on the new level-one heading")
        expect(page).to_have_title("Tubular lounge — Bottega Semenza")
        drawing = page.locator(selector)
        expect(drawing).to_have_count(1)
        expect(drawing).to_have_attribute("data-hero", "true")
        assert drawing.evaluate("e => e.__kept === 1"), "the tile's drawing element is kept and becomes the hero"
        shared = [r for r in motions(page) if r["kase"] == "tubular-lounge"]
        assert any(r["duration"] == GLIDE_MS for r in shared) and all(r["caseCount"] == 1 for r in shared), f"one element, one 320 ms motion: {shared}"
        page.go_back()
        wait_ui(page, lambda: urlparse(page.url).path == "/work", "Back returns to the list")
        link = page.get_by_role("link", name="Tubular lounge", exact=True)
        wait_ui(page, lambda: link.count() > 0 and link.evaluate("l => l === document.activeElement"), "focus on the case just left")
    with screen(browser, app_url, "/work") as page:
        h1(page, "Work")
        page.get_by_role("link", name="Slat bench", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path != "/work", "the press reaches the case's address")
        page.go_back()
        wait_ui(page, lambda: urlparse(page.url).path == "/work", "Back during the move ends on the newest address")
        h1(page, "Work")
        expect(page.get_by_role("heading", level=1)).to_have_count(1)
        expect(page).to_have_title("Work — Bottega Semenza")
    with screen(browser, app_url, "/work", reduced_motion="reduce") as page:
        h1(page, "Work")
        clear_motions(page)
        page.get_by_role("link", name="Slat bench", exact=True).click()
        h1(page, "Slat bench")
        assert_no_motion(motions(page))


def scroll_past(heading: Locator) -> None:
    heading.evaluate(f"(h, line) => {{ const scroller = ({SCROLLER_JS})(h); scroller.scrollBy(0, h.getBoundingClientRect().top - line + {PAST_LINE_PX}); }}", RAIL_LINE_PX)


def scroll_to_end(heading: Locator) -> None:
    heading.evaluate(f"h => {{ const scroller = ({SCROLLER_JS})(h); scroller.scrollTo(0, scroller.scrollHeight); }}")


def scroll_to_top(heading: Locator) -> None:
    heading.evaluate(f"h => {{ ({SCROLLER_JS})(h).scrollTo(0, 0); }}")


def rail_should_mark(page: Page, anchor: Locator) -> str:
    if anchor.evaluate(f"h => {{ const s = ({SCROLLER_JS})(h); return s.scrollTop + s.clientHeight >= s.scrollHeight - 1; }}"):
        return CASE_SECTIONS[-1][:2]
    tops = [page.get_by_role("heading", name=section, exact=True).evaluate("h => h.getBoundingClientRect().top") for section in CASE_SECTIONS]
    passed = [index for index, top in enumerate(tops) if top <= RAIL_LINE_PX]
    return CASE_SECTIONS[passed[-1] if passed else 0][:2]


def test_case_page_rail(browser: Browser, app_url: str) -> None:
    def current(page: Page) -> list[str]:
        return page.get_by_role("navigation", name="Sections", exact=True).locator('[aria-current="true"]').all_inner_texts()
    with screen(browser, app_url, "/work/bentwood-armchair") as page:
        h1(page, "Bentwood armchair")
        rail = page.get_by_role("navigation", name="Sections", exact=True)
        for section in CASE_SECTIONS:
            expect(rail.get_by_role("link", name=section, exact=True)).to_be_visible()
        wait_ui(page, lambda: len(current(page)) == 1 and "01" in current(page)[0], "01 is current before any heading has passed the line")
        third = page.get_by_role("heading", name=CASE_SECTIONS[2], exact=True)
        scroll_past(third)
        wait_ui(page, lambda: len(current(page)) == 1 and rail_should_mark(page, third) in current(page)[0], "the last heading on or above the line is marked, or the last section at the very bottom")
        scroll_to_end(third)
        wait_ui(page, lambda: len(current(page)) == 1 and "06" in current(page)[0], "the last section at the very bottom")
        scroll_to_top(third)
        wait_ui(page, lambda: "01" in "".join(current(page)), "back at the top, 01 is current")
        history = page.evaluate("() => history.length")
        clear_motions(page)
        rail.get_by_role("link", name=CASE_SECTIONS[3], exact=True).click()
        heading = page.get_by_role("heading", name=CASE_SECTIONS[3], exact=True)
        wait_ui(page, lambda: heading.evaluate("h => h === document.activeElement"), "focus lands on the heading")
        assert urlparse(page.url).fragment == CASE_HASHES[3][1:]
        assert page.evaluate("() => history.length") == history + 1, "one history entry"
        assert len(current(page)) == 1 and "04" in current(page)[0]
        assert heading.evaluate("h => { const header = document.querySelector('header'); return h.getBoundingClientRect().top >= (header ? header.getBoundingClientRect().bottom : 0) - 1; }"), "the heading sits fully below the sticky header"
        assert page.evaluate("() => document.documentElement.style.scrollBehavior !== 'smooth' && getComputedStyle(document.documentElement).scrollBehavior !== 'smooth'"), "at once with no animated scrolling"
    with screen(browser, app_url, f"/work/bentwood-armchair{CASE_HASHES[4]}") as page:
        heading = page.get_by_role("heading", name=CASE_SECTIONS[4], exact=True)
        wait_ui(page, lambda: heading.count() > 0 and heading.evaluate("h => h === document.activeElement"), "a direct hash lands the same way")
        assert "05" in "".join(current(page))
    with screen(browser, app_url, "/work/bentwood-armchair", size=PHONE) as page:
        h1(page, "Bentwood armchair")
        frame = page.get_by_role("region", name="Section numbers", exact=True)
        expect(frame).to_be_visible()
        assert frame.evaluate("f => f.tabIndex >= 0"), "the sideways frame takes focus"
        scroll_to_end(page.get_by_role("heading", name=CASE_SECTIONS[0], exact=True))
        wait_ui(page, lambda: "06" in "".join(frame.locator('[aria-current="true"]').all_inner_texts()), "06 is current at the very bottom")
        wait_ui(page, lambda: frame.evaluate("""f => {
            const c = f.querySelector('[aria-current="true"]');
            if (!c) return false;
            const a = c.getBoundingClientRect(), b = f.getBoundingClientRect();
            return a.left >= b.left - 1 && a.right <= b.right + 1;
        }"""), "the current number stays fully in view inside its frame")
        layout(page)


def test_screen_rules_pieces(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    desk.add_piece(client["id"])
    assert_contract(app_url, "/api/pieces", instants_of=lambda: desk.j("GET", "/api/clients"))
    check_screen_rules(
        browser, app_url, "/pieces", desk, "Pieces", "New piece", "New piece",
        first=lambda d: d.get_by_role("combobox", name=named("Client")),
        draft=lambda d: d.get_by_role("textbox", name=named("Title")),
    )
    with screen(browser, app_url, "/pieces", desk) as page:
        h1(page, "Pieces")
        box = page.get_by_role("searchbox", name="Search the desk", exact=True)
        box.fill("Tabacco")
        results = page.get_by_role("list", name="Search results", exact=True)
        wait_ui(page, lambda: results.count() > 0 and "Tabacco" in results.inner_text(), "the search list shows")
        box.focus()
        page.keyboard.press("Escape")
        wait_ui(page, lambda: results.count() == 0 or not results.is_visible(), "SR21: Escape closes the search list")
    sweep_routes(browser, app_url, "pieces", "piece", "clients", "client")


def test_wf_clients_and_pieces_keyboard(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    title = f"Lounge {word()}"
    stamp, taken = luhn_stamp(), luhn_stamp()
    desk.add_piece(client["id"], stampNumber=taken)
    with screen(browser, app_url, "/pieces", desk) as page:
        h1(page, "Pieces")
        expect(page).to_have_title("Pieces — Semenza Desk")
        listen(page)
        opener = page.get_by_role("button", name="New piece", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New piece", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "New piece opens")
        expect(dialog.get_by_role("combobox", name=named("Client"))).to_be_focused()
        select(dialog.get_by_role("combobox", name=named("Client")), client["name"])
        dialog.get_by_role("textbox", name=named("Title")).fill(title)
        stamp_box = dialog.get_by_role("textbox", name=named("Stamp number"))
        stamp_box.fill(bad_stamp(stamp))
        save = dialog.get_by_role("button", name="Save piece", exact=True)
        save.focus()
        page.keyboard.press("Enter")
        check_problems(page, dialog, stamp_box, "That stamp number does not check out. Read it again from the frame.")
        expect(dialog.get_by_role("textbox", name=named("Title"))).to_have_value(title)
        stamp_box.fill(taken)
        def press_save() -> None:
            save.focus()
            page.keyboard.press("Enter")
        announced_twice(page, press_save, "Another piece on this desk has that stamp number.")
        stamp_box.fill(stamp)
        press_held(page, dialog, "Save piece", "**/api/pieces")
        said(page, f"{title} saved.")
        wait_ui(page, lambda: dialog.count() == 0, "the dialog closes")
        expect(opener).to_be_focused()
        advance(page, REFRESH_MS)
        expect(opener).to_be_focused()
        assert urlparse(page.url).path == "/pieces", "Save piece stays on /pieces"
        pieces = [p for p in desk.j("GET", "/api/pieces")["pieces"] if p["title"] == title]
        assert len(pieces) == 1
        piece = pieces[0]
        assert piece["stampNumber"] == stamp
        action = page.get_by_role("button", name=f"Actions for {title}", exact=True)
        wait_ui(page, lambda: action.count() > 0, "the row's action button shows")
        action.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: page.get_by_role("menu").count() > 0, "the action menu opens")
        page.keyboard.press("Escape")
        expect(action).to_be_focused()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: page.get_by_role("menu").count() > 0, "the action menu opens again")
        page.get_by_role("menuitem", name="Duplicate", exact=True).focus()
        page.keyboard.press("Enter")
        said(page, f"{title} duplicated.")
        wait_ui(page, lambda: any(p["title"] == f"{title} (copy)" for p in desk.j("GET", "/api/pieces")["pieces"]), "the duplicate exists")
        copy_piece = next(p for p in desk.j("GET", "/api/pieces")["pieces"] if p["title"] == f"{title} (copy)")
        assert not copy_piece.get("stampNumber") and copy_piece["state"] == "received"
        action.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: page.get_by_role("menu").count() > 0, "the action menu opens")
        page.get_by_role("menuitem", name="Archive", exact=True).focus()
        page.keyboard.press("Enter")
        said(page, f"{title} archived.")
        assert desk.j("GET", f"/api/pieces/{piece['id']}")["piece"]["state"] == "archived"
        heading = page.get_by_role("heading", level=1, name="Pieces", exact=True)
        wait_ui(page, lambda: action.count() > 0 or heading.evaluate("h => h === document.activeElement"), "SR12: when Archive takes the row away, focus moves to the level-one heading")
        assert urlparse(page.url).path == "/pieces"
        page.get_by_role("link", name="Clients", exact=True).focus()
        page.keyboard.press("Enter")
        heading = h1(page, "Clients")
        wait_ui(page, lambda: heading.evaluate("h => h === document.activeElement"), "moving between screens focuses the level-one heading")
        expect(page).to_have_title("Clients — Semenza Desk")


def test_wf_clients_and_pieces_touch(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    title = f"Stool {word()}"
    with screen(browser, app_url, "/pieces", desk, size=PHONE) as page:
        h1(page, "Pieces")
        layout(page)
        bar = page.get_by_role("toolbar", name="Main action", exact=True)
        fixed_bottom(bar, PHONE)
        tap(bar.get_by_role("button", name="New piece", exact=True))
        dialog = page.get_by_role("dialog", name="New piece", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the sheet opens")
        landed(page)
        expect(dialog.get_by_role("combobox", name=named("Client"))).to_be_focused()
        select(dialog.get_by_role("combobox", name=named("Client")), client["name"])
        tap(dialog.get_by_role("button", name="Save piece", exact=True))
        check_problems(page, dialog, dialog.get_by_role("textbox", name=named("Title")), "This field is required.")
        dialog.get_by_role("textbox", name=named("Title")).fill(title)
        press_held(page, dialog, "Save piece", "**/api/pieces", touch=True)
        said(page, f"{title} saved.")
        wait_ui(page, lambda: dialog.count() == 0, "the sheet closes")
        assert [p["title"] for p in desk.j("GET", "/api/pieces")["pieces"]] == [title]
        tap(page.get_by_role("button", name="Menu", exact=True))
        menu = page.get_by_role("dialog", name="Menu", exact=True)
        wait_ui(page, lambda: menu.count() > 0, "the Menu sheet opens")
        landed(page)
        for link in ("Pieces", "Clients", "Library", "Bench", "Workbook", "Rates"):
            expect(menu.get_by_role("link", name=link, exact=True)).to_be_visible()
        tap(menu.get_by_role("button", name="Close", exact=True))
        wait_ui(page, lambda: menu.count() == 0, "a closed sheet is out of the tree")
        expect(page.get_by_role("searchbox", name="Search the desk", exact=True)).to_have_count(1)
        names_seen = []
        for _ in range(6):
            page.keyboard.press("Tab")
            names_seen.append(page.evaluate("() => (document.activeElement.textContent || '').trim()"))
        assert "Sign out" not in names_seen, f"a closed sheet stays out of the Tab order: {names_seen}"


def test_wf_clients_and_pieces_search_down(browser: Browser, meilisearch: Meilisearch) -> None:
    base = copy_url("APP_SEARCH_DOWN_URL")
    desk = new_desk(base)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    assert_error(desk.search(piece["title"]), 503, "Search is unavailable right now. The full list is still here.")
    empty = desk.search("")
    assert empty.status_code == 200 and empty.json()["results"] == [], "empty text is answered with no call to the engine"
    assert piece["id"] in [p["id"] for p in desk.j("GET", "/api/pieces")["pieces"]], "lists read Postgres"
    with screen(browser, base, "/pieces", desk) as page:
        h1(page, "Pieces")
        box = page.get_by_role("searchbox", name="Search the desk", exact=True)
        box.fill(piece["title"])
        wait_ui(page, lambda: "Search is unavailable right now. The full list is still here." in page.locator("body").inner_text(), "the box shows F-17")
        expect(page.get_by_role("link", name=piece["title"], exact=True).first).to_be_visible()
        expect(box).to_have_value(piece["title"])


def test_stamp_rules(app_url: str) -> None:
    desk, other = new_desk(app_url), new_desk(app_url)
    client = desk.add_client()
    stamp = luhn_stamp()
    assert_error(desk.call("POST", "/api/pieces", json={"clientId": client["id"], "title": "T", "stampNumber": "48201769"}), 422, "That stamp number does not check out. Read it again from the frame.")
    assert desk.j("GET", "/api/pieces")["pieces"] == [], "a refused piece is not kept"
    for short in ("4820176", "482017680", "4820176a"):
        assert_error(desk.call("POST", "/api/pieces", json={"clientId": client["id"], "title": "T", "stampNumber": short}), 422, "That stamp number does not check out. Read it again from the frame.")
    worked = desk.add_piece(client["id"], stampNumber="48201768")
    assert worked["stampNumber"] == "48201768"
    first = desk.add_piece(client["id"], stampNumber=stamp)
    assert_error(desk.call("POST", "/api/pieces", json={"clientId": client["id"], "title": "T", "stampNumber": stamp}), 409, "Another piece on this desk has that stamp number.")
    plain = desk.add_piece(client["id"])
    assert_error(desk.call("PATCH", f"/api/pieces/{plain['id']}", json={"stampNumber": stamp}), 409, "Another piece on this desk has that stamp number.")
    assert_error(desk.call("PATCH", f"/api/pieces/{plain['id']}", json={"stampNumber": bad_stamp(stamp)}), 422, "That stamp number does not check out. Read it again from the frame.")
    assert not desk.j("GET", f"/api/pieces/{plain['id']}")["piece"].get("stampNumber")
    other_client = other.add_client()
    assert other.add_piece(other_client["id"], stampNumber=stamp)["stampNumber"] == stamp, "unique on its desk only"
    assert first["id"] != plain["id"]


def test_pieces_list_paging_and_url(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    first_client, second_client = desk.add_client(), desk.add_client()
    originals = []
    for i in range(PAGING_PIECES):
        originals.append(desk.add_piece(first_client["id"], title=f"M piece {i:02d}", due_days=(None if i == 0 else 30 + i), dims=False)["id"])
    other = desk.add_piece(second_client["id"], title="Z other", due_days=5, dims=False)
    ready = desk.add_piece(second_client["id"], title="Z ready", due_days=6, dims=False)
    desk.j("PATCH", f"/api/pieces/{ready['id']}", json={"state": "ready"})
    archived = desk.add_piece(second_client["id"], title="Z archived", due_days=6, dims=False)
    desk.j("PATCH", f"/api/pieces/{archived['id']}", json={"state": "archived"})

    seen: list[str] = []
    cursor: str | None = None
    batch = 0
    for _ in range(PAGING_PIECES):
        page_body = desk.j("GET", "/api/pieces", params={"sort": "title", **({"cursor": cursor} if cursor else {})})
        assert len(page_body["pieces"]) <= PAGE_SIZE
        seen.extend(p["id"] for p in page_body["pieces"])
        desk.add_piece(first_client["id"], title=f"A early {batch}", dims=False)
        desk.add_piece(first_client["id"], title=f"Zz late {batch}", dims=False)
        batch += 1
        cursor = page_body["nextCursor"]
        if cursor is None:
            break
    assert len(seen) == len(set(seen)), "a cursor never repeats a piece"
    assert set(originals) <= set(seen) and other["id"] in seen and archived["id"] not in seen, "a cursor never skips a piece; archived stays out"

    by_due = desk.j("GET", "/api/pieces", params={"sort": "dueDate"})["pieces"]
    dues = [p.get("dueDate") for p in by_due if p.get("dueDate")]
    assert dues == sorted(dues), "dueDate ascending"
    assert by_due[0]["id"] == other["id"]
    only = desk.j("GET", "/api/pieces", params={"client": second_client["id"]})["pieces"]
    assert {p["id"] for p in only} == {other["id"], ready["id"]}
    assert [p["id"] for p in desk.j("GET", "/api/pieces", params={"state": "ready"})["pieces"]] == [ready["id"]]
    assert [p["id"] for p in desk.j("GET", "/api/pieces", params={"state": "archived"})["pieces"]] == [archived["id"]]

    with screen(browser, app_url, "/pieces", desk) as page:
        h1(page, "Pieces")
        history = page.evaluate("() => history.length")
        select(page.get_by_role("combobox", name=named("Sort")), "Due date")
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("sort") == ["dueDate"], "sort lives in the URL")
        assert page.evaluate("() => history.length") == history + 1
        select(page.get_by_role("combobox", name=named("Sort")), "Title")
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("sort") in (["title"], None), "the title order: `sort=title`, or no `sort` if a build leaves its default out")
        next_page = page.get_by_role("link", name="Next page", exact=True)
        wait_ui(page, lambda: next_page.count() > 0, "Next page shows")
        target = page.get_by_role("region", name="Pieces table", exact=True).get_by_role("link").first
        first_page = target.inner_text().strip()
        next_page.click()
        wait_ui(page, lambda: "cursor" in parse_qs(urlparse(page.url).query), "the cursor lives in the URL")
        paged = page.url
        wait_ui(page, lambda: target.count() > 0 and target.inner_text().strip() != first_page, "the second page lists its own pieces")
        title = target.inner_text().strip()
        target.click()
        wait_ui(page, lambda: re.fullmatch(r"/pieces/[^/]+", urlparse(page.url).path), "a piece opens")
        page.go_back()
        wait_ui(page, lambda: page.url == paged, "Back returns to the same filters, sort and page")
        link = page.get_by_role("link", name=title, exact=True)
        wait_ui(page, lambda: link.count() > 0 and link.evaluate("l => l === document.activeElement"), "focus on the link of the piece just left")
    uncut_desk = new_desk(app_url)
    client = uncut_desk.add_client()
    titles = [uncut_desk.add_piece(client["id"], title=f"P{i:02d} {word(6)}", dims=False)["title"] for i in range(PAGE_SIZE)]
    last = sorted(titles)[-1]
    for size in (DESKTOP, PHONE):
        with screen(browser, app_url, "/pieces", uncut_desk, size=size) as page:
            h1(page, "Pieces")
            action = page.get_by_role("button", name=f"Actions for {last}", exact=True)
            wait_ui(page, lambda: action.count() > 0, "the last row's menu button")
            action.scroll_into_view_if_needed()
            action.focus()
            page.keyboard.press("Enter")
            menu = page.get_by_role("menu")
            wait_ui(page, lambda: menu.count() > 0, "the menu opens")
            page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
            for item in ("Open", "Duplicate", "Archive"):
                box = menu.get_by_role("menuitem", name=item, exact=True).bounding_box()
                assert box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= size["width"] and box["y"] + box["height"] <= size["height"], f"SR13: {item} is cut at {size}: {box}"
                x, y = center(menu.get_by_role("menuitem", name=item, exact=True))
                assert menu.get_by_role("menuitem", name=item, exact=True).evaluate("(e, p) => { const h = document.elementFromPoint(p[0], p[1]); return !!h && (h === e || e.contains(h)); }", [x, y]), f"{item} can be pressed where it shows"
            page.mouse.click(*center(menu.get_by_role("menuitem", name="Open", exact=True)))
            wait_ui(page, lambda: re.fullmatch(r"/pieces/[^/]+", urlparse(page.url).path), "Open goes to the piece")


def test_search_through_the_engine(app_url: str, meilisearch: Meilisearch) -> None:
    desk, other = new_desk(app_url), new_desk(app_url)
    wanted = {"kind": "material", "id": "VM-2041", "label": "Tabacco VM-2041", "href": "/library?material=VM-2041"}
    poll(lambda: wanted in desk.j("GET", "/api/search", params={"q": "tabaco"})["results"], "a new desk's materials reach the engine; one slip is forgiven")
    assert any(r["id"] == "VM-2041" for r in desk.search("VM-2041").json()["results"]), "codes are searchable"
    name_word, title_word = word(), word()
    client = desk.add_client(name=f"Marta {name_word}")
    started = time.monotonic()
    piece = desk.add_piece(client["id"], title=f"Lounge {title_word}")
    slip = title_word[:3] + title_word[4:]
    poll(lambda: any(r["kind"] == "piece" and r["id"] == piece["id"] and r["label"] == piece["title"] for r in desk.search(slip).json()["results"]), "a new piece is found despite one slip", SEARCH_FINDS_SECONDS)
    assert time.monotonic() - started <= SEARCH_FINDS_SECONDS + 1
    poll(lambda: any(r["kind"] == "client" for r in desk.search(name_word).json()["results"]), "a client name is searchable", SEARCH_FINDS_SECONDS)
    assert desk.search(title_word).json()["results"][0]["href"], "results carry a link"
    assert other.search(title_word).json()["results"] == [], "another desk's piece never returns"
    assert other.search(name_word).json()["results"] == [], "another desk's client never returns"
    renamed = word()
    desk.j("PATCH", f"/api/pieces/{piece['id']}", json={"title": f"Lounge {renamed}"})
    poll(lambda: any(r["id"] == piece["id"] for r in desk.search(renamed).json()["results"]), "a renamed piece is found", SEARCH_FINDS_SECONDS)
    poll(lambda: not any(r["id"] == piece["id"] for r in desk.search(title_word).json()["results"]), "the old name is gone", SEARCH_FINDS_SECONDS)
    for typed in ("中村 葵", "سارة المنصوري", "Zoë Ørsted"):
        foreign = desk.add_client(name=typed)
        poll(lambda: any(r["id"] == foreign["id"] and r["label"] == typed for r in desk.search(typed).json()["results"]), f"{typed} is found exactly as printed", SEARCH_FINDS_SECONDS)
    assert len(desk.search("VM").json()["results"]) <= SEARCH_RESULTS
    empty = desk.search("")
    assert empty.status_code == 200 and empty.json()["results"] == []
    assert desk.search("x" * QUERY_LIMIT).status_code == 200
    began = time.monotonic()
    assert_error(desk.search("x" * (QUERY_LIMIT + 1)), 422)
    assert time.monotonic() - began <= QUICK_ANSWER_SECONDS
    nested: Any = 1
    for _ in range(DEPTH_LIMIT + 1):
        nested = [nested]
    began = time.monotonic()
    assert_error(desk.call("POST", "/api/pieces", json={"clientId": client["id"], "title": "T", "x": nested}), 422)
    assert time.monotonic() - began <= QUICK_ANSWER_SECONDS
    meilisearch.settled()
    doc = meilisearch.document("main_entries", f"{desk.id}-piece-{piece['id']}")
    assert doc and doc["deskId"] == desk.id and doc["kind"] == "piece" and doc["label"] == f"Lounge {renamed}"
    settings = meilisearch.settings("main_entries")
    assert settings["searchableAttributes"] == ["label"] and "deskId" in settings["filterableAttributes"]
    assert meilisearch.indexes()["main_entries"]["primaryKey"] == "id"
    assert_error(http("GET", f"{app_url}/api/search", params={"q": title_word}), 401)


def test_close_restore_and_erase(browser: Browser, app_url: str, mail: Any, meilisearch: Meilisearch) -> None:
    desk = new_desk(app_url)
    client = desk.add_client(name=f"Close {word()}")
    piece = desk.add_piece(client["id"])
    before_doc = meilisearch.document("main_entries", f"{desk.id}-piece-{piece['id']}") or poll(lambda: meilisearch.document("main_entries", f"{desk.id}-piece-{piece['id']}"), "the piece is indexed")
    with screen(browser, app_url, f"/clients/{client['id']}", desk) as page:
        h1(page, client["name"])
        page.get_by_role("button", name="Close client", exact=True).click()
        dialog = page.get_by_role("dialog", name="Close this client", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the close dialog opens")
        dialog.get_by_role("button", name="Close client", exact=True).click()
        closes = parse_instant(poll(lambda: desk.j("GET", f"/api/clients/{client['id']}")["client"].get("closesAt"), "closesAt is set"))
        said(page, f"{client['name']} is closing. You can bring it back until {date_copy(closes.astimezone(TURIN).date())}.")
        assert closes - datetime.now(UTC) <= timedelta(seconds=PRIMARY_CLOSURE_SECONDS)
        page.get_by_role("button", name="Bring back", exact=True).click()
        said(page, f"{client['name']} is back.")
    restored = desk.j("GET", f"/api/clients/{client['id']}")["client"]
    assert restored["state"] == "active" and restored["name"] == client["name"] and restored["email"] == client["email"] and restored["town"] == client["town"] and not restored["closesAt"]
    assert desk.j("GET", f"/api/pieces/{piece['id']}")["piece"]["title"] == piece["title"]
    meilisearch.settled()
    assert meilisearch.document("main_entries", f"{desk.id}-piece-{piece['id']}") == before_doc, "search entries are as they were"

    base = copy_url("APP_SHORT_URL")
    short = new_desk(base)
    setup = client_page_setup(short, code=None, lot=None, name=f"Erase {word()}", photos=True)
    photo_prefix = f"photographs/{short.id}/{setup.piece['id']}/"
    store = S3("-short")
    engine_docs = lambda: [d for d in meilisearch.documents("short_entries") if d.get("deskId") == short.id and d.get("kind") in ("client", "piece")]
    assert store.keys(photo_prefix), "photographs stored before the wait"
    assert poll(engine_docs, "entries indexed before the wait")
    assert short.j("POST", f"/api/clients/{setup.client['id']}/close", json={})["client"]["state"] == "closing"
    assert http("GET", f"{base}/c/{setup.token}").status_code == 200, "during closing the addresses keep answering"
    def erased_row() -> dict[str, Any] | None:
        rows = [c for c in short.j("GET", "/api/clients")["clients"] if c["id"] == setup.client["id"]]
        return rows[0] if rows and rows[0]["state"] == "erased" else None
    row = poll(erased_row, "the client reaches erased after the wait", SHORT_CLOSURE_SECONDS + API_DEADLINE)
    assert row == {"id": setup.client["id"], "name": "Erased client", "state": "erased"}, f"an erased row holds nothing else: {row}"
    assert_error(short.call("GET", f"/api/clients/{setup.client['id']}"), 404)
    assert_error(short.call("GET", f"/api/pieces/{setup.piece['id']}"), 404)
    assert_error(short.call("POST", f"/api/clients/{setup.client['id']}/bring-back", json={}), 404)
    assert http("GET", f"{base}/c/{setup.token}").status_code == 404, "private pages answer 404, never 410"
    assert not store.keys(photo_prefix), "photographs are gone from MinIO"
    meilisearch.settled()
    assert engine_docs() == [] or not any(d.get("refId") in (setup.client["id"], setup.piece["id"]) for d in engine_docs()), "entries are gone from Meilisearch"
    assert short.search(setup.client["name"].split()[1]).json()["results"] == []
    database = Postgres("_short")
    for table in database.tables():
        schema, relation = table.split(".", 1)
        hits = database.rows(f"SELECT count(*) AS n FROM \"{schema}\".\"{relation}\" AS t WHERE t::text LIKE '%{setup.client['name']}%'")
        assert hits[0]["n"] == 0, f"the erased client's name remains in {table}"
    subjects = [m["Subject"] for m in mails_to(mail, setup.client["email"])]
    assert not any(s.startswith("Reminder") or s.startswith("Promemoria") for s in subjects), f"no reminder during the wait: {subjects}"
    with screen(browser, base, "/clients", short) as page:
        h1(page, "Clients")
        table = page.get_by_role("region", name="Clients table", exact=True)
        wait_ui(page, lambda: "Erased client" in table.inner_text() and "Erased" in table.inner_text(), "the row reads Erased client")
        assert setup.client["name"] not in table.inner_text()


@pytest.mark.timeout(300)
def test_erasing_waits_for_both_providers() -> None:
    for env in ("APP_MINIO_DOWN_URL", "APP_SEARCH_DOWN_URL"):
        base = copy_url(env)
        desk = new_desk(base)
        client = desk.add_client()
        assert desk.j("POST", f"/api/clients/{client['id']}/close", json={})["client"]["state"] == "closing"
        def state() -> str | None:
            rows = [c for c in desk.j("GET", "/api/clients")["clients"] if c["id"] == client["id"]]
            return rows[0]["state"] if rows else None
        poll(lambda: state() == "erasing", f"{env}: closing moves to erasing the moment the wait has passed", OUTAGE_CLOSURE_SECONDS + API_DEADLINE)
        assert_error(desk.call("GET", f"/api/clients/{client['id']}"), 404)
        assert_error(desk.call("POST", f"/api/clients/{client['id']}/bring-back", json={}), 404)
        deadline = time.monotonic() + OUTAGE_CLOSURE_SECONDS
        while time.monotonic() < deadline:
            assert state() == "erasing", f"{env}: `erased` needs both providers to confirm"


def pin_button(page: Page, label: str) -> Locator:
    return page.get_by_role("button", name=label, exact=True)


def test_screen_rules_condition(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    desk.j("POST", f"/api/pieces/{piece['id']}/pins", 201, json={"x": 99.0, "y": 99.0, "kind": "tear", "note": "**edge**", "signed": True})
    assert_contract(app_url, f"/api/pieces/{piece['id']}/pins", instants_of=lambda: desk.j("GET", f"/api/pieces/{piece['id']}/photographs"))
    title = piece["title"]
    with screen(browser, app_url, f"/pieces/{piece['id']}/condition", desk) as page:
        h1(page, f"Condition of {title}")
        assert announcements(page).count() == 1
        pin = pin_button(page, "Pin 1: Tear")
        wait_ui(page, lambda: pin.count() > 0, "the pin shows")
        tab_into(page, page.locator('[data-part="condition-map"]'))
        page.keyboard.press("Enter")
        popover = page.get_by_role("dialog", name="Pin 1", exact=True)
        wait_ui(page, lambda: popover.count() > 0, "Enter opens the popover")
        expect(popover.get_by_role("button", name="Remove pin", exact=True)).to_be_focused()
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        box = popover.bounding_box()
        assert box and box["x"] >= 0 and box["y"] >= 0 and box["x"] + box["width"] <= DESKTOP["width"] and box["y"] + box["height"] <= DESKTOP["height"], f"SR13: the popover is cut at the edge: {box}"
        advance(page, REFRESH_MS)
        assert popover.count() == 1, "SR1: a refresh keeps the popover open"
        page.keyboard.press("Tab")
        for _ in range(4):
            if popover.count() == 0 or pin.evaluate("p => p === document.activeElement"):
                break
            page.keyboard.press("Tab")
        wait_ui(page, lambda: popover.count() == 0, "Tab past the last control closes the popover")
        expect(pin).to_be_focused()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: popover.count() > 0, "Enter opens it again")
        page.keyboard.press("Escape")
        expect(pin).to_be_focused()
        add = page.get_by_role("button", name="Add a pin", exact=True)
        add.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: page.locator('[data-part="crosshair"]').count() == 1, "the crosshair shows")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Pin", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "placing opens the Pin dialog")
        expect(dialog.get_by_role("combobox", name=named("Kind"))).to_be_focused()
        for _ in range(TRAP_PRESSES):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: Tab stays inside the Pin dialog"
        axe(page)
        escape_panel(page, dialog)
        wait_ui(page, lambda: dialog.count() == 0, "SR8: the Pin dialog closes on Escape")
    with screen(browser, app_url, f"/pieces/{piece['id']}/condition", desk, size=PHONE) as page:
        h1(page, f"Condition of {title}")
        pin = pin_button(page, "Pin 1: Tear")
        wait_ui(page, lambda: pin.count() > 0, "the pin shows at 375")
        tap(pin)
        popover = page.get_by_role("dialog", name="Pin 1", exact=True)
        wait_ui(page, lambda: popover.count() > 0, "a tap opens the popover")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        box = popover.bounding_box()
        assert box and box["x"] >= 0 and box["x"] + box["width"] <= PHONE["width"] and box["y"] >= 0 and box["y"] + box["height"] <= PHONE["height"], f"SR13 at 375: {box}"
    sweep_routes(browser, app_url, "condition", "photographs")


def test_wf_condition_map_and_photographs_keyboard(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/condition", desk) as page:
        h1(page, f"Condition of {piece['title']}")
        expect(page).to_have_title(f"Condition of {piece['title']} — Semenza Desk")
        add = page.get_by_role("button", name="Add a pin", exact=True)
        add.focus()
        page.keyboard.press("Enter")
        cross = page.locator('[data-part="crosshair"]')
        wait_ui(page, lambda: cross.count() == 1, "the crosshair shows")
        expect(cross).to_have_attribute("data-x", "50.0")
        expect(cross).to_have_attribute("data-y", "50.0")
        page.keyboard.press("ArrowRight")
        expect(cross).to_have_attribute("data-x", "51.0")
        page.keyboard.press("Shift+ArrowDown")
        expect(cross).to_have_attribute("data-y", "60.0")
        page.keyboard.press("Escape")
        wait_ui(page, lambda: cross.count() == 0, "Escape leaves with no pin")
        assert desk.j("GET", f"/api/pieces/{piece['id']}/pins")["pins"] == []
        add.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: cross.count() == 1, "the crosshair shows again")
        expect(cross).to_have_attribute("data-x", "50.0")
        page.keyboard.press("Shift+ArrowUp")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Pin", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "placing opens the Pin dialog")
        expect(dialog.get_by_role("combobox", name=named("Kind"))).to_be_focused()
        select(dialog.get_by_role("combobox", name=named("Kind")), "Crack")
        dialog.get_by_role("textbox", name=named("Note")).fill("n" * 2001)
        dialog.get_by_role("button", name="Save pin", exact=True).focus()
        page.keyboard.press("Enter")
        check_problems(page, dialog, dialog.get_by_role("textbox", name=named("Note")), "This is longer than 2,000 characters.")
        dialog.get_by_role("textbox", name=named("Note")).fill("A crack")
        pick(dialog.get_by_role("checkbox", name="Signed note", exact=True))
        press_held(page, dialog, "Save pin", f"**/api/pieces/{piece['id']}/pins")
        said(page, "Pin placed at 50.0, 40.0.")
        pins = desk.j("GET", f"/api/pieces/{piece['id']}/pins")["pins"]
        assert [(p["number"], float(p["x"]), float(p["y"]), p["kind"], p["signed"]) for p in pins] == [(1, 50.0, 40.0, "crack", True)]
        desk.j("POST", f"/api/pieces/{piece['id']}/pins", 201, json={"x": 10.0, "y": 70.0, "kind": "stain", "note": "s", "signed": False})
        advance(page, REFRESH_MS)
        first, second = pin_button(page, "Pin 1: Crack"), pin_button(page, "Pin 2: Stain")
        wait_ui(page, lambda: second.count() > 0, "the refresh brings the second pin")
        expect(first).to_have_attribute("data-x", "50.0")
        expect(first).to_have_attribute("data-y", "40.0")
        first.focus()
        page.keyboard.press("ArrowDown")
        expect(second).to_be_focused()
        page.keyboard.press("Enter")
        popover = page.get_by_role("dialog", name="Pin 2", exact=True)
        wait_ui(page, lambda: popover.count() > 0, "the popover opens")
        press_held(page, popover, "Remove pin", f"**/api/pieces/{piece['id']}/pins/*", method="DELETE")
        said(page, "Pin removed.")
        wait_ui(page, lambda: first.evaluate("e => e === document.activeElement"), "focus moves to the next pin")
        page.keyboard.press("Enter")
        popover = page.get_by_role("dialog", name="Pin 1", exact=True)
        wait_ui(page, lambda: popover.count() > 0, "the popover opens")
        popover.get_by_role("button", name="Remove pin", exact=True).focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: add.evaluate("e => e === document.activeElement"), "focus moves to Add a pin when none is left")
        assert desk.j("GET", f"/api/pieces/{piece['id']}/pins")["pins"] == []


def test_wf_condition_map_and_photographs_touch(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/condition", desk, size=PHONE) as page:
        h1(page, f"Condition of {piece['title']}")
        layout(page)
        condition_map = page.locator('[data-part="condition-map"]')
        condition_map.scroll_into_view_if_needed()
        box = condition_map.bounding_box()
        assert box
        tap(condition_map)
        dialog = page.get_by_role("dialog", name="Pin", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "a tap places a pin and opens the dialog")
        landed(page)
        dialog.get_by_role("textbox", name=named("Note")).fill("tapped")
        tap(dialog.get_by_role("button", name="Save pin", exact=True))
        said(page, re.compile(r"Pin placed at \d+\.\d, \d+\.\d\."))
        pins = desk.j("GET", f"/api/pieces/{piece['id']}/pins")["pins"]
        assert len(pins) == 1 and abs(float(pins[0]["x"]) - 50) <= 5 and abs(float(pins[0]["y"]) - 50) <= 5, f"the pin sits at the tapped point: {pins}"
        marker = page.locator('[data-part="pin"]').first
        wait_ui(page, lambda: marker.count() == 1, "the pin shows")
        assert_touch_targets(page)
    good_a, good_b = png(), jpeg()
    with screen(browser, app_url, f"/pieces/{piece['id']}/photographs", desk, size=PHONE) as page:
        h1(page, f"Photographs of {piece['title']}")
        expect(page.get_by_role("radiogroup", name="Side", exact=True).get_by_role("radio", name="Before", exact=True)).to_be_checked()
        bar = page.get_by_role("toolbar", name="Main action", exact=True)
        with page.expect_file_chooser() as chooser:
            tap(bar.get_by_text("Add photographs", exact=True))
        chooser.value.set_files([
            {"name": "one.png", "mimeType": "image/png", "buffer": good_a},
            {"name": "bad.png", "mimeType": "image/png", "buffer": b"this is not a picture"},
            {"name": "two.jpg", "mimeType": "image/jpeg", "buffer": good_b},
        ])
        uploads = page.get_by_role("list", name="Uploads", exact=True)
        wait_ui(page, lambda: uploads.get_by_role("listitem").count() == 3, "each file gets its own row")
        rows = uploads.get_by_role("listitem")
        def row_with(name: str) -> Locator:
            return rows.filter(has_text=name)
        wait_ui(page, lambda: "Stored" in row_with("one.png").inner_text() and "Stored" in row_with("two.jpg").inner_text(), "a refused file never stops the others")
        wait_ui(page, lambda: "Refused" in row_with("bad.png").inner_text() and "This file is not a PNG or JPEG." in row_with("bad.png").inner_text(), "the refused row reads F-24")
        expect(row_with("bad.png").get_by_role("button", name="Try again", exact=True)).to_be_visible()
    store = S3()
    for data in (good_a, good_b):
        key = f"photographs/{desk.id}/{piece['id']}/{hashlib.sha256(data).hexdigest()}"
        assert store.get(key) == data, "kept byte for byte"
    assert len(store.keys(f"photographs/{desk.id}/{piece['id']}/")) == 2, "the refused file was not kept"


def test_wf_condition_map_and_photographs_store_down(browser: Browser) -> None:
    base = copy_url("APP_MINIO_DOWN_URL")
    desk = new_desk(base)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    assert_error(desk.upload(piece["id"], png()), 503, "The file store is unavailable right now. Nothing was saved.")
    assert desk.j("GET", f"/api/pieces/{piece['id']}/photographs")["photographs"] == [], "no half-written photograph"
    with screen(browser, base, f"/pieces/{piece['id']}/photographs", desk) as page:
        h1(page, f"Photographs of {piece['title']}")
        with page.expect_file_chooser() as chooser:
            page.get_by_text("Add photographs", exact=True).first.click()
        chooser.value.set_files([{"name": "down.png", "mimeType": "image/png", "buffer": png()}])
        said(page, "The file store is unavailable right now. Nothing was saved.")
        row = page.get_by_role("list", name="Uploads", exact=True).get_by_role("listitem").filter(has_text="down.png")
        wait_ui(page, lambda: "Refused" in row.inner_text(), "the row reads Refused")
        assert "Stored" not in row.inner_text()
        expect(row.get_by_role("button", name="Try again", exact=True)).to_be_visible()
    assert desk.j("GET", f"/api/pieces/{piece['id']}/photographs")["photographs"] == []


def test_pin_rules(app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    path = f"/api/pieces/{piece['id']}/pins"
    def add(x: Any, y: Any, note: str = "n") -> httpx.Response:
        return desk.call("POST", path, json={"x": x, "y": y, "kind": "tear", "note": note, "signed": False})
    first = add(12.5, 80).json()["pin"]
    second = add(90.0, 10.0).json()["pin"]
    third = add(5.0, 10.0).json()["pin"]
    assert (first["number"], second["number"], third["number"]) == (1, 2, 3), "numbers follow creation order"
    assert float(first["x"]) == 12.5 and float(first["y"]) == 80
    assert [p["number"] for p in desk.j("GET", path)["pins"]] == [3, 2, 1], "ordered by y and then x"
    assert desk.call("DELETE", f"{path}/{third['id']}").status_code == 204
    assert add(1.0, 1.0).json()["pin"]["number"] == 4, "a removed pin's number is not used again"
    for x in (-1, 100.5, 12.55):
        assert_error(add(x, 5), 422, "That number is out of range.")
    assert_error(add("abc", 5), 422, "That is not a number. Write it like 12.50.")
    assert add(None, 5).status_code == 422, "a null coordinate keeps no pin; L410 and L726 both fit it, so either refusal will do"
    assert add(0, 100).status_code == 201, "0 and 100 are inside"
    assert add(1, 1, "😀" * 2000).status_code == 201, "2,000 emoji are 2,000 characters"
    assert_error(add(1, 1, "😀" * 2001), 422, "This is longer than 2,000 characters.")
    assert sorted(p["number"] for p in desk.j("GET", path)["pins"]) == [1, 2, 4, 5, 6], "refused pins were not kept"


def test_pin_note_markup(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, photos=False)
    note = f'**{BOLD_WORD}** *{ITALIC_WORD}* [{WEB_WORD}]({WEB_ADDRESS}) [{MAIL_WORD}]({MAIL_ADDRESS}) [{BAD_WORD}]({BAD_ADDRESS}) {IMG_OPEN} src=x onerror="window.__pwned=1"> {SCRIPT_OPEN}window.__pwned=1</script> [{FTP_WORD}](ftp://example.org)'
    pin = desk.j("POST", f"/api/pieces/{setup.piece['id']}/pins", 201, json={"x": 40.0, "y": 5.0, "kind": "stain", "note": note, "signed": True})["pin"]
    probe = """(root, word) => {
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        for (let n = walker.nextNode(); n; n = walker.nextNode()) {
            if (n.textContent.includes(word)) { const s = getComputedStyle(n.parentElement); return {weight: parseInt(s.fontWeight, 10), style: s.fontStyle}; }
        }
        return null;
    }"""
    with screen(browser, app_url, f"/pieces/{setup.piece['id']}/condition", desk) as page:
        h1(page, f"Condition of {setup.piece['title']}")
        marker = pin_button(page, f"Pin {pin['number']}: Stain")
        wait_ui(page, lambda: marker.count() > 0, "the pin shows")
        marker.focus()
        page.keyboard.press("Enter")
        popover = page.get_by_role("dialog", name=f"Pin {pin['number']}", exact=True)
        wait_ui(page, lambda: popover.count() > 0, "the popover opens")
        handle = popover.element_handle()
        assert handle.evaluate(probe, BOLD_WORD)["weight"] > handle.evaluate(probe, BAD_WORD)["weight"], "bold shows heavier than plain text"
        assert handle.evaluate(probe, ITALIC_WORD)["style"] == "italic"
        expect(popover.get_by_role("link", name=WEB_WORD, exact=True)).to_have_attribute("href", WEB_ADDRESS)
        expect(popover.get_by_role("link", name=MAIL_WORD, exact=True)).to_have_attribute("href", MAIL_ADDRESS)
        for plain in (BAD_WORD, FTP_WORD):
            assert popover.get_by_role("link", name=plain, exact=True).count() == 0, f"{plain} stays plain text"
        words = popover.inner_text()
        assert IMG_OPEN in words and SCRIPT_OPEN in words and BAD_ADDRESS in words and f"**{BOLD_WORD}**" not in words
        assert page.evaluate("() => window.__pwned") is None, "stored markup never runs"
    with screen(browser, app_url, f"/c/{setup.token}", size=PHONE) as page:
        h1(page, "Your piece") if setup.client["language"] == "en" else h1(page, "Il tuo pezzo")
        body = page.locator("body")
        wait_ui(page, lambda: BOLD_WORD in body.inner_text(), "the signed note reaches the client page")
        assert body.element_handle().evaluate(probe, BOLD_WORD)["weight"] > body.element_handle().evaluate(probe, BAD_WORD)["weight"], "bold shows heavier than plain text"
        expect(page.get_by_role("link", name=WEB_WORD, exact=True)).to_have_attribute("href", WEB_ADDRESS)
        assert page.get_by_role("link", name=BAD_WORD, exact=True).count() == 0
        assert SCRIPT_OPEN in body.inner_text() and page.evaluate("() => window.__pwned") is None
    assert desk.j("POST", f"/api/pieces/{setup.piece['id']}/dossier", 202, json={})
    assert dossier_settled(desk, setup.piece["id"])["state"] == "stored"
    words = re.sub(r"\s+", " ", pdf_text(desk.call("GET", f"/api/pieces/{setup.piece['id']}/dossier/pdf").content))
    assert BOLD_WORD in words and SCRIPT_OPEN in words and f"**{BOLD_WORD}**" not in words, "markup in the PDF follows the same rule"


def test_photograph_upload_rules(app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    path = f"/api/pieces/{piece['id']}/photographs"
    store = S3()
    at_limit = png(pad_to=PHOTO_LIMIT)
    made = desk.upload(piece["id"], at_limit)
    assert made.status_code == 201, made.text[:300]
    body = made.json()["photograph"]
    assert body["state"] == "stored" and body["bytes"] == PHOTO_LIMIT and body["number"] == 1 and body["side"] == "before"
    assert body["sha256"] == hashlib.sha256(at_limit).hexdigest()
    walk_instants(body)
    assert store.get(f"photographs/{desk.id}/{piece['id']}/{body['sha256']}") == at_limit, "kept in MinIO byte for byte"
    assert desk.call("GET", f"{path}/{body['id']}/file").content == at_limit
    over = png(pad_to=PHOTO_LIMIT + 1)
    assert_error(desk.upload(piece["id"], over), 413, "This file is over 8,000,000 bytes.")
    assert_error(http("POST", app_url + path, files={"file": ("o.png", over, "image/png")}), 413, "This file is over 8,000,000 bytes.")
    assert_error(http("POST", f"{app_url}/api/pieces/999999999/photographs", files={"file": ("o.png", over, "image/png")}), 413)
    big_request = desk.call("POST", path, files={"file": ("b.png", png(pad_to=PHOTO_IN_BIG_REQUEST), "image/png")}, data={"side": "after", "padding": "x" * (JSON_LIMIT - 1000)})
    assert big_request.status_code == 201, f"the limit is counted on the file alone: {big_request.status_code}"
    assert big_request.json()["photograph"]["side"] == "after"
    svg = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
    count = len(store.keys(f"photographs/{desk.id}/{piece['id']}/"))
    assert_error(desk.upload(piece["id"], svg, name="a.svg", kind="image/svg+xml"), 422, "This file is not a PNG or JPEG.")
    assert_error(desk.upload(piece["id"], svg, name="a.png", kind="image/png"), 422, "This file is not a PNG or JPEG.")
    assert_error(desk.upload(piece["id"], b"plain text", name="b.jpg", kind="image/jpeg"), 422, "This file is not a PNG or JPEG.")
    assert len(store.keys(f"photographs/{desk.id}/{piece['id']}/")) == count, "a refused file is not kept"
    named_wrong = desk.upload(piece["id"], png(), name="notes.txt", kind="text/plain")
    assert named_wrong.status_code == 201, "the name and declared type do not decide"
    assert desk.upload(piece["id"], jpeg(), name="c.jpg", kind="image/jpeg").status_code == 201
    assert_error(desk.upload(piece["id"], at_limit, name="again.png"), 409, "Already on this piece as photograph 1.")
    second_piece = desk.add_piece(client["id"])
    assert desk.upload(second_piece["id"], at_limit).status_code == 201, "a repeat is judged per piece"
    assert [p["number"] for p in desk.j("GET", path)["photographs"]] == [1, 2, 3, 4]


def test_before_after_slider(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    assert desk.upload(piece["id"], png(), "before").status_code == 201
    assert desk.upload(piece["id"], png(), "after").status_code == 201
    with screen(browser, app_url, f"/pieces/{piece['id']}/photographs?before=62", desk) as page:
        h1(page, f"Photographs of {piece['title']}")
        slider = page.get_by_role("slider", name="Before and after", exact=True)
        wait_ui(page, lambda: slider.count() > 0, "the slider shows")
        expect(slider).to_have_attribute("aria-valuetext", "62% before")
        length = page.evaluate("() => history.length")
        clear_motions(page)
        slider.focus()
        page.keyboard.press("ArrowLeft")
        expect(slider).to_have_attribute("aria-valuetext", "61% before")
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("before") == ["61"], "the URL follows")
        page.keyboard.press("Shift+ArrowRight")
        expect(slider).to_have_attribute("aria-valuetext", "71% before")
        wait_ui(page, lambda: parse_qs(urlparse(page.url).query).get("before") == ["71"], "the URL follows")
        assert page.evaluate("() => history.length") == length, "replacing the entry, never adding one"
        steps = motions(page)
        assert_motion_system(steps)
        assert any(r["duration"] == STEP_MS for r in steps), f"a keyboard step glides over 160 ms: {steps}"
    with screen(browser, app_url, f"/pieces/{piece['id']}/photographs?before=62", desk, reduced_motion="reduce") as page:
        slider = page.get_by_role("slider", name="Before and after", exact=True)
        wait_ui(page, lambda: slider.count() > 0, "the slider shows")
        slider.focus()
        clear_motions(page)
        page.keyboard.press("ArrowLeft")
        expect(slider).to_have_attribute("aria-valuetext", "61% before")
        assert_no_motion(motions(page))
    arabic = client_page_setup(desk, town="Dubai", photos=True, code=None, lot=None)
    with screen(browser, app_url, f"/c/{arabic.token}?before=50", size=PHONE) as page:
        slider = page.get_by_role("slider", name="قبل وبعد", exact=True)
        wait_ui(page, lambda: slider.count() > 0, "the Arabic slider shows")
        expect(slider).to_have_attribute("aria-valuetext", "50% قبل")
        slider.focus()
        page.keyboard.press("ArrowLeft")
        expect(slider).to_have_attribute("aria-valuetext", "51% قبل")
        page.keyboard.press("Shift+ArrowRight")
        expect(slider).to_have_attribute("aria-valuetext", "41% قبل")


def test_screen_rules_library(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    assert_contract(app_url, f"/api/pieces/{piece['id']}/holds", instants_of=lambda: desk.j("GET", "/api/session"))
    check_screen_rules(browser, app_url, "/library?material=VM-2041", desk, "Material library", "Hold a dye lot", "Hold a dye lot", first=lambda d: d.get_by_role("combobox", name=named("Piece")), draft=lambda d: d.get_by_role("textbox", name=named("Quantity")))
    sweep_routes(browser, app_url, "library")


def test_wf_material_library_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, "/library", desk) as page:
        h1(page, "Material library")
        aniline = page.get_by_role("radiogroup", name="Aniline", exact=True)
        wait_ui(page, lambda: aniline.count() > 0, "the families show")
        tabacco = aniline.get_by_role("radio", name="Tabacco VM-2041", exact=True)
        tab_into(page, aniline)
        page.keyboard.press("ArrowDown")
        wait_ui(page, lambda: aniline.get_by_role("radio", checked=True).count() == 1, "an arrow chooses a swatch")
        page.keyboard.press("Tab")
        others = [page.get_by_role("radiogroup", name=family, exact=True) for family in ("Semi-aniline", "Pull-up", "Wool")]
        next_family = next((group for group in others if group.evaluate("g => g.contains(document.activeElement)")), None)
        assert next_family is not None, "one Tab stop per family: Tab goes on to another family, in whatever order a build lists them"
        page.keyboard.press("ArrowDown")
        wait_ui(page, lambda: next_family.get_by_role("radio", checked=True).count() == 1, "a choice in the next family")
        assert aniline.get_by_role("radio", checked=True).count() == 0, "choosing in one family clears the others"
        tabacco.focus()
        page.keyboard.press("Space")
        wait_ui(page, lambda: tabacco.is_checked() and next_family.get_by_role("radio", checked=True).count() == 0, "one choice across the library")
        stock = page.get_by_role("region", name="Stock", exact=True)
        wait_ui(page, lambda: "L-2041-A" in stock.inner_text() and "L-2041-B" in stock.inner_text(), "the stock tile reads the lots")
        opener = page.get_by_role("button", name="Hold a dye lot", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Hold a dye lot", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the hold dialog opens")
        expect(dialog.get_by_role("combobox", name=named("Piece"))).to_be_focused()
        select(dialog.get_by_role("combobox", name=named("Piece")), piece["title"])
        pick(dialog.get_by_role("radiogroup", name="Lot", exact=True).get_by_role("radio", name="L-2041-A, 2 hides at 48.25 sq ft", exact=True))
        quantity = dialog.get_by_role("textbox", name=named("Quantity"))
        quantity.fill("abc")
        dialog.get_by_role("button", name="Hold", exact=True).focus()
        page.keyboard.press("Enter")
        check_problems(page, dialog, quantity, "That is not a number. Write it like 12.50.")
        quantity.fill("2")
        press_held(page, dialog, "Hold", f"**/api/pieces/{piece['id']}/holds")
        ends = turin_today() + timedelta(days=7)
        said(page, f"Held until {date_copy(ends)}")
        wait_ui(page, lambda: dialog.count() == 0, "the dialog closes")
        expect(opener).to_be_focused()
    calls = [c for c in journal(wiremock, "/v2/holds", "POST") if c["body"].get("pieceRef") == piece["id"]]
    assert len(calls) == 1 and calls[0]["body"]["code"] == "VM-2041" and calls[0]["body"]["lot"] == "L-2041-A" and calls[0]["headers"].get("idempotency-key"), f"journal: {calls}"
    hold = desk.j("GET", f"/api/pieces/{piece['id']}/holds")["holds"][0]
    assert hold["state"] == "held" and hold["endsOn"] == ends.isoformat() and hold["label"] == f"Held until {date_copy(ends)}" and hold["holdId"] == "H-7001"


def test_wf_material_library_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, "/library?material=VM-2044", desk, size=PHONE) as page:
        h1(page, "Material library")
        layout(page)
        wait_ui(page, lambda: page.get_by_role("radio", name="Salvia VM-2044", exact=True).is_checked(), "?material opens with that material chosen")
        assert_touch_targets(page)
        tab_into(page, page.get_by_role("radiogroup", name="Aniline", exact=True))
        for _ in range(4):
            wait_ui(page, lambda: page.evaluate(UNCOVERED), "a focused swatch is never under a sticky heading or a bar", seconds=3)
            page.keyboard.press("Tab")
        bar = page.get_by_role("toolbar", name="Main action", exact=True)
        tap(bar.get_by_role("button", name="Hold a dye lot", exact=True))
        dialog = page.get_by_role("dialog", name="Hold a dye lot", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the sheet opens")
        landed(page)
        select(dialog.get_by_role("combobox", name=named("Piece")), piece["title"])
        pick(dialog.get_by_role("radio", name="L-2044-A, 5 hides at 30.25 sq ft", exact=True))
        dialog.get_by_role("textbox", name=named("Quantity")).fill("2")
        press_held(page, dialog, "Hold", f"**/api/pieces/{piece['id']}/holds", touch=True)
        said(page, f"Held until {date_copy(turin_today() + timedelta(days=7))}")
    assert len([c for c in journal(wiremock, "/v2/holds", "POST") if c["body"].get("pieceRef") == piece["id"]]) == 1


def test_wf_material_library_refusals(browser: Browser, app_url: str, wiremock: Any) -> None:
    for form, copy_env in (("seconds", "APP_SPARE_URL"), ("date", "APP_GOTENBERG_DOWN_URL")):
        desk = new_desk(copy_url(copy_env))
        client = desk.add_client()
        piece = desk.add_piece(client["id"])
        retry = str(RETRY_AFTER_PROBE) if form == "seconds" else (datetime.now(UTC) + timedelta(seconds=RETRY_AFTER_PROBE)).strftime("%a, %d %b %Y %H:%M:%S GMT")
        stub = wiremock.stub("POST", "/v2/holds", status=429, headers={"Retry-After": retry})
        assert stub is not None
        said_at = datetime.now(UTC)
        refused = desk.call("POST", f"/api/pieces/{piece['id']}/holds", json={"code": "VM-2041", "lot": "L-2041-A", "quantity": 1})
        error = assert_error(refused, 429)
        match = re.fullmatch(r"The supplier is busy\. You can try again at (\d\d:\d\d) Turin time\.", error["message"])
        assert match and match.group(1) in minute_labels(said_at, said_at + timedelta(seconds=RETRY_AFTER_PROBE + 2)), error["message"]
        assert int(refused.headers["retry-after"]) >= 1
        calls = len(journal(wiremock, "/v2/holds", "POST"))
        again = desk.call("POST", f"/api/pieces/{piece['id']}/holds", json={"code": "VM-2041", "lot": "L-2041-A", "quantity": 1})
        if (datetime.now(UTC) - said_at).total_seconds() < RETRY_AFTER_PROBE - 2:
            assert_error(again, 429)
            assert len(journal(wiremock, "/v2/holds", "POST")) == calls, "no supplier call before that instant"
        assert desk.j("GET", f"/api/pieces/{piece['id']}/holds")["holds"] == []
        poll(lambda: len(journal(wiremock, "/v2/holds", "POST")) > calls or desk.call("POST", f"/api/pieces/{piece['id']}/holds", json={"code": "VM-2041", "lot": "L-2041-A", "quantity": 1}).status_code == 201, "the supplier is asked again after the instant", RETRY_AFTER_PROBE + API_DEADLINE)
        wiremock.stub("POST", "/v2/holds", status=201, json={"holdId": "H-7001"})
    primary = new_desk(app_url)
    client = primary.add_client()
    piece = primary.add_piece(client["id"])
    wiremock.fault("POST", "/v2/holds")
    assert_error(primary.call("POST", f"/api/pieces/{piece['id']}/holds", json={"code": "VM-2041", "lot": "L-2041-A", "quantity": 1}), 503, "The supplier is unavailable right now. Nothing changed.")
    assert primary.j("GET", f"/api/pieces/{piece['id']}/holds")["holds"] == [], "a failed hold is not kept"
    wiremock.stub("POST", "/v2/holds", status=201, json={"holdId": "H-7001"})
    with screen(browser, app_url, "/library?material=VM-2041", primary) as page:
        h1(page, "Material library")
        wait_ui(page, lambda: page.get_by_role("button", name="Hold a dye lot", exact=True).count() > 0, "the main action shows")
        page.get_by_role("button", name="Hold a dye lot", exact=True).click()
        dialog = page.get_by_role("dialog", name="Hold a dye lot", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        select(dialog.get_by_role("combobox", name=named("Piece")), piece["title"])
        lot = dialog.get_by_role("radio", name="L-2041-A, 2 hides at 48.25 sq ft", exact=True)
        wait_ui(page, lambda: lot.count() > 0, "lots show")
        pick(lot)
        dialog.get_by_role("textbox", name=named("Quantity")).fill("3")
        calls = len(journal(wiremock, "/v2/holds", "POST"))
        hold_button = dialog.get_by_role("button", name="Hold", exact=True)
        def press_hold() -> None:
            hold_button.focus()
            page.keyboard.press("Enter")
        announced_twice(page, press_hold, "No single dye lot holds 3 hides of Tabacco. The largest holds 2.")
        expect(dialog).to_be_visible()
        assert dialog.get_by_role("region", name="Problems", exact=True).inner_text().count("No single dye lot holds 3 hides of Tabacco. The largest holds 2.") >= 1
        assert len(journal(wiremock, "/v2/holds", "POST")) == calls, "no supplier call for a refusal"


def test_library_refresh_all_or_nothing(app_url: str, wiremock: Any, meilisearch: Meilisearch) -> None:
    desk = new_desk(app_url)
    assert journal(wiremock, "/v2/materials") == [], "the press is the only time the catalogue is read"
    assert len(desk.j("GET", "/api/materials")["materials"]) == 12, "a new desk has the first twelve materials"
    wiremock.stub("GET", "/v2/materials", status=500, query={"cursor": "p2"})
    assert_error(desk.call("POST", "/api/materials/refresh", json={}), 503, "The supplier could not be read. Your library has not changed.")
    assert len(desk.j("GET", "/api/materials")["materials"]) == 12, "a page that fails leaves the library as it was"
    meilisearch.settled()
    assert meilisearch.document("main_entries", f"{desk.id}-material-VM-3054") is None
    assert not any(r["id"] == "VM-3054" for r in desk.search("Tweed").json()["results"])
    fresh = WireMock()
    done = new_desk(app_url)
    assert done.j("POST", "/api/materials/refresh", json={})["count"] == 24, "the count follows what the pages held"
    cursors = [c["query"].get("cursor") for c in journal(fresh, "/v2/materials", "GET")]
    assert "p2" in cursors and "p3" in cursors, f"every page was read: {cursors}"
    assert meilisearch.document("main_entries", f"{done.id}-material-VM-3054"), "the entry is in Meilisearch once confirmed"
    assert any(r["id"] == "VM-3054" for r in done.search("Tweed").json()["results"])
    assert len(done.j("GET", "/api/materials")["materials"]) == 24
    outage = new_desk(copy_url("APP_SEARCH_DOWN_URL"))
    assert_error(outage.call("POST", "/api/materials/refresh", json={}), 503, "Search could not take the new entries. Your library has not changed.")
    assert len(outage.j("GET", "/api/materials")["materials"]) == 12, "refresh not confirmed changes nothing"


def test_swatches_and_compare_tray(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/library", desk) as page:
        h1(page, "Material library")
        for family in ("Aniline", "Semi-aniline", "Pull-up", "Wool"):
            group = page.get_by_role("radiogroup", name=family, exact=True)
            wait_ui(page, lambda: group.count() > 0, f"the {family} family shows")
            heading = page.get_by_role("heading", name=family, exact=True)
            assert heading.evaluate("h => { for (let e = h, i = 0; e && i < 3; e = e.parentElement, i++) { if (getComputedStyle(e).position === 'sticky') return true; } return false; }"), f"{family} has a sticky heading"
        order = [("Aniline", "Tabacco VM-2041"), ("Aniline", "Ruggine VM-2042"), ("Aniline", "Inchiostro VM-2043"), ("Semi-aniline", "Salvia VM-2044"), ("Semi-aniline", "Avena VM-2045")]
        add = page.get_by_role("button", name="Add to compare", exact=True)
        tray = page.get_by_role("region", name="Compare tray", exact=True)
        clear_motions(page)
        pick(page.get_by_role("radio", name=order[0][1], exact=True))
        wait_ui(page, lambda: any(r["duration"] == GLIDE_MS for r in motions(page)), "the drawing cross-fades over 320 ms")
        state_mark(page, page.get_by_role("radio", name=order[0][1], exact=True), lambda: pick(page.get_by_role("radio", name=order[1][1], exact=True)))
        pick(page.get_by_role("radio", name=order[0][1], exact=True))
        for index, (_, swatch) in enumerate(order[:4]):
            pick(page.get_by_role("radio", name=swatch, exact=True))
            if index == 0:
                page.evaluate(FINISH_JS)
                clear_motions(page)
            add.click()
            take_out = tray.get_by_role("button", name=f"Take out {swatch}", exact=True)
            wait_ui(page, lambda: take_out.count() == 1, f"{swatch} joins the tray")
            if index == 0:
                wait_ui(page, lambda: any(r["duration"] == GLIDE_MS for r in motions(page)), "the tray rises over 320 ms")
        pick(page.get_by_role("radio", name=order[4][1], exact=True))
        add.click()
        said(page, "The tray holds four. Take one out first.")
        assert tray.get_by_role("button").count() == 4
        marks = tray.evaluate("t => { const b = [...t.querySelectorAll('button')]; b.forEach((e, i) => { e.__kept = i; }); return b.length; }")
        assert marks == 4
        clear_motions(page)
        first = tray.get_by_role("button", name=f"Take out {order[0][1]}", exact=True)
        first.focus()
        page.keyboard.press("Enter")
        next_member = tray.get_by_role("button", name=f"Take out {order[1][1]}", exact=True)
        wait_ui(page, lambda: next_member.evaluate("e => e === document.activeElement"), "focus moves to the next member")
        assert next_member.evaluate("e => e.__kept === 1"), "members close up as the same elements"
        wait_ui(page, lambda: any(r["duration"] == STEP_MS for r in motions(page)), "members close up over 160 ms")
        assert_motion_system(motions(page))
        for name in (order[1][1], order[2][1]):
            button = tray.get_by_role("button", name=f"Take out {name}", exact=True)
            button.focus()
            page.keyboard.press("Enter")
            wait_ui(page, lambda: button.count() == 0, f"{name} leaves")
        last = tray.get_by_role("button", name=f"Take out {order[3][1]}", exact=True)
        last.focus()
        page.keyboard.press("Enter")
        swatches = page.get_by_role("heading", name="Swatches", exact=True)
        wait_ui(page, lambda: swatches.evaluate("h => h === document.activeElement"), "focus moves to Swatches when the tray empties")


def test_stock_reads_and_cache(browser: Browser, app_url: str, wiremock: Any) -> None:
    short = new_desk(copy_url("APP_SHORT_URL"))
    code, other = "VM-2047", "VM-2048"
    path = f"/v2/materials/{code}/lots"
    poll(lambda: short.call("GET", f"/api/materials/{code}/lots").status_code == 200 and journal(wiremock, path), "a first read reaches the supplier", SHORT_STOCK_SECONDS + API_DEADLINE)
    started = time.monotonic()
    read = short.j("GET", f"/api/materials/{code}/lots")
    assert read == {"code": code, "lots": [{"lot": "L-2000-A", "hides": 6, "averageSqFt": "48.25"}]}
    short.j("GET", f"/api/materials/{other}/lots")
    short.j("GET", f"/api/materials/{code}/lots")
    if time.monotonic() - started < SHORT_STOCK_SECONDS - 2:
        assert len(journal(wiremock, path)) == 1, "the same code calls once within the window, even A, then B, then A"
    poll(lambda: short.call("GET", f"/api/materials/{code}/lots").status_code == 200 and len(journal(wiremock, path)) >= 2, "the supplier is asked again after the window", SHORT_STOCK_SECONDS + API_DEADLINE)
    assert time.monotonic() - started >= SHORT_STOCK_SECONDS - 2, "no second call inside STOCK_CACHE_SECONDS"
    faulty = "VM-2049"
    wiremock.fault("GET", f"/v2/materials/{faulty}/lots")
    poll(lambda: short.call("GET", f"/api/materials/{faulty}/lots").status_code == 503, "a connection failure answers 503", SHORT_STOCK_SECONDS + API_DEADLINE)
    assert_error(short.call("GET", f"/api/materials/{faulty}/lots"), 503, "The supplier is unavailable right now. Nothing changed.")
    wiremock.stub("GET", f"/v2/materials/{faulty}/lots", status=200, json={"lots": [{"lot": "L-2000-A", "hides": 6, "averageSqFt": "48.25"}]})
    assert short.call("GET", f"/api/materials/{faulty}/lots").status_code == 200, "a failed read is not cached"
    desk = new_desk(app_url)
    with screen(browser, app_url, "/library", desk) as page:
        h1(page, "Material library")
        wait_ui(page, lambda: page.get_by_role("radio", name="Tabacco VM-2041", exact=True).count() > 0, "swatches show")
        with held(page, "**/api/materials/VM-2041/lots") as release:
            pick(page.get_by_role("radio", name="Tabacco VM-2041", exact=True))
            pick(page.get_by_role("radio", name="Salvia VM-2044", exact=True))
            stock = page.get_by_role("region", name="Stock", exact=True)
            wait_ui(page, lambda: "L-2044-A" in stock.inner_text(), "the latest choice's lots show")
            release()
        advance(page, 1000)
        assert page.request.get(f"{app_url}/api/materials/VM-2041/lots").status == 200
        wait_ui(page, lambda: "L-2044-A" in stock.inner_text() and "L-2041-A" not in stock.inner_text(), "a late answer never replaces the latest choice")


def test_dye_lot_holds(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    path = f"/api/pieces/{piece['id']}/holds"
    body = {"code": "VM-2041", "lot": "L-2041-A", "quantity": 2}
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(pool.map(lambda _: desk.call("POST", path, json=body), range(2)))
    assert sorted(a.status_code for a in answers) in ([200, 201], [201, 201]), [a.text for a in answers]
    repeat = desk.call("POST", path, json=body)
    assert repeat.status_code == 200
    held_row = repeat.json()["hold"]
    assert all(a.json()["hold"]["id"] == held_row["id"] for a in answers), "each gets the same hold back"
    def calls(piece_id: str) -> list[dict[str, Any]]:
        return [c for c in journal(wiremock, "/v2/holds", "POST") if c["body"].get("pieceRef") == piece_id]
    made = calls(piece["id"])
    assert len(made) == 1, f"one supplier call: {made}"
    assert texts(made[0]["body"]) == texts({"code": "VM-2041", "lot": "L-2041-A", "quantity": 2, "pieceRef": piece["id"]})
    key = made[0]["headers"]["idempotency-key"]
    ends = turin_today() + timedelta(days=7)
    assert held_row["endsOn"] == ends.isoformat() and held_row["state"] == "held" and held_row["label"] == f"Held until {date_copy(ends)}"
    assert_error(desk.call("POST", path, json={**body, "quantity": 1}), 409, "This lot is already held for this piece for 2 hides.")
    assert_error(desk.call("POST", path, json={"code": "VM-2041", "lot": "L-2041-B", "quantity": 1}), 409, "This piece is held on lot L-2041-A. All its hides come from one dye lot.")
    assert len(calls(piece["id"])) == 1, "no supplier call for a refusal"
    other = desk.add_piece(client["id"])
    other_path = f"/api/pieces/{other['id']}/holds"
    assert_error(desk.call("POST", other_path, json={"code": "VM-2041", "lot": "L-2041-A", "quantity": 3}), 409, "No single dye lot holds 3 hides of Tabacco. The largest holds 2.")
    assert_error(desk.call("POST", other_path, json={"code": "VM-3051", "lot": "L-3000-A", "quantity": "50.00"}), 409, "No single dye lot holds 50.00 m of Loden. The largest holds 40.00 m.")
    assert_error(desk.call("POST", other_path, json={"code": "VM-2041", "lot": "L-2041-B", "quantity": 2}), 409, "Lot L-2041-B holds 1 hide.")
    assert calls(other["id"]) == []
    fabric = desk.j("POST", other_path, 201, json={"code": "VM-3051", "lot": "L-3000-A", "quantity": "7.50"})["hold"]
    assert fabric["holdId"] == "H-7001", "the stand-in's id is a plain reference, never a unique key"
    assert calls(other["id"])[0]["headers"]["idempotency-key"] != key, "a new subject has a new repeat key"
    retried = desk.add_piece(client["id"])
    retried_path = f"/api/pieces/{retried['id']}/holds"
    wiremock.fault("POST", "/v2/holds")
    assert_error(desk.call("POST", retried_path, json=body), 503, "The supplier is unavailable right now. Nothing changed.")
    wiremock.stub("POST", "/v2/holds", status=201, json={"holdId": "H-7001"})
    assert desk.call("POST", retried_path, json=body).status_code == 201
    retried_keys = [c["headers"]["idempotency-key"] for c in calls(retried["id"])]
    assert len(retried_keys) >= 2 and len(set(retried_keys)) == 1, f"a retry carries the same repeat key: {retried_keys}"
    seeded = seed_desk(app_url)
    tubular = next(p for p in seeded.j("GET", "/api/pieces")["pieces"] if p["title"] == "Tubular armchair")
    ended = seeded.call("POST", f"/api/pieces/{tubular['id']}/holds", json={"code": "VM-2044", "lot": "L-2044-A", "quantity": 1})
    assert_error(ended, 409, re.compile(r"Hold ended on [A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}\."))
    assert calls(tubular["id"]) == [], "an ended hold stays ended"


def pattern(page: Page, name: str) -> Locator:
    return page.locator(f'[data-part="pattern-piece"][data-piece="{name}"]')


def figure_text(used_sqcm: int) -> str:
    used = (Decimal(used_sqcm) / SQFT_SQCM).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)
    percent = (Decimal(used_sqcm) * 100 / HIDE_AREA_SQCM).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return f"Used {used} sq ft of 51.67 sq ft ({percent}%)"


def hide_figure(page: Page, expected: str) -> None:
    figure = page.locator('[data-part="hide-figure"]')
    wait_ui(page, lambda: figure.count() > 0 and expected in re.sub(r"\s+", " ", figure.inner_text()), f"the figure reads {expected!r}")


def test_screen_rules_hide(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    resp = http("PUT", f"{app_url}/api/pieces/{piece['id']}/layout/placements/Seat", content=b'{"x":"' + b"a" * JSON_LIMIT + b'"}', headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN})
    assert_error(resp, 413)
    assert_contract(app_url, f"/api/pieces/{piece['id']}/layout", instants_of=lambda: desk.layout(piece["id"]))
    assert desk.place(piece["id"], "Seat", 0, 0).status_code == 200
    check_screen_rules(browser, app_url, f"/pieces/{piece['id']}/hide", desk, f"Hide for {piece['title']}", "Clear the hide", "Clear the hide")
    sweep_routes(browser, app_url, "hide")


def test_wf_hide_layout_keyboard(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk) as page:
        h1(page, f"Hide for {piece['title']}")
        hide = page.locator('[data-part="hide"]')
        wait_ui(page, lambda: pattern(page, "Seat").count() == 1, "the pieces show")
        for name in PIECE_SIZES:
            expect(pattern(page, name)).to_have_attribute("data-state", "tray")
            assert pattern(page, name).get_attribute("data-x") is None
        flaws = page.locator('[data-part="flaw"]')
        expect(flaws).to_have_count(2)
        expect(flaws.first).to_have_attribute("data-x", "120")
        expect(flaws.first).to_have_attribute("data-width", "30")
        tab_into(page, hide)
        expect(pattern(page, "Seat")).to_have_attribute("data-chosen", "true")
        page.keyboard.press("ArrowLeft")
        expect(pattern(page, "Headrest")).to_have_attribute("data-chosen", "true")
        page.keyboard.press("ArrowRight")
        expect(pattern(page, "Seat")).to_have_attribute("data-chosen", "true")
        page.keyboard.press("Enter")
        seat = pattern(page, "Seat")
        expect(seat).to_have_attribute("data-state", "lifted")
        expect(seat).to_have_attribute("data-x", "0")
        expect(seat).to_have_attribute("data-y", "0")
        said(page, "Seat lifted. Arrow keys move it, Enter places it, Escape puts it back.")
        page.keyboard.press("ArrowLeft")
        expect(seat).to_have_attribute("data-x", "-1")
        announced_twice(page, lambda: page.keyboard.press("Enter"), "Seat cannot go there. It runs off the hide.")
        expect(seat).to_have_attribute("data-state", "lifted")
        assert hide.evaluate("h => h === document.activeElement || h.contains(document.activeElement)"), "a refused place keeps focus on the hide"
        page.keyboard.press("ArrowRight")
        for _ in range(6):
            page.keyboard.press("Shift+ArrowRight")
        for _ in range(3):
            page.keyboard.press("Shift+ArrowDown")
        expect(seat).to_have_attribute("data-x", "60")
        expect(seat).to_have_attribute("data-y", "30")
        page.keyboard.press("Enter")
        said(page, "Seat cannot go there. It crosses the flaw at 120, 80 cm.")
        expect(seat).to_have_attribute("data-state", "lifted")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("r")
        expect(seat).to_have_attribute("data-rotation", "180")
        page.keyboard.press("r")
        expect(seat).to_have_attribute("data-rotation", "0")
        page.keyboard.press("Enter")
        said(page, "Seat placed at 58, 30 cm.")
        expect(seat).to_have_attribute("data-state", "placed")
        hide_figure(page, "Used 3.87 sq ft of 51.67 sq ft (7.5%)")
        row = next(p for p in desk.layout(piece["id"])["pieces"] if p["name"] == "Seat")
        assert (row["x"], row["y"], row["state"]) == (58, 30, "placed"), "touching the flaw's edge is allowed"
        page.keyboard.press("ArrowRight")
        back = pattern(page, "Back")
        expect(back).to_have_attribute("data-chosen", "true")
        page.keyboard.press("Enter")
        expect(back).to_have_attribute("data-state", "lifted")
        page.keyboard.press("Enter")
        said(page, "Back cannot go there. It overlaps Seat.")
        expect(back).to_have_attribute("data-state", "lifted")
        page.keyboard.press("Escape")
        said(page, "Back put back.")
        expect(back).to_have_attribute("data-state", "tray")
        assert back.get_attribute("data-x") is None
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        headrest = pattern(page, "Headrest")
        expect(headrest).to_have_attribute("data-chosen", "true")
        page.keyboard.press("Enter")
        for rotation in ("90", "180", "270", "0"):
            page.keyboard.press("r")
            expect(headrest).to_have_attribute("data-rotation", rotation)
        page.keyboard.press("Delete")
        said(page, "Headrest back in the tray.")
        expect(headrest).to_have_attribute("data-state", "tray")
        clear = page.get_by_role("button", name="Clear the hide", exact=True)
        clear.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Clear the hide", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the clear dialog opens")
        clear_call = re.compile(rf".*/api/pieces/{piece['id']}/layout(/placements/[^/?]+)?(\?.*)?")
        press_held(page, dialog, "Clear", clear_call, method=("POST", "DELETE"))
        said(page, "Hide cleared.")
        expect(clear).to_be_focused()
    assert all(p["state"] == "tray" for p in desk.layout(piece["id"])["pieces"]), "the server's layout is clear"


def test_wf_hide_layout_mouse(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    def drag_to(page: Page, item: Locator, x: int, y: int, per_cm: float) -> None:
        for _ in range(12):
            cx, cy = float(item.get_attribute("data-x") or 0), float(item.get_attribute("data-y") or 0)
            if (cx, cy) == (x, y):
                return
            position = page.evaluate("() => window.__pointer")
            page.mouse.move(position[0] + (x - cx) * per_cm, position[1] + (y - cy) * per_cm)
            page.evaluate("(p) => { window.__pointer = p; }", [position[0] + (x - cx) * per_cm, position[1] + (y - cy) * per_cm])
        pytest.fail(f"a drag never reached {x}, {y}; it reads {item.get_attribute('data-x')}, {item.get_attribute('data-y')}")
    def at_rest(page: Page, item: Locator) -> bool:
        before = item.bounding_box()
        advance(page, TICK_MS)
        return before == item.bounding_box()
    def press(page: Page, item: Locator) -> None:
        landed(page)
        wait_ui(page, lambda: at_rest(page, item), "the piece comes to rest")
        x, y = center(item)
        page.evaluate("(p) => { window.__pointer = p; }", [x, y])
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 1, y + 1)
        page.evaluate("(p) => { window.__pointer = p; }", [x + 1, y + 1])
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk) as page:
        h1(page, f"Hide for {piece['title']}")
        hide = page.locator('[data-part="hide"]')
        seat = pattern(page, "Seat")
        wait_ui(page, lambda: seat.count() == 1, "the pieces show")
        per_cm = hide.bounding_box()["width"] / HIDE_WIDTH_CM
        press(page, seat)
        wait_ui(page, lambda: seat.get_attribute("data-state") == "lifted", "pressing a piece lifts it")
        drag_to(page, seat, 10, 10, per_cm)
        page.mouse.up()
        said(page, "Seat placed at 10, 10 cm.")
        expect(seat).to_have_attribute("data-state", "placed")
        row = next(p for p in desk.layout(piece["id"])["pieces"] if p["name"] == "Seat")
        assert (row["x"], row["y"], row["state"]) == (10, 10, "placed")
        hide_figure(page, "Used 3.87 sq ft of 51.67 sq ft (7.5%)")
        back = pattern(page, "Back")
        press(page, back)
        wait_ui(page, lambda: back.get_attribute("data-state") == "lifted", "Back lifts")
        drag_to(page, back, 40, 40, per_cm)
        clear_motions(page)
        page.mouse.up()
        said(page, "Back cannot go there. It overlaps Seat.")
        wait_ui(page, lambda: back.get_attribute("data-state") == "tray", "a refused drop glides home")
        assert back.get_attribute("data-x") is None and back.get_attribute("data-y") is None
        assert any(r["duration"] == GLIDE_MS and r["piece"] == "Back" for r in motions(page)), "a refused drop glides over 320 ms"
        expect(seat).to_have_attribute("data-x", "10")
        sends: list[str] = []
        page.on("request", lambda r: sends.append(r.url) if r.method in ("PUT", "POST", "DELETE") else None)
        press(page, back)
        wait_ui(page, lambda: back.get_attribute("data-state") == "lifted", "Back lifts again")
        drag_to(page, back, 100, 120, per_cm)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: back.get_attribute("data-state") == "tray", "Escape during a drag glides it back")
        page.mouse.up()
        assert sends == [], f"Escape asks nothing of the server: {sends}"
        press(page, back)
        wait_ui(page, lambda: back.get_attribute("data-state") == "lifted", "Back lifts for the stale drop")
        drag_to(page, back, 100, 120, per_cm)
        with hold_reads(page):
            assert desk.place(piece["id"], "Headrest", 150, 200).status_code == 200, "another window changes the layout"
            with page.expect_response(writes_layout):
                page.mouse.up()
        said(page, re.compile(r"This layout was changed at \d\d:\d\d Turin time in another window\. Your piece is still lifted\."))
        expect(back).to_have_attribute("data-state", "lifted")
        expect(back).to_have_attribute("data-x", "100")
        expect(back).to_have_attribute("data-y", "120")
        hide.evaluate("h => { const e = h.matches('[tabindex]') ? h : h.querySelector('[tabindex=\"0\"]'); if (e) e.focus(); }")
        advance(page, REFRESH_MS)
        page.keyboard.press("Enter")
        said(page, "Back placed at 100, 120 cm.")
    assert next(p for p in desk.layout(piece["id"])["pieces"] if p["name"] == "Back")["state"] == "placed", "the next try uses the newest version"


def test_wf_hide_layout_touch(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk, size=PHONE) as page:
        h1(page, f"Hide for {piece['title']}")
        layout(page)
        bar = page.get_by_role("toolbar", name="Hide controls", exact=True)
        wait_ui(page, lambda: bar.count() > 0, "the bar shows")
        def press(name: str) -> None:
            tap(bar.get_by_role("button", name=name, exact=True))
        for name in ("Seat", "Back", "Left side", "Right side", "Headrest", "Lift", "Up", "Down", "Left", "Right", "Rotate", "Place", "Put back", "To tray"):
            expect(bar.get_by_role("button", name=name, exact=True)).to_be_visible()
        press("Seat")
        expect(pattern(page, "Seat")).to_have_attribute("data-chosen", "true")
        press("Lift")
        seat = pattern(page, "Seat")
        expect(seat).to_have_attribute("data-state", "lifted")
        said(page, "Seat lifted. Arrow keys move it, Enter places it, Escape puts it back.")
        press("Left")
        expect(seat).to_have_attribute("data-x", "-1")
        press("Place")
        said(page, "Seat cannot go there. It runs off the hide.")
        expect(seat).to_have_attribute("data-state", "lifted")
        press("Right")
        press("Rotate")
        expect(seat).to_have_attribute("data-rotation", "180")
        press("Rotate")
        press("Down")
        press("Place")
        said(page, "Seat placed at 0, 1 cm.")
        hide_figure(page, "Used 3.87 sq ft of 51.67 sq ft (7.5%)")
        press("Back")
        press("Lift")
        press("Put back")
        said(page, "Back put back.")
        expect(pattern(page, "Back")).to_have_attribute("data-state", "tray")
        press("Seat")
        press("Lift")
        press("To tray")
        said(page, "Seat back in the tray.")
        expect(seat).to_have_attribute("data-state", "tray")
        assert seat.get_attribute("data-x") is None
    assert all(p["state"] == "tray" for p in desk.layout(piece["id"])["pieces"])


def test_placement_decisions(app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    pid = piece["id"]
    grain = "Seat runs with the grain and turns only 0 or 180."
    assert_error(desk.place(pid, "Seat", 190, 0, 90), 422, grain)
    assert_error(desk.place(pid, "Back", 0, 0, 270), 422, "Back runs with the grain and turns only 0 or 180.")
    for rotation in (-90, 45):
        assert_error(desk.place(pid, "Seat", 0, 0, rotation), 422, "That number is out of range.")
    for bad in ("12", "abc", None):
        assert_error(desk.place(pid, "Seat", bad, 0), 422, "That is not a number. Write it like 12.50.")
    version = desk.layout(pid)["version"]
    absent = desk.call("PUT", f"/api/pieces/{pid}/layout/placements/Seat", json={"y": 0, "rotation": 0, "version": version})
    assert_error(absent, 422, "That is not a number. Write it like 12.50.")
    assert_error(desk.place(pid, "Seat", 1.5, 0), 422, "That number is out of range.")
    assert_error(desk.place(pid, "Seat", -1, 0), 422, "Seat cannot go there. It runs off the hide.")
    assert_error(desk.place(pid, "Seat", 140, 70), 422, "Seat cannot go there. It runs off the hide.")
    assert_error(desk.place(pid, "Seat", 60, 30), 422, "Seat cannot go there. It crosses the flaw at 120, 80 cm.")
    assert_error(desk.place(pid, "Headrest", 10, 195), 422, "Headrest cannot go there. It crosses the flaw at 20, 200 cm.")
    assert desk.place(pid, "Seat", 58, 30).status_code == 200, "touching the flaw along an edge is allowed"
    assert_error(desk.place(pid, "Back", 60, 60), 422, "Back cannot go there. It crosses the flaw at 120, 80 cm.")
    assert_error(desk.place(pid, "Back", 50, 60), 422, "Back cannot go there. It overlaps Seat.")
    assert desk.place(pid, "Back", 0, 88).status_code == 200, "touching another piece along an edge is allowed"
    assert desk.place(pid, "Headrest", 178, 200, 90).status_code == 200, "at 90 its box is 22 x 40, reaching the hide's corner"
    assert_error(desk.place(pid, "Headrest", 179, 200, 90), 422, "Headrest cannot go there. It runs off the hide.")
    fresh = desk.add_piece(client["id"])["id"]
    used = 0
    spots = {"Seat": (0, 0), "Back": (62, 0), "Left side": (124, 0), "Right side": (154, 0), "Headrest": (0, 58)}
    for name, (x, y) in spots.items():
        before = desk.layout(fresh)["version"]
        answer = desk.place(fresh, name, x, y, version=before)
        assert answer.status_code == 200, answer.text
        width, height = PIECE_SIZES[name]
        used += width * height
        body = answer.json()["layout"]
        expected = figure_text(used)
        assert f"Used {body['usedSqFt']} sq ft of 51.67 sq ft ({body['usedPercent']}%)" == expected, f"{body['usedSqFt']}, {body['usedPercent']}; expected {expected}"
        assert body["version"] > before, "every change raises the version"
        walk_instants(body)
    assert (body["usedSqFt"], body["usedPercent"]) == ("14.54", "28.1")
    assert body["hide"] == {"widthCm": HIDE_WIDTH_CM, "heightCm": HIDE_HEIGHT_CM, "areaSqFt": "51.67"}
    assert body["flaws"] == [{"x": 120, "y": 80, "width": 30, "height": 20}, {"x": 20, "y": 200, "width": 16, "height": 12}]
    gone = desk.call("DELETE", f"/api/pieces/{fresh}/layout/placements/{quote('Left side')}", params={"version": body["version"]})
    assert gone.status_code == 200
    assert next(p for p in gone.json()["layout"]["pieces"] if p["name"] == "Left side")["state"] == "tray"
    whole = desk.call("POST", f"/api/pieces/{fresh}/layout", json={"version": gone.json()["layout"]["version"], "placements": [{"name": "Seat", "x": 0, "y": 0, "rotation": 180}]})
    assert whole.status_code == 200 and [p["name"] for p in whole.json()["layout"]["pieces"] if p["state"] == "placed"] == ["Seat"], "POST replaces the whole layout"
    assert_error(desk.call("POST", f"/api/pieces/{fresh}/layout", json={"version": whole.json()["layout"]["version"], "placements": [{"name": "Seat", "x": 60, "y": 30, "rotation": 0}]}), 422, "Seat cannot go there. It crosses the flaw at 120, 80 cm.")


def test_hide_keyboard_composite(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    desk.place(piece["id"], "Seat", 0, 0)
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk) as page:
        h1(page, f"Hide for {piece['title']}")
        hide = page.locator('[data-part="hide"]')
        wait_ui(page, lambda: pattern(page, "Seat").count() == 1, "pieces show")
        expect(hide).to_have_accessible_name("Hide")
        tab_into(page, hide)
        page.keyboard.press("Tab")
        assert not hide.evaluate("h => h === document.activeElement || h.contains(document.activeElement)"), "one Tab press leaves the composite"
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk, size=PHONE) as page:
        h1(page, f"Hide for {piece['title']}")
        seat = pattern(page, "Seat")
        wait_ui(page, lambda: seat.count() == 1, "pieces show at 375")
        seat.scroll_into_view_if_needed()
        box = seat.bounding_box()
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        advance(page, 100)
        expect(seat).to_have_attribute("data-state", "placed")


def test_hide_motion(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk) as page:
        h1(page, f"Hide for {piece['title']}")
        hide = page.locator('[data-part="hide"]')
        seat = pattern(page, "Seat")
        wait_ui(page, lambda: seat.count() == 1, "pieces show")
        seat.evaluate("e => { e.__kept = 1; }")
        tab_into(page, hide)
        clear_motions(page)
        page.keyboard.press("Enter")
        expect(seat).to_have_attribute("data-state", "lifted")
        assert seat.evaluate("e => e.__kept === 1"), "the piece moves as one element, never redrawn or replaced"
        def seat_ran(duration: int) -> bool:
            return any(r["duration"] == duration for r in motions(page) if r["piece"] == "Seat")
        wait_ui(page, lambda: seat_ran(STEP_MS) or seat_ran(GLIDE_MS), "the lift runs 160 ms and the tray move 320 ms")
        assert_motion_system(motions(page))
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        clear_motions(page)
        page.keyboard.press("Shift+ArrowRight")
        expect(seat).to_have_attribute("data-x", "10")
        wait_ui(page, lambda: seat_ran(STEP_MS), "a step glides over 160 ms")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        per_cm = hide.bounding_box()["width"] / HIDE_WIDTH_CM
        carries_on(page, seat, lambda: page.keyboard.press("Shift+ArrowRight"), lambda: page.keyboard.press("Shift+ArrowRight"), per_cm + 2)
        expect(seat).to_have_attribute("data-x", "30")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        clear_motions(page)
        page.keyboard.press("r")
        wait_ui(page, lambda: seat_ran(GLIDE_MS), "a rotation takes 320 ms")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        page.keyboard.press("r")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        clear_motions(page)
        page.keyboard.press("Enter")
        hide_figure(page, "Used 3.87 sq ft of 51.67 sq ft (7.5%)")
        def figure_rolled() -> bool:
            records = motions(page)
            return any(r["duration"] == GLIDE_MS for r in records) or [r["duration"] for r in records if r["part"] == "hide-figure"].count(STEP_MS) >= 2
        wait_ui(page, figure_rolled, "the figure rolls over 320 ms")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        page.keyboard.press("Enter")
        expect(seat).to_have_attribute("data-state", "lifted")
        page.keyboard.press("Shift+ArrowRight")
        expect(seat).to_have_attribute("data-x", "40")
        page.evaluate("() => document.getAnimations().forEach((a) => a.finish())")
        clear_motions(page)
        page.keyboard.press("Escape")
        expect(seat).to_have_attribute("data-state", "placed")
        expect(seat).to_have_attribute("data-x", "30")
        wait_ui(page, lambda: seat_ran(GLIDE_MS), "a put back glides home over 320 ms")
        others = [r for r in motions(page) if r["piece"] not in (None, "Seat")]
        assert others == [], f"the rest of the hide stays still: {others}"
        clear_motions(page)
        advance(page, REFRESH_MS)
        assert [r for r in motions(page) if r["part"] in ("pattern-piece", "hide-figure")] == [], "a refresh with no new data starts no motion"
        assert seat.evaluate("e => e.__kept === 1"), "a refresh replaces no element"
        clear_motions(page)
        assert desk.place(piece["id"], "Back", 100, 120).status_code == 200, "another window places Back"
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: pattern(page, "Back").get_attribute("data-state") == "placed", "another window's change arrives")
        wait_ui(page, lambda: any(r["piece"] == "Back" and r["duration"] in (STEP_MS, GLIDE_MS) for r in motions(page)), "another window's change moves that piece with its glide")
        moved = {r["piece"] for r in motions(page) if r["part"] == "pattern-piece"}
        assert moved <= {"Back"}, f"only that one piece moves: {moved}"
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk, reduced_motion="reduce") as page:
        h1(page, f"Hide for {piece['title']}")
        wait_ui(page, lambda: pattern(page, "Headrest").count() == 1, "pieces show")
        tab_into(page, page.locator('[data-part="hide"]'))
        page.keyboard.press("ArrowLeft")
        expect(pattern(page, "Headrest")).to_have_attribute("data-chosen", "true")
        clear_motions(page)
        page.keyboard.press("Enter")
        expect(pattern(page, "Headrest")).to_have_attribute("data-state", "lifted")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("r")
        expect(pattern(page, "Headrest")).to_have_attribute("data-rotation", "90")
        page.keyboard.press("Escape")
        said(page, "Headrest put back.")
        expect(pattern(page, "Headrest")).to_have_attribute("data-state", "tray")
        assert_no_motion(motions(page))


def test_stale_layout_saves(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    stale = desk.layout(piece["id"])["version"]
    assert desk.place(piece["id"], "Seat", 0, 0, version=stale).status_code == 200
    copy = re.compile(r"This layout was changed at \d\d:\d\d Turin time in another window\. Your piece is still lifted\.")
    assert_error(desk.place(piece["id"], "Back", 100, 100, version=stale), 412, copy)
    assert next(p for p in desk.layout(piece["id"])["pieces"] if p["name"] == "Back")["state"] == "tray", "a stale save changes nothing"
    assert_error(desk.call("DELETE", f"/api/pieces/{piece['id']}/layout/placements/Seat", params={"version": stale}), 412, copy)
    with screen(browser, app_url, f"/pieces/{piece['id']}/hide", desk) as page:
        h1(page, f"Hide for {piece['title']}")
        back = pattern(page, "Back")
        wait_ui(page, lambda: back.count() == 1, "pieces show")
        tab_into(page, page.locator('[data-part="hide"]'))
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(back).to_have_attribute("data-state", "lifted")
        for _ in range(7):
            page.keyboard.press("Shift+ArrowRight")
        back.evaluate("e => { e.__kept = 1; }")
        assert desk.place(piece["id"], "Headrest", 150, 200).status_code == 200
        advance(page, REFRESH_MS)
        wait_ui(page, lambda: pattern(page, "Headrest").get_attribute("data-state") == "placed", "the other window's change arrives")
        expect(back).to_have_attribute("data-state", "lifted")
        expect(back).to_have_attribute("data-x", "70")
        assert back.evaluate("e => e.__kept === 1"), "the lifted piece is the same element"
        with hold_reads(page):
            assert desk.place(piece["id"], "Left side", 170, 100).status_code == 200
            with page.expect_response(writes_layout):
                page.keyboard.press("Enter")
        said(page, copy)
        expect(back).to_have_attribute("data-state", "lifted")
        advance(page, REFRESH_MS)
        page.keyboard.press("Enter")
        said(page, "Back placed at 70, 0 cm.")
    assert next(p for p in desk.layout(piece["id"])["pieces"] if p["name"] == "Back")["x"] == 70


def minor(printed: str) -> int:
    return int(re.sub(r"\D", "", printed))


def split_milestones(total: int) -> list[int]:
    parts = [total * share // 100 for share in (30, 40, 30)]
    for i in range(total - sum(parts)):
        parts[i] += 1
    return parts


def test_screen_rules_estimate(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    desk.add_estimate(piece["id"])
    assert_contract(app_url, f"/api/pieces/{piece['id']}/estimates", instants_of=lambda: desk.j("GET", f"/api/pieces/{piece['id']}/estimates"))
    check_screen_rules(browser, app_url, f"/pieces/{piece['id']}/estimate", desk, f"Estimate for {piece['title']}", "Edit estimate", "Edit estimate", first=lambda d: d.get_by_role("combobox", name=named("Material")), draft=lambda d: d.get_by_role("textbox", name=named("Labour hours")))
    sweep_routes(browser, app_url, "estimate", "rates")


def fill_estimate(page: Page, dialog: Locator) -> None:
    select(dialog.get_by_role("combobox", name=named("Material")), "Tabacco VM-2041")
    lot = dialog.get_by_role("combobox", name=named("Lot"))
    wait_ui(page, lambda: lot.count() > 0, "Lot shows for a material")
    select(lot, "L-2041-A, 2 hides at 48.25 sq ft")
    area = dialog.get_by_role("textbox", name=named("Pattern area in sq ft"))
    wait_ui(page, lambda: area.count() > 0, "the area field shows for a sq ft material")
    area.fill("14.54")


def test_wf_estimates_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/estimate", desk) as page:
        h1(page, f"Estimate for {piece['title']}")
        listen(page)
        opener = page.get_by_role("button", name="Edit estimate", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Edit estimate", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        fill_estimate(page, dialog)
        hours = dialog.get_by_role("textbox", name=named("Labour hours"))
        hours.fill("12.30")
        dialog.get_by_role("button", name="Save estimate", exact=True).focus()
        page.keyboard.press("Enter")
        check_problems(page, dialog, hours, "Labour goes in quarter hours.")
        hours.fill("12,50")
        dialog.get_by_role("button", name="Save estimate", exact=True).focus()
        page.keyboard.press("Enter")
        check_problems(page, dialog, hours, "That is not a number. Write it like 12.50.")
        hours.fill("12.50")
        total = page.locator('[data-part="estimate-total"]')
        wait_ui(page, lambda: "€2,102.71" in total.inner_text(), "the mint total changes in place on input")
        advance(page, 2000)
        said(page, "Total now €2,102.71.")
        assert spoken_list(page).count("Total now €2,102.71.") == 1, f"each settled change is announced once: {spoken_list(page)}"
        press_held(page, dialog, "Save estimate", f"**/api/pieces/{piece['id']}/estimates")
        said(page, "Estimate saved.")
        wait_ui(page, lambda: dialog.count() == 0, "the dialog closes")
        expect(opener).to_be_focused()
    saved = desk.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"]
    assert len(saved) == 1 and saved[0]["totalMinor"] == 210271 and saved[0]["display"]["total"] == "€2,102.71" and saved[0]["state"] == "open"


def test_wf_estimates_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/estimate", desk, size=PHONE) as page:
        h1(page, f"Estimate for {piece['title']}")
        layout(page)
        tap(page.get_by_role("toolbar", name="Main action", exact=True).get_by_role("button", name="Edit estimate", exact=True))
        dialog = page.get_by_role("dialog", name="Edit estimate", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the sheet opens")
        fill_estimate(page, dialog)
        select(dialog.get_by_role("combobox", name=named("Material")), "None (frame only)")
        wait_ui(page, lambda: dialog.get_by_role("combobox", name=named("Lot")).count() == 0, "None (frame only) removes Lot")
        dialog.get_by_role("textbox", name=named("Labour hours")).fill("2.75")
        press_held(page, dialog, "Save estimate", f"**/api/pieces/{piece['id']}/estimates", touch=True)
        said(page, "Estimate saved.")
    saved = desk.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"][0]
    assert saved["materialCode"] is None and saved["display"]["tax"] == "€51.43"


def test_wf_estimates_stale(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    desk.add_estimate(piece["id"])
    with screen(browser, app_url, f"/pieces/{piece['id']}/estimate", desk) as page:
        h1(page, f"Estimate for {piece['title']}")
        total = page.locator('[data-part="estimate-total"]')
        wait_ui(page, lambda: "€2,102.71" in total.inner_text(), "the saved total shows")
        page.get_by_role("button", name="Edit estimate", exact=True).click()
        dialog = page.get_by_role("dialog", name="Edit estimate", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        hours = dialog.get_by_role("textbox", name=named("Labour hours"))
        hours.fill("2.75")
        with hold_reads(page):
            other = desk.add_estimate(piece["id"], hours="1.00")
            with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path.endswith("/estimates")):
                dialog.get_by_role("button", name="Save estimate", exact=True).click()
        said(page, re.compile(r"This estimate was changed at \d\d:\d\d Turin time in another window\. Your figures are still here\."))
        expect(dialog).to_be_visible()
        expect(hours).to_have_value("2.75")
        assert dialog.get_by_role("region", name="Problems", exact=True).evaluate("r => r.contains(document.activeElement)"), "focus on the message in the dialog's own summary"
    assert desk.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"][0]["id"] == other["id"], "nothing replaced the newer estimate"


AMOUNT_CASES = {
    "eur": ("Turin", "VM-2041", "L-2041-A", "14.54", "12.50", "€661.03", "€1,062.50", "€379.18", "€2,102.71", 22),
    "gbp": ("London", "VM-2044", "L-2044-A", "14.54", "10.00", "£160.33", "£720.00", "£176.07", "£1,056.40", 20),
    "usd": ("New York", "VM-2047", "L-2000-A", "14.54", "8.00", "US$586.24", "US$736.00", "US$0.00", "US$1,322.24", 0),
    "jpy": ("Kyoto", "VM-2041", "L-2041-B", "14.54", "6.00", "¥104,973", "¥82,800", "¥0", "¥187,773", 0),
    "aed": ("Dubai", "VM-2043", "L-2000-A", "14.54", "5.00", "AED 3,227.93", "AED 1,700.00", "AED 0.00", "AED 4,927.93", 0),
}


@pytest.mark.parametrize("case", list(AMOUNT_CASES.values()), ids=list(AMOUNT_CASES))
def test_exact_amounts(app_url: str, wiremock: Any, case: tuple[Any, ...]) -> None:
    town, code, lot, area, hours, material, labour, tax, total, percent = case
    desk = new_desk(app_url)
    client = desk.add_client(town)
    piece = desk.add_piece(client["id"])
    estimate = desk.add_estimate(piece["id"], code, lot, area, hours)
    shown = estimate["display"]
    assert (shown["material"], shown["labour"], shown["tax"], shown["total"]) == (material, labour, tax, total)
    assert (estimate["materialMinor"], estimate["labourMinor"], estimate["taxMinor"], estimate["totalMinor"]) == (minor(material), minor(labour), minor(tax), minor(total))
    assert estimate["subtotalMinor"] == minor(material) + minor(labour) and estimate["taxPercent"] == percent
    amounts = [m["amountMinor"] for m in estimate["milestones"]]
    assert amounts == split_milestones(minor(total)) and sum(amounts) == minor(total)
    assert [m["percent"] for m in estimate["milestones"]] == [30, 40, 30]
    walk_instants(estimate)
    preview = desk.j("POST", f"/api/pieces/{piece['id']}/estimates/preview", json={"materialCode": code, "lot": lot, "patternAreaSqFt": area, "labourHours": hours})["estimate"]
    assert "id" not in preview and preview["totalMinor"] == minor(total)
    assert len(desk.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"]) == 1, "a preview keeps nothing"


def test_hides_metres_milestones(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    path = f"/api/pieces/{piece['id']}/estimates/preview"
    assert desk.j("POST", path, json={"materialCode": "VM-2041", "lot": "L-2041-A", "patternAreaSqFt": "62.50", "labourHours": "1.00"})["estimate"]["hides"] == 2
    assert_error(desk.call("POST", path, json={"materialCode": "VM-2041", "lot": "L-2041-A", "patternAreaSqFt": "125.00", "labourHours": "1.00"}), 409, "No single dye lot holds 3 hides of Tabacco. The largest holds 2.")
    assert_error(desk.call("POST", path, json={"materialCode": "VM-2041", "lot": "L-2041-B", "patternAreaSqFt": "62.50", "labourHours": "1.00"}), 409, "Lot L-2041-B holds 1 hide.")
    salvia = desk.j("POST", path, json={"materialCode": "VM-2044", "lot": "L-2044-A", "patternAreaSqFt": "14.54", "labourHours": "1.00"})["estimate"]
    assert salvia["display"]["material"] == "€184.53", "30.25 sq ft at €6.10 is exactly 184.525"
    for typed, metres in (("7.30", "7.50"), ("7.50", "7.50"), ("7.51", "7.75")):
        fabric = desk.j("POST", path, json={"materialCode": "VM-3051", "lot": "L-3000-A", "metres": typed, "labourHours": "4.00"})["estimate"]
        assert fabric["materialMinor"] == int(Decimal(metres) * 6400), f"{typed} m is charged as {metres} m"
    assert_error(desk.call("POST", path, json={"materialCode": "VM-3051", "lot": "L-3000-A", "metres": "50.00", "labourHours": "4.00"}), 409, "No single dye lot holds 50.00 m of Loden. The largest holds 40.00 m.")
    frame = desk.j("POST", path, json={"materialCode": None, "lot": None, "labourHours": "2.75"})["estimate"]
    assert (frame["display"]["labour"], frame["display"]["tax"]) == ("€233.75", "€51.43")
    amounts = [m["amountMinor"] for m in frame["milestones"]]
    assert amounts == split_milestones(frame["totalMinor"]) and sum(amounts) == frame["totalMinor"]
    for bad, copy in (("12.30", "Labour goes in quarter hours."), ("12,50", "That is not a number. Write it like 12.50."), ("abc", "That is not a number. Write it like 12.50."), ("-5", "That is not a number. Write it like 12.50.")):
        assert_error(desk.call("POST", path, json={"materialCode": None, "lot": None, "labourHours": bad}), 422, copy)


def test_labour_rates_by_date(browser: Browser, app_url: str) -> None:
    desk, other = new_desk(app_url), new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    old = desk.add_estimate(piece["id"], None, None, hours="2.75")
    assert old["labourRateMinor"] == 8500
    today = turin_today()
    rate = {"eur": "90.00", "gbp": "76.00", "usd": "97.00", "jpy": "14600", "aed": "360.00"}
    assert_error(desk.call("POST", "/api/rates", json={"takesEffectOn": (today - timedelta(days=1)).isoformat(), **rate}), 422, "Rates take effect today or later.")
    tomorrow = {"eur": "95.00", "gbp": "80.00", "usd": "99.00", "jpy": "15000", "aed": "370.00"}
    desk.j("POST", "/api/rates", 201, json={"takesEffectOn": (today + timedelta(days=1)).isoformat(), **tomorrow})
    with screen(browser, app_url, "/rates", desk) as page:
        h1(page, "Labour rates")
        page.get_by_role("button", name="New rate", exact=True).click()
        dialog = page.get_by_role("dialog", name="New rate", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        dialog.get_by_role("textbox", name=named("Takes effect on")).fill(today.isoformat())
        for currency, value in rate.items():
            dialog.get_by_role("textbox", name=named(currency.upper())).fill(value)
        dialog.get_by_role("button", name="Save rate", exact=True).click()
        said(page, f"Rate saved. It applies to new estimates from {date_copy(today)}.")
    assert_error(desk.call("POST", "/api/rates", json={"takesEffectOn": today.isoformat(), **rate}), 409, "A rate already takes effect on that day.")
    assert [r["eur"] for r in other.j("GET", "/api/rates")["rates"]] == ["85.00"], "rates belong to a desk"
    second = desk.add_piece(client["id"])
    new = desk.add_estimate(second["id"], None, None, hours="2.00")
    printed_rate = f"€{rate['eur']}"
    recomputed = f"€{Decimal('2.75') * Decimal(rate['eur']):.2f}"
    assert new["labourRateMinor"] == minor(printed_rate) and new["display"]["labourRate"] == printed_rate, "today's rate applies, tomorrow's not yet"
    kept = desk.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"][0]
    assert kept["labourRateMinor"] == 8500 and kept["display"]["labour"] == "€233.75", "an earlier estimate keeps its rate"
    with screen(browser, app_url, f"/pieces/{piece['id']}/estimate", desk) as page:
        h1(page, f"Estimate for {piece['title']}")
        wait_ui(page, lambda: "€233.75" in page.locator("body").inner_text() and recomputed not in page.locator("body").inner_text(), "the screen shows the stored rate's labour")


def test_estimate_requests(app_url: str, wiremock: Any) -> None:
    desk, stranger = new_desk(app_url), new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    foreign_client = stranger.add_client()
    foreign = stranger.add_piece(foreign_client["id"])
    plain = desk.add_estimate(piece["id"])
    forged = desk.j("POST", f"/api/pieces/{piece['id']}/estimates", 201, json={"materialCode": "VM-2041", "lot": "L-2041-A", "patternAreaSqFt": "14.54", "labourHours": "12.50", "deskId": stranger.id, "pieceId": foreign["id"], "totalMinor": 1, "materialMinor": 1, "labourRateMinor": 1, "state": "signedOff", "price": "0.01", "currency": "JPY"})["estimate"]
    assert (forged["totalMinor"], forged["labourRateMinor"], forged["state"], forged["currency"]) == (210271, 8500, "open", "EUR")
    assert stranger.j("GET", f"/api/pieces/{foreign['id']}/estimates")["estimates"] == [], "another desk's piece gains nothing"
    states = {e["id"]: e["state"] for e in desk.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"]}
    assert states[plain["id"]] == "replaced" and states[forged["id"]] == "open"
    assert_error(desk.call("POST", f"/api/pieces/{piece['id']}/estimates", json={"materialCode": None, "lot": None, "labourHours": "1.00", "openVersion": plain["version"]}), 412, re.compile(r"This estimate was changed at \d\d:\d\d Turin time in another window\. Your figures are still here\."))
    setup = signed_off_piece(desk, photos=False)
    desk.j("POST", f"/api/pieces/{setup.piece['id']}/estimates", 201, json={"materialCode": None, "lot": None, "labourHours": "1.00"})
    rows = {e["id"]: e for e in desk.j("GET", f"/api/pieces/{setup.piece['id']}/estimates")["estimates"]}
    assert rows[setup.estimate["id"]]["state"] == "signedOff" and rows[setup.estimate["id"]]["totalMinor"] == setup.estimate["totalMinor"], "a signed-off estimate never changes"


COPY = {
    "en": {"C01": "Your piece", "C02": "Steps", "C04": "The cover", "C05": "The estimate", "C06": "Your answer", "C07": "What seat height would you like, in cm?", "C08": "Seat height in cm", "C09": "Send my answer", "C10": "Your full name", "C11": "Approve this cover", "C12": "Close", "C13": "Write the height like 44.5.", "C14": "That is not the name we hold. Type your full name.", "C15": "Your answer is with the conservator.", "C19": "Please answer by {d}.", "C20": "This page has ended.", "C23": "This field is required.", "C24": "Announcements", "C25": "Refresh state", "C33": "Dye lot", "C38": "Total", "C42": "Condition notes", "C43": "Tear", "C48": "Main action", "M1": "Your estimate for {t}", "M2": "Reminder: your estimate for {t}", "M3": "Dear {n},", "M4": "Read it and answer here: {a}", "K1": "Care card", "K2": "Keep the piece out of direct sun and away from radiators."},
    "it": {"C01": "Il tuo pezzo", "C02": "Passaggi", "C04": "Il rivestimento", "C05": "Il preventivo", "C06": "La tua risposta", "C07": "Quale altezza della seduta desideri, in cm?", "C08": "Altezza della seduta in cm", "C09": "Invia la risposta", "C10": "Il tuo nome completo", "C11": "Approva questo rivestimento", "C12": "Chiudi", "C13": "Scrivi l'altezza così: 44,5.", "C14": "Non è il nome che abbiamo. Scrivi il tuo nome completo.", "C15": "La tua risposta è arrivata al restauratore.", "C19": "Rispondi entro il {d}.", "C20": "Questa pagina è scaduta.", "C23": "Questo campo è obbligatorio.", "C24": "Annunci", "C25": "Stato di aggiornamento", "C33": "Partita di tintura", "C38": "Totale", "C42": "Note sullo stato", "C43": "Strappo", "C48": "Azione principale", "M1": "Il preventivo per {t}", "M2": "Promemoria: il preventivo per {t}", "M3": "Gentile {n},", "M4": "Leggilo e rispondi qui: {a}", "K1": "Scheda di cura", "K2": "Tieni il pezzo lontano dal sole diretto e dai termosifoni."},
    "ja": {"C01": "お預かりの品", "C02": "手順", "C04": "張地", "C05": "見積もり", "C06": "あなたの回答", "C07": "ご希望の座面の高さ（cm）を教えてください。", "C08": "座面の高さ（cm）", "C09": "回答を送信する", "C10": "お名前（フルネーム）", "C11": "この張地を承認する", "C12": "閉じる", "C13": "高さは 44.5 のように入力してください。", "C14": "お預かりしているお名前と一致しません。フルネームを入力してください。", "C15": "回答を修復担当者に届けました。", "C19": "{d} までにご回答ください。", "C20": "このページは終了しました。", "C23": "この項目は必須です。", "C24": "お知らせ", "C25": "更新の状態", "C33": "染色ロット", "C38": "合計", "C42": "状態の記録", "C43": "裂け", "C48": "主な操作", "M1": "{t} のお見積もり", "M2": "リマインダー: {t} のお見積もり", "M3": "{n} 様", "M4": "こちらからご確認のうえご回答ください: {a}", "K1": "お手入れカード", "K2": "直射日光と暖房器具を避けてください。"},
    "ar": {"C01": "قطعتك", "C02": "الخطوات", "C04": "الغطاء", "C05": "التقدير", "C06": "إجابتك", "C07": "ما ارتفاع المقعد الذي تفضله بالسنتيمتر؟", "C08": "ارتفاع المقعد بالسنتيمتر", "C09": "إرسال إجابتي", "C10": "اسمك الكامل", "C11": "الموافقة على هذا الغطاء", "C12": "إغلاق", "C13": "اكتب الارتفاع هكذا: ٤٤٫٥.", "C14": "هذا ليس الاسم المسجل لدينا. اكتب اسمك الكامل.", "C15": "وصلت إجابتك إلى المرمِّم.", "C19": "يرجى الإجابة قبل نهاية يوم {d}.", "C20": "انتهت هذه الصفحة.", "C23": "هذا الحقل مطلوب.", "C24": "الإعلانات", "C25": "حالة التحديث", "C33": "دفعة الصبغ", "C38": "الإجمالي", "C42": "ملاحظات الحالة", "C43": "تمزق", "C48": "الإجراء الرئيسي", "M1": "تقدير {t}", "M2": "تذكير: تقدير {t}", "M3": "مرحبًا {n}،", "M4": "اقرأه وأجب من هنا: {a}", "K1": "بطاقة العناية", "K2": "أبعد القطعة عن أشعة الشمس المباشرة والمدافئ."},
}
LANG_TOWN = {"en": ("Turin", "en"), "it": ("Turin", None), "ja": ("Kyoto", None), "ar": ("Dubai", None)}
IT_DAYS = "lun mar mer gio ven sab dom".split()
IT_MONTHS = "gen feb mar apr mag giu lug ago set ott nov dic".split()
JA_DAYS = "月火水木金土日"
AR_DAYS = "الاثنين الثلاثاء الأربعاء الخميس الجمعة السبت الأحد".split()
AR_MONTHS = "يناير فبراير مارس أبريل مايو يونيو يوليو أغسطس سبتمبر أكتوبر نوفمبر ديسمبر".split()


def client_date(language: str, d: date) -> str:
    if language == "it":
        return f"{IT_DAYS[d.weekday()]} {d.day} {IT_MONTHS[d.month - 1]} {d.year}"
    if language == "ja":
        return f"{d.year}年{d.month}月{d.day}日({JA_DAYS[d.weekday()]})"
    if language == "ar":
        return f"{AR_DAYS[d.weekday()]} {d.day} {AR_MONTHS[d.month - 1]} {d.year}"
    return date_copy(d)


def test_screen_rules_client_page(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = client_page_setup(desk, language="en", photos=True)
    assert_contract(app_url, f"/api/client-pages/{setup.token}/answer", instants_of=lambda: desk.j("GET", f"/api/pieces/{setup.piece['id']}/client-page"))
    field = lambda d: d.get_by_role("textbox", name=named("Seat height in cm"))
    for size, kw in ((PHONE, {"sheet": True}), (TABLET, {"side_sheet": True})):
        with screen(browser, app_url, f"/c/{setup.token}", size=size) as page:
            h1(page, "Your piece")
            opener = page.get_by_role("button", name="Your answer", exact=True)
            wait_ui(page, lambda: opener.count() > 0, "Your answer shows")
            check_dialog(page, opener, "Your answer", first=field, draft=field, **kw)
            assert_motion_system(motions(page))
    with screen(browser, app_url, f"/c/{setup.token}", size=PHONE, reduced_motion="reduce") as page:
        h1(page, "Your piece")
        opener = page.get_by_role("button", name="Your answer", exact=True)
        wait_ui(page, lambda: opener.count() > 0, "Your answer shows")
        opener.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name="Your answer", exact=True)
        wait_ui(page, lambda: sheet.count() > 0, "the sheet opens at once")
        page.keyboard.press("Escape")
        advance(page, 100)
        expect(sheet).to_have_count(0, timeout=1000)
        assert_no_motion(motions(page))
    sweep_routes(browser, app_url, "client-page")


def test_wf_client_page_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = client_page_setup(desk, town="London", name=FULL_NAME)
    with screen(browser, app_url, f"/pieces/{setup.piece['id']}", desk) as desk_page, screen(browser, app_url, f"/c/{setup.token}", size=PHONE) as page:
        h1(desk_page, setup.piece["title"])
        h1(page, "Your piece")
        layout(page)
        bar = page.get_by_role("toolbar", name="Main action", exact=True)
        wait_ui(page, lambda: bar.count() > 0, "the bar shows")
        tap(bar.get_by_role("button", name="Your answer", exact=True))
        sheet = page.get_by_role("dialog", name="Your answer", exact=True)
        wait_ui(page, lambda: sheet.count() > 0, "the sheet opens")
        landed(page)
        height = sheet.get_by_role("textbox", name=named("Seat height in cm"))
        expect(height).to_be_focused()
        height.fill("44,5")
        tap(sheet.get_by_role("button", name="Send my answer", exact=True))
        check_problems(page, sheet, height, "Write the height like 44.5.")
        height.fill("44.5")
        press_held(page, sheet, "Send my answer", f"**/api/client-pages/{setup.token}/answer", touch=True)
        said(page, "Your answer is with the conservator.")
        record = desk.j("GET", f"/api/pieces/{setup.piece['id']}/client-page")["clientPage"]["answer"]
        assert record["seatHeightCm"] == "44.5" and record["typed"] == "44.5"
        at = wall(parse_instant(record["answeredAt"]))
        advance(desk_page, REFRESH_MS)
        said(desk_page, f"{FULL_NAME} answered about {setup.piece['title']} at {at} Turin time.")
        latest = desk.j("GET", "/api/session")["session"]["latestAnswer"]
        assert latest and latest["message"] == f"{FULL_NAME} answered about {setup.piece['title']} at {at} Turin time."
        still_open(page, sheet, lambda: tap(bar.get_by_role("button", name="Your answer", exact=True)))
        landed(page)
        sheet.get_by_role("textbox", name=named("Your full name")).fill(FOLDED_NAME)
        tap(sheet.get_by_role("button", name="Approve this cover", exact=True))
        said(page, re.compile(r"Approved at \d\d:\d\d London time\."))
    sign = desk.j("GET", f"/api/pieces/{setup.piece['id']}/client-page")["clientPage"]["signOff"]
    assert sign and sign["typedName"] == FOLDED_NAME
    assert desk.j("GET", f"/api/pieces/{setup.piece['id']}/estimates")["estimates"][0]["state"] == "signedOff"


def test_wf_client_page_keyboard_arabic(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = client_page_setup(desk, town="Dubai", code=None, lot=None, name="سارة المنصوري")
    ar = COPY["ar"]
    with screen(browser, app_url, f"/c/{setup.token}", size=TABLET) as page:
        h1(page, ar["C01"])
        expect(page).to_have_title(ar["C01"])
        opener = page.get_by_role("button", name=ar["C06"], exact=True)
        wait_ui(page, lambda: opener.count() > 0, "the answer button shows")
        opener.focus()
        page.keyboard.press("Enter")
        sheet = page.get_by_role("dialog", name=ar["C06"], exact=True)
        wait_ui(page, lambda: sheet.count() > 0, "the sheet opens")
        height = sheet.get_by_role("textbox", name=named(ar["C08"]))
        expect(height).to_be_focused()
        height.fill("٤٤٫٥")
        press_held(page, sheet, ar["C09"], f"**/api/client-pages/{setup.token}/answer", busy="جارٍ العمل…")
        said(page, ar["C15"])
        def press_opener() -> None:
            opener.focus()
            page.keyboard.press("Enter")
        still_open(page, sheet, press_opener)
        name_box = sheet.get_by_role("textbox", name=named(ar["C10"]))
        name_box.fill("اسم آخر")
        approve = sheet.get_by_role("button", name=ar["C11"], exact=True)
        def press_approve() -> None:
            approve.focus()
            page.keyboard.press("Enter")
        announced_twice(page, press_approve, ar["C14"])
        expect(name_box).to_have_attribute("aria-invalid", "true")
        page.keyboard.press("Escape")
        expect(opener).to_be_focused()
    answer = desk.j("GET", f"/api/pieces/{setup.piece['id']}/client-page")["clientPage"]["answer"]
    assert answer["typed"] == "٤٤٫٥" and answer["seatHeightCm"] == "44.5"


def test_client_page_carries_no_private_data(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    other_name = f"Other {word()}"
    desk.add_client(name=other_name)
    setup = client_page_setup(desk, language="en")
    body = http("GET", f"{app_url}/api/client-pages/{setup.token}")
    page_body = body.json()["page"]
    assert set(page_body) <= {"language", "dir", "clientName", "pieceTitle", "dueDate", "endsAt", "estimateId", "material", "estimate", "notes", "answer", "signOff"}, sorted(page_body)
    assert set(page_body["estimate"]) <= {"material", "labour", "subtotal", "tax", "total", "milestones"}
    assert page_body["estimate"]["total"] == "€2,102.71"
    assert "Check again before quoting" not in body.text and "€85.00" not in body.text and "12.50" not in body.text and other_name not in body.text
    assert [n["kind"] for n in page_body["notes"]] == ["tear"]
    served = http("GET", f"{app_url}/c/{setup.token}").text
    assert "Check again before quoting" not in served and "€85.00" not in served and other_name not in served


LANG_CASES = {"en": "en", "it": "it", "ja": "ja", "ar": "ar"}


@pytest.mark.parametrize("language", list(LANG_CASES.values()), ids=list(LANG_CASES))
def test_client_page_language(browser: Browser, app_url: str, wiremock: Any, language: str) -> None:
    copy = COPY[language]
    town, override = LANG_TOWN[language]
    desk = new_desk(app_url)
    setup = client_page_setup(desk, town=town, language=override, code=None, lot=None)
    first = http("GET", f"{app_url}/c/{setup.token}").text
    root = re.search(r"<html\b[^>]*>", first, re.I).group(0)
    assert re.search(rf"""\blang=["']?{language}\b""", root), root
    assert bool(re.search(r"""\bdir=["']?rtl\b""", root)) == (language == "ar"), root
    with screen(browser, app_url, f"/c/{setup.token}", size=PHONE) as page:
        h1(page, copy["C01"])
        expect(page).to_have_title(copy["C01"])
        expect(page.get_by_role("navigation", name=copy["C02"], exact=True)).to_be_visible()
        expect(page.get_by_role("status", name=copy["C24"], exact=True)).to_have_count(1)
        expect(page.get_by_role("status", name=copy["C25"], exact=True)).to_have_count(1)
        bar = page.get_by_role("toolbar", name=copy["C48"], exact=True)
        wait_ui(page, lambda: bar.count() > 0, "the bar shows")
        due = date.fromisoformat(setup.piece["dueDate"])
        for key in ("C04", "C05", "C42", "C43", "C38"):
            wait_ui(page, lambda: copy[key] in page.locator("body").inner_text(), f"{key} reads {copy[key]!r}")
        wait_ui(page, lambda: copy["C19"].format(d=client_date(language, due)) in page.locator("body").inner_text(), "C19 with the local date")
        if language != "en":
            for english in ("Your piece", "The estimate", "Condition notes", "Your answer"):
                assert english not in page.locator("body").inner_text(), f"{english} left in English"
        tap(bar.get_by_role("button", name=copy["C06"], exact=True))
        sheet = page.get_by_role("dialog", name=copy["C06"], exact=True)
        wait_ui(page, lambda: sheet.count() > 0, "the sheet opens")
        assert copy["C07"] in sheet.inner_text()
        expect(sheet.get_by_role("textbox", name=named(copy["C08"]))).to_be_visible()
        expect(sheet.get_by_role("textbox", name=named(copy["C10"]))).to_be_visible()
        for key in ("C09", "C11", "C12"):
            expect(sheet.get_by_role("button", name=copy[key], exact=True)).to_be_visible()
        axe(page)
    assert_error(http("POST", f"{app_url}/api/client-pages/{setup.token}/answer", json={"seatHeight": "abc"}), 422, copy["C13"])
    assert_error(http("POST", f"{app_url}/api/client-pages/{setup.token}/answer", json={"seatHeight": "  "}), 422, copy["C23"])
    assert_error(http("POST", f"{app_url}/api/client-pages/{setup.token}/sign-off", json={"estimateId": setup.estimate["id"], "typedName": "Nobody"}), 422, copy["C14"])
    assert desk.call("DELETE", f"/api/pieces/{setup.piece['id']}/client-page").status_code == 204
    ended = http("GET", f"{app_url}/c/{setup.token}")
    assert ended.status_code == 410 and copy["C20"] in html.unescape(ended.text) and re.search(rf"""\blang=["']?{language}\b""", ended.text), "the ended copy comes from the server"
    assert_error(http("GET", f"{app_url}/api/client-pages/{setup.token}"), 410, copy["C20"])


HEIGHT_CASES = {
    "en-point": ("en", "44.5", "44.5"), "en-comma": ("en", "44,5", None), "en-low": ("en", "29.9", None), "en-edge-low": ("en", "30", "30"), "en-edge-high": ("en", "60", "60"), "en-high": ("en", "60.1", None), "en-two-decimals": ("en", "44.55", None),
    "it-comma": ("it", "44,5", "44.5"), "it-point": ("it", "44.5", None), "ja-point": ("ja", "44.5", "44.5"), "ja-full-width": ("ja", "４４．５", "44.5"), "ar-indic": ("ar", "٤٤٫٥", "44.5"), "ar-latin": ("ar", "44.5", "44.5"),
}


@pytest.mark.parametrize("case", list(HEIGHT_CASES.values()), ids=list(HEIGHT_CASES))
def test_seat_height(app_url: str, case: tuple[str, str, str | None]) -> None:
    language, typed, expected = case
    desk = new_desk(app_url)
    town, override = LANG_TOWN[language]
    setup = client_page_setup(desk, town=town, language=override, code=None, lot=None)
    resp = http("POST", f"{app_url}/api/client-pages/{setup.token}/answer", json={"seatHeight": typed})
    stored = desk.j("GET", f"/api/pieces/{setup.piece['id']}/client-page")["clientPage"]["answer"]
    if expected is None:
        assert_error(resp, 422, COPY[language]["C13"])
        assert stored is None
    else:
        assert resp.status_code == 200, resp.text
        answer = resp.json()["answer"]
        assert Decimal(answer["seatHeightCm"]) == Decimal(expected) and answer["typed"] == typed
        walk_instants(answer)
        assert stored["typed"] == typed and Decimal(stored["seatHeightCm"]) == Decimal(expected)


def test_sign_off_by_typed_name(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = client_page_setup(desk, town="London", name=FULL_NAME)
    path = f"{app_url}/api/client-pages/{setup.token}/sign-off"
    body = {"estimateId": setup.estimate["id"]}
    assert_error(http("POST", path, json={**body, "typedName": "   "}), 422, "This field is required.")
    assert_error(http("POST", path, json={**body, "typedName": "zoe orste"}), 422, "That is not the name we hold. Type your full name.")
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(pool.map(lambda _: http("POST", path, json={**body, "typedName": f"  {FOLDED_NAME}  "}), range(2)))
    assert sorted(a.status_code for a in answers) == [200, 409], "two windows record one approval"
    won = next(a for a in answers if a.status_code == 200)
    at = parse_instant(won.json()["signOff"]["at"])
    lost = next(a for a in answers if a.status_code == 409)
    assert_error(lost, 409, f"Already approved at {wall(at, 'London')} London time.", code="alreadySignedOff")
    replaced = client_page_setup(desk, town="London", name="Łukasz Straße", code=None, lot=None)
    newer = desk.add_estimate(replaced.piece["id"], None, None, hours="1.00")
    error = assert_error(http("POST", f"{app_url}/api/client-pages/{replaced.token}/sign-off", json={"estimateId": replaced.estimate["id"], "typedName": "lukasz strasse"}), 409, code="estimateReplaced")
    assert re.fullmatch(r"A newer estimate was made at \d\d:\d\d Turin time\. Read it first\.", error["message"])
    assert http("POST", f"{app_url}/api/client-pages/{replaced.token}/sign-off", json={"estimateId": newer["id"], "typedName": "lukasz strasse"}).status_code == 200, "ß and ł fold"
    assert unicodedata.normalize("NFC", FULL_NAME) == FULL_NAME


def test_private_address_lifetime(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = client_page_setup(desk, code=None, lot=None, due_days=5)
    assert len(setup.token) >= TOKEN_MIN_CHARS and quote(setup.token, safe="-._~") == setup.token, f"at least 128 bits of random data: {setup.token}"
    unknowns = [http("GET", f"{app_url}/c/{word(32)}") for _ in range(2)]
    assert all(u.status_code == 404 for u in unknowns) and "Page not found" in unknowns[0].text
    assert re.sub(r"\s+", " ", unknowns[0].text) == re.sub(r"\s+", " ", unknowns[1].text), "one page whatever the token"
    assert_error(http("GET", f"{app_url}/api/client-pages/{word(32)}"), 404)
    due = date.fromisoformat(setup.piece["dueDate"])
    expected_end = datetime(due.year, due.month, due.day, 23, 59, 59, tzinfo=TURIN)
    assert parse_instant(setup.page["endsAt"]) == expected_end.astimezone(UTC), "the due date's last second in the client's wall time"
    far = client_page_setup(desk, town="Kyoto", code=None, lot=None, due_days=40)
    assert parse_instant(far.page["endsAt"]) == parse_instant(far.page["sentAt"]) + timedelta(seconds=PRIMARY_CLIENT_PAGE_SECONDS), "the earlier limit wins"
    renewed = desk.j("POST", f"/api/pieces/{setup.piece['id']}/client-page", 201, json={})["clientPage"]
    new_token = token_of(renewed["address"])
    assert new_token != setup.token
    assert http("GET", f"{app_url}/c/{setup.token}").status_code == 410, "a new address ends the old one"
    assert http("GET", f"{app_url}/c/{new_token}").status_code == 200
    assert_error(http("POST", f"{app_url}/api/client-pages/{setup.token}/answer", json={"seatHeight": "44,5"}), 410)
    assert desk.call("DELETE", f"/api/pieces/{setup.piece['id']}/client-page").status_code == 204
    assert http("GET", f"{app_url}/c/{new_token}").status_code == 410
    assert desk.j("GET", f"/api/pieces/{setup.piece['id']}/client-page")["clientPage"]["state"] == "ended"
    short = new_desk(copy_url("APP_SHORT_URL"))
    timed = client_page_setup(short, code=None, lot=None, due_days=30)
    ends = parse_instant(timed.page["endsAt"])
    assert ends == parse_instant(timed.page["sentAt"]) + timedelta(seconds=SHORT_CLIENT_PAGE_SECONDS)
    def ended() -> bool:
        asked = datetime.now(UTC)
        status = http("GET", f"{short.base}/c/{timed.token}").status_code
        if status == 200:
            assert asked < ends + timedelta(seconds=2), "the page answers past its instant"
            return False
        assert status == 410 and datetime.now(UTC) >= ends - timedelta(seconds=2), f"ended early with {status}"
        return True
    poll(ended, "the page ends at its instant, answering 410", SHORT_CLIENT_PAGE_SECONDS + API_DEADLINE)


def test_client_mail_and_reminder(app_url: str, mail: Any, wiremock: Any) -> None:
    short = new_desk(copy_url("APP_SHORT_URL"))
    other_name = f"Other {word()}"
    short.add_client(name=other_name)
    silent = client_page_setup(short, language="it", code=None, lot=None, name=f"Marta {word()}", due_days=30)
    answered = client_page_setup(short, language="it", code=None, lot=None, due_days=30)
    assert http("POST", f"{short.base}/api/client-pages/{answered.token}/answer", json={"seatHeight": "44,5"}).status_code == 200
    copy = COPY["it"]
    first = mails_to(mail, silent.client["email"])[0]
    assert first["Subject"] == copy["M1"].format(t=silent.piece["title"])
    body = mail_text(first)
    assert copy["M3"].format(n=silent.client["name"]) in body
    assert copy["M4"].format(a=silent.page["address"]) in body
    assert copy["C19"].format(d=client_date("it", date.fromisoformat(silent.piece["dueDate"]))) in body
    assert other_name not in body and "85.00" not in body and "€" not in body
    both = mails_to(mail, silent.client["email"], 2, SHORT_REMINDER_SECONDS + MAIL_DEADLINE)
    assert sorted(m["Subject"] for m in both) == sorted([copy["M1"].format(t=silent.piece["title"]), copy["M2"].format(t=silent.piece["title"])])
    assert len(mails_to(mail, answered.client["email"])) == 1, "no reminder after an answer"
    primary = new_desk(app_url)
    no_due_client = primary.add_client()
    no_due = primary.add_piece(no_due_client["id"], due_days=None)
    assert_error(primary.call("POST", f"/api/pieces/{no_due['id']}/client-page", json={}), 409, "Give this piece a due date first.")
    no_mail_title = f"Chair {word()}"
    assert save_file(primary, workbook(f"Owner {word()},{no_mail_title},,,{luhn_stamp()},,")).status_code == 200
    no_mail = next(p for p in primary.j("GET", "/api/pieces")["pieces"] if p["title"] == no_mail_title)
    primary.j("PATCH", f"/api/pieces/{no_mail['id']}", json={"dueDate": (turin_today() + timedelta(days=21)).isoformat()})
    assert_error(primary.call("POST", f"/api/pieces/{no_mail['id']}/client-page", json={}), 409, "This client has no email address yet.")
    assert mails_to(mail, no_due_client["email"], 0) == []


def weekday_iso(monday: date, offset: int) -> str:
    return (monday + timedelta(days=offset)).isoformat()


def bench_setup(desk: Desk, offset: int = 0, bench: str = "frame") -> SimpleNamespace:
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    monday = future_monday()
    job = desk.j("POST", "/api/bench-jobs", 201, json={"pieceId": piece["id"], "bench": bench, "day": weekday_iso(monday, offset)})["job"]
    return SimpleNamespace(client=client, piece=piece, monday=monday, job=job, title=piece["title"])


def job_day(desk: Desk, setup: SimpleNamespace) -> tuple[str, str]:
    jobs = desk.j("GET", "/api/bench-jobs", params={"week": setup.monday.isoformat()})["jobs"]
    row = next(j for j in jobs if j["id"] == setup.job["id"])
    return row["bench"], row["day"]


def shown_cards(page: Page, title: str = "") -> list[Locator]:
    return [card for card in page.locator('[data-part="job-card"]').filter(has_text=title).all() if card.is_visible()]


def test_screen_rules_bench(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    setup = bench_setup(desk)
    assert_contract(app_url, "/api/bench-jobs", instants_of=lambda: desk.j("GET", "/api/bench-jobs", params={"week": setup.monday.isoformat()}))
    name = f"Move {setup.title} to…"
    day = lambda d: d.get_by_role("textbox", name=named("Day"))
    check_screen_rules(browser, app_url, f"/bench?week={setup.monday.isoformat()}", desk, "Bench", name, name, first=day, draft=day)
    sweep_routes(browser, app_url, "bench")


def test_wf_bench_calendar_keyboard(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    setup = bench_setup(desk, 3)
    blocker = desk.add_piece(setup.client["id"])
    desk.j("POST", "/api/bench-jobs", 201, json={"pieceId": blocker["id"], "bench": "cover", "day": weekday_iso(setup.monday, 4)})
    friday = setup.monday + timedelta(days=4)
    with screen(browser, app_url, f"/bench?week={setup.monday.isoformat()}", desk) as page:
        h1(page, "Bench")
        grid = page.get_by_role("grid", name="Bench week", exact=True)
        wait_ui(page, lambda: len(shown_cards(page, setup.title)) == 1, "the card shows")
        card = shown_cards(page, setup.title)[0]
        assert card.get_attribute("data-job"), "a card carries data-job"
        tab_into(page, grid)
        page.keyboard.press("ArrowRight")
        assert grid.evaluate("g => g.contains(document.activeElement)"), "arrows stay in the grid"
        page.keyboard.press("Tab")
        for _ in range(4):
            if not grid.evaluate("g => g.contains(document.activeElement)"):
                break
            page.keyboard.press("Tab")
        assert not grid.evaluate("g => g.contains(document.activeElement)"), "Tab leaves the grid: one roving stop"
        card.evaluate("c => { const f = c.matches('[tabindex]') ? c : c.closest('[tabindex]') || c.querySelector('[tabindex]'); f.focus(); }")
        holds = lambda: page.evaluate("() => { const a = document.activeElement; return !!a && (!!a.closest('[data-part=\"job-card\"]') || !!a.querySelector('[data-part=\"job-card\"]')); }")
        page.keyboard.press("Alt+ArrowRight")
        said(page, f"{setup.title} moved to Frame bench on {date_copy(friday)}.")
        assert job_day(desk, setup) == ("frame", friday.isoformat())
        assert holds(), "focus stays on the card through the reply"
        advance(page, REFRESH_MS)
        assert holds(), "focus stays on the card through a refresh"
        page.keyboard.press("Alt+ArrowRight")
        said(page, "No more days this week. Use Move to….")
        assert job_day(desk, setup) == ("frame", friday.isoformat())
        announced_twice(page, lambda: page.keyboard.press("Alt+ArrowDown"), f"That bench is taken on {date_copy(friday)} by {blocker['title']}.")
        assert job_day(desk, setup) == ("frame", friday.isoformat())
        page.keyboard.press("Alt+ArrowLeft")
        said(page, f"{setup.title} moved to Frame bench on {date_copy(friday - timedelta(days=1))}.")
        page.keyboard.press("Alt+ArrowDown")
        said(page, f"{setup.title} moved to Cover bench on {date_copy(friday - timedelta(days=1))}.")
        assert job_day(desk, setup) == ("cover", (friday - timedelta(days=1)).isoformat())


def test_wf_bench_calendar_touch(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    setup = bench_setup(desk)
    for offset, bench in ((1, "frame"), (2, "cover"), (3, "cover")):
        extra = desk.add_piece(setup.client["id"])
        desk.j("POST", "/api/bench-jobs", 201, json={"pieceId": extra["id"], "bench": bench, "day": weekday_iso(setup.monday, offset)})
    columns = "() => new Set([...document.querySelectorAll('[data-part=\"job-card\"]')].filter((c) => c.getClientRects().length && getComputedStyle(c).visibility !== 'hidden').map((c) => Math.round(c.getBoundingClientRect().left))).size"
    path = f"/bench?week={setup.monday.isoformat()}"
    with screen(browser, app_url, path, desk, size=TABLET) as page:
        h1(page, "Bench")
        wait_ui(page, lambda: len(shown_cards(page)) == 4, "cards show at 768")
        assert page.evaluate(columns) == 2, "the agenda has two columns at 768x1024"
    with screen(browser, app_url, path, desk, size=PHONE) as page:
        h1(page, "Bench")
        wait_ui(page, lambda: len(shown_cards(page)) == 4, "cards show at 375")
        assert page.evaluate(columns) == 1, "the agenda has one column at 375"
        layout(page)
        name = f"Move {setup.title} to…"
        opener = page.get_by_role("button", name=name, exact=True)
        tap(opener)
        dialog = page.get_by_role("dialog", name=name, exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the sheet opens")
        landed(page)
        day = dialog.get_by_role("textbox", name=named("Day"))
        expect(day).to_be_focused()
        day.fill("next week")
        tap(dialog.get_by_role("button", name="Move", exact=True))
        check_problems(page, dialog, day, "That is not a date.")
        day.fill(weekday_iso(setup.monday, 5))
        tap(dialog.get_by_role("button", name="Move", exact=True))
        check_problems(page, dialog, day, "The bench works Monday to Friday.")
        target = setup.monday + timedelta(days=4)
        day.fill(target.isoformat())
        select(dialog.get_by_role("combobox", name=named("Bench")), "Cover bench")
        press_held(page, dialog, "Move", f"**/api/bench-jobs/{setup.job['id']}", method="PATCH", touch=True)
        said(page, f"{setup.title} moved to Cover bench on {date_copy(target)}.")
    assert job_day(desk, setup) == ("cover", target.isoformat())


def foreign_text(browser: Browser, base: str, path: str, desk: Desk | None, size: dict[str, int] = DESKTOP) -> tuple[str, str]:
    out = []
    for foreign in (False, True):
        options: dict[str, Any] = {"viewport": size}
        if foreign:
            options.update(locale="de-DE", timezone_id="Pacific/Auckland")
        context = browser.new_context(**options)
        try:
            if foreign:
                context.clock.install(time=datetime.now(UTC) + timedelta(days=3))
            page = context.new_page()
            if desk:
                desk.sign_in(page)
            page.goto(base + path)
            loaded(page)
            expect(page.get_by_role("heading", level=1)).to_be_visible()
            poll(lambda: page.evaluate("() => !/Loading…|Caricamento…|読み込み中…|جارٍ التحميل…/.test(document.body.innerText)"), "loading tiles have gone", UI_DEADLINE)
            page.evaluate(FINISH_JS)
            out.append(re.sub(r"\s+", " ", page.evaluate("() => document.body.innerText")))
        finally:
            context.close()
    return out[0], out[1]


def test_wf_bench_calendar_device_clock(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    setup = bench_setup(desk)
    now = datetime.now(TURIN)
    laid = now - timedelta(hours=1)
    glued = desk.j("POST", f"/api/bench-jobs/{setup.job['id']}/glue", json={"date": laid.date().isoformat(), "time": laid.strftime("%H:%M")})["job"]["glue"]
    assert glued["state"] == "curing", "curing for 48 hours by the server's clock"
    plain, foreign = foreign_text(browser, app_url, f"/bench?week={setup.monday.isoformat()}", desk)
    assert plain == foreign, "SR14: the same text whatever the browser's language, zone and clock"
    assert "Curing until" in plain or setup.title in plain
    assert "Cured" not in foreign.replace("Curing", ""), "a device clock three days on changes no glue state"


def test_bench_moves(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    setup = bench_setup(desk)
    jobs_path = f"/api/bench-jobs/{setup.job['id']}"
    tuesday = setup.monday + timedelta(days=1)
    assert_error(desk.call("PATCH", jobs_path, json={"bench": "frame", "day": weekday_iso(setup.monday, 5)}), 422, "The bench works Monday to Friday.")
    second = desk.add_piece(setup.client["id"])
    third = desk.add_piece(setup.client["id"])
    first_job = desk.j("POST", "/api/bench-jobs", 201, json={"pieceId": second["id"], "bench": "cover", "day": tuesday.isoformat()})["job"]
    assert_error(desk.call("PATCH", jobs_path, json={"bench": "cover", "day": tuesday.isoformat()}), 409, f"That bench is taken on {date_copy(tuesday)} by {second['title']}.")
    assert first_job["bench"] == "cover"
    wednesday = weekday_iso(setup.monday, 2)
    other = desk.j("POST", "/api/bench-jobs", 201, json={"pieceId": third["id"], "bench": "frame", "day": weekday_iso(setup.monday, 3)})["job"]
    with ThreadPoolExecutor(max_workers=2) as pool:
        racing = list(pool.map(lambda j: desk.call("PATCH", f"/api/bench-jobs/{j}", json={"bench": "frame", "day": wednesday}), [setup.job["id"], other["id"]]))
    assert sorted(r.status_code for r in racing) == [200, 409], "the first of two simultaneous moves wins"
    desk2 = new_desk(app_url)
    dragged = bench_setup(desk2)
    with screen(browser, app_url, f"/bench?week={dragged.monday.isoformat()}", desk2) as page:
        h1(page, "Bench")
        wait_ui(page, lambda: len(shown_cards(page, dragged.title)) == 1, "the card shows")
        card = shown_cards(page, dragged.title)[0]
        card.evaluate("c => { c.__kept = 1; }")
        cell = card.evaluate("c => { const g = c.closest('[role=\"gridcell\"],td').getBoundingClientRect(); return {x: g.x, y: g.y, w: g.width, h: g.height}; }")
        def grip() -> tuple[float, float]:
            box = card.bounding_box()
            return box["x"] + GRIP_INSET_PX, box["y"] + GRIP_INSET_PX
        x, y = grip()
        patches: list[str] = []
        page.on("request", lambda r: patches.append(r.url) if r.method == "PATCH" else None)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + cell["w"] + 5, y)
        clear_motions(page)
        page.keyboard.press("Escape")
        wait_ui(page, lambda: any(r["duration"] == GLIDE_MS for r in motions(page)), "Escape glides home over 320 ms")
        page.mouse.up()
        advance(page, 100)
        assert patches == [] and job_day(desk2, dragged)[1] == dragged.monday.isoformat(), "Escape changes nothing on the server"
        page.evaluate(FINISH_JS)
        x, y = grip()
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + cell["w"] / 2, y)
        page.mouse.move(x + cell["w"] + 5, y)
        clear_motions(page)
        page.mouse.up()
        target = dragged.monday + timedelta(days=1)
        said(page, f"{dragged.title} moved to Frame bench on {date_copy(target)}.")
        assert job_day(desk2, dragged) == ("frame", target.isoformat())
        assert card.evaluate("c => c.__kept === 1"), "a drop keeps the same element"
        wait_ui(page, lambda: any(r["duration"] == STEP_MS for r in motions(page)), "a drop settles over 160 ms")


def test_glue_cure(app_url: str) -> None:
    desk = new_desk(app_url)
    setup = bench_setup(desk)
    path = f"/api/bench-jobs/{setup.job['id']}/glue"
    spring = clock_change(TURIN, True)
    autumn = clock_change(TURIN, False)
    for change in (spring, autumn):
        friday = change - timedelta(days=2)
        glue = desk.j("POST", path, json={"date": friday.isoformat(), "time": "16:00"})["job"]["glue"]
        laid = datetime(friday.year, friday.month, friday.day, 16, tzinfo=TURIN)
        cures = laid.astimezone(UTC) + timedelta(hours=GLUE_HOURS)
        assert glue["laidAt"] == to_instant(laid) and glue["curesAt"] == to_instant(cures), glue
        assert glue["label"] == f"Curing until {date_copy(cures.astimezone(TURIN).date())}, {wall(cures)} Turin time"
    assert_error(desk.call("POST", path, json={"date": spring.isoformat(), "time": "02:30"}), 422, f"02:30 does not exist in Turin on {date_copy(spring)}.")
    twice = desk.j("POST", path, json={"date": autumn.isoformat(), "time": "02:30"})["job"]["glue"]
    first = datetime(autumn.year, autumn.month, autumn.day, 2, 30, tzinfo=TURIN, fold=0)
    assert twice["laidAt"] == to_instant(first), "a time that happens twice is the first of the two"
    assert_error(desk.call("POST", path, json={"date": "26/03/2027", "time": "16:00"}), 422, "That is not a date.")
    assert_error(desk.call("POST", path, json={"date": autumn.isoformat(), "time": "4pm"}), 422, "That is not a time. Write it like 09:00.")
    assert_error(desk.call("POST", path, json={"date": "", "time": "16:00"}), 422, "This field is required.")
    cover_setup = bench_setup(desk, bench="cover")
    assert_error(desk.call("POST", f"/api/bench-jobs/{cover_setup.job['id']}/glue", json={"date": autumn.isoformat(), "time": "16:00"}), 409, "Glue goes on a frame bench job.")
    owner = new_desk(app_url)
    fresh = bench_setup(owner)
    monday = fresh.monday
    glue = owner.j("POST", f"/api/bench-jobs/{fresh.job['id']}/glue", json={"date": monday.isoformat(), "time": "10:00"})["job"]["glue"]
    cures = parse_instant(glue["curesAt"])
    wed = monday + timedelta(days=2)
    copy = f"The glue on {fresh.title} cures until {date_copy(cures.astimezone(TURIN).date())}, {wall(cures)} Turin time."
    assert_error(owner.call("POST", "/api/bench-jobs", json={"pieceId": fresh.piece["id"], "bench": "cover", "day": wed.isoformat()}), 409, copy)
    assert owner.call("POST", "/api/bench-jobs", json={"pieceId": fresh.piece["id"], "bench": "cover", "day": (wed + timedelta(days=1)).isoformat()}).status_code == 201, f"cured by {BENCH_DAY_START_HOUR}:00 on Thursday"


def collection_setup(desk: Desk, town: str = "New York") -> SimpleNamespace:
    client = desk.add_client(town)
    piece = desk.add_piece(client["id"], due_days=60)
    return SimpleNamespace(client=client, piece=piece, path=f"/api/pieces/{piece['id']}/collections")


def book(desk: Desk, setup: SimpleNamespace, day: date, at: str = "09:00") -> httpx.Response:
    quote_body = desk.j("POST", f"{setup.path}/quote", json={})["quote"]
    return desk.call("POST", setup.path, json={"quoteId": quote_body["quoteId"], "localDate": day.isoformat(), "localTime": at})


def test_screen_rules_collection(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = collection_setup(desk)
    assert_contract(app_url, setup.path, instants_of=lambda: desk.j("GET", setup.path))
    date_box = lambda d: d.get_by_role("textbox", name=named("Date"))
    check_screen_rules(browser, app_url, f"/pieces/{setup.piece['id']}/collection", desk, f"Collection of {setup.piece['title']}", "Book a collection", "Book a collection", first=date_box, draft=date_box, ready=with_quote)
    sweep_routes(browser, app_url, "collection")


def with_quote(page: Page) -> None:
    with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path.endswith("/collections/quote")) as answered:
        page.get_by_role("button", name="Get a quote", exact=True).click()
    assert answered.value.status == 200, f"a quote answered {answered.value.status}"
    opener = page.get_by_role("button", name="Book a collection", exact=True)
    wait_ui(page, lambda: opener.count() > 0 and opener.is_enabled() and opener.get_attribute("aria-disabled") != "true", "`Book a collection` opens once a quote has come")


def drive_booking(page: Page, setup: SimpleNamespace, day: date, touch: bool = False) -> None:
    h1(page, f"Collection of {setup.piece['title']}")
    quote_button = page.get_by_role("button", name="Get a quote", exact=True)
    press_held(page, page, "Get a quote", f"**{setup.path}/quote", touch=touch)
    said(page, "Quote: €412.50.")
    opener = page.get_by_role("button", name="Book a collection", exact=True)
    assert quote_button.count() == 1
    tap(opener) if touch else (opener.focus(), page.keyboard.press("Enter"))
    dialog = page.get_by_role("dialog", name="Book a collection", exact=True)
    wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
    landed(page)
    date_box = dialog.get_by_role("textbox", name=named("Date"))
    expect(date_box).to_be_focused()
    time_box = dialog.get_by_role("textbox", name=named("Time"))
    book_button = dialog.get_by_role("button", name="Book", exact=True)
    def press_book() -> None:
        if touch:
            tap(book_button)
        else:
            book_button.focus()
            page.keyboard.press("Enter")
    date_box.fill("soon")
    time_box.fill("09:00")
    press_book()
    check_problems(page, dialog, date_box, "That is not a date.")
    date_box.fill(day.isoformat())
    time_box.fill("9am")
    press_book()
    check_problems(page, dialog, time_box, "That is not a time. Write it like 09:00.")
    time_box.fill("09:00")
    press_held(page, dialog, "Book", f"**{setup.path}", touch=touch)
    said(page, "Booked")
    wait_ui(page, lambda: dialog.count() == 0, "the dialog closes")


def test_wf_courier_collections_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = collection_setup(desk)
    day = future_monday(3)
    with screen(browser, app_url, f"/pieces/{setup.piece['id']}/collection", desk) as page:
        drive_booking(page, setup, day)
        row = desk.j("GET", setup.path)["collections"][0]
        expect(page.get_by_role("link", name=f"Label for {row['id']}", exact=True)).to_be_visible()
        wait_ui(page, lambda: row["display"] in page.locator("body").inner_text(), "both towns' times show")
    quotes = journal(wiremock, "/v1/quotes", "POST")
    assert texts(quotes[-1]["body"]) == texts({"fromTown": "Turin", "toTown": "New York", "widthCm": 66, "depthCm": 70, "heightCm": 78, "weightKg": 12.5})
    booked = journal(wiremock, "/v1/collections", "POST")
    expected_at = datetime(day.year, day.month, day.day, 9, tzinfo=TOWNS["New York"])
    assert len(booked) == 1 and booked[0]["body"] == {"quoteId": "Q-5001", "collectAt": to_instant(expected_at), "town": "New York"} and booked[0]["headers"].get("idempotency-key")
    assert S3().get(f"labels/{desk.id}/{setup.piece['id']}/{row['id']}.pdf") == LABEL_BYTES


def test_wf_courier_collections_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = collection_setup(desk, "London")
    with screen(browser, app_url, f"/pieces/{setup.piece['id']}/collection", desk, size=PHONE) as page:
        drive_booking(page, setup, future_monday(3), touch=True)
        layout(page)
    assert desk.j("GET", setup.path)["collections"][0]["labelSha256"] == LABEL_SHA


def test_wf_courier_collections_refusals(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = collection_setup(desk)
    day = future_monday(3)
    wiremock.fault("POST", "/v1/quotes")
    assert_error(desk.call("POST", f"{setup.path}/quote", json={}), 503, "The courier could not give a quote. Nothing changed.")
    wiremock.stub("POST", "/v1/quotes", status=200, json={"quoteId": "Q-5001", "amount": "412.50", "currency": "EUR"})
    wiremock.fault("POST", "/v1/collections")
    assert_error(book(desk, setup, day), 503, "The courier could not confirm. Nothing was booked.")
    assert desk.j("GET", setup.path)["collections"] == []
    wiremock.stub("POST", "/v1/collections", status=201, json={"id": "C-9001", "state": "booked", "labelPath": "/v1/labels/C-9001"})
    wiremock.fault("GET", "/v1/labels/C-9001")
    assert book(desk, setup, day).status_code == 503, "Booked needs the label's bytes"
    assert not [c for c in desk.j("GET", setup.path)["collections"] if c["state"] == "booked"]
    wiremock.stub("GET", "/v1/labels/C-9001", status=200, body="%PDF-1.4 portico label\n", headers={"Content-Type": "application/pdf"})
    wiremock.stub("POST", "/v1/collections", status=409, json={"code": "slotTaken"})
    taken_at = datetime.now(UTC)
    error = assert_error(book(desk, collection_setup(desk), day), 409)
    match = re.fullmatch(r"That time was just taken at (\d\d:\d\d) Turin time\. Pick another\.", error["message"])
    assert match and match.group(1) in minute_labels(taken_at, taken_at + timedelta(seconds=5)), error["message"]
    wiremock.stub("POST", "/v1/collections", status=201, json={"id": "C-9001", "state": "booked", "labelPath": "/v1/labels/C-9001"})
    spring = clock_change(TOWNS["New York"], True)
    assert_error(book(desk, setup, spring, "02:30"), 422, f"02:30 does not exist in New York on {date_copy(spring)}.")
    unsized_client = desk.add_client()
    unsized = desk.add_piece(unsized_client["id"], dims=False)
    assert_error(desk.call("POST", f"/api/pieces/{unsized['id']}/collections/quote", json={}), 409, "This piece needs its width, depth, height and weight first.")
    spare = new_desk(copy_url("APP_SPARE_URL"))
    limited = collection_setup(spare)
    wiremock.stub("POST", "/v1/quotes", status=429, headers={"Retry-After": str(RETRY_AFTER_PROBE)})
    calls = len(journal(wiremock, "/v1/quotes", "POST"))
    now = datetime.now(UTC)
    busy = assert_error(spare.call("POST", f"{limited.path}/quote", json={}), 429)
    match = re.fullmatch(r"The courier is busy\. You can try again at (\d\d:\d\d) Turin time\.", busy["message"])
    assert match and match.group(1) in minute_labels(now, now + timedelta(seconds=RETRY_AFTER_PROBE + 2))
    calls_after = len(journal(wiremock, "/v1/quotes", "POST"))
    assert calls_after == calls + 1
    wiremock.stub("POST", "/v1/quotes", status=200, json={"quoteId": "Q-5001", "amount": "412.50", "currency": "EUR"})
    poll(lambda: spare.call("POST", f"{limited.path}/quote", json={}).status_code == 200, "the courier is asked again after the instant", RETRY_AFTER_PROBE + API_DEADLINE)
    down = new_desk(copy_url("APP_MINIO_DOWN_URL"))
    outage = collection_setup(down)
    before = len(journal(wiremock, "/v1/collections", "POST"))
    assert_error(book(down, outage, day), 503, "The courier could not confirm. Nothing was booked.")
    assert len(journal(wiremock, "/v1/collections", "POST")) == before, "with the store down, no booking call goes"


def test_collection_wall_time(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    change = next_clock_change(TOWNS["New York"], turin_today() + timedelta(days=14))
    for town in ("New York", "Kyoto", "London", "Dubai", "Turin"):
        for day in (change - timedelta(days=6), change + timedelta(days=1)):
            setup = collection_setup(desk, town)
            resp = book(desk, setup, day)
            assert resp.status_code == 201, resp.text
            row = resp.json()["collection"]
            at = datetime(day.year, day.month, day.day, 9, tzinfo=TOWNS[town])
            assert row["collectAt"] == to_instant(at) and row["localDate"] == day.isoformat() and row["localTime"] == "09:00" and row["town"] == town and row["state"] == "booked"
            head = f"{date_copy(day)}, 09:00 {town} time"
            assert row["display"] == (head if town == "Turin" else f"{head} · {wall(at)} Turin time"), row["display"]
    seeded = seed_desk(app_url)
    piece = next(p for p in seeded.j("GET", "/api/pieces")["pieces"] if p["title"] == "Cantilever side chair")
    rows = seeded.j("GET", f"/api/pieces/{piece['id']}/collections")["collections"]
    assert len(rows) == 2 and {r["localTime"] for r in rows} == {"09:00"} and {r["town"] for r in rows} == {"New York"}
    for row in rows:
        d = date.fromisoformat(row["localDate"])
        at = datetime(d.year, d.month, d.day, 9, tzinfo=TOWNS["New York"])
        assert d.weekday() == 0 and row["collectAt"] == to_instant(at) and row["display"] == f"{date_copy(d)}, 09:00 New York time · {wall(at)} Turin time"


def test_confirmed_booking(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = collection_setup(desk)
    day = future_monday(3)
    quote_id = desk.j("POST", f"{setup.path}/quote", json={})["quote"]["quoteId"]
    body = {"quoteId": quote_id, "localDate": day.isoformat(), "localTime": "09:00"}
    with ThreadPoolExecutor(max_workers=2) as pool:
        answers = list(pool.map(lambda _: desk.call("POST", setup.path, json=body), range(2)))
    assert sorted(a.status_code for a in answers) in ([200, 201], [201, 201]), [a.text for a in answers]
    repeat = desk.call("POST", setup.path, json=body)
    assert repeat.status_code == 200
    row = repeat.json()["collection"]
    calls = journal(wiremock, "/v1/collections", "POST")
    assert len(calls) == 1, f"two presses and a repeat make one call: {calls}"
    key = calls[0]["headers"]["idempotency-key"]
    assert row["labelSha256"] == LABEL_SHA
    label = desk.call("GET", f"{setup.path}/{row['id']}/label")
    assert label.content == LABEL_BYTES and "application/pdf" in label.headers["content-type"]
    assert S3().get(f"labels/{desk.id}/{setup.piece['id']}/{row['id']}.pdf") == LABEL_BYTES
    expected = f"{date_copy(day)}, 09:00 New York time"
    assert_error(desk.call("POST", setup.path, json={**body, "localTime": "10:00"}), 409, f"This piece is already booked for {expected}.")
    second = collection_setup(desk)
    answer = book(desk, second, day, "11:00")
    assert answer.status_code == 201, "the courier's shared id is never a unique key"
    calls = journal(wiremock, "/v1/collections", "POST")
    assert len(calls) == 2 and calls[1]["headers"]["idempotency-key"] != key
    retried = collection_setup(desk)
    retried_quote = desk.j("POST", f"{retried.path}/quote", json={})["quote"]["quoteId"]
    retried_body = {"quoteId": retried_quote, "localDate": day.isoformat(), "localTime": "12:00"}
    seen = len(journal(wiremock, "/v1/collections", "POST"))
    wiremock.fault("POST", "/v1/collections")
    assert_error(desk.call("POST", retried.path, json=retried_body), 503, "The courier could not confirm. Nothing was booked.")
    wiremock.stub("POST", "/v1/collections", status=201, json={"id": "C-9001", "state": "booked", "labelPath": "/v1/labels/C-9001"})
    assert desk.call("POST", retried.path, json=retried_body).status_code == 201
    retried_keys = [c["headers"]["idempotency-key"] for c in journal(wiremock, "/v1/collections", "POST")[seen:]]
    assert len(retried_keys) >= 2 and len(set(retried_keys)) == 1, f"a retry carries the same repeat key: {retried_keys}"
    wiremock.stub("GET", "/v1/collections/C-9001", status=200, json={"id": "C-9001", "state": "collected", "labelPath": "/v1/labels/C-9001"})
    assert poll(lambda: desk.j("GET", setup.path)["collections"][0]["state"] == "collected", "the courier's state is read when the screen asks", 40)


HEADER = "client,piece,maker,year,stamp,material,notes"


def workbook(*rows: str, header: str = HEADER, sep: str = ",", eol: str = "\r\n", bom: bool = False) -> bytes:
    text = eol.join([header.replace(",", sep), *rows]) + eol
    return (b"\xef\xbb\xbf" if bom else b"") + text.encode()


def sized_workbook(size: int) -> bytes:
    head = f'{HEADER}\r\nMarta,Padded,,,{luhn_stamp()},,"'.encode()
    tail = b'"\r\n'
    return head + b"x" * (size - len(head) - len(tail)) + tail


def preview(desk: Desk, data: bytes) -> httpx.Response:
    return desk.call("POST", "/api/workbook/preview", files={"file": ("old.csv", data, "text/csv")})


def save_file(desk: Desk, data: bytes) -> httpx.Response:
    return desk.call("POST", "/api/workbook/save", files={"file": ("old.csv", data, "text/csv")})


def test_screen_rules_workbook(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    assert_contract(app_url, "/api/workbook/preview", multipart_limit=WORKBOOK_LIMIT)
    data = workbook(f"Client,Piece,,,{luhn_stamp()},,")
    with screen(browser, app_url, "/workbook", desk) as page:
        h1(page, "Old workbook")
        with page.expect_file_chooser() as chooser:
            press_file_field(file_field(page, "Choose a file"))
        chooser.value.set_files({"name": "old.csv", "mimeType": "text/csv", "buffer": data})
        said(page, "Preview ready: 1 new, 0 matched, 0 refused.")
        check_dialog(page, page.get_by_role("button", name="Save", exact=True), "Save this file")
        assert_motion_system(motions(page))


def test_wf_old_workbook_keyboard(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    stamp = luhn_stamp()
    data = workbook(f'Marta;Lounge;Bressan;1957;{stamp};VM-2041;"two\r\nlines"', f"Marta;Stool;;;{bad_stamp(stamp)};;", sep=";", bom=True)
    with screen(browser, app_url, "/workbook", desk) as page:
        h1(page, "Old workbook")
        choose = file_field(page, "Choose a file")
        with page.expect_file_chooser() as chooser:
            choose.focus()
            page.keyboard.press("Enter")
        chooser.value.set_files({"name": "old.csv", "mimeType": "text/csv", "buffer": data})
        said(page, "Preview ready: 1 new, 0 matched, 1 refused.")
        frame = page.get_by_role("region", name="Workbook preview", exact=True)
        assert frame.evaluate("f => f.tabIndex >= 0"), "the frame takes keyboard focus"
        row = frame.get_by_role("button", name="Row 3", exact=True)
        wait_ui(page, lambda: row.count() > 0, "row numbers count records")
        row.focus()
        page.keyboard.press("Enter")
        wait_ui(page, lambda: "Row 3: that stamp number does not check out." in frame.inner_text(), "the row expands with its reason")
        advance(page, REFRESH_MS)
        assert "Row 3: that stamp number does not check out." in frame.inner_text(), "SR1: an expanded row stays expanded"
        opener = page.get_by_role("button", name="Save", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Save this file", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        listen(page)
        press_held(page, dialog, "Save file", "**/api/workbook/save")
        was_said(page, "Saved: 1 new, 0 matched, 1 refused.")
    assert [p["title"] for p in desk.j("GET", "/api/pieces")["pieces"]] == ["Lounge"]
    assert S3().get(f"workbooks/{desk.id}/{hashlib.sha256(data).hexdigest()}.csv") == data


def test_wf_old_workbook_touch(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    title = f"Touch {word()}"
    data = workbook(f"Marta,{title},,,{luhn_stamp()},,")
    with screen(browser, app_url, "/workbook", desk, size=PHONE) as page:
        h1(page, "Old workbook")
        layout(page)
        with page.expect_file_chooser() as chooser:
            press_file_field(file_field(page, "Choose a file"), touch=True)
        chooser.value.set_files({"name": "old.csv", "mimeType": "text/csv", "buffer": data})
        said(page, "Preview ready: 1 new, 0 matched, 0 refused.")
        tap(page.get_by_role("toolbar", name="Main action", exact=True).get_by_role("button", name="Save", exact=True))
        dialog = page.get_by_role("dialog", name="Save this file", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the sheet opens")
        landed(page)
        listen(page)
        press_held(page, dialog, "Save file", "**/api/workbook/save", touch=True)
        was_said(page, "Saved: 1 new, 0 matched, 0 refused.")
        expect(page.get_by_role("link", name="Download materials list", exact=True)).to_have_attribute("href", re.compile(r"/api/materials-list\.csv"))
    assert title in desk.call("GET", "/api/materials-list.csv").text


def test_wf_old_workbook_refusals(app_url: str) -> None:
    desk = new_desk(app_url)
    assert_error(preview(desk, workbook(header="client,piece,maker,year,stamp,material,notes,extra")), 422, "This file has a column the desk does not know: extra.")
    assert_error(preview(desk, workbook(header="client,piece,maker,year,stamp,material")), 422, "This file is missing a column: notes.")
    assert_error(preview(desk, workbook(header="client,piece,maker,year,stamp,material,extra")), 422, "This file has a column the desk does not know: extra.")
    assert_error(preview(desk, HEADER.encode() + b"\r\n\xff\xfe\xfa,x\r\n"), 422, "This file is not UTF-8 text.")
    over = sized_workbook(WORKBOOK_LIMIT + 1)
    assert_error(preview(desk, over), 413, "This file is over 2,000,000 bytes.")
    assert_error(http("POST", f"{app_url}/api/workbook/save", files={"file": ("o.csv", over, "text/csv")}), 413, "This file is over 2,000,000 bytes.")
    assert preview(desk, sized_workbook(WORKBOOK_LIMIT)).status_code == 200, "up to and including 2,000,000 bytes"
    assert_error(save_file(desk, workbook(header="client,piece")), 422)
    assert desk.j("GET", "/api/pieces")["pieces"] == [] and not S3().keys(f"workbooks/{desk.id}/")
    down = new_desk(copy_url("APP_MINIO_DOWN_URL"))
    assert_error(save_file(down, workbook(f"A,B,,,{luhn_stamp()},,")), 503, "The file store is unavailable right now. Nothing was saved.")
    assert down.j("GET", "/api/pieces")["pieces"] == [], "nothing is half-written"


def test_workbook_reading(app_url: str) -> None:
    desk = new_desk(app_url)
    good, other = luhn_stamp(), luhn_stamp()
    rows = [
        f'Marta;Lounge;Bressan;1957;{good};VM-2041;"line one\r\nline two"',
        f"Marta;Stool;;;{bad_stamp(good)};;",
        "Marta;Stool;;;;;",
        f"Marta;;;;{luhn_stamp()};;",
        f"Marta;Bench;;;{luhn_stamp()};VM-9999;",
        "too;few",
        f"Marta;Good;;;{other};;",
    ]
    answer = preview(desk, workbook(*rows, sep=";", bom=True))
    assert answer.status_code == 200, answer.text
    body = answer.json()
    assert [(r["row"], r["status"]) for r in body["rows"]] == [(2, "new"), (3, "refused"), (4, "refused"), (5, "refused"), (6, "refused"), (7, "refused"), (8, "new")]
    assert [r["reason"] for r in body["rows"]] == [None, "Row 3: that stamp number does not check out.", "Row 4: that stamp number does not check out.", "Row 5: the piece has no title.", "Row 6: the desk has no material VM-9999.", "Row 7: that row does not have seven fields.", None]
    assert body["counts"] == {"new": 2, "matched": 0, "refused": 5}
    assert body["rows"][0]["client"] == "Marta" and body["rows"][0]["piece"] == "Lounge" and body["rows"][0]["stamp"] == good
    assert desk.j("GET", "/api/pieces")["pieces"] == [] and desk.j("GET", "/api/clients")["clients"] == [], "a preview saves nothing"
    plain = preview(desk, workbook(f"Marta,Lounge,,,{good},,", eol="\n"))
    assert plain.json()["counts"]["new"] == 1, "comma and LF are read too"
    swapped = preview(desk, f"piece,client,maker,year,stamp,material,notes\nLounge,Marta,,,{good},,\n".encode())
    assert swapped.json()["rows"][0]["piece"] == "Lounge", "columns are read by name"


def test_workbook_saving(app_url: str) -> None:
    desk = new_desk(app_url)
    stamp, kept = luhn_stamp(), luhn_stamp()
    client = desk.add_client(name="Existing owner")
    own_title, spaced_note = f"Own {word()}", f"  {word()}  "
    held_piece = desk.add_piece(client["id"], title=own_title, stampNumber=kept)
    spaced_title, spaced_client = "  Bergère «lounge» ", f" Marta {word()} "
    data = workbook(f"{spaced_client},{spaced_title},,,{stamp},,{spaced_note}", f"Existing owner,Workbook title,,,{kept},,", f"{spaced_client},Same again,,,{stamp},,", f"x,y,,,{bad_stamp(stamp)},,")
    first = save_file(desk, data)
    assert first.status_code == 200, first.text
    result = first.json()
    assert (result["created"], result["matched"], result["refused"]) == (1, 2, 1) and result["sha256"] == hashlib.sha256(data).hexdigest()
    assert S3().get(f"workbooks/{desk.id}/{result['sha256']}.csv") == data, "kept byte for byte"
    pieces = desk.j("GET", "/api/pieces")["pieces"]
    made = next(p for p in pieces if p.get("stampNumber") == stamp)
    assert made["title"] == spaced_title and made["notes"] == spaced_note, "never trimmed or retyped"
    assert desk.j("GET", f"/api/pieces/{held_piece['id']}")["piece"]["title"] == own_title, "a matched row changes nothing"
    clients = desk.j("GET", "/api/clients")["clients"]
    new_client = next(c for c in clients if c["name"] == spaced_client)
    assert new_client["town"] == "Turin" and new_client["language"] == "it" and not new_client["email"]
    second = save_file(desk, data).json()
    assert (second["created"], second["matched"], second["refused"]) == (0, 3, 1)
    assert desk.j("GET", "/api/pieces")["pieces"] == pieces and desk.j("GET", "/api/clients")["clients"] == clients, "the second save changes nothing"
    assert preview(desk, data).json()["counts"] == {"new": 0, "matched": 3, "refused": 1}


def test_materials_list_file(app_url: str, wiremock: Any) -> None:
    desk, other = new_desk(app_url), new_desk(app_url)
    owner, quoted_title = f"@{word()}", f'Zed "{word()}" chair'
    archived_title, stranger_title = f"Archived {word()}", f"Elsewhere {word()}"
    client = desk.add_client(name=owner)
    dangerous = {"=SUM(A1)": "a", "+plus": "b", "-minus": "c", "@at": "d", "\ttab": "e", "\rreturn": "f"}
    for title in dangerous:
        desk.add_piece(client["id"], title=title, notes=title)
    with_estimate = desk.add_piece(client["id"], title=quoted_title)
    desk.add_estimate(with_estimate["id"])
    gone = desk.add_piece(client["id"], title=archived_title)
    desk.j("PATCH", f"/api/pieces/{gone['id']}", json={"state": "archived"})
    other_client = other.add_client()
    other.add_piece(other_client["id"], title=stranger_title)
    resp = desk.call("GET", "/api/materials-list.csv")
    assert resp.status_code == 200 and "text/csv" in resp.headers["content-type"]
    raw = resp.content.decode("utf-8")
    assert raw.startswith('"piece","client","material","code","lot","hides","notes"\r\n')
    assert '\r\n' in raw and not re.search(r"(?<!\r)\n", raw.replace('\r', '\r')) , "CRLF line ends"
    assert '"' + quoted_title.replace('"', '""') + '"' in raw, "inner quotes doubled"
    rows = list(csv.reader(io.StringIO(raw, newline="")))
    assert all(raw.count('"') % 2 == 0 for _ in rows[:1])
    data = rows[1:]
    titles = [r[0] for r in data]
    for title in dangerous:
        assert f"'{title}" in titles, f"{title!r} carries the apostrophe"
        row = next(r for r in data if r[0] == f"'{title}")
        assert row[1] == f"'{owner}" and row[6] == f"'{title}" and row[2:6] == ["", "", "", ""]
    assert archived_title not in raw and stranger_title not in raw
    last = next(r for r in data if r[0] == quoted_title)
    assert last[2:6] == ["Tabacco", "VM-2041", "L-2041-A", "1"]
    assert_error(http("GET", f"{app_url}/api/materials-list.csv"), 401)


def read_to_the_end(page: Page, heading: Locator) -> None:
    scroll_to_end(heading)
    scroll_to_top(heading)
    advance(page, STILL_GAP_MS)
    scroll_to_end(heading)


def test_screen_rules_dossier(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, photos=False)
    pid = setup.piece["id"]
    assert_contract(app_url, f"/api/pieces/{pid}/dossier", instants_of=lambda: desk.j("GET", f"/api/pieces/{pid}/estimates"))
    desk.j("POST", f"/api/pieces/{pid}/dossier", 202, json={})
    walk_instants(dossier_settled(desk, pid))
    name_box = lambda d: d.get_by_role("textbox", name=named("Your full name"))
    check_screen_rules(browser, app_url, f"/pieces/{pid}/dossier", desk, f"Dossier for {setup.piece['title']}", "Sign dossier", "Sign dossier", first=name_box, draft=name_box)
    with screen(browser, app_url, f"/pieces/{pid}/dossier", desk) as page:
        h1(page, f"Dossier for {setup.piece['title']}")
        rail = page.get_by_role("navigation", name="Sections", exact=True)
        for section in DOSSIER_SECTIONS:
            expect(rail.get_by_role("link", name=section, exact=True)).to_be_visible()
        rail.get_by_role("link", name=DOSSIER_SECTIONS[4], exact=True).click()
        heading = page.get_by_role("heading", name=DOSSIER_SECTIONS[4], exact=True)
        wait_ui(page, lambda: heading.evaluate("h => h === document.activeElement"), "focus on the section's heading")
        assert urlparse(page.url).fragment == "care-card"
        if heading.evaluate(f"h => {{ const s = ({SCROLLER_JS})(h); return s.scrollHeight > s.clientHeight; }}"):
            read_to_the_end(page, heading)
            wait_ui(page, lambda: "06" in "".join(rail.locator('[aria-current="true"]').all_inner_texts()), "the last section at the very bottom")
    sweep_routes(browser, app_url, "dossier")


def drive_dossier(page: Page, setup: SimpleNamespace, touch: bool = False) -> None:
    h1(page, f"Dossier for {setup.piece['title']}")
    clear_motions(page)
    press_held(page, page, "Make dossier", f"**/api/pieces/{setup.piece['id']}/dossier", touch=touch)
    said(page, "Dossier stored.")
    steps = page.get_by_role("list", name="Dossier steps", exact=True).locator('[data-part="dossier-step"]')
    wait_ui(page, lambda: steps.count() == 3 and steps.nth(2).get_attribute("data-state") in ("done", "current"), "the strip reaches Stored")
    assert all(word_ in steps.nth(i).inner_text() for i, word_ in enumerate(("Waiting", "Rendering", "Stored")))
    expect(page.get_by_role("link", name="Download PDF", exact=True)).to_be_visible()


def test_wf_conservation_dossier_keyboard(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, photos=False)
    pid = setup.piece["id"]
    with screen(browser, app_url, f"/pieces/{pid}/dossier", desk) as page:
        drive_dossier(page, setup)
        wait_ui(page, lambda: any(r["part"] == "step-check" and r["duration"] == GLIDE_MS for r in motions(page)), "a finished step draws its check over 320 ms")
        assert_motion_system(motions(page))
        clear_motions(page)
        advance(page, REFRESH_MS)
        advance(page, REFRESH_MS)
        assert [r for r in motions(page) if r["part"] == "step-check"] == [], "a check draws once and never again on a refresh"
        opener = page.get_by_role("button", name="Sign dossier", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Sign dossier", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        typed = dialog.get_by_role("textbox", name=named("Your full name"))
        expect(typed).to_be_focused()
        typed.fill("Somebody Else")
        dialog.get_by_role("button", name="Sign", exact=True).focus()
        page.keyboard.press("Enter")
        check_problems(page, dialog, typed, "That is not the name on this desk.")
        sign_button = dialog.get_by_role("button", name="Sign", exact=True)
        def press_sign() -> None:
            sign_button.focus()
            page.keyboard.press("Enter")
        announced_twice(page, press_sign, "That is not the name on this desk.")
        typed.fill(f"  {desk.name.upper()} ")
        press_held(page, dialog, "Sign", f"**/api/pieces/{pid}/dossier/sign")
        said(page, "Dossier signed.")
        history = page.get_by_role("list", name="Dossier history", exact=True)
        wait_ui(page, lambda: history.get_by_role("listitem").count() == 4, "the history lists four steps")
    body = desk.j("GET", f"/api/pieces/{pid}/dossier")["dossier"]
    assert body["state"] == "signed" and [h["what"] for h in body["history"]] == ["asked", "rendered", "stored", "signed"]


def test_wf_conservation_dossier_touch(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, photos=False)
    with screen(browser, app_url, f"/pieces/{setup.piece['id']}/dossier", desk, size=PHONE) as page:
        h1(page, f"Dossier for {setup.piece['title']}")
        layout(page)
        expect(page.get_by_role("region", name="Section numbers", exact=True)).to_be_visible()
        bar = page.get_by_role("toolbar", name="Main action", exact=True)
        press_held(page, bar, "Make dossier", f"**/api/pieces/{setup.piece['id']}/dossier", touch=True)
        said(page, "Dossier stored.")
    dossier = dossier_settled(desk, setup.piece["id"])
    assert S3().get(f"dossiers/{desk.id}/{setup.piece['id']}/{dossier['id']}.pdf")[:4] == b"%PDF"


def test_wf_conservation_dossier_outages(browser: Browser, wiremock: Any) -> None:
    for env, suffix, copy in (("APP_GOTENBERG_DOWN_URL", "-render", "The PDF service is unavailable right now. Nothing was saved."), ("APP_MINIO_DOWN_URL", "-storage", "The file store is unavailable right now. Nothing was saved.")):
        base = copy_url(env)
        desk = new_desk(base)
        setup = signed_off_piece(desk, photos=False)
        pid = setup.piece["id"]
        with screen(browser, base, f"/pieces/{pid}/dossier", desk) as page:
            h1(page, f"Dossier for {setup.piece['title']}")
            page.get_by_role("button", name="Make dossier", exact=True).click()
            said(page, copy)
            steps = page.get_by_role("list", name="Dossier steps", exact=True).locator('[data-part="dossier-step"]')
            assert steps.evaluate_all("(steps) => (steps[2] ? steps[2].getAttribute('data-state') : null)") != "done", "the strip never reads Stored during an outage"
        body = dossier_settled(desk, pid)
        assert body["state"] == "failed" and body["message"] == copy, body
        assert_error(desk.call("GET", f"/api/pieces/{pid}/dossier/pdf"), 409, "The dossier is not stored yet.")
        assert_error(desk.call("POST", f"/api/pieces/{pid}/dossier/sign", json={"typedName": desk.name}), 409, "The dossier is not stored yet.")
        if suffix == "-render":
            assert not S3(suffix).keys(f"dossiers/{desk.id}/"), "nothing half-written"
        assert desk.call("POST", f"/api/pieces/{pid}/dossier", json={}).status_code == 202, "another press starts again"


def test_dossier_contents(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, town="Turin")
    pid = setup.piece["id"]
    stamp = luhn_stamp()
    desk.j("PATCH", f"/api/pieces/{pid}", json={"stampNumber": stamp, "notes": "Private desk note"})
    assert_error(desk.call("POST", f"/api/pieces/{desk.add_piece(setup.client['id'])['id']}/dossier", json={}), 409, "This piece has no signed-off estimate yet.")
    assert desk.call("GET", f"/api/pieces/{pid}/dossier").status_code == 404, "404 before the first one"
    desk.j("POST", f"/api/pieces/{pid}/dossier", 202, json={})
    assert dossier_settled(desk, pid)["state"] == "stored"
    pdf = desk.call("GET", f"/api/pieces/{pid}/dossier/pdf")
    assert "application/pdf" in pdf.headers["content-type"] and pdf_pages(pdf.content) >= 1
    words = re.sub(r"\s+", " ", pdf_text(pdf.content))
    for needed in (setup.piece["title"], stamp, "along the front seam", "Tabacco", "L-2041-A", COPY["it"]["K1"], COPY["it"]["K2"]):
        assert needed in words, f"the PDF lacks {needed!r}"
    for banned in ("Check again before quoting", "Private desk note", "85.00", "€"):
        assert banned not in words, f"the PDF carries {banned!r}"


def test_render_and_store(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, photos=False)
    pid = setup.piece["id"]
    started = desk.call("POST", f"/api/pieces/{pid}/dossier", json={})
    assert started.status_code == 202
    body = started.json()["dossier"]
    assert {"id", "state", "message", "signedBy", "signedAt", "history"} <= set(body) and body["state"] in ("waiting", "rendering", "stored")
    done = dossier_settled(desk, pid)
    assert done["state"] == "stored" and done["message"] is None
    assert [h["what"] for h in done["history"]] == ["asked", "rendered", "stored"]
    key = f"dossiers/{desk.id}/{pid}/{done['id']}.pdf"
    assert S3().get(key) == desk.call("GET", f"/api/pieces/{pid}/dossier/pdf").content
    held_back = signed_off_piece(desk, photos=False)
    with screen(browser, app_url, f"/pieces/{held_back.piece['id']}/dossier", desk) as page:
        h1(page, f"Dossier for {held_back.piece['title']}")
        steps = page.get_by_role("list", name="Dossier steps", exact=True).locator('[data-part="dossier-step"]')
        with hold_reads(page):
            with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path.endswith("/dossier")) as posted:
                page.get_by_role("button", name="Make dossier", exact=True).click()
            answered = posted.value.json()["dossier"]["state"]
            advance(page, STRIP_HOLD_MS)
            if answered != "stored":
                assert steps.evaluate_all("(steps) => (steps[2] ? steps[2].getAttribute('data-state') : null)") != "done", "the strip follows the server's state, never a timer"


def test_downloads_and_signing(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    setup = signed_off_piece(desk, photos=False)
    pid = setup.piece["id"]
    desk.j("POST", f"/api/pieces/{pid}/dossier", 202, json={})
    dossier_settled(desk, pid)
    assert_error(desk.call("POST", f"/api/pieces/{pid}/dossier/sign", json={"typedName": "Somebody Else"}), 422, "That is not the name on this desk.")
    signed = desk.j("POST", f"/api/pieces/{pid}/dossier/sign", json={"typedName": desk.name.lower()})["dossier"]
    assert signed["state"] == "signed" and signed["signedBy"] == desk.name
    walk_instants(signed)
    assert_error(desk.call("POST", f"/api/pieces/{pid}/dossier", json={}), 409, "A signed dossier never changes.")
    assert_error(desk.call("POST", f"/api/pieces/{pid}/dossier/sign", json={"typedName": desk.name}), 409, "A signed dossier never changes.")
    for method in ("PUT", "PATCH", "DELETE"):
        resp = desk.call(method, f"/api/pieces/{pid}/dossier", json={})
        assert_error(resp, 405)
        assert resp.headers.get("allow")
    assert desk.j("GET", f"/api/pieces/{pid}/dossier")["dossier"]["history"] == signed["history"]
    first = None
    for _ in range(5):
        got = desk.call("GET", f"/api/pieces/{pid}/dossier/pdf")
        assert got.status_code == 200, got.text[:200]
        first = first or got.content
        assert got.content == first, "a signed dossier never changes"
    now = datetime.now(UTC)
    limited = desk.call("GET", f"/api/pieces/{pid}/dossier/pdf")
    error = assert_error(limited, 429)
    assert 0 < int(limited.headers["retry-after"]) <= FILE_WINDOW_SECONDS
    assert re.fullmatch(r"Too many downloads\. You can try again at \d\d:\d\d Turin time\.", error["message"])
    assert now.tzinfo is UTC
    assert_error(http("GET", f"{app_url}/api/pieces/{pid}/dossier/pdf"), 401)


ROUTE_CASES = {
    "pieces": ("/pieces", "Pieces", "New piece"), "piece": ("/pieces/{p}", "{t}", "Send client page"),
    "condition": ("/pieces/{p}/condition", "Condition of {t}", "Add a pin"), "photographs": ("/pieces/{p}/photographs", "Photographs of {t}", "Add photographs"),
    "hide": ("/pieces/{p}/hide", "Hide for {t}", None), "estimate": ("/pieces/{p}/estimate", "Estimate for {t}", "Edit estimate"),
    "collection": ("/pieces/{p}/collection", "Collection of {t}", "Book a collection"), "dossier": ("/pieces/{p}/dossier", "Dossier for {t}", "Make dossier"),
    "clients": ("/clients", "Clients", "New client"), "client": ("/clients/{c}", "{n}", "Rename client"),
    "library": ("/library", "Material library", "Hold a dye lot"), "bench": ("/bench", "Bench", "Add job"),
    "workbook": ("/workbook", "Old workbook", "Save"), "rates": ("/rates", "Labour rates", "New rate"), "client-page": ("/c/{k}", "Your piece", "Your answer"),
}
PRINTED_ROUTES = ("estimate", "dossier", "client-page")


@pytest.mark.parametrize("key", list(ROUTE_CASES), ids=list(ROUTE_CASES))
def test_route_sweep(browser: Browser, app_url: str, wiremock: Any, key: str) -> None:
    sweep_route(browser, app_url, sweep_world(app_url, (key,)), key)


def test_motion_system(browser: Browser, app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"])
    desk.add_estimate(piece["id"])
    routes = [("/pieces", "New piece"), (f"/pieces/{piece['id']}/estimate", "Edit estimate"), ("/clients", "New client"), ("/rates", "New rate"), ("/bench", "Add job"), (f"/pieces/{collection_setup(desk).piece['id']}/collection", "Book a collection")]
    for path, opener in routes:
        for reduced in ("no-preference", "reduce"):
            with screen(browser, app_url, path, desk, reduced_motion=reduced) as page:
                if opener == "Book a collection":
                    with_quote(page)
                button = page.get_by_role("button", name=opener, exact=True)
                wait_ui(page, lambda: button.count() > 0, f"{opener} shows on {path}")
                clear_motions(page)
                button.focus()
                page.keyboard.press("Enter")
                dialog = page.get_by_role("dialog", name=opener, exact=True)
                wait_ui(page, lambda: dialog.count() > 0, f"{opener} opens")
                wait_ui(page, lambda: dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: opening moves focus inside")
                escape_panel(page, dialog)
                advance(page, 700)
                wait_ui(page, lambda: dialog.count() == 0, f"{opener} closes")
                records = motions(page)
                if reduced == "reduce":
                    assert_no_motion(records)
                else:
                    assert records, f"{opener} opens with a motion"
                    assert_motion_system(records)


def test_wf_cross_cutting_surface(app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"], dims=False)
    health = http("GET", f"{app_url}/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert_error(http("GET", f"{app_url}/api/{word()}"), 404)
    page404 = http("GET", f"{app_url}/{word()}")
    assert page404.status_code == 404 and re.search(r"<h1\b[^>]*>.*?Page not found.*?</h1>", page404.text, re.S | re.I), "the server's 404 page has its heading"
    for probe in ("/package.json", "/.env", "/run.json", "/src/index.ts", "/api/debug", "/api/test/reset", "/tsconfig.json", "/THIRD_PARTY_NOTICES.md"):
        assert http("GET", app_url + probe).status_code == 404, f"{probe} is served"
    wrong = desk.call("DELETE", f"/api/pieces/{piece['id']}")
    assert_error(wrong, 405)
    assert {m.strip() for m in wrong.headers["allow"].split(",")} == {"GET", "PATCH"}
    oversized = b'{"x":"' + b"a" * JSON_LIMIT + b'"}'
    json_type = {"Content-Type": "application/json"}
    assert_error(http("POST", f"{app_url}/api/{word()}", content=oversized, headers=json_type), 404)
    assert_error(http("PUT", f"{app_url}/api/health", content=oversized, headers=json_type), 405)
    assert_error(http("POST", f"{app_url}/api/clients", content=oversized, headers={**json_type, "Origin": FOREIGN_ORIGIN}), 413)
    exact = b'{"name":"n","email":"bad","message":"' + b"a" * (JSON_LIMIT - 37 - 2) + b'"}'
    assert len(exact) == JSON_LIMIT
    assert http("POST", f"{app_url}/api/enquiries", content=exact, headers=json_type).status_code == 422, "up to and including 1,000,000 bytes"
    assert_error(http("POST", f"{app_url}/api/clients", json={"name": "x"}, headers={"Origin": FOREIGN_ORIGIN}), 403)
    assert_error(http("POST", f"{app_url}/api/clients", json={"name": "x"}), 401)
    assert_error(http("GET", f"{app_url}/api/pieces/999999999"), 401)
    assert_error(desk.call("POST", f"/api/pieces/{unknown_like(piece['id'])}/pins", content=b"x", headers={"Content-Type": "text/plain"}), 404)
    assert_error(desk.call("POST", f"/api/pieces/{piece['id']}/pins", content=b"{", headers={"Content-Type": "text/plain"}), 415)
    assert_error(desk.call("POST", f"/api/pieces/{piece['id']}/pins", content=b"{", headers=json_type), 400)
    assert_error(desk.call("POST", f"/api/pieces/{piece['id']}/pins", json={"x": 500, "y": 1, "kind": "tear", "note": "n", "signed": False}), 422)
    stamp = luhn_stamp()
    desk.add_piece(client["id"], stampNumber=stamp, dims=False)
    assert_error(desk.call("PATCH", f"/api/pieces/{piece['id']}", json={"stampNumber": stamp, "title": "x" * 121}), 422)
    assert_error(desk.call("POST", "/api/rates", json={"takesEffectOn": "2020-01-01", "eur": "1.00", "gbp": "1.00", "usd": "1.00", "jpy": "1", "aed": "1.00"}), 422, "Rates take effect today or later.")
    deep: Any = "x"
    for _ in range(DEPTH_LIMIT - 1):
        deep = [deep]
    ok = http("POST", f"{app_url}/api/enquiries", json={"name": "n", "email": f"{word()}@example.org", "message": "m", "x": deep})
    assert ok.status_code == 202, "nesting up to and including 16 levels"
    assert_error(http("POST", f"{app_url}/api/enquiries", json={"name": "n", "email": f"{word()}@example.org", "message": "m", "x": [deep]}), 422)


def test_wf_cross_cutting_return_addresses(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    client = desk.add_client()
    piece = desk.add_piece(client["id"], dims=False)
    redirect = http("GET", f"{app_url}/pieces/{piece['id']}")
    assert redirect.status_code in (301, 302, 303, 307, 308) and parse_qs(urlparse(redirect.headers["location"]).query)["returnTo"] == [f"/pieces/{piece['id']}"]
    def landing(target: str) -> str:
        return http("POST", f"{app_url}/api/session", json={"email": desk.email, "password": desk.password, "returnTo": target}).json()["session"]["landing"]
    assert landing(f"/pieces/{piece['id']}") == f"/pieces/{piece['id']}"
    for bad in (PROTOCOL_RELATIVE, "/\\elsewhere.example", "http://elsewhere.example/", BAD_ADDRESS, "pieces"):
        assert landing(bad) == "/pieces", f"{bad} is not honoured"
    with screen(browser, app_url, f"/sign-in?returnTo={PROTOCOL_RELATIVE}") as page:
        heading = h1(page, "Sign in")
        expect(heading).to_be_focused()
        page.get_by_role("textbox", name=named("Email")).fill(desk.email)
        page.get_by_role("textbox", name=named("Password")).fill(desk.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path == "/pieces", "a bad return address lands on /pieces")
        assert urlparse(page.url).netloc == urlparse(app_url).netloc
        page.reload()
        h1(page, "Pieces")
    base = copy_url("APP_SESSION_URL")
    short = new_desk(base)
    started = datetime.now(UTC)
    with screen(browser, base, "/clients", short) as page:
        h1(page, "Clients")
        page.get_by_role("button", name="New client", exact=True).click()
        dialog = page.get_by_role("dialog", name="New client", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the dialog opens")
        name_box = dialog.get_by_role("textbox", name=named("Name"))
        draft = f"Draft {word()}"
        name_box.fill(draft)
        poll(lambda: short.call("GET", "/api/session").status_code == 401, "the session ends after SESSION_SECONDS", SHORT_SESSION_SECONDS + API_DEADLINE)
        assert (datetime.now(UTC) - started).total_seconds() >= SHORT_SESSION_SECONDS - 3, "use does not end it early"
        advance(page, REFRESH_MS)
        said(page, "Your session ended. Sign in again to keep going — what you typed is still here.")
        expect(name_box).to_have_value(draft)
        link = dialog.get_by_role("link", name="Sign in again", exact=True)
        link.click()
        wait_ui(page, lambda: urlparse(page.url).path == "/sign-in", "Sign in again goes to /sign-in")
        assert parse_qs(urlparse(page.url).query)["returnTo"][0].startswith("/clients")
        page.get_by_role("textbox", name=named("Email")).fill(short.email)
        page.get_by_role("textbox", name=named("Password")).fill(short.password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        wait_ui(page, lambda: urlparse(page.url).path == "/clients", "the same address shows")
        dialog = page.get_by_role("dialog", name="New client", exact=True)
        wait_ui(page, lambda: dialog.count() > 0, "the same dialog is open")
        expect(dialog.get_by_role("textbox", name=named("Name"))).to_have_value(draft)


SEED_PIECES = {
    "Lounge chair": ("Giulia Ricci", "48201768", "onTheBench", 21), "Tubular armchair": ("Harriet Osei", "60319522", "inSurvey", 28),
    "Cantilever side chair": ("Dana Whitlock", "71540835", "inSurvey", 35), "Folding deck chair": ("中村 葵", "30972186", "inSurvey", 42),
    "Swivel desk chair": ("سارة المنصوري", "52166048", "inSurvey", 49), "Bentwood armchair": ("Zoë Ørsted", "83407197", "ready", 14),
    "Slat bench": ("MANIFATTURATESSILEEPELLETTERIADELLEVALLISUPERIORIDIBIELLAETORINO", "26750414", "inSurvey", 56),
}
SEED_TOTALS = {"Lounge chair": "€2,102.71", "Tubular armchair": "£1,056.40", "Cantilever side chair": "US$1,322.24", "Folding deck chair": "¥187,773", "Swivel desk chair": "AED 4,927.93", "Bentwood armchair": "£1,541.88"}


def test_wf_cross_cutting_seed(app_url: str) -> None:
    for base in [app_url, *map(copy_url, ("APP_MINIO_DOWN_URL", "APP_GOTENBERG_DOWN_URL", "APP_SEARCH_DOWN_URL", "APP_SHORT_URL", "APP_SESSION_URL", "APP_SPARE_URL"))]:
        agnese, ruben = seed_desk(base), seed_desk(base, "ruben")
        assert agnese.name == "Agnese Ferrero" and ruben.name == "Ruben Marchetti"
        clients = {c["name"]: c for c in agnese.j("GET", "/api/clients")["clients"]}
        assert {v[0] for v in SEED_PIECES.values()} == set(clients) and all(c["state"] == "active" for c in clients.values())
        assert [c["name"] for c in ruben.j("GET", "/api/clients")["clients"]] == ["Ivo Kranjc"]
        pieces = {p["title"]: p for p in agnese.j("GET", "/api/pieces")["pieces"]}
        assert set(pieces) == set(SEED_PIECES), f"{base}: {sorted(pieces)}"
        start = date.fromisoformat(pieces["Bentwood armchair"]["dueDate"]) - timedelta(days=14)
        assert abs((turin_today() - start).days) <= 1, "dates are set from the day the copy starts" if base == app_url else True
        for title, (client_name, stamp, state, days) in SEED_PIECES.items():
            piece = pieces[title]
            assert piece["stampNumber"] == stamp and piece["state"] == state and piece["dueDate"] == (start + timedelta(days=days)).isoformat(), piece
            assert piece["clientId"] == clients[client_name]["id"]
            pins = agnese.j("GET", f"/api/pieces/{piece['id']}/pins")["pins"]
            assert [(p["number"], float(p["x"]), float(p["y"]), p["kind"], p["signed"]) for p in pins] == [(1, 20.0, 30.0, "tear", True), (3, 80.0, 30.0, "looseJoint", False), (2, 50.0, 60.0, "stain", True)]
            layout_body = agnese.layout(piece["id"])
            placed = [(p["name"], p["x"], p["y"]) for p in layout_body["pieces"] if p["state"] == "placed"]
            assert layout_body["version"] == 1 and placed == [("Seat", 0, 0)]
            estimates = agnese.j("GET", f"/api/pieces/{piece['id']}/estimates")["estimates"]
            if title in SEED_TOTALS:
                assert estimates[0]["display"]["total"] == SEED_TOTALS[title]
        assert len(agnese.j("GET", "/api/materials")["materials"]) == 12
        assert [r["eur"] for r in ruben.j("GET", "/api/rates")["rates"]] == ["85.00"]
    agnese = seed_desk(app_url)
    pieces = {p["title"]: p for p in agnese.j("GET", "/api/pieces")["pieces"]}
    holds = agnese.j("GET", f"/api/pieces/{pieces['Lounge chair']['id']}/holds")["holds"]
    assert [(h["holdId"], h["code"], h["lot"]) for h in holds] == [("H-6001", "VM-2041", "L-2041-A")]
    assert [h["holdId"] for h in agnese.j("GET", f"/api/pieces/{pieces['Tubular armchair']['id']}/holds")["holds"]] == ["H-6002"]
    bent = pieces["Bentwood armchair"]["id"]
    assert agnese.j("GET", f"/api/pieces/{bent}/estimates")["estimates"][0]["state"] == "signedOff"
    assert agnese.j("GET", f"/api/pieces/{bent}/dossier")["dossier"]["signedBy"] == "Agnese Ferrero"
    assert [p["number"] for p in agnese.j("GET", f"/api/pieces/{bent}/photographs")["photographs"]] == [1, 2]
    start = date.fromisoformat(pieces["Bentwood armchair"]["dueDate"]) - timedelta(days=14)
    monday = start - timedelta(days=start.weekday())
    jobs = {(j["pieceTitle"], j["bench"], j["day"]) for j in agnese.j("GET", "/api/bench-jobs", params={"week": monday.isoformat()})["jobs"]}
    assert jobs == {("Lounge chair", "frame", monday.isoformat()), ("Tubular armchair", "cover", weekday_iso(monday, 2))}
    live, ended = holds[0], agnese.j("GET", f"/api/pieces/{pieces['Tubular armchair']['id']}/holds")["holds"][0]
    assert live["state"] == "held" and live["endsOn"] == (start + timedelta(days=1)).isoformat(), live
    assert ended["state"] == "ended" and ended["endsOn"] == (start - timedelta(days=1)).isoformat(), ended
    assert [(p["title"], p["stampNumber"]) for p in seed_desk(app_url, "ruben").j("GET", "/api/pieces")["pieces"]] == [("Walnut stool", "91283564")]
    change = next_clock_change(TOWNS["New York"], start)
    seeded_days = {c["localDate"] for c in agnese.j("GET", f"/api/pieces/{pieces['Cantilever side chair']['id']}/collections")["collections"]}
    assert seeded_days == {(change - timedelta(days=6)).isoformat(), (change + timedelta(days=1)).isoformat()}, f"the Mondays either side of {change}: {seeded_days}"


APP_ROOT = Path("/app")
ALLOWLIST = {"MIT", "MIT-0", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "MPL-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "OFL-1.1"}


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[key], str) and manifest[key] for key in ("install", "build", "serve"))


def test_if_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"not in the notices: {missing}"
    assert "Jost" in notices


def test_if_licences() -> None:
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not refused, f"licences outside the list: {refused}"


def test_if_no_extra_datastore() -> None:
    banned = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "level", "lowdb", "nedb"}
    assert not banned & {p.name for p in shipped_packages()}
    assert Postgres().tables(), "the desk's data lives in Postgres"


def test_if_no_payment() -> None:
    banned = {"stripe", "@stripe/stripe-js", "paypal-rest-sdk", "@paypal/checkout-server-sdk", "braintree", "square", "razorpay"}
    assert not banned & {p.name for p in shipped_packages()}


def test_if_no_video_files() -> None:
    suffixes = {".mp4", ".webm", ".mov", ".avi", ".mkv", ".m4v", ".ogv"}
    found = []
    for root in (APP_ROOT, Path(DEPLOYED_APP)):
        found += [p for p in root.rglob("*") if p.suffix.lower() in suffixes and "node_modules" not in p.parts]
    assert not found, f"video files ship: {found[:5]}"


def test_if_provider_through_wiremock(app_url: str, wiremock: Any) -> None:
    desk = new_desk(app_url)
    assert desk.j("POST", "/api/materials/refresh", json={})["count"] == 24
    assert len(journal(wiremock, "/v2/materials", "GET")) == 3
