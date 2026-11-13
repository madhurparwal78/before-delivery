from __future__ import annotations

import concurrent.futures
import contextlib
import hashlib
import io
import json
import math
import os
import re
import tarfile
import threading
import time
import unicodedata
import uuid
import zipfile
from contextlib import contextmanager
from decimal import ROUND_HALF_EVEN, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, unquote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, Route, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    S3,
    Mailpit,
    Postgres,
    addresses,
    advance,
    capture,
    center,
    changed,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    licence_allowed,
    open_app,
    post_json,
    same_origin,
    select,
    session,
    shipped_packages,
    tab_order,
    text,
    unique,
    until,
)


NNBSP = "\u202f"
THIN = "\u2009"
MINUS = "\u2212"

EVAL_DEBOUNCE_MS = 400
SLOW_EVAL_NOTICE_MS = 3000
EVAL_TIMEOUT_MS = 8000
LIVE_SECONDS = 2
PAGE_SIZE = 12
BODY_LIMIT = 65536
RETRY_AFTER_MAX = 86400
TIGHT_TTL_SECONDS = 3
TIGHT_COMMENT_MAX = 40
SCRUB_PX = 4
GLIDE_MIN_MS = 400
GLIDE_MAX_MS = 560
DISCLOSURE_MIN_MS = 160
DISCLOSURE_MAX_MS = 240
HERO_STILL_MS = 200
MM_PER_PX = 0.2645833
PX_PER_INCH = 96
INCH_MM = 25.4
HERO_SPAN_MIN = 40
HERO_SPAN_MAX = 400
OVERFLOW_WIDTHS = [320, 375, 390, 768, 1024]
OVERFLOW_HEIGHT = 812
PHONE = (390, 844)
TABLET = (768, 1024)
WIDE = (1280, 800)
LAYOUT_SIZES = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}
VERTEX_DOT_PX = 8
HERO_DOT_WIDE_PX = 14
HERO_DOT_NARROW_PX = 10
STORAGE_RETRY_AFTER = "5"
EVALUATOR_DELAY_MAX = 600000
CONTRAST_TEXT = 4.5
CONTRAST_ICON = 3

PASSWORD = "bench-seed-2026"
ENGINE = "tine-1.4.0"

CATEGORY_SLUGS = ["hardware", "organisers", "brackets", "plumbing", "enclosure-parts", "jigs"]
SEED_TITLES = {
    "twin-hole-plate": "Twin-hole plate",
    "peg-rail": "Peg rail",
    "cable-comb": "Cable comb",
    "hinge-leaf": "Hinge leaf",
    "spacer-ring": "Spacer ring",
    "shelf-bracket": "Shelf bracket plate",
    "jig-fence-block": "Jig fence block",
}

EMPTY_SOLID = '{"ops":[]}'
TWIN_SOLID = '{"ops":[{"d":40,"h":8,"op":"box","w":60},{"dia":5,"op":"hole","x":-20,"y":0},{"dia":5,"op":"hole","x":20,"y":0}]}'
TWIN_SOURCE_LINES = [
    "# twin-hole-plate",
    "param width = 60 mm min 20 max 200",
    "param depth = 40 mm min 20 max 200",
    "param thickness = 8 mm min 2 max 30",
    "param holeDia = 5 mm min 2 max 20",
    "param holeSpacing = 40 mm min 0 max 180",
    "box width depth thickness",
    "hole holeDia at -holeSpacing/2 0",
    "hole holeDia at holeSpacing/2 0",
]

UPDATED_DEFAULT = f"Updated: 18{THIN}885.84{NNBSP}mm³"
SUPERSEDED = "Superseded by a newer change."
SLOW_NOTICE = "Still evaluating. Large parts can take a few seconds."
STALE_BANNER = "This report describes an earlier configuration. Run pre-flight again to update it."
SIGN_IN_MORE = "Sign in to run more pre-flight reports."
STORAGE_BANNER = "Part storage is unreachable. Viewing and discussion still work."
DOWNLOAD_OUTAGE = "Downloads are paused: part storage is unreachable. Your parts are safe; try again in a few minutes."
SAVE_OUTAGE = "Saving is paused: part storage is unreachable. Your parts are safe; try again in a few minutes."
REPLAY_OUTAGE = "Replay is paused: part storage is unreachable."
NO_CHANGE = "No geometric change: both revisions evaluate to the same solid."
EXPIRED_LINK = "This link has expired or was already used."
ESTIMATE_LINE = "Estimate from geometry alone. Not a quote: no supplier has seen this part."
NOT_SENT = "Not sent yet. Try again."
ROOM_CLOSED = "This review room is closed."
HEADLINE = "Parts that fit the thing you measured."
MILL = "Three-axis mill"
LASER = "Laser-cut sheet"
FDM_NAME = re.compile(r"^FDM print, 0\.4\smm nozzle$")
JIG_MILL_FINDINGS = [
    ("Blocking", f"Hole 1 is 8× deeper than its diameter; {MILL} allows at most 6×."),
    ("Blocking", f"Hole 2 is 8× deeper than its diameter; {MILL} allows at most 6×."),
    ("Advisory", f"Wall beside Hole 1 is 1.2{NNBSP}mm; {MILL} needs at least 1.5{NNBSP}mm."),
    ("Advisory", f"Wall beside Hole 2 is 1.2{NNBSP}mm; {MILL} needs at least 1.5{NNBSP}mm."),
]
TWIN_LASER = f"Part is 60 × 40 × 8{NNBSP}mm; the {LASER} envelope is 600 × 400 × 6{NNBSP}mm."
UNSUPPORTED = "Laser-cut sheet needs a part of one uniform thickness."

PEG_TAPE = [
    (0, "start", "empty", None),
    (1, "params", "param length", 2),
    (2, "params", "param depth", 3),
    (3, "params", "param thickness", 4),
    (4, "params", "param pegCount", 5),
    (5, "params", "param pegPitch", 6),
    (6, "params", "param pegDia", 7),
    (7, "params", "param pegHeight", 8),
    (8, "body", "box", 9),
    (9, "params", "repeat", 10),
    (10, "join", "boss", 11),
]

POSE = {"position": [60, -60, 60], "target": [0, 0, 4], "up": [0, 0, 1], "fov": 35}

SECTION_TITLE = "Mount"
PEG_CONFIG = "pegCount=1,pegPitch=45"
FORK_OP = 7
OFFSITE_NEXT = "/" + "/offsite.test/x"
STEPPED_SOURCE = f'# stepped\nparam span2 = 2500 mm min 100 max 5000\nsection "{SECTION_TITLE}"\nparam gap = 2.5 mm min 1 max 9 step 0.25\nbox span2 20 5\n'
GAP_SOURCE = "# gap\nparam gap = 10 mm\nbox 40-gap*2 20 5\n"
MANY_SOURCE = "# many\nparam copies = 1 count min 0\nbox 3000 100 5\nrepeat copies 10 {\nhole 1 at 0 0\n}\n"
ZERO_SOURCE = "# zero\nparam offset = 0 mm min -10 max 10\nbox 40 20 5\nhole 4 at offset 0\n"
ORDER_SOURCE = "# order\nbox 320 20 50\nhole 5 at -100 0\nhole 4 at 100 0\n"
PUBLISH_SOURCE = "# shelf\nparam width = 60 mm min 20 max 200\nbox width 30 5\nhole 4 at 0 0\n"

HTTP_TIMEOUT = 30.0
STEP_MS = 50
EVENTUAL_S = 30.0
STREAM_OPEN_S = 15.0
STREAM_READ_S = 30.0
QUIET_S = 3.0
POSE_TOLERANCE = 0.002
TAB_PRESSES = 60
CANCEL_DEADLINE_S = 6.0
ABORT_AFTER_S = 1.0
PAGE_WALK_LIMIT = 200
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
APP = Path("/app")


def dropped_row(names: list[str]) -> str:
    return f"{'Advisory'}: Dropped from the link: {', '.join(names)}"


def highlighted_line(page: Page) -> str | None:
    return page.evaluate("""() => { const e = document.querySelector('[data-line][aria-current="true"]');
      return e && e.getAttribute('data-line'); }""")


def tok() -> str:
    return uuid.uuid4().hex[:8]


def sha(data: str | bytes) -> str:
    raw = data.encode("utf-8") if isinstance(data, str) else data
    return hashlib.sha256(raw).hexdigest()


def half_even(value: float, places: int) -> str:
    return str(Decimal(value).quantize(Decimal(1).scaleb(-places), rounding=ROUND_HALF_EVEN))


def fresh_email(prefix: str) -> str:
    parts = unique(prefix)
    for part in parts:
        if "@" in part:
            return part
    return f"{parts[0]}-{tok()}@gimbrel.test"


def person(key: str, email: str | None = None) -> dict[str, Any]:
    return {"key": key, "email": email or fresh_email(key), "password": PASSWORD,
            "displayName": f"{key.capitalize()} {tok()}", "verified": True}


def part_spec(key: str = "part", owner: str = "owner", from_: str = "twin-hole-plate",
              visibility: str = "public", title: str | None = None) -> dict[str, Any]:
    return {"key": key, "owner": owner, "from": from_, "slug": f"{from_}-{tok()}",
            "visibility": visibility, "title": title or f"{SEED_TITLES[from_]} {tok()}"}


def source_spec(key: str, source: str, owner: str = "owner", title: str | None = None,
                category: str = "hardware", visibility: str = "public") -> dict[str, Any]:
    return {"key": key, "owner": owner, "slug": f"src-{tok()}", "title": title or f"Bench part {tok()}",
            "category": category, "visibility": visibility, "source": source}


def rev_spec(key: str, values: dict[str, Any], part: str = "part", author: str = "owner",
             message: str | None = None) -> dict[str, Any]:
    return {"key": key, "part": part, "author": author, "values": values, "message": message or f"Bench {key}"}


def room_spec(key: str = "room", part: str = "part", owner: str = "owner",
              reviewers: tuple[str, ...] = ("rev1", "rev2")) -> dict[str, Any]:
    return {"key": key, "part": part, "owner": owner, "title": f"Room {tok()}", "reviewers": list(reviewers)}


class World:
    def __init__(self, base: str, data: dict[str, Any], people: dict[str, dict[str, Any]],
                 parts: dict[str, dict[str, Any]], rooms: dict[str, dict[str, Any]]):
        self.base, self.data, self.people, self.parts, self.rooms = base, data, people, parts, rooms

    def cookie(self, key: str = "owner") -> str:
        return self.data["users"][key]["cookie"]

    def uid(self, key: str = "owner") -> str:
        return self.data["users"][key]["id"]

    def name(self, key: str = "owner") -> str:
        return self.people[key]["displayName"]

    def email(self, key: str = "owner") -> str:
        return self.people[key]["email"]

    def slug(self, key: str = "part") -> str:
        return self.data["parts"][key]["slug"]

    def title(self, key: str = "part") -> str:
        return self.parts[key]["title"]

    def rev(self, key: str) -> str:
        return self.data["revisions"][key]["id"]

    def room(self, key: str = "room") -> str:
        return self.data["rooms"][key]["id"]

    def room_title(self, key: str = "room") -> str:
        return self.rooms[key]["title"]


def setup(base: str, body: dict[str, Any]) -> dict[str, Any]:
    response = post_json(base, "/api/grading/setup", body)
    assert response.status_code == 201, f"POST /api/grading/setup answered {response.status_code}: {response.text}"
    return response.json()


def world(base: str, people: tuple[str, ...] = ("owner",), parts: list[dict[str, Any]] | None = None,
          revisions: list[dict[str, Any]] | None = None, rooms: list[dict[str, Any]] | None = None,
          comments: list[dict[str, Any]] | None = None, approvals: list[dict[str, Any]] | None = None,
          likes: list[dict[str, Any]] | None = None, emails: dict[str, str] | None = None) -> World:
    folks = {key: person(key, (emails or {}).get(key)) for key in people}
    body: dict[str, Any] = {"users": list(folks.values())}
    for name, value in (("parts", parts), ("revisions", revisions), ("rooms", rooms),
                        ("comments", comments), ("approvals", approvals), ("likes", likes)):
        if value:
            body[name] = value
    data = setup(base, body)
    return World(base, data, folks, {p["key"]: p for p in parts or []}, {r["key"]: r for r in rooms or []})


def call(method: str, base: str, path: str, cookie: str | None = None, body: Any = None, **headers: str) -> httpx.Response:
    if cookie:
        headers["Cookie"] = cookie
    kwargs: dict[str, Any] = {"json": body} if body is not None else {}
    return httpx.request(method, base + path, headers=headers, timeout=HTTP_TIMEOUT, follow_redirects=False, **kwargs)


def post(base: str, path: str, body: Any, cookie: str | None = None, key: str | None = None, **headers: str) -> httpx.Response:
    if cookie:
        headers["Cookie"] = cookie
    return post_json(base, path, body, key, **headers)


def raw_post(base: str, path: str, content: str | bytes, cookie: str | None = None, **headers: str) -> httpx.Response:
    headers = {"Content-Type": "application/json", **headers}
    if cookie:
        headers["Cookie"] = cookie
    return httpx.post(base + path, content=content, headers=headers, timeout=HTTP_TIMEOUT)


def part_json(base: str, slug: str, cookie: str | None = None) -> tuple[dict[str, Any], str]:
    response = call("GET", base, f"/api/parts/{slug}", cookie)
    assert response.status_code == 200, f"GET /api/parts/{slug} answered {response.status_code}"
    return response.json(), response.headers.get("ETag", "")


def revisions(base: str, slug: str, cookie: str | None = None) -> list[dict[str, Any]]:
    response = call("GET", base, f"/api/parts/{slug}/revisions", cookie)
    assert response.status_code == 200, f"GET revisions answered {response.status_code}"
    return response.json()["revisions"]


def save(base: str, slug: str, values: dict[str, Any], cookie: str, tag: str | None,
         message: str = "Bench save", key: str | None = None) -> httpx.Response:
    headers = {"If-Match": tag} if tag is not None else {}
    return post(base, f"/api/parts/{slug}/revisions", {"values": values, "message": message}, cookie, key, **headers)


def restore(base: str, slug: str, revision_id: str, cookie: str, tag: str | None, key: str | None = None) -> httpx.Response:
    headers = {"If-Match": tag} if tag is not None else {}
    return post(base, f"/api/parts/{slug}/revisions/{revision_id}/restore", {}, cookie, key, **headers)


def fork(base: str, revision_id: str, operation: int, cookie: str, tag: str | None) -> httpx.Response:
    headers = {"If-Match": tag} if tag is not None else {}
    return post(base, f"/api/revisions/{revision_id}/fork", {"operation": operation}, cookie, **headers)


def evaluate(base: str, slug: str, values: dict[str, Any], viewer: str | None = None, seq: int = 1) -> httpx.Response:
    return post(base, "/api/evaluations", {"partSlug": slug, "values": values, "seq": seq,
                                           "viewerId": viewer or str(uuid.uuid4())})


def eval_digest(base: str, slug: str, values: dict[str, Any]) -> str:
    response = evaluate(base, slug, values)
    assert response.status_code == 200 and response.json()["status"] == "succeeded", response.text
    return response.json()["geometryDigest"]


def counts(base: str, viewer: str) -> dict[str, int]:
    response = call("GET", base, f"/api/grading/evaluations?viewerId={viewer}")
    assert response.status_code == 200
    return response.json()


def set_delay(base: str, slug: str, ms: int) -> None:
    response = post(base, "/api/grading/evaluator-delay", {"partSlug": slug, "ms": ms})
    assert response.status_code == 204, f"evaluator-delay answered {response.status_code}"


def poll(check: Callable[[], Any], contract: str, seconds: float = EVENTUAL_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
    pytest.fail(contract)


def mails_to(mail: Mailpit, address: str, subject: str, expected: int = 1, seconds: float = 45.0) -> list[dict[str, Any]]:
    found: list[dict[str, Any]] = []
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = [m for m in mail.messages()
                 if address.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]
        if len(found) >= expected:
            return found
    pytest.fail(f"Mailpit held {expected} '{subject}' mail(s) for {address}; found {len(found)}")


def wait_real(base: str, seconds_from: float, seconds: float) -> None:
    target = seconds_from + seconds
    while time.monotonic() < target:
        httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)


def config_of(url: str) -> str | None:
    for item in urlparse(url).query.split("&"):
        if item.startswith("config="):
            return unquote(item[len("config="):])
    return None


def query_of(url: str) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(url).query, keep_blank_values=True).items()}


def pg_quiet(base: str) -> None:
    pg = Postgres()
    sql = ("SELECT count(*) AS n FROM pg_stat_activity WHERE datname = current_database() "
           "AND usename <> current_user AND state IN ('active', 'idle in transaction')")
    poll(lambda: pg.rows(sql)[0]["n"] == 0,
         "no app session stays active or idle in transaction after clients left (L1415)", seconds=20.0)
    assert httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).status_code == 200


class Stream:

    def __init__(self, base: str, path: str, cookie: str | None = None, last_id: int | str | None = None):
        self.lines: list[str] = []
        self.events: list[dict[str, Any]] = []
        self.status: int | None = None
        self.ended = threading.Event()
        self.opened = threading.Event()
        self._changed = threading.Condition()
        headers = {"Accept": "text/event-stream"}
        if cookie:
            headers["Cookie"] = cookie
        if last_id is not None:
            headers["Last-Event-ID"] = str(last_id)
        threading.Thread(target=self._run, args=(base + path, headers), daemon=True).start()
        if not self.opened.wait(STREAM_OPEN_S):
            pytest.fail(f"GET {path} opened an event stream with its retry line")

    def _run(self, url: str, headers: dict[str, str]) -> None:
        current: dict[str, Any] = {}
        try:
            with httpx.stream("GET", url, headers=headers,
                              timeout=httpx.Timeout(HTTP_TIMEOUT, read=STREAM_READ_S)) as response:
                self.status = response.status_code
                for line in response.iter_lines():
                    with self._changed:
                        self.lines.append(line)
                        self.opened.set()
                        if line == "":
                            if "event" in current:
                                current["data"] = json.loads(current.get("data", "null"))
                                self.events.append(current)
                            current = {}
                        elif not line.startswith(":"):
                            field, _, value = line.partition(":")
                            value = value[1:] if value.startswith(" ") else value
                            if field == "data" and "data" in current:
                                current["data"] += "\n" + value
                            else:
                                current[field] = value
                        self._changed.notify_all()
        except httpx.HTTPError:
            pass
        finally:
            self.opened.set()
            self.ended.set()
            with self._changed:
                self._changed.notify_all()

    def wait_for(self, predicate: Callable[[list[dict[str, Any]]], bool], seconds: float, contract: str) -> list[dict[str, Any]]:
        deadline = time.monotonic() + seconds
        with self._changed:
            while time.monotonic() < deadline:
                if predicate(self.events):
                    return list(self.events)
                if self.ended.is_set():
                    break
                self._changed.wait(timeout=max(0.0, deadline - time.monotonic()))
            if predicate(self.events):
                return list(self.events)
        pytest.fail(contract)

    def quiet(self, count: int, seconds: float = QUIET_S) -> bool:
        deadline = time.monotonic() + seconds
        with self._changed:
            while time.monotonic() < deadline and not self.ended.is_set():
                if len(self.events) > count:
                    return False
                self._changed.wait(timeout=max(0.0, deadline - time.monotonic()))
            return len(self.events) <= count


def of_type(events: list[dict[str, Any]], kind: str) -> list[dict[str, Any]]:
    return [e for e in events if e.get("event") == kind]


VIEWPORT = '[data-ui="viewport"]'
SETTLED_JS = """s => { const v = document.querySelector('[data-ui="viewport"]');
  return !!v && v.getAttribute('data-eval-state') === 'settled' && Number(v.getAttribute('data-seq') || 0) > s; }"""
STATE_JS = """s => { const v = document.querySelector('[data-ui="viewport"]'); return !!v && v.getAttribute('data-eval-state') === s; }"""
MOVING_STOPPED_JS = """() => { const v = document.querySelector('[data-ui="viewport"]'); return !!v && v.getAttribute('data-camera-moving') !== 'true'; }"""
HEADLINE_WIDTHS_JS = """h => { const r = document.createRange(); r.selectNodeContents(h);
  return [h.getBoundingClientRect().width, r.getBoundingClientRect().width]; }"""
OVERFLOW_JS = """() => { const s = document.scrollingElement; return [s.scrollWidth, s.clientWidth]; }"""
ANIMATIONS_JS = """root => document.getAnimations().filter(a => { const t = a.effect && a.effect.target;
  return t && (root.contains(t) || t.contains(root)); }).map(a => { const c = a.effect.getComputedTiming();
  return { duration: Number(c.duration) || 0, iterations: c.iterations === Infinity ? -1 : c.iterations }; })"""
COMPOSING_JS = """(el, key) => el.dispatchEvent(new KeyboardEvent('keydown', { key, code: key.length === 1 ? 'Key' + key.toUpperCase() : key, isComposing: true, bubbles: true, cancelable: true }))"""
CONTRAST_JS = r"""
(root) => {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const rgba = (c) => {
    if (!c || c === 'none' || c.startsWith('url')) return null;
    ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = 'rgba(0,0,0,0)'; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255];
  };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
  const ground = (el) => { for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
    const c = rgba(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) return c; } return [255, 255, 255, 1]; };
  const fade = (el) => { let o = 1; for (let n = el; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; };
  const ratio = (fg, el) => { const bg = ground(el); const a = fg[3] * fade(el);
    const mix = [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a)); const l1 = lum(mix), l2 = lum(bg);
    return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const text = [], icons = [];
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (el.closest('svg')) {
      if (el.tagName.toLowerCase() === 'svg') {
        let best = 0;
        for (const p of [el, ...el.querySelectorAll('*')]) { const s = getComputedStyle(p);
          for (const c of [s.fill, s.stroke]) { const v = rgba(c); if (v && v[3] > 0) best = Math.max(best, ratio(v, el.parentElement || el)); } }
        icons.push(best);
      }
      continue;
    }
    if ([...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim())) {
      const c = rgba(getComputedStyle(el).color); text.push(c ? ratio(c, el) : 0);
    }
  }
  return { text, icons };
}
"""


@contextmanager
def visit(browser: Browser, base: str, path: str, cookie: str | None = None,
          size: tuple[int, int] | None = None, prepare: Callable[[Page], None] | None = None,
          **options: Any) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", **options) as page:
        if size:
            page.set_viewport_size({"width": size[0], "height": size[1]})
        if cookie:
            name, _, value = cookie.partition("=")
            page.context.add_cookies([{"name": name, "value": value, "url": base}])
        if prepare:
            prepare(page)
        page.goto(base + path)
        yield page


def viewport(page: Page):
    return page.locator(VIEWPORT).first


def vp(page: Page, attribute: str) -> str | None:
    return viewport(page).get_attribute(attribute)


def seq_of(page: Page) -> int:
    return int(vp(page, "data-seq") or 0)


def spin(page: Page, label: str):
    return page.get_by_role("spinbutton", name=label, exact=True)


def status(page: Page, name: str):
    return page.get_by_role("status", name=name, exact=True)


def eventually(page: Page, check: Callable[[], Any], contract: str, seconds: float = EVENTUAL_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except PlaywrightError:
            pass
        advance(page, STEP_MS)
    pytest.fail(contract)


def shows(locator, expected: str) -> Callable[[], bool]:
    return lambda: locator.count() > 0 and expected in locator.first.inner_text()


def wait_settled(page: Page, after: int) -> None:
    advance(page, EVAL_DEBOUNCE_MS + 1)
    until(page, SETTLED_JS, after)


def commit(locator, value: str) -> None:
    fill(locator, value)
    locator.press("Enter")


def pose_numbers(pose: dict[str, Any]) -> list[float]:
    return [*pose["position"], *pose["target"], pose["fov"]]


def at_pose(page: Page, pose: dict[str, Any]) -> bool:
    raw = vp(page, "data-camera") or ""
    numbers = [float(x) for x in raw.split(",") if x]
    want = pose_numbers(pose)
    return len(numbers) == 7 and all(abs(a - b) <= POSE_TOLERANCE for a, b in zip(numbers, want))


def option_names(listbox) -> list[str]:
    options = listbox.get_by_role("option")
    return [(options.nth(i).get_attribute("aria-label") or options.nth(i).inner_text()).strip()
            for i in range(options.count())]


def touch(page: Page, kind: str, x: float | None = None, y: float | None = None) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    points = [] if kind in ("touchEnd", "touchCancel") else [{"x": x, "y": y, "id": 1}]
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def eval_requests(page: Page) -> list[dict[str, Any]]:
    seen: list[dict[str, Any]] = []

    def record(request) -> None:
        if request.method == "POST" and urlparse(request.url).path == "/api/evaluations":
            seen.append(json.loads(request.post_data or "{}"))

    page.on("request", record)
    return seen


def run_preflight(page: Page, process: str | re.Pattern[str]) -> dict[str, Any]:
    click(page.get_by_role("radio", name=process))
    with page.expect_response(lambda r: urlparse(r.url).path == "/api/preflight" and r.request.method == "POST") as info:
        click(page.get_by_role("button", name=re.compile(r"^Run pre-flight")))
    response = info.value
    assert response.status == 201, f"POST /api/preflight answered {response.status}"
    return response.json()


def test_parameter_manifest(app_url: str) -> None:
    w = world(app_url, parts=[part_spec("plate"), part_spec("hinge", from_="hinge-leaf"),
                              part_spec("comb", from_="cable-comb"), part_spec("rail", from_="peg-rail"),
                              source_spec("stepped", STEPPED_SOURCE)])

    def manifest(key: str) -> list[dict[str, Any]]:
        return part_json(app_url, w.slug(key))[0]["manifest"]

    plate = manifest("plate")
    assert [e["name"] for e in plate] == ["width", "depth", "thickness", "holeDia", "holeSpacing"]
    assert [e["order"] for e in plate] == sorted(e["order"] for e in plate)
    width = plate[0]
    assert (width["label"], width["kind"], width["unit"], width["default"], width["min"], width["max"]) == \
        ("Width", "length", "mm", 60, 20, 200)
    assert width["step"] == 0.1 and width["precision"] == 1 and width["group"] == "Dimensions" and width["derived"] is False
    thickness = plate[2]
    assert thickness["step"] == 0.01 and thickness["precision"] == 2
    assert plate[3]["label"] == "Hole dia"

    hinge = {e["name"]: e for e in manifest("hinge")}
    assert hinge["screwSize"]["kind"] == "enum" and hinge["screwSize"]["unit"] is None
    assert hinge["screwSize"]["options"] == ["M3", "M4", "M5", "M6"] and hinge["screwSize"]["precision"] == 0
    assert hinge["screwSize"]["default"] == "M4"
    let = hinge["screwDia"]
    assert let["derived"] is True and let["kind"] == "length" and let["unit"] == "mm"
    assert let["default"] == 4.5 and let["precision"] == 2
    assert let.get("min") is None and let.get("max") is None and let.get("step") is None
    assert hinge["knuckle"]["kind"] == "boolean" and hinge["knuckle"]["unit"] is None

    comb = {e["name"]: e for e in manifest("comb")}
    assert comb["length"].get("min") is None and comb["length"].get("max") is None
    assert comb["slotCount"]["kind"] == "count" and comb["slotCount"]["step"] == 1 and comb["slotCount"]["precision"] == 0

    rail = {e["name"]: e for e in manifest("rail")}
    assert rail["pegCount"]["label"] == "Peg count" and rail["pegPitch"]["precision"] == 1

    stepped = {e["name"]: e for e in manifest("stepped")}
    assert stepped["span2"]["label"] == "Span 2"
    assert stepped["span2"]["step"] == 10 and stepped["span2"]["precision"] == 0
    assert stepped["span2"]["group"] == "Dimensions"
    assert stepped["gap"]["step"] == 0.25 and stepped["gap"]["precision"] == 2 and stepped["gap"]["group"] == SECTION_TITLE


def test_wf_keyboard_reconfigure_keys(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, title = w.slug(), w.title()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        names = tab_order(page, TAB_PRESSES)
        if "Width" not in names:
            pytest.fail(f"Tab reached spinbutton Width within {TAB_PRESSES} presses; got {names}")
        upto = names[: names.index("Width")]
        header = [f"Like {title}", "Save revision", "Download ZIP", "Download TAR"]
        for name in header:
            assert name in upto, f"{name} precedes Width in the Tab order"
        positions = [upto.index(n) for n in header]
        assert positions == sorted(positions)
        toolbar = [i for i, n in enumerate(upto) if n in ("Reset view", "Orthographic")]
        assert len(toolbar) == 1, f"the View toolbar is one Tab stop; got {upto}"
        assert toolbar[0] > positions[-1]
        assert "Build tape" in upto and toolbar[0] < upto.index("Build tape") < upto.index("Dimensions")

        page.reload()
        wait_settled(page, 0)
        for _ in range(len(upto) + 1):
            page.keyboard.press("Tab")
        width = spin(page, "Width")
        expect(width).to_be_focused()
        steps = [("ArrowUp", 60.1), ("Shift+ArrowUp", 61.1), ("Control+ArrowUp", 61.11), ("PageDown", 60.11),
                 ("ArrowRight", 60.21), ("ArrowLeft", 60.11), ("Meta+ArrowDown", 60.1), ("PageUp", 61.1),
                 ("ArrowDown", 61.0)]
        for key, expected in steps:
            page.keyboard.press(key)
            assert abs(float(width.get_attribute("aria-valuenow")) - expected) < 1e-9, f"{key} gave {width.get_attribute('aria-valuenow')}"
        seq = seq_of(page)
        commit(width, "500")
        assert float(width.get_attribute("aria-valuenow")) == 200
        page.keyboard.press("PageUp")
        assert float(width.get_attribute("aria-valuenow")) == 200
        wait_settled(page, seq)
        assert config_of(page.url) == f"width={int(float(width.get_attribute('aria-valuemax')))}"
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 200})


