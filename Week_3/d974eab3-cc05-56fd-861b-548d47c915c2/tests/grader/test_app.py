from __future__ import annotations

import copy
import json
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    Postgres,
    advance,
    axe,
    capture,
    click as kit_click,
    decode,
    difference,
    held,
    layout,
    licence_allowed,
    motion,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    session,
    settle,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    tap as kit_tap,
    unique,
    until,
)


DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
VIEWPORTS = {"1280x800": DESKTOP, "768x1024": TABLET, "375x812": PHONE}
VIEWPORT_IDS = ["1280x800", "768x1024", "375x812"]

HEADER_PX = 64
JUMP_GAP_PX = 16
JUMP_MS = 1000
ROW_BUTTON_MS = 600
SWIPE_MIN_PX = 50
LONG_SWIPE_PX = 120
SHORT_SWIPE_PX = 30
ROW_SWIPE_PX = 200
TAP_PX = 44
LAYOUT_TOP_PX = 24
CARD_MIN_RATIO = 0.8
CARD_MAX_RATIO = 0.9
BODY_LIMIT = 262144
SHEET_TIMEOUT_S = 20
ABOUT_VIEWPORTS = 3
OXYGEN_VIEWPORTS = 5
PANELS = 3
STAGE_COUNT = 5
RING_MIN_PX = 2
RING_CONTRAST = 3
INSTANT_MS = 0

WORD_RISE_MS = (500, 700)
WORD_STAGGER_MS = (80, 140)
WORDS_DONE_MS = 1600
HEADING_MS = (400, 700)
PACK_MS = (400, 600)
MARKER_MS = (250, 450)
PICTURE_MS = (250, 450)
COPY_MS = (250, 450)
STAGE_COLOUR_MS = (400, 700)
MENU_MS = (200, 350)
HOVER_MS = 150

STICKS_MAX = 100
PRICE_MAX = 100000
MG_MAX = 10000
TEXT_MAX = 1200
INTERVIEWS_MAX = 12
SLUG_MAX = 40
HUE_MAX = 359
ANSWERS_MAX = 6
INGREDIENTS_MAX = 10
STEPS_MAX = 6
CAUTIONS_MAX = 6
STORES_MAX = 4
PACKS_MAX = 3

HTTP_TIMEOUT_S = 60
WAIT_MS = 5000
READY_S = 30
EVENTUALLY_S = 15
STEP_MS = 50
SETTLE_MS = 800
FRAME_MS = 16
PX_TOL = 2
PX_EPS = 0.5
FOCUS_GAP_PX = 4
WALK_PRESSES = 8
SWIPE_STEPS = 15
SWIPE_STEP_MS = 25
TOUCH_POINTS = 5
BOOT_S = 240
SLOW_HOLD_S = 45
SLOW_MARGIN_S = 15
RECORDS_S = 2
STILL_S = 0.15
SCROLL_SETTLE_S = 3
TARGET_SETTLE_S = 2
QUIET_S = 0.3
READY_FRAMES = 3
PANEL_SWIPE_SHARE = 0.6
UNCHANGED = 0.0

GRADING_KEY = os.environ.get("GRADING_KEY", "gk-vireo-7c41e9a2d0")
DOWN_URL_ENV = "APP_GOTENBERG_DOWN_URL"
CHANGED_TIME = "06:45"
UNKNOWN_SCENARIO = "off-nap"
UNKNOWN_SLUG = "no-such-person"
UNKNOWN_PAGE = "/no-such-page"


PRODUCT_NAME = "Vireo Pace"
HERO = "Energy you make, at your own pace."
HERO_LINE = "Vireo Pace is a daily drink stick from Alder Quay Laboratories, made with red beet root."
ABOUT_LEAD = "Inner Pace is how Alder Quay Laboratories thinks about energy: something your body already makes, spends in effort and rebuilds in recovery."
INNER_PANELS = [
    ("Effort", "Every climb, deadline and load of laundry spends energy your body makes from breath and food."),
    ("Recovery", "Pauses, meals and sleep are when the body rebuilds what effort used."),
    ("One pace", "Effort and recovery are not opposites. Kept in rhythm they are one pace: your Inner Pace."),
]
STAGES = [
    ("Breath", "Air reaches the lungs", "With each breath, air travels down to hundreds of millions of tiny air sacs in the lungs, where oxygen passes into the blood."),
    ("Blood", "Red blood cells carry it", "Haemoglobin inside red blood cells picks up oxygen in the lungs and carries it through the arteries to every tissue."),
    ("Cell", "Oxygen enters the cell", "In the smallest blood vessels, oxygen leaves the blood and moves into the cells that use it."),
    ("Mitochondria", "Mitochondria use it", "Inside each cell, mitochondria use oxygen to release the energy stored in food, giving off water and carbon dioxide."),
    ("ATP", "Energy you can spend", "That energy is held in a molecule called ATP, which muscles and nerves spend as you move, think and rest."),
]
SCIENCE_LEAD = "Vireo Pace is made with red beet root. Here is what that plant is, what it holds and how it becomes a powder."
DISCLOSURES = [
    ("Where it grows", "Red beet (Beta vulgaris) is a root vegetable grown in cool climates. Its deep red colour comes from pigments called betalains."),
    ("What it holds", "Beet roots store nitrate taken up from the soil, along with natural sugars and fibre."),
    ("How it becomes powder", "Washed roots are sliced, juiced, gently dried and milled into a fine powder."),
]
NITRATE_STEPS = [
    ("Nitrate", "Beet roots store nitrate taken up from the soil."),
    ("Nitrite", "Bacteria in the mouth turn part of swallowed nitrate into nitrite."),
    ("Nitric oxide", "In the body, part of that nitrite becomes nitric oxide, a molecule involved in widening blood vessels."),
]
PROFILE_NOTE = "Everyone in these interviews is fictional. They talk about their own routines, not about results from Vireo Pace."
LIFESTYLE_LEAD = "Some moments call for effort, others for recovery. Choose a mode, then a moment."
FOOTER_COPY = ["Alder Quay Laboratories", "A fictional company created for this site.", "© 2026 Alder Quay Laboratories"]
CONTACT_COPY = ["Alder Quay Customer Care", "Phone 0120-555-014, weekdays 9:00 to 17:00"]
PRIVACY_COPY = "This site sets no cookies and keeps no record of who you are. Server logs keep the address and time of each request for 14 days."
LEGAL_COPY = "Alder Quay Laboratories, Vireo Pace and every person on this site are fictional. All text and pictures were made for this site."
EMAIL = "care@alderquay.example"

SHEET_FILENAME = "vireo-pace-product-sheet.pdf"
SHEET_503 = {"error": "sheet_unavailable", "message": "The product sheet cannot be prepared right now. Please try again in a few minutes."}
NOT_FOUND = {"error": "not_found", "message": "Not found."}
TOO_LARGE = {"error": "too_large", "message": "The request body is too large."}
INVALID = {"error": "invalid", "message": "The content does not match the published shape."}
NO_INTERVIEW = {"error": "not_found", "message": "This interview does not exist."}
NO_SCENARIO = {"error": "not_found", "message": "This scenario does not exist."}
SCENARIO_ALERT = "This moment cannot be shown right now. Please choose it again."
NOT_FOUND_HEADING = "This page does not exist."

SEED_PRODUCT: dict[str, Any] = {
    "name": "Vireo Pace",
    "format": "Drink stick, 6 g of powder",
    "serving": "One stick in 150 ml of water",
    "packs": [{"sticks": 14, "price_yen": 1980}, {"sticks": 30, "price_yen": 3960}],
    "ingredients": [
        {"name": "Red beet root powder", "mg": 3000},
        {"name": "Dextrin", "mg": 2400},
        {"name": "Yuzu juice powder", "mg": 450},
        {"name": "Sea salt", "mg": 100},
        {"name": "Vitamin C", "mg": 50},
    ],
    "how_to_use": [
        "Tear open one stick.",
        "Stir it into 150 ml of cold or room-temperature water.",
        "Drink it within 30 minutes of mixing.",
    ],
    "storage": "Keep sealed sticks away from direct sunlight, heat and damp.",
    "cautions": [
        "If you are pregnant, nursing, taking medication or under medical care, ask your doctor before use.",
        "Red beet can turn urine pink or red.",
    ],
    "stores": [
        {"name": "Alder Quay Online Store", "url": "https://store.alderquay.example/vireo-pace"},
        {"name": "Harbourline Pharmacy Online", "url": "https://harbourline.example/vireo-pace"},
    ],
}

SEED_INTERVIEWS: list[dict[str, Any]] = [
    {"slug": "mina-okabe", "name": "Mina Okabe", "role": "Sports physiologist", "category": "expert", "hue": 150,
     "lede": "Hard days only count if easy days follow them.",
     "answers": [
         {"question": "What do people get wrong about training?", "answer": "They count the hard sessions and forget the easy ones. The body adapts during recovery, so the easy days are part of the work."},
         {"question": "How do you spend your own rest days?", "answer": "A long walk, a proper lunch and an early night. Nothing I would post about."},
     ]},
    {"slug": "daniel-reyes", "name": "Daniel Reyes", "role": "Sleep researcher", "category": "expert", "hue": 220,
     "lede": "Sleep is the longest recovery of the day.",
     "answers": [
         {"question": "Why is sleep harder to protect than exercise?", "answer": "Nobody hands you a medal for going to bed on time. It is still the habit I would keep if I could keep only one."},
         {"question": "What is your evening routine?", "answer": "Screens off at ten, the same book for twenty minutes, lights out by half past."},
     ]},
    {"slug": "harue-sato", "name": "Harue Sato", "role": "Registered dietitian", "category": "expert", "hue": 35,
     "lede": "Regular meals make a steadier day than perfect ones.",
     "answers": [
         {"question": "Where do you start with someone who feels flat every afternoon?", "answer": "With lunch. Many people skip it or eat it standing up, then wonder why the middle of the afternoon feels long."},
         {"question": "Do you plan your own meals?", "answer": "Loosely. I cook twice a week and eat the leftovers without guilt."},
     ]},
    {"slug": "kenji-mori", "name": "Kenji Mori", "role": "Carpenter and trail runner", "category": "everyday", "hue": 95,
     "lede": "I run before work so the workshop gets my calm hours.",
     "answers": [
         {"question": "When do you run?", "answer": "At six, three mornings a week, on the forest trail behind the workshop."},
         {"question": "What does a rest day look like?", "answer": "Sharpening tools, a nap after lunch and no stopwatch anywhere."},
     ]},
    {"slug": "ana-lindqvist", "name": "Ana Lindqvist", "role": "Night-shift nurse", "category": "everyday", "hue": 265,
     "lede": "My week has two clocks, and I keep both honest.",
     "answers": [
         {"question": "How do you switch between night and day weeks?", "answer": "Slowly. I move bedtime by an hour a day and keep the curtains shut until it sticks."},
         {"question": "What helps you wind down after a shift?", "answer": "A shower, a short walk with the dog and then straight to bed."},
     ]},
    {"slug": "tom-achebe", "name": "Tom Achebe", "role": "Designer working from home", "category": "everyday", "hue": 5,
     "lede": "The commute I lost became a walk I keep.",
     "answers": [
         {"question": "What changed when you started working from home?", "answer": "The day lost its edges. I added a walk at nine and at five so it has a start and an end again."},
         {"question": "How do you share housework with two children at home?", "answer": "A chart on the fridge and a ten-minute tidy before dinner that everyone joins."},
     ]},
]
INTERVIEW_SLUGS = ["mina-okabe", "daniel-reyes", "harue-sato", "kenji-mori", "ana-lindqvist", "tom-achebe"]

SEED_SCENARIOS: list[dict[str, Any]] = [
    {"id": "on-work", "mode": "on", "name": "Work", "title": "The long afternoon", "time": "15:00",
     "copy": "Meetings run into each other and the window light starts to slant.", "moment": "A glass of water with a stick of Vireo Pace beside the keyboard."},
    {"id": "on-sports", "mode": "on", "name": "Sports", "title": "Before the climb", "time": "07:30",
     "copy": "Laces tied, the trail head still in shade.", "moment": "A bottle mixed the night before, cold from the fridge."},
    {"id": "on-hobby", "mode": "on", "name": "Hobby", "title": "The workbench", "time": "10:00",
     "copy": "Saturday hands on wood, glue and the radio.", "moment": "A cup on the shelf, away from the sawdust."},
    {"id": "on-housework", "mode": "on", "name": "Housework", "title": "Laundry day", "time": "11:30",
     "copy": "Two loads hung, one to fold, floors next.", "moment": "A glass on the windowsill between rooms."},
    {"id": "off-break", "mode": "off", "name": "Break", "title": "Ten minutes", "time": "13:10",
     "copy": "Phone face down, shoulders down.", "moment": "Water, a window, nothing to finish."},
    {"id": "off-holiday", "mode": "off", "name": "Holiday", "title": "Slow morning", "time": "09:00",
     "copy": "No alarm, a guidebook left closed.", "moment": "A stick packed in the day bag, just in case."},
    {"id": "off-relax", "mode": "off", "name": "Relax", "title": "After the bath", "time": "21:00",
     "copy": "Steam on the mirror, music low.", "moment": "Warm tea instead; the stick can wait for tomorrow."},
    {"id": "off-rest", "mode": "off", "name": "Rest", "title": "Lights out", "time": "23:00",
     "copy": "The day put away, the room dark and cool.", "moment": "Nothing at all. Rest is part of the pace."},
]
SCENARIO_ORDER = ["on-work", "on-sports", "on-hobby", "on-housework", "off-break", "off-holiday", "off-relax", "off-rest"]
SCENARIO_CASES = ["on-work", "on-sports", "on-hobby", "on-housework", "off-break", "off-holiday", "off-relax", "off-rest", "unknown"]
SCENARIOS = {s["id"]: s for s in SEED_SCENARIOS}

CHAPTER_IDS = ["opening", "about", "oxygen", "science", "product", "interviews", "lifestyle"]
RAIL = {
    "opening": "01 Opening", "about": "02 About", "oxygen": "03 Oxygen & Energy", "science": "04 Science & Technology",
    "product": "05 Product", "interviews": "06 Interviews", "lifestyle": "07 Lifestyle",
}
CHAPTER_NAMES = {
    "opening": HERO, "about": "Inner Pace", "oxygen": "From breath to energy", "science": "A root that keeps nitrate",
    "product": PRODUCT_NAME, "interviews": "Voices on pace", "lifestyle": "ON and OFF, one pace",
}
SITE_LINKS = ["About", "Science & Technology", "Product", "Interview", "Online store"]
FOOTER_LINKS = ["About", "Science & Technology", "Product", "Interview", "Online store", "Contact", "Privacy", "Legal"]
TAB_ORDER_WIDE = ["Skip to story", "Alder Quay Laboratories home", *SITE_LINKS, "Menu", *RAIL.values(), "Begin the story", "See Vireo Pace"]
TAB_ORDER_NARROW = ["Skip to story", "Alder Quay Laboratories home", "Menu", "Begin the story", "See Vireo Pace"]


MOTION_RECORDER_JS = """
(() => {
  if (window.__motionRecorder) return;
  window.__motionRecorder = true;
  window.__motions = [];
  const keep = (el, anim) => {
    if (!anim || window.__motions.some((m) => m.anim === anim)) return;
    window.__motions.push({ el, anim, at: document.timeline.currentTime || 0 });
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = animate.apply(this, args); keep(this, a); return a; };
  const fromEvent = (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    for (const a of el.getAnimations()) {
      if (event.type === 'animationstart' && a.animationName === event.animationName) keep(el, a);
      if (event.type === 'transitionrun' && a.transitionProperty === event.propertyName) keep(el, a);
    }
  };
  document.addEventListener('animationstart', fromEvent, true);
  document.addEventListener('transitionrun', fromEvent, true);
})();
"""

MOTION_QUERY_JS = """
(root) => (window.__motions || []).filter((m) => m.el === root || root.contains(m.el) || m.el.contains(root)).map((m) => {
  const t = m.anim.effect ? m.anim.effect.getComputedTiming() : {};
  const delay = Number(t.delay) || 0;
  const duration = Number(t.duration) || 0;
  const start = (m.anim.startTime === null || m.anim.startTime === undefined ? m.at : m.anim.startTime) + delay;
  return { delay, duration, start, infinite: t.iterations === Infinity };
})
"""

PICTURE_QUERY_JS = """
() => (window.__motions || []).filter((m) => m.el.closest && (m.el.closest('[data-scenario]:not([data-mode])') || m.el.querySelector('[data-scenario]:not([data-mode])'))).map((m) => {
  const t = m.anim.effect ? m.anim.effect.getComputedTiming() : {};
  return { delay: Number(t.delay) || 0, duration: Number(t.duration) || 0 };
})
"""

RECORD_STATUS_JS = """
(el) => {
  window.__said = [];
  const read = () => { const text = (el.textContent || '').trim(); if (text) window.__said.push(text); };
  new MutationObserver(read).observe(el, { childList: true, subtree: true, characterData: true });
}
"""

JUMP_JS = """
([heading, banner, gap, eps]) => {
  const h = heading.getBoundingClientRect();
  const b = banner.getBoundingClientRect();
  return document.activeElement === heading && h.top >= b.bottom + gap - eps && h.bottom <= window.innerHeight + eps;
}
"""

ROW_JS = """
([track, region]) => {
  let scroller = null;
  for (let el = track; el && el !== region.parentElement; el = el.parentElement) {
    const s = getComputedStyle(el);
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && el.scrollWidth > el.clientWidth + 1) { scroller = el; break; }
  }
  const view = scroller || region;
  const contentLeft = track.getBoundingClientRect().left - track.scrollLeft;
  const viewLeft = view.getBoundingClientRect().left + (scroller ? scroller.clientLeft : 0);
  return { offset: viewLeft - contentLeft, panel: track.scrollWidth / 3, pageX: window.scrollX };
}
"""

TARGET_BOX_JS = """
(el) => {
  const rects = [el.getBoundingClientRect(), ...(el.labels ? [...el.labels].map((l) => l.getBoundingClientRect()) : [])];
  let best = rects[0];
  for (const r of rects) if (r.width * r.height > best.width * best.height) best = r;
  return { x: best.left, y: best.top, width: best.width, height: best.height };
}
"""

BACKGROUND_JS = """
(el) => {
  for (let node = el; node; node = node.parentElement) {
    const c = getComputedStyle(node).backgroundColor;
    if (c && c !== 'transparent' && !/rgba\\([^)]*,\\s*0\\)$/.test(c)) return c;
  }
  return 'rgb(255, 255, 255)';
}
"""

_TOUCH: dict[int, Any] = {}
_TOUCH_END: dict[int, float] = {}

VISIBLE_BOX_JS = """
(el) => {
  let base = el;  // a finger swipes a row on the row's scroll box: the track inside it slides out of its own box
  for (let a = el; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) { base = a; break; }
  }
  const r = base.getBoundingClientRect();
  let left = r.left, right = r.right, top = r.top, bottom = r.bottom;
  for (let a = base.parentElement; a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
      const b = a.getBoundingClientRect();
      left = Math.max(left, b.left); right = Math.min(right, b.right); top = Math.max(top, b.top); bottom = Math.min(bottom, b.bottom);
    }
  }
  left = Math.max(left, 0); right = Math.min(right, innerWidth); top = Math.max(top, 0); bottom = Math.min(bottom, innerHeight);
  return right > left && bottom > top ? { x: left, y: top, width: right - left, height: bottom - top } : null;
}
"""

SWIPE_INTO_VIEW_JS = """
(el) => {
  let base = el;  // scroll the row's scroll box into view: scrolling the track into view scrolls the row itself back
  for (let a = el; a && a !== document.body; a = a.parentElement) {
    const s = getComputedStyle(a);
    if ((s.overflowX === 'auto' || s.overflowX === 'scroll') && a.scrollWidth > a.clientWidth + 1) { base = a; break; }
  }
  base.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });
}
"""

SCROLLS_JS = """
() => [Math.round(window.scrollX), Math.round(window.scrollY),
       ...[...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 || e.scrollHeight > e.clientHeight + 1)
         .flatMap((e) => [Math.round(e.scrollLeft), Math.round(e.scrollTop)])]
"""


