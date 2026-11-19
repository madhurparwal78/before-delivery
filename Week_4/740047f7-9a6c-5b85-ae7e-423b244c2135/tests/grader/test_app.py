from __future__ import annotations

import contextlib
import csv
import hashlib
import io
import json
import math
import os
import re
import socket
import struct
import subprocess
import tempfile
import threading
import time
import urllib.parse
import zlib
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    camera,
    capture,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    scene_frames,
    select,
    session,
    settle,
    shipped_packages,
    state_styles,
    style,
    tap,
    unique,
    until,
)

HTTP_TIMEOUT = 90
BARRIER_S = 30
STREAM_CONNECT_MS = 15000
LIVE_MS = 3000
UNWRAP_MIN_MS = 1200
UNWRAP_MAX_MS = 1800
FLY_MAX_MS = 1400
GLIDE_MAX_MS = 500
POLL_S = 0.2
SLIDE_OUT_MS = 500
FRAME_MS = 16
SETTLE_PAD_MS = 50
DRAG_DEG = 180
DRAG_TOL = 20
LOCK_TTL_S = 30
LOCK_REFRESH_MS = 10000
HEARTBEAT_TTL_S = 15
DEVICES_REFRESH_MS = 5000
RECHECK_MS = 15000
INACTIVE_WITHIN_S = 20
SEARCH_SETTLE_MS = 300
REVEAL_MS = 1200
REVISIT_SAMPLES = 10
STILL_TRIES = 20
SEEN_OPACITY = ("(e) => { let o = getComputedStyle(e).visibility === 'visible' ? 1 : 0;"
                " for (let n = e; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o; }")
REVEAL_DONE = ("([band, head]) => { band.getAnimations({subtree: true}).forEach(a => {"
               " if (Number.isFinite(a.effect?.getComputedTiming().endTime)) a.finish(); });"
               " let o = getComputedStyle(head).visibility === 'visible' ? 1 : 0;"
               " for (let n = head; n; n = n.parentElement) o *= Number(getComputedStyle(n).opacity); return o === 1; }")
TOAST_WAIT_MS = 5000
NOTE_LIMIT = 500
SEARCH_LIMIT = 100
JSON_LIMIT = 64000
STILL_LIMIT = 8000000
SONAR_LIMIT = 20000000
IMPORT_LIMIT = 2000000
FORECAST_TIMEOUT_S = 10
COPILOT_TIMEOUT_S = 20
STALE_H = 6
LINK_MIN_S = 10
LINK_MAX_S = 2592000
DAY_S = 86400
WEEK_S = 604800
MIN_MINUTES = 15
MAX_MINUTES = 240
CERT_MAX = 40
PROVIDER_SLOW_PAD_MS = 1000
ORBIT_STEP_DEG = 15
ZOOM_STEP = 0.25
ZOOM_MIN = 0.5
ZOOM_MAX = 3.0
REVERSE_AFTER_MS = 500
REVERSE_MIN_MS = 300
REVERSE_MAX_MS = 800
DIVES_REFRESH_MS = 30000
LINKS_REFRESH_MS = 30000
HOUR_S = 3600
MINUTE_S = 60
LINK_LEAD_S = 58
NOTE_CARET = 3
STALE_LEAD_S = 60
CLOCK_SKEW_H = 5
CLOCK_TOL_S = 10
TAB_SPAN = 12
FARM_SKV = "Skarvholmen Laks"
FARM_KLM = "Kalamos Marine"
PIN_TOL_PX = 6
GEOM_TOL_PX = 4
DEV1, DEV2 = "DEV-1", "DEV-2"
GRADE_COPY = {"A": "Sound", "B": "Monitor", "C": "Repair within 7 days", "D": "Repair before stocking"}
PEN_NAMES = ["Skarvholmen 01", "Skarvholmen 02", "Skarvholmen 03", "Kalamos 04"]
PEN_IDS = ["skv-01", "skv-02", "skv-03", "klm-04"]
PEN_NAME = dict(zip(PEN_IDS, PEN_NAMES))
SIX_LINES = ["View: Cylinder", "Camera: 0°", "Zoom: 1.00×", "Selected: none", "Focus: none", "Dive clock: no dive running"]
CSV_HEADER = "farm,site_code,pen,defect_id,type,bearing_deg,depth_m,chart_x_m,chart_y_m,cell,area_cm2,patch_area_m2,status,note"
LEGACY_HEADER = "site_code,pen_no,observed_at,kind,bearing,depth_m,size_a_cm,size_b_cm,note"
FOREIGN_ORIGIN = "https://elsewhere.example"
FLAG = "\U0001F1F3\U0001F1F4"
SKIN = "\U0001F44D\U0001F3FD"
FAMILY = "\U0001F468\u200D\U0001F469\u200D\U0001F467"
ACCENT = "e\u0301"
HOLE = {"width_cm": 30, "height_cm": 24}
TEAR = {"length_cm": 45, "gap_cm": 6}
CHAFE = {"length_cm": 120, "width_cm": 15}
SMALL_CHAFE = {"length_cm": 10, "width_cm": 1}
BIG_HOLE = {"width_cm": 20, "height_cm": 20}
UNKNOWN_ID = "D-9999"
SPACED_NOTE = "  kept as sent  "
FIRST_NOTE = "first save"
SECOND_NOTE = "second save"
REMOTE_NOTE = "saved on the tablet"
TRACK_TYPED = "0,90.0,2.0\n30,95.0,3.5\n60,100.0,4.0"
TRACK_CARET = 11
TRACK_ROWS = [(0, 90.0, 2.0), (30, 95.0, 3.5), (60, 100.0, 4.0)]
TYPED_BEARING = "45"
TYPED_DEPTH_BAD = "16"
TYPED_DEPTH_OK = "7.5"
D_HOLE = "D-0001"
D_TEAR = "D-0002"
D_CHAFE = "D-0003"
D_HYDROID = "D-0005"
D_BRIDLE = "D-0007"


def api(url: str, method: str, path: str, *, device: str | None = DEV1, body: Any = None,
        content: bytes | None = None, headers: dict[str, str] | None = None,
        timeout: float = HTTP_TIMEOUT) -> httpx.Response:
    h: dict[str, str] = {}
    if device:
        h["X-Pensight-Device"] = device
    h.update(headers or {})
    with httpx.Client(timeout=timeout) as c:
        return c.request(method, url.rstrip("/") + path, json=body, content=content, headers=h)


def ok(r: httpx.Response, status: int = 200) -> Any:
    assert r.status_code == status, f"{r.request.method} {r.request.url} -> {r.status_code}: {r.text[:600]}"
    return r.json()


def err(r: httpx.Response, status: int, code: str) -> dict:
    assert r.status_code == status, f"{r.request.method} {r.request.url}: expected {status} {code}, got {r.status_code}: {r.text[:600]}"
    e = r.json()["error"]
    assert e["code"] == code, e
    assert isinstance(e["message"], str) and e["message"]
    if status == 422:
        assert isinstance(e.get("fields"), dict) and e["fields"], e
    else:
        assert "fields" not in e, e
    if status != 423:
        assert "details" not in e or e["details"] == {}, e
    return e


def tag(prefix: str = "pensight") -> str:
    return re.sub(r"[^A-Za-z0-9]", "", unique(prefix)[0])[-20:]


def parse_ts(ts: str) -> datetime:
    return datetime.fromisoformat(ts.replace("Z", "+00:00"))


def iso(dt: datetime) -> str:
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def grade_line(p: dict) -> str:
    n = p["open_defects"]
    return f"Grade {p['grade']['letter']} — {p['grade']['label']} · {n} open defect{'' if n == 1 else 's'}"


def pen(url: str, pen_id: str) -> dict:
    return ok(api(url, "GET", f"/api/pens/{pen_id}"))["pen"]


def get_defect(url: str, did: str) -> dict:
    return ok(api(url, "GET", f"/api/defects/{did}"))["defect"]


def history(url: str, did: str) -> list[dict]:
    return ok(api(url, "GET", f"/api/defects/{did}/history"))["history"]


def race(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls), timeout=BARRIER_S)

    def go(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(max_workers=len(calls)) as ex:
        futures = [ex.submit(go, c) for c in calls]
        return [f.result() for f in futures]


class Owned:

    def __init__(self, url: str) -> None:
        self.url = url
        self.ids: list[str] = []
        self.dives: list[str] = []

    def defect(self, pen_id: str, kind: str, bearing: float, depth: float, size: dict, note: str = "",
               private_note: str = "", device: str = DEV1) -> dict:
        r = api(self.url, "POST", f"/api/pens/{pen_id}/defects", device=device, body={
            "type": kind, "bearing_deg": bearing, "depth_m": depth, "size": size,
            "note": note, "private_note": private_note})
        d = ok(r, 201)["defect"]
        self.ids.append(d["id"])
        return d

    def close(self) -> None:
        for did in self.ids:
            with contextlib.suppress(httpx.HTTPError):
                api(self.url, "DELETE", f"/api/defects/{did}/lock", device=DEV2)
                api(self.url, "DELETE", f"/api/defects/{did}/lock", device=DEV1)
                api(self.url, "DELETE", f"/api/defects/{did}")
        for dive_id in self.dives:
            with contextlib.suppress(httpx.HTTPError):
                api(self.url, "POST", f"/api/dives/{dive_id}/finish",
                    body={"track": [{"t_s": 0, "bearing_deg": 0.0, "depth_m": 1.0}]})


@contextlib.contextmanager
def owned(url: str) -> Iterator[Owned]:
    o = Owned(url)
    try:
        yield o
    finally:
        o.close()


def keep_created(o: Owned, resp: Any) -> dict:
    body = resp.json() if resp.status == 201 else {}
    if "defect" in body:
        o.ids.append(body["defect"]["id"])
    return body.get("defect", {})


def server_now(url: str) -> datetime:
    return parse_ts(ok(api(url, "GET", "/api/dives"))["server_now"])


def next_hour(url: str) -> datetime:
    return server_now(url).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)


def plan_dive(url: str, o: Owned | None, pen_id: str, start: datetime, minutes: int = 90) -> dict:
    d = ok(api(url, "POST", "/api/dives", body={
        "pen_id": pen_id, "planned_start": iso(start), "planned_minutes": minutes,
        "diver_certificate_no": "NO-" + tag("cert")[:12]}), 201)["dive"]
    if o is not None:
        o.dives.append(d["id"])
    return d


def marine_body(issued: datetime, first_hour: datetime, currents: list, waves: list) -> dict:
    times = [(first_hour + timedelta(hours=i)).strftime("%Y-%m-%dT%H:00Z") for i in range(len(currents))]
    return {"latitude": 63.4512, "longitude": 8.7321, "issued_at": iso(issued),
            "hourly_units": {"time": "iso8601", "ocean_current_velocity": "m/s", "wave_height": "m"},
            "hourly": {"time": times, "ocean_current_velocity": currents, "wave_height": waves}}


def chat_reply(content: str | None, calls: list[tuple[str, str, Any]]) -> dict:
    return {"id": "chatcmpl-probe", "object": "chat.completion", "model": "pensight-findings-1",
            "choices": [{"index": 0, "finish_reason": "tool_calls", "message": {
                "role": "assistant", "content": content,
                "tool_calls": [{"id": cid, "type": "function", "function": {
                    "name": name, "arguments": args if isinstance(args, str) else json.dumps(args)}}
                    for cid, name, args in calls]}}]}


def wm_entries(wm: Any, path: str, method: str) -> list[dict]:
    return [e.get("request", e) for e in wm.requests(path, method)]


def wm_query(r: dict) -> dict[str, str]:
    return {str(k): str(v) for k, v in (r.get("query") or {}).items()}


def wm_headers(r: dict) -> dict[str, Any]:
    return {str(k).lower(): v for k, v in (r.get("headers") or {}).items()}


def png(total: int | None = None) -> bytes:
    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0)) + \
        chunk(b"IDAT", zlib.compress(b"\x00\x00\x00\x00"))
    tail = chunk(b"IEND", b"")
    pad_len = 32 if total is None else total - len(head) - len(tail) - 12
    return head + chunk(b"prVt", os.urandom(pad_len)) + tail


def upload_still(url: str, did: str, data: bytes, ctype: str = "image/png", device: str = DEV1) -> httpx.Response:
    return api(url, "POST", f"/api/defects/{did}/stills", device=device, content=data,
               headers={"Content-Type": ctype, "X-Filename": "still.png"})


def import_csv(url: str, data: bytes, farm: str = "skarvholmen", name: str = "log.csv", device: str = DEV1) -> httpx.Response:
    return api(url, "POST", f"/api/farms/{farm}/imports", device=device, content=data,
               headers={"Content-Type": "text/csv", "X-Filename": name})


def create_link(url: str, pen_id: str, seconds: int) -> dict:
    return ok(api(url, "POST", f"/api/pens/{pen_id}/links", body={"expires_in_seconds": seconds}), 201)["link"]


def share(url: str, token: str) -> httpx.Response:
    return api(url, "GET", f"/api/share/{token}", device=None)


def search(url: str, q: str) -> httpx.Response:
    return api(url, "GET", "/api/search?" + urllib.parse.urlencode({"q": q}))


def outage_url() -> str:
    return os.environ["APP_WIREMOCK_DOWN_URL"]


@contextlib.contextmanager
def console(browser: Browser, url: str, path: str, *, size: tuple[int, int] = (1280, 800), touch: bool = False,
            reduced: bool = False, no_webgl: bool = False) -> Iterator[Page]:
    full = url.rstrip("/") + path
    with open_app(browser, full, reduced_motion="reduce" if reduced else "no-preference", no_webgl=no_webgl) as page:
        if size != (1280, 800) or touch:
            page.set_viewport_size({"width": size[0], "height": size[1]})
            if touch:
                session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
            page.goto(full)
        yield page


def wait_text(page: Page, text: str, seconds: float = 30) -> None:
    until(page, "(t) => document.body.innerText.includes(t)", text, seconds)


def wait_ws(page: Page) -> None:
    until(page, "() => { const t = document.body.innerText; return t.includes('Dive clock:') && !t.includes('Loading pen'); }")


def scene_lines(page: Page) -> list[str]:
    text = page.get_by_role("status", name="Scene status").inner_text()
    return [s.strip() for s in text.splitlines() if s.strip()]


def scene_line(page: Page, prefix: str) -> str:
    for line in scene_lines(page):
        if line.startswith(prefix):
            return line
    pytest.fail(f"Scene status has no {prefix!r} line: {scene_lines(page)}")


def cam_deg(page: Page) -> int:
    m = re.fullmatch(r"Camera: (\d+)°", scene_line(page, "Camera: "))
    assert m, scene_lines(page)
    return int(m.group(1))


def wait_line(page: Page, expected: str, budget_ms: int = 3000, step_ms: int = 50) -> None:
    for _ in range(budget_ms // step_ms + 1):
        if expected in scene_lines(page):
            return
        advance(page, step_ms)
    pytest.fail(f"Scene status never read {expected!r}: {scene_lines(page)}")


def twin(name: str) -> str:
    return f"3D twin of {name}"


def facing(bearing: float) -> int:
    return int(math.floor(bearing + 0.5)) % 360


def expected_cell(p: dict, bearing: float, depth: float) -> str:
    g = p["grid"]
    cx = round(bearing * float(p["circumference_m"]) / 360, 2)
    return f"{chr(65 + int(cx // float(g['panel_width_m'])))}{int(depth // float(g['panel_height_m'])) + 1}"


def box(locator: Any) -> dict:
    b = locator.bounding_box()
    assert b, f"{locator} has no box"
    return b


def painted(page: Page, name: str) -> Any:
    still = page.get_by_role("img", name=name)
    still.evaluate("e => e.scrollIntoView({block: 'center', behavior: 'instant'})")
    for _ in range(STILL_TRIES):
        advance(page, 100)
        shot = decode(capture(still))
        if shot.variance() > 0:
            return shot
    pytest.fail(f"{name} stays blank")


def top_left(shot: Any, width: int, height: int) -> Any:
    rows = b"".join(shot.rgb[y * shot.width * 3:(y * shot.width + width) * 3] for y in range(height))
    return type(shot)(width, height, rows)


def mid(b: dict) -> tuple[float, float]:
    return b["x"] + b["width"] / 2, b["y"] + b["height"] / 2


def pin_mid(page: Page, did: str) -> tuple[float, float]:
    advance(page, 250)
    return mid(box(page.get_by_role("button", name=f"Pin {did}")))


def touch_path(page: Page, start: list[tuple[float, float]], end: list[tuple[float, float]], steps: int = 12) -> None:
    cdp = session(page)

    def send(kind: str, pts: list[tuple[float, float]]) -> None:
        cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [
            {"x": x, "y": y, "id": i} for i, (x, y) in enumerate(pts)]})

    send("touchStart", start)
    for s in range(1, steps + 1):
        advance(page, FRAME_MS)
        send("touchMove", [(a[0] + (b[0] - a[0]) * s / steps, a[1] + (b[1] - a[1]) * s / steps) for a, b in zip(start, end)])
    send("touchEnd", [])


def open_editor(page: Page, row: Any, heading: str) -> Any:
    click(row)
    row.focus()
    page.keyboard.press("e")
    editor = page.get_by_role("region", name="Defect editor")
    expect(editor.get_by_role("heading", name=heading)).to_be_visible()
    return editor


def pick_type(combo: Any, kind: str) -> None:
    labels = combo.evaluate("el => el.tagName === 'SELECT' ? Array.from(el.options).map(o => o.textContent.trim()) : []")
    label = next((x for x in labels if x.lower() == kind), None)
    if label:
        select(combo, label)
        return
    try:
        select(combo, kind)
    except Exception:
        select(combo, kind.capitalize())


def wait_lock(page: Page, valkey: Any, did: str, holder: str) -> None:
    deadline = time.monotonic() + 10
    while lock_value(valkey, did) != holder:
        advance(page, 100)
        if time.monotonic() > deadline:
            pytest.fail(f"Valkey lock for {did} never held by {holder}")


def poll_gap() -> None:
    threading.Event().wait(POLL_S)


def lock_value(valkey: Any, did: str) -> str | None:
    v = valkey.command("GET", f"pensight:lock:defect:{did}")
    return v.decode() if isinstance(v, bytes) else v


def wait_unlocked(page: Page, valkey: Any, did: str) -> None:
    deadline = time.monotonic() + 10
    while lock_value(valkey, did) is not None:
        advance(page, 100)
        if time.monotonic() > deadline:
            pytest.fail(f"the lock on {did} was not released")


def live(page: Page, ready: Callable[[], bool], budget_ms: int, what: str) -> None:
    deadline = time.monotonic() + budget_ms / 1000
    while not ready():
        if time.monotonic() > deadline:
            pytest.fail(f"{what} did not arrive within {budget_ms} ms")
        advance(page, 50)


def live_text(page: Page, locator: Any, text: str, budget_ms: int) -> None:
    live(page, lambda: locator.count() > 0 and text in locator.first.inner_text(), budget_ms, repr(text))


def soon(page: Page, ready: Callable[[], bool], budget_ms: int) -> bool:
    deadline = time.monotonic() + budget_ms / 1000
    while not ready():
        if time.monotonic() > deadline:
            return False
        advance(page, 50)
    return True


class Held:

    def __init__(self) -> None:
        self.seen: list = []
        self.release: Callable[[], None] = lambda: None


@contextlib.contextmanager
def holding(page: Page, glob: str, method: str, path_re: str) -> Iterator[Held]:
    rx = re.compile(path_re)
    waiting: list = []
    held_now = Held()

    def hold(route: Any) -> None:
        req = route.request
        if req.method == method and rx.search(urllib.parse.urlparse(req.url).path):
            held_now.seen.append(req)
            waiting.append(route)
        else:
            route.fallback()

    page.route(glob, hold)

    def release() -> None:
        with contextlib.suppress(PlaywrightError):
            page.unroute(glob, hold)
        while waiting:
            with contextlib.suppress(PlaywrightError):
                waiting.pop(0).fallback()

    held_now.release = release
    try:
        yield held_now
    finally:
        release()


PRESSED_STATE = """() => {
  const b = window.__pressedWrite;
  if (!b || !b.isConnected) return 'gone';
  return b.disabled || b.getAttribute('aria-disabled') === 'true' ? 'disabled' : 'enabled';
}"""


def second_press_sends_nothing(page: Page, button: Any, glob: str, path_re: str, status: Any, pending: str,
                               again: Callable[[], None] | None = None, method: str = "POST",
                               disabled: bool = True) -> None:
    with holding(page, glob, method, path_re) as h:
        button.evaluate("b => { window.__pressedWrite = b; }")
        click(button)
        live(page, lambda: len(h.seen) >= 1, LIVE_MS, "the write request")
        expect(status).to_contain_text(pending)
        kept = page.evaluate(PRESSED_STATE) != "gone"
        if disabled and kept:
            live(page, lambda: page.evaluate(PRESSED_STATE) == "disabled", LIVE_MS, "the pressed button disabled")
        elif disabled:
            expect(button).to_be_disabled()
        if again is not None:
            again()
        elif kept:
            page.evaluate("() => window.__pressedWrite.click()")
        else:
            button.click(force=True)
        advance(page, GLIDE_MAX_MS)
        assert len(h.seen) == 1, f"{len(h.seen)} requests sent while the first was in flight"
        h.release()


def newest_choice_wins(page: Page, glob: str, path_re: str, choose_old: Callable[[], None],
                       choose_new: Callable[[], None], shows_new: Callable[[], bool], what: str) -> None:
    with holding(page, glob, "GET", path_re) as h:
        choose_old()
        soon(page, lambda: len(h.seen) >= 1, LIVE_MS)
        choose_new()
        live(page, shows_new, STREAM_CONNECT_MS, what)
        late = list(h.seen)
        h.release()
        for req in late:
            with contextlib.suppress(PlaywrightError):
                req.response()
    for _ in range(10):
        advance(page, 50)
        assert shows_new(), f"a reply for the earlier choice replaced {what}"


def field_error(r: httpx.Response, field: str) -> None:
    e = err(r, 422, "validation")
    assert field in e["fields"], (field, e)


def hms(text: str) -> int:
    h, m, s = (int(x) for x in text.split(":"))
    return h * 3600 + m * 60 + s


SAW_RUN_SCRIPT = """
window.__sawRun = false;
new MutationObserver(() => {
  const t = document.body ? document.body.innerText : '';
  if (t.includes('View: Unwrapping') || t.includes('View: Wrapping')) window.__sawRun = true;
}).observe(document, {subtree: true, childList: true, characterData: true});
"""


SEED_DEFECTS = {
    "D-0001": ("skv-01", "hole", 112.5, 12.4, {"width_cm": 30, "height_cm": 24}, 50.0, "F3", 565, None, "open", "Hole beside seam, edges frayed", "Farm saw a seal near this pen on 28 October", 1),
    "D-0002": ("skv-01", "tear", 236.7, 4.8, {"length_cm": 45, "gap_cm": 6}, 105.2, "K1", 135, None, "open", "Seam tear along vertical rope", "", 1),
    "D-0003": ("skv-01", "chafe", 300.0, 18.2, {"length_cm": 120, "width_cm": 15}, 133.33, "N4", 1800, None, "open", "Chafe where the sinker tube rubs", "Bill this re-check at half rate", 1),
    "D-0004": ("skv-01", "fouling", 0.9, 2.0, {"width_m": 6.0, "height_m": 3.0}, 0.4, "A1", None, 18.0, "open", "Mussel and kelp growth near surface", "", 1),
    "D-0005": ("skv-01", "fouling", 202.5, 5.0, {"width_m": 4.0, "height_m": 4.0}, 90.0, "J2", None, 16.0, "open", "Hydroid fouling on panel join", "", 1),
    "D-0006": ("skv-01", "hole", 45.0, 8.0, {"width_cm": 10, "height_cm": 10}, 20.0, "C2", 79, None, "repaired", "Small hole, laced on last visit", "", 2),
    "D-0007": ("skv-02", "chafe", 90.0, 10.0, {"length_cm": 40, "width_cm": 5}, 40.0, "E3", 200, None, "open", "Light chafe at mooring bridle", "", 1),
    "D-0008": ("klm-04", "fouling", 180.0, 6.0, {"width_m": 5.0, "height_m": 2.0}, 45.0, "E2", None, 10.0, "open", "Algal film on lower panels", "", 1),
}
SEED_PENS = {
    "skv-01": ("Skarvholmen 01", "skarvholmen", "SKV", 1, 160, 20, 16, 4, 10.0, 5.0, "D", 5, 20.4),
    "skv-02": ("Skarvholmen 02", "skarvholmen", "SKV", 2, 160, 20, 16, 4, 10.0, 5.0, "B", 1, 0.0),
    "skv-03": ("Skarvholmen 03", "skarvholmen", "SKV", 3, 120, 15, 12, 3, 10.0, 5.0, "A", 0, 0.0),
    "klm-04": ("Kalamos 04", "kalamos", "KLM", 4, 90, 12, 9, 3, 10.0, 4.0, "B", 1, 25.0),
}
SEED_COVER = {"skv-01": {"A1": 20.4, "P1": 15.6, "I1": 8.0, "I2": 8.0, "J1": 8.0, "J2": 8.0}, "klm-04": {"E2": 25.0}}


def test_seed_exact_records(app_url: str) -> None:
    s3 = S3()
    assert {"defects", "imports", "import_ledger", "report_revisions", "report_links"} <= {t.rsplit(".", 1)[-1] for t in Postgres().tables()}
    farms = ok(api(app_url, "GET", "/api/farms"))["farms"]
    assert [f["id"] for f in farms] == ["skarvholmen", "kalamos"]
    skv, klm = farms
    assert (skv["name"], float(skv["day_rate"]["amount"]), skv["day_rate"]["currency"]) == ("Skarvholmen Laks", 14500.0, "NOK")
    assert (klm["name"], float(klm["day_rate"]["amount"]), klm["day_rate"]["currency"]) == ("Kalamos Marine", 950.0, "EUR")
    assert [(s["code"], s["name"], float(s["latitude"]), float(s["longitude"])) for s in skv["sites"]] == [("SKV", "Skarvholmen North", 63.4512, 8.7321)]
    assert [(s["code"], s["name"], float(s["latitude"]), float(s["longitude"])) for s in klm["sites"]] == [("KLM", "Kalamos Bay", 38.6215, 20.9013)]
    assert skv["pen_ids"] == ["skv-01", "skv-02", "skv-03"] and klm["pen_ids"] == ["klm-04"]

    devices = ok(api(app_url, "GET", "/api/devices"))["devices"]
    assert [(d["id"], d["name"]) for d in devices] == [("DEV-1", "Topside laptop"), ("DEV-2", "Deck tablet")]

    pens = ok(api(app_url, "GET", "/api/pens"))["pens"]
    assert [p["id"] for p in pens] == list(SEED_PENS)
    for p in pens:
        name, farm, code, no, circ, depth, cols, rows, pw, ph, letter, open_n, cover = SEED_PENS[p["id"]]
        assert (p["name"], p["farm_id"], p["site_code"], p["pen_no"]) == (name, farm, code, no)
        assert (float(p["circumference_m"]), float(p["net_depth_m"])) == (circ, depth)
        assert (p["grid"]["columns"], p["grid"]["rows"], float(p["grid"]["panel_width_m"]), float(p["grid"]["panel_height_m"])) == (cols, rows, pw, ph)
        assert p["grade"] == {"letter": letter, "label": GRADE_COPY[letter]}
        assert (p["open_defects"], float(p["max_fouling_cover_pct"])) == (open_n, cover)
        full = pen(app_url, p["id"])
        want_cells = [f"{chr(65 + c)}{r + 1}" for r in range(rows) for c in range(cols)]
        assert [x["cell"] for x in full["panels"]] == want_cells
        for x in full["panels"]:
            assert float(x["fouling_cover_pct"]) == SEED_COVER.get(p["id"], {}).get(x["cell"], 0.0), (p["id"], x)
        seeded = [d["id"] for d in full["defects"] if d["id"] <= "D-0008"]
        assert seeded == [k for k, v in SEED_DEFECTS.items() if v[0] == p["id"]]

    for did, (pid, kind, b, dep, size, cx, cell, area, patch, status, note, priv, ver) in SEED_DEFECTS.items():
        d = get_defect(app_url, did)
        assert (d["pen_id"], d["type"], d["removed"], d["status"], d["version"]) == (pid, kind, False, status, ver), did
        assert (float(d["bearing_deg"]), float(d["depth_m"]), float(d["chart_x_m"]), float(d["chart_y_m"]), d["cell"]) == (b, dep, cx, dep, cell), did
        assert {k: float(v) for k, v in d["size"].items()} == {k: float(v) for k, v in size.items()}, did
        assert d["area_cm2"] == area and (d["patch_area_m2"] if patch is None else float(d["patch_area_m2"])) == patch, did
        assert (d["note"], d["private_note"]) == (note, priv), did
        assert d["lock"] is None or d["lock"]["device_id"] in ("DEV-1", "DEV-2")
        h = history(app_url, did)
        assert h[0]["action"] == "created" and h[0]["device_name"] == "Topside laptop" and parse_ts(h[0]["at"]) == parse_ts("2026-11-02T08:30:00Z")
    rep = get_defect(app_url, "D-0006")["repairs"]
    assert len(rep) == 1
    assert (rep[0]["id"], rep[0]["method"], rep[0]["note"], rep[0]["source"], rep[0]["proposal_id"]) == ("R-0001", "lace", "Laced with 3 mm twine", "manual", None)
    assert parse_ts(rep[0]["recorded_at"]) == parse_ts("2026-11-02T09:05:00Z")
    assert [e["action"] for e in history(app_url, "D-0006")][:2] == ["created", "repaired"]

    dive = ok(api(app_url, "GET", "/api/dives/DIVE-0001"))["dive"]
    assert (dive["pen_id"], dive["status"], dive["planned_minutes"], dive["diver_certificate_no"]) == ("skv-01", "recorded", 90, "NO-ROV-48213")
    assert parse_ts(dive["planned_start"]) == parse_ts("2026-11-02T08:00:00Z")
    assert parse_ts(dive["started_at"]) == parse_ts("2026-11-02T08:04:00Z") and parse_ts(dive["finished_at"]) == parse_ts("2026-11-02T09:21:00Z")
    assert dive["clearance"]["result"] == "GO"
    assert parse_ts(dive["clearance"]["checked_at"]) == parse_ts("2026-11-02T07:40:00Z")
    assert parse_ts(dive["clearance"]["issued_at"]) == parse_ts("2026-11-02T06:00:00Z")
    assert [(s["t_s"], float(s["bearing_deg"]), float(s["depth_m"])) for s in dive["track"]] == [
        (0, 0.0, 1.0), (600, 45.0, 8.0), (1500, 112.5, 12.0), (2700, 202.5, 5.0), (3600, 300.0, 17.5), (4620, 355.0, 2.0)]
    assert dive["sonar"] == []

    revs = ok(api(app_url, "GET", "/api/pens/skv-01/reports"))["revisions"]
    r1 = [r for r in revs if r["number"] == 1]
    assert len(r1) == 1 and r1[0]["grade"]["letter"] == "D" and r1[0]["open_defects"] == 5
    assert parse_ts(r1[0]["published_at"]) == parse_ts("2026-11-02T10:15:00Z")
    pack = api(app_url, "GET", "/api/pens/skv-01/reports/1/pack")
    assert pack.status_code == 200
    stored = s3.get("farms/skarvholmen/reports/skv-01/revision-1.json")
    assert pack.content == stored and hashlib.sha256(stored).hexdigest() == pack.headers["X-Content-SHA256"] == r1[0]["sha256"]
    body = json.loads(stored)
    assert body["format"] == "pensight-report-pack-1" and body["revision"] == 1
    assert [d["id"] for d in body["defects"]] == ["D-0001", "D-0002", "D-0003", "D-0004", "D-0005", "D-0006"]
    assert "Farm saw a seal" not in stored.decode() and "half rate" not in stored.decode()