def test_wf_keyboard_reconfigure_markers(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        viewer = vp(page, "data-viewer-id")
        frames = page.locator('[data-ui="frame"]')
        frames_at_rest = frames.count()
        width, depth = spin(page, "Width"), spin(page, "Depth")
        seq = seq_of(page)
        commit(width, "72.5")
        commit(depth, "30")
        wait_settled(page, seq)
        expect(page.get_by_text(f"was 60.0{NNBSP}mm", exact=True)).to_be_visible()
        expect(page.get_by_text(f"was 40.0{NNBSP}mm", exact=True)).to_be_visible()
        expect(page.get_by_text("2 modified", exact=True)).to_be_visible()
        assert frames.count() == frames_at_rest + 2

        click(page.get_by_role("radio", name="Inches"))
        assert width.get_attribute("aria-valuetext") == f"2.85{NNBSP}inches"
        assert abs(float(width.get_attribute("aria-valuenow")) - 72.5 / INCH_MM) < 1e-6
        expect(page.get_by_text(f"was 60.0{NNBSP}mm", exact=True)).to_be_visible()
        seq = seq_of(page)
        commit(width, "2.401")
        wait_settled(page, seq)
        assert f"width={round(2.401 * INCH_MM, 3)}" in (config_of(page.url) or "")
        page.reload()
        wait_settled(page, 0)
        expect(page.get_by_role("radio", name="Inches")).to_be_checked()
        click(page.get_by_role("radio", name="Millimetres"))
        assert float(spin(page, "Width").get_attribute("aria-valuenow")) == 60.985

        before = counts(app_url, vp(page, "data-viewer-id") or viewer)["started"]
        seq = seq_of(page)
        click(page.get_by_role("button", name="Reset all"))
        wait_settled(page, seq)
        assert counts(app_url, vp(page, "data-viewer-id") or viewer)["started"] == before + 1
        assert page.get_by_text(re.compile(r"^was ")).count() == 0
        assert page.get_by_text(re.compile(r"^[1-9]\d* modified$")).count() == 0
        assert frames.count() == frames_at_rest


def test_wf_keyboard_reconfigure_address(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(from_="peg-rail")],
              revisions=[rev_spec("r2", {"pegCount": 1, "pegPitch": 30}), rev_spec("r3", {"pegCount": 1, "pegPitch": 45})])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        eventually(page, lambda: config_of(page.url) == PEG_CONFIG, "the loaded head writes its config (L882)")
        page.evaluate("() => { window.__twMarker = 1; }")
        history = page.evaluate("() => history.length")
        thickness = spin(page, "Thickness")
        thickness.focus()
        seq = seq_of(page)
        page.keyboard.press("ArrowUp")
        advance(page, EVAL_DEBOUNCE_MS - STEP_MS)
        assert config_of(page.url) == PEG_CONFIG, "the address waits for the evaluation debounce"
        wait_settled(page, seq)
        assert config_of(page.url) == f"{PEG_CONFIG},{'thickness'}={6 + 0.01}"
        assert page.evaluate("() => history.length") == history
        assert page.evaluate("() => window.__twMarker") == 1, "the address changed without a reload"
        seq = seq_of(page)
        click(page.get_by_role("button", name="Reset all"))
        wait_settled(page, seq)
        assert config_of(page.url) == ""
        assert page.evaluate("() => history.length") == history
    head = revisions(app_url, slug)[0]
    with visit(browser, app_url, f"/parts/{slug}?config=pegPitch=45,pegCount=1") as page:
        wait_settled(page, 0)
        assert float(spin(page, "Peg count").get_attribute("aria-valuenow")) == 1
        assert float(spin(page, "Peg pitch").get_attribute("aria-valuenow")) == 45
        assert vp(page, "data-digest") == head["geometryDigest"]


def test_readouts_update_in_place(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        assert vp(page, "data-digest") == sha(TWIN_SOLID)
        assert vp(page, "data-volume") == "18885.84"
        assert [float(x) for x in vp(page, "data-bbox").split(",")] == [60, 40, 8]
        assert vp(page, "data-faces") == "8"
        assert status(page, "Evaluation").inner_text().strip() == UPDATED_DEFAULT
        page.evaluate("() => { window.__twMarker = 1; }")
        seq = seq_of(page)
        commit(spin(page, "Width"), "72.5")
        wait_settled(page, seq)
        solid = '{"ops":[{"d":40,"h":8,"op":"box","w":72.5},{"dia":5,"op":"hole","x":-20,"y":0},{"dia":5,"op":"hole","x":20,"y":0}]}'
        assert vp(page, "data-digest") == sha(solid)
        assert vp(page, "data-volume") == f"{72.5 * 40 * 8 - 2 * math.pi * 2.5 ** 2 * 8:.2f}"
        assert [float(x) for x in vp(page, "data-bbox").split(",")] == [72.5, 40, 8]
        assert vp(page, "data-faces") == "8"
        eventually(page, lambda: status(page, "Evaluation").inner_text().strip() == f"Updated: 22{THIN}885.84{NNBSP}mm³",
                   "status Evaluation announces Updated: 22 885.84 mm³")
        expect(page.get_by_text(f"72.5 × 40 × 8{NNBSP}mm").first).to_be_visible()
        assert page.evaluate("() => window.__twMarker") == 1


def test_one_evaluation_per_burst(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        viewer, seq = vp(page, "data-viewer-id"), seq_of(page)
        before = counts(app_url, viewer)["started"]
        sent = eval_requests(page)
        spin(page, "Width").focus()
        for _ in range(5):
            page.keyboard.press("ArrowUp")
        advance(page, EVAL_DEBOUNCE_MS - STEP_MS)
        assert sent == [], "no evaluation is sent inside the debounce"
        wait_settled(page, seq)
        assert len(sent) == 1, f"one evaluation per burst; got {len(sent)}"
        assert sent[0]["seq"] == seq + 1 and sent[0]["viewerId"] == viewer
        assert abs(sent[0]["values"]["width"] - 60.5) < 1e-9
        assert counts(app_url, viewer)["started"] == before + 1


def test_evaluation_record(app_url: str) -> None:
    viewer = str(uuid.uuid4())
    response = evaluate(app_url, "twin-hole-plate", {}, viewer, 1)
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "succeeded" and body["engineVersion"] == ENGINE
    assert body["partSlug"] == "twin-hole-plate" and body["viewerId"] == viewer and body["seq"] == 1
    assert body["geometryDigest"] == sha(TWIN_SOLID) and body["solid"] == json.loads(TWIN_SOLID)
    assert body["volume"] == pytest.approx(18885.841, abs=1e-6)
    assert body["bbox"] == [60, 40, 8] and body["faces"] == 8 and body["diagnostics"] == []
    assert body["startedAt"] and body["finishedAt"]
    stored = call("GET", app_url, f"/api/evaluations/{body['id']}")
    assert stored.status_code == 200
    again = stored.json()
    for field in ("id", "status", "geometryDigest", "volume", "bbox", "faces", "solid", "seq", "viewerId", "engineVersion"):
        assert again[field] == body[field], field
    failed = evaluate(app_url, "twin-hole-plate", {"holeSpacing": 58}, viewer, 2).json()
    assert failed["status"] == "failed" and failed["geometryDigest"] is None
    assert call("GET", app_url, f"/api/evaluations/{failed['id']}").json()["status"] == "failed"
    assert counts(app_url, viewer) == {"started": 2, "completed": 2, "cancelled": 0}


def test_wf_burst_cancellation_supersede(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        viewer, seq = vp(page, "data-viewer-id"), seq_of(page)
        aborted: list[str] = []
        cancels: list[dict[str, Any]] = []
        page.on("requestfailed", lambda r: aborted.append(r.url) if urlparse(r.url).path == "/api/evaluations" else None)
        page.on("request", lambda r: cancels.append(json.loads(r.post_data or "{}"))
                if urlparse(r.url).path == "/api/evaluations/cancel" else None)
        set_delay(app_url, slug, 6000)
        width = spin(page, "Width")
        width.focus()
        page.keyboard.press("ArrowUp")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        until(page, STATE_JS, "evaluating")
        page.keyboard.press("ArrowUp")
        set_delay(app_url, slug, 0)
        eventually(page, lambda: status(page, "Evaluation").inner_text().strip() == SUPERSEDED,
                   "status Evaluation announces Superseded by a newer change.")
        eventually(page, lambda: bool(aborted) and bool(cancels), "the superseded request is aborted and cancel is called")
        assert cancels[0].get("viewerId") == viewer
        assert width.get_attribute("aria-disabled") != "true" and width.is_editable()
        page.keyboard.press("ArrowUp")
        assert abs(float(width.get_attribute("aria-valuenow")) - 60.3) < 1e-9
        wait_settled(page, seq + 1)
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 60.3})
    poll(lambda: counts(app_url, viewer)["cancelled"] == 1, "the superseded evaluation record reads cancelled")


def test_latest_result_wins(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        camera0, digest0, epoch0 = vp(page, "data-camera"), vp(page, "data-digest"), vp(page, "data-epoch")
        handled: list[str] = []

        def as_cancelled(route: Route) -> None:
            if route.request.method != "POST" or handled:
                route.continue_()
                return
            response = route.fetch()
            body = response.json()
            body["status"] = "cancelled"
            handled.append(body.get("geometryDigest") or "")
            route.fulfill(response=response, json=body)

        page.route(lambda url: urlparse(url).path == "/api/evaluations", as_cancelled)
        spin(page, "Width").focus()
        page.keyboard.press("ArrowUp")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        eventually(page, lambda: bool(handled), "the page received the cancelled answer")
        advance(page, 500)
        assert vp(page, "data-digest") == digest0 and vp(page, "data-epoch") == epoch0
        assert vp(page, "data-camera") == camera0
        page.unroute(lambda url: urlparse(url).path == "/api/evaluations")
        page.unroute_all()
        seq = seq_of(page)
        page.keyboard.press("ArrowUp")
        wait_settled(page, seq)
        assert vp(page, "data-digest") != digest0
        assert vp(page, "data-camera") == camera0, "re-evaluation never moves the camera"
        assert viewport(page).locator("canvas").count() >= 1


def test_wf_burst_cancellation_slow_notice(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        notice = page.locator('[data-ui="slow-notice"]')

        def notice_shown() -> bool:
            return notice.count() > 0 and notice.first.is_visible() and SLOW_NOTICE in notice.first.inner_text()

        set_delay(app_url, slug, 5000)
        seq = seq_of(page)
        spin(page, "Width").focus()
        page.keyboard.press("ArrowUp")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        assert vp(page, "data-eval-state") == "evaluating"
        advance(page, SLOW_EVAL_NOTICE_MS - 2 * STEP_MS)
        assert not notice_shown(), "no slow notice before the threshold"
        advance(page, 4 * STEP_MS)
        assert notice_shown(), "slow notice shown after the threshold"
        until(page, SETTLED_JS, seq)
        assert not notice_shown(), "slow notice gone once the evaluation ends"
        set_delay(app_url, slug, 0)


MEASURE_CASES = {
    "twin-hole-plate": ("twin-hole-plate", {}, 18885.841, [60, 40, 8], 8),
    "peg-rail": ("peg-rail", {}, 14656.46, [120, 18, 26], 12),
    "spacer-ring": ("spacer-ring", {}, 2587.416, [20, 20, 10], 4),
    "shelf-bracket": ("shelf-bracket", {}, 29390.957, [50, 120, 5], 14),
    "hinge-leaf-no-knuckle": ("hinge-leaf", {"knuckle": False}, 7104.574, [40, 60, 3], 8),
}


@pytest.mark.parametrize("case", list(MEASURE_CASES), ids=list(MEASURE_CASES))
def test_tine_measures(app_url: str, case: str) -> None:
    slug, values, volume, bbox, faces = MEASURE_CASES[case]
    body = evaluate(app_url, slug, values).json()
    assert body["status"] == "succeeded"
    assert body["volume"] == pytest.approx(volume, abs=1e-6)
    assert body["bbox"] == pytest.approx(bbox, abs=1e-9)
    assert body["faces"] == faces


def test_geometry_digest(app_url: str) -> None:
    body = evaluate(app_url, "twin-hole-plate", {}).json()
    digest = body["geometryDigest"]
    assert digest == sha(TWIN_SOLID)
    served = call("GET", app_url, f"/api/solids/{digest}")
    assert served.status_code == 200 and served.content == TWIN_SOLID.encode()
    assert served.headers["content-type"].startswith("application/json")
    assert S3().get(f"solids/{digest}.json") == TWIN_SOLID.encode()
    thumb = call("GET", app_url, f"/api/solids/{digest}/thumbnail.svg")
    assert thumb.status_code == 200 and thumb.headers["content-type"].startswith("image/svg+xml")
    assert f"60 × 40 × 8{NNBSP}mm" in thumb.text
    assert S3().get(f"thumbnails/{digest}.svg") == thumb.content

    a = eval_digest(app_url, "peg-rail", {"pegCount": 1, "pegPitch": 30})
    b = eval_digest(app_url, "peg-rail", {"pegCount": 1, "pegPitch": 45})
    assert a == b

    half = evaluate(app_url, "twin-hole-plate", {"holeSpacing": 30.125}).json()
    rounded = '{"ops":[{"d":40,"h":8,"op":"box","w":60},{"dia":5,"op":"hole","x":-15.062,"y":0},{"dia":5,"op":"hole","x":15.062,"y":0}]}'
    assert half["geometryDigest"] == sha(rounded)
    assert half["solid"] == json.loads(rounded)


DIAGNOSTIC_CASES = {
    "too-large": ("cable-comb", None, {"length": 20000}, "E_TOO_LARGE",
                  f"Length is 20{THIN}000{NNBSP}mm; Tine allows at most 10{THIN}000{NNBSP}mm.", "length"),
    "nonpositive": (None, GAP_SOURCE, {"gap": 25}, "E_NONPOSITIVE", f"Gap must be greater than 0{NNBSP}mm.", "gap"),
    "cut-outside": ("twin-hole-plate", None, {"holeSpacing": 58}, "E_CUT_OUTSIDE",
                    f"Hole 1 (Ø 5{NNBSP}mm) does not fit inside the 60 × 40{NNBSP}mm body.", "holeDia"),
    "overlap": ("twin-hole-plate", None, {"holeSpacing": 4}, "E_CUT_OVERLAP", "Hole 2 overlaps Hole 1.", "holeDia"),
    "too-many-operations": (None, MANY_SOURCE, {"copies": 300}, "E_TOO_MANY_OPERATIONS",
                            "Part has 301 operations after repeats; Tine allows at most 256.", None),
    "timeout": ("twin-hole-plate", None, {"width": 61}, "E_TIMEOUT", f"Evaluation stopped after 8{NNBSP}s.", None),
}


DIAGNOSTIC_IDS = ["too-large", "nonpositive", "cut-outside", "overlap", "too-many-operations", "timeout"]


@pytest.mark.parametrize("case", DIAGNOSTIC_IDS, ids=DIAGNOSTIC_IDS)
def test_diagnostics(app_url: str, case: str) -> None:
    from_, source, values, code, message, parameter = DIAGNOSTIC_CASES[case]
    spec = part_spec(from_=from_) if from_ else source_spec("part", source)
    w = world(app_url, parts=[spec])
    slug = w.slug()
    if case == "timeout":
        set_delay(app_url, slug, EVAL_TIMEOUT_MS + 1000)
    try:
        body = evaluate(app_url, slug, values).json()
    finally:
        if case == "timeout":
            set_delay(app_url, slug, 0)
    assert body["status"] == "failed"
    first = body["diagnostics"][0]
    assert (first["code"], first["message"], first["parameter"]) == (code, message, parameter)


def test_wf_absurd_value_failed_keeps_solid(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    message = f"Hole 1 (Ø 5{NNBSP}mm) does not fit inside the 60 × 40{NNBSP}mm body."
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        viewer, digest0 = vp(page, "data-viewer-id"), vp(page, "data-digest")
        spacing = spin(page, "Hole spacing")
        commit(spacing, "58")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        until(page, STATE_JS, "failed")
        assert vp(page, "data-digest") == digest0 and vp(page, "data-volume") == "18885.84"
        assert spacing.input_value() == "58"
        eventually(page, lambda: status(page, "Evaluation").inner_text().strip() == f"Could not evaluate: {message}",
                   "status Evaluation announces the diagnostic")
        assert f"Blocking: {message}" in option_names(page.get_by_role("listbox", name="Findings"))
        seq = seq_of(page)
        commit(spacing, "40")
        wait_settled(page, seq)
        assert vp(page, "data-digest") == sha(TWIN_SOLID)
        eventually(page, lambda: status(page, "Evaluation").inner_text().strip() == UPDATED_DEFAULT, "settled again")
    assert counts(app_url, viewer)["completed"] >= 3


def test_wf_absurd_value_refused_numbers(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(), source_spec("zero", ZERO_SOURCE)])
    slug = w.slug()
    for raw in ["05", "1e2", "60.0001", "-05", '"60"', '"0x3C"', '"+60"', '"60."', '"6,0"', '"٦٠"', '" 60"']:
        content = '{"partSlug":"%s","values":{"width":%s},"seq":1,"viewerId":"%s"}' % (slug, raw, uuid.uuid4())
        r = raw_post(app_url, "/api/evaluations", content)
        assert r.status_code == 422, raw
        assert r.json() == {"error": "value_grammar", "field": "width", "message": "Width takes a plain decimal such as 12.5."}, raw
    zero = w.slug("zero")
    default = eval_digest(app_url, zero, {})
    for raw in ["-0", "-0.0", "-0.000"]:
        content = '{"partSlug":"%s","values":{"offset":%s},"seq":1,"viewerId":"%s"}' % (zero, raw, uuid.uuid4())
        body = raw_post(app_url, "/api/evaluations", content).json()
        assert body["status"] == "succeeded" and body["geometryDigest"] == default, raw
    with visit(browser, app_url, f"/parts/{slug}?config=width=1e2,depth=30") as page:
        wait_settled(page, 0)
        eventually(page, lambda: config_of(page.url) == "depth=30", "the refused value leaves the address")
        assert float(spin(page, "Width").get_attribute("aria-valuenow")) == 60
        assert dropped_row(["width"]) in option_names(page.get_by_role("listbox", name="Findings"))
        sent = eval_requests(page)
        width = spin(page, "Width")
        commit(width, "1e2")
        advance(page, EVAL_DEBOUNCE_MS * 2)
        assert width.get_attribute("aria-invalid") == "true" and sent == []
        expect(page.get_by_text("Width takes a plain decimal such as 12.5.")).to_be_visible()
        seq = seq_of(page)
        commit(width, "72.5")
        wait_settled(page, seq)
        assert width.get_attribute("aria-invalid") != "true"


def test_wf_shared_configuration_open_address(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        seq = seq_of(page)
        commit(spin(page, "Width"), "72.5")
        commit(spin(page, "Depth"), "30")
        wait_settled(page, seq)
        shared, digest, volume = page.url, vp(page, "data-digest"), vp(page, "data-volume")
    with open_app(browser, shared) as other:
        wait_settled(other, 0)
        assert vp(other, "data-digest") == digest and vp(other, "data-volume") == volume
        assert float(spin(other, "Width").get_attribute("aria-valuenow")) == 72.5
    assert digest == eval_digest(app_url, w.slug(), {"width": 72.5, "depth": 30})


def test_dropped_link_values(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}?config=zeta=1,width=72.5,depth=05,thickness=500") as page:
        wait_settled(page, 0)
        eventually(page, lambda: config_of(page.url) == "width=72.5", "address rewritten without dropped values")
        assert dropped_row(["zeta", "depth", "thickness"]) in option_names(page.get_by_role("listbox", name="Findings"))
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 72.5})


def test_wf_shared_configuration_sign_up_to_save(browser: Browser, app_url: str, mail: Mailpit) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, email = w.slug(), fresh_email("saver")
    with visit(browser, app_url, f"/parts/{slug}?config=width=72.5") as page:
        wait_settled(page, 0)
        click(page.get_by_role("button", name="Save revision"))
        dialog = page.get_by_role("dialog", name="Sign up to save")
        fill(dialog.get_by_role("textbox", name="Email"), email)
        fill(dialog.get_by_role("textbox", name="Display name"), f"Saver {tok()}")
        fill(dialog.get_by_label("Password"), PASSWORD)
        click(dialog.get_by_role("button", name="Create account and send link"))
        sent = f"Check your inbox: we sent a link to {email}. It brings you back to this exact configuration."
        eventually(page, shows(dialog, sent), "the sign-up dialog confirms the mail")
        body = text(mails_to(mail, email, "Confirm your Tinework account")[0])
        link = urlparse(re.search(r"https?://\S+/auth/verify\?\S+", body).group(0))
        target = f"{app_url}{link.path}?{link.query}"
        page.goto(target)
        eventually(page, lambda: urlparse(page.url).path == f"/parts/{slug}" and config_of(page.url) == "width=72.5"
                   and "save" not in query_of(page.url), "lands on the same configuration without save=1")
        expect(page.get_by_role("dialog", name="Save revision")).to_be_visible()
        assert page.get_by_role("dialog", name="Sign up to save").count() == 0
        page.goto(target)
        eventually(page, lambda: urlparse(page.url).path == "/signin" and query_of(page.url).get("expired") == "1",
                   "a used link lands on /signin?expired=1")
        expect(page.get_by_text(EXPIRED_LINK)).to_be_visible()
    assert post(app_url, "/api/auth/signin", {"email": email, "password": PASSWORD}).status_code == 200


def test_wf_shared_configuration_copy(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec()])
    slug, title = w.slug(), w.title()
    with visit(browser, app_url, f"/parts/{slug}?config=width=72.5", cookie=w.cookie("visitor")) as page:
        wait_settled(page, 0)
        click(page.get_by_role("button", name="Save revision"))
        dialog = page.get_by_role("dialog", name="Save revision")
        note = f"This part belongs to {w.name()}. Saving makes your own copy: {title} (my configuration)."
        eventually(page, shows(dialog, note), "the save dialog names the copy")
        click(dialog.get_by_role("button", name="Save"))
        eventually(page, lambda: re.fullmatch(rf"/parts/{re.escape(slug)}-[0-9a-f]{{6}}", urlparse(page.url).path) is not None
                   and config_of(page.url) == "width=72.5", "lands on the copy with the same configuration")
        eventually(page, lambda: status(page, "Part activity").inner_text().strip() == "Saved r1.", "Saved r1. announced")
        copy = urlparse(page.url).path.split("/")[-1]
    body, _ = part_json(app_url, copy, w.cookie("visitor"))
    assert body["title"] == f"{title} (my configuration)" and body["visibility"] == "private"
    assert body["owner"]["id"] == w.uid("visitor") and body["revision"]["label"] == "r1"
    assert body["revision"]["values"]["width"] == 72.5
    assert len(revisions(app_url, slug)) == 1
    api = post(app_url, f"/api/parts/{slug}/copies", {"values": {"width": 61}, "message": "Mine"}, w.cookie("visitor"), idempotency_key())
    assert api.status_code == 201 and api.headers["Location"] == f"/api/parts/{api.json()['slug']}"


def test_accounts(app_url: str, mail: Mailpit) -> None:
    t = tok()
    email = f"STRASSE-{t}@gimbrel.test"
    nxt = "/parts/twin-hole-plate?config=width=72.5&save=1"
    r = post(app_url, "/api/auth/signup", {"email": email, "password": PASSWORD, "displayName": "Bench", "next": nxt})
    assert r.status_code == 201 and r.json() == {"status": "verification_sent"}
    assert post(app_url, "/api/auth/signin", {"email": email, "password": PASSWORD}).json()["error"] == "unverified"
    dup = post(app_url, "/api/auth/signup", {"email": f"stra\u00dfe-{t}@gimbrel.test", "password": PASSWORD, "displayName": "B", "next": "/"})
    assert dup.status_code == 409 and dup.json()["error"] == "email_taken"
    bad = post(app_url, "/api/auth/signup", {"email": "nope", "password": "short", "displayName": "", "next": "/"})
    assert bad.status_code == 422
    assert bad.json()["errors"] == {"email": "Enter a valid email address.", "password": "Use at least 10 characters.",
                                    "displayName": "Use 1 to 40 characters."}
    link = urlparse(re.search(r"https?://\S+/auth/verify\?\S+", text(mails_to(mail, email, "Confirm your Tinework account")[0])).group(0))
    assert len(mails_to(mail, email, "Confirm your Tinework account")) == 1
    verify = f"{link.path}?{link.query}"
    first = call("GET", app_url, verify)
    assert first.status_code == 303
    landed = urlparse(first.headers["Location"])
    assert f"{landed.path}?{landed.query}" == nxt
    cookie_header = first.headers.get("set-cookie", "")
    assert "tw_session=" in cookie_header and "HttpOnly".lower() in cookie_header.lower() and "SameSite=Lax".lower() in cookie_header.lower()
    again = call("GET", app_url, verify)
    assert again.status_code == 303 and again.headers["Location"].endswith("/signin?expired=1")
    signin = post(app_url, "/api/auth/signin", {"email": email.lower(), "password": PASSWORD, "next": "/parts/peg-rail"})
    assert signin.status_code == 200 and signin.json()["landing"] == "/parts/peg-rail"
    assert post(app_url, "/api/auth/signin", {"email": email, "password": PASSWORD}).json()["landing"] == "/dashboard"
    assert post(app_url, "/api/auth/signin", {"email": email, "password": PASSWORD, "next": OFFSITE_NEXT}).json()["landing"] == "/"
    wrong = post(app_url, "/api/auth/signin", {"email": email, "password": "not-the-password"})
    assert wrong.status_code == 401 and wrong.json()["error"] == "invalid_credentials"
    session_cookie = "tw_session=" + signin.cookies.get("tw_session", "")
    assert call("GET", app_url, "/api/me", session_cookie).status_code == 200
    assert post(app_url, "/api/auth/signout", {}, session_cookie).status_code == 204
    assert call("GET", app_url, "/api/me", session_cookie).status_code == 401

    other = fresh_email("offsite")
    post(app_url, "/api/auth/signup", {"email": other, "password": PASSWORD, "displayName": "Off", "next": OFFSITE_NEXT})
    off = urlparse(re.search(r"https?://\S+/auth/verify\?\S+", text(mails_to(mail, other, "Confirm your Tinework account")[0])).group(0))
    landing = call("GET", app_url, f"{off.path}?{off.query}")
    assert landing.status_code == 303 and urlparse(landing.headers["Location"]).path == "/"

    tight = os.environ["APP_TIGHT_URL"]
    late = fresh_email("late")
    started = time.monotonic()
    assert post(tight, "/api/auth/signup", {"email": late, "password": PASSWORD, "displayName": "Late", "next": "/"}).status_code == 201
    lk = urlparse(re.search(r"https?://\S+/auth/verify\?\S+", text(mails_to(mail, late, "Confirm your Tinework account")[0])).group(0))
    wait_real(tight, started, TIGHT_TTL_SECONDS + 1)
    expired = call("GET", tight, f"{lk.path}?{lk.query}")
    assert expired.status_code == 303 and expired.headers["Location"].endswith("/signin?expired=1")


def test_wf_phone_rail_touch_edit(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}", size=PHONE) as page:
        wait_settled(page, 0)
        for size in (PHONE, TABLET):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            advance(page, 300)
            box = viewport(page).bounding_box()
            client = page.evaluate("() => document.documentElement.clientWidth")
            assert abs(box["x"]) <= 0.5 and abs(box["width"] - client) <= 0.5, f"edge to edge at {size}"
            assert page.get_by_role("button", name="Dimensions").bounding_box()["y"] >= box["y"] + box["height"] - 0.5
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        expect(page.get_by_role("button", name="Dimensions")).to_have_attribute("aria-expanded", "true")
        viewer, seq = vp(page, "data-viewer-id"), seq_of(page)
        handle = page.get_by_role("button", name="Scrub Width")
        handle.scroll_into_view_if_needed()
        x, y = center(handle)
        touch(page, "touchStart", x, y)
        for i in range(1, 11):
            touch(page, "touchMove", x + SCRUB_PX * i, y)
        touch(page, "touchEnd")
        assert float(spin(page, "Width").get_attribute("aria-valuenow")) == 61
        wait_settled(page, seq)
        assert config_of(page.url) == f"width={int(float(spin(page, 'Width').get_attribute('aria-valuenow')))}"
    assert counts(app_url, viewer)["started"] >= 2


def test_wf_phone_rail_closed_groups(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    for size in ((375, 812), TABLET):
        with visit(browser, app_url, f"/parts/{w.slug()}", size=size) as page:
            wait_settled(page, 0)
            click(page.get_by_role("button", name="Pre-flight", exact=True))
            advance(page, 300)
            expect(page.get_by_role("button", name="Dimensions", exact=True)).to_have_attribute("aria-expanded", "false")
            expect(page.get_by_role("button", name="Pre-flight", exact=True)).to_have_attribute("aria-expanded", "true")
            assert spin(page, "Width").count() == 0
            names = tab_order(page, TAB_PRESSES)
            assert not {"Width", "Reset all", "Millimetres", "Scrub Width"} & set(names), names
            click(page.get_by_role("button", name="Dimensions", exact=True))
            advance(page, 300)
            expect(page.get_by_role("button", name="Pre-flight", exact=True)).to_have_attribute("aria-expanded", "false")
            assert page.get_by_role("radiogroup", name="Process").count() == 0
            assert spin(page, "Width").count() == 1


def test_wf_phone_rail_scrub(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}", size=WIDE) as page:
        wait_settled(page, 0)
        sent = eval_requests(page)
        width = spin(page, "Width")
        x, y = center(page.get_by_role("button", name="Scrub Width"))
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 5 * SCRUB_PX, y, steps=5)
        assert abs(float(width.get_attribute("aria-valuenow")) - 60.5) < 1e-9
        advance(page, EVAL_DEBOUNCE_MS * 2)
        assert sent == [], "no commit before release"
        page.keyboard.press("Escape")
        page.mouse.up()
        assert float(width.get_attribute("aria-valuenow")) == 60
        advance(page, EVAL_DEBOUNCE_MS * 2)
        assert sent == []
        seq = seq_of(page)
        page.keyboard.down("Shift")
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 2 * SCRUB_PX, y, steps=2)
        page.mouse.up()
        page.keyboard.up("Shift")
        assert float(width.get_attribute("aria-valuenow")) == 62
        wait_settled(page, seq)
        assert len(sent) == 1 and sent[0]["values"]["width"] == 62
        seq = seq_of(page)
        page.keyboard.down("Control")
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 2 * SCRUB_PX, y, steps=2)
        page.mouse.up()
        page.keyboard.up("Control")
        assert abs(float(width.get_attribute("aria-valuenow")) - 62.02) < 1e-9
        wait_settled(page, seq)
        touch(page, "touchStart", x, y)
        touch(page, "touchMove", x + 5 * SCRUB_PX, y)
        touch(page, "touchCancel")
        assert abs(float(width.get_attribute("aria-valuenow")) - 62.02) < 1e-9
        advance(page, EVAL_DEBOUNCE_MS * 2)
        assert len(sent) == 2


