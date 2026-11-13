from __future__ import annotations

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
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime
from fractions import Fraction
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qsl, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    animations,
    axe,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    select,
    settle,
    shipped_packages,
    state_styles,
    text,
    unique,
)

ROOT = Path("/app")
CHUNK_BYTES = 5242880
JSON_LIMIT = 1000000
SRT_LIMIT = 1000000
LIVE_S = 1
LOUPE_MS = 120
STAGE_RETURN_MS = 200
SEARCH_BUDGET_S = 1
SRT_BUDGET_S = 2
RATE_LIMIT = 30
RATE_WINDOW_S = 10
RATE_KEY_TTL_S = 20
MAX_PAGE = 100
NOTE_LIMIT = 2000
CUE_LINE = 42
MAX_CUES = 5000
MAX_TERMS = 8
MAX_Q = 200
LINK_MIN_S = 10
LINK_MAX_S = 2592000
MAIL_GROUP_S = 60
OUTBOX_RETRY_S = 10
EXPORT_STEP_MS = 400
LOUPE_W = 360
LOUPE_H = 96
LOUPE_GAP = 16
TARGET_PX = 44
GRID_GAP = 14
SNAP_PX = 8
MINUTE_KEY_TTL_S = 3456000
SPEED_MIN = 25
SPEED_MAX = 400
TITLE_MAX = 80
NAME_MAX = 60
FRAME_PX = {"16:9": (1920, 1080), "9:16": (1080, 1920), "1:1": (1080, 1080), "4:5": (1080, 1350)}
ZOOM_PPF = [0.25, 0.5, 1, 2, 4, 8]
DEFAULT_ZOOM = 2
NOMINAL = {"23.976": 24, "24": 24, "25": 25, "29.97": 30, "30": 30, "50": 50, "59.94": 60, "60": 60}
EXACT = {"23.976": Fraction(24000, 1001), "24": Fraction(24), "25": Fraction(25), "29.97": Fraction(30000, 1001),
         "30": Fraction(30), "50": Fraction(50), "59.94": Fraction(60000, 1001), "60": Fraction(60)}
MAX_UPLOAD_BYTES = 8000000000
GB = 1000000000

HTTP_TIMEOUT_S = 60
SLACK_S = 5
POLL_S = 30
EXPORT_DONE_S = 90
COPY_BOOT_S = 180
STEP_MS = 50
QUICK_MS = 1000
TRAP_PRESSES = 12
UNKNOWN_PATH = "/api/no-such-route-probe"
FAR_START = 3000
CLIP_LEN = 100
LAST_FRAME = FAR_START + CLIP_LEN - 1
FAR_END = FAR_START + CLIP_LEN
OTHER_START = 260
A_END = 310
MP4_W = 640
MP4_H = 360
WAV_RATE = 8000
KIT_TEXT = "f0e0d0"
KIT_BOX = "102030"
KIT_TEXT_2 = "aaaaaa"
KIT_BOX_2 = "bbbbbb"
OPACITY = "opacity"


def prop_row(page: Page, prop: str):
    return page.get_by_role("region", name="Inspector").locator(f'[data-prop="{prop}"]')


def remote_playhead(page: Page, who: str):
    return page.locator(f'[data-remote-playhead="{who}"]')
MAIL_WAIT_S = 240

PEOPLE = {
    "noor": ("noor@gatecut.example", "reel-owner-4417", "Noor Achterberg"),
    "idris": ("idris@kestrelvane.example", "reel-editor-2290", "Idris Fallowfield"),
    "pia": ("pia@kestrelvane.example", "reel-editor-5531", "Pia Marchetti"),
    "maren": ("maren@kestrelvane.example", "reel-producer-8812", "Maren Okafor"),
    "theo": ("theo@lowtide.example", "reel-editor-6604", "Theo Brandt"),
}

COPY = {
    "unauthenticated": "Sign in to continue.",
    "bad_credentials": "That email and password do not match.",
    "not_found": "Nothing here. It may have been removed or you may not have access.",
    "method_not_allowed": "This address does not accept that request.",
    "forbidden": "Your role on this project cannot do that.",
    "validation": "Check the highlighted fields.",
    "nothing_to_undo": "Nothing to undo.",
    "nothing_to_redo": "Nothing to redo.",
    "export_not_ready": "The manifest is ready once the export is done.",
    "storage_unavailable": "Media storage is unreachable. Uploads and exports are paused; nothing was saved.",
    "queue_unavailable": "The export queue is unreachable. No export was started and no minutes were used.",
}


def uid(label: str) -> str:
    return unique(label)[0]


def env_url(name: str) -> str:
    value = os.environ.get(name)
    assert value, f"{name} must name the outage instance"
    return value.rstrip("/")


def rnd(value: Fraction) -> int:
    return math.floor(value + Fraction(1, 2))


def tc(frame: int, rate: str) -> str:
    n = NOMINAL[rate]
    s = frame // n
    return f"{s // 3600:02d}:{s // 60 % 60:02d}:{s % 60:02d}:{frame % n:02d}"


def ms_text(ms: int) -> str:
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def srt(cues: list[tuple[int, int, list[str]]], eol: str = "\n", bom: bool = False) -> bytes:
    out = []
    for i, (a, b, lines) in enumerate(cues, 1):
        out.append(f"{i}{eol}{ms_text(a)} --> {ms_text(b)}{eol}" + "".join(line + eol for line in lines) + eol)
    data = "".join(out).encode("utf-8")
    return (b"\xef\xbb\xbf" + data) if bom else data


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def gb(n: int) -> str:
    v = math.floor(Fraction(n, GB) * 10 + Fraction(1, 2))
    return str(v // 10) if v % 10 == 0 else f"{v // 10}.{v % 10}"


def allowance_text(a: dict) -> str:
    return (f"Export minutes {a['export_minutes_used']} of {a['export_minutes_allowance']} · storage "
            f"{gb(a['storage_bytes_used'])} of {gb(a['storage_bytes_allowance'])} GB")


def round2(v: float) -> float:
    x = abs(v) * 100
    base = math.floor(x)
    up = (x - base) >= 0.5 - 1e-4
    return math.copysign((base + (1 if up else 0)) / 100, v)


def kf_value(diamonds: list[dict], f: int) -> float:
    ds = sorted(diamonds, key=lambda d: d["frame"])
    if f <= ds[0]["frame"]:
        return ds[0]["value"]
    if f >= ds[-1]["frame"]:
        return ds[-1]["value"]
    for a, b in zip(ds, ds[1:]):
        if a["frame"] <= f <= b["frame"]:
            t = (f - a["frame"]) / (b["frame"] - a["frame"])
            e = t if a["curve"] == "linear" else t * t * (3 - 2 * t)
            return a["value"] + (b["value"] - a["value"]) * e
    raise AssertionError("unreachable diamond search")


def poll(fn: Callable[[], Any], what: str, seconds: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
    pytest.fail(f"{what}; last observed {last!r}")


def box(kind: bytes, payload: bytes) -> bytes:
    return struct.pack(">I", 8 + len(payload)) + kind + payload


def mp4_bytes(w: int, h: int, timescale: int, duration: int) -> bytes:
    ftyp = box(b"ftyp", b"isom" + struct.pack(">I", 512) + b"isom")
    mvhd = box(b"mvhd", b"\x00\x00\x00\x00" + struct.pack(">IIII", 0, 0, timescale, duration) + b"\x00" * 80)
    tkhd = box(b"tkhd", b"\x00\x00\x00\x07" + struct.pack(">IIIII", 0, 0, 1, 0, duration) + b"\x00" * 52
               + struct.pack(">II", w << 16, h << 16))
    return ftyp + box(b"moov", mvhd + box(b"trak", tkhd)) + box(b"free", uuid.uuid4().bytes)


def wav_bytes(data: bytes, rate: int = 8000, bits: int = 16, channels: int = 1, riff_delta: int = 0,
              align: int | None = None) -> bytes:
    align = align or channels * bits // 8
    fmt = struct.pack("<HHIIHH", 1, channels, rate, rate * align, align, bits)
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + b"data" + struct.pack("<I", len(data)) + data
    return b"RIFF" + struct.pack("<I", len(body) + riff_delta) + body


def png_bytes(w: int, h: int, bad_crc: bool = False) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)
    ihdr = chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 0, 0, 0, 0))
    if bad_crc:
        ihdr = ihdr[:-4] + bytes([ihdr[-4] ^ 0xFF]) + ihdr[-3:]
    raw = b"".join(b"\x00" + b"\x00" * w for _ in range(h))
    return (b"\x89PNG\r\n\x1a\n" + ihdr + chunk(b"tEXt", b"probe\x00" + uuid.uuid4().hex.encode())
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def expected_peaks(samples: tuple[int, ...]) -> list[float]:
    n = len(samples)
    out = []
    for i in range(1000):
        a, b = i * n // 1000, (i + 1) * n // 1000
        if b <= a:
            out.append(0.0)
            continue
        m = max(abs(s) for s in samples[a:b])
        out.append(math.floor(Fraction(m, 32768) * 10000 + Fraction(1, 2)) / 10000)
    return out


class Api:
    def __init__(self, base: str, who: str | None = None):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, follow_redirects=False)
        self.who = who
        self.person: dict = {}
        if who:
            email, password, _ = PEOPLE[who]
            r = self.c.post("/api/session", json={"email": email, "password": password})
            assert r.status_code == 200, f"POST /api/session for {who}: {r.status_code} {r.text}"
            self.person = r.json()["person"]

    @property
    def name(self) -> str:
        return PEOPLE[self.who][2] if self.who else ""

    @property
    def cookie(self) -> str | None:
        return self.c.cookies.get("gatecut_session")

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.c.get(path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.c.post(path, json=body, **kw) if body is not None else self.c.post(path, **kw)

    def put(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.c.put(path, json=body, **kw) if body is not None else self.c.put(path, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.c.delete(path, **kw)


def detail(api: Api, pid: str) -> dict:
    r = api.get(f"/api/projects/{pid}")
    assert r.status_code == 200, r.text
    return r.json()


def version(api: Api, pid: str) -> int:
    return detail(api, pid)["project"]["version"]


def rows(api: Api, pid: str) -> dict[str, dict]:
    return {r["name"]: r for r in detail(api, pid)["rows"]}


def clips(api: Api, pid: str) -> dict[str, dict]:
    return {c["id"]: c for c in detail(api, pid)["clips"]}


def send(api: Api, pid: str, body: dict, status: int | None = 200) -> httpx.Response:
    full = {"op_id": uuid.uuid4().hex, "base_version": version(api, pid), **body}
    r = api.post(f"/api/projects/{pid}/ops", full)
    if status is not None:
        assert r.status_code == status, f"op {body.get('type')}: {r.status_code} {r.text}"
    return r


def add(api: Api, pid: str, body: dict) -> dict:
    before = set(clips(api, pid))
    send(api, pid, body)
    new = [c for i, c in clips(api, pid).items() if i not in before]
    assert len(new) == 1, f"{body['type']} added {len(new)} clips"
    return new[0]


def add_text(api: Api, pid: str, row_id: str, start: int, end: int, label: str = "T") -> dict:
    return add(api, pid, {"type": "add_text", "row_id": row_id, "start_frame": start, "end_frame": end,
                          "text": f"{label}{uuid.uuid4().hex[:6]}"})


def project(owner: Api, label: str, rate: str = "25", aspect: str = "16:9",
            members: tuple[tuple[str, str], ...] = ()) -> tuple[str, str]:
    title = uid(label)
    r = owner.post("/api/projects", {"title": title, "agency": "Kestrel & Vane", "description": "Probe project.",
                                     "frame_rate": rate, "aspect_ratio": aspect})
    assert r.status_code == 201, r.text
    pid = r.json()["id"]
    for who, role in members:
        m = owner.post(f"/api/projects/{pid}/members", {"email": PEOPLE[who][0], "role": role})
        assert m.status_code == 201, m.text
    return pid, title


def name_cut(owner: Api, pid: str, label: str = "Cut") -> dict:
    r = owner.post(f"/api/projects/{pid}/cuts", {"name": uid(label)[:NAME_MAX]})
    assert r.status_code == 201, r.text
    return r.json()


def make_link(owner: Api, pid: str, cut_id: str, seconds: int = LINK_MAX_S) -> dict:
    r = owner.post(f"/api/projects/{pid}/review-links", {"cut_id": cut_id, "expires_in_seconds": seconds})
    assert r.status_code == 201, r.text
    return r.json()


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code} {r.text}"
    body = r.json()
    assert body["error"] == code, body
    assert isinstance(body["message"], str) and body["message"], body
    if message is not None:
        assert body["message"] == message, body
    return body


def start_upload(api: Api, data: bytes, name: str, folder: str, replaces: str | None = None) -> httpx.Response:
    body: dict[str, Any] = {"file_name": name, "bytes": len(data), "sha256": sha(data), "folder": folder}
    if replaces:
        body["replaces"] = replaces
    return api.post("/api/uploads", body)


def put_chunk(api: Api, upload_id: str, n: int, data: bytes) -> httpx.Response:
    part = data[n * CHUNK_BYTES:(n + 1) * CHUNK_BYTES]
    return api.c.put(f"/api/uploads/{upload_id}/chunks/{n}", content=part,
                     headers={"content-type": "application/octet-stream"})


def upload(api: Api, data: bytes, name: str, folder: str, replaces: str | None = None) -> httpx.Response:
    r = start_upload(api, data, name, folder, replaces)
    assert r.status_code in (200, 201), r.text
    j = r.json()
    if j.get("duplicate"):
        return r
    for n in range(j["chunks"]):
        if n not in j["chunks_received"]:
            assert put_chunk(api, j["upload_id"], n, data).status_code == 204
    return api.post(f"/api/uploads/{j['upload_id']}/complete")


def media_in(api: Api, folder: str) -> list[dict]:
    r = api.get("/api/media", params={"folder": folder, "limit": MAX_PAGE})
    assert r.status_code == 200, r.text
    return r.json()["items"]


def folder_name() -> str:
    return f"Probe / {uuid.uuid4().hex[:10]}"


@contextlib.contextmanager
def screen(browser: Browser, app_url: str, api: Api | None, path: str, width: int = 1280, height: int = 800,
           reduced: str = "no-preference", setup: Callable[[Page], None] | None = None) -> Iterator[Page]:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/sign-in", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": width, "height": height})
        if api is not None and api.cookie:
            page.context.add_cookies([{"name": "gatecut_session", "value": api.cookie, "url": base}])
        if setup:
            setup(page)
        page.goto(base + path)
        yield page


def eventually(page: Page, check: Callable[[], Any], what: str, seconds: float = LIVE_S + SLACK_S) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        try:
            last = check()
        except Exception as exc:
            last = exc
        if last and not isinstance(last, Exception):
            return last
        advance(page, STEP_MS)
    pytest.fail(f"{what}; last observed {last!r}")


def attr(loc, name: str) -> str | None:
    return loc.first.get_attribute(name, timeout=QUICK_MS) if loc.count() else None


def txt(loc) -> str:
    return loc.first.inner_text(timeout=QUICK_MS) if loc.count() else ""


def notices(page: Page):
    return page.get_by_role("status", name="Notices")


def timeline(page: Page):
    return page.get_by_role("region", name="Timeline")


def block(page: Page, cid: str):
    return timeline(page).locator(f'[data-clip-id="{cid}"]')


def canvas(page: Page):
    return page.locator("[data-timeline-canvas]")


def playhead(page: Page) -> int:
    return int(attr(page.locator("[data-playhead-frame]"), "data-playhead-frame") or -1)


def active(page: Page, name: str = "data-clip-id") -> str | None:
    return page.evaluate("n => document.activeElement ? document.activeElement.getAttribute(n) : null", name)


def wait_editor(page: Page, cid: str) -> None:
    eventually(page, lambda: block(page, cid).count() > 0, f"timeline block for clip {cid} drawn", POLL_S)


def is_focused(loc) -> bool:
    return bool(loc.evaluate("el => el === document.activeElement || el.contains(document.activeElement)"))


HEAR_JS = """(el, key) => {
  window.__heard = window.__heard || {};
  const log = window.__heard[key] = [];
  const push = t => { t = (t || '').trim(); if (t) log.push(t); };
  new MutationObserver(ms => { for (const m of ms) {
    if (m.type === 'characterData') push(m.target.data);
    for (const n of m.addedNodes) push(n.textContent);
  } }).observe(el, {childList: true, subtree: true, characterData: true});
}"""


def listen(page: Page, name: str = "Project activity") -> None:
    eventually(page, lambda: page.get_by_role("status", name=name).count() > 0, f"status {name} present", POLL_S)
    page.get_by_role("status", name=name).first.evaluate(HEAR_JS, name)


def heard(page: Page, name: str = "Project activity") -> list[str]:
    return page.evaluate("k => (window.__heard && window.__heard[k]) || []", name)


def announced_once(page: Page, message: str, name: str = "Project activity") -> None:
    eventually(page, lambda: message in heard(page, name), f"{name} announced {message!r}")
    advance(page, 1000)
    assert heard(page, name).count(message) == 1, f"{message!r} announced {heard(page, name).count(message)} times"


def frame_point(page: Page, frame: int) -> tuple[float, float]:
    cv = canvas(page)
    cb = cv.first.bounding_box()
    first = int(attr(cv, "data-first-frame"))
    ppf = float(attr(cv, "data-px-per-frame"))
    y = cb["y"] + cb["height"] / 2
    audio = timeline(page).get_by_role("group", name="Audio", exact=True)
    if audio.count():
        ab = audio.first.bounding_box()
        if ab and cb["y"] <= ab["y"] + ab["height"] / 2 <= cb["y"] + cb["height"]:
            y = ab["y"] + ab["height"] / 2
    return cb["x"] + (frame - first) * ppf + ppf / 2, y


def press_n(page: Page, key: str, n: int) -> None:
    for _ in range(n):
        page.keyboard.press(key)


def trapped(page: Page, dialog) -> None:
    for key in ("Tab", "Shift+Tab"):
        for _ in range(TRAP_PRESSES):
            page.keyboard.press(key)
            assert dialog.evaluate("el => el.contains(document.activeElement)"), f"{key} left the dialog"


def ops_requests(page: Page) -> list[str]:
    seen: list[str] = []
    page.on("request", lambda r: seen.append(r.url) if r.method == "POST" and r.url.endswith("/ops") else None)
    return seen


OUTAGE_URL_ENVS = ["APP_MINIO_DOWN_URL", "APP_RABBITMQ_DOWN_URL", "APP_MAILPIT_DOWN_URL", "APP_TIGHT_URL"]


def test_health_every_instance(app_url: str) -> None:
    for base in [app_url.rstrip("/")] + [env_url(e) for e in OUTAGE_URL_ENVS]:
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200, f"{base}: {r.status_code}"
        assert r.json() == {"status": "ok"}
        assert r.headers["content-type"].startswith("application/json")


def test_routes_error_shape(app_url: str) -> None:
    anon = Api(app_url)
    err(anon.get(UNKNOWN_PATH), 404, "not_found", COPY["not_found"])
    r = anon.post("/api/health", {})
    err(r, 405, "method_not_allowed", COPY["method_not_allowed"])
    assert "GET" in r.headers.get("allow", "")
    r = anon.c.request("PATCH", "/api/projects", json={})
    err(r, 405, "method_not_allowed")
    allow = r.headers.get("allow", "")
    assert "GET" in allow and "POST" in allow
    r = anon.c.post("/api/session", content=b"email=x", headers={"content-type": "text/plain"})
    assert err(r, 415, "unsupported_media_type")["message"].startswith("Send this request as")
    pad = JSON_LIMIT - len(b'{"email":"","password":""}')
    exact = json.dumps({"email": "", "password": "p" * pad}, separators=(",", ":")).encode()
    assert len(exact) == JSON_LIMIT
    r = anon.c.post("/api/session", content=exact, headers={"content-type": "application/json"})
    assert r.status_code != 413, "a body exactly at its limit is accepted"
    over = exact[:-2] + b'p"}'
    assert len(over) == JSON_LIMIT + 1
    r = anon.c.post("/api/session", content=over, headers={"content-type": "application/json"})
    assert err(r, 413, "too_large")["message"].startswith("This request is over")
    r = anon.c.post("/api/session", content=over, headers={"content-type": "text/plain"})
    err(r, 413, "too_large")
    r = anon.c.post(UNKNOWN_PATH, content=over, headers={"content-type": "text/plain"})
    err(r, 404, "not_found")
    err(anon.get("/api/projects"), 401, "unauthenticated", COPY["unauthenticated"])
    owner = Api(app_url, "noor")
    r = owner.post("/api/projects", {"title": uid("origin")}, headers={"origin": "http://elsewhere.invalid"})
    err(r, 403, "forbidden")
    err(owner.get("/api/projects/no-such-project-probe"), 404, "not_found")
    for path in ["/run.json", "/.env", "/package.json", "/tsconfig.json", "/api/debug", "/api/admin"]:
        assert owner.get(path).status_code == 404, path


def test_whole_frame_timecode(app_url: str) -> None:
    owner = Api(app_url, "noor")
    last = detail(owner, "orchard-lane")["project"]["total_frames"] - 1
    ol = "orchard-lane"
    r = owner.get(f"/api/projects/{ol}/frames/{last}")
    assert r.status_code == 200 and r.json()["timecode"] == tc(last, "23.976")
    for rate in ["23.976", "29.97"]:
        pid, _ = project(owner, "tc", rate=rate)
        pic = rows(owner, pid)["Picture"]["id"]
        c = add(owner, pid, {"type": "add_clip", "row_id": pic, "media_id": "kv-logo", "start_frame": 0})
        assert c["end_frame"] - c["start_frame"] == rnd(5 * EXACT[rate])
        for f in [0, NOMINAL[rate] - 1, NOMINAL[rate], c["end_frame"] - 1]:
            j = owner.get(f"/api/projects/{pid}/frames/{f}").json()
            assert j["frame"] == f and j["timecode"] == tc(f, rate)
        cap = rows(owner, pid)["Captions"]["id"]
        body = srt([(1000, 2543, ["Probe cue"])])
        imp = owner.c.post(f"/api/projects/{pid}/rows/{cap}/captions/import", content=body,
                           headers={"content-type": "application/x-subrip"})
        assert imp.status_code == 200, imp.text
        caps = [x for x in detail(owner, pid)["captions"] if x["row_id"] == cap]
        assert [(x["start_frame"], x["end_frame"]) for x in caps] == [
            (rnd(Fraction(1000) * EXACT[rate] / 1000), rnd(Fraction(2543) * EXACT[rate] / 1000))]
        for clip in detail(owner, pid)["clips"]:
            for k in ["start_frame", "end_frame", "source_in", "source_out"]:
                assert isinstance(clip[k], int)


QS = {"qs-c1": (0, 309, 0, 309), "qs-c2": (309, 496, 51, 238)}
OL = {"ol-c1": (0, 1438, 101, 1539)}


