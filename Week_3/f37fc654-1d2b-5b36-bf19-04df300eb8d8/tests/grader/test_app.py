from __future__ import annotations

import base64
import hashlib
import hmac
import html as htmllib
import json
import os
import random
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    Keycloak,
    KillBill,
    Mailpit,
    Ntfy,
    Postgres,
    S3,
    Svix,
    WireMock,
    addresses,
    advance,
    animations,
    axe,
    camera,
    capture,
    changed,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    pdf_text,
    same_origin,
    scene_frames,
    settle,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    tap,
    text,
    unique,
)


Q = {
    1: "What should stand in the room?",
    2: "Where will it stand?",
    3: "How big is the room?",
    4: "Which wall has the main door?",
    5: "How many people at once?",
    6: "Anything else to try?",
}
INTRO = "Hi. Six questions, then your room."
READY = "Your room is ready."
HEADLINE = "Light for dark rooms, made to commission."
CAPTIONS = [
    "A wall that sees the room.",
    "It answers the people in front of it.",
    "Built for one venue, by hand.",
    "Up close, it's light.",
    "In your room, on your day.",
]
CASE_STUDIES = ["Tidewall", "Second Face", "Echo Vault"]
SIGNIN_ERROR_HEADING = "Sign-in didn't complete"
SIGNIN_ERROR_TEXT = "That sign-in link has expired, was already used or was opened in a different browser. Start again from Sign in."
SESSION_ENDED = "Your session ended. Sign in again — what you entered is kept."
TEXT_HINT = "ENTER ↵ · SHIFT+ENTER new line"
CHIP_HINT = "ENTER ↵ to continue"
CURSOR_TAG = "SPINDRIFT"
WIDTH_MSG = "Enter a width from 4 to 60 metres in half-metre steps."
DEPTH_MSG = "Enter a depth from 4 to 60 metres in half-metre steps."
QUOTE_EXPIRED = "This quote has expired. Refresh the quote to continue."
CONFLICT_COPY = "This layout changed in another window. Showing the latest version."
UNSAFE_REF = "That address can't be used for a reference image."
BANNERS = {
    "Kill Bill": "Payments are paused — our billing system isn't answering. Nothing has been charged.",
    "Mailpit": "Emails are delayed — receipts and notices will arrive once our mail service is back.",
    "MinIO": "Uploads are paused — our file store isn't answering. Nothing was saved.",
    "Gotenberg": "Documents are delayed — PDFs will appear here once our document service is back.",
    "Svix": "CRM updates are delayed — they'll be sent once our webhook service is back.",
    "ntfy": "Crew alerts are delayed — they'll be posted once our alert service is back.",
    "Render provider": "Concept previews are delayed — requests are queued and will start once our render partner is back.",
    "Keycloak": "Sign-in is paused — our sign-in service isn't answering. If you're already signed in, you can keep working for now.",
}
OUTAGES = {
    "killbill": ("APP_KILLBILL_DOWN_URL", "killbill", "Kill Bill"),
    "mailpit": ("APP_MAILPIT_DOWN_URL", "mailpit", "Mailpit"),
    "minio": ("APP_MINIO_DOWN_URL", "minio", "MinIO"),
    "gotenberg": ("APP_GOTENBERG_DOWN_URL", "gotenberg", "Gotenberg"),
    "svix": ("APP_SVIX_DOWN_URL", "svix", "Svix"),
    "ntfy": ("APP_NTFY_DOWN_URL", "ntfy", "ntfy"),
    "render-provider": ("APP_WIREMOCK_DOWN_URL", "renderProvider", "Render provider"),
    "keycloak": ("APP_KEYCLOAK_DOWN_URL", "keycloak", "Keycloak"),
}
STATUS_KEYS = ["postgres", "keycloak", "killbill", "mailpit", "minio", "gotenberg", "svix", "ntfy", "renderProvider"]

SEEDED = {
    "producer": ("mara@spindrift.test", "Spindrift-Producer-26"),
    "client": ("theo@northwake.test", "Northwake-Client-26"),
    "crew": ("jonah@crew.spindrift.test", "Crew-Jonah-26"),
}
AMA = ("ama@crew.spindrift.test", "Crew-Ama-26")
LANDING = {"producer": "/studio", "client": "/commissions", "crew": "/crew"}

VENUES = {
    "halsted-works": ("Halsted Works Hall", "America/Chicago", 1025),
    "pier-nine": ("Pier Nine Pavilion", "America/Los_Angeles", 1035),
    "lantern-court": ("Lantern Court Museum Lobby", "America/Denver", 881),
    "saltmarsh-grounds": ("Saltmarsh Festival Grounds", "America/Phoenix", 860),
    "brightwater-atrium": ("Brightwater Atrium", "America/New_York", 888),
}
MAIN_PRICE = {"camera-reactive-wall": 1_800_000, "portrait-kiosk": 950_000, "projection-room": 2_600_000}
SIZE_PRICE = {"compact": 0, "standard": 350_000, "grand": 725_000}
EXTRA_PRICE = {"ambient-sound": 180_000, "night-lighting": 240_000, "photo-takeaway": 115_000}
EX_SUBTOTAL = 2_390_000
EX_TAX = 244_975
EX_TOTAL = 2_634_975
EX_TAX_PARTS = [122_487, 61_244, 61_244]
EX_SPONSOR_A = 658_744
EX_DEPOSIT = 526_995
EX_CONCEPT_TAX = 24_498
EX_LATER_TAX = 24_497
ESSENTIAL_CENTS = 24_000
PHOTO_LIMIT = 12_582_912
JSON_LIMIT = 65_536
CALLBACK_LIMIT = 16_777_216
NOTES_LIMIT = 2_000
TITLE_MAX = 80
TIMESTAMP_WINDOW_S = 300
BOOK_MIN_DAYS = 21
BOOK_MAX_DAYS = 365
DAYS_SPAN = 60
DUE_DAYS = 14
QUOTE_DAYS = 14
LOAD_IN_HOUR = 9
BOARD_S = 2
BANNER_S = 15
STATUS_CACHE_S = 5
JOB_EFFECT_S = 30
HOLD_END_JOB_S = 10
TOAST_S = 6
DEBOUNCE_MS = 250
LETTER_START_S = 0.4
LETTER_STEP_S = 0.04
TIME_TOLERANCE_S = 0.1
WHITE_AFTER_S = 0.6
CONTROLS_RISE_S = 1.4
DUST_BEFORE = 60
DUST_25_100 = 80
INSPECTOR_PX = 360
SCENE_SHARE = 0.55
SHEET_SHARE = 0.6
TARGET_PX = 44
KEYFRAMES = 5
GRID = 0.25
TURN_DEG = 15
TAX_DIVISOR = 10_000
STATE_MIN_CHARS = 22
MONTHS_AHEAD = 13
TOPIC = "spindrift-crew"
PROVIDER_JOB = "rp_baseline_0001"
RENDER_SECRET = os.environ.get("RENDER_WEBHOOK_SECRET") or "spindrift-render-dev-secret"


HTTP_TIMEOUT = 60
WAIT_S = 40
JOB_S = 50
POLL_S = 0.25
TAB_LIMIT = 90
HOLD_TRIES = 6
RELAY_MAX_CONNECTIONS = 10_000
CARD = "4242 4242 4242 4242"
CARD_NAME = "Sam Payer"
SIGNER = "Sam Signer"
NOTES = "Keep the north wall dark."
SPOTS = [(6.0, 8.0), (2.0, 3.0), (10.0, 3.0), (6.0, 5.0)]

_GAP = threading.Event()
USED_DAYS: set[tuple[str, str]] = set()
VENUE_OF: dict[str, str] = {}
_PRODUCERS: dict[str, "Api"] = {}

OPACITY_JS = "el => { let o = 1; for (let n = el; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity); return o; }"
FOCUSED_JS = "el => el === document.activeElement || el.contains(document.activeElement)"
LETTERS_JS = "el => Array.from(el.querySelectorAll('[data-letter]'), n => n.getAttribute('data-letter'))"
MARK_FOCUS_JS = "() => { window.__kbFocus = document.activeElement; }"
SAME_FOCUS_JS = "() => window.__kbFocus === document.activeElement"
LAST_LETTER_JS = "el => { const n = el.querySelectorAll('[data-letter]'); return n.length ? n[n.length - 1].getBoundingClientRect().right : el.getBoundingClientRect().right; }"