def base(app_url: str) -> str:
    return app_url.rstrip("/")


def api(app_url: str, method: str, path: str, *, body: Any = None, raw: bytes | None = None,
        headers: dict[str, str] | None = None, timeout: float = HTTP_TIMEOUT_S) -> httpx.Response:
    content = raw if raw is not None else (None if body is None else json.dumps(body).encode())
    sent = dict(headers or {})
    if content is not None:
        sent.setdefault("Content-Type", "application/json")
    return httpx.request(method, base(app_url) + path, content=content, headers=sent, timeout=timeout)


def grading(app_url: str, method: str, body: Any = None, *, raw: bytes | None = None, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {} if key is None else {"X-Grading-Key": key}
    return api(app_url, method, "/api/grading/content", body=body, raw=raw, headers=headers)


def assert_json(resp: httpx.Response, status: int, body: Any = None) -> Any:
    assert resp.status_code == status, f"{resp.request.method} {resp.request.url}: expected {status}, got {resp.status_code} {resp.text[:300]}"
    ctype = resp.headers.get("content-type", "").replace(" ", "").lower()
    assert ctype == "application/json;charset=utf-8", f"{resp.request.url}: content type {ctype!r}"
    data = resp.json()
    if body is not None:
        assert data == body, f"{resp.request.url}: body {data!r}, expected {body!r}"
    return data


def restore(app_url: str) -> None:
    assert_json(grading(app_url, "DELETE"), 200, {"edition": 1})


def seed_body() -> dict[str, Any]:
    return copy.deepcopy({"product": SEED_PRODUCT, "interviews": SEED_INTERVIEWS, "scenarios": SEED_SCENARIOS})


@contextmanager
def published(app_url: str, body: dict[str, Any]) -> Iterator[int]:
    restore(app_url)
    try:
        data = assert_json(grading(app_url, "PUT", body), 200)
        assert data == {"edition": 2}, f"PUT after restore answered {data!r}; expected edition 2"
        yield 2
    finally:
        restore(app_url)


def tag() -> str:
    return re.sub(r"[^a-z0-9]", "", unique("vp")[0].lower())[-10:] or "x"


def summary(iv: dict[str, Any]) -> dict[str, Any]:
    return {k: iv[k] for k in ("slug", "name", "role", "category", "lede", "hue")}


def interview_detail(ivs: list[dict[str, Any]], i: int) -> dict[str, Any]:
    prev = {"slug": ivs[i - 1]["slug"], "name": ivs[i - 1]["name"]} if i > 0 else None
    nxt = {"slug": ivs[i + 1]["slug"], "name": ivs[i + 1]["name"]} if i < len(ivs) - 1 else None
    return {**summary(ivs[i]), "answers": ivs[i]["answers"], "previous": prev, "next": nxt}


def content_of(body: dict[str, Any], edition: int) -> dict[str, Any]:
    order = {sid: n for n, sid in enumerate(SCENARIO_ORDER)}
    scenarios = sorted(body["scenarios"], key=lambda s: order[s["id"]])
    return {
        "edition": edition,
        "product": body["product"],
        "interviews": [summary(iv) for iv in body["interviews"]],
        "scenarios": [{"id": s["id"], "mode": s["mode"], "name": s["name"]} for s in scenarios],
    }


def notice(name: str) -> str:
    return f"{name} is a food. It is not a medicine and is not intended to diagnose, treat, cure or prevent any disease."


def pack_line(pack: dict[str, int]) -> str:
    return f"{pack['sticks']} sticks: ¥{pack['price_yen']:,} (tax included)"


def amount(mg: int) -> str:
    return f"{mg:,} mg"


def sheet_items(product: dict[str, Any], edition: int) -> list[str]:
    return [
        f"{product['name']} product information",
        "Alder Quay Laboratories",
        f"Format: {product['format']}",
        f"Serving: {product['serving']}",
        *[pack_line(p) for p in product["packs"]],
        "Ingredients per stick",
        *[f"{i['name']} {amount(i['mg'])}" for i in product["ingredients"]],
        "How to use",
        *[f"{n}. {step}" for n, step in enumerate(product["how_to_use"], start=1)],
        f"Storage: {product['storage']}",
        "Cautions",
        *product["cautions"],
        notice(product["name"]),
        f"Content edition {edition}",
    ]


def flat(text: str) -> str:
    return " ".join(text.split())


def assert_in_order(text: str, items: list[str], what: str) -> None:
    joined = flat(text)
    pos = 0
    for item in items:
        found = joined.find(item, pos)
        assert found >= 0, f"{what}: {item!r} missing after position {pos}; text was {joined[:600]!r}"
        pos = found + len(item)


def down_url() -> str:
    url = os.environ.get(DOWN_URL_ENV)
    if not url:
        pytest.fail(f"{DOWN_URL_ENV} is not set; the gotenberg-down outage instance is required")
    return url.rstrip("/")


@contextmanager
def visit(browser: Browser, url: str, size: tuple[int, int] = DESKTOP, *, reduced: bool = False,
          touch: bool = False, record: bool = False) -> Iterator[Page]:
    with open_app(browser, url, reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_default_timeout(WAIT_MS)
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if touch:
            cdp = session(page)
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": TOUCH_POINTS})
            _TOUCH[id(page)] = cdp
        if record:
            page.context.add_init_script(MOTION_RECORDER_JS)
        page.goto("about:blank")
        page.goto(url)
        try:
            yield page
        finally:
            _TOUCH.pop(id(page), None)
            _TOUCH_END.pop(id(page), None)


def ready(page: Page, script: str) -> None:
    deadline = time.monotonic() + READY_S
    while time.monotonic() < deadline:
        try:
            until(page, script, seconds=max(1.0, deadline - time.monotonic()))
            advance(page, FRAME_MS * READY_FRAMES)
            return
        except PlaywrightError as error:
            if "context was destroyed" not in str(error):
                raise
    pytest.fail(f"the page was not ready within {READY_S} s")


def story_ready(page: Page) -> None:
    ready(page, "() => !!document.querySelector('[data-mode][data-scenario]') && !!document.querySelector('[data-view]')"
                " && !!document.querySelector('[data-panel]') && !!document.querySelector('[data-stage]')")


def page_ready(page: Page) -> None:
    ready(page, "() => document.readyState === 'complete' && !!document.querySelector('h1')")


def scroll_still(page: Page) -> None:
    deadline = time.monotonic() + SCROLL_SETTLE_S
    last, since = None, time.monotonic()
    while time.monotonic() < deadline:
        now = page.evaluate("() => [window.scrollX, window.scrollY]")
        if now != last:
            last, since = now, time.monotonic()
        elif time.monotonic() - since >= STILL_S:
            advance(page, FRAME_MS)
            return
    pytest.fail(f"the page was still scrolling {SCROLL_SETTLE_S} s after a jump")


def settled(locator: Locator) -> None:
    page = locator.page
    deadline = time.monotonic() + TARGET_SETTLE_S
    last, since = None, time.monotonic()
    while time.monotonic() < deadline:
        advance(page, FRAME_MS)
        b = locator.bounding_box()
        now = None if b is None else tuple(round(b[k]) for k in ("x", "y", "width", "height"))
        if now != last:
            last, since = now, time.monotonic()
        elif time.monotonic() - since >= STILL_S:
            return


def click(locator: Locator) -> None:
    settled(locator)
    kit_click(locator)


def tap(locator: Locator) -> None:
    settled(locator)
    kit_tap(locator)


def eventually(page: Page, check: Callable[[], None], what: str, seconds: float = EVENTUALLY_S) -> None:
    deadline = time.monotonic() + seconds
    error: BaseException | None = None
    while time.monotonic() < deadline:
        try:
            check()
            return
        except (AssertionError, PlaywrightError) as exc:
            error = exc
            advance(page, STEP_MS)
    pytest.fail(f"{what}: {error}")


def poll(page: Page, script: str, arg: Any, seconds: float, what: str) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if page.evaluate(script, arg):
            return
    pytest.fail(what)


def status(page: Page) -> Locator:
    return page.get_by_role("status", name="Story updates", exact=True)


def status_text(page: Page) -> str:
    return (status(page).text_content() or "").strip()


def record_announcements(page: Page) -> None:
    status(page).evaluate(RECORD_STATUS_JS)


def said(page: Page) -> list[str]:
    return page.evaluate("() => window.__said || []")


def expect_said(page: Page, expected: list[str], what: str) -> None:
    def check() -> None:
        assert said(page) == expected, f"announcements {said(page)!r}, expected {expected!r}"
    eventually(page, check, what)
    advance(page, SETTLE_MS)
    assert said(page) == expected, f"{what}: later announcements {said(page)!r}, expected {expected!r}"


def region(page: Page, chapter: str, product_name: str = PRODUCT_NAME) -> Locator:
    name = product_name if chapter == "product" else CHAPTER_NAMES[chapter]
    return page.get_by_role("region", name=name, exact=True)


def chapter_heading(page: Page, chapter: str, product_name: str = PRODUCT_NAME) -> Locator:
    name = product_name if chapter == "product" else CHAPTER_NAMES[chapter]
    return region(page, chapter, product_name).get_by_role("heading", name=name, exact=True)


def hash_of(page: Page) -> str:
    return page.evaluate("() => location.hash")


def query(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


def scroll_to(page: Page, y: float) -> None:
    page.evaluate("(y) => window.scrollTo({ top: y, left: 0, behavior: 'instant' })", y)


def scroll_y(page: Page) -> float:
    return page.evaluate("() => window.scrollY")


def doc_box(locator: Locator) -> tuple[float, float]:
    top, height = locator.evaluate("(el) => { const r = el.getBoundingClientRect(); return [r.top + window.scrollY, r.height]; }")
    return float(top), float(height)


def is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("(el) => el === document.activeElement"))


def assert_focused(locator: Locator, what: str) -> None:
    assert is_focused(locator), f"{what}: focus is not on the expected control"


def expect_jump(page: Page, chapter: str, product_name: str = PRODUCT_NAME, *, instant: bool = False) -> None:
    heading = chapter_heading(page, chapter, product_name)
    heading.wait_for(state="attached")
    advance(page, FRAME_MS if instant else JUMP_MS)
    handles = [heading.element_handle(), page.get_by_role("banner").element_handle(), JUMP_GAP_PX, PX_EPS]
    poll(page, JUMP_JS, handles, JUMP_MS / 1000 if not instant else FRAME_MS / 1000,
         f"jump to {chapter}: heading focused and at least {JUMP_GAP_PX} px below the header within {JUMP_MS} ms")
    scroll_still(page)
    eventually(page, lambda: (assert_eq(page.evaluate(JUMP_JS, handles), True), assert_eq(hash_of(page), f"#{chapter}")),
               f"jump to {chapter}: once the scroll stops, the heading is still in place and the hash names the chapter")


CLEAR_OF_HEADER_JS = """
([banner, scope]) => {
  const el = document.activeElement;
  if (!el || el === document.body || !scope.contains(el)) return null;
  const rects = [el.getBoundingClientRect(), ...(el.labels ? [...el.labels].map((l) => l.getBoundingClientRect()) : [])];
  const r = rects.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  const header = banner.getBoundingClientRect().bottom;
  const fits = r.height <= innerHeight - header;
  const name = (el.getAttribute('aria-label') || (el.labels && el.labels[0] ? el.labels[0].textContent : '')
                || el.textContent || el.tagName).replace(/\\s+/g, ' ').trim().slice(0, 60);
  return { top: r.top, bottom: r.bottom, header, height: innerHeight, fits, name };
}
"""


def focus_walk(page: Page, scope: Locator, start: Locator, key: str, what: str, presses: int = WALK_PRESSES) -> int:
    handles = [page.get_by_role("banner").element_handle(), scope.element_handle()]
    start.focus()
    checked = 0
    for _ in range(presses):
        top = page.evaluate("() => document.activeElement.getBoundingClientRect().top + window.scrollY")
        scroll_to(page, max(0, top - HEADER_PX - FOCUS_GAP_PX))
        scroll_still(page)
        page.keyboard.press(key)
        advance(page, FRAME_MS)
        scroll_still(page)
        if page.evaluate(CLEAR_OF_HEADER_JS, handles) is None:
            break
        checked += 1

        def clear() -> None:
            r = page.evaluate(CLEAR_OF_HEADER_JS, handles)
            assert r is not None, "focus left the chapter while the page settled"
            inside = r["bottom"] <= r["height"] + PX_EPS if r["fits"] else r["top"] < r["height"]
            assert r["top"] >= r["header"] - PX_EPS and inside, (
                f"{r['name']!r} spans y {r['top']:.0f} to {r['bottom']:.0f}: under the header (bottom edge {r['header']:.0f})"
                f" or outside the viewport")

        eventually(page, clear, f"{what}: {key} press {checked} leaves focus on a control covered by the header")
    assert checked, f"{what}: {key} never moved focus to another control of the chapter"
    return checked


def current_marks(nav: Locator) -> list[str]:
    return [name for name in RAIL.values() if nav.get_by_role("link", name=name, exact=True).get_attribute("aria-current") == "true"]


def scroll_into_chapter(page: Page, chapter: str, fraction: float = 0.5) -> None:
    top, height = doc_box(region(page, chapter))
    vh = page.viewport_size["height"]
    target = top + height * fraction - 0.4 * vh
    maximum = page.evaluate("() => document.documentElement.scrollHeight - window.innerHeight")
    scroll_to(page, max(0, min(target, maximum)))


def at_rest(page: Page) -> None:
    deadline = time.monotonic() + SCROLL_SETTLE_S
    last, since = None, time.monotonic()
    while time.monotonic() < deadline:
        now = page.evaluate(SCROLLS_JS)
        if now != last:
            last, since = now, time.monotonic()
        elif time.monotonic() - since >= STILL_S:
            return
    pytest.fail(f"the page was still moving {SCROLL_SETTLE_S} s before a swipe")


def swipe(page: Page, locator: Locator, finger_dx: float) -> None:
    while time.time() < _TOUCH_END.get(id(page), 0.0):
        pass
    at_rest(page)
    locator.evaluate(SWIPE_INTO_VIEW_JS)
    at_rest(page)
    box = locator.evaluate(VISIBLE_BOX_JS)
    assert box, "swipe target has no visible part"
    vw = page.viewport_size["width"]
    x = box["x"] + box["width"] / 2 - finger_dx / 2
    x = max(1, min(vw - 1, x))
    y = box["y"] + box["height"] / 2
    cdp = _TOUCH.get(id(page)) or session(page)
    start = time.time()
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}], "timestamp": start})
    for step in range(1, SWIPE_STEPS + 1):
        moved = max(1, min(vw - 1, x + finger_dx * step / SWIPE_STEPS))
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": moved, "y": y}],
                                              "timestamp": start + step * SWIPE_STEP_MS / 1000})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": [],
                                          "timestamp": start + (SWIPE_STEPS + 1) * SWIPE_STEP_MS / 1000})
    _TOUCH_END[id(page)] = start + (SWIPE_STEPS + 1) * SWIPE_STEP_MS / 1000


def clear_motions(page: Page) -> None:
    page.evaluate("() => { window.__motions = []; }")


def records(locator: Locator) -> list[dict[str, Any]]:
    return locator.evaluate(MOTION_QUERY_JS)


def wait_records(page: Page, locator: Locator) -> list[dict[str, Any]]:
    advance(page, FRAME_MS)
    advance(page, FRAME_MS)
    deadline = time.monotonic() + RECORDS_S
    found: list[dict[str, Any]] = []
    since = time.monotonic()
    while time.monotonic() < deadline:
        now = records(locator)
        if len(now) != len(found):
            found, since = now, time.monotonic()
        elif found and time.monotonic() - since >= QUIET_S:
            break
    return found


def path_settle_ms(path: list[dict[str, float]], window_ms: float) -> tuple[float, float]:
    if not path:
        pytest.fail("motion() returned no samples")
    keys = [k for k in path[0] if k != "t"]
    last = path[-1]
    step = window_ms / max(1, len(path))
    first_change = None
    last_change = None
    for i, sample in enumerate(path):
        if any(abs(float(sample[k]) - float(path[0][k])) > PX_EPS for k in keys) and first_change is None:
            first_change = i
        if any(abs(float(sample[k]) - float(last[k])) > PX_EPS for k in keys):
            last_change = i
    if first_change is None or last_change is None:
        return 0.0, step
    t_end = float(path[min(last_change + 1, len(path) - 1)].get("t", (last_change + 1) * step))
    t_start = float(path[max(first_change - 1, 0)].get("t", (first_change - 1) * step))
    return t_end - t_start, step


def assert_motion(page: Page, locator: Locator, action: Callable[[], None], bounds: tuple[int, int], what: str) -> None:
    clear_motions(page)
    action()
    found = wait_records(page, locator)
    lo, hi = bounds
    if found:
        longest = max(r["duration"] for r in found)
        assert lo <= longest <= hi, f"{what}: longest motion {longest} ms, expected {lo} to {hi} ms"
        return
    duration, step = path_settle_ms(motion(locator, hi * 2), hi * 2)
    assert lo - step <= duration <= hi + step, f"{what}: motion lasted {duration} ms, expected {lo} to {hi} ms"


def assert_instant(locator: Locator, what: str) -> None:
    found = records(locator)
    worst = max((round(r["delay"] + r["duration"]) for r in found), default=0)
    assert worst == INSTANT_MS, f"{what}: reduced motion still runs a {worst} ms motion"


def parse_rgb(value: str) -> tuple[float, float, float] | None:
    m = re.search(r"rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)", value or "")
    return (float(m.group(1)), float(m.group(2)), float(m.group(3))) if m else None


def luminance(rgb: tuple[float, float, float]) -> float:
    def channel(c: float) -> float:
        c /= 255
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4
    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast(a: tuple[float, float, float], b: tuple[float, float, float]) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def box(locator: Locator) -> dict[str, float]:
    return locator.evaluate(TARGET_BOX_JS)


def distinct(values: list[float]) -> list[float]:
    groups: list[float] = []
    for v in sorted(values):
        if not groups or abs(v - groups[-1]) > PX_TOL:
            groups.append(v)
    return groups


def in_dom_order(page: Page, locators: list[Locator]) -> bool:
    handles = [loc.element_handle() for loc in locators]
    return bool(page.evaluate("(els) => els.every((e, i) => i === 0 || (els[i - 1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING))", handles))


def lifestyle(page: Page) -> Locator:
    return region(page, "lifestyle")


def busy(page: Page) -> bool:
    return bool(lifestyle(page).evaluate("(r) => r.getAttribute('aria-busy') === 'true' || !!r.querySelector('[aria-busy=\"true\"]')"))


def expect_scenario(page: Page, sid: str, title: str | None = None, *, in_address: bool = True) -> None:
    shown_title = title or SCENARIOS[sid]["title"]

    def check() -> None:
        life = lifestyle(page)
        assert life.get_attribute("data-scenario") == sid, f"data-scenario {life.get_attribute('data-scenario')!r}"
        assert life.get_attribute("data-mode") == sid.split("-")[0], f"data-mode {life.get_attribute('data-mode')!r}"
        picture = life.get_by_role("img", name=f"Illustration: {shown_title}", exact=True)
        assert picture.count() == 1, f"no picture named Illustration: {shown_title}"
        assert picture.get_attribute("data-scenario") == sid
        assert life.get_by_role("heading", level=3, name=shown_title, exact=True).count() == 1
        assert not busy(page), "panel still aria-busy"
        if in_address:
            assert query(page).get("scenario") == [sid], f"address {page.url}"
        name = SCENARIOS[sid]["name"]
        assert page.get_by_role("radiogroup", name="Moments").get_by_role("radio", name=name, exact=True).is_checked()
        mode = "ON" if sid.startswith("on-") else "OFF"
        assert page.get_by_role("radiogroup", name="Mode").get_by_role("radio", name=mode, exact=True).is_checked()
    eventually(page, check, f"Lifestyle shows {sid}")


