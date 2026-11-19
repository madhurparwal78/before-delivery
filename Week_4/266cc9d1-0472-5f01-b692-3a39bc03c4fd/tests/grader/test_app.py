from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager, suppress
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Locator, Page

from conftest import (
    S3,
    Postgres,
    addresses,
    advance,
    animations,
    check,
    click,
    fill,
    focused_name,
    held,
    layout,
    motion,
    open_app,
    same_origin,
    scene_frames,
    serve_copy,
    session,
    tab_order,
    text,
)


ANALYST = "kestrel-analyst-2093"
PROCESSOR = "kestrel-processor-4417"
BF_ANALYST = "bluefen-analyst-7731"
BF_PROCESSOR = "bluefen-processor-6620"
UNKNOWN_CODE = "kestrel-nobody-0000"
ROSA = "rosa.lindqvist@kestrelridge.example"
CONTRACTOR = "Kestrel Ridge Aerial"
DANA = "dana.okafor@northmere.example"
LEE = "lee.marchetti@sallowvalley.example"
MAIL_FROM_ADDRESS = "reviews@larchline.example"

ASH = "nm-ash-creek"
BIRCH = "nm-birch-hollow"
CUTBANK = "sv-cutbank"
DUNE = "hc-dune-road"
ASH_NAME = "Ash Creek 345 kV"
BIRCH_NAME = "Birch Hollow 138 kV"
CUTBANK_NAME = "Cutbank 230 kV"
DUNE_NAME = "Dune Road 115 kV"
CHICAGO = "America/Chicago"
DENVER = "America/Denver"
CORRIDOR_GROUND_M = {ASH: 248.0, BIRCH: 300.0, CUTBANK: 1650.0, DUNE: 20.0}
BIRCH_GROUND_M = 300.0
ASH_TOWERS_M = [0, 312, 640, 955, 1268, 1590, 1904, 2231, 2550, 2870]
ASH_LENGTH_M = 2870
FINEST_LEVEL = 15
LEVEL15_TOL_M = 0.2
FLIGHT_HEIGHT_M = 320.0
CZML_EPOCH = "2026-06-14T14:00:00Z"
CZML_END = "2026-06-14T14:00:10Z"
SAMPLE_STEP_S = 10

STATE_LABELS = {"draft": "Draft", "submitted": "Submitted", "under_review": "Under review",
                "accepted": "Accepted", "disputed": "Disputed", "closed": "Closed"}
SIGNIN_FAIL = "That access code is not recognised."
COOKIE_HTTPONLY = "HttpOnly"
COOKIE_SAMESITE = "SameSite=Lax"
EDIT_CANOPY_M = 12.0
NO_COVERAGE = "No flight coverage"
LOCATING = "Drone locating..."
F1_SELECTED = "Selected F-1, Span 2–3, chainage 470.0 m."
FINAL_COPY = "Decisions for this revision are final."
EXPIRED_COPY = "This review link has expired. Ask your survey contractor for a new one."
WITHDRAWN_COPY = "This review link has been withdrawn. Ask your survey contractor for a new one."
UNKNOWN_COPY = "This review link does not exist."
BANNER = "Tile storage is unreachable. Findings stay editable, and tiles will reload when storage is back."
EMPTY_VIEWPORT = "No tiles can be shown right now. Use the span ribbon and the findings rail to keep working."
STORAGE_MSG = "Tile storage is unreachable."
NO_WEBGL = "3D view needs WebGL. The span ribbon and findings rail still work."
SIGN_IN = "Sign in"
SIGNING_IN = "Signing in..."
CONFIRM = "Confirm submit"
SUBMITTING = "Submitting..."
NEW_LABEL = "new finding"
CORRIDOR_COLUMNS = ["Corridor", "Utility", "Inspection due", "Findings set"]
SUMMARY_RE = re.compile(r"\d+ findings? · \d+ violations?")
TILESET_JSON = "tileset.json"
ASH_DUE = "2026-03-31"
FOREIGN_URL = "http://elsewhere.example/x"

MSG_POSITION = "Give either chainage and offset or longitude and latitude."
MSG_BIRCH_CHAINAGE = "Chainage must be between 0 and 1085.0 metres."
MSG_OFFSET = "Offset must be between -60 and 60 metres."
MSG_GROUND = "Ground height must be between -500 and 9,000 metres."
MSG_LEVEL = "Terrain level must be a whole number from 0 to 24, or empty."
MSG_CANOPY = "Canopy height must be between 0.5 and 80 metres."
MSG_RADIUS = "Canopy radius must be between 0.5 and 20 metres."
MSG_COMMENT = "Comment must be 2,000 characters or fewer."
MSG_FINDINGS = "Add at least one finding before submitting."
MSG_DECISION = "Choose accept or dispute."
MSG_NOTE = "Add a note explaining the dispute."
MSG_DECISIONS = "Decide every finding before sending."
COMMENT_MAX = 2000

JSON_LIMIT = 65_536
ASSET_JSON_LIMIT = 2_000_000
FILE_LIMIT = 50_000_000
TTL_DEFAULT_S = 1_209_600
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib"}


DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
VIEWPORT_IDS = ["phone", "tablet", "desktop"]
RIBBON_HEIGHT = (72, 120)
GLOBE_MIN_SHARE = 0.4
RAIL_DESKTOP = (320, 400)
RAIL_TABLET = (280, 340)
CHASE_UP_M = 80
CHASE_BACK_M = 150
CAM_M_TOL = 0.5
CAM_DEG_TOL = 0.1
CAM_REWRITE_MS = 1000
SHEET_MIN_MS = 150
SHEET_MAX_MS = 250
CHASE_MIN_MS = 280
CHASE_MAX_MS = 400
FLY_MIN_MS = 800
FLY_MAX_MS = 1500
STATUS_INTERVAL_MS = 10_000
STORAGE_PROBE_S = 10
STORAGE_RESUME_S = 10
QUEUED_DELIVERY_S = 60
READY_S = 5


BIRCH_TOWERS_M = [0, 210, 430, 655, 870, 1085]
BIRCH_LENGTH_M = 1085
PROBE_CH_M = (BIRCH_TOWERS_M[1] + BIRCH_TOWERS_M[2]) / 2
TIE_CH_M = PROBE_CH_M
PROBE_CH2_M = 700.0
PROBE_OFFSET_M = 20.0
VIOLATING_CANOPY_M = 17.0
CLEAR_CANOPY_M = 10.0
PROBE_BLOB_BYTES = 4096
GAP_PROBE_M = 1500.0
F3_CH_M = 1915.0
STEP_M = 10
TOKEN_MIN_CHARS = 32
URL_CAM = "-93.1960000,44.4990000,600.0,30.0,-35.0"
CHASE_START_CAM = "-93.2000000,44.4980000,500.0,0.0,-30.0"
BIRCH_START_CAM = "-93.0500000,44.6180000,500.0,0.0,-30.0"
CUTBANK_VIEW_CAM = "-105.3010000,40.1000000,1900.0,15.0,-25.0"
VIEW_T = "2026-06-14T14:00:05.000Z"
FOREIGN_ORIGIN = "http://elsewhere.example"

HTTP_TIMEOUT_S = 120
UI_WAIT_S = 30
MAIL_WAIT_S = 30
MAIL_SETTLE_S = 3
POLL_SLACK_S = 15
POLL_INTERVAL_S = 0.5
COPY_BOOT_S = 120
STEP_MS = 100
LOCATOR_TIMEOUT_MS = 2000
FRAME_MS = 17
FRAME_SLACK_MS = FRAME_MS
TOUCH_STEPS = 10
TAB_SWEEP = 12
TAB_LIMIT = 40
TICK_TOL_PX = 3
PX_TOL = 2
MOTION_EPS = 0.5
MIN_ANIM_MS = 20
GEOM_TOL_M = 0.05
CHASE_DIST_TOL_M = 2.0
SERVER_CLOCK_SLACK_S = 5
CONCURRENCY = 5
CYCLE_STEPS = 8

PAUSE = threading.Event()

INSIDE_JS = "(el) => el.contains(document.activeElement)"
REACHABLE_JS = """(el) => {
  if (el.closest('[inert]')) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const x = r.left + r.width / 2, y = r.top + r.height / 2;
  if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) return false;
  const hit = document.elementFromPoint(x, y);
  return !!hit && (hit === el || el.contains(hit));
}"""
MARKER_JS = "window.__spanwiseMarker = 1"


def norm(s: str | None) -> str:
    return re.sub(r"\s+", " ", (s or "").replace("\u00a0", " ")).strip()


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def parse_iso(s: str) -> datetime:
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def ecef(lon: float, lat: float, h: float) -> tuple[float, float, float]:
    a, f = 6_378_137.0, 1 / 298.257223563
    e2 = f * (2 - f)
    phi, lam = math.radians(lat), math.radians(lon)
    n = a / math.sqrt(1 - e2 * math.sin(phi) ** 2)
    return ((n + h) * math.cos(phi) * math.cos(lam), (n + h) * math.cos(phi) * math.sin(lam),
            (n * (1 - e2) + h) * math.sin(phi))


def seg_dist(p: tuple[float, ...], a: tuple[float, ...], b: tuple[float, ...]) -> float:
    ab = [y - x for x, y in zip(a, b)]
    ap = [y - x for x, y in zip(a, p)]
    denom = sum(v * v for v in ab)
    t = max(0.0, min(1.0, sum(x * y for x, y in zip(ap, ab)) / denom)) if denom else 0.0
    return math.dist(p, [x + t * v for x, v in zip(a, ab)])


def ang(a: float, b: float) -> float:
    return abs((a - b + 180) % 360 - 180)


def status_word(s: str) -> str:
    return "Violation" if s == "violation" else "Clear"


def lbl(n: int) -> str:
    return f"F-{n}"


def span_label(a: int, b: int) -> str:
    return f"Span {a}–{b}"


def plural(n: int, noun: str) -> str:
    return f"{n} {noun}" if n == 1 else f"{n} {noun}s"


def valuetext(ch: float, a: int, b: int, near: int) -> str:
    tail = "no findings nearby" if near == 0 else f"{plural(near, 'finding')} nearby"
    return f"Chainage {round(ch):,} metres, span {a} to {b}, {tail}"


def ch1(v: float) -> str:
    return f"{v:.1f}"


def ms_time(t: str) -> str:
    return parse_iso(t).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def fmt_drone(pos: dict[str, float]) -> str:
    lat, lon, h = pos["lat_deg"], pos["lon_deg"], pos["height_m"]
    return (f"Drone {abs(lat):.6f}° {'N' if lat >= 0 else 'S'}, "
            f"{abs(lon):.6f}° {'E' if lon >= 0 else 'W'}, {h:.1f} m")


def fmt_flight_time(t: str) -> str:
    return f"Flight time {parse_iso(t).astimezone(timezone.utc):%Y-%m-%d %H:%M:%S} UTC"


def expiry_variants(expires_at: str, tz: str) -> list[str]:
    t = parse_iso(expires_at).astimezone(ZoneInfo(tz)).replace(second=0, microsecond=0)
    return [f"Link expires {v:%Y-%m-%d %H:%M} ({tz})" for v in (t, t + timedelta(minutes=1))]


def outage_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def call(base: str, method: str, path: str, code: str | None = None, body: Any = None,
         key: str | None = None, content: bytes | None = None,
         headers: dict[str, str] | None = None) -> httpx.Response:
    h: dict[str, str] = {}
    if code:
        h["Authorization"] = f"Bearer {code}"
    if key:
        h["Idempotency-Key"] = key
    h.update(headers or {})
    kwargs: dict[str, Any] = {}
    if content is not None:
        kwargs["content"] = content
    elif body is not None:
        kwargs["json"] = body
    with httpx.Client(timeout=HTTP_TIMEOUT_S, follow_redirects=False) as client:
        return client.request(method, base + path, headers=h, **kwargs)


def expect_status(r: httpx.Response, code: int) -> None:
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text[:500]}"


def api_error(r: httpx.Response, code: int, error_code: str) -> dict[str, Any]:
    expect_status(r, code)
    body = r.json()
    assert set(body) == {"error"}, body
    err = body["error"]
    assert err["code"] == error_code and isinstance(err["message"], str) and err["message"], err
    return err


def staff_get(base: str, path: str, code: str = ANALYST) -> dict[str, Any]:
    r = call(base, "GET", path, code)
    expect_status(r, 200)
    return r.json()


def spin_until(pred: Callable[[], bool], seconds: float, message: str) -> float:
    start = time.monotonic()
    while True:
        with suppress(httpx.HTTPError, ValueError, KeyError, TypeError):
            if pred():
                return time.monotonic() - start
        if time.monotonic() - start > seconds:
            raise AssertionError(message)
        PAUSE.wait(POLL_INTERVAL_S)


def together(jobs: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(jobs))

    def run(job: Callable[[], Any]) -> Any:
        barrier.wait()
        return job()

    with ThreadPoolExecutor(len(jobs)) as ex:
        return list(ex.map(run, jobs))


def _tail(path: str) -> str:
    with suppress(OSError):
        return Path(path).read_text(errors="replace")[-3000:]
    return ""


@contextmanager
def app_copy(**env: str) -> Iterator[str]:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = serve_copy(port, log, **env)
    base = f"http://127.0.0.1:{port}"
    try:
        def up() -> bool:
            if proc.poll() is not None:
                raise AssertionError(f"app copy exited: {_tail(log.name)}")
            return httpx.get(base + "/api/health", timeout=POLL_SLACK_S).status_code == 200
        try:
            spin_until(up, COPY_BOOT_S, "app copy never answered health")
        except AssertionError as exc:
            raise AssertionError(f"{exc}\n{_tail(log.name)}") from exc
        yield base
    finally:
        with suppress(ProcessLookupError):
            os.killpg(proc.pid, signal.SIGTERM)
        with suppress(subprocess.TimeoutExpired):
            proc.wait(timeout=POLL_SLACK_S)
        log.close()


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.up = False
        self.closed = False
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen(64)
        self.port = self.sock.getsockname()[1]
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while not self.closed:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            if not self.up:
                conn.close()
                continue
            threading.Thread(target=self._pair, args=(conn,), daemon=True).start()

    def _pair(self, conn: socket.socket) -> None:
        try:
            upstream = socket.create_connection(self.target, timeout=POLL_SLACK_S)
        except OSError:
            conn.close()
            return
        upstream.settimeout(None)
        for a, b in ((conn, upstream), (upstream, conn)):
            threading.Thread(target=self._copy, args=(a, b), daemon=True).start()

    @staticmethod
    def _copy(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            with suppress(OSError):
                dst.shutdown(socket.SHUT_WR)

    def close(self) -> None:
        self.closed = True
        with suppress(OSError):
            self.sock.shutdown(socket.SHUT_RDWR)
        self.sock.close()


def finding_body(corridor: str = BIRCH, chainage: float = PROBE_CH_M, offset: float = 0.0,
                 ground: float | None = None, level: int | None = FINEST_LEVEL,
                 canopy: float = CLEAR_CANOPY_M, radius: float = 3.0, comment: str = "") -> dict[str, Any]:
    return {"chainage_m": chainage, "offset_m": offset,
            "ground_height_m": CORRIDOR_GROUND_M[corridor] if ground is None else ground,
            "terrain_level": level, "canopy_height_m": canopy, "canopy_radius_m": radius, "comment": comment}


def add_finding(base: str, set_id: str, code: str = ANALYST, **kw: Any) -> dict[str, Any]:
    r = call(base, "POST", f"/api/findings-sets/{set_id}/findings", code, finding_body(**kw))
    expect_status(r, 201)
    return r.json()["finding"]


def token_of(link: dict[str, Any]) -> str:
    return link["url"].rstrip("/").rsplit("/", 1)[1]


def live_token(base: str, set_id: str, code: str = ANALYST) -> str:
    link = staff_get(base, f"/api/findings-sets/{set_id}", code)["set"]["review_link"]
    if link and link["status"] == "live":
        return token_of(link)
    r = call(base, "POST", f"/api/findings-sets/{set_id}/review-link/regenerate", code, {})
    expect_status(r, 201)
    return token_of(r.json()["review_link"])


def decide(base: str, token: str, fid: str, decision: str, note: str = "") -> httpx.Response:
    return call(base, "PUT", f"/api/review/{token}/findings/{fid}/decision",
                body={"decision": decision, "note": note})


def complete_all(base: str, token: str, decision: str = "accept", note: str = "") -> None:
    r = call(base, "GET", f"/api/review/{token}")
    if r.status_code != 200:
        return
    for f in r.json()["findings"]:
        decide(base, token, f["id"], decision, note)
    call(base, "POST", f"/api/review/{token}/complete", body={})


def fresh_draft(base: str, corridor: str = BIRCH, code: str = ANALYST) -> dict[str, Any]:
    for _ in range(CYCLE_STEPS):
        cur = staff_get(base, f"/api/corridors/{corridor}", code)["corridor"]["current_set"]
        if cur is None or cur["state"] == "closed":
            r = call(base, "POST", f"/api/corridors/{corridor}/findings-sets", code, {})
            expect_status(r, 201)
            return r.json()["set"]
        sid, state = cur["id"], cur["state"]
        if state == "draft":
            if not staff_get(base, f"/api/findings-sets/{sid}", code)["findings"]:
                add_finding(base, sid, code, corridor=corridor)
            expect_status(call(base, "POST", f"/api/findings-sets/{sid}/submit", code, {}), 200)
        elif state in ("submitted", "under_review"):
            complete_all(base, live_token(base, sid, code))
        elif state == "accepted":
            expect_status(call(base, "POST", f"/api/findings-sets/{sid}/close", code, {}), 200)
        elif state == "disputed":
            expect_status(call(base, "POST", f"/api/findings-sets/{sid}/revisions", code, {}), 201)
    raise AssertionError(f"could not reach a fresh draft on {corridor}")


def submitted_set(base: str, corridor: str = BIRCH, specs: list[dict[str, Any]] | None = None
                  ) -> tuple[str, str, list[dict[str, Any]], dict[str, Any]]:
    s = fresh_draft(base, corridor)
    fs = [add_finding(base, s["id"], corridor=corridor, **spec) for spec in (specs or [{}])]
    r = call(base, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {})
    expect_status(r, 200)
    res = r.json()
    return s["id"], token_of(res["review_link"]), fs, res


def finished_set(base: str, decisions: list[str], specs: list[dict[str, Any]],
                 note: str = "") -> tuple[str, str, list[dict[str, Any]]]:
    sid, token, fs, _ = submitted_set(base, BIRCH, specs)
    expect_status(call(base, "GET", f"/api/review/{token}"), 200)
    for f, d in zip(fs, decisions):
        expect_status(decide(base, token, f["id"], d, note if d == "dispute" else ""), 200)
    expect_status(call(base, "POST", f"/api/review/{token}/complete", body={}), 200)
    return sid, token, fs


def tileset_json(nonce: str) -> bytes:
    return ('{\n  "asset" : {"version":"1.0"},\n\t"geometricError": 0,\n  "root": {"boundingVolume": '
            '{"sphere": [0, 0, 0, 1]}, "geometricError": 0},\n  "extras": {"nonce": "' + nonce + '"}\n}\n').encode()


def czml_bytes(towers: list[dict[str, Any]], nonce: str) -> bytes:
    t1, t2 = towers[0], towers[1]
    doc = [{"id": "document", "name": nonce, "version": "1.0"},
           {"id": nonce, "availability": f"{CZML_EPOCH}/{CZML_END}",
            "position": {"epoch": CZML_EPOCH, "cartographicDegrees": [
                0, t1["lon_deg"], t1["lat_deg"], FLIGHT_HEIGHT_M,
                SAMPLE_STEP_S, t2["lon_deg"], t2["lat_deg"], FLIGHT_HEIGHT_M]}}]
    return ("[\n  " + ",\n\t".join(json.dumps(p, indent=3) for p in doc) + "\n]\n").encode()


def manifest(kind: str, files: dict[str, bytes]) -> dict[str, Any]:
    return {"kind": kind, "files": [{"path": p, "size_bytes": len(b), "sha256": sha(b)} for p, b in files.items()]}


def declare(base: str, corridor: str, kind: str, files: dict[str, bytes], code: str = PROCESSOR) -> httpx.Response:
    return call(base, "POST", f"/api/corridors/{corridor}/assets", code, manifest(kind, files))


def put_file(base: str, asset_id: str, path: str, data: bytes, code: str = PROCESSOR) -> httpx.Response:
    return call(base, "PUT", f"/api/assets/{asset_id}/files/{path}", code, content=data,
                headers={"Content-Type": "application/octet-stream"})


def upload_asset(base: str, corridor: str, kind: str, files: dict[str, bytes]) -> dict[str, Any]:
    r = declare(base, corridor, kind, files)
    expect_status(r, 201)
    aid = r.json()["asset"]["id"]
    for path, data in files.items():
        expect_status(put_file(base, aid, path, data), 200)
    asset = staff_get(base, f"/api/assets/{aid}", PROCESSOR)["asset"]
    assert asset["state"] == "stored", asset
    return asset


def asset_prefix(corridor: str, asset_id: str) -> str:
    return f"tenants/kestrel/corridors/{corridor}/assets/{asset_id}/"


def find_asset(base: str, corridor: str, nonce: str) -> dict[str, Any] | None:
    for a in staff_get(base, f"/api/corridors/{corridor}/assets", PROCESSOR)["assets"]:
        if any(nonce in f["path"] for f in a["files"]):
            return a
    return None


def flight(base: str, corridor: str, code: str = ANALYST, **q: str) -> httpx.Response:
    return call(base, "GET", f"/api/corridors/{corridor}/flight?{urlencode(q)}", code)


def ash_set_id(base: str) -> str:
    return staff_get(base, f"/api/corridors/{ASH}")["corridor"]["current_set"]["id"]


def mails_containing(mail: Any, needle: str, expected: int = 1, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages() if needle in text(m)]
        if len(found) >= expected or time.monotonic() > deadline:
            return found


def settled_mails(mail: Any, needle: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=MAIL_SETTLE_S) if needle in text(m)]


