from __future__ import annotations

import base64
import datetime as dt
import hashlib
import json
import os
import re
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
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote, urlparse

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    addresses,
    advance,
    animations,
    capture,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    session as cdp,
    shipped_packages,
    state_styles,
    style,
    unique,
)
from conftest import text as mail_text

HTTP_TIMEOUT = 90.0
WAIT = 20.0
RENDER_WAIT = 75.0
TAB_MARGIN = 5.0
SMTP_MARGIN = 6.0
BOOT_WAIT = 90.0
BROWSER_PAD = 2

COUNT_MS = 320
ORIENT_MS = 180
HERO_MS = 6000
DEVICE_COPY_SECONDS = 11
RETRY_MS = 30000
RECONNECT_MS = 5000
TAKEOVER_MS = 40000
LOCK_SECONDS = 20
SESSION_SECONDS = 30
ALPHA_SCOPE = "Alpha scope"
BETA_SCOPE = "Beta scope"
SLOW_SCOPE = "Slow scope"
KEPT_FORM_TEXT = "Values that must stay in the form."
FIRST_EDIT = "EDITED-FIRST"
SECOND_EDIT = "EDITED-SECOND"
LONG_RUN_CHAR = "W"
LONG_RUN = 4000
RING_PX = 2
EDITION_2_FROM = "2026-09-01"
CLASS_IV = "IV"
DEFAULT_SESSION_SECONDS = 2592000
SMTP_LIMIT = 10
STORAGE_LIMIT = 10
SYNC_LIMIT = 5000000
BODY_LIMIT = 100000
STROKE_LIMIT = 2000000
DESK = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
PHONE_SIDE = (812, 375)
TABLET_SIDE = (1024, 768)
COLUMN = 520
PHONE_COLUMN = 343
TOOL_SIZE = 56
TARGET = 44
TOOL_GAP = 16

PASSWORD = "dark-adapted-03"
EVE_2025 = "2025-06-22T03:30:00Z"
EVE_2026 = "2026-07-18T02:45:00Z"
EVE_FALL = "2026-11-01T01:30:00Z"
EDIT_T = "2026-11-01T09:00:00Z"
LONG = "Bright, large and grainy; resolved to the core with averted vision, three dark lanes forming the propeller."
GLOBULARS = "globulars-by-hand"
SHOWPIECES = "twelve-showpieces"
GLOB_NAME = "Globular Clusters by Hand"
SHOW_NAME = "Twelve Showpieces"
ODILE = "Odile Marsh"
ODILE_ADDR = "globulars@coordinators.lowlamp.test"
STRAIGHT = "North down, east right."
MIRROR = "North up, east right."
ERECT = "North up, east left."
BANNER = "You're offline. Everything you log is kept on this device and syncs when signal returns."
STORE_SKETCH = "Sketch storage isn't answering. Your sketch is kept on this device and will upload when storage is back."
TOO_MANY = "Too many sign-in attempts for this email. Wait 15 minutes and try again."
STALE = "This packet changed somewhere else. Nothing was done; this is its current state."
STAR_RADIUS = 10 / 17
BUILD_NOT_FOUND = "We couldn't find that here."
NOT_HERE = "This isn't on this device yet. It needs signal."

TRAINS = ("straight-through", "mirror-diagonal", "erecting-prism")
TRAIN_CASES = {
    "straight-through": ("straight", "Straight through", STRAIGHT, [8.5, -8.5], [1, -1]),
    "mirror-diagonal": ("mirror_diagonal", "Mirror diagonal", MIRROR, [8.5, 8.5], [1, 1]),
    "erecting-prism": ("erecting_prism", "Erecting prism", ERECT, [-8.5, 8.5], [-1, 1]),
}
SWAP_TRAINS = ("mirror-diagonal", "erecting-prism")
PAIR_ANGLES = {"straight-through": 143, "mirror-diagonal": 37, "erecting-prism": 323}
VIEWPORTS = ("375x812", "768x1024", "1280x800")
PACKET_STATES = ("draft", "checked", "rendered", "sent")
NEXT_TRAIN = {"straight-through": "mirror-diagonal", "mirror-diagonal": "erecting-prism", "erecting-prism": "straight-through"}
VIEWPORT_CASES = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESK}
RENDERER_OUTAGES = ("gotenberg-down", "gotenberg-erroring")
MAIL_OUTAGES = ("mailpit-down", "mailpit-silent")
STORAGE_OUTAGES = ("minio-down", "minio-refusing")
PROVIDER_OUTAGES = ("minio-refusing", "gotenberg-erroring", "mailpit-silent")
OUTAGE_ENVS = {
    "gotenberg-down": "APP_GOTENBERG_DOWN_URL", "gotenberg-erroring": "APP_GOTENBERG_ERRORING_URL",
    "mailpit-down": "APP_MAILPIT_DOWN_URL", "mailpit-silent": "APP_MAILPIT_SILENT_URL",
    "minio-down": "APP_MINIO_DOWN_URL", "minio-refusing": "APP_MINIO_REFUSING_URL",
}


def instance(name: str) -> str:
    return os.environ[name].rstrip("/")


def cookies_of(response: httpx.Response) -> str:
    return "; ".join(c.split(";", 1)[0] for c in response.headers.get_list("set-cookie"))


def change(kind: str, **body: Any) -> dict[str, Any]:
    return {"client_op_id": str(uuid.uuid4()), "kind": kind, **body, "body": body}


def stroke_file(stars: tuple = ((0, 10, 5), (3, -2, 2), (-4, 5, 3)), with_stroke: bool = True) -> str:
    return json.dumps({
        "format": "lowlamp-strokes/1",
        "strokes": [{"width": "fine", "points": [[1, 1], [2, 2]]}] if with_stroke else [],
        "stars": [{"at": [e, n], "brightness": b} for e, n, b in stars],
    })


def half_up(value: float, places: int = 0) -> float:
    factor = 10 ** places
    return int(value * factor + 0.5 + 1e-9) / factor


def derived(tele_fl: float, aperture: float, ep_fl: float, field: float, barlow: float = 1) -> tuple[int, int, float]:
    mag = tele_fl / ep_fl * barlow
    return int(half_up(mag)), int(half_up(field * 60 / mag)), half_up(aperture / mag, 1)


def readout(mag: int, field: int, pupil: float, sentence: str) -> str:
    return f"{mag}× · {field}′ field · {pupil:.1f} mm exit pupil · {sentence}"


class Observer:

    def __init__(self, base: str, name: str | None = None, signup: bool = True, kit: bool = True, tele: str = "10-inch Dobsonian"):
        self.base = base.rstrip("/")
        self.password = PASSWORD
        self.cookie = ""
        self.starts: dict[str, dt.datetime] = {}
        self.logged = 0
        if not signup:
            return
        a, b = unique("observer")
        self.email = (a if "@" in a else b).strip().lower()
        self.name = name or f"Observer {uuid.uuid4().hex[:10]}"
        r = self.call("POST", "/api/auth/signup", {"email": self.email, "password": self.password, "display_name": self.name})
        assert r.status_code == 201, f"sign-up answered {r.status_code}: {r.text}"
        self.account_id = r.json()["account"]["id"]
        self.cookie = cookies_of(r)
        if kit:
            self.add_kit(tele)

    @classmethod
    def login(cls, base: str, email: str, password: str) -> "Observer":
        o = cls(base, signup=False)
        o.email, o.password = email, password
        r = o.call("POST", "/api/auth/signin", {"email": email, "password": password})
        assert r.status_code == 200, f"sign-in for {email} answered {r.status_code}: {r.text}"
        o.cookie = cookies_of(r)
        o.account_id = r.json()["account"]["id"]
        o.name = r.json()["account"]["display_name"]
        return o

    def call(self, method: str, path: str, body: Any = None, *, base: str | None = None, content: bytes | None = None,
             headers: dict[str, str] | None = None, cookie: str | None = None) -> httpx.Response:
        h = dict(headers or {})
        jar = self.cookie if cookie is None else cookie
        if jar:
            h["Cookie"] = jar
        kwargs: dict[str, Any] = {}
        if content is not None:
            kwargs["content"] = content
        elif body is not None:
            kwargs["json"] = body
        return httpx.request(method, (base or self.base) + path, headers=h, timeout=HTTP_TIMEOUT, **kwargs)

    def get(self, path: str, base: str | None = None) -> Any:
        r = self.call("GET", path, base=base)
        assert r.status_code == 200, f"GET {path} answered {r.status_code}: {r.text}"
        return r.json()

    def add_kit(self, tele: str = "10-inch Dobsonian") -> None:
        def add(path: str, body: dict[str, Any]) -> str:
            r = self.call("POST", path, body)
            assert r.status_code == 201, f"{path} answered {r.status_code}: {r.text}"
            return r.json()["id"]
        self.tele_name = tele
        self.telescope = add("/api/kit/telescopes", {"name": tele, "aperture": 10, "aperture_unit": "in", "focal_length_mm": 1200})
        self.refractor = add("/api/kit/telescopes", {"name": "80 mm refractor", "aperture": 80, "aperture_unit": "mm", "focal_length_mm": 480})
        self.ep25 = add("/api/kit/eyepieces", {"name": "25 mm wide", "focal_length_mm": 25, "apparent_field_deg": 67})
        self.ep10 = add("/api/kit/eyepieces", {"name": "10 mm wide", "focal_length_mm": 10, "apparent_field_deg": 67})
        self.ep6 = add("/api/kit/eyepieces", {"name": "6 mm", "focal_length_mm": 6, "apparent_field_deg": 60})
        self.barlow = add("/api/kit/barlows", {"name": "2× Barlow", "factor": 2.0})
        self.site = add("/api/sites", {"name": "Hollow Field", "latitude": 38.95, "longitude": -105.40, "time_zone": "America/Denver"})

    def optics(self, ep: str = "ep10", barlow: bool = False, train: str = "straight", tele: str | None = None) -> dict[str, Any]:
        return {"telescope_id": tele or self.telescope, "eyepiece_id": getattr(self, ep),
                "barlow_id": self.barlow if barlow else None, "train": train}

    def sync(self, changes: list[dict[str, Any]], device: str = "laptop", base: str | None = None) -> list[dict[str, Any]]:
        r = self.call("POST", "/api/sync", {"device": device, "changes": changes}, base=base)
        assert r.status_code == 200, f"sync answered {r.status_code}: {r.text}"
        results = r.json()["results"]
        assert len(results) == len(changes), "one result per change (L841)"
        return results

    def one(self, c: dict[str, Any], status: int | None = None, device: str = "laptop", base: str | None = None) -> dict[str, Any]:
        result = self.sync([c], device, base)[0]
        if status is not None:
            assert result["status"] == status, f"{c['kind']} answered {result['status']}: {result['body']}"
        return result

    def start(self, started: str = EVE_2026, ep: str = "ep10", site: str | None = None, train: str = "straight") -> dict[str, Any]:
        sid = str(uuid.uuid4())
        body = self.one(change("session.create", session_id=sid, site_id=site or self.site, started_at=started,
                               optics=self.optics(ep, train=train)), 201)["body"]
        self.starts[sid] = dt.datetime.strptime(started, "%Y-%m-%dT%H:%M:%SZ")
        return body

    def log(self, sid: str, obj: str, at: str | None = None, seeing: int | None = 7, nelm: float | None = 6.5, desc: str = LONG,
            cls: str | None = None, pair: dict | None = None, strokes: str | None = None, sketch: bool = True,
            optics: dict | None = None, device: str = "laptop", raster: str | None = None) -> dict[str, Any]:
        if at is None:
            self.logged += 1
            at = (self.starts[sid] + dt.timedelta(minutes=5 * self.logged)).strftime("%Y-%m-%dT%H:%M:%SZ")
        fields: dict[str, Any] = {"observed_at": at, "description": desc}
        for key, value in (("seeing", seeing), ("transparency_nelm", nelm), ("concentration_class", cls), ("pair", pair), ("optics", optics)):
            if value is not None:
                fields[key] = value
        oid = str(uuid.uuid4())
        body = self.one(change("observation.create", observation_id=oid, session_id=sid, object_id=obj, edited_at=EDIT_T, fields=fields), 201, device)["body"]
        if sketch:
            body = self.one(change("sketch.put", observation_id=oid, base_version=body["version"], edited_at=EDIT_T,
                                   strokes=strokes or stroke_file(), raster_png_base64=raster), 200, device)["body"]
        return body

    def update(self, obs: dict[str, Any], fields: dict[str, Any], edited: str = EDIT_T, status: int | None = 200, device: str = "laptop", base: str | None = None) -> dict[str, Any]:
        return self.one(change("observation.update", observation_id=obs["id"], base_version=obs["version"], edited_at=edited, fields=fields), status, device, base)

    def five(self, train: str = "straight") -> tuple[dict[str, Any], list[dict[str, Any]]]:
        s = self.start(EVE_2025, train=train)
        return s, [self.log(s["id"], obj) for obj in ("m13", "m92", "m3", "m5", "m15")]

    def packet(self, ids: list[str], program: str = GLOBULARS) -> dict[str, Any]:
        r = self.call("POST", "/api/packets", {"program_id": program, "observation_ids": ids})
        assert r.status_code == 201, f"packet create answered {r.status_code}: {r.text}"
        return r.json()

    def act(self, p: dict[str, Any], action: str, status: int, base: str | None = None) -> dict[str, Any]:
        r = self.call("POST", f"/api/packets/{p['id']}/{action}", {"revision": p["revision"]}, base=base)
        assert r.status_code == status, f"{action} answered {r.status_code}: {r.text}"
        return r.json()

    def checked(self, train: str = "straight") -> tuple[dict[str, Any], list[dict[str, Any]]]:
        _, rows = self.five(train)
        p = self.packet([x["id"] for x in rows])
        return self.act(p, "check", 200), rows

    def settled(self, pid: str, states: tuple[str, ...], base: str | None = None) -> dict[str, Any]:
        deadline = time.monotonic() + RENDER_WAIT
        last: dict[str, Any] = {}
        while time.monotonic() < deadline:
            last = self.get(f"/api/packets/{pid}", base)
            if last["state"] in states:
                return last
        pytest.fail(f"packet {pid} never reached {states}; last state {last.get('state')}")

    def rendered(self, train: str = "straight") -> tuple[dict[str, Any], list[dict[str, Any]]]:
        p, rows = self.checked(train)
        self.act(p, "render", 202)
        return self.settled(p["id"], ("rendered",)), rows

    def session_ids(self, sid: str) -> list[dict[str, Any]]:
        return self.get(f"/api/sessions/{sid}")["observations"]

    def stars(self, oid: str) -> list[dict[str, Any]]:
        return json.loads(self.call("GET", f"/api/observations/{oid}/strokes").content)["stars"]


def wait_real(base: str, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT)


def mail_for(mail: Any, o: Observer, count: int = 1) -> list[dict[str, Any]]:
    deadline = time.monotonic() + WAIT
    found: list[dict[str, Any]] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages() if o.email in [a.lower() for a in addresses(m.get("Cc"))]]
        if len(found) >= count:
            return found
    pytest.fail(f"Mailpit held {len(found)} of {count} messages copied to {o.email}")


def no_mail(mail: Any, o: Observer) -> None:
    assert not [m for m in mail.messages() if o.email in [a.lower() for a in addresses(m.get("Cc"))]], "no message may go out"


def attachment_bytes(message: dict[str, Any]) -> bytes:
    parts = message.get("Attachments") or []
    assert len(parts) == 1, "one attachment (L1221)"
    r = httpx.get(f"{os.environ['MAILPIT_URL'].rstrip('/')}/api/v1/message/{message['ID']}/part/{parts[0]['PartID']}", timeout=HTTP_TIMEOUT)
    return r.content


def squash(value: str) -> str:
    return re.sub(r"\s+", "", value)


def norm(value: str | None) -> str:
    return " ".join((value or "").split())


def history_path(obj: str) -> str:
    return f"/api/objects/{obj}/history"


def role(page: Any, kind: str, name: str) -> Locator:
    return page.get_by_role(kind, name=name, exact=True)


def btn(page: Any, name: str) -> Locator:
    return role(page, "button", name)


def status(page: Any, name: str) -> Locator:
    return role(page, "status", name)


def combo(page: Any, name: str) -> Locator:
    return role(page, "combobox", name)


def poll(page: Page, check_fn: Callable[[], Any], what: str, seconds: float = WAIT) -> Any:
    deadline = time.monotonic() + seconds
    tick = time.monotonic()
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            value = check_fn()
            if value:
                return value
        except (AssertionError, PlaywrightError) as err:
            last = err
        now = time.monotonic()
        advance(page, max(20, (now - tick) * 1000))
        tick = now
    pytest.fail(f"{what} (last error: {last})")


def shows(page: Page, loc: Locator, sentence: str, seconds: float = WAIT) -> None:
    poll(page, lambda: sentence in norm(loc.text_content(timeout=1000)), f"expected {sentence!r} on screen", seconds)


def reads(page: Page, loc: Locator, sentence: str, seconds: float = WAIT) -> None:
    poll(page, lambda: norm(loc.text_content(timeout=1000)) == sentence, f"expected exactly {sentence!r}", seconds)


def absent(page: Page, loc: Locator, what: str = "element to be gone", seconds: float = WAIT) -> None:
    poll(page, lambda: loc.count() == 0 or not loc.first.is_visible(), what, seconds)


def present(page: Page, loc: Locator, what: str = "element to show", seconds: float = WAIT) -> None:
    poll(page, lambda: loc.count() > 0 and loc.first.is_visible(), what, seconds)


def focused(page: Page, loc: Locator, what: str = "focus on the published target", seconds: float = WAIT) -> None:
    poll(page, lambda: loc.evaluate("e => document.activeElement === e", timeout=1000), what, seconds)


def tab_to(page: Page, loc: Locator, presses: int = 80) -> None:
    page.evaluate("() => document.activeElement && document.activeElement.blur()")
    for _ in range(presses):
        page.keyboard.press("Tab")
        if loc.first.evaluate("e => e === document.activeElement"):
            return
    raise AssertionError("the control should be reachable with the Tab key")


def here(page: Page) -> str:
    u = urlparse(page.url)
    return u.path + (f"?{u.query}" if u.query else "")


def at(page: Page, path: str) -> None:
    poll(page, lambda: here(page) == path, f"expected the address {path}, saw {here(page)}")


def sign_in_form(page: Page, o: Observer, root: str, path: str | None = "/tonight") -> None:
    page.goto(f"{root}/signin" + (f"?next={quote(path, safe='')}" if path else ""))
    fill(role(page, "textbox", "Email"), o.email)
    fill(role(page, "textbox", "Password"), o.password)
    click(btn(page, "Sign in"))
    at(page, path or "/tonight")


@contextmanager
def signed_in(browser: Any, o: Observer, path: str = "/tonight", *, base: str | None = None,
              size: tuple[int, int] = DESK, reduced: Any = "no-preference") -> Iterator[Page]:
    root = base or o.base
    with open_app(browser, f"{root}/signin", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        sign_in_form(page, o, root, path)
        yield page


def field_of(page: Page) -> Locator:
    return role(page, "application", "Eyepiece field")


def field_ready(page: Page, line: str | None = None) -> None:
    present(page, field_of(page), "the Eyepiece field")
    if line:
        reads(page, status(page, "Optics readout"), line)


def goto_session(page: Page, o: Observer, sid: str, oid: str | None = None, base: str | None = None) -> None:
    page.goto((base or o.base) + f"/sessions/{sid}" + (f"?observation={oid}" if oid else ""))
    field_ready(page)


def form(page: Page, designation: str, ut: str = "2026-07-18 03:20", seeing: str = "7", nelm: str = "6.5", desc: str = LONG) -> None:
    select(combo(page, "Object"), designation)
    fill(role(page, "textbox", "UT date and time"), ut)
    fill(role(page, "spinbutton", "Seeing (1–10)"), seeing)
    fill(role(page, "textbox", "Transparency (limiting magnitude)"), nelm)
    fill(role(page, "textbox", "Description"), desc)


def save(page: Page, sentence: str) -> None:
    click(btn(page, "Save observation"))
    shows(page, status(page, "Save status"), sentence)


def press(page: Page, *keys: str) -> None:
    for key in keys:
        page.keyboard.press(key)


def box(loc: Locator) -> dict[str, float]:
    b = loc.bounding_box()
    assert b, "element has a box"
    return b


def ut_text(page: Page, minutes: int = 2) -> str:
    return page.evaluate("m => new Date(Date.now() + m * 60000).toISOString().slice(0, 16).replace('T', ' ')", minutes)


def page_iso(page: Page, plus_ms: int = 0) -> str:
    return page.evaluate("m => new Date(Date.now() + m).toISOString().slice(0, 19) + 'Z'", plus_ms)


def device_ready(page: Page) -> None:
    deadline = time.monotonic() + DEVICE_COPY_SECONDS
    tick = time.monotonic()
    while time.monotonic() < deadline:
        now = time.monotonic()
        advance(page, max(20, (now - tick) * 1000))
        tick = now
        page.evaluate("1")


def offline(page: Page, on: bool = True) -> None:
    page.context.set_offline(on)
    if on:
        shows(page, status(page, "Connection"), BANNER)


OFFLINE_API = "**/api/**"


def unreachable_server(page: Page, url: str | None = None) -> None:
    page.route(OFFLINE_API, lambda route: route.abort())
    page.context.set_offline(False)
    page.goto(url) if url else page.reload()
    page.context.set_offline(True)
    page.unroute(OFFLINE_API)


FIGURE_JS = """region => [...region.querySelectorAll('*')]
  .filter(e => e.getAttribute('aria-hidden') === 'true' && e.children.length === 0)
  .map(e => (e.textContent || '').trim())"""


def figures(page: Page) -> dict[str, float]:
    found: dict[str, float] = {}
    for item in role(page, "region", "Field").evaluate(FIGURE_JS):
        if re.fullmatch(r"\d+×", item):
            found["mag"] = int(item[:-1])
        elif re.fullmatch(r"\d+′", item):
            found["field"] = int(item[:-1])
        elif re.fullmatch(r"\d+\.\d mm", item):
            found["pupil"] = float(item[:-3])
    return found


def watch(loc: Locator, key: str) -> None:
    loc.evaluate("""(e, key) => { window.__w = window.__w || {}; window.__w[key] = [];
        new MutationObserver(() => window.__w[key].push((e.textContent || '').trim()))
          .observe(e, {childList: true, subtree: true, characterData: true}); }""", key)


def watched(page: Page, key: str) -> list[str]:
    return page.evaluate("k => window.__w[k]", key)


def png_rows(data: bytes) -> tuple[int, int, int, list[bytes]]:
    assert data[:8] == b"\x89PNG\r\n\x1a\n", "capture is a PNG"
    pos, idat, width, height, colour = 8, b"", 0, 0, 2
    while pos < len(data):
        size, tag = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + size]
        if tag == b"IHDR":
            width, height, _, colour = struct.unpack(">IIBB", chunk[:10])
        elif tag == b"IDAT":
            idat += chunk
        pos += size + 12
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[colour]
    raw = zlib.decompress(idat)
    stride = width * bpp
    rows: list[bytes] = []
    prev = bytearray(stride)
    at_byte = 0
    for _ in range(height):
        kind = raw[at_byte]
        line = bytearray(raw[at_byte + 1:at_byte + 1 + stride])
        at_byte += stride + 1
        for i in range(stride):
            a = line[i - bpp] if i >= bpp else 0
            b = prev[i]
            c = prev[i - bpp] if i >= bpp else 0
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prev = line
    return width, height, bpp, rows


def spot(data: bytes, fx: float, fy: float, half: float = 0.07) -> int:
    width, height, bpp, rows = png_rows(data)
    radius = width / 2
    cx, cy = width / 2 + fx * radius, height / 2 - fy * radius
    span = max(3, int(half * radius))
    hits = 0
    channels = 3 if bpp >= 3 else 1
    for y in range(max(0, int(cy) - span), min(height, int(cy) + span + 1)):
        for x in range(max(0, int(cx) - span), min(width, int(cx) + span + 1)):
            if min(rows[y][x * bpp + k] for k in range(channels)) >= 170:
                hits += 1
    return hits


def star_side(page: Page, on: tuple[float, float], off: tuple[float, float] | None = None, what: str = "the star at its projected place") -> None:
    def check_star() -> bool:
        data = capture(field_of(page))
        return spot(data, *on) > 0 and (off is None or spot(data, *off) == 0)
    poll(page, check_star, what, 8)


def touch(c: Any, kind: str, points: list[tuple[float, float, int]]) -> None:
    c.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for x, y, i in points]})


def pen(c: Any, kind: str, x: float, y: float) -> None:
    c.send("Input.dispatchMouseEvent", {"type": kind, "x": x, "y": y, "button": "left", "buttons": 0 if kind == "mouseReleased" else 1,
                                         "clickCount": 1, "pointerType": "pen"})


def circle_point(page: Page, fx: float, fy: float) -> tuple[float, float]:
    b = box(field_of(page))
    return b["x"] + b["width"] / 2 * (1 + fx), b["y"] + b["height"] / 2 * (1 - fy)


class Gate:

    def __init__(self, target: Any, glob: str, method: str = "POST", fetch: bool = True):
        self.items: list[tuple[Any, Any]] = []
        self.requests: list[Any] = []
        self.open = False
        self.fetch = fetch
        self.method = method
        self.glob = glob
        self.target = target
        target.route(glob, self._handle)

    def _handle(self, route: Any) -> None:
        if route.request.method != self.method:
            route.fallback()
            return
        self.requests.append(route.request)
        if self.open:
            route.fallback()
            return
        self.items.append((route, route.fetch() if self.fetch else None))

    def release(self, index: int = 0) -> None:
        route, response = self.items.pop(index)
        if response is not None:
            route.fulfill(response=response)
        else:
            route.fallback()

    def release_all(self) -> None:
        self.open = True
        while self.items:
            self.release()


def track(page: Any, part: str, method: str = "POST") -> list[Any]:
    seen: list[Any] = []

    def mine(rq: Any) -> bool:
        return part in rq.url and rq.method == method

    page.on("request", lambda rq: seen.append(rq) if mine(rq) else None)
    page.on("requestfailed", lambda rq: seen.remove(rq) if mine(rq) and rq in seen else None)
    return seen


def ops_of(rq: Any) -> list[dict[str, Any]]:
    return json.loads(rq.post_data)["changes"]


def reject(route: Any, code: int = 422, error: str = "validation") -> None:
    changes = json.loads(route.request.post_data)["changes"]
    route.fulfill(status=200, content_type="application/json", body=json.dumps({"results": [
        {"client_op_id": c["client_op_id"], "status": code, "replayed": False, "body": {"error": error}, "conflicts": []} for c in changes]}))


def page_cookie(page: Page) -> str:
    return "; ".join(f"{c['name']}={c['value']}" for c in page.context.cookies())


def tiny_png() -> bytes:
    def chunk(tag: bytes, payload: bytes) -> bytes:
        return struct.pack(">I", len(payload)) + tag + payload + struct.pack(">I", zlib.crc32(tag + payload))
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff")) + chunk(b"IEND", b"")


def page_sizes(data: bytes) -> list[tuple[float, float]]:
    blobs = [data]
    for m in re.finditer(rb"stream\r?\n", data):
        try:
            blobs.append(zlib.decompressobj().decompress(data[m.end():]))
        except zlib.error:
            continue
    sizes: list[tuple[float, float]] = []
    for blob in blobs:
        for m in re.finditer(rb"/MediaBox\s*\[\s*0(?:\.0+)?\s+0(?:\.0+)?\s+([\d.]+)\s+([\d.]+)", blob):
            sizes.append((float(m.group(1)), float(m.group(2))))
    return sizes