def choose(radio: Locator, *, touch: bool = False) -> None:
    radio.evaluate("(e) => (e.labels && e.labels[0] ? e.labels[0] : e).scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' })")
    settled(radio)
    b = box(radio)
    x, y = b["x"] + b["width"] / 2, b["y"] + b["height"] / 2
    if touch:
        radio.page.touchscreen.tap(x, y)
    else:
        radio.page.mouse.click(x, y)


def moments(page: Page) -> Locator:
    return page.get_by_role("radiogroup", name="Moments", exact=True)


def mode_radio(page: Page, mode: str) -> Locator:
    return page.get_by_role("radiogroup", name="Mode", exact=True).get_by_role("radio", name=mode, exact=True)


def moment_radio(page: Page, sid: str) -> Locator:
    return moments(page).get_by_role("radio", name=SCENARIOS[sid]["name"], exact=True)


def mode_line(sid: str, title: str | None = None) -> str:
    s = SCENARIOS[sid]
    return f"{'ON' if s['mode'] == 'on' else 'OFF'}: {s['name']}. {title or s['title']}."


def about_state(page: Page) -> dict[str, Any]:
    r = region(page, "about")
    return {"panel": r.get_attribute("data-panel"), "progress": r.get_attribute("data-progress")}


def track_left(page: Page) -> float:
    return float(page.evaluate("() => document.querySelector('[data-track]').getBoundingClientRect().left"))


def row_state(page: Page) -> dict[str, float]:
    track = region(page, "about").locator("[data-track]")
    return page.evaluate(ROW_JS, [track.element_handle(), region(page, "about").element_handle()])


def panel_swipe(page: Page) -> float:
    return max(ROW_SWIPE_PX, round(PANEL_SWIPE_SHARE * row_state(page)["panel"]))


def dot_x(page: Page) -> float:
    return float(page.evaluate("() => { const r = document.querySelector('[data-dot]').getBoundingClientRect(); return r.left + r.width / 2; }"))


def selected_tab(tablist: Locator, names: list[str]) -> list[str]:
    return [n for n in names if tablist.get_by_role("tab", name=n, exact=True).get_attribute("aria-selected") == "true"]


def interview_names(page: Page) -> list[str]:
    items = page.get_by_role("list", name="Interviews", exact=True).get_by_role("listitem").all()
    return [(li.get_by_role("heading", level=3).first.text_content() or "").strip() for li in items]


def sheet_button(page: Page) -> Locator:
    return page.get_by_role("button", name="Download product sheet (PDF)", exact=True)


def download_sheet(page: Page, press: Callable[[], None]) -> bytes:
    with page.expect_download(timeout=HTTP_TIMEOUT_S * 1000) as info:
        press()
        eventually(page, lambda: assert_eq(status_text(page), "Product sheet ready."), "sheet ready announcement", seconds=HTTP_TIMEOUT_S)
    download = info.value
    assert download.suggested_filename == SHEET_FILENAME, f"downloaded {download.suggested_filename!r}"
    data = Path(download.path()).read_bytes()
    assert pdf_pages(data) >= 1, "downloaded sheet is not a PDF"
    return data


def assert_eq(actual: Any, expected: Any) -> None:
    assert actual == expected, f"{actual!r} != {expected!r}"


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return int(s.getsockname()[1])


class Relay:

    def __init__(self, target_host: str, target_port: int) -> None:
        self.target = (target_host, target_port)
        self.mode = "down"
        self.stopping = threading.Event()
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = int(self.sock.getsockname()[1])
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while not self.stopping.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            threading.Thread(target=self._serve, args=(conn, self.mode), daemon=True).start()

    def _serve(self, conn: socket.socket, mode: str) -> None:
        if mode == "down":
            conn.close()
            return
        held = b""
        if mode == "slow":
            conn.settimeout(1)
            deadline = time.monotonic() + SLOW_HOLD_S
            while time.monotonic() < deadline and not self.stopping.is_set() and self.mode == "slow":
                try:
                    data = conn.recv(65536)
                    if not data:
                        break
                    held += data
                except socket.timeout:
                    continue
                except OSError:
                    break
            else:
                if self.mode == "up" and not self.stopping.is_set():
                    mode = "up"
            if mode == "slow":
                conn.close()
                return
            conn.settimeout(None)
        try:
            upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            if held:
                upstream.sendall(held)
        except OSError:
            conn.close()
            return

        def pipe(src: socket.socket, dst: socket.socket) -> None:
            try:
                while True:
                    data = src.recv(65536)
                    if not data:
                        break
                    dst.sendall(data)
            except OSError:
                pass
            finally:
                for s in (src, dst):
                    try:
                        s.shutdown(socket.SHUT_RDWR)
                    except OSError:
                        pass

        threading.Thread(target=pipe, args=(conn, upstream), daemon=True).start()
        pipe(upstream, conn)

    def stop(self) -> None:
        self.stopping.set()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def log_tail(path: Path) -> str:
    try:
        return path.read_text(errors="replace")[-3000:]
    except OSError:
        return ""


def test_wf_chapter_tour_happy(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/") as page:
        story_ready(page)
        eventually(page, lambda: assert_eq(hash_of(page), "#opening"), "a load of / gets #opening at once")
        tops = [doc_box(region(page, c))[0] for c in CHAPTER_IDS]
        assert tops == sorted(tops) and len(set(tops)) == len(tops), f"chapters out of order: {tops}"
        rail = page.get_by_role("navigation", name="Chapters", exact=True)
        for chapter in CHAPTER_IDS + list(reversed(CHAPTER_IDS)):
            scroll_into_chapter(page, chapter)
            eventually(page, lambda: (assert_eq(hash_of(page), f"#{chapter}"), assert_eq(current_marks(rail), [RAIL[chapter]])),
                       f"rail and hash follow the scroll to {chapter}")
        click(rail.get_by_role("link", name=RAIL["interviews"], exact=True))
        expect_jump(page, "interviews")
        copied = page.url
    assert copied.endswith("#interviews"), copied
    with visit(browser, copied) as fresh:
        story_ready(fresh)
        expect_jump(fresh, "interviews")
        assert interview_names(fresh) == [iv["name"] for iv in SEED_INTERVIEWS]
    content = assert_json(api(app_url, "GET", "/api/content"), 200)
    assert content["edition"] == 1


def test_wf_chapter_tour_restore_seed(browser: Browser, app_url: str) -> None:
    t = tag()
    body = seed_body()
    body["product"]["name"] = f"Pace Draft {t}"
    body["interviews"][0]["name"] = f"Draft Person {t}"
    restore(app_url)
    try:
        assert_json(grading(app_url, "PUT", body), 200, {"edition": 2})
        with visit(browser, base(app_url) + "/#product") as page:
            story_ready(page)
            eventually(page, lambda: assert_eq(region(page, "product", body["product"]["name"]).count(), 1), "changed product shows")
            assert region(page, "product", body["product"]["name"]).get_by_text("Content edition 2", exact=True).count() == 1
            assert interview_names(page)[0] == body["interviews"][0]["name"]
    finally:
        assert_json(grading(app_url, "DELETE"), 200, {"edition": 1})
    with visit(browser, base(app_url) + "/#product") as page:
        story_ready(page)
        product = region(page, "product")
        eventually(page, lambda: assert_eq(product.get_by_text("Content edition 1", exact=True).count(), 1), "edition line reads edition 1")
        assert interview_names(page) == [iv["name"] for iv in SEED_INTERVIEWS]
        expect_scenario(page, "on-work", in_address=False)
    assert_json(api(app_url, "GET", "/api/content"), 200, content_of(seed_body(), 1))


def test_seed_content_exact(browser: Browser, app_url: str) -> None:
    restore(app_url)
    assert_json(api(app_url, "GET", "/api/content"), 200, content_of(seed_body(), 1))
    first = httpx.get(down_url() + "/api/content", timeout=HTTP_TIMEOUT_S)
    assert_json(first, 200, content_of(seed_body(), 1))
    assert Postgres("_sheetdown").tables(), "the empty-database instance stored no content tables"
    with visit(browser, base(app_url) + "/") as page:
        story_ready(page)
        expected_text = {
            "opening": [HERO_LINE],
            "about": [ABOUT_LEAD, *[t for pair in INNER_PANELS for t in pair]],
            "oxygen": [STAGES[0][1], STAGES[0][2]],
            "science": [SCIENCE_LEAD, notice(PRODUCT_NAME)],
            "product": [f"{SEED_PRODUCT['format']}. {SEED_PRODUCT['serving']}.", "Content edition 1",
                        f"Format: {SEED_PRODUCT['format']}", f"Serving: {SEED_PRODUCT['serving']}", *[pack_line(p) for p in SEED_PRODUCT["packs"]]],
            "interviews": [PROFILE_NOTE, *[iv["lede"] for iv in SEED_INTERVIEWS], *[iv["role"] for iv in SEED_INTERVIEWS]],
            "lifestyle": [LIFESTYLE_LEAD, SCENARIOS["on-work"]["copy"], SCENARIOS["on-work"]["moment"], SCENARIOS["on-work"]["time"]],
        }
        for chapter, texts in expected_text.items():
            text = flat(region(page, chapter).text_content() or "")
            for t in texts:
                assert t in text, f"{chapter} is missing the seed copy {t!r}"
        assert interview_names(page) == [iv["name"] for iv in SEED_INTERVIEWS]
        footer = flat(page.get_by_role("contentinfo").text_content() or "")
        for t in FOOTER_COPY:
            assert t in footer, f"footer misses {t!r}"
        page.goto(base(app_url) + "/store")
        page_ready(page)
        eventually(page, lambda: assert_eq(page.get_by_text("Content edition 1", exact=True).count(), 1), "store edition line reads edition 1")


def test_current_chapter_rail_and_address(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-hobby") as page:
        story_ready(page)
        rail = page.get_by_role("navigation", name="Chapters", exact=True)
        eventually(page, lambda: assert_eq(current_marks(rail), [RAIL["opening"]]), "opening is current at the very top")
        length = page.evaluate("() => history.length")
        vh = page.viewport_size["height"]
        maximum = page.evaluate("() => document.documentElement.scrollHeight - window.innerHeight")
        edges: list[tuple[str, float]] = []
        for chapter in CHAPTER_IDS:
            top, height = doc_box(region(page, chapter))
            for y in (top - 0.4 * vh + PX_TOL * 4, top + height - 0.4 * vh - PX_TOL * 4):
                y = max(0, min(y, maximum))
                if top < y + 0.4 * vh < top + height:
                    edges.append((chapter, y))
        for chapter, y in edges + list(reversed(edges)):
            scroll_to(page, y)
            eventually(page, lambda: (assert_eq(hash_of(page), f"#{chapter}"), assert_eq(current_marks(rail), [RAIL[chapter]])),
                       f"40% point at {y} names {chapter}")
            assert query(page).get("scenario") == ["on-hobby"], f"query string lost: {page.url}"
        assert page.evaluate("() => history.length") == length, "scrolling added history entries"
        scroll_into_chapter(page, "product")
        eventually(page, lambda: assert_eq(hash_of(page), "#product"), "product current")
        eventually(page, lambda: assert_eq(current_marks(rail), [RAIL["product"]]), "rail marks product")
        click(page.get_by_role("button", name="Menu", exact=True))
        menu = page.get_by_role("dialog", name="Menu").get_by_role("navigation", name="Menu chapters")
        eventually(page, lambda: assert_eq(current_marks(menu), [RAIL["product"]]), "menu marks only the current chapter")


JUMP_CASES = ["rail", "site", "menu", "opening-links", "amounts-link", "all-interviews", "address"]


@pytest.mark.parametrize("case", JUMP_CASES, ids=JUMP_CASES)
def test_chapter_jumps_land_clear_of_header(browser: Browser, app_url: str, case: str) -> None:
    restore(app_url)
    root = base(app_url)
    if case == "address":
        for path, chapter in (("/#oxygen", "oxygen"), ("/?scenario=off-rest#lifestyle", "lifestyle"), ("/#science", "science")):
            with visit(browser, root + path) as page:
                story_ready(page)
                expect_jump(page, chapter)
        return
    if case == "all-interviews":
        with visit(browser, root + "/interviews/mina-okabe") as page:
            page_ready(page)
            click(page.get_by_role("link", name="All interviews", exact=True))
            story_ready(page)
            expect_jump(page, "interviews")
        return
    size = PHONE if case == "menu" else DESKTOP
    with visit(browser, root + "/", size) as page:
        story_ready(page)
        if case == "rail":
            rail = page.get_by_role("navigation", name="Chapters", exact=True)
            for chapter in ("lifestyle", "about", "product", "opening"):
                click(rail.get_by_role("link", name=RAIL[chapter], exact=True))
                expect_jump(page, chapter)
        elif case == "site":
            site = page.get_by_role("navigation", name="Site", exact=True)
            for name, chapter in (("About", "about"), ("Science & Technology", "science"), ("Product", "product"), ("Interview", "interviews")):
                click(site.get_by_role("link", name=name, exact=True))
                expect_jump(page, chapter)
        elif case == "menu":
            for chapter in ("lifestyle", "oxygen"):
                click(page.get_by_role("button", name="Menu", exact=True))
                link = page.get_by_role("dialog", name="Menu").get_by_role("link", name=RAIL[chapter], exact=True)
                eventually(page, lambda: assert_eq(link.is_visible(), True), "menu opened")
                click(link)
                expect_jump(page, chapter)
                assert page.get_by_role("dialog", name="Menu").count() == 0, "menu stayed open after a chapter link"
        elif case == "opening-links":
            click(page.get_by_role("link", name="Begin the story", exact=True))
            expect_jump(page, "about")
            scroll_to(page, 0)
            click(page.get_by_role("link", name="See Vireo Pace", exact=True))
            expect_jump(page, "product")
        elif case == "amounts-link":
            scroll_into_chapter(page, "science", 0.1)
            click(page.get_by_role("button", name="How it becomes powder", exact=True))
            link = page.get_by_role("link", name="See the amounts per stick", exact=True)
            eventually(page, lambda: assert_eq(link.is_visible(), True), "amounts link shown")
            click(link)
            expect_jump(page, "product")


def test_chapter_jumps_by_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    rail_presses = TAB_ORDER_WIDE.index(RAIL["product"]) + 1
    with visit(browser, base(app_url) + "/") as page:
        story_ready(page)
        assert tab_order(page, rail_presses) == TAB_ORDER_WIDE[:rail_presses], "Tab order up to the 05 Product rail link"
        page.keyboard.press("Enter")
        expect_jump(page, "product")
        rail = page.get_by_role("navigation", name="Chapters", exact=True)
        eventually(page, lambda: assert_eq(current_marks(rail), [RAIL["product"]]), "rail marks Product after the keyboard jump")
    begin_presses = TAB_ORDER_WIDE.index("Begin the story") + 1
    with visit(browser, base(app_url) + "/") as page:
        story_ready(page)
        assert tab_order(page, begin_presses)[-1] == "Begin the story", "Tab order up to Begin the story"
        page.keyboard.press("Enter")
        expect_jump(page, "about")


GRADING_CASES = [
    "no-key", "wrong-key", "delete-wrong-key", "post-method", "too-large", "too-large-no-key", "too-large-not-json",
    "exact-limit", "not-json", "missing-field", "extra-field", "wrong-type", "scenario-ids", "scenario-count",
    "mode-prefix", "time-format", "slug-rule", "slug-length", "slug-duplicate", "category", "hue-range",
    "answers-empty", "answers-too-many", "interviews-empty", "interviews-too-many", "packs-empty", "sticks-range",
    "price-range", "mg-range", "ingredients-too-many", "steps-too-many", "cautions-empty", "stores-too-many",
    "store-url", "text-empty", "text-too-long", "upper-bounds", "replace-and-restore",
]


def _padded(body: dict[str, Any], size: int) -> bytes:
    raw = json.dumps(body).encode()
    assert len(raw) <= size, "seed body larger than the padding target"
    return raw + b" " * (size - len(raw))


def _interview(n: int, answers: int = 1) -> dict[str, Any]:
    return {"slug": f"person-{n}", "name": f"Person {n}", "role": "Role", "category": "everyday", "lede": "Lede.", "hue": n,
            "answers": [{"question": f"Question {k}?", "answer": "Answer."} for k in range(answers)]}


@pytest.mark.parametrize("case", GRADING_CASES, ids=GRADING_CASES)
def test_grading_route(app_url: str, case: str) -> None:
    restore(app_url)
    seed_content = content_of(seed_body(), 1)
    b = seed_body()
    status_code, expected = 422, INVALID
    raw: bytes | None = None
    key: str | None = GRADING_KEY
    method = "PUT"
    if case == "no-key":
        key, status_code, expected = None, 404, NOT_FOUND
    elif case == "wrong-key":
        key, status_code, expected = GRADING_KEY + "-wrong", 404, NOT_FOUND
    elif case == "delete-wrong-key":
        changed = seed_body()
        changed["product"]["storage"] = "Kept cool."
        assert_json(grading(app_url, "PUT", changed), 200, {"edition": 2})
        try:
            assert_json(grading(app_url, "DELETE", key=GRADING_KEY + "-wrong"), 404, NOT_FOUND)
            assert_json(grading(app_url, "DELETE", key=None), 404, NOT_FOUND)
            assert_json(api(app_url, "GET", "/api/content"), 200, content_of(changed, 2))
        finally:
            restore(app_url)
        return
    elif case == "post-method":
        assert_json(api(app_url, "POST", "/api/grading/content", body=b, headers={"X-Grading-Key": GRADING_KEY}), 404, NOT_FOUND)
        assert_json(api(app_url, "GET", "/api/content"), 200, seed_content)
        return
    elif case == "too-large":
        raw, status_code, expected = _padded(b, BODY_LIMIT + 1), 413, TOO_LARGE
    elif case == "too-large-no-key":
        raw, key, status_code, expected = _padded(b, BODY_LIMIT + 1), None, 404, NOT_FOUND
    elif case == "too-large-not-json":
        raw, status_code, expected = b"{" * (BODY_LIMIT + 1), 413, TOO_LARGE
    elif case == "exact-limit":
        b["product"]["storage"] = "Kept at the limit."
        raw, status_code, expected = _padded(b, BODY_LIMIT), 200, {"edition": 2}
    elif case == "not-json":
        raw = b"{not json"
    elif case == "missing-field":
        del b["product"]["storage"]
    elif case == "extra-field":
        b["scenarios"][0]["colour"] = "green"
    elif case == "wrong-type":
        b["interviews"][0]["hue"] = "150"
    elif case == "scenario-ids":
        b["scenarios"][7]["id"] = UNKNOWN_SCENARIO
    elif case == "scenario-count":
        b["scenarios"].pop()
    elif case == "mode-prefix":
        b["scenarios"][0]["mode"] = "off"
    elif case == "time-format":
        b["scenarios"][0]["time"] = "24:00"
    elif case == "slug-rule":
        b["interviews"][0]["slug"] = "9-lives"
    elif case == "slug-length":
        b["interviews"][0]["slug"] = "a"
    elif case == "slug-duplicate":
        b["interviews"][1]["slug"] = b["interviews"][0]["slug"]
    elif case == "category":
        b["interviews"][0]["category"] = "guest"
    elif case == "hue-range":
        b["interviews"][0]["hue"] = HUE_MAX + 1
    elif case == "answers-empty":
        b["interviews"][0]["answers"] = []
    elif case == "answers-too-many":
        b["interviews"][0]["answers"] = b["interviews"][0]["answers"] * ANSWERS_MAX
    elif case == "interviews-empty":
        b["interviews"] = []
    elif case == "interviews-too-many":
        b["interviews"] = [_interview(n) for n in range(INTERVIEWS_MAX + 1)]
    elif case == "packs-empty":
        b["product"]["packs"] = []
    elif case == "sticks-range":
        b["product"]["packs"][0]["sticks"] = STICKS_MAX + 1
    elif case == "price-range":
        b["product"]["packs"][0]["price_yen"] = PRICE_MAX + 1
    elif case == "mg-range":
        b["product"]["ingredients"][0]["mg"] = MG_MAX + 1
    elif case == "ingredients-too-many":
        b["product"]["ingredients"] = [{"name": f"Part {n}", "mg": n + 1} for n in range(INGREDIENTS_MAX + 1)]
    elif case == "steps-too-many":
        b["product"]["how_to_use"] = [f"Step {n}." for n in range(STEPS_MAX + 1)]
    elif case == "cautions-empty":
        b["product"]["cautions"] = []
    elif case == "stores-too-many":
        b["product"]["stores"] = [{"name": f"Shop {n}", "url": f"https://shop{n}.example/"} for n in range(STORES_MAX + 1)]
    elif case == "store-url":
        b["product"]["stores"][0]["url"] = "http://store.alderquay.example/vireo-pace"
    elif case == "text-empty":
        b["product"]["storage"] = ""
    elif case == "text-too-long":
        b["product"]["storage"] = "x" * (TEXT_MAX + 1)
    elif case == "upper-bounds":
        b["interviews"] = [_interview(n, ANSWERS_MAX) for n in range(INTERVIEWS_MAX)]
        b["interviews"][0]["slug"] = "a" + "b" * (SLUG_MAX - 1)
        b["interviews"][0]["hue"] = HUE_MAX
        b["product"]["packs"] = [{"sticks": STICKS_MAX, "price_yen": PRICE_MAX}] * PACKS_MAX
        b["product"]["ingredients"] = [{"name": f"Part {n}", "mg": MG_MAX} for n in range(INGREDIENTS_MAX)]
        b["product"]["how_to_use"] = [f"Step {n}." for n in range(STEPS_MAX)]
        b["product"]["cautions"] = [f"Caution {n}." for n in range(CAUTIONS_MAX)]
        b["product"]["stores"] = [{"name": f"Shop {n}", "url": f"https://shop{n}.example/"} for n in range(STORES_MAX)]
        b["product"]["storage"] = "y" * TEXT_MAX
        status_code, expected = 200, {"edition": 2}
    elif case == "replace-and-restore":
        b["product"]["name"] = f"Pace {tag()}"
        b["interviews"] = b["interviews"][:2]
        status_code, expected = 200, {"edition": 2}
    try:
        resp = grading(app_url, method, b if raw is None else None, raw=raw, key=key)
        assert_json(resp, status_code, expected)
        after = assert_json(api(app_url, "GET", "/api/content"), 200)
        if status_code == 200:
            assert after == content_of(b, 2), "the whole record was not replaced"
            assert_json(grading(app_url, "DELETE"), 200, {"edition": 1})
            assert_json(api(app_url, "GET", "/api/content"), 200, seed_content)
        else:
            assert after == seed_content, f"a rejected {case} request changed the stored record"
    finally:
        restore(app_url)


def test_wf_about_story_wide_scroll_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#about") as page:
        story_ready(page)
        record_announcements(page)
        about = region(page, "about")
        top, height = doc_box(about)
        travel = height - page.viewport_size["height"]
        for fraction, panel in ((0.1, "1"), (0.5, "2"), (0.9, "3"), (0.5, "2"), (0.1, "1")):
            scroll_to(page, top + fraction * travel)
            eventually(page, lambda: assert_eq(about_state(page)["panel"], panel), f"panel {panel} at {fraction}")
        assert said(page) == [], "scrolling alone announced something"
        scroll_to(page, top)
        nxt = about.get_by_role("button", name="Next panel", exact=True)
        nxt.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "2"), "Next panel reaches panel 2")
        page.keyboard.press("Space")
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "3"), "Next panel reaches panel 3")
        expect_said(page, ["Panel 2 of 3: Recovery.", "Panel 3 of 3: One pace."], "each panel button change announced once")
        assert_focused(about.get_by_role("button", name="Previous panel", exact=True), "focus moves to Previous panel at the end")
    assert_json(api(app_url, "GET", "/api/content"), 200)