def test_wf_first_open_copy(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/") as page:
        wait_text(page, "Grade A — Sound · 0 open defects")
        expect(page.get_by_role("link", name=f"Open pen {PEN_NAMES[0]}")).to_contain_text("Grade D — Repair before stocking · 5 open defects")
        expect(page.get_by_role("link", name="Skarvholmen 01", exact=True)).to_contain_text("Grade D — Repair before stocking · 5 open defects")
        expect(page.get_by_role("link", name="Skarvholmen 02", exact=True)).to_contain_text("Grade B — Monitor · 1 open defect")
        expect(page.get_by_role("link", name="Kalamos 04", exact=True)).to_contain_text("Grade B — Monitor · 1 open defect")
        expect(page.get_by_role("link", name="Skarvholmen 03", exact=True)).to_contain_text("Grade A — Sound · 0 open defects")
        for farm, rate in (("Skarvholmen Laks", "14500 NOK per day"), ("Kalamos Marine", "950 EUR per day")):
            click(page.get_by_role("button", name=f"Farm details: {farm}"))
            dialog = page.get_by_role("dialog", name="Farm details")
            expect(dialog).to_contain_text(rate)
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(dialog).to_have_count(0)

        page.goto(app_url.rstrip("/") + "/devices")
        wait_text(page, "This browser is Topside laptop")
        for _ in range(DEVICES_REFRESH_MS // 500):
            if "Topside laptop — Online" in page.locator("body").inner_text():
                break
            advance(page, 500)
        assert "Topside laptop — Online" in page.locator("body").inner_text(), "Topside laptop — Online within 5 seconds"
        until(page, "() => document.body.innerText.includes('Deck tablet — Offline')", None, 45)

        with held(page, "**/api/pens/skv-01") as hold:
            page.goto(app_url.rstrip("/") + "/pens/skv-01")
            wait_text(page, "Loading pen")
            assert scene_lines(page) == SIX_LINES + ["Loading pen"]
            hold.release()
        wait_ws(page)
        assert scene_lines(page) == SIX_LINES


def test_pen_condition_cards(browser: Browser, app_url: str) -> None:
    pens = ok(api(app_url, "GET", "/api/pens"))["pens"]
    lines = {p["name"]: grade_line(p) for p in pens}
    with console(browser, app_url, "/") as page:
        wait_text(page, lines["Skarvholmen 03"])
        for (w, h), per_row in (((1280, 800), 3), ((768, 1024), 2), ((375, 812), 1)):
            page.set_viewport_size({"width": w, "height": h})
            advance(page, 200)
            open_card = page.get_by_role("link", name=f"Open pen {PEN_NAMES[0]}")
            expect(open_card).to_contain_text(lines["Skarvholmen 01"])
            boxes = [box(page.get_by_role("link", name=n, exact=True)) for n in PEN_NAMES]
            ob = box(open_card)
            assert ob["y"] + ob["height"] <= boxes[0]["y"] + GEOM_TOL_PX, "open-pen card sits above the square cards"
            first_row = boxes[:per_row]
            assert ob["x"] <= first_row[0]["x"] + GEOM_TOL_PX
            assert ob["x"] + ob["width"] >= first_row[-1]["x"] + first_row[-1]["width"] - GEOM_TOL_PX
            for i, b in enumerate(boxes):
                assert abs(b["width"] - b["height"]) <= GEOM_TOL_PX, f"square card {PEN_NAMES[i]} at {w}"
                row = i // per_row
                assert abs(b["y"] - boxes[row * per_row]["y"]) <= GEOM_TOL_PX, f"{PEN_NAMES[i]} in row {row} at {w}"
                if i % per_row == 0 and i > 0:
                    assert b["y"] > boxes[i - per_row]["y"] + GEOM_TOL_PX
            for n in PEN_NAMES:
                expect(page.get_by_role("link", name=n, exact=True)).to_contain_text(lines[n])
            layout(page)
        page.set_viewport_size({"width": 1280, "height": 800})
        advance(page, 200)
        stills = [painted(page, f"{n} twin still") for n in ("Skarvholmen 02", "Skarvholmen 03")]
        w, h = min(s.width for s in stills), min(s.height for s in stills)
        assert difference(top_left(stills[0], w, h), top_left(stills[1], w, h)) > 0, "each still draws its own twin"
        card = page.get_by_role("link", name="Skarvholmen 02", exact=True)
        rest_f, focus_f = state_styles(card, "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest_f != focus_f, "keyboard focus shows the focus ring"
        expect(page.get_by_role("button", name=f"Farm details: {FARM_SKV}")).to_be_visible()
        card.focus()
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/pens/skv-02"))
    desk = browser.new_context(viewport={"width": 1280, "height": 800}, has_touch=False)
    try:
        mouse_page = desk.new_page()
        mouse_page.goto(app_url.rstrip("/") + "/")
        card = mouse_page.get_by_role("link", name="Skarvholmen 02", exact=True)
        card.wait_for()
        expect(card).to_contain_text(lines["Skarvholmen 02"])
        grade = card.get_by_text(lines["Skarvholmen 02"], exact=True)
        settle(card)
        rest = float(style(grade, "opacity")["opacity"])
        card.hover()
        mouse_page.wait_for_function("([g, r]) => Number(getComputedStyle(g).opacity) > r", arg=[grade.element_handle(), rest])
    finally:
        desk.close()


def test_cards_follow_other_device(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/") as page:
        card = page.get_by_role("link", name="Skarvholmen 03", exact=True)
        expect(card).to_contain_text(grade_line(pen(app_url, "skv-03")))
        page.evaluate("() => { window.__stayed = true; }")
        card.focus()
        d = o.defect("skv-03", "hole", 100, 4, BIG_HOLE, device=DEV2)
        marked = pen(app_url, "skv-03")
        assert marked["grade"]["letter"] == "D"
        live_text(page, card, grade_line(marked), STREAM_CONNECT_MS)
        expect(card).to_be_focused()
        ok(api(app_url, "DELETE", f"/api/defects/{d['id']}", device=DEV2))
        live_text(page, card, grade_line(pen(app_url, "skv-03")), LIVE_MS)
        expect(card).to_be_focused()
        assert page.evaluate("() => window.__stayed === true"), "no reload"


def test_live_twin_renders(browser: Browser, app_url: str) -> None:
    live = [d["id"] for d in pen(app_url, "skv-01")["defects"] if not d["removed"]]
    with console(browser, app_url, "/pens/skv-01") as page:
        wait_ws(page)
        canvas = page.get_by_role("region", name="Pen stage").get_by_role("img", name=twin(PEN_NAMES[0]))
        frames = scene_frames(canvas, steps=4, step_ms=500)
        assert any(f["draws"] > 0 for f in frames), "WebGL draws"
        assert decode(frames[0]["png"]).variance() > 0, "stage is not blank"
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) > 0, "idle loops animate"
        expect(page.get_by_role("button", name=re.compile(r"^Pin D-\d{4}$"))).to_have_count(len(live))
        for did in live:
            b = box(page.get_by_role("button", name=f"Pin {did}"))
            assert b["width"] >= 44 and b["height"] >= 44, did
    with console(browser, app_url, "/pens/skv-01", no_webgl=True) as page:
        wait_ws(page)
        lines = scene_lines(page)
        assert "View: Flat chart" in lines and "Camera: flat chart" in lines
        assert "3D view unavailable — showing the flat chart" in lines
        expect(page.get_by_role("button", name="Unwrap")).to_have_count(0)
        expect(page.get_by_role("button", name="Wrap")).to_have_count(0)
        expect(page.get_by_role("button", name=re.compile(r"^Pin D-\d{4}$"))).to_have_count(len(live))
        expect(page).to_have_url(re.compile(r"view=flat"))


def test_unwrap_wrap_motion(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/pens/skv-01") as page:
        wait_ws(page)
        canvas = page.get_by_role("img", name=twin(PEN_NAMES[0]))
        before = decode(capture(canvas))
        click(page.get_by_role("button", name="Unwrap"))
        advance(page, FRAME_MS)
        assert "View: Unwrapping" in scene_lines(page)
        advance(page, UNWRAP_MIN_MS - 2 * FRAME_MS)
        assert "View: Unwrapping" in scene_lines(page), "the run lasts at least 1.2 s"
        advance(page, UNWRAP_MAX_MS - UNWRAP_MIN_MS + SETTLE_PAD_MS)
        lines = scene_lines(page)
        assert "View: Flat chart" in lines and "Camera: flat chart" in lines
        expect(page.get_by_role("button", name="Wrap")).to_be_visible()
        expect(page.get_by_role("button", name="Unwrap")).to_have_count(0)
        assert difference(before, decode(capture(canvas))) > 0
        c = {d: mid(box(page.get_by_role("button", name=f"Pin {d}"))) for d in ("D-0004", "D-0006", "D-0001", "D-0005", "D-0002", "D-0003")}
        xs = [c[d][0] for d in ("D-0004", "D-0006", "D-0001", "D-0005", "D-0002", "D-0003")]
        assert xs == sorted(xs), "pins ordered by chart x"
        k = (c["D-0003"][0] - c["D-0004"][0]) / (133.33 - 0.4)
        assert abs(c["D-0004"][0] + (50.0 - 0.4) * k - c["D-0001"][0]) <= PIN_TOL_PX, "D-0001 at chart x 50.00 m"
        ky = (c["D-0003"][1] - c["D-0002"][1]) / (18.2 - 4.8)
        assert abs(ky - k) <= abs(k) * 0.05 + PIN_TOL_PX / 100, "depth uses the same metres-per-pixel scale as x"
        assert c["D-0002"][1] < c["D-0001"][1] < c["D-0003"][1], "depth increases downwards"
        page.keyboard.press("w")
        advance(page, FRAME_MS)
        assert "View: Wrapping" in scene_lines(page)
        advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
        assert "View: Cylinder" in scene_lines(page)
        expect(page.get_by_role("button", name="Unwrap")).to_be_visible()


def test_wf_first_open_reversal(browser: Browser, app_url: str) -> None:
    address = {"cylinder": re.compile(r"/pens/skv-01\?view=cylinder$"), "flat": re.compile(r"/pens/skv-01\?view=flat$")}
    with console(browser, app_url, "/pens/skv-01?view=cylinder") as page:
        wait_ws(page)
        h0 = page.evaluate("() => history.length")
        for go, back, home, view in (("u", "w", "View: Cylinder", "cylinder"), ("w", "u", "View: Flat chart", "flat")):
            if view == "flat":
                page.keyboard.press("u")
                advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
                assert home in scene_lines(page)
            page.keyboard.press(go)
            advance(page, REVERSE_AFTER_MS)
            assert home not in scene_lines(page), "the run is under way"
            page.keyboard.press(back)
            advance(page, REVERSE_MIN_MS - 2 * FRAME_MS)
            assert home not in scene_lines(page), f"the reversed run takes at least 0.3 s: {scene_lines(page)}"
            expect(page).to_have_url(address[view])
            advance(page, REVERSE_MAX_MS - REVERSE_MIN_MS + 2 * FRAME_MS + SETTLE_PAD_MS)
            assert home in scene_lines(page), f"back in the starting view within 0.8 s: {scene_lines(page)}"
            expect(page).to_have_url(address[view])
        assert page.evaluate("() => history.length") == h0


def test_wf_first_open_unwrap_reload(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/") as page:
        wait_text(page, "open defects")
        click(page.get_by_role("link", name=f"Open pen {PEN_NAMES[0]}"))
        expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=cylinder$"))
        wait_ws(page)
        h0 = page.evaluate("() => history.length")
        page.keyboard.press("u")
        advance(page, UNWRAP_MIN_MS // 2)
        expect(page).to_have_url(re.compile(r"\?view=cylinder$"))
        advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
        expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=flat$"))
        expect(page.get_by_role("button", name=f"{D_HOLE}, hole")).to_contain_text("panel F3")
        click(page.get_by_role("button", name=f"{D_CHAFE}, chafe"))
        expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=flat&defect=D-0003$"))
        assert page.evaluate("() => history.length") == h0
        page.add_init_script(SAW_RUN_SCRIPT)
        page.reload()
        wait_ws(page)
        lines = scene_lines(page)
        assert "View: Flat chart" in lines and "Camera: flat chart" in lines and "Selected: D-0003" in lines
        assert page.evaluate("() => window.__sawRun") is False, "no unwrap played on load"
    assert pen(app_url, "skv-01")["grade"] == {"letter": "D", "label": "Repair before stocking"}


def test_workspace_address_canonical(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        gone = o.defect("skv-01", "chafe", 10, 3, SMALL_CHAFE)
        ok(api(app_url, "DELETE", f"/api/defects/{gone['id']}"))
        with console(browser, app_url, "/pens/skv-01?defect=D-9999&view=sideways") as page:
            page.add_init_script(SAW_RUN_SCRIPT)
            wait_ws(page)
            expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=cylinder$"))
            assert "Selected: none" in scene_lines(page)
            for q in (f"?defect={gone['id']}", "?defect=D-0007"):
                page.goto(app_url.rstrip("/") + "/pens/skv-01" + q)
                wait_ws(page)
                expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=cylinder$"))
                assert "Selected: none" in scene_lines(page)
            page.goto(app_url.rstrip("/") + "/pens/skv-01?defect=D-0002")
            wait_ws(page)
            lines = scene_lines(page)
            assert "Camera: 237°" in lines and "Selected: D-0002" in lines and "View: Cylinder" in lines
            expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=cylinder&defect=D-0002$"))
            assert page.evaluate("() => window.__sawRun") is False


def test_wf_pen_twin_input_keyboard(browser: Browser, app_url: str, valkey: Any) -> None:
    last = [d["id"] for d in pen(app_url, "skv-01")["defects"] if not d["removed"]][-1]
    try:
        with console(browser, app_url, "/pens/skv-01") as page:
            wait_ws(page)
            page.get_by_role("button", name="Mark defect").focus()
            for key, deg in (("ArrowRight", ORBIT_STEP_DEG), ("ArrowLeft", 0), ("ArrowLeft", 360 - ORBIT_STEP_DEG), ("ArrowRight", 0)):
                page.keyboard.press(key)
                advance(page, GLIDE_MAX_MS)
                assert cam_deg(page) == deg, (key, scene_lines(page))
            zoom_now = 1.0
            for key in ("+", "=", "-", "-", "-", "-", "-", "=", "="):
                zoom_now = min(ZOOM_MAX, max(ZOOM_MIN, zoom_now + (ZOOM_STEP if key in "+=" else -ZOOM_STEP)))
                page.keyboard.press(key)
                advance(page, GLIDE_MAX_MS)
                assert f"Zoom: {zoom_now:.2f}×" in scene_lines(page), (key, scene_lines(page))
            page.get_by_role("button", name=f"Pin {D_CHAFE}").focus()
            page.keyboard.press("n")
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            assert "Selected: D-0001" in scene_lines(page) and cam_deg(page) == facing(112.5)
            page.keyboard.press("n")
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            assert "Selected: D-0002" in scene_lines(page) and cam_deg(page) == 237
            page.keyboard.press("p")
            page.keyboard.press("p")
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            assert f"Selected: {last}" in scene_lines(page), "P wraps round to the last non-removed defect"
            page.keyboard.press("n")
            page.keyboard.press("n")
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            assert "Selected: D-0002" in scene_lines(page)

            ask = page.get_by_role("textbox", name="Ask the copilot")
            ask.focus()
            page.keyboard.press("u")
            page.keyboard.press("ArrowRight")
            advance(page, UNWRAP_MAX_MS)
            assert "View: Cylinder" in scene_lines(page) and cam_deg(page) == 237, "ignored while typing"
            fill(ask, "")

            page.get_by_role("button", name=f"Pin {D_TEAR}").focus()
            page.keyboard.press("?")
            dialog = page.get_by_role("dialog", name="Keyboard shortcuts")
            expect(dialog).to_be_visible()
            page.keyboard.press("ArrowRight")
            page.keyboard.press("u")
            advance(page, UNWRAP_MAX_MS)
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(dialog).to_have_count(0)
            advance(page, UNWRAP_MAX_MS)
            assert "View: Cylinder" in scene_lines(page) and cam_deg(page) == 237, "ignored while a dialog is open"

            page.get_by_role("button", name=f"Pin {D_TEAR}").focus()
            page.keyboard.press("m")
            expect(page.get_by_role("button", name="Mark defect")).to_have_attribute("aria-pressed", "true")
            assert "Marking: tap the net wall" in scene_lines(page)
            page.keyboard.press("Escape")
            expect(page.get_by_role("button", name="Mark defect")).to_have_attribute("aria-pressed", "false")

            page.get_by_role("button", name=f"Pin {D_TEAR}").focus()
            page.keyboard.press("e")
            editor = page.get_by_role("region", name="Defect editor")
            expect(editor.get_by_role("heading", name="Edit D-0002")).to_be_visible()
            advance(page, SETTLE_PAD_MS)
            wait_lock(page, valkey, "D-0002", "DEV-1")
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(editor.get_by_role("heading", name="Edit D-0002")).to_have_count(0)

            page.get_by_role("button", name="Mark defect").focus()
            page.keyboard.press("u")
            advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
            assert "View: Flat chart" in scene_lines(page)
            page.keyboard.press("ArrowRight")
            advance(page, GLIDE_MAX_MS)
            assert "Camera: flat chart" in scene_lines(page)
            page.keyboard.press("w")
            advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
            assert "View: Cylinder" in scene_lines(page)
    finally:
        api(app_url, "DELETE", "/api/defects/D-0002/lock", device=DEV1)


def test_editor_focus_returns(browser: Browser, app_url: str, valkey: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        did = d["id"]
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            row = page.get_by_role("button", name=f"{did}, chafe")
            heading = page.get_by_role("region", name="Defect editor").get_by_role("heading", name=f"Edit {did}")
            editor = open_editor(page, row, f"Edit {did}")
            wait_lock(page, valkey, did, DEV1)
            click(editor.get_by_role("button", name="Close editor"))
            advance(page, SLIDE_OUT_MS)
            expect(heading).to_have_count(0)
            expect(row).to_be_focused()
            wait_unlocked(page, valkey, did)

            click(row)
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            assert f"Selected: {did}" in scene_lines(page)
            pin = page.get_by_role("button", name=f"Pin {did}")
            pin.focus()
            page.keyboard.press("Enter")
            expect(heading).to_be_visible()
            wait_lock(page, valkey, did, DEV1)
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(heading).to_have_count(0)
            expect(pin).to_be_focused()
            wait_unlocked(page, valkey, did)

            editor = open_editor(page, row, f"Edit {did}")
            click(editor.get_by_role("button", name="Delete defect"))
            confirm = page.get_by_role("dialog", name="Delete defect")
            expect(confirm.get_by_role("button", name="Cancel")).to_be_focused()
            click(confirm.get_by_role("button", name="Delete"))
            placeholder = page.get_by_role("button", name=f"{did}, Defect removed")
            expect(placeholder).to_be_visible()
            advance(page, SLIDE_OUT_MS)
            expect(heading).to_have_count(0)
            expect(placeholder).to_be_focused()
            wait_unlocked(page, valkey, did)
        assert get_defect(app_url, did)["removed"] is True


def test_workspace_tab_order(browser: Browser, app_url: str) -> None:
    defects = pen(app_url, "skv-01")["defects"]
    live_ids = [d["id"] for d in defects if not d["removed"]]
    first_row = f"{defects[0]['id']}, {defects[0]['type']}"
    for size in ((1280, 800), (768, 1024)):
        with console(browser, app_url, "/pens/skv-01", size=size, touch=size != (1280, 800)) as page:
            wait_ws(page)
            stops = [("Mark defect", page.get_by_role("button", name="Mark defect"))]
            stops += [(f"Pin {i}", page.get_by_role("button", name=f"Pin {i}", exact=True)) for i in live_ids]
            stops += [("Ask the copilot", page.get_by_role("textbox", name="Ask the copilot")),
                      (first_row, page.get_by_role("button", name=first_row, exact=True))]
            page.get_by_role("button", name="Unwrap").focus()
            seen: list[str] = []
            for _ in range(len(live_ids) + TAB_SPAN):
                page.keyboard.press("Tab")
                seen += [name for name, loc in stops if loc.count() == 1 and loc.evaluate("el => el === document.activeElement")]
            assert seen[:len(stops)] == [name for name, _ in stops], (size, seen)


def test_wf_pen_twin_input_touch(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/pens/skv-01", size=(768, 1024), touch=True) as page:
        wait_ws(page)
        stage = box(page.get_by_role("img", name=twin(PEN_NAMES[0])))
        y = stage["y"] + stage["height"] * 0.7
        touch_path(page, [(stage["x"] + stage["width"] - 2, y)], [(stage["x"] + 2, y)])
        advance(page, GLIDE_MAX_MS)
        assert DRAG_DEG - DRAG_TOL <= cam_deg(page) <= DRAG_DEG + DRAG_TOL, scene_lines(page)
        tap(page.get_by_role("button", name=f"Pin {D_HYDROID}"))
        advance(page, FLY_MAX_MS)
        assert "Selected: D-0005" in scene_lines(page)
        cx, cy = stage["x"] + stage["width"] / 2, stage["y"] + stage["height"] * 0.6
        touch_path(page, [(cx - 30, cy), (cx + 30, cy)], [(cx - 140, cy), (cx + 140, cy)])
        advance(page, GLIDE_MAX_MS)
        zoom = float(re.fullmatch(r"Zoom: (\d\.\d\d)×", scene_line(page, "Zoom: ")).group(1))
        assert 1.0 < zoom <= 3.0, scene_lines(page)
        tap(page.get_by_role("button", name="Unwrap"))
        advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
        assert "View: Flat chart" in scene_lines(page)
        pin_before = box(page.get_by_role("button", name=f"Pin {D_HYDROID}"))
        touch_path(page, [(cx + 80, cy)], [(cx - 80, cy)])
        advance(page, GLIDE_MAX_MS)
        assert "Camera: flat chart" in scene_lines(page)
        assert box(page.get_by_role("button", name=f"Pin {D_HYDROID}"))["x"] != pin_before["x"], "one finger pans the flat chart"


def test_reduced_motion_end_states(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/pens/skv-01", reduced=True) as page:
        wait_ws(page)
        canvas = page.get_by_role("img", name=twin(PEN_NAMES[0]))
        advance(page, 1000)
        frames = scene_frames(canvas, steps=3, step_ms=1000)
        assert difference(decode(frames[0]["png"]), decode(frames[-1]["png"])) == 0, "ambient loops stop"
        click(page.get_by_role("button", name="Unwrap"))
        advance(page, FRAME_MS)
        assert "View: Flat chart" in scene_lines(page)
        expect(page.get_by_role("button", name="Wrap")).to_be_visible()
        expect(page).to_have_url(re.compile(r"view=flat"))
        page.keyboard.press("w")
        advance(page, FRAME_MS)
        assert "View: Cylinder" in scene_lines(page)
        page.keyboard.press("n")
        advance(page, FRAME_MS)
        assert "Selected: D-0001" in scene_lines(page) and cam_deg(page) == facing(112.5)
        page.keyboard.press("ArrowRight")
        advance(page, GLIDE_MAX_MS)
        assert cam_deg(page) == (facing(112.5) + ORBIT_STEP_DEG) % 360, "orbit still works"
        before = camera(page)
        b = box(canvas)
        page.mouse.move(b["x"] + b["width"] * 0.8, b["y"] + b["height"] * 0.7)
        page.mouse.down()
        for i in range(1, 9):
            advance(page, FRAME_MS)
            page.mouse.move(b["x"] + b["width"] * (0.8 - 0.06 * i), b["y"] + b["height"] * 0.7)
        page.mouse.up()
        advance(page, GLIDE_MAX_MS)
        assert camera(page) != before and cam_deg(page) != (facing(112.5) + ORBIT_STEP_DEG) % 360, "drag still orbits"


POS_CASES = {
    "negative_bearing": ({"bearing_deg": -10, "depth_m": 3}, (350.0, 3.0, 155.56, "P1")),
    "over_360": ({"bearing_deg": 365, "depth_m": 3}, (5.0, 3.0, 2.22, "A1")),
    "rounds_to_zero": ({"bearing_deg": 359.96, "depth_m": 3}, (0.0, 3.0, 0.0, "A1")),
    "wall_point_east": ({"wall_point": {"x_m": 1, "y_m": -5, "z_m": 0}}, (90.0, 5.0, 40.0, "E2")),
    "wall_point_south_bottom": ({"wall_point": {"x_m": 0, "y_m": -20, "z_m": -1}}, (180.0, 20.0, 80.0, "I4")),
    "panel_boundary": ({"bearing_deg": 22.5, "depth_m": 10}, (22.5, 10.0, 10.0, "B3")),
    "too_deep": ({"bearing_deg": 10, "depth_m": 20.1}, "depth_m"),
}


@pytest.mark.parametrize("case", list(POS_CASES.values()), ids=list(POS_CASES))
def test_server_position(app_url: str, case: tuple) -> None:
    position, want = case
    with owned(app_url) as o:
        body = {"type": "chafe", "size": SMALL_CHAFE, "note": "", "private_note": "", **position}
        r = api(app_url, "POST", "/api/pens/skv-02/defects", body=body)
        if isinstance(want, str):
            e = err(r, 422, "validation")
            assert want in e["fields"]
            return
        d = ok(r, 201)["defect"]
        o.ids.append(d["id"])
        stored = get_defect(app_url, d["id"])
        bearing, depth, cx, cell = want
        assert (float(stored["bearing_deg"]), float(stored["depth_m"]), float(stored["chart_x_m"]), float(stored["chart_y_m"]), stored["cell"]) == (bearing, depth, cx, depth, cell)
        moved = ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": stored["version"], "bearing_deg": 45, "depth_m": 7.5}))["defect"]
        assert (float(moved["chart_x_m"]), moved["cell"]) == (20.0, "C2")


def test_sizes_and_fouling_cover(app_url: str) -> None:
    with owned(app_url) as o:
        assert o.defect("skv-03", "hole", 200, 7, HOLE)["area_cm2"] == 565
        assert o.defect("skv-03", "hole", 200, 7, {"width_cm": 10, "height_cm": 10})["area_cm2"] == 79
        assert o.defect("skv-03", "tear", 200, 7, TEAR)["area_cm2"] == 135
        odd = {"length_cm": 45, "gap_cm": 5}
        assert o.defect("skv-03", "tear", 200, 7, odd)["area_cm2"] == math.floor(odd["length_cm"] * odd["gap_cm"] / 2 + 0.5)
        assert o.defect("skv-03", "tear", 200, 7, {"length_cm": 45, "gap_cm": 0})["area_cm2"] == 0
        chafe = o.defect("skv-03", "chafe", 200, 7, CHAFE)
        assert chafe["area_cm2"] == 1800 and chafe["patch_area_m2"] is None
        seam = o.defect("skv-03", "fouling", 0, 2.5, {"width_m": 4.0, "height_m": 2.0})
        assert float(seam["patch_area_m2"]) == 8.0 and seam["area_cm2"] is None
        top = o.defect("skv-03", "fouling", 15, 0.5, {"width_m": 2.0, "height_m": 3.0})
        assert float(top["patch_area_m2"]) == 4.0
        split = o.defect("skv-03", "fouling", 30, 10, {"width_m": 2.0, "height_m": 2.0})
        assert float(split["patch_area_m2"]) == 4.0
        cover = {x["cell"]: float(x["fouling_cover_pct"]) for x in pen(app_url, "skv-03")["panels"]}
        want = {"A1": 16.0, "L1": 8.0, "A2": 2.0, "B2": 2.0, "A3": 2.0, "B3": 2.0}
        assert {c: v for c, v in cover.items() if v} == want, cover
        o.defect("skv-03", "fouling", 15, 0.5, {"width_m": 2.0, "height_m": 3.0})
        p = pen(app_url, "skv-03")
        assert {x["cell"]: float(x["fouling_cover_pct"]) for x in p["panels"]}["A1"] == cover["A1"] + 8.0, "overlapping patches add up"
        huge = o.defect("skv-03", "fouling", 180, 7.5, {"width_m": 100.0, "height_m": 100.0})
        assert float(huge["patch_area_m2"]) == float(pen(app_url, "skv-03")["net_depth_m"]) * 100.0
        p = pen(app_url, "skv-03")
        assert max(float(x["fouling_cover_pct"]) for x in p["panels"]) == 100.0 == float(p["max_fouling_cover_pct"])
        for kind, size, field in (("fouling", {"width_m": 0.0, "height_m": 1.0}, "size.width_m"),
                                  ("hole", {"width_cm": 2001, "height_cm": 10}, "size.width_cm"),
                                  ("tear", {"length_cm": 10, "gap_cm": 201}, "size.gap_cm")):
            e = err(api(app_url, "POST", "/api/pens/skv-03/defects", body={"type": kind, "bearing_deg": 5, "depth_m": 1, "size": size, "note": "", "private_note": ""}), 422, "validation")
            assert field in e["fields"], e


def test_pen_grade_rule(browser: Browser, app_url: str) -> None:
    def g(reply: dict) -> tuple[str, int]:
        return reply["pen"]["grade"]["letter"], reply["pen"]["open_defects"]

    def add(o: Owned, kind: str, b: float, d: float, size: dict) -> tuple[str, tuple]:
        r = ok(api(app_url, "POST", "/api/pens/skv-03/defects", body={"type": kind, "bearing_deg": b, "depth_m": d, "size": size, "note": "", "private_note": ""}), 201)
        o.ids.append(r["defect"]["id"])
        return r["defect"]["id"], g(r)

    def drop(did: str) -> tuple:
        return g(ok(api(app_url, "DELETE", f"/api/defects/{did}")))

    with owned(app_url) as o:
        assert pen(app_url, "skv-03")["grade"]["letter"] == "A"
        f1, s = add(o, "fouling", 45, 7.5, {"width_m": 4.5, "height_m": 2.2})
        assert s == ("A", 1), "19.8% cover stays Sound"
        assert drop(f1) == ("A", 0)
        f2, s = add(o, "fouling", 45, 7.5, {"width_m": 5.0, "height_m": 2.0})
        assert s == ("B", 1), "20.0% cover is Monitor"
        drop(f2)
        f3, s = add(o, "fouling", 45, 7.5, {"width_m": 5.0, "height_m": 4.0})
        assert s == ("C", 1), "40.0% cover is Repair within 7 days"
        drop(f3)
        h1, s = add(o, "hole", 200, 7, {"width_cm": 20, "height_cm": 19})
        assert s == ("C", 1), "298 cm² hole"
        h2, s = add(o, "hole", 200, 7, {"width_cm": 20, "height_cm": 20})
        assert s == ("D", 2), "314 cm² hole"
        assert drop(h2) == ("C", 1)
        drop(h1)
        t1, s = add(o, "tear", 200, 7, {"length_cm": 49, "gap_cm": 1})
        assert s == ("C", 1)
        t2, s = add(o, "tear", 210, 7, {"length_cm": 50, "gap_cm": 1})
        assert s == ("D", 2)
        with console(browser, app_url, "/") as page:
            p = pen(app_url, "skv-03")
            expect(page.get_by_role("link", name="Skarvholmen 03", exact=True)).to_contain_text(grade_line(p))
        rep = ok(api(app_url, "POST", f"/api/defects/{t2}/repairs", body={"method": "patch", "note": ""}), 201)
        assert g(rep) == ("C", 1), "a repaired tear no longer counts"
        assert drop(t1) == ("A", 0)
        c1, s = add(o, "chafe", 200, 7, SMALL_CHAFE)
        assert s == ("B", 1)
        assert g(ok(api(app_url, "POST", f"/api/defects/{c1}/repairs", body={"method": "clean", "note": ""}), 201)) == ("A", 0)


def test_note_length_graphemes(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        for g in (FLAG, SKIN, FAMILY, ACCENT):
            d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE, note=g * NOTE_LIMIT, private_note=g * NOTE_LIMIT)
            assert d["note"] == g * NOTE_LIMIT and d["private_note"] == g * NOTE_LIMIT
            for field in ("note", "private_note"):
                body = {"type": "chafe", "bearing_deg": 300, "depth_m": 3, "size": SMALL_CHAFE, "note": "", "private_note": "", field: g * (NOTE_LIMIT + 1)}
                e = err(api(app_url, "POST", "/api/pens/skv-02/defects", body=body), 422, "validation")
                assert e["fields"][field] == "Note is longer than 500 characters"
        spaced_note = "  " + tag("sent") + "  "
        spaced = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE, note=spaced_note)
        assert get_defect(app_url, spaced["id"])["note"] == spaced_note
        target = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        e = err(api(app_url, "POST", f"/api/defects/{target['id']}/repairs", body={"method": "patch", "note": FLAG * (NOTE_LIMIT + 1)}), 422, "validation")
        assert "note" in e["fields"]
        assert get_defect(app_url, target["id"])["status"] == "open"
        ok(api(app_url, "POST", f"/api/defects/{target['id']}/repairs", body={"method": "patch", "note": FLAG * NOTE_LIMIT}), 201)
        q = tag("q")
        for question in (q + FLAG * (NOTE_LIMIT + 1 - len(q)), "   "):
            e = err(api(app_url, "POST", "/api/pens/skv-02/copilot", body={"question": question}), 422, "validation")
            assert "question" in e["fields"]
        assert not [r for r in wm_entries(wiremock, "/v1/chat/completions", "POST") if q in (r.get("body") or "")]

        ed = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE, note=FLAG * NOTE_LIMIT)
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            editor = open_editor(page, page.get_by_role("button", name=f"{ed['id']}, chafe"), f"Edit {ed['id']}")
            expect(editor).to_contain_text(f"{NOTE_LIMIT} / {NOTE_LIMIT}")
            expect(editor).to_contain_text(f"0 / {NOTE_LIMIT}")
            note = editor.get_by_role("textbox", name="Note", exact=True)
            note.focus()
            page.keyboard.press("End")
            page.keyboard.type("x")
            expect(editor).to_contain_text(f"{NOTE_LIMIT + 1} / {NOTE_LIMIT}")
            expect(editor).to_contain_text("Note is longer than 500 characters")
            expect(editor.get_by_role("button", name="Save")).to_be_enabled()
            page.keyboard.press("Escape")
        assert get_defect(app_url, ed["id"])["note"] == FLAG * NOTE_LIMIT


def test_stills_and_sonar_bytes(app_url: str) -> None:
    s3 = S3()
    with owned(app_url) as o:
        d = o.defect("skv-02", "hole", 300, 3, {"width_cm": 2, "height_cm": 2})
        for data in (png(), png(STILL_LIMIT)):
            still = ok(upload_still(app_url, d["id"], data), 201)["still"]
            sha = hashlib.sha256(data).hexdigest()
            assert (still["sha256"], still["size_bytes"], still["content_type"]) == (sha, len(data), "image/png")
            raw = api(app_url, "GET", f"/api/stills/{still['id']}/raw")
            assert raw.status_code == 200 and raw.content == data and raw.headers["X-Content-SHA256"] == sha
            assert raw.headers["content-type"].startswith("image/png")
            assert s3.get(f"farms/skarvholmen/stills/{still['id']}") == data
        n = len(get_defect(app_url, d["id"])["stills"])
        assert n == 2
        err(upload_still(app_url, d["id"], png(STILL_LIMIT + 1)), 413, "too_large")
        e = err(upload_still(app_url, d["id"], png(), ctype="text/plain"), 422, "validation")
        assert "content_type" in e["fields"]
        err(upload_still(app_url, d["id"], b""), 422, "validation")
        assert len(get_defect(app_url, d["id"])["stills"]) == n, "refused uploads attach nothing"

        dive = plan_dive(app_url, o, "skv-02", next_hour(app_url))
        err(api(app_url, "POST", f"/api/dives/{dive['id']}/sonar", content=b"ping", headers={"Content-Type": "application/octet-stream"}), 409, "dive_state")
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
        data = os.urandom(SONAR_LIMIT)
        cap = ok(api(app_url, "POST", f"/api/dives/{dive['id']}/sonar", content=data, headers={"Content-Type": "application/octet-stream", "X-Filename": "sweep.bin"}), 201)["capture"]
        sha = hashlib.sha256(data).hexdigest()
        assert (cap["sha256"], cap["size_bytes"], cap["file_name"]) == (sha, SONAR_LIMIT, "sweep.bin")
        raw = api(app_url, "GET", f"/api/sonar/{cap['id']}/raw")
        assert raw.content == data and raw.headers["X-Content-SHA256"] == sha
        assert s3.get(f"farms/skarvholmen/sonar/{cap['id']}") == data
        err(api(app_url, "POST", f"/api/dives/{dive['id']}/sonar", content=os.urandom(SONAR_LIMIT + 1)), 413, "too_large")
        assert len(ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["sonar"]) == 1


def test_wf_defect_marking_tap(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-03") as page:
        wait_ws(page)
        mark = page.get_by_role("button", name="Mark defect")
        click(mark)
        expect(mark).to_have_attribute("aria-pressed", "true")
        assert "Marking: tap the net wall" in scene_lines(page)
        b = box(page.get_by_role("img", name=twin(PEN_NAMES[2])))
        page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        editor = page.get_by_role("region", name="Defect editor")
        expect(editor.get_by_role("heading", name="New defect")).to_be_visible()
        expect(editor).to_contain_text("From the net wall")
        pick_type(editor.get_by_role("combobox", name="Type"), "hole")
        fill(editor.get_by_role("textbox", name="Width (cm)"), "30")
        fill(editor.get_by_role("textbox", name="Height (cm)"), "24")
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/pens/skv-03/defects")) as resp:
            click(editor.get_by_role("button", name="Save"))
        created = keep_created(o, resp.value)
        sent = json.loads(resp.value.request.post_data or "{}")
        assert "wall_point" in sent and "bearing_deg" not in sent, sent
        expect(page.get_by_role("status", name="Editor status")).to_contain_text(f"Saved {created['id']}")
        stored = get_defect(app_url, created["id"])
        assert stored["area_cm2"] == 565 and float(stored["depth_m"]) == round(-float(sent["wall_point"]["y_m"]), 1)
        expect(page.get_by_role("button", name=f"Pin {created['id']}")).to_be_visible()
        expect(page.get_by_role("button", name=f"{created['id']}, hole")).to_be_visible()
        expect(editor).to_contain_text(stored["cell"])
        expect(editor).to_contain_text("565")
        assert pen(app_url, "skv-03")["grade"]["letter"] == "D"


def test_wf_defect_marking_invalid_recovery(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-03") as page:
        wait_ws(page)
        before = {d["id"] for d in pen(app_url, "skv-03")["defects"]}
        page.keyboard.press("m")
        wait_line(page, "Marking: tap the net wall")
        advance(page, FRAME_MS * 2)
        b = box(page.get_by_role("img", name=twin(PEN_NAMES[2])))
        page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        editor = page.get_by_role("region", name="Defect editor")
        expect(editor.get_by_role("heading", name="New defect")).to_be_visible()
        pick_type(editor.get_by_role("combobox", name="Type"), "chafe")
        fill(editor.get_by_role("textbox", name="Bearing (°)"), TYPED_BEARING)
        fill(editor.get_by_role("textbox", name="Depth (m)"), TYPED_DEPTH_BAD)
        fill(editor.get_by_role("textbox", name="Length (cm)"), str(SMALL_CHAFE["length_cm"]))
        fill(editor.get_by_role("textbox", name="Width (cm)"), str(SMALL_CHAFE["width_cm"]))
        with page.expect_response(lambda r: r.request.method == "POST" and "/api/pens/skv-03/defects" in r.url) as bad:
            click(editor.get_by_role("button", name="Save"))
        keep_created(o, bad.value)
        assert bad.value.status == 422
        expect(page.get_by_role("status", name="Editor status")).not_to_contain_text("Saved")
        assert {d["id"] for d in pen(app_url, "skv-03")["defects"]} == before
        fill(editor.get_by_role("textbox", name="Depth (m)"), TYPED_DEPTH_OK)
        with page.expect_response(lambda r: r.request.method == "POST" and "/api/pens/skv-03/defects" in r.url) as good:
            click(editor.get_by_role("button", name="Save"))
        created = keep_created(o, good.value)
        expect(page.get_by_role("status", name="Editor status")).to_contain_text(f"Saved {created['id']}")
        stored = get_defect(app_url, created["id"])
        assert (float(stored["bearing_deg"]), float(stored["depth_m"]), stored["cell"]) == (
            float(TYPED_BEARING), float(TYPED_DEPTH_OK), expected_cell(pen(app_url, "skv-03"), float(TYPED_BEARING), float(TYPED_DEPTH_OK)))
        expect(editor).to_contain_text(stored["cell"])


def test_edits_reach_every_surface(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "tear", 300, 3, {"length_cm": 10, "gap_cm": 1}, note="before " + tag())
        link = create_link(app_url, "skv-02", DAY_S)
        base = app_url.rstrip("/")
        with console(browser, app_url, "/pens/skv-02?view=cylinder") as page:
            wait_ws(page)
            cyl0 = pin_mid(page, d["id"])
            page.goto(base + "/pens/skv-02?view=flat")
            wait_ws(page)
            row = page.get_by_role("button", name=f"{d['id']}, tear")
            expect(row).to_contain_text(f"panel {d['cell']}")
            flat0 = pin_mid(page, d["id"])
            patched = ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", device=DEV2, body={"version": d["version"], "bearing_deg": 30, "note": "after"}))["defect"]
            page.reload()
            wait_ws(page)
            expect(row).to_contain_text(f"panel {patched['cell']}")
            flat1 = pin_mid(page, d["id"])
            assert flat1[0] < flat0[0], "flat-chart pin moved to 13.33 m"
            page.goto(base + "/pens/skv-02?view=cylinder")
            wait_ws(page)
            assert pin_mid(page, d["id"]) != cyl0, "3D pin moved"
            pub = [x for x in ok(share(app_url, link["token"]))["defects"] if x["id"] == d["id"]][0]
            assert (float(pub["bearing_deg"]), pub["cell"], pub["note"]) == (30.0, "B1", "after")
            n = ok(api(app_url, "POST", "/api/pens/skv-02/reports"), 201)["revision"]["number"]
            packed = [x for x in json.loads(api(app_url, "GET", f"/api/pens/skv-02/reports/{n}/pack").content)["defects"] if x["id"] == d["id"]][0]
            assert (float(packed["bearing_deg"]), packed["cell"], packed["note"]) == (30.0, "B1", "after")
            ok(api(app_url, "DELETE", f"/api/defects/{d['id']}", device=DEV2))
            page.reload()
            wait_ws(page)
            expect(page.get_by_role("button", name=f"Pin {d['id']}")).to_have_count(0)
            expect(page.get_by_role("button", name=f"{d['id']}, Defect removed")).to_contain_text(f"{d['id']} Defect removed")
            pub = [x for x in ok(share(app_url, link["token"]))["defects"] if x["id"] == d["id"]][0]
            assert pub["removed"] is True and pub["label"] == "Defect removed"
            n2 = ok(api(app_url, "POST", "/api/pens/skv-02/reports"), 201)["revision"]["number"]
            packed = [x for x in json.loads(api(app_url, "GET", f"/api/pens/skv-02/reports/{n2}/pack").content)["defects"] if x["id"] == d["id"]][0]
            assert packed["removed"] is True and packed["label"] == "Defect removed"
        ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_history_and_placeholder(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "tear", 300, 3, TEAR, note="first")
        ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", device=DEV2, body={"version": 1, "size": {"length_cm": 60, "gap_cm": 6}}))
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            editor = open_editor(page, page.get_by_role("button", name=f"{d['id']}, tear"), f"Edit {d['id']}")
            hist = editor.get_by_role("list", name="History")
            expect(hist).to_contain_text("Deck tablet")
            expect(hist).to_contain_text("size.length_cm: 45 → 60")
            page.keyboard.press("Escape")
        api(app_url, "DELETE", f"/api/defects/{d['id']}/lock", device=DEV1)
        ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 2, "note": "second"}))
        ok(api(app_url, "POST", f"/api/defects/{d['id']}/repairs", body={"method": "lace", "note": "laced"}), 201)
        still = ok(upload_still(app_url, d["id"], png()), 201)["still"]
        ok(api(app_url, "DELETE", f"/api/defects/{d['id']}", device=DEV2))
        h = history(app_url, d["id"])
        assert [e["action"] for e in h] == ["created", "updated", "updated", "repaired", "still_attached", "removed"]
        created = h[0]
        assert (created["device_id"], created["device_name"], created["detail"]) == ("DEV-1", "Topside laptop", "new defect")
        assert {"bearing_deg", "depth_m", "chart_x_m", "chart_y_m", "cell", "size.length_cm", "size.gap_cm", "note", "private_note", "status"} <= set(created["changes"])
        assert all(v["before"] is None for v in created["changes"].values())
        assert (h[1]["device_name"], h[1]["changes"]) == ("Deck tablet", {"size.length_cm": {"before": 45, "after": 60}})
        assert h[2]["changes"] == {"note": {"before": "first", "after": "second"}}
        assert (h[3]["changes"], h[3]["detail"]) == ({"status": {"before": "open", "after": "repaired"}}, "lace")
        assert (h[4]["changes"], h[4]["detail"]) == ({}, still["id"])
        assert (h[5]["device_name"], h[5]["changes"], h[5]["detail"]) == ("Deck tablet", {}, "")
        ph = get_defect(app_url, d["id"])
        assert (ph["id"], ph["pen_id"], ph["removed"], ph["label"]) == (d["id"], "skv-02", True, "Defect removed")
        assert [x for x in pen(app_url, "skv-02")["defects"] if x["id"] == d["id"]][0]["removed"] is True
        err(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 9, "note": "x"}), 409, "defect_removed")
        err(api(app_url, "POST", f"/api/defects/{d['id']}/repairs", body={"method": "patch", "note": ""}), 409, "defect_removed")
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            expect(page.get_by_role("button", name=f"{d['id']}, Defect removed")).to_contain_text(f"{d['id']} Defect removed")
            expect(page.get_by_role("button", name=f"Pin {d['id']}")).to_have_count(0)


def test_wf_cross_device_live_edit(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-02") as page:
        wait_ws(page)
        page.evaluate("() => { window.__stayed = true; }")
        seeded = page.get_by_role("button", name=f"{D_BRIDLE}, chafe")
        click(seeded)
        advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
        page.keyboard.press("ArrowRight")
        advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
        cam = scene_line(page, "Camera: ")
        updates = page.get_by_role("status", name="Console updates")

        def kept() -> None:
            assert scene_line(page, "Camera: ") == cam, "camera kept"
            assert f"Selected: {D_BRIDLE}" in scene_lines(page), "selection kept"
            expect(seeded).to_be_focused()

        d = o.defect("skv-02", "chafe", 100, 3, SMALL_CHAFE, device=DEV2)
        expect(updates).to_contain_text(f"Deck tablet marked {d['id']}", timeout=STREAM_CONNECT_MS)
        pin = page.get_by_role("button", name=f"Pin {d['id']}")
        expect(pin).to_be_visible()
        before = box(pin)
        start = time.monotonic()
        ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", device=DEV2, body={"version": d["version"], "bearing_deg": 120, "depth_m": 6}))
        expect(updates).to_contain_text(f"Deck tablet updated {d['id']}", timeout=LIVE_MS)
        moved = False
        while time.monotonic() - start < LIVE_MS / 1000:
            advance(page, 50)
            if pin.bounding_box() and pin.bounding_box() != before:
                moved = True
                break
        assert moved, "pin moved in place within 3 s"
        kept()
        ok(api(app_url, "POST", f"/api/defects/{d['id']}/repairs", device=DEV2, body={"method": "patch", "note": "patched"}), 201)
        live_text(page, updates, f"Deck tablet recorded a repair on {d['id']}", LIVE_MS)
        live_text(page, page.get_by_role("button", name=f"{d['id']}, chafe"), "Repaired", LIVE_MS)
        kept()
        ok(api(app_url, "DELETE", f"/api/defects/{d['id']}", device=DEV2))
        expect(updates).to_contain_text(f"Deck tablet removed {d['id']}", timeout=LIVE_MS)
        expect(page.get_by_role("button", name=f"{d['id']}, Defect removed")).to_be_visible(timeout=LIVE_MS)
        kept()
        assert page.evaluate("() => window.__stayed === true"), "no reload"


@pytest.mark.timeout(240)
def test_edit_locks(browser: Browser, app_url: str, valkey: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        did = d["id"]
        lock = ok(api(app_url, "POST", f"/api/defects/{did}/lock", device=DEV2))["lock"]
        assert lock == {"device_id": "DEV-2", "device_name": "Deck tablet", "expires_in_s": LOCK_TTL_S}
        assert lock_value(valkey, did) == "DEV-2" and 0 < valkey.ttl(f"pensight:lock:defect:{did}") <= LOCK_TTL_S
        for r in (api(app_url, "PATCH", f"/api/defects/{did}", body={"version": 1, "note": "x"}),
                  api(app_url, "DELETE", f"/api/defects/{did}"),
                  api(app_url, "POST", f"/api/defects/{did}/repairs", body={"method": "patch", "note": ""}),
                  upload_still(app_url, did, png()),
                  api(app_url, "POST", f"/api/defects/{did}/lock"),
                  api(app_url, "DELETE", f"/api/defects/{did}/lock")):
            e = err(r, 423, "locked")
            assert (e["details"]["device_id"], e["details"]["device_name"]) == ("DEV-2", "Deck tablet")
        cur = get_defect(app_url, did)
        assert (cur["version"], cur["status"], cur["note"], cur["stills"]) == (1, "open", "", [])
        assert cur["lock"]["device_id"] == "DEV-2"
        deadline = time.monotonic() + 15
        while valkey.ttl(f"pensight:lock:defect:{did}") > LOCK_TTL_S - 3:
            poll_gap()
            if time.monotonic() > deadline:
                pytest.fail("lock TTL never decreased in Valkey")
        ok(api(app_url, "POST", f"/api/defects/{did}/lock", device=DEV2))
        assert valkey.ttl(f"pensight:lock:defect:{did}") >= LOCK_TTL_S - 1, "holder refresh resets the TTL"
        assert api(app_url, "DELETE", f"/api/defects/{did}/lock", device=DEV2).status_code == 204
        assert lock_value(valkey, did) is None and get_defect(app_url, did)["lock"] is None
        ok(api(app_url, "PATCH", f"/api/defects/{did}", body={"version": 1, "note": "free"}))

        res = race(lambda: api(app_url, "POST", f"/api/defects/{did}/lock", device=DEV1), lambda: api(app_url, "POST", f"/api/defects/{did}/lock", device=DEV2))
        assert sorted(r.status_code for r in res) == [200, 423]
        for dev in (DEV1, DEV2):
            api(app_url, "DELETE", f"/api/defects/{did}/lock", device=dev)

        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            open_editor(page, page.get_by_role("button", name=f"{did}, chafe"), f"Edit {did}")
            wait_lock(page, valkey, did, "DEV-1")
            deadline = time.monotonic() + 15
            while valkey.ttl(f"pensight:lock:defect:{did}") > LOCK_TTL_S - 4:
                poll_gap()
                if time.monotonic() > deadline:
                    pytest.fail("editor lock TTL never decreased")
            advance(page, LOCK_REFRESH_MS)
            deadline = time.monotonic() + 10
            while valkey.ttl(f"pensight:lock:defect:{did}") < LOCK_TTL_S - 2:
                advance(page, 100)
                if time.monotonic() > deadline:
                    pytest.fail("open editor did not refresh its lock every 10 seconds")
            click(page.get_by_role("button", name="Close editor"))
            deadline = time.monotonic() + 10
            while lock_value(valkey, did) is not None:
                advance(page, 100)
                if time.monotonic() > deadline:
                    pytest.fail("closing the editor did not release the lock")

        ok(api(app_url, "POST", f"/api/defects/{did}/lock", device=DEV2))
        deadline = time.monotonic() + LOCK_TTL_S + 10
        while lock_value(valkey, did) is not None:
            poll_gap()
            if time.monotonic() > deadline:
                pytest.fail("lock did not expire 30 s after its last take")
        ok(api(app_url, "PATCH", f"/api/defects/{did}", body={"version": get_defect(app_url, did)["version"], "note": "after expiry"}))


@pytest.mark.timeout(240)
def test_lock_lost_keeps_unsaved_input(browser: Browser, app_url: str, valkey: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE, note=FIRST_NOTE)
        did = d["id"]
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            editor = open_editor(page, page.get_by_role("button", name=f"{did}, chafe"), f"Edit {did}")
            wait_lock(page, valkey, did, DEV1)
            note = editor.get_by_role("textbox", name="Note", exact=True)
            fill(note, SECOND_NOTE)
            deadline = time.monotonic() + LOCK_TTL_S + 10
            while lock_value(valkey, did) is not None:
                poll_gap()
                if time.monotonic() > deadline:
                    pytest.fail("the lock did not lapse 30 s after it was taken")
            ok(api(app_url, "POST", f"/api/defects/{did}/lock", device=DEV2))
            ok(api(app_url, "PATCH", f"/api/defects/{did}", device=DEV2, body={"version": d["version"], "note": REMOTE_NOTE}))
            live_text(page, page.get_by_role("status", name="Console updates"), f"Deck tablet updated {did}", LIVE_MS)
            expect(note).to_have_value(SECOND_NOTE)
            advance(page, LOCK_REFRESH_MS)
            live_text(page, page.get_by_role("status", name="Editor status"), "Your edit lock expired — reopen the editor to continue", LIVE_MS)
            expect(note).to_have_value(SECOND_NOTE)
        assert lock_value(valkey, did) == DEV2 and get_defect(app_url, did)["note"] == REMOTE_NOTE


@pytest.mark.timeout(240)
def test_presence_and_lock_indicator(browser: Browser, app_url: str, valkey: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        with console(browser, app_url, "/devices?device=DEV-2") as tab:
            wait_text(tab, "This browser is Deck tablet")
            deadline = time.monotonic() + 10
            while not valkey.keys("pensight:heartbeat:DEV-2"):
                advance(tab, 100)
                if time.monotonic() > deadline:
                    pytest.fail("no heartbeat key pensight:heartbeat:DEV-2 after opening")
            assert 0 < valkey.ttl("pensight:heartbeat:DEV-2") <= HEARTBEAT_TTL_S
            with console(browser, app_url, "/devices") as lap:
                until(lap, "() => document.body.innerText.includes('Deck tablet — Online')", None, 12)
                assert [x["online"] for x in ok(api(app_url, "GET", "/api/devices"))["devices"] if x["id"] == "DEV-2"] == [True]
        with console(browser, app_url, "/pens/skv-02") as lap:
            wait_ws(lap)
            defects = lap.get_by_role("region", name="Defects")
            ok(api(app_url, "POST", f"/api/defects/{d['id']}/lock", device=DEV2))
            expect(defects).to_contain_text("Being edited on Deck tablet", timeout=STREAM_CONNECT_MS)
            assert api(app_url, "DELETE", f"/api/defects/{d['id']}/lock", device=DEV2).status_code == 204
            expect(defects).not_to_contain_text("Being edited on Deck tablet", timeout=LIVE_MS)
            ok(api(app_url, "POST", f"/api/defects/{d['id']}/lock", device=DEV2))
            expect(defects).to_contain_text("Being edited on Deck tablet", timeout=LIVE_MS)
            api(app_url, "DELETE", f"/api/defects/{d['id']}/lock", device=DEV2)
            lap.goto(app_url.rstrip("/") + "/devices")
            until(lap, "() => document.body.innerText.includes('Deck tablet — Offline')", None, 45)
        assert [x["online"] for x in ok(api(app_url, "GET", "/api/devices"))["devices"] if x["id"] == "DEV-2"] == [False]


def test_editor_survives_earlier_timers(browser: Browser, app_url: str, valkey: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        did = d["id"]
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            row = page.get_by_role("button", name=f"{did}, chafe")
            editor = open_editor(page, row, f"Edit {did}")
            click(editor.get_by_role("button", name="Close editor"))
            advance(page, FRAME_MS * 3)
            row.focus()
            page.keyboard.press("e")
            advance(page, TOAST_WAIT_MS)
            heading = editor.get_by_role("heading", name=f"Edit {did}")
            expect(heading).to_be_visible()
            hb = box(heading)
            assert 0 <= hb["x"] < page.viewport_size["width"], "reopened editor is on screen"
            wait_lock(page, valkey, did, "DEV-1")
            click(editor.get_by_role("button", name="Close editor"))
            deadline = time.monotonic() + 10
            while lock_value(valkey, did) is not None:
                advance(page, 100)
                if time.monotonic() > deadline:
                    pytest.fail("lock not released on close")
            advance(page, LOCK_REFRESH_MS * 2)
            assert lock_value(valkey, did) is None, "a released lock is never refreshed"

            editor = open_editor(page, row, f"Edit {did}")
            fill(editor.get_by_role("textbox", name="Note", exact=True), FIRST_NOTE)
            click(editor.get_by_role("button", name="Save"))
            status = page.get_by_role("status", name="Editor status")
            expect(status).to_contain_text(f"Saved {did}")
            click(editor.get_by_role("button", name="Close editor"))
            advance(page, FRAME_MS * 3)
            row.focus()
            page.keyboard.press("e")
            expect(editor.get_by_role("heading", name=f"Edit {did}")).to_be_visible()
            with held(page, f"**/api/defects/{did}") as hold:
                fill(editor.get_by_role("textbox", name="Note", exact=True), SECOND_NOTE)
                click(editor.get_by_role("button", name="Save"))
                expect(status).to_have_text("Saving…")
                advance(page, TOAST_WAIT_MS)
                expect(status).to_have_text("Saving…")
                expect(editor.get_by_role("heading", name=f"Edit {did}")).to_be_visible()
                hold.release()
            expect(status).to_contain_text(f"Saved {did}")
            page.keyboard.press("Escape")
        assert get_defect(app_url, did)["note"] == SECOND_NOTE


@pytest.mark.timeout(300)
def test_wf_cross_device_simultaneous_writes(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "tear", 5, 3, {"length_cm": 10, "gap_cm": 1})
        did = d["id"]
        with console(browser, app_url, "/pens/skv-02?view=flat") as page:
            wait_ws(page)
            bearings = [5 + 30 * i for i in range(1, 6)]
            res = race(*[(lambda b=b: api(app_url, "PATCH", f"/api/defects/{did}", device=DEV2, body={"version": 1, "bearing_deg": b})) for b in bearings])
            wins = [i for i, r in enumerate(res) if r.status_code == 200]
            assert len(wins) == 1, [r.status_code for r in res]
            for r in res:
                if r.status_code != 200:
                    err(r, 409, "version_conflict")
            stored = get_defect(app_url, did)
            winner_cell = res[wins[0]].json()["defect"]["cell"]
            assert stored["version"] == 2 and float(stored["bearing_deg"]) == float(bearings[wins[0]]) and stored["cell"] == winner_cell
            assert [e["action"] for e in history(app_url, did)].count("updated") == 1
            expect(page.get_by_role("button", name=f"{did}, tear")).to_contain_text(f"panel {winner_cell}", timeout=STREAM_CONNECT_MS)
            expect(page.get_by_role("status", name="Console updates")).to_contain_text(f"Deck tablet updated {did}")

        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply("ok", [("call_p", "propose_repair", {"defect_id": did, "method": "patch", "note": "patch it"})]))
        proposal = ok(api(app_url, "POST", "/api/pens/skv-02/copilot", body={"question": "fix " + tag()}))["answer"]["proposals"][0]
        res = race(lambda: api(app_url, "POST", f"/api/defects/{did}/repairs", device=DEV1, body={"method": "lace", "note": ""}),
                   lambda: api(app_url, "POST", f"/api/defects/{did}/repairs", device=DEV2, body={"method": "lace", "note": ""}),
                   lambda: api(app_url, "POST", f"/api/proposals/{proposal['id']}/apply", device=DEV2))
        good = [r for r in res if r.status_code in (200, 201)]
        assert len(good) == 1, [r.status_code for r in res]
        for r in res:
            if r not in good:
                err(r, 409, "already_repaired")
        assert len(get_defect(app_url, did)["repairs"]) == 1

        d2 = o.defect("skv-02", "tear", 100, 3, {"length_cm": 10, "gap_cm": 1})
        patch, delete = race(lambda: api(app_url, "PATCH", f"/api/defects/{d2['id']}", device=DEV1, body={"version": 1, "note": "late"}),
                             lambda: api(app_url, "DELETE", f"/api/defects/{d2['id']}", device=DEV2))
        ok(delete)
        assert patch.status_code == 200 or patch.json()["error"]["code"] == "defect_removed", patch.text
        assert get_defect(app_url, d2["id"])["removed"] is True
        acts = [e["action"] for e in history(app_url, d2["id"])]
        assert acts[-1] == "removed" and acts.count("removed") == 1

        d3 = o.defect("skv-02", "tear", 150, 3, {"length_cm": 10, "gap_cm": 1})
        res = race(lambda: api(app_url, "DELETE", f"/api/defects/{d3['id']}", device=DEV1), lambda: api(app_url, "DELETE", f"/api/defects/{d3['id']}", device=DEV2))
        assert sorted(r.status_code for r in res) == [200, 409]
        err([r for r in res if r.status_code == 409][0], 409, "defect_removed")


def test_dive_planning_and_forecast_request(app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        start = next_hour(app_url)
        for minutes, last in ((90, 1), (60, 0)):
            dive = plan_dive(app_url, o, "skv-02", start, minutes)
            ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
            want_start = start.strftime("%Y-%m-%dT%H:00")
            want_end = (start + timedelta(hours=last)).strftime("%Y-%m-%dT%H:00")
            hits = [r for r in wm_entries(wiremock, "/v1/marine", "GET") if wm_query(r).get("start_hour") == want_start and wm_query(r).get("end_hour") == want_end]
            assert hits, f"no /v1/marine call with start_hour={want_start} end_hour={want_end}"
            q = wm_query(hits[0])
            assert (q["latitude"], q["longitude"], q["hourly"]) == ("63.4512", "8.7321", "ocean_current_velocity,wave_height")
            assert "Authorization".lower() not in wm_headers(hits[0])
        now = server_now(app_url)
        bad = [
            ({"planned_start": start.strftime("%Y-%m-%d %H:%M")}, "planned_start"),
            ({"planned_start": iso(now - timedelta(hours=2))}, "planned_start"),
            ({"planned_start": iso(now + timedelta(hours=49))}, "planned_start"),
            ({"planned_minutes": MIN_MINUTES - 1}, "planned_minutes"),
            ({"planned_minutes": MAX_MINUTES + 1}, "planned_minutes"),
            ({"planned_minutes": 90.5}, "planned_minutes"),
            ({"diver_certificate_no": "   "}, "diver_certificate_no"),
            ({"diver_certificate_no": "C" * (CERT_MAX + 1)}, "diver_certificate_no"),
            ({"pen_id": "no-such-pen"}, "pen_id"),
        ]
        for change, field in bad:
            body = {"pen_id": "skv-02", "planned_start": iso(start), "planned_minutes": 90, "diver_certificate_no": "NO-1", **change}
            e = err(api(app_url, "POST", "/api/dives", body=body), 422, "validation")
            assert field in e["fields"], (change, e)
        for change in ({"planned_minutes": MIN_MINUTES}, {"planned_minutes": MAX_MINUTES}, {"diver_certificate_no": "C" * CERT_MAX},
                       {"planned_start": iso(start + timedelta(hours=46))}):
            body = {"pen_id": "skv-02", "planned_start": iso(start), "planned_minutes": 90, "diver_certificate_no": "NO-1", **change}
            ok(api(app_url, "POST", "/api/dives", body=body), 201)


CLEAR_CASES = {
    "go": (-60, [9.99, 0.22, 0.25, 0.3, 9.99], [9.9, 0.6, 0.7, 0.8, 9.9], ("GO", None)),
    "limits_allowed": (-60, [0.2, 0.50, 0.50, 0.2, 0.2], [0.6, 1.5, 1.5, 0.6, 0.6], ("GO", None)),
    "current_over": (-60, [0.2, 0.3, 0.51, 0.2, 0.2], [0.6, 0.6, 0.6, 0.6, 0.6], ("NO-GO", "current 0.51 m/s at {h1}")),
    "wave_over": (-60, [0.2, 0.3, 0.3, 0.2, 0.2], [0.6, 1.6, 0.6, 0.6, 0.6], ("NO-GO", "wave height 1.60 m at {h0}")),
    "current_before_wave": (-60, [0.2, 0.6, 0.3, 0.2, 0.2], [0.6, 1.7, 0.6, 0.6, 0.6], ("NO-GO", "current 0.60 m/s at {h0}")),
    "first_hour_wins": (-60, [0.2, 0.3, 0.9, 0.2, 0.2], [0.6, 1.8, 0.6, 0.6, 0.6], ("NO-GO", "wave height 1.80 m at {h0}")),
    "stale": (-365, [0.2, 0.3, 0.3, 0.2, 0.2], [0.6, 0.6, 0.6, 0.6, 0.6], ("Forecast stale", None)),
    "almost_stale": (-355, [0.2, 0.3, 0.3, 0.2, 0.2], [0.6, 0.6, 0.6, 0.6, 0.6], ("GO", None)),
}


@pytest.mark.parametrize("case", list(CLEAR_CASES.values()), ids=list(CLEAR_CASES))
def test_clearance_rules(app_url: str, wiremock: Any, case: tuple) -> None:
    issued_min, currents, waves, (result, nogo) = case
    with owned(app_url) as o:
        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        issued = now + timedelta(minutes=issued_min)
        wiremock.stub("GET", "/v1/marine", json=marine_body(issued, start - timedelta(hours=1), currents, waves))
        dive = plan_dive(app_url, o, "skv-02", start, 90)
        c = ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))["dive"]
        assert c["status"] == "cleared" and c["clearance"]["result"] == result, c["clearance"]
        msg = c["clearance"]["message"]
        if result == "GO":
            assert msg == "GO — every planned hour is within limits"
            assert [h["within_limits"] for h in c["clearance"]["hours"]] == [True, True]
        elif result == "NO-GO":
            hh = {"h0": start.strftime("%H:%M UTC"), "h1": (start + timedelta(hours=1)).strftime("%H:%M UTC")}
            assert msg == "NO-GO — " + nogo.format(**hh)
        else:
            assert msg == f"Forecast stale — issued {issued.strftime('%H:%M')} UTC {issued.strftime('%Y-%m-%d')}, more than 6 hours ago"
        assert [parse_ts(h["time"]) for h in c["clearance"]["hours"]] == [start, start + timedelta(hours=1)]


@pytest.mark.timeout(240)
def test_start_needs_fresh_go(app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        dive = plan_dive(app_url, o, "skv-03", start)
        e = err(api(app_url, "POST", f"/api/dives/{dive['id']}/start"), 409, "dive_not_cleared")
        assert e["message"] == "Dive needs a fresh GO before it can start"
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=1), start - timedelta(hours=1), [0.2, 0.9, 0.2, 0.2], [0.6, 0.6, 0.6, 0.6]))
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
        err(api(app_url, "POST", f"/api/dives/{dive['id']}/start"), 409, "dive_not_cleared")
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=1), start - timedelta(hours=1), [0.2, 0.2, 0.2, 0.2], [0.6, 0.6, 0.6, 0.6]))
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
        started = ok(api(app_url, "POST", f"/api/dives/{dive['id']}/start"))["dive"]
        assert started["status"] == "started" and started["started_at"]
        assert err(api(app_url, "POST", f"/api/dives/{dive['id']}/start"), 409, "dive_state")["message"] == "Dive has already started"
        err(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"), 409, "dive_state")
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/finish", body={"track": [{"t_s": 0, "bearing_deg": 0.0, "depth_m": 1.0}]}))
        assert err(api(app_url, "POST", f"/api/dives/{dive['id']}/start"), 409, "dive_state")["message"] == "Dive is already recorded"
        err(api(app_url, "POST", f"/api/dives/{dive['id']}/finish", body={"track": [{"t_s": 0, "bearing_deg": 0.0, "depth_m": 1.0}]}), 409, "dive_state")

        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        dive2 = plan_dive(app_url, o, "skv-03", start)
        err(api(app_url, "POST", f"/api/dives/{dive2['id']}/finish", body={"track": [{"t_s": 0, "bearing_deg": 0.0, "depth_m": 1.0}]}), 409, "dive_state")
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=STALE_H) + timedelta(seconds=8), start - timedelta(hours=1), [0.2] * 4, [0.6] * 4))
        assert ok(api(app_url, "POST", f"/api/dives/{dive2['id']}/clearance"))["dive"]["clearance"]["result"] == "GO"
        deadline = time.monotonic() + 40
        while ok(api(app_url, "GET", f"/api/dives/{dive2['id']}"))["dive"]["clearance"]["result"] != "Forecast stale":
            if time.monotonic() > deadline:
                pytest.fail("a GO older than 6 hours did not read 'Forecast stale' on the server clock")
            poll_gap()
        err(api(app_url, "POST", f"/api/dives/{dive2['id']}/start"), 409, "dive_not_cleared")
        assert ok(api(app_url, "GET", "/api/dives/DIVE-0001"))["dive"]["clearance"]["result"] == "GO"