def _check_upgraded(api: Api) -> None:
    for pid, expect, total, markers in [("quayside", QS, 496, [0, 153, 309]),
                                        ("orchard-lane", OL, 1438, [0, 719, 1439])]:
        d = poll(lambda: (lambda x: x if x["project"]["time_unit"] == "frames" else None)(detail(api, pid)),
                 f"{pid} upgraded to frames")
        assert d["project"]["total_frames"] == total
        assert sorted(m["frame"] for m in d["project"]["markers"]) == markers
        got = {c["id"]: (c["start_frame"], c["end_frame"], c["source_in"], c["source_out"]) for c in d["clips"]}
        for cid, values in expect.items():
            assert got[cid] == values, (cid, got[cid])


def _tail(log: Path) -> str:
    return log.read_text(errors="replace")[-4000:] if log.exists() else ""


@contextlib.contextmanager
def app_copy() -> Iterator[str]:
    manifest = DEPLOYED_APP / "run.json"
    if not manifest.exists():
        manifest = ROOT / "run.json"
    serve = json.loads(manifest.read_text())["serve"]
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    log = Path(tempfile.mkdtemp()) / "copy.log"
    out = log.open("wb")
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env={**os.environ, "APP_PUBLIC_PORT": str(port)},
                            stdout=out, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + COPY_BOOT_S
        ready = False
        while time.monotonic() < deadline and not ready:
            try:
                proc.wait(timeout=0.5)
                pytest.fail(f"restarted copy exited early: {_tail(log)}")
            except subprocess.TimeoutExpired:
                pass
            try:
                ready = httpx.get(base + "/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                ready = False
        if not ready:
            pytest.fail(f"restarted copy never answered /api/health: {_tail(log)}")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with contextlib.suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=30)
        out.close()


@pytest.mark.timeout(900)
def test_wf_upgrade_and_address_upgrade(app_url: str) -> None:
    owner = Api(app_url, "noor")
    _check_upgraded(owner)
    with app_copy() as base:
        _check_upgraded(Api(base, "noor"))
    _check_upgraded(owner)


def _address_project(owner: Api) -> tuple[str, dict, dict]:
    pid, _ = project(owner, "addr", members=(("idris", "editor"),))
    pic = rows(owner, pid)["Picture"]["id"]
    a = add_text(owner, pid, pic, 0, 300, "A")
    b = add_text(owner, pid, pic, 400, 700, "B")
    return pid, a, b


def _query(page: Page) -> list[tuple[str, str]]:
    return parse_qsl(urlparse(page.url).query, keep_blank_values=True)


def test_wf_upgrade_and_address_reload_back(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, a, _ = _address_project(owner)
    with screen(browser, app_url, owner, f"/projects/{pid}?frame=50&zoom=3&clip={a['id']}&panel=inspector") as page:
        wait_editor(page, a["id"])
        eventually(page, lambda: playhead(page) == 50, "playhead at frame=50")
        assert attr(canvas(page), "data-zoom-level") == "3"
        assert float(attr(canvas(page), "data-px-per-frame")) == ZOOM_PPF[3]
        eventually(page, lambda: active(page) == a["id"], "focus on the clip named by clip=")
        page.keyboard.press("Shift+Equal")
        eventually(page, lambda: dict(_query(page)).get("zoom") == "4", "zoom=4 in the address")
        keys = [k for k, _ in _query(page)]
        assert keys == [k for k in ["frame", "zoom", "clip", "panel"] if k in keys]
        assert dict(_query(page)).get("panel") == "inspector"
        depth = page.evaluate("() => history.length")
        page.keyboard.press("Period")
        eventually(page, lambda: dict(_query(page)).get("frame") == "51", "frame=51 after Period")
        assert page.evaluate("() => history.length") == depth, "moving the playhead replaces the entry"
        page.reload()
        wait_editor(page, a["id"])
        eventually(page, lambda: attr(canvas(page), "data-zoom-level") == "4" and playhead(page) == 51,
                   "zoom 4 and frame 51 after reload")
        eventually(page, lambda: active(page) == a["id"], "focus restored after reload")
        page.go_back()
        eventually(page, lambda: attr(canvas(page), "data-zoom-level") == "3", "Back restores zoom 3",
                   LIVE_S + SLACK_S)
        page.goto(f"{app_url.rstrip('/')}/projects/{pid}?frame=abc&zoom=9&clip=no-such-clip")
        wait_editor(page, a["id"])
        eventually(page, lambda: playhead(page) == 0 and attr(canvas(page), "data-zoom-level") == str(DEFAULT_ZOOM),
                   "invalid parameters fall back to frame 0 and the default zoom")
        assert active(page) is None


def test_wf_upgrade_and_address_second_tab(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    idris = Api(app_url, "idris")
    pid, a, b = _address_project(owner)
    path = f"/projects/{pid}?frame=40&zoom=1&clip={b['id']}&panel=comments"
    with screen(browser, app_url, owner, path) as page:
        wait_editor(page, b["id"])
        tab = page.context.new_page()
        tab.goto(page.url)
        wait_editor(tab, b["id"])
        eventually(tab, lambda: playhead(tab) == 40 and attr(canvas(tab), "data-zoom-level") == "1",
                   "second tab shows frame 40 at zoom 1")
        eventually(tab, lambda: active(tab) == b["id"], "second tab focuses the same clip")
        assert dict(_query(tab)).get("panel") == "comments"
        listen(tab)
        send(idris, pid, {"type": "move", "clip_id": a["id"], "start_frame": 5, "row_id": a["row_id"]})
        announced_once(tab, f"Idris Fallowfield moved {a['name']} to {tc(5, '25')}.")
        page.bring_to_front()
        block(page, b["id"]).focus()
        page.keyboard.press("ArrowRight")
        poll(lambda: clips(owner, pid)[b["id"]]["start_frame"] == 401, "owner's nudge saved")
        advance(tab, 1000)
        assert not any(m.startswith("Noor Achterberg") for m in heard(tab)), heard(tab)


def test_sign_in_and_out(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "signout")
    a = add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 50)
    err(Api(app_url).post("/api/session", {"email": PEOPLE["noor"][0], "password": "wrong-probe"}), 401,
        "bad_credentials", COPY["bad_credentials"])
    with screen(browser, app_url, None, "/sign-in") as page:
        page.get_by_role("textbox", name="Email").fill(PEOPLE["noor"][0])
        page.get_by_label("Password").fill("wrong-probe")
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: COPY["bad_credentials"] in txt(notices(page)), "bad credentials copy")
        page.get_by_label("Password").fill(PEOPLE["noor"][1])
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: page.get_by_role("region", name="Projects").count() > 0, "project list after sign-in")
        sockets: list = []
        page.on("websocket", lambda ws: sockets.append(ws))
        page.goto(f"{app_url.rstrip('/')}/projects/{pid}")
        wait_editor(page, a["id"])
        eventually(page, lambda: len(sockets) >= 1, "project page opened its socket")
        cookie = next(c["value"] for c in page.context.cookies() if c["name"] == "gatecut_session")
        other = httpx.Client(base_url=app_url.rstrip("/"), cookies={"gatecut_session": cookie}, timeout=HTTP_TIMEOUT_S)
        assert other.delete("/api/session").status_code == 204
        eventually(page, lambda: all(ws.is_closed() for ws in sockets), "sockets closed at sign-out")
        eventually(page, lambda: "You were signed out." in txt(notices(page)), "signed-out notice")
        err(other.get("/api/session"), 401, "unauthenticated")
    with screen(browser, app_url, None, "/") as page:
        eventually(page, lambda: urlparse(page.url).path == "/sign-in", "signed-out visitor sent to /sign-in")


