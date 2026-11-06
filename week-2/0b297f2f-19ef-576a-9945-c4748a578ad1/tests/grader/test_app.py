from __future__ import annotations

import base64
import fnmatch
import contextlib
import hashlib
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
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from urllib.parse import parse_qs, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

import conftest
from conftest import (
    S3,
    Postgres,
    addresses,
    advance,
    center,
    click as pointer_click,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    tab_order,
    tap,
    unique,
)
from conftest import fill as fill_field
from conftest import text as mail_text

APP_DIR = "/app"
DEPLOYED_APP = getattr(conftest, "DEPLOYED_APP", APP_DIR)

CUR, REG, RUTH, DEV = "cur-ines", "reg-tomasz", "prep-ruth", "prep-dev"
NAMES = {CUR: "Ines Calloway", REG: "Tomasz Adeyemi", RUTH: "Ruth Okonkwo-Hale", DEV: "Dev Malhotra"}
ROLES = {CUR: "curator", REG: "registrar", RUTH: "preparator", DEV: "preparator"}
LENDERS = {"lender-harbourside": "Harbourside Historical Society", "lender-oduya": "Mirela Oduya", "lender-fenwick": "Fenwick Maritime Trust"}
LENDER_EMAILS = {"lender-harbourside": "loans@harbourside-history.example", "lender-oduya": "mirela.oduya@example.net", "lender-fenwick": "registrar@fenwick-trust.example"}
WALL_NAMES = {"wall-north": "North wall", "wall-east": "East wall", "wall-south": "South wall", "wall-west": "West wall"}
FACING_YAW = {"wall-north": 0, "wall-east": 90, "wall-south": 180, "wall-west": 270}
EXHIBITION = "Salt and Thread"
GALLERY = "East Gallery"
MUSEUM_TZ = ZoneInfo("Europe/London")
WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
LEDGER_COLUMNS = ["Object number", "Title", "Lender", "Dimensions", "Lux limit", "Lux-hour budget", "Insurance value", "Condition", "Placement"]
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}

OPEN_HOURS = 686
OPEN_DAYS = 98
CENTRE_MM = 1450
GAP_MM = 200
LUX_MAX = 1000
BUDGET_MAX = 10_000_000
PHOTO_LIMIT = 10_000_000
NUDGE_SHOW_MS = 100
JSON_LIMIT = 65_536
UNDO_WINDOW_MS = 10_000
NUDGE_SAVE_MS = 500
SEARCH_DEBOUNCE_MS = 300
LIVE_UPDATE_MS = 5_000
EVENTS_POLL_MS = 2_000
MESSAGE_HOLD_MS = 5_000
PREVIEW_LIVE_MS = 10_000
PUBLISH_WINDOW_S = 10
BANNER_DOWN_MS = 10_000
BANNER_UP_MS = 15_000
PROBE_MAX_AGE_S = 5
UI_MS = 3_000
SETTLE_MIN_MS, SETTLE_MAX_MS = 200, 300
DROP_MIN_MS, DROP_MAX_MS = 600, 900
HANG_FADE_MIN_MS, HANG_FADE_MAX_MS = 150, 250
LUX_FADE_MIN_MS, LUX_FADE_MAX_MS = 400, 600
REDUCED_MAX_MS = 50
PLAN_HEIGHT_CM = 1800
EYE_HEIGHT_CM = 145
ORBIT_LIMIT_DEG = 30
TAP_TARGET_PX = 44
TOKEN_MIN_CHARS = 22
DESK = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
VIEWPORTS = {"desk": (1280, 800), "tablet": (768, 1024), "phone": (375, 812)}

STEP_MS = 50
STEP_TOL_MS = 100
REAL_WAIT_S = 30
HTTP_TIMEOUT_S = 60
PUBLISH_WAIT_S = 90
SERVICE_WAIT_S = 40
BOOT_WAIT_S = 120
TAB_LIMIT = 300

WORK_MM = 10
BIG_BUDGET = BUDGET_MAX
INSURANCE_PROBE = 42000
CENTRE_OFF_LINE = CENTRE_MM + WORK_MM
WINTER_DATE = date(2031, 3, 4)
SUMMER_DATE = date(2031, 7, 1)
PAST_DATE = "2020-01-01"
BAD_DATE = "2031-3-4"
WRONG_CLOCK = datetime(2001, 1, 1, 12, 0)

SUBJECT_PREVIEW = f"Preview of {EXHIBITION}: your loans in place"
SUBJECT_WITHDRAWN = f"Preview withdrawn: {EXHIBITION}"
DB_BANNER = "Hangline can't reach its database. Changes are paused until it's back."
IMG_BANNER = "Image store unavailable. Condition photos can't be attached right now."
MAIL_BANNER = "Mail relay unavailable. Preview emails will be sent when it's back."
TOO_SOON = "Choose a later date: 09:00 museum time on that date is less than 2 hours away."
BAD_DATE_MSG = "Enter a date as YYYY-MM-DD."
WIDTH_MSG = "Enter a width above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches."


def api(method: str, base: str, path: str, staff: str | None = None, body=None,
        content: bytes | None = None, headers: dict | None = None) -> httpx.Response:
    h = dict(headers or {})
    if staff:
        h["X-Staff-Id"] = staff
    if body is not None:
        content = json.dumps(body).encode()
        h.setdefault("Content-Type", "application/json")
    return httpx.request(method, base + path, content=content, headers=h, timeout=HTTP_TIMEOUT_S)


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text[:400]}"
    body = r.json()
    e = {**body["error"], **{k: v for k, v in body.items() if k != "error"}}
    assert e["code"] == code, r.text[:400]
    assert isinstance(e["message"], str)
    extra = {"validation_failed": "fields", "placement_rejected": "reason", "already_claimed": "claimedBy",
             "stale_version": "placement"}.get(code)
    assert extra is None or extra in e, r.text[:400]
    return e


def ok(r: httpx.Response, status: int = 200) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text[:400]}"
    return r.json()


def wait_real(fn, seconds: float, what: str):
    deadline = time.monotonic() + seconds
    last = None
    while time.monotonic() < deadline:
        try:
            value = fn()
            if value:
                return value
        except Exception as exc:
            last = exc
    raise AssertionError(f"{what}: not within {seconds} s ({last})")


def wait_out(base: str, seconds: float) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)


def tag_of(prefix: str) -> str:
    return re.sub(r"[^A-Za-z0-9]", "", unique(prefix)[0])[-14:]


def new_object(base: str, label: str = "Work", lender: str | None = None, lux: int = 200,
               budget: int = BIG_BUDGET, w=WORK_MM, h=WORK_MM, unit: str = "cm",
               insurance: int = 1200, note: str = "") -> dict:
    tag = tag_of(label)
    body = {"objectNumber": f"T-{tag}", "title": f"{label} {tag}", "medium": "Pencil on paper",
            "lenderId": lender, "width": w, "height": h, "unit": unit, "luxLimit": lux,
            "luxHourBudget": budget, "insuranceValueGbp": insurance, "registrarNote": note}
    return ok(api("POST", base, "/api/objects", REG, body), 201)["object"]


def walls(base: str) -> dict:
    data = ok(api("GET", base, "/api/exhibition", CUR))
    return {w["id"]: w for w in data["gallery"]["walls"]}


def placements(base: str) -> list[dict]:
    return ok(api("GET", base, "/api/placements", CUR))["placements"]


def placement(base: str, pid: str) -> dict | None:
    return next((p for p in placements(base) if p["id"] == pid), None)


def obj_get(base: str, oid: str) -> dict:
    return ok(api("GET", base, f"/api/objects/{oid}", REG))["object"]


def free_slot(base: str, wall_id: str, span: int) -> int:
    wall = walls(base)[wall_id]
    taken = sorted((p["offsetMm"] - p["widthMm"] / 2, p["offsetMm"] + p["widthMm"] / 2)
                   for p in placements(base) if p["wallId"] == wall_id)
    x = 0
    for a, b in taken:
        if x + span + GAP_MM <= a:
            return x
        x = max(x, math.ceil((b + GAP_MM) / 10) * 10)
    assert x + span <= wall["lengthMm"], f"no free stretch of {span} mm left on {wall_id}"
    return x


def place(base: str, obj: dict, wall_id: str, offset: int, centre: int = CENTRE_MM,
          override: bool = False, key: str | None = None, staff: str = CUR) -> httpx.Response:
    body = {"objectId": obj["id"], "wallId": wall_id, "offsetMm": offset,
            "centreHeightMm": centre, "heightOverride": override}
    return api("POST", base, "/api/placements", staff, body,
               headers={"Idempotency-Key": key} if key else None)


@pytest.fixture(autouse=True)
def _remove_test_placements(app_url):
    try:
        before = {p["id"] for p in placements(app_url)}
    except Exception:
        before = None
    yield
    if before is None:
        return
    try:
        for p in placements(app_url):
            if p["id"] not in before:
                if p["status"] == "claimed" and p.get("claimedBy"):
                    act(app_url, p["id"], "release", p["claimedBy"]["id"])
                api("DELETE", app_url, f"/api/placements/{p['id']}", CUR)
    except Exception:
        pass


def free_slot_on(base: str, wall_ids: tuple[str, ...], span: int) -> int:
    lengths = [walls(base)[w]["lengthMm"] for w in wall_ids]
    taken = sorted((p["offsetMm"] - p["widthMm"] / 2, p["offsetMm"] + p["widthMm"] / 2)
                   for p in placements(base) if p["wallId"] in wall_ids)
    x = 0
    for a, b in taken:
        if x + span + GAP_MM <= a:
            return x
        x = max(x, math.ceil((b + GAP_MM) / 10) * 10)
    assert x + span <= min(lengths), f"no stretch of {span} mm free on {wall_ids}"
    return x


def free_slot_near(base: str, wall_id: str, span: int, centre: int) -> int:
    length = walls(base)[wall_id]["lengthMm"]
    taken = [(p["offsetMm"] - p["widthMm"] / 2, p["offsetMm"] + p["widthMm"] / 2)
             for p in placements(base) if p["wallId"] == wall_id]
    starts = sorted(range(0, length - span + 1, 10), key=lambda x: abs(x + span / 2 - centre))
    for x in starts:
        if all(x + span + GAP_MM <= a or x >= b + GAP_MM for a, b in taken):
            return x
    raise AssertionError(f"no free stretch of {span} mm on {wall_id}")


