from __future__ import annotations

import concurrent.futures
import contextlib
import datetime as dt
import html
import http.server
import json
import math
import os
import re
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
import struct
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

import conftest
from conftest import (
    addresses,
    advance,
    check,
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
    text,
    unique,
)

try:
    from conftest import S3
except ImportError:
    from minio_client import S3

DEPLOYED_APP = getattr(conftest, "DEPLOYED_APP", "/app")

APP_PORT = 4173
PASSWORD = "rushes-demo-2026"
JSON_LIMIT = 65_536
IMAGE_LIMIT = 15_000_000
CLIP_LIMIT = 60_000_000
STILL_LIMIT = 8_000_000
FEED_DEFAULT = 20
FEED_MAX = 50
REFERENCES_MAX = 100
SEARCH_LIST_MAX = 20
Q_MAX = 100
KEY_MAX = 64
EXPIRY_MAX_DAYS = 30
COMMENT_LIMIT = 5
COMMENT_WINDOW_S = 60
REFRESH_MS = 30_000
DIGEST_S = 30
DOCK_MIN_MS = 350
DOCK_MAX_MS = 500
FLIGHT_MIN_MS = 350
FLIGHT_MAX_MS = 500
PANEL_MIN_MS = 120
UPLOAD_PRESSES = 3
CHOOSER_S = 2
PANEL_MAX_MS = 250
RM_STRIP_FADE_MAX_MS = 200
MOTION_STEP_MS = 25
SETTLE_PX = 0.01
MOTION_TAIL_MS = 200
DEBOUNCE_MS = 250
MIN_STRIP_TILES = 8
CAPSTAN = "Capstan reel"
CAPSTAN_FPS = 25
CAPSTAN_FRAMES = 50
CAPSTAN_MS = 2000
MS_PER_S = 1000
SECONDS_PER_MINUTE = 60
SECONDS_PER_HOUR = 3600

PLANS = {
    "rushes-pro-5": ("Pro 5 seats", 5, "150.00"),
    "rushes-pro-10": ("Pro 10 seats", 10, "280.00"),
    "rushes-pro-25": ("Pro 25 seats", 25, "650.00"),
}
PLAN_ORDER = ["rushes-pro-5", "rushes-pro-10", "rushes-pro-25"]
WS = {
    "northvale": ("Northvale", "Europe/London"),
    "kesto": ("Kesto", "America/New_York"),
    "brisk-tonic": ("Brisk Tonic", "Australia/Sydney"),
    "vartan": ("Vartan Studio", "Europe/Berlin"),
}
MARA, DEV = "mara@halden.example", "dev@halden.example"
JUNO, TOMAS, INES = "juno@northvale.example", "tomas@northvale.example", "ines@northvale.example"
OLA = "ola@northvale.example"
SAM, BEA, ILSE = "sam@kesto.example", "bea@brisktonic.example", "ilse@vartan.example"
LEE = "lee@followers.example"