def test_wf_roles_live_create_team(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    title = uid("team")
    with screen(browser, app_url, owner, "/") as page:
        link = page.get_by_role("link", name="New project", exact=True)
        eventually(page, lambda: link.count() > 0, "New project link")
        link.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New project")
        eventually(page, lambda: dialog.count() > 0, "New project dialog open")
        eventually(page, lambda: is_focused(dialog.get_by_role("textbox", name="Title")), "focus on Title")
        trapped(page, dialog)
        page.keyboard.press("Escape")
        eventually(page, lambda: dialog.count() == 0, "Escape closes the dialog")
        assert is_focused(link), "focus returns to New project"
        link.click()
        dialog.get_by_role("textbox", name="Title").fill(title)
        dialog.get_by_role("textbox", name="Agency").fill("Kestrel & Vane")
        dialog.get_by_role("textbox", name="Description").fill("Probe project.")
        select(dialog.get_by_role("combobox", name="Frame rate"), "25")
        select(dialog.get_by_role("combobox", name="Aspect ratio"), "16:9")
        dialog.get_by_role("button", name="Create project").click()
        made = poll(lambda: next((p for p in owner.get("/api/projects").json()["items"] if p["title"] == title), None),
                    "created project listed for the owner")
        assert made["role"] == "owner" and made["frame_rate"] == "25" and made["aspect_ratio"] == "16:9"
        assert [(r["name"], r["kind"]) for r in sorted(detail(owner, made["id"])["rows"], key=lambda r: r["position"])] \
            == [("Titles", "video"), ("Picture", "video"), ("Audio", "audio"), ("Captions", "caption")]
        page.goto(f"{app_url.rstrip('/')}/projects/{made['id']}")
        for who, role in [("idris", "editor"), ("maren", "commenter")]:
            page.get_by_role("button", name="Members", exact=True).click()
            members = page.get_by_role("dialog", name="Project members")
            members.get_by_role("textbox", name="Email").fill(PEOPLE[who][0])
            select(members.get_by_role("combobox", name="Role", exact=True), role)
            members.get_by_role("button", name="Add member").click()
            poll(lambda: any(m["person"]["email"] == PEOPLE[who][0] and m["role"] == role
                             for m in owner.get(f"/api/projects/{made['id']}/members").json()["items"]),
                 f"{who} added as {role}")
            page.keyboard.press("Escape")
    for who, role in [("idris", "editor"), ("maren", "commenter")]:
        api = Api(app_url, who)
        assert any(p["title"] == title and p["role"] == role for p in api.get("/api/projects").json()["items"])
        with screen(browser, app_url, api, "/") as page:
            group = page.get_by_role("region", name="Projects").get_by_role("group", name=title, exact=True)
            eventually(page, lambda: attr(group, "data-role") == role, f"{who} sees data-role={role}")
            assert role in txt(group)


def test_wf_roles_live_invalid_input(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    base = {"agency": "Kestrel & Vane", "description": "Probe project.", "frame_rate": "25", "aspect_ratio": "16:9"}
    long_title = (uid("t") + "x" * TITLE_MAX)[:TITLE_MAX + 1]
    b = err(owner.post("/api/projects", {**base, "title": long_title}), 422, "validation", COPY["validation"])
    assert b["errors"]["title"] == "Give the project a title of 1 to 80 characters."
    b = err(owner.post("/api/projects", {**base, "title": uid("t"), "frame_rate": "26"}), 422, "validation")
    assert b["errors"]["frame_rate"] == "Choose a frame rate from the list."
    b = err(owner.post("/api/projects", {**base, "title": uid("t"), "aspect_ratio": "3:2"}), 422, "validation")
    assert b["errors"]["aspect_ratio"] == "Choose an aspect ratio from the list."
    assert not any(p["title"] == long_title for p in owner.get("/api/projects").json()["items"])
    exact = (uid("t") + "y" * TITLE_MAX)[:TITLE_MAX]
    with screen(browser, app_url, owner, "/") as page:
        page.get_by_role("link", name="New project", exact=True).click()
        dialog = page.get_by_role("dialog", name="New project")
        dialog.get_by_role("button", name="Create project").click()
        eventually(page, lambda: "Give the project a title of 1 to 80 characters." in txt(dialog), "title field error")
        assert dialog.evaluate("el => el.contains(document.activeElement)"), "focus stays in the dialog"
        dialog.get_by_role("textbox", name="Title").fill(exact)
        dialog.get_by_role("textbox", name="Agency").fill("Kestrel & Vane")
        select(dialog.get_by_role("combobox", name="Frame rate"), "25")
        select(dialog.get_by_role("combobox", name="Aspect ratio"), "16:9")
        dialog.get_by_role("button", name="Create project").click()
        made = poll(lambda: next((p for p in owner.get("/api/projects").json()["items"] if p["title"] == exact), None),
                    "80-character title accepted")
        page.goto(f"{app_url.rstrip('/')}/projects/{made['id']}")
        page.get_by_role("button", name="Members", exact=True).click()
        members = page.get_by_role("dialog", name="Project members")
        members.get_by_role("textbox", name="Email").fill(f"nobody-{uuid.uuid4().hex[:8]}@example.invalid")
        members.get_by_role("button", name="Add member").click()
        eventually(page, lambda: "No Gatecut account uses that email." in txt(members), "email field error")
    assert len(owner.get(f"/api/projects/{made['id']}/members").json()["items"]) == 1


def test_wf_roles_live_role_table(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, title = project(owner, "roles", members=(("idris", "editor"), ("maren", "commenter")))
    pic = rows(owner, pid)["Picture"]["id"]
    a = add_text(owner, pid, pic, 0, 100, "A")
    cut = name_cut(owner, pid)
    idris, maren, theo = Api(app_url, "idris"), Api(app_url, "maren"), Api(app_url, "theo")
    before = detail(owner, pid)
    cuts_before = owner.get(f"/api/projects/{pid}/cuts").json()["items"]
    links_before = owner.get(f"/api/projects/{pid}/review-links").json()["items"]
    forbidden = [
        (idris, "POST", f"/api/projects/{pid}/cuts", {"name": uid("c")}),
        (idris, "POST", f"/api/projects/{pid}/cuts/{cut['id']}/approval", None),
        (idris, "POST", f"/api/projects/{pid}/cuts/{cut['id']}/restore", {"op_id": uuid.uuid4().hex, "base_version": 1}),
        (idris, "POST", f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 720}),
        (idris, "POST", f"/api/projects/{pid}/review-links", {"cut_id": cut["id"], "expires_in_seconds": LINK_MAX_S}),
        (idris, "POST", f"/api/projects/{pid}/members", {"email": PEOPLE["pia"][0], "role": "editor"}),
        (idris, "PUT", f"/api/projects/{pid}", {"op_id": uuid.uuid4().hex, "base_version": 1, "aspect_ratio": "1:1"}),
        (idris, "POST", "/api/uploads", {"file_name": "x.png", "bytes": 10, "sha256": "0" * 64, "folder": "Probe"}),
        (idris, "GET", "/api/status", None),
        (idris, "GET", "/api/outbox", None),
        (idris, "POST", "/api/tokens", {"name": uid("tok")}),
        (idris, "PUT", "/api/profile", {"availability": "probe"}),
        (idris, "POST", "/api/kits", {"name": uid("kit"), "text_colour": "ffffff", "box_colour": "000000", "font_weight": 400}),
        (maren, "POST", f"/api/projects/{pid}/ops", {"op_id": uuid.uuid4().hex, "base_version": before["project"]["version"],
                                                    "type": "move", "clip_id": a["id"], "start_frame": 9, "row_id": pic}),
        (maren, "POST", f"/api/projects/{pid}/undo", {"op_id": uuid.uuid4().hex}),
        (maren, "GET", "/api/media", None),
        (maren, "GET", "/api/kits", None),
    ]
    for api, method, path, body in forbidden:
        r = api.c.request(method, path, json=body) if body is not None else api.c.request(method, path)
        err(r, 403, "forbidden", COPY["forbidden"])
    err(theo.get(f"/api/projects/{pid}"), 404, "not_found", COPY["not_found"])
    err(theo.get(f"/api/projects/{pid}/ops?after=0"), 404, "not_found")
    err(theo.post(f"/api/projects/{pid}/comments", {"body": "probe", "frame": 0, "visibility": "team"}), 404, "not_found")
    after = detail(owner, pid)
    assert after["project"]["version"] == before["project"]["version"]
    assert after["clips"] == before["clips"] and after["project"]["aspect_ratio"] == "16:9"
    assert len(after["members"]) == len(before["members"])
    assert owner.get(f"/api/projects/{pid}/cuts").json()["items"] == cuts_before
    assert owner.get(f"/api/projects/{pid}/review-links").json()["items"] == links_before
    assert owner.get(f"/api/projects/{pid}/exports").json()["items"] == []
    assert idris.get("/api/media").status_code == 200
    assert maren.post(f"/api/projects/{pid}/comments", {"body": "probe", "frame": 0, "visibility": "team"}).status_code == 201
    assert maren.post(f"/api/projects/{pid}/cuts/{cut['id']}/approval").status_code == 200
    with screen(browser, app_url, maren, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        assert attr(page.get_by_role("main"), "data-layout") == "editor"
        for name in ["Export", "Name cut", "Share", "Captions", "Members", "Frame size", "Redo", "Apply kit",
                     f"Layer {a['name']}", f"Top left handle {a['name']}"]:
            assert page.get_by_role("button", name=name, exact=True).count() == 0, f"{name} shown to a commenter"
        assert page.get_by_role("button", name="Pin note").count() == 1
        assert page.get_by_role("button", name="Approve cut").count() == 1
        block(page, a["id"]).focus()
        page.keyboard.press("ArrowRight")
        advance(page, 1000)
    assert version(owner, pid) == after["project"]["version"]


def test_wf_roles_live_role_change(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, title = project(owner, "rolechange", members=(("idris", "editor"),))
    a = add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 100)
    idris = Api(app_url, "idris")
    sockets: list = []
    frames_after: list = []
    with screen(browser, app_url, idris, f"/projects/{pid}",
                setup=lambda p: p.on("websocket", lambda ws: sockets.append(ws))) as page:
        wait_editor(page, a["id"])
        eventually(page, lambda: page.get_by_role("button", name="Redo", exact=True).count() == 1, "editor sees Redo")
        eventually(page, lambda: len(sockets) == 1, "one socket open")
        first = sockets[0]
        r = owner.put(f"/api/projects/{pid}/members/{idris.person['id']}", {"role": "commenter"})
        assert r.status_code == 200 and r.json()["role"] == "commenter"
        eventually(page, lambda: f"Your role on {title} is now commenter." in txt(notices(page)), "role notice")
        eventually(page, lambda: page.get_by_role("button", name="Redo", exact=True).count() == 0, "editing controls gone")
        eventually(page, lambda: first.is_closed(), "old socket closed")
        first.on("framereceived", lambda f: frames_after.append(f))
        send(owner, pid, {"type": "set_hidden", "clip_id": a["id"], "hidden": True})
        advance(page, 1000)
        assert frames_after == [], "closed socket received later data"
        assert owner.delete(f"/api/projects/{pid}/members/{idris.person['id']}").status_code == 204
        eventually(page, lambda: f"You no longer have access to {title}." in page.inner_text("main"), "removal copy")
    err(idris.get(f"/api/projects/{pid}"), 404, "not_found")


def test_wf_rushes_upload_resume(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    folder = folder_name()
    data = wav_bytes(os.urandom(((CHUNK_BYTES + 4000) // 2) * 2))
    name = f"{uuid.uuid4().hex[:10]}.wav"
    r = start_upload(owner, data, name, folder)
    assert r.status_code == 201, r.text
    j = r.json()
    assert j["chunk_bytes"] == CHUNK_BYTES and j["chunks"] == 2 and j["chunks_received"] == []
    assert put_chunk(owner, j["upload_id"], 0, data).status_code == 204
    assert put_chunk(owner, j["upload_id"], 0, data).status_code == 204
    again = start_upload(owner, data, name, folder)
    assert again.status_code == 200 and again.json()["upload_id"] == j["upload_id"]
    assert again.json()["chunks_received"] == [0]
    assert media_in(owner, folder) == [], "listed before storage confirmed it"
    err(owner.post(f"/api/uploads/{j['upload_id']}/complete"), 409, "upload_incomplete", "Chunks still missing: 1.")
    chunks_sent: list[str] = []
    path = Path(tempfile.mkdtemp()) / name
    path.write_bytes(data)
    with screen(browser, app_url, owner, "/library") as page:
        page.on("request", lambda q: chunks_sent.append(q.url) if q.method == "PUT" and "/chunks/" in q.url else None)
        bar = page.get_by_role("list", name="Uploads").get_by_role("progressbar", name=name)
        eventually(page, lambda: f"{name} — 50% · choose the file again to resume" in (
            txt(bar) + (attr(bar, "aria-valuetext") or "")), "after-reload copy at 50%", POLL_S)
        page.get_by_label("Upload files").set_input_files(str(path))
        eventually(page, lambda: f"{name} is in the library." in txt(notices(page)), "upload success notice", POLL_S)
    assert [u.rsplit("/", 1)[-1] for u in chunks_sent] == ["1"], chunks_sent
    items = media_in(owner, folder)
    assert len(items) == 1 and items[0]["sha256"] == sha(data) and items[0]["bytes"] == len(data)
    assert items[0]["kind"] == "wav" and items[0]["sample_rate"] == WAV_RATE
    s3 = S3()
    assert s3.keys(f"media/{sha(data)}") == [f"media/{sha(data)}"]
    assert s3.get(f"media/{sha(data)}") == data
    poll(lambda: s3.keys(f"uploads/{j['upload_id']}/") == [], "chunk objects deleted after confirmation")
    assert all(u["sha256"] != sha(data) for u in owner.get("/api/uploads").json()["items"])


REFUSAL_CASES = ["mp4-truncated", "mp4-zero-timescale", "wav-riff-size", "wav-block-align", "png-crc", "svg",
                 "text-named-mp4", "mp4-named-wav", "name-leading-dot", "name-backslash", "name-control"]


def _refusal_file(case: str) -> tuple[bytes, str, str | None]:
    tag = uuid.uuid4().hex[:10]
    if case == "mp4-truncated":
        return mp4_bytes(640, 360, 25000, 50000)[:-7], f"{tag}.mp4", "MP4 header is damaged"
    if case == "mp4-zero-timescale":
        return mp4_bytes(640, 360, 0, 50000), f"{tag}.mp4", "MP4 header is damaged"
    if case == "wav-riff-size":
        return wav_bytes(os.urandom(400), riff_delta=4), f"{tag}.wav", "WAV header is damaged"
    if case == "wav-block-align":
        return wav_bytes(os.urandom(400), align=4), f"{tag}.wav", "WAV header is damaged"
    if case == "png-crc":
        return png_bytes(40, 20, bad_crc=True), f"{tag}.png", "PNG header is damaged"
    if case == "svg":
        return (f'<svg xmlns="http://www.w3.org/2000/svg"><script>alert("{tag}")</script></svg>'.encode(),
                f"{tag}.svg", "unknown file type")
    if case == "text-named-mp4":
        return f"plain text {tag}\n".encode(), f"{tag}.mp4", "unknown file type"
    if case == "mp4-named-wav":
        return mp4_bytes(640, 360, 25000, 50000), f"{tag}.wav", None
    raise AssertionError(case)


@pytest.mark.parametrize("case", REFUSAL_CASES, ids=REFUSAL_CASES)
def test_wf_rushes_upload_refused(browser: Browser, app_url: str, case: str) -> None:
    owner = Api(app_url, "noor")
    folder = folder_name()
    if case.startswith("name-"):
        bad = {"name-leading-dot": ".hidden.png", "name-backslash": "a\\b.png", "name-control": "a\x07b.png"}[case]
        data = png_bytes(4, 4)
        b = err(start_upload(owner, data, bad, folder), 422, "validation")
        assert b["errors"]["file_name"] == \
            "File names are 1 to 120 characters with no slashes, control characters or leading dot."
        assert all(u["sha256"] != sha(data) for u in owner.get("/api/uploads").json()["items"])
        return
    data, name, reason = _refusal_file(case)
    path = Path(tempfile.mkdtemp()) / name
    path.write_bytes(data)
    completes: list = []
    with screen(browser, app_url, owner, "/library") as page:
        page.on("response", lambda resp: completes.append(resp) if resp.url.endswith("/complete") else None)
        page.get_by_label("Upload files").set_input_files(str(path))
        if reason is None:
            eventually(page, lambda: f"{name} is in the library." in txt(notices(page)), "judged by content", POLL_S)
        else:
            eventually(page, lambda: f"Gatecut could not use {name}: {reason}." in txt(notices(page)),
                       "refusal copy with reason", POLL_S)
        eventually(page, lambda: len(completes) >= 1, "complete answered")
        resp_status, resp_body = completes[-1].status, completes[-1].json()
    if reason is None:
        items = media_in(owner, folder) or [m for m in owner.get("/api/media", params={"limit": MAX_PAGE}).json()["items"]
                                            if m["sha256"] == sha(data)]
        mine = [m for m in owner.get("/api/media", params={"q": name.split(".")[0]}).json()["items"]
                if m["sha256"] == sha(data)]
        assert mine and mine[0]["kind"] == "mp4" and mine[0]["width"] == MP4_W and mine[0]["height"] == MP4_H, items
        return
    assert resp_status == 422
    body = resp_body
    assert body["error"] == "upload_refused" and body["reason"] == reason
    assert body["message"] == f"Gatecut could not use {name}: {reason}."
    assert S3().keys(f"media/{sha(data)}") == []
    assert all(m["sha256"] != sha(data) for m in owner.get("/api/media", params={"q": name.split(".")[0]}).json()["items"])


def test_wf_rushes_upload_storage_outage(browser: Browser, app_url: str) -> None:
    down_url = env_url("APP_MINIO_DOWN_URL")
    owner = Api(app_url, "noor")
    down = Api(down_url, "noor")
    assert down.get("/api/status").json()["storage"] == "down"
    err(Api(down_url, "idris").get("/api/status"), 403, "forbidden")
    folder = folder_name()
    data = png_bytes(30, 10)
    err(start_upload(down, data, f"{uuid.uuid4().hex[:8]}.png", folder), 503, "storage_unavailable",
        COPY["storage_unavailable"])
    b = err(down.post("/api/uploads", {"file_name": "x.png", "bytes": 10, "sha256": "nothex", "folder": folder}),
            422, "validation")
    assert "sha256" in b["errors"]
    open_up = start_upload(owner, data, f"{uuid.uuid4().hex[:8]}.png", folder).json()
    err(put_chunk(down, open_up["upload_id"], 0, data), 503, "storage_unavailable")
    pid, _ = project(owner, "s3down")
    add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 100)
    cut = name_cut(owner, pid)
    err(down.post(f"/api/projects/{pid}/exports", {"cut_id": "no-such-cut", "size": 720}), 404, "not_found")
    err(down.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 720}), 503, "storage_unavailable",
        COPY["storage_unavailable"])
    assert owner.get(f"/api/projects/{pid}/exports").json()["items"] == []
    state = owner.get(f"/api/uploads/{open_up['upload_id']}").json()
    assert state["chunks_received"] == [] and state["state"] in ("open", "receiving")
    assert media_in(owner, folder) == [] and S3().keys(f"media/{sha(data)}") == []
    with screen(browser, down_url, down, "/library") as page:
        eventually(page, lambda: COPY["storage_unavailable"] in txt(notices(page)), "storage banner on load", POLL_S)


def test_wf_media_library_duplicate(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    folder = folder_name()
    data = png_bytes(60, 20)
    first = f"{uuid.uuid4().hex[:8]}.png"
    r = upload(owner, data, first, folder)
    assert r.status_code == 201 and r.json()["duplicate"] is False
    media = r.json()["media"]
    second = f"{uuid.uuid4().hex[:8]}.png"
    path = Path(tempfile.mkdtemp()) / second
    path.write_bytes(data)
    used = owner.get("/api/allowance").json()["storage_bytes_used"]
    with screen(browser, app_url, owner, "/library") as page:
        page.get_by_label("Upload files").set_input_files(str(path))
        eventually(page, lambda: f"{second} is already in the library as {first}." in txt(notices(page)),
                   "duplicate copy", POLL_S)
    dup = start_upload(owner, data, second, folder_name())
    assert dup.status_code == 200 and dup.json()["duplicate"] is True and dup.json()["media"]["id"] == media["id"]
    assert [m["id"] for m in media_in(owner, folder)] == [media["id"]]
    assert S3().keys(f"media/{sha(data)}") == [f"media/{sha(data)}"]
    assert owner.get("/api/allowance").json()["storage_bytes_used"] == used


def test_media_peaks_replace(app_url: str, valkey) -> None:
    owner = Api(app_url, "noor")
    folder = folder_name()
    raw = os.urandom(1500 * 2)
    samples = struct.unpack("<1500h", raw)
    r = upload(owner, wav_bytes(raw), f"{uuid.uuid4().hex[:8]}.wav", folder)
    assert r.status_code == 201, r.text
    media = r.json()["media"]
    old_sha = media["sha256"]
    got = owner.get(f"/api/media/{media['id']}/peaks").json()["peaks"]
    assert len(got) == 1000 and all(abs(a - b) < 1e-9 for a, b in zip(got, expected_peaks(samples)))
    kept = valkey.command("GET", f"gatecut:peaks:{old_sha}")
    assert kept and all(abs(a - b) < 1e-9 for a, b in zip(json.loads(kept), got))
    assert Api(app_url, "idris").get(f"/api/media/{media['id']}/peaks").json()["peaks"] == got
    refused = upload(owner, png_bytes(8, 8), f"{uuid.uuid4().hex[:8]}.png", folder, replaces=media["id"])
    assert err(refused, 422, "upload_refused")["reason"] == "replacement must be the same type"
    raw2 = os.urandom(700 * 2)
    r2 = upload(owner, wav_bytes(raw2), f"{uuid.uuid4().hex[:8]}.wav", folder, replaces=media["id"])
    assert r2.status_code == 201, r2.text
    assert r2.json()["media"]["id"] == media["id"] and r2.json()["media"]["name"] == media["name"]
    poll(lambda: valkey.command("GET", f"gatecut:peaks:{old_sha}") is None, "old peaks dropped on replace")
    poll(lambda: S3().keys(f"media/{old_sha}") == [], "old object deleted on replace")
    new = owner.get(f"/api/media/{media['id']}/peaks").json()["peaks"]
    assert all(abs(a - b) < 1e-9 for a, b in zip(new, expected_peaks(struct.unpack("<700h", raw2))))


def test_wf_media_library_search(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    tok = "k" + uuid.uuid4().hex[:9]
    folder = folder_name()
    r = upload(owner, png_bytes(30, 30), f"Probe {tok}.png", folder)
    assert r.status_code == 201, r.text
    mid = r.json()["media"]["id"]

    def search(q: str) -> httpx.Response:
        t0 = time.monotonic()
        resp = owner.get("/api/media", params={"q": q})
        assert time.monotonic() - t0 < SEARCH_BUDGET_S, f"search {q!r} took too long"
        return resp

    def ids(q: str) -> list[str]:
        resp = search(q)
        assert resp.status_code == 200, resp.text
        return [m["id"] for m in resp.json()["items"]]

    assert mid in ids(tok[:4]) and mid in ids(tok.upper()) and mid in ids(f"{tok} probe")
    assert mid not in ids(tok[2:]) and mid not in ids(".*") and mid not in ids(f"{tok}*")
    assert mid not in ids("(a+)+$ " * 4)
    eight = " ".join([tok] + ["p"] * (MAX_TERMS - 1))
    assert mid in ids(eight)
    nine = " ".join([tok] + ["p"] * MAX_TERMS)
    b = err(search(nine), 422, "validation")
    assert b["errors"]["q"] == "Search is limited to 8 words and 200 characters."
    at_cap = tok + " " + "🎬" * (MAX_Q - len(tok) - 1)
    assert search(at_cap).status_code == 200
    err(search(at_cap + "🎬"), 422, "validation")
    with screen(browser, app_url, owner, "/library", 375, 812) as page:
        sheet = page.get_by_role("region", name="Media library")
        eventually(page, lambda: sheet.locator("[data-media-id]").count() >= 2, "library sheet drawn", POLL_S)
        layout(page)
        boxes = [b for b in (el.bounding_box() for el in sheet.locator("[data-media-id]").all()) if b]
        page_w = page.evaluate("() => document.documentElement.clientWidth")
        bands = {0 if (b["x"] + b["width"] / 2) < page_w / 2 else 1 for b in boxes}
        assert bands == {0, 1}, f"two columns at 375 px, saw bands {sorted(bands)} from {[round(b['x']) for b in boxes]}"
        box_ = page.get_by_role("searchbox", name="Search media")
        box_.fill(nine)
        box_.press("Enter")
        eventually(page, lambda: "Search is limited to 8 words and 200 characters." in page.inner_text("main"),
                   "q field error in the library")
        box_.fill(tok)
        box_.press("Enter")
        eventually(page, lambda: sheet.locator(f'[data-media-id="{mid}"]').count() == 1, "result shown")


def test_wf_media_library_delete(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    folder = folder_name()
    used = upload(owner, png_bytes(20, 20), f"{uuid.uuid4().hex[:8]}.png", folder).json()["media"]
    free = upload(owner, png_bytes(22, 22), f"{uuid.uuid4().hex[:8]}.png", folder).json()["media"]
    titles = []
    for label in ["alpha", "beta"]:
        pid, title = project(owner, label)
        add(owner, pid, {"type": "add_clip", "row_id": rows(owner, pid)["Picture"]["id"], "media_id": used["id"],
                         "start_frame": 0})
        titles.append(title)
    titles.sort()
    b = err(owner.delete(f"/api/media/{used['id']}"), 409, "media_in_use", f"{used['name']} is used in {', '.join(titles)}.")
    assert b["projects"] == titles
    with screen(browser, app_url, owner, "/library") as page:
        page.get_by_role("button", name=f"Delete {used['name']}").click()
        dialog = page.get_by_role("dialog", name="Delete media")
        dialog.get_by_role("button", name="Delete", exact=True).click()
        eventually(page, lambda: f"{used['name']} is used in {', '.join(titles)}." in page.inner_text("body"),
                   "media_in_use copy shown")
        page.keyboard.press("Escape")
        page.get_by_role("button", name=f"Delete {free['name']}").click()
        page.get_by_role("dialog", name="Delete media").get_by_role("button", name="Keep").click()
        assert any(m["id"] == free["id"] for m in media_in(owner, folder))
        page.get_by_role("button", name=f"Delete {free['name']}").click()
        page.get_by_role("dialog", name="Delete media").get_by_role("button", name="Delete", exact=True).click()
        poll(lambda: all(m["id"] != free["id"] for m in media_in(owner, folder)), "unused file deleted")
    assert any(m["id"] == used["id"] for m in media_in(owner, folder))
    poll(lambda: S3().keys(f"media/{free['sha256']}") == [], "stored object deleted")
    assert S3().keys(f"media/{used['sha256']}") == [f"media/{used['sha256']}"]


def _geometry(page: Page, owner: Api, pid: str) -> None:
    cv = canvas(page)
    cb = cv.first.bounding_box()
    first = int(attr(cv, "data-first-frame"))
    ppf = float(attr(cv, "data-px-per-frame"))
    for cid, c in clips(owner, pid).items():
        b = block(page, cid)
        if not b.count() or c["hidden"]:
            continue
        bb = b.first.bounding_box()
        assert abs((bb["x"] - cb["x"]) - (c["start_frame"] - first) * ppf) <= 1.5, (cid, ppf)
        assert abs(bb["width"] - (c["end_frame"] - c["start_frame"]) * ppf) <= 1.5, (cid, ppf)


def test_wf_place_and_move_keyboard(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "keys")
    r = rows(owner, pid)
    a = add_text(owner, pid, r["Picture"]["id"], 10, A_END, "A")
    b = add_text(owner, pid, r["Picture"]["id"], 600, 700, "B")
    t = add_text(owner, pid, r["Titles"]["id"], 10, 60, "T")
    v0 = version(owner, pid)
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        block(page, a["id"]).focus()

        def start(cid: str, want: int) -> None:
            poll(lambda: clips(owner, pid)[cid]["start_frame"] == want, f"clip {cid} saved at {want}")

        press_n(page, "ArrowRight", 3)
        start(a["id"], 13)
        page.keyboard.press("Shift+ArrowRight")
        start(a["id"], 13 + NOMINAL["25"])
        page.keyboard.press("ArrowLeft")
        start(a["id"], 37)
        assert active(page) == a["id"]
        press_n(page, "Period", 50)
        eventually(page, lambda: playhead(page) == 50, "playhead at 50")
        page.keyboard.press("KeyS")
        right = poll(lambda: next((c for c in clips(owner, pid).values() if c["start_frame"] == 50 and c["row_id"] == a["row_id"]), None),
                     "right half saved")
        assert clips(owner, pid)[a["id"]]["end_frame"] == 50 and right["end_frame"] == 37 + (A_END - 10)
        eventually(page, lambda: active(page) == a["id"], "focus stays on the left half")
        page.keyboard.press("KeyH")
        poll(lambda: clips(owner, pid)[a["id"]]["hidden"] is True, "hidden saved")
        eventually(page, lambda: attr(block(page, a["id"]), "data-hidden") == "true", "data-hidden true")
        page.keyboard.press("KeyH")
        poll(lambda: clips(owner, pid)[a["id"]]["hidden"] is False, "shown again")
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: active(page) == t["id"], "ArrowUp focuses the clip on the row above")
        page.keyboard.press("Control+KeyG")
        poll(lambda: clips(owner, pid)[t["id"]]["group_id"] and
             clips(owner, pid)[t["id"]]["group_id"] == clips(owner, pid)[a["id"]]["group_id"], "group saved")
        page.keyboard.press("Alt+ArrowDown")
        poll(lambda: rows(owner, pid)["Titles"]["position"] == 2 and rows(owner, pid)["Picture"]["position"] == 1,
             "row reordered")
        block(page, right["id"]).focus()
        page.keyboard.press("Delete")
        poll(lambda: right["id"] not in clips(owner, pid), "remove saved")
        eventually(page, lambda: active(page) == b["id"], "focus moves to the next clip on the row")
        page.keyboard.press("Home")
        eventually(page, lambda: playhead(page) == 0 and attr(canvas(page), "data-first-frame") == "0", "Home")
        eventually(page, lambda: active(page) == t["id"], "Home focuses the first clip")
        page.keyboard.press("End")
        eventually(page, lambda: playhead(page) == 699, "End reaches total_frames - 1")
        eventually(page, lambda: active(page) == b["id"], "End focuses the last clip")
        assert version(owner, pid) - v0 == 11, "every keyboard change saved as one op"
        for _ in range(DEFAULT_ZOOM):
            page.keyboard.press("Minus")
        for level in range(len(ZOOM_PPF)):
            eventually(page, lambda: attr(canvas(page), "data-zoom-level") == str(level), f"zoom level {level}")
            assert float(attr(canvas(page), "data-px-per-frame")) == ZOOM_PPF[level]
            _geometry(page, owner, pid)
            page.keyboard.press("Shift+Equal")


def test_wf_place_and_move_blocked(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "blocked")
    r = rows(owner, pid)
    pic, ttl = r["Picture"]["id"], r["Titles"]["id"]
    a = add_text(owner, pid, pic, 0, 300, "A")
    b = add_text(owner, pid, pic, 400, 700, "B")
    c = add_text(owner, pid, pic, 710, 760, "C")
    t = add_text(owner, pid, ttl, 0, 50, "T")
    j = send(owner, pid, {"type": "move", "clip_id": a["id"], "start_frame": 200, "row_id": pic}).json()
    assert j["stopped"] and j["stopped"]["reason"] == f"{b['name']} is in the way"
    assert isinstance(j["stopped"]["at_frame"], int)
    assert clips(owner, pid)[a["id"]]["start_frame"] == 100
    err(send(owner, pid, {"type": "move", "clip_id": a["id"], "start_frame": 101, "row_id": pic}, None), 409, "blocked",
        f"{a['name']} cannot move: {b['name']} is in the way.")
    err(send(owner, pid, {"type": "move", "clip_id": a["id"], "start_frame": 0, "row_id": ttl}, None), 409, "blocked",
        f"{a['name']} cannot move: the target row is not free.")
    assert send(owner, pid, {"type": "move", "clip_id": a["id"], "start_frame": 0, "row_id": r["Audio"]["id"]}, None).status_code == 422
    assert send(owner, pid, {"type": "move", "clip_id": a["id"], "start_frame": -1, "row_id": pic}, None).status_code == 422
    assert clips(owner, pid)[a["id"]]["start_frame"] == 100 and clips(owner, pid)[a["id"]]["row_id"] == pic
    assert clips(owner, pid)[t["id"]]["start_frame"] == 0
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, b["id"])
        block(page, b["id"]).focus()
        page.keyboard.press("Shift+ArrowRight")
        eventually(page, lambda: txt(notices(page)).startswith("Stopped at ") and
                   txt(notices(page)).rstrip().endswith(f": {c['name']} is in the way."), "stopped-short notice")
        poll(lambda: clips(owner, pid)[b["id"]]["start_frame"] == 410, "stopped at the nearest free frame")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: f"{b['name']} cannot move: {c['name']} is in the way." in txt(notices(page)),
                   "blocked copy in Notices")
    assert clips(owner, pid)[b["id"]]["start_frame"] == 410


def test_wf_trim_speed_split_exact(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "trim", members=(("idris", "editor"),))
    pic = rows(owner, pid)["Picture"]["id"]
    x = add(owner, pid, {"type": "add_clip", "row_id": pic, "media_id": "hl-a002-c011", "start_frame": 10})
    source_frames = rnd(Fraction(288288, 24000) * EXACT["25"])
    add_text(owner, pid, pic, 400, 450, "N")
    cid = x["id"]
    get = lambda: clips(owner, pid)[cid]
    send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": -50, "ripple": False})
    j = send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": 1000, "ripple": False}).json()
    assert j["stopped"]["reason"] == "the source ends there" and get()["source_out"] == source_frames
    err(send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": 1, "ripple": False}, None),
        409, "blocked", f"{x['name']} cannot move: the source ends there.")
    send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "start", "delta_frames": 50, "ripple": False})
    j = send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "start", "delta_frames": -1000, "ripple": False}).json()
    assert j["stopped"]["reason"] == "the source starts there" and get()["source_in"] == 0
    send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": -1, "ripple": False})
    length = get()["source_out"] - get()["source_in"]
    send(owner, pid, {"type": "set_speed", "clip_id": cid, "speed_percent": 200})
    assert get()["end_frame"] - get()["start_frame"] == rnd(Fraction(length * 100, 200))
    err(send(owner, pid, {"type": "set_speed", "clip_id": cid, "speed_percent": SPEED_MIN}, None), 409, "blocked",
        f"{x['name']} cannot move: the new length does not fit.")
    send(owner, pid, {"type": "set_speed", "clip_id": cid, "speed_percent": 100})
    start = get()["start_frame"]
    for f, v in [(0, 0), (100, 100)]:
        send(owner, pid, {"type": "set_keyframe", "clip_id": cid, "property": "opacity", "frame": f, "value": v, "curve": "linear"})
    assert send(owner, pid, {"type": "split", "clip_id": cid, "at_frame": start}, None).status_code == 422
    idris = Api(app_url, "idris")
    with screen(browser, app_url, idris, f"/projects/{pid}") as watch:
        wait_editor(watch, cid)
        listen(watch)
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, cid)
            block(page, cid).focus()
            press_n(page, "Period", start + 40)
            eventually(page, lambda: playhead(page) == start + 40, "playhead inside the clip")
            page.keyboard.press("KeyS")
            right = poll(lambda: next((c for c in clips(owner, pid).values()
                                       if c["id"] != cid and c["name"] == x["name"]), None), "right part saved")
            eventually(page, lambda: active(page) == cid, "focus stays on the left part")
        left = get()
        assert (left["start_frame"], left["end_frame"], left["source_in"], left["source_out"]) == (start, start + 40, 0, 40)
        assert right["start_frame"] == start + 40 and right["source_in"] == 40 and right["source_out"] == length
        assert right["group_id"] == left["group_id"]
        assert any(d["frame"] == 60 and d["value"] == 100 for d in right["keyframes"]["opacity"])
        announced_once(watch, f"Noor Achterberg split {x['name']} at {tc(start + 40, '25')}.")


def test_wf_trim_speed_split_speed_limits(app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "speed")
    pic = rows(owner, pid)["Picture"]["id"]
    x = add(owner, pid, {"type": "add_clip", "row_id": pic, "media_id": "hl-a002-c011", "start_frame": 0})
    length = x["source_out"] - x["source_in"]
    for bad in [SPEED_MIN - 1, SPEED_MAX + 1]:
        r = send(owner, pid, {"type": "set_speed", "clip_id": x["id"], "speed_percent": bad}, None)
        err(r, 422, "validation")
        assert clips(owner, pid)[x["id"]]["end_frame"] == x["end_frame"]
    for good in [SPEED_MIN, SPEED_MAX]:
        send(owner, pid, {"type": "set_speed", "clip_id": x["id"], "speed_percent": good})
        c = clips(owner, pid)[x["id"]]
        assert c["speed_percent"] == good and c["end_frame"] - c["start_frame"] == rnd(Fraction(length * 100, good))
    send(owner, pid, {"type": "set_speed", "clip_id": x["id"], "speed_percent": 200})
    before = clips(owner, pid)[x["id"]]["source_out"]
    send(owner, pid, {"type": "trim", "clip_id": x["id"], "edge": "end", "delta_frames": -10, "ripple": False})
    assert clips(owner, pid)[x["id"]]["source_out"] == before - rnd(Fraction(10 * 200, 100))