@contextmanager
def staff_page(browser: Any, base: str, code: str, path: str, viewport: dict[str, int] = DESKTOP,
               **opts: Any) -> Iterator[Page]:
    with open_app(browser, base + "/", **opts) as page:
        r = page.context.request.post(base + "/api/session", data={"access_code": code})
        assert r.status == 200, r.text()
        page.set_viewport_size(viewport)
        page.goto(base + path)
        yield page


@contextmanager
def review_page(browser: Any, base: str, token: str, query: str = "",
                viewport: dict[str, int] = DESKTOP, **opts: Any) -> Iterator[Page]:
    url = f"{base}/review/{token}{query}"
    with open_app(browser, url, **opts) as page:
        page.set_viewport_size(viewport)
        page.goto(url)
        yield page


def wait_until(page: Page, predicate: Callable[[], bool], seconds: float = UI_WAIT_S, message: str = "") -> None:
    deadline = time.monotonic() + seconds
    while True:
        try:
            if predicate():
                return
        except PlaywrightError:
            pass
        if time.monotonic() > deadline:
            raise AssertionError(message or "condition not met in time")
        advance(page, STEP_MS)


def has_text(loc: Any, needle: str) -> bool:
    try:
        return needle.lower() in norm(loc.text_content(timeout=LOCATOR_TIMEOUT_MS)).lower()
    except PlaywrightError:
        return False


def wait_text(page: Page, loc: Any, needle: str, seconds: float = UI_WAIT_S) -> None:
    wait_until(page, lambda: has_text(loc, needle), seconds, f"never showed: {needle}")


def body_text(page: Page) -> str:
    return norm(page.evaluate("document.body.innerText"))


def status(page: Page, name: str) -> Any:
    return page.get_by_role("status", name=name)


def readout(page: Page) -> Any:
    return page.get_by_role("region", name="Position readout")


def ro_text(page: Page) -> str:
    return norm(readout(page).inner_text(timeout=LOCATOR_TIMEOUT_MS))


def slider(page: Page) -> Any:
    return page.get_by_role("slider", name="Corridor chainage")


def valuenow(page: Page) -> float:
    return float(slider(page).get_attribute("aria-valuenow", timeout=LOCATOR_TIMEOUT_MS) or "nan")


def options(page: Page) -> Any:
    return page.get_by_role("listbox", name="Findings").get_by_role("option")


def option(page: Page, label: str) -> Any:
    return page.get_by_role("listbox", name="Findings").get_by_role("option", name=re.compile(rf"^{re.escape(label)}\b"))


def review_item(page: Page, label: str) -> Any:
    return page.get_by_role("list", name="Findings for review").get_by_role("listitem").filter(
        has_text=re.compile(rf"\b{re.escape(label)}\b"))


def selected(page: Page, label: str) -> bool:
    return option(page, label).get_attribute("aria-selected", timeout=LOCATOR_TIMEOUT_MS) == "true"


def url_params(page: Page) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def history_length(page: Page) -> int:
    return int(page.evaluate("history.length"))


CAM_RE = re.compile(r"Camera (-?[\d,]+\.\d) m above ground, heading (-?[\d.]+)°, pitch (-?[\d.]+)°")


def cam_line(page: Page) -> tuple[float, float, float]:
    m = CAM_RE.search(ro_text(page))
    assert m, ro_text(page)
    return float(m[1].replace(",", "")), float(m[2]), float(m[3])


def cam_values(s: str) -> list[float]:
    return [float(v) for v in s.split(",")]


def wait_applied(page: Page, seconds: float = UI_WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while True:
        with suppress(PlaywrightError):
            t = ro_text(page)
            if "Drone " in t and LOCATING not in t:
                return
        if time.monotonic() > deadline:
            raise AssertionError("flight answer never applied to the readout")
        advance(page, FRAME_MS)


def cam_close(a: str, b: str) -> bool:
    x, y = cam_values(a), cam_values(b)
    return (math.dist(ecef(x[0], x[1], x[2]), ecef(y[0], y[1], y[2])) <= CAM_M_TOL
            and ang(x[3], y[3]) <= CAM_DEG_TOL and abs(x[4] - y[4]) <= CAM_DEG_TOL)


def wait_ready(page: Page, count: int | None = None) -> None:
    def ok() -> bool:
        if "Chainage" not in ro_text(page) or not slider(page).is_visible():
            return False
        return count is None or options(page).count() == count
    wait_until(page, ok, message="workspace never became ready")


def tab_to(page: Page, name: str, reverse: bool = False) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Shift+Tab" if reverse else "Tab")
        if focused_name(page) == name:
            return
    raise AssertionError(f"Tab never reached {name}")


def reveal_download(page: Page, name: str) -> Any:
    link = page.get_by_role("link", name=name, exact=True)
    if link.count():
        return link
    region = page.get_by_role("region", name="Survey assets")
    buttons = region.get_by_role("button", name="Files", exact=True)
    for i in range(buttons.count()):
        b = buttons.nth(i)
        if b.get_attribute("aria-expanded") == "true":
            continue
        click(b)
        wait_until(page, lambda: b.get_attribute("aria-expanded") == "true")
        if link.count():
            return link
        click(b)
    raise AssertionError(f"no {name} link found")


ENTRY_WATCH_JS = """() => { window.__entryEnds = [];
  const rec = ev => { for (const a of ev.target.getAnimations()) {
    const t = a.effect && a.effect.getComputedTiming();
    if (t && Number.isFinite(t.endTime)) window.__entryEnds.push({el: ev.target, end: t.endTime}); } };
  for (const k of ['animationstart', 'transitionrun']) document.addEventListener(k, rec, true); }"""
ENTRY_ENDS_JS = """d => [...(window.__entryEnds || []).filter(r => d.contains(r.el) ||
  (r.el.contains(d) && r.el !== document.body && r.el !== document.documentElement)).map(r => r.end),
  ...d.getAnimations({subtree: true}).map(a => a.effect && a.effect.getComputedTiming().endTime)
     .filter(Number.isFinite)]"""


STREAMING_RE = re.compile(r"Streaming \d+ tiles?", re.I)
IDLE_STEP_MS = 100
IDLE_QUIET_MS = 1000


def act_until_response(page: Page, act: Callable[[], Any], want: Callable[[Any], bool],
                       seconds: float = UI_WAIT_S) -> None:
    seen: list[Any] = []

    def on_response(r: Any) -> None:
        if want(r):
            seen.append(r)
    page.on("response", on_response)
    try:
        act()
        deadline = time.monotonic() + seconds
        while not seen:
            assert time.monotonic() < deadline, "the expected request was never answered"
            advance(page, FRAME_MS)
    finally:
        page.remove_listener("response", on_response)


def wait_streaming_idle(page: Page, seconds: float = UI_WAIT_S) -> None:
    deadline, quiet = time.monotonic() + seconds, 0
    while quiet < IDLE_QUIET_MS:
        assert time.monotonic() < deadline, "tile streaming never went idle"
        quiet = 0 if STREAMING_RE.search(body_text(page)) else quiet + IDLE_STEP_MS
        advance(page, IDLE_STEP_MS)


def watch_entry(page: Page) -> None:
    page.evaluate(ENTRY_WATCH_JS)


def assert_entry_window(locator: Locator) -> None:
    ends = [e for e in locator.evaluate(ENTRY_ENDS_JS) if e >= MIN_ANIM_MS]
    if ends:
        assert SHEET_MIN_MS / 2 <= max(ends) <= SHEET_MAX_MS + FRAME_SLACK_MS, ends
        return
    moving, step = moving_times(motion(locator, SHEET_MAX_MS * 2), SHEET_MAX_MS * 2)
    assert moving and max(moving) <= SHEET_MAX_MS + step and max(moving) >= SHEET_MIN_MS / 2, moving


def moving_times(path: list[dict[str, float]], duration_ms: float) -> tuple[list[float], float]:
    final = path[-1]
    keys = [k for k, v in final.items() if k != "t" and isinstance(v, (int, float))]
    step = duration_ms / max(len(path) - 1, 1)
    times = [p.get("t", i * step) for i, p in enumerate(path)]
    moving = [t for t, p in zip(times, path) if any(abs(p[k] - final[k]) > MOTION_EPS for k in keys)]
    return moving, step


def pose_trace(page: Page, step_ms: float, limit_ms: float) -> list[tuple[float, tuple[float, float]]]:
    trace, t = [], 0.0
    while t < limit_ms:
        advance(page, step_ms)
        t += step_ms
        _, hd, p = cam_line(page)
        trace.append((t, (hd, p)))
    return trace


def settle_of(trace: list[tuple[float, tuple[float, float]]]) -> float:
    final = trace[-1][1]
    moving = [t for t, pose in trace if pose != final]
    assert moving, "camera never moved"
    return max(moving)


def pose_at(trace: list[tuple[float, tuple[float, float]]], ms: float) -> tuple[float, float]:
    return min(trace, key=lambda e: abs(e[0] - ms))[1]


def long_animations(anims: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [a for a in anims if float(a.get("duration", a.get("duration_ms", 0)) or 0) >= MIN_ANIM_MS]


class Gate:

    def __init__(self, page: Page, glob: str, method: str = "POST", abort_first: bool = False) -> None:
        self.requests: list[Any] = []
        self.held: list[Any] = []
        self.method, self.abort_first = method, abort_first
        page.route(glob, self._handle)

    def _handle(self, route: Any) -> None:
        if route.request.method != self.method:
            route.continue_()
            return
        self.requests.append(route.request)
        if self.abort_first and len(self.requests) == 1:
            route.abort()
            return
        self.held.append(route)

    def release(self) -> None:
        while self.held:
            self.held.pop(0).continue_()


def press_again(page: Page, btn: Any) -> None:
    with suppress(PlaywrightError):
        btn.click(force=True, timeout=LOCATOR_TIMEOUT_MS)
    with suppress(PlaywrightError):
        btn.press("Enter", timeout=LOCATOR_TIMEOUT_MS)


def check_layout(page: Page, vp_name: str, workspace: bool) -> None:
    layout(page)
    vw, vh = VIEWPORTS[vp_name]["width"], VIEWPORTS[vp_name]["height"]
    g = page.get_by_role("application", name="Corridor globe").bounding_box()
    rail = page.get_by_role("complementary", name="Findings rail").bounding_box()
    rib = page.get_by_role("region", name="Span ribbon").bounding_box()
    ro = readout(page).bounding_box()
    assert g and rail and rib and ro
    assert RIBBON_HEIGHT[0] - PX_TOL <= rib["height"] <= RIBBON_HEIGHT[1] + PX_TOL, rib
    assert abs(rib["width"] - vw) <= PX_TOL, rib
    assert g["height"] >= GLOBE_MIN_SHARE * vh - PX_TOL, g

    def inside(a: dict[str, float], b: dict[str, float]) -> bool:
        return (a["x"] >= b["x"] - PX_TOL and a["y"] >= b["y"] - PX_TOL
                and a["x"] + a["width"] <= b["x"] + b["width"] + PX_TOL
                and a["y"] + a["height"] <= b["y"] + b["height"] + PX_TOL)

    if vp_name in ("desktop", "tablet"):
        lo, hi = RAIL_DESKTOP if vp_name == "desktop" else RAIL_TABLET
        assert lo - PX_TOL <= rail["width"] <= hi + PX_TOL, rail
        assert abs(rail["x"] + rail["width"] - vw) <= PX_TOL, rail
        assert g["x"] + g["width"] <= rail["x"] + PX_TOL and abs(g["x"]) <= PX_TOL, (g, rail)
        assert rail["y"] + rail["height"] <= rib["y"] + PX_TOL and g["y"] + g["height"] <= rib["y"] + PX_TOL
    if vp_name == "desktop":
        assert inside(ro, g) and ro["x"] < g["x"] + g["width"] / 2 and ro["y"] < g["y"] + g["height"] / 2, (ro, g)
    elif vp_name == "tablet":
        assert inside(ro, rail), (ro, rail)
        below = (page.get_by_role("tablist", name="Rail sections") if workspace
                 else page.get_by_role("list", name="Findings for review")).bounding_box()
        assert below and below["y"] >= ro["y"] + ro["height"] - PX_TOL, (ro, below)
    else:
        assert abs(g["width"] - vw) <= PX_TOL, g
        assert rail["y"] >= g["y"] + g["height"] - PX_TOL, (g, rail)
        assert rib["y"] >= rail["y"] + rail["height"] - PX_TOL, (rail, rib)
        assert inside(ro, g) and ro["x"] < g["x"] + g["width"] / 2 and ro["y"] < g["y"] + g["height"] / 2, (ro, g)
        assert page.get_by_role("button", name="Show findings", exact=True).is_visible()


def touch_path(page: Page, points: Callable[[float], list[tuple[float, float]]]) -> None:
    cdp = session(page)

    def pts(frac: float) -> list[dict[str, float]]:
        return [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points(frac))]

    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": pts(0)})
    for k in range(1, TOUCH_STEPS + 1):
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": pts(k / TOUCH_STEPS)})
        advance(page, FRAME_MS)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    advance(page, CAM_REWRITE_MS * 2)


def test_staff_session_api(app_url):
    r = call(app_url, "POST", "/api/session", body={"access_code": ANALYST})
    expect_status(r, 200)
    staff = r.json()["staff"]
    assert (staff["role"], staff["email"], staff["tenant_id"], staff["tenant_name"], staff["name"]) == (
        "vegetation_analyst", ROSA, "kestrel", CONTRACTOR, "Rosa Lindqvist")
    cookies = [c for c in r.headers.get_list("set-cookie") if c.startswith("spanwise_session=")]
    attrs = [a.strip().lower() for a in cookies[0].split(";")] if cookies else []
    assert cookies and COOKIE_HTTPONLY.lower() in attrs and COOKIE_SAMESITE.lower() in attrs, cookies
    jar = {"Cookie": cookies[0].split(";")[0]}
    expect_status(call(app_url, "GET", "/api/corridors", headers=jar), 200)
    me = call(app_url, "GET", "/api/session", headers=jar)
    expect_status(me, 200)
    assert me.json()["staff"]["email"] == ROSA
    assert staff_get(app_url, "/api/session", PROCESSOR)["staff"]["role"] == "survey_processor"
    bad = call(app_url, "POST", "/api/session", body={"access_code": UNKNOWN_CODE})
    assert api_error(bad, 401, "invalid_access_code")["message"] == SIGNIN_FAIL
    assert not [c for c in bad.headers.get_list("set-cookie") if c.startswith("spanwise_session=")]
    err = api_error(call(app_url, "POST", "/api/session", body={"access_code": ""}), 422, "validation_failed")
    assert err["fields"]["access_code"] == "Enter your access code."
    api_error(call(app_url, "GET", "/api/session"), 401, "unauthenticated")
    expect_status(call(app_url, "DELETE", "/api/session", headers=jar), 204)
    expect_status(call(app_url, "GET", "/api/session", headers=jar), 401)


def test_wf_corridor_navigation_bad_code(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        page.goto(app_url + "/")
        wait_until(page, lambda: page.get_by_role("heading", name="Spanwise", level=1).is_visible())
        fill(page.get_by_role("textbox", name="Access code"), UNKNOWN_CODE)
        btn = page.get_by_role("button", name=re.compile(f"^({re.escape(SIGN_IN)}|{re.escape(SIGNING_IN)})$"))
        with held(page, "**/api/session") as hold:
            click(btn)
            wait_until(page, lambda: "Signing in..." in norm(btn.text_content()))
            hold.release()
        wait_text(page, status(page, "Sign-in status"), SIGNIN_FAIL)
        assert urlparse(page.url).path == "/"
        assert page.context.request.get(app_url + "/api/session").status == 401
        fill(page.get_by_role("textbox", name="Access code"), ANALYST)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_until(page, lambda: urlparse(page.url).path == "/corridors")
        assert page.context.request.get(app_url + "/api/session").status == 200


def test_inspection_due_and_overdue(app_url):
    cs = {c["id"]: c for c in staff_get(app_url, "/api/corridors")["corridors"]}
    for cid, due, tz, overdue in ((ASH, "2026-03-31", CHICAGO, True), (BIRCH, "2030-06-30", CHICAGO, False),
                                  (CUTBANK, "2030-09-30", DENVER, False)):
        assert (cs[cid]["inspection_due"], cs[cid]["utility"]["time_zone"], cs[cid]["overdue"]) == (due, tz, overdue)
    dune = staff_get(app_url, f"/api/corridors/{DUNE}", BF_ANALYST)["corridor"]
    assert (dune["inspection_due"], dune["utility"]["time_zone"], dune["overdue"]) == (
        "2030-05-31", "America/Los_Angeles", False)
    names = [c["name"] for c in staff_get(app_url, "/api/corridors")["corridors"]]
    assert names == sorted(names)


def test_tenant_isolation(app_url):
    sid = ash_set_id(app_url)
    f1 = next(f for f in staff_get(app_url, f"/api/findings-sets/{sid}")["findings"] if f["label"] == "F-1")
    ids = {c["id"] for c in staff_get(app_url, "/api/corridors", BF_ANALYST)["corridors"]}
    assert DUNE in ids and not ids & {ASH, BIRCH, CUTBANK}
    for path in (f"/api/corridors/{ASH}", f"/api/corridors/{ASH}/assets", f"/api/corridors/{ASH}/flight?chainage_m=10.0",
                 f"/api/findings-sets/{sid}", "/api/assets/ast-ash-czml",
                 "/api/assets/ast-ash-czml/files/ash-creek-2026-06-14.czml"):
        api_error(call(app_url, "GET", path, BF_ANALYST), 404, "not_found")
    api_error(call(app_url, "PATCH", f"/api/findings/{f1['id']}", BF_ANALYST, {"comment": "x"}), 404, "not_found")
    api_error(call(app_url, "DELETE", f"/api/findings/{f1['id']}", BF_ANALYST), 404, "not_found")
    api_error(call(app_url, "POST", f"/api/findings-sets/{sid}/findings", BF_ANALYST, finding_body()), 404, "not_found")
    api_error(call(app_url, "POST", f"/api/corridors/{ASH}/findings-sets", BF_ANALYST, {}), 404, "not_found")
    api_error(declare(app_url, CUTBANK, "tileset", {"tileset.json": tileset_json("x")}, BF_PROCESSOR), 404, "not_found")
    after = next(f for f in staff_get(app_url, f"/api/findings-sets/{sid}")["findings"] if f["id"] == f1["id"])
    assert after["comment"] == f1["comment"] == "Silver maple leader under conductor, east of T2"
    api_error(call(app_url, "GET", f"/api/corridors/{DUNE}", ANALYST), 404, "not_found")


def test_wf_corridor_navigation_happy(browser, app_url):
    cs = {c["id"]: c for c in staff_get(app_url, "/api/corridors")["corridors"]}
    findings = staff_get(app_url, f"/api/findings-sets/{ash_set_id(app_url)}")["findings"]
    with open_app(browser, app_url + "/") as page:
        page.set_viewport_size(DESKTOP)
        page.goto(app_url + "/")
        fill(page.get_by_role("textbox", name="Access code"), ANALYST)
        click(page.get_by_role("button", name="Sign in", exact=True))
        wait_until(page, lambda: urlparse(page.url).path == "/corridors")
        wait_until(page, lambda: page.get_by_role("heading", name="Corridors", level=1).is_visible())
        table = page.get_by_role("table", name="Corridors")
        for cid, due, tz, overdue in ((ASH, "2026-03-31", CHICAGO, True), (BIRCH, "2030-06-30", CHICAGO, False),
                                      (CUTBANK, "2030-09-30", DENVER, False)):
            c = cs[cid]
            row = table.get_by_role("row").filter(has=page.get_by_role("link", name=c["name"], exact=True))
            wait_until(page, lambda: row.count() == 1)
            t = norm(row.text_content())
            assert f"Inspection due {due} ({tz})" in t and c["utility"]["name"] in t, t
            assert ("Overdue" in t) == overdue, t
            state = c["current_set"]["state"] if c["current_set"] else None
            assert STATE_LABELS.get(state or "", "No findings set").lower() in t.lower(), t
        assert table.get_by_role("link", name=DUNE_NAME).count() == 0
        click(table.get_by_role("link", name=ASH_NAME, exact=True))
        wait_until(page, lambda: page.get_by_role("heading", name=ASH_NAME, level=1).is_visible())
        for role, name in (("application", "Corridor globe"), ("complementary", "Findings rail"), ("region", "Span ribbon")):
            assert page.get_by_role(role, name=name).is_visible()
        wait_ready(page, len(findings))
        me = page.context.request.get(app_url + "/api/session")
        assert me.status == 200 and me.json()["staff"]["role"] == "vegetation_analyst"


def test_ribbon_keys_and_mapping(browser, app_url):
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}") as page:
        wait_ready(page)
        s = slider(page)
        assert float(s.get_attribute("aria-valuemin")) == 0 and float(s.get_attribute("aria-valuemax")) == ASH_LENGTH_M
        assert s.get_attribute("aria-valuetext") == valuetext(0, 1, 2, 0)
        ribbon = page.get_by_role("region", name="Span ribbon")
        xs = []
        for k in range(1, len(ASH_TOWERS_M) + 1):
            box = ribbon.get_by_text(re.compile(rf"^\s*T{k}\s*$")).first.bounding_box()
            assert box, f"no tick T{k}"
            xs.append(box["x"] + box["width"] / 2)
        assert xs == sorted(xs) and len(set(xs)) == len(xs)
        x0, x1, c0, c1 = xs[1], xs[-2], ASH_TOWERS_M[1], ASH_TOWERS_M[-2]
        for x, ch in zip(xs[1:-1], ASH_TOWERS_M[1:-1]):
            assert abs((x - x0) - (x1 - x0) * (ch - c0) / (c1 - c0)) <= TICK_TOL_PX, (x, ch)
        s.focus()
        for key, want in (("ArrowRight", 10), ("Shift+ArrowRight", 110), ("ArrowUp", 120), ("ArrowDown", 110),
                          ("ArrowLeft", 100), ("Shift+ArrowLeft", 0), ("ArrowLeft", 0), ("PageDown", 312),
                          ("PageDown", 640), ("PageUp", 312), ("PageUp", 0), ("End", 2870), ("ArrowUp", 2870),
                          ("Shift+ArrowDown", 2770), ("Home", 0)):
            page.keyboard.press(key)
            wait_until(page, lambda: valuenow(page) == want, message=f"{key} should give {want}")
        page.keyboard.press("End")
        wait_until(page, lambda: s.get_attribute("aria-valuetext") == valuetext(ASH_LENGTH_M, 9, 10, 0))
        page.keyboard.press("Home")
        for _ in range(12):
            page.keyboard.press("Shift+ArrowRight")
        for _ in range(4):
            page.keyboard.press("ArrowRight")
        wait_until(page, lambda: s.get_attribute("aria-valuetext") == valuetext(1240, 4, 5, 0))
        page.keyboard.press("Home")
        for _ in range(4):
            page.keyboard.press("Shift+ArrowRight")
        for _ in range(7):
            page.keyboard.press("ArrowRight")
        wait_until(page, lambda: s.get_attribute("aria-valuetext") == valuetext(470, 2, 3, 1))
        sb = s.bounding_box()
        y = sb["y"] + sb["height"] / 2
        span_px = (x1 - x0) * ASH_LENGTH_M / (c1 - c0)
        min_gap_m = min(b - a for a, b in zip(ASH_TOWERS_M, ASH_TOWERS_M[1:]))
        tol_m = max(TICK_TOL_PX * ASH_LENGTH_M / span_px, min_gap_m / 4)
        got = []
        for idx in (2, 4, 7):
            page.mouse.click(xs[idx], y)
            wait_until(page, lambda: abs(valuenow(page) - ASH_TOWERS_M[idx]) <= tol_m, message=f"click at T{idx + 1}")
            got.append(valuenow(page))
        assert got == sorted(got)


def test_wf_corridor_navigation_url_state(browser, app_url):
    ids = {f["label"]: f["id"] for f in staff_get(app_url, f"/api/findings-sets/{ash_set_id(app_url)}")["findings"]}
    query = urlencode({"ch": "470.0", "t": "2026-06-14T14:04:00.000Z", "f": ids["F-1"], "cam": URL_CAM})
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}?{query}") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        wait_ready(page)
        wait_until(page, lambda: valuenow(page) == 470 and selected(page, "F-1"))
        wait_until(page, lambda: fmt_flight_time("2026-06-14T14:04:00.000Z") in ro_text(page))
        _, hd, p = cam_line(page)
        want = cam_values(URL_CAM)
        assert ang(hd, want[3]) <= CAM_DEG_TOL and abs(p - want[4]) <= CAM_DEG_TOL
        advance(page, CAM_REWRITE_MS * 2)
        assert cam_close(url_params(page)["cam"], URL_CAM)
        click(page.get_by_role("button", name="Copy view link"))
        wait_text(page, status(page, "View status"), "View link copied.")
        assert page.evaluate("navigator.clipboard.readText()") == page.url
        h0 = history_length(page)
        slider(page).focus()
        page.keyboard.press("PageDown")
        wait_until(page, lambda: url_params(page).get("ch") == ch1(ASH_TOWERS_M[2]))
        assert history_length(page) == h0
        click(option(page, "F-3"))
        wait_until(page, lambda: url_params(page).get("f") == ids["F-3"] and url_params(page).get("ch") == ch1(F3_CH_M))
        assert history_length(page) == h0 + 1
        advance(page, CAM_REWRITE_MS * 2)
        assert history_length(page) == h0 + 1
        page.go_back()
        wait_until(page, lambda: valuenow(page) == 640 and selected(page, "F-1"))
        page.go_forward()
        wait_until(page, lambda: valuenow(page) == 1915 and selected(page, "F-3"))
        page.goto(f"{app_url}/corridors/{ASH}")
        wait_ready(page)
        wait_until(page, lambda: valuenow(page) == 0)
        assert all(options(page).nth(i).get_attribute("aria-selected") != "true" for i in range(options(page).count()))