def test_wf_about_story_phone_swipe(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#about", PHONE, touch=True) as page:
        story_ready(page)
        record_announcements(page)
        about = region(page, "about")
        track = about.locator("[data-track]")
        swipe(page, track, -panel_swipe(page))
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "2"), "swipe moves to panel 2")
        swipe(page, track, -panel_swipe(page))
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "3"), "swipe moves to panel 3")
        expect_said(page, ["Panel 2 of 3: Recovery.", "Panel 3 of 3: One pace."], "each swipe announced once")
        assert page.evaluate("() => window.scrollX") == 0, "the page moved sideways"
        layout(page)


ABOUT_STEPS = [(0, "0.00", "1"), (8, "0.01", "1"), (399, "0.25", "1"), (400, "0.25", "2"), (800, "0.50", "2"),
               (1199, "0.75", "2"), (1200, "0.75", "3"), (1600, "1.00", "3"), (2000, "1.00", "3")]


def test_inner_pace_scroll_formula(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#about") as page:
        story_ready(page)
        about = region(page, "about")
        top, height = doc_box(about)
        vh = page.viewport_size["height"]
        assert abs(height - ABOUT_VIEWPORTS * vh) <= PX_TOL, f"About is {height} px tall, expected {ABOUT_VIEWPORTS} viewports"
        travel = height - vh
        scroll_to(page, top)
        eventually(page, lambda: assert_eq(about_state(page)["progress"], "0.00"), "progress at the chapter top")
        left0 = track_left(page)
        panel_w = page.evaluate("() => document.querySelector('[data-track]').scrollWidth / 3")
        held_tops: list[float] = []
        for offset, progress, panel in ABOUT_STEPS + list(reversed(ABOUT_STEPS)):
            scroll_to(page, top + offset)
            eventually(page, lambda: assert_eq(about_state(page), {"panel": panel, "progress": progress}), f"About at {offset} px")
            p = min(1.0, max(0.0, offset / travel))
            moved = left0 - track_left(page)
            assert abs(moved - p * 2 * panel_w) <= PX_TOL, f"track moved {moved} px at p={p}, expected {p * 2 * panel_w}"
            if offset <= travel:
                held_tops.append(page.evaluate("() => document.querySelector('[data-track]').getBoundingClientRect().top"))
        inner = held_tops
        assert max(inner) - min(inner) <= PX_TOL, f"the About stage was not held in view: track tops {inner}"
        assert 0 <= min(inner) < vh
    with visit(browser, base(app_url) + "/#about", TABLET) as page:
        story_ready(page)
        about = region(page, "about")
        top, height = doc_box(about)
        vh = page.viewport_size["height"]
        assert abs(height - ABOUT_VIEWPORTS * vh) <= PX_TOL
        scroll_to(page, top + (height - vh) / 2)
        eventually(page, lambda: assert_eq(about_state(page), {"panel": "2", "progress": "0.50"}), "About is held at 768x1024")


def test_panel_buttons(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#about") as page:
        story_ready(page)
        about = region(page, "about")
        top, height = doc_box(about)
        travel = height - page.viewport_size["height"]
        scroll_to(page, top)
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "1"), "panel 1 at the top")
        record_announcements(page)
        prev = about.get_by_role("button", name="Previous panel", exact=True)
        nxt = about.get_by_role("button", name="Next panel", exact=True)
        assert prev.is_disabled() and not nxt.is_disabled()
        steps = [(nxt, 2, "0.50", nxt), (nxt, 3, "1.00", prev), (prev, 2, "0.50", prev), (prev, 1, "0.00", nxt)]
        expected: list[str] = []
        for button, k, progress, focused in steps:
            button.focus()
            page.keyboard.press("Enter")
            target = top + (k - 1) / 2 * travel
            advance(page, FRAME_MS)
            poll(page, "([y, tol]) => Math.abs(window.scrollY - y) <= tol", [target, PX_TOL], FRAME_MS / 1000 + 1,
                 f"panel button jumps without scroll motion to panel {k}")
            eventually(page, lambda: assert_eq(about_state(page), {"panel": str(k), "progress": progress}), f"panel {k}")
            assert f"{k} / 3" in flat(about.text_content() or ""), f"counter does not read {k} / 3"
            expected.append(f"Panel {k} of 3: {INNER_PANELS[k - 1][0]}.")
            assert_focused(focused, f"focus after reaching panel {k}")
        assert prev.is_disabled() and not nxt.is_disabled()
        expect_said(page, expected, "panel buttons announce the panel reached once")


ROW_CASES = ["375x812-touch", "1280x800-reduced"]


@pytest.mark.parametrize("case", ROW_CASES, ids=ROW_CASES)
def test_inner_pace_row(browser: Browser, app_url: str, case: str) -> None:
    restore(app_url)
    reduced = case.endswith("reduced")
    size = DESKTOP if reduced else PHONE
    with visit(browser, base(app_url) + "/#about", size, reduced=reduced, touch=True) as page:
        story_ready(page)
        about = region(page, "about")
        assert about.get_attribute("data-progress") is None, "a row carries no data-progress"
        _, height = doc_box(about)
        assert height < ABOUT_VIEWPORTS * page.viewport_size["height"] - PX_TOL, "the About chapter is still three viewports tall"
        record_announcements(page)
        start = row_state(page)
        nxt = about.get_by_role("button", name="Next panel", exact=True)
        nxt.focus()
        page.keyboard.press("Enter")
        advance(page, FRAME_MS if reduced else ROW_BUTTON_MS)
        target = start["offset"] + start["panel"]
        deadline = time.monotonic() + (FRAME_MS if reduced else ROW_BUTTON_MS) / 1000 + 0.2
        while time.monotonic() < deadline and abs(row_state(page)["offset"] - target) > PX_TOL:
            pass
        assert abs(row_state(page)["offset"] - target) <= PX_TOL, f"Next panel did not move the row one panel in time: {row_state(page)}"
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "2"), "row at panel 2")
        assert_focused(nxt, "focus stays on Next panel")
        swipe(page, about.locator("[data-track]"), -panel_swipe(page))
        eventually(page, lambda: (assert_eq(about_state(page)["panel"], "3"),
                                  assert_eq(abs(row_state(page)["offset"] - (start["offset"] + 2 * start["panel"])) <= PX_TOL, True)),
                   "a swipe snaps the row to panel 3")
        swipe(page, about.locator("[data-track]"), panel_swipe(page))
        eventually(page, lambda: (assert_eq(about_state(page)["panel"], "2"),
                                  assert_eq(abs(row_state(page)["offset"] - target) <= PX_TOL, True)),
                   "a swipe back snaps the row to panel 2")
        expect_said(page, ["Panel 2 of 3: Recovery.", "Panel 3 of 3: One pace.", "Panel 2 of 3: Recovery."], "button and swipe changes announced once")
        assert row_state(page)["pageX"] == 0, "the page scrolled sideways"


def oxygen_tabs(page: Page) -> Locator:
    return page.get_by_role("tablist", name="Oxygen stages", exact=True)


def stage_state(page: Page) -> dict[str, Any]:
    r = region(page, "oxygen")
    return {"stage": r.get_attribute("data-stage"), "progress": r.get_attribute("data-progress")}


def test_wf_oxygen_stages_scroll_tabs(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#oxygen") as page:
        story_ready(page)
        record_announcements(page)
        oxy = region(page, "oxygen")
        top, height = doc_box(oxy)
        travel = height - page.viewport_size["height"]
        names = [s[0] for s in STAGES]
        xs = []
        for k in range(1, STAGE_COUNT + 1):
            scroll_to(page, top + (k - 0.5) / STAGE_COUNT * travel)
            eventually(page, lambda: (assert_eq(stage_state(page)["stage"], str(k)), assert_eq(selected_tab(oxygen_tabs(page), names), [names[k - 1]])),
                       f"stage {k} by scroll")
            xs.append(dot_x(page))
        assert xs == sorted(xs) and len(set(xs)) == len(xs), f"the dot did not advance with the stages: {xs}"
        assert said(page) == [], "scrolling announced a stage"
        tab = oxygen_tabs(page).get_by_role("tab", name="ATP", exact=True)
        tab.focus()
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: assert_eq(stage_state(page)["stage"], "4"), "ArrowLeft selects Mitochondria")
        assert abs(dot_x(page) - xs[3]) <= PX_TOL, "the dot is not at the chosen stage"
        expect_said(page, ["Stage 4 of 5: Mitochondria use it."], "stage tab announced once")
        assert_focused(oxygen_tabs(page).get_by_role("tab", name="Mitochondria", exact=True), "focus stays on the tab")
    assert_json(api(app_url, "GET", "/api/content"), 200)