def test_wf_trim_speed_split_compound(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "trimc")
    pic = rows(owner, pid)["Picture"]["id"]
    x = add(owner, pid, {"type": "add_clip", "row_id": pic, "media_id": "hl-a002-c011", "start_frame": 10})
    cid = x["id"]
    send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": -50, "ripple": False})
    j = send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": 1000, "ripple": False}).json()
    assert j["stopped"]["reason"] == "the source ends there", j["stopped"]
    send(owner, pid, {"type": "set_speed", "clip_id": cid, "speed_percent": 150})
    after = clips(owner, pid)[cid]
    want_len = rnd(Fraction(after["source_out"] - after["source_in"]) * 100 / 150)
    assert after["end_frame"] - after["start_frame"] == want_len, (after, want_len)
    with screen(browser, app_url, owner, f"/projects/{pid}?zoom=3&clip={cid}") as page:
        wait_editor(page, cid)
        cv = canvas(page)
        eventually(page, lambda: attr(cv, "data-zoom-level") == "3", "the address set the zoom level")
        ppf, first = float(attr(cv, "data-px-per-frame")), int(attr(cv, "data-first-frame"))
        bb, cb = block(page, cid).first.bounding_box(), cv.first.bounding_box()
        assert abs((bb["x"] - cb["x"]) - (after["start_frame"] - first) * ppf) <= 2, (bb, cb, first, ppf)
        assert abs(bb["width"] - want_len * ppf) <= 2, (bb["width"], want_len, ppf)
        err(send(owner, pid, {"type": "trim", "clip_id": cid, "edge": "end", "delta_frames": 1, "ripple": False}, None),
            409, "blocked", f"{x['name']} cannot move: the source ends there.")


def _ripple_project(owner: Api) -> tuple[str, dict, dict, dict, dict]:
    pid, _ = project(owner, "ripple", members=(("idris", "editor"),))
    r = rows(owner, pid)
    b = add_text(owner, pid, r["Picture"]["id"], 100, 200, "B")
    c = add_text(owner, pid, r["Picture"]["id"], 250, 350, "C")
    return pid, r, b, c, add_text(owner, pid, r["Picture"]["id"], 0, 100, "A")


def _pins(owner: Api, pid: str) -> dict[str, int]:
    return {x["body"]: x["pin"]["live_frame"] for x in owner.get(f"/api/projects/{pid}/comments").json()["items"]}


def test_wf_ripple_locked_rows_shift(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, r, b, c, a = _ripple_project(owner)
    pic = r["Picture"]["id"]
    for body, extra in [("rowpin", {"frame": 300, "row_id": pic}), ("clippin", {"frame": 260, "row_id": pic, "clip_id": c["id"]}),
                        ("freepin", {"frame": 270})]:
        assert owner.post(f"/api/projects/{pid}/comments", {"body": body, "visibility": "team", **extra}).status_code == 201
    idris = Api(app_url, "idris")
    with screen(browser, app_url, idris, f"/projects/{pid}") as watch:
        wait_editor(watch, c["id"])
        listen(watch)
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, b["id"])
            block(page, b["id"]).focus()
            page.keyboard.press("Shift+Delete")
            poll(lambda: b["id"] not in clips(owner, pid), "ripple remove saved")
        assert clips(owner, pid)[c["id"]]["start_frame"] == 150
        assert _pins(owner, pid) == {"rowpin": 200, "clippin": 160, "freepin": 270}
        eventually(watch, lambda: attr(block(watch, c["id"]), "data-start-frame") == "150", "second screen follows")
        announced_once(watch, f"Noor Achterberg removed {b['name']}.")
    send(owner, pid, {"type": "trim", "clip_id": a["id"], "edge": "end", "delta_frames": -20, "ripple": True})
    assert clips(owner, pid)[c["id"]]["start_frame"] == 150 - 20
    assert send(owner, pid, {"type": "trim", "clip_id": a["id"], "edge": "start", "delta_frames": 5, "ripple": True}, None).status_code == 422


def test_wf_ripple_locked_rows_refused(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, r, b, c, _ = _ripple_project(owner)
    t = add_text(owner, pid, r["Titles"]["id"], 250, 300, "T")
    send(owner, pid, {"type": "group", "clip_ids": [c["id"], t["id"]]})
    send(owner, pid, {"type": "lock_row", "row_id": r["Titles"]["id"], "locked": True})
    assert owner.post(f"/api/projects/{pid}/comments", {"body": "rowpin", "frame": 300, "row_id": r["Picture"]["id"],
                                                        "visibility": "team"}).status_code == 201
    before, pins, v = clips(owner, pid), _pins(owner, pid), version(owner, pid)
    err(send(owner, pid, {"type": "remove", "clip_id": b["id"], "ripple": True}, None), 409, "row_locked", "Titles is locked.")
    idris = Api(app_url, "idris")
    with screen(browser, app_url, idris, f"/projects/{pid}") as watch:
        wait_editor(watch, c["id"])
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, b["id"])
            block(page, b["id"]).focus()
            page.keyboard.press("Shift+Delete")
            eventually(page, lambda: "Titles is locked." in txt(notices(page)), "row_locked copy in Notices")
        advance(watch, 1000)
        for cid, clip in before.items():
            assert attr(block(watch, cid), "data-start-frame") == str(clip["start_frame"])
        pin = timeline(watch).locator("[data-comment-id]")
        assert attr(pin, "data-frame") == "300"
    assert clips(owner, pid) == before and _pins(owner, pid) == pins and version(owner, pid) == v


def _group_project(owner: Api, blocker: bool) -> tuple[str, dict, dict, dict, dict | None]:
    pid, _ = project(owner, "group")
    r = rows(owner, pid)
    p = add_text(owner, pid, r["Picture"]["id"], 10, 110, "P")
    t = add_text(owner, pid, r["Titles"]["id"], 20, 70, "T")
    t2 = add_text(owner, pid, r["Titles"]["id"], 70, 120, "U") if blocker else None
    return pid, r, p, t, t2


def test_wf_clip_groups_move(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, r, p, t, _ = _group_project(owner, False)
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, p["id"])
        block(page, p["id"]).focus()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: active(page) == t["id"], "focus on the Titles clip")
        page.keyboard.press("Control+KeyG")
        gid = poll(lambda: clips(owner, pid)[p["id"]]["group_id"], "group saved")
        assert clips(owner, pid)[t["id"]]["group_id"] == gid
        page.keyboard.press("ArrowRight")
        poll(lambda: clips(owner, pid)[p["id"]]["start_frame"] == 11 and clips(owner, pid)[t["id"]]["start_frame"] == 21,
             "both members moved one frame")
        outline = page.locator(f'[data-group-outline="{gid}"]')
        eventually(page, lambda: outline.count() == 1, "group outline drawn")
        assert attr(outline, "data-group-first-row") == r["Titles"]["id"]
        assert attr(outline, "data-group-last-row") == r["Picture"]["id"]
        cv = canvas(page)
        cb, ob = cv.first.bounding_box(), outline.first.bounding_box()
        first, ppf = int(attr(cv, "data-first-frame")), float(attr(cv, "data-px-per-frame"))
        assert abs(ob["x"] - cb["x"] - (11 - first) * ppf) <= 1.5
        assert abs(ob["x"] + ob["width"] - cb["x"] - (111 - first) * ppf) <= 1.5
    send(owner, pid, {"type": "trim", "clip_id": p["id"], "edge": "end", "delta_frames": -10, "ripple": False})
    assert clips(owner, pid)[p["id"]]["end_frame"] == 101 and clips(owner, pid)[t["id"]]["end_frame"] == 61
    assert send(owner, pid, {"type": "move", "clip_id": p["id"], "start_frame": 11, "row_id": r["Titles"]["id"]},
                None).status_code == 422


def test_wf_clip_groups_refused(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _, p, t, t2 = _group_project(owner, True)
    send(owner, pid, {"type": "group", "clip_ids": [p["id"], t["id"]]})
    before = clips(owner, pid)
    copy = f"The group cannot move: {t['name']} {t2['name']} is in the way."
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, p["id"])
        block(page, p["id"]).focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: copy in txt(notices(page)), "group_blocked copy in Notices")
        assert active(page) == p["id"]
    err(send(owner, pid, {"type": "move", "clip_id": p["id"], "start_frame": 12, "row_id": p["row_id"]}, None),
        409, "group_blocked", copy)
    assert clips(owner, pid) == before


def test_wf_clip_groups_refused_compound(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, r, p, t, t2 = _group_project(owner, True)
    owner.post(f"/api/projects/{pid}/members", {"email": PEOPLE["idris"][0], "role": "editor"})
    send(owner, pid, {"type": "group", "clip_ids": [p["id"], t["id"]]})
    gid = clips(owner, pid)[p["id"]]["group_id"]
    before = clips(owner, pid)
    copy = f"The group cannot move: {t['name']} {t2['name']} is in the way."
    with screen(browser, app_url, idris, f"/projects/{pid}") as watch:
        wait_editor(watch, p["id"])
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, p["id"])
            block(page, p["id"]).focus()
            page.keyboard.press("ArrowRight")
            eventually(page, lambda: copy in txt(notices(page)), "the group_blocked copy reaches Notices")
            assert active(page) == p["id"], f"focus left the current member: {active(page)}"
            assert clips(owner, pid) == before, "a refused group move changed the timeline"
            outline = timeline(page).locator(f'[data-group-outline="{gid}"]')
            eventually(page, lambda: outline.count() == 1, "the group outline is still drawn")
            rows_by_id = {row["id"]: row for row in rows(owner, pid).values()}
            top = min((rows_by_id[c["row_id"]]["position"], c["row_id"]) for c in (before[p["id"]], before[t["id"]]))
            bottom = max((rows_by_id[c["row_id"]]["position"], c["row_id"]) for c in (before[p["id"]], before[t["id"]]))
            assert attr(outline, "data-group-first-row") == top[1], attr(outline, "data-group-first-row")
            assert attr(outline, "data-group-last-row") == bottom[1], attr(outline, "data-group-last-row")
            cv = canvas(page)
            ppf, first = float(attr(cv, "data-px-per-frame")), int(attr(cv, "data-first-frame"))
            ob, cb = outline.first.bounding_box(), cv.first.bounding_box()
            start = min(before[p["id"]]["start_frame"], before[t["id"]]["start_frame"])
            end = max(before[p["id"]]["end_frame"], before[t["id"]]["end_frame"])
            assert abs((ob["x"] - cb["x"]) - (start - first) * ppf) <= 2, (ob, cb, start, first, ppf)
            assert abs(ob["width"] - (end - start) * ppf) <= 2, (ob["width"], end, start, ppf)
        for cid in (p["id"], t["id"]):
            assert attr(block(watch, cid), "data-start-frame") == str(before[cid]["start_frame"]), cid


def test_wf_undo_redo_own(browser: Browser, app_url: str) -> None:
    owner, idris, pia = Api(app_url, "noor"), Api(app_url, "idris"), Api(app_url, "pia")
    pid, _ = project(owner, "undo", members=(("idris", "editor"), ("pia", "editor")))
    pic = rows(owner, pid)["Picture"]["id"]
    x = add_text(owner, pid, pic, 0, 50, "X")
    y = add_text(owner, pid, pic, 100, 150, "Y")
    send(owner, pid, {"type": "move", "clip_id": x["id"], "start_frame": 10, "row_id": pic})
    send(idris, pid, {"type": "move", "clip_id": y["id"], "start_frame": 110, "row_id": pic})
    send(idris, pid, {"type": "move", "clip_id": x["id"], "start_frame": 13, "row_id": pic})
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, y["id"])
        block(page, y["id"]).focus()
        page.keyboard.press("Control+KeyZ")
        poll(lambda: clips(owner, pid)[x["id"]]["start_frame"] == 3, "undo moved X back by 10 from its current place")
        assert clips(owner, pid)[y["id"]]["start_frame"] == 110
        page.keyboard.press("Control+Shift+KeyZ")
        poll(lambda: clips(owner, pid)[x["id"]]["start_frame"] == 13, "redo re-applied")
    err(pia.post(f"/api/projects/{pid}/undo", {"op_id": uuid.uuid4().hex}), 409, "nothing_to_undo", COPY["nothing_to_undo"])
    err(pia.post(f"/api/projects/{pid}/redo", {"op_id": uuid.uuid4().hex}), 409, "nothing_to_redo", COPY["nothing_to_redo"])
    assert owner.post(f"/api/projects/{pid}/undo", {"op_id": uuid.uuid4().hex}).status_code == 200
    send(owner, pid, {"type": "move", "clip_id": y["id"], "start_frame": 120, "row_id": pic})
    err(owner.post(f"/api/projects/{pid}/redo", {"op_id": uuid.uuid4().hex}), 409, "nothing_to_redo")


def test_wf_undo_redo_blocked(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, _ = project(owner, "undoblock", members=(("idris", "editor"),))
    pic = rows(owner, pid)["Picture"]["id"]
    x = add_text(owner, pid, pic, 0, 50, "X")
    send(owner, pid, {"type": "move", "clip_id": x["id"], "start_frame": 200, "row_id": pic})
    z = add_text(idris, pid, pic, 0, 50, "Z")
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, x["id"])
        block(page, x["id"]).focus()
        page.keyboard.press("Control+KeyZ")
        eventually(page, lambda: f"Undo would overlap {z['name']} on Picture." in txt(notices(page)), "undo_blocked copy")
    assert clips(owner, pid)[x["id"]]["start_frame"] == 200
    pid2, _ = project(owner, "undomiss", members=(("idris", "editor"),))
    pic2 = rows(owner, pid2)["Picture"]["id"]
    w = add_text(owner, pid2, pic2, 300, 350, "W")
    send(owner, pid2, {"type": "move", "clip_id": w["id"], "start_frame": 400, "row_id": pic2})
    send(idris, pid2, {"type": "remove", "clip_id": w["id"], "ripple": False})
    err(owner.post(f"/api/projects/{pid2}/undo", {"op_id": uuid.uuid4().hex}), 409, "undo_missing",
        f"Undo needs {w['name']}, which was removed.")


DIALOGS = [("Name cut", "Name cut"), ("Share", "Share for review"), ("Export", "Export cut"), ("Captions", "Captions"),
           ("Members", "Project members"), ("Frame size", "Frame size"), ("Compare cuts", "Compare cuts")]


def test_wf_undo_redo_dialogs(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "dialogs")
    a = add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 100)
    name_cut(owner, pid)
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        for opener_name, dialog_name in DIALOGS:
            opener = page.get_by_role("button", name=opener_name, exact=True)
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name=dialog_name)
            eventually(page, lambda: dialog.count() == 1, f"{dialog_name} open")
            eventually(page, lambda: dialog.evaluate("el => el.contains(document.activeElement)"), f"focus in {dialog_name}")
            trapped(page, dialog)
            page.keyboard.press("Escape")
            eventually(page, lambda: dialog.count() == 0, f"{dialog_name} closed on Escape")
            assert is_focused(opener), f"focus returned to {opener_name}"


def _kf_project(owner: Api, members: tuple = ()) -> tuple[str, dict]:
    pid, _ = project(owner, "kf", members=members)
    k = add(owner, pid, {"type": "add_clip", "row_id": rows(owner, pid)["Picture"]["id"], "media_id": "hl-a002-c011",
                         "start_frame": 0})
    return pid, k


def _layer(owner: Api, pid: str, frame: int, cid: str) -> dict:
    return next(x for x in owner.get(f"/api/projects/{pid}/frames/{frame}").json()["layers"] if x["clip_id"] == cid)


def test_wf_keyframes_curves(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, k = _kf_project(owner)
    opacity = [{"frame": 0, "value": 0, "curve": "eased"}, {"frame": 24, "value": 100, "curve": "linear"}]
    scale = [{"frame": 0, "value": 100, "curve": "linear"}, {"frame": 240, "value": 120, "curve": "linear"}]
    for prop, ds in [("opacity", opacity), ("scale", scale)]:
        for d in ds:
            send(owner, pid, {"type": "set_keyframe", "clip_id": k["id"], "property": prop, **d})
    for f in list(range(0, 31)) + [120, 240, 299]:
        layer = _layer(owner, pid, f, k["id"])
        assert abs(layer["opacity"] - round2(kf_value(opacity, f))) < 1e-9, (f, layer["opacity"])
        assert abs(layer["scale"] - round2(kf_value(scale, f))) < 1e-9, (f, layer["scale"])
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, k["id"])
        box_ = page.get_by_role("region", name="Stage").locator(f'[data-layer-box="{k["id"]}"]')
        insp = prop_row(page, OPACITY)
        block(page, k["id"]).focus()
        for f in range(0, 27):
            want = round2(kf_value(opacity, f))
            eventually(page, lambda: playhead(page) == f and attr(box_, "data-opacity") is not None
                       and abs(float(attr(box_, "data-opacity")) - want) < 0.001, f"stage opacity at frame {f}")
            assert f"{want:.2f}" in txt(insp), (f, txt(insp))
            page.keyboard.press("Period")
        x, y = frame_point(page, 12)
        page.mouse.move(x, y)
        stage = page.get_by_role("region", name="Stage")
        eventually(page, lambda: attr(stage, "data-stage-mode") == "skim" and attr(stage, "data-stage-frame") == "12", "skim at 12")
        want = round2(kf_value(opacity, 12))
        assert abs(float(attr(box_, "data-opacity")) - want) < 0.001 and f"{want:.2f}" in txt(insp)


def test_wf_keyframes_remote(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, k = _kf_project(owner, (("idris", "editor"),))
    before = clips(owner, pid)[k["id"]]["keyframes"]
    for prop, value in [("opacity", 101), ("opacity", -1), ("scale", 0), ("scale", 1001), ("rotation", 3601), ("x", 10001)]:
        r = send(idris, pid, {"type": "set_keyframe", "clip_id": k["id"], "property": prop, "frame": 0, "value": value,
                              "curve": "linear"}, None)
        err(r, 422, "validation")
    r = send(idris, pid, {"type": "set_keyframe", "clip_id": k["id"], "property": "blur", "frame": 0, "value": 1,
                          "curve": "linear"}, None)
    err(r, 422, "validation")
    assert clips(owner, pid)[k["id"]]["keyframes"] == before
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, k["id"])
        block(page, k["id"]).focus()
        listen(page)
        send(idris, pid, {"type": "set_keyframe", "clip_id": k["id"], "property": "opacity", "frame": 0, "value": 40,
                          "curve": "linear"})
        box_ = page.get_by_role("region", name="Stage").locator(f'[data-layer-box="{k["id"]}"]')
        insp = prop_row(page, OPACITY)
        eventually(page, lambda: abs(float(attr(box_, "data-opacity") or -1) - 40) < 0.001 and "40.00" in txt(insp),
                   "stage and Inspector show 40.00")
        announced_once(page, "Idris Fallowfield edited the timeline.")


def test_wf_keyframes_split_compound(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, k = _kf_project(owner, (("idris", "editor"),))
    ds = [{"frame": 0, "value": 10, "curve": "linear"}, {"frame": 24, "value": 90, "curve": "linear"},
          {"frame": 72, "value": 30, "curve": "linear"}]
    for d in ds:
        send(owner, pid, {"type": "set_keyframe", "clip_id": k["id"], "property": OPACITY, **d})
    at = clips(owner, pid)[k["id"]]["start_frame"] + 48
    with screen(browser, app_url, idris, f"/projects/{pid}") as watch:
        wait_editor(watch, k["id"])
        listen(watch)
        with screen(browser, app_url, owner, f"/projects/{pid}?frame={at}&clip={k['id']}&panel=inspector") as page:
            wait_editor(page, k["id"])
            block(page, k["id"]).focus()
            eventually(page, lambda: playhead(page) == at, "the address put the playhead on the split frame")
            page.keyboard.press("s")
            eventually(page, lambda: len(clips(owner, pid)) == 2, "the clip is split in two")
            now = clips(owner, pid)
            left, right = now[k["id"]], next(c for i, c in now.items() if i != k["id"])
            assert {d["frame"]: d["value"] for d in right["keyframes"][OPACITY]}.get(24) == 30, right["keyframes"]
            assert active(page) == k["id"], f"focus left the left part: {active(page)}"
            want = round2(kf_value(right["keyframes"][OPACITY], 0))
            box_ = page.get_by_role("region", name="Stage").locator(f'[data-layer-box="{right["id"]}"]')
            eventually(page, lambda: attr(box_, "data-opacity") is not None
                       and abs(float(attr(box_, "data-opacity")) - want) < 0.001, "the stage holds the split value")
            page.keyboard.press("Comma")
            eventually(page, lambda: playhead(page) == at - 1, "the playhead stepped back into the left part")
            want_left = round2(kf_value(left["keyframes"][OPACITY], at - 1 - left["start_frame"]))
            assert f"{want_left:.2f}" in txt(prop_row(page, OPACITY)), txt(prop_row(page, OPACITY))
        announced_once(watch, f"{PEOPLE['noor'][2]} split {k['name']} at {tc(at, '25')}.")


def _loupe_project(owner: Api) -> tuple[str, dict, dict]:
    pid, _ = project(owner, "loupe", members=(("idris", "editor"),))
    pic = rows(owner, pid)["Picture"]["id"]
    k = add_text(owner, pid, pic, 0, 100, "K")
    l2 = add_text(owner, pid, pic, 104, 200, "L")
    send(owner, pid, {"type": "add_marker", "frame": 50, "label": "M"})
    return pid, k, l2


def _loupe(page: Page):
    return page.get_by_role("group", name="Frame Loupe")


def _centre(page: Page) -> str | None:
    return attr(page.locator("[data-loupe-centre]"), "data-loupe-frame")


def _guide_shown(page: Page) -> bool:
    g = page.locator("[data-snap-guide]")
    return any(el.is_visible() for el in g.all())


def test_wf_stage_skim_loupe_skim(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, k, l2 = _loupe_project(owner)
    with screen(browser, app_url, idris, f"/projects/{pid}") as other:
        wait_editor(other, k["id"])
        block(other, k["id"]).focus()
        press_n(other, "Period", 7)
        advance(other, 1000)
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, k["id"])
            remote = remote_playhead(page, "Idris Fallowfield")

            def idris_drawn() -> bool:
                press_n(other, "Period", 1)
                advance(other, 300)
                return remote.count() == 1

            eventually(page, idris_drawn, "Idris's playhead drawn")
            listen(page)
            remote_box, url, v = remote.first.bounding_box(), page.url, version(owner, pid)
            x, y = frame_point(page, 60)
            page.mouse.move(x, y)
            advance(page, LOUPE_MS)
            loupe = _loupe(page)
            assert loupe.count() == 1 and loupe.first.is_visible()
            for a in animations(loupe):
                assert float(a.get("duration") or 0) + float(a.get("delay") or 0) <= LOUPE_MS
            cells = [int(c.get_attribute("data-loupe-frame")) for c in page.locator("[data-loupe-frame]").all()]
            assert sorted(cells) == list(range(56, 65))
            assert _centre(page) == "60" and tc(60, "25") in txt(page.locator("[data-loupe-centre]"))
            stage = page.get_by_role("region", name="Stage")
            assert attr(stage, "data-stage-mode") == "skim" and attr(stage, "data-stage-frame") == "60"
            settle(loupe)
            lb = loupe.first.bounding_box()
            assert abs(lb["width"] - LOUPE_W) <= 1 and abs(lb["height"] - LOUPE_H) <= 1
            want_x = min(max(x, LOUPE_W / 2), page.viewport_size["width"] - LOUPE_W / 2)
            assert abs(lb["y"] + lb["height"] - (y - LOUPE_GAP)) <= 1 and abs(lb["x"] + lb["width"] / 2 - want_x) <= 1
            assert playhead(page) == 0 and page.url == url
            send(idris, pid, {"type": "move", "clip_id": l2["id"], "start_frame": 110, "row_id": l2["row_id"]})
            announced_once(page, f"Idris Fallowfield moved {l2['name']} to {tc(110, '25')}.")
            assert remote.first.bounding_box() == remote_box
            sb = stage.first.bounding_box()
            page.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
            advance(page, STAGE_RETURN_MS)
            assert attr(stage, "data-stage-mode") == "playhead"
            assert loupe.count() == 0 or not loupe.first.is_visible()
            assert version(owner, pid) == v + 1 and page.url == url


def test_wf_stage_skim_loupe_snap_keys(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, k, _ = _loupe_project(owner)
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, k["id"])
        for pointer, centre, guide in [(102, 100, True), (103, 104, True), (52, 50, True), (60, 60, False), (75, 75, False)]:
            page.mouse.move(*frame_point(page, pointer))
            eventually(page, lambda: _centre(page) == str(centre), f"pointer {pointer} centres on {centre}", SLACK_S)
            assert _guide_shown(page) is guide, f"guide at pointer {pointer}"
        page.mouse.move(0, 0)
        advance(page, STAGE_RETURN_MS)
        block(page, k["id"]).focus()
        page.keyboard.press("KeyL")
        eventually(page, lambda: _centre(page) == "0", "L pins the loupe at the playhead")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: _centre(page) == "1", "Right moves the loupe")
        page.keyboard.press("Shift+ArrowRight")
        eventually(page, lambda: _centre(page) == str(1 + NOMINAL["25"]), "Shift+Right moves one second")
        assert clips(owner, pid)[k["id"]]["start_frame"] == 0, "the clip was not nudged"
        page.keyboard.press("Enter")
        eventually(page, lambda: playhead(page) == 1 + NOMINAL["25"], "Enter moves the playhead")
        page.keyboard.press("Escape")
        eventually(page, lambda: _loupe(page).count() == 0 or not _loupe(page).first.is_visible(), "Escape closes")
        assert active(page) == k["id"]