def test_clearance_shown_as_server_decided(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        go = plan_dive(app_url, o, "skv-02", start)
        ok(api(app_url, "POST", f"/api/dives/{go['id']}/clearance"))
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=7), start - timedelta(hours=1), [0.2] * 4, [0.6] * 4))
        stale = plan_dive(app_url, o, "skv-02", start)
        ok(api(app_url, "POST", f"/api/dives/{stale['id']}/clearance"))
        link = create_link(app_url, "skv-02", DAY_S)
        with console(browser, app_url, "/dives") as page:
            page.clock.set_system_time(now + timedelta(days=3))
            page.reload()
            click(page.get_by_role("button", name=f"{go['id']}, Skarvholmen 02"))
            expect(page.get_by_role("status", name="Clearance status")).to_contain_text("GO — every planned hour is within limits")
            expect(page.get_by_role("status", name="Dive status")).to_have_text("Dive status: cleared")
            page.clock.set_system_time(now - timedelta(hours=7))
            page.reload()
            click(page.get_by_role("button", name=f"{stale['id']}, Skarvholmen 02"))
            expect(page.get_by_role("status", name="Clearance status")).to_contain_text("Forecast stale — issued")
            page.clock.set_system_time(now + timedelta(days=3))
            before = ok(api(app_url, "GET", "/api/pens/skv-02/links"))
            page.goto(app_url.rstrip("/") + "/reports")
            select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
            exp = parse_ts(link["expires_at"])
            region = page.get_by_role("region", name="Report links")
            prefix = f"Active — expires {exp.strftime('%Y-%m-%d')} {exp.strftime('%H:%M')} UTC (in "
            expect(region).to_contain_text(prefix)
            after = ok(api(app_url, "GET", "/api/pens/skv-02/links"))
            e1 = [x for x in before["links"] if x["id"] == link["id"]][0]["expires_in_s"]
            e2 = [x for x in after["links"] if x["id"] == link["id"]][0]["expires_in_s"]
            allowed = {f"{prefix}{e // 3600} h {e % 3600 // 60} min)" for e in range(e2, e1 + 1)}
            assert any(a in region.inner_text() for a in allowed), (allowed, region.inner_text())
        ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


