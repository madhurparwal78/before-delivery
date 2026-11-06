from __future__ import annotations

import base64
import functools
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
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from statistics import median
from typing import Any, Callable
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import (
    S3,
    addresses,
    advance,
    check,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    session,
    state_styles,
    tab_order,
    tap,
    text,
    unique,
)


RADIUS_M = 60
DOOR_M = 4.0
WALK_MPS = 4
TURN_DEG_PER_S = 120
LANTERN_ARC_M = 54.7
LANTERN_BEARING = 51
LANTERN_READOUT = "Bearing NE 51°, 55 m"
LANTERN_TITLE = "Lantern oil for the mill"
LANTERN_OFFER = ["The mill lamps are sputtering again.", "Bring me a tin of lantern oil from the depot, would you?"]
LANTERN_THANKS = "Bright as noon. Here, take these stamps."
LANTERN_REWARD = 5
STAR_REWARD = 8
GUEST_AFTER_TWO = 13
GUEST_AFTER_PINK = 1
RISO_PINK_PRICE = 12
SUNPATCH_PRICE = 20
JSON_LIMIT = 16384
UPLOAD_LIMIT = 2000000
MIN_SIDE_PX = 320
MAX_SIDE_PX = 2048
CAPTURE_W = 1200
CAPTURE_H = 800
MAIL_LIMIT = 5
MAIL_WINDOW_S = 600
SHORT_HOLD_S = 4
SHORT_KEY_TTL_S = 5
NAME_MAX = 24
TITLE_MAX = 60
LINE_MAX = 200
RETURN_TO_MAX = 200
EMAIL_MAX = 254
AHEAD_DAYS = 366
PAST_GRACE_S = 60
DAY_S = 86400
TIMING_GAP_S = 0.1
SHARE_TOKEN_MIN = 32
ACC_ID = re.compile(r"^acc_[a-z0-9]{16,}$")
PC_ID = re.compile(r"^pc_[a-z0-9]{16,}$")
ISO_MS = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
COURIER_NAME = re.compile(r"^Courier \d{4}$")
GHOST_ACC = "acc_0000000000000000"
OTTOLINE = "Ottoline Fennick"
BARNABY = "Barnaby Sorrel"
LANTERN_HOME = "Lantern Mill"
RISO_NAME = "Riso Pink Satchel"
SUNPATCH_NAME = "Sunpatch Satchel"
PROBE_DIALOGUE = {"offer": ["Take this, please."], "thanks": ["Thank you."]}
BOARD_HOUR = 4

INTRO_MIN_MS = 1200
INTRO_MAX_MS = 1800
INTRO_FAR_M = 230
INTRO_NEAR_M = 8.2
INTRO_FOV = 40
FOLLOW_FOV = 55
FOLLOW_DIST = (7.4, 8.2)
PHOTO_FOV = 50
FOV_MIN = 30
FOV_MAX = 70
YAW_STEP = 15
ZOOM_STEP = 5
DRAG_PX_PER_DEG = 4
CLEARANCE_M = 1.5
TILT_MAX = 1.0
SKIP_MS = 100
PULLBACK_MS = (300, 550)
UNSPOOL_MS = (500, 750)
RETURN_MS = (250, 500)
SETTLE_MS = (300, 500)
TURN_RAMP_MS = (150, 250)
NOTICE_MS = (150, 250)
LETTER_UNFOLD_MS = (300, 500)
LETTER_FOLD_MS = (200, 300)
FADE_MS = (200, 400)
GLIDE_MS = (800, 1200)
SNAP_M = 20
JUMP_MAX_MS = 1000
RIBBON_GONE_MS = 400
RIBBON_NEAR_PX = 24
RIBBON_CLEAR_PX = 48
TEAL = (31, 127, 122)
TEAL_TOL = 24
LAPSE_MS = 11000
SWITCH_MS = 500
CLOUD_ORBIT_S = (60, 120)
RESUME_MS = 100
CONSOLE_REFRESH_MS = 5000
DRAWER_RELOAD_MS = 5000
STATUS_RECOVER_S = 10
ORBIT_ARC_DEG = 150
CARD_W_1280 = (240, 320)
RING_W_1280 = (512, 768)
CARD_W_768 = (200, 280)
RING_W_768 = (384, 576)
RING_W_375 = (120, 180)
RING_CENTRE_PX = 8
PHONE = (375, 812)
TABLET = (768, 1024)
LAPTOP = (1280, 800)

NOT_FOUND = {"error": {"code": "not_found", "message": "Nothing was found here."}}
DARKROOM_CLOSED = {"error": {"code": "darkroom_closed", "message": "The darkroom is closed."}}
POST_OFFICE_CLOSED = {"error": {"code": "post_office_closed", "message": "The post office is closed."}}
FOUNDER_EMAIL = "wren@kitefold.example"
HELPER_EMAIL = "odile@kitefold.example"
POSTCARD_SENDER = "postcards@kitefold.example"
MAIL_FROM_VALUE = "Parcel Moon <postbox@kitefold.example>"
FORBIDDEN_WORDS = re.compile(r"\b(minio|s3|smtp|nodemailer|econnrefused|etimedout|ehostunreach|enotfound|getaddrinfo)\b", re.I)
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib", "CC0-1.0", "OFL-1.1"}

TIMEOUT_S = 30
MAIL_WAIT_S = 60
UI_WAIT_S = 90
SERVER_WAIT_S = 120
STEP_MS = 50
STEER_STEPS = 220
BOOT_WAIT_S = 180


def api(base: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=TIMEOUT_S)


def on(base: str, cookie: str) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=TIMEOUT_S, headers={"Cookie": f"pm_session={cookie}"})


def jar_cookie(c: httpx.Client) -> str:
    values = [ck.value for ck in c.cookies.jar if ck.name == "pm_session"]
    assert values, "no pm_session cookie was issued"
    return values[-1]


def outage(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"{name} is not set"
    return value.rstrip("/")


def new_guest(base: str) -> httpx.Client:
    c = api(base)
    r = c.post("/api/guest", json={})
    assert r.status_code == 201, r.text
    return c


def fresh_email(prefix: str = "courier") -> str:
    return next(v for v in unique(prefix) if "@" in v)


def fresh_name(prefix: str = "R") -> str:
    return f"{prefix}{uuid.uuid4().hex[:10]}"


def err(r: httpx.Response, status: int, code: str | None = None, fields: dict[str, str] | None = None) -> dict:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert set(body) == {"error"}, body
    if code:
        assert body["error"]["code"] == code, body
    if fields is not None:
        assert body["error"]["code"] == "validation", body
        for k, v in fields.items():
            assert body["error"]["fields"].get(k) == v, body
    return body["error"]


def mails_to(mail, address: str, settle: float = 0.5) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=settle) if address.lower() in [a.lower() for a in addresses(m.get("To"))]]


def wait_mails(mail, address: str, count: int) -> list[dict[str, Any]]:
    deadline = time.monotonic() + MAIL_WAIT_S
    while True:
        got = mails_to(mail, address)
        if len(got) >= count:
            return mails_to(mail, address, settle=1.5)
        assert time.monotonic() < deadline, f"expected {count} mails to {address}, saw {len(got)}"


CLAIM_RE = re.compile(r"(/claim\?token=[A-Za-z0-9_\-.~%]+)")


def key_links(mail, email: str) -> set[str]:
    return {link for m in mails_to(mail, email, settle=0.2) for link in CLAIM_RE.findall(text(m))}


def request_key(base: str, mail, email: str, return_to: str | None = None) -> str:
    before = key_links(mail, email)
    body: dict[str, Any] = {"email": email}
    if return_to is not None:
        body["return_to"] = return_to
    r = api(base).post("/api/auth/postbox-key", json=body)
    assert r.status_code == 200 and r.json() == {"status": "sent"}, r.text
    deadline = time.monotonic() + MAIL_WAIT_S
    while True:
        new = key_links(mail, email) - before
        if new:
            return new.pop()
        assert time.monotonic() < deadline, f"no postbox key mail reached {email}"


def token_of(link: str) -> str:
    return link.split("token=", 1)[1]


def sign_in(base: str, mail, email: str, c: httpx.Client | None = None) -> tuple[httpx.Client, dict]:
    c = c or api(base)
    link = request_key(base, mail, email)
    r = c.post("/api/auth/redeem", json={"token": token_of(link)})
    assert r.status_code == 200, r.text
    return c, r.json()


def founder(base: str, mail) -> httpx.Client:
    return sign_in(base, mail, FOUNDER_EMAIL)[0]


def helper(base: str, mail) -> httpx.Client:
    return sign_in(base, mail, HELPER_EMAIL)[0]


def courier(base: str, mail, prefix: str = "courier") -> tuple[httpx.Client, str, str]:
    email = fresh_email(prefix)
    c, _ = sign_in(base, mail, email)
    name = fresh_name()
    r = c.patch("/api/me", json={"display_name": name})
    assert r.status_code == 200, r.text
    return c, email, name


def me(c: httpx.Client) -> dict:
    r = c.get("/api/me")
    assert r.status_code == 200, r.text
    return r.json()


def im(m: dict) -> dict[str, str]:
    return {"If-Match": f'"{m["revision"]}"'}


def create_mission(f: httpx.Client, *, kind: str = "standard", slots: int | None = None, reward: int = 7,
                   resident: str = "ottoline", title: str | None = None) -> dict:
    body = {
        "title": title or f"Errand {uuid.uuid4().hex[:12]}",
        "resident_id": resident,
        "reward_stamps": reward,
        "kind": kind,
        "rush_slots": slots,
        "dialogue": PROBE_DIALOGUE,
    }
    r = f.post("/api/founder/missions", json=body)
    assert r.status_code == 201, r.text
    return r.json()


def publish(f: httpx.Client, m: dict) -> dict:
    r = f.post(f"/api/founder/missions/{m['mission_id']}/schedule", json={"live_at": "now"}, headers=im(m))
    assert r.status_code == 200 and r.json()["status"] == "live", r.text
    return r.json()


def live_mission(f: httpx.Client, **kw: Any) -> dict:
    return publish(f, create_mission(f, **kw))


def mission(f: httpx.Client, mid: str) -> dict:
    r = f.get(f"/api/founder/missions/{mid}")
    assert r.status_code == 200, r.text
    return r.json()


def retire_quiet(f: httpx.Client, mid: str) -> None:
    m = f.get(f"/api/founder/missions/{mid}").json()
    if m.get("status") == "live":
        f.post(f"/api/founder/missions/{mid}/retire", json={}, headers=im(m))


def doors(c: httpx.Client) -> dict[str, dict]:
    return {r["resident_id"]: r["door"] for r in c.get("/api/world").json()["residents"]}


DEPOT = {"lat": 0, "lon": 0}


def accept_path(mid: str) -> str:
    return f"/api/missions/{mid}/accept"


def accept(c: httpx.Client, mid: str, pos: Any = DEPOT) -> httpx.Response:
    return c.post(accept_path(mid), json={"position": pos})


def claim(c: httpx.Client, rush_id: str, pos: Any = DEPOT) -> httpx.Response:
    return c.post(f"/api/rush/{rush_id}/claim", json={"position": pos})


def hand_over(c: httpx.Client, acc: str, pos: dict, ticket: str | None = None) -> httpx.Response:
    return c.post("/api/deliveries", json={"acceptance_id": acc, "position": pos},
                  headers={"Handover-Ticket": ticket or idempotency_key()})


def drop(c: httpx.Client, acc: str) -> httpx.Response:
    return c.post(f"/api/acceptances/{acc}/drop", json={})


def deliver(c: httpx.Client, mid: str, door: dict) -> dict:
    a = accept(c, mid)
    assert a.status_code == 201, a.text
    d = hand_over(c, a.json()["acceptance_id"], door)
    assert d.status_code == 201, d.text
    return d.json()


def buy_path(satchel: str) -> str:
    return f"/api/outfitter/{satchel}/buy"


def buy(c: httpx.Client, satchel: str, ticket: str | None = None) -> httpx.Response:
    return c.post(buy_path(satchel), headers={"Purchase-Ticket": ticket or idempotency_key()})


def rush_rows(c: httpx.Client, mid: str) -> list[dict]:
    return [r for r in c.get("/api/depot").json()["rush"] if r["mission_id"] == mid]


def ledger(c: httpx.Client, **params: Any) -> httpx.Response:
    return c.get("/api/me/ledger", params=params)


def upload(c: httpx.Client, body: bytes | None = None) -> httpx.Response:
    return c.post("/api/postcards", content=png() if body is None else body, headers={"Content-Type": "image/png"})


def mail_card(c: httpx.Client, pid: str, to: str, ticket: str | None = None) -> httpx.Response:
    return c.post(f"/api/postcards/{pid}/mail", json={"to": to}, headers={"Mail-Ticket": ticket or idempotency_key()})


class Beat:
    def __init__(self, c: httpx.Client):
        self.c = c
        self.stream = f"s{uuid.uuid4().hex[:16]}"
        self.seq = 0
        self.last = 0.0

    def send(self, lat: float = 0.2, lon: float = 0.2, heading: float = 0.0, emote: str | None = None,
             seq: int | None = None) -> httpx.Response:
        if seq is None:
            self.seq += 1
            seq = self.seq
        body: dict[str, Any] = {"stream": self.stream, "seq": seq,
                                "position": {"lat": lat, "lon": lon, "heading_deg": heading}}
        if emote is not None:
            body["emote"] = emote
        self.last = time.monotonic()
        return self.c.post("/api/presence", json=body)

    def keep(self, pos: dict | None = None) -> None:
        if time.monotonic() - self.last > 1:
            pos = pos or {"lat": 0.2, "lon": 0.2}
            self.send(lat=pos["lat"], lon=pos["lon"])


def presence(c: httpx.Client) -> list[dict]:
    r = c.get("/api/presence")
    assert r.status_code == 200, r.text
    return r.json()["couriers"]


def named(entries: list[dict], name: str) -> list[dict]:
    return [e for e in entries if e["display_name"] == name]


def staff_entry(staff: httpx.Client, name: str) -> dict:
    found = [e for e in staff.get("/api/moderation/presence").json()["couriers"] if e["display_name"] == name]
    assert len(found) == 1, found
    return found[0]


def together(fns: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(fns))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(fns)) as ex:
        return list(ex.map(run, fns))


def server_time(c: httpx.Client) -> datetime:
    return parsedate_to_datetime(c.get("/api/health").headers["date"])


def wait_server(c: httpx.Client, when: datetime) -> None:
    deadline = time.monotonic() + SERVER_WAIT_S
    while server_time(c) < when:
        assert time.monotonic() < deadline, "server clock never reached the awaited instant"


def iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def fmt_iso(dt: datetime) -> str:
    dt = dt.astimezone(timezone.utc)
    return dt.strftime("%Y-%m-%dT%H:%M:%S.") + f"{dt.microsecond // 1000:03d}Z"


def local_times(moment: datetime, zone: str) -> list[datetime]:
    out = [moment.astimezone(ZoneInfo(zone)).replace(tzinfo=None)]
    if zone == "America/Vancouver":
        out.append(moment.astimezone(timezone.utc).replace(tzinfo=None) - timedelta(hours=8))
    return out


def board_dates_at(moment: datetime, zone: str) -> set[str]:
    return {(t.date() if t.hour >= BOARD_HOUR else t.date() - timedelta(days=1)).isoformat()
            for t in local_times(moment, zone)}


def arc_m(a: dict, b: dict) -> float:
    p1, l1, p2, l2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin((l2 - l1) / 2) ** 2
    return 2 * RADIUS_M * math.asin(min(1.0, math.sqrt(h)))


def bearing_deg(a: dict, b: dict) -> int:
    p1, l1, p2, l2 = map(math.radians, (a["lat"], a["lon"], b["lat"], b["lon"]))
    y = math.sin(l2 - l1) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(l2 - l1)
    return round(math.degrees(math.atan2(y, x))) % 360


def towards(p: dict, metres: float, brg: float) -> dict:
    d, t = metres / RADIUS_M, math.radians(brg)
    p1, l1 = math.radians(p["lat"]), math.radians(p["lon"])
    p2 = math.asin(math.sin(p1) * math.cos(d) + math.cos(p1) * math.sin(d) * math.cos(t))
    l2 = l1 + math.atan2(math.sin(t) * math.sin(d) * math.cos(p1), math.cos(d) - math.sin(p1) * math.sin(p2))
    return {"lat": round(math.degrees(p2), 6), "lon": round((math.degrees(l2) + 540) % 360 - 180, 6)}


def assert_opaque(r: httpx.Response, forbidden: list[str]) -> None:
    blob = r.text + "\n" + "\n".join(f"{k}: {v}" for k, v in r.headers.items())
    assert not FORBIDDEN_WORDS.search(blob), blob
    for s in forbidden:
        assert s not in blob, s
    assert "x-powered-by" not in r.headers and "server" not in r.headers, dict(r.headers)
    assert not re.search(r"\bat \S+ \(?[^\s()]+:\d+:\d+\)?", r.text), r.text


PNG_SIG = b"\x89PNG\r\n\x1a\n"


def chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def ihdr(w: int, h: int, depth: int = 8, colour: int = 2) -> bytes:
    return chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, depth, colour, 0, 0, 0))


@functools.lru_cache(maxsize=None)
def scan(w: int, h: int, filt: int = 0) -> bytes:
    return b"".join(bytes([filt]) + bytes((x * 3 + y) % 251 for x in range(w * 3)) for y in range(h))


def png(w: int = MIN_SIDE_PX, h: int = MIN_SIDE_PX, *, raw: bytes | None = None, before_idat: bytes = b"",
        idat: bytes | None = None, header: bytes | None = None) -> bytes:
    data = zlib.compress(scan(w, h) if raw is None else raw, 9) if idat is None else idat
    return PNG_SIG + (header or ihdr(w, h)) + before_idat + chunk(b"IDAT", data) + chunk(b"IEND", b"")