def test_wf_stage_skim_loupe_reduced_motion(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, k, _ = _loupe_project(owner)
    with screen(browser, app_url, owner, f"/projects/{pid}", reduced="reduce") as page:
        wait_editor(page, k["id"])
        page.mouse.move(*frame_point(page, 102))
        advance(page, 0)
        loupe = _loupe(page)
        eventually(page, lambda: loupe.count() == 1, "loupe present", SLACK_S)
        assert all(float(a.get("duration") or 0) == 0 for a in animations(loupe)), animations(loupe)
        assert page.locator("[data-loupe-frame]").count() == 9 and _centre(page) == "100" and _guide_shown(page)
        assert attr(page.get_by_role("region", name="Stage"), "data-stage-mode") == "skim"
        page.mouse.move(0, 0)
        advance(page, 0)
        eventually(page, lambda: attr(page.get_by_role("region", name="Stage"), "data-stage-mode") == "playhead", "instant return", SLACK_S)
        block(page, k["id"]).focus()
        page.keyboard.press("KeyL")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: _centre(page) == "1", "keyboard pinning works")
        page.goto(app_url.rstrip("/") + "/")
        sheet = page.get_by_role("region", name="Projects")
        group = sheet.get_by_role("group", name="Harbour Light 30s", exact=True)
        eventually(page, lambda: group.count() == 1, "seeded run drawn", POLL_S)
        group.hover()
        assert all(float(a.get("duration") or 0) == 0 for a in animations(sheet)), "dimming animates under reduced motion"