def test_preflight_findings(app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block"), part_spec("plate"), part_spec("rail", from_="peg-rail")])
    cookie = w.cookie()

    def run(key: str, values: dict[str, Any], process: str) -> httpx.Response:
        return post(app_url, "/api/preflight", {"partSlug": w.slug(key), "values": values, "process": process}, cookie)

    jig = run("jig", {}, "mill-3")
    assert jig.status_code == 201
    findings = jig.json()["findings"]
    assert [(f["severity"], f["message"]) for f in findings] == JIG_MILL_FINDINGS
    assert [f["cutLabel"] for f in findings] == ["Hole 1", "Hole 2", "Hole 1", "Hole 2"]
    assert [f["operation"] for f in findings] == [8, 9, 8, 9]
    assert set(findings[2]["parameters"]) == {"pinDia", "length", "pinEdge"}
    assert findings[2]["measured"] == pytest.approx(1.2) and findings[2]["threshold"] == pytest.approx(1.5)
    laser = run("plate", {}, "laser-sheet").json()["findings"]
    assert [(f["severity"], f["message"]) for f in laser] == [("Blocking", TWIN_LASER)]
    assert set(laser[0]["parameters"]) == {"width", "depth", "thickness"} and laser[0]["operation"] == 6
    passed = run("plate", {}, "mill-3").json()["findings"]
    assert [(f["severity"], f["message"]) for f in passed] == [("Pass", f"Every check passed for {MILL}.")]
    rail = run("rail", {}, "laser-sheet").json()
    assert rail["status"] == "unsupported" and rail["message"] == UNSUPPORTED and rail["findings"] == [] and not rail["costBands"]
    bad = run("plate", {}, "plasma")
    assert bad.status_code == 422 and "process" in bad.json()["errors"]

    def mixed(i: int) -> tuple[float, httpx.Response]:
        edge = 1.2 if i % 2 == 0 else 5
        return edge, run("jig", {"pinEdge": edge}, "mill-3")

    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        results = list(pool.map(mixed, range(12)))
    digests = {1.2: eval_digest(app_url, w.slug("jig"), {"pinEdge": 1.2}), 5: eval_digest(app_url, w.slug("jig"), {"pinEdge": 5})}
    for edge, response in results:
        body = response.json()
        assert response.status_code == 201 and body["values"]["pinEdge"] == edge
        assert len(body["findings"]) == (4 if edge == 1.2 else 2)
        assert body["geometryDigest"] == digests[edge]


def test_finding_order_severity(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block"), part_spec("plate"), source_spec("order", ORDER_SOURCE)])
    order = post(app_url, "/api/preflight", {"partSlug": w.slug("order"), "values": {}, "process": "mill-3"}, w.cookie()).json()
    assert [f["message"] for f in order["findings"]] == [
        f"Hole 2 is 12.5× deeper than its diameter; {MILL} allows at most 6×.",
        f"Hole 1 is 10× deeper than its diameter; {MILL} allows at most 6×.",
        f"Part is 320 × 20 × 50{NNBSP}mm; the {MILL} envelope is 300 × 200 × 100{NNBSP}mm."]
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, MILL)
        listbox = page.get_by_role("listbox", name="Findings")
        eventually(page, lambda: option_names(listbox) == [f"{s}: {m}" for s, m in JIG_MILL_FINDINGS], "findings in published order")
        for i in range(4):
            assert listbox.get_by_role("option").nth(i).evaluate("e => !!e.querySelector('svg')")
    with visit(browser, app_url, f"/parts/{w.slug('plate')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, MILL)
        listbox = page.get_by_role("listbox", name="Findings")
        eventually(page, lambda: option_names(listbox) == [f"Pass: Every check passed for {MILL}."], "one Pass row")


def test_cost_band_confidence(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("plate"), part_spec("jig", from_="jig-fence-block")])

    def run(key: str, values: dict[str, Any], process: str) -> dict[str, Any]:
        return post(app_url, "/api/preflight", {"partSlug": w.slug(key), "values": values, "process": process}, w.cookie()).json()

    plate = run("plate", {}, "fdm-04")
    bands = [(b["quantity"], b["low"], b["high"], b["text"]) for b in plate["costBands"]]
    assert bands == [(1, 3, 4, "$3–$4 each"), (10, 1, 2, "$1–$2 each"), (100, pytest.approx(0.9), 1, "$0.9–$1 each")]
    assert plate["confidence"] == "High"
    assert run("jig", {"height": 30}, "mill-3")["confidence"] == "Medium"
    assert run("jig", {}, "mill-3")["confidence"] == "Low"
    with visit(browser, app_url, f"/parts/{w.slug('plate')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, FDM_NAME)
        report = page.get_by_role("region", name="Pre-flight report")
        for line in ("Confidence: High", ESTIMATE_LINE, "Quantity 1", "$3–$4 each", "Typical lead time 2–4 working days"):
            eventually(page, shows(report, line), f"report shows {line}")


def test_wf_preflight_keyboard_walk(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        page.get_by_role("radio", name=FDM_NAME).focus()
        page.keyboard.press("ArrowDown")
        expect(page.get_by_role("radio", name=MILL)).to_be_checked()
        page.get_by_role("button", name=re.compile(r"^Run pre-flight")).focus()
        with page.expect_response(lambda r: urlparse(r.url).path == "/api/preflight") as info:
            page.keyboard.press("Enter")
        report = info.value.json()
        eventually(page, lambda: status(page, "Pre-flight").inner_text().strip() == "Pre-flight complete: 2 blocking, 2 advisory.",
                   "status Pre-flight announces the summary")
        listbox = page.get_by_role("listbox", name="Findings")
        listbox.focus()
        page.keyboard.press("Home")
        page.keyboard.press("Enter")
        options = listbox.get_by_role("option")
        expect(options.nth(0)).to_have_attribute("aria-selected", "true")
        advance(page, STEP_MS)
        assert vp(page, "data-camera-moving") == "true"
        until(page, MOVING_STOPPED_JS)
        assert at_pose(page, report["findings"][0]["pose"])
        page.keyboard.press("ArrowDown")
        page.keyboard.press(" ")
        expect(options.nth(1)).to_have_attribute("aria-selected", "true")
        assert options.nth(0).get_attribute("aria-selected") != "true"
        click(options.nth(2))
        until(page, MOVING_STOPPED_JS)
        assert at_pose(page, report["findings"][2]["pose"])
    tape = call("GET", app_url, f"/api/revisions/{report.get('revisionId') or part_json(app_url, w.slug('jig'))[0]['headRevisionId']}/tape").json()
    assert tape["preflight"]["id"] == report["id"]


def test_finding_camera_reduced_motion(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block"), part_spec()], revisions=[rev_spec("r2", {"width": 61})])
    watch = """() => { window.__moving = []; new MutationObserver(ms => ms.forEach(m => window.__moving.push(m.target.getAttribute('data-camera-moving'))))
      .observe(document.querySelector('[data-ui="viewport"]'), { attributes: true, attributeFilter: ['data-camera-moving'] }); }"""
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie(), reduced_motion="reduce") as page:
        wait_settled(page, 0)
        report = run_preflight(page, MILL)
        page.evaluate(watch)
        click(page.get_by_role("listbox", name="Findings").get_by_role("option").nth(0))
        advance(page, 20)
        assert at_pose(page, report["findings"][0]["pose"])
        assert "true" not in page.evaluate("() => window.__moving")
    revs = revisions(app_url, w.slug())
    r1, r2 = revs[-1]["id"], revs[0]["id"]
    hunks = call("GET", app_url, f"/api/compare?base={r1}&head={r2}").json()["hunks"]
    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay", reduced_motion="reduce") as page:
        eventually(page, lambda: page.get_by_role("list", name="Hunks").get_by_role("button").count() == 2, "hunks painted")
        page.evaluate(watch)
        page.get_by_role("button", name="Reset view").focus()
        page.keyboard.press("j")
        advance(page, 20)
        assert at_pose(page, hunks[0]["pose"])
        assert "true" not in page.evaluate("() => window.__moving")


def test_wf_stale_report_dim_and_return(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        runs: list[str] = []
        page.on("request", lambda r: runs.append(r.url) if urlparse(r.url).path == "/api/preflight" else None)
        report_body = run_preflight(page, MILL)
        report = page.get_by_role("region", name="Pre-flight report")
        expect(report).to_have_attribute("data-state", "complete")
        length = spin(page, "Length")
        length.focus()
        page.keyboard.press("ArrowUp")
        expect(report).to_have_attribute("data-state", "stale")
        expect(report.get_by_text(STALE_BANNER)).to_be_visible()
        listbox = page.get_by_role("listbox", name="Findings")
        assert option_names(listbox)[:4] == [f"{s}: {m}" for s, m in JIG_MILL_FINDINGS]
        for i in range(4):
            ratios = listbox.get_by_role("option").nth(i).evaluate(CONTRAST_JS)
            assert ratios["text"] and min(ratios["text"]) >= CONTRAST_TEXT, ratios
            assert ratios["icons"] and min(ratios["icons"]) >= CONTRAST_ICON, ratios
        click(listbox.get_by_role("option").nth(1))
        expect(listbox.get_by_role("option").nth(1)).to_have_attribute("aria-selected", "true")
        length.focus()
        page.keyboard.press("ArrowDown")
        expect(report).to_have_attribute("data-state", "complete")
        assert report.get_by_text(STALE_BANNER).count() == 0
        click(page.get_by_role("radio", name=LASER))
        expect(report).to_have_attribute("data-state", "stale")
        click(page.get_by_role("radio", name=MILL))
        expect(report).to_have_attribute("data-state", "complete")
        advance(page, EVAL_DEBOUNCE_MS * 3)
        assert len(runs) == 1, "a report never re-runs on its own"
        with held(page, "**/api/preflight") as gate:
            click(page.get_by_role("button", name=re.compile(r"^Run pre-flight")))
            expect(report).to_have_attribute("data-state", "running")
            length.focus()
            page.keyboard.press("ArrowUp")
            gate.release()
        eventually(page, lambda: report.get_attribute("data-state") == "stale", "a report that arrives after a change is stale")
    tape = call("GET", app_url, f"/api/revisions/{part_json(app_url, w.slug('jig'))[0]['headRevisionId']}/tape").json()
    assert tape["preflight"]["id"] == report_body["id"]


def test_wf_stale_report_allowance(browser: Browser, app_url: str) -> None:
    limit = call("GET", app_url, "/api/config").json()["preflightSignedOutLimit"]
    w = world(app_url, parts=[part_spec()])
    body = {"partSlug": w.slug(), "values": {}, "process": "mill-3"}

    def visitor_client() -> httpx.Client:
        client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
        assert client.get(f"/api/parts/{w.slug()}").json()["preflightLeft"] == limit
        if "tw_visitor" not in client.cookies:
            client.post("/api/preflight", json={**body, "process": "plasma"})
        if "tw_visitor" not in client.cookies:
            pytest.fail("a signed-out pre-flight session carries the tw_visitor cookie (L970)")
        return client

    with contextlib.closing(visitor_client()) as client:
        for _ in range(limit):
            assert client.post("/api/preflight", json=body).status_code == 201
        refused = client.post("/api/preflight", json=body)
        assert refused.status_code == 429
        assert refused.json() == {"error": "preflight_limit", "message": SIGN_IN_MORE}
        assert 1 <= int(refused.headers["Retry-After"]) <= RETRY_AFTER_MAX
        assert client.get(f"/api/parts/{w.slug()}").json()["preflightLeft"] == 0
    with contextlib.closing(visitor_client()) as client:
        for _ in range(limit - 1):
            assert client.post("/api/preflight", json=body).status_code == 201
        with concurrent.futures.ThreadPoolExecutor(2) as pool:
            statuses = sorted(pool.map(lambda _: client.post("/api/preflight", json=body).status_code, range(2)))
        assert statuses == [201, 429]
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        expect(page.get_by_role("button", name=f"Run pre-flight ({limit} of {limit} left this session)")).to_be_visible()
        click(page.get_by_role("radio", name=MILL))
        for _ in range(limit):
            click(page.get_by_role("button", name=re.compile(r"^Run pre-flight")))
            advance(page, 500)
        used = page.get_by_role("button", name=f"Run pre-flight (0 of {limit} left this session)")
        eventually(page, lambda: used.count() == 1, "the run button counts down to 0")
        expect(used).to_be_disabled()
        expect(page.get_by_text(SIGN_IN_MORE).first).to_be_visible()
        page.reload()
        wait_settled(page, 0)
        expect(page.get_by_role("button", name=f"Run pre-flight (0 of {limit} left this session)")).to_be_visible()


def compare_world(app_url: str) -> tuple[World, list[dict[str, Any]]]:
    w = world(app_url, parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61}), rev_spec("r3", {"width": 62})])
    return w, list(reversed(revisions(app_url, w.slug())))


def option_text(rev: dict[str, Any], name: str) -> str:
    return f"{rev['label']} · {rev['message']} · {name}"


def test_compare_volumes(app_url: str) -> None:
    w, revs = compare_world(app_url)
    r1, r2 = revs[0]["id"], revs[1]["id"]
    body = call("GET", app_url, f"/api/compare?base={r1}&head={r2}").json()
    assert body["identical"] is False
    assert (body["added"], body["removed"], body["unchanged"]) == (pytest.approx(320), pytest.approx(0), pytest.approx(18880))
    assert [(h["index"], h["kind"], h["volume"]) for h in body["hunks"]] == [(1, "added", pytest.approx(160)), (2, "added", pytest.approx(160))]
    assert body["hunks"][0]["box"]["min"][0] < body["hunks"][1]["box"]["min"][0]
    assert body["parameterChanges"] == [{"name": "width", "label": "Width", "base": 60, "head": 61, "unit": "mm"}]
    back = call("GET", app_url, f"/api/compare?base={r2}&head={r1}").json()
    assert back["removed"] == pytest.approx(320) and {h["kind"] for h in back["hunks"]} == {"removed"}
    peg = world(app_url, parts=[part_spec(from_="peg-rail")],
                revisions=[rev_spec("a", {"pegCount": 1, "pegPitch": 30}), rev_spec("b", {"pegCount": 1, "pegPitch": 45})])
    same = call("GET", app_url, f"/api/compare?base={peg.rev('a')}&head={peg.rev('b')}").json()
    assert same["identical"] is True and same["hunks"] == []
    assert call("GET", app_url, f"/api/compare?base={r1}&head={peg.rev('a')}").status_code == 404
    big = save(app_url, w.slug(), {"width": 200, "depth": 200, "thickness": 30}, w.cookie(), "*").json()
    huge = call("GET", app_url, f"/api/compare?base={r1}&head={big['id']}")
    assert huge.status_code == 422
    assert huge.json() == {"error": "too_large_to_compare", "message": f"These revisions are too large to compare at 0.5{NNBSP}mm."}


def test_wf_compare_newest_pair(browser: Browser, app_url: str) -> None:
    w, revs = compare_world(app_url)
    r1, r2, r3 = (r["id"] for r in revs)
    stale: list[Route] = []

    def hold(route: Route) -> None:
        q = parse_qs(urlparse(route.request.url).query)
        if q.get("base") == [r1] and q.get("head") == [r3]:
            stale.append(route)
        else:
            route.continue_()

    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay") as page:
        page.route(lambda url: urlparse(url).path == "/api/compare", hold)
        region = page.get_by_role("region", name="Volume change")
        eventually(page, shows(region, f"Added 320.00{NNBSP}mm³"), "first pair painted")
        select(page.get_by_role("combobox", name="Head revision"), option_text(revs[2], w.name()))
        eventually(page, lambda: bool(stale), "the r1/r3 compare is in flight")
        select(page.get_by_role("combobox", name="Base revision"), option_text(revs[1], w.name()))
        eventually(page, lambda: page.get_by_role("heading", name=f"Compare {'r2'} and {'r3'}").count() == 1, "heading follows the menus")
        eventually(page, shows(region, f"Added 320.00{NNBSP}mm³"), "the newest pair is painted")
        for route in stale:
            try:
                route.continue_()
            except PlaywrightError:
                pass
        deadline = time.monotonic() + QUIET_S
        while time.monotonic() < deadline:
            assert f"640.00{NNBSP}mm³" not in region.inner_text(), "the r1/r3 answer was painted after the menus moved on"
            advance(page, STEP_MS)
        assert vp(page, "data-epoch") == "2"
    peg = world(app_url, parts=[part_spec(from_="peg-rail")],
                revisions=[rev_spec("a", {"pegCount": 1, "pegPitch": 30}), rev_spec("b", {"pegCount": 1, "pegPitch": 45})])
    with visit(browser, app_url, f"/parts/{peg.slug()}/compare?base={peg.rev('a')}&head={peg.rev('b')}&view=overlay") as page:
        eventually(page, shows(page.get_by_role("region", name="Volume change"), NO_CHANGE), "no-change line")
        expect(page.get_by_role("list", name="Parameter changes").get_by_text(f"Peg pitch: 30.0 → 45.0{NNBSP}mm")).to_be_visible()


def test_hunks_by_keyboard(browser: Browser, app_url: str) -> None:
    w, revs = compare_world(app_url)
    r1, r2 = revs[0]["id"], revs[1]["id"]
    hunks = call("GET", app_url, f"/api/compare?base={r1}&head={r2}").json()["hunks"]
    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay") as page:
        buttons = page.get_by_role("list", name="Hunks").get_by_role("button")
        eventually(page, lambda: buttons.count() == 2, "two hunks listed")
        assert buttons.nth(0).inner_text().strip() == f"Hunk 1 of 2 · Added · 160.00{NNBSP}mm³"

        def selected() -> int | None:
            for i in range(buttons.count()):
                if buttons.nth(i).get_attribute("aria-current") == "true":
                    return i + 1
            return None

        page.get_by_role("combobox", name="Head revision").focus()
        page.keyboard.press("j")
        until(page, MOVING_STOPPED_JS)
        assert selected() == 1 and query_of(page.url).get("hunk") == "1" and at_pose(page, hunks[0]["pose"])
        for key, expected in (("j", 2), ("j", 2), ("k", 1), ("k", 1)):
            page.keyboard.press(key)
            assert selected() == expected, f"{key} gave hunk {selected()}"
        page.get_by_role("button", name="Reset view").focus()
        page.keyboard.press("j")
        until(page, MOVING_STOPPED_JS)
        assert selected() == 2 and at_pose(page, hunks[1]["pose"])
        page.evaluate("() => document.activeElement").__class__
        page.get_by_role("button", name="Reset view").evaluate(COMPOSING_JS, "k")
        assert selected() == 2, "a composing K is ignored"


def test_wf_compare_live_revision(browser: Browser, app_url: str) -> None:
    w, revs = compare_world(app_url)
    r1, r2 = revs[0]["id"], revs[1]["id"]
    path = f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay"
    with visit(browser, app_url, path, cookie=w.cookie()) as a, visit(browser, app_url, path) as b:
        hunk = a.get_by_role("list", name="Hunks").get_by_role("button").nth(0)
        eventually(a, lambda: hunk.count() == 1, "hunks painted")
        click(hunk)
        expect(hunk).to_have_attribute("aria-current", "true")
        eventually(b, shows(b.get_by_role("region", name="Volume change"), "Added"), "second page painted")
        _, tag = part_json(app_url, w.slug())
        made = save(app_url, w.slug(), {"width": 63}, w.cookie(), tag, "Live")
        assert made.status_code == 201
        line = f"New revision r4 by {w.name()}."
        deadline = time.monotonic() + LIVE_SECONDS
        while time.monotonic() < deadline and not (line in status(a, "Part activity").inner_text() and line in status(b, "Part activity").inner_text()):
            advance(a, STEP_MS)
            advance(b, STEP_MS)
        assert line in status(a, "Part activity").inner_text() and line in status(b, "Part activity").inner_text(), "announced within 2 s"
        assert hunk.get_attribute("aria-current") == "true"
        expect(hunk).to_be_focused()
        new = revisions(app_url, w.slug())[0]
        select(b.get_by_role("combobox", name="Head revision"), option_text(new, w.name()))
        eventually(b, lambda: b.get_by_role("heading", name=f"Compare {'r1'} and {'r4'}").count() == 1, "the new revision is in the menu")


def test_wf_compare_address_history(browser: Browser, app_url: str) -> None:
    w, revs = compare_world(app_url)
    r1, r2, r3 = (r["id"] for r in revs)
    with visit(browser, app_url, f"/parts/{w.slug()}/compare") as page:
        eventually(page, lambda: query_of(page.url) == {"base": r2, "head": r3, "view": "overlay"}, "default pair written in place")
        page.evaluate("() => { window.__twMarker = 1; }")
        length = page.evaluate("() => history.length")
        click(page.get_by_role("radio", name="Added"))
        eventually(page, lambda: query_of(page.url).get("view") == "added", "view in the address")
        page.get_by_role("button", name="Reset view").focus()
        page.keyboard.press("j")
        eventually(page, lambda: query_of(page.url).get("hunk") == "1", "hunk in the address")
        assert page.evaluate("() => history.length") == length
        select(page.get_by_role("combobox", name="Base revision"), option_text(revs[0], w.name()))
        eventually(page, lambda: query_of(page.url).get("base") == r1 and "hunk" not in query_of(page.url), "menu change clears the hunk")
        assert page.evaluate("() => history.length") == length + 1
        page.go_back()
        eventually(page, lambda: query_of(page.url) == {"base": r2, "head": r3, "view": "added", "hunk": "1"}, "Back restores the entry")
        hunks = page.get_by_role("list", name="Hunks").get_by_role("button")
        eventually(page, lambda: hunks.nth(0).get_attribute("aria-current") == "true", "Back restores the hunk")
        expect(page.get_by_role("radio", name="Added")).to_be_checked()
        page.go_forward()
        eventually(page, lambda: query_of(page.url).get("base") == r1, "Forward restores the pair")
        assert page.evaluate("() => window.__twMarker") == 1, "no document reload"
        page.go_back()
        page.reload()
        eventually(page, lambda: hunks.count() > 0 and hunks.nth(0).get_attribute("aria-current") == "true", "reload restores the hunk")
    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay&hunk=01") as page:
        eventually(page, lambda: "hunk" not in query_of(page.url), "an unusable hunk leaves the address")
        buttons = page.get_by_role("list", name="Hunks").get_by_role("button")
        assert all(buttons.nth(i).get_attribute("aria-current") != "true" for i in range(buttons.count()))


def test_review_room_invitation(app_url: str, mail: Mailpit) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()])
    slug, title = w.slug(), f"Room {tok()}"
    emails = [w.email("rev1"), w.email("rev2")]
    required = call("GET", app_url, "/api/config").json()["requiredApprovals"]
    path = f"/api/parts/{slug}/rooms"
    assert post(app_url, path, {"title": title, "reviewers": emails}).status_code == 401
    assert post(app_url, path, {"title": title, "reviewers": emails}, w.cookie("rev1")).status_code == 403
    few = post(app_url, path, {"title": title, "reviewers": emails[:1]}, w.cookie())
    assert few.status_code == 422 and few.json()["errors"]["reviewers"] == f"Invite at least {required} reviewers."
    junk = post(app_url, path, {"title": title, "reviewers": [emails[0], "not-an-email"]}, w.cookie())
    assert junk.json()["errors"]["reviewers"] == "Enter valid email addresses."
    long = post(app_url, path, {"title": "x" * 81, "reviewers": emails}, w.cookie())
    assert long.json()["errors"]["title"] == "Use 1 to 80 characters."
    key = idempotency_key()
    made = post(app_url, path, {"title": title, "reviewers": emails}, w.cookie(), key)
    assert made.status_code == 201
    room = made.json()
    assert made.headers["Location"] == f"/api/rooms/{room['id']}"
    assert room["state"] == "open" and room["requiredApprovals"] == required and room["title"] == title
    replay = post(app_url, path, {"title": title, "reviewers": emails}, w.cookie(), key)
    assert replay.status_code == 201 and replay.content == made.content
    for email in emails:
        found = mails_to(mail, email, f"Review {w.title()} on Tinework")
        assert len(found) == 1, "one invitation per reviewer, none for refusals or the replay"
        body = text(found[0])
        for line in (f"Room: {title}", "Revision: r1", f"Head volume: 18{THIN}885.84{NNBSP}mm³", f"/rooms/{room['id']}"):
            assert line in body