HTTP_TIMEOUT_S = 120
WAIT_S = 90
PAGES_MAX = 1000
POLL_S = 0.25
STEP_MS = 100
CHECK_MS = 250
NO_MAIL_S = 6
DIGEST_SETTLE_S = 12
LIFT_LEAD_S = 15
UI_LIFT_LEAD_S = 30
CLOCK_SKEW_MS = 1500
BOOT_S = 180
TAB_PRESSES = 45
FOCUS_PRESSES = 200
SEAT_STEPS = 80
DEVICE_SKEW_H = 3
FILL_DOMAIN = "seatfill.example"
EVIL_ORIGIN = "http://evil.example"
def _last_sunday(year: int, month: int) -> dt.date:
    last = (dt.date(year + month // 12, month % 12 + 1, 1) - dt.timedelta(days=1))
    return last - dt.timedelta(days=(last.weekday() - 6) % 7)


def _first_sunday(year: int, month: int) -> dt.date:
    first = dt.date(year, month, 1)
    return first + dt.timedelta(days=(6 - first.weekday()) % 7)


def _utc_of(day: dt.date, hm: str, offset_h: int) -> str:
    h, m = map(int, hm.split(":"))
    return (dt.datetime(day.year, day.month, day.day, h, m) - dt.timedelta(hours=offset_h)).strftime("%Y-%m-%dT%H:%M:00.000Z")


DST_YEAR = dt.datetime.now(dt.timezone.utc).year + 2
LONDON_SPRING, LONDON_FALL, SYDNEY_END = _last_sunday(DST_YEAR, 3), _last_sunday(DST_YEAR, 10), _first_sunday(DST_YEAR, 4)
BEFORE_SPRING, AFTER_SPRING = LONDON_SPRING - dt.timedelta(days=2), LONDON_SPRING + dt.timedelta(days=1)
FUTURE_LIFT = f"{BEFORE_SPRING.isoformat()}T09:00"
FUTURE_LIFT_UTC = _utc_of(BEFORE_SPRING, "09:00", 0)
NV, KS, BT, VT = "northvale", "kesto", "brisk-tonic", "vartan"
NOBODY = "nobody"
SEED_TOKEN = "rv-seed-harbour-0001"
DOUBLE_SLASH = "/" * 2
SET_COOKIE = "set-cookie"
SEAT_TAGS = ("Seats free", "Full", "Over cap")
STILLS_GLOB = f"**/api/workspaces/{NV}/clips/*/stills"
NEVER_SERVED = ["/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/run.json", "/src/server.ts", "/assets/%2e%2e/package.json", "/%2e%2e/%2e%2e/etc/passwd", "/..%2fpackage.json"]


def wsp(ws: str, tail: str = "") -> str:
    return f"/api/workspaces/{ws}{tail}"


def curator_path(handle: str, tail: str = "") -> str:
    return f"/api/curators/{handle}{tail}"


def n_items(n: int) -> str:
    return f"{n} items"


def n_followers(n: int) -> str:
    return f"{n} followers"


def follower_count(page: Page, n: int) -> Locator:
    return page.get_by_text(re.compile(rf"(?<!\d){n}\s*followers(?!\.)"))


def count_shown(page: Page, n: int) -> bool:
    status = page.get_by_role("status", name="Profile status").element_handle(timeout=CHECK_MS)
    return any(follower_count(page, n).evaluate_all(
        "(els, status) => els.map(e => !(status && status.contains(e)) && e.getClientRects().length > 0)", status
    ))


def tag() -> str:
    return "t" + uuid.uuid4().hex[:10]


def person(prefix: str) -> tuple[str, str, str]:
    a, b = unique(prefix)
    email = b if "@" in b else a
    name = a if email == b else b
    return (name[:40] or prefix), email.lower(), tag()


def iso(t: dt.datetime) -> str:
    t = t.astimezone(dt.timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // MS_PER_S:03d}Z"


def now() -> dt.datetime:
    return dt.datetime.now(dt.timezone.utc)


def timecode(frame: int, fps: int) -> str:
    seconds, ff = divmod(frame, fps)
    h, rest = divmod(seconds, SECONDS_PER_HOUR)
    m, s = divmod(rest, SECONDS_PER_MINUTE)
    return f"{h:02d}:{m:02d}:{s:02d}:{ff:02d}"


def wait_for(fn: Callable[[], Any], seconds: float = WAIT_S, what: str = "condition") -> Any:
    deadline = time.monotonic() + seconds
    value = fn()
    while not value:
        assert time.monotonic() < deadline, f"timed out waiting for {what}"
        threading.Event().wait(POLL_S)
        value = fn()
    return value


def wait_clock(until: dt.datetime) -> None:
    wait_for(lambda: now() >= until, (until - now()).total_seconds() + WAIT_S, "wall clock")


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)

    def req(self, method: str, path: str, **kw: Any) -> httpx.Response:
        return self.http.request(method, path, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.req("GET", path, **kw)

    def post(self, path: str, **kw: Any) -> httpx.Response:
        return self.req("POST", path, **kw)

    def patch(self, path: str, **kw: Any) -> httpx.Response:
        return self.req("PATCH", path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.req("DELETE", path, **kw)

    def ok(self, method: str, path: str, status: int, **kw: Any) -> Any:
        r = self.req(method, path, **kw)
        assert r.status_code == status, f"{method} {path}: {r.status_code} {r.text[:400]}"
        return r.json() if r.content else None

    def cookie(self) -> str:
        return self.http.cookies.get("rushes_session")


def signin(base: str, email: str) -> Api:
    api = Api(base)
    api.ok("POST", "/api/auth/signin", 200, json={"email": email, "password": PASSWORD})
    return api


def urls(app_url: str) -> dict[str, str]:
    return {
        "primary": app_url.rstrip("/"),
        "minio-down": os.environ["APP_MINIO_DOWN_URL"].rstrip("/"),
        "mailpit-down": os.environ["APP_MAILPIT_DOWN_URL"].rstrip("/"),
        "killbill-down": os.environ["APP_KILLBILL_DOWN_URL"].rstrip("/"),
    }


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text[:400]}"
    body = r.json()
    assert body["error"] == code, body
    assert isinstance(body.get("message"), str) and body["message"], body
    return body


def field_err(r: httpx.Response, field: str, message: str) -> None:
    body = err(r, 422, "validation")
    assert body["message"] == "Check the highlighted fields."
    assert body["errors"].get(field) == message, body


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return fn()

    with concurrent.futures.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def new_follower(base: str) -> tuple[Api, dict]:
    name, email, handle = person("follower")
    api = Api(base)
    acc = api.ok("POST", "/api/auth/signup", 201, json={"email": email, "displayName": name, "handle": handle, "password": PASSWORD})
    return api, acc


PNG_SIG = b"\x89PNG\r\n\x1a\n"


def png_chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_core(seed: int = 1) -> tuple[bytes, bytes, bytes]:
    ihdr = png_chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0))
    raw = b"".join(b"\x00" + bytes([seed % 256, 9, 3] * 2) for _ in range(2))
    return ihdr, png_chunk(b"IDAT", zlib.compress(raw)), png_chunk(b"IEND", b"")


def png_bytes(seed: int = 1) -> bytes:
    return PNG_SIG + b"".join(png_core(seed))


def png_of_size(size: int) -> bytes:
    ihdr, idat, iend = png_core()
    pad = size - len(PNG_SIG) - len(ihdr) - len(idat) - len(iend) - 12
    return PNG_SIG + ihdr + idat + png_chunk(b"prVt", b"\x00" * pad) + iend


def png_with_metadata() -> tuple[bytes, bytes]:
    ihdr, idat, iend = png_core(5)
    meta1 = png_chunk(b"tEXt", b"Author\x00camera owner") + png_chunk(b"tIME", bytes([7, 0, 1, 1, 0, 0, 0]))
    meta2 = png_chunk(b"eXIf", b"MM\x00*GPS 50N 1W")
    meta3 = png_chunk(b"iTXt", b"Owner\x00\x00\x00\x00\x00camera owner") + png_chunk(b"zTXt", b"Loc\x00\x00" + zlib.compress(b"GPS"))
    return PNG_SIG + ihdr + meta1 + meta2 + idat + meta3 + iend, PNG_SIG + ihdr + idat + iend


def jseg(marker: int, payload: bytes) -> bytes:
    return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload


def jpeg_with_metadata() -> tuple[bytes, bytes]:
    soi, eoi = b"\xff\xd8", b"\xff\xd9"
    app0 = jseg(0xE0, b"JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00")
    exif = jseg(0xE1, b"Exif\x00\x00MM\x00*GPS 50.1N 1.2W camera owner")
    xmp = jseg(0xE1, b"http://ns.adobe.com/xap/1.0/\x00<x:xmpmeta/>")
    iptc = jseg(0xED, b"Photoshop 3.0\x008BIM camera owner")
    com = jseg(0xFE, b"camera owner")
    dqt = jseg(0xDB, b"\x00" + bytes(range(1, 65)))
    sof = jseg(0xC0, b"\x08\x00\x02\x00\x02\x01\x01\x11\x00")
    dht = jseg(0xC4, b"\x00" + bytes([0, 1] + [0] * 14) + b"\x00")
    scan = jseg(0xDA, b"\x01\x01\x00\x00\x3f\x00") + b"\x12\x34\xff\x00\x56" + eoi
    full = soi + app0 + exif + xmp + dqt + iptc + sof + com + dht + scan
    return full, soi + app0 + dqt + sof + dht + scan


def riff_chunk(fourcc: bytes, data: bytes) -> bytes:
    return fourcc + struct.pack("<I", len(data)) + data + (b"\x00" if len(data) % 2 else b"")


def webp(chunks: list[bytes]) -> bytes:
    body = b"WEBP" + b"".join(chunks)
    return b"RIFF" + struct.pack("<I", len(body)) + body


def webp_with_metadata() -> tuple[bytes, bytes]:
    vp8l = riff_chunk(b"VP8L", bytes.fromhex("2f00000010071011118888fe07"))
    vp8x = lambda flags: riff_chunk(b"VP8X", bytes([flags, 0, 0, 0, 0, 0, 0, 0, 0, 0]))
    exif = riff_chunk(b"EXIF", b"MM\x00*GPS owner!")
    xmpc = riff_chunk(b"XMP ", b"<x:xmpmeta/>")
    return webp([vp8x(0x0C), vp8l, exif, xmpc]), webp([vp8x(0x00), vp8l])


MP4 = b"\x00\x00\x00\x18ftypisom\x00\x00\x02\x00isomiso2" + b"\x00\x00\x00\x08free"
WEBM = b"\x1a\x45\xdf\xa3\x9f\x42\x86\x81\x01" + b"\x00" * 16
GIF = b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"/>'
HTML = b"<!doctype html><title>x</title>"
JUNK = b"not a picture at all"


def upload(api: Api, ws: str, data: bytes, filename: str, ctype: str, **fields: Any) -> httpx.Response:
    return api.post(f"/api/workspaces/{ws}/references", files={"file": (filename, data, ctype)}, data={k: str(v) for k, v in fields.items()})


def new_image(api: Api, ws: str, title: str, data: bytes | None = None) -> dict:
    r = upload(api, ws, data or png_bytes(), "plate.png", "image/png", title=title)
    assert r.status_code == 201, r.text
    return r.json()


def new_clip(api: Api, ws: str, title: str, fps: int = CAPSTAN_FPS, duration: int = 2000) -> dict:
    r = upload(api, ws, WEBM, "clip.webm", "video/webm", title=title, frameRate=fps, durationMs=duration)
    assert r.status_code == 201, r.text
    return r.json()


def new_cluster(api: Api, ws: str, title: str | None = None, desc: str = "", note: str = "") -> dict:
    return api.ok("POST", f"/api/workspaces/{ws}/clusters", 201, json={"title": title or f"{tag()} cluster", "publicDescription": desc, "internalNote": note})


def add(api: Api, cid: str, rid: str, private: bool = False) -> dict:
    return api.ok("POST", f"/api/clusters/{cid}/entries", 201, json={"referenceId": rid, "isPrivate": private})


def status(api: Api, cid: str, to: str, lift: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"status": to}
    if lift is not None:
        body["liftLocal"] = lift
    return api.post(f"/api/clusters/{cid}/status", json=body)


def cluster(api: Api, cid: str) -> dict:
    return api.ok("GET", f"/api/clusters/{cid}", 200)


def entry_titles(c: dict) -> list[str]:
    return [e["reference"]["title"] for e in sorted(c["entries"], key=lambda e: e["position"])]


def ordered_cluster(api: Api, ws: str, titles: list[str], title: str | None = None) -> tuple[dict, list[dict]]:
    c = new_cluster(api, ws, title or f"{tag()} order")
    refs = [new_image(api, ws, t) for t in titles]
    for r in refs:
        add(api, c["id"], r["id"])
    return cluster(api, c["id"]), refs


def all_refs(api: Api, ws: str) -> list[dict]:
    items, cursor = [], None
    for _ in range(PAGES_MAX):
        params = {"limit": REFERENCES_MAX} | ({"cursor": cursor} if cursor else {})
        page = api.ok("GET", f"/api/workspaces/{ws}/references", 200, params=params)
        items += page["items"]
        cursor = page["nextCursor"]
        if not cursor:
            return items
    raise AssertionError("the references never reached their last page")


def capstan(api: Api) -> dict:
    return next(r for r in all_refs(api, "northvale") if r["title"] == CAPSTAN and r["kind"] == "clip")


def pluck(api: Api, ws: str, clip_id: str, cid: str, frame: int, data: bytes | None = None) -> httpx.Response:
    return api.post(f"/api/workspaces/{ws}/clips/{clip_id}/stills", files={"still": ("frame.png", data or png_bytes(frame), "image/png")}, data={"frameIndex": str(frame), "clusterId": cid})


def next_lift(tz: str, lead_s: int = LIFT_LEAD_S) -> tuple[str, dt.datetime]:
    t = (now() + dt.timedelta(seconds=lead_s)).replace(second=0, microsecond=0) + dt.timedelta(minutes=1)
    return t.astimezone(ZoneInfo(tz)).strftime("%Y-%m-%dT%H:%M"), t


def lift_soon(api: Api, cid: str, tz: str) -> dt.datetime:
    if cluster(api, cid)["status"] == "draft":
        assert status(api, cid, "in_review").status_code == 200
    local, at = next_lift(tz)
    r = status(api, cid, "embargoed", local)
    assert r.status_code == 200, r.text
    assert r.json()["liftsAt"] == iso(at)
    return at


def wait_public(api: Api, cid: str, at: dt.datetime) -> dict:
    wait_clock(at)
    return wait_for(lambda: (c := cluster(api, cid))["status"] == "public" and c, WAIT_S, "lift")


def feed_all(api: Api, limit: int = FEED_MAX) -> list[dict]:
    items, cursor = [], None
    for _ in range(PAGES_MAX):
        params = {"limit": limit} | ({"cursor": cursor} if cursor else {})
        page = api.ok("GET", "/api/feed", 200, params=params)
        items += page["items"]
        cursor = page["nextCursor"]
        if not cursor:
            return items
    raise AssertionError("the feed never reached its last page")


def feed_id(title: str, base: str) -> str:
    return next(f["id"] for f in feed_all(Api(base)) if f["title"] == title)


def inbox(mail: Any, to: str, subject: str | None = None, at_least: int = 1, seconds: float = WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds

    def matching() -> list[dict]:
        return [m for m in mail.messages(0, settle=POLL_S)
                if to.lower() in [a.lower() for a in addresses(m.get("To"))]
                and (subject is None or m.get("Subject") == subject)]

    found = matching()
    while len(found) < at_least and time.monotonic() <= deadline:
        found = matching()
    return found


def email_body(message: dict) -> str:
    markup = message.get("HTML", "")
    links = re.findall(r"""href\s*=\s*["']([^"']+)""", markup)
    shown = [" ".join(re.sub(r"<[^>]*>", gap, markup).split()) for gap in ("", " ")]
    return html.unescape("\n".join([message.get("Text", ""), *shown, *links]))


TRAILING_PUNCTUATION = ".,;:!?)]"


def readings(found: str) -> list[str]:
    out = [found]
    while out[-1] and out[-1][-1] in TRAILING_PUNCTUATION:
        out.append(out[-1][:-1])
    return out


def link_in(body: str, path: str, base: str) -> str:
    found = re.search(rf"https?://\S+{path}[^\s\"'<>]+", body).group(0)
    probe = Api(base)
    for url in readings(found):
        if probe.get(f"/api/review/{review_token(url)}").status_code == 200:
            return url
    return found


def dollars_shown(body: str, price: str) -> bool:
    amount = r"(\d[\d,]*(?:\.\d+)?)"
    found = re.findall(rf"\$\s*{amount}|USD\s*{amount}|{amount}\s*(?:USD|dollars?)\b", body, re.I)
    return any(abs(float(x.replace(",", "")) - float(price)) < 0.005 for groups in found for x in groups if x)


def invite_token(message: dict, base: str) -> str:
    found = re.search(r"/invite/([A-Za-z0-9_\-.~%]+)", email_body(message)).group(1)
    probe = Api(base)
    for token in readings(found):
        if probe.get(f"/api/invites/{token}").status_code == 200:
            return token
    return found


def review_token(url: str) -> str:
    return url.rsplit("/review/", 1)[1]


def kb_plan(killbill: Any, slug: str) -> str:
    account = killbill.account_by_key(f"rushes-ws-{slug}")
    assert account, f"no Kill Bill account rushes-ws-{slug}"
    active = [s for s in killbill.subscriptions(account["accountId"]) if s.get("state") == "ACTIVE"]
    assert len(active) == 1, active
    return active[0]["planName"]


def kb_change_plan(killbill: Any, workspace_slug: str, plan: str) -> None:
    account = killbill.account_by_key(f"rushes-ws-{workspace_slug}")
    assert account, f"no Kill Bill account rushes-ws-{workspace_slug}"
    active = [s for s in killbill.subscriptions(account["accountId"]) if s.get("state") == "ACTIVE"]
    assert len(active) == 1, active
    required = ("KILLBILL_URL", "KILLBILL_USERNAME", "KILLBILL_PASSWORD", "KILLBILL_API_KEY", "KILLBILL_API_SECRET")
    missing = [key for key in required if not os.environ.get(key)]
    assert not missing, f"Missing Kill Bill verifier environment: {', '.join(missing)}"
    response = httpx.put(
        f"{os.environ['KILLBILL_URL'].rstrip('/')}/1.0/kb/subscriptions/{active[0]['subscriptionId']}",
        auth=(os.environ["KILLBILL_USERNAME"], os.environ["KILLBILL_PASSWORD"]),
        json={"planName": plan}, params={"policy": "IMMEDIATE"},
        headers={"X-Killbill-ApiKey": os.environ["KILLBILL_API_KEY"],
                 "X-Killbill-ApiSecret": os.environ["KILLBILL_API_SECRET"],
                 "X-Killbill-CreatedBy": "curio-verifier", "Content-Type": "application/json"},
        timeout=HTTP_TIMEOUT_S,
    )
    response.raise_for_status()
    assert kb_plan(killbill, workspace_slug) == plan, response.text


def seats(mara: Api, ws: str) -> dict:
    return mara.ok("GET", f"/api/workspaces/{ws}/seats", 200)


def invite_designer(mara: Api, ws: str, mail: Any, domain: str = FILL_DOMAIN) -> dict:
    handle = tag()
    email, name = f"{handle}@{domain}", f"Designer {handle}"
    mara.ok("POST", f"/api/workspaces/{ws}/invites", 201, json={"email": email, "displayName": name})
    token = invite_token(inbox(mail, email)[0], mara.base)
    guest = Api(mara.base)
    guest.ok("POST", f"/api/invites/{token}/accept", 201, json={"handle": handle, "password": PASSWORD})
    member = next(m for m in seats(mara, ws)["members"] if m["email"] == email)
    return {"id": member["id"], "email": email, "name": name, "handle": handle, "api": guest}


def set_free_seats(mara: Api, ws: str, mail: Any, free: int) -> list[str]:
    assigned: list[str] = []
    for _ in range(SEAT_STEPS):
        st = seats(mara, ws)
        room = st["seatCap"] - st["seatsUsed"]
        if room == free:
            return assigned
        fillers = [m for m in st["members"] if m["email"].endswith("@" + FILL_DOMAIN)]
        if room < free:
            seated = next((m for m in fillers if m["hasSeat"]), None)
            assert seated, f"{ws} has no suite-owned seat to free"
            mara.ok("DELETE", f"/api/workspaces/{ws}/seats/{seated['id']}", 200)
        else:
            spare = next((m for m in fillers if not m["hasSeat"]), None) or invite_designer(mara, ws, mail)
            r = mara.post(f"/api/workspaces/{ws}/seats", json={"memberId": spare["id"]})
            assert r.status_code in (200, 201), r.text
            assigned.append(spare["id"])
    pytest.fail(f"could not prepare {free} free seats in {ws}")


def free_all(mara: Api, ws: str, ids: list[str]) -> None:
    for member in ids:
        mara.delete(f"/api/workspaces/{ws}/seats/{member}")


def pick_upgradable(mara: Api) -> tuple[str, dict]:
    for ws in ("kesto", "northvale", "brisk-tonic"):
        plan = mara.ok("GET", f"/api/workspaces/{ws}/plan", 200)
        if plan["upgrades"]:
            return ws, plan
    pytest.fail("no Halden workspace has an upgrade left")


@contextlib.contextmanager
def screen(browser: Browser, base: str, path: str, email: str | None = None, width: int = 1280, height: int = 800, reduced: bool = False) -> Iterator[Page]:
    with open_app(browser, base.rstrip("/") + "/api/health", reduced_motion="reduce" if reduced else "no-preference") as page:
        page.set_viewport_size({"width": width, "height": height})
        if email:
            api = signin(base, email)
            page.context.add_cookies([{"name": "rushes_session", "value": api.cookie(), "url": base}])
        page.goto(base.rstrip("/") + path)
        yield page


def eventually(page: Page, probe: Callable[[], Any], seconds: float = WAIT_S, *, step_ms: int = STEP_MS) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() <= deadline:
        try:
            probe()
            return
        except (AssertionError, PlaywrightError):
            advance(page, step_ms)
    try:
        probe()
    except (AssertionError, PlaywrightError) as problem:
        raise AssertionError(f"screen never reached the state: {problem}")


def shown_texts(locator: Locator) -> list[str]:
    return locator.evaluate(
        "e => { const squash = s => (s || '').replace(/\\s+/g, ' ').trim(); const c = e.cloneNode(true);"
        " c.querySelectorAll('[aria-hidden=\"true\"], svg, [role=\"img\"]').forEach(n => n.remove());"
        " return [squash(e.textContent), squash(c.textContent), squash(e.innerText)]; }",
        timeout=CHECK_MS,
    )


WARNING_ICON_WORDS = {"warning", "warning_amber", "error", "error_outline", "report", "report_problem", "priority_high", "dangerous"}


def copy_matches(text: str, want: Any) -> bool:
    candidates = [text]
    symbols = re.match(r"[\W_]+", text)
    if symbols and symbols.end() < len(text):
        candidates.append(text[symbols.end():].lstrip())
    word = next((w for w in sorted(WARNING_ICON_WORDS, key=len, reverse=True) if text.lower().startswith(w)), None)
    if word:
        candidates.append(text[len(word):].lstrip())
    return any(bool(want.search(c)) if isinstance(want, re.Pattern) else c == want for c in candidates)


def slot_shown(item: Locator, n: int) -> bool:
    return item.evaluate(
        """(e, n) => {
            if (new RegExp('(^|\\\\D)' + n + '(\\\\D|$)').test(e.innerText || e.textContent || '')) return true;
            const drawn = [getComputedStyle(e, '::before').content, getComputedStyle(e, '::marker').content].join(' ');
            if (/counter\\(/.test(drawn) || new RegExp('(^|\\\\D)' + n + '(\\\\D|$)').test(drawn)) return true;
            const list = e.closest('ol');
            if (!list || getComputedStyle(e).display !== 'list-item' || getComputedStyle(e).listStyleType === 'none') return false;
            return (list.start || 1) + [...list.children].filter(c => c.tagName === 'LI').indexOf(e) === n;
        }""",
        n,
        timeout=CHECK_MS,
    )


def reads_as(locator: Locator, copy: str) -> bool:
    squeeze = lambda t: re.sub(r"\s+", "", t)
    name = locator.evaluate("e => e.getAttribute('aria-label') || ''", timeout=CHECK_MS)
    return any(squeeze(copy) in squeeze(t) for t in [name, *shown_texts(locator)])


def seat_meter_reads_as(meter: Locator, copy: str) -> bool:
    texts = meter.evaluate("""e => [e.textContent, e.innerText, e.getAttribute('aria-valuetext'),
        ...(/^(METER|PROGRESS)$/.test(e.tagName) && e.parentElement
            ? [e.parentElement.textContent, e.parentElement.innerText] : [])]""", timeout=CHECK_MS)
    return any(re.sub(r"\s+", "", copy) in re.sub(r"\s+", "", t or "") for t in texts)


def shows(page: Page, locator: Locator, value: Any, seconds: float = WAIT_S) -> None:
    want = value if isinstance(value, re.Pattern) else " ".join(str(value).split())

    def probe() -> None:
        texts = shown_texts(locator)
        assert any(copy_matches(t, want) for t in texts), f"{texts!r} does not show {value!r}"

    eventually(page, probe, seconds)


def appears(page: Page, locator: Locator, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=CHECK_MS), seconds)


def focus_order(page: Page, targets: list[Locator], presses: int = FOCUS_PRESSES) -> list[int]:
    seen: dict[int, int] = {}
    for press in range(presses):
        page.keyboard.press("Tab")
        for i, target in enumerate(targets):
            if i not in seen and target.evaluate("e => e === document.activeElement"):
                seen[i] = press
        if len(seen) == len(targets):
            break
    assert len(seen) == len(targets), f"never focused in {presses} Tab presses: {[i for i in range(len(targets)) if i not in seen]}"
    return [seen[i] for i in range(len(targets))]


def tag_shown(page: Page, near: Locator, word: str) -> bool:
    alone = page.get_by_text(re.compile(f"{re.escape(word)}(?![A-Za-z0-9])"))
    return word in near.inner_text() or any(alone.nth(i).is_visible() for i in range(alone.count()))


def current_plan(page: Page, plan_name: str | None = None) -> Locator:
    name = re.escape(plan_name).replace(r"\ ", r"\s+") if plan_name else r"Pro\s+(?:5|10|25)\s+seats"
    return page.get_by_text(re.compile(r"Current\s+plan:(?:(?!Pro\s+\d+\s+seats)[\s\S])*?" + name))


def plan_shown(page: Page, plan_name: str | None = None) -> bool:
    return any(candidate.is_visible() for candidate in current_plan(page, plan_name).all())


def focused(page: Page, locator: Locator) -> None:
    eventually(page, lambda: expect(locator).to_be_focused(timeout=CHECK_MS))


def live(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name)


def names(locator: Locator, role: str) -> list[str]:
    out = []
    for line in locator.aria_snapshot().splitlines():
        m = re.match(rf'\s*- {role} "((?:[^"\\]|\\.)*)"', line)
        if m:
            out.append(json.loads('"' + m.group(1) + '"'))
    return out


def tray_order(page: Page) -> list[str]:
    tray = page.get_by_role("list", name="Cluster order")
    return [n[len("Reorder "):] for n in names(tray, "button") if n.startswith("Reorder ")]


def row_people(page: Page) -> list[tuple[str, bool]]:
    out = []
    for n in names(page.get_by_role("table", name="Members"), "button"):
        if n.startswith("Assign seat to "):
            out.append((n[len("Assign seat to "):], False))
        elif n.startswith("Free seat from "):
            out.append((n[len("Free seat from "):], True))
    return out


def chosen(box: Locator) -> str:
    return box.evaluate(
        "e => (e.tagName === 'SELECT' ? [...e.selectedOptions].map(o => o.label || o.text).join(' ') : e.tagName === 'INPUT' || e.tagName === 'TEXTAREA' ? e.value : e.textContent || '').trim()"
    )


def _pick_tray(box: Locator, title: str) -> None:
    expect(box).to_be_visible()
    expect(box).to_be_enabled()
    box.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
    bounds = box.bounding_box()
    assert bounds is not None, "tray switcher has no box"
    point = {"x": bounds["x"] + bounds["width"] / 2, "y": bounds["y"] + bounds["height"] / 2}
    assert box.evaluate("(e, p) => { const hit = document.elementFromPoint(p.x, p.y); return hit === e || e.contains(hit); }", point), "tray switcher is obscured"
    box.focus()
    if box.evaluate("e => e.tagName === 'SELECT'"):
        labels = box.evaluate("e => [...e.options].map(o => (o.label || o.text || '').trim())")
        matches = [label for label in labels if label == title] or [label for label in labels if title in label]
        assert len(matches) == 1, f"ambiguous or missing tray option {title!r}: {labels!r}"
        box.evaluate("""(e, label) => {
            const option = [...e.options].find(o => (o.label || o.text || '').trim() === label);
            e.value = option.value;
            e.dispatchEvent(new Event('input', {bubbles: true}));
            e.dispatchEvent(new Event('change', {bubbles: true}));
        }""", matches[0])
        assert chosen(box) == matches[0], "tray option was not selected"
    else:
        box.click()
        options = box.page.get_by_role("option", name=re.compile(re.escape(title)))
        def option_ready() -> None:
            nonlocal options
            exact = box.page.get_by_role("option", name=title, exact=True)
            options = exact if exact.count() else box.page.get_by_role("option", name=re.compile(re.escape(title)))
            expect(options).to_have_count(1, timeout=CHECK_MS)
        eventually(box.page, option_ready)
        options.click()
        eventually(box.page, lambda: _equal(title in chosen(box), True))


def choose_tray(page: Page, title: str) -> None:
    bar = page.get_by_role("button", name=re.compile(r"^Cluster tray: "))
    collapsed = bar.count() > 0
    if collapsed and bar.get_attribute("aria-expanded") != "true":
        bar.click()
        advance(page, PANEL_MAX_MS)
    _pick_tray(page.get_by_role("combobox", name="Tray cluster"), title)
    if collapsed and bar.get_attribute("aria-expanded") == "true":
        bar.click()
        advance(page, PANEL_MAX_MS)


def slider_value(slider: Locator) -> int:
    return int(slider.evaluate("el => Number(el.getAttribute('aria-valuenow') ?? el.value)"))


def value_text(slider: Locator) -> str:
    return slider.evaluate("el => el.getAttribute('aria-valuetext')")


def _shows_frame(page: Page, slider: Locator, frame: int) -> None:
    eventually(page, lambda: _equal(slider_value(slider), frame))
    eventually(page, lambda: _equal(value_text(slider), timecode(frame, CAPSTAN_FPS)))
    shows(page, page.get_by_role("timer", name="Timecode"), timecode(frame, CAPSTAN_FPS))


def open_capstan(page: Page) -> Locator:
    page.get_by_role("button", name=f"Open clip {CAPSTAN}", exact=True).click()
    slider = page.get_by_role("slider", name="Playhead")
    focused(page, slider)
    return slider


def strip_band(page: Page) -> dict:
    region = page.get_by_role("region", name="Sprocket strip").element_handle()
    preview = page.get_by_role("img", name="Frame preview").element_handle()
    return region.evaluate(
        """(region, preview) => {
          const pictured = e => e.matches('img,canvas,video') || /url\\(/.test(getComputedStyle(e).backgroundImage);
          const shown = e => e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}) && e.getBoundingClientRect().width > 0;
          const found = [...region.querySelectorAll('*')].filter(pictured).filter(shown)  // infra: a hidden decoding video is not a frame
            .filter(e => !(e.closest('button,[role="button"]') && /^(Pluck frame|Close clip)$/.test((e.closest('button,[role="button"]').getAttribute('aria-label') || '').trim())))  // L219, L306; infra: icons in the strip's own Pluck and Close controls are not sampled frames
            .filter(e => e !== preview && !e.contains(preview) && !(preview && preview.contains(e)));
          const shapes = found.filter(e => !found.some(o => o !== e && e.contains(o)))
            .map(e => ({element: e, rect: e.getBoundingClientRect()})).filter(({rect: r}) => r.width > 0 && r.height >= 12);
          const rows = new Map();  // infra: retain each pictured element with its geometry to identify a canvas frame band
          for (const shape of shapes) { const r = shape.rect, k = Math.round((r.top + r.height / 2) / 4); rows.set(k, [...(rows.get(k) || []), shape]); }
          const band = [...rows.values()].sort((a, b) => b.length - a.length)[0] || [];
          const tiles = band.map(shape => shape.rect);
          let container = band[0]?.element;
          while (container && container !== region && !band.every(shape => container.contains(shape.element))) container = container.parentElement;
          const bounds = container?.getBoundingClientRect();  // L310; infra: the common frame container includes padded tiles; a lone canvas is itself the band
          const left = bounds?.left ?? NaN, right = bounds?.right ?? NaN;
          const mid = tiles.length ? tiles[0].top + tiles[0].height / 2 : 0;
          const drawn = band.length === 1 && band[0].element.matches('canvas')
            && tiles[0].width >= 0.6 * (region.getBoundingClientRect().width - (preview && region.contains(preview) ? preview.getBoundingClientRect().width : 0));  // L173: the preview may sit at the strip's left end
          return {count: drawn ? null : tiles.length, left, right, y: mid,
                  scrolls: region.scrollWidth > region.clientWidth,
                  width: region.getBoundingClientRect().width, top: region.getBoundingClientRect().top,
                  bottom: region.getBoundingClientRect().bottom,
                  viewport: document.documentElement.clientWidth};
        }""",
        preview,
    )


def settled_strip_band(page: Page, total: int = CAPSTAN_FRAMES) -> dict:
    previous: dict | None = None
    stable_ms = 0

    def ready() -> None:
        nonlocal previous, stable_ms
        band = strip_band(page)
        assert band["count"] is None or min(MIN_STRIP_TILES, total) <= band["count"] <= total
        assert all(math.isfinite(band[k]) for k in ("left", "right", "y"))
        assert 0 <= band["left"] < band["right"] <= band["viewport"]
        assert 0 < band["y"] < page.viewport_size["height"]
        stable_ms = stable_ms + STEP_MS if band == previous else 0
        previous = band
        assert stable_ms >= DOCK_MAX_MS

    eventually(page, ready)
    assert previous is not None
    return previous


def frame_x(band: dict, frame: int, total: int) -> float:
    return band["left"] + (frame + 0.5) * (band["right"] - band["left"]) / total


MOTION_SAMPLE = """([t, scopes, media]) => {
  const s = window.__ms || (window.__ms = {anims: new Map(), ids: new WeakMap(), next: 1, last: 0});
  const born = s.last;
  s.last = t;  // infra: phases started by finish() belong to this sample time
  for (const a of document.getAnimations()) {
    let info = s.anims.get(a);
    if (!info) {
      if (a.playState === 'finished') continue;
      const end = a.effect ? a.effect.getComputedTiming().endTime : Infinity;
      if (!isFinite(end)) continue;
      info = {born, end, reverse: a.playbackRate < 0, done: false};
      s.anims.set(a, info);
      a.pause();
    }
    if (info.done) continue;
    const elapsed = t - info.born;
    a.currentTime = Math.max(0, Math.min(info.end, info.reverse ? info.end - elapsed : elapsed));
    if (elapsed >= info.end) { a.finish(); info.done = true; }  // L442; infra: resolve Animation.finished once so the next phase can start
  }
  const id = e => { if (!s.ids.has(e)) s.ids.set(e, String(s.next++)); return s.ids.get(e); };
  const els = new Set();
  for (const sc of scopes) {
    if (!sc || !sc.isConnected) continue;
    els.add(sc);
    sc.querySelectorAll('*').forEach(e => els.add(e));
  }
  if (media) {
    document.querySelectorAll('body *').forEach(e => {
      if (/^(IMG|CANVAS|VIDEO)$/.test(e.tagName) || getComputedStyle(e).backgroundImage !== 'none') els.add(e);
    });
  }
  const out = {};
  for (const e of els) {
    const r = e.getBoundingClientRect();
    let o = 1;
    for (let n = e; n && n.nodeType === 1; n = n.parentElement) o *= Number(getComputedStyle(n).opacity);
    out[id(e)] = [r.x, r.y, r.width, r.height, o];
  }
  return {scopes: scopes.map(sc => sc ? id(sc) : null), els: out};
}"""

USER_REPRESS = """el => {
  if (!el.isConnected || el.closest('[inert]')) return false;
  if (el.checkVisibility && !el.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
  const r = el.getBoundingClientRect();
  if (!r.width || !r.height) return false;
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (hit && !el.contains(hit)) return false;
  el.click();
  return true;
}"""

MOTION_RELEASE = """() => {
  const s = window.__ms; window.__ms = null;
  if (s) for (const [a, info] of s.anims) { if (info.done) continue; try { a.currentTime = info.reverse ? 0 : info.end; a.finish(); } catch (e) {} }
}"""


def film(page: Page, scopes: list[Any], total_ms: float, media: bool = False) -> tuple[dict[str, list], list]:
    frames: list[tuple[float, dict]] = []
    ids: list = []
    for i in range(max(0, math.ceil(total_ms / MOTION_STEP_MS)) + 1):
        t = i * MOTION_STEP_MS
        if i:
            advance(page, MOTION_STEP_MS)
        shot = page.evaluate(MOTION_SAMPLE, [t, scopes, media])
        ids = ids or shot["scopes"]
        frames.append((t, shot["els"]))
    page.evaluate(MOTION_RELEASE)
    keys = set().union(*(f.keys() for _, f in frames))
    return {k: [(at, f.get(k)) for at, f in frames] for k in keys}, ids


def present(track: list) -> list:
    return [s for _, s in track if s and s[2] > 0 and s[3] > 0]


def same(a: list | None, b: list | None) -> bool:
    if a is None or b is None:
        return a is b
    return all(abs(x - y) < SETTLE_PX for x, y in zip(a, b))


def duration(track: list) -> float:
    first, final = track[0][1], track[-1][1]
    start = 0
    for at, s in track:
        if not same(s, first):
            break
        start = at
    settle = track[-1][0]
    for at, s in reversed(track):
        if not same(s, final):
            break
        settle = at
    return max(0, settle - start)


def travel_duration(track: list) -> float:
    positions = [(at, state[:2]) for at, state in track if state and state[2] > 0 and state[3] > 0]
    return duration(positions) if positions else 0


def in_range(ms: float, low: float, high: float) -> bool:
    return low - MOTION_STEP_MS <= ms <= high + MOTION_STEP_MS


def shift(track: list, axis: int) -> float:
    p = present(track)
    return p[-1][axis] - p[0][axis] if p else 0


def within(state: list, box: dict) -> bool:
    x, y = state[0] + state[2] / 2, state[1] + state[3] / 2
    return box["x"] <= x <= box["x"] + box["width"] and box["y"] <= y <= box["y"] + box["height"]


def flights(tracks: dict[str, list], source: dict, target: dict) -> list:
    out = []
    for track in tracks.values():
        p = present(track)
        if p and within(p[0], source) and any(within(s, target) for s in p[1:]):
            out.append(track)
    return out


def travelled(track: list, source: dict, target: dict) -> bool:
    return any(not within(s, source) and not within(s, target) for s in present(track)[1:])


def strip_region(page: Page) -> Locator:
    region = page.get_by_role("region", name="Sprocket strip", include_hidden=True).first
    expect(region).to_be_attached(timeout=WAIT_S * MS_PER_S)
    return region


ADD_ROW_MAX_MS = 300
SHIFT_MIN_MS = 120
SHIFT_MAX_MS = 200
NUMBER_MAX_MS = 200
SHEET_MAX_MS = 250


def keyboard_to(page: Page, target: Locator) -> None:
    if not target.evaluate("e => e === document.activeElement"):
        focus_order(page, [target])
    focused(page, target)


def no_sideways_scroll(page: Page) -> None:
    assert page.evaluate("() => document.documentElement.scrollWidth <= document.documentElement.clientWidth"), "horizontal page overflow"


def cell_reachable(locator: Locator) -> bool:
    return locator.evaluate("""e => {
      const width = document.documentElement.clientWidth, r = e.getBoundingClientRect();
      if (!r.width || !r.height) return false;
      let left = r.left, right = r.right;
      for (let p = e.parentElement; p; p = p.parentElement) {
        const style = getComputedStyle(p), box = p.getBoundingClientRect();
        if (!/hidden|clip|auto|scroll/.test(style.overflowX)) continue;
        const clipLeft = box.left + p.clientLeft, clipRight = clipLeft + p.clientWidth;
        if (left >= clipLeft && right <= clipRight) continue;
        if (!/auto|scroll/.test(style.overflowX) || p.scrollWidth <= p.clientWidth ||
            box.left < 0 || box.right > width) return false;
        left = clipLeft; right = clipRight;
      }
      return left >= 0 && right <= width;
    }""")


def number_film(page: Page, scope: Locator, old: int, new: int, reduced: bool = False,
                extra: Locator | None = None, activate: Callable[[], None] | None = None,
                respond: Callable[[], None] | None = None, *, any_changed_digit: bool = False) -> list[list]:
    roots = page.evaluate_handle("() => [new Set(), new Set(), new Set()]")
    tracks: dict[str, list] = {}
    labels: dict[str, str] = {}
    visible_digits: set[str] = set()
    row_keys: set[str] = set()
    visible_rows: set[str] = set()
    total = max(NUMBER_MAX_MS, ADD_ROW_MAX_MS if extra is not None else 0) + MOTION_TAIL_MS
    at = 0
    ready_at: int | None = None

    def sample() -> None:
        current = scope.element_handles()
        rows = extra.element_handles() if extra is not None else []
        shot = page.evaluate("""([at, current, rows, roots]) => {
          current.forEach(e => roots[0].add(e)); rows.forEach(e => roots[1].add(e));
          for (const group of roots) for (const e of group) if (!e.isConnected) group.delete(e);
          const counts = [...roots[0]], appended = [...roots[1]];
          const motion = (""" + MOTION_SAMPLE + r""");
          motion([at, [...counts, ...appended], false]);
          const s = window.__ms, out = {};
          for (const e of counts) {
            const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
            for (let n = walker.nextNode(); n; n = walker.nextNode()) roots[2].add(n);
          }
          for (const n of roots[2]) {
            if (!s.ids.has(n)) s.ids.set(n, String(s.next++));
            for (let i = 0; i < n.length; i++) {
              if (!/\d/.test(n.data[i])) continue;
              const range = document.createRange(); range.setStart(n, i); range.setEnd(n, i + 1);
              const r = range.getBoundingClientRect();
              let opacity = 1, hidden = false;
              let left = Math.max(0, r.left), top = Math.max(0, r.top);
              let right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
              for (let p = n.parentElement; p; p = p.parentElement) {
                const style = getComputedStyle(p); opacity *= Number(style.opacity);
                hidden ||= style.display === 'none' || style.visibility === 'hidden';
                const clip = p.getBoundingClientRect();
                if (/hidden|clip|auto|scroll/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
                if (/hidden|clip|auto|scroll/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
              }
              if (hidden || !r.width || !r.height) continue;
              const key = `digit:${s.ids.get(n)}:${i}:${n.data[i]}`;
              out[key] = {digit: n.data[i], box: [r.x, r.y, r.width, r.height, opacity], visible: opacity > 0 && right > left && bottom > top};
            }
          }
          const rowShot = motion([at, appended, false]);
          const visible = [];
          for (const root of appended) for (const e of [root, ...root.querySelectorAll('*')]) {
            if (e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) visible.push(s.ids.get(e));
          }
          return {glyphs: out, rows: rowShot.els, visible};
        }""", [at, current, rows, roots])
        glyphs = shot["glyphs"]
        states = {key: value["box"] for key, value in glyphs.items()}
        labels.update({key: value["digit"] for key, value in glyphs.items()})
        visible_digits.update(key for key, value in glyphs.items() if value["visible"])
        row_keys.update(shot["rows"])
        visible_rows.update(shot["visible"])
        states.update(shot["rows"])
        for key in set(tracks) | set(states):
            tracks.setdefault(key, []).append((at, states.get(key)))

    def record() -> None:
        nonlocal at, ready_at
        sample()
        if ready_at is None and (extra is None or extra.count()):
            ready_at = at
        if ready_at is not None and at >= ready_at + total:
            return
        at += MOTION_STEP_MS
        raise AssertionError("motion recording in progress")

    try:
        sample()
        if activate is not None:
            activate()
            sample()
        if respond is not None:
            respond()
        eventually(page, record, step_ms=MOTION_STEP_MS)
    finally:
        page.evaluate(MOTION_RELEASE)
        roots.dispose()
    if reduced:
        assert all(travel_duration(tr) <= MOTION_STEP_MS for key, tr in tracks.items()
                   if key in visible_digits), "digits rolled under reduced motion"

    return [tracks[key] for key in row_keys if key in visible_rows]


def restore_seat_snapshot(mara: Api, ws: str, snapshot: dict) -> None:
    original = {m["id"]: m["hasSeat"] for m in snapshot["members"]}
    current = seats(mara, ws)
    for member in current["members"]:
        if member["hasSeat"] and not original.get(member["id"], False):
            mara.ok("DELETE", wsp(ws, f"/seats/{member['id']}"), 200)
    for member in snapshot["members"]:
        if member["hasSeat"] and not next(m for m in seats(mara, ws)["members"] if m["id"] == member["id"])["hasSeat"]:
            mara.ok("POST", wsp(ws, "/seats"), 201, json={"memberId": member["id"]})


def test_health_and_port(app_url: str) -> None:
    r = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    expected = int(os.environ.get("APP_PUBLIC_PORT") or APP_PORT)
    assert urlparse(app_url).port == expected


def test_error_shape_and_precedence(app_url: str) -> None:
    anon, juno, ola, sam, tomas = Api(app_url), signin(app_url, JUNO), signin(app_url, OLA), signin(app_url, SAM), signin(app_url, TOMAS)
    r = anon.get("/api/me")
    assert r.status_code == 401 and r.json() == {"error": "unauthenticated", "message": "Sign in to continue."}
    err(anon.post(wsp(NV, "/clusters"), json={"title": "x"}, headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    assert anon.post(wsp(NV, "/clusters"), json={"title": "x"}, headers={"Origin": EVIL_ORIGIN}).json() == {"error": "cross_origin", "message": "Cross-origin requests are not accepted."}
    kc = new_cluster(sam, "kesto")
    r = juno.get(f"/api/clusters/{kc['id']}")
    assert r.status_code == 404 and r.json() == {"error": "not_found", "message": "Not found."}
    err(juno.get(wsp(KS, "/seats")), 404, "not_found")
    r = juno.get(wsp(NV, "/seats"))
    assert r.status_code == 403 and r.json() == {"error": "forbidden", "message": "You do not have permission for this action."}
    err(ola.post(wsp(NV, "/invites"), json={"email": "bad", "displayName": ""}), 403, "forbidden")
    r = ola.post(wsp(NV, "/clusters"), json={"title": "", "publicDescription": "", "internalNote": ""})
    assert r.status_code == 403 and r.json() == {"error": "seat_required", "message": "You need a pro seat to make changes."}
    draft = new_cluster(juno, "northvale")
    r = juno.post(f"/api/clusters/{draft['id']}/review-links", json={"email": "not-an-email", "expiresAt": "x", "canComment": True})
    assert r.status_code == 409 and r.json() == {"error": "cluster_not_in_review", "message": "Review links need a cluster in review."}
    c, refs = ordered_cluster(juno, "northvale", [f"{tag()} a", f"{tag()} b"])
    r = juno.post(f"/api/clusters/{c['id']}/entries/{c['entries'][0]['id']}/move", json={"toPosition": 99, "version": 1})
    body = err(r, 412, "stale_order")
    assert body["version"] == c["version"] and body["entryIds"] == [e["id"] for e in sorted(c["entries"], key=lambda e: e["position"])]
    field_err(juno.post(wsp(NV, "/clusters"), json={"title": " ", "publicDescription": "", "internalNote": ""}), "title", "Enter a title of 1 to 80 characters.")
    rc = new_cluster(tomas, "northvale")
    add(tomas, rc["id"], refs[0]["id"])
    assert status(tomas, rc["id"], "in_review").status_code == 200
    _, email, _ = person("reviewer")
    link = tomas.ok("POST", f"/api/clusters/{rc['id']}/review-links", 201, json={"email": email, "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": True})
    tomas.ok("DELETE", f"/api/review-links/{link['id']}", 204)
    err(anon.post(f"/api/review/{review_token(link['url'])}/comments", json={"authorName": "", "body": ""}), 410, "link_revoked")
    down = signin(urls(app_url)["minio-down"], JUNO)
    locked = new_cluster(juno, "northvale")
    ref = new_image(juno, "northvale", f"{tag()} locked plate")
    add(juno, locked["id"], ref["id"])
    assert status(juno, locked["id"], "in_review").status_code == 200
    assert status(juno, locked["id"], "embargoed", FUTURE_LIFT).status_code == 200
    err(down.delete(wsp(NV, f"/references/{ref['id']}")), 409, "cluster_locked")
    err(down.get(f"/media/{uuid.uuid4()}"), 404, "not_found")


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    anon = Api(base)
    own = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    creds = {"email": "nobody@nowhere.example", "password": "wrong-password"}
    err(anon.post("/api/auth/signin", json=creds, headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    err(anon.post("/api/auth/signin", json=creds, headers={"Origin": own}), 401, "invalid_credentials")
    err(anon.post("/api/auth/signin", json=creds), 401, "invalid_credentials")
    juno = signin(base, JUNO)
    err(juno.delete(f"/api/review-links/{uuid.uuid4()}", headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    err(juno.patch(f"/api/clusters/{uuid.uuid4()}", json={"title": "x"}, headers={"Origin": EVIL_ORIGIN}), 403, "cross_origin")
    empty = len(json.dumps({"email": creds["email"], "password": ""}).encode())
    at_limit = json.dumps({"email": creds["email"], "password": "x" * (JSON_LIMIT - empty)}).encode()
    assert len(at_limit) == JSON_LIMIT
    err(anon.post("/api/auth/signin", content=at_limit, headers={"Content-Type": "application/json"}), 401, "invalid_credentials")
    over = json.dumps({"email": creds["email"], "password": "x" * (JSON_LIMIT - empty + 1)}).encode()
    r = anon.post("/api/auth/signin", content=over, headers={"Content-Type": "application/json"})
    assert r.status_code == 413 and r.json() == {"error": "too_large", "message": "The request is larger than allowed."}
    r = anon.post("/api/auth/signin", content=b"email=x", headers={"Content-Type": "text/plain"})
    assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type", "message": "This content type is not accepted."}
    bea = signin(base, BEA)
    big = upload(bea, "brisk-tonic", png_of_size(IMAGE_LIMIT), "big.png", "image/png", title=f"{tag()} big")
    assert big.status_code == 201, big.text
    bea.ok("DELETE", wsp(BT, f"/references/{big.json()['id']}"), 204)
    err(upload(bea, "brisk-tonic", png_of_size(IMAGE_LIMIT + 1), "big.png", "image/png"), 413, "too_large")
    err(upload(bea, "brisk-tonic", MP4 + b"\x00" * (CLIP_LIMIT + 1 - len(MP4)), "c.mp4", "video/mp4", title="c", frameRate=25, durationMs=1000), 413, "too_large")
    clip = new_clip(bea, "brisk-tonic", f"{tag()} reel")
    c = new_cluster(bea, "brisk-tonic")
    ok = pluck(bea, "brisk-tonic", clip["id"], c["id"], 0, png_of_size(STILL_LIMIT))
    assert ok.status_code == 201, ok.text
    err(pluck(bea, "brisk-tonic", clip["id"], c["id"], 1, png_of_size(STILL_LIMIT + 1)), 413, "too_large")
    for path in NEVER_SERVED:
        r = httpx.get(base + path, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 404, f"{path} served {r.status_code}"


def secret_values() -> list[str]:
    values = []
    for key in ["S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "KILLBILL_URL", "S3_ENDPOINT", "DATABASE_URL"]:
        v = os.environ.get(key, "")
        if len(v) > 8 or (v and not v.isalpha()):
            values.append(v)
    db = urlparse(os.environ.get("DATABASE_URL", ""))
    if db.password and (len(db.password) > 8 or not db.password.isalpha()):
        values.append(db.password)
    return values


def test_secrets_never_reach_the_browser(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    juno = signin(base, JUNO)
    bodies: list[str] = []
    seen: set[str] = set()
    queue = ["/", "/signin", "/explore", "/w/northvale"]
    while queue:
        path = queue.pop()
        if path in seen:
            continue
        seen.add(path)
        r = juno.get(path)
        bodies.append(r.text)
        for ref in re.findall(r"""["'(](/[^"'()\s]+\.(?:js|mjs|css))""", r.text):
            if ref not in seen:
                queue.append(ref)
    for path in ["/api/me", wsp(NV), "/api/health"]:
        bodies.append(juno.get(path).text)
    tomas = signin(base, TOMAS)
    c = new_cluster(tomas, "northvale")
    add(tomas, c["id"], new_image(tomas, "northvale", f"{tag()} plate")["id"])
    assert status(tomas, c["id"], "in_review").status_code == 200
    _, email, _ = person("secret")
    tomas.ok("POST", f"/api/clusters/{c['id']}/review-links", 201, json={"email": email, "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": True})
    bodies += [email_body(m) for m in inbox(mail, email)]
    blob = "\n".join(bodies)
    for value in secret_values():
        assert value not in blob, "a configured secret reached the browser, an API answer or an email"


def test_outage_instances_boot_and_report(app_url: str) -> None:
    for name, base in urls(app_url).items():
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, name
    down = signin(urls(app_url)["minio-down"], JUNO)
    title = f"{tag()} lost upload"
    r = upload(down, "northvale", png_bytes(), "lost.png", "image/png", title=title)
    assert r.status_code == 503 and r.json() == {"error": "storage_unavailable", "message": "Storage is unreachable."}
    assert title not in [x["title"] for x in all_refs(signin(app_url, JUNO), "northvale")]
    c = new_cluster(down, "northvale")
    down.ok("POST", f"/api/clusters/{c['id']}/comments", 201, json={"body": "still works"})
    down.ok("GET", wsp(NV, "/search"), 200, params={"q": "Rope"})
    assert status(down, c["id"], "in_review").status_code == 200
    kb = signin(urls(app_url)["killbill-down"], MARA)
    plan = kb.ok("GET", wsp(NV, "/plan"), 200)
    primary = signin(app_url, MARA).ok("GET", wsp(NV, "/plan"), 200)
    assert plan["plan"] == primary["plan"] and plan["seatCap"] == primary["seatCap"]


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.open = False
        self.stopped = False
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._accept, daemon=True).start()

    def _pipe(self, a: socket.socket, b: socket.socket) -> None:
        with contextlib.suppress(OSError):
            while chunk := a.recv(65536):
                b.sendall(chunk)
        with contextlib.suppress(OSError):
            b.shutdown(socket.SHUT_WR)

    def _accept(self) -> None:
        while not self.stopped:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            if not self.open:
                conn.close()
                continue
            upstream = socket.create_connection(self.target)
            threading.Thread(target=self._pipe, args=(conn, upstream), daemon=True).start()
            threading.Thread(target=self._pipe, args=(upstream, conn), daemon=True).start()

    def stop(self) -> None:
        self.stopped = True
        with contextlib.suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def test_storage_returns_without_restart() -> None:
    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    relay = Relay(endpoint.hostname, endpoint.port or 80)
    port = free_port()
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    env = dict(os.environ, S3_ENDPOINT=f"http://127.0.0.1:{relay.port}", APP_PUBLIC_PORT=str(port))
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        log.flush()
        return Path(log.name).read_text()[-4000:]

    try:
        def healthy() -> bool:
            assert proc.poll() is None, f"copy exited:\n{tail()}"
            with contextlib.suppress(httpx.HTTPError):
                return httpx.get(base + "/api/health", timeout=POLL_S * 8).json() == {"status": "ok"}
            return False

        wait_for(healthy, BOOT_S, "copy health")
        bea = signin(base, BEA)
        err(upload(bea, "brisk-tonic", png_bytes(), "x.png", "image/png", title=f"{tag()} early"), 503, "storage_unavailable")
        relay.open = True
        title = f"{tag()} after return"
        r = wait_for(lambda: (x := upload(bea, "brisk-tonic", png_bytes(), "x.png", "image/png", title=title)).status_code == 201 and x, WAIT_S, "recovery")
        ref = r.json()
        assert f"references/{BT}/{ref['id']}.png" in S3().keys(f"references/{BT}/")
        assert proc.poll() is None, f"copy restarted or exited:\n{tail()}"
        bea.ok("DELETE", wsp(BT, f"/references/{ref['id']}"), 204)
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=WAIT_S)
        relay.stop()


LAYOUT_IDS = ["w375", "w599", "w600", "w719", "w720", "w768", "w1023", "w1024", "w1279", "w1280"]
LAYOUTS = {
    "w375": (375, 812, 1, False, 1, False),
    "w599": (599, 800, 1, False, 1, False),
    "w600": (600, 800, 2, False, 2, False),
    "w719": (719, 800, 2, False, 2, False),
    "w720": (720, 800, 2, True, 2, False),
    "w768": (768, 1024, 2, True, 2, False),
    "w1023": (1023, 800, 2, True, 2, False),
    "w1024": (1024, 800, 3, True, 3, False),
    "w1279": (1279, 800, 3, True, 3, False),
    "w1280": (1280, 800, 3, True, 4, True),
}


def _visual_box(locator: Locator) -> dict | None:
    box = locator.bounding_box()
    if box and box["width"] > 0 and box["height"] > 0:
        return box
    return locator.evaluate("""e => {
        const rects = [...e.querySelectorAll('*')]
            .filter(n => n.checkVisibility({checkOpacity: true, checkVisibilityCSS: true}))
            .map(n => n.getBoundingClientRect()).filter(r => r.width > 0 && r.height > 0);
        if (!rects.length && getComputedStyle(e).visibility === 'visible') {
            const range = document.createRange();
            range.selectNodeContents(e);
            rects.push(...[...range.getClientRects()].filter(r => r.width > 0 && r.height > 0));
        }
        if (!rects.length) return null;
        const x = Math.min(...rects.map(r => r.left)), y = Math.min(...rects.map(r => r.top));
        return {x, y, width: Math.max(...rects.map(r => r.right)) - x,
                height: Math.max(...rects.map(r => r.bottom)) - y};
    }""")


def columns(items: Locator, limit: int = 24) -> int:
    xs = set()
    for i in range(min(items.count(), limit)):
        box = _visual_box(items.nth(i))
        if box and box["width"] > 0:
            xs.add(round(box["x"]))
    return len(xs)


def beside(a: dict, b: dict) -> bool:
    return a["x"] + a["width"] <= b["x"] + 1 or b["x"] + b["width"] <= a["x"] + 1


@pytest.mark.parametrize("case", LAYOUT_IDS, ids=LAYOUT_IDS)
def test_layout_at_published_widths(browser: Browser, app_url: str, case: str) -> None:
    width, height, wall_cols, tray_right, explore_cols, side = LAYOUTS[case]

    def check_layout(page: Page) -> None:
        assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
        for control in page.get_by_role("button").element_handles():
            if not control.is_visible():
                continue
            control.evaluate("e => { if (e.isConnected) e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'}); }")
            box = control.bounding_box()
            if not control.evaluate("e => e.isConnected") or not control.is_visible():
                continue
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1

    ilse = signin(app_url, ILSE)
    c = new_cluster(ilse, "vartan")
    with screen(browser, app_url, "/w/vartan", ILSE, width, height) as page:
        refs = page.get_by_role("list", name="References").get_by_role("listitem")
        eventually(page, lambda: expect(refs.first).to_be_visible(timeout=CHECK_MS))
        eventually(page, lambda: check_layout(page))
        menu = page.get_by_role("button", name="Menu")
        bar = page.get_by_role("button", name=re.compile(r"^Cluster tray: "))

        def wall_geometry() -> None:
            assert columns(refs) == wall_cols
            wall = _visual_box(page.get_by_role("region", name="Reference wall"))
            assert wall
            if tray_right:
                expect(menu).to_have_count(0)
                expect(bar).to_have_count(0)
                tray = _visual_box(page.get_by_role("complementary", name="Cluster tray"))
                assert tray and tray["x"] >= wall["x"] + wall["width"] - 1 and tray["y"] < wall["y"] + wall["height"]
            else:
                expect(menu).to_be_visible()
                box = _visual_box(bar)
                assert box and (abs(box["y"] + box["height"] - height) <= 1 or box["y"] >= wall["y"])
                assert box["width"] >= wall["width"] - 1

        eventually(page, wall_geometry)
        page.goto(app_url.rstrip("/") + "/explore")
        cards = page.get_by_role("feed", name="Discovery feed").get_by_role("article")
        eventually(page, lambda: expect(cards.nth(explore_cols)).to_be_visible(timeout=CHECK_MS))
        eventually(page, lambda: check_layout(page))
        eventually(page, lambda: _equal(columns(cards), explore_cols))
        page.goto(app_url.rstrip("/") + f"/w/vartan/clusters/{c['id']}")
        title = page.get_by_role("textbox", name="Title")
        appears(page, title)
        eventually(page, lambda: check_layout(page))

        def settings_geometry() -> None:
            comments = _visual_box(page.get_by_role("region", name="Comments"))
            details = _visual_box(title)
            assert comments and details
            if side:
                assert beside(details, comments) and comments["x"] > details["x"]
            else:
                assert comments["y"] >= details["y"] + details["height"] - 1

        eventually(page, settings_geometry)
    with screen(browser, app_url, "/w/northvale/admin", MARA, width, height) as page:
        roster = page.get_by_role("table", name="Members")
        appears(page, roster)
        eventually(page, lambda: check_layout(page))

        def admin_geometry() -> None:
            invite = _visual_box(page.get_by_role("button", name="Send invite"))
            roster_box = _visual_box(roster)
            assert invite and roster_box
            if side:
                assert beside(roster_box, invite)
            else:
                assert roster_box["y"] + roster_box["height"] <= invite["y"] + 1 or invite["y"] + invite["height"] <= roster_box["y"] + 1

        eventually(page, admin_geometry)


def test_keyboard_focus_dialogs_and_targets(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/w/vartan", ILSE) as page:
        search = page.get_by_role("searchbox", name="Search references and clusters")
        appears(page, search)
        page.evaluate("""() => {
          document.activeElement && document.activeElement.blur();
          const start = document.body, previous = start.getAttribute('tabindex');
          start.setAttribute('tabindex', '-1'); start.focus();
          if (previous === null) start.removeAttribute('tabindex');
          else start.setAttribute('tabindex', previous);
        }""")
        s, u, card, switcher, new = focus_order(page, [
            search,
            page.get_by_role("button", name="Upload references"),
            page.get_by_role("button", name=re.compile(r"^Add .+ to cluster$")).first,
            page.get_by_role("combobox", name="Tray cluster"),
            page.get_by_role("button", name="New cluster"),
        ])
        assert s < u < card < switcher < new
        plate = "Field Study 01 plate"
        opener = page.get_by_role("button", name=f"Add {plate} to cluster", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Add to cluster")
        appears(page, dialog)
        focused(page, page.get_by_role("combobox", name="Find a cluster"))
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert dialog.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_have_count(0, timeout=CHECK_MS))
        focused(page, opener)
        new_btn = page.get_by_role("button", name="New cluster")
        new_btn.focus()
        page.keyboard.press("Enter")
        nd = page.get_by_role("dialog", name="New cluster")
        appears(page, nd)
        focused(page, nd.get_by_role("textbox", name="Title"))
        for _ in range(8):
            page.keyboard.press("Tab")
            assert nd.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        focused(page, new_btn)


def test_motion_timings_and_reduced_motion(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c = new_cluster(juno, "northvale")
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        opener = page.get_by_role("button", name=f"Open clip {CAPSTAN}", exact=True)
        appears(page, opener)
        opener.click()
        handle = strip_region(page).element_handle()
        tracks, _ = film(page, [handle], DOCK_MAX_MS + MOTION_TAIL_MS)
        rose = [tr for tr in tracks.values() if shift(tr, 1) <= -1]
        assert rose and any(in_range(duration(tr), DOCK_MIN_MS, DOCK_MAX_MS) for tr in rose), [duration(tr) for tr in rose]
        focused(page, page.get_by_role("slider", name="Playhead"))
        page.get_by_role("button", name="Close clip").click()
        tracks, _ = film(page, [handle], DOCK_MAX_MS + MOTION_TAIL_MS)
        sank = [tr for tr in tracks.values() if (p := present(tr)) and max(s[1] for s in p) >= p[0][1] + 1]
        assert sank and any(in_range(duration(tr), DOCK_MIN_MS, DOCK_MAX_MS) for tr in sank), [duration(tr) for tr in sank]
    with screen(browser, app_url, "/explore", None, 375, 812) as page:
        menu = page.get_by_role("button", name="Menu")
        appears(page, menu)
        menu.click()
        nav = page.get_by_role("navigation", name="Main", include_hidden=True).first
        expect(nav).to_be_attached(timeout=WAIT_S * MS_PER_S)
        page.keyboard.press("Escape")
    with screen(browser, app_url, "/w/northvale", JUNO, reduced=True) as page:
        choose_tray(page, c["title"])
        opener = page.get_by_role("button", name=f"Open clip {CAPSTAN}", exact=True)
        appears(page, opener)
        opener.click()
        region = strip_region(page)
        tracks, scopes = film(page, [region.element_handle()], RM_STRIP_FADE_MAX_MS + MOTION_TAIL_MS)
        own = tracks.get(scopes[0])
        assert own and abs(shift(own, 0)) < 1 and abs(shift(own, 1)) < 1, "the strip travels under reduced motion"
        assert duration(own) <= RM_STRIP_FADE_MAX_MS + MOTION_STEP_MS
        slider = page.get_by_role("slider", name="Playhead")
        focused(page, slider)
        tray = page.get_by_role("complementary", name="Cluster tray")
        source, target = region.bounding_box(), tray.bounding_box()
        page.keyboard.press("p")
        tracks, _ = film(page, [region.element_handle(), tray.element_handle()], FLIGHT_MAX_MS + MOTION_TAIL_MS, media=True)
        assert not [t for t in flights(tracks, source, target) if travelled(t, source, target)], "the plucked tile flies under reduced motion"
        shows(page, page.get_by_label("Item count"), "1 items")
        focused(page, slider)
    with screen(browser, app_url, "/explore", None, 375, 812, reduced=True) as page:
        menu = page.get_by_role("button", name="Menu")
        appears(page, menu)
        menu.click()
        nav = page.get_by_role("navigation", name="Main", include_hidden=True).first
        expect(nav).to_be_attached(timeout=WAIT_S * MS_PER_S)
        tracks, _ = film(page, [nav.element_handle()], PANEL_MAX_MS + MOTION_TAIL_MS)
        assert all(duration(tr) <= MOTION_STEP_MS for tr in tracks.values()), "the menu animates under reduced motion"
        appears(page, page.get_by_role("navigation", name="Main").get_by_role("link", name="Explore"))
        handle = nav.element_handle()
        page.keyboard.press("Escape")
        tracks, _ = film(page, [handle], PANEL_MAX_MS + MOTION_TAIL_MS)
        assert all(duration(tr) <= MOTION_STEP_MS for tr in tracks.values()), "the menu animates under reduced motion"


def test_error_summary_on_refused_forms(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/signin") as page:
        email = page.get_by_role("textbox", name="Email")
        appears(page, email)
        email.fill("nobody@nowhere.example")
        page.get_by_label("Password").fill("wrong-password-x")
        page.get_by_role("button", name="Sign in").click()
        summary = page.get_by_role("alert", name="There is a problem")
        focused(page, summary)
        link = summary.get_by_role("link", name="Email or password is incorrect.")
        expect(link).to_be_visible()
        expect(email).to_have_attribute("aria-invalid", "true")
        link.click()
        focused(page, email)
        email.fill(JUNO)
        page.get_by_label("Password").fill("")
        page.get_by_role("button", name="Sign in").click()
        password_link = summary.get_by_role("link", name="Enter your password.")
        appears(page, password_link)
        password_link.click()
        focused(page, page.get_by_label("Password"))
        expect(page.get_by_label("Password")).to_have_accessible_description(re.compile(re.escape("Enter your password.")))
    with screen(browser, app_url, "/signup") as page:
        appears(page, page.get_by_role("textbox", name="Handle"))
        page.get_by_role("textbox", name="Email").fill("not-an-email")
        page.get_by_role("textbox", name="Handle").fill("A")
        page.get_by_label("Password").fill("short")
        page.get_by_role("button", name="Create account").click()
        summary = page.get_by_role("alert", name="There is a problem")
        focused(page, summary)
        for field, message in [("Email", "Enter a valid email address."), ("Display name", "Enter 1 to 60 characters."),
                               ("Handle", "Use 3 to 24 lowercase letters, digits or hyphens."), ("Password", "Use at least 10 characters.")]:
            expect(summary.get_by_role("link", name=message)).to_be_visible()
            control = page.get_by_label(field, exact=True)
            expect(control).to_have_attribute("aria-invalid", "true")
            expect(control).to_have_accessible_description(re.compile(re.escape(message)))
        summary.get_by_role("link", name="Use 3 to 24 lowercase letters, digits or hyphens.").click()
        focused(page, page.get_by_role("textbox", name="Handle"))


def test_status_has_text_and_icon(browser: Browser, app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c = new_cluster(tomas, "northvale")
    add(tomas, c["id"], new_image(tomas, "northvale", f"{tag()} plate")["id"])
    assert status(tomas, c["id"], "in_review").status_code == 200
    _, email, _ = person("icon")
    tomas.ok("POST", f"/api/clusters/{c['id']}/review-links", 201, json={"email": email, "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": False})
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", TOMAS) as page:
        label = page.get_by_label("Status", exact=True)
        eventually(page, lambda: expect(label).to_contain_text("In review", timeout=CHECK_MS))
        state = page.get_by_text(re.compile(r"Live(?![A-Za-z0-9])")).first
        appears(page, state)
    with screen(browser, app_url, "/w/northvale/admin", MARA) as page:
        meter = page.get_by_label("Seats", exact=True)
        eventually(page, lambda: _equal(any(tag_shown(page, meter, w) for w in SEAT_TAGS), True))
        eventually(page, lambda: _equal(plan_shown(page), True))


UPLOAD_IDS = ["jpeg", "png", "webp", "mp4", "webm", "png-named-gif", "svg", "html", "gif", "gif-named-png", "junk",
              "clip-no-title", "clip-bad-rate", "clip-bad-duration", "no-file"]
UPLOADS: dict[str, tuple[str, str, bytes, int, str]] = {
    "jpeg": ("scout.jpg", "image/jpeg", jpeg_with_metadata()[0], 201, "jpg"),
    "png": ("scout.png", "image/png", png_bytes(), 201, "png"),
    "webp": ("scout.webp", "image/webp", webp_with_metadata()[0], 201, "webp"),
    "mp4": ("reel.mp4", "video/mp4", MP4, 201, "mp4"),
    "webm": ("reel.webm", "video/webm", WEBM, 201, "webm"),
    "png-named-gif": ("scout.gif", "image/gif", png_bytes(), 201, "png"),
    "svg": ("scout.svg", "image/svg+xml", SVG, 415, ""),
    "html": ("scout.html", "text/html", HTML, 415, ""),
    "gif": ("scout.gif", "image/gif", GIF, 415, ""),
    "gif-named-png": ("scout.png", "image/png", GIF, 415, ""),
    "junk": ("scout.jpg", "image/jpeg", JUNK, 415, ""),
    "clip-no-title": ("reel.webm", "video/webm", WEBM, 422, "title"),
    "clip-bad-rate": ("reel.webm", "video/webm", WEBM, 422, "frameRate"),
    "clip-bad-duration": ("reel.webm", "video/webm", WEBM, 422, "durationMs"),
    "no-file": ("", "", b"", 422, "file"),
}
FIELD_MESSAGES = {
    "title": "Enter a title of 1 to 80 characters.",
    "frameRate": "Choose 24, 25 or 30 frames per second.",
    "durationMs": "Enter a duration from 1 to 3600000 milliseconds.",
    "file": "Attach one file.",
}


@pytest.mark.parametrize("case", UPLOAD_IDS, ids=UPLOAD_IDS)
def test_upload_references(app_url: str, case: str) -> None:
    bea = signin(app_url, BEA)
    filename, ctype, data, expected, ext = UPLOADS[case]
    t = tag()
    stem = f"{t}-{filename.rsplit('.', 1)[0]}" if filename else t
    name = f"{stem}.{filename.rsplit('.', 1)[1]}" if filename else ""
    fields: dict[str, Any] = {}
    if case in ("mp4", "webm"):
        fields = {"title": f"{t} reel", "frameRate": 30, "durationMs": CAPSTAN_MS}
    elif case == "clip-no-title":
        fields = {"frameRate": 25, "durationMs": 1000}
    elif case == "clip-bad-rate":
        fields = {"title": "reel", "frameRate": 29, "durationMs": 1000}
    elif case == "clip-bad-duration":
        fields = {"title": "reel", "frameRate": 25, "durationMs": 0}
    if case == "no-file":
        r = bea.post(wsp(BT, "/references"), files={"title": (None, t)})
    else:
        r = upload(bea, "brisk-tonic", data, name, ctype, **fields)
    if expected == 415:
        assert r.status_code == 415 and r.json() == {"error": "unsupported_media_type", "message": "This content type is not accepted."}
        assert stem not in [x["title"] for x in all_refs(bea, "brisk-tonic")]
        return
    if expected == 422:
        field_err(r, ext, FIELD_MESSAGES[ext])
        return
    assert r.status_code == 201, r.text
    ref = r.json()
    assert {"id", "kind", "title", "mediaUrl", "createdAt", "createdBy", "frameRate", "durationMs", "totalFrames", "sourceClipId", "sourceClipTitle", "frameIndex", "timecode"} <= set(ref)
    assert ref["mediaUrl"] == f"/media/{ref['id']}" and ref["createdBy"] == {"displayName": "Bea Lund", "handle": "bea"}
    assert re.fullmatch(r"[0-9a-f-]{36}", ref["id"])
    assert ref["sourceClipId"] is None and ref["frameIndex"] is None and ref["timecode"] is None
    if case in ("mp4", "webm"):
        assert ref["kind"] == "clip" and ref["title"] == f"{t} reel"
        assert ref["frameRate"] == 30 and ref["durationMs"] == CAPSTAN_MS and ref["totalFrames"] == CAPSTAN_MS * 30 // MS_PER_S
    else:
        assert ref["kind"] == "image" and ref["title"] == stem
        assert ref["frameRate"] is None and ref["totalFrames"] is None
    assert f"references/{BT}/{ref['id']}.{ext}" in S3().keys(f"references/{BT}/{ref['id']}")
    assert ref["id"] in [x["id"] for x in all_refs(bea, "brisk-tonic")]
    bea.ok("DELETE", wsp(BT, f"/references/{ref['id']}"), 204)


def bucket_matches_rows(api: Api, ws: str) -> None:
    keys = S3().keys(f"references/{ws}/")
    ids = {k.rsplit("/", 1)[1].rsplit(".", 1)[0] for k in keys}
    assert len(ids) == len(keys), "two objects for one reference"
    assert ids == {r["id"] for r in all_refs(api, ws)}, "bucket and reference rows differ"


def test_objects_match_references(app_url: str) -> None:
    bea = signin(app_url, BEA)
    down = signin(urls(app_url)["minio-down"], BEA)
    t = tag()
    image = new_image(bea, "brisk-tonic", f"{t} plate")
    clip = new_clip(bea, "brisk-tonic", f"{t} reel")
    c = new_cluster(bea, "brisk-tonic")
    still = pluck(bea, "brisk-tonic", clip["id"], c["id"], 3).json()["reference"]
    bucket_matches_rows(bea, "brisk-tonic")
    err(upload(down, "brisk-tonic", png_bytes(), "x.png", "image/png", title=f"{t} lost"), 503, "storage_unavailable")
    err(pluck(down, "brisk-tonic", clip["id"], c["id"], 4), 503, "storage_unavailable")
    err(down.delete(wsp(BT, f"/references/{image['id']}")), 503, "storage_unavailable")
    assert cluster(bea, c["id"])["itemCount"] == 1
    bucket_matches_rows(bea, "brisk-tonic")
    bea.ok("DELETE", wsp(BT, f"/references/{image['id']}"), 204)
    err(bea.get(f"/media/{image['id']}"), 404, "not_found")
    bea.ok("DELETE", wsp(BT, f"/references/{clip['id']}"), 204)
    assert bea.get(f"/media/{still['id']}").status_code == 200
    bucket_matches_rows(bea, "brisk-tonic")
    assert f"references/{BT}/{still['id']}.png" in S3().keys(f"references/{BT}/{still['id']}")


def test_seat_required_for_edits(browser: Browser, app_url: str) -> None:
    ola = signin(app_url, OLA)
    juno = signin(app_url, JUNO)
    ola.ok("GET", wsp(NV, "/references"), 200)
    ola.ok("GET", wsp(NV, "/clusters"), 200)
    ola.ok("GET", wsp(NV, "/search"), 200, params={"q": "Rope"})
    draft = new_cluster(juno, "northvale")
    ref = new_image(juno, "northvale", f"{tag()} plate")
    ola.ok("GET", f"/api/clusters/{draft['id']}", 200)
    attempts = [
        ola.post(wsp(NV, "/clusters"), json={"title": "x", "publicDescription": "", "internalNote": ""}),
        upload(ola, "northvale", png_bytes(), "x.png", "image/png"),
        ola.post(f"/api/clusters/{draft['id']}/entries", json={"referenceId": ref["id"], "isPrivate": False}),
        ola.patch(f"/api/clusters/{draft['id']}", json={"title": "renamed"}),
        ola.post(f"/api/clusters/{draft['id']}/comments", json={"body": "hello"}),
        status(ola, draft["id"], "in_review"),
        ola.delete(wsp(NV, f"/references/{ref['id']}")),
    ]
    for r in attempts:
        assert r.status_code == 403 and r.json() == {"error": "seat_required", "message": "You need a pro seat to make changes."}, r.text
    after = cluster(juno, draft["id"])
    assert after["status"] == "draft" and after["title"] == draft["title"] and after["itemCount"] == 0
    assert juno.get(f"/api/clusters/{draft['id']}/comments").json()["comments"] == []
    aw = feed_id("AW26 Night Shift", app_url)
    err(status(ola, aw, "withdrawn"), 403, "forbidden")
    with screen(browser, app_url, "/w/northvale", OLA) as page:
        page.get_by_role("button", name="New cluster").click()
        dialog = page.get_by_role("dialog", name="New cluster")
        dialog.get_by_role("textbox", name="Title").fill(f"{tag()} seatless")
        dialog.get_by_role("button", name="Create cluster").click()
        shows(page, live(page, "Wall announcements"), "You need a pro seat to make changes. Ask your design ops lead.")


def test_brand_scoped_literal_search(app_url: str) -> None:
    sam, bea, mara = signin(app_url, SAM), signin(app_url, BEA), signin(app_url, MARA)
    t = tag()
    board = new_cluster(sam, "kesto", f"{t} 50%_off board")
    pct = new_image(sam, "kesto", f"{t} 50%_off")
    plain = new_image(sam, "kesto", f"{t} 50%Xoff")
    slash = new_image(sam, "kesto", f"{t} a\\b")
    new_cluster(bea, "brisk-tonic", f"{t} 50%_off sister")
    new_image(bea, "brisk-tonic", f"{t} 50%_off sister plate")
    def search(api: Api, ws: str, q: str) -> dict:
        return api.ok("GET", f"/api/workspaces/{ws}/search", 200, params={"q": q})
    r = search(sam, "kesto", f"{t} 50%_")
    assert r["query"] == f"{t} 50%_"
    assert r["counts"] == {"clusters": 1, "references": 1}
    assert [c["id"] for c in r["clusters"]] == [board["id"]] and [x["id"] for x in r["references"]] == [pct["id"]]
    assert {"id", "title", "status", "itemCount"} <= set(r["clusters"][0])
    r = search(sam, "kesto", f"{t} 50%")
    assert {x["id"] for x in r["references"]} == {pct["id"], plain["id"]}
    assert [x["id"] for x in search(sam, "kesto", f"{t} A\\")["references"]] == [slash["id"]]
    assert search(sam, "kesto", f"{t} a%")["counts"]["references"] == 0
    r = search(mara, "kesto", t.upper())
    assert r["counts"]["clusters"] == 1 and "sister" not in json.dumps(r)
    clip = new_clip(sam, "kesto", f"{t} reel")
    c = new_cluster(sam, "kesto")
    still = pluck(sam, "kesto", clip["id"], c["id"], 5).json()["reference"]
    sam.ok("DELETE", wsp(KS, f"/references/{clip['id']}"), 204)
    r = search(sam, "kesto", f"{t} REEL")
    assert [x["id"] for x in r["references"]] == [still["id"]]
    assert r["references"][0]["sourceClipTitle"] == f"{t} reel"
    for i in range(SEARCH_LIST_MAX + 1):
        new_image(sam, "kesto", f"{t} bulk {i:02d}")
    r = search(sam, "kesto", f"{t} bulk")
    assert r["counts"]["references"] == SEARCH_LIST_MAX + 1 and 1 <= len(r["references"]) <= SEARCH_LIST_MAX
    assert all(f"{t} bulk" in x["title"].lower() for x in r["references"])
    field_err(sam.get(wsp(KS, "/search"), params={"q": ""}), "q", "Enter 1 to 100 characters.")
    field_err(sam.get(wsp(KS, "/search"), params={"q": "x" * (Q_MAX + 1)}), "q", "Enter 1 to 100 characters.")
    sam.ok("GET", wsp(KS, "/search"), 200, params={"q": "x" * Q_MAX})


def test_brand_scoped_pickers_and_cursors(app_url: str) -> None:
    juno, sam, mara = signin(app_url, JUNO), signin(app_url, SAM), signin(app_url, MARA)
    t = tag()
    mine = new_cluster(juno, "northvale", f"{t} picker")
    new_cluster(sam, "kesto", f"{t} picker")
    listed = juno.ok("GET", wsp(NV, "/clusters"), 200, params={"q": t})
    assert listed["total"] == 1 and [c["id"] for c in listed["clusters"]] == [mine["id"]]
    assert {"id", "title", "status", "itemCount"} <= set(listed["clusters"][0])
    page = mara.ok("GET", wsp(NV, "/references"), 200, params={"limit": 1})
    assert len(page["items"]) == 1 and page["nextCursor"]
    cursor = page["nextCursor"]
    nxt = mara.ok("GET", wsp(NV, "/references"), 200, params={"limit": 1, "cursor": cursor})
    assert nxt["items"][0]["id"] != page["items"][0]["id"]
    assert nxt["items"][0]["createdAt"] <= page["items"][0]["createdAt"]
    field_err(mara.get(wsp(KS, "/references"), params={"cursor": cursor}), "cursor", "Invalid cursor.")
    field_err(mara.get("/api/feed", params={"cursor": cursor}), "cursor", "Invalid cursor.")
    field_err(mara.get(wsp(NV, "/references"), params={"cursor": cursor + "x"}), "cursor", "Invalid cursor.")
    field_err(mara.get(wsp(NV, "/references"), params={"cursor": "abc"}), "cursor", "Invalid cursor.")
    feed_cursor = Api(app_url).ok("GET", "/api/feed", 200, params={"limit": 1})["nextCursor"]
    field_err(mara.get(wsp(NV, "/references"), params={"cursor": feed_cursor}), "cursor", "Invalid cursor.")
    field_err(juno.get(wsp(NV, "/references"), params={"limit": 0}), "limit", "Use a whole number of 1 or more.")
    field_err(juno.get(wsp(NV, "/references"), params={"limit": "x"}), "limit", "Use a whole number of 1 or more.")
    assert len(juno.ok("GET", wsp(NV, "/references"), 200, params={"limit": REFERENCES_MAX + 1})["items"]) <= REFERENCES_MAX


def test_add_to_cluster_announced(browser: Browser, app_url: str) -> None:
    juno, sam = signin(app_url, JUNO), signin(app_url, SAM)
    t = tag()
    c, _ = ordered_cluster(juno, "northvale", [f"{t} first", f"{t} second"], f"{t} order")
    ref = new_image(juno, "northvale", f"{t} buoy")
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        opener = page.get_by_role("button", name=f"Add {ref['title']} to cluster", exact=True)
        appears(page, opener)
        opener.click()
        field = page.get_by_role("combobox", name="Find a cluster")
        focused(page, field)
        field.fill(t)
        advance(page, DEBOUNCE_MS)
        option = page.get_by_role("listbox", name="Clusters").get_by_role("option", name=re.compile(re.escape(c["title"])))
        appears(page, option)
        eventually(page, lambda: _equal(reads_as(option, f"{c['title']} · 2 items"), True))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        shows(page, live(page, "Tray announcements"), f"Added {ref['title']}. 3 items in {c['title']}.")
        focused(page, opener)
        shows(page, page.get_by_label("Item count"), "3 items")
        eventually(page, lambda: _equal(tray_order(page), [f"{t} first", f"{t} second", ref["title"]]))
        opener.click()
        page.get_by_role("combobox", name="Find a cluster").fill(t)
        advance(page, DEBOUNCE_MS)
        appears(page, option)
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        shows(page, live(page, "Tray announcements"), f"{ref['title']} is already in {c['title']}.")
    after = cluster(juno, c["id"])
    assert entry_titles(after) == [f"{t} first", f"{t} second", ref["title"]]
    assert after["itemCount"] == 3 and after["version"] == c["version"] + 1
    err(juno.post(f"/api/clusters/{c['id']}/entries", json={"referenceId": ref["id"], "isPrivate": False}), 409, "already_in_cluster")
    other = new_image(sam, "kesto", f"{t} kesto")
    err(juno.post(f"/api/clusters/{c['id']}/entries", json={"referenceId": other["id"], "isPrivate": False}), 404, "not_found")
    res = add(juno, c["id"], new_image(juno, "northvale", f"{t} fourth")["id"])
    assert res["entry"]["position"] == 4 and res["itemCount"] == 4 and res["version"] == after["version"] + 1


def _equal(a: Any, b: Any) -> None:
    assert a == b, f"{a!r} != {b!r}"


METADATA_IDS = ["jpeg", "png", "webp", "still"]


@pytest.mark.parametrize("case", METADATA_IDS, ids=METADATA_IDS)
def test_uploads_carry_no_hidden_metadata(app_url: str, case: str) -> None:
    sam = signin(app_url, SAM)
    builders = {"jpeg": (jpeg_with_metadata, "image/jpeg", "jpg"), "png": (png_with_metadata, "image/png", "png"),
                "webp": (webp_with_metadata, "image/webp", "webp"), "still": (png_with_metadata, "image/png", "png")}
    build, ctype, ext = builders[case]
    original, expected = build()
    if case == "still":
        clip = new_clip(sam, "kesto", f"{tag()} reel")
        c = new_cluster(sam, "kesto")
        r = pluck(sam, "kesto", clip["id"], c["id"], 2, original)
        assert r.status_code == 201, r.text
        ref = r.json()["reference"]
    else:
        r = upload(sam, "kesto", original, f"scout.{ext}", ctype, title=f"{tag()} scout")
        assert r.status_code == 201, r.text
        ref = r.json()
    assert S3().get(f"references/{KS}/{ref['id']}.{ext}") == expected
    served = sam.get(f"/media/{ref['id']}")
    assert served.status_code == 200 and served.content == expected
    assert served.headers["X-Content-Type-Options"] == "nosniff"
    assert served.headers["Content-Type"].split(";")[0].strip() == ctype
    assert served.headers["Content-Disposition"] == f'inline; filename="{ref["id"]}.{ext}"'


def test_latest_search_text_wins(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    q1, q2 = f"{t}-old", f"{t}-new"
    new_image(juno, "northvale", f"{q2} plate")
    alpha = new_cluster(juno, "northvale", f"{t}-alpha")
    beta = new_cluster(juno, "northvale", f"{t}-beta")
    ref = new_image(juno, "northvale", f"{t} card")
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        parked: list[Any] = []

        def hold(query: str) -> Callable[[Any], None]:
            def handler(route: Any) -> None:
                if parse_qs(urlparse(route.request.url).query).get("q", [""])[0] == query:
                    parked.append(route)
                else:
                    route.continue_()
            return handler

        page.route(f"**{wsp(NV, '/search')}?*", hold(q1))
        box = page.get_by_role("searchbox", name="Search references and clusters")
        appears(page, box)
        box.fill(q1)
        box.press("Enter")
        eventually(page, lambda: _equal(len(parked), 1))
        shows(page, live(page, "Search status"), "Searching...")
        box.fill(q2)
        box.press("Enter")
        shows(page, live(page, "Search status"), f"0 clusters and 1 references match {q2}.")
        stale = parked.pop()
        stale.continue_()
        stale.request.response()
        advance(page, DEBOUNCE_MS)
        shows(page, live(page, "Search status"), f"0 clusters and 1 references match {q2}.")
        box.fill("")
        appears(page, page.get_by_role("button", name=f"Add {ref['title']} to cluster", exact=True))
        page.route(f"**{wsp(NV, '/clusters')}?*", hold(f"{t}-alpha"))
        page.get_by_role("button", name=f"Add {ref['title']} to cluster", exact=True).click()
        field = page.get_by_role("combobox", name="Find a cluster")
        field.fill(f"{t}-alpha")
        eventually(page, lambda: _equal(len(parked), 1))
        field.fill(f"{t}-beta")
        advance(page, DEBOUNCE_MS)
        options = page.get_by_role("listbox", name="Clusters")
        appears(page, options.get_by_role("option", name=re.compile(re.escape(beta["title"]))))
        late = parked.pop()
        late.continue_()
        late.request.response()
        advance(page, DEBOUNCE_MS)
        def current_picker_answer() -> None:
            expect(options.get_by_role("option", name=re.compile(re.escape(beta["title"])))).to_be_visible(timeout=CHECK_MS)
            expect(options.get_by_role("option", name=re.compile(re.escape(alpha["title"])))).to_have_count(0, timeout=CHECK_MS)
        eventually(page, current_picker_answer)


def test_search_lives_in_the_address(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    new_image(juno, "northvale", f"{t} quay")
    base = app_url.rstrip("/")
    with screen(browser, app_url, f"/w/northvale?q={quote(t + '%41', safe='')}", JUNO) as page:
        box = page.get_by_role("searchbox", name="Search references and clusters")
        eventually(page, lambda: expect(box).to_have_value(f"{t}%41", timeout=CHECK_MS))
        shows(page, live(page, "Search status"), f"Nothing in Northvale matches {t}%41.")
        page.goto(base + "/w/northvale")
        appears(page, box)
        box.fill(t)
        advance(page, DEBOUNCE_MS)
        shows(page, live(page, "Search status"), f"0 clusters and 1 references match {t}.")
        box.press("Enter")
        eventually(page, lambda: _equal(parse_qs(urlparse(page.url).query).get("q"), [t]))
        results = page.get_by_role("region", name="Search results")
        found_clusters, found_refs = 0, 1
        expect(results.get_by_role("heading", name=f"{found_clusters} clusters")).to_be_visible()
        expect(results.get_by_role("heading", name=f"{found_refs} references")).to_be_visible()
        page.reload()
        eventually(page, lambda: expect(box).to_have_value(t, timeout=CHECK_MS))
        shows(page, live(page, "Search status"), f"0 clusters and 1 references match {t}.")
        box.fill("")
        eventually(page, lambda: _equal("q" in parse_qs(urlparse(page.url).query), False))
        eventually(page, lambda: expect(results).to_have_count(0, timeout=CHECK_MS))
        page.go_back()
        eventually(page, lambda: expect(box).to_have_value(t, timeout=CHECK_MS))
        shows(page, live(page, "Search status"), f"0 clusters and 1 references match {t}.")
        page.go_forward()
        eventually(page, lambda: expect(box).to_have_value("", timeout=CHECK_MS))
        eventually(page, lambda: expect(results).to_have_count(0, timeout=CHECK_MS))
        page.goto(base + f"/w/kesto?q={t}")
        appears(page, page.get_by_role("heading", name="This page does not exist."))


def ui_upload(page: Page, name: str, data: bytes, ctype: str) -> None:
    button = page.get_by_role("button", name="Upload references")
    choosers: list = []

    def grab(chooser: Any) -> None:
        choosers.append(chooser)

    page.on("filechooser", grab)
    try:
        for _ in range(UPLOAD_PRESSES):
            button.focus()
            page.keyboard.press("Enter")
            with contextlib.suppress(AssertionError):
                eventually(page, lambda: _equal(bool(choosers), True), CHOOSER_S)
            if choosers:
                break
        assert choosers, "Upload references never opened a file picker"
        choosers[0].set_files(files=[{"name": name, "mimeType": ctype, "buffer": data}])
    finally:
        page.remove_listener("filechooser", grab)


def test_wf_library_and_search_happy(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    c = new_cluster(juno, "northvale", f"{t} Coastal")
    photo, stripped = jpeg_with_metadata()
    reel = S3().get(f"references/northvale/{capstan(juno)['id']}.webm")
    with screen(browser, app_url, "/signin") as page:
        page.get_by_role("textbox", name="Email").fill(JUNO)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: _equal(urlparse(page.url).path, "/w/northvale"))
        for i in (1, 2):
            ui_upload(page, f"{t}-scout-{i}.jpg", photo, "image/jpeg")
            shows(page, live(page, "Wall announcements"), f"Uploaded {t}-scout-{i}.")
        ui_upload(page, f"{t}-reel.webm", reel, "video/webm")
        dialog = page.get_by_role("dialog", name="Clip details")
        appears(page, dialog)
        dialog.get_by_role("textbox", name="Title").fill(f"{t} reel")
        check(dialog.get_by_role("radiogroup", name="Frame rate").get_by_role("radio", name="25"))
        dialog.get_by_role("button", name="Upload clip").click()
        shows(page, live(page, "Wall announcements"), f"Uploaded {t} reel.")
        box = page.get_by_role("searchbox", name="Search references and clusters")
        box.fill(t)
        box.press("Enter")
        shows(page, live(page, "Search status"), f"1 clusters and 3 references match {t}.")
        assert parse_qs(urlparse(page.url).query)["q"] == [t]
        page.reload()
        shows(page, live(page, "Search status"), f"1 clusters and 3 references match {t}.")
        box.fill("")
        opener = page.get_by_role("button", name=f"Add {t}-scout-1 to cluster", exact=True)
        appears(page, opener)
        opener.click()
        page.get_by_role("combobox", name="Find a cluster").fill("Coastal")
        advance(page, DEBOUNCE_MS)
        appears(page, page.get_by_role("listbox", name="Clusters").get_by_role("option", name=re.compile(re.escape(c["title"]))))
        page.get_by_role("combobox", name="Find a cluster").fill(t[:8] + t[8:] + " Coa")
        advance(page, DEBOUNCE_MS)
        appears(page, page.get_by_role("listbox", name="Clusters").get_by_role("option", name=re.compile(re.escape(c["title"]))))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        shows(page, live(page, "Tray announcements"), f"Added {t}-scout-1. 1 items in {c['title']}.")
        page.reload()
        shows(page, page.get_by_label("Item count"), "1 items")
        eventually(page, lambda: _equal(tray_order(page), [f"{t}-scout-1"]))
        expect(page.get_by_role("list", name="Cluster order").get_by_role("listitem").first).to_contain_text("1")
    refs = {r["title"]: r for r in all_refs(juno, "northvale") if r["title"].startswith(t)}
    assert set(refs) == {f"{t}-scout-1", f"{t}-scout-2", f"{t} reel"}
    assert S3().get(f"references/northvale/{refs[f'{t}-scout-1']['id']}.jpg") == stripped
    assert entry_titles(cluster(juno, c["id"])) == [f"{t}-scout-1"]


def test_wf_library_and_search_isolation(browser: Browser, app_url: str) -> None:
    sam = signin(app_url, SAM)
    t = tag()
    kc = new_cluster(sam, "kesto", f"{t} sister board")
    new_image(sam, "kesto", f"{t} sister plate")
    juno = signin(app_url, JUNO)
    ref = new_image(juno, "northvale", f"{t} own")
    for who in (JUNO, MARA):
        with screen(browser, app_url, f"/w/northvale?q={t}%20sister", who) as page:
            shows(page, live(page, "Search status"), f"Nothing in Northvale matches {t} sister.")
            expect(page.get_by_text(kc["title"])).to_have_count(0)
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        page.get_by_role("button", name=f"Add {ref['title']} to cluster", exact=True).click()
        page.get_by_role("combobox", name="Find a cluster").fill(t)
        advance(page, DEBOUNCE_MS)
        eventually(page, lambda: expect(page.get_by_role("option", name=re.compile(re.escape(kc["title"])))).to_have_count(0, timeout=CHECK_MS))
    err(juno.get(f"/api/clusters/{kc['id']}/export.csv"), 404, "not_found")
    assert juno.ok("GET", wsp(NV, "/search"), 200, params={"q": t})["counts"] == {"clusters": 0, "references": 1}


def test_wf_library_and_search_storage_down(browser: Browser, app_url: str) -> None:
    t = tag()
    down = urls(app_url)["minio-down"]
    juno = signin(app_url, JUNO)
    with screen(browser, down, "/w/northvale", JUNO) as page:
        appears(page, page.get_by_role("button", name="Upload references"))
        ui_upload(page, f"{t}-lost.png", png_bytes(), "image/png")
        shows(page, live(page, "Wall announcements"), f"Storage is unreachable. {t}-lost.png was not uploaded.")
        ui_upload(page, f"{t}-anim.gif", GIF, "image/gif")
        shows(page, live(page, "Wall announcements"), f"{t}-anim.gif is not a supported image or clip.")
    assert not [r for r in all_refs(juno, "northvale") if r["title"].startswith(t)]
    assert not any(t in k for k in S3().keys("references/northvale/"))
    bucket_matches_rows(juno, "northvale")


def test_sprocket_strip(browser: Browser, app_url: str) -> None:
    counts = {}
    for width, height in ((1280, 800), (375, 812)):
        with screen(browser, app_url, "/w/northvale", JUNO, width, height) as page:
            slider = open_capstan(page)

            def docked() -> dict:
                b = strip_band(page)
                assert not b["scrolls"]
                assert b["count"] is None or MIN_STRIP_TILES <= b["count"] <= CAPSTAN_FRAMES
                assert b["bottom"] <= height + 1
                strip = page.get_by_role("region", name="Sprocket strip").bounding_box()
                tray = page.get_by_role("complementary", name="Cluster tray")
                spans = [r for r in (page.get_by_role("region", name="Reference wall").bounding_box(),
                                     tray.bounding_box() if tray.count() and tray.is_visible() else None) if r and r["width"] > 0]
                assert strip and spans
                assert strip["x"] <= min(r["x"] for r in spans) + 1 and strip["x"] + strip["width"] >= max(r["x"] + r["width"] for r in spans) - 1
                return b

            eventually(page, docked)
            band = docked()
            slider.focus()
            page.keyboard.press("Home")
            _shows_frame(page, slider, 0)
            assert slider.evaluate("el => Number(el.getAttribute('aria-valuemin') ?? el.min)") == 0
            assert slider.evaluate("el => Number(el.getAttribute('aria-valuemax') ?? el.max)") == CAPSTAN_FRAMES - 1
            expect(page.get_by_role("img", name="Frame preview")).to_be_visible()
            layout(page)
            counts[width] = band["count"]
            page.set_viewport_size({"width": 768, "height": 1024})
            eventually(page, lambda: _equal((lambda b: (b["scrolls"], b["count"] in (None, *range(MIN_STRIP_TILES, CAPSTAN_FRAMES + 1))))(strip_band(page)), (False, True)))
    assert all(n is None or MIN_STRIP_TILES <= n <= CAPSTAN_FRAMES for n in counts.values())


def test_playhead_scrubbing(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        slider = open_capstan(page)
        band = settled_strip_band(page)
        frames = [0, 7, 20, 33, 49]
        page.mouse.move(frame_x(band, frames[0], CAPSTAN_FRAMES), band["y"])
        page.mouse.down()
        for f in frames + frames[::-1]:
            page.mouse.move(frame_x(band, f, CAPSTAN_FRAMES), band["y"])
            _shows_frame(page, slider, f)
        page.mouse.move(frame_x(band, 20, CAPSTAN_FRAMES), band["y"])
        page.mouse.up()
        advance(page, MS_PER_S)
        assert slider_value(slider) == 20
        slider.focus()
        for key, frame in [("Home", 0), ("ArrowLeft", 0), ("ArrowRight", 1), ("Shift+ArrowRight", 26), ("End", 49),
                           ("ArrowRight", 49), ("Shift+ArrowLeft", 24), ("Shift+ArrowLeft", 0)]:
            page.keyboard.press(key)
            _shows_frame(page, slider, frame)


def test_pluck_api(app_url: str) -> None:
    juno, sam, ola = signin(app_url, JUNO), signin(app_url, SAM), signin(app_url, OLA)
    clip = capstan(juno)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} lead"])
    version = c["version"]
    for n, frame in enumerate([26, 49, 0], start=2):
        r = pluck(juno, "northvale", clip["id"], c["id"], frame)
        assert r.status_code == 201, r.text
        body = r.json()
        ref = body["reference"]
        tc = timecode(frame, CAPSTAN_FPS)
        assert ref["kind"] == "still" and ref["sourceClipId"] == clip["id"] and ref["sourceClipTitle"] == CAPSTAN
        assert ref["frameIndex"] == frame and ref["timecode"] == tc and ref["title"] == f"{CAPSTAN} @ {tc}"
        assert body["entry"]["position"] == n and body["cluster"] == {"id": c["id"], "itemCount": n, "version": version + 1}
        version += 1
        assert f"references/northvale/{ref['id']}.png" in S3().keys(f"references/northvale/{ref['id']}")
    assert entry_titles(cluster(juno, c["id"]))[-1] == f"{CAPSTAN} @ {timecode(0, CAPSTAN_FPS)}"
    for bad in (CAPSTAN_FRAMES, -1):
        field_err(pluck(juno, "northvale", clip["id"], c["id"], bad), "frameIndex", f"Choose a frame from 0 to {CAPSTAN_FRAMES - 1}.")
    long_clip = new_clip(sam, "kesto", f"{tag()} long", CAPSTAN_FPS, 60000)
    kc = new_cluster(sam, "kesto")
    assert pluck(sam, "kesto", long_clip["id"], kc["id"], 1234).json()["reference"]["timecode"] == "00:00:49:09"
    err(juno.post(wsp(NV, f"/clips/{clip['id']}/stills"), files={"still": ("f.jpg", jpeg_with_metadata()[0], "image/jpeg")},
                  data={"frameIndex": "1", "clusterId": c["id"]}), 415, "unsupported_media_type")
    err(pluck(juno, "northvale", clip["id"], kc["id"], 1), 404, "not_found")
    err(pluck(ola, "northvale", clip["id"], c["id"], 1), 403, "seat_required")
    assert status(juno, c["id"], "in_review").status_code == 200
    assert status(juno, c["id"], "embargoed", FUTURE_LIFT).status_code == 200
    err(pluck(juno, "northvale", clip["id"], c["id"], 1), 409, "cluster_locked")
    assert cluster(juno, c["id"])["itemCount"] == 4


def test_pluck_flight_and_count_roll(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} lead"])
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        slider = open_capstan(page)
        page.keyboard.press("Shift+ArrowRight")
        region = page.get_by_role("region", name="Sprocket strip")
        tray = page.get_by_role("complementary", name="Cluster tray")
        count = page.get_by_label("Item count", exact=True)
        shows(page, count, "1 items")
        settled_strip_band(page)
        strip = region.bounding_box()
        with held(page, STILLS_GLOB) as gate:
            page.keyboard.press("p")
            tracks, _ = film(page, [region.element_handle(), tray.element_handle()], FLIGHT_MAX_MS + MOTION_TAIL_MS, media=True)
            slot = _visual_box(page.get_by_role("list", name="Cluster order").get_by_role("listitem").nth(1))
            trips = flights(tracks, strip, slot)
            assert trips and any(in_range(duration(tr), FLIGHT_MIN_MS, FLIGHT_MAX_MS) for tr in trips), [duration(tr) for tr in trips]
            with page.expect_response(STILLS_GLOB):
                gate.release()
        shows(page, count, "2 items")
        focused(page, slider)


def test_pluck_announcements_and_focus(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} lead"])
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        slider = open_capstan(page)
        slider.focus()
        page.keyboard.press("Home")
        _shows_frame(page, slider, 0)
        page.keyboard.press("ArrowRight")
        tc = timecode(1, CAPSTAN_FPS)
        _shows_frame(page, slider, 1)
        with held(page, STILLS_GLOB) as gate:
            page.keyboard.press("p")
            shows(page, live(page, "Tray announcements"), f"Saving frame {tc}...")
            gate.release()
        shows(page, live(page, "Tray announcements"), f"Plucked {tc} from {CAPSTAN}. {n_items(2)} in {c['title']}.")
        focused(page, slider)
        page.keyboard.press("ArrowRight")
        _shows_frame(page, slider, 2)
        eventually(page, lambda: expect(page.get_by_role("button", name="Pluck frame")).to_be_enabled(timeout=CHECK_MS))
        page.get_by_role("button", name="Pluck frame").click()
        shows(page, live(page, "Tray announcements"), f"Plucked 00:00:00:02 from {CAPSTAN}. 3 items in {c['title']}.")
        focused(page, slider)
        assert status(juno, c["id"], "in_review").status_code == 200
        assert status(juno, c["id"], "embargoed", FUTURE_LIFT).status_code == 200
        eventually(page, lambda: expect(page.get_by_role("button", name="Pluck frame")).to_be_enabled(timeout=CHECK_MS))
        page.keyboard.press("p")
        shows(page, live(page, "Tray announcements"), f"{c['title']} is locked and cannot take new items.")
        focused(page, slider)
    assert cluster(juno, c["id"])["itemCount"] == 3


def test_wf_frame_pluck_keyboard(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} a", f"{tag()} b"])
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        page.get_by_role("button", name=f"Open clip {CAPSTAN}", exact=True).focus()
        page.keyboard.press("Enter")
        slider = page.get_by_role("slider", name="Playhead")
        focused(page, slider)
        slider.focus()
        page.keyboard.press("Home")
        _shows_frame(page, slider, 0)
        for key, frame in (("Shift+ArrowRight", CAPSTAN_FPS), ("ArrowRight", CAPSTAN_FPS + 1), ("ArrowRight", CAPSTAN_FPS + 2)):
            page.keyboard.press(key)
            _shows_frame(page, slider, frame)
        page.keyboard.press("p")
        shows(page, page.get_by_label("Item count"), "3 items")
        page.reload()
        item = page.get_by_role("list", name="Cluster order").get_by_role("listitem").nth(2)
        eventually(page, lambda: _equal(reads_as(item, f"{CAPSTAN} · {timecode(CAPSTAN_FPS + 2, CAPSTAN_FPS)}"), True))
        eventually(page, lambda: _equal(slot_shown(item, 3), True))
    last = sorted(cluster(juno, c["id"])["entries"], key=lambda e: e["position"])[-1]
    assert last["position"] == 3 and last["reference"]["timecode"] == timecode(CAPSTAN_FPS + 2, CAPSTAN_FPS) and last["reference"]["frameIndex"] == CAPSTAN_FPS + 2
    assert S3().get(f"references/northvale/{last['reference']['id']}.png")[:8] == PNG_SIG


def test_wf_frame_pluck_storage_down(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} lead"])
    down = urls(app_url)["minio-down"]
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        def reroute(route: Any) -> None:
            headers = {k: v for k, v in route.request.all_headers().items() if k.lower() not in ("origin", "host", "referer")}
            route.continue_(url=down + urlparse(route.request.url).path, headers=headers)
        choose_tray(page, c["title"])
        slider = open_capstan(page)
        page.keyboard.press("End")
        _shows_frame(page, slider, CAPSTAN_FRAMES - 1)
        page.route(STILLS_GLOB, reroute)
        page.keyboard.press("p")
        shows(page, live(page, "Tray announcements"), f"Storage is unreachable. Frame 00:00:01:24 was not saved and {c['title']} is unchanged.")
        focused(page, slider)
        shows(page, page.get_by_label("Item count"), "1 items")
        eventually(page, lambda: expect(page.get_by_role("list", name="Cluster order").get_by_role("listitem")).to_have_count(1, timeout=CHECK_MS))
        assert cluster(juno, c["id"])["itemCount"] == 1
        bucket_matches_rows(juno, "northvale")
        page.unroute(STILLS_GLOB)
        eventually(page, lambda: expect(page.get_by_role("button", name="Pluck frame")).to_be_enabled(timeout=CHECK_MS))
        page.keyboard.press("p")
        shows(page, live(page, "Tray announcements"), f"Plucked 00:00:01:24 from {CAPSTAN}. 2 items in {c['title']}.")
    assert cluster(juno, c["id"])["itemCount"] == 2


def touch_drag(page: Page, xs: list[float], y: float, slider: Locator, expected: list[int]) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": xs[0], "y": y}]})
    for x, frame in zip(xs, expected):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
        eventually(page, lambda: _equal(slider_value(slider), frame))
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def test_wf_frame_pluck_touch(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} lead"])
    with screen(browser, app_url, "/w/northvale", JUNO, 375, 812) as page:
        choose_tray(page, c["title"])
        slider = open_capstan(page)
        band = settled_strip_band(page)
        before = page.evaluate("() => [scrollX, scrollY, visualViewport.scale]")
        frames = [3, 18, 40, 12]
        touch_drag(page, [frame_x(band, f, CAPSTAN_FRAMES) for f in frames], band["y"], slider, frames)
        assert page.evaluate("() => [scrollX, scrollY, visualViewport.scale]") == before
        page.get_by_role("button", name="Pluck frame").tap()
        bar = page.get_by_role("button", name=re.compile(r"^Cluster tray: "))
        shows(page, bar, re.compile(re.escape(f"{c['title']} · 2 items")))
        focused(page, slider)
    last = max(cluster(juno, c["id"])["entries"], key=lambda e: e["position"])
    assert last["reference"]["frameIndex"] == 12


def lift_item(page: Page, title: str) -> Locator:
    handle = page.get_by_role("button", name=f"Reorder {title}", exact=True)
    handle.focus()
    page.keyboard.press("Space")
    return handle


def test_keyboard_reorder(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    titles = [f"{t} A", f"{t} B", f"{t} C", f"{t} D"]
    c, _ = ordered_cluster(juno, "northvale", titles)
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        tray = live(page, "Tray announcements")
        handle = lift_item(page, titles[2])
        shows(page, tray, f"Lifted {titles[2]}, position 3 of 4. Use arrow keys to move, Space to drop, Escape to cancel.")
        page.keyboard.press("ArrowUp")
        shows(page, tray, f"{titles[2]}, position 2 of 4.")
        page.keyboard.press("ArrowUp")
        shows(page, tray, f"{titles[2]}, position 1 of 4.")
        page.keyboard.press("Space")
        shows(page, tray, f"Moved {titles[2]} to position 1 of 4. Order saved.")
        focused(page, handle)
        handle = lift_item(page, titles[3])
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Escape")
        shows(page, tray, f"Move cancelled. {titles[3]} is back at position 4 of 4.")
        focused(page, handle)
        expected = [titles[2], titles[0], titles[1], titles[3]]
        eventually(page, lambda: _equal(tray_order(page), expected))
        page.reload()
        eventually(page, lambda: _equal(tray_order(page), expected))
    assert entry_titles(cluster(juno, c["id"])) == expected


def test_drag_reorder(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    titles = [f"{t} A", f"{t} B", f"{t} C", f"{t} D"]
    c, _ = ordered_cluster(juno, "northvale", titles)
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        eventually(page, lambda: _equal(tray_order(page), titles))
        src = page.get_by_role("button", name=f"Reorder {titles[3]}", exact=True).bounding_box()
        dst = page.get_by_role("button", name=f"Reorder {titles[0]}", exact=True).bounding_box()
        with held(page, f"**/api/clusters/{c['id']}/entries/*/move") as gate:
            page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
            page.mouse.down()
            for step in range(1, 9):
                page.mouse.move(dst["x"] + dst["width"] / 2, src["y"] + (dst["y"] + 2 - src["y"]) * step / 8)
                advance(page, STEP_MS)
            page.mouse.up()
            eventually(page, lambda: _equal(tray_order(page), [titles[3]] + titles[:3]))
            gate.release()
        shows(page, live(page, "Tray announcements"), f"Moved {titles[3]} to position 1 of 4. Order saved.")
    assert entry_titles(cluster(juno, c["id"])) == [titles[3]] + titles[:3]


def test_concurrent_order_changes(app_url: str) -> None:
    juno = signin(app_url, JUNO)
    every = urls(app_url)
    apis = {k: signin(v, JUNO) for k, v in every.items()}
    c = new_cluster(juno, "northvale")
    refs = [new_image(juno, "northvale", f"{tag()} add") for _ in range(6)]
    pool = list(apis.values())
    adds = together([lambda a=pool[i % 4], r=r: a.post(f"/api/clusters/{c['id']}/entries", json={"referenceId": r["id"], "isPrivate": False}) for i, r in enumerate(refs)])
    assert all(r.status_code == 201 for r in adds), [r.text for r in adds]
    assert sorted(r.json()["entry"]["position"] for r in adds) == list(range(1, 7))
    storage = [apis["primary"], apis["mailpit-down"], apis["killbill-down"]]
    clip = capstan(juno)
    plucks = together([lambda a=storage[i % 3], f=f: pluck(a, "northvale", clip["id"], c["id"], f) for i, f in enumerate([1, 2, 3, 4])])
    assert all(r.status_code == 201 for r in plucks), [r.text for r in plucks]
    assert sorted(r.json()["entry"]["position"] for r in plucks) == list(range(7, 11))
    now_c = cluster(juno, c["id"])
    assert sorted(e["position"] for e in now_c["entries"]) == list(range(1, 11)) and now_c["itemCount"] == 10 and now_c["version"] == 11
    entries = sorted(now_c["entries"], key=lambda e: e["position"])
    moves = together([lambda a=pool[i % 4], e=entries[i + 4]: a.post(f"/api/clusters/{c['id']}/entries/{e['id']}/move", json={"toPosition": 1, "version": now_c["version"]}) for i in range(5)])
    winners = [r for r in moves if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in moves]
    win = winners[0].json()
    for r in moves:
        if r.status_code != 200:
            body = err(r, 412, "stale_order")
            assert body["version"] == win["version"] and body["entryIds"] == win["entryIds"]
    final = cluster(juno, c["id"])
    assert [e["id"] for e in sorted(final["entries"], key=lambda e: e["position"])] == win["entryIds"] and final["version"] == now_c["version"] + 1
    field_err(juno.post(f"/api/clusters/{c['id']}/entries/{entries[0]['id']}/move", json={"toPosition": 11, "version": final["version"]}), "toPosition", "Choose a position from 1 to 10.")


def csv_cell(value: str, guard: bool) -> str:
    if guard and value and value[0] in "=+-@\t\r\n＝＋－＠":
        value = "'" + value
    if any(ch in value for ch in ',"\r\n'):
        value = '"' + value.replace('"', '""') + '"'
    return value


CSV_TITLES = ['=HYPERLINK("http://x","y")', 'Rope, "coil"', "-12 minus", "@sum", "+plus", "\tTab", "＝full", "＋full", "－full", "＠full", "\nline", "plain 'q'"]


def test_cluster_sheet_export(app_url: str) -> None:
    sam = signin(app_url, SAM)
    c, refs = ordered_cluster(sam, "kesto", CSV_TITLES)
    clip = new_clip(sam, "kesto", "=clip")
    still = pluck(sam, "kesto", clip["id"], c["id"], 5).json()["reference"]
    entries = sorted(cluster(sam, c["id"])["entries"], key=lambda e: e["position"])
    sam.ok("PATCH", f"/api/clusters/{c['id']}/entries/{entries[1]['id']}", 200, json={"isPrivate": True})
    sam.ok("POST", f"/api/clusters/{c['id']}/entries/{entries[-1]['id']}/move", 200, json={"toPosition": 1, "version": cluster(sam, c["id"])["version"]})
    other = new_cluster(sam, "kesto")
    add(sam, other["id"], new_image(sam, "kesto", f"{tag()} elsewhere")["id"])
    r = sam.get(f"/api/clusters/{c['id']}/export.csv")
    assert r.status_code == 200
    assert r.headers["Content-Type"].replace(" ", "").lower() == "text/csv; charset=utf-8".replace(" ", "")
    assert r.headers["Content-Disposition"] == f'attachment; filename="cluster-{c["id"]}.csv"'
    assert not r.content.startswith(b"\xef\xbb\xbf")
    lines = ["position,title,kind,source_clip,timecode,private"]
    for e in sorted(cluster(sam, c["id"])["entries"], key=lambda e: e["position"]):
        ref = e["reference"]
        is_still = ref["kind"] == "still"
        lines.append(",".join([str(e["position"]), csv_cell(ref["title"], True), ref["kind"],
                               csv_cell(ref["sourceClipTitle"] if is_still else "", True),
                               ref["timecode"] if is_still else "", "yes" if e["isPrivate"] else "no"]))
    assert r.content.decode("utf-8") == "\r\n".join(lines) + "\r\n"
    assert '"\'=HYPERLINK(""http://x"",""y"")"' in r.text and '"Rope, ""coil"""' in r.text
    assert still["id"] and "elsewhere" not in r.text


def test_wf_cluster_order_presentation(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    titles = [f"{t} IMG_0101", f"{t} IMG_0102", f"-{t} minus", f"{t} IMG_0104"]
    c, _ = ordered_cluster(juno, "northvale", titles)
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        handle = lift_item(page, titles[3])
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Space")
        shows(page, live(page, "Tray announcements"), f"Moved {titles[3]} to position 2 of 4. Order saved.")
        src = page.get_by_role("button", name=f"Reorder {titles[2]}", exact=True).bounding_box()
        dst = page.get_by_role("button", name=f"Reorder {titles[0]}", exact=True).bounding_box()
        page.mouse.move(src["x"] + src["width"] / 2, src["y"] + src["height"] / 2)
        page.mouse.down()
        for step in range(1, 9):
            page.mouse.move(dst["x"] + dst["width"] / 2, src["y"] + (dst["y"] + 2 - src["y"]) * step / 8)
            advance(page, STEP_MS)
        page.mouse.up()
        shows(page, live(page, "Tray announcements"), f"Moved {titles[2]} to position 1 of 4. Order saved.")
        expected = [titles[2], titles[0], titles[3], titles[1]]
        page.reload()
        eventually(page, lambda: _equal(tray_order(page), expected))
        page.goto(app_url.rstrip("/") + f"/w/northvale/clusters/{c['id']}")
        with page.expect_download() as download:
            page.get_by_role("link", name="Download cluster sheet").click()
        sheet = Path(download.value.path()).read_bytes().decode("utf-8")
    assert entry_titles(cluster(juno, c["id"])) == expected
    rows = sheet.split("\r\n")[1:-1]
    assert [r.split(",")[1] for r in rows] == [csv_cell(x, True) for x in expected]
    assert handle is not None


def test_wf_cluster_order_locked(browser: Browser, app_url: str) -> None:
    juno, ines = signin(app_url, JUNO), signin(app_url, INES)
    t = tag()
    titles = [f"{t} A", f"{t} B", f"{t} C"]
    c, _ = ordered_cluster(juno, "northvale", titles)
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        eventually(page, lambda: _equal(tray_order(page), titles))
        assert status(ines, c["id"], "in_review").status_code == 200
        assert status(ines, c["id"], "embargoed", FUTURE_LIFT).status_code == 200
        handle = lift_item(page, titles[2])
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Space")
        shows(page, live(page, "Tray announcements"), f"{c['title']} is locked while Embargoed. The order is unchanged.")
        eventually(page, lambda: _equal(tray_order(page), titles))
        focused(page, handle)
    assert entry_titles(cluster(juno, c["id"])) == titles


def test_wf_cluster_order_stale(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    titles = [f"{t} A", f"{t} B", f"{t} C"]
    c, _ = ordered_cluster(juno, "northvale", titles)
    with screen(browser, app_url, "/w/northvale", JUNO) as page:
        choose_tray(page, c["title"])
        eventually(page, lambda: _equal(tray_order(page), titles))
        last = sorted(c["entries"], key=lambda e: e["position"])[2]
        win = juno.ok("POST", f"/api/clusters/{c['id']}/entries/{last['id']}/move", 200, json={"toPosition": 1, "version": c["version"]})
        server = [titles[2], titles[0], titles[1]]
        handle = lift_item(page, titles[1])
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Space")
        shows(page, live(page, "Tray announcements"), "The order changed elsewhere. Showing the latest order.")
        eventually(page, lambda: _equal(tray_order(page), server))
        focused(page, handle)
    final = cluster(juno, c["id"])
    assert entry_titles(final) == server and final["version"] == win["version"]


def test_wf_cluster_order_phone(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    t = tag()
    titles = [f"{t} A", f"{t} B"]
    c, _ = ordered_cluster(juno, "northvale", titles)
    with screen(browser, app_url, "/w/northvale", JUNO, 375, 812) as page:
        choose_tray(page, c["title"])
        bar = page.get_by_role("button", name=re.compile(r"^Cluster tray: "))
        box = bar.bounding_box()
        assert box["y"] + box["height"] >= 812 / 2
        assert box["width"] >= 44 and box["height"] >= 44
        bar.click()
        advance(page, PANEL_MAX_MS)
        expect(bar).to_have_attribute("aria-expanded", "true")
        handle = lift_item(page, titles[1])
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        shows(page, live(page, "Tray announcements"), f"Moved {titles[1]} to position 1 of 2. Order saved.")
        focused(page, handle)
    assert entry_titles(cluster(juno, c["id"])) == [titles[1], titles[0]]


def review_cluster(api: Api, n: int = 2) -> tuple[dict, list[dict]]:
    c, refs = ordered_cluster(api, "northvale", [f"{tag()} r{i}" for i in range(n)])
    assert status(api, c["id"], "in_review").status_code == 200
    return cluster(api, c["id"]), refs


def make_link(api: Api, cid: str, email: str, expires: dt.datetime | None = None, comment: bool = True) -> dict:
    return api.ok("POST", f"/api/clusters/{cid}/review-links", 201, json={"email": email, "expiresAt": iso(expires or now() + dt.timedelta(days=1)), "canComment": comment})


def test_review_link_invite(app_url: str, mail: Any) -> None:
    tomas, ola = signin(app_url, TOMAS), signin(app_url, OLA)
    c, _ = review_cluster(tomas)
    sibling, _ = review_cluster(tomas)
    _, email, _ = person("freelancer")
    link = make_link(tomas, c["id"], email)
    assert {"id", "email", "url", "expiresAt", "canComment"} <= set(link) and link["email"] == email and link["canComment"] is True
    assert urlparse(link["url"]).netloc and urlparse(link["url"]).path == f"/review/{review_token(link['url'])}"
    msgs = inbox(mail, email, f"Review {c['title']} for Northvale")
    assert len(msgs) == 1 and link["url"] in email_body(msgs[0]) and sibling["title"] not in email_body(msgs[0])
    assert any(l["id"] == link["id"] and l["state"] == "live" for l in tomas.ok("GET", f"/api/clusters/{c['id']}/review-links", 200)["links"])
    field_err(tomas.post(f"/api/clusters/{c['id']}/review-links", json={"email": email, "expiresAt": iso(now() - dt.timedelta(hours=1)), "canComment": True}), "expiresAt", "Choose a time in the future.")
    field_err(tomas.post(f"/api/clusters/{c['id']}/review-links", json={"email": email, "expiresAt": iso(now() + dt.timedelta(days=EXPIRY_MAX_DAYS + 1)), "canComment": True}), "expiresAt", "Choose an expiry within the next 30 days.")
    field_err(tomas.post(f"/api/clusters/{c['id']}/review-links", json={"email": "nope", "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": True}), "email", "Enter a valid email address.")
    make_link(tomas, c["id"], person("edge")[1], now() + dt.timedelta(days=EXPIRY_MAX_DAYS - 1))
    draft = new_cluster(tomas, "northvale")
    err(tomas.post(f"/api/clusters/{draft['id']}/review-links", json={"email": email, "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": True}), 409, "cluster_not_in_review")
    err(ola.post(f"/api/clusters/{c['id']}/review-links", json={"email": email, "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": True}), 403, "seat_required")
    _, lost, _ = person("mailless")
    down = signin(urls(app_url)["mailpit-down"], TOMAS)
    r = down.post(f"/api/clusters/{c['id']}/review-links", json={"email": lost, "expiresAt": iso(now() + dt.timedelta(days=1)), "canComment": True})
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable", "message": "Mail is unreachable."}
    assert lost not in [l["email"] for l in tomas.ok("GET", f"/api/clusters/{c['id']}/review-links", 200)["links"]]
    assert inbox(mail, lost, seconds=NO_MAIL_S) == []


def test_review_link_scope(app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, refs = review_cluster(tomas, 2)
    sibling, srefs = review_cluster(tomas, 1)
    link = make_link(tomas, c["id"], person("scope")[1])
    token = review_token(link["url"])
    anon = Api(app_url)
    r = anon.get(f"/api/review/{token}")
    assert r.status_code == 200 and "rushes_session" not in r.cookies
    body = r.json()
    assert set(body) == {"cluster", "comments", "link"} and set(body["cluster"]) == {"title", "publicDescription", "itemCount", "entries"}
    assert set(body["link"]) == {"expiresAt", "canComment"}
    for e in body["cluster"]["entries"]:
        assert set(e) == {"id", "position", "title", "kind", "mediaUrl", "timecode", "sourceClipTitle", "isPrivate"}
    assert [e["title"] for e in body["cluster"]["entries"]] == [x["title"] for x in refs]
    assert body["cluster"]["entries"][0]["mediaUrl"] == f"/media/{refs[0]['id']}?review={token}"
    assert anon.get(body["cluster"]["entries"][0]["mediaUrl"]).status_code == 200
    err(anon.get(f"/media/{srefs[0]['id']}?review={token}"), 404, "not_found")
    err(anon.get(f"/media/{refs[0]['id']}"), 404, "not_found")
    for path in (f"/api/clusters/{c['id']}", f"/api/clusters/{sibling['id']}/comments", wsp(NV, "/references"), wsp(NV, "/search")):
        err(anon.get(path), 401, "unauthenticated")
    tomas.ok("DELETE", f"/api/clusters/{c['id']}/entries/{c['entries'][1]['id']}", 200)
    err(anon.get(f"/media/{refs[1]['id']}?review={token}"), 404, "not_found")
    seeded = anon.ok("GET", f"/api/review/{SEED_TOKEN}", 200)
    assert seeded["cluster"]["title"] == "SS27 Harbour Lights"
    assert [e["title"] for e in seeded["cluster"]["entries"]] == ["Harbour sodium light", "Net mender's hands"]
    err(anon.get(f"/api/review/{tag()}"), 404, "not_found")


def test_review_link_expiry(app_url: str, mail: Any) -> None:
    tomas = signin(app_url, TOMAS)
    c, refs = review_cluster(tomas, 1)
    _, email, _ = person("expiry")
    expires = now() + dt.timedelta(seconds=LIFT_LEAD_S)
    link = make_link(tomas, c["id"], email, expires)
    token = review_token(link["url"])
    anon = Api(app_url)
    last_ok = now()
    assert anon.get(f"/api/review/{token}").status_code == 200
    assert anon.get(f"/media/{refs[0]['id']}?review={token}").status_code == 200

    def refused() -> httpx.Response | None:
        nonlocal last_ok
        started = now()
        r = anon.get(f"/api/review/{token}")
        if r.status_code == 200:
            last_ok = started
            return None
        return r

    r = wait_for(refused, WAIT_S, "expiry")
    first_refused = now()
    err(r, 410, "link_expired")
    assert last_ok <= expires + dt.timedelta(milliseconds=CLOCK_SKEW_MS)
    assert first_refused >= expires - dt.timedelta(milliseconds=CLOCK_SKEW_MS)
    err(anon.get(f"/media/{refs[0]['id']}?review={token}"), 404, "not_found")
    err(anon.post(f"/api/review/{token}/comments", json={"authorName": "Ren", "body": "late"}), 410, "link_expired")
    assert next(l for l in tomas.ok("GET", f"/api/clusters/{c['id']}/review-links", 200)["links"] if l["id"] == link["id"])["state"] == "expired"
    err(tomas.post(f"/api/review-links/{link['id']}/regenerate"), 410, "link_expired")
    assert len(inbox(mail, email, at_least=2, seconds=NO_MAIL_S)) == 1


def test_revoke_regenerate_offboard(app_url: str, mail: Any) -> None:
    tomas, juno, mara = signin(app_url, TOMAS), signin(app_url, JUNO), signin(app_url, MARA)
    anon = Api(app_url)
    c, refs = review_cluster(tomas, 1)
    _, email, _ = person("regen")
    link = make_link(tomas, c["id"], email)
    old = review_token(link["url"])
    err(signin(urls(app_url)["mailpit-down"], TOMAS).post(f"/api/review-links/{link['id']}/regenerate"), 503, "mail_unavailable")
    assert anon.get(f"/api/review/{old}").status_code == 200
    fresh = tomas.ok("POST", f"/api/review-links/{link['id']}/regenerate", 200)
    new = review_token(fresh["url"])
    assert new != old and fresh["email"] == email and fresh["expiresAt"] == link["expiresAt"] and fresh["canComment"] == link["canComment"]
    msgs = inbox(mail, email, f"Review {c['title']} for Northvale", at_least=2)
    assert len(msgs) == 2 and any(fresh["url"] in email_body(m) for m in msgs)
    err(anon.get(f"/api/review/{old}"), 410, "link_revoked")
    err(anon.get(f"/media/{refs[0]['id']}?review={old}"), 404, "not_found")
    assert anon.get(f"/media/{refs[0]['id']}?review={new}").status_code == 200
    tomas.ok("DELETE", f"/api/review-links/{fresh['id']}", 204)
    err(anon.get(f"/api/review/{new}"), 410, "link_revoked")
    err(anon.get(f"/media/{refs[0]['id']}?review={new}"), 404, "not_found")
    err(tomas.post(f"/api/review-links/{fresh['id']}/regenerate"), 410, "link_revoked")
    _, contractor, _ = person("offboard")
    c2, _ = review_cluster(tomas, 1)
    a = make_link(tomas, c["id"], contractor)
    b = make_link(tomas, c2["id"], contractor)
    err(juno.post(wsp(NV, "/collaborators/offboard"), json={"email": contractor}), 403, "forbidden")
    field_err(mara.post(wsp(NV, "/collaborators/offboard"), json={"email": "nope"}), "email", "Enter a valid email address.")
    assert mara.ok("POST", wsp(NV, "/collaborators/offboard"), 200, json={"email": contractor}) == {"email": contractor, "revoked": 2}
    for l in (a, b):
        err(anon.get(f"/api/review/{review_token(l['url'])}"), 410, "link_revoked")
    c3, refs3 = review_cluster(tomas, 1)
    l3 = make_link(tomas, c3["id"], person("inactive")[1])
    assert status(tomas, c3["id"], "draft").status_code == 200
    err(anon.get(f"/api/review/{review_token(l3['url'])}"), 410, "link_inactive")
    assert status(tomas, c3["id"], "in_review").status_code == 200
    err(anon.get(f"/api/review/{review_token(l3['url'])}"), 410, "link_inactive")
    err(anon.get(f"/media/{refs3[0]['id']}?review={review_token(l3['url'])}"), 404, "not_found")
    err(tomas.post(f"/api/review-links/{l3['id']}/regenerate"), 410, "link_inactive")


def test_read_only_review_link(app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    link = make_link(tomas, c["id"], person("viewer")[1], comment=False)
    token = review_token(link["url"])
    anon = Api(app_url)
    assert anon.ok("GET", f"/api/review/{token}", 200)["link"]["canComment"] is False
    body = f"{tag()} sneaky"
    r = anon.post(f"/api/review/{token}/comments", json={"authorName": "Ren", "body": body})
    assert r.status_code == 403 and r.json() == {"error": "read_only_link", "message": "This review link is view-only."}
    err(anon.post(f"/api/review/{token}/comments", json={"authorName": "", "body": ""}), 403, "read_only_link")
    assert body not in json.dumps(tomas.ok("GET", f"/api/clusters/{c['id']}/comments", 200))


def test_review_comment_rate_limit(app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    _, email, _ = person("chatty")
    link = make_link(tomas, c["id"], email)
    hosts = [Api(urls(app_url)["primary"]), Api(urls(app_url)["mailpit-down"])]
    token = review_token(link["url"])
    send = lambda i, body: hosts[i % 2].post(f"/api/review/{token}/comments", json={"authorName": "Ren", "body": body})
    first_start = now()
    k = send(0, "one").json()
    first_end = now()
    assert {"id", "authorName", "body", "createdAt"} <= set(k)
    for i, b in enumerate(["two", "three", "four"], start=1):
        assert send(i, b).status_code == 201
    field_err(send(0, ""), "body", "Write a comment of 1 to 2000 characters.")
    assert send(1, "five").status_code == 201
    sixth_start = now()
    r = send(0, "six")
    sixth_end = now()
    body = err(r, 429, "rate_limited")
    s = body["retryAfter"]
    assert isinstance(s, int) and 1 <= s <= COMMENT_WINDOW_S and r.headers["Retry-After"] == str(s)
    lo = (first_start + dt.timedelta(seconds=COMMENT_WINDOW_S) - sixth_end).total_seconds()
    hi = (first_end + dt.timedelta(seconds=COMMENT_WINDOW_S) - sixth_start).total_seconds()
    assert max(1, math.ceil(lo)) <= s <= min(COMMENT_WINDOW_S, math.ceil(hi))
    again = make_link(tomas, c["id"], email)
    err(Api(app_url).post(f"/api/review/{review_token(again['url'])}/comments", json={"authorName": "Ren", "body": "seven"}), 429, "rate_limited")
    other = make_link(tomas, c["id"], person("calm")[1])
    assert Api(app_url).post(f"/api/review/{review_token(other['url'])}/comments", json={"authorName": "Kai", "body": "hi"}).status_code == 201
    for i in range(COMMENT_LIMIT + 1):
        tomas.ok("POST", f"/api/clusters/{c['id']}/comments", 201, json={"body": f"designer {i}"})
    wait_clock(sixth_end + dt.timedelta(seconds=s))
    assert send(0, "after the wait").status_code == 201


def test_wf_freelancer_review_happy(browser: Browser, app_url: str, mail: Any) -> None:
    tomas = signin(app_url, TOMAS)
    c, refs = review_cluster(tomas, 2)
    _, email, _ = person("ren")
    day = (now() + dt.timedelta(days=1)).strftime("%Y-%m-%d")
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", TOMAS) as page:
        page.get_by_role("textbox", name="Freelancer email").fill(email)
        page.get_by_label("Expires").fill(f"{day}T18:30")
        check(page.get_by_role("checkbox", name="Allow comments"))
        expect(page.get_by_text("Expiry times are in UTC")).to_be_visible()
        page.get_by_role("button", name="Create review link").click()
        shows(page, live(page, "Cluster status"), f"Review link sent to {email}.")
        appears(page, page.get_by_role("button", name=f"Revoke link for {email}"))
    link = next(l for l in tomas.ok("GET", f"/api/clusters/{c['id']}/review-links", 200)["links"] if l["email"] == email)
    assert link["expiresAt"] == f"{day}T18:30:00.000Z" and link["state"] == "live"
    url = link_in(email_body(inbox(mail, email)[0]), "/review/", app_url)
    comment = f"{tag()} tighten the crop"
    with screen(browser, app_url, urlparse(url).path) as page:
        appears(page, page.get_by_text(f"Review: {c['title']} · expires {day} 18:30 UTC"))
        def check_order() -> None:
            snapshot = page.locator("body").aria_snapshot()
            positions = [snapshot.find(ref["title"]) for ref in refs]
            assert all(position >= 0 for position in positions), snapshot
            assert positions == sorted(positions)
        eventually(page, check_order)
        page.get_by_role("textbox", name="Your name").fill("Ren")
        page.get_by_role("textbox", name="Comment").fill(comment)
        page.get_by_role("button", name="Post comment").click()
        shows(page, live(page, "Review status"), "Comment posted.")
        expect(page.get_by_role("textbox", name="Comment")).to_have_value("")
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", TOMAS) as page:
        appears(page, page.get_by_role("region", name="Comments").get_by_text(comment))
    assert comment in [k["body"] for k in tomas.ok("GET", f"/api/clusters/{c['id']}/comments", 200)["comments"]]


def test_wf_freelancer_review_regenerate(browser: Browser, app_url: str, mail: Any) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    _, email, _ = person("regen-ui")
    link = make_link(tomas, c["id"], email)
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", TOMAS) as page:
        page.get_by_role("button", name=f"Regenerate link for {email}").click()
        shows(page, live(page, "Cluster status"), f"New link sent to {email}. The old link no longer works.")
    newest = [m for m in inbox(mail, email, at_least=2) if link["url"] not in email_body(m)]
    fresh = link_in(email_body(newest[0]), "/review/", app_url)
    with screen(browser, app_url, urlparse(link["url"]).path) as page:
        appears(page, page.get_by_role("heading", name="This review link was revoked."))
        page.goto(app_url.rstrip("/") + urlparse(fresh).path)
        appears(page, page.get_by_text(re.compile(re.escape(f"Review: {c['title']} · expires "))))


def test_wf_freelancer_review_rate_limit(browser: Browser, app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    link = make_link(tomas, c["id"], person("fast")[1])
    with screen(browser, app_url, urlparse(link["url"]).path) as page:
        name, box, post = page.get_by_role("textbox", name="Your name"), page.get_by_role("textbox", name="Comment"), page.get_by_role("button", name="Post comment")
        appears(page, box)
        author = "Ren"
        name.fill(author)
        for i in range(COMMENT_LIMIT):
            box.fill(f"note {i}")
            post.click()
            eventually(page, lambda: expect(box).to_have_value("", timeout=CHECK_MS))
            eventually(page, lambda: expect(post).to_be_enabled(timeout=CHECK_MS))
        waiting = "one too many"
        box.fill(waiting)
        post.click()
        pattern = re.compile(re.escape("You're commenting too fast. Try again in ") + r"(\d+)" + re.escape(" seconds.") + "$")
        notice = live(page, "Review status")
        expect(notice).to_have_text(pattern, timeout=WAIT_S * MS_PER_S)
        s = int(next(m for m in map(pattern.search, shown_texts(notice)) if m).group(1))
        assert 1 <= s <= COMMENT_WINDOW_S
        expect(box).to_have_value(waiting)
        expect(name).to_have_value(author)
        expect(post).to_be_disabled()
        advance(page, (s - 1) * MS_PER_S)
        expect(post).to_be_disabled()
        _equal(any(copy_matches(t, f"You're commenting too fast. Try again in {s} seconds.") for t in shown_texts(notice)), True)
        advance(page, 2 * MS_PER_S)
        eventually(page, lambda: expect(post).to_be_enabled(timeout=CHECK_MS))
        expect(box).to_have_value(waiting)


def test_wf_freelancer_review_device_clock(browser: Browser, app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    expires = now() + dt.timedelta(seconds=UI_LIFT_LEAD_S)
    link = make_link(tomas, c["id"], person("clock")[1], expires)
    with screen(browser, app_url, "/api/health") as page:
        page.clock.set_system_time(now() + dt.timedelta(hours=DEVICE_SKEW_H))
        page.goto(link["url"].replace(urlparse(link["url"]).netloc, urlparse(app_url).netloc))
        appears(page, page.get_by_text(re.compile(re.escape(f"Review: {c['title']} · expires "))))
        page.get_by_role("textbox", name="Your name").fill("Ren")
        unsent = "typed before expiry"
        page.get_by_role("textbox", name="Comment").fill(unsent)
        wait_for(lambda: Api(app_url).get(f"/api/review/{review_token(link['url'])}").status_code == 410, WAIT_S, "expiry")
        page.get_by_role("button", name="Post comment").click()
        appears(page, page.get_by_role("heading", name="This review link has expired."))
        expect(page.get_by_role("region", name="Unsent comment")).to_contain_text(unsent)


def illegal(r: httpx.Response, frm: str, to: str) -> None:
    body = err(r, 409, "illegal_transition")
    assert body["from"] == frm and body["to"] == to


def test_status_edges(app_url: str) -> None:
    juno, ines, ola = signin(app_url, JUNO), signin(app_url, INES), signin(app_url, OLA)
    c = new_cluster(juno, "northvale")
    cid = c["id"]
    assert c["status"] == "draft" and c["version"] == 1 and c["owner"] == {"displayName": "Juno Park", "handle": "juno"}
    for to in ("draft", "embargoed", "public", "withdrawn"):
        illegal(status(juno, cid, to, FUTURE_LIFT if to == "embargoed" else None), "draft", to)
    err(status(ola, cid, "in_review"), 403, "seat_required")
    assert status(ines, cid, "in_review").json()["status"] == "in_review"
    for to in ("in_review", "public", "withdrawn"):
        illegal(status(juno, cid, to), "in_review", to)
    field_err(status(juno, cid, "embargoed"), "liftLocal", "Use a date and time like 2027-03-29T09:00.")
    back = status(ines, cid, "draft").json()
    assert back["status"] == "draft" and back["liftLocal"] is None and back["liftsAt"] is None
    status(juno, cid, "in_review")
    e = status(juno, cid, "embargoed", FUTURE_LIFT).json()
    assert e["status"] == "embargoed" and e["liftLocal"] == FUTURE_LIFT and e["liftsAt"] == FUTURE_LIFT_UTC and e["publishedAt"] is None
    for to in ("embargoed", "public", "draft", "withdrawn"):
        illegal(status(juno, cid, to, FUTURE_LIFT if to == "embargoed" else None), "embargoed", to)
    cancel = status(ines, cid, "in_review").json()
    assert cancel["status"] == "in_review" and cancel["liftLocal"] is None and cancel["liftsAt"] is None


def test_locked_cluster(app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, refs = ordered_cluster(juno, "northvale", [f"{tag()} a", f"{tag()} b"])
    extra = new_image(juno, "northvale", f"{tag()} extra")
    status(juno, c["id"], "in_review")
    status(juno, c["id"], "embargoed", FUTURE_LIFT)
    e0 = c["entries"][0]["id"]
    v = cluster(juno, c["id"])["version"]
    for r in (juno.post(f"/api/clusters/{c['id']}/entries", json={"referenceId": extra["id"], "isPrivate": False}),
              juno.patch(f"/api/clusters/{c['id']}/entries/{e0}", json={"isPrivate": True}),
              juno.delete(f"/api/clusters/{c['id']}/entries/{e0}"),
              juno.post(f"/api/clusters/{c['id']}/entries/{e0}/move", json={"toPosition": 2, "version": v}),
              juno.patch(f"/api/clusters/{c['id']}", json={"publicDescription": "changed"}),
              juno.delete(wsp(NV, f"/references/{refs[0]['id']}"))):
        assert r.status_code == 409 and r.json() == {"error": "cluster_locked", "message": "This cluster is locked."}, r.text
    assert cluster(juno, c["id"])["version"] == v
    new_title, new_note = f"{c['title']} v2", "note ok"
    renamed = juno.ok("PATCH", f"/api/clusters/{c['id']}", 200, json={"title": new_title, "internalNote": new_note})
    assert renamed["title"] == new_title and renamed["internalNote"] == new_note
    juno.ok("POST", f"/api/clusters/{c['id']}/comments", 201, json={"body": "still talking"})
    after = cluster(juno, c["id"])
    assert entry_titles(after) == [r["title"] for r in refs]


def test_withdrawal(app_url: str) -> None:
    juno, ines, sam = signin(app_url, JUNO), signin(app_url, INES), signin(app_url, SAM)
    mara_down = signin(urls(app_url)["minio-down"], MARA)
    c, refs = ordered_cluster(juno, "northvale", [f"{tag()} only here"])
    pub = wait_public(juno, c["id"], lift_soon(juno, c["id"], "Europe/London"))
    anon = Api(app_url)
    assert anon.get(f"/api/public/clusters/{c['id']}").status_code == 200 and anon.get(f"/media/{refs[0]['id']}").status_code == 200
    illegal(status(juno, c["id"], "in_review"), "public", "in_review")
    illegal(status(juno, c["id"], "public"), "public", "public")
    err(juno.post(f"/api/clusters/{c['id']}/entries", json={"referenceId": new_image(juno, "northvale", f"{tag()} x")["id"], "isPrivate": False}), 409, "cluster_locked")
    err(juno.post(f"/api/clusters/{c['id']}/entries/{pub['entries'][0]['id']}/move", json={"toPosition": 1, "version": pub["version"]}), 409, "cluster_locked")
    err(status(ines, c["id"], "withdrawn"), 403, "forbidden")
    err(status(sam, c["id"], "withdrawn"), 404, "not_found")
    results = together([lambda: status(juno, c["id"], "withdrawn"), lambda: status(mara_down, c["id"], "withdrawn")])
    assert sorted(r.status_code for r in results) == [200, 409]
    illegal(next(r for r in results if r.status_code == 409), "withdrawn", "withdrawn")
    for to in ("in_review", "draft", "public"):
        illegal(status(juno, c["id"], to), "withdrawn", to)
    after = cluster(juno, c["id"])
    assert after["status"] == "withdrawn" and after["liftsAt"] == pub["liftsAt"]
    err(anon.get(f"/api/public/clusters/{c['id']}"), 404, "not_found")
    err(anon.get(f"/media/{refs[0]['id']}"), 404, "not_found")
    assert c["id"] not in [x["id"] for x in anon.ok("GET", curator_path("juno"), 200)["clusters"]]
    assert c["id"] not in [f["id"] for f in feed_all(anon)]
    assert juno.get(f"/media/{refs[0]['id']}").status_code == 200


def test_one_status_winner(app_url: str) -> None:
    apis = [signin(u, JUNO) for u in urls(app_url).values()]
    for _ in range(3):
        c = new_cluster(apis[0], "northvale")
        status(apis[0], c["id"], "in_review")
        targets = ["draft", "embargoed", "draft", "embargoed"]
        results = together([lambda a=a, to=to: status(a, c["id"], to, FUTURE_LIFT if to == "embargoed" else None) for a, to in zip(apis, targets)])
        wins = [(to, r) for to, r in zip(targets, results) if r.status_code == 200]
        assert len(wins) == 1, [r.text for r in results]
        winner = wins[0][0]
        for to, r in zip(targets, results):
            if r.status_code != 200:
                illegal(r, winner, to)
        assert cluster(apis[0], c["id"])["status"] == winner


def test_settings_refresh_keeps_unsaved_work(browser: Browser, app_url: str) -> None:
    juno, ines = signin(app_url, JUNO), signin(app_url, INES)
    c, _ = review_cluster(juno, 1)
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", JUNO) as page:
        label = page.get_by_label("Status", exact=True)
        eventually(page, lambda: expect(label).to_contain_text("In review", timeout=CHECK_MS))
        reads: list[str] = []
        page.on("request", lambda r: reads.append(r.url) if r.method == "GET" and urlparse(r.url).path == f"/api/clusters/{c['id']}" else None)
        typed_title, typed_note, typed_comment = f"{c['title']} unsaved", "half a note", "half a comment"
        page.get_by_role("textbox", name="Title").fill(typed_title)
        page.get_by_role("textbox", name="Internal note").fill(typed_note)
        comment = page.get_by_role("textbox", name="Comment")
        comment.fill(typed_comment)
        assert status(ines, c["id"], "draft").status_code == 200
        advance(page, REFRESH_MS)
        eventually(page, lambda: expect(label).to_contain_text("Draft", timeout=CHECK_MS))
        assert reads
        expect(page.get_by_role("textbox", name="Title")).to_have_value(typed_title)
        expect(page.get_by_role("textbox", name="Internal note")).to_have_value(typed_note)
        expect(comment).to_have_value(typed_comment)
        expect(comment).to_be_focused()
        send = page.get_by_role("button", name="Send to review")
        pressable = page.get_by_role("button", name="Send to review", disabled=False)
        with held(page, f"**/api/clusters/{c['id']}/status") as gate:
            send.click()
            eventually(page, lambda: _equal(tag_shown(page, label, "Saving"), True))
            eventually(page, lambda: _equal(pressable.count(), 0))
            count = len(reads)
            advance(page, REFRESH_MS)
            eventually(page, lambda: _equal(len(reads) > count, True))
            assert pressable.count() == 0
            gate.release()
        shows(page, live(page, "Cluster status"), "Sent to review.")


def test_status_actions_roll_back_honestly(browser: Browser, app_url: str) -> None:
    juno, ines = signin(app_url, JUNO), signin(app_url, INES)
    c = new_cluster(juno, "northvale")
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", JUNO) as page:
        label = page.get_by_label("Status", exact=True)
        eventually(page, lambda: expect(label).to_contain_text("Draft", timeout=CHECK_MS))
        with held(page, f"**/api/clusters/{c['id']}/status") as gate:
            page.get_by_role("button", name="Send to review").click()
            eventually(page, lambda: expect(label).to_contain_text("In review", timeout=CHECK_MS))
            eventually(page, lambda: _equal(tag_shown(page, label, "Saving"), True))
            gate.release()
        shows(page, live(page, "Cluster status"), "Sent to review.")
        focused(page, label)
        read_url = re.compile(rf".*/api/clusters/{re.escape(c['id'])}(?:\?.*)?$")
        with held(page, read_url) as reads:
            assert status(ines, c["id"], "embargoed", FUTURE_LIFT).status_code == 200
            with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == f"/api/clusters/{c['id']}/status"):
                page.get_by_role("button", name="Back to draft").click()
            reads.release()
            shows(page, live(page, "Cluster status"), "This cluster is now Embargoed. Refresh to see its current state.")
            expect(label).to_contain_text("Embargoed")
            expect(page.get_by_role("button", name="Cancel embargo")).to_be_visible()
            expect(page.get_by_role("button", name="Back to draft")).to_have_count(0)
            focused(page, label)
        page.route(f"**/api/clusters/{c['id']}/status", lambda route: route.abort())
        page.get_by_role("button", name="Cancel embargo").click()
        shows(page, live(page, "Cluster status"), "The status change could not be saved. Try again.")
        eventually(page, lambda: expect(label).to_contain_text("Embargoed", timeout=CHECK_MS))
        eventually(page, lambda: _equal(tag_shown(page, label, "Saving"), False))
    assert cluster(juno, c["id"])["status"] == "embargoed"


def test_wf_cluster_lifecycle_create(browser: Browser, app_url: str) -> None:
    t = tag()
    with screen(browser, app_url, "/w/northvale", INES) as page:
        page.get_by_role("button", name="New cluster").click()
        dialog = page.get_by_role("dialog", name="New cluster")
        expect(dialog.get_by_role("heading", name=f"New cluster in {WS[NV][0]}")).to_be_visible()
        dialog.get_by_role("button", name="Create cluster").click()
        summary = page.get_by_role("alert", name="There is a problem")
        focused(page, summary)
        summary.get_by_role("link", name="Enter a title of 1 to 80 characters.").click()
        title = dialog.get_by_role("textbox", name="Title")
        focused(page, title)
        expect(title).to_have_attribute("aria-invalid", "true")
        title.fill(f"{t} lifecycle")
        desc, note = "Shown publicly", "Kept inside"
        dialog.get_by_role("textbox", name="Public description").fill(desc)
        dialog.get_by_role("textbox", name="Internal note").fill(note)
        dialog.get_by_role("button", name="Create cluster").click()
        eventually(page, lambda: _equal(bool(re.fullmatch(r"/w/northvale/clusters/[0-9a-f-]{36}", urlparse(page.url).path)), True))
        shows(page, live(page, "Cluster status"), f"Created {t} lifecycle as a draft.")
        label = page.get_by_label("Status", exact=True)
        expect(label).to_contain_text("Draft")
        page.get_by_role("button", name="Send to review").click()
        eventually(page, lambda: expect(label).to_contain_text("In review", timeout=CHECK_MS))
        shows(page, live(page, "Cluster status"), "Sent to review.")
        page.get_by_role("button", name="Back to draft").click()
        shows(page, live(page, "Cluster status"), "Back to draft. Review links are no longer active.")
        expect(label).to_contain_text("Draft")
        cid = urlparse(page.url).path.rsplit("/", 1)[1]
    c = cluster(signin(app_url, INES), cid)
    assert c["status"] == "draft" and c["owner"]["handle"] == "ines" and c["internalNote"] == note and c["publicDescription"] == desc


def test_wf_cluster_lifecycle_withdraw(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, "northvale", [f"{tag()} plate"])
    wait_public(juno, c["id"], lift_soon(juno, c["id"], "Europe/London"))
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", MARA) as page:
        label = page.get_by_label("Status", exact=True)
        eventually(page, lambda: expect(label).to_contain_text("Public", timeout=CHECK_MS))
        reads: list[str] = []
        refresh_paths = {f"/api/clusters/{c['id']}", f"/w/northvale/clusters/{c['id']}"}
        page.on("request", lambda r: reads.append(r.url) if r.method == "GET" and urlparse(r.url).path in refresh_paths else None)
        note = page.get_by_role("textbox", name="Internal note", include_hidden=True)
        typed = "unsaved note from Mara"
        note.fill(typed)
        page.get_by_role("button", name="Withdraw cluster").click()
        dialog = page.get_by_role("dialog", name="Withdraw cluster")
        appears(page, dialog)
        expect(dialog).to_contain_text("Withdrawing removes the public page and feed entry now.")
        advance(page, REFRESH_MS)
        eventually(page, lambda: _equal(bool(reads), True))
        advance(page, STEP_MS)
        expect(dialog).to_be_visible()
        expect(note).to_have_value(typed)
        dialog.get_by_role("button", name="Withdraw").click()
        shows(page, live(page, "Cluster status"), "Withdrawn. The public page is gone.")
        expect(label).to_contain_text("Withdrawn")
        page.goto(app_url.rstrip("/") + f"/c/{c['id']}")
        appears(page, page.get_by_role("heading", name="This page does not exist."))
    anon = Api(app_url)
    err(anon.get(f"/api/public/clusters/{c['id']}"), 404, "not_found")
    assert c["id"] not in [f["id"] for f in feed_all(anon)]
    assert c["id"] not in [x["id"] for x in anon.ok("GET", curator_path("juno"), 200)["clusters"]]


EMBARGO_CASES = [
    ("northvale", FUTURE_LIFT, FUTURE_LIFT_UTC, None),
    ("northvale", f"{AFTER_SPRING.isoformat()}T09:00", _utc_of(AFTER_SPRING, "09:00", 1), None),
    ("northvale", f"{LONDON_SPRING.isoformat()}T01:30", None, "That time does not exist in Europe/London on that date."),
    ("northvale", f"{LONDON_FALL.isoformat()}T01:30", _utc_of(LONDON_FALL, "01:30", 1), None),
    ("brisk-tonic", f"{(SYDNEY_END - dt.timedelta(days=2)).isoformat()}T09:00", _utc_of(SYDNEY_END - dt.timedelta(days=2), "09:00", 11), None),
    ("brisk-tonic", f"{(SYDNEY_END + dt.timedelta(days=1)).isoformat()}T09:00", _utc_of(SYDNEY_END + dt.timedelta(days=1), "09:00", 10), None),
    ("northvale", f"{AFTER_SPRING.isoformat()} 09:00", None, "Use a date and time like 2027-03-29T09:00."),
    ("northvale", "2020-01-06T09:00", None, "Choose a time in the future."),
]


def test_embargo_in_brand_time(app_url: str) -> None:
    owners = {"northvale": signin(app_url, JUNO), "brisk-tonic": signin(app_url, BEA)}
    for ws, local, instant, message in EMBARGO_CASES:
        api = owners[ws]
        c = new_cluster(api, ws)
        status(api, c["id"], "in_review")
        r = status(api, c["id"], "embargoed", local)
        if message:
            field_err(r, "liftLocal", message)
            assert cluster(api, c["id"])["status"] == "in_review"
            continue
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["timeZone"] == WS[ws][1] and body["liftLocal"] == local and body["liftsAt"] == instant and body["status"] == "embargoed"


def test_public_projection_of_seeded_cluster(browser: Browser, app_url: str) -> None:
    anon = Api(app_url)
    cid = feed_id("AW26 Night Shift", app_url)
    p = anon.ok("GET", f"/api/public/clusters/{cid}", 200)
    assert set(p) == {"id", "title", "publicDescription", "curator", "credits", "publishedAt", "publicItemCount", "items"}
    assert p["curator"] == {"displayName": "Juno Park", "handle": "juno"}
    assert p["credits"] == [{"displayName": "Juno Park", "handle": "juno"}, {"displayName": "Tomas Reyes", "handle": "tomas"}]
    assert p["publishedAt"] == "2026-10-01T08:00:00.000Z" and p["publicItemCount"] == 3
    assert [i["title"] for i in p["items"]] == ["Harbour sodium light", "Fog over slipway", "Oilskin fold"]
    assert [i["position"] for i in p["items"]] == [1, 2, 3]
    for item in p["items"]:
        assert set(item) == {"id", "position", "title", "kind", "mediaUrl", "timecode", "sourceClipTitle"}
    blob = json.dumps(p)
    for secret in ("Rusted cleat", "Lighting budget pending.", "Swap the third frame for the wider crop.", "@northvale.example", "Northvale"):
        assert secret not in blob
    with screen(browser, app_url, f"/c/{cid}") as page:
        appears(page, page.get_by_role("list", name="Items"))
        expect(page.get_by_text(n_items(p["publicItemCount"]))).to_be_visible()
        body = page.locator("body").inner_text()
        for secret in ("Rusted cleat", "Lighting budget pending.", "Swap the third frame for the wider crop."):
            assert secret not in body
        items = page.get_by_role("list", name="Items").get_by_role("listitem")
        page.set_viewport_size({"width": 599, "height": 812})
        def stacked() -> None:
            boxes = [_visual_box(items.nth(i)) for i in range(items.count())]
            assert len(boxes) == len(p["items"])
            assert all(box is not None for box in boxes)
            assert all(a["y"] + a["height"] <= b["y"] + 1 for a, b in zip(boxes, boxes[1:]))
        eventually(page, stacked)
        page.set_viewport_size({"width": 600, "height": 812})
        eventually(page, lambda: _equal(columns(items) >= 2, True))
    draft = new_cluster(signin(app_url, JUNO), "northvale")
    err(anon.get(f"/api/public/clusters/{draft['id']}"), 404, "not_found")


def lifted_cluster(app_url: str, followers: int = 0) -> dict[str, Any]:
    juno, tomas = signin(app_url, JUNO), signin(app_url, TOMAS)
    t = tag()
    title, desc, note = f"{t} lift", f"{t} first line\nsecond line", f"{t} secret note"
    c = new_cluster(juno, "northvale", title, desc, note)
    pub = new_image(juno, "northvale", f"{t} public plate")
    priv = new_image(juno, "northvale", f"{t} private plate")
    other = new_image(tomas, "northvale", f"{t} tomas plate")
    add(juno, c["id"], pub["id"])
    add(juno, c["id"], priv["id"], True)
    add(tomas, c["id"], other["id"])
    tomas.ok("POST", f"/api/clusters/{c['id']}/comments", 201, json={"body": f"{t} comment body"})
    fans = [new_follower(app_url) for _ in range(followers)]
    for api, _ in fans:
        api.ok("POST", curator_path("juno", "/follow"), 200)
    return {"juno": juno, "title": title, "desc": desc, "note": note, "c": c, "pub": pub, "priv": priv,
            "other": other, "fans": fans, "comment": f"{t} comment body"}


def test_lift_instant(app_url: str) -> None:
    s = lifted_cluster(app_url)
    juno, c, pub = s["juno"], s["c"], s["pub"]
    readers = [signin(u, JUNO) for u in urls(app_url).values()]
    anon = Api(app_url)
    at = lift_soon(juno, c["id"], "Europe/London")
    for api in readers:
        assert cluster(api, c["id"])["status"] == "embargoed"
    err(anon.get(f"/api/public/clusters/{c['id']}"), 404, "not_found")
    err(anon.get(f"/media/{pub['id']}"), 404, "not_found")
    assert c["id"] not in [f["id"] for f in anon.ok("GET", "/api/feed", 200)["items"]]
    wait_clock(at)
    for api in readers:
        seen = wait_for(lambda: (x := cluster(api, c["id"]))["status"] == "public" and x, CLOCK_SKEW_MS / MS_PER_S + 1, "public on every instance")
        assert seen["publishedAt"] == iso(at) and seen["liftsAt"] == iso(at)
    illegal(status(juno, c["id"], "in_review"), "public", "in_review")
    assert anon.ok("GET", f"/api/public/clusters/{c['id']}", 200)["publishedAt"] == iso(at)
    assert anon.get(f"/media/{pub['id']}").status_code == 200
    assert c["id"] in [x["id"] for x in anon.ok("GET", curator_path("juno"), 200)["clusters"]]
    assert c["id"] in [f["id"] for f in anon.ok("GET", "/api/feed", 200)["items"]]
    assert status(juno, c["id"], "withdrawn").status_code == 200


def test_digest_once_per_lift(app_url: str, mail: Any) -> None:
    s = lifted_cluster(app_url, followers=2)
    _, outsider = new_follower(app_url)
    at = lift_soon(s["juno"], s["c"]["id"], "Europe/London")
    wait_public(s["juno"], s["c"]["id"], at)
    subject = f"New from Juno Park: {s['title']}"
    for _, account in s["fans"]:
        assert inbox(mail, account["email"], subject, seconds=DIGEST_S + WAIT_S), "digest not delivered"
    wait_clock(now() + dt.timedelta(seconds=DIGEST_SETTLE_S))
    for _, account in s["fans"]:
        assert len(inbox(mail, account["email"], subject, seconds=0)) == 1
    assert inbox(mail, outsider["email"], subject, seconds=0) == []


def test_digest_four_public_lines(app_url: str, mail: Any) -> None:
    s = lifted_cluster(app_url, followers=1)
    c = s["c"]
    title = f"{s['title']} \r continued title \n end"
    desc = f"{s['desc']} \n continued \r end"
    s["juno"].ok("PATCH", f"/api/clusters/{c['id']}", 200, json={"title": title, "publicDescription": desc})
    assert cluster(s["juno"], c["id"])["title"] == title
    at = lift_soon(s["juno"], c["id"], "Europe/London")
    wait_public(s["juno"], c["id"], at)
    _, account = s["fans"][0]
    got = inbox(mail, account["email"], seconds=DIGEST_S + WAIT_S)
    assert got, "digest not delivered"
    assert not got[0].get("HTML")
    body = text(got[0])
    lines = body.replace("\r\n", "\n").split("\n")
    assert lines[-1] == "" and len(lines) == 5
    owner, public_count = "juno", 2
    assert lines[:3] == [title.replace("\r", " ").replace("\n", " "), desc.replace("\r", " ").replace("\n", " "),
                         f"{public_count} public items by @{owner}"]
    assert urlparse(lines[3]).netloc and urlparse(lines[3]).path == f"/c/{c['id']}"
    for secret in (s["note"], s["priv"]["title"], s["comment"], account["email"], JUNO):
        assert secret not in body


def test_wf_embargo_release_happy(browser: Browser, app_url: str, mail: Any) -> None:
    juno = signin(app_url, JUNO)
    c, refs = review_cluster(juno, 1)
    follower, account = new_follower(app_url)
    follower.ok("POST", curator_path("juno", "/follow"), 200)
    local, at = next_lift("Europe/London", UI_LIFT_LEAD_S)
    day, hm = local.split("T")
    with screen(browser, app_url, "/api/health", JUNO) as page:
        page.clock.set_system_time(now() - dt.timedelta(hours=DEVICE_SKEW_H))
        page.goto(app_url.rstrip("/") + f"/w/northvale/clusters/{c['id']}")
        page.get_by_role("button", name="Schedule embargo").click()
        appears(page, page.get_by_text("Times are in Europe/London"))
        page.get_by_label("Lift date").fill(day)
        page.get_by_label("Lift time").fill(hm)
        page.get_by_role("button", name="Set embargo").click()
        shows(page, live(page, "Cluster status"), f"Embargo set. Goes public at {day} {hm} Europe/London.")
        u = at.strftime("%Y-%m-%d %H:%M")
        expect(page.get_by_text(f"Goes public at {day} {hm} Europe/London ({u} UTC)")).to_be_visible()
        label = page.get_by_label("Status", exact=True)
        comment = page.get_by_role("textbox", name="Comment")
        half_typed = "half-typed comment"
        comment.fill(half_typed)
        assert cluster(juno, c["id"])["liftsAt"] == iso(at)
        wait_public(juno, c["id"], at)
        advance(page, REFRESH_MS)
        eventually(page, lambda: expect(label).to_contain_text("Public", timeout=CHECK_MS), seconds=WAIT_S)
        expect(page.get_by_role("button", name="Cancel embargo")).to_have_count(0)
        expect(comment).to_have_value(half_typed)
    with screen(browser, app_url, f"/c/{c['id']}") as page:
        appears(page, page.get_by_role("list", name="Items"))
        page.goto(app_url.rstrip("/") + "/explore")
        feed = page.get_by_role("feed", name="Discovery feed")
        appears(page, feed.get_by_role("article").first)
        assert names(feed, "article")[0] == c["title"]
    assert len(inbox(mail, account["email"], f"New from Juno Park: {c['title']}", seconds=DIGEST_S + WAIT_S)) == 1


def test_wf_embargo_release_brand_time(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = review_cluster(juno, 1)
    with screen(browser, app_url, f"/w/northvale/clusters/{c['id']}", JUNO) as page:
        page.get_by_role("button", name="Schedule embargo").click()
        page.get_by_label("Lift date").fill(LONDON_SPRING.isoformat())
        page.get_by_label("Lift time").fill("01:30")
        page.get_by_role("button", name="Set embargo").click()
        summary = page.get_by_role("alert", name="There is a problem")
        focused(page, summary)
        expect(summary.get_by_role("link", name="That time does not exist in Europe/London on that date.")).to_be_visible()
        expect(page.get_by_label("Lift date")).to_have_attribute("aria-invalid", "true")
        expect(page.get_by_label("Lift time")).to_have_attribute("aria-invalid", "true")
        page.get_by_label("Lift date").fill(AFTER_SPRING.isoformat())
        page.get_by_label("Lift time").fill("09:00")
        page.get_by_role("button", name="Set embargo").click()
        day = AFTER_SPRING.isoformat()
        shows(page, live(page, "Cluster status"), f"Embargo set. Goes public at {day} 09:00 Europe/London.")
        expect(page.get_by_text(f"Goes public at {day} 09:00 Europe/London ({day} 08:00 UTC)")).to_be_visible()
        expect(summary).to_have_count(0)
        page.get_by_role("button", name="Cancel embargo").click()
        shows(page, live(page, "Cluster status"), "Embargo cancelled. Back in review.")
        expect(page.get_by_label("Status", exact=True)).to_contain_text("In review")
    after = cluster(juno, c["id"])
    assert after["status"] == "in_review" and after["liftLocal"] is None


def test_accounts_and_sessions(app_url: str) -> None:
    anon = Api(app_url)
    r = anon.post("/api/auth/signin", json={"email": JUNO, "password": PASSWORD})
    assert r.status_code == 200
    cookie = next(h for h in r.headers.get_list(SET_COOKIE) if h.split("=", 1)[0].strip() == "rushes_session")
    attrs = {k.strip().lower(): v.strip() for k, _, v in (part.partition("=") for part in cookie.split(";")[1:])}
    assert "HttpOnly".lower() in attrs and attrs.get("SameSite".lower(), "").lower() == "Lax".lower() and attrs.get("path") == "/"
    acc = r.json()
    assert {"id", "email", "displayName", "handle", "role", "workspaces"} <= set(acc)
    assert acc["role"] == "designer" and acc["handle"] == "juno"
    assert acc["workspaces"] == [{"slug": "northvale", "name": "Northvale", "timeZone": "Europe/London", "hasSeat": True}]
    assert anon.ok("GET", "/api/me", 200) == acc
    mara = signin(app_url, MARA).ok("GET", "/api/me", 200)
    assert mara["role"] == "ops_lead" and {w["slug"] for w in mara["workspaces"]} == {"northvale", "kesto", "brisk-tonic"}
    assert all(w["hasSeat"] is False for w in mara["workspaces"])
    assert signin(app_url, OLA).ok("GET", "/api/me", 200)["workspaces"][0]["hasSeat"] is False
    anon.ok("POST", "/api/auth/signout", 204)
    err(anon.get("/api/me"), 401, "unauthenticated")
    name, email, handle = person("signup")
    new = Api(app_url)
    created = new.ok("POST", "/api/auth/signup", 201, json={"email": email, "displayName": name, "handle": handle, "password": PASSWORD})
    assert created["role"] == "follower" and created["workspaces"] == [] and created["handle"] == handle
    assert new.ok("GET", "/api/me", 200)["email"] == email
    field_err(Api(app_url).post("/api/auth/signup", json={"email": email, "displayName": name, "handle": tag(), "password": PASSWORD}), "email", "That email already has an account.")
    field_err(Api(app_url).post("/api/auth/signup", json={"email": person("x")[1], "displayName": name, "handle": handle, "password": PASSWORD}), "handle", "That handle is taken.")
    field_err(Api(app_url).post("/api/auth/signup", json={"email": person("x")[1], "displayName": name, "handle": "AB", "password": PASSWORD}), "handle", "Use 3 to 24 lowercase letters, digits or hyphens.")
    field_err(Api(app_url).post("/api/auth/signup", json={"email": person("x")[1], "displayName": name, "handle": tag(), "password": "short"}), "password", "Use at least 10 characters.")
    r = Api(app_url).post("/api/auth/signin", json={"email": JUNO, "password": "wrong-password"})
    assert r.status_code == 401 and r.json() == {"error": "invalid_credentials", "message": "Email or password is incorrect."}
    field_err(Api(app_url).post("/api/auth/signin", json={"email": JUNO, "password": ""}), "password", "Enter your password.")


def feed_key(f: dict) -> tuple[str, str]:
    return f["publishedAt"], f["id"]


def test_stable_feed_pages(app_url: str) -> None:
    anon = Api(app_url)
    full = feed_all(anon)
    assert len(anon.ok("GET", "/api/feed", 200)["items"]) == min(FEED_DEFAULT, len(full))
    assert len(anon.ok("GET", "/api/feed", 200, params={"limit": FEED_MAX * 20})["items"]) == min(FEED_MAX, len(full))
    for bad in (0, -1, "1.5", "x"):
        field_err(anon.get("/api/feed", params={"limit": bad}), "limit", "Use a whole number of 1 or more.")
    field_err(anon.get("/api/feed", params={"cursor": "garbage"}), "cursor", "Invalid cursor.")
    small = feed_all(anon, 7)
    assert [f["id"] for f in small] == [f["id"] for f in full] and len({f["id"] for f in small}) == len(small)
    assert all(feed_key(a) > feed_key(b) for a, b in zip(full, full[1:]))
    for f in full:
        assert set(f) == {"id", "title", "publicDescription", "curator", "publicItemCount", "publishedAt", "coverUrl"}
    titles = [f["title"] for f in full]
    seeded = ["AW26 Night Shift", "Kesto Studio Pulls"] + [f"Field Study {n:02d}" for n in range(24, 16, -1)]
    assert [x for x in titles if x in seeded] == seeded
    tie = [f for f in full if f["title"] in {"Field Study 13", "Field Study 14", "Field Study 15", "Field Study 16"}]
    assert [f["id"] for f in tie] == sorted((f["id"] for f in tie), reverse=True)
    assert titles.index("Field Study 17") < titles.index(tie[0]["title"]) and titles.index(tie[-1]["title"]) < titles.index("Field Study 12")
    aw = next(f for f in full if f["title"] == "AW26 Night Shift")
    assert aw["coverUrl"] == anon.ok("GET", f"/api/public/clusters/{aw['id']}", 200)["items"][0]["mediaUrl"]
    assert aw["curator"] == {"displayName": "Juno Park", "handle": "juno"}
    juno = signin(app_url, JUNO)
    c = new_cluster(juno, "northvale", f"{tag()} mid-scroll")
    add(juno, c["id"], new_image(juno, "northvale", f"{tag()} cover")["id"])
    at = lift_soon(juno, c["id"], "Europe/London")
    before = {f["id"] for f in feed_all(anon)}
    first = anon.ok("GET", "/api/feed", 200, params={"limit": 3})
    wait_public(juno, c["id"], at)
    rest, cursor = [], first["nextCursor"]
    while cursor:
        page = anon.ok("GET", "/api/feed", 200, params={"limit": 3, "cursor": cursor})
        rest += page["items"]
        cursor = page["nextCursor"]
    scrolled = [f["id"] for f in first["items"] + rest]
    assert len(scrolled) == len(set(scrolled)) and c["id"] not in scrolled
    stayed = before & {f["id"] for f in feed_all(anon)}
    assert stayed <= set(scrolled), "a cluster that stayed public was skipped"
    assert c["id"] in [f["id"] for f in anon.ok("GET", "/api/feed", 200)["items"]]
    assert status(juno, c["id"], "withdrawn").status_code == 200


def test_curator_profile(browser: Browser, app_url: str) -> None:
    anon = Api(app_url)
    ilse = anon.ok("GET", curator_path("ilse"), 200)
    assert set(ilse) == {"displayName", "handle", "followerCount", "clusters"}
    assert ilse["displayName"] == "Ilse Vartan" and ilse["handle"] == "ilse" and isinstance(ilse["followerCount"], int)
    assert {c["title"] for c in ilse["clusters"]} >= {f"Field Study {n:02d}" for n in range(1, 25)}
    assert all(set(c) == {"id", "title", "publishedAt", "publicItemCount", "coverUrl"} for c in ilse["clusters"])
    assert [c["publishedAt"] for c in ilse["clusters"]] == sorted((c["publishedAt"] for c in ilse["clusters"]), reverse=True)
    assert "vartan.example" not in json.dumps(ilse)
    for handle in ("tomas", "lee"):
        assert anon.ok("GET", f"/api/curators/{handle}", 200)["clusters"] == []
    err(anon.get(curator_path(NOBODY)), 404, "not_found")
    with screen(browser, app_url, "/@ilse") as page:
        appears(page, page.get_by_role("heading", name="Ilse Vartan"))
        expect(page.get_by_text(f"@{ilse['handle']}", exact=True).first).to_be_visible()
        expect(page.get_by_text(n_followers(anon.ok("GET", curator_path("ilse"), 200)["followerCount"]))).to_be_visible()
        assert "vartan.example" not in page.locator("body").inner_text()
        page.goto(app_url.rstrip("/") + f"/@{NOBODY}")
        appears(page, page.get_by_role("heading", name="This page does not exist."))
        page.goto(app_url.rstrip("/") + "/@lee")
        appears(page, page.get_by_role("heading", name="Lee Chen"))


def test_follow_counts(app_url: str) -> None:
    curator_api, curator = new_follower(app_url)
    h = curator["handle"]
    fans = [new_follower(app_url)[1] for _ in range(3)]
    sessions = [signin(u, f["email"]) for f in fans for u in (urls(app_url)["primary"], urls(app_url)["mailpit-down"])]
    results = together([lambda a=a: a.post(f"/api/curators/{h}/follow") for a in sessions])
    assert all(r.status_code == 200 and r.json()["following"] is True for r in results)
    assert Api(app_url).ok("GET", f"/api/curators/{h}", 200)["followerCount"] == 3
    results = together([lambda a=a: a.delete(f"/api/curators/{h}/follow") for a in sessions])
    assert all(r.status_code == 200 and r.json()["following"] is False for r in results)
    assert results[-1].json()["followerCount"] in (0, 1, 2) and Api(app_url).ok("GET", f"/api/curators/{h}", 200)["followerCount"] == 0
    assert sessions[0].ok("DELETE", f"/api/curators/{h}/follow", 200) == {"following": False, "followerCount": 0}
    assert sessions[0].ok("POST", f"/api/curators/{h}/follow", 200) == {"following": True, "followerCount": 1}
    field_err(curator_api.post(f"/api/curators/{h}/follow"), "handle", "You cannot follow yourself.")
    err(sessions[0].post(curator_path(NOBODY, "/follow")), 404, "not_found")
    err(Api(app_url).post(f"/api/curators/{h}/follow"), 401, "unauthenticated")


RETURN_IDS = ["explore", "profile", "cluster", "wall", "double-slash", "backslash", "encoded-backslash", "encoded-double-slash", "absolute", "control", "unknown-screen"]


class Listener:
    def __init__(self) -> None:
        self.hits: list[str] = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_GET(self) -> None:
                outer.hits.append(self.path)
                self.send_response(200)
                self.end_headers()

            def log_message(self, *_: Any) -> None:
                pass

        self.server = http.server.HTTPServer(("127.0.0.1", 0), Handler)
        self.port = self.server.server_address[1]
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self.server.shutdown()
        self.server.socket.shutdown(socket.SHUT_RDWR)
        self.server.server_close()


@pytest.mark.parametrize("case", RETURN_IDS, ids=RETURN_IDS)
def test_return_only_to_rushes(browser: Browser, app_url: str, case: str) -> None:
    listener = Listener()
    host = f"127.0.0.1:{listener.port}"
    aw = feed_id("AW26 Night Shift", app_url)
    cases = {
        "explore": (LEE, "/explore", "/explore"), "profile": (LEE, "/@" + "ilse", "/@" + "ilse"), "cluster": (LEE, f"/c/{aw}", f"/c/{aw}"),
        "wall": (JUNO, f"/w/{NV}?q=" + "Rope", f"/w/{NV}?q=" + "Rope"), "double-slash": (LEE, f"{DOUBLE_SLASH}{host}/x", "/explore"),
        "backslash": (LEE, f"/\\{host}/x", "/explore"), "encoded-backslash": (LEE, f"/%5C{host}/x", "/explore"),
        "encoded-double-slash": (JUNO, f"/%2f%2f{host}/x", "/w/northvale"), "absolute": (LEE, f"http:{DOUBLE_SLASH}{host}/", "/explore"),
        "control": (LEE, "/@" + "ilse" + "\x01", "/explore"), "unknown-screen": (LEE, "/admin", "/explore"),
    }
    email, nxt, expected = cases[case]
    try:
        with screen(browser, app_url, f"/signin?next={quote(nxt, safe='')}") as page:
            page.get_by_role("textbox", name="Email").fill(email)
            page.get_by_label("Password").fill(PASSWORD)
            page.get_by_role("button", name="Sign in").click()
            def landed() -> None:
                u = urlparse(page.url)
                _equal(u.netloc, urlparse(app_url).netloc)
                destination = urlparse(expected)
                _equal(u.path, destination.path)
                query = parse_qs(u.query, keep_blank_values=True)
                if destination.path == "/explore":
                    query.pop("pages", None)
                _equal(query, parse_qs(destination.query, keep_blank_values=True))
            eventually(page, landed)
        assert listener.hits == []
    finally:
        listener.stop()


def test_collapsed_navigation_and_tray(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/w/northvale", JUNO, 375, 812) as page:
        menu, bar = page.get_by_role("button", name="Menu"), page.get_by_role("button", name=re.compile(r"^Cluster tray: "))
        appears(page, menu)
        expect(menu).to_have_attribute("aria-expanded", "false")
        eventually(page, lambda: expect(bar).to_have_attribute("aria-expanded", "false", timeout=CHECK_MS))
        for role, name in (("link", "Explore"), ("link", "Wall"), ("combobox", "Tray cluster"), ("button", "New cluster")):
            expect(page.get_by_role(role, name=name, exact=True)).to_have_count(0)
        order = tab_order(page, TAB_PRESSES)
        assert not {"Explore", "Wall", "Tray cluster", "New cluster"} & set(order)
        assert not any(n.startswith("Reorder ") for n in order)
        layout(page)
        menu.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(menu).to_have_attribute("aria-expanded", "true", timeout=CHECK_MS))
        appears(page, page.get_by_role("link", name="Explore", exact=True))
        menu.focus()
        page.keyboard.press("Tab")
        focused(page, page.get_by_role("navigation", name="Main").get_by_role("link").first)
        page.keyboard.press("Escape")
        focused(page, menu)
        eventually(page, lambda: expect(page.get_by_role("link", name="Explore", exact=True)).to_have_count(0, timeout=CHECK_MS))
        bar.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: expect(bar).to_have_attribute("aria-expanded", "true", timeout=CHECK_MS))
        appears(page, page.get_by_role("combobox", name="Tray cluster"))
        page.keyboard.press("Escape")
        focused(page, bar)
        eventually(page, lambda: expect(page.get_by_role("combobox", name="Tray cluster")).to_have_count(0, timeout=CHECK_MS))
    with screen(browser, app_url, "/w/northvale", JUNO, 768, 1024) as page:
        appears(page, page.get_by_role("link", name="Explore", exact=True))
        expect(page.get_by_role("button", name="Menu")).to_have_count(0)
        expect(page.get_by_role("button", name=re.compile(r"^Cluster tray: "))).to_have_count(0)
        appears(page, page.get_by_role("combobox", name="Tray cluster"))


def cards(page: Page) -> list[str]:
    return names(page.get_by_role("feed", name="Discovery feed"), "article")


def test_explore_pages_in_address(browser: Browser, app_url: str) -> None:
    feed_titles = [" ".join(f["title"].split()) for f in feed_all(Api(app_url))]
    with screen(browser, app_url, "/explore", None, 375, 812) as page:
        eventually(page, lambda: _equal(len(cards(page)) > 0, True))
        one = cards(page)
        assert one == feed_titles[:len(one)]
        page.get_by_role("button", name="Load more").dispatch_event("click")
        eventually(page, lambda: _equal((lambda v: v.isdigit() and int(v) >= 2)((parse_qs(urlparse(page.url).query).get("pages") or [""])[0]), True))
        def feed_ready() -> None:
            wanted = (f"Showing {len(cards(page))} clusters.", "You're all caught up.")
            assert any(copy_matches(actual, expected) for actual in shown_texts(live(page, "Feed status")) for expected in wanted)
        eventually(page, feed_ready)
        two = cards(page)
        assert len(two) > len(one)
        assert two == feed_titles[:len(two)]
        page.reload()
        eventually(page, lambda: _equal(cards(page), two))
        for value in ("abc", "1", "0", "1.5"):
            page.goto(app_url.rstrip("/") + f"/explore?pages={value}")
            eventually(page, lambda: _equal(cards(page), one))
        page.goto(app_url.rstrip("/") + "/explore?pages=99")
        eventually(page, lambda: _equal(len(cards(page)), min(len(feed_titles), 10 * len(one))))


def test_follow_responds_at_once_and_rolls_back(browser: Browser, app_url: str) -> None:
    _, curator = new_follower(app_url)
    _, fan = new_follower(app_url)
    h, name = curator["handle"], curator["displayName"]
    with screen(browser, app_url, f"/@{h}", fan["email"]) as page:
        follow = page.get_by_role("button", name="Follow")
        appears(page, follow)
        eventually(page, lambda: _equal(count_shown(page, 0), True))
        with held(page, f"**/api/curators/{h}/follow") as gate:
            follow.click()
            appears(page, page.get_by_role("button", name="Follow", pressed=True))
            eventually(page, lambda: _equal(count_shown(page, 1), True))
            gate.release()
        shows(page, live(page, "Profile status"), f"Following {name}. {n_followers(1)}.")
        page.route(f"**/api/curators/{h}/follow", lambda route: route.abort())
        page.get_by_role("button", name="Follow").click()
        shows(page, live(page, "Profile status"), f"Could not update the follow. {n_followers(1)}.")
        appears(page, page.get_by_role("button", name="Follow", pressed=True))
        eventually(page, lambda: _equal(count_shown(page, 1), True))
        page.unroute(f"**/api/curators/{h}/follow")
        page.get_by_role("button", name="Follow").click()
        shows(page, live(page, "Profile status"), f"Unfollowed {name}. {n_followers(0)}.")
    assert Api(app_url).ok("GET", f"/api/curators/{h}", 200)["followerCount"] == 0
    with screen(browser, app_url, f"/@{h}", curator["email"]) as page:
        appears(page, page.get_by_role("heading", name=name))
        expect(page.get_by_role("button", name="Follow")).to_have_count(0)


def test_wf_discovery_and_follow_phone(browser: Browser, app_url: str) -> None:
    def visible(locator: Locator) -> Locator:
        for candidate in locator.all():
            if candidate.is_visible():
                return candidate
        raise AssertionError("no visible match")

    anon = Api(app_url)
    start = anon.ok("GET", curator_path("ilse"), 200)["followerCount"]
    name, email, handle = person("phone")
    with screen(browser, app_url, "/explore", None, 375, 812) as page:
        eventually(page, lambda: visible(page.get_by_role("button", name="Menu")).click(timeout=CHECK_MS))
        eventually(page, lambda: expect(visible(page.get_by_role("link", name="Sign in"))).to_be_visible(timeout=CHECK_MS))
        page.keyboard.press("Escape")
        page.goto(app_url.rstrip("/") + "/@ilse")
        eventually(page, lambda: visible(page.get_by_role("button", name="Follow")).click(timeout=CHECK_MS))
        eventually(page, lambda: _equal((urlparse(page.url).path, parse_qs(urlparse(page.url).query).get("next")), ("/signin", ["/@ilse"])))
        eventually(page, lambda: visible(page.get_by_role("link", name="Create an account")).click(timeout=CHECK_MS))
        eventually(page, lambda: _equal((urlparse(page.url).path, parse_qs(urlparse(page.url).query).get("next")), ("/signup", ["/@ilse"])))
        eventually(page, lambda: visible(page.get_by_role("textbox", name="Email")).fill(email, timeout=CHECK_MS))
        eventually(page, lambda: visible(page.get_by_role("textbox", name="Display name")).fill(name, timeout=CHECK_MS))
        eventually(page, lambda: visible(page.get_by_role("textbox", name="Handle")).fill(handle, timeout=CHECK_MS))
        eventually(page, lambda: visible(page.get_by_label("Password")).fill(PASSWORD, timeout=CHECK_MS))
        eventually(page, lambda: visible(page.get_by_role("button", name="Create account")).click(timeout=CHECK_MS))
        eventually(page, lambda: _equal(urlparse(page.url).path, "/@ilse"))
        eventually(page, lambda: expect(visible(page.get_by_role("button", name="Follow", pressed=False))).to_be_visible(timeout=CHECK_MS))
        with held(page, "**" + curator_path("ilse", "/follow")) as gate:
            eventually(page, lambda: visible(page.get_by_role("button", name="Follow")).click(timeout=CHECK_MS))
            eventually(page, lambda: _equal(count_shown(page, start + 1), True))
            gate.release()
        shows(page, live(page, "Profile status"), f"Following Ilse Vartan. {start + 1} followers.")
        page.goto(app_url.rstrip("/") + "/explore")
        eventually(page, lambda: _equal(len(cards(page)) > 0, True))
        more = page.get_by_role("button", name="Load more")

        def feed_settled() -> None:
            status = visible(live(page, "Feed status")).inner_text()
            assert "You're all caught up." in status or (any(candidate.is_visible() for candidate in more.all()) and f"Showing {len(cards(page))} clusters." in status)

        def load_next() -> None:
            value = (parse_qs(urlparse(page.url).query).get("pages") or [""])[0]
            if value.isdigit() and int(value) >= 2:
                return
            buttons = [candidate for candidate in more.all() if candidate.is_visible()]
            if buttons:
                buttons[0].scroll_into_view_if_needed(timeout=CHECK_MS)
                advance(page, STEP_MS)
                eventually(page, feed_settled)
                buttons = [candidate for candidate in more.all() if candidate.is_visible()]
                if buttons:
                    buttons[0].click(timeout=CHECK_MS)
            value = (parse_qs(urlparse(page.url).query).get("pages") or [""])[0]
            assert value.isdigit() and int(value) >= 2

        eventually(page, load_next)
        eventually(page, lambda: _equal((lambda v: v.isdigit() and int(v) >= 2)((parse_qs(urlparse(page.url).query).get("pages") or [""])[0]), True))
        eventually(page, feed_settled)
    me = signin(app_url, email)
    assert me.ok("GET", "/api/me", 200)["role"] == "follower"
    assert anon.ok("GET", curator_path("ilse"), 200)["followerCount"] == start + 1
    me.ok("DELETE", curator_path("ilse", "/follow"), 200)


def test_wf_discovery_and_follow_keyboard(browser: Browser, app_url: str) -> None:
    _, curator = new_follower(app_url)
    h = curator["handle"]
    with screen(browser, app_url, f"/signin?next=%2F%40{h}") as page:
        email = page.get_by_role("textbox", name="Email")
        appears(page, email)
        email.focus()
        page.keyboard.type(LEE)
        page.keyboard.press("Tab")
        page.keyboard.type(PASSWORD)
        page.get_by_role("button", name="Sign in", exact=True).press("Enter")
        eventually(page, lambda: _equal(urlparse(page.url).path, f"/@{h}"))
        follow = page.get_by_role("button", name="Follow")
        appears(page, follow)
        follow.focus()
        page.keyboard.press("Space")
        shows(page, live(page, "Profile status"), f"Following {curator['displayName']}. 1 followers.")
    assert Api(app_url).ok("GET", f"/api/curators/{h}", 200)["followerCount"] == 1


def test_invite_designers(app_url: str, mail: Any) -> None:
    mara, sam = signin(app_url, MARA), signin(app_url, SAM)
    name, email, handle = person("invitee")
    assert mara.ok("POST", wsp(KS, "/invites"), 201, json={"email": email, "displayName": name}) | {"id": "x"} == {"id": "x", "email": email, "displayName": name}
    msgs = inbox(mail, email, "You're invited to Kesto on Rushes")
    assert len(msgs) == 1 and "Mara Quill" in email_body(msgs[0])
    token = invite_token(msgs[0], app_url)
    anon = Api(app_url)
    assert anon.ok("GET", f"/api/invites/{token}", 200) == {"workspaceName": "Kesto", "email": email, "displayName": name}
    field_err(anon.post(f"/api/invites/{token}/accept", json={"handle": handle, "password": "short"}), "password", "Use at least 10 characters.")
    field_err(anon.post(f"/api/invites/{token}/accept", json={"handle": "Bad Handle", "password": PASSWORD}), "handle", "Use 3 to 24 lowercase letters, digits or hyphens.")
    acc = anon.ok("POST", f"/api/invites/{token}/accept", 201, json={"handle": handle, "password": PASSWORD})
    assert acc["role"] == "designer" and acc["workspaces"] == [{"slug": "kesto", "name": "Kesto", "timeZone": "America/New_York", "hasSeat": False}]
    assert anon.ok("GET", "/api/me", 200)["email"] == email
    err(Api(app_url).post(f"/api/invites/{token}/accept", json={"handle": tag(), "password": PASSWORD}), 410, "invite_used")
    err(Api(app_url).get(f"/api/invites/{token}"), 410, "invite_used")
    assert signin(app_url, email).ok("GET", "/api/me", 200)["handle"] == handle
    field_err(mara.post(wsp(KS, "/invites"), json={"email": JUNO, "displayName": "Juno"}), "email", "That email already has an account.")
    err(Api(app_url).get(f"/api/invites/{tag()}"), 404, "not_found")
    err(sam.post(wsp(KS, "/invites"), json={"email": person("x")[1], "displayName": "X"}), 403, "forbidden")
    _, lost, _ = person("lost-invite")
    r = signin(urls(app_url)["mailpit-down"], MARA).post(wsp(KS, "/invites"), json={"email": lost, "displayName": "Lost"})
    assert r.status_code == 503 and r.json() == {"error": "mail_unavailable", "message": "Mail is unreachable."}
    assert inbox(mail, lost, seconds=NO_MAIL_S) == []
    assert lost not in [m["email"] for m in seats(mara, "kesto")["members"]]


def test_seat_roster(app_url: str, mail: Any, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    st = seats(mara, "kesto")
    assert {"plan", "seatCap", "seatsUsed", "members"} <= set(st) and st["plan"] == kb_plan(killbill, "kesto")
    assert st["seatCap"] == PLANS[st["plan"]][1] and st["seatsUsed"] == sum(m["hasSeat"] for m in st["members"])
    assert all({"id", "displayName", "email", "handle", "hasSeat"} <= set(m) for m in st["members"])
    err(mara.get(wsp(VT, "/seats")), 404, "not_found")
    err(signin(app_url, SAM).get(wsp(KS, "/seats")), 403, "forbidden")
    assigned = set_free_seats(mara, "kesto", mail, max(1, st["seatCap"] - st["seatsUsed"]))
    d = invite_designer(mara, "kesto", mail, "seatroster.example")
    try:
        before = seats(mara, "kesto")["seatsUsed"]
        d["api"].ok("GET", wsp(KS), 200)
        err(d["api"].post(wsp(KS, "/clusters"), json={"title": "x", "publicDescription": "", "internalNote": ""}), 403, "seat_required")
        body = mara.ok("POST", wsp(KS, "/seats"), 201, json={"memberId": d["id"]})
        assert body == {"memberId": d["id"], "seatsUsed": before + 1, "seatCap": st["seatCap"]}
        assert mara.ok("POST", wsp(KS, "/seats"), 200, json={"memberId": d["id"]}) == body
        new_cluster(d["api"], "kesto")
        assert mara.ok("DELETE", wsp(KS, f"/seats/{d['id']}"), 200) == {"memberId": d["id"], "seatsUsed": before, "seatCap": st["seatCap"]}
        assert mara.ok("DELETE", wsp(KS, f"/seats/{d['id']}"), 200)["seatsUsed"] == before
        err(d["api"].post(wsp(KS, "/clusters"), json={"title": "x", "publicDescription": "", "internalNote": ""}), 403, "seat_required")
        juno_id = signin(app_url, JUNO).ok("GET", "/api/me", 200)["id"]
        err(mara.post(wsp(KS, "/seats"), json={"memberId": juno_id}), 404, "not_found")
        assert kb_plan(killbill, "kesto") == st["plan"]
    finally:
        free_all(mara, "kesto", assigned + [d["id"]])


def test_last_seat_race(app_url: str, mail: Any) -> None:
    mara, dev = signin(app_url, MARA), signin(urls(app_url)["mailpit-down"], DEV)
    assigned: list[str] = []
    try:
        for free, racers in ((1, 2), (2, 4)):
            assigned += set_free_seats(mara, "brisk-tonic", mail, free)
            ds = [invite_designer(mara, "brisk-tonic", mail) for _ in range(racers)]
            results = together([lambda a=(mara, dev)[i % 2], d=d: a.post(wsp(BT, "/seats"), json={"memberId": d["id"]}) for i, d in enumerate(ds)])
            wins = [d["id"] for d, r in zip(ds, results) if r.status_code == 201]
            assert len(wins) == free, [r.text for r in results]
            for r in results:
                if r.status_code != 201:
                    assert r.status_code == 409 and r.json() == {"error": "no_seats_left", "message": "No seats left on this plan."}
            st = seats(mara, "brisk-tonic")
            assert st["seatsUsed"] == st["seatCap"]
            assert {m["id"] for m in st["members"] if m["hasSeat"]} & {d["id"] for d in ds} == set(wins)
            assigned += wins
    finally:
        free_all(mara, "brisk-tonic", assigned)


def test_roster_view_in_address(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    invite_designer(mara, "brisk-tonic", mail, "roster.example")
    st = seats(mara, "brisk-tonic")
    seated = sorted((m["displayName"] for m in st["members"] if m["hasSeat"]), key=str.lower)
    unseated = sorted((m["displayName"] for m in st["members"] if not m["hasSeat"]), key=str.lower)
    base = app_url.rstrip("/") + "/w/brisk-tonic/admin"
    radio = lambda name: page.get_by_role("radiogroup", name="Show members").get_by_role("radio", name=name, exact=True)
    with screen(browser, app_url, "/w/brisk-tonic/admin?seat=seated&sort=seat", MARA) as page:
        eventually(page, lambda: expect(radio("Seated")).to_be_checked(timeout=CHECK_MS))
        eventually(page, lambda: _equal("Seat" in chosen(page.get_by_role("combobox", name="Sort members")), True))
        eventually(page, lambda: _equal(row_people(page), [(n, True) for n in seated]))
        check(radio("Without seat"))
        eventually(page, lambda: _equal(parse_qs(urlparse(page.url).query).get("seat"), ["unseated"]))
        eventually(page, lambda: _equal(row_people(page), [(n, False) for n in unseated]))
        expect(page.get_by_label("Seats", exact=True)).to_contain_text(f"{st['seatsUsed']} of {st['seatCap']} seats in use")
        select(page.get_by_role("combobox", name="Sort members"), "Name")
        eventually(page, lambda: _equal("sort" in parse_qs(urlparse(page.url).query), False))
        page.go_back()
        eventually(page, lambda: _equal(parse_qs(urlparse(page.url).query).get("sort"), ["seat"]))
        page.go_back()
        eventually(page, lambda: expect(radio("Seated")).to_be_checked(timeout=CHECK_MS))
        eventually(page, lambda: _equal(row_people(page), [(n, True) for n in seated]))
        page.go_forward()
        eventually(page, lambda: expect(radio("Without seat")).to_be_checked(timeout=CHECK_MS))
        page.reload()
        eventually(page, lambda: _equal(row_people(page), [(n, False) for n in unseated]))
        page.goto(base + "?seat=bogus&sort=bogus")
        eventually(page, lambda: expect(radio("All")).to_be_checked(timeout=CHECK_MS))
        eventually(page, lambda: _equal("Name" in chosen(page.get_by_role("combobox", name="Sort members")), True))
        everyone = sorted((m["displayName"] for m in st["members"]), key=str.lower)
        eventually(page, lambda: _equal([n for n, _ in row_people(page)], everyone))


def test_seat_changes_respond_at_once(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    assigned = set_free_seats(mara, "brisk-tonic", mail, 1)
    d = invite_designer(mara, "brisk-tonic", mail)
    try:
        st = seats(mara, "brisk-tonic")
        used, cap = st["seatsUsed"], st["seatCap"]
        with screen(browser, app_url, "/w/brisk-tonic/admin", MARA) as page:
            url = page.url
            meter = page.get_by_label("Seats", exact=True)
            eventually(page, lambda: expect(meter).to_contain_text(f"{used} of {cap} seats in use", timeout=CHECK_MS))
            with held(page, "**" + wsp(BT, "/seats")) as gate:
                page.get_by_role("button", name=f"Assign seat to {d['name']}").click()
                appears(page, page.get_by_role("button", name=f"Free seat from {d['name']}"))
                eventually(page, lambda: expect(meter).to_contain_text(f"{used + 1} of {cap} seats in use", timeout=CHECK_MS))
                gate.release()
            shows(page, live(page, "Admin status"), f"Seat assigned to {d['name']}. {used + 1} of {cap} seats in use.")
            focused(page, page.get_by_role("button", name=f"Free seat from {d['name']}"))
            eventually(page, lambda: _equal(tag_shown(page, meter, "Full"), True))
            page.route("**" + wsp(BT, f"/seats/{d['id']}"), lambda route: route.abort())
            page.get_by_role("button", name=f"Free seat from {d['name']}").click()
            shows(page, live(page, "Admin status"), f"The seat change could not be saved. {used + 1} of {cap} seats in use.")
            appears(page, page.get_by_role("button", name=f"Free seat from {d['name']}"))
            eventually(page, lambda: expect(meter).to_contain_text(f"{used + 1} of {cap} seats in use", timeout=CHECK_MS))
            assert page.url == url
            page.unroute("**" + wsp(BT, f"/seats/{d['id']}"))
            page.get_by_role("button", name=f"Free seat from {d['name']}").click()
            shows(page, live(page, "Admin status"), f"Seat freed from {d['name']}. {used} of {cap} seats in use.")
            focused(page, page.get_by_role("button", name=f"Assign seat to {d['name']}"))
        assert not next(m for m in seats(mara, "brisk-tonic")["members"] if m["id"] == d["id"])["hasSeat"]
    finally:
        free_all(mara, "brisk-tonic", assigned + [d["id"]])


def test_seat_admin_updates_in_place(browser: Browser, app_url: str, mail: Any) -> None:
    mara, dev = signin(app_url, MARA), signin(app_url, DEV)
    assigned = set_free_seats(mara, "brisk-tonic", mail, 1)
    mine = invite_designer(mara, "brisk-tonic", mail)
    theirs = invite_designer(mara, "brisk-tonic", mail)
    handle = tag()
    invitee = f"{handle}@{FILL_DOMAIN}"
    try:
        st = seats(mara, "brisk-tonic")
        used, cap = st["seatsUsed"], st["seatCap"]
        with screen(browser, app_url, "/w/brisk-tonic/admin", MARA) as page:
            url = page.url
            meter = page.get_by_label("Seats", exact=True)
            eventually(page, lambda: expect(meter).to_contain_text(f"{used} of {cap} seats in use", timeout=CHECK_MS))
            dev.ok("POST", wsp(BT, "/seats"), 201, json={"memberId": theirs["id"]})
            assigned.append(theirs["id"])
            page.get_by_role("button", name=f"Assign seat to {mine['name']}").click()
            shows(page, live(page, "Admin status"), "No seats left on this plan. Upgrade the plan or free a seat.")
            eventually(page, lambda: expect(meter).to_contain_text(f"{cap} of {cap} seats in use", timeout=CHECK_MS))
            appears(page, page.get_by_role("button", name=f"Free seat from {theirs['name']}"))
            refused = page.get_by_role("button", name=f"Assign seat to {mine['name']}")
            appears(page, refused)
            focused(page, refused)
            page.get_by_role("button", name=f"Free seat from {theirs['name']}").click()
            shows(page, live(page, "Admin status"), f"Seat freed from {theirs['name']}. {cap - 1} of {cap} seats in use.")
            focused(page, page.get_by_role("button", name=f"Assign seat to {theirs['name']}"))
            page.get_by_role("textbox", name="Email", exact=True).fill(invitee)
            page.get_by_role("textbox", name="Display name").fill(f"Designer {handle}")
            page.get_by_role("button", name="Send invite").click()
            shows(page, live(page, "Admin status"), f"Invite sent to {invitee}.")
            assert page.url == url
        members = {m["id"]: m["hasSeat"] for m in seats(mara, "brisk-tonic")["members"]}
        assert members[theirs["id"]] is False and members[mine["id"]] is False
        assert inbox(mail, invitee, "You're invited to Brisk Tonic on Rushes")
    finally:
        free_all(mara, "brisk-tonic", assigned + [mine["id"]])


def test_wf_seat_assignment_journey(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    assigned = set_free_seats(mara, "brisk-tonic", mail, 1)
    other = invite_designer(mara, "brisk-tonic", mail)
    handle = tag()
    email, name = f"{handle}@{FILL_DOMAIN}", f"Designer {handle}"
    joined: str | None = None
    try:
        cap = seats(mara, "brisk-tonic")["seatCap"]
        with screen(browser, app_url, "/w/brisk-tonic/admin", MARA) as page, screen(browser, app_url, "/w/brisk-tonic/admin", DEV) as dev:
            check(page.get_by_role("radiogroup", name="Show members").get_by_role("radio", name="Without seat"))
            eventually(page, lambda: _equal(parse_qs(urlparse(page.url).query).get("seat"), ["unseated"]))
            page.get_by_role("textbox", name="Email", exact=True).fill(email)
            page.get_by_role("textbox", name="Display name").fill(name)
            page.get_by_role("button", name="Send invite").click()
            shows(page, live(page, "Admin status"), f"Invite sent to {email}.")
            token = invite_token(inbox(mail, email, "You're invited to Brisk Tonic on Rushes")[0], app_url)
            with screen(browser, app_url, f"/invite/{token}") as guest:
                appears(guest, guest.get_by_text(email))
                guest.get_by_role("textbox", name="Handle").fill(handle)
                guest.get_by_label("Password").fill(PASSWORD)
                guest.get_by_role("button", name=f"Join {WS[BT][0]}").click()
                wait_for(lambda: email in [m["email"] for m in seats(mara, "brisk-tonic")["members"]], WAIT_S, "acceptance")
            joined = next(m["id"] for m in seats(mara, "brisk-tonic")["members"] if m["email"] == email)
            page.reload()
            dev.reload()
            page.get_by_role("button", name=f"Assign seat to {name}").click()
            shows(page, live(page, "Admin status"), f"Seat assigned to {name}. {cap} of {cap} seats in use.")
            eventually(page, lambda: _equal(tag_shown(page, page.get_by_label("Seats", exact=True), "Full"), True))
            url = dev.url
            dev.get_by_role("button", name=f"Assign seat to {other['name']}").click()
            shows(dev, live(dev, "Admin status"), "No seats left on this plan. Upgrade the plan or free a seat.")
            eventually(dev, lambda: expect(dev.get_by_label("Seats", exact=True)).to_contain_text(f"{cap} of {cap} seats in use", timeout=CHECK_MS))
            appears(dev, dev.get_by_role("button", name=f"Free seat from {name}"))
            focused(dev, dev.get_by_role("button", name=f"Assign seat to {other['name']}"))
            assert dev.url == url
        st = seats(mara, "brisk-tonic")
        assert st["seatsUsed"] == st["seatCap"] and {m["id"]: m["hasSeat"] for m in st["members"]}[joined] is True
        assert {m["id"]: m["hasSeat"] for m in st["members"]}[other["id"]] is False
    finally:
        free_all(mara, "brisk-tonic", assigned + ([joined] if joined else []))


def test_wf_seat_assignment_invite_mail_down(browser: Browser, app_url: str, mail: Any) -> None:
    _, email, _ = person("down-invite")
    with screen(browser, urls(app_url)["mailpit-down"], "/w/kesto/admin", MARA) as page:
        page.get_by_role("textbox", name="Email", exact=True).fill(email)
        page.get_by_role("textbox", name="Display name").fill("Down Invite")
        page.get_by_role("button", name="Send invite").click()
        shows(page, live(page, "Admin status"), "The invite email could not be sent. No invite was created.")
    assert inbox(mail, email, seconds=NO_MAIL_S) == []


def test_plan_reads_from_killbill(app_url: str, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    kb_down = signin(urls(app_url)["killbill-down"], MARA)
    for ws in ("northvale", "kesto", "brisk-tonic"):
        current = kb_plan(killbill, ws)
        pn, cap, price = PLANS[current]
        plan = mara.ok("GET", f"/api/workspaces/{ws}/plan", 200)
        assert (plan["plan"], plan["planName"], plan["seatCap"], plan["monthlyPrice"], plan["currency"]) == (current, pn, cap, price, "USD")
        assert sorted(({k: u.get(k) for k in ("plan", "planName", "seatCap", "monthlyPrice")} for u in plan["upgrades"]), key=lambda upgrade: upgrade["plan"]) == sorted(
            [{"plan": p, "planName": PLANS[p][0], "seatCap": PLANS[p][1], "monthlyPrice": PLANS[p][2]}
             for p in PLAN_ORDER if PLANS[p][1] > cap], key=lambda upgrade: upgrade["plan"])
        view = mara.ok("GET", f"/api/workspaces/{ws}", 200)
        assert (view["plan"], view["planName"], view["seatCap"], view["timeZone"]) == (current, pn, cap, WS[ws][1])
        roster = seats(mara, ws)
        assert roster["plan"] == current and roster["seatCap"] == cap
        down = kb_down.ok("GET", f"/api/workspaces/{ws}/plan", 200)
        assert down["plan"] == current and down["seatCap"] == cap


def test_upgrade_replay(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    ws, before = pick_upgradable(mara)
    target = min(before["upgrades"], key=lambda upgrade: upgrade["seatCap"])["plan"]
    tn = PLANS[target][0]
    path = f"/api/workspaces/{ws}/plan"
    key = idempotency_key()
    other = signin(urls(app_url)["minio-down"], MARA)
    previous_mail_ids = {message["ID"] for message in mail.messages(0, settle=0)}

    def operation_receipts(at_least: int = 1, seconds: float = WAIT_S) -> list[dict]:
        found: list[dict] = []
        with open_app(browser, app_url.rstrip("/") + "/api/health") as page:
            deadline = time.monotonic() + seconds
            def sample() -> None:
                nonlocal found
                found = [message for message in mail.messages(0, settle=0)
                         if message["ID"] not in previous_mail_ids and message.get("Subject") == subject
                         and MARA.lower() in addresses(message.get("To"))]
                assert len(found) >= at_least or time.monotonic() >= deadline, "waiting for operation receipts"
            eventually(page, sample, seconds=seconds + WAIT_S)
        return found

    results = together([lambda a=a: a.post(path, json={"plan": target}, headers={"Idempotency-Key": key}) for a in (mara, other)])
    oks = [r for r in results if r.status_code == 200]
    assert oks, [r.text for r in results]
    result = oks[0].json()
    for r in results:
        if r.status_code == 200:
            assert r.json() == result
        else:
            err(r, 409, "idempotency_in_progress")
    assert result["plan"] == target
    subject = f"Rushes receipt: {WS[ws][0]} is now on {tn}"
    assert operation_receipts()
    for api in (mara, other):
        replay = api.post(path, json={"plan": target}, headers={"Idempotency-Key": key})
        assert replay.status_code == 200 and replay.json() == result
    err(mara.post(path, json={"plan": before["plan"]}, headers={"Idempotency-Key": key}), 409, "idempotency_conflict")
    assert len(operation_receipts(at_least=2, seconds=NO_MAIL_S)) == 1
    assert kb_plan(killbill, ws) == target


def test_plan_upgrade(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    ws, before = pick_upgradable(mara)
    name = WS[ws][0]
    assert before["plan"] == kb_plan(killbill, ws)
    target = min(before["upgrades"], key=lambda upgrade: upgrade["seatCap"])["plan"]
    tn, tcap, tprice = PLANS[target]
    path = f"/api/workspaces/{ws}/plan"
    previous_mail_ids = {message["ID"] for message in mail.messages(0, settle=0)}

    def operation_receipts(at_least: int = 1, seconds: float = WAIT_S) -> list[dict]:
        found: list[dict] = []
        with open_app(browser, app_url.rstrip("/") + "/api/health") as page:
            deadline = time.monotonic() + seconds
            def sample() -> None:
                nonlocal found
                found = [message for message in mail.messages(0, settle=0)
                         if message["ID"] not in previous_mail_ids and message.get("Subject") == subject
                         and MARA.lower() in addresses(message.get("To"))]
                assert len(found) >= at_least or time.monotonic() >= deadline, "waiting for operation receipts"
            eventually(page, sample, seconds=seconds + WAIT_S)
        return found

    field_err(mara.post(path, json={"plan": target}), "idempotencyKey", "Send an Idempotency-Key of 1 to 64 characters.")
    field_err(mara.post(path, json={"plan": target}, headers={"Idempotency-Key": "k" * (KEY_MAX + 1)}), "idempotencyKey", "Send an Idempotency-Key of 1 to 64 characters.")
    field_err(mara.post(path, json={"plan": "rushes-pro-99"}, headers={"Idempotency-Key": idempotency_key()}), "plan", "Unknown plan.")
    field_err(mara.post(path, json={}, headers={"Idempotency-Key": idempotency_key()}), "plan", "Choose a plan to upgrade to.")
    field_err(mara.post(path, json={"plan": before["plan"]}, headers={"Idempotency-Key": idempotency_key()}), "plan", "Choose a larger plan than the current one.")
    err(signin(app_url, SAM).post(wsp(KS, "/plan"), json={"plan": target}, headers={"Idempotency-Key": idempotency_key()}), 403, "forbidden")
    assert kb_plan(killbill, ws) == before["plan"]
    r = mara.post(path, json={"plan": target}, headers={"Idempotency-Key": idempotency_key()})
    assert r.status_code == 200, r.text
    result = r.json()
    assert {"plan", "planName", "seatCap", "seatsUsed", "monthlyPrice", "currency", "receiptSentTo"} <= set(result)
    assert (result["plan"], result["planName"], result["seatCap"], result["monthlyPrice"], result["currency"], result["receiptSentTo"]) == (target, tn, tcap, tprice, "USD", MARA)
    assert kb_plan(killbill, ws) == target
    after = mara.ok("GET", path, 200)
    assert after["plan"] == target and after["seatCap"] == tcap
    assert sorted(u["plan"] for u in after["upgrades"]) == sorted(p for p in PLAN_ORDER if PLANS[p][1] > tcap)
    assert mara.ok("GET", f"/api/workspaces/{ws}", 200)["seatCap"] == tcap
    subject = f"Rushes receipt: {name} is now on {tn}"
    receipt = operation_receipts()
    assert len(receipt) == 1 and tn in email_body(receipt[0]) and str(tcap) in email_body(receipt[0]) and dollars_shown(email_body(receipt[0]), tprice)
    assert len(operation_receipts(at_least=2, seconds=NO_MAIL_S)) == 1


def test_upgrade_undone_on_failure(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    ws, before = pick_upgradable(mara)
    target = min(before["upgrades"], key=lambda upgrade: upgrade["seatCap"])["plan"]
    subject = f"Rushes receipt: {WS[ws][0]} is now on {PLANS[target][0]}"
    key = idempotency_key()
    for instance, code in (("mailpit-down", "mail_unavailable"), ("killbill-down", "billing_unavailable"), ("killbill-down", "billing_unavailable")):
        previous_mail_ids = {message["ID"] for message in mail.messages(0, settle=0)}
        r = signin(urls(app_url)[instance], MARA).post(f"/api/workspaces/{ws}/plan", json={"plan": target}, headers={"Idempotency-Key": key})
        err(r, 503, code)
        assert kb_plan(killbill, ws) == before["plan"]
        now_plan = mara.ok("GET", f"/api/workspaces/{ws}/plan", 200)
        assert now_plan["plan"] == before["plan"] and now_plan["seatCap"] == before["seatCap"]
        found: list[dict] = []
        with open_app(browser, app_url.rstrip("/") + "/api/health") as page:
            deadline = time.monotonic() + NO_MAIL_S
            def sample() -> None:
                nonlocal found
                found = [message for message in mail.messages(0, settle=0)
                         if message["ID"] not in previous_mail_ids and message.get("Subject") == subject
                         and MARA.lower() in addresses(message.get("To"))]
                assert found or time.monotonic() >= deadline, "observing the operation inbox"
            eventually(page, sample, seconds=NO_MAIL_S + WAIT_S)
        assert found == []


def test_wf_plan_upgrade_full_workspace(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    ws, before = pick_upgradable(mara)
    assigned = set_free_seats(mara, ws, mail, 0)
    spare = invite_designer(mara, ws, mail)
    target = min(before["upgrades"], key=lambda upgrade: upgrade["seatCap"])["plan"]
    tn, tcap, _ = PLANS[target]
    receipt_subject = f"Rushes receipt: {WS[ws][0]} is now on {tn}"
    try:
        used = seats(mara, ws)["seatsUsed"]
        with screen(browser, app_url, f"/w/{ws}/admin", MARA) as page:
            meter = page.get_by_label("Seats", exact=True)
            eventually(page, lambda: _equal(tag_shown(page, meter, "Full"), True))
            check(page.get_by_role("radiogroup", name="Plan").get_by_role("radio", name=re.compile(re.escape(tn))))
            with held(page, f"**/api/workspaces/{ws}/plan") as gate:
                previous_mail_ids = {message["ID"] for message in mail.messages(0, settle=0)}
                def activate() -> None:
                    page.get_by_role("button", name="Upgrade plan").click()
                    shows(page, live(page, "Admin status"), "Upgrading plan...")
                def respond() -> None:
                    with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == wsp(ws, "/plan")):
                        gate.release()
                number_film(page, meter, before["seatCap"], tcap, activate=activate, respond=respond, any_changed_digit=True)
            shows(page, live(page, "Admin status"), f"Plan upgraded to {tn}. {tcap} seats available. Receipt sent to {MARA}.")
            eventually(page, lambda: _equal(seat_meter_reads_as(meter, f"{used} of {tcap} seats in use"), True))
            eventually(page, lambda: _equal(tag_shown(page, meter, "Seats free"), True))
            eventually(page, lambda: _equal(plan_shown(page, tn), True))
            eventually(page, lambda: _equal(page.evaluate("() => document.getAnimations().some(a => a.playState === 'running' && a.effect?.getTiming().iterations === Infinity)"), False))
            page.get_by_role("button", name=f"Assign seat to {spare['name']}").click()
            shows(page, live(page, "Admin status"), f"Seat assigned to {spare['name']}. {used + 1} of {tcap} seats in use.")
            def receipt_arrived() -> None:
                receipts = [message for message in mail.messages(0, settle=0)
                            if message["ID"] not in previous_mail_ids and message.get("Subject") == receipt_subject
                            and MARA.lower() in addresses(message.get("To"))]
                assert len(receipts) == 1, receipts
            eventually(page, receipt_arrived)
        assert kb_plan(killbill, ws) == target
        assert next(m for m in seats(mara, ws)["members"] if m["id"] == spare["id"])["hasSeat"]
    finally:
        try:
            free_all(mara, ws, assigned + [spare["id"]])
        finally:
            kb_change_plan(killbill, ws, before["plan"])
            seats(mara, ws)


def test_wf_plan_upgrade_outage(browser: Browser, app_url: str, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    ws, before = pick_upgradable(mara)
    tn = PLANS[min(before["upgrades"], key=lambda upgrade: upgrade["seatCap"])["plan"]][0]
    for instance, copy in (("killbill-down", "Billing is unreachable. Your plan is unchanged."),
                           ("mailpit-down", "The receipt email could not be sent, so the upgrade was cancelled. Your plan is unchanged.")):
        with screen(browser, urls(app_url)[instance], f"/w/{ws}/admin", MARA) as page:
            radio = page.get_by_role("radiogroup", name="Plan").get_by_role("radio", name=re.compile(re.escape(tn)))
            appears(page, radio)
            check(radio)
            page.get_by_role("button", name="Upgrade plan").click()
            shows(page, live(page, "Admin status"), copy)
            eventually(page, lambda: _equal(plan_shown(page, before["planName"]), True))
        assert kb_plan(killbill, ws) == before["plan"]


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}


def shipped() -> list[tuple[str, str]]:
    return [(p.name, p.licence) for p in shipped_packages()]


def licence_ok(expr: str) -> bool:
    expr = expr.strip("()")
    if " OR " in expr:
        return any(licence_ok(p) for p in expr.split(" OR "))
    if " AND " in expr:
        return all(licence_ok(p) for p in expr.split(" AND "))
    return expr.strip("() ") in ALLOWED


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [name for name, _ in shipped() if name not in notices]
    assert not missing, missing
    for font in ("Familjen Grotesk", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


def test_if_licences_allowed() -> None:
    bad = [(n, l) for n, l in shipped() if not licence_ok(l or "")]
    assert not bad, bad


def test_if_no_extra_datastore(app_url: str) -> None:
    writer = signin(app_url, JUNO)
    c = new_cluster(writer, NV)
    readers = [signin(base, JUNO) for base in urls(app_url).values()]
    for index, reader in enumerate(readers):
        title = f"{tag()} shared {index}"
        reader.ok("PATCH", f"/api/clusters/{c['id']}", 200, json={"title": title})
        for other in readers:
            seen = cluster(other, c["id"])
            assert seen["title"] == title


def test_if_seeded_config_untouched(app_url: str, mail: Any) -> None:
    assert os.environ.get("MAIL_FROM", "Rushes <no-reply@rushes.example>") == "Rushes <no-reply@rushes.example>"
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    _, email, _ = person("from")
    make_link(tomas, c["id"], email)
    message = inbox(mail, email)[0]
    assert addresses(message.get("From")) == [mail_from_address().lower()]


def test_if_self_hosted_assets(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/api/health", JUNO) as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        for path in ("/signin", "/explore", "/@ilse", "/w/northvale"):
            page.goto(app_url.rstrip("/") + path)
            eventually(page, lambda: expect(page.get_by_role("button").first).to_be_visible(timeout=CHECK_MS))
        foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
        assert not foreign, foreign


def test_if_typescript_and_lockfile() -> None:
    app = Path("/app")
    assert (app / "package-lock.json").is_file()
    ts = [p for p in app.rglob("*") if "node_modules" not in p.parts and p.suffix in (".ts", ".tsx", ".mts", ".cts")]
    assert ts


def test_add_to_cluster_motion(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    for reduced in (False, True):
        c, refs = ordered_cluster(juno, NV, [tag()])
        ref = new_image(juno, NV, tag())
        with screen(browser, app_url, f"/w/{NV}", JUNO, reduced=reduced) as page:
            choose_tray(page, c["title"])
            count = page.get_by_label("Item count", exact=True)
            shows(page, count, n_items(len(refs)))
            page.get_by_role("button", name=f"Add {ref['title']} to cluster", exact=True).click()
            page.get_by_role("combobox", name="Find a cluster").fill(c["title"])
            advance(page, DEBOUNCE_MS)
            appears(page, page.get_by_role("listbox", name="Clusters").get_by_role("option", name=re.compile(re.escape(c["title"]))))
            row = page.get_by_role("list", name="Cluster order").get_by_role("listitem").filter(has=page.get_by_role("button", name=f"Reorder {ref['title']}", exact=True))
            with held(page, f"**/api/clusters/{c['id']}/entries") as gate:
                def activate() -> None:
                    page.keyboard.press("ArrowDown")
                    page.keyboard.press("Enter")
                def respond() -> None:
                    with page.expect_response(f"**/api/clusters/{c['id']}/entries"):
                        gate.release()
                samples = number_film(page, count, len(refs), len(refs) + 1, reduced, row, activate, respond)
            if not reduced:
                slides = [tr for tr in samples if any(abs(shift(tr, axis)) > SETTLE_PX for axis in (0, 1))]
            shows(page, count, n_items(len(refs) + 1))


def test_search_too_long(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, f"/w/{NV}", JUNO) as page:
        field = page.get_by_role("searchbox", name="Search references and clusters")
        appears(page, field)
        requests: list[str] = []
        def observe(request) -> None:
            if urlparse(request.url).path == wsp(NV, "/search"):
                requests.append(request.url)
        page.on("request", observe)
        field.fill("x" * 101)
        advance(page, DEBOUNCE_MS + STEP_MS)
        message = "Enter 1 to 100 characters."
        shows(page, live(page, "Search status"), message)
        expect(field).to_have_accessible_description(re.compile(re.escape(message)))
        messages = page.get_by_text(re.compile(re.escape(message) + r"\s*$"))
        box = field.bounding_box()
        assert any(messages.nth(i).is_visible() and messages.nth(i).bounding_box()["y"] >= box["y"] + box["height"] for i in range(messages.count())), "no message below field"
        assert not requests, requests
        field.press("Enter")
        summary = page.get_by_role("alert", name="There is a problem")
        focused(page, summary)
        appears(page, summary.get_by_role("link", name=message, exact=True))


def test_reorder_motion(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    for reduced in (False, True):
        titles = [tag(), tag(), tag()]
        c, _ = ordered_cluster(juno, NV, titles)
        with screen(browser, app_url, f"/w/{NV}", JUNO, reduced=reduced) as page:
            choose_tray(page, c["title"])
            neighbour = page.get_by_role("list", name="Cluster order").get_by_role("listitem").filter(has=page.get_by_role("button", name=f"Reorder {titles[0]}", exact=True))
            handle = lift_item(page, titles[1])

            def record_shift(activate: Callable[[], None]) -> None:
                roots = page.evaluate_handle("() => new Set()")
                tracks: dict[str, list] = {}
                visible: set[str] = set()
                at = 0

                def sample() -> None:
                    shot = page.evaluate("""([at, current, roots]) => {
                      current.forEach(e => roots.add(e));
                      for (const e of roots) if (!e.isConnected) roots.delete(e);
                      const shot = (""" + MOTION_SAMPLE + """)([at, [...roots], false]);
                      const s = window.__ms, visible = [];
                      for (const root of roots) for (const e of [root, ...root.querySelectorAll('*')]) {
                        if (e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) visible.push(s.ids.get(e));
                      }
                      return {els: shot.els, visible};
                    }""", [at, neighbour.element_handles(), roots])
                    visible.update(shot["visible"])
                    for key in set(tracks) | set(shot["els"]):
                        tracks.setdefault(key, []).append((at, shot["els"].get(key)))

                def record() -> None:
                    nonlocal at
                    sample()
                    if at >= SHIFT_MAX_MS + MOTION_TAIL_MS:
                        return
                    at += MOTION_STEP_MS
                    raise AssertionError("motion recording in progress")

                try:
                    sample()
                    activate()
                    eventually(page, record, step_ms=MOTION_STEP_MS)
                finally:
                    page.evaluate(MOTION_RELEASE)
                    roots.dispose()
                displayed = [tr for key, tr in tracks.items() if key in visible and present(tr)]
                if reduced:
                    assert all(travel_duration(tr) <= MOTION_STEP_MS for tr in displayed), displayed
                else:
                    shifts = [tr for tr in displayed if abs(shift(tr, 1)) > SETTLE_PX]
                    assert shifts, displayed
                    assert any(in_range(travel_duration(tr), SHIFT_MIN_MS, SHIFT_MAX_MS) for tr in shifts), [travel_duration(tr) for tr in shifts]

            record_shift(lambda: page.keyboard.press("ArrowUp"))
            first = sorted(c["entries"], key=lambda e: e["position"])[0]
            juno.ok("POST", f"/api/clusters/{c['id']}/entries/{first['id']}/move", 200, json={"toPosition": 1, "version": c["version"]})
            pattern = f"**/api/clusters/{c['id']}/entries/*/move"
            with held(page, pattern) as gate:
                def refuse_move() -> None:
                    page.keyboard.press("Space")
                    with page.expect_response(pattern):
                        gate.release()
                record_shift(refuse_move)
            eventually(page, lambda: _equal(tray_order(page), titles))
            focused(page, handle)


def test_review_page_narrow(browser: Browser, app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    title = "R" * 80
    clip = new_clip(tomas, NV, title)
    c = new_cluster(tomas, NV)
    add(tomas, c["id"], new_image(tomas, NV, "I" * 80)["id"])
    pluck(tomas, NV, clip["id"], c["id"], 0).raise_for_status()
    assert status(tomas, c["id"], "in_review").status_code == 200
    link = make_link(tomas, c["id"], person("narrow")[1])
    with screen(browser, app_url, urlparse(link["url"]).path, width=375, height=812) as page:
        appears(page, page.get_by_role("textbox", name="Comment"))
        def source_title_shown() -> None:
            for candidate in page.get_by_text(re.compile(re.escape(title[:1]))).all():
                if not candidate.is_visible():
                    continue
                text = candidate.inner_text().strip()
                if title in text:
                    return
                value = re.split(r"…|\.{3}", text)[0].rstrip()
                if value and title.startswith(value) and value != text:
                    return
                if re.search(r"R+(?:…|\.{3})", text):
                    return
            raise AssertionError("the still shows no source title")

        eventually(page, source_title_shown)

        def timecode_shown() -> None:
            for candidate in page.get_by_text(timecode(0, CAPSTAN_FPS), exact=False).all():
                if candidate.is_visible():
                    return
            raise AssertionError("the still shows no timecode")

        eventually(page, timecode_shown)
        no_sideways_scroll(page)


def test_withdraw_by_keyboard(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, NV, [tag()])
    wait_public(juno, c["id"], lift_soon(juno, c["id"], WS[NV][1]))
    with screen(browser, app_url, f"/w/{NV}/clusters/{c['id']}", MARA) as page:
        opener = page.get_by_role("button", name="Withdraw cluster", exact=True)
        appears(page, opener)
        keyboard_to(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Withdraw cluster")
        appears(page, dialog)
        for key in ("Tab", "Shift+Tab"):
            for _ in range(6):
                page.keyboard.press(key)
                assert dialog.evaluate("e => e.contains(document.activeElement)"), key
        page.keyboard.press("Escape")
        focused(page, opener)
        page.keyboard.press("Enter")
        keyboard_to(page, dialog.get_by_role("button", name="Withdraw", exact=True))
        page.keyboard.press("Enter")
        shows(page, live(page, "Cluster status"), "Withdrawn. The public page is gone.")
        focused(page, page.get_by_label("Status", exact=True))


def test_settings_columns(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    title = "S" * 80
    c, _ = ordered_cluster(juno, NV, [title], title)
    assert status(juno, c["id"], "in_review").status_code == 200
    with screen(browser, app_url, f"/w/{NV}/clusters/{c['id']}", JUNO) as page:
        field = page.get_by_role("textbox", name="Title", exact=True)
        appears(page, field)
        entry = page.get_by_role("checkbox", name=f"Keep {title} private")
        link = page.get_by_role("textbox", name="Freelancer email")
        comment = page.get_by_role("region", name="Comments")
        def column_geometry(stacked: bool = False) -> None:
            details, entries, links, comments = [control.bounding_box() for control in (field, entry, link, comment)]
            assert all((details, entries, links, comments)), (details, entries, links, comments)
            for left in (details, entries):
                for right in (links, comments):
                    if stacked:
                        assert right["y"] >= left["y"] + left["height"] or left["y"] >= right["y"] + right["height"], (left, right)
                    else:
                        assert beside(left, right) and left["x"] < right["x"], (left, right)
        eventually(page, column_geometry)
        page.set_viewport_size({"width": 1279, "height": 800})
        eventually(page, lambda: column_geometry(stacked=True))
        page.set_viewport_size({"width": 375, "height": 812})
        eventually(page, lambda: no_sideways_scroll(page))


def test_dialog_survives_illegal_refresh(browser: Browser, app_url: str) -> None:
    juno, mara = signin(app_url, JUNO), signin(app_url, MARA)
    c, _ = ordered_cluster(juno, NV, [tag()])
    wait_public(juno, c["id"], lift_soon(juno, c["id"], WS[NV][1]))
    with screen(browser, app_url, f"/w/{NV}/clusters/{c['id']}", MARA) as page:
        opener = page.get_by_role("button", name="Withdraw cluster", exact=True)
        appears(page, opener)
        opener.click()
        dialog = page.get_by_role("dialog", name="Withdraw cluster")
        appears(page, dialog)
        assert status(mara, c["id"], "withdrawn").status_code == 200
        advance(page, REFRESH_MS)
        label = page.get_by_label("Status", exact=True)
        eventually(page, lambda: expect(label).to_contain_text("Withdrawn", timeout=CHECK_MS))
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Withdraw", exact=True).click()
        eventually(page, lambda: expect(dialog).to_have_count(0, timeout=CHECK_MS))
        focused(page, label)
        expect(label).to_contain_text("Withdrawn")
        expect(page.get_by_role("button", name="Withdraw cluster", exact=True)).to_have_count(0)


def test_feed_failure(browser: Browser, app_url: str) -> None:
    with screen(browser, app_url, "/explore", width=375, height=812) as page:
        eventually(page, lambda: _equal(bool(cards(page)), True))
        before, address = cards(page), parse_qs(urlparse(page.url).query)
        more = page.get_by_role("button", name="Load more")
        def next_page(url: str) -> bool:
            parsed = urlparse(url)
            return parsed.path == "/api/feed" and bool(parse_qs(parsed.query).get("cursor"))
        def refuse(route) -> None:
            route.abort()
        page.route(next_page, refuse)
        more.dispatch_event("click")
        shows(page, live(page, "Feed status"), "The feed could not load. Try again.")
        assert cards(page) == before
        assert parse_qs(urlparse(page.url).query).get("pages") == address.get("pages")
        page.unroute(next_page, refuse)
        more.dispatch_event("click")
        eventually(page, lambda: _equal(len(cards(page)) > len(before), True))
        assert cards(page)[:len(before)] == before
        eventually(page, lambda: _equal(parse_qs(urlparse(page.url).query).get("pages"), ["2"]))


def test_menu_and_tray_panel_motion(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c, _ = ordered_cluster(juno, NV, [tag()])
    for reduced in (False, True):
        with screen(browser, app_url, f"/w/{NV}", JUNO, 375, 812, reduced) as page:
            appears(page, page.get_by_role("button", name=re.compile(r"^Cluster tray: ")))
            for name in ("Menu", "Cluster tray"):
                button = page.get_by_role("button", name=re.compile(r"^Cluster tray: ") if name == "Cluster tray" else name, exact=True)
                panel = (page.get_by_role("navigation", name="Main", include_hidden=True) if name == "Menu"
                         else page.get_by_role("complementary", name="Cluster tray", include_hidden=True))
                retained = page.evaluate_handle("() => ({panels: new Set(), persistent: new Set()})")

                def persistent_controls() -> list:
                    if name == "Menu":
                        return button.element_handles()
                    return button.element_handles() + panel.get_by_role("status", name="Tray announcements", include_hidden=True).element_handles()

                collect = """([current, persistent, retained]) => {
                  current.forEach(e => retained.panels.add(e));
                  persistent.forEach(e => retained.persistent.add(e));
                  for (const set of [retained.panels, retained.persistent]) for (const e of set) if (!e.isConnected) set.delete(e);
                  const nodes = new Set();
                  for (const root of retained.panels) for (const e of [root, ...root.querySelectorAll('*')]) {
                    if (![...retained.persistent].some(p => p.contains(e) || e.contains(p))) nodes.add(e);
                  }
                  return [...nodes];
                }"""
                try:
                    for opening in (True, False):
                        tracks: dict[str, list] = {}
                        clip_tracks: dict[str, list] = {}
                        roots: set[str] = set()
                        visible: set[str] = set()
                        at = 0

                        def sample() -> None:
                            shot = page.evaluate("""([at, current, persistent, retained]) => {
                              const nodes = (""" + collect + """)([current, persistent, retained]);
                              const shot = (""" + MOTION_SAMPLE + """)([at, [...retained.panels], false]);
                              const s = window.__ms, els = {}, visible = [], clips = {};
                              for (const e of nodes) {
                                const key = s.ids.get(e); els[key] = shot.els[key];
                                const cs = getComputedStyle(e);  // infra: a clip-path or mask reveal changes no box or opacity (L451)
                                clips[key] = [cs.clipPath, cs.maskImage, cs.maskSize, cs.maskPosition, cs.webkitMaskImage, cs.webkitMaskSize, cs.webkitMaskPosition].join('|');
                                if (e.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) visible.push(key);
                              }
                              return {els, visible, clips, roots: shot.scopes.filter(Boolean)};
                            }""", [at, panel.element_handles(), persistent_controls(), retained])
                            visible.update(shot["visible"])
                            roots.update(shot["roots"])
                            for key, value in shot["clips"].items():
                                clip_tracks.setdefault(key, []).append((at, value))
                            for key in set(tracks) | set(shot["els"]):
                                tracks.setdefault(key, []).append((at, shot["els"].get(key)))

                        def record() -> None:
                            nonlocal at
                            sample()
                            if at >= SHEET_MAX_MS + MOTION_TAIL_MS:
                                return
                            at += MOTION_STEP_MS
                            raise AssertionError("motion recording in progress")

                        try:
                            sample()
                            button.click()
                            eventually(page, record, step_ms=MOTION_STEP_MS)
                        finally:
                            page.evaluate(MOTION_RELEASE)
                        changes = [travel_duration(tracks[key]) for key in roots if key in tracks and key in visible and present(tracks[key])]

                        def clip_duration(track: list) -> float:
                            first, final = track[0][1], track[-1][1]
                            start = max([a for a, _ in track if all(w == first for t, w in track if t <= a)] or [0])
                            settle = min([a for a, _ in track if all(w == final for t, w in track if t >= a)] or [track[-1][0]])
                            return max(0, settle - start)

                        changes += [clip_duration(clip_tracks[key]) for key in roots if key in clip_tracks and key in visible and len({v for _, v in clip_tracks[key]}) > 1]
                        if reduced:
                            assert all(ms <= MOTION_STEP_MS for ms in changes), changes
                        eventually(page, lambda: expect(button).to_have_attribute("aria-expanded", str(opening).lower(), timeout=CHECK_MS))
                        if opening and name == "Cluster tray":
                            select(page.get_by_role("combobox", name="Tray cluster"), c["title"])
                            if button.get_attribute("aria-expanded") != "true":
                                button.click()
                                film(page, panel.element_handles(), SHEET_MAX_MS + MOTION_TAIL_MS)

                    def closed() -> None:
                        assert page.evaluate("""([current, persistent, retained]) => {
                          const nodes = (""" + collect + """)([current, persistent, retained]);
                          const painted = nodes.some(n => {
                            if (!n.checkVisibility({checkOpacity: true, checkVisibilityCSS: true})) return false;
                            const r = n.getBoundingClientRect();
                            let left = Math.max(0, r.left), top = Math.max(0, r.top);
                            let right = Math.min(innerWidth, r.right), bottom = Math.min(innerHeight, r.bottom);
                            let clipped = false, hidden = false;
                            for (let p = n; p; p = p.parentElement) {
                              const style = getComputedStyle(p), clip = p.getBoundingClientRect();
                              clipped ||= [style.clipPath, style.maskImage, style.webkitMaskImage].some(value => value && value !== 'none');
                              hidden ||= p.inert || p.getAttribute('aria-hidden') === 'true';
                              const inset = style.clipPath.match(/^inset\\(([^)]*)\\)/);
                              if (inset) {
                                const edges = inset[1].split(/\\s+round\\s+/)[0].trim().split(/\\s+/).map((value, i) => parseFloat(value) * (value.endsWith('%') ? (i % 2 ? clip.width : clip.height) / 100 : 1));
                                if (edges[0] + (edges[2] ?? edges[0]) >= clip.height || (edges[1] ?? edges[0]) + (edges[3] ?? edges[1] ?? edges[0]) >= clip.width) return false;
                              }
                              if (p === n) continue;
                              if (/hidden|clip|auto|scroll/.test(style.overflowX)) { left = Math.max(left, clip.left); right = Math.min(right, clip.right); }
                              if (/hidden|clip|auto|scroll/.test(style.overflowY)) { top = Math.max(top, clip.top); bottom = Math.min(bottom, clip.bottom); }
                            }
                            if (clipped && hidden) return false;
                            return right > left && bottom > top;
                          });
                          const previous = document.activeElement;
                          const focusable = nodes.some(n => {
                            if (!(n.tabIndex >= 0) || n.disabled || typeof n.focus !== 'function') return false;
                            n.focus({preventScroll: true}); return document.activeElement === n;
                          });
                          previous?.focus({preventScroll: true});
                          return !painted && !focusable;
                        }""", [panel.element_handles(), persistent_controls(), retained]), "closed panel remains painted or focusable"
                        if name == "Menu":
                            assert panel.get_by_role("link").count() == 0
                        else:
                            assert panel.get_by_role("combobox", name="Tray cluster").count() == 0
                            assert panel.get_by_role("button", name="New cluster", exact=True).count() == 0
                            assert panel.get_by_role("button", name=re.compile(r"^Reorder ")).count() == 0
                    eventually(page, closed)
                finally:
                    retained.dispose()


def test_seats_by_keyboard(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    snapshot = seats(mara, BT)
    try:
        set_free_seats(mara, BT, mail, 1)
        d = invite_designer(mara, BT, mail)
        state = seats(mara, BT)
        used, cap = state["seatsUsed"], state["seatCap"]
        with screen(browser, app_url, f"/w/{BT}/admin", MARA) as page:
            assign = page.get_by_role("button", name=f"Assign seat to {d['name']}", exact=True)
            free = page.get_by_role("button", name=f"Free seat from {d['name']}", exact=True)
            appears(page, assign)
            keyboard_to(page, assign)
            page.keyboard.press("Enter")
            shows(page, live(page, "Admin status"), f"Seat assigned to {d['name']}. {used + 1} of {cap} seats in use.")
            focused(page, free)
            page.keyboard.press("Enter")
            shows(page, live(page, "Admin status"), f"Seat freed from {d['name']}. {used} of {cap} seats in use.")
            focused(page, assign)
    finally:
        restore_seat_snapshot(mara, BT, snapshot)


def test_admin_columns(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    d = invite_designer(mara, BT, mail, domain=("long" * 12) + ".example")
    with screen(browser, app_url, f"/w/{BT}/admin", MARA) as page:
        roster = page.get_by_role("table", name="Members")
        appears(page, roster)
        plans = current_plan(page)
        eventually(page, lambda: _equal(any(p.is_visible() for p in plans.all()), True))
        plan = next(p for p in plans.all() if p.is_visible())
        invite = page.get_by_role("button", name="Send invite")
        assert beside(roster.bounding_box(), plan.bounding_box()), "roster/plan overlap"
        assert beside(roster.bounding_box(), invite.bounding_box()), "roster/invite overlap"
        page.set_viewport_size({"width": 375, "height": 812})
        row = roster.get_by_role("row").filter(has_text=d["email"])
        appears(page, row)
        eventually(page, lambda: expect(row).to_contain_text(d["email"], timeout=CHECK_MS))
        eventually(page, lambda: no_sideways_scroll(page))
        cell = row.get_by_role("cell").or_(row.get_by_role("rowheader")).filter(has_text=d["email"])
        assert cell_reachable(cell), "email cell is clipped or unreachable"


def test_seat_meter_roll(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    snapshot = seats(mara, BT)
    try:
        set_free_seats(mara, BT, mail, 1)
        d = invite_designer(mara, BT, mail)
        for reduced in (False, True):
            mara.delete(wsp(BT, f"/seats/{d['id']}"))
            before = seats(mara, BT)
            used, cap = before["seatsUsed"], before["seatCap"]
            with screen(browser, app_url, f"/w/{BT}/admin", MARA, reduced=reduced) as page:
                meter = page.get_by_label("Seats", exact=True)
                eventually(page, lambda: _equal(seat_meter_reads_as(meter, f"{used} of {cap} seats in use"), True))
                with held(page, "**" + wsp(BT, "/seats")) as gate:
                    page.get_by_role("button", name=f"Assign seat to {d['name']}").click()
                    number_film(page, meter, used, used + 1, reduced)
                    gate.release()
                shows(page, live(page, "Admin status"), f"Seat assigned to {d['name']}. {used + 1} of {cap} seats in use.")
                eventually(page, lambda: _equal(seat_meter_reads_as(meter, f"{used + 1} of {cap} seats in use"), True))
    finally:
        restore_seat_snapshot(mara, BT, snapshot)


def test_wf_freelancer_review_keyboard(browser: Browser, app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas)
    _, email, _ = person("keyboard")
    expiry = (now() + dt.timedelta(days=1)).replace(hour=18, minute=30, second=0, microsecond=0)
    path = f"/api/clusters/{c['id']}/review-links"
    with screen(browser, app_url, f"/w/{NV}/clusters/{c['id']}", TOMAS) as page:
        field = page.get_by_role("textbox", name="Freelancer email")
        appears(page, field)
        keyboard_to(page, field)
        page.keyboard.type(email)
        expires = page.get_by_label("Expires", exact=True)
        keyboard_to(page, expires)
        expires.fill(expiry.strftime("%Y-%m-%dT%H:%M"))
        comments = page.get_by_role("checkbox", name="Allow comments")
        keyboard_to(page, comments)
        if not comments.is_checked():
            page.keyboard.press("Space")
        keyboard_to(page, page.get_by_role("button", name="Create review link"))
        with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == path) as response:
            page.keyboard.press("Enter")
        assert response.value.status == 201, response.value.text()
        link = response.value.json()
        shows(page, live(page, "Cluster status"), f"Review link sent to {email}.")
    with screen(browser, app_url, urlparse(link["url"]).path) as page:
        name = page.get_by_role("textbox", name="Your name")
        box = page.get_by_role("textbox", name="Comment")
        post = page.get_by_role("button", name="Post comment")
        appears(page, name)
        keyboard_to(page, name)
        page.keyboard.type("Ren Keyboard")
        for i in range(COMMENT_LIMIT):
            keyboard_to(page, box)
            page.keyboard.type(f"keyboard comment {i}")
            keyboard_to(page, post)
            page.keyboard.press("Enter")
            eventually(page, lambda: expect(box).to_have_value("", timeout=CHECK_MS))
            eventually(page, lambda: expect(post).to_be_enabled(timeout=CHECK_MS))
        keyboard_to(page, box)
        page.keyboard.type("keyboard comment refused")
        keyboard_to(page, post)
        page.keyboard.press("Enter")
        shows(page, live(page, "Review status"), re.compile(r"^You're commenting too fast\. Try again in \d+ seconds\.$"))
        focused(page, box)


def test_seat_over_cap_from_killbill(browser: Browser, app_url: str, mail: Any, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    original = kb_plan(killbill, KS)
    snapshot = seats(mara, KS)
    target_used = 6
    try:
        kb_change_plan(killbill, KS, "rushes-pro-10")
        cap = seats(mara, KS)["seatCap"]
        set_free_seats(mara, KS, mail, cap - target_used)
        d = invite_designer(mara, KS, mail)
        kb_change_plan(killbill, KS, "rushes-pro-5")
        with screen(browser, app_url, f"/w/{KS}/admin", MARA) as page:
            meter = page.get_by_label("Seats", exact=True)
            eventually(page, lambda: expect(meter).to_contain_text(f"{target_used} of 5 seats in use", timeout=CHECK_MS))
            eventually(page, lambda: _equal(tag_shown(page, meter, "Over cap"), True))
            assign = page.get_by_role("button", name=f"Assign seat to {d['name']}", exact=True)
            assign.click()
            shows(page, live(page, "Admin status"), "No seats left on this plan. Upgrade the plan or free a seat.")
            focused(page, assign)
            eventually(page, lambda: expect(meter).to_contain_text(f"{target_used} of 5 seats in use", timeout=CHECK_MS))
        assert seats(mara, KS)["seatsUsed"] == target_used
    finally:
        try:
            kb_change_plan(killbill, KS, "rushes-pro-25")
            restore_seat_snapshot(mara, KS, snapshot)
        finally:
            kb_change_plan(killbill, KS, original)
            seats(mara, KS)


def test_plan_section_follows_killbill(browser: Browser, app_url: str, killbill: Any) -> None:
    mara = signin(app_url, MARA)
    original = kb_plan(killbill, BT)
    try:
        kb_change_plan(killbill, BT, "rushes-pro-10")
        used = seats(mara, BT)["seatsUsed"]
        with screen(browser, app_url, f"/w/{BT}/admin", MARA) as page:
            eventually(page, lambda: _equal(plan_shown(page, PLANS["rushes-pro-10"][0]), True))
            meter = page.get_by_label("Seats", exact=True)
            eventually(page, lambda: expect(meter).to_contain_text(f"{used} of 10 seats in use", timeout=CHECK_MS))
            choices = page.get_by_role("radiogroup", name="Plan")
            expect(choices.get_by_role("radio")).to_have_count(1)
            option = choices.get_by_role("radio", name=re.compile(re.escape("Pro 25 seats")))
            appears(page, option)
            price = re.escape(f"${PLANS['rushes-pro-25'][2]}") + r"\s+per\s+month"
            def offered_price() -> None:
                assert any(match.is_visible() for match in page.get_by_text(re.compile(price)).all()), "No visible price for the offered upgrade"
            eventually(page, offered_price)
    finally:
        kb_change_plan(killbill, BT, original)
        seats(mara, BT)


def test_review_regenerate_pending_control(browser: Browser, app_url: str) -> None:
    tomas = signin(app_url, TOMAS)
    c, _ = review_cluster(tomas, 1)
    email = "ren@freelance.example"
    link = make_link(tomas, c["id"], email)
    with screen(browser, app_url, f"/w/{NV}/clusters/{c['id']}", TOMAS) as page:
        button = page.get_by_role("button", name=f"Regenerate link for {email}", exact=True)
        appears(page, button)
        path = f"/api/review-links/{link['id']}/regenerate"
        requests: list = []
        page.on("request", lambda r: requests.append(r) if r.method == "POST" and urlparse(r.url).path == path else None)
        with held(page, f"**/api/review-links/{link['id']}/regenerate") as gate:
            original = button.element_handle()
            button.click()
            eventually(page, lambda: _equal(len(requests), 1))
            with contextlib.suppress(PlaywrightError):
                original.evaluate(USER_REPRESS)
            advance(page, STEP_MS)
            assert len(requests) == 1, requests
            gate.release()
        shows(page, live(page, "Cluster status"), f"New link sent to {email}. The old link no longer works.")

def test_pluck_locked_before_frame_validation(app_url: str) -> None:
    juno = signin(app_url, JUNO)
    clip = capstan(juno)
    c = new_cluster(juno, NV)
    assert status(juno, c["id"], "in_review").status_code == 200
    assert status(juno, c["id"], "embargoed", FUTURE_LIFT).status_code == 200
    before = cluster(juno, c["id"])
    err(pluck(juno, NV, clip["id"], c["id"], CAPSTAN_FRAMES), 409, "cluster_locked")
    after = cluster(juno, c["id"])
    assert after["itemCount"] == before["itemCount"] == 0
    assert after["version"] == before["version"] and after["entries"] == before["entries"]


def test_embargoed_details_remain_editable(browser: Browser, app_url: str) -> None:
    juno = signin(app_url, JUNO)
    c = new_cluster(juno, NV, desc=CAPSTAN)
    assert status(juno, c["id"], "in_review").status_code == 200
    embargo = status(juno, c["id"], "embargoed", FUTURE_LIFT)
    assert embargo.status_code == 200
    title, note = tag(), tag()
    with screen(browser, app_url, f"/w/{NV}/clusters/{c['id']}", JUNO) as page:
        appears(page, page.get_by_role("button", name="Save details", exact=True))
        page.get_by_role("textbox", name="Title", exact=True).fill(title)
        page.get_by_role("textbox", name="Internal note", exact=True).fill(note)
        page.get_by_role("button", name="Save details", exact=True).click()
        shows(page, live(page, "Cluster status"), "Details saved.")
    saved = cluster(juno, c["id"])
    assert saved["title"] == title and saved["internalNote"] == note
    assert saved["publicDescription"] == c["publicDescription"]
    assert saved["status"] == "embargoed" and saved["liftsAt"] == embargo.json()["liftsAt"]


def test_seat_row_control_cannot_repeat_while_pending(browser: Browser, app_url: str, mail: Any) -> None:
    mara = signin(app_url, MARA)
    assigned = set_free_seats(mara, BT, mail, 1)
    d = invite_designer(mara, BT, mail)
    try:
        before = seats(mara, BT)
        used, cap = before["seatsUsed"], before["seatCap"]
        with screen(browser, app_url, f"/w/{BT}/admin", MARA) as page:
            row = page.get_by_role("table", name="Members").get_by_role("row").filter(has_text=d["email"])
            seat_paths = {wsp(BT, "/seats"), wsp(BT, f"/seats/{d['id']}")}
            requests: list = []
            page.on("request", lambda r: requests.append(r) if r.method in ("POST", "DELETE") and urlparse(r.url).path in seat_paths else None)
            assign = row.get_by_role("button", name=f"Assign seat to {d['name']}", exact=True)
            appears(page, assign)
            with held(page, "**" + wsp(BT, "/seats") + "**") as gate:
                original = assign.element_handle()
                assign.click()
                eventually(page, lambda: _equal(len(requests), 1))
                with contextlib.suppress(PlaywrightError):
                    original.evaluate(USER_REPRESS)
                advance(page, STEP_MS)
                assert len(requests) == 1, requests
                gate.release()
            shows(page, live(page, "Admin status"), f"Seat assigned to {d['name']}. {used + 1} of {cap} seats in use.")
            free = row.get_by_role("button", name=f"Free seat from {d['name']}", exact=True)
            appears(page, free)
            requests.clear()
            with held(page, "**" + wsp(BT, "/seats") + "**") as gate:
                original = free.element_handle()
                free.click()
                eventually(page, lambda: _equal(len(requests), 1))
                with contextlib.suppress(PlaywrightError):
                    original.evaluate(USER_REPRESS)
                advance(page, STEP_MS)
                assert len(requests) == 1, requests
                gate.release()
            shows(page, live(page, "Admin status"), f"Seat freed from {d['name']}. {used} of {cap} seats in use.")
        after = seats(mara, BT)
        assert after["seatsUsed"] == used
        assert not next(m for m in after["members"] if m["id"] == d["id"])["hasSeat"]
    finally:
        free_all(mara, BT, assigned + [d["id"]])