@pytest.mark.timeout(240)
def test_dive_clock_and_refresh_from_server(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=1), start - timedelta(hours=1), [0.2] * 4, [0.6] * 4))
        running = plan_dive(app_url, o, "skv-03", start)
        ok(api(app_url, "POST", f"/api/dives/{running['id']}/clearance"))
        ok(api(app_url, "POST", f"/api/dives/{running['id']}/start"))
        issued = server_now(app_url) - timedelta(hours=STALE_H) + timedelta(seconds=STALE_LEAD_S)
        wiremock.stub("GET", "/v1/marine", json=marine_body(issued, start - timedelta(hours=1), [0.2] * 4, [0.6] * 4))
        aging = plan_dive(app_url, o, "skv-02", start)
        assert ok(api(app_url, "POST", f"/api/dives/{aging['id']}/clearance"))["dive"]["clearance"]["result"] == "GO"
        with console(browser, app_url, "/dives", reduced=True) as page:
            page.clock.set_system_time(now + timedelta(hours=CLOCK_SKEW_H))
            page.reload()
            click(page.get_by_role("button", name=f"{running['id']}, Skarvholmen 03"))
            clock = page.get_by_role("timer", name="Dive clock")
            expect(clock).to_have_text(re.compile(r"^\d\d:\d\d:\d\d$"))
            shown = hms(clock.inner_text())
            elapsed = ok(api(app_url, "GET", f"/api/dives/{running['id']}"))["dive"]["elapsed_s"]
            assert abs(elapsed - shown) <= CLOCK_TOL_S, (clock.inner_text(), elapsed)
            advance(page, 3000)
            assert 2 <= hms(clock.inner_text()) - shown <= 4, "the dive clock counts up with the browser's elapsed time"
            click(page.get_by_role("button", name=f"{aging['id']}, Skarvholmen 02"))
            clearance = page.get_by_role("status", name="Clearance status")
            expect(clearance).to_contain_text("GO — every planned hour is within limits")
            deadline = time.monotonic() + STALE_LEAD_S + 30
            while ok(api(app_url, "GET", f"/api/dives/{aging['id']}"))["dive"]["clearance"]["result"] != "Forecast stale":
                if time.monotonic() > deadline:
                    pytest.fail("the GO never turned stale on the server clock")
            advance(page, DIVES_REFRESH_MS + SETTLE_PAD_MS)
            live_text(page, clearance, "Forecast stale — issued", LIVE_MS)


@pytest.mark.timeout(300)
def test_forecast_outage_and_newest(app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        first = start - timedelta(hours=1)
        nulls = marine_body(now - timedelta(hours=1), first, [0.2, None, 0.2, 0.2], [0.6, 0.6, 0.6, 0.6])
        missing = marine_body(now - timedelta(hours=1), first, [0.2], [0.6])
        stubs: list[tuple[Callable[[], Any], int]] = [
            (lambda: wiremock.stub("GET", "/v1/marine", status=500, json={"error": "down"}), 502),
            (lambda: wiremock.stub("GET", "/v1/marine", body="not a forecast"), 502),
            (lambda: wiremock.stub("GET", "/v1/marine", json=missing), 502),
            (lambda: wiremock.stub("GET", "/v1/marine", json=nulls), 502),
            (lambda: wiremock.fault("GET", "/v1/marine"), 502),
            (lambda: wiremock.stub("GET", "/v1/marine", json=marine_body(now, first, [0.2] * 4, [0.6] * 4), delay_ms=FORECAST_TIMEOUT_S * 1000 + PROVIDER_SLOW_PAD_MS), 504),
        ]
        for install, status in stubs:
            install()
            dive = plan_dive(app_url, o, "skv-02", start)
            e = err(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"), status, "forecast_unavailable")
            assert e["message"] == "Forecast unavailable — try again shortly"
            assert ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["clearance"]["result"] == "Forecast unavailable"
            err(api(app_url, "POST", f"/api/dives/{dive['id']}/start"), 409, "dive_not_cleared")
        down = outage_url()
        dive = plan_dive(down, None, "skv-02", start)
        err(api(down, "POST", f"/api/dives/{dive['id']}/clearance"), 502, "forecast_unavailable")

        dive = plan_dive(app_url, o, "skv-02", start)
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=1), first, [0.2] * 4, [0.6] * 4), delay_ms=6000)
        seen = len(wm_entries(wiremock, "/v1/marine", "GET"))
        with ThreadPoolExecutor(max_workers=1) as ex:
            slow = ex.submit(api, app_url, "POST", f"/api/dives/{dive['id']}/clearance")
            deadline = time.monotonic() + 10
            while len(wm_entries(wiremock, "/v1/marine", "GET")) <= seen:
                if time.monotonic() > deadline:
                    pytest.fail("first forecast check never reached the provider")
            wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=1), first, [0.2, 0.9, 0.2, 0.2], [0.6] * 4))
            fast = ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))["dive"]
            assert fast["clearance"]["result"] == "NO-GO"
            slow.result()
        assert ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["clearance"]["result"] == "NO-GO", "the newer check wins"


def test_wf_dive_day_happy(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/dives") as page:
        cert = "NO-" + tag("cert")[:12]
        hours = {(server_now(app_url).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M")}
        click(page.get_by_role("button", name="Plan dive"))
        dialog = page.get_by_role("dialog", name="Plan dive")
        select(dialog.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
        hours.add((server_now(app_url).replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)).strftime("%Y-%m-%d %H:%M"))
        assert dialog.get_by_role("textbox", name="Planned start (UTC)").input_value() in hours
        expect(dialog.get_by_role("textbox", name="Planned minutes")).to_have_value("90")
        fill(dialog.get_by_role("textbox", name="Diver certificate number"), cert)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/dives")) as made:
            click(dialog.get_by_role("button", name="Plan"))
        dive = made.value.json()["dive"]
        o.dives.append(dive["id"])
        assert dive["diver_certificate_no"] == cert and dive["planned_minutes"] == 90
        click(page.get_by_role("button", name=f"{dive['id']}, Skarvholmen 02"))
        expect(page.get_by_role("status", name="Dive status")).to_have_text("Dive status: planned")
        click(page.get_by_role("button", name="Check forecast"))
        clearance = page.get_by_role("status", name="Clearance status")
        expect(clearance).to_contain_text("GO — every planned hour is within limits")
        expect(page.get_by_role("table", name="Forecast hours")).to_be_visible()
        click(page.get_by_role("button", name="Start dive"))
        expect(clearance).to_contain_text("Dive started")
        expect(page.get_by_role("status", name="Dive status")).to_have_text("Dive status: started")
        clock = page.get_by_role("timer", name="Dive clock")
        expect(clock).to_have_text(re.compile(r"^\d\d:\d\d:\d\d$"))
        t0 = clock.inner_text()
        advance(page, 3000)
        expect(clock).not_to_have_text(t0)
        sonar = os.urandom(4096)
        with page.expect_file_chooser() as fc:
            click(page.get_by_role("button", name="Attach sonar capture"))
        fc.value.set_files({"name": "sweep.bin", "mimeType": "application/octet-stream", "buffer": sonar})
        expect(clearance).to_contain_text("Attached sonar capture SC-")
        track = page.get_by_role("textbox", name="Track samples")
        fill(track, "0,0.0,1.0\n10,abc,2.0")
        click(page.get_by_role("button", name="Finish dive"))
        expect(page.get_by_text(re.compile(r"^Track row 2 is invalid: ")).first).to_be_visible()
        assert ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["status"] == "started"
        fill(track, "0,0.0,1.0\n\n60,45.0,3.0")
        click(page.get_by_role("button", name="Finish dive"))
        expect(clearance).to_contain_text("Dive recorded")
        expect(page.get_by_role("status", name="Dive status")).to_have_text("Dive status: recorded")
        expect(page.get_by_role("table", name="Track")).to_contain_text("45")
        rec = ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]
        assert rec["status"] == "recorded" and [(s["t_s"], float(s["bearing_deg"]), float(s["depth_m"])) for s in rec["track"]] == [(0, 0.0, 1.0), (60, 45.0, 3.0)]
        assert len(rec["sonar"]) == 1 and S3().get(f"farms/skarvholmen/sonar/{rec['sonar'][0]['id']}") == sonar
        sonar_link = page.get_by_role("link", name=f"Download sonar {rec['sonar'][0]['id']}")
        expect(sonar_link).to_be_visible()
        here = page.url
        with page.expect_download() as dl:
            click(sonar_link)
        assert Path(dl.value.path()).read_bytes() == sonar
        assert page.url == here, "the page stays where it is"


def test_wf_dive_day_forecast_outage(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        dive = plan_dive(app_url, o, "skv-03", next_hour(app_url))
        wiremock.stub("GET", "/v1/marine", status=503, json={"error": "maintenance"})
        with console(browser, app_url, "/dives") as page:
            click(page.get_by_role("button", name=f"{dive['id']}, Skarvholmen 03"))
            click(page.get_by_role("button", name="Check forecast"))
            clearance = page.get_by_role("status", name="Clearance status")
            expect(clearance).to_contain_text("Forecast unavailable — try again shortly")
            click(page.get_by_role("button", name="Start dive"))
            expect(clearance).to_contain_text("Dive needs a fresh GO before it can start")
        assert ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["clearance"]["result"] == "Forecast unavailable"


def test_wf_copilot_ask_and_apply(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE)
        b = o.defect("skv-03", "tear", 200, 6, TEAR)
        content = "Patch " + tag("answer")
        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply(content, [
            ("call_f", "focus_defects", {"defect_ids": [a["id"], b["id"], "D-9999"]}),
            ("call_p", "propose_repair", {"defect_id": a["id"], "method": "patch", "note": "Sew a patch"})]))
        question = "  Which defects need repair before restocking? " + tag() + "  "
        with console(browser, app_url, "/pens/skv-03") as page:
            wait_ws(page)
            copilot = page.get_by_role("region", name="Copilot")
            fill(copilot.get_by_role("textbox", name="Ask the copilot"), question)
            click(copilot.get_by_role("button", name="Ask"))
            status = page.get_by_role("status", name="Copilot status")
            expect(status).to_contain_text("Copilot answered")
            expect(status).to_contain_text(f"Ignored unknown defects: {UNKNOWN_ID}")
            expect(copilot).to_contain_text(content)
            sent = [r for r in wm_entries(wiremock, "/v1/chat/completions", "POST") if json.loads(r["body"])["messages"][1]["content"] == question]
            assert sent, "question sent exactly as typed"
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            lines = scene_lines(page)
            assert f"Focus: {a['id']}, {b['id']}" in lines and f"Selected: {a['id']}" in lines and cam_deg(page) == 100
            click(copilot.get_by_role("button", name=f"Show {b['id']}"))
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            lines = scene_lines(page)
            assert f"Selected: {b['id']}" in lines and cam_deg(page) == 200 and f"Focus: {a['id']}, {b['id']}" in lines
            click(copilot.get_by_role("button", name=f"Apply repair to {a['id']}"))
            expect(status).to_contain_text(f"Repair recorded for {a['id']}")
            rep = get_defect(app_url, a["id"])
            assert rep["status"] == "repaired" and [r["source"] for r in rep["repairs"]] == ["copilot"]
            assert pen(app_url, "skv-03")["grade"]["letter"] == "C"

            first_route: list[Any] = []

            def hold_first(route: Any) -> None:
                if not first_route:
                    first_route.append(route)
                else:
                    route.continue_()

            page.route("**/api/pens/skv-03/copilot", hold_first)
            fill(copilot.get_by_role("textbox", name="Ask the copilot"), "older " + tag())
            click(copilot.get_by_role("button", name="Ask"))
            for _ in range(100):
                if first_route:
                    break
                advance(page, 20)
            assert first_route, "first question request was captured"
            newer = "Newer " + tag("answer")
            wiremock.stub("POST", "/v1/chat/completions", json=chat_reply(newer, [("call_n", "focus_defects", {"defect_ids": [b["id"]]})]))
            fill(copilot.get_by_role("textbox", name="Ask the copilot"), "newer " + tag())
            click(copilot.get_by_role("button", name="Ask"))
            expect(copilot).to_contain_text(newer)
            older = "Older " + tag("answer")
            wiremock.stub("POST", "/v1/chat/completions", json=chat_reply(older, [("call_o", "focus_defects", {"defect_ids": [a["id"]]})]))
            with contextlib.suppress(PlaywrightError):
                first_route[0].continue_()
                first_route[0].request.response()
            advance(page, FLY_MAX_MS)
            expect(copilot).to_contain_text(newer)
            expect(copilot).not_to_contain_text(older)
            assert f"Focus: {b['id']}" in scene_lines(page)
            expect(status).to_contain_text("Copilot answered")


def test_copilot_apply_reaches_every_surface(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE)
        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply("Patch " + tag("answer"), [
            ("call_p", "propose_repair", {"defect_id": a["id"], "method": "patch", "note": "Sew a patch"})]))
        with console(browser, app_url, "/pens/skv-03") as lap, \
                console(browser, app_url, "/pens/skv-03?device=DEV-2", size=(768, 1024), touch=True) as tab:
            wait_ws(lap)
            wait_ws(tab)
            tab.evaluate("() => { window.__stayed = true; }")
            copilot = lap.get_by_role("region", name="Copilot")
            fill(copilot.get_by_role("textbox", name="Ask the copilot"), "Which repair? " + tag())
            with lap.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/pens/skv-03/copilot")) as asked:
                click(copilot.get_by_role("button", name="Ask"))
            proposal = asked.value.json()["answer"]["proposals"][0]["id"]
            click(copilot.get_by_role("button", name=f"Apply repair to {a['id']}"))
            expect(lap.get_by_role("status", name="Copilot status")).to_contain_text(f"Repair recorded for {a['id']}")
            live_text(tab, tab.get_by_role("status", name="Console updates"), f"Topside laptop recorded a repair on {a['id']}", STREAM_CONNECT_MS)
            live_text(tab, tab.get_by_role("button", name=f"{a['id']}, hole"), "Repaired", LIVE_MS)
            assert tab.evaluate("() => window.__stayed === true"), "no reload"
        last = history(app_url, a["id"])[-1]
        assert (last["action"], last["device_name"], last["detail"]) == ("repaired", "Topside laptop", f"patch (copilot proposal {proposal})")


def test_copilot_late_answer_dropped(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE)
        content = "Late " + tag("answer")
        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply(content, [("call_f", "focus_defects", {"defect_ids": [a["id"]]})]))
        with console(browser, app_url, "/pens/skv-03") as page:
            wait_ws(page)
            waiting: list[Any] = []
            page.route("**/api/pens/skv-03/copilot", lambda route: waiting.append(route))
            copilot = page.get_by_role("region", name="Copilot")
            fill(copilot.get_by_role("textbox", name="Ask the copilot"), "Which defects? " + tag())
            click(copilot.get_by_role("button", name="Ask"))
            for _ in range(100):
                if waiting:
                    break
                advance(page, 20)
            assert waiting, "the question was sent"
            click(page.get_by_role("list", name="Pens").get_by_role("link", name="Skarvholmen 02"))
            expect(page).to_have_url(re.compile(r"/pens/skv-02(?:[?#]|$)"))
            wait_ws(page)
            camera_line = scene_line(page, "Camera: ")
            with contextlib.suppress(PlaywrightError):
                waiting[0].continue_()
            quiet_until = time.monotonic() + LIVE_MS / 1000
            while time.monotonic() < quiet_until:
                advance(page, 50)
            lines = scene_lines(page)
            assert "Focus: none" in lines and "Selected: none" in lines, lines
            assert scene_line(page, "Camera: ") == camera_line
            expect(page).to_have_url(re.compile(r"/pens/skv-02\?view=cylinder$"))
            expect(page.get_by_role("region", name="Copilot")).not_to_contain_text(content)


def test_validated_repair_proposals(app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE)
        r = o.defect("skv-03", "chafe", 150, 4, SMALL_CHAFE)
        ok(api(app_url, "POST", f"/api/defects/{r['id']}/repairs", body={"method": "clean", "note": ""}), 201)
        b = o.defect("skv-03", "tear", 200, 6, TEAR)
        x = o.defect("skv-03", "tear", 250, 6, TEAR)
        ok(api(app_url, "DELETE", f"/api/defects/{x['id']}"))
        calls = [
            ("call_a", "measure_net", {"defect_ids": [a["id"]]}),
            ("call_b", "propose_repair", "not json"),
            ("call_c", "propose_repair", {"defect_id": a["id"], "method": "patch"}),
            ("call_d", "focus_defects", {"defect_ids": [a["id"], "D-9999", x["id"], a["id"]]}),
            ("call_e", "propose_repair", {"defect_id": "D-9999", "method": "patch", "note": "n"}),
            ("call_f", "propose_repair", {"defect_id": a["id"], "method": "glue", "note": "n"}),
            ("call_g", "propose_repair", {"defect_id": a["id"], "method": "patch", "note": "x" * (NOTE_LIMIT + 1)}),
            ("call_h", "propose_repair", {"defect_id": r["id"], "method": "patch", "note": "n"}),
            ("call_i", "propose_repair", {"defect_id": a["id"], "method": "patch", "note": "first"}),
            ("call_j", "propose_repair", {"defect_id": a["id"], "method": "lace", "note": "second"}),
            ("call_k", "focus_defects", {"defect_ids": a["id"]}),
            ("call_l", "propose_repair", {"defect_id": x["id"], "method": "patch", "note": "n"}),
            ("call_m", "propose_repair", {"defect_id": b["id"], "method": "lace", "note": "tear"}),
            ("call_n", "focus_defects", "[1, 2]"),
        ]
        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply("checked", calls))
        ans = ok(api(app_url, "POST", "/api/pens/skv-03/copilot", body={"question": "what now " + tag()}))["answer"]
        assert ans["focus"] == [a["id"]]
        assert ans["dropped_ids"] == ["D-9999", x["id"]]
        assert [(c["tool_call_id"], c["reason"]) for c in ans["rejected_calls"]] == [
            ("call_a", "unknown_tool"), ("call_b", "invalid_arguments"), ("call_c", "invalid_arguments"),
            ("call_f", "unknown_method"), ("call_g", "note_too_long"), ("call_h", "already_repaired"),
            ("call_j", "duplicate_proposal"), ("call_k", "invalid_arguments"), ("call_n", "invalid_arguments")]
        props = ans["proposals"]
        assert [(p["defect_id"], p["method"], p["note"], p["status"]) for p in props] == [(a["id"], "patch", "first", "proposed"), (b["id"], "lace", "tear", "proposed")]
        first = ok(api(app_url, "POST", f"/api/proposals/{props[0]['id']}/apply"))
        assert first["proposal"]["status"] == "applied" and first["proposal"]["repair_id"] == first["repair"]["id"]
        d = get_defect(app_url, a["id"])
        assert d["status"] == "repaired" and [(rp["source"], rp["proposal_id"]) for rp in d["repairs"]] == [("copilot", props[0]["id"])]
        h = history(app_url, a["id"])
        assert h[-1]["action"] == "repaired" and h[-1]["detail"] == f"patch (copilot proposal {props[0]['id']})"
        again = ok(api(app_url, "POST", f"/api/proposals/{props[0]['id']}/apply", device=DEV2))
        assert again == first
        d2 = get_defect(app_url, a["id"])
        assert (len(d2["repairs"]), d2["version"], len(history(app_url, a["id"]))) == (1, d["version"], len(h))
        ok(api(app_url, "DELETE", f"/api/defects/{b['id']}"))
        err(api(app_url, "POST", f"/api/proposals/{props[1]['id']}/apply"), 409, "defect_removed")
        err(api(app_url, "POST", "/api/proposals/RP-9999/apply"), 404, "not_found")