def placed_work(base: str, label: str = "Work", wall_id: str = "wall-north", room: int = 0, **kw):
    obj = new_object(base, label, **kw)
    x = free_slot(base, wall_id, obj["widthMm"] + room)
    pl = ok(place(base, obj, wall_id, x + obj["widthMm"] // 2), 201)["placement"]
    return obj, pl


def move(base: str, pl: dict, staff: str = CUR, **fields) -> httpx.Response:
    return api("PATCH", base, f"/api/placements/{pl['id']}", staff, {"version": pl["version"], **fields})


def act(base: str, pid: str, verb: str, staff: str) -> httpx.Response:
    return api("POST", base, f"/api/placements/{pid}/{verb}", staff)


def discard(base: str, *pids: str) -> None:
    for pid in pids:
        api("DELETE", base, f"/api/placements/{pid}", CUR)


def events_after(base: str, seq: int) -> list[dict]:
    return ok(api("GET", base, f"/api/events?after={seq}", CUR))["events"]


def _png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(seed: str, size: int | None = None) -> bytes:
    pixels = hashlib.sha256(seed.encode()).digest()[:16]
    raw = b"".join(b"\x00" + pixels[4 * y:4 * y + 4] for y in range(4))
    head = b"\x89PNG\r\n\x1a\n" + _png_chunk(b"IHDR", struct.pack(">IIBBBBB", 4, 4, 8, 0, 0, 0, 0))
    body = _png_chunk(b"IDAT", zlib.compress(raw)) + _png_chunk(b"IEND", b"")
    text = b"Comment\x00" + seed.encode()
    if size is not None:
        text += b" " * (size - len(head) - len(body) - len(_png_chunk(b"tEXt", text)))
    return head + _png_chunk(b"tEXt", text) + body


TINY_JPEG_B64 = (
    "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAx"
    "NDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIy"
    "MjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAb/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QA"
    "FQEBAQAAAAAAAAAAAAAAAAAABAX/xAAUEQEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIRAxEAPwCfATT3/9k="
)


def jpeg_bytes(seed: str) -> bytes:
    import base64
    base = base64.b64decode(TINY_JPEG_B64)
    note = seed.encode()
    return base[:2] + b"\xff\xfe" + struct.pack(">H", len(note) + 2) + note + base[2:]


def upload(base: str, oid: str, payload: bytes, ctype: str, key: str | None = None,
           staff: str = REG) -> httpx.Response:
    h = {"Content-Type": ctype}
    if key:
        h["Idempotency-Key"] = key
    return api("POST", base, f"/api/objects/{oid}/photos", staff, content=payload, headers=h)


def cm(mm: float) -> str:
    return f"{mm / 10:.1f} cm"


def cm_input(mm: float) -> str:
    return f"{mm / 10:.1f}"


def tappable(loc: Locator) -> bool:
    box = loc.bounding_box()
    if box is not None and box["width"] >= TAP_TARGET_PX - 0.5 and box["height"] >= TAP_TARGET_PX - 0.5:
        return True
    return bool(loc.evaluate("""(e, h) => { const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
      return [[-h, -h], [h, -h], [-h, h], [h, h], [0, -h], [0, h], [-h, 0], [h, 0]].every(([dx, dy]) => {
        const t = document.elementFromPoint(x + dx, y + dy); return !!t && (t === e || e.contains(t)); }); }""", TAP_TARGET_PX / 2 - 0.25))


def real_target(loc: Locator) -> None:
    loc.evaluate("e => e.scrollIntoView({block: 'center', inline: 'center', behavior: 'instant'})")
    assert tappable(loc), loc.bounding_box()
    center(loc)


def display(local: datetime) -> str:
    return f"{WEEKDAYS[local.weekday()]} {local.day} {MONTHS[local.month - 1]} {local.year}, {local:%H:%M} museum time"


def countdown(seconds: int) -> str:
    return f"{seconds // 3600}:{seconds % 3600 // 60:02d}:{seconds % 60:02d}"


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def preview_of(base: str) -> dict:
    return ok(api("GET", base, "/api/preview", CUR))["preview"]


def reset_preview(base: str) -> dict:
    for _ in range(6):
        p = preview_of(base)
        if p["status"] in ("draft", "withdrawn"):
            return p
        api("POST", base, "/api/preview/cancel" if p["status"] == "scheduled" else "/api/preview/withdraw", CUR)
    pytest.fail(f"preview stuck in {preview_of(base)['status']}")


def wait_published(base: str) -> dict:
    return wait_real(lambda: (p := preview_of(base))["status"] == "published" and p, PUBLISH_WAIT_S, "preview publishes")


def services(base: str) -> dict:
    return ok(api("GET", base, "/api/status"))["services"]


def env_url(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"{name} is not set for the verifier"
    return value.rstrip("/")


@contextlib.contextmanager
def workspace(browser: Browser, base: str, staff: str | None, size=DESK, path: str = "/",
              reduced: str = "no-preference", no_webgl: bool = False, ready: bool = True):
    with open_app(browser, base + path, reduced_motion=reduced, no_webgl=no_webgl) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.goto(base + path)
        if staff:
            picker = page.get_by_role("combobox", name="Working as")
            eventually(page, lambda: picker.is_visible(), UI_MS, "Working as picker")
            select(picker, f"{NAMES[staff]} ({ROLES[staff]})")
        if ready and path.split("?")[0] == "/":
            shows(page, ledger(page))
        yield page


def eventually(page: Page, check, budget_ms: float, what: str, real_s: float = REAL_WAIT_S) -> None:
    spent = 0.0
    deadline = time.monotonic() + real_s
    last = None
    while True:
        try:
            if check():
                return
        except Exception as exc:
            last = exc
        if time.monotonic() > deadline:
            raise AssertionError(f"{what}: not within {budget_ms} ms of page time ({last})")
        if spent < budget_ms:
            step = min(STEP_MS, budget_ms - spent)
            advance(page, step)
            spent += step


def shows(page: Page, loc: Locator, text: str | None = None, budget_ms: float = UI_MS) -> None:
    eventually(page, lambda: loc.count() > 0 and loc.first.is_visible()
               and (text is None or text in loc.first.inner_text()), budget_ms, f"shows {text or loc}")


def text_of(loc: Locator) -> str:
    return loc.first.inner_text() if loc.count() else ""


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("el => el === document.activeElement")


def holds_focus(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("el => el.contains(document.activeElement)")


def gone(loc: Locator) -> bool:
    return loc.count() == 0 or not loc.first.is_visible()


def tab_to(page: Page, target: Locator, limit: int = TAB_LIMIT, key: str = "Tab") -> None:
    for _ in range(limit):
        page.keyboard.press(key)
        if focused(target):
            return
    pytest.fail(f"{key} never reached {target}")


def page_now(page: Page) -> float:
    return page.evaluate("() => Date.now()")


def scene(page: Page) -> Locator:
    return page.get_by_role("region", name="Gallery scene")


def ledger(page: Page) -> Locator:
    return page.get_by_role("table", name="Scene ledger")


def handle(page: Page, title: str) -> Locator:
    return ledger(page).get_by_role("button", name=title, exact=True)


def row(page: Page, title: str) -> Locator:
    return ledger(page).get_by_role("row").filter(has=page.get_by_role("button", name=title, exact=True))


def rail(page: Page) -> Locator:
    return page.get_by_role("region", name="Objects")


def card(page: Page, title: str) -> Locator:
    return rail(page).get_by_role("listitem", name=title, exact=True)


def card_button(page: Page, title: str, name: str) -> Locator:
    return card(page, title).get_by_role("button", name=name, exact=True)


def said(page: Page) -> Locator:
    return page.get_by_role("status", name="Announcements")


def team(page: Page) -> Locator:
    return page.get_by_role("status", name="Team updates")


def view_button(page: Page, name: str) -> Locator:
    return page.get_by_role("group", name="View").get_by_role("button", name=name, exact=True)


def marker(page: Page, pid: str) -> Locator:
    return scene(page).locator(f'[data-placement-id="{pid}"]')


def scene_state(page: Page) -> dict:
    s = page.get_by_role("region", name="Gallery scene", include_hidden=True)
    return {k: s.get_attribute(f"data-{k}") for k in ("view", "transitioning", "camera-height-cm", "camera-yaw-deg", "hang-line")}


def settled(page: Page, budget_ms: float = DROP_MAX_MS + HANG_FADE_MAX_MS + STEP_TOL_MS) -> dict:
    eventually(page, lambda: scene_state(page)["transitioning"] == "false", budget_ms, "view settles")
    return scene_state(page)


def expect_view(page: Page, view: str, height: int, yaw: int | None, hang: str) -> None:
    st = scene_state(page)
    assert st["view"] == view and st["transitioning"] == "false", st
    assert int(st["camera-height-cm"]) == height, st
    if yaw is not None:
        assert int(st["camera-yaw-deg"]) == yaw, st
    assert st["hang-line"] == hang, st
    readout = f"Eye height {EYE_HEIGHT_CM} cm" if height == EYE_HEIGHT_CM else "Plan view"
    assert readout in scene(page).inner_text()
    pressed = {"plan": "Plan", "wall": "Wall", "light": "Light"}[view]
    for name in ("Plan", "Wall", "Light"):
        assert view_button(page, name).get_attribute("aria-pressed") == ("true" if name == pressed else "false")


def open_rail(page: Page) -> None:
    btn = page.get_by_role("button", name="Objects", exact=True)
    if btn.count() and btn.is_visible() and btn.get_attribute("aria-expanded") != "true":
        btn.click()
    shows(page, rail(page))


def requests_seen(page: Page, method: str, needle: str) -> list:
    seen: list = []
    page.on("request", lambda r: seen.append(r) if r.method == method and needle in r.url else None)
    return seen


SCENE_REC = """(el, attrs) => {
  const stamp = () => ({p: performance.now(), t: document.timeline.currentTime});
  const log = attrs.map(a => Object.assign({a, init: true}, stamp()));
  new MutationObserver(ms => ms.forEach(m => log.push(Object.assign({a: m.attributeName, old: m.oldValue}, stamp()))))
    .observe(el, {attributes: true, attributeFilter: attrs, attributeOldValue: true});
  window.__hangRec = log;
}"""

SETTLE_REC = """(root) => {
  const stamp = () => ({p: performance.now(), t: document.timeline.currentTime});
  const log = [];
  const add = n => { if (n.nodeType !== 1) return;
    const all = n.hasAttribute('data-placement-id') ? [n] : [];
    n.querySelectorAll('[data-placement-id]').forEach(x => all.push(x));
    all.forEach(x => log.push(Object.assign({a: x.getAttribute('data-placement-id'), init: true}, stamp()))); };
  new MutationObserver(ms => ms.forEach(m => { if (m.type === 'childList') m.addedNodes.forEach(add);
    else log.push(Object.assign({a: m.target.getAttribute('data-placement-id'), old: m.oldValue}, stamp())); }))
    .observe(root, {subtree: true, childList: true, attributes: true, attributeFilter: ['data-settling'], attributeOldValue: true});
  window.__hangRec = log;
}"""

TEXT_REC = """(el) => { const log = [el.innerText];
  new MutationObserver(() => log.push(el.innerText)).observe(el, {subtree: true, childList: true, characterData: true});
  window.__textRec = log; }"""

ANIMS = """() => document.getAnimations().map(a => { const t = a.effect ? a.effect.getComputedTiming() : {};
  return {end: t.endTime === Infinity ? 1e12 : t.endTime, iterations: t.iterations === Infinity ? -1 : t.iterations}; })"""


def history(page: Page, key: str, final: str | None) -> list[tuple[str | None, float, float]]:
    recs = [r for r in page.evaluate("() => window.__hangRec") if r["a"] == key]
    out = []
    for i, r in enumerate(recs):
        nxt = next((q for q in recs[i + 1:] if "old" in q), None)
        out.append((nxt["old"] if nxt else final, r["p"], r["t"] or 0.0))
    return out


def span(hist, value: str) -> tuple[float, float]:
    start = next(i for i, h in enumerate(hist) if h[0] == value)
    end = next(i for i in range(start + 1, len(hist)) if hist[i][0] != value)
    return hist[end][1] - hist[start][1], hist[end][2] - hist[start][2]


def check_span(fake: float, real: float, low: float, high: float, what: str) -> None:
    assert min(fake, real) <= high + STEP_TOL_MS, f"{what} took {fake:.0f} page ms / {real:.0f} real ms"
    assert max(fake, real) >= low - STEP_TOL_MS, f"{what} took only {fake:.0f} page ms / {real:.0f} real ms"


def ui_place(page: Page, title: str, wall: str, offset_mm: int) -> Locator:
    card_button(page, title, "Place").click()
    dlg = page.get_by_role("dialog", name="Place work")
    shows(page, dlg)
    select(dlg.get_by_role("combobox", name="Wall"), wall)
    fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(offset_mm))
    dlg.get_by_role("button", name="Save placement", exact=True).click()
    return dlg


def test_place_work_api(app_url):
    obj = new_object(app_url, "Placed")
    wall = walls(app_url)["wall-north"]
    off = free_slot(app_url, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
    key = idempotency_key()
    r = place(app_url, obj, "wall-north", off, key=key)
    data = ok(r, 201)
    p = data["placement"]
    assert isinstance(data["seq"], int)
    assert (p["objectId"], p["wallId"], p["wallName"], p["offsetMm"]) == (obj["id"], "wall-north", "North wall", off)
    assert (p["centreHeightMm"], p["heightOverride"], p["status"], p["version"], p["claimedBy"]) == (CENTRE_MM, False, "proposed", 1, None)
    assert (p["widthMm"], p["heightMm"], p["objectTitle"]) == (obj["widthMm"], obj["heightMm"], obj["title"])
    assert p["plannedLux"] == wall["plannedLux"] and p["plannedLuxHours"] == wall["plannedLux"] * OPEN_HOURS
    assert p["luxStatus"] == "within" and p["luxLimit"] == obj["luxLimit"] and p["luxHourBudget"] == obj["luxHourBudget"]
    again = place(app_url, obj, "wall-north", off, key=key)
    assert again.status_code == 201 and again.json() == data
    err(place(app_url, obj, "wall-north", off + 10, key=key), 409, "idempotency_conflict")
    err(place(app_url, obj, "wall-north", off), 409, "already_placed")
    mine = [q for q in placements(app_url) if q["objectId"] == obj["id"]]
    assert len(mine) == 1 and mine[0]["offsetMm"] == off
    placed = [e for e in events_after(app_url, data["seq"] - 1) if e["placementId"] == p["id"] and e["kind"] == "placement.placed"]
    assert len(placed) == 1 and placed[0]["seq"] == data["seq"] and placed[0]["actor"]["id"] == CUR
    discard(app_url, p["id"])


HANG_CASES = ["off_wall", "off_centre_line", "too_close", "gap_exactly_200", "exception_off_line", "move_off_wall"]


@pytest.mark.parametrize("case", HANG_CASES, ids=HANG_CASES)
def test_hang_rules(app_url, case):
    a = new_object(app_url, "Neighbour")
    b = new_object(app_url, "Hanging")
    w = a["widthMm"]
    x = free_slot(app_url, "wall-north", w * 2 + GAP_MM + 10)
    pa = ok(place(app_url, a, "wall-north", x + w // 2), 201)["placement"]
    made = [pa["id"]]
    try:
        reasons = {
            "off_wall": (f"Runs off the wall: keep the whole work on {WALL_NAMES['wall-north']}.", {"offset": w // 2 - 10}),
            "off_centre_line": ("Off the 145 cm centre line: set the centre height to 145 cm or mark it as an exception.",
                                {"offset": x + 2 * w + GAP_MM + w // 2, "centre": CENTRE_OFF_LINE}),
            "too_close": (f"Too close to {a['title']}: keep at least 20 cm between works.",
                          {"offset": x + w + GAP_MM - 10 + w // 2}),
        }
        if case in reasons:
            message, kw = reasons[case]
            r = place(app_url, b, "wall-north", kw["offset"], centre=kw.get("centre", CENTRE_MM))
            e = err(r, 422, "placement_rejected")
            assert e["reason"] == case and e["message"] == message
            assert not [p for p in placements(app_url) if p["objectId"] == b["id"]]
        elif case == "gap_exactly_200":
            pb = ok(place(app_url, b, "wall-north", x + w + GAP_MM + w // 2), 201)["placement"]
            made.append(pb["id"])
        elif case == "exception_off_line":
            pb = ok(place(app_url, b, "wall-north", x + w + GAP_MM + w // 2, centre=CENTRE_OFF_LINE, override=True), 201)["placement"]
            made.append(pb["id"])
            assert pb["centreHeightMm"] == CENTRE_OFF_LINE and pb["heightOverride"] is True
        else:
            pb = ok(place(app_url, b, "wall-north", x + w + GAP_MM + w // 2), 201)["placement"]
            made.append(pb["id"])
            length = walls(app_url)["wall-north"]["lengthMm"]
            e = err(move(app_url, pb, offsetMm=length), 422, "placement_rejected")
            assert e["reason"] == "off_wall" and e["message"] == f"Runs off the wall: keep the whole work on {WALL_NAMES['wall-north']}."
            now = placement(app_url, pb["id"])
            assert now["offsetMm"] == pb["offsetMm"] and now["version"] == 1
    finally:
        discard(app_url, *made)


def test_light_limit_gates_placement(app_url):
    w = walls(app_url)
    north, south = w["wall-north"]["plannedLux"], w["wall-south"]["plannedLux"]
    assert south > north
    obj = new_object(app_url, "Paper", lux=north)
    message = f"Too bright for this work: South wall is lit at {south} lux and the limit is {north} lux."
    xs = free_slot(app_url, "wall-south", obj["widthMm"])
    e = err(place(app_url, obj, "wall-south", xs + obj["widthMm"] // 2), 422, "placement_rejected")
    assert e["reason"] == "too_bright" and e["message"] == message
    assert not [p for p in placements(app_url) if p["objectId"] == obj["id"]]
    xn = free_slot(app_url, "wall-north", obj["widthMm"])
    p = ok(place(app_url, obj, "wall-north", xn + obj["widthMm"] // 2), 201)["placement"]
    e = err(move(app_url, p, wallId="wall-south", offsetMm=free_slot(app_url, "wall-south", obj["widthMm"]) + obj["widthMm"] // 2),
            422, "placement_rejected")
    assert e["reason"] == "too_bright" and e["message"] == message
    assert placement(app_url, p["id"])["wallId"] == "wall-north"
    discard(app_url, p["id"])


def test_place_dialog_rejection(browser, app_url):
    w = walls(app_url)
    obj = new_object(app_url, "Textile", lux=w["wall-north"]["plannedLux"])
    off = free_slot(app_url, "wall-south", obj["widthMm"]) + obj["widthMm"] // 2
    reason = f"Too bright for this work: South wall is lit at {w['wall-south']['plannedLux']} lux and the limit is {obj['luxLimit']} lux."
    with workspace(browser, app_url, CUR) as page:
        shows(page, card(page, obj["title"]))
        dlg = ui_place(page, obj["title"], "South wall", off)
        summary = dlg.get_by_role("alert")
        announced = page.get_by_role("status", name="Announcements", include_hidden=True)
        eventually(page, lambda: holds_focus(summary) and reason in text_of(announced), UI_MS, "summary focus")
        assert "Fix these to continue:" in summary.inner_text()
        assert dlg.is_visible() and dlg.get_by_text(reason).count() >= 2
        summary.get_by_role("link", name=reason).click()
        eventually(page, lambda: focused(dlg.get_by_role("combobox", name="Wall")), UI_MS, "Wall field focus")
    assert not [p for p in placements(app_url) if p["objectId"] == obj["id"]]


def test_work_settles_onto_hang_line(browser, app_url):
    for reduced in ("no-preference", "reduce"):
        obj = new_object(app_url, "Settling")
        off = free_slot(app_url, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
        with workspace(browser, app_url, CUR, reduced=reduced) as page:
            shows(page, card(page, obj["title"]))
            scene(page).evaluate(SETTLE_REC)
            ui_place(page, obj["title"], "North wall", off)
            pid = wait_real(lambda: next((p["id"] for p in placements(app_url) if p["objectId"] == obj["id"]), None), REAL_WAIT_S, "placement saved")
            m = marker(page, pid)
            eventually(page, lambda: m.count() > 0 and m.get_attribute("data-settling") == "false"
                       and history(page, pid, "false")[-1][0] == "false", SETTLE_MAX_MS + STEP_TOL_MS * 3, "settled")
            hist = history(page, pid, m.get_attribute("data-settling"))
            if reduced == "reduce":
                assert all(v != "true" for v, _, _ in hist), hist
            else:
                fake, real = span(hist, "true")
                check_span(fake, real, SETTLE_MIN_MS, SETTLE_MAX_MS, "settling")
        discard(app_url, pid)


def test_wf_place_work_keyboard_desk(browser, app_url):
    w = walls(app_url)
    lux = w["wall-north"]["plannedLux"]
    obj = new_object(app_url, "Quilt", lender="lender-oduya", lux=lux)
    off = free_slot_on(app_url, ("wall-north", "wall-south"), obj["widthMm"]) + obj["widthMm"] // 2
    with workspace(browser, app_url, CUR, size=TABLET) as other, workspace(browser, app_url, CUR) as page:
        shows(page, card(page, obj["title"]))
        tab_to(page, page.get_by_role("link", name="Skip to main content"), key="Shift+Tab")
        tab_to(page, card_button(page, obj["title"], "Place"))
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Place work")
        eventually(page, lambda: holds_focus(dlg), UI_MS, "dialog focus")
        select(dlg.get_by_role("combobox", name="Wall"), "South wall")
        fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(off))
        tab_to(page, dlg.get_by_role("button", name="Save placement", exact=True))
        page.keyboard.press("Enter")
        summary = dlg.get_by_role("alert")
        eventually(page, lambda: holds_focus(summary), UI_MS, "summary focus")
        link = summary.get_by_role("link").first
        if not focused(link):
            tab_to(page, link)
        page.keyboard.press("Enter")
        wall_box = dlg.get_by_role("combobox", name="Wall")
        eventually(page, lambda: focused(wall_box), UI_MS, "Wall focus")
        select(wall_box, "North wall")
        fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(off))
        tab_to(page, dlg.get_by_role("button", name="Save placement", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(handle(page, obj["title"])), UI_MS, "focus on handle")
        assert gone(dlg)
        assert f"{obj['title']} placed on North wall." in text_of(said(page))
        r = row(page, obj["title"]).inner_text()
        assert cm(off) in r and "145.0 cm" in r and f"{lux * OPEN_HOURS:,}" in r and "Within limit" in r
        p = next(p for p in placements(app_url) if p["objectId"] == obj["id"])
        assert (p["wallId"], p["offsetMm"], p["status"]) == ("wall-north", off, "proposed")
        eventually(other, lambda: handle(other, obj["title"]).count() == 1
                   and f"Ines Calloway placed {obj['title']} on North wall." in text_of(team(other)), LIVE_UPDATE_MS, "other session")
        h = handle(page, obj["title"])
        h.focus()
        page.keyboard.press("Enter")
        details = page.get_by_role("dialog", name="Placement details")
        eventually(page, lambda: holds_focus(details), UI_MS, "details focus")
        for key in ("Tab", "Tab", "Tab", "Shift+Tab"):
            page.keyboard.press(key)
            assert holds_focus(details), key
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(details) and focused(h), UI_MS, "focus back on the handle")
    discard(app_url, p["id"])


def test_wf_place_work_phone_sheet(browser, app_url):
    obj = new_object(app_url, "Pocket")
    off = free_slot(app_url, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, CUR, size=PHONE) as page:
        layout(page)
        objects = page.get_by_role("button", name="Objects", exact=True)
        assert objects.get_attribute("aria-expanded") == "false" and rail(page).count() == 0
        names = tab_order(page, 40)
        assert "Place" not in names and "Open record" not in names
        tab_to(page, objects)
        page.keyboard.press("Enter")
        eventually(page, lambda: holds_focus(rail(page)), UI_MS, "focus inside sheet")
        real_target(objects)
        real_target(card_button(page, obj["title"], "Place"))
        tab_to(page, card_button(page, obj["title"], "Place"))
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Place work")
        shows(page, dlg)
        real_target(dlg.get_by_role("button", name="Save placement", exact=True))
        select(dlg.get_by_role("combobox", name="Wall"), "North wall")
        fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(off))
        tab_to(page, dlg.get_by_role("button", name="Save placement", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(handle(page, obj["title"])), UI_MS, "handle focus")
        eventually(page, lambda: gone(dlg) and objects.get_attribute("aria-expanded") == "false" and rail(page).count() == 0,
                   UI_MS, "dialog and sheet closed")
        assert f"{obj['title']} placed on North wall." in text_of(said(page))
        p = next(p for p in placements(app_url) if p["objectId"] == obj["id"])
        assert p["offsetMm"] == off
        eventually(other, lambda: f"Ines Calloway placed {obj['title']} on North wall." in text_of(team(other))
                   and handle(other, obj["title"]).count() == 1, LIVE_UPDATE_MS, "desk session")
    discard(app_url, p["id"])


def test_keyboard_nudges(browser, app_url):
    obj, pl = placed_work(app_url, "Nudge", room=GAP_MM)
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        patches = requests_seen(page, "PATCH", pl["id"])
        h.focus()
        for i in range(1, 4):
            page.keyboard.press("ArrowRight")
            eventually(page, lambda i=i: cm(pl["offsetMm"] + 10 * i) in row(page, obj["title"]).inner_text(),
                       NUDGE_SHOW_MS, "nudge shown")
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: cm(pl["offsetMm"] + 130) in row(page, obj["title"]).inner_text(), NUDGE_SHOW_MS, "nudges shown")
        advance(page, NUDGE_SAVE_MS - STEP_TOL_MS - NUDGE_SHOW_MS)
        assert patches == []
        eventually(page, lambda: len(patches) == 1 and placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"] + 130,
                   STEP_TOL_MS * 2 + NUDGE_SHOW_MS, "one save after the keys rest")
        assert json.loads(patches[0].post_data)["offsetMm"] == pl["offsetMm"] + 130
        shows(page, said(page), f"{obj['title']} moved to {cm(pl['offsetMm'] + 130)} from the left end.")
        assert focused(h)
        advance(page, NUDGE_SAVE_MS * 2)
        assert len(patches) == 1 and placement(app_url, pl["id"])["centreHeightMm"] == CENTRE_MM
    discard(app_url, pl["id"])


def test_placement_details_dialog(browser, app_url):
    obj, pl = placed_work(app_url, "Details")
    with workspace(browser, app_url, CUR, reduced="reduce") as page:
        h = handle(page, obj["title"])
        shows(page, h)
        for key in ("1", "2"):
            h.focus()
            page.keyboard.press(key)
            settled(page)
            h.focus()
            page.keyboard.press("Enter")
            dlg = page.get_by_role("dialog", name="Placement details")
            eventually(page, lambda: holds_focus(dlg), UI_MS, "focus inside dialog")
            for _ in range(12):
                page.keyboard.press("Tab")
                assert holds_focus(dlg)
            for _ in range(12):
                page.keyboard.press("Shift+Tab")
                assert holds_focus(dlg)
            page.keyboard.press("Escape")
            eventually(page, lambda: gone(dlg) and focused(h), UI_MS, "focus back on handle")
    discard(app_url, pl["id"])


def test_rejected_nudge_snaps_back(browser, app_url):
    a, pa = placed_work(app_url, "Anchor", room=GAP_MM + 2 * WORK_MM * 10)
    b = new_object(app_url, "Crowd")
    off_b = pa["offsetMm"] + pa["widthMm"] // 2 + GAP_MM + 5 + b["widthMm"] // 2
    pb = ok(place(app_url, b, "wall-north", off_b), 201)["placement"]
    reason = f"Too close to {a['title']}: keep at least 20 cm between works."
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, b["title"])
        shows(page, h)
        h.focus()
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: reason in text_of(said(page)) and cm(off_b) in row(page, b["title"]).inner_text(),
                   NUDGE_SAVE_MS + UI_MS, "snap back and reason")
        advance(page, MESSAGE_HOLD_MS - STEP_TOL_MS)
        assert reason in text_of(said(page))
        assert focused(h)
    e = err(move(app_url, pb, CUR, offsetMm=off_b - 10), 422, "placement_rejected")
    assert e["reason"] == "too_close" and e["message"] == reason, e
    assert placement(app_url, pb["id"])["offsetMm"] == off_b
    discard(app_url, pa["id"], pb["id"])


def test_stale_move_shows_latest(browser, app_url):
    obj, pl = placed_work(app_url, "Stale", room=GAP_MM)
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        with held(page, "**/api/events**"):
            newer = ok(move(app_url, pl, offsetMm=pl["offsetMm"] + 50))["placement"]
            h.focus()
            page.keyboard.press("ArrowRight")
            eventually(page, lambda: f"Someone else moved {obj['title']}. Showing the latest position." in text_of(said(page))
                       and cm(newer["offsetMm"]) in row(page, obj["title"]).inner_text(), NUDGE_SAVE_MS + UI_MS, "stale handling")
    assert placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"] + 50
    now = placement(app_url, pl["id"])
    e = err(move(app_url, pl, CUR, offsetMm=pl["offsetMm"] + 20), 412, "stale_version")
    assert (e["placement"]["id"], e["placement"]["version"], e["placement"]["offsetMm"]) == (now["id"], now["version"], now["offsetMm"]), e
    discard(app_url, pl["id"])


def test_wf_keyboard_nudge_desk(browser, app_url):
    obj = new_object(app_url, "Herring")
    x = free_slot(app_url, "wall-north", obj["widthMm"] + GAP_MM * 3)
    pl = ok(place(app_url, obj, "wall-north", x + GAP_MM + obj["widthMm"] // 2), 201)["placement"]
    exact = pl["offsetMm"] + 250
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        tab_to(page, h)
        page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"] - 90, NUDGE_SAVE_MS + UI_MS, "nudge saved")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Placement details")
        shows(page, dlg)
        box = dlg.get_by_role("textbox", name="Offset from left end")
        tab_to(page, box)
        page.keyboard.press("Control+a")
        page.keyboard.type(cm_input(exact))
        tab_to(page, dlg.get_by_role("button", name="Save", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: gone(dlg) and focused(h) and cm(exact) in row(page, obj["title"]).inner_text(), UI_MS, "saved offset")
        assert placement(app_url, pl["id"])["offsetMm"] == exact
        eventually(other, lambda: cm(exact) in row(other, obj["title"]).inner_text()
                   and f"Ines Calloway moved {obj['title']} to {cm(exact)} from the left end." in text_of(team(other)),
                   LIVE_UPDATE_MS, "other session")
    discard(app_url, pl["id"])


def test_wf_keyboard_nudge_phone(browser, app_url):
    obj, pl = placed_work(app_url, "Phone nudge", room=GAP_MM * 2)
    exact = pl["offsetMm"] + 120
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, CUR, size=PHONE) as page:
        heads = [c.strip() for c in ledger(page).get_by_role("columnheader").all_inner_texts()]
        assert heads == ["Work", "Offset", "Lux status", "Status"], heads
        layout(page)
        h = handle(page, obj["title"])
        real_target(h)
        tab_to(page, h)
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"] + 10, NUDGE_SAVE_MS + UI_MS, "nudge saved")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Placement details")
        box = dlg.get_by_role("textbox", name="Offset from left end")
        tab_to(page, box)
        page.keyboard.press("Control+a")
        page.keyboard.type(cm_input(exact))
        tab_to(page, dlg.get_by_role("button", name="Save", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: cm(exact) in row(page, obj["title"]).inner_text() and focused(h), UI_MS, "phone ledger")
        assert placement(app_url, pl["id"])["offsetMm"] == exact
        eventually(other, lambda: cm(exact) in row(other, obj["title"]).inner_text(), LIVE_UPDATE_MS, "desk follows")
    discard(app_url, pl["id"])


def test_remove_with_server_undo(app_url):
    obj, pl = placed_work(app_url, "Remove")
    data = ok(api("DELETE", app_url, f"/api/placements/{pl['id']}", CUR))
    assert data["placement"]["status"] == "removed" and data["undo"]["kind"] == "remove"
    assert 0 < data["undo"]["remainingMs"] <= UNDO_WINDOW_MS
    assert iso(data["undo"]["undoUntil"]) > datetime.now().astimezone() - timedelta(days=36500)
    assert placement(app_url, pl["id"]) is None
    back = ok(api("POST", app_url, f"/api/undo/{data['undo']['actionId']}", CUR))["placement"]
    assert back["id"] == pl["id"] and back["status"] == "proposed" and back["offsetMm"] == pl["offsetMm"]
    assert back["version"] > data["placement"]["version"]
    err(api("POST", app_url, f"/api/undo/{data['undo']['actionId']}", CUR), 409, "already_undone")
    again = ok(api("DELETE", app_url, f"/api/placements/{pl['id']}", CUR))
    wait_out(app_url, again["undo"]["remainingMs"] / 1000 + 0.5)
    err(api("POST", app_url, f"/api/undo/{again['undo']['actionId']}", CUR), 410, "undo_expired")
    assert placement(app_url, pl["id"]) is None
    kinds = [e["kind"] for e in events_after(app_url, data["seq"] - 1) if e["placementId"] == pl["id"]]
    assert kinds == ["placement.removed", "placement.restored", "placement.removed"]
    obj2, pl2 = placed_work(app_url, "Return")
    gone_ = ok(api("DELETE", app_url, f"/api/placements/{pl2['id']}", CUR))
    blocker = new_object(app_url, "Blocker")
    pb = ok(place(app_url, blocker, "wall-north", pl2["offsetMm"]), 201)["placement"]
    e = err(api("POST", app_url, f"/api/undo/{gone_['undo']['actionId']}", CUR), 422, "placement_rejected")
    assert e["reason"] == "too_close" and e["message"] == f"Too close to {blocker['title']}: keep at least 20 cm between works.", e
    assert placement(app_url, pl2["id"]) is None
    discard(app_url, pb["id"])


def test_undo_move(app_url):
    obj, pl = placed_work(app_url, "Undo move", room=GAP_MM)
    moved = ok(move(app_url, pl, offsetMm=pl["offsetMm"] + 100))
    assert moved["undo"]["kind"] == "move" and 0 < moved["undo"]["remainingMs"] <= UNDO_WINDOW_MS
    back = ok(api("POST", app_url, f"/api/undo/{moved['undo']['actionId']}", CUR))["placement"]
    assert back["offsetMm"] == pl["offsetMm"] and back["version"] == moved["placement"]["version"] + 1
    first = ok(move(app_url, back, offsetMm=pl["offsetMm"] + 50))
    ok(move(app_url, first["placement"], offsetMm=pl["offsetMm"] + 70))
    err(api("POST", app_url, f"/api/undo/{first['undo']['actionId']}", RUTH), 403, "forbidden")
    err(api("POST", app_url, f"/api/undo/{first['undo']['actionId']}", CUR), 409, "undo_conflict")
    assert placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"] + 70
    discard(app_url, pl["id"])


def toast_seconds(page: Page) -> int | None:
    m = re.search(r"(\d+) s left", text_of(page.get_by_role("region", name="Undo")))
    return int(m.group(1)) if m else None


def test_undo_toast_survives(browser, app_url):
    obj, pl = placed_work(app_url, "Toast")
    spare = new_object(app_url, "Spare")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.click()
        remove = page.get_by_role("region", name="Inspector").get_by_role("button", name="Remove from wall", exact=True)
        shows(page, remove)
        with page.expect_response(lambda r: r.request.method == "DELETE" and pl["id"] in r.url) as info:
            remove.click()
        rem = info.value.json()["undo"]["remainingMs"]
        t0 = page_now(page)
        toast = page.get_by_role("region", name="Undo")

        def counting() -> bool:
            want = math.ceil((rem - (page_now(page) - t0)) / 1000)
            return f"{obj['title']} removed." in text_of(toast) and toast_seconds(page) in (want, want + 1)

        eventually(page, counting, UI_MS, "toast from server time")
        advance(page, 1500)
        assert counting()
        page.keyboard.press("2")
        settled(page)
        assert counting()
        page.keyboard.press("1")
        settled(page)
        assert counting()
        card_button(page, spare["title"], "Place").click()
        shows(page, page.get_by_role("dialog", name="Place work"))
        page.keyboard.press("Escape")
        assert counting()
        new_object(app_url, "Refresh")
        advance(page, EVENTS_POLL_MS + STEP_TOL_MS)
        assert counting()
        left = rem - (page_now(page) - t0)
        advance(page, max(left - 500, 0))
        assert toast.is_visible() and counting()
        eventually(page, lambda: gone(toast), 1000, "toast closes at zero")
    assert placement(app_url, pl["id"]) is None


def test_undo_by_keyboard(browser, app_url):
    obj, pl = placed_work(app_url, "Keys")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.click()
        remove = page.get_by_role("region", name="Inspector").get_by_role("button", name="Remove from wall", exact=True)
        tab_to(page, remove)
        page.keyboard.press("Enter")
        undo = page.get_by_role("region", name="Undo").get_by_role("button", name="Undo", exact=True)
        eventually(page, lambda: focused(undo), UI_MS, "focus on Undo")
        assert f"{obj['title']} removed from North wall." in text_of(said(page))
        page.keyboard.press("Shift+Tab")
        tab_to(page, undo)
        page.keyboard.press("Control+z")
        eventually(page, lambda: focused(handle(page, obj["title"])), UI_MS, "focus on restored handle")
        assert f"Undone: {obj['title']} is back where it was." in text_of(said(page))
        assert placement(app_url, pl["id"])["status"] == "proposed"
        handle(page, obj["title"]).click()
        again = page.get_by_role("region", name="Inspector").get_by_role("button", name="Remove from wall", exact=True)
        shows(page, again)
        again.click()
        eventually(page, lambda: focused(undo), UI_MS, "focus on Undo again")
        advance(page, UNDO_WINDOW_MS)
        eventually(page, lambda: focused(page.get_by_role("heading", name="Scene ledger")), UI_MS, "focus on ledger heading")
    assert placement(app_url, pl["id"]) is None


def _remove_undo_seen(browser, app_url, observer_size):
    obj, pl = placed_work(app_url, "Seen")
    with workspace(browser, app_url, CUR, size=observer_size) as other, workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        shows(other, handle(other, obj["title"]))
        h.click()
        remove = page.get_by_role("region", name="Inspector").get_by_role("button", name="Remove from wall", exact=True)
        real_target(remove)
        pointer_click(remove)
        undo = page.get_by_role("button", name="Undo", exact=True)
        eventually(page, lambda: focused(undo), UI_MS, "Undo focus")
        real_target(undo)
        eventually(other, lambda: handle(other, obj["title"]).count() == 0
                   and f"Ines Calloway removed {obj['title']} from North wall." in text_of(team(other)), LIVE_UPDATE_MS, "removal seen")
        assert placement(app_url, pl["id"]) is None
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(handle(page, obj["title"])), UI_MS, "restored")
        eventually(other, lambda: handle(other, obj["title"]).count() == 1
                   and f"Ines Calloway put {obj['title']} back on North wall." in text_of(team(other)), LIVE_UPDATE_MS, "undo seen")
        assert placement(app_url, pl["id"])["status"] == "proposed"
    discard(app_url, pl["id"])


def test_wf_remove_undo_desk(browser, app_url):
    _remove_undo_seen(browser, app_url, DESK)


def test_wf_remove_undo_tablet(browser, app_url):
    _remove_undo_seen(browser, app_url, TABLET)


def test_one_claim_wins(app_url):
    for _ in range(3):
        obj, pl = placed_work(app_url, "Race", wall_id="wall-south")
        with ThreadPoolExecutor(2) as pool:
            results = list(pool.map(lambda s: (s, act(app_url, pl["id"], "claim", s)), [RUTH, DEV]))
        wins = [(s, r) for s, r in results if r.status_code == 200]
        losses = [(s, r) for s, r in results if r.status_code != 200]
        assert len(wins) == 1 and len(losses) == 1, [(s, r.status_code) for s, r in results]
        winner = wins[0][0]
        e = err(losses[0][1], 409, "already_claimed")
        assert e["claimedBy"] == {"id": winner, "name": NAMES[winner]}
        now = placement(app_url, pl["id"])
        assert now["claimedBy"]["id"] == winner and now["status"] == "claimed"
        claimed = [x for x in events_after(app_url, wins[0][1].json()["seq"] - 1)
                   if x["placementId"] == pl["id"] and x["kind"] == "placement.claimed"]
        assert len(claimed) == 1
        act(app_url, pl["id"], "release", winner)
        discard(app_url, pl["id"])


def test_no_lost_updates(app_url):
    obj, pl = placed_work(app_url, "Lost", wall_id="wall-south", room=GAP_MM)
    c = ok(act(app_url, pl["id"], "claim", RUTH))["placement"]
    for k in ("wallId", "offsetMm", "centreHeightMm", "heightOverride"):
        assert c[k] == pl[k]
    newer = ok(move(app_url, c, RUTH, offsetMm=c["offsetMm"] + 30))["placement"]
    e = err(move(app_url, c, RUTH, offsetMm=c["offsetMm"] + 90), 412, "stale_version")
    assert e["placement"]["offsetMm"] == newer["offsetMm"] and e["placement"]["version"] == newer["version"]
    assert placement(app_url, pl["id"])["offsetMm"] == newer["offsetMm"]
    act(app_url, pl["id"], "release", RUTH)
    discard(app_url, pl["id"])


def test_lost_claim_in_place(browser, app_url):
    obj, pl = placed_work(app_url, "Ganseys", wall_id="wall-south")
    with workspace(browser, app_url, DEV) as page:
        claim = card_button(page, obj["title"], "Claim")
        shows(page, claim)
        with held(page, "**/api/events**"):
            ok(act(app_url, pl["id"], "claim", RUTH))
            claim.focus()
            page.keyboard.press("Enter")
            c = card(page, obj["title"])
            eventually(page, lambda: "Claimed by Ruth Okonkwo-Hale" in text_of(c)
                       and f"Ruth Okonkwo-Hale claimed {obj['title']} first." in text_of(said(page)), UI_MS, "lost claim")
            assert card_button(page, obj["title"], "Claim").count() == 0
            eventually(page, lambda: focused(c.get_by_role("heading", level=3, name=obj["title"])), UI_MS, "focus on card title")
    assert placement(app_url, pl["id"])["claimedBy"]["id"] == RUTH
    act(app_url, pl["id"], "release", RUTH)
    discard(app_url, pl["id"])


def test_one_request_per_claim_press(browser, app_url):
    obj, pl = placed_work(app_url, "Double", wall_id="wall-south")
    with workspace(browser, app_url, RUTH) as page:
        claim = card_button(page, obj["title"], "Claim")
        shows(page, claim)
        sent = requests_seen(page, "POST", f"/api/placements/{pl['id']}/claim")
        with held(page, f"**/api/placements/{pl['id']}/claim") as hold:
            claim.click()
            claim.click(force=True)
            claim.click(force=True)
            assert len(sent) == 1
            hold.release()
        eventually(page, lambda: card_button(page, obj["title"], "Mark hung").count() == 1, UI_MS, "claim won")
        assert len(sent) == 1
    assert placement(app_url, pl["id"])["claimedBy"]["id"] == RUTH
    act(app_url, pl["id"], "release", RUTH)
    discard(app_url, pl["id"])


def test_wf_claim_race_two_phones(browser, app_url):
    obj, pl = placed_work(app_url, "Two phones", wall_id="wall-south")
    with workspace(browser, app_url, RUTH, size=PHONE) as a, workspace(browser, app_url, DEV, size=PHONE) as b:
        sent = {RUTH: requests_seen(a, "POST", "/claim"), DEV: requests_seen(b, "POST", "/claim")}
        for p in (a, b):
            open_rail(p)
            shows(p, card_button(p, obj["title"], "Claim"))
            real_target(card_button(p, obj["title"], "Claim"))
        glob = f"**/api/placements/{pl['id']}/claim"
        with held(a, glob) as hold_a, held(b, glob) as hold_b:
            card_button(a, obj["title"], "Claim").click(no_wait_after=True)
            card_button(b, obj["title"], "Claim").click(no_wait_after=True)
            card_button(b, obj["title"], "Claim").click(force=True, no_wait_after=True)
            hold_a.release()
            hold_b.release()
        winner = wait_real(lambda: (p := placement(app_url, pl["id"]))["claimedBy"] and p["claimedBy"]["id"], REAL_WAIT_S, "claim committed")
        win, lose = (a, b) if winner == RUTH else (b, a)
        loser = DEV if winner == RUTH else RUTH
        eventually(win, lambda: focused(card_button(win, obj["title"], "Mark hung"))
                   and f"You claimed {obj['title']}." in text_of(said(win)), UI_MS, "winner")
        eventually(lose, lambda: f"Claimed by {NAMES[winner]}" in text_of(card(lose, obj["title"]))
                   and f"{NAMES[winner]} claimed {obj['title']} first." in text_of(said(lose))
                   and focused(card(lose, obj["title"]).get_by_role("heading", level=3)), UI_MS, "loser")
        assert len(sent[winner]) == 1 and len(sent[loser]) == 1
    act(app_url, pl["id"], "release", winner)
    discard(app_url, pl["id"])


def test_wf_claim_race_own_sessions(browser, app_url):
    obj, pl = placed_work(app_url, "Laptop", wall_id="wall-south")
    with workspace(browser, app_url, RUTH) as laptop, workspace(browser, app_url, CUR) as desk, \
            workspace(browser, app_url, RUTH, size=PHONE) as phone:
        open_rail(phone)
        btn = card_button(phone, obj["title"], "Claim")
        tab_to(phone, btn)
        phone.keyboard.press("Enter")
        eventually(phone, lambda: focused(card_button(phone, obj["title"], "Mark hung")), UI_MS, "won on phone")
        for p in (laptop, desk):
            eventually(p, lambda p=p: "Claimed by Ruth Okonkwo-Hale" in text_of(card(p, obj["title"]))
                       and f"Ruth Okonkwo-Hale claimed {obj['title']}." in text_of(team(p)), LIVE_UPDATE_MS, "claim reaches session")
        extra, extra_pl = placed_work(app_url, "Arrival", wall_id="wall-north")
        eventually(desk, lambda: handle(desk, extra["title"]).count() == 1, LIVE_UPDATE_MS, "update delivered")
        advance(phone, LIVE_UPDATE_MS)
        assert focused(card_button(phone, obj["title"], "Mark hung"))
    assert placement(app_url, pl["id"])["claimedBy"] == {"id": RUTH, "name": NAMES[RUTH]}
    act(app_url, pl["id"], "release", RUTH)
    discard(app_url, pl["id"], extra_pl["id"])


def test_placement_lifecycle(app_url):
    obj, pl = placed_work(app_url, "Lifecycle", wall_id="wall-south")
    pid = pl["id"]
    err(act(app_url, pid, "sign-off", REG), 409, "illegal_transition")
    c = ok(act(app_url, pid, "claim", RUTH))
    assert c["placement"]["status"] == "claimed" and c["placement"]["version"] == 2
    same = ok(act(app_url, pid, "claim", RUTH))
    assert same["placement"]["version"] == 2
    taken = err(act(app_url, pid, "claim", DEV), 409, "already_claimed")
    assert taken["claimedBy"] == {"id": RUTH, "name": NAMES[RUTH]}, taken
    err(api("DELETE", app_url, f"/api/placements/{pid}", CUR), 409, "illegal_transition")
    err(act(app_url, pid, "sign-off", REG), 409, "illegal_transition")
    r = ok(act(app_url, pid, "release", RUTH))["placement"]
    assert r["status"] == "proposed" and r["claimedBy"] is None and r["version"] == 3
    ok(act(app_url, pid, "claim", RUTH))
    hung = ok(act(app_url, pid, "hang", RUTH))["placement"]
    assert hung["status"] == "hung" and hung["version"] == 5
    for verb, staff in (("hang", RUTH), ("release", RUTH), ("claim", DEV)):
        err(act(app_url, pid, verb, staff), 409, "illegal_transition")
    err(api("DELETE", app_url, f"/api/placements/{pid}", CUR), 409, "illegal_transition")
    err(move(app_url, hung, CUR, offsetMm=hung["offsetMm"] + 10), 409, "placement_locked")
    err(move(app_url, hung, DEV, offsetMm=hung["offsetMm"] + 10), 409, "placement_locked")
    ok(upload(app_url, obj["id"], png_bytes(obj["id"]), "image/png"), 201)
    done = ok(act(app_url, pid, "sign-off", REG))["placement"]
    assert done["status"] == "signed_off" and done["version"] == 6
    err(act(app_url, pid, "sign-off", REG), 409, "illegal_transition")
    err(act(app_url, pid, "claim", DEV), 409, "illegal_transition")
    kinds = [e["kind"] for e in events_after(app_url, c["seq"] - 1) if e["placementId"] == pid]
    assert kinds == ["placement.claimed", "placement.released", "placement.claimed", "placement.hung", "placement.signed_off"]


def test_role_permissions(app_url):
    obj2, q = placed_work(app_url, "Held", wall_id="wall-south")
    obj, p = placed_work(app_url, "Roles", wall_id="wall-south", room=GAP_MM)
    q = ok(act(app_url, q["id"], "claim", RUTH))["placement"]
    spare = new_object(app_url, "Unplaced")
    off = free_slot(app_url, "wall-south", spare["widthMm"]) + spare["widthMm"] // 2
    moved = ok(move(app_url, p, CUR, offsetMm=p["offsetMm"] + 10))
    p = moved["placement"]
    cases = [
        lambda: place(app_url, spare, "wall-south", off, staff=REG),
        lambda: place(app_url, spare, "wall-south", off, staff=RUTH),
        lambda: act(app_url, p["id"], "claim", REG),
        lambda: act(app_url, p["id"], "claim", CUR),
        lambda: api("DELETE", app_url, f"/api/placements/{p['id']}", RUTH),
        lambda: api("DELETE", app_url, f"/api/placements/{p['id']}", REG),
        lambda: move(app_url, p, RUTH, offsetMm=p["offsetMm"] + 10),
        lambda: move(app_url, q, CUR, offsetMm=q["offsetMm"] + 10),
        lambda: move(app_url, q, DEV, offsetMm=q["offsetMm"] + 10),
        lambda: move(app_url, q, RUTH, wallId="wall-north"),
        lambda: act(app_url, q["id"], "release", DEV),
        lambda: act(app_url, q["id"], "hang", DEV),
        lambda: act(app_url, q["id"], "hang", CUR),
        lambda: act(app_url, q["id"], "sign-off", CUR),
        lambda: api("PATCH", app_url, "/api/walls/wall-west", RUTH, {"plannedLux": 150}),
        lambda: api("PATCH", app_url, "/api/walls/wall-west", REG, {"plannedLux": 150}),
        lambda: api("POST", app_url, "/api/objects", CUR, {"title": "x"}),
        lambda: api("PATCH", app_url, f"/api/objects/{spare['id']}", RUTH, {"registrarNote": "x"}),
        lambda: upload(app_url, spare["id"], png_bytes("roles"), "image/png", staff=CUR),
        lambda: api("POST", app_url, "/api/preview/schedule", REG, {"date": WINTER_DATE.isoformat()}),
        lambda: api("POST", app_url, "/api/preview/cancel", RUTH),
        lambda: api("POST", app_url, "/api/preview/withdraw", REG),
        lambda: api("POST", app_url, f"/api/undo/{moved['undo']['actionId']}", RUTH),
    ]
    for i, call in enumerate(cases):
        r = call()
        assert r.status_code == 403 and r.json()["error"]["code"] == "forbidden", (i, r.status_code, r.text[:200])
    err(api("GET", app_url, "/api/placements"), 401, "unknown_staff")
    err(api("GET", app_url, "/api/placements", "nobody-here"), 401, "unknown_staff")
    assert placement(app_url, p["id"])["version"] == p["version"]
    assert placement(app_url, q["id"])["claimedBy"]["id"] == RUTH and placement(app_url, q["id"])["version"] == q["version"]
    assert not obj_get(app_url, spare["id"])["photos"] and obj_get(app_url, spare["id"])["placementId"] is None
    act(app_url, q["id"], "release", RUTH)
    discard(app_url, p["id"], q["id"])


def test_sign_off_guards(browser, app_url):
    obj, pl = placed_work(app_url, "Lighthouse", wall_id="wall-south")
    lux = pl["plannedLux"]
    ok(act(app_url, pl["id"], "claim", DEV))
    ok(act(app_url, pl["id"], "hang", DEV))
    other, op = placed_work(app_url, "Guard", wall_id="wall-south")
    ok(act(app_url, op["id"], "claim", DEV))
    ok(act(app_url, op["id"], "hang", DEV))
    ok(api("PATCH", app_url, f"/api/objects/{other['id']}", REG, {"luxHourBudget": 1}))
    err(act(app_url, op["id"], "sign-off", REG), 409, "condition_not_recorded")
    with workspace(browser, app_url, REG) as page:
        sign = card_button(page, obj["title"], "Sign off")
        shows(page, sign)
        sign.click()
        heading = card(page, obj["title"]).get_by_role("heading", level=3)
        eventually(page, lambda: f"Add a condition photo before signing off {obj['title']}." in text_of(said(page))
                   and focused(heading), UI_MS, "no-photo refusal")
        err(act(app_url, pl["id"], "sign-off", REG), 409, "condition_not_recorded")
        ok(upload(app_url, obj["id"], png_bytes(obj["id"]), "image/png"), 201)
        ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxHourBudget": lux * OPEN_HOURS - 1}))
        eventually(page, lambda: "1 condition photo" in text_of(card(page, obj["title"])), LIVE_UPDATE_MS, "photo count")
        err(act(app_url, pl["id"], "sign-off", REG), 409, "over_budget")
        sign.click()
        eventually(page, lambda: f"{obj['title']} is over its light budget and can't be signed off." in text_of(said(page))
                   and focused(heading), UI_MS, "over-budget refusal")
        ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxHourBudget": lux * OPEN_HOURS}))
        eventually(page, lambda: "Within limit" in row(page, obj["title"]).inner_text(), LIVE_UPDATE_MS, "back within")
        sign.click()
        eventually(page, lambda: f"{obj['title']} signed off." in text_of(said(page))
                   and "Signed off" in text_of(card(page, obj["title"])), UI_MS, "signed off")
    assert placement(app_url, pl["id"])["status"] == "signed_off"
    assert obj_get(app_url, obj["id"])["conditionRecorded"] is True


def _install_day(browser, app_url, size):
    obj, pl = placed_work(app_url, "Install", wall_id="wall-south")
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, RUTH, size=size) as page:
        def rail_open():
            btn = page.get_by_role("button", name="Objects", exact=True)
            if size != DESK:
                tab_to(page, btn)
                page.keyboard.press("Enter")
                eventually(page, lambda: holds_focus(rail(page)), UI_MS, "drawer open")

        rail_open()
        real_target(card_button(page, obj["title"], "Claim"))
        if size != DESK:
            real_target(card(page, obj["title"]).get_by_role("link", name="Open record", exact=True))
        tab_to(page, card_button(page, obj["title"], "Claim"))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(card_button(page, obj["title"], "Mark hung")), UI_MS, "focus on Mark hung")
        assert "Claimed by Ruth Okonkwo-Hale" in text_of(card(page, obj["title"]))
        eventually(other, lambda: "Claimed by Ruth Okonkwo-Hale" in text_of(card(other, obj["title"])), LIVE_UPDATE_MS, "claim seen")
        page.keyboard.press("Enter")
        heading = card(page, obj["title"]).get_by_role("heading", level=3)
        eventually(page, lambda: focused(heading) and "Hung" in text_of(card(page, obj["title"]))
                   and f"{obj['title']} marked hung." in text_of(said(page)), UI_MS, "hung")
        assert placement(app_url, pl["id"])["status"] == "hung"
        eventually(other, lambda: f"Ruth Okonkwo-Hale marked {obj['title']} hung." in text_of(team(other)), LIVE_UPDATE_MS, "hung seen")
        extra, extra_pl = placed_work(app_url, "Visitor", wall_id="wall-north")
        eventually(other, lambda: handle(other, extra["title"]).count() == 1, LIVE_UPDATE_MS, "update delivered")
        advance(page, LIVE_UPDATE_MS)
        assert focused(heading)
        if size != DESK:
            assert rail(page).count() == 1
        discard(app_url, extra_pl["id"])
        if size != DESK:
            page.keyboard.press("Escape")
        eventually(page, lambda: "Hung" in row(page, obj["title"]).inner_text(), UI_MS, "ledger hung")
        ok(upload(app_url, obj["id"], jpeg_bytes(obj["id"]), "image/jpeg"), 201)
        select(page.get_by_role("combobox", name="Working as"), f"{NAMES[REG]} ({ROLES[REG]})")
        rail_open()
        tab_to(page, card_button(page, obj["title"], "Sign off"))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(card(page, obj["title"]).get_by_role("heading", level=3))
                   and "Signed off" in text_of(card(page, obj["title"])), UI_MS, "signed off")
        if size != DESK:
            page.keyboard.press("Escape")
        eventually(page, lambda: "Signed off" in row(page, obj["title"]).inner_text(), UI_MS, "ledger signed off")
        eventually(other, lambda: f"Tomasz Adeyemi signed off {obj['title']}." in text_of(team(other))
                   and "Signed off" in row(other, obj["title"]).inner_text(), LIVE_UPDATE_MS, "sign-off seen")
    assert placement(app_url, pl["id"])["status"] == "signed_off"


def test_wf_install_signoff_desk(browser, app_url):
    _install_day(browser, app_url, DESK)


def test_wf_install_signoff_tablet(browser, app_url):
    _install_day(browser, app_url, TABLET)


def test_condition_photo_upload(app_url):
    obj = new_object(app_url, "Photo")
    for payload, ctype, ext in ((jpeg_bytes(obj["id"]), "image/jpeg", "jpg"), (png_bytes(obj["id"]), "image/png", "png")):
        data = ok(upload(app_url, obj["id"], payload, ctype), 201)
        ph = data["photo"]
        assert ph["objectId"] == obj["id"] and ph["bytes"] in (len(payload), base64.b64encode(payload).decode()) and ph["contentType"] == ctype
        assert ph["sha256"] == hashlib.sha256(payload).hexdigest()
        assert ph["key"] == f"condition/{obj['id']}/{ph['id']}.{ext}" and ph["key"] in S3().keys(f"condition/{obj['id']}/")
    err(upload(app_url, obj["id"], b"GIF89a", "image/gif"), 415, "unsupported_media_type")
    empty = err(upload(app_url, obj["id"], b"", "image/png"), 422, "validation_failed")
    assert isinstance(empty.get("fields"), dict) and empty["fields"], empty
    big = png_bytes(f"big-{obj['id']}", PHOTO_LIMIT)
    assert upload(app_url, obj["id"], big, "image/png").status_code == 201
    err(upload(app_url, obj["id"], big + b"\x00", "image/png"), 413, "body_too_large")
    err(upload(app_url, obj["id"], big + b"\x00", "image/png", staff=""), 413, "body_too_large")
    record = obj_get(app_url, obj["id"])
    assert len(record["photos"]) == 3 and record["conditionRecorded"] is True
    assert len(S3().keys(f"condition/{obj['id']}/")) == 3


def test_photos_kept_as_uploaded(app_url):
    obj = new_object(app_url, "Bytes")
    for payload, ctype in ((jpeg_bytes("exif " + obj["id"]), "image/jpeg"), (png_bytes("text " + obj["id"]), "image/png")):
        ph = ok(upload(app_url, obj["id"], payload, ctype), 201)["photo"]
        assert S3().get(ph["key"]) == payload
        got = api("GET", app_url, f"/api/objects/{obj['id']}/photos/{ph['id']}", CUR)
        assert got.status_code == 200 and got.content == payload
        assert got.headers["content-type"].startswith(ctype)


def test_photo_upload_replay(app_url):
    obj = new_object(app_url, "Replay")
    key = idempotency_key()
    payload = png_bytes(obj["id"])
    first = upload(app_url, obj["id"], payload, "image/png", key)
    data = ok(first, 201)
    again = upload(app_url, obj["id"], payload, "image/png", key)
    assert again.status_code == 201 and again.json() == data
    err(upload(app_url, obj["id"], png_bytes("other" + obj["id"]), "image/png", key), 409, "idempotency_conflict")
    assert len(obj_get(app_url, obj["id"])["photos"]) == 1
    assert len(S3().keys(f"condition/{obj['id']}/")) == 1
    attached = [e for e in events_after(app_url, data["seq"] - 1) if e["objectId"] == obj["id"] and e["kind"] == "photo.attached"]
    assert len(attached) == 1


def test_attached_only_after_confirmation(browser, app_url):
    obj = new_object(app_url, "Pending photo")
    with workspace(browser, app_url, REG) as page:
        c = card(page, obj["title"])
        shows(page, c, "No condition photo")
        picker = page.get_by_label(f"Condition photo for {obj['title']}")
        with held(page, f"**/api/objects/{obj['id']}/photos") as hold:
            picker.focus()
            picker.set_input_files({"name": "condition.png", "mimeType": "image/png", "buffer": png_bytes(obj["id"])})
            eventually(page, lambda: "Uploading condition photo..." in text_of(c), UI_MS, "uploading message")
            assert "1 condition photo" not in text_of(c) and "condition photos" not in text_of(c)
            assert not obj_get(app_url, obj["id"])["photos"]
            hold.release()
        eventually(page, lambda: "1 condition photo" in text_of(c)
                   and f"Condition photo attached to {obj['title']}." in text_of(said(page)), UI_MS, "attached")
        assert focused(picker)
    assert len(obj_get(app_url, obj["id"])["photos"]) == 1


def test_wf_condition_photos_phone(browser, app_url):
    obj = new_object(app_url, "Sheet photo")
    payload = jpeg_bytes(obj["id"])
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, REG, size=PHONE) as page:
        choosers = []
        page.on("filechooser", lambda fc: choosers.append(fc))
        objects = page.get_by_role("button", name="Objects", exact=True)
        assert tappable(objects)
        center(objects)
        tab_to(page, objects)
        page.keyboard.press("Enter")
        picker = page.get_by_label(f"Condition photo for {obj['title']}")
        tab_to(page, picker)
        page.keyboard.press("Enter")
        eventually(page, lambda: bool(choosers), UI_MS, "file chooser opened by Enter")
        choosers[0].set_files({"name": "condition.jpg", "mimeType": "image/jpeg", "buffer": payload})
        eventually(page, lambda: f"Condition photo attached to {obj['title']}." in text_of(said(page)), UI_MS, "attached")
        photos = obj_get(app_url, obj["id"])["photos"]
        assert len(photos) == 1 and S3().get(photos[0]["key"]) == payload
        eventually(other, lambda: "1 condition photo" in text_of(card(other, obj["title"]))
                   and f"Tomasz Adeyemi attached a condition photo to {obj['title']}." in text_of(team(other)), LIVE_UPDATE_MS, "count seen")


def test_wf_condition_photos_outage(browser):
    base = env_url("APP_IMAGE_STORE_DOWN_URL")
    obj = new_object(base, "Outage photo")
    key = idempotency_key()
    err(upload(base, obj["id"], png_bytes(obj["id"]), "image/png", key), 503, "image_store_unavailable")
    err(upload(base, obj["id"], png_bytes(obj["id"]), "image/png", key), 503, "image_store_unavailable")
    err(upload(base, obj["id"], b"GIF89a", "image/gif"), 415, "unsupported_media_type")
    err(upload(base, obj["id"], b"", "image/png"), 422, "validation_failed")
    record = obj_get(base, obj["id"])
    assert record["photos"] == [] and record["conditionRecorded"] is False
    assert services(base)["imageStore"] == "down"
    health = api("GET", base, "/api/health")
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    with workspace(browser, base, REG) as page:
        shows(page, page.get_by_role("alert").filter(has_text=IMG_BANNER), IMG_BANNER, budget_ms=BANNER_DOWN_MS)
        c = card(page, obj["title"])
        page.get_by_label(f"Condition photo for {obj['title']}").set_input_files(
            {"name": "condition.png", "mimeType": "image/png", "buffer": png_bytes(obj["id"])})
        eventually(page, lambda: f"Condition photo not attached to {obj['title']}. The image store is unavailable." in text_of(said(page)),
                   UI_MS, "failure sentence")
        assert "No condition photo" in text_of(c) and "1 condition photo" not in text_of(c)
        off = free_slot(base, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
        assert place(base, obj, "wall-north", off).status_code == 201
        note = "Hang on fabric batten only."
        assert ok(api("PATCH", base, f"/api/objects/{obj['id']}", REG, {"registrarNote": note}))["object"]["registrarNote"] == note
    assert obj_get(base, obj["id"])["photos"] == []


def test_register_object(app_url):
    tag = tag_of("reg")
    body = {"objectNumber": f"L-{tag}", "title": f"Register {tag}", "medium": "Ink on vellum", "lenderId": "lender-fenwick",
            "width": 30, "height": 24, "unit": "in", "luxLimit": 50, "luxHourBudget": 30000,
            "insuranceValueGbp": 15000, "registrarNote": f"Note {tag}"}
    data = ok(api("POST", app_url, "/api/objects", REG, body), 201)
    o = data["object"]
    assert isinstance(data["seq"], int)
    for k in ("objectNumber", "title", "medium", "lenderId", "luxLimit", "luxHourBudget", "insuranceValueGbp", "registrarNote"):
        assert o[k] == body[k], k
    assert o["lenderName"] == "Fenwick Maritime Trust" and o["photos"] == [] and o["conditionRecorded"] is False
    assert o["placementId"] is None and o["placementStatus"] is None
    assert obj_get(app_url, o["id"]) == o
    listed = ok(api("GET", app_url, f"/api/objects?q={body['objectNumber']}", CUR))["objects"]
    assert [x["id"] for x in listed] == [o["id"]]
    created = [e for e in events_after(app_url, data["seq"] - 1) if e["objectId"] == o["id"]]
    assert created[0]["kind"] == "object.created" and created[0]["title"] == body["title"]


UNIT_CASES = {"cm_one_decimal": ("cm", 76.2), "in_whole": ("in", 30), "in_half_up": ("in", 2.5), "in_two_decimals": ("in", 12.34), "cm_20_metres": ("cm", 2000), "cm_two_decimals": ("cm", 10.25), "in_three_decimals": ("in", 1.125), "zero": ("cm", 0), "over_20_metres": ("cm", 2000.1), "bad_unit": ("mm", 10)}


@pytest.mark.parametrize("case", list(UNIT_CASES), ids=list(UNIT_CASES))
def test_dimension_units(app_url, case):
    unit, value = UNIT_CASES[case]
    tag = tag_of("unit")
    body = {"objectNumber": f"U-{tag}", "title": f"Units {tag}", "medium": "", "lenderId": None, "width": value, "height": value,
            "unit": unit, "luxLimit": 50, "luxHourBudget": 30000, "insuranceValueGbp": 100, "registrarNote": ""}
    r = api("POST", app_url, "/api/objects", REG, body)
    if unit == "mm":
        assert err(r, 422, "validation_failed")["fields"]["unit"] == "Choose cm or in."
        return
    exact = Decimal(str(value)) * (Decimal(10) if unit == "cm" else Decimal("25.4"))
    places = -Decimal(str(value)).as_tuple().exponent
    mm = int(exact.quantize(Decimal(1), rounding=ROUND_HALF_UP))
    valid = places <= (1 if unit == "cm" else 2) and 1 <= mm <= 20_000
    if valid:
        o = ok(r, 201)["object"]
        assert o["widthMm"] == mm and o["heightMm"] == mm
    else:
        fields = err(r, 422, "validation_failed")["fields"]
        assert fields["width"] == WIDTH_MSG
        assert fields["height"] == "Enter a height above 0 and up to 20 metres, with at most 1 decimal in cm or 2 in inches."


def test_unit_toggle_no_drift(browser, app_url):
    obj = new_object(app_url, "Thirty", w=30, h=24, unit="in")
    assert (obj["widthMm"], obj["heightMm"]) == (762, 610)
    with workspace(browser, app_url, REG, path=f"/records/{obj['id']}") as page:
        main = page.get_by_role("main")
        shows(page, page.get_by_role("heading", level=1, name=obj["title"]))
        units = page.get_by_role("radiogroup", name="Units")
        for _ in range(3):
            units.get_by_role("radio", name="cm", exact=True).click()
            eventually(page, lambda: "76.2" in main.inner_text() and "61.0" in main.inner_text(), UI_MS, "cm figures")
            assert "30.0" not in main.inner_text()
            units.get_by_role("radio", name="in", exact=True).click()
            eventually(page, lambda: "30.0" in main.inner_text() and "24.0" in main.inner_text(), UI_MS, "inch figures")
            assert "76.2" not in main.inner_text()


def test_object_field_errors(browser, app_url):
    used = new_object(app_url, "Used")
    bad = {"objectNumber": used["objectNumber"], "title": "", "medium": "m" * 121, "lenderId": "lender-nobody", "width": 1, "height": 1,
           "unit": "cm", "luxLimit": 0, "luxHourBudget": 0, "insuranceValueGbp": 1.5, "registrarNote": "n" * 2001}
    fields = err(api("POST", app_url, "/api/objects", REG, bad), 422, "validation_failed")["fields"]
    assert fields == {"title": "Enter a title.", "objectNumber": "That object number is already in use.",
                      "medium": "Keep the medium to 120 characters or fewer.", "lenderId": "Choose a lender or the Ashgrove collection.",
                      "luxLimit": "Enter a lux limit from 1 to 1000.", "luxHourBudget": "Enter a lux-hour budget from 1 to 10,000,000.",
                      "insuranceValueGbp": "Enter an insurance value in whole pounds.", "registrarNote": "Keep the note to 2000 characters or fewer."}
    empty = dict(bad, objectNumber="", title="x", medium="", lenderId=None, luxLimit=1, luxHourBudget=1, insuranceValueGbp=1, registrarNote="")
    assert err(api("POST", app_url, "/api/objects", REG, empty), 422, "validation_failed")["fields"] == {"objectNumber": "Enter an object number."}
    with workspace(browser, app_url, REG, path="/records") as page:
        add = page.get_by_role("button", name="Add object", exact=True)
        shows(page, add)
        add.click()
        dlg = page.get_by_role("dialog", name="Add object")
        shows(page, dlg)
        dlg.get_by_role("button", name="Save object", exact=True).click()
        summary = dlg.get_by_role("alert")
        eventually(page, lambda: holds_focus(summary), UI_MS, "summary focus")
        assert "Fix these to continue:" in summary.inner_text()
        for msg, field in (("Enter a title.", "Title"), ("Enter an object number.", "Object number")):
            assert dlg.get_by_text(msg, exact=True).count() >= 2
            summary.get_by_role("link", name=msg).click()
            eventually(page, lambda field=field: focused(dlg.get_by_role("textbox", name=field)), UI_MS, f"focus {field}")


def test_register_url_state(browser, app_url):
    tag = tag_of("url").lower()
    a = new_object(app_url, f"{tag} alpha", lender="lender-fenwick")
    b = new_object(app_url, f"{tag} beta", lender="lender-fenwick")
    titles = lambda page: [t for t in page.get_by_role("main").get_by_role("link").all_inner_texts() if tag in t]
    with workspace(browser, app_url, REG, path="/records") as page:
        box = page.get_by_role("searchbox", name="Search records")
        shows(page, box)
        box.focus()
        page.keyboard.type(tag)
        eventually(page, lambda: text_of(page.get_by_role("status", name="Records count")) == "2 records", SEARCH_DEBOUNCE_MS + UI_MS, "count")
        select(page.get_by_role("combobox", name="Lender filter"), "Fenwick Maritime Trust")
        select(page.get_by_role("combobox", name="Sort by"), "Title")
        page.get_by_role("radiogroup", name="Order").get_by_role("radio", name="Descending").click()
        eventually(page, lambda: titles(page) == [b["title"], a["title"]], UI_MS, "descending titles")
        qs = parse_qs(urlparse(page.url).query)
        assert qs == {"q": [tag], "lender": ["lender-fenwick"], "sort": ["title"], "dir": ["desc"]}
        page.reload()
        eventually(page, lambda: titles(page) == [b["title"], a["title"]], UI_MS, "after reload")
        assert page.get_by_role("searchbox", name="Search records").input_value() == tag
        assert page.get_by_role("radio", name="Descending").is_checked()
        page.go_back()
        eventually(page, lambda: titles(page) == [a["title"], b["title"]], UI_MS, "after Back")
        assert "dir" not in parse_qs(urlparse(page.url).query)
        assert page.get_by_role("radio", name="Ascending").is_checked()


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_register_layouts(browser, app_url, size):
    obj = new_object(app_url, "Layout", lender="lender-oduya")
    with workspace(browser, app_url, REG, size=VIEWPORTS[size], path=f"/records?q={obj['objectNumber']}") as page:
        shows(page, page.get_by_role("heading", level=1, name="Loan register"))
        real_target(page.get_by_role("button", name="Add object", exact=True))
        if size == "desk":
            table = page.get_by_role("table", name="Loan register")
            shows(page, table, obj["title"])
            assert [c.strip().casefold() for c in table.get_by_role("columnheader").all_inner_texts()] == [c.casefold() for c in LEDGER_COLUMNS]
            assert page.get_by_role("list", name="Loan register").count() == 0
        else:
            lst = page.get_by_role("list", name="Loan register")
            shows(page, lst, obj["title"])
            assert page.get_by_role("table", name="Loan register").count() == 0
            item = lst.get_by_role("listitem").filter(has_text=obj["title"]).first
            for label in LEDGER_COLUMNS:
                assert label.casefold() in item.inner_text().casefold()
            assert item.get_by_role("link", name=obj["title"]).get_attribute("href").endswith(f"/records/{obj['id']}")
        layout(page)


def test_search_latest_query(browser, app_url):
    tag = tag_of("srch").lower()
    a = new_object(app_url, f"Find {tag} alpha")
    b = new_object(app_url, f"Find {tag} beta")
    with workspace(browser, app_url, REG, path="/records") as page:
        box = page.get_by_role("searchbox", name="Search records")
        shows(page, box)
        parked = []

        def route(r):
            if parse_qs(urlparse(r.request.url).query).get("q") == [tag]:
                parked.append(r)
            else:
                r.continue_()

        page.route(re.compile(r"/api/objects\?"), route)
        box.focus()
        page.keyboard.type(tag)
        advance(page, SEARCH_DEBOUNCE_MS + STEP_TOL_MS)
        page.keyboard.type(" al")
        main = page.get_by_role("main")
        count = page.get_by_role("status", name="Records count")
        eventually(page, lambda: text_of(count) == "1 record" and a["title"] in main.inner_text(), SEARCH_DEBOUNCE_MS + UI_MS, "latest results")
        wait_real(lambda: parked, REAL_WAIT_S, "first query sent")
        parked[0].continue_()
        advance(page, UI_MS)
        assert text_of(count) == "1 record" and b["title"] not in main.inner_text()


def test_wf_object_records_add_by_keyboard(browser, app_url):
    tag = tag_of("kbd")
    title = f"Keyboard loan {tag}"
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, REG, path="/records") as page:
        units = page.get_by_role("radiogroup", name="Units")
        units.get_by_role("radio", name="in", exact=True).click()
        add = page.get_by_role("button", name="Add object", exact=True)
        tab_to(page, add)
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Add object")
        eventually(page, lambda: holds_focus(dlg), UI_MS, "dialog focus")
        values = {"Title": title, "Object number": f"K-{tag}", "Medium": "Linen", "Width": "30", "Height": "24",
                  "Lux limit": "50", "Lux-hour budget": "30000", "Insurance value": "8000", "Registrar note": "Keyboard"}
        for name, value in values.items():
            box = dlg.get_by_role("textbox", name=name, exact=True)
            tab_to(page, box)
            page.keyboard.press("Control+a")
            page.keyboard.type(value)
        select(dlg.get_by_role("combobox", name="Lender"), "Fenwick Maritime Trust")
        tab_to(page, dlg.get_by_role("button", name="Save object", exact=True))
        page.keyboard.press("Enter")
        heading = page.get_by_role("heading", level=1, name=title)
        eventually(page, lambda: focused(heading) and re.search(r"/records/[^/?#]+$", page.url), UI_MS, "record page")
        oid = urlparse(page.url).path.rsplit("/", 1)[1]
        o = obj_get(app_url, oid)
        assert (o["title"], o["widthMm"], o["heightMm"], o["lenderId"]) == (title, 762, 610, "lender-fenwick")
        assert f"{title} saved." in text_of(said(page))
        units.get_by_role("radio", name="cm", exact=True).click()
        eventually(page, lambda: "76.2" in page.get_by_role("main").inner_text() and "61.0" in page.get_by_role("main").inner_text(), UI_MS, "cm")
        eventually(other, lambda: card(other, title).count() == 1
                   and f"Tomasz Adeyemi added {title} to the loan register." in text_of(team(other)), LIVE_UPDATE_MS, "card in rail")


def test_wf_object_records_invalid_recovery(browser, app_url):
    tag = tag_of("half")
    title = f"Half filled {tag}"
    with workspace(browser, app_url, REG, path="/records") as page:
        add = page.get_by_role("button", name="Add object", exact=True)
        tab_to(page, add)
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Add object")
        fill_field(dlg.get_by_role("textbox", name="Title", exact=True), title)
        for name in ("Object number", "Lux limit", "Lux-hour budget"):
            fill_field(dlg.get_by_role("textbox", name=name, exact=True), "")
        tab_to(page, dlg.get_by_role("button", name="Save object", exact=True))
        page.keyboard.press("Enter")
        summary = dlg.get_by_role("alert")
        eventually(page, lambda: holds_focus(summary), UI_MS, "summary focus")
        for msg in ("Enter an object number.", "Enter a lux limit from 1 to 1000.", "Enter a lux-hour budget from 1 to 10,000,000."):
            assert summary.get_by_role("link", name=msg).count() == 1
        link = summary.get_by_role("link", name="Enter an object number.")
        tab_to(page, link)
        page.keyboard.press("Enter")
        number = dlg.get_by_role("textbox", name="Object number", exact=True)
        eventually(page, lambda: focused(number), UI_MS, "Object number focus")
        page.keyboard.type(f"H-{tag}")
        for name, value in {"Width": "40", "Height": "30", "Lux limit": "50", "Lux-hour budget": "30000", "Insurance value": "100"}.items():
            fill_field(dlg.get_by_role("textbox", name=name, exact=True), value)
        select(dlg.get_by_role("combobox", name="Lender"), "Ashgrove collection")
        tab_to(page, dlg.get_by_role("button", name="Save object", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(page.get_by_role("heading", level=1, name=title)), UI_MS, "saved")
    found = ok(api("GET", app_url, f"/api/objects?q=H-{tag}", REG))["objects"]
    assert [o["title"] for o in found] == [title] and found[0]["widthMm"] == 400


def test_tighter_limits_reflag(browser, app_url):
    obj, pl = placed_work(app_url, "Tighter")
    hours = pl["plannedLuxHours"]
    data = ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxHourBudget": hours - 1}))
    assert data["placements"][0]["id"] == pl["id"] and data["placements"][0]["luxStatus"] == "over"
    now = placement(app_url, pl["id"])
    assert now and now["status"] == "proposed" and now["luxStatus"] == "over"
    ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxHourBudget": hours}))
    assert placement(app_url, pl["id"])["luxStatus"] == "within"
    ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxLimit": pl["plannedLux"] - 1}))
    assert placement(app_url, pl["id"])["luxStatus"] == "over"
    with workspace(browser, app_url, CUR) as page:
        shows(page, row(page, obj["title"]), "Over budget")
        assert marker(page, pl["id"]).get_attribute("data-lux-status") == "over"
    discard(app_url, pl["id"])


def test_planned_lux_hours(app_url):
    ex = ok(api("GET", app_url, "/api/exhibition", CUR))["exhibition"]
    assert ex["openHours"] == OPEN_HOURS and ex["openDays"] == OPEN_DAYS and ex["timeZone"] == "Europe/London"
    obj, pl = placed_work(app_url, "Hours")
    w = walls(app_url)
    assert pl["plannedLuxHours"] == w["wall-north"]["plannedLux"] * OPEN_HOURS
    off = free_slot(app_url, "wall-south", obj["widthMm"]) + obj["widthMm"] // 2
    moved = ok(move(app_url, pl, wallId="wall-south", offsetMm=off))["placement"]
    assert moved["plannedLux"] == w["wall-south"]["plannedLux"]
    assert moved["plannedLuxHours"] == w["wall-south"]["plannedLux"] * OPEN_HOURS and moved["luxStatus"] == "within"
    discard(app_url, pl["id"])


def test_wall_lighting_changes(app_url):
    original = walls(app_url)["wall-west"]["plannedLux"]
    try:
        ok(api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": 150}))
        obj, pl = placed_work(app_url, "West", wall_id="wall-west")
        data = ok(api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": 50}))
        assert data["wall"]["plannedLux"] == 50
        on_wall = {p["id"] for p in placements(app_url) if p["wallId"] == "wall-west"}
        assert {p["id"] for p in data["placements"]} == on_wall
        assert all(p["plannedLux"] == 50 and p["plannedLuxHours"] == 50 * OPEN_HOURS for p in data["placements"])
        high = obj["luxLimit"] + 50
        data = ok(api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": high}))
        mine = next(p for p in data["placements"] if p["id"] == pl["id"])
        assert mine["luxStatus"] == "over" and placement(app_url, pl["id"])["status"] == "proposed"
        ev = [e for e in events_after(app_url, data["seq"] - 1) if e["kind"] == "wall.lux_changed" and e["wallId"] == "wall-west"]
        assert ev and ev[0]["plannedLux"] == high and ev[0]["wallName"] == "West wall"
        for bad in (0, LUX_MAX + 1):
            fields = err(api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": bad}), 422, "validation_failed")["fields"]
            assert fields["plannedLux"] == "Enter a lux level from 1 to 1000."
        assert walls(app_url)["wall-west"]["plannedLux"] == high
        discard(app_url, pl["id"])
    finally:
        api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": original})


def test_light_view_status(browser, app_url):
    a, pa = placed_work(app_url, "Within")
    b, pb = placed_work(app_url, "Over")
    ok(api("PATCH", app_url, f"/api/objects/{b['id']}", REG, {"luxHourBudget": pb["plannedLuxHours"] - 1}))
    with workspace(browser, app_url, CUR, reduced="reduce") as page:
        shows(page, row(page, b["title"]), "Over budget")
        for v in ("Light", "Wall", "Plan"):
            view_button(page, v).click()
            settled(page)
            for pid, status, overlay in ((pa["id"], "within", "ink-outline"), (pb["id"], "over", "red-hatch")):
                m = marker(page, pid)
                assert m.get_attribute("data-lux-status") == status
                assert m.get_attribute("data-overlay") == (overlay if v == "Light" else "none")
        assert "Within limit" in row(page, a["title"]).inner_text()
    discard(app_url, pa["id"], pb["id"])


def counts_agree(page: Page, base: str) -> bool:
    data = ok(api("GET", base, "/api/placements", CUR))
    n = data["overBudgetCount"]
    over = sum(1 for p in data["placements"] if p["luxStatus"] == "over")
    shown = re.search(r"(\d+) over budget", page.get_by_role("main").inner_text())
    markers = sum(1 for p in data["placements"] if marker(page, p["id"]).get_attribute("data-lux-status") == "over")
    cells = ledger(page).get_by_text("Over budget", exact=True).count()
    return n == over and shown is not None and int(shown.group(1)) == n == markers == cells


def test_one_over_budget_count(browser, app_url):
    obj, pl = placed_work(app_url, "Count")
    with workspace(browser, app_url, CUR) as page:
        eventually(page, lambda: counts_agree(page, app_url), UI_MS, "agree at start")
        ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxHourBudget": pl["plannedLuxHours"] - 1}))
        eventually(page, lambda: marker(page, pl["id"]).get_attribute("data-lux-status") == "over" and counts_agree(page, app_url),
                   LIVE_UPDATE_MS, "agree after change")
    discard(app_url, pl["id"])


def test_light_view_keyboard(browser, app_url):
    obj, pl = placed_work(app_url, "Lux keys")
    lux = pl["plannedLux"]
    with workspace(browser, app_url, CUR, reduced="reduce") as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.focus()
        page.keyboard.press("3")
        settled(page)
        handles = ledger(page).get_by_role("button")
        n = handles.count()
        idx = next(i for i in range(n) if handles.nth(i).inner_text().strip() == obj["title"])
        h.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: focused(handles.nth(min(idx + 1, n - 1))), UI_MS, "focus on next handle")
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: focused(handles.nth(idx)), UI_MS, "focus on previous handle")
        handles.nth(0).focus()
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: focused(handles.nth(0)), UI_MS, "focus stays on first handle")
        handles.nth(n - 1).focus()
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: focused(handles.nth(n - 1)), UI_MS, "focus stays on last handle")
        h.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Lux details")
        eventually(page, lambda: focused(dlg.get_by_role("button", name="Close", exact=True)), UI_MS, "focus on Close")
        body = dlg.inner_text()
        for line in (f"Planned lux {lux} lux", f"Lux limit {obj['luxLimit']} lux", f"Planned lux-hours {lux * OPEN_HOURS:,} lux-hours",
                     f"Lux-hour budget {BIG_BUDGET:,} lux-hours", "Status Within limit"):
            assert line in body, line
        for _ in range(4):
            page.keyboard.press("Tab")
            assert holds_focus(dlg)
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(dlg) and focused(h), UI_MS, "focus back")
        assert placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"]
    discard(app_url, pl["id"])


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_lux_legend(browser, app_url, size):
    with workspace(browser, app_url, CUR, size=VIEWPORTS[size], reduced="reduce") as page:
        view_button(page, "Light").click()
        settled(page)
        legend = page.get_by_role("region", name="Lux legend")
        toggle = page.get_by_role("button", name="Lux legend", exact=True)
        texts = ("Within limit: ink outline", "Over budget: red outline with hatching")
        if size == "desk":
            shows(page, legend)
            assert all(t in legend.inner_text() for t in texts) and toggle.count() == 0
            return
        for _ in range(2):
            assert toggle.get_attribute("aria-expanded") == "false" and legend.count() == 0
            real_target(toggle)
            pointer_click(toggle)
            shows(page, legend)
            assert toggle.get_attribute("aria-expanded") == "true" and all(t in legend.inner_text() for t in texts)
            view_button(page, "Plan").click()
            settled(page)
            view_button(page, "Light").click()
            settled(page)


def test_wf_light_budget_last_lux_wins(browser, app_url):
    original = walls(app_url)["wall-west"]["plannedLux"]
    values = [161, 171, 181]
    try:
        with workspace(browser, app_url, CUR) as page:
            box = page.get_by_role("region", name="Walls").get_by_role("textbox", name=f"Lux on {WALL_NAMES['wall-west']}")
            save = page.get_by_role("region", name="Walls").get_by_role("button", name=f"Save lux for {WALL_NAMES['wall-west']}", exact=True)
            shows(page, box)
            said(page).evaluate(TEXT_REC)
            with held(page, "**/api/walls/wall-west") as hold:
                for v in values:
                    fill_field(box, str(v))
                    save.click(force=True)
                hold.release()
            last = f"West wall lighting set to {values[-1]} lux."
            eventually(page, lambda: walls(app_url)["wall-west"]["plannedLux"] == values[-1] and last in text_of(said(page)), UI_MS, "last wins")
            advance(page, MESSAGE_HOLD_MS)
            log = page.evaluate("() => window.__textRec")
            after = log[next(i for i, t in enumerate(log) if last in t):]
            assert not any(f"set to {v} lux" in t for t in after for v in values[:-1]), after
            assert box.input_value() == str(values[-1]) and focused(save)
        assert walls(app_url)["wall-west"]["plannedLux"] == values[-1]
    finally:
        api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": original})


def test_wf_light_budget_limit_change(browser, app_url):
    obj, pl = placed_work(app_url, "Herring budget")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        view_button(page, "Light").click()
        settled(page)
        ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"luxHourBudget": pl["plannedLuxHours"] - 1}))
        m = marker(page, pl["id"])
        eventually(page, lambda: m.get_attribute("data-lux-status") == "over" and m.get_attribute("data-overlay") == "red-hatch"
                   and "Over budget" in row(page, obj["title"]).inner_text()
                   and f"Tomasz Adeyemi updated the record for {obj['title']}." in text_of(team(page)), LIVE_UPDATE_MS, "limit change")
        assert counts_agree(page, app_url)
        h.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Lux details")
        shows(page, dlg, "Status Over budget")
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(h), UI_MS, "focus back")
    assert placement(app_url, pl["id"])["luxStatus"] == "over"
    discard(app_url, pl["id"])


def test_view_switch_shortcuts(browser, app_url):
    obj, pl = placed_work(app_url, "Views")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        card(page, obj["title"]).get_by_role("link", name="Open record").focus()
        page.keyboard.press("2")
        settled(page)
        assert view_button(page, "Wall").get_attribute("aria-pressed") == "true"
        eventually(page, lambda: "Wall view." in text_of(said(page)), UI_MS, "Wall view announced")
        h.focus()
        page.keyboard.press("3")
        settled(page)
        eventually(page, lambda: view_button(page, "Light").get_attribute("aria-pressed") == "true" and "Light view." in text_of(said(page)),
                   UI_MS, "Light view announced")
        page.get_by_role("region", name="Walls").get_by_role("textbox", name=f"Lux on {WALL_NAMES['wall-north']}").focus()
        page.keyboard.press("1")
        advance(page, DROP_MAX_MS)
        assert scene_state(page)["view"] == "light"
        h.focus()
        page.keyboard.press("1")
        settled(page)
        eventually(page, lambda: view_button(page, "Plan").get_attribute("aria-pressed") == "true" and "Plan view." in text_of(said(page)),
                   UI_MS, "Plan view announced")
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Placement details")
        shows(page, dlg)
        page.keyboard.press("2")
        advance(page, DROP_MAX_MS)
        plan = page.get_by_role("group", name="View", include_hidden=True).get_by_role("button", name="Plan", exact=True, include_hidden=True)
        assert scene_state(page)["view"] == "plan" and plan.get_attribute("aria-pressed") == "true"
        assert dlg.is_visible() and holds_focus(dlg)
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(dlg) and focused(h), UI_MS, "dialog closed, focus on handle")
    discard(app_url, pl["id"])


def test_eye_line_drop(browser, app_url):
    obj, pl = placed_work(app_url, "East drop", wall_id="wall-east")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.click()
        attrs = ["data-transitioning", "data-camera-height-cm", "data-hang-line"]
        scene(page).evaluate(SCENE_REC, attrs)
        view_button(page, "Wall").click()
        settled(page)
        expect_view(page, "wall", EYE_HEIGHT_CM, FACING_YAW["wall-east"], "visible")
        trans = history(page, "data-transitioning", "false")
        fake, real = span(trans, "true")
        check_span(fake, real, DROP_MIN_MS + HANG_FADE_MIN_MS, DROP_MAX_MS + HANG_FADE_MAX_MS, "eye-line drop")
        heights = history(page, "data-camera-height-cm", str(EYE_HEIGHT_CM))
        hang = history(page, "data-hang-line", "visible")
        at_eye = next(p for v, p, _ in heights if v == str(EYE_HEIGHT_CM))
        shown = next(p for v, p, _ in hang if v == "visible")
        assert shown >= at_eye, "hang line appeared before the camera reached eye height"
        scene(page).evaluate(SCENE_REC, attrs)
        view_button(page, "Plan").click()
        settled(page)
        expect_view(page, "plan", PLAN_HEIGHT_CM, 0, "hidden")
        hidden = next(p for v, p, _ in history(page, "data-hang-line", "hidden") if v == "hidden")
        rise = [p for v, p, _ in history(page, "data-camera-height-cm", str(PLAN_HEIGHT_CM)) if v != str(EYE_HEIGHT_CM)]
        assert rise and hidden <= rise[0]
        fake, real = span(history(page, "data-transitioning", "false"), "true")
        check_span(fake, real, DROP_MIN_MS + HANG_FADE_MIN_MS, DROP_MAX_MS + HANG_FADE_MAX_MS, "reverse drop")
    discard(app_url, pl["id"])


def test_light_cross_fade(browser, app_url):
    with workspace(browser, app_url, CUR) as page:
        attrs = ["data-transitioning", "data-camera-height-cm", "data-camera-yaw-deg", "data-hang-line"]
        for start, height, hang in (("Plan", PLAN_HEIGHT_CM, "hidden"), ("Wall", EYE_HEIGHT_CM, "visible")):
            view_button(page, start).click()
            settled(page)
            before = scene_state(page)
            scene(page).evaluate(SCENE_REC, attrs)
            view_button(page, "Light").click()
            settled(page)
            expect_view(page, "light", height, int(before["camera-yaw-deg"]), hang)
            fake, real = span(history(page, "data-transitioning", "false"), "true")
            check_span(fake, real, LUX_FADE_MIN_MS, LUX_FADE_MAX_MS, f"{start} to Light")
            for a in ("data-camera-height-cm", "data-camera-yaw-deg", "data-hang-line"):
                assert len({v for v, _, _ in history(page, a, scene(page).get_attribute(a))}) == 1, a


def test_reduced_motion_cuts(browser, app_url):
    obj, pl = placed_work(app_url, "Cuts", wall_id="wall-south", room=GAP_MM)
    south = FACING_YAW["wall-south"]
    plan = ("plan", PLAN_HEIGHT_CM, "hidden")
    with workspace(browser, app_url, CUR, reduced="reduce") as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.click()
        scene(page).evaluate(SCENE_REC, ["data-transitioning"])
        steps = [("Wall", ("wall", EYE_HEIGHT_CM, "visible"), south), ("Light", ("light", EYE_HEIGHT_CM, "visible"), south),
                 ("Plan", plan, 0), ("Light", ("light", PLAN_HEIGHT_CM, "hidden"), 0), ("Wall", ("wall", EYE_HEIGHT_CM, "visible"), south),
                 ("Plan", plan, 0), ("Light", ("light", PLAN_HEIGHT_CM, "hidden"), 0), ("Plan", plan, 0),
                 ("Wall", ("wall", EYE_HEIGHT_CM, "visible"), south), ("Light", ("light", EYE_HEIGHT_CM, "visible"), south),
                 ("Wall", ("wall", EYE_HEIGHT_CM, "visible"), south)]
        for name, (view, height, hang), yaw in steps:
            view_button(page, name).click()
            eventually(page, lambda view=view: scene_state(page)["view"] == view, REDUCED_MAX_MS, f"cut to {view}")
            expect_view(page, view, height, yaw, hang)
            overlay = marker(page, pl["id"]).get_attribute("data-overlay")
            assert overlay == ("ink-outline" if view == "light" else "none")
            eventually(page, lambda name=name: f"{name} view." in text_of(said(page)), UI_MS, f"{name} view announced")
        assert all(v != "true" for v, _, _ in history(page, "data-transitioning", "false"))
        h.focus()
        page.keyboard.press("ArrowRight")
        assert all(a["end"] <= REDUCED_MAX_MS for a in page.evaluate(ANIMS))
    discard(app_url, pl["id"])


def test_flat_drawing_without_webgl(browser, app_url):
    obj, pl = placed_work(app_url, "Flat", room=GAP_MM)
    with workspace(browser, app_url, CUR, no_webgl=True) as page:
        shows(page, scene(page), "3D view isn't available on this device. Showing a flat drawing instead.")
        assert marker(page, pl["id"]).count() == 1
        view_button(page, "Wall").click()
        settled(page)
        assert scene_state(page)["view"] == "wall"
        h = handle(page, obj["title"])
        h.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: placement(app_url, pl["id"])["offsetMm"] == pl["offsetMm"] + 10, NUDGE_SAVE_MS + UI_MS, "nudge saved")
        assert "3D view isn't available on this device. Showing a flat drawing instead." in scene(page).inner_text()
    discard(app_url, pl["id"])


def test_view_and_selection_in_address(browser, app_url):
    obj, pl = placed_work(app_url, "Address", wall_id="wall-east")
    with workspace(browser, app_url, CUR, reduced="reduce") as page:
        h = handle(page, obj["title"])
        shows(page, h)
        length = page.evaluate("() => history.length")
        h.click()
        view_button(page, "Wall").click()
        settled(page)
        assert parse_qs(urlparse(page.url).query) == {"view": ["wall"], "work": [pl["id"]]}
        assert page.evaluate("() => history.length") == length
    with workspace(browser, app_url, CUR, ready=False) as page:
        page.add_init_script("new MutationObserver(ms => ms.forEach(m => { if (m.target.getAttribute('data-transitioning') === 'true') window.__sawTransition = true; }))"
                             ".observe(document, {subtree: true, attributes: true, attributeFilter: ['data-transitioning']});")
        page.goto(f"{app_url}/?view=light-eye&work={pl['id']}")
        shows(page, ledger(page))
        eventually(page, lambda: scene_state(page)["view"] == "light", REDUCED_MAX_MS * 2, "restored view")
        expect_view(page, "light", EYE_HEIGHT_CM, FACING_YAW["wall-east"], "visible")
        assert not page.evaluate("() => window.__sawTransition === true")
        assert obj["title"] in page.get_by_role("region", name="Inspector").inner_text()
        page.goto(f"{app_url}/?view=wall&work=missing-{tag_of('w')}")
        shows(page, ledger(page))
        eventually(page, lambda: "work" not in parse_qs(urlparse(page.url).query), UI_MS, "unknown work dropped")
        assert scene_state(page)["view"] == "wall"
    discard(app_url, pl["id"])


def _walk(page: Page, keyboard_buttons: bool):
    def go(name: str):
        if keyboard_buttons:
            tab_to(page, view_button(page, name))
            page.keyboard.press("Enter")
        else:
            page.keyboard.press({"Plan": "1", "Wall": "2", "Light": "3"}[name])
        settled(page)

    north = FACING_YAW["wall-north"]
    go("Wall")
    expect_view(page, "wall", EYE_HEIGHT_CM, north, "visible")
    go("Light")
    expect_view(page, "light", EYE_HEIGHT_CM, north, "visible")
    go("Plan")
    expect_view(page, "plan", PLAN_HEIGHT_CM, 0, "hidden")
    go("Light")
    expect_view(page, "light", PLAN_HEIGHT_CM, 0, "hidden")
    go("Wall")
    expect_view(page, "wall", EYE_HEIGHT_CM, north, "visible")


def test_wf_eye_line_views_desk(browser, app_url):
    obj, pl = placed_work(app_url, "Walk")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        tab_to(page, h)
        page.keyboard.press("Space")
        _walk(page, keyboard_buttons=False)
        assert parse_qs(urlparse(page.url).query)["work"] == [placement(app_url, pl["id"])["id"]]
    discard(app_url, pl["id"])


def test_wf_eye_line_views_phone(browser, app_url):
    obj, pl = placed_work(app_url, "Walk phone")
    with workspace(browser, app_url, CUR, size=PHONE) as page:
        group = page.get_by_role("group", name="View").bounding_box()
        box = scene(page).bounding_box()
        assert group["y"] + group["height"] <= box["y"] + 1
        widths = {round(view_button(page, n).bounding_box()["width"]) for n in ("Plan", "Wall", "Light")}
        assert max(widths) - min(widths) <= 2
        assert all(tappable(view_button(page, n)) for n in ("Plan", "Wall", "Light"))
        handle(page, obj["title"]).evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
        pointer_click(handle(page, obj["title"]))
        _walk(page, keyboard_buttons=True)
        assert parse_qs(urlparse(page.url).query)["work"] == [placement(app_url, pl["id"])["id"]]
    discard(app_url, pl["id"])


def touch_drag(page: Page, starts: list[tuple[float, float]], dx: float, steps: int = 10) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    pts = lambda off: [{"x": x + off, "y": y, "id": i} for i, (x, y) in enumerate(starts)]
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(0)})
    for i in range(1, steps + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(dx * i / steps)})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


DRAG_PX = 80
DRAG_WORK_CM = 100
DRAG_ROOM_MM = 3000


def drag_work(page: Page, title: str, pid: str) -> None:
    handle(page, title).click()
    view_button(page, "Wall").click()
    settled(page)
    b = marker(page, pid).bounding_box()
    touch_drag(page, [(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)], DRAG_PX)


def test_touch_drag(browser, app_url):
    obj = new_object(app_url, "Touch", w=DRAG_WORK_CM, h=DRAG_WORK_CM)
    wall_mid = walls(app_url)["wall-north"]["lengthMm"] // 2
    x = free_slot_near(app_url, "wall-north", obj["widthMm"] + DRAG_ROOM_MM, wall_mid + DRAG_ROOM_MM // 2)
    pl = ok(place(app_url, obj, "wall-north", x + obj["widthMm"] // 2), 201)["placement"]
    with workspace(browser, app_url, CUR, size=TABLET, reduced="reduce") as page:
        shows(page, handle(page, obj["title"]))
        patches = requests_seen(page, "PATCH", pl["id"])
        drag_work(page, obj["title"], pl["id"])
        eventually(page, lambda: placement(app_url, pl["id"])["offsetMm"] != pl["offsetMm"], UI_MS, "drag saved")
        advance(page, NUDGE_SAVE_MS * 2)
        delta = placement(app_url, pl["id"])["offsetMm"] - pl["offsetMm"]
        assert len(patches) == 1 and delta > 0 and delta % 10 == 0, (len(patches), delta)
    now = placement(app_url, pl["id"])
    e = err(move(app_url, now, CUR, offsetMm=walls(app_url)["wall-north"]["lengthMm"]), 422, "placement_rejected")
    assert e["reason"] == "off_wall" and e["message"] == f"Runs off the wall: keep the whole work on {WALL_NAMES['wall-north']}.", e
    discard(app_url, pl["id"])


def test_two_finger_orbit(browser, app_url):
    with workspace(browser, app_url, CUR, size=TABLET, reduced="reduce") as page:
        b = scene(page).bounding_box()
        cx, cy = b["x"] + b["width"] / 2, b["y"] + b["height"] * 0.8
        before = scene_state(page)
        touch_drag(page, [(cx - 40, cy), (cx + 40, cy)], 150)
        eventually(page, lambda: scene_state(page)["camera-yaw-deg"] != before["camera-yaw-deg"], UI_MS, "orbit")
        assert scene_state(page)["camera-height-cm"] == before["camera-height-cm"]
        view_button(page, "Wall").click()
        facing = int(settled(page)["camera-yaw-deg"])
        touch_drag(page, [(cx - 40, cy), (cx + 40, cy)], b["width"] * 2, steps=30)
        advance(page, STEP_TOL_MS)
        yaw = int(scene_state(page)["camera-yaw-deg"])
        assert min((yaw - facing) % 360, (facing - yaw) % 360) <= ORBIT_LIMIT_DEG, (facing, yaw)
        assert int(scene_state(page)["camera-height-cm"]) == EYE_HEIGHT_CM


def test_wf_tablet_touch_drawer(browser, app_url):
    obj = new_object(app_url, "Drawer")
    off = free_slot(app_url, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
    with workspace(browser, app_url, CUR, size=TABLET) as page:
        layout(page)
        s, i = scene(page).bounding_box(), page.get_by_role("region", name="Inspector").bounding_box()
        assert i["x"] >= s["x"] + s["width"] - 1 and i["y"] < s["y"] + s["height"]
        btn = page.get_by_role("button", name="Objects", exact=True)
        assert btn.get_attribute("aria-expanded") == "false" and rail(page).count() == 0
        names = tab_order(page, 40)
        assert "Place" not in names and "Open record" not in names
        tab_to(page, btn)
        page.keyboard.press("Enter")
        eventually(page, lambda: holds_focus(rail(page).get_by_role("listitem").first), UI_MS, "first card focus")
        for _ in range(40):
            page.keyboard.press("Tab")
            assert holds_focus(rail(page))
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(btn) and rail(page).count() == 0, UI_MS, "drawer closed")
        page.keyboard.press("Enter")
        tab_to(page, card_button(page, obj["title"], "Place"))
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Place work")
        select(dlg.get_by_role("combobox", name="Wall"), "North wall")
        fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(off))
        tab_to(page, dlg.get_by_role("button", name="Save placement", exact=True))
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(handle(page, obj["title"])) and rail(page).count() == 0, UI_MS, "placed and drawer closed")
    p = next(p for p in placements(app_url) if p["objectId"] == obj["id"])
    assert p["offsetMm"] == off
    discard(app_url, p["id"])


def test_phone_bottom_sheet(browser, app_url):
    with workspace(browser, app_url, CUR, size=PHONE) as page:
        layout(page)
        s, i = scene(page).bounding_box(), page.get_by_role("region", name="Inspector").bounding_box()
        assert s["width"] > PHONE[0] / 2 and i["y"] >= s["y"] + s["height"] - 1
        btn = page.get_by_role("button", name="Objects", exact=True)
        assert btn.get_attribute("aria-expanded") == "false" and rail(page).count() == 0
        names = tab_order(page, 40)
        assert "Place" not in names and "Open record" not in names
        btn.click()
        eventually(page, lambda: holds_focus(rail(page).get_by_role("listitem").first), UI_MS, "first card focus")
        for _ in range(40):
            page.keyboard.press("Tab")
            assert holds_focus(rail(page))
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(btn) and rail(page).count() == 0, UI_MS, "sheet closed")
        assert btn.get_attribute("aria-expanded") == "false"


def test_wf_tablet_touch_adjust(browser, app_url):
    obj = new_object(app_url, "Adjust", w=DRAG_WORK_CM, h=DRAG_WORK_CM)
    wall_mid = walls(app_url)["wall-east"]["lengthMm"] // 2
    x = free_slot_near(app_url, "wall-east", obj["widthMm"] + DRAG_ROOM_MM, wall_mid + DRAG_ROOM_MM // 2)
    pl = ok(place(app_url, obj, "wall-east", x + obj["widthMm"] // 2), 201)["placement"]
    with workspace(browser, app_url, CUR) as other, workspace(browser, app_url, RUTH, size=TABLET, reduced="reduce") as page:
        btn = page.get_by_role("button", name="Objects", exact=True)
        tap(btn)
        shows(page, rail(page))
        tap(card_button(page, obj["title"], "Claim"))
        eventually(page, lambda: f"You claimed {obj['title']}." in text_of(said(page)), UI_MS, "claimed")
        eventually(other, lambda: f"Ruth Okonkwo-Hale claimed {obj['title']}." in text_of(team(other)), LIVE_UPDATE_MS, "claim seen")
        b = btn.bounding_box()
        page.touchscreen.tap(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        eventually(page, lambda: rail(page).count() == 0, UI_MS, "drawer closed")
        drag_work(page, obj["title"], pl["id"])
        eventually(page, lambda: placement(app_url, pl["id"])["offsetMm"] != pl["offsetMm"], UI_MS, "drag saved")
        now = placement(app_url, pl["id"])
        assert (now["offsetMm"] - pl["offsetMm"]) % 10 == 0 and now["offsetMm"] > pl["offsetMm"]
        moved = f"{obj['title']} moved to {cm(now['offsetMm'])} from the left end."
        eventually(page, lambda: moved in text_of(said(page)), UI_MS, "move announced")
        eventually(other, lambda: f"Ruth Okonkwo-Hale moved {obj['title']} to {cm(now['offsetMm'])} from the left end." in text_of(team(other)),
                   LIVE_UPDATE_MS, "move seen")
        tap(btn)
        tap(card_button(page, obj["title"], "Mark hung"))
        eventually(page, lambda: f"{obj['title']} marked hung." in text_of(said(page)), UI_MS, "hung")
        eventually(other, lambda: f"Ruth Okonkwo-Hale marked {obj['title']} hung." in text_of(team(other)), LIVE_UPDATE_MS, "hung seen")
    assert placement(app_url, pl["id"])["status"] == "hung"


def test_schedule_lender_preview(app_url):
    reset_preview(app_url)
    try:
        fields = err(api("POST", app_url, "/api/preview/schedule", CUR, {"date": BAD_DATE}), 422, "validation_failed")["fields"]
        assert fields["date"] == BAD_DATE_MSG
        fields = err(api("POST", app_url, "/api/preview/schedule", CUR, {"date": PAST_DATE}), 422, "validation_failed")["fields"]
        assert fields["date"] == TOO_SOON
        assert preview_of(app_url)["status"] in ("draft", "withdrawn")
        for day in (WINTER_DATE, SUMMER_DATE):
            p = ok(api("POST", app_url, "/api/preview/schedule", CUR, {"date": day.isoformat()}))["preview"]
            local = datetime(day.year, day.month, day.day, 9, 0, tzinfo=MUSEUM_TZ)
            assert p["status"] == "scheduled" and p["date"] == day.isoformat()
            assert iso(p["publishAt"]) == local and p["publishAtDisplay"] == display(local)
            assert p["remainingMs"] > 0
            ok(api("POST", app_url, "/api/preview/cancel", CUR))
    finally:
        reset_preview(app_url)


def test_preview_transitions(app_url):
    reset_preview(app_url)
    try:
        if preview_of(app_url)["status"] == "draft":
            err(api("POST", app_url, "/api/preview/cancel", CUR), 409, "preview_conflict")
            err(api("POST", app_url, "/api/preview/withdraw", CUR), 409, "preview_conflict")
        ok(api("POST", app_url, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
        err(api("POST", app_url, "/api/preview/schedule", CUR, {"date": SUMMER_DATE.isoformat()}), 409, "preview_conflict")
        err(api("POST", app_url, "/api/preview/withdraw", CUR), 409, "preview_conflict")
        assert ok(api("POST", app_url, "/api/preview/cancel", CUR))["preview"]["status"] == "draft"
        err(api("POST", app_url, "/api/preview/cancel", CUR), 409, "preview_conflict")
    finally:
        reset_preview(app_url)


def _schedule_in_panel(page: Page, day: date):
    prev = page.get_by_role("region", name="Lender preview")
    fill_field(prev.get_by_role("textbox", name="Preview date"), day.isoformat())
    with page.expect_response(lambda r: r.request.method == "POST" and "/api/preview/schedule" in r.url) as info:
        prev.get_by_role("button", name="Schedule preview", exact=True).click()
    return prev, info.value.json()["preview"], page_now(page)


def shown_countdown(prev: Locator) -> int | None:
    m = re.search(r"Publishes in (\d+):(\d\d):(\d\d)", text_of(prev))
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) if m else None


def test_preview_status_from_server(browser, app_url):
    reset_preview(app_url)
    try:
        with workspace(browser, app_url, CUR) as page:
            page.clock.set_system_time(WRONG_CLOCK)
            prev, p, t0 = _schedule_in_panel(page, WINTER_DATE)

            def matches() -> bool:
                want = math.ceil((p["remainingMs"] - (page_now(page) - t0)) / 1000)
                return "Scheduled" in text_of(prev) and f"Publishes {p['publishAtDisplay']}" in text_of(prev) and shown_countdown(prev) in (want, want + 1)

            eventually(page, matches, UI_MS, "server countdown")
            assert f"Preview scheduled for {p['publishAtDisplay']}." in text_of(said(page))
            assert countdown(shown_countdown(prev)) in text_of(prev)
    finally:
        reset_preview(app_url)


def test_publish_countdown_keeps_time(browser, app_url):
    reset_preview(app_url)
    spare = new_object(app_url, "Countdown")
    try:
        with workspace(browser, app_url, CUR, reduced="reduce") as page:
            prev, p, t0 = _schedule_in_panel(page, WINTER_DATE)

            def on_time() -> bool:
                want = math.ceil((p["remainingMs"] - (page_now(page) - t0)) / 1000)
                return shown_countdown(prev) in (want, want + 1)

            eventually(page, on_time, UI_MS, "countdown shown")
            with held(page, "**/api/preview"):
                advance(page, 2000)
                assert on_time()
                view_button(page, "Wall").click()
                view_button(page, "Light").click()
                assert on_time()
                card_button(page, spare["title"], "Place").click()
                page.keyboard.press("Escape")
                select(page.get_by_role("combobox", name="Working as"), f"{NAMES[CUR]} ({ROLES[CUR]})")
                advance(page, 2000)
                assert on_time()
                other = page.context.new_page()
                other.bring_to_front()
                page.bring_to_front()
                other.close()
                assert on_time()
    finally:
        reset_preview(app_url)


def test_status_goes_live_in_place(browser):
    base = env_url("APP_FAST_PUBLISH_URL")
    reset_preview(base)
    placed_work(base, "Live", lender="lender-fenwick")
    with workspace(browser, base, CUR) as page:
        page.evaluate("() => { window.__hangNoReload = 1; }")
        prev = page.get_by_role("region", name="Lender preview")
        ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
        eventually(page, lambda: "Scheduled" in text_of(prev), LIVE_UPDATE_MS, "scheduled shown")
        pub = wait_published(base)
        eventually(page, lambda: "Live" in text_of(prev) and f"Published {pub['publishedAtDisplay']}" in text_of(prev),
                   PREVIEW_LIVE_MS, "Live in place")
        eventually(page, lambda: f"Preview published. Lenders notified: {len(pub['recipients'])}." in text_of(team(page)),
                   LIVE_UPDATE_MS, "publish announced")
        assert page.evaluate("() => window.__hangNoReload") == 1


def test_recipients_update_in_place(browser):
    base = env_url("APP_FAST_PUBLISH_URL")
    reset_preview(base)
    placed_work(base, "Recipient", lender="lender-fenwick")
    with workspace(browser, base, CUR) as page:
        page.evaluate("() => { window.__hangNoReload = 1; }")
        rec = page.get_by_role("list", name="Recipients")
        ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
        wait_published(base)
        sent = wait_real(lambda: p if (p := preview_of(base))["recipients"] and all(r["delivery"] == "sent" for r in p["recipients"]) else None,
                         PUBLISH_WAIT_S, "all sent")
        for r in sent["recipients"]:
            eventually(page, lambda r=r: f"{r['lenderName']}: Sent" in text_of(rec), LIVE_UPDATE_MS, f"{r['lenderName']} sent in place")
        assert page.evaluate("() => window.__hangNoReload") == 1


def test_preview_sheet_phone(browser, app_url):
    with workspace(browser, app_url, CUR, size=PHONE) as page:
        btn = page.get_by_role("button", name="Lender preview", exact=True)
        sheet = page.get_by_role("region", name="Lender preview")
        assert btn.get_attribute("aria-expanded") == "false" and sheet.count() == 0
        assert not any(n in ("Schedule preview", "Preview date") for n in tab_order(page, 40))
        tab_to(page, btn)
        page.keyboard.press("Enter")
        eventually(page, lambda: focused(page.get_by_role("heading", name="Lender preview")), UI_MS, "heading focus")
        for _ in range(20):
            page.keyboard.press("Tab")
            assert holds_focus(sheet)
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(btn) and sheet.count() == 0, UI_MS, "sheet closed")
        btn.click()
        shows(page, sheet)
        page.get_by_role("button", name="Objects", exact=True).click()
        eventually(page, lambda: sheet.count() == 0 and rail(page).count() == 1, UI_MS, "one sheet at a time")


def test_wf_preview_schedule_phone(browser, app_url):
    reset_preview(app_url)
    try:
        with workspace(browser, app_url, CUR, size=PHONE) as page:
            page.clock.set_system_time(WRONG_CLOCK)
            btn = page.get_by_role("button", name="Lender preview", exact=True)
            tab_to(page, btn)
            page.keyboard.press("Enter")
            sheet = page.get_by_role("region", name="Lender preview")
            box = sheet.get_by_role("textbox", name="Preview date")
            tab_to(page, box)
            page.keyboard.press("Control+a")
            page.keyboard.type(WINTER_DATE.isoformat())
            tab_to(page, sheet.get_by_role("button", name="Schedule preview", exact=True))
            page.keyboard.press("Enter")
            heading = page.get_by_role("heading", name="Lender preview")
            eventually(page, lambda: focused(heading) and parse_qs(urlparse(page.url).query).get("panel") == ["preview"], UI_MS, "panel URL")
            assert btn.get_attribute("aria-expanded") == "true" and "Scheduled" in text_of(sheet)
            p = preview_of(app_url)
            assert p["status"] == "scheduled" and p["date"] == WINTER_DATE.isoformat()
            page.reload()
            eventually(page, lambda: focused(page.get_by_role("heading", name="Lender preview")), UI_MS, "reopened")
            cancel = page.get_by_role("region", name="Lender preview").get_by_role("button", name="Cancel schedule", exact=True)
            tab_to(page, cancel)
            page.keyboard.press("Enter")
            eventually(page, lambda: "Preview schedule cancelled." in text_of(said(page)) and focused(page.get_by_role("heading", name="Lender preview")),
                       UI_MS, "cancelled")
            assert parse_qs(urlparse(page.url).query).get("panel") == ["preview"]
        assert preview_of(app_url)["status"] == "draft"
    finally:
        reset_preview(app_url)


def test_wf_preview_schedule_refused(browser, app_url):
    reset_preview(app_url)
    with workspace(browser, app_url, CUR) as page:
        prev = page.get_by_role("region", name="Lender preview")
        assert "Publishes at 09:00 Europe/London time on the date you choose." in text_of(prev)
        box = prev.get_by_role("textbox", name="Preview date")
        for value, msg in ((PAST_DATE, TOO_SOON), (BAD_DATE, BAD_DATE_MSG)):
            fill_field(box, value)
            prev.get_by_role("button", name="Schedule preview", exact=True).click()
            eventually(page, lambda msg=msg: focused(box) and msg in text_of(prev) and msg in text_of(said(page)), UI_MS, "refused")
    assert preview_of(app_url)["status"] in ("draft", "withdrawn")


def lender_mail(msgs: list[dict], lender: str, subject: str) -> list[dict]:
    return [m for m in msgs if m.get("Subject") == subject and LENDER_EMAILS[lender] in addresses(m.get("To"))]


def token_in(msg: dict) -> str:
    link = re.search(r"""href=["'][^"']*/p/([^"'/?#]+)["']""", msg.get("HTML") or "")
    if link:
        return link.group(1)
    return re.search(r"/p/([A-Za-z0-9_.~=-]+)", mail_text(msg)).group(1).rstrip(".")


def preview_mail(mail, lids) -> list[dict]:
    def arrived():
        msgs = mail.messages()
        return msgs if all(lender_mail(msgs, lid, SUBJECT_PREVIEW) for lid in lids) else None

    return wait_real(arrived, PUBLISH_WAIT_S, "preview emails delivered")


def _published(base: str, mail, schedule=None) -> dict:
    reset_preview(base)
    tag = tag_of("pv")
    mine, pm = placed_work(base, "Loan", lender="lender-fenwick", insurance=INSURANCE_PROBE, note=f"Private note {tag}")
    theirs, _ = placed_work(base, "Theirs", lender="lender-harbourside", insurance=INSURANCE_PROBE, note=f"Other note {tag}")
    current = placements(base)
    expected = {p["lenderId"] for p in current if p["lenderId"]}
    titles_by = {lid: {p["objectTitle"] for p in current if p["lenderId"] == lid} for lid in expected}
    mail.clear()
    sched = schedule() if schedule else ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))["preview"]
    pub = wait_published(base)
    msgs = preview_mail(mail, expected)
    tokens = {lid: token_in(got[0]) for lid in expected if (got := lender_mail(msgs, lid, SUBJECT_PREVIEW))}
    return {"tag": tag, "mine": mine, "pm": pm, "theirs": theirs, "expected": expected, "titles_by": titles_by,
            "sched": sched, "pub": pub, "msgs": msgs, "tokens": tokens,
            "secrets": [str(INSURANCE_PROBE), f"{INSURANCE_PROBE:,}", f"Private note {tag}", f"Other note {tag}"]}


def test_publish_on_time(browser, mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    reset_preview(base)
    bad = err(api("POST", base, "/api/preview/schedule", CUR, {"date": "31-01-2027"}), 422, "validation_failed")
    assert bad.get("fields", {}).get("date") == BAD_DATE_MSG, bad
    assert preview_of(base)["status"] in ("draft", "withdrawn")
    with workspace(browser, base, CUR) as page:
        pv = _published(base, mail, lambda: _schedule_in_panel(page, WINTER_DATE)[1])
    sched, pub, expected = pv["sched"], pv["pub"], pv["expected"]
    assert sched["status"] == "scheduled"
    delay = (iso(pub["publishedAt"]) - iso(sched["publishAt"])).total_seconds()
    assert 0 <= delay <= PUBLISH_WINDOW_S, delay
    assert sorted(r["lenderId"] for r in pub["recipients"]) == sorted(expected)
    keys = S3("-fastpub").keys(f"previews/{pub['id']}/")
    want = {f"previews/{pub['id']}/{lid}/snapshot.{ext}" for lid in expected for ext in ("json", "png")}
    assert set(keys) == want, keys
    for lid in expected:
        assert len(lender_mail(pv["msgs"], lid, SUBJECT_PREVIEW)) == 1, lid


def test_lender_preview_email(mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    pv = _published(base, mail)
    for lid in pv["expected"]:
        got = lender_mail(pv["msgs"], lid, SUBJECT_PREVIEW)
        assert len(got) == 1, (lid, len(got))
        m = got[0]
        assert mail_from_address() in addresses(m.get("From"))
        body = mail_text(m)
        assert m.get("HTML") and LENDERS[lid] in body and pv["sched"]["publishAtDisplay"] in body
        for t in pv["titles_by"][lid]:
            assert t in body, t
        snap = json.loads(api("GET", base, f"/api/p/{token_in(m)}").content)
        assert snap["lender"]["name"] == LENDERS[lid]


def test_nothing_private_reaches_lenders(browser, mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    pv = _published(base, mail)
    expected, titles_by, secrets = pv["expected"], pv["titles_by"], pv["secrets"]
    for lid in expected:
        m = lender_mail(pv["msgs"], lid, SUBJECT_PREVIEW)[0]
        everything = mail_text(m) + (m.get("HTML") or "")
        others = expected - {lid}
        assert not any(s in everything for s in secrets)
        assert not any(LENDERS[o] in everything for o in others)
        assert not any(t in everything for o in others for t in titles_by[o])
        t = pv["tokens"][lid]
        stored = S3("-fastpub").get(f"previews/{pv['pub']['id']}/{lid}/snapshot.json").decode()
        served = api("GET", base, f"/api/p/{t}").text
        for blob in (stored, served):
            assert not any(s in blob for s in secrets)
            assert not any(LENDERS[o] in blob for o in others)
            assert not any(ti in blob for o in others for ti in titles_by[o])
        snap = json.loads(stored)
        assert all(set(w) == {"title", "objectNumber", "wallName", "offsetMm", "centreHeightMm", "widthMm", "heightMm"} for w in snap["works"])
        if lid == "lender-fenwick":
            with open_app(browser, f"{base}/p/{t}") as lp:
                shows(lp, lp.get_by_role("heading", level=1, name=EXHIBITION))
                page_text = lp.get_by_role("main").inner_text() + lp.content()
                assert not any(s in page_text for s in secrets)
                assert not any(LENDERS[o] in page_text for o in others)
                assert not any(ti in page_text for o in others for ti in titles_by[o])


def test_snapshots_frozen(mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    pv = _published(base, mail)
    t = pv["tokens"]["lender-fenwick"]
    prefix = f"previews/{pv['pub']['id']}/lender-fenwick/"
    stored = S3("-fastpub").get(prefix + "snapshot.json")
    stored_png = S3("-fastpub").get(prefix + "snapshot.png")
    raw = api("GET", base, f"/api/p/{t}")
    assert raw.status_code == 200 and raw.content == stored
    snap = json.loads(stored)
    assert snap["lender"] == {"name": "Fenwick Maritime Trust"} and snap["exhibition"]["title"] == EXHIBITION
    assert {w["title"] for w in snap["works"]} == pv["titles_by"]["lender-fenwick"]
    png = api("GET", base, f"/api/p/{t}/snapshot.png")
    assert png.headers["content-type"].startswith("image/png") and png.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert png.content == stored_png
    ok(api("PATCH", base, f"/api/objects/{pv['mine']['id']}", REG, {"title": f"Renamed {pv['tag']}"}))
    assert api("GET", base, f"/api/p/{t}").content == stored
    assert api("GET", base, f"/api/p/{t}/snapshot.png").content == stored_png
    assert S3("-fastpub").get(prefix + "snapshot.json") == stored


def test_wf_preview_publish_lender_page(browser, mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    reset_preview(base)
    with workspace(browser, base, CUR) as page:
        pv = _published(base, mail, lambda: _schedule_in_panel(page, WINTER_DATE)[1])
    t, mine, pm, theirs, pub = pv["tokens"]["lender-fenwick"], pv["mine"], pv["pm"], pv["theirs"], pv["pub"]
    for size in (DESK, PHONE):
        with open_app(browser, f"{base}/p/{t}") as lp:
            lp.set_viewport_size({"width": size[0], "height": size[1]})
            lp.goto(f"{base}/p/{t}")
            shows(lp, lp.get_by_role("heading", level=1, name=EXHIBITION))
            main = lp.get_by_role("main").inner_text()
            assert f"Prepared for {LENDERS['lender-fenwick']}" in main and f"Published {pub['publishedAtDisplay']}" in main
            works = lp.get_by_role("list", name="Your works")
            assert lp.get_by_role("heading", level=2, name="Your works in place").count() == 1
            item = works.get_by_role("listitem").filter(has_text=mine["title"])
            assert f"Offset {cm(pm['offsetMm'])} from the left end" in item.inner_text()
            assert f"Centre {cm(pm['centreHeightMm'])} from the floor" in item.inner_text()
            assert theirs["title"] not in main
            assert lp.get_by_role("textbox").count() == 0 and lp.get_by_role("combobox").count() == 0
            layout(lp)
            wall = lp.get_by_role("region", name="Preview scene").get_by_role("group", name="View").get_by_role("button", name="Wall", exact=True)
            tab_to(lp, wall)
            lp.keyboard.press("Enter")
            eventually(lp, lambda: parse_qs(urlparse(lp.url).query).get("view") == ["wall"], UI_MS, "view in URL")
            lp.reload()
            eventually(lp, lambda: lp.get_by_role("button", name="Wall", exact=True).get_attribute("aria-pressed") == "true", UI_MS, "restored")


def test_capability_links(mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    reset_preview(base)
    placed_work(base, "Capability", lender="lender-fenwick")
    mail.clear()
    ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
    pub = wait_published(base)
    lids = [r["lenderId"] for r in pub["recipients"]]
    msgs = preview_mail(mail, lids)
    tokens = {lid: token_in(lender_mail(msgs, lid, SUBJECT_PREVIEW)[0]) for lid in lids}
    assert len(set(tokens.values())) == len(tokens)
    for lid, t in tokens.items():
        assert len(t) >= TOKEN_MIN_CHARS and re.fullmatch(r"[A-Za-z0-9_.~=-]+", t)
        assert json.loads(api("GET", base, f"/api/p/{t}").content)["lender"]["name"] == LENDERS[lid]
        for method in ("POST", "PUT", "PATCH", "DELETE"):
            err(api(method, base, f"/api/p/{t}", body={}), 405, "read_only")
            assert api(method, base, f"/p/{t}").status_code == 405
        assert json.loads(api("GET", base, f"/api/p/{t}").content)["lender"]["name"] == LENDERS[lid]
    err(api("GET", base, f"/api/p/{tag_of('junk')}x{'0' * TOKEN_MIN_CHARS}"), 404, "not_found")
    err(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}), 409, "preview_conflict")
    err(api("POST", base, "/api/preview/cancel", CUR), 409, "preview_conflict")
    ok(api("POST", base, "/api/preview/withdraw", CUR))
    err(api("POST", base, "/api/preview/withdraw", CUR), 409, "preview_conflict")
    wait_real(lambda: all(lender_mail(mail.messages(), lid, SUBJECT_WITHDRAWN) for lid in lids) or None,
              PUBLISH_WAIT_S, "withdrawal notices delivered")
    mail.clear()
    ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
    again = wait_published(base)
    assert again["id"] != pub["id"]
    fresh = wait_real(lambda: m if lender_mail(m := mail.messages(), "lender-fenwick", SUBJECT_PREVIEW) else None,
                      PUBLISH_WAIT_S, "new preview email")
    new_token = token_in(lender_mail(fresh, "lender-fenwick", SUBJECT_PREVIEW)[0])
    assert new_token not in tokens.values() and api("GET", base, f"/api/p/{new_token}").status_code == 200
    err(api("GET", base, f"/api/p/{tokens['lender-fenwick']}"), 410, "link_withdrawn")


def test_wf_preview_publish_withdraw(browser, mail):
    base = env_url("APP_FAST_PUBLISH_URL")
    before = preview_of(base)
    reset_preview(base)
    if before["status"] == "published":
        earlier = [r["lenderId"] for r in before["recipients"] if r["delivery"] == "sent"]
        wait_real(lambda: all(lender_mail(mail.messages(), lid, SUBJECT_WITHDRAWN) for lid in earlier) or None,
                  PUBLISH_WAIT_S, "earlier withdrawal notices delivered")
    placed_work(base, "Withdraw", lender="lender-fenwick")
    mail.clear()
    ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
    wait_published(base)
    pub = wait_real(lambda: p if (p := preview_of(base))["recipients"] and all(r["delivery"] == "sent" for r in p["recipients"]) else None,
                    PUBLISH_WAIT_S, "all sent")
    lids = [r["lenderId"] for r in pub["recipients"]]
    msgs = preview_mail(mail, lids)
    tokens = {lid: token_in(lender_mail(msgs, lid, SUBJECT_PREVIEW)[0]) for lid in lids}
    for t in tokens.values():
        assert api("GET", base, f"/api/p/{t}").status_code == 200
    with workspace(browser, base, CUR) as page:
        prev = page.get_by_role("region", name="Lender preview")
        withdraw = prev.get_by_role("button", name="Withdraw preview", exact=True)
        shows(page, withdraw)
        real_target(withdraw)
        pointer_click(withdraw)
        eventually(page, lambda: "Withdrawn" in text_of(prev) and "Preview withdrawn. Lender links no longer work." in text_of(said(page)), UI_MS, "withdrawn")
        for t in tokens.values():
            err(api("GET", base, f"/api/p/{t}"), 410, "link_withdrawn")
            assert api("GET", base, f"/p/{t}").status_code == 410
            assert api("GET", base, f"/api/p/{t}/snapshot.png").status_code == 410
    assert preview_of(base)["status"] == "withdrawn"
    err(api("POST", base, "/api/preview/withdraw", CUR), 409, "preview_conflict")
    notices = mail.messages(expected=len(lids) * 2)
    for lid in lids:
        assert len(lender_mail(notices, lid, SUBJECT_WITHDRAWN)) == 1, lid
    with open_app(browser, f"{base}/p/{tokens['lender-fenwick']}") as lp:
        shows(lp, lp.get_by_role("heading", level=1, name="This preview has been withdrawn by the museum."))


def test_wf_preview_publish_mail_outage(browser):
    base = env_url("APP_MAIL_RELAY_DOWN_URL")
    reset_preview(base)
    placed_work(base, "Queued", lender="lender-fenwick")
    with workspace(browser, base, CUR) as page:
        prev, sched, _ = _schedule_in_panel(page, WINTER_DATE)
        pub = wait_published(base)
        delay = (iso(pub["publishedAt"]) - iso(sched["publishAt"])).total_seconds()
        assert 0 <= delay <= PUBLISH_WINDOW_S
        assert pub["recipients"] and all(r["delivery"] == "queued" and r["sentAt"] is None for r in pub["recipients"])
        assert services(base)["mailRelay"] == "down"
        shows(page, page.get_by_role("alert").filter(has_text=MAIL_BANNER), MAIL_BANNER, budget_ms=BANNER_DOWN_MS)
        rec = page.get_by_role("list", name="Recipients")
        eventually(page, lambda: f"{LENDERS['lender-fenwick']}: Waiting for mail relay" in text_of(rec), LIVE_UPDATE_MS, "queued recipient")
        assert f"{LENDERS['lender-fenwick']}: Sent" not in text_of(rec)


def test_health_and_manifest(app_url):
    r = api("GET", app_url, "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert json.loads(open(os.path.join(APP_DIR, "run.json")).read())["serve"]
    page = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S)
    assert page.status_code == 200 and page.headers["content-type"].startswith("text/html")
    staff = {s["id"]: (s["name"], s["role"]) for s in ok(api("GET", app_url, "/api/staff"))["staff"]}
    for sid in NAMES:
        assert staff[sid] == (NAMES[sid], ROLES[sid])


def test_database_outage_api(app_url):
    base = env_url("APP_DATABASE_DOWN_URL")
    for _ in range(3):
        r = api("GET", base, "/api/health")
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert services(base)["database"] == "down"
    err(api("GET", base, "/api/exhibition", CUR), 503, "database_unavailable")
    err(api("GET", base, "/api/placements"), 503, "database_unavailable")
    err(api("POST", base, "/api/placements", CUR, {"objectId": "obj-herring"}), 503, "database_unavailable")
    assert httpx.get(base + "/", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_cross_cutting_database_banner(browser):
    base = env_url("APP_DATABASE_DOWN_URL")
    for path in ("/", "/records"):
        with workspace(browser, base, None, path=path, ready=False) as page:
            alert = page.get_by_role("alert").filter(has_text=DB_BANNER)
            shows(page, alert, DB_BANNER, budget_ms=BANNER_DOWN_MS)
            again = alert.get_by_role("button", name="Try again", exact=True)
            eventually(page, lambda: focused(again), UI_MS, "focus on Try again")
            for key in ("Tab", "Tab", "Tab", "Shift+Tab", "Shift+Tab"):
                page.keyboard.press(key)
                assert focused(again)
            page.keyboard.press("Enter")
            assert focused(again)
    assert services(base)["database"] == "down"


class Relay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        with socket.socket() as s:
            s.bind(("127.0.0.1", 0))
            self.port = s.getsockname()[1]
        self.conns: list[socket.socket] = []
        self.server: socket.socket | None = None
        self.up()

    def up(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.server = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s: socket.socket) -> None:
        while True:
            try:
                c, _ = s.accept()
                u = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                if self.server is not s:
                    return
                continue
            self.conns += [c, u]
            for a, b in ((c, u), (u, c)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a: socket.socket, b: socket.socket) -> None:
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        for x in (a, b):
            with contextlib.suppress(OSError):
                x.shutdown(socket.SHUT_RDWR)
            x.close()

    def down(self) -> None:
        s, self.server = self.server, None
        with contextlib.suppress(OSError):
            s.shutdown(socket.SHUT_RDWR)
        s.close()
        for c in self.conns:
            with contextlib.suppress(OSError):
                c.shutdown(socket.SHUT_RDWR)
            c.close()
        self.conns = []


@contextlib.contextmanager
def relay_copy():
    db_url = urlparse(env_url("DATABASE_URL"))
    s3_url = urlparse(env_url("S3_ENDPOINT"))
    db = Relay(db_url.hostname, db_url.port or 5432)
    s3 = Relay(s3_url.hostname, s3_url.port or 80)
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), APP_PUBLIC_URL=f"http://127.0.0.1:{port}",
               DATABASE_URL=db_url._replace(netloc=f"{db_url.username}:{db_url.password}@127.0.0.1:{db.port}").geturl(),
               S3_ENDPOINT=s3_url._replace(netloc=f"127.0.0.1:{s3.port}").geturl())
    serve = json.loads(open(os.path.join(DEPLOYED_APP, "run.json")).read())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return open(log.name).read()[-3000:]

    def status_is(service: str, value: str):
        assert proc.poll() is None, tail()
        r = api("GET", base, "/api/status")
        body = r.json()
        age = (datetime.strptime(r.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=ZoneInfo("UTC")) - iso(body["checkedAt"])).total_seconds()
        assert age <= PROBE_MAX_AGE_S + 1, age
        return body["services"][service] == value

    try:
        wait_real(lambda: api("GET", base, "/api/health").status_code == 200, BOOT_WAIT_S, f"copy boots\n{tail()}")
        wait_real(lambda: status_is("database", "up") and status_is("imageStore", "up"), SERVICE_WAIT_S, "services up")
        yield base, db, s3, status_is
        assert proc.poll() is None, tail()
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=HTTP_TIMEOUT_S)
        if db.server:
            db.down()
        if s3.server:
            s3.down()


def test_wf_cross_cutting_database_recovers(browser):
    with relay_copy() as (base, db, s3, status_is):
        with workspace(browser, base, CUR) as page:
            alerts = page.get_by_role("alert")
            db.down()
            wait_real(lambda: status_is("database", "down"), SERVICE_WAIT_S, "database probed down")
            again = alerts.filter(has_text=DB_BANNER).get_by_role("button", name="Try again", exact=True)
            eventually(page, lambda: focused(again), BANNER_DOWN_MS, "database banner holds focus")
            for key in ("Tab", "Shift+Tab"):
                page.keyboard.press(key)
                assert focused(again)
            db.up()
            wait_real(lambda: status_is("database", "up"), SERVICE_WAIT_S, "database probed up")
            eventually(page, lambda: alerts.filter(has_text=DB_BANNER).count() == 0
                       and focused(page.get_by_role("heading", level=1)), BANNER_UP_MS, "database banner released")
            assert "Database connection restored." in text_of(said(page))
            assert ledger(page).is_visible()


def test_wf_cross_cutting_recovery(browser):
    with relay_copy() as (base, db, s3, status_is):
        with workspace(browser, base, CUR) as page:
            page.evaluate("() => { window.__hangNoReload = 1; }")
            alerts = page.get_by_role("alert")
            assert alerts.filter(has_text=DB_BANNER).count() == 0 and alerts.filter(has_text=IMG_BANNER).count() == 0
            db.down()
            wait_real(lambda: status_is("database", "down"), SERVICE_WAIT_S, "database probed down")
            shows(page, alerts.filter(has_text=DB_BANNER), DB_BANNER, budget_ms=BANNER_DOWN_MS)
            db.up()
            wait_real(lambda: status_is("database", "up"), SERVICE_WAIT_S, "database probed up")
            eventually(page, lambda: alerts.filter(has_text=DB_BANNER).count() == 0, BANNER_UP_MS, "database banner gone")
            s3.down()
            wait_real(lambda: status_is("imageStore", "down"), SERVICE_WAIT_S, "image store probed down")
            shows(page, alerts.filter(has_text=IMG_BANNER), IMG_BANNER, budget_ms=BANNER_DOWN_MS)
            assert alerts.filter(has_text=DB_BANNER).count() == 0
            obj = new_object(base, "Recover")
            assert place(base, obj, "wall-north", free_slot(base, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2).status_code == 201
            err(upload(base, obj["id"], png_bytes(obj["id"]), "image/png"), 503, "image_store_unavailable")
            s3.up()
            wait_real(lambda: status_is("imageStore", "up"), SERVICE_WAIT_S, "image store probed up")
            eventually(page, lambda: alerts.filter(has_text=IMG_BANNER).count() == 0, BANNER_UP_MS, "image banner gone")
            assert upload(base, obj["id"], png_bytes(obj["id"]), "image/png").status_code == 201
            assert page.evaluate("() => window.__hangNoReload") == 1


def test_team_updates(browser, app_url):
    original = walls(app_url)["wall-west"]["plannedLux"]
    obj, pl = placed_work(app_url, "Team", wall_id="wall-south", room=GAP_MM)
    t = obj["title"]
    reset_preview(app_url)
    try:
        with workspace(browser, app_url, CUR) as page:
            def heard(sentence: str) -> None:
                eventually(page, lambda: sentence in text_of(team(page)), LIVE_UPDATE_MS, sentence)

            m = ok(move(app_url, pl, offsetMm=pl["offsetMm"] + 20))["placement"]
            heard(f"Ines Calloway moved {t} to {cm(m['offsetMm'])} from the left end.")
            ok(act(app_url, pl["id"], "claim", RUTH))
            heard(f"Ruth Okonkwo-Hale claimed {t}.")
            ok(act(app_url, pl["id"], "release", RUTH))
            heard(f"Ruth Okonkwo-Hale released {t}.")
            ok(act(app_url, pl["id"], "claim", RUTH))
            ok(act(app_url, pl["id"], "hang", RUTH))
            heard(f"Ruth Okonkwo-Hale marked {t} hung.")
            ok(upload(app_url, obj["id"], png_bytes(t), "image/png"), 201)
            heard(f"Tomasz Adeyemi attached a condition photo to {t}.")
            ok(act(app_url, pl["id"], "sign-off", REG))
            heard(f"Tomasz Adeyemi signed off {t}.")
            ok(api("PATCH", app_url, f"/api/objects/{obj['id']}", REG, {"registrarNote": "Rechecked"}))
            heard(f"Tomasz Adeyemi updated the record for {t}.")
            o2 = new_object(app_url, "Team two")
            heard(f"Tomasz Adeyemi added {o2['title']} to the loan register.")
            off = free_slot(app_url, "wall-north", o2["widthMm"] + GAP_MM) + o2["widthMm"] // 2
            p2 = ok(place(app_url, o2, "wall-north", off), 201)["placement"]
            heard(f"Ines Calloway placed {o2['title']} on North wall.")
            gone_ = ok(api("DELETE", app_url, f"/api/placements/{p2['id']}", CUR))
            heard(f"Ines Calloway removed {o2['title']} from North wall.")
            ok(api("POST", app_url, f"/api/undo/{gone_['undo']['actionId']}", CUR))
            heard(f"Ines Calloway put {o2['title']} back on North wall.")
            ok(api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": original + 1}))
            heard(f"Ines Calloway set West wall lighting to {original + 1} lux.")
            sched = ok(api("POST", app_url, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))["preview"]
            heard(f"Ines Calloway scheduled the lender preview for {sched['publishAtDisplay']}.")
            ok(api("POST", app_url, "/api/preview/cancel", CUR))
            heard("Ines Calloway cancelled the lender preview schedule.")
            h = handle(page, o2["title"])
            h.focus()
            page.keyboard.press("ArrowRight")
            eventually(page, lambda: placement(app_url, p2["id"])["offsetMm"] == off + 10, NUDGE_SAVE_MS + UI_MS, "own move saved")
            advance(page, LIVE_UPDATE_MS)
            assert f"Ines Calloway moved {o2['title']}" not in text_of(team(page))
        discard(app_url, p2["id"])
    finally:
        api("PATCH", app_url, "/api/walls/wall-west", CUR, {"plannedLux": original})
        reset_preview(app_url)


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_workspace_layouts(browser, app_url, size):
    with workspace(browser, app_url, CUR, size=VIEWPORTS[size]) as page:
        layout(page)
        if size == "desk":
            r, s, i = (x.bounding_box() for x in (rail(page), scene(page), page.get_by_role("region", name="Inspector")))
            assert r["x"] + r["width"] <= s["x"] + 1 and s["x"] + s["width"] <= i["x"] + 1
            assert page.get_by_role("button", name="Objects", exact=True).count() == 0
            assert page.get_by_role("button", name="Lender preview", exact=True).count() == 0
        for path in ("/records", "/records/obj-herring"):
            page.goto(app_url + path)
            shows(page, page.get_by_role("heading", level=1))
            layout(page)


SKIP_PAGES = {"workspace": "/", "register": "/records", "record": "/records/obj-herring", "lender_error": "/p/not-a-real-preview-token"}


@pytest.mark.parametrize("which", list(SKIP_PAGES), ids=list(SKIP_PAGES))
def test_skip_link_first(browser, app_url, which):
    with workspace(browser, app_url, None, path=SKIP_PAGES[which], ready=False) as page:
        shows(page, page.get_by_role("main"))
        page.keyboard.press("Tab")
        link = page.get_by_role("link", name="Skip to main content")
        assert focused(link) and link.is_visible()
        page.keyboard.press("Enter")
        eventually(page, lambda: holds_focus(page.get_by_role("main")), UI_MS, "focus in main")


def test_reduced_motion_everywhere(browser, app_url):
    obj = new_object(app_url, "Still")

    def calm(page: Page) -> None:
        for a in page.evaluate(ANIMS):
            assert a["end"] <= REDUCED_MAX_MS and a["iterations"] != -1, a

    with workspace(browser, app_url, CUR, reduced="reduce") as page:
        calm(page)
        for v in ("Wall", "Light", "Plan"):
            view_button(page, v).click()
            calm(page)
        card_button(page, obj["title"], "Place").click()
        calm(page)
        page.keyboard.press("Escape")
        calm(page)
    with workspace(browser, app_url, REG, path="/records", reduced="reduce", size=PHONE) as page:
        page.get_by_role("button", name="Add object", exact=True).click()
        calm(page)


def test_published_copy_verbatim(browser, app_url):
    obj = new_object(app_url, "Verbatim")
    with workspace(browser, app_url, CUR) as page:
        assert "Hangline" in page.get_by_role("banner").inner_text()
        c = card(page, obj["title"])
        shows(page, c)
        for s in ("Not placed", "No condition photo", "Ashgrove collection"):
            assert s in c.inner_text()
        assert "Plan view" in scene(page).inner_text()
        assert re.search(r"\b\d+ over budget\b", page.get_by_role("main").inner_text())
        assert page.get_by_role("heading", level=1, name=EXHIBITION).count() == 1
        assert page.get_by_role("heading", level=2, name=GALLERY).count() == 1
    query = f"none-{tag_of('q')}"
    matches = len(ok(api("GET", app_url, f"/api/objects?q={query}", REG))["objects"])
    with workspace(browser, app_url, REG, path=f"/records?q={query}") as page:
        shows(page, page.get_by_role("main"), "No records match.")
        assert text_of(page.get_by_role("status", name="Records count")) == f"{matches} records"
        page.goto(f"{app_url}/records/missing-{tag_of('r')}")
        shows(page, page.get_by_role("heading", level=1, name="That record doesn't exist."))
        page.goto(f"{app_url}/p/not-a-real-preview-token")
        shows(page, page.get_by_role("heading", level=1, name="This preview link isn't valid."))
    assert httpx.get(f"{app_url}/p/not-a-real-preview-token", timeout=HTTP_TIMEOUT_S).status_code == 404


def test_server_boundary(browser, app_url):
    filler = lambda n: json.dumps({"pad": "x" * n}).encode()
    over = filler(JSON_LIMIT - len(filler(0)) + 1)
    exact = filler(JSON_LIMIT - len(filler(0)))
    assert len(over) == JSON_LIMIT + 1 and len(exact) == JSON_LIMIT
    err(api("POST", app_url, "/api/placements", content=over, headers={"Content-Type": "application/json"}), 413, "body_too_large")
    assert api("POST", app_url, "/api/placements", CUR, content=exact, headers={"Content-Type": "application/json"}).status_code != 413
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/src/server.ts"):
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    err(api("GET", app_url, f"/api/nothing-{tag_of('p')}", CUR), 404, "not_found")
    e = err(api("GET", app_url, "/api/events?after=-1", CUR), 422, "validation_failed")
    assert "after" in e["fields"], e
    e = err(api("GET", app_url, "/api/objects?sort=colour", CUR), 422, "validation_failed")
    assert "sort" in e["fields"], e
    for method in ("GET", "OPTIONS"):
        r = httpx.request(method, app_url + "/api/staff", headers={"Origin": "http://elsewhere.example", "Access-Control-Request-Method": "POST"},
                          timeout=HTTP_TIMEOUT_S)
        assert not any(k.lower().startswith("access-control-allow-") for k in r.headers), dict(r.headers)
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")]
    pw = urlparse(os.environ.get("DATABASE_URL", "")).password or ""
    secrets = [s for s in secrets + [pw] if len(s) >= 6]
    bodies, urls = [], []
    with workspace(browser, app_url, CUR, ready=False) as page:
        page.on("response", lambda r: bodies.append(r))
        page.reload()
        shows(page, ledger(page))
        for r in bodies:
            urls.append(r.url)
            with contextlib.suppress(Exception):
                text = r.body().decode("utf-8", "ignore")
                assert not any(s in text for s in secrets), r.url
    assert all(same_origin(u, app_url) for u in urls if not u.startswith("data:")), urls


def test_if_run_manifest():
    m = json.loads(open(os.path.join(APP_DIR, "run.json")).read())
    assert set(m) == {"_schema", "install", "build", "serve"} and m["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in m.values())


def shipped() -> dict[tuple[str, str], str]:
    return {(p.name, p.version): p.licence for p in shipped_packages()}


def test_if_notices_name_packages():
    notices = open(os.path.join(APP_DIR, "THIRD_PARTY_NOTICES.md")).read()
    missing = sorted({n for n, _ in shipped() if n not in notices})
    assert not missing, missing
    assert "Instrument Serif" in notices and "Hanken Grotesk" in notices


def allowed(expr: str) -> bool:
    alternatives = re.split(r"\s+OR\s+", expr.strip().strip("()"))
    return any(all(p.strip("() ") in LICENCES for p in re.split(r"\s+AND\s+", alt)) for alt in alternatives)


def test_if_licences_allowed():
    bad = {k: v for k, v in shipped().items() if not allowed(v)}
    assert not bad, bad
    notices = open(os.path.join(APP_DIR, "THIRD_PARTY_NOTICES.md")).read()
    licence = re.search(r"OFL-1\.1|SIL Open Font Licen[cs]e", notices, re.I)
    for font in ("Instrument Serif", "Hanken Grotesk"):
        assert font in notices and licence, font


def test_if_no_other_datastore():
    names = {n for n, _ in shipped()}
    assert not names & {"sqlite3", "better-sqlite3", "sqlite", "redis", "ioredis", "lowdb", "nedb", "level"}, names
    hits = [os.path.join(d, f) for d, _, fs in os.walk(DEPLOYED_APP) if "node_modules" not in d
            for f in fs if f.endswith((".sqlite", ".sqlite3", ".db"))]
    assert not hits, hits


def test_if_services_unchanged(app_url):
    assert Postgres().rows("select 1 as ok") == [{"ok": 1}]
    assert isinstance(S3().keys(""), list)
    assert services(app_url) == {"database": "up", "imageStore": "up", "mailRelay": "up"}


def test_if_fonts_same_origin(browser, app_url):
    seen = []
    with workspace(browser, app_url, CUR, ready=False) as page:
        page.on("request", lambda r: seen.append((r.resource_type, r.url)))
        page.reload()
        shows(page, ledger(page))
        page.evaluate("() => document.fonts.ready.then(() => true)")
    fonts = [u for kind, u in seen if kind == "font"]
    assert fonts and all(same_origin(u, app_url) for u in fonts), fonts
    assert all(same_origin(u, app_url) for _, u in seen if not u.startswith("data:")), seen


def test_if_lockfile_used():
    assert os.path.exists(os.path.join(APP_DIR, "package-lock.json"))
    install = json.loads(open(os.path.join(APP_DIR, "run.json")).read())["install"]
    assert re.search(r"\bnpm (ci|install|i)\b", install), install


def own_change_quiet(page: Page, method: str, url_glob: str, trigger, sentence: str) -> None:
    seen: list = []

    def on_answer(r) -> None:
        if r.request.method == method and fnmatch.fnmatch(r.url, url_glob):
            seen.append(r)

    page.on("response", on_answer)
    try:
        trigger()
        eventually(page, lambda: bool(seen), UI_MS, "own change answered")
    finally:
        page.remove_listener("response", on_answer)
    assert seen[0].ok, seen[0].status
    page.get_by_role("status", name="Team updates", include_hidden=True).evaluate(TEXT_REC)
    for _ in range(int(2 * LIVE_UPDATE_MS / STEP_MS)):
        advance(page, STEP_MS)
    log = page.evaluate("() => window.__textRec")[1:]
    assert all(sentence not in t for t in log), log


def test_own_placement_not_announced(browser, app_url):
    obj = new_object(app_url, "Own place")
    off = free_slot(app_url, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
    with workspace(browser, app_url, CUR) as page:
        place_button = card_button(page, obj["title"], "Place")
        shows(page, place_button)
        place_button.click()
        dlg = page.get_by_role("dialog", name="Place work")
        shows(page, dlg)
        select(dlg.get_by_role("combobox", name="Wall"), "North wall")
        fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(off))
        save = dlg.get_by_role("button", name="Save placement", exact=True)
        own_change_quiet(page, "POST", "**/api/placements", save.click, f"{NAMES[CUR]} placed {obj['title']} on North wall.")
        eventually(page, lambda: handle(page, obj["title"]).count() == 1, UI_MS, "placed")


def test_own_nudge_not_announced(browser, app_url):
    obj, pl = placed_work(app_url, "Own nudge", room=GAP_MM)
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.focus()

        def nudge() -> None:
            page.keyboard.press("ArrowRight")
            advance(page, NUDGE_SAVE_MS)

        own_change_quiet(page, "PATCH", f"**/api/placements/{pl['id']}", nudge,
                         f"{NAMES[CUR]} moved {obj['title']} to {cm(pl['offsetMm'] + 10)} from the left end.")
    discard(app_url, pl["id"])


def test_own_removal_not_announced(browser, app_url):
    obj, pl = placed_work(app_url, "Own remove")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.click()
        remove = page.get_by_role("region", name="Inspector").get_by_role("button", name="Remove from wall", exact=True)
        real_target(remove)
        own_change_quiet(page, "DELETE", f"**/api/placements/{pl['id']}", lambda: pointer_click(remove),
                         f"{NAMES[CUR]} removed {obj['title']} from North wall.")
    discard(app_url, pl["id"])


def test_own_claim_not_announced(browser, app_url):
    obj, pl = placed_work(app_url, "Own claim", wall_id="wall-south")
    try:
        with workspace(browser, app_url, RUTH) as page:
            claim = card_button(page, obj["title"], "Claim")
            shows(page, claim)
            own_change_quiet(page, "POST", f"**/api/placements/{pl['id']}/claim", claim.click,
                             f"{NAMES[RUTH]} claimed {obj['title']}.")
    finally:
        act(app_url, pl["id"], "release", RUTH)
        discard(app_url, pl["id"])


def test_own_hang_not_announced(browser, app_url):
    obj, pl = placed_work(app_url, "Own hang", wall_id="wall-south")
    ok(act(app_url, pl["id"], "claim", RUTH))
    with workspace(browser, app_url, RUTH) as page:
        hang = card_button(page, obj["title"], "Mark hung")
        shows(page, hang)
        own_change_quiet(page, "POST", f"**/api/placements/{pl['id']}/hang", hang.click,
                         f"{NAMES[RUTH]} marked {obj['title']} hung.")


def test_own_schedule_not_announced(browser, app_url):
    reset_preview(app_url)
    try:
        with workspace(browser, app_url, CUR) as page:
            prev = page.get_by_role("region", name="Lender preview")
            box = prev.get_by_role("textbox", name="Preview date")
            shows(page, box)
            fill_field(box, WINTER_DATE.isoformat())
            schedule = prev.get_by_role("button", name="Schedule preview", exact=True)
            own_change_quiet(page, "POST", "**/api/preview/schedule", schedule.click,
                             f"{NAMES[CUR]} scheduled the lender preview")
    finally:
        reset_preview(app_url)


def test_own_withdrawal_not_announced(browser):
    base = env_url("APP_FAST_PUBLISH_URL")
    reset_preview(base)
    placed_work(base, "Own withdraw", lender="lender-fenwick")
    ok(api("POST", base, "/api/preview/schedule", CUR, {"date": WINTER_DATE.isoformat()}))
    wait_published(base)
    try:
        with workspace(browser, base, CUR) as page:
            withdraw = page.get_by_role("region", name="Lender preview").get_by_role("button", name="Withdraw preview", exact=True)
            shows(page, withdraw)
            own_change_quiet(page, "POST", "**/api/preview/withdraw", withdraw.click,
                             f"{NAMES[CUR]} withdrew the lender preview.")
    finally:
        reset_preview(base)


def test_place_save_ignores_repeat_press(browser, app_url):
    obj = new_object(app_url, "Patient")
    off = free_slot(app_url, "wall-north", obj["widthMm"]) + obj["widthMm"] // 2
    with workspace(browser, app_url, CUR) as page:
        shows(page, card(page, obj["title"]))
        posts = requests_seen(page, "POST", "/api/placements")
        card_button(page, obj["title"], "Place").focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Place work")
        eventually(page, lambda: holds_focus(dlg), UI_MS, "dialog focus")
        select(dlg.get_by_role("combobox", name="Wall"), "North wall")
        fill_field(dlg.get_by_role("textbox", name="Offset from left end"), cm_input(off))
        tab_to(page, dlg.get_by_role("button", name="Save placement", exact=True))
        with held(page, "**/api/placements"):
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            eventually(page, lambda: len(posts) >= 1, UI_MS, "placement sent")
            advance(page, STEP_TOL_MS)
            assert dlg.is_visible(), "a press while the save was pending closed the dialog"
        eventually(page, lambda: gone(dlg) and focused(handle(page, obj["title"])), UI_MS, "placed, focus on handle")
        assert f"{obj['title']} placed on North wall." in text_of(said(page))
        assert len(posts) == 1, [r.url for r in posts]
    assert len([p for p in placements(app_url) if p["objectId"] == obj["id"]]) == 1


def test_details_save_ignores_repeat_press(browser, app_url):
    obj, pl = placed_work(app_url, "Once", room=GAP_MM * 2)
    exact = pl["offsetMm"] + 150
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        patches = requests_seen(page, "PATCH", pl["id"])
        h.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Placement details")
        eventually(page, lambda: holds_focus(dlg), UI_MS, "details focus")
        box = dlg.get_by_role("textbox", name="Offset from left end")
        tab_to(page, box)
        page.keyboard.press("Control+a")
        page.keyboard.type(cm_input(exact))
        tab_to(page, dlg.get_by_role("button", name="Save", exact=True))
        with held(page, f"**/api/placements/{pl['id']}"):
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            eventually(page, lambda: len(patches) >= 1, UI_MS, "save sent")
            advance(page, STEP_TOL_MS)
        eventually(page, lambda: gone(dlg) and focused(h) and cm(exact) in row(page, obj["title"]).inner_text(), UI_MS, "saved")
        assert f"{obj['title']} moved to {cm(exact)} from the left end." in text_of(said(page))
        assert len(patches) == 1, len(patches)
    assert placement(app_url, pl["id"])["offsetMm"] == exact
    discard(app_url, pl["id"])


def test_undo_refused_by_hang_rules(browser, app_url):
    obj, pl = placed_work(app_url, "Refused")
    with workspace(browser, app_url, CUR) as page:
        h = handle(page, obj["title"])
        shows(page, h)
        h.click()
        remove = page.get_by_role("region", name="Inspector").get_by_role("button", name="Remove from wall", exact=True)
        tab_to(page, remove)
        page.keyboard.press("Enter")
        undo = page.get_by_role("region", name="Undo").get_by_role("button", name="Undo", exact=True)
        eventually(page, lambda: focused(undo), UI_MS, "focus on Undo")
        blocker = new_object(app_url, "Blocker")
        pb = ok(place(app_url, blocker, "wall-north", pl["offsetMm"]), 201)["placement"]
        page.keyboard.press("Enter")
        want = f"Too close to {blocker['title']}: keep at least 20 cm between works."
        eventually(page, lambda: want in text_of(said(page))
                   and focused(page.get_by_role("heading", name="Scene ledger")), UI_MS, "refused undo")
    assert placement(app_url, pl["id"]) is None
    discard(app_url, pb["id"])


@pytest.mark.parametrize("size", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_register_record_link_tappable(browser, app_url, size):
    obj = new_object(app_url, "Tap target", lender="lender-oduya")
    with workspace(browser, app_url, REG, size=VIEWPORTS[size], path=f"/records?q={obj['objectNumber']}") as page:
        shows(page, page.get_by_role("heading", level=1, name="Loan register"))
        records = page.get_by_role("table" if size == "desk" else "list", name="Loan register")
        shows(page, records, obj["title"])
        link = records.get_by_role("link", name=obj["title"], exact=True)
        assert link.get_attribute("href").endswith(f"/records/{obj['id']}")
        if size != "desk":
            real_target(link)


def test_photo_key_reuse_on_missing_object(app_url):
    obj = new_object(app_url, "Key reuse")
    key = idempotency_key()
    ok(upload(app_url, obj["id"], png_bytes(obj["id"]), "image/png", key), 201)
    oid = obj["id"]
    shapes = [oid[:-1] + c for c in "0123456789abcdef" if c != oid[-1]] + [oid + "0" * n for n in (1, 2, 3)]
    missing = next((c for c in shapes if api("GET", app_url, f"/api/objects/{c}", REG).status_code == 404), None)
    assert missing, "no unused object id"
    for payload in (png_bytes(obj["id"]), png_bytes("other " + obj["id"])):
        err(upload(app_url, missing, payload, "image/png", key), 404, "not_found")
    assert len(obj_get(app_url, obj["id"])["photos"]) == 1


def test_photo_unknown_staff_before_key_format(app_url):
    obj = new_object(app_url, "Key form")
    payload = png_bytes(obj["id"])
    for bad in ("k" * 65, "not a key!"):
        for who in ("", f"nobody-{tag_of('staff')}"):
            err(upload(app_url, obj["id"], payload, "image/png", bad, staff=who), 401, "unknown_staff")
    assert obj_get(app_url, obj["id"])["photos"] == []