def test_wf_oxygen_stages_phone(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#oxygen", PHONE, touch=True) as page:
        story_ready(page)
        record_announcements(page)
        xs = []
        expected = []
        for k, (name, title, text) in enumerate(STAGES, start=1):
            tap(oxygen_tabs(page).get_by_role("tab", name=name, exact=True))
            eventually(page, lambda: assert_eq(stage_state(page)["stage"], str(k)), f"tap {name}")
            panel = region(page, "oxygen").get_by_role("tabpanel")
            assert title in flat(panel.text_content() or "") and text in flat(panel.text_content() or "")
            xs.append(dot_x(page))
            expected.append(f"Stage {k} of 5: {title}.")
        assert xs == sorted(xs) and len(set(xs)) == len(xs), f"dot positions {xs}"
        expect_said(page, expected, "each tapped stage announced once")


OXYGEN_STEPS = [(0, "0.00", "1"), (639, "0.20", "1"), (640, "0.20", "2"), (1000, "0.31", "2"), (1600, "0.50", "3"),
                (2400, "0.75", "4"), (2559, "0.80", "4"), (3200, "1.00", "5"), (3600, "1.00", "5")]


def test_oxygen_scroll_formula(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#oxygen") as page:
        story_ready(page)
        record_announcements(page)
        oxy = region(page, "oxygen")
        top, height = doc_box(oxy)
        vh = page.viewport_size["height"]
        assert abs(height - OXYGEN_VIEWPORTS * vh) <= PX_TOL, f"Oxygen & Energy is {height} px tall"
        names = [s[0] for s in STAGES]
        for steps in (OXYGEN_STEPS, list(reversed(OXYGEN_STEPS))):
            xs = []
            for offset, progress, stage in steps:
                scroll_to(page, top + offset)
                eventually(page, lambda: (assert_eq(stage_state(page), {"stage": stage, "progress": progress}),
                                          assert_eq(selected_tab(oxygen_tabs(page), names), [names[int(stage) - 1]])),
                           f"oxygen at {offset} px")
                if offset <= height - vh:
                    dot = page.locator("[data-dot]").bounding_box()
                    assert dot and 0 <= dot["y"] <= vh, "the dot left the view while the chapter is held"
                xs.append(dot_x(page))
            pairs = list(zip(steps, xs))
            for (a, xa), (b, xb) in zip(pairs, pairs[1:]):
                pa, pb = min(1, a[0] / (height - vh)), min(1, b[0] / (height - vh))
                if pb > pa:
                    assert xb > xa, f"dot moved back while scrolling forward ({a[0]} -> {b[0]})"
                elif pb < pa:
                    assert xb < xa, f"dot moved forward while scrolling back ({a[0]} -> {b[0]})"
                else:
                    assert abs(xb - xa) <= PX_TOL
        assert said(page) == [], "scrolling announced a stage"


def test_oxygen_tabs_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#oxygen") as page:
        story_ready(page)
        oxy = region(page, "oxygen")
        top, height = doc_box(oxy)
        travel = height - page.viewport_size["height"]
        tabs = oxygen_tabs(page)
        breath = tabs.get_by_role("tab", name="Breath", exact=True)
        breath.focus()
        scroll_to(page, top)
        eventually(page, lambda: assert_eq(stage_state(page)["stage"], "1"), "stage 1 at the chapter top")
        stops = [n for n, *_ in STAGES if tabs.get_by_role("tab", name=n, exact=True).evaluate("(e) => e.tabIndex") >= 0]
        assert stops == ["Breath"], f"Tab stops in the tablist: {stops}"
        record_announcements(page)
        expected = []
        for key, k in (("ArrowRight", 2), ("ArrowLeft", 1), ("ArrowLeft", 5), ("ArrowRight", 1), ("End", 5), ("Home", 1)):
            page.keyboard.press(key)
            target = top + (k - 0.5) / STAGE_COUNT * travel
            advance(page, FRAME_MS)
            poll(page, "([y, tol]) => Math.abs(window.scrollY - y) <= tol", [target, PX_TOL], 1, f"{key} jumps to stage {k}")
            eventually(page, lambda: assert_eq(stage_state(page)["stage"], str(k)), f"{key} selects stage {k}")
            tab = tabs.get_by_role("tab", name=STAGES[k - 1][0], exact=True)
            assert tab.get_attribute("aria-selected") == "true"
            assert_focused(tab, f"focus stays on {STAGES[k - 1][0]}")
            expected.append(f"Stage {k} of 5: {STAGES[k - 1][1]}.")
        click(tabs.get_by_role("tab", name="Cell", exact=True))
        eventually(page, lambda: assert_eq(stage_state(page)["stage"], "3"), "a click selects Cell")
        assert abs(scroll_y(page) - (top + 0.5 * travel)) <= PX_TOL
        expected.append("Stage 3 of 5: Oxygen enters the cell.")
        expect_said(page, expected, "each stage choice announced once")
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement.getAttribute('role')") == "tabpanel", "Tab does not move into the tab panel"
        assert STAGES[2][1] in flat(oxy.get_by_role("tabpanel").text_content() or "")


NOT_PINNED_CASES = ["375x812", "1280x800-reduced"]


@pytest.mark.parametrize("case", NOT_PINNED_CASES, ids=NOT_PINNED_CASES)
def test_oxygen_not_pinned(browser: Browser, app_url: str, case: str) -> None:
    restore(app_url)
    reduced = case.endswith("reduced")
    with visit(browser, base(app_url) + "/#oxygen", DESKTOP if reduced else PHONE, reduced=reduced) as page:
        story_ready(page)
        oxy = region(page, "oxygen")
        assert oxy.get_attribute("data-progress") is None
        tabs = oxygen_tabs(page)
        top, height = doc_box(oxy)
        scroll_to(page, top)
        advance(page, FRAME_MS)
        before = tabs.bounding_box()
        scroll_to(page, top + height / 4)
        advance(page, FRAME_MS)
        after = tabs.bounding_box()
        assert before and after and before["y"] - after["y"] > PX_TOL, "the oxygen chapter is still held in view"
        click(tabs.get_by_role("tab", name="Mitochondria", exact=True))
        eventually(page, lambda: assert_eq(stage_state(page)["stage"], "4"), "tab chooses stage 4")
        scroll_to(page, top + height * 0.9)
        advance(page, SETTLE_MS)
        assert stage_state(page)["stage"] == "4", "scrolling changed the stage"
        xs = []
        for name, *_ in STAGES:
            click(tabs.get_by_role("tab", name=name, exact=True))
            eventually(page, lambda: assert_eq(tabs.get_by_role("tab", name=name, exact=True).get_attribute("aria-selected"), "true"), name)
            advance(page, SETTLE_MS)
            xs.append(dot_x(page))
        assert xs == sorted(xs) and len(set(xs)) == len(xs), f"the dot does not sit at each stage's point: {xs}"


def test_wf_science_ingredients_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#science") as page:
        story_ready(page)
        sci = region(page, "science")
        powder = sci.get_by_role("button", name="How it becomes powder", exact=True)
        powder.focus()
        page.keyboard.press("Tab")
        assert page.evaluate("() => document.activeElement.textContent.trim()") != "See the amounts per stick", "collapsed link took focus"
        for name, text in DISCLOSURES[:2]:
            sci.get_by_role("button", name=name, exact=True).focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: assert_eq(page.get_by_text(text, exact=True).is_visible(), True), f"{name} opens")
        slider = sci.get_by_role("slider", name="Nitrate pathway", exact=True)
        slider.focus()
        for value in (2, 3):
            page.keyboard.press("ArrowRight")
            eventually(page, lambda: assert_eq(slider.get_attribute("aria-valuetext"), NITRATE_STEPS[value - 1][0]), f"step {value}")
        assert flat(sci.text_content() or "").count(notice(PRODUCT_NAME)) == 1, "Science lacks the exact not-a-medicine notice"
        powder.focus()
        page.keyboard.press("Space")
        link = sci.get_by_role("link", name="See the amounts per stick", exact=True)
        eventually(page, lambda: assert_eq(link.is_visible(), True), "amounts link shown")
        link.focus()
        page.keyboard.press("Enter")
        expect_jump(page, "product")
    product = assert_json(api(app_url, "GET", "/api/content"), 200)["product"]
    assert product["ingredients"][0]["name"] == SEED_PRODUCT["ingredients"][0]["name"]


def test_wf_science_ingredients_phone(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#science", PHONE, touch=True) as page:
        story_ready(page)
        sci = region(page, "science")
        slider = sci.get_by_role("slider", name="Nitrate pathway", exact=True)
        slider.scroll_into_view_if_needed()
        settled(slider)
        b = slider.bounding_box()
        assert b
        page.mouse.move(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        page.mouse.down()
        page.mouse.move(page.viewport_size["width"] - 1, b["y"] + b["height"] / 2, steps=8)
        page.mouse.up()
        eventually(page, lambda: assert_eq(slider.get_attribute("aria-valuetext"), "Nitric oxide"), "drag right sets Nitric oxide")
        assert page.locator("[data-step]").get_attribute("data-step") == "3"
        tap(sci.get_by_role("button", name="How it becomes powder", exact=True))
        link = sci.get_by_role("link", name="See the amounts per stick", exact=True)
        eventually(page, lambda: assert_eq(link.is_visible(), True), "amounts link shown")
        tap(link)
        expect_jump(page, "product")
        layout(page)


def test_disclosures_collapsed_unavailable(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for size in VIEWPORTS.values():
        with visit(browser, base(app_url) + "/#science", size) as page:
            story_ready(page)
            sci = region(page, "science")
            for name, text in DISCLOSURES:
                button = sci.get_by_role("button", name=name, exact=True)
                assert button.get_attribute("aria-expanded") == "false", f"{name} does not start collapsed"
                assert not page.get_by_text(text, exact=True).is_visible(), f"{name} text visible while collapsed"
                assert text not in sci.aria_snapshot(), f"{name} text exposed while collapsed"
            assert sci.get_by_role("link", name="See the amounts per stick", exact=True).count() == 0
            names = tab_order(page, len(TAB_ORDER_WIDE) + 40)
            assert "See the amounts per stick" not in names, "the collapsed amounts link is a Tab stop"
            for name, text in DISCLOSURES:
                button = sci.get_by_role("button", name=name, exact=True)
                for action, expanded in (("Enter", "true"), ("Space", "false"), ("click", "true")):
                    if action == "click":
                        click(button)
                    else:
                        button.focus()
                        page.keyboard.press(action)
                    eventually(page, lambda: assert_eq(button.get_attribute("aria-expanded"), expanded), f"{name} {action}")
                    visible = page.get_by_text(text, exact=True).is_visible()
                    assert visible == (expanded == "true"), f"{name} visibility after {action}"
                    assert (text in sci.aria_snapshot()) == (expanded == "true"), f"{name} accessibility after {action}"


def test_nitrate_slider(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#science") as page:
        story_ready(page)
        sci = region(page, "science")
        slider = sci.get_by_role("slider", name="Nitrate pathway", exact=True)
        diagram = sci.get_by_role("img", name="Nitrate pathway diagram", exact=True)

        def expect_value(v: int, what: str) -> None:
            def check() -> None:
                assert slider.get_attribute("aria-valuetext") == NITRATE_STEPS[v - 1][0]
                assert diagram.get_attribute("data-step") == str(v)
                for n, (_, text) in enumerate(NITRATE_STEPS, start=1):
                    shown = page.get_by_text(text, exact=True)
                    assert (shown.count() > 0 and shown.first.is_visible()) == (n == v), f"step text {n} shown={n == v} expected"
            eventually(page, check, what)

        expect_value(1, "slider starts at 1")
        slider.focus()
        for key, v in (("ArrowRight", 2), ("ArrowUp", 3), ("ArrowRight", 3), ("ArrowLeft", 2), ("ArrowDown", 1),
                       ("ArrowDown", 1), ("End", 3), ("Home", 1)):
            page.keyboard.press(key)
            expect_value(v, f"{key} gives {v}")
        b = slider.bounding_box()
        assert b
        y = b["y"] + b["height"] / 2
        for x_end, v in ((page.viewport_size["width"] - 1, 3), (1, 1)):
            page.mouse.move(b["x"] + b["width"] / 2, y)
            page.mouse.down()
            page.mouse.move(x_end, y, steps=10)
            page.mouse.up()
            expect_value(v, f"drag to x={x_end} gives {v}")
            b = slider.bounding_box()
            assert b


def test_not_a_medicine_notice(browser: Browser, app_url: str) -> None:
    body = seed_body()
    name = f"Pace Leaf {tag()}"
    body["product"]["name"] = name
    with published(app_url, body):
        with visit(browser, base(app_url) + "/#product") as page:
            story_ready(page)
            text = notice(name)
            eventually(page, lambda: assert_eq(flat(region(page, "science").text_content() or "").count(text), 1), "Science notice")
            click(page.get_by_role("tablist", name="Product information").get_by_role("tab", name="Ingredients", exact=True))
            panel = region(page, "product", name).get_by_role("tabpanel")
            eventually(page, lambda: assert_eq(text in flat(panel.text_content() or ""), True), "Ingredients notice")
            assert notice(PRODUCT_NAME) not in flat(page.content()), "the page still carries the seed notice"
        sheet = api(app_url, "GET", "/api/product/sheet")
        assert sheet.status_code == 200
        assert text in flat(pdf_text(sheet.content)), "the sheet lacks the exact notice"


def test_wf_product_sheet_publish_download(browser: Browser, app_url: str) -> None:
    t = tag()
    body = seed_body()
    body["product"]["name"] = f"Pace Harbour {t}"
    body["product"]["packs"] = [{"sticks": 21, "price_yen": 2750}]
    body["product"]["ingredients"][0] = {"name": f"Beet blend {t}", "mg": 3200}
    with published(app_url, body) as edition:
        with visit(browser, base(app_url) + "/#product") as page:
            story_ready(page)
            product = region(page, "product", body["product"]["name"])
            eventually(page, lambda: assert_eq(product.get_by_text(f"Content edition {edition}", exact=True).count(), 1), "edition 2 shows")
            assert pack_line(body["product"]["packs"][0]) in flat(product.text_content() or "")
            button = sheet_button(page)
            data = download_sheet(page, lambda: click(button))
            assert_in_order(pdf_text(data), sheet_items(body["product"], edition), "downloaded sheet")
            page.goto(base(app_url) + "/store")
            page_ready(page)
            eventually(page, lambda: assert_eq(page.get_by_text(f"{body['product']['name']}, 21 sticks", exact=True).count(), 1), "store shows the new pack")
            assert page.get_by_text(f"Content edition {edition}", exact=True).count() == 1
        assert assert_json(api(app_url, "GET", "/api/content"), 200)["product"] == body["product"]


def test_wf_product_sheet_outage(browser: Browser, app_url: str) -> None:
    root = down_url()
    with visit(browser, root + "/#product") as page:
        story_ready(page)
        button = sheet_button(page)
        button.focus()
        page.keyboard.press("Enter")
        alert = page.get_by_role("alert").filter(has_text=SHEET_503["message"])
        eventually(page, lambda: assert_eq((alert.text_content() or "").strip(), SHEET_503["message"]), "outage alert shows", seconds=HTTP_TIMEOUT_S)
        assert_focused(button, "focus stays on the download button")
        assert button.get_attribute("aria-disabled") != "true"
        choose(mode_radio(page, "OFF"))
        expect_scenario(page, "off-break")
        page.goto(root + "/interviews/mina-okabe")
        page_ready(page)
        assert page.get_by_role("heading", level=1, name="Mina Okabe", exact=True).count() == 1
    assert_json(httpx.get(root + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "unavailable"})


def test_product_sheet_pdf(app_url: str) -> None:
    restore(app_url)
    resp = api(app_url, "GET", "/api/product/sheet")
    assert resp.status_code == 200, resp.text[:300]
    assert resp.headers.get("content-type", "").split(";")[0].strip() == "application/pdf"
    assert resp.headers.get("content-disposition") == f'attachment; filename="{SHEET_FILENAME}"'
    assert pdf_pages(resp.content) >= 1
    text = pdf_text(resp.content)
    assert_in_order(text, sheet_items(SEED_PRODUCT, 1), "seed sheet")
    assert flat(text).endswith("Content edition 1"), "the edition line is not the last line"
    body = seed_body()
    body["product"]["name"] = f"Pace Tide {tag()}"
    body["product"]["cautions"] = ["Keep out of reach of children."]
    with published(app_url, body) as edition:
        fresh = api(app_url, "GET", "/api/product/sheet")
        assert fresh.status_code == 200
        assert_in_order(pdf_text(fresh.content), sheet_items(body["product"], edition), "republished sheet")
    again = api(app_url, "GET", "/api/product/sheet")
    assert SEED_PRODUCT["name"] + " product information" in flat(pdf_text(again.content))
    assert body["product"]["name"] not in flat(pdf_text(again.content)), "the sheet was served from a cache"


def test_sheet_pending_and_ready(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product") as page:
        story_ready(page)
        record_announcements(page)
        button = sheet_button(page)
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/api/product/sheet" in r.url else None)
        with held(page, "**/api/product/sheet*") as hold:
            button.focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: (assert_eq(button.get_attribute("aria-disabled"), "true"),
                                      assert_eq(status_text(page), "Preparing the product sheet.")), "pending state")
            page.keyboard.press("Enter")
            pending = button.bounding_box()
            assert pending, "the download button has no box while pending"
            page.mouse.click(pending["x"] + pending["width"] / 2, pending["y"] + pending["height"] / 2)
            advance(page, SETTLE_MS)
            assert len(sent) == 1, f"a press while pending sent another request: {sent}"
            data = download_sheet(page, hold.release)
        assert "Vireo Pace product information" in flat(pdf_text(data))
        assert button.get_attribute("aria-disabled") != "true"
        assert_focused(button, "focus stays on the download button")
        expect_said(page, ["Preparing the product sheet.", "Product sheet ready."], "pending and ready announced once each")


def test_sheet_outage_answers(browser: Browser, app_url: str) -> None:
    root = down_url()
    sheet = httpx.get(root + "/api/product/sheet", timeout=HTTP_TIMEOUT_S)
    assert_json(sheet, 503, SHEET_503)
    assert_json(httpx.get(root + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "unavailable"})
    assert_json(httpx.get(root + "/api/content", timeout=HTTP_TIMEOUT_S), 200)
    assert_json(httpx.get(root + "/api/scenarios/off-rest", timeout=HTTP_TIMEOUT_S), 200)
    assert_json(httpx.get(root + "/api/interviews/kenji-mori", timeout=HTTP_TIMEOUT_S), 200)
    assert httpx.get(root + "/store", timeout=HTTP_TIMEOUT_S).status_code == 200
    with visit(browser, root + "/#product") as page:
        story_ready(page)
        button = sheet_button(page)
        alert = page.get_by_role("alert").filter(has_text=SHEET_503["message"])
        click(button)
        eventually(page, lambda: assert_eq(alert.count(), 1), "alert shows", seconds=HTTP_TIMEOUT_S)
        with held(page, "**/api/product/sheet*") as hold:
            click(button)
            eventually(page, lambda: assert_eq(alert.count(), 0), "the next press removes the alert")
            hold.release()
        eventually(page, lambda: assert_eq(alert.count(), 1), "the alert returns after the next failure", seconds=HTTP_TIMEOUT_S)


@pytest.mark.timeout(900)
def test_sheet_recovers_without_restart(app_url: str) -> None:
    gotenberg = os.environ.get("GOTENBERG_URL")
    if not gotenberg or not os.environ.get("DATABASE_URL"):
        pytest.fail("GOTENBERG_URL and DATABASE_URL must be set in the verifier to boot an app copy")
    restore(app_url)
    target = urlparse(gotenberg)
    relay = Relay(target.hostname or "127.0.0.1", target.port or (443 if target.scheme == "https" else 80))
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), GOTENBERG_URL=f"http://127.0.0.1:{relay.port}")
    log_path = Path(tempfile.mkdtemp()) / "copy.log"
    with open(log_path, "wb") as log:
        proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    root = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + BOOT_S
        booted = False
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}:\n{log_tail(log_path)}")
            try:
                if httpx.get(root + "/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200:
                    booted = True
                    break
            except httpx.HTTPError:
                pass
        if not booted:
            pytest.fail(f"app copy did not answer /api/health with Gotenberg down:\n{log_tail(log_path)}")
        assert_json(httpx.get(root + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "unavailable"})
        assert_json(httpx.get(root + "/api/product/sheet", timeout=HTTP_TIMEOUT_S), 503, SHEET_503)
        assert httpx.get(root + "/", timeout=HTTP_TIMEOUT_S).status_code == 200
        relay.mode = "slow"
        assert_json(httpx.get(root + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "unavailable"})
        started = time.monotonic()
        slow = httpx.get(root + "/api/product/sheet", timeout=SHEET_TIMEOUT_S + SLOW_MARGIN_S + HTTP_TIMEOUT_S)
        elapsed = time.monotonic() - started
        assert_json(slow, 503, SHEET_503)
        assert elapsed <= SHEET_TIMEOUT_S + SLOW_MARGIN_S, f"a slow Gotenberg held the sheet for {elapsed:.1f} s"
        relay.mode = "up"
        first = httpx.get(root + "/api/product/sheet", timeout=HTTP_TIMEOUT_S)
        assert first.status_code == 200, f"first sheet after Gotenberg returned: {first.status_code} {first.text[:200]}\n{log_tail(log_path)}"
        assert pdf_pages(first.content) >= 1
        assert "Vireo Pace product information" in flat(pdf_text(first.content))
        assert_json(httpx.get(root + "/api/health", timeout=HTTP_TIMEOUT_S), 200, {"status": "ok"})
        assert proc.poll() is None, "the copy restarted or exited"
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        relay.stop()


def info_tabs(page: Page) -> Locator:
    return page.get_by_role("tablist", name="Product information", exact=True)


def test_wf_product_keyboard_tabs_pack_sheet(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product") as page:
        story_ready(page)
        record_announcements(page)
        product = region(page, "product")
        tabs = info_tabs(page)
        tabs.get_by_role("tab", name="Details", exact=True).focus()
        for key, name, sample in (("ArrowRight", "Ingredients", amount(3000)), ("ArrowRight", "How to use", SEED_PRODUCT["how_to_use"][0])):
            page.keyboard.press(key)
            eventually(page, lambda: assert_eq(sample in flat(product.get_by_role("tabpanel").text_content() or ""), True), f"{name} panel")
        radios = page.get_by_role("radiogroup", name="Pack view", exact=True)
        radios.get_by_role("radio", name="Front", exact=True).focus()
        for key, view in (("ArrowRight", "side"), ("ArrowRight", "back"), ("ArrowRight", "front")):
            page.keyboard.press(key)
            eventually(page, lambda: assert_eq(product.get_by_role("img", name=f"{PRODUCT_NAME} pack, {view} view", exact=True).count(), 1), view)
        button = sheet_button(page)
        button.focus()
        data = download_sheet(page, lambda: page.keyboard.press("Enter"))
        assert_focused(button, "focus stays on the download button")
        expect_said(page, ["Showing the side of the pack.", "Showing the back of the pack.", "Showing the front of the pack.",
                           "Preparing the product sheet.", "Product sheet ready."], "each product result announced once")
    content = assert_json(api(app_url, "GET", "/api/content"), 200)
    assert_in_order(pdf_text(data), sheet_items(content["product"], content["edition"]), "keyboard sheet")


def test_wf_product_keyboard_store(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product") as page:
        story_ready(page)
        link = page.get_by_role("link", name="Visit the online store", exact=True)
        link.focus()
        page.keyboard.press("Enter")
        page.wait_for_url(re.compile(r"/store$"))
        page_ready(page)
        content = assert_json(api(app_url, "GET", "/api/content"), 200)
        for pack in content["product"]["packs"]:
            eventually(page, lambda: assert_eq(page.get_by_text(f"{content['product']['name']}, {pack['sticks']} sticks", exact=True).count(), 1), "pack line")
        for store in content["product"]["stores"]:
            assert page.get_by_role("link", name=f"Buy at {store['name']} (opens in a new tab)", exact=True).get_attribute("href") == store["url"]


def test_product_information_tabs(browser: Browser, app_url: str) -> None:
    restore(app_url)
    t = tag()
    big = seed_body()
    big["product"]["name"] = f"Pace Grove {t}"
    big["product"]["packs"] = [{"sticks": STICKS_MAX, "price_yen": PRICE_MAX}]
    big["product"]["ingredients"] = [{"name": f"Root {t}", "mg": MG_MAX}, {"name": "Salt", "mg": 7}]
    for body, edition in ((seed_body(), 1), (big, 2)):
        product_data = body["product"]
        if edition == 2:
            assert_json(grading(app_url, "PUT", body), 200, {"edition": 2})
        try:
            with visit(browser, base(app_url) + "/#product") as page:
                story_ready(page)
                product = region(page, "product", product_data["name"])
                eventually(page, lambda: assert_eq(product.count(), 1), "product chapter")
                assert f"{product_data['format']}. {product_data['serving']}." in flat(product.text_content() or "")
                tabs = info_tabs(page)
                names = ["Details", "Ingredients", "How to use"]
                assert selected_tab(tabs, names) == ["Details"]
                panel = product.get_by_role("tabpanel")
                assert panel.count() == 1, "more than one tab panel shown"
                details = flat(panel.text_content() or "")
                for line in [f"Format: {product_data['format']}", f"Serving: {product_data['serving']}", *[pack_line(p) for p in product_data["packs"]]]:
                    assert line in details, f"Details misses {line!r}"
                tabs.get_by_role("tab", name="Details", exact=True).focus()
                page.keyboard.press("ArrowRight")
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["Ingredients"]), "ArrowRight selects Ingredients")
                table = product.get_by_role("table", name="Ingredients per stick", exact=True)
                assert table.get_by_role("columnheader", name="Ingredient", exact=True).count() == 1
                assert table.get_by_role("columnheader", name="Amount", exact=True).count() == 1
                rows = table.get_by_role("row").evaluate_all("(rows) => rows.map((r) => [...r.children].map((c) => c.textContent.trim()))")
                body_rows = [r for r in rows if r != ["Ingredient", "Amount"]]
                assert body_rows == [[i["name"], amount(i["mg"])] for i in product_data["ingredients"]], f"ingredients rows {body_rows}"
                page.keyboard.press("ArrowRight")
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["How to use"]), "ArrowRight selects How to use")
                use = product.get_by_role("tabpanel")
                steps = [(li.text_content() or "").strip() for li in use.get_by_role("list").first.get_by_role("listitem").all()]
                assert steps == product_data["how_to_use"], f"steps {steps}"
                assert use.get_by_role("list").first.evaluate("(l) => l.tagName") == "OL", "steps are not an ordered list"
                assert f"Storage: {product_data['storage']}" in flat(use.text_content() or "")
                cautions_heading = use.get_by_role("heading", name="Cautions", exact=True)
                assert cautions_heading.count() == 1
                caution_items = [(li.text_content() or "").strip() for li in use.get_by_role("list").last.get_by_role("listitem").all()]
                assert caution_items == product_data["cautions"]
                page.keyboard.press("ArrowRight")
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["Details"]), "ArrowRight wraps to Details")
                page.keyboard.press("ArrowLeft")
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["How to use"]), "ArrowLeft wraps to How to use")
                page.keyboard.press("Home")
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["Details"]), "Home")
                page.keyboard.press("End")
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["How to use"]), "End")
                page.keyboard.press("Tab")
                assert page.evaluate("() => document.activeElement.getAttribute('role')") == "tabpanel"
                click(tabs.get_by_role("tab", name="Ingredients", exact=True))
                eventually(page, lambda: assert_eq(selected_tab(tabs, names), ["Ingredients"]), "click selects Ingredients")
        finally:
            if edition == 2:
                restore(app_url)