def test_comments_anchors(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2", "outsider"), parts=[part_spec()], rooms=[room_spec()])
    room, limit = w.room(), call("GET", app_url, "/api/config").json()["commentMaxChars"]
    path = f"/api/rooms/{room}/comments"
    nfd = "Cafe\u0301 wall"
    made = post(app_url, path, {"body": nfd, "anchor": {"kind": "point", "position": [1.5, 0, 8]}, "pose": POSE}, w.cookie("rev1"))
    assert made.status_code == 201
    comment = made.json()
    assert comment["body"] == unicodedata.normalize("NFC", nfd)
    assert comment["anchor"] == {"kind": "point", "position": [1.5, 0, 8]} and comment["pose"] == POSE
    assert comment["revisionId"] == part_json(app_url, w.slug())[0]["headRevisionId"]
    assert comment["author"] == {"id": w.uid("rev1"), "displayName": w.name("rev1")}
    owner = post(app_url, path, {"body": "Owner note", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie())
    assert owner.status_code == 201 and owner.json()["anchor"] == {"kind": "none"}
    family = "\U0001F468\u200D\U0001F469\u200D\U0001F467"
    assert post(app_url, path, {"body": family * limit, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2")).status_code == 201
    over = post(app_url, path, {"body": family * (limit + 1), "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2"))
    message = f"Comments can be at most {limit} characters."
    assert over.status_code == 422 and over.json() == {"error": "comment_too_long", "message": message, "errors": {"body": message}}
    empty = post(app_url, path, {"body": "", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2"))
    assert empty.json()["errors"]["body"] == "Write a comment first."
    assert post(app_url, path, {"body": "x", "anchor": {"kind": "none"}, "pose": POSE}).status_code == 401
    assert post(app_url, path, {"body": "x", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("outsider")).status_code == 404
    stored = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
    assert len(stored) == 3


def test_wf_review_room_live_comments(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    room, body = w.room(), f"Check the wall {tok()}"
    name = f"{w.name('rev1')}: {body}"
    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as a, \
            visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev2")) as b, \
            visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie()) as o:
        for p in (a, b, o):
            eventually(p, lambda p=p: p.get_by_role("listbox", name="Threads").count() == 1, "room loaded")
        pending: list[Route] = []
        a.route(lambda url: urlparse(url).path == f"/api/rooms/{room}/comments",
                lambda route: pending.append(route) if route.request.method == "POST" else route.continue_())
        click(a.get_by_role("button", name="Comment on this view"))
        fill(a.get_by_role("textbox", name="Comment"), body)
        click(a.get_by_role("button", name="Post comment"))
        eventually(a, lambda: bool(pending), "the post is in flight")
        assert a.get_by_role("option", name=name).count() == 0, "no option while the post is pending"
        pending[0].continue_()
        eventually(a, lambda: a.get_by_role("option", name=name).count() == 1, "the option appears after the 201")
        deadline = time.monotonic() + LIVE_SECONDS
        while time.monotonic() < deadline and not (b.get_by_role("option", name=name).count() and o.get_by_role("option", name=name).count()):
            advance(b, STEP_MS)
            advance(o, STEP_MS)
        assert b.get_by_role("option", name=name).count() == 1 and o.get_by_role("option", name=name).count() == 1, "live within 2 s"
        eventually(o, lambda: f"New comment from {w.name('rev1')}." in status(o, "Room activity").inner_text(), "announced")
        assert "New comment from" not in status(a, "Room activity").inner_text()
        comments = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
        assert [c["body"] for c in comments] == [body]
        click(b.get_by_role("option", name=name))
        until(b, MOVING_STOPPED_JS)
        assert at_pose(b, comments[0]["pose"])


def test_wf_review_room_lost_answer(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    room, body = w.room(), f"Lost answer {tok()}"
    keys: list[str] = []
    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as page:
        def lose_first(route: Route) -> None:
            if route.request.method != "POST":
                route.continue_()
                return
            keys.append(route.request.headers.get("idempotency-key", ""))
            if len(keys) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route(lambda url: urlparse(url).path == f"/api/rooms/{room}/comments", lose_first)
        click(page.get_by_role("button", name="Comment on this view"))
        box = page.get_by_role("textbox", name="Comment")
        fill(box, body)
        click(page.get_by_role("button", name="Post comment"))
        eventually(page, lambda: page.get_by_text(NOT_SENT).count() == 1, "the lost post shows Not sent yet. Try again.")
        assert box.input_value() == body
        click(page.get_by_role("button", name="Post comment"))
        eventually(page, lambda: page.get_by_role("option", name=f"{w.name('rev1')}: {body}").count() == 1, "the retry shows once")
        assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
        assert post(app_url, f"/api/rooms/{room}/close", {}, w.cookie()).status_code == 200
        fill(box, "After closing")
        click(page.get_by_role("button", name="Post comment"))
        eventually(page, lambda: page.get_by_text(ROOM_CLOSED).count() >= 1, "closed room line under Comment")
        assert page.get_by_role("option", name=f"{w.name('rev1')}: After closing").count() == 0
    stored = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
    assert [c["body"] for c in stored] == [body]


def test_wf_review_room_selection_holds(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec(), part_spec("jig", from_="jig-fence-block")],
              rooms=[room_spec()], comments=[{"key": "c1", "room": "room", "author": "rev2", "body": "First", "anchor": {"kind": "none"}, "pose": POSE}])
    with visit(browser, app_url, f"/rooms/{w.room()}", cookie=w.cookie("rev1")) as page:
        threads = page.get_by_role("listbox", name="Threads")
        eventually(page, lambda: threads.get_by_role("option").count() == 1, "thread listed")
        click(threads.get_by_role("option").nth(0))
        expect(threads.get_by_role("option").nth(0)).to_have_attribute("aria-selected", "true")
        post(app_url, f"/api/rooms/{w.room()}/comments", {"body": "Second", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2"))
        eventually(page, lambda: threads.get_by_role("option").count() == 2, "live comment arrives")
        assert threads.get_by_role("option").nth(0).get_attribute("aria-selected") == "true"
        assert threads.evaluate("el => el.contains(document.activeElement)")
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, MILL)
        listbox = page.get_by_role("listbox", name="Findings")
        click(listbox.get_by_role("option").nth(1))
        length = spin(page, "Length")
        length.focus()
        seq = seq_of(page)
        page.keyboard.press("ArrowUp")
        wait_settled(page, seq)
        expect(length).to_be_focused()
        assert listbox.get_by_role("option").nth(1).get_attribute("aria-selected") == "true"


def test_approval_rules(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2", "outsider"), parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61})], rooms=[room_spec()])
    room, head = w.room(), w.rev("r2")
    r1 = revisions(app_url, w.slug())[-1]["id"]
    path = f"/api/rooms/{room}/approvals"
    assert post(app_url, path, {"revisionId": head}).status_code == 401
    assert post(app_url, path, {"revisionId": head}, w.cookie("outsider")).status_code == 404
    own = post(app_url, path, {"revisionId": head}, w.cookie())
    assert own.status_code == 422 and own.json() == {"error": "own_revision", "message": "Owners cannot approve their own revision."}
    stale = post(app_url, path, {"revisionId": r1}, w.cookie("rev1"))
    assert stale.status_code == 409
    assert stale.json() == {"error": "stale_revision", "message": "r1 is no longer the head; review r2 before approving."}
    with concurrent.futures.ThreadPoolExecutor(5) as pool:
        codes = sorted(pool.map(lambda _: post(app_url, path, {"revisionId": head}, w.cookie("rev1")).status_code, range(5)))
    assert codes == [200, 200, 200, 200, 201]
    approvals = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]
    assert [a["reviewerId"] for a in approvals] == [w.uid("rev1")]
    assert post(app_url, f"/api/rooms/{room}/close", {}, w.cookie("rev1")).status_code == 403
    assert post(app_url, f"/api/rooms/{room}/close", {}, w.cookie()).status_code == 200
    closed = post(app_url, path, {"revisionId": head}, w.cookie("rev2"))
    assert closed.status_code == 409 and closed.json() == {"error": "room_closed", "message": ROOM_CLOSED}


def test_wf_approval_gate_progress_live(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    room = w.room()
    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as a, \
            visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev2")) as b, \
            visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie()) as o:
        pages = (a, b, o)
        for p in pages:
            eventually(p, lambda p=p: p.get_by_text("Approvals 0 of 2").count() >= 1, "progress shown")
        assert o.get_by_role("button", name="Approve r1").count() == 0
        expect(o.get_by_role("button", name="Close room")).to_be_visible()
        for page, progress in ((a, "Approvals 1 of 2"), (b, "Approvals 2 of 2")):
            click(page.get_by_role("button", name="Approve r1"))
            deadline = time.monotonic() + LIVE_SECONDS
            while time.monotonic() < deadline and not all(p.get_by_text(progress).count() for p in pages):
                for p in pages:
                    advance(p, STEP_MS)
            assert all(p.get_by_text(progress).count() for p in pages), f"{progress} live within 2 s"
        eventually(o, lambda: f"{w.name('rev2')} approved r1." in status(o, "Room activity").inner_text(), "approval announced")
        for p in pages:
            eventually(p, lambda p=p: p.get_by_text("Approved", exact=True).count() >= 1, "state Approved")
    assert call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["state"] == "approved"


def test_wf_approval_gate_geometry(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()],
              approvals=[{"room": "room", "reviewer": "rev1"}, {"room": "room", "reviewer": "rev2"}])
    slug, room, owner = w.slug(), w.room(), w.cookie()
    r1 = revisions(app_url, slug)[-1]["id"]
    stream = Stream(app_url, f"/api/events?parts={slug}", cookie=w.cookie("rev1"))

    def room_state() -> dict[str, Any]:
        return call("GET", app_url, f"/api/rooms/{room}", owner).json()["room"]

    assert room_state()["state"] == "approved"
    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as page:
        eventually(page, lambda: page.get_by_text("Approvals 2 of 2").count() >= 1, "approved room shown")
        _, tag = part_json(app_url, slug)
        assert save(app_url, slug, {"width": 61}, owner, tag).status_code == 201
        reset = "Approvals reset: r2 changed the part."
        eventually(page, lambda: page.get_by_text(reset).count() >= 1 and page.get_by_text("Approvals 0 of 2").count() >= 1, "reset live")
        eventually(page, lambda: page.get_by_text("Reviewing r2").count() >= 1, "head label follows")
        advance(page, 1000)
        assert page.get_by_text(reset).count() >= 1, "the revision repaint keeps the reset line"
        assert room_state()["state"] == "open" and room_state()["approvals"] == []
        _, tag = part_json(app_url, slug)
        assert restore(app_url, slug, r1, owner, tag).status_code == 201
        eventually(page, lambda: page.get_by_text("r3 matches approved geometry; approvals count again.").count() >= 1, "matched live")
        assert room_state()["state"] == "approved" and len(room_state()["approvals"]) == 2
        _, tag = part_json(app_url, slug)
        assert save(app_url, slug, {}, owner, tag).status_code == 201
        eventually(page, lambda: page.get_by_text(f"{'r4'} has the same geometry; approvals carried over.").count() >= 1, "carried live")
        assert room_state()["state"] == "approved"
    events = stream.wait_for(lambda e: len(of_type(e, "approvals")) >= 3, 10.0, "three approvals events reach the reviewer stream")
    changes = [(e["data"]["reason"], e["data"]["label"]) for e in of_type(events, "approvals")]
    assert changes[-3:] == [("reset", "r2"), ("matched", "r3"), ("carried", "r4")]


def test_wf_approval_gate_lost_answer(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    room = w.room()
    keys: list[str] = []
    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as page:
        def lose_first(route: Route) -> None:
            if route.request.method != "POST":
                route.continue_()
                return
            keys.append(route.request.headers.get("idempotency-key", ""))
            if len(keys) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route(lambda url: urlparse(url).path == f"/api/rooms/{room}/approvals", lose_first)
        click(page.get_by_role("button", name="Approve r1"))
        eventually(page, lambda: len(keys) >= 1, "approval sent")
        advance(page, 1000)
        if len(keys) == 1 and page.get_by_role("button", name="Approve r1").count():
            click(page.get_by_role("button", name="Approve r1"))
        eventually(page, lambda: page.get_by_text("Approvals 1 of 2").count() >= 1, "the retried approval counts")
        assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    approvals = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]
    assert len(approvals) == 1
    key = idempotency_key()
    first = post(app_url, f"/api/rooms/{room}/approvals", {"revisionId": approvals[0]["revisionId"]}, w.cookie("rev2"), key)
    again = post(app_url, f"/api/rooms/{room}/approvals", {"revisionId": approvals[0]["revisionId"]}, w.cookie("rev2"), key)
    assert first.status_code == 201 and again.status_code == 201 and again.content == first.content
    other = post(app_url, f"/api/rooms/{room}/approvals", {"revisionId": "different"}, w.cookie("rev2"), key)
    assert other.status_code == 422 and other.json()["error"] == "key_reused"
    assert len(call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]) == 2


def test_immutable_revisions(app_url: str) -> None:
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    r1 = revisions(app_url, slug)[0]
    _, tag = part_json(app_url, slug)
    r2 = save(app_url, slug, {"width": 61}, cookie, tag).json()
    assert save(app_url, slug, {"width": 62}, cookie, tag).status_code == 412
    r3 = restore(app_url, slug, r1["id"], cookie, f'"{r2["id"]}"').json()
    r4 = fork(app_url, r3["id"], 7, cookie, f'"{r3["id"]}"').json()
    assert [r2["label"], r3["label"], r4["label"]] == ["r2", "r3", "r4"]
    listed = revisions(app_url, slug)
    assert [r["label"] for r in listed] == ["r4", "r3", "r2", "r1"]
    assert listed[-1] == r1 and listed[-2] == r2
    copy = post(app_url, f"/api/parts/{slug}/copies", {"values": {}, "message": "Mine"}, w.cookie("visitor")).json()
    assert copy["revision"]["label"] == "r1" and len(revisions(app_url, slug)) == 4


def test_wf_conflict_restore_two_tabs(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "fan"), parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}", cookie=w.cookie()) as a, visit(browser, app_url, f"/parts/{slug}", cookie=w.cookie()) as b:
        for p in (a, b):
            wait_settled(p, 0)
        for page, label, value in ((a, "Width", "61"), (b, "Depth", "30")):
            seq = seq_of(page)
            commit(spin(page, label), value)
            wait_settled(page, seq)
            click(page.get_by_role("button", name="Save revision"))
            click(page.get_by_role("dialog", name="Save revision").get_by_role("button", name="Save"))
        eventually(a, lambda: status(a, "Part activity").inner_text().strip().startswith("Saved r2."), "first tab saved r2")
        alert = b.get_by_role("alert").filter(has=b.get_by_role("list", name="Changes in r2"))
        eventually(b, lambda: alert.count() == 1, "the losing tab shows the conflict alert")
        assert f"This part changed since you opened it. {'r2'} is now the latest revision." in alert.inner_text()
        assert alert.get_by_role("listitem").all_inner_texts() == [f"Width: 60.0 → 61.0{NNBSP}mm"]
        assert b.get_by_role("dialog", name="Save revision").count() == 0
        call("PUT", app_url, f"/api/parts/{slug}/like", w.cookie("fan"))
        advance(b, 1500)
        assert alert.count() == 1, "live updates never remove the alert"
        click(alert.get_by_role("button", name="Keep my values on r2"))
        eventually(b, lambda: status(b, "Part activity").inner_text().strip() == "Your values now build on r2.", "keep line")
        assert alert.count() == 0
        click(b.get_by_role("button", name="Save revision"))
        click(b.get_by_role("dialog", name="Save revision").get_by_role("button", name="Save"))
        eventually(b, lambda: status(b, "Part activity").inner_text().strip() == "Saved r3.", "saved on the new head")
    head = revisions(app_url, slug)[0]
    assert head["label"] == "r3" and head["values"]["depth"] == 30 and head["values"]["width"] == 60
    assert head["parentRevisionId"] == revisions(app_url, slug)[1]["id"]


def test_wf_conflict_restore_draft_reload(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    r1 = revisions(app_url, slug)[0]["id"]
    with visit(browser, app_url, f"/parts/{slug}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        _, tag = part_json(app_url, slug)
        r2 = save(app_url, slug, {"width": 61}, w.cookie(), tag).json()
        seq = seq_of(page)
        commit(spin(page, "Depth"), "30")
        wait_settled(page, seq)
        click(page.get_by_role("button", name="Save revision"))
        dialog = page.get_by_role("dialog", name="Save revision")
        fill(dialog.get_by_role("textbox", name="Message"), "my draft")
        click(dialog.get_by_role("button", name="Save"))
        key = f"tinework:draft:{slug}:{r1}"
        eventually(page, lambda: page.evaluate("k => localStorage.getItem(k)", key) is not None, "draft written under its key")
        draft = json.loads(page.evaluate("k => localStorage.getItem(k)", key))
        assert draft["message"] == "my draft" and draft["values"]["depth"] == 30
        page.reload()
        wait_settled(page, 0)
        alert = page.get_by_role("alert").filter(has=page.get_by_role("list", name="Changes in r2"))
        eventually(page, lambda: alert.count() == 1, "the alert shows again after a reload")
        assert float(spin(page, "Depth").get_attribute("aria-valuenow")) == 30
        click(page.get_by_role("button", name="Save revision"))
        expect(page.get_by_role("dialog", name="Save revision").get_by_role("textbox", name="Message")).to_have_value("my draft")
        page.keyboard.press("Escape")
        click(alert.get_by_role("button", name="Open r2"))
        eventually(page, lambda: page.evaluate(
            "p => Object.keys(localStorage).filter(k => k.startsWith(p)).length", f"tinework:draft:{slug}:") == 0, "Open removes drafts")
        eventually(page, lambda: float(spin(page, "Width").get_attribute("aria-valuenow")) == 61, "Open loads r2's values")
    assert revisions(app_url, slug)[0]["id"] == r2["id"]


def test_conditional_history_writes(app_url: str) -> None:
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    body, tag = part_json(app_url, slug)
    assert tag == f'"{body["headRevisionId"]}"'
    assert call("GET", app_url, f"/api/parts/{slug}/revisions").headers["ETag"] == tag
    missing = save(app_url, slug, {"width": 61}, cookie, None)
    assert missing.status_code == 428
    assert missing.json() == {"error": "precondition_required", "message": "Send If-Match with the revision history's ETag."}
    assert restore(app_url, slug, body["headRevisionId"], cookie, None).status_code == 428
    assert fork(app_url, body["headRevisionId"], 7, cookie, None).status_code == 428
    assert save(app_url, slug, {"width": 61}, w.cookie("visitor"), None).status_code == 403
    for weak in (f'W/{tag}', "nope"):
        refused = save(app_url, slug, {"width": 61}, cookie, weak)
        assert refused.status_code == 412 and refused.headers["ETag"] == tag
        data = refused.json()
        assert data["error"] == "head_moved" and data["headRevisionId"] == body["headRevisionId"]
        assert data["message"] == f"This part changed since you opened it. {data['head']['label']} is now the latest revision." and data["head"]["label"] == "r1"
    listed = save(app_url, slug, {"width": 61}, cookie, f'"zzz", {tag}')
    assert listed.status_code == 201 and listed.headers["ETag"] == f'"{listed.json()["id"]}"'
    assert listed.json()["parentRevisionId"] == body["headRevisionId"]
    assert save(app_url, slug, {"width": 62}, cookie, "*").status_code == 201
    _, current = part_json(app_url, slug)
    with concurrent.futures.ThreadPoolExecutor(6) as pool:
        codes = sorted(pool.map(lambda i: save(app_url, slug, {"width": 63 + i}, cookie, current, key=idempotency_key()).status_code, range(6)))
    assert codes == [201, 412, 412, 412, 412, 412]
    assert len(revisions(app_url, slug)) == 4


def test_exact_restore(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61})],
              rooms=[room_spec()], approvals=[{"room": "room", "reviewer": "rev1"}, {"room": "room", "reviewer": "rev2"}])
    slug, cookie = w.slug(), w.cookie()
    before = revisions(app_url, slug)
    r2, r1 = before
    _, tag = part_json(app_url, slug)
    stream = Stream(app_url, f"/api/events?parts={slug}", cookie=cookie)
    for _ in range(5):
        if stream.quiet(len(stream.events)):
            break
    baseline = len(stream.events)
    down = os.environ["APP_STORAGE_DOWN_URL"]
    refused = restore(down, slug, r1["id"], cookie, tag)
    assert refused.status_code == 503 and refused.headers["Retry-After"] == STORAGE_RETRY_AFTER
    assert refused.json() == {"error": "storage_unavailable", "message": SAVE_OUTAGE}
    assert revisions(app_url, slug) == before and part_json(app_url, slug)[1] == tag
    assert call("GET", app_url, f"/api/rooms/{w.room()}", cookie).json()["room"]["state"] == "approved"
    assert stream.quiet(baseline), "a refused restore emits no event"
    made = restore(app_url, slug, r1["id"], cookie, tag)
    assert made.status_code == 201
    r3 = made.json()
    assert made.headers["Location"] == f"/api/parts/{slug}?revision={r3['id']}"
    assert r3["label"] == "r3" and r3["restoredFrom"] == r1["id"] and r3["parentRevisionId"] == r2["id"]
    for field in ("values", "sourceRef", "geometryDigest", "evaluationId"):
        assert r3[field] == r1[field], field
    assert revisions(app_url, slug)[1:] == before
    head = call("GET", app_url, f"/api/parts/{slug}?revision={r3['id']}").json()
    assert head["source"] == call("GET", app_url, f"/api/parts/{slug}?revision={r1['id']}").json()["source"]
    again = restore(app_url, slug, r3["id"], cookie, f'"{r3["id"]}"')
    assert again.status_code == 409 and again.json() == {"error": "already_head", "message": "r3 is already the latest revision."}


def test_build_tape_snapshots(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(from_="peg-rail"), part_spec("secret", visibility="private")], people=("owner", "outsider"))
    head = revisions(app_url, w.slug())[0]
    tape = call("GET", app_url, f"/api/revisions/{head['id']}/tape").json()
    ops = tape["operations"]
    assert tape["n"] == 10
    assert [(o["index"], o["kind"], o["op"], o["line"]) for o in ops] == PEG_TAPE
    assert all(o["digest"] == sha(EMPTY_SOLID) for o in ops[:8])
    assert (ops[8]["volume"], ops[8]["delta"]) == (pytest.approx(12960), pytest.approx(12960))
    assert ops[9]["digest"] == ops[8]["digest"] and ops[9]["delta"] == 0
    assert ops[10]["volume"] == pytest.approx(14656.46) and ops[10]["delta"] == pytest.approx(1696.46)
    assert ops[10]["digest"] == head["geometryDigest"]
    store = S3()
    for digest in {o["digest"] for o in ops}:
        assert sha(store.get(f"solids/{digest}.json")) == digest
    secret = revisions(app_url, w.slug("secret"), w.cookie())[0]["id"]
    assert call("GET", app_url, f"/api/revisions/{secret}/tape", w.cookie("outsider")).status_code == 404
    with visit(browser, app_url, f"/tapes/{head['id']}") as page:
        evaluations: list[str] = []
        page.on("request", lambda r: evaluations.append(r.url) if urlparse(r.url).path == "/api/evaluations" else None)
        slider = page.get_by_role("slider", name="Build tape")
        eventually(page, lambda: slider.get_attribute("aria-valuemax") == "10", "tape loaded")
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{w.title()} · r1 build tape")
        slider.focus()
        page.keyboard.press("End")
        assert slider.get_attribute("aria-valuetext") == "Operation 10 of 10 · join · boss"
        eventually(page, shows(page.locator('[data-ui="tape-readout"]'), f"Operation 10 of 10 · boss · +1.70{NNBSP}cm³"), "readout")
        page.keyboard.press("Shift+ArrowLeft")
        eventually(page, lambda: vp(page, "data-tape-operation") == "8" and vp(page, "data-digest") == ops[8]["digest"], "op 8 snapshot")
        assert vp(page, "data-volume") == f"{ops[8]['volume']:.2f}"
        stored = call("GET", app_url, f"/api/solids/{ops[8]['digest']}")
        assert stored.status_code == 200 and sha(stored.content) == vp(page, "data-digest"), "the drawn digest is the stored solid's"
        assert evaluations == []


def test_wf_build_tape_keyboard_touch(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(from_="peg-rail")])
    head = revisions(app_url, w.slug())[0]
    ops = call("GET", app_url, f"/api/revisions/{head['id']}/tape").json()["operations"]
    with visit(browser, app_url, f"/tapes/{head['id']}", reduced_motion="reduce") as page:
        slider = page.get_by_role("slider", name="Build tape")
        readout = page.locator('[data-ui="tape-readout"]')
        eventually(page, lambda: slider.get_attribute("aria-valuemax") == "10", "tape loaded")
        slider.focus()
        page.keyboard.press("End")
        camera0 = vp(page, "data-camera")
        page.keyboard.press("ArrowLeft")
        assert slider.get_attribute("aria-valuenow") == "9"
        assert slider.get_attribute("aria-valuetext") == "Operation 9 of 10 · params · repeat"
        eventually(page, shows(readout, "Operation 9 of 10 · repeat"), "params readout")
        eventually(page, lambda: highlighted_line(page) == "10", "source line 10 highlighted")
        page.keyboard.press("Shift+ArrowLeft")
        eventually(page, lambda: vp(page, "data-digest") == ops[8]["digest"], "Shift+Left jumps to the body")
        assert readout.inner_text().strip() == f"Operation 8 of 10 · box · +12.96{NNBSP}cm³"
        eventually(page, lambda: highlighted_line(page) == "9", "source line 9 highlighted")
        page.keyboard.press("Shift+ArrowRight")
        assert slider.get_attribute("aria-valuenow") == "10"
        page.keyboard.press("Home")
        eventually(page, shows(readout, "Operation 0 of 10 · empty"), "start readout")
        slider.evaluate(COMPOSING_JS, "ArrowRight")
        assert slider.get_attribute("aria-valuenow") == "0"
        page.keyboard.press("End")
        box = slider.bounding_box()
        now, top = float(slider.get_attribute("aria-valuenow")), float(slider.get_attribute("aria-valuemax"))
        x = min(box["x"] + box["width"] - 2, max(box["x"] + 2, box["x"] + box["width"] * now / top))
        y = center(slider)[1]
        touch(page, "touchStart", x, y)
        touch(page, "touchMove", box["x"] + 2, y)
        assert int(slider.get_attribute("aria-valuenow")) < 10
        touch(page, "touchCancel")
        eventually(page, lambda: slider.get_attribute("aria-valuenow") == "10", "a cancelled drag returns to its start tick")
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(box["x"] + 1, y, steps=8)
        page.mouse.up()
        eventually(page, lambda: slider.get_attribute("aria-valuenow") == "0", "a released drag settles on its tick")
        assert vp(page, "data-camera") == camera0, "the camera never moves with the tape"


def test_wf_build_tape_fork(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec(), part_spec("rail", from_="peg-rail")])
    slug, cookie = w.slug(), w.cookie()
    r1 = revisions(app_url, slug)[0]["id"]
    early = fork(app_url, r1, 5, cookie, f'"{r1}"')
    assert early.status_code == 422 and early.json()["errors"]["operation"] == "Fork from the body operation or later."
    assert fork(app_url, r1, 7, w.cookie("visitor"), f'"{r1}"').status_code == 403
    made = fork(app_url, r1, 7, cookie, f'"{r1}"').json()
    assert made["forkedFrom"] == {"revisionId": r1, "operation": 7} and made["label"] == "r2"
    source = call("GET", app_url, f"/api/parts/{slug}?revision={made['id']}").json()["source"]
    assert source.rstrip("\n") == "\n".join(TWIN_SOURCE_LINES[:8])
    rail = revisions(app_url, w.slug("rail"))[0]["id"]
    in_repeat = fork(app_url, rail, 9, cookie, f'"{rail}"').json()
    rail_source = call("GET", app_url, f"/api/parts/{w.slug('rail')}?revision={in_repeat['id']}").json()["source"]
    assert rail_source.rstrip("\n").endswith("repeat pegCount pegPitch {\n}")
    with visit(browser, app_url, f"/parts/{slug}", cookie=cookie) as page:
        wait_settled(page, 0)
        slider = page.get_by_role("slider", name="Build tape")
        slider.focus()
        page.keyboard.press("Home")
        for _ in range(7):
            page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=f"Fork from operation {FORK_OP}?")
        expect(dialog.get_by_text("The new revision keeps operations 0 to 7 and drops the rest.")).to_be_visible()
        click(dialog.get_by_role("button", name="Fork"))
        eventually(page, lambda: revisions(app_url, slug)[0]["label"] == "r3", "fork created r3")
        new = revisions(app_url, slug)[0]["id"]
        eventually(page, lambda: query_of(page.url).get("revision") == new, "lands on the new revision")
        eventually(page, lambda: slider.get_attribute("aria-valuenow") == "7", "tape at the forked operation")


def test_wf_gallery_likes_stored_first(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    _, tag = part_json(app_url, slug)
    down = os.environ["APP_STORAGE_DOWN_URL"]
    refused = save(down, slug, {"width": 72.5}, cookie, tag)
    assert refused.status_code == 503 and refused.json()["message"] == SAVE_OUTAGE
    assert len(revisions(app_url, slug)) == 1
    assert [p["revisionCount"] for p in call("GET", app_url, "/api/dashboard", cookie).json()["parts"] if p["slug"] == slug] == [1]
    made = save(app_url, slug, {"width": 72.5}, cookie, tag)
    assert made.status_code == 201
    rev = made.json()
    store = S3()
    assert sha(store.get(f"solids/{rev['geometryDigest']}.json")) == rev["geometryDigest"]
    assert store.get(f"thumbnails/{rev['geometryDigest']}.svg")
    stored_source = store.get(rev["sourceRef"])
    assert rev["sourceRef"] == f"sources/{sha(stored_source)}.tine"
    assert stored_source.decode() == call("GET", app_url, f"/api/parts/{slug}?revision={rev['id']}").json()["source"]
    for op in call("GET", app_url, f"/api/revisions/{rev['id']}/tape").json()["operations"]:
        assert sha(store.get(f"solids/{op['digest']}.json")) == op["digest"]


def test_wf_gallery_likes_paging(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(f"p{i}", from_="spacer-ring") for i in range(13)])
    ours = {w.slug(f"p{i}") for i in range(13)}
    seen: list[str] = []
    cursor: str | None = None
    for page_number in range(PAGE_WALK_LIMIT):
        path = "/api/parts?sort=newest" + (f"&cursor={cursor}" if cursor else "")
        body = call("GET", app_url, path).json()
        assert len(body["parts"]) <= PAGE_SIZE
        if body["nextCursor"]:
            assert len(body["parts"]) == PAGE_SIZE
        seen += [p["slug"] for p in body["parts"]]
        if page_number == 0:
            world(app_url, parts=[part_spec("late", from_="spacer-ring")])
        cursor = body["nextCursor"]
        if not cursor or ours <= set(seen):
            break
    assert len(seen) == len(set(seen)), "no part repeats across pages"
    assert ours <= set(seen), "no part is skipped"
    body = call("GET", app_url, "/api/parts?category=jigs").json()
    assert all(p["category"] == "jigs" for p in body["parts"])
    assert [c["slug"] for c in body["categories"]] == CATEGORY_SLUGS
    for query, field in (("category=nowhere", "category"), ("sort=random", "sort"), ("cursor=zzz", "cursor")):
        bad = call("GET", app_url, f"/api/parts?{query}")
        assert bad.status_code == 422 and field in bad.json()["errors"]
    assert call("GET", app_url, "/api/parts?cursor=zzz").json()["errors"]["cursor"] == "Start again from the first page."
    total = call("GET", app_url, "/api/parts?sort=featured").json()["total"]
    pending: list[Route] = []

    def hold(p: Page) -> None:
        p.route(lambda url: urlparse(url).path == "/api/parts", lambda route: pending.append(route))

    with visit(browser, app_url, "/", size=WIDE, prepare=hold) as page:
        skeleton = page.locator('[data-ui="card-skeleton"]').first
        eventually(page, lambda: skeleton.count() == 1 and skeleton.is_visible() and bool(pending), "skeletons before parts arrive")
        size = skeleton.bounding_box()
        page.unroute_all()
        for route in pending:
            route.continue_()
        cards = page.locator('[data-ui="part-card"]')
        eventually(page, lambda: cards.count() == PAGE_SIZE and page.locator('[data-ui="card-skeleton"]').count() == 0, "cards replace skeletons")
        card = cards.first.bounding_box()
        assert abs(card["width"] - size["width"]) <= 1 and abs(card["height"] - size["height"]) <= 1
        more = page.get_by_role("button", name="Show more parts")
        click(more)
        expected = min(total, 2 * PAGE_SIZE)
        eventually(page, lambda: cards.count() == expected, "Show more parts appends a page")
        eventually(page, lambda: status(page, "Gallery").inner_text().strip() == f"Showing {expected} parts.", "gallery count line")
        if more.count():
            expect(more).to_be_focused()


def test_wf_gallery_likes_live(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "fan1", "fan2", "watcher"), parts=[part_spec()])
    slug, title = w.slug(), w.title()
    with visit(browser, app_url, "/", cookie=w.cookie("watcher")) as gallery, \
            visit(browser, app_url, f"/parts/{slug}", cookie=w.cookie("watcher")) as part, \
            visit(browser, app_url, f"/parts/{slug}", cookie=w.cookie("fan1")) as fan:
        select(gallery.get_by_role("combobox", name="Sort by"), "Newest")
        card = gallery.get_by_role("list", name="Parts").get_by_role("listitem").filter(has=gallery.get_by_role("link", name=title, exact=True))
        count = card.locator('[data-ui="like-count"]')
        eventually(gallery, lambda: count.count() == 1 and count.inner_text().strip() == "0 likes", "card shows 0 likes")
        wait_settled(fan, 0)
        like = fan.get_by_role("button", name=f"Like {title}")
        click(like)
        expect(like).to_have_attribute("aria-pressed", "true")
        deadline = time.monotonic() + LIVE_SECONDS
        while time.monotonic() < deadline and not (count.inner_text().strip() == "1 like" and part.get_by_text("1 like").count()):
            advance(gallery, STEP_MS)
            advance(part, STEP_MS)
        assert count.inner_text().strip() == "1 like" and part.get_by_text("1 like").count() >= 1, "live within 2 s"
        assert post(app_url, "/api/grading/drop-streams", {}).status_code == 204
        assert call("PUT", app_url, f"/api/parts/{slug}/like", w.cookie("fan2")).json() == {"liked": True, "likes": 2}
        eventually(gallery, lambda: count.inner_text().strip() == "2 likes", "the reconnected gallery catches up")
    again = call("PUT", app_url, f"/api/parts/{slug}/like", w.cookie("fan2"))
    assert again.json() == {"liked": True, "likes": 2}
    assert part_json(app_url, slug)[0]["likes"] == 2
    assert call("PUT", app_url, f"/api/parts/{slug}/like").status_code == 401


def test_dashboard(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "other", "fresh"),
              parts=[part_spec("a"), part_spec("b"), part_spec("theirs", owner="other")],
              revisions=[rev_spec("r2", {"width": 61}, part="a")],
              rooms=[room_spec("mine", part="a", reviewers=("rev1", "other")), room_spec("review", part="theirs", owner="other", reviewers=("owner", "rev1"))],
              likes=[{"part": "theirs", "users": ["owner"]}])
    api = call("GET", app_url, "/api/dashboard", w.cookie()).json()
    mine = [p for p in api["parts"] if p["slug"] in (w.slug("a"), w.slug("b"))]
    assert [p["slug"] for p in mine] == sorted([w.slug("a"), w.slug("b")])
    a = next(p for p in mine if p["slug"] == w.slug("a"))
    assert a["head"]["label"] == "r2" and a["revisionCount"] == 2
    assert {r["id"] for r in api["rooms"]} >= {w.room("mine"), w.room("review")}
    assert [l["slug"] for l in api["liked"]] == [w.slug("theirs")]
    assert call("GET", app_url, "/api/dashboard").status_code == 401
    with visit(browser, app_url, "/dashboard", cookie=w.cookie()) as page:
        page.reload()
        for region, row in (("My parts", f"{w.title('a')} · r2 · 2 revisions"),
                            ("Review rooms", f"{w.room_title('mine')} · Open · Approvals 0 of 2"),
                            ("Review rooms", f"{w.room_title('review')} · Open · Approvals 0 of 2"),
                            ("Liked parts", f"{w.title('theirs')} · {w.name('other')}")):
            eventually(page, shows(page.get_by_role("region", name=region), row), f"{region} lists {row}")
    with visit(browser, app_url, "/dashboard", cookie=w.cookie("fresh")) as page:
        for line in ("You have no parts yet.", "No review rooms yet.", "You have not liked any parts yet."):
            eventually(page, lambda line=line: page.get_by_text(line).count() == 1, f"empty line {line}")
        expect(page.get_by_role("link", name="Browse the gallery")).to_be_visible()