@pytest.mark.timeout(300)
def test_wf_copilot_outage(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        for install, status in (
            (lambda: wiremock.stub("POST", "/v1/chat/completions", status=500, json={"error": "boom"}), 502),
            (lambda: wiremock.stub("POST", "/v1/chat/completions", json={"choices": []}), 502),
            (lambda: wiremock.fault("POST", "/v1/chat/completions"), 502),
            (lambda: wiremock.stub("POST", "/v1/chat/completions", json=chat_reply("late", []), delay_ms=COPILOT_TIMEOUT_S * 1000 + PROVIDER_SLOW_PAD_MS), 504),
        ):
            install()
            err(api(app_url, "POST", "/api/pens/skv-03/copilot", body={"question": "status " + tag()}), status, "copilot_unavailable")
        down = outage_url()
        err(api(down, "POST", "/api/pens/skv-03/copilot", body={"question": "status " + tag()}), 502, "copilot_unavailable")
        d = ok(api(down, "POST", "/api/pens/skv-03/defects", body={"type": "chafe", "bearing_deg": 10, "depth_m": 3, "size": SMALL_CHAFE, "note": "", "private_note": ""}), 201)["defect"]
        o.ids.append(d["id"])
        ok(api(down, "POST", f"/api/defects/{d['id']}/repairs", body={"method": "clean", "note": "manual"}), 201)
        assert get_defect(app_url, d["id"])["status"] == "repaired"
        wiremock.stub("POST", "/v1/chat/completions", status=500, json={"error": "boom"})
        m = o.defect("skv-03", "chafe", 20, 3, SMALL_CHAFE)
        with console(browser, app_url, "/pens/skv-03") as page:
            wait_ws(page)
            copilot = page.get_by_role("region", name="Copilot")
            fill(copilot.get_by_role("textbox", name="Ask the copilot"), "anything " + tag())
            copilot.get_by_role("textbox", name="Ask the copilot").press("Enter")
            expect(page.get_by_role("status", name="Copilot status")).to_contain_text("Copilot unavailable")
            assert "Focus: none" in scene_lines(page)
            editor = open_editor(page, page.get_by_role("button", name=f"{m['id']}, chafe"), f"Edit {m['id']}")
            select(editor.get_by_role("combobox", name="Repair method"), "Clean")
            click(editor.get_by_role("button", name="Record repair"))
            expect(page.get_by_role("status", name="Editor status")).to_contain_text(f"Repair recorded for {m['id']}")
            page.keyboard.press("Escape")
        assert get_defect(app_url, m["id"])["status"] == "repaired"


def test_copilot_request_findings_only(app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        secret = "private " + tag("secret")
        gone = o.defect("skv-01", "chafe", 10, 3, SMALL_CHAFE, private_note=secret)
        ok(api(app_url, "DELETE", f"/api/defects/{gone['id']}"))
        question = "  Which defects need repair before restocking? " + tag() + "  "
        ok(api(app_url, "POST", "/api/pens/skv-01/copilot", body={"question": question}))
        hits = [r for r in wm_entries(wiremock, "/v1/chat/completions", "POST") if question in json.loads(r["body"])["messages"][-1]["content"]]
        assert len(hits) == 1
        raw = hits[0]["body"]
        body = json.loads(raw)
        assert set(body) == {"model", "messages", "tools", "tool_choice"}
        assert body["model"] == "pensight-findings-1" and body["tool_choice"] == "auto"
        assert sorted(t["function"]["name"] for t in body["tools"]) == ["focus_defects", "propose_repair"]
        sysmsg, user = body["messages"]
        assert user == {"role": "user", "content": question}
        assert sysmsg["role"] == "system" and sysmsg["content"].startswith("Pensight findings context\n")
        ctx = json.loads(sysmsg["content"].split("\n", 1)[1])
        assert ctx["pen"] == "Skarvholmen 01"
        live = [d for d in pen(app_url, "skv-01")["defects"] if not d["removed"]]
        assert [d["id"] for d in ctx["defects"]] == [d["id"] for d in live]
        for got, want in zip(ctx["defects"], live):
            assert set(got) == {"id", "type", "status", "cell", "size", "area_cm2", "patch_area_m2", "note"}
            for k in got:
                assert got[k] == want[k], (k, got, want)
        for leak in ("Farm saw a seal", "Bill this re-check", "14500", "NO-ROV-48213", "Topside laptop", "Deck tablet", "DEV-1", secret, gone["id"]):
            assert leak not in raw, leak
        assert "Authorization".lower() not in wm_headers(hits[0])


def legacy(rows: list[str], header: str = LEGACY_HEADER, eol: str = "\n") -> bytes:
    return (eol.join([header] + rows) + eol).encode()


def test_legacy_import_matching(app_url: str) -> None:
    t = tag("imp")
    with owned(app_url) as o:
        e = o.defect("skv-03", "chafe", 90, 5, SMALL_CHAFE, note="target")
        w = o.defect("skv-03", "chafe", 359.5, 12, SMALL_CHAFE, note="seam target")
        rows = [
            f' skv ,003,2026-11-01T10:00:00Z,hole,10,3,30,24,"{t} hole one"',
            f"SKV,3,2026-11-01T10:00:00Z,CHAFE,90.5,5.5,20,5,{t} near target",
            f"ZZZ,3,2026-11-01T10:00:00Z,HOLE,10,3,10,10,{t} orphan",
            f"SKV,9,2026-11-01T10:00:00Z,hole,10,3,10,10,{t} no pen",
            f"SKV,3,2026-11-01T10:00:00Z,GLUE,10,3,10,10,{t} bad kind",
            f"SKV,3,2026-11-01T10:00:00Z,TEAR,20,99,10,1,{t} too deep",
            f"SKV,003,2026-11-01T10:00:00Z,Hole,10.2,3.4,5,5,{t} near row two",
            f' skv ,003,2026-11-01T10:00:00Z,hole,10,3,30,24,"{t} hole one"',
            f'SKV,3,2026-11-01T10:00:00Z,chafe,200,10,10,2,"{t} line1, ""q""\nline2"',
            f"SKV,3,2026-11-01T10:00:00Z,chafe,0.5,12.5,10,2,{t} across seam",
        ]
        header = " Site_Code , PEN_NO,observed_at,KIND,bearing,depth_m,size_a_cm,size_b_cm,note"
        data = legacy(rows, header=header)
        im = ok(import_csv(app_url, data, name=f"{t}.csv"), 201)
        assert im["replayed"] is False
        imp = im["import"]
        o.ids.extend(c["defect_id"] for c in imp["created"])
        assert imp["rows"] == 10
        created = {c["row"]: c["defect_id"] for c in imp["created"]}
        assert sorted(created) == [2, 10]
        assert {m["row"]: m["defect_id"] for m in imp["merged"]} == {3: e["id"], 8: created[2], 11: w["id"]}
        assert [(a["row"], a["defect_id"]) for a in imp["already_imported"]] == [(9, created[2])]
        assert [(x["row"], x["site_code"], str(x["pen_no"])) for x in imp["orphans"]] == [(4, "ZZZ", "3"), (5, "SKV", "9")]
        assert [x["row"] for x in imp["invalid"]] == [6, 7] and all(x["reason"] for x in imp["invalid"])
        hole = get_defect(app_url, created[2])
        assert (hole["pen_id"], hole["type"], float(hole["bearing_deg"]), float(hole["depth_m"]), hole["size"], hole["note"]) == ("skv-03", "hole", 10.0, 3.0, {"width_cm": 30, "height_cm": 24}, f"{t} hole one")
        assert [(h["action"], h["detail"]) for h in history(app_url, created[2])][:1] == [("imported", f"{imp['id']} row 2")]
        quoted = get_defect(app_url, created[10])
        assert quoted["note"] == f'{t} line1, "q"\nline2'
        tgt = get_defect(app_url, e["id"])
        assert (tgt["note"], tgt["size"]) == ("target", SMALL_CHAFE)
        assert history(app_url, e["id"])[-1]["action"] == "merged" and history(app_url, e["id"])[-1]["detail"] == f"{imp['id']} row 3"

        semi = ("\ufeff" + "site_code;pen_no;observed_at;kind;bearing;depth_m;size_a_cm;size_b_cm;note\r\n"
                f"SKV;3;2026-11-01T10:00:00Z;hole;45,5;7,5;10;10;{t} semicolon\r\n").encode()
        im2 = ok(import_csv(app_url, semi, name=f"{t}-semi.csv"), 201)["import"]
        o.ids.extend(c["defect_id"] for c in im2["created"])
        assert [c["row"] for c in im2["created"]] == [2]
        sd = get_defect(app_url, im2["created"][0]["defect_id"])
        assert (float(sd["bearing_deg"]), float(sd["depth_m"])) == (45.5, 7.5)
        err(import_csv(app_url, b"a,b,c\n1,2,3\n"), 422, "validation")
        err(import_csv(app_url, legacy([]) + b" " * IMPORT_LIMIT), 413, "too_large")


def test_wf_legacy_import_reimport(browser: Browser, app_url: str) -> None:
    t = tag("re")
    data = legacy([f"SKV,3,2026-11-01T10:00:00Z,HOLE,300,4,10,10,{t} reimport"])
    name = f"{t}.csv"
    with owned(app_url) as o, console(browser, app_url, "/imports") as page:
        select(page.get_by_role("combobox", name="Farm"), "Skarvholmen Laks")
        status = page.get_by_role("status", name="Import status")
        for expected in (f"Imported {name}: 1 created, 0 merged, 0 already imported, 0 orphans, 0 invalid", "Already imported — nothing new created"):
            with page.expect_file_chooser() as fc:
                click(page.get_by_role("button", name="Choose legacy CSV"))
            fc.value.set_files({"name": name, "mimeType": "text/csv", "buffer": data})
            click(page.get_by_role("button", name="Import"))
            expect(status).to_contain_text(expected)
        imports = [i for i in ok(api(app_url, "GET", "/api/farms/skarvholmen/imports"))["imports"] if i["sha256"] == hashlib.sha256(data).hexdigest()]
        assert len(imports) == 1, "one import record for the file"
        imp = imports[0]
        o.ids.extend(c["defect_id"] for c in imp["created"])
        assert len(imp["created"]) == 1
        assert S3().get(f"farms/skarvholmen/imports/{imp['id']}.csv") == data
        raw = api(app_url, "GET", f"/api/imports/{imp['id']}/raw")
        assert raw.content == data and raw.headers["X-Content-SHA256"] == hashlib.sha256(data).hexdigest()
        with page.expect_download() as dl:
            click(page.get_by_role("link", name=f"Download original {name}"))
        assert Path(dl.value.path()).read_bytes() == data
        before = [d["id"] for d in pen(app_url, "skv-03")["defects"]]
        replay = ok(import_csv(app_url, data, name=name))
        assert replay["replayed"] is True and replay["import"]["id"] == imp["id"]
        crlf = data.replace(b"\n", b"\r\n")
        other = ok(import_csv(app_url, crlf, name=f"{t}-crlf.csv"), 201)["import"]
        assert other["created"] == [] and [(a["row"], a["defect_id"]) for a in other["already_imported"]] == [(2, imp["created"][0]["defect_id"])]
        assert [d["id"] for d in pen(app_url, "skv-03")["defects"]] == before, "re-import creates no defect"


def test_wf_legacy_import_double_click(browser: Browser, app_url: str) -> None:
    t = tag("dbl")
    data = legacy([f"SKV,3,2026-11-01T10:00:00Z,CHAFE,330,8,10,1,{t} double", f"SKV,3,2026-11-01T10:00:00Z,CHAFE,340,9,10,1,{t} second"])
    sha = hashlib.sha256(data).hexdigest()
    with owned(app_url) as o:
        try:
            with console(browser, app_url, "/imports") as page:
                select(page.get_by_role("combobox", name="Farm"), "Skarvholmen Laks")
                with page.expect_file_chooser() as fc:
                    click(page.get_by_role("button", name="Choose legacy CSV"))
                fc.value.set_files({"name": f"{t}.csv", "mimeType": "text/csv", "buffer": data})
                with ThreadPoolExecutor(max_workers=1) as ex:
                    tablet = ex.submit(import_csv, app_url, data, "skarvholmen", f"{t}.csv", DEV2)
                    page.get_by_role("button", name="Import").dblclick()
                    tablet_reply = tablet.result()
                assert tablet_reply.status_code in (200, 201)
                expect(page.get_by_role("status", name="Import status")).to_contain_text(re.compile(r"Imported|Already imported — nothing new created"))
            mine = [i for i in ok(api(app_url, "GET", "/api/farms/skarvholmen/imports"))["imports"] if i["sha256"] == sha]
            assert len(mine) == 1
            assert tablet_reply.json()["import"]["id"] == mine[0]["id"]
            s3 = S3()
            assert [k for k in s3.keys("farms/skarvholmen/imports/") if s3.get(k) == data] == [f"farms/skarvholmen/imports/{mine[0]['id']}.csv"]
            notes = [d["note"] for d in pen(app_url, "skv-03")["defects"] if not d["removed"]]
            assert notes.count(f"{t} double") == 1 and notes.count(f"{t} second") == 1

            same = legacy([f"SKV,3,2026-11-01T10:00:00Z,HOLE,250,2,10,10,{t} pair"])
            r1, r2 = race(lambda: import_csv(app_url, same, name="a.csv"), lambda: import_csv(app_url, same, name="b.csv", device=DEV2))
            assert sorted([r1.status_code, r2.status_code]) == [200, 201]
            assert r1.json()["import"]["id"] == r2.json()["import"]["id"]
            assert sorted([r1.json()["replayed"], r2.json()["replayed"]]) == [False, True]

            shared = f"SKV,3,2026-11-01T10:00:00Z,TEAR,280,6,10,1,{t} shared"
            fa = legacy([shared, f"SKV,3,2026-11-01T10:00:00Z,HOLE,20,9,3,3,{t} only a"])
            fb = legacy([f"SKV,3,2026-11-01T10:00:00Z,HOLE,60,9,3,3,{t} only b", shared])
            ra, rb = race(lambda: import_csv(app_url, fa, name="fa.csv"), lambda: import_csv(app_url, fb, name="fb.csv", device=DEV2))
            ia, ib = ok(ra, 201)["import"], ok(rb, 201)["import"]
            made = [d for d in pen(app_url, "skv-03")["defects"] if not d["removed"] and d["note"] == f"{t} shared"]
            assert len(made) == 1, "shared row created once"
            listed = [x["defect_id"] for x in ia["created"] + ib["created"] if x["defect_id"] == made[0]["id"]]
            again = [x["defect_id"] for x in ia["already_imported"] + ib["already_imported"]]
            assert len(listed) == 1 and made[0]["id"] in again
            assert [h["action"] for h in history(app_url, made[0]["id"])].count("imported") == 1
        finally:
            for d in pen(app_url, "skv-03")["defects"]:
                if not d["removed"] and d["note"].startswith(t):
                    o.ids.append(d["id"])


def test_numbered_revisions(app_url: str) -> None:
    s3 = S3()
    with owned(app_url) as o:
        d = o.defect("skv-03", "hole", 100, 4, HOLE, note="packed", private_note="secret " + tag())
        ok(upload_still(app_url, d["id"], png()), 201)
        r1 = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]
        r2 = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]
        assert r2["number"] == r1["number"] + 1
        listed = ok(api(app_url, "GET", "/api/pens/skv-03/reports"))["revisions"]
        assert [x["number"] for x in listed[:2]] == [r2["number"], r1["number"]]
        for rev in listed[:2]:
            raw = api(app_url, "GET", f"/api/pens/skv-03/reports/{rev['number']}/pack")
            stored = s3.get(f"farms/skarvholmen/reports/skv-03/revision-{rev['number']}.json")
            assert raw.content == stored and raw.headers["content-type"].startswith("application/json")
            assert hashlib.sha256(stored).hexdigest() == raw.headers["X-Content-SHA256"] == rev["sha256"] and rev["size_bytes"] == len(stored)
            pack = json.loads(stored)
            assert (pack["format"], pack["revision"], pack["pen"]["id"], pack["farm"]["name"]) == ("pensight-report-pack-1", rev["number"], "skv-03", "Skarvholmen Laks")
            mine = [x for x in pack["defects"] if x["id"] == d["id"]][0]
            assert "private_note" not in mine and "secret" not in stored.decode() and len(mine["stills"]) == 1
        before = s3.get(f"farms/skarvholmen/reports/skv-03/revision-{r1['number']}.json")
        ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": get_defect(app_url, d["id"])["version"], "note": "changed"}))
        assert api(app_url, "GET", f"/api/pens/skv-03/reports/{r1['number']}/pack").content == before
        for method in ("PUT", "DELETE", "POST"):
            err(api(app_url, method, f"/api/pens/skv-03/reports/{r1['number']}/pack"), 404, "not_found")
        ok(api(app_url, "POST", f"/api/defects/{d['id']}/lock", device=DEV2))
        err(api(app_url, "POST", "/api/pens/skv-03/reports"), 423, "locked")
        assert ok(api(app_url, "GET", "/api/pens/skv-03/reports"))["revisions"][0]["number"] == r2["number"]


def test_wf_report_revisions_publish_restore(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE, note="note A", private_note="priv A")
        s1 = ok(upload_still(app_url, a["id"], png()), 201)["still"]
        b = o.defect("skv-03", "chafe", 200, 6, SMALL_CHAFE, note="note B")
        rb = ok(api(app_url, "POST", f"/api/defects/{b['id']}/repairs", body={"method": "lace", "note": "laced"}), 201)["repair"]
        snap_a, snap_b = get_defect(app_url, a["id"]), get_defect(app_url, b["id"])
        with console(browser, app_url, "/reports") as page:
            select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
            click(page.get_by_role("button", name="Publish revision"))
            status = page.get_by_role("status", name="Report status")
            expect(status).to_contain_text(re.compile(r"Published revision \d+"))
            n = int(re.search(r"Published revision (\d+)", status.inner_text()).group(1))
            ok(api(app_url, "PATCH", f"/api/defects/{a['id']}", body={"version": snap_a["version"], "note": "edited", "size": {"width_cm": 40, "height_cm": 40}}))
            ok(upload_still(app_url, a["id"], png()), 201)
            ok(api(app_url, "DELETE", f"/api/defects/{b['id']}"))
            c = o.defect("skv-03", "tear", 300, 2, TEAR)
            vc = get_defect(app_url, a["id"])["version"]
            ok(api(app_url, "POST", f"/api/defects/{a['id']}/lock", device=DEV2))
            err(api(app_url, "POST", "/api/pens/skv-03/restore", body={"revision": n}), 423, "locked")
            api(app_url, "DELETE", f"/api/defects/{a['id']}/lock", device=DEV2)
            err(api(app_url, "POST", "/api/pens/skv-03/restore", body={"revision": 99999}), 404, "not_found")
            page.reload()
            select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
            click(page.get_by_role("region", name=f"Revision {n}").get_by_role("button", name=f"Restore revision {n}"))
            dialog = page.get_by_role("dialog", name="Restore revision")
            expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
            click(dialog.get_by_role("button", name="Restore"))
            expect(status).to_contain_text(f"Restored revision {n}")
        ra, rbk = get_defect(app_url, a["id"]), get_defect(app_url, b["id"])
        for k in ("bearing_deg", "depth_m", "chart_x_m", "cell", "size", "area_cm2", "note", "private_note", "status", "repairs"):
            assert ra[k] == snap_a[k], k
            assert rbk[k] == snap_b[k], k
        assert [s["id"] for s in ra["stills"]] == [s1["id"]] and rbk["removed"] is False
        assert [r["id"] for r in rbk["repairs"]] == [rb["id"]]
        assert ra["version"] == max(vc, snap_a["version"]) + 1
        assert history(app_url, a["id"])[-1]["action"] == "restored" and history(app_url, a["id"])[-1]["detail"] == f"revision {n}"
        err(api(app_url, "GET", f"/api/defects/{c['id']}"), 404, "not_found")
        assert api(app_url, "GET", f"/api/stills/{s1['id']}/raw").status_code == 200


def test_wf_report_revisions_bands(browser: Browser, app_url: str) -> None:
    r1 = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]["number"]
    r2 = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]["number"]
    p = pen(app_url, "skv-03")
    with console(browser, app_url, "/reports", size=(768, 1024)) as page:
        select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
        latest = page.get_by_role("region", name="Latest report")
        expect(latest).to_contain_text("Skarvholmen 03")
        expect(page.get_by_role("region", name="Condition grade")).to_contain_text(p["grade"]["letter"])
        expect(page.get_by_role("region", name="Open defects")).to_contain_text(str(p["open_defects"]))
        b2, b1 = page.get_by_role("region", name=f"Revision {r2}"), page.get_by_role("region", name=f"Revision {r1}")
        h1 = b1.get_by_role("heading", name=f"Revision {r1}")
        if box(b1)["y"] > page.viewport_size["height"]:
            assert h1.evaluate(SEEN_OPACITY) < 1, "band not yet revealed"
        for band, n in ((b2, r2), (b1, r1)):
            head = band.get_by_role("heading", name=f"Revision {n}")
            band.scroll_into_view_if_needed()
            until(page, REVEAL_DONE, [band.element_handle(), head.element_handle()])
            expect(head).to_be_visible()
            expect(band.get_by_role("link", name="Download pack")).to_be_visible()
            expect(band.get_by_role("button", name=f"Restore revision {n}")).to_be_visible()
        assert box(latest)["y"] < box(b2)["y"] < box(b1)["y"], "latest row first, newest band above older"
        page.evaluate("() => window.scrollTo(0, 0)")
        advance(page, REVEAL_MS)
        b1.scroll_into_view_if_needed()
        for _ in range(REVISIT_SAMPLES):
            advance(page, FRAME_MS * 3)
            assert h1.evaluate(SEEN_OPACITY) == 1, "bands never animate a second time"
        with page.expect_download() as dl:
            click(b1.get_by_role("link", name="Download pack"))
        assert Path(dl.value.path()).read_bytes() == api(app_url, "GET", f"/api/pens/skv-03/reports/{r1}/pack").content


def test_publish_restore_refused_while_locked(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "chafe", 200, 6, SMALL_CHAFE, note=FIRST_NOTE)
        n0 = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]["number"]
        ok(api(app_url, "PATCH", f"/api/defects/{a['id']}", body={"version": a["version"], "note": SECOND_NOTE}))
        with console(browser, app_url, "/reports") as lap, \
                console(browser, app_url, "/reports?device=DEV-2", size=(768, 1024), touch=True) as tab:
            for page in (lap, tab):
                select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
                expect(page.get_by_role("region", name=f"Revision {n0}", exact=True)).to_have_count(1)
            tab.evaluate("() => { window.__stayed = true; }")
            status = lap.get_by_role("status", name="Report status")
            ok(api(app_url, "POST", f"/api/defects/{a['id']}/lock", device=DEV2))
            click(lap.get_by_role("button", name="Publish revision"))
            expect(status).to_contain_text("Being edited on Deck tablet")
            assert ok(api(app_url, "GET", "/api/pens/skv-03/reports"))["revisions"][0]["number"] == n0
            lap.reload()
            select(lap.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
            click(lap.get_by_role("region", name=f"Revision {n0}", exact=True).get_by_role("button", name=f"Restore revision {n0}", exact=True))
            ok(api(app_url, "POST", f"/api/defects/{a['id']}/lock", device=DEV2))
            click(lap.get_by_role("dialog", name="Restore revision").get_by_role("button", name="Restore"))
            expect(status).to_contain_text("Being edited on Deck tablet")
            assert get_defect(app_url, a["id"])["note"] == SECOND_NOTE
            assert api(app_url, "DELETE", f"/api/defects/{a['id']}/lock", device=DEV2).status_code == 204
            click(lap.get_by_role("button", name="Publish revision"))
            expect(status).to_contain_text(f"Published revision {n0 + 1}")
            live(tab, lambda: tab.get_by_role("region", name=f"Revision {n0 + 1}", exact=True).count() == 1, STREAM_CONNECT_MS, "the new revision on the tablet")
            assert tab.evaluate("() => window.__stayed === true"), "no reload"


@pytest.mark.timeout(180)
def test_report_link_lifecycle(browser: Browser, app_url: str) -> None:
    for bad in (LINK_MIN_S - 1, LINK_MAX_S + 1, 60.5, "60"):
        e = err(api(app_url, "POST", "/api/pens/skv-02/links", body={"expires_in_seconds": bad}), 422, "validation")
        assert "expires_in_seconds" in e["fields"]
    assert create_link(app_url, "skv-02", LINK_MAX_S)["status"] == "active"
    short = create_link(app_url, "skv-02", LINK_MIN_S)
    assert short["path"] == f"/r/{short['token']}" and short["url"].endswith(short["path"]) and 0 < short["expires_in_s"] <= LINK_MIN_S
    body = ok(share(app_url, short["token"]))
    assert body["link"]["status"] == "active" and body["link"]["expires_in_s"] <= LINK_MIN_S
    for method, path in (("POST", f"/api/share/{short['token']}"), ("DELETE", f"/api/share/{short['token']}"), ("PUT", f"/r/{short['token']}")):
        e = err(api(app_url, method, path, device=None), 405, "read_only")
        assert e["message"] == "Report links are read-only"
    deadline = time.monotonic() + LINK_MIN_S + 10
    while share(app_url, short["token"]).status_code != 410:
        if time.monotonic() > deadline:
            pytest.fail("link did not expire on the server clock")
    err(share(app_url, short["token"]), 410, "link_inactive")
    row = [x for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == short["id"]][0]
    assert (row["status"], row["expires_in_s"]) == ("expired", 0)
    e = err(api(app_url, "POST", f"/api/links/{short['id']}/regenerate", body={"token": short["token"]}), 409, "link_state")
    assert e["message"] == "This link is no longer active"

    link = create_link(app_url, "skv-02", WEEK_S)
    assert parse_ts(link["expires_at"]) - parse_ts(link["created_at"]) == timedelta(seconds=WEEK_S)
    with console(browser, app_url, "/reports") as page:
        e1 = [x for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == link["id"]][0]["expires_in_s"]
        select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
        exp = parse_ts(link["expires_at"])
        prefix = f"Active — expires {exp.strftime('%Y-%m-%d %H:%M')} UTC (in "
        region = page.get_by_role("region", name="Report links")
        expect(region).to_contain_text(prefix)
        e2 = [x for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == link["id"]][0]["expires_in_s"]
        allowed = {f"{prefix}{s // 3600} h {s % 3600 // 60} min)" for s in range(e2, e1 + 1)}
        assert any(a in region.inner_text() for a in allowed)
        new = ok(api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={"token": link["token"]}))["link"]
        assert new["token"] != link["token"] and new["expires_at"] == link["expires_at"]
        err(share(app_url, link["token"]), 410, "link_inactive")
        assert api(app_url, "GET", f"/r/{link['token']}", device=None).status_code == 410
        ok(share(app_url, new["token"]))
        rev = ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))["link"]
        assert (rev["status"], rev["expires_in_s"]) == ("revoked", 0)
        assert ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))["link"] == rev
        for tok in (link["token"], new["token"]):
            err(share(app_url, tok), 410, "link_inactive")
        page.reload()
        select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
        expect(page.get_by_role("region", name="Report links")).to_contain_text("Revoked")
    err(share(app_url, "no-such-token-" + tag()), 404, "not_found")