def test_wf_corridor_navigation_phone_sheet(browser, app_url):
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}", viewport=PHONE) as page:
        toggle = page.get_by_role("button", name="Show findings", exact=True)
        wait_until(page, lambda: toggle.is_visible())
        rail = page.get_by_role("complementary", name="Findings rail")
        assert toggle.get_attribute("aria-expanded") == "false"
        assert SUMMARY_RE.search(norm(rail.text_content()))
        assert page.get_by_role("listbox", name="Findings").count() == 0
        assert page.get_by_role("tablist", name="Rail sections").count() == 0
        assert page.get_by_role("option").count() == 0
        for name in ("New finding at playhead", "Edit finding", "Upload assets"):
            assert page.get_by_role("button", name=name).count() == 0
        hidden = page.get_by_role("option", include_hidden=True)
        for i in range(hidden.count()):
            assert not hidden.nth(i).evaluate(REACHABLE_JS), "collapsed option is still clickable"
        page.evaluate("document.activeElement && document.activeElement.blur()")
        names = tab_order(page, TAB_SWEEP)
        assert names[0] == "Skip to span ribbon", names
        order = [names.index(n) for n in ("Show findings", "Previous span", "Corridor chainage", "Next span")]
        assert order == sorted(order), names
        assert not any(n.startswith("F-") or n in {"Findings", "Assets", "New finding at playhead", "Edit finding"} for n in names)
        slider(page).focus()
        page.keyboard.press("j")
        wait_text(page, status(page, "View status"), F1_SELECTED)
        assert toggle.get_attribute("aria-expanded") == "false" and focused_name(page) == "Corridor chainage"
        wait_until(page, lambda: valuenow(page) == 470)
        click(toggle)
        hide = page.get_by_role("button", name="Hide findings", exact=True)
        wait_until(page, lambda: hide.get_attribute("aria-expanded") == "true" and rail.evaluate(INSIDE_JS))
        for _ in range(TAB_SWEEP):
            page.keyboard.press("Tab")
            assert rail.evaluate(INSIDE_JS), "focus left the expanded sheet"
        page.keyboard.press("Escape")
        wait_until(page, lambda: focused_name(page) == "Show findings")
        assert page.get_by_role("listbox", name="Findings").count() == 0


FLIGHT_CASES = {
    "chainage_634": {"query": {"chainage_m": "634"}, "covered": True, "time": "2026-06-14T14:04:00.000Z", "between": [2, 3]},
    "earlier_pass_2387": {"query": {"chainage_m": "2387"}, "covered": True, "time": "2026-06-14T14:18:30.000Z", "between": [8, 9]},
    "reverse_pass_time": {"query": {"time": "2026-06-14T14:33:30Z"}, "covered": True, "chainage": 2387.0, "between": [8, 9]},
    "stray_sample_0900": {"query": {"time": "2026-06-14T14:09:00Z"}, "covered": False},
    "stray_sample_2600": {"query": {"time": "2026-06-14T14:26:00Z"}, "covered": False},
    "out_of_range": {"query": {"chainage_m": "2870.1"}, "field": "chainage_m",
                     "message": "Chainage must be between 0 and 2870.0 metres."},
    "both_params": {"query": {"chainage_m": "634", "time": "2026-06-14T14:04:00Z"}, "field": "query",
                    "message": "Give exactly one of chainage_m or time."},
}


@pytest.mark.parametrize("case", list(FLIGHT_CASES), ids=list(FLIGHT_CASES))
def test_flight_position(app_url, case):
    spec = FLIGHT_CASES[case]
    r = flight(app_url, ASH, **spec["query"])
    if "field" in spec:
        assert api_error(r, 422, "validation_failed")["fields"][spec["field"]] == spec["message"]
        return
    expect_status(r, 200)
    body = r.json()
    assert body["covered"] is spec["covered"], body
    if not spec["covered"]:
        assert body["label"] == NO_COVERAGE and not body.get("position")
        return
    pos = body["position"]
    assert round(pos["height_m"], 1) == FLIGHT_HEIGHT_M
    towers = {t["number"]: t for t in staff_get(app_url, f"/api/corridors/{ASH}")["towers"]}
    a, b = spec["between"]
    assert towers[a]["lon_deg"] < pos["lon_deg"] < towers[b]["lon_deg"], pos
    assert re.fullmatch(r"\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z", body["time"]), body["time"]
    if "time" in spec:
        assert body["time"] == spec["time"]
        back = flight(app_url, ASH, time=body["time"]).json()
        assert back["covered"] and back["chainage_m"] == float(spec["query"]["chainage_m"])
    else:
        assert body["chainage_m"] == spec["chainage"]
        assert body["time"] == ms_time(spec["query"]["time"])


def test_coverage_and_gap_api(app_url):
    assert staff_get(app_url, f"/api/corridors/{ASH}")["coverage"] == [
        {"from_m": 0, "to_m": 1268}, {"from_m": 1904, "to_m": 2870}]
    assert staff_get(app_url, f"/api/corridors/{BIRCH}")["coverage"] == []
    for q in ({"chainage_m": "1500.0"}, {"time": "2026-06-14T14:12:00Z"}):
        body = flight(app_url, ASH, **q).json()
        assert body["covered"] is False and body["label"] == NO_COVERAGE and not body.get("position"), body
    assert flight(app_url, ASH, chainage_m="1500.0").json()["time"] is None
    for edge in ("1268", "1904"):
        assert flight(app_url, ASH, chainage_m=edge).json()["covered"] is True


def test_wf_flight_coverage_scrub(browser, app_url):
    start = "?" + urlencode({"ch": "0.0", "cam": CHASE_START_CAM})
    tower1_lon = staff_get(app_url, f"/api/corridors/{ASH}")["towers"][0]["lon_deg"]
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}{start}") as page:
        wait_ready(page)
        wait_until(page, lambda: ang(cam_line(page)[1], 0) <= CAM_DEG_TOL, message="start pose not applied")
        routes: list[Any] = []
        page.route("**/api/corridors/*/flight*", lambda route: routes.append(route))
        slider(page).focus()
        page.keyboard.press("PageDown")
        t312 = ASH_TOWERS_M[1]
        wait_until(page, lambda: any(f"chainage_m={ch1(t312)}" in r.request.url for r in routes))
        t = ro_text(page)
        assert f"Chainage {ch1(t312)} m" in t and span_label(2, 3) in t, t
        assert slider(page).get_attribute("aria-valuetext").startswith(f"Chainage {t312} metres, span 2 to 3")
        page.unroute("**/api/corridors/*/flight*")
        for r in routes:
            with suppress(PlaywrightError):
                r.continue_()
        answer = flight(app_url, ASH, chainage_m=ch1(t312)).json()
        wait_until(page, lambda: fmt_drone(answer["position"]) in ro_text(page)
                   and fmt_flight_time(answer["time"]) in ro_text(page))
        wait_until(page, lambda: url_params(page).get("ch") == ch1(t312) and url_params(page).get("t") == answer["time"])
        advance(page, CAM_REWRITE_MS * 2)
        wait_until(page, lambda: "cam" in url_params(page) and ang(cam_values(url_params(page)["cam"])[3], 90) <= CAM_DEG_TOL,
                   message="camera never eased to the chase pose")
        lon, lat, h, hd, p = cam_values(url_params(page)["cam"])
        pos = answer["position"]
        assert abs(h - (pos["height_m"] + CHASE_UP_M)) <= CAM_M_TOL, h
        assert abs(p + math.degrees(math.atan2(CHASE_UP_M, CHASE_BACK_M))) <= CAM_DEG_TOL, p
        d = math.dist(ecef(lon, lat, h), ecef(pos["lon_deg"], pos["lat_deg"], pos["height_m"]))
        assert abs(d - math.hypot(CHASE_BACK_M, CHASE_UP_M)) <= CHASE_DIST_TOL_M, d
        assert tower1_lon < lon < pos["lon_deg"], (tower1_lon, lon, pos)
        page.goto(f"{app_url}/corridors/{ASH}?ch=495.0")
        wait_ready(page)
        wait_until(page, lambda: has_text(option(page, "F-1"), "Near playhead"))
        assert slider(page).get_attribute("aria-valuetext").endswith("1 finding nearby")
        page.goto(f"{app_url}/corridors/{ASH}?ch=495.1")
        wait_ready(page)
        wait_until(page, lambda: slider(page).get_attribute("aria-valuetext").endswith("no findings nearby"))
        assert not has_text(option(page, "F-1"), "Near playhead")