def decode_rgb(payload: bytes) -> tuple[int, int, Callable[[int, int], tuple[int, int, int]]]:
    pos, w, h, ct, idat = 8, 0, 0, 2, b""
    while pos < len(payload):
        length, kind = struct.unpack(">I4s", payload[pos:pos + 8])
        data = payload[pos + 8:pos + 8 + length]
        pos += 12 + length
        if kind == b"IHDR":
            w, h, _, ct = struct.unpack(">IIBB", data[:10])
        elif kind == b"IDAT":
            idat += data
        elif kind == b"IEND":
            break
    bpp = {0: 1, 2: 3, 4: 2, 6: 4}[ct]
    raw, stride = zlib.decompress(idat), w * bpp
    rows_out: list[bytearray] = []
    prev = bytearray(stride)
    i = 0
    for _ in range(h):
        f, line = raw[i], bytearray(raw[i + 1:i + 1 + stride])
        i += 1 + stride
        for x in range(stride):
            a = line[x - bpp] if x >= bpp else 0
            b = prev[x]
            c = prev[x - bpp] if x >= bpp else 0
            if f == 1:
                line[x] = (line[x] + a) & 255
            elif f == 2:
                line[x] = (line[x] + b) & 255
            elif f == 3:
                line[x] = (line[x] + (a + b) // 2) & 255
            elif f == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[x] = (line[x] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows_out.append(line)
        prev = line

    def px(x: int, y: int) -> tuple[int, int, int]:
        row = rows_out[y]
        if bpp < 3:
            return row[x * bpp], row[x * bpp], row[x * bpp]
        return row[x * bpp], row[x * bpp + 1], row[x * bpp + 2]

    return w, h, px


def teal_within(page: Page, point: tuple[int, int], radius: int) -> bool:
    vw, vh = page.evaluate("() => [innerWidth, innerHeight]")
    x, y = point
    x0, y0 = max(0, x - radius), max(0, y - radius)
    x1, y1 = min(vw, x + radius + 1), min(vh, y + radius + 1)
    if x1 <= x0 or y1 <= y0:
        return False
    shot = session(page).send("Page.captureScreenshot", {
        "format": "png", "clip": {"x": x0, "y": y0, "width": x1 - x0, "height": y1 - y0, "scale": 1}})
    w, h, px = decode_rgb(base64.b64decode(shot["data"]))
    for yy in range(h):
        for xx in range(w):
            if (x0 + xx - x) ** 2 + (y0 + yy - y) ** 2 <= radius ** 2:
                if all(abs(c - t) <= TEAL_TOL for c, t in zip(px(xx, yy), TEAL)):
                    return True
    return False


def bramble(page: Page) -> Locator:
    return page.get_by_role("region", name="Bramble", exact=True)


def route_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Route", exact=True)


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Notices", exact=True)


def compass(page: Page) -> Locator:
    return page.get_by_role("img", name="Horizon compass", exact=True)


def balance_status(page: Page) -> Locator:
    return page.get_by_role("status", name="Stamp balance", exact=True)


def btn(scope: Page | Locator, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


ATTRS_JS = ("els => els.length ? Object.fromEntries([...els[0].attributes].filter(a => a.name.startsWith('data-'))"
            ".map(a => [a.name.slice(5), a.value])) : {}")


def attrs(loc: Locator) -> dict[str, str]:
    return loc.evaluate_all(ATTRS_JS)


def data(loc: Locator, name: str) -> str:
    return attrs(loc).get(name, "")


def txt(loc: Locator) -> str:
    return loc.evaluate_all("els => els.length ? els[0].textContent.replace(/\\s+/g, ' ').trim() : ''")


def present(loc: Locator) -> bool:
    return loc.evaluate_all("els => els.some(e => e.getClientRects().length > 0)")


def is_focused(loc: Locator) -> bool:
    return loc.evaluate_all("els => els.length > 0 && els[0] === document.activeElement")


def focused_label(page: Page) -> str:
    return page.evaluate(
        "() => (document.activeElement.getAttribute('aria-label') || document.activeElement.textContent || '').trim()")


def flt(loc: Locator, name: str) -> float | None:
    v = data(loc, name)
    return float(v) if v else None


def pt(v: str) -> tuple[int, int]:
    x, y = v.split(",")
    return int(x), int(y)


def wait_for(page: Page, pred: Callable[[], Any], *, step_ms: float = 100, limit_ms: float = 10 ** 9,
             seconds: float = UI_WAIT_S) -> float:
    elapsed, deadline = 0.0, time.monotonic() + seconds
    while not pred():
        assert elapsed < limit_ms, f"page state not reached within {limit_ms} ms of page time"
        assert time.monotonic() < deadline, "page state not reached"
        advance(page, step_ms)
        elapsed += step_ms
    return elapsed


def ready_page(page: Page) -> Locator:
    w = bramble(page)
    wait_for(page, lambda: data(w, "scene") in ("ready", "no-webgl")
             and data(w, "intro") in ("done", "skipped", "off"))
    wait_for(page, lambda: "stamps" in txt(balance_status(page)))
    return w


NOTICE_JS = """el => { const log = []; window.__verifierNotices = log;
  const push = () => { const t = el.textContent.replace(/\\s+/g, ' ').trim();
    if (log.length === 0 || log[log.length - 1] !== t) log.push(t); };
  new MutationObserver(push).observe(el, {subtree: true, childList: true, characterData: true}); push(); }"""


def watch_notices(page: Page) -> None:
    notices(page).evaluate(NOTICE_JS)


def notice_count(page: Page, copy: str) -> int:
    return sum(copy in t for t in page.evaluate("() => window.__verifierNotices || []"))


def saw(page: Page, copy: str) -> bool:
    return notice_count(page, copy) > 0


def saw_re(page: Page, pattern: str) -> bool:
    return any(re.search(pattern, t) for t in page.evaluate("() => window.__verifierNotices || []"))


def page_cookie(page: Page) -> str:
    for ck in page.context.cookies():
        if ck["name"] == "pm_session":
            return ck["value"]
    raise AssertionError("the browser holds no pm_session cookie")


def browser_sign_in(page: Page, base: str, mail, email: str) -> None:
    link = request_key(base, mail, email)
    page.goto(f"{base}{link}")
    walk = btn(page, "Walk on Bramble")
    wait_for(page, lambda: present(walk))
    click(walk)
    wait_for(page, lambda: urlparse(page.url).path == "/")
    ready_page(page)


def set_hidden(page: Page, hidden: bool) -> None:
    page.evaluate("""h => { Object.defineProperty(document, 'visibilityState', {configurable: true, get: () => h ? 'hidden' : 'visible'});
      Object.defineProperty(document, 'hidden', {configurable: true, get: () => h});
      document.dispatchEvent(new Event('visibilitychange')); }""", hidden)


def hold(page: Page, key: str, ms: float) -> None:
    page.keyboard.down(key)
    advance(page, ms)
    page.keyboard.up(key)


def open_letter(page: Page, title: str, resident: str) -> Locator:
    board = page.get_by_role("complementary", name="Depot board", exact=True)
    read = btn(board, f"Read {title}")
    wait_for(page, lambda: present(read))
    click(read)
    letter = page.get_by_role("dialog", name=f"Letter from {resident}", exact=True)
    wait_for(page, lambda: data(letter, "fold") == "open")
    return letter


def steer_to_door(page: Page, turn: Callable[[int], None], walk: Callable[[float], None],
                  on_step: Callable[[dict], None] | None = None) -> dict:
    w, route = bramble(page), route_status(page)
    for _ in range(STEER_STEPS):
        r = attrs(route)
        if on_step:
            on_step(r)
        if r.get("thread-phase") == "arrived":
            return r
        arc = float(r.get("arc-remaining-m") or 0)
        diff = (int(r.get("bearing-deg") or 0) - int(data(w, "heading-deg") or 0) + 540) % 360 - 180
        if abs(diff) > 5:
            turn(diff)
            advance(page, TURN_RAMP_MS[1] + STEP_MS)
        else:
            walk(min(1000.0, max(150.0, (arc - 2.5) / WALK_MPS * 1000)))
            advance(page, 100)
    raise AssertionError("the courier never arrived at the door")


def key_walk_to_door(page: Page, on_step: Callable[[dict], None] | None = None) -> dict:
    bramble(page).focus()
    return steer_to_door(
        page,
        lambda diff: hold(page, "d" if diff > 0 else "a", max(40.0, abs(diff) / TURN_DEG_PER_S * 1000 - 100)),
        lambda ms: hold(page, "w", ms), on_step)


def enable_touch(page: Page, size: tuple[int, int]) -> Any:
    page.set_viewport_size({"width": size[0], "height": size[1]})
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    page.reload()
    return cdp


def stick(page: Page, cdp: Any, dx: float, dy: float, ms: float) -> None:
    box = page.get_by_role("group", name="Move stick", exact=True).bounding_box()
    assert box, "Move stick is not on screen"
    cx, cy, r = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2, box["width"] / 2
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": cx, "y": cy, "id": 1}]})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": cx + dx * r, "y": cy + dy * r, "id": 1}]})
    advance(page, ms)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def touch_walk_to_door(page: Page, cdp: Any) -> dict:
    return steer_to_door(
        page,
        lambda diff: stick(page, cdp, 1 if diff > 0 else -1, 0, max(40.0, abs(diff) / TURN_DEG_PER_S * 1000)),
        lambda ms: stick(page, cdp, 0, -1, ms))


def lose_first(store: list, wanted: int = 1) -> Callable[[Any], None]:
    def handler(route: Any) -> None:
        req = route.request
        store.append((req.headers.get("handover-ticket") or req.headers.get("mail-ticket") or "", req.post_data))
        response = route.fetch()
        if len(store) <= wanted:
            route.abort("failed")
        else:
            route.fulfill(response=response)
    return handler


def test_health_and_serving(app_url):
    c = api(app_url)
    r = c.get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    ctype = r.headers["Content-Type"].lower()
    assert ctype.split(";")[0].strip() == "application/json" and "utf-8" in ctype
    assert "Date" in r.headers
    home = c.get("/")
    assert home.status_code == 200 and "HTML" in home.headers["Content-Type"].upper()
    assert c.get("/api/world").json()["radius_m"] == RADIUS_M


def test_server_boundary(app_url):
    c = api(app_url)
    evil = {"Origin": "https://evil.example"}
    err(c.post("/api/guest", json={}, headers=evil), 403, "cross_origin")
    err(c.post("/api/guest", json={}, headers={"Origin": "null"}), 403, "cross_origin")
    big = b'{"x":"' + b"a" * (JSON_LIMIT * 2) + b'"}'
    err(c.post("/api/guest", content=big, headers={**evil, "Content-Type": "application/json"}), 403, "cross_origin")
    own = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    assert api(app_url).post("/api/guest", json={}, headers={"Origin": own}).status_code == 201
    assert api(app_url).post("/api/guest").status_code == 201
    g = new_guest(app_url)
    name0 = me(g)["display_name"]
    prefix, suffix = b'{"display_name":"', b'"}'
    at_limit = prefix + b"a" * (JSON_LIMIT - len(prefix) - len(suffix)) + suffix
    over = prefix + b"a" * (JSON_LIMIT + 1 - len(prefix) - len(suffix)) + suffix
    assert len(at_limit) == JSON_LIMIT and len(over) == JSON_LIMIT + 1
    assert g.patch("/api/me", content=at_limit, headers={"Content-Type": "application/json"}).status_code == 422
    err(g.patch("/api/me", content=over, headers={"Content-Type": "application/json"}), 413, "too_large")
    err(g.patch("/api/me", content=b'{"display_name":"Pip"}', headers={"Content-Type": "text/plain"}), 415,
        "unsupported_media_type")
    err(g.patch("/api/me", content=b'{"display_name":', headers={"Content-Type": "application/json"}), 422)
    assert "body" in g.patch("/api/me", content=b"{", headers={"Content-Type": "application/json"}).json()["error"]["fields"]
    assert me(g)["display_name"] == name0
    ok = g.patch("/api/me", content=json.dumps({"display_name": fresh_name()}).encode(),
                 headers={"Content-Type": "Application/JSON; charset=utf-8"})
    assert ok.status_code == 200, ok.text
    secret = os.environ.get("DATABASE_URL", "")
    for path in ["/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/",
                 "/tsconfig.json", "/src/server.ts", "/server.js.map"]:
        r = c.get(path)
        assert r.status_code == 404, path
        if secret:
            assert secret not in r.text
    r = c.get("/api/no-such-endpoint")
    assert r.status_code == 404 and r.json() == NOT_FOUND
    for page_path in ["/console?mission=x&y=1", "/claim?token=abc"]:
        r = c.get(page_path)
        assert r.status_code == 200 and "HTML" in r.headers["Content-Type"].upper()


def test_accept_parcel(app_url):
    g = new_guest(app_url)
    depot = g.get("/api/depot").json()
    listed = {m["mission_id"]: m for m in depot["missions"]}
    assert "lantern-oil" in listed and "kite-string" not in listed and "moonmelon-express" not in listed
    r = accept(g, "lantern-oil")
    assert r.status_code == 201, r.text
    p = r.json()
    assert ACC_ID.match(p["acceptance_id"]) and p["status"] == "open"
    assert p["version"] == listed["lantern-oil"]["version"] and p["reward_stamps"] == LANTERN_REWARD
    assert p["resident"] == {"resident_id": "ottoline", "name": "Ottoline Fennick", "home": "Lantern Mill"}
    assert p["rush_id"] is None and p["hold_expires_at"] is None
    assert p["route"]["total_arc_m"] == LANTERN_ARC_M and p["route"]["initial_bearing_deg"] == LANTERN_BEARING
    assert p["route"]["door"] == doors(g)["ottoline"] and p["route"]["route_id"]
    assert p["dialogue"]["offer"] == LANTERN_OFFER
    assert me(g)["open_parcel"] == p
    h = new_guest(app_url)
    start = {"lat": 10, "lon": 20}
    q = accept(h, "star-chart", start).json()
    door = doors(h)["pim"]
    assert abs(q["route"]["total_arc_m"] - round(arc_m(start, door), 1)) <= 0.1
    assert abs(q["route"]["initial_bearing_deg"] - bearing_deg(start, door)) <= 1
    x = new_guest(app_url)
    err(accept(x, "moonmelon-express"), 409, "rush_claim_required")
    err(accept(x, "kite-string"), 409, "mission_not_live")
    r = accept(x, "no-such-mission")
    assert r.status_code == 404 and r.json() == NOT_FOUND
    err(x.post(accept_path("lantern-oil"), json={}), 422, fields={"position": "required"})
    err(accept(x, "lantern-oil", "here"), 422, fields={"position": "invalid"})
    err(accept(x, "lantern-oil", {"lat": "12", "lon": 0}), 422, fields={"position.lat": "invalid"})
    err(accept(x, "lantern-oil", {"lat": 91, "lon": 0}), 422, fields={"position.lat": "out_of_range"})
    err(accept(x, "lantern-oil", {"lat": 0}), 422, fields={"position.lon": "required"})
    assert me(x)["open_parcel"] is None


def test_repeated_accept_and_claim(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=6)
    g = new_guest(app_url)
    first = accept(g, m["mission_id"])
    assert first.status_code == 201
    for pos in [{"lat": 5, "lon": 5}, "garbage", {"lat": 0, "lon": 0, "altitude": 3}]:
        again = accept(g, m["mission_id"], pos)
        assert again.status_code == 200 and again.content == first.content
    assert g.post(f"/api/missions/{m['mission_id']}/accept", json={}).content == first.content
    edited = f.patch(f"/api/founder/missions/{m['mission_id']}", json={"reward_stamps": 9},
                     headers=im(mission(f, m["mission_id"])))
    assert edited.status_code == 200 and edited.json()["version"] == 2
    assert accept(g, m["mission_id"]).content == first.content
    err(accept(g, "lantern-oil"), 409, "hands_full")
    assert me(g)["open_parcel"]["acceptance_id"] == first.json()["acceptance_id"]
    rush = live_mission(f, kind="rush", slots=2, reward=5, resident="pim")
    try:
        c, _, _ = courier(app_url, mail)
        rows = rush_rows(c, rush["mission_id"])
        won = claim(c, rows[0]["rush_id"])
        assert won.status_code == 201, won.text
        again = claim(c, rows[0]["rush_id"], {"lat": 3, "lon": 3})
        assert again.status_code == 200 and again.content == won.content
        assert again.json()["hold_expires_at"] == won.json()["hold_expires_at"]
        err(claim(c, rows[1]["rush_id"]), 409, "hands_full")
        err(accept(c, "lantern-oil"), 409, "hands_full")
        err(claim(g, rows[1]["rush_id"]), 403, "sign_in_required")
        c2, _, _ = courier(app_url, mail)
        assert accept(c2, "star-chart").status_code == 201
        err(claim(c2, rows[1]["rush_id"]), 409, "hands_full")
    finally:
        retire_quiet(f, rush["mission_id"])


def test_handover_door_distance(app_url):
    g = new_guest(app_url)
    door = doors(g)["ottoline"]
    acc = accept(g, "lantern-oil").json()["acceptance_id"]
    err(hand_over(g, acc, towards(door, DOOR_M + 0.3, 0)), 422, fields={"position": "too_far"})
    assert me(g)["balance"] == 0
    ok = hand_over(g, acc, towards(door, DOOR_M - 0.2, 90))
    assert ok.status_code == 201, ok.text
    body = ok.json()
    assert body["acceptance_id"] == acc and body["mission_id"] == "lantern-oil"
    assert body["stamps_awarded"] == LANTERN_REWARD and body["balance"] == LANTERN_REWARD
    assert body["dialogue"]["thanks"] == [LANTERN_THANKS]
    after = me(g)
    assert after["balance"] == LANTERN_REWARD and after["open_parcel"] is None


def test_handover_ticket_replay(app_url):
    g = new_guest(app_url)
    door = doors(g)["ottoline"]
    acc = accept(g, "lantern-oil").json()["acceptance_id"]
    far = towards(door, DOOR_M * 3, 180)
    missing = g.post("/api/deliveries", json={"acceptance_id": acc, "position": door})
    assert missing.status_code == 422 and "Handover-Ticket" in missing.json()["error"]["fields"]
    t = idempotency_key()
    err(hand_over(g, acc, far, t), 422, fields={"position": "too_far"})
    err(hand_over(g, acc, far, t), 422, fields={"position": "too_far"})
    ok = hand_over(g, acc, door, t)
    assert ok.status_code == 201, ok.text
    replay = hand_over(g, acc, door, t)
    assert replay.status_code == 201 and replay.content == ok.content
    assert me(g)["balance"] == LANTERN_REWARD
    err(hand_over(g, acc, far, t), 409, "ticket_conflict")
    err(hand_over(g, acc, door), 409, "already_delivered")
    acc2 = accept(g, "lantern-oil").json()["acceptance_id"]
    t2 = idempotency_key()
    both = together([lambda: hand_over(g, acc2, door, t2), lambda: hand_over(g, acc2, door, t2)])
    assert [r.status_code for r in both] == [201, 201] and both[0].content == both[1].content
    moves = ledger(g, limit=50).json()["movements"]
    assert len([mv for mv in moves if mv["kind"] == "delivery"]) == 2
    assert me(g)["balance"] == 2 * LANTERN_REWARD


def test_ledger_pairs(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=7)
    c, _, _ = courier(app_url, mail)
    door = doors(c)["ottoline"]
    deliver(c, m["mission_id"], door)
    deliver(c, m["mission_id"], door)
    assert buy(c, "riso-pink").status_code == 201
    page = ledger(c).json()
    assert len(page["movements"]) == 3
    total = 0
    for mv in page["movements"]:
        assert ISO_MS.match(mv["created_at"])
        entries = mv["entries"]
        assert len(entries) == 2 and entries[0]["account"] == "courier"
        assert sum(e["amount"] for e in entries) == 0
        assert entries[0]["ref"] == entries[1]["ref"]
        if mv["kind"] == "delivery":
            assert entries[1]["account"] == "mint" and entries[0]["ref"] == m["mission_id"] and entries[0]["amount"] == 7
        else:
            assert entries[1]["account"] == "outfitter" and entries[0]["ref"] == "riso-pink"
            assert entries[0]["amount"] == -RISO_PINK_PRICE
        total += entries[0]["amount"]
    assert page["balance"] == total == me(c)["balance"] == 2


def test_outfitter_purchases(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=25)
    g = new_guest(app_url)
    deliver(g, m["mission_id"], doors(g)["ottoline"])
    results = together([lambda: buy(g, "riso-pink"), lambda: buy(g, "sunpatch")])
    codes = sorted(r.status_code for r in results)
    assert codes == [201, 409], [r.text for r in results]
    loser = next(r for r in results if r.status_code == 409)
    assert loser.json()["error"]["code"] == "insufficient_stamps"
    winner = next(r for r in results if r.status_code == 201).json()
    price = RISO_PINK_PRICE if winner["satchel_id"] == "riso-pink" else SUNPATCH_PRICE
    now = me(g)
    assert now["balance"] == 25 - price >= 0 and winner["balance"] == now["balance"]
    worn = g.patch("/api/me", json={"satchel_id": winner["satchel_id"]})
    assert worn.status_code == 200 and worn.json()["satchel_colour"] == winner["satchel_id"]
    err(g.patch("/api/me", json={"satchel_id": "tidewater"}), 409, "not_owned")
    err(g.patch("/api/me", json={"satchel_id": "gold"}), 422, fields={"satchel_id": "invalid"})
    rows = {s["satchel_id"]: s for s in g.get("/api/outfitter").json()["satchels"]}
    assert rows[winner["satchel_id"]]["owned"] and rows[winner["satchel_id"]]["worn"]
    assert rows["canvas"]["owned"] and not rows["tidewater"]["owned"]


def test_purchase_ticket(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=20)
    g = new_guest(app_url)
    door = doors(g)["ottoline"]
    t = idempotency_key()
    err(buy(g, "riso-pink", t), 409, "insufficient_stamps")
    deliver(g, m["mission_id"], door)
    ok = buy(g, "riso-pink", t)
    assert ok.status_code == 201, ok.text
    deliver(g, m["mission_id"], door)
    replay = buy(g, "riso-pink", t)
    assert replay.status_code == 201 and replay.content == ok.content
    err(buy(g, "sunpatch", t), 409, "ticket_conflict")
    err(buy(g, "riso-pink"), 409, "already_owned")
    nohdr = g.post(buy_path("sunpatch"))
    assert nohdr.status_code == 422 and "Purchase-Ticket" in nohdr.json()["error"]["fields"]
    t2 = idempotency_key()
    rs = together([lambda: buy(g, "sunpatch", t2)] * 3)
    assert all(r.status_code == 201 for r in rs) and len({r.content for r in rs}) == 1
    moves = ledger(g, limit=50).json()["movements"]
    assert [mv["entries"][0]["ref"] for mv in moves if mv["kind"] == "purchase"].count("sunpatch") == 1
    assert [mv["entries"][0]["ref"] for mv in moves if mv["kind"] == "purchase"].count("riso-pink") == 1
    assert me(g)["balance"] == 40 - RISO_PINK_PRICE - SUNPATCH_PRICE


def test_postbox_key_same_answer(app_url, mail):
    known = fresh_email("known")
    sign_in(app_url, mail, known)
    unknown = fresh_email("unknown")
    c = api(app_url)
    times: dict[str, list[float]] = {known: [], unknown: []}
    bodies: dict[str, set[bytes]] = {known: set(), unknown: set()}
    for _ in range(5):
        for addr in (known, unknown):
            t0 = time.monotonic()
            r = c.post("/api/auth/postbox-key", json={"email": addr})
            times[addr].append(time.monotonic() - t0)
            assert r.status_code == 200
            bodies[addr].add(r.content)
    assert bodies[known] == bodies[unknown] and len(bodies[known]) == 1
    assert json.loads(next(iter(bodies[known]))) == {"status": "sent"}
    assert abs(median(times[known]) - median(times[unknown])) < TIMING_GAP_S
    for addr in (known, unknown):
        msgs = wait_mails(mail, addr, 5)
        m = msgs[-1]
        assert m["Subject"] == "Your Parcel Moon postbox key"
        assert m["From"]["Address"] == "postbox@kitefold.example" and m["From"]["Name"] == "Parcel Moon"
        assert len(CLAIM_RE.findall(text(m))) == 1
    err(c.post("/api/auth/postbox-key", json={"email": "not-an-address"}), 422, fields={"email": "invalid"})
    long_addr = "a" * (EMAIL_MAX - len("@example.com") + 1) + "@example.com"
    err(c.post("/api/auth/postbox-key", json={"email": long_addr}), 422, fields={"email": "too_long"})


def test_postbox_key_single_use(app_url, mail):
    email = fresh_email("key")
    token = token_of(request_key(app_url, mail, email))
    rs = together([lambda: api(app_url).post("/api/auth/redeem", json={"token": token}) for _ in range(2)])
    assert sorted(r.status_code for r in rs) == [200, 410]
    err(next(r for r in rs if r.status_code == 410), 410, "link_used")
    err(api(app_url).post("/api/auth/redeem", json={"token": token}), 410, "link_used")
    err(api(app_url).post("/api/auth/redeem", json={"token": "nope" + uuid.uuid4().hex}), 410, "link_invalid")
    short = outage("APP_SHORT_HOLDS_URL")
    c = api(short)
    before = key_links(mail, email)
    requested_at = server_time(c)
    assert c.post("/api/auth/postbox-key", json={"email": email}).status_code == 200
    deadline = time.monotonic() + MAIL_WAIT_S
    while not (key_links(mail, email) - before):
        assert time.monotonic() < deadline
    stale = token_of((key_links(mail, email) - before).pop())
    wait_server(c, requested_at + timedelta(seconds=SHORT_KEY_TTL_S + 2))
    gone = c.post("/api/auth/redeem", json={"token": stale})
    err(gone, 410, "link_expired")
    assert "return_to" not in gone.json()


