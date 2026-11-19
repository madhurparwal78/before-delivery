from __future__ import annotations

import concurrent.futures
import contextlib
import csv
import json
import os
import re
import time
import urllib.parse
import uuid
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from types import SimpleNamespace
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    Mailpit,
    Ntfy,
    Postgres,
    S3,
    WireMock,
    addresses,
    axe as kit_axe,
    capture,
    center,
    changed,
    click as kit_click,
    decode,
    difference,
    fill as kit_fill,
    held,
    layout,
    licence_allowed,
    pdf_pages,
    pdf_text,
    same_origin,
    select as kit_select,
    session,
    shipped_packages,
    tap as kit_tap,
    text,
    unique,
)

UK = ZoneInfo("Europe/London")
HTTP_TIMEOUT = 40
WAIT_SECONDS = 20
REFRESH_MS = 5000
DEBOUNCE_MS = 300
ALLOWED_MS = {160, 320, 640}
TOUCH_TARGET = 44
JSON_LIMIT = 100_000
STATEMENT_LIMIT = 2_000_000
PASSENGER_LIMIT = 1_000_000
SHEET_LIMIT = 2_000_000
PAPER_LIMIT = 5_000_000
MULTIPART_LIMIT = 5_100_000
SEARCH_CAP = 200
DEPTH_CAP = 16
PAGE_SIZE = 25
PHONE = (375, 812)
WIDE = (1280, 800)
LANDSCAPE = (812, 375)
SMALL = (320, 568)
A4_WIDTH = 794
A4_HEIGHT = 1123
PRESS_WAIT_S = 15
PICK_WAIT_S = 10
ENTRANCE_WAIT_S = 10
ACTION_TIMEOUT_MS = 5000
NAVIGATION_TIMEOUT_MS = 15000
LOAD_WAIT_MS = 8000
HOLD_RATE = 0.001
SLOW_RATE = 0.05
RING_DIFF = 0.5
RING_BAND = 8
RING_STOPS = 6
TRAP_PRESSES = 20
OUTLINE_BAND = 5
MARK_DIFF = 0.01
HOLD_OPEN_MS = 800
FRAME_WAIT_MS = 120
STILL_GAP_MS = 300
STILL_WAIT_S = 10
MID_TOLERANCE_PX = 12
MOVING_SCREEN = (PlaywrightError, ValueError, IndexError, KeyError, AttributeError, TypeError)
GONE_MS = 1000
MARKS_STILL_MS = 7000
SEND_MS = 20000
SEND_TOLERANCE_S = 10
DEBOUNCE_FLOOR_MS = 200
BOTH = (PHONE, WIDE)
PASSWORD = "at-least-8-characters"
MARIA = ("maria@merrowfield.example", "Merrowfield-Desk-2027")
TOMASZ = ("tomasz@zielinski-hire.example", "Zielinski-Desk-2027")
FOREIGN = "http://foreign.example"
ALPHA_NAME = "Secret Alpha Customer"
JACK_RENAMED = "Jack Renamed"
SHEET_ORIGINAL = "Original Name"
SHEET_NOTE = "Filled note"
TYPED_FROM = "12 Mill Lane, Coventry"
TYPED_FROM_NEXT = "14 Mill Lane, Coventry"
TYPED_TO = "4 Station Road, Rugby"
TYPED_DETAILS = "Stop at the leisure centre"
KEPT_TEXT = "Kept through a refresh"
DRAFT_NAME = "Draft Customer Name"
WRONG_NAME = "Someone Else"
NEW_HIGHER_DEPOSIT = "200.00"
OFF_STEP_MARGIN = "12.3"
OLD_SEARCH = "Alder"
RTL = "rtl"
FROM_LINE = 2
COVENTRY = "Coventry station, Coventry CV1 2GT"
NEC = "NEC, Birmingham B40 1NT"
PDF_BYTES = b"%PDF-1.4\n% wayticket verifier paper\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + b"verifier"
JPEG_BYTES = b"\xff\xd8\xff\xe0" + b"verifier"
REFERENCE = re.compile(r"^CV-[0-9A-HJKMNP-TV-Z]{5}$")
INSTANT = re.compile(r"^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$")
ENDED_SESSION = "Your session ended. Sign in again to keep going — what you typed is still here."
REFRESH_LINE = "Couldn't refresh. Trying again."
ALLOWLIST = {"MIT", "MIT-0", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "MPL-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0"}

DIRECTORY_ROWS = [
    ("Hanley Motor Services", "Coventry", [16, 49, 70]),
    ("Arden Vale Coaches", "Solihull", [31, 49]),
    ("Nuneaton Road Travel", "Nuneaton", [8, 12, 16]),
    ("Rugby Town Minibuses", "Rugby", [8, 12]),
    ("Leam Valley Executive Travel", "Leamington Spa", [49, 56]),
    ("Tame Bridge Coachworks", "Tamworth", [31, 49, 70]),
    ("Walsall Lock Coaches", "Walsall", [16, 49]),
    ("Dudley Castle Travel", "Dudley", [12, 16, 31]),
    ("Redditch Needle Coaches", "Redditch", [49, 56, 70]),
    ("Stafford Shire Passenger Services", "Stafford", [31, 56]),
    ("Hinckley Boot Travel", "Hinckley", [8, 16]),
    ("Kenilworth Keep Coaches", "Kenilworth", [49, 70]),
    ("Warwick Bear Minibuses", "Warwick", [8, 12, 16]),
    ("Lichfield Spire Coaches", "Lichfield", [31, 49]),
    ("Telford Gorge Travel", "Telford", [16, 49, 56]),
    ("Worcester Sauce Bottle Tours", "Worcester", [12, 31]),
    ("Burton Brewery Coaches", "Burton upon Trent", [49, 70]),
    ("Stourbridge Glass Travel", "Stourbridge", [8, 12]),
    ("Sutton Park Coachlines", "Sutton Coldfield", [31, 49, 56]),
    ("Bromsgrove Nail Works Minibuses", "Bromsgrove", [16]),
    ("Atherstone Ball Game Coaches", "Atherstone", [49]),
    ("Daventry Mast Travel", "Daventry", [12, 31]),
    ("Kidderminster Carpet Coaches", "Kidderminster", [16, 49]),
    ("Hereford Cider Mill Travel", "Hereford", [56, 70]),
]

RECORDER = """
(() => {
  if (window.__motion) return;
  window.__motion = [];
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
  const note = (a) => {
    if (seen.has(a) || !a.effect || !a.effect.target) return;
    seen.add(a);
    const t = a.effect.getComputedTiming();
    const el = a.effect.target;
    const near = (q) => (el.closest ? el.closest(q) : null);
    const owner = near('[data-part]');
    const r = el.getBoundingClientRect();
    window.__motion.push({
      duration: clean(declared(a, t)), iterations: t.iterations === Infinity ? -1 : t.iterations,
      part: owner ? owner.getAttribute('data-part') : '',
      dialog: !!(near('dialog,[role="dialog"]') || (el.querySelector && el.querySelector('dialog,[role="dialog"]'))),
      box: [r.left, r.top, r.right, r.bottom],
    });
  };
  const native = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = native.apply(this, args); note(a); return a; };
  for (const type of ['transitionrun', 'animationstart']) {
    document.addEventListener(type, (e) => { for (const a of (e.target.getAnimations ? e.target.getAnimations({subtree: true}) : [])) note(a); }, true);
  }
  window.__sweep = () => { for (const a of document.getAnimations()) note(a); return window.__motion; };
})();
"""

SEEK_ENDS = """
root => {
  const all = root.getAnimations({subtree: true});
  const moved = [];
  for (const a of all) {
    const target = a.effect && a.effect.target;
    if (!target) continue;
    const timing = a.effect.getComputedTiming();
    const at = a.currentTime;
    a.pause();
    a.currentTime = 0;
    const start = target.getBoundingClientRect();
    a.currentTime = Number(timing.duration) * 0.999;
    const end = target.getBoundingClientRect();
    a.currentTime = at;
    a.play();
    moved.push({sx: start.left, sy: start.top, ex: end.left, ey: end.top, w: end.width, h: end.height, d: Number(timing.duration)});
  }
  return moved;
}
"""

TARGETS = """
(limit) => {
  const out = [];
  const nodes = document.querySelectorAll('a[href],button,input,select,textarea,summary,[role="button"],[role="link"],[role="menuitem"],[role="radio"],[role="checkbox"],[role="slider"],[role="combobox"],[role="tab"],[role="gridcell"][tabindex]');
  for (const el of nodes) {
    const s = getComputedStyle(el);
    if (!el.checkVisibility({visibilityProperty: true}) || el.type === 'hidden') continue;
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

CLIPPED = """() => { const bad = [];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.textContent.trim()) continue;
    const owner = n.parentElement;
    if (!owner || !owner.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    if (owner.closest('[aria-hidden="true"]')) continue;
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
          if (x && !freeX && (text.right <= b.left + 1 || text.left >= b.right - 1)) break;
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

UNCOVERED = """
() => {
  const a = document.activeElement;
  if (!a || a === document.body) return true;
  const label = a.labels && a.labels.length ? a.labels[0] : null;
  const own = a.getBoundingClientRect();
  const r = (own.width <= 2 || own.height <= 2) && label ? label.getBoundingClientRect() : own;
  const x = Math.min(innerWidth - 1, Math.max(0, r.left + r.width / 2));
  const ys = r.height < innerHeight * 0.6 ? [r.top + 2, r.top + r.height / 2, r.bottom - 2] : [(Math.max(0, r.top) + Math.min(innerHeight, r.bottom)) / 2];
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

LIVE_JS = """() => [...document.querySelectorAll('[role="status"],[role="alert"],[aria-live],output')].map((e) => e.textContent).join(' ')"""

WATCH_JS = """() => { if (window.__said) return; window.__said = [];
  new MutationObserver((records) => { const seen = new Set();
    for (const r of records) { const t = r.target.nodeType === 1 ? r.target : r.target.parentElement; const box = t && t.closest('[role="status"],[role="alert"],[aria-live],output');
      if (box && !seen.has(box)) { seen.add(box); const text = box.textContent.trim(); if (text) window.__said.push(text); } }
  }).observe(document.documentElement, {subtree: true, childList: true, characterData: true}); }"""

ACTIVE_NAME_JS = """() => { const e = document.activeElement; return e ? (e.getAttribute('aria-label') || e.textContent || '').trim() : ''; }"""

ROW_BUTTON_JS = """(e, wanted) => { const name = (b) => (b.getAttribute('aria-label') || b.textContent).trim();
  let n = e; while (n && !n.textContent.includes(wanted)) n = n.parentElement;
  return !!n && [...n.querySelectorAll('button')].filter((b) => name(b) === name(e)).length === 1; }"""

TEXT_BOX_JS = """(wanted) => { const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const owner = n.parentElement;
    if (!n.textContent.includes(wanted) || !owner || owner.closest('[role="status"],[role="alert"],[aria-live]') || !owner.checkVisibility({opacityProperty: true, visibilityProperty: true})) continue;
    const r = owner.getBoundingClientRect();
    if (r.width > 2 && r.height > 2) return {x: r.left, y: r.top, width: r.width, height: r.height};
  }
  return null; }"""

SHOWN_JS = """e => e.checkVisibility({opacityProperty: true, visibilityProperty: true}) && e.getBoundingClientRect().width > 0"""

FADED_JS = """() => [...document.querySelectorAll('h1,h2')].filter((e) => {
  if (!e.getClientRects().length || e.closest('dialog,[role="dialog"],[hidden],[inert],[aria-hidden="true"]')) return false;
  for (let n = e; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return false;
  return !e.checkVisibility({opacityProperty: true, visibilityProperty: true});
}).map((e) => e.textContent.trim().slice(0, 40))"""

SPACING = "*{line-height:1.5!important;letter-spacing:.12em!important;word-spacing:.16em!important} p{margin-bottom:2em!important}"


def advance(page: Page, milliseconds: float) -> None:
    deadline = time.monotonic() + milliseconds / 1000
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            page.evaluate("() => 0")


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
                    locator.evaluate("e => e.scrollIntoView({block: 'center', inline: 'nearest', behavior: 'instant'})", timeout=2000)
    assert refused is not None
    raise refused


def click(locator: Locator) -> None:
    if locator.evaluate("e => e.matches('input[type=radio],input[type=checkbox]')"):
        point = poll(lambda: locator.evaluate(PICK_JS), PICK_WAIT_S, "a hit target for the choice or its label")
        locator.page.mouse.click(point["x"], point["y"])
        return
    pressing(locator, lambda: kit_click(locator))


def tap(locator: Locator) -> None:
    pressing(locator, lambda: kit_tap(locator))


def fill(locator: Locator, value: str) -> None:
    pressing(locator, lambda: kit_fill(locator, value))


def select(locator: Locator, choice: str) -> None:
    pressing(locator, lambda: kit_select(locator, choice))


def loaded(page: Page) -> None:
    with contextlib.suppress(PlaywrightError):
        page.wait_for_load_state("networkidle", timeout=LOAD_WAIT_MS)


def labelled(scope: Any, name: str) -> Locator:
    return scope.get_by_label(re.compile(rf"^\s*{re.escape(name)}(?![a-z0-9-]|\s+[a-z0-9])"))


def listed(page: Page, name: str | None = None) -> Locator:
    box = page.get_by_role("listbox")
    return box.get_by_role("option", name=name, exact=True) if name else box.get_by_role("option")


def active_name(page: Page) -> str:
    return page.evaluate(ACTIVE_NAME_JS)


def text_box(page: Page, wanted: str) -> dict[str, float]:
    return poll(lambda: page.evaluate(TEXT_BOX_JS, wanted), WAIT_SECONDS, f"{wanted!r} shown")


def row_button(page: Page, row_text: str, name: str) -> Locator:
    buttons = page.get_by_role("button", name=name, exact=True)
    def found() -> Locator | None:
        return next((buttons.nth(i) for i in range(buttons.count()) if buttons.nth(i).evaluate(ROW_BUTTON_JS, row_text)), None)
    return poll(found, WAIT_SECONDS, f"{name!r} beside {row_text!r}")


def shown(locator: Locator) -> bool:
    return locator.count() > 0 and any(locator.nth(i).evaluate(SHOWN_JS) for i in range(locator.count()))


def named_frame(page: Page, name: str) -> Locator:
    return page.get_by_label(name, exact=True).first


def past_this_second(base: str) -> None:
    start = server_now(base)
    poll(lambda: server_now(base) > start, 5, "the server's clock moves on")


def next_year(base: str) -> int:
    return today(base).year + 1


def press_until_refused(base: str, path: str, closes: datetime) -> httpx.Response:
    deadline = time.monotonic() + 40
    while time.monotonic() < deadline:
        before = server_now(base)
        r = httpx.put(base + path + "/bid", json={"prices": ["1100"]}, timeout=HTTP_TIMEOUT)
        after = server_now(base)
        if r.status_code != 200:
            assert after > closes, f"a press in the second of closesAt is accepted: refused by {after} against {closes}"
            return r
        assert before <= closes, f"a press in a later second is refused: accepted from {before} against {closes}"
    pytest.fail("PUT /bid stopped being accepted after closesAt")


def sideways(blocks: list[dict[str, Any]]) -> bool:
    return abs(blocks[1]["x"] - blocks[0]["x"]) >= abs(blocks[1]["y"] - blocks[0]["y"])


def block_lengths(blocks: list[dict[str, Any]]) -> list[float]:
    return [b["width"] if sideways(blocks) else b["height"] for b in blocks]


def ring_played(page: Page, link: Locator) -> bool:
    x, y = link.evaluate("e => { const r = e.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; }")
    plays = [m for m in motions(page) if m["duration"] == 640 and m["box"][0] <= x <= m["box"][2] and m["box"][1] <= y <= m["box"][3]]
    return any(m["iterations"] == 3 for m in plays) or len(plays) >= 3


def in_view(locator: Locator, size: tuple[int, int]) -> bool:
    box = locator.bounding_box()
    return box is not None and box["y"] >= 0 and box["y"] + box["height"] <= size[1]


def switch_language(page: Page, choice: str) -> None:
    control = role(page, "combobox", "Language")

    def choose() -> None:
        try:
            kit_select(control, choice)
        except (AssertionError, PlaywrightError):
            if "lang=" not in page.url:
                raise

    pressing(control, choose)


def outage(name: str) -> str:
    return os.environ[name].rstrip("/")


def fresh(prefix: str = "visitor") -> tuple[str, str]:
    first, second = unique(prefix)
    return (second, first) if "@" in first else (first, second)


def fresh_phone() -> str:
    return f"01632 {uuid.uuid4().int % 1000000:06d}"


def topic_of(telephone: str) -> str:
    return "driver-" + re.sub(r"\D", "", telephone)


def long_date(d: date) -> str:
    return f"{d:%a} {d.day} {d:%b} {d.year}"


def typed(d: date) -> str:
    return f"{d:%d/%m/%Y}"


def today(base: str) -> date:
    return date.fromisoformat(httpx.get(base + "/api/public/clock", timeout=HTTP_TIMEOUT).json()["date"])


def server_now(base: str) -> datetime:
    return datetime.strptime(httpx.get(base + "/api/public/clock", timeout=HTTP_TIMEOUT).json()["instant"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def last_sunday(year: int, month: int) -> date:
    d = date(year, month, 31)
    return d - timedelta(days=(d.weekday() + 1) % 7)


def next_change(after: date, month: int) -> date:
    d = last_sunday(after.year, month)
    return d if d > after else last_sunday(after.year + 1, month)


def next_change_any(after: date) -> date:
    return min(next_change(after, 3), next_change(after, 10))


def instant_of(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def utc_text(day: str, at: str) -> str:
    return f"{day}T{at}:00Z"


def money_shown(value: Decimal) -> str:
    return f"£{value:,.2f}"


def selling(bought: str, margin: str) -> Decimal:
    return (Decimal(bought) * (1 + Decimal(margin) / 100)).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP)


def html_attr(tag: str, name: str) -> str | None:
    found = re.search(rf"""\b{name}=["']?([\w-]+)""", tag)
    return found.group(1) if found else None


PART_BOXES = """
(root, name) => [...root.querySelectorAll('[data-part]')].filter(e => e.getAttribute('data-part') === name).map(e => {
  const r = e.getBoundingClientRect();
  return {x: r.left, y: r.top, width: r.width, height: r.height, text: e.textContent};
})
"""


def part_boxes(root: Locator, name: str) -> list[dict[str, Any]]:
    return root.evaluate(PART_BOXES, name)


def ticket_lines(page: Page) -> list[dict[str, Any]]:
    return part_boxes(role(page, "complementary", "Journey ticket"), "ticket-line")


def poll(probe: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        with contextlib.suppress(*MOVING_SCREEN):
            result = probe()
            if result:
                return result
    pytest.fail(f"Within {seconds} s: {what}")


def error_of(r: httpx.Response, status: int, code: str | None = None, message: Any = None) -> dict[str, Any]:
    assert r.status_code == status, f"expected {status}, got {r.status_code}: {r.text[:400]}"
    body = r.json()
    assert list(body) == ["error"], f"one published body: {body}"
    err = body["error"]
    assert isinstance(err.get("code"), str) and isinstance(err.get("message"), str), err
    if code is not None:
        assert err["code"] == code, err
    if isinstance(message, re.Pattern):
        assert message.fullmatch(err["message"]), err
    elif message is not None:
        assert message in json.dumps(err, ensure_ascii=False), err
    return err


def whole_seconds(value: Any) -> None:
    if isinstance(value, dict):
        for item in value.values():
            whole_seconds(item)
    elif isinstance(value, list):
        for item in value:
            whole_seconds(item)
    elif isinstance(value, str) and re.match(r"^\d{4}-\d\d-\d\dT\d\d:\d\d", value):
        assert INSTANT.match(value), f"not a whole-second UTC instant: {value}"


class Desk:
    def __init__(self, base: str, info: dict[str, Any] | None = None, password: str = PASSWORD) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.info = info or {}
        self.password = password
        self.refreshed = False

    def call(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        return self.http.request(method, path, **kwargs)

    def ok(self, method: str, path: str, status: int = 200, **kwargs: Any) -> Any:
        r = self.call(method, path, **kwargs)
        assert r.status_code == status, f"{method} {path}: expected {status}, got {r.status_code}: {r.text[:500]}"
        return r.json() if r.content else None

    def refresh(self) -> list[dict[str, Any]]:
        self.refreshed = True
        return self.ok("POST", "/api/operators/refresh", json={})["operators"]


def new_desk(base: str) -> Desk:
    name, email = fresh("desk")
    desk = Desk(base)
    desk.info = desk.ok("POST", "/api/auth/sign-up", 201, json={"name": name, "email": email, "password": PASSWORD})["desk"]
    return desk


def existing_desk(base: str, who: tuple[str, str]) -> Desk:
    desk = Desk(base, password=who[1])
    desk.info = desk.ok("POST", "/api/auth/sign-in", json={"email": who[0], "password": who[1]})["desk"]
    return desk


def enquiry_body(base: str, email: str | None = None, **overrides: Any) -> dict[str, Any]:
    name, generated = fresh("enquiry")
    out = today(base) + timedelta(days=60)
    body: dict[str, Any] = {
        "occasion": "school", "journeyType": "oneWay",
        "stops": [{"text": COVENTRY, "checked": True}, {"text": NEC, "checked": True}],
        "departAt": {"date": out.isoformat(), "time": "08:00"}, "returnAt": None,
        "party": {"people": 47, "large": 0, "medium": 0, "hand": 10, "wheelchairs": 0},
        "details": None, "name": name, "email": email or generated,
        "telephone": fresh_phone(), "language": "en", "website": "",
    }
    body.update(overrides)
    return body


def make_hire(desk: Desk, *, stage: str = "accepted", vehicles: list[dict[str, Any]] | None = None, seats: int = 49, bought: str = "1006.30",
              margin: str = "15", operator: str = "OP-1001", occasion: str = "company", people: int = 47, depart: dict[str, str] | None = None,
              ret: dict[str, str] | None = None, stops: list[str] | None = None, customer: dict[str, str] | None = None,
              party: dict[str, int] | None = None, sent_at: dict[str, str] | None = None) -> dict[str, Any]:
    if stage != "enquiry" and not desk.refreshed:
        desk.refresh()
    if vehicles is None:
        vehicles = [{"seats": seats}] if stage == "enquiry" else [{"seats": seats, "operatorId": operator, "boughtPrice": bought, "marginPercent": margin}]
    if customer is None:
        name, email = fresh("customer")
        customer = {"name": name, "email": email, "telephone": fresh_phone(), "language": "en"}
    body: dict[str, Any] = {
        "customer": customer, "occasion": occasion, "stops": stops or [COVENTRY, NEC],
        "departAt": depart or {"date": (today(desk.base) + timedelta(days=60)).isoformat(), "time": "08:00"},
        "returnAt": ret, "party": party or {"people": people, "large": 0, "medium": 0, "hand": 0, "wheelchairs": 0},
        "vehicles": vehicles, "stage": stage,
    }
    if sent_at:
        body["quoteSentAt"] = sent_at
    made = desk.ok("POST", "/api/hires", 201, json=body)
    made["customerBody"] = customer
    return made


def upload(desk: Desk, operator: str, kind: str, ends: str, data: bytes = PDF_BYTES, filename: str = "paper.pdf", ctype: str = "application/pdf") -> httpx.Response:
    return desk.call("POST", f"/api/operators/{operator}/papers", data={"kind": kind, "endsOn": ends}, files={"file": (filename, data, ctype)})


def make_clear(desk: Desk, *operators: str) -> None:
    ends = (today(desk.base) + timedelta(days=500)).isoformat()
    for operator in operators:
        for kind in ("operatorLicence", "publicLiabilityCover"):
            assert upload(desk, operator, kind, ends).status_code == 201


def ask(desk: Desk, enquiry: str, *operators: str) -> dict[str, dict[str, Any]]:
    asks = desk.ok("POST", f"/api/enquiries/{enquiry}/bids/ask", 201, json={"operatorIds": list(operators)})["asks"]
    return {a["operatorId"]: a for a in asks}


def statement(*rows: str) -> bytes:
    return ("\n".join(["Date,Description,Amount,Balance", *rows]) + "\n").encode()


def preview(desk: Desk, data: bytes) -> httpx.Response:
    return desk.call("POST", "/api/payments/statements/preview", content=data, headers={"content-type": "text/csv"})


def bring_in(desk: Desk, data: bytes) -> dict[str, Any]:
    r = preview(desk, data)
    assert r.status_code == 200, r.text[:400]
    return desk.ok("POST", f"/api/payments/statements/{r.json()['previewId']}/bring-in", json={})


def pay(desk: Desk, reference: str, amount: str) -> dict[str, Any]:
    return bring_in(desk, statement(f"03/04/2027,PAY {reference} {uuid.uuid4().hex[:6]}x,{amount},{amount}"))


def run_id(hire: dict[str, Any]) -> str:
    return hire["runs"][0]["id"]


def api_path(path: str) -> str:
    return "/api" + urllib.parse.urlsplit(path).path


def page_path(path: str) -> str:
    return urllib.parse.urlsplit(path).path


def mails(mail: Mailpit, *, to: str | None = None, subject: str | None = None, count: int = 0, seconds: float = 20) -> list[dict[str, Any]]:
    def found() -> list[dict[str, Any]]:
        out = []
        for m in mail.messages():
            if to is not None and to not in addresses(m.get("To")):
                continue
            if subject is not None and subject != m.get("Subject"):
                continue
            out.append(m)
        return out
    deadline = time.monotonic() + seconds
    current = found()
    while len(current) < count and time.monotonic() < deadline:
        current = found()
    return current


def role(page: Page | Locator, kind: str, name: Any) -> Locator:
    return page.get_by_role(kind, name=name, exact=True) if isinstance(name, str) else page.get_by_role(kind, name=name)


def visible(locator: Locator) -> Locator:
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        for i in range(locator.count()):
            if locator.nth(i).is_visible():
                return locator.nth(i)
        advance(locator.page, 100)
    return locator.first


def soon(page: Page, probe: Callable[[], Any], what: str, seconds: float = WAIT_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        advance(page, 100)
        with contextlib.suppress(*MOVING_SCREEN):
            if probe():
                return
    pytest.fail(f"Within {seconds} s the screen should show: {what}")


def region_text(page: Page) -> str:
    return page.evaluate(LIVE_JS)


def said(page: Page, message: Any, seconds: float = WAIT_SECONDS) -> None:
    def probe() -> bool:
        current = region_text(page)
        return bool(message.search(current)) if isinstance(message, re.Pattern) else message in current
    soon(page, probe, f"Announcements says {message!r}", seconds)


def body_text(page: Page) -> str:
    return page.locator("body").inner_text()


def shows(page: Page, message: str, seconds: float = WAIT_SECONDS) -> None:
    soon(page, lambda: message in body_text(page), f"text {message!r}", seconds)


def h1(page: Page, name: Any) -> Locator:
    return page.get_by_role("heading", level=1, name=name, exact=True) if isinstance(name, str) else page.get_by_role("heading", level=1, name=name)


def focus_on_h1(page: Page) -> bool:
    return page.evaluate("document.activeElement && document.activeElement.tagName === 'H1'")


def record_motion(page: Page) -> None:
    page.evaluate("() => { " + RECORDER + " }")


def motions(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__sweep ? window.__sweep() : []")


def assert_published_motion(page: Page) -> None:
    for m in motions(page):
        if m["duration"] >= 1:
            assert m["duration"] in ALLOWED_MS, f"unpublished duration: {m}"
        assert m["iterations"] != -1, f"a motion loops forever: {m}"


def slow_animations(page: Page, rate: float = 0.05) -> Any:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": rate})
    return cdp


def touch_drag(page: Page, start: tuple[float, float], end: tuple[float, float]) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1]}]})
    for i in range(1, 7):
        x = start[0] + (end[0] - start[0]) * i / 6
        y = start[1] + (end[1] - start[1]) * i / 6
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
        advance(page, 20)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    advance(page, 100)


def mouse_drag(page: Page, start: tuple[float, float], end: tuple[float, float], *, escape: bool = False) -> None:
    page.mouse.move(*start)
    page.mouse.down()
    for i in range(1, 7):
        page.mouse.move(start[0] + (end[0] - start[0]) * i / 6, start[1] + (end[1] - start[1]) * i / 6)
        advance(page, 20)
    if escape:
        page.keyboard.press("Escape")
    page.mouse.up()
    advance(page, 100)


@contextmanager
def screen(browser: Browser, base: str, path: str | None, *, size: tuple[int, int] = WIDE, desk: Desk | None = None, reduced: bool = False, workers: bool = False) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": size[0], "height": size[1]}, has_touch=True, reduced_motion="reduce" if reduced else "no-preference", service_workers="allow" if workers else "block")
    try:
        context.add_init_script(RECORDER)
        if desk:
            context.add_cookies([{"name": c.name, "value": c.value, "url": base} for c in desk.http.cookies.jar])
        page = context.new_page()
        page.set_default_timeout(ACTION_TIMEOUT_MS)
        page.set_default_navigation_timeout(NAVIGATION_TIMEOUT_MS)
        if path is not None:
            page.goto(base + path)
            loaded(page)
        yield page
    finally:
        context.close()


@contextmanager
def open_app(browser: Browser, url: str) -> Iterator[Page]:
    parts = urllib.parse.urlsplit(url)
    path = parts.path + (f"?{parts.query}" if parts.query else "")
    with screen(browser, f"{parts.scheme}://{parts.netloc}", path) as page:
        yield page


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


def entrance(page: Page, act: Callable[[], Any], target: Locator) -> dict[str, Any]:
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    try:
        act()
        expect(target).to_be_attached()
        poll(lambda: target.evaluate(ANIMATED_JS), ENTRANCE_WAIT_S, "the opening runs as a browser animation")
        motions(page)
        return target.evaluate(ENTRANCE_JS)
    finally:
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})


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
    soon(page, lambda: difference(before, picture(clip)) > MARK_DIFF, "SR18: under forced colours this state shows by a mark that is not a background colour", seconds=STILL_WAIT_S)
    page.emulate_media(forced_colors="none")


def assert_touch_targets(page: Page) -> None:
    small = page.evaluate(TARGETS, TOUCH_TARGET)
    assert not small, f"SR4: touch areas under {TOUCH_TARGET} px: {small}"


def no_cut_text(page: Page) -> None:
    cut = page.evaluate(CLIPPED)
    assert not cut, f"SR16: text cut off: {cut}"


def spaced(page: Page) -> None:
    page.evaluate("(css) => { const sheet = new CSSStyleSheet(); sheet.replaceSync(css); document.adoptedStyleSheets = [...document.adoptedStyleSheets, sheet]; }", SPACING)


def main_control(page: Page, name: Any) -> Locator:
    buttons = role(page, "button", name)
    return visible(buttons) if buttons.count() else visible(role(page, "link", name))


def fixed_bottom(page: Page, name: Any, size: tuple[int, int]) -> None:
    placed = main_control(page, name).evaluate("el => { for (let n = el; n && n !== document.body; n = n.parentElement) { const p = getComputedStyle(n).position; if (p === 'fixed' || p === 'sticky') return n.getBoundingClientRect().bottom; } return null; }")
    assert placed is not None, f"SR6: {name} is not in a fixed bar"
    assert size[1] - 2 <= placed <= size[1] + 2, f"SR6: the bar's bottom sits at {placed}"


def print_only_content(page: Page, heading: Any, main: Any) -> None:
    page.set_viewport_size({"width": A4_WIDTH, "height": A4_HEIGHT})
    page.emulate_media(media="print")
    try:
        expect(h1(page, heading)).to_be_visible()
        for found in (role(page, "navigation", "Desk"), role(page, "navigation", "Main"), role(page, "button", "Sign out"), *([role(page, "button", main)] if main else [])):
            assert found.count() == 0 or not found.first.is_visible(), f"SR26: {found} prints"
        printed = page.evaluate("() => [...document.querySelectorAll('[role=\"status\"],[role=\"alert\"],[aria-live],output')].filter((e) => e.textContent.trim() && e.checkVisibility() && e.getBoundingClientRect().width > 2).map((e) => e.textContent.trim().slice(0, 40))")
        assert not printed, f"SR26: a live region prints: {printed}"
        assert page.evaluate("() => document.documentElement.scrollWidth <= innerWidth + 1"), "SR26: something runs past an A4 page's width"
    finally:
        page.emulate_media(media="screen")
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})


def images_hold_still(browser: Browser, base: str, path: str, owner: Desk | None, heading: Any) -> None:
    held_images: list[Any] = []
    def hold(route: Any) -> None:
        if route.request.resource_type == "image":
            held_images.append(route)
        else:
            route.fallback()
    boxes = "() => [...document.querySelectorAll('h1,h2,button,a')].map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y + scrollY)]; })"
    with screen(browser, base, None, desk=owner) as page:
        page.route("**/*", hold)
        page.goto(base + path, wait_until="domcontentloaded")
        expect(h1(page, heading)).to_be_visible()
        def settled_boxes() -> Any:
            first = page.evaluate(boxes)
            advance(page, STILL_GAP_MS)
            return first == page.evaluate(boxes)
        poll(settled_boxes, STILL_WAIT_S, "the screen settling with its pictures held")
        before = page.evaluate(boxes)
        for call in held_images:
            call.fallback()
        page.unroute("**/*", hold)
        with contextlib.suppress(PlaywrightError):
            page.wait_for_load_state("load", timeout=LOAD_WAIT_MS)
        advance(page, STILL_GAP_MS)
        after = page.evaluate(boxes)
    assert len(before) != len(after) or all(abs(a[0] - b[0]) <= 1 and abs(a[1] - b[1]) <= 1 for a, b in zip(before, after)), "SR25: something moved when a held picture loaded"


def foreign_text(browser: Browser, base: str, path: str, owner: Desk | None) -> tuple[str, str]:
    out = []
    for foreign in (False, True):
        options: dict[str, Any] = {"viewport": {"width": WIDE[0], "height": WIDE[1]}, "service_workers": "block", "locale": "de-DE" if foreign else "en-GB", "timezone_id": "Pacific/Auckland" if foreign else "Europe/London"}
        context = browser.new_context(**options)
        try:
            if foreign:
                context.clock.install(time=server_now(base) + timedelta(days=3))
            if owner:
                context.add_cookies([{"name": c.name, "value": c.value, "url": base} for c in owner.http.cookies.jar])
            page = context.new_page()
            page.goto(base + path)
            loaded(page)
            expect(page.get_by_role("heading", level=1)).to_be_visible()
            page.evaluate(FINISH_JS)
            out.append(re.sub(r"\s+", " ", page.evaluate("() => document.body.innerText")))
        finally:
            context.close()
    return out[0], out[1]


def sweep(browser: Browser, base: str, path: str, owner: Desk | None, heading: Any, title: str, main: Any, prints: bool) -> None:
    with screen(browser, base, path, size=PHONE, desk=owner) as page:
        expect(h1(page, heading)).to_be_visible()
        expect(page).to_have_title(title)
        assert_touch_targets(page)
        axe(page)
        no_cut_text(page)
        if main:
            fixed_bottom(page, main, PHONE)
        for _ in range(RING_STOPS):
            page.keyboard.press("Tab")
            soon(page, lambda: page.evaluate(UNCOVERED), "SR6: the focused control is in view and uncovered", seconds=3)
        spaced(page)
        no_cut_text(page)
        layout(page)
    with screen(browser, base, path, desk=owner) as page:
        expect(h1(page, heading)).to_be_visible()
        axe(page)
        no_cut_text(page)
        if prints:
            print_only_content(page, heading, main)
    with screen(browser, base, path, size=SMALL, desk=owner) as page:
        expect(h1(page, heading)).to_be_visible()
        layout(page)
    plain, far = foreign_text(browser, base, path, owner)
    assert plain == far, f"SR14 on {path}"
    images_hold_still(browser, base, path, owner, heading)


ROUTE_CASES = {
    "home": ("/", "Coaches and minibuses with a driver", "Coach and minibus hire from Coventry | Merrowfield Coach Hire", None, False, False),
    "school": ("/occasions/school", "School trips", "School trips | Merrowfield Coach Hire", None, False, False),
    "fleet": ("/fleet", "Our fleet", "Our fleet | Merrowfield Coach Hire", None, False, False),
    "terms": ("/terms", "Terms", "Terms | Merrowfield Coach Hire", None, False, False),
    "quote_route": ("/quote/route", "Route", "Route | Get a free quote", "Next", False, False),
    "enquiries": ("/enquiries", "Enquiries", None, "Add enquiry", False, True),
    "enquiry": ("/enquiries/{ref}", "Enquiry {ref}", None, "Plan this trip", False, True),
    "trip": ("/enquiries/{ref}/trip", "Trip plan {ref}", None, "Save plan", False, True),
    "bids": ("/enquiries/{bid}/bids", "Operator bids {bid}", None, "Ask operators", False, True),
    "quote": ("/hires/{quoted}/quote", "Quote {quoted}", None, "Send quote", True, True),
    "hours": ("/hires/{ref}/hours?run={run}", "Drivers' hours {ref}", None, "Confirm run", False, True),
    "seats": ("/hires/{ref}/seats", "Seat plan {ref}", None, "Add passengers", True, True),
    "changes": ("/hires/{ref}/changes", "Changes {ref}", None, "Change booking", False, True),
    "operators": ("/operators", "Operators", None, "Refresh directory", False, True),
    "payments": ("/payments", "Payments", None, "Bring in statement", False, True),
    "diary": ("/diary", "Diary", None, "Later week", False, True),
    "documents": ("/documents", "Documents", None, "Make document", False, True),
    "rates": ("/rates", "Rate tables", None, "Add rate table", False, True),
    "customers": ("/customers", "Customers", None, "Add customer", False, True),
    "complaints": ("/aftercare/complaints", "Complaints", None, "Log complaint", False, True),
    "lost": ("/aftercare/lost-property", "Lost property", None, "Log found item", False, True),
    "q": ("{q}", "Your quote {quoted}", "Your quote {quoted}", "Accept", True, False),
    "q_pl": ("{q}?lang=pl", "Twoja wycena {quoted}", "Twoja wycena {quoted}", "Akceptuję", True, False),
    "q_ur": ("{q}?lang=ur", "آپ کا کوٹیشن {quoted}", "آپ کا کوٹیشن {quoted}", "قبول کریں", False, False),
    "b": ("{b}", "Price this hire", "Price this hire", "Send price", False, False),
    "r": ("{r}", "Run {n}", "Run {n}", None, True, False),
    "r_pl": ("{r}?lang=pl", "Kurs {n}", "Kurs {n}", None, False, False),
}