def test_publish_part(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    cookie = w.cookie()
    title = f"Cafe\u0301 shelf {tok()}"
    body = {"title": title, "category": "brackets", "visibility": "public", "source": PUBLISH_SOURCE}
    assert post(app_url, "/api/parts", body).status_code == 401
    errors = {
        "title": post(app_url, "/api/parts", {**body, "title": "x" * 81}, cookie).json()["errors"]["title"],
        "line": post(app_url, "/api/parts", {**body, "source": "# bad\nparam = oops\nbox 1 1 1\n"}, cookie).json()["errors"]["source"],
        "body": post(app_url, "/api/parts", {**body, "source": "# empty\nparam width = 5 mm\n"}, cookie).json()["errors"]["source"],
    }
    assert errors["title"] == "Use 1 to 80 characters." and errors["line"].startswith("Line 2: ") and errors["body"].startswith("Line ")
    assert call("GET", app_url, "/api/dashboard", cookie).json()["parts"] == []
    key = idempotency_key()
    made = post(app_url, "/api/parts", body, cookie, key)
    assert made.status_code == 201 and post(app_url, "/api/parts", body, cookie, key).content == made.content
    slug, rev = made.json()["slug"], made.json()["revision"]
    assert made.headers["Location"] == f"/api/parts/{slug}" and rev["label"] == "r1"
    part, _ = part_json(app_url, slug)
    assert part["title"] == unicodedata.normalize("NFC", title) and part["source"] == PUBLISH_SOURCE
    assert S3().get(f"sources/{sha(PUBLISH_SOURCE)}.tine") == PUBLISH_SOURCE.encode()
    assert rev["sourceRef"] == f"sources/{sha(PUBLISH_SOURCE)}.tine"
    assert rev["geometryDigest"] == eval_digest(app_url, slug, {})
    assert len(call("GET", app_url, "/api/dashboard", cookie).json()["parts"]) == 1
    ui_title = f"Bench publish {tok()}"
    with visit(browser, app_url, "/parts/new", cookie=cookie) as page:
        expect(page.get_by_role("heading", level=1)).to_have_text("Publish a part")
        fill(page.get_by_role("textbox", name="Title"), ui_title)
        select(page.get_by_role("combobox", name="Category"), "Jigs")
        click(page.get_by_role("radio", name="Public"))
        fill(page.get_by_role("textbox", name="Source"), PUBLISH_SOURCE)
        click(page.get_by_role("button", name="Publish"))
        eventually(page, lambda: re.fullmatch(r"/parts/[^/?]+", urlparse(page.url).path) is not None
                   and urlparse(page.url).path != "/parts/new", "lands on the new part")
        landed = urlparse(page.url).path.split("/")[-1]
    assert part_json(app_url, landed)[0]["title"] == ui_title


def test_archives(app_url: str) -> None:
    w = world(app_url, people=("owner", "outsider"), parts=[part_spec(), part_spec("secret", visibility="private")])
    slug = w.slug()
    rev = revisions(app_url, slug)[0]
    tape = call("GET", app_url, f"/api/revisions/{rev['id']}/tape").json()
    store, prefix = S3(), f"{slug}-r1"
    expected = {f"{prefix}/part.tine": store.get(rev["sourceRef"])}
    for digest in {o["digest"] for o in tape["operations"]}:
        expected[f"{prefix}/solids/{digest}.json"] = store.get(f"solids/{digest}.json")
    for kind in ("zip", "tar"):
        response = call("GET", app_url, f"/api/revisions/{rev['id']}/archive.{kind}")
        assert response.status_code == 200
        assert response.headers["content-type"].startswith("application/zip" if kind == "zip" else "application/x-tar")
        assert response.headers["content-disposition"] == f'attachment; filename="{prefix}.{kind}"'
        if kind == "zip":
            with zipfile.ZipFile(io.BytesIO(response.content)) as archive:
                files = {n: archive.read(n) for n in archive.namelist() if not n.endswith("/")}
        else:
            with tarfile.open(fileobj=io.BytesIO(response.content), mode="r:") as archive:
                files = {m.name: archive.extractfile(m).read() for m in archive.getmembers() if m.isfile()}
        assert set(files) == set(expected) | {f"{prefix}/revision.json", f"{prefix}/manifest.txt"}
        for path, data in expected.items():
            assert files[path] == data, path
        assert json.loads(files[f"{prefix}/revision.json"]) == rev
        lines = files[f"{prefix}/manifest.txt"].decode().splitlines()
        assert lines[0] == f"Volume: 18{THIN}885.84{NNBSP}mm³" and lines[1] == f"Bounding box: 60 × 40 × 8{NNBSP}mm"
        others = sorted(p for p in files if p != f"{prefix}/manifest.txt")
        assert lines[2:] == [f"{p} {sha(files[p])} {len(files[p])}" for p in others]
        assert store.get(f"archives/{rev['id']}.{kind}") == response.content
        again = call("GET", app_url, f"/api/revisions/{rev['id']}/archive.{kind}")
        assert again.content == response.content
    secret = revisions(app_url, w.slug("secret"), w.cookie())[0]["id"]
    assert call("GET", app_url, f"/api/revisions/{secret}/archive.zip", w.cookie("outsider")).status_code == 404


def test_resumable_events(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2", "fan", "outsider"), parts=[part_spec()], rooms=[room_spec()])
    slug = w.slug()
    stream = Stream(app_url, f"/api/events?parts={slug}", cookie=w.cookie())
    assert stream.lines[:2] == ["retry: 1000", ""]
    call("PUT", app_url, f"/api/parts/{slug}/like", w.cookie("fan"))
    _, tag = part_json(app_url, slug)
    save(app_url, slug, {"width": 61}, w.cookie(), tag)
    post(app_url, f"/api/rooms/{w.room()}/comments", {"body": "Event", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev1"))
    events = stream.wait_for(lambda e: {"like", "revision", "comment"} <= {x["event"] for x in e}, 10.0, "like, revision and comment events")
    ids = [int(e["id"]) for e in events]
    assert ids == sorted(set(ids))
    assert of_type(events, "like")[0]["data"] == {"type": "like", "partSlug": slug, "likes": 1}
    revision = of_type(events, "revision")[0]["data"]
    assert revision["revision"]["label"] == "r2" and revision["authorDisplayName"] == w.name() and revision["digestChanged"] is True
    assert of_type(events, "comment")[0]["data"]["comment"]["body"] == "Event"
    assert post(app_url, "/api/grading/drop-streams", {}).status_code == 204
    assert stream.ended.wait(STREAM_OPEN_S)
    call("PUT", app_url, f"/api/parts/{slug}/like", w.cookie("outsider"))
    resumed = Stream(app_url, f"/api/events?parts={slug}", cookie=w.cookie(), last_id=ids[0])
    got = resumed.wait_for(lambda e: len(e) >= len(events), 10.0, "the reconnect replays every missed event")
    assert [int(e["id"]) for e in got[: len(events) - 1]] == ids[1:]
    assert got[len(events) - 1]["event"] == "like" and got[len(events) - 1]["data"]["likes"] == 2
    assert len({e["id"] for e in got}) == len(got)
    for cookie in (w.cookie("outsider"), None):
        other = Stream(app_url, f"/api/events?parts={slug}", cookie=cookie, last_id=ids[0] - 1)
        seen = other.wait_for(lambda e: any(x["event"] == "like" and x["data"]["likes"] == 2 for x in e), 10.0, "public events replayed")
        assert not of_type(seen, "comment") and not of_type(seen, "approvals")


def test_storage_outage(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    rev = revisions(app_url, slug)[0]
    health = call("GET", down, "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "unavailable", "storage": "down"}
    for path in (f"/api/revisions/{rev['id']}/archive.zip", f"/api/solids/{rev['geometryDigest']}",
                 f"/api/solids/{rev['geometryDigest']}/thumbnail.svg", f"/api/compare?base={rev['id']}&head={rev['id']}"):
        r = call("GET", down, path)
        assert r.status_code == 503 and r.headers["Retry-After"] == STORAGE_RETRY_AFTER, path
        assert r.json() == {"error": "storage_unavailable", "message": DOWNLOAD_OUTAGE}, path
    tag = f'"{rev["id"]}"'
    writes = [save(down, slug, {"width": 61}, cookie, tag),
              post(down, f"/api/parts/{slug}/copies", {"values": {}, "message": "x"}, w.cookie("visitor")),
              fork(down, rev["id"], 7, cookie, tag),
              post(down, "/api/parts", {"title": "Down", "category": "jigs", "visibility": "public", "source": PUBLISH_SOURCE}, cookie)]
    for r in writes:
        assert r.status_code == 503 and r.json() == {"error": "storage_unavailable", "message": SAVE_OUTAGE}
    assert len(revisions(app_url, slug)) == 1
    assert [p["slug"] for p in call("GET", app_url, "/api/dashboard", w.cookie("visitor")).json()["parts"]] == []
    assert len(call("GET", app_url, "/api/dashboard", cookie).json()["parts"]) == 1
    for path in ("/api/parts", f"/api/parts/{slug}", f"/api/parts/{slug}/revisions", f"/api/revisions/{rev['id']}/tape"):
        assert call("GET", down, path).status_code == 200, path
    assert evaluate(down, slug, {}).json()["status"] == "succeeded"
    assert post(down, "/api/preflight", {"partSlug": slug, "values": {}, "process": "mill-3"}, cookie).status_code == 201
    with visit(browser, down, f"/tapes/{rev['id']}") as page:
        panel = page.locator('[data-ui="outage-panel"]')
        eventually(page, shows(panel, REPLAY_OUTAGE), "tape outage panel")
        assert "Last good solid: none yet" in panel.inner_text()
        expect(page.get_by_role("slider", name="Build tape")).to_be_visible()


def click_aria_disabled(locator: Locator) -> None:
    expect(locator).to_be_visible()
    locator.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    box = locator.bounding_box()
    assert box is not None
    locator.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)


def test_storage_degraded_pages(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, parts=[part_spec()])
    with visit(browser, down, "/") as page:
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "gallery Storage status")
        assert page.get_by_role("alert").filter(has_text=STORAGE_BANNER).count() == 0
    with visit(browser, down, f"/parts/{w.slug()}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "part Storage status")
        sent: list[str] = []
        page.on("request", lambda r: sent.append(r.url) if "/archive." in r.url or (r.method == "POST" and "/revisions" in r.url) else None)
        for name in ("Download ZIP", "Download TAR"):
            button = page.get_by_role("button", name=name)
            expect(button).to_have_attribute("aria-disabled", "true")
            button.focus()
            expect(button).to_be_focused()
        click_aria_disabled(page.get_by_role("button", name="Download ZIP"))
        eventually(page, lambda: page.get_by_role("alert").filter(has_text=DOWNLOAD_OUTAGE).count() == 1, "download outage alert")
        click(page.get_by_role("button", name="Save revision"))
        dialog = page.get_by_role("dialog", name="Save revision")
        expect(dialog.get_by_role("button", name="Save")).to_have_attribute("aria-disabled", "true")
        click_aria_disabled(dialog.get_by_role("button", name="Save"))
        eventually(page, lambda: dialog.get_by_role("alert").filter(has_text=SAVE_OUTAGE).count() == 1, "save outage alert in the dialog")
        expect(dialog).to_be_visible()
        assert sent == [], "outage controls send no request"
    with visit(browser, down, "/parts/new", cookie=w.cookie()) as page:
        publish = page.get_by_role("button", name="Publish")
        eventually(page, lambda: publish.get_attribute("aria-disabled") == "true", "Publish aria-disabled")
        click_aria_disabled(publish)
        eventually(page, lambda: page.get_by_role("alert").filter(has_text=SAVE_OUTAGE).count() == 1, "publish outage alert")


def test_grading_routes(app_url: str, mail: Mailpit) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2", "fan"), parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61})],
              rooms=[room_spec()], comments=[{"key": "c", "room": "room", "author": "rev1", "body": "Hi", "anchor": {"kind": "none"}, "pose": POSE}],
              approvals=[{"room": "room", "reviewer": "rev1"}], likes=[{"part": "part", "users": ["fan", "rev2"]}])
    me = call("GET", app_url, "/api/me", w.cookie("fan")).json()
    assert me["email"] == w.email("fan") and me["displayName"] == w.name("fan")
    assert w.data["revisions"]["r2"]["label"] == "r2" and w.data["comments"]["c"]["id"]
    assert part_json(app_url, w.slug())[0]["likes"] == 2
    room = call("GET", app_url, f"/api/rooms/{w.room()}", w.cookie()).json()
    assert [c["id"] for c in room["comments"]] == [w.data["comments"]["c"]["id"]]
    assert room["room"]["approvals"][0]["revisionId"] == w.rev("r2")
    revs = revisions(app_url, w.slug())
    assert revs[0]["createdAt"] == revs[1]["createdAt"] == room["comments"][0]["createdAt"]
    assert not [m for m in mail.messages() if w.email("rev1").lower() in [a.lower() for a in addresses(m.get("To"))]]
    bad = post(app_url, "/api/grading/setup", {"parts": [part_spec(owner="nobody")]})
    assert bad.status_code == 422 and bad.json()["errors"]
    for ms in (EVALUATOR_DELAY_MAX + 1, -1, 1.5):
        assert post(app_url, "/api/grading/evaluator-delay", {"partSlug": w.slug(), "ms": ms}).status_code == 422
    set_delay(app_url, w.slug(), 0)
    viewer = str(uuid.uuid4())
    assert counts(app_url, viewer) == {"started": 0, "completed": 0, "cancelled": 0}
    evaluate(app_url, w.slug(), {}, viewer)
    assert counts(app_url, viewer) == {"started": 1, "completed": 1, "cancelled": 0}
    stream = Stream(app_url, "/api/events?parts=*", cookie=w.cookie())
    assert post(app_url, "/api/grading/drop-streams", {}).status_code == 204
    assert stream.ended.wait(STREAM_OPEN_S), "drop-streams closes open streams"


def test_health_and_config(app_url: str) -> None:
    assert call("GET", app_url, "/api/health").json() == {"status": "ok"}
    assert call("GET", app_url, "/api/config").json() == {"evalDebounceMs": EVAL_DEBOUNCE_MS, "slowEvalNoticeMs": SLOW_EVAL_NOTICE_MS,
                                                          "commentMaxChars": 500, "requiredApprovals": 2, "preflightSignedOutLimit": 1}
    tight = call("GET", os.environ["APP_TIGHT_URL"], "/api/config").json()
    assert tight["commentMaxChars"] == TIGHT_COMMENT_MAX


def test_hero_measures_headline(browser: Browser, app_url: str) -> None:
    with visit(browser, app_url, "/", size=WIDE) as page:
        span, readout = spin(page, "Span"), page.locator('[data-ui="hero-readout"]')
        headline = page.get_by_role("heading", level=1, name=HEADLINE)

        def matches() -> bool:
            value = float(span.get_attribute("aria-valuenow") or "nan")
            wanted = [min(HERO_SPAN_MAX, max(HERO_SPAN_MIN, px * MM_PER_PX)) for px in headline.evaluate(HEADLINE_WIDTHS_JS)]
            return any(abs(value - x) <= 0.002 for x in wanted) and \
                readout.inner_text().strip() == f"span {half_even(value, 2)}{NNBSP}mm · measured from the headline"

        eventually(page, matches, "Span measures the headline")
        before = span.get_attribute("aria-valuenow")
        page.set_viewport_size({"width": 1024, "height": 800})
        advance(page, HERO_STILL_MS // 2)
        if span.get_attribute("aria-valuenow") != before:
            pytest.fail("the hero waits a fifth of a second of stillness before measuring")
        advance(page, HERO_STILL_MS)
        eventually(page, matches, "Span re-measured after resize")
        hero = page.locator('[data-ui="hero-viewport"]')
        advance(page, 500)
        shot = capture(hero)
        commit(span, "96")
        advance(page, 500)
        assert readout.inner_text().strip() == f"span 96.00{NNBSP}mm · set by hand"
        changed(decode(shot), decode(capture(hero)))


@pytest.mark.parametrize("size", list(LAYOUT_SIZES), ids=list(LAYOUT_SIZES))
def test_responsive_layout(browser: Browser, app_url: str, size: str) -> None:
    width, height = LAYOUT_SIZES[size]
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, "/", size=(width, height)) as page:
        cards = page.locator('[data-ui="part-card"]')
        eventually(page, lambda: cards.count() >= 3, "gallery cards")
        boxes = [cards.nth(i).bounding_box() for i in range(3)]
        top = min(b["y"] for b in boxes)
        columns = len({round(b["x"]) for b in boxes if abs(b["y"] - top) < 1})
        assert columns == (1 if width < 640 else 2 if width < 1024 else 3)
        nav, grid = page.get_by_role("navigation", name="Categories").bounding_box(), page.locator('[data-ui="gallery-grid"]').bounding_box()
        if width >= 768:
            assert nav["x"] + nav["width"] <= grid["x"] + 0.5
        else:
            assert nav["y"] + nav["height"] <= grid["y"] + 0.5
        assert page.evaluate(OVERFLOW_JS)[0] == page.evaluate(OVERFLOW_JS)[1]
    with visit(browser, app_url, f"/parts/{w.slug()}", size=(width, height)) as page:
        wait_settled(page, 0)
        box, rail = viewport(page).bounding_box(), page.get_by_role("button", name="Dimensions").bounding_box()
        if width >= 1024:
            assert rail["x"] >= box["x"] + box["width"] - 0.5
        else:
            assert abs(box["x"]) <= 0.5 and abs(box["width"] - page.evaluate("() => document.documentElement.clientWidth")) <= 0.5
            assert rail["y"] >= box["y"] + box["height"] - 0.5
        overflow = page.evaluate(OVERFLOW_JS)
        assert overflow[0] == overflow[1]


def test_motion_timing_and_reduced_motion(browser: Browser, app_url: str) -> None:
    w, revs = compare_world(app_url)
    with visit(browser, app_url, f"/parts/{w.slug()}", cookie=w.cookie(), size=WIDE) as page:
        wait_settled(page, 0)
        region = page.get_by_role("region", name="Review", exact=True)
        click(page.get_by_role("button", name="Review", exact=True))
        durations = [a["duration"] for a in page.get_by_role("button", name="Review", exact=True).evaluate(ANIMATIONS_JS)] + \
            ([a["duration"] for a in region.evaluate(ANIMATIONS_JS)] if region.count() else [])
        assert durations and DISCLOSURE_MIN_MS <= max(durations) <= DISCLOSURE_MAX_MS, durations
        click(page.get_by_role("button", name="Save revision"))
        dialog = page.get_by_role("dialog", name="Save revision")
        timings = [a["duration"] for a in dialog.evaluate(ANIMATIONS_JS)]
        assert timings and DISCLOSURE_MIN_MS <= max(timings) <= DISCLOSURE_MAX_MS, timings
    r1, r2 = revs[0]["id"], revs[1]["id"]
    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay") as page:
        eventually(page, lambda: page.get_by_role("list", name="Hunks").get_by_role("button").count() == 2, "hunks")
        page.get_by_role("button", name="Reset view").focus()
        page.keyboard.press("j")
        elapsed = 0
        for _ in range(GLIDE_MAX_MS // 20 + 5):
            if vp(page, "data-camera-moving") != "true":
                break
            advance(page, 20)
            elapsed += 20
        assert GLIDE_MIN_MS <= elapsed <= GLIDE_MAX_MS + 20, f"glide took {elapsed} ms"
    with visit(browser, app_url, f"/parts/{w.slug()}", size=WIDE, reduced_motion="reduce") as page:
        wait_settled(page, 0)
        click(page.get_by_role("button", name="Review", exact=True))
        assert all(a["duration"] == 0 for a in page.get_by_role("button", name="Review", exact=True).evaluate(ANIMATIONS_JS))
        set_delay(app_url, w.slug(), 3000)
        spin(page, "Width").focus()
        page.keyboard.press("ArrowUp")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        frames = page.locator('[data-ui="frame"]')
        assert all(a["iterations"] != -1 for i in range(frames.count()) for a in frames.nth(i).evaluate(ANIMATIONS_JS))
        set_delay(app_url, w.slug(), 0)


def test_drawn_chrome_and_accent(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    rev = revisions(app_url, w.slug())[0]["id"]
    routes = [("/", "cyan"), (f"/parts/{w.slug()}", "cyan"), (f"/tapes/{rev}", "cyan"), ("/signin", "cyan"), ("/signup", "cyan"),
              ("/dashboard", "band"), (f"/rooms/{w.room()}", "band")]
    with visit(browser, app_url, "/", cookie=w.cookie(), size=WIDE) as page:
        for path, accent in routes:
            page.goto(app_url + path)
            advance(page, 300)
            assert page.locator("body").get_attribute("data-accent") == accent, path
            for hook in ("frame", "vertex-dot", "crosshair", "dimension-leader"):
                items = page.locator(f'[data-ui="{hook}"]')
                for i in range(items.count()):
                    assert items.nth(i).get_attribute("aria-hidden") == "true" or items.nth(i).evaluate("e => !!e.closest('[aria-hidden=\"true\"]')")
                    assert items.nth(i).evaluate("e => getComputedStyle(e).pointerEvents") == "none"
            leader = page.locator('[data-ui="dimension-leader"]').first
            if leader.count():
                assert leader.locator('[data-ui="leader-unit"]').inner_text().strip() == "″"
                figure = float(leader.locator('[data-ui="leader-figure"]').inner_text().strip())
                widths = page.get_by_role("heading", level=1).first.evaluate(HEADLINE_WIDTHS_JS)
                assert any(abs(figure - float(f"{px / PX_PER_INCH:.2g}")) < 1e-9 for px in widths), (figure, widths)
        page.goto(app_url + f"/parts/{w.slug()}")
        wait_settled(page, 0)
        box = viewport(page).bounding_box()
        dots = page.locator('[data-ui="vertex-dot"]')
        centres = [(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2, b["width"]) for b in (dots.nth(i).bounding_box() for i in range(dots.count()))]
        assert all(abs(d - VERTEX_DOT_PX) <= 0.5 for _, _, d in centres)
        frame = next(f for f in (page.locator('[data-ui="frame"]').nth(i).bounding_box() for i in range(page.locator('[data-ui="frame"]').count()))
                     if f["x"] <= box["x"] + 1 and f["width"] >= box["width"] - 2)
        for cx, cy in ((frame["x"], frame["y"]), (frame["x"] + frame["width"], frame["y"] + frame["height"])):
            assert any(abs(x - cx) <= 1 and abs(y - cy) <= 1 for x, y, _ in centres), "a dot sits on each frame corner"
        for size, dot in ((WIDE, HERO_DOT_WIDE_PX), (TABLET, HERO_DOT_NARROW_PX)):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            page.goto(app_url + "/")
            advance(page, 300)
            sizes = [round(dots.nth(i).bounding_box()["width"]) for i in range(dots.count())]
            assert sizes.count(dot) >= 4, f"hero dots at {size}: {sizes}"


def test_server_boundary(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec(), part_spec("secret", visibility="private")])
    slug = w.slug()
    cross = call("PUT", app_url, f"/api/parts/{slug}/like", w.cookie(), Origin="http://evil.test")
    assert cross.status_code == 403 and cross.json() == {"error": "cross_origin", "message": "Requests must come from Tinework."}
    shell = '{"partSlug":"%s","values":{},"seq":1,"viewerId":"%s"' % (slug, uuid.uuid4())
    exact = shell + " " * (BODY_LIMIT - len(shell.encode()) - 1) + "}"
    assert raw_post(app_url, "/api/evaluations", exact).status_code != 413
    over = raw_post(app_url, "/api/evaluations", exact[:-1] + " }")
    assert over.status_code == 413 and over.json() == {"error": "too_large", "message": f"Request body is larger than 65{THIN}536 bytes."}
    assert call("GET", app_url, "/api/no-such-thing").json() == {"error": "not_found", "message": "Not found."}
    assert save(app_url, slug, {"width": "x"}, None, None).status_code == 401
    assert save(app_url, slug, {"width": 61}, w.cookie("visitor"), None).status_code == 403
    assert save(app_url, slug, {"width": 999}, w.cookie(), None).status_code == 428
    assert save(app_url, w.slug("secret"), {"width": 61}, w.cookie("visitor"), None).status_code == 404
    for path, leak in (("/.env", "DATABASE_URL="), ("/package.json", '"dependencies"')):
        assert leak not in call("GET", app_url, path).text
    secrets = [v for v in (os.environ.get("S3_SECRET_ACCESS_KEY"), os.environ.get("DATABASE_URL")) if v]
    with visit(browser, app_url, "/") as page:
        scripts = [r.url for r in page.context.request.get(app_url + "/").url and [] or []]
        assets: list[str] = []
        page.on("response", lambda r: assets.append(r.url) if same_origin(r.url, app_url) else None)
        page.reload()
        advance(page, 500)
    for url in set(assets):
        body = httpx.get(url, timeout=HTTP_TIMEOUT).text
        assert not any(s in body for s in secrets), url
        if urlparse(url).path.endswith(".js"):
            mapped = httpx.get(url + ".map", timeout=HTTP_TIMEOUT)
            assert mapped.status_code != 200 or "json" not in mapped.headers.get("content-type", "")
    del scripts
    signin = post(app_url, "/api/auth/signin", {"email": w.email(), "password": PASSWORD})
    flags = signin.headers.get("set-cookie", "").lower()
    assert "HttpOnly".lower() in flags and "SameSite=Lax".lower() in flags
    rev = revisions(app_url, slug)[0]["id"]
    for _ in range(10):
        with httpx.stream("GET", f"{app_url}/api/events?parts={slug}", timeout=HTTP_TIMEOUT) as r:
            next(r.iter_lines())
        with httpx.stream("GET", f"{app_url}/api/revisions/{rev}/archive.tar", timeout=HTTP_TIMEOUT) as r:
            next(r.iter_bytes(), b"")
    pg_quiet(app_url)


def test_evaluation_stops_on_close(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    down = os.environ["APP_STORAGE_DOWN_URL"]
    set_delay(app_url, slug, 30000)
    try:
        viewers = [str(uuid.uuid4()) for _ in range(5)]

        def leave(viewer: str) -> None:
            try:
                httpx.post(app_url + "/api/evaluations", json={"partSlug": slug, "values": {}, "seq": 1, "viewerId": viewer},
                           timeout=httpx.Timeout(ABORT_AFTER_S))
            except httpx.HTTPError:
                pass

        with concurrent.futures.ThreadPoolExecutor(5) as pool:
            list(pool.map(leave, viewers))
        for viewer in viewers:
            poll(lambda v=viewer: counts(app_url, v) == {"started": 1, "completed": 0, "cancelled": 1},
                 "a closed evaluation request ends cancelled at once", CANCEL_DEADLINE_S)
        other = str(uuid.uuid4())
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            pending = pool.submit(lambda: httpx.post(down + "/api/evaluations", json={"partSlug": slug, "values": {}, "seq": 1, "viewerId": other},
                                                     timeout=HTTP_TIMEOUT))
            poll(lambda: counts(app_url, other)["started"] == 1, "the other process started the evaluation")
            assert post(app_url, "/api/evaluations/cancel", {"viewerId": other}).status_code == 204
            poll(lambda: counts(app_url, other)["cancelled"] == 1, "cancel reaches the other process", CANCEL_DEADLINE_S)
            answer = pending.result(timeout=HTTP_TIMEOUT)
            assert answer.status_code == 200 and answer.json()["status"] == "cancelled"
    finally:
        set_delay(app_url, slug, 0)
    pg_quiet(app_url)


def test_spoken_values_toolbar_dialog(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(), part_spec("comb", from_="cable-comb")])
    with visit(browser, app_url, f"/parts/{w.slug()}", cookie=w.cookie(), size=WIDE) as page:
        wait_settled(page, 0)
        width = spin(page, "Width")
        assert (width.get_attribute("aria-valuenow"), width.get_attribute("aria-valuemin"), width.get_attribute("aria-valuemax")) == ("60", "20", "200")
        assert width.get_attribute("aria-valuetext") == f"60.0{NNBSP}millimetres"
        assert spin(page, "Thickness").get_attribute("aria-valuetext") == f"8.00{NNBSP}millimetres"
        click(page.get_by_role("radio", name="Inches"))
        assert width.get_attribute("aria-valuetext") == f"2.36{NNBSP}inches"
        assert abs(float(width.get_attribute("aria-valuemin")) - 20 / INCH_MM) < 1e-6
        click(page.get_by_role("radio", name="Millimetres"))
        reset, ortho = page.get_by_role("button", name="Reset view"), page.get_by_role("switch", name="Orthographic")
        reset.focus()
        for key, target in (("ArrowRight", ortho), ("ArrowLeft", reset), ("End", ortho), ("Home", reset), ("End", ortho)):
            page.keyboard.press(key)
            expect(target).to_be_focused()
        page.keyboard.press("Tab")
        page.keyboard.press("Shift+Tab")
        expect(ortho).to_be_focused()
        target = (vp(page, "data-camera") or "").split(",")[3:6]
        page.keyboard.press(" ")
        expect(viewport(page)).to_have_attribute("data-projection", "orthographic")
        assert (vp(page, "data-camera") or "").split(",")[3:6] == target
        click(page.get_by_role("button", name="Save revision"))
        dialog = page.get_by_role("dialog", name="Save revision")
        expect(dialog.get_by_role("textbox", name="Message")).to_be_focused()
        assert page.get_by_role("button", name="Download ZIP").count() == 0
        page.keyboard.press("Escape")
        expect(page.get_by_role("button", name="Download ZIP")).to_be_visible()
    with visit(browser, app_url, f"/parts/{w.slug('comb')}") as page:
        wait_settled(page, 0)
        length = spin(page, "Length")
        assert length.get_attribute("aria-valuemin") is None and length.get_attribute("aria-valuemax") is None
        assert spin(page, "Slot count").get_attribute("aria-valuetext") == "5"


def test_wf_preflight_keyboard_listbox_contrast(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, MILL)
        listbox = page.get_by_role("listbox", name="Findings")
        options = listbox.get_by_role("option")
        eventually(page, lambda: options.count() == 4, "four findings")
        ids = [options.nth(i).get_attribute("id") for i in range(4)]
        listbox.focus()
        for key, index in (("Home", 0), ("ArrowDown", 1), ("End", 3), ("ArrowUp", 2), ("Home", 0)):
            page.keyboard.press(key)
            assert listbox.get_attribute("aria-activedescendant") == ids[index], key
            expect(listbox).to_be_focused()
        assert all(options.nth(i).get_attribute("aria-selected") != "true" for i in range(4)), "moving does not select"
        page.keyboard.type("a")
        assert listbox.get_attribute("aria-activedescendant") == ids[2]
        page.keyboard.press("Enter")
        expect(options.nth(2)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("ArrowDown")
        page.keyboard.press(" ")
        expect(options.nth(3)).to_have_attribute("aria-selected", "true")
        assert options.nth(2).get_attribute("aria-selected") != "true"
        expect(listbox).to_be_focused()
        for i in range(4):
            ratios = options.nth(i).evaluate(CONTRAST_JS)
            assert ratios["text"] and min(ratios["text"]) >= CONTRAST_TEXT, ratios
            assert ratios["icons"] and min(ratios["icons"]) >= CONTRAST_ICON, ratios


def test_number_grammar_channels(browser: Browser, app_url: str) -> None:
    w, revs = compare_world(app_url)
    slug, room_world = w.slug(), world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])

    def refused(response: httpx.Response, field: str, label: str) -> None:
        assert response.status_code == 422
        assert response.json() == {"error": "value_grammar", "field": field, "message": f"{label} takes a plain decimal such as 12.5."}

    refused(raw_post(app_url, "/api/evaluations", '{"partSlug":"%s","values":{},"seq":"1","viewerId":"v"}' % slug), "seq", "Seq")
    refused(raw_post(app_url, "/api/grading/evaluator-delay", '{"partSlug":"%s","ms":1e3}' % slug), "ms", "Ms")
    refused(raw_post(app_url, "/api/evaluations", '{"partSlug":"%s","values":{"width":1e2},"seq":"x","viewerId":"v"}' % slug), "width", "Width")
    comment = '{"body":"x","anchor":{"kind":"point","position":[1e1,0,0]},"pose":{"position":[1,1,1],"target":[0,0,0],"up":[0,0,1],"fov":35}}'
    refused(raw_post(app_url, f"/api/rooms/{room_world.room()}/comments", comment, room_world.cookie("rev1")), "position", "Position")
    pose = '{"body":"x","anchor":{"kind":"none"},"pose":{"position":[1,1,1],"target":[0,0,0],"up":[0,0,1],"fov":35.0001}}'
    refused(raw_post(app_url, f"/api/rooms/{room_world.room()}/comments", pose, room_world.cookie("rev1")), "fov", "Fov")
    head = revs[-1]["id"]
    refused(raw_post(app_url, f"/api/revisions/{head}/fork", '{"operation":"7"}', w.cookie(), **{"If-Match": f'"{head}"'}), "operation", "Operation")
    with visit(browser, app_url, f"/parts/{slug}?operation=1.5") as page:
        wait_settled(page, 0)
        slider = page.get_by_role("slider", name="Build tape")
        eventually(page, lambda: "operation" not in query_of(page.url), "a fractional operation leaves the address")
        assert slider.get_attribute("aria-valuenow") == slider.get_attribute("aria-valuemax")
        assert not [n for n in option_names(page.get_by_role("listbox", name="Findings")) if "operation" in n.lower()]
    with visit(browser, app_url, f"/parts/{slug}/compare?base={revs[0]['id']}&head={revs[1]['id']}&view=overlay&hunk=01") as page:
        eventually(page, lambda: "hunk" not in query_of(page.url), "a padded hunk leaves the address")


def test_number_rendering(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()], revisions=[rev_spec("r2", {"width": 72.5, "thickness": 9.5})])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}?config=") as page:
        wait_settled(page, 0)
        assert vp(page, "data-volume") == "18885.84"
        width = spin(page, "Width")
        for typed, spoken in (("60.25", "60.2"), ("60.75", "60.8"), ("60.35", "60.4")):
            commit(width, typed)
            assert width.get_attribute("aria-valuetext") == f"{spoken}{NNBSP}millimetres", typed
            assert width.get_attribute("aria-valuenow") == typed
        seq = seq_of(page)
        commit(width, "61.1")
        wait_settled(page, seq)
        expect(page.get_by_text(f"61.1 × 40 × 8{NNBSP}mm").first).to_be_visible()
    r1 = revisions(app_url, slug)[-1]["id"]
    with visit(browser, app_url, f"/tapes/{r1}") as page:
        slider = page.get_by_role("slider", name="Build tape")
        eventually(page, lambda: slider.get_attribute("aria-valuemax") == "8", "tape loaded")
        slider.focus()
        page.keyboard.press("End")
        page.keyboard.press("ArrowLeft")
        eventually(page, shows(page.locator('[data-ui="tape-readout"]'), f"Operation 7 of 8 · hole · {MINUS}0.16{NNBSP}cm³"), "negative change")
    with visit(browser, app_url, f"/parts/{slug}/compare?base={r1}&head={w.rev('r2')}&view=overlay") as page:
        changes = page.get_by_role("list", name="Parameter changes")
        eventually(page, shows(changes, f"Width: 60.0 → 72.5{NNBSP}mm"), "length change line")
        assert f"Thickness: 8.00 → 9.50{NNBSP}mm" in changes.inner_text()


def test_total_order(app_url: str) -> None:
    t = tok()
    titles = [f"Bracket {t}", f"anchor {t}", f"Zeta {t}", f"Éclat {t}"]
    w = world(app_url, people=("owner", "aa", "bb", "cc"),
              parts=[part_spec(f"t{i}", title=title) for i, title in enumerate(titles)] + [part_spec("twin1", title=f"Twin {t}"), part_spec("twin2", title=f"Twin {t}")],
              revisions=[rev_spec("r2", {"width": 61}, part="t0"), rev_spec("r3", {"width": 62}, part="t0")],
              emails={"aa": f"aa-{t}@gimbrel.test", "bb": f"BB-{t}@gimbrel.test", "cc": f"cc-{t}@gimbrel.test"})
    wanted = {w.slug(f"t{i}") for i in range(4)} | {w.slug("twin1"), w.slug("twin2")}
    seen: list[str] = []
    cursor = None
    for _ in range(PAGE_WALK_LIMIT):
        body = call("GET", app_url, "/api/parts?sort=name" + (f"&cursor={cursor}" if cursor else "")).json()
        seen += [p["slug"] for p in body["parts"] if p["slug"] in wanted]
        cursor = body["nextCursor"]
        if not cursor or len(seen) == len(wanted):
            break
    order = [w.slug("t0"), w.slug("t2"), w.slug("t1"), w.slug("t3")]
    assert [s for s in seen if s in order] == order
    assert [s for s in seen if s in (w.slug("twin1"), w.slug("twin2"))] == sorted([w.slug("twin1"), w.slug("twin2")])
    assert [r["label"] for r in revisions(app_url, w.slug("t0"))] == ["r3", "r2", "r1"]
    room = post(app_url, f"/api/parts/{w.slug('t0')}/rooms",
                {"title": "Order", "reviewers": [w.email("cc"), w.email("bb"), w.email("aa")]}, w.cookie()).json()
    assert [r["email"].upper().lower() for r in room["reviewers"]] == [f"aa-{t}@gimbrel.test", f"bb-{t}@gimbrel.test", f"cc-{t}@gimbrel.test"]
    for body in ("one", "two", "three"):
        post(app_url, f"/api/rooms/{room['id']}/comments", {"body": body, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("aa"))
    comments = call("GET", app_url, f"/api/rooms/{room['id']}", w.cookie()).json()["comments"]
    assert [c["body"] for c in comments] == ["one", "two", "three"]


def test_painted_epoch(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    slug = w.slug()
    pending: list[Route] = []

    def hold(p: Page) -> None:
        p.route(lambda url: urlparse(url).path == "/api/evaluations", lambda route: pending.append(route))

    with visit(browser, app_url, f"/parts/{slug}", prepare=hold) as page:
        eventually(page, lambda: bool(pending) and viewport(page).count() == 1, "first evaluation in flight")
        assert vp(page, "data-epoch") == "0"
        page.unroute_all()
        for route in pending:
            route.continue_()
        until(page, SETTLED_JS, 0)
        assert vp(page, "data-epoch") == "1"
        seq = seq_of(page)
        spin(page, "Width").focus()
        page.keyboard.press("ArrowUp")
        wait_settled(page, seq)
        assert vp(page, "data-epoch") == "2"
        commit(spin(page, "Hole spacing"), "58")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        until(page, STATE_JS, "failed")
        assert vp(page, "data-epoch") == "2"
        assert page.evaluate("k => sessionStorage.getItem(k)", f"tinework:epoch:part:{slug}") == "2"
        seq = seq_of(page)
        commit(spin(page, "Hole spacing"), "40")
        wait_settled(page, seq)
        assert vp(page, "data-epoch") == "3"
        page.reload()
        wait_settled(page, 0)
        assert vp(page, "data-epoch") == "4"
    with visit(browser, app_url, f"/rooms/{w.room()}", cookie=w.cookie("rev1")) as page:
        threads = page.get_by_role("listbox", name="Threads")
        eventually(page, lambda: threads.count() == 1, "room loaded")
        start = int(threads.get_attribute("data-epoch") or 0)
        post(app_url, f"/api/rooms/{w.room()}/comments", {"body": "Epoch", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2"))
        eventually(page, lambda: threads.get_by_role("option").count() == 1, "comment arrives")
        assert int(threads.get_attribute("data-epoch")) == start + 1


def test_derived_markers(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        width = spin(page, "Width")
        commit(width, "72.5")
        expect(page.get_by_text(f"was 60.0{NNBSP}mm", exact=True)).to_be_visible()
        slider = page.get_by_role("slider", name="Build tape")
        line = "The tape shows r1; save to record a tape for these values."
        expect(page.get_by_text(line)).to_be_visible()
        expect(slider).to_be_disabled()
        commit(width, "60")
        assert page.get_by_text(re.compile(r"^was ")).count() == 0
        assert page.get_by_text(line).count() == 0
        expect(slider).to_be_enabled()


def test_layout_and_focus(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61})], rooms=[room_spec()])
    slug = w.slug()
    routes = ["/", f"/parts/{slug}", f"/parts/{slug}/compare", f"/tapes/{w.rev('r2')}", f"/rooms/{w.room()}",
              "/dashboard", "/parts/new", "/signin", "/signup"]
    with visit(browser, app_url, "/", cookie=w.cookie()) as page:
        for width in OVERFLOW_WIDTHS:
            page.set_viewport_size({"width": width, "height": OVERFLOW_HEIGHT})
            for path in routes:
                page.goto(app_url + path)
                advance(page, 500)
                scroll, client = page.evaluate(OVERFLOW_JS)
                assert scroll == client, f"{path} overflows at {width}px ({scroll} > {client})"
        page.set_viewport_size({"width": WIDE[0], "height": WIDE[1]})
        page.goto(app_url + f"/parts/{slug}")
        wait_settled(page, 0)
        opener = page.get_by_role("button", name="Restore r1")
        click(opener)
        dialog = page.get_by_role("dialog", name="Restore r1 as a new revision?")
        expect(dialog.get_by_text("The current head stays in the history.")).to_be_visible()
        expect(dialog.get_by_role("button", name="Restore")).to_be_focused()
        assert set(tab_order(page, 5)) <= {"Restore", "Cancel"}
        page.keyboard.press("Shift+Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        eventually(page, lambda: dialog.count() == 0, "H7: Escape closes the restore dialog (L263, L458)")
        expect(opener).to_be_focused()
        click(opener)
        click(page.get_by_role("dialog", name="Restore r1 as a new revision?").get_by_role("button", name="Restore"))
        eventually(page, lambda: revisions(app_url, slug)[0]["label"] == "r3", "restore created r3")
        eventually(page, lambda: page.evaluate("() => document.activeElement && document.activeElement.tagName === 'MAIN'"), "focus moves to main")


def test_write_replay(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    _, tag = part_json(app_url, slug)
    key = idempotency_key()
    first = save(app_url, slug, {"width": 61, "depth": 40}, cookie, tag, "Replay", key)
    assert first.status_code == 201 and first.headers["Location"] == f"/api/parts/{slug}?revision={first.json()['id']}"
    assert save(app_url, slug, {"width": 62}, cookie, "*").status_code == 201
    replay = raw_post(app_url, f"/api/parts/{slug}/revisions", '{"message":"Replay","values":{"depth":40.0,"width":61}}', cookie,
                      **{"If-Match": tag, "Idempotency-Key": key})
    assert replay.status_code == 201 and replay.content == first.content
    assert replay.headers["Location"] == first.headers["Location"] and replay.headers["ETag"] == first.headers["ETag"]
    assert len(revisions(app_url, slug)) == 3
    reused = save(app_url, slug, {"width": 70}, cookie, tag, "Other", key)
    assert reused.status_code == 422
    assert reused.json() == {"error": "key_reused", "message": "This Idempotency-Key was already used for a different request."}
    bad = save(app_url, slug, {"width": 61}, cookie, "*", key="k" * 256)
    assert bad.status_code == 400
    assert bad.json() == {"error": "invalid_idempotency_key", "message": "Idempotency-Key must be 1 to 255 printable characters."}
    released = idempotency_key()
    assert save(app_url, slug, {"width": 999}, cookie, "*", key=released).status_code == 422
    assert save(app_url, slug, {"width": 63}, cookie, "*", key=released).status_code == 201
    slow = idempotency_key()
    set_delay(app_url, slug, 3000)
    try:
        with concurrent.futures.ThreadPoolExecutor(1) as pool:
            running = pool.submit(save, app_url, slug, {"width": 64}, cookie, "*", "Slow", slow)
            other = save(app_url, slug, {"width": 64}, cookie, "*", "Slow", slow)
            statuses = sorted([other.status_code, running.result(timeout=HTTP_TIMEOUT).status_code])
            assert statuses == [201, 409], f"a key still being processed answers 409 to the other request: {statuses}"
    finally:
        set_delay(app_url, slug, 0)
    copy = post(app_url, f"/api/parts/{slug}/copies", {"values": {}, "message": "c"}, cookie, idempotency_key())
    assert copy.headers["Location"] == f"/api/parts/{copy.json()['slug']}"


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from notices: {missing}"
    assert "Stack Sans" in notices


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, bad


def test_if_datastores() -> None:
    found = []
    for path in APP.rglob("*"):
        if "node_modules" in path.parts or ".git" in path.parts or not path.is_file():
            continue
        if path.suffix in (".sqlite", ".sqlite3", ".db"):
            found.append(str(path))
        elif path.stat().st_size >= 16 and path.open("rb").read(16) == b"SQLite format 3\x00":
            found.append(str(path))
    assert not found, found
    assert Postgres().tables()


def test_if_no_external_assets(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, "/") as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", f"/parts/{w.slug()}", "/signin"):
            page.goto(app_url + path)
            advance(page, 500)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_typescript_lockfile() -> None:
    assert (APP / "package-lock.json").is_file()
    sources = [p for p in APP.rglob("*.ts*") if "node_modules" not in p.parts and p.suffix in (".ts", ".tsx")]
    assert sources


def test_if_service_config_unchanged() -> None:
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.is_file():
        return
    pattern = re.compile(r"(^|/)(docker-)?compose[^/]*\.ya?ml$")
    edits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or "")
            if name in ("Write", "Edit", "MultiEdit", "write_file", "edit_file", "str_replace_editor", "create_file"):
                for value in json.dumps(node.get("input") or node.get("arguments") or {}).split('"'):
                    if pattern.search(value):
                        edits.append(value)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(json.loads(trajectory.read_text()))
    assert not edits, edits


_A_INSIDE_JS = "d => d.contains(document.activeElement)"
_A_GROUPS = ("Dimensions", "Pre-flight", "Revisions", "Review")
_A_CASE_SOURCE = ("# case\nparam depth = 20 mm min 10 max 40\nparam barZ = 4 mm min 1 max 9\nparam bara = 3 mm min 1 max 9\n"
                  "box 40 depth 5\nhole barZ at -10 0\nhole bara at 10 0\n")


def _a_epoch_key(slug: str) -> str:
    return f"tinework:epoch:part:{slug}"


def _a_stored_epoch(page: Page, slug: str) -> str | None:
    return page.evaluate("k => sessionStorage.getItem(k)", _a_epoch_key(slug))


def _a_tap_commit(page: Page, locator, value: str) -> None:
    page.touchscreen.tap(*center(locator))
    locator.fill(value)
    locator.press("Enter")


def test_keyboard_reconfigure_h5_epoch(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        assert vp(page, "data-epoch") == "1", "H5: the first solid drawn after load is paint 1 (L233-L235)"
        assert _a_stored_epoch(page, slug) == "1", "H5: the epoch persists under tinework:epoch:part:<slug> (L245)"
        width = spin(page, "Width")
        width.focus()
        for expected, key in ((2, "ArrowUp"), (3, "Shift+ArrowUp"), (4, "PageDown")):
            seq = seq_of(page)
            page.keyboard.press(key)
            wait_settled(page, seq)
            assert vp(page, "data-epoch") == str(expected), f"H5: {key} settles one painted result (L234-L235)"
            assert _a_stored_epoch(page, slug) == str(expected), f"H5: sessionStorage follows the epoch after {key} (L245)"
        seq = seq_of(page)
        click(page.get_by_role("button", name="Reset all"))
        wait_settled(page, seq)
        assert vp(page, "data-epoch") == "5", "H5: Reset all is one evaluation and one paint (L234, L400)"
        page.reload()
        wait_settled(page, 0)
        assert vp(page, "data-epoch") == "6", "H5: a reload continues from the stored value (L245)"
        assert _a_stored_epoch(page, slug) == "6", "H5: the reloaded paint is stored under the same key (L245)"


def test_keyboard_reconfigure_h7_overflow(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        spin(page, "Width").focus()
        seq = seq_of(page)
        page.keyboard.press("Shift+ArrowUp")
        wait_settled(page, seq)
        for px in OVERFLOW_WIDTHS:
            page.set_viewport_size({"width": px, "height": OVERFLOW_HEIGHT})
            page.reload()
            wait_settled(page, 0)
            expect(page.get_by_text(f"was 60.0{NNBSP}mm", exact=True)).to_be_visible()
            expect(page.get_by_text("1 modified", exact=True)).to_be_visible()
            scroll, client = page.evaluate(OVERFLOW_JS)
            assert scroll == client, f"H7: the part page scroll width equals its client width at {px}px ({scroll} vs {client}) (L262)"


def test_keyboard_reconfigure_h7_save_dialog_focus(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}", cookie=w.cookie(), size=WIDE) as page:
        wait_settled(page, 0)
        opener = page.get_by_role("button", name="Save revision")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Save revision")
        expect(dialog.get_by_role("textbox", name="Message")).to_be_focused()
        assert spin(page, "Width").count() == 0, "an open dialog leaves the rail inert and out of the accessibility tree (L457)"
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert dialog.evaluate(_A_INSIDE_JS), f"H7: {key} keeps focus cycling inside the dialog (L263)"
        page.keyboard.press("Escape")
        eventually(page, lambda: dialog.count() == 0, "H7: Escape closes the topmost surface (L263, L458)")
        expect(opener).to_be_focused()


def test_keyboard_reconfigure_h1_spinbutton_refusal(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(), source_spec("zero", ZERO_SOURCE)])
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        digest0 = vp(page, "data-digest")
        sent = eval_requests(page)
        width = spin(page, "Width")
        for typed in (" 30", "1e3", "0x10", "+5", "5,0", "٥", "1.2345", "05"):
            width.fill("")
            page.keyboard.type(typed)
            page.keyboard.press("Enter")
            advance(page, EVAL_DEBOUNCE_MS * 2)
            assert width.get_attribute("aria-invalid") == "true", f"H1: {typed!r} sets aria-invalid (L168)"
            assert width.input_value() == typed, f"H1: the field keeps the typed text {typed!r} (L168)"
            expect(page.get_by_text("Width takes a plain decimal such as 12.5.", exact=True)).to_be_visible()
            assert sent == [], f"H1: {typed!r} commits nothing (L168)"
            assert vp(page, "data-digest") == digest0, f"H1: the last good solid stays drawn after {typed!r} (L168)"
    zero = w.slug("zero")
    with visit(browser, app_url, f"/parts/{zero}?config=") as page:
        wait_settled(page, 0)
        default = vp(page, "data-digest")
        offset = spin(page, "Offset")
        seq = seq_of(page)
        commit(offset, "5")
        wait_settled(page, seq)
        assert vp(page, "data-digest") != default, "a moved hole changes the digest"
        seq = seq_of(page)
        offset.fill("")
        page.keyboard.type("-0")
        page.keyboard.press("Enter")
        assert offset.get_attribute("aria-invalid") != "true", "H1: -0 is accepted as the value 0 (L162)"
        assert offset.get_attribute("aria-valuenow") == "0", "H1/H2: -0 is the value 0, a plain machine number (L162, L191)"
        wait_settled(page, seq)
        assert vp(page, "data-digest") == default, "H1: -0 gives the default digest when 0 is the default (L162)"
        assert config_of(page.url) == "", "-0 is the default, so the address holds an empty config (L877-L879)"


def test_burst_cancellation_h5_epoch_per_paint(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        epoch = int(vp(page, "data-epoch") or "0")
        viewer = vp(page, "data-viewer-id")
        sent = eval_requests(page)
        width = spin(page, "Width")
        width.focus()
        seq = seq_of(page)
        for _ in range(5):
            page.keyboard.press("ArrowUp")
        wait_settled(page, seq)
        assert len(sent) == 1, f"one evaluation per burst (L906); got {len(sent)}"
        assert vp(page, "data-epoch") == str(epoch + 1), "H5: a five-commit burst is one painted result (L234)"
        seq = seq_of(page)
        set_delay(app_url, slug, 6000)
        try:
            page.keyboard.press("ArrowUp")
            advance(page, EVAL_DEBOUNCE_MS + 1)
            until(page, STATE_JS, "evaluating")
            assert vp(page, "data-epoch") == str(epoch + 1), "H5: a request starting never advances data-epoch (L234)"
            page.keyboard.press("ArrowUp")
            assert vp(page, "data-epoch") == str(epoch + 1), "H5: the superseded result is never a paint (L242)"
            set_delay(app_url, slug, 0)
            wait_settled(page, seq + 1)
        finally:
            set_delay(app_url, slug, 0)
        assert len(sent) == 3, f"three evaluation requests were sent; got {len(sent)}"
        assert vp(page, "data-epoch") == str(epoch + 2), "H5: three requests, two painted results (L234, L242)"
        assert _a_stored_epoch(page, slug) == str(epoch + 2), "H5: sessionStorage holds the painted count (L245)"
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 60.7}), "the newest burst value is drawn"
    poll(lambda: counts(app_url, viewer)["cancelled"] == 1, "the superseded evaluation record reads cancelled (L907)")


def test_burst_cancellation_h1_seq_grammar(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    refused = {"error": "value_grammar", "field": "seq", "message": "Seq takes a plain decimal such as 12.5."}
    for raw in ("1e1", "1E1", "01", "-01", "2.0001", '"2"'):
        content = '{"partSlug":"%s","values":{},"seq":%s,"viewerId":"%s"}' % (slug, raw, uuid.uuid4())
        response = raw_post(app_url, "/api/evaluations", content)
        assert response.status_code == 422, f"H1: seq {raw} answers 422 (L170); got {response.status_code}"
        assert response.json() == refused, f"H1: seq {raw} gets the value_grammar body for seq (L170-L173)"
    first = '{"seq":01,"partSlug":"%s","values":{"width":1e2},"viewerId":"%s"}' % (slug, uuid.uuid4())
    response = raw_post(app_url, "/api/evaluations", first)
    assert response.status_code == 422 and response.json() == refused, "H1: the first offending number in request-text order decides (L170)"
    viewer = str(uuid.uuid4())
    good = raw_post(app_url, "/api/evaluations", '{"partSlug":"%s","values":{},"seq":2,"viewerId":"%s"}' % (slug, viewer))
    assert good.status_code == 200, f"a plain decimal seq is evaluated (L726); got {good.status_code}"
    assert good.json()["seq"] == 2 and good.json()["status"] == "succeeded", "the evaluation record carries seq 2 (L687)"
    stored = call("GET", app_url, f"/api/evaluations/{good.json()['id']}")
    assert stored.status_code == 200 and stored.json()["seq"] == 2, "the stored record reads back seq 2 (L728)"


def test_burst_cancellation_h4_storage_down_evaluations(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    answer = evaluate(down, slug, {}, str(uuid.uuid4()), 1)
    assert answer.status_code == 200, f"H4: evaluations are database-only and stay 200 (L222-L224); got {answer.status_code}"
    assert answer.json()["status"] == "succeeded", "H4: the evaluation runs from PostgreSQL alone (L920)"
    assert answer.json()["geometryDigest"] == sha(TWIN_SOLID), "the storage-down copy computes the same digest"
    stored = call("GET", down, f"/api/evaluations/{answer.json()['id']}")
    assert stored.status_code == 200, f"H4: reading an evaluation stays 200 (L224); got {stored.status_code}"
    leaver = str(uuid.uuid4())
    set_delay(app_url, slug, 30000)
    try:
        try:
            httpx.post(down + "/api/evaluations", json={"partSlug": slug, "values": {}, "seq": 1, "viewerId": leaver},
                       timeout=httpx.Timeout(ABORT_AFTER_S))
        except httpx.HTTPError:
            pass
        poll(lambda: counts(app_url, leaver) == {"started": 1, "completed": 0, "cancelled": 1},
             "a closed evaluation request on the storage-down copy ends cancelled at once (L919)", CANCEL_DEADLINE_S)
        cancel = post(down, "/api/evaluations/cancel", {"viewerId": leaver})
        assert cancel.status_code == 204, f"H4: cancel needs no storage and answers 204 (L727); got {cancel.status_code}"
    finally:
        set_delay(app_url, slug, 0)
    with visit(browser, down, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "H4: the part page shows the Storage status (L226)")
        statuses: list[int] = []
        page.on("response", lambda r: statuses.append(r.status) if urlparse(r.url).path == "/api/evaluations" else None)
        spin(page, "Width").focus()
        seq = seq_of(page)
        for _ in range(3):
            page.keyboard.press("ArrowUp")
        wait_settled(page, seq)
        eventually(page, lambda: statuses == [200], "H4: the burst's one evaluation answers 200 with storage down (L224, L647)")
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 60.3}), "the live evaluation is drawn (L647)"


def test_absurd_value_h1_address_corpus(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(), source_spec("zero", ZERO_SOURCE)])
    slug = w.slug()
    link = "depth=%2030,holeDia=1e1,holeSpacing=%D9%A5,thickness=6.0000,width=72.5"
    with visit(browser, app_url, f"/parts/{slug}?config={link}") as page:
        wait_settled(page, 0)
        eventually(page, lambda: config_of(page.url) == "width=72.5", "H1: refused values leave the rewritten address (L169, L884)")
        names = option_names(page.get_by_role("listbox", name="Findings"))
        dropped = [n for n in names if "Dropped from the link" in n]
        assert dropped == [dropped_row(["depth", "holeDia", "holeSpacing", "thickness"])], \
            f"H1: one dropped-link option names the refused values in link order (L169, L610); got {names}"
        for label, default in (("Depth", 40), ("Hole dia", 5), ("Hole spacing", 40), ("Thickness", 8)):
            assert float(spin(page, label).get_attribute("aria-valuenow")) == default, f"H1: a dropped {label} keeps its default (L881)"
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 72.5}), "the remaining value applies (L884)"
    zero = w.slug("zero")
    default = eval_digest(app_url, zero, {})
    for raw in ("-0", "-0.0", "-0.000"):
        with visit(browser, app_url, f"/parts/{zero}?config=offset={raw}") as page:
            wait_settled(page, 0)
            assert vp(page, "data-digest") == default, f"H1: offset={raw} gives the default digest (L162)"
            assert spin(page, "Offset").get_attribute("aria-valuenow") == "0", f"H1: offset={raw} is the value 0 (L162)"
            names = option_names(page.get_by_role("listbox", name="Findings"))
            assert not [n for n in names if "Dropped from the link" in n], f"H1: offset={raw} is accepted, not dropped (L162)"


def test_absurd_value_h1_api_corpus(app_url: str) -> None:
    w = world(app_url, parts=[part_spec(), source_spec("zero", ZERO_SOURCE)])
    slug, cookie = w.slug(), w.cookie()
    _, tag = part_json(app_url, slug)
    refused = {"error": "value_grammar", "field": "width", "message": "Width takes a plain decimal such as 12.5."}
    corpus = ["1e3", "1E3", "05", "-05", "1.2345", '"30"', '" 30"', '"0x10"', '"+5"', '"5,0"', '"٥"']
    for raw in corpus:
        content = '{"partSlug":"%s","values":{"width":%s},"seq":1,"viewerId":"%s"}' % (slug, raw, uuid.uuid4())
        evaluated = raw_post(app_url, "/api/evaluations", content)
        assert evaluated.status_code == 422 and evaluated.json() == refused, f"H1: evaluation width {raw} gets value_grammar (L170)"
        saved = raw_post(app_url, f"/api/parts/{slug}/revisions", '{"message":"Absurd","values":{"width":%s}}' % raw, cookie,
                         **{"If-Match": tag})
        assert saved.status_code == 422 and saved.json() == refused, f"H1: save width {raw} gets value_grammar (L170, L676)"
    assert len(revisions(app_url, slug)) == 1, "a refused save creates no revision (L978)"
    assert part_json(app_url, slug)[1] == tag, "a refused save leaves the history ETag unchanged (L992)"
    zero = w.slug("zero")
    r1 = revisions(app_url, zero)[0]
    _, zero_tag = part_json(app_url, zero)
    for raw in ("-0", "-0.0", "-0.000"):
        content = '{"partSlug":"%s","values":{"offset":%s},"seq":1,"viewerId":"%s"}' % (zero, raw, uuid.uuid4())
        body = raw_post(app_url, "/api/evaluations", content).json()
        assert body["status"] == "succeeded" and body["geometryDigest"] == r1["geometryDigest"], f"H1: offset {raw} gives the default digest (L162)"
    saved = raw_post(app_url, f"/api/parts/{zero}/revisions", '{"message":"Zero","values":{"offset":-0.000}}', w.cookie(),
                     **{"If-Match": zero_tag})
    assert saved.status_code == 201, f"H1: a -0.000 value is accepted by a save (L162); got {saved.status_code}"
    assert saved.json()["geometryDigest"] == r1["geometryDigest"], "H1: the saved -0.000 revision has the default digest (L162)"


def test_absurd_value_h5_refused_never_paints(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}") as page:
        wait_settled(page, 0)
        epoch = vp(page, "data-epoch")
        spacing, width = spin(page, "Hole spacing"), spin(page, "Width")
        commit(spacing, "58")
        advance(page, EVAL_DEBOUNCE_MS + 1)
        until(page, STATE_JS, "failed")
        assert vp(page, "data-epoch") == epoch, "H5: a failed result never advances data-epoch (L242)"
        commit(width, "1e3")
        advance(page, EVAL_DEBOUNCE_MS * 2)
        assert width.get_attribute("aria-invalid") == "true", "H1: the exponent is refused in its field (L168)"
        assert vp(page, "data-epoch") == epoch, "H5: a refused value never advances data-epoch (L242)"
        assert _a_stored_epoch(page, slug) == epoch, "H5: sessionStorage keeps the unadvanced epoch (L245)"
        seq = seq_of(page)
        commit(spacing, "40")
        wait_settled(page, seq)
        assert vp(page, "data-digest") == sha(TWIN_SOLID), "the corrected value draws the default solid"
        assert vp(page, "data-epoch") == str(int(epoch or "0") + 1), "H5: the corrected settled evaluation is one paint (L235)"


def test_absurd_value_h2_diagnostic_numbers(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec(), part_spec("comb", from_="cable-comb")])
    comb = w.slug("comb")
    limit = f"Tine allows at most 10{THIN}000{NNBSP}mm."
    cases = (("12345.125", f"12{THIN}345.12"), ("12345.375", f"12{THIN}345.38"),
             ("12345.5", f"12{THIN}345.5"), ("20000.000", f"20{THIN}000"))
    for raw, shown in cases:
        content = '{"partSlug":"%s","values":{"length":%s},"seq":1,"viewerId":"%s"}' % (comb, raw, uuid.uuid4())
        body = raw_post(app_url, "/api/evaluations", content).json()
        assert body["status"] == "failed", f"length {raw} is over 10 000 mm (L850)"
        first = body["diagnostics"][0]
        assert (first["code"], first["message"], first["parameter"]) == ("E_TOO_LARGE", f"Length is {shown}{NNBSP}mm; {limit}", "length"), \
            f"H2: length {raw} prints as {shown} in the diagnostic (L178, L188, L850)"
    message = f"Hole 1 (Ø 5.12{NNBSP}mm) does not fit inside the 70.12 × 40.5{NNBSP}mm body."
    with visit(browser, app_url, f"/parts/{w.slug()}") as page:
        wait_settled(page, 0)
        for label, value in (("Width", "70.125"), ("Depth", "40.5"), ("Hole dia", "5.125"), ("Hole spacing", "66")):
            commit(spin(page, label), value)
        advance(page, EVAL_DEBOUNCE_MS + 1)
        until(page, STATE_JS, "failed")
        eventually(page, lambda: status(page, "Evaluation").inner_text().strip() == f"Could not evaluate: {message}",
                   "H2: the Evaluation region prints the cut-outside numbers at most 2 decimals, half to even (L188, L607)")
        assert f"Blocking: {message}" in option_names(page.get_by_role("listbox", name="Findings")), \
            "H2: the Findings diagnostic option prints the same rounded numbers (L188, L607)"


def test_shared_configuration_h3_address_order(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[source_spec("case", _A_CASE_SOURCE)])
    slug = w.slug("case")
    with visit(browser, app_url, f"/parts/{slug}?config=bara=4,barZ=5") as page:
        wait_settled(page, 0)
        seq = seq_of(page)
        commit(spin(page, "Depth"), "25")
        wait_settled(page, seq)
        eventually(page, lambda: config_of(page.url) == "barZ=5,bara=4,depth=25",
                   "H3: configuration pairs follow parameter-name code-point order, uppercase before lowercase (L195, L206, L877)")
        shared, digest = page.url, vp(page, "data-digest")
    assert digest == eval_digest(app_url, slug, {"barZ": 5, "bara": 4, "depth": 25}), "the drawn digest is the configuration's"
    with open_app(browser, shared) as other:
        wait_settled(other, 0)
        assert vp(other, "data-digest") == digest, "the second person sees the same digest (L45, L91)"


def test_shared_configuration_h8_copy_replay(app_url: str) -> None:
    w = world(app_url, people=("owner", "visitor"), parts=[part_spec()])
    slug, visitor = w.slug(), w.cookie("visitor")
    key = idempotency_key()
    first = post(app_url, f"/api/parts/{slug}/copies", {"values": {"width": 72.5, "depth": 30}, "message": "Mine"}, visitor, key)
    assert first.status_code == 201, f"a copy answers 201 (L719); got {first.status_code}"
    copy = first.json()["slug"]
    assert first.headers["Location"] == f"/api/parts/{copy}", "H8: a copy's 201 carries Location /api/parts/<new slug> (L268)"
    for content in ('{"values":{"width":72.5,"depth":30},"message":"Mine"}',
                    '{"message":"Mine","values":{"depth":30.0,"width":72.50}}'):
        replay = raw_post(app_url, f"/api/parts/{slug}/copies", content, visitor, **{"Idempotency-Key": key})
        assert replay.status_code == 201, f"H8: the replay keeps status 201 (L270); got {replay.status_code}"
        assert replay.content == first.content, "H8: the replay returns identical body bytes (L270)"
        assert replay.headers.get("Location") == first.headers.get("Location"), "H8: the replay returns the same Location (L270)"
        assert replay.headers.get("ETag") == first.headers.get("ETag"), "H8: the replay returns the same ETag (L270)"
    mine = [p["slug"] for p in call("GET", app_url, "/api/dashboard", visitor).json()["parts"]]
    assert mine == [copy], f"H8: a replay creates nothing, so the visitor owns one copy (L270); got {mine}"
    reused = post(app_url, f"/api/parts/{slug}/copies", {"values": {"width": 61}, "message": "Mine"}, visitor, key)
    assert reused.status_code == 422, f"H8: the same key with a different body answers 422 (L272); got {reused.status_code}"
    assert reused.json() == {"error": "key_reused", "message": "This Idempotency-Key was already used for a different request."}, \
        "H8: key_reused exact body (L272)"
    mine = [p["slug"] for p in call("GET", app_url, "/api/dashboard", visitor).json()["parts"]]
    assert mine == [copy], f"H8: a key_reused answer creates no part (L269); got {mine}"
    assert len(revisions(app_url, slug)) == 1, "copying never adds a revision to the original part (L985)"


def test_shared_configuration_h1_hostile_link(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    link = "depth=030,holeDia=%2B5,thickness=8.0001,holeSpacing=0x10,width=72.5"
    with visit(browser, app_url, f"/parts/{slug}?config={link}&operation=05") as page:
        wait_settled(page, 0)
        eventually(page, lambda: config_of(page.url) == "width=72.5" and "operation" not in query_of(page.url),
                   "H1: refused values and the refused operation leave the address (L169, L1031)")
        names = option_names(page.get_by_role("listbox", name="Findings"))
        dropped = [n for n in names if "Dropped from the link" in n]
        assert dropped == [dropped_row(["depth", "holeDia", "thickness", "holeSpacing"])], \
            f"H1: the dropped-link option lists configuration names only, in link order (L169, L610); got {names}"
        slider = page.get_by_role("slider", name="Build tape")
        assert slider.get_attribute("aria-valuenow") == slider.get_attribute("aria-valuemax"), \
            "H1: an unusable operation starts the tape as if there were none (L1029-L1030)"
        assert float(spin(page, "Width").get_attribute("aria-valuenow")) == 72.5, "the usable value applies (L884)"
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 72.5}), "the rest of the link applies (L92, L884)"