def test_wf_report_links_share(browser: Browser, app_url: str) -> None:
    p = pen(app_url, "skv-02")
    with console(browser, app_url, "/reports") as lap, console(browser, app_url, "/reports?device=DEV-2", size=(768, 1024), touch=True) as tab:
        select(lap.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
        select(tab.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
        status = lap.get_by_role("status", name="Report status")
        click(lap.get_by_role("button", name="Publish revision"))
        expect(status).to_contain_text(re.compile(r"Published revision \d+"))
        click(lap.get_by_role("button", name="Create report link"))
        dialog = lap.get_by_role("dialog", name="Create report link")
        click(dialog.get_by_role("radio", name="7 days"))
        with lap.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/pens/skv-02/links")) as made:
            click(dialog.get_by_role("button", name="Create link"))
        link = made.value.json()["link"]
        expect(status).to_contain_text("Link created")
        urls = lap.get_by_role("textbox", name="Report link URL")
        idx = [i for i in range(urls.count()) if urls.nth(i).input_value() == link["url"]]
        assert len(idx) == 1
        assert parse_ts(link["expires_at"]) - parse_ts(link["created_at"]) == timedelta(seconds=WEEK_S)
        with console(browser, app_url, link["path"], size=(375, 812), touch=True) as phone:
            wait_text(phone, "D-0007")
            tap(phone.get_by_role("tab", name="Condition"))
            expect(phone.get_by_role("tabpanel", name="Condition")).to_contain_text(grade_line(p))
            tap(phone.get_by_role("tab", name="Defects"))
            expect(phone.get_by_role("tabpanel", name="Defects")).to_contain_text("D-0007")
            tap(phone.get_by_role("button", name="Unwrap"))
            advance(phone, UNWRAP_MAX_MS + SETTLE_PAD_MS)
            assert "View: Flat chart" in scene_lines(phone)
            revoked_before = tab.get_by_role("region", name="Report links").inner_text().count("Revoked")
            click(lap.get_by_role("button", name="Revoke link").nth(idx[0]))
            rd = lap.get_by_role("dialog", name="Revoke link")
            click(rd.get_by_role("button", name="Revoke"))
            expect(status).to_contain_text("Link revoked")
            advance(phone, RECHECK_MS)
            wait_text(phone, "This report link is no longer active", seconds=10)
        live(tab, lambda: tab.get_by_role("region", name="Report links").inner_text().count("Revoked") > revoked_before,
             STREAM_CONNECT_MS, "one more Revoked row on the tablet")
    assert [x["status"] for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == link["id"]] == ["revoked"]
    err(share(app_url, link["token"]), 410, "link_inactive")


def test_wf_report_links_regenerate_race(browser: Browser, app_url: str) -> None:
    link = create_link(app_url, "skv-02", DAY_S)
    with console(browser, app_url, "/reports") as lap, console(browser, app_url, "/reports?device=DEV-2") as tab:
        rows = []
        for page in (lap, tab):
            select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 02")
            urls = page.get_by_role("textbox", name="Report link URL")
            expect(urls.first).to_be_visible()
            i = [k for k in range(urls.count()) if urls.nth(k).input_value() == link["url"]][0]
            rows.append(i)
        with held(lap, "**/api/links/*/regenerate") as h1, held(tab, "**/api/links/*/regenerate") as h2:
            click(lap.get_by_role("button", name="Regenerate link").nth(rows[0]))
            click(tab.get_by_role("button", name="Regenerate link").nth(rows[1]))
            h1.release()
            h2.release()
        texts = []
        for page in (lap, tab):
            st = page.get_by_role("status", name="Report status")
            expect(st).to_contain_text(re.compile(r"Link regenerated — the old link no longer works|Link changed on another device — the list has been refreshed"))
            texts.append(st.inner_text())
        assert sum("Link regenerated — the old link no longer works" in t for t in texts) == 1
        assert sum("Link changed on another device — the list has been refreshed" in t for t in texts) == 1
        current = [x for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == link["id"]][0]
        assert current["token"] != link["token"]
        for page, i in zip((lap, tab), rows):
            expect(page.get_by_role("textbox", name="Report link URL").nth(i)).to_have_value(current["url"])
        err(share(app_url, link["token"]), 410, "link_inactive")
        ok(share(app_url, current["token"]))
    e = err(api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={"token": link["token"]}), 409, "link_state")
    assert e["message"] == "Link changed on another device — the list has been refreshed"
    assert "token" in err(api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={}), 422, "validation")["fields"]
    assert "token" in err(api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={"token": 5}), 422, "validation")["fields"]
    res = race(lambda: api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={"token": current["token"]}),
               lambda: api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={"token": current["token"]}))
    assert sorted(r.status_code for r in res) == [200, 409]
    winner = [r for r in res if r.status_code == 200][0].json()["link"]["token"]
    ok(share(app_url, winner))
    regen, revoke = race(lambda: api(app_url, "POST", f"/api/links/{link['id']}/regenerate", body={"token": winner}),
                         lambda: api(app_url, "POST", f"/api/links/{link['id']}/revoke"))
    ok(revoke)
    tokens = [link["token"], current["token"], winner] + ([regen.json()["link"]["token"]] if regen.status_code == 200 else [])
    assert [x["status"] for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == link["id"]] == ["revoked"]
    for tok in tokens:
        err(share(app_url, tok), 410, "link_inactive")


def test_link_rows_follow_other_device(browser: Browser, app_url: str) -> None:
    mine = create_link(app_url, "skv-03", DAY_S)
    with console(browser, app_url, "/reports?device=DEV-2", size=(768, 1024), touch=True) as tab:
        select(tab.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
        urls = tab.get_by_role("region", name="Report links").get_by_role("textbox", name="Report link URL")
        expect(urls.first).to_be_visible()

        def values() -> list[str]:
            return urls.evaluate_all("els => els.map(e => e.value)")

        def focused() -> Any:
            return tab.evaluate("() => document.activeElement ? (document.activeElement.value ?? null) : null")

        live(tab, lambda: mine["url"] in values(), LIVE_MS, "the link's row")
        urls.nth(values().index(mine["url"])).focus()
        assert focused() == mine["url"]
        updates = tab.get_by_role("status", name="Console updates")
        other = create_link(app_url, "skv-03", WEEK_S)
        live(tab, lambda: other["url"] in values(), STREAM_CONNECT_MS, "the new link's row")
        live_text(tab, updates, "Report link created", LIVE_MS)
        assert focused() == mine["url"], "focus stays in the tablet's row"
        fresh = ok(api(app_url, "POST", f"/api/links/{other['id']}/regenerate", body={"token": other["token"]}))["link"]
        live_text(tab, updates, "Report link regenerated", LIVE_MS)
        live(tab, lambda: fresh["url"] in values() and other["url"] not in values(), LIVE_MS, "the regenerated URL")
        assert focused() == mine["url"], "focus stays in the tablet's row"
        revoked_before = tab.get_by_role("region", name="Report links").inner_text().count("Revoked")
        ok(api(app_url, "POST", f"/api/links/{other['id']}/revoke"))
        live_text(tab, updates, "Report link revoked", LIVE_MS)
        live(tab, lambda: tab.get_by_role("region", name="Report links").inner_text().count("Revoked") > revoked_before,
             LIVE_MS, "the revoked row's status line")
        assert focused() == mine["url"], "focus stays in the tablet's row"
        renewed = ok(api(app_url, "POST", f"/api/links/{mine['id']}/regenerate", body={"token": mine["token"]}))["link"]
        live(tab, lambda: focused() == renewed["url"], LIVE_MS, "the focused row's new URL")
    ok(api(app_url, "POST", f"/api/links/{mine['id']}/revoke"))


def test_cross_site_writes_refused(app_url: str) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        link = create_link(app_url, "skv-02", DAY_S)
        app_origin = "{0.scheme}://{0.netloc}".format(urllib.parse.urlsplit(link["url"]))
        for origin in (FOREIGN_ORIGIN, "null"):
            for method, path, body in (("POST", f"/api/links/{link['id']}/revoke", None),
                                       ("POST", f"/api/links/{link['id']}/regenerate", {"token": link["token"]}),
                                       ("PATCH", f"/api/defects/{d['id']}", {"version": 1, "note": "hostile"}),
                                       ("DELETE", f"/api/defects/{d['id']}", None),
                                       ("DELETE", "/api/farms/kalamos", {"confirm_name": "Kalamos Marine"})):
                r = api(app_url, method, path, body=body, headers={"Origin": origin})
                assert r.status_code == 403 and r.json() == {"error": {"code": "cross_origin", "message": "Cross-site request refused"}}, (origin, path, r.text)
                assert not [h for h in r.headers if h.lower().startswith("access-control-allow-")]
        ok(share(app_url, link["token"]))
        cur = get_defect(app_url, d["id"])
        assert (cur["version"], cur["note"], cur["removed"]) == (1, "", False)
        assert "kalamos" in [f["id"] for f in ok(api(app_url, "GET", "/api/farms"))["farms"]]
        pre = api(app_url, "OPTIONS", f"/api/links/{link['id']}/revoke", headers={"Origin": FOREIGN_ORIGIN, "Access-Control-Request-Method": "POST"})
        assert not [h for h in pre.headers if h.lower().startswith("access-control-allow-")]
        ok(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 1, "note": "own origin"}, headers={"Origin": app_origin}))
        ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke", headers={"Origin": app_origin}))


def test_wf_farm_manager_view_privacy(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        secret = "secret " + tag("priv")
        d = o.defect("skv-01", "chafe", 20, 3, SMALL_CHAFE, private_note=secret)
        ok(api(app_url, "POST", f"/api/defects/{d['id']}/lock", device=DEV2))
        link = create_link(app_url, "skv-01", DAY_S)
        leaks = ("14500", "NO-ROV-48213", "Farm saw a seal", "Bill this re-check at half rate", secret, "Topside laptop", "Deck tablet", "DEV-1", "DEV-2")
        bodies: list[str] = []
        with console(browser, app_url, link["path"]) as page:
            page.on("response", lambda r: bodies.append(r.text()) if any(t in (r.headers.get("content-type") or "") for t in ("json", "html")) else None)
            page.reload()
            wait_text(page, "Link expires")
            click(page.get_by_role("button", name=f"Pin {d['id']}"))
            expect(page.get_by_role("button", name="Mark defect")).to_have_count(0)
        html = api(app_url, "GET", link["path"], device=None).text
        data = share(app_url, link["token"])
        bodies += [html, data.text]
        for b in bodies:
            for leak in leaks:
                assert leak not in b, leak

        def keys(x: Any) -> set[str]:
            if isinstance(x, dict):
                return set(x) | set().union(*[keys(v) for v in x.values()])
            if isinstance(x, list):
                return set().union(*[keys(v) for v in x]) if x else set()
            return set()

        assert not keys(data.json()) & {"private_note", "lock", "history", "version", "stills", "updated_at", "day_rate", "diver_certificate_no", "device_id", "device_name"}
        api(app_url, "DELETE", f"/api/defects/{d['id']}/lock", device=DEV2)
        ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_wf_farm_manager_view_layouts(browser: Browser, app_url: str) -> None:
    link = create_link(app_url, "skv-01", DAY_S)
    p = pen(app_url, "skv-01")
    for size in ((1280, 800), (768, 1024), (375, 812)):
        with console(browser, app_url, link["path"], size=size, touch=size != (1280, 800)) as page:
            wait_text(page, D_HOLE)
            layout(page)
            stage = box(page.get_by_role("region", name="Pen stage"))
            if size[0] == 1280:
                cond, dfx = box(page.get_by_role("region", name="Condition")), box(page.get_by_role("region", name="Defects"))
                assert stage["width"] > size[0] * 8 / 12 * 0.8 and cond["x"] >= stage["x"] + stage["width"] - GEOM_TOL_PX and cond["y"] < dfx["y"]
            elif size[0] == 768:
                cond, dfx = box(page.get_by_role("region", name="Condition")), box(page.get_by_role("region", name="Defects"))
                assert stage["width"] > size[0] * 0.8 and cond["y"] >= stage["y"] + stage["height"] - GEOM_TOL_PX and abs(cond["y"] - dfx["y"]) <= GEOM_TOL_PX
            else:
                tl = box(page.get_by_role("tablist", name="Report panels"))
                assert tl["y"] >= stage["y"] + stage["height"] - GEOM_TOL_PX
                tap(page.get_by_role("tab", name="Condition"))
            expect(page.get_by_role("region", name="Condition") if size[0] != 375 else page.get_by_role("tabpanel", name="Condition")).to_contain_text(grade_line(p))
            for name in ("Mark defect", "Save", "Ask", "Regenerate link", "Revoke link", "Delete defect"):
                expect(page.get_by_role("button", name=name, exact=True)).to_have_count(0)
            assert "Focus: none" in scene_lines(page)
            page.get_by_role("button", name=f"Pin {D_HOLE}").focus()
            page.keyboard.press("ArrowRight")
            advance(page, GLIDE_MAX_MS)
            assert cam_deg(page) == ORBIT_STEP_DEG
            click(page.get_by_role("button", name=f"Pin {D_TEAR}"))
            assert "Selected: D-0002" in scene_lines(page)
            click(page.get_by_role("button", name="Unwrap"))
            advance(page, UNWRAP_MAX_MS + SETTLE_PAD_MS)
            assert "View: Flat chart" in scene_lines(page)
    ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_tabs_and_collapsed_panels(browser: Browser, app_url: str) -> None:
    link = create_link(app_url, "skv-01", DAY_S)
    with console(browser, app_url, "/pens/skv-01", size=(375, 812), touch=True) as page:
        wait_ws(page)
        cam = scene_line(page, "Camera: ")
        tab = lambda n: page.get_by_role("tab", name=n, exact=True)
        expect(tab("Defects")).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel", name="Copilot")).to_have_count(0)
        expect(page.get_by_role("textbox", name="Ask the copilot")).to_have_count(0)
        tab("Defects").focus()
        for key, name in (("ArrowRight", "Copilot"), ("ArrowRight", "Pens"), ("ArrowRight", "Defects"), ("ArrowLeft", "Pens"), ("Home", "Defects"), ("End", "Pens")):
            page.keyboard.press(key)
            advance(page, GLIDE_MAX_MS)
            expect(tab(name)).to_be_focused()
            expect(tab(name)).to_have_attribute("aria-selected", "true")
            assert scene_line(page, "Camera: ") == cam
        expect(page.get_by_role("tabpanel", name="Defects")).to_have_count(0)
        page.keyboard.press("Tab")
        assert page.get_by_role("tabpanel", name="Pens").evaluate(
            "p => p === document.activeElement || p.contains(document.activeElement)"), "Tab moves into the selected panel"
        tap(tab("Copilot"))
        expect(page.get_by_role("tabpanel", name="Copilot")).to_be_visible()
        expect(page.get_by_role("link", name="Export all defects (CSV)")).to_have_count(0)
        for name in ("Console", "Data", "Help"):
            expect(page.get_by_role("button", name=name, exact=True)).to_have_attribute("aria-expanded", "false")
        page.get_by_role("button", name="Console", exact=True).focus()
        for name in ("Data", "Help"):
            page.keyboard.press("Tab")
            expect(page.get_by_role("button", name=name, exact=True)).to_be_focused()
        click(page.get_by_role("button", name="Data", exact=True))
        expect(page.get_by_role("button", name="Data", exact=True)).to_have_attribute("aria-expanded", "true")
        expect(page.get_by_role("link", name="Export all defects (CSV)")).to_be_visible()
        click(page.get_by_role("button", name="Data", exact=True))
        expect(page.get_by_role("link", name="Export all defects (CSV)")).to_have_count(0)
        click(page.get_by_role("button", name="Menu"))
        menu = page.get_by_role("dialog", name="Menu")
        expect(menu.get_by_role("link", name="Dives")).to_be_visible()
        page.keyboard.press("Escape")
        advance(page, SLIDE_OUT_MS)
        expect(menu).to_have_count(0)
        expect(page.get_by_role("link", name="Dives", exact=True)).to_have_count(0)
        layout(page)
    with console(browser, app_url, link["path"], size=(375, 812), touch=True) as page:
        wait_text(page, D_HOLE)
        cam = scene_line(page, "Camera: ")
        expect(page.get_by_role("tab", name="Defects")).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel", name="Condition")).to_have_count(0)
        page.get_by_role("tab", name="Defects").focus()
        page.keyboard.press("ArrowRight")
        advance(page, GLIDE_MAX_MS)
        expect(page.get_by_role("tab", name="Condition")).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel", name="Defects")).to_have_count(0)
        page.keyboard.press("End")
        page.keyboard.press("Home")
        advance(page, GLIDE_MAX_MS)
        expect(page.get_by_role("tab", name="Defects")).to_be_focused()
        assert scene_line(page, "Camera: ") == cam
    ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


@pytest.mark.timeout(180)
def test_report_link_countdown_from_server(browser: Browser, app_url: str) -> None:
    day = create_link(app_url, "skv-02", DAY_S)
    with console(browser, app_url, day["path"]) as page:
        page.clock.set_system_time(server_now(app_url) + timedelta(days=5))
        e1 = ok(share(app_url, day["token"]))["link"]["expires_in_s"]
        page.reload()
        exp = parse_ts(day["expires_at"])
        prefix = f"Link expires {exp.strftime('%Y-%m-%d %H:%M')} UTC (in "
        cond = page.get_by_role("region", name="Condition")
        expect(cond).to_contain_text(prefix)
        e2 = ok(share(app_url, day["token"]))["link"]["expires_in_s"]
        assert any(f"{prefix}{s // 3600} h {s % 3600 // 60} min)" in cond.inner_text() for s in range(e2, e1 + 1))
        advance(page, RECHECK_MS)
        expect(cond).to_contain_text(prefix + "23 h ")
    short = create_link(app_url, "skv-02", 30)
    with console(browser, app_url, short["path"]) as page:
        page.clock.set_system_time(server_now(app_url) - timedelta(days=1))
        page.reload()
        left = ok(share(app_url, short["token"]))["link"]["expires_in_s"]
        expect(page.get_by_role("region", name="Condition")).to_contain_text(f"(in {left // 3600} h {left % 3600 // 60} min)")
        deadline = time.monotonic() + 60
        while share(app_url, short["token"]).status_code != 410:
            advance(page, 1000)
            if time.monotonic() > deadline:
                pytest.fail("short link never expired on the server")
        advance(page, RECHECK_MS)
        wait_text(page, "This report link is no longer active", seconds=INACTIVE_WITHIN_S)
        assert "Link expires" not in page.locator("body").inner_text()
    ok(api(app_url, "POST", f"/api/links/{day['id']}/revoke"))


def test_share_page_follows_pen_changes(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-02", "chafe", 60, 4, SMALL_CHAFE)
        b = o.defect("skv-02", "chafe", 120, 6, SMALL_CHAFE)
        c = o.defect("skv-02", "hole", 150, 8, BIG_HOLE)
        link = create_link(app_url, "skv-02", DAY_S)
        try:
            with console(browser, app_url, link["path"]) as page:
                condition = page.get_by_role("region", name="Condition")
                expect(condition).to_contain_text(grade_line(pen(app_url, "skv-02")))
                pin = page.get_by_role("button", name=f"Pin {a['id']}")
                pin_mid(page, a["id"])
                click(pin)
                advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
                pin.focus()
                page.keyboard.press("ArrowRight")
                advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
                cam = scene_line(page, "Camera: ")
                assert f"Selected: {a['id']}" in scene_lines(page)
                ok(api(app_url, "POST", f"/api/defects/{b['id']}/repairs", body={"method": "lace", "note": "laced"}), 201)
                ok(api(app_url, "DELETE", f"/api/defects/{c['id']}"))
                changed = grade_line(pen(app_url, "skv-02"))
                advance(page, RECHECK_MS)
                live_text(page, condition, changed, LIVE_MS)
                expect(page.get_by_role("button", name=f"Pin {c['id']}")).to_have_count(0)
                assert f"Selected: {a['id']}" in scene_lines(page) and scene_line(page, "Camera: ") == cam, scene_lines(page)
                expect(pin).to_be_focused()
            with console(browser, app_url, link["path"], size=(375, 812), touch=True) as phone:
                wait_text(phone, D_BRIDLE)
                tab = phone.get_by_role("tab", name="Condition")
                tap(tab)
                panel = phone.get_by_role("tabpanel", name="Condition")
                expect(panel).to_contain_text(grade_line(pen(app_url, "skv-02")))
                ok(api(app_url, "POST", f"/api/defects/{a['id']}/repairs", body={"method": "patch", "note": "patched"}), 201)
                advance(phone, RECHECK_MS)
                live_text(phone, panel, grade_line(pen(app_url, "skv-02")), LIVE_MS)
                expect(tab).to_have_attribute("aria-selected", "true")
                expect(phone.get_by_role("tabpanel", name="Defects")).to_have_count(0)
        finally:
            ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_search_and_export(browser: Browser, app_url: str) -> None:
    assert ok(search(app_url, "kal"))["results"] == [{"kind": "farm", "id": "kalamos", "label": "Kalamos Marine"}, {"kind": "pen", "id": "klm-04", "label": "Kalamos 04"}]
    assert ok(search(app_url, "North"))["results"] == [{"kind": "farm", "id": "skarvholmen", "label": "Skarvholmen Laks"}]
    assert ok(search(app_url, "Skarvholmen"))["results"][:4] == [{"kind": "farm", "id": "skarvholmen", "label": "Skarvholmen Laks"}] + [
        {"kind": "pen", "id": i, "label": n} for i, n in (("skv-01", "Skarvholmen 01"), ("skv-02", "Skarvholmen 02"), ("skv-03", "Skarvholmen 03"))]
    assert {"kind": "defect", "id": "D-0001", "label": "D-0001 — Skarvholmen 01"} in ok(search(app_url, "d-0001"))["results"]
    with owned(app_url) as o:
        t, hidden = tag("find"), tag("hide")
        d = o.defect("skv-03", "hole", 10, 3, HOLE, note=f"Seam check {t}", private_note=hidden)
        assert ok(search(app_url, t.upper()))["results"] == [{"kind": "defect", "id": d["id"], "label": f"{d['id']} — Skarvholmen 03"}]
        assert ok(search(app_url, hidden))["results"] == []
        exp = api(app_url, "GET", "/api/exports/defects.csv")
        assert exp.status_code == 200 and exp.headers["content-type"].startswith("text/csv")
        lines = exp.text.split("\n")
        assert lines[0] == CSV_HEADER
        assert f"Skarvholmen Laks,SKV,Skarvholmen 03,{d['id']},hole,10.0,3.0,3.33,3.00,A1,565,,open,Seam check {t}" in lines
        ids = [r["defect_id"] for r in csv.DictReader(io.StringIO(exp.text, newline=""))]
        assert ids == sorted(ids)
        with console(browser, app_url, "/") as page:
            with page.expect_download() as dl:
                click(page.get_by_role("link", name="Export all defects (CSV)"))
            assert d["id"] in Path(dl.value.path()).read_text(encoding="utf-8")
        ok(api(app_url, "DELETE", f"/api/defects/{d['id']}"))
        assert ok(search(app_url, t))["results"] == []
        assert d["id"] not in api(app_url, "GET", "/api/exports/defects.csv").text


NEUTRAL = [
    ('=HYPERLINK("http://x","y")', '"\'=HYPERLINK(""http://x"",""y"")'),
    ("-frayed edge", "'-frayed edge"),
    ("+42 knots", "'+42 knots"),
    ("@cell", "'@cell"),
    ("\tindent", "'\tindent"),
    ("\rreturn", "\"'\rreturn"),
    ("plain, comma", '"plain, comma'),
]


def test_formula_safe_export(app_url: str) -> None:
    with owned(app_url) as o:
        t = tag("csv")
        made = [(o.defect("skv-03", "chafe", 10 + i, 3, SMALL_CHAFE, note=f"{note} {t}"), note, raw) for i, (note, raw) in enumerate(NEUTRAL)]
        imp_note = f"=1+1 {t}"
        data = legacy([f"SKV,3,2026-11-01T10:00:00Z,HOLE,333,4,3,3,{imp_note}"])
        imp = ok(import_csv(app_url, data), 201)["import"]
        o.ids.extend(c["defect_id"] for c in imp["created"])
        link = create_link(app_url, "skv-03", DAY_S)
        n = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]["number"]
        body = api(app_url, "GET", "/api/exports/defects.csv").text
        assert "\r\n" not in body and body.endswith("\n")
        rows = {r["defect_id"]: r for r in csv.DictReader(io.StringIO(body, newline=""))}
        pub = {x["id"]: x for x in ok(share(app_url, link["token"]))["defects"]}
        pack = {x["id"]: x for x in json.loads(api(app_url, "GET", f"/api/pens/skv-03/reports/{n}/pack").content)["defects"]}
        for d, note, raw in made:
            original = f"{note} {t}"
            assert raw + f" {t}" in body, (note, raw)
            want = original if note == "plain, comma" else "'" + original
            assert rows[d["id"]]["note"] == want
            assert get_defect(app_url, d["id"])["note"] == original == pub[d["id"]]["note"] == pack[d["id"]]["note"]
        created = imp["created"][0]["defect_id"]
        assert rows[created]["note"] == "'" + imp_note and get_defect(app_url, created)["note"] == imp_note
        assert rows[created]["bearing_deg"] == f"{float(get_defect(app_url, created)['bearing_deg']):.1f}" and not rows[created]["bearing_deg"].startswith("'")
        assert api(app_url, "GET", f"/api/imports/{imp['id']}/raw").content == data
        ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_wf_farm_erasure_search(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/") as page:
        click(page.get_by_role("button", name="Search"))
        dialog = page.get_by_role("dialog", name="Search")
        box_ = dialog.get_by_role("searchbox", name="Search farms, pens and defects")
        status = dialog.get_by_role("status", name="Search status")
        results = dialog.get_by_role("list", name="Search results")
        expect(box_).to_have_value("")
        expect(status).to_have_text("Type at least 2 characters")
        held_first: list[Any] = []
        sent: list[str] = []

        def route(r: Any) -> None:
            q = urllib.parse.parse_qs(urllib.parse.urlsplit(r.request.url).query).get("q", [""])[0]
            sent.append(q)
            if q == "sk" and not held_first:
                held_first.append(r)
            else:
                r.fallback()

        page.route("**/api/search?*", route)
        fill(box_, "sk")
        advance(page, SEARCH_SETTLE_MS)
        for _ in range(100):
            if held_first:
                break
            advance(page, 20)
        assert held_first, "query 'sk' was sent"
        fill(box_, "kal")
        advance(page, SEARCH_SETTLE_MS)
        expect(status).to_have_text("2 results")
        with contextlib.suppress(PlaywrightError):
            held_first[0].fallback()
            held_first[0].request.response()
        advance(page, SEARCH_SETTLE_MS)
        expect(status).to_have_text("2 results")
        expect(results.get_by_role("link")).to_have_count(2)
        expect(results.get_by_role("link", name="Kalamos Marine")).to_be_visible()
        expect(results.get_by_role("link", name="Kalamos 04")).to_have_attribute("href", re.compile(r"/pens/klm-04$"))
        count = len(sent)
        fill(box_, " % ")
        advance(page, SEARCH_SETTLE_MS)
        expect(status).to_have_text("Type at least 2 characters")
        expect(results.get_by_role("link")).to_have_count(0)
        assert len(sent) == count, "no request under 2 characters"
        fill(box_, "%%")
        advance(page, SEARCH_SETTLE_MS)
        expect(status).to_have_text("0 results")
        fill(box_, FLAG * (SEARCH_LIMIT + 1))
        advance(page, SEARCH_SETTLE_MS)
        expect(status).to_have_text("Search text is longer than 100 characters")
        expect(results.get_by_role("link")).to_have_count(0)
        fill(box_, "D-0002")
        advance(page, SEARCH_SETTLE_MS)
        click(results.get_by_role("link", name="D-0002 — Skarvholmen 01"))
        expect(page).to_have_url(re.compile(r"/pens/skv-01\?view=cylinder&defect=D-0002$"))
        wait_ws(page)
        advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
        lines = scene_lines(page)
        assert f"Selected: {D_TEAR}" in lines and "Camera: 237°" in lines, lines


def test_bounded_literal_search(app_url: str) -> None:
    assert search(app_url, FLAG * SEARCH_LIMIT).status_code == 200
    assert search(app_url, "  " + "a" * SEARCH_LIMIT + "  ").status_code == 200
    e = err(search(app_url, FLAG * (SEARCH_LIMIT + 1)), 422, "validation")
    assert e["message"] == e["fields"]["q"] == "Search text is longer than 100 characters"
    for q in ("%%", "D-000_", "__"):
        assert ok(search(app_url, q))["results"] == []
    for q in ("%", "\\", " a "):
        assert ok(search(app_url, q))["results"] == []
    with owned(app_url) as o:
        t = tag("lit")
        d = o.defect("skv-03", "chafe", 10, 3, SMALL_CHAFE, note=f"{t} 50%_off a\\b")
        for q in ("%_o", "a\\b", f"{t} 50%"):
            assert d["id"] in [r["id"] for r in ok(search(app_url, q))["results"]], q
        assert ok(search(app_url, f"{t}%off"))["results"] == []
        assert ok(search(app_url, f"{t[:-1]}_"))["results"] == []


LAYOUT_CASES = {"phone": (375, 812), "tablet": (768, 1024), "laptop": (1280, 800)}


@pytest.mark.parametrize("size", list(LAYOUT_CASES.values()), ids=list(LAYOUT_CASES))
def test_published_layouts(browser: Browser, app_url: str, size: tuple[int, int]) -> None:
    link = create_link(app_url, "skv-01", DAY_S)
    w, h = size
    with console(browser, app_url, "/", size=size, touch=w < 1100) as page:
        for path in ("/", "/pens/skv-01", "/dives", "/imports", "/reports", "/devices", link["path"]):
            page.goto(app_url.rstrip("/") + path)
            if path.startswith("/pens"):
                wait_ws(page)
            else:
                advance(page, 500)
            layout(page)
        page.goto(app_url.rstrip("/") + "/")
        if w < 600:
            expect(page.get_by_role("button", name="Menu")).to_be_visible()
        else:
            nav = page.get_by_role("navigation", name="Main")
            for n in ("Pens", "Dives", "Imports", "Reports", "Devices"):
                expect(nav.get_by_role("link", name=n, exact=True)).to_be_visible()
        if w >= 600:
            expect(page.get_by_role("link", name="Export all defects (CSV)")).to_be_visible()
            expect(page.get_by_role("button", name="Keyboard shortcuts")).to_be_visible()
        top = box(page.get_by_role("link", name="Pensight home"))["y"]
        page.evaluate("() => window.scrollTo(0, 400)")
        advance(page, 100)
        assert abs(box(page.get_by_role("link", name="Pensight home"))["y"] - top) <= 1, "top bar is fixed"
        page.goto(app_url.rstrip("/") + "/pens/skv-01")
        wait_ws(page)
        stage = box(page.get_by_role("region", name="Pen stage"))
        if w >= 600:
            cop, dfx = box(page.get_by_role("region", name="Copilot")), box(page.get_by_role("region", name="Defects"))
        if w == 1280:
            lst = box(page.get_by_role("list", name="Pens"))
            assert lst["x"] < stage["x"] < cop["x"] < dfx["x"]
            assert dfx["width"] > cop["width"] and stage["width"] > dfx["width"]
            assert stage["y"] + stage["height"] <= h + GEOM_TOL_PX
        elif w == 768:
            assert stage["width"] > w * 0.8 and h * 0.5 <= stage["height"] <= h * 0.7
            assert dfx["x"] < cop["x"] and dfx["width"] > cop["width"] and dfx["y"] >= stage["y"] + stage["height"] - GEOM_TOL_PX
        else:
            expect(page.get_by_role("combobox", name="Pen")).to_be_visible()
            tl = box(page.get_by_role("tablist", name="Pen panels"))
            assert stage["width"] > w * 0.85 and h * 0.3 <= stage["height"] <= h * 0.5
            assert tl["y"] >= stage["y"] + stage["height"] - GEOM_TOL_PX
        page.goto(app_url.rstrip("/") + "/reports")
        select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 01")
        lr = box(page.get_by_role("region", name="Latest report"))
        g, od = box(page.get_by_role("region", name="Condition grade")), box(page.get_by_role("region", name="Open defects"))
        assert lr["y"] < g["y"]
        if w < 600:
            assert od["y"] >= g["y"] + g["height"] - GEOM_TOL_PX
        else:
            assert abs(g["y"] - od["y"]) <= GEOM_TOL_PX and g["x"] < od["x"]
    ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_wf_cross_cutting_keyboard_dialogs(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            inside = "(dlg) => dlg.contains(document.activeElement)"
            for opener, name in ((page.get_by_role("button", name="Search"), "Search"), (page.get_by_role("button", name="Keyboard shortcuts"), "Keyboard shortcuts")):
                click(opener)
                dialog = page.get_by_role("dialog", name=name)
                expect(dialog).to_be_visible()
                for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
                    page.keyboard.press(key)
                    assert dialog.evaluate(inside), f"{key} left dialog {name}"
                page.keyboard.press("Escape")
                advance(page, SLIDE_OUT_MS)
                expect(dialog).to_have_count(0)
                expect(opener).to_be_focused()
            open_editor(page, page.get_by_role("button", name=f"{d['id']}, chafe"), f"Edit {d['id']}")
            advance(page, SETTLE_PAD_MS)
            delete = page.get_by_role("button", name="Delete defect")
            delete.focus()
            page.keyboard.press("Enter")
            confirm = page.get_by_role("dialog", name="Delete defect")
            expect(confirm.get_by_role("button", name="Cancel")).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(confirm).to_have_count(0)
            expect(delete).to_be_focused()
            page.keyboard.press("Escape")
            rest, foc = state_styles(page.get_by_role("button", name="Search"), "outline-style", "outline-width", "box-shadow", state="focus")
            assert rest != foc, "visible focus ring"


def test_downloads_save_exact_bytes(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        d = o.defect("skv-02", "chafe", 300, 3, SMALL_CHAFE)
        still_bytes = png()
        still = ok(upload_still(app_url, d["id"], still_bytes), 201)["still"]
        now = server_now(app_url)
        start = now.replace(minute=0, second=0, microsecond=0) + timedelta(hours=1)
        wiremock.stub("GET", "/v1/marine", json=marine_body(now - timedelta(hours=1), start - timedelta(hours=1), [0.2] * 4, [0.6] * 4))
        dive = plan_dive(app_url, o, "skv-03", start)
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/start"))
        sonar_bytes = os.urandom(2048)
        capture_ = ok(api(app_url, "POST", f"/api/dives/{dive['id']}/sonar", content=sonar_bytes,
                          headers={"Content-Type": "application/octet-stream", "X-Filename": "sweep.bin"}), 201)["capture"]
        n = ok(api(app_url, "POST", "/api/pens/skv-03/reports"), 201)["revision"]["number"]
        pack_bytes = api(app_url, "GET", f"/api/pens/skv-03/reports/{n}/pack").content

        def saved(page: Page, link: Any) -> bytes:
            here = page.url
            with page.expect_download() as dl:
                click(link)
            assert page.url == here, "the page stays where it is"
            return Path(dl.value.path()).read_bytes()

        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            editor = open_editor(page, page.get_by_role("button", name=f"{d['id']}, chafe"), f"Edit {d['id']}")
            stills = editor.get_by_role("list", name="Stills")
            assert saved(page, stills.get_by_role("link", name=f"Download still {still['id']}")) == still_bytes
            page.keyboard.press("Escape")
            page.goto(app_url.rstrip("/") + "/dives")
            click(page.get_by_role("button", name=f"{dive['id']}, Skarvholmen 03"))
            assert saved(page, page.get_by_role("link", name=f"Download sonar {capture_['id']}")) == sonar_bytes
            page.goto(app_url.rstrip("/") + "/reports")
            select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
            band = page.get_by_role("region", name=f"Revision {n}", exact=True)
            band.scroll_into_view_if_needed()
            until(page, REVEAL_DONE, [band.element_handle(), band.get_by_role("heading", name=f"Revision {n}", exact=True).element_handle()])
            assert saved(page, band.get_by_role("link", name="Download pack")) == pack_bytes


def test_error_shape_and_precedence(app_url: str) -> None:
    err(api(app_url, "GET", "/api/no-such-route"), 404, "not_found")
    err(api(app_url, "DELETE", "/api/devices"), 404, "not_found")
    err(api(app_url, "GET", "/api/defects/D-9999"), 404, "not_found")
    assert err(api(app_url, "POST", "/api/share/anything", device=None, headers={"Origin": FOREIGN_ORIGIN}), 405, "read_only")["message"] == "Report links are read-only"
    big = b'{"note":"' + b"x" * (JSON_LIMIT - 10) + b'"}'
    assert len(big) == JSON_LIMIT + 1
    err(api(app_url, "POST", "/api/pens/skv-03/defects", content=big, headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    err(api(app_url, "POST", "/api/pens/no-such-pen/defects", content=big, headers={"Content-Type": "application/json"}), 413, "too_large")
    exact = big[:9] + big[10:]
    assert len(exact) == JSON_LIMIT
    assert api(app_url, "POST", "/api/pens/skv-03/defects", content=exact, headers={"Content-Type": "application/json"}).status_code == 422
    err(api(app_url, "POST", "/api/pens/no-such-pen/defects", device=None, body={}), 404, "not_found")
    for dev in (None, "DEV-9"):
        r = api(app_url, "POST", "/api/pens/skv-03/defects", device=dev, body={"type": "hole"})
        assert r.status_code == 422 and r.json() == {"error": {"code": "validation", "message": "Unknown device", "fields": {"device": "Unknown device"}}}
    link = create_link(app_url, "skv-03", DAY_S)
    ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))
    r = api(app_url, "POST", f"/api/links/{link['id']}/regenerate", device=None, body={"token": link["token"]})
    assert r.status_code == 422 and r.json()["error"]["message"] == "Unknown device"
    with owned(app_url) as o:
        d = o.defect("skv-03", "chafe", 10, 3, SMALL_CHAFE)
        e = err(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 7, "type": "hole"}), 409, "version_conflict")
        e = err(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 1, "type": "hole"}), 422, "validation")
        assert e["fields"]["type"] == "Type cannot change"
        ok(api(app_url, "POST", f"/api/defects/{d['id']}/lock", device=DEV2))
        e = err(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 7, "note": "x" * (NOTE_LIMIT + 1)}), 423, "locked")
        assert set(e["details"]) == {"device_id", "device_name", "expires_in_s"} and isinstance(e["details"]["expires_in_s"], int)
        api(app_url, "DELETE", f"/api/defects/{d['id']}/lock", device=DEV2)
        err(upload_still(app_url, d["id"], b""), 422, "validation")
        ok(api(app_url, "DELETE", f"/api/defects/{d['id']}"))
        err(api(app_url, "PATCH", f"/api/defects/{d['id']}", body={"version": 1, "note": "x" * (NOTE_LIMIT + 1)}), 409, "defect_removed")
        err(api(app_url, "POST", f"/api/defects/{d['id']}/lock"), 409, "defect_removed")