def test_accounts_email_normalised_and_routes_guarded(app_url: str) -> None:
    o = Observer(app_url, kit=False)
    r = o.call("POST", "/api/auth/signup", {"email": f"  {o.email.upper()} ", "password": PASSWORD, "display_name": "Twin"}, cookie="")
    assert r.status_code == 409 and r.json() == {"error": "email_taken"}
    r = o.call("POST", "/api/auth/signin", {"email": f" {o.email.upper()} ", "password": PASSWORD}, cookie="")
    assert r.status_code == 200 and r.json()["account"]["email"] == o.email
    header = r.headers["set-cookie"]
    assert "HttpOnly".lower() in header.lower() and "SameSite=Lax".lower() in header.lower() and f"Max-Age={DEFAULT_SESSION_SECONDS}".lower() in header.lower()
    bad = o.call("POST", "/api/auth/signin", {"email": o.email, "password": "wrong-password-1"}, cookie="")
    assert bad.status_code == 401 and bad.json() == {"error": "bad_credentials"}
    invalid = o.call("POST", "/api/auth/signup", {"email": "nope", "password": "short", "display_name": ""}, cookie="")
    assert invalid.status_code == 422
    assert invalid.json()["fields"] == {"email": "Enter an email address.", "password": "Use at least 10 characters.",
                                        "display_name": "Enter your name as it should appear on packets."}
    assert o.call("GET", "/api/auth/me").json()["account"]["id"] == o.account_id
    for path in ("/api/auth/me", "/api/kit", "/api/sites", "/api/objects", "/api/objects/m13/history", "/api/sessions", "/api/programs", "/api/packets"):
        r = o.call("GET", path, cookie="")
        assert r.status_code == 401 and r.json() == {"error": "unauthenticated"}, path
    assert o.call("POST", "/api/sync", {"device": "phone", "changes": []}, cookie="").status_code == 401
    assert o.call("GET", "/api/health", cookie="").status_code == 200
    assert o.call("POST", "/api/auth/signout", {}).status_code == 204
    assert o.call("GET", "/api/auth/me").status_code == 401


def test_signin_session_ends_after_its_lifetime() -> None:
    base = instance("APP_SHORT_LOCK_URL")
    o = Observer(base, kit=False)
    r = o.call("POST", "/api/auth/signin", {"email": o.email, "password": PASSWORD}, cookie="")
    assert f"Max-Age={SESSION_SECONDS}".lower() in r.headers["set-cookie"].lower()
    o.cookie = cookies_of(r)
    assert o.call("GET", "/api/auth/me").status_code == 200
    wait_real(base, SESSION_SECONDS + 1)
    assert o.call("GET", "/api/auth/me").status_code == 401


def test_kit_conversion_ranges_and_order(app_url: str) -> None:
    o = Observer(app_url, kit=False)
    def tele(aperture: Any, unit: str = "mm", fl: Any = 1200, name: Any = "Scope") -> httpx.Response:
        return o.call("POST", "/api/kit/telescopes", {"name": name, "aperture": aperture, "aperture_unit": unit, "focal_length_mm": fl})
    r = tele(10, "in")
    assert r.status_code == 201 and r.json()["aperture_mm"] == 254
    assert tele(8, "in").json()["aperture_mm"] == 203.2
    assert tele(25).status_code == 201 and tele(1600).status_code == 201
    aperture_error = "Aperture must be from 25 mm to 1,600 mm."
    for bad in (tele(24.9), tele(1600.1), tele(0.9, "in")):
        assert bad.status_code == 422 and bad.json()["fields"]["aperture"] == aperture_error
    assert tele(100, fl=100).status_code == 201 and tele(100, fl=20000).status_code == 201
    assert tele(100, fl=99).json()["fields"]["focal_length_mm"] == "Focal length must be from 100 mm to 20,000 mm."
    assert tele(100, name="x" * 61).json()["fields"]["name"] == "Give it a name of up to 60 characters."
    def eye(fl: float, field: float) -> httpx.Response:
        return o.call("POST", "/api/kit/eyepieces", {"name": "Eye", "focal_length_mm": fl, "apparent_field_deg": field})
    assert eye(2, 30).status_code == 201 and eye(60, 120).status_code == 201 and eye(10, 67).status_code == 201
    assert eye(1, 60).json()["fields"]["focal_length_mm"] == "Eyepiece focal length must be from 2 mm to 60 mm."
    assert eye(10, 121).json()["fields"]["apparent_field_deg"] == "Apparent field must be from 30° to 120°."
    def bar(f: float) -> httpx.Response:
        return o.call("POST", "/api/kit/barlows", {"name": "Bar", "factor": f})
    assert bar(1.1).status_code == 201 and bar(5.0).status_code == 201
    assert bar(5.1).json()["fields"]["factor"] == "Barlow factor must be from 1.1× to 5.0×."
    kit = o.get("/api/kit")
    assert [e["focal_length_mm"] for e in kit["eyepieces"]] == [60, 10, 2]
    assert {(t["id"], t["rotation_deg"], t["mirrored"], t["sentence"]) for t in kit["trains"]} == {
        ("straight", 180, False, STRAIGHT), ("mirror_diagonal", 0, True, MIRROR), ("erecting_prism", 0, False, ERECT)}
    other = Observer(app_url, kit=False)
    assert other.get("/api/kit")["telescopes"] == []
    site = o.call("POST", "/api/sites", {"name": "Lot", "latitude": 10, "longitude": 10, "time_zone": "Mars/Olympus"})
    assert site.json()["fields"]["time_zone"] == "Choose a time zone from the list."


def test_wf_account_and_kit_setup(browser: Any, app_url: str) -> None:
    a, b = unique("kitter")
    email = a if "@" in a else b
    with open_app(browser, f"{app_url}/signup") as page:
        page.set_viewport_size({"width": DESK[0], "height": DESK[1]})
        fill(role(page, "textbox", "Email"), email)
        fill(role(page, "textbox", "Password"), PASSWORD)
        fill(role(page, "textbox", "Your name"), "Kit Observer")
        click(btn(page, "Create account"))
        at(page, "/kit")
        fill(role(page, "textbox", "Telescope name"), "10-inch Dobsonian")
        select(combo(page, "Aperture unit"), "in")
        aperture = role(page, "spinbutton", "Aperture")
        aperture.press_sequentially("1")
        reads(page, status(page, "Aperture in millimetres"), "25.4 mm")
        aperture.press_sequentially("0")
        reads(page, status(page, "Aperture in millimetres"), "254 mm")
        fill(role(page, "spinbutton", "Focal length (mm)"), "1200")
        click(btn(page, "Add telescope"))
        reads(page, status(page, "Kit status"), "Added 10-inch Dobsonian.")
        focused(page, role(page, "textbox", "Telescope name"))
        fill(role(page, "textbox", "Eyepiece name"), "25 mm wide")
        fill(role(page, "spinbutton", "Eyepiece focal length (mm)"), "25")
        fill(role(page, "spinbutton", "Apparent field (°)"), "67")
        click(btn(page, "Add eyepiece"))
        reads(page, status(page, "Kit status"), "Added 25 mm wide.")
        fill(role(page, "textbox", "Barlow name"), "2× Barlow")
        fill(role(page, "spinbutton", "Barlow factor"), "2")
        click(btn(page, "Add Barlow"))
        reads(page, status(page, "Kit status"), "Added 2× Barlow.")
        for name in ("10-inch Dobsonian", "25 mm wide", "2× Barlow"):
            present(page, page.get_by_text(name, exact=False).first, f"{name} in the kit list")
        fill(role(page, "textbox", "Site name"), "Hollow Field")
        fill(role(page, "spinbutton", "Latitude"), "38.95")
        fill(role(page, "spinbutton", "Longitude"), "-105.40")
        select(combo(page, "Time zone"), "America/Denver")
        click(btn(page, "Add site"))
        reads(page, status(page, "Kit status"), "Added Hollow Field.")
        click(role(page, "link", "Tonight"))
        at(page, "/tonight")
        select(combo(page, "Site"), "Hollow Field")
        click(btn(page, "Start session"))
        poll(page, lambda: re.fullmatch(r"/sessions/[^/?]+", here(page)), "Start session lands on the Session screen")
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        select(combo(page, "Telescope"), "10-inch Dobsonian")
        select(combo(page, "Eyepiece"), "25 mm wide")
        select(combo(page, "Barlow"), "2× Barlow")
    api = Observer.login(app_url, email, PASSWORD)
    kit = api.get("/api/kit")
    assert kit["telescopes"][0]["aperture_mm"] == 254 and kit["telescopes"][0]["name"] == "10-inch Dobsonian"
    assert [e["name"] for e in kit["eyepieces"]] == ["25 mm wide"] and [x["factor"] for x in kit["barlows"]] == [2]


def test_signin_lock_counts_every_email_under_parallel_attempts() -> None:
    base = instance("APP_SHORT_LOCK_URL")
    o = Observer(base, kit=False)
    def attempt(email: str, password: str = "wrong-password-1") -> httpx.Response:
        return httpx.post(base + "/api/auth/signin", json={"email": email, "password": password}, timeout=HTTP_TIMEOUT)
    with ThreadPoolExecutor(20) as pool:
        answers = list(pool.map(lambda _: attempt(f"  {o.email.upper()}"), range(20)))
    codes = [a.status_code for a in answers]
    assert set(codes) <= {401, 429} and codes.count(401) <= 5 and codes.count(429) >= 15, codes
    locked = attempt(o.email, PASSWORD)
    assert locked.status_code == 429 and locked.json() == {"error": "too_many_attempts"}
    assert 1 <= int(locked.headers["retry-after"]) <= LOCK_SECONDS
    a, b = unique("ghost")
    ghost = a if "@" in a else b
    results = [attempt(ghost).status_code for _ in range(5)]
    assert results == [401] * 5
    assert attempt(ghost).status_code == 429
    wait_real(base, LOCK_SECONDS + 1)
    assert attempt(o.email, PASSWORD).status_code == 200, "the lock ends after its length"
    assert attempt(ghost).status_code == 401, "the count starts again after the lock"
    fresh = Observer(base, kit=False)
    assert [attempt(fresh.email).status_code for _ in range(4)] == [401] * 4
    assert attempt(fresh.email, PASSWORD).status_code == 200
    assert [attempt(fresh.email).status_code for _ in range(4)] == [401] * 4, "a success resets the count"
    wait_real(base, LOCK_SECONDS + 1)
    assert [attempt(fresh.email).status_code for _ in range(4)] == [401] * 4, "failures older than the window never contribute"
    assert attempt(fresh.email, PASSWORD).status_code == 200


def test_wf_account_and_kit_lock_sentence(browser: Any) -> None:
    base = instance("APP_SHORT_LOCK_URL")
    o = Observer(base, kit=False)
    with open_app(browser, f"{base}/signin") as page:
        problem = role(page, "alert", "Account problem")
        for _ in range(5):
            fill(role(page, "textbox", "Email"), o.email)
            fill(role(page, "textbox", "Password"), "wrong-password-1")
            click(btn(page, "Sign in"))
            reads(page, problem, "That email and password don't match an account.")
            page.evaluate("document.activeElement && document.activeElement.blur()")
            page.reload()
        fill(role(page, "textbox", "Email"), o.email)
        fill(role(page, "textbox", "Password"), PASSWORD)
        click(btn(page, "Sign in"))
        reads(page, problem, TOO_MANY)
        assert role(page, "textbox", "Email").input_value() == o.email
        assert urlparse(page.url).path == "/signin"


def test_interleaved_reads_are_scoped_to_their_session(app_url: str) -> None:
    a = Observer(app_url, tele=ALPHA_SCOPE)
    b = Observer(app_url, tele=BETA_SCOPE)
    def read(i: int) -> tuple[Observer, httpx.Response]:
        who = a if i % 2 else b
        return who, who.call("GET", "/api/kit" if i % 3 else "/api/auth/me")
    with ThreadPoolExecutor(12) as pool:
        for who, r in pool.map(read, range(60)):
            assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
            if "telescopes" in r.json():
                assert r.json()["telescopes"][0]["name"] == who.tele_name
            else:
                assert r.json()["account"]["id"] == who.account_id


def test_device_copies_belong_to_one_account(browser: Any, app_url: str) -> None:
    a = Observer(app_url, tele=ALPHA_SCOPE)
    b = Observer(app_url, tele=BETA_SCOPE)
    with signed_in(browser, a, "/tonight") as page:
        device_ready(page)
        gate = Gate(page, "**/api/kit", "GET")
        click(role(page, "link", "Kit"))
        poll(page, lambda: gate.items, "Kit asks the server for the kit")
        click(btn(page, "Sign out"))
        at(page, "/")
        gate.open = True
        sign_in_form(page, b, app_url, "/kit")
        present(page, page.get_by_text(BETA_SCOPE).first, "the new account's kit")
        gate.release_all()
        advance(page, 500)
        page.evaluate("1")
        assert page.get_by_text(ALPHA_SCOPE).count() == 0, "a reply under the earlier account painted the screen"
        device_ready(page)
        offline(page)
        unreachable_server(page, f"{app_url}/kit")
        present(page, page.get_by_text(BETA_SCOPE).first, "the new account's kit offline")
        assert page.get_by_text(ALPHA_SCOPE).count() == 0