def test_pack_view(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product", record=True) as page:
        story_ready(page)
        record_announcements(page)
        product = region(page, "product")
        group = page.get_by_role("radiogroup", name="Pack view", exact=True)
        assert group.get_by_role("radio", name="Front", exact=True).is_checked()
        pack = product.locator("[data-view]")
        assert pack.get_attribute("data-view") == "front"
        assert product.get_by_role("img", name=f"{PRODUCT_NAME} pack, front view", exact=True).count() == 1
        group.get_by_role("radio", name="Front", exact=True).focus()
        expected = []
        for key, view, radio in (("ArrowRight", "side", "Side"), ("ArrowRight", "back", "Back"), ("ArrowRight", "front", "Front"), ("ArrowLeft", "back", "Back")):
            assert_motion(page, pack, lambda: page.keyboard.press(key), PACK_MS, f"pack turn to {view}")
            eventually(page, lambda: (assert_eq(pack.get_attribute("data-view"), view),
                                      assert_eq(product.get_by_role("img", name=f"{PRODUCT_NAME} pack, {view} view", exact=True).count(), 1),
                                      assert_eq(group.get_by_role("radio", name=radio, exact=True).is_checked(), True)), f"pack shows {view}")
            expected.append(f"Showing the {view} of the pack.")
        choose(group.get_by_role("radio", name="Side", exact=True))
        eventually(page, lambda: assert_eq(pack.get_attribute("data-view"), "side"), "click Side")
        expected.append("Showing the side of the pack.")
        expect_said(page, expected, "each pack view announced once")


def test_online_store_page(browser: Browser, app_url: str) -> None:
    t = tag()
    body = seed_body()
    body["product"]["name"] = f"Pace Shore {t}"
    body["product"]["packs"] = [{"sticks": 7, "price_yen": 12345}, {"sticks": 60, "price_yen": 7200}]
    body["product"]["stores"] = [{"name": f"Shop {t}", "url": f"https://shop-{t}.example/pace"},
                                 {"name": "Alder Quay Online Store", "url": "https://store.alderquay.example/vireo-pace"},
                                 {"name": f"Kiosk {t}", "url": f"https://kiosk-{t}.example/"}]
    with published(app_url, body) as edition:
        with visit(browser, base(app_url) + "/store") as page:
            page_ready(page)
            assert page.title() == "Online store | Vireo Pace"
            assert page.get_by_role("heading", level=1, name="Online store", exact=True).count() == 1
            for pack in body["product"]["packs"]:
                line = page.get_by_text(f"{body['product']['name']}, {pack['sticks']} sticks", exact=True)
                eventually(page, lambda: assert_eq(line.count(), 1), "pack line")
                assert page.get_by_text(f"¥{pack['price_yen']:,} (tax included)", exact=True).count() == 1
            assert page.get_by_role("heading", name="Where to buy", exact=True).count() == 1
            links = [page.get_by_role("link", name=f"Buy at {s['name']} (opens in a new tab)", exact=True) for s in body["product"]["stores"]]
            for link, store in zip(links, body["product"]["stores"]):
                assert link.get_attribute("href") == store["url"]
            assert in_dom_order(page, links), "store links are not in stored order"
            dropped = SEED_PRODUCT["stores"][1]["name"]
            assert page.get_by_role("link", name=f"Buy at {dropped} (opens in a new tab)", exact=True).count() == 0
            assert page.get_by_text(f"Content edition {edition}", exact=True).count() == 1
            page.context.route(body["product"]["stores"][0]["url"], lambda route: route.fulfill(status=200, content_type="text/html", body="<p>shop</p>"))
            with page.expect_popup() as popup:
                click(links[0])
            assert popup.value.evaluate("() => window.opener === null"), "the store tab can reach the site through window.opener"


def test_wf_interview_browse_filter_open_back(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#interviews") as page:
        story_ready(page)
        assert interview_names(page) == [iv["name"] for iv in SEED_INTERVIEWS], "the list is not exactly the seed"
        choose(page.get_by_role("radiogroup", name="Show interviews").get_by_role("radio", name="Experts", exact=True))
        eventually(page, lambda: assert_eq(interview_names(page), ["Mina Okabe", "Daniel Reyes", "Harue Sato"]), "Experts filter")
        story_url = page.url
        click(page.get_by_role("link", name=f"Read the interview with {SEED_INTERVIEWS[1]['name']}", exact=True))
        page.wait_for_url(re.compile(r"/interviews/daniel-reyes$"))
        heading = page.get_by_role("heading", level=1, name="Daniel Reyes", exact=True)
        eventually(page, lambda: assert_focused(heading, "interview heading"), "interview heading focused")
        page.keyboard.press("ArrowRight")
        page.wait_for_url(re.compile(r"/interviews/harue-sato$"))
        page.go_back()
        page.wait_for_url(re.compile(r"/interviews/daniel-reyes$"))
        page.go_back()
        eventually(page, lambda: assert_eq(urlparse(page.url).path, urlparse(story_url).path), "back returns to the story")
        eventually(page, lambda: assert_eq(page.get_by_role("list", name="Interviews", exact=True).count(), 1), "list again")
    detail = assert_json(api(app_url, "GET", "/api/interviews/daniel-reyes"), 200)
    assert detail["next"] == {"slug": "harue-sato", "name": "Harue Sato"}


def test_wf_interview_browse_unknown(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/") as page:
        resp = page.goto(base(app_url) + f"/interviews/{UNKNOWN_SLUG}")
        assert resp and resp.status == 404
        page_ready(page)
        assert page.title() == "Not found | Vireo Pace"
        assert page.get_by_role("heading", level=1, name=NO_INTERVIEW["message"], exact=True).count() == 1
        click(page.get_by_role("link", name="All interviews", exact=True))
        story_ready(page)
        expect_jump(page, "interviews")
    assert_json(api(app_url, "GET", f"/api/interviews/{UNKNOWN_SLUG}"), 404, NO_INTERVIEW)


def test_interview_filter(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#interviews") as page:
        story_ready(page)
        record_announcements(page)
        group = page.get_by_role("radiogroup", name="Show interviews", exact=True)
        assert group.get_by_role("radio", name="All", exact=True).is_checked()
        experts = [iv["name"] for iv in SEED_INTERVIEWS if iv["category"] == "expert"]
        everyday = [iv["name"] for iv in SEED_INTERVIEWS if iv["category"] == "everyday"]
        everyone = [iv["name"] for iv in SEED_INTERVIEWS]
        group.get_by_role("radio", name="All", exact=True).focus()
        for key, names in (("ArrowRight", experts), ("ArrowLeft", everyone), ("ArrowLeft", everyday), ("ArrowRight", everyone)):
            page.keyboard.press(key)
            eventually(page, lambda: assert_eq(interview_names(page), names), f"{key} filter")
            if names == everyday:
                for li in page.get_by_role("list", name="Interviews").get_by_role("listitem").all():
                    assert li.get_by_text("Everyday", exact=True).count() == 1
        expect_said(page, ["Showing 3 interviews.", "Showing 6 interviews.", "Showing 3 interviews.", "Showing 6 interviews."], "filter counts announced")
    body = seed_body()
    body["interviews"] = [body["interviews"][0], body["interviews"][3], body["interviews"][4]]
    with published(app_url, body):
        with visit(browser, base(app_url) + "/#interviews") as page:
            story_ready(page)
            record_announcements(page)
            choose(page.get_by_role("radiogroup", name="Show interviews").get_by_role("radio", name="Experts", exact=True))
            eventually(page, lambda: assert_eq(interview_names(page), ["Mina Okabe"]), "one expert")
            assert page.get_by_role("list", name="Interviews").get_by_role("listitem").first.get_by_text("Expert", exact=True).count() == 1
            choose(page.get_by_role("radiogroup", name="Show interviews").get_by_role("radio", name="All", exact=True))
            eventually(page, lambda: assert_eq(interview_names(page), ["Mina Okabe", "Kenji Mori", "Ana Lindqvist"]), "all three")
            expect_said(page, ["Showing 1 interview.", "Showing 3 interviews."], "singular and plural counts")


@pytest.mark.parametrize("slug", INTERVIEW_SLUGS, ids=INTERVIEW_SLUGS)
def test_interview_pages(browser: Browser, app_url: str, slug: str) -> None:
    restore(app_url)
    i = INTERVIEW_SLUGS.index(slug)
    iv = SEED_INTERVIEWS[i]
    with visit(browser, base(app_url) + "/#interviews") as page:
        story_ready(page)
        length = page.evaluate("() => history.length")
        click(page.get_by_role("link", name=f"Read the interview with {iv['name']}", exact=True))
        page.wait_for_url(re.compile(rf"/interviews/{slug}$"))
        heading = page.get_by_role("heading", level=1, name=iv["name"], exact=True)
        eventually(page, lambda: (assert_focused(heading, "h1"), assert_eq(page.title(), f"{iv['name']} | Vireo Pace interviews")), "interview page")
        assert page.evaluate("() => history.length") == length + 1
        text = flat(page.text_content("body") or "")
        for t in (iv["role"], iv["lede"], PROFILE_NOTE):
            assert t in text, f"missing {t!r}"
        parts: list[Locator] = []
        for a in iv["answers"]:
            q = page.get_by_role("heading", level=2, name=a["question"], exact=True)
            ans = page.get_by_text(a["answer"], exact=True)
            assert q.count() == 1 and ans.count() == 1, f"answer {a['question']!r} missing"
            parts += [q, ans]
        assert in_dom_order(page, parts), "answers out of published order"
        nav = page.get_by_role("navigation", name="Interview pages", exact=True)
        prev = SEED_INTERVIEWS[i - 1] if i > 0 else None
        nxt = SEED_INTERVIEWS[i + 1] if i < len(SEED_INTERVIEWS) - 1 else None
        assert nav.get_by_role("link", name=re.compile("^Previous interview: ")).count() == (1 if prev else 0)
        assert nav.get_by_role("link", name=re.compile("^Next interview: ")).count() == (1 if nxt else 0)
        if prev:
            assert nav.get_by_role("link", name=f"Previous interview: {prev['name']}", exact=True).get_attribute("href").endswith(f"/interviews/{prev['slug']}")
        if nxt:
            assert nav.get_by_role("link", name=f"Next interview: {nxt['name']}", exact=True).get_attribute("href").endswith(f"/interviews/{nxt['slug']}")
        assert page.get_by_role("link", name="All interviews", exact=True).get_attribute("href").endswith("/#interviews")
        for key, neighbour in (("ArrowRight", nxt), ("ArrowLeft", prev)):
            before = page.evaluate("() => history.length")
            page.get_by_role("link", name="All interviews", exact=True).focus()
            page.keyboard.press(key)
            if neighbour:
                page.wait_for_url(re.compile(rf"/interviews/{neighbour['slug']}$"))
                eventually(page, lambda: assert_eq(page.title(), f"{neighbour['name']} | Vireo Pace interviews"), f"{key} opens the neighbour")
                page.go_back()
                page.wait_for_url(re.compile(rf"/interviews/{slug}$"))
                eventually(page, lambda: assert_eq(page.get_by_role("heading", level=1, name=iv["name"], exact=True).count(), 1), "back")
            else:
                advance(page, SETTLE_MS)
                assert urlparse(page.url).path == f"/interviews/{slug}", f"{key} at the end moved to {page.url}"


def test_content_and_interview_api(app_url: str) -> None:
    restore(app_url)
    content = assert_json(api(app_url, "GET", "/api/content"), 200)
    assert set(content) == {"edition", "product", "interviews", "scenarios"}
    assert all(set(iv) == {"slug", "name", "role", "category", "lede", "hue"} for iv in content["interviews"])
    assert all(set(s) == {"id", "mode", "name"} for s in content["scenarios"])
    for i, slug in enumerate(INTERVIEW_SLUGS):
        assert_json(api(app_url, "GET", f"/api/interviews/{slug}"), 200, interview_detail(SEED_INTERVIEWS, i))
    assert_json(api(app_url, "GET", f"/api/interviews/{UNKNOWN_SLUG}"), 404, NO_INTERVIEW)
    body = seed_body()
    body["interviews"] = list(reversed(body["interviews"]))
    body["scenarios"] = list(reversed(body["scenarios"]))
    with published(app_url, body):
        republished = assert_json(api(app_url, "GET", "/api/content"), 200)
        assert [iv["slug"] for iv in republished["interviews"]] == list(reversed(INTERVIEW_SLUGS))
        assert [s["id"] for s in republished["scenarios"]] == SCENARIO_ORDER
        for i, iv in enumerate(body["interviews"]):
            assert_json(api(app_url, "GET", f"/api/interviews/{iv['slug']}"), 200, interview_detail(body["interviews"], i))


PAGE_CASES = ["unknown-page", "unknown-interview", "contact", "privacy", "legal"]


@pytest.mark.parametrize("case", PAGE_CASES, ids=PAGE_CASES)
def test_not_found_and_information_pages(browser: Browser, app_url: str, case: str) -> None:
    restore(app_url)
    path, status_code, title, heading, copy_lines = {
        "unknown-page": (UNKNOWN_PAGE, 404, "Not found | Vireo Pace", NOT_FOUND_HEADING, []),
        "unknown-interview": (f"/interviews/{UNKNOWN_SLUG}", 404, "Not found | Vireo Pace", NO_INTERVIEW["message"], []),
        "contact": ("/contact", 200, "Contact | Alder Quay Laboratories", "Contact", CONTACT_COPY),
        "privacy": ("/privacy", 200, "Privacy | Alder Quay Laboratories", "Privacy", [PRIVACY_COPY]),
        "legal": ("/legal", 200, "Legal | Alder Quay Laboratories", "Legal", [LEGAL_COPY]),
    }[case]
    with visit(browser, base(app_url) + "/") as page:
        resp = page.goto(base(app_url) + path)
        assert resp and resp.status == status_code, f"{path} answered {resp.status if resp else None}"
        page_ready(page)
        eventually(page, lambda: assert_eq(page.title(), title), "title")
        assert page.get_by_role("heading", level=1, name=heading, exact=True).count() == 1
        assert page.evaluate("() => document.documentElement.lang") == "en"
        text = flat(page.text_content("body") or "")
        for line in copy_lines:
            assert line in text, f"{path} misses {line!r}"
        if case == "contact":
            assert page.get_by_role("link", name=EMAIL, exact=True).get_attribute("href") == f"mailto:{EMAIL}"
        if case == "unknown-page":
            back = page.get_by_role("link", name="Back to the story", exact=True)
            assert urlparse(back.get_attribute("href") or "").path == "/"
        if case == "unknown-interview":
            assert page.get_by_role("link", name="All interviews", exact=True).count() == 1


def test_wf_on_off_switch_click_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle") as page:
        story_ready(page)
        expect_scenario(page, "on-work")
        record_announcements(page)
        choose(mode_radio(page, "OFF"))
        expect_scenario(page, "off-break")
        names = [s["name"] for s in SEED_SCENARIOS if s["mode"] == "off"]
        assert moments(page).get_by_role("radio").count() == 4
        assert in_dom_order(page, [moments(page).get_by_role("radio", name=n, exact=True) for n in names])
        choose(moment_radio(page, "off-rest"))
        expect_scenario(page, "off-rest")
        assert SCENARIOS["off-rest"]["copy"] in flat(lifestyle(page).text_content() or "")
        mode_radio(page, "OFF").focus()
        page.keyboard.press("ArrowRight")
        expect_scenario(page, "on-work")
        expect_said(page, [mode_line("off-break"), mode_line("off-rest"), mode_line("on-work")], "mode and scenario changes announced")
    assert_json(api(app_url, "GET", "/api/scenarios/on-work"), 200, SCENARIOS["on-work"])


def test_wf_on_off_switch_shared_address(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#lifestyle") as page:
        story_ready(page)
        choose(mode_radio(page, "OFF"))
        choose(moment_radio(page, "off-holiday"))
        expect_scenario(page, "off-holiday")
        shared = page.url
        page.reload()
        story_ready(page)
        expect_scenario(page, "off-holiday")
        assert status_text(page) == "", "the start scenario was announced"
    with visit(browser, shared) as other:
        story_ready(other)
        expect_scenario(other, "off-holiday")
        assert hash_of(other) == "#lifestyle"
    assert_json(api(app_url, "GET", "/api/scenarios/off-holiday"), 200, SCENARIOS["off-holiday"])


def test_mode_remembers_scenario(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-sports#lifestyle") as page:
        story_ready(page)
        expect_scenario(page, "on-sports")
        for step, expected in (("OFF", "off-break"), ("ON", "on-sports"), ("on-hobby", "on-hobby"), ("OFF", "off-break"),
                               ("off-relax", "off-relax"), ("ON", "on-hobby"), ("OFF", "off-relax")):
            if step in ("ON", "OFF"):
                choose(mode_radio(page, step))
            else:
                choose(moment_radio(page, step))
            expect_scenario(page, expected)
            mode = expected.split("-")[0]
            names = [s["name"] for s in SEED_SCENARIOS if s["mode"] == mode]
            assert [n for n in names if moments(page).get_by_role("radio", name=n, exact=True).count() == 1] == names
            assert moments(page).get_by_role("radio").count() == 4


def test_meridian_address(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#lifestyle") as page:
        story_ready(page)
        expect_scenario(page, "on-work", in_address=False)
        advance(page, SETTLE_MS)
        assert "scenario" not in query(page), "an address without scenario gained one before any choice"
        length = page.evaluate("() => history.length")
        choose(mode_radio(page, "OFF"))
        expect_scenario(page, "off-break")
        choose(moment_radio(page, "off-rest"))
        expect_scenario(page, "off-rest")
        assert page.evaluate("() => history.length") == length, "choices added history entries"
        assert hash_of(page) == "#lifestyle"
        shared = page.url
        page.reload()
        story_ready(page)
        expect_scenario(page, "off-rest")
    with visit(browser, shared, PHONE) as other:
        story_ready(other)
        expect_scenario(other, "off-rest")
    with visit(browser, base(app_url) + f"/?scenario={UNKNOWN_SCENARIO}#lifestyle") as page:
        story_ready(page)
        expect_scenario(page, "on-work")
        assert status_text(page) == "", "the fallback start scenario was announced"


def stage_background(page: Page) -> tuple[float, float, float]:
    heading = chapter_heading(page, "lifestyle")
    rgb = parse_rgb(heading.evaluate(BACKGROUND_JS))
    assert rgb, "no Lifestyle stage colour"
    return rgb


def test_stage_colour_change(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle", record=True) as page:
        story_ready(page)
        expect_scenario(page, "on-work")
        life = lifestyle(page)
        settle(life)
        on_bg = stage_background(page)
        axe(page)
        assert_motion(page, life, lambda: choose(mode_radio(page, "OFF")), STAGE_COLOUR_MS, "stage colour to night")
        expect_scenario(page, "off-break")
        settle(life)
        advance(page, SETTLE_MS)
        off_bg = stage_background(page)
        assert luminance(on_bg) > luminance(off_bg), f"ON stage {on_bg} is not brighter than OFF stage {off_bg}"
        axe(page)
        assert_motion(page, life, lambda: choose(mode_radio(page, "ON")), STAGE_COLOUR_MS, "stage colour to paper")
        expect_scenario(page, "on-work")
        settle(life)
        advance(page, SETTLE_MS)
        assert stage_background(page) == on_bg


def test_wf_scenario_select_all_eight(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle") as page:
        story_ready(page)
        expect_scenario(page, "on-work")
        record_announcements(page)
        expected = []
        moment_radio(page, "on-work").focus()
        for sid in ("on-sports", "on-hobby", "on-housework", "on-work"):
            page.keyboard.press("ArrowRight")
            expect_scenario(page, sid)
            expected.append(mode_line(sid))
        mode_radio(page, "ON").focus()
        page.keyboard.press("ArrowRight")
        expect_scenario(page, "off-break")
        expected.append(mode_line("off-break"))
        for sid in ("off-holiday", "off-relax", "off-rest"):
            choose(moment_radio(page, sid))
            expect_scenario(page, sid)
            expected.append(mode_line(sid))
        expect_said(page, expected, "one announcement per scenario change")
    for sid in SCENARIO_ORDER:
        assert_json(api(app_url, "GET", f"/api/scenarios/{sid}"), 200, SCENARIOS[sid])


def test_wf_scenario_select_swipe(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle", PHONE, touch=True) as page:
        story_ready(page)
        record_announcements(page)
        picture = lambda: lifestyle(page).locator("[data-scenario]").last
        expected = []
        for dx, sid in ((-LONG_SWIPE_PX, "on-sports"), (-LONG_SWIPE_PX, "on-hobby"), (LONG_SWIPE_PX, "on-sports")):
            swipe(page, lifestyle(page).get_by_role("img", name=re.compile("^Illustration: ")), dx)
            expect_scenario(page, sid)
            expected.append(mode_line(sid))
        assert picture().get_attribute("data-scenario") == "on-sports"
        expect_said(page, expected, "one announcement per swipe")
    assert_json(api(app_url, "GET", "/api/scenarios/on-sports"), 200, SCENARIOS["on-sports"])


def test_scenario_panel(browser: Browser, app_url: str) -> None:
    t = tag()
    body = seed_body()
    relax = next(s for s in body["scenarios"] if s["id"] == "off-relax")
    relax.update({"title": f"Bath light {t}", "time": CHANGED_TIME, "copy": f"Steam {t}.", "moment": f"Tea {t}."})
    with published(app_url, body):
        with visit(browser, base(app_url) + "/?scenario=off-break#lifestyle") as page:
            story_ready(page)
            expect_scenario(page, "off-break")
            record_announcements(page)
            with held(page, "**/api/scenarios/off-relax") as hold:
                choose(moment_radio(page, "off-relax"))
                eventually(page, lambda: assert_eq(busy(page), True), "panel busy while loading")
                assert lifestyle(page).get_attribute("data-scenario") == "off-break"
                assert lifestyle(page).get_by_role("heading", level=3, name="Ten minutes", exact=True).count() == 1
                hold.release()
            expect_scenario(page, "off-relax", relax["title"])
            text = flat(lifestyle(page).text_content() or "")
            for part in (relax["time"], relax["copy"], relax["moment"], "Where it fits"):
                assert part in text, f"panel misses {part!r}"
            sent: list[str] = []
            page.on("request", lambda r: sent.append(r.url) if "/api/scenarios/" in r.url else None)
            choose(moment_radio(page, "off-relax"))
            advance(page, SETTLE_MS)
            assert sent == [], "choosing the shown scenario made a request"
            page.route("**/api/scenarios/off-holiday", lambda route: route.abort())
            choose(moment_radio(page, "off-holiday"))
            alert = page.get_by_role("alert").filter(has_text=SCENARIO_ALERT)
            eventually(page, lambda: assert_eq((alert.text_content() or "").strip(), SCENARIO_ALERT), "scenario failure alert")
            assert lifestyle(page).get_attribute("data-scenario") == "off-relax" and not busy(page)
            assert lifestyle(page).get_by_role("heading", level=3, name=relax["title"], exact=True).count() == 1
            expect_said(page, [mode_line("off-relax", relax["title"])], "only the successful choice announced")


def test_latest_choice_wins(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle") as page:
        story_ready(page)
        expect_scenario(page, "on-work")
        record_announcements(page)
        with held(page, "**/api/scenarios/off-break") as hold:
            choose(mode_radio(page, "OFF"))
            eventually(page, lambda: assert_eq(moment_radio(page, "off-rest").count(), 1), "OFF stops shown at once")
            assert lifestyle(page).get_attribute("data-scenario") == "on-work"
            choose(moment_radio(page, "off-rest"))
            expect_scenario(page, "off-rest")
            hold.release()
        advance(page, SETTLE_MS)
        expect_scenario(page, "off-rest")
        assert lifestyle(page).get_by_role("img", name=f"Illustration: {SCENARIOS['off-break']['title']}", exact=True).count() == 0
        expect_said(page, [mode_line("off-rest")], "the late answer announced nothing")


@pytest.mark.parametrize("sid", SCENARIO_CASES, ids=SCENARIO_CASES)
def test_scenario_api(app_url: str, sid: str) -> None:
    restore(app_url)
    if sid == "unknown":
        assert_json(api(app_url, "GET", f"/api/scenarios/{UNKNOWN_SCENARIO}"), 404, NO_SCENARIO)
        return
    assert_json(api(app_url, "GET", f"/api/scenarios/{sid}"), 200, SCENARIOS[sid])
    body = seed_body()
    changed = next(s for s in body["scenarios"] if s["id"] == sid)
    changed["copy"] = f"Changed {tag()}."
    with published(app_url, body):
        assert_json(api(app_url, "GET", f"/api/scenarios/{sid}"), 200, changed)


BOUNDARY_CASES = ["unknown-api", "unknown-method", "order-before-size", "no-cors", "no-source-files", "no-secrets"]
SOURCE_PROBES = ["/package.json", "/package-lock.json", "/run.json", "/.env", "/tsconfig.json", "/src/server.ts"]


@pytest.mark.parametrize("case", BOUNDARY_CASES, ids=BOUNDARY_CASES)
def test_server_boundary(browser: Browser, app_url: str, case: str) -> None:
    if case == "unknown-api":
        assert_json(api(app_url, "GET", "/api/no-such-thing"), 404, NOT_FOUND)
    elif case == "unknown-method":
        for method, path in (("DELETE", "/api/content"), ("POST", "/api/scenarios/on-work"), ("PUT", "/api/health"), ("POST", "/api/product/sheet")):
            assert_json(api(app_url, method, path, body={}), 404, NOT_FOUND)
    elif case == "order-before-size":
        assert_json(api(app_url, "POST", "/api/content", raw=b" " * (BODY_LIMIT + 1)), 404, NOT_FOUND)
    elif case == "no-cors":
        origin = {"Origin": "http://elsewhere.example"}
        for resp in (api(app_url, "GET", "/api/content", headers=origin),
                     api(app_url, "OPTIONS", "/api/content", headers={**origin, "Access-Control-Request-Method": "PUT"})):
            leaked = [h for h in resp.headers if h.lower().startswith("access-control-allow")]
            assert not leaked, f"cross-origin headers {leaked}"
    elif case == "no-source-files":
        for path in SOURCE_PROBES:
            resp = api(app_url, "GET", path)
            assert resp.status_code == 404, f"{path} answered {resp.status_code}"
            assert "run-manifest-v1" not in resp.text
    elif case == "no-secrets":
        secrets = [v for v in (GRADING_KEY, os.environ.get("DATABASE_URL"), os.environ.get("GOTENBERG_URL")) if v]
        urls: set[str] = set()
        with visit(browser, base(app_url) + "/") as page:
            page.on("response", lambda r: urls.add(r.url))
            page.reload()
            story_ready(page)
        for url in sorted(u for u in urls if same_origin(u, app_url)):
            text = httpx.get(url, timeout=HTTP_TIMEOUT_S).text
            for secret in secrets:
                assert secret not in text, f"{url} carries a configured secret value"


def menu_dialog(page: Page) -> Locator:
    return page.get_by_role("dialog", name="Menu", exact=True)


def test_wf_keyboard_journey_desktop(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/") as page:
        story_ready(page)
        names = tab_order(page, len(TAB_ORDER_WIDE))
        assert names == TAB_ORDER_WIDE, f"Tab order {names}"
        assert "Close menu" not in names
        menu = page.get_by_role("button", name="Menu", exact=True)
        menu.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_focused(menu_dialog(page).get_by_role("link", name="01 Opening", exact=True), "menu focus"), "menu opens")
        page.keyboard.press("Escape")
        eventually(page, lambda: assert_focused(menu, "Menu"), "Escape returns focus")
        page.keyboard.press("Enter")
        link = menu_dialog(page).get_by_role("link", name="07 Lifestyle", exact=True)
        eventually(page, lambda: assert_eq(link.is_visible(), True), "menu reopens")
        link.focus()
        page.keyboard.press("Enter")
        expect_jump(page, "lifestyle")
    assert_json(api(app_url, "GET", "/api/content"), 200)


def test_wf_keyboard_journey_tablet_menu(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/", TABLET) as page:
        story_ready(page)
        assert tab_order(page, len(TAB_ORDER_NARROW)) == TAB_ORDER_NARROW
        menu = page.get_by_role("button", name="Menu", exact=True)
        for chapter in CHAPTER_IDS:
            menu.focus()
            page.keyboard.press("Enter")
            link = menu_dialog(page).get_by_role("link", name=RAIL[chapter], exact=True)
            eventually(page, lambda: assert_eq(link.is_visible(), True), "menu open")
            link.focus()
            page.keyboard.press("Enter")
            expect_jump(page, chapter)


@pytest.mark.parametrize("size_id", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_tab_order_and_skip_link(browser: Browser, app_url: str, size_id: str) -> None:
    restore(app_url)
    size = VIEWPORTS[size_id]
    expected = TAB_ORDER_WIDE if size_id == "1280x800" else TAB_ORDER_NARROW
    with visit(browser, base(app_url) + "/", size) as page:
        story_ready(page)
        assert tab_order(page, len(expected)) == expected
    for path, heading in (("/", HERO), ("/store", "Online store")):
        with visit(browser, base(app_url) + path, size) as page:
            page_ready(page)
            page.keyboard.press("Tab")
            page.keyboard.press("Enter")
            h1 = page.get_by_role("heading", level=1, name=heading, exact=True)
            eventually(page, lambda: assert_focused(h1, "skip target"), f"skip link on {path}")


def test_menu_dialog(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for size in (PHONE, DESKTOP):
        with visit(browser, base(app_url) + "/", size) as page:
            story_ready(page)
            assert menu_dialog(page).count() == 0
            assert "Close menu" not in tab_order(page, len(TAB_ORDER_WIDE) + 4)
            menu = page.get_by_role("button", name="Menu", exact=True)
            menu.focus()
            page.keyboard.press("Enter")
            dlg = menu_dialog(page)
            eventually(page, lambda: assert_focused(dlg.get_by_role("link", name="01 Opening", exact=True), "first link"), "menu open")
            close = dlg.get_by_role("button", name="Close menu", exact=True)
            contact = dlg.get_by_role("link", name="Contact", exact=True)
            page.keyboard.press("Shift+Tab")
            assert_focused(close, "Shift+Tab to Close menu")
            page.keyboard.press("Shift+Tab")
            assert_focused(contact, "Shift+Tab wraps to the last control")
            page.keyboard.press("Tab")
            assert_focused(close, "Tab wraps to Close menu")
            handle = dlg.element_handle()
            page.keyboard.press("Escape")
            page.keyboard.press("Tab")
            assert handle.evaluate("(d) => !d.contains(document.activeElement)"), "focus entered the closing menu"
            advance(page, MENU_MS[1] + SETTLE_MS)
            assert menu_dialog(page).count() == 0
            menu.focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: assert_eq(close.is_visible(), True), "reopen")
            click(close)
            eventually(page, lambda: assert_focused(menu, "Menu after Close menu"), "close button returns focus")
            click(menu)
            store = menu_dialog(page).get_by_role("link", name="Online store", exact=True)
            eventually(page, lambda: assert_eq(store.is_visible(), True), "reopen")
            click(store)
            page.wait_for_url(re.compile(r"/store$"))


FOCUS_CONTROLS = [("link", "Skip to story"), ("link", "Alder Quay Laboratories home"), ("button", "Menu"), ("link", "01 Opening"),
                  ("link", "Begin the story"), ("button", "Next panel"), ("tab", "Breath"), ("slider", "Nitrate pathway"),
                  ("button", "Download product sheet (PDF)")]


def test_visible_focus_ring(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/") as page:
        story_ready(page)
        for role, name in FOCUS_CONTROLS:
            control = page.get_by_role(role, name=name, exact=True).first
            rest, focused = state_styles(control, "outline-style", "outline-width", "outline-color", "box-shadow", state="focus")

            def ring(s: dict[str, str]) -> tuple[float, str] | None:
                if s.get("outline-style", "none") != "none":
                    width = float(re.sub(r"px$", "", s.get("outline-width", "0px")) or 0)
                    if width >= RING_MIN_PX:
                        return width, s.get("outline-color", "")
                m = re.search(r"(rgba?\([^)]*\))\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px\s+(-?[\d.]+)px", s.get("box-shadow", "") or "")
                if m and float(m.group(5)) >= RING_MIN_PX:
                    return float(m.group(5)), m.group(1)
                return None

            assert ring(rest) is None, f"{name} shows a ring at rest: {rest}"
            assert_focused(control, f"{name} takes focus")
            shown = ring(focused)
            assert shown, f"{name} shows no {RING_MIN_PX} px ring when focused: {focused}"
            colour = parse_rgb(shown[1])
            behind = parse_rgb(control.evaluate("(el) => (" + BACKGROUND_JS + ")(el.parentElement)"))
            assert colour and behind and contrast(colour, behind) >= RING_CONTRAST, f"{name} ring contrast below 3:1"


def nearest_card(page: Page) -> int:
    return int(page.get_by_role("list", name="Interviews", exact=True).evaluate(
        "(l) => { const c = innerWidth / 2; const items = [...l.querySelectorAll('li')].map((li) => { const r = li.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - c); }); return items.indexOf(Math.min(...items)); }"))


def test_wf_phone_touch_menu_rows(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/", PHONE, touch=True) as page:
        story_ready(page)
        layout(page)
        tap(page.get_by_role("button", name="Menu", exact=True))
        link = menu_dialog(page).get_by_role("link", name="02 About", exact=True)
        eventually(page, lambda: assert_eq(link.is_visible(), True), "menu open")
        tap(link)
        expect_jump(page, "about")
        swipe(page, region(page, "about").locator("[data-track]"), -panel_swipe(page))
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "2"), "Inner Pace swipe")
        scroll_into_chapter(page, "interviews", 0.3)
        swipe(page, page.get_by_role("list", name="Interviews", exact=True), -ROW_SWIPE_PX)
        eventually(page, lambda: assert_eq(nearest_card(page), 1), "interview row moves one card")
        swipe(page, lifestyle(page).get_by_role("img", name=re.compile("^Illustration: ")), -LONG_SWIPE_PX)
        expect_scenario(page, "on-sports")
        assert page.evaluate("() => window.scrollX") == 0
        layout(page)
    assert_json(api(app_url, "GET", "/api/scenarios/on-sports"), 200, SCENARIOS["on-sports"])


def test_wf_phone_touch_reduced(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=off-break#lifestyle", PHONE, reduced=True, touch=True) as page:
        story_ready(page)
        swipe(page, lifestyle(page).get_by_role("img", name=re.compile("^Illustration: ")), -LONG_SWIPE_PX)
        expect_scenario(page, "off-holiday")
        tap(page.get_by_role("button", name="Menu", exact=True))
        tap(menu_dialog(page).get_by_role("button", name="Close menu", exact=True))
        eventually(page, lambda: assert_eq(menu_dialog(page).count(), 0), "menu closed by tap")
        layout(page)
    assert_json(api(app_url, "GET", "/api/scenarios/off-holiday"), 200, SCENARIOS["off-holiday"])


TAP_PAGES = ["/", "/store", "/contact", "/privacy", "/legal", "/interviews/mina-okabe", UNKNOWN_PAGE]


@pytest.mark.parametrize("size_id", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_no_sideways_scroll_and_tap_size(browser: Browser, app_url: str, size_id: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/", VIEWPORTS[size_id]) as page:
        for path in TAP_PAGES:
            page.goto(base(app_url) + path)
            page_ready(page)
            advance(page, SETTLE_MS)
            layout(page)
            if size_id != "375x812":
                continue
            for role in ("button", "link", "radio", "tab", "slider"):
                for control in page.get_by_role(role).all():
                    if not control.is_visible():
                        continue
                    if role == "link" and (control.text_content() or "").strip() == "Skip to story":
                        control.focus()
                    b = box(control)
                    assert b["width"] >= TAP_PX - PX_EPS and b["height"] >= TAP_PX - PX_EPS, f"{path} {role} {(control.text_content() or '').strip()!r} is {b}"


def test_interview_row_and_scenario_swipes(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/?scenario=on-work#interviews", PHONE, touch=True) as page:
        story_ready(page)
        cards = page.get_by_role("list", name="Interviews", exact=True).get_by_role("listitem").all()
        for card in cards:
            w = card.bounding_box()["width"]
            assert CARD_MIN_RATIO * PHONE[0] <= w <= CARD_MAX_RATIO * PHONE[0], f"card width {w}"
        row = page.get_by_role("list", name="Interviews", exact=True)
        for dx, index in ((-ROW_SWIPE_PX, 1), (-ROW_SWIPE_PX, 2), (ROW_SWIPE_PX, 1)):
            swipe(page, row, dx)
            eventually(page, lambda: assert_eq(nearest_card(page), index), f"row at card {index + 1}")
        assert page.evaluate("() => window.scrollX") == 0
        record_announcements(page)
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/api/scenarios/" in r.url else None)
        pic = lambda: lifestyle(page).get_by_role("img", name=re.compile("^Illustration: "))
        swipe(page, pic(), LONG_SWIPE_PX)
        advance(page, SETTLE_MS)
        swipe(page, pic(), -SHORT_SWIPE_PX)
        advance(page, SETTLE_MS)
        assert sent == [] and lifestyle(page).get_attribute("data-scenario") == "on-work", "a short or past-the-start swipe changed the scenario"
        swipe(page, pic(), -LONG_SWIPE_PX)
        expect_scenario(page, "on-sports")
        swipe(page, pic(), LONG_SWIPE_PX)
        expect_scenario(page, "on-work")
        expect_said(page, [mode_line("on-sports"), mode_line("on-work")], "one announcement per swipe")


def test_phone_taps_panels_and_stops(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#about", PHONE, touch=True) as page:
        story_ready(page)
        about = region(page, "about")
        record_announcements(page)
        start = row_state(page)
        tap(about.get_by_role("button", name="Next panel", exact=True))
        eventually(page, lambda: (assert_eq(about_state(page)["panel"], "2"),
                                  assert_eq(abs(row_state(page)["offset"] - (start["offset"] + start["panel"])) <= PX_TOL, True)),
                   "a tap on Next panel moves the row one panel")
        scroll_into_chapter(page, "lifestyle", 0.3)
        choose(mode_radio(page, "OFF"), touch=True)
        expect_scenario(page, "off-break")
        stops = [box(r) for r in moments(page).get_by_role("radio").all()]
        assert (len(distinct([s["y"] for s in stops])), len(distinct([s["x"] for s in stops]))) == (2, 2), f"stops {stops}"
        assert all(s["width"] >= TAP_PX - PX_EPS and s["height"] >= TAP_PX - PX_EPS for s in stops), f"stops {stops}"
        choose(moment_radio(page, "off-rest"), touch=True)
        expect_scenario(page, "off-rest")
        expect_said(page, [f"Panel 2 of 3: {INNER_PANELS[1][0]}.", mode_line("off-break"), mode_line("off-rest")],
                    "each tap announced once")
        assert page.evaluate("() => window.scrollX") == 0, "the page scrolled sideways"
    assert_json(api(app_url, "GET", "/api/scenarios/off-rest"), 200, SCENARIOS["off-rest"])


def meridian_run(browser: Browser, app_url: str, reduced: bool) -> tuple[str, list[str], str]:
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle", reduced=reduced, record=True) as page:
        story_ready(page)
        record_announcements(page)
        clear_motions(page)
        choose(mode_radio(page, "OFF"))
        expect_scenario(page, "off-break")
        choose(moment_radio(page, "off-rest"))
        expect_scenario(page, "off-rest")
        found = records(lifestyle(page))
        if reduced:
            assert_instant(lifestyle(page), "Meridian under reduced motion")
        else:
            assert found or path_settle_ms(motion(lifestyle(page).locator("[data-marker]"), MARKER_MS[1] * 2), MARKER_MS[1] * 2)[0] > 0, "Meridian did not move"
        expect_said(page, [mode_line("off-break"), mode_line("off-rest")], "Meridian announcements")
        return page.url, said(page), lifestyle(page).get_attribute("data-scenario") or ""


def test_wf_motion_reduced_meridian(browser: Browser, app_url: str) -> None:
    restore(app_url)
    moving = meridian_run(browser, app_url, False)
    still = meridian_run(browser, app_url, True)
    assert moving == still, f"end states differ: {moving} vs {still}"
    assert_json(api(app_url, "GET", "/api/scenarios/off-rest"), 200, SCENARIOS["off-rest"])


def test_wf_motion_reduced_jump(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for reduced in (False, True):
        with visit(browser, base(app_url) + "/", reduced=reduced) as page:
            story_ready(page)
            advance(page, WORDS_DONE_MS)
            words = page.locator("[data-word]")
            settle(page.get_by_role("heading", level=1, name=HERO, exact=True))
            assert " ".join((w.text_content() or "").strip() for w in words.all()) == HERO
            assert all(style(w, "opacity")["opacity"] == "1" for w in words.all())
            click(page.get_by_role("link", name="See Vireo Pace", exact=True))
            expect_jump(page, "product", instant=reduced)
    assert assert_json(api(app_url, "GET", "/api/content"), 200)["edition"] == 1


def test_wf_motion_reduced_menu_jump(browser: Browser, app_url: str) -> None:
    restore(app_url)
    ends = []
    for reduced in (False, True):
        with visit(browser, base(app_url) + "/", reduced=reduced, record=True) as page:
            story_ready(page)
            page.get_by_role("button", name="Menu", exact=True).focus()
            clear_motions(page)
            page.keyboard.press("Enter")
            dlg = menu_dialog(page)
            dlg.wait_for()
            eventually(page, lambda: assert_focused(dlg.get_by_role("link", name=RAIL["opening"], exact=True), "menu focus"), "menu takes focus")
            if reduced:
                assert_instant(dlg, "menu open")
            else:
                opened = wait_records(page, dlg)
                assert opened and MENU_MS[0] <= max(r["duration"] for r in opened) <= MENU_MS[1], f"menu open {opened}"
            heading = chapter_heading(page, "oxygen")
            dlg.get_by_role("link", name=RAIL["oxygen"], exact=True).focus()
            clear_motions(page)
            page.keyboard.press("Enter")
            expect_jump(page, "oxygen", instant=reduced)
            if reduced:
                assert_instant(heading, "Oxygen heading entry")
            else:
                entered = wait_records(page, heading)
                assert entered and HEADING_MS[0] <= max(r["duration"] for r in entered) <= HEADING_MS[1], f"heading entry {entered}"
            ends.append((hash_of(page), is_focused(heading), menu_dialog(page).count()))
    assert ends[0] == ends[1] == ("#oxygen", True, 0), f"end states differ: {ends}"


MOTION_CASES = ["opening-words", "chapter-heading", "meridian", "menu", "hover-focus", "nothing-else"]


@pytest.mark.parametrize("case", MOTION_CASES, ids=MOTION_CASES)
def test_published_motion_timing(browser: Browser, app_url: str, case: str) -> None:
    restore(app_url)
    path = "/?scenario=on-work#lifestyle" if case == "meridian" else "/"
    with visit(browser, base(app_url) + path, record=True) as page:
        story_ready(page)
        if case == "opening-words":
            advance(page, WORDS_DONE_MS)
            words = page.locator("[data-word]").all()
            deadline = time.monotonic() + RECORDS_S + WORDS_DONE_MS / 1000
            recs = [records(w) for w in words]
            while not all(recs) and time.monotonic() < deadline:
                recs = [records(w) for w in words]
            assert all(recs), "a word did not animate"
            starts = []
            for r in recs:
                longest = max(r, key=lambda x: x["duration"])
                assert WORD_RISE_MS[0] <= longest["duration"] <= WORD_RISE_MS[1], f"word rise {longest['duration']} ms"
                assert longest["start"] + longest["duration"] <= WORDS_DONE_MS, "a word settled after 1.6 s"
                starts.append(longest["start"])
            for a, b in zip(starts, starts[1:]):
                assert WORD_STAGGER_MS[0] <= b - a <= WORD_STAGGER_MS[1], f"stagger {b - a} ms"
        elif case == "chapter-heading":
            heading = chapter_heading(page, "science")
            assert_motion(page, heading, lambda: scroll_into_chapter(page, "science", 0.1), HEADING_MS, "science heading entry")
            scroll_to(page, 0)
            advance(page, SETTLE_MS)
            clear_motions(page)
            scroll_into_chapter(page, "science", 0.1)
            advance(page, SETTLE_MS)
            assert records(heading) == [], "the heading animated on a second entry"
        elif case == "meridian":
            assert_motion(page, lifestyle(page).locator("[data-marker]"), lambda: choose(moment_radio(page, "on-hobby")), MARKER_MS, "marker glide")
            expect_scenario(page, "on-hobby")
            pictures = page.evaluate(PICTURE_QUERY_JS)
            assert pictures and PICTURE_MS[0] <= max(p["duration"] for p in pictures) <= PICTURE_MS[1], f"picture crossfade {pictures}"
            title = lifestyle(page).get_by_role("heading", level=3, name="The workbench", exact=True)
            copy_recs = records(title) + records(lifestyle(page).get_by_text(SCENARIOS["on-hobby"]["copy"], exact=True))
            assert any(COPY_MS[0] <= r["duration"] <= COPY_MS[1] for r in copy_recs), f"copy slide {copy_recs}"
        elif case == "menu":
            menu = page.get_by_role("button", name="Menu", exact=True)
            clear_motions(page)
            click(menu)
            dlg = menu_dialog(page)
            dlg.wait_for()
            opened = wait_records(page, dlg)
            assert opened and MENU_MS[0] <= max(r["duration"] for r in opened) <= MENU_MS[1], f"menu open {opened}"
            handle = dlg.element_handle()
            clear_motions(page)
            page.keyboard.press("Escape")
            deadline = time.monotonic() + RECORDS_S
            closed: list[dict[str, Any]] = []
            while time.monotonic() < deadline and not closed:
                closed = handle.evaluate(MOTION_QUERY_JS)
            assert closed and MENU_MS[0] <= max(r["duration"] for r in closed) <= MENU_MS[1], f"menu close {closed}"
        elif case == "hover-focus":
            link = page.get_by_role("link", name="Begin the story", exact=True)
            clear_motions(page)
            link.hover()
            link.focus()
            advance(page, SETTLE_MS)
            worst = max((r["delay"] + r["duration"] for r in records(link)), default=0)
            assert worst <= HOVER_MS, f"hover and focus change took {worst} ms"
        else:
            opening = region(page, "opening")
            advance(page, WORDS_DONE_MS)
            settle(opening)
            loops = page.evaluate("() => document.getAnimations().filter((a) => a.effect && a.effect.getComputedTiming().iterations === Infinity).length")
            assert loops == 0, "an animation loops forever"
            first = decode(capture(opening))
            advance(page, WORDS_DONE_MS * 3)
            settle(opening)
            assert difference(first, decode(capture(opening))) == UNCHANGED, "the opening stage moved on its own"


REDUCED_CASES = ["opening-words", "pack", "meridian", "menu", "jump"]


@pytest.mark.parametrize("case", REDUCED_CASES, ids=REDUCED_CASES)
def test_reduced_motion_instant(browser: Browser, app_url: str, case: str) -> None:
    restore(app_url)
    path = "/?scenario=on-work#lifestyle" if case == "meridian" else "/"
    with visit(browser, base(app_url) + path, reduced=True, record=True) as page:
        story_ready(page)
        record_announcements(page)
        if case == "opening-words":
            for w in page.locator("[data-word]").all():
                assert_instant(w, "opening word")
                s = style(w, "opacity", "transform")
                assert s["opacity"] == "1" and s["transform"] in ("none", "matrix(1, 0, 0, 1, 0, 0)"), f"word not in place: {s}"
        elif case == "pack":
            pack = region(page, "product").locator("[data-view]")
            clear_motions(page)
            choose(page.get_by_role("radiogroup", name="Pack view").get_by_role("radio", name="Side", exact=True))
            advance(page, FRAME_MS)
            assert pack.get_attribute("data-view") == "side"
            assert_instant(pack, "pack turn")
            expect_said(page, ["Showing the side of the pack."], "pack announcement")
        elif case == "meridian":
            clear_motions(page)
            choose(mode_radio(page, "OFF"))
            expect_scenario(page, "off-break")
            assert_instant(lifestyle(page), "Meridian change")
            expect_said(page, [mode_line("off-break")], "Meridian announcement")
        elif case == "menu":
            clear_motions(page)
            click(page.get_by_role("button", name="Menu", exact=True))
            dlg = menu_dialog(page)
            dlg.wait_for()
            assert_instant(dlg, "menu open")
            assert_focused(dlg.get_by_role("link", name="01 Opening", exact=True), "menu focus")
            page.keyboard.press("Escape")
            eventually(page, lambda: assert_focused(page.get_by_role("button", name="Menu", exact=True), "Menu"), "Escape")
        else:
            click(page.get_by_role("link", name="Begin the story", exact=True))
            expect_jump(page, "about", instant=True)


def test_wf_responsive_contexts_same_scenario(browser: Browser, app_url: str) -> None:
    restore(app_url)
    url = base(app_url) + "/?scenario=off-relax#lifestyle"
    for size in VIEWPORTS.values():
        with visit(browser, url, size) as page:
            story_ready(page)
            expect_scenario(page, "off-relax")
            layout(page)
            rail = page.get_by_role("navigation", name="Chapters", exact=True)
            assert (rail.count() > 0 and rail.first.is_visible()) == (size == DESKTOP)
    assert_json(api(app_url, "GET", "/api/scenarios/off-relax"), 200, SCENARIOS["off-relax"])


def test_wf_responsive_contexts_publish_midway(browser: Browser, app_url: str) -> None:
    restore(app_url)
    body = seed_body()
    body["product"]["name"] = f"Pace Midway {tag()}"
    url = base(app_url) + "/?scenario=on-work#product"
    with visit(browser, url, DESKTOP) as wide, visit(browser, url, PHONE) as narrow:
        story_ready(wide)
        story_ready(narrow)
        assert_json(grading(app_url, "PUT", body), 200, {"edition": 2})
        try:
            for page in (wide, narrow):
                advance(page, SETTLE_MS)
                assert region(page, "product").count() == 1, "an open page swapped its product"
                assert region(page, "product").get_by_text("Content edition 1", exact=True).count() == 1
            with visit(browser, url, TABLET) as fresh:
                story_ready(fresh)
                eventually(fresh, lambda: assert_eq(region(fresh, "product", body["product"]["name"]).get_by_text("Content edition 2", exact=True).count(), 1), "fresh browser")
            assert assert_json(api(app_url, "GET", "/api/content"), 200)["edition"] == 2
        finally:
            restore(app_url)


@pytest.mark.parametrize("size_id", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_published_layouts(browser: Browser, app_url: str, size_id: str) -> None:
    restore(app_url)
    size = VIEWPORTS[size_id]
    with visit(browser, base(app_url) + "/", size) as page:
        story_ready(page)
        banner = page.get_by_role("banner")
        b = banner.bounding_box()
        assert b and abs(b["height"] - HEADER_PX) <= PX_EPS and abs(b["y"]) <= PX_EPS
        assert style(banner, "position")["position"] == "fixed"
        site = page.get_by_role("navigation", name="Site", exact=True)
        rail = page.get_by_role("navigation", name="Chapters", exact=True)
        wide = size_id == "1280x800"
        assert (site.count() > 0 and site.first.is_visible()) == wide
        assert (rail.count() > 0 and rail.first.is_visible()) == wide
        assert page.get_by_role("button", name="Menu", exact=True).is_visible()
        cards = [li.bounding_box() for li in page.get_by_role("list", name="Interviews", exact=True).get_by_role("listitem").all()]
        lefts, tops = distinct([c["x"] for c in cards]), distinct([c["y"] for c in cards])
        if wide:
            rail_right = rail.bounding_box()["x"] + rail.bounding_box()["width"]
            for chapter in CHAPTER_IDS:
                assert chapter_heading(page, chapter).bounding_box()["x"] >= rail_right - PX_EPS, f"{chapter} sits under the rail"
            assert (len(lefts), len(tops)) == (3, 2), f"interview grid {lefts} {tops}"
        elif size_id == "768x1024":
            assert (len(lefts), len(tops)) == (2, 3), f"interview grid {lefts} {tops}"
        else:
            assert len(tops) == 1, "interviews are not one row"
        pack = region(page, "product").get_by_role("img", name=re.compile(r" pack, front view$")).bounding_box()
        info = info_tabs(page).bounding_box()
        if wide:
            assert pack["x"] + pack["width"] <= info["x"] + PX_EPS and abs(pack["y"] - info["y"]) <= LAYOUT_TOP_PX
        else:
            assert pack["y"] + pack["height"] <= info["y"] + PX_EPS
        stops = [box(r) for r in moments(page).get_by_role("radio").all()]
        stop_tops, stop_lefts = distinct([s["y"] for s in stops]), distinct([s["x"] for s in stops])
        assert (len(stop_tops), len(stop_lefts)) == ((2, 2) if size_id == "375x812" else (1, 4)), f"stops {stops}"
        footer = page.get_by_role("navigation", name="Footer", exact=True)
        links = [footer.get_by_role("link", name=n, exact=True) for n in FOOTER_LINKS]
        assert all(link.count() == 1 for link in links) and in_dom_order(page, links)
        if wide:
            assert len(distinct([link.bounding_box()["y"] for link in links])) == 1, "footer links are not one row"


def test_one_edition_across_browsers(browser: Browser, app_url: str) -> None:
    restore(app_url)
    t = tag()
    body = seed_body()
    body["interviews"][0]["name"] = f"Mina Newname {t}"
    sports = next(s for s in body["scenarios"] if s["id"] == "on-sports")
    sports["title"] = f"Fresh climb {t}"
    with visit(browser, base(app_url) + "/?scenario=on-work#lifestyle") as page:
        story_ready(page)
        record_announcements(page)
        assert_json(grading(app_url, "PUT", body), 200, {"edition": 2})
        try:
            choose(moment_radio(page, "on-sports"))
            expect_scenario(page, "on-sports", sports["title"])
            expect_said(page, [mode_line("on-sports", sports["title"])], "fresh scenario announced")
            assert interview_names(page) == [iv["name"] for iv in SEED_INTERVIEWS], "open page swapped its interviews"
            assert region(page, "product").get_by_text("Content edition 1", exact=True).count() == 1
            with visit(browser, base(app_url) + "/#interviews") as fresh:
                story_ready(fresh)
                assert interview_names(fresh)[0] == body["interviews"][0]["name"]
        finally:
            restore(app_url)


def test_responsive_meridian_keyboard(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for size in VIEWPORTS.values():
        with visit(browser, base(app_url) + "/?scenario=on-hobby#lifestyle", size) as page:
            story_ready(page)
            expect_scenario(page, "on-hobby")
            record_announcements(page)
            moment_radio(page, "on-hobby").focus()
            for sid in ("on-housework", "on-work"):
                page.keyboard.press("ArrowRight")
                expect_scenario(page, sid)
            expect_said(page, [mode_line("on-housework"), mode_line("on-work")], f"keyboard moves announced once at {size}")
            assert_focused(moment_radio(page, "on-work"), f"focus follows the checked stop at {size}")
            layout(page)


def test_wf_about_story_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#about", PHONE) as page:
        story_ready(page)
        about = region(page, "about")
        nxt = about.get_by_role("button", name="Next panel", exact=True)
        nxt.focus()
        page.keyboard.press("Enter")
        advance(page, ROW_BUTTON_MS)
        eventually(page, lambda: assert_eq(about_state(page)["panel"], "2"), "Next panel moves to panel 2")
        focus_walk(page, about, nxt, "Shift+Tab", "Inner Pace by keyboard at 375")


def test_wf_product_sheet_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product", TABLET) as page:
        story_ready(page)
        focus_walk(page, region(page, "product"), sheet_button(page), "Shift+Tab", "Product by keyboard at 768")


def test_wf_product_keyboard_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product") as page:
        story_ready(page)
        focus_walk(page, region(page, "product"), sheet_button(page), "Shift+Tab", "Product by keyboard at 1280")


def test_wf_interview_browse_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#interviews", PHONE) as page:
        story_ready(page)
        last = page.get_by_role("list", name="Interviews", exact=True).get_by_role("link").last
        focus_walk(page, region(page, "interviews"), last, "Shift+Tab", "Interviews by keyboard at 375")


def test_wf_on_off_switch_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#lifestyle", PHONE) as page:
        story_ready(page)
        focus_walk(page, lifestyle(page), moment_radio(page, "on-work"), "Shift+Tab", "Mode by keyboard at 375")


def test_wf_scenario_select_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    on = [sid for sid in SCENARIO_ORDER if sid.startswith("on-")]
    with visit(browser, base(app_url) + f"/?scenario={on[-1]}#lifestyle", PHONE) as page:
        story_ready(page)
        focus_walk(page, lifestyle(page), moment_radio(page, on[-1]), "ArrowLeft", "Moments by arrow keys at 375", len(on) - 1)
        expect_scenario(page, on[0])


def test_wf_keyboard_journey_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#science") as page:
        story_ready(page)
        sci = region(page, "science")
        focus_walk(page, sci, sci.get_by_role("slider", name="Nitrate pathway", exact=True), "Shift+Tab", "Science by keyboard at 1280")


def test_wf_motion_reduced_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    with visit(browser, base(app_url) + "/#product", reduced=True) as page:
        story_ready(page)
        focus_walk(page, region(page, "product"), sheet_button(page), "Shift+Tab", "Product by keyboard with reduced motion")


def test_wf_responsive_contexts_focus_clear_of_header(browser: Browser, app_url: str) -> None:
    restore(app_url)
    for size_id in VIEWPORT_IDS:
        with visit(browser, base(app_url) + "/?scenario=off-rest#product", VIEWPORTS[size_id]) as page:
            story_ready(page)
            focus_walk(page, region(page, "product"), sheet_button(page), "Shift+Tab", f"Product by keyboard at {size_id}")


APP_DIR = Path("/app")
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}


def test_if_run_manifest(app_url: str) -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))
    assert api(app_url, "GET", "/api/health").status_code == 200


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"notices miss {missing}"
    for font in ("Shippori Mincho", "Zen Kaku Gothic New"):
        assert font in notices, f"notices miss {font}"
    assert "OFL" in notices


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not bad, f"disallowed licences {bad}"


def test_if_postgres_only(app_url: str) -> None:
    body = seed_body()
    body["product"]["name"] = f"Pace Store {tag()}"
    with published(app_url, body):
        pg = Postgres()
        tables = pg.rows("SELECT table_schema AS s, table_name AS t FROM information_schema.tables "
                         "WHERE table_type = 'BASE TABLE' AND table_schema NOT IN ('pg_catalog', 'information_schema')")
        name = body["product"]["name"]
        found = any(pg.rows(f"SELECT count(*) AS n FROM \"{r['s']}\".\"{r['t']}\" x WHERE row_to_json(x)::text LIKE '%{name}%'")[0]["n"] for r in tables)
        assert found, "the published record is not stored in Postgres"


def test_if_same_origin_only(browser: Browser, app_url: str) -> None:
    restore(app_url)
    foreign: list[str] = []
    with visit(browser, base(app_url) + "/") as page:
        page.on("request", lambda r: foreign.append(r.url) if not r.url.startswith(("data:", "blob:")) and not same_origin(r.url, app_url) else None)
        for path in ("/", "/store", "/interviews/mina-okabe", "/contact"):
            page.goto(base(app_url) + path)
            page_ready(page)
            advance(page, SETTLE_MS)
    assert not foreign, f"cross-origin requests {foreign}"


def test_if_strict_typescript() -> None:
    raw = "\n".join(f.read_text(errors="replace") for f in APP_DIR.rglob("tsconfig*.json") if "node_modules" not in f.parts)
    assert re.search(r'"strict"\s*:\s*true', raw), "strict is not on"
    hits = [str(f) for f in APP_DIR.rglob("*") if f.suffix in (".ts", ".tsx", ".mts", ".cts") and "node_modules" not in f.parts
            and re.search(r"@ts-(ignore|nocheck|expect-error)", f.read_text(errors="replace"))]
    assert not hits, f"suppression comments in {hits}"