def test_guest_claim_merge(app_url, mail):
    g = new_guest(app_url)
    dd = doors(g)
    deliver(g, "star-chart", dd["pim"])
    deliver(g, "lantern-oil", dd["ottoline"])
    assert me(g)["balance"] == GUEST_AFTER_TWO
    t = idempotency_key()
    bought = buy(g, "riso-pink", t)
    assert bought.status_code == 201 and bought.json()["balance"] == GUEST_AFTER_PINK
    parcel = accept(g, "seed-packets")
    assert parcel.status_code == 201
    before = [(mv["movement_id"], mv["created_at"]) for mv in ledger(g).json()["movements"]]
    guest_name = me(g)["display_name"]
    email = fresh_email("claim")
    _, red = sign_in(app_url, mail, email, c=g)
    assert red["merged_guest"] is True and red["role"] == "courier"
    assert red["merge_report"] == {"movements": 3, "satchels_added": ["riso-pink"], "parcel": "moved", "name_kept": "guest"}
    assert red["balance"] == GUEST_AFTER_PINK and red["display_name"] == guest_name
    now = me(g)
    assert now["role"] == "courier" and now["email"].lower() == email.lower() and now["balance"] == GUEST_AFTER_PINK
    assert "riso-pink" in now["satchels_owned"]
    assert now["open_parcel"]["acceptance_id"] == parcel.json()["acceptance_id"]
    assert [(mv["movement_id"], mv["created_at"]) for mv in ledger(g).json()["movements"]] == before
    repeat = accept(g, "seed-packets")
    assert repeat.status_code == 200 and repeat.content == parcel.content
    replay = buy(g, "riso-pink", t)
    assert replay.status_code == 201 and replay.content == bought.content
    _, again = sign_in(app_url, mail, email, c=g)
    assert again["merged_guest"] is False and again["merge_report"] is None
    assert len(ledger(g).json()["movements"]) == 3
    bare = new_guest(app_url)
    _, plain = sign_in(app_url, mail, fresh_email("plain"), c=bare)
    assert plain["merged_guest"] is False and plain["merge_report"] is None
    assert COURIER_NAME.match(plain["display_name"]) and me(bare)["satchel_colour"] == "canvas"


def test_session_rotation(app_url, mail):
    g = new_guest(app_url)
    old = jar_cookie(g)
    sign_in(app_url, mail, fresh_email("rotate"), c=g)
    fresh = jar_cookie(g)
    assert fresh != old
    err(on(app_url, old).get("/api/me"), 401, "unauthenticated")
    err(on(app_url, old).post("/api/presence", json={"stream": "abcdefgh", "seq": 1,
                                                    "position": {"lat": 0, "lon": 0, "heading_deg": 0}}), 401)
    assert on(app_url, fresh).get("/api/me").json()["role"] == "courier"
    r = g.post("/api/auth/sign-out", json={})
    assert r.status_code == 204
    err(on(app_url, fresh).get("/api/me"), 401, "unauthenticated")
    err(on(app_url, fresh).get("/api/me/ledger"), 401, "unauthenticated")
    again = on(app_url, fresh).post("/api/guest", json={})
    assert again.status_code == 201 and again.json()["role"] == "guest"


def test_presence_leaves_at_once(app_url, mail):
    obs = new_guest(app_url)
    a1, email, name = courier(app_url, mail)
    a2, _ = sign_in(app_url, mail, email)
    b1, b2 = Beat(a1), Beat(a2)
    assert b1.send(lat=1, lon=1).json()["accepted"] is True
    assert b2.send(lat=2, lon=2).json()["accepted"] is True
    seen = named(presence(obs), name)
    assert len(seen) == 1 and seen[0]["position"]["lat"] == 2
    old = jar_cookie(a2)
    assert a2.post("/api/auth/sign-out", json={}).status_code == 204
    seen = named(presence(obs), name)
    assert len(seen) == 1 and seen[0]["position"]["lat"] == 1
    err(on(app_url, old).post("/api/presence", json={"stream": b2.stream, "seq": 9,
                                                    "position": {"lat": 5, "lon": 5, "heading_deg": 0}}), 401)
    assert named(presence(obs), name)[0]["position"]["lat"] == 1
    g = new_guest(app_url)
    gname = fresh_name()
    g.patch("/api/me", json={"display_name": gname})
    Beat(g).send(lat=3, lon=3)
    assert len(named(presence(obs), gname)) == 1
    _, red = sign_in(app_url, mail, fresh_email("redeem"), c=g)
    entries = presence(obs)
    assert named(entries, gname) == []
    mine = named(entries, red["display_name"])
    assert len(mine) == 1 and mine[0]["position"]["lat"] == 3


def test_return_paths(app_url, mail):
    email = fresh_email("return")
    c = api(app_url)
    bad = ["/" + "/evil.example", "/\\evil.example", "\\/evil.example", "https://evil.example", "/%2F%2Fevil.example",
           "javascript:alert(1)", "/console?mission=x&next=//evil.example", "/console#x", "/Console", "/console\n",
           "/console?mission=" + "a" * 65, None, 5]
    for value in bad:
        err(c.post("/api/auth/postbox-key", json={"email": email, "return_to": value}), 422,
            fields={"return_to": "invalid"})
    err(c.post("/api/auth/postbox-key", json={"email": email, "return_to": "/" + "a" * RETURN_TO_MAX}), 422,
        fields={"return_to": "too_long"})
    assert mails_to(mail, email, settle=2.0) == []
    link = request_key(app_url, mail, email, return_to="/console?mission=new")
    assert "return_to" not in text(mails_to(mail, email)[-1]) and "mission=new" not in text(mails_to(mail, email)[-1])
    red = api(app_url).post("/api/auth/redeem", json={"token": token_of(link)}).json()
    assert red["return_to"] == "/console?mission=new"
    plain = api(app_url).post("/api/auth/redeem", json={"token": token_of(request_key(app_url, mail, email))}).json()
    assert plain["return_to"] == "/"


def test_rush_board(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=3, reward=11, resident="pim")
    mid = m["mission_id"]
    try:
        g = new_guest(app_url)
        c1, _, _ = courier(app_url, mail)
        c2, _, _ = courier(app_url, mail)
        dep = c2.get("/api/depot").json()
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", dep["board_date"])
        assert dep["time_zone"] == f.get("/api/founder/studio").json()["time_zone"]
        assert dep["board_date"] == f.get("/api/founder/studio").json()["board_date"]
        mine = [r for r in dep["rush"] if r["mission_id"] == mid]
        assert [(r["slot"], r["slots"], r["status"]) for r in mine] == [(1, 3, "posted"), (2, 3, "posted"), (3, 3, "posted")]
        for r in mine:
            assert r["hold_expires_at"] is None and r["title"] == m["title"] and r["reward_stamps"] == 11
            assert r["resident_id"] == "pim" and r["version"] == m["version"]
        keys = [(r["mission_id"], r["slot"]) for r in dep["rush"]]
        assert keys == sorted(keys)
        assert dep["rush_left"] == sum(r["status"] == "posted" for r in dep["rush"])
        err(claim(g, mine[0]["rush_id"]), 403, "sign_in_required")
        won = claim(c1, mine[0]["rush_id"])
        assert won.status_code == 201, won.text
        p = won.json()
        assert p["rush_id"] == mine[0]["rush_id"] and ISO_MS.match(p["hold_expires_at"])
        own = rush_rows(c1, mid)[0]
        assert own["status"] == "yours" and own["hold_expires_at"] == p["hold_expires_at"]
        dep2 = c2.get("/api/depot").json()
        other = [r for r in dep2["rush"] if r["mission_id"] == mid]
        assert other[0]["status"] == "taken" and other[0]["hold_expires_at"] is None
        assert [r["status"] for r in other[1:]] == ["posted", "posted"]
        assert dep2["rush_left"] == sum(r["status"] == "posted" for r in dep2["rush"])
        assert rush_rows(g, mid)[0]["status"] == "taken"
    finally:
        retire_quiet(f, mid)


def test_one_winner(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=1, reward=15, resident="juniper")
    try:
        cs = [courier(app_url, mail)[0] for _ in range(3)]
        rid = rush_rows(cs[0], m["mission_id"])[0]["rush_id"]
        rs = together([lambda c=c: claim(c, rid) for c in cs])
        assert sorted(r.status_code for r in rs) == [201, 409, 409], [r.text for r in rs]
        for c, r in zip(cs, rs):
            if r.status_code == 409:
                assert r.json()["error"]["code"] == "parcel_taken"
                state = me(c)
                assert state["open_parcel"] is None and state["balance"] == 0
                assert rush_rows(c, m["mission_id"])[0]["status"] == "taken"
            else:
                assert me(c)["open_parcel"]["rush_id"] == rid
    finally:
        retire_quiet(f, m["mission_id"])


def test_rush_hold_expiry(app_url, mail):
    short = outage("APP_SHORT_HOLDS_URL")
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=2, reward=9, resident="juniper")
    mid = m["mission_id"]
    try:
        A, B, C, D = (on(short, jar_cookie(courier(app_url, mail)[0])) for _ in range(4))
        door = doors(A)["juniper"]
        rows = rush_rows(A, mid)
        t = idempotency_key()
        ca = claim(A, rows[0]["rush_id"])
        assert ca.status_code == 201
        stored = hand_over(A, ca.json()["acceptance_id"], door, t)
        assert stored.status_code == 201, stored.text
        before = server_time(B)
        cb = claim(B, rows[1]["rush_id"])
        assert cb.status_code == 201
        after = parsedate_to_datetime(cb.headers["date"])
        hold_end = iso(cb.json()["hold_expires_at"])
        lo = before - timedelta(seconds=1) + timedelta(seconds=SHORT_HOLD_S)
        hi = after + timedelta(seconds=1 + SHORT_HOLD_S)
        assert lo <= hold_end <= hi
        wait_server(B, hold_end + timedelta(seconds=1))
        acc_b = cb.json()["acceptance_id"]
        err(hand_over(B, acc_b, door), 409, "hold_expired")
        assert me(B)["open_parcel"] is None and me(B)["balance"] == 0
        err(drop(B, acc_b), 409, "parcel_closed")
        assert [r["status"] for r in rush_rows(B, mid) if r["rush_id"] == rows[1]["rush_id"]] == ["posted"]
        replay = hand_over(A, ca.json()["acceptance_id"], door, t)
        assert replay.status_code == 201 and replay.content == stored.content
        rs = together([lambda: claim(C, rows[1]["rush_id"]), lambda: claim(D, rows[1]["rush_id"])])
        assert sorted(r.status_code for r in rs) == [201, 409]
        loser = next(r for r in rs if r.status_code == 409)
        assert loser.json()["error"]["code"] == "parcel_taken"
        winner = next(r for r in rs if r.status_code == 201).json()
        assert winner["acceptance_id"] != acc_b
        listed = [r for r in rush_rows(B, mid) if r["rush_id"] == rows[1]["rush_id"]]
        assert len(listed) == 1 and listed[0]["status"] == "taken"
    finally:
        retire_quiet(f, mid)


def test_drop_parcel(app_url, mail):
    g = new_guest(app_url)
    dd = doors(g)
    acc = accept(g, "star-chart").json()["acceptance_id"]
    r = drop(g, acc)
    assert r.status_code == 200 and r.json() == {"acceptance_id": acc, "status": "dropped"}
    assert me(g)["open_parcel"] is None
    err(drop(g, acc), 409, "parcel_closed")
    err(hand_over(g, acc, dd["pim"]), 409, "parcel_dropped")
    done = deliver(g, "star-chart", dd["pim"])
    err(drop(g, done["acceptance_id"]), 409, "parcel_closed")
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=1, reward=5, resident="barnaby")
    try:
        c, _, _ = courier(app_url, mail)
        other, _, _ = courier(app_url, mail)
        rid = rush_rows(c, m["mission_id"])[0]["rush_id"]
        won = claim(c, rid).json()
        assert rush_rows(other, m["mission_id"])[0]["status"] == "taken"
        assert drop(c, won["acceptance_id"]).status_code == 200
        rows = rush_rows(other, m["mission_id"])
        assert len(rows) == 1 and rows[0]["status"] == "posted" and rows[0]["rush_id"] == rid
        assert me(c)["open_parcel"] is None
    finally:
        retire_quiet(f, m["mission_id"])


def test_foreign_parcel_invisible(app_url):
    a, b = new_guest(app_url), new_guest(app_url)
    dd = doors(a)
    acc = accept(a, "star-chart").json()["acceptance_id"]
    d1, d0 = drop(b, acc), drop(b, GHOST_ACC)
    assert d1.status_code == d0.status_code == 404 and d1.content == d0.content
    assert d1.headers["content-type"] == d0.headers["content-type"] and d1.json() == NOT_FOUND
    t = idempotency_key()
    h1, h0 = hand_over(b, acc, dd["pim"], t), hand_over(b, GHOST_ACC, dd["pim"], idempotency_key())
    assert h1.status_code == h0.status_code == 404 and h1.content == h0.content
    state = me(a)
    assert state["open_parcel"]["acceptance_id"] == acc and state["balance"] == 0
    own = accept(b, "lantern-oil").json()["acceptance_id"]
    assert hand_over(b, own, dd["ottoline"], t).status_code == 201
    for r in [b.get("/api/me"), b.get("/api/depot"), b.get("/api/me/ledger"), b.get("/api/presence")]:
        assert acc not in r.text


def test_postcard_upload_checks(app_url, mail):
    c, _, _ = courier(app_url, mail)
    s3 = S3()
    good_ihdr = ihdr(MIN_SIDE_PX, MIN_SIDE_PX)
    bad_crc = good_ihdr[:-4] + struct.pack(">I", struct.unpack(">I", good_ihdr[-4:])[0] ^ 1)
    comp = zlib.compress(scan(MIN_SIDE_PX, MIN_SIDE_PX), 9)
    split = (PNG_SIG + good_ihdr + chunk(b"IDAT", comp[:100]) + chunk(b"tEXt", b"k\x00v")
             + chunk(b"IDAT", comp[100:]) + chunk(b"IEND", b""))
    cases = {
        "not_png": [b"GIF89a" + png()[6:], png(header=bad_crc), png()[:-12], split,
                    png(header=ihdr(MIN_SIDE_PX, MIN_SIDE_PX, depth=4, colour=2))],
        "trailing_data": [png() + b"\x00"],
        "animated": [png(before_idat=chunk(b"acTL", struct.pack(">II", 1, 0)))],
        "bad_dimensions": [png(MIN_SIDE_PX - 1, MIN_SIDE_PX), png(MIN_SIDE_PX, MAX_SIDE_PX + 1, raw=b"")],
        "bad_image_data": [png(raw=scan(MIN_SIDE_PX, MIN_SIDE_PX)[:-1]), png(raw=scan(MIN_SIDE_PX, MIN_SIDE_PX, 5)),
                           png(idat=b"not a zlib stream")],
    }
    listed = {p["postcard_id"] for p in c.get("/api/postcards").json()["postcards"]}
    for reason, bodies in cases.items():
        for body in bodies:
            keys = set(s3.keys("postcards/"))
            err(upload(c, body), 422, fields={"image": reason})
            assert set(s3.keys("postcards/")) == keys, reason
    err(upload(c, b"\x00" * (UPLOAD_LIMIT + 1)), 413, "too_large")
    err(c.post("/api/postcards", content=png(), headers={"Content-Type": "image/jpeg"}), 415)
    assert {p["postcard_id"] for p in c.get("/api/postcards").json()["postcards"]} == listed
    body = png()
    r = upload(c, body)
    assert r.status_code == 201, r.text
    card = r.json()
    assert PC_ID.match(card["postcard_id"]) and card["width"] == MIN_SIDE_PX and card["height"] == MIN_SIDE_PX
    assert card["bytes"] == len(body) and ISO_MS.match(card["created_at"])
    assert s3.get(f"postcards/{card['postcard_id']}.png") == body


def test_share_links(app_url, mail):
    c, email, name = courier(app_url, mail)
    body = png()
    card = upload(c, body).json()
    token = card["share_url"].rsplit("/p/", 1)[1]
    assert card["share_url"].endswith(f"/p/{token}") and len(token) >= SHARE_TOKEN_MIN
    assert re.fullmatch(r"[A-Za-z0-9_\-]+", token) and card["postcard_id"] not in token
    anon = api(app_url)
    page = anon.get(f"/p/{token}")
    assert page.status_code == 200 and "HTML" in page.headers["Content-Type"].upper()
    assert page.headers["X-Content-Type-Options"] == "nosniff" and page.headers["Cache-Control"] == "no-store"
    assert "A postcard from Bramble" in page.text and f"Sent by {name}" in page.text
    assert f"/p/{token}/image.png" in page.text
    assert email not in page.text and card["postcard_id"] not in page.text
    img = anon.get(f"/p/{token}/image.png")
    assert img.status_code == 200 and img.content == body
    assert img.headers["Content-Type"] == "image/png" and img.headers["X-Content-Type-Options"] == "nosniff"
    assert img.headers["Content-Disposition"] == 'inline; filename="postcard.png"'
    assert img.headers["Cache-Control"] == "no-store"
    assert "ETag" not in img.headers and "Last-Modified" not in img.headers
    assert not [h for h in img.headers if h.lower().startswith("x-amz")]
    for method in ["POST", "PUT", "PATCH", "DELETE"]:
        assert anon.request(method, f"/p/{token}").status_code == 405
    assert anon.get(f"/p/{token}").status_code == 200


def test_revoke_postcard(app_url, mail):
    c, _, _ = courier(app_url, mail)
    s3 = S3()
    card = upload(c).json()
    token = card["share_url"].rsplit("/p/", 1)[1]
    key = f"postcards/{card['postcard_id']}.png"
    assert key in s3.keys("postcards/")
    other, _, _ = courier(app_url, mail)
    assert other.delete(f"/api/postcards/{card['postcard_id']}").json() == NOT_FOUND
    assert c.delete(f"/api/postcards/{card['postcard_id']}").status_code == 204
    gone = api(app_url).get(f"/p/{token}")
    assert gone.status_code == 404 and "This postcard has been returned to sender." in gone.text
    assert api(app_url).get(f"/p/{token}/image.png").status_code == 404
    assert card["postcard_id"] not in c.get("/api/postcards").text
    assert key not in s3.keys("postcards/")


def test_darkroom_outage(app_url, mail):
    down = outage("APP_MINIO_DOWN_URL")
    c, _, name = courier(app_url, mail)
    card = upload(c).json()
    token = card["share_url"].rsplit("/p/", 1)[1]
    d = on(down, jar_cookie(c))
    assert api(down).get("/api/health").json() == {"status": "ok"}
    assert api(down).get("/api/status").json() == {"darkroom": "closed", "post_office": "open"}
    r = upload(d)
    assert r.status_code == 503 and r.json() == DARKROOM_CLOSED
    assert d.get("/api/postcards").status_code == 200
    r = d.delete(f"/api/postcards/{card['postcard_id']}")
    assert r.status_code == 503 and r.json() == DARKROOM_CLOSED
    assert card["postcard_id"] in c.get("/api/postcards").text
    assert api(app_url).get(f"/p/{token}/image.png").status_code == 200
    page = api(down).get(f"/p/{token}")
    assert page.status_code == 200 and f"Sent by {name}" in page.text
    img = api(down).get(f"/p/{token}/image.png")
    assert img.status_code == 503 and img.json() == DARKROOM_CLOSED
    g = new_guest(down)
    assert deliver(g, "lantern-oil", doors(g)["ottoline"])["stamps_awarded"] == LANTERN_REWARD


def test_machinery_hidden(app_url, mail):
    minio_down, mail_down = outage("APP_MINIO_DOWN_URL"), outage("APP_MAILPIT_DOWN_URL")
    bucket = os.environ.get("S3_BUCKET", "")
    forbidden = ["127.0.0.1:9"] + ([bucket] if bucket else [])
    c, _, _ = courier(app_url, mail)
    card = upload(c).json()
    token = card["share_url"].rsplit("/p/", 1)[1]
    d = on(minio_down, jar_cookie(c))
    responses = [api(minio_down).get("/api/status"), upload(d), d.delete(f"/api/postcards/{card['postcard_id']}"),
                 api(minio_down).get(f"/p/{token}"), api(minio_down).get(f"/p/{token}/image.png"),
                 api(minio_down).get("/p/unknown-token-value"),
                 api(mail_down).get("/api/status"),
                 api(mail_down).post("/api/auth/postbox-key", json={"email": fresh_email("down")}),
                 on(mail_down, jar_cookie(c)).post(f"/api/postcards/{card['postcard_id']}/mail",
                                                   json={"to": fresh_email("friend")},
                                                   headers={"Mail-Ticket": idempotency_key()}),
                 api(app_url).get("/api/nothing-here"), api(app_url).post("/api/missions/x/accept", content=b"{")]
    for r in responses:
        assert_opaque(r, forbidden)
    assert responses[1].json() == DARKROOM_CLOSED and responses[7].json() == POST_OFFICE_CLOSED
    assert responses[8].json() == POST_OFFICE_CLOSED
    assert S3().keys(f"postcards/{card['postcard_id']}") == [f"postcards/{card['postcard_id']}.png"]