def test_reduced_motion_effects(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, k, _ = _loupe_project(owner)
    with screen(browser, app_url, owner, f"/projects/{pid}", reduced="reduce") as page:
        wait_editor(page, k["id"])
        page.mouse.move(*frame_point(page, 60))
        advance(page, 0)
        loupe = _loupe(page)
        eventually(page, lambda: loupe.count() == 1, "loupe present", SLACK_S)
        assert all(float(a.get("duration") or 0) == 0 for a in animations(loupe)), animations(loupe)
        stage = page.get_by_role("region", name="Stage")
        assert attr(stage, "data-stage-mode") == "skim"
        page.mouse.move(0, 0)
        advance(page, 0)
        eventually(page, lambda: attr(stage, "data-stage-mode") == "playhead", "instant stage return", SLACK_S)
        assert all(float(a.get("duration") or 0) == 0 for a in animations(stage)), animations(stage)
        page.goto(app_url.rstrip("/") + "/")
        sheet = page.get_by_role("region", name="Projects")
        group = sheet.get_by_role("group", name="Harbour Light 30s", exact=True)
        eventually(page, lambda: group.count() == 1, "seeded run drawn", POLL_S)
        group.hover()
        assert all(float(a.get("duration") or 0) == 0 for a in animations(sheet)), "dimming animates under reduced motion"


def test_wf_playback_and_zoom_playback(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, _ = project(owner, "play", rate="23.976", members=(("idris", "editor"),))
    r = rows(owner, pid)
    c = add_text(owner, pid, r["Picture"]["id"], 0, 3000, "P")
    m = add_text(owner, pid, r["Titles"]["id"], 0, 50, "M")
    with screen(browser, app_url, owner, f"/projects/{pid}", reduced="reduce") as page:
        wait_editor(page, c["id"])
        listen(page)
        block(page, c["id"]).focus()
        url, v = page.url, version(owner, pid)
        page.keyboard.press("Space")
        advance(page, 100000)
        p = playhead(page)
        want = math.floor(100 * EXACT["23.976"])
        assert want - 2 <= p <= want, f"playhead {p} after 100 s, expected about {want}"
        page.keyboard.press("Space")
        send(idris, pid, {"type": "move", "clip_id": m["id"], "start_frame": 60, "row_id": m["row_id"]})
        announced_once(page, f"Idris Fallowfield moved {m['name']} to {tc(60, '23.976')}.")
        page.keyboard.press("Home")
        press_n(page, "Period", 10)
        page.keyboard.press("KeyI")
        press_n(page, "Period", 10)
        page.keyboard.press("KeyO")
        press_n(page, "Comma", 10)
        eventually(page, lambda: playhead(page) == 10, "playhead at the in frame")
        url = page.url
        page.keyboard.press("Space")
        for _ in range(8):
            advance(page, 300)
            assert 10 <= playhead(page) < 20, f"playhead {playhead(page)} left the range"
        page.keyboard.press("Space")
        assert page.url == url, "playback wrote the address"
    assert version(owner, pid) == v + 1, "playback saved a change"


def test_wf_playback_and_zoom_zoom(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "zoom")
    pic = rows(owner, pid)["Picture"]["id"]
    first_c = add_text(owner, pid, pic, 0, 100, "F")
    add_text(owner, pid, pic, 1000, 1100, "G")
    last_c = add_text(owner, pid, pic, FAR_START, FAR_END, "H")
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, first_c["id"])
        cv = canvas(page)
        block(page, first_c["id"]).focus()
        page.keyboard.press("End")
        eventually(page, lambda: playhead(page) == LAST_FRAME, "End at total - 1")

        def view() -> tuple[int, int, float]:
            return int(attr(cv, "data-first-frame")), int(attr(cv, "data-visible-frames")), float(attr(cv, "data-px-per-frame"))

        for key, level in [("Minus", 1), ("Minus", 0), ("Shift+Equal", 1), ("Shift+Equal", 2), ("Shift+Equal", 3),
                           ("Shift+Equal", 4), ("Shift+Equal", 5)]:
            page.keyboard.press(key)
            eventually(page, lambda: attr(cv, "data-zoom-level") == str(level), f"zoom level {level}")
            first, vis, ppf = view()
            assert ppf == ZOOM_PPF[level]
            assert vis == math.floor(cv.first.evaluate("el => el.clientWidth") / ppf)
            assert first == max(0, LAST_FRAME - vis // 2) and playhead(page) == LAST_FRAME
        assert page.get_by_role("button", name="Zoom in").is_disabled()
        for level in range(5, -1, -1):
            page.keyboard.press("Home")
            eventually(page, lambda: playhead(page) == 0 and attr(cv, "data-first-frame") == "0", f"Home at {level}")
            eventually(page, lambda: active(page) == first_c["id"], "Home focuses the first clip")
            page.keyboard.press("End")
            eventually(page, lambda: playhead(page) == LAST_FRAME, f"End at {level}")
            first, vis, _ = view()
            assert first == max(0, FAR_END - vis)
            eventually(page, lambda: active(page) == last_c["id"], "End focuses the last clip")
            if vis >= 100:
                assert first <= FAR_START and FAR_END <= first + vis, "last clip fully in view"
            if level:
                page.keyboard.press("Minus")
        assert page.get_by_role("button", name="Zoom out").is_disabled()


def _co_project(owner: Api, n: int = 3) -> tuple[str, list[dict]]:
    pid, _ = project(owner, "co", members=(("idris", "editor"),))
    pic = rows(owner, pid)["Picture"]["id"]
    return pid, [add_text(owner, pid, pic, i * 200, i * 200 + 50, chr(65 + i)) for i in range(n)]


def test_wf_co_editing_two_browsers(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, (a, _, _) = _co_project(owner)
    with screen(browser, app_url, owner, f"/projects/{pid}") as mine, \
            screen(browser, app_url, idris, f"/projects/{pid}") as theirs:
        wait_editor(mine, a["id"])
        wait_editor(theirs, a["id"])
        block(theirs, a["id"]).focus()
        press_n(theirs, "ArrowRight", 3)
        eventually(mine, lambda: attr(block(mine, a["id"]), "data-start-frame") == "3", "owner sees Idris's nudge")
        eventually(mine, lambda: "Idris Fallowfield" in txt(timeline(mine)), "Idris's name on the owner's timeline")
        block(mine, a["id"]).focus()
        press_n(mine, "Period", 5)
        advance(mine, 1000)
        remote = remote_playhead(theirs, "Noor Achterberg")
        eventually(theirs, lambda: (advance(mine, STEP_MS), remote.count() == 1)[1], "owner playhead drawn for Idris")
        cv = canvas(theirs)
        cb, rb = cv.first.bounding_box(), remote.first.bounding_box()
        first, ppf = int(attr(cv, "data-first-frame")), float(attr(cv, "data-px-per-frame"))
        assert abs(rb["x"] - cb["x"] - (5 - first) * ppf) <= 2
        mine.keyboard.press("ArrowLeft")
        eventually(theirs, lambda: attr(block(theirs, a["id"]), "data-start-frame") == "2", "Idris sees owner's nudge")


def test_wf_co_editing_first_save(app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, (a, b, _) = _co_project(owner)
    pic = a["row_id"]
    v = version(owner, pid)
    gate = threading.Barrier(2)

    def go(api: Api, target: int) -> tuple[Api, int, httpx.Response]:
        body = {"op_id": uuid.uuid4().hex, "base_version": v, "type": "move", "clip_id": a["id"], "start_frame": target,
                "row_id": pic}
        gate.wait()
        return api, target, api.post(f"/api/projects/{pid}/ops", body)

    with ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda x: go(*x), [(owner, 20), (idris, 30)]))
    wins = [x for x in results if x[2].status_code == 200]
    loses = [x for x in results if x[2].status_code == 412]
    assert len(wins) == 1 and len(loses) == 1, [x[2].status_code for x in results]
    winner, target, _ = wins[0]
    body = err(loses[0][2], 412, "conflict",
               f"{winner.name} changed {a['name']} first. Your change to it was not saved.")
    assert body["winner"] == winner.name
    assert any(i.get("id") == a["id"] and i.get("start_frame") == target for i in body["items"])
    assert clips(owner, pid)[a["id"]]["start_frame"] == target
    loser = loses[0][0]
    op_id = uuid.uuid4().hex
    first = loser.post(f"/api/projects/{pid}/ops", {"op_id": op_id, "base_version": v, "type": "move",
                                                    "clip_id": b["id"], "start_frame": OTHER_START, "row_id": pic})
    assert first.status_code == 200 and clips(owner, pid)[b["id"]]["start_frame"] == OTHER_START
    v2 = version(owner, pid)
    again = loser.post(f"/api/projects/{pid}/ops", {"op_id": op_id, "base_version": v, "type": "move",
                                                    "clip_id": b["id"], "start_frame": OTHER_START, "row_id": pic})
    assert again.status_code == 200 and again.json()["version"] == first.json()["version"]
    assert version(owner, pid) == v2, "a replayed op_id applied twice"


def test_wf_co_editing_replay(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, (a, b, c) = _co_project(owner)
    routes: list = []

    def setup(p: Page) -> None:
        def handler(ws: Any) -> None:
            routes.append((ws, ws.connect_to_server()))
        p.route_web_socket(re.compile(r"/api/live"), handler)

    with screen(browser, app_url, owner, f"/projects/{pid}", setup=setup) as page:
        wait_editor(page, a["id"])
        listen(page)
        advance(page, 2000)
        assert len(routes) == 1, f"{len(routes)} sockets for one page"
        ws, server = routes[0]
        ws.close()
        server.close()
        send(idris, pid, {"type": "move", "clip_id": a["id"], "start_frame": 30, "row_id": a["row_id"]})
        send(idris, pid, {"type": "set_hidden", "clip_id": b["id"], "hidden": True})
        block(page, c["id"]).focus()
        page.keyboard.press("ArrowRight")
        poll(lambda: clips(owner, pid)[c["id"]]["start_frame"] == 401, "own edit saved over HTTP during the drop")
        eventually(page, lambda: len(routes) == 2, "reconnected after backoff", SLACK_S + 8)
        eventually(page, lambda: attr(block(page, a["id"]), "data-start-frame") == "30"
                   and attr(block(page, b["id"]), "data-hidden") == "true", "missed ops replayed")
        announced_once(page, f"Idris Fallowfield moved {a['name']} to {tc(30, '25')}.")
        announced_once(page, f"Idris Fallowfield hid {b['name']}.")
        assert active(page) == c["id"]
        assert len(routes) == 2


def test_wf_co_editing_announce_order(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, (a, b, c) = _co_project(owner, 3)
    d = add_text(owner, pid, a["row_id"], 800, 850, "D")
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        listen(page)
        send(idris, pid, {"type": "move", "clip_id": a["id"], "start_frame": 7, "row_id": a["row_id"]})
        send(idris, pid, {"type": "set_hidden", "clip_id": b["id"], "hidden": True})
        send(idris, pid, {"type": "trim", "clip_id": c["id"], "edge": "end", "delta_frames": -5, "ripple": False})
        block(page, d["id"]).focus()
        page.keyboard.press("ArrowRight")
        expected = [f"Idris Fallowfield moved {a['name']} to {tc(7, '25')}.", f"Idris Fallowfield hid {b['name']}.",
                    f"Idris Fallowfield trimmed {c['name']}."]
        eventually(page, lambda: all(m in heard(page) for m in expected), "three remote changes announced")
        advance(page, 1000)
        log = heard(page)
        assert [log.count(m) for m in expected] == [1, 1, 1], log
        assert [log.index(m) for m in expected] == sorted(log.index(m) for m in expected), log
        assert not any(m.startswith("Noor Achterberg") for m in log), log


def _notes_project(owner: Api) -> tuple[str, str, dict, dict]:
    pid, title = project(owner, "notes", members=(("idris", "editor"), ("maren", "commenter"), ("pia", "editor"),
                                                  ("theo", "editor")))
    a = add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 100, "A")
    return pid, title, a, name_cut(owner, pid)


def test_wf_notes_and_mail_pin_approve(browser: Browser, app_url: str) -> None:
    owner, maren = Api(app_url, "noor"), Api(app_url, "maren")
    pid, _, a, cut = _notes_project(owner)
    body = f"Hold here {uuid.uuid4().hex[:6]} @idris"
    with screen(browser, app_url, maren, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        block(page, a["id"]).focus()
        press_n(page, "Period", 50)
        eventually(page, lambda: playhead(page) == 50, "playhead at 50")
        comments = page.get_by_role("region", name="Comments")
        comments.get_by_role("textbox", name="Note").fill(body)
        comments.get_by_role("radiogroup", name="Who can see this").get_by_role("radio", name="Team only").check()
        comments.get_by_role("button", name="Pin note").click()
        eventually(page, lambda: f"Note pinned at {tc(50, '25')}." in txt(notices(page)), "pin notice")
        note = poll(lambda: next((x for x in owner.get(f"/api/projects/{pid}/comments").json()["items"]
                                  if x["body"] == body), None), "note stored")
        assert note["pin"]["frame"] == 50 and note["pin"]["clip_id"] == a["id"] and note["pin"]["row_id"] == a["row_id"]
        assert note["visibility"] == "team" and note["mentions"] == ["idris"] and note["author_name"] == "Maren Okafor"
        pin = timeline(page).get_by_role("button", name=f"Note by Maren Okafor at {tc(50, '25')}")
        eventually(page, lambda: attr(pin, "data-frame") == "50", "pin drawn at its frame")
        comments.get_by_role("button", name="Reply").first.click()
        reply = f"Reply {uuid.uuid4().hex[:6]}"
        comments.get_by_role("textbox", name="Note").fill(reply)
        comments.get_by_role("button", name="Pin note").click()
        poll(lambda: any(x["body"] == reply and x["parent_id"] == note["id"]
                         for x in owner.get(f"/api/projects/{pid}/comments").json()["items"]), "reply stored")
        page.get_by_role("button", name="Approve cut").click()
        eventually(page, lambda: f"{cut['name']} approved." in txt(notices(page)), "approval notice")
    approvals = next(x for x in owner.get(f"/api/projects/{pid}/cuts").json()["items"] if x["id"] == cut["id"])["approvals"]
    assert [x["name"] for x in approvals] == ["Maren Okafor"]
    again = maren.post(f"/api/projects/{pid}/cuts/{cut['id']}/approval")
    assert again.status_code == 200 and len(again.json()["approvals"]) == 1


def test_wf_notes_and_mail_limits(browser: Browser, app_url: str) -> None:
    owner, maren = Api(app_url, "noor"), Api(app_url, "maren")
    pid, _, a, _ = _notes_project(owner)
    path = f"/api/projects/{pid}/comments"
    count = lambda: len(owner.get(path).json()["items"])
    n0 = count()
    assert maren.post(path, {"body": "🎬" + "a" * (NOTE_LIMIT - 1), "frame": 0, "visibility": "team"}).status_code == 201
    b = err(maren.post(path, {"body": "🎬" + "a" * NOTE_LIMIT, "frame": 0, "visibility": "team"}), 422, "validation")
    assert b["errors"]["body"] == "Notes are 1 to 2,000 characters."
    err(maren.post(path, {"body": "   ", "frame": 0, "visibility": "team"}), 422, "validation")
    handle = "nobody" + uuid.uuid4().hex[:6]
    b = err(maren.post(path, {"body": f"hi @{handle}", "frame": 0, "visibility": "team"}), 422, "validation")
    assert b["errors"]["mention"] == f"No one on this project is called @{handle}."
    five = "@noor @idris @pia @maren @theo"
    assert maren.post(path, {"body": five, "frame": 0, "visibility": "team"}).status_code == 201
    b = err(maren.post(path, {"body": f"{five} @{handle}", "frame": 0, "visibility": "team"}), 422, "validation")
    assert set(b["errors"]) & {"mentions", "mention"}
    assert count() == n0 + 2
    with screen(browser, app_url, maren, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        comments = page.get_by_role("region", name="Comments")
        box_, counter, pin = (comments.get_by_role("textbox", name="Note"), comments.locator("[data-count]"),
                              comments.get_by_role("button", name="Pin note"))
        box_.fill("🇳🇱")
        eventually(page, lambda: attr(counter, "data-count") == "2", "flag counts two code points")
        box_.fill("🎬" + "a" * (NOTE_LIMIT - 1))
        eventually(page, lambda: attr(counter, "data-count") == "2000" and pin.is_enabled(), "2000 allowed")
        assert "of 2,000" in txt(counter)
        box_.fill("🎬" + "a" * NOTE_LIMIT)
        eventually(page, lambda: attr(counter, "data-count") == "2001" and pin.is_disabled(), "over the limit disables Pin note")


def test_wf_notes_and_mail_drafts(browser: Browser, app_url: str) -> None:
    owner, maren, idris = Api(app_url, "noor"), Api(app_url, "maren"), Api(app_url, "idris")
    pid, _, a, _ = _notes_project(owner)
    draft = f"half-written {uuid.uuid4().hex[:8]}"
    with screen(browser, app_url, maren, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        page.get_by_role("region", name="Comments").get_by_role("textbox", name="Note").type(draft)
        advance(page, 1500)
        poll(lambda: (maren.get(f"/api/projects/{pid}/comment-draft").json()["draft"] or {}).get("body") == draft,
             "draft saved on the server")
        page.reload()
        wait_editor(page, a["id"])
        note = page.get_by_role("region", name="Comments").get_by_role("textbox", name="Note")
        eventually(page, lambda: note.input_value() == draft, "draft restored after reload")
    with screen(browser, app_url, maren, f"/projects/{pid}") as other:
        wait_editor(other, a["id"])
        note = other.get_by_role("region", name="Comments").get_by_role("textbox", name="Note")
        eventually(other, lambda: note.input_value() == draft, "draft on another device")
    assert idris.get(f"/api/projects/{pid}/comment-draft").json()["draft"] is None
    err(maren.put(f"/api/projects/{pid}/comment-draft", {"body": "a" * (NOTE_LIMIT + 1), "frame": 0, "visibility": "team"}),
        422, "validation")
    assert maren.post(f"/api/projects/{pid}/comments", {"body": draft, "frame": 0, "visibility": "team"}).status_code == 201
    assert maren.get(f"/api/projects/{pid}/comment-draft").json()["draft"] is None


def _mails(mail: Any, title: str) -> list[dict]:
    return [m for m in mail.messages() if title in (m.get("Subject") or "")]


@pytest.mark.timeout(600)
def test_wf_notes_and_mail_grouped_mail(app_url: str, mail: Any) -> None:
    owner, maren = Api(app_url, "noor"), Api(app_url, "maren")
    pid, title, _, _ = _notes_project(owner)
    bodies = [f"first {uuid.uuid4().hex[:6]} @idris", f"second {uuid.uuid4().hex[:6]} @idris @maren"]
    for i, body in enumerate(bodies):
        assert maren.post(f"/api/projects/{pid}/comments", {"body": body, "frame": 25 * (i + 1),
                                                            "visibility": "team"}).status_code == 201
    subject = f"Gatecut · {title} · notes for you (2)"
    found = poll(lambda: _mails(mail, title), "grouped mention mail delivered", MAIL_WAIT_S)
    found = _mails(mail, title)
    assert len(found) == 1, [m.get("Subject") for m in found]
    m = found[0]
    assert m.get("Subject") == subject
    assert addresses(m.get("To")) == [PEOPLE["idris"][0]]
    assert mail_from_address() in addresses(m.get("From"))
    body = text(m)
    lines = [f"Maren Okafor at {tc(25, '25')}: {bodies[0]}", f"Maren Okafor at {tc(50, '25')}: {bodies[1]}"]
    assert all(line in body for line in lines) and body.index(lines[0]) < body.index(lines[1])
    item = poll(lambda: next((x for x in owner.get("/api/outbox").json()["items"]
                              if x["subject"] == subject and x["state"] == "sent"), None), "outbox shows it sent")
    assert item["to"] == PEOPLE["idris"][0] and item["sent_at"] and item["attempts"] >= 1


@pytest.mark.timeout(600)
def test_mail_outbox_outage(browser: Browser, app_url: str, mail: Any) -> None:
    down_url = env_url("APP_MAILPIT_DOWN_URL")
    owner = Api(down_url, "noor")
    assert owner.get("/api/status").json()["mail"] == "down"
    assert Api(app_url, "noor").get("/api/status").json()["mail"] == "up"
    pid, title, _, _ = _notes_project(owner)
    maren = Api(down_url, "maren")
    assert maren.post(f"/api/projects/{pid}/comments", {"body": "late @idris", "frame": 0, "visibility": "team"}).status_code == 201
    subject = f"Gatecut · {title} · notes for you (1)"
    item = poll(lambda: next((x for x in owner.get("/api/outbox").json()["items"] if x["subject"] == subject), None),
                "message entered the outbox", MAIL_WAIT_S)
    assert item["to"] == PEOPLE["idris"][0] and item["state"] in ("waiting", "sent")
    with screen(browser, down_url, owner, "/profile") as page:
        outbox = page.get_by_role("region", name="Outbox")
        eventually(page, lambda: subject in txt(outbox), "the message is listed in the Outbox region")
        assert any(state in txt(outbox).lower() for state in ("waiting", "sent")), txt(outbox)
        eventually(page, lambda: "Mail is waiting in the outbox:" in txt(notices(page)), "the mail banner")
    poll(lambda: next((x for x in owner.get("/api/outbox").json()["items"]
                       if x["subject"] == subject and x["state"] == "sent"), None), "message delivered once SMTP answers",
         MAIL_WAIT_S)
    poll(lambda: len(_mails(mail, title)) == 1, "one mail captured", POLL_S)
    deadline = time.monotonic() + OUTBOX_RETRY_S * 3
    while time.monotonic() < deadline:
        assert len(_mails(mail, title)) == 1, "message sent twice"
    assert len([x for x in owner.get("/api/outbox").json()["items"] if x["subject"] == subject]) == 1


def test_late_note_follows_clip(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    hl = next(x for x in owner.get("/api/projects/harbour-light/comments").json()["items"] if x["id"] == "hl-n2")
    assert hl["pin"]["frame"] == 560 and hl["pin"]["live_frame"] == 540
    pid, _ = project(owner, "late")
    pic = rows(owner, pid)["Picture"]["id"]
    c = add_text(owner, pid, pic, 100, 200, "C")
    cut = name_cut(owner, pid)
    r = owner.post(f"/api/projects/{pid}/comments", {"body": "late", "frame": 150, "row_id": pic, "clip_id": c["id"],
                                                     "cut_id": cut["id"], "visibility": "review"})
    assert r.status_code == 201
    send(owner, pid, {"type": "move", "clip_id": c["id"], "start_frame": 300, "row_id": pic})
    note = next(x for x in owner.get(f"/api/projects/{pid}/comments").json()["items"] if x["id"] == r.json()["id"])
    assert note["pin"]["live_frame"] == 350
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, c["id"])
        pin = timeline(page).locator(f'[data-comment-id="{note["id"]}"]')
        eventually(page, lambda: attr(pin, "data-frame") == "350", "late pin drawn at the live frame")


def _review_project(owner: Api) -> tuple[str, str, dict, dict, dict, dict, dict]:
    pid, title = project(owner, "review")
    pic = rows(owner, pid)["Picture"]["id"]
    a = add_text(owner, pid, pic, 0, 100, "A")
    b = add_text(owner, pid, pic, 100, 200, "B")
    cut1 = name_cut(owner, pid, "Shared")
    cut2 = name_cut(owner, pid, "Hidden")
    return pid, title, a, b, cut1, cut2, make_link(owner, pid, cut1["id"])


def test_wf_review_link_phone_client(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, title, a, b, cut1, cut2, link = _review_project(owner)
    team = f"team-only {uuid.uuid4().hex[:8]}"
    owner.post(f"/api/projects/{pid}/comments", {"body": team, "frame": 10, "visibility": "team"})
    who, said = f"Ada {uuid.uuid4().hex[:6]}", f"Lamp shot {uuid.uuid4().hex[:6]}"
    with screen(browser, app_url, owner, f"/projects/{pid}") as desk, \
            screen(browser, app_url, None, f"/review/{link['token']}", 375, 812) as phone:
        wait_editor(desk, a["id"])
        review = phone.get_by_role("region", name="Review")
        eventually(phone, lambda: review.count() == 1, "review page drawn", POLL_S)
        page_text = phone.inner_text("body")
        assert title in page_text and cut1["name"] in page_text and "25" in page_text
        assert team not in page_text and cut2["name"] not in page_text
        phone.get_by_role("list", name="Clips").get_by_role("button", name=f"{b['name']}, {tc(100, '25')} to {tc(200, '25')}").click()
        slider = phone.get_by_role("slider", name="Scrubber")
        eventually(phone, lambda: str(slider.first.evaluate(
            "el => el.value !== undefined ? el.value : el.getAttribute('aria-valuenow')")) == "100",
            "scrubber at the clip's start")
        phone.get_by_role("textbox", name="Your name").fill(who)
        phone.get_by_role("textbox", name="Comment").fill(said)
        phone.get_by_role("button", name="Send comment").click()
        eventually(phone, lambda: "Comment sent." in txt(phone.get_by_role("status", name="Review status")), "comment sent")
        eventually(desk, lambda: said in txt(desk.get_by_role("region", name="Comments")), "owner's Comments shows it")
        note = next(x for x in owner.get(f"/api/projects/{pid}/comments").json()["items"] if x["body"] == said)
        assert note["visibility"] == "review" and note["cut_id"] == cut1["id"] and note["pin"]["frame"] == 100
        phone.get_by_role("button", name="Approve this cut").click()
        poll(lambda: who in [x["name"] for x in next(c for c in owner.get(f"/api/projects/{pid}/cuts").json()["items"]
                                                     if c["id"] == cut1["id"])["approvals"]], "client approval stored")
        assert owner.delete(f"/api/review-links/{link['id']}").status_code == 204
        eventually(phone, lambda: "This review link was turned off. Ask Noor Achterberg for a new one." in phone.inner_text("body"),
                   "revoked copy replaces the review")


def test_wf_review_link_phone_lifecycle(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _, _, _, cut1, _, link = _review_project(owner)
    rl = f"/api/projects/{pid}/review-links"
    for bad in [LINK_MIN_S - 1, LINK_MAX_S + 1]:
        b = err(owner.post(rl, {"cut_id": cut1["id"], "expires_in_seconds": bad}), 422, "validation")
        assert b["errors"]["expires_in_seconds"] == "Links last 10 to 2,592,000 seconds."
    anon = Api(app_url)
    tok = link["token"]
    for method in ["PUT", "DELETE", "PATCH"]:
        err(anon.c.request(method, f"/api/review/{tok}", json={}), 405, "method_not_allowed")
    err(anon.get(f"/api/review/{tok}/comments"), 405, "method_not_allowed")
    err(anon.get("/api/projects", headers={"authorization": f"Bearer {tok}"}), 401, "unauthenticated")
    err(anon.get("/api/v1/projects", headers={"authorization": f"Bearer {tok}"}), 401, "unauthenticated")
    b = err(anon.post(f"/api/review/{tok}/comments", {"name": "x" * (NAME_MAX + 1), "body": "hi", "frame": 0}), 422, "validation")
    assert b["errors"]["name"] == "Add your name in 1 to 60 characters."
    with screen(browser, app_url, None, f"/review/{tok}", 375, 812) as phone:
        eventually(phone, lambda: phone.get_by_role("region", name="Review").count() == 1, "review drawn", POLL_S)
        new = owner.post(f"/api/review-links/{link['id']}/regenerate")
        assert new.status_code == 201 and new.json()["token"] != tok and new.json()["cut_id"] == cut1["id"]
        assert new.json()["expires_at"] == link["expires_at"]
        err(anon.get(f"/api/review/{tok}"), 410, "link_revoked",
            "This review link was turned off. Ask Noor Achterberg for a new one.")
        assert anon.get(f"/api/review/{new.json()['token']}").status_code == 200
        eventually(phone, lambda: "This review link was turned off." in phone.inner_text("body"), "old page ended")
    short = make_link(owner, pid, cut1["id"], LINK_MIN_S)
    assert anon.get(f"/api/review/{short['token']}").status_code == 200
    with screen(browser, app_url, None, f"/review/{short['token']}", 375, 812) as phone:
        eventually(phone, lambda: phone.get_by_role("region", name="Review").count() == 1
                   or "This review link has expired." in phone.inner_text("body"), "review or expired copy drawn", POLL_S)
        poll(lambda: anon.get(f"/api/review/{short['token']}").status_code == 410, "link expired on the server clock",
             LINK_MIN_S + SLACK_S * 2)
        err(anon.get(f"/api/review/{short['token']}"), 410, "link_expired",
            "This review link has expired. Ask Noor Achterberg for a new one.")
        eventually(phone, lambda: "This review link has expired." in phone.inner_text("body"), "expired copy on the page")
    assert next(x for x in owner.get(rl).json()["items"] if x["id"] == short["id"])["state"] == "expired"
    err(anon.post(f"/api/review/{short['token']}/comments", {"name": "Ada", "body": "hi", "frame": 0}), 410, "link_expired")


def test_review_etag(app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _, _, _, cut1, cut2, link = _review_project(owner)
    anon = Api(app_url)
    path = f"/api/review/{link['token']}"
    r = anon.get(path)
    etag = r.headers["etag"]
    assert r.status_code == 200 and etag and r.headers["cache-control"] == "private, no-cache"
    assert r.json()["cut"]["id"] == cut1["id"]
    again = anon.get(path, headers={"if-none-match": etag})
    assert again.status_code == 304 and again.content == b""
    assert owner.put(f"/api/review-links/{link['id']}", {"cut_id": cut2["id"]}).status_code == 200
    moved = anon.get(path, headers={"if-none-match": etag})
    assert moved.status_code == 200 and moved.headers["etag"] != etag and moved.json()["cut"]["name"] == cut2["name"]
    etag2 = moved.headers["etag"]
    assert anon.post(f"{path}/comments", {"name": "Ada", "body": "probe", "frame": 0}).status_code == 201
    assert anon.get(path, headers={"if-none-match": etag2}).status_code == 200


def test_wf_review_link_phone_layout(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    _, _, a, b, _, _, link = _review_project(owner)
    with screen(browser, app_url, None, f"/review/{link['token']}", 375, 812, reduced="reduce") as phone:
        clips_list = phone.get_by_role("list", name="Clips")
        eventually(phone, lambda: clips_list.get_by_role("button").count() == 2, "two clips listed", POLL_S)
        layout(phone)
        boxes = [clips_list.get_by_role("button", name=f"{c['name']}, {tc(s, '25')} to {tc(e, '25')}").bounding_box()
                 for c, s, e in [(a, 0, 100), (b, 100, 200)]]
        assert abs(boxes[0]["x"] - boxes[1]["x"]) <= 1 and boxes[0]["y"] < boxes[1]["y"]
        controls = [phone.get_by_role("button", name=n) for n in ["Send comment", "Approve this cut"]] + \
                   [phone.get_by_role("slider", name="Scrubber"), phone.get_by_role("textbox", name="Comment"),
                    phone.get_by_role("textbox", name="Your name")] + clips_list.get_by_role("button").all()
        for c in controls:
            bb = c.first.bounding_box()
            assert bb["width"] >= TARGET_PX - 0.5 and bb["height"] >= TARGET_PX - 0.5, bb
        comment = phone.get_by_role("textbox", name="Comment")
        comment.scroll_into_view_if_needed()
        cb = comment.bounding_box()
        for n in ["Send comment", "Approve this cut"]:
            assert phone.get_by_role("button", name=n).bounding_box()["y"] >= cb["y"] + cb["height"] - 0.5
        assert comment.evaluate("(el) => { const r = el.getBoundingClientRect(); const hit = document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2); return el === hit || el.contains(hit); }")
        slider = phone.get_by_role("slider", name="Scrubber")
        slider.focus()
        phone.keyboard.press("ArrowRight")
        assert all(float(x.get("duration") or 0) == 0 for x in animations(phone.get_by_role("region", name="Review")))


def _cuts_project(owner: Api) -> tuple[str, dict, dict]:
    pid, _ = project(owner, "cuts", members=(("idris", "editor"),))
    pic = rows(owner, pid)["Picture"]["id"]
    return pid, add_text(owner, pid, pic, 0, 100, "A"), add_text(owner, pid, pic, 100, 200, "B")


def test_wf_cuts_and_restore_compare(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, a, b = _cuts_project(owner)
    c1 = uid("Cut")[:NAME_MAX]
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, a["id"])
        for attempt in range(2):
            page.get_by_role("button", name="Name cut", exact=True).click()
            dialog = page.get_by_role("dialog", name="Name cut")
            dialog.get_by_role("textbox", name="Cut name").fill(c1)
            dialog.get_by_role("button", name="Save cut").click()
            if attempt == 0:
                eventually(page, lambda: f"{c1} saved." in txt(notices(page)), "cut saved notice")
            else:
                eventually(page, lambda: f"A cut called {c1} already exists." in txt(dialog) + txt(notices(page)),
                           "duplicate refused")
                page.keyboard.press("Escape")
        cuts = owner.get(f"/api/projects/{pid}/cuts").json()["items"]
        first = next(x for x in cuts if x["name"] == c1)
        assert [x["name"] for x in cuts].count(c1) == 1 and first["total_frames"] == 200
        pic = a["row_id"]
        send(owner, pid, {"type": "move", "clip_id": b["id"], "start_frame": 300, "row_id": pic})
        send(owner, pid, {"type": "remove", "clip_id": a["id"], "ripple": False})
        c = add_text(owner, pid, pic, 0, 50, "C")
        second = name_cut(owner, pid)
        diff = owner.get(f"/api/projects/{pid}/cuts/{first['id']}/compare/{second['id']}").json()
        assert diff["added"] == [c["id"]] and diff["removed"] == [a["id"]] and diff["frame_delta"] == 200
        assert diff["changed"] == [{"clip_id": b["id"], "from": {"row_id": pic, "start_frame": 100, "end_frame": 200},
                                    "to": {"row_id": pic, "start_frame": 300, "end_frame": 400}}]
        snap = owner.get(f"/api/projects/{pid}/cuts/{first['id']}").json()
        assert {x["id"]: x["start_frame"] for x in snap["clips"]} == {a["id"]: 0, b["id"]: 100}
        page.reload()
        wait_editor(page, b["id"])
        page.get_by_role("button", name="Compare cuts", exact=True).click()
        dialog = page.get_by_role("dialog", name="Compare cuts")
        select(dialog.get_by_role("combobox", name="From cut"), c1)
        select(dialog.get_by_role("combobox", name="To cut"), second["name"])
        table = dialog.get_by_role("table", name="Cut differences")
        eventually(page, lambda: all(n in txt(table) for n in [a["name"], b["name"], c["name"]]), "differences listed")


def test_wf_cuts_and_restore_restore(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, a, b = _cuts_project(owner)
    cut = name_cut(owner, pid)
    link = make_link(owner, pid, cut["id"])
    review_etag = Api(app_url).get(f"/api/review/{link['token']}").headers["etag"]
    pic = a["row_id"]
    send(owner, pid, {"type": "move", "clip_id": b["id"], "start_frame": 300, "row_id": pic})
    send(owner, pid, {"type": "remove", "clip_id": a["id"], "ripple": False})
    other = name_cut(owner, pid)
    edited, v = clips(owner, pid), version(owner, pid)
    with screen(browser, app_url, Api(app_url, "idris"), f"/projects/{pid}") as watch:
        wait_editor(watch, b["id"])
        listen(watch)
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, b["id"])
            opener = page.get_by_role("button", name="Compare cuts", exact=True)
            opener.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Compare cuts")
            select(dialog.get_by_role("combobox", name="From cut"), other["name"])
            select(dialog.get_by_role("combobox", name="To cut"), cut["name"])
            dialog.get_by_role("button", name=f"Restore cut {cut['name']}").focus()
            page.keyboard.press("Enter")
            eventually(page, lambda: f"{cut['name']} restored." in txt(notices(page)), "restored notice")
        snap = {x["id"]: x for x in owner.get(f"/api/projects/{pid}/cuts/{cut['id']}").json()["clips"]}
        now = clips(owner, pid)
        assert version(owner, pid) == v + 1 and set(now) == set(snap)
        for cid, c in snap.items():
            assert (now[cid]["start_frame"], now[cid]["end_frame"], now[cid]["row_id"]) == \
                (c["start_frame"], c["end_frame"], c["row_id"])
        eventually(watch, lambda: attr(block(watch, b["id"]), "data-start-frame") == "100" and block(watch, a["id"]).count() == 1,
                   "other screen follows the restore")
        announced_once(watch, f"Noor Achterberg restored {cut['name']}.")
    assert Api(app_url).get(f"/api/review/{link['token']}").headers["etag"] == review_etag
    assert owner.post(f"/api/projects/{pid}/undo", {"op_id": uuid.uuid4().hex}).status_code == 200
    assert clips(owner, pid) == edited
    send(owner, pid, {"type": "lock_row", "row_id": pic, "locked": True})
    v2 = version(owner, pid)
    err(owner.post(f"/api/projects/{pid}/cuts/{cut['id']}/restore", {"op_id": uuid.uuid4().hex, "base_version": v2}),
        409, "row_locked", "Picture is locked.")
    assert version(owner, pid) == v2 and clips(owner, pid) == edited
    assert send(owner, pid, {"type": "restore_cut", "cut_id": cut["id"]}, None).status_code == 422


def _export_project(owner: Api, minutes: int = 1, members: tuple = ()) -> tuple[str, str, dict]:
    pid, title = project(owner, "export", members=members)
    add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, minutes * 60 * NOMINAL["25"], "X")
    return pid, title, name_cut(owner, pid)


def _wait_export(owner: Api, eid: str, states: tuple[str, ...]) -> dict:
    return poll(lambda: (lambda e: e if e["state"] in states else None)(owner.get(f"/api/exports/{eid}").json()),
                f"export {eid} reached {states}", EXPORT_DONE_S)


def test_wf_exports_queue_export(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, title, cut = _export_project(owner, members=(("idris", "editor"),))
    with screen(browser, app_url, Api(app_url, "idris"), f"/projects/{pid}") as watch, \
            screen(browser, app_url, owner, f"/projects/{pid}") as page:
        eventually(watch, lambda: watch.get_by_role("region", name="Exports").count() == 1, "Exports region", POLL_S)
        listen(watch)
        page.get_by_role("button", name="Export", exact=True).click()
        dialog = page.get_by_role("dialog", name="Export cut")
        select(dialog.get_by_role("combobox", name="Cut"), cut["name"])
        dialog.get_by_role("radiogroup", name="Size").get_by_role("radio", name="1080p").check()
        dialog.get_by_role("button", name="Start export").click()
        eventually(page, lambda: f"Export of {cut['name']} at 1080p queued." in txt(notices(page)), "queued notice")
        exp = poll(lambda: next(iter(owner.get(f"/api/projects/{pid}/exports").json()["items"]), None), "export created")
        eventually(watch, lambda: cut["name"] in txt(watch.get_by_role("region", name="Exports")), "export on the other screen")
        exp = _wait_export(owner, exp["id"], ("done",))
        announced_once(watch, f"Export of {cut['name']} at 1080p is ready.", )
        page.reload()
        link = page.get_by_role("region", name="Exports").get_by_role("link", name=f"Manifest {cut['name']} 1080p")
        eventually(page, lambda: link.count() == 1, "manifest link after reload", POLL_S)
    assert exp["progress"] == 100 and exp["minutes"] == 1 and exp["size"] == 1080
    r = owner.get(f"/api/exports/{exp['id']}/manifest")
    assert r.status_code == 302 and f"manifests/{exp['id']}.json" in r.headers["location"]
    manifest = json.loads(S3().get(f"manifests/{exp['id']}.json"))
    assert manifest["project"] == {"id": pid, "title": title} and manifest["cut"] == {"id": cut["id"], "name": cut["name"]}
    assert (manifest["frame_rate"], manifest["size"], manifest["width"], manifest["height"], manifest["total_frames"]) == \
        ("25/1", 1080, 1920, 1080, 60 * NOMINAL["25"])
    rest = {k: v for k, v in manifest.items() if k != "checksum"}
    digest = sha(json.dumps(rest, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode())
    assert manifest["checksum"] == f"sha256:{digest}" and exp["manifest_checksum"] == manifest["checksum"]
    assert [i["start_frame"] for row in manifest["rows"] for i in row["items"]] == [0]


def test_wf_exports_queue_cancel(app_url: str, mail: Any) -> None:
    owner = Api(app_url, "noor")
    pid, _, cut = _export_project(owner)
    used = owner.get("/api/allowance").json()["export_minutes_used"]
    r = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 2160})
    assert r.status_code == 202 and r.json()["state"] == "queued"
    c = owner.post(f"/api/exports/{r.json()['id']}/cancel")
    assert c.status_code == 200 and c.json()["state"] == "cancelled"
    err(owner.post(f"/api/exports/{r.json()['id']}/cancel"), 409, "export_finished", "This export already ended as cancelled.")
    err(owner.get(f"/api/exports/{r.json()['id']}/manifest"), 409, "export_not_ready", COPY["export_not_ready"])
    assert owner.get("/api/allowance").json()["export_minutes_used"] == used
    run = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 1080}).json()
    _wait_export(owner, run["id"], ("running",))
    stopped = owner.post(f"/api/exports/{run['id']}/cancel").json()
    assert stopped["state"] == "cancelled"
    held_progress = owner.get(f"/api/exports/{run['id']}").json()["progress"]
    deadline = time.monotonic() + EXPORT_STEP_MS * 3 / 1000
    while time.monotonic() < deadline:
        e = owner.get(f"/api/exports/{run['id']}").json()
        assert e["state"] == "cancelled" and e["progress"] == held_progress
    assert S3().keys(f"manifests/{run['id']}.json") == []
    done = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 720}).json()
    seen, progress = [], []
    deadline = time.monotonic() + EXPORT_DONE_S
    while time.monotonic() < deadline and (not seen or seen[-1] != "done"):
        e = owner.get(f"/api/exports/{done['id']}").json()
        if not seen or seen[-1] != e["state"]:
            seen.append(e["state"])
        progress.append(e["progress"])
    assert seen and seen[-1] == "done" and seen == [s for s in ["queued", "running", "done"] if s in seen], seen
    assert all(p % 10 == 0 for p in progress) and progress == sorted(progress)
    assert owner.get("/api/allowance").json()["export_minutes_used"] == used + 1
    assert owner.get(f"/api/exports/{done['id']}").json()["stale"] is False
    send(owner, pid, {"type": "add_marker", "frame": 5, "label": "M"})
    assert owner.get(f"/api/exports/{done['id']}").json()["stale"] is True
    subject = f"Gatecut · export ready · {cut['name']} · 720p"
    msg = poll(lambda: [m for m in mail.messages() if m.get("Subject") == subject], "export-finished mail", POLL_S + EXPORT_DONE_S)
    assert len(msg) == 1 and addresses(msg[0].get("To")) == [PEOPLE["noor"][0]]
    final = owner.get(f"/api/exports/{done['id']}").json()
    assert final["manifest_checksum"].split(":")[-1] in text(msg[0]) and f"/projects/{pid}" in text(msg[0])


def test_wf_exports_queue_repeat(app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _, cut = _export_project(owner)
    used = owner.get("/api/allowance").json()["export_minutes_used"]
    with ThreadPoolExecutor(4) as pool:
        rs = list(pool.map(lambda _: owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 1080}), range(4)))
    assert sorted(r.status_code for r in rs) == [200, 200, 200, 202]
    ids = {r.json()["id"] for r in rs}
    assert len(ids) == 1
    eid = ids.pop()
    assert owner.get("/api/allowance").json()["export_minutes_used"] == used + 1
    _wait_export(owner, eid, ("done",))
    again = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 1080})
    assert again.status_code == 200 and again.json()["id"] == eid
    assert owner.get("/api/allowance").json()["export_minutes_used"] == used + 1
    assert [e["id"] for e in owner.get(f"/api/projects/{pid}/exports").json()["items"]] == [eid]
    assert S3().keys(f"manifests/{eid}") == [f"manifests/{eid}.json"]


def test_wf_exports_queue_outage(browser: Browser, app_url: str, rabbitmq: Any) -> None:
    down_url = env_url("APP_RABBITMQ_DOWN_URL")
    owner, down = Api(app_url, "noor"), Api(down_url, "noor")
    pid, _, cut = _export_project(owner)
    existing = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 720}).json()
    assert down.get("/api/status").json()["queue"] == "down"
    used = down.get("/api/allowance").json()["export_minutes_used"]
    depth = rabbitmq.depth("gatecut.exports")
    err(down.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 1080}), 503, "queue_unavailable",
        COPY["queue_unavailable"])
    rep = down.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 720})
    assert rep.status_code == 200 and rep.json()["id"] == existing["id"]
    err(down.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 999}), 422, "validation")
    err(down.post(f"/api/projects/{pid}/exports", {"cut_id": "no-such-cut", "size": 1080}), 404, "not_found")
    assert [e["id"] for e in owner.get(f"/api/projects/{pid}/exports").json()["items"]] == [existing["id"]]
    assert down.get("/api/allowance").json()["export_minutes_used"] == used
    assert rabbitmq.depth("gatecut.exports") <= depth
    with screen(browser, down_url, down, f"/projects/{pid}") as page:
        eventually(page, lambda: COPY["queue_unavailable"] in txt(notices(page)), "queue banner on load", POLL_S)