def test_wf_flight_coverage_latest_wins(browser, app_url):
    q10, q20 = f"chainage_m={ch1(STEP_M)}", f"chainage_m={ch1(2 * STEP_M)}"
    exp10 = flight(app_url, ASH, chainage_m=ch1(STEP_M)).json()
    exp20 = flight(app_url, ASH, chainage_m=ch1(2 * STEP_M)).json()
    assert exp10["time"] != exp20["time"]
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}") as page:
        wait_ready(page)
        routes: list[Any] = []
        page.route("**/api/corridors/*/flight*", lambda route: routes.append(route))
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        wait_until(page, lambda: any(q20 in r.request.url for r in routes))
        t = ro_text(page)
        assert LOCATING in t and "Flight time" not in t, t
        latest = [r for r in routes if q20 in r.request.url][-1]
        earlier = [r for r in routes if r is not latest]
        latest.continue_()
        wait_until(page, lambda: fmt_drone(exp20["position"]) in ro_text(page))
        for r in earlier:
            with suppress(PlaywrightError):
                with page.expect_response(lambda resp: q10 in resp.url, timeout=UI_WAIT_S * 1000 // 6):
                    r.continue_()
        advance(page, CAM_REWRITE_MS)
        t = ro_text(page)
        assert fmt_drone(exp20["position"]) in t and fmt_flight_time(exp20["time"]) in t, t
        assert fmt_drone(exp10["position"]) not in t
        assert url_params(page).get("t") == exp20["time"]


def test_wf_flight_coverage_gap_hatch(browser, app_url):
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}") as page:
        wait_ready(page)
        ribbon = page.get_by_role("region", name="Span ribbon")
        labels = ribbon.get_by_text(NO_COVERAGE)
        wait_until(page, lambda: labels.count() == 1)
        lb = labels.first.bounding_box()
        x5 = ribbon.get_by_text(re.compile(rf"^\s*T{5}\s*$")).first.bounding_box()
        x7 = ribbon.get_by_text(re.compile(rf"^\s*T{7}\s*$")).first.bounding_box()
        cx = lb["x"] + lb["width"] / 2
        assert x5["x"] < cx < x7["x"] + x7["width"], (x5, lb, x7)
        slider(page).focus()
        for _ in range(5):
            page.keyboard.press("PageDown")
        for _ in range(9):
            page.keyboard.press("ArrowLeft")
        wait_until(page, lambda: valuenow(page) == GAP_PROBE_M)
        wait_until(page, lambda: f"Drone {NO_COVERAGE}" in ro_text(page))
        assert "Flight time" not in ro_text(page)
        wait_until(page, lambda: url_params(page).get("ch") == ch1(GAP_PROBE_M))
        assert "t" not in url_params(page)
    assert flight(app_url, ASH, chainage_m=ch1(GAP_PROBE_M)).json()["covered"] is False


MANIFEST_CASES = {
    "bad_kind": {"field": "kind", "message": "Choose tileset, terrain or czml."},
    "no_files": {"field": "files", "message": "Declare between 1 and 2,000 files."},
    "too_many_files": {"field": "files", "message": "Declare between 1 and 2,000 files."},
    "tileset_without_tileset_json": {"field": "files", "message": "A tileset must include tileset.json."},
    "terrain_without_layer_json": {"field": "files", "message": "A terrain pyramid must include layer.json."},
    "two_czml_files": {"field": "files", "message": "A flight track is exactly one .czml file."},
    "duplicate_path": {"field": "files", "message": "Each path may appear once."},
    "parent_segment_path": {"field": "files.1.path",
                            "message": "Use a relative path of letters, digits, dot, dash and underscore segments."},
    "zero_size": {"field": "files.0.size_bytes", "message": "Each file must be between 1 and 50,000,000 bytes."},
    "oversize": {"field": "files.0.size_bytes", "message": "Each file must be between 1 and 50,000,000 bytes."},
    "uppercase_sha": {"field": "files.0.sha256", "message": "Give the SHA-256 as 64 lowercase hex characters."},
    "analyst_forbidden": {"status": 403, "code": "forbidden"},
    "valid_terrain": {"status": 201},
}


def manifest_case(case: str, nonce: str) -> tuple[str, dict[str, Any]]:
    def entry(path: str, size: int = 1, digest: str | None = None) -> dict[str, Any]:
        return {"path": path, "size_bytes": size, "sha256": digest or sha(path.encode())}
    tj, n = entry("tileset.json"), entry(f"{nonce}.glb")
    files = {
        "bad_kind": ("mesh", [tj, n]),
        "no_files": ("tileset", []),
        "too_many_files": ("terrain", [entry("layer.json")] + [entry(f"{nonce}/{i}.terrain") for i in range(2001)]),
        "tileset_without_tileset_json": ("tileset", [n]),
        "terrain_without_layer_json": ("terrain", [entry(f"{nonce}/0.terrain")]),
        "two_czml_files": ("czml", [entry(f"{nonce}-a.czml"), entry(f"{nonce}-b.czml")]),
        "duplicate_path": ("tileset", [tj, tj, n]),
        "parent_segment_path": ("tileset", [n, entry("../tileset.json")]),
        "zero_size": ("tileset", [entry("tileset.json", 0), n]),
        "oversize": ("tileset", [entry("tileset.json", FILE_LIMIT + 1), n]),
        "uppercase_sha": ("tileset", [entry("tileset.json", 1, sha(b"x").upper()), n]),
        "analyst_forbidden": ("tileset", [tj, n]),
        "valid_terrain": ("terrain", [entry("layer.json"), entry(f"{nonce}/0/0/0.terrain")]),
    }[case]
    return files[0], {"kind": files[0], "files": files[1]}


@pytest.mark.parametrize("case", list(MANIFEST_CASES), ids=list(MANIFEST_CASES))
def test_asset_manifest(app_url, case):
    nonce = secrets.token_hex(6)
    spec = MANIFEST_CASES[case]
    _, body = manifest_case(case, nonce)
    code = ANALYST if case == "analyst_forbidden" else PROCESSOR
    r = call(app_url, "POST", f"/api/corridors/{CUTBANK}/assets", code, body)
    if spec.get("status") == 201:
        expect_status(r, 201)
        a = r.json()["asset"]
        assert (a["kind"], a["state"], a["corridor_id"], a["stored_at"]) == ("terrain", "pending", CUTBANK, None)
        assert {f["path"] for f in a["files"]} == {f["path"] for f in body["files"]}
        assert all(f["state"] == "pending" for f in a["files"])
        return
    if spec.get("status") == 403:
        api_error(r, 403, "forbidden")
    else:
        assert api_error(r, 422, "validation_failed")["fields"][spec["field"]] == spec["message"]
    assert find_asset(app_url, CUTBANK, nonce) is None


def test_asset_storage_confirmation(app_url):
    s3 = S3()
    nonce = secrets.token_hex(6)
    tj, glb = tileset_json(nonce), os.urandom(PROBE_BLOB_BYTES)
    a = declare(app_url, CUTBANK, "tileset", {"tileset.json": tj, f"{nonce}.glb": glb}).json()["asset"]
    prefix = asset_prefix(CUTBANK, a["id"])
    r = put_file(app_url, a["id"], "tileset.json", tj)
    expect_status(r, 200)
    assert r.json()["file"]["state"] == "stored" and r.json()["asset"]["state"] == "pending"
    assert s3.get(prefix + "tileset.json") == tj
    err = api_error(put_file(app_url, a["id"], f"{nonce}.glb", bytes([glb[0] ^ 1]) + glb[1:]), 422, "checksum_mismatch")
    assert err["fields"] == {"sha256": "Bytes did not match the declared SHA-256."}
    got = staff_get(app_url, f"/api/assets/{a['id']}", PROCESSOR)["asset"]
    assert (got["state"], got["rejected_reason"], got["stored_at"]) == ("rejected", "checksum_mismatch", None)
    spin_until(lambda: s3.keys(prefix) == [], MAIL_WAIT_S, "objects left behind after rejection")
    api_error(put_file(app_url, a["id"], "tileset.json", tj), 409, "asset_rejected")
    b = declare(app_url, CUTBANK, "tileset", {"tileset.json": tj}).json()["asset"]
    err = api_error(put_file(app_url, b["id"], "tileset.json", tj[:-1]), 422, "checksum_mismatch")
    assert err["fields"] == {"size_bytes": "Bytes did not match the declared size."}
    spin_until(lambda: s3.keys(asset_prefix(CUTBANK, b["id"])) == [], MAIL_WAIT_S, "objects left after size mismatch")

    files = {"tileset.json": tj, **{f"{nonce}/{i}.glb": os.urandom(PROBE_BLOB_BYTES) for i in range(5)}}
    c = declare(app_url, CUTBANK, "tileset", files).json()["asset"]
    with app_copy() as other:
        jobs = [lambda base=(app_url if i % 2 else other), p=p, d=d: put_file(base, c["id"], p, d)
                for i, (p, d) in enumerate(files.items())]
        jobs.append(lambda: put_file(other, c["id"], "tileset.json", tj))
        results = together(jobs)
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    final = staff_get(app_url, f"/api/assets/{c['id']}", PROCESSOR)["asset"]
    assert final["state"] == "stored" and final["stored_at"]
    stamps = {r.json()["asset"]["stored_at"] for r in results if r.json()["asset"]["state"] == "stored"}
    assert stamps == {final["stored_at"]}
    cp = asset_prefix(CUTBANK, c["id"])
    assert sorted(s3.keys(cp)) == sorted(cp + p for p in files)
    assert all(s3.get(cp + p) == d for p, d in files.items())
    assert staff_get(app_url, f"/api/assets/{c['id']}", PROCESSOR)["asset"]["stored_at"] == final["stored_at"]


def test_file_reads_byte_for_byte(app_url):
    s3 = S3()
    nonce = secrets.token_hex(6)
    tj, glb = tileset_json(nonce), os.urandom(PROBE_BLOB_BYTES)
    asset = upload_asset(app_url, CUTBANK, "tileset", {"tileset.json": tj, f"tiles/{nonce}.glb": glb})
    base = f"/api/assets/{asset['id']}/files"
    r = call(app_url, "GET", f"{base}/tileset.json", PROCESSOR, headers={"Accept-Encoding": "gzip, br"})
    expect_status(r, 200)
    assert r.headers.get("content-encoding") in (None, "identity")
    assert r.content == tj == s3.get(asset_prefix(CUTBANK, asset["id"]) + "tileset.json")
    assert r.headers["etag"] == f'"{sha(tj)}"' and r.headers["accept-ranges"] == "bytes"
    assert int(r.headers["content-length"]) == len(tj) and r.headers["content-type"].startswith("application/json")
    g = call(app_url, "GET", f"{base}/tiles/{nonce}.glb", PROCESSOR)
    assert g.content == glb and g.headers["content-type"].startswith("model/gltf-binary")
    part = call(app_url, "GET", f"{base}/tiles/{nonce}.glb", PROCESSOR, headers={"Range": "bytes=5-20"})
    expect_status(part, 206)
    assert part.content == glb[5:21] and part.headers["content-range"] == f"bytes 5-20/{len(glb)}"
    d = call(app_url, "GET", f"{base}/tiles/{nonce}.glb?download=1", PROCESSOR)
    assert d.headers["content-disposition"] == f'attachment; filename="{nonce}.glb"' and d.content == glb
    api_error(call(app_url, "GET", f"{base}/tiles/{nonce}.glb", PROCESSOR,
                   headers={"Range": f"bytes={len(glb)}-{len(glb) + 10}"}), 416, "range_not_satisfiable")
    pend = declare(app_url, CUTBANK, "terrain", {"layer.json": tj}).json()["asset"]
    api_error(call(app_url, "GET", f"/api/assets/{pend['id']}/files/layer.json", PROCESSOR), 404, "not_found")


def upload_through_dialog(page: Page, kind: str, files: dict[str, bytes]) -> Any:
    click(page.get_by_role("tab", name="Assets"))
    click(page.get_by_role("button", name="Upload assets"))
    dlg = page.get_by_role("dialog", name="Upload survey assets")
    wait_until(page, lambda: dlg.is_visible())
    check(dlg.get_by_role("radio", name=kind))
    dlg.get_by_label("Files").set_input_files(
        [{"name": p, "mimeType": "application/octet-stream", "buffer": b} for p, b in files.items()])
    return dlg


def test_wf_asset_intake_upload(browser, app_url):
    nonce = secrets.token_hex(6)
    files = {"tileset.json": tileset_json(nonce), f"{nonce}.glb": os.urandom(PROBE_BLOB_BYTES),
             f"{nonce}.ktx2": os.urandom(PROBE_BLOB_BYTES)}
    pending_row, stored_row = f"Tileset · {len(files)} files · Pending", f"Tileset · {len(files)} files · Stored"
    with staff_page(browser, app_url, PROCESSOR, f"/corridors/{CUTBANK}") as page:
        wait_ready(page)
        click(page.get_by_role("tab", name="Assets"))
        region = page.get_by_role("region", name="Survey assets")
        wait_until(page, lambda: region.is_visible())
        p0, s0 = norm(region.inner_text()).count(pending_row), norm(region.inner_text()).count(stored_row)
        dlg = upload_through_dialog(page, "Tileset", files)
        with held(page, "**/api/assets/*/files/**") as hold:
            click(dlg.get_by_role("button", name="Upload", exact=True))
            wait_until(page, lambda: norm(region.inner_text()).count(pending_row) > p0)
            assert re.search(f"Uploading [0-{len(files)}] of {len(files)} files for Tileset",
                             norm(status(page, "Upload status").text_content()))
            assert norm(region.inner_text()).count(stored_row) == s0
            hold.release()
        wait_text(page, status(page, "Upload status"), f"Tileset stored: {len(files)} files verified.")
        wait_until(page, lambda: norm(region.inner_text()).count(stored_row) == s0 + 1)
    asset = find_asset(app_url, CUTBANK, nonce)
    assert asset and asset["state"] == "stored"
    assert all(S3().get(asset_prefix(CUTBANK, asset["id"]) + p) == b for p, b in files.items())


def test_wf_asset_intake_mismatch(browser, app_url):
    nonce = secrets.token_hex(6)
    files = {"tileset.json": tileset_json(nonce), f"{nonce}.glb": os.urandom(PROBE_BLOB_BYTES)}
    with staff_page(browser, app_url, PROCESSOR, f"/corridors/{CUTBANK}") as page:
        wait_ready(page)

        def tamper(route: Any) -> None:
            body = route.request.post_data_buffer
            if route.request.method == "PUT" and route.request.url.endswith(f"{nonce}.glb") and body:
                route.continue_(post_data=bytes([body[0] ^ 1]) + body[1:])
            else:
                route.continue_()

        page.route("**/api/assets/*/files/**", tamper)
        dlg = upload_through_dialog(page, "Tileset", files)
        click(dlg.get_by_role("button", name="Upload", exact=True))
        wait_text(page, status(page, "Upload status"), f"Tileset rejected: {nonce}.glb did not match its checksum.")
        wait_text(page, page.get_by_role("region", name="Survey assets"), f"Tileset · {len(files)} files · Rejected")
    asset = find_asset(app_url, CUTBANK, nonce)
    assert asset and asset["state"] == "rejected" and asset["rejected_reason"] == "checksum_mismatch"
    spin_until(lambda: S3().keys(asset_prefix(CUTBANK, asset["id"])) == [], MAIL_WAIT_S, "objects left behind")


def test_finding_geometry_and_clearance(app_url):
    s = fresh_draft(app_url)
    data = staff_get(app_url, f"/api/corridors/{BIRCH}")
    towers = {t["number"]: t for t in data["towers"]}
    threshold = data["corridor"]["clearance_threshold_m"]
    viol = add_finding(app_url, s["id"], canopy=VIOLATING_CANOPY_M, level=None)
    right = add_finding(app_url, s["id"], offset=PROBE_OFFSET_M)
    left = add_finding(app_url, s["id"], offset=-PROBE_OFFSET_M)
    for f in (viol, right, left):
        assert f["span"] == {"from_tower": 2, "to_tower": 3, "label": "Span 2–3"}
        assert abs(f["canopy_top_height_m"] - (f["ground_height_m"] + f["canopy_height_m"])) < GEOM_TOL_M
        e = f["ecef_m"]
        assert any(abs(v * 1000 - round(v * 1000)) > 1e-6 for v in e), "ECEF looks rounded"
        assert min(math.dist(e, ecef(f["lon_deg"], f["lat_deg"], h))
                   for h in (f["ground_height_m"], f["canopy_top_height_m"])) < GEOM_TOL_M
        a, b = towers[2], towers[3]
        conductor = [ecef(t["lon_deg"], t["lat_deg"], t["base_height_m"] + t["attachment_height_m"]) for t in (a, b)]
        d = seg_dist(ecef(f["lon_deg"], f["lat_deg"], f["canopy_top_height_m"]), *conductor)
        assert abs(d - f["clearance_m"]) < GEOM_TOL_M, (d, f["clearance_m"])
        assert f["status"] == ("violation" if f["clearance_m"] < threshold else "clear")
    assert viol["status"] == "violation" and right["status"] == "clear"
    assert right["lon_deg"] > viol["lon_deg"] and right["lat_deg"] < viol["lat_deg"]
    assert left["lon_deg"] < viol["lon_deg"] and left["lat_deg"] > viol["lat_deg"]
    t1 = ecef(towers[1]["lon_deg"], towers[1]["lat_deg"], 0)
    assert abs(math.dist(t1, ecef(right["lon_deg"], right["lat_deg"], 0)) - math.hypot(PROBE_CH_M, PROBE_OFFSET_M)) < GEOM_TOL_M
    r = call(app_url, "POST", f"/api/findings-sets/{s['id']}/findings", ANALYST,
             {"lon_deg": right["lon_deg"], "lat_deg": right["lat_deg"], "ground_height_m": BIRCH_GROUND_M,
              "terrain_level": None, "canopy_height_m": CLEAR_CANOPY_M})
    expect_status(r, 201)
    g = r.json()["finding"]
    assert abs(g["chainage_m"] - PROBE_CH_M) < GEOM_TOL_M + 0.05 and abs(g["offset_m"] - PROBE_OFFSET_M) < GEOM_TOL_M + 0.05
    assert g["canopy_radius_m"] == 3.0 and g["comment"] == ""
    assert add_finding(app_url, s["id"], chainage=float(BIRCH_TOWERS_M[2]))["span"]["label"] == span_label(3, 4)
    assert add_finding(app_url, s["id"], chainage=float(BIRCH_LENGTH_M))["span"]["label"] == span_label(5, 6)


def test_finding_labels_concurrent(app_url):
    s = fresh_draft(app_url)
    assert add_finding(app_url, s["id"])["label"] == "F-1"
    results = together([lambda: call(app_url, "POST", f"/api/findings-sets/{s['id']}/findings", ANALYST, finding_body())
                        for _ in range(6)])
    assert all(r.status_code == 201 for r in results)
    assert sorted(r.json()["finding"]["label"] for r in results) == sorted(f"F-{n}" for n in range(2, 8))
    last = next(r.json()["finding"] for r in results if r.json()["finding"]["label"] == lbl(7))
    expect_status(call(app_url, "DELETE", f"/api/findings/{last['id']}", ANALYST), 204)
    assert add_finding(app_url, s["id"])["label"] == lbl(8)
    expect_status(call(app_url, "POST", f"/api/findings-sets/{s['id']}/findings", ANALYST, finding_body(canopy=0.1)), 422)
    assert add_finding(app_url, s["id"])["label"] == lbl(9)