def test_shared_configuration_h7_sign_up_dialog_focus(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}?config=width=72.5", size=WIDE) as page:
        wait_settled(page, 0)
        opener = page.get_by_role("button", name="Save revision")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Sign up to save")
        expect(dialog.get_by_role("textbox", name="Email")).to_be_focused()
        for key in ["Tab"] * 7 + ["Shift+Tab"] * 7:
            page.keyboard.press(key)
            assert dialog.evaluate(_A_INSIDE_JS), f"H7: {key} keeps focus cycling inside Sign up to save (L263)"
        page.keyboard.press("Escape")
        eventually(page, lambda: dialog.count() == 0, "H7: Escape closes the Sign up to save dialog (L263, L458)")
        expect(opener).to_be_focused()
        assert config_of(page.url) == "width=72.5", "closing the dialog keeps the shared configuration (L487)"


def test_phone_rail_h7_open_groups_no_overflow(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}", size=(OVERFLOW_WIDTHS[0], OVERFLOW_HEIGHT)) as page:
        wait_settled(page, 0)
        for px in OVERFLOW_WIDTHS[:3]:
            page.set_viewport_size({"width": px, "height": OVERFLOW_HEIGHT})
            advance(page, 300)
            for name in (*_A_GROUPS[1:], _A_GROUPS[0]):
                button = page.get_by_role("button", name=name, exact=True)
                click(button)
                advance(page, 300)
                expect(button).to_have_attribute("aria-expanded", "true")
                open_groups = [g for g in _A_GROUPS if page.get_by_role("button", name=g, exact=True).get_attribute("aria-expanded") == "true"]
                assert open_groups == [name], f"exactly one rail group is open below 1024 px (L301, L422) at {px}px"
                scroll, client = page.evaluate(OVERFLOW_JS)
                assert scroll == client, f"H7: no horizontal overflow at {px}px with {name} open ({scroll} vs {client}) (L262)"