def sweep_world(base: str, keys: set[str]) -> SimpleNamespace:
    desk = new_desk(base)
    name = "N" * 72 + uuid.uuid4().hex[:8].upper()
    customer = {"name": name, "email": fresh()[1], "telephone": fresh_phone(), "language": "en"}
    day = today(base) + timedelta(days=60)
    hire = make_hire(desk, occasion="school", customer=customer, depart={"date": day.isoformat(), "time": "08:00"})
    quoted = make_hire(desk, stage="quoted", customer=customer)
    bid = make_hire(desk, stage="enquiry", customer=customer)
    run = hire["runs"][0]
    fields = {"ref": hire["id"], "quoted": quoted["id"], "bid": bid["id"], "run": run["id"], "n": run["number"], "q": page_path(quoted["quotePath"]), "r": page_path(run["sheetPath"])}
    if keys & {"bids", "b"}:
        asks = ask(desk, bid["id"], "OP-1001", "OP-1002")
        assert httpx.put(base + api_path(asks["OP-1001"]["bidPath"]) + "/bid", json={"prices": ["1000"]}, timeout=HTTP_TIMEOUT).status_code == 200
        fields["b"] = page_path(asks["OP-1002"]["bidPath"])
    if "seats" in keys:
        desk.ok("POST", f"/api/hires/{hire['id']}/passengers", 201, json={"name": name, "group": "Adult", "needs": ""})
    if keys & {"diary", "hours"}:
        desk.ok("PUT", f"/api/runs/{run_id(hire)}/driver", json={"name": name, "telephone": fresh_phone()})
    if "documents" in keys:
        desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "invoice"})
    if "complaints" in keys:
        desk.ok("POST", "/api/complaints", 201, json={"customerId": hire["customerId"], "summary": name, "receivedAt": {"date": "2027-03-25", "time": "10:00"}})
    if "lost" in keys:
        desk.ok("POST", "/api/lost-property", 201, json={"description": name, "foundOn": "2027-01-31"})
    if "payments" in keys:
        pay(desk, hire["id"], "175.00")
    return SimpleNamespace(desk=desk, fields=fields)


def sweep_routes(browser: Browser, base: str, *keys: str) -> None:
    world = sweep_world(base, set(keys))
    for key in keys:
        path, heading, title, main, prints, signed_in = ROUTE_CASES[key]
        shown_heading = heading.format(**world.fields)
        sweep(browser, base, path.format(**world.fields), world.desk if signed_in else None, shown_heading, title.format(**world.fields) if title else f"{shown_heading} | Wayticket", main, prints)