def test_finding_validation_api(app_url):
    s = fresh_draft(app_url)
    f = add_finding(app_url, s["id"])
    base = finding_body()
    both = dict(base, lon_deg=-93.0, lat_deg=44.6)
    neither = {k: v for k, v in base.items() if k not in ("chainage_m", "offset_m")}
    bad = [(both, "position", MSG_POSITION), (neither, "position", MSG_POSITION),
           (dict(base, chainage_m=-1.0), "chainage_m", MSG_BIRCH_CHAINAGE),
           (dict(base, chainage_m=1085.1), "chainage_m", MSG_BIRCH_CHAINAGE),
           (dict(base, offset_m=60.5), "offset_m", MSG_OFFSET), (dict(base, offset_m=-61.0), "offset_m", MSG_OFFSET),
           (dict(base, ground_height_m=-501.0), "ground_height_m", MSG_GROUND),
           (dict(base, ground_height_m=9001.0), "ground_height_m", MSG_GROUND),
           (dict(base, terrain_level=25), "terrain_level", MSG_LEVEL), (dict(base, terrain_level=1.5), "terrain_level", MSG_LEVEL),
           (dict(base, canopy_height_m=0.4), "canopy_height_m", MSG_CANOPY),
           (dict(base, canopy_height_m=80.5), "canopy_height_m", MSG_CANOPY),
           (dict(base, canopy_radius_m=0.4), "canopy_radius_m", MSG_RADIUS),
           (dict(base, canopy_radius_m=20.1), "canopy_radius_m", MSG_RADIUS),
           (dict(base, comment="x" * (COMMENT_MAX + 1)), "comment", MSG_COMMENT)]
    for body, field, msg in bad:
        r = call(app_url, "POST", f"/api/findings-sets/{s['id']}/findings", ANALYST, body)
        assert api_error(r, 422, "validation_failed")["fields"][field] == msg, (body, r.text)
    for field, value, msg in (("canopy_height_m", 80.5, MSG_CANOPY), ("canopy_radius_m", 0.4, MSG_RADIUS),
                              ("comment", "x" * (COMMENT_MAX + 1), MSG_COMMENT)):
        r = call(app_url, "PATCH", f"/api/findings/{f['id']}", ANALYST, {field: value})
        assert api_error(r, 422, "validation_failed")["fields"][field] == msg
    after = staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"]
    assert [x["label"] for x in after] == ["F-1"] and after[0]["updated_at"] == f["updated_at"]
    ok = dict(base, offset_m=60.0, canopy_height_m=0.5, canopy_radius_m=20.0, terrain_level=24, comment="x" * COMMENT_MAX)
    expect_status(call(app_url, "POST", f"/api/findings-sets/{s['id']}/findings", ANALYST, ok), 201)


def test_wf_finding_editing_invalid(browser, app_url):
    s = fresh_draft(app_url)
    f = add_finding(app_url, s["id"])
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        click(option(page, "F-1"))
        click(page.get_by_role("button", name="Edit finding"))
        dlg = page.get_by_role("dialog", name=f"Edit finding {f['label']}")
        wait_until(page, lambda: dlg.is_visible())
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill("90")
        dlg.get_by_role("textbox", name="Canopy radius (m)").fill("25")
        click(dlg.get_by_role("button", name="Save finding"))
        wait_text(page, dlg, MSG_CANOPY)
        wait_text(page, dlg, MSG_RADIUS)
        assert staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"][0]["updated_at"] == f["updated_at"]
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill("12")
        dlg.get_by_role("textbox", name="Canopy radius (m)").fill("4")
        click(dlg.get_by_role("button", name="Save finding"))
        wait_text(page, status(page, "Save status"), f"Saved {f['label']}.")
    saved = staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"][0]
    assert (saved["canopy_height_m"], saved["canopy_radius_m"]) == (12, 4)


def test_keyboard_triage_dialogs(browser, app_url):
    s = fresh_draft(app_url)
    f1 = add_finding(app_url, s["id"])
    f2 = add_finding(app_url, s["id"], chainage=PROBE_CH2_M)
    a, b = f1["label"], f2["label"]
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 2)
        page.evaluate("document.activeElement && document.activeElement.blur()")
        page.keyboard.press("Tab")
        assert focused_name(page) == "Skip to span ribbon"
        tab_to(page, "Corridor chainage")
        page.keyboard.press("ArrowRight")
        wait_until(page, lambda: valuenow(page) == 10)
        for key, label in (("j", a), ("j", b), ("k", a), ("k", a), ("j", b), ("j", b)):
            page.keyboard.press(key)
            wait_until(page, lambda: selected(page, label), message=f"{key} -> {label}")
        assert focused_name(page) == "Corridor chainage"
        tab_to(page, "Copy view link", reverse=True)
        page.keyboard.press("k")
        wait_until(page, lambda: selected(page, a))
        page.keyboard.press("j")
        wait_until(page, lambda: selected(page, b))
        assert focused_name(page) == "Copy view link"
        page.keyboard.press("e")
        dlg = page.get_by_role("dialog", name=f"Edit finding {b}")
        wait_until(page, lambda: dlg.is_visible() and dlg.evaluate(INSIDE_JS))
        for key in ("Tab", "Shift+Tab"):
            for _ in range(TAB_SWEEP):
                page.keyboard.press(key)
                assert dlg.evaluate(INSIDE_JS), f"{key} left the dialog"
        page.keyboard.press("Escape")
        wait_until(page, lambda: dlg.count() == 0 and focused_name(page) == "Copy view link")
        page.keyboard.press("e")
        wait_until(page, lambda: dlg.is_visible())
        tab_to(page, "Canopy height above ground (m)")
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill("6.5")
        page.keyboard.press("Enter")
        wait_text(page, status(page, "Save status"), f"Saved {b}.")
        wait_until(page, lambda: dlg.count() == 0 and focused_name(page) == "Copy view link")
        tab_to(page, "Submit for review")
        page.keyboard.press("Enter")
        sub = page.get_by_role("dialog", name="Submit findings set")
        wait_until(page, lambda: sub.is_visible())
        page.keyboard.press("Escape")
        wait_until(page, lambda: sub.count() == 0 and focused_name(page) == "Submit for review")
        page.keyboard.press("Enter")
        wait_until(page, lambda: sub.is_visible())
        for _ in range(TAB_SWEEP):
            if focused_name(page) == "Confirm submit":
                break
            page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        wait_text(page, status(page, "Submit status"), f"Submitted revision {s['revision']}.")
    after = staff_get(app_url, f"/api/findings-sets/{s['id']}")
    assert after["set"]["state"] == "submitted"
    assert next(f for f in after["findings"] if f["id"] == f2["id"])["canopy_height_m"] == 6.5


def test_finding_save_feedback(browser, app_url):
    s = fresh_draft(app_url)
    first = add_finding(app_url, s["id"])["label"]
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        save = status(page, "Save status")
        click(option(page, first))
        click(page.get_by_role("button", name="Edit finding"))
        dlg = page.get_by_role("dialog", name=f"Edit finding {first}")
        wait_until(page, lambda: dlg.is_visible())
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill("12")
        with held(page, "**/api/findings/*") as hold:
            with page.expect_response(lambda r: r.request.method == "PATCH") as resp:
                click(dlg.get_by_role("button", name="Save finding"))
                wait_text(page, save, f"Saving {first}...")
                hold.release()
        f = resp.value.json()["finding"]
        wait_text(page, save, f"Saved {first}. Clearance {f['clearance_m']:.2f} m, {status_word(f['status'])}.")
        click(page.get_by_role("button", name="Edit finding"))
        wait_until(page, lambda: dlg.is_visible())
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill("0.1")
        click(dlg.get_by_role("button", name="Save finding"))
        wait_text(page, save, f"Could not save {first}. Check the highlighted fields.")
        assert has_text(dlg, "Fix these fields")
        click(dlg.get_by_role("link", name=MSG_CANOPY))
        wait_until(page, lambda: focused_name(page) == "Canopy height above ground (m)")
        page.keyboard.press("Escape")
        click(page.get_by_role("button", name="New finding at playhead"))
        new = page.get_by_role("dialog", name="New finding")
        wait_until(page, lambda: new.is_visible())
        new.get_by_role("textbox", name="Ground height (m)").fill("300")
        new.get_by_role("textbox", name="Canopy height above ground (m)").fill("6")
        with held(page, "**/api/findings-sets/*/findings") as hold:
            with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/findings")) as resp:
                click(new.get_by_role("button", name="Save finding"))
                wait_text(page, save, f"Saving {NEW_LABEL}...")
                hold.release()
        g = resp.value.json()["finding"]
        wait_text(page, save, f"Saved {g['label']}. Clearance {g['clearance_m']:.2f} m, {status_word(g['status'])}.")


def test_terrain_refinement_concurrent(app_url):
    s = fresh_draft(app_url)
    f = add_finding(app_url, s["id"], level=None)
    levels = [3, 7, 12, 9, 15, 5, 12]
    ground = {lv: BIRCH_GROUND_M + lv / 10 for lv in levels}
    rs = together([lambda lv=lv: call(app_url, "POST", f"/api/findings/{f['id']}/terrain", ANALYST,
                                      {"ground_height_m": ground[lv], "terrain_level": lv}) for lv in levels])
    oks = []
    for lv, r in zip(levels, rs):
        if r.status_code == 409:
            api_error(r, 409, "coarser_terrain")
        else:
            expect_status(r, 200)
            oks.append((lv, r.json()))
    accepted = sorted(lv for lv, _ in oks)
    assert accepted[-1] == FINEST_LEVEL and len(accepted) == len(set(accepted))
    prev_levels = [None] + accepted[:-1]
    for (lv, body), want in zip(sorted(oks, key=lambda e: e[0]), prev_levels):
        assert body["previous"]["terrain_level"] == want
        assert body["previous"]["ground_height_m"] == (f["ground_height_m"] if want is None else ground[want])
        assert body["finding"]["terrain_level"] == lv and body["finding"]["ground_height_m"] == ground[lv]
    final = next(x for x in staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"] if x["id"] == f["id"])
    assert final["terrain_level"] == FINEST_LEVEL and final["ground_height_m"] == ground[FINEST_LEVEL]
    for lv in (FINEST_LEVEL, FINEST_LEVEL - 1):
        api_error(call(app_url, "POST", f"/api/findings/{f['id']}/terrain", ANALYST,
                       {"ground_height_m": BIRCH_GROUND_M, "terrain_level": lv}), 409, "coarser_terrain")
    again = next(x for x in staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"] if x["id"] == f["id"])
    assert again["updated_at"] == final["updated_at"]


def test_wf_finding_editing_terrain(browser, app_url):
    s = fresh_draft(app_url)
    f = add_finding(app_url, s["id"], level=9, ground=290.0, canopy=10.0)
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        sent: list[int] = []
        page.on("request", lambda r: sent.append((r.post_data_json or {}).get("terrain_level"))
                if r.method == "POST" and r.url.endswith(f"/findings/{f['id']}/terrain") else None)
        wait_ready(page, 1)
        click(option(page, f["label"]))

        def refined() -> bool:
            x = staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"][0]
            return x["terrain_level"] == FINEST_LEVEL
        wait_until(page, refined, seconds=UI_WAIT_S, message="never refined to level 15")
        x = staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"][0]
        assert abs(x["ground_height_m"] - BIRCH_GROUND_M) <= LEVEL15_TOL_M
        wait_text(page, status(page, "Terrain updates"),
                  f"Ground height for {f['label']} re-resolved to {x['ground_height_m']:.2f} m at terrain level "
                  f"{FINEST_LEVEL}. Clearance now {x['clearance_m']:.2f} m, {status_word(x['status'])}.")
        assert sent == sorted(set(sent)) and all(lv > 9 for lv in sent), sent


def test_wf_finding_editing_triage(browser, app_url):
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        rail = page.get_by_role("complementary", name="Findings rail")
        wait_text(page, rail, "1 finding · 0 violations")
        a, b = lbl(1), lbl(2)
        slider(page).focus()
        page.keyboard.press("j")
        wait_until(page, lambda: selected(page, a) and valuenow(page) == PROBE_CH_M)
        click(page.get_by_role("button", name="Edit finding"))
        dlg = page.get_by_role("dialog", name=f"Edit finding {a}")
        wait_until(page, lambda: dlg.is_visible())
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill("17")
        click(dlg.get_by_role("button", name="Save finding"))
        wait_text(page, status(page, "Save status"), f"Saved {a}.")
        slider(page).focus()
        page.keyboard.press("n")
        new = page.get_by_role("dialog", name="New finding")
        wait_until(page, lambda: new.is_visible())
        assert f"{ch1(PROBE_CH_M)} m" in norm(new.text_content())
        new.get_by_role("textbox", name="Ground height (m)").fill("300")
        new.get_by_role("textbox", name="Canopy height above ground (m)").fill("17")
        click(new.get_by_role("button", name="Save finding"))
        wait_text(page, status(page, "Save status"), f"Saved {b}.")
        wait_text(page, rail, f"{plural(2, 'finding')} · {plural(2, 'violation')}")
    fs = staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"]
    assert sorted(f["label"] for f in fs) == [a, b] and all(f["status"] == "violation" for f in fs)
    assert next(f for f in fs if f["label"] == b)["chainage_m"] == PROBE_CH_M


def test_submit_freezes(app_url):
    s = fresh_draft(app_url)
    f1 = add_finding(app_url, s["id"], canopy=VIOLATING_CANOPY_M)
    add_finding(app_url, s["id"])
    staff = staff_get(app_url, "/api/session")["staff"]
    res = call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}).json()
    st, link = res["set"], res["review_link"]
    assert st["state"] == "submitted" and st["frozen"] == {"finding_count": 2, "violation_count": 1}
    assert st["submitted_by"] == staff["id"] and st["submitted_at"] and res["email"] in ("sent", "queued")
    assert link["status"] == "live" and re.fullmatch(f"[A-Za-z0-9_-]{{{TOKEN_MIN_CHARS},}}", token_of(link))
    ttl = (parse_iso(link["expires_at"]) - parse_iso(st["submitted_at"])).total_seconds()
    assert abs(ttl - TTL_DEFAULT_S) <= SERVER_CLOCK_SLACK_S
    for method, path, body in (("PATCH", f"/api/findings/{f1['id']}", {"canopy_height_m": 3.0}),
                               ("DELETE", f"/api/findings/{f1['id']}", None),
                               ("POST", f"/api/findings/{f1['id']}/terrain", {"ground_height_m": 300.0, "terrain_level": 20}),
                               ("POST", f"/api/findings-sets/{s['id']}/findings", finding_body())):
        api_error(call(app_url, method, path, ANALYST, body), 409, "set_not_draft")
    err = api_error(call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}), 409, "illegal_transition")
    assert (err["from"], err["action"], err["message"]) == (
        "submitted", "submit", f"Cannot {'submit'} a {'submitted'} findings set.")
    after = staff_get(app_url, f"/api/findings-sets/{s['id']}")
    assert after["set"]["frozen"] == st["frozen"] and len(after["findings"]) == 2
    assert next(f for f in after["findings"] if f["id"] == f1["id"])["canopy_height_m"] == VIOLATING_CANOPY_M


def test_submit_idempotency(app_url, mail):
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    key = secrets.token_urlsafe(16)
    path = f"/api/findings-sets/{s['id']}/submit"
    r1 = call(app_url, "POST", path, ANALYST, content=b"{}", key=key, headers={"Content-Type": "application/json"})
    expect_status(r1, 200)
    r2 = call(app_url, "POST", path, ANALYST, content=b"{ }", key=key, headers={"Content-Type": "application/json"})
    assert (r2.status_code, r2.json()) == (200, r1.json())
    api_error(call(app_url, "POST", path, ANALYST, {"note": "x"}, key=key), 409, "idempotency_conflict")
    token = token_of(r1.json()["review_link"])
    mails_containing(mail, token)
    assert len(settled_mails(mail, token)) == 1
    s2 = fresh_draft(app_url)
    add_finding(app_url, s2["id"])
    key2 = secrets.token_urlsafe(16)
    rs = together([lambda: call(app_url, "POST", f"/api/findings-sets/{s2['id']}/submit", ANALYST, {}, key=key2)
                   for _ in range(CONCURRENCY)])
    assert all(r.status_code == 200 for r in rs) and all(r.json() == rs[0].json() for r in rs)
    t2 = token_of(rs[0].json()["review_link"])
    mails_containing(mail, t2)
    assert len(settled_mails(mail, t2)) == 1


def test_concurrent_submits(app_url):
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    rs = together([lambda: call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {},
                                key=secrets.token_urlsafe(12)) for _ in range(CONCURRENCY)])
    assert sum(r.status_code == 200 for r in rs) == 1, [r.status_code for r in rs]
    for r in rs:
        if r.status_code != 200:
            api_error(r, 409, "illegal_transition")


def test_link_idempotency(app_url, mail):
    sid, token, _, _ = submitted_set(app_url)
    mails_containing(mail, token)
    key = secrets.token_urlsafe(16)
    a = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/resend", ANALYST, {}, key=key)
    b = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/resend", ANALYST, {}, key=key)
    assert a.status_code == 200 and (b.status_code, b.json()) == (200, a.json())
    mails_containing(mail, token, 2)
    assert len(settled_mails(mail, token)) == 2
    gk = secrets.token_urlsafe(16)
    g1 = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/regenerate", ANALYST, {}, key=gk)
    g2 = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/regenerate", ANALYST, {}, key=gk)
    assert g1.status_code == 201 and (g2.status_code, g2.json()) == (201, g1.json())
    new = token_of(g1.json()["review_link"])
    assert token_of(staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["review_link"]) == new
    mails_containing(mail, new)
    assert len(settled_mails(mail, new)) == 1
    api_error(call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/regenerate", ANALYST, {"x": 1}, key=gk),
              409, "idempotency_conflict")


def test_review_email_on_submit(app_url, mail):
    s = fresh_draft(app_url, CUTBANK)
    subject = f"Spanwise review: {CUTBANK_NAME} revision {s['revision']}"
    before = {m.get("ID") for m in mail.messages(settle=MAIL_SETTLE_S) if m.get("Subject") == subject}
    r = call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {})
    assert api_error(r, 422, "validation_failed")["fields"]["findings"] == MSG_FINDINGS
    after = {m.get("ID") for m in mail.messages(settle=MAIL_SETTLE_S) if m.get("Subject") == subject}
    assert after <= before
    add_finding(app_url, s["id"], corridor=CUTBANK)
    res = call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}).json()
    link, token = res["review_link"], token_of(res["review_link"])
    spin_until(lambda: staff_get(app_url, f"/api/findings-sets/{s['id']}")["set"]["review_link"]["email_state"] == "sent",
               MAIL_WAIT_S, "email never reported sent")
    assert [m for m in mail.messages(settle=0) if token in text(m)], "sent before Mailpit accepted it"
    msgs = settled_mails(mail, token)
    assert len(msgs) == 1
    m = msgs[0]
    assert addresses(m["To"]) == [LEE] and MAIL_FROM_ADDRESS in addresses(m["From"]) and m["Subject"] == subject
    body = text(m)
    assert link["url"] in [line.strip() for line in body.splitlines()]
    assert any(v in body for v in expiry_variants(link["expires_at"], DENVER))
    assert f"{plural(1, 'finding')}, {plural(0, 'violation')}" in body