def test_phone_rail_h1_typed_refusal(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug = w.slug()
    with visit(browser, app_url, f"/parts/{slug}", size=PHONE) as page:
        wait_settled(page, 0)
        digest0 = vp(page, "data-digest")
        sent = eval_requests(page)
        width = spin(page, "Width")
        for typed in ("1e3", "05", "+5", "٥", "0x10", "1.2345"):
            _a_tap_commit(page, width, typed)
            advance(page, EVAL_DEBOUNCE_MS * 2)
            assert width.get_attribute("aria-invalid") == "true", f"H1: {typed!r} sets aria-invalid in the phone rail (L168)"
            assert width.input_value() == typed, f"H1: the phone field keeps the typed text {typed!r} (L168)"
            expect(page.get_by_text("Width takes a plain decimal such as 12.5.", exact=True)).to_be_visible()
            assert sent == [], f"H1: {typed!r} commits nothing (L168)"
            assert vp(page, "data-digest") == digest0, f"H1: the last good solid stays drawn after {typed!r} (L168)"
        seq = seq_of(page)
        _a_tap_commit(page, width, "72.5")
        wait_settled(page, seq)
        assert width.get_attribute("aria-invalid") != "true", "a valid value clears aria-invalid"
        assert len(sent) == 1 and sent[0]["values"]["width"] == 72.5, f"the valid value commits once; got {sent}"
        assert vp(page, "data-digest") == eval_digest(app_url, slug, {"width": 72.5}), "the valid value is drawn"


def test_phone_rail_h6_scrub_then_type_default(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    with visit(browser, app_url, f"/parts/{w.slug()}", size=PHONE) as page:
        wait_settled(page, 0)
        frames = page.locator('[data-ui="frame"]')
        at_rest = frames.count()
        width = spin(page, "Width")
        seq = seq_of(page)
        handle = page.get_by_role("button", name="Scrub Width")
        handle.scroll_into_view_if_needed()
        x, y = center(handle)
        touch(page, "touchStart", x, y)
        for i in range(1, 11):
            touch(page, "touchMove", x + SCRUB_PX * i, y)
        touch(page, "touchEnd")
        assert float(width.get_attribute("aria-valuenow")) == 61, "ten 4 px touch steps add ten 0.1 mm steps (L403)"
        wait_settled(page, seq)
        expect(page.get_by_text(f"was 60.0{NNBSP}mm", exact=True)).to_be_visible()
        expect(page.get_by_text("1 modified", exact=True)).to_be_visible()
        assert frames.count() == at_rest + 1, "the scrubbed control gains its amber frame (L546)"
        _a_tap_commit(page, width, "60")
        assert page.get_by_text(re.compile(r"^was ")).count() == 0, "H6: typing the default clears the was marker in the same paint (L249, L258)"
        assert page.get_by_text(re.compile(r"^[1-9]\d* modified$")).count() == 0, \
            "H6: typing the default clears <n> modified in the same paint (L249, L253)"
        assert frames.count() == at_rest, "H6: the amber frame goes with the marker (L253)"


_B_VOXEL_SOURCE = ("# voxel\nparam bossX = 10.25 mm min -20 max 20\nparam bossH = 0.5 mm min 0 max 5\n"
                   "param pinH = 0 mm min 0 max 5\nbox 60 40 8\nboss 0.6 2.5 at 0.25 0.25\n"
                   "boss 0.6 bossH at bossX 0.25\nboss 0.6 pinH at 5.25 5.25\nboss 0.6 pinH at -5.25 5.25\n")
_B_CELL = 0.125
_B_EPOCH_REPORT = "tinework:epoch:report:"
_B_MARKS_JS = """(el, banner) => { window.__b_marks = [];
  new MutationObserver(() => window.__b_marks.push([el.getAttribute('data-state'), el.innerText.includes(banner)]))
    .observe(el, { attributes: true, childList: true, subtree: true, characterData: true }); }"""


def _b_grouped(figure: str) -> str:
    whole, _, frac = figure.partition(".")
    groups = []
    while len(whole) > 3:
        groups.insert(0, whole[-3:])
        whole = whole[:-3]
    return THIN.join([whole, *groups]) + (f".{frac}" if frac else "")


def _b_volume(cells: int) -> str:
    return f"{_b_grouped(half_even(cells * _B_CELL, 2))}{NNBSP}mm³"


def _b_id_key(value: Any) -> tuple[int, Any]:
    return (0, value) if isinstance(value, int) else (1, str(value))


def test_preflight_keyboard_h3_findings_order(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[source_spec("order", ORDER_SOURCE)])
    expected = [
        f"Hole 2 is 12.5× deeper than its diameter; {MILL} allows at most 6×.",
        f"Hole 1 is 10× deeper than its diameter; {MILL} allows at most 6×.",
        f"Part is 320 × 20 × 50{NNBSP}mm; the {MILL} envelope is 300 × 200 × 100{NNBSP}mm.",
    ]
    body = post(app_url, "/api/preflight", {"partSlug": w.slug("order"), "values": {}, "process": "mill-3"}, w.cookie())
    assert body.status_code == 201, f"POST /api/preflight answered {body.status_code}"
    findings = body.json()["findings"]
    assert [f["severity"] for f in findings] == ["Blocking"] * 3, "H3: three Blocking findings"
    assert [f["message"] for f in findings] == expected, "H3 Findings: within a severity, shortfall descending (L209)"
    assert [f["cutLabel"] for f in findings] == ["Hole 2", "Hole 1", None], "H3: the larger shortfall leads even before cut order"
    with visit(browser, app_url, f"/parts/{w.slug('order')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, MILL)
        listbox = page.get_by_role("listbox", name="Findings")
        want = [f"Blocking: {m}" for m in expected]
        eventually(page, lambda: option_names(listbox) == want, "Findings listbox lists the report in H3 order")
        assert option_names(listbox) == want, "H3: listbox options follow the Findings chain"


def test_preflight_keyboard_h4_database_only(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    answer = post(down, "/api/preflight", {"partSlug": w.slug("jig"), "values": {}, "process": "mill-3"}, w.cookie())
    assert answer.status_code == 201, f"H4: pre-flight is database-only and answers 201, got {answer.status_code}"
    assert [(f["severity"], f["message"]) for f in answer.json()["findings"]] == JIG_MILL_FINDINGS, \
        "H4: the storage-down report carries the published findings"
    with visit(browser, down, f"/parts/{w.slug('jig')}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "H4: status Storage shows the storage banner")
        assert status(page, "Storage").inner_text().strip() == STORAGE_BANNER, "H4: the Storage status reads the banner copy"
        report = run_preflight(page, MILL)
        assert [(f["severity"], f["message"]) for f in report["findings"]] == JIG_MILL_FINDINGS, "H4: the page's run answers 201"
        region = page.get_by_role("region", name="Pre-flight report")
        expect(region).to_have_attribute("data-state", "complete")
        listbox = page.get_by_role("listbox", name="Findings")
        want = [f"{s}: {m}" for s, m in JIG_MILL_FINDINGS]
        eventually(page, lambda: option_names(listbox) == want, "H4: findings listed while storage is down")


def test_preflight_keyboard_h2_finding_numbers(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block"), part_spec("plate")])
    jig = post(app_url, "/api/preflight", {"partSlug": w.slug("jig"), "values": {"pinEdge": 1.234, "pinDia": 6},
                                           "process": "mill-3"}, w.cookie())
    assert jig.status_code == 201, f"POST /api/preflight answered {jig.status_code}"
    ratio, wall = half_even(40 / 6, 2), "1.23"
    assert [(f["severity"], f["message"]) for f in jig.json()["findings"]] == [
        ("Blocking", f"Hole 1 is {ratio}× deeper than its diameter; {MILL} allows at most 6×."),
        ("Blocking", f"Hole 2 is {ratio}× deeper than its diameter; {MILL} allows at most 6×."),
        ("Advisory", f"Wall beside Hole 1 is {wall}{NNBSP}mm; {MILL} needs at least 1.5{NNBSP}mm."),
        ("Advisory", f"Wall beside Hole 2 is {wall}{NNBSP}mm; {MILL} needs at least 1.5{NNBSP}mm."),
    ], "H2: message numbers at most 2 decimals, trailing zeros dropped (6.67, 1.23, 6, 1.5)"
    values = {"width": 60.5, "depth": 40.25, "thickness": 8.125}
    envelope = f"Part is 60.5 × 40.25 × {half_even(8.125, 2)}{NNBSP}mm; the {LASER} envelope is 600 × 400 × 6{NNBSP}mm."
    plate = post(app_url, "/api/preflight", {"partSlug": w.slug("plate"), "values": values, "process": "laser-sheet"}, w.cookie())
    assert plate.status_code == 201, f"POST /api/preflight answered {plate.status_code}"
    assert [(f["severity"], f["message"]) for f in plate.json()["findings"]] == [("Blocking", envelope)], \
        "H2: the bounding box is a × b × c mm, half to even, trailing zeros dropped, U+202F only before the last unit"
    with visit(browser, app_url, f"/parts/{w.slug('plate')}?config=depth=40.25,thickness=8.125,width=60.5", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        run_preflight(page, LASER)
        listbox = page.get_by_role("listbox", name="Findings")
        eventually(page, lambda: option_names(listbox) == [f"Blocking: {envelope}"], "H2: the listbox shows the same envelope text")
        assert option_names(listbox) == [f"Blocking: {envelope}"], "H2: the page renders the finding number by H2"


def test_stale_report_h5_report_epoch(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    slug = w.slug("jig")
    with visit(browser, app_url, f"/parts/{slug}", cookie=w.cookie()) as page:
        wait_settled(page, 0)
        report = page.get_by_role("region", name="Pre-flight report")
        assert report.get_attribute("data-epoch") == "0", "H5: data-epoch is 0 before any report is painted"
        run_preflight(page, MILL)
        eventually(page, lambda: report.get_attribute("data-state") == "complete", "the first report is painted")
        assert report.get_attribute("data-epoch") == "1", "H5: a painted 201 report advances data-epoch by 1"
        length = spin(page, "Length")
        with held(page, "**/api/preflight") as gate:
            click(page.get_by_role("button", name=re.compile(r"^Run pre-flight")))
            expect(report).to_have_attribute("data-state", "running")
            assert report.get_attribute("data-epoch") == "1", "H5: a request starting never advances data-epoch"
            length.focus()
            page.keyboard.press("ArrowUp")
            gate.release()
        eventually(page, lambda: report.get_attribute("data-state") == "stale", "a report that arrives after a change is stale")
        assert report.get_attribute("data-epoch") == "2", "H5: a 201 report that arrives already stale still counts as one paint"
        key = _B_EPOCH_REPORT + slug
        assert page.evaluate("k => sessionStorage.getItem(k) !== null", key), "H5: the epoch is kept in sessionStorage tinework:epoch:report:<slug>"
        page.reload()
        wait_settled(page, 0)
        report = page.get_by_role("region", name="Pre-flight report")
        eventually(page, lambda: report.get_attribute("data-epoch") == "2", "H5: a reload continues from the stored epoch")
        assert report.get_attribute("data-epoch") == "2", "H5: the reloaded report region carries the stored epoch"
        run_preflight(page, MILL)
        eventually(page, lambda: report.get_attribute("data-state") == "complete", "the next report is painted")
        assert report.get_attribute("data-epoch") == "3", "H5: the next paint after reload advances from the stored value"


def test_stale_report_h6_return_clears(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    with visit(browser, app_url, f"/parts/{w.slug('jig')}", cookie=w.cookie(), reduced_motion="reduce") as page:
        wait_settled(page, 0)
        run_preflight(page, MILL)
        report = page.get_by_role("region", name="Pre-flight report")
        expect(report).to_have_attribute("data-state", "complete")
        report.evaluate(_B_MARKS_JS, STALE_BANNER)
        length = spin(page, "Length")
        listbox = page.get_by_role("listbox", name="Findings")
        want = [f"{s}: {m}" for s, m in JIG_MILL_FINDINGS]

        def leave_and_return(leave: Callable[[], None], back: Callable[[], None], how: str) -> None:
            leave()
            expect(report).to_have_attribute("data-state", "stale")
            assert STALE_BANNER in report.inner_text(), f"H6: the stale banner shows after {how} leaves the baseline"
            back()
            expect(report).to_have_attribute("data-state", "complete")
            assert STALE_BANNER not in report.inner_text(), f"H6: {how} back to the report's values clears the banner"
            assert option_names(listbox)[:4] == want, f"H6: findings stay listed after {how}"

        def arrow(key: str) -> Callable[[], None]:
            def press() -> None:
                length.focus()
                page.keyboard.press(key)
            return press

        leave_and_return(arrow("ArrowUp"), arrow("ArrowDown"), "an arrow key")
        leave_and_return(lambda: commit(length, "81"), lambda: commit(length, "80"), "typing the default")
        leave_and_return(arrow("ArrowUp"), lambda: click(page.get_by_role("button", name="Reset all")), "Reset all")
        leave_and_return(lambda: click(page.get_by_role("radio", name=LASER)), lambda: click(page.get_by_role("radio", name=MILL)),
                         "the process")
        marks = page.evaluate("() => window.__b_marks")
        mixed = [m for m in marks if m[0] == "complete" and m[1]]
        assert marks and not mixed, f"H6: no paint shows state complete with the stale banner still up: {mixed[:3]}"


def test_stale_report_h1_value_grammar(app_url: str) -> None:
    limit = call("GET", app_url, "/api/config").json()["preflightSignedOutLimit"]
    w = world(app_url, parts=[part_spec("jig", from_="jig-fence-block")])
    slug = w.slug("jig")
    cases = [
        ('{"partSlug":"%s","values":{"nope":1,"height":500,"length":1e2,"width":1.2345},"process":"mill-3"}', "length", "Length"),
        ('{"partSlug":"%s","process":"mill-3","values":{"width":"30","length":80}}', "width", "Width"),
        ('{"partSlug":"%s","values":{"pinDia":5.0000},"process":"mill-3"}', "pinDia", "Pin dia"),
    ]
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT) as client:
        assert client.get(f"/api/parts/{slug}").json()["preflightLeft"] == limit, "a fresh signed-out session has the full allowance"
        for text_, field, label in cases:
            refused = client.post("/api/preflight", content=text_ % slug, headers={"Content-Type": "application/json"})
            assert refused.status_code == 422, f"H1: {text_ % slug} answers 422, got {refused.status_code}"
            assert refused.json() == {"error": "value_grammar", "field": field,
                                      "message": f"{label} takes a plain decimal such as 12.5."}, \
                f"H1: value_grammar names the first offending number {field} with no errors key (L170)"
        assert client.get(f"/api/parts/{slug}").json()["preflightLeft"] == limit, "a refused run gives its claim back (L971)"
        if limit:
            ok = client.post("/api/preflight", json={"partSlug": slug, "values": {"length": 80.0}, "process": "mill-3"})
            assert ok.status_code == 201, "a grammatical run is stored"
            assert client.get(f"/api/parts/{slug}").json()["preflightLeft"] == limit - 1, "only the 201 answer counts"


def test_compare_h2_half_even_volumes(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[source_spec("part", _B_VOXEL_SOURCE)], revisions=[rev_spec("r2", {"bossX": -10.25, "bossH": 2.5})])
    revs = list(reversed(revisions(app_url, w.slug())))
    r1, r2 = revs[0]["id"], revs[1]["id"]
    added, removed, unchanged = 5, 1, 120 * 80 * 16 + 5
    body = call("GET", app_url, f"/api/compare?base={r1}&head={r2}").json()
    assert (body["added"], body["removed"], body["unchanged"]) == (
        pytest.approx(added * _B_CELL), pytest.approx(removed * _B_CELL), pytest.approx(unchanged * _B_CELL)), \
        "voxel rule: cells × 0.125 mm³ (L1036)"
    lines = [f"Added {_b_volume(added)}", f"Removed {_b_volume(removed)}", f"Unchanged {_b_volume(unchanged)}"]
    assert lines == [f"Added 0.62{NNBSP}mm³", f"Removed 0.12{NNBSP}mm³", f"Unchanged 19{THIN}200.62{NNBSP}mm³"]
    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay") as page:
        region = page.get_by_role("region", name="Volume change")
        eventually(page, shows(region, lines[0]), "the volume change is painted")
        shown = region.evaluate("e => e.textContent")
        for line in lines:
            assert line in shown, f"H2: Volume change reads {line!r} (half to even, 2 decimals, U+2009, U+202F)"
        buttons = page.get_by_role("list", name="Hunks").get_by_role("button")
        eventually(page, lambda: buttons.count() == 2, "two hunks listed")
        assert [buttons.nth(i).evaluate("e => e.textContent").strip() for i in range(2)] == [
            f"Hunk 1 of 2 · Added · {_b_volume(added)}", f"Hunk 2 of 2 · Removed · {_b_volume(removed)}"], \
            "H2: hunk volumes render half to even with U+202F before mm³"


def test_compare_h3_hunk_order(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[source_spec("part", _B_VOXEL_SOURCE)], revisions=[rev_spec("r2", {"bossX": -10.25, "pinH": 1.5})])
    revs = list(reversed(revisions(app_url, w.slug())))
    r1, r2 = revs[0]["id"], revs[1]["id"]
    hunks = call("GET", app_url, f"/api/compare?base={r1}&head={r2}").json()["hunks"]
    assert [(h["index"], h["kind"]) for h in hunks] == [(1, "added"), (2, "added"), (3, "removed"), (4, "added")], \
        "H3 Hunks: volume descending, then removed before added; index counts from 1"
    assert [h["volume"] for h in hunks] == [pytest.approx(3 * _B_CELL)] * 2 + [pytest.approx(_B_CELL)] * 2, \
        "two 3-cell pin columns, then the 1-cell boss moves (L1036)"
    assert hunks[0]["box"]["min"][0] < hunks[1]["box"]["min"][0], "H3: equal added hunks by minimum corner x ascending"
    assert hunks[3]["box"]["min"][0] < hunks[2]["box"]["min"][0], "H3: removed before added outranks the corner order"
    sizes = [3, 3, 1, 1]
    want = [f"Hunk {i + 1} of 4 · {h['kind'].capitalize()} · {_b_volume(sizes[i])}" for i, h in enumerate(hunks)]
    with visit(browser, app_url, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay") as page:
        buttons = page.get_by_role("list", name="Hunks").get_by_role("button")
        eventually(page, lambda: buttons.count() == 4, "four hunks listed")
        assert [buttons.nth(i).evaluate("e => e.textContent").strip() for i in range(4)] == want, \
            "H3: the Hunks list follows the API order and numbering"
        page.get_by_role("button", name="Reset view").focus()
        for i in range(4):
            page.keyboard.press("j")
            eventually(page, lambda i=i: buttons.nth(i).get_attribute("aria-current") == "true", f"J selects hunk {i + 1}")
            assert query_of(page.url).get("hunk") == str(hunks[i]["index"]), "H3: the address hunk is the hunk's index from 1"


def test_compare_h4_outage(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w, revs = compare_world(app_url)
    r1, r2, r3 = (r["id"] for r in revs)
    answer = call("GET", down, f"/api/compare?base={r1}&head={r2}")
    assert answer.status_code == 503, f"H4: compare is storage-dependent and answers 503, got {answer.status_code}"
    assert answer.headers.get("Retry-After") == STORAGE_RETRY_AFTER, "H4: Retry-After: 5"
    assert answer.json() == {"error": "storage_unavailable", "message": DOWNLOAD_OUTAGE}, "H4: the download outage copy for compare"
    assert call("GET", down, f"/api/parts/{w.slug()}/revisions").status_code == 200, "H4: revisions stay database-only 200"
    with visit(browser, down, f"/parts/{w.slug()}/compare?base={r1}&head={r2}&view=overlay") as page:
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "H4: compare page shows status Storage")
        assert status(page, "Storage").inner_text().strip() == STORAGE_BANNER, "H4: the Storage status reads the banner copy"
        panel = page.locator('[data-ui="outage-panel"]')
        eventually(page, shows(panel, REPLAY_OUTAGE), "H4: the outage panel replaces the glow on compare")
        region = page.get_by_role("region", name="Volume change")
        hunks = page.get_by_role("list", name="Hunks").get_by_role("button")

        def empty() -> None:
            shown = region.inner_text() if region.count() else ""
            for word in ("Added", "Removed", "Unchanged"):
                assert word not in shown, f"H4: Volume change stays empty during the outage, saw {shown!r}"
            assert hunks.count() == 0, "H4: Hunks stays empty during the outage"

        empty()
        select(page.get_by_role("combobox", name="Head revision"), option_text(revs[2], w.name()))
        heading = f"Compare {revs[0]['label']} and {revs[2]['label']}"
        eventually(page, lambda: page.get_by_role("heading", name=heading).count() == 1, "H4: the menus keep working")
        assert query_of(page.url).get("head") == r3, "H4: the head menu still writes the address"
        empty()


def test_review_room_h3_thread_order(browser: Browser, app_url: str) -> None:
    bodies = [f"Wall note {tok()}", f"Hole note {tok()}", f"Edge note {tok()}"]
    authors = ["rev2", "rev1", "owner"]
    seeded = [{"key": f"c{i}", "room": "room", "author": a, "body": b, "anchor": {"kind": "none"}, "pose": POSE}
              for i, (a, b) in enumerate(zip(authors, bodies))]
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()], comments=seeded)
    room = w.room()
    first = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
    assert len({c["createdAt"] for c in first}) == 1, "one setup call stamps one createdAt (L769)"
    assert [c["id"] for c in first] == [c["id"] for c in sorted(first, key=lambda c: _b_id_key(c["id"]))], \
        "H3 Comments: equal creation times fall back to id"
    later = f"Later note {tok()}"
    made = post(app_url, f"/api/rooms/{room}/comments", {"body": later, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev1"))
    assert made.status_code == 201, f"POST comments answered {made.status_code}"
    stored = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
    assert [c["id"] for c in stored] == [c["id"] for c in first] + [made.json()["id"]], "H3: creation time ascending first"
    names = {c["id"]: f"{c['author']['displayName']}: {c['body']}" for c in stored}
    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as page:
        threads = page.get_by_role("listbox", name="Threads")
        want = [names[c["id"]] for c in stored]
        eventually(page, lambda: option_names(threads) == want, "Threads lists the stored comments")
        assert option_names(threads) == want, "H3: Threads follows creation time, then id"
        live = f"Live note {tok()}"
        sent = post(app_url, f"/api/rooms/{room}/comments", {"body": live, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2"))
        assert sent.status_code == 201
        want = want + [f"{w.name('rev2')}: {live}"]
        eventually(page, lambda: option_names(threads) == want, "H3: a later live comment is appended last")
        assert option_names(threads) == want, "H3: the newest comment sorts last in Threads"


def test_review_room_h4_database_only(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    first = f"Before outage {tok()}"
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()],
              comments=[{"key": "c1", "room": "room", "author": "rev2", "body": first, "anchor": {"kind": "none"}, "pose": POSE}])
    room, head = w.room(), w.data["parts"]["part"]["headRevisionId"]
    required = call("GET", app_url, "/api/config").json()["requiredApprovals"]
    read = call("GET", down, f"/api/rooms/{room}", w.cookie("rev1"))
    assert read.status_code == 200, f"H4: GET /api/rooms/<id> is database-only and stays 200, got {read.status_code}"
    assert [c["body"] for c in read.json()["comments"]] == [first], "H4: the room reads its comments from the database"
    api_body = f"During outage {tok()}"
    made = post(down, f"/api/rooms/{room}/comments", {"body": api_body, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev1"))
    assert made.status_code == 201, f"H4: comments are database-only, got {made.status_code}"
    approved = post(down, f"/api/rooms/{room}/approvals", {"revisionId": head}, w.cookie("rev2"))
    assert approved.status_code == 201, f"H4: approvals are database-only, got {approved.status_code}"
    assert [a["reviewerId"] for a in approved.json()["approvals"]] == [w.uid("rev2")], "H4: the approval is counted"
    with visit(browser, down, f"/rooms/{room}", cookie=w.cookie("rev1")) as page:
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "H4: room page shows status Storage")
        assert status(page, "Storage").inner_text().strip() == STORAGE_BANNER, "H4: the Storage status reads the banner copy"
        eventually(page, shows(page.locator('[data-ui="outage-panel"]'), REPLAY_OUTAGE), "H4: the outage panel replaces the glow")
        threads = page.get_by_role("listbox", name="Threads")
        want = [f"{w.name('rev2')}: {first}", f"{w.name('rev1')}: {api_body}"]
        eventually(page, lambda: option_names(threads) == want, "H4: the room still lists its comments")
        eventually(page, lambda: page.get_by_text(f"Approvals 1 of {required}").count() >= 1, "H4: approval progress still shows")
        typed = f"Typed in outage {tok()}"
        click(page.get_by_role("button", name="Comment on this view"))
        fill(page.get_by_role("textbox", name="Comment"), typed)
        click(page.get_by_role("button", name="Post comment"))
        eventually(page, lambda: page.get_by_role("option", name=f"{w.name('rev1')}: {typed}").count() == 1,
                   "H4: the room page still accepts comments while storage is down")
    stored = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
    assert [c["body"] for c in stored] == [first, api_body, typed], "H4: every comment posted during the outage is stored once"


def test_review_room_h8_comment_replay(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()])
    room, key, body = w.room(), idempotency_key(), f"Replay note {tok()}"
    path = f"/api/rooms/{room}/comments"
    made = post(app_url, path, {"body": body, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev1"), key)
    assert made.status_code == 201, f"POST comments answered {made.status_code}"
    same = post(app_url, path, {"body": body, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev1"), key)
    assert same.status_code == 201 and same.content == made.content, "H8: a completed key replays its status and body bytes"
    reordered = json.dumps({"pose": {"fov": float(POSE["fov"]), "up": POSE["up"], "target": POSE["target"], "position": POSE["position"]},
                            "body": body, "anchor": {"kind": "none"}})
    again = raw_post(app_url, path, reordered, w.cookie("rev1"), **{"Idempotency-Key": key})
    assert again.status_code == 201 and again.content == made.content, \
        "H8: reordered keys and 35.0 versus 35 are the same request and replay byte for byte (L699)"
    other = post(app_url, path, {"body": f"{body} changed", "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev1"), key)
    assert other.status_code == 422, f"H8: the same key with a different body answers 422, got {other.status_code}"
    assert other.json() == {"error": "key_reused", "message": "This Idempotency-Key was already used for a different request."}, \
        "H8: key_reused body"
    stored = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]
    assert [c["id"] for c in stored] == [made.json()["id"]], "H8: replays create nothing; one comment only"
    scoped = post(app_url, path, {"body": body, "anchor": {"kind": "none"}, "pose": POSE}, w.cookie("rev2"), key)
    assert scoped.status_code == 201 and scoped.json()["id"] != made.json()["id"], "H8: keys are scoped per caller (L698)"
    assert len(call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["comments"]) == 2, "H8: another caller's key is new"


def test_review_room_h7_overflow(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()],
              comments=[{"key": "c1", "room": "room", "author": "rev2", "body": f"The wall beside Hole 1 looks thin {tok()}",
                         "anchor": {"kind": "point", "position": [20, 0, 8]}, "pose": POSE}])
    for width in OVERFLOW_WIDTHS:
        with visit(browser, app_url, f"/rooms/{w.room()}", cookie=w.cookie("rev1"), size=(width, OVERFLOW_HEIGHT)) as page:
            threads = page.get_by_role("listbox", name="Threads")
            eventually(page, lambda: threads.get_by_role("option").count() == 1, f"room page loaded at {width} px")
            expect(page.get_by_role("heading", level=1, name=w.room_title())).to_be_visible()
            scroll, client = page.evaluate(OVERFLOW_JS)
            assert scroll == client, f"H7: room page at {width}×{OVERFLOW_HEIGHT} scrolls sideways ({scroll} > {client})"


_C_REQUIRED = 2
_C_KEY_REUSED = {"error": "key_reused", "message": "This Idempotency-Key was already used for a different request."}
_C_IN_PROGRESS = {"error": "idempotency_in_progress", "message": "A request with this Idempotency-Key is still being processed."}
_C_SIGNS_SOURCE = "# signs\nparam lift = 0 mm min 0 max 10\nbox 40 20 5\nboss 6 lift at 0 0\nhole 4 at 10 0\nboss 6 3 at -10 0\n"


def _c_approval_order(approvals: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return sorted(approvals, key=lambda a: (a["at"], a["reviewerId"]))


def _c_keyed_burst(send: Callable[[], httpx.Response], times: int = 8) -> list[httpx.Response]:
    with concurrent.futures.ThreadPoolExecutor(times) as pool:
        answers = list(pool.map(lambda _: send(), range(times)))
    made = [a for a in answers if a.status_code == 201]
    assert len(made) + len([a for a in answers if a.status_code == 409]) == times, \
        f"H8: simultaneous identical keyed requests answer 201 or 409 only, got {sorted(a.status_code for a in answers)}"
    assert made, "H8: one of the simultaneous identical keyed requests completes with 201"
    for answer in answers:
        if answer.status_code == 409:
            assert answer.json() == _C_IN_PROGRESS, "H8: a key in progress answers the published 409 body"
    assert all(a.content == made[0].content for a in made), "H8: every 201 for one key carries the same body bytes"
    return made


def _c_watch_room(page: Page) -> None:
    page.evaluate("""() => { window.__cSnaps = []; const snap = () => {
      const words = []; const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) words.push(n.nodeValue.trim());
      const found = (document.body.textContent || '').match(/Approvals \\d+ of \\d+/);
      window.__cSnaps.push({ progress: found ? found[0] : '', open: words.includes('Open'), approved: words.includes('Approved') }); };
      if (window.__cObserver) window.__cObserver.disconnect();
      window.__cObserver = new MutationObserver(snap);
      window.__cObserver.observe(document.body, { subtree: true, childList: true, characterData: true }); snap(); }""")


def _c_room_snaps(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__cSnaps")


def test_approval_gate_h3_approvals_order(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2", "rev3", "rev4"), parts=[part_spec()],
              rooms=[room_spec(reviewers=("rev1", "rev2", "rev3", "rev4"))],
              approvals=[{"room": "room", "reviewer": key} for key in ("rev3", "rev1", "rev2")])
    room, slug = w.room(), w.slug()
    listed = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]
    assert {a["reviewerId"] for a in listed} == {w.uid(k) for k in ("rev1", "rev2", "rev3")}, "three counted approvals"
    assert listed == _c_approval_order(listed), "H3: approvals are ordered by `at` ascending, then reviewerId"
    stream = Stream(app_url, f"/api/events?parts={slug}", cookie=w.cookie())
    made = post(app_url, f"/api/rooms/{room}/approvals", {"revisionId": listed[0]["revisionId"]}, w.cookie("rev4"))
    assert made.status_code == 201, f"a reviewer's approval of the head answers 201, got {made.status_code}"
    body = made.json()["approvals"]
    assert [a["reviewerId"] for a in body] == [a["reviewerId"] for a in listed] + [w.uid("rev4")], \
        "H3: the later approval sorts after the earlier ones in the 201 room JSON"
    assert body == _c_approval_order(body), "H3: the 201 room JSON keeps `at` then reviewerId order"
    again = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]
    assert again == body, "H3: GET /api/rooms/<id> lists approvals in the same order as the 201"
    events = stream.wait_for(lambda e: len(of_type(e, "approvals")) >= 1, 10.0, "the approval writes an approvals event")
    event_approvals = of_type(events, "approvals")[-1]["data"]["room"]["approvals"]
    assert [a["reviewerId"] for a in event_approvals] == [a["reviewerId"] for a in body], \
        "H3: the approvals event's room JSON keeps the same order"


def test_approval_gate_h8_keyed_approval_replay(app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61})], rooms=[room_spec()])
    room, slug, head = w.room(), w.slug(), w.rev("r2")
    r1 = revisions(app_url, slug)[-1]["id"]
    path = f"/api/rooms/{room}/approvals"
    stream = Stream(app_url, f"/api/events?parts={slug}", cookie=w.cookie())
    key = idempotency_key()
    made = _c_keyed_burst(lambda: post(app_url, path, {"revisionId": head}, w.cookie("rev1"), key))
    first = made[0]
    assert len(first.json()["approvals"]) == 1, "the keyed approval's room JSON holds one counted approval"
    approvals = call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]
    assert [a["reviewerId"] for a in approvals] == [w.uid("rev1")], "H8: simultaneous identical keyed approvals create one record"
    second = post(app_url, path, {"revisionId": head}, w.cookie("rev2"))
    assert second.status_code == 201 and second.json()["state"] == "approved", "the second reviewer's approval approves the room"
    stream.wait_for(lambda e: len(of_type(e, "approvals")) >= 2, 10.0, "two approvals events reach the owner stream")
    seen = len(stream.events)
    replay = post(app_url, path, {"revisionId": head}, w.cookie("rev1"), key)
    assert replay.status_code == first.status_code, "H8: the replay keeps the stored status"
    assert replay.content == first.content, "H8: the replay keeps the stored body bytes even after another reviewer approved"
    reused = post(app_url, path, {"revisionId": r1}, w.cookie("rev1"), key)
    assert reused.status_code == 422 and reused.json() == _C_KEY_REUSED, "H8: the same key with a different body answers key_reused"
    assert len(call("GET", app_url, f"/api/rooms/{room}", w.cookie()).json()["room"]["approvals"]) == 2, "H8: a replay adds no approval"
    assert stream.quiet(seen), "H8: a replay and a refused reuse emit no event"


def test_approval_gate_h6_progress_same_paint(browser: Browser, app_url: str) -> None:
    w = world(app_url, people=("owner", "rev1", "rev2"), parts=[part_spec()], rooms=[room_spec()],
              approvals=[{"room": "room", "reviewer": "rev1"}, {"room": "room", "reviewer": "rev2"}])
    slug, room, owner = w.slug(), w.room(), w.cookie()
    r1 = revisions(app_url, slug)[0]["id"]
    full, none = f"Approvals {_C_REQUIRED} of {_C_REQUIRED}", f"Approvals {0} of {_C_REQUIRED}"

    def consistent(snaps: list[dict[str, Any]]) -> bool:
        return all((s["approved"] and not s["open"]) if s["progress"] == full else
                   (s["open"] and not s["approved"]) if s["progress"] == none else True for s in snaps)

    with visit(browser, app_url, f"/rooms/{room}", cookie=w.cookie("rev1")) as page:
        eventually(page, lambda: page.get_by_text(full).count() >= 1 and page.get_by_text("Approved", exact=True).count() >= 1,
                   "the approved room shows its progress and state")
        _c_watch_room(page)
        _, tag = part_json(app_url, slug)
        same = save(app_url, slug, {}, owner, tag)
        assert same.status_code == 201, f"the equal-digest save answers 201, got {same.status_code}"
        carried = f"{same.json()['label']} has the same geometry; approvals carried over."
        eventually(page, lambda: page.get_by_text(carried).count() >= 1, "the carried line arrives live")
        snaps = _c_room_snaps(page)
        assert all(s["progress"] in (full, "") for s in snaps), "H6: a head with the approved digest never clears the progress"
        assert consistent(snaps) and snaps[-1]["progress"] == full and snaps[-1]["approved"], \
            "H6: progress and state stay approved for an equal digest"
        _c_watch_room(page)
        changed_head = save(app_url, slug, {"width": 61}, owner, f'"{same.json()["id"]}"')
        assert changed_head.status_code == 201, f"the shape-changing save answers 201, got {changed_head.status_code}"
        eventually(page, lambda: page.get_by_text(none).count() >= 1, "the progress clears live")
        snaps = _c_room_snaps(page)
        assert consistent(snaps), "H6: progress and state change in the same paint when the digest changes"
        assert snaps[-1]["progress"] == none and snaps[-1]["open"], "H6: a new digest leaves no counted approval and the room open"
        _c_watch_room(page)
        back = restore(app_url, slug, r1, owner, f'"{changed_head.json()["id"]}"')
        assert back.status_code == 201, f"the restore answers 201, got {back.status_code}"
        eventually(page, lambda: page.get_by_text(full).count() >= 1, "the approved digest counts again live")
        snaps = _c_room_snaps(page)
        assert consistent(snaps), "H6: returning to the approved digest restores progress and state in the same paint"
        assert snaps[-1]["progress"] == full and snaps[-1]["approved"], "H6: the restored digest counts its approvals again"


def test_conflict_restore_h8_restore_replay(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()], revisions=[rev_spec("r2", {"width": 61})])
    slug, cookie = w.slug(), w.cookie()
    r1 = revisions(app_url, slug)[-1]["id"]
    _, tag = part_json(app_url, slug)
    key = idempotency_key()
    first = restore(app_url, slug, r1, cookie, tag, key)
    assert first.status_code == 201, f"the keyed restore answers 201, got {first.status_code}"
    made = first.json()
    assert first.headers["Location"] == f"/api/parts/{slug}?revision={made['id']}", "H8: a restore's Location names the new revision"
    assert first.headers["ETag"] == f'"{made["id"]}"', "the 201 carries the new history ETag"
    moved = save(app_url, slug, {"width": 62}, cookie, "*")
    assert moved.status_code == 201, "the head moves past the restored revision"
    for sent in (tag, None):
        again = restore(app_url, slug, r1, cookie, sent, key)
        assert again.status_code == 201, f"H8: the replay comes ahead of If-Match ({sent!r}), got {again.status_code}"
        assert again.content == first.content, "H8: the replay keeps the stored body bytes after the head moved"
        assert again.headers["Location"] == first.headers["Location"], "H8: the replay keeps the stored Location"
        assert again.headers["ETag"] == first.headers["ETag"], "H8: the replay keeps the stored ETag"
    assert len(revisions(app_url, slug)) == 4, "H8: a replay creates no revision"
    other = restore(app_url, slug, w.rev("r2"), cookie, tag, key)
    assert other.status_code == 412, "H8: keys are scoped per path, so another restore path runs its own precondition"
    assert other.json()["headRevisionId"] == moved.json()["id"], "the 412 names the current head"
    assert len(revisions(app_url, slug)) == 4, "a refused restore creates nothing"


def test_conflict_restore_h8_concurrent_keyed_saves(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    _, tag = part_json(app_url, slug)
    key = idempotency_key()
    made = _c_keyed_burst(lambda: save(app_url, slug, {"width": 72.5}, cookie, tag, "Keyed", key))
    rev = made[0].json()
    for answer in made:
        assert answer.headers["Location"] == f"/api/parts/{slug}?revision={rev['id']}", "H8: a save's Location names its revision"
        assert answer.headers["ETag"] == f'"{rev["id"]}"', "H8: every 201 for the key carries the new ETag"
    assert len(revisions(app_url, slug)) == 2, "H8: one key creates exactly one revision"
    for sent in (f'W/"{rev["id"]}"', None):
        again = save(app_url, slug, {"width": 72.5}, cookie, sent, "Keyed", key)
        assert again.status_code == 201, f"H8: the replay comes ahead of If-Match ({sent!r}), got {again.status_code}"
        assert again.content == made[0].content, "H8: the replay keeps the stored body bytes"
        assert again.headers["Location"] == made[0].headers["Location"] and again.headers["ETag"] == made[0].headers["ETag"], \
            "H8: the replay keeps the stored Location and ETag"
    assert len(revisions(app_url, slug)) == 2, "H8: replays create no revision"


def test_conflict_restore_h4_storage_down_save(app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    before = revisions(app_url, slug)
    _, tag = part_json(app_url, slug)
    key = idempotency_key()
    refused = save(down, slug, {"width": 72.5}, cookie, tag, "Down", key)
    assert refused.status_code == 503, f"H4: a save with storage unreachable answers 503, got {refused.status_code}"
    assert refused.headers["Retry-After"] == STORAGE_RETRY_AFTER, "H4: the 503 carries Retry-After: 5"
    assert refused.json() == {"error": "storage_unavailable", "message": SAVE_OUTAGE}, "H4: the save outage body"
    assert revisions(app_url, slug) == before, "H4: the refused save creates no revision"
    assert part_json(app_url, slug)[1] == tag, "the refused save leaves the history ETag unchanged"
    listed = call("GET", down, f"/api/parts/{slug}/revisions", cookie)
    assert listed.status_code == 200 and listed.headers["ETag"] == tag, "H4: the revision history reads only the database and stays 200"
    made = save(app_url, slug, {"width": 72.5}, cookie, tag, "Down", key)
    assert made.status_code == 201, "H8: the 503 released the key, so the same key saves once storage is reachable"
    assert len(revisions(app_url, slug)) == 2, "the released key creates one revision"


def test_conflict_restore_h2_change_lines_precision(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    manifest = {m["name"]: m for m in part_json(app_url, slug)[0]["manifest"]}
    assert (manifest["width"]["precision"], manifest["thickness"]["precision"], manifest["holeSpacing"]["precision"]) == (1, 2, 1), \
        "defaults 60 and 40 give 1 decimal and 8 gives 2 (L866)"
    new = {"width": 72.5, "thickness": 8.125, "holeSpacing": 42.25}
    expected = [f"Width: 60.0 → 72.5{NNBSP}mm"]
    for name in ("thickness", "holeSpacing"):
        places = manifest[name]["precision"]
        expected.append(f"{manifest[name]['label']}: {half_even(manifest[name]['default'], places)} → {half_even(new[name], places)}{NNBSP}mm")
    with visit(browser, app_url, f"/parts/{slug}", cookie=cookie) as page:
        wait_settled(page, 0)
        seq = seq_of(page)
        commit(spin(page, "Depth"), "30")
        wait_settled(page, seq)
        click(page.get_by_role("radio", name="Inches"))
        _, tag = part_json(app_url, slug)
        head = save(app_url, slug, new, cookie, tag)
        assert head.status_code == 201, f"the other save answers 201, got {head.status_code}"
        label = head.json()["label"]
        click(page.get_by_role("button", name="Save revision"))
        click(page.get_by_role("dialog", name="Save revision").get_by_role("button", name="Save"))
        changes = page.get_by_role("alert").get_by_role("list", name=f"Changes in {label}")
        eventually(page, lambda: changes.count() == 1, "the losing save shows the conflict alert with its change list")
        lines = [line.strip() for line in changes.get_by_role("listitem").all_inner_texts()]
        assert lines == expected, f"H2: change lines at manifest precision with U+202F, in millimetres under Inches: {lines}"


def test_build_tape_h8_fork_replay(app_url: str) -> None:
    w = world(app_url, parts=[part_spec()])
    slug, cookie = w.slug(), w.cookie()
    r1 = revisions(app_url, slug)[0]["id"]
    tag, path, key = f'"{r1}"', f"/api/revisions/{r1}/fork", idempotency_key()
    first = post(app_url, path, {"operation": FORK_OP}, cookie, key, **{"If-Match": tag})
    assert first.status_code == 201, f"the keyed fork answers 201, got {first.status_code}"
    made = first.json()
    assert made["forkedFrom"] == {"revisionId": r1, "operation": FORK_OP}, "the fork records its operation"
    assert first.headers["Location"] == f"/api/parts/{slug}?revision={made['id']}", "H8: a fork's Location names the new revision"
    assert first.headers["ETag"] == f'"{made["id"]}"', "the 201 carries the new history ETag"
    assert save(app_url, slug, {"width": 61}, cookie, "*").status_code == 201, "the head moves past the fork"
    replays = [post(app_url, path, {"operation": FORK_OP}, cookie, key, **{"If-Match": tag}),
               post(app_url, path, {"operation": FORK_OP}, cookie, key),
               raw_post(app_url, path, '{"operation":7.0}', cookie, **{"If-Match": tag, "Idempotency-Key": key})]
    for again in replays:
        assert again.status_code == 201, f"H8: the fork replay comes ahead of If-Match, got {again.status_code}"
        assert again.content == first.content, "H8: the fork replay keeps the stored body bytes after the head moved"
        assert again.headers["Location"] == first.headers["Location"] and again.headers["ETag"] == first.headers["ETag"], \
            "H8: the fork replay keeps the stored Location and ETag"
    reused = post(app_url, path, {"operation": FORK_OP + 1}, cookie, key, **{"If-Match": tag})
    assert reused.status_code == 422 and reused.json() == _C_KEY_REUSED, "H8: the same key with another operation answers key_reused"
    assert len(revisions(app_url, slug)) == 3, "H8: replays and a reused key create no revision"


def test_build_tape_h4_storage_down_replay(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, parts=[part_spec(from_="peg-rail")])
    head = revisions(app_url, w.slug())[0]
    tape = call("GET", app_url, f"/api/revisions/{head['id']}/tape").json()
    down_tape = call("GET", down, f"/api/revisions/{head['id']}/tape")
    assert down_tape.status_code == 200, "H4: the tape JSON reads only the database and stays 200"
    assert down_tape.json() == tape, "H4: the storage-down tape JSON equals the stored tape"
    for digest in {o["digest"] for o in tape["operations"]}:
        solid = call("GET", down, f"/api/solids/{digest}")
        assert solid.status_code == 503, f"H4: a step solid with storage unreachable answers 503 ({digest})"
        assert solid.headers["Retry-After"] == STORAGE_RETRY_AFTER, "H4: the solid 503 carries Retry-After: 5"
        assert solid.json() == {"error": "storage_unavailable", "message": DOWNLOAD_OUTAGE}, "H4: a solid answers the download outage body"
    with visit(browser, down, f"/tapes/{head['id']}") as page:
        slider = page.get_by_role("slider", name="Build tape")
        eventually(page, lambda: slider.get_attribute("aria-valuemax") == str(tape["n"]), "the tape slider loads from the tape JSON")
        expect(page.get_by_role("heading", level=1)).to_have_text(f"{w.title()} · r1 build tape")
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "H4: the tape page shows status Storage with the banner")
        eventually(page, shows(page.locator('[data-ui="outage-panel"]'), REPLAY_OUTAGE), "H4: the replay outage panel replaces the glow")
        expect(slider).to_be_visible()


def test_build_tape_h2_change_readout_signs(browser: Browser, app_url: str) -> None:
    w = world(app_url, parts=[source_spec("part", _C_SIGNS_SOURCE)])
    head = revisions(app_url, w.slug())[0]
    tape = call("GET", app_url, f"/api/revisions/{head['id']}/tape").json()
    ops = tape["operations"]
    assert [(o["kind"], o["op"]) for o in ops[2:]] == [("body", "box"), ("join", "boss"), ("cut", "hole"), ("join", "boss")], \
        "one tape operation per geometry line"
    assert ops[3]["delta"] == 0, "a boss of height 0 has no geometric effect (L803)"
    assert ops[4]["delta"] == pytest.approx(-math.pi * 2 ** 2 * 5, abs=0.001), "a hole removes π·(dia/2)²·H (L799)"
    n = tape["n"]
    expected = {
        2: f"Operation 2 of {n} · box · +{half_even(ops[2]['delta'] / 1000, 2)}{NNBSP}cm³",
        3: f"Operation 3 of {n} · boss · ±0.00{NNBSP}cm³",
        4: f"Operation 4 of {n} · hole · {MINUS}{half_even(-ops[4]['delta'] / 1000, 2)}{NNBSP}cm³",
        5: f"Operation 5 of {n} · boss · +{half_even(ops[5]['delta'] / 1000, 2)}{NNBSP}cm³",
    }
    with visit(browser, app_url, f"/tapes/{head['id']}") as page:
        slider = page.get_by_role("slider", name="Build tape")
        readout = page.locator('[data-ui="tape-readout"]')
        eventually(page, lambda: slider.get_attribute("aria-valuemax") == str(n), "the tape loads")
        slider.focus()
        page.keyboard.press("Home")
        page.keyboard.press("ArrowRight")
        for k in range(2, n + 1):
            page.keyboard.press("ArrowRight")
            eventually(page, lambda k=k: readout.count() == 1 and readout.inner_text().strip() == expected[k],
                       f"H2: the readout at operation {k} reads {expected[k]!r}")


def test_gallery_likes_h3_name_order(browser: Browser, app_url: str) -> None:
    w = world(app_url)
    t = tok()
    titles = [f"Bracket {t}", f"anchor {t}", f"Zeta {t}", unicodedata.normalize("NFD", f"Éclat {t}"),
              f"Mesh {t}", f"Mesh {t}"]
    slugs = []
    for title in titles:
        made = post(app_url, "/api/parts", {"title": title, "category": "enclosure-parts", "visibility": "public",
                                            "source": PUBLISH_SOURCE}, w.cookie(), idempotency_key())
        assert made.status_code == 201, f"publishing {title!r} answers 201, got {made.status_code}"
        slugs.append(made.json()["slug"])
    bracket, anchor, zeta, eclat, mesh_a, mesh_b = slugs
    order = [bracket, *sorted([mesh_a, mesh_b]), zeta, anchor, eclat]
    seen: list[str] = []
    cursor = None
    for _ in range(PAGE_WALK_LIMIT):
        body = call("GET", app_url, "/api/parts?category=enclosure-parts&sort=name" + (f"&cursor={cursor}" if cursor else "")).json()
        seen += [p["slug"] for p in body["parts"] if p["slug"] in slugs]
        cursor = body["nextCursor"]
        if not cursor:
            break
    assert seen == order, "H3: Name A–Z is code-point order of the composed title (Bracket, Zeta, anchor, Éclat), then slug"
    by_slug = dict(zip(slugs, titles))
    wanted = [unicodedata.normalize("NFC", by_slug[s]) for s in order]
    with visit(browser, app_url, "/", size=WIDE) as page:
        grid = page.locator('[data-ui="gallery-grid"]')
        link = page.get_by_role("navigation", name="Categories").get_by_role("link", name=re.compile(r"^Enclosure parts \("))
        eventually(page, lambda: link.count() == 1 and grid.count() == 1 and int(grid.get_attribute("data-epoch") or 0) >= 1, "gallery loaded")
        epoch = int(grid.get_attribute("data-epoch") or 0)
        click(link)
        eventually(page, lambda: link.get_attribute("aria-current") == "true" and int(grid.get_attribute("data-epoch") or 0) > epoch,
                   "the category grid is painted")
        epoch = int(grid.get_attribute("data-epoch") or 0)
        select(page.get_by_role("combobox", name="Sort by"), "Name A–Z")
        eventually(page, lambda: int(grid.get_attribute("data-epoch") or 0) > epoch, "the Name A–Z grid is painted")
        cards = page.locator('[data-ui="part-card"]')
        more = page.get_by_role("button", name="Show more parts")
        for _ in range(PAGE_WALK_LIMIT):
            if more.count() == 0:
                break
            shown = cards.count()
            click(more)
            eventually(page, lambda shown=shown: cards.count() > shown, "Show more parts appends the next page")
        names = page.get_by_role("list", name="Parts").get_by_role("link").all_inner_texts()
        ours = [name.strip() for name in names if name.strip() in set(wanted)]
        assert ours == wanted, f"H3: the gallery's Name A–Z cards follow code-point title order: {ours}"


def test_gallery_likes_h4_storage_down_gallery(browser: Browser, app_url: str) -> None:
    down = os.environ["APP_STORAGE_DOWN_URL"]
    w = world(app_url, people=("owner", "fan"), parts=[part_spec()])
    slug, title = w.slug(), w.title()
    rev = revisions(app_url, slug)[0]
    listed = call("GET", down, "/api/parts?sort=newest")
    assert listed.status_code == 200, "H4: GET /api/parts reads only the database and stays 200"
    for kind in ("zip", "tar"):
        archive = call("GET", down, f"/api/revisions/{rev['id']}/archive.{kind}")
        assert archive.status_code == 503, f"H4: a {kind} download with storage unreachable answers 503"
        assert archive.headers["Retry-After"] == STORAGE_RETRY_AFTER, "H4: the archive 503 carries Retry-After: 5"
        assert archive.json() == {"error": "storage_unavailable", "message": DOWNLOAD_OUTAGE}, "H4: archives answer the download outage body"
    with visit(browser, down, "/", cookie=w.cookie("fan")) as page:
        eventually(page, shows(status(page, "Storage"), STORAGE_BANNER), "H4: the gallery shows status Storage with the banner")
        assert page.get_by_role("alert").filter(has_text=STORAGE_BANNER).count() == 0, "H4: on the gallery the banner is a status, never an alert"
        select(page.get_by_role("combobox", name="Sort by"), "Newest")
        card = page.get_by_role("list", name="Parts").get_by_role("listitem").filter(has=page.get_by_role("link", name=title, exact=True))
        eventually(page, lambda: card.count() == 1, "the new part's card is listed with storage down")
        eventually(page, shows(card, "Preview unavailable"), "a thumbnail that fails to load shows Preview unavailable (L646)")
        like = card.get_by_role("button", name=f"Like {title}")
        click(like)
        count = card.locator('[data-ui="like-count"]')
        eventually(page, lambda: like.get_attribute("aria-pressed") == "true" and count.inner_text().strip() == "1 like",
                   "likes keep working on the storage-down gallery")
    assert part_json(app_url, slug)[0]["likes"] == 1, "the like is one stored like record"


def test_gallery_likes_h8_publish_replay(app_url: str) -> None:
    w = world(app_url, people=("owner", "other"))
    cookie = w.cookie()
    body = {"title": f"Replay shelf {tok()}", "category": "brackets", "visibility": "public", "source": PUBLISH_SOURCE}
    key = idempotency_key()
    made = _c_keyed_burst(lambda: post(app_url, "/api/parts", body, cookie, key))
    first = made[0]
    slug = first.json()["slug"]
    for answer in made:
        assert answer.headers["Location"] == f"/api/parts/{slug}", "H8: a publish's Location is /api/parts/<new slug>"
    assert [p["slug"] for p in call("GET", app_url, "/api/dashboard", cookie).json()["parts"]] == [slug], \
        "H8: simultaneous identical keyed publishes create one part"
    _, tag = part_json(app_url, slug, cookie)
    assert save(app_url, slug, {"width": 61}, cookie, tag).status_code == 201, "the published part gets a second revision"
    again = post(app_url, "/api/parts", body, cookie, key)
    assert again.status_code == 201 and again.content == first.content, "H8: the publish replay keeps its stored status and bytes"
    assert again.headers["Location"] == first.headers["Location"], "H8: the publish replay keeps its stored Location"
    assert again.headers.get("ETag") == first.headers.get("ETag"), "H8: the publish replay keeps its stored ETag"
    reused = post(app_url, "/api/parts", {**body, "visibility": "private"}, cookie, key)
    assert reused.status_code == 422 and reused.json() == _C_KEY_REUSED, "H8: the same key with a different body answers key_reused"
    assert len(call("GET", app_url, "/api/dashboard", cookie).json()["parts"]) == 1, "H8: a replay or a reused key adds no part"
    theirs = post(app_url, "/api/parts", body, w.cookie("other"), key)
    assert theirs.status_code == 201 and theirs.json()["slug"] != slug, "H8: keys are scoped per caller, so another person publishes anew"
    assert theirs.headers["Location"] == f"/api/parts/{theirs.json()['slug']}", "H8: the other caller's Location names its own part"