def status_becomes(base: str, expected: dict) -> None:
    deadline = time.monotonic() + STATUS_RECOVER_S + 5
    while True:
        got = api(base).get("/api/status").json()
        if got == expected:
            return
        assert time.monotonic() < deadline, f"status stayed {got}, expected {expected}"


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class Relay:

    def __init__(self, target: tuple[str, int]):
        self.target: tuple[str, int] = target
        self.port = 0
        self.sock: socket.socket | None = None
        self.conns: list[socket.socket] = []
        self.start()

    def start(self) -> None:
        sock = socket.socket()
        sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        sock.bind(("127.0.0.1", self.port))
        sock.listen(64)
        self.port, self.sock = sock.getsockname()[1], sock
        threading.Thread(target=self._accept, args=(sock,), daemon=True).start()

    def _accept(self, sock: socket.socket) -> None:
        while True:
            try:
                conn, _ = sock.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=TIMEOUT_S)
            except OSError:
                conn.close()
                continue
            self.conns += [conn, upstream]
            for a, b in ((conn, upstream), (upstream, conn)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(a: socket.socket, b: socket.socket) -> None:
        try:
            while True:
                chunk_ = a.recv(65536)
                if not chunk_:
                    break
                b.sendall(chunk_)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.close()
                except OSError:
                    pass

    def stop(self) -> None:
        if self.sock is not None:
            try:
                self.sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.sock.close()
            self.sock = None
        for s in self.conns:
            try:
                s.close()
            except OSError:
                pass
        self.conns = []


def test_services_reconnect(app_url, mail):
    from conftest import DEPLOYED_APP

    s3_target = urlparse(os.environ["S3_ENDPOINT"])
    s3_port = s3_target.port or (443 if s3_target.scheme == "https" else 80)
    relays = {"s3": Relay((s3_target.hostname, s3_port)),
              "smtp": Relay((os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"])))}
    port = free_port()
    env = dict(os.environ)
    env.update({"S3_ENDPOINT": f"{s3_target.scheme}://127.0.0.1:{relays['s3'].port}", "SMTP_HOST": "127.0.0.1",
                "SMTP_PORT": str(relays["smtp"].port), "APP_PUBLIC_PORT": str(port)})
    env.pop("APP_PUBLIC_URL", None)
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(prefix="parcel-moon-", suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT,
                            start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    try:
        deadline = time.monotonic() + BOOT_WAIT_S
        while True:
            assert proc.poll() is None, f"app copy exited:\n{tail()}"
            try:
                if api(base).get("/api/health").status_code == 200:
                    break
            except httpx.HTTPError:
                pass
            assert time.monotonic() < deadline, f"app copy never became healthy:\n{tail()}"
        status_becomes(base, {"darkroom": "open", "post_office": "open"})
        c, _, _ = courier(app_url, mail)
        copy = on(base, jar_cookie(c))
        for relay in relays.values():
            relay.stop()
        status_becomes(base, {"darkroom": "closed", "post_office": "closed"})
        r = upload(copy)
        assert r.status_code == 503 and r.json() == DARKROOM_CLOSED
        r = api(base).post("/api/auth/postbox-key", json={"email": fresh_email("relay")})
        assert r.status_code == 503 and r.json() == POST_OFFICE_CLOSED
        for relay in relays.values():
            relay.start()
        status_becomes(base, {"darkroom": "open", "post_office": "open"})
        up = upload(copy)
        assert up.status_code == 201, up.text
        assert f"postcards/{up.json()['postcard_id']}.png" in S3().keys("postcards/")
        email = fresh_email("relay")
        assert api(base).post("/api/auth/postbox-key", json={"email": email}).status_code == 200
        assert wait_mails(mail, email, 1)
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=30)
        for relay in relays.values():
            relay.stop()


def test_postcard_mail(app_url, mail):
    c, email, name = courier(app_url, mail)
    card = upload(c).json()
    friend = fresh_email("friend")
    r = mail_card(c, card["postcard_id"], friend)
    assert r.status_code == 200 and r.json()["status"] == "sent" and ISO_MS.match(r.json()["sent_at"])
    msgs = wait_mails(mail, friend, 1)
    assert len(msgs) == 1
    m = msgs[0]
    assert addresses(m.get("To")) == [friend]
    assert m["From"]["Name"] == f"{name} via Parcel Moon" and m["From"]["Address"] == POSTCARD_SENDER
    assert (m.get("ReturnPath") or "").strip("<>") == POSTCARD_SENDER
    assert m["Subject"] == f"{name} sent you a postcard from Bramble"
    assert text(m).strip() == f"{name} took this postcard on Bramble: {card['share_url']}"
    err(mail_card(c, card["postcard_id"], "not-an-address"), 422, fields={"to": "invalid"})


def test_postcard_copies_private(app_url, mail):
    c, email, name = courier(app_url, mail)
    card = upload(c).json()
    token = card["share_url"].rsplit("/p/", 1)[1]
    friend = fresh_email("friend")
    assert mail_card(c, card["postcard_id"], friend).status_code == 200
    m = wait_mails(mail, friend, 1)[0]
    assert not (m.get("ReplyTo") or []) and not (m.get("Cc") or []) and not (m.get("Bcc") or [])
    bucket = os.environ.get("S3_BUCKET", "")
    private = [email, card["postcard_id"], f"postcards/{card['postcard_id']}"] + ([bucket] if bucket else [])
    blob = json.dumps(m)
    page = api(app_url).get(f"/p/{token}").text
    for s in private:
        assert s not in blob and s not in page, s
    assert "x-amz" not in page.lower() and "x-amz" not in blob.lower()
    renamed = fresh_name()
    assert c.patch("/api/me", json={"display_name": renamed}).status_code == 200
    page = api(app_url).get(f"/p/{token}").text
    assert f"Sent by {renamed}" in page and name not in page
    assert wait_mails(mail, friend, 1)[0]["From"]["Name"] == f"{name} via Parcel Moon"


def test_display_name_folding(app_url, mail):
    c, _, _ = courier(app_url, mail)
    r = c.patch("/api/me", json={"display_name": "Wren" + "\u202e" + "evil"})
    assert r.status_code == 200 and r.json()["display_name"] == "Wren evil"
    r = c.patch("/api/me", json={"display_name": "Wren\r\nBcc: x@example.com"})
    assert r.status_code == 200 and r.json()["display_name"] == "Wren Bcc: x@example.com"
    folded = r.json()["display_name"]
    card = upload(c).json()
    friend = fresh_email("friend")
    assert mail_card(c, card["postcard_id"], friend).status_code == 200
    m = wait_mails(mail, friend, 1)[0]
    assert addresses(m.get("To")) == [friend] and not (m.get("Bcc") or []) and not (m.get("Cc") or [])
    assert m["Subject"] == f"{folded} sent you a postcard from Bramble"
    assert m["From"]["Name"] == f"{folded} via Parcel Moon"
    leaked = [x for x in mails_to(mail, "x@example.com") if card["share_url"] in text(x)]
    assert leaked == []


def test_display_name_unicode(app_url, mail):
    c, _, _ = courier(app_url, mail)
    fox = "🦊"
    r = c.patch("/api/me", json={"display_name": fox * NAME_MAX})
    assert r.status_code == 200 and r.json()["display_name"] == fox * NAME_MAX
    err(c.patch("/api/me", json={"display_name": fox * (NAME_MAX + 1)}), 422, fields={"display_name": "too_long"})
    err(c.patch("/api/me", content=b'{"display_name":"Wren\\ud800"}', headers={"Content-Type": "application/json"}),
        422, fields={"display_name": "invalid"})
    err(c.patch("/api/me", json={"display_name": "   "}), 422, fields={"display_name": "required"})
    err(c.patch("/api/me", json={"display_name": 7}), 422, fields={"display_name": "invalid"})
    assert me(c)["display_name"] == fox * NAME_MAX
    card = upload(c).json()
    friend = fresh_email("friend")
    assert mail_card(c, card["postcard_id"], friend).status_code == 200
    m = wait_mails(mail, friend, 1)[0]
    assert m["From"]["Name"] == f"{fox * NAME_MAX} via Parcel Moon"
    assert m["Subject"] == f"{fox * NAME_MAX} sent you a postcard from Bramble"
    r = c.patch("/api/me", json={"display_name": "e\u0301" * NAME_MAX})
    assert r.status_code == 200 and r.json()["display_name"] == "\u00e9" * NAME_MAX


def test_post_office_outage(app_url, mail):
    down = outage("APP_MAILPIT_DOWN_URL")
    assert api(down).get("/api/status").json() == {"darkroom": "open", "post_office": "closed"}
    email = fresh_email("down")
    r = api(down).post("/api/auth/postbox-key", json={"email": email})
    assert r.status_code == 503 and r.json() == POST_OFFICE_CLOSED
    c, _, _ = courier(app_url, mail)
    card = upload(c).json()
    d = on(down, jar_cookie(c))
    friends = [fresh_email("friend") for _ in range(MAIL_LIMIT + 2)]
    for friend in friends:
        r = mail_card(d, card["postcard_id"], friend)
        assert r.status_code == 503 and r.json() == POST_OFFICE_CLOSED
    g = new_guest(down)
    assert accept(g, "lantern-oil").status_code == 201
    for friend in friends[:MAIL_LIMIT]:
        assert mail_card(c, card["postcard_id"], friend).status_code == 200
    assert mails_to(mail, email, settle=1.5) == []
    assert len(mails_to(mail, friends[-1], settle=1.5)) == 0


def test_mail_limit(app_url, mail):
    c, email, _ = courier(app_url, mail)
    cards = [upload(c).json()["postcard_id"] for _ in range(2)]
    err(mail_card(c, cards[0], "not-an-address"), 422, fields={"to": "invalid"})
    friends = [fresh_email("friend") for _ in range(MAIL_LIMIT + 2)]
    rs = together([lambda i=i, fr=fr: mail_card(c, cards[i % 2], fr) for i, fr in enumerate(friends)])
    ok = [fr for fr, r in zip(friends, rs) if r.status_code == 200]
    refused = [r for r in rs if r.status_code == 429]
    assert len(ok) == MAIL_LIMIT and len(refused) == 2, [r.status_code for r in rs]
    for r in refused:
        assert r.json()["error"]["code"] == "mail_limit"
        assert 1 <= int(r.headers["retry-after"]) <= MAIL_WINDOW_S
    for fr, r in zip(friends, rs):
        assert len(mails_to(mail, fr, settle=0.3)) == (1 if r.status_code == 200 else 0)
    other, _ = sign_in(app_url, mail, email)
    err(mail_card(other, cards[1], fresh_email("friend")), 429, "mail_limit")


def test_mail_ticket(app_url, mail):
    c, _, _ = courier(app_url, mail)
    a, b = upload(c).json()["postcard_id"], upload(c).json()["postcard_id"]
    friend = fresh_email("friend")
    t = idempotency_key()
    first = mail_card(c, a, friend, t)
    assert first.status_code == 200
    replay = mail_card(c, a, friend, t)
    assert replay.status_code == 200 and replay.content == first.content
    err(mail_card(c, a, fresh_email("friend"), t), 409, "ticket_conflict")
    err(mail_card(c, b, friend, t), 409, "ticket_conflict")
    assert c.delete(f"/api/postcards/{a}").status_code == 204
    late = mail_card(c, a, friend, t)
    assert late.status_code == 200 and late.content == first.content
    assert len(wait_mails(mail, friend, 1)) == 1
    nohdr = c.post(f"/api/postcards/{b}/mail", json={"to": friend})
    assert nohdr.status_code == 422 and "Mail-Ticket" in nohdr.json()["error"]["fields"]
    friend2, t2 = fresh_email("friend"), idempotency_key()
    rs = together([lambda: mail_card(c, b, friend2, t2) for _ in range(4)])
    assert all(r.status_code == 200 for r in rs) and len({r.content for r in rs}) == 1
    assert len(wait_mails(mail, friend2, 1)) == 1


def test_presence_heartbeats(app_url, mail):
    a, _, name = courier(app_url, mail)
    obs = new_guest(app_url)
    beat = Beat(a)
    r = beat.send(lat=1, lon=1)
    assert r.json()["accepted"] is True and r.json()["last_seq"] == 1
    stale = beat.send(lat=9, lon=9, seq=1).json()
    assert stale["accepted"] is False and stale["last_seq"] == 1
    assert beat.send(lat=3, lon=3, seq=3).json()["accepted"] is True
    late = beat.send(lat=2, lon=2, seq=2).json()
    assert late["accepted"] is False and late["last_seq"] == 3
    entry = named(presence(obs), name)[0]
    assert entry["position"] == {"lat": 3, "lon": 3, "heading_deg": 0} and entry["satchel_colour"] == "canvas"
    assert beat.send(lat=3, lon=3, emote="wave", seq=4).json()["emote"] == "wave"
    beat.seq = 4
    assert named(presence(obs), name)[0]["emote"] == "wave"
    beat.send(lat=3, lon=3)
    assert named(presence(obs), name)[0]["emote"] == "wave"
    err(beat.send(seq=0), 422, fields={"seq": "out_of_range"})
    err(a.post("/api/presence", json={"stream": "short", "seq": 9, "position": {"lat": 0, "lon": 0, "heading_deg": 0}}),
        422, fields={"stream": "invalid"})
    err(beat.send(heading=360), 422, fields={"position.heading_deg": "out_of_range"})
    err(beat.send(emote="dance"), 422, fields={"emote": "invalid"})


def test_presence_public_fields(app_url, mail):
    a1, email, name = courier(app_url, mail)
    a2, _ = sign_in(app_url, mail, email)
    Beat(a1).send(lat=1, lon=1)
    Beat(a2).send(lat=2, lon=2)
    obs, _, obs_name = courier(app_url, mail)
    Beat(obs).send()
    r = obs.get("/api/presence")
    entries = r.json()["couriers"]
    assert len(named(entries, name)) == 1 and named(entries, obs_name) == []
    for e in entries:
        assert set(e) == {"display_name", "satchel_colour", "position", "emote"}
        assert set(e["position"]) == {"lat", "lon", "heading_deg"}
    assert email not in r.text and "balance" not in r.text and "moderation_ref" not in r.text


def test_unknown_fields(app_url, mail):
    g = new_guest(app_url)
    name = me(g)["display_name"]
    beat = Beat(g)
    body = {"stream": beat.stream, "seq": 1, "position": {"lat": 0, "lon": 0, "heading_deg": 0}}
    for extra, path in [({"muted": False}, "muted"), ({"display_name": "Boss"}, "display_name"),
                        ({"satchel_colour": "tidewater"}, "satchel_colour")]:
        r = g.post("/api/presence", json={**body, **extra})
        assert err(r, 422)["fields"] == {path: "unknown_field"}
    r = g.post("/api/presence", json={**body, "position": {"lat": 0, "lon": 0, "heading_deg": 0, "altitude": 9}})
    assert err(r, 422)["fields"] == {"position.altitude": "unknown_field"}
    r = g.patch("/api/me", json={"display_name": fresh_name(), "balance": 999})
    assert err(r, 422)["fields"] == {"balance": "unknown_field"}
    assert err(g.patch("/api/me", json={"role": "founder"}), 422)["fields"] == {"role": "unknown_field"}
    state = me(g)
    assert state["display_name"] == name and state["balance"] == 0 and state["role"] == "guest"
    assert err(accept(g, "lantern-oil", {"lat": 0, "lon": 0, "altitude": 1}), 422)["fields"] == {"position.altitude": "unknown_field"}
    assert me(g)["open_parcel"] is None
    h = helper(app_url, mail)
    gname = fresh_name()
    g.patch("/api/me", json={"display_name": gname})
    beat.send()
    ref = staff_entry(h, gname)["moderation_ref"]
    assert h.post(f"/api/moderation/{ref}/mute", json={}).status_code == 200
    err(g.post("/api/presence", json={"stream": beat.stream, "seq": 99, "muted": False,
                                      "position": {"lat": 0, "lon": 0, "heading_deg": 0}}), 422)
    assert staff_entry(h, gname)["muted"] is True
    f = founder(app_url, mail)
    title = f"Errand {uuid.uuid4().hex[:12]}"
    r = f.post("/api/founder/missions", json={"title": title, "resident_id": "pim", "reward_stamps": 3, "kind": "standard",
                                              "rush_slots": None, "dialogue": {"offer": ["a"], "thanks": ["b"], "x": 1}})
    assert err(r, 422)["fields"] == {"dialogue.x": "unknown_field"}
    assert title not in f.get("/api/founder/missions").text


def test_mute_clears_emote(app_url, mail):
    a = new_guest(app_url)
    name = fresh_name()
    a.patch("/api/me", json={"display_name": name})
    beat = Beat(a)
    obs = new_guest(app_url)
    h = helper(app_url, mail)
    beat.send(emote="wave")
    assert named(presence(obs), name)[0]["emote"] == "wave"
    ref = staff_entry(h, name)["moderation_ref"]
    assert h.post(f"/api/moderation/{ref}/mute", json={}).status_code == 200
    assert named(presence(obs), name)[0]["emote"] is None and staff_entry(h, name)["emote"] is None
    r = beat.send(emote="cheer").json()
    assert r["emote"] is None and r["muted"] is True
    assert h.post(f"/api/moderation/{ref}/unmute", json={}).status_code == 200
    assert named(presence(obs), name)[0]["emote"] is None
    beat.send(emote="heart")
    assert named(presence(obs), name)[0]["emote"] == "heart"
    new = h.post(f"/api/moderation/{ref}/rename", json={}).json()["display_name"]
    entries = presence(obs)
    assert named(entries, name) == [] and len(named(entries, new)) == 1


def test_mute_repeat_race(app_url, mail):
    t = new_guest(app_url)
    name = fresh_name()
    t.patch("/api/me", json={"display_name": name})
    Beat(t).send()
    h, f = helper(app_url, mail), founder(app_url, mail)
    ref = staff_entry(h, name)["moderation_ref"]
    rs = together([lambda: h.post(f"/api/moderation/{ref}/mute", json={}),
                   lambda: f.post(f"/api/moderation/{ref}/mute", json={})])
    assert sorted(r.status_code for r in rs) == [200, 409]
    assert next(r for r in rs if r.status_code == 409).json()["error"]["code"] == "already_muted"
    assert next(r for r in rs if r.status_code == 200).json() == {"display_name": name, "muted": True}
    entries = [e for e in h.get("/api/moderation/audit").json()["entries"] if e["moderation_ref"] == ref]
    assert [e["action"] for e in entries] == ["mute"]
    assert h.post(f"/api/moderation/{ref}/unmute", json={}).json() == {"display_name": name, "muted": False}
    err(h.post(f"/api/moderation/{ref}/unmute", json={}), 409, "not_muted")
    Beat(f).send()
    founder_ref = staff_entry(h, me(f)["display_name"])["moderation_ref"]
    err(h.post(f"/api/moderation/{founder_ref}/mute", json={}), 403, "cannot_moderate_staff")
    entries = [e for e in h.get("/api/moderation/audit").json()["entries"] if e["moderation_ref"] == ref]
    assert sorted(e["action"] for e in entries) == ["mute", "unmute"]


def test_force_rename(app_url, mail):
    t, _, name = courier(app_url, mail)
    Beat(t).send()
    h = helper(app_url, mail)
    ref = staff_entry(h, name)["moderation_ref"]
    r = h.post(f"/api/moderation/{ref}/rename", json={})
    assert r.status_code == 200 and r.json()["name_locked"] is True and COURIER_NAME.match(r.json()["display_name"])
    state = me(t)
    assert state["display_name"] == r.json()["display_name"] and state["name_locked"] is True
    err(t.patch("/api/me", json={"display_name": fresh_name()}), 403, "name_locked")
    assert me(t)["display_name"] == r.json()["display_name"]


def test_role_refusals(app_url, mail):
    h = helper(app_url, mail)
    c, _, cname = courier(app_url, mail)
    g = new_guest(app_url)
    f = founder(app_url, mail)
    lantern = mission(f, "lantern-oil")
    mp = f"/api/founder/missions/{lantern['mission_id']}"
    for r in [h.get("/api/founder/missions"), h.get(mp),
              h.post("/api/founder/missions", json={}), h.patch("/api/founder/studio", json={"time_zone": "UTC"}),
              h.get("/api/founder/online"), h.get("/api/founder/studio"),
              h.post(f"{mp}/retire", json={}, headers=im(lantern)),
              c.get("/api/founder/missions")]:
        err(r, 403, "founder_only")
    assert mission(f, "lantern-oil")["revision"] == lantern["revision"]
    Beat(c).send()
    ref = staff_entry(h, cname)["moderation_ref"]
    for r in [c.get("/api/moderation/presence"), c.get("/api/moderation/audit"),
              c.post(f"/api/moderation/{ref}/mute", json={}), c.post(f"/api/moderation/{ref}/rename", json={})]:
        err(r, 403, "staff_only")
    assert staff_entry(h, cname)["muted"] is False and staff_entry(h, cname)["display_name"] == cname
    err(g.get("/api/postcards"), 403, "sign_in_required")
    err(upload(g), 403, "sign_in_required")


def test_audit(app_url, mail):
    t = new_guest(app_url)
    name = fresh_name()
    t.patch("/api/me", json={"display_name": name})
    Beat(t).send()
    h = helper(app_url, mail)
    actor = me(h)["display_name"]
    ref = staff_entry(h, name)["moderation_ref"]
    h.post(f"/api/moderation/{ref}/mute", json={})
    h.post(f"/api/moderation/{ref}/mute", json={})
    h.post(f"/api/moderation/{ref}/unmute", json={})
    renamed = h.post(f"/api/moderation/{ref}/rename", json={}).json()["display_name"]
    h.post(f"/api/moderation/{ref}/rename", json={})
    entries = [e for e in h.get("/api/moderation/audit").json()["entries"] if e["moderation_ref"] == ref]
    assert [e["action"] for e in entries] == ["rename", "rename", "unmute", "mute"]
    assert all(e["actor_role"] == "helper" and e["actor_display_name"] == actor for e in entries)
    assert entries[3]["target_name_before"] == entries[3]["target_name_after"] == name
    assert entries[1]["target_name_before"] == name and entries[1]["target_name_after"] == renamed
    assert entries[0]["target_name_before"] == renamed
    keys = [(e["at"], e["entry_id"]) for e in entries]
    assert all(ISO_MS.match(a) for a, _ in keys) and [a for a, _ in keys] == sorted([a for a, _ in keys], reverse=True)
    for method in ["POST", "PUT", "PATCH", "DELETE"]:
        for path in ["/api/moderation/audit", f"/api/moderation/audit/{entries[0]['entry_id']}"]:
            err(h.request(method, path, json={}), 405, "method_not_allowed")
    again = [e for e in h.get("/api/moderation/audit").json()["entries"] if e["moderation_ref"] == ref]
    assert again == entries


def test_mission_fields(app_url, mail):
    f = founder(app_url, mail)
    m = create_mission(f, reward=6, resident="barnaby")
    assert m["status"] == "draft" and m["version"] == 1 and m["revision"] == 1 and m["live_at"] is None
    assert m["dialogue"] == PROBE_DIALOGUE
    assert re.fullmatch(r"[a-z0-9-]{1,64}", m["mission_id"])
    assert f.get(f"/api/founder/missions/{m['mission_id']}").headers["ETag"] == f'"{m["revision"]}"'
    base = {"title": "Ok", "resident_id": "pim", "reward_stamps": 3, "kind": "standard", "rush_slots": None,
            "dialogue": {"offer": ["a"], "thanks": ["b"]}}
    cases = [({"title": ""}, "title", "required"), ({"title": "x" * (TITLE_MAX + 1)}, "title", "too_long"),
             ({"title": "a\nb"}, "title", "invalid"), ({"reward_stamps": 0}, "reward_stamps", "out_of_range"),
             ({"reward_stamps": 2.5}, "reward_stamps", "invalid"), ({"resident_id": "nobody"}, "resident_id", "unknown_resident"),
             ({"kind": "epic"}, "kind", "invalid"), ({"rush_slots": 2}, "rush_slots", "invalid"),
             ({"kind": "rush", "rush_slots": 6}, "rush_slots", "out_of_range"),
             ({"dialogue": {"offer": ["a"] * 7, "thanks": ["b"]}}, "dialogue.offer", "out_of_range"),
             ({"dialogue": {"offer": [""], "thanks": ["b"]}}, "dialogue.offer", "required"),
             ({"dialogue": {"offer": ["a"], "thanks": ["b" * (LINE_MAX + 1)]}}, "dialogue.thanks", "too_long")]
    for change, field, reason in cases:
        err(f.post("/api/founder/missions", json={**base, **change}), 422, fields={field: reason})
    err(f.patch(f"/api/founder/missions/{m['mission_id']}", json={"kind": "rush"}, headers=im(m)), 422,
        fields={"kind": "fixed_after_create"})


def test_mission_lifecycle(app_url, mail):
    f = founder(app_url, mail)
    m = create_mission(f)
    mid, path = m["mission_id"], f"/api/founder/missions/{m['mission_id']}"
    err(f.post(f"{path}/unschedule", json={}, headers=im(m)), 409, "illegal_transition")
    err(f.post(f"{path}/retire", json={}, headers=im(m)), 409, "illegal_transition")
    now = server_time(f)
    err(f.post(f"{path}/schedule", json={"live_at": fmt_iso(now - timedelta(seconds=PAST_GRACE_S * 2))}, headers=im(m)),
        422, fields={"live_at": "in_past"})
    err(f.post(f"{path}/schedule", json={"live_at": fmt_iso(now + timedelta(days=AHEAD_DAYS + 1))}, headers=im(m)),
        422, fields={"live_at": "out_of_range"})
    err(f.post(f"{path}/schedule", json={"live_at": "tomorrow"}, headers=im(m)), 422, fields={"live_at": "invalid"})
    err(f.post(f"{path}/schedule", json={}, headers=im(m)), 422, fields={"live_at": "required"})
    when = fmt_iso(server_time(f) + timedelta(seconds=3))
    s = f.post(f"{path}/schedule", json={"live_at": when}, headers=im(m))
    assert s.status_code == 200 and s.json()["status"] == "scheduled" and s.json()["revision"] == 2 and s.json()["live_at"] == when
    err(accept(new_guest(app_url), mid), 409, "mission_not_live")
    u = f.post(f"{path}/unschedule", json={}, headers=im(s.json())).json()
    assert u["status"] == "draft" and u["revision"] == 3
    when = server_time(f) + timedelta(seconds=3)
    s = f.post(f"{path}/schedule", json={"live_at": fmt_iso(when)}, headers=im(u)).json()
    assert s["status"] == "scheduled" and s["revision"] == 4
    deadline = time.monotonic() + SERVER_WAIT_S
    while True:
        r = f.get(path)
        if r.json()["status"] == "live":
            assert parsedate_to_datetime(r.headers["date"]) <= when + timedelta(seconds=2)
            break
        assert time.monotonic() < deadline
    live = r.json()
    assert live["revision"] == 5 and accept(new_guest(app_url), mid).status_code == 201
    err(f.post(f"{path}/unschedule", json={}, headers=im(live)), 409, "illegal_transition")
    h = helper(app_url, mail)
    err(h.post(f"{path}/retire", json={}, headers=im(live)), 403, "founder_only")
    assert mission(f, mid) == live
    ret = f.post(f"{path}/retire", json={}, headers=im(live)).json()
    assert ret["status"] == "retired" and ret["revision"] == 6
    err(f.post(f"{path}/schedule", json={"live_at": "now"}, headers=im(ret)), 409, "illegal_transition")
    err(f.post(f"{path}/retire", json={}, headers=im(ret)), 409, "illegal_transition")
    err(f.patch(path, json={"reward_stamps": 3}, headers=im(ret)), 409, "mission_retired")


def test_live_edit_versions(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=7, resident="ottoline")
    a = new_guest(app_url)
    dd = doors(a)
    pa = accept(a, m["mission_id"]).json()
    e = f.patch(f"/api/founder/missions/{m['mission_id']}", json={"reward_stamps": 9, "resident_id": "barnaby"},
                headers=im(mission(f, m["mission_id"])))
    assert e.status_code == 200 and e.json()["version"] == 2
    b = new_guest(app_url)
    pb = accept(b, m["mission_id"]).json()
    assert pb["version"] == 2 and pb["reward_stamps"] == 9 and pb["route"]["door"] == dd["barnaby"]
    retire_quiet(f, m["mission_id"])
    da = hand_over(a, pa["acceptance_id"], dd["ottoline"]).json()
    assert da["version"] == 1 and da["stamps_awarded"] == 7
    assert hand_over(b, pb["acceptance_id"], dd["barnaby"]).json()["stamps_awarded"] == 9
    rush = live_mission(f, kind="rush", slots=2, reward=10, resident="pim")
    try:
        c1, _, _ = courier(app_url, mail)
        c2, _, _ = courier(app_url, mail)
        rows = rush_rows(c1, rush["mission_id"])
        assert claim(c1, rows[0]["rush_id"]).json()["reward_stamps"] == 10
        f.patch(f"/api/founder/missions/{rush['mission_id']}", json={"reward_stamps": 12},
                headers=im(mission(f, rush["mission_id"])))
        view = rush_rows(c2, rush["mission_id"])
        assert (view[0]["version"], view[0]["reward_stamps"]) == (1, 10)
        assert (view[1]["version"], view[1]["reward_stamps"]) == (2, 12)
        assert claim(c2, rows[1]["rush_id"]).json()["reward_stamps"] == 12
    finally:
        retire_quiet(f, rush["mission_id"])


def test_if_match(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=5)
    path = f"/api/founder/missions/{m['mission_id']}"
    err(f.patch(path, json={"reward_stamps": 6}), 428, "precondition_required")
    stale = f.patch(path, json={"reward_stamps": 6}, headers={"If-Match": f'"{m["revision"] - 1}"'})
    err(stale, 412, "stale_revision")
    assert stale.headers["etag"] == f'"{m["revision"]}"'
    err(f.post(f"{path}/retire", json={}, headers={"If-Match": '"999"'}), 412, "stale_revision")
    assert mission(f, m["mission_id"]) == m
    rs = together([lambda r=r: f.patch(path, json={"reward_stamps": r}, headers=im(m)) for r in (6, 8)])
    assert sorted(x.status_code for x in rs) == [200, 412]
    after = mission(f, m["mission_id"])
    assert after["version"] == m["version"] + 1 and after["revision"] == m["revision"] + 1
    retire_quiet(f, m["mission_id"])


def test_board_date_zone(app_url, mail):
    f = founder(app_url, mail)
    g = new_guest(app_url)
    try:
        for zone in ["Asia/Kathmandu", "Asia/Kolkata", "Australia/Eucla", "Pacific/Chatham", "Australia/Lord_Howe",
                     "America/St_Johns", "Europe/London", "UTC", "America/Vancouver"]:
            t0 = server_time(f)
            r = f.patch("/api/founder/studio", json={"time_zone": zone})
            assert r.status_code == 200 and r.json()["time_zone"] == zone, r.text
            t1 = parsedate_to_datetime(r.headers["date"]) + timedelta(seconds=1)
            allowed = board_dates_at(t0, zone) | board_dates_at(t1, zone)
            assert r.json()["board_date"] in allowed
            dep = g.get("/api/depot").json()
            assert dep["time_zone"] == zone and dep["board_date"] in allowed
            assert f.get("/api/founder/studio").json()["board_date"] in allowed
        before = f.get("/api/founder/studio").json()
        for bad in ["Mars/Olympus", "+05:30", "UTC+3", "america/vancouver", ""]:
            err(f.patch("/api/founder/studio", json={"time_zone": bad}), 422, fields={"time_zone": "invalid"})
        h = helper(app_url, mail)
        err(h.patch("/api/founder/studio", json={"time_zone": "UTC"}), 403, "founder_only")
        assert f.get("/api/founder/studio").json() == before
    finally:
        f.patch("/api/founder/studio", json={"time_zone": "America/Vancouver"})


GAP_PROBE = timedelta(minutes=15)


def clock_changes(zone: str, start: datetime, days: int) -> list[tuple[str | None, str | None, datetime | None]]:
    z = ZoneInfo(zone)
    t = (start + timedelta(hours=1)).astimezone(timezone.utc).replace(minute=0, second=0, microsecond=0)
    prev = t.astimezone(z).utcoffset()
    found: list[tuple[str | None, str | None, datetime | None]] = []
    for _ in range(days * 24):
        nxt = t + timedelta(hours=1)
        off = nxt.astimezone(z).utcoffset()
        if off != prev:
            at = next(t + timedelta(minutes=i) for i in range(1, 61)
                      if (t + timedelta(minutes=i)).astimezone(z).utcoffset() == off)
            if off > prev:
                skipped = (at + prev).replace(tzinfo=None) + GAP_PROBE
                found.append((skipped.strftime("%Y-%m-%dT%H:%M"), None, None))
            else:
                local = (at + off).replace(tzinfo=None) + GAP_PROBE
                found.append((None, local.strftime("%Y-%m-%dT%H:%M"), (local - prev).replace(tzinfo=timezone.utc)))
            prev = off
        t = nxt
    return found


def test_scheduling_studio_time(app_url, mail):
    f = founder(app_url, mail)
    try:
        f.patch("/api/founder/studio", json={"time_zone": "America/Vancouver"})
        m = create_mission(f)
        path = f"/api/founder/missions/{m['mission_id']}/schedule"
        now = server_time(f)
        changes = {z: clock_changes(z, now, 2 * AHEAD_DAYS) for z in ("America/Vancouver", "Australia/Lord_Howe")}
        van_skip = next((s for s, _, _ in changes["America/Vancouver"] if s), None)
        if van_skip:
            err(f.post(path, json={"live_at_local": van_skip}, headers=im(m)), 422,
                fields={"live_at_local": "nonexistent_time"})
        err(f.post(path, json={"live_at_local": "2027-01-15 09:30"}, headers=im(m)), 422, fields={"live_at_local": "invalid"})
        err(f.post(path, json={"live_at_local": "2027-01-15T09:30", "live_at": "now"}, headers=im(m)), 422,
            fields={"live_at_local": "invalid"})
        assert mission(f, m["mission_id"]) == m
        f.patch("/api/founder/studio", json={"time_zone": "Australia/Lord_Howe"})
        lh_skip = next(s for s, _, _ in changes["Australia/Lord_Howe"] if s)
        err(f.post(path, json={"live_at_local": lh_skip}, headers=im(m)), 422,
            fields={"live_at_local": "nonexistent_time"})
        rep_zone, rep_local, rep_inst = next(
            (z, r, i) for z in ("Australia/Lord_Howe", "America/Vancouver") for _, r, i in changes[z]
            if r and now + timedelta(hours=1) < i < now + timedelta(days=AHEAD_DAYS - 1))
        f.patch("/api/founder/studio", json={"time_zone": rep_zone})
        s = f.post(path, json={"live_at_local": rep_local}, headers=im(m))
        assert s.status_code == 200 and s.json()["live_at"] == fmt_iso(rep_inst), s.text
        f.patch("/api/founder/studio", json={"time_zone": "Asia/Kathmandu"})
        assert mission(f, m["mission_id"])["live_at"] == fmt_iso(rep_inst)
        k = create_mission(f)
        want = (now + timedelta(days=30)).astimezone(ZoneInfo("Asia/Kathmandu")).replace(
            hour=9, minute=30, second=0, microsecond=0)
        r = f.post(f"/api/founder/missions/{k['mission_id']}/schedule",
                   json={"live_at_local": want.strftime("%Y-%m-%dT%H:%M")}, headers=im(k))
        assert r.status_code == 200 and r.json()["live_at"] == fmt_iso(want), r.text
    finally:
        f.patch("/api/founder/studio", json={"time_zone": "America/Vancouver"})


def test_online_now(app_url, mail):
    f = founder(app_url, mail)
    fb = Beat(f)

    def stable() -> tuple[dict, list]:
        for _ in range(10):
            fb.send()
            o1, p, o2 = f.get("/api/founder/online").json(), presence(f), f.get("/api/founder/online").json()
            if o1 == o2:
                return o1, p
        raise AssertionError("Online now never held still")

    o, p = stable()
    assert o["online"] == o["guests"] + o["signed_in"] == len(p) + 1
    for _ in range(3):
        before, _ = stable()
        g = new_guest(app_url)
        Beat(g).send()
        Beat(g).send()
        mid, _ = stable()
        sign_in(app_url, mail, fresh_email("online"), c=g)
        after, p = stable()
        assert after["online"] == after["guests"] + after["signed_in"] == len(p) + 1
        if (mid["guests"] - before["guests"], mid["online"] - before["online"]) == (1, 1) and \
                (after["guests"] - mid["guests"], after["signed_in"] - mid["signed_in"]) == (-1, 1):
            return
    raise AssertionError("Online now did not count the guest once and then move it to signed in")


def test_ledger_paging(app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=2)
    c, _, _ = courier(app_url, mail)
    door = doors(c)["ottoline"]
    for _ in range(5):
        deliver(c, m["mission_id"], door)
    first = ledger(c, limit=2).json()
    assert len(first["movements"]) == 2 and first["balance"] == 10 and first["next_cursor"]
    deliver(c, m["mission_id"], door)
    seen = [mv["movement_id"] for mv in first["movements"]]
    cursor = first["next_cursor"]
    while cursor:
        page = ledger(c, limit=2, before=cursor).json()
        assert page["balance"] == 12
        seen += [mv["movement_id"] for mv in page["movements"]]
        cursor = page["next_cursor"]
    full = ledger(c, limit=50).json()["movements"]
    assert len(seen) == len(set(seen)) == 5 and seen == [mv["movement_id"] for mv in full[1:]]
    order = [(mv["created_at"], mv["movement_id"]) for mv in full]
    assert order == sorted(order, reverse=True)
    other, _, _ = courier(app_url, mail)
    err(ledger(other, before=first["next_cursor"]), 422, fields={"before": "invalid"})
    altered = first["next_cursor"][:-1] + ("A" if first["next_cursor"][-1] != "A" else "B")
    err(ledger(c, before=altered), 422, fields={"before": "invalid"})
    for value, reason in [("abc", "invalid"), ("2.5", "invalid"), ("0", "out_of_range"), ("51", "out_of_range")]:
        err(ledger(c, limit=value), 422, fields={"limit": reason})


def test_intro_dive(browser, app_url):
    with open_app(browser, app_url) as page:
        w = bramble(page)
        wait_for(page, lambda: data(w, "scene") == "ready", step_ms=16)
        a = attrs(w)
        assert a["intro"] == "playing" and a["camera"] == "intro" and a["camera-fov"] == str(INTRO_FOV)
        t, last, done_at = 0, math.inf, None
        while t <= INTRO_MAX_MS + 400:
            advance(page, 100)
            t += 100
            a = attrs(w)
            if a["intro"] != "playing":
                done_at = t
                break
            d = float(a["camera-dist-m"])
            assert d <= last + 0.05
            last = d
            if 500 <= t <= 700:
                assert INTRO_NEAR_M < d < INTRO_FAR_M
        assert done_at is not None and INTRO_MIN_MS <= done_at <= INTRO_MAX_MS + 100
        assert a["intro"] == "done" and a["camera"] == "over-shoulder"
        assert int(data(w, "camera-fov")) == FOLLOW_FOV
    with open_app(browser, app_url) as page:
        w = bramble(page)
        wait_for(page, lambda: data(w, "scene") == "ready", step_ms=16)
        page.keyboard.press("x")
        advance(page, SKIP_MS)
        assert data(w, "intro") == "skipped" and data(w, "camera") == "over-shoulder"
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        w = bramble(page)
        wait_for(page, lambda: data(w, "scene") == "ready", step_ms=16)
        assert data(w, "intro") == "off" and data(w, "camera") == "over-shoulder"


def test_ambient_sky(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        assert data(w, "ambient") == "running"
        c0 = int(data(w, "cloud-deg"))
        for _ in range(10):
            advance(page, 1000)
        turned = (int(data(w, "cloud-deg")) - c0) % 360
        assert 10 * 360 / CLOUD_ORBIT_S[1] - 1 <= turned <= 10 * 360 / CLOUD_ORBIT_S[0] + 1
        set_hidden(page, True)
        advance(page, 100)
        assert data(w, "ambient") == "paused"
        c1 = int(data(w, "cloud-deg"))
        advance(page, 5000)
        assert int(data(w, "cloud-deg")) == c1
        set_hidden(page, False)
        advance(page, 100)
        assert data(w, "ambient") == "running" and (int(data(w, "cloud-deg")) - c1) % 360 <= 1
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        w = ready_page(page)
        c0 = data(w, "cloud-deg")
        advance(page, 3000)
        assert data(w, "ambient") == "off" and data(w, "cloud-deg") == c0


def test_walk_and_jump(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        a = attrs(w)
        assert abs(float(a["lat"])) < 0.5 and a["heading-deg"] == "0" and a["grounded"] == "true" and a["carrying"] == "none"
        w.focus()
        page.keyboard.down("w")
        lats, prev = [], None
        for _ in range(150):
            advance(page, 200)
            cur = (data(w, "lat"), data(w, "lon"))
            assert cur != prev
            prev = cur
            lats.append(float(cur[0]))
            assert data(w, "grounded") == "true"
        page.keyboard.up("w")
        travelled = 30 * WALK_MPS
        expected_lat = 180 - math.degrees(travelled / RADIUS_M)
        assert max(lats) > lats[-1] + 1 and abs(lats[-1] - expected_lat) < 8
        assert abs(abs(float(data(w, "lon"))) - 180) < 20
        page.keyboard.press("Space")
        advance(page, 100)
        assert data(w, "grounded") == "false"
        wait_for(page, lambda: data(w, "grounded") == "true", step_ms=STEP_MS, limit_ms=JUMP_MAX_MS)


def test_follow_camera(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        a = attrs(w)
        assert FOLLOW_DIST[0] <= float(a["camera-dist-m"]) <= FOLLOW_DIST[1] and int(a["camera-fov"]) == FOLLOW_FOV
        assert a["camera-settled"] == "true"
        w.focus()
        page.keyboard.down("w")
        for _ in range(6):
            advance(page, 100)
            a = attrs(w)
            assert float(a["camera-alt-m"]) >= CLEARANCE_M and float(a["courier-tilt-deg"]) <= TILT_MAX
        assert a["camera-settled"] == "false"
        page.keyboard.up("w")
        advance(page, SETTLE_MS[0] - 100)
        assert data(w, "camera-settled") == "false"
        wait_for(page, lambda: data(w, "camera-settled") == "true", step_ms=STEP_MS, limit_ms=SETTLE_MS[1])
        assert FOLLOW_DIST[0] <= float(data(w, "camera-dist-m")) <= FOLLOW_DIST[1]
        h0 = int(data(w, "heading-deg"))
        page.keyboard.down("d")
        advance(page, 100)
        assert (int(data(w, "heading-deg")) - h0) % 360 < TURN_DEG_PER_S / 10
        advance(page, 400)
        page.keyboard.up("d")
        h1 = int(data(w, "heading-deg"))
        advance(page, 100)
        assert int(data(w, "heading-deg")) != h1


def test_hidden_tab(browser, app_url):
    with open_app(browser, app_url) as page:
        w = bramble(page)
        wait_for(page, lambda: data(w, "scene") == "ready", step_ms=16)
        advance(page, 500)
        set_hidden(page, True)
        advance(page, 2000)
        set_hidden(page, False)
        advance(page, RESUME_MS)
        assert data(w, "intro") == "done"
        ready_page(page)
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        click(btn(letter, "Take the parcel"))
        wait_for(page, lambda: data(letter, "fold") != "open", step_ms=10)
        set_hidden(page, True)
        advance(page, 3000)
        set_hidden(page, False)
        advance(page, RESUME_MS)
        assert data(route_status(page), "thread-phase") == "walking" and data(w, "camera") == "over-shoulder"


def test_wf_guest_drop_in_first_delivery(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        watch_notices(page)
        guest = on(app_url, page_cookie(page))
        assert me(guest)["role"] == "guest" and me(guest)["balance"] == 0
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        assert re.fullmatch(r"-?\d+,-?\d+", data(letter, "unfold-from"))
        assert all(line in txt(letter) for line in LANTERN_OFFER)
        accepts: list = []
        page.route("**/api/missions/lantern-oil/accept", lose_first(accepts))
        take = btn(letter, "Take the parcel")
        click(take)
        route = route_status(page)
        wait_for(page, lambda: len(accepts) >= 1, step_ms=10)
        r = attrs(route)
        assert take.get_attribute("aria-disabled") == "true"
        assert data(letter, "fold") == "open" and data(letter, "fold-progress") == "1.00"
        assert r["thread-phase"] == "idle" and r["ribbon-visible"] == "0.00" and r.get("route-id", "") == ""
        assert data(w, "camera") == "over-shoulder" and data(w, "carrying") == "none"
        assert data(compass(page), "notch") == "idle" and not present(btn(page, "Drop parcel"))
        phases: list[str] = []

        def walking() -> bool:
            p = data(route, "thread-phase")
            if not phases or phases[-1] != p:
                phases.append(p)
            return p == "walking"

        wait_for(page, walking, step_ms=STEP_MS)
        assert len(accepts) >= 2 and len({body for _, body in accepts}) == 1 and phases.count("pullback") == 1
        assert data(w, "carrying") == "standard"
        parcel = me(guest)["open_parcel"]
        assert data(route, "route-id") == parcel["route"]["route_id"]
        assert notice_count(page, "Parcel taken. Follow the teal thread.") == 1
        page.unroute("**/api/missions/lantern-oil/accept")
        drawn: list[bool] = []

        def check_ribbon(r: dict) -> None:
            if not drawn and r.get("thread-phase") == "walking" and r.get("door-screen") and \
                    float(r.get("ribbon-visible") or 0) >= 0.1:
                drawn.append(teal_within(page, pt(r["door-screen"]), RIBBON_NEAR_PX))

        key_walk_to_door(page, check_ribbon)
        assert drawn == [True]
        hand = btn(page, "Hand over parcel")
        wait_for(page, lambda: present(hand))
        handovers: list = []
        page.route("**/api/deliveries", lose_first(handovers))
        bal = balance_status(page)
        shown0, presses0 = data(bal, "balance-shown"), data(bal, "stamp-presses")
        door_pt = data(route, "door-screen")
        click(hand)
        wait_for(page, lambda: len(handovers) >= 1, step_ms=10)
        assert data(route, "thread-phase") == "handing" and hand.get_attribute("aria-disabled") == "true"
        assert data(compass(page), "notch") == "bearing" and data(w, "carrying") == "standard"
        assert data(bal, "balance-shown") == shown0 and data(bal, "stamp-presses") == presses0
        assert not present(letter)
        wait_for(page, lambda: data(route, "thread-phase") == "delivered", step_ms=STEP_MS)
        assert len(handovers) >= 2 and handovers[0] == handovers[1]
        assert data(compass(page), "notch") == "stamp" and data(w, "carrying") == "none"
        door_pt = data(route, "door-screen") or door_pt
        advance(page, RIBBON_GONE_MS)
        assert not teal_within(page, pt(door_pt), RIBBON_CLEAR_PX)
        wait_for(page, lambda: LANTERN_THANKS in txt(letter))
        wait_for(page, lambda: data(bal, "balance-shown") == str(LANTERN_REWARD))
        assert saw(page, f"Delivered to Ottoline Fennick. +{LANTERN_REWARD} stamps.")
        state = me(guest)
        assert state["balance"] == LANTERN_REWARD and state["open_parcel"] is None
        assert len(ledger(guest).json()["movements"]) == 1
        page.reload()
        ready_page(page)
        assert f"{LANTERN_REWARD} stamps" in txt(balance_status(page))
        assert me(on(app_url, page_cookie(page)))["balance"] == LANTERN_REWARD


def test_guest_save_reload(browser, app_url):
    with open_app(browser, app_url) as page:
        ready_page(page)
        cookie = page_cookie(page)
        g = on(app_url, cookie)
        state = me(g)
        assert state["role"] == "guest" and state["email"] is None and state["balance"] == 0
        assert state["satchel_colour"] == "canvas" and "canvas" in state["satchels_owned"]
        dd = doors(g)
        deliver(g, "star-chart", dd["pim"])
        deliver(g, "lantern-oil", dd["ottoline"])
        assert buy(g, "riso-pink").status_code == 201
        assert g.patch("/api/me", json={"satchel_id": "riso-pink"}).status_code == 200
        parcel = accept(g, "seed-packets").json()
        page.reload()
        w = ready_page(page)
        assert page_cookie(page) == cookie
        wait_for(page, lambda: f"{GUEST_AFTER_PINK} stamps" in txt(balance_status(page)))
        satchel = page.get_by_role("complementary", name="Satchel", exact=True)
        wait_for(page, lambda: f"Wearing {RISO_NAME}" in txt(satchel))
        wait_for(page, lambda: data(w, "carrying") == "standard"
                 and data(route_status(page), "route-id") == parcel["route"]["route_id"])
        assert me(g)["open_parcel"]["acceptance_id"] == parcel["acceptance_id"]
    with open_app(browser, app_url) as other:
        ready_page(other)
        assert page_cookie(other) != cookie
        assert me(on(app_url, page_cookie(other)))["balance"] == 0


def test_resident_letter(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=4, resident="barnaby")
    offer = ["Version two, first line.", "Version two, second line."]
    edited = f.patch(f"/api/founder/missions/{m['mission_id']}",
                     json={"dialogue": {"offer": offer, "thanks": ["Ta."]}},
                     headers=im(mission(f, m["mission_id"])))
    assert edited.status_code == 200 and edited.json()["version"] == 2
    try:
        with open_app(browser, app_url) as page:
            ready_page(page)
            vw, vh = page.evaluate("() => [innerWidth, innerHeight]")
            board = page.get_by_role("complementary", name="Depot board", exact=True)
            read = btn(board, f"Read {m['title']}")
            wait_for(page, lambda: present(read))
            click(read)
            letter = page.get_by_role("dialog", name=f"Letter from {BARNABY}", exact=True)
            wait_for(page, lambda: present(letter), step_ms=10)
            assert data(letter, "fold") == "unfolding"
            x, y = pt(data(letter, "unfold-from"))
            assert 0 <= x <= vw and 0 <= y <= vh
            rising: list = []
            took = wait_for(page, lambda: rising.append(flt(letter, "fold-progress")) or data(letter, "fold") == "open",
                            step_ms=25, limit_ms=LETTER_UNFOLD_MS[1] + 50)
            assert took >= LETTER_UNFOLD_MS[0] - 50
            seen = [v for v in rising if v is not None]
            assert seen == sorted(seen) and data(letter, "fold-progress") == "1.00"
            assert all(line in txt(letter) for line in offer) and PROBE_DIALOGUE["offer"][0] not in txt(letter)
            click(btn(letter, "Not now"))
            falling: list = []
            took = wait_for(page, lambda: falling.append(flt(letter, "fold-progress")) or not present(letter),
                            step_ms=25, limit_ms=LETTER_FOLD_MS[1] + 75)
            assert took >= LETTER_FOLD_MS[0] - 50
            seen = [v for v in falling if v is not None]
            assert seen == sorted(seen, reverse=True)
            assert me(on(app_url, page_cookie(page)))["open_parcel"] is None
    finally:
        retire_quiet(f, m["mission_id"])


def test_ribbon_drawn(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        click(btn(letter, "Take the parcel"))
        route = route_status(page)
        wait_for(page, lambda: data(route, "thread-phase") == "walking", step_ms=STEP_MS)
        drawn: list[bool] = []
        last: list[str] = []

        def check_ribbon(r: dict) -> None:
            if r.get("door-screen"):
                last.append(r["door-screen"])
            if not drawn and r.get("thread-phase") == "walking" and r.get("door-screen") and \
                    float(r.get("ribbon-visible") or 0) >= 0.1:
                drawn.append(teal_within(page, pt(r["door-screen"]), RIBBON_NEAR_PX))

        key_walk_to_door(page, check_ribbon)
        assert drawn == [True]
        click(btn(page, "Drop parcel"))
        wait_for(page, lambda: check_ribbon(attrs(route)) or (data(route, "thread-phase") == "idle"
                                                                and data(w, "carrying") == "none"), step_ms=STEP_MS)
        assert last
        advance(page, RIBBON_GONE_MS)
        assert not teal_within(page, pt(last[-1]), RIBBON_CLEAR_PX)
        assert me(on(app_url, page_cookie(page)))["open_parcel"] is None


def test_reduced_motion_readout(browser, app_url):
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        w = ready_page(page)
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        click(btn(letter, "Take the parcel"))
        route = route_status(page)
        cams, phases = set(), set()
        wait_for(page, lambda: cams.add(data(w, "camera")) or phases.add(data(route, "thread-phase"))
                 or data(route, "thread-phase") == "walking", step_ms=10)
        assert cams == {"over-shoulder"} and phases <= {"idle", "walking"}
        r = attrs(route)
        assert r["ribbon-visible"] == "1.00" and r["ribbon-fraction"] == "1.00"
        assert data(compass(page), "ring-deg") == "0" and txt(route) == LANTERN_READOUT
        box = route.bounding_box()
        assert box and box["width"] > 1 and box["height"] > 1
        fractions: set[str] = set()
        rings: set[str] = set()

        def watch(r: dict) -> None:
            fractions.add(r.get("ribbon-fraction", ""))
            rings.add(data(compass(page), "ring-deg"))
            cams.add(data(w, "camera"))

        key_walk_to_door(page, watch)
        seen = {x for x in fractions if x}
        assert len(seen) >= 3 and all(re.fullmatch(r"(0\.\d|1\.0)0", x) for x in seen), seen
        assert rings == {"0"} and cams == {"over-shoulder"}
        wait_for(page, lambda: f"Arrived at {LANTERN_HOME}." in txt(route))


def test_wf_guest_drop_in_retired_errand(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=4, resident="barnaby")
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        watch_notices(page)
        letter = open_letter(page, m["title"], "Barnaby Sorrel")
        retire_quiet(f, m["mission_id"])
        route = route_status(page)
        take = btn(letter, "Take the parcel")
        with held(page, f"**/api/missions/{m['mission_id']}/accept") as gate:
            click(take)
            advance(page, 300)
            assert take.get_attribute("aria-disabled") == "true" and data(letter, "fold-progress") == "1.00"
            assert data(route, "thread-phase") == "idle" and data(route, "ribbon-visible") == "0.00"
            assert data(w, "camera") == "over-shoulder" and data(w, "carrying") == "none"
            gate.release()
        phases: set[str] = set()
        wait_for(page, lambda: phases.add(data(route, "thread-phase")) or saw(page, "This errand is no longer posted."))
        wait_for(page, lambda: not present(letter) and not present(btn(page, f"Read {m['title']}")))
        assert phases == {"idle"} and data(w, "carrying") == "none"
        assert me(on(app_url, page_cookie(page)))["open_parcel"] is None


def test_wf_guest_drop_in_touch_reduced_motion(browser, app_url):
    with open_app(browser, app_url, reduced_motion="reduce") as page:
        cdp = enable_touch(page, PHONE)
        w = ready_page(page)
        assert data(w, "intro") == "off"
        tap(btn(page, "Depot board"))
        read = btn(page, f"Read {LANTERN_TITLE}")
        wait_for(page, lambda: present(read))
        tap(read)
        letter = page.get_by_role("dialog", name=f"Letter from {OTTOLINE}", exact=True)
        wait_for(page, lambda: data(letter, "fold") == "open")
        tap(btn(letter, "Take the parcel"))
        route = route_status(page)
        cams, phases = set(), set()
        wait_for(page, lambda: cams.add(data(w, "camera")) or phases.add(data(route, "thread-phase"))
                 or data(route, "thread-phase") == "walking", step_ms=STEP_MS)
        assert cams == {"over-shoulder"} and phases <= {"idle", "walking"}
        r = attrs(route)
        assert r["ribbon-fraction"] == "1.00" and r["ribbon-visible"] == "1.00"
        assert data(compass(page), "ring-deg") == "0" and txt(route) == LANTERN_READOUT
        box = route.bounding_box()
        assert box and box["width"] > 1 and box["height"] > 1
        tap(btn(page, "Jump"))
        advance(page, 100)
        assert data(w, "grounded") == "false"
        wait_for(page, lambda: data(w, "grounded") == "true", step_ms=STEP_MS, limit_ms=JUMP_MAX_MS)
        lat0 = data(w, "lat")
        stick(page, cdp, 0, -1, 500)
        assert data(w, "lat") != lat0
        assert re.fullmatch(r"\d\.\d0", data(route, "ribbon-fraction"))
        touch_walk_to_door(page, cdp)
        wait_for(page, lambda: f"Arrived at {LANTERN_HOME}." in txt(route), limit_ms=2000)
        assert data(compass(page), "ring-deg") == "0"
        tap(btn(page, "Hand over parcel"))
        wait_for(page, lambda: data(route, "thread-phase") == "delivered")
        assert me(on(app_url, page_cookie(page)))["balance"] == LANTERN_REWARD


def test_wf_horizon_thread_motion(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        vw, vh = page.evaluate("() => [innerWidth, innerHeight]")
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        click(btn(letter, "Take the parcel"))
        route = route_status(page)
        samples, t, deadline = [], 0, time.monotonic() + UI_WAIT_S
        while time.monotonic() < deadline:
            r, a = attrs(route), attrs(w)
            lp = data(letter, "fold-progress") if present(letter) else None
            samples.append((t, r, a, lp))
            if r.get("thread-phase") == "walking":
                break
            advance(page, 25)
            t += 25
        first: dict[str, int] = {}
        for t_, r, a, lp in samples:
            first.setdefault(r.get("thread-phase", ""), t_)
        pull, unspool, back = (first["unspool"] - first["pullback"], first["return"] - first["unspool"],
                               first["walking"] - first["return"])
        assert PULLBACK_MS[0] - 25 <= pull <= PULLBACK_MS[1] + 25
        assert UNSPOOL_MS[0] - 25 <= unspool <= UNSPOOL_MS[1] + 25
        assert RETURN_MS[0] - 25 <= back <= RETURN_MS[1] + 25
        start = next(s for s in samples if s[1].get("thread-phase") == "pullback")
        assert start[3] in (None, "0.00") and start[2]["camera"] == "orbit"
        ribbon = [float(r["ribbon-visible"]) for _, r, _, _ in samples if r.get("thread-phase") == "unspool"]
        assert ribbon == sorted(ribbon)
        for _, r, a, _ in samples:
            if r.get("thread-phase") == "unspool":
                for p in (a["courier-screen"], r["door-screen"]):
                    x, y = pt(p)
                    assert vw / 10 <= x <= vw * 9 / 10 and vh / 10 <= y <= vh * 9 / 10
        assert samples[-1][2]["camera"] == "over-shoulder"


def test_route_readout(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        click(btn(letter, "Take the parcel"))
        route = route_status(page)
        wait_for(page, lambda: data(route, "thread-phase") == "walking", step_ms=STEP_MS)
        parcel = me(on(app_url, page_cookie(page)))["open_parcel"]
        r = attrs(route)
        assert r["route-id"] == parcel["route"]["route_id"]
        assert abs(float(r["arc-remaining-m"]) - LANTERN_ARC_M) <= 0.1 and r["bearing-deg"] == str(LANTERN_BEARING)
        assert r["ribbon-fraction"] == "1.00" and data(compass(page), "ring-deg") == str(LANTERN_BEARING)
        assert data(compass(page), "notch") == "bearing" and txt(route) == LANTERN_READOUT
        w.focus()
        hold(page, "w", 2000)
        advance(page, 200)
        pos = {"lat": float(data(w, "lat")), "lon": float(data(w, "lon"))}
        door = parcel["route"]["door"]
        r = attrs(route)
        assert abs(float(r["arc-remaining-m"]) - arc_m(pos, door)) <= 0.3
        assert abs(int(r["bearing-deg"]) - bearing_deg(pos, door)) <= 1
        assert abs(float(r["ribbon-fraction"]) - min(1, arc_m(pos, door) / parcel["route"]["total_arc_m"])) <= 0.01
        assert data(compass(page), "ring-deg") == r["bearing-deg"]


def test_wf_horizon_thread_reduced_switch(browser, app_url):
    with open_app(browser, app_url) as page:
        w = ready_page(page)
        letter = open_letter(page, LANTERN_TITLE, "Ottoline Fennick")
        click(btn(letter, "Take the parcel"))
        route = route_status(page)
        wait_for(page, lambda: data(route, "thread-phase") == "walking", step_ms=STEP_MS)
        rid = data(route, "route-id")
        w.focus()
        hold(page, "w", 1000)
        phases: set[str] = set()
        page.emulate_media(reduced_motion="reduce")
        for _ in range(5):
            advance(page, SWITCH_MS / 5)
            phases.add(data(route, "thread-phase"))
        a = attrs(w)
        assert a["ambient"] == "off" and a["camera-settled"] == "true" and a["intro"] == "done"
        assert data(compass(page), "ring-deg") == "0" and re.fullmatch(r"\d\.\d0", data(route, "ribbon-fraction"))
        assert txt(route).startswith("Bearing") and (route.bounding_box() or {}).get("width", 0) > 1
        frozen = a["cloud-deg"]
        advance(page, 1000)
        assert data(w, "cloud-deg") == frozen
        page.emulate_media(reduced_motion="no-preference")
        for _ in range(5):
            advance(page, SWITCH_MS / 5)
            phases.add(data(route, "thread-phase"))
        a, r = attrs(w), attrs(route)
        assert a["ambient"] == "running" and (int(a["cloud-deg"]) - int(frozen)) % 360 <= 4
        assert data(compass(page), "ring-deg") == r["bearing-deg"] and a["intro"] == "done"
        assert phases == {"walking"} and r["route-id"] == rid and data(compass(page), "notch") == "bearing"
        assert data(w, "carrying") == "standard"


def test_wf_claim_save_merge(browser, app_url, mail):
    with open_app(browser, app_url) as page:
        ready_page(page)
        old = page_cookie(page)
        g = on(app_url, old)
        dd = doors(g)
        deliver(g, "star-chart", dd["pim"])
        deliver(g, "lantern-oil", dd["ottoline"])
        assert buy(g, "riso-pink").status_code == 201
        ids = [mv["movement_id"] for mv in ledger(g).json()["movements"]]
        page.reload()
        ready_page(page)
        watch_notices(page)
        click(btn(page, "Claim this save"))
        dialog = page.get_by_role("dialog", name="Claim this save", exact=True)
        email = fresh_email("claimui")
        before = key_links(mail, email)
        fill(dialog.get_by_role("textbox", name="Email", exact=True), email)
        click(btn(dialog, "Send postbox key"))
        wait_for(page, lambda: saw(page, "Check your inbox for a postbox key."))
        deadline = time.monotonic() + MAIL_WAIT_S
        while not (key_links(mail, email) - before):
            assert time.monotonic() < deadline
        page.goto(app_url + (key_links(mail, email) - before).pop())
        walk = btn(page, "Walk on Bramble")
        wait_for(page, lambda: present(walk) and "Save claimed. Your stamps travel with you now." in page.content())
        click(walk)
        wait_for(page, lambda: urlparse(page.url).path == "/")
        ready_page(page)
        postbox = page.get_by_role("complementary", name="Postbox", exact=True)
        wait_for(page, lambda: email in txt(postbox))
        assert f"{GUEST_AFTER_PINK} stamps" in txt(balance_status(page))
        c = on(app_url, page_cookie(page))
        state = me(c)
        assert state["role"] == "courier" and state["balance"] == GUEST_AFTER_PINK and "riso-pink" in state["satchels_owned"]
        assert [mv["movement_id"] for mv in ledger(c).json()["movements"]] == ids
        err(on(app_url, old).get("/api/me"), 401, "unauthenticated")


def test_wf_claim_save_console_return(browser, app_url, mail):
    with open_app(browser, app_url) as page:
        page.goto(f"{app_url}/console?mission=lantern-oil")
        wait_for(page, lambda: "Only the founder can open the console." in page.content())
        before = key_links(mail, FOUNDER_EMAIL)
        fill(page.get_by_role("textbox", name="Email", exact=True), FOUNDER_EMAIL)
        click(btn(page, "Send postbox key"))
        deadline = time.monotonic() + MAIL_WAIT_S
        while not (key_links(mail, FOUNDER_EMAIL) - before):
            assert time.monotonic() < deadline
        link = (key_links(mail, FOUNDER_EMAIL) - before).pop()
        page.goto(f"{app_url}{link}&return_to=//evil.example&next=https://evil.example")
        open_console = btn(page, "Open the console")
        wait_for(page, lambda: present(open_console))
        assert not present(btn(page, "Walk on Bramble"))
        click(open_console)
        wait_for(page, lambda: page.url == f"{app_url}/console?mission=lantern-oil")
        title = page.get_by_role("textbox", name="Title", exact=True)
        wait_for(page, lambda: present(title) and title.input_value() == LANTERN_TITLE and is_focused(title))
        assert urlparse(page.url).netloc == urlparse(app_url).netloc
        assert me(on(app_url, page_cookie(page)))["role"] == "founder"


def test_wf_claim_save_sign_out(browser, app_url, mail):
    obs = new_guest(app_url)
    email = fresh_email("laptop")
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, email)
        cookie = page_cookie(page)
        name = me(on(app_url, cookie))["display_name"]
        wait_for(page, lambda: len(named(presence(obs), name)) == 1, step_ms=500)
        watch_notices(page)
        click(btn(page, "Sign out"))
        wait_for(page, lambda: saw(page, "Signed out. You're a guest courier again."))
        assert named(presence(obs), name) == []
        err(on(app_url, cookie).get("/api/me"), 401, "unauthenticated")


def test_wf_rush_race_claim(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=3, reward=8, resident="juniper")
    try:
        rival, _, _ = courier(app_url, mail)
        with open_app(browser, app_url) as page:
            browser_sign_in(page, app_url, mail, fresh_email("racer"))
            w = bramble(page)
            watch_notices(page)
            board = page.get_by_role("complementary", name="Depot board", exact=True)
            date = rival.get("/api/depot").json()["board_date"]
            wait_for(page, lambda: re.search(rf"Rush board · {date} · \d+ left", txt(board)))
            names = [f"Claim {m['title']}, parcel {i} of 3" for i in (1, 2, 3)]
            wait_for(page, lambda: all(btn(board, n).count() == 1 for n in names))
            target = btn(board, names[1])
            with held(page, "**/api/rush/*/claim") as gate:
                click(target)
                advance(page, 300)
                assert txt(target) == "Claiming…" and target.get_attribute("aria-disabled") == "true"
                assert data(w, "carrying") == "none"
                gate.release()
            wait_for(page, lambda: data(w, "carrying") == "rush" and "Yours" in txt(board))
            assert saw(page, "It's yours! Deliver before")
            assert rush_rows(rival, m["mission_id"])[1]["status"] == "taken"
            assert me(on(app_url, page_cookie(page)))["open_parcel"]["rush_id"] == rush_rows(rival, m["mission_id"])[1]["rush_id"]
    finally:
        retire_quiet(f, m["mission_id"])


def test_wf_rush_race_taken(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=1, reward=8, resident="juniper")
    try:
        rival, _, _ = courier(app_url, mail)
        with open_app(browser, app_url) as page:
            browser_sign_in(page, app_url, mail, fresh_email("loser"))
            w = bramble(page)
            watch_notices(page)
            board = page.get_by_role("complementary", name="Depot board", exact=True)
            target = btn(board, f"Claim {m['title']}, parcel 1 of 1")
            wait_for(page, lambda: present(target))
            assert claim(rival, rush_rows(rival, m["mission_id"])[0]["rush_id"]).status_code == 201
            click(target)
            wait_for(page, lambda: saw(page, "Another courier got there first."))
            wait_for(page, lambda: not present(target) and "Taken" in txt(board))
            assert data(w, "carrying") == "none"
            state = me(on(app_url, page_cookie(page)))
            assert state["open_parcel"] is None and state["balance"] == 0
    finally:
        retire_quiet(f, m["mission_id"])


def test_wf_rush_race_lapse(browser, app_url, mail):
    short = outage("APP_SHORT_HOLDS_URL")
    f = founder(app_url, mail)
    m = live_mission(f, kind="rush", slots=1, reward=8, resident="juniper")
    try:
        c, _, _ = courier(app_url, mail)
        cookie = jar_cookie(c)
        with open_app(browser, short) as page:
            page.context.add_cookies([{"name": "pm_session", "value": cookie, "url": short}])
            page.reload()
            w = ready_page(page)
            watch_notices(page)
            name = f"Claim {m['title']}, parcel 1 of 1"
            target = btn(page, name)
            wait_for(page, lambda: present(target))
            click(target)
            fake = wait_for(page, lambda: data(w, "carrying") == "rush", step_ms=STEP_MS)
            hold_end = iso(me(on(short, cookie))["open_parcel"]["hold_expires_at"])
            wait_server(api(short), hold_end + timedelta(seconds=1))
            fake += wait_for(page, lambda: data(w, "carrying") == "none"
                             and data(route_status(page), "thread-phase") == "idle", step_ms=100)
            assert fake <= SHORT_HOLD_S * 1000 + LAPSE_MS
            copy = "Your rush hold ran out. The parcel is back on the board."
            assert notice_count(page, copy) == 1
            wait_for(page, lambda: txt(route_status(page)) == "", limit_ms=2000)
            wait_for(page, lambda: present(btn(page, name)))
            assert not present(btn(page, "Hand over parcel")) and not present(btn(page, "Drop parcel"))
            advance(page, LAPSE_MS)
            assert notice_count(page, copy) == 1
    finally:
        retire_quiet(f, m["mission_id"])


def test_wf_darkroom_outage_photo_closed(browser, app_url):
    down = outage("APP_MINIO_DOWN_URL")
    with open_app(browser, down) as page:
        w = ready_page(page)
        click(btn(page, "Photo mode"))
        dialog = page.get_by_role("dialog", name="Photo mode", exact=True)
        status = dialog.get_by_role("status", name="Darkroom", exact=True)
        wait_for(page, lambda: "The darkroom is closed." in txt(status))
        shutter = btn(dialog, "Take postcard")
        assert shutter.is_disabled() or shutter.get_attribute("aria-disabled") == "true"
        click(btn(dialog, "Leave photo mode"))
        wait_for(page, lambda: data(w, "camera") == "over-shoulder")
        lat0 = data(w, "lat")
        w.focus()
        hold(page, "w", 800)
        assert data(w, "lat") != lat0
        g = on(down, page_cookie(page))
        assert api(down).get("/api/status").json()["darkroom"] == "closed"
        assert deliver(g, "star-chart", doors(g)["pim"])["stamps_awarded"] == STAR_REWARD


def test_wf_darkroom_outage_share_page(browser, app_url, mail):
    down = outage("APP_MINIO_DOWN_URL")
    c, _, name = courier(app_url, mail)
    token = upload(c).json()["share_url"].rsplit("/p/", 1)[1]
    with open_app(browser, f"{down}/p/{token}") as page:
        wait_for(page, lambda: present(page.get_by_role("heading", name="A postcard from Bramble")))
        assert f"Sent by {name}" in page.content()
    assert api(down).get(f"/p/{token}/image.png").json() == DARKROOM_CLOSED
    assert api(down).post(f"/p/{token}").status_code == 405
    assert api(app_url).get(f"/p/{token}/image.png").status_code == 200


def test_wf_postcards_capture(browser, app_url, mail):
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, fresh_email("photo"))
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        w = bramble(page)
        watch_notices(page)
        click(btn(page, "Photo mode"))
        dialog = page.get_by_role("dialog", name="Photo mode", exact=True)
        wait_for(page, lambda: data(w, "camera") == "photo"
                 and txt(dialog.get_by_role("status", name="Darkroom", exact=True)) == "Darkroom open")
        assert data(w, "photo-yaw-deg") == "0" and data(w, "camera-fov") == str(PHOTO_FOV)
        right, left, up, down = "ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown"

        def press(key: str) -> None:
            page.keyboard.press(key)
            advance(page, STEP_MS)

        press(right)
        assert data(w, "photo-yaw-deg") == str(YAW_STEP)
        press(left)
        press(left)
        assert data(w, "photo-yaw-deg") == str(360 - YAW_STEP)
        press(up)
        assert data(w, "camera-fov") == str(PHOTO_FOV - ZOOM_STEP)
        for _ in range(10):
            press(down)
        assert data(w, "camera-fov") == str(FOV_MAX)
        vw, vh = page.evaluate("() => [innerWidth, innerHeight]")
        page.mouse.move(vw / 2, vh / 2)
        page.mouse.wheel(0, -100)
        advance(page, 50)
        assert data(w, "camera-fov") == str(FOV_MAX - ZOOM_STEP)
        yaw0 = int(data(w, "photo-yaw-deg"))
        page.mouse.down()
        page.mouse.move(vw / 2 + 10 * DRAG_PX_PER_DEG, vh / 2, steps=5)
        page.mouse.up()
        advance(page, 50)
        assert (int(data(w, "photo-yaw-deg")) - yaw0) % 360 == 10
        c = on(app_url, page_cookie(page))
        before = {p["postcard_id"] for p in c.get("/api/postcards").json()["postcards"]}
        click(btn(dialog, "Take postcard"))
        wait_for(page, lambda: saw(page, "Postcard saved to your postbox."))
        new = [p for p in c.get("/api/postcards").json()["postcards"] if p["postcard_id"] not in before]
        assert len(new) == 1 and (new[0]["width"], new[0]["height"]) == (CAPTURE_W, CAPTURE_H)
        stored = S3().get(f"postcards/{new[0]['postcard_id']}.png")
        assert struct.unpack(">II", stored[16:24]) == (CAPTURE_W, CAPTURE_H)
        click(btn(dialog, "Leave photo mode"))
        wait_for(page, lambda: data(w, "camera") == "over-shoulder")
        cards = page.get_by_role("list", name="Postcards", exact=True)
        wait_for(page, lambda: present(btn(cards, "Copy link")))
        click(btn(cards, "Copy link").first)
        wait_for(page, lambda: saw(page, "Link copied."))
        assert page.evaluate("() => navigator.clipboard.readText()") == new[0]["share_url"]


def test_wf_postcards_revoke(browser, app_url, mail):
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, fresh_email("revoke"))
        c = on(app_url, page_cookie(page))
        card = upload(c).json()
        page.reload()
        ready_page(page)
        cards = page.get_by_role("list", name="Postcards", exact=True)
        revoke = btn(cards, "Revoke postcard")
        wait_for(page, lambda: present(revoke))
        click(revoke.first)
        confirm = page.get_by_role("alertdialog", name="Revoke postcard", exact=True)
        wait_for(page, lambda: "Revoke this postcard? Its link will stop working." in txt(confirm))
        click(btn(confirm, "Keep it"))
        wait_for(page, lambda: is_focused(revoke.first))
        click(revoke.first)
        wait_for(page, lambda: present(confirm))
        click(btn(confirm, "Revoke"))
        wait_for(page, lambda: cards.get_by_role("listitem").count() == 0)
        token = card["share_url"].rsplit("/p/", 1)[1]
        assert api(app_url).get(f"/p/{token}").status_code == 404
        assert f"postcards/{card['postcard_id']}.png" not in S3().keys("postcards/")


def test_wf_postcard_mail_retry_and_limit(browser, app_url, mail):
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, fresh_email("mailer"))
        c = on(app_url, page_cookie(page))
        pid = upload(c).json()["postcard_id"]
        for _ in range(MAIL_LIMIT - 1):
            assert mail_card(c, pid, fresh_email("friend")).status_code == 200
        page.reload()
        ready_page(page)
        watch_notices(page)
        sends: list = []
        page.route(f"**/api/postcards/{pid}/mail", lose_first(sends))
        cards = page.get_by_role("list", name="Postcards", exact=True)
        opener = btn(cards, "Mail to a friend")
        wait_for(page, lambda: present(opener))
        friend = fresh_email("friend")
        click(opener.first)
        dialog = page.get_by_role("dialog", name="Mail a postcard", exact=True)
        fill(dialog.get_by_role("textbox", name="Friend's email", exact=True), friend)
        click(btn(dialog, "Send postcard"))
        wait_for(page, lambda: saw(page, f"Postcard mailed to {friend}."))
        assert len(sends) >= 2 and len(set(sends)) == 1 and not present(dialog)
        assert len(wait_mails(mail, friend, 1)) == 1
        late = fresh_email("friend")
        click(opener.first)
        fill(dialog.get_by_role("textbox", name="Friend's email", exact=True), late)
        click(btn(dialog, "Send postcard"))
        wait_for(page, lambda: saw_re(page, r"You've mailed a lot of postcards\. Try again in \d+ minutes\."))
        assert mails_to(mail, late, settle=1.5) == []


def test_wf_postcard_mail_notice_motion(browser, app_url, mail):
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, fresh_email("notice"))
        c = on(app_url, page_cookie(page))
        pid = upload(c).json()["postcard_id"]
        page.reload()
        ready_page(page)
        note = notices(page)
        opener = btn(page.get_by_role("list", name="Postcards", exact=True), "Mail to a friend")
        wait_for(page, lambda: present(opener))
        click(opener.first)
        dialog = page.get_by_role("dialog", name="Mail a postcard", exact=True)
        fill(dialog.get_by_role("textbox", name="Friend's email", exact=True), "not-an-address")
        click(btn(dialog, "Send postcard"))
        bad_address = "Enter your friend's email address."
        deadline = time.monotonic() + UI_WAIT_S
        while bad_address not in txt(note):
            assert time.monotonic() < deadline, "the invalid-address copy never appeared"
        samples: list[tuple[str, str]] = []

        def entered() -> bool:
            samples.append((txt(note), data(note, "notice-phase")))
            return samples[-1][1] == "shown"

        entering = wait_for(page, entered, step_ms=10, limit_ms=NOTICE_MS[1] + 50)
        assert any(p == "entering" for t, p in samples if bad_address in t), samples
        assert entering >= NOTICE_MS[0] - 50, samples
        page.keyboard.press("Escape")
        page.emulate_media(reduced_motion="reduce")
        phases: set[str] = set()
        name_box = page.get_by_role("textbox", name="Display name", exact=True)
        fill(name_box, "🦊" * (NAME_MAX + 1))
        click(btn(page, "Save name"))
        wait_for(page, lambda: phases.add(data(note, "notice-phase")) or "Names are 1 to 24 characters." in txt(note),
                 step_ms=10)
        assert "entering" not in phases and data(note, "notice-phase") == "shown"
        assert mail_card(c, pid, fresh_email("friend")).status_code == 200


def test_wf_presence_figures(browser, app_url):
    b = new_guest(app_url)
    name = fresh_name()
    b.patch("/api/me", json={"display_name": name})
    beat = Beat(b)
    p1 = {"lat": 0.5, "lon": 0.5}
    with open_app(browser, app_url) as page:
        ready_page(page)
        beat.send(**p1)
        item = page.get_by_role("list", name="Couriers nearby", exact=True).get_by_role("listitem").filter(has_text=name)
        wait_for(page, lambda: beat.keep(p1) or item.count() > 0, step_ms=STEP_MS)
        assert data(item, "fade") == "in"
        fade = wait_for(page, lambda: data(item, "fade") == "shown", step_ms=STEP_MS, limit_ms=FADE_MS[1] + STEP_MS)
        assert fade >= FADE_MS[0] - STEP_MS * 2
        handle = item.element_handle()
        p2 = towards(p1, 5, 0)
        beat.send(**p2)
        lat1 = float(data(item, "shown-lat"))
        wait_for(page, lambda: beat.keep(p2) or float(data(item, "shown-lat")) != lat1, step_ms=STEP_MS)
        assert lat1 < float(data(item, "shown-lat")) < round(p2["lat"], 2)
        glide = wait_for(page, lambda: abs(float(data(item, "shown-lat")) - p2["lat"]) < 0.011, step_ms=STEP_MS,
                         limit_ms=GLIDE_MS[1] + STEP_MS * 2)
        assert glide + STEP_MS >= GLIDE_MS[0] / 2
        p3 = towards(p2, SNAP_M + 10, 90)
        beat.send(**p3)
        lon2 = data(item, "shown-lon")
        wait_for(page, lambda: beat.keep(p3) or data(item, "shown-lon") != lon2, step_ms=STEP_MS)
        assert abs(float(data(item, "shown-lon")) - p3["lon"]) < 0.011
        renamed = fresh_name()
        b.patch("/api/me", json={"display_name": renamed})
        fades: set[str] = set()
        wait_for(page, lambda: beat.keep(p3) or fades.add(handle.get_attribute("data-fade") or "")
                 or renamed in (handle.text_content() or ""), step_ms=STEP_MS)
        assert handle.evaluate("el => el.isConnected") and fades == {"shown"}
        assert b.post("/api/auth/sign-out", json={}).status_code == 204
        seen_out: list[bool] = []

        def leaving() -> bool:
            connected = handle.evaluate("el => el.isConnected")
            seen_out.append(connected and handle.get_attribute("data-fade") == "out")
            return not connected

        wait_for(page, leaving, step_ms=STEP_MS)
        assert any(seen_out)


def test_wf_presence_mute_bubble(browser, app_url, mail):
    a = new_guest(app_url)
    name = fresh_name()
    a.patch("/api/me", json={"display_name": name})
    beat = Beat(a)
    h = helper(app_url, mail)
    with open_app(browser, app_url) as page:
        ready_page(page)
        beat.send(emote="wave")
        item = page.get_by_role("list", name="Couriers nearby", exact=True).get_by_role("listitem").filter(has_text=name)
        wait_for(page, lambda: data(item, "emote") == "wave", step_ms=STEP_MS)
        ref = staff_entry(h, name)["moderation_ref"]
        assert h.post(f"/api/moderation/{ref}/mute", json={}).status_code == 200
        wait_for(page, lambda: beat.keep() or data(item, "emote") == "", step_ms=STEP_MS, limit_ms=3000)
        mine = me(on(app_url, page_cookie(page)))["display_name"]
        click(btn(page, "Wave"))
        wait_for(page, lambda: any(e["emote"] == "wave" for e in named(presence(a), mine)), step_ms=200, limit_ms=3000)


def test_wf_moderation_keyboard(browser, app_url, mail):
    targets = []
    for _ in range(3):
        g = new_guest(app_url)
        n = fresh_name("M")
        g.patch("/api/me", json={"display_name": n})
        targets.append((g, Beat(g), n))

    def keep() -> None:
        for _, beat_, _ in targets:
            beat_.keep()

    f = founder(app_url, mail)
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, HELPER_EMAIL)
        keep()
        opener = btn(page, "Moderation")
        opener.focus()
        page.keyboard.press("Enter")
        drawer = page.get_by_role("dialog", name="Moderation drawer", exact=True)
        wait_for(page, lambda: keep() or present(btn(drawer, f"Mute {targets[0][2]}")), step_ms=500)

        def tab_to(label: str) -> None:
            for _ in range(STEER_STEPS):
                keep()
                if tab_order(page, 1)[0] == label:
                    return
            raise AssertionError(f"Tab never reached {label}")

        t1, t2, t3 = (t[2] for t in targets)
        tab_to(f"Mute {t1}")
        page.keyboard.press("Enter")
        unmute = btn(drawer, f"Unmute {t1}")
        wait_for(page, lambda: is_focused(unmute))
        handle = unmute.element_handle()
        advance(page, DRAWER_RELOAD_MS)
        keep()
        assert handle.evaluate("el => el === document.activeElement")
        tab_to(f"Mute {t2}")
        f.post(f"/api/moderation/{staff_entry(f, t2)['moderation_ref']}/mute", json={})
        watch_notices(page)
        page.keyboard.press("Enter")
        wait_for(page, lambda: saw(page, f"{t2} is already muted.") and is_focused(btn(drawer, f"Unmute {t2}")))
        tab_to(f"Rename {t1}")
        page.keyboard.press("Enter")
        confirm = page.get_by_role("alertdialog", name="Rename courier", exact=True)
        wait_for(page, lambda: is_focused(btn(confirm, "Cancel")))
        assert f"Give {t1} a fresh courier name?" in txt(confirm)
        page.keyboard.press("Escape")
        wait_for(page, lambda: is_focused(btn(drawer, f"Rename {t1}")))
        page.keyboard.press("Enter")
        wait_for(page, lambda: is_focused(btn(confirm, "Cancel")))
        page.keyboard.press("Tab")
        assert is_focused(btn(confirm, "Rename"))
        page.keyboard.press("Enter")
        wait_for(page, lambda: keep() or (focused_label(page).startswith("Rename ")
                                          and bool(COURIER_NAME.match(focused_label(page)[len("Rename "):]))))
        new_name = focused_label(page)[len("Rename "):]
        assert f"renamed {t1} to {new_name}" in txt(drawer.get_by_role("list", name="Audit", exact=True))
        tab_to(f"Mute {t3}")
        targets[2][0].post("/api/auth/sign-out", json={})
        targets.pop()
        advance(page, DRAWER_RELOAD_MS)
        label = focused_label(page)
        assert label.startswith(("Mute ", "Unmute ")) or label == "Close moderation"
        page.keyboard.press("Escape")
        wait_for(page, lambda: is_focused(opener))


def test_wf_moderation_helper_refused(browser, app_url, mail):
    h = helper(app_url, mail)
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, HELPER_EMAIL)
        page.goto(f"{app_url}/console")
        wait_for(page, lambda: "Only the founder can open the console." in page.content())
        assert present(btn(page, "Walk on Bramble"))
        assert not present(page.get_by_role("textbox", name="Email", exact=True))
        assert not present(page.get_by_role("form", name="Mission editor"))
    lantern = mission(founder(app_url, mail), "lantern-oil")
    err(h.post(f"/api/founder/missions/{lantern['mission_id']}/retire", json={}, headers=im(lantern)), 403,
        "founder_only")


def test_wf_stamp_ledger_history(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=7)
    with open_app(browser, app_url) as page:
        ready_page(page)
        g = on(app_url, page_cookie(page))
        door = doors(g)["ottoline"]
        for _ in range(21):
            deliver(g, m["mission_id"], door)
        assert buy(g, "riso-pink").status_code == 201
        balance = 21 * 7 - RISO_PINK_PRICE
        page.reload()
        ready_page(page)
        opener = btn(page, "Stamp history")
        click(opener)
        dialog = page.get_by_role("dialog", name="Stamp history", exact=True)
        rows = dialog.get_by_role("list", name="Movements", exact=True).get_by_role("listitem")
        wait_for(page, lambda: rows.count() == 20)
        assert f"{balance} stamps" in txt(dialog)
        texts = rows.all_text_contents()
        assert f"−{RISO_PINK_PRICE} stamps · Outfitter" in texts[0]
        assert all(f"+{m['reward_stamps']} stamps · Delivery" in t for t in texts[1:])
        click(btn(dialog, "Show older"))
        wait_for(page, lambda: rows.count() == 22 and not present(btn(dialog, "Show older")))
        page.keyboard.press("Escape")
        wait_for(page, lambda: is_focused(opener))
        assert ledger(g, limit=50).json()["balance"] == balance


def test_wf_stamp_ledger_outfitter(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=50)
    with open_app(browser, app_url) as page:
        ready_page(page)
        g = on(app_url, page_cookie(page))
        deliver(g, m["mission_id"], doors(g)["ottoline"])
        page.reload()
        ready_page(page)
        watch_notices(page)
        bal = balance_status(page)
        assert data(bal, "balance-shown") == "50" and data(bal, "stamp-presses") == "0"
        click(btn(page, "Outfitter"))
        dialog = page.get_by_role("dialog", name="Outfitter", exact=True)
        click(btn(dialog, f"Buy {RISO_NAME}"))
        wait_for(page, lambda: saw(page, f"{RISO_NAME} is yours."), step_ms=10)
        click(btn(dialog, f"Buy {SUNPATCH_NAME}"))
        wait_for(page, lambda: data(bal, "stamp-presses") == "2", step_ms=STEP_MS)
        advance(page, 1000)
        final = me(g)["balance"]
        assert final == 50 - RISO_PINK_PRICE - SUNPATCH_PRICE
        assert data(bal, "balance-shown") == str(final) and data(bal, "stamp-presses") == "2"
        click(btn(dialog, f"Wear {RISO_NAME}"))
        wait_for(page, lambda: saw(page, f"Now wearing {RISO_NAME}."))
        assert me(g)["satchel_colour"] == "riso-pink"
        page.keyboard.press("Escape")
        assert f"Wearing {RISO_NAME}" in txt(page.get_by_role("complementary", name="Satchel", exact=True))
        board = page.get_by_role("complementary", name="Depot board", exact=True)
        click(btn(board, f"Read {LANTERN_TITLE}"))
        letter = page.get_by_role("dialog", name=f"Letter from {OTTOLINE}", exact=True)
        wait_for(page, lambda: 0.2 <= (flt(letter, "fold-progress") or 0) <= 0.8, step_ms=25)
        page.keyboard.press("Escape")
        values = []
        wait_for(page, lambda: values.append(flt(letter, "fold-progress")) or not present(letter), step_ms=25)
        seen = [v for v in values if v is not None]
        assert seen == sorted(seen, reverse=True) and 1.0 not in seen


def test_wf_founder_missions_keyboard_draft(browser, app_url, mail):
    f = founder(app_url, mail)
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, FOUNDER_EMAIL)
        page.goto(f"{app_url}/console")
        watch_notices(page)
        new = btn(page, "New mission")
        wait_for(page, lambda: is_focused(new))
        page.keyboard.press("Enter")
        title = page.get_by_role("textbox", name="Title", exact=True)
        wait_for(page, lambda: is_focused(title) and page.url.endswith("/console?mission=new"))
        names = tab_order(page, 8)
        assert names[:2] == ["Resident", "Stamp reward"] and names[2] in ("Standard", "Rush")
        assert [n for n in names[3:] if n != "Rush slots"][:4] == ["Offer lines", "Thanks lines", "Go live at", "Save draft"]
        check(page.get_by_role("radio", name="Standard", exact=True))
        resident = page.get_by_role("combobox", name="Resident", exact=True)
        select(resident, resident.evaluate("(e, n) => e.options ? ([...e.options].map(o => (o.label || o.text).trim())"
                                           ".find(t => t.includes(n)) || n) : n", OTTOLINE))
        fill(page.get_by_role("spinbutton", name="Stamp reward", exact=True), "6")
        offers = ["One line.", "Two line.", "Three line."]
        fill(page.get_by_role("textbox", name="Offer lines", exact=True), "\n".join(offers))
        fill(page.get_by_role("textbox", name="Thanks lines", exact=True), "Thanks.")
        save = btn(page, "Save draft")
        save.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: is_focused(title))
        expect(title).to_have_accessible_description("Titles are 1 to 60 characters.")
        name = f"Errand {uuid.uuid4().hex[:12]}"
        fill(title, name)
        depth = page.evaluate("() => history.length")
        save.focus()
        page.keyboard.press("Enter")
        schedule = btn(page, "Schedule")
        wait_for(page, lambda: saw(page, "Draft saved.") and is_focused(schedule))
        assert page.evaluate("() => history.length") == depth
        mid = re.search(r"mission=([a-z0-9-]+)", page.url).group(1)
        saved = mission(f, mid)
        assert saved["title"] == name and saved["dialogue"]["offer"] == offers and saved["status"] == "draft"
        assert saved["reward_stamps"] == 6 and saved["resident_id"] == "ottoline"
        handle = schedule.element_handle()
        advance(page, CONSOLE_REFRESH_MS)
        assert handle.evaluate("el => el === document.activeElement")
        go = page.get_by_role("textbox", name="Go live at", exact=True)
        fill(go, "soon")
        schedule.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: is_focused(go))
        expect(go).to_have_accessible_description("Enter a time like 2027-01-15 09:30.")
        btn(page, "Publish now").focus()
        page.keyboard.press("Enter")
        retire = btn(page, "Retire")
        wait_for(page, lambda: saw(page, "Live now — version 1.") and is_focused(retire))
        page.keyboard.press("Enter")
        wait_for(page, lambda: saw(page, "Retired.") and is_focused(new))
        assert mission(f, mid)["status"] == "retired"


def test_wf_founder_missions_stale_and_back(browser, app_url, mail):
    f = founder(app_url, mail)
    m = live_mission(f, reward=5)
    url = f"{app_url}/console?mission={m['mission_id']}"
    try:
        with open_app(browser, app_url) as page:
            browser_sign_in(page, app_url, mail, FOUNDER_EMAIL)
            page.goto(url)
            watch_notices(page)
            title = page.get_by_role("textbox", name="Title", exact=True)
            wait_for(page, lambda: title.input_value() == m["title"] and is_focused(title))
            fill(page.get_by_role("spinbutton", name="Stamp reward", exact=True), "9")
            second = page.context.new_page()
            second.goto(url)
            reward2 = second.get_by_role("spinbutton", name="Stamp reward", exact=True)
            wait_for(second, lambda: present(reward2) and reward2.input_value() == "5")
            fill(reward2, "7")
            click(btn(second, "Save changes"))
            wait_for(second, lambda: mission(f, m["mission_id"])["reward_stamps"] == 7)
            click(btn(page, "Save changes"))
            wait_for(page, lambda: saw(page, "This mission changed in another tab. Reload it to see the latest."))
            assert mission(f, m["mission_id"])["reward_stamps"] == 7
            page.reload()
            reward = page.get_by_role("spinbutton", name="Stamp reward", exact=True)
            wait_for(page, lambda: present(reward) and reward.input_value() == "7" and page.url == url)
            fill(reward, "9")
            click(btn(page, "Save changes"))
            wait_for(page, lambda: mission(f, m["mission_id"])["reward_stamps"] == 9)
            click(btn(page, "New mission"))
            wait_for(page, lambda: page.url.endswith("/console?mission=new"))
            unsaved = "Unsaved errand"
            fill(title, unsaved)
            page.evaluate("() => history.back()")
            ask = page.get_by_role("dialog", name="Discard changes?", exact=True)
            wait_for(page, lambda: present(ask) and is_focused(btn(ask, "Keep editing")))
            assert "Your unsaved edits to this mission will be lost." in txt(ask)
            page.keyboard.press("Escape")
            wait_for(page, lambda: not present(ask) and page.url.endswith("/console?mission=new"))
            assert title.input_value() == unsaved
            page.goto(f"{app_url}/console?mission=no-such-mission-zz")
            watch_notices(page)
            unknown = "That mission isn't on the list."
            wait_for(page, lambda: (saw(page, unknown) or unknown in txt(notices(page))) and page.url == f"{app_url}/console")
            wait_for(page, lambda: is_focused(btn(page, "New mission")))
    finally:
        retire_quiet(f, m["mission_id"])


def test_wf_studio_console_zone(browser, app_url, mail):
    f = founder(app_url, mail)
    try:
        f.patch("/api/founder/studio", json={"time_zone": "America/Vancouver"})
        m = create_mission(f)
        when = (server_time(f) + timedelta(days=10)).replace(second=0, microsecond=0)
        f.post(f"/api/founder/missions/{m['mission_id']}/schedule", json={"live_at": fmt_iso(when)}, headers=im(m))

        def local(zone: str) -> list[str]:
            return [t.isoformat(" ", "minutes") for t in local_times(when, zone)]

        with open_app(browser, app_url) as page:
            browser_sign_in(page, app_url, mail, FOUNDER_EMAIL)
            page.goto(f"{app_url}/console")
            watch_notices(page)
            row = page.get_by_role("table", name="Missions").get_by_role("row").filter(has_text=m["title"])
            wait_for(page, lambda: any(v in txt(row) for v in local("America/Vancouver")))
            select(page.get_by_role("combobox", name="Studio time zone", exact=True), "Asia/Kathmandu")
            click(btn(page, "Save time zone"))
            wait_for(page, lambda: saw_re(page, r"Studio time zone saved\. Today's board is \d{4}-\d{2}-\d{2}\."))
            board = f.get("/api/founder/studio").json()
            assert board["time_zone"] == "Asia/Kathmandu"
            studio = page.get_by_role("region", name="Studio", exact=True)
            wait_for(page, lambda: f"Today's board: {board['board_date']}" in txt(studio))
            wait_for(page, lambda: any(v in txt(row) for v in local("Asia/Kathmandu")), limit_ms=CONSOLE_REFRESH_MS * 2)
    finally:
        f.patch("/api/founder/studio", json={"time_zone": "America/Vancouver"})


def test_wf_studio_console_online(browser, app_url, mail):
    f = founder(app_url, mail)
    with open_app(browser, app_url) as page:
        browser_sign_in(page, app_url, mail, FOUNDER_EMAIL)
        page.goto(f"{app_url}/console")
        region = page.get_by_role("region", name="Online now", exact=True)

        def matches() -> bool:
            got = re.search(r"(\d+) couriers on Bramble \((\d+) guests, (\d+) signed in\)", txt(region))
            if not got:
                return False
            n, gs, s = map(int, got.groups())
            api_counts = f.get("/api/founder/online").json()
            return n == gs + s and (n, gs, s) == (api_counts["online"], api_counts["guests"], api_counts["signed_in"])

        wait_for(page, matches, step_ms=CONSOLE_REFRESH_MS)


def test_wf_cross_cutting_layout(browser, app_url):
    with open_app(browser, app_url) as page:
        page.set_viewport_size({"width": LAPTOP[0], "height": LAPTOP[1]})
        ready_page(page)
        cards = {n: page.get_by_role("complementary", name=n, exact=True) for n in ("Postbox", "Depot board", "Satchel")}

        visible_rects = """els => els.map(e => {
          if (!e.getClientRects().length || getComputedStyle(e).visibility === 'hidden') return null;
          const r = e.getBoundingClientRect();
          let x0 = r.left, y0 = r.top, x1 = r.right, y1 = r.bottom;
          for (let p = e.parentElement; p; p = p.parentElement) {
            const s = getComputedStyle(p);
            if (s.overflowX !== 'visible' || s.overflowY !== 'visible') {
              const q = p.getBoundingClientRect();
              x0 = Math.max(x0, q.left); y0 = Math.max(y0, q.top); x1 = Math.min(x1, q.right); y1 = Math.min(y1, q.bottom);
            }
          }
          return x1 - x0 > 1 && y1 - y0 > 1 ? [x0, y0, x1, y1] : null; })"""

        def clear(w: int, h: int) -> None:
            zone = (w / 3, h / 3, 2 * w / 3, 2 * h / 3)
            locs = list(cards.values()) + [compass(page), page.get_by_role("toolbar", name="Emotes"),
                                           page.get_by_role("group", name="Move stick"), page.get_by_role("button")]
            for loc in locs:
                for b in loc.evaluate_all(visible_rects):
                    if b:
                        assert b[2] <= zone[0] or b[0] >= zone[2] or b[3] <= zone[1] or b[1] >= zone[3], b

        def corners(w: int, h: int, widths: tuple[int, int], ring: tuple[int, int]) -> None:
            p, d, s = (cards[n].bounding_box() for n in ("Postbox", "Depot board", "Satchel"))
            assert p["x"] < w / 3 and p["y"] < h / 3 and d["x"] + d["width"] > 2 * w / 3 and d["y"] < h / 3
            assert s["x"] < w / 3 and s["y"] + s["height"] > 2 * h / 3
            assert all(widths[0] <= b["width"] <= widths[1] for b in (p, d, s))
            r = compass(page).bounding_box()
            assert abs(r["x"] + r["width"] / 2 - w / 2) <= RING_CENTRE_PX and ring[0] <= r["width"] <= ring[1]

        layout(page)
        corners(*LAPTOP, CARD_W_1280, RING_W_1280)
        clear(*LAPTOP)
        enable_touch(page, TABLET)
        ready_page(page)
        layout(page)
        corners(*TABLET, CARD_W_768, RING_W_768)
        st = page.get_by_role("group", name="Move stick", exact=True).bounding_box()
        assert st["x"] < TABLET[0] / 3 and st["y"] > 2 * TABLET[1] / 3
        assert cards["Satchel"].bounding_box()["y"] + cards["Satchel"].bounding_box()["height"] <= st["y"]
        clear(*TABLET)
        page.set_viewport_size({"width": PHONE[0], "height": PHONE[1]})
        advance(page, 500)
        layout(page)
        tabs = [btn(page, n) for n in ("Postbox", "Depot board", "Satchel")]
        assert all(present(t) for t in tabs) and present(btn(page, "Emotes"))
        r = compass(page).bounding_box()
        assert RING_W_375[0] <= r["width"] <= RING_W_375[1]
        st = page.get_by_role("group", name="Move stick", exact=True).bounding_box()
        jb = btn(page, "Jump").bounding_box()
        assert st["x"] + st["width"] <= r["x"] and r["x"] + r["width"] <= jb["x"]
        clear(*PHONE)
        tap(tabs[1])
        advance(page, 500)
        assert tabs[1].get_attribute("aria-expanded") == "true"
        sheet = cards["Depot board"].bounding_box()
        assert sheet["y"] + sheet["height"] <= PHONE[1] / 2 + 1
        tap(tabs[0])
        advance(page, 500)
        assert tabs[0].get_attribute("aria-expanded") == "true" and tabs[1].get_attribute("aria-expanded") == "false"


def test_wf_cross_cutting_keyboard(browser, app_url):
    with open_app(browser, app_url) as page:
        ready_page(page)
        names = tab_order(page, 80)

        def idx(n: str) -> int:
            return names.index(n)

        first_read = next(i for i, n in enumerate(names) if n.startswith("Read "))
        assert idx("Claim this save") < idx("Save name") < first_read < idx("Outfitter") < idx("Bramble")
        assert idx("Stamp history") < idx("Bramble") < idx("Wave") < idx("Photo mode")
        outfitter = btn(page, "Outfitter")
        rest, focus = state_styles(outfitter, "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest != focus
        outfitter.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Outfitter", exact=True)
        wait_for(page, lambda: present(dialog))
        inside = set(dialog.get_by_role("button").all_text_contents()) | {
            b.get_attribute("aria-label") or "" for b in dialog.get_by_role("button").all()}
        for n in tab_order(page, 8):
            assert any(n and n in x for x in inside) or n.startswith(("Buy ", "Wear ")), n
        page.keyboard.press("Escape")
        wait_for(page, lambda: not present(dialog) and is_focused(outfitter))


def npm_tree() -> list[dict]:
    from conftest import DEPLOYED_APP
    root = DEPLOYED_APP if (Path(DEPLOYED_APP) / "node_modules").is_dir() else "/app"
    out = subprocess.run("npm ls --omit=dev --all --json --long", shell=True, cwd=root, capture_output=True, text=True)
    found: list[dict] = []

    def walk(deps: dict) -> None:
        for name, info in (deps or {}).items():
            if not info.get("version"):
                continue
            found.append({"name": name, "version": info.get("version"), "license": info.get("license")})
            walk(info.get("dependencies", {}))

    walk(json.loads(out.stdout or "{}").get("dependencies", {}))
    return found


def test_if_run_manifest():
    data_ = json.loads(Path("/app/run.json").read_text())
    assert set(data_) == {"_schema", "install", "build", "serve"} and data_["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in data_.values())


def test_if_third_party_notices():
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for name in ("Fraunces", "Atkinson Hyperlegible", "Lucide"):
        assert name in notes
    for pkg in npm_tree():
        assert pkg["name"] in notes, pkg
        if pkg["version"]:
            assert pkg["version"] in notes, pkg


def test_if_licences():
    for pkg in npm_tree():
        lic = pkg["license"]
        lic = lic.get("type") if isinstance(lic, dict) else lic
        assert lic, pkg
        ids = [t for t in re.findall(r"[A-Za-z0-9.\-+]+", lic) if t not in ("OR", "AND", "WITH")]
        ok = any(i in LICENCES for i in ids) if " OR " in lic else all(i in LICENCES for i in ids)
        assert ok, pkg


def test_if_datastores():
    manifest = json.loads(Path("/app/package.json").read_text())
    deps = {**manifest.get("dependencies", {}), **manifest.get("devDependencies", {})}
    for banned in ("sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "level", "pouchdb", "lokijs"):
        assert banned not in deps, banned
    for p in Path("/app").rglob("*"):
        if "node_modules" in p.parts or ".git" in p.parts:
            continue
        assert p.suffix not in (".sqlite", ".sqlite3", ".db"), p


def test_if_service_config_untouched():
    if os.environ.get("MAIL_FROM"):
        assert os.environ["MAIL_FROM"] == MAIL_FROM_VALUE
    for p in list(Path("/app").glob("*compose*.y*ml")) + list(Path("/app").glob("**/compose*.y*ml")):
        if "node_modules" in p.parts:
            continue
        body = p.read_text()
        if "MAIL_FROM" in body:
            assert MAIL_FROM_VALUE in body, p
        assert not re.search(r"\b(redis|sqlite|mongo)\b", body, re.I), p


def test_if_typescript_source():
    root = Path("/app")
    never = {"node_modules", ".git"}
    output_dirs = {(root / d).resolve() for d in ("dist", "build", "out", ".next", "coverage")}
    for cfg in root.rglob("tsconfig*.json"):
        if never & set(cfg.parts):
            continue
        raw = re.sub(r"/\*.*?\*/|(?<![:\"])//[^\n]*", "", cfg.read_text(errors="replace"), flags=re.S)
        found = re.search(r'"outDir"\s*:\s*"([^"]+)"', raw)
        if found:
            output_dirs.add((cfg.parent / found.group(1)).resolve())

    def built(p: Path) -> bool:
        rp = p.resolve()
        return any(rp == d or d in rp.parents for d in output_dirs)

    ts = [p for p in root.rglob("*") if p.suffix in (".ts", ".tsx", ".mts", ".cts") and p.is_file()
          and not p.name.endswith(".d.ts") and not never & set(p.parts) and not built(p)]
    assert ts, "no TypeScript application source under /app"
    tool_names = ("eslint", "prettier", "postcss", "build", "vite", "esbuild", "rollup", "webpack", "tsup",
                  "jest", "vitest", "playwright", "babel", "tailwind", "copy", "bundle")
    tool_dirs = {"scripts", "tools", "tooling", "config", "bin", ".husky"}
    references = ""
    for manifest in [root / "package.json", root / "run.json"]:
        if manifest.is_file():
            loaded = json.loads(manifest.read_text(errors="replace"))
            references += json.dumps(loaded.get("scripts", loaded))
    for cfg in root.rglob("*"):
        if cfg.is_file() and not never & set(cfg.parts) and (".config." in cfg.name or cfg.name.startswith("tsconfig")):
            references += cfg.read_text(errors="replace")
    for p in root.rglob("*"):
        if never & set(p.parts) or p.suffix not in (".js", ".jsx", ".mjs", ".cjs") or not p.is_file() or built(p):
            continue
        rel = p.relative_to(root)
        tooling = (p.name.startswith(".") or ".config." in p.name or "rc." in p.name
                   or p.name.lower().startswith(tool_names) or bool(tool_dirs & set(rel.parts[:-1]))
                   or p.name in references or rel.as_posix() in references)
        assert tooling, f"hand-written JavaScript outside build output and tooling: {p}"