def test_link_resend_revoke_regenerate(app_url, mail):
    sid, token, _, res = submitted_set(app_url)
    link = res["review_link"]
    mails_containing(mail, token)
    r = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/resend", ANALYST, {})
    expect_status(r, 200)
    rl = r.json()["review_link"]
    assert (rl["url"], rl["expires_at"], rl["status"]) == (link["url"], link["expires_at"], "live")
    mails_containing(mail, token, 2)
    assert len(settled_mails(mail, token)) == 2
    rv = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/revoke", ANALYST, {})
    assert rv.status_code == 200 and rv.json()["review_link"]["status"] == "revoked"
    api_error(call(app_url, "GET", f"/api/review/{token}"), 410, "link_revoked")
    api_error(call(app_url, "GET", f"/api/review/{token}/flight?chainage_m=10.0"), 410, "link_revoked")
    api_error(call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/resend", ANALYST, {}), 409, "link_not_live")
    api_error(call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/revoke", ANALYST, {}), 409, "link_not_live")
    g = call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/regenerate", ANALYST, {})
    expect_status(g, 201)
    t2 = token_of(g.json()["review_link"])
    assert t2 != token
    server_now = datetime.strptime(g.headers["date"], "%a, %d %b %Y %H:%M:%S GMT").replace(tzinfo=timezone.utc)
    ttl = (parse_iso(g.json()["review_link"]["expires_at"]) - server_now).total_seconds()
    assert abs(ttl - TTL_DEFAULT_S) <= SERVER_CLOCK_SLACK_S
    expect_status(call(app_url, "GET", f"/api/review/{t2}"), 200)
    api_error(call(app_url, "GET", f"/api/review/{token}"), 410, "link_revoked")
    mails_containing(mail, t2)
    assert len(settled_mails(mail, t2)) == 1
    t3 = token_of(call(app_url, "POST", f"/api/findings-sets/{sid}/review-link/regenerate", ANALYST, {}).json()["review_link"])
    api_error(call(app_url, "GET", f"/api/review/{t2}"), 410, "link_revoked")
    assert token_of(staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["review_link"]) == t3


def test_wf_submit_and_mail_double_confirm(browser, app_url, mail):
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"], canopy=VIOLATING_CANOPY_M)
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        click(page.get_by_role("button", name="Submit for review"))
        dlg = page.get_by_role("dialog", name="Submit findings set")
        wait_until(page, lambda: dlg.is_visible())
        assert f"1 finding, 1 violation will be frozen and sent to {DANA}." in norm(dlg.text_content())
        gate = Gate(page, "**/api/findings-sets/*/submit", abort_first=True)
        btn = dlg.get_by_role("button", name=re.compile(f"^({re.escape(CONFIRM)}|{re.escape(SUBMITTING)})$"))
        click(btn)
        wait_until(page, lambda: len(gate.requests) == 1 and btn.get_attribute("aria-disabled") != "true")
        click(btn)
        wait_until(page, lambda: len(gate.held) == 1)
        assert btn.get_attribute("aria-disabled") == "true" and "Submitting..." in norm(btn.text_content())
        wait_text(page, status(page, "Submit status"), f"Submitting revision {s['revision']}...")
        press_again(page, btn)
        advance(page, STEP_MS)
        gate.release()
        wait_text(page, status(page, "Submit status"), f"Submitted revision 1. Review link emailed to {DANA}.")
        keys = [r.headers.get("idempotency-key") for r in gate.requests]
        assert len(keys) == 2 and keys[0] and keys[0] == keys[1], keys
        assert "already submitted" not in norm(status(page, "Submit status").text_content())
    st = staff_get(app_url, f"/api/findings-sets/{s['id']}")["set"]
    assert st["state"] == "submitted"
    token = token_of(st["review_link"])
    mails_containing(mail, token)
    assert len(settled_mails(mail, token)) == 1


def test_wf_submit_and_mail_link_buttons(browser, app_url, mail):
    sid, token, fs, _ = submitted_set(app_url)
    mails_containing(mail, token)
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        for name, glob, copy in (("Resend link", "**/review-link/resend", f"Review link resent to {DANA}."),
                                 ("New link", "**/review-link/regenerate",
                                  f"New review link sent to {DANA}. The previous link no longer works.")):
            gate = Gate(page, glob)
            btn = page.get_by_role("button", name=name, exact=True)
            click(btn)
            wait_until(page, lambda: len(gate.held) == 1)
            assert btn.get_attribute("aria-disabled") == "true"
            press_again(page, btn)
            advance(page, STEP_MS)
            gate.release()
            wait_text(page, status(page, "Link status"), copy)
            assert len(gate.requests) == 1, name
    mails_containing(mail, token, 2)
    assert len(settled_mails(mail, token)) == 2
    t2 = token_of(staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["review_link"])
    api_error(call(app_url, "GET", f"/api/review/{token}"), 410, "link_revoked")
    expect_status(decide(app_url, t2, fs[0]["id"], "accept"), 200)
    with review_page(browser, app_url, t2) as page:
        send = page.get_by_role("button", name="Send decisions")
        wait_until(page, lambda: send.is_visible())
        gate = Gate(page, "**/api/review/*/complete")
        click(send)
        wait_until(page, lambda: len(gate.held) == 1)
        assert send.get_attribute("aria-disabled") == "true"
        press_again(page, send)
        gate.release()
        wait_text(page, status(page, "Review status"), f"Decisions sent: {len(fs)} accepted, 0 disputed.")
        assert len(gate.requests) == 1
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        gate = Gate(page, "**/review-link/revoke")
        btn = page.get_by_role("button", name="Withdraw link", exact=True)
        click(btn)
        wait_until(page, lambda: len(gate.held) == 1)
        press_again(page, btn)
        gate.release()
        wait_text(page, status(page, "Link status"), "Review link withdrawn.")
        assert len(gate.requests) == 1
    assert staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["state"] == "accepted"


def test_wf_review_link_access_scope(browser, app_url):
    sid, token, fs, _ = submitted_set(app_url)
    r = call(app_url, "GET", f"/api/review/{token}")
    expect_status(r, 200)
    body = r.json()
    assert body["set"]["id"] == sid and body["set"]["review_link"] is None and body["corridor"]["id"] == BIRCH
    assert body["contractor"]["name"] == CONTRACTOR and body["read_only"] is False
    assert [f["id"] for f in body["findings"]] == [fs[0]["id"]]
    assert staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["state"] == "under_review"
    api_error(call(app_url, "GET", f"/api/review/{token}/assets/ast-ash-terrain/files/layer.json"), 404, "not_found")
    own = call(app_url, "GET", f"/api/review/{token}/assets/ast-birch-terrain/files/layer.json")
    expect_status(own, 200)
    assert own.content == S3().get(asset_prefix(BIRCH, "ast-birch-terrain") + "layer.json")
    ash_f1 = staff_get(app_url, f"/api/findings-sets/{ash_set_id(app_url)}")["findings"][0]["id"]
    api_error(decide(app_url, token, ash_f1, "accept"), 404, "not_found")
    with review_page(browser, app_url, token) as page:
        wait_until(page, lambda: page.get_by_role("heading", name=f"{BIRCH_NAME}, revision 1", level=1).is_visible())
        assert page.get_by_role("button", name=f"Accept {fs[0]['label']}", exact=True).is_visible()
    expect_status(decide(app_url, token, fs[0]["id"], "accept"), 200)
    expect_status(call(app_url, "POST", f"/api/review/{token}/complete", body={}), 200)
    assert call(app_url, "GET", f"/api/review/{token}").json()["read_only"] is True
    api_error(decide(app_url, token, fs[0]["id"], "dispute", "late"), 409, "review_closed")
    api_error(call(app_url, "POST", f"/api/review/{token}/complete", body={}), 409, "review_closed")
    assert staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["decisions"][fs[0]["id"]]["decision"] == "accept"
    with review_page(browser, app_url, token) as page:
        wait_text(page, page.get_by_role("complementary", name="Findings rail"), FINAL_COPY)
        assert page.get_by_role("button", name=f"Accept {fs[0]['label']}", exact=True).count() == 0
    junk = secrets.token_urlsafe(32)
    api_error(call(app_url, "GET", f"/api/review/{junk}"), 404, "link_not_found")
    with review_page(browser, app_url, junk) as page:
        wait_until(page, lambda: UNKNOWN_COPY.lower() in body_text(page).lower())
        assert page.get_by_role("application", name="Corridor globe").count() == 0
        assert page.get_by_role("region", name="Span ribbon").count() == 0


def test_wf_review_link_access_expiry(browser, app_url):
    sid, token, efs, res = submitted_set(app_url)
    with review_page(browser, app_url, token) as page:
        page.clock.set_system_time(parse_iso(res["review_link"]["expires_at"]) + timedelta(days=1))
        page.goto(f"{app_url}/review/{token}")
        acc = page.get_by_role("button", name=f"Accept {efs[0]['label']}", exact=True)
        wait_until(page, lambda: acc.is_visible())
        assert any(v in body_text(page) for v in expiry_variants(res["review_link"]["expires_at"], CHICAGO))
        click(acc)
        wait_until(page, lambda: acc.get_attribute("aria-pressed") == "true")
    short = outage_url("APP_SHORT_TTL_URL")
    s = fresh_draft(short)
    f = add_finding(short, s["id"])
    sub = call(short, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}).json()
    t = token_of(sub["review_link"])
    expect_status(call(short, "GET", f"/api/review/{t}"), 200)
    spin_until(lambda: call(short, "GET", f"/api/review/{t}").status_code == 410, MAIL_WAIT_S, "link never expired")
    api_error(call(short, "GET", f"/api/review/{t}"), 410, "link_expired")
    api_error(call(short, "GET", f"/api/review/{t}/flight?chainage_m=10.0"), 410, "link_expired")
    api_error(decide(short, t, f["id"], "accept"), 410, "link_expired")
    api_error(call(short, "POST", f"/api/review/{t}/complete", body={}), 410, "link_expired")
    assert staff_get(short, f"/api/findings-sets/{s['id']}")["set"]["review_link"]["status"] == "expired"
    with review_page(browser, short, t) as page:
        page.clock.set_system_time(parse_iso(sub["set"]["submitted_at"]))
        page.goto(f"{short}/review/{t}")
        wait_until(page, lambda: EXPIRED_COPY.lower() in body_text(page).lower())
        assert page.get_by_role("application", name="Corridor globe").count() == 0


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_wf_review_link_access_breakpoints(browser, app_url, viewport):
    _, token, _, res = submitted_set(app_url)
    with review_page(browser, app_url, token, viewport=VIEWPORTS[viewport]) as page:
        heading = page.get_by_role("heading", name=f"{BIRCH_NAME}, revision 1", level=1)
        wait_until(page, lambda: heading.is_visible() and page.get_by_role("application", name="Corridor globe").is_visible())
        assert any(v in body_text(page) for v in expiry_variants(res["review_link"]["expires_at"], CHICAGO))
        check_layout(page, viewport, workspace=False)
        hb = heading.bounding_box()
        assert hb["y"] + hb["height"] <= page.get_by_role("application", name="Corridor globe").bounding_box()["y"] + PX_TOL
        if viewport == "phone":
            assert page.get_by_role("list", name="Findings for review").count() == 0
        else:
            assert page.get_by_role("list", name="Findings for review").get_by_role("listitem").count() == 1
    assert call(app_url, "GET", f"/api/review/{token}").status_code == 200


def test_forester_decisions_api(app_url, mail):
    sid, token, fs, _ = submitted_set(app_url, BIRCH, [{}, {"chainage": PROBE_CH2_M}])
    note = f"Leader trimmed already {secrets.token_hex(4)}"
    a, b = fs[0]["id"], fs[1]["id"]
    assert api_error(decide(app_url, token, a, "maybe"), 422, "validation_failed")["fields"]["decision"] == MSG_DECISION
    assert api_error(decide(app_url, token, a, "dispute", ""), 422, "validation_failed")["fields"]["note"] == MSG_NOTE
    assert api_error(decide(app_url, token, a, "dispute", "x" * (COMMENT_MAX + 1)), 422,
                     "validation_failed")["fields"]["note"] == MSG_COMMENT
    expect_status(decide(app_url, token, a, "dispute", "first"), 200)
    assert api_error(call(app_url, "POST", f"/api/review/{token}/complete", body={}), 422,
                     "validation_failed")["fields"]["decisions"] == MSG_DECISIONS
    r = decide(app_url, token, a, "accept")
    assert r.json()["decision"] == {"finding_id": a, "decision": "accept", "note": ""}
    expect_status(decide(app_url, token, b, "dispute", note), 200)
    rs = together([lambda: call(app_url, "POST", f"/api/review/{token}/complete", body={}) for _ in range(CONCURRENCY)])
    oks = [r for r in rs if r.status_code == 200]
    assert len(oks) == 1
    for r in rs:
        if r.status_code != 200:
            api_error(r, 409, "review_closed")
    assert oks[0].json()["summary"] == {"accepted": 1, "disputed": 1} and oks[0].json()["set"]["state"] == "disputed"
    st = staff_get(app_url, f"/api/findings-sets/{sid}")["set"]
    assert st["decisions"][a]["decision"] == "accept" and st["decisions"][b] == {"decision": "dispute", "note": note}
    mails_containing(mail, note)
    msgs = settled_mails(mail, note)
    assert len(msgs) == 1 and addresses(msgs[0]["To"]) == [ROSA]
    assert msgs[0]["Subject"] == f"Spanwise decision: {BIRCH_NAME} revision 1 disputed"
    lines = [line.strip() for line in text(msgs[0]).splitlines()]
    assert f"{fs[0]['label']} accepted" in lines and f"{fs[1]['label']} disputed: {note}" in lines


def test_wf_forester_decisions_view_link(browser, app_url):
    towers = staff_get(app_url, f"/api/corridors/{CUTBANK}")["towers"]
    upload_asset(app_url, CUTBANK, "czml", {f"flight-{secrets.token_hex(4)}.czml": czml_bytes(towers, secrets.token_hex(4))})
    s = fresh_draft(app_url, CUTBANK)
    target = add_finding(app_url, s["id"], corridor=CUTBANK, chainage=PROBE_CH_M)
    origin = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    view_ch = 100.0
    query = urlencode({"ch": ch1(view_ch), "t": VIEW_T, "f": target["id"], "cam": CUTBANK_VIEW_CAM})
    comment = f"See {origin}/corridors/{CUTBANK}?{query} and {FOREIGN_URL}"
    other = add_finding(app_url, s["id"], corridor=CUTBANK, chainage=PROBE_CH2_M, comment=comment)
    token = token_of(call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}).json()["review_link"])
    with review_page(browser, app_url, token) as page:
        item = review_item(page, other["label"])
        link = item.get_by_role("link", name="Open this view")
        wait_until(page, lambda: link.count() == 1)
        assert FOREIGN_URL in norm(item.text_content())
        click(link)
        wait_until(page, lambda: urlparse(page.url).path == f"/review/{token}")
        p = url_params(page)
        assert p.get("f") == target["id"] and p.get("ch") == ch1(view_ch) and p.get("t") == VIEW_T, p
        wait_until(page, lambda: valuenow(page) == view_ch
                   and review_item(page, target["label"]).get_attribute("aria-current") == "true")
        wait_until(page, lambda: fmt_flight_time(VIEW_T) in ro_text(page))
        _, hd, pitch = cam_line(page)
        want = cam_values(CUTBANK_VIEW_CAM)
        assert ang(hd, want[3]) <= CAM_DEG_TOL and abs(pitch - want[4]) <= CAM_DEG_TOL
        advance(page, CAM_REWRITE_MS * 2)
        assert cam_close(url_params(page)["cam"], CUTBANK_VIEW_CAM)
        assert review_item(page, other["label"]).get_attribute("aria-current") != "true"


def test_wf_forester_decisions_phone_review(browser, app_url, mail):
    sid, token, fs, _ = submitted_set(app_url, BIRCH, [{}, {"chainage": PROBE_CH2_M}, {"chainage": 900.0}])
    note = f"Already cut {secrets.token_hex(4)}"
    url = next(line.strip() for line in text(mails_containing(mail, token)[0]).splitlines() if f"/review/{token}" in line)
    with review_page(browser, app_url, token, viewport=PHONE) as page:
        page.goto(app_url + urlparse(url).path)
        wait_until(page, lambda: page.get_by_role("heading", name=f"{BIRCH_NAME}, revision 1", level=1).is_visible())
        toggle = page.get_by_role("button", name="Show findings", exact=True)
        assert toggle.get_attribute("aria-expanded") == "false"
        click(page.get_by_role("button", name="Next span"))
        wait_until(page, lambda: valuenow(page) == BIRCH_TOWERS_M[1])
        click(toggle)
        rs = status(page, "Review status")
        for label in [f["label"] for f in fs[:2]]:
            btn = page.get_by_role("button", name=f"Accept {label}", exact=True)
            click(btn)
            wait_until(page, lambda: btn.get_attribute("aria-pressed") == "true")
            wait_text(page, rs, f"{label} marked accepted.")
        third = fs[2]["label"]
        click(page.get_by_role("button", name=f"Dispute {third}", exact=True))
        box = page.get_by_role("textbox", name=f"Dispute note for {third}")
        wait_until(page, lambda: focused_name(page) == f"Dispute note for {third}")
        box.fill(note)
        page.keyboard.press("Tab")
        wait_text(page, rs, f"{third} marked disputed.")
        click(page.get_by_role("button", name="Send decisions"))
        wait_text(page, rs, f"Decisions sent: {2} accepted, {1} disputed.")
        wait_until(page, lambda: FINAL_COPY.lower() in body_text(page).lower())
    assert staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["state"] == "disputed"
    assert mails_containing(mail, note)


def test_wf_forester_decisions_failed_save(browser, app_url):
    sid, token, fs, _ = submitted_set(app_url, BIRCH, [{}, {"chainage": PROBE_CH2_M}])
    note = "Crew trimmed in May"
    a, b = fs[0]["label"], fs[1]["label"]
    with review_page(browser, app_url, token) as page:
        rs = status(page, "Review status")
        acc1 = page.get_by_role("button", name=f"Accept {a}", exact=True)
        dis1 = page.get_by_role("button", name=f"Dispute {a}", exact=True)
        wait_until(page, lambda: acc1.is_visible())
        click(acc1)
        wait_text(page, rs, f"{a} marked accepted.")
        assert acc1.get_attribute("aria-pressed") == "true"
        glob = "**/api/review/*/findings/*/decision"
        page.route(glob, lambda route: route.abort())
        click(dis1)
        box = page.get_by_role("textbox", name=f"Dispute note for {a}")
        wait_until(page, lambda: focused_name(page) == f"Dispute note for {a}")
        box.fill(note)
        page.keyboard.press("Tab")
        wait_text(page, rs, f"Could not save the decision for {a}. Try again.")
        assert acc1.get_attribute("aria-pressed") == "true" and dis1.get_attribute("aria-pressed") != "true"
        assert box.input_value() == note
        page.unroute(glob)
        page.route(glob, lambda route: route.fulfill(status=503, content_type="application/json",
                                                     body=json.dumps({"error": {"code": "storage_unavailable", "message": STORAGE_MSG}})))
        acc2 = page.get_by_role("button", name=f"Accept {b}", exact=True)
        click(acc2)
        wait_text(page, rs, f"Could not save the decision for {b}. Try again.")
        assert acc2.get_attribute("aria-pressed") != "true"
        page.unroute(glob)
        click(acc2)
        wait_text(page, rs, f"{b} marked accepted.")
        click(dis1)
        wait_until(page, lambda: focused_name(page) == f"Dispute note for {a}")
        page.keyboard.press("Tab")
        wait_text(page, rs, f"{a} marked disputed.")
        assert dis1.get_attribute("aria-pressed") == "true" and acc1.get_attribute("aria-pressed") != "true"
        page.route("**/api/review/*/complete", lambda route: route.fulfill(status=500, body="{}"))
        click(page.get_by_role("button", name="Send decisions"))
        wait_text(page, rs, "Could not send the decisions. Try again.")
    st = staff_get(app_url, f"/api/findings-sets/{sid}")["set"]
    assert st["state"] == "under_review"
    assert st["decisions"][fs[0]["id"]] == {"decision": "dispute", "note": note}
    assert st["decisions"][fs[1]["id"]]["decision"] == "accept"