def test_wf_exports_queue_cancel_compound(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, _, cut = _export_project(owner, members=(("idris", "editor"),))
    used = owner.get("/api/allowance").json()["export_minutes_used"]
    with screen(browser, app_url, idris, f"/projects/{pid}") as watch:
        eventually(watch, lambda: watch.get_by_role("region", name="Exports").count() == 1, "Exports table", POLL_S)
        listen(watch)
        with screen(browser, app_url, owner, f"/projects/{pid}") as mine:
            eventually(mine, lambda: mine.get_by_role("region", name="Exports").count() == 1, "owner Exports table",
                       POLL_S)
            listen(mine)
            exp = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 1080}).json()
            cancel = mine.get_by_role("button", name=f"Cancel export {cut['name']} 1080p", exact=True)
            eventually(mine, lambda: cancel.count() == 1, "the Cancel control reaches the owner's screen")
            cancel.click()
            ended = _wait_export(owner, exp["id"], ("cancelled",))
            assert ended["progress"] < 100, ended
            for page in (mine, watch):
                eventually(page, lambda p=page: cut["name"] in txt(p.get_by_role("region", name="Exports")),
                           "the export is in this screen's Exports table")
        announced_once(watch, f"Export of {cut['name']} at 1080p was cancelled.")
    poll(lambda: owner.get("/api/allowance").json()["export_minutes_used"] == used or None,
         "the cancelled export gave its minutes back", POLL_S)
    deadline = time.monotonic() + LIVE_S + SLACK_S
    while time.monotonic() < deadline:
        assert owner.get("/api/allowance").json()["export_minutes_used"] == used, "the minutes came back twice"


def test_wf_allowance_and_kits_kits(app_url: str) -> None:
    owner, idris, maren = Api(app_url, "noor"), Api(app_url, "idris"), Api(app_url, "maren")
    for bad in [{"text_colour": "#ffffff"}, {"text_colour": "fff"}, {"box_colour": "gggggg"}, {"font_weight": 500}]:
        body = {"name": uid("kit"), "text_colour": "ffffff", "box_colour": "000000", "font_weight": 400, **bad}
        err(owner.post("/api/kits", body), 422, "validation")
    kit = owner.post("/api/kits", {"name": uid("kit"), "text_colour": KIT_TEXT, "box_colour": KIT_BOX, "font_weight": 600})
    assert kit.status_code == 201
    kid = kit.json()["id"]
    pid, _ = project(owner, "kit", members=(("idris", "editor"), ("maren", "commenter")))
    r = rows(owner, pid)
    t1 = add_text(owner, pid, r["Titles"]["id"], 0, 50)
    t2 = add_text(owner, pid, r["Picture"]["id"], 0, 50)
    err(send(maren, pid, {"type": "apply_kit", "kit_id": kid}, None), 403, "forbidden")
    v = version(owner, pid)
    send(idris, pid, {"type": "apply_kit", "kit_id": kid})
    assert version(owner, pid) == v + 1
    for cid in [t1["id"], t2["id"]]:
        c = clips(owner, pid)[cid]
        assert (c["text_colour"], c["box_colour"], c["font_weight"]) == (KIT_TEXT, KIT_BOX, 600)
    assert owner.put(f"/api/kits/{kid}", {"name": uid("kit"), "text_colour": KIT_TEXT_2, "box_colour": KIT_BOX_2,
                                          "font_weight": 400}).status_code == 200
    assert clips(owner, pid)[t1["id"]]["text_colour"] == KIT_TEXT
    t3 = add_text(owner, pid, r["Titles"]["id"], 100, 150)
    assert clips(owner, pid)[t3["id"]]["text_colour"] != KIT_TEXT_2 or clips(owner, pid)[t3["id"]]["font_weight"] != 400


def test_wf_allowance_and_kits_live(browser: Browser, app_url: str, valkey: Any) -> None:
    owner = Api(app_url, "noor")
    pid, _, cut = _export_project(owner, members=(("idris", "editor"),))
    a = owner.get("/api/allowance").json()
    assert a["text"] == allowance_text(a)
    key = f"gatecut:{a['workspace_id']}:export-minutes:{a['month']}"
    assert int(valkey.command("GET", key)) == a["export_minutes_used"]
    assert 0 < valkey.ttl(key) <= MINUTE_KEY_TTL_S
    assert int(valkey.command("GET", f"gatecut:{a['workspace_id']}:storage-bytes")) == a["storage_bytes_used"]
    y, m = map(int, a["month"].split("-"))
    nxt = datetime(y + (m == 12), m % 12 + 1, 1)
    assert a["resets_at"].startswith(nxt.strftime("%Y-%m-%dT00:00:00"))
    with screen(browser, app_url, owner, f"/projects/{pid}") as mine, \
            screen(browser, app_url, Api(app_url, "idris"), f"/projects/{pid}") as theirs:
        band = lambda p: p.locator("[data-allowance]")
        for p in (mine, theirs):
            eventually(p, lambda: txt(band(p)).strip() == owner.get("/api/allowance").json()["text"], "band shows the counter", POLL_S)
        listen(theirs)
        e = owner.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": 2160}).json()
        after = owner.get("/api/allowance").json()
        assert after["export_minutes_used"] == int(valkey.command("GET", key))
        for p in (mine, theirs):
            eventually(p, lambda: after["text"] in txt(band(p)), "band updated within a second")
        assert f"Allowance now: {after['text']}." in heard(theirs) or eventually(
            theirs, lambda: f"Allowance now: {after['text']}." in heard(theirs), "allowance change announced")
        owner.post(f"/api/exports/{e['id']}/cancel")
        back = owner.get("/api/allowance").json()
        for p in (mine, theirs):
            eventually(p, lambda: back["text"] in txt(band(p)), "band follows the returned minutes")