@pytest.mark.timeout(300)
def test_wf_cross_cutting_boot(browser: Browser, app_url: str) -> None:
    assert ok(api(app_url, "GET", "/api/health", device=None)) == {"status": "ok"}
    down = outage_url()
    assert ok(api(down, "GET", "/api/health", device=None)) == {"status": "ok"}
    page_r = api(down, "GET", "/", device=None)
    assert page_r.status_code == 200 and "HTML".lower() in page_r.headers["content-type"]
    assert [p["id"] for p in ok(api(down, "GET", "/api/pens"))["pens"]] == list(SEED_PENS)
    s3 = S3()
    pack_before = s3.get("farms/skarvholmen/reports/skv-01/revision-1.json")
    d1_before = get_defect(app_url, "D-0001")
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+b", suffix=".log", delete=False)
    env = {**os.environ, "APP_PUBLIC_PORT": str(port)}
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    copy = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + 120
        healthy = False
        while not healthy and time.monotonic() < deadline:
            if proc.poll() is not None:
                log.seek(0)
                pytest.fail(f"second copy exited: {log.read()[-2000:]!r}")
            with contextlib.suppress(httpx.HTTPError):
                healthy = api(copy, "GET", "/api/health", device=None, timeout=5).status_code == 200
        if not healthy:
            pytest.fail("second copy never answered health 200")
        assert [f["id"] for f in ok(api(copy, "GET", "/api/farms"))["farms"]] == ["skarvholmen", "kalamos"]
        assert [r["number"] for r in ok(api(copy, "GET", "/api/pens/skv-01/reports"))["revisions"]].count(1) == 1
        assert get_defect(copy, "D-0001") == d1_before
        assert s3.get("farms/skarvholmen/reports/skv-01/revision-1.json") == pack_before
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(proc.pid, 15)
        proc.wait(timeout=30)


def _first_open_newest_pen_choice(browser: Browser, app_url: str, old: str, new: str) -> None:
    with console(browser, app_url, "/pens/skv-01") as page:
        wait_ws(page)
        pens = page.get_by_role("list", name="Pens")
        newest_choice_wins(
            page, "**/api/pens/**", rf"^/api/pens/{old}(/|$)",
            lambda: click(pens.get_by_role("link", name=PEN_NAME[old], exact=True)),
            lambda: click(pens.get_by_role("link", name=PEN_NAME[new], exact=True)),
            lambda: page.get_by_role("img", name=twin(PEN_NAME[new])).count() == 1
            and urllib.parse.urlparse(page.url).path == f"/pens/{new}",
            f"the {PEN_NAME[new]} workspace")
        wait_ws(page)
        expect(page.get_by_role("img", name=twin(PEN_NAME[old]))).to_have_count(0)
        for d in pen(app_url, new)["defects"]:
            if not d["removed"]:
                expect(page.get_by_role("button", name=f"{d['id']}, {d['type']}", exact=True)).to_have_count(1)
        for d in pen(app_url, old)["defects"]:
            if not d["removed"]:
                expect(page.get_by_role("button", name=f"{d['id']}, {d['type']}", exact=True)).to_have_count(0)


def test_first_open_newest_pen_choice_02_then_03(browser: Browser, app_url: str) -> None:
    _first_open_newest_pen_choice(browser, app_url, "skv-02", "skv-03")


def test_first_open_newest_pen_choice_03_then_kalamos(browser: Browser, app_url: str) -> None:
    _first_open_newest_pen_choice(browser, app_url, "skv-03", "klm-04")


def _first_open_focus_survives_tablet_work(browser: Browser, app_url: str, change: str) -> None:
    with owned(app_url) as o:
        other = o.defect("skv-01", "chafe", 30, 2, SMALL_CHAFE)
        try:
            with console(browser, app_url, "/pens/skv-01") as page:
                wait_ws(page)
                click(page.get_by_role("button", name=f"{D_CHAFE}, chafe", exact=True))
                advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
                pin = page.get_by_role("button", name=f"Pin {D_CHAFE}", exact=True)
                pin.focus()
                expect(pin).to_be_focused()
                if change == "edit":
                    ok(api(app_url, "PATCH", f"/api/defects/{other['id']}", device=DEV2, body={"version": other["version"], "note": REMOTE_NOTE}))
                    live_text(page, page.get_by_role("status", name="Console updates"), f"Deck tablet updated {other['id']}", STREAM_CONNECT_MS)
                else:
                    ok(api(app_url, "POST", f"/api/defects/{other['id']}/lock", device=DEV2))
                    live_text(page, page.get_by_role("region", name="Defects"), "Being edited on Deck tablet", STREAM_CONNECT_MS)
                advance(page, SETTLE_PAD_MS)
                expect(pin).to_be_focused()
                page.keyboard.press("Enter")
                expect(page.get_by_role("region", name="Defect editor").get_by_role("heading", name=f"Edit {D_CHAFE}")).to_be_visible()
                advance(page, SETTLE_PAD_MS)
                page.keyboard.press("Escape")
                advance(page, SLIDE_OUT_MS)
                expect(pin).to_be_focused()
        finally:
            api(app_url, "DELETE", f"/api/defects/{D_CHAFE}/lock", device=DEV1)


def test_first_open_focus_survives_tablet_work_edit(browser: Browser, app_url: str) -> None:
    _first_open_focus_survives_tablet_work(browser, app_url, "edit")


def test_first_open_focus_survives_tablet_work_lock(browser: Browser, app_url: str) -> None:
    _first_open_focus_survives_tablet_work(browser, app_url, "lock")


def _editor_focus_returns_after_save(browser: Browser, app_url: str, valkey: Any, opener: str) -> None:
    with owned(app_url) as o:
        did = o.defect("skv-02", "chafe", 200, 4, SMALL_CHAFE)["id"]
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            row = page.get_by_role("button", name=f"{did}, chafe", exact=True)
            click(row)
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            target = page.get_by_role("button", name=f"Pin {did}", exact=True) if opener == "pin" else row
            target.focus()
            page.keyboard.press("Enter" if opener == "pin" else "e")
            editor = page.get_by_role("region", name="Defect editor")
            heading = editor.get_by_role("heading", name=f"Edit {did}")
            expect(heading).to_be_visible()
            wait_lock(page, valkey, did, DEV1)
            fill(editor.get_by_role("textbox", name="Note", exact=True), FIRST_NOTE)
            click(editor.get_by_role("button", name="Save"))
            expect(page.get_by_role("status", name="Editor status")).to_contain_text(f"Saved {did}")
            click(editor.get_by_role("button", name="Close editor"))
            advance(page, SLIDE_OUT_MS)
            expect(heading).to_have_count(0)
            expect(target).to_be_focused()
            wait_unlocked(page, valkey, did)
        assert get_defect(app_url, did)["note"] == FIRST_NOTE


def test_editor_focus_returns_after_save_pin(browser: Browser, app_url: str, valkey: Any) -> None:
    _editor_focus_returns_after_save(browser, app_url, valkey, "pin")


def test_editor_focus_returns_after_save_row(browser: Browser, app_url: str, valkey: Any) -> None:
    _editor_focus_returns_after_save(browser, app_url, valkey, "row")


def _tab_order_after_live_insert(browser: Browser, app_url: str, pen_id: str, anchor: str, kind: str) -> None:
    with owned(app_url) as o, console(browser, app_url, f"/pens/{pen_id}") as page:
        wait_ws(page)
        click(page.get_by_role("button", name=f"{anchor}, {kind}", exact=True))
        advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
        pin = page.get_by_role("button", name=f"Pin {anchor}", exact=True)
        pin.focus()
        expect(pin).to_be_focused()
        added = o.defect(pen_id, "chafe", 270, 3, SMALL_CHAFE, device=DEV2)
        newer = page.get_by_role("button", name=f"Pin {added['id']}", exact=True)
        live(page, lambda: newer.count() == 1, STREAM_CONNECT_MS, "the new pin")
        advance(page, SETTLE_PAD_MS)
        expect(pin).to_be_focused()
        follower = [d["id"] for d in pen(app_url, pen_id)["defects"] if not d["removed"] and d["id"] > anchor][0]
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name=f"Pin {follower}", exact=True)).to_be_focused()


def test_tab_order_after_live_insert_skarvholmen_02(browser: Browser, app_url: str) -> None:
    _tab_order_after_live_insert(browser, app_url, "skv-02", D_BRIDLE, "chafe")


def test_tab_order_after_live_insert_kalamos_04(browser: Browser, app_url: str) -> None:
    _tab_order_after_live_insert(browser, app_url, "klm-04", "D-0008", "fouling")