def ladder_holds(base: str, endpoint: str, limit: int, ctype: str, method: str = "POST") -> None:
    r = httpx.request(method, base + endpoint, content=b" " * (limit + 1), headers={"content-type": ctype}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 413, f"{method} {endpoint}: oversized with no session is refused by size first: {r.status_code}"
    error_of(r, 413)
    assert "json" in r.headers.get("content-type", "")
    r = httpx.request(method, base + endpoint, content=b"{}", headers={"content-type": "application/json", "origin": FOREIGN}, timeout=HTTP_TIMEOUT)
    error_of(r, 403)
    name, email = fresh("cookie")
    r = httpx.post(base + "/api/auth/sign-up", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    cookie = r.headers.get("set-cookie", "").partition(";")[2].lower()
    assert "httponly" in cookie and "samesite=lax" in cookie, cookie
    assert "secure" not in cookie and "max-age" not in cookie and "expires" not in cookie, cookie


def focus_ring(page: Page) -> bool:
    if not page.evaluate("() => document.activeElement && document.activeElement !== document.body"):
        return False
    box = page.evaluate_handle("() => document.activeElement").as_element().evaluate(BOX_JS)
    view = page.viewport_size
    x0, y0 = max(0, box["x"] - RING_BAND), max(0, box["y"] - RING_BAND)
    clip = {"x": x0, "y": y0, "width": min(view["width"], box["x"] + box["width"] + RING_BAND) - x0, "height": min(view["height"], box["y"] + box["height"] + RING_BAND) - y0}
    if clip["width"] < 1 or clip["height"] < 1:
        return False
    page.mouse.move(1, 1)
    shown_ring = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => { window.__ringFocus = document.activeElement; window.__ringFocus.blur(); }")
    hidden_ring = decode(page.screenshot(clip=clip, scale="css", animations="disabled"))
    page.evaluate("() => window.__ringFocus.focus()")
    return difference(shown_ring, hidden_ring) > RING_DIFF


def named_region(page: Page) -> None:
    expect(role(page, "region", "Announcements")).to_have_count(1)


def listen(page: Page) -> None:
    page.evaluate(WATCH_JS)


def spoken_list(page: Page) -> list[str]:
    return [re.sub("[\u200b-\u200d\u2060\ufeff]", "", spoken) for spoken in page.evaluate("() => window.__said")]


def announced_twice(page: Page, act: Callable[[], Any], copy: Any) -> None:
    def heard() -> bool:
        return any(copy in spoken if isinstance(copy, str) else copy.search(spoken) for spoken in spoken_list(page))
    listen(page)
    page.evaluate("() => { window.__said.length = 0; }")
    act()
    soon(page, heard, f"{copy!r} announced")
    page.evaluate("() => { window.__said.length = 0; }")
    act()
    soon(page, heard, f"SR19: {copy!r} announced a second time")


def check_dialog(page: Page, opener: Locator, name: Any, size: tuple[int, int], draft: tuple[str, str] | None, shape: str, live: bool, change: Callable[[], str] | None) -> None:
    dialog = role(page, "dialog", name)
    page.evaluate("() => { window.__motion.length = 0; }")
    def press_opener() -> None:
        opener.focus()
        page.keyboard.press("Enter")
    opened = entrance(page, press_opener, dialog)
    soon(page, lambda: dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: opening moves focus inside")
    assert_published_motion(page)
    assert any(m["duration"] == 320 for m in motions(page)), f"SR24: the opening takes 320 ms; recorded {motions(page)}"
    start, end = opened["start"], opened["end"]
    if shape == "sheet" and size[0] < 768:
        assert start["top"] > end["top"], f"SR24: a sheet rises from the bottom at 375: {opened}"
    elif shape == "sheet":
        assert start["left"] > end["left"], f"SR24: a sheet slides from the right from 768: {opened}"
    elif shape == "dialog" and size[0] >= 1024:
        centre = abs((start["left"] + start["width"] / 2) - (end["left"] + end["width"] / 2))
        assert start["width"] < end["width"] and centre <= MID_TOLERANCE_PX, f"SR24: a dialog grows from its centre: {opened}"
    named_region(page)
    assert role(page, "region", "Announcements").evaluate("e => !e.closest('[inert],[aria-hidden=\"true\"]')"), "SR28: Announcements is left out of whatever hides the page"
    for number in range(TRAP_PRESSES):
        page.keyboard.press("Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: Tab stays inside"
        if number < RING_STOPS:
            assert focus_ring(page), "SR8: every Tab stop shows a ring"
    for _ in range(TRAP_PRESSES):
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: Shift+Tab stays inside"
    axe(page)
    if live:
        field = role(dialog, draft[0], draft[1]) if draft else None
        if field is not None:
            field.fill(KEPT_TEXT)
            field.focus()
        page.evaluate("() => { window.__keptFocus = document.activeElement; }")
        dialog.evaluate("d => { d.__kept = 1; }")
        advance(page, STILL_GAP_MS)
        page.evaluate("() => { window.__motion.length = 0; }")
        reads: list[str] = []
        def note(request: Any) -> None:
            if request.method == "GET" and request.resource_type in ("fetch", "xhr"):
                reads.append(request.url)
        page.on("request", note)
        expected = change() if change else None
        soon(page, lambda: reads, "SR1: the screen re-reads from the server every 5 seconds", REFRESH_MS / 1000 + 3)
        if expected:
            soon(page, lambda: expected in body_text(page), "SR1: a change reaches the screen behind", REFRESH_MS / 1000 + 3)
        advance(page, STILL_GAP_MS)
        page.remove_listener("request", note)
        assert dialog.evaluate("d => d.__kept === 1"), "SR1: a refresh keeps the same dialog element"
        if field is not None:
            expect(field).to_have_value(KEPT_TEXT)
        assert page.evaluate("() => window.__keptFocus === document.activeElement"), "SR1: focus stays through a refresh"
        assert not [m for m in motions(page) if m["dialog"]], "SR1: a refresh does not replay the opening"
        line = page.locator('[data-part="refresh-line"]')

        def refresh_line_shown() -> bool:
            return any(line.nth(i).is_visible() and REFRESH_LINE in (line.nth(i).text_content() or "") for i in range(line.count()))

        page.context.set_offline(True)
        soon(page, refresh_line_shown, "SR20: the refresh line shows", REFRESH_MS / 1000 + 3)
        assert page.evaluate("() => window.__keptFocus === document.activeElement"), "SR20: focus stays through a failed refresh"
        page.context.set_offline(False)
        soon(page, lambda: not refresh_line_shown(), "SR20: the next good refresh clears the line", REFRESH_MS / 1000 + 3)
    handle = dialog.element_handle()
    cdp = session(page)
    cdp.send("Animation.enable")
    cdp.send("Animation.setPlaybackRate", {"playbackRate": SLOW_RATE})
    try:
        escape_panel(page, dialog)
        expect(opener).to_be_focused()
        advance(page, FRAME_WAIT_MS)
        mid = handle.evaluate(MIDWAY_JS)
        cdp.send("Animation.setPlaybackRate", {"playbackRate": HOLD_RATE})
        page.keyboard.press("Enter")
        soon(page, lambda: dialog.count() > 0, "SR2: pressing the opener during the close opens it again")
        now = dialog.evaluate(RECT_JS)
    finally:
        cdp.send("Animation.setPlaybackRate", {"playbackRate": 1})
    if mid is not None:
        assert all(abs(now[key] - mid[key]) <= MID_TOLERANCE_PX for key in ("left", "top", "width", "height")), f"SR27: a reopened dialog carries on from {mid}; it read {now}"
    page.evaluate(FINISH_JS)
    advance(page, HOLD_OPEN_MS)
    assert dialog.count() == 1 and dialog.is_visible(), "SR2: no leftover close timer undoes the reopening"
    soon(page, lambda: dialog.evaluate("d => d.contains(document.activeElement)"), "SR8: focus inside on every opening")
    dialog.evaluate("d => { window.__closing = d; }")
    escape_panel(page, dialog)
    expect(opener).to_be_focused()
    for _ in range(2):
        page.keyboard.press("Tab")
        assert not page.evaluate("() => window.__closing.contains(document.activeElement)"), "SR9: a closing panel is still in the Tab order"
    soon(page, lambda: dialog.count() == 0, "SR9: a closed dialog leaves the accessibility tree")
    axe(page)


def meets_screen_rules(browser: Browser, base: str, path: str, opener: Any, dialog: Any, *, desk: Desk | None = None, main: Any = None,
                       sizes: tuple[tuple[int, int], ...] = BOTH, typed_into: tuple[str, str] | None = None, prepare: Callable[[Page], None] | None = None,
                       endpoint: str | None = None, limit: int = JSON_LIMIT, ctype: str = "application/json", read: Any = None, refresh_line: bool = True,
                       method: str = "POST", shape: str = "dialog", change: Callable[[], str] | None = None, landscape: bool = True) -> None:
    if endpoint:
        ladder_holds(base, endpoint, limit, ctype, method)
    if read is not None:
        whole_seconds(read)
    def arrive(page: Page) -> Locator:
        if prepare:
            prepare(page)
        soon(page, lambda: h1(page, re.compile(".")).count() == 1, "one level-one heading")
        return visible(role(page, "button", opener))
    for size in sizes:
        with screen(browser, base, path, size=size, desk=desk) as page:
            control = arrive(page)
            layout(page)
            axe(page)
            named_region(page)
            if size[0] < 768:
                assert_touch_targets(page)
                if main is not None:
                    fixed_bottom(page, main, size)
                tap(control)
                box = role(page, "dialog", dialog)
                soon(page, lambda: box.count() == 1 and box.is_visible(), f"dialog {dialog} by touch")
                page.evaluate(FINISH_JS)
                escape_panel(page, box)
                soon(page, lambda: box.count() == 0, "the dialog closes after touch")
            check_dialog(page, control, dialog, size, typed_into, shape, refresh_line, change if size == sizes[0] else None)
            assert_published_motion(page)
            page.emulate_media(forced_colors="active")
            control.focus()
            page.keyboard.press("Shift+Tab")
            page.keyboard.press("Tab")
            assert focus_ring(page), "SR18: a Tab stop shows a ring with forced colours on"
            page.emulate_media(forced_colors="none")
            page.evaluate(FINISH_JS)
            page.emulate_media(reduced_motion="reduce")
            page.evaluate("() => { window.__motion.length = 0; }")
            box = role(page, "dialog", dialog)
            control.focus()
            page.keyboard.press("Enter")
            soon(page, lambda: box.count() > 0, "the dialog opens under reduced motion")
            escape_panel(page, box)
            expect(box).to_have_count(0, timeout=GONE_MS)
            assert [m for m in motions(page) if m["duration"] >= 1] == [], "SR23: reduced motion applies with no reload"
            page.emulate_media(reduced_motion="no-preference")
    with screen(browser, base, path, size=sizes[0], desk=desk, reduced=True) as page:
        control = arrive(page)
        control.focus()
        page.keyboard.press("Enter")
        box = role(page, "dialog", dialog)
        expect(box).to_be_visible()
        escape_panel(page, box)
        expect(box).to_have_count(0, timeout=GONE_MS)
        assert [m for m in motions(page) if m["duration"] >= 1] == [], "SR3: no motion under reduced motion"
    if not landscape:
        return
    with screen(browser, base, path, size=LANDSCAPE, desk=desk) as page:
        control = arrive(page)
        control.focus()
        page.keyboard.press("Enter")
        box = role(page, "dialog", dialog)
        soon(page, lambda: box.count() > 0, "the dialog opens at 812x375")
        page.evaluate(FINISH_JS)
        for _ in range(TRAP_PRESSES):
            page.keyboard.press("Tab")
            soon(page, lambda: page.evaluate(UNCOVERED), "SR17: the focused control is in view and not covered", seconds=3)
        layout(page)


def wait_working(page: Page, button: Locator, glob: str, own_name: str) -> None:
    sent: list[str] = []
    def note(request: Any) -> None:
        if request.method != "GET" and "/api/" in request.url:
            sent.append(request.url)
    page.on("request", note)
    with held(page, glob) as gate:
        button.focus()
        page.keyboard.press("Enter")
        busy = role(page, "button", "Working…")
        soon(page, lambda: busy.count() >= 1, "Working… on the pressed button")
        expect(busy.first).to_have_attribute("aria-disabled", "true")
        expect(busy.first).to_be_focused()
        assert busy.first.get_attribute("disabled") is None
        page.keyboard.press("Enter")
        advance(page, 100)
        assert len(sent) == 1, f"a further press sent another request: {sent}"
        gate()
    page.remove_listener("request", note)
    soon(page, lambda: role(page, "button", "Working…").count() == 0, f"{own_name} no longer pending")


def fill_route_typed(page: Page) -> None:
    fill(role(page, "combobox", "From"), "12 Mill Lane, Coventry")
    fill(role(page, "combobox", "To"), "4 Station Road, Rugby")
    page.keyboard.press("Tab")


@pytest.fixture(autouse=True)
def provider_baseline() -> Iterator[None]:
    yield
    WireMock()


def test_desk_screens_strict(browser: Browser, app_url: str) -> None:
    name, email = fresh("signup")
    customer, customer_email = fresh("person")
    with open_app(browser, app_url + "/sign-up") as page:
        soon(page, lambda: focus_on_h1(page), "sign-up takes focus on Start a desk")
        expect(h1(page, "Start a desk")).to_be_visible()
        fill(role(page, "textbox", "Desk name"), name)
        fill(role(page, "textbox", "Email"), email)
        fill(labelled(page, "Password"), PASSWORD)
        click(role(page, "button", "Start desk"))
        soon(page, lambda: page.request.get(app_url + "/api/auth/session").status == 200, "a signed-in session")
        assert page.request.get(app_url + "/api/auth/session").json()["desk"]["email"] == email
        page.goto(app_url + "/customers")
        record_motion(page)
        expect(h1(page, "Customers")).to_be_visible()
        click(visible(role(page, "button", "Add customer")))
        box = role(page, "dialog", "Add customer")
        fill(role(box, "textbox", "Name"), customer)
        fill(role(box, "textbox", "Email"), customer_email)
        fill(role(box, "textbox", "Telephone"), "01632 960155")
        select(role(box, "combobox", "Language"), "Polski")
        save = role(box, "button", "Save customer")
        wait_working(page, save, "**/api/customers", "Save customer")
        said(page, "Customer saved.")
        found = page.request.get(app_url + "/api/customers").json()["customers"]
        assert [c["name"] for c in found] == [customer] and found[0]["language"] == "pl"
        click(row_button(page, customer, "Rename"))
        box = role(page, "dialog", "Rename customer")
        fill(role(box, "textbox", "Name"), f"{customer} Renamed")
        click(role(box, "button", "Save name"))
        said(page, "Customer renamed.")
        assert page.request.get(f"{app_url}/api/customers/{found[0]['id']}").json()["name"] == f"{customer} Renamed"
        click(row_button(page, customer, "Remove customer"))
        click(role(role(page, "dialog", "Remove customer"), "button", "Confirm removal"))
        said(page, "Customer removed.")
        assert page.request.get(f"{app_url}/api/customers/{found[0]['id']}").status == 404
        click(visible(role(page, "button", "Sign out")))
        soon(page, lambda: page.request.get(app_url + "/api/auth/session").status == 401, "signed out")
        page.goto(app_url + "/sign-in")
        fill(role(page, "textbox", "Email"), email)
        fill(labelled(page, "Password"), "not-the-password")
        click(role(page, "button", "Sign in"))
        said(page, "That email and password do not match.")
        fill(labelled(page, "Password"), PASSWORD)
        click(role(page, "button", "Sign in"))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/enquiries", "landing on /enquiries")


def test_access_statuses_strict(app_url: str) -> None:
    name, email = fresh("statuses")
    desk = Desk(app_url)
    r = desk.ok("POST", "/api/auth/sign-up", 201, json={"name": name, "email": email, "password": PASSWORD})
    assert set(r["desk"]) >= {"id", "name", "email"} and r["desk"]["email"] == email
    error_of(httpx.post(app_url + "/api/auth/sign-up", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT), 409)
    error_of(httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": "not-the-password"}, timeout=HTTP_TIMEOUT), 401, "wrongPassword")
    assert desk.ok("GET", "/api/auth/session")["desk"]["email"] == email
    error_of(httpx.get(app_url + "/api/auth/session", timeout=HTTP_TIMEOUT), 401, "notSignedIn")
    customer = desk.ok("POST", "/api/customers", 201, json={"name": "Jack O'Rourke", "email": fresh()[1], "telephone": "01632 960155", "language": "en"})
    assert customer["name"] == "Jack O'Rourke" and customer["state"] == "active" and customer["language"] == "en"
    assert desk.ok("GET", f"/api/customers/{customer['id']}")["id"] == customer["id"]
    assert desk.ok("PATCH", f"/api/customers/{customer['id']}", json={"name": JACK_RENAMED})["name"] == JACK_RENAMED
    assert desk.ok("GET", f"/api/customers/{customer['id']}")["name"] == JACK_RENAMED
    hire = make_hire(desk, stage="enquiry")
    error_of(desk.call("DELETE", f"/api/customers/{hire['customerId']}"), 409, message="This customer has a hire, so it can't be removed.")
    assert desk.call("DELETE", f"/api/customers/{customer['id']}").status_code == 204
    other = Desk(app_url)
    cookie_before = dict(desk.http.cookies)
    other.http.cookies.update(cookie_before)
    assert desk.call("POST", "/api/auth/sign-out", json={}).status_code == 204
    error_of(other.call("GET", "/api/auth/session"), 401, "sessionEnded")


def test_password_strict(app_url: str) -> None:
    desk = new_desk(app_url)
    second = existing_desk(app_url, (desk.info["email"], PASSWORD))
    error_of(desk.call("POST", "/api/auth/password", json={"currentPassword": "not-the-password", "newPassword": "another-long-password"}), 401)
    assert second.call("GET", "/api/auth/session").status_code == 200
    assert desk.call("POST", "/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": "another-long-password"}).status_code == 204
    assert desk.call("GET", "/api/auth/session").status_code == 200
    error_of(second.call("GET", "/api/auth/session"), 401, "sessionEnded")
    error_of(second.call("GET", "/api/customers"), 401)
    error_of(httpx.post(app_url + "/api/auth/sign-in", json={"email": desk.info["email"], "password": PASSWORD}, timeout=HTTP_TIMEOUT), 401)
    existing_desk(app_url, (desk.info["email"], "another-long-password"))


def test_deleted_customer_strict(app_url: str) -> None:
    desk = new_desk(app_url)
    name, email = fresh("deleted")
    customer = desk.ok("POST", "/api/customers", 201, json={"name": name, "email": email, "telephone": fresh_phone(), "language": "en"})
    assert [c["id"] for c in desk.ok("GET", "/api/customers", params={"q": name})["customers"]] == [customer["id"]]
    assert desk.call("DELETE", f"/api/customers/{customer['id']}").status_code == 204
    error_of(desk.call("GET", f"/api/customers/{customer['id']}"), 404, message="We can't find that.")
    assert desk.ok("GET", "/api/customers")["customers"] == []
    assert desk.ok("GET", "/api/customers", params={"q": name})["customers"] == []
    error_of(desk.call("PATCH", f"/api/customers/{customer['id']}", json={"name": "Back"}), 404)


def test_desks_apart_records_strict(app_url: str, wiremock: WireMock) -> None:
    a = new_desk(app_url)
    b = new_desk(app_url)
    hire = make_hire(a, customer={"name": ALPHA_NAME, "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})
    document = a.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "invoice"})
    customer_id = hire["customerId"]
    vehicle = hire["vehicles"][0]["id"]
    probes = [
        ("GET", f"/api/customers/{customer_id}", None), ("PATCH", f"/api/customers/{customer_id}", {"name": "Taken"}), ("DELETE", f"/api/customers/{customer_id}", None),
        ("GET", f"/api/hires/{hire['id']}", None), ("GET", f"/api/hires/{hire['id']}/ledger", None), ("GET", f"/api/enquiries/{hire['id']}", None),
        ("GET", f"/api/runs/{run_id(hire)}", None), ("GET", f"/api/runs/{run_id(hire)}/hours", None), ("POST", f"/api/runs/{run_id(hire)}/confirm", {}),
        ("GET", f"/api/documents/{document['id']}", None), ("GET", f"/api/documents/{document['id']}/file", None),
        ("POST", f"/api/hires/{hire['id']}/documents", {"kind": "invoice"}), ("POST", f"/api/hires/{hire['id']}/refunds", {"vehicleId": vehicle, "amount": "1.00"}),
        ("POST", "/api/complaints", {"customerId": customer_id, "summary": "Foreign", "receivedAt": {"date": "2027-03-25", "time": "10:00"}}),
    ]
    for method, path, body in probes:
        r = b.call(method, path, json=body) if body is not None else b.call(method, path)
        error_of(r, 404)
        assert ALPHA_NAME not in r.text
    body = {"customer": {"name": "x", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"}, "occasion": "company", "stops": [COVENTRY, NEC],
            "departAt": {"date": "2027-05-14", "time": "08:00"}, "returnAt": None, "party": {"people": 47, "large": 0, "medium": 0, "hand": 0, "wheelchairs": 0},
            "vehicles": [{"seats": 49, "operatorId": "OP-1001", "boughtPrice": "1006.30", "marginPercent": "15"}], "stage": "accepted"}
    error_of(b.call("POST", "/api/hires", json=body), 404)
    own = make_hire(b, stage="enquiry")
    error_of(b.call("POST", "/api/enquiries/merge", json={"enquiryIds": [own["id"], hire["id"]]}), 404)
    b.ok("PATCH", f"/api/customers/{own['customerId']}", json={"name": "Beta Customer"})

    def read(desk: Desk, marker: str, forbidden: str) -> bool:
        r = desk.call("GET", "/api/customers")
        return marker in r.text and forbidden not in r.text

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        futures = [pool.submit(read, a, ALPHA_NAME, "Beta Customer") if i % 2 else pool.submit(read, b, "Beta Customer", ALPHA_NAME) for i in range(60)]
        assert all(f.result() for f in futures), "an interleaved response carried the other desk's data"
    assert a.ok("GET", f"/api/customers/{customer_id}")["name"] == ALPHA_NAME


def plain_desk(base: str) -> tuple[str, dict[str, str]]:
    name, email = fresh("plain")
    made = httpx.post(base + "/api/auth/sign-up", json={"name": name, "email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert made.status_code == 201, f"sign-up answered {made.status_code}"
    return email, {"Cookie": made.headers["set-cookie"].split(";")[0]}


def plain_customer(base: str, headers: dict[str, str]) -> str:
    name, email = fresh("customer")
    made = httpx.post(base + "/api/customers", json={"name": name, "email": email, "telephone": fresh_phone(), "language": "en"}, headers=headers, timeout=HTTP_TIMEOUT)
    assert made.status_code == 201, f"creating a customer answered {made.status_code}"
    return str(made.json()["id"])


def test_wf_desk_access_statuses(app_url: str) -> None:
    email, headers = plain_desk(app_url)
    assert httpx.get(app_url + "/api/auth/session", headers=headers, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": "not-the-password"}, timeout=HTTP_TIMEOUT).status_code == 401
    signed = httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
    assert signed.status_code == 200
    second = {"Cookie": signed.headers["set-cookie"].split(";")[0]}
    assert httpx.post(app_url + "/api/auth/sign-out", json={}, headers=second, timeout=HTTP_TIMEOUT).status_code == 204
    assert httpx.get(app_url + "/api/auth/session", headers=second, timeout=HTTP_TIMEOUT).status_code == 401


def test_wf_desk_access_password_ends_other_sessions(app_url: str) -> None:
    email, headers = plain_desk(app_url)
    other = {"Cookie": httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT).headers["set-cookie"].split(";")[0]}
    assert httpx.post(app_url + "/api/auth/password", json={"currentPassword": PASSWORD, "newPassword": "another-long-password"}, headers=headers, timeout=HTTP_TIMEOUT).status_code == 204
    assert httpx.get(app_url + "/api/auth/session", headers=other, timeout=HTTP_TIMEOUT).status_code == 401
    assert httpx.get(app_url + "/api/auth/session", headers=headers, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": PASSWORD}, timeout=HTTP_TIMEOUT).status_code == 401
    assert httpx.post(app_url + "/api/auth/sign-in", json={"email": email, "password": "another-long-password"}, timeout=HTTP_TIMEOUT).status_code == 200


def test_wf_desk_access_deleted_customer_gone(app_url: str) -> None:
    _, headers = plain_desk(app_url)
    customer = plain_customer(app_url, headers)
    assert httpx.get(f"{app_url}/api/customers/{customer}", headers=headers, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.patch(f"{app_url}/api/customers/{customer}", json={"name": JACK_RENAMED}, headers=headers, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.delete(f"{app_url}/api/customers/{customer}", headers=headers, timeout=HTTP_TIMEOUT).status_code == 204
    assert httpx.get(f"{app_url}/api/customers/{customer}", headers=headers, timeout=HTTP_TIMEOUT).status_code == 404


def test_desks_kept_apart(app_url: str) -> None:
    _, owner = plain_desk(app_url)
    _, intruder = plain_desk(app_url)
    customer = plain_customer(app_url, owner)
    assert httpx.get(f"{app_url}/api/customers/{customer}", headers=intruder, timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.patch(f"{app_url}/api/customers/{customer}", json={"name": JACK_RENAMED}, headers=intruder, timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.delete(f"{app_url}/api/customers/{customer}", headers=intruder, timeout=HTTP_TIMEOUT).status_code == 404
    assert httpx.get(f"{app_url}/api/customers/{customer}", headers=owner, timeout=HTTP_TIMEOUT).status_code == 200


PUBLIC_PAGES = {
    "home": ("/", "Coaches and minibuses with a driver", "Coach and minibus hire from Coventry | Merrowfield Coach Hire"),
    "school": ("/occasions/school", "School trips", "School trips | Merrowfield Coach Hire"),
    "weddings": ("/occasions/weddings", "Weddings", "Weddings | Merrowfield Coach Hire"),
    "company": ("/occasions/company", "Company travel", "Company travel | Merrowfield Coach Hire"),
    "festivals": ("/occasions/festivals", "Festivals and sport", "Festivals and sport | Merrowfield Coach Hire"),
    "fleet": ("/fleet", "Our fleet", "Our fleet | Merrowfield Coach Hire"),
    "terms": ("/terms", "Terms", "Terms | Merrowfield Coach Hire"),
}


def anchors_to(page: Page, path: str) -> list[dict[str, float]]:
    return page.evaluate(
        """path => [...document.querySelectorAll('a[href]')].filter(a => new URL(a.href).pathname === path && !a.closest('nav')).map(a => {
            const r = a.getBoundingClientRect();
            const centre = (e) => { const b = e.getBoundingClientRect(); return b.left + b.width / 2; };
            let side = centre(a);
            for (let n = a, i = 0; n && i < 4; n = n.parentElement, i++) {
                const art = [...n.querySelectorAll('svg,img')].filter((g) => { const b = g.getBoundingClientRect(); return b.width > 200 && b.width < innerWidth * 0.7; });
                if (art.length > 1) break;
                if (art.length === 1) { side = centre(art[0]); break; }
            }
            if (side === centre(a) && r.width > innerWidth * 0.7) { const words = a.querySelector('h2,h3,p'); if (words) side = centre(words); }
            return {x: r.left + scrollX, y: r.top + scrollY, w: r.width, h: r.height, side};
        }).filter(r => r.w > 0)""", path)


def test_wf_public_site_home_bands(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/", size=WIDE, reduced=True) as page:
        call = visible(role(page, "link", "Call 01632 960140"))
        quote = visible(role(page, "link", "Get a free quote"))
        nav = role(page, "navigation", "Main")
        expect(call).to_be_visible()
        expect(quote).to_be_visible()
        names = [role(nav, "link", n) for n in ("Home", "School trips", "Weddings", "Company travel", "Festivals and sport", "Fleet", "Terms")]
        for link in names:
            expect(link).to_be_visible()
        expect(names[0]).to_have_attribute("aria-current", "page")
        assert call.bounding_box()["y"] < nav.bounding_box()["y"], "masthead sits above the navigation"
        assert page.evaluate("""() => { let n = document.querySelector('h1');
            for (; n; n = n.parentElement) { const r = n.getBoundingClientRect();
                if (r.width >= innerWidth - 1 && r.left <= 1 && r.height >= innerHeight * 0.25 && r.height <= innerHeight * 0.6) return true; }
            return false; }"""), "Full-bleed coach drawing hero is edge to edge and a little under half the screen"
        expect(h1(page, "Coaches and minibuses with a driver")).to_be_visible()
        expect(page.get_by_text("Arranged for you from Coventry", exact=True)).to_be_visible()
        earlier = role(page, "button", "Earlier")
        later = role(page, "button", "Later")
        promise = page.get_by_role("heading", name="One desk, one person, every detail checked", exact=True)
        for line in ("Partner operators asked for you", "Papers checked for your last day", "Drivers' hours checked before you travel", "One private page for your quote"):
            expect(page.get_by_text(line, exact=True)).to_be_visible()
        start = role(page, "link", "Start your quote")
        assert urllib.parse.urlsplit(start.get_attribute("href")).path == "/quote/route"
        footer = page.get_by_text("Merrowfield Coach Hire, Coventry", exact=True)
        ys = [h1(page, "Coaches and minibuses with a driver").evaluate("e => e.getBoundingClientRect().top + scrollY"),
              earlier.evaluate("e => e.getBoundingClientRect().top + scrollY"), promise.evaluate("e => e.getBoundingClientRect().top + scrollY"),
              start.evaluate("e => e.getBoundingClientRect().top + scrollY"), footer.evaluate("e => e.getBoundingClientRect().top + scrollY")]
        assert ys == sorted(ys), f"bands out of published order: {ys}"
        occasions = ["/occasions/school", "/occasions/weddings", "/occasions/company", "/occasions/festivals"]
        splits = []
        cards = []
        for path in occasions:
            found = anchors_to(page, path)
            assert len(found) >= 2, f"{path} has an Occasion split panel and an Occasion card link"
            splits.append(found[0])
            cards.append(found[-1])
        sides = [s["side"] < WIDE[0] / 2 for s in splits]
        assert all(sides[i] != sides[i + 1] for i in range(3)), f"Occasion split panel side swaps row by row: {sides}"
        assert max(c["y"] for c in cards) - min(c["y"] for c in cards) < 400 and len({round(c["x"]) for c in cards}) == 4, "Occasion cards in four columns from 1024 px"
        scrolled = earlier.evaluate("e => { e.scrollIntoView({block: 'center'}); return true; }")
        assert scrolled
        advance(page, 100)
        before = decode(capture(page.locator("body")))
        advance(page, MARKS_STILL_MS)
        assert difference(before, decode(capture(page.locator("body")))) < 0.01, "client marks move only when pressed"
        click(later)
        advance(page, 400)
        changed(before, decode(capture(page.locator("body"))), minimum=0.001)
        for _ in range(10):
            if later.get_attribute("aria-disabled") == "true":
                break
            later.press("Enter")
            advance(page, 400)
        expect(later).to_have_attribute("aria-disabled", "true")
        assert later.evaluate("e => e === document.activeElement"), "the button keeps focus at the end"
    with screen(browser, app_url, "/", size=PHONE, reduced=True) as page:
        cards = [anchors_to(page, p)[-1] for p in ("/occasions/school", "/occasions/weddings")]
        assert round(cards[0]["x"]) == round(cards[1]["x"]) and cards[0]["y"] < cards[1]["y"], "Occasion cards in one column below 1024 px"
        footer = page.get_by_text("Merrowfield Coach Hire, Coventry", exact=True)
        expect(footer).to_be_visible()
        layout(page)


def test_wf_public_site_phone_menu(browser: Browser, app_url: str) -> None:
    for size, width in ((PHONE, PHONE[0]), ((768, 1024), 480)):
        with screen(browser, app_url, "/", size=size) as page:
            menu = role(page, "button", "Menu")
            expect(menu).to_be_visible()
            expect(visible(role(page, "link", "Call 01632 960140"))).to_be_visible()
            expect(role(page, "navigation", "Main")).to_have_count(0)
            bar = menu.evaluate("""e => { for (let n = e; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') { const r = n.getBoundingClientRect(); return {top: r.top, height: r.height, shadow: getComputedStyle(n).boxShadow}; } return null; }""")
            assert bar and bar["top"] == 0 and 60 <= bar["height"] <= 80, f"Phone top bar about 70 px: {bar}"
            assert bar["shadow"] == "none"
            page.evaluate("scrollTo(0, 24)")
            advance(page, 100)
            page.evaluate("scrollTo(0, 25)")
            soon(page, lambda: menu.evaluate("""e => { for (let n = e; n; n = n.parentElement) if (getComputedStyle(n).position === 'fixed') return getComputedStyle(n).boxShadow !== 'none'; return false; }"""), "Phone top bar shadow from 25 px")
            page.evaluate("scrollTo(0, 0)")
            for _ in range(8):
                page.keyboard.press("Tab")
                x = page.evaluate("(() => { const r = document.activeElement.getBoundingClientRect(); return {l: r.left, r: r.right}; })()")
                assert x["l"] >= 0 and x["r"] <= size[0], "a closed Menu leaves nothing focusable off-screen"
            click(menu)
            panel = role(page, "dialog", "Menu")
            soon(page, lambda: panel.count() == 1, "Menu panel")
            ends = panel.evaluate(SEEK_ENDS)
            assert any(e["sx"] > e["ex"] for e in ends) or not ends, "the panel comes from the right edge"
            page.evaluate("document.getAnimations().forEach(a => a.finish())")
            box = panel.bounding_box()
            assert abs(box["width"] - width) <= 1 and abs(box["x"] + box["width"] - size[0]) <= 1, f"panel geometry {box}"
            axe(page)
            click(role(panel, "button", "Close"))
            soon(page, lambda: panel.count() == 0, "closed Menu gone from the accessibility tree")
            assert menu.evaluate("e => e === document.activeElement")
            layout(page)
    with screen(browser, app_url, "/occasions/school", size=PHONE, reduced=True) as page:
        click(role(page, "button", "Menu"))
        panel = role(page, "dialog", "Menu")
        expect(panel).to_be_visible()
        page.keyboard.press("Escape")
        expect(panel).to_have_count(0, timeout=GONE_MS)
        question = role(page, "button", "How early should we ask?")
        click(question)
        expect(question).to_have_attribute("aria-expanded", "true")
        assert [m for m in motions(page) if m["duration"] >= 1] == [], "no motion under reduced motion"
        expect(visible(role(page, "link", "Get a free quote"))).to_be_visible()
        message = role(page, "link", "Message us")
        assert message.evaluate("e => e.getAnimations({subtree: true}).length") == 0, "the ring never plays under reduced motion"


def test_wf_public_site_interactions(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/occasions/school", size=WIDE) as page:
        slim = page.locator('[data-part="slim-bar"]')

        def slim_showing() -> bool:
            return slim.count() > 0 and slim.first.is_visible() and slim.first.bounding_box()["y"] + slim.first.bounding_box()["height"] > 0 and float(slim.first.evaluate("e => getComputedStyle(e).opacity")) > 0

        page.evaluate("scrollTo(0, 199)")
        advance(page, 400)
        assert not slim_showing(), "no slim bar before 200 px"
        page.evaluate("scrollTo(0, 200)")
        soon(page, slim_showing, "slim bar at 200 px")
        expect(visible(slim.first.get_by_role("link", name="Get a free quote", exact=True))).to_be_visible()
        page.reload()
        soon(page, slim_showing, "slim bar already in place on arrival at a scrolled position (SR22)")
        page.evaluate("scrollTo(0, 0)")
        advance(page, 200)
        ring = role(page, "link", "Message us")
        assert ring.bounding_box()["x"] < WIDE[0] / 2, "Message us sits at the bottom left"
        assert abs(ring.bounding_box()["width"] - 60) <= 12, "about 60 px across"
        assert ring.evaluate("e => parseFloat(getComputedStyle(e).borderRadius)") > 0, "Message us link is round"
        assert ring.get_attribute("href").startswith("mailto:")
        page.evaluate("scrollTo(0, 599)")
        advance(page, 200)
        top = role(page, "link", "Back to top")
        assert not shown(top), "Back to top waits for 600 px"
        page.evaluate("scrollTo(0, 601)")
        soon(page, lambda: shown(top), "Back to top after 600 px")
        a, b = top.bounding_box(), ring.bounding_box()
        assert a["x"] > WIDE[0] / 2 and (b["x"] + b["width"] <= a["x"] or a["x"] + a["width"] <= b["x"]), "Back to top at the right, not overlapping"
        rail = role(page, "navigation", "On this page")
        links = rail.get_by_role("link")
        assert [links.nth(i).inner_text().strip() for i in range(links.count())] == ["What we arrange", "What to tell us", "How payment works", "Questions"]
        click(role(rail, "link", "How payment works"))
        soon(page, lambda: role(rail, "link", "How payment works").get_attribute("aria-current") == "true", "pressed section current")
        page.evaluate("scrollTo(0, 0)")
        advance(page, STILL_GAP_MS)
        page.evaluate("scrollTo(0, document.documentElement.scrollHeight)")
        soon(page, lambda: role(rail, "link", "Questions").get_attribute("aria-current") == "true", "last section current at the end")
        click(role(page, "button", "Search") if role(page, "button", "Search").count() == 1 else visible(role(page, "button", "Search")))
        overlay = role(page, "dialog", "Search")
        box = role(overlay, "searchbox", "Search the site")
        soon(page, lambda: box.evaluate("e => e === document.activeElement"), "focus in the search field")
        box.fill("School")
        page.keyboard.press("Enter")
        said(page, re.compile(r"\d+ results found\."))
        expect(role(overlay, "list", "Search results")).to_be_visible()
        box.fill("zzzqqqxxx")
        page.keyboard.press("Enter")
        said(page, "Nothing found for that search.")
        box.fill("x" * (SEARCH_CAP + 1))
        page.keyboard.press("Enter")
        said(page, "Search text can be up to 200 characters.")
        page.keyboard.press("Escape")
        soon(page, lambda: overlay.count() == 0, "search overlay closed")
    with screen(browser, app_url, "/occasions/school#who-checks", size=WIDE) as page:
        question = role(page, "button", "Who checks the driver?")
        soon(page, lambda: question.get_attribute("aria-expanded") == "true", "the fragment opens its question")
        settled = question.bounding_box()
        slim = page.locator('[data-part="slim-bar"]')
        if slim.count() and slim.first.is_visible():
            bar = slim.first.bounding_box()
            assert settled["y"] >= bar["y"] + bar["height"] - 1, "question under the sticky header, not behind it"
        click(visible(role(page, "link", "Get a free quote")))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/route", "the form at /quote/route")
        expect(role(role(page, "radiogroup", "Occasion"), "radio", "School")).to_be_checked()
        expect(role(page, "complementary", "Journey ticket")).to_contain_text("School")
    with screen(browser, app_url, "/occasions/weddings", size=PHONE) as page:
        heading = h1(page, "Weddings").bounding_box()
        link = visible(role(page, "link", "Get a free quote"))
        assert link.bounding_box()["y"] >= heading["y"] + heading["height"] - 1, "link directly under the level-one heading"
        click(link)
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/route", "the form")
        expect(role(role(page, "radiogroup", "Occasion"), "radio", "Weddings")).to_be_checked()


@pytest.mark.timeout(1800)
def test_wf_public_site_screen_rules(browser: Browser, app_url: str) -> None:
    meets_screen_rules(browser, app_url, "/occasions/school", "Search", "Search", sizes=(WIDE,), landscape=False, endpoint="/api/public/enquiries", refresh_line=False, shape="panel")
    meets_screen_rules(browser, app_url, "/occasions/school", "Menu", "Menu", sizes=(PHONE,), refresh_line=False, shape="panel")
    with screen(browser, app_url, "/occasions/school", size=PHONE) as page:
        question = role(page, "button", "How early should we ask?")
        expect(question).to_have_attribute("aria-expanded", "false")
        click(question)
        soon(page, lambda: question.get_attribute("aria-expanded") == "true", "accordion open")
        axe(page)
        click(question)
        soon(page, lambda: question.get_attribute("aria-expanded") == "false", "accordion closed")
        assert_published_motion(page)
    sweep_routes(browser, app_url, "home", "school", "fleet", "terms")


@pytest.mark.parametrize("page_case", list(PUBLIC_PAGES.values()), ids=list(PUBLIC_PAGES))
def test_public_pages_first_response(browser: Browser, app_url: str, page_case: tuple[str, str, str]) -> None:
    path, heading, title = page_case
    r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    assert heading.replace("'", "&#39;") in r.text or heading in r.text
    assert f"<title>{title}".replace("&", "&amp;") in r.text or title in r.text
    context = browser.new_context(java_script_enabled=False, viewport={"width": WIDE[0], "height": WIDE[1]})
    try:
        page = context.new_page()
        page.goto(app_url + path)
        expect(h1(page, heading)).to_be_visible()
        assert page.title() == title
        assert page.evaluate(FADED_JS) == [], "section text is visible with no script"
        page.emulate_media(media="print")
        expect(h1(page, heading)).to_be_visible()
        assert page.evaluate(FADED_JS) == [], "section text is visible in print"
        page.emulate_media(media="screen", reduced_motion="reduce")
        expect(h1(page, heading)).to_be_visible()
        assert float(h1(page, heading).evaluate("e => getComputedStyle(e).opacity")) == 1
    finally:
        context.close()
    if path == "/fleet":
        for words in ("8", "12", "16", "31", "49", "56", "70"):
            assert words in r.text
    if path.startswith("/occasions/"):
        for section in ("What we arrange", "What to tell us", "How payment works", "Questions", "How early should we ask?", "Who checks the driver?", "What happens if plans change?"):
            assert section in r.text


def test_public_search_bounded(app_url: str) -> None:
    desk = new_desk(app_url)
    name = "Zyxwvut" + uuid.uuid4().hex[:8]
    desk.ok("POST", "/api/customers", 201, json={"name": name, "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})
    found = httpx.get(app_url + "/api/public/search", params={"q": "School"}, timeout=HTTP_TIMEOUT).json()["results"]
    assert found and all(set(x) >= {"title", "path", "excerpt"} for x in found)
    assert "/occasions/school" in [x["path"].split("#")[0] for x in found]
    assert not [x["path"] for x in found if x["path"].startswith(("/enquiries", "/hires", "/operators", "/payments", "/diary", "/documents", "/rates", "/customers", "/aftercare", "/q/", "/b/", "/r/", "/api"))]
    assert httpx.get(app_url + "/api/public/search", params={"q": name}, timeout=HTTP_TIMEOUT).json()["results"] == []
    error_of(httpx.get(app_url + "/api/public/search", params={"q": ""}, timeout=HTTP_TIMEOUT), 422)
    assert httpx.get(app_url + "/api/public/search", params={"q": "😀" * SEARCH_CAP}, timeout=HTTP_TIMEOUT).status_code == 200
    started = time.monotonic()
    err = error_of(httpx.get(app_url + "/api/public/search", params={"q": "😀" * (SEARCH_CAP + 1)}, timeout=HTTP_TIMEOUT), 422, message="Search text can be up to 200 characters.")
    assert time.monotonic() - started < 1, err

    def nested(levels: int) -> Any:
        value: Any = {}
        for _ in range(levels - 1):
            value = {"x": value}
        return value

    within = enquiry_body(app_url)
    within["extra"] = nested(DEPTH_CAP - 1)
    assert desk.call("POST", "/api/enquiries", json=within).status_code == 201
    over = enquiry_body(app_url)
    over["extra"] = nested(DEPTH_CAP)
    started = time.monotonic()
    error_of(desk.call("POST", "/api/enquiries", json=over), 422)
    assert time.monotonic() - started < 1
    deep = '{"x":' * 5000 + "1" + "}" * 5000
    started = time.monotonic()
    error_of(desk.call("POST", "/api/enquiries", content=deep, headers={"content-type": "application/json"}), 422)
    assert time.monotonic() - started < 1


def test_wf_quote_request_ticket_flight(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url + "", "/quote/route", size=WIDE) as page:
        ticket = role(page, "complementary", "Journey ticket")
        expect(ticket).to_contain_text("One way")
        expect(ticket).to_contain_text("Not yet given")
        field = role(page, "combobox", "From")
        start_box = field.bounding_box()
        slow_animations(page)
        field.click()
        field.fill("12 Mill Lane, Coventry")
        page.keyboard.press("Tab")
        flight = page.locator('[data-part="ticket-flight"]')
        soon(page, lambda: flight.count() == 1, "one travelling element")
        expect(flight).to_contain_text(TYPED_FROM)
        timings = flight.evaluate("e => e.getAnimations({subtree: true}).map(a => Number(a.effect.getComputedTiming().duration))")
        assert 320 in timings, f"value travels in 320 ms: {timings}"
        ends = flight.evaluate(SEEK_ENDS)
        best = max(ends, key=lambda e: abs(e["ex"] - e["sx"]) + abs(e["ey"] - e["sy"]))
        line = ticket_lines(page)[FROM_LINE]
        assert abs(best["sx"] - start_box["x"]) < start_box["width"] and abs(best["sy"] - start_box["y"]) < 3 * start_box["height"], "starts from the field's box"
        assert best["ex"] >= line["x"] - best["w"] and abs(best["ey"] - line["y"]) < 3 * line["height"], "ends on the line's box"
        travel = abs(best["ex"] - best["sx"]) + abs(best["ey"] - best["sy"])
        before = flight.bounding_box()
        field.fill("14 Mill Lane, Coventry")
        page.keyboard.press("Tab")
        soon(page, lambda: TYPED_FROM_NEXT in (flight.first.text_content() if flight.count() else ""), "the travelling element shows the new value")
        assert flight.count() == 1, "one flight per value"
        now = flight.bounding_box()
        assert abs(now["x"] - before["x"]) + abs(now["y"] - before["y"]) < travel / 2, "carries on from where it is, with no jump"
        session(page).send("Animation.setPlaybackRate", {"playbackRate": 1})
        page.evaluate("document.getAnimations().forEach(a => a.finish())")
        soon(page, lambda: TYPED_FROM_NEXT in ticket_lines(page)[FROM_LINE]["text"], "value lands on its ticket line")
        assert_published_motion(page)
    with screen(browser, app_url, "/quote/route", size=WIDE, reduced=True) as page:
        fill(role(page, "combobox", "From"), "12 Mill Lane, Coventry")
        page.keyboard.press("Tab")
        expect(page.locator('[data-part="ticket-flight"]')).to_have_count(0)
        soon(page, lambda: TYPED_FROM in ticket_lines(page)[FROM_LINE]["text"], "the value on its line at once", seconds=1)


def test_wf_quote_request_breakpoint(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/quote?occasion=school", size=(1024, 768)) as page:
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/route", "redirect to the Route step")
        panel = role(page, "complementary", "Journey ticket")
        expect(panel).to_be_visible()
        expect(page.get_by_role("button", name=re.compile(r"^Journey ticket, \d+ answered$"))).to_have_count(0)
        form_box = role(page, "combobox", "From").bounding_box()
        side = panel.bounding_box()
        assert side["x"] >= form_box["x"] + form_box["width"] - 1, "Journey ticket sits beside the form"
        layout(page)
        segments = role(page, "radiogroup", "Journey type").get_by_role("radio")
        expect(segments).to_have_count(4)
        for label in ("One way", "Return", "Same day return", "Several stops"):
            expect(role(role(page, "radiogroup", "Journey type"), "radio", label)).to_have_count(1)
        action = visible(role(page, "button", "Next")).bounding_box()
        assert action["width"] >= form_box["width"] - 1, "Journey quote form closes with a full-width main action"
    with screen(browser, app_url, "/quote?occasion=school", size=(1023, 768)) as page:
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/route", "redirect to the Route step")
        bar = role(page, "button", "Journey ticket, 2 answered")
        expect(bar).to_be_visible()
        assert page.evaluate("document.querySelectorAll('[data-part=\"ticket-flight\"]').length") == 0, "no flight on arrival"
        expect(role(page, "complementary", "Journey ticket")).to_have_count(0)
        bar_box = bar.bounding_box()
        assert bar_box["y"] + bar_box["height"] <= 768 and bar_box["y"] > 768 / 2, "a bar fixed to the bottom"
        fill(role(page, "combobox", "From"), "12 Mill Lane, Coventry")
        page.keyboard.press("Tab")
        soon(page, lambda: role(page, "button", "Journey ticket, 3 answered").count() == 1, "the count rises to 3")
        layout(page)
        click(role(page, "button", "Journey ticket, 3 answered"))
        sheet = role(page, "dialog", "Journey ticket")
        soon(page, lambda: sheet.count() == 1, "the ticket as a sheet")
        expect(sheet).to_contain_text(TYPED_FROM)
    with screen(browser, app_url, "/quote/route", size=PHONE) as page:
        expect(role(page, "button", "Journey ticket, 1 answered")).to_be_visible()
        boxes = [role(page, "radio", n).evaluate("e => { const t = (e.labels && e.labels[0]) || e.closest('label') || e; const r = t.getBoundingClientRect(); return {x: r.left, y: r.top}; }") for n in ("One way", "Return", "Same day return", "Several stops")]
        assert round(boxes[0]["y"]) == round(boxes[1]["y"]) and round(boxes[2]["y"]) == round(boxes[3]["y"]) and boxes[2]["y"] > boxes[0]["y"], "Journey type bar shows two per row below 768 px"
        field = role(page, "combobox", "From").bounding_box()
        assert field["height"] >= TOUCH_TARGET - 0.01, "Underline icon field is at least 44 px tall"


def test_wf_quote_request_walk_and_send(browser: Browser, app_url: str) -> None:
    name, email = fresh("walker")
    out = today(app_url) + timedelta(days=70)
    ret = out + timedelta(days=2)
    maria = existing_desk(app_url, MARIA)
    with screen(browser, app_url, "/quote/details", size=WIDE) as page:
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/route", "first step with a missing answer")
        expect(page).to_have_title("Route | Get a free quote")
        click(visible(role(page, "button", "Next")))
        said(page, "Choose an occasion.")
        problems = role(page, "group", "Problems")
        expect(problems).to_be_visible()
        click(role(problems, "link", "Enter the pick-up address."))
        from_box = role(page, "combobox", "From")
        soon(page, lambda: from_box.evaluate("e => e === document.activeElement"), "the Problems link moves focus to its field")
        expect(from_box).to_have_attribute("aria-invalid", "true")
        click(role(role(page, "radiogroup", "Occasion"), "radio", "School"))
        fill(from_box, "12 Mill Lane, Coventry")
        fill(role(page, "combobox", "To"), "4 Station Road, Rugby")
        page.keyboard.press("Tab")
        click(role(page, "button", "Add a stop"))
        stop = role(page, "combobox", "Stop 1")
        soon(page, lambda: stop.evaluate("e => e === document.activeElement"), "focus moves into the new stop")
        click(role(page, "button", "Remove stop"))
        soon(page, lambda: role(page, "button", "Add a stop").evaluate("e => e === document.activeElement"), "focus to Add a stop when no stop follows")
        click(role(role(page, "radiogroup", "Journey type"), "radio", "Several stops"))
        details = role(page, "textbox", "Stop details")
        expect(details).to_be_visible()
        fill(details, TYPED_DETAILS)
        click(role(role(page, "radiogroup", "Journey type"), "radio", "Return"))
        expect(details).to_have_count(0)
        click(role(role(page, "radiogroup", "Journey type"), "radio", "Several stops"))
        expect(role(page, "textbox", "Stop details")).to_have_value(TYPED_DETAILS)
        click(role(role(page, "radiogroup", "Journey type"), "radio", "Return"))
        click(visible(role(page, "button", "Next")))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/when" and focus_on_h1(page), "focus on the When and who heading")
        expect(h1(page, "When and who")).to_be_visible()
        today_button, tomorrow_button = role(page, "button", "Today"), role(page, "button", "Tomorrow")
        a, b, c = today_button.bounding_box(), tomorrow_button.bounding_box(), role(page, "textbox", "Out date").bounding_box()
        assert a["x"] < b["x"] and round(a["y"]) == round(b["y"]) and b["y"] < c["y"], "Today and Tomorrow shortcuts sit at the far ends of a row above the out date"
        fill(role(page, "textbox", "Out date"), "31/02/2027")
        page.keyboard.press("Tab")
        click(visible(role(page, "button", "Next")))
        said(page, "Enter a date as DD/MM/YYYY.")
        fill(role(page, "textbox", "Out date"), typed(out))
        select(role(page, "combobox", "Out hour"), "08")
        select(role(page, "combobox", "Out minutes"), "00")
        fill(role(page, "textbox", "Return date"), typed(ret))
        select(role(page, "combobox", "Return hour"), "17")
        select(role(page, "combobox", "Return minutes"), "00")
        fill(role(page, "spinbutton", "People"), "47")
        page.keyboard.press("Tab")
        expect(role(page, "complementary", "Journey ticket")).to_contain_text("47 people")
        expect(role(page, "complementary", "Journey ticket")).to_contain_text(f"{out:%a} {out.day} {out:%b} {out.year}, 08:00")
        click(role(page, "button", "Choose out date"))
        calendar = role(page, "dialog", "Choose a date")
        soon(page, lambda: calendar.count() == 1, "calendar")
        expect(calendar.get_by_role("grid")).to_be_visible()
        expect(role(calendar, "button", "Next month")).to_be_visible()
        page.keyboard.press("Escape")
        soon(page, lambda: calendar.count() == 0, "Escape closes the calendar only")
        page.reload()
        expect(role(page, "spinbutton", "People")).to_have_value("47")
        page.go_back()
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/route", "Back to Route")
        expect(role(page, "combobox", "From")).to_have_value(TYPED_FROM)
        click(role(role(page, "radiogroup", "Journey type"), "radio", "One way"))
        click(role(role(page, "radiogroup", "Journey type"), "radio", "Return"))
        page.go_forward()
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/when", "Forward to When and who")
        expect(role(page, "textbox", "Return date")).to_have_value(typed(ret))
        click(visible(role(page, "button", "Next")))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/details", "the Your details step")
        fill(role(page, "textbox", "Name"), name)
        fill(role(page, "textbox", "Email"), email)
        fill(role(page, "textbox", "Telephone"), "not a telephone")
        click(visible(role(page, "button", "Send request")))
        said(page, "Enter a UK telephone number.")
        expect(role(page, "textbox", "Name")).to_have_value(name)
        fill(role(page, "textbox", "Telephone"), "01632 960155")
        select(role(page, "combobox", "Language for your quote"), "English")
        click(visible(role(page, "button", "Send request")))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/thanks", "the thanks page")
        expect(h1(page, "Thank you")).to_be_visible()
        match = re.search(r"CV-[0-9A-HJKMNP-TV-Z]{5}", body_text(page))
        assert match, "the thanks page shows a reference"
        reference = match.group(0)
        shows(page, f"Request sent. Your reference is {reference}.")
    stored = maria.ok("GET", f"/api/enquiries/{reference}")
    assert stored["email"] == email and stored["customerName"] == name and stored["occasion"] == "school" and stored["journeyType"] == "return"
    assert stored["party"]["people"] == 47 and [s["text"] for s in stored["stops"]] == [TYPED_FROM, TYPED_TO]
    assert all(s["checked"] is False for s in stored["stops"])
    assert stored["departAt"]["date"] == out.isoformat() and stored["returnAt"]["date"] == ret.isoformat()
    first_page = maria.ok("GET", "/api/enquiries", params={"q": reference})["enquiries"]
    assert [row["reference"] for row in first_page] == [reference]


@pytest.mark.timeout(1800)
def test_wf_quote_request_screen_rules(browser: Browser, app_url: str) -> None:
    meets_screen_rules(browser, app_url, "/quote/route", re.compile(r"^Journey ticket, \d+ answered$"), "Journey ticket", main="Next", sizes=(PHONE,), endpoint="/api/public/enquiries", refresh_line=False, shape="sheet")
    with screen(browser, app_url, "/quote/route") as page:
        bar = role(page, "radiogroup", "Journey type")
        expect(bar).to_be_visible()
        target = role(bar, "radio", "Return")
        state_mark(page, target, lambda: click(target))
    sweep_routes(browser, app_url, "quote_route")


def test_pickup_clock_rules_api(app_url: str) -> None:
    desk = new_desk(app_url)
    now_uk = server_now(app_url).astimezone(UK).replace(second=0, microsecond=0, tzinfo=None)
    day = today(app_url)
    post = lambda **kw: desk.call("POST", "/api/enquiries", json=enquiry_body(app_url, **kw))
    error_of(post(departAt={"date": (day - timedelta(days=1)).isoformat(), "time": "08:00"}), 422, message="That date has passed. Choose today or a later date.")
    error_of(post(departAt={"date": (day + timedelta(days=5)).isoformat(), "time": "14:20"}), 422, message="Choose an hour and minutes.")
    public = httpx.post(app_url + "/api/public/enquiries", json=enquiry_body(app_url, departAt={"date": (day + timedelta(days=5)).isoformat(), "time": "14:20"}), timeout=HTTP_TIMEOUT)
    error_of(public, 422, message="Choose an hour and minutes.")
    quarter = now_uk + timedelta(minutes=(15 - now_uk.minute % 15) % 15)
    if (quarter - now_uk) < timedelta(minutes=30):
        error_of(post(departAt={"date": quarter.date().isoformat(), "time": f"{quarter:%H:%M}"}), 422, message="We need at least 30 minutes' notice for a pick-up.")
    later = quarter + timedelta(minutes=45)
    assert post(departAt={"date": later.date().isoformat(), "time": f"{later:%H:%M}"}).status_code == 201
    spring = next_change(day, 3)
    err = error_of(post(departAt={"date": spring.isoformat(), "time": "01:30"}), 422)
    assert f"01:30 does not exist on {long_date(spring)}, when the clocks go forward. Choose another time." in json.dumps(err, ensure_ascii=False)
    autumn = next_change(day, 10)
    error_of(post(departAt={"date": autumn.isoformat(), "time": "01:30"}), 422, message="Choose which 01:30 you mean.")
    first = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, departAt={"date": autumn.isoformat(), "time": "01:30", "repeatedHour": "first"}))
    second = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, departAt={"date": autumn.isoformat(), "time": "01:30", "repeatedHour": "second"}))
    assert desk.ok("GET", f"/api/enquiries/{first['reference']}")["departInstant"] == f"{autumn.isoformat()}T00:30:00Z"
    assert desk.ok("GET", f"/api/enquiries/{second['reference']}")["departInstant"] == f"{autumn.isoformat()}T01:30:00Z"
    out = day + timedelta(days=30)
    for back in ("08:00", "07:45"):
        error_of(post(journeyType="return", departAt={"date": out.isoformat(), "time": "08:00"}, returnAt={"date": out.isoformat(), "time": back}), 422, message="The return has to be after the pick-up.")
    assert post(journeyType="return", departAt={"date": out.isoformat(), "time": "08:00"}, returnAt={"date": out.isoformat(), "time": "08:15"}).status_code == 201
    hire = make_hire(desk, stage="enquiry", depart={"date": autumn.isoformat(), "time": "01:30"})
    assert desk.ok("GET", f"/api/enquiries/{hire['id']}")["departInstant"] == f"{autumn.isoformat()}T00:30:00Z"
    error_of(desk.call("POST", "/api/hires", json={"customer": hire["customerBody"], "occasion": "company", "stops": [COVENTRY, NEC], "departAt": {"date": spring.isoformat(), "time": "01:30"}, "returnAt": None, "party": {"people": 47, "large": 0, "medium": 0, "hand": 0, "wheelchairs": 0}, "vehicles": [], "stage": "enquiry"}), 422)


def option_labels(page: Page, control: Locator) -> list[str]:
    if control.evaluate("e => e.tagName") == "SELECT":
        return [t.strip() for t in control.evaluate("e => [...e.options].map(o => o.textContent)")]
    click(control)
    soon(page, lambda: listed(page).count() > 0, "the list opens")
    labels = [t.strip() for t in listed(page).all_inner_texts()]
    page.keyboard.press("Escape")
    return labels


def test_pickup_clock_device_wrong(browser: Browser, app_url: str) -> None:
    day = today(app_url)
    with screen(browser, app_url, "/quote/route", size=WIDE) as page:
        click(role(role(page, "radiogroup", "Occasion"), "radio", "School"))
        fill_route_typed(page)
        click(visible(role(page, "button", "Next")))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/quote/when", "When and who")
        page.clock.set_fixed_time(server_now(app_url) + timedelta(days=3))
        page.reload()
        tomorrow_button = role(page, "button", "Tomorrow")
        click(tomorrow_button)
        out = role(page, "textbox", "Out date")
        soon(page, lambda: out.input_value() == typed(day + timedelta(days=1)), "Tomorrow by the server's UK date")
        expect(tomorrow_button).to_have_attribute("aria-pressed", "true")
        today_button = role(page, "button", "Today")
        click(today_button)
        soon(page, lambda: out.input_value() == typed(day), "Today by the server's UK date")
        expect(today_button).to_have_attribute("aria-pressed", "true")
        now_hour = server_now(app_url).astimezone(UK).hour
        hours = option_labels(page, role(page, "combobox", "Out hour"))
        numeric = [int(h) for h in hours if h.isdigit()]
        assert all(h >= now_hour for h in numeric), f"past hours removed by the server's clock: {hours}"
        autumn = next_change(day, 10)
        out.fill(typed(autumn))
        page.keyboard.press("Tab")
        select(role(page, "combobox", "Out hour"), "01")
        select(role(page, "combobox", "Out minutes"), "30")
        which = role(page, "radiogroup", "Which 01:30?")
        soon(page, lambda: which.count() == 1, "the repeated hour asks which")
        click(role(which, "radio", "Second 01:30 (GMT)"))
        expect(role(page, "complementary", "Journey ticket")).to_contain_text(f"{long_date(autumn)}, 01:30 (GMT)")


def test_request_limit_and_trap(app_url: str) -> None:
    _, email = fresh("limited")
    local, domain = email.split("@")
    maria = existing_desk(app_url, MARIA)
    received = []
    trap = httpx.post(app_url + "/api/public/enquiries", json=enquiry_body(app_url, email=email, website="https://spam.example"), timeout=HTTP_TIMEOUT)
    assert trap.status_code == 201 and REFERENCE.match(trap.json()["reference"])
    error_of(maria.call("GET", f"/api/enquiries/{trap.json()['reference']}"), 404)
    invalid_trap = httpx.post(app_url + "/api/public/enquiries", json={"website": "x", "email": email}, timeout=HTTP_TIMEOUT)
    assert invalid_trap.status_code == 201, "a filled trap gets 201 even with invalid fields"
    for i in range(5):
        variant = (local.upper() if i % 2 else local) + "@" + domain
        r = httpx.post(app_url + "/api/public/enquiries", json=enquiry_body(app_url, email=variant if i != 3 else f" {variant} "), timeout=HTTP_TIMEOUT)
        assert r.status_code == 201, r.text
        assert REFERENCE.match(r.json()["reference"])
        received.append(r.json()["receivedAt"])
    sixth = httpx.post(app_url + "/api/public/enquiries", json=enquiry_body(app_url, email=email), timeout=HTTP_TIMEOUT)
    expected = (instant_of(received[0]) + timedelta(seconds=3600)).astimezone(UK)
    rounded = expected if expected.second == 0 else expected.replace(second=0) + timedelta(minutes=1)
    said_time = {f"{rounded:%H:%M}"} if expected.second else {f"{rounded:%H:%M}", f"{rounded + timedelta(minutes=1):%H:%M}"}
    assert error_of(sixth, 429)["message"] in {f"You have sent several requests. Try again after {at}." for at in said_time}
    assert int(sixth.headers["retry-after"]) > 0
    rows = maria.ok("GET", "/api/enquiries", params={"q": email})["enquiries"]
    assert len(rows) <= 5
    bad_invalid = httpx.post(app_url + "/api/public/enquiries", json={"email": email, "name": ""}, timeout=HTTP_TIMEOUT)
    error_of(bad_invalid, 429)
    error_of(httpx.post(app_url + "/api/public/enquiries", content=json.dumps({"email": email}), headers={"content-type": "text/plain"}, timeout=HTTP_TIMEOUT), 415)
    error_of(httpx.post(app_url + "/api/public/enquiries", content=b'{"email":', headers={"content-type": "application/json"}, timeout=HTTP_TIMEOUT), 400)
    error_of(httpx.post(app_url + "/api/public/enquiries", json={"name": "no email"}, timeout=HTTP_TIMEOUT), 422)
    trap_at_limit = httpx.post(app_url + "/api/public/enquiries", json=enquiry_body(app_url, email=email, website="x"), timeout=HTTP_TIMEOUT)
    assert trap_at_limit.status_code == 201


def test_request_stored_as_sent(app_url: str) -> None:
    maria = existing_desk(app_url, MARIA)
    body = enquiry_body(app_url, name="Agnieszka Wiśniewska")
    raw = "{\n  " + ",\n     ".join(f"{json.dumps(k, ensure_ascii=False)} :  {json.dumps(v, ensure_ascii=False)}" for k, v in reversed(list(body.items()))) + "\n}\n"
    r = httpx.post(app_url + "/api/public/enquiries", content=raw.encode(), headers={"content-type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, r.text
    assert INSTANT.match(r.json()["receivedAt"])
    stored = maria.ok("GET", f"/api/enquiries/{r.json()['reference']}")
    assert stored["submittedBody"] == raw
    assert stored["customerName"] == "Agnieszka Wiśniewska"
    assert stored["state"] == "new"


@pytest.mark.timeout(240)
def test_request_limit_window_reopens(app_url: str) -> None:
    base = outage("APP_SHORT_URL")
    _, email = fresh("window")
    for _ in range(5):
        assert httpx.post(base + "/api/public/enquiries", json=enquiry_body(base, email=email), timeout=HTTP_TIMEOUT).status_code == 201
    r = httpx.post(base + "/api/public/enquiries", json=enquiry_body(base, email=email), timeout=HTTP_TIMEOUT)
    error_of(r, 429)
    assert int(r.headers["retry-after"]) <= 30
    def reopened() -> bool:
        return httpx.post(base + "/api/public/enquiries", json=enquiry_body(base, email=email), timeout=HTTP_TIMEOUT).status_code == 201
    poll(reopened, 45, "the sixth request is accepted once the oldest left the 30-second window")


def open_add_enquiry(page: Page) -> Locator:
    click(visible(role(page, "button", "Add enquiry")))
    box = role(page, "dialog", "Add enquiry")
    soon(page, lambda: box.count() == 1, "Add enquiry dialog")
    return box


def test_wf_address_lookup_combobox(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        finds: list[str] = []
        gets: list[str] = []
        page.on("request", lambda q: finds.append(q.url) if "/api/public/address/find" in q.url else (gets.append(q.url) if "/api/public/address/get/" in q.url else None))
        box = open_add_enquiry(page)
        combo = role(box, "combobox", "From")
        combo.click()
        combo.press_sequentially("Co")
        advance(page, DEBOUNCE_MS + 50)
        assert finds == [], "under three characters asks nothing"
        page.evaluate("() => { addEventListener('keydown', () => { window.__keyAt = performance.now(); }, true); }")
        combo.press_sequentially("v")
        soon(page, lambda: len(finds) == 1, "one ask 300 ms after the last key")
        gap = page.evaluate("(url) => { const e = performance.getEntriesByName(url).pop(); return e ? e.startTime - window.__keyAt : null; }", finds[0])
        assert gap is None or gap >= DEBOUNCE_FLOOR_MS, f"the ask waits for the pause: {gap} ms"
        options = listed(page)
        soon(page, lambda: options.count() == 6, "six suggestions")
        said(page, "6 suggestions.")
        expect(combo).to_have_attribute("aria-expanded", "true")
        page.keyboard.press("ArrowDown")
        active = combo.get_attribute("aria-activedescendant")
        assert active, "aria-activedescendant follows the list"
        assert page.evaluate("id => !!document.getElementById(id)", active)
        page.keyboard.press("Escape")
        soon(page, lambda: options.count() == 0, "Escape closes the list")
        assert box.is_visible(), "the dialog stays open"
        expect(combo).to_have_value("Cov")
        combo.press_sequentially("e")
        soon(page, lambda: len(finds) == 2, "a second text asks once more")
        page.keyboard.press("Backspace")
        advance(page, DEBOUNCE_MS + 50)
        soon(page, lambda: options.count() == 6, "the list for the first text again")
        assert len(finds) == 2, "typing A, B, A makes two calls"
        click(listed(page, COVENTRY))
        soon(page, lambda: len(gets) == 1, "choosing a suggestion asks for the full address")
        soon(page, lambda: combo.input_value() == COVENTRY, "the address as printed")
    assert len(wiremock.requests("/v1/get/ad-101")) >= 1, "the server asked the provider for the full address"


def test_wf_address_lookup_older_reply(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    stale_text = "Stale place from an older reply"
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        waiting: list[Any] = []

        def hold_first(route: Any) -> None:
            if not waiting:
                waiting.append(route)
            else:
                route.continue_()

        page.route("**/api/public/address/find*", hold_first)
        box = open_add_enquiry(page)
        combo = role(box, "combobox", "To")
        combo.click()
        combo.press_sequentially("Rug")
        advance(page, DEBOUNCE_MS + 50)
        soon(page, lambda: len(waiting) == 1, "first ask held")
        combo.press_sequentially("by")
        advance(page, DEBOUNCE_MS + 50)
        options = listed(page)
        soon(page, lambda: options.count() == 6, "the newer list")
        waiting[0].fulfill(json={"suggestions": [{"id": "ad-999", "text": stale_text}]})
        advance(page, 500)
        expect(listed(page, stale_text)).to_have_count(0)
        assert options.count() == 6


def test_wf_address_lookup_provider_down(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    wiremock.fault("GET", "/v1/find")
    name, email = fresh("typed")
    out = today(app_url) + timedelta(days=45)
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        box = open_add_enquiry(page)
        click(role(role(box, "radiogroup", "Occasion"), "radio", "Company"))
        combo = role(box, "combobox", "From")
        combo.click()
        combo.press_sequentially("9 Canal Street, Coventry")
        advance(page, DEBOUNCE_MS + 50)
        said(page, "We could not check this address. You can carry on and type it in full.")
        fill(role(box, "combobox", "To"), "4 Station Road, Rugby")
        fill(role(box, "textbox", "Out date"), typed(out))
        select(role(box, "combobox", "Out hour"), "08")
        select(role(box, "combobox", "Out minutes"), "15")
        fill(role(box, "spinbutton", "People"), "12")
        fill(role(box, "textbox", "Name"), name)
        fill(role(box, "textbox", "Email"), email)
        fill(role(box, "textbox", "Telephone"), "+44 1632 960155")
        click(role(box, "button", "Save enquiry"))
        said(page, "Enquiry added.")
        soon(page, lambda: box.count() == 0, "dialog closed")
        reference = desk.ok("GET", "/api/enquiries")["enquiries"][0]["reference"]
        stored = desk.ok("GET", f"/api/enquiries/{reference}")
        assert [s["checked"] for s in stored["stops"]] == [False, False]
        page.goto(f"{app_url}/enquiries/{reference}")
        shows(page, "Not checked")
        expect(h1(page, f"Enquiry {reference}")).to_be_visible()


@pytest.mark.timeout(1800)
def test_wf_address_lookup_screen_rules(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    def added() -> str:
        return str(desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url))["reference"])
    meets_screen_rules(browser, app_url, "/enquiries", "Add enquiry", "Add enquiry", desk=desk, main="Add enquiry", typed_into=("textbox", "Name"), endpoint="/api/enquiries", read=desk.ok("GET", "/api/enquiries"), change=added)
    sweep_routes(browser, app_url, "enquiries")


def test_address_provider_rules(app_url: str, wiremock: WireMock) -> None:
    before = len(wiremock.requests("/v1/find"))
    query = "Cov" + uuid.uuid4().hex[:8]
    r = httpx.get(app_url + "/api/public/address/find", params={"q": query}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    suggestions = r.json()["suggestions"]
    assert len(suggestions) == 6 and (suggestions[0]["id"], suggestions[0]["text"]) == ("ad-101", COVENTRY)
    assert len(wiremock.requests("/v1/find")) == before + 1
    assert query in json.dumps(wiremock.requests("/v1/find")[-1])
    error_of(httpx.get(app_url + "/api/public/address/find", params={"q": "Co"}, timeout=HTTP_TIMEOUT), 422)
    for address_id, line1, town, postcode in (("ad-101", "Coventry station", "Coventry", "CV1 2GT"), ("ad-102", "NEC", "Birmingham", "B40 1NT"), ("ad-103", "Solihull station", "Solihull", "B91 3RQ"), ("ad-105", "Rugby station", "Rugby", "CV21 3LA"), ("ad-106", "Nuneaton station", "Nuneaton", "CV11 4BU")):
        got = httpx.get(f"{app_url}/api/public/address/get/{address_id}", timeout=HTTP_TIMEOUT).json()
        assert (got["id"], got["line1"], got["town"], got["postcode"], got["text"]) == (address_id, line1, town, postcode, f"{line1}, {town} {postcode}")
    wiremock.stub("GET", "/v1/find", json={"suggestions": [{"id": "ad-101", "text": COVENTRY}]}, delay_ms=7000)
    started = time.monotonic()
    error_of(httpx.get(app_url + "/api/public/address/find", params={"q": "Slow"}, timeout=HTTP_TIMEOUT), 503)
    assert time.monotonic() - started < 7, "waits at most 5 seconds"
    wiremock.fault("GET", "/v1/find")
    error_of(httpx.get(app_url + "/api/public/address/find", params={"q": "Down"}, timeout=HTTP_TIMEOUT), 503)
    fresh_id = f"ad-{uuid.uuid4().int % 900000 + 100000}"
    wiremock.fault("GET", f"/v1/get/{fresh_id}")
    error_of(httpx.get(f"{app_url}/api/public/address/get/{fresh_id}", timeout=HTTP_TIMEOUT), 503)
    desk = new_desk(app_url)
    made = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, stops=[{"text": "9 Canal Street, Coventry", "checked": False}, {"text": NEC, "checked": True}]))
    stops = desk.ok("GET", f"/api/enquiries/{made['reference']}")["stops"]
    assert [(s["text"], s["checked"]) for s in stops] == [("9 Canal Street, Coventry", False), (NEC, True)]


def enquiries_on(desk: Desk, count: int) -> list[str]:
    return [make_hire(desk, stage="enquiry", vehicles=[], occasion="company" if i % 2 else "school")["id"] for i in range(count)]


def test_wf_enquiries_filters_back(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    references = enquiries_on(desk, PAGE_SIZE + 2)
    with open_app(browser, app_url + "/sign-in") as page:
        soon(page, lambda: focus_on_h1(page), "sign-in takes focus on its heading")
        fill(role(page, "textbox", "Email"), desk.info["email"])
        fill(labelled(page, "Password"), PASSWORD)
        click(role(page, "button", "Sign in"))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/enquiries" and h1(page, "Enquiries").count() == 1, "landing on /enquiries")
        expect(page).to_have_title("Enquiries | Wayticket")
        page.reload()
        expect(h1(page, "Enquiries")).to_be_visible()
        unfiltered = page.url
        click(role(role(page, "radiogroup", "Filter by state"), "radio", "New"))
        soon(page, lambda: page.url != unfiltered, "the filter in the address")
        filtered = page.url
        rows = page.get_by_role("link", name=REFERENCE)
        soon(page, lambda: rows.count() == PAGE_SIZE, "25 rows per page")
        click(role(page, "link", "Next page"))
        soon(page, lambda: page.url != filtered and rows.count() == 2, "the second page")
        paged = page.url
        page.reload()
        soon(page, lambda: rows.count() == 2, "a reload shows the same page")
        expect(role(role(page, "radiogroup", "Filter by state"), "radio", "New")).to_be_checked()
        click(role(page, "link", "Previous page"))
        soon(page, lambda: rows.count() == PAGE_SIZE, "the first page again")
        target = rows.nth(PAGE_SIZE - 1)
        target.scroll_into_view_if_needed()
        reference = target.inner_text().strip()
        y_before = page.evaluate("scrollY")
        history = page.evaluate("history.length")
        click(target)
        soon(page, lambda: h1(page, f"Enquiry {reference}").count() == 1, "the enquiry screen")
        assert page.evaluate("history.length") == history + 1, "one visit makes one history entry"
        page.go_back()
        link = role(page, "link", reference)
        soon(page, lambda: link.count() == 1 and link.evaluate("e => e === document.activeElement"), "focus on the row's link")
        expect(role(role(page, "radiogroup", "Filter by state"), "radio", "New")).to_be_checked()
        soon(page, lambda: abs(page.evaluate("scrollY") - y_before) <= 2, "the same scroll position")
    assert paged and len(references) == PAGE_SIZE + 2


def test_wf_enquiries_older_search(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    first = make_hire(desk, stage="enquiry", vehicles=[], customer={"name": "Alder Primary", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})["id"]
    second = make_hire(desk, stage="enquiry", vehicles=[], customer={"name": "Alderman Works", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})["id"]
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        waiting: list[Any] = []
        moved: list[str] = []

        def hold(route: Any) -> None:
            older = f"q={OLD_SEARCH}" in route.request.url and f"q={OLD_SEARCH}man" not in route.request.url
            if older and route.request.is_navigation_request():
                moved.append(route.request.url)
                route.fallback()
            elif older and not waiting and not moved:
                waiting.append(route)
            else:
                route.fallback()

        page.route("**/*", hold)
        search = role(page, "searchbox", "Search enquiries")
        search.click()
        search.press_sequentially("Alder")
        advance(page, DEBOUNCE_MS + 50)
        soon(page, lambda: waiting or (moved and OLD_SEARCH in urllib.parse.unquote(page.url)), "the older search sent")
        if moved:
            loaded(page)
        search.fill(f"{OLD_SEARCH}man")
        advance(page, DEBOUNCE_MS + 50)
        soon(page, lambda: role(page, "link", first).count() == 0 and role(page, "link", second).count() == 1, "the newer result")
        assert f"{OLD_SEARCH}man" in urllib.parse.unquote(page.url), "search text in the address"
        if waiting:
            if urllib.parse.urlsplit(waiting[0].request.url).path == "/api/enquiries":
                waiting[0].fulfill(json={"enquiries": [{"id": first, "reference": first, "customerName": "Alder Primary", "occasion": "school", "state": "new", "departAt": {"date": "2027-05-14", "time": "08:00"}, "departInstant": "2027-05-14T07:00:00Z", "createdAt": "2027-03-29T13:05:00Z"}], "nextCursor": None, "prevCursor": None})
            else:
                waiting[0].fallback()
        advance(page, 400)
        expect(role(page, "link", first)).to_have_count(0)
        expect(role(page, "link", second)).to_have_count(1)
        page.reload()
        soon(page, lambda: role(page, "link", second).count() == 1 and role(page, "link", first).count() == 0, "a reload keeps the search")


def test_wf_enquiries_refused_state(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    reference = make_hire(desk, stage="enquiry", vehicles=[])["id"]
    with screen(browser, app_url, f"/enquiries/{reference}", desk=desk) as page:
        bar = role(page, "radiogroup", "State")
        expect(bar).to_be_visible()
        expect(bar.get_by_role("radio")).to_have_count(5)
        won = role(bar, "radio", "Won")
        won.focus()
        with held(page, f"**/api/enquiries/{reference}") as gate:
            won.press("Space")
            shows(page, "Saving…")
            (gate.release if hasattr(gate, "release") else gate)()
        said(page, "That did not save. Try again.")
        expect(role(bar, "radio", "New")).to_be_checked()
        assert bar.evaluate("e => e.contains(document.activeElement)"), "focus still on the control"
        advance(page, REFRESH_MS + 100)
        assert "That did not save. Try again." in region_text(page), "a refresh does not overwrite the message"
        assert desk.ok("GET", f"/api/enquiries/{reference}")["state"] == "new"
        click(role(bar, "radio", "Priced"))
        said(page, "State saved.")
        assert desk.ok("GET", f"/api/enquiries/{reference}")["state"] == "priced"
    error_of(desk.call("PATCH", f"/api/enquiries/{reference}", json={"state": "won"}), 409)
    assert desk.ok("PATCH", f"/api/enquiries/{reference}", json={"state": "priced"})["state"] == "priced"


@pytest.mark.timeout(1800)
def test_wf_enquiries_screen_rules(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        shows(page, "No enquiries match these filters.")
    email = fresh()[1]
    a = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, email=email))["reference"]
    desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, email=email.upper()))
    meets_screen_rules(browser, app_url, f"/enquiries/{a}", "Merge", "Merge enquiries", desk=desk, endpoint=f"/api/enquiries/{a}", method="PATCH", read=desk.ok("GET", f"/api/enquiries/{a}"))
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        target = role(role(page, "radiogroup", "Filter by state"), "radio", "Won")
        state_mark(page, target, lambda: click(target))
    sweep_routes(browser, app_url, "enquiries", "enquiry")


def test_enquiry_list_stable(app_url: str) -> None:
    desk = new_desk(app_url)
    made = set(enquiries_on(desk, PAGE_SIZE + 5))
    first = desk.ok("GET", "/api/enquiries")
    assert len(first["enquiries"]) == PAGE_SIZE and first["nextCursor"] and first["prevCursor"] is None
    stamps = [row["createdAt"] for row in first["enquiries"]]
    assert stamps == sorted(stamps, reverse=True), "newest first"
    assert set(first["enquiries"][0]) >= {"id", "reference", "customerName", "occasion", "state", "departAt", "departInstant", "createdAt"}
    past_this_second(app_url)
    added = make_hire(desk, stage="enquiry", vehicles=[])["id"]
    second = desk.ok("GET", "/api/enquiries", params={"after": first["nextCursor"]})
    seen_first = [row["reference"] for row in first["enquiries"]]
    seen_second = [row["reference"] for row in second["enquiries"]]
    assert not set(seen_first) & set(seen_second), "no row repeats"
    assert set(seen_first) | set(seen_second) == made, "no row is skipped"
    assert second["nextCursor"] is None and second["prevCursor"]
    back = desk.ok("GET", "/api/enquiries", params={"before": second["prevCursor"]})
    assert set(seen_first[1:]) <= {row["reference"] for row in back["enquiries"]}, "the page before holds what came before"
    assert added in [row["reference"] for row in desk.ok("GET", "/api/enquiries")["enquiries"]]
    new_only = desk.ok("GET", "/api/enquiries", params={"state": "won"})
    assert new_only["enquiries"] == []
    company = desk.ok("GET", "/api/enquiries", params={"occasion": "company"})["enquiries"]
    assert company and all(row["occasion"] == "company" for row in company)


def test_enquiry_merge(app_url: str) -> None:
    desk = new_desk(app_url)
    email = fresh()[1]
    phone = fresh_phone()
    earlier = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, email=email, telephone=phone))["reference"]
    past_this_second(app_url)
    by_email = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, email=" " + email.upper(), telephone=fresh_phone()))["reference"]
    by_phone = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url, telephone="+44 " + phone[1:]))["reference"]
    other = desk.ok("POST", "/api/enquiries", 201, json=enquiry_body(app_url))["reference"]
    duplicates = {d["reference"] for d in desk.ok("GET", f"/api/enquiries/{earlier}")["duplicates"]}
    assert {by_email, by_phone} <= duplicates and other not in duplicates
    error_of(desk.call("POST", "/api/enquiries/merge", json={"enquiryIds": [earlier, other]}), 409)
    merged = desk.ok("POST", "/api/enquiries/merge", json={"enquiryIds": [by_email, earlier]})
    assert merged == {"kept": earlier, "merged": [by_email]}
    kept = desk.ok("GET", f"/api/enquiries/{by_email}")
    assert kept["reference"] == earlier and by_email in kept["mergedReferences"]
    assert by_email not in [row["reference"] for row in desk.ok("GET", "/api/enquiries")["enquiries"]]


FIVE_STOPS = [COVENTRY, "Solihull station, Solihull B91 3RQ", "Rugby station, Rugby CV21 3LA", NEC]


def trip_row_buttons(page: Page, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def test_wf_trip_plan_keyboard_reorder(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="enquiry", stops=FIVE_STOPS)
    trip = f"/enquiries/{hire['id']}/trip"
    desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")
    with screen(browser, app_url, trip, desk=desk) as page:
        expect(h1(page, f"Trip plan {hire['id']}")).to_be_visible()
        up = trip_row_buttons(page, "Move up")
        down = trip_row_buttons(page, "Move down")
        soon(page, lambda: up.count() == 4, "a Move up per row")
        expect(up.first).to_have_attribute("aria-disabled", "true")
        expect(down.last).to_have_attribute("aria-disabled", "true")
        calls = len(wiremock.requests("/v1/route"))
        target = down.nth(0)
        listen(page)
        target.focus()
        page.keyboard.press("Enter")
        soon(page, lambda: any(f"Stop 2 of 4: {COVENTRY.split(',')[0]}" in spoken for spoken in spoken_list(page)), "the stop's new place announced, which L504's route copy may replace at once")
        soon(page, lambda: [s["text"] for s in desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["stops"]][1] == COVENTRY, "the order is saved")
        soon(page, lambda: active_name(page) == "Move down", "focus stays on the pressed button")
        assert len(wiremock.requests("/v1/route")) == calls + 1, "one provider call per reorder"
        assert_published_motion(page)
        advance(page, REFRESH_MS + 100)
        assert active_name(page) == "Move down", "focus survives the refresh"
        order = lambda: [s["text"] for s in desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["stops"]]
        before = order()
        first_row, second_row = text_box(page, before[0]), text_box(page, before[1])
        start_x = first_row["x"] + first_row["width"] / 2
        mouse_drag(page, (start_x, first_row["y"] + first_row["height"] / 2), (start_x, second_row["y"] + second_row["height"] + 2))
        soon(page, lambda: order() != before, "a drag reorders the stops")
    with screen(browser, app_url, trip, size=PHONE, desk=desk) as page:
        before = order()
        first_row, second_row = text_box(page, before[0]), text_box(page, before[1])
        start_x = first_row["x"] + first_row["width"] / 2
        touch_drag(page, (start_x, first_row["y"] + first_row["height"] / 2), (start_x, second_row["y"] + second_row["height"] + 2))
        soon(page, lambda: order() != before, "touch reorders the stops")
        layout(page)


def test_wf_trip_plan_route_failure(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="enquiry", stops=FIVE_STOPS)
    good = desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")
    assert len(good["legs"]) == 3 and good["planOutOfDate"] is False
    with screen(browser, app_url, f"/enquiries/{hire['id']}/trip", desk=desk) as page:
        shows(page, "20.0")
        wiremock.fault("POST", "/v1/route")
        first_down = trip_row_buttons(page, "Move down").first
        first_down.focus()
        page.keyboard.press("Enter")
        said(page, "Route not updated. Showing the last good route.")
        shows(page, "Plan is out of date")
        failed = desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")
        assert failed["planOutOfDate"] is True and failed["legs"] == good["legs"]
        assert [s["text"] for s in failed["stops"]][1] == FIVE_STOPS[0], "the order is kept"
        error_of(desk.call("POST", f"/api/enquiries/{hire['id']}/trip/route", json={}), 503)
        wiremock.stub("POST", "/v1/route", json={"legs": [{"km": "16.09", "minutes": 20}, {"km": "16.09", "minutes": 20}, {"km": "16.09", "minutes": 20}]})
        url_before = page.url
        click(visible(role(page, "button", "Try route again")))
        said(page, "Route updated.")
        soon(page, lambda: "Plan is out of date" not in body_text(page), "the out-of-date mark clears")
        shows(page, str((Decimal("16.09") * Decimal("0.621371")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)))
        assert page.url == url_before, "updated in place with no navigation"
        assert desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["planOutOfDate"] is False


def test_wf_trip_plan_typed_plan(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="enquiry", vehicles=[], people=47)
    with screen(browser, app_url, f"/enquiries/{hire['id']}/trip", desk=desk) as page:
        plan = role(page, "textbox", "Plan")
        soon(page, lambda: plan.input_value().replace(" ", "") == "49", "Plan starts with the suggested sizes")
        fill(plan, "31")
        announced_twice(page, lambda: click(visible(role(page, "button", "Save plan"))), "This plan leaves 16 people without a seat.")
        expect(plan).to_have_value("31")
        expect(plan).to_have_attribute("aria-invalid", "true")
        problems = role(page, "group", "Problems")
        click(role(problems, "link", "This plan leaves 16 people without a seat."))
        soon(page, lambda: plan.evaluate("e => e === document.activeElement"), "the Problems link moves focus")
        fill(plan, "50")
        click(visible(role(page, "button", "Save plan")))
        said(page, "Choose sizes from 8, 12, 16, 31, 49, 56 and 70.")
        fill(plan, "56")
        click(visible(role(page, "button", "Save plan")))
        said(page, "Plan saved.")
        shows(page, "Larger than needed")
    saved = desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["plan"]
    assert saved["sizes"] == [56] and saved["largerThanNeeded"] is True and saved["suggested"] == [49]


@pytest.mark.timeout(1800)
def test_wf_trip_plan_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="enquiry", people=47)
    ladder_holds(app_url, f"/api/enquiries/{hire['id']}/trip/plan", JSON_LIMIT, "application/json", "PUT")
    whole_seconds(desk.ok("GET", f"/api/enquiries/{hire['id']}/trip"))
    with screen(browser, app_url, f"/enquiries/{hire['id']}/trip", size=PHONE, desk=desk) as page:
        layout(page)
        assert_touch_targets(page)
        axe(page)
        menu = role(page, "button", "Menu")
        expect(role(page, "navigation", "Desk")).to_have_count(0)
        tap(menu)
        soon(page, lambda: role(page, "navigation", "Desk").count() == 1, "the desk Menu sheet")
        page.evaluate("document.getAnimations().forEach(a => a.finish())")
        axe(page)
        page.keyboard.press("Escape")
        soon(page, lambda: role(page, "navigation", "Desk").count() == 0, "closed sheet hidden and inert")
        assert menu.evaluate("e => e === document.activeElement")
        assert_published_motion(page)
    desk.refresh()
    meets_screen_rules(browser, app_url, f"/enquiries/{hire['id']}/bids", "Ask operators", "Ask operators", desk=desk, main="Ask operators")
    sweep_routes(browser, app_url, "trip")


def test_fewest_vehicles_examples(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    cases = [
        ({"people": 98}, [49, 49]), ({"people": 137}, [70, 70]), ({"people": 100}, [70, 31]),
        ({"people": 60, "wheelchairs": 2}, [49, 12]), ({"people": 30, "wheelchairs": 3}, [16, 16]),
        ({"people": 20, "large": 50}, [70, 8]), ({"people": 12, "large": 20}, [31]),
    ]
    for party, expected in cases:
        full = {"people": 1, "large": 0, "medium": 0, "hand": 0, "wheelchairs": 0, **party}
        hire = make_hire(desk, stage="enquiry", vehicles=[], party=full)
        plan = desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["plan"]
        assert plan["suggested"] == expected, f"{party}: {plan}"
        assert plan["sizes"] is None and plan["largerThanNeeded"] is False


def test_larger_plan_marked(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="enquiry", vehicles=[], people=47)
    url = f"/api/enquiries/{hire['id']}/trip/plan"
    for sizes, larger in (([56], True), ([31, 16], True), ([49], False)):
        plan = desk.ok("PUT", url, json={"sizes": sizes})["plan"]
        assert plan["sizes"] == sizes and plan["largerThanNeeded"] is larger and plan["suggested"] == [49]
    err = error_of(desk.call("PUT", url, json={"sizes": [31]}), 422, message="This plan leaves 16 people without a seat.")
    assert "sizes" in err["fields"]
    assert desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["plan"]["sizes"] == [49]
    error_of(desk.call("PUT", url, json={"sizes": [50]}), 422, message="Choose sizes from 8, 12, 16, 31, 49, 56 and 70.")
    tight = make_hire(desk, stage="enquiry", vehicles=[], party={"people": 9, "large": 10, "medium": 0, "hand": 0, "wheelchairs": 1})
    url = f"/api/enquiries/{tight['id']}/trip/plan"
    error_of(desk.call("PUT", url, json={"sizes": [8]}), 422, message="This plan leaves 1 person without a seat.")
    error_of(desk.call("PUT", url, json={"sizes": [12]}), 422, message="Bags need 6 more units of space.")
    error_of(desk.call("PUT", url, json={"sizes": [31]}), 422, message="This plan has no lift for 1 wheelchair user.")


def test_miles_half_up(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    for km in ("32.2", "16.09", "0.0805", "2.4136", "120.7"):
        wiremock.stub("POST", "/v1/route", json={"legs": [{"km": km, "minutes": 38}]})
        hire = make_hire(desk, stage="enquiry", vehicles=[])
        leg = desk.ok("GET", f"/api/enquiries/{hire['id']}/trip")["legs"][0]
        expected = (Decimal(km) * Decimal("0.621371")).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
        assert leg["km"] == km and leg["minutes"] == 38
        assert leg["miles"] == f"{expected}", f"{km} km: {leg}"


def test_wf_operators_refresh_and_upload(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/operators", desk=desk) as page:
        shows(page, "No operators yet. Press Refresh directory.")
        wait_working(page, visible(role(page, "button", "Refresh directory")), "**/api/operators/refresh", "Refresh directory")
        frame = named_frame(page, "Operators list")
        soon(page, lambda: "Hereford Cider Mill Travel" in frame.inner_text(), "the directory rows in the named frame")
        row = frame.get_by_role("row").filter(has_text="Hanley Motor Services")
        click(role(row, "button", "Upload paper"))
        box = role(page, "dialog", "Upload paper")
        soon(page, lambda: box.count() == 1, "Upload paper")
        select(role(box, "combobox", "Paper"), "Operator licence")
        fill(role(box, "textbox", "Ends on"), "31/12/2028")
        labelled(box, "File").set_input_files({"name": "licence.pdf", "mimeType": "application/pdf", "buffer": b"not really a paper"})
        announced_twice(page, lambda: click(role(box, "button", "Store paper")), "This file is not a PDF, JPEG or PNG.")
        assert box.is_visible(), "a dialog refused by the server stays open"
        expect(role(box, "textbox", "Ends on")).to_have_value(typed(date(2028, 12, 31)))
        data = PDF_BYTES + uuid.uuid4().bytes
        labelled(box, "File").set_input_files({"name": "licence.pdf", "mimeType": "application/pdf", "buffer": data})
        click(role(box, "button", "Store paper"))
        soon(page, lambda: box.count() == 0, "dialog closes after storing")
        row = frame.get_by_role("row").filter(has_text="Hanley Motor Services")
        click(role(row, "button", "Set DBS date"))
        box = role(page, "dialog", "Set DBS date")
        fill(role(box, "textbox", "Checked on"), "2026/01/15")
        click(role(box, "button", "Save date"))
        soon(page, lambda: "Enter a date as DD/MM/YYYY." in box.inner_text(), "the refusal in the dialog's Problems links (L379)")
        fill(role(box, "textbox", "Checked on"), "15/01/2026")
        click(role(box, "button", "Save date"))
        soon(page, lambda: box.count() == 0, "date saved")
    operator = next(o for o in desk.ok("GET", "/api/operators")["operators"] if o["id"] == "OP-1001")
    assert operator["dbsCheckedOn"] == "2026-01-15"
    paper = next(p for p in operator["papers"] if p["kind"] == "operatorLicence")
    assert paper["endsOn"] == "2028-12-31" and paper["stored"] is True
    assert paper["objectKey"].startswith(f"desks/{desk.info['id']}/operators/OP-1001/operatorLicence/")
    assert S3().get(paper["objectKey"]) == data
    assert desk.call("GET", "/api/operators/OP-1001/papers/operatorLicence/file").content == data
    hire = make_hire(desk, stage="enquiry", vehicles=[])
    standing = {o["id"]: o for o in desk.ok("GET", f"/api/hires/{hire['id']}/operators")["operators"]}
    assert standing["OP-1001"]["clear"] is False and standing["OP-1001"]["reason"] == "Public liability cover is missing."


def test_wf_operators_minio_outage(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_MINIO_DOWN_URL")
    desk = new_desk(base)
    desk.refresh()
    with screen(browser, base, "/operators", desk=desk) as page:
        frame = named_frame(page, "Operators list")
        soon(page, lambda: "Hanley Motor Services" in frame.inner_text(), "the directory")
        row = frame.get_by_role("row").filter(has_text="Hanley Motor Services")
        click(role(row, "button", "Upload paper"))
        box = role(page, "dialog", "Upload paper")
        select(role(box, "combobox", "Paper"), "Operator licence")
        fill(role(box, "textbox", "Ends on"), "31/12/2028")
        labelled(box, "File").set_input_files({"name": "l.pdf", "mimeType": "application/pdf", "buffer": PDF_BYTES})
        click(role(box, "button", "Store paper"))
        said(page, "The file store is unavailable right now. Nothing was saved.")
        assert box.is_visible() and role(box, "textbox", "Ends on").input_value() == typed(date(2028, 12, 31))
    error_of(upload(desk, "OP-1002", "operatorLicence", "2028-12-31"), 503, message="The file store is unavailable right now. Nothing was saved.")
    for operator in desk.ok("GET", "/api/operators")["operators"]:
        assert operator["papers"] == [] or all(p["stored"] is False for p in operator["papers"])


@pytest.mark.timeout(1800)
def test_wf_operators_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    desk.refresh()
    def prepare(page: Page) -> None:
        soon(page, lambda: named_frame(page, "Operators list").count() == 1, "the named frame")
    meets_screen_rules(browser, app_url, "/operators", "Upload paper", "Upload paper", desk=desk, main="Refresh directory", prepare=prepare, typed_into=("textbox", "Ends on"), read=desk.ok("GET", "/api/operators"), endpoint="/api/operators/OP-1001/papers", limit=MULTIPART_LIMIT, ctype="multipart/form-data; boundary=x")
    with screen(browser, app_url, "/operators", size=PHONE, desk=desk) as page:
        frame = named_frame(page, "Operators list")
        frame.focus()
        assert frame.evaluate("e => e === document.activeElement"), "the frame takes keyboard focus"
        layout(page)


def test_directory_all_or_nothing(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    pages_before = len(wiremock.requests("/v2/operators"))
    rows = desk.refresh()
    assert len(wiremock.requests("/v2/operators")) == pages_before + 3, "all three provider pages read"
    assert [o["id"] for o in rows] == [f"OP-{1001 + i}" for i in range(24)]
    for i, (operator, (name, town, sizes)) in enumerate(zip(rows, DIRECTORY_ROWS)):
        assert (operator["name"], operator["town"], operator["sizes"]) == (name, town, sizes)
        assert operator["email"] == f"desk@op-{1001 + i}.example" and operator["telephone"] == f"01632 {960200 + i}" and operator["listed"] is True
    before = desk.ok("GET", "/api/operators")
    second = new_desk(app_url)
    wiremock.stub("GET", "/v2/operators", status=500, json={"failed": True}, query={"cursor": "p2"})
    error_of(desk.call("POST", "/api/operators/refresh", json={}), 503, message="The directory could not be read. Your list has not changed.")
    assert desk.ok("GET", "/api/operators") == before, "one failing page leaves the list exactly as it was"
    error_of(second.call("POST", "/api/operators/refresh", json={}), 503)
    assert second.ok("GET", "/api/operators")["operators"] == [], "no partial list on a fresh desk"
    wiremock.stub("GET", "/v2/operators", json={"operators": [{"id": "OP-1011", "name": "Hinckley Boot Travel", "town": "Hinckley", "email": "desk@op-1011.example", "telephone": "01632 960210", "sizes": [8, 16]}], "nextCursor": None}, query={"cursor": "p2"})
    after = {o["id"]: o for o in desk.refresh()}
    assert after["OP-1011"]["listed"] is True and after["OP-1012"]["listed"] is False and after["OP-1024"]["listed"] is False
    assert after["OP-1024"]["name"] == "Hereford Cider Mill Travel", "a row the directory no longer names stays"
    hire = make_hire(desk, stage="enquiry", vehicles=[])
    standing = {o["id"]: o for o in desk.ok("GET", f"/api/hires/{hire['id']}/operators")["operators"]}
    assert standing["OP-1024"]["clear"] is False and standing["OP-1024"]["reason"] == "No longer listed"


def test_papers_judged_by_bytes(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    desk.refresh()
    error_of(desk.call("GET", "/api/operators/OP-1001/papers/operatorLicence/file"), 404)
    for data, filename, stated, judged in (
        (PDF_BYTES + b"\x00\xff", "paper.png", "image/png", "application/pdf"),
        (PNG_BYTES + b"\x00\xff", "paper.pdf", "application/pdf", "image/png"),
        (JPEG_BYTES + b"\x00\xff", "paper.txt", "text/plain", "image/jpeg"),
    ):
        r = upload(desk, "OP-1001", "operatorLicence", "2028-12-31", data, filename, stated)
        assert r.status_code == 201, r.text
        assert r.json()["stored"] is True
        got = desk.call("GET", "/api/operators/OP-1001/papers/operatorLicence/file")
        assert got.status_code == 200 and got.content == data and got.headers["content-type"].startswith(judged)
        assert S3().get(r.json()["objectKey"]) == data
    keys_before = S3().keys(f"desks/{desk.info['id']}/operators/OP-1002/")
    for data, filename, stated in ((b"<svg onload='alert(1)'></svg>", "paper.pdf", "application/pdf"), (b"MZ executable", "paper.jpg", "image/jpeg"), (b"plain text", "../../evil.png", "image/png")):
        error_of(upload(desk, "OP-1002", "operatorLicence", "2028-12-31", data, filename, stated), 422, message="This file is not a PDF, JPEG or PNG.")
    assert S3().keys(f"desks/{desk.info['id']}/operators/OP-1002/") == keys_before == []
    operator = next(o for o in desk.ok("GET", "/api/operators")["operators"] if o["id"] == "OP-1002")
    assert operator["papers"] == []


def test_paper_size_limits(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    desk.refresh()
    exact = PDF_BYTES + b"x" * (PAPER_LIMIT - len(PDF_BYTES))
    r = upload(desk, "OP-1003", "operatorLicence", "2028-12-31", exact)
    assert r.status_code == 201, r.text
    assert S3().get(r.json()["objectKey"]) == exact
    over = PDF_BYTES + b"x" * (PAPER_LIMIT + 1 - len(PDF_BYTES))
    r = httpx.post(f"{app_url}/api/operators/OP-1003/papers", data={"kind": "operatorLicence", "endsOn": "2028-12-31"}, files={"file": ("p.pdf", over, "application/pdf")}, timeout=HTTP_TIMEOUT)
    error_of(r, 413)
    r = upload(desk, "OP-1004", "operatorLicence", "2028-12-31", over)
    error_of(r, 413)
    assert S3().keys(f"desks/{desk.info['id']}/operators/OP-1004/") == []
    big = b"--x\r\nContent-Disposition: form-data; name=\"other\"\r\n\r\n" + b"y" * (MULTIPART_LIMIT + 1) + b"\r\n--x--\r\n"
    r = httpx.post(f"{app_url}/api/operators/OP-1003/papers", content=big, headers={"content-type": "multipart/form-data; boundary=x"}, timeout=HTTP_TIMEOUT)
    error_of(r, 413)
    assert "json" in r.headers["content-type"]


def test_clear_for_last_day(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    desk.refresh()
    last = date(2027, 5, 14)
    hire = make_hire(desk, stage="enquiry", vehicles=[], occasion="school", depart={"date": "2027-05-13", "time": "08:00"}, ret={"date": last.isoformat(), "time": "17:00"})
    def standing(operator: str) -> dict[str, Any]:
        return next(o for o in desk.ok("GET", f"/api/hires/{hire['id']}/operators")["operators"] if o["id"] == operator)
    first = standing("OP-1001")
    assert (first["id"], first["name"], first["clear"], first["reason"]) == ("OP-1001", "Hanley Motor Services", False, "Operator licence is missing.")
    day_before = last - timedelta(days=1)
    assert upload(desk, "OP-1001", "operatorLicence", day_before.isoformat()).status_code == 201
    assert standing("OP-1001")["reason"] == f"Operator licence ends {long_date(day_before)}, before this hire's last day."
    assert upload(desk, "OP-1001", "operatorLicence", last.isoformat()).status_code == 201
    assert standing("OP-1001")["reason"] == "Public liability cover is missing."
    assert upload(desk, "OP-1001", "publicLiabilityCover", day_before.isoformat()).status_code == 201
    assert standing("OP-1001")["reason"] == f"Public liability cover ends {long_date(day_before)}, before this hire's last day."
    assert upload(desk, "OP-1001", "publicLiabilityCover", last.isoformat()).status_code == 201
    assert standing("OP-1001")["reason"] == "Driver DBS check is missing."
    desk.ok("PUT", "/api/operators/OP-1001/dbs", json={"checkedOn": "2024-05-13"})
    assert standing("OP-1001")["reason"] == "Driver DBS check is older than three years on this hire's last day."
    desk.ok("PUT", "/api/operators/OP-1001/dbs", json={"checkedOn": "2024-05-14"})
    assert standing("OP-1001")["clear"] is True and standing("OP-1001")["reason"] is None
    company = make_hire(desk, stage="enquiry", vehicles=[], occasion="company", depart={"date": last.isoformat(), "time": "08:00"})
    make_clear(desk, "OP-1002")
    row = next(o for o in desk.ok("GET", f"/api/hires/{company['id']}/operators")["operators"] if o["id"] == "OP-1002")
    assert row["clear"] is True, "only school hires need the DBS check"


def test_expiry_mail_once(app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    base = outage("APP_SHORT_URL")
    desk = new_desk(base)
    desk.refresh()
    day = today(base)
    inside = day + timedelta(days=30)
    outside = day + timedelta(days=31)
    assert upload(desk, "OP-1001", "operatorLicence", inside.isoformat()).status_code == 201
    assert upload(desk, "OP-1002", "publicLiabilityCover", outside.isoformat()).status_code == 201
    assert upload(desk, "OP-1003", "publicLiabilityCover", day.isoformat()).status_code == 201
    to = desk.info["email"]
    first = f"Operator licence for Hanley Motor Services ends on {long_date(inside)}"
    second = f"Public liability cover for Nuneaton Road Travel ends on {long_date(day)}"
    assert len(mails(mail, to=to, subject=first, count=1)) == 1
    assert len(mails(mail, to=to, subject=second, count=1)) == 1
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        current = mails(mail, to=to)
    subjects = [m["Subject"] for m in current]
    assert subjects.count(first) == 1 and subjects.count(second) == 1, "never a second mail for a paper"
    assert not [s for s in subjects if "Arden Vale Coaches" in s], "no mail at 31 days"


def bid_setup(desk: Desk, *operators: str, occasion: str = "company") -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    desk.refresh()
    hire = make_hire(desk, stage="enquiry", occasion=occasion)
    if operators:
        return hire, ask(desk, hire["id"], *operators)
    return hire, {}


def test_wf_operator_bids_happy(browser: Browser, app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire, _ = bid_setup(desk)
    make_clear(desk, "OP-1001", "OP-1002")
    reference = hire["id"]
    with screen(browser, app_url, f"/enquiries/{reference}/bids", desk=desk) as page:
        shows(page, "No bids yet.")
        click(visible(role(page, "button", "Ask operators")))
        box = role(page, "dialog", "Ask operators")
        soon(page, lambda: box.count() == 1, "Ask operators")
        for name in ("Hanley Motor Services", "Arden Vale Coaches"):
            click(box.get_by_role("checkbox", name=re.compile(name)))
        click(role(box, "button", "Send asks"))
        said(page, "Operators asked.")
        asked = mails(mail, subject=f"Price request {reference}", count=2)
        assert sorted(addresses(m["To"])[0] for m in asked) == ["desk@op-1001.example", "desk@op-1002.example"]
        link = {addresses(m["To"])[0]: re.search(r"/b/[^\s\"<>]+", text(m)).group(0) for m in asked}
        for m in asked:
            body = text(m)
            assert hire["customerBody"]["name"] not in body and hire["customerBody"]["email"] not in body
            assert COVENTRY in body and NEC in body and "47" in body
        with screen(browser, app_url, link["desk@op-1001.example"], size=PHONE) as operator:
            expect(h1(operator, "Price this hire")).to_be_visible()
            expect(operator).to_have_title("Price this hire")
            shows(operator, COVENTRY)
            price = role(operator, "textbox", "Price for vehicle 1")
            fill(price, "12,50")
            announced_twice(operator, lambda: click(visible(role(operator, "button", "Send price"))), "Enter the price in pounds and pence.")
            expect(price).to_have_value("12,50")
            fill(price, "1,250.50")
            click(visible(role(operator, "button", "Send price")))
            said(operator, "Price sent.")
            fill(price, "1100")
            click(visible(role(operator, "button", "Change price")))
            said(operator, "Price changed.")
        with screen(browser, app_url, link["desk@op-1002.example"], size=PHONE) as operator:
            fill(role(operator, "textbox", "Price for vehicle 1"), "1040")
            click(visible(role(operator, "button", "Send price")))
            said(operator, "Price sent.")
            click(role(operator, "button", "Withdraw bid"))
            dialog = role(operator, "dialog", "Withdraw bid")
            soon(operator, lambda: dialog.count() == 1, "Withdraw bid")
            click(role(dialog, "button", "Confirm withdrawal"))
            said(operator, "Bid withdrawn.")
            fill(role(operator, "textbox", "Price for vehicle 1"), "1200.00")
            click(visible(role(operator, "button", "Send price")))
            said(operator, "Price sent.")
        frame = role(page, "region", "Bids")
        soon(page, lambda: re.search(r"1,?100\.00", frame.inner_text()), "the bids reach the desk by the refresh")
        rows = desk.ok("GET", f"/api/enquiries/{reference}/bids?sort=priceLowest")["bids"]
        assert [(b["operatorId"], b["status"], b["prices"]) for b in rows] == [("OP-1001", "open", ["1100.00"]), ("OP-1002", "open", ["1200.00"])]
        assert desk.ok("GET", f"/api/enquiries/{reference}")["state"] == "priced"
        row = frame.get_by_role("row").filter(has_text="Hanley Motor Services")
        click(role(row, "button", "Award"))
        said(page, "Awarded to Hanley Motor Services.")
    awarded = desk.ok("GET", f"/api/hires/{reference}")
    assert awarded["awarded"]["operatorId"] == "OP-1001" and awarded["vehicles"][0]["boughtPrice"] == "1100.00" and awarded["vehicles"][0]["marginPercent"] == "15"
    assert len(awarded["runs"]) == 1
    closing = mails(mail, subject=f"Hire {reference} has closed", count=1)
    assert [addresses(m["To"])[0] for m in closing] == ["desk@op-1002.example"]


def test_wf_operator_bids_not_clear(browser: Browser, app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire, asks = bid_setup(desk, "OP-1013", "OP-1001")
    reference = hire["id"]
    assert httpx.put(app_url + api_path(asks["OP-1013"]["bidPath"]) + "/bid", json={"prices": ["900"]}, timeout=HTTP_TIMEOUT).status_code == 200
    with screen(browser, app_url, f"/enquiries/{reference}/bids", desk=desk) as page:
        frame = role(page, "region", "Bids")
        row = frame.get_by_role("row").filter(has_text="Warwick Bear Minibuses")
        soon(page, lambda: "Operator licence is missing." in row.inner_text(), "the operator's reason")
        click(role(row, "button", "Award"))
        said(page, "Operator licence is missing.")
    error_of(desk.call("POST", f"/api/enquiries/{reference}/award", json={"operatorId": "OP-1013"}), 409, "operatorNotClear", "Operator licence is missing.")
    error_of(desk.call("POST", f"/api/enquiries/{reference}/award", json={"operatorId": "OP-1001"}), 409, "noBid", "Hanley Motor Services has no price on this hire.")
    assert desk.ok("GET", f"/api/enquiries/{reference}/bids")["awarded"] is None
    assert mails(mail, subject=f"Hire {reference} has closed", count=0, seconds=1) == []
    unplanned = make_hire(desk, stage="enquiry", vehicles=[])
    error_of(desk.call("POST", f"/api/enquiries/{unplanned['id']}/bids/ask", json={"operatorIds": ["OP-1001"]}), 409, "noPlan", "Save a plan before asking operators.")


def test_wf_operator_bids_frame_and_sort(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire, asks = bid_setup(desk, "OP-1001", "OP-1002", "OP-1003")
    reference = hire["id"]
    for operator, price in (("OP-1001", "1250"), ("OP-1002", "1100")):
        assert httpx.put(app_url + api_path(asks[operator]["bidPath"]) + "/bid", json={"prices": [price]}, timeout=HTTP_TIMEOUT).status_code == 200
    with screen(browser, app_url, f"/enquiries/{reference}/bids", size=PHONE, desk=desk) as page:
        frame = role(page, "region", "Bids")
        soon(page, lambda: "Hanley Motor Services" in frame.inner_text(), "the bids")
        content = frame.inner_text()
        assert content.index("Arden Vale Coaches") < content.index("Hanley Motor Services") < content.index("Nuneaton Road Travel"), "priceLowest with unpriced last"
        frame.focus()
        assert frame.evaluate("e => e === document.activeElement"), "the frame takes keyboard focus"
        layout(page)
        click(role(page, "link", "Sort by price"))
        soon(page, lambda: "sort=priceHighest" in page.url, "the sort in the address")
        def highest_first() -> bool:
            shown_now = frame.inner_text()
            return "Hanley Motor Services" in shown_now and "Arden Vale Coaches" in shown_now and shown_now.index("Hanley Motor Services") < shown_now.index("Arden Vale Coaches")
        soon(page, highest_first, "priceHighest order")
        page.reload()
        soon(page, lambda: "Hanley Motor Services" in frame.inner_text(), "the bids after a reload")
        content = frame.inner_text()
        assert content.index("Hanley Motor Services") < content.index("Arden Vale Coaches") < content.index("Nuneaton Road Travel")
    highest = desk.ok("GET", f"/api/enquiries/{reference}/bids", params={"sort": "priceHighest"})["bids"]
    assert [b["operatorId"] for b in highest] == ["OP-1001", "OP-1002", "OP-1003"]
    assert highest[2]["prices"] == [] and highest[2]["total"] is None and highest[2]["receivedAt"] is None and highest[2]["status"] == "asked"


@pytest.mark.timeout(1800)
def test_wf_operator_bids_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire, asks = bid_setup(desk, "OP-1001")
    def priced() -> str:
        assert httpx.put(app_url + api_path(asks["OP-1001"]["bidPath"]) + "/bid", json={"prices": ["1250"]}, timeout=HTTP_TIMEOUT).status_code == 200
        return "1,250.00"
    meets_screen_rules(browser, app_url, f"/enquiries/{hire['id']}/bids", "Ask operators", "Ask operators", desk=desk, main="Ask operators", endpoint=f"/api/enquiries/{hire['id']}/award", read=desk.ok("GET", f"/api/enquiries/{hire['id']}/bids"), change=priced)
    sweep_routes(browser, app_url, "bids", "b")


def test_bid_page_one_hire(browser: Browser, app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = {"name": "Unique Bid Customer", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"}
    desk.refresh()
    hire = make_hire(desk, stage="enquiry", customer=customer, occasion="company", depart={"date": "2027-05-14", "time": "08:00"}, ret={"date": "2027-05-14", "time": "17:00"})
    asks = ask(desk, hire["id"], "OP-1001", "OP-1002")
    path = asks["OP-1001"]["bidPath"]
    assert INSTANT.match(asks["OP-1001"]["closesAt"]) and INSTANT.match(asks["OP-1001"]["sentAt"])
    again = ask(desk, hire["id"], "OP-1001")
    assert again["OP-1001"]["bidPath"] == path, "an operator already asked keeps its ask"
    got = httpx.get(app_url + api_path(path), timeout=HTTP_TIMEOUT)
    assert got.status_code == 200
    body = got.json()
    assert set(body) == {"route", "dates", "vehicles", "partySize", "closesAt", "bid"}
    assert body["route"] == {"stops": [COVENTRY, NEC]} and body["vehicles"] == [{"index": 1, "seats": 49}] and body["partySize"] == 47 and body["bid"] is None
    assert body["dates"]["departInstant"] == utc_text("2027-05-14", "07:00")
    forbidden = ("Unique Bid Customer", customer["email"], customer["telephone"], "Arden Vale Coaches", "marginPercent")
    assert not any(word in got.text for word in forbidden)
    assert len(mails(mail, subject=f"Price request {hire['id']}", count=2)) == 2
    with screen(browser, app_url, page_path(path), size=PHONE) as page:
        answers: list[Any] = []
        page.on("response", lambda r: answers.append(r) if "/api/" in r.url and r.ok else None)
        role(page, "textbox", "Price for vehicle 1").fill("1250")
        click(visible(role(page, "button", "Send price")))
        said(page, "Price sent.")
        advance(page, REFRESH_MS + 100)
        html = page.content()
        seen = []
        for answer in answers:
            with contextlib.suppress(PlaywrightError):
                seen.append(answer.text())
        assert not any(word in html or any(word in s for s in seen) for word in forbidden)
        expect(role(page, "navigation", "Desk")).to_have_count(0)
    other_page = httpx.put(app_url + api_path(path) + "/bid", json={"prices": ["1300"]}, timeout=HTTP_TIMEOUT)
    assert other_page.status_code == 200 and other_page.json()["bid"]["prices"] == ["1300.00"]
    error_of(httpx.get(app_url + "/api/b/never-existed-token", timeout=HTTP_TIMEOUT), 404)
    assert httpx.get(app_url + "/b/never-existed-token", timeout=HTTP_TIMEOUT).status_code == 404
    assert desk.ok("GET", f"/api/enquiries/{hire['id']}/bids")["bids"][0]["prices"] == ["1300.00"]


def test_bid_price_grammar(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire, asks = bid_setup(desk, "OP-1001")
    url = app_url + api_path(asks["OP-1001"]["bidPath"]) + "/bid"
    for typed_price, stored in (("1250", "1250.00"), ("1,250", "1250.00"), ("1250.5", "1250.50"), ("1,250.50", "1250.50")):
        r = httpx.put(url, json={"prices": [typed_price]}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json()["bid"]["prices"] == [stored], r.text
        assert INSTANT.match(r.json()["bid"]["receivedAt"])
    before = desk.ok("GET", f"/api/enquiries/{hire['id']}/bids")["bids"]
    for bad in ("1250.555", "-1250", "£1250", "12,50", "abc", ""):
        error_of(httpx.put(url, json={"prices": [bad]}, timeout=HTTP_TIMEOUT), 422)
    error_of(httpx.put(url, json={"prices": ["1250", "1300"]}, timeout=HTTP_TIMEOUT), 422)
    error_of(httpx.put(url, json={"prices": []}, timeout=HTTP_TIMEOUT), 422)
    assert desk.ok("GET", f"/api/enquiries/{hire['id']}/bids")["bids"] == before, "refused prices change nothing"
    r = httpx.put(url, json={"prices": ["1000"], "marginPercent": "50", "status": "withdrawn", "operatorId": "OP-1002", "total": "1.00", "closesAt": "2099-01-01T00:00:00Z"}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200
    row = desk.ok("GET", f"/api/enquiries/{hire['id']}/bids")["bids"][0]
    stored_price = f"{Decimal('1000'):.2f}"
    assert row["operatorId"] == "OP-1001" and row["status"] == "open" and row["prices"] == [stored_price] and row["total"] == stored_price and row["closesAt"] == asks["OP-1001"]["closesAt"]
    assert httpx.delete(url, timeout=HTTP_TIMEOUT).status_code == 204
    error_of(httpx.delete(url, timeout=HTTP_TIMEOUT), 409, "noBid")
    row = desk.ok("GET", f"/api/enquiries/{hire['id']}/bids")["bids"][0]
    assert row["status"] == "withdrawn" and row["prices"] == []
    assert httpx.put(url, json={"prices": ["900"]}, timeout=HTTP_TIMEOUT).json()["bid"]["prices"] == ["900.00"]


@pytest.mark.timeout(180)
def test_bid_window_edge(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_SHORT_URL")
    desk = new_desk(base)
    desk.refresh()
    make_clear(desk, "OP-1001")
    hire = make_hire(desk, stage="enquiry")
    asks = ask(desk, hire["id"], "OP-1001", "OP-1002")
    closes = asks["OP-1001"]["closesAt"]
    assert instant_of(closes) - instant_of(asks["OP-1001"]["sentAt"]) == timedelta(seconds=20)
    path = api_path(asks["OP-1001"]["bidPath"])
    refused = press_until_refused(base, path, instant_of(closes))
    uk = instant_of(closes).astimezone(UK)
    error_of(refused, 410, "bidsClosed", f"Bids closed at {uk:%H:%M}. Your price was not sent.")
    error_of(httpx.delete(base + path + "/bid", timeout=HTTP_TIMEOUT), 410, "bidsClosed")
    assert httpx.get(base + path, timeout=HTTP_TIMEOUT).status_code == 410
    html = httpx.get(base + page_path(asks["OP-1001"]["bidPath"]), timeout=HTTP_TIMEOUT)
    assert html.status_code == 410 and re.search(r"<html[^>]*\blang=", html.text)
    with screen(browser, base, page_path(asks["OP-1001"]["bidPath"]), size=PHONE) as page:
        expect(h1(page, "This bid page has closed")).to_be_visible()
        expect(page).to_have_title("This bid page has closed")
        page.clock.set_fixed_time(instant_of(closes) - timedelta(days=1))
        page.reload()
        expect(h1(page, "This bid page has closed")).to_be_visible()
    rows = {b["operatorId"]: b for b in desk.ok("GET", f"/api/enquiries/{hire['id']}/bids")["bids"]}
    assert rows["OP-1001"]["status"] == "closed" and rows["OP-1001"]["prices"] == ["1100.00"]
    assert rows["OP-1002"]["status"] == "closed" and rows["OP-1002"]["prices"] == []
    error_of(desk.call("POST", f"/api/enquiries/{hire['id']}/award", json={"operatorId": "OP-1002"}), 409, "noBid")
    assert desk.ok("POST", f"/api/enquiries/{hire['id']}/award", json={"operatorId": "OP-1001"})["awarded"]["operatorId"] == "OP-1001"
    late = make_hire(desk, stage="enquiry")
    late_ask = ask(desk, late["id"], "OP-1002")["OP-1002"]
    with screen(browser, base, page_path(late_ask["bidPath"]), size=PHONE) as page:
        role(page, "textbox", "Price for vehicle 1").fill("1100")
        with hold_reads(page):
            poll(lambda: server_now(base) > instant_of(late_ask["closesAt"]), 40, "the window ends with the page still open")
            click(visible(role(page, "button", "Send price")))
            ended = instant_of(late_ask["closesAt"]).astimezone(UK)
            shows(page, f"Bids closed at {ended:%H:%M}. Your price was not sent.")


def test_one_award_wins(app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire, asks = bid_setup(desk, "OP-1001", "OP-1002", "OP-1003")
    make_clear(desk, "OP-1001", "OP-1002")
    reference = hire["id"]
    for operator in ("OP-1001", "OP-1002"):
        assert httpx.put(app_url + api_path(asks[operator]["bidPath"]) + "/bid", json={"prices": ["1000"]}, timeout=HTTP_TIMEOUT).status_code == 200
    def award(operator: str) -> httpx.Response:
        return desk.call("POST", f"/api/enquiries/{reference}/award", json={"operatorId": operator})
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        results = list(pool.map(award, ["OP-1001", "OP-1002", "OP-1001", "OP-1002", "OP-1001", "OP-1002"]))
    wins = [r for r in results if r.status_code == 200]
    losses = [r for r in results if r.status_code != 200]
    assert len(wins) == 1, [r.status_code for r in results]
    winner = wins[0].json()["awarded"]
    assert winner["operatorId"] in ("OP-1001", "OP-1002")
    time_uk = instant_of(winner["at"]).astimezone(UK)
    pattern = re.compile(rf"Already awarded to {re.escape(winner['operatorName'])} at {time_uk:%H:%M}\.")
    for r in losses:
        error_of(r, 409, "alreadyAwarded", pattern)
    closing = mails(mail, subject=f"Hire {reference} has closed", count=2)
    expected_losers = {"desk@op-1001.example", "desk@op-1002.example", "desk@op-1003.example"} - {f"desk@op-{winner['operatorId'][3:]}.example"}
    assert sorted(addresses(m["To"])[0] for m in closing) == sorted(expected_losers)
    error_of(award(winner["operatorId"]), 409, "alreadyAwarded")
    assert len(mails(mail, subject=f"Hire {reference} has closed", count=3, seconds=3)) == 2, "a repeat press sends no extra mail"
    assert len(desk.ok("GET", f"/api/hires/{reference}")["runs"]) == 1
    error_of(httpx.put(app_url + api_path(asks["OP-1003"]["bidPath"]) + "/bid", json={"prices": ["900"]}, timeout=HTTP_TIMEOUT), 410, "bidsClosed")


def test_wf_quote_building_totals(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    with screen(browser, app_url, f"/hires/{hire['id']}/quote", desk=desk) as page:
        expect(h1(page, f"Quote {hire['id']}")).to_be_visible()
        totals = role(page, "group", "Totals")
        soon(page, lambda: "£1,157.25" in totals.inner_text(), "the starting total")
        listen(page)
        url_before = page.url
        waiting: list[Any] = []

        def hold_older(route: Any) -> None:
            if not waiting and route.request.method != "GET" and re.search(r'"marginPercent"\s*:\s*"?20(\.0+)?"?', route.request.post_data or ""):
                waiting.append(route)
            else:
                route.fallback()

        page.route("**/*", hold_older)
        margin = role(page, "spinbutton", "Margin for vehicle 1")
        newer = money_shown(selling("1006.30", "12.5"))
        older = money_shown(selling("1006.30", "20"))
        margin.fill("20")
        soon(page, lambda: waiting or older in totals.inner_text(), "the older margin is asked about, or worked out on the page")
        margin.fill("12.5")
        soon(page, lambda: newer in totals.inner_text(), "the total at the newer margin")
        said(page, f"Totals updated: {newer}.")
        if waiting:
            older_amount = str(selling("1006.30", "20"))
            waiting[0].fulfill(json={"vehicles": [{"seats": 49, "sellingPrice": older_amount, "vat": "0.00", "total": older_amount, "deposit": "150.00"}], "total": older_amount, "depositTotal": "150.00"})
        advance(page, 500)
        assert newer in totals.inner_text() and older not in totals.inner_text(), "an older reply never replaces a newer one"
        assert len([s for s in spoken_list(page) if f"Totals updated: {newer}." in s]) == 1, "each change is announced once"
        assert not [s for s in spoken_list(page) if f"Totals updated: {older}." in s and waiting]
        assert page.url == url_before
        margin.fill(OFF_STEP_MARGIN)
        said(page, "Margin is 0 to 60 in steps of 0.5.")
        expect(margin).to_have_value(OFF_STEP_MARGIN)
    asked = make_hire(desk, stage="quoted")
    desk.ok("POST", f"/api/hires/{asked['id']}/quote/preview", json={"vehicles": [{"seats": 49, "boughtPrice": "1006.30", "marginPercent": "20"}]})
    assert desk.ok("GET", f"/api/hires/{asked['id']}/quote")["vehicles"][0]["marginPercent"] == "15", "a preview saves nothing"
    for bad in (OFF_STEP_MARGIN, "60.5", "-1"):
        error_of(desk.call("POST", f"/api/hires/{hire['id']}/quote/preview", json={"vehicles": [{"seats": 49, "boughtPrice": "1006.30", "marginPercent": bad}]}), 422, message="Margin is 0 to 60 in steps of 0.5.")


def test_wf_quote_building_send(browser: Browser, app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = {"name": "Agnieszka Wiśniewska", "email": fresh()[1], "telephone": fresh_phone(), "language": "pl"}
    hire = make_hire(desk, stage="quoted", customer=customer)
    quote = desk.ok("GET", f"/api/hires/{hire['id']}/quote")
    edited = desk.ok("PUT", f"/api/hires/{hire['id']}/quote", json={"version": quote["version"], "vehicles": [{"id": quote["vehicles"][0]["id"], "marginPercent": "20"}]})
    assert edited["vehicles"][0]["sellingPrice"] == str(selling("1006.30", "20"))
    old_path = hire["quotePath"]
    with screen(browser, app_url, f"/hires/{hire['id']}/quote", desk=desk) as page:
        soon(page, lambda: role(page, "spinbutton", "Margin for vehicle 1").input_value() == "20", "the saved margin")
        click(visible(role(page, "button", "Send quote")))
        box = role(page, "dialog", "Send quote")
        soon(page, lambda: box.count() == 1, "Send quote")
        wait_working(page, role(box, "button", "Send now"), f"**/api/hires/{hire['id']}/quote/send", "Send now")
        said(page, "Quote sent.")
    sent = desk.ok("GET", f"/api/hires/{hire['id']}/quote")
    assert desk.ok("GET", f"/api/enquiries/{hire['id']}")["state"] == "quoted"
    delivered = mails(mail, to=customer["email"], subject=f"Twoja wycena {hire['id']}", count=1)
    assert len(delivered) == 1
    body = text(delivered[0])
    assert money_shown(selling("1006.30", "20")) in body and page_path(sent["quotePath"]) in body
    assert "1006.30" not in body and "1,006.30" not in body and "Hanley Motor Services" not in body
    assert desk.ok("POST", f"/api/hires/{hire['id']}/quote/send", json={})["quotePath"] == sent["quotePath"]
    assert len(mails(mail, to=customer["email"], count=2, seconds=3)) == 1, "a repeat with nothing changed sends nothing"
    if page_path(old_path) != page_path(sent["quotePath"]):
        assert httpx.get(app_url + api_path(old_path), timeout=HTTP_TIMEOUT).status_code == 410
    httpx.post(app_url + api_path(sent["quotePath"]) + "/accept", json={"name": customer["name"]}, timeout=HTTP_TIMEOUT).raise_for_status()
    latest = desk.ok("GET", f"/api/hires/{hire['id']}/quote")
    error_of(desk.call("PUT", f"/api/hires/{hire['id']}/quote", json={"version": latest["version"], "vehicles": [{"id": latest["vehicles"][0]["id"], "marginPercent": "10"}]}), 409, "quoteLocked", "This quote is accepted. Use Changes instead.")


@pytest.mark.timeout(1800)
def test_wf_quote_building_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    meets_screen_rules(browser, app_url, f"/hires/{hire['id']}/quote", "Send quote", "Send quote", desk=desk, main="Send quote", endpoint=f"/api/hires/{hire['id']}/quote", method="PUT", read=desk.ok("GET", f"/api/hires/{hire['id']}/quote"))
    sweep_routes(browser, app_url, "quote", "rates")


MONEY_CASES = {
    "coach_1006_30": (49, "1006.30", "1157.25", "0.00", "1157.25", "150.00", "£1,157.25"),
    "coach_1234_50": (49, "1234.50", "1419.68", "0.00", "1419.68", "150.00", "£1,419.68"),
    "minibus_at_750": (12, "652.17", "750.00", "0.00", "750.00", "50.00", "£750.00"),
    "minibus_over_750": (12, "652.18", "750.01", "0.00", "750.01", "100.00", "£750.01"),
    "coach_at_1000": (49, "869.56", "999.99", "0.00", "999.99", "100.00", "£999.99"),
    "coach_over_1000": (49, "869.57", "1000.01", "0.00", "1000.01", "150.00", "£1,000.01"),
    "eight_seat_vat": (8, "521.75", "600.01", "120.00", "720.01", "50.00", "£720.01"),
}


@pytest.mark.parametrize("case", list(MONEY_CASES.values()), ids=list(MONEY_CASES))
def test_exact_quote_money(browser: Browser, app_url: str, wiremock: WireMock, case: tuple[Any, ...]) -> None:
    seats, bought, selling, vat, total, deposit, shown = case
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted", seats=seats, bought=bought)
    expected = {"sellingPrice": selling, "vat": vat, "total": total, "deposit": deposit}
    preview_body = desk.ok("POST", f"/api/hires/{hire['id']}/quote/preview", json={"vehicles": [{"seats": seats, "boughtPrice": bought, "marginPercent": "15"}]})
    for source in (preview_body["vehicles"][0], hire["vehicles"][0], desk.ok("GET", f"/api/hires/{hire['id']}/quote")["vehicles"][0]):
        assert {k: source[k] for k in expected} == expected
    assert preview_body["total"] == total and preview_body["depositTotal"] == deposit
    with screen(browser, app_url, f"/hires/{hire['id']}/quote", desk=desk) as page:
        soon(page, lambda: shown in role(page, "group", "Totals").inner_text(), f"total {shown}")


def test_rate_tables_by_date(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    day = today(app_url)
    rates = desk.ok("GET", "/api/rates")
    default = next(t for t in rates["tables"] if t["id"] == rates["inForce"])
    assert default["effectiveFrom"] == "2000-01-01" and default["defaultMarginPercent"] == "15" and default["waitingRatePerHour"] == "20.00" and default["secondDriverCharge"] == "150.00"
    table = {k: v for k, v in default.items() if k != "id"}
    old = make_hire(desk, stage="quoted", bought="869.57")
    assert old["vehicles"][0]["deposit"] == "150.00"
    future = (day + timedelta(days=20)).isoformat()
    made = desk.ok("POST", "/api/rates", 201, json={**table, "effectiveFrom": future, "depositCoachHigher": "175.00"})
    assert made["effectiveFrom"] == future and desk.ok("GET", "/api/rates")["inForce"] == default["id"]
    error_of(desk.call("POST", "/api/rates", json={**table, "effectiveFrom": future}), 409, message=f"A rate table already starts on {long_date(day + timedelta(days=20))}.")
    error_of(desk.call("POST", "/api/rates", json={**table, "effectiveFrom": (day - timedelta(days=1)).isoformat()}), 422, message="A rate table can't start before today.")
    assert make_hire(desk, stage="quoted", bought="869.57")["vehicles"][0]["deposit"] == "150.00", "a future table changes nothing yet"
    now_table = desk.ok("POST", "/api/rates", 201, json={**table, "effectiveFrom": day.isoformat(), "depositCoachHigher": NEW_HIGHER_DEPOSIT, "secondDriverCharge": "175.00"})
    assert desk.ok("GET", "/api/rates")["inForce"] == now_table["id"]
    assert make_hire(desk, stage="quoted", bought="869.57")["vehicles"][0]["deposit"] == NEW_HIGHER_DEPOSIT
    kept = desk.ok("GET", f"/api/hires/{old['id']}/quote")
    assert kept["vehicles"][0]["deposit"] == "150.00" and kept["rateTableId"] == default["id"], "a sent quote keeps its sending day's rates"
    again = desk.ok("POST", f"/api/hires/{old['id']}/quote/preview", json={"vehicles": [{"seats": 49, "boughtPrice": "869.57", "marginPercent": "15"}]})
    assert again["vehicles"][0]["deposit"] == "150.00", "preview uses the hire's rates"


def test_stale_quote_edit(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    url = f"/api/hires/{hire['id']}/quote"
    quote = desk.ok("GET", url)
    vehicle = quote["vehicles"][0]["id"]
    with screen(browser, app_url, f"/hires/{hire['id']}/quote", desk=desk) as page:
        margin = role(page, "spinbutton", "Margin for vehicle 1")
        expect(margin).to_have_value("15")
        with hold_reads(page):
            newer = desk.ok("PUT", url, json={"version": quote["version"], "vehicles": [{"id": vehicle, "marginPercent": "20"}]})
            assert newer["version"] > quote["version"]
            err = error_of(desk.call("PUT", url, json={"version": quote["version"], "vehicles": [{"id": vehicle, "marginPercent": "30"}]}), 412, "staleEdit")
            line = re.compile(r"Someone changed this quote at \d\d:\d\d\. Your edit is still here\. Reload to see theirs\.")
            assert line.fullmatch(err["message"]), err
            assert desk.ok("GET", url)["vehicles"][0]["marginPercent"] == "20"
            margin.fill("25")
            advance(page, 500)
            click(visible(role(page, "button", "Send quote")))
            box = role(page, "dialog", "Send quote")
            expect(box).to_be_visible()
            click(role(box, "button", "Send now"))
            expect(page.get_by_text(line).first).to_be_visible(timeout=WAIT_SECONDS * 1000)
            reload_inside = box.count() > 0 and role(box, "button", "Reload").count() > 0
            if box.count():
                escape_panel(page, box)
                soon(page, lambda: box.count() == 0, "the refused dialog closes")
            expect(margin).to_have_value("25")
            if not reload_inside:
                expect(role(page, "button", "Reload")).to_be_visible()


def test_wf_customer_page_touch_accept(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    name = hire["customerBody"]["name"]
    token = hire["quotePath"]
    with screen(browser, app_url, page_path(token), size=PHONE, reduced=True) as page:
        expect(h1(page, f"Your quote {hire['id']}")).to_be_visible()
        expect(role(page, "list", "Progress")).to_have_attribute("data-part", "stepper")
        expect(role(page, "list", "Progress").locator('[aria-current="step"]')).to_contain_text("Quote sent")
        layout(page)
        tap(visible(role(page, "button", "Accept")))
        box = role(page, "dialog", "Accept this quote")
        expect(box).to_be_visible()
        field = role(box, "textbox", "Your full name")
        field.fill(WRONG_NAME)
        tap(role(box, "button", "Confirm acceptance"))
        soon(page, lambda: "That name does not match this quote." in box.inner_text(), "the refusal in the dialog")
        expect(field).to_have_value(WRONG_NAME)
        assert "That name" in page.evaluate("document.activeElement.textContent"), "focus on the message"
        assert httpx.get(app_url + api_path(token), timeout=HTTP_TIMEOUT).json()["state"] == "open"
        field.fill(name.upper())
        tap(role(box, "button", "Confirm acceptance"))
        said(page, "Quote accepted.")
        before = desk.ok("GET", f"/api/hires/{hire['id']}/ledger")
        tap(visible(role(page, "button", "I've sent the deposit")))
        shows(page, "We're checking your payment")
    read = httpx.get(app_url + api_path(token), timeout=HTTP_TIMEOUT).json()
    assert read["state"] == "accepted" and read["depositSaidSent"] is True and read["stage"] == "accepted"
    assert desk.ok("GET", f"/api/hires/{hire['id']}/ledger") == before
    state = desk.ok("GET", f"/api/hires/{hire['id']}")
    assert state["paymentState"] == "nothingPaid" and state["paid"] == "0.00"
    assert desk.ok("GET", f"/api/enquiries/{hire['id']}")["state"] == "won"


def test_wf_customer_page_languages(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    path = page_path(hire["quotePath"])
    for query, lang, right_to_left in (("", "en", False), ("?lang=pl", "pl", False), ("?lang=ur", "ur", True)):
        html = httpx.get(app_url + path + query, timeout=HTTP_TIMEOUT).text
        tag = re.search(r"<html[^>]*>", html).group(0)
        assert (html_attr(tag, "lang") or "").split("-")[0] == lang and (html_attr(tag, "dir") == RTL) is right_to_left, tag
    with screen(browser, app_url, path, size=PHONE) as page:
        switch_language(page, "Polski")
        soon(page, lambda: "lang=pl" in page.url, "Polish in the address")
        soon(page, lambda: h1(page, f"Twoja wycena {hire['id']}").count() == 1, "the Polish heading")
        page.reload()
        expect(h1(page, f"Twoja wycena {hire['id']}")).to_be_visible()
        assert page.evaluate("document.documentElement.lang") == "pl"
    with screen(browser, app_url, path + "?lang=ur", size=PHONE) as page:
        expect(h1(page, f"آپ کا کوٹیشن {hire['id']}")).to_be_visible()
        steps = role(page, "list", "Progress").get_by_role("listitem")
        assert steps.first.bounding_box()["x"] > steps.last.bounding_box()["x"] or steps.first.bounding_box()["y"] < steps.last.bounding_box()["y"], "the stepper runs from the right"
        layout(page)
        expect(role(page, "region", "Announcements")).to_have_count(1)


def test_wf_customer_page_device_clock(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    open_hire = make_hire(desk, stage="quoted")
    past = today(app_url) - timedelta(days=20)
    ended_hire = make_hire(desk, stage="quoted", sent_at={"date": past.isoformat(), "time": "10:00"})
    now = server_now(app_url)
    with screen(browser, app_url, page_path(open_hire["quotePath"]), size=PHONE) as page:
        page.clock.set_fixed_time(now + timedelta(days=30))
        page.reload()
        expect(h1(page, f"Your quote {open_hire['id']}")).to_be_visible()
        advance(page, REFRESH_MS + 100)
        assert "This quote ended on" not in body_text(page)
        expect(visible(role(page, "button", "Accept"))).to_be_visible()
    with screen(browser, app_url, page_path(ended_hire["quotePath"]), size=PHONE) as page:
        page.clock.set_fixed_time(now - timedelta(days=30))
        page.reload()
        last_valid = past + timedelta(days=5)
        shows(page, f"This quote ended on {long_date(last_valid)}. Ask us for a new one.")
        expect(h1(page, f"Your quote {ended_hire['id']}")).to_be_visible()
        click(visible(role(page, "button", "Accept")))
        box = role(page, "dialog", "Accept this quote")
        role(box, "textbox", "Your full name").fill(ended_hire["customerBody"]["name"])
        click(role(box, "button", "Confirm acceptance"))
        said(page, f"This quote ended on {long_date(last_valid)}. Ask us for a new one.")
    assert httpx.get(app_url + api_path(ended_hire["quotePath"]), timeout=HTTP_TIMEOUT).json()["state"] == "ended"


@pytest.mark.timeout(1800)
def test_wf_customer_page_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    read = httpx.get(app_url + api_path(hire["quotePath"]), timeout=HTTP_TIMEOUT).json()
    meets_screen_rules(browser, app_url, page_path(hire["quotePath"]), "Accept", "Accept this quote", main="Accept", typed_into=("textbox", "Your full name"), endpoint=api_path(hire["quotePath"]) + "/accept", read=read)
    sweep_routes(browser, app_url, "q", "q_pl", "q_ur")


def test_quote_end_fifth_day(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    worked = make_hire(desk, stage="quoted", sent_at={"date": "2027-03-24", "time": "16:10"})
    assert worked["endsAt"] == "2027-03-29T22:59:59Z" and "2027-03-29" in worked["validUntil"]
    past = today(app_url) - timedelta(days=20)
    hire = make_hire(desk, stage="quoted", sent_at={"date": past.isoformat(), "time": "10:00"})
    url = app_url + api_path(hire["quotePath"])
    r = httpx.get(url, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json()["state"] == "ended"
    error_of(httpx.post(url + "/accept", json={"name": hire["customerBody"]["name"]}, timeout=HTTP_TIMEOUT), 409, "quoteEnded")
    assert httpx.get(url, timeout=HTTP_TIMEOUT).json()["state"] == "ended"
    assert httpx.get(app_url + page_path(hire["quotePath"]), timeout=HTTP_TIMEOUT).status_code == 200


@pytest.mark.timeout(180)
def test_quote_end_short_timer(app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_SHORT_URL")
    desk = new_desk(base)
    open_hire = make_hire(desk, stage="quoted")
    done = make_hire(desk, stage="quoted")
    assert instant_of(open_hire["endsAt"]) - instant_of(open_hire["sentAt"]) == timedelta(seconds=20)
    open_url = base + api_path(open_hire["quotePath"])
    done_url = base + api_path(done["quotePath"])
    assert httpx.get(open_url, timeout=HTTP_TIMEOUT).json()["state"] == "open"
    assert httpx.post(done_url + "/accept", json={"name": done["customerBody"]["name"]}, timeout=HTTP_TIMEOUT).json()["state"] == "accepted"
    def ended() -> bool:
        body = httpx.get(open_url, timeout=HTTP_TIMEOUT).json()
        if body["state"] == "ended":
            assert server_now(base) >= instant_of(body["endsAt"])
            return True
        assert body["state"] == "open"
        return False
    poll(ended, 40, "GET /api/q/<token> reads ended after endsAt")
    error_of(httpx.post(open_url + "/accept", json={"name": open_hire["customerBody"]["name"]}, timeout=HTTP_TIMEOUT), 409, "quoteEnded")
    assert httpx.get(done_url, timeout=HTTP_TIMEOUT).json()["state"] == "accepted"
    assert httpx.post(done_url + "/accept", json={"name": done["customerBody"]["name"]}, timeout=HTTP_TIMEOUT).status_code == 200
    assert httpx.post(done_url + "/deposit-sent", json={}, timeout=HTTP_TIMEOUT).json()["depositSaidSent"] is True


def test_customer_copies_private(app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    desk.refresh()
    name, email = fresh("private")
    notes = "Unsigned note kept private"
    customer = desk.ok("POST", "/api/customers", 201, json={"name": name, "email": email, "telephone": fresh_phone(), "language": "en"})
    desk.ok("POST", "/api/customers/import", content=f"Name,Email,Telephone,Notes\n{name},{email},,{notes}\n".encode(), headers={"content-type": "text/csv"})
    assert desk.ok("GET", f"/api/customers/{customer['id']}")["notes"] == notes
    hire = make_hire(desk, stage="quoted", customer={"name": name, "email": email, "telephone": customer["telephone"], "language": "en"})
    desk.ok("POST", f"/api/hires/{hire['id']}/quote/send", json={})
    url = app_url + api_path(hire["quotePath"])
    read = httpx.get(url, timeout=HTTP_TIMEOUT)
    assert set(read.json()) == {"reference", "language", "state", "stage", "stops", "departAt", "departInstant", "returnAt", "returnInstant", "people", "vehicles", "total", "depositTotal", "validUntil", "endsAt", "depositSaidSent", "cancelled"}
    assert all(set(v) == {"seats", "total", "deposit"} for v in read.json()["vehicles"])
    pdf = httpx.get(url + "/pdf", timeout=HTTP_TIMEOUT)
    assert pdf.status_code == 200 and pdf.headers["content-type"].startswith("application/pdf") and pdf_pages(pdf.content) >= 1
    pdf_words = pdf_text(pdf.content)
    assert "1,157.25" in pdf_words, "the PDF carries the real total"
    delivered = mails(mail, to=email, subject=f"Your quote {hire['id']}", count=1)
    assert delivered
    surfaces = {"read": read.text, "page": httpx.get(app_url + page_path(hire["quotePath"]), timeout=HTTP_TIMEOUT).text, "pdf": pdf_words, "mail": json.dumps(delivered, ensure_ascii=False)}
    for where, content in surfaces.items():
        for secret in ("Hanley Motor Services", "1006.30", "1,006.30", "marginPercent", "boughtPrice", notes):
            assert secret not in content, f"{secret} reached the customer's {where}"
    accepted = httpx.post(url + "/accept", json={"name": name, "total": "1.00", "state": "ended", "people": 1, "depositSaidSent": True, "marginPercent": "0", "email": "x@x.example"}, timeout=HTTP_TIMEOUT)
    assert accepted.status_code == 200
    body = accepted.json()
    assert body["total"] == "1157.25" and body["people"] == 47 and body["state"] == "accepted" and body["depositSaidSent"] is False
    assert desk.ok("GET", f"/api/customers/{customer['id']}")["email"] == email


POLISH_COUNTS = {1: "1 osoba", 2: "2 osoby", 4: "4 osoby", 5: "5 osób", 12: "12 osób", 21: "21 osób", 22: "22 osoby", 112: "112 osób", 122: "122 osoby"}
CUSTOMER_STRINGS = {
    "en": dict(title="Your quote", steps=["Quote sent", "Accepted", "Deposit", "Balance", "Travel"], labels=["Route", "Out", "Return", "Party", "Vehicles", "Total", "Deposit due", "Download quote", "Language"], accept="Accept", dialog="Accept this quote", full="Your full name", confirm="Confirm acceptance", close="Close", valid="Valid until Mon 29 Mar 2027", out="Fri 14 May 2027", party="47 people", vehicles="1 vehicle", pay="Pay by bank transfer quoting", sent="I've sent the deposit", checking="We're checking your payment", ended="This page has ended.", cancelled="This booking was cancelled."),
    "pl": dict(title="Twoja wycena", steps=["Wycena wysłana", "Zaakceptowana", "Zaliczka", "Pozostała kwota", "Podróż"], labels=["Trasa", "Wyjazd", "Powrót", "Grupa", "Pojazdy", "Razem", "Zaliczka do zapłaty", "Pobierz wycenę", "Język"], accept="Akceptuję", dialog="Akceptacja wyceny", full="Imię i nazwisko", confirm="Potwierdzam", close="Zamknij", valid="Ważna do 29.03.2027", out="14.05.2027", party="47 osób", vehicles="1 pojazd", pay="Zapłać przelewem, podając numer", sent="Zaliczka wysłana", checking="Sprawdzamy Twoją płatność", ended="Ta strona wygasła.", cancelled="Ta rezerwacja została anulowana."),
    "ur": dict(title="آپ کا کوٹیشن", steps=["کوٹیشن بھیج دیا گیا", "قبول کر لیا گیا", "پیشگی رقم", "بقایا رقم", "سفر"], labels=["راستہ", "روانگی", "واپسی", "مسافر", "گاڑیاں", "کل رقم", "واجب الادا پیشگی رقم", "کوٹیشن ڈاؤن لوڈ کریں", "زبان"], accept="قبول کریں", dialog="یہ کوٹیشن قبول کریں", full="آپ کا پورا نام", confirm="قبولیت کی تصدیق کریں", close="بند کریں", valid="29/03/2027 تک کارآمد", out="14/05/2027", party="47 افراد", vehicles="1 گاڑی", pay="کا حوالہ دے کر بینک ٹرانسفر سے ادائیگی کریں", sent="میں نے پیشگی رقم بھیج دی ہے", checking="ہم آپ کی ادائیگی کی جانچ کر رہے ہیں", ended="یہ صفحہ ختم ہو چکا ہے۔", cancelled="یہ بکنگ منسوخ کر دی گئی۔"),
}
RUN_STRINGS = {
    "en": dict(run="Run", stop="Stop 1 of 2", arrived="Arrived", boarded="Boarded", left="Left", comfort="Comfort stop", details="Run details", language="Language", ended="This page has ended."),
    "pl": dict(run="Kurs", stop="Przystanek 1 z 2", arrived="Na miejscu", boarded="Wsiedli", left="Odjazd", comfort="Postój", details="Szczegóły kursu", language="Język", ended="Ta strona wygasła."),
}


@pytest.mark.parametrize("lang", ["en", "pl", "ur"], ids=["en", "pl", "ur"])
def test_published_customer_strings(browser: Browser, app_url: str, wiremock: WireMock, lang: str) -> None:
    table = CUSTOMER_STRINGS[lang]
    desk = new_desk(app_url)
    customer = {"name": "Agnieszka Wiśniewska", "email": fresh()[1], "telephone": fresh_phone(), "language": lang}
    hire = make_hire(desk, stage="quoted", customer=customer, depart={"date": "2027-05-14", "time": "08:00"}, ret={"date": "2027-05-14", "time": "17:00"}, sent_at={"date": "2027-03-24", "time": "16:10"})
    reference = hire["id"]
    path = page_path(hire["quotePath"])
    query = f"?lang={lang}" if lang != "en" else ""
    with screen(browser, app_url, path + query, size=PHONE, reduced=True) as page:
        expect(h1(page, f"{table['title']} {reference}")).to_be_visible()
        assert page.title() == f"{table['title']} {reference}"
        content = body_text(page).casefold()
        for needed in [*table["steps"], *table["labels"], table["valid"], table["out"], table["party"], table["vehicles"], "£1,157.25", "£150.00"]:
            assert needed.casefold() in content, f"{lang}: {needed!r} missing"
        if httpx.get(app_url + api_path(path), timeout=HTTP_TIMEOUT).json()["state"] == "open":
            click(visible(role(page, "button", table["accept"])))
            box = role(page, "dialog", table["dialog"])
            expect(role(box, "textbox", table["full"])).to_be_visible()
            expect(role(box, "button", table["confirm"])).to_be_visible()
            click(role(box, "button", table["close"]))
    today_sent = make_hire(desk, stage="accepted", customer=customer, depart={"date": "2027-05-14", "time": "08:00"})
    live = page_path(today_sent["quotePath"])
    with screen(browser, app_url, live + query, size=PHONE, reduced=True) as page:
        expect(visible(role(page, "button", table["sent"]))).to_be_visible()
        assert table["pay"] in body_text(page) and today_sent["id"] in body_text(page)
        click(visible(role(page, "button", table["sent"])))
        shows(page, table["checking"])
    desk.ok("POST", f"/api/hires/{today_sent['id']}/changes", 201, json={"vehicles": [{"id": today_sent["vehicles"][0]["id"], "boughtPrice": "1100.00", "marginPercent": "15"}]})
    assert httpx.get(app_url + api_path(live), timeout=HTTP_TIMEOUT).status_code == 410
    gone = httpx.get(app_url + live + query, timeout=HTTP_TIMEOUT)
    assert gone.status_code == 410 and re.search(rf"""<html[^>]*\blang=["']?{lang}""", gone.text)
    assert _rendered_has(browser, app_url, live + query, table["ended"])
    missing = httpx.get(app_url + "/q/never-existed-token", timeout=HTTP_TIMEOUT)
    assert missing.status_code == 404 and _rendered_has(browser, app_url, "/q/never-existed-token", "Page not found")
    error_of(httpx.get(app_url + "/api/q/never-existed-token", timeout=HTTP_TIMEOUT), 404)
    year = next_year(app_url)
    cancelled = make_hire(desk, stage="accepted", customer=customer, depart={"date": f"{year}-05-14", "time": "08:00"})
    desk.ok("POST", f"/api/hires/{cancelled['id']}/cancel", json={"noticeAt": {"date": f"{year}-04-14", "time": "00:30"}, "by": "arranger"})
    with screen(browser, app_url, page_path(cancelled["quotePath"]) + query, size=PHONE, reduced=True) as page:
        shows(page, table["cancelled"])
        expect(role(page, "button", table["sent"])).to_have_count(0)
    if lang == "pl":
        for people, words in POLISH_COUNTS.items():
            counted = make_hire(desk, stage="quoted", people=people, customer=customer)
            assert words in httpx.get(app_url + page_path(counted["quotePath"]) + "?lang=pl", timeout=HTTP_TIMEOUT).text or _rendered_has(browser, app_url, page_path(counted["quotePath"]) + "?lang=pl", words)
        for count, words in ((2, "2 pojazdy"), (5, "5 pojazdów")):
            fleet = [{"seats": 49, "operatorId": "OP-1001", "boughtPrice": "1006.30", "marginPercent": "15"}] * count
            many = make_hire(desk, stage="quoted", vehicles=fleet, customer=customer)
            assert _rendered_has(browser, app_url, page_path(many["quotePath"]) + "?lang=pl", words)
    if lang in RUN_STRINGS:
        strings = RUN_STRINGS[lang]
        sheet = make_hire(desk, stage="accepted", customer=customer)["runs"][0]
        with screen(browser, app_url, page_path(sheet["sheetPath"]) + query, size=PHONE, reduced=True) as page:
            expect(h1(page, f"{strings['run']} {sheet['number']}")).to_be_visible()
            group = role(page, "group", strings["stop"])
            for button in (strings["arrived"], strings["boarded"], strings["left"]):
                expect(role(group, "button", button)).to_be_visible()
            expect(page.get_by_role("button", name=strings["comfort"], exact=True).first).to_be_visible()
            expect(role(page, "button", strings["details"])).to_be_visible()
            expect(role(page, "combobox", strings["language"])).to_be_visible()


def _rendered_has(browser: Browser, base: str, path: str, words: str) -> bool:
    with screen(browser, base, path, size=PHONE, reduced=True) as page:
        soon(page, lambda: words in body_text(page), words)
        return True


def test_wf_payments_bring_in(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    ref = hire["id"]
    data = statement(f"03/04/2027,Deposit {ref},175.00,175.00", "04/04/2027,No reference here,20.00,195.00", "05/04/2027,Fuel card,-30.00,165.00", "31/02/2027,Bad date,1.00,166.00")
    with screen(browser, app_url, "/payments", desk=new_desk(app_url)) as page:
        shows(page, "No payments yet.")
    with screen(browser, app_url, "/payments", desk=desk) as page:
        money = page.get_by_text("Money held").first
        expect(money).to_be_visible()
        click(visible(role(page, "button", "Bring in statement")))
        sheet = role(page, "dialog", "Bring in statement")
        soon(page, lambda: sheet.count() == 1, "the sheet")
        labelled(sheet, "Statement file").set_input_files({"name": "s.csv", "mimeType": "text/csv", "buffer": data})
        click(role(sheet, "button", "Read file"))
        said(page, re.compile(r"Read \d+ rows\."))
        soon(page, lambda: f"Row {5}: 31/02/2027 is not a real date." in sheet.inner_text(), "the refused row")
        for line in (f"Deposit {ref}", "No reference here", "Fuel card"):
            assert line in sheet.inner_text()
        assert desk.ok("GET", "/api/payments")["moneyHeld"] == "0.00", "nothing is stored before Bring in"
        wait_working(page, role(sheet, "button", "Bring in"), "**/api/payments/statements/*/bring-in", "Bring in")
        said(page, "Brought in 1 rows.")
        frame = named_frame(page, "Bookings")
        soon(page, lambda: ref in frame.inner_text() and "£175.00" in body_text(page), "Money held and the booking change")
    assert desk.ok("GET", "/api/payments")["moneyHeld"] == "175.00"
    state = desk.ok("GET", f"/api/hires/{ref}")
    assert state["vehicles"][0]["depositPaid"] == "150.00" and state["vehicles"][0]["balancePaid"] == "25.00" and state["paymentState"] == "depositPaid"


def test_wf_payments_refused_rows(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/payments", desk=desk) as page:
        click(visible(role(page, "button", "Bring in statement")))
        sheet = role(page, "dialog", "Bring in statement")
        labelled(sheet, "Statement file").set_input_files({"name": "s.csv", "mimeType": "text/csv", "buffer": b"Wrong,Header\n1,2\n"})
        announced_twice(page, lambda: click(role(sheet, "button", "Read file")), "The first line has to read Date,Description,Amount,Balance.")
        assert sheet.is_visible()
    state = desk.ok("GET", "/api/payments")
    assert state["moneyHeld"] == "0.00" and state["bookings"] == []


@pytest.mark.timeout(1800)
def test_wf_payments_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    def paid() -> str:
        pay(desk, hire["id"], "175.00")
        return "£175.00"
    meets_screen_rules(browser, app_url, "/payments", "Bring in statement", "Bring in statement", desk=desk, main="Bring in statement", endpoint="/api/payments/statements/preview", limit=STATEMENT_LIMIT, ctype="text/csv", read=desk.ok("GET", "/api/payments"), shape="sheet", change=paid)
    sweep_routes(browser, app_url, "payments")


def test_statement_reading(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    ref = hire["id"]
    odd = None
    for _ in range(60):
        candidate = make_hire(desk)["id"]
        if re.search(r"[01]", candidate[3:]):
            odd = candidate
            break
    assert odd, "a reference holding 0 or 1 for the O, I and L reading"
    written = "cv " + odd[3:].lower().replace("0", "o").replace("1", "l")
    rows = [
        f'03/04/2027,Paid {ref.lower()} thanks,"1,157.25",2000.00', f"04/04/2027,{written},5.00,2005.00", f"05/04/2027,Paid {ref}X,6.00,2011.00",
        "06/04/2027,Card,-7.00,2004.00", "31/02/2027,Bad,1.00,2005.00", "07/04/2027,Bad amount,abc,2005.00",
    ]
    data = b"\xef\xbb\xbf" + "\r\n".join(["Date,Description,Amount,Balance", *rows]).encode()
    body = preview(desk, data).json()
    assert [(m["row"], m["reference"]) for m in body["matched"]] == [(2, ref), (3, odd)]
    assert body["matched"][0]["amount"] == "1157.25" and body["matched"][0]["date"] == date(2027, 4, 3).isoformat()
    assert [u["row"] for u in body["unmatched"]] == [4] and [m["row"] for m in body["moneyOut"]] == [5]
    assert body["refused"] == [{"row": 6, "message": "Row 6: 31/02/2027 is not a real date."}, {"row": 7, "message": "Row 7: abc is not an amount."}]
    assert desk.ok("GET", "/api/payments")["moneyHeld"] == "0.00"
    done = desk.ok("POST", f"/api/payments/statements/{body['previewId']}/bring-in", json={})
    held = f"{Decimal('1157.25') + Decimal('5.00'):.2f}"
    assert done == {"broughtIn": 2, "moneyHeld": held}
    again = desk.ok("POST", f"/api/payments/statements/{body['previewId']}/bring-in", json={})
    assert again["broughtIn"] == 0 and again["moneyHeld"] == held
    second = preview(desk, data).json()
    assert second["matched"] == [] and [a["row"] for a in second["alreadySeen"]] == [2, 3]
    assert desk.ok("POST", f"/api/payments/statements/{second['previewId']}/bring-in", json={})["moneyHeld"] == held
    twins = make_hire(desk)["id"]
    assert bring_in(desk, statement(f"08/04/2027,Twin {twins},10.00,100.00", f"08/04/2027,Twin {twins},10.00,110.00"))["broughtIn"] == 2, "different balances are two payments"
    error_of(preview(desk, b"Date,Other\n"), 422, message="The first line has to read Date,Description,Amount,Balance.")
    full = statement(*[f"09/04/2027,Row {i},-1.00,{i}" for i in range(2000)])
    assert preview(desk, full).status_code == 200
    error_of(preview(desk, statement(*[f"09/04/2027,Row {i},-1.00,{i}" for i in range(2001)])), 422, message="This file has more than 2,000 rows.")
    error_of(httpx.post(app_url + "/api/payments/statements/preview", content=b"x" * (STATEMENT_LIMIT + 1), headers={"content-type": "text/csv"}, timeout=HTTP_TIMEOUT), 413)


def test_allocation_and_ledger(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    vehicles = [{"seats": 49, "operatorId": "OP-1001", "boughtPrice": "1006.30", "marginPercent": "15"}, {"seats": 8, "operatorId": "OP-1003", "boughtPrice": "521.75", "marginPercent": "15"}]
    year = next_year(app_url)
    hire = make_hire(desk, vehicles=vehicles, depart={"date": f"{year}-05-14", "time": "08:00"})
    ref = hire["id"]
    def check_ledger() -> list[dict[str, Any]]:
        ledger = desk.ok("GET", f"/api/hires/{ref}/ledger")
        assert ledger["sum"] == "0.00"
        by_movement: dict[str, list[dict[str, Any]]] = {}
        for line in ledger["lines"]:
            by_movement.setdefault(line["movementId"], []).append(line)
            assert INSTANT.match(line["at"])
        for lines in by_movement.values():
            assert len(lines) == 2 and sum(Decimal(l["amount"]) for l in lines) == 0, lines
        held = sum((Decimal(l["amount"]) for l in ledger["lines"] if l["account"] == "clientMoney"), Decimal("0"))
        assert Decimal(desk.ok("GET", "/api/payments")["moneyHeld"]) == held
        return ledger["lines"]
    def money() -> list[tuple[str, str]]:
        return [(v["depositPaid"], v["balancePaid"]) for v in desk.ok("GET", f"/api/hires/{ref}")["vehicles"]]
    pay(desk, ref, "175.00")
    assert money() == [("150.00", "0.00"), ("25.00", "0.00")]
    assert desk.ok("GET", f"/api/hires/{ref}")["paymentState"] == "depositPartPaid"
    lines = check_ledger()
    assert sorted(l["amount"] for l in lines if l["account"] == "clientMoney") == ["150.00", "25.00"], "one movement per vehicle part"
    assert all(Decimal(l["amount"]) < 0 for l in lines if l["account"] == "hireIncome")
    pay(desk, ref, "100.00")
    assert money() == [("150.00", "75.00"), ("50.00", "0.00")]
    assert desk.ok("GET", f"/api/hires/{ref}")["paymentState"] == "depositPaid"
    check_ledger()
    pay(desk, ref, "1614.66")
    assert money() == [("150.00", "1007.25"), ("50.00", "670.01")]
    state = desk.ok("GET", f"/api/hires/{ref}")
    assert state["credit"] == "12.40" and state["paymentState"] == "paidInFull" and state["owed"] == "0.00"
    check_ledger()
    cancelled = desk.ok("POST", f"/api/hires/{ref}/cancel", json={"noticeAt": {"date": f"{year}-04-14", "time": "00:30"}, "by": "arranger"})["cancellation"]
    due = Decimal(cancelled["lines"][0]["refundsDue"])
    assert due > 0
    check_ledger()
    vehicle = cancelled["lines"][0]["vehicleId"]
    error_of(desk.call("POST", f"/api/hires/{ref}/refunds", json={"vehicleId": vehicle, "amount": f"{due + 1:.2f}"}), 409)
    assert desk.call("POST", f"/api/hires/{ref}/refunds", json={"vehicleId": vehicle, "amount": "75.00"}).status_code == 201
    lines = check_ledger()
    assert -Decimal("75.00") in [Decimal(l["amount"]) for l in lines if l["account"] == "clientMoney"] and Decimal("75.00") in [Decimal(l["amount"]) for l in lines if l["account"] == "refundsDue"]


@pytest.mark.timeout(240)
def test_balance_reminder(app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    base = outage("APP_SHORT_URL")
    desk = new_desk(base)
    day = today(base)
    def at(days: int) -> dict[str, Any]:
        return make_hire(desk, depart={"date": (day + timedelta(days=days)).isoformat(), "time": "08:00"})
    ten, eleven, seven = at(10), at(11), at(7)
    paid = at(40)
    pay(desk, paid["id"], "1157.25")
    desk.ok("PUT", f"/api/runs/{run_id(paid)}/departure", json={"departAt": {"date": (day + timedelta(days=10)).isoformat(), "time": "08:00"}})
    to = ten["customerBody"]["email"]
    got = mails(mail, to=to, subject=f"Balance reminder {ten['id']}", count=1, seconds=30)
    assert len(got) == 1
    body = text(got[0])
    assert "£1,157.25" in body and long_date(day + timedelta(days=3)) in body and ten["id"] in body
    assert "Hanley Motor Services" not in body and "1006.30" not in body
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        latest = mails(mail, to=to)
    assert len(latest) == 1, "never twice"
    for other in (eleven, seven, paid):
        assert mails(mail, to=other["customerBody"]["email"]) == [], f"no reminder for {other['id']}"


def csv_cells(data: bytes) -> list[str]:
    assert data.startswith(b"\xef\xbb\xbf"), "UTF-8 with a byte order mark"
    return data[3:].decode().splitlines()


def test_payment_download_safe(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = {"name": "Zażółć Gęślą", "email": fresh()[1], "telephone": fresh_phone(), "language": "pl"}
    hire = make_hire(desk, customer=customer)
    part = "25.00"
    description = f"=HYPERLINK {hire['id']}"
    bring_in(desk, statement(f"03/04/2027,{description},{part},{part}"))
    other = make_hire(desk)
    pay(desk, other["id"], "10.00")
    r = desk.call("GET", f"/api/hires/{hire['id']}/payments/download")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = csv_cells(r.content)
    assert lines[0] == "Date,Reference,Customer,Vehicle,Account,Amount,Description"
    assert len(lines) == 3 and other["id"] not in r.text
    rows = {cells[4]: cells for cells in csv.reader(lines[1:])}
    assert rows["Client money"][5] == part and rows["Hire income"][5] == f"'-{part}"
    for cells in rows.values():
        assert re.fullmatch(r"\d{4}-\d\d-\d\d", cells[0]) and cells[1] == hire["id"] and cells[2] == customer["name"] and cells[3] == "49", cells
        assert cells[6] == f"'{description}", cells
    disposition = urllib.parse.unquote(r.headers["content-disposition"])
    assert "filename*" in r.headers["content-disposition"] and f"{customer['name']} payments.csv" in disposition
    whole = desk.call("GET", "/api/payments/download")
    assert hire["id"] in whole.text and other["id"] in whole.text and "payments.csv" in whole.headers["content-disposition"]


def test_passenger_download_safe(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = {"name": "Agnieszka Wiśniewska", "email": fresh()[1], "telephone": fresh_phone(), "language": "pl"}
    hire = make_hire(desk, customer=customer)
    for name in ("=SUM(A1)", "+1 Guest", "-Minus", "@Handle", "Jack O'Rourke"):
        desk.ok("POST", f"/api/hires/{hire['id']}/passengers", 201, json={"name": name, "group": "Adult", "needs": ""})
    r = desk.call("GET", f"/api/hires/{hire['id']}/passengers/download")
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/csv")
    lines = csv_cells(r.content)
    assert lines[0] == "Name,Group,Needs,Vehicle,Seat"
    assert [l.split(",")[0] for l in lines[1:]] == ["'=SUM(A1)", "'+1 Guest", "'-Minus", "'@Handle", "Jack O'Rourke"]
    assert lines[1].endswith(",49,1A")
    assert f"{customer['name']} passengers.csv" in urllib.parse.unquote(r.headers["content-disposition"]) and "filename*" in r.headers["content-disposition"]


def week_day(base: str, offset: int) -> date:
    d = today(base)
    return d - timedelta(days=d.weekday()) + timedelta(days=offset)


def hire_card(page: Page, hire: dict[str, Any]) -> Locator:
    run = hire["runs"][0]
    return role(page, "grid", "Week").get_by_text(re.compile(rf"Run {run['number']}\b|{hire['id']}")).first


def test_wf_diary_keyboard_move(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    wed, thu = week_day(app_url, 2), week_day(app_url, 3)
    hire = make_hire(desk, depart={"date": wed.isoformat(), "time": "08:00"})
    with screen(browser, app_url, "/diary", desk=desk) as page:
        grid = role(page, "grid", "Week")
        soon(page, lambda: hire_card(page, hire).count() == 1, "the hire in its week")
        stops = grid.evaluate("g => [...g.querySelectorAll('a,button,input,select,textarea,[tabindex]')].filter(e => e.tabIndex >= 0).length")
        assert stops == 1, f"one roving Tab stop, found {stops}"
        hire_card(page, hire).evaluate("e => (e.closest('[tabindex]') || e).focus()")
        page.keyboard.press("Alt+ArrowRight")
        said(page, f"Run {hire['runs'][0]['number']} moved to {long_date(thu)}.")
        run = desk.ok("GET", f"/api/runs/{run_id(hire)}")
        assert run["departAt"]["date"] == thu.isoformat() and run["departAt"]["time"] == "08:00"
        pattern = re.compile(rf"Run {run['number']}\b|{hire['id']}")
        assert pattern.search(page.evaluate("document.activeElement.textContent")), "focus stays on that hire"
        advance(page, REFRESH_MS + 100)
        assert pattern.search(page.evaluate("document.activeElement.textContent")), "focus survives the refresh"
        later = visible(role(page, "button", "Later week"))
        url = page.url
        later.focus()
        page.keyboard.press("Enter")
        soon(page, lambda: page.url != url, "the week in the address")
        assert later.evaluate("e => e === document.activeElement"), "focus stays on Later week"


def test_wf_diary_drag_and_clash(browser: Browser, app_url: str, ntfy: Ntfy, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    wed = week_day(app_url, 2)
    phone = fresh_phone()
    a = make_hire(desk, depart={"date": wed.isoformat(), "time": "08:00"})
    b = make_hire(desk, depart={"date": (wed + timedelta(days=1)).isoformat(), "time": "08:00"})
    for hire in (a, b):
        desk.ok("PUT", f"/api/runs/{run_id(hire)}/driver", json={"name": "Ewan Price", "telephone": phone})
    number = a["runs"][0]["number"]
    err = error_of(desk.call("PUT", f"/api/runs/{run_id(b)}/departure", json={"departAt": {"date": wed.isoformat(), "time": "08:30"}}), 409, "driverClash", f"That driver is already on Run {number} at 08:00.")
    assert err
    with screen(browser, app_url, "/diary", desk=desk) as page:
        soon(page, lambda: hire_card(page, a).count() == 1, "the hires")
        cell_w = role(page, "grid", "Week").get_by_role("gridcell").first.bounding_box()["width"]
        x, y = center(hire_card(page, b))
        mouse_drag(page, (x, y), (x + cell_w, y), escape=True)
        assert desk.ok("GET", f"/api/runs/{run_id(b)}")["departAt"]["date"] == (wed + timedelta(days=1)).isoformat(), "Escape changes nothing"
        assert_published_motion(page)
        hire_card(page, b).evaluate("e => (e.closest('[tabindex]') || e).focus()")
        page.keyboard.press("Alt+ArrowLeft")
        said(page, f"That driver is already on Run {number} at 08:00.")
        assert desk.ok("GET", f"/api/runs/{run_id(b)}")["departAt"]["date"] == (wed + timedelta(days=1)).isoformat()
        x, y = center(hire_card(page, b))
        mouse_drag(page, (x, y), (x + cell_w, y))
        target = wed + timedelta(days=2)
        soon(page, lambda: desk.ok("GET", f"/api/runs/{run_id(b)}")["departAt"]["date"] == target.isoformat(), "a drag moves the hire a day")


def test_wf_diary_agenda_and_week(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/diary", size=PHONE, desk=desk) as page:
        shows(page, "Nothing in this week.")
    hire = make_hire(desk, depart={"date": week_day(app_url, 2).isoformat(), "time": "08:00"})
    with screen(browser, app_url, "/diary", size=PHONE, desk=desk) as page:
        expect(role(page, "grid", "Week")).to_have_count(0)
        layout(page)
        expect(h1(page, "Diary")).to_be_visible()
        soon(page, lambda: hire["id"] in body_text(page) or f"Run {hire['runs'][0]['number']}" in body_text(page), "the agenda row")
        later = visible(role(page, "button", "Later week"))
        url = page.url
        tap(later)
        soon(page, lambda: page.url != url, "the week in the address")
        moved = page.url
        page.reload()
        assert page.url == moved
        shows(page, "Nothing in this week.")
    with screen(browser, app_url, "/diary", size=(768, 1024), desk=desk) as page:
        expect(role(page, "grid", "Week")).to_be_visible()


@pytest.mark.timeout(1800)
def test_wf_diary_screen_rules(browser: Browser, app_url: str, ntfy: Ntfy, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, depart={"date": week_day(app_url, 2).isoformat(), "time": "08:00"})
    meets_screen_rules(browser, app_url, "/diary", "Assign driver", "Assign driver", desk=desk, main="Later week", typed_into=("textbox", "Driver name"), endpoint=f"/api/runs/{run_id(hire)}/departure", method="PUT", read=desk.ok("GET", f"/api/runs/{run_id(hire)}"))
    sweep_routes(browser, app_url, "diary")


def test_wall_time_kept(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, depart={"date": "2027-03-27", "time": "08:00"})
    url = f"/api/runs/{run_id(hire)}/departure"
    assert hire["vehicles"][0]["departInstant"] == utc_text("2027-03-27", "08:00")
    run = desk.ok("PUT", url, json={"departAt": {"date": "2027-03-28", "time": "08:00"}})
    assert run["departInstant"] == utc_text("2027-03-28", "07:00") and run["departAt"]["time"] == "08:00"
    error_of(desk.call("PUT", url, json={"departAt": {"date": "2027-03-28", "time": "01:30"}}), 422, message="01:30 does not exist on Sun 28 Mar 2027, when the clocks go forward. Choose another time.")
    assert desk.ok("GET", f"/api/runs/{run_id(hire)}")["departInstant"] == utc_text("2027-03-28", "07:00")
    assert desk.ok("PUT", url, json={"departAt": {"date": "2027-10-31", "time": "01:30"}})["departInstant"] == "2027-10-31T00:30:00Z"
    spring = desk.ok("GET", "/api/diary", params={"week": "2027-W12"})
    row = next(d for d in spring["days"] if d["date"] == "2027-03-28")
    assert row["hours"] == 23 and row["label"] == "Clocks go forward 01:00"
    assert all(d["hours"] == 24 for d in spring["days"] if d["date"] != "2027-03-28")
    iso = date(2027, 10, 31).isocalendar()
    autumn = desk.ok("GET", "/api/diary", params={"week": f"{iso[0]}-W{iso[1]:02d}"})
    row = next(d for d in autumn["days"] if d["date"] == "2027-10-31")
    assert row["hours"] == 25 and row["label"] == "Clocks go back 02:00"
    assert [r["runId"] for r in autumn["rows"]] == [run_id(hire)]
    error_of(desk.call("GET", "/api/diary", params={"week": "2027-W99"}), 422)


def set_blocks(desk: Desk, run: str, start: tuple[str, str], *blocks: tuple[str, int]) -> dict[str, Any]:
    return desk.ok("PUT", f"/api/runs/{run}/blocks", json={"startAt": {"date": start[0], "time": start[1]}, "blocks": [{"kind": k, "minutes": m} for k, m in blocks]})


def test_wf_drivers_hours_ribbon_pixels(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, depart={"date": "2027-05-14", "time": "11:00"})
    run = run_id(hire)
    set_blocks(desk, run, ("2027-05-14", "11:00"), ("drive", 271), ("break", 45), ("drive", 60))
    with screen(browser, app_url, f"/hires/{hire['id']}/hours?run={run}", desk=desk) as page:
        expect(h1(page, f"Drivers' hours {hire['id']}")).to_be_visible()
        ribbon = role(page, "region", "Duty ribbon")
        soon(page, lambda: len(part_boxes(ribbon, "block")) == 3, "three blocks")
        blocks = part_boxes(ribbon, "block")
        lengths = block_lengths(blocks)
        for i, minutes in enumerate((271, 45, 60)):
            assert abs(lengths[i] - minutes) <= 1, f"block {i}: {blocks[i]}"
        breaches = part_boxes(ribbon, "breach")
        assert breaches, "the breach is drawn on the ribbon"
        breach = breaches[0]
        first = blocks[0]
        along = breach["x"] - first["x"] if sideways(blocks) else breach["y"] - first["y"]
        assert abs(along - 271) <= 1, "the breach starts at its exact minute"
        shows(page, "Over the limit from 15:31")
        table = role(page, "table", "Duty blocks")
        for word in ("Drive", "Break", "271", "45", "60"):
            assert word in table.inner_text()
        click(visible(role(page, "button", "Confirm run")))
        said(page, "This run is over the limit. Move a break or add a second driver.")
        assert desk.ok("GET", f"/api/runs/{run}")["confirmed"] is False
    for start, date_text, count in ((("2027-10-31", "00:00"), "01:00", 2), (("2027-03-28", "00:00"), "01:", 0)):
        changed_hire = make_hire(desk, depart={"date": start[0], "time": start[1]})
        set_blocks(desk, run_id(changed_hire), start, ("drive", 180))
        with screen(browser, app_url, f"/hires/{changed_hire['id']}/hours?run={run_id(changed_hire)}", desk=desk) as page:
            marks = page.locator('[data-part="ruler-mark"]')
            soon(page, lambda: marks.count() > 0, "the ruler")
            texts = [t.strip() for t in marks.all_inner_texts()]
            assert sum(t.startswith(date_text) for t in texts) == count, f"{start}: {texts}"


def test_wf_drivers_hours_keyboard_break(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, depart={"date": "2027-05-14", "time": "11:00"})
    run = run_id(hire)
    set_blocks(desk, run, ("2027-05-14", "11:00"), ("drive", 271), ("break", 45), ("drive", 60))
    with screen(browser, app_url, f"/hires/{hire['id']}/hours?run={run}", desk=desk) as page:
        slider = role(page, "slider", re.compile(r"^Break \d+$"))
        expect(slider).to_be_visible()
        slider.focus()
        page.keyboard.press("ArrowLeft")
        said(page, "Break moved.")
        soon(page, lambda: desk.ok("GET", f"/api/runs/{run}/hours")["breaches"] == [], "the breach clears in the data")
        assert slider.evaluate("e => e === document.activeElement"), "focus kept"
        assert any(m["duration"] == 320 for m in motions(page)), "blocks reflow in 320 ms"
        assert_published_motion(page)
        def first_drive() -> float:
            return block_lengths(part_boxes(role(page, "region", "Duty ribbon"), "block"))[0]

        soon(page, lambda: abs(first_drive() - (271 - 15)) <= 1, "first drive 15 minutes shorter")
        page.keyboard.press("Shift+ArrowLeft")
        soon(page, lambda: abs(first_drive() - (271 - 15 - 5)) <= 1, "Shift moves 5 minutes")
        assert desk.ok("GET", f"/api/runs/{run}/hours")["drivingMinutes"] == 271 + 60
        x, y = center(slider)
        before_drag = first_drive()
        mouse_drag(page, (x, y), (x - 30, y))
        soon(page, lambda: first_drive() < before_drag, "a pointer drag moves the break")
        x, y = center(slider)
        before_drag = first_drive()
        touch_drag(page, (x, y), (x - 30, y))
        soon(page, lambda: first_drive() < before_drag, "touch moves the break")
        click(visible(role(page, "button", "Confirm run")))
        said(page, "Run confirmed.")
    assert desk.ok("GET", f"/api/runs/{run}")["confirmed"] is True


@pytest.mark.timeout(1800)
def test_wf_drivers_hours_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, depart={"date": "2027-05-14", "time": "11:00"})
    run = run_id(hire)
    set_blocks(desk, run, ("2027-05-14", "11:00"), ("drive", 271))
    path = f"/hires/{hire['id']}/hours?run={run}"
    meets_screen_rules(browser, app_url, path, "Add second driver", "Add second driver", desk=desk, main="Confirm run", endpoint=f"/api/runs/{run}/blocks", method="PUT", read=desk.ok("GET", f"/api/runs/{run}/hours"))
    with screen(browser, app_url, path, desk=desk) as page:
        click(role(page, "button", "Add second driver"))
        box = role(page, "dialog", "Add second driver")
        soon(page, lambda: "£150.00" in box.inner_text(), "the charge in the dialog")
        click(role(box, "button", "Add charge"))
        said(page, "Second driver added.")
    sweep_routes(browser, app_url, "hours")


def test_hours_limits_across_changes(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    run = run_id(make_hire(desk, depart={"date": "2027-05-14", "time": "11:00"}))
    ok = set_blocks(desk, run, ("2027-05-14", "11:00"), ("drive", 270), ("break", 45))
    assert ok == {"drivingMinutes": 270, "spreadMinutes": 315, "breaches": []}
    bad = set_blocks(desk, run, ("2027-05-14", "11:00"), ("drive", 271), ("break", 45))
    assert bad["breaches"] == [{"rule": "drivingBeforeBreak", "atMinute": 271, "atLocal": {"date": "2027-05-14", "time": "15:31"}}]
    assert desk.ok("GET", f"/api/runs/{run}/hours") == bad
    error_of(desk.call("POST", f"/api/runs/{run}/confirm", json={}), 409, "overTheLimit", "This run is over the limit. Move a break or add a second driver.")
    spring = set_blocks(desk, run, ("2027-03-27", "22:00"), ("drive", 271), ("break", 45))["breaches"][0]
    assert spring["atLocal"]["date"] == "2027-03-28" and spring["atLocal"]["time"] == f"03:{30 + 1}"
    autumn = set_blocks(desk, run, ("2027-10-30", "22:00"), ("drive", 271), ("break", 45))["breaches"][0]
    assert autumn["atLocal"]["date"] == "2027-10-31" and autumn["atLocal"]["time"] == f"01:{30 + 1}"
    fine = set_blocks(desk, run, ("2027-10-30", "19:00"), ("drive", 270), ("break", 45), ("wait", 465))
    assert fine["spreadMinutes"] == 780 and fine["breaches"] == []
    over = set_blocks(desk, run, ("2027-10-30", "19:00"), ("drive", 270), ("break", 45), ("wait", 480))
    assert [(b["rule"], b["atMinute"]) for b in over["breaches"]] == [("spread", 780 + 1)]


def test_hours_split_and_daily(app_url: str, ntfy: Ntfy, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    run = run_id(make_hire(desk, depart={"date": "2027-05-14", "time": "06:00"}))
    assert set_blocks(desk, run, ("2027-05-14", "06:00"), ("drive", 200), ("break", 15), ("drive", 70), ("break", 30), ("drive", 200))["breaches"] == []
    wrong = set_blocks(desk, run, ("2027-05-14", "06:00"), ("drive", 200), ("break", 30), ("drive", 70), ("break", 15), ("drive", 200))
    assert [b["rule"] for b in wrong["breaches"]] == ["drivingBeforeBreak"]
    phone = fresh_phone()
    def runner(day: str, time_text: str, *blocks: tuple[str, int]) -> str:
        made = run_id(make_hire(desk, depart={"date": day, "time": time_text}))
        set_blocks(desk, made, (day, time_text), *blocks)
        desk.ok("PUT", f"/api/runs/{made}/driver", json={"name": "Ewan Price", "telephone": phone})
        return made
    long_day = (("drive", 270), ("break", 45), ("drive", 270), ("break", 45), ("drive", 30))
    tue = runner("2027-05-11", "06:00", *long_day)
    wed = runner("2027-05-12", "06:00", *long_day)
    run_a = runner("2027-05-13", "06:00", ("drive", 270))
    run_b = runner("2027-05-13", "12:00", ("drive", 270), ("break", 45), ("drive", 30))
    for quiet in (tue, wed, run_a):
        assert desk.ok("GET", f"/api/runs/{quiet}/hours")["breaches"] == [], quiet
    assert desk.ok("GET", f"/api/runs/{run_a}/hours")["drivingMinutes"] == 270
    b = desk.ok("GET", f"/api/runs/{run_b}/hours")
    assert b["drivingMinutes"] == 300
    assert [(x["rule"], x["atMinute"]) for x in b["breaches"]] == [("dailyDriving", 316)]
    assert desk.ok("POST", f"/api/runs/{run_b}/second-driver", json={})
    assert desk.ok("GET", f"/api/runs/{run_b}/hours")["breaches"] == [], "second driver clears and stops counting"
    assert desk.ok("GET", f"/api/runs/{run_a}/hours")["breaches"] == []
    single = run_id(make_hire(desk, depart={"date": "2027-05-14", "time": "06:00"}))
    day_limit = set_blocks(desk, single, ("2027-05-14", "06:00"), ("drive", 270), ("break", 45), ("drive", 270), ("break", 45), ("drive", 61))
    assert [(x["rule"], x["atMinute"]) for x in day_limit["breaches"]] == [("dailyDriving", 691)]


def test_second_driver_clears(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, depart={"date": "2027-05-14", "time": "11:00"})
    run = run_id(hire)
    set_blocks(desk, run, ("2027-05-14", "11:00"), ("drive", 300))
    assert desk.ok("GET", f"/api/runs/{run}/hours")["breaches"]
    desk.ok("POST", f"/api/runs/{run}/second-driver", json={})
    desk.ok("POST", f"/api/runs/{run}/second-driver", json={})
    assert desk.ok("GET", f"/api/runs/{run}/hours")["breaches"] == []
    assert desk.ok("POST", f"/api/runs/{run}/confirm", json={})["confirmed"] is True
    assert desk.ok("GET", f"/api/hires/{hire['id']}")["vehicles"][0]["total"] == f"{Decimal('1157.25') + Decimal('150.00'):.2f}"
    ledger = desk.ok("GET", f"/api/hires/{hire['id']}/ledger")
    assert ledger["sum"] == "0.00"
    assert sorted((l["account"], l["amount"]) for l in ledger["lines"]) == [("hireIncome", f"-{'150.00'}"), ("operatorOwed", "150.00")]


def seats_hire(desk: Desk, *names: str, occasion: str = "school") -> dict[str, Any]:
    hire = make_hire(desk, occasion=occasion)
    for name in names:
        desk.ok("POST", f"/api/hires/{hire['id']}/passengers", 201, json={"name": name, "group": "Adult", "needs": ""})
    return hire


def seat_of(desk: Desk, hire: dict[str, Any], person: str) -> str | None:
    passengers = {p["name"]: p["id"] for p in desk.ok("GET", f"/api/hires/{hire['id']}/passengers")["passengers"]}
    grid = desk.ok("GET", f"/api/hires/{hire['id']}/seats")["vehicles"][0]["grid"]
    return next((s["seat"] for s in grid if s["passengerId"] == passengers[person]), None)


def test_wf_passenger_seat_plan_keyboard_swap(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    a, b = "Agnieszka Wiśniewska", "Jack O'Rourke"
    desk = new_desk(app_url)
    hire = seats_hire(desk, a, b)
    with screen(browser, app_url, f"/hires/{hire['id']}/seats", desk=desk) as page:
        expect(h1(page, f"Seat plan {hire['id']}")).to_be_visible()
        grid = role(page, "grid", "Seats 49-seat vehicle")
        expect(grid).to_be_visible()
        first = role(grid, "gridcell", f"Seat 1A: {a}")
        soon(page, lambda: first.count() == 1, "seat 1A named with its person")
        expect(role(grid, "gridcell", "Seat 1D: empty")).to_have_count(1)
        first.focus()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Space")
        said(page, f"{a} is now in 1B. {b} is now in 1A.")
        assert (seat_of(desk, hire, a), seat_of(desk, hire, b)) == ("1B", "1A")
        soon(page, lambda: role(grid, "gridcell", f"Seat 1B: {a}").count() == 1 and role(grid, "gridcell", f"Seat 1B: {a}").evaluate("e => e === document.activeElement || e.contains(document.activeElement)"), "focus on the seat dropped on")
        assert any(m["duration"] == 320 for m in motions(page)), "two seats cross in 320 ms"
        x, y = center(role(grid, "gridcell", f"Seat 1B: {a}"))
        tx, ty = center(role(grid, "gridcell", "Seat 3A: empty"))
        mouse_drag(page, (x, y), (tx, ty), escape=True)
        assert seat_of(desk, hire, a) == "1B", "Escape puts the person back"
        mouse_drag(page, (x, y), (tx, ty))
        said(page, f"{a} is now in 3A.")
        assert seat_of(desk, hire, a) == "3A"
        x, y = center(role(grid, "gridcell", f"Seat 1A: {b}"))
        tx, ty = center(role(grid, "gridcell", "Seat 4A: empty"))
        touch_drag(page, (x, y), (tx, ty))
        said(page, f"{b} is now in 4A.")
        page.evaluate("window.print = () => { window.__printed = true; }")
        click(role(page, "button", "Print plan"))
        soon(page, lambda: page.evaluate("window.__printed === true"), "Print plan prints")


def test_wf_passenger_seat_plan_reopen_and_refresh(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, occasion="school")
    with screen(browser, app_url, f"/hires/{hire['id']}/seats", desk=desk) as page:
        shows(page, "No passengers yet.")
        opener = visible(role(page, "button", "Add passengers"))
        click(opener)
        box = role(page, "dialog", "Add passengers")
        soon(page, lambda: box.count() == 1, "dialog")
        page.keyboard.press("Escape")
        opener.press("Enter")
        soon(page, lambda: box.count() == 1, "reopened")
        advance(page, 1000)
        assert box.is_visible(), "no stale close timer re-hides the reopened dialog"
        name = role(box, "textbox", "Name")
        name.fill("Maja Kowalska")
        role(box, "textbox", "Group").fill("Year 5")
        advance(page, REFRESH_MS + 100)
        expect(name).to_have_value("Maja Kowalska")
        click(role(box, "button", "Add name"))
        said(page, "Name added.")
        advance(page, REFRESH_MS + 100)
        assert "Name added." in region_text(page), "a refresh does not overwrite the status"
        data = "Name;Group;Needs\nIbrahim Malik;Year 5;\nTom Bennett;Adult;\n".encode()
        box = role(page, "dialog", "Add passengers") if role(page, "dialog", "Add passengers").count() else None
        if box is None:
            click(opener)
            box = role(page, "dialog", "Add passengers")
        labelled(box, "Passenger file").set_input_files({"name": "list.csv", "mimeType": "text/csv", "buffer": data})
        click(role(box, "button", "Bring in list"))
        said(page, "2 names brought in.")
    names = [p["name"] for p in desk.ok("GET", f"/api/hires/{hire['id']}/passengers")["passengers"]]
    assert names == ["Maja Kowalska", "Ibrahim Malik", "Tom Bennett"]
    keys = S3().keys(f"desks/{desk.info['id']}/passengers/{hire['id']}/")
    assert len(keys) == 1 and S3().get(keys[0]) == data


@pytest.mark.timeout(1800)
def test_wf_passenger_seat_plan_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = seats_hire(desk, "Maja Kowalska")
    meets_screen_rules(browser, app_url, f"/hires/{hire['id']}/seats", "Add passengers", "Add passengers", desk=desk, main="Add passengers", typed_into=("textbox", "Name"), endpoint=f"/api/hires/{hire['id']}/passengers/import", limit=PASSENGER_LIMIT, ctype="text/csv", read=desk.ok("GET", f"/api/hires/{hire['id']}/seats"))
    sweep_routes(browser, app_url, "seats")


def test_seat_grids_and_split(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    for seats, last in ((8, "3B"), (12, "3D"), (16, "4D"), (31, "8C"), (49, "13A"), (56, "14D"), (70, "18B")):
        grid = desk.ok("GET", f"/api/hires/{make_hire(desk, seats=seats)['id']}/seats")["vehicles"][0]["grid"]
        names = [s["seat"] for s in grid]
        assert len(names) == len(set(names)) == seats and last in names, (seats, names[-3:])
    hire = make_hire(desk, occasion="school")
    body = "Name,Group,Needs\n" + "".join(f"Pupil {i:02d},Year 5,\n" for i in range(46)) + "Lead Adult,Adult,\n"
    made = desk.ok("POST", f"/api/hires/{hire['id']}/passengers/import", 201, content=body.encode(), headers={"content-type": "text/csv"})
    assert made["objectKey"] == f"desks/{desk.info['id']}/passengers/{hire['id']}/{made['listId']}.csv" and S3().get(made["objectKey"]) == body.encode()
    listed = desk.ok("GET", f"/api/hires/{hire['id']}/passengers")
    assert listed["adultsNeeded"] == 4 and listed["adultsShort"] == 3
    split = desk.ok("GET", f"/api/hires/{hire['id']}/seats")["vehicles"][0]["split"]
    assert len(split) == 47 and sum(Decimal(s["amount"]) for s in split) == Decimal("1157.25")
    assert [s["amount"] for s in split] == ["24.63"] * 11 + ["24.62"] * 36
    other = make_hire(desk, occasion="company")
    url = f"/api/hires/{other['id']}/passengers"
    wheel = [desk.ok("POST", url, 201, json={"name": f"Wheel {i}", "group": "", "needs": "WHEELCHAIR"}) for i in range(2)]
    assert all(w["wheelchair"] is True for w in wheel)
    plain = desk.ok("POST", url, 201, json={"name": "Plain Person", "group": "", "needs": ""})
    vehicle = other["vehicles"][0]["id"]
    assert seat_of(desk, other, "Wheel 0") == "2A" and seat_of(desk, other, "Wheel 1") == "2B"
    seats_url = f"/api/hires/{other['id']}/seats"
    error_of(desk.call("PUT", seats_url, json={"vehicleId": vehicle, "passengerId": wheel[0]["id"], "seat": "5A"}), 409, "wheelchairSeat", "Wheelchair users sit only in 2A and 2B.")
    error_of(desk.call("PUT", seats_url, json={"vehicleId": vehicle, "passengerId": plain["id"], "seat": "2A"}), 409, "wheelchairSeat")
    error_of(desk.call("PUT", seats_url, json={"vehicleId": vehicle, "passengerId": plain["id"], "seat": "99Z"}), 422)
    twice = desk.ok("POST", url, 201, json={"name": "PLAIN person", "group": "", "needs": ""})
    assert twice["listedTwice"] is True
    desk.ok("PUT", seats_url, json={"vehicleId": vehicle, "passengerId": plain["id"], "seat": "12A"})
    assert seat_of(desk, other, "Plain Person") == "12A"
    limit = make_hire(desk)
    def rows(n: int) -> bytes:
        return ("name,GROUP,Needs\n" + "".join(f"P{i},,\n" for i in range(n))).encode()
    assert desk.call("POST", f"/api/hires/{limit['id']}/passengers/import", content=rows(500), headers={"content-type": "text/csv"}).status_code == 201
    error_of(desk.call("POST", f"/api/hires/{limit['id']}/passengers/import", content=rows(501), headers={"content-type": "text/csv"}), 422, message="This file has more than 500 rows.")


def press(base: str, sheet: str, stop: str, kind: str, ago: int = 0, key: str | None = None) -> httpx.Response:
    return httpx.post(base + api_path(sheet) + "/presses", json={"stopId": stop, "kind": kind, "secondsAgo": ago, "repeatKey": key or uuid.uuid4().hex}, timeout=HTTP_TIMEOUT)


def test_wf_driver_run_sheet_journey(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    sheet = hire["runs"][0]["sheetPath"]
    with screen(browser, app_url, page_path(sheet), size=PHONE) as page:
        expect(h1(page, f"Run {hire['runs'][0]['number']}")).to_be_visible()
        group = role(page, "group", "Stop 1 of 2")
        layout(page)
        assert_touch_targets(page)
        tap(role(group, "button", "Arrived"))
        said(page, "Arrived recorded.")
        tap(role(group, "button", "Boarded"))
        said(page, "Boarded recorded.")
        tap(role(group, "button", "Left"))
        said(page, "Left recorded.")
        shows(page, "All sent")
    read = httpx.get(app_url + api_path(sheet), timeout=HTTP_TIMEOUT).json()
    assert all(read["stops"][0]["presses"][k] for k in ("arrived", "boarded", "left"))
    stop = read["stops"][1]["id"]
    press(app_url, sheet, stop, "arrived", 37 * 60).raise_for_status()
    press(app_url, sheet, stop, "boarded").raise_for_status()
    with screen(browser, app_url, f"/hires/{hire['id']}/hours?run={run_id(hire)}", desk=desk) as page:
        click(visible(role(page, "button", "Accept charges")))
        said(page, "Charges accepted: £7.33.")
    assert desk.ok("GET", f"/api/hires/{hire['id']}")["vehicles"][0]["total"] == "1164.58"


def test_wf_driver_run_sheet_polish_landscape(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    run = hire["runs"][0]
    path = page_path(run["sheetPath"])
    tag = re.search(r"<html[^>]*>", httpx.get(app_url + path + "?lang=pl", timeout=HTTP_TIMEOUT).text).group(0)
    assert (html_attr(tag, "lang") or "").split("-")[0] == "pl", tag
    with screen(browser, app_url, path, size=LANDSCAPE) as page:
        expect(page).to_have_title(f"Run {run['number']}")
        switch_language(page, "Polski")
        soon(page, lambda: "lang=pl" in page.url, "Polish in the address")
        expect(h1(page, f"Kurs {run['number']}")).to_be_visible()
        layout(page)
        group = role(page, "group", "Przystanek 1 z 2")
        click(role(group, "button", "Na miejscu"))
        said(page, "Zapisano: Na miejscu.")
        shows(page, "Wszystko wysłane")
        count = page.get_by_text("Wszystko wysłane", exact=True).first
        for end in ("0", "document.documentElement.scrollHeight"):
            page.evaluate(f"scrollTo(0, {end})")
            advance(page, 100)
            assert in_view(count, LANDSCAPE), "stops scroll under a fixed count"


@pytest.mark.timeout(1800)
def test_wf_driver_run_sheet_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    sheet = hire["runs"][0]["sheetPath"]
    meets_screen_rules(browser, app_url, page_path(sheet), "Run details", "Run details", endpoint=api_path(sheet) + "/presses", read=httpx.get(app_url + api_path(sheet), timeout=HTTP_TIMEOUT).json(), shape="sheet")
    sweep_routes(browser, app_url, "r", "r_pl")


def test_driver_told_after_ntfy(browser: Browser, app_url: str, ntfy: Ntfy, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    phone = fresh_phone()
    topic = topic_of(phone)
    hire = make_hire(desk, depart={"date": "2027-05-14", "time": "08:00"})
    run = run_id(hire)
    number = hire["runs"][0]["number"]
    told = desk.ok("PUT", f"/api/runs/{run}/driver", json={"name": "Ewan Price", "telephone": phone})
    assert INSTANT.match(told["toldAt"]) and told["driver"] == {"name": "Ewan Price", "telephone": phone}
    got = ntfy.messages(topic, 1)
    assert [(m["title"], m["message"]) for m in got] == [(f"Run {number}", f"Run {number}: 08:00 Fri 14 May 2027, Coventry station.")]
    assert desk.ok("PUT", f"/api/runs/{run}/driver", json={"name": "Ewan Price", "telephone": phone})["toldAt"] == told["toldAt"]
    assert len(ntfy.messages(topic, 2, timeout=3)) == 1, "the same driver again publishes nothing"
    assert desk.ok("POST", f"/api/runs/{run}/tell", json={})["toldAt"]
    assert len(ntfy.messages(topic, 2)) == 2, "one message per press"
    desk.ok("PUT", f"/api/runs/{run}/departure", json={"departAt": {"date": "2027-05-14", "time": "09:15"}})
    last = ntfy.messages(topic, 3)
    assert len(last) == 3 and last[-1]["message"] == f"Run {number} changed: 09:15 Fri 14 May 2027, Coventry station."
    uk = instant_of(desk.ok("GET", f"/api/runs/{run}")["toldAt"]).astimezone(UK)
    with screen(browser, app_url, f"/hires/{hire['id']}/hours?run={run}", desk=desk) as page:
        shows(page, f"Driver told at {uk:%H:%M}")
    bare = make_hire(desk)
    error_of(desk.call("POST", f"/api/runs/{run_id(bare)}/tell", json={}), 409)


def test_driver_not_told_when_ntfy_down(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_NTFY_DOWN_URL")
    desk = new_desk(base)
    copy = "We couldn't reach the driver's phone. Nothing was marked as told."
    wed = week_day(base, 2)
    hire = make_hire(desk, depart={"date": wed.isoformat(), "time": "08:00"})
    run = run_id(hire)
    with screen(browser, base, "/diary", desk=desk) as page:
        soon(page, lambda: role(page, "button", "Assign driver").count() >= 1, "Assign driver")
        click(visible(role(page, "button", "Assign driver")))
        box = role(page, "dialog", "Assign driver")
        phone = fresh_phone()
        role(box, "textbox", "Driver name").fill("Ewan Price")
        role(box, "textbox", "Driver telephone").fill(phone)
        click(role(box, "button", "Tell driver"))
        said(page, copy)
    state = desk.ok("GET", f"/api/runs/{run}")
    assert state["driver"]["telephone"] == phone and state["toldAt"] is None
    error_of(desk.call("POST", f"/api/runs/{run}/tell", json={}), 503, message=copy)
    assert desk.ok("GET", f"/api/runs/{run}")["toldAt"] is None
    with screen(browser, base, "/diary", desk=desk) as page:
        soon(page, lambda: role(page, "button", "Tell driver again").count() >= 1, "Tell driver again")
        assert "Driver told at" not in body_text(page)


def test_press_replay_api(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    sheet = make_hire(desk)["runs"][0]["sheetPath"]
    stop = httpx.get(app_url + api_path(sheet), timeout=HTTP_TIMEOUT).json()["stops"][0]["id"]
    other = httpx.get(app_url + api_path(sheet), timeout=HTTP_TIMEOUT).json()["stops"][1]["id"]
    error_of(press(app_url, sheet, stop, "boarded"), 409, "pressOutOfOrder")
    now = server_now(app_url)
    key = uuid.uuid4().hex
    first = press(app_url, sheet, stop, "arrived", 600, key)
    assert first.status_code == 201 and INSTANT.match(first.json()["at"])
    assert abs((now - instant_of(first.json()["at"])).total_seconds() - 600) < 30
    replay = press(app_url, sheet, stop, "arrived", 900, key)
    assert replay.status_code == 201 and replay.json() == first.json(), "the first attempt fixes the instant"
    error_of(press(app_url, sheet, stop, "boarded", 0, key), 409, "repeatKeyConflict")
    error_of(press(app_url, sheet, other, "arrived", 0, key), 409, "repeatKeyConflict")
    error_of(press(app_url, sheet, stop, "arrived"), 409, "pressOutOfOrder")
    read = httpx.get(app_url + api_path(sheet), timeout=HTTP_TIMEOUT).json()
    assert read["stops"][0]["presses"]["arrived"] == first.json()["at"] and read["stops"][0]["presses"]["boarded"] is None
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        key = uuid.uuid4().hex
        results = list(pool.map(lambda _: press(app_url, sheet, stop, "boarded", 0, key), range(5)))
    assert {r.status_code for r in results} == {201} and len({r.text for r in results}) == 1


@pytest.mark.timeout(240)
def test_queued_presses_offline(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    sheet = make_hire(desk)["runs"][0]["sheetPath"]
    api = app_url + api_path(sheet)
    with screen(browser, app_url, page_path(sheet), size=PHONE, workers=True) as page:
        soon(page, lambda: page.evaluate("async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active && r.active.state === 'activated'); }"), "the page's service worker is active")
        page.reload()
        soon(page, lambda: page.evaluate("!!navigator.serviceWorker.controller"), "the service worker controls the page")
        group = role(page, "group", "Stop 1 of 2")
        expect(group).to_be_visible()
        pressed_at = server_now(app_url)
        page.context.set_offline(True)
        tap(role(group, "button", "Arrived"))
        shows(page, "1 waiting to send")
        tap(role(group, "button", "Boarded"))
        shows(page, "2 waiting to send")
        soon(page, lambda: REFRESH_LINE in body_text(page), "failed-refresh line beside the count", REFRESH_MS / 1000 + 3)
        assert "2 waiting to send" in body_text(page), "a refresh never removes a waiting press"
        assert httpx.get(api, timeout=HTTP_TIMEOUT).json()["stops"][0]["presses"]["arrived"] is None
        page.reload()
        expect(role(page, "group", "Stop 1 of 2")).to_be_visible()
        shows(page, "2 waiting to send")
        advance(page, SEND_MS)
        page.context.set_offline(False)
        shows(page, "All sent", seconds=30)
        soon(page, lambda: REFRESH_LINE not in body_text(page), "the next good refresh clears the line")
    presses = httpx.get(api, timeout=HTTP_TIMEOUT).json()["stops"][0]["presses"]
    assert presses["arrived"] and presses["boarded"] and instant_of(presses["arrived"]) <= instant_of(presses["boarded"])
    assert abs((instant_of(presses["arrived"]) - pressed_at).total_seconds()) <= SEND_TOLERANCE_S, "time counts from the press on the phone, not from the send"


def test_waiting_charges(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    stops = [COVENTRY, FIVE_STOPS[1], FIVE_STOPS[2], NEC]
    hire = make_hire(desk, stops=stops)
    sheet = hire["runs"][0]["sheetPath"]
    run = run_id(hire)
    ids = [s["id"] for s in httpx.get(app_url + api_path(sheet), timeout=HTTP_TIMEOUT).json()["stops"]]
    for stop, minutes in zip(ids, (15, 16, 19, 37)):
        press(app_url, sheet, stop, "arrived", minutes * 60).raise_for_status()
        press(app_url, sheet, stop, "boarded").raise_for_status()
    charges = {c["stopId"]: c for c in desk.ok("GET", f"/api/runs/{run}")["charges"]}
    assert ids[0] not in charges or charges[ids[0]]["amount"] == "0.00"
    assert [(charges[i]["minutes"], charges[i]["amount"], charges[i]["kind"], charges[i]["accepted"]) for i in ids[1:]] == [(16, "0.33", "waiting", False), (19, "1.33", "waiting", False), (37, "7.33", "waiting", False)]
    assert desk.ok("GET", f"/api/hires/{hire['id']}")["vehicles"][0]["total"] == "1157.25"
    assert desk.ok("GET", f"/api/hires/{hire['id']}/ledger")["lines"] == []
    accepted = desk.ok("POST", f"/api/runs/{run}/accept-charges", json={})
    assert (accepted["added"], accepted["vehicleTotal"]) == ("8.99", "1166.24")
    assert desk.ok("POST", f"/api/runs/{run}/accept-charges", json={})["added"] == "0.00"
    ledger = desk.ok("GET", f"/api/hires/{hire['id']}/ledger")
    assert ledger["sum"] == "0.00"
    assert sum(Decimal(l["amount"]) for l in ledger["lines"] if l["account"] == "operatorOwed") == Decimal("8.99")
    assert sum(Decimal(l["amount"]) for l in ledger["lines"] if l["account"] == "hireIncome") == Decimal("-8.99")
    assert all(c["accepted"] for c in desk.ok("GET", f"/api/runs/{run}")["charges"])


def test_airport_and_comfort(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    now = server_now(app_url)
    uk = now.astimezone(UK)
    hire = make_hire(desk, depart={"date": uk.date().isoformat(), "time": f"{uk:%H:%M}"})
    run, sheet = run_id(hire), hire["runs"][0]["sheetPath"]
    stop = desk.ok("GET", f"/api/runs/{run}")["stops"][0]["id"]
    assert desk.ok("PUT", f"/api/runs/{run}/stops/{stop}/flight", json={"code": "WT123"})["stops"][0]["flightCode"] == "WT123"
    landed = (now - timedelta(minutes=82)).strftime("%Y-%m-%dT%H:%M:%SZ")
    wiremock.stub("GET", "/v1/flights/WT123", json={"scheduledArrival": landed, "actualArrival": landed, "status": "landed"})
    before = len(wiremock.requests("/v1/flights/WT123"))
    press(app_url, sheet, stop, "arrived").raise_for_status()
    press(app_url, sheet, stop, "boarded").raise_for_status()
    press(app_url, sheet, stop, "left").raise_for_status()
    calls = wiremock.requests("/v1/flights/WT123")[before:]
    assert len(calls) == 1 and uk.date().isoformat() in json.dumps(calls[0]), "read once, with the run's UK date"
    charge = desk.ok("GET", f"/api/runs/{run}")["charges"][0]
    assert charge["minutes"] in (82, 83) and charge["amount"] in ("7.33", "7.67")
    second = make_hire(desk, depart={"date": (now - timedelta(minutes=82)).astimezone(UK).date().isoformat(), "time": f"{(now - timedelta(minutes=82)).astimezone(UK):%H:%M}"})
    stop2 = desk.ok("GET", f"/api/runs/{run_id(second)}")["stops"][0]["id"]
    desk.ok("PUT", f"/api/runs/{run_id(second)}/stops/{stop2}/flight", json={"code": "WT999"})
    wiremock.fault("GET", "/v1/flights/WT999")
    sheet2 = second["runs"][0]["sheetPath"]
    press(app_url, sheet2, stop2, "arrived").raise_for_status()
    press(app_url, sheet2, stop2, "boarded").raise_for_status()
    assert httpx.get(app_url + api_path(sheet2), timeout=HTTP_TIMEOUT).json()["flightLine"], "the failed flight read is flagged"
    assert _rendered_has(browser, app_url, page_path(sheet2), "Flight times unavailable. Waiting counts from the booked pick-up.")
    assert desk.ok("GET", f"/api/runs/{run_id(second)}")["charges"][0]["amount"] in ("7.33", "7.67")
    third = make_hire(desk)
    stop3 = desk.ok("GET", f"/api/runs/{run_id(third)}")["stops"][0]["id"]
    for kind, ago in (("arrived", 40 * 60), ("boarded", 39 * 60), ("left", 38 * 60), ("comfortStop", 37 * 60), ("backOnTheRoad", 0)):
        press(app_url, third["runs"][0]["sheetPath"], stop3, kind, ago).raise_for_status()
    comfort = next(c for c in desk.ok("GET", f"/api/runs/{run_id(third)}")["charges"] if c["kind"] == "comfortStop")
    assert (comfort["kind"], comfort["amount"]) == ("comfortStop", "7.33")


def test_wf_changes_and_cancellations_price_move(browser: Browser, app_url: str, mail: Mailpit, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    paid_in = "1000.00"
    new_price = "700.00"
    new_total = f"{selling(new_price, '15'):.2f}"
    refund = f"{Decimal(paid_in) - Decimal(new_total):.2f}"
    pay(desk, hire["id"], paid_in)
    vehicle = hire["vehicles"][0]["id"]
    with screen(browser, app_url, f"/hires/{hire['id']}/changes", desk=desk) as page:
        expect(h1(page, f"Changes {hire['id']}")).to_be_visible()
        click(visible(role(page, "button", "Change booking")))
        box = role(page, "dialog", "Change booking")
        price = role(box, "textbox", "Bought price for vehicle 1")
        soon(page, lambda: price.input_value().replace(",", "") in ("1006.30", "£1006.30"), "starts at the booking's value")
        price.fill(new_price)
        page.keyboard.press("Tab")
        soon(page, lambda: f"£{new_total}" in role(box, "group", "New").inner_text() and "£1,157.25" in role(box, "group", "Old").inner_text(), "old and new side by side")
        old, new = role(box, "group", "Old").bounding_box(), role(box, "group", "New").bounding_box()
        assert old["x"] + old["width"] <= new["x"] + 1 or old["y"] + old["height"] <= new["y"] + 1
        click(role(box, "button", "Save change"))
        said(page, "Booking changed.")
        shows(page, f"£{refund}")
    applied = desk.ok("GET", f"/api/hires/{hire['id']}")
    assert applied["vehicles"][0]["id"] == vehicle and applied["vehicles"][0]["refundsDue"] == refund
    assert page_path(applied["quotePath"]) != page_path(hire["quotePath"])
    assert httpx.get(app_url + api_path(hire["quotePath"]), timeout=HTTP_TIMEOUT).status_code == 410
    fresh_page = httpx.get(app_url + api_path(applied["quotePath"]), timeout=HTTP_TIMEOUT).json()
    assert fresh_page["state"] == "open" and fresh_page["total"] == new_total
    delivered = mails(mail, to=hire["customerBody"]["email"], subject=f"Your quote {hire['id']}", count=1)
    assert len(delivered) == 1 and page_path(applied["quotePath"]) in text(delivered[0])
    assert desk.ok("GET", f"/api/hires/{hire['id']}")["runs"][0]["id"] == run_id(hire), "runs stay"
    assert desk.ok("GET", "/api/payments")["moneyHeld"] == paid_in, "payments stay"
    quoted = make_hire(desk, stage="quoted")
    error_of(desk.call("POST", f"/api/hires/{quoted['id']}/changes", json={}), 409)


def test_wf_changes_and_cancellations_cancel_twice(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    year = next_year(app_url)
    hire = make_hire(desk, depart={"date": f"{year}-05-14", "time": "08:00"})
    pay(desk, hire["id"], "200.00")
    with screen(browser, app_url, f"/hires/{hire['id']}/changes", desk=desk) as page:
        click(visible(role(page, "button", "Cancel booking")))
        box = role(page, "dialog", "Cancel booking")
        soon(page, lambda: box.count() == 1, "dialog")
        role(box, "textbox", "Notice date").fill(f"14/04/{year}")
        select(role(box, "combobox", "Notice hour"), "00")
        select(role(box, "combobox", "Notice minutes"), "30")
        click(role(role(box, "radiogroup", "Notice"), "radio", "From the customer"))
        role(box, "button", "Cancel booking").dblclick()
        said(page, "Booking cancelled.")
    state = desk.ok("GET", f"/api/hires/{hire['id']}/changes")
    assert state["cancellation"]["by"] == "customer"
    assert state["cancellation"]["lines"][0]["days"] == 30 and state["cancellation"]["lines"][0]["charge"] == "150.00"
    assert state["cancellation"]["lines"][0]["refundsDue"] == "50.00"
    ledger = desk.ok("GET", f"/api/hires/{hire['id']}/ledger")
    assert [l["amount"] for l in ledger["lines"] if l["account"] == "refundsDue"] == ["-50.00"], "one cancellation, one refund movement"
    repeat = desk.ok("POST", f"/api/hires/{hire['id']}/cancel", json={"noticeAt": {"date": f"{year}-05-13", "time": "10:00"}, "by": "arranger"})
    assert repeat["cancellation"]["id"] == state["cancellation"]["id"] and repeat["cancellation"]["by"] == "customer"
    assert httpx.get(app_url + api_path(hire["runs"][0]["sheetPath"]), timeout=HTTP_TIMEOUT).status_code == 410
    read = httpx.get(app_url + api_path(hire["quotePath"]), timeout=HTTP_TIMEOUT)
    assert read.status_code == 200 and read.json()["cancelled"] is True
    error_of(httpx.post(app_url + api_path(hire["quotePath"]) + "/deposit-sent", json={}, timeout=HTTP_TIMEOUT), 409, "bookingCancelled", "This booking was cancelled.")
    gone = make_hire(desk, depart={"date": (today(app_url) - timedelta(days=2)).isoformat(), "time": "08:00"})
    day = today(app_url)
    with screen(browser, app_url, f"/hires/{gone['id']}/changes", desk=desk) as page:
        click(visible(role(page, "button", "Cancel booking")))
        box = role(page, "dialog", "Cancel booking")
        role(box, "textbox", "Notice date").fill(typed(day))
        select(role(box, "combobox", "Notice hour"), "00")
        select(role(box, "combobox", "Notice minutes"), "30")
        click(role(role(box, "radiogroup", "Notice"), "radio", "From us"))
        click(role(box, "button", "Cancel booking"))
        said(page, "This departure has already gone.")
        assert box.is_visible()


@pytest.mark.timeout(1800)
def test_wf_changes_and_cancellations_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    meets_screen_rules(browser, app_url, f"/hires/{hire['id']}/changes", "Cancel booking", "Cancel booking", desk=desk, main="Change booking", typed_into=("textbox", "Notice date"), endpoint=f"/api/hires/{hire['id']}/cancel", read=desk.ok("GET", f"/api/hires/{hire['id']}"))
    sweep_routes(browser, app_url, "changes")


def test_cancellation_charges(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    year = next_year(app_url)
    notice = {"date": f"{year}-04-14", "time": "00:30"}
    for depart, days, charge in ((f"{year}-05-13", 29, "289.31"), (f"{year}-05-14", 30, "150.00"), (f"{year}-04-28", 14, "578.63"), (f"{year}-04-21", 7, "1157.25")):
        hire = make_hire(desk, depart={"date": depart, "time": "08:00"})
        pay(desk, hire["id"], "1157.25")
        looked = desk.ok("POST", f"/api/hires/{hire['id']}/cancel/preview", json={"noticeAt": notice, "by": "customer"})["cancellation"]["lines"][0]
        assert (looked["days"], looked["charge"]) == (days, charge)
        assert desk.ok("GET", f"/api/hires/{hire['id']}/changes")["cancellation"] is None, "preview saves nothing"
        line = desk.ok("POST", f"/api/hires/{hire['id']}/cancel", json={"noticeAt": notice, "by": "customer"})["cancellation"]["lines"][0]
        assert (line["days"], line["charge"], line["paid"]) == (days, charge, "1157.25")
        due = Decimal("1157.25") - Decimal(charge)
        assert line["refundsDue"] == f"{due:.2f}" and line["owed"] == "0.00"
        ledger = desk.ok("GET", f"/api/hires/{hire['id']}/ledger")
        assert ledger["sum"] == "0.00"
        assert sum(Decimal(l["amount"]) for l in ledger["lines"] if l["account"] == "refundsDue") == -due
    cheap = make_hire(desk, depart={"date": f"{year}-05-13", "time": "08:00"}, bought="320.00", margin="0")
    floor = desk.ok("POST", f"/api/hires/{cheap['id']}/cancel/preview", json={"noticeAt": notice, "by": "customer"})["cancellation"]["lines"][0]
    assert floor["charge"] == "100.00" and floor["owed"] == "100.00" and floor["paid"] == "0.00"
    ours = make_hire(desk, depart={"date": f"{year}-05-13", "time": "08:00"})
    paid_in = "300.00"
    pay(desk, ours["id"], paid_in)
    line = desk.ok("POST", f"/api/hires/{ours['id']}/cancel", json={"noticeAt": notice, "by": "arranger"})["cancellation"]["lines"][0]
    assert line["refundsDue"] == paid_in and line["owed"] == "0.00"
    gone = make_hire(desk, depart={"date": (today(app_url) - timedelta(days=1)).isoformat(), "time": "08:00"})
    error_of(desk.call("POST", f"/api/hires/{gone['id']}/cancel", json={"noticeAt": notice, "by": "customer"}), 409, "departureGone", "This departure has already gone.")
    assert desk.ok("GET", f"/api/hires/{gone['id']}/changes")["cancellation"] is None


def test_wf_documents_invoice_strip(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = {"name": "Agnieszka Wiśniewska", "email": fresh()[1], "telephone": fresh_phone(), "language": "pl"}
    hire = make_hire(desk, customer=customer)
    with screen(browser, app_url, "/documents", desk=desk) as page:
        shows(page, "No documents yet.")
        click(visible(role(page, "button", "Make document")))
        box = role(page, "dialog", "Make document")
        soon(page, lambda: box.count() == 1, "dialog")
        select(role(box, "combobox", "Hire"), hire["id"])
        select(role(box, "combobox", "Kind"), "Invoice")
        wait_working(page, role(box, "button", "Make"), f"**/api/hires/{hire['id']}/documents", "Make")
        said(page, "Invoice stored.")
        steps = role(page, "list", "Steps").first
        soon(page, lambda: "Stored" in steps.inner_text(), "the strip reaches Stored")
        expect(steps.get_by_role("listitem")).to_have_count(3)
        drawn = len([m for m in motions(page) if m["duration"] == 320])
        advance(page, REFRESH_MS + 100)
        advance(page, REFRESH_MS + 100)
        assert len([m for m in motions(page) if m["duration"] == 320]) == drawn, "a check never draws again on a refresh"
        click(visible(role(page, "button", "History")))
        history = role(page, "dialog", "History")
        soon(page, lambda: history.count() == 1, "History")
        expect(role(page, "region", "Announcements")).to_have_count(1)
        page.keyboard.press("Escape")
        expect(visible(role(page, "link", "Download"))).to_be_visible()
    document = desk.ok("GET", "/api/documents")["documents"][0]
    assert document["state"] == "stored" and document["customerName"] == "Agnieszka Wiśniewska"
    stamps = [h["at"] for h in document["history"]]
    assert stamps and stamps == sorted(stamps)
    data = desk.call("GET", f"/api/documents/{document['id']}/file").content
    words = pdf_text(data)
    assert "Wiśniewska" in words and "1006.30" not in words and "1,006.30" not in words
    assert S3().get(document["objectKey"]) == data
    error_of(desk.call("PATCH", f"/api/documents/{document['id']}", json={"number": "X"}), 405)


def test_wf_documents_outage_copy(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_GOTENBERG_DOWN_URL")
    desk = new_desk(base)
    hire = make_hire(desk)
    quoted = make_hire(desk, stage="quoted")
    with screen(browser, base, "/documents", desk=desk) as page:
        click(visible(role(page, "button", "Make document")))
        box = role(page, "dialog", "Make document")
        select(role(box, "combobox", "Hire"), hire["id"])
        select(role(box, "combobox", "Kind"), "Invoice")
        click(role(box, "button", "Make"))
        said(page, "The PDF service is unavailable right now. Nothing was saved.")
        assert box.is_visible()
        select(role(box, "combobox", "Hire"), quoted["id"])
        click(role(box, "button", "Make"))
        said(page, "This hire has no accepted quote yet.")
    assert desk.ok("GET", "/api/documents")["documents"] == []


@pytest.mark.timeout(1800)
def test_wf_documents_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "invoice"})
    meets_screen_rules(browser, app_url, "/documents", "Make document", "Make document", desk=desk, main="Make document", endpoint=f"/api/hires/{hire['id']}/documents", read=desk.ok("GET", "/api/documents"))
    sweep_routes(browser, app_url, "documents")


def test_pdfs_kept_only_when_confirmed(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    made = desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "confirmationLetter"})
    assert made["state"] == "stored" and made["objectKey"] == f"desks/{desk.info['id']}/documents/{made['id']}.pdf"
    assert pdf_pages(S3().get(made["objectKey"])) >= 1
    error_of(desk.call("POST", f"/api/hires/{make_hire(desk, stage='quoted')['id']}/documents", json={"kind": "invoice"}), 409)
    for env, bucket, copy in (("APP_GOTENBERG_DOWN_URL", "-render", "The PDF service is unavailable right now. Nothing was saved."), ("APP_MINIO_DOWN_URL", None, "The file store is unavailable right now. Nothing was saved.")):
        base = outage(env)
        down = new_desk(base)
        target = make_hire(down)
        before = down.ok("GET", "/api/documents")
        error_of(down.call("POST", f"/api/hires/{target['id']}/documents", json={"kind": "invoice"}), 503, message=copy)
        after = down.ok("GET", "/api/documents")
        assert after == before and after["documents"] == [] and after["nextInvoice"].endswith("-0001")
        if bucket:
            assert S3(bucket).keys(f"desks/{down.info['id']}/") == []
    maria = existing_desk(outage("APP_GOTENBERG_DOWN_URL"), MARIA)
    invoice = maria.ok("GET", "/api/documents")["documents"][0]
    assert invoice["state"] == "waiting" and invoice["number"].endswith("-0001"), "the seeded invoice's strip stands at Waiting"
    error_of(maria.call("GET", f"/api/documents/{invoice['id']}/file"), 404)


def test_gapless_numbers(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    other = new_desk(app_url)
    year = today(app_url).year
    assert desk.ok("GET", "/api/documents")["nextInvoice"] == f"INV-{year}-0001" and desk.ok("GET", "/api/documents")["nextCreditNote"] == f"CN-{year}-0001"
    hire = make_hire(desk)
    first = desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "invoice"})
    assert first["number"] == f"INV-{year}-0001"
    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: desk.call("POST", f"/api/hires/{hire['id']}/documents", json={"kind": "invoice"}), range(2)))
    assert sorted(r.json()["number"] for r in results) == [f"INV-{year}-0002", f"INV-{year}-0003"]
    assert desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "creditNote"})["number"] == f"CN-{year}-0001"
    listing = desk.ok("GET", "/api/documents")
    assert listing["nextInvoice"] == f"INV-{year}-0004" and listing["nextCreditNote"] == f"CN-{year}-0002"
    other_hire = make_hire(other)
    assert other.ok("POST", f"/api/hires/{other_hire['id']}/documents", 201, json={"kind": "invoice"})["number"] == f"INV-{year}-0001"


def test_download_limit(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    document = desk.ok("POST", f"/api/hires/{make_hire(desk)['id']}/documents", 201, json={"kind": "invoice"})
    for _ in range(5):
        r = desk.call("GET", f"/api/documents/{document['id']}/file")
        assert r.status_code == 200 and r.headers["content-type"].startswith("application/pdf")
    sixth = desk.call("GET", f"/api/documents/{document['id']}/file")
    error_of(sixth, 429, message=re.compile(r"You have downloaded several files\. Try again after \d\d:\d\d\."))
    assert int(sixth.headers["retry-after"]) > 0
    other = new_desk(app_url)
    own = other.ok("POST", f"/api/hires/{make_hire(other)['id']}/documents", 201, json={"kind": "invoice"})
    assert other.call("GET", f"/api/documents/{own['id']}/file").status_code == 200


def test_documents_interleaved_desks(app_url: str, wiremock: WireMock) -> None:
    a, b = new_desk(app_url), new_desk(app_url)
    names = {a: "Alpha Interleave Customer", b: "Beta Interleave Customer"}
    ids = {}
    for desk, name in names.items():
        hire = make_hire(desk, customer={"name": name, "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})
        ids[desk] = desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "invoice"})["id"]
    def read(desk: Desk) -> bool:
        listed = desk.ok("GET", "/api/documents")["documents"]
        other = b if desk is a else a
        return [d["id"] for d in listed] == [ids[desk]] and names[other] not in json.dumps(listed) and listed[0]["customerName"] == names[desk]
    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        assert all(pool.map(read, [a, b] * 40))


def test_wf_aftercare_complaints(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    name = "Foleshill Tool Makers"
    customer = desk.ok("POST", "/api/customers", 201, json={"name": name, "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})
    with screen(browser, app_url, "/aftercare/complaints", desk=desk) as page:
        shows(page, "No complaints logged.")
        click(visible(role(page, "button", "Log complaint")))
        box = role(page, "dialog", "Log complaint")
        select(role(box, "combobox", "Customer"), name)
        role(box, "textbox", "Summary").fill("Late pick-up at the school")
        date_field = role(box, "textbox", "Received date")
        date_field.fill("2027-03-25")
        select(role(box, "combobox", "Received hour"), "10")
        select(role(box, "combobox", "Received minutes"), "00")
        click(role(box, "button", "Save complaint"))
        said(page, "Enter a date as DD/MM/YYYY.")
        expect(date_field).to_have_attribute("aria-invalid", "true")
        date_field.fill("25/03/2027")
        wait_working(page, role(box, "button", "Save complaint"), "**/api/complaints", "Save complaint")
        said(page, "Complaint logged.")
        shows(page, "Thu 1 Apr 2027")
    rows = desk.ok("GET", "/api/complaints")["complaints"]
    assert rows[0]["customerId"] == customer["id"] and rows[0]["replyDue"] == "2027-04-01"


def test_wf_aftercare_lost_property(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/aftercare/lost-property", desk=desk) as page:
        shows(page, "No found items logged.")
        click(visible(role(page, "button", "Log found item")))
        box = role(page, "dialog", "Log found item")
        role(box, "textbox", "Item").fill("Blue rucksack")
        role(box, "textbox", "Found on").fill("31/01/2027")
        click(role(box, "button", "Save item"))
        said(page, "Item logged.")
        shows(page, "Sun 28 Feb 2027")
        click(visible(role(page, "button", "Return item")))
        box = role(page, "dialog", "Return item")
        announced_twice(page, lambda: click(role(box, "button", "Record return")), "Record the owner's details before returning this.")
        assert box.is_visible()
        assert desk.ok("GET", "/api/lost-property")["items"][0]["state"] != "returned"
        role(box, "textbox", "Owner's details").fill("Named the school badge on the front pocket")
        click(role(box, "button", "Record return"))
        said(page, "Item returned.")
    assert desk.ok("GET", "/api/lost-property")["items"][0]["state"] == "returned"


def test_wf_aftercare_customers_sheet(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    name = "Stoke Aldermoor Bowls Club"
    customer = desk.ok("POST", "/api/customers", 201, json={"name": name, "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})
    with screen(browser, app_url, "/customers", desk=desk) as page:
        click(row_button(page, name, "Close customer"))
        said(page, "Customer closed.")
        assert desk.ok("GET", f"/api/customers/{customer['id']}")["state"] == "closed"
        click(role(role(page, "radiogroup", "Filter customers"), "radio", "Closed"))
        click(row_button(page, name, "Bring back"))
        said(page, "Customer brought back.")
        assert desk.ok("GET", f"/api/customers/{customer['id']}")["state"] == "active"
        click(visible(role(page, "button", "Bring in old sheet")))
        box = role(page, "dialog", "Bring in old sheet")
        added = fresh("sheet")
        labelled(box, "Customer sheet").set_input_files({"name": "old.csv", "mimeType": "text/csv", "buffer": f"Name,Email,Telephone,Notes\n{added[0]},{added[1]},{fresh_phone()},Old note\n".encode()})
        click(role(box, "button", "Read sheet"))
        said(page, "Sheet brought in.")
        expect(page.get_by_role("heading", name="Review list", exact=True)).to_be_visible()
    assert added[1] in [c["email"] for c in desk.ok("GET", "/api/customers")["customers"]]


@pytest.mark.timeout(1800)
def test_wf_aftercare_screen_rules(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = desk.ok("POST", "/api/customers", 201, json={"name": "Jack O'Rourke", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})["id"]
    def logged() -> str:
        desk.ok("POST", "/api/complaints", 201, json={"customerId": customer, "summary": "Late pick-up at the school", "receivedAt": {"date": "2027-03-25", "time": "10:00"}})
        return "Thu 1 Apr 2027"
    meets_screen_rules(browser, app_url, "/aftercare/complaints", "Log complaint", "Log complaint", desk=desk, main="Log complaint", typed_into=("textbox", "Summary"), endpoint="/api/complaints", read=desk.ok("GET", "/api/complaints"), change=logged)
    with screen(browser, app_url, "/customers", desk=desk) as page:
        target = role(role(page, "radiogroup", "Filter customers"), "radio", "Closed")
        state_mark(page, target, lambda: click(target))
    sweep_routes(browser, app_url, "complaints", "lost", "customers")


def complaint(desk: Desk, customer: str, day: str, at: str) -> dict[str, Any]:
    return desk.ok("POST", "/api/complaints", 201, json={"customerId": customer, "summary": "Late pick-up at the school", "receivedAt": {"date": day, "time": at}})


def test_complaint_reply_dates(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    customer = desk.ok("POST", "/api/customers", 201, json={"name": "Foleshill Tool Makers", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})["id"]
    before = len(wiremock.requests("/bank-holidays.json"))
    for day, at, due in (("2027-03-25", "10:00", "2027-04-01"), ("2027-03-25", "17:30", "2027-04-02"), ("2027-03-24", "16:59", "2027-03-31")):
        made = complaint(desk, customer, day, at)
        assert made["replyDue"] == due and made["holidayLine"] is None, made
    assert len(wiremock.requests("/bank-holidays.json")) == before + 1, "read per desk at most once per cache time"
    assert len(desk.ok("GET", "/api/complaints")["complaints"]) == 3


@pytest.mark.timeout(180)
def test_holiday_states(app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_SHORT_URL")
    wiremock.fault("GET", "/bank-holidays.json")
    desk = new_desk(base)
    customer = desk.ok("POST", "/api/customers", 201, json={"name": "Foleshill Tool Makers", "email": fresh()[1], "telephone": fresh_phone(), "language": "en"})["id"]
    none = complaint(desk, customer, "2027-03-25", "10:00")
    assert none["replyDue"] == (date(2027, 3, 25) + timedelta(days=5)).isoformat() and none["holidayLine"] == "Bank holidays unavailable. Weekends only."
    good = {"england-and-wales": {"division": "england-and-wales", "events": [{"title": "Good Friday", "date": "2027-03-26", "notes": "", "bunting": False}, {"title": "Easter Monday", "date": "2027-03-29", "notes": "", "bunting": True}]}}
    wiremock.stub("GET", "/bank-holidays.json", json=good)
    recovered = complaint(desk, customer, "2027-03-25", "10:00")
    assert recovered["replyDue"] == "2027-04-01" and recovered["holidayLine"] is None, "a failed read does not count against the cache"
    wiremock.fault("GET", "/bank-holidays.json")
    cached_until = time.monotonic() + 7
    while time.monotonic() < cached_until:
        httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)
    last_good = complaint(desk, customer, "2027-03-25", "10:00")
    assert last_good["replyDue"] == "2027-04-01" and last_good["holidayLine"] is None, "the last good list is used"


def test_holding_dates(app_url: str) -> None:
    desk = new_desk(app_url)
    for found, held_to in (("2027-01-31", "2027-02-28"), ("2027-03-31", "2027-04-30"), ("2028-01-31", "2028-02-29"), ("2027-04-30", "2027-05-30")):
        item = desk.ok("POST", "/api/lost-property", 201, json={"description": "Blue rucksack", "foundOn": found})
        assert item["heldTo"] == held_to
    day = today(app_url)
    for back in range(25, 36):
        item = desk.ok("POST", "/api/lost-property", 201, json={"description": "Umbrella", "foundOn": (day - timedelta(days=back)).isoformat()})
        expected = "held" if date.fromisoformat(item["heldTo"]) >= day else "pastHoldingDate"
        read = [row for row in desk.ok("GET", "/api/lost-property")["items"] if row["id"] == item["id"]]
        assert read and read[0]["state"] == expected, read
    past = desk.ok("POST", "/api/lost-property", 201, json={"description": "Scarf", "foundOn": (day - timedelta(days=60)).isoformat()})
    url = f"/api/lost-property/{past['id']}/return"
    error_of(desk.call("POST", url, json={"ownerDetails": ""}), 422)
    returned = desk.ok("POST", url, json={"ownerDetails": "Named the school badge on the front pocket"})
    assert returned["charge"] == "5.00" and returned["state"] == "returned"
    error_of(desk.call("POST", url, json={"ownerDetails": "Again"}), 409)


def test_close_and_bring_back(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk)
    customer_id = hire["customerId"]
    before = desk.ok("GET", f"/api/customers/{customer_id}")
    closed = desk.ok("POST", f"/api/customers/{customer_id}/close", json={})
    assert closed["state"] == "closed" and INSTANT.match(closed["closedAt"]) and instant_of(closed["eraseAt"]) - instant_of(closed["closedAt"]) == timedelta(seconds=604800)
    error_of(desk.call("POST", f"/api/customers/{customer_id}/close", json={}), 409)
    assert customer_id not in [c["id"] for c in desk.ok("GET", "/api/customers")["customers"]]
    assert customer_id in [c["id"] for c in desk.ok("GET", "/api/customers", params={"state": "closed"})["customers"]]
    assert hire["id"] not in [r["reference"] for r in desk.ok("GET", "/api/enquiries")["enquiries"]]
    assert desk.ok("POST", f"/api/customers/{customer_id}/bring-back", json={}) == before
    assert hire["id"] in [r["reference"] for r in desk.ok("GET", "/api/enquiries")["enquiries"]]
    assert desk.ok("GET", f"/api/hires/{hire['id']}")["customerId"] == customer_id
    assert httpx.get(app_url + api_path(hire["quotePath"]), timeout=HTTP_TIMEOUT).status_code == 200


@pytest.mark.timeout(240)
def test_erase_after_wait(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_SHORT_URL")
    desk = new_desk(base)
    hire = make_hire(desk)
    customer_id = hire["customerId"]
    pay(desk, hire["id"], "175.00")
    desk.ok("POST", f"/api/hires/{hire['id']}/passengers/import", 201, content=b"Name,Group,Needs\nMaja Kowalska,,\n", headers={"content-type": "text/csv"})
    document = desk.ok("POST", f"/api/hires/{hire['id']}/documents", 201, json={"kind": "invoice"})
    store = S3("-short")
    assert store.get(document["objectKey"])
    assert store.keys(f"desks/{desk.info['id']}/passengers/{hire['id']}/")
    held_before = desk.ok("GET", "/api/payments")["moneyHeld"]
    desk.ok("POST", f"/api/customers/{customer_id}/close", json={})
    poll(lambda: desk.call("GET", f"/api/customers/{customer_id}").status_code == 404, 60, "GET /api/customers/<id> answers 404 once erased")
    back = desk.call("POST", f"/api/customers/{customer_id}/bring-back", json={})
    assert back.status_code in (404, 409), back.text
    error_of(back, back.status_code)
    assert store.keys(f"desks/{desk.info['id']}/documents/") == [] and store.keys(f"desks/{desk.info['id']}/passengers/") == []
    gone = httpx.get(base + page_path(hire["quotePath"]), timeout=HTTP_TIMEOUT)
    assert gone.status_code == 410 and _rendered_has(browser, base, page_path(hire["quotePath"]), "This page has ended.")
    assert httpx.get(base + api_path(hire["runs"][0]["sheetPath"]), timeout=HTTP_TIMEOUT).status_code == 410
    kept = desk.ok("GET", f"/api/documents/{document['id']}")
    assert kept["customerName"] == "Erased customer" and kept["number"] == document["number"]
    error_of(desk.call("GET", f"/api/documents/{document['id']}/file"), 410)
    assert desk.ok("GET", "/api/payments")["moneyHeld"] == held_before
    assert desk.ok("GET", f"/api/hires/{hire['id']}/ledger")["sum"] == "0.00"
    assert hire["customerBody"]["name"] not in desk.call("GET", "/api/payments/download").text
    assert desk.ok("GET", "/api/documents")["nextInvoice"].endswith("-0002")


@pytest.mark.timeout(180)
def test_erase_stays_erasing_minio_down(app_url: str, wiremock: WireMock) -> None:
    base = outage("APP_MINIO_DOWN_URL")
    desk = new_desk(base)
    customer = desk.ok("POST", "/api/customers", 201, json={"name": "Halina Nowak", "email": fresh()[1], "telephone": fresh_phone(), "language": "pl"})
    desk.ok("POST", f"/api/customers/{customer['id']}/close", json={})
    poll(lambda: desk.ok("GET", f"/api/customers/{customer['id']}")["state"] == "erasing", 30, "the customer reads erasing after the wait")
    error_of(desk.call("POST", f"/api/customers/{customer['id']}/bring-back", json={}), 409, message="The wait is over. This customer can't be brought back.")
    deadline = time.monotonic() + 8
    while time.monotonic() < deadline:
        assert desk.ok("GET", f"/api/customers/{customer['id']}")["state"] == "erasing", "an erasure never claims to be done with MinIO down"


def test_old_customer_sheet(app_url: str) -> None:
    desk = new_desk(app_url)
    email_one, email_two = fresh()[1], fresh()[1]
    phone = fresh_phone()
    one = desk.ok("POST", "/api/customers", 201, json={"name": SHEET_ORIGINAL, "email": email_one, "telephone": fresh_phone(), "language": "en"})
    two = desk.ok("POST", "/api/customers", 201, json={"name": "Second Person", "email": email_two, "telephone": phone, "language": "en"})
    third_mail = fresh()[1]
    new_mail = fresh()[1]
    sheet = (f"Name,Email,Telephone,Notes\nBrand New,{new_mail},{fresh_phone()},New note\n"
             f"Other Name,{email_one.upper()},,{SHEET_NOTE}\n"
             f"Clash,{email_one},+44 {phone[1:]},Clash note\n"
             f"Own Third,{third_mail},,\n").encode()
    post = lambda: desk.call("POST", "/api/customers/import", content=sheet, headers={"content-type": "text/csv"})
    r = post()
    assert r.status_code == 200
    assert r.json() == {"added": 2, "filled": 1, "reviewList": [{"row": 4, "message": "Matches two customers"}]}
    kept = desk.ok("GET", f"/api/customers/{one['id']}")
    assert kept["name"] == SHEET_ORIGINAL and kept["notes"] == SHEET_NOTE and kept["telephone"] == one["telephone"]
    assert desk.ok("GET", f"/api/customers/{two['id']}")["notes"] in (None, ""), "a two-match row changes nothing"
    assert desk.ok("GET", "/api/customers/review")["reviewList"] == [{"row": 4, "message": "Matches two customers"}]
    count = len(desk.ok("GET", "/api/customers")["customers"])
    again = post().json()
    assert again["added"] == 0
    assert len(desk.ok("GET", "/api/customers")["customers"]) == count
    error_of(httpx.post(app_url + "/api/customers/import", content=b"x" * (SHEET_LIMIT + 1), headers={"content-type": "text/csv"}, timeout=HTTP_TIMEOUT), 413)


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    r = httpx.get(app_url + "/enquiries?state=new", timeout=HTTP_TIMEOUT)
    assert r.status_code == 303 and r.headers["location"].endswith("/sign-in?return=%2Fenquiries%3Fstate%3Dnew")
    for query, landing in (("?return=%2Foperators", "/operators"), ("?return=%2F%2Fforeign.example", "/enquiries")):
        with open_app(browser, app_url + "/sign-in" + query) as page:
            fill(role(page, "textbox", "Email"), desk.info["email"])
            fill(labelled(page, "Password"), PASSWORD)
            click(role(page, "button", "Sign in"))
            soon(page, lambda: urllib.parse.urlsplit(page.url).path == landing and same_origin(page.url, app_url), f"landing on {landing}")
    with screen(browser, app_url, "/enquiries", desk=desk) as page:
        nav = role(page, "navigation", "Desk")
        slow_animations(page, 0.2)
        click(role(nav, "link", "Operators"))
        wipe = page.locator('[data-part="page-wipe"]')
        soon(page, lambda: wipe.count() >= 1, "one page wipe")
        assert 320 in wipe.first.evaluate("e => e.getAnimations({subtree: true}).map(a => Number(a.effect.getComputedTiming().duration))")
        session(page).send("Animation.setPlaybackRate", {"playbackRate": 1})
        soon(page, lambda: h1(page, "Operators").count() == 1 and focus_on_h1(page), "focus lands on the new heading")
        expect(page).to_have_title("Operators | Wayticket")


@pytest.mark.timeout(2400)
def test_wf_cross_cutting_route_sweep(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    sweep_routes(browser, app_url, "enquiries", "enquiry", "trip", "bids", "quote", "hours", "seats", "changes", "operators", "payments", "diary", "documents", "rates", "customers", "complaints", "lost", "q", "b", "r")


@pytest.mark.timeout(240)
def test_wf_cross_cutting_session_draft(browser: Browser, app_url: str) -> None:
    base = outage("APP_SESSION_URL")
    desk = new_desk(base)
    with screen(browser, base, "/customers", desk=desk) as page:
        click(visible(role(page, "button", "Add customer")))
        box = role(page, "dialog", "Add customer")
        role(box, "textbox", "Name").fill(DRAFT_NAME)
        ended: list[httpx.Response] = []

        def session_over() -> bool:
            r = desk.call("GET", "/api/auth/session")
            if r.status_code == 401:
                ended.append(r)
            return bool(ended)

        poll(session_over, 40, "the 20-second session ends")
        error_of(ended[0], 401, "sessionEnded")
        advance(page, REFRESH_MS + 100)
        soon(page, lambda: ENDED_SESSION in box.inner_text(), "the ended-session line inside the dialog")
        said(page, ENDED_SESSION)
        expect(role(box, "textbox", "Name")).to_have_value(DRAFT_NAME)
        link = role(box, "link", "Sign in again")
        assert link.get_attribute("href").endswith("/sign-in?return=%2Fcustomers")
        click(link)
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/sign-in", "the sign-in page")
        fill(role(page, "textbox", "Email"), desk.info["email"])
        fill(labelled(page, "Password"), PASSWORD)
        click(role(page, "button", "Sign in"))
        soon(page, lambda: urllib.parse.urlsplit(page.url).path == "/customers", "the same address")
        box = role(page, "dialog", "Add customer")
        soon(page, lambda: box.count() == 1, "the dialog open again")
        expect(role(box, "textbox", "Name")).to_have_value(DRAFT_NAME)


LEAK = re.compile(r"(\bat .+:\d+:\d+|node_modules|/app/|SELECT |INSERT INTO|syntax error|TypeError|ReferenceError|postgres|express|fastify|stack)", re.I)


def test_error_shape_and_ladder(app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    hire = make_hire(desk, stage="quoted")
    accepted = make_hire(desk)
    quote = desk.ok("GET", f"/api/hires/{hire['id']}/quote")
    vehicle = quote["vehicles"][0]["id"]
    anon = {"timeout": HTTP_TIMEOUT}
    cases: list[tuple[httpx.Response, int]] = [
        (httpx.post(app_url + "/api/customers", content=b" " * (JSON_LIMIT + 1), headers={"content-type": "text/plain", "origin": FOREIGN}, **anon), 413),
        (httpx.post(app_url + "/api/customers", json={}, headers={"origin": FOREIGN}, **anon), 403),
        (httpx.get(app_url + "/api/customers/none", **anon), 401),
        (desk.call("PATCH", "/api/customers/none", content=b"{", headers={"content-type": "text/plain"}), 404),
        (desk.call("POST", "/api/customers", content=b"{", headers={"content-type": "text/plain"}), 415),
        (desk.call("POST", "/api/customers", content=b"{", headers={"content-type": "application/json"}), 400),
        (desk.call("POST", "/api/customers", json={"name": ""}), 422),
        (desk.call("PUT", f"/api/hires/{hire['id']}/quote", json={"version": quote["version"] - 1, "vehicles": [{"id": vehicle, "marginPercent": OFF_STEP_MARGIN}]}), 422),
        (desk.call("PUT", f"/api/hires/{accepted['id']}/quote", json={"version": 0, "vehicles": [{"id": accepted["vehicles"][0]["id"], "marginPercent": "10"}]}), 409),
        (desk.call("PUT", f"/api/hires/{hire['id']}/quote", json={"version": quote["version"] - 1, "vehicles": [{"id": vehicle, "marginPercent": "10"}]}), 412),
        (desk.call("GET", "/api/no-such-route"), 404),
    ]
    for r, status in cases:
        err = error_of(r, status)
        assert not LEAK.search(r.text), r.text
        assert set(err) <= {"code", "message", "fields"}
    wrong = httpx.delete(app_url + "/api/health", **anon)
    error_of(wrong, 405)
    assert "GET" in wrong.headers["allow"]
    fields = error_of(desk.call("POST", "/api/enquiries", json={"occasion": "none"}), 422)
    assert isinstance(fields.get("fields"), dict) and fields["fields"]
    assert httpx.post(app_url + "/api/auth/sign-in", json={"email": MARIA[0], "password": MARIA[1]}, **anon).status_code == 200, "no Origin passes"
    wiremock.fault("POST", "/v1/route")
    error_of(desk.call("POST", f"/api/enquiries/{hire['id']}/trip/route", json={}), 503)


def test_only_published_surface(browser: Browser, app_url: str) -> None:
    for path in ("/no-such-page", "/enquiries/x/y/z", "/debug", "/admin", "/.env", "/package.json", "/run.json", "/src/server.ts", "/server.js"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code in (303, 404), f"{path}: {r.status_code}"
        if not path.startswith("/enquiries"):
            assert r.status_code == 404
    assert _rendered_has(browser, app_url, "/no-such-page", "Page not found")
    for path in ("/api/debug", "/api/test/reset", "/api/seed", "/api/env", "/api/users"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        error_of(r, 404)
        assert "json" in r.headers["content-type"]
    assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    clock = httpx.get(app_url + "/api/public/clock", timeout=HTTP_TIMEOUT).json()
    assert set(clock) == {"date", "time", "instant"} and INSTANT.match(clock["instant"])


SEED_ROWS = [
    ("CV-7K2M4", "CU-1004", "company", "new"), ("CV-D2Q5Y", "CU-1001", "school", "new"), ("CV-3H9QR", "CU-1001", "school", "priced"),
    ("CV-8T4VX", "CU-1002", "weddings", "quoted"), ("CV-5N6WZ", "CU-1003", "weddings", "quoted"), ("CV-9D3JS", "CU-1006", "festivals", "lost"),
    ("CV-2P7GB", "CU-1005", "company", "won"), ("CV-A4F6C", "CU-1006", "festivals", "won"), ("CV-B8H3K", "CU-1001", "school", "won"), ("CV-C6M9T", "CU-1002", "weddings", "won"),
]
SEED_CUSTOMERS = {
    "CU-1001": ("CHELMSLEYWOODANDKINGSHURSTUNITEDFEDERATIONOFPRIMARYSCHOOLSTRUSTS", "office@chelmsleywood-federation.example", "01632 960101", "en"),
    "CU-1002": ("Agnieszka Wiśniewska", "agnieszka@wisniewska.example", "01632 960102", "pl"),
    "CU-1003": ("شازیہ ملک", "shazia@malik.example", "01632 960103", "ur"),
    "CU-1004": ("Jack O'Rourke", "jack@orourke.example", "01632 960155", "en"),
    "CU-1005": ("Foleshill Tool Makers", "office@foleshill-tools.example", "01632 960105", "en"),
    "CU-1006": ("Stoke Aldermoor Bowls Club", "secretary@aldermoor-bowls.example", "01632 960106", "en"),
}


@pytest.mark.timeout(180)
def test_exact_starting_state(browser: Browser, app_url: str, mail: Mailpit) -> None:
    base = outage("APP_NTFY_DOWN_URL")
    maria = existing_desk(base, MARIA)
    assert maria.info["name"] == "Merrowfield Coach Hire"
    customers = {c["id"]: (c["name"], c["email"], c["telephone"], c["language"]) for c in maria.ok("GET", "/api/customers")["customers"]}
    assert customers == SEED_CUSTOMERS
    rows = maria.ok("GET", "/api/enquiries")
    assert [(r["reference"], r["occasion"], r["state"]) for r in rows["enquiries"]] == [(a, c, d) for a, _, c, d in SEED_ROWS]
    for row, seed in zip(rows["enquiries"], SEED_ROWS):
        assert row["customerName"] == SEED_CUSTOMERS[seed[1]][0]
    b_day = instant_of(maria.ok("GET", "/api/hires/CV-8T4VX")["sentAt"]).astimezone(UK).date()
    c_day = next_change_any(b_day)
    departures = {"CV-7K2M4": (b_day + timedelta(days=60), "08:00"), "CV-D2Q5Y": (b_day + timedelta(days=70), "09:00"), "CV-3H9QR": (b_day + timedelta(days=45), "08:30"), "CV-8T4VX": (b_day + timedelta(days=50), "13:00"), "CV-5N6WZ": (b_day + timedelta(days=40), "12:00"), "CV-9D3JS": (b_day + timedelta(days=30), "10:00"), "CV-2P7GB": (c_day - timedelta(days=1), "08:00"), "CV-A4F6C": (c_day, "08:00"), "CV-B8H3K": (c_day + timedelta(days=7), "09:15"), "CV-C6M9T": (c_day - timedelta(days=8), "07:30")}
    for row in rows["enquiries"]:
        day, at = departures[row["reference"]]
        assert (row["departAt"]["date"], row["departAt"]["time"]) == (day.isoformat(), at), row
    operators = maria.ok("GET", "/api/operators")["operators"]
    assert [o["id"] for o in operators] == [f"OP-{1001 + i}" for i in range(24)]
    assert [(o["name"], o["town"], o["sizes"]) for o in operators] == DIRECTORY_ROWS
    for i, operator in enumerate(operators):
        if i < 12:
            ends = {p["kind"]: (p["endsOn"], p["stored"]) for p in operator["papers"]}
            cover = "2027-06-30" if operator["id"] == "OP-1012" else "2028-12-31"
            assert ends == {"operatorLicence": ("2028-12-31", False), "publicLiabilityCover": (cover, False)} and operator["dbsCheckedOn"] == "2026-01-15"
        else:
            assert operator["papers"] == [] and operator["dbsCheckedOn"] is None
    standing = {o["id"]: o for o in maria.ok("GET", "/api/hires/CV-3H9QR/operators")["operators"]}
    assert standing["OP-1013"]["reason"] == "Operator licence is missing."
    bids = {b["operatorId"]: b for b in maria.ok("GET", "/api/enquiries/CV-3H9QR/bids")["bids"]}
    assert bids["OP-1001"]["prices"] == ["1006.30"] and bids["OP-1002"]["prices"] == ["1040.00"] and len(bids) == 2
    money = {"CV-8T4VX": ("1000.01", "150.00", "nothingPaid", "0.00"), "CV-5N6WZ": ("720.01", "50.00", "nothingPaid", "0.00"), "CV-2P7GB": ("1157.25", "150.00", "nothingPaid", "0.00"), "CV-A4F6C": ("750.00", "50.00", "depositPartPaid", "25.00"), "CV-B8H3K": ("999.99", "100.00", "depositPaid", "100.00"), "CV-C6M9T": ("720.01", "50.00", "paidInFull", "720.01")}
    stages = {"CV-8T4VX": "quoteSent", "CV-5N6WZ": "quoteSent", "CV-2P7GB": "accepted", "CV-A4F6C": "accepted", "CV-B8H3K": "deposit", "CV-C6M9T": "balance"}
    for reference, (total, deposit, state, paid) in money.items():
        hire = maria.ok("GET", f"/api/hires/{reference}")
        assert (hire["vehicles"][0]["total"], hire["vehicles"][0]["deposit"], hire["paymentState"], hire["paid"]) == (total, deposit, state, paid)
        read = httpx.get(base + api_path(hire["quotePath"]), timeout=HTTP_TIMEOUT).json()
        if instant_of(read["departInstant"]) > server_now(base):
            assert read["stage"] == stages[reference], reference
    assert httpx.get(base + api_path(maria.ok("GET", "/api/hires/CV-5N6WZ")["quotePath"]), timeout=HTTP_TIMEOUT).json()["state"] == "ended"
    held_money = maria.ok("GET", "/api/payments")
    assert held_money["moneyHeld"] == "845.01"
    assert sorted(l["amount"] for l in maria.ok("GET", "/api/hires/CV-C6M9T/ledger")["lines"] if l["account"] == "clientMoney") == ["50.00", "670.01"]
    for run, number, reference, driver, phone, breaches in (("RN-1001", 1, "CV-2P7GB", "Ewan Price", "01632 960301", []), ("RN-1002", 2, "CV-A4F6C", "Marek Zając", "01632 960302", [("drivingBeforeBreak", 271)]), ("RN-1003", 3, "CV-B8H3K", "Ewan Price", "01632 960301", []), ("RN-1004", 4, "CV-C6M9T", "Marek Zając", "01632 960302", [])):
        body = maria.ok("GET", f"/api/runs/{run}")
        assert (body["number"], body["hireId"], body["driver"]["name"], body["driver"]["telephone"], body["toldAt"]) == (number, reference, driver, phone, None)
        assert [(b["rule"], b["atMinute"]) for b in maria.ok("GET", f"/api/runs/{run}/hours")["breaches"]] == breaches
    grid = {s["seat"]: s["passengerId"] for s in maria.ok("GET", "/api/hires/CV-B8H3K/seats")["vehicles"][0]["grid"]}
    people = maria.ok("GET", "/api/hires/CV-B8H3K/passengers")["passengers"]
    assert [(p["name"], p["group"]) for p in people] == [("Agnieszka Wiśniewska", "Adult"), ("Jack O'Rourke", "Adult"), ("Maja Kowalska", "Year 5"), ("Ibrahim Malik", "Year 5"), ("Tom Bennett", "Year 5")]
    assert [grid[s] for s in ("12A", "3C", "1A", "1B", "1C")] == [p["id"] for p in people]
    year = b_day.year
    documents = maria.ok("GET", "/api/documents")
    assert documents["nextInvoice"] == f"INV-{year}-0002" and documents["nextCreditNote"] == f"CN-{year}-0001"
    assert [(d["kind"], d["hireId"], d["number"]) for d in documents["documents"]] == [("invoice", "CV-C6M9T", f"INV-{year}-0001")]
    stored = poll(lambda: next((d for d in maria.ok("GET", "/api/documents")["documents"] if d["state"] == "stored"), None), 60, "the seeded invoice's PDF is stored")
    assert pdf_pages(S3("-push").get(stored["objectKey"])) >= 1
    rates = maria.ok("GET", "/api/rates")
    assert len(rates["tables"]) == 1 and rates["tables"][0]["effectiveFrom"] == "2000-01-01" and rates["tables"][0]["depositCoachHigher"] == "150.00"
    assert maria.ok("GET", "/api/complaints")["complaints"] == [] and maria.ok("GET", "/api/lost-property")["items"] == []
    tomasz = existing_desk(base, TOMASZ)
    assert tomasz.info["name"] == "Zieliński Hire"
    assert [(c["id"], c["name"], c["email"], c["telephone"], c["language"]) for c in tomasz.ok("GET", "/api/customers")["customers"]] == [("CU-2001", "Halina Nowak", "halina@nowak.example", "01632 960180", "pl")]
    assert [(r["reference"], r["state"]) for r in tomasz.ok("GET", "/api/enquiries")["enquiries"]] == [("CV-T0MA5", "new")]
    assert tomasz.ok("GET", "/api/operators")["operators"] == []
    error_of(tomasz.call("GET", "/api/customers/CU-1001"), 404)
    with screen(browser, base, "/enquiries", desk=maria) as page:
        soon(page, lambda: role(page, "link", "CV-7K2M4").count() == 1, "the seeded row on the first screen")


def test_motion_public(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/", size=WIDE) as page:
        soon(page, lambda: ring_played(page, role(page, "link", "Message us")), "the ring's three plays of 640 ms", seconds=5)
        role(page, "button", "Later").scroll_into_view_if_needed()
        click(role(page, "button", "Later"))
        soon(page, lambda: any(m["duration"] == 320 for m in motions(page)), "client marks step in 320 ms")
        page.evaluate("scrollTo(0, 1200)")
        soon(page, lambda: any(m["duration"] == 640 for m in motions(page)), "a section rises in 640 ms")
        soon(page, lambda: any(m["duration"] == 160 and m["part"] == "slim-bar" for m in motions(page)) or any(m["duration"] == 160 for m in motions(page)), "the slim bar slides in 160 ms")
        cards = page.evaluate("""() => { const a = [...document.querySelectorAll('a[href$="/occasions/school"]')].filter(x => !x.closest('nav')).pop(); a.scrollIntoView({block: 'center'}); const r = a.getBoundingClientRect(); return {x: r.left + r.width / 2, y: r.top + r.height / 2}; }""")
        advance(page, 100)
        page.evaluate("window.__motion.length = 0")
        page.mouse.move(cards["x"], cards["y"])
        soon(page, lambda: any(m["duration"] == 160 for m in motions(page)), "the occasion card lifts in 160 ms", seconds=5)
        assert_published_motion(page)
    with screen(browser, app_url, "/occasions/school", size=WIDE) as page:
        click(role(page, "button", "How early should we ask?"))
        soon(page, lambda: any(m["duration"] == 320 for m in motions(page)), "the accordion moves in 320 ms")
        assert_published_motion(page)
    with screen(browser, app_url, "/", size=WIDE, reduced=True) as page:
        page.evaluate("scrollTo(0, 1200)")
        advance(page, 500)
        assert [m for m in motions(page) if m["duration"] >= 1] == [], "reduced motion plays nothing"
        assert float(page.evaluate("""() => getComputedStyle([...document.querySelectorAll('h2')].pop()).opacity""")) == 1


def test_motion_desk_and_reduced(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = new_desk(app_url)
    with screen(browser, app_url, "/customers", desk=desk) as page:
        opener = visible(role(page, "button", "Add customer"))
        click(opener)
        box = role(page, "dialog", "Add customer")
        soon(page, lambda: any(m["duration"] == 320 for m in motions(page)), "the dialog opens in 320 ms")
        page.keyboard.press("Escape")
        soon(page, lambda: box.count() == 0, "dialog closed")
        assert_published_motion(page)
        assert page.evaluate("document.getAnimations().every(a => a.effect.getComputedTiming().iterations !== Infinity)")
        page.emulate_media(reduced_motion="reduce")
        page.evaluate("window.__motion.length = 0")
        click(opener)
        expect(box).to_be_visible()
        page.keyboard.press("Escape")
        expect(box).to_have_count(0, timeout=GONE_MS)
        assert [m for m in motions(page) if m["duration"] >= 1] == [], "SR23 applies with no reload"
    with screen(browser, app_url, "/quote/route", size=WIDE) as page:
        click(role(role(page, "radiogroup", "Occasion"), "radio", "School"))
        fill_route_typed(page)
        page.evaluate("window.__motion.length = 0")
        click(visible(role(page, "button", "Next")))
        soon(page, lambda: any(m["duration"] == 320 for m in motions(page)), "the step slides in 320 ms")
        assert_published_motion(page)


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert missing == []
    for font in ("Poppins", "Noto Sans", "Noto Nastaliq Urdu"):
        assert font in notices


def test_if_licences() -> None:
    bad = []
    for package in shipped_packages():
        allowed = ALLOWLIST | {"OFL-1.1"} if "font" in package.name.lower() else ALLOWLIST
        if not licence_allowed(package.licence, allowed):
            bad.append((package.name, package.licence))
    assert bad == []


def test_if_datastores() -> None:
    assert Postgres().tables(), "the app's schema lives in Postgres"
    names = {p.name.lower() for p in shipped_packages()}
    assert not names & {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "iovalkey", "@valkey/valkey-glide", "mongodb", "mongoose", "mysql", "mysql2", "lowdb", "nedb", "level", "leveldown", "lmdb"}


def test_if_same_origin(browser: Browser, app_url: str) -> None:
    desk = new_desk(app_url)
    for path, owner in (("/", None), ("/occasions/school", None), ("/fleet", None), ("/quote/route", None), ("/enquiries", desk)):
        with screen(browser, app_url, path, desk=owner) as page:
            seen: list[str] = []
            page.on("request", lambda q: seen.append(q.url))
            page.reload()
            advance(page, 1000)
            foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
            assert foreign == [], foreign


def test_if_generated_imagery(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/") as page:
        types: list[str] = []
        page.on("response", lambda r: types.append(r.headers.get("content-type", "")))
        page.reload()
        advance(page, 1000)
        assert [t for t in types if t.startswith("image/") and "SVG".lower() not in t and "icon" not in t] == []


def test_if_credentials(app_url: str) -> None:
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "NTFY_PASSWORD") if len(os.environ.get(k, "")) >= 6]
    home = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    assert not any(s in home for s in secrets)
    for path in Path("/app").rglob("*"):
        if not path.is_file() or {"node_modules", ".git", "dist", "build"} & set(path.parts) or path.stat().st_size > 2_000_000:
            continue
        content = path.read_bytes()
        assert not any(s.encode() in content for s in secrets), f"a credential is committed in {path}"
    assert httpx.get(app_url + "/.env", timeout=HTTP_TIMEOUT).status_code == 404