def test_wf_allowance_and_kits_parallel(app_url: str) -> None:
    tight = Api(env_url("APP_TIGHT_URL"), "noor")
    a = tight.get("/api/allowance").json()
    room = a["storage_bytes_allowance"] - a["storage_bytes_used"]
    size = max(room // 2 + 1, 64)
    size += size % 2
    folder = folder_name()
    staged = []
    for _ in range(3):
        data = wav_bytes(os.urandom(size - 44))
        j = start_upload(tight, data, f"{uuid.uuid4().hex[:8]}.wav", folder).json()
        if "upload_id" in j:
            for n in range(j["chunks"]):
                assert put_chunk(tight, j["upload_id"], n, data).status_code == 204
            staged.append(j["upload_id"])
    with ThreadPoolExecutor(3) as pool:
        done = list(pool.map(lambda u: tight.post(f"/api/uploads/{u}/complete"), staged))
    ok = [r for r in done if r.status_code == 201]
    for r in done:
        if r.status_code != 201:
            body = err(r, 409, "allowance_exceeded")
            assert "storage_bytes_used" in body.get("allowance", body)
    assert len(ok) == min(len(staged), room // size)
    now = tight.get("/api/allowance").json()
    assert now["storage_bytes_used"] == a["storage_bytes_used"] + size * len(ok) <= now["storage_bytes_allowance"]
    for r in ok:
        assert tight.delete(f"/api/media/{r.json()['media']['id']}").status_code == 204
    left = now["export_minutes_allowance"] - now["export_minutes_used"]
    minutes = left // 2 + 1
    pid, _, cut = _export_project(tight, minutes)
    with ThreadPoolExecutor(3) as pool:
        rs = list(pool.map(lambda s: tight.post(f"/api/projects/{pid}/exports", {"cut_id": cut["id"], "size": s}), [2160, 1080, 720]))
    accepted = [r for r in rs if r.status_code == 202]
    for r in rs:
        if r.status_code != 202:
            body = err(r, 409, "allowance_exceeded")
            assert body["message"].startswith("Allowance reached: export minutes")
            assert "export_minutes_used" in body.get("allowance", body)
    assert len(accepted) == min(3, left // minutes)
    peak = tight.get("/api/allowance").json()
    assert peak["export_minutes_used"] == now["export_minutes_used"] + minutes * len(accepted) <= peak["export_minutes_allowance"]
    for r in accepted:
        tight.post(f"/api/exports/{r.json()['id']}/cancel")


def test_wf_allowance_and_kits_edge_compound(browser: Browser, app_url: str, valkey: Any) -> None:
    tight_url = env_url("APP_TIGHT_URL")
    tight = Api(tight_url, "noor")
    a = tight.get("/api/allowance").json()
    room = a["export_minutes_allowance"] - a["export_minutes_used"]
    pid, _, cut = _export_project(tight, minutes=max(room, 0) + 1)
    key = f"gatecut:{a['workspace_id']}:export-minutes:{a['month']}"
    used_before = tight.get("/api/allowance").json()["export_minutes_used"]
    with screen(browser, tight_url, tight, f"/projects/{pid}") as page:
        band = page.locator("[data-allowance]")
        eventually(page, lambda: allowance_text(tight.get("/api/allowance").json()) in txt(band).strip(),
                   "the band shows the shared counter in the published text")
        before = txt(band).strip()
        page.get_by_role("button", name="Export", exact=True).click()
        select(page.get_by_role("combobox", name="Cut", exact=True), cut["name"])
        page.get_by_role("radio", name="1080p", exact=True).check()
        page.get_by_role("button", name="Start export", exact=True).click()
        eventually(page, lambda: "Allowance reached:" in txt(notices(page)),
                   "the published allowance refusal reaches Notices")
        now = tight.get("/api/allowance").json()
        assert now["export_minutes_used"] == used_before, (now["export_minutes_used"], used_before)
        assert now["export_minutes_used"] <= now["export_minutes_allowance"], now
        assert int(valkey.command("GET", key) or 0) <= now["export_minutes_allowance"], "shared counter past the limit"
        assert txt(band).strip() == before, (txt(band), before)


def _token(owner: Api) -> dict:
    r = owner.post("/api/tokens", {"name": uid("tok")[:NAME_MAX]})
    assert r.status_code == 201, r.text
    return r.json()


def _bearer(base: str, token: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), headers={"authorization": f"Bearer {token}"}, timeout=HTTP_TIMEOUT_S)


def test_wf_read_api_token(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    name = uid("Kestrel dashboard")[:NAME_MAX]
    err(owner.post("/api/tokens", {"name": "x" * (NAME_MAX + 1)}), 422, "validation")
    with screen(browser, app_url, owner, "/profile") as page:
        region = page.get_by_role("region", name="Read tokens")
        region.get_by_role("textbox", name="Token name").fill(name)
        region.get_by_role("button", name="New read token").click()
        eventually(page, lambda: "Copy this token now; it will not be shown again." in txt(notices(page)), "shown-once notice")
        found = eventually(page, lambda: re.search(r"gct_[0-9a-f]{40}", page.inner_text("body")), "token string shown")
        token = found.group(0)
        api = _bearer(app_url, token)
        assert api.get("/api/v1/projects").status_code == 200
        listed = owner.get("/api/tokens")
        assert any(t["name"] == name for t in listed.json()["items"]) and token not in listed.text
        page.reload()
        eventually(page, lambda: name in txt(page.get_by_role("region", name="Read tokens")), "token listed", POLL_S)
        assert token not in page.inner_text("body")
        page.get_by_role("button", name=f"Revoke {name}").click()
        poll(lambda: not any(t["name"] == name for t in owner.get("/api/tokens").json()["items"]), "token revoked")
        err(api.get("/api/v1/projects"), 401, "unauthenticated")


V1_FIELDS = {
    "project": {"id", "title", "agency", "frame_rate", "aspect_ratio", "total_frames", "updated_at"},
    "clip": {"id", "row_id", "name", "kind", "start_frame", "end_frame", "hidden"},
    "cut": {"id", "name", "total_frames", "created_at"},
    "export": {"id", "cut_id", "size", "state", "minutes", "finished_at"},
    "comment": {"id", "cut_id", "frame", "body", "author_name", "created_at"},
}


def test_wf_read_api_surface(app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, title = project(owner, "surface")
    add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 50)
    shared, hidden = name_cut(owner, pid, "Shared"), name_cut(owner, pid, "Unshared")
    link = make_link(owner, pid, shared["id"])
    Api(app_url).get(f"/api/review/{link['token']}")
    team, rev = f"team {uuid.uuid4().hex[:6]}", f"review {uuid.uuid4().hex[:6]}"
    owner.post(f"/api/projects/{pid}/comments", {"body": team, "frame": 0, "visibility": "team"})
    owner.post(f"/api/projects/{pid}/comments", {"body": rev, "frame": 0, "visibility": "review", "cut_id": shared["id"]})
    api = _bearer(app_url, _token(owner)["token"])
    one = api.get(f"/api/v1/projects/{pid}").json()
    assert set(one) == V1_FIELDS["project"] and one["title"] == title
    for path, kind in [("clips", "clip"), ("cuts", "cut"), ("exports", "export"), ("comments", "comment")]:
        page = api.get(f"/api/v1/projects/{pid}/{path}").json()
        assert set(page) == {"items", "next_cursor"}
        for item in page["items"]:
            assert set(item) == V1_FIELDS[kind], (path, item)
        if kind == "cut":
            assert [c["name"] for c in page["items"]] == [shared["name"]]
        if kind == "comment":
            assert [c["body"] for c in page["items"]] == [rev]
    for method in ["POST", "PUT", "DELETE", "PATCH"]:
        r = api.request(method, "/api/v1/projects", json={})
        err(r, 405, "method_not_allowed")
        assert r.headers["allow"] == "GET"
    err(api.get("/api/projects"), 401, "unauthenticated")
    err(owner.get("/api/v1/projects"), 401, "unauthenticated")
    err(api.get("/api/v1/projects/no-such-project"), 404, "not_found")
    for path in ["/api/v1/debug", "/api/v1/admin", "/api/v1/projects/{}/members".format(pid)]:
        assert api.get(path).status_code == 404, path
    assert hidden["name"] not in api.get(f"/api/v1/projects/{pid}/cuts").text


def test_wf_read_api_paging(browser: Browser, app_url: str, valkey: Any) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "paging")
    pic = rows(owner, pid)["Picture"]["id"]
    original = [add_text(owner, pid, pic, i * 10, i * 10 + 5)["id"] for i in range(25)]
    tok = _token(owner)
    api = _bearer(app_url, tok["token"])
    path = f"/api/v1/projects/{pid}/clips"
    b = err(api.get(path, params={"limit": MAX_PAGE + 1}), 422, "validation")
    assert b["errors"]["limit"] == "Page size must be 1 to 100."
    err(api.get(path, params={"limit": 0}), 422, "validation")
    b = err(api.get(path, params={"cursor": "not-a-cursor"}), 422, "validation")
    assert b["errors"]["cursor"] == "This cursor is not valid."
    seen: list[str] = []
    cursor = None
    removed: set[str] = set()
    for step in range(10):
        params = {"limit": 7, **({"cursor": cursor} if cursor else {})}
        page = api.get(path, params=params).json()
        assert len(page["items"]) <= 7
        seen += [c["id"] for c in page["items"]]
        if step == 0:
            add_text(owner, pid, pic, 1000, 1005)
            for cid in (original[3], original[12]):
                send(owner, pid, {"type": "remove", "clip_id": cid, "ripple": False})
                removed.add(cid)
        cursor = page["next_cursor"]
        if cursor is None:
            break
    assert cursor is None and len(seen) == len(set(seen)), seen
    assert all(cid in seen for cid in original if cid not in removed)
    assert [seen.index(c) for c in original if c in seen] == sorted(seen.index(c) for c in original if c in seen)
    assert len(api.get(path, params={"limit": MAX_PAGE}).json()["items"]) <= MAX_PAGE
    keys = valkey.keys(f"gatecut:rate:{tok['id']}:*")
    assert keys and 0 < valkey.ttl(keys[-1]) <= RATE_KEY_TTL_S
    with screen(browser, app_url, owner, "/profile") as one, screen(browser, app_url, owner, "/profile") as two:
        def count(p: Page) -> str | None:
            reg = p.get_by_role("region", name="Read tokens")
            item = reg.get_by_role("listitem").or_(reg.get_by_role("row")).filter(has_text=tok["name"])
            return attr(item.locator("[data-token-window]"), "data-token-window")
        for _ in range(3):
            api.get("/api/v1/projects", params={"limit": 1})
            current = max(valkey.keys(f"gatecut:rate:{tok['id']}:*"), key=lambda k: int(k.rsplit(":", 1)[1]))
            want = valkey.command("GET", current)
            for p in (one, two):
                eventually(p, lambda: count(p) == str(valkey.command("GET", max(
                    valkey.keys(f"gatecut:rate:{tok['id']}:*"), key=lambda k: int(k.rsplit(":", 1)[1])))),
                    "window count shown within a second")


def test_wf_read_api_rate_limit(app_url: str, valkey: Any) -> None:
    owner = Api(app_url, "noor")
    tok, other = _token(owner), _token(owner)
    api = _bearer(app_url, tok["token"])
    limited = None
    for _ in range(RATE_LIMIT * 3):
        r = api.get("/api/v1/projects", params={"limit": 1})
        if r.status_code == 429:
            limited = r
            break
    assert limited is not None, "no 429 after more than 30 requests in a window"
    deadline = time.monotonic() + RATE_WINDOW_S + SLACK_S
    while time.monotonic() < deadline and api.get("/api/v1/projects", params={"limit": 1}).status_code == 429:
        pass
    statuses = [api.get("/api/v1/projects", params={"limit": 1}).status_code for _ in range(RATE_LIMIT - 1)]
    assert statuses == [200] * (RATE_LIMIT - 1), statuses
    r = api.get("/api/v1/projects", params={"limit": 1})
    n = int(r.headers["retry-after"])
    err(r, 429, "rate_limited", f"This read token is over 30 requests in 10 seconds. Try again in {n} seconds.")
    assert 1 <= n <= RATE_WINDOW_S
    assert owner.get("/api/projects").status_code == 200
    assert _bearer(app_url, other["token"]).get("/api/v1/projects").status_code == 200
    current = max(valkey.keys(f"gatecut:rate:{tok['id']}:*"), key=lambda k: int(k.rsplit(":", 1)[1]))
    assert int(valkey.command("GET", current)) >= RATE_LIMIT and valkey.ttl(current) <= RATE_KEY_TTL_S


def _shape_project(owner: Api, members: tuple = ()) -> tuple[str, dict, dict]:
    pid, _ = project(owner, "shape", members=members)
    r = rows(owner, pid)
    return pid, r, add_text(owner, pid, r["Titles"]["id"], 0, 100, "S")


def test_wf_stage_shaping_drag(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, r, t = _shape_project(owner)
    send(owner, pid, {"type": "set_layer", "clip_id": t["id"], "frame": 0, "x": 600})
    layer = lambda: _layer(owner, pid, 0, t["id"])
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        wait_editor(page, t["id"])
        sent = ops_requests(page)
        stage = page.get_by_role("region", name="Stage")
        btn = stage.get_by_role("button", name=f"Layer {t['name']}")
        eventually(page, lambda: btn.count() == 1, "layer button drawn", POLL_S)
        ppp = stage.first.evaluate("el => el.clientWidth") / FRAME_PX["16:9"][0]

        def drag(dx: float, guide: str, want_x: int) -> None:
            bb = btn.bounding_box()
            cx, cy = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2
            page.mouse.move(cx, cy)
            page.mouse.down()
            page.mouse.move(cx + dx * ppp, cy, steps=5)
            eventually(page, lambda: page.locator("[data-stage-guide]").count() >= 1, f"a guide while dragging ({guide})")
            assert sent == [], "saved while the pointer was down"
            page.mouse.up()
            poll(lambda: layer()["x"] == want_x, f"x locked to {want_x}")
            eventually(page, lambda: len(sent) == 1, "one op on release")
            sent.clear()

        drag(960 - 600 - (SNAP_PX - 3), "centre-x", 960)
        base_w = FRAME_PX["16:9"][0] * 0.6
        drag(580 - 960, "left", int(base_w / 2))
        x_now = layer()["x"]
        bb = btn.bounding_box()
        page.mouse.move(bb["x"] + 5, bb["y"] + 5)
        page.mouse.down()
        page.mouse.up()
        advance(page, 500)
        assert sent == [], "a drag with no change sent an op"
        handle = stage.get_by_role("button", name=f"Bottom right handle {t['name']}")
        assert attr(handle, "data-handle") == "se"
        hb, bb = handle.bounding_box(), btn.bounding_box()
        cx, cy = bb["x"] + bb["width"] / 2, bb["y"] + bb["height"] / 2
        hx, hy = hb["x"] + hb["width"] / 2, hb["y"] + hb["height"] / 2
        page.mouse.move(hx, hy)
        page.mouse.down()
        page.mouse.move(cx + 2 * (hx - cx), cy + 2 * (hy - cy), steps=5)
        page.mouse.up()
        poll(lambda: abs(layer()["scale"] - 200) <= 1, "handle drag doubles the scale")
        assert layer()["x"] == x_now
        eventually(page, lambda: len(sent) == 1, "one op on the handle drag's release")
        sent.clear()
        btn.focus()
        before = layer()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Shift+ArrowRight")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("BracketRight")
        poll(lambda: (layer()["x"], layer()["y"]) == (before["x"] + 11, before["y"] + 1), "keys moved the layer")
        poll(lambda: abs(layer()["scale"] - (before["scale"] + 1)) < 0.01, "] scaled by one percent")
        eventually(page, lambda: len(sent) == 4, "each key press is its own op")
        page.keyboard.press("Escape")
        eventually(page, lambda: active(page) == t["id"], "Escape returns to the clip's timeline button")
        send(owner, pid, {"type": "lock_row", "row_id": r["Titles"]["id"], "locked": True})
        eventually(page, lambda: btn.count() == 0 and handle.count() == 0, "layer controls gone on a locked row")
    locked = layer()
    err(send(owner, pid, {"type": "set_layer", "clip_id": t["id"], "frame": 0, "x": 10}, None), 409, "row_locked", "Titles is locked.")
    assert layer() == locked
    send(owner, pid, {"type": "lock_row", "row_id": r["Titles"]["id"], "locked": False})
    err(send(owner, pid, {"type": "set_layer", "clip_id": t["id"], "frame": 100, "x": 10}, None), 422, "validation")
    err(send(owner, pid, {"type": "set_layer", "clip_id": t["id"], "frame": 0}, None), 422, "validation")


def test_wf_stage_shaping_frame_size(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, r, t = _shape_project(owner, (("idris", "editor"),))
    send(owner, pid, {"type": "set_layer", "clip_id": t["id"], "frame": 0, "x": 1600, "y": 540})
    k = add_text(owner, pid, r["Picture"]["id"], 0, 100, "K")
    for prop, f, v in [("x", 0, 300), ("x", 10, 1700), ("y", 0, 100)]:
        send(owner, pid, {"type": "set_keyframe", "clip_id": k["id"], "property": prop, "frame": f, "value": v, "curve": "linear"})
    err(Api(app_url, "idris").put(f"/api/projects/{pid}", {"op_id": uuid.uuid4().hex, "base_version": version(owner, pid),
                                                           "aspect_ratio": "9:16"}), 403, "forbidden")
    b = err(owner.put(f"/api/projects/{pid}", {"op_id": uuid.uuid4().hex, "base_version": version(owner, pid),
                                               "aspect_ratio": "3:2"}), 422, "validation")
    assert "aspect_ratio" in b["errors"]
    assert send(owner, pid, {"type": "set_aspect", "aspect_ratio": "9:16"}, None).status_code == 422
    v = version(owner, pid)
    diamonds = lambda: {p: [(d["frame"], d["value"]) for d in clips(owner, pid)[k["id"]]["keyframes"].get(p, [])]
                        for p in ("x", "y")}
    with screen(browser, app_url, Api(app_url, "idris"), f"/projects/{pid}") as watch:
        wait_editor(watch, t["id"])
        listen(watch)
        with screen(browser, app_url, owner, f"/projects/{pid}") as page:
            wait_editor(page, t["id"])
            page.get_by_role("button", name="Frame size", exact=True).click()
            dialog = page.get_by_role("dialog", name="Frame size")
            select(dialog.get_by_role("combobox", name="Aspect ratio"), "9:16")
            dialog.get_by_role("button", name="Change frame").click()
            eventually(page, lambda: "The frame is now 9:16." in txt(notices(page)), "frame change notice")
            assert version(owner, pid) == v + 1
            lt = _layer(owner, pid, 0, t["id"])
            assert (lt["x"], lt["y"]) == (900, 960)
            assert abs(lt["width"] - FRAME_PX["9:16"][0] * 0.6) < 0.01
            assert diamonds() == {"x": [(0, rnd(Fraction(300 * 1080, 1920))), (10, rnd(Fraction(1700 * 1080, 1920)))],
                                  "y": [(0, rnd(Fraction(100 * 1920, 1080)))]}
            announced_once(watch, "Noor Achterberg changed the frame to 9:16.")
            page.get_by_role("button", name="Undo", exact=True).click()
            poll(lambda: detail(owner, pid)["project"]["aspect_ratio"] == "16:9", "undo restores the aspect ratio")
    lt = _layer(owner, pid, 0, t["id"])
    assert (lt["x"], lt["y"]) == (1600, 540)
    assert diamonds() == {"x": [(0, 300), (10, 1700)], "y": [(0, 100)]}


def test_wf_stage_shaping_touch_layout(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _, t = _shape_project(owner)
    for w, h in [(375, 812), (768, 1024)]:
        with screen(browser, app_url, owner, f"/projects/{pid}", w, h, reduced="reduce") as page:
            box_ = page.get_by_role("region", name="Stage").locator(f'[data-layer-box="{t["id"]}"]')
            eventually(page, lambda: box_.count() == 1, f"layer box drawn at {w}", POLL_S)
            assert abs(float(attr(box_, "data-x")) - FRAME_PX["16:9"][0] / 2) < 0.01
            assert page.get_by_role("button", name=f"Layer {t['name']}").count() == 0
            assert page.locator("[data-handle]").count() == 0
    with screen(browser, app_url, owner, f"/projects/{pid}", reduced="reduce") as page:
        btn = page.get_by_role("region", name="Stage").get_by_role("button", name=f"Layer {t['name']}")
        eventually(page, lambda: btn.count() == 1, "layer button in the editor", POLL_S)
        btn.focus()
        page.keyboard.press("ArrowUp")
        poll(lambda: _layer(owner, pid, 0, t["id"])["y"] == FRAME_PX["16:9"][1] / 2 - 1, "ArrowUp saved")


CANON = [(1000, 2543, ["Every boat comes home"]), (3000, 4500, ["to the same light.", "Since 1898."])]


def _caption_project(owner: Api, rate: str = "23.976") -> tuple[str, str]:
    pid, _ = project(owner, "captions", rate=rate, members=(("idris", "editor"),))
    return pid, rows(owner, pid)["Captions"]["id"]


def _import(api: Api, pid: str, row: str, data: bytes) -> httpx.Response:
    return api.c.post(f"/api/projects/{pid}/rows/{row}/captions/import", content=data,
                      headers={"content-type": "application/x-subrip"})


def test_wf_captions_srt_import_edit(browser: Browser, app_url: str) -> None:
    owner, idris = Api(app_url, "noor"), Api(app_url, "idris")
    pid, row = _caption_project(owner)
    name = f"{uuid.uuid4().hex[:8]}.srt"
    path = Path(tempfile.mkdtemp()) / name
    path.write_bytes(srt(CANON))
    fixed = f"Every boat {uuid.uuid4().hex[:6]}"
    with screen(browser, app_url, idris, f"/projects/{pid}") as page:
        eventually(page, lambda: page.get_by_role("button", name="Captions", exact=True).count() == 1, "Captions button", POLL_S)
        page.get_by_role("button", name="Captions", exact=True).click()
        dialog = page.get_by_role("dialog", name="Captions")
        select(dialog.get_by_role("combobox", name="Caption row"), "Captions")
        dialog.get_by_label("SRT file").set_input_files(str(path))
        dialog.get_by_role("button", name="Import captions").click()
        eventually(page, lambda: "2 captions imported into Captions." in txt(notices(page)), "import notice")
        cues = dialog.get_by_role("list", name="Cues")
        eventually(page, lambda: cues.get_by_role("button", name="Edit cue 1").count() == 1, "cues listed")
        cues.get_by_role("button", name="Edit cue 1").click()
        editor = dialog.get_by_role("textbox", name="Cue text")
        eventually(page, lambda: is_focused(editor), "focus in Cue text")
        editor.fill(fixed)
        eventually(page, lambda: attr(dialog.locator("[data-count]"), "data-count") == str(CUE_LINE - len(fixed)), "counter")
        assert f"{CUE_LINE - len(fixed)} characters left" in txt(dialog.locator("[data-count]"))
        dialog.get_by_role("button", name="Save cue").click()
        eventually(page, lambda: is_focused(cues.get_by_role("button", name="Edit cue 1")), "focus back on Edit cue 1")
        poll(lambda: any(c["text"] == fixed for c in detail(owner, pid)["captions"]), "cue saved")
        with page.expect_download() as info:
            dialog.get_by_role("link", name="Download SRT").click()
        got = Path(info.value.path()).read_bytes().decode()
    assert fixed in got and "\n".join(CANON[1][2]) in got and CANON[0][2][0] not in got


SRT_CASES = ["over-bytes", "too-many-cues", "long-line", "three-lines", "bad-time", "ends-before", "sub-frame",
             "overlap", "not-utf8", "at-limit"]


def _srt_case(case: str) -> tuple[bytes, int, str | None]:
    cue = lambda i: (i * 1000, i * 1000 + 500, [f"c{i}"])
    if case == "over-bytes":
        return srt([(0, 500, ["x"])]) + b"\n" * SRT_LIMIT, 413, None
    if case == "too-many-cues":
        return srt([cue(i) for i in range(MAX_CUES + 1)]), 422, "This SRT file has more than 5,000 cues."
    if case == "long-line":
        return srt([(0, 500, ["a" * (CUE_LINE + 1)])]), 422, "Line 3 is longer than 42 characters."
    if case == "three-lines":
        return srt([(0, 500, ["a", "b", "c"])]), 422, "Cue 1 has more than 2 text lines."
    if case == "bad-time":
        return b"1\n00:00:01.000 -> 00:00:02,000\nx\n\n", 422, "Cue 1 has a malformed time line."
    if case == "ends-before":
        return srt([(2000, 1000, ["x"])]), 422, "Cue 1 ends before it starts."
    if case == "sub-frame":
        return srt([(1000, 1010, ["x"])]), 422, "Cue 1 is shorter than one frame."
    if case == "overlap":
        return srt([(0, 2000, ["x"]), (1000, 3000, ["y"])]), 422, "Cue 2 overlaps the cue before it."
    if case == "not-utf8":
        return b"1\n00:00:01,000 --> 00:00:02,000\n\xff\xfe\n\n", 422, "This file is not UTF-8 text."
    return srt([cue(i) for i in range(MAX_CUES - 1)] + [(MAX_CUES * 1000, MAX_CUES * 1000 + 500, ["🎬" * CUE_LINE, "b"])]), 200, None


@pytest.mark.parametrize("case", SRT_CASES, ids=SRT_CASES)
def test_wf_captions_srt_caps(app_url: str, case: str) -> None:
    owner = Api(app_url, "noor")
    pid, row = _caption_project(owner, "25")
    assert _import(owner, pid, row, srt(CANON)).status_code == 200
    before = detail(owner, pid)["captions"]
    data, status, copy = _srt_case(case)
    t0 = time.monotonic()
    r = _import(owner, pid, row, data)
    assert time.monotonic() - t0 < SRT_BUDGET_S, "import took longer than two seconds"
    assert r.status_code == status, r.text
    if status == 413:
        err(r, 413, "too_large")
    elif status == 422:
        assert err(r, 422, "validation")["errors"]["srt"] == copy
    else:
        assert r.json()["cues"] == MAX_CUES
        return
    assert detail(owner, pid)["captions"] == before


def test_wf_captions_srt_typed_limits(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, row = _caption_project(owner, "25")
    copy = "Captions are 1 or 2 lines of at most 42 characters each."
    base = {"type": "caption_add", "row_id": row}
    send(owner, pid, {**base, "start_frame": 0, "end_frame": 10, "text": "🎬" + "a" * (CUE_LINE - 1)})
    send(owner, pid, {**base, "start_frame": 20, "end_frame": 30, "text": "🇳🇱" * (CUE_LINE // 2)})
    for i, bad in enumerate(["a" * (CUE_LINE - 1) + "🇳🇱", "a\nb\nc", "   ", "🎬" * (CUE_LINE + 1)]):
        b = err(send(owner, pid, {**base, "start_frame": 100 + i * 20, "end_frame": 110 + i * 20, "text": bad}, None),
                422, "validation")
        assert b["errors"]["text"] == copy
    assert len(detail(owner, pid)["captions"]) == 2
    with screen(browser, app_url, owner, f"/projects/{pid}") as page:
        eventually(page, lambda: page.get_by_role("button", name="Captions", exact=True).count() == 1, "Captions button", POLL_S)
        page.get_by_role("button", name="Captions", exact=True).click()
        dialog = page.get_by_role("dialog", name="Captions")
        select(dialog.get_by_role("combobox", name="Caption row"), "Captions")
        dialog.get_by_role("list", name="Cues").get_by_role("button", name="Edit cue 1").click()
        editor, counter, save = (dialog.get_by_role("textbox", name="Cue text"), dialog.locator("[data-count]"),
                                 dialog.get_by_role("button", name="Save cue"))
        editor.fill("a" * (CUE_LINE - 1) + "🎬")
        eventually(page, lambda: attr(counter, "data-count") == "0" and save.is_enabled(), "42 code points allowed")
        editor.fill("a" * (CUE_LINE - 1) + "🇳🇱")
        eventually(page, lambda: attr(counter, "data-count") == "-1" and save.is_disabled(), "flag counts two")
        editor.fill("a\nb\nc")
        eventually(page, lambda: save.is_disabled(), "three lines disable Save cue")


def test_wf_captions_srt_round_trip(app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, row = _caption_project(owner)
    empty = owner.get(f"/api/projects/{pid}/rows/{row}/captions/export")
    assert empty.status_code == 200 and not empty.content.startswith(b"\xef\xbb\xbf")
    data = srt(CANON, eol="\r\n", bom=True)
    assert _import(owner, pid, row, data).status_code == 200
    r = owner.get(f"/api/projects/{pid}/rows/{row}/captions/export")
    assert r.content == data
    assert r.headers["content-type"].startswith("application/x-subrip")
    assert r.headers["content-disposition"] == f'attachment; filename="{pid}-{row}.srt"'
    first = min(detail(owner, pid)["captions"], key=lambda c: c["start_frame"])
    send(owner, pid, {"type": "caption_edit", "caption_id": first["id"], "start_frame": 30,
                      "end_frame": 70, "text": first["text"]})
    out = owner.get(f"/api/projects/{pid}/rows/{row}/captions/export").content.decode("utf-8-sig")
    start_ms = rnd(Fraction(30 * 1000) / EXACT["23.976"])
    end_ms = rnd(Fraction(70 * 1000) / EXACT["23.976"])
    assert f"{ms_text(start_ms)} --> {ms_text(end_ms)}\r\n" in out
    assert f"{ms_text(3000)} --> {ms_text(4500)}\r\n" in out


def test_project_page_widths(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "widths")
    add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 100)
    for w, h, want in [(375, 812, "review-list"), (768, 1024, "two-pane"), (1280, 800, "editor")]:
        with screen(browser, app_url, owner, f"/projects/{pid}", w, h) as page:
            main = page.get_by_role("main")
            eventually(page, lambda: attr(main, "data-layout") == want, f"{want} at {w}", POLL_S)
            layout(page)
            stage = page.get_by_role("region", name="Stage").bounding_box()
            comments = page.get_by_role("region", name="Comments").bounding_box()
            if want == "editor":
                assert page.get_by_role("region", name="Timeline").count() == 1
                insp = page.get_by_role("region", name="Inspector").bounding_box()
                assert stage["x"] < insp["x"] < comments["x"]
                assert page.get_by_role("region", name="Timeline").bounding_box()["y"] > stage["y"]
                continue
            assert page.get_by_role("region", name="Timeline").count() == 0
            scrub = page.get_by_role("slider", name="Scrubber").bounding_box()
            clips_list = page.get_by_role("list", name="Clips").bounding_box()
            if want == "review-list":
                assert stage["y"] < scrub["y"] < clips_list["y"] < comments["y"]
            else:
                assert comments["x"] > stage["x"] + stage["width"] - 1 and scrub["x"] < comments["x"]


def test_project_list_widths(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    for w, h, cols in [(1280, 800, 7), (768, 1024, 4), (375, 812, 2)]:
        with screen(browser, app_url, owner, "/", w, h) as page:
            sheet = page.get_by_role("region", name="Projects")
            hl = sheet.get_by_role("group", name="Harbour Light 30s", exact=True)
            eventually(page, lambda: hl.locator("[data-sheet-frame]").count() == 4, "Harbour Light run drawn", POLL_S)
            layout(page)
            assert attr(hl, "data-role") == "owner"
            for f in [0, 240, 480, 600]:
                assert hl.get_by_role("img", name=f"Harbour Light 30s at {tc(f, '23.976')}").count() == 1
            width = page.evaluate("() => document.documentElement.clientWidth")
            col = (width - GRID_GAP * (cols + 1)) / cols
            frames = [b for b in (el.bounding_box() for el in sheet.locator("[data-sheet-frame]").all()) if b]
            if cols == 7:
                assert all(abs(b["width"] - col) <= 3 for b in frames), (w, col, {round(b["width"]) for b in frames})
            else:
                widths = {round(b["width"]) for b in frames}
                assert max(widths) - min(widths) <= 3, (w, cols, widths)
                assert max(widths) <= width, (w, cols, widths, width)
            for b in hl.locator("[data-sheet-frame]").all():
                bb = b.bounding_box()
                assert abs(bb["height"] / bb["width"] - 9 / 16) < 0.03
            sm = sheet.get_by_role("group", name="Saltmarsh Coffee Reels", exact=True).locator("[data-sheet-frame]").first.bounding_box()
            assert abs(sm["height"] / sm["width"] - 16 / 9) < 0.05
            if cols == 2:
                link = page.get_by_role("link", name="New project", exact=True)
                assert link.evaluate("el => getComputedStyle(el).position") == "fixed"
                lb = link.bounding_box()
                assert lb["x"] + lb["width"] <= width and lb["y"] + lb["height"] <= h


def radio_target(loc: Locator) -> dict:
    return loc.evaluate(
        "e => {const b = x => {const r = x.getBoundingClientRect(); return {width: r.width, height: r.height};};"
        " const own = b(e);"
        " for (const l of (e.labels ? [...e.labels] : [])) {const lb = b(l);"
        "   if (lb.width >= own.width && lb.height >= own.height) return lb;}"
        " return own;}")


def test_controls_readable(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    pid, _ = project(owner, "readable")
    add_text(owner, pid, rows(owner, pid)["Picture"]["id"], 0, 100)
    cut = name_cut(owner, pid)
    token = make_link(owner, pid, cut["id"])["token"]
    with screen(browser, app_url, None, "/sign-in") as page:
        eventually(page, lambda: page.get_by_role("button", name="Sign in").count() == 1, "sign-in form", POLL_S)
        axe(page)
        rest, focus = state_styles(page.get_by_role("button", name="Sign in"), "outline-style", "outline-width",
                                   "box-shadow", state="focus")
        assert rest != focus, "no visible focus ring"
    for path in ["/", "/library", "/profile", f"/projects/{pid}"]:
        with screen(browser, app_url, owner, path) as page:
            eventually(page, lambda: page.get_by_role("button", name="Sign out").count() == 1, f"{path} drawn", POLL_S)
            layout(page)
            rest, focus = state_styles(page.get_by_role("link", name="Projects"), "outline-style", "outline-width",
                                       "box-shadow", state="focus")
            assert rest != focus, f"no visible focus ring on {path}"
    for path, w, h in [(f"/projects/{pid}", 375, 812), (f"/projects/{pid}", 768, 1024), (f"/review/{token}", 375, 812)]:
        with screen(browser, app_url, owner, path, w, h) as page:
            eventually(page, lambda: page.get_by_role("slider", name="Scrubber").count() == 1, f"{path} at {w}", POLL_S)
            axe(page)
            for role in ["button", "link", "textbox", "slider", "radio", "combobox"]:
                for el in page.get_by_role(role).all():
                    if el.is_visible():
                        bb = radio_target(el) if role == "radio" else el.bounding_box()
                        assert bb["width"] >= TARGET_PX - 0.5 and bb["height"] >= TARGET_PX - 0.5, (role, path, w, bb)


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}


def test_if_run_manifest() -> None:
    data = json.loads((ROOT / "run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k].strip() for k in ["install", "build", "serve"])


def test_if_third_party_notices() -> None:
    notices_text = (ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices_text]
    assert not missing, f"packages missing from notices: {missing}"
    assert "Work Sans" in notices_text and "Sometype Mono" in notices_text


def test_if_licences() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad


def test_if_only_published_services() -> None:
    others = {"sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "kafkajs", "nedb", "lowdb",
              "@elastic/elasticsearch", "meilisearch", "typesense", "bullmq", "level"}
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & others, shipped & others
    stray = [p for p in DEPLOYED_APP.rglob("*") if "node_modules" not in p.parts and p.suffix in {".sqlite", ".db", ".sqlite3"}]
    assert not stray, stray


def test_if_typescript() -> None:
    skip = {"node_modules", "dist", "build", ".next", "out", ".git"}
    files = [p for p in ROOT.rglob("*") if p.is_file() and not skip & set(p.relative_to(ROOT).parts)]
    assert any(p.suffix in {".ts", ".tsx"} for p in files)
    js = [p for p in files if p.suffix in {".js", ".jsx", ".mjs", ".cjs"} and ".config." not in p.name
          and p.relative_to(ROOT).parts[0] not in {"scripts", "tools"}]
    assert not js, js


def test_if_fonts_same_origin(browser: Browser, app_url: str) -> None:
    owner = Api(app_url, "noor")
    requests: list = []
    origin = urlparse(app_url).netloc
    with screen(browser, app_url, owner, "/profile", setup=lambda p: p.on("request", lambda r: requests.append(r))) as page:
        eventually(page, lambda: page.get_by_role("button", name="Sign out").count() == 1, "profile drawn", POLL_S)
        eventually(page, lambda: page.evaluate("() => document.fonts.check('16px \"Work Sans\"')"), "Work Sans loaded", POLL_S)
    foreign = [r.url for r in requests if urlparse(r.url).scheme in ("http", "https") and urlparse(r.url).netloc != origin]
    assert not foreign, foreign
    assert any(r.resource_type == "font" for r in requests)