def poll(fetch: Callable[[], Any], ok: Callable[[Any], bool], contract: str, seconds: float = JOB_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if ok(last):
            return last
        _GAP.wait(POLL_S)
    pytest.fail(f"{contract} (last seen: {str(last)[:400]})")


def pump(page: Page, ready: Callable[[], bool], contract: str, seconds: float = WAIT_S, step_ms: float = 100) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if ready():
                return
            advance(page, step_ms)
        except PlaywrightError:
            continue
    pytest.fail(contract)


def visible(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and bool(loc.first.evaluate("el => el === document.activeElement"))


def opacity(loc: Locator) -> float:
    return float(loc.first.evaluate(OPACITY_JS))


def text_of(loc: Locator) -> str:
    return loc.first.inner_text().strip() if loc.count() else ""


def parse_ts(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def served_at(r: httpx.Response) -> datetime:
    stamp = r.headers.get("date")
    return parsedate_to_datetime(stamp) if stamp else datetime.now(timezone.utc)


def usd(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    cents = abs(cents)
    return f"{sign}${cents // 100:,}.{cents % 100:02d}"


def date_re(d: date) -> str:
    return rf"{d.strftime('%a')} 0?{d.day} {d.strftime('%b')} {d.year}"


def kb_cents(value: Any) -> int:
    return int((Decimal(str(value)) * 100).to_integral_value())


def tax_of(subtotal: int, bp: int) -> int:
    return (subtotal * bp + TAX_DIVISOR // 2) // TAX_DIVISOR


def split(amount: int, weights: list[int]) -> list[int]:
    parts = [amount * w // TAX_DIVISOR for w in weights]
    rems = [amount * w % TAX_DIVISOR for w in weights]
    order = sorted(range(len(weights)), key=lambda i: (-rems[i], i))
    for i in order[: amount - sum(parts)]:
        parts[i] += 1
    return parts


def _code(r: httpx.Response) -> str | None:
    try:
        body = r.json()
    except ValueError:
        return None
    err = body.get("error") if isinstance(body, dict) else None
    return err.get("code") if isinstance(err, dict) else None


def new_title() -> str:
    return f"Piece {uuid.uuid4().hex[:10]}"


def identity(prefix: str) -> tuple[str, str]:
    a, b = unique(prefix)
    return (b, a) if "@" in a else (a, b)


def outage_base(env: str) -> str:
    url = os.environ.get(env)
    if not url:
        pytest.fail(f"{env} is not set; expected the verifier to publish that outage instance")
    return url.rstrip("/")


def short_base() -> str:
    return outage_base("APP_SHORT_URL")


def png_bytes() -> bytes:
    def chunk(tag: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + tag + data + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    raw = b"".join(b"\x00" + bytes([40, 80, 200]) * 2 for _ in range(2))
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
            + chunk(b"tEXt", b"ref\x00" + uuid.uuid4().hex.encode()) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def jpeg_bytes() -> bytes:
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00" + uuid.uuid4().bytes + b"\xff\xd9"


def pdf_bytes() -> bytes:
    return b"%PDF-1.4\n% " + uuid.uuid4().hex.encode() + b"\n%%EOF\n"


def glb_bytes(version: int = 2, length_delta: int = 0) -> bytes:
    js = json.dumps({"asset": {"version": "2.0"}, "extras": uuid.uuid4().hex}).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js)
    return b"glTF" + struct.pack("<II", version, total + length_delta) + struct.pack("<I", len(js)) + b"JSON" + js


def padded(head: bytes, size: int) -> bytes:
    return head + b"\x00" * (size - len(head))


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.me: dict[str, Any] = {}
        self.email = ""
        self.password = ""
        self.landing = ""

    def request(self, method: str, path: str, **kw: Any) -> httpx.Response:
        r = self.http.request(method, path, **kw)
        if r.status_code == 401 and _code(r) == "session_expired":
            self.http.post("/auth/refresh")
            r = self.http.request(method, path, **kw)
        return r

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("POST", path, **kw)

    def put(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("PUT", path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.request("DELETE", path, **kw)

    def ok(self, method: str, path: str, status: int, **kw: Any) -> Any:
        r = self.request(method, path, **kw)
        assert r.status_code == status, f"{method} {path} answered {r.status_code} {r.text[:500]}; expected {status}"
        return r.json() if r.content else None


def _form(markup: str, page_url: str) -> str:
    for tag in re.findall(r"<form\b[^>]*>", markup, flags=re.I):
        m = re.search(r'action="([^"]+)"', tag)
        if m:
            return urljoin(page_url, htmllib.unescape(m.group(1)))
    pytest.fail("The Keycloak page carried no form; expected /auth/login to lead to the Keycloak sign-in page (L478)")


def _on_base(base: str, url: str) -> str:
    parts = urlparse(url)
    return f"{base}{parts.path}" + (f"?{parts.query}" if parts.query else "")


def keycloak_page(api: Api, return_to: str | None) -> httpx.Response:
    start = api.http.get("/auth/login", params={"returnTo": return_to} if return_to else None)
    assert start.status_code == 302, f"GET /auth/login answered {start.status_code}; expected 302 to Keycloak (L478)"
    page = api.http.get(start.headers["location"], follow_redirects=True)
    assert page.status_code == 200, f"Keycloak sign-in page answered {page.status_code}"
    return page


def finish(api: Api, done: httpx.Response) -> None:
    loc = done.headers.get("location", "")
    if not done.is_redirect or "/auth/callback" not in loc:
        pytest.fail(f"Keycloak answered {done.status_code} without returning to /auth/callback (L479)")
    back = api.http.get(_on_base(api.base, loc))
    assert back.status_code == 302, f"/auth/callback answered {back.status_code}; expected 302 to returnTo (L479)"
    target = urlparse(back.headers["location"])
    api.landing = target.path + (f"?{target.query}" if target.query else "")
    api.me = api.ok("GET", "/api/me", 200)


def sign_in(base: str, email: str, password: str, return_to: str | None = None) -> Api:
    api = Api(base)
    page = keycloak_page(api, return_to)
    finish(api, api.http.post(_form(page.text, str(page.url)), data={"username": email, "password": password, "credentialId": ""}))
    api.email, api.password = email, password
    return api


def register(base: str, prefix: str = "client", email: str | None = None) -> Api:
    name, generated = identity(prefix)
    email = email or generated
    password = f"Spindrift-{uuid.uuid4().hex[:12]}"
    api = Api(base)
    page = keycloak_page(api, None)
    link = re.search(r'href="([^"]*registration[^"]*)"', page.text)
    if not link:
        pytest.fail("Keycloak offered no registration link; expected self-registration for first-time clients (L41)")
    form = api.http.get(urljoin(str(page.url), htmllib.unescape(link.group(1))), follow_redirects=True)
    last = re.sub(r"[^A-Za-z]", "", name)[:20] or "Visitor"
    done = api.http.post(_form(form.text, str(form.url)), data={
        "firstName": "Sam", "lastName": last, "email": email, "username": email,
        "password": password, "password-confirm": password})
    finish(api, done)
    api.email, api.password = email, password
    return api


def producer(base: str) -> Api:
    if base not in _PRODUCERS:
        _PRODUCERS[base] = sign_in(base, *SEEDED["producer"])
    return _PRODUCERS[base]


def cookie_list(api: Api) -> list[dict[str, Any]]:
    host = urlparse(api.base).hostname
    return [{"name": c.name, "value": c.value, "url": api.base} for c in api.http.cookies.jar if c.domain.lstrip(".") in (host, f"{host}.local")]


@contextmanager
def app_page(browser: Browser, base: str, path: str, *, api: Api | None = None, size: tuple[int, int] = (1280, 800),
             reduced: bool = False, no_webgl: bool = False) -> Iterator[Page]:
    with open_app(browser, f"{base}/api/health", reduced_motion="reduce" if reduced else "no-preference", no_webgl=no_webgl) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if api is not None:
            page.context.add_cookies(cookie_list(api))
        if path != "/api/health":
            page.goto(base + path)
        yield page


def browser_sign_in(page: Page, base: str, email: str, password: str) -> None:
    pump(page, lambda: not page.url.startswith(base), "the app sent the browser to Keycloak to sign in (L248)")
    page.wait_for_load_state()
    action = _form(page.content(), page.url)
    cookie = "; ".join(f"{c['name']}={c['value']}" for c in page.context.cookies(action))
    with httpx.Client(timeout=HTTP_TIMEOUT) as kc:
        r = kc.post(action, data={"username": email, "password": password, "credentialId": ""}, headers={"Cookie": cookie})
    loc = r.headers.get("location", "")
    assert "/auth/callback" in loc, f"Keycloak answered {r.status_code} without the app callback"
    page.goto(_on_base(base, loc))


def tab_to(page: Page, target: Locator, contract: str) -> None:
    for _ in range(TAB_LIMIT):
        if focused(target):
            return
        page.keyboard.press("Tab")
        advance(page, 50)
    if not focused(target):
        pytest.fail(contract)


def new_brief(api: Api, *, kind: str = "camera-reactive-wall", title: str | None = None, venue: str = "halsted-works",
              width: float = 12, depth: float = 9, door: str = "front", audience: str = "up-to-25",
              addons: tuple[str, ...] = (), notes: str = NOTES, through: int = 6) -> dict[str, Any]:
    title = title or new_title()
    b = api.ok("POST", "/api/briefs", 201, json={})
    answers = [{"installationType": kind, "title": title}, {"venueId": venue}, {"widthM": width, "depthM": depth},
               {"doorWall": door}, {"audience": audience}, {"addOns": list(addons), "notes": notes}]
    for n, a in enumerate(answers[:through], start=1):
        api.ok("PUT", f"/api/briefs/{b['id']}/steps/{n}", 200, json={"answer": a})
    if through < 6:
        return {"briefId": b["id"], "title": title}
    c = api.ok("POST", f"/api/briefs/{b['id']}/complete", 201)
    c["briefId"] = b["id"]
    VENUE_OF[c["id"]] = venue
    return c


def commission(api: Api, cid: str) -> dict[str, Any]:
    return api.ok("GET", f"/api/commissions/{cid}", 200)


def wait_state(api: Api, cid: str, state: str, seconds: float = JOB_S) -> dict[str, Any]:
    return poll(lambda: commission(api, cid), lambda c: c["state"] == state, f"commission {cid} reached state {state}", seconds)


def upload(api: Api, cid: str, kind: str, name: str, data: bytes) -> httpx.Response:
    return api.post(f"/api/commissions/{cid}/files", data={"kind": kind}, files={"file": (name, data, "application/octet-stream")})


def stored(api: Api, cid: str, kind: str, name: str, data: bytes) -> dict[str, Any]:
    r = upload(api, cid, kind, name, data)
    assert r.status_code == 201, f"upload answered {r.status_code} {r.text[:300]}; expected 201 (L535)"
    return r.json()


def provider_requests(wiremock: WireMock, rid: str) -> list[tuple[dict[str, Any], dict[str, Any]]]:
    out = []
    for entry in wiremock.requests("/v1/renders"):
        req = entry.get("request", entry)
        try:
            body = json.loads(req.get("body") or "{}")
        except ValueError:
            continue
        if isinstance(body, dict) and body.get("jobRef") == rid:
            out.append((req, body))
    return out


def provider_request(wiremock: WireMock, rid: str) -> tuple[dict[str, Any], dict[str, Any]]:
    return poll(lambda: provider_requests(wiremock, rid), bool, f"the provider received POST /v1/renders with jobRef {rid} (L926)")[0]


def header(req: dict[str, Any], name: str) -> str | None:
    for k, v in (req.get("headers") or {}).items():
        if k.lower() == name.lower():
            if isinstance(v, dict):
                v = v.get("values") or [v.get("value")]
            return v[0] if isinstance(v, list) else v
    return None


def render_callback(base: str, payload: Any = None, *, ts: int | None = None, secret: str | None = None,
                    raw: bytes | None = None, signature: str | None = None) -> httpx.Response:
    body = raw if raw is not None else json.dumps(payload).encode()
    stamp = str(int(time.time()) if ts is None else ts)
    sig = signature or "v1=" + hmac.new((secret or RENDER_SECRET).encode(), stamp.encode() + b"." + body, hashlib.sha256).hexdigest()
    return httpx.post(f"{base}/api/render-callbacks", content=body, timeout=HTTP_TIMEOUT,
                      headers={"Content-Type": "application/json", "X-Render-Timestamp": stamp, "X-Render-Signature": sig})


def render_event(rid: str, kind: str, progress: int, **extra: Any) -> dict[str, Any]:
    return {"eventId": str(uuid.uuid4()), "jobRef": rid, "providerJobId": PROVIDER_JOB, "type": kind, "progress": progress, **extra}


def request_render(api: Api, wiremock: WireMock, cid: str, photo_id: str) -> str:
    rid = api.ok("POST", f"/api/commissions/{cid}/renders", 202, json={"venuePhotoFileId": photo_id})["id"]
    provider_request(wiremock, rid)
    return rid


def finish_render(api: Api, rid: str, png: bytes | None = None) -> None:
    png = png or png_bytes()
    r = render_callback(api.base, render_event(rid, "render.completed", 100, preview={"contentType": "image/png", "base64": b64(png)}))
    assert r.status_code == 204, f"completed callback answered {r.status_code}; expected 204 (L552)"
    poll(lambda: api.ok("GET", f"/api/renders/{rid}", 200), lambda x: x["state"] == "ready", f"render {rid} became ready (L790)")


def previewed(api: Api, wiremock: WireMock, **kw: Any) -> dict[str, Any]:
    c = new_brief(api, **kw)
    photo = stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
    rid = request_render(api, wiremock, c["id"], photo["id"])
    finish_render(api, rid)
    out = wait_state(api, c["id"], "previewed")
    out.update(renderId=rid, photoId=photo["id"], briefId=c["briefId"])
    return out


def piece_kinds(c: dict[str, Any]) -> list[str]:
    return [p if isinstance(p, str) else p["kind"] for p in c["requiredPieces"]]


def full_layout(c: dict[str, Any]) -> list[dict[str, Any]]:
    return [{"kind": k, "x": x, "y": y, "rotationDeg": 0} for k, (x, y) in zip(piece_kinds(c), SPOTS)]


def placed(api: Api, wiremock: WireMock, *, size: str = "compact", **kw: Any) -> dict[str, Any]:
    c = previewed(api, wiremock, **kw)
    api.ok("PUT", f"/api/commissions/{c['id']}/options", 200, json={"size": size, "addOns": list(kw.get("addons", ()))})
    fresh = commission(api, c["id"])
    api.ok("PUT", f"/api/commissions/{c['id']}/layout", 200, json={"version": fresh["layout"]["version"], "items": full_layout(fresh)})
    out = wait_state(api, c["id"], "placed")
    out.update(renderId=c["renderId"], photoId=c["photoId"], briefId=c["briefId"])
    return out


def server_today(api: Api, zone: str) -> date:
    return served_at(api.http.get("/api/health")).astimezone(ZoneInfo(zone)).date()


def day_statuses(api: Api, venue: str, start: date, end: date) -> dict[str, str]:
    r = api.ok("GET", f"/api/venues/{venue}/days", 200, params={"from": start.isoformat(), "to": end.isoformat()})
    return {d["date"]: d["status"] for d in r["days"]}


def pick_day(api: Api, venue: str) -> date:
    today = server_today(api, VENUES[venue][1])
    for _ in range(HOLD_TRIES):
        start = today + timedelta(days=random.randint(BOOK_MIN_DAYS + 7, BOOK_MAX_DAYS - DAYS_SPAN - 7))
        free = [d for d, s in day_statuses(api, venue, start, start + timedelta(days=DAYS_SPAN)).items()
                if s == "free" and (venue, d) not in USED_DAYS]
        if free:
            d = random.choice(free)
            USED_DAYS.add((venue, d))
            return date.fromisoformat(d)
    pytest.fail(f"GET /api/venues/{venue}/days listed no free day in the bookable window (L739)")


def hold_day(api: Api, c: dict[str, Any], d: date | None = None) -> tuple[date, dict[str, Any]]:
    venue = VENUE_OF[c["id"]]
    for _ in range(HOLD_TRIES):
        day = d or pick_day(api, venue)
        r = api.post(f"/api/commissions/{c['id']}/hold", json={"date": day.isoformat()})
        if r.status_code == 201:
            return day, r.json()
        if _code(r) != "day_taken" or d is not None:
            pytest.fail(f"POST hold answered {r.status_code} {r.text[:300]}; expected 201 (L570)")
    pytest.fail("every picked day was taken; expected a free day to hold")


def sign(api: Api, cid: str) -> dict[str, Any]:
    return api.ok("POST", f"/api/commissions/{cid}/sign", 201, json={"signatureName": SIGNER, "acceptTerms": True})


def pay(api: Api, path: str, key: str | None = None, name: str = CARD_NAME, card: str = CARD) -> httpx.Response:
    return api.post(path, json={"nameOnCard": name, "cardNumber": card}, headers={"Idempotency-Key": key or idempotency_key()})


def milestone(c: dict[str, Any], label: str) -> dict[str, Any]:
    return next(m for m in c["milestones"] if m["label"] == label)


def pay_label(api: Api, cid: str, label: str) -> dict[str, Any]:
    m = milestone(commission(api, cid), label)
    r = pay(api, f"/api/milestones/{m['id']}/payments")
    assert r.status_code == 201, f"paying {label} answered {r.status_code} {r.text[:300]}; expected 201 (L585)"
    return r.json()


def contracted(api: Api, wiremock: WireMock, **kw: Any) -> dict[str, Any]:
    c = placed(api, wiremock, **kw)
    day, _ = hold_day(api, c)
    s = sign(api, c["id"])
    r = pay(api, f"/api/milestones/{s['depositMilestoneId']}/payments")
    assert r.status_code == 201, f"deposit payment answered {r.status_code} {r.text[:300]}"
    out = wait_state(api, c["id"], "contracted")
    out.update(day=day, renderId=c["renderId"], photoId=c["photoId"], briefId=c["briefId"], deposit=r.json())
    return out


def transition(api: Api, cid: str, to: str) -> httpx.Response:
    return api.post(f"/api/commissions/{cid}/transitions", json={"to": to})


def deliver(client: Api, prod: Api, cid: str, until: str) -> dict[str, Any]:
    steps = [("concept_approved", client, "Concept approval"), ("fabricating", prod, "Fabrication"),
             ("installed", prod, None), ("accepted", client, "Signed acceptance")]
    for to, who, label in steps:
        r = transition(who, cid, to)
        assert r.status_code == 200, f"transition to {to} answered {r.status_code} {r.text[:300]} (L531)"
        if label:
            pay_label(client, cid, label)
        if to == until:
            break
    return commission(client, cid)


def mails(mail: Mailpit, to: str, subject: str, minimum: int = 1, seconds: float = JOB_S) -> list[dict[str, Any]]:
    def fetch() -> list[dict[str, Any]]:
        return [m for m in mail.messages() if to in addresses(m.get("To")) and m.get("Subject") == subject]
    return poll(fetch, lambda ms: len(ms) >= minimum, f"Mailpit received {subject!r} for {to}", seconds)


def crew_alerts(ntfy: Ntfy, needle: str) -> list[dict[str, Any]]:
    return [m for m in ntfy.messages(TOPIC) if needle in f"{m.get('title', '')} {m.get('message', '')}"]


def invite_tokens(mail: Mailpit, email: str, title: str) -> list[str]:
    found: list[str] = []
    for m in mail.messages():
        if email in addresses(m.get("To")) and m.get("Subject") == f"You're invited to co-fund {title}":
            found += re.findall(r"/i/([A-Za-z0-9_\-]+)", text(m))
    return list(dict.fromkeys(found))


def new_token(mail: Mailpit, email: str, title: str, seen: list[str]) -> str:
    toks = poll(lambda: [t for t in invite_tokens(mail, email, title) if t not in seen], bool, f"an invite email for {email} (L877)")
    return toks[-1]


def funders_body(weights: list[int], sponsors: list[tuple[str, str]]) -> dict[str, Any]:
    rows: list[dict[str, Any]] = [{"kind": "client", "bp": weights[0]}]
    rows += [{"kind": "sponsor", "name": n, "email": e, "bp": w} for (n, e), w in zip(sponsors, weights[1:])]
    return {"funders": rows}


def sponsors(n: int) -> list[tuple[str, str]]:
    return [identity("sponsor") for _ in range(n)]


def kb_account(killbill: KillBill, api: Api) -> dict[str, Any]:
    return poll(lambda: killbill.account_by_key(api.me["id"]), bool, f"Kill Bill account with external key {api.me['id']} (L866)")


def kb_invoice(killbill: KillBill, account_id: str, invoice_id: str) -> dict[str, Any]:
    return poll(lambda: next((i for i in killbill.invoices(account_id) if i.get("invoiceId") == invoice_id), None), bool,
                f"Kill Bill invoice {invoice_id}")


def kb_keys(killbill: KillBill, account_id: str) -> list[str]:
    return [t.get("transactionExternalKey") for p in killbill.payments(account_id) for t in p.get("transactions", [])]


def brief_heading(page: Page, n: int) -> Locator:
    return page.get_by_role("heading", level=1, name=Q[n], exact=True)


def wait_question(page: Page, n: int) -> None:
    pump(page, lambda: visible(brief_heading(page, n)), f"the brief showed question {n} {Q[n]!r} (L197)")


def answer_step1(page: Page, title: str) -> None:
    wait_question(page, 1)
    chip = page.get_by_role("radio", name="Camera-reactive wall")
    pump(page, lambda: visible(chip), "question 1 showed its chips (L199)")
    check(chip)
    fill(page.get_by_role("textbox", name="Name the piece"), title)


def ok_button(page: Page) -> Locator:
    return page.get_by_role("button", name="OK")


def pick_venue(page: Page, query: str, name: str) -> None:
    box = page.get_by_role("combobox", name="Venue")
    pump(page, lambda: visible(box), "question 2 showed combobox Venue (L201)")
    fill(box, query)
    option = page.get_by_role("listbox", name="Venues").get_by_role("option", name=re.compile(re.escape(name)))
    pump(page, lambda: visible(option), f"listbox Venues offered {name} (L219)")
    click(option.first)


def piece_button(page: Page, label: str) -> Locator:
    return page.get_by_role("region", name="Room").get_by_role("button", name=re.compile(rf"^{re.escape(label)} at "))


def piece_at(loc: Locator) -> tuple[float, float, int]:
    name = loc.first.get_attribute("aria-label") or loc.first.inner_text()
    m = re.search(r"at (-?[\d.]+) m, (-?[\d.]+) m, turned (\d+)°", name)
    assert m, f"piece button name {name!r} doesn't follow '<piece label> at <x> m, <y> m, turned <r>°' (L168)"
    return float(m.group(1)), float(m.group(2)), int(m.group(3))


def layout_item(api: Api, cid: str, index: int = 0) -> tuple[float, float, int]:
    it = commission(api, cid)["layout"]["items"][index]
    return float(it["x"]), float(it["y"]), int(it["rotationDeg"])


def goto_day(page: Page, d: date, status: str = "free") -> Locator:
    day = page.get_by_role("grid").get_by_role("button", name=re.compile(rf"^{date_re(d)}, {status}$"))
    nxt = page.get_by_role("button", name="Next month")
    for _ in range(MONTHS_AHEAD):
        pump(page, lambda: visible(day) or visible(nxt), "the install-day calendar rendered (L173)")
        if visible(day):
            return day
        click(nxt)
        advance(page, 300)
    pump(page, lambda: visible(day), f"the calendar showed {d} as {status} (L173)")
    return day


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Relay:

    def __init__(self, target: str) -> None:
        u = urlparse(target)
        self.target = (u.hostname or "127.0.0.1", u.port or (443 if u.scheme == "https" else 80))
        self.port = free_port()
        self.listener: socket.socket | None = None

    def open(self) -> None:
        s = socket.socket()
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(32)
        self.listener = s
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(RELAY_MAX_CONNECTIONS):
            try:
                conn, _ = self.listener.accept()
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
            except OSError:
                return
            for a, b in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            for chunk in iter(lambda: src.recv(65536), b""):
                dst.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                try:
                    s.close()
                except OSError:
                    pass

    def close(self) -> None:
        if self.listener is not None:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), APP_PUBLIC_URL=base, **overrides)
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)

    def healthy() -> bool:
        if proc.poll() is not None:
            pytest.fail(f"the app copy exited with {proc.returncode}: {Path(log.name).read_text()[-2000:]}")
        try:
            return httpx.get(f"{base}/api/health", timeout=3).status_code == 200
        except httpx.HTTPError:
            return False
    try:
        poll(lambda: healthy(), bool, "the app copy answered GET /api/health with a service down (L1044)", seconds=180)
        yield base
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            os.killpg(proc.pid, signal.SIGKILL)


def test_signin_state_bound_to_browser(app_url: str) -> None:
    owner = register(app_url)
    a = Api(app_url)
    attempts = [a.http.get("/auth/login", params={"returnTo": "/commissions"}) for _ in range(2)]
    queries = []
    for r in attempts:
        assert r.status_code == 302
        q = parse_qs(urlparse(r.headers["location"]).query)
        assert q["response_type"] == ["code"] and "openid" in q["scope"][0].split()
        assert q["code_challenge_method"] == ["S256"] and q["redirect_uri"][0].endswith("/auth/callback")
        assert len(q["state"][0]) >= STATE_MIN_CHARS and q.get("nonce")
        cookie = r.headers.get("set-cookie", "").lower()
        assert "httpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie, "the attempt cookie must be httpOnly and SameSite=Lax (L478)"
        queries.append(q)
    assert queries[0]["state"] != queries[1]["state"] and queries[0]["code_challenge"] != queries[1]["code_challenge"]
    kc = a.http.get(attempts[1].headers["location"], follow_redirects=True)
    done = a.http.post(_form(kc.text, str(kc.url)), data={"username": owner.email, "password": owner.password, "credentialId": ""})
    loc = done.headers.get("location", "")
    assert "/auth/callback" in loc
    callback = _on_base(app_url, loc)

    def refused(r: httpx.Response) -> None:
        page = htmllib.unescape(r.text)
        assert r.status_code == 400 and SIGNIN_ERROR_HEADING in page and SIGNIN_ERROR_TEXT in page, f"callback answered {r.status_code}; expected the sign-in error page (L414)"

    other = Api(app_url)
    refused(other.http.get(callback))
    assert other.http.get("/api/me").status_code == 401, "a callback from another browser created a session"
    good = a.http.get(callback)
    assert good.status_code == 302 and a.http.get("/api/me").status_code == 200
    refused(a.http.get(callback))
    stateless = Api(app_url)
    refused(stateless.http.get("/auth/callback", params={"code": parse_qs(urlparse(loc).query)["code"][0]}))
    assert stateless.http.get("/api/me").status_code == 401


ROLE_CASES = ["producer", "client", "crew", "self-registered"]


@pytest.mark.parametrize("role", ROLE_CASES, ids=ROLE_CASES)
def test_seeded_roles_and_landing(app_url: str, role: str) -> None:
    if role == "self-registered":
        api = register(app_url)
        assert api.landing == "/commissions" and api.me["roles"] == ["client"]
        assert any(api.email in (u.get("email"), u.get("username")) for u in Keycloak().users(api.email))
        return
    email, password = SEEDED[role]
    assert any(email in (u.get("email"), u.get("username")) for u in Keycloak().users(email)), f"{email} missing from the realm (L964)"
    api = sign_in(app_url, email, password)
    assert api.landing == LANDING[role], f"{role} landed on {api.landing}; expected {LANDING[role]} (L957)"
    assert role in api.me["roles"]


def test_expired_access_refresh_replay(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    c = new_brief(api)
    expired: set[str] = set()
    refreshes: list[str] = []

    def expire(route: Any) -> None:
        key = route.request.method + route.request.url
        if refreshes or key in expired:
            route.fallback()
            return
        expired.add(key)
        route.fulfill(status=401, content_type="application/json", body=json.dumps({"error": {"code": "session_expired"}}))

    with app_page(browser, app_url, "/api/health", api=api) as page:
        page.on("request", lambda r: refreshes.append(r.url) if urlparse(r.url).path == "/auth/refresh" else None)
        page.route(re.compile(r".*/api/(commissions|me)(/[^?]*)?(\?.*)?$"), expire)
        page.goto(f"{app_url}/c/{c['id']}")
        pump(page, lambda: visible(page.get_by_role("table", name="Milestones")) and visible(page.get_by_text(c["title"])),
             "the overview loaded after the refresh replayed its requests (L249)")
        assert expired, "no request met the expired access"
        assert len(refreshes) == 1, f"{len(refreshes)} refresh calls; expected one shared refresh (L249)"
        assert SESSION_ENDED not in text_of(page.get_by_role("status", name="Session"))


def test_wf_sign_in_failed_refresh_keeps_entries(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    title = new_title()
    with app_page(browser, app_url, "/brief/new?step=1", api=api, reduced=True) as page:
        answer_step1(page, title)
        page.route("**/auth/refresh", lambda r: r.fulfill(status=401, content_type="application/json", body=json.dumps({"error": {"code": "signed_out"}})))
        page.route(re.compile(r".*/api/briefs(/.*)?$"), lambda r: r.fulfill(status=401, content_type="application/json", body=json.dumps({"error": {"code": "session_expired"}})))
        click(ok_button(page))
        session = page.get_by_role("status", name="Session")
        pump(page, lambda: SESSION_ENDED in text_of(session), "status Session showed the signed-out message (L410)")
        assert visible(session.get_by_role("button", name="Sign in"))
        assert page.get_by_role("textbox", name="Name the piece").input_value() == title
        assert page.get_by_role("radio", name="Camera-reactive wall").is_checked()


def test_wf_sign_in_brief_return(browser: Browser, app_url: str) -> None:
    account = register(app_url)
    title = new_title()
    calls: list[str] = []
    with app_page(browser, app_url, "/brief/new?step=1", reduced=True) as page:
        page.on("response", lambda r: calls.append(f"{r.request.method} {urlparse(r.url).path}")
                if "/api/briefs" in r.url and r.status < 400 else None)
        answer_step1(page, title)
        click(ok_button(page))
        browser_sign_in(page, app_url, account.email, account.password)
        pattern = re.compile(r"/briefs/([0-9a-f-]{36})\?step=2$")
        pump(page, lambda: pattern.search(page.url) is not None, "sign-in returned to /briefs/<brief id>?step=2 (L217)")
        bid = pattern.search(page.url).group(1)
        assert calls.count("POST /api/briefs") == 1 and calls.count(f"PUT /api/briefs/{bid}/steps/1") == 1
        brief = account.ok("GET", f"/api/briefs/{bid}", 200)
        assert brief["answeredThrough"] == 1 and brief["nextStep"] == 2 and title in json.dumps(brief["answers"])
        url = page.url
        page.reload()
        wait_question(page, 2)
        assert page.url == url


BAD_ANSWERS = {
    1: [({"installationType": "statue", "title": "Tidal"}, "installationType", "Pick what should stand in the room."),
        ({"installationType": "camera-reactive-wall", "title": " x "}, "title", "Give the piece a name of 2 to 80 characters."),
        ({"installationType": "camera-reactive-wall", "title": "x" * (TITLE_MAX + 1)}, "title", "Give the piece a name of 2 to 80 characters.")],
    2: [({"venueId": "nowhere-hall"}, "venueId", "Pick a venue from the list.")],
    3: [({"widthM": 3.5, "depthM": 9}, "widthM", WIDTH_MSG), ({"widthM": 12.25, "depthM": 9}, "widthM", WIDTH_MSG),
        ({"widthM": 12, "depthM": 60.5}, "depthM", DEPTH_MSG)],
    4: [({"doorWall": "ceiling"}, "doorWall", "Pick the wall with the main door.")],
    5: [({"audience": "thousands"}, "audience", "Pick how many people will be there at once.")],
    6: [({"addOns": ["fireworks"], "notes": ""}, "addOns", "Pick from the listed extras."),
        ({"addOns": [], "notes": "x" * (NOTES_LIMIT + 1)}, "notes", "Keep notes to 2,000 characters or fewer.")],
}


def test_brief_steps_validated_in_order(app_url: str) -> None:
    api = register(app_url)
    title = new_title()
    b = api.ok("POST", "/api/briefs", 201, json={})
    assert b["answeredThrough"] == 0 and b["nextStep"] == 1 and b["commissionId"] is None and b["answers"] == {}
    path = lambda n: f"/api/briefs/{b['id']}/steps/{n}"
    good = {1: {"installationType": "camera-reactive-wall", "title": title}, 2: {"venueId": "halsted-works"},
            3: {"widthM": 12, "depthM": 9}, 4: {"doorWall": "front"}, 5: {"audience": "up-to-25"},
            6: {"addOns": ["night-lighting"], "notes": NOTES}}
    early = api.put(path(2), json={"answer": good[2]})
    assert early.status_code == 409 and _code(early) == "step_out_of_order"
    for n in (0, 7):
        assert api.put(path(n), json={"answer": {}}).status_code == 404
    for n in range(1, 7):
        if n == 6:
            r = api.post(f"/api/briefs/{b['id']}/complete")
            assert r.status_code == 409 and _code(r) == "brief_incomplete"
        for answer, field, message in BAD_ANSWERS[n]:
            r = api.put(path(n), json={"answer": answer})
            assert r.status_code == 422 and r.json()["errors"].get(field) == message, f"step {n} {answer}: {r.text[:200]}"
        body = api.ok("PUT", path(n), 200, json={"answer": good[n]})
        assert body["answeredThrough"] >= n and body["nextStep"] == (n + 1 if n < 6 else None)
        assert api.ok("PUT", path(n), 200, json={"answer": good[n]}) == body
    assert api.ok("PUT", path(4), 200, json={"answer": {"doorWall": "back"}})["answeredThrough"] == 6
    c = api.ok("POST", f"/api/briefs/{b['id']}/complete", 201)
    assert c["state"] == "briefed" and c["title"] == title and c["room"]["doorWall"] == "back"
    assert c["options"]["size"] == "compact" and c["options"]["addOns"] == ["night-lighting"]
    assert api.ok("POST", f"/api/briefs/{b['id']}/complete", 200)["id"] == c["id"]
    done = api.put(path(1), json={"answer": good[1]})
    assert done.status_code == 409 and _code(done) == "brief_completed"
    mine = [x for x in api.ok("GET", "/api/commissions", 200)["commissions"] if x["title"] == title]
    assert len(mine) == 1


def test_wf_brief_field_errors(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    b = new_brief(api, through=2)
    with app_page(browser, app_url, f"/briefs/{b['briefId']}?step=3", api=api, reduced=True) as page:
        wait_question(page, 3)
        width = page.get_by_role("textbox", name="Width in metres")
        fill(width, "3")
        fill(page.get_by_role("textbox", name="Depth in metres"), "9")
        click(ok_button(page))
        problems = page.get_by_role("region", name="Problems")
        progress = page.get_by_role("status", name="Brief progress")
        pump(page, lambda: WIDTH_MSG in text_of(problems) and WIDTH_MSG in text_of(progress), "the width error showed in Problems and Brief progress (L391)")
        assert visible(problems.get_by_role("link", name=re.compile(re.escape(WIDTH_MSG))))
        fill(width, "12")
        click(ok_button(page))
        pump(page, lambda: text_of(progress) == "Answer saved. Question 4 of 6.", "Brief progress announced the saved answer (L395)")
        pump(page, lambda: page.url.endswith("?step=4"), "the address moved to step 4 (L214)")
    assert api.ok("GET", f"/api/briefs/{b['briefId']}", 200)["answeredThrough"] == 3


def test_stage_reshaped_by_answers(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    with app_page(browser, app_url, "/brief/new?step=1", api=api, reduced=True) as page:
        stage = page.get_by_role("img", name="Venue stage")
        attr = lambda name: stage.first.get_attribute(name) or ""
        wait_question(page, 1)
        assert attr("data-scene") == "brief" and attr("data-motion") == "still"
        assert attr("data-silhouette") == "none" and attr("data-dust") == str(DUST_BEFORE)
        answer_step1(page, new_title())
        click(ok_button(page))
        pump(page, lambda: attr("data-silhouette") == "camera-reactive-wall", "the stage dropped the camera-reactive wall silhouette (L341)")
        wait_question(page, 2)
        pick_venue(page, "Halsted", "Halsted Works Hall")
        click(ok_button(page))
        wait_question(page, 3)
        before = decode(capture(stage.first))
        fill(page.get_by_role("textbox", name="Width in metres"), "12")
        fill(page.get_by_role("textbox", name="Depth in metres"), "9")
        click(ok_button(page))
        pump(page, lambda: attr("data-room-width") not in ("",) and float(attr("data-room-width")) == 12 and float(attr("data-room-depth") or 0) == 9,
             "the stage published the 12 x 9 m room (L147)")
        changed(before, decode(capture(stage.first)))
        wait_question(page, 4)
        check(page.get_by_role("radio", name="Front wall"))
        click(ok_button(page))
        wait_question(page, 5)
        assert attr("data-dust") == str(DUST_BEFORE)
        check(page.get_by_role("radio", name="25 to 100"))
        click(ok_button(page))
        pump(page, lambda: attr("data-dust") == str(DUST_25_100), "the stage dust became 80 particles (L341)")


def test_venue_search_latest_wins(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    b = new_brief(api, through=1)
    stash: dict[str, Any] = {}
    asked: list[str] = []

    def gate(route: Any) -> None:
        q = parse_qs(urlparse(route.request.url).query).get("q", [""])[0]
        asked.append(q)
        if q == "Halsted" and "route" not in stash:
            stash["route"] = route
            return
        route.fallback()

    with app_page(browser, app_url, f"/briefs/{b['briefId']}?step=2", api=api, reduced=True) as page:
        page.route(re.compile(r".*/api/venues\?.*"), gate)
        box = page.get_by_role("combobox", name="Venue")
        pump(page, lambda: visible(box), "combobox Venue showed (L201)")
        fill(box, "Halsted")
        pump(page, lambda: "route" in stash, "the venue field asked for the first query (L219)")
        fill(box, "Pier")
        advance(page, DEBOUNCE_MS - 50)
        assert "Pier" not in asked, "the search fired before the 250 ms pause (L219)"
        venues = page.get_by_role("listbox", name="Venues")
        pier = venues.get_by_role("option", name=re.compile("Pier Nine Pavilion"))
        pump(page, lambda: visible(pier), "listbox Venues showed the latest reply (L219)")
        stash["route"].fallback()
        for _ in range(10):
            advance(page, 100)
            assert venues.get_by_role("option", name=re.compile("Halsted Works Hall")).count() == 0, "a stale reply replaced the suggestions (L219)"
        assert visible(pier)


def letters_due(t: float, length: int) -> int:
    return 0 if t < LETTER_START_S else min(length, int((t - LETTER_START_S) / LETTER_STEP_S) + 1)


def test_cue_line_typing_schedule(browser: Browser, app_url: str) -> None:
    length = len(Q[1])
    with app_page(browser, app_url, "/brief/new?step=1") as page:
        intro = page.get_by_text(re.compile(r"[\s\u00a0]+".join(map(re.escape, INTRO.split()))))
        pump(page, lambda: visible(intro), "the intro line typed first (L195)", step_ms=20)
        heading = brief_heading(page, 1)
        typed = lambda: int(heading.first.get_attribute("data-typed") or "-1")
        pump(page, lambda: visible(heading) and typed() == 0, "question 1 opened with data-typed 0 (L337)", step_ms=20)
        tag = page.get_by_text(CURSOR_TAG, exact=True)
        chip = page.get_by_text("Camera-reactive wall", exact=True)
        elapsed, mid_x = 0.0, None
        for t in (0.25, 0.8, 1.2):
            advance(page, (t - elapsed) * 1000)
            elapsed = t
            n = typed()
            assert letters_due(t - TIME_TOLERANCE_S - 0.02, length) <= n <= letters_due(t + TIME_TOLERANCE_S, length), f"{n} letters at {t}s (L337)"
            marks = heading.first.evaluate(LETTERS_JS)
            assert len(marks) == length and sum(m != "hidden" for m in marks) == n
            assert re.fullmatch(r"w*c*v*h*", "".join(m[0] for m in marks)), f"letter trail out of order at {t}s: {marks} (L338)"
            if t == 0.8:
                mid_x = tag.first.bounding_box()["x"]
                assert chip.count() == 0 or not chip.first.is_visible() or opacity(chip) < 0.1, "controls showed before the line settled (L340)"
            if t == 1.2:
                assert any(m in ("violet", "cyan") for m in marks), "no violet or cyan trail followed the typing (L338)"
        end = LETTER_START_S + LETTER_STEP_S * (length - 1) + WHITE_AFTER_S + TIME_TOLERANCE_S
        advance(page, (end - elapsed) * 1000)
        assert typed() == length and set(heading.first.evaluate(LETTERS_JS)) == {"white"}
        settle(tag.first)
        settled_x = tag.first.bounding_box()["x"]
        assert mid_x is not None and mid_x < settled_x, "the guide cursor didn't follow the newest letter (L339)"
        assert settled_x >= heading.first.evaluate(LAST_LETTER_JS) - 1, "the cursor didn't park past the line end (L339)"
        advance(page, CONTROLS_RISE_S * 1000)
        if chip.count():
            settle(chip.first)
        assert visible(chip) and opacity(chip) > 0.99, "controls didn't rise in within 1.4 s (L340)"
    with app_page(browser, app_url, "/brief/new?step=1", reduced=True) as page:
        heading = brief_heading(page, 1)
        pump(page, lambda: visible(heading), "question 1 opened under reduced motion (L363)", step_ms=20)
        assert int(heading.first.get_attribute("data-typed") or "-1") == length
        assert set(heading.first.evaluate(LETTERS_JS)) == {"white"}
        assert visible(page.get_by_text("Camera-reactive wall", exact=True))
        tag = page.get_by_text(CURSOR_TAG, exact=True)
        assert tag.first.bounding_box()["x"] >= heading.first.evaluate(LAST_LETTER_JS) - 1, "cursor not parked under reduced motion (L290)"


def test_brief_components_layout(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    b = new_brief(api, through=2)
    with app_page(browser, app_url, f"/briefs/{b['briefId']}?step=3", api=api, reduced=True) as page:
        wait_question(page, 3)
        hint = page.get_by_text(TEXT_HINT, exact=True)
        pump(page, lambda: visible(hint), "the text-step key-chord hint showed (L160)")
        assert "Martian Mono" in style(hint.first, "font-family")["font-family"]
        ok = ok_button(page)
        assert ok.first.is_disabled() or ok.first.get_attribute("aria-disabled") == "true", "OK must be unavailable until answered (L159)"
        field = page.get_by_role("textbox", name="Width in metres")
        bg = style(field.first, "background-color")["background-color"]
        alpha = re.findall(r"[\d.]+", bg)
        assert bg == "transparent" or (len(alpha) == 4 and float(alpha[3]) == 0), "answer field fill must be transparent (L300)"
        fill(field, "12")
        fill(page.get_by_role("textbox", name="Depth in metres"), "9")
        pump(page, lambda: not ok.first.is_disabled() and ok.first.get_attribute("aria-disabled") != "true", "OK became available (L307)")
        box = ok.first.bounding_box()
        assert box["width"] >= TARGET_PX and box["height"] >= TARGET_PX
        rest, hover = state_styles(ok.first, "background-color")
        assert rest != hover, "hover must brighten the OK button (L305)"
        close = page.get_by_role("button", name="Close brief")
        cb = close.first.bounding_box()
        assert cb["width"] >= TARGET_PX and cb["height"] >= TARGET_PX
        assert cb["x"] + cb["width"] / 2 > 1280 / 2 and cb["y"] + cb["height"] / 2 < 800 / 4, "close chip must sit top right (L310)"
        assert "CLOSE" in close.first.inner_text()
        click(ok)
        wait_question(page, 4)
        pump(page, lambda: visible(page.get_by_text(CHIP_HINT, exact=True)), "the chip-step hint showed (L160)")
        labels = ["Front wall", "Back wall", "Left wall", "Right wall"]
        rows = lambda: sorted({round(page.get_by_text(l, exact=True).first.bounding_box()["y"]) for l in labels})
        assert len(rows()) == 1, "four chips must sit in one row on desktop (L292)"
        page.set_viewport_size({"width": 375, "height": 812})
        advance(page, 500)
        assert len(rows()) == 2, "chips must sit two per row on phones (L292)"


def test_wf_brief_keyboard_journey(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    title = new_title()
    with app_page(browser, app_url, "/brief/new?step=1", api=api) as page:
        kb = page.keyboard

        def first(n: int, loc: Locator) -> None:
            wait_question(page, n)
            pump(page, lambda: focused(loc), f"focus moved to the first control of question {n} (L208)")

        first(1, page.get_by_role("radio", name="Camera-reactive wall"))
        kb.press("Space")
        kb.press("Tab")
        kb.type(title)
        kb.press("Enter")
        first(2, page.get_by_role("combobox", name="Venue"))
        kb.type("Halsted")
        option = page.get_by_role("listbox", name="Venues").get_by_role("option", name=re.compile("Halsted Works Hall"))
        pump(page, lambda: visible(option), "venue suggestions appeared (L219)")
        kb.press("ArrowDown")
        kb.press("Enter")
        pump(page, lambda: "step=3" in page.url or not visible(option), "Enter picked the venue (L219)")
        if "step=3" not in page.url:
            kb.press("Enter")
        first(3, page.get_by_role("textbox", name="Width in metres"))
        kb.type("12")
        kb.press("Tab")
        kb.type("9")
        kb.press("Enter")
        for n, label in ((4, "Front wall"), (5, "Up to 25")):
            first(n, page.get_by_role("radio", name=label))
            kb.press("Space")
            kb.press("Enter")
        first(6, page.get_by_role("checkbox", name="Ambient sound"))
        kb.press("Space")
        kb.press("Enter")
        pattern = re.compile(r"/c/([0-9a-f-]{36})$")
        pump(page, lambda: pattern.search(page.url) is not None and visible(page.get_by_role("heading", name=READY)), "the brief ended on /c/<id> with 'Your room is ready.' (L216)")
        cid = pattern.search(page.url).group(1)
    c = commission(api, cid)
    assert c["state"] == "briefed" and c["title"] == title and c["venue"]["id"] == "halsted-works"
    assert c["room"]["widthM"] == 12 and c["room"]["depthM"] == 9 and c["room"]["doorWall"] == "front"
    assert c["audience"] == "up-to-25" and c["options"]["addOns"] == ["ambient-sound"]


def test_wf_brief_step_addresses(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    b = new_brief(api, through=2)
    with app_page(browser, app_url, "/brief/new?step=4", api=api, reduced=True) as page:
        pump(page, lambda: page.url.endswith("/brief/new?step=1"), "/brief/new?step=4 became ?step=1 (L212)")
        wait_question(page, 1)
        page.goto(f"{app_url}/briefs/{b['briefId']}?step=1")
        wait_question(page, 1)
        pump(page, lambda: page.get_by_role("textbox", name="Name the piece").input_value() == b["title"], "step 1 showed its saved title (L215)")
        for bad in ("?step=9", ""):
            page.goto(f"{app_url}/briefs/{b['briefId']}{bad}")
            pump(page, lambda: page.url.endswith(f"/briefs/{b['briefId']}?step=3"), "a bad step went to nextStep (L215)")
            wait_question(page, 3)
        done = new_brief(api)
        page.goto(f"{app_url}/briefs/{done['briefId']}?step=2")
        pump(page, lambda: page.url.endswith(f"/c/{done['id']}"), "a completed draft went to /c/<commission id> (L215)")
    with app_page(browser, app_url, f"/briefs/{b['briefId']}?step=2", reduced=True) as page:
        browser_sign_in(page, app_url, api.email, api.password)
        pump(page, lambda: page.url.endswith(f"/briefs/{b['briefId']}?step=2"), "sign-in returned to the draft step (L215)")
        wait_question(page, 2)


def test_wf_brief_session_expiry_resume(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    b = new_brief(api, through=2)
    refreshes: list[str] = []
    puts: list[Any] = []

    def first_expires(route: Any) -> None:
        puts.append(route.request.post_data)
        if len(puts) == 1:
            route.fulfill(status=401, content_type="application/json", body=json.dumps({"error": {"code": "session_expired"}}))
        else:
            route.fallback()

    with app_page(browser, app_url, f"/briefs/{b['briefId']}?step=3", api=api, reduced=True) as page:
        page.on("request", lambda r: refreshes.append(r.url) if urlparse(r.url).path == "/auth/refresh" else None)
        page.route(f"**/api/briefs/{b['briefId']}/steps/3", first_expires)
        wait_question(page, 3)
        fill(page.get_by_role("textbox", name="Width in metres"), "12")
        fill(page.get_by_role("textbox", name="Depth in metres"), "9")
        click(ok_button(page))
        pump(page, lambda: page.url.endswith("?step=4"), "the replayed save moved the brief to step 4 (L249)")
        assert len(refreshes) == 1 and len(puts) == 2 and puts[0] == puts[1], "one refresh and one replay with the same payload (L249)"
        assert SESSION_ENDED not in text_of(page.get_by_role("status", name="Session"))
        sent = json.loads(puts[1])["answer"]
        assert float(sent["widthM"]) == 12 and float(sent["depthM"]) == 9, "the replay lost the typed room size (L249)"
    saved = api.ok("GET", f"/api/briefs/{b['briefId']}", 200)
    assert saved["answeredThrough"] >= 3 and saved["nextStep"] == 4


UPLOAD_CASES = ["brief-pdf", "png-photo", "jpeg-photo", "glb-model", "photo-at-limit", "photo-over-limit",
                "pdf-named-png", "glb-wrong-length", "glb-version-1", "empty-photo", "traversal-name", "unknown-kind"]


def upload_case(case: str) -> tuple[str, str, bytes, str, str]:
    table: dict[str, tuple[str, str, Callable[[], bytes], str, str]] = {
        "brief-pdf": ("brief_pdf", "brief.pdf", pdf_bytes, "stored", "brief.pdf"),
        "png-photo": ("venue_photo", "venue.png", png_bytes, "stored", "venue.png"),
        "jpeg-photo": ("venue_photo", "venue.jpg", jpeg_bytes, "stored", "venue.jpg"),
        "glb-model": ("installation_glb", "piece.glb", glb_bytes, "stored", "piece.glb"),
        "photo-at-limit": ("venue_photo", "big.png", lambda: padded(png_bytes(), PHOTO_LIMIT), "stored", "big.png"),
        "photo-over-limit": ("venue_photo", "huge.png", lambda: padded(png_bytes(), PHOTO_LIMIT + 1), "too_large", "huge.png"),
        "pdf-named-png": ("venue_photo", "photo.png", pdf_bytes, "wrong_type", "photo.png"),
        "glb-wrong-length": ("installation_glb", "piece.glb", lambda: glb_bytes(length_delta=4), "wrong_type", "piece.glb"),
        "glb-version-1": ("installation_glb", "piece.glb", lambda: glb_bytes(version=1), "wrong_type", "piece.glb"),
        "empty-photo": ("venue_photo", "empty.png", lambda: b"", "wrong_type", "empty.png"),
        "traversal-name": ("venue_photo", "../../secret/venue.png", png_bytes, "stored", "venue.png"),
        "unknown-kind": ("texture", "venue.png", png_bytes, "bad_kind", "venue.png"),
    }
    kind, name, make, outcome, shown = table[case]
    return kind, name, make(), outcome, shown


@pytest.mark.parametrize("case", UPLOAD_CASES, ids=UPLOAD_CASES)
def test_upload_limits_by_content(app_url: str, case: str) -> None:
    api = register(app_url)
    c = new_brief(api)
    kind, name, data, outcome, shown = upload_case(case)
    r = upload(api, c["id"], kind, name, data)
    prefix = f"commissions/{c['id']}/files/"
    if outcome == "stored":
        assert r.status_code == 201, r.text[:300]
        f = r.json()
        assert f["status"] == "stored" and f["kind"] == kind and f["fileName"] == shown
        assert f["sizeBytes"] == len(data) and f["sha256"] == hashlib.sha256(data).hexdigest()
        assert S3().keys(prefix) == [prefix + f["id"]] and S3().get(prefix + f["id"]) == data
        assert api.get(f"/api/files/{f['id']}/content").content == data
        return
    labels = {"venue_photo": "venue photo", "installation_glb": "GLB model", "brief_pdf": "brief PDF"}
    if outcome == "too_large":
        assert r.status_code == 413 and _code(r) == "file_too_large" and r.json()["error"]["limitBytes"] == PHOTO_LIMIT
        assert r.json()["error"]["message"] in (f"{shown} is over the {PHOTO_LIMIT}-byte limit for a venue photo.", f"{shown} is over the {PHOTO_LIMIT:,}-byte limit for a venue photo.")
    elif outcome == "wrong_type":
        assert r.status_code == 422 and r.json()["errors"]["file"] == f"{shown} isn't a {labels[kind]}."
    else:
        assert r.status_code == 422 and r.json()["errors"]["kind"] == "Pick brief_pdf, venue_photo or installation_glb."
    assert api.ok("GET", f"/api/commissions/{c['id']}/files", 200)["files"] == []
    assert S3().keys(prefix) == []


def test_upload_announcements(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    c = new_brief(api)
    photo, fake = png_bytes(), pdf_bytes()
    with app_page(browser, app_url, f"/c/{c['id']}/files", api=api, reduced=True) as page:
        status = page.get_by_role("status", name="Upload status")
        with held(page, "**/api/commissions/*/files") as gate:
            with page.expect_file_chooser() as fc:
                click(page.get_by_role("button", name="Upload venue photo"))
            fc.value.set_files(files=[{"name": "venue.png", "mimeType": "image/png", "buffer": photo}])
            pump(page, lambda: text_of(status) == "Uploading venue.png...", "Upload status showed the pending copy (L396)")
            gate.release()
        expected = f"Stored venue.png — {len(photo)} bytes, SHA-256 {hashlib.sha256(photo).hexdigest()}."
        pump(page, lambda: text_of(status) == expected, "Upload status announced the stored size and SHA-256 (L396)")
        with page.expect_file_chooser() as fc:
            click(page.get_by_role("button", name="Upload venue photo"))
        fc.value.set_files(files=[{"name": "plan.png", "mimeType": "image/png", "buffer": fake}])
        pump(page, lambda: text_of(status) == "plan.png isn't a venue photo.", "Upload status announced the wrong-type error (L396)")
    assert [f["fileName"] for f in api.ok("GET", f"/api/commissions/{c['id']}/files", 200)["files"]] == ["venue.png"]


def test_wf_uploads_venue_files(browser: Browser, app_url: str) -> None:
    api = register(app_url)
    c = new_brief(api)
    blobs = {"venue.png": ("Upload venue photo", "image/png", png_bytes()), "piece.glb": ("Upload GLB model", "model/gltf-binary", glb_bytes())}
    with app_page(browser, app_url, f"/c/{c['id']}/files", api=api, reduced=True) as page:
        files = page.get_by_role("list", name="Files")
        for name, (button, mime, data) in blobs.items():
            with page.expect_file_chooser() as fc:
                click(page.get_by_role("button", name=button))
            fc.value.set_files(files=[{"name": name, "mimeType": mime, "buffer": data}])
            row = files.get_by_role("listitem").filter(has_text=name)
            sha = hashlib.sha256(data).hexdigest()
            pump(page, lambda: visible(row) and all(s in text_of(row) for s in ("Stored", str(len(data)), sha)), f"{name} listed as Stored with size and SHA-256 (L122)")
    listed = {f["fileName"]: f for f in api.ok("GET", f"/api/commissions/{c['id']}/files", 200)["files"]}
    for name, (_, _, data) in blobs.items():
        assert S3().get(f"commissions/{c['id']}/files/{listed[name]['id']}") == data


def test_wf_uploads_cross_client(browser: Browser, app_url: str) -> None:
    owner, other = register(app_url), register(app_url)
    c = new_brief(owner)
    secret_name = f"{uuid.uuid4().hex[:12]}.png"
    f = stored(owner, c["id"], "venue_photo", secret_name, png_bytes())
    with app_page(browser, app_url, f"/c/{c['id']}/files", api=other, reduced=True) as page:
        advance(page, 2000)
        assert page.get_by_text(secret_name).count() == 0
    for r in (other.get(f"/api/commissions/{c['id']}/files"), other.get(f"/api/files/{f['id']}/content"),
              upload(other, c["id"], "venue_photo", "intruder.png", png_bytes())):
        assert r.status_code == 404 and _code(r) == "not_found"
    assert S3().keys(f"commissions/{c['id']}/files/") == [f"commissions/{c['id']}/files/{f['id']}"]


def test_render_submission_payload(app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = placed(api, wiremock, door="left", audience="25-100")
    data = png_bytes()
    photo = stored(api, c["id"], "venue_photo", "venue-2.png", data)
    rid = request_render(api, wiremock, c["id"], photo["id"])
    req, body = provider_request(wiremock, rid)
    assert header(req, "Idempotency-Key") == rid and body["jobRef"] == rid
    assert body["installationType"] == "camera-reactive-wall"
    assert body["room"] == {"widthM": 12, "depthM": 9, "doorWall": "left"}
    assert body["brief"] == {"title": c["title"], "audience": "25-100", "notes": NOTES}
    saved = [(i["kind"], float(i["x"]), float(i["y"]), int(i["rotationDeg"])) for i in c["layout"]["items"]]
    assert sorted((i["kind"], float(i["x"]), float(i["y"]), int(i["rotationDeg"])) for i in body["layout"]) == sorted(saved)
    vp = body["venuePhoto"]
    assert base64.b64decode(vp["base64"]) == data and vp["sha256"] == hashlib.sha256(data).hexdigest()
    assert vp["sizeBytes"] == len(data) and vp["contentType"] == "image/png"
    assert body["referenceImage"] is None and body["callbackUrl"].endswith("/api/render-callbacks")
    r = poll(lambda: api.ok("GET", f"/api/renders/{rid}", 200), lambda x: x["state"] == "submitted", "render state submitted (L790)")
    assert r["providerJobId"] == PROVIDER_JOB


def test_render_submit_survives_provider_fault(app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = new_brief(api)
    photo = stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
    wiremock.fault("POST", "/v1/renders")
    rid = api.ok("POST", f"/api/commissions/{c['id']}/renders", 202, json={"venuePhotoFileId": photo["id"]})["id"]
    poll(lambda: provider_requests(wiremock, rid), lambda rs: len(rs) >= 2, "the render job retried after a provider fault (L845)")
    assert api.ok("GET", f"/api/renders/{rid}", 200)["state"] == "queued"
    wiremock.stub("POST", "/v1/renders", status=202, json={"providerJobId": PROVIDER_JOB, "status": "accepted", "etaSeconds": 40})
    poll(lambda: api.ok("GET", f"/api/renders/{rid}", 200), lambda x: x["state"] == "submitted", "render submitted once the provider answered (L847)", seconds=JOB_EFFECT_S + 10)
    assert {header(req, "Idempotency-Key") for req, _ in provider_requests(wiremock, rid)} == {rid}
    wiremock.stub("POST", "/v1/renders", status=400, json={})
    bad = api.ok("POST", f"/api/commissions/{c['id']}/renders", 202, json={"venuePhotoFileId": photo["id"]})["id"]
    out = poll(lambda: api.ok("GET", f"/api/renders/{bad}", 200), lambda x: x["state"] == "failed", "a 4xx failed the render (L940)")
    assert out["failureReason"] == "provider_rejected"
    wiremock.stub("POST", "/v1/renders", status=202, json={"providerJobId": PROVIDER_JOB, "status": "accepted", "etaSeconds": 40})
    prod = producer(app_url)
    assert transition(prod, c["id"], "cancelled").status_code == 200
    gone = api.post(f"/api/commissions/{c['id']}/renders", json={"venuePhotoFileId": str(uuid.uuid4())})
    assert gone.status_code == 404 and _code(gone) == "not_found", "an unknown id in the body outranks the state conflict (L461, L464)"
    late = api.post(f"/api/commissions/{c['id']}/renders", json={"venuePhotoFileId": photo["id"]})
    assert late.status_code == 409 and _code(late) == "illegal_state", "a cancelled commission refuses renders (L546)"


SSRF_CASES = {
    "loopback": "http://127.0.0.1:{port}/ref.png",
    "decimal-host": "http://2130706433:{port}/ref.png",
    "octal-host": "http://0177.0.0.1:{port}/ref.png",
    "hex-host": "http://0x7f000001:{port}/ref.png",
    "ipv6-loopback": "http://[::1]:{port}/ref.png",
    "ipv4-mapped": "http://[::ffff:127.0.0.1]:{port}/ref.png",
    "unspecified": "http://0.0.0.0:{port}/ref.png",
    "private-10": "http://10.20.30.40:{port}/ref.png",
    "cgnat": "http://100.64.0.1:{port}/ref.png",
    "metadata": "http://169.254.169.254/latest/meta-data/",
    "redirect-to-loopback": "redirect",
    "ftp-scheme": "ftp://127.0.0.1:{port}/ref.png",
}


@pytest.mark.parametrize("case", list(SSRF_CASES), ids=list(SSRF_CASES))
def test_reference_image_ssrf(app_url: str, wiremock: WireMock, case: str) -> None:
    listener = socket.socket()
    listener.bind(("0.0.0.0", 0))
    listener.listen(4)
    listener.settimeout(0.2)
    port = listener.getsockname()[1]
    api = register(app_url)
    c = new_brief(api)
    photo = stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
    url = SSRF_CASES[case].format(port=port)
    hop = f"/ref/{uuid.uuid4().hex}"
    if case == "redirect-to-loopback":
        wiremock.stub("GET", hop, status=302, headers={"Location": f"http://127.0.0.1:{port}/ref.png"})
        url = (os.environ.get("WIREMOCK_URL") or "http://wiremock:8080").rstrip("/") + hop
    try:
        r = api.post(f"/api/commissions/{c['id']}/renders", json={"venuePhotoFileId": photo["id"], "referenceImageUrl": url})
        assert r.status_code == 422 and r.json()["errors"]["referenceImageUrl"] == UNSAFE_REF, f"{url} answered {r.status_code} {r.text[:200]} (L807)"
        try:
            listener.accept()
            pytest.fail(f"the app contacted the refused address {url} (L805)")
        except socket.timeout:
            pass
        if case == "redirect-to-loopback":
            assert wiremock.requests(hop) == [], "the private redirect host was contacted before the check (L805)"
        assert not any(b.get("brief", {}).get("title") == c["title"] for _, b in [(0, json.loads((e.get("request", e).get("body") or "{}"))) for e in wiremock.requests("/v1/renders")])
    finally:
        listener.close()


def test_render_callbacks_verified(app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = new_brief(api)
    photo = stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
    rid = request_render(api, wiremock, c["id"], photo["id"])
    state = lambda: api.ok("GET", f"/api/renders/{rid}", 200)
    poll(state, lambda x: x["state"] == "submitted", "render submitted (L790)")
    ev = render_event(rid, "render.progress", 40)
    assert _code(render_callback(app_url, ev, secret="not-the-secret")) == "bad_signature"
    stale = render_callback(app_url, ev, ts=int(time.time()) - TIMESTAMP_WINDOW_S * 3)
    assert stale.status_code == 401 and _code(stale) == "stale_timestamp"
    assert state()["state"] == "submitted" and state()["progress"] == 0
    assert render_callback(app_url, render_event(str(uuid.uuid4()), "render.progress", 10)).status_code == 404
    assert render_callback(app_url, ev).status_code == 204
    assert state()["state"] == "callback_verified" and state()["progress"] == 40
    with ThreadPoolExecutor(4) as pool:
        assert all(r.status_code == 204 for r in pool.map(lambda _: render_callback(app_url, ev), range(4)))
    assert render_callback(app_url, render_event(rid, "render.progress", 20)).status_code == 204
    assert state()["progress"] == 40, "progress went down (L795)"
    assert api.get(f"/api/renders/{rid}/preview").status_code == 409
    bad = render_callback(app_url, render_event(rid, "render.completed", 100, preview={"contentType": "image/png", "base64": b64(jpeg_bytes())}))
    assert bad.status_code == 422 and bad.json()["errors"]["preview"] == "Preview must be a PNG image."
    assert state()["state"] != "ready"
    png = png_bytes()
    finish_render(api, rid, png)
    key = f"commissions/{c['id']}/renders/{rid}.png"
    assert S3().get(key) == png and state()["previewSha256"] == hashlib.sha256(png).hexdigest()
    assert api.get(f"/api/renders/{rid}/preview").content == png
    assert render_callback(app_url, render_event(rid, "render.failed", 100, failureReason="late")).status_code == 204
    assert state()["state"] == "ready", "a callback after the terminal one changed the render (L796)"
    wait_state(api, c["id"], "previewed")


def test_wf_render_preview_journey(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = new_brief(api)
    stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
    png = png_bytes()
    with app_page(browser, app_url, f"/c/{c['id']}/preview", api=api, reduced=True) as page:
        status = page.get_by_role("status", name="Preview status")
        check(page.get_by_role("radiogroup", name="Venue photo").get_by_role("radio").first)
        click(page.get_by_role("button", name="Request preview"))
        pump(page, lambda: text_of(status) == "Preview queued." or "rendering" in text_of(status), "Preview status announced Preview queued. (L397)")
        rid = poll(lambda: [b["jobRef"] for _, b in [(0, json.loads(e.get("request", e).get("body") or "{}")) for e in wiremock.requests("/v1/renders")] if b.get("brief", {}).get("title") == c["title"]],
                   bool, "the provider received this commission's render (L926)")[0]
        poll(lambda: api.ok("GET", f"/api/renders/{rid}", 200), lambda x: x["state"] == "submitted", "render submitted")
        assert render_callback(app_url, render_event(rid, "render.progress", 40)).status_code == 204
        pump(page, lambda: text_of(status) == "Preview rendering — 40% done.", "Preview status announced progress (L397)")
        bar = page.get_by_role("progressbar", name="Preview progress")
        assert bar.first.get_attribute("aria-valuenow") == "40"
        finish_render(api, rid, png)
        pump(page, lambda: text_of(status) == "Preview ready.", "Preview status announced ready (L397)")
        img = page.get_by_role("img", name="Concept preview")
        pump(page, lambda: visible(img) and img.first.evaluate("i => i.naturalWidth > 0"), "the preview image showed (L123)")
    assert api.get(f"/api/renders/{rid}/preview").content == png


def test_wf_render_preview_unsafe_reference(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = new_brief(api)
    stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
    with app_page(browser, app_url, f"/c/{c['id']}/preview", api=api, reduced=True) as page:
        check(page.get_by_role("radiogroup", name="Venue photo").get_by_role("radio").first)
        fill(page.get_by_role("textbox", name="Reference image address (optional)"), "http://127.0.0.1/ref.png")
        click(page.get_by_role("button", name="Request preview"))
        pump(page, lambda: UNSAFE_REF in text_of(page.get_by_role("status", name="Preview status")), "Preview status showed the unsafe-address copy (L397)")
    assert not any(c["title"] in (e.get("request", e).get("body") or "") for e in wiremock.requests("/v1/renders"))


def test_layout_placement_rules(app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = previewed(api, wiremock, addons=("night-lighting",))
    main, rig = piece_kinds(c)
    item = lambda k, x, y, r=0: {"kind": k, "x": x, "y": y, "rotationDeg": r}
    cases = [
        ([item(main, 6.1, 8)], ["Positions snap to 0.25 m and turns to 15°."]),
        ([item(main, 6, 8, 10)], ["Positions snap to 0.25 m and turns to 15°."]),
        ([item(f"not-a-piece-{uuid.uuid4().hex[:4]}", 6, 8)], ["That piece isn't part of this commission."]),
        ([item(main, 6, 8), item(main, 2, 3)], ["That piece isn't part of this commission."]),
        ([item(main, 0.25, 4.5)], ["Keep the Camera-reactive wall inside the room."]),
        ([item(main, 6, 8), item(rig, 6, 8)], ["The Light rig overlaps the Camera-reactive wall.", "The Camera-reactive wall overlaps the Light rig."]),
        ([item(rig, 6, 0.5)], ["Leave 0.6 m clear inside the door for the Light rig."]),
    ]
    version = commission(api, c["id"])["layout"]["version"]
    for items, messages in cases:
        r = api.put(f"/api/commissions/{c['id']}/layout", json={"version": version, "items": items})
        assert r.status_code == 422, f"{items} answered {r.status_code}"
        errs = r.json()["errors"]
        assert any(re.fullmatch(r"items\[\d+\]", k) and v in messages for k, v in errs.items()), f"{items}: {errs} (L676)"
        assert commission(api, c["id"])["layout"]["version"] == version
    ok = api.ok("PUT", f"/api/commissions/{c['id']}/layout", 200, json={"version": version, "items": [item(main, 0.25, 4.5, 90), item(rig, 6, 1.0)]})
    assert ok["version"] == version + 1
    wait_state(api, c["id"], "placed")


def test_layout_version_conflict(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    v = c["layout"]["version"]
    kind = piece_kinds(c)[0]
    with app_page(browser, app_url, "/api/health", api=api, reduced=True) as page:
        page.route("**/api/events*", lambda r: r.abort())
        page.goto(f"{app_url}/c/{c['id']}/configure")
        piece = piece_button(page, "Camera-reactive wall")
        pump(page, lambda: visible(piece), "the configurator showed the placed wall (L168)")
        api.ok("PUT", f"/api/commissions/{c['id']}/layout", 200, json={"version": v, "items": [{"kind": kind, "x": 6, "y": 7, "rotationDeg": 0}]})
        stale = api.put(f"/api/commissions/{c['id']}/layout", json={"version": v, "items": [{"kind": kind, "x": 6, "y": 6, "rotationDeg": 0}]})
        assert stale.status_code == 412 and _code(stale) == "version_conflict" and stale.json()["error"]["currentVersion"] == v + 1
        click(piece)
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Enter")
        pump(page, lambda: text_of(page.get_by_role("status", name="Placement status")) == CONFLICT_COPY, "Placement status showed the 412 copy (L398)")
        pump(page, lambda: piece_at(piece)[:2] == (6.0, 7.0), "the room showed the latest layout (L57)")
    assert layout_item(api, c["id"])[:2] == (6.0, 7.0)


def test_keyboard_and_touch_placement(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = previewed(api, wiremock)
    with app_page(browser, app_url, f"/c/{c['id']}/configure", api=api, reduced=True) as page:
        click(page.get_by_role("list", name="Pieces to place").get_by_role("button", name="Place Camera-reactive wall"))
        piece = piece_button(page, "Camera-reactive wall")
        pump(page, lambda: focused(piece), "Place focused the new piece (L223)")
        assert piece_at(piece) == (6.0, 4.5, 0)
        kb = page.keyboard
        for key, want in (("ArrowRight", (6.25, 4.5, 0)), ("Shift+ArrowUp", (6.25, 5.5, 0)), ("r", (6.25, 5.5, TURN_DEG)),
                          ("Shift+R", (6.25, 5.5, 0)), ("r", (6.25, 5.5, TURN_DEG))):
            kb.press(key)
            pump(page, lambda: piece_at(piece) == want, f"{key} moved the piece to {want} (L225)")
        kb.press("Enter")
        status = page.get_by_role("status", name="Placement status")
        pump(page, lambda: re.fullmatch(r"Placed Camera-reactive wall at 6\.25 m, 5\.50? m, turned 15°\.", text_of(status)) is not None, "Placement status announced the drop (L398)")
        assert layout_item(api, c["id"]) == (6.25, 5.5, TURN_DEG)
        kb.press("ArrowLeft")
        kb.press("Escape")
        pump(page, lambda: piece_at(piece)[:2] == (6.25, 5.5), "Escape returned the piece (L229)")
        box = piece.first.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + 120, cy, steps=6)
        page.mouse.up()
        pump(page, lambda: layout_item(api, c["id"])[:2] != (6.25, 5.5), "the drag saved a new position on drop (L230)")
        x, y, _ = layout_item(api, c["id"])
        assert x % GRID == 0 and y % GRID == 0, "drag result not snapped to 0.25 m (L231)"


BREAKPOINTS = {"1280x800": (1280, 800, "side"), "1200x800": (1200, 800, "side"), "1199x1024": (1199, 1024, "stacked"),
               "768x1024": (768, 1024, "stacked"), "375x812": (375, 812, "sheet")}


@pytest.mark.parametrize("case", list(BREAKPOINTS), ids=list(BREAKPOINTS))
def test_configurator_breakpoints(browser: Browser, app_url: str, wiremock: WireMock, case: str) -> None:
    w, h, mode = BREAKPOINTS[case]
    api = register(app_url)
    c = placed(api, wiremock)
    with app_page(browser, app_url, f"/c/{c['id']}/configure", api=api, size=(w, h), reduced=True) as page:
        room = page.get_by_role("region", name="Room")
        insp = page.get_by_role("region", name="Inspector")
        pump(page, lambda: visible(room), "region Room showed (L168)")
        layout(page)
        if mode == "side":
            pump(page, lambda: visible(insp), "the inspector showed beside the scene (L125)")
            ib = insp.first.bounding_box()
            assert abs(ib["width"] - INSPECTOR_PX) <= INSPECTOR_PX * 0.1 and abs(ib["x"] + ib["width"] - w) <= 2
        elif mode == "stacked":
            pump(page, lambda: visible(insp), "the inspector showed below the scene (L126)")
            rb, ib = room.first.bounding_box(), insp.first.bounding_box()
            assert abs(rb["height"] - SCENE_SHARE * h) <= 0.05 * h and ib["y"] >= rb["y"] + rb["height"] - 2 and ib["width"] >= 0.9 * w
        else:
            show = page.get_by_role("button", name="Show inspector")
            pump(page, lambda: visible(show), "the Show inspector handle showed (L127)")
            collapsed = show.first.get_attribute("aria-expanded")
            assert collapsed is not None and collapsed != "true", "the closed handle must expose a collapsed state (L170)"
            assert not visible(page.get_by_role("button", name="Save quote"))
            assert "Save quote" not in tab_order(page, 20)
            click(show)
            hide = page.get_by_role("button", name="Hide inspector")
            pump(page, lambda: visible(hide) and visible(page.get_by_role("button", name="Save quote")), "the sheet opened (L234)")
            assert hide.first.get_attribute("aria-expanded") == "true"
            top = insp.first.bounding_box()["y"]
            assert abs(top - (1 - SHEET_SHARE) * h) <= 0.05 * h
            page.keyboard.press("Escape")
            pump(page, lambda: not visible(page.get_by_role("button", name="Save quote")), "Escape closed the sheet (L234)")
            assert "Save quote" not in tab_order(page, 20)


def test_quote_recount_latest_wins(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    before = c["quote"]["totalCents"]
    standard = MAIN_PRICE["camera-reactive-wall"] + SIZE_PRICE["standard"]
    grand = MAIN_PRICE["camera-reactive-wall"] + SIZE_PRICE["grand"]
    want = usd(standard + tax_of(standard, VENUES["halsted-works"][2]))
    stale = usd(grand + tax_of(grand, VENUES["halsted-works"][2]))
    stash: dict[str, Any] = {}

    def gate(route: Any) -> None:
        if (route.request.post_data_json or {}).get("size") == "grand" and "route" not in stash:
            stash["route"] = route
            return
        route.fallback()

    with app_page(browser, app_url, f"/c/{c['id']}/configure", api=api, reduced=True) as page:
        page.route("**/quote-preview", gate)
        sizes = page.get_by_role("radiogroup", name="Size")
        pump(page, lambda: visible(sizes), "radiogroup Size showed (L171)")
        check(sizes.get_by_role("radio", name="Grand"))
        pump(page, lambda: "route" in stash, "Grand asked for a quote preview (L233)")
        check(sizes.get_by_role("radio", name="Standard"))
        total = page.get_by_role("status", name="Quote total")
        quote = page.get_by_role("region", name="Quote")
        pump(page, lambda: text_of(total) == f"Quote updated: {want} including tax." and want in text_of(quote), "Quote total announced the latest choice (L399)")
        stash["route"].fallback()
        for _ in range(10):
            advance(page, 100)
            assert stale not in text_of(quote) and text_of(total) == f"Quote updated: {want} including tax.", "a stale preview repainted the quote (L21)"
        assert commission(api, c["id"])["quote"]["totalCents"] == before, "a preview saved the quote (L564)"
        click(page.get_by_role("button", name="Save quote"))
        poll(lambda: commission(api, c["id"]), lambda x: x["options"]["size"] == "standard", "Save quote saved the options (L233)")


def test_wf_configurator_room_journey(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = previewed(api, wiremock)
    with app_page(browser, app_url, f"/c/{c['id']}/configure", api=api, reduced=True) as page:
        kb = page.keyboard
        compact = page.get_by_role("radio", name="Compact")
        pump(page, lambda: visible(page.get_by_role("radiogroup", name="Size")), "the inspector showed (L124)")
        tab_to(page, compact, "Tab reached the size choice (L57)")
        kb.press("ArrowRight")
        tab_to(page, page.get_by_role("checkbox", name="Night-mode lighting"), "Tab reached Night-mode lighting")
        kb.press("Space")
        tab_to(page, page.get_by_role("button", name="Save quote"), "Tab reached Save quote")
        kb.press("Enter")
        pump(page, lambda: text_of(page.get_by_role("status", name="Quote total")) == f"Quote updated: {usd(EX_TOTAL)} including tax.", "Quote total announced the saved quote (L399)")
        for label, moves in (("Camera-reactive wall", []), ("Light rig", ["Shift+ArrowDown", "Shift+ArrowDown"])):
            place = page.get_by_role("button", name=f"Place {label}")
            pump(page, lambda: visible(place), f"Pieces to place offered {label} (L169)")
            tab_to(page, place, f"Tab reached Place {label}")
            kb.press("Enter")
            piece = piece_button(page, label)
            pump(page, lambda: focused(piece), f"{label} was placed and focused (L223)")
            for m in moves:
                kb.press(m)
            kb.press("Enter")
            pump(page, lambda: text_of(page.get_by_role("status", name="Placement status")).startswith(f"Placed {label} at "), f"{label} dropped (L398)")
    done = wait_state(api, c["id"], "placed")
    assert done["quote"]["totalCents"] == EX_TOTAL and len(done["layout"]["items"]) == 2


def test_wf_configurator_phone_reduced_motion(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = previewed(api, wiremock)
    grand = MAIN_PRICE["camera-reactive-wall"] + SIZE_PRICE["grand"]
    with app_page(browser, app_url, f"/c/{c['id']}/configure", api=api, size=(375, 812), reduced=True) as page:
        stage = page.get_by_role("img", name="Venue stage")
        pump(page, lambda: stage.first.get_attribute("data-motion") == "still", "the stage was a still frame (L361)")
        tap(page.get_by_role("button", name="Show inspector"))
        grand_radio = page.get_by_role("radio", name="Grand")
        pump(page, lambda: visible(page.get_by_role("radiogroup", name="Size")), "the sheet opened (L234)")
        check(grand_radio)
        tap(page.get_by_role("button", name="Save quote"))
        poll(lambda: commission(api, c["id"]), lambda x: x["options"]["size"] == "grand", "Save quote saved Grand (L233)")
        tap(page.get_by_role("button", name="Place Camera-reactive wall"))
        piece = piece_button(page, "Camera-reactive wall")
        pump(page, lambda: focused(piece), "the wall was placed (L223)")
        page.keyboard.press("Enter")
        layout(page)
    done = wait_state(api, c["id"], "placed")
    assert done["quote"]["totalCents"] == grand + tax_of(grand, VENUES["halsted-works"][2])


def dst_days(zone: str, today: date) -> list[date]:
    tz, out = ZoneInfo(zone), []
    for k in range(BOOK_MIN_DAYS + 1, BOOK_MAX_DAYS - 1):
        d = today + timedelta(days=k)
        n = d + timedelta(days=1)
        if datetime(d.year, d.month, d.day, tzinfo=tz).utcoffset() != datetime(n.year, n.month, n.day, tzinfo=tz).utcoffset():
            out.append(d)
    return out


def test_install_days_venue_zone(app_url: str, wiremock: WireMock) -> None:
    api, rival = register(app_url), register(app_url)
    candidates = []
    for venue, (_, zone, _) in VENUES.items():
        tz = ZoneInfo(zone)
        today = server_today(api, zone)
        regular = today + timedelta(days=BOOK_MIN_DAYS + 3)
        for d in dst_days(zone, today) + [regular]:
            days = {x["date"]: x for x in api.ok("GET", f"/api/venues/{venue}/days", 200, params={"from": d.isoformat(), "to": (d + timedelta(days=1)).isoformat()})["days"]}
            start, end = parse_ts(days[d.isoformat()]["startsAt"]), parse_ts(days[d.isoformat()]["endsAt"])
            local = start.astimezone(tz)
            assert (local.hour, local.minute, local.date()) == (0, 0, d) and start.utcoffset() == local.utcoffset()
            n = d + timedelta(days=1)
            real = (datetime(n.year, n.month, n.day, tzinfo=tz).astimezone(timezone.utc)
                    - datetime(d.year, d.month, d.day, tzinfo=tz).astimezone(timezone.utc))
            assert end - start == real, f"{venue} {d} lasted {end - start}; expected {real} (L737)"
            if d != regular and days[d.isoformat()]["status"] == "free":
                candidates.append((venue, d))
    assert candidates, "no free daylight-saving day to hold in the bookable window"
    venue, d = random.choice(candidates)
    mine, theirs = placed(api, wiremock, venue=venue), placed(rival, wiremock, venue=venue)
    _, h = hold_day(api, mine, d)
    assert h["date"] == d.isoformat()
    r = rival.post(f"/api/commissions/{theirs['id']}/hold", json={"date": d.isoformat()})
    assert r.status_code == 409 and _code(r) == "day_taken"
    assert api.delete(f"/api/commissions/{mine['id']}/hold").status_code == 204


def test_hold_race_one_winner(app_url: str, wiremock: WireMock) -> None:
    a, b = register(app_url), register(app_url)
    venue = random.choice(list(VENUES))
    comms = [(a, placed(a, wiremock, venue=venue)) for _ in range(3)] + [(b, placed(b, wiremock, venue=venue)) for _ in range(2)]
    d = pick_day(a, venue)
    gate = threading.Barrier(len(comms))

    def fire(pair: tuple[Api, dict[str, Any]]) -> httpx.Response:
        gate.wait()
        return pair[0].post(f"/api/commissions/{pair[1]['id']}/hold", json={"date": d.isoformat()})

    with ThreadPoolExecutor(len(comms)) as pool:
        results = list(pool.map(fire, comms))
    wins = [r for r in results if r.status_code == 201]
    assert len(wins) == 1, f"{[r.status_code for r in results]}; expected exactly one 201 (L747)"
    free = sorted(x for x, s in day_statuses(b, venue, d + timedelta(days=1), d + timedelta(days=DAYS_SPAN)).items() if s == "free")
    for r in results:
        if r.status_code == 201:
            continue
        err = r.json()["error"]
        assert r.status_code == 409 and err["code"] == "day_taken" and err["message"] == "That day was just taken."
        assert err["nextFreeDays"] == free[:3], f"{err['nextFreeDays']}; expected the earliest free days after {d} (L740)"
    states = sorted(commission(api, c["id"])["state"] for api, c in comms)
    assert states.count("held") == 1 and states.count("placed") == 4


def test_hold_deadline_server_edge(app_url: str, wiremock: WireMock, mail: Mailpit) -> None:
    base = short_base()
    api = register(base)
    c = placed(api, wiremock)
    d, h = hold_day(api, c)
    expires = parse_ts(h["expiresAt"])
    assert h["status"] == "held" and 0 <= h["secondsRemaining"] and abs((expires - parse_ts(h["serverTime"])).total_seconds() - h["secondsRemaining"]) <= 1
    seen = {"held": 0, "expired": 0}

    def observe() -> str:
        g = api.ok("GET", f"/api/commissions/{c['id']}/hold", 200)
        now = parse_ts(g["serverTime"])
        assert g["secondsRemaining"] >= 0
        if now < expires:
            assert g["status"] == "held", f"hold ended early at {now} before {expires} (L744)"
        else:
            assert g["status"] == "expired" and g["secondsRemaining"] == 0, f"hold still {g['status']} at {now} >= {expires} (L744)"
        seen[g["status"]] += 1
        return g["status"]

    poll(observe, lambda s: s == "expired", "the hold expired at expiresAt (L744)", seconds=JOB_S)
    assert seen["held"] >= 1
    wait_state(api, c["id"], "placed", seconds=HOLD_END_JOB_S + 5)
    assert day_statuses(api, VENUE_OF[c["id"]], d, d)[d.isoformat()] == "free"
    subject = poll(lambda: [m for m in mail.messages() if api.email in addresses(m.get("To")) and re.fullmatch(rf"Your hold on {date_re(d)} has ended", m.get("Subject", ""))],
                   bool, "the hold-ended email arrived (L880)")
    assert len(subject) == 1


def test_hold_countdown_ignores_device_clock(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    hold_day(api, c)
    with app_page(browser, app_url, "/api/health", api=api) as page:
        page.clock.set_system_time(datetime.now(timezone.utc) + timedelta(hours=3))
        page.goto(f"{app_url}/c/{c['id']}/day")
        timer = page.get_by_role("timer", name="Hold time left")

        def shown() -> int:
            m = re.fullmatch(r"(\d+):(\d{2}) left", text_of(timer))
            return int(m.group(1)) * 60 + int(m.group(2)) if m else -1

        pump(page, lambda: shown() > 0, "timer Hold time left showed <m>:<ss> left (L174)")
        server = api.ok("GET", f"/api/commissions/{c['id']}/hold", 200)["secondsRemaining"]
        assert abs(shown() - server) <= 5, f"countdown {shown()} vs server {server} (L239)"
        start = shown()
        advance(page, 20_000)
        assert abs((start - shown()) - 20) <= 3, "the countdown didn't count by elapsed page time (L239)"


def test_wf_install_day_hold_journey(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    d = pick_day(api, "halsted-works")
    with app_page(browser, app_url, f"/c/{c['id']}/day", api=api, reduced=True) as page:
        click(goto_day(page, d))
        click(page.get_by_role("button", name=re.compile(rf"^Hold {date_re(d)}$")))
        status = page.get_by_role("status", name="Hold status")
        pump(page, lambda: re.fullmatch(rf"Held {date_re(d)}\. Finish checkout before the timer runs out\.", text_of(status)) is not None, "Hold status announced the hold (L400)")
        pump(page, lambda: re.fullmatch(r"\d+:\d{2} left", text_of(page.get_by_role("timer", name="Hold time left"))) is not None, "the countdown showed (L174)")
    h = api.ok("GET", f"/api/commissions/{c['id']}/hold", 200)
    assert h["status"] == "held" and h["date"] == d.isoformat()
    assert commission(api, c["id"])["state"] == "held"


def test_wf_install_day_hold_taken(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    a, b = register(app_url), register(app_url)
    ca, cb = placed(a, wiremock), placed(b, wiremock)
    d = pick_day(b, "halsted-works")
    with app_page(browser, app_url, f"/c/{cb['id']}/day", api=b, reduced=True) as page:
        click(goto_day(page, d))
        hold_day(a, ca, d)
        click(page.get_by_role("button", name=re.compile(rf"^Hold {date_re(d)}$")))
        status = page.get_by_role("status", name="Hold status")
        pump(page, lambda: text_of(status).startswith("That day was just taken."), "Hold status showed the taken copy (L400)")
        nxt = [date.fromisoformat(x) for x in b.post(f"/api/commissions/{cb['id']}/hold", json={"date": d.isoformat()}).json()["error"]["nextFreeDays"]]
        names = [date_re(x) for x in nxt]
        tail = f"{', '.join(names[:-1])} and {names[-1]}" if len(names) > 1 else names[0]
        assert re.fullmatch(rf"That day was just taken\. The next free days are {tail}\.", text_of(status)), text_of(status)
    assert commission(b, cb["id"])["state"] == "placed"


def test_wf_install_day_hold_ends_mid_checkout(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    base = short_base()
    api = register(base)
    c = placed(api, wiremock)
    d, _ = hold_day(api, c)
    hold_status = lambda: api.ok("GET", f"/api/commissions/{c['id']}/hold", 200)["status"]
    with app_page(browser, base, f"/c/{c['id']}/checkout", api=api) as page:
        sheet = page.get_by_role("dialog", name="Payment")
        opener = page.get_by_role("button", name=re.compile(r"^Pay deposit \$"))
        for _ in range(HOLD_TRIES):
            if hold_status() != "held" and api.post(f"/api/commissions/{c['id']}/hold", json={"date": d.isoformat()}).status_code != 201:
                continue
            if api.post(f"/api/commissions/{c['id']}/quote/refresh").status_code != 200:
                continue
            if api.post(f"/api/commissions/{c['id']}/sign", json={"signatureName": SIGNER, "acceptTerms": True}).status_code != 201:
                continue
            page.reload()
            ended_now = page.get_by_role("heading", name="Your hold has ended")
            deadline = time.monotonic() + WAIT_S
            while time.monotonic() < deadline:
                try:
                    if visible(opener) or visible(ended_now):
                        break
                    advance(page, 100)
                except PlaywrightError:
                    continue
            if not visible(opener) or not opener.first.is_enabled():
                continue
            click(opener)
            pump(page, lambda: visible(sheet), "the payment sheet opened (L176)")
            fill(sheet.get_by_role("textbox", name="Name on card"), CARD_NAME)
            fill(sheet.get_by_role("textbox", name="Card number"), CARD)
            if hold_status() == "held":
                break
        else:
            pytest.fail("the payment sheet was never open and filled while the hold was active; expected Pay deposit to open the sheet during a fresh hold (L176, L240)")
        ended = page.get_by_role("heading", name="Your hold has ended")
        pump(page, lambda: visible(ended), "the hold-ended state appeared in place (L240)")
        assert visible(sheet), "the open payment sheet closed when the hold ended (L240)"
        assert sheet.get_by_role("textbox", name="Name on card").input_value() == CARD_NAME
        assert re.fullmatch(rf"Your hold on {date_re(d)} has ended\. Pick a day again to finish — your details are still here\.",
                            text_of(page.get_by_role("status", name="Hold status")))
        click(page.get_by_role("button", name=re.compile(rf"^Hold {date_re(d)} again$")))
        pump(page, lambda: api.ok("GET", f"/api/commissions/{c['id']}/hold", 200)["status"] == "held", "Hold again re-held the day (L240)", seconds=10)
        assert sheet.get_by_role("textbox", name="Card number").input_value() == CARD


def test_amounts_exact_across_systems(app_url: str, wiremock: WireMock, killbill: KillBill, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock, size="standard", addons=("night-lighting",))
    q = c["quote"]
    assert (q["subtotalCents"], q["taxCents"], q["totalCents"]) == (EX_SUBTOTAL, EX_TAX, EX_TOTAL)
    assert {l["label"]: l["amountCents"] for l in q["lines"]} == {"Camera-reactive wall": MAIN_PRICE["camera-reactive-wall"], "Size: Standard": SIZE_PRICE["standard"],
                                                                   "Night-mode lighting": EXTRA_PRICE["night-lighting"], "Sales tax (10.25%)": EX_TAX}
    f = prod.ok("PUT", f"/api/commissions/{c['id']}/funders", 200, json=funders_body([5000, 2500, 2500], sponsors(2)))["funders"]
    assert [x["taxCents"] for x in f] == EX_TAX_PARTS and f[1]["amountCents"] == EX_SPONSOR_A
    hold_day(api, c)
    sign(api, c["id"])
    ms = {m["label"]: m for m in commission(api, c["id"])["milestones"]}
    assert ms["Deposit"]["amountCents"] == EX_DEPOSIT and ms["Concept approval"]["taxCents"] == EX_CONCEPT_TAX
    assert ms["Fabrication"]["taxCents"] == EX_LATER_TAX and ms["Signed acceptance"]["taxCents"] == EX_LATER_TAX
    dep = ms["Deposit"]
    paid = pay(api, f"/api/milestones/{dep['id']}/payments").json()
    assert (paid["amountCents"], paid["subtotalCents"], paid["taxCents"]) == (EX_DEPOSIT, dep["subtotalCents"], dep["taxCents"])
    inv = kb_invoice(killbill, kb_account(killbill, api)["accountId"], paid["killbillInvoiceId"])
    items = {i["description"]: kb_cents(i["amount"]) for i in inv["items"]}
    assert items == {f"{c['title']} — Deposit — work": dep["subtotalCents"], f"{c['title']} — Deposit — sales tax": dep["taxCents"]}
    assert kb_cents(inv["amount"]) == EX_DEPOSIT
    body = text(mails(mail, api.email, f"Receipt — {c['title']} — Deposit")[0])
    for line in (f"Amount paid: {usd(EX_DEPOSIT)}", f"Work: {usd(dep['subtotalCents'])}", f"Sales tax: {usd(dep['taxCents'])}",
                 f"Kill Bill invoice: {inv['invoiceNumber']}", f"Payment reference: {paid['killbillPaymentId']}"):
        assert line in body, f"receipt lacks {line!r} (L876)"
    doc = poll(lambda: milestone(commission(api, c["id"]), "Deposit")["documentId"], bool, "the deposit invoice document was issued (L824)")
    pdf = poll(lambda: api.get(f"/api/documents/{doc}/pdf"), lambda r: r.status_code == 200, "the invoice PDF was ready (L617)").content
    words = pdf_text(pdf)
    assert f"Invoice — {c['title']} — Deposit" in words and usd(EX_DEPOSIT).lstrip("$") in words


def test_quote_validity_edge(app_url: str, wiremock: WireMock) -> None:
    prim = register(app_url)
    q = placed(prim, wiremock, venue="pier-nine")["quote"]
    tz = ZoneInfo(VENUES["pier-nine"][1])
    issued, until = parse_ts(q["issuedAt"]).astimezone(tz), parse_ts(q["validUntil"]).astimezone(tz)
    assert until.date() == issued.date() + timedelta(days=QUOTE_DAYS) and (until.hour, until.minute, until.second) == (23, 59, 59)
    api = register(short_base())
    c = placed(api, wiremock)
    d, _ = hold_day(api, c)
    v = parse_ts(api.ok("POST", f"/api/commissions/{c['id']}/quote/refresh", 200)["quote"]["validUntil"]).replace(microsecond=0)
    seen = {"usable": 0, "expired": 0}

    def probe() -> int:
        g = api.get(f"/api/commissions/{c['id']}/hold")
        if g.status_code != 200 or g.json()["status"] != "held":
            api.post(f"/api/commissions/{c['id']}/hold", json={"date": d.isoformat()})
        r = api.post(f"/api/commissions/{c['id']}/sign", json={"signatureName": "", "acceptTerms": True})
        at = served_at(r).replace(microsecond=0)
        if _code(r) == "hold_expired":
            return seen["expired"]
        if at <= v:
            assert r.status_code == 422 and "signatureName" in r.json()["errors"], f"refused at {at} within validUntil {v} (L754)"
            seen["usable"] += 1
        elif at >= v + timedelta(seconds=2):
            assert r.status_code == 409 and _code(r) == "quote_expired" and r.json()["error"]["message"] == QUOTE_EXPIRED, f"usable at {at} after {v} (L754)"
            seen["expired"] += 1
        return seen["expired"]

    poll(probe, lambda n: n >= 1, "signing answered quote_expired after validUntil (L754)", seconds=JOB_S)
    assert seen["usable"] >= 1


def test_payment_idempotency(app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    hold_day(api, c)
    path = f"/api/milestones/{sign(api, c['id'])['depositMilestoneId']}/payments"
    acct = kb_account(killbill, api)["accountId"]
    for r, field, msg in ((pay(api, path, key="bad key!"), "idempotencyKey", "Send an Idempotency-Key of 1 to 64 letters, digits, - or _."),
                          (pay(api, path, name=""), "nameOnCard", "Enter the name on the card."),
                          (pay(api, path, card="4242 4242 4242 4241"), "cardNumber", "Check the card number.")):
        assert r.status_code == 422 and r.json()["errors"][field] == msg
    assert killbill.payments(acct) == []
    key = idempotency_key()
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda _: pay(api, path, key), range(4)))
    assert all(r.status_code == 201 for r in results) and len({r.json()["paymentId"] for r in results}) == 1
    replay = pay(api, path, key)
    assert replay.status_code == 201 and replay.json() == results[0].json()
    conflict = pay(api, path, key, name="Other Name")
    assert conflict.status_code == 409 and _code(conflict) == "idempotency_conflict"
    again = pay(api, path)
    assert again.status_code == 409 and _code(again) == "already_paid"
    assert kb_keys(killbill, acct).count(key) == 1 and len(killbill.payments(acct)) == 1
    assert len(api.ok("GET", f"/api/commissions/{c['id']}/ledger", 200)["entries"]) == 1


def test_paid_only_after_killbill(app_url: str, wiremock: WireMock, killbill: KillBill, mail: Mailpit, svix: Svix) -> None:
    api = register(app_url)
    api.ok("PUT", "/api/me/crm-endpoint", 200, json={"url": f"https://crm-{uuid.uuid4().hex[:8]}.example/hooks"})
    c = contracted(api, wiremock)
    assert transition(api, c["id"], "concept_approved").status_code == 200
    concept = milestone(commission(api, c["id"]), "Concept approval")
    acct = kb_account(killbill, api)["accountId"]
    before = len(killbill.payments(acct))
    down = sign_in(outage_base("APP_KILLBILL_DOWN_URL"), api.email, api.password)
    r = pay(down, f"/api/milestones/{concept['id']}/payments")
    assert r.status_code == 503 and _code(r) == "billing_unavailable"
    assert milestone(commission(api, c["id"]), "Concept approval")["state"] != "paid"
    assert len(api.ok("GET", f"/api/commissions/{c['id']}/ledger", 200)["entries"]) == 1 and len(killbill.payments(acct)) == before
    ok = pay(api, f"/api/milestones/{concept['id']}/payments")
    assert ok.status_code == 201 and ok.json()["status"] == "paid"
    entries = api.ok("GET", f"/api/commissions/{c['id']}/ledger", 200)["entries"]
    assert len(entries) == 2 and ok.json()["killbillPaymentId"] in {e["killbillPaymentId"] for e in entries}
    assert len(killbill.payments(acct)) == before + 1
    assert len(mails(mail, api.email, f"Receipt — {c['title']} — Concept approval")) == 1
    app_uid = f"client-{api.me['id']}"
    msgs = poll(lambda: [m for m in svix.messages(app_uid, "milestone.paid") if m["payload"]["data"]["milestoneId"] == concept["id"]], bool, "Svix got milestone.paid (L903)")
    assert len(msgs) == 1


def test_wf_checkout_keyboard_deposit(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill, mail: Mailpit, ntfy: Ntfy) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    d, _ = hold_day(api, c)
    with app_page(browser, app_url, f"/c/{c['id']}/checkout", api=api, reduced=True) as page:
        kb = page.keyboard
        tab_to(page, page.get_by_role("textbox", name="Full name as signature"), "Tab reached the signature field (L175)")
        kb.type(SIGNER)
        tab_to(page, page.get_by_role("checkbox", name="I agree to the commission agreement"), "Tab reached the agreement box")
        kb.press("Space")
        tab_to(page, page.get_by_role("button", name="Sign agreement"), "Tab reached Sign agreement")
        kb.press("Enter")
        pump(page, lambda: "Agreement signed. Your contract PDF is being prepared." in text_of(page.get_by_role("status", name="Notices")), "Notices announced signing (L402)")
        amount = usd(milestone(commission(api, c["id"]), "Deposit")["amountCents"])
        opener = page.get_by_role("button", name=f"Pay deposit {amount}")
        tab_to(page, opener, "Tab reached Pay deposit")
        kb.press("Enter")
        sheet = page.get_by_role("dialog", name="Payment")
        pump(page, lambda: visible(sheet), "the Payment dialog opened (L176)")
        for _ in range(8):
            kb.press("Tab")
            assert sheet.first.evaluate(FOCUSED_JS), "Tab left the Payment dialog (L244)"
        kb.press("Shift+Tab")
        assert sheet.first.evaluate(FOCUSED_JS)
        kb.press("Escape")
        pump(page, lambda: not visible(sheet) and focused(opener), "Escape closed Payment and returned focus (L244)")
        kb.press("Enter")
        pump(page, lambda: visible(sheet), "Payment reopened")
        tab_to(page, sheet.get_by_role("textbox", name="Name on card"), "Tab reached Name on card")
        kb.type(CARD_NAME)
        tab_to(page, sheet.get_by_role("textbox", name="Card number"), "Tab reached Card number")
        kb.type(CARD)
        tab_to(page, sheet.get_by_role("button", name=f"Pay {amount}"), "Tab reached Pay")
        kb.press("Enter")
        pump(page, lambda: text_of(page.get_by_role("status", name="Payment status")) == f"Paid {amount}. Your receipt is on its way.", "Payment status announced the payment (L403)")
    done = wait_state(api, c["id"], "contracted")
    assert done["installDay"]["date"] == d.isoformat()
    assert day_statuses(producer(app_url), "halsted-works", d, d)[d.isoformat()] == "booked"
    assert killbill.payments(kb_account(killbill, api)["accountId"])
    mails(mail, api.email, f"Receipt — {c['title']} — Deposit")
    poll(lambda: [m for m in crew_alerts(ntfy, c["title"]) if re.fullmatch(rf"Slot confirmed — Halsted Works Hall — {date_re(d)}", m.get("title", ""))], lambda ms: len(ms) == 1, "one slot-confirmed alert (L918)")


def test_wf_checkout_payment_outage(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    hold_day(api, c)
    sign(api, c["id"])
    base = outage_base("APP_KILLBILL_DOWN_URL")
    down = sign_in(base, api.email, api.password)
    with app_page(browser, base, f"/c/{c['id']}/checkout", api=down) as page:
        click(page.get_by_role("button", name=re.compile(r"^Pay deposit \$")))
        sheet = page.get_by_role("dialog", name="Payment")
        pump(page, lambda: visible(sheet), "Payment opened")
        fill(sheet.get_by_role("textbox", name="Name on card"), CARD_NAME)
        fill(sheet.get_by_role("textbox", name="Card number"), CARD)
        click(sheet.get_by_role("button", name=re.compile(r"^Pay \$")))
        status = page.get_by_role("status", name="Payment status")
        pump(page, lambda: text_of(status) == BANNERS["Kill Bill"], "Payment status showed the Kill Bill banner (L440)")
        advance(page, (TOAST_S + 4) * 1000)
        assert text_of(status) == BANNERS["Kill Bill"] and visible(sheet), "a timer repainted the status or closed the sheet (L242)"
        assert sheet.get_by_role("textbox", name="Name on card").input_value() == CARD_NAME
    acct = killbill.account_by_key(api.me["id"])
    assert acct is None or killbill.payments(acct["accountId"]) == []
    assert commission(api, c["id"])["state"] == "held"


def test_funder_split_largest_remainder(app_url: str, wiremock: WireMock, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock, size="standard", addons=("night-lighting",))
    q = c["quote"]
    path = f"/api/commissions/{c['id']}/funders"
    for weights in ([5000, 2500, 2500], [3334, 3333, 3333], [9998, 1, 1], [1, 9999]):
        f = prod.ok("PUT", path, 200, json=funders_body(weights, sponsors(len(weights) - 1)))["funders"]
        assert [x["subtotalCents"] for x in f] == split(q["subtotalCents"], weights)
        assert [x["taxCents"] for x in f] == split(q["taxCents"], weights)
        assert sum(x["amountCents"] for x in f) == q["totalCents"] and f[0]["state"] == "lead"
    last = prod.ok("GET", path, 200)
    for body, key, msg in ((funders_body([5000, 2500, 2499], sponsors(2)), "funders", "Shares must add up to 100.00%."),
                           (funders_body([4000, 1500, 1500, 1500, 1500], sponsors(4)), "funders", "Up to three sponsors per commission."),
                           (funders_body([10000, 0], sponsors(1)), r"funders\[\d+\]\.bp", "Each share must be at least 0.01%."),
                           (funders_body([5000, 5000], [("Sam Sponsor", "not-an-email")]), r"funders\[\d+\]\.email", "Enter a valid email.")):
        r = prod.put(path, json=body)
        assert r.status_code == 422 and any(re.fullmatch(key, k) and v == msg for k, v in r.json()["errors"].items()), r.text[:300]
    assert prod.ok("GET", path, 200) == last
    pair = sponsors(1)
    f = prod.ok("PUT", path, 200, json=funders_body([5000, 5000], pair))["funders"]
    token = new_token(mail, pair[0][1], c["title"], [])
    register(app_url, "sponsor").ok("POST", f"/api/invites/{token}/accept", 200)
    locked = prod.put(path, json=funders_body([6000, 4000], pair))
    assert locked.status_code == 409 and _code(locked) == "funders_locked"
    assert prod.ok("GET", path, 200)["funders"][1]["bp"] == f[1]["bp"]


def test_sponsor_invite_link_rules(app_url: str, wiremock: WireMock, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock)
    (na, ea), (nb, eb) = sponsors(2)
    f = prod.ok("PUT", f"/api/commissions/{c['id']}/funders", 200, json=funders_body([5000, 2500, 2500], [(na, ea), (nb, eb)]))["funders"]
    mine = f[1]
    token = new_token(mail, ea, c["title"], [])
    assert len(token) >= STATE_MIN_CHARS
    body = text(mails(mail, ea, f"You're invited to co-fund {c['title']}")[0])
    assert f"Your share: {usd(mine['amountCents'])} (25.00%)" in body and "This link works until" in body
    view = httpx.get(f"{app_url}/api/invites/{token}", timeout=HTTP_TIMEOUT)
    assert view.status_code == 200
    share = view.json()["share"]
    assert (share["bp"], share["amountCents"], share["taxCents"]) == (2500, mine["amountCents"], mine["taxCents"])
    assert view.json()["commission"]["title"] == c["title"]
    for leak in (nb, eb, str(c["quote"]["totalCents"]), str(f[2]["amountCents"]) if f[2]["amountCents"] != mine["amountCents"] else nb):
        assert leak not in view.text, f"the invite disclosed {leak!r} (L732)"
    for method in ("POST", "PUT", "DELETE", "PATCH"):
        assert httpx.request(method, f"{app_url}/api/invites/{token}", timeout=HTTP_TIMEOUT).status_code == 405
    assert httpx.post(f"{app_url}/api/invites/{token}/accept", timeout=HTTP_TIMEOUT).status_code == 401
    assert prod.ok("GET", f"/api/commissions/{c['id']}/funders", 200)["funders"][1]["state"] == "invited"
    prod.ok("POST", f"/api/funders/{mine['id']}/invite", 200)
    old = httpx.get(f"{app_url}/api/invites/{token}", timeout=HTTP_TIMEOUT)
    assert old.status_code == 404 and _code(old) == "invite_invalid"
    fresh = new_token(mail, ea, c["title"], [token])
    assert httpx.get(f"{app_url}/api/invites/{fresh}", timeout=HTTP_TIMEOUT).status_code == 200
    assert prod.delete(f"/api/funders/{mine['id']}/invite").status_code == 204
    assert _code(httpx.get(f"{app_url}/api/invites/{fresh}", timeout=HTTP_TIMEOUT)) == "invite_invalid"
    assert prod.ok("GET", f"/api/commissions/{c['id']}/funders", 200)["funders"][1]["state"] == "revoked"
    tb = new_token(mail, eb, c["title"], [])
    sponsor, other = register(app_url, "sponsor"), register(app_url, "sponsor")
    first = sponsor.ok("POST", f"/api/invites/{tb}/accept", 200)
    assert first["commissionId"] == c["id"] and sponsor.ok("POST", f"/api/invites/{tb}/accept", 200) == first
    used = other.post(f"/api/invites/{tb}/accept")
    assert used.status_code == 409 and _code(used) == "invite_used"
    assert sponsor.ok("GET", f"/api/commissions/{c['id']}/share", 200)["share"]["amountCents"] == f[2]["amountCents"]
    assert other.get(f"/api/commissions/{c['id']}/share").status_code == 404


def test_sponsor_invite_expires_on_server(app_url: str, wiremock: WireMock, mail: Mailpit) -> None:
    base = short_base()
    api, prod = register(base), producer(base)
    c = placed(api, wiremock)
    pair = sponsors(1)
    prod.ok("PUT", f"/api/commissions/{c['id']}/funders", 200, json=funders_body([5000, 5000], pair))
    token = new_token(mail, pair[0][1], c["title"], [])
    e = parse_ts(poll(lambda: prod.ok("GET", f"/api/commissions/{c['id']}/funders", 200)["funders"][1].get("inviteExpiresAt"), bool,
                      "the producer's funders listed the invite's expiry (L602)"))

    def probe() -> int:
        r = httpx.get(f"{base}/api/invites/{token}", timeout=HTTP_TIMEOUT)
        at = served_at(r).replace(microsecond=0)
        if at + timedelta(seconds=1) <= e:
            assert r.status_code == 200, f"invite refused at {at} before {e} (L731)"
        elif at >= e + timedelta(seconds=1):
            assert r.status_code == 410 and _code(r) == "invite_expired", f"invite still open at {at} after {e} (L731)"
        return r.status_code

    poll(probe, lambda s: s == 410, "the invite expired on the server (L731)")
    poll(lambda: prod.ok("GET", f"/api/commissions/{c['id']}/funders", 200)["funders"][1]["state"], lambda s: s == "expired", "the sponsor became expired (L726)")


def test_wf_co_funding_sponsor_journey(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock)
    (na, ea), (nb, eb) = sponsors(2)
    f = prod.ok("PUT", f"/api/commissions/{c['id']}/funders", 200, json=funders_body([5000, 2500, 2500], [(na, ea), (nb, eb)]))["funders"]
    token = new_token(mail, ea, c["title"], [])
    sponsor = register(app_url, "sponsor", email=ea)
    amount = usd(f[1]["amountCents"])
    with app_page(browser, app_url, f"/i/{token}", reduced=True) as page:
        pump(page, lambda: visible(page.get_by_text(amount)), "the invite showed the sponsor's share (L133)")
        assert page.get_by_text(nb).count() == 0
        click(page.get_by_role("button", name="Accept and sign in"))
        browser_sign_in(page, app_url, sponsor.email, sponsor.password)
        pump(page, lambda: page.url.endswith(f"/c/{c['id']}/share"), "the sponsor landed on /c/<commission id>/share (L252)")
        pump(page, lambda: "You're in. Here's your share." in text_of(page.get_by_role("status", name="Notices")), "Notices announced acceptance (L405)")
        click(page.get_by_role("button", name="Pay my share"))
        sheet = page.get_by_role("dialog", name="Payment")
        pump(page, lambda: visible(sheet), "the Payment sheet opened for the share")
        fill(sheet.get_by_role("textbox", name="Name on card"), CARD_NAME)
        fill(sheet.get_by_role("textbox", name="Card number"), CARD)
        click(sheet.get_by_role("button", name=f"Pay {amount}"))
        pump(page, lambda: text_of(page.get_by_role("status", name="Payment status")) == f"Paid {amount}. Your receipt is on its way.", "the share was paid (L403)")
        page.reload()
        paid = page.get_by_text(re.compile(r"\bPaid\b"))
        pump(page, lambda: any(paid.nth(i).is_visible() for i in range(paid.count())), "the share showed as Paid (L31)")
    acct = kb_account(killbill, sponsor)["accountId"]
    assert len(killbill.payments(acct)) == 1
    items = {i["description"]: kb_cents(i["amount"]) for inv in killbill.invoices(acct) for i in inv["items"]}
    assert items[f"{c['title']} — Sponsor share — work"] == f[1]["subtotalCents"] and items[f"{c['title']} — Sponsor share — sales tax"] == f[1]["taxCents"]
    mails(mail, ea, f"Receipt — {c['title']} — Sponsor share")


def test_wf_co_funding_invite_used(browser: Browser, app_url: str, wiremock: WireMock, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock)
    pair = sponsors(1)
    prod.ok("PUT", f"/api/commissions/{c['id']}/funders", 200, json=funders_body([5000, 5000], pair))
    token = new_token(mail, pair[0][1], c["title"], [])
    register(app_url, "sponsor").ok("POST", f"/api/invites/{token}/accept", 200)
    other = register(app_url, "sponsor")
    with app_page(browser, app_url, f"/i/{token}?accept=1", api=other, reduced=True) as page:
        pump(page, lambda: "This invite was already accepted by another account." in text_of(page.get_by_role("status", name="Notices")), "Notices showed the invite_used copy (L405)")
    assert other.get(f"/api/commissions/{c['id']}/share").status_code == 404


def test_state_machine_transitions(app_url: str, wiremock: WireMock) -> None:
    api, prod = register(app_url), producer(app_url)
    b = new_brief(api)
    for who, to in ((api, "concept_approved"), (prod, "fabricating"), (prod, "installed"), (api, "accepted")):
        r = transition(who, b["id"], to)
        err = r.json()["error"]
        assert r.status_code == 409 and err["code"] == "illegal_transition" and (err["from"], err["to"]) == ("briefed", to)
        assert err["message"] == f"A commission can't move from briefed to {to}."
    assert transition(api, b["id"], "cancelled").status_code == 403 and transition(prod, b["id"], "concept_approved").status_code == 403
    assert _code(transition(prod, b["id"], "placed")) == "illegal_transition"
    assert commission(api, b["id"])["state"] == "briefed"
    assert transition(prod, b["id"], "cancelled").status_code == 200
    assert _code(transition(prod, b["id"], "cancelled")) == "illegal_transition"
    c = contracted(api, wiremock)
    assert transition(api, c["id"], "concept_approved").status_code == 200
    blocked = transition(prod, c["id"], "fabricating")
    assert blocked.status_code == 409 and _code(blocked) == "milestone_unpaid"
    assert blocked.json()["error"]["milestoneId"] == milestone(commission(api, c["id"]), "Concept approval")["id"]
    pay_label(api, c["id"], "Concept approval")
    assert transition(prod, c["id"], "fabricating").json()["state"] == "fabricating"
    h = placed(api, wiremock)
    d, _ = hold_day(api, h)
    s = sign(api, h["id"])
    assert transition(prod, h["id"], "cancelled").status_code == 200
    late = pay(api, f"/api/milestones/{s['depositMilestoneId']}/payments")
    assert late.status_code == 409 and _code(late) == "commission_cancelled"
    assert day_statuses(api, "halsted-works", d, d)[d.isoformat()] == "free"


def assert_due(m: dict[str, Any], zone: str) -> None:
    tz = ZoneInfo(zone)
    due = parse_ts(m["dueAt"])
    local = due.astimezone(tz)
    assert local.date() == parse_ts(m["invoicedAt"]).astimezone(tz).date() + timedelta(days=DUE_DAYS)
    assert (local.hour, local.minute, local.second) == (23, 59, 59) and due.utcoffset() == local.utcoffset(), f"{m['label']} due {m['dueAt']} (L767)"


def test_milestone_invoice_due_dates(app_url: str, wiremock: WireMock, killbill: KillBill, mail: Mailpit) -> None:
    api = register(app_url)
    zone = VENUES["lantern-court"][1]
    c = placed(api, wiremock, venue="lantern-court")
    hold_day(api, c)
    s = sign(api, c["id"])
    cm = commission(api, c["id"])
    dep, concept = milestone(cm, "Deposit"), milestone(cm, "Concept approval")
    assert concept["killbillInvoiceId"] is None
    assert_due(dep, zone)
    acct = kb_account(killbill, api)["accountId"]
    assert kb_cents(kb_invoice(killbill, acct, dep["killbillInvoiceId"])["amount"]) == dep["amountCents"]
    body = text(mails(mail, api.email, f"Deposit is due — {c['title']}")[0])
    local = parse_ts(dep["dueAt"]).astimezone(ZoneInfo(zone)).date()
    assert f"Amount due: {usd(dep['amountCents'])}" in body
    assert re.search(rf"Due by: {date_re(local)}, 23:59:59 \({re.escape(zone)}\)", body)
    assert pay(api, f"/api/milestones/{s['depositMilestoneId']}/payments").status_code == 201
    wait_state(api, c["id"], "contracted")
    assert transition(api, c["id"], "concept_approved").status_code == 200
    concept = milestone(commission(api, c["id"]), "Concept approval")
    assert concept["killbillInvoiceId"] and concept["state"] == "invoiced"
    assert_due(concept, zone)
    assert kb_cents(kb_invoice(killbill, acct, concept["killbillInvoiceId"])["amount"]) == concept["amountCents"]


def test_contract_and_invoice_pdfs_frozen(app_url: str, wiremock: WireMock) -> None:
    base = short_base()
    api = register(base)
    c = placed(api, wiremock)
    d, _ = hold_day(api, c)
    api.ok("POST", f"/api/commissions/{c['id']}/quote/refresh", 200)
    first = sign(api, c["id"])
    docs = lambda: api.ok("GET", f"/api/commissions/{c['id']}/documents", 200)["documents"]
    issued = poll(docs, lambda ds: any(x["kind"] == "contract" and x["status"] == "issued" for x in ds) and any(x["kind"] == "invoice" and x["status"] == "issued" for x in ds),
                  "the contract and deposit invoice PDFs were issued (L823)")
    v1 = next(x for x in issued if x["kind"] == "contract")
    key = f"commissions/{c['id']}/documents/contract-v1.pdf"
    raw = S3("-short").get(key)
    assert hashlib.sha256(raw).hexdigest() == v1["sha256"] and api.get(f"/api/documents/{v1['id']}/pdf").content == raw
    assert f"Commission agreement — {c['title']}" in pdf_text(raw) and SIGNER in pdf_text(raw)
    inv = next(x for x in issued if x["kind"] == "invoice")
    inv_pdf = api.get(f"/api/documents/{inv['id']}/pdf").content
    assert f"Invoice — {c['title']} — Deposit" in pdf_text(inv_pdf)
    assert S3("-short").keys(f"commissions/{c['id']}/documents/invoice-") and hashlib.sha256(inv_pdf).hexdigest() == inv["sha256"]
    poll(lambda: api.ok("GET", f"/api/commissions/{c['id']}/hold", 200)["status"], lambda s: s == "expired", "the short hold ended (L744)")
    hold_day(api, c, d)
    api.ok("POST", f"/api/commissions/{c['id']}/quote/refresh", 200)
    second = sign(api, c["id"])
    assert second["contractVersion"] == first["contractVersion"] + 1 and second["contractDocumentId"] != first["contractDocumentId"]
    poll(docs, lambda ds: sum(x["kind"] == "contract" and x["status"] == "issued" for x in ds) == 2, "contract v2 was issued (L825)")
    assert S3("-short").get(key) == raw, "contract v1 bytes were rewritten (L825)"
    assert S3("-short").keys(f"commissions/{c['id']}/documents/contract-v2.pdf")


def test_wf_milestones_delivery_journey(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api, prod = register(app_url), producer(app_url)
    jonah = sign_in(app_url, *SEEDED["crew"])
    c = contracted(api, wiremock)
    with app_page(browser, app_url, f"/c/{c['id']}", api=api, reduced=True) as page:
        click(page.get_by_role("button", name="Approve concept"))
        pump(page, lambda: "Concept approved." in text_of(page.get_by_role("status", name="Notices")), "Notices: Concept approved. (L406)")
    with app_page(browser, app_url, f"/c/{c['id']}", api=prod, reduced=True) as page:
        start = page.get_by_role("button", name="Start fabrication")
        pump(page, lambda: visible(start), "the producer saw Start fabrication (L181)")
        if not (start.first.is_disabled() or start.first.get_attribute("aria-disabled") == "true"):
            click(start)
            notices = page.get_by_role("status", name="Notices")
            pump(page, lambda: "That step isn't available yet." in text_of(notices), "unpaid concept refused fabrication (L406)")
        assert commission(api, c["id"])["state"] == "concept_approved", "fabrication started before the concept milestone was paid (L660)"
        pay_label(api, c["id"], "Concept approval")
        page.reload()
        click(page.get_by_role("button", name="Start fabrication"))
        pump(page, lambda: "Fabrication started." in text_of(page.get_by_role("status", name="Notices")), "Notices: Fabrication started. (L406)")
    pay_label(api, c["id"], "Fabrication")
    prod.ok("POST", f"/api/install-days/{c['installDay']['id']}/crew", 200, json={"crewUserId": jonah.me["id"]})
    assert transition(jonah, c["id"], "installed").status_code == 200
    with app_page(browser, app_url, f"/c/{c['id']}", api=api, reduced=True) as page:
        click(page.get_by_role("button", name="Sign acceptance"))
        pump(page, lambda: "Acceptance signed." in text_of(page.get_by_role("status", name="Notices")), "Notices: Acceptance signed. (L406)")
    pay_label(api, c["id"], "Signed acceptance")
    done = commission(api, c["id"])
    assert done["state"] == "accepted" and all(m["state"] == "paid" for m in done["milestones"])
    acct = kb_account(killbill, api)["accountId"]
    for m in done["milestones"]:
        assert kb_cents(kb_invoice(killbill, acct, m["killbillInvoiceId"])["amount"]) == m["amountCents"]
    assert sum(e["amountCents"] for e in api.ok("GET", f"/api/commissions/{c['id']}/ledger", 200)["entries"]) == done["quote"]["totalCents"]


def test_wf_milestones_billing_outage(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api = register(app_url)
    c = contracted(api, wiremock)
    acct = kb_account(killbill, api)["accountId"]
    before = len(killbill.invoices(acct))
    base = outage_base("APP_KILLBILL_DOWN_URL")
    with app_page(browser, base, f"/c/{c['id']}", api=sign_in(base, api.email, api.password), reduced=True) as page:
        click(page.get_by_role("button", name="Approve concept"))
        pump(page, lambda: BANNERS["Kill Bill"] in text_of(page.get_by_role("status", name="Notices")), "Notices showed the Kill Bill banner (L440)")
    after = commission(api, c["id"])
    assert after["state"] == "contracted" and milestone(after, "Concept approval")["killbillInvoiceId"] is None
    assert len(killbill.invoices(acct)) == before


def accepted(api: Api, wiremock: WireMock, app_url: str) -> dict[str, Any]:
    c = contracted(api, wiremock)
    return deliver(api, producer(app_url), c["id"], "accepted")


def test_maintenance_subscription(app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api, prod = register(app_url), producer(app_url)
    c = contracted(api, wiremock)
    early = api.post(f"/api/commissions/{c['id']}/maintenance", json={"plan": "essential"})
    assert early.status_code == 409 and _code(early) in ("illegal_state", "milestone_unpaid")
    deliver(api, prod, c["id"], "installed")
    assert transition(api, c["id"], "accepted").status_code == 200
    unpaid = api.post(f"/api/commissions/{c['id']}/maintenance", json={"plan": "essential"})
    assert unpaid.status_code == 409 and _code(unpaid) == "milestone_unpaid"
    pay_label(api, c["id"], "Signed acceptance")
    m = api.ok("POST", f"/api/commissions/{c['id']}/maintenance", 201, json={"plan": "essential"})
    acct = kb_account(killbill, api)["accountId"]
    subs = [s for s in killbill.subscriptions(acct) if s.get("externalKey") == f"maint-{c['id']}" or s.get("bundleExternalKey") == f"maint-{c['id']}"]
    assert len(subs) == 1 and subs[0]["planName"] == "maintenance-essential-monthly" and not subs[0].get("billingEndDate")
    assert m["killbillSubscriptionId"] == subs[0]["subscriptionId"] and str(subs[0]["chargedThroughDate"]) == m["chargedThroughDate"]
    inv = kb_invoice(killbill, acct, m["invoice"]["killbillInvoiceId"])
    assert m["invoice"]["amountCents"] == kb_cents(inv["amount"]) and ESSENTIAL_CENTS in [kb_cents(i["amount"]) for i in inv["items"]]
    assert commission(api, c["id"])["state"] == "maintained"
    assert api.post(f"/api/commissions/{c['id']}/maintenance", json={"plan": "essential"}).status_code == 409


def test_plan_change_prorated_by_killbill(app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api = register(app_url)
    c = accepted(api, wiremock, app_url)
    api.ok("POST", f"/api/commissions/{c['id']}/maintenance", 201, json={"plan": "essential"})
    r = api.put(f"/api/commissions/{c['id']}/maintenance", json={"plan": "priority"})
    assert r.status_code == 200
    body = r.json()
    assert body["plan"] == "priority" and body["previousPlan"] == "essential"
    assert body["prorationDate"] == served_at(r).astimezone(ZoneInfo(VENUES["halsted-works"][1])).date().isoformat()
    acct = kb_account(killbill, api)["accountId"]
    inv = kb_invoice(killbill, acct, body["invoice"]["killbillInvoiceId"])
    assert sorted((i["description"], i["amountCents"]) for i in body["invoice"]["items"]) == sorted((i["description"], kb_cents(i["amount"])) for i in inv["items"])
    assert any(kb_cents(i["amount"]) < 0 for i in inv["items"]), "Kill Bill credited nothing for the old plan (L830)"
    assert any(s["planName"] == "maintenance-priority-monthly" for s in killbill.subscriptions(acct))
    same = api.put(f"/api/commissions/{c['id']}/maintenance", json={"plan": "priority"})
    assert same.status_code == 409 and _code(same) == "same_plan"


def test_wf_milestones_maintenance_journey(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill) -> None:
    api = register(app_url)
    c = accepted(api, wiremock, app_url)
    with app_page(browser, app_url, f"/c/{c['id']}/maintenance", api=api, reduced=True) as page:
        plans = page.get_by_role("radiogroup", name="Maintenance plan")
        pump(page, lambda: visible(plans), "radiogroup Maintenance plan showed (L187)")
        check(plans.get_by_role("radio", name=re.compile("Essential")))
        click(page.get_by_role("button", name="Start maintenance"))
        notices = page.get_by_role("status", name="Notices")
        pump(page, lambda: "Maintenance started on the Essential plan." in text_of(notices), "Notices: maintenance started (L408)")
        check(plans.get_by_role("radio", name=re.compile("Priority")))
        click(page.get_by_role("button", name="Change plan"))
        pump(page, lambda: "Switched to the Priority plan. Kill Bill's proration is below." in text_of(notices), "Notices: switched (L408)")
        table = page.get_by_role("table", name="Proration")
        pump(page, lambda: visible(table), "table Proration showed (L132)")
        acct = kb_account(killbill, api)["accountId"]
        latest = max(killbill.invoices(acct), key=lambda i: int(i["invoiceNumber"]))
        for item in latest["items"]:
            assert usd(abs(kb_cents(item["amount"]))) in text_of(table), f"Proration lacks Kill Bill item {item['description']} (L831)"
    assert commission(api, c["id"])["state"] == "maintained"


def test_crm_events_through_svix(app_url: str, wiremock: WireMock, svix: Svix) -> None:
    api = register(app_url)
    bad = api.put("/api/me/crm-endpoint", json={"url": "crm.example/hooks"})
    assert bad.status_code == 422 and bad.json()["errors"]["url"] == "Enter a full http or https address."
    url = f"https://crm-{uuid.uuid4().hex[:8]}.example/hooks"
    saved = api.ok("PUT", "/api/me/crm-endpoint", 200, json={"url": url})
    uid = f"client-{api.me['id']}"
    assert saved["url"] == url and saved["signingSecret"]
    assert [e["url"] for e in svix.endpoints(uid)] == [url]
    c = contracted(api, wiremock)
    for kind in ("slot.held", "contract.signed", "milestone.paid"):
        ms = poll(lambda: [m for m in svix.messages(uid, kind) if m["payload"]["commissionId"] == c["id"]], bool, f"Svix got {kind} (L903)")
        assert len(ms) == 1
        p = ms[0]["payload"]
        assert ms[0]["eventId"] == p["eventId"] and p["type"] == kind
    paid = svix.messages(uid, "milestone.paid")[0]["payload"]["data"]
    assert paid["amountCents"] == c["deposit"]["amountCents"] and paid["killbillPaymentId"] == c["deposit"]["killbillPaymentId"]
    for viewer in (api, producer(app_url)):
        rows = poll(lambda: viewer.ok("GET", f"/api/commissions/{c['id']}/webhook-deliveries", 200)["deliveries"], lambda d: len(d) >= 3, "deliveries listed (L630)")
        assert len({r["eventId"] for r in rows}) == len(rows)
        for r in rows:
            msg = next(m for m in svix.messages(uid, r["eventType"]) if m["eventId"] == r["eventId"])
            assert len(r["attempts"]) >= len(svix.attempts(uid, msg["id"])) - 1
            assert r["finalState"] in ("delivered", "retrying", "failed", "no_endpoint", "pending")
    assert register(app_url).get(f"/api/commissions/{c['id']}/webhook-deliveries").status_code == 404


def test_crm_events_after_svix_outage(app_url: str, wiremock: WireMock, svix: Svix) -> None:
    api = register(app_url)
    url = f"https://crm-{uuid.uuid4().hex[:8]}.example/hooks"
    api.ok("PUT", "/api/me/crm-endpoint", 200, json={"url": url})
    c = contracted(api, wiremock)
    assert transition(api, c["id"], "concept_approved").status_code == 200
    down = sign_in(outage_base("APP_SVIX_DOWN_URL"), api.email, api.password)
    r = down.put("/api/me/crm-endpoint", json={"url": url + "/other"})
    assert r.status_code == 503 and _code(r) == "webhooks_unavailable"
    concept = milestone(commission(api, c["id"]), "Concept approval")
    assert pay(down, f"/api/milestones/{concept['id']}/payments").status_code == 201
    uid = f"client-{api.me['id']}"
    poll(lambda: [m for m in svix.messages(uid, "milestone.paid") if m["payload"]["data"]["milestoneId"] == concept["id"]], lambda ms: len(ms) == 1, "the queued event reached Svix once (L914)")
    assert [e["url"] for e in svix.endpoints(uid)] == [url]


def test_wf_crm_webhooks_journey(browser: Browser, app_url: str, wiremock: WireMock, svix: Svix) -> None:
    api = register(app_url)
    url = f"https://crm-{uuid.uuid4().hex[:8]}.example/hooks"
    with app_page(browser, app_url, "/settings/crm", api=api, reduced=True) as page:
        fill(page.get_by_role("textbox", name="CRM endpoint URL"), url)
        click(page.get_by_role("button", name="Save endpoint"))
        pump(page, lambda: "Endpoint saved." in text_of(page.get_by_role("status", name="Notices")), "Notices: Endpoint saved. (L407)")
    uid = f"client-{api.me['id']}"
    assert [e["url"] for e in svix.endpoints(uid)] == [url]
    c = contracted(api, wiremock)
    msg = poll(lambda: [m for m in svix.messages(uid, "milestone.paid") if m["payload"]["commissionId"] == c["id"]], bool, "Svix got milestone.paid")[0]
    assert msg["payload"]["data"]["killbillPaymentId"] == c["deposit"]["killbillPaymentId"]
    with app_page(browser, app_url, f"/c/{c['id']}/webhooks", api=api, reduced=True) as page:
        table = page.get_by_role("table", name="CRM deliveries")
        row = table.get_by_role("row").filter(has_text="milestone.paid")
        pump(page, lambda: visible(row), "CRM deliveries listed milestone.paid (L131)")
        click(row.first)
        pump(page, lambda: msg["eventId"] in text_of(table) or visible(page.get_by_text(msg["eventId"])), "the row opened its attempts with the event id (L131)")


def test_wf_crm_webhooks_invalid_endpoint(browser: Browser, app_url: str, svix: Svix) -> None:
    api = register(app_url)
    with app_page(browser, app_url, "/settings/crm", api=api, reduced=True) as page:
        fill(page.get_by_role("textbox", name="CRM endpoint URL"), "not a url")
        click(page.get_by_role("button", name="Save endpoint"))
        pump(page, lambda: visible(page.get_by_text("Enter a full http or https address.")), "the endpoint error showed (L407)")
    assert api.ok("GET", "/api/me/crm-endpoint", 200)["url"] is None
    assert not any(a.get("uid") == f"client-{api.me['id']}" and svix.endpoints(a["uid"]) for a in svix.applications())


def test_crew_alerts_titles_once(app_url: str, wiremock: WireMock, ntfy: Ntfy) -> None:
    api, prod = register(app_url), producer(app_url)
    c = contracted(api, wiremock)
    d = c["day"]
    slot = poll(lambda: [m for m in crew_alerts(ntfy, c["title"]) if m.get("title", "").startswith("Slot confirmed")], bool, "slot-confirmed alert posted (L918)")
    assert len(slot) == 1 and re.fullmatch(rf"Slot confirmed — Halsted Works Hall — {date_re(d)}", slot[0]["title"])
    assert re.fullmatch(rf"{re.escape(c['title'])} at Halsted Works Hall on {date_re(d)}\. Ref \S+\.", slot[0]["message"]) and "spindrift" in slot[0].get("tags", [])
    day = prod.ok("GET", f"/api/install-days/{c['installDay']['id']}", 200)
    load = [a for a in day["alerts"] if re.fullmatch(rf"Load-in tomorrow — Halsted Works Hall — {date_re(d)}", a["title"])]
    assert len(load) == 1 and load[0]["status"] == "scheduled"
    at = parse_ts(load[0]["sendAt"]).astimezone(ZoneInfo(VENUES["halsted-works"][1]))
    assert at.date() == d - timedelta(days=1) and (at.hour, at.minute) == (LOAD_IN_HOUR, 0)
    cur = commission(api, c["id"])
    items = [dict(i, y=7.0) if n == 0 else i for n, i in enumerate(cur["layout"]["items"])]
    api.ok("PUT", f"/api/commissions/{c['id']}/layout", 200, json={"version": cur["layout"]["version"], "items": items})
    poll(lambda: [m for m in crew_alerts(ntfy, c["title"]) if m.get("title") == f"Placement changed — {c['title']}"], lambda ms: len(ms) == 1, "one placement-changed alert (L920)")


def test_crew_alert_after_ntfy_outage(app_url: str, wiremock: WireMock, ntfy: Ntfy) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    hold_day(api, c)
    base = outage_base("APP_NTFY_DOWN_URL")
    down = sign_in(base, api.email, api.password)
    assert httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT).json()["services"]["ntfy"] == "down"
    s = down.ok("POST", f"/api/commissions/{c['id']}/sign", 201, json={"signatureName": SIGNER, "acceptTerms": True})
    assert pay(down, f"/api/milestones/{s['depositMilestoneId']}/payments").status_code == 201
    poll(lambda: [m for m in crew_alerts(ntfy, c["title"]) if m.get("title", "").startswith("Slot confirmed")], lambda ms: len(ms) == 1, "the queued slot alert posted once (L922)", seconds=JOB_S + JOB_EFFECT_S)


def test_crew_sees_only_assigned_days(app_url: str, wiremock: WireMock) -> None:
    api, prod = register(app_url), producer(app_url)
    jonah, ama = sign_in(app_url, *SEEDED["crew"]), sign_in(app_url, *AMA)
    mine, theirs = contracted(api, wiremock), contracted(api, wiremock)
    d1, d2 = mine["installDay"]["id"], theirs["installDay"]["id"]
    prod.ok("POST", f"/api/install-days/{d1}/crew", 200, json={"crewUserId": jonah.me["id"]})
    ids = {x["id"] for x in jonah.ok("GET", "/api/install-days", 200)["installDays"]}
    assert d1 in ids and d2 not in ids
    assert jonah.ok("GET", f"/api/install-days/{d1}", 200)["commissionTitle"] == mine["title"]
    for r in (jonah.get(f"/api/install-days/{d2}"), transition(jonah, theirs["id"], "installed"), ama.get(f"/api/install-days/{d1}"),
              prod.post(f"/api/install-days/{d2}/crew", json={"crewUserId": api.me["id"]})):
        assert r.status_code == 404 and _code(r) == "not_found"
    assert commission(api, theirs["id"])["state"] == "contracted"


def test_wf_crew_phone_confirm(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api, prod = register(app_url), producer(app_url)
    jonah = sign_in(app_url, *SEEDED["crew"])
    c = contracted(api, wiremock)
    deliver(api, prod, c["id"], "fabricating")
    prod.ok("POST", f"/api/install-days/{c['installDay']['id']}/crew", 200, json={"crewUserId": jonah.me["id"]})
    with app_page(browser, app_url, "/crew", api=jonah, size=(375, 812), reduced=True) as page:
        menu = page.get_by_role("button", name="Menu")
        pump(page, lambda: visible(menu), "the Menu button showed below 768 px (L114)")
        tap(menu)
        drawer = page.get_by_role("dialog", name="Navigation")
        pump(page, lambda: visible(drawer), "dialog Navigation opened (L155)")
        page.keyboard.press("Escape")
        pump(page, lambda: drawer.count() == 0 or not visible(drawer), "Escape closed the drawer (L244)")
        assert "Close menu" not in tab_order(page, 15)
        layout(page)
        when = date.fromisoformat(c["installDay"]["date"])
        rows = page.get_by_role("list", name="Install days").get_by_role("listitem")
        keys = [re.escape(c["title"]), re.escape(VENUES[VENUE_OF[c["id"]]][0]), date_re(when)]
        pump(page, lambda: any(rows.filter(has_text=re.compile(k)).count() for k in keys), "Install days listed this day (L136)")
        tap(next(rows.filter(has_text=re.compile(k)) for k in keys if rows.filter(has_text=re.compile(k)).count()).first)
        pump(page, lambda: page.url.endswith(f"/crew/days/{c['installDay']['id']}"), "the day sheet opened (L136)")
        tap(page.get_by_role("button", name="Confirm installation"))
        pump(page, lambda: "Installation confirmed." in text_of(page.get_by_role("status", name="Notices")), "Notices: Installation confirmed. (L406)")
    assert commission(api, c["id"])["state"] == "installed"


def test_wf_crew_unassigned_day(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    ama = sign_in(app_url, *AMA)
    c = contracted(api, wiremock)
    with app_page(browser, app_url, f"/crew/days/{c['installDay']['id']}", api=ama, size=(375, 812), reduced=True) as page:
        advance(page, 2000)
        assert not visible(page.get_by_role("button", name="Confirm installation")) and page.get_by_text(c["title"]).count() == 0
    assert ama.get(f"/api/install-days/{c['installDay']['id']}").status_code == 404


JOB_CASES = {"mailpit-down": "APP_MAILPIT_DOWN_URL", "gotenberg-down": "APP_GOTENBERG_DOWN_URL", "ntfy-down": "APP_NTFY_DOWN_URL", "svix-down": "APP_SVIX_DOWN_URL"}


@pytest.mark.parametrize("case", list(JOB_CASES), ids=list(JOB_CASES))
def test_jobs_durable_exactly_once(app_url: str, wiremock: WireMock, mail: Mailpit, ntfy: Ntfy, svix: Svix, case: str) -> None:
    api = register(app_url)
    if case == "svix-down":
        api.ok("PUT", "/api/me/crm-endpoint", 200, json={"url": f"https://crm-{uuid.uuid4().hex[:8]}.example/hooks"})
    c = placed(api, wiremock)
    hold_day(api, c)
    down = sign_in(outage_base(JOB_CASES[case]), api.email, api.password)
    s = down.ok("POST", f"/api/commissions/{c['id']}/sign", 201, json={"signatureName": SIGNER, "acceptTerms": True})
    assert pay(down, f"/api/milestones/{s['depositMilestoneId']}/payments").status_code == 201
    seconds = JOB_S + JOB_EFFECT_S
    if case == "mailpit-down":
        assert len(mails(mail, api.email, f"Receipt — {c['title']} — Deposit", seconds=seconds)) == 1
    elif case == "gotenberg-down":
        doc = poll(lambda: next((x for x in api.ok("GET", f"/api/commissions/{c['id']}/documents", 200)["documents"] if x["kind"] == "contract"), {}),
                   lambda x: x.get("status") == "issued", "the queued contract PDF was issued (L898)", seconds)
        assert S3().keys(f"commissions/{c['id']}/documents/contract-") == [f"commissions/{c['id']}/documents/contract-v1.pdf"]
        assert hashlib.sha256(S3().get(f"commissions/{c['id']}/documents/contract-v1.pdf")).hexdigest() == doc["sha256"]
    elif case == "ntfy-down":
        poll(lambda: [m for m in crew_alerts(ntfy, c["title"]) if m.get("title", "").startswith("Slot confirmed")], lambda ms: len(ms) == 1, "one slot alert (L851)", seconds)
    else:
        poll(lambda: [m for m in svix.messages(f"client-{api.me['id']}", "contract.signed") if m["payload"]["commissionId"] == c["id"]], lambda ms: len(ms) == 1, "one contract.signed event (L850)", seconds)


def test_board_updates_live(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock)
    hold_day(api, c)
    s = sign(api, c["id"])
    with app_page(browser, app_url, "/studio", api=prod, reduced=True) as page:
        row = page.get_by_role("table", name="Commissions").get_by_role("row").filter(has_text=c["title"])
        pump(page, lambda: visible(row), "the board listed the commission (L134)")
        url = page.url
        paid = pay(api, f"/api/milestones/{s['depositMilestoneId']}/payments").json()
        expected = f"{api.me['name']} paid {usd(paid['amountCents'])} toward {c['title']}."
        pump(page, lambda: usd(paid["amountCents"]) in text_of(row) and text_of(page.get_by_role("status", name="Board updates")) == expected,
             "the board updated in place within 2 s (L1051)", seconds=BOARD_S)
        assert page.url == url


@pytest.mark.parametrize("service", list(OUTAGES), ids=list(OUTAGES))
def test_outage_banners_and_degraded(browser: Browser, app_url: str, wiremock: WireMock, service: str) -> None:
    env, key, label = OUTAGES[service]
    base = outage_base(env)
    st = poll(lambda: httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT).json()["services"], lambda s: s.get(key) == "down", f"/api/status reported {key} down (L473)", seconds=BANNER_S + STATUS_CACHE_S)
    assert st["postgres"] == "up"
    with app_page(browser, base, "/") as page:
        notices = page.get_by_role("status", name="Service notices")
        pump(page, lambda: visible(notices.get_by_text(BANNERS[label], exact=True)), f"the {label} banner showed verbatim (L426)", seconds=BANNER_S)
    if service == "keycloak":
        r = httpx.get(f"{base}/auth/login", timeout=HTTP_TIMEOUT)
        assert r.status_code == 503 and BANNERS[label] in htmllib.unescape(r.text)
        return
    if service not in ("killbill", "minio", "svix", "render-provider"):
        return
    api = register(app_url)
    down = sign_in(base, api.email, api.password)
    if service == "killbill":
        c = placed(api, wiremock)
        hold_day(api, c)
        r = down.post(f"/api/commissions/{c['id']}/sign", json={"signatureName": SIGNER, "acceptTerms": True})
        assert r.status_code == 503 and _code(r) == "billing_unavailable" and r.json()["error"]["message"] == BANNERS[label]
        assert commission(api, c["id"])["state"] == "held" and api.ok("GET", f"/api/commissions/{c['id']}/documents", 200)["documents"] == []
    elif service == "minio":
        c = new_brief(api)
        r = upload(down, c["id"], "venue_photo", "venue.png", png_bytes())
        assert r.status_code == 503 and _code(r) == "storage_unavailable" and r.json()["error"]["message"] == BANNERS[label]
        assert api.ok("GET", f"/api/commissions/{c['id']}/files", 200)["files"] == []
    elif service == "svix":
        r = down.put("/api/me/crm-endpoint", json={"url": "https://crm.example/hooks"})
        assert r.status_code == 503 and _code(r) == "webhooks_unavailable"
        assert api.ok("GET", "/api/me/crm-endpoint", 200)["url"] is None
    else:
        c = new_brief(api)
        photo = stored(api, c["id"], "venue_photo", "venue.png", png_bytes())
        r = down.post(f"/api/commissions/{c['id']}/renders", json={"venuePhotoFileId": photo["id"]})
        assert r.status_code == 202 and r.json()["state"] == "queued"


def test_wf_studio_ops_producer_board(browser: Browser, app_url: str, wiremock: WireMock, killbill: KillBill, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = placed(api, wiremock)
    name, email = identity("sponsor")
    with app_page(browser, app_url, f"/c/{c['id']}", api=prod, reduced=True) as page:
        click(page.get_by_role("button", name="Add sponsor"))
        pump(page, lambda: visible(page.get_by_role("textbox", name="Sponsor email")), "a sponsor row appeared (L182)")
        fill(page.get_by_role("textbox", name="Sponsor name").last, name)
        fill(page.get_by_role("textbox", name="Sponsor email").last, email)
        fill(page.get_by_role("textbox", name="Share percent").first, "75.00")
        fill(page.get_by_role("textbox", name="Share percent").last, "25.00")
        click(page.get_by_role("button", name="Save funders"))
        pump(page, lambda: "Funders saved. Invites are on their way." in text_of(page.get_by_role("status", name="Notices")), "Notices: funders saved (L404)")
    funder = prod.ok("GET", f"/api/commissions/{c['id']}/funders", 200)["funders"][1]
    assert funder["bp"] == 2500 and funder["email"] == email
    sponsor = register(app_url, "sponsor")
    sponsor.ok("POST", f"/api/invites/{new_token(mail, email, c['title'], [])}/accept", 200)
    with app_page(browser, app_url, "/studio", api=prod, reduced=True) as page:
        board = page.get_by_role("status", name="Board updates")
        pump(page, lambda: visible(page.get_by_role("table", name="Commissions")), "the board loaded (L134)")
        assert pay(sponsor, f"/api/funders/{funder['id']}/payments").status_code == 201
        pump(page, lambda: re.fullmatch(rf".+ paid {re.escape(usd(funder['amountCents']))} toward {re.escape(c['title'])}\.", text_of(board)) is not None, "Board updates announced the sponsor payment (L409)", seconds=BOARD_S + 3)
    assert len(killbill.payments(kb_account(killbill, sponsor)["accountId"])) == 1


def test_wf_studio_ops_jobs_table(browser: Browser, app_url: str, wiremock: WireMock, mail: Mailpit) -> None:
    api, prod = register(app_url), producer(app_url)
    c = contracted(api, wiremock)
    jobs = poll(lambda: prod.ok("GET", "/api/jobs", 200, params={"commissionId": c["id"]})["jobs"],
                lambda js: {"pdf", "email", "crew_alert"} <= {j["kind"] for j in js}
                and all(j["status"] == "done" for j in js if j["kind"] in ("pdf", "email"))
                and any(j["kind"] == "crew_alert" and j["status"] == "done" for j in js),
                "the commission's pdf and email jobs and its slot-confirmed crew alert finished (L640, L838)")
    assert all(j["commissionId"] == c["id"] and j["finishedAt"] for j in jobs if j["status"] == "done")
    mails(mail, api.email, f"Receipt — {c['title']} — Deposit")
    with app_page(browser, app_url, "/studio/jobs", api=prod, reduced=True) as page:
        table = page.get_by_role("table", name="Jobs")
        rows = table.get_by_role("row").filter(has_text=re.compile(rf"{re.escape(c['title'])}|{c['id']}"))
        pump(page, lambda: any("done" in text_of(rows.nth(i)).lower() for i in range(rows.count())),
             "table Jobs listed this commission's done jobs (L135)")


def test_wf_studio_ops_outage_recovery(browser: Browser) -> None:
    target = os.environ.get("NTFY_URL")
    if not target:
        pytest.fail("NTFY_URL is not set; expected the verifier to carry the app environment")
    relay = Relay(target)
    try:
        with app_copy({"NTFY_URL": f"http://127.0.0.1:{relay.port}"}) as base:
            status = lambda: httpx.get(f"{base}/api/status", timeout=HTTP_TIMEOUT).json()["services"]["ntfy"]
            poll(status, lambda s: s == "down", "the copy reported ntfy down at boot (L1044)", seconds=BANNER_S + STATUS_CACHE_S)
            with app_page(browser, base, "/") as page:
                banner = page.get_by_role("status", name="Service notices").get_by_text(BANNERS["ntfy"], exact=True)
                pump(page, lambda: visible(banner), "the ntfy banner showed (L426)", seconds=BANNER_S)
                relay.open()
                pump(page, lambda: banner.count() == 0, "the banner left once ntfy answered (L426)", seconds=BANNER_S + STATUS_CACHE_S)
            assert status() == "up"
    finally:
        relay.close()


def test_landing_scroll_keyframes(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url, "/") as page:
        stage = page.get_by_role("img", name="Venue stage")
        head = page.get_by_role("heading", level=1, name=HEADLINE)
        typed_seen: list[int] = []

        def typed() -> int:
            value = int(head.first.get_attribute("data-typed") or 0) if head.count() else -1
            if value >= 0:
                typed_seen.append(value)
            return value

        pump(page, lambda: typed() >= 0 and visible(stage) and visible(head), "the landing stage and headline showed (L1050)", step_ms=20)
        assert stage.first.get_attribute("data-scene") == "landing" and stage.first.get_attribute("data-motion") == "animated"
        frames = scene_frames(stage.first)
        assert any(f["draws"] for f in frames) and decode(frames[-1]["png"]).variance() > 0
        pump(page, lambda: typed() == len(HEADLINE), "the headline finished typing (L349)")
        assert min(typed_seen) < len(HEADLINE), "the headline appeared whole instead of typing in (L349)"
        vh = page.viewport_size["height"]
        cams: dict[tuple[str, int], list[list[float]]] = {}
        for direction, ks in (("fwd", range(KEYFRAMES)), ("back", range(KEYFRAMES - 2, -1, -1))):
            for k in ks:
                page.evaluate("y => window.scrollTo(0, y)", k * vh)
                pump(page, lambda: stage.first.get_attribute("data-keyframe") == str(k), f"data-keyframe became {k} at {k} viewport heights (L347)")
                settled, last = 0, None
                for _ in range(40):
                    advance(page, 150)
                    now = camera(page)
                    settled = settled + 1 if now == last else 0
                    last = now
                    if settled >= 2:
                        break
                cams[(direction, k)] = last
        assert cams[("fwd", 0)] != cams[("fwd", 2)], "the camera didn't move between keyframes (L347)"
        for a, b in zip(sum(cams[("fwd", 1)], []), sum(cams[("back", 1)], [])):
            assert abs(a - b) < 1e-3, "scrolling back didn't replay the same camera path (L348)"


def test_landing_dialogs_trap_and_hide(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url, "/", reduced=True) as page:
        opener = page.get_by_role("button", name="Tidewall")
        pump(page, lambda: visible(opener), "the Tidewall card showed (L155)")
        click(opener)
        sheet = page.get_by_role("dialog", name="Tidewall")
        pump(page, lambda: visible(sheet), "dialog Tidewall opened (L155)")
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 4:
            page.keyboard.press(key)
            assert sheet.first.evaluate(FOCUSED_JS), "focus left the case-study sheet (L244)"
        page.keyboard.press("Escape")
        pump(page, lambda: (sheet.count() == 0 or not visible(sheet)) and focused(opener), "Escape closed the sheet and returned focus (L244)")
        assert "Close case study" not in tab_order(page, 20)
    with app_page(browser, app_url, "/", size=(375, 812), reduced=True) as page:
        menu = page.get_by_role("button", name="Menu")
        pump(page, lambda: visible(menu), "Menu showed below 768 px (L114)")
        click(menu)
        drawer = page.get_by_role("dialog", name="Navigation")
        pump(page, lambda: visible(drawer.get_by_role("button", name="Close menu")), "dialog Navigation opened (L155)")
        for _ in range(6):
            page.keyboard.press("Tab")
            assert drawer.first.evaluate(FOCUSED_JS)
        page.keyboard.press("Escape")
        pump(page, lambda: focused(menu), "focus returned to Menu (L244)")
        assert drawer.count() == 0 or not visible(drawer)
        assert "Close menu" not in tab_order(page, 20)
        layout(page)


MOTION_CASES = ["reduced-motion", "no-webgl"]


@pytest.mark.parametrize("case", MOTION_CASES, ids=MOTION_CASES)
def test_reduced_motion_and_fallback(browser: Browser, app_url: str, case: str) -> None:
    reduced = case == "reduced-motion"
    with app_page(browser, app_url, "/", reduced=reduced, no_webgl=not reduced) as page:
        stage = page.get_by_role("img", name="Venue stage")
        head = page.get_by_role("heading", level=1, name=HEADLINE)
        pump(page, lambda: visible(stage) and visible(head), "the landing showed its stage and headline (L370)", step_ms=20)
        assert stage.first.get_attribute("data-motion") == ("still" if reduced else "fallback")
        if reduced:
            assert int(head.first.get_attribute("data-typed") or 0) == len(HEADLINE)
            before = decode(capture(stage.first))
            advance(page, 2000)
            assert difference(before, decode(capture(stage.first))) < 0.15, "the stage moved under reduced motion (L364)"
            click(page.get_by_role("button", name="Echo Vault"))
            sheet = page.get_by_role("dialog", name="Echo Vault")
            assert visible(sheet) and not [a for a in animations(sheet.first) if a.get("playState") == "running"], "the sheet animated under reduced motion (L366)"
        for caption in CAPTIONS:
            assert page.get_by_role("heading", level=2, name=caption, exact=True).count() == 1
        page.goto(f"{app_url}/brief/new?step=1")
        wait_question(page, 1)
        chip, ok = page.get_by_role("radio", name="Camera-reactive wall"), ok_button(page)
        if reduced:
            assert visible(chip) and visible(ok), "controls must appear at once under reduced motion (L363)"
        else:
            pump(page, lambda: visible(chip) and visible(ok), "the fallback brief revealed its chips and OK once the question settled (L340, L370)")


def test_wf_landing_phone_journey(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url, "/", size=(375, 812)) as page:
        stage = page.get_by_role("img", name="Venue stage")
        pump(page, lambda: visible(stage), "the landing stage showed (L118)")
        for caption in CAPTIONS:
            assert page.get_by_role("heading", level=2, name=caption, exact=True).count() == 1, f"caption {caption!r} not verbatim (L154)"
        page.evaluate("y => window.scrollTo(0, y)", 2 * 812)
        pump(page, lambda: stage.first.get_attribute("data-keyframe") == "2", "scrolling scrubbed the stage (L347)")
        card = page.get_by_role("button", name="Second Face")
        card.first.scroll_into_view_if_needed()
        tap(card)
        sheet = page.get_by_role("dialog", name="Second Face")
        pump(page, lambda: visible(sheet), "dialog Second Face opened (L256)")
        tap(sheet.get_by_role("button", name="Close case study"))
        pump(page, lambda: sheet.count() == 0 or not visible(sheet), "the case study closed (L244)")
        start = page.get_by_role("link", name="Start a commission")
        start.first.scroll_into_view_if_needed()
        tap(start)
        pump(page, lambda: page.url.endswith("/brief/new?step=1"), "Start a commission opened /brief/new?step=1 (L153)")
        wait_question(page, 1)
    assert httpx.get(f"{app_url}/api/venues", params={"q": "Halsted"}, timeout=HTTP_TIMEOUT).json()["venues"][0]["id"] == "halsted-works"


def test_wf_landing_case_cards(browser: Browser, app_url: str) -> None:
    for (w, h), per_row in (((1280, 800), 3), ((768, 1024), 2), ((375, 812), 1)):
        with app_page(browser, app_url, "/", size=(w, h), reduced=True) as page:
            cards = [page.get_by_role("button", name=n) for n in CASE_STUDIES]
            pump(page, lambda: all(c.count() for c in cards), "the case-study cards rendered (L118)")
            ys = [round(c.first.bounding_box()["y"]) for c in cards]
            assert ys.count(ys[0]) == per_row, f"{w}px: card rows {ys}; expected {per_row} per row (L118)"
            layout(page)


def test_object_level_access(app_url: str, wiremock: WireMock) -> None:
    a, b = register(app_url), register(app_url)
    ca = contracted(a, wiremock)
    cb = new_brief(b)
    cid = ca["id"]
    doc = poll(lambda: a.ok("GET", f"/api/commissions/{cid}/documents", 200)["documents"], bool, "documents listed")[0]["id"]
    dep = milestone(commission(a, cid), "Deposit")["id"]
    probes = [("GET", f"/api/commissions/{cid}", None), ("GET", f"/api/commissions/{cid}/files", None), ("GET", f"/api/commissions/{cid}/ledger", None),
              ("GET", f"/api/commissions/{cid}/documents", None), ("GET", f"/api/commissions/{cid}/webhook-deliveries", None),
              ("GET", f"/api/commissions/{cid}/hold", None), ("GET", f"/api/commissions/{cid}/maintenance", None),
              ("GET", f"/api/files/{ca['photoId']}/content", None), ("GET", f"/api/renders/{ca['renderId']}", None),
              ("GET", f"/api/briefs/{ca['briefId']}", None), ("GET", f"/api/documents/{doc}/pdf", None),
              ("PUT", f"/api/commissions/{cid}/layout", {"version": 1, "items": []}), ("POST", f"/api/commissions/{cid}/hold", {"date": "2027-06-01"}),
              ("POST", f"/api/commissions/{cid}/transitions", {"to": "concept_approved"}), ("POST", f"/api/commissions/{cid}/quote-preview", {"size": "grand", "addOns": []}),
              ("PUT", f"/api/commissions/{cid}/options", {"size": "grand", "addOns": []}), ("POST", f"/api/commissions/{cid}/sign", {"signatureName": SIGNER, "acceptTerms": True}),
              ("POST", f"/api/commissions/{cb['id']}/renders", {"venuePhotoFileId": ca["photoId"]}),
              ("GET", f"/api/commissions/{uuid.uuid4()}", None)]
    for method, path, body in probes:
        r = b.request(method, path, json=body) if body is not None else b.request(method, path)
        assert r.status_code == 404 and _code(r) == "not_found", f"{method} {path} answered {r.status_code}; expected 404 (L859)"
    r = pay(b, f"/api/milestones/{dep}/payments")
    assert r.status_code == 404 and _code(r) == "not_found"
    after = commission(a, cid)
    assert after["state"] == "contracted" and after["layout"]["version"] == ca["layout"]["version"]


def test_platform_boundary(app_url: str) -> None:
    h = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert h.status_code == 200 and h.json() == {"status": "ok"}
    services = httpx.get(f"{app_url}/api/status", timeout=HTTP_TIMEOUT).json()["services"]
    assert set(STATUS_KEYS) <= set(services) and all(services[k] in ("up", "down") for k in STATUS_KEYS)
    api = register(app_url)
    b = new_brief(api, through=5)
    path = f"/api/briefs/{b['briefId']}/steps/6"
    shell = json.dumps({"answer": {"addOns": [], "notes": ""}}).encode()
    at = shell.replace(b'""', b'"' + b"x" * (JSON_LIMIT - len(shell)) + b'"')
    assert len(at) == JSON_LIMIT
    edge = api.put(path, content=at, headers={"Content-Type": "application/json"})
    assert edge.status_code == 422, f"a {JSON_LIMIT}-byte body answered {edge.status_code}; expected it accepted for validation (L644)"
    over = at[:-3] + b'x"}}'
    assert len(over) == JSON_LIMIT + 1
    r = api.put(path, content=over, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and _code(r) == "body_too_large"
    assert httpx.post(f"{app_url}/api/briefs", content=over, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT).status_code == 413
    assert render_callback(app_url, raw=b"{" + b" " * CALLBACK_LIMIT + b"}").status_code == 413
    foreign = "http://elsewhere.example"
    cors = httpx.get(f"{app_url}/api/health", headers={"Origin": foreign}, timeout=HTTP_TIMEOUT)
    assert not any(v.strip() in (foreign, "*") for v in cors.headers.values()), "the app granted a cross-origin request (L1040)"
    assert "run-manifest-v1" not in httpx.get(f"{app_url}/run.json", timeout=HTTP_TIMEOUT).text
    index = httpx.get(f"{app_url}/", timeout=HTTP_TIMEOUT).text
    assets = set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css|mjs))"', index))
    secrets = [v for k in ("AUTH_CLIENT_SECRET", "KILLBILL_API_SECRET", "KILLBILL_PASSWORD", "S3_SECRET_ACCESS_KEY", "SVIX_API_KEY", "NTFY_PASSWORD")
               if len(v := os.environ.get(k, "")) >= 6 and not v.isalpha()]
    for body in [index] + [httpx.get(app_url + a, timeout=HTTP_TIMEOUT).text for a in assets]:
        assert not any(s in body for s in secrets), "a credential was served to the browser (L1042)"
    for a in assets:
        m = httpx.get(f"{app_url}{a}.map", timeout=HTTP_TIMEOUT)
        assert not (m.status_code == 200 and '"mappings"' in m.text), f"source map {a}.map was served (L1042)"


def test_keyboard_hold_and_brief_escape(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    d = pick_day(api, "halsted-works")
    with app_page(browser, app_url, f"/c/{c['id']}/day", api=api, reduced=True) as page:
        grid = page.get_by_role("grid")
        day = grid.get_by_role("button", name=re.compile(rf"^{date_re(d)}, free$"))
        nxt = page.get_by_role("button", name="Next month")
        tab_to(page, nxt, "Tab reached Next month (L174)")
        for _ in range(MONTHS_AHEAD):
            if day.count():
                break
            page.keyboard.press("Enter")
            advance(page, 300)
        arrows = True
        for n in range(TAB_LIMIT):
            if focused(day):
                break
            inside = bool(grid.first.evaluate("g => g.contains(document.activeElement)"))
            if inside and arrows:
                page.evaluate(MARK_FOCUS_JS)
                page.keyboard.press("ArrowRight" if n < TAB_LIMIT // 2 else "ArrowLeft")
                advance(page, 50)
                arrows = not page.evaluate(SAME_FOCUS_JS)
                continue
            page.keyboard.press("Tab")
            advance(page, 50)
        assert focused(day), "the keyboard never reached the day button (L57)"
        page.keyboard.press("Enter")
        tab_to(page, page.get_by_role("button", name=re.compile(rf"^Hold {date_re(d)}$")), "Tab reached Hold <date>")
        page.keyboard.press("Enter")
        poll(lambda: api.get(f"/api/commissions/{c['id']}/hold"), lambda r: r.status_code == 200 and r.json()["status"] == "held", "the keyboard hold was recorded (L238)")
    for signed, target, control in ((api, "/commissions", "radio"), (api, "/commissions", "textbox"), (None, "/", "radio")):
        with app_page(browser, app_url, "/brief/new?step=1", api=signed, reduced=True) as page:
            wait_question(page, 1)
            loc = page.get_by_role("radio", name="Camera-reactive wall") if control == "radio" else page.get_by_role("textbox", name="Name the piece")
            pump(page, lambda: visible(loc), "question 1 controls showed")
            tab_to(page, loc, f"Tab reached the {control}")
            page.keyboard.press("Escape")
            pump(page, lambda: urlparse(page.url).path == target, f"Escape left the brief to {target} (L211)")


VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_viewports(browser: Browser, app_url: str, wiremock: WireMock, viewport: str) -> None:
    api = register(app_url)
    c = placed(api, wiremock)
    routes = ["/", "/brief/new?step=1", "/commissions", f"/c/{c['id']}", f"/c/{c['id']}/files", f"/c/{c['id']}/day",
              f"/c/{c['id']}/configure", f"/c/{c['id']}/checkout", "/settings/crm"]
    with app_page(browser, app_url, "/api/health", api=api, size=VIEWPORTS[viewport], reduced=True) as page:
        for route in routes:
            page.goto(app_url + route)
            pump(page, lambda: visible(page.get_by_role("img", name="Venue stage")), f"{route} rendered its stage (L105)")
            advance(page, 3000)
            layout(page)
            axe(page)
            small = []
            for role in ("button", "link"):
                for loc in page.get_by_role(role).all():
                    box = loc.bounding_box() if loc.is_visible() else None
                    if box and (box["width"] < TARGET_PX - 0.5 or box["height"] < TARGET_PX - 0.5):
                        small.append(f"{role} {loc.inner_text()[:30]!r} {box['width']:.0f}x{box['height']:.0f}")
            assert not small, f"{route} at {viewport}: controls under 44 px: {small} (L97)"


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "Unlicense"}
FONTS = ["Inter Tight", "Inter", "Martian Mono"]


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"} and all(isinstance(v, str) for v in manifest.values())
    assert manifest["_schema"] == "run-manifest-v1"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in notices or (p.version and p.version not in notices)]
    assert not missing, f"notices miss {missing[:20]}"
    assert all(f in notices for f in FONTS)


def test_if_licences_allowed() -> None:
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore() -> None:
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "lokijs", "level"}
    assert not [p.name for p in shipped_packages() if p.name in forbidden]
    data_files = [p for p in Path("/app").rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db") and "node_modules" not in p.parts]
    assert not data_files, f"local data files: {data_files}"
    assert Postgres().tables(), "the app created no tables in Postgres (L5)"


def agent_actions(traj: Path) -> tuple[list[str], list[str]]:
    if not traj.exists():
        return [], []
    try:
        data = json.loads(traj.read_text(errors="ignore"))
    except ValueError:
        return [], []
    commands: list[str] = []
    edited: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            for call in node.get("tool_calls") or []:
                args = call.get("arguments") if isinstance(call, dict) else None
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = None
                if isinstance(args, dict):
                    cmd, path = args.get("command"), args.get("path")
                    if isinstance(path, str) and cmd in ("create", "str_replace", "insert", "write", "overwrite", "edit"):
                        edited.append(path)
                    elif isinstance(cmd, str):
                        commands.append(cmd)
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    walk(data)
    return commands, edited


def test_if_seeded_config_untouched() -> None:
    traj = Path("/logs/agent/trajectory.json")
    commands, edited = agent_actions(traj)
    seeded = r"/(?!app/)[^\s\"'&|;]*(?:compose\.ya?ml|realm[^\s\"'/]*\.json)"
    for path in edited:
        assert not re.fullmatch(seeded, path), f"the agent's editor changed seeded configuration {path} (L1059)"
    for log in commands:
        for pat in (r"kcadm\.sh\s+(?:create|update|delete|set-password|add-roles|remove-roles)\b",
                    rf"(?:sed\s+-i\b[^\n|;&]*\s|>>?(?!&)\s*){seeded}"):
            assert not re.search(pat, log), f"the agent changed seeded service configuration ({log[:120]}) (L1059)"
    assert Keycloak().users(SEEDED["producer"][0])
    S3().keys("commissions/")


def test_if_lockfile_used() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    names = {k.split("node_modules/")[-1] for k in lock.get("packages", {})}
    assert not [p.name for p in shipped_packages() if p.name not in names]
    assert "npm ci" in json.loads(Path("/app/run.json").read_text())["install"]


def test_if_bundled_assets_no_cdn(browser: Browser, app_url: str) -> None:
    seen: list[str] = []
    with app_page(browser, app_url, "/api/health") as page:
        page.on("request", lambda r: seen.append(r.url) if r.url.startswith("http") else None)
        page.goto(f"{app_url}/")
        advance(page, 3000)
        page.goto(f"{app_url}/brief/new?step=1")
        advance(page, 3000)
    foreign = [u for u in seen if not same_origin(u, app_url)]
    assert not foreign, f"assets loaded from other origins: {foreign[:10]} (L1040)"