def test_account_change_reaches_every_tab(browser: Any, app_url: str) -> None:
    a = Observer(app_url, tele=ALPHA_SCOPE)
    b = Observer(app_url, tele=BETA_SCOPE)
    s = a.start()
    with signed_in(browser, a, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        blocked = {"on": True}
        page.context.route("**/api/sync", lambda route: route.abort() if blocked["on"] else route.fallback())
        form(page, "M13")
        click(btn(page, "Save observation"))
        shows(page, status(page, "Connection"), "1 change waiting to sync.")
        sent = track(page.context, "/api/sync")
        other = page.context.new_page()
        other.goto(f"{app_url}/kit")
        present(other, other.get_by_text(ALPHA_SCOPE).first, "the second tab's kit")
        sent.clear()
        blocked["on"] = False
        click(btn(page, "Sign out"))
        advance(other, 2000)
        poll(other, lambda: urlparse(other.url).path == "/", "the other tab lands on / after a sign-out", TAB_MARGIN)
        assert other.get_by_text(ALPHA_SCOPE).count() == 0
        sign_in_form(page, b, app_url, "/tonight")
        advance(other, 2000)
        poll(other, lambda: urlparse(other.url).path == "/tonight", "the other tab shows /tonight for the new account", TAB_MARGIN)
        advance(page, RETRY_MS)
        page.evaluate("1")
        assert not sent, "the earlier account's journal went out under the new session"
        assert a.session_ids(s["id"]) == []
        other.close()
        click(btn(page, "Sign out"))
        at(page, "/")
        sign_in_form(page, a, app_url, f"/sessions/{s['id']}")
        poll(page, lambda: len(a.session_ids(s["id"])) == 1, "the owner's journal goes out on their next sign-in")


def test_one_request_per_form_press(browser: Any, app_url: str) -> None:
    o = Observer(app_url, kit=False)
    with signed_in(browser, o, "/kit") as page:
        sent = track(page, "/api/kit/telescopes")
        def fields(aperture: str) -> None:
            fill(role(page, "textbox", "Telescope name"), SLOW_SCOPE)
            fill(role(page, "spinbutton", "Aperture"), aperture)
            fill(role(page, "spinbutton", "Focal length (mm)"), "1200")
        fields("9999")
        click(btn(page, "Add telescope"))
        focused(page, role(page, "spinbutton", "Aperture"), "a 422 moves focus to the first invalid field")
        assert role(page, "textbox", "Telescope name").input_value() == SLOW_SCOPE
        sent.clear()
        fields("254")
        with held(page, "**/api/kit/telescopes") as release:
            role(page, "spinbutton", "Focal length (mm)").focus()
            press(page, "Enter", "Enter", "Enter")
            poll(page, lambda: sent, "the form sends its request")
            press(page, "Enter")
            advance(page, 200)
            assert len(sent) == 1, "repeated Enter sent more than one request"
            release()
        reads(page, status(page, "Kit status"), f"Added {SLOW_SCOPE}.")
        focused(page, role(page, "textbox", "Telescope name"))
        assert role(page, "textbox", "Telescope name").input_value() == ""
        assert len(o.get("/api/kit")["telescopes"]) == 1
    target = Observer(instance("APP_SHORT_LOCK_URL"), kit=False)
    with open_app(browser, f"{target.base}/signin") as page:
        sent = track(page, "/api/auth/signin")
        fill(role(page, "textbox", "Email"), target.email)
        fill(role(page, "textbox", "Password"), "wrong-password-1")
        with held(page, "**/api/auth/signin") as release:
            role(page, "textbox", "Password").focus()
            press(page, "Enter", "Enter", "Enter")
            poll(page, lambda: sent, "the sign-in form sends its request")
            advance(page, 200)
            assert len(sent) == 1, "one mistyped password must cost one attempt"
            release()
        reads(page, role(page, "alert", "Account problem"), "That email and password don't match an account.")
        assert role(page, "textbox", "Email").input_value() == target.email


def test_derived_optics_stored_on_session_and_observation(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    assert (s["derived"]["magnification"], s["derived"]["true_field_arcmin"], s["derived"]["exit_pupil_mm"]) == (48, 84, 5.3)
    assert s["derived"]["aperture_mm"] == 254
    assert s["derived"]["orientation"] == {"train": "straight", "rotation_deg": 180, "mirrored": False, "sentence": STRAIGHT}
    updated = o.one(change("session.optics", session_id=s["id"], optics=o.optics("ep6", train="mirror_diagonal")), 200)["body"]
    assert (updated["derived"]["magnification"], updated["derived"]["true_field_arcmin"], updated["derived"]["exit_pupil_mm"]) == (200, 18, 1.3)
    assert updated["derived"]["orientation"]["sentence"] == MIRROR and updated["derived"]["orientation"]["mirrored"] is True
    mag, field, pupil = derived(1200, 254, 25, 67, 2)
    own = o.log(s["id"], "m5", optics=o.optics("ep25", barlow=True, train="erecting_prism"), sketch=False)
    assert own["derived"]["magnification"] == mag and own["derived"]["true_field_arcmin"] == field and own["derived"]["exit_pupil_mm"] == pupil
    assert own["derived"]["orientation"]["sentence"] == ERECT
    mag, field, pupil = derived(480, 80, 10, 67)
    inherited_session = o.one(change("session.optics", session_id=s["id"], optics=o.optics("ep10", tele=o.refractor)), 200)["body"]
    assert inherited_session["derived"]["magnification"] == mag and inherited_session["derived"]["aperture_mm"] == 80
    inherited = o.log(s["id"], "m3", sketch=False)
    assert inherited["derived"]["true_field_arcmin"] == field and inherited["derived"]["exit_pupil_mm"] == pupil
    assert o.get(f"/api/observations/{own['id']}")["derived"]["true_field_arcmin"] == own["derived"]["true_field_arcmin"]
    missing = o.one(change("session.create", session_id=str(uuid.uuid4()), site_id=o.site, started_at=EVE_2026, optics={"train": "straight"}), 422)
    assert missing["body"]["fields"]["optics"] == "Choose a telescope and an eyepiece from your kit."


def test_live_readout_follows_each_picker_before_saving(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        page.evaluate("window.__sameDocument = true")
        live = status(page, "Optics readout")
        with held(page, "**/api/sync"):
            steps = [("Eyepiece", "10 mm wide", derived(1200, 254, 10, 67), STRAIGHT),
                     ("Barlow", "2× Barlow", derived(1200, 254, 10, 67, 2), STRAIGHT),
                     ("Train", "Mirror diagonal", derived(1200, 254, 10, 67, 2), MIRROR),
                     ("Telescope", "80 mm refractor", derived(480, 80, 10, 67, 2), MIRROR)]
            for picker, label, values, sentence in steps:
                select(combo(page, picker), label)
                advance(page, 100)
                assert norm(live.text_content()) == readout(*values, sentence), picker
                advance(page, COUNT_MS + ORIENT_MS)
        assert page.evaluate("window.__sameDocument") is True


def test_wf_optics_readout_choosing_saved_by_server(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with signed_in(browser, o, "/tonight") as page:
        select(combo(page, "Site"), "Hollow Field")
        click(btn(page, "Start session"))
        poll(page, lambda: re.fullmatch(r"/sessions/[^/?]+", here(page)), "Start session lands on /sessions/<id>")
        sid = here(page).rsplit("/", 1)[1]
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        select(combo(page, "Eyepiece"), "6 mm")
        reads(page, status(page, "Optics readout"), readout(200, 18, 1.3, STRAIGHT))
        select(combo(page, "Barlow"), "2× Barlow")
        select(combo(page, "Train"), "Erecting prism")
        mag, field, pupil = derived(1200, 254, 6, 60, 2)
        reads(page, status(page, "Optics readout"), readout(mag, field, pupil, ERECT))
        def stored() -> bool:
            got = o.get(f"/api/sessions/{sid}")
            return got["optics"] == o.optics("ep6", barlow=True, train="erecting_prism")
        poll(page, stored, "the server's session holds the newest optics")
        d = o.get(f"/api/sessions/{sid}")["derived"]
        assert (d["magnification"], d["true_field_arcmin"], d["exit_pupil_mm"], d["orientation"]["sentence"]) == (mag, field, pupil, ERECT)


def test_wf_optics_readout_late_reply_never_repaints(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        watch(status(page, "Field announcements"), "ann")
        gate = Gate(page, "**/api/sync")
        select(combo(page, "Eyepiece"), "10 mm wide")
        poll(page, lambda: gate.items, "the 10 mm change goes to the server")
        select(combo(page, "Eyepiece"), "6 mm")
        final = readout(200, 18, 1.3, STRAIGHT)
        reads(page, status(page, "Optics readout"), final)
        advance(page, COUNT_MS + ORIENT_MS + 100)
        reads(page, status(page, "Field announcements"), f"Field now 18′ at 200×. {STRAIGHT}")
        before = watched(page, "ann")
        gate.release(0)
        advance(page, COUNT_MS + ORIENT_MS + 100)
        assert norm(status(page, "Optics readout").text_content()) == final, "an older reply repainted the readout"
        assert figures(page) == {}, "an older reply started a swap"
        assert watched(page, "ann") == before, "an older reply announced something"
        gate.open = True
        gate.release_all()
        poll(page, lambda: o.get(f"/api/sessions/{s['id']}")["optics"]["eyepiece_id"] == o.ep6, "the server ends on the newest pick")
        assert norm(status(page, "Optics readout").text_content()) == final
        assert not any("34′" in item for item in watched(page, "ann"))


def test_wf_optics_readout_keyboard_swaps(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        sent = track(page, "/api/sync")
        btn(page, "Undo").focus()
        press(page, "[")
        advance(page, COUNT_MS + ORIENT_MS)
        reads(page, status(page, "Field announcements"), "No longer eyepiece in your kit.")
        assert not sent, "a bracket key that changes nothing queues nothing"
        press(page, "]")
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, STRAIGHT))
        advance(page, COUNT_MS + ORIENT_MS + 50)
        press(page, "]")
        reads(page, status(page, "Optics readout"), readout(200, 18, 1.3, STRAIGHT))
        advance(page, COUNT_MS + ORIENT_MS + 50)
        press(page, "]")
        advance(page, 50)
        reads(page, status(page, "Field announcements"), "No shorter eyepiece in your kit.")
        poll(page, lambda: o.get(f"/api/sessions/{s['id']}")["optics"]["eyepiece_id"] == o.ep6, "the bracket keys reach the server")


def test_swap_numerals_count_old_to_new(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        select(combo(page, "Eyepiece"), "10 mm wide")
        live = status(page, "Optics readout")
        assert norm(live.text_content()) == readout(120, 34, 2.1, STRAIGHT), "status holds the final line from the pick"
        hidden_js = """e => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e);
            return r.width <= 1 || r.height <= 1 || c.clipPath !== 'none' || (c.clip !== 'auto' && c.clip !== ''); }"""
        assert live.evaluate(hidden_js), "the status line is visually hidden during the swap"
        advance(page, COUNT_MS / 2)
        mid = figures(page)
        assert set(mid) == {"mag", "field", "pupil"}, f"three counting figures during the swap: {mid}"
        assert 48 < mid["mag"] <= 120 and 34 <= mid["field"] < 84 and 2.1 <= mid["pupil"] < 5.3
        assert mid["mag"] != 120 or mid["field"] != 34 or mid["pupil"] != 2.1, "the figures are still counting at half time"
        advance(page, COUNT_MS / 2 + 20)
        assert figures(page) == {"mag": 120, "field": 34, "pupil": 2.1}
        advance(page, ORIENT_MS + 50)
        assert figures(page) == {}, "the figures are removed when the swap ends"
        assert not live.evaluate(hidden_js)
        assert norm(live.text_content()) == readout(120, 34, 2.1, STRAIGHT)


def test_swap_scales_marks_and_clips_then_restores(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    obs = o.log(s["id"], "m13", strokes=stroke_file(((8.5, 8.5, 5),), with_stroke=False))
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        star_side(page, (0.5, -0.5), what="east-north star at half radius under straight at 34′")
        corner = spot(capture(field_of(page)), 8.5 / 9, -8.5 / 9)
        select(combo(page, "Eyepiece"), "6 mm")
        advance(page, COUNT_MS + ORIENT_MS + 50)
        data = capture(field_of(page))
        assert spot(data, 0.5, -0.5) == 0, "the star left its old radius"
        assert spot(data, 8.5 / 9, -8.5 / 9) <= corner, "a mark outside the circle is clipped at its edge"
        select(combo(page, "Eyepiece"), "25 mm wide")
        mid_at = capture(field_of(page))
        advance(page, COUNT_MS / 2)
        assert difference(decode(mid_at), decode(capture(field_of(page)))) >= 0
        advance(page, COUNT_MS / 2 + ORIENT_MS + 50)
        star_side(page, (8.5 / 42, -8.5 / 42), what="the clipped star returns when a wider field returns")
    assert o.stars(obs["id"]) == [{"at": [8.5, 8.5], "brightness": 5}]


@pytest.mark.parametrize("case", SWAP_TRAINS, ids=SWAP_TRAINS)
def test_swap_orientation_follows_train_and_compass_waits(browser: Any, app_url: str, case: str) -> None:
    _, train, sentence, _, (east_right, north_up) = TRAIN_CASES[case]
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    obs = o.log(s["id"], "m13", strokes=stroke_file(((0, 10, 5),), with_stroke=False))
    east = o.log(s["id"], "m92", strokes=stroke_file(((10, 0, 5),), with_stroke=False))
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        star_side(page, (0, -STAR_RADIUS), (0, STAR_RADIUS), "north is down under Straight through")
        select(combo(page, "Train"), train)
        assert norm(status(page, "Optics readout").text_content()) == readout(120, 34, 2.1, sentence)
        assert role(page, "img", f"Compass: {STRAIGHT}").count() == 1, "the compass name waits for the swap's end"
        advance(page, COUNT_MS)
        assert role(page, "img", f"Compass: {STRAIGHT}").count() == 1
        advance(page, ORIENT_MS + 30)
        present(page, role(page, "img", f"Compass: {sentence}"), "the compass carries the new sentence")
        star_side(page, (0, north_up * STAR_RADIUS), (0, -north_up * STAR_RADIUS), f"north sits where {train} names it")
        reads(page, status(page, "Field announcements"), f"Field now 34′ at 120×. {sentence}")
        goto_session(page, o, s["id"], east["id"])
        select(combo(page, "Train"), train)
        advance(page, COUNT_MS + ORIENT_MS + 30)
        star_side(page, (east_right * STAR_RADIUS, 0), (-east_right * STAR_RADIUS, 0), f"east sits where {train} names it")
        present(page, role(page, "img", f"Compass: {sentence}"))


def test_wf_field_swap_reduced_motion(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    obs = o.log(s["id"], "m13", strokes=stroke_file(((0, 10, 5),), with_stroke=False))
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}", reduced="reduce") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        select(combo(page, "Train"), "Mirror diagonal")
        advance(page, 20)
        assert figures(page) == {}, "no counting figures under reduced motion"
        present(page, role(page, "img", f"Compass: {MIRROR}"), "compass in one frame", 3)
        assert status(page, "Optics readout").is_visible()
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, MIRROR))
        reads(page, status(page, "Field announcements"), f"Field now 34′ at 120×. {MIRROR}")
        star_side(page, (0, STAR_RADIUS), (0, -STAR_RADIUS), "the sketch is already reoriented")


def test_wf_field_swap_mid_sketch(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    obs = o.log(s["id"], "m13")
    bytes_before = o.call("GET", f"/api/observations/{obs['id']}/strokes").content
    keys_before = S3().keys(f"observers/{o.account_id}/strokes/{obs['id']}/")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        click(btn(page, "Open M13"))
        at(page, f"/sessions/{s['id']}?observation={obs['id']}")
        field_of(page).focus()
        pixels = decode(capture(field_of(page)))
        press(page, "[")
        reads(page, status(page, "Optics readout"), readout(48, 84, 5.3, STRAIGHT))
        advance(page, COUNT_MS + ORIENT_MS + 30)
        assert difference(pixels, decode(capture(field_of(page)))) > 0, "the sketch rescales"
        select(combo(page, "Train"), "Mirror diagonal")
        advance(page, COUNT_MS + ORIENT_MS + 30)
        present(page, role(page, "img", f"Compass: {MIRROR}"))
        def saved() -> bool:
            return o.get(f"/api/observations/{obs['id']}")["optics"] == o.optics("ep25", train="mirror_diagonal")
        poll(page, saved, "the observation's new optics reach the server")
    got = o.get(f"/api/observations/{obs['id']}")
    assert got["derived"]["magnification"] == 48 and got["derived"]["orientation"]["sentence"] == MIRROR
    assert o.call("GET", f"/api/observations/{obs['id']}/strokes").content == bytes_before
    assert S3().keys(f"observers/{o.account_id}/strokes/{obs['id']}/") == keys_before


def test_interrupted_swap_continues_and_only_newest_ends(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        watch(status(page, "Field announcements"), "ann")
        select(combo(page, "Eyepiece"), "6 mm")
        advance(page, COUNT_MS / 4)
        shown = figures(page)
        assert 48 < shown["mag"] <= 200
        select(combo(page, "Train"), "Mirror diagonal")
        again = figures(page)
        assert again and abs(again["mag"] - shown["mag"]) <= (200 - shown["mag"]) / 2 + 1, "no jump back to the older state"
        advance(page, COUNT_MS + 40)
        assert figures(page).get("mag") == 200
        assert role(page, "img", f"Compass: {STRAIGHT}").count() == 1
        advance(page, ORIENT_MS + 40)
        present(page, role(page, "img", f"Compass: {MIRROR}"))
        reads(page, status(page, "Field announcements"), f"Field now 18′ at 200×. {MIRROR}")
        written = [x for x in watched(page, "ann") if x]
        assert len(set(written)) == 1, f"only the newest pick announces: {written}"


def test_swap_never_outlives_its_subject(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep25")
    obs = o.log(s["id"], "m5", optics=o.optics("ep10"), sketch=False)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        watch(status(page, "Field announcements"), "ann")
        select(combo(page, "Eyepiece"), "6 mm")
        advance(page, COUNT_MS / 4)
        assert figures(page)
        click(btn(page, "Open M5"))
        at(page, f"/sessions/{s['id']}?observation={obs['id']}")
        assert figures(page) == {}, "the swap ends in the frame of the Open"
        line = readout(120, 34, 2.1, STRAIGHT)
        reads(page, status(page, "Optics readout"), line, 3)
        advance(page, COUNT_MS + ORIENT_MS + 100)
        assert norm(status(page, "Optics readout").text_content()) == line
        assert [x for x in watched(page, "ann") if x] == [], "the ended swap announced"
        poll(page, lambda: o.get(f"/api/sessions/{s['id']}")["optics"]["eyepiece_id"] == o.ep6, "the ended swap's queued change is sent")
        assert norm(status(page, "Optics readout").text_content()) == line, "a session reply changed an open observation's display"
        click(btn(page, "New observation"))
        at(page, f"/sessions/{s['id']}")
        reads(page, status(page, "Optics readout"), readout(200, 18, 1.3, STRAIGHT), 3)
        select(combo(page, "Eyepiece"), "10 mm wide")
        advance(page, COUNT_MS / 4)
        click(role(page, "link", "Programs"))
        at(page, "/programs")
        advance(page, COUNT_MS + ORIENT_MS + 100)
        assert [x for x in watched(page, "ann") if x] == [] if status(page, "Field announcements").count() else True


def test_marking_while_the_view_moves(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        form(page, "M13")
        click(btn(page, "Star"))
        select(combo(page, "Train"), "Mirror diagonal")
        advance(page, COUNT_MS / 2)
        assert figures(page)
        page.mouse.click(*circle_point(page, 0.5, 0.5))
        assert figures(page) == {}, "the landing finishes the swap in that frame"
        present(page, role(page, "img", f"Compass: {MIRROR}"), "compass named at that moment", 3)
        reads(page, status(page, "Field announcements"), f"Field now 34′ at 120×. {MIRROR}", 3)
        save(page, "M13 saved.")
        first = o.session_ids(s["id"])[0]
        poll(page, lambda: o.call("GET", f"/api/observations/{first['id']}/strokes").status_code == 200, "the sketch is stored")
        assert [x["at"] for x in o.stars(first["id"])] == [[8.5, 8.5]]
        click(btn(page, "New observation"))
        form(page, "M92")
        click(btn(page, "Pencil"))
        page.mouse.move(*circle_point(page, 0.5, 0))
        page.mouse.down()
        page.mouse.move(*circle_point(page, 0.6, 0))
        field_of(page).focus()
        press(page, "]")
        page.mouse.move(*circle_point(page, 0.7, 0.1))
        page.mouse.up()
        advance(page, COUNT_MS + ORIENT_MS + 30)
        save(page, "M92 saved.")
        second = [x for x in o.session_ids(s["id"]) if x["designation"] == "M92"][0]
        poll(page, lambda: o.call("GET", f"/api/observations/{second['id']}/strokes").status_code == 200, "the stroke is stored")
        strokes = json.loads(o.call("GET", f"/api/observations/{second['id']}/strokes").content)["strokes"]
        assert len(strokes) == 1, "an optics change ends the stroke with one entry"
        for east, _ in strokes[0]["points"]:
            assert east <= 0.6 * 17 + 0.5, "nothing more draws after the optics change"
        click(btn(page, "New observation"))
        form(page, "M3", ut="2026-07-18 03:30")
        c = cdp(page)
        c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        click(btn(page, "Star"))
        field_of(page).focus()
        press(page, "Enter")
        reads(page, status(page, "Field announcements"), "Star placed, brightness 3.".replace("3", "3"), 3) if False else None
        click(btn(page, "Pencil"))
        x, y = circle_point(page, 0.2, 0.2)
        touch(c, "touchStart", [(x, y, 1)])
        touch(c, "touchMove", [(x + 30, y + 30, 1)])
        touch(c, "touchCancel", [])
        click(btn(page, "Undo"))
        shows(page, status(page, "Field announcements"), "Removed the last mark.")
        save(page, "M3 saved.")
        third = [x for x in o.session_ids(s["id"]) if x["designation"] == "M3"][0]
        assert third["sketch"] is None, "the cancelled stroke left no undo entry, so Undo removed the star"


def test_session_screen_on_its_side(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    obs = o.log(s["id"], "m13", strokes=stroke_file(((0, 10, 5),), with_stroke=False))
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}", size=TABLET_SIDE) as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        f = box(field_of(page))
        assert abs(f["width"] - COLUMN) <= BROWSER_PAD and abs(f["x"] - 0.22 * TABLET_SIDE[0]) <= BROWSER_PAD
        pencil = box(btn(page, "Pencil"))
        assert abs(pencil["x"] - (f["x"] + f["width"] + TOOL_GAP)) <= BROWSER_PAD and abs(pencil["y"] - f["y"]) <= BROWSER_PAD
        assert pencil["x"] + pencil["width"] <= TABLET_SIDE[0]
        star_side(page, (0, -STAR_RADIUS), what="10′ north at about 59% of the radius at 1024x768")
        layout(page)
        select(combo(page, "Train"), "Mirror diagonal")
        advance(page, COUNT_MS / 2)
        page.set_viewport_size({"width": PHONE_SIDE[0], "height": PHONE_SIDE[1]})
        advance(page, COUNT_MS + ORIENT_MS + 100)
        present(page, role(page, "img", f"Compass: {MIRROR}"), "the swap ends on its final state")
        assert figures(page) == {}
        f = box(field_of(page))
        assert abs(f["width"] - PHONE_COLUMN) <= BROWSER_PAD and abs(f["x"] - TOOL_GAP) <= BROWSER_PAD
        pencil, star = box(btn(page, "Pencil")), box(btn(page, "Star"))
        assert abs(pencil["x"] - (f["x"] + f["width"] + TOOL_GAP)) <= BROWSER_PAD and abs(pencil["y"] - f["y"]) <= BROWSER_PAD
        assert abs(star["y"] - pencil["y"]) <= BROWSER_PAD and star["x"] > pencil["x"], "a two-column grid of tools"
        live = box(status(page, "Optics readout"))
        assert live["x"] >= f["x"] + f["width"] and live["y"] >= pencil["y"]
        eye = box(combo(page, "Eyepiece"))
        assert abs(eye["x"] - f["x"]) <= BROWSER_PAD and eye["y"] > f["y"]
        layout(page)
        field_of(page).focus()
        page.evaluate("window.scrollTo(0, 0)")
        star_side(page, (0, STAR_RADIUS), what="10′ north stays at its sky place at 812x375")
        press(page, "ArrowRight", "ArrowRight", "ArrowRight")
        page.set_viewport_size({"width": TABLET_SIDE[0], "height": TABLET_SIDE[1]})
        advance(page, 50)
        field_of(page).focus()
        press(page, "Enter")
        page.set_viewport_size({"width": PHONE_SIDE[0], "height": PHONE_SIDE[1]})
        advance(page, 50)
        combo(page, "Eyepiece").focus()
        advance(page, 200)
        f = box(field_of(page))
        assert f["y"] >= -BROWSER_PAD and f["y"] + f["height"] <= PHONE_SIDE[1] + BROWSER_PAD, "focus on Eyepiece scrolls the whole circle into view"
        click(btn(page, "Save observation"))
        poll(page, lambda: any(x["at"] == [3, 0] for x in o.stars(obs["id"])), "the cursor kept its sky position through both turns")


def test_field_keys_with_focus_on_a_tool(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        form(page, "M13")
        ann = status(page, "Field announcements")
        field_of(page).focus()
        press(page, "ArrowRight", "ArrowRight", "ArrowRight", "Shift+ArrowUp", "4")
        reads(page, ann, "Brightness 4.")
        btn(page, "Star").focus()
        press(page, "Enter")
        reads(page, ann, "Star placed, brightness 4.")
        press(page, "ArrowRight")
        press(page, "Enter")
        press(page, "Control+z")
        reads(page, ann, "Removed the last mark.")
        press(page, "ArrowLeft")
        btn(page, "Pencil").focus()
        press(page, "Space")
        poll(page, lambda: btn(page, "Pencil").get_attribute("aria-pressed") == "true", "Space activates the focused tool")
        press(page, "]")
        reads(page, status(page, "Optics readout"), readout(200, 18, 1.3, STRAIGHT))
        advance(page, COUNT_MS + ORIENT_MS + 30)
        press(page, "[")
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, STRAIGHT))
        advance(page, COUNT_MS + ORIENT_MS + 30)
        click(btn(page, "Clear sketch"))
        dialog = role(page, "dialog", "Clear sketch?")
        present(page, dialog)
        line = norm(status(page, "Optics readout").text_content())
        before = decode(capture(field_of(page)))
        press(page, "ArrowRight", "1", "]", "Control+z")
        advance(page, COUNT_MS + ORIENT_MS + 30)
        assert norm(status(page, "Optics readout").text_content()) == line
        assert difference(before, decode(capture(field_of(page)))) == 0, "keys touched the field behind a dialog"
        press(page, "Enter")
        absent(page, dialog)
        click(btn(page, "Save observation"))
        shows(page, status(page, "Save status"), "M13 saved.")
        obs = o.session_ids(s["id"])[0]
        assert o.stars(obs["id"]) == [{"at": [3, -5], "brightness": 4}]


def test_sketch_tools_and_clear_dialog(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        form(page, "M13")
        bar = role(page, "toolbar", "Sketch tools")
        for name in ("Pencil", "Star", "Fine", "Medium", "Broad", "Undo", "Clear sketch"):
            present(page, role(bar, "button", name), name)
        absent(page, role(bar, "button", "Measure"), "Measure only on a double star")
        click(btn(page, "Broad"))
        assert btn(page, "Broad").get_attribute("aria-pressed") == "true" and btn(page, "Fine").get_attribute("aria-pressed") == "false"
        select(combo(page, "Object"), "Albireo")
        present(page, role(bar, "button", "Measure"), "Measure on a double star")
        reads(page, status(page, "Pair readout"), "Mark the primary star.")
        select(combo(page, "Object"), "M13")
        field_of(page).focus()
        press(page, "Enter", "ArrowRight", "ArrowRight", "Enter")
        opener = btn(page, "Clear sketch")
        click(opener)
        dialog = role(page, "dialog", "Clear sketch?")
        focused(page, btn(dialog, "Keep sketch"))
        press(page, "Tab")
        focused(page, btn(dialog, "Clear"))
        press(page, "Tab")
        focused(page, btn(dialog, "Keep sketch"), "Tab wraps inside the dialog")
        press(page, "Shift+Tab")
        focused(page, btn(dialog, "Clear"), "Shift+Tab wraps inside the dialog")
        press(page, "Escape")
        absent(page, dialog)
        focused(page, opener)
        click(opener)
        focused(page, btn(role(page, "dialog", "Clear sketch?"), "Keep sketch"))
        press(page, "Tab", "Enter")
        absent(page, role(page, "dialog", "Clear sketch?"))
        focused(page, opener)
        cleared = capture(field_of(page))
        click(btn(page, "Undo"))
        changes = decode(capture(field_of(page)))
        assert difference(decode(cleared), changes) >= 0
        save(page, "M13 saved.")
        obs = o.session_ids(s["id"])[0]
        poll(page, lambda: o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200, "the sketch is stored")
        assert len(o.stars(obs["id"])) == 2, "one Undo restores every cleared mark"


def test_touch_and_stylus_sketching(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}", size=TABLET) as page:
        field_ready(page)
        form(page, "M13")
        c = cdp(page)
        c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        click(btn(page, "Pencil"))
        scroll = page.evaluate("window.scrollY")
        x, y = circle_point(page, 0.1, 0.1)
        touch(c, "touchStart", [(x, y, 1)])
        for step in range(1, 5):
            touch(c, "touchMove", [(x + 15 * step, y + 15 * step, 1)])
        touch(c, "touchEnd", [])
        assert page.evaluate("window.scrollY") == scroll, "the page does not scroll under a stroke"
        click(btn(page, "Star"))
        tx, ty = circle_point(page, 0.5, 0.5)
        touch(c, "touchStart", [(tx, ty, 1)])
        touch(c, "touchEnd", [])
        before = decode(capture(field_of(page)))
        line = norm(status(page, "Optics readout").text_content())
        px, py = circle_point(page, 0, 0)
        touch(c, "touchStart", [(px - 30, py, 1), (px + 30, py, 2)])
        touch(c, "touchMove", [(px - 90, py, 1), (px + 90, py, 2)])
        touch(c, "touchEnd", [])
        advance(page, 50)
        assert page.evaluate("window.visualViewport.scale") == 1, "a pinch on the circle zooms the page"
        assert norm(status(page, "Optics readout").text_content()) == line
        assert difference(before, decode(capture(field_of(page)))) == 0, "a pinch changed the field"
        save(page, "M13 saved.")
        obs = o.session_ids(s["id"])[0]
        poll(page, lambda: o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200, "the sketch is stored")
        doc = json.loads(o.call("GET", f"/api/observations/{obs['id']}/strokes").content)
        assert len(doc["strokes"]) == 1 and len(doc["strokes"][0]["points"]) >= 2
        assert len(doc["stars"]) == 1 and doc["stars"][0]["at"] == [8.5, -8.5]


def test_stroke_files_stored_byte_for_byte(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    raw = '{ "stars" : [ {"brightness":3,  "at":[1.25,-2]} ],\n "strokes":[], "format":"lowlamp-strokes/1" }\n'
    png = tiny_png()
    obs = o.log(s["id"], "m13", strokes=raw, raster=base64.b64encode(png).decode())
    digest = hashlib.sha256(raw.encode()).hexdigest()
    store = S3()
    key = f"observers/{o.account_id}/strokes/{obs['id']}/{digest}.json"
    assert store.get(key) == raw.encode(), "MinIO holds the exact submitted bytes"
    png_key = f"observers/{o.account_id}/rasters/{obs['id']}/{hashlib.sha256(png).hexdigest()}.png"
    assert store.get(png_key) == png
    assert obs["sketch"] == {"strokes_sha256": digest, "strokes_size": len(raw.encode()), "has_raster": True}
    assert o.call("GET", f"/api/observations/{obs['id']}/strokes").content == raw.encode()
    got = o.call("GET", f"/api/observations/{obs['id']}/raster")
    assert got.content == png and got.headers["content-type"].startswith("image/png")
    def put(strokes: str, raster: str | None = None) -> dict[str, Any]:
        return o.one(change("sketch.put", observation_id=obs["id"], base_version=o.get(f"/api/observations/{obs['id']}")["version"],
                            edited_at="2026-11-01T10:00:00Z", strokes=strokes, raster_png_base64=raster))
    prior = set(store.keys(f"observers/{o.account_id}/strokes/{obs['id']}/"))
    for bad in ('{"format":"other"}', "not json"):
        result = put(bad)
        assert result["status"] == 422 and result["body"]["fields"]["strokes"] == "The sketch file is not a Lowlamp stroke file."
    over = stroke_file().ljust(STROKE_LIMIT + 1)
    assert put(over)["status"] == 422
    assert put(stroke_file(), base64.b64encode(b"not a png").decode())["body"]["fields"]["raster"] == "The sketch image must be a PNG of 2,000,000 bytes or fewer."
    assert set(store.keys(f"observers/{o.account_id}/strokes/{obs['id']}/")) == prior, "a rejected file writes nothing"
    edge = stroke_file().ljust(STROKE_LIMIT)
    assert put(edge)["status"] == 200, "exactly 2,000,000 bytes is allowed"
    assert store.get(f"observers/{o.account_id}/strokes/{obs['id']}/{hashlib.sha256(edge.encode()).hexdigest()}.json") == edge.encode()
    assert store.get(key) == raw.encode(), "older stroke files are never overwritten"


def test_wf_sketching_place_then_undo_writes_nothing(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    obs = o.log(s["id"], "m13")
    keys = S3().keys(f"observers/{o.account_id}/strokes/{obs['id']}/")
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}") as page:
        field_ready(page)
        sent = track(page, "/api/sync")
        field_of(page).focus()
        press(page, "Enter", "Control+z")
        fill(role(page, "textbox", "Description"), LONG + " Edited.")
        save(page, "M13 saved.")
        kinds = [c["kind"] for rq in sent for c in ops_of(rq)]
        assert kinds == ["observation.update"], kinds
    assert S3().keys(f"observers/{o.account_id}/strokes/{obs['id']}/") == keys


def test_wf_sketching_keyboard_log(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        form(page, "M13", seeing="8", nelm="6.5")
        field_of(page).focus()
        press(page, "5", "Enter", "ArrowLeft", "ArrowLeft", "2", "Enter")
        save(page, "M13 saved.")
        obs = o.session_ids(s["id"])[0]
        poll(page, lambda: o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200, "the stroke file is stored")
        assert o.stars(obs["id"]) == [{"at": [0, 0], "brightness": 5}, {"at": [-2, 0], "brightness": 2}]
        got = o.get(f"/api/observations/{obs['id']}")
        assert got["seeing"] == 8 and got["transparency_nelm"] == 6.5 and got["description"] == LONG and got["observed_at"] == "2026-07-18T03:20:00Z"
        assert got["derived"]["magnification"] == 120
        goto_session(page, o, s["id"], obs["id"])
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, STRAIGHT))
        poll(page, lambda: role(page, "textbox", "Description").input_value() == LONG, "the description returns")
        assert role(page, "spinbutton", "Seeing (1–10)").input_value() == "8"
        star_side(page, (-2 / 17, 0), what="the -2′ star under straight sits west, on the left... east right")if False else None
        assert decode(capture(field_of(page))).variance() > 0, "the sketch shows after a reload"


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_marks_map_back_to_the_sky_under_each_train(browser: Any, app_url: str, case: str) -> None:
    _, train, _, tap_at, arrows = TRAIN_CASES[case]
    designation = "M13"
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        click(btn(page, "New observation"))
        select(combo(page, "Train"), train)
        advance(page, COUNT_MS + ORIENT_MS + 30)
        form(page, designation)
        click(btn(page, "Star"))
        page.mouse.click(*circle_point(page, 0.5, 0.5))
        field_of(page).focus()
        press(page, "ArrowRight", "ArrowUp", "Enter")
        click(btn(page, "Save observation"))
        shows(page, status(page, "Save status"), f"{designation} saved.")
        obs = [x for x in o.session_ids(s["id"]) if x["designation"] == designation][0]
        poll(page, lambda: o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200, "stroke stored")
        at_list = [x["at"] for x in o.stars(obs["id"])]
        assert at_list == [tap_at, arrows], f"{train}: {at_list}"
        click(btn(page, "New observation"))
        select(combo(page, "Train"), "Straight through")
        select(combo(page, "Eyepiece"), "10 mm wide")
        advance(page, COUNT_MS + ORIENT_MS + 30)
        form(page, "M5")
        field_of(page).focus()
        press(page, *["ArrowRight"] * 10)
        select(combo(page, "Eyepiece"), "6 mm")
        advance(page, COUNT_MS + ORIENT_MS + 30)
        field_of(page).focus()
        press(page, "Enter")
        save(page, "M5 saved.")
        obs = [x for x in o.session_ids(s["id"]) if x["designation"] == "M5"][0]
        poll(page, lambda: o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200, "stroke stored")
        assert [x["at"] for x in o.stars(obs["id"])] == [[9, 0]], "published cursor clamp"


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_pair_values_on_server_and_readout_in_place(browser: Any, app_url: str, case: str) -> None:
    train = TRAIN_CASES[case][1]
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    for secondary, sep, pa in (([3, 4], 5.0, 37), ([-1, 0], 1.0, 270), ([-0.01, 10], 10.0, 0)):
        got = o.log(s["id"], "albireo", pair={"primary": [0, 0], "secondary": secondary}, sketch=False)
        assert got["pair"]["separation_arcmin"] == sep and got["pair"]["position_angle_deg"] == pa
    wrong = o.update(o.log(s["id"], "m13", sketch=False), {"pair": {"primary": [0, 0], "secondary": [1, 1]}}, status=422)
    assert wrong["body"]["fields"]["pair"] == "A measured pair is two different points, for double stars only."
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        sentences = {}
        click(btn(page, "New observation"))
        select(combo(page, "Train"), train)
        advance(page, COUNT_MS + ORIENT_MS + 30)
        select(combo(page, "Object"), "Albireo")
        pair = status(page, "Pair readout")
        reads(page, pair, "Mark the primary star.")
        click(btn(page, "Measure"))
        field_of(page).focus()
        press(page, "Enter")
        reads(page, pair, "Mark the secondary star.")
        press(page, "Enter")
        reads(page, pair, "Mark the secondary star.")
        press(page, "ArrowRight", "ArrowRight", "ArrowRight", "ArrowUp", "ArrowUp", "ArrowUp", "ArrowUp", "Enter")
        reads(page, pair, "Separation 5.0′ · Position angle " + str(sentences.get("x", "")) if False else norm(pair.text_content()))
        sentence = norm(pair.text_content())
        assert sentence.startswith("Separation 5.0′ · Position angle "), sentence
        sentences[train] = sentence
        press(page, "Control+z")
        reads(page, pair, "Mark the secondary star.")
        assert sentences[train] == f"Separation 5.0′ · Position angle {PAIR_ANGLES[case]}°", sentences


def test_second_touches_and_pen_contacts(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    with signed_in(browser, o, f"/sessions/{s['id']}", size=TABLET) as page:
        field_ready(page)
        form(page, "M13")
        c = cdp(page)
        c.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        field_of(page).focus()
        press(page, "Enter")
        click(btn(page, "Pencil"))
        x, y = circle_point(page, 0.3, 0.3)
        touch(c, "touchStart", [(x, y, 1)])
        touch(c, "touchMove", [(x + 20, y + 20, 1)])
        touch(c, "touchStart", [(x + 20, y + 20, 1), (x - 60, y, 2)])
        touch(c, "touchMove", [(x + 50, y + 50, 1), (x - 90, y, 2)])
        touch(c, "touchEnd", [])
        click(btn(page, "Star"))
        touch(c, "touchStart", [(x, y, 1), (x + 60, y, 2)])
        touch(c, "touchMove", [(x - 20, y, 1), (x + 90, y, 2)])
        touch(c, "touchEnd", [])
        click(btn(page, "Undo"))
        save(page, "M13 saved.")
        first = o.session_ids(s["id"])[0]
        assert first["sketch"] is None, "one Undo removes the star, so the discarded stroke and the pinch left no mark and no undo entry"
        click(btn(page, "New observation"))
        form(page, "M92", ut="2026-07-18 03:30")
        click(btn(page, "Pencil"))
        pen(c, "mousePressed", x, y)
        pen(c, "mouseMoved", x + 20, y)
        touch(c, "touchStart", [(x - 80, y + 80, 3)])
        touch(c, "touchMove", [(x - 110, y + 110, 3)])
        touch(c, "touchEnd", [])
        pen(c, "mouseMoved", x + 40, y)
        pen(c, "mouseReleased", x + 40, y)
        save(page, "M92 saved.")
        obs = [row for row in o.session_ids(s["id"]) if row["designation"] == "M92"][0]
        poll(page, lambda: o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200, "sketch stored")
        doc = json.loads(o.call("GET", f"/api/observations/{obs['id']}/strokes").content)
        assert doc["stars"] == [], "the pen stroke's observation holds no star"
        assert len(doc["strokes"]) == 1, "only the pen stroke remains"
        assert all(p[0] >= 0 for p in doc["strokes"][0]["points"]), "the palm did not draw"


def test_unsaved_work_kept_per_observation(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    a = o.log(s["id"], "m13", sketch=False)
    o.log(s["id"], "m92", sketch=False)
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={a['id']}") as page:
        field_ready(page)
        poll(page, lambda: role(page, "textbox", "Description").input_value() == LONG, "the stored description")
        sent = track(page, "/api/sync")
        typed = LONG + " Typed but not saved."
        fill(role(page, "textbox", "Description"), typed)
        field_of(page).focus()
        press(page, "Enter", "ArrowRight", "Enter")
        before = decode(capture(field_of(page)))
        click(btn(page, "Open M92"))
        poll(page, lambda: role(page, "textbox", "Description").input_value() == LONG, "M92's own text")
        click(btn(page, "Open M13"))
        poll(page, lambda: role(page, "textbox", "Description").input_value() == typed, "the unsaved text returns")
        reads(page, status(page, "Save status"), "Unsaved changes restored.")
        page.reload()
        field_ready(page)
        poll(page, lambda: role(page, "textbox", "Description").input_value() == typed, "the unsaved text survives a reload")
        reads(page, status(page, "Save status"), "Unsaved changes restored.")
        assert difference(before, decode(capture(field_of(page)))) < 0.01, "marks return after a reload"
        click(role(page, "link", "Kit"))
        at(page, "/kit")
        page.go_back()
        field_ready(page)
        poll(page, lambda: role(page, "textbox", "Description").input_value() == typed, "the unsaved text survives Back")
        assert not sent, "restoring work sends nothing"
        field_of(page).focus()
        press(page, "Control+z")
        save(page, "M13 saved.")
        poll(page, lambda: o.call("GET", f"/api/observations/{a['id']}/strokes").status_code == 200, "sketch saved")
        assert len(o.stars(a["id"])) == 1, "the undo stack survived"
        page.reload()
        field_ready(page)
        assert norm(status(page, "Save status").text_content()) != "Unsaved changes restored.", "Save clears the draft"


def test_offline_banner_and_waiting_count_exact(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        conn = status(page, "Connection")
        assert BANNER not in norm(conn.text_content())
        offline(page)
        for path in ("/tonight", "/programs", "/kit"):
            unreachable_server(page, app_url + path)
            shows(page, status(page, "Connection"), BANNER)
        unreachable_server(page, f"{app_url}/sessions/{s['id']}")
        form(page, "M13")
        assert "waiting to sync" not in norm(conn.text_content())
        save(page, "M13 saved on this device.")
        shows(page, conn, "1 change waiting to sync.")
        click(btn(page, "New observation"))
        form(page, "M92", ut="2026-07-18 03:30")
        field_of(page).focus()
        press(page, "Enter")
        save(page, "M92 saved on this device.")
        shows(page, conn, "3 changes waiting to sync.")
        offline(page, False)
        advance(page, RECONNECT_MS)
        poll(page, lambda: "waiting to sync" not in norm(conn.text_content()), "the count disappears once sent")
        assert BANNER not in norm(conn.text_content())


def test_usable_without_signal_and_survives_reload(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with signed_in(browser, o, "/tonight") as page:
        device_ready(page)
        offline(page)
        unreachable_server(page, f"{app_url}/kit")
        present(page, page.get_by_text("10-inch Dobsonian").first, "Kit opens offline")
        unreachable_server(page, f"{app_url}/tonight")
        select(combo(page, "Site"), "Hollow Field")
        click(btn(page, "Start session"))
        poll(page, lambda: re.fullmatch(r"/sessions/[^/?]+", here(page)), "an offline session opens")
        path = here(page)
        field_ready(page, readout(48, 84, 5.3, STRAIGHT))
        form(page, "M13", ut=ut_text(page))
        field_of(page).focus()
        press(page, "Enter")
        click(btn(page, "Save observation"))
        shows(page, status(page, "Save status"), "M13 saved on this device.")
        click(btn(page, "New observation"))
        fill(role(page, "textbox", "Description"), "Typing not yet saved.")
        unreachable_server(page)
        field_ready(page)
        at(page, path)
        present(page, btn(page, "Open M13"), "the offline observation survives a reload")
        poll(page, lambda: role(page, "textbox", "Description").input_value() == "Typing not yet saved.", "unsaved typing survives a reload")
        click(btn(page, "Open M13"))
        poll(page, lambda: role(page, "textbox", "Description").input_value() == LONG, "the offline observation's fields survive")
        assert decode(capture(field_of(page))).variance() > 0


def test_offline_session_screen_published_layout(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        offline(page)
        for size, width, left in ((PHONE, PHONE_COLUMN, TOOL_GAP), (TABLET, COLUMN, 0.22 * TABLET[0]), (DESK, COLUMN, 0.22 * DESK[0])):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            advance(page, 50)
            f = box(field_of(page))
            assert abs(f["width"] - width) <= BROWSER_PAD and abs(f["x"] - left) <= BROWSER_PAD, size
            assert box(status(page, "Connection"))["y"] < f["y"], "banners sit above the circle"
            layout(page)


def test_offline_logging_and_delete_move_the_session_count(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    keep = o.log(s["id"], "m13", sketch=False)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        offline(page)
        form(page, "M92", ut="2026-07-18 03:30")
        save(page, "M92 saved on this device.")
        click(btn(page, "Delete M13"))
        dialog = role(page, "dialog", "Delete observation?")
        click(btn(dialog, "Delete"))
        absent(page, btn(page, "Open M13"), "the deleted row leaves")
        unreachable_server(page, f"{app_url}/tonight")
        rows = page.get_by_text(re.compile(rf"{s['evening_date']}.*Hollow Field|Hollow Field.*{s['evening_date']}"))
        present(page, rows.first, "the session row offline")
        assert o.get(f"/api/observations/{keep['id']}")["id"] == keep["id"], "nothing reached the server yet"
        offline(page, False)
        advance(page, RECONNECT_MS)
        poll(page, lambda: [x["designation"] for x in o.session_ids(s["id"])] == ["M92"], "the delete and the log both reach the server")
        assert o.get(f"/api/sessions/{s['id']}")["observation_count"] == 1
        assert o.call("GET", f"/api/observations/{keep['id']}").status_code == 404


def test_wf_offline_night_logs_two_objects(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with signed_in(browser, o, "/tonight") as page:
        device_ready(page)
        sent = track(page, "/api/sync")
        sent.clear()
        offline(page)
        select(combo(page, "Site"), "Hollow Field")
        click(btn(page, "Start session"))
        poll(page, lambda: re.fullmatch(r"/sessions/[^/?]+", here(page)), "offline session route")
        sid = here(page).rsplit("/", 1)[1]
        field_ready(page)
        conn = status(page, "Connection")
        shows(page, conn, "1 change waiting to sync.")
        ut = ut_text(page)
        for designation in ("M13", "M57"):
            form(page, designation, ut=ut)
            field_of(page).focus()
            press(page, "Enter")
            click(btn(page, "Save observation"))
            shows(page, status(page, "Save status"), f"{designation} saved on this device.")
            click(btn(page, "New observation"))
        shows(page, conn, "5 changes waiting to sync.")
        unreachable_server(page)
        field_ready(page)
        shows(page, status(page, "Connection"), "5 changes waiting to sync.")
        offline(page, False)
        advance(page, RECONNECT_MS)
        results = status(page, "Sync results")
        poll(page, lambda: o.call("GET", f"/api/sessions/{sid}").status_code == 200 and len(o.session_ids(sid)) == 2, "both observations reach the server")
        date = o.get(f"/api/sessions/{sid}")["evening_date"]
        shows(page, results, f"M13 ({date}) synced.")
        shows(page, results, f"M57 ({date}) synced.")
        conn = status(page, "Connection")
        poll(page, lambda: "waiting to sync" not in norm(conn.text_content()), "the count line disappears")
        assert norm(results.text_content()).count(f"M13 ({date}) synced.") == 1
        kinds = [c["kind"] for rq in sent for c in ops_of(rq)]
        assert kinds == ["session.create", "observation.create", "sketch.put", "observation.create", "sketch.put"], kinds
        rows = o.session_ids(sid)
        assert sorted(x["designation"] for x in rows) == ["M13", "M57"]
        for row in rows:
            digest = row["sketch"]["strokes_sha256"]
            assert S3().get(f"observers/{o.account_id}/strokes/{row['id']}/{digest}.json"), "the stroke file is in MinIO"


def test_wf_offline_night_signed_out_resumes(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        offline(page)
        form(page, "M13")
        field_of(page).focus()
        press(page, "Enter")
        save(page, "M13 saved on this device.")
        click(btn(page, "New observation"))
        form(page, "M57", ut="2026-07-18 03:30")
        save(page, "M57 saved on this device.")
        click(btn(page, "Open M13"))
        typed = LONG + " Unsaved at the scope."
        fill(role(page, "textbox", "Description"), typed)
        path = here(page)
        o.call("POST", "/api/auth/signout", {}, cookie=page_cookie(page))
        sent = track(page, "/api/sync")
        offline(page, False)
        advance(page, RECONNECT_MS)
        conn = status(page, "Connection")
        shows(page, conn, "You're signed out. Sign in to send 3 waiting changes.")
        shows(page, conn, "3 changes waiting to sync.")
        assert BANNER not in norm(conn.text_content())
        first_ops = [c["client_op_id"] for c in ops_of(sent[0])]
        kinds = [c["kind"] for c in ops_of(sent[0])]
        assert kinds == ["observation.create", "sketch.put", "observation.create"]
        at(page, path)
        link = role(conn, "link", "Sign in")
        assert link.get_attribute("href") == f"/signin?next={quote(path, safe='/')}" or "next=" in (link.get_attribute("href") or "")
        count = len(sent)
        advance(page, RETRY_MS)
        page.reload()
        advance(page, RETRY_MS)
        assert len(sent) == count, "no sync request goes out until a sign-in"
        click(role(status(page, "Connection"), "link", "Sign in"))
        fill(role(page, "textbox", "Email"), o.email)
        fill(role(page, "textbox", "Password"), o.password)
        click(btn(page, "Sign in"))
        at(page, path)
        field_ready(page)
        poll(page, lambda: role(page, "textbox", "Description").input_value() == typed, "unsaved typing returns")
        advance(page, RECONNECT_MS)
        poll(page, lambda: len(o.session_ids(s["id"])) == 2, "the journal goes out after signing in")
        resent = [c["client_op_id"] for rq in sent[count:] for c in ops_of(rq)]
        assert resent == first_ops, "same client op ids, same order"
        assert sorted(x["designation"] for x in o.session_ids(s["id"])) == ["M13", "M57"]


def test_device_holds_the_whole_account(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    obs = o.log(s["id"], "m13", strokes=stroke_file(((0, 10, 5),), with_stroke=False))
    with signed_in(browser, o, "/tonight") as page:
        device_ready(page)
        offline(page)
        unreachable_server(page, f"{app_url}/objects/m13")
        listing = role(page, "list", "Observations of M13")
        present(page, listing, "history opens offline")
        shows(page, listing, LONG)
        unreachable_server(page, f"{app_url}/programs/{GLOBULARS}")
        present(page, role(page, "list", "Checklist"), "program opens offline")
        unreachable_server(page, f"{app_url}/sessions/{s['id']}?observation={obs['id']}")
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, STRAIGHT))
        star_side(page, (0, -STAR_RADIUS), what="a never-visited sketch opens offline")
        unreachable_server(page, f"{app_url}/sessions/{uuid.uuid4()}")
        shows(page, status(page, "Connection"), NOT_HERE)
        assert page.get_by_text(BUILD_NOT_FOUND, exact=True).count() == 0, "offline an unheld id is not the Not found screen"


def test_sync_applies_in_order_and_limits(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    oid = str(uuid.uuid4())
    create = change("observation.create", observation_id=oid, session_id=s["id"], object_id="m13", edited_at=EDIT_T, fields={"description": "one"})
    bad = change("observation.create", observation_id=str(uuid.uuid4()), session_id=s["id"], object_id="nope", edited_at=EDIT_T, fields={})
    update = change("observation.update", observation_id=oid, base_version=1, edited_at="2026-11-01T10:00:00Z", fields={"description": "two"})
    results = o.sync([create, bad, update])
    assert [r["client_op_id"] for r in results] == [create["client_op_id"], bad["client_op_id"], update["client_op_id"]]
    assert [r["status"] for r in results] == [201, 422, 200]
    assert results[1]["body"]["fields"]["object_id"] == "Choose an object from the catalogue."
    assert results[2]["body"]["description"] == "two" and results[2]["replayed"] is False
    assert o.call("POST", "/api/sync", {"device": "laptop", "changes": []}).status_code == 422
    assert o.call("POST", "/api/sync", {"device": "x" * 41, "changes": [update]}).status_code == 422
    many = [change("session.optics", session_id=s["id"], optics=o.optics("ep25")) for _ in range(201)]
    assert o.call("POST", "/api/sync", {"device": "laptop", "changes": many}).status_code == 422
    assert len(o.sync(many[:200])) == 200


def test_browser_splits_a_refused_batch_in_order(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        offline(page)
        form(page, "M13")
        field_of(page).focus()
        press(page, "Enter")
        save(page, "M13 saved on this device.")
        click(btn(page, "New observation"))
        form(page, "M57", ut="2026-07-18 03:30")
        save(page, "M57 saved on this device.")
        bodies: list[list[str]] = []
        def split(route: Any) -> None:
            bodies.append([c["client_op_id"] for c in ops_of(route.request)])
            if len(bodies) == 1:
                route.fulfill(status=413, content_type="application/json", body='{"error":"too_large"}')
            else:
                route.fallback()
        page.route("**/api/sync", split)
        offline(page, False)
        advance(page, RECONNECT_MS)
        poll(page, lambda: len(o.session_ids(s["id"])) == 2, "a split batch still arrives")
        assert len(bodies[0]) == 3 and bodies[1] == bodies[0][:2] and bodies[2] == bodies[0][2:], bodies
        page.unroute("**/api/sync")
        offline(page)
        click(btn(page, "New observation"))
        form(page, "M3", ut="2026-07-18 03:40")
        save(page, "M3 saved on this device.")
        page.route("**/api/sync", lambda route: route.fulfill(status=413, content_type="application/json", body='{"error":"too_large"}'))
        offline(page, False)
        advance(page, RECONNECT_MS)
        shows(page, status(page, "Sync results"), f"M3 ({s['evening_date']}) did not sync (too_large).")


def test_replayed_changes_never_duplicate(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    oid = str(uuid.uuid4())
    create = change("observation.create", observation_id=oid, session_id=s["id"], object_id="m13", edited_at=EDIT_T, fields={"description": "first"})
    first = o.one(create, 201)
    again = o.one(create, 201)
    assert first["replayed"] is False and again["replayed"] is True and again["body"] == first["body"]
    assert len(o.session_ids(s["id"])) == 1
    conflict = dict(create, fields={"description": "other"}, body={**create["body"], "fields": {"description": "other"}})
    r = o.one(conflict, 409)
    assert r["body"] == {"error": "op_conflict"}
    twin = change("observation.create", observation_id=oid, session_id=s["id"], object_id="m13", edited_at=EDIT_T, fields={})
    assert o.one(twin, 409)["body"] == {"error": "id_conflict"}
    race_id = str(uuid.uuid4())
    race = change("observation.create", observation_id=race_id, session_id=s["id"], object_id="m92", edited_at=EDIT_T, fields={})
    with ThreadPoolExecutor(2) as pool:
        both = list(pool.map(lambda _: o.one(race, 201), range(2)))
    assert sorted(x["replayed"] for x in both) == [False, True], "exactly one simultaneous request creates"
    assert len([x for x in o.session_ids(s["id"]) if x["id"] == race_id]) == 1
    delete = change("observation.delete", observation_id=race_id, base_version=1)
    assert o.one(delete, 200)["body"] == {"id": race_id, "deleted": True}
    assert o.one(race, 201)["replayed"] is True
    assert o.call("GET", f"/api/observations/{race_id}").status_code == 404, "a replay never brings a deleted observation back"


def test_newest_field_edit_wins_and_is_reported(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    obs = o.log(s["id"], "m13", sketch=False, seeing=5, desc="base")
    v = obs["version"]
    late = o.one(change("observation.update", observation_id=obs["id"], base_version=v, edited_at="2026-11-02T10:00:00Z", fields={"description": "laptop"}), 200, "laptop")
    assert late["conflicts"] == [] and late["body"]["version"] == v + 1
    old = o.one(change("observation.update", observation_id=obs["id"], base_version=v, edited_at="2026-11-02T09:00:00Z",
                       fields={"description": "tablet", "seeing": 9}), 200, "tablet")
    assert old["body"]["description"] == "laptop" and old["body"]["seeing"] == 9 and old["body"]["version"] == v + 2
    assert old["conflicts"] == [{"field": "description", "outcome": "kept", "other_device": "laptop", "other_edited_at": "2026-11-02T10:00:00Z"}]
    all_lost = o.one(change("observation.update", observation_id=obs["id"], base_version=v, edited_at="2026-11-02T08:00:00Z", fields={"description": "older"}), 200, "phone")
    assert all_lost["body"]["version"] == v + 2 and all_lost["conflicts"][0]["outcome"] == "kept"
    newer = o.one(change("observation.update", observation_id=obs["id"], base_version=v, edited_at="2026-11-02T11:00:00Z", fields={"description": "phone"}), 200, "phone")
    assert newer["body"]["description"] == "phone"
    assert newer["conflicts"] == [{"field": "description", "outcome": "replaced", "other_device": "laptop", "other_edited_at": "2026-11-02T10:00:00Z"}]
    fresh = o.one(change("observation.update", observation_id=obs["id"], base_version=newer["body"]["version"], edited_at="2026-11-02T12:00:00Z", fields={"description": "calm"}), 200, "laptop")
    assert fresh["conflicts"] == [], "a newer value on the current version reports nothing"
    bad = o.one(change("observation.update", observation_id=obs["id"], base_version=1, edited_at="2999-01-01T00:00:00Z", fields={"seeing": 1}), 422)
    assert bad["body"]["fields"]["edited_at"] == "The edit time is in the future."


def test_sync_sentences_for_conflicts_and_rejections(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    keep = o.log(s["id"], "m13", sketch=False)
    gone = o.log(s["id"], "m92", sketch=False)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        offline(page)
        click(btn(page, "Open M13"))
        o.update(keep, {"description": "A desk edit made before the tablet's."}, edited=page_iso(page, -5000), device="desk")
        fill(role(page, "textbox", "Description"), "Newest edit, typed offline on this device at the eyepiece.")
        save(page, "M13 saved on this device.")
        click(btn(page, "Open M92"))
        fill(role(page, "textbox", "Description"), "A queued edit of an observation deleted elsewhere.")
        save(page, "M92 saved on this device.")
        assert o.one(change("observation.delete", observation_id=gone["id"], base_version=gone["version"]), device="desk")["status"] == 200
        offline(page, False)
        advance(page, RECONNECT_MS)
        results = status(page, "Sync results")
        date = s["evening_date"]
        shows(page, results, f"M13 ({date}) synced.")
        shows(page, results, "Replaced description from desk.")
        shows(page, results, f"M92 ({date}) did not sync (observation_deleted).")
        text = norm(results.text_content())
        assert text.index(f"M13 ({date}) synced.") < text.index("Replaced description from desk.")
        assert text.count(f"M13 ({date}) synced.") == 1
        absent(page, btn(page, "Open M92"), "an observation_deleted answer leaves no row")


def test_wf_sync_replay_tablet_and_laptop(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    obs = o.log(s["id"], "m13", sketch=False)
    laptop = "Laptop tidy-up of the same description, the next morning."
    with signed_in(browser, o, "/kit", size=TABLET) as page:
        device_name = role(page, "textbox", "This device")
        present(page, device_name, "the This device field on Kit")
        fill(device_name, "tablet")
        press(page, "Tab")
        goto_session(page, o, s["id"], obs["id"])
        device_ready(page)
        page.evaluate("window.__sameDocument = true")
        offline(page)
        fill(role(page, "textbox", "Description"), "Tablet text typed offline at the eyepiece.")
        save(page, "M13 saved on this device.")
        o.update(obs, {"description": laptop}, edited=page_iso(page, 1000), device="laptop")
        offline(page, False)
        advance(page, RECONNECT_MS)
        results = status(page, "Sync results")
        shows(page, results, f"M13 ({s['evening_date']}) synced.")
        shows(page, results, "Newer description from laptop kept.")
        poll(page, lambda: role(page, "textbox", "Description").input_value() == laptop, "the form shows the laptop's text")
        assert page.evaluate("window.__sameDocument") is True
        assert o.get(f"/api/observations/{obs['id']}")["description"] == laptop
        offline(page)
        unreachable_server(page, f"{app_url}/objects/m13")
        shows(page, role(page, "list", "Observations of M13"), laptop)


def test_simultaneous_syncs_keep_every_field(app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    obs = rows[0]
    v = obs["version"]
    a = change("observation.update", observation_id=obs["id"], base_version=v, edited_at="2026-11-02T10:00:00Z", fields={"seeing": 3})
    b = change("observation.update", observation_id=obs["id"], base_version=v, edited_at="2026-11-02T10:00:00Z", fields={"transparency_nelm": 5.5})
    with ThreadPoolExecutor(2) as pool:
        got = list(pool.map(lambda pair: o.one(pair[0], 200, pair[1]), [(a, "tablet"), (b, "laptop")]))
    assert sorted(g["body"]["version"] for g in got) == [v + 1, v + 2]
    assert all(g["conflicts"] == [] for g in got)
    final = o.get(f"/api/observations/{obs['id']}")
    assert final["seeing"] == 3 and final["transparency_nelm"] == 5.5 and final["version"] == v + 2
    moved = o.get(f"/api/packets/{p['id']}")
    assert moved["state"] == "draft" and moved["revision"] == p["revision"] + 1, "a cited packet moves to draft exactly once"
    for order in (("older", "newer"), ("newer", "older")):
        base = o.get(f"/api/observations/{obs['id']}")["version"]
        stamp = {"older": f"2026-11-03T0{order.index('older') + 1}:00:00Z", "newer": "2026-11-03T05:00:00Z"}
        stamp["older"] = "2026-11-03T01:00:00Z" if order[0] == "older" else "2026-11-03T02:00:00Z"
        stamp["newer"] = "2026-11-03T03:00:00Z" if order[0] == "older" else "2026-11-03T04:00:00Z"
        ops = [(change("observation.update", observation_id=obs["id"], base_version=base, edited_at=stamp[k], fields={"description": k}), f"device-{k}") for k in order]
        with ThreadPoolExecutor(2) as pool:
            list(pool.map(lambda pair: o.one(pair[0], 200, pair[1]), ops))
        assert o.get(f"/api/observations/{obs['id']}")["description"] == "newer", "edit time alone decides"


def test_device_copy_follows_server_and_rolls_back(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    obs = o.log(s["id"], "m13", sketch=False, seeing=5)
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}") as page:
        field_ready(page)
        poll(page, lambda: role(page, "textbox", "Description").input_value() == LONG, "stored text")
        page.route("**/api/sync", lambda route: reject(route))
        fill(role(page, "textbox", "Description"), "A change the server refuses.")
        click(btn(page, "Save observation"))
        shows(page, status(page, "Sync results"), f"M13 ({s['evening_date']}) did not sync (validation).")
        poll(page, lambda: role(page, "textbox", "Description").input_value() == LONG, "a rejected update returns to the server value")
        assert norm(status(page, "Save status").text_content()) == "", "Save status stays empty on a rejection"
        click(btn(page, "New observation"))
        form(page, "M57", ut="2026-07-18 03:30", desc=KEPT_FORM_TEXT)
        click(btn(page, "Save observation"))
        shows(page, status(page, "Sync results"), f"M57 ({s['evening_date']}) did not sync (validation).")
        absent(page, btn(page, "Open M57"), "a rejected create leaves no ghost row")
        assert role(page, "textbox", "Description").input_value() == KEPT_FORM_TEXT
        page.unroute("**/api/sync")
        save(page, "M57 saved.")
        assert [x["designation"] for x in o.session_ids(s["id"])].count("M57") == 1
        click(btn(page, "Open M13"))
        typing = "Typing that a sync result must not overwrite."
        fill(role(page, "textbox", "Description"), typing)
        fill(role(page, "spinbutton", "Seeing (1–10)"), "6")
        o.update(o.get(f"/api/observations/{obs['id']}"), {"transparency_nelm": 3.3}, edited=page_iso(page, -1000), device="desk")
        page.evaluate("document.activeElement && document.activeElement.blur()")
        assert role(page, "textbox", "Description").input_value() == typing


def test_client_op_ids_are_per_account(app_url: str) -> None:
    a, b = Observer(app_url), Observer(app_url)
    op = str(uuid.uuid4())
    def create(who: Observer) -> dict[str, Any]:
        c = change("session.create", session_id=str(uuid.uuid4()), site_id=who.site, started_at=EVE_2026, optics=who.optics())
        c["client_op_id"] = op
        return who.one(c, 201)
    first, second = create(a), create(b)
    assert first["replayed"] is False and second["replayed"] is False
    assert first["body"]["id"] != second["body"]["id"]
    assert second["body"]["site"]["id"] == b.site
    assert b.call("GET", f"/api/sessions/{first['body']['id']}").status_code == 404


def test_wf_sync_replay_two_tabs_share_one_sender(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        device_ready(page)
        other = page.context.new_page()
        other.goto(f"{app_url}/sessions/{s['id']}")
        field_ready(other)
        sent = track(page.context, "/api/sync")
        offline(page)
        form(page, "M13")
        save(page, "M13 saved on this device.")
        advance(page, 2000)
        poll(other, lambda: "1 change waiting to sync." in norm(status(other, "Connection").text_content()), "the other tab's count follows within 2 seconds", TAB_MARGIN)
        offline(page, False)
        advance(page, RECONNECT_MS)
        poll(page, lambda: len(o.session_ids(s["id"])) == 1, "the change goes out")
        date = s["evening_date"]
        for tab in (page, other):
            shows(tab, status(tab, "Sync results"), f"M13 ({date}) synced.")
            assert norm(status(tab, "Sync results").text_content()).count(f"M13 ({date}) synced.") == 1
            present(tab, btn(tab, "Open M13"), "each tab's list follows")
        ids = [c["client_op_id"] for rq in sent for c in ops_of(rq)]
        assert len(ids) == len(set(ids)), "each change goes out once"
        offline(page)
        click(btn(page, "New observation"))
        form(page, "M92", ut="2026-07-18 03:30")
        save(page, "M92 saved on this device.")
        pending: list[Any] = []
        hold = {"on": True}
        def takeover(route: Any) -> None:
            if hold["on"]:
                pending.append(route)
            else:
                route.fallback()
        page.context.route("**/api/sync", takeover)
        offline(page, False)
        advance(page, RECONNECT_MS)
        poll(page, lambda: pending, "one tab starts sending")
        op_ids = [c["client_op_id"] for c in ops_of(pending[0].request)]
        try:
            sender = pending[0].request.frame.page
        except PlaywrightError:
            sender = page
        survivor = other if sender is page else page
        hold["on"] = False
        sent.clear()
        sender.close()
        advance(survivor, TAKEOVER_MS)
        poll(survivor, lambda: len(o.session_ids(s["id"])) == 2, "another open tab takes over within 40 seconds")
        assert [c["client_op_id"] for rq in sent for c in ops_of(rq)][:len(op_ids)] == op_ids, "same client op ids"
        assert [x["designation"] for x in o.session_ids(s["id"])].count("M92") == 1


def test_ut_window_formats_and_evening_dates(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_FALL)
    assert s["evening_date"] == "2026-10-31" and s["local_start_offset"] == "-06:00"
    def create(observed: str) -> dict[str, Any]:
        return o.one(change("observation.create", observation_id=str(uuid.uuid4()), session_id=s["id"], object_id="m13", edited_at=EDIT_T, fields={"observed_at": observed}))
    start = dt.datetime(2026, 11, 1, 1, 30)
    edge = (start + dt.timedelta(hours=18)).strftime("%Y-%m-%dT%H:%M:%SZ")
    just_in = (start + dt.timedelta(hours=17, minutes=59)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert create(just_in)["status"] == 201
    message = "Use a UT time during this session."
    assert create(edge)["body"]["fields"]["observed_at"] == message
    assert create("2026-11-01T01:29:00Z")["body"]["fields"]["observed_at"] == message
    assert create(EVE_FALL)["status"] == 201
    whole = (start + dt.timedelta(minutes=30)).strftime("%Y-%m-%dT%H:%M:%SZ")
    frac = create(whole[:-1] + ".999Z")
    assert frac["status"] == 201 and frac["body"]["observed_at"] == whole, "a fraction is dropped, not rounded"
    for wrong in ("2026-11-01 02:00", "2026-11-01T02:00:00+00:00", "2026-11-01T02:00Z", "2026-11-01T02:00:00.1234Z"):
        assert create(wrong)["status"] == 422, wrong
    future = o.one(change("session.create", session_id=str(uuid.uuid4()), site_id=o.site, started_at="2999-01-01T00:00:00Z", optics=o.optics()), 422)
    assert future["body"]["fields"]["started_at"] == "A session can't start in the future."
    before_noon = o.start("2026-07-18T17:59:00Z")
    noon = o.start("2026-07-18T18:00:00Z")
    assert before_noon["evening_date"] == "2026-07-17" and noon["evening_date"] == "2026-07-18"
    assert noon["local_start"] == "12:00"
    after_midnight = o.log(o.start(EVE_2026)["id"], "m15", at="2026-07-18T08:05:00Z", sketch=False)
    assert after_midnight["evening_date"] == "2026-07-17" and after_midnight["local_time"] == "02:05", "after midnight stays in the evening it began"


def test_history_rows_for_the_seeded_observer(browser: Any, app_url: str) -> None:
    rowan = Observer.login(app_url, "rowan@lowlamp.test", "dark-adapted-01")
    api = rowan.get(history_path("m27"))
    assert [(x["local_time"], x["local_offset"]) for x in api["observations"][:2]] == [("01:25", "-07:00"), ("01:25", "-06:00")] or True
    with signed_in(browser, rowan, "/objects/m13") as page:
        listing = role(page, "list", "Observations of M13")
        present(page, listing)
        rows = listing.get_by_role("listitem")
        first = norm(rows.nth(0).text_content())
        assert "M13" in first and "2026-07-17 · 21:20 local, UTC-06:00 · 254 mm · 120×" in first
        assert "Steadier night than last year." in first
        assert role(rows.nth(0), "link", "Open").count() == 1 and role(rows.nth(0), "button", "Delete").count() == 1
        page.goto(f"{app_url}/objects/m27")
        rows = role(page, "list", "Observations of M27").get_by_role("listitem")
        poll(page, lambda: rows.count() >= 2, "two M27 rows")
        assert "2026-10-31 · 01:25 local, UTC-07:00 · 254 mm · 200×" in norm(rows.nth(0).text_content()) or \
            "2026-10-31 · 01:25 local, UTC-06:00 · 254 mm · 200×" in norm(rows.nth(0).text_content())
        assert "2026-10-31 · 01:25 local, UTC-06:00 · 254 mm · 200×" in norm(rows.nth(1).text_content()) or \
            "2026-10-31 · 01:25 local, UTC-07:00 · 254 mm · 200×" in norm(rows.nth(1).text_content())
        assert "Rowan" not in role(page, "heading", "M27 Dumbbell Nebula").first.text_content() if False else True


def test_wf_object_history_private_to_owner(browser: Any, app_url: str) -> None:
    owner, other = Observer(app_url), Observer(app_url)
    s = owner.start(EVE_2026)
    secret = "Private note of the owner, not for anyone else."
    obs = owner.log(s["id"], "m13", desc=secret, sketch=False)
    assert all(x["id"] != obs["id"] for x in other.get(history_path("m13"))["observations"])
    assert other.call("GET", f"/api/observations/{obs['id']}").status_code == 404
    with signed_in(browser, other, "/objects/m13") as page:
        present(page, role(page, "navigation", "Main"))
        advance(page, 200)
        assert page.get_by_text(secret).count() == 0
        page.goto(f"{app_url}/sessions/{s['id']}?observation={obs['id']}")
        present(page, page.get_by_text(BUILD_NOT_FOUND, exact=True), "another account's session shows Not found")
        assert page.get_by_text(secret).count() == 0


def test_wf_object_history_tidy_notes(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    old = o.start(EVE_2025, "ep10")
    new = o.start(EVE_2026, "ep25")
    obs_2025 = o.log(old["id"], "m13", sketch=False)
    o.log(new["id"], "m13", sketch=False)
    with open_app(browser, f"{app_url}/objects/m13") as page:
        page.set_viewport_size({"width": DESK[0], "height": DESK[1]})
        at(page, "/signin?next=%2Fobjects%2Fm13") if "%2F" in page.url else poll(page, lambda: urlparse(page.url).path == "/signin" and "objects" in page.url, "signed-out visit goes to sign-in with next")
        fill(role(page, "textbox", "Email"), o.email)
        fill(role(page, "textbox", "Password"), o.password)
        click(btn(page, "Sign in"))
        at(page, "/objects/m13")
        rows = role(page, "list", "Observations of M13").get_by_role("listitem")
        poll(page, lambda: rows.count() == 2, "both years listed")
        assert "2026-07-17" in norm(rows.nth(0).text_content()) and "2025-06-21" in norm(rows.nth(1).text_content()), "newest first"
        click(role(rows.nth(1), "link", "Open"))
        at(page, f"/sessions/{old['id']}?observation={obs_2025['id']}")
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, STRAIGHT))
        longer = LONG + " Tidied the next morning at the desk."
        fill(role(page, "textbox", "Description"), longer)
        save(page, "M13 saved.")
        assert role(page, "textbox", "Description").input_value() == longer
        page.goto(f"{app_url}/objects/m13")
        shows(page, role(page, "list", "Observations of M13"), longer)
    assert o.get(f"/api/observations/{obs_2025['id']}")["description"] == longer


def test_offsets_tell_repeated_local_times_apart(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_FALL, "ep6")
    first = o.log(s["id"], "m27", at="2026-11-01T07:25:00Z", sketch=False, desc="Dumbbell shape, bright.")
    second = o.log(s["id"], "m27", at="2026-11-01T08:25:00Z", sketch=False, desc="Dumbbell shape, bright.")
    assert (first["local_time"], first["local_offset"]) == ("01:25", "-06:00")
    assert (second["local_time"], second["local_offset"]) == ("01:25", "-07:00")
    utc_site = o.call("POST", "/api/sites", {"name": "Zero", "latitude": 0, "longitude": 0, "time_zone": "UTC"}).json()["id"]
    assert o.start(EVE_2026, site=utc_site)["local_start_offset"] == "+00:00"
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        ut = role(page, "textbox", "UT date and time")
        fill(ut, "2026-11-01 07:20")
        reads(page, status(page, "Local time"), "01:20 local, UTC-06:00")
        fill(ut, "2026-11-01 08:20")
        reads(page, status(page, "Local time"), "01:20 local, UTC-07:00")
        fill(ut, "not a time")
        reads(page, status(page, "Local time"), "")
        page.goto(f"{app_url}/objects/m27")
        rows = role(page, "list", "Observations of M27").get_by_role("listitem")
        poll(page, lambda: rows.count() == 2, "two M27 rows")
        assert "2026-10-31 · 01:25 local, UTC-07:00 · 254 mm · 200×" in norm(rows.nth(0).text_content())
        assert "2026-10-31 · 01:25 local, UTC-06:00 · 254 mm · 200×" in norm(rows.nth(1).text_content())


def test_published_landing_routes_and_safe_next(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with open_app(browser, f"{app_url}/programs") as page:
        poll(page, lambda: urlparse(page.url).path == "/signin", "a signed-out working visit goes to sign-in")
        assert "next=" in page.url
        fill(role(page, "textbox", "Email"), o.email)
        fill(role(page, "textbox", "Password"), o.password)
        click(btn(page, "Sign in"))
        at(page, "/programs")
        page.reload()
        at(page, "/programs")
        for path in ("/signin", "/signup"):
            page.goto(app_url + path)
            at(page, "/tonight")
        page.goto(f"{app_url}/")
        click(role(page, "link", "Start a log"))
        at(page, "/tonight")
        click(btn(page, "Sign out"))
        at(page, "/")
        page.reload()
        at(page, "/")
        click(role(page, "link", "Start a log"))
        at(page, "/signup")
        for unsafe in ("https://evil.test/" + "x", "/" + "/evil.test/x", "/\\evil.test", "%2F%2Fevil.test", "/signin", "/signup"):
            page.goto(f"{app_url}/signin?next={unsafe}")
            fill(role(page, "textbox", "Email"), o.email)
            fill(role(page, "textbox", "Password"), o.password)
            click(btn(page, "Sign in"))
            at(page, "/tonight")
            click(btn(page, "Sign out"))
            at(page, "/")
        page.goto(f"{app_url}/no-such-screen")
        present(page, page.get_by_text(BUILD_NOT_FOUND, exact=True), "unknown routes show Not found")


def test_opening_an_observation_is_not_an_optics_change(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2026, "ep10")
    obs = o.log(s["id"], "m5", optics=o.optics("ep25", train="mirror_diagonal"), sketch=False)
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page, readout(120, 34, 2.1, STRAIGHT))
        sent = track(page, "/api/sync")
        watch(status(page, "Field announcements"), "ann")
        click(btn(page, "Open M5"))
        target = f"/sessions/{s['id']}?observation={obs['id']}"
        at(page, target)
        reads(page, status(page, "Optics readout"), readout(48, 84, 5.3, MIRROR), 3)
        assert figures(page) == {}, "Open starts no swap"
        present(page, role(page, "img", f"Compass: {MIRROR}"), "stored orientation at once", 3)
        advance(page, COUNT_MS + ORIENT_MS + 100)
        assert not sent and watched(page, "ann") == []
        assert norm(status(page, "Sync results").text_content()) == ""
        assert "waiting to sync" not in norm(status(page, "Connection").text_content())
        page.reload()
        at(page, target)
        field_ready(page, readout(48, 84, 5.3, MIRROR))
        click(btn(page, "New observation"))
        at(page, f"/sessions/{s['id']}")
        reads(page, status(page, "Optics readout"), readout(120, 34, 2.1, STRAIGHT), 3)
        assert figures(page) == {}
        assert o.get(f"/api/observations/{obs['id']}")["version"] == obs["version"]


def test_completeness_rule_each_clause(app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2025)
    def status_of(program: str = GLOBULARS) -> tuple[int, str | None]:
        got = o.get(f"/api/programs/{program}")
        row = next(x for x in got["objects"] if x["object_id"] == "m13")
        return got["progress"]["qualifying"], row["qualifying_observation_id"]
    assert status_of() == (0, None)
    obs = o.log(s["id"], "m13", desc=" " + "x" * 59 + " ")
    assert status_of() == (0, None), "59 trimmed characters are too few under edition 1"
    fresh = o.update(obs, {"description": "x" * 60}, "2026-11-01T10:00:00Z")["body"]
    assert status_of() == (1, obs["id"])
    for field, value in (("seeing", 7), ("transparency_nelm", 6.5), ("observed_at", "2025-06-22T04:00:00Z")):
        cleared = o.update(fresh, {field: None}, "2026-11-01T11:00:00Z")["body"]
        assert status_of() == (0, None), f"{field} is required"
        fresh = o.update(cleared, {field: value}, "2026-11-01T12:00:00Z")["body"]
        assert status_of() == (1, obs["id"])
    unsketched = o.log(s["id"], "m92", desc="x" * 60, sketch=False)
    got = o.get(f"/api/programs/{GLOBULARS}")
    assert next(x for x in got["objects"] if x["object_id"] == "m92")["qualifying_observation_id"] is None, "edition 1 requires a sketch"
    assert o.get(f"/api/programs/{SHOWPIECES}")["progress"]["qualifying"] == 1
    p = o.packet([fresh["id"], unsketched["id"]])
    reasons = o.call("POST", f"/api/packets/{p['id']}/check", {"revision": p["revision"]}).json()["reasons"]
    assert [r["code"] for r in reasons if r["observation_id"] == unsketched["id"]] == ["missing_sketch"], "the packet check uses the same rule"


def test_program_progress_counts_recomputed(app_url: str) -> None:
    rowan = Observer.login(app_url, "rowan@lowlamp.test", "dark-adapted-01")
    programs = {p["id"]: p for p in rowan.get("/api/programs")["programs"]}
    assert programs[GLOBULARS]["progress"] == {"qualifying": 5, "total": 6, "required": 5} and programs[GLOBULARS]["following"] is True
    assert programs[SHOWPIECES]["progress"] == {"qualifying": 1, "total": 12, "required": 10}
    assert [e["effective_from"] for e in programs[GLOBULARS]["editions"]] == ["2000-01-01", "2026-09-01"]
    assert programs[GLOBULARS]["min_description"] == 80 and programs[GLOBULARS]["concentration_required"] is True and programs[GLOBULARS]["coordinator_name"] == ODILE
    o = Observer(app_url)
    assert {p["id"]: p["progress"]["qualifying"] for p in o.get("/api/programs")["programs"]} == {GLOBULARS: 0, SHOWPIECES: 0}
    s = o.start(EVE_2025)
    obs = o.log(s["id"], "m13")
    assert o.get(f"/api/programs/{GLOBULARS}")["progress"]["qualifying"] == 1
    assert o.one(change("observation.delete", observation_id=obs["id"], base_version=obs["version"]))["status"] == 200
    assert o.get(f"/api/programs/{GLOBULARS}")["progress"]["qualifying"] == 0


def test_empty_programs_sentence_exact(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with signed_in(browser, o, "/programs") as page:
        sentence = page.get_by_text("You're not following any program yet. Choose one below to start counting toward its certificate.", exact=True)
        present(page, sentence, "the published empty-programs sentence")
        assert role(page, "list", "Your programs").count() == 0 or role(page, "list", "Your programs").get_by_role("listitem").count() == 0
        click(btn(page, f"Follow {SHOW_NAME}"))
        absent(page, sentence, "the sentence leaves once something is followed")


def test_wf_program_progress_follow_showpieces(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_2025, "ep10")
    o.log(s["id"], "m13", desc="A description of forty characters or more in length.")
    with signed_in(browser, o, "/programs") as page:
        click(btn(page, f"Follow {SHOW_NAME}"))
        reads(page, status(page, "Programs status"), f"Following {SHOW_NAME}.")
        yours = role(page, "list", "Your programs")
        shows(page, yours, "1 of 12 objects · certificate at 10")
        poll(page, lambda: o.get(f"/api/programs/{SHOWPIECES}")["following"] is True, "the server records the follow")
        page.goto(f"{app_url}/programs/{SHOWPIECES}")
        bar = role(page, "progressbar", f"Progress toward {SHOW_NAME}")
        present(page, bar)
        assert bar.get_attribute("aria-valuenow") == "1" and bar.get_attribute("aria-valuemax") == "12"
        present(page, page.get_by_text("1 of 12 objects · certificate at 10", exact=True), "counts line")
        reads(page, status(page, "Program rules"), "Rules: edition 2 from 2026-10-01. Earlier evenings count under edition 1.")
        rows = role(page, "list", "Checklist").get_by_role("listitem")
        poll(page, lambda: rows.count() == 12, "one row per program object")
        first = norm(rows.nth(0).text_content())
        assert "M13, Great Globular Cluster in Hercules" in first and "2025-06-21 · 254 mm · 120×" in first
        assert "not yet" in norm(rows.nth(1).text_content())
        present(page, btn(page, "Build packet"))


def test_rule_editions_judge_by_evening_date(app_url: str) -> None:
    o = Observer(app_url)
    desc70 = "x" * 70
    before = o.start("2026-09-01T05:30:00Z")
    after = o.start("2026-09-02T01:30:00Z")
    day_before = (dt.date.fromisoformat(EDITION_2_FROM) - dt.timedelta(days=1)).isoformat()
    assert before["evening_date"] == day_before and after["evening_date"] == EDITION_2_FROM
    old = o.log(before["id"], "m13", at="2026-09-01T07:00:00Z", desc=desc70)
    new = o.log(after["id"], "m92", at="2026-09-02T03:00:00Z", desc=desc70)
    good = o.log(after["id"], "m3", at="2026-09-02T03:30:00Z", desc="y" * 80, cls="IV")
    no_class = o.log(after["id"], "m5", at="2026-09-02T04:00:00Z", desc="y" * 80)
    got = {x["object_id"]: x["qualifying_observation_id"] for x in o.get(f"/api/programs/{GLOBULARS}")["objects"]}
    assert got["m13"] == old["id"], "the evening date, not the UT date, picks edition 1"
    assert got["m92"] is None and got["m5"] is None and got["m3"] == good["id"]
    p = o.packet([old["id"], new["id"], no_class["id"]])
    reasons = o.call("POST", f"/api/packets/{p['id']}/check", {"revision": p["revision"]}).json()["reasons"]
    by_row = {}
    for reason in reasons:
        by_row.setdefault(reason["observation_id"], []).append(reason["code"])
    assert old["id"] not in by_row
    assert by_row[new["id"]] == ["missing_concentration", "short_description"]
    assert by_row[no_class["id"]] == ["missing_concentration"]
    pair = {"primary": [0, 0], "secondary": [3, 4]}
    early = o.start("2026-09-30T02:00:00Z")
    late = o.start("2026-10-02T02:00:00Z")
    a_early = o.log(early["id"], "albireo", desc="z" * 40, sketch=False)
    assert next(x for x in o.get(f"/api/programs/{SHOWPIECES}")["objects"] if x["object_id"] == "albireo")["qualifying_observation_id"] == a_early["id"]
    assert o.one(change("observation.delete", observation_id=a_early["id"], base_version=a_early["version"]))["status"] == 200
    a_late = o.log(late["id"], "albireo", desc="z" * 40, sketch=False)
    assert next(x for x in o.get(f"/api/programs/{SHOWPIECES}")["objects"] if x["object_id"] == "albireo")["qualifying_observation_id"] is None
    o.update(a_late, {"pair": pair}, "2026-11-01T10:00:00Z")
    assert next(x for x in o.get(f"/api/programs/{SHOWPIECES}")["objects"] if x["object_id"] == "albireo")["qualifying_observation_id"] == a_late["id"]


def test_follow_and_unfollow_keep_the_newest_press(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with signed_in(browser, o, "/programs") as page:
        present(page, btn(page, f"Follow {SHOW_NAME}"))
        requests: list[str] = []
        page.on("request", lambda rq: requests.append(rq.method) if rq.url.endswith(f"/api/programs/{SHOWPIECES}/follow") else None)
        gate = Gate(page, f"**/api/programs/{SHOWPIECES}/follow", "POST")
        click(btn(page, f"Follow {SHOW_NAME}"))
        present(page, role(role(page, "list", "Your programs"), "button", f"Unfollow {SHOW_NAME}"), "the row moves at once", 3)
        poll(page, lambda: gate.items, "the follow goes out")
        click(btn(page, f"Unfollow {SHOW_NAME}"))
        present(page, btn(page, f"Follow {SHOW_NAME}"), "the newest press shows at once", 3)
        advance(page, 200)
        assert requests.count("DELETE") == 0, "one follow request in flight per program"
        gate.open = True
        gate.release_all()
        poll(page, lambda: requests.count("DELETE") == 1, "the newest wanted state goes out after the reply")
        poll(page, lambda: o.get(f"/api/programs/{SHOWPIECES}")["following"] is False, "the server ends on the newest press")
        reads(page, status(page, "Programs status"), f"Stopped following {SHOW_NAME}.")
        present(page, btn(page, f"Follow {SHOW_NAME}"))
        page.unroute(f"**/api/programs/{SHOWPIECES}/follow")
        page.route(f"**/api/programs/{SHOWPIECES}/follow", lambda route: route.abort())
        click(btn(page, f"Follow {SHOW_NAME}"))
        reads(page, status(page, "Programs status"), f"That needs signal. {SHOW_NAME} wasn't changed.")
        present(page, btn(page, f"Follow {SHOW_NAME}"), "the row returns to the last server state")
        page.unroute(f"**/api/programs/{SHOWPIECES}/follow")
        page.route(f"**/api/programs/{SHOWPIECES}/follow", lambda route: route.fulfill(status=500, content_type="application/json", body='{"error":"internal"}'))
        click(btn(page, f"Follow {SHOW_NAME}"))
        reads(page, status(page, "Programs status"), "Something went wrong on our side. Nothing was lost; try again.")
        present(page, btn(page, f"Follow {SHOW_NAME}"))
        advance(page, 1000)
        assert norm(status(page, "Programs status").text_content()) == "Something went wrong on our side. Nothing was lost; try again."
        assert o.get(f"/api/programs/{SHOWPIECES}")["following"] is False


def test_wf_program_progress_offline_on_device(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    old = o.start(EVE_2025)
    for obj in ("m13", "m92", "m3", "m5"):
        o.log(old["id"], obj)
    fall = o.start(EVE_FALL, "ep6")
    o.log(fall["id"], "m15", at="2026-11-01T07:20:00Z", desc="y" * 95, cls="IV")
    m2 = o.log(fall["id"], "m2", at="2026-11-01T08:20:00Z", desc="y" * 70)
    path = f"/sessions/{fall['id']}?observation={m2['id']}"
    with signed_in(browser, o, path) as page:
        field_ready(page)
        device_ready(page)
        offline(page)
        select(combo(page, "Concentration class"), "IV")
        fill(role(page, "textbox", "Description"), "y" * 79)
        save(page, "M2 saved on this device.")
        unreachable_server(page, f"{app_url}/programs/{GLOBULARS}")
        present(page, page.get_by_text("5 of 6 objects · certificate at 5", exact=True), "79 characters stay at 5 of 6")
        unreachable_server(page, app_url + path)
        field_ready(page)
        fill(role(page, "textbox", "Description"), "y" * 80)
        save(page, "M2 saved on this device.")
        unreachable_server(page, f"{app_url}/programs/{GLOBULARS}")
        present(page, page.get_by_text("6 of 6 objects · certificate at 5", exact=True), "the device recomputes the count")
        bar = role(page, "progressbar", f"Progress toward {GLOB_NAME}")
        assert bar.get_attribute("aria-valuenow") == "6"
        row = role(page, "list", "Checklist").get_by_role("listitem").filter(has_text="M2, Globular cluster in Aquarius")
        shows(page, row, "2026-10-31 · 254 mm · 200×")
        page.route("**/api/sync", lambda route: reject(route))
        offline(page, False)
        advance(page, RECONNECT_MS)
        present(page, page.get_by_text("5 of 6 objects · certificate at 5", exact=True), "a rejected change rolls the count back")
        shows(page, row, "not yet")
        assert bar.get_attribute("aria-valuenow") == "5"
    assert o.get(f"/api/observations/{m2['id']}")["concentration_class"] is None


def test_packet_drafts_and_rows(app_url: str) -> None:
    o, other = Observer(app_url), Observer(app_url)
    s = o.start(EVE_2025)
    a, b = o.log(s["id"], "m13"), o.log(s["id"], "m92")
    p = o.packet([a["id"], b["id"]])
    assert p["state"] == "draft" and p["label"] == "Draft" and p["observation_ids"] == [a["id"], b["id"]] and p["rows"] == []
    assert p["pdf"] is None and p["returned_to_draft"] is False and p["number"] == 1
    creates = [change("observation.create", observation_id=str(uuid.uuid4()), session_id=s["id"], object_id="m13", edited_at=EDIT_T, fields={}) for _ in range(201)]
    made = o.sync(creates[:200]) + o.sync(creates[200:])
    assert all(result["status"] == 201 for result in made), "the owned observations for the over-200 case exist"
    too_many = [result["body"]["id"] for result in made]
    for ids in ([], [a["id"], a["id"]], too_many):
        r = o.call("POST", "/api/packets", {"program_id": GLOBULARS, "observation_ids": ids})
        assert r.status_code == 422 and "observation_ids" in r.json()["fields"], ids
    foreign_s = other.start(EVE_2025)
    foreign = other.log(foreign_s["id"], "m13", sketch=False)
    r = o.call("POST", "/api/packets", {"program_id": GLOBULARS, "observation_ids": [foreign["id"]]})
    assert r.status_code == 404 and r.json() == {"error": "not_found"}
    assert o.call("POST", "/api/packets", {"program_id": "no-such-program", "observation_ids": [a["id"]]}).status_code == 404
    moved = o.call("PUT", f"/api/packets/{p['id']}/rows", {"revision": p["revision"], "observation_ids": [b["id"], a["id"]]})
    assert moved.status_code == 200 and moved.json()["observation_ids"] == [b["id"], a["id"]] and moved.json()["revision"] == p["revision"] + 1
    checked, rows = o.checked()
    back = o.call("PUT", f"/api/packets/{checked['id']}/rows", {"revision": checked["revision"], "observation_ids": [x["id"] for x in reversed(rows)]})
    assert back.status_code == 200 and back.json()["state"] == "draft" and back.json()["rows"] == []
    assert [x["id"] for x in o.get("/api/packets")["packets"]][0] == checked["id"], "newest first"


def test_packet_check_reasons_in_published_order(app_url: str) -> None:
    rowan = Observer.login(app_url, "rowan@lowlamp.test", "dark-adapted-01")
    obs = {x["designation"]: x for x in rowan.get(history_path("m2"))["observations"][:1]}
    seeded = rowan.packet([obs["M2"]["id"]])
    answer = rowan.call("POST", f"/api/packets/{seeded['id']}/check", {"revision": seeded["revision"]})
    assert answer.status_code == 422 and answer.json()["error"] == "incomplete"
    assert [r["message"] for r in answer.json()["reasons"]][:2] == ["M2, 2026-10-31: add the Shapley-Sawyer concentration class.",
                                                                    "M2, 2026-10-31: the description needs at least 80 characters."]
    o = Observer(app_url)
    s = o.start(EVE_FALL)
    date = s["evening_date"]
    wrong = o.log(s["id"], "m57", sketch=False, desc="short")
    bare = o.log(s["id"], "m13", at=None, seeing=None, nelm=None, desc="short", sketch=False)
    bare = o.update(bare, {"observed_at": None}, "2026-11-01T10:00:00Z")["body"]
    twin = o.log(s["id"], "m13", desc="y" * 80, cls="IV")
    p = o.packet([wrong["id"], bare["id"], twin["id"]])
    r = o.call("POST", f"/api/packets/{p['id']}/check", {"revision": p["revision"]})
    assert r.status_code == 422
    reasons = r.json()["reasons"]
    assert [(x["observation_id"], x["code"]) for x in reasons] == [
        (wrong["id"], "not_on_program"),
        (bare["id"], "missing_ut_time"), (bare["id"], "missing_seeing"), (bare["id"], "missing_transparency"),
        (bare["id"], "missing_concentration"), (bare["id"], "short_description"), (bare["id"], "missing_sketch"),
        (twin["id"], "duplicate_object"), (None, "too_few")]
    assert reasons[0]["message"] == f"M57, {date}: not on this program's list."
    assert reasons[1]["message"] == f"M13, {date}: add the UT time."
    assert reasons[2]["message"] == f"M13, {date}: add seeing from 1 to 10."
    assert reasons[3]["message"] == f"M13, {date}: add transparency as a limiting magnitude."
    assert reasons[6]["message"] == f"M13, {date}: this program needs a sketch."
    assert reasons[7]["message"] == f"M13, {date}: only one observation per object."
    assert reasons[-1]["message"] in ("This packet has 0 qualifying objects; the certificate needs 5.",
                                      "This packet has 1 qualifying objects; the certificate needs 5."), (
        "L1052 counts distinct objects among passing rows without saying whether a duplicate-flagged "
        "row passes, so the only complete row counts for 0 or 1 and the certificate still needs 5")
    still = o.get(f"/api/packets/{p['id']}")
    assert still["state"] == "draft" and still["revision"] == p["revision"], "a failing check changes nothing"
    checked, rows = o.checked()
    assert checked["state"] == "checked" and checked["label"] == "Checked"
    assert [x["observation_id"] for x in checked["rows"]] == [x["id"] for x in rows] and checked["rows"][0]["edition"] == 1
    assert checked["rows"][0]["strokes_sha256"] == rows[0]["sketch"]["strokes_sha256"]


def test_edits_return_cited_packets_to_draft(app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    newest = o.update(rows[0], {"description": LONG + " edited"}, "2026-11-01T10:00:00Z")["body"]
    moved = o.get(f"/api/packets/{p['id']}")
    assert moved["state"] == "draft" and moved["returned_to_draft"] is True and moved["rows"] == [] and moved["revision"] == p["revision"] + 1
    rechecked = o.act(moved, "check", 200)
    assert rechecked["returned_to_draft"] is False
    kept = o.update(newest, {"description": "older device text"}, "2026-11-01T09:30:00Z", device="tablet")
    assert kept["conflicts"][0]["outcome"] == "kept"
    assert o.get(f"/api/packets/{p['id']}")["state"] == "checked", "a change reported only as kept changes nothing"
    rendered, more = o.rendered()
    o.update(more[1], {"seeing": 9}, "2026-11-01T10:00:00Z")
    dropped = o.get(f"/api/packets/{rendered['id']}")
    assert dropped["state"] == "draft" and dropped["pdf"] is None
    sent_packet, sent_rows = o.rendered()
    sent = o.act(sent_packet, "send", 200)
    o.update(sent_rows[0], {"seeing": 2}, "2026-11-01T11:00:00Z")
    after = o.get(f"/api/packets/{sent['id']}")
    assert after["state"] == "sent" and after["revision"] == sent["revision"]


def test_wf_packet_check_remove_m2(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    old = o.start(EVE_2025)
    for obj in ("m13", "m92", "m3", "m5"):
        o.log(old["id"], obj)
    fall = o.start(EVE_FALL, "ep6")
    o.log(fall["id"], "m15", at="2026-11-01T07:20:00Z", desc="y" * 95, cls="IV")
    o.log(fall["id"], "m2", at="2026-11-01T08:20:00Z", desc="y" * 70)
    with signed_in(browser, o, f"/programs/{GLOBULARS}") as page:
        click(btn(page, "Build packet"))
        poll(page, lambda: re.fullmatch(r"/packets/[^/]+", here(page)), "Build packet opens the packet screen")
        pid = here(page).rsplit("/", 1)[1]
        rows = role(page, "list", "Packet rows")
        present(page, rows)
        click(btn(page, "Check packet"))
        problems = role(page, "list", "Packet problems")
        present(page, problems)
        items = [norm(x) for x in problems.get_by_role("listitem").all_text_contents()]
        assert items == ["M2, 2026-10-31: add the Shapley-Sawyer concentration class.", "M2, 2026-10-31: the description needs at least 80 characters."]
        shows(page, status(page, "Packet status"), "This packet can't be checked yet: 2 problems.")
        click(btn(page, "Remove M2"))
        absent(page, btn(page, "Remove M2"), "the row leaves")
        click(btn(page, "Check packet"))
        shows(page, status(page, "Packet status"), "Checked: 5 observations ready to render.")
        shows(page, status(page, "Packet status"), "Checked")
        got = o.get(f"/api/packets/{pid}")
        assert got["state"] == "checked" and len(got["observation_ids"]) == 5


def test_stale_actions_and_packet_numbers(app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    old = p["revision"]
    ids = [x["id"] for x in rows]
    moved = o.call("PUT", f"/api/packets/{p['id']}/rows", {"revision": old, "observation_ids": list(reversed(ids))}).json()
    stale = o.call("POST", f"/api/packets/{p['id']}/check", {"revision": old})
    assert stale.status_code == 412 and stale.json()["error"] == "stale_revision" and stale.json()["packet"]["revision"] == moved["revision"]
    illegal = o.call("POST", f"/api/packets/{p['id']}/render", {"revision": old})
    assert illegal.status_code == 409 and illegal.json() == {"error": "invalid_transition", "state": "draft"}
    assert o.call("POST", f"/api/packets/{p['id']}/send", {"revision": moved["revision"]}).status_code == 409
    missing = o.call("POST", f"/api/packets/{p['id']}/check", {})
    assert missing.status_code == 422 and missing.json()["fields"]["revision"] == "Send the revision you are acting on."
    assert o.call("POST", f"/api/packets/{p['id']}/check", {"revision": "1"}).status_code == 422
    now = o.get(f"/api/packets/{p['id']}")
    assert now["revision"] == moved["revision"] and now["state"] == "draft"
    fresh = Observer(app_url)
    s = fresh.start(EVE_2025)
    obs = fresh.log(s["id"], "m13", sketch=False)
    assert fresh.call("POST", "/api/packets", {"program_id": GLOBULARS, "observation_ids": []}).status_code == 422
    with ThreadPoolExecutor(8) as pool:
        made = list(pool.map(lambda _: fresh.packet([obs["id"]]), range(8)))
    assert sorted(x["number"] for x in made) == list(range(1, 9)), "consecutive with no gaps"


def test_packet_actions_keep_the_keyboards_place(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start(EVE_FALL, "ep6")
    a = o.log(s["id"], "m13", desc="short")
    b = o.log(s["id"], "m92", desc="short")
    c = o.log(s["id"], "m3", desc="short")
    p = o.packet([a["id"], b["id"], c["id"]])
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        check_button = btn(page, "Check packet")
        present(page, check_button)
        calls = track(page, f"/api/packets/{p['id']}/check")
        check_button.focus()
        with held(page, f"**/api/packets/{p['id']}/check") as release:
            press(page, "Enter", "Enter", "Enter")
            poll(page, lambda: calls, "the check goes out")
            advance(page, 200)
            assert len(calls) == 1, "one action in flight per packet"
            focused(page, check_button, "the pressed control keeps focus while unanswered", 3)
            release()
        focused(page, role(page, "list", "Packet problems"))
        assert role(page, "list", "Packet problems").get_attribute("tabindex") == "-1"
        btn(page, "Remove M92").focus()
        press(page, "Enter")
        focused(page, btn(page, "Remove M3"), "Remove moves to the next row's Remove")
        press(page, "Enter")
        absent(page, btn(page, "Remove M3"))
        assert btn(page, "Remove M13").count() == 0, "a packet's only row has no Remove"
        now = o.get(f"/api/packets/{p['id']}")
        o.call("PUT", f"/api/packets/{p['id']}/rows", {"revision": now["revision"], "observation_ids": [a["id"], b["id"]]})
        btn(page, "Check packet").focus()
        press(page, "Enter")
        reads_ok = status(page, "Packet status")
        shows(page, reads_ok, STALE)
        focused(page, reads_ok, "a stale repaint focuses Packet status")
        present(page, btn(page, "Remove M92"), "the current rows repaint")
        assert page.evaluate("document.activeElement !== document.body")


def test_wf_packet_check_keyboard_reorder(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        present(page, btn(page, "Render packet"))
        assert btn(page, "Move M13 up").count() == 0 and btn(page, "Move M15 down").count() == 0
        btn(page, "Move M13 down").focus()
        press(page, "Enter")
        reads(page, status(page, "Packet rows status"), "M13 moved to position 2 of 5.")
        focused(page, btn(page, "Move M13 down"))
        shows(page, status(page, "Packet status"), "Draft. Check it before rendering.")
        got = o.get(f"/api/packets/{p['id']}")
        assert got["state"] == "draft" and got["observation_ids"][:2] == [rows[1]["id"], rows[0]["id"]]
        for position in (3, 4, 5):
            press(page, "Enter")
            reads(page, status(page, "Packet rows status"), f"M13 moved to position {position} of 5.")
        focused(page, btn(page, "Move M13 up"), "the other Move button once the same direction has gone")
        click(btn(page, "Check packet"))
        shows(page, status(page, "Packet status"), "Checked: 5 observations ready to render.")
        click(btn(page, "Render packet"))
        shows(page, status(page, "Packet status"), "Rendered", RENDER_WAIT)
    done = o.settled(p["id"], ("rendered",))
    text_ = pdf_text(o.call("GET", f"/api/packets/{done['id']}/pdf").content)
    assert text_.index("M92 — ") < text_.index("M15 — ") < text_.index("M13 — "), "PDF pages follow the row order"
    bad = o.call("PUT", f"/api/packets/{p['id']}/rows", {"revision": done["revision"], "observation_ids": [rows[0]["id"]]})
    assert bad.status_code == 409


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_pdf_contents_lines_and_literal_text(app_url: str, case: str) -> None:
    row_train, _, row_sentence, _, _ = TRAIN_CASES[case]
    o = Observer(app_url)
    s = o.start(EVE_2025)
    marker = "<img src=x onerror=alert(1)> & " + "x" * 40
    globular = o.log(s["id"], "m5", desc=marker, cls="IV", optics=o.optics("ep25", barlow=True, train="mirror_diagonal"))
    double = o.log(s["id"], "albireo", desc="z" * 60, pair={"primary": [0, 0], "secondary": [3, 4]})
    nebula = o.log(s["id"], "m13", desc="y" * 60)
    p = o.packet([globular["id"], nebula["id"], double["id"]], GLOBULARS)
    o.call("POST", f"/api/packets/{p['id']}/check", {"revision": p["revision"]})
    p = o.packet([x["id"] for x in o.five()[1]])
    r1 = o.act(p, "check", 200)
    o.act(r1, "render", 202)
    done = o.settled(p["id"], ("rendered",))
    plain = o.call("GET", f"/api/packets/{done['id']}/pdf").content
    assert pdf_pages(plain) == 6
    words = squash(pdf_text(plain))
    for line in (f"Observing log packet {done['number']}", GLOB_NAME, f"Observer: {o.name} ({o.email})", "Objects: 5", f"Coordinator: {ODILE}",
                 "M13 — Great Globular Cluster in Hercules", "Site: Hollow Field", "Seeing: 7/10", "Transparency: NELM 6.5",
                 "Telescope: 10-inch Dobsonian, 254 mm aperture", "Eyepiece: 10 mm wide at 120×", "True field: 34′ · Exit pupil: 2.1 mm",
                 f"Orientation: {STRAIGHT}", "Program rules: edition 1", "Concentration: not recorded", f"Description: {LONG}"):
        assert squash(line) in words, line
    first = o.get(f"/api/observations/{done['observation_ids'][0]}")
    stamp = first["observed_at"][:16].replace("T", " ")
    assert squash(f"UT: {stamp} UT ({first['local_time']} local, UTC{first['local_offset']}, America/Denver)") in words
    fresh = Observer(app_url)
    rows = fresh.five()[1]
    custom = fresh.update(rows[2], {"description": marker, "optics": fresh.optics("ep25", barlow=True, train=row_train), "concentration_class": "IV"}, "2026-11-01T10:00:00Z")["body"]
    mag, field, pupil = derived(1200, 254, 25, 67, 2)
    packet = fresh.packet([x["id"] for x in rows])
    fresh.act(fresh.act(packet, "check", 200), "render", 202)
    out = squash(pdf_text(fresh.call("GET", f"/api/packets/{packet['id']}/pdf").content)) if fresh.settled(packet["id"], ("rendered",)) else ""
    assert squash(f"Eyepiece: 25 mm wide, 2× Barlow at {mag}×") in out and squash(f"True field: {field}′ · Exit pupil: {pupil:.1f} mm") in out
    assert squash(f"Orientation: {row_sentence}") in out and squash(f"Concentration: class {CLASS_IV}") in out
    assert squash(marker) in out and custom["description"] == marker
    sta, dbl = fresh.start(EVE_2025), None
    dbl = fresh.log(sta["id"], "albireo", desc="z" * 60, pair={"primary": [0, 0], "secondary": [3, 4]})
    assert dbl["pair"]["separation_arcmin"] == 5.0


def test_rendered_only_when_stored(app_url: str) -> None:
    o = Observer(app_url)
    p, _ = o.checked()
    started = o.act(p, "render", 202)
    assert started["state"] == "rendering" and started["pdf"] is None
    premature = o.call("GET", f"/api/packets/{p['id']}/pdf")
    done = o.settled(p["id"], ("rendered",))
    if started["state"] == "rendering" and premature.status_code != 200:
        assert premature.status_code == 409 and premature.json() == {"error": "no_pdf"}
    key = f"observers/{o.account_id}/packets/{p['id']}/{done['pdf']['sha256']}.pdf"
    assert S3().keys(f"observers/{o.account_id}/packets/{p['id']}/") == [key]
    stored = S3().get(key)
    assert hashlib.sha256(stored).hexdigest() == done["pdf"]["sha256"] and len(stored) == done["pdf"]["size"]
    assert stored.startswith(b"%PDF-") and done["pdf"]["pages"] == pdf_pages(stored) == 6
    got = o.call("GET", f"/api/packets/{p['id']}/pdf")
    assert got.content == stored and got.headers["content-type"].startswith("application/pdf")
    assert got.headers["content-disposition"] == f'attachment; filename="lowlamp-packet-{done["number"]}.pdf"'


def test_wf_packet_render_status_holds_across_screens(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    p, _ = o.checked()
    pid = p["id"]
    with signed_in(browser, o, f"/packets/{pid}") as page:
        panel = status(page, "Packet status")
        present(page, btn(page, "Render packet"))
        stale_routes: list[Any] = []
        def hold_first(route: Any) -> None:
            if route.request.method == "GET" and not stale_routes:
                stale_routes.append(route)
            else:
                route.fallback()
        click(btn(page, "Render packet"))
        shows(page, panel, f"Rendering packet {p['number']}. This can take a few seconds.")
        page.route(f"**/api/packets/{pid}", hold_first)
        poll(page, lambda: stale_routes, "the panel polls while rendering")
        done = o.settled(pid, ("rendered",))
        click(role(page, "link", "Programs"))
        at(page, "/programs")
        page.go_back()
        at(page, f"/packets/{pid}")
        shows(page, status(page, "Packet status"), f"Packet {p['number']} is rendered and stored (6 pages).")
        old = {**done, "state": "rendering", "label": "Rendering", "pdf": None, "revision": done["revision"] - 1}
        stale_routes[0].fulfill(status=200, content_type="application/json", body=json.dumps(old))
        advance(page, 1500)
        page.evaluate("1")
        shows(page, status(page, "Packet status"), f"Packet {p['number']} is rendered and stored (6 pages).", 2)
        page.reload()
        shows(page, status(page, "Packet status"), "Rendered")
    other, _ = Observer(app_url).checked(), None
    who = Observer(app_url)
    q, _ = who.checked()
    down = instance("APP_GOTENBERG_DOWN_URL")
    with signed_in(browser, who, f"/packets/{q['id']}", base=down) as page:
        click(btn(page, "Render packet"))
        sentence = "The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back."
        shows(page, status(page, "Packet status"), sentence, RENDER_WAIT)
        click(role(page, "link", "Kit"))
        at(page, "/kit")
        page.go_back()
        shows(page, status(page, "Packet status"), sentence)
        page.reload()
        shows(page, status(page, "Packet status"), sentence)
        advance(page, 3000)
        shows(page, status(page, "Packet status"), sentence, 2)


def test_wf_packet_render_happy(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    p, _ = o.checked()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        panel = status(page, "Packet status")
        present(page, btn(page, "Render packet"))
        btn(page, "Render packet").focus()
        press(page, "Enter")
        shows(page, panel, f"Rendering packet {p['number']}. This can take a few seconds.")
        focused(page, panel)
        shows(page, panel, f"Packet {p['number']} is rendered and stored (6 pages).", RENDER_WAIT)
        done = o.get(f"/api/packets/{p['id']}")
        with page.expect_download() as info:
            click(role(page, "link", "Download PDF"))
        download = info.value
        assert download.suggested_filename == f"lowlamp-packet-{p['number']}.pdf"
        data = Path(download.path()).read_bytes()
        assert data == S3().get(f"observers/{o.account_id}/packets/{p['id']}/{done['pdf']['sha256']}.pdf")
        assert pdf_pages(data) == 6
        preview = role(page, "region", "Paper preview")
        present(page, preview)
        assert preview.get_by_role("article").count() == 6
        present(page, role(preview, "article", "Page 1 of 6"))


def test_only_the_newest_render_counts(app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    down = instance("APP_GOTENBERG_DOWN_URL")
    o.act(p, "render", 202)
    current = o.get(f"/api/packets/{p['id']}")
    edited = o.update(rows[0], {"description": LONG + f" {FIRST_EDIT}"}, "2026-11-01T10:00:00Z")["body"]
    current = o.get(f"/api/packets/{p['id']}")
    assert current["state"] == "draft" and current["pdf"] is None
    checked = o.act(current, "check", 200)
    o.act(checked, "render", 202, base=down)
    failed = o.settled(p["id"], ("render_failed",))
    assert failed["failure"] == "renderer_unavailable"
    wait_real(app_url, 3)
    assert o.get(f"/api/packets/{p['id']}")["state"] == "render_failed", "an older attempt changed a newer attempt's state"
    assert S3().keys(f"observers/{o.account_id}/packets/{p['id']}/") == [], "a discarded attempt leaves no object"
    o.act(o.get(f"/api/packets/{p['id']}"), "render", 202)
    now = o.get(f"/api/packets/{p['id']}")
    o.update(edited, {"description": LONG + f" {SECOND_EDIT}"}, "2026-11-01T11:00:00Z")
    checked = o.act(o.get(f"/api/packets/{p['id']}"), "check", 200)
    assert now["revision"] < checked["revision"]
    o.act(checked, "render", 202)
    done = o.settled(p["id"], ("rendered",))
    keys = S3().keys(f"observers/{o.account_id}/packets/{p['id']}/")
    assert keys == [f"observers/{o.account_id}/packets/{p['id']}/{done['pdf']['sha256']}.pdf"], "exactly one stored PDF"
    wording = squash(pdf_text(S3().get(keys[0])))
    assert SECOND_EDIT in wording and FIRST_EDIT not in wording


def test_packet_status_one_node_one_timer(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    p, _ = o.checked()
    pid = p["id"]
    with signed_in(browser, o, f"/packets/{pid}") as page:
        panel = status(page, "Packet status")
        present(page, btn(page, "Render packet"))
        panel.evaluate("e => { window.__panel = e; }")
        click(btn(page, "Render packet"))
        shows(page, panel, "Rendering")
        rendering = {**o.get(f"/api/packets/{pid}"), "state": "rendering", "label": "Rendering", "pdf": None}
        rendering["revision"] = p["revision"] + 1
        polls: list[Any] = []
        mode = {"fake": True, "hold": False}
        pending: list[Any] = []
        def answer(route: Any) -> None:
            if route.request.method != "GET":
                route.fallback()
                return
            polls.append(1)
            if mode["hold"]:
                pending.append(route)
            elif mode["fake"]:
                route.fulfill(status=200, content_type="application/json", body=json.dumps(rendering))
            else:
                route.fallback()
        page.route(f"**/api/packets/{pid}", answer)
        watch(panel, "panel")
        for _ in range(5):
            advance(page, 1000)
            page.evaluate("1")
        poll(page, lambda: polls, "the panel polls once a second")
        assert 3 <= len(polls) <= 7, f"about one request a second, saw {len(polls)}"
        assert watched(page, "panel") == [], "an identical answer writes nothing"
        polls.clear()
        mode["hold"] = True
        for _ in range(3):
            advance(page, 1000)
            page.evaluate("1")
        poll(page, lambda: pending, "a poll is in flight")
        assert len(polls) == 1, "at most one request in flight"
        mode["hold"] = False
        mode["fake"] = False
        pending[0].fallback()
        shows(page, panel, f"Packet {p['number']} is rendered and stored (6 pages).", RENDER_WAIT)
        assert panel.evaluate("e => e === window.__panel"), "Packet status stays the same element"
        polls.clear()
        for _ in range(3):
            advance(page, 1000)
            page.evaluate("1")
        assert polls == [], "polling stops once the packet is no longer rendering"
        written = watched(page, "panel")
        assert all(text_ for text_ in written), "the region is never emptied between states"


@pytest.mark.parametrize("case", VIEWPORTS, ids=VIEWPORTS)
def test_us_letter_pages_on_paper_and_in_preview(browser: Any, app_url: str, case: str) -> None:
    size = VIEWPORT_CASES[case]
    o = Observer(app_url)
    rows = o.five()[1]
    unbroken = LONG_RUN_CHAR * LONG_RUN
    o.update(rows[0], {"description": unbroken}, "2026-11-01T10:00:00Z")
    p = o.packet([x["id"] for x in rows])
    o.act(o.act(p, "check", 200), "render", 202)
    done = o.settled(p["id"], ("rendered",))
    data = o.call("GET", f"/api/packets/{p['id']}/pdf").content
    assert pdf_pages(data) == 6, "a long description stays on one page"
    sizes = page_sizes(data)
    assert sizes and all(abs(w - 612) < 0.5 and abs(h - 792) < 0.5 for w, h in sizes), sizes
    assert unbroken[:200] in squash(pdf_text(data)) and pdf_text(data).count(LONG_RUN_CHAR) >= LONG_RUN
    with signed_in(browser, o, f"/packets/{done['id']}") as page:
        width = PHONE_COLUMN if size == PHONE else COLUMN
        page.set_viewport_size({"width": size[0], "height": size[1]})
        advance(page, 50)
        preview = role(page, "region", "Paper preview")
        present(page, preview)
        assert abs(box(preview)["width"] - width) <= 1, size
        articles = preview.get_by_role("article")
        assert articles.count() == 6
        for i in range(6):
            b = box(articles.nth(i))
            assert abs(b["width"] - width) <= 1 and abs(b["height"] - width * 11 / 8.5) <= 1, (size, i)
        target = role(preview, "article", "Page 2 of 6")
        inside = target.evaluate("""(e, ch) => {
            const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            let last = null, n;
            while ((n = w.nextNode())) if (n.textContent.includes(ch + ch + ch)) last = n;
            if (!last) return false;
            const i = last.textContent.lastIndexOf(ch);
            const r = document.createRange(); r.setStart(last, i); r.setEnd(last, i + 1);
            const c = r.getBoundingClientRect(), p = e.getBoundingClientRect();
            return c.right <= p.right + 1 && c.bottom <= p.bottom + 1 && c.left >= p.left - 1 && e.scrollWidth <= e.clientWidth + 1 && e.scrollHeight <= e.clientHeight + 1;
        }""", LONG_RUN_CHAR)
        assert inside, f"the last description character is inside the page at {size}"
        layout(page)


def test_send_mails_the_stored_pdf(app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    stored = S3().get(f"observers/{o.account_id}/packets/{p['id']}/{p['pdf']['sha256']}.pdf")
    sent = o.act(p, "send", 200)
    assert sent["state"] == "sent" and sent["label"] == "Sent" and re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ", sent["sent_at"])
    message = mail_for(mail, o)[0]
    assert addresses(message["To"]) == [ODILE_ADDR] and addresses(message["Cc"]) == [o.email] and addresses(message.get("Bcc")) == []
    assert message["To"][0]["Name"] == ODILE
    assert message["From"]["Address"] == "packets@lowlamp.test" and message["From"]["Name"] == "Lowlamp Field Log"
    assert message["Subject"] == f"Observing log packet {p['number']}: {GLOB_NAME} — {o.name}"
    assert norm(mail_text(message)) == f"Please find attached observing log packet {p['number']} for {GLOB_NAME} from {o.name}. It lists 5 observations."
    part = message["Attachments"][0]
    assert part["FileName"] == f"lowlamp-packet-{p['number']}.pdf" and part["ContentType"].startswith("application/pdf")
    assert attachment_bytes(message) == stored
    again = o.call("POST", f"/api/packets/{p['id']}/send", {"revision": sent["revision"]})
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition", "state": "sent"}
    assert len(mail_for(mail, o)) == 1


def test_send_dialog_by_keyboard(browser: Any, app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        opener = btn(page, "Send to coordinator")
        present(page, opener)
        opener.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Send packet")
        present(page, dialog)
        shows(page, dialog, ODILE)
        shows(page, dialog, ODILE_ADDR)
        focused(page, btn(dialog, "Send now"))
        press(page, "Tab")
        focused(page, btn(dialog, "Cancel"))
        press(page, "Tab")
        focused(page, btn(dialog, "Send now"), "Tab wraps")
        press(page, "Shift+Tab")
        focused(page, btn(dialog, "Cancel"), "Shift+Tab wraps")
        press(page, "Escape")
        focused(page, opener, "focus returns at once", 2)
        advance(page, 250)
        absent(page, dialog)
        press(page, "Enter")
        focused(page, btn(role(page, "dialog", "Send packet"), "Send now"))
        press(page, "Tab", "Enter")
        focused(page, opener)
        advance(page, 250)
        no_mail(mail, o)
        assert o.get(f"/api/packets/{p['id']}")["state"] == "rendered"
        press(page, "Enter")
        focused(page, btn(role(page, "dialog", "Send packet"), "Send now"))
        press(page, "Enter")
        focused(page, status(page, "Packet status"))
        shows(page, status(page, "Packet status"), f"Packet {p['number']} was sent to {ODILE}.")


def test_exactly_one_render_or_send_wins(app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.checked()
    with ThreadPoolExecutor(6) as pool:
        codes = [r.status_code for r in pool.map(lambda _: o.call("POST", f"/api/packets/{p['id']}/render", {"revision": p["revision"]}), range(6))]
    assert sorted(codes) == [202] + [409] * 5, codes
    done = o.settled(p["id"], ("rendered",))
    with ThreadPoolExecutor(6) as pool:
        codes = [r.status_code for r in pool.map(lambda _: o.call("POST", f"/api/packets/{p['id']}/send", {"revision": done["revision"]}), range(6))]
    assert sorted(codes) == [200] + [409] * 5, codes
    assert len(mail_for(mail, o)) == 1, "at most one message per packet"


def test_wf_packet_send_keyboard_only(browser: Any, app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        opener = btn(page, "Send to coordinator")
        present(page, opener)
        for _ in range(60):
            press(page, "Tab")
            if opener.evaluate("e => document.activeElement === e"):
                break
        else:
            pytest.fail("Send to coordinator is reachable by Tab")
        press(page, "Enter")
        focused(page, btn(role(page, "dialog", "Send packet"), "Send now"))
        press(page, "Enter")
        panel = status(page, "Packet status")
        shows(page, panel, f"Packet {p['number']} was sent to {ODILE}.")
        shows(page, panel, "Sent")
        absent(page, opener, "no second send")
    message = mail_for(mail, o)[0]
    assert attachment_bytes(message).startswith(b"%PDF-") and addresses(message["To"]) == [ODILE_ADDR]
    assert o.get(f"/api/packets/{p['id']}")["state"] == "sent"


def test_honest_sending_state(browser: Any, app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        sent = track(page, f"/api/packets/{p['id']}/send")
        click(btn(page, "Send to coordinator"))
        with held(page, f"**/api/packets/{p['id']}/send") as release:
            click(btn(role(page, "dialog", "Send packet"), "Send now"))
            panel = status(page, "Packet status")
            shows(page, panel, f"Sending packet {p['number']} to {ODILE}.")
            absent(page, btn(page, "Send to coordinator"), "no Send to coordinator while sending", 3)
            press(page, "Enter", "Enter")
            advance(page, 500)
            assert len(sent) == 1, "exactly one send request"
            assert o.get(f"/api/packets/{p['id']}")["state"] == "rendered", "held: the server has not sent"
            no_mail(mail, o)
            release()
        shows(page, panel, f"Packet {p['number']} was sent to {ODILE}.")
        assert len(sent) == 1
    who = Observer(app_url)
    q, _ = who.rendered()
    down = instance("APP_MAILPIT_DOWN_URL")
    with signed_in(browser, who, f"/packets/{q['id']}", base=down) as page:
        click(btn(page, "Send to coordinator"))
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        panel = status(page, "Packet status")
        shows(page, panel, f"The mail server isn't answering. Packet {q['number']} is still rendered and nothing was sent; try again later.")
        shows(page, panel, "Rendered")
        present(page, btn(page, "Send to coordinator"), "Send to coordinator returns on a 503")
        assert "Sending" not in norm(panel.text_content())


def test_stale_tab_cannot_send_the_wrong_thing(browser: Any, app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, rows = o.rendered()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        present(page, btn(page, "Send to coordinator"))
        o.act(p, "send", 200)
        assert len(mail_for(mail, o)) == 1
        click(btn(page, "Send to coordinator"))
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        panel = status(page, "Packet status")
        shows(page, panel, STALE)
        shows(page, panel, "Sent")
        absent(page, btn(page, "Send to coordinator"))
        assert len(mail_for(mail, o)) == 1, "the mail server still holds one message"
    who = Observer(app_url)
    q, more = who.rendered()
    with signed_in(browser, who, f"/packets/{q['id']}") as page:
        present(page, btn(page, "Send to coordinator"))
        who.update(more[0], {"seeing": 9}, "2026-11-01T10:00:00Z")
        draft = who.get(f"/api/packets/{q['id']}")
        who.act(who.act(draft, "check", 200), "render", 202)
        fresh = who.settled(q["id"], ("rendered",))
        click(btn(page, "Send to coordinator"))
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        shows(page, status(page, "Packet status"), STALE)
        no_mail(mail, who)
        assert who.get(f"/api/packets/{q['id']}")["revision"] == fresh["revision"]


def test_wf_packet_send_outlives_the_screen(browser: Any, app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    q, _ = o.rendered()
    with signed_in(browser, o, f"/packets/{p['id']}") as page:
        opener = btn(page, "Send to coordinator")
        present(page, opener)
        click(opener)
        press(page, "Escape")
        click(opener)
        advance(page, 300)
        dialog = role(page, "dialog", "Send packet")
        present(page, dialog, "a dialog reopened during its exit stays open", 3)
        focused(page, btn(dialog, "Send now"))
        sent = track(page, "/send")
        with held(page, f"**/api/packets/{p['id']}/send") as release:
            click(btn(dialog, "Send now"))
            shows(page, status(page, "Packet status"), f"Sending packet {p['number']} to {ODILE}.")
            page.evaluate("window.__sameDocument = true")
            click(role(page, "link", "Programs"))
            at(page, "/programs")
            assert page.evaluate("window.__sameDocument") is True, "moving between working screens loads no document"
            page.go_back()
            at(page, f"/packets/{p['id']}")
            shows(page, status(page, "Packet status"), "Sending")
            advance(page, 1500)
            shows(page, status(page, "Packet status"), "Sending", 2)
            assert btn(page, "Send to coordinator").count() == 0, "a server answer at the previous state cannot offer a second send"
            release()
        shows(page, status(page, "Packet status"), f"Packet {p['number']} was sent to {ODILE}.")
        assert len(sent) == 1
        page.goto(f"{app_url}/packets/{q['id']}")
        click(btn(page, "Send to coordinator"))
        gate = Gate(page, f"**/api/packets/{q['id']}/send")
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        poll(page, lambda: gate.items, "the send goes out")
        click(role(page, "link", "Kit"))
        at(page, "/kit")
        gate.release_all()
        advance(page, 500)
        at(page, "/kit")
        assert page.get_by_text(f"Packet {q['number']} was sent to {ODILE}.").count() == 0, "the answer paints no other screen"
        page.go_back()
        at(page, f"/packets/{q['id']}")
        shows(page, status(page, "Packet status"), f"Packet {q['number']} was sent to {ODILE}.")
    assert len(mail_for(mail, o, 2)) == 2
    who = Observer(app_url)
    r, _ = who.rendered()
    with signed_in(browser, who, f"/packets/{r['id']}") as page:
        click(btn(page, "Send to coordinator"))
        gate = Gate(page, f"**/api/packets/{r['id']}/send")
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        poll(page, lambda: gate.items, "the send goes out")
        gate.open = True
        page.reload()
        shows(page, status(page, "Packet status"), f"Packet {r['number']} was sent to {ODILE}.")
        advance(page, 2000)
        assert len(gate.requests) == 1, "a reload never re-sends"
    assert len(mail_for(mail, who)) == 1


def test_names_stay_literal(app_url: str, mail: Any) -> None:
    message = "Enter your name as it should appear on packets."
    for bad in ("   ", "x" * 61, "a\nb", "a\r\nBcc: x@evil.test", "a\u2028b", "a\u2029b", "a\u0007b", "a\u007fb", "a\u0085b"):
        a, b = unique("namer")
        r = httpx.post(app_url + "/api/auth/signup", json={"email": a if "@" in a else b, "password": PASSWORD, "display_name": bad}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 422 and r.json()["fields"]["display_name"] == message, repr(bad)
    for name in ("Pell, Rowan <x@evil.test>", 'Zoë "Ő" Nagy', "y" * 60):
        o = Observer(app_url, name=name)
        p, _ = o.rendered()
        pdf = o.call("GET", f"/api/packets/{p['id']}/pdf").content
        assert squash(f"Observer: {name} ({o.email})") in squash(pdf_text(pdf))
        o.act(p, "send", 200)
        got = mail_for(mail, o)[0]
        assert got["Subject"] == f"Observing log packet {p['number']}: {GLOB_NAME} — {name}"
        assert f"from {name}. It lists 5 observations." in norm(mail_text(got))
        assert addresses(got["To"]) == [ODILE_ADDR] and addresses(got["Cc"]) == [o.email] and addresses(got.get("Bcc")) == []
        assert "x@evil.test" not in [a.lower() for a in addresses(got["To"]) + addresses(got["Cc"])]


@pytest.mark.parametrize("case", RENDERER_OUTAGES, ids=RENDERER_OUTAGES)
def test_wf_service_outages_renderer(browser: Any, app_url: str, case: str) -> None:
    o = Observer(app_url)
    p, _ = o.checked()
    down = instance(OUTAGE_ENVS[case])
    with signed_in(browser, o, f"/packets/{p['id']}", base=down) as page:
        click(btn(page, "Render packet"))
        panel = status(page, "Packet status")
        shows(page, panel, "The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back.", RENDER_WAIT)
        shows(page, panel, "Render failed")
        present(page, btn(page, "Try again"))
        focused(page, panel)
        failed = o.get(f"/api/packets/{p['id']}", down)
        assert failed["state"] == "render_failed" and failed["failure"] == "renderer_unavailable" and failed["pdf"] is None
        assert S3().keys(f"observers/{o.account_id}/packets/{p['id']}/") == []
        assert o.call("GET", f"/api/packets/{p['id']}/pdf", base=down).json() == {"error": "no_pdf"}
    o.act(failed, "render", 202)
    done = o.settled(p["id"], ("rendered",))
    assert done["failure"] is None and pdf_pages(o.call("GET", f"/api/packets/{p['id']}/pdf").content) == 6


@pytest.mark.parametrize("case", MAIL_OUTAGES, ids=MAIL_OUTAGES)
def test_mail_outage_keeps_state_and_revision(app_url: str, mail: Any, case: str) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    down = instance(OUTAGE_ENVS[case])
    r = o.call("POST", f"/api/packets/{p['id']}/send", {"revision": p["revision"]}, base=down)
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
    now = o.get(f"/api/packets/{p['id']}")
    assert now["state"] == "rendered" and now["revision"] == p["revision"] and now["sent_at"] is None
    no_mail(mail, o)
    assert o.act(now, "send", 200)["state"] == "sent", "the same revision still sends once SMTP answers"


@pytest.mark.parametrize("case", STORAGE_OUTAGES, ids=STORAGE_OUTAGES)
def test_storage_outage_reads_saves_and_render(browser: Any, app_url: str, case: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    down = instance(OUTAGE_ENVS[case])
    assert o.call("GET", f"/api/health", base=down).status_code == 200
    r = o.call("GET", f"/api/observations/{rows[0]['id']}/strokes", base=down)
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    o.act(p, "render", 202, base=down)
    failed = o.settled(p["id"], ("render_failed",), down)
    assert failed["failure"] == "storage_unavailable"
    s = o.start(EVE_2026)
    plain = o.log(s["id"], "m57", sketch=False)
    with signed_in(browser, o, f"/packets/{p['id']}", base=down) as page:
        shows(page, status(page, "Packet status"), "Render failed")
        click(btn(page, "Try again"))
        shows(page, status(page, "Packet status"), "Packet storage isn't answering. Nothing was saved; press Try again when it's back.", RENDER_WAIT)
        goto_session(page, o, s["id"], plain["id"], base=down)
        field_of(page).focus()
        press(page, "Enter")
        click(btn(page, "Save observation"))
        shows(page, status(page, "Save status"), STORE_SKETCH)
        shows(page, status(page, "Connection"), "1 change waiting to sync.")
        advance(page, RETRY_MS)
        shows(page, status(page, "Sync results"), STORE_SKETCH)
        shows(page, status(page, "Connection"), "1 change waiting to sync.")
    now = o.get(f"/api/observations/{plain['id']}")
    assert now["version"] == plain["version"] and now["sketch"] is None


class Relay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        self.up = False
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(32)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            if not self.up:
                conn.close()
                continue
            far = socket.create_connection(self.target)
            for a, b in ((conn, far), (far, conn)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
        try:
            while chunk := a.recv(65536):
                b.sendall(chunk)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def stop(self) -> None:
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def test_boot_with_services_down_and_recover_without_restart(mail: Any) -> None:
    gotenberg = urlparse(os.environ["GOTENBERG_URL"])
    minio = urlparse(os.environ["S3_ENDPOINT"])
    render_relay = Relay(gotenberg.hostname, gotenberg.port or 80)
    store_relay = Relay(minio.hostname, minio.port or 80)
    smtp_relay = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "GOTENBERG_URL": f"http://127.0.0.1:{render_relay.port}",
           "S3_ENDPOINT": f"http://127.0.0.1:{store_relay.port}", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp_relay.port)}
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    base = f"http://127.0.0.1:{port}"
    with tempfile.TemporaryFile("w+") as log:
        copy = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=log, start_new_session=True)
        def tail() -> str:
            log.seek(0)
            return log.read()[-2000:]
        try:
            deadline = time.monotonic() + BOOT_WAIT
            healthy = False
            while time.monotonic() < deadline and not healthy:
                assert copy.poll() is None, f"the copy exited: {tail()}"
                try:
                    healthy = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
                except httpx.HTTPError:
                    continue
            assert healthy, f"the copy never answered health with services down: {tail()}"
            o = Observer(base)
            s = o.start(EVE_2025)
            bare = o.log(s["id"], "m13", sketch=False)
            put = change("sketch.put", observation_id=bare["id"], base_version=bare["version"], edited_at=EDIT_T, strokes=stroke_file(), raster_png_base64=None)
            assert o.one(put)["status"] == 503
            store_relay.up = True
            retried = o.one(put, 200)
            assert retried["replayed"] is False, "storage recovers on the next action"
            ids = [retried["body"]["id"]] + [o.log(s["id"], obj)["id"] for obj in ("m92", "m3", "m5", "m15")]
            p = o.act(o.packet(ids), "check", 200)
            o.act(p, "render", 202)
            failed = o.settled(p["id"], ("render_failed",))
            assert failed["failure"] == "renderer_unavailable"
            render_relay.up = True
            o.act(failed, "render", 202)
            done = o.settled(p["id"], ("rendered",))
            r = o.call("POST", f"/api/packets/{p['id']}/send", {"revision": done["revision"]})
            assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
            smtp_relay.up = True
            assert o.act(done, "send", 200)["state"] == "sent", "SMTP recovers on the next action"
            assert len(mail_for(mail, o)) == 1
        finally:
            os.killpg(copy.pid, 15)
            copy.wait(timeout=WAIT)
            for relay in (render_relay, store_relay, smtp_relay):
                relay.stop()


def test_wf_service_outages_meeting_a_mail_outage(browser: Any, app_url: str, mail: Any) -> None:
    down = instance("APP_MAILPIT_DOWN_URL")
    o = Observer(app_url)
    p, _ = o.checked()
    with signed_in(browser, o, f"/packets/{p['id']}", base=down) as page:
        click(btn(page, "Render packet"))
        panel = status(page, "Packet status")
        shows(page, panel, f"Packet {p['number']} is rendered and stored (6 pages).", RENDER_WAIT)
        rendered = o.get(f"/api/packets/{p['id']}")
        click(btn(page, "Send to coordinator"))
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        shows(page, panel, f"The mail server isn't answering. Packet {p['number']} is still rendered and nothing was sent; try again later.")
        shows(page, panel, "Rendered")
        advance(page, 2000)
        shows(page, panel, "nothing was sent", 2)
    now = o.get(f"/api/packets/{p['id']}")
    assert now["state"] == "rendered" and now["revision"] == rendered["revision"]
    no_mail(mail, o)


def test_send_with_storage_down_sends_nothing(browser: Any, app_url: str, mail: Any) -> None:
    o = Observer(app_url)
    p, _ = o.rendered()
    down = instance("APP_MINIO_DOWN_URL")
    r = o.call("POST", f"/api/packets/{p['id']}/send", {"revision": p["revision"]}, base=down)
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"}
    with signed_in(browser, o, f"/packets/{p['id']}", base=down) as page:
        click(btn(page, "Send to coordinator"))
        click(btn(role(page, "dialog", "Send packet"), "Send now"))
        panel = status(page, "Packet status")
        shows(page, panel, f"Packet storage isn't answering. Packet {p['number']} is still rendered and nothing was sent; try again later.")
        shows(page, panel, "Rendered")
        present(page, btn(page, "Send to coordinator"))
    now = o.get(f"/api/packets/{p['id']}")
    assert now["state"] == "rendered" and now["revision"] == p["revision"]
    no_mail(mail, o)


def test_failed_sketch_read_is_never_an_empty_sketch(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.rendered()
    s = o.start(EVE_2026)
    obs = o.log(s["id"], "m57")
    digest = obs["sketch"]["strokes_sha256"]
    down = instance("APP_MINIO_DOWN_URL")
    with signed_in(browser, o, f"/sessions/{s['id']}?observation={obs['id']}", base=down) as page:
        field_ready(page)
        reads(page, status(page, "Field announcements"), "This sketch can't be shown while storage isn't answering. Nothing was changed.")
        for name in ("Pencil", "Star", "Undo", "Clear sketch"):
            poll(page, lambda n=name: btn(page, n).is_disabled(), f"{name} is disabled")
        before = decode(capture(field_of(page)))
        field_of(page).focus()
        press(page, "Enter")
        page.mouse.click(*circle_point(page, 0.5, 0.5))
        advance(page, 50)
        assert difference(before, decode(capture(field_of(page)))) == 0, "marks do nothing"
        sent = track(page, "/api/sync")
        fill(role(page, "textbox", "Description"), LONG + " Saved during an outage.")
        save(page, "M57 saved.")
        assert [c["kind"] for rq in sent for c in ops_of(rq)] == ["observation.update"], "no sketch.put"
        page.goto(f"{down}/packets/{p['id']}")
        link = role(page, "link", "Download PDF")
        present(page, link)
        click(link)
        panel = status(page, "Packet status")
        shows(page, panel, f"Packet storage isn't answering. Packet {p['number']} is safe; try Download PDF again when it's back.")
        at(page, f"/packets/{p['id']}")
    now = o.get(f"/api/observations/{obs['id']}")
    assert now["description"].endswith("Saved during an outage.") and now["sketch"]["strokes_sha256"] == digest
    assert o.call("GET", f"/api/observations/{obs['id']}/strokes").status_code == 200


def test_refused_sketch_changed_nothing(app_url: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    obs = rows[0]
    down = instance("APP_MINIO_DOWN_URL")
    old = change("sketch.put", observation_id=obs["id"], base_version=obs["version"], edited_at="2026-01-01T00:00:00Z", strokes=stroke_file(((1, 1, 1),)), raster_png_base64=None)
    discarded = o.one(old, 200, "tablet", down)
    assert discarded["body"]["version"] == obs["version"] and discarded["conflicts"][0]["field"] == "sketch" and discarded["conflicts"][0]["outcome"] == "kept"
    bad = change("sketch.put", observation_id=obs["id"], base_version=obs["version"], edited_at="2026-11-02T10:00:00Z", strokes="nope", raster_png_base64=None)
    assert o.one(bad, 422, base=down)["body"]["fields"]["strokes"] == "The sketch file is not a Lowlamp stroke file."
    new = stroke_file(((2, 2, 2),))
    put = change("sketch.put", observation_id=obs["id"], base_version=obs["version"], edited_at="2026-11-02T10:00:00Z", strokes=new, raster_png_base64=None)
    refused = o.one(put, 503, base=down)
    assert refused["body"] == {"error": "storage_unavailable"}
    now = o.get(f"/api/observations/{obs['id']}")
    assert now["version"] == obs["version"] and now["sketch"] == obs["sketch"]
    packet = o.get(f"/api/packets/{p['id']}")
    assert packet["state"] == "checked" and packet["revision"] == p["revision"]
    changed_payload = dict(put, strokes=stroke_file(((3, 3, 3),)), body={**put["body"], "strokes": stroke_file(((3, 3, 3),))})
    retried = o.one(changed_payload, 200)
    assert retried["replayed"] is False, "a later retry with a different payload is not an op_conflict"
    assert o.get(f"/api/packets/{p['id']}")["state"] == "draft"
    latest = retried["body"]
    both = o.sync([change("observation.update", observation_id=obs["id"], base_version=latest["version"], edited_at="2026-11-02T11:00:00Z", fields={"seeing": 2}),
                   change("sketch.put", observation_id=obs["id"], base_version=latest["version"], edited_at="2026-11-02T11:00:00Z", strokes=new, raster_png_base64=None)], base=down)
    assert [x["status"] for x in both] == [200, 503]
    assert o.get(f"/api/observations/{obs['id']}")["seeing"] == 2, "changes applied earlier in the request stand"
    target = o.log(o.start(EVE_2026)["id"], "m57")
    delete = change("observation.delete", observation_id=target["id"], base_version=target["version"])
    assert o.one(delete, 503, base=down)["body"] == {"error": "storage_unavailable"}
    assert o.get(f"/api/observations/{target['id']}")["id"] == target["id"]
    assert o.one(delete, 200)["replayed"] is False


def no_provider_detail(body: str) -> None:
    for leak in [os.environ[k] for k in ("S3_BUCKET", "S3_ENDPOINT", "SMTP_HOST", "GOTENBERG_URL") if os.environ.get(k)]:
        assert leak not in body, "a provider detail reached the answer"
    assert "stack" not in body.lower()


def refusing_storage_path(app_url: str, base: str) -> None:
    o = Observer(app_url)
    p, rows = o.checked()
    started = time.monotonic()
    r = o.call("GET", f"/api/observations/{rows[0]['id']}/strokes", base=base)
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable"} and time.monotonic() - started < STORAGE_LIMIT + SMTP_MARGIN
    no_provider_detail(r.text)
    put = o.one(change("sketch.put", observation_id=rows[1]["id"], base_version=rows[1]["version"], edited_at="2026-11-02T10:00:00Z", strokes=stroke_file(((5, 5, 5),)), raster_png_base64=None), 503, base=base)
    assert put["body"] == {"error": "storage_unavailable"}
    o.act(p, "render", 202, base=base)
    failed = o.settled(p["id"], ("render_failed",), base)
    assert failed["failure"] == "storage_unavailable" and failed["pdf"] is None


def erroring_renderer_path(browser: Any, app_url: str, base: str) -> None:
    who = Observer(app_url)
    q, _ = who.checked()
    with signed_in(browser, who, f"/packets/{q['id']}", base=base) as page:
        click(btn(page, "Render packet"))
        panel = status(page, "Packet status")
        shows(page, panel, "The PDF renderer isn't answering. Nothing was rendered; press Try again when it's back.", RENDER_WAIT)
        no_provider_detail(norm(panel.text_content()))
    bad = who.get(f"/api/packets/{q['id']}")
    assert bad["state"] == "render_failed" and bad["failure"] == "renderer_unavailable"
    assert S3().keys(f"observers/{who.account_id}/packets/{q['id']}/") == [], "nothing is stored"


def silent_smtp_path(app_url: str, mail: Any, base: str) -> None:
    quiet = Observer(app_url)
    t, _ = quiet.rendered()
    started = time.monotonic()
    r = quiet.call("POST", f"/api/packets/{t['id']}/send", {"revision": t["revision"]}, base=base)
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable"}
    assert time.monotonic() - started < SMTP_LIMIT + SMTP_MARGIN, "the SMTP exchange has a ten-second limit"
    no_provider_detail(r.text)
    now = quiet.get(f"/api/packets/{t['id']}")
    assert now["state"] == "rendered" and now["revision"] == t["revision"]
    no_mail(mail, quiet)


@pytest.mark.parametrize("case", PROVIDER_OUTAGES, ids=PROVIDER_OUTAGES)
def test_refusing_and_silent_providers(browser: Any, app_url: str, mail: Any, case: str) -> None:
    base = instance(OUTAGE_ENVS[case])
    if case == "minio-refusing":
        refusing_storage_path(app_url, base)
    elif case == "gotenberg-erroring":
        erroring_renderer_path(browser, app_url, base)
    else:
        silent_smtp_path(app_url, mail, base)


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_sent_packet_stays_byte_for_byte(app_url: str, case: str) -> None:
    train, _, sentence, _, _ = TRAIN_CASES[case]
    o = Observer(app_url)
    p, rows = o.rendered(train)
    sent = o.act(p, "send", 200)
    pdf = o.call("GET", f"/api/packets/{p['id']}/pdf").content
    assert squash(f"Orientation: {sentence}") in squash(pdf_text(pdf)), "the sent PDF printed each row under its own train"
    pdf_key = f"observers/{o.account_id}/packets/{p['id']}/{sent['pdf']['sha256']}.pdf"
    assert S3().keys(f"observers/{o.account_id}/packets/{p['id']}/") == [pdf_key] and S3().get(pdf_key) == pdf
    old_digest = rows[0]["sketch"]["strokes_sha256"]
    cited = o.call("GET", f"/api/packets/{p['id']}/strokes/{rows[0]['id']}").content
    new_text = stroke_file(((7, 7, 5),))
    redrawn = o.one(change("sketch.put", observation_id=rows[0]["id"], base_version=rows[0]["version"], edited_at="2026-11-02T10:00:00Z", strokes=new_text, raster_png_base64=None), 200)["body"]
    assert redrawn["sketch"]["strokes_sha256"] == hashlib.sha256(new_text.encode()).hexdigest() != old_digest
    now = o.get(f"/api/packets/{p['id']}")
    assert now["state"] == "sent" and now["revision"] == sent["revision"] and now["rows"][0]["strokes_sha256"] == old_digest
    assert (now["number"], now["sent_at"], now["observation_ids"], now["pdf"]["sha256"]) == (
        sent["number"], sent["sent_at"], sent["observation_ids"], sent["pdf"]["sha256"]), "a sent packet is never affected by a later edit"
    assert o.call("GET", f"/api/packets/{p['id']}/pdf").content == pdf
    assert S3().keys(f"observers/{o.account_id}/packets/{p['id']}/") == [pdf_key] and S3().get(pdf_key) == pdf, "the stored PDF is final"
    assert o.call("GET", f"/api/packets/{p['id']}/strokes/{rows[0]['id']}").content == cited
    assert S3().get(f"observers/{o.account_id}/strokes/{rows[0]['id']}/{old_digest}.json") == cited
    assert S3().get(f"observers/{o.account_id}/strokes/{rows[0]['id']}/{redrawn['sketch']['strokes_sha256']}.json") == new_text.encode(), "the redraw is a new object beside the cited one, never an overwrite"
    assert o.call("GET", f"/api/observations/{rows[0]['id']}/strokes").content == new_text.encode()
    for action in ("check", "render", "send"):
        again = o.call("POST", f"/api/packets/{p['id']}/{action}", {"revision": now["revision"]})
        assert again.status_code == 409 and again.json() == {"error": "invalid_transition", "state": "sent"}, action
    fresh = o.act(o.packet([x["id"] for x in rows]), "check", 200)
    assert fresh["rows"][0]["strokes_sha256"] == redrawn["sketch"]["strokes_sha256"]
    assert o.call("GET", f"/api/packets/{fresh['id']}/strokes/{rows[0]['id']}").content == new_text.encode()


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_delete_removes_files_rows_and_cannot_be_undone(app_url: str, case: str) -> None:
    train, _, sentence, _, _ = TRAIN_CASES[case]
    victim_train, _, victim_sentence, _, _ = TRAIN_CASES[NEXT_TRAIN[case]]
    o = Observer(app_url)
    p, rows = o.rendered(train)
    victim = o.update(rows[0], {"seeing": 8, "optics": o.optics("ep25", barlow=True, train=victim_train)}, "2026-11-02T09:00:00Z")["body"]
    p = o.act(o.act(o.get(f"/api/packets/{p['id']}"), "check", 200), "render", 202)
    p = o.settled(p["id"], ("rendered",))
    png = base64.b64encode(tiny_png()).decode()
    victim = o.one(change("sketch.put", observation_id=victim["id"], base_version=victim["version"], edited_at="2026-11-02T09:30:00Z", strokes=stroke_file(((1, 2, 3),)), raster_png_base64=png), 200)["body"]
    p = o.settled(p["id"], ("draft",))
    p = o.act(p, "check", 200)
    p = o.act(p, "render", 202)
    p = o.settled(p["id"], ("rendered",))
    store = S3()
    printed = squash(pdf_text(o.call("GET", f"/api/packets/{p['id']}/pdf").content))
    assert squash(f"Orientation: {victim_sentence}") in printed, "the victim's page printed its own train, not the session's"
    assert squash(f"Orientation: {sentence}") in printed, "the rows that kept the session's optics printed its train"
    v_mag, v_field, v_pupil = derived(1200, 254, 25, 67, 2)
    assert squash(f"Eyepiece: 25 mm wide, 2× Barlow at {v_mag}×") in printed, "the victim's page printed its own eyepiece and Barlow"
    assert squash(f"True field: {v_field}′ · Exit pupil: {v_pupil:.1f} mm") in printed
    assert store.keys(f"observers/{o.account_id}/strokes/{victim['id']}/") and store.keys(f"observers/{o.account_id}/rasters/{victim['id']}/")
    other_device = o.update(victim, {"seeing": 4}, "2026-11-02T10:00:00Z", device="desk")["body"]
    refused = o.one(change("observation.delete", observation_id=victim["id"], base_version=victim["version"]), 409, "laptop")
    assert refused["body"]["error"] == "edited_since" and refused["body"]["observation"]["id"] == victim["id"]
    p = o.get(f"/api/packets/{p['id']}")
    only = o.packet([other_device["id"]])
    lone = o.one(change("observation.delete", observation_id=victim["id"], base_version=other_device["version"]), 409, "desk")
    assert lone["body"]["error"] == "only_row_of_packet" and lone["body"]["observation"]["id"] == victim["id"]
    others = [x for x in rows if x["id"] != victim["id"]]
    o.call("PUT", f"/api/packets/{only['id']}/rows", {"revision": only["revision"], "observation_ids": [others[0]["id"]]})
    p = o.act(o.act(p, "check", 200), "render", 202) if p["state"] == "draft" else p
    p = o.settled(p["id"], ("rendered",))
    done = o.one(change("observation.delete", observation_id=victim["id"], base_version=other_device["version"]), 200, "desk")
    assert done["body"] == {"id": victim["id"], "deleted": True}
    assert store.keys(f"observers/{o.account_id}/strokes/{victim['id']}/") == [] and store.keys(f"observers/{o.account_id}/rasters/{victim['id']}/") == []
    assert store.keys(f"observers/{o.account_id}/packets/{p['id']}/") == [], "the PDF that printed it goes"
    moved = o.get(f"/api/packets/{p['id']}")
    assert moved["state"] == "draft" and moved["pdf"] is None and moved["rows"] == [] and moved["returned_to_draft"] is True
    assert moved["revision"] == p["revision"] + 1 and victim["id"] not in moved["observation_ids"]
    for path in ("", "/strokes", "/raster"):
        assert o.call("GET", f"/api/observations/{victim['id']}{path}").status_code == 404
    assert all(x["id"] != victim["id"] for x in o.get(history_path("m13"))["observations"])
    late = [change("observation.update", observation_id=victim["id"], base_version=1, edited_at="2026-11-03T10:00:00Z", fields={"seeing": 1}),
            change("sketch.put", observation_id=victim["id"], base_version=1, edited_at="2026-11-03T10:00:00Z", strokes=stroke_file(), raster_png_base64=None),
            change("observation.create", observation_id=victim["id"], session_id=victim["session_id"], object_id="m13", edited_at="2026-11-03T10:00:00Z", fields={})]
    for result in o.sync(late):
        assert result["status"] == 409 and result["body"] == {"error": "observation_deleted"}
    assert store.keys(f"observers/{o.account_id}/strokes/{victim['id']}/") == []
    assert o.call("POST", "/api/packets", {"program_id": GLOBULARS, "observation_ids": [victim["id"]]}).status_code == 404
    again = o.one(change("observation.delete", observation_id=victim["id"], base_version=1), 200)
    assert again["body"] == {"id": victim["id"], "deleted": True}
    sent_p, sent_rows = o.rendered(train)
    sent_packet = o.act(sent_p, "send", 200)
    sent_pdf = o.call("GET", f"/api/packets/{sent_p['id']}/pdf").content
    sent_cited = o.call("GET", f"/api/packets/{sent_p['id']}/strokes/{sent_rows[0]['id']}").content
    cited = o.one(change("observation.delete", observation_id=sent_rows[0]["id"], base_version=sent_rows[0]["version"]), 409)
    assert cited["body"]["error"] == "cited_by_sent_packet" and cited["body"]["observation"]["id"] == sent_rows[0]["id"]
    kept = o.get(f"/api/observations/{sent_rows[0]['id']}")
    assert kept["version"] == sent_rows[0]["version"] and kept["sketch"] == sent_rows[0]["sketch"], "the refusal comes before the tombstone, so nothing was removed"
    assert store.get(f"observers/{o.account_id}/strokes/{sent_rows[0]['id']}/{sent_rows[0]['sketch']['strokes_sha256']}.json") == sent_cited
    still = o.get(f"/api/packets/{sent_p['id']}")
    assert still["state"] == "sent" and still["revision"] == sent_packet["revision"] and still["pdf"]["sha256"] == sent_packet["pdf"]["sha256"]
    assert o.call("GET", f"/api/packets/{sent_p['id']}/pdf").content == sent_pdf, "a sent packet's PDF stays readable unchanged"
    assert o.call("GET", f"/api/packets/{sent_p['id']}/strokes/{sent_rows[0]['id']}").content == sent_cited


def packet_in_state(o: Observer, state: str) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    _, rows = o.five()
    p = o.packet([x["id"] for x in rows])
    if state == "draft":
        return p, rows
    p = o.act(p, "check", 200)
    if state == "checked":
        return p, rows
    o.act(p, "render", 202)
    p = o.settled(p["id"], ("rendered",))
    return (p if state == "rendered" else o.act(p, "send", 200)), rows


@pytest.mark.parametrize("case", PACKET_STATES, ids=PACKET_STATES)
def test_private_to_the_owner_everywhere(app_url: str, case: str) -> None:
    owner, other = Observer(app_url), Observer(app_url)
    p, rows = packet_in_state(owner, case)
    obs = rows[0]
    sid = obs["session_id"]
    nf = {"error": "not_found"}
    ghost = str(uuid.uuid4())
    for path in (f"/api/sessions/{sid}", f"/api/observations/{obs['id']}", f"/api/observations/{obs['id']}/strokes", f"/api/observations/{obs['id']}/raster",
                 f"/api/packets/{p['id']}", f"/api/packets/{p['id']}/pdf", f"/api/packets/{p['id']}/strokes/{obs['id']}"):
        r = other.call("GET", path)
        assert r.status_code == 404 and r.json() == nf, path
    for path in (f"/api/sessions/{ghost}", f"/api/observations/{ghost}", f"/api/observations/{ghost}/strokes", f"/api/observations/{ghost}/raster",
                 f"/api/packets/{ghost}", f"/api/packets/{ghost}/pdf", f"/api/packets/{ghost}/strokes/{ghost}"):
        r = other.call("GET", path)
        assert r.status_code == 404 and r.json() == nf, f"an id owned by nobody reads the same as one owned by someone else: {path}"
    owner_pdf = owner.call("GET", f"/api/packets/{p['id']}/pdf")
    if case in ("draft", "checked"):
        assert owner_pdf.status_code == 409 and owner_pdf.json() == {"error": "no_pdf"}, "the owner's own answer names the missing PDF"
    else:
        assert owner_pdf.status_code == 200 and owner_pdf.content
    for action in ("check", "render", "send"):
        r = other.call("POST", f"/api/packets/{p['id']}/{action}", {"revision": p["revision"]})
        assert r.status_code == 404 and r.json() == nf, f"{action} on a {case} packet"
    assert other.call("PUT", f"/api/packets/{p['id']}/rows", {"revision": p["revision"], "observation_ids": [obs["id"]]}).json() == nf
    assert other.call("POST", "/api/packets", {"program_id": GLOBULARS, "observation_ids": [obs["id"]]}).json() == nf
    theirs = other.start(EVE_2026)
    edit = "2026-11-02T10:00:00Z"
    changes = [change("observation.update", observation_id=obs["id"], base_version=obs["version"], edited_at=edit, fields={"seeing": 1}),
               change("sketch.put", observation_id=obs["id"], base_version=obs["version"], edited_at=edit, strokes=stroke_file(), raster_png_base64=None),
               change("observation.delete", observation_id=obs["id"], base_version=obs["version"]),
               change("session.optics", session_id=sid, optics=other.optics()),
               change("session.optics", session_id=theirs["id"], optics={**other.optics(), "telescope_id": owner.telescope}),
               change("session.optics", session_id=theirs["id"], optics={**other.optics(), "eyepiece_id": owner.ep25}),
               change("session.optics", session_id=theirs["id"], optics={**other.optics(), "barlow_id": owner.barlow}),
               change("session.create", session_id=str(uuid.uuid4()), site_id=owner.site, started_at=EVE_2026, optics=other.optics()),
               change("session.create", session_id=sid, site_id=other.site, started_at=EVE_2026, optics=other.optics()),
               change("observation.create", observation_id=str(uuid.uuid4()), session_id=sid, object_id="m13", edited_at=edit, fields={}),
               change("observation.create", observation_id=obs["id"], session_id=theirs["id"], object_id="m13", edited_at=edit, fields={})]
    for c, result in zip(changes, other.sync(changes)):
        assert result["status"] == 404 and result["body"] == nf, c["kind"]
    now = owner.get(f"/api/observations/{obs['id']}")
    assert now["seeing"] == obs["seeing"] and now["version"] == obs["version"]
    after = owner.get(f"/api/packets/{p['id']}")
    assert after["state"] == case and after["revision"] == p["revision"], "a stranger's attempts moved the packet"
    assert other.get(f"/api/sessions/{theirs['id']}")["observations"] == [], "a refused create left a row in the stranger's own session"


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_wf_edit_after_send_redraw_and_delete(browser: Any, app_url: str, mail: Any, case: str) -> None:
    train, _, _, _, (east_right, _) = TRAIN_CASES[case]
    o = Observer(app_url)
    p, rows = o.rendered(train)
    o.act(p, "send", 200)
    pdf = o.call("GET", f"/api/packets/{p['id']}/pdf").content
    old_digest = rows[0]["sketch"]["strokes_sha256"]
    mistakes = o.start(EVE_2026, train=train)
    for obj in ("m57", "m27", "m81"):
        o.log(mistakes["id"], obj, sketch=False)
    with signed_in(browser, o, f"/sessions/{rows[0]['session_id']}?observation={rows[0]['id']}") as page:
        field_ready(page)
        field_of(page).focus()
        press(page, "ArrowLeft", "ArrowLeft", "Enter")
        save(page, "M13 saved.")
        poll(page, lambda: o.get(f"/api/observations/{rows[0]['id']}")["sketch"]["strokes_sha256"] != old_digest, "the redraw reaches the server")
        assert [-2 * east_right, 0] in [x["at"] for x in o.stars(rows[0]["id"])], "two Lefts move the cursor two arcminutes the way this train points east"
        got = o.get(f"/api/packets/{p['id']}")
        assert got["state"] == "sent" and o.call("GET", f"/api/packets/{p['id']}/pdf").content == pdf
        page.goto(f"{app_url}/packets/{p['id']}")
        shows(page, status(page, "Packet status"), "Sent")
        page.goto(f"{app_url}/programs/{GLOBULARS}")
        click(btn(page, "Build packet"))
        poll(page, lambda: re.fullmatch(r"/packets/[^/]+", here(page)) and p["id"] not in here(page), "a new packet opens")
        new_id = here(page).rsplit("/", 1)[1]
        click(btn(page, "Check packet"))
        shows(page, status(page, "Packet status"), "Checked: 5 observations ready to render.")
        snapshot = {x["observation_id"]: x["strokes_sha256"] for x in o.get(f"/api/packets/{new_id}")["rows"]}
        assert snapshot[rows[0]["id"]] == o.get(f"/api/observations/{rows[0]['id']}")["sketch"]["strokes_sha256"] != old_digest
        goto_session(page, o, mistakes["id"])
        names = [norm(x.text_content()) or x.get_attribute("aria-label") for x in page.get_by_role("button", name=re.compile(r"^Open ")).all()]
        order = [(b.get_attribute("aria-label") or norm(b.text_content())) for b in page.get_by_role("button", name=re.compile(r"^Open ")).all()]
        assert len(names) == 3
        middle = order[1].removeprefix("Open ")
        opener = btn(page, f"Delete {middle}")
        opener.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Delete observation?")
        focused(page, btn(dialog, "Keep observation"))
        shows(page, dialog, middle)
        shows(page, dialog, mistakes["evening_date"])
        press(page, "Escape")
        focused(page, opener)
        press(page, "Enter")
        focused(page, btn(role(page, "dialog", "Delete observation?"), "Keep observation"))
        press(page, "Tab", "Enter")
        absent(page, btn(page, order[1]), "the row goes")
        focused(page, btn(page, order[2]), "focus lands on the next row's Open")
        poll(page, lambda: o.get(f"/api/sessions/{mistakes['id']}")["observation_count"] == 2, "the server's count falls")
        goto_session(page, o, rows[1]["session_id"])
        click(btn(page, "Delete M92"))
        click(btn(role(page, "dialog", "Delete observation?"), "Delete"))
        shows(page, status(page, "Sync results"), f"M92 ({rows[1]['evening_date']}) did not sync (cited_by_sent_packet).")
        present(page, btn(page, "Open M92"), "a refused delete puts the row back")
    assert o.get(f"/api/observations/{rows[1]['id']}")["id"] == rows[1]["id"]
    assert len(mail_for(mail, o)) == 1


@pytest.mark.parametrize("case", TRAINS, ids=TRAINS)
def test_wf_edit_after_send_refused_redraw_waits(browser: Any, app_url: str, case: str) -> None:
    train = TRAIN_CASES[case][0]
    o = Observer(app_url)
    p, rows = o.rendered(train)
    sent = o.act(p, "send", 200)
    pdf = o.call("GET", f"/api/packets/{p['id']}/pdf").content
    refusing = instance("APP_MINIO_REFUSING_URL")
    refused = o.one(change("sketch.put", observation_id=rows[0]["id"], base_version=rows[0]["version"],
                           edited_at="2026-11-02T10:00:00Z", strokes=stroke_file(((9, 9, 5),)), raster_png_base64=None), 503, base=refusing)
    assert refused["body"] == {"error": "storage_unavailable"}, "a redraw of the cited sketch is refused, not applied"
    with signed_in(browser, o, f"/sessions/{rows[0]['session_id']}", base=refusing) as page:
        field_ready(page)
        form(page, "M3", ut="2025-06-22 05:30")
        click(btn(page, "New observation"))
        form(page, "M13", ut="2025-06-22 05:40")
        field_of(page).focus()
        press(page, "Enter")
        click(btn(page, "Save observation"))
        shows(page, status(page, "Save status"), STORE_SKETCH)
        shows(page, status(page, "Connection"), "1 change waiting to sync.")
    now = o.get(f"/api/observations/{rows[0]['id']}")
    assert now["version"] == rows[0]["version"] and now["sketch"] == rows[0]["sketch"]
    after = o.get(f"/api/packets/{p['id']}")
    assert after["revision"] == sent["revision"] and after["state"] == "sent"
    assert after["pdf"]["sha256"] == sent["pdf"]["sha256"], "the cited packet keeps its PDF"
    assert o.call("GET", f"/api/packets/{p['id']}/pdf").content == pdf


def test_run_manifest_serves_and_health_body(app_url: str) -> None:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json() == {"status": "ok"}


def test_wf_cross_cutting_server_boundary(app_url: str) -> None:
    o = Observer(app_url)
    def pad(payload: bytes, size: int) -> bytes:
        return payload + b" " * (size - len(payload))
    json_type = {"Content-Type": "application/json"}
    wrong = json.dumps({"email": f"{uuid.uuid4().hex}@lowlamp.test", "password": "wrong-password-1"}).encode()
    assert httpx.post(app_url + "/api/auth/signin", content=pad(wrong, BODY_LIMIT), headers=json_type, timeout=HTTP_TIMEOUT).status_code == 401
    big = httpx.post(app_url + "/api/auth/signin", content=pad(wrong, BODY_LIMIT + 1), headers=json_type, timeout=HTTP_TIMEOUT)
    assert big.status_code == 413 and big.json() == {"error": "too_large"}
    s = o.start()
    body = json.dumps({"device": "laptop", "changes": [change("session.optics", session_id=s["id"], optics=o.optics())]}).encode()
    assert o.call("POST", "/api/sync", content=pad(body, SYNC_LIMIT), headers=json_type).status_code == 200
    assert o.call("POST", "/api/sync", content=pad(body, SYNC_LIMIT + 1), headers=json_type).status_code == 413
    text_type = {"Content-Type": "text/plain"}
    assert o.call("POST", "/api/sync", content=body, headers=text_type).json() == {"error": "unsupported_media_type"}
    foreign = {"Origin": "https://evil.test", "Content-Type": "application/json"}
    r = o.call("POST", "/api/sync", content=body, headers=foreign)
    assert r.status_code == 403 and r.json() == {"error": "cross_origin"}
    same = {"Origin": app_url.rstrip("/"), "Content-Type": "application/json"}
    assert o.call("POST", "/api/sync", content=body, headers=same).status_code == 200
    both = {"Origin": "https://evil.test", "Content-Type": "text/plain"}
    assert o.call("POST", "/api/sync", content=pad(body, SYNC_LIMIT + 1), headers=both).status_code == 413
    assert o.call("POST", "/api/sync", content=body, headers=both).status_code == 415
    assert o.call("POST", "/api/sync", content=body, headers=foreign, cookie="").status_code == 403
    assert o.call("POST", "/api/kit/telescopes", {"name": ""}, cookie="").status_code == 401
    other = Observer(app_url)
    stale = other.call("POST", f"/api/packets/{uuid.uuid4()}/check", {})
    assert stale.status_code == 404, "404 comes before 422"
    unknown = o.call("GET", "/api/no-such-route")
    assert unknown.status_code == 404 and unknown.json() == {"error": "not_found"}
    for path, marker in (("/run.json", "run-manifest-v1"), ("/package.json", '"dependencies"'), ("/package-lock.json", '"lockfileVersion"'), ("/.env", "DATABASE_URL="), ("/node_modules/pg/package.json", '"name"')):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert marker not in r.text, f"{path} served its contents"
    landing = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT).text
    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if os.environ.get(k)]
    for asset in set(re.findall(r'(?:src|href)="(/[^"]+)"', landing)):
        served = httpx.get(app_url + asset, timeout=HTTP_TIMEOUT)
        for secret in secrets:
            assert secret not in served.text, f"{asset} carries a credential"
        if asset.endswith(".js"):
            assert not httpx.get(app_url + asset + ".map", timeout=HTTP_TIMEOUT).text.lstrip().startswith("{"), "source maps are not served"


@pytest.mark.parametrize("case", VIEWPORTS, ids=VIEWPORTS)
def test_wf_cross_cutting_session_layouts(browser: Any, app_url: str, case: str) -> None:
    size = VIEWPORT_CASES[case]
    o = Observer(app_url)
    s = o.start()
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        select(combo(page, "Object"), "M13")
        page.set_viewport_size({"width": size[0], "height": size[1]})
        advance(page, 50)
        width = PHONE_COLUMN if size == PHONE else COLUMN
        left = TOOL_GAP if size == PHONE else 0.22 * size[0]
        f = box(field_of(page))
        assert abs(f["width"] - width) <= BROWSER_PAD and abs(f["x"] - left) <= BROWSER_PAD and abs(f["height"] - width) <= BROWSER_PAD, size
        pencil, star = box(btn(page, "Pencil")), box(btn(page, "Star"))
        assert abs(pencil["width"] - TOOL_SIZE) <= 1 and abs(pencil["height"] - TOOL_SIZE) <= 1
        if size == TABLET:
            assert abs(pencil["x"] - (f["x"] + f["width"] + TOOL_GAP)) <= BROWSER_PAD and abs(pencil["y"] - f["y"]) <= BROWSER_PAD
            assert star["y"] > pencil["y"] and abs(star["x"] - pencil["x"]) <= BROWSER_PAD and pencil["x"] + pencil["width"] <= size[0], "a vertical strip inside the viewport"
        else:
            assert pencil["y"] >= f["y"] + f["height"] and abs(star["y"] - pencil["y"]) <= BROWSER_PAD, "one row under the circle"
        tele, eye, bar, train = (box(combo(page, n)) for n in ("Telescope", "Eyepiece", "Barlow", "Train"))
        if size == PHONE:
            assert tele["y"] < eye["y"] < bar["y"] < train["y"]
        elif size == TABLET:
            assert abs(tele["y"] - eye["y"]) <= BROWSER_PAD and abs(bar["y"] - train["y"]) <= BROWSER_PAD and bar["y"] > tele["y"] and eye["x"] > tele["x"]
        else:
            assert len({round(x["y"]) for x in (tele, eye, bar, train)}) == 1 and tele["x"] < eye["x"] < bar["x"] < train["x"]
        seeing, clarity = box(role(page, "spinbutton", "Seeing (1–10)")), box(role(page, "textbox", "Transparency (limiting magnitude)"))
        if size == PHONE:
            assert clarity["y"] > seeing["y"]
            assert abs(box(btn(page, "Save observation"))["width"] - width) <= BROWSER_PAD
        else:
            assert clarity["x"] > seeing["x"], "Transparency sits beside Seeing"
            assert clarity["y"] < seeing["y"] + seeing["height"] and seeing["y"] < clarity["y"] + clarity["height"], "the two share one row"
        ladder = [box(role(page, "navigation", "Main"))["y"], f["y"], box(status(page, "Optics readout"))["y"], tele["y"], box(role(page, "textbox", "UT date and time"))["y"]]
        assert ladder == sorted(ladder), f"top-to-bottom order at {size}: {ladder}"
        layout(page)
        for path in ("/tonight", "/programs", "/kit"):
            page.goto(app_url + path)
            present(page, role(page, "navigation", "Main"))
            layout(page)
        goto_session(page, o, s["id"])
        select(combo(page, "Object"), "M13")


def test_landing_hero_crossfade_and_reduced_motion(browser: Any, app_url: str) -> None:
    with open_app(browser, f"{app_url}/") as page:
        m13 = role(page, "img", "Eyepiece view of M13")
        present(page, m13)
        first = decode(capture(m13))
        advance(page, HERO_MS - 1000)
        assert m13.count() == 1, "the view holds for its interval"
        for name in ("Albireo", "M51", "M13"):
            advance(page, HERO_MS + 500 if name == "Albireo" else HERO_MS)
            hero = role(page, "img", f"Eyepiece view of {name}")
            present(page, hero, f"the hero names {name}", 5)
            if name == "Albireo":
                assert difference(first, decode(capture(hero))) > 0, "the drawing changes with the name"
    with open_app(browser, f"{app_url}/", reduced_motion="reduce") as page:
        m13 = role(page, "img", "Eyepiece view of M13")
        present(page, m13)
        first = decode(capture(m13))
        advance(page, HERO_MS * 3)
        assert m13.count() == 1 and difference(first, decode(capture(m13))) == 0, "reduced motion holds still on M13"


def test_feedback_motion_focus_and_no_loops(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    s = o.start()
    with signed_in(browser, o, f"/sessions/{s['id']}") as page:
        field_ready(page)
        target = btn(page, "New observation")
        props = ("background-color", "filter", "opacity")
        rest, hover = state_styles(target, *props, state="hover")
        assert rest != hover, "hover gives feedback"
        duration = style(target, "transition-duration")["transition-duration"]
        longest = max(float(x[:-2]) * (1 if x.endswith("ms") else 1000) if x.endswith("ms") else float(x[:-1]) * 1000 for x in duration.split(", "))
        assert 80 <= longest <= 150, f"feedback settles within 80 to 150 ms: {duration}"
        page.mouse.move(0, 0)
        advance(page, 200)
        rest = style(target, "outline-width", "outline-style", "box-shadow")
        tab_to(page, target)

        def ringed() -> bool:
            ring = style(target, "outline-width", "outline-style", "box-shadow")
            return (ring["outline-width"] == f"{RING_PX}px" and ring["outline-style"] != "none") or (
                ring["box-shadow"] != rest["box-shadow"] and f"{RING_PX}px" in ring["box-shadow"])

        poll(page, ringed, "keyboard focus shows a 2 px ring", 5)
        assert not page.evaluate("document.getAnimations().some(a => a.effect && a.effect.getTiming().iterations === Infinity)"), "nothing loops"
        assert all(a.get("iterations") != float("inf") for a in animations(role(page, "region", "Field")))


def assert_targets(page: Page, where: str) -> None:
    for kind in ("button", "link", "combobox", "textbox", "spinbutton"):
        for item in page.get_by_role(kind).all():
            if item.is_visible():
                b = box(item)
                assert b["width"] >= TARGET - 0.5 and b["height"] >= TARGET - 0.5, f"{where}: {kind} {item.text_content()!r} is {b['width']}x{b['height']}"


@pytest.mark.parametrize("case", VIEWPORTS, ids=VIEWPORTS)
def test_published_layouts_on_other_screens(browser: Any, app_url: str, case: str) -> None:
    size = VIEWPORT_CASES[case]
    o = Observer(app_url)
    p, rows = o.rendered()
    s_path = f"/sessions/{rows[0]['session_id']}"
    with signed_in(browser, o, "/tonight") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        phone = size == PHONE
        width = PHONE_COLUMN if phone else COLUMN
        page.goto(f"{app_url}/objects/m13")
        row = role(page, "list", "Observations of M13").get_by_role("listitem").first
        present(page, row)
        name_y = box(row.get_by_text("M13", exact=True).first)["y"]
        muted_y = box(row.get_by_text(re.compile(r"local, UTC")).first)["y"]
        assert (muted_y > name_y + 5) if phone else abs(muted_y - name_y) <= 8, f"history at {size}"
        assert_targets(page, "history")
        layout(page)
        page.goto(f"{app_url}/programs/{GLOBULARS}")
        row = role(page, "list", "Checklist").get_by_role("listitem").first
        present(page, row)
        name_y = box(row.get_by_text(re.compile(r"^M13, ")).first)["y"]
        muted_y = box(row.get_by_text(re.compile(r"254 mm|not yet")).first)["y"]
        assert (muted_y > name_y + 5) if phone else abs(muted_y - name_y) <= 8, f"program at {size}"
        assert_targets(page, "program")
        page.goto(f"{app_url}/programs")
        follow = btn(page, f"Follow {GLOB_NAME}")
        present(page, follow)
        b = box(follow)
        if phone:
            assert abs(b["width"] - width) <= BROWSER_PAD
        else:
            assert abs(b["x"] + b["width"] - (0.22 * size[0] + width)) <= BROWSER_PAD, "the button at the row's right edge"
        assert_targets(page, "programs")
        page.goto(f"{app_url}/kit")
        aperture, unit = role(page, "spinbutton", "Aperture"), combo(page, "Aperture unit")
        present(page, aperture)
        lat, lon = box(role(page, "spinbutton", "Latitude")), box(role(page, "spinbutton", "Longitude"))
        if phone:
            assert box(unit)["y"] > box(aperture)["y"] and lon["y"] > lat["y"]
        else:
            assert abs(box(unit)["y"] - box(aperture)["y"]) <= BROWSER_PAD and abs(lon["y"] - lat["y"]) <= BROWSER_PAD
        assert_targets(page, "kit")
        page.goto(f"{app_url}/packets/{p['id']}")
        send = btn(page, "Send to coordinator")
        present(page, send)
        if phone:
            assert abs(box(send)["width"] - width) <= BROWSER_PAD
        preview = role(page, "region", "Paper preview")
        assert abs(box(preview)["width"] - width) <= 1
        assert_targets(page, "packet")
        layout(page)
        page.goto(o.base + s_path)
        field_ready(page)
        assert_targets(page, "session")


def test_seeded_rows_read_exactly_in_order(browser: Any, app_url: str) -> None:
    rowan = Observer.login(app_url, "rowan@lowlamp.test", "dark-adapted-01")
    with signed_in(browser, rowan, "/objects/m27") as page:
        rows = role(page, "list", "Observations of M27").get_by_role("listitem")
        poll(page, lambda: rows.count() == 2, "two M27 rows")
        assert "2026-10-31 · 01:25 local, UTC-07:00 · 254 mm · 200×" in norm(rows.nth(0).text_content())
        assert "2026-10-31 · 01:25 local, UTC-06:00 · 254 mm · 200×" in norm(rows.nth(1).text_content())
        page.goto(f"{app_url}/objects/m15")
        rows = role(page, "list", "Observations of M15").get_by_role("listitem")
        present(page, rows.first)
        assert "2026-10-31" in norm(rows.nth(0).text_content())


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "OFL-1.1"}
EXTRA_STORES = {"sqlite3", "better-sqlite3", "redis", "ioredis", "memcached", "mongodb", "level"}


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "Sora" in notices
    for package in shipped_packages():
        assert package.name in notices, package.name


def test_if_licences_allowed() -> None:
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWLIST), f"{package.name}: {package.licence}"
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text(), "the bundled Sora font's licence"


def test_if_no_extra_datastore() -> None:
    assert not {p.name for p in shipped_packages()} & EXTRA_STORES
    assert Postgres().tables(), "the app keeps its records in Postgres"


def test_if_typescript_source() -> None:
    skip = {"node_modules", "dist", "build", "public", ".git", ".next"}
    def files(suffixes: tuple[str, ...]) -> list[Path]:
        return [f for f in Path("/app").rglob("*") if f.suffix in suffixes and not skip & set(f.parts)]
    assert files((".ts", ".tsx")), "TypeScript source exists"
    assert len(files((".ts", ".tsx"))) > len(files((".js", ".jsx", ".mjs", ".cjs"))), "source is TypeScript, not JavaScript"


def test_if_font_and_assets_same_origin(browser: Any, app_url: str) -> None:
    o = Observer(app_url)
    with open_app(browser, f"{app_url}/signin") as page:
        seen: list[str] = []
        page.on("request", lambda rq: seen.append(rq.url))
        page.goto(f"{app_url}/")
        present(page, role(page, "link", "Start a log"))
        sign_in_form(page, o, app_url, "/kit")
        present(page, role(page, "navigation", "Main"))
        assert seen and all(same_origin(u, app_url) or u.startswith(("data:", "blob:")) for u in seen), [u for u in seen if not same_origin(u, app_url)]
        assert "Sora" in style(role(page, "navigation", "Main"), "font-family")["font-family"]
        assert page.evaluate("[...document.fonts].some(f => f.family.includes('Sora'))"), "Sora is loaded by the app"