def test_review_link_problems_replace_page(browser, app_url):
    _, token, fs, _ = submitted_set(app_url)
    with review_page(browser, app_url, token) as page:
        acc = page.get_by_role("button", name=f"Accept {fs[0]['label']}", exact=True)
        wait_until(page, lambda: acc.is_visible())
        complete_all(app_url, token)
        click(acc)
        wait_until(page, lambda: FINAL_COPY.lower() in body_text(page).lower())
        assert acc.count() == 0 and page.get_by_role("button", name="Send decisions").count() == 0
        assert "Accepted" in norm(review_item(page, fs[0]["label"]).text_content())
    sid2, t2, fs2, _ = submitted_set(app_url)
    with review_page(browser, app_url, t2) as page:
        acc = page.get_by_role("button", name=f"Accept {fs2[0]['label']}", exact=True)
        wait_until(page, lambda: acc.is_visible())
        expect_status(call(app_url, "POST", f"/api/findings-sets/{sid2}/review-link/revoke", ANALYST, {}), 200)
        click(acc)
        wait_until(page, lambda: WITHDRAWN_COPY.lower() in body_text(page).lower())
        for role, name in (("application", "Corridor globe"), ("region", "Span ribbon"), ("complementary", "Findings rail")):
            assert page.get_by_role(role, name=name).count() == 0
    assert staff_get(app_url, f"/api/findings-sets/{sid2}")["set"]["decisions"] == {}


def test_set_state_machine(app_url):
    def illegal(sid: str, action: str, route: str, state: str) -> None:
        err = api_error(call(app_url, "POST", f"/api/findings-sets/{sid}/{route}", ANALYST, {}), 409, "illegal_transition")
        assert (err["from"], err["action"], err["message"]) == (state, action, f"Cannot {action} a {state} findings set.")

    s = fresh_draft(app_url)
    sid = s["id"]
    f = add_finding(app_url, sid)
    for action, route in (("close", "close"), ("revise", "revisions"), ("regenerate", "review-link/regenerate")):
        illegal(sid, action, route, "draft")
    api_error(call(app_url, "POST", f"/api/corridors/{BIRCH}/findings-sets", ANALYST, {}), 409, "open_set_exists")
    token = token_of(call(app_url, "POST", f"/api/findings-sets/{sid}/submit", ANALYST, {}).json()["review_link"])
    illegal(sid, "submit", "submit", "submitted")
    illegal(sid, "close", "close", "submitted")
    expect_status(call(app_url, "GET", f"/api/review/{token}"), 200)
    illegal(sid, "close", "close", "under_review")
    illegal(sid, "revise", "revisions", "under_review")
    complete_all(app_url, token)
    illegal(sid, "revise", "revisions", "accepted")
    illegal(sid, "submit", "submit", "accepted")
    api_error(call(app_url, "POST", f"/api/corridors/{BIRCH}/findings-sets", ANALYST, {}), 409, "open_set_exists")
    expect_status(call(app_url, "POST", f"/api/findings-sets/{sid}/close", ANALYST, {}), 200)
    illegal(sid, "close", "close", "closed")
    illegal(sid, "regenerate", "review-link/regenerate", "closed")
    api_error(call(app_url, "PATCH", f"/api/findings/{f['id']}", ANALYST, {"comment": "x"}), 409, "set_not_draft")
    r = call(app_url, "POST", f"/api/corridors/{BIRCH}/findings-sets", ANALYST, {})
    expect_status(r, 201)
    assert r.json()["set"]["revision"] == 1 and r.json()["set"]["state"] == "draft"


def test_concurrent_revise(app_url):
    sid, _, fs = finished_set(app_url, ["accept", "dispute"], [{}, {"chainage": PROBE_CH2_M, "comment": "keep"}], note="no")
    rs = together([lambda: call(app_url, "POST", f"/api/findings-sets/{sid}/revisions", ANALYST, {}) for _ in range(CONCURRENCY)])
    oks = [r for r in rs if r.status_code == 201]
    assert len(oks) == 1
    for r in rs:
        if r.status_code != 201:
            api_error(r, 409, "illegal_transition")
    new = oks[0].json()["set"]
    assert (new["revision"], new["state"], new["previous_set_id"]) == (2, "draft", sid)
    assert staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["state"] == "closed"
    assert staff_get(app_url, f"/api/corridors/{BIRCH}")["corridor"]["current_set"]["id"] == new["id"]
    copied = staff_get(app_url, f"/api/findings-sets/{new['id']}")["findings"]
    pick = ("label", "chainage_m", "offset_m", "canopy_height_m", "canopy_radius_m", "comment")
    assert sorted(tuple(f[k] for k in pick) for f in copied) == sorted(tuple(f[k] for k in pick) for f in fs)
    assert add_finding(app_url, new["id"])["label"] == "F-3"


def test_wf_revision_cycle_start_revision(browser, app_url):
    sid, _, _ = finished_set(app_url, ["dispute"], [{}], note="wrong tree")
    rev = staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["revision"]
    with staff_page(browser, app_url, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page)
        wait_until(page, lambda: "Disputed" in body_text(page))
        click(page.get_by_role("button", name="Start revision"))
        wait_text(page, status(page, "Submit status"), f"Revision {rev + 1} started as a draft.")
    cur = staff_get(app_url, f"/api/corridors/{BIRCH}")["corridor"]["current_set"]
    new = staff_get(app_url, f"/api/findings-sets/{cur['id']}")["set"]
    assert (new["revision"], new["state"], new["previous_set_id"]) == (rev + 1, "draft", sid)


def test_evidence_pack(app_url):
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"], canopy=VIOLATING_CANOPY_M)
    add_finding(app_url, s["id"], chainage=PROBE_CH2_M)
    api_error(call(app_url, "GET", f"/api/findings-sets/{s['id']}/evidence", ANALYST), 404, "not_found")
    res = call(app_url, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}).json()
    key = f"tenants/kestrel/corridors/{BIRCH}/findings-sets/{s['id']}/evidence.json"
    stored = S3().get(key)
    r = call(app_url, "GET", f"/api/findings-sets/{s['id']}/evidence", ANALYST)
    expect_status(r, 200)
    assert r.headers["content-type"].startswith("application/json") and r.content == stored
    doc = json.loads(stored)
    assert set(doc) == {"set_id", "corridor_id", "revision", "submitted_at", "frozen", "findings", "assets"}
    assert (doc["set_id"], doc["corridor_id"], doc["revision"]) == (s["id"], BIRCH, 1)
    assert doc["submitted_at"] == res["set"]["submitted_at"] and doc["frozen"] == res["set"]["frozen"]
    api = {f["label"]: f for f in staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"]}
    for e in doc["findings"]:
        assert set(e) == {"label", "ecef_m", "lon_deg", "lat_deg", "ground_height_m", "terrain_level", "canopy_top_height_m",
                          "canopy_radius_m", "chainage_m", "span_label", "clearance_m", "status", "comment"}
        f = api[e["label"]]
        assert e["ecef_m"] == f["ecef_m"] and e["span_label"] == f["span"]["label"] and e["status"] == f["status"]
    assert len(doc["findings"]) == 2
    active = {v for v in staff_get(app_url, f"/api/corridors/{BIRCH}")["active_assets"].values() if v}
    assert {a["id"] for a in doc["assets"]} == active
    for a in doc["assets"]:
        files = staff_get(app_url, f"/api/assets/{a['id']}")["asset"]["files"]
        assert sorted((f["path"], f["size_bytes"], f["sha256"]) for f in a["files"]) == sorted(
            (f["path"], f["size_bytes"], f["sha256"]) for f in files)


def test_wf_revision_cycle_dispute_evidence(browser, app_url):
    nonce = secrets.token_hex(6)
    towers = staff_get(app_url, f"/api/corridors/{CUTBANK}")["towers"]
    czml, czml_name = czml_bytes(towers, nonce), f"flight-{nonce}.czml"
    tj, glb = tileset_json(nonce), os.urandom(PROBE_BLOB_BYTES)
    upload_asset(app_url, CUTBANK, "czml", {czml_name: czml})
    upload_asset(app_url, CUTBANK, "tileset", {"tileset.json": tj, f"{nonce}.glb": glb})
    _, token, fs, _ = submitted_set(app_url, CUTBANK)
    expect_status(decide(app_url, token, fs[0]["id"], "dispute", "span questioned"), 200)
    expect_status(call(app_url, "POST", f"/api/review/{token}/complete", body={}), 200)
    with staff_page(browser, app_url, PROCESSOR, f"/corridors/{CUTBANK}") as page:
        wait_ready(page)
        wait_until(page, lambda: "Disputed" in body_text(page))
        click(page.get_by_role("tab", name="Assets"))
        got = {}
        for name in (czml_name, f"{nonce}.glb"):
            link = reveal_download(page, f"Download {name}")
            with page.expect_download() as d:
                click(link)
            got[name] = Path(d.value.path()).read_bytes()
        tlink = page.get_by_role("link", name=f"Download {TILESET_JSON}", exact=True)
        assert tlink.count() == 1
        with page.expect_download() as d:
            click(tlink)
        got["tileset.json"] = Path(d.value.path()).read_bytes()
    assert got == {czml_name: czml, f"{nonce}.glb": glb, "tileset.json": tj}


def test_wf_storage_outage_edit(browser, app_url):
    down = outage_url("APP_MINIO_DOWN_URL")
    expect_status(call(down, "GET", "/api/health"), 200)
    assert call(down, "GET", "/api/status").json()["storage"] == "unreachable"
    assert flight(down, ASH, chainage_m="634").json()["time"] == "2026-06-14T14:04:00.000Z"
    assert staff_get(down, f"/api/corridors/{ASH}")["coverage"] == [{"from_m": 0, "to_m": 1268}, {"from_m": 1904, "to_m": 2870}]
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    with staff_page(browser, down, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        click(option(page, "F-1"))
        click(page.get_by_role("button", name="Edit finding"))
        dlg = page.get_by_role("dialog", name=f"Edit finding {lbl(1)}")
        wait_until(page, lambda: dlg.is_visible())
        dlg.get_by_role("textbox", name="Canopy height above ground (m)").fill(f"{EDIT_CANOPY_M:.2f}")
        click(dlg.get_by_role("button", name="Save finding"))
        wait_text(page, status(page, "Save status"), f"Saved {lbl(1)}.")
    assert staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"][0]["canopy_height_m"] == EDIT_CANOPY_M


def test_storage_recovers_without_restart(app_url):
    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    relay = Relay(endpoint.hostname or "127.0.0.1", endpoint.port or 80)
    try:
        with app_copy(S3_ENDPOINT=f"http://127.0.0.1:{relay.port}") as copy:
            spin_until(lambda: call(copy, "GET", "/api/status").json()["storage"] == "unreachable",
                       STORAGE_PROBE_S + POLL_SLACK_S, "status never reported storage unreachable")
            assert flight(copy, ASH, chainage_m="634").json()["covered"] is True
            path = "/api/assets/ast-ash-czml/files/ash-creek-2026-06-14.czml"
            api_error(call(copy, "GET", path, ANALYST), 503, "storage_unavailable")
            relay.up = True
            took = spin_until(lambda: call(copy, "GET", path, ANALYST).status_code == 200,
                              STORAGE_RESUME_S + STORAGE_PROBE_S + POLL_SLACK_S, "file reads never resumed")
            assert took <= STORAGE_RESUME_S + STORAGE_PROBE_S + POLL_SLACK_S
            body = call(copy, "GET", path, ANALYST).content
            assert body == S3().get(asset_prefix(ASH, "ast-ash-czml") + "ash-creek-2026-06-14.czml")
            spin_until(lambda: call(copy, "GET", "/api/status").json()["storage"] == "ok",
                       STORAGE_PROBE_S + POLL_SLACK_S, "status never reported ok")
    finally:
        relay.close()


def test_wf_storage_outage_banner(browser, app_url, mail):
    down = outage_url("APP_MINIO_DOWN_URL")
    with staff_page(browser, down, ANALYST, f"/corridors/{ASH}") as page:
        alert = page.get_by_role("alert").filter(has_text=BANNER)
        wait_until(page, lambda: alert.count() == 1)
        assert BANNER in norm(alert.text_content())
        wait_until(page, lambda: EMPTY_VIEWPORT in body_text(page))
    err = api_error(call(down, "GET", "/api/assets/ast-ash-terrain/files/layer.json", ANALYST), 503, "storage_unavailable")
    assert err["message"] == STORAGE_MSG
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    api_error(call(down, "POST", f"/api/findings-sets/{s['id']}/submit", ANALYST, {}), 503, "storage_unavailable")
    assert staff_get(app_url, f"/api/findings-sets/{s['id']}")["set"]["state"] == "draft"
    assert S3().keys(f"tenants/kestrel/corridors/{BIRCH}/findings-sets/{s['id']}/") == []


def test_wf_storage_outage_work_survives(browser, app_url):
    down = outage_url("APP_MINIO_DOWN_URL")
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])

    def checks(page: Page, n: int) -> None:
        for _ in range(n):
            with page.expect_response(lambda r: r.url.endswith("/api/status")):
                advance(page, STATUS_INTERVAL_MS)
            advance(page, STEP_MS)

    with staff_page(browser, down, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        alert = page.get_by_role("alert").filter(has_text=BANNER)
        wait_until(page, lambda: alert.count() == 1)
        handle = alert.element_handle()
        click(option(page, "F-1"))
        click(page.get_by_role("button", name="Edit finding"))
        dlg = page.get_by_role("dialog", name=f"Edit finding {lbl(1)}")
        wait_until(page, lambda: dlg.is_visible())
        field = dlg.get_by_role("textbox", name="Canopy height above ground (m)")
        typed = "12.34"
        field.fill(typed)
        field.focus()
        checks(page, 3)
        assert dlg.is_visible() and field.input_value() == typed
        assert focused_name(page) == "Canopy height above ground (m)"
        assert alert.count() == 1 and handle.evaluate("(e) => e.isConnected")
        page.keyboard.press("Escape")
        assets_tab = page.get_by_role("tab", name="Assets")
        click(assets_tab)
        files_btn = page.get_by_role("region", name="Survey assets").get_by_role("button", name="Files").first
        click(files_btn)
        wait_until(page, lambda: files_btn.get_attribute("aria-expanded") == "true")
        checks(page, 2)
        assert assets_tab.get_attribute("aria-selected") == "true" and files_btn.get_attribute("aria-expanded") == "true"
        assert handle.evaluate("(e) => e.isConnected")
    with staff_page(browser, down, ANALYST, f"/corridors/{BIRCH}", viewport=PHONE) as page:
        toggle = page.get_by_role("button", name="Show findings", exact=True)
        wait_until(page, lambda: toggle.is_visible())
        click(toggle)
        hide = page.get_by_role("button", name="Hide findings", exact=True)
        wait_until(page, lambda: hide.get_attribute("aria-expanded") == "true")
        checks(page, 2)
        assert hide.get_attribute("aria-expanded") == "true"
    assert staff_get(app_url, f"/api/findings-sets/{s['id']}")["findings"][0]["canopy_height_m"] == CLEAR_CANOPY_M


def test_wf_mail_outage_queued_submit(browser, app_url, mail):
    down = outage_url("APP_MAILPIT_DOWN_URL")
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    with app_copy():
        with staff_page(browser, down, ANALYST, f"/corridors/{BIRCH}") as page:
            wait_ready(page, 1)
            click(page.get_by_role("button", name="Submit for review"))
            dlg = page.get_by_role("dialog", name="Submit findings set")
            wait_until(page, lambda: dlg.is_visible())
            with page.expect_response(lambda r: r.url.endswith("/submit")) as resp:
                click(dlg.get_by_role("button", name="Confirm submit"))
            body = resp.value.json()
            assert resp.value.status == 200 and body["email"] == "queued"
            wait_text(page, status(page, "Submit status"),
                      f"Submitted revision 1. The email to {DANA} is queued and will send when mail is back.")
        token = token_of(body["review_link"])
        assert mails_containing(mail, token, 1, QUEUED_DELIVERY_S + POLL_SLACK_S), "queued email never delivered"
        assert len(settled_mails(mail, token)) == 1
    spin_until(lambda: staff_get(app_url, f"/api/findings-sets/{s['id']}")["set"]["review_link"]["email_state"] == "sent",
               POLL_SLACK_S, "email_state never became sent")
    assert len(settled_mails(mail, token)) == 1


def test_wf_mail_outage_link_line(browser, app_url, mail):
    down = outage_url("APP_MAILPIT_DOWN_URL")
    s = fresh_draft(app_url)
    add_finding(app_url, s["id"])
    with staff_page(browser, down, ANALYST, f"/corridors/{BIRCH}") as page:
        wait_ready(page, 1)
        click(page.get_by_role("button", name="Submit for review"))
        dlg = page.get_by_role("dialog", name="Submit findings set")
        wait_until(page, lambda: dlg.is_visible())
        with page.expect_response(lambda r: r.url.endswith("/submit")) as resp:
            click(dlg.get_by_role("button", name="Confirm submit"))
        link = resp.value.json()["review_link"]
        page.wait_for_function("(t) => document.body.innerText.includes(t)", arg="· Email queued", timeout=UI_WAIT_S * 1000)
        assert any(f"{v} · Email queued" in body_text(page) for v in expiry_variants(link["expires_at"], CHICAGO))
        slider(page).focus()
        page.evaluate(MARKER_JS)
        wait_until(page, lambda: "· Email sent" in body_text(page),
                   seconds=QUEUED_DELIVERY_S + POLL_SLACK_S + STATUS_INTERVAL_MS / 1000)
        assert page.evaluate("window.__spanwiseMarker") == 1
        assert focused_name(page) == "Corridor chainage" and "· Email queued" not in body_text(page)
    token = token_of(link)
    assert len(settled_mails(mail, token)) == 1


def test_wf_field_crew_touch(browser, app_url):
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}?ch=470.0", viewport=TABLET,
                    touch=True, reduced_motion="reduce") as page:
        wait_ready(page)
        advance(page, CAM_REWRITE_MS * 2)
        wait_until(page, lambda: "cam" in url_params(page) and bool(CAM_RE.search(ro_text(page))))
        g = page.get_by_role("application", name="Corridor globe").bounding_box()
        cx, cy = g["x"] + g["width"] / 2, g["y"] + g["height"] / 2
        cam0 = url_params(page)["cam"]
        touch_path(page, lambda fr: [(cx + 120 * fr, cy + 60 * fr)])
        wait_until(page, lambda: not cam_close(url_params(page)["cam"], cam0))
        h0 = cam_line(page)[0]
        touch_path(page, lambda fr: [(cx - 40 - 80 * fr, cy), (cx + 40 + 80 * fr, cy)])
        wait_until(page, lambda: cam_line(page)[0] < h0)
        hd0 = cam_line(page)[1]

        def twist(fr: float) -> list[tuple[float, float]]:
            a = math.radians(40 * fr)
            return [(cx - 80 * math.cos(a), cy - 80 * math.sin(a)), (cx + 80 * math.cos(a), cy + 80 * math.sin(a))]
        touch_path(page, twist)
        wait_until(page, lambda: ang(cam_line(page)[1], hd0) > CAM_DEG_TOL)
        p0 = cam_line(page)[2]
        touch_path(page, lambda fr: [(cx - 60, cy - 120 * fr), (cx + 60, cy - 120 * fr)])
        wait_until(page, lambda: abs(cam_line(page)[2] - p0) > CAM_DEG_TOL)