def _new_defect_saves_once(browser: Browser, app_url: str, second: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-03") as page:
        wait_ws(page)
        page.keyboard.press("m")
        wait_line(page, "Marking: tap the net wall")
        advance(page, FRAME_MS * 2)
        b = box(page.get_by_role("img", name=twin(PEN_NAMES[2])))
        page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        editor = page.get_by_role("region", name="Defect editor")
        expect(editor.get_by_role("heading", name="New defect")).to_be_visible()
        pick_type(editor.get_by_role("combobox", name="Type"), "chafe")
        length = editor.get_by_role("textbox", name="Length (cm)")
        fill(length, str(SMALL_CHAFE["length_cm"]))
        fill(editor.get_by_role("textbox", name="Width (cm)"), str(SMALL_CHAFE["width_cm"]))
        before = {d["id"] for d in pen(app_url, "skv-03")["defects"]}
        save = editor.get_by_role("button", name="Save")
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/pens/skv-03/defects")) as made:
            second_press_sends_nothing(
                page, save, "**/api/pens/**", r"^/api/pens/skv-03/defects$", page.get_by_role("status", name="Editor status"),
                "Saving…", None if second == "button" else (lambda: length.press("Enter")))
        created = keep_created(o, made.value)
        expect(page.get_by_role("status", name="Editor status")).to_contain_text(f"Saved {created['id']}")
        after = {d["id"] for d in pen(app_url, "skv-03")["defects"]}
        o.ids.extend(sorted(after - before - {created["id"]}))
        assert after - before == {created["id"]}


def test_new_defect_saves_once_button(browser: Browser, app_url: str) -> None:
    _new_defect_saves_once(browser, app_url, "button")


def test_new_defect_saves_once_enter(browser: Browser, app_url: str) -> None:
    _new_defect_saves_once(browser, app_url, "enter")


def _create_field_errors(app_url: str, change: dict, field: str) -> None:
    before = [d["id"] for d in pen(app_url, "skv-03")["defects"]]
    body = {"type": "chafe", "bearing_deg": 10, "depth_m": 3, "size": SMALL_CHAFE, "note": "", "private_note": "", **change}
    r = api(app_url, "POST", "/api/pens/skv-03/defects", body=body)
    if r.status_code == 201:
        api(app_url, "DELETE", f"/api/defects/{r.json()['defect']['id']}")
    field_error(r, field)
    assert [d["id"] for d in pen(app_url, "skv-03")["defects"]] == before


def test_create_field_errors_bearing_string(app_url: str) -> None:
    _create_field_errors(app_url, {"bearing_deg": "12"}, "bearing_deg")


def test_create_field_errors_depth_null(app_url: str) -> None:
    _create_field_errors(app_url, {"depth_m": None}, "depth_m")


def test_create_field_errors_size_string(app_url: str) -> None:
    _create_field_errors(app_url, {"size": {"length_cm": "10", "width_cm": 1}}, "size.length_cm")


def test_create_field_errors_note_number(app_url: str) -> None:
    _create_field_errors(app_url, {"note": 5}, "note")


def _focused_pin_survives_remote_change(browser: Browser, app_url: str, change: str) -> None:
    with owned(app_url) as o:
        x = o.defect("skv-02", "chafe", 200, 4, SMALL_CHAFE)
        y = o.defect("skv-02", "chafe", 250, 6, SMALL_CHAFE)
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            click(page.get_by_role("button", name=f"{x['id']}, chafe", exact=True))
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            pin = page.get_by_role("button", name=f"Pin {x['id']}", exact=True)
            pin.focus()
            expect(pin).to_be_focused()
            if change == "edit":
                ok(api(app_url, "PATCH", f"/api/defects/{y['id']}", device=DEV2, body={"version": y["version"], "note": REMOTE_NOTE}))
                copy = f"Deck tablet updated {y['id']}"
            elif change == "create":
                copy = f"Deck tablet marked {o.defect('skv-02', 'chafe', 300, 8, SMALL_CHAFE, device=DEV2)['id']}"
            else:
                ok(api(app_url, "POST", f"/api/defects/{y['id']}/repairs", device=DEV2, body={"method": "lace", "note": "laced"}), 201)
                copy = f"Deck tablet recorded a repair on {y['id']}"
            live_text(page, page.get_by_role("status", name="Console updates"), copy, STREAM_CONNECT_MS)
            advance(page, SETTLE_PAD_MS)
            expect(pin).to_be_focused()
            assert f"Selected: {x['id']}" in scene_lines(page)


def test_focused_pin_survives_remote_change_edit(browser: Browser, app_url: str) -> None:
    _focused_pin_survives_remote_change(browser, app_url, "edit")


def test_focused_pin_survives_remote_change_create(browser: Browser, app_url: str) -> None:
    _focused_pin_survives_remote_change(browser, app_url, "create")


def test_focused_pin_survives_remote_change_repair(browser: Browser, app_url: str) -> None:
    _focused_pin_survives_remote_change(browser, app_url, "repair")


def _removed_defect_hands_focus_to_placeholder(browser: Browser, app_url: str, holder: str) -> None:
    with owned(app_url) as o:
        x = o.defect("skv-02", "chafe", 200, 4, SMALL_CHAFE)
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            row = page.get_by_role("button", name=f"{x['id']}, chafe", exact=True)
            click(row)
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            (page.get_by_role("button", name=f"Pin {x['id']}", exact=True) if holder == "pin" else row).focus()
            ok(api(app_url, "DELETE", f"/api/defects/{x['id']}", device=DEV2))
            placeholder = page.get_by_role("button", name=f"{x['id']}, Defect removed", exact=True)
            live(page, lambda: placeholder.count() == 1, STREAM_CONNECT_MS, "the placeholder row")
            advance(page, SETTLE_PAD_MS)
            expect(placeholder).to_be_focused()


def test_removed_defect_hands_focus_to_placeholder_pin(browser: Browser, app_url: str) -> None:
    _removed_defect_hands_focus_to_placeholder(browser, app_url, "pin")


def test_removed_defect_hands_focus_to_placeholder_row(browser: Browser, app_url: str) -> None:
    _removed_defect_hands_focus_to_placeholder(browser, app_url, "row")


def test_devices_refresh_keeps_focus(browser: Browser, app_url: str) -> None:
    with console(browser, app_url, "/devices") as page:
        wait_text(page, "This browser is Topside laptop")
        use = page.get_by_role("button", name="Use this browser as Deck tablet")
        use.focus()
        ok(api(app_url, "POST", f"/api/devices/{DEV2}/heartbeat", device=DEV2))
        wait_text(page, "Deck tablet — Online", seconds=HEARTBEAT_TTL_S)
        expect(use).to_be_focused()
        advance(page, DEVICES_REFRESH_MS * 2 + SETTLE_PAD_MS)
        expect(use).to_be_focused()


def _track_input_survives_refresh(browser: Browser, app_url: str, pen_id: str) -> None:
    with owned(app_url) as o:
        dive = plan_dive(app_url, o, pen_id, next_hour(app_url))
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/start"))
        with console(browser, app_url, "/dives") as page:
            click(page.get_by_role("button", name=f"{dive['id']}, {PEN_NAME[pen_id]}"))
            expect(page.get_by_role("status", name="Dive status")).to_have_text("Dive status: started")
            samples = page.get_by_role("textbox", name="Track samples")
            fill(samples, TRACK_TYPED)
            samples.evaluate("(el, at) => { el.focus(); el.setSelectionRange(at, at); }", TRACK_CARET)
            advance(page, DIVES_REFRESH_MS * 2 + SETTLE_PAD_MS)
            expect(samples).to_be_focused()
            expect(samples).to_have_value(TRACK_TYPED)
            assert samples.evaluate("el => [el.selectionStart, el.selectionEnd]") == [TRACK_CARET, TRACK_CARET]
            click(page.get_by_role("button", name="Finish dive"))
            expect(page.get_by_role("status", name="Clearance status")).to_contain_text("Dive recorded")
        track = ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["track"]
        assert [(s["t_s"], float(s["bearing_deg"]), float(s["depth_m"])) for s in track] == TRACK_ROWS


def test_track_input_survives_refresh_skv_02(browser: Browser, app_url: str) -> None:
    _track_input_survives_refresh(browser, app_url, "skv-02")


def test_track_input_survives_refresh_skv_03(browser: Browser, app_url: str) -> None:
    _track_input_survives_refresh(browser, app_url, "skv-03")


def test_start_dive_once(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        dive = plan_dive(app_url, o, "skv-03", next_hour(app_url))
        ok(api(app_url, "POST", f"/api/dives/{dive['id']}/clearance"))
        with console(browser, app_url, "/dives") as page:
            click(page.get_by_role("button", name=f"{dive['id']}, {PEN_NAME['skv-03']}"))
            clearance = page.get_by_role("status", name="Clearance status")
            expect(clearance).to_contain_text("GO — every planned hour is within limits")
            start = page.get_by_role("button", name="Start dive")
            second_press_sends_nothing(page, start, "**/api/dives/**", rf"^/api/dives/{dive['id']}/start$", clearance,
                                       "Starting dive…")
            expect(clearance).to_contain_text("Dive started")
            expect(page.get_by_role("status", name="Dive status")).to_have_text("Dive status: started")
        assert ok(api(app_url, "GET", f"/api/dives/{dive['id']}"))["dive"]["status"] == "started"


def test_dive_choice_newest_wins(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o:
        cleared = plan_dive(app_url, o, "skv-02", next_hour(app_url))
        ok(api(app_url, "POST", f"/api/dives/{cleared['id']}/clearance"))
        planned = plan_dive(app_url, o, "skv-03", next_hour(app_url) + timedelta(hours=1))
        with console(browser, app_url, "/dives") as page:
            status = page.get_by_role("status", name="Dive status")
            clearance = page.get_by_role("status", name="Clearance status")
            newest_choice_wins(
                page, "**/api/dives/**", rf"^/api/dives/{cleared['id']}$",
                lambda: click(page.get_by_role("button", name=f"{cleared['id']}, {PEN_NAME['skv-02']}")),
                lambda: click(page.get_by_role("button", name=f"{planned['id']}, {PEN_NAME['skv-03']}")),
                lambda: status.count() == 1 and status.inner_text().strip() == "Dive status: planned",
                "the second dive's detail")
            assert clearance.count() == 0 or "GO —" not in clearance.inner_text(), "the first dive's clearance never shows"


def _dive_field_errors(app_url: str, change: dict, field: str) -> None:
    body = {"pen_id": "skv-02", "planned_start": iso(next_hour(app_url)), "planned_minutes": 90,
            "diver_certificate_no": "NO-" + tag("cert")[:12], **change}
    field_error(api(app_url, "POST", "/api/dives", body=body), field)


def test_dive_field_errors_minutes_string(app_url: str) -> None:
    _dive_field_errors(app_url, {"planned_minutes": "90"}, "planned_minutes")


def test_dive_field_errors_pen_number(app_url: str) -> None:
    _dive_field_errors(app_url, {"pen_id": 7}, "pen_id")


def test_dive_field_errors_certificate_number(app_url: str) -> None:
    _dive_field_errors(app_url, {"diver_certificate_no": 48213}, "diver_certificate_no")


def test_dive_field_errors_start_null(app_url: str) -> None:
    _dive_field_errors(app_url, {"planned_start": None}, "planned_start")


def ask_for_repair(page: Page, defect_id: str) -> Any:
    copilot = page.get_by_role("region", name="Copilot")
    fill(copilot.get_by_role("textbox", name="Ask the copilot"), "Which repair? " + tag())
    click(copilot.get_by_role("button", name="Ask"))
    expect(page.get_by_role("status", name="Copilot status")).to_contain_text("Copilot answered")
    apply = copilot.get_by_role("button", name=f"Apply repair to {defect_id}")
    expect(apply).to_be_visible()
    return apply


def test_copilot_apply_once(browser: Browser, app_url: str, wiremock: Any) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE)
        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply("Patch " + tag("answer"), [
            ("call_p", "propose_repair", {"defect_id": a["id"], "method": "patch", "note": "Sew a patch"})]))
        with console(browser, app_url, "/pens/skv-03") as page:
            wait_ws(page)
            apply = ask_for_repair(page, a["id"])
            status = page.get_by_role("status", name="Copilot status")
            second_press_sends_nothing(page, apply, "**/api/proposals/**", r"^/api/proposals/[^/]+/apply$", status,
                                       "Applying repair…")
            expect(status).to_contain_text(f"Repair recorded for {a['id']}")
        assert [h["action"] for h in history(app_url, a["id"])].count("repaired") == 1


def _proposal_follows_other_device(browser: Browser, app_url: str, wiremock: Any, change: str) -> None:
    with owned(app_url) as o:
        a = o.defect("skv-03", "hole", 100, 4, HOLE)
        wiremock.stub("POST", "/v1/chat/completions", json=chat_reply("Patch " + tag("answer"), [
            ("call_p", "propose_repair", {"defect_id": a["id"], "method": "patch", "note": "Sew a patch"})]))
        with console(browser, app_url, "/pens/skv-03") as page:
            wait_ws(page)
            apply = ask_for_repair(page, a["id"])
            if change == "repaired":
                ok(api(app_url, "POST", f"/api/defects/{a['id']}/repairs", device=DEV2, body={"method": "lace", "note": "laced"}), 201)
                copy = f"{a['id']} is already repaired"
            else:
                ok(api(app_url, "DELETE", f"/api/defects/{a['id']}", device=DEV2))
                copy = f"{a['id']} was removed"
            live(page, lambda: apply.count() == 0, STREAM_CONNECT_MS, "the Apply button to go")
            live_text(page, page.get_by_role("region", name="Copilot"), copy, LIVE_MS)


def test_proposal_follows_other_device_repaired(browser: Browser, app_url: str, wiremock: Any) -> None:
    _proposal_follows_other_device(browser, app_url, wiremock, "repaired")


def test_proposal_follows_other_device_removed(browser: Browser, app_url: str, wiremock: Any) -> None:
    _proposal_follows_other_device(browser, app_url, wiremock, "removed")


def _copilot_field_errors(app_url: str, wiremock: Any, value: Any) -> None:
    field_error(api(app_url, "POST", "/api/pens/skv-03/copilot", body={"question": value}), "question")
    assert wiremock.requests("/v1/chat/completions", "POST") == []


def test_copilot_field_errors_number(app_url: str, wiremock: Any) -> None:
    _copilot_field_errors(app_url, wiremock, 42)


def test_copilot_field_errors_null_value(app_url: str, wiremock: Any) -> None:
    _copilot_field_errors(app_url, wiremock, None)


def test_copilot_field_errors_list(app_url: str, wiremock: Any) -> None:
    _copilot_field_errors(app_url, wiremock, ["why"])


def test_publish_once(browser: Browser, app_url: str) -> None:
    before = [r["number"] for r in ok(api(app_url, "GET", "/api/pens/skv-02/reports"))["revisions"]]
    n = (before[0] if before else 0) + 1
    with console(browser, app_url, "/reports") as page:
        select(page.get_by_role("combobox", name="Pen"), PEN_NAME["skv-02"])
        status = page.get_by_role("status", name="Report status")
        publish = page.get_by_role("button", name="Publish revision")
        second_press_sends_nothing(page, publish, "**/api/pens/**", r"^/api/pens/skv-02/reports$", status,
                                   "Publishing…")
        expect(status).to_contain_text(f"Published revision {n}")
        expect(page.get_by_role("region", name=f"Revision {n}", exact=True)).to_have_count(1)
    assert [r["number"] for r in ok(api(app_url, "GET", "/api/pens/skv-02/reports"))["revisions"]] == [n, *before]


def _report_pen_newest_wins(browser: Browser, app_url: str, old: str, new: str) -> None:
    for p in ("skv-01", "skv-02", "skv-03"):
        if not ok(api(app_url, "GET", f"/api/pens/{p}/reports"))["revisions"]:
            ok(api(app_url, "POST", f"/api/pens/{p}/reports"), 201)
    with console(browser, app_url, "/reports") as page:
        combo = page.get_by_role("combobox", name="Pen")
        latest = page.get_by_role("region", name="Latest report")
        select(combo, PEN_NAME["skv-03"])
        live(page, lambda: latest.count() == 1 and PEN_NAME["skv-03"] in latest.inner_text(), LIVE_MS, "Skarvholmen 03's latest report")
        newest_choice_wins(
            page, "**/api/pens/**", rf"^/api/pens/{old}(/|$)",
            lambda: select(combo, PEN_NAME[old]), lambda: select(combo, PEN_NAME[new]),
            lambda: latest.count() == 1 and PEN_NAME[new] in latest.inner_text() and PEN_NAME[old] not in latest.inner_text(),
            f"{PEN_NAME[new]}'s latest report")


def test_report_pen_newest_wins_01_then_02(browser: Browser, app_url: str) -> None:
    _report_pen_newest_wins(browser, app_url, "skv-01", "skv-02")


def test_report_pen_newest_wins_02_then_01(browser: Browser, app_url: str) -> None:
    _report_pen_newest_wins(browser, app_url, "skv-02", "skv-01")


def test_bands_keep_focus_on_remote_publish(browser: Browser, app_url: str) -> None:
    n0 = ok(api(app_url, "POST", "/api/pens/skv-02/reports"), 201)["revision"]["number"]
    with console(browser, app_url, "/reports") as page:
        select(page.get_by_role("combobox", name="Pen"), PEN_NAME["skv-02"])
        band = page.get_by_role("region", name=f"Revision {n0}", exact=True)
        restore = band.get_by_role("button", name=f"Restore revision {n0}", exact=True)
        restore.scroll_into_view_if_needed()
        restore.focus()
        page.evaluate("() => { window.__stayed = true; }")
        ok(api(app_url, "POST", "/api/pens/skv-02/reports", device=DEV2), 201)
        live(page, lambda: page.get_by_role("region", name=f"Revision {n0 + 1}", exact=True).count() == 1,
             STREAM_CONNECT_MS, "the tablet's revision")
        advance(page, SETTLE_PAD_MS)
        expect(restore).to_be_focused()
        assert page.evaluate("() => window.__stayed === true"), "no reload"


def _restore_field_errors(app_url: str, value: Any) -> None:
    before = [(d["id"], d.get("version"), d["removed"]) for d in pen(app_url, "skv-02")["defects"]]
    field_error(api(app_url, "POST", "/api/pens/skv-02/restore", body={"revision": value}), "revision")
    assert [(d["id"], d.get("version"), d["removed"]) for d in pen(app_url, "skv-02")["defects"]] == before


def test_restore_field_errors_string(app_url: str) -> None:
    _restore_field_errors(app_url, "1")


def test_restore_field_errors_fraction(app_url: str) -> None:
    _restore_field_errors(app_url, 1.5)


def test_restore_field_errors_null_value(app_url: str) -> None:
    _restore_field_errors(app_url, None)


def _link_field_errors(app_url: str, value: Any) -> None:
    before = [x["id"] for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"]]
    r = api(app_url, "POST", "/api/pens/skv-02/links", body={"expires_in_seconds": value})
    if r.status_code == 201:
        api(app_url, "POST", f"/api/links/{r.json()['link']['id']}/revoke")
    field_error(r, "expires_in_seconds")
    assert [x["id"] for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"]] == before


def test_link_field_errors_fraction(app_url: str) -> None:
    _link_field_errors(app_url, 60.5)


def test_link_field_errors_string(app_url: str) -> None:
    _link_field_errors(app_url, "86400")


def test_link_field_errors_boolean(app_url: str) -> None:
    _link_field_errors(app_url, True)


def test_regenerate_once(browser: Browser, app_url: str) -> None:
    link = create_link(app_url, "skv-02", DAY_S)
    try:
        with console(browser, app_url, "/reports") as page:
            select(page.get_by_role("combobox", name="Pen"), PEN_NAME["skv-02"])
            region = page.get_by_role("region", name="Report links")
            urls = region.get_by_role("textbox", name="Report link URL")
            live(page, lambda: link["url"] in urls.evaluate_all("els => els.map(e => e.value)"), LIVE_MS, "the link's row")
            at = urls.evaluate_all("els => els.map(e => e.value)").index(link["url"])
            regen = region.get_by_role("button", name="Regenerate link").nth(at)
            status = page.get_by_role("status", name="Report status")
            second_press_sends_nothing(page, regen, "**/api/links/**", rf"^/api/links/{link['id']}/regenerate$", status,
                                       "Working…", disabled=False)
            expect(status).to_contain_text("Link regenerated — the old link no longer works")
        now = [x for x in ok(api(app_url, "GET", "/api/pens/skv-02/links"))["links"] if x["id"] == link["id"]][0]
        assert now["token"] != link["token"] and now["expires_at"] == link["expires_at"]
        assert share(app_url, link["token"]).status_code == 410
    finally:
        api(app_url, "POST", f"/api/links/{link['id']}/revoke")


def _share_focus_falls_back(browser: Browser, app_url: str, order: str) -> None:
    with owned(app_url) as o:
        gone = o.defect("skv-02", "chafe", 150, 8, SMALL_CHAFE)
        after = o.defect("skv-02", "chafe", 160, 9, SMALL_CHAFE) if order == "next" else None
        live_ids = [d["id"] for d in pen(app_url, "skv-02")["defects"] if not d["removed"]]
        heir = after["id"] if after else [i for i in live_ids if i < gone["id"]][-1]
        link = create_link(app_url, "skv-02", DAY_S)
        try:
            with console(browser, app_url, link["path"]) as page:
                pin = page.get_by_role("button", name=f"Pin {gone['id']}", exact=True)
                live(page, lambda: pin.count() == 1, LIVE_MS, "the pin")
                pin.focus()
                expect(pin).to_be_focused()
                ok(api(app_url, "DELETE", f"/api/defects/{gone['id']}"))
                advance(page, RECHECK_MS)
                live(page, lambda: pin.count() == 0, LIVE_MS, "the removed pin to go")
                advance(page, SETTLE_PAD_MS)
                expect(page.get_by_role("button", name=f"Pin {heir}", exact=True)).to_be_focused()
        finally:
            api(app_url, "POST", f"/api/links/{link['id']}/revoke")


def test_share_focus_falls_back_next(browser: Browser, app_url: str) -> None:
    _share_focus_falls_back(browser, app_url, "next")


def test_share_focus_falls_back_previous(browser: Browser, app_url: str) -> None:
    _share_focus_falls_back(browser, app_url, "previous")


def _erase_field_errors(app_url: str, value: Any) -> None:
    field_error(api(app_url, "DELETE", "/api/farms/kalamos", body={"confirm_name": value}), "confirm_name")
    assert [f["id"] for f in ok(api(app_url, "GET", "/api/farms"))["farms"]] == ["skarvholmen", "kalamos"]


def test_erase_field_errors_number(app_url: str) -> None:
    _erase_field_errors(app_url, 7)


def test_erase_field_errors_null_value(app_url: str) -> None:
    _erase_field_errors(app_url, None)


def _body_must_be_an_object(app_url: str, body: bytes) -> None:
    before = pen(app_url, "skv-02")
    for method, path in (("POST", "/api/pens/skv-02/defects"), ("POST", "/api/pens/skv-02/links"), ("POST", "/api/dives")):
        field_error(api(app_url, method, path, content=body, headers={"Content-Type": "application/json"}), "body")
    assert pen(app_url, "skv-02")["defects"] == before["defects"]


def test_body_must_be_an_object_array(app_url: str) -> None:
    _body_must_be_an_object(app_url, b"[]")


def test_body_must_be_an_object_string(app_url: str) -> None:
    _body_must_be_an_object(app_url, b'"note"')


def test_body_must_be_an_object_broken(app_url: str) -> None:
    _body_must_be_an_object(app_url, b"{not json")


def test_imports_list_follows_other_device(browser: Browser, app_url: str) -> None:
    t = tag("live")
    first, second = f"{t}-a.csv", f"{t}-b.csv"
    ok(import_csv(app_url, legacy([f"SKV,99,2026-11-01T10:00:00Z,HOLE,10,1,5,5,{t} a"]), name=first), 201)
    with console(browser, app_url, "/imports") as page:
        select(page.get_by_role("combobox", name="Farm"), FARM_SKV)
        old = page.get_by_role("link", name=f"Download original {first}", exact=True)
        expect(old).to_be_visible()
        page.evaluate("() => { window.__stayed = true; }")
        old.focus()
        ok(import_csv(app_url, legacy([f"SKV,99,2026-11-01T10:00:00Z,HOLE,10,1,5,5,{t} b"]), name=second, device=DEV2), 201)
        new = page.get_by_role("link", name=f"Download original {second}", exact=True)
        live(page, lambda: new.count() == 1, STREAM_CONNECT_MS, "the tablet's import")
        advance(page, SETTLE_PAD_MS)
        expect(old).to_be_focused()
        assert box(new)["y"] < box(old)["y"], "the newest import is at the top"
        assert page.evaluate("() => window.__stayed === true"), "no reload"


def test_import_farm_choice_newest_wins(browser: Browser, app_url: str) -> None:
    t = tag("pick")
    skv, klm = f"{t}-skv.csv", f"{t}-klm.csv"
    ok(import_csv(app_url, legacy([f"SKV,99,2026-11-01T10:00:00Z,HOLE,10,1,5,5,{t}"]), name=skv), 201)
    ok(import_csv(app_url, legacy([f"KLM,99,2026-11-01T10:00:00Z,HOLE,10,1,5,5,{t}"]), farm="kalamos", name=klm), 201)
    with console(browser, app_url, "/imports") as page:
        farm = page.get_by_role("combobox", name="Farm")
        skv_link = page.get_by_role("link", name=f"Download original {skv}", exact=True)
        klm_link = page.get_by_role("link", name=f"Download original {klm}", exact=True)
        select(farm, FARM_KLM)
        live(page, lambda: klm_link.count() == 1, LIVE_MS, "Kalamos Marine's imports")
        newest_choice_wins(
            page, "**/api/farms/**", r"^/api/farms/skarvholmen/imports$",
            lambda: select(farm, FARM_SKV), lambda: select(farm, FARM_KLM),
            lambda: klm_link.count() == 1 and skv_link.count() == 0, "Kalamos Marine's imports")


def test_marking_mode_survives_remote_change(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-03") as page:
        wait_ws(page)
        mark = page.get_by_role("button", name="Mark defect")
        click(mark)
        expect(mark).to_have_attribute("aria-pressed", "true")
        wait_line(page, "Marking: tap the net wall")
        page.evaluate("() => { window.__stayed = true; }")
        remote = o.defect("skv-03", "chafe", 300, 10, SMALL_CHAFE, device=DEV2)
        pin = page.get_by_role("button", name=f"Pin {remote['id']}", exact=True)
        live(page, lambda: pin.count() == 1, STREAM_CONNECT_MS, "the tablet's pin")
        live_text(page, page.get_by_role("status", name="Console updates"), f"Deck tablet marked {remote['id']}", LIVE_MS)
        advance(page, FRAME_MS * 2)
        expect(mark).to_have_attribute("aria-pressed", "true")
        assert "Marking: tap the net wall" in scene_lines(page), "marking mode stays on"
        b = box(page.get_by_role("img", name=twin(PEN_NAMES[2])))
        page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        editor = page.get_by_role("region", name="Defect editor")
        expect(editor.get_by_role("heading", name="New defect")).to_be_visible()
        expect(editor).to_contain_text("From the net wall")
        assert page.evaluate("() => window.__stayed === true"), "no reload"


def test_new_defect_input_survives_remote_change(browser: Browser, app_url: str) -> None:
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-03") as page:
        wait_ws(page)
        click(page.get_by_role("button", name="Mark defect"))
        wait_line(page, "Marking: tap the net wall")
        advance(page, FRAME_MS * 2)
        b = box(page.get_by_role("img", name=twin(PEN_NAMES[2])))
        page.mouse.click(b["x"] + b["width"] / 2, b["y"] + b["height"] / 2)
        editor = page.get_by_role("region", name="Defect editor")
        expect(editor.get_by_role("heading", name="New defect")).to_be_visible()
        advance(page, SETTLE_PAD_MS)
        pick_type(editor.get_by_role("combobox", name="Type"), "chafe")
        length = editor.get_by_role("textbox", name="Length (cm)")
        width = editor.get_by_role("textbox", name="Width (cm)")
        fill(length, str(SMALL_CHAFE["length_cm"]))
        fill(width, str(SMALL_CHAFE["width_cm"]))
        note = editor.get_by_role("textbox", name="Note", exact=True)
        fill(note, FIRST_NOTE)
        note.focus()
        note.evaluate("(el, at) => el.setSelectionRange(at, at)", NOTE_CARET)
        remote = o.defect("skv-03", "hole", 300, 10, BIG_HOLE, device=DEV2)
        pin = page.get_by_role("button", name=f"Pin {remote['id']}", exact=True)
        live(page, lambda: pin.count() == 1, STREAM_CONNECT_MS, "the tablet's pin")
        advance(page, SETTLE_PAD_MS)
        expect(editor.get_by_role("heading", name="New defect")).to_be_visible()
        expect(editor).to_contain_text("From the net wall")
        expect(note).to_be_focused()
        assert note.input_value() == FIRST_NOTE, "typed-but-unsent text stays"
        assert note.evaluate("el => [el.selectionStart, el.selectionEnd]") == [NOTE_CARET, NOTE_CARET], "the caret stays"
        assert length.input_value() == str(SMALL_CHAFE["length_cm"]) and width.input_value() == str(SMALL_CHAFE["width_cm"])
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/api/pens/skv-03/defects")) as resp:
            click(editor.get_by_role("button", name="Save"))
        created = keep_created(o, resp.value)
        sent = json.loads(resp.value.request.post_data or "{}")
        assert "wall_point" in sent and "bearing_deg" not in sent, sent
        assert get_defect(app_url, created["id"])["note"] == FIRST_NOTE


def test_import_reaches_open_workspace(browser: Browser, app_url: str) -> None:
    t = tag("ws")
    with owned(app_url) as o, console(browser, app_url, "/pens/skv-02") as page:
        wait_ws(page)
        row = page.get_by_role("button", name=f"{D_BRIDLE}, chafe", exact=True)
        click(row)
        advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
        row.focus()
        camera, selected = scene_line(page, "Camera:"), scene_line(page, "Selected:")
        page.evaluate("() => { window.__stayed = true; }")
        im = ok(import_csv(app_url, legacy([f"SKV,2,2026-11-01T10:00:00Z,HOLE,45,7,20,20,{t} new hole"]), name=f"{t}.csv", device=DEV2), 201)["import"]
        o.ids.extend(c["defect_id"] for c in im["created"])
        assert len(im["created"]) == 1, im
        new_id = im["created"][0]["defect_id"]
        new_row = page.get_by_role("button", name=f"{new_id}, hole", exact=True)
        live(page, lambda: new_row.count() == 1, STREAM_CONNECT_MS, "the imported row")
        expect(page.get_by_role("button", name=f"Pin {new_id}", exact=True)).to_have_count(1)
        advance(page, SETTLE_PAD_MS)
        expect(row).to_be_focused()
        assert scene_line(page, "Camera:") == camera and scene_line(page, "Selected:") == selected
        assert page.evaluate("() => window.__stayed === true"), "no reload"


def test_server_unreachable_keeps_input(browser: Browser, app_url: str, valkey: Any) -> None:
    with owned(app_url) as o:
        did = o.defect("skv-02", "chafe", 210, 5, SMALL_CHAFE)["id"]
        with console(browser, app_url, "/pens/skv-02") as page:
            wait_ws(page)
            editor = open_editor(page, page.get_by_role("button", name=f"{did}, chafe", exact=True), f"Edit {did}")
            wait_lock(page, valkey, did, DEV1)
            note = editor.get_by_role("textbox", name="Note", exact=True)
            fill(note, SECOND_NOTE)

            def cut(route: Any) -> None:
                if route.request.method == "PATCH":
                    route.abort("connectionrefused")
                else:
                    route.fallback()

            page.route(f"**/api/defects/{did}", cut)
            click(editor.get_by_role("button", name="Save"))
            live_text(page, page.get_by_role("status", name="Console updates"),
                      "Pensight server unreachable — changes are not saved", LIVE_MS)
            expect(editor.get_by_role("heading", name=f"Edit {did}")).to_be_visible()
            assert note.input_value() == SECOND_NOTE, "typed-but-unsent text stays"
            assert get_defect(app_url, did)["note"] != SECOND_NOTE
            page.unroute(f"**/api/defects/{did}", cut)
            click(editor.get_by_role("button", name="Save"))
            expect(page.get_by_role("status", name="Editor status")).to_contain_text(f"Saved {did}")
        assert get_defect(app_url, did)["note"] == SECOND_NOTE


def test_shortcuts_dialog_on_share_page(browser: Browser, app_url: str) -> None:
    link = create_link(app_url, "skv-01", DAY_S)
    try:
        with console(browser, app_url, link["path"]) as page:
            wait_text(page, D_HOLE)
            pin = page.get_by_role("button", name=f"Pin {D_HOLE}", exact=True)
            live(page, lambda: pin.count() == 1, STREAM_CONNECT_MS, "the pin")
            pin.focus()
            camera = scene_line(page, "Camera:")
            page.keyboard.press("?")
            dialog = page.get_by_role("dialog", name="Keyboard shortcuts")
            expect(dialog).to_be_visible()
            inside = "(dlg) => dlg.contains(document.activeElement)"
            for key in ["Tab"] * 4 + ["Shift+Tab"] * 4:
                page.keyboard.press(key)
                assert dialog.evaluate(inside), f"{key} left dialog Keyboard shortcuts"
            page.keyboard.press("ArrowRight")
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(dialog).to_have_count(0)
            assert scene_line(page, "Camera:") == camera, "keys are ignored while a dialog is open"
            page.keyboard.press("ArrowRight")
            advance(page, FLY_MAX_MS + SETTLE_PAD_MS)
            assert scene_line(page, "Camera:") != camera, "the arrow keys orbit again once the dialog is closed"
    finally:
        api(app_url, "POST", f"/api/links/{link['id']}/revoke")


@pytest.mark.timeout(240)
def test_link_list_refresh_keeps_caret(browser: Browser, app_url: str) -> None:
    secs = HOUR_S + MINUTE_S + LINK_LEAD_S
    link = create_link(app_url, "skv-03", secs)

    def left() -> int:
        return [x for x in ok(api(app_url, "GET", "/api/pens/skv-03/links"))["links"] if x["id"] == link["id"]][0]["expires_in_s"]

    def line(s: int) -> str:
        return f"(in {s // HOUR_S} h {s % HOUR_S // MINUTE_S} min)"

    try:
        with console(browser, app_url, "/reports") as page:
            select(page.get_by_role("combobox", name="Pen"), "Skarvholmen 03")
            region = page.get_by_role("region", name="Report links")
            urls = region.get_by_role("textbox", name="Report link URL")
            live(page, lambda: link["url"] in urls.evaluate_all("els => els.map(e => e.value)"), LIVE_MS, "the link's row")
            first = line(HOUR_S + MINUTE_S)
            expect(region).to_contain_text(first)
            box_ = urls.nth(urls.evaluate_all("els => els.map(e => e.value)").index(link["url"]))
            box_.focus()
            box_.evaluate("(el, at) => el.setSelectionRange(at, at)", NOTE_CARET)
            deadline = time.monotonic() + LINK_LEAD_S + 30
            while left() >= HOUR_S + MINUTE_S:
                assert time.monotonic() < deadline, "the link's remaining time never ticked down"
                poll_gap()
            advance(page, LINKS_REFRESH_MS + SETTLE_PAD_MS)
            live_text(page, region, line(HOUR_S), LIVE_MS)
            assert first not in region.inner_text(), "the row's line changed in place"
            expect(box_).to_be_focused()
            assert box_.evaluate("el => [el.value, el.selectionStart, el.selectionEnd]") == [link["url"], NOTE_CARET, NOTE_CARET]
    finally:
        api(app_url, "POST", f"/api/links/{link['id']}/revoke")


def test_if_run_manifest() -> None:
    m = json.loads(Path("/app/run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    for k in ("install", "build", "serve"):
        assert isinstance(m[k], str) and m[k].strip()


def test_if_notices() -> None:
    text = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in text]
    assert not missing, missing
    for font in ("Inter Tight", "Inter"):
        assert font in text


def test_if_licences() -> None:
    allowed = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "Zlib", "Unicode-3.0", "MPL-2.0", "CC0-1.0", "OFL-1.1"}
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, allowed)]
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    names = {p.name.lower() for p in shipped_packages()}
    assert not names & {"rusqlite", "libsqlite3-sys", "sqlite", "sled", "redb", "rocksdb", "better-sqlite3", "sqlite3", "lmdb", "heed"}
    skip = {"node_modules", "target", ".git"}
    files = [f for f in DEPLOYED_APP.rglob("*") if f.is_file() and not skip & set(f.relative_to(DEPLOYED_APP).parts)
             and re.search(r"\.(sqlite3?|db)$", f.name)]
    assert not files, files


def test_if_lockfiles() -> None:
    app = Path("/app")
    dirs = [app] + [d for d in app.iterdir() if d.is_dir()]
    assert any((d / "Cargo.lock").is_file() for d in dirs)
    assert any((d / "package-lock.json").is_file() for d in dirs)


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    link = create_link(app_url, "skv-01", DAY_S)
    seen: list[tuple[str, str]] = []
    with console(browser, app_url, "/pens/skv-01") as page:
        page.on("request", lambda r: seen.append((r.url, r.resource_type)))
        page.reload()
        wait_ws(page)
        page.goto(app_url.rstrip("/") + link["path"])
        wait_text(page, "Link expires")
    remote = [u for u, _ in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not remote, remote
    assert any(t == "font" for _, t in seen), "fonts served by the app"
    ok(api(app_url, "POST", f"/api/links/{link['id']}/revoke"))


def test_if_service_config_untouched() -> None:
    provided = {name: os.environ[name] for name in ("DATABASE_URL", "S3_ENDPOINT", "S3_BUCKET", "S3_ACCESS_KEY_ID",
                                                    "S3_SECRET_ACCESS_KEY", "VALKEY_URL", "WIREMOCK_URL")
                if os.environ.get(name)}
    assert provided, "the provided service variables are missing from the verifier environment"
    skip = {"node_modules", "target", ".git"}
    text = {".rs", ".ts", ".tsx", ".js", ".mjs", ".cjs", ".json", ".toml", ".yaml", ".yml", ".sh", ".md", ".env"}
    sources = [f for f in DEPLOYED_APP.rglob("*") if f.is_file() and not skip & set(f.relative_to(DEPLOYED_APP).parts)
               and f.suffix in text]
    own = [str(f.relative_to(DEPLOYED_APP)) for f in sources
           if re.search(r"(^|/)(docker-)?compose\.ya?ml$|wiremock|(^|/)\.env", str(f.relative_to(DEPLOYED_APP)), re.I)]
    assert not own, f"the app ships its own service configuration: {own}"
    read: set[str] = set()
    pasted: list[tuple[str, str]] = []
    for f in sources:
        body = f.read_text(errors="replace")
        read |= {name for name in provided if name in body}
        pasted += [(str(f.relative_to(DEPLOYED_APP)), name) for name, value in provided.items()
                   if len(value) > 8 and value in body]
    assert not pasted, f"a provided credential or service URL is hard-coded: {pasted}"
    assert read == set(provided), f"the app does not read the provided service configuration: {sorted(set(provided) - read)}"

    path = Path("/logs/agent/trajectory.json")
    if not path.is_file():
        return
    config = re.compile(r"(docker-compose|compose\.ya?ml|wiremock/mappings)")

    def writes(node: Any) -> list[str]:
        found: list[str] = []
        if isinstance(node, dict):
            target = node.get("file_path")
            if isinstance(target, str) and config.search(target) and ("new_string" in node or "content" in node):
                found.append(target)
            for v in node.values():
                found += writes(v)
        elif isinstance(node, list):
            for v in node:
                found += writes(v)
        return found

    edited = writes(json.loads(path.read_text(errors="replace")))
    assert not edited, f"service configuration was edited: {edited}"


def test_wf_farm_erasure_erase(browser: Browser, app_url: str, valkey: Any) -> None:
    s3 = S3()
    with owned(app_url) as o:
        d = o.defect("klm-04", "chafe", 10, 3, SMALL_CHAFE)
        ok(upload_still(app_url, d["id"], png()), 201)
        ok(api(app_url, "POST", "/api/defects/D-0008/lock", device=DEV2))
        link = create_link(app_url, "klm-04", DAY_S)
        assert s3.keys("farms/kalamos/")
        e = err(api(app_url, "DELETE", "/api/farms/kalamos", body={"confirm_name": "kalamos marine"}), 422, "validation")
        assert "confirm_name" in e["fields"]
        with console(browser, app_url, link["path"], size=(375, 812), touch=True) as phone, console(browser, app_url, "/") as page, \
                console(browser, app_url, "/pens/skv-02?device=DEV-2", size=(768, 1024), touch=True) as tab:
            wait_text(phone, "D-0008")
            wait_ws(tab)
            tab.goto(app_url.rstrip("/") + "/pens/klm-04")
            wait_ws(tab)
            tab.goto(app_url.rstrip("/") + "/")
            expect(tab.get_by_role("link", name=f"Open pen {PEN_NAME['klm-04']}")).to_have_count(1)
            klm_card = tab.get_by_role("link", name="Kalamos 04", exact=True)
            expect(klm_card).to_have_count(1)
            tab.evaluate("() => { window.__stayed = true; }")
            klm_card.focus()
            click(page.get_by_role("button", name=f"Farm details: {FARM_KLM}"))
            details = page.get_by_role("dialog", name="Farm details")
            opener = details.get_by_role("button", name="Erase farm")
            click(opener)
            dialog = page.get_by_role("dialog", name="Erase farm")
            expect(dialog.get_by_role("button", name="Cancel")).to_be_focused()
            page.keyboard.press("Escape")
            advance(page, SLIDE_OUT_MS)
            expect(dialog).to_have_count(0)
            expect(details).to_be_visible()
            expect(opener).to_be_focused()
            click(opener)
            fill(dialog.get_by_role("textbox", name="Type the farm name to confirm"), "Kalamos Marine")
            erase = dialog.get_by_role("button", name="Erase")
            updates = page.get_by_role("status", name="Console updates")
            second_press_sends_nothing(page, erase, "**/api/farms/**", r"^/api/farms/kalamos$", updates, "Erasing…",
                                       method="DELETE")
            expect(updates).to_contain_text("Erased Kalamos Marine")
            advance(page, SLIDE_OUT_MS)
            expect(dialog).to_have_count(0)
            expect(details).to_have_count(0)
            expect(page.get_by_role("button", name=f"Farm details: {FARM_SKV}")).to_be_focused()
            expect(page.get_by_role("link", name="Kalamos 04", exact=True)).to_have_count(0)
            live(tab, lambda: tab.get_by_role("link", name="Kalamos 04", exact=True).count() == 0
                 and tab.get_by_role("button", name=f"Farm details: {FARM_KLM}").count() == 0,
                 STREAM_CONNECT_MS, "Kalamos Marine leaving the tablet's Pens page")
            advance(tab, SETTLE_PAD_MS)
            expect(tab.get_by_role("link", name=PEN_NAME["skv-03"], exact=True)).to_be_focused()
            expect(tab.get_by_role("link", name=f"Open pen {PEN_NAME['skv-02']}")).to_have_count(1)
            assert tab.evaluate("() => window.__stayed === true"), "no reload"
            advance(phone, RECHECK_MS)
            wait_text(phone, "This report link does not exist", seconds=INACTIVE_WITHIN_S)
        assert [f["id"] for f in ok(api(app_url, "GET", "/api/farms"))["farms"]] == ["skarvholmen"]
        assert "klm-04" not in [p["id"] for p in ok(api(app_url, "GET", "/api/pens"))["pens"]]
        for path in ("/api/pens/klm-04", "/api/defects/D-0008", f"/api/defects/{d['id']}", "/api/farms/kalamos/imports"):
            err(api(app_url, "GET", path), 404, "not_found")
        err(share(app_url, link["token"]), 404, "not_found")
        assert api(app_url, "GET", link["path"], device=None).status_code == 404
        assert ok(search(app_url, "kal"))["results"] == []
        body = api(app_url, "GET", "/api/exports/defects.csv").text
        assert "Kalamos" not in body and "D-0008" not in body
        assert s3.keys("farms/kalamos/") == []
        assert lock_value(valkey, "D-0008") is None
        o.ids.clear()