def test_wf_field_crew_reduced_motion(browser, app_url):
    _, token, fs = finished_set(app_url, ["accept", "accept"], [{"chainage": TIE_CH_M}, {"chainage": PROBE_CH2_M}])
    query = "?" + urlencode({"ch": "0.0", "cam": BIRCH_START_CAM})
    with review_page(browser, app_url, token, query=query, viewport=TABLET, reduced_motion="reduce") as page:
        wait_until(page, lambda: FINAL_COPY.lower() in body_text(page).lower() and bool(CAM_RE.search(ro_text(page))))
        c0 = cam_line(page)
        with page.expect_response(lambda r: "/flight" in r.url and f"chainage_m={ch1(BIRCH_TOWERS_M[1])}" in r.url):
            click(page.get_by_role("button", name="Next span"))
        assert valuenow(page) == BIRCH_TOWERS_M[1]
        assert not long_animations(animations(page.get_by_role("region", name="Span ribbon")))
        wait_applied(page)
        advance(page, FRAME_MS)
        c1 = cam_line(page)[1:]
        advance(page, FLY_MAX_MS)
        assert cam_line(page)[1:] == c1 != c0[1:]
        assert url_params(page).get("ch") == ch1(BIRCH_TOWERS_M[1])
        with page.expect_response(lambda r: "/flight" in r.url and f"chainage_m={ch1(TIE_CH_M)}" in r.url):
            click(page.get_by_role("button", name=f"Fly to {fs[0]['label']}", exact=True))
        wait_applied(page)
        advance(page, FRAME_MS)
        c2 = cam_line(page)[1:]
        advance(page, FLY_MAX_MS)
        assert cam_line(page)[1:] == c2
        assert f"Chainage {ch1(TIE_CH_M)} m" in ro_text(page) and span_label(2, 3) in ro_text(page)
        h0 = history_length(page)
        review_item(page, fs[1]["label"]).click(position={"x": 4, "y": 4})
        wait_text(page, status(page, "View status"),
                  f"Selected {fs[1]['label']}, {span_label(4, 5)}, chainage {ch1(PROBE_CH2_M)} m.")
        assert url_params(page).get("f") == fs[1]["id"] and history_length(page) == h0 + 1
    with review_page(browser, app_url, token, viewport=PHONE, reduced_motion="reduce") as page:
        toggle = page.get_by_role("button", name="Show findings", exact=True)
        wait_until(page, lambda: toggle.is_visible())
        click(toggle)
        path = motion(page.get_by_role("complementary", name="Findings rail"), SHEET_MAX_MS)
        moving, _ = moving_times(path, SHEET_MAX_MS)
        assert not [t for t in moving if t >= MIN_ANIM_MS], path


def test_wf_field_crew_span_finder(browser, app_url, mail):
    sid, token, fs = finished_set(app_url, ["accept", "accept"], [{"chainage": TIE_CH_M}, {"chainage": PROBE_CH2_M}])
    url = next(line.strip() for line in text(mails_containing(mail, token)[0]).splitlines() if f"/review/{token}" in line)
    with review_page(browser, app_url, token, viewport=TABLET) as page:
        page.goto(app_url + urlparse(url).path)
        wait_until(page, lambda: FINAL_COPY.lower() in body_text(page).lower())
        check_layout(page, "tablet", workspace=False)
        a, b = fs[0]["label"], fs[1]["label"]
        assert (f"{span_label(2, 3)} · nearest tower T2 · chainage {ch1(TIE_CH_M)} m"
                in norm(review_item(page, a).text_content()))
        t2 = norm(review_item(page, b).text_content())
        assert "Accepted" in t2 and f"{span_label(4, 5)} · nearest tower T4 · chainage {ch1(PROBE_CH2_M)} m" in t2
        c0 = cam_line(page)
        click(page.get_by_role("button", name=f"Fly to {b}", exact=True))
        wait_until(page, lambda: valuenow(page) == PROBE_CH2_M and span_label(4, 5) in ro_text(page))
        wait_until(page, lambda: cam_line(page) != c0)
        for name, want in (("Next span", 870), ("Next span", 1085), ("Previous span", 870), ("Previous span", 655)):
            click(page.get_by_role("button", name=name))
            wait_until(page, lambda: valuenow(page) == want, message=f"{name} -> {want}")
    assert call(app_url, "GET", f"/api/review/{token}").json()["read_only"] is True
    assert staff_get(app_url, f"/api/findings-sets/{sid}")["set"]["state"] == "accepted"


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_wf_cross_cutting_breakpoints(browser, app_url, viewport):
    cs = staff_get(app_url, "/api/corridors")["corridors"]
    with staff_page(browser, app_url, ANALYST, "/corridors", viewport=VIEWPORTS[viewport]) as page:
        wait_until(page, lambda: page.get_by_role("heading", name="Corridors", level=1).is_visible())
        layout(page)
        if viewport == "phone":
            lst = page.get_by_role("list", name="Corridors")
            wait_until(page, lambda: lst.is_visible())
            assert page.get_by_role("table", name="Corridors").count() == 0
            card = norm(lst.get_by_role("listitem").filter(has=page.get_by_role("link", name=ASH_NAME, exact=True)).text_content())
            idx = [card.index(x) for x in (ASH_NAME, "Northmere Power Cooperative", f"Inspection due {ASH_DUE}")]
            assert idx == sorted(idx), card
        else:
            table = page.get_by_role("table", name="Corridors")
            wait_until(page, lambda: table.is_visible())
            heads = [norm(h).lower() for h in table.get_by_role("columnheader").all_inner_texts()]
            assert heads == [c.lower() for c in CORRIDOR_COLUMNS], heads
        for c in cs:
            assert page.get_by_role("link", name=c["name"], exact=True).count() == 1
        page.goto(f"{app_url}/corridors/{ASH}")
        wait_ready(page)
        check_layout(page, viewport, workspace=True)


def test_motion_timing(browser, app_url):
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}") as page:
        wait_ready(page)
        slider(page).focus()
        watch_entry(page)
        page.keyboard.press("n")
        dlg = page.get_by_role("dialog", name="New finding")
        wait_until(page, lambda: dlg.count() == 1)
        assert_entry_window(dlg)
        page.keyboard.press("Escape")
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}", viewport=PHONE) as page:
        toggle = page.get_by_role("button", name="Show findings", exact=True)
        wait_until(page, lambda: toggle.is_visible())
        watch_entry(page)
        click(toggle)
        assert_entry_window(page.get_by_role("complementary", name="Findings rail"))
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}?" + urlencode({"ch": "0.0", "cam": CHASE_START_CAM})) as page:
        wait_ready(page)
        wait_until(page, lambda: ang(cam_line(page)[1], 0) <= CAM_DEG_TOL)
        slider(page).focus()
        act_until_response(page, lambda: page.keyboard.press("PageDown"),
                           lambda r: f"chainage_m={ch1(ASH_TOWERS_M[1])}" in r.url)
        wait_applied(page)
        trace = pose_trace(page, MIN_ANIM_MS, CHASE_MAX_MS * 2)
        assert settle_of(trace) <= CHASE_MAX_MS + MIN_ANIM_MS and pose_at(trace, CHASE_MIN_MS / 2) != trace[-1][1]
        wait_streaming_idle(page)
        frames = scene_frames(page.get_by_role("application", name="Corridor globe"))
        assert all(f["png"] == frames[0]["png"] for f in frames[1:]), "scene changes while nothing happens"
    _, token, mfs = finished_set(app_url, ["accept"], [{"chainage": PROBE_CH2_M}])
    query = "?" + urlencode({"ch": "0.0", "cam": BIRCH_START_CAM})
    with review_page(browser, app_url, token, query=query) as page:
        wait_until(page, lambda: FINAL_COPY.lower() in body_text(page).lower() and bool(CAM_RE.search(ro_text(page))))
        act_until_response(page, lambda: click(page.get_by_role("button", name=f"Fly to {mfs[0]['label']}", exact=True)),
                           lambda r: "/flight" in r.url and f"chainage_m={ch1(PROBE_CH2_M)}" in r.url)
        wait_applied(page)
        trace = pose_trace(page, FRAME_MS, FLY_MAX_MS * 2)
        assert settle_of(trace) <= FLY_MAX_MS + FRAME_MS and pose_at(trace, FLY_MIN_MS / 2) != trace[-1][1]


def test_globe_ready_and_responsive(browser, app_url):
    n = len(staff_get(app_url, f"/api/findings-sets/{ash_set_id(app_url)}")["findings"])
    with open_app(browser, app_url + "/") as page:
        assert page.context.request.post(app_url + "/api/session", data={"access_code": ANALYST}).status == 200
        page.set_viewport_size(DESKTOP)
        start = time.monotonic()
        page.goto(f"{app_url}/corridors/{ASH}")
        wait_until(page, lambda: options(page).count() == n and f"Chainage {ch1(0)} m" in ro_text(page)
                   and span_label(1, 2) in ro_text(page), seconds=READY_S + POLL_SLACK_S)
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        wait_until(page, lambda: valuenow(page) == 10, seconds=READY_S)
        assert time.monotonic() - start <= READY_S + 1, "workspace not usable in five seconds"
        for k in range(2, 6):
            page.keyboard.press("ArrowRight")
            wait_until(page, lambda: valuenow(page) == STEP_M * k and f"Chainage {ch1(STEP_M * k)} m" in ro_text(page),
                       seconds=READY_S, message="ribbon stopped answering keys while streaming")
        assert options(page).count() == n


def test_wf_cross_cutting_no_webgl(browser, app_url):
    expected = flight(app_url, ASH, chainage_m=ch1(STEP_M)).json()
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}", no_webgl=True) as page:
        wait_until(page, lambda: NO_WEBGL in body_text(page))
        wait_ready(page)
        slider(page).focus()
        page.keyboard.press("ArrowRight")
        wait_until(page, lambda: f"Chainage {ch1(STEP_M)} m" in ro_text(page))
        wait_until(page, lambda: fmt_drone(expected["position"]) in ro_text(page))
        page.keyboard.press("j")
        wait_text(page, status(page, "View status"), F1_SELECTED)


def test_api_error_contract(app_url):
    big = b'{"x":"' + b"a" * JSON_LIMIT + b'"}'
    api_error(call(app_url, "POST", f"/api/corridors/{BIRCH}/findings-sets", content=big,
                   headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    api_error(call(app_url, "POST", f"/api/corridors/{BIRCH}/findings-sets", content=b"{}",
                   headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    api_error(call(app_url, "GET", "/api/corridors/no-such-corridor"), 401, "unauthenticated")
    api_error(call(app_url, "GET", f"/api/review/{secrets.token_urlsafe(32)}/assets/x/files/y"), 404, "link_not_found")
    api_error(call(app_url, "POST", f"/api/corridors/{ASH}/findings-sets", BF_PROCESSOR, {}), 404, "not_found")
    api_error(call(app_url, "POST", f"/api/corridors/{ASH}/findings-sets", PROCESSOR, {}), 403, "forbidden")
    s = fresh_draft(app_url)
    f = add_finding(app_url, s["id"])
    api_error(call(app_url, "POST", f"/api/findings/{f['id']}/terrain", ANALYST,
                   {"ground_height_m": 10000.0, "terrain_level": 3}), 409, "coarser_terrain")
    empty = fresh_draft(app_url, CUTBANK)
    err = api_error(call(outage_url("APP_MINIO_DOWN_URL"), "POST", f"/api/findings-sets/{empty['id']}/submit", ANALYST, {}),
                    422, "validation_failed")
    assert err["fields"]["findings"] == MSG_FINDINGS
    api_error(call(app_url, "GET", "/api/no-such-route", ANALYST), 404, "not_found")
    err = api_error(call(app_url, "POST", f"/api/findings-sets/{s['id']}/close", ANALYST, {}), 409, "illegal_transition")
    assert set(err) == {"code", "message", "from", "action"}


def test_server_boundary(app_url):
    r = call(app_url, "GET", "/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json"):
        assert call(app_url, "GET", path).status_code == 404, path
    pad = lambda raw, size: raw + b" " * (size - len(raw))
    session_body = json.dumps({"access_code": UNKNOWN_CODE}).encode()
    jh = {"Content-Type": "application/json"}
    assert call(app_url, "POST", "/api/session", content=pad(session_body, JSON_LIMIT), headers=jh).status_code == 401
    api_error(call(app_url, "POST", "/api/session", content=pad(session_body, JSON_LIMIT + 1), headers=jh), 413, "payload_too_large")
    api_error(call(app_url, "POST", "/api/session", content=session_body, headers={"Content-Type": "text/plain"}),
              415, "unsupported_media_type")
    nonce = secrets.token_hex(6)
    big = b"\0" * FILE_LIMIT
    files = {"layer.json": tileset_json(nonce), f"{nonce}/big.terrain": big, f"{nonce}/over.terrain": big}
    raw = json.dumps(manifest("terrain", files)).encode()
    hdr = dict(jh, Authorization=f"Bearer {PROCESSOR}")
    api_error(call(app_url, "POST", f"/api/corridors/{CUTBANK}/assets", content=pad(raw, ASSET_JSON_LIMIT + 1), headers=hdr),
              413, "payload_too_large")
    created = call(app_url, "POST", f"/api/corridors/{CUTBANK}/assets", content=pad(raw, ASSET_JSON_LIMIT), headers=hdr)
    expect_status(created, 201)
    aid = created.json()["asset"]["id"]
    expect_status(put_file(app_url, aid, f"{nonce}/big.terrain", big), 200)
    api_error(put_file(app_url, aid, f"{nonce}/over.terrain", big + b"\0"), 413, "payload_too_large")
    x = call(app_url, "POST", "/api/session", body={"access_code": ANALYST}, headers={"Origin": FOREIGN_ORIGIN})
    api_error(x, 403, "cross_origin")
    assert not x.headers.get_list("set-cookie")
    assert x.headers.get("access-control-allow-origin") not in ("*", FOREIGN_ORIGIN)
    secrets_env = [os.environ.get(k) for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    db = urlparse(os.environ.get("DATABASE_URL", "")).password
    values = [v for v in secrets_env + [db] if v]
    html = call(app_url, "GET", "/").text
    served = [html, call(app_url, "GET", "/api/status").text, call(app_url, "GET", "/api/corridors", ANALYST).text]
    for ref in re.findall(r'(?:src|href)="([^"]+)"', html):
        if same_origin(ref, app_url) or ref.startswith("/"):
            served.append(call(app_url, "GET", urlparse(ref).path).text)
    for v in values:
        assert not any(v in body for body in served), "a credential is served"


APP_DIR = Path("/app")


def npm_tree() -> list[dict[str, Any]]:
    root = Path(os.environ.get("DEPLOYED_APP", str(APP_DIR)))
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root,
                         capture_output=True, text=True, timeout=HTTP_TIMEOUT_S)
    tree = json.loads(out.stdout or "{}")
    found: dict[str, dict[str, Any]] = {}

    def walk(deps: dict[str, Any]) -> None:
        for name, info in (deps or {}).items():
            if info.get("version") and f"{name}@{info['version']}" not in found:
                found[f"{name}@{info['version']}"] = dict(info, name=name)
                walk(info.get("dependencies", {}))
    walk(tree.get("dependencies", {}))
    return list(found.values())


def licence_ok(expr: Any) -> bool:
    if isinstance(expr, dict):
        expr = expr.get("type", "")
    e = str(expr or "").replace("(", " ").replace(")", " ")
    return any(all(p.strip() in ALLOWED_LICENCES for p in opt.split(" AND ")) for opt in e.split(" OR "))


def test_if_run_manifest():
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(data[k], str) and data[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p["name"] for p in npm_tree() if p["name"] not in notices]
    assert not missing, missing
    for name in ("Fraunces", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert name in notices, name


def test_if_licences():
    bad = []
    for p in npm_tree():
        lic = p.get("license")
        if not lic and p.get("path"):
            with suppress(OSError, ValueError):
                lic = json.loads((Path(p["path"]) / "package.json").read_text()).get("license")
        if not licence_ok(lic):
            bad.append((p["name"], lic))
    assert not bad, bad
    assert "OFL" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores():
    pkg = json.loads((APP_DIR / "package.json").read_text())
    deps = set(pkg.get("dependencies", {}))
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "level", "lowdb", "nedb", "pouchdb", "lmdb", "sql.js"}
    assert not deps & banned, deps & banned
    files = [p for p in APP_DIR.rglob("*") if p.suffix in (".sqlite", ".sqlite3", ".db")
             and "node_modules" not in p.parts and ".git" not in p.parts]
    assert not files, files
    assert Postgres().tables()


def test_if_service_config():
    s3 = S3()
    assert s3.keys(asset_prefix(ASH, "ast-ash-czml")), "seeded flight track missing from the provided bucket"
    assert Postgres().tables()


def test_if_generated_assets(browser, app_url):
    s3 = S3()
    for aid in ("ast-ash-terrain", "ast-ash-tileset", "ast-ash-czml", "ast-birch-terrain"):
        assert s3.keys(asset_prefix(ASH if aid.startswith("ast-ash") else BIRCH, aid)), aid
    with staff_page(browser, app_url, ANALYST, f"/corridors/{ASH}") as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        page.goto(f"{app_url}/corridors/{ASH}")
        wait_ready(page)
        advance(page, CAM_REWRITE_MS * 2)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_lockfile():
    lock = json.loads((APP_DIR / "package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    install = json.loads((APP_DIR / "run.json").read_text())["install"]
    words = install.split()
    assert "npm ci" in install or ("npm" in words and "install" in words), install
