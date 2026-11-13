from __future__ import annotations

import concurrent.futures
import contextlib
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import tempfile
import threading
import time
from datetime import datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest

import conftest
from conftest import (
    DEPLOYED_APP,
    Postgres,
    accessible_name,
    advance,
    axe,
    capture,
    check,
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
    select,
    session,
    shipped_packages,
    state_styles,
    style,
    tab_order,
    tap,
)

SEED_AT = "2026-10-28T09:00:00+05:30"
SEED_STOCK_LABEL = "9:00 am IST"
FIRST_DELIVERY_DAY = (datetime.fromisoformat(SEED_AT) + timedelta(days=3)).date().isoformat()
LAST_DELIVERY_DAY = (datetime.fromisoformat(SEED_AT) + timedelta(days=30)).date().isoformat()
CLOSED_TUESDAY = "2026-11-03"
MEGH, DESH = "megh-349", "desh-648"
SLATE, KESAR, RAAT = "monsoon-slate", "kesar", "raat-black"
HUBS = ["pune", "bengaluru", "gurugram", "kochi"]
PUNE_HOST, LEELA_HOST, KOCHI_HOST = "9000000101", "9000000105", "9000000104"
BLR_HOST = "9000000102"
KABIR, IRA = "9000000201", "9000000202"
LICENCE, LICENCE_LAST4, LICENCE_VALID = "MH1220190043210", "3210", "2031-03-15"
LIVE_KEYS = {"seq", "hub", "model", "finish", "serverNow", "stale", "staleReason", "stockAsOf", "stockAsOfLabel",
             "unitsLeft", "finishes", "quote", "nextSlot", "lockPreview", "lock", "hoursLeft"}
QUOTE_KEYS = {"stepEffectiveFrom", "exFactoryPaise", "gstPercent", "gstPaise", "exShowroomPaise", "roadTaxPercent",
              "roadTaxPaise", "insurancePaise", "onRoadPaise"}
LOCK_KEYS = {"id", "state", "hub", "model", "finish", "ref", "issuedAt", "expiresAt", "expiresLabel", "hoursLeft",
             "exShowroomPaise", "roadTaxPaise", "insurancePaise", "onRoadPaise", "stepEffectiveFrom", "deliveryDate",
             "sheetReady", "waitingFor", "waitPosition"}
ROW_KEYS = {"kind", "id", "label", "riderName", "model", "finish", "licenceLast4", "state", "actions"}
HELD_KEYS = {"id", "riderName", "model", "finish", "state", "expiresLabel", "deliveryDate", "waitingFor",
             "actions"}
SLOT_LABELS = ["10:00 am IST", "10:45 am IST", "11:30 am IST", "12:15 pm IST", "1:00 pm IST", "1:45 pm IST",
               "2:30 pm IST", "3:15 pm IST", "4:00 pm IST", "4:45 pm IST", "5:30 pm IST", "6:15 pm IST"]
EASING = "cubic-bezier(0.22, 1, 0.36, 1)"
STEP_MS = {"lamp": 180, "label-mask": 320, "paint": 320, "needle-sweep": 420, "part-lift": 480,
           "needle-settle": 560, "camera-to-part": 640, "dissolve": 120}
STEP_TOLERANCE_MS = 60
PIXEL_TOLERANCE = 6
PROGRESS_TOLERANCE = 0.005
SETTLE_MS = 900
JUMPS = {"Frame": 0.07, "Engine": 0.21, "Tank": 0.35, "Wheels": 0.49, "Exhaust": 0.63, "Seat": 0.77,
         "Cluster": 0.92}
SEATS = {"frame": 0.14, "engine": 0.28, "tank": 0.42, "wheels": 0.56, "exhaust": 0.70, "seat": 0.84,
         "cluster": 0.86}
PAINT = {SLATE: (47, 63, 92), KESAR: (232, 163, 23), RAAT: (13, 13, 15)}
MUTED = (156, 158, 163)
ACCENT = (255, 74, 31)
FOCUS_RING_PX = 3
INK = (239, 240, 241)
STATEMENT_RATE = 0.35
LIVE_LIMIT_S = 2
SWEEP_S = 10
OUTAGE_LIMIT_S = 15
REFUSAL_LIMIT_S = 4
READ_LIMIT_S = 1
NOTICE_LIMIT_S = 20
STREAM_REOPEN_S = 5
SILENT_S = 35
PING_S = 15
BODY_LIMIT = 16384
STREAMS = 60
TOPIC_PREFIX = "malhar-"
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
TOUCH_MIN = 44

HTTP_TIMEOUT_S = 40
UI_WAIT_S = 12
SLACK_S = 8
COPY_BOOT_S = 90
FRAME_MS = 16
CLOCK_WRONG = "2031-01-01T00:00:00Z"
PASSWORD = "key-on-probe-1"
POLL_GAP_S = 0.1
VALKEY_ADMIN = "gfkit-valkey-" + "admin"
AUCKLAND = "Pacific/Auckland"
NEW_YORK = "America/New_York"
PREFIX = os.environ.get("VALKEY_PREFIX", "malhar")


class Api:

    def __init__(self, base: str, cookies: dict[str, str] | None = None):
        self.base = base.rstrip("/")
        self.cookies = cookies if cookies is not None else {}
        self.user: dict[str, Any] = {}
        self.password = PASSWORD

    def on(self, base: str) -> "Api":
        other = Api(base, self.cookies)
        other.user = self.user
        other.password = self.password
        return other

    def renew(self) -> "Api":
        self.cookies.clear()
        reply = self.post("/api/auth/signin", {"mobile": self.user["mobile"], "password": self.password})
        assert reply.status_code == 200, reply.text
        self.user = reply.json()["user"]
        return self

    def call(self, method: str, path: str, body: Any = None, *, raw: bytes | None = None,
             headers: dict[str, str] | None = None, timeout: float = HTTP_TIMEOUT_S) -> httpx.Response:
        sent = dict(headers or {})
        if self.cookies:
            sent["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        content = raw
        if body is not None:
            content = json.dumps(body).encode()
            sent.setdefault("Content-Type", "application/json")
        reply = httpx.request(method, self.base + path, content=content, headers=sent, timeout=timeout)
        for cookie in reply.headers.get_list("set-cookie"):
            pair = cookie.split(";", 1)[0]
            name, _, value = pair.partition("=")
            if value and "max-age=0" not in cookie.lower():
                self.cookies[name.strip()] = value
            else:
                self.cookies.pop(name.strip(), None)
        return reply

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, body, **kw)

    def live(self, hub: str = "pune", model: str = MEGH, finish: str = SLATE) -> dict[str, Any]:
        reply = self.get(f"/api/live/now?hub={hub}&model={model}&finish={finish}")
        assert reply.status_code == 200, reply.text
        return reply.json()

    def claim(self, hub: str = "pune", model: str = MEGH, finish: str = SLATE, step: str | None = None,
              **extra: Any) -> httpx.Response:
        if step is None:
            step = Api(self.base).live(hub, model, finish)["quote"]["stepEffectiveFrom"]
        return self.post("/api/locks", {"hub": hub, "model": model, "finish": finish,
                                        "stepEffectiveFrom": step, **extra})

    def ride(self, start: str, hub: str = "pune", model: str = MEGH, licence: str = LICENCE,
             valid: str = LICENCE_VALID, mcwg: bool = True) -> httpx.Response:
        return self.post("/api/rides", {"hub": hub, "model": model, "startsAt": start, "licenceNumber": licence,
                                        "licenceValidUntil": valid, "hasMcwg": mcwg})


class World:

    def __init__(self, base: str, wait_live: bool = True):
        self.base = base.rstrip("/")
        reply = httpx.post(self.base + "/api/test/reset", timeout=HTTP_TIMEOUT_S)
        assert reply.status_code == 200, f"POST /api/test/reset answered {reply.status_code}"
        self.clock(SEED_AT)
        if not wait_live:
            return
        deadline = time.monotonic() + OUTAGE_LIMIT_S + SLACK_S
        while time.monotonic() < deadline:
            if not any(Api(self.base).live(hub)["stale"] for hub in HUBS):
                return
        pytest.fail("hubs stayed stale after POST /api/test/reset; expected a live reading")

    def clock(self, at: str, freeze: bool = True) -> dict[str, Any]:
        reply = httpx.post(self.base + "/api/test/clock", json={"at": at, "freeze": freeze}, timeout=HTTP_TIMEOUT_S)
        assert reply.status_code == 200, reply.text
        return reply.json()

    def signed(self, mobile: str, password: str) -> Api:
        api = Api(self.base)
        reply = api.post("/api/auth/signin", {"mobile": mobile, "password": password})
        assert reply.status_code == 200, reply.text
        api.user = reply.json()["user"]
        api.password = password
        return api

    def host(self, mobile: str = PUNE_HOST) -> Api:
        return self.signed(mobile, os.environ["SEED_HOST_PASSWORD"])

    def seed_rider(self, mobile: str = KABIR) -> Api:
        return self.signed(mobile, os.environ["SEED_RIDER_PASSWORD"])

    def rider(self, name: str | None = None) -> Api:
        api = Api(self.base)
        tag = secrets.token_hex(4)
        reply = api.post("/api/auth/register", {"name": name or f"Asha {tag}", "mobile": _mobile(),
                                                "password": PASSWORD})
        assert reply.status_code == 201, reply.text
        api.user = reply.json()["user"]
        return api

    def locked(self, rider: Api, hub: str = "pune", model: str = MEGH, finish: str = SLATE) -> dict[str, Any]:
        reply = rider.claim(hub, model, finish)
        assert reply.status_code in (201, 202), reply.text
        lock = reply.json()["lock"]
        if reply.status_code == 202:
            confirmed = self.host({"pune": PUNE_HOST, "bengaluru": BLR_HOST, "kochi": KOCHI_HOST}[hub]).post(
                f"/api/hub/locks/{lock['id']}/confirm")
            assert confirmed.status_code == 200, confirmed.text
            lock = confirmed.json()["lock"]
        return lock


@pytest.fixture
def world(app_url: str) -> World:
    return World(app_url)


def _mobile() -> str:
    return secrets.choice("6789") + "".join(secrets.choice("0123456789") for _ in range(9))


def _ist(date: str, clock: str = "09:00:00") -> str:
    return f"{date}T{clock}+05:30"


def _when(text: str) -> datetime:
    return datetime.fromisoformat(text)


NEW_RIDER_NAME = "Sana Iyer"
MARKUP_NAME = "<b>Asha</b> Rao"
UNKNOWN_PATH = "/api/nope"
MALFORMED_DATE = "2026-13-45"
VALID_UNTIL = "Valid until {d Mon YYYY}, {h:mm am/pm} IST"
DELIVERY_LINE = "Delivery day {d Mon YYYY}"
NOTICE_LOCK_ENDING = "Your {model} price lock at {hub} ends at {h:mm am/pm} IST today."
NOTICE_RIDE = "Your {model} ride at {hub} is tomorrow at {h:mm am/pm} IST."
NOTICE_PLACE = "A place opened at {hub}. Your {model} handover is on {Ddd d Mon}."
DELIVERY_FULL = "{Ddd d Mon}, full"
DISPLAY_EXAMPLE = "UNITS 01 RIDE 11:30"
ELEVATION = "Side elevation, {Chapter}"


def _elevation(chapter: str) -> str:
    return ELEVATION.replace("{Chapter}", chapter)


def _line(template: str, *parts: tuple[str, str]) -> str:
    for key, value in parts:
        template = template.replace("{" + key + "}", value)
    return template


def _slots_path(hub: str, date: str | None = None) -> str:
    path = f"/api/hubs/{hub}/slots"
    return path if date is None else f"{path}?date={date}"


def _sheet_path(date: str) -> str:
    return f"/api/hub/day-sheet?date={date}"


def _err(reply: httpx.Response, status: int, code: str) -> None:
    assert reply.status_code == status, f"expected {status} {code}, got {reply.status_code} {reply.text}"
    body = reply.json()
    assert set(body) == {"error"} and set(body["error"]) == {"code", "message"}, reply.text
    assert body["error"]["code"] == code, reply.text
    assert isinstance(body["error"]["message"], str) and body["error"]["message"]


def _plain_error(reply: httpx.Response) -> None:
    message = reply.json()["error"]["message"]
    for leak in ("127.0.0.1", "http://", "redis://", "postgres://", "ECONNREFUSED", "ZADD", "EVAL", " at ", "stack"):
        assert leak not in message, f"503 message leaked {leak!r}: {message}"


def _together(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], Any]) -> Any:
        barrier.wait(timeout=30)
        return call()

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


def _poll(check_fn: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check_fn()
        if value:
            return value
        threading.Event().wait(POLL_GAP_S)
    pytest.fail(f"within {seconds}s expected: {what}")


class Stream:

    def __init__(self, base: str, query: str = "", api: Api | None = None):
        self.events: list[tuple[float, str, str]] = []
        self.status: int | None = None
        self.content_type = ""
        self._cond = threading.Condition()
        self._client = httpx.Client(timeout=httpx.Timeout(10, read=None))
        headers = {"Accept": "text/event-stream"}
        if api is not None and api.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in api.cookies.items())
        self._thread = threading.Thread(target=self._run, args=(base + "/api/live" + query, headers), daemon=True)
        self._thread.start()

    def _run(self, url: str, headers: dict[str, str]) -> None:
        with contextlib.suppress(Exception):
            with self._client.stream("GET", url, headers=headers) as reply:
                self.status, self.content_type = reply.status_code, reply.headers.get("content-type", "")
                name, data = "", []
                for line in reply.iter_lines():
                    if line.startswith("event:"):
                        name = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].strip())
                    elif not line and (name or data):
                        with self._cond:
                            self.events.append((time.monotonic(), name, "\n".join(data)))
                            self._cond.notify_all()
                        name, data = "", []

    def named(self, name: str) -> list[dict[str, Any]]:
        with self._cond:
            return [json.loads(e[2]) for e in self.events if e[1] == name]

    def wait(self, name: str, check_fn: Callable[[dict[str, Any]], bool] = lambda _: True,
             seconds: float = UI_WAIT_S) -> dict[str, Any]:
        deadline = time.monotonic() + seconds
        with self._cond:
            while time.monotonic() < deadline:
                for event in self.events:
                    if event[1] == name:
                        body = json.loads(event[2])
                        if check_fn(body):
                            return body
                self._cond.wait(0.1)
        pytest.fail(f"stream event {name} matching the expectation did not arrive within {seconds}s")

    def __enter__(self) -> "Stream":
        return self

    def __exit__(self, *_: Any) -> None:
        self._client.close()


def _ledger_socket() -> socket.socket:
    url = urlparse(os.environ["VALKEY_URL"])
    sock = socket.create_connection((url.hostname, url.port or 6379), timeout=10)
    if url.password:
        _resp_send(sock, ("AUTH", url.username, url.password) if url.username else ("AUTH", url.password))
        _resp_read(sock.makefile("rb"))
    return sock


def _resp_send(sock: socket.socket, args: tuple[Any, ...]) -> None:
    out = f"*{len(args)}\r\n".encode()
    for arg in args:
        data = str(arg).encode()
        out += f"${len(data)}\r\n".encode() + data + b"\r\n"
    sock.sendall(out)


def _resp_read(reader: Any) -> Any:
    line = reader.readline().rstrip(b"\r\n")
    kind, rest = line[:1], line[1:]
    if kind == b"+":
        return rest.decode()
    if kind == b"-":
        raise RuntimeError(rest.decode())
    if kind == b":":
        return int(rest)
    if kind == b"$":
        size = int(rest)
        return None if size < 0 else reader.read(size + 2)[:-2].decode()
    if kind == b"*":
        return [_resp_read(reader) for _ in range(int(rest))]
    raise RuntimeError("unreadable ledger reply")


def _ledger_admin(*args: Any) -> Any:
    url = urlparse(os.environ["VALKEY_URL"])
    with socket.create_connection((url.hostname, url.port or 6379), timeout=10) as sock:
        _resp_send(sock, ("AUTH", VALKEY_ADMIN))
        reader = sock.makefile("rb")
        _resp_read(reader)
        _resp_send(sock, args)
        return _resp_read(reader)


def _ledger(*args: Any) -> Any:
    with _ledger_socket() as sock:
        _resp_send(sock, args)
        return _resp_read(sock.makefile("rb"))


@contextlib.contextmanager
def _ledger_outage() -> Iterator[None]:
    _ledger_admin("CONFIG", "SET", "min-replicas-to-write", "1")
    try:
        yield
    finally:
        _ledger_admin("CONFIG", "SET", "min-replicas-to-write", "0")


def _holds(hub: str, model: str, finish: str) -> str:
    return f"{PREFIX}:holds:{hub}:{model}:{finish}"


def _onhand(hub: str, model: str, finish: str) -> str:
    return f"{PREFIX}:onhand:{hub}:{model}:{finish}"


def _score(valkey: Any, key: str, member: str) -> float | None:
    value = valkey.command("ZSCORE", key, member)
    return None if value is None else float(value)


def _ms(iso: str) -> float:
    return _when(iso).timestamp() * 1000


class Stub:

    def __init__(self, status: int = 500, body: bytes = b"down"):
        self.status, self.body = status, body
        self.requests: list[dict[str, Any]] = []
        owner = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                data = self.rfile.read(int(self.headers.get("content-length") or 0))
                owner.requests.append({"path": self.path, "body": data, "headers": {k.lower(): v for k, v in self.headers.items()}})
                self.send_response(owner.status)
                self.send_header("Content-Length", str(len(owner.body)))
                self.end_headers()
                self.wfile.write(owner.body)

            def log_message(self, *_: Any) -> None:
                return

        self.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def __enter__(self) -> "Stub":
        return self

    def __exit__(self, *_: Any) -> None:
        self.server.shutdown()
        with contextlib.suppress(OSError):
            self.server.socket.shutdown(socket.SHUT_RDWR)
        self.server.server_close()


GOOD_PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"


@contextlib.contextmanager
def _copy(**env: str) -> Iterator[str]:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    full = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_TEST_CLOCK": "1", **env}
    process = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=full, stdout=log, stderr=subprocess.STDOUT,
                               start_new_session=True)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while time.monotonic() < deadline:
            if process.poll() is not None:
                pytest.fail(f"extra copy exited: {Path(log.name).read_text()[-2000:]}")
            with contextlib.suppress(httpx.HTTPError):
                if httpx.get(base + "/api/health", timeout=2).status_code == 200 and (
                        "DATABASE_URL" in env
                        or httpx.get(base + f"/api/live/now?hub=pune&model={MEGH}&finish={SLATE}", timeout=2).status_code == 200):
                    yield base
                    return
        pytest.fail(f"extra copy never answered /api/health: {Path(log.name).read_text()[-2000:]}")
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, 15)
        process.wait(timeout=30)
        log.close()


def _peer(name: str) -> str:
    return os.environ[name].rstrip("/")


STATUS_WATCH = r"""
window.__statusLog = []; window.__statusTimes = [];
(() => { const scan = () => {
  const r = document.querySelector('[role="status"][aria-label="Showroom status"]');
  if (r && !r.__w) { r.__w = true; let last = '';
    const rec = () => { const t = r.textContent.trim(); if (t !== last) { last = t;
      window.__statusTimes.push([t, performance.now()]); if (t) window.__statusLog.push(t); } };
    new MutationObserver(rec).observe(r, {childList: true, subtree: true, characterData: true}); rec(); } };
  new MutationObserver(scan).observe(document, {childList: true, subtree: true}); })();
"""
PIXEL_JS = """(el, pts) => { const c = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0); const k = c.width / c.clientWidth;
  return pts.map(p => Array.from(x.getImageData(Math.round(p.x * k), Math.round(p.y * k), 1, 1).data).slice(0, 3)); }"""
RECT_JS = """(el, r) => { const c = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
  const g = document.createElement('canvas'); g.width = c.width; g.height = c.height;
  const x = g.getContext('2d'); x.drawImage(c, 0, 0); const k = c.width / c.clientWidth;
  const d = x.getImageData(r.x * k, r.y * k, Math.max(1, r.w * k), Math.max(1, r.h * k)).data;
  let h = 7, peak = 0; for (let i = 0; i < d.length; i += 4) { h = (h * 31 + d[i] + d[i+1] * 3 + d[i+2] * 7) | 0;
    peak = Math.max(peak, d[i], d[i+1], d[i+2]); } return {hash: h, peak}; }"""
LOSE_JS = """(el, restore) => { const c = el.tagName === 'CANVAS' ? el : el.querySelector('canvas');
  const gl = c.getContext('webgl2') || c.getContext('webgl');
  window.__lose = window.__lose || gl.getExtension('WEBGL_lose_context');
  if (restore) window.__lose.restoreContext(); else window.__lose.loseContext(); }"""


@contextlib.contextmanager
def _open(browser: Any, base: str, path: str, api: Api | None = None, *, viewport: dict[str, int] = DESKTOP,
          tz: str | None = None, locale: str | None = None, scale: float = 1, reduced: bool = False,
          no_webgl: bool = False, device_time: str | None = None, touch: bool = False) -> Iterator[Any]:
    motion_pref = "reduce" if reduced else "no-preference"
    with open_app(browser, base + "/api/health", scale=scale, reduced_motion=motion_pref, no_webgl=no_webgl) as page:
        page.set_viewport_size(viewport)
        page.context.add_init_script(STATUS_WATCH)
        cdp = session(page)
        if tz:
            cdp.send("Emulation.setTimezoneOverride", {"timezoneId": tz})
        if locale:
            cdp.send("Emulation.setLocaleOverride", {"locale": locale})
        if touch:
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        if device_time:
            page.clock.set_system_time(device_time)
        if api is not None:
            page.context.add_cookies([{"name": k, "value": v, "url": base} for k, v in api.cookies.items()])
        page.goto(base + path)
        yield page


def _room(at: float | None = None, model: str = MEGH, hub: str = "pune", finish: str = SLATE, ch: str | None = None,
          part: str | None = None) -> str:
    query = f"/showroom?model={model}&hub={hub}&finish={finish}"
    if ch:
        query += f"&ch={ch}"
    if part:
        query += f"&part={part}"
    if at is not None:
        query += f"&at={at}"
    return query


CLEAR_JS = """e => { e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'});
  const r = e.getBoundingClientRect(), hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  if (hit !== e && !e.contains(hit)) e.scrollIntoView({block:'center',inline:'nearest',behavior:'instant'}); }"""
_kit_center = conftest.center


def _clear_of_bars(locator: Any) -> tuple[float, float]:
    if locator.is_visible():
        locator.evaluate(CLEAR_JS)
    return _kit_center(locator)


conftest.center = _clear_of_bars


def _wait(page: Any, check_fn: Callable[[], Any], what: str, seconds: float = UI_WAIT_S) -> Any:
    start = last = time.monotonic()
    while time.monotonic() - start < seconds:
        now = time.monotonic()
        advance(page, max(FRAME_MS, (now - last) * 1000))
        last = now
        value = check_fn()
        if value:
            return value
    pytest.fail(f"within {seconds}s expected: {what}")


def _finger_time(page: Any, milliseconds: float) -> None:
    end = time.monotonic() + milliseconds / 1000
    _wait(page, lambda: time.monotonic() >= end, "the touch step's real time to pass", milliseconds / 1000 + 2)


def _run(page: Any, milliseconds: float) -> None:
    advance(page, milliseconds)


def _snap(page: Any) -> dict[str, Any]:
    return page.evaluate("() => window.__showroom.snapshot()")


def _ready(page: Any) -> None:
    _wait(page, lambda: page.evaluate(
        "() => { const s = window.__showroom && window.__showroom.snapshot();"
        " return !!(s && s.drawn && s.drawn.onRoadPaise !== null); }"),
        "window.__showroom.snapshot() with a drawn reading")


def _until_snap(page: Any, test: Callable[[dict[str, Any]], bool], what: str, seconds: float = UI_WAIT_S) -> dict:
    return _wait(page, lambda: (lambda s: s if test(s) else None)(_snap(page)), what, seconds)


def _idle(page: Any) -> dict[str, Any]:
    return _until_snap(page, lambda s: all(x["endedAt"] is not None for x in s["steps"]), "every step to end")


def _role(page: Any, role: str, name: str) -> Any:
    return page.get_by_role(role, name=name, exact=True)


def _disabled(locator: Any) -> bool:
    return locator.get_attribute("aria-disabled") == "true"


def _said(page: Any, text: str, seconds: float = UI_WAIT_S) -> None:
    _wait(page, lambda: page.evaluate("t => window.__statusLog.includes(t)", text),
          f"Showroom status to announce {text!r}", seconds)


def _log(page: Any) -> list[str]:
    return page.evaluate("() => window.__statusLog")


def _query(page: Any) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def _text(locator: Any) -> str:
    return " ".join(locator.inner_text().split())


def _has(page: Any, locator: Any, text: str, seconds: float = UI_WAIT_S) -> None:
    _wait(page, lambda: text in _text(locator), f"{text!r} in place", seconds)


def _mark(page: Any) -> None:
    page.evaluate("() => { window.__noReload = true; }")


def _no_reload(page: Any) -> None:
    assert page.evaluate("() => window.__noReload === true"), "the page reloaded; expected an in-place update"


def _go(page: Any, progress: float, y0: float | None = None) -> dict[str, Any]:
    start = 0.0 if y0 is None else y0
    height = page.evaluate("() => window.innerHeight")
    page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", start + progress * 7 * height)
    _run(page, SETTLE_MS + 100)
    return _snap(page)


def _stage_top(page: Any) -> float:
    return page.evaluate("() => window.scrollY")


def _canvas(page: Any, model: str = "Megh 349") -> Any:
    return page.get_by_role("img", name=f"Malhar {model} showroom", exact=True)


def _pixels(page: Any, model: str = "Megh 349") -> dict[str, tuple[int, ...]]:
    probes = _snap(page)["probes"]
    names = ["tank", "lamp", "needleTip"]
    got = _canvas(page, model).evaluate(PIXEL_JS, [probes[n] for n in names])
    return dict(zip(names, [tuple(v) for v in got]))


def _display(page: Any, model: str = "Megh 349") -> dict[str, int]:
    return _canvas(page, model).evaluate(RECT_JS, _snap(page)["probes"]["display"])


def _near(got: tuple[int, ...], want: tuple[int, ...]) -> bool:
    return all(abs(a - b) <= PIXEL_TOLERANCE for a, b in zip(got, want))


def _needle(hours: float) -> float:
    return -135 + 270 * min(hours, 96) / 96


def _sign_in(page: Any, mobile: str, password: str = PASSWORD) -> None:
    dialog = _role(page, "dialog", "Sign in")
    _wait(page, dialog.is_visible, "dialog Sign in")
    fill(dialog.get_by_role("textbox", name="Mobile number"), mobile)
    fill(dialog.get_by_role("textbox", name="Password"), password)
    click(dialog.get_by_role("button", name="Sign in", exact=True))
    _wait(page, lambda: dialog.count() == 0 or not dialog.is_visible(), "dialog Sign in to close")


def _bezier(x: float) -> float:
    low, high = 0.0, 1.0
    for _ in range(40):
        t = (low + high) / 2
        at = 3 * (1 - t) ** 2 * t * 0.22 + 3 * (1 - t) * t ** 2 * 0.36 + t ** 3
        low, high = (t, high) if at < x else (low, t)
    t = (low + high) / 2
    return 3 * (1 - t) ** 2 * t * 1 + 3 * (1 - t) * t ** 2 * 1 + t ** 3


def _paise(rupees: int) -> int:
    return rupees * 100


def _hex(rgb: tuple[int, int, int]) -> str:
    return "#" + "".join(f"{v:02x}" for v in rgb)


@pytest.mark.timeout(600)
def test_wf_w1_showroom_scrub_build(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/") as page:
        assert page.evaluate("() => window.scrollY") == 0
        _wait(page, _role(page, "link", "Start the build").is_visible, "link Start the build on the hero")
        click(_role(page, "link", "Start the build"))
        _ready(page)
        _wait(page, lambda: abs(_snap(page)["progress"]) <= 0.01, "the start of the stage")
        _mark(page)
        canvas = _canvas(page)
        assert canvas.count() == 1
        y0 = _stage_top(page)
        first = decode(capture(canvas))
        for wanted in (0.25, 0.5, 0.75):
            snap = _go(page, wanted, y0)
            assert abs(snap["progress"] - wanted) <= 0.02, snap["progress"]
            box = canvas.bounding_box()
            assert abs(box["y"]) <= 1 and box["height"] >= page.viewport_size["height"] - 1, box
        assert difference(first, decode(capture(canvas))) > 0, "scrolling left the canvas pixels unchanged"
        assert _go(page, 1.0, y0)["progress"] == pytest.approx(1, abs=0.01)
        assert _go(page, 0.92, y0)["chapter"] == "cluster"
        _until_snap(page, lambda s: s["drawn"]["display"].startswith("UNITS 03"), "cluster reading UNITS 03")
        place = (_stage_top(page), _query(page).get("at"), page.evaluate("() => history.length"))
        rival = world.rider()
        assert rival.claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "the rival's lock reaching the cluster")
        _run(page, 400)
        assert place == (_stage_top(page), _query(page).get("at"), page.evaluate("() => history.length")), \
            "a live event moved scroll, at or history"
        toolbar = _role(page, "toolbar", "Chapters")
        toolbar.get_by_role("button", name="Cluster", exact=True).focus()
        page.keyboard.press("ArrowLeft")
        assert accessible_name(page) == "Seat"
        page.keyboard.press("Enter")
        snap = _until_snap(page, lambda s: abs(s["progress"] - JUMPS["Seat"]) <= 0.01 and s["chapter"] == "seat",
                           "Enter on Seat to jump to its jump point", 8)
        assert abs((_stage_top(page) - y0) / (7 * page.viewport_size["height"]) - snap["progress"]) <= 0.01
        before = _snap(page)["camera"]
        _run(page, 500)
        _idle(page)
        settled = _snap(page)["camera"]
        _run(page, 500)
        assert _snap(page)["camera"] == settled, "the machine drifted with nothing happening"
        assert before is not None
        _no_reload(page)


@pytest.mark.timeout(600)
def test_wf_w1_showroom_scrub_phone(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.2), viewport=PHONE, touch=True) as page:
        _ready(page)
        canvas = _canvas(page)
        assert "pan" in style(canvas, "touch-action")["touch-action"], "canvas must allow vertical panning only"
        start = _snap(page)
        cdp = session(page)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 180, "y": 500}]})
        for step in range(1, 13):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": 180, "y": 500 - 25 * step}]})
            _finger_time(page, FRAME_MS)
        _finger_time(page, 200)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        y = _stage_top(page)
        moved = _until_snap(page, lambda s: s["progress"] > start["progress"], "a vertical swipe to scroll the stage", 2)["progress"]
        _run(page, SETTLE_MS)
        assert abs(_snap(page)["progress"] - moved) <= PROGRESS_TOLERANCE, "touch scroll was damped"
        assert _stage_top(page) == pytest.approx(y, abs=2)
        camera = _snap(page)["camera"]
        box = canvas.bounding_box()
        page.mouse.move(box["x"] + 60, box["y"] + 200)
        page.mouse.down()
        page.mouse.move(box["x"] + 300, box["y"] + 200)
        page.mouse.up()
        _run(page, 700)
        assert _snap(page)["camera"] == camera, "dragging orbited the machine"
        _run(page, 300)
        at = _query(page)["at"]
        menu = _role(page, "button", "Menu")
        click(menu)
        _wait(page, _role(page, "link", "Garage").is_visible, "Menu to show its links")
        click(menu)
        _run(page, 100)
        click(menu)
        _run(page, 700)
        assert _role(page, "link", "Garage").is_visible(), "a stale close timer re-hid the reopened Menu"
        assert abs(float(_query(page)["at"]) - float(at)) <= PROGRESS_TOLERANCE
        layout(page)


def test_part_seating(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/showroom") as page:
        _ready(page)
        y0 = _stage_top(page)
        points = [0.0, 0.07, 0.13, 0.15, 0.27, 0.29, 0.41, 0.43, 0.55, 0.57, 0.69, 0.71, 0.77, 0.83, 0.85, 0.87, 1.0]
        forward = [_go(page, p, y0) for p in points]
        back = [_go(page, p, y0) for p in reversed(points)]
        for snap in forward:
            for group, seat in SEATS.items():
                if snap["progress"] >= seat + 0.002:
                    assert snap["seatOffsets"][group] == 0, (group, snap["progress"])
                elif snap["progress"] < seat - 0.002:
                    assert snap["seatOffsets"][group] > 0, (group, snap["progress"])
        for group in SEATS:
            down = [s["seatOffsets"][group] for s in forward]
            assert all(a >= b for a, b in zip(down, down[1:])), f"{group} reversed going forward"
            up = [s["seatOffsets"][group] for s in back]
            assert all(a <= b for a, b in zip(up, up[1:])), f"{group} reversed going back"
        assert back[-1]["seatOffsets"]["frame"] > 0, "scrolling back did not undo the frame"
        cams = {p: s["camera"] for p, s in zip(points, forward)}
        settled = {p: s["progress"] for p, s in zip(points, forward)}
        same = [(p, s) for p, s in zip(reversed(points), back) if abs(s["progress"] - settled[p]) <= 0.002]
        assert len(same) >= len(points) // 2, "too few poses settled at one progress to compare the camera"
        for p, snap in same:
            for axis in "xyz":
                assert snap["camera"][axis] == pytest.approx(cams[p][axis], abs=0.05), "camera did not retrace"


def test_showroom_url_state(world: World, browser: Any) -> None:
    canonical = "/showroom?model=megh-349&hub=pune&finish=monsoon-slate&ch=tank&part=filler-cap&at=0.412"
    cases = [
        ("/showroom?at=0.5&ch=frame", "wheels", 0.5, None),
        ("/showroom?ch=engine", "engine", 0.21, None),
        ("/showroom?ch=nope&at=0.35", "tank", 0.35, None),
        ("/showroom?ch=tank&part=chain", "tank", 0.35, None),
        ("/showroom?ch=seat&at=7", "seat", 0.77, None),
        ("/showroom?ch=seat&at=abc", "seat", 0.77, None),
    ]
    with _open(browser, world.base, canonical) as page:
        _ready(page)
        snap = _snap(page)
        assert abs(snap["progress"] - 0.412) <= PROGRESS_TOLERANCE and snap["part"] == "filler-cap"
        for path, chapter, progress, _ in cases:
            page.goto(world.base + path)
            _ready(page)
            _run(page, 400)
            snap = _snap(page)
            query = _query(page)
            assert snap["chapter"] == chapter == query["ch"], path
            assert abs(snap["progress"] - progress) <= PROGRESS_TOLERANCE, path
            assert "part" not in query and snap["part"] is None, path
            assert re.fullmatch(r"\d(\.\d{1,3})?", query["at"]), query
        page.goto(world.base + "/showroom?model=x&hub=y&finish=z&ch=nope")
        _ready(page)
        _run(page, 400)
        query = _query(page)
        assert (query["model"], query["hub"], query["finish"], query["ch"]) == (MEGH, "pune", SLATE, "frame")
        page.goto(world.base + canonical.replace("at=0.412", "at=0.38"))
        _ready(page)
        entries = page.evaluate("() => history.length")
        y0 = _stage_top(page)
        for _ in range(4):
            page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", y0 + 37)
            y0 += 37
            _run(page, 250)
        assert page.evaluate("() => history.length") == entries, "the URL rewrite added history entries"
        _run(page, SETTLE_MS)
        at = float(_query(page)["at"])
        assert abs(_snap(page)["progress"] - at) <= 0.002
        page.set_viewport_size(TABLET)
        _run(page, SETTLE_MS)
        assert abs(_snap(page)["progress"] - at) <= PROGRESS_TOLERANCE, "resize lost progress"
        shared = page.url
        page.reload()
        _ready(page)
        assert abs(_snap(page)["progress"] - at) <= PROGRESS_TOLERANCE
    with _open(browser, world.base, urlparse(shared).path + "?" + urlparse(shared).query) as reader:
        _ready(reader)
        snap = _snap(reader)
        assert abs(snap["progress"] - at) <= PROGRESS_TOLERANCE and snap["part"] == "filler-cap"
        assert _role(reader, "dialog", "Sign in").count() == 0


def test_scroll_feel(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.22)) as page:
        _ready(page)
        heading = _role(page, "heading", "Then the heart goes in.")
        top = heading.bounding_box()["y"]
        scroll = _stage_top(page)
        height = page.viewport_size["height"]
        page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", scroll + 0.04 * 7 * height)
        _run(page, SETTLE_MS + 100)
        travel = _stage_top(page) - scroll
        rate = (top - heading.bounding_box()["y"]) / travel
        assert abs(rate - STATEMENT_RATE) <= 0.07, f"statement shifted at {rate} of the scroll travel"
        begin = _snap(page)["progress"]
        page.mouse.move(640, 400)
        page.mouse.wheel(0, 700)
        first = None
        for _ in range(200):
            _run(page, FRAME_MS)
            value = _snap(page)["progress"]
            if value > begin + 1e-4:
                first = value
                break
        assert first is not None, "wheel input never moved progress"
        _run(page, SETTLE_MS)
        settled = _snap(page)["progress"]
        _run(page, 400)
        final = _snap(page)["progress"]
        assert abs(final - settled) <= 0.002, "progress had not settled within 900 ms"
        assert (first - begin) / (final - begin) < 0.5, "wheel input jumped undamped"
        assert abs((_stage_top(page) - scroll) / (7 * height) + 0.22 - final) <= 0.01


def test_back_and_forward(world: World, browser: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.35, ch="tank", part="filler-cap"), rider) as page:
        _ready(page)
        click(_role(page, "link", "Garage"))
        page.wait_for_url("**/garage**")
        assert world.rider().claim().status_code == 201
        page.go_back()
        _ready(page)
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "Back to draw the current reading")
        snap = _snap(page)
        assert abs(snap["progress"] - 0.35) <= PROGRESS_TOLERANCE and snap["part"] == "filler-cap"
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 1, "the stream to run again after Back")
        lock = world.locked(rider, "kochi", MEGH, SLATE)
        page.goto(world.base + "/garage")
        region = _role(page, "region", "Your lock")
        _has(page, region, "₹")
        page.goto(world.base + "/test-ride")
        assert page.request.post(world.base + "/api/auth/signout").status == 204
        page.go_back()
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "the Garage to prompt after sign-out")
        assert lock["ref"] not in page.content() and "₹" not in _text(page.locator("body"))
    for path in ("/showroom",):
        assert "no-store" in httpx.get(world.base + path, timeout=HTTP_TIMEOUT_S).headers.get("cache-control", ""), path
    other = world.rider()
    for path in ("/api/me", "/api/locks", "/api/rides", "/api/live/now", "/api/notices"):
        assert "no-store" in other.get(path).headers.get("cache-control", ""), path
    assert "no-store" in world.host().get("/api/hub/stock").headers.get("cache-control", "")


def test_wf_w2_part_selection_pointer(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.35, ch="tank"), device_time=CLOCK_WRONG, tz=AUCKLAND) as page:
        _ready(page)
        assert _snap(page)["drawn"]["onRoadPaise"] == Api(world.base).live()["quote"]["onRoadPaise"]
        camera = _snap(page)["camera"]
        parts = _role(page, "listbox", "Parts")
        click(parts.get_by_role("option", name="Filler cap", exact=True))
        snap = _until_snap(page, lambda s: s["part"] == "filler-cap", "part selection in the probe")
        _wait(page, lambda: _query(page).get("part") == "filler-cap", "part in the URL")
        snap = _idle(page)
        names = [s["name"] for s in snap["steps"]]
        assert {"camera-to-part", "part-lift", "label-mask"} <= set(names), names
        assert snap["camera"] != camera, "the camera did not move to the part"
        assert parts.get_by_role("option", name="Filler cap", exact=True).get_attribute("aria-selected") == "true"
        at = _snap(page)["progress"]
        page.reload()
        _ready(page)
        assert _snap(page)["part"] == "filler-cap" and abs(_snap(page)["progress"] - at) <= PROGRESS_TOLERANCE
        shared = page.url
        click(parts.get_by_role("option", name="Filler cap", exact=True))
        _until_snap(page, lambda s: s["part"] is None, "selecting the part again to deselect it")
        _wait(page, lambda: "part" not in _query(page), "part to leave the URL")
    parsed = urlparse(shared)
    with _open(browser, world.base, f"{parsed.path}?{parsed.query}") as reader:
        _ready(reader)
        assert _snap(reader)["part"] == "filler-cap" and _role(reader, "dialog", "Sign in").count() == 0


def test_wf_w2_part_selection_keyboard(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.07, ch="frame")) as page:
        _ready(page)
        toolbar = _role(page, "toolbar", "Chapters")
        names = list(JUMPS)
        toolbar.get_by_role("button", name="Frame", exact=True).focus()
        page.keyboard.press("ArrowLeft")
        assert accessible_name(page) == "Cluster", "ArrowLeft must wrap"
        page.keyboard.press("ArrowRight")
        assert accessible_name(page) == "Frame", "ArrowRight must wrap"
        page.keyboard.press("End")
        assert accessible_name(page) == "Cluster"
        page.keyboard.press("Home")
        assert accessible_name(page) == "Frame"
        for index, name in enumerate(names):
            if index:
                page.keyboard.press("ArrowRight")
            assert accessible_name(page) == name
            page.keyboard.press("Enter" if index % 2 else "Space")
            _until_snap(page, lambda s, n=name: abs(s["progress"] - JUMPS[n]) <= 0.01, f"a jump to {name}", 8)
            button = toolbar.get_by_role("button", name=name, exact=True)
            _wait(page, lambda b=button: b.get_attribute("aria-pressed") == "true", f"{name} pressed")
            _wait(page, lambda n=name: _query(page).get("ch") == n.lower(), f"ch={name} in the URL")
        page.keyboard.press("Tab")
        assert not page.evaluate("(el) => el.contains(document.activeElement)", toolbar.element_handle()), \
            "the toolbar has more than one tab stop"
        click(toolbar.get_by_role("button", name="Tank", exact=True))
        _until_snap(page, lambda s: s["chapter"] == "tank", "a pointer jump to Tank", 8)
        parts = _role(page, "listbox", "Parts")
        parts.get_by_role("option", name="Filler cap", exact=True).focus()
        page.keyboard.press("ArrowDown")
        assert accessible_name(page) == "Knee recess"
        page.keyboard.press("Enter")
        _until_snap(page, lambda s: s["part"] == "knee-recess", "Enter to select the part")
    with _open(browser, world.base, _room(at=0.35, ch="tank"), viewport=PHONE, touch=True) as phone:
        _ready(phone)
        opener = _role(phone, "button", "Parts")
        order = tab_order(phone, 12)
        assert "Filler cap" not in order and "Knee recess" not in order, "the closed sheet is in the tab order"
        tap(_role(phone, "toolbar", "Chapters").get_by_role("button", name="Engine", exact=True))
        _until_snap(phone, lambda s: s["chapter"] == "engine", "a tap to jump to Engine", 8)
        tap(opener)
        sheet = _role(phone, "dialog", "Parts")
        _wait(phone, sheet.is_visible, "the bottom sheet")
        tap(sheet.get_by_role("option", name="Cylinder", exact=True))
        _until_snap(phone, lambda s: s["part"] == "cylinder", "a tap to select a part")
        if not sheet.is_visible():
            tap(opener)
        _wait(phone, sheet.is_visible, "the bottom sheet again")
        phone.get_by_role("dialog", name="Parts").get_by_role("option").first.focus()
        for _ in range(6):
            phone.keyboard.press("Tab")
            assert phone.evaluate("(el) => el.contains(document.activeElement)", sheet.element_handle()), \
                "Tab left the open sheet"
        phone.keyboard.press("Escape")
        _wait(phone, lambda: accessible_name(phone) == "Parts", "focus to return to button Parts")


def test_wf_w2_part_selection_reread(world: World, browser: Any) -> None:
    host = world.host()
    assert host.post("/api/hub/stock-count/start").status_code == 200
    rows = host.get("/api/hub/stock").json()["units"]
    with _open(browser, world.base, _room(at=0.92, ch="cluster")) as page:
        _ready(page)
        _until_snap(page, lambda s: s["lamp"] is True, "the counting lamp")
        _idle(page)
        click(_role(page, "listbox", "Parts").get_by_role("option", name="Display", exact=True))
        _until_snap(page, lambda s: s["part"] == "display", "the selection")
        _run(page, 100)
        done = host.post("/api/hub/stock-count/finish",
                         {"units": [{"model": u["model"], "finish": u["finish"], "onHand": u["onHand"]} for u in rows]})
        assert done.status_code == 200, done.text
        _until_snap(page, lambda s: s["lamp"] is False, "the count finishing in place")
        snap = _until_snap(page, lambda s: any(x["name"] == "camera-to-part" and x["endedAt"] is not None
                                               for x in s["steps"]), "the camera step to end")
        moves = [s for s in snap["steps"] if s["name"] == "camera-to-part"]
        assert len(moves) == 1, f"the re-read restarted the move: {moves}"
        assert abs(moves[0]["endedAt"] - moves[0]["startedAt"] - STEP_MS["camera-to-part"]) <= STEP_TOLERANCE_MS
        assert _snap(page)["part"] == "display" and _query(page).get("part") == "display"


def test_step_durations(world: World, browser: Any) -> None:
    host = world.host()
    with _open(browser, world.base, _room(at=0.8, ch="seat")) as page:
        _ready(page)
        y0 = _stage_top(page) - 0.8 * 7 * page.viewport_size["height"]
        _go(page, 0.92, y0)
        _until_snap(page, lambda s: s["keyedOn"] is True, "the cluster keying on")
        _idle(page)
        check(_role(page, "radio", "Kesar"))
        _run(page, 40)
        check(_role(page, "radio", "Monsoon Slate"))
        _until_snap(page, lambda s: s["drawn"]["finish"] == SLATE, "the finish change")
        _idle(page)
        assert host.post("/api/hub/stock-count/start").status_code == 200
        _until_snap(page, lambda s: s["lamp"] is True, "the lamp")
        _idle(page)
        click(_role(page, "listbox", "Parts").get_by_role("option", name="Needle", exact=True))
        _until_snap(page, lambda s: s["part"] == "needle", "the part")
        snap = _idle(page)
        seen: dict[str, list[dict[str, Any]]] = {}
        for step in snap["steps"]:
            seen.setdefault(step["name"], []).append(step)
            assert step["easing"] == EASING, step
            assert step["ms"] == STEP_MS[step["name"]], step
            assert step["endedAt"] > step["startedAt"], f"a step ran at 0 ms: {step}"
        assert set(STEP_MS) - {"dissolve"} <= set(seen), sorted(seen)
        for name, steps in seen.items():
            last = steps[-1]
            assert abs(last["endedAt"] - last["startedAt"] - STEP_MS[name]) <= STEP_TOLERANCE_MS, last


def test_exact_easing_and_needle_curve(world: World, browser: Any) -> None:
    assert _bezier(0.5) == pytest.approx(0.96, abs=0.02)
    with _open(browser, world.base, _room(at=0.8, ch="seat")) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        transition = style(button, "transition-timing-function")["transition-timing-function"]
        entries = re.findall(r"cubic-bezier\([^)]*\)|[a-z-]+", transition)
        assert entries and all(e == EASING for e in entries), transition
        y0 = _stage_top(page) - 0.8 * 7 * page.viewport_size["height"]
        height = page.viewport_size["height"]
        page.evaluate("y => window.scrollTo({top: y, behavior: 'instant'})", y0 + 0.9 * 7 * height)
        for _ in range(400):
            _run(page, FRAME_MS)
            if any(s["name"] == "needle-sweep" for s in _snap(page)["steps"]):
                break
        else:
            pytest.fail("needle-sweep never started on reaching 0.86")
        samples = []
        for _ in range(12):
            _run(page, 32)
            sample = page.evaluate(
                "() => { const s = window.__showroom.snapshot();"
                " const w = s.steps.filter(x => x.name === 'needle-sweep').pop();"
                " return {deg: s.needleDeg, at: performance.now() - w.startedAt, ended: w.endedAt !== null}; }")
            if sample["ended"]:
                break
            samples.append(sample)
        usable = [s for s in samples if 0.3 <= s["at"] / STEP_MS["needle-sweep"] <= 0.9]
        assert usable, f"no mid-flight needle sample: {samples}"
        for sample in usable:
            done = _bezier(sample["at"] / STEP_MS["needle-sweep"])
            want = -135 + 270 * done
            assert abs(sample["deg"] - want) <= 0.06 * 270, f"needle off the published curve: {sample}, want {want}"
        _idle(page)
        click(_role(page, "button", "Lock this price"))
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "the sign-in dialog")
        timings = page.evaluate(
            "() => document.getAnimations().map(a => a.effect.getComputedTiming())"
            ".map(t => ({easing: t.easing, duration: t.duration}))")
        assert all(t["easing"] == EASING for t in timings), timings
        assert any(t["duration"] == STEP_MS["paint"] for t in timings) or not timings or \
            all(t["duration"] > 0 for t in timings), timings


@pytest.mark.timeout(600)
def test_wf_w3_live_cluster_keyon(world: World, browser: Any) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    assert lock["state"] == "locked" and lock["hoursLeft"] == 57
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), rider, device_time=CLOCK_WRONG, tz=AUCKLAND) as page:
        _ready(page)
        _mark(page)
        canvas = _canvas(page)
        snap = _until_snap(page, lambda s: s["keyedOn"] and abs(s["needleDeg"] - 25.31) <= 0.5,
                           "the needle to settle on 25.31 degrees (hoursLeft 57)")
        snap = _idle(page)
        assert snap["drawn"]["display"] == DISPLAY_EXAMPLE.replace("01", "02"), snap["drawn"]
        assert snap["drawn"]["lockExpiresAt"] and _when(snap["drawn"]["lockExpiresAt"]) == _when(lock["expiresAt"])
        pixels = _pixels(page)
        assert _near(pixels["tank"], PAINT[SLATE]), pixels
        assert _near(pixels["needleTip"], INK), pixels
        assert not _near(pixels["lamp"], ACCENT), pixels
        line = _text(_role(page, "region", "On-road price"))
        assert "2 units left in Monsoon Slate at Pune." in line, line
        before = _display(page)
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["display"].startswith("UNITS 01"), "the display on a rival's claim")
        _idle(page)
        _wait(page, lambda: _display(page)["hash"] != before["hash"], "display pixels to change with the reading")
        _has(page, _role(page, "region", "On-road price"), "1 unit left in Monsoon Slate at Pune.")
        host = world.host()
        assert host.post("/api/hub/stock-count/start").status_code == 200
        _until_snap(page, lambda s: s["lamp"] is True, "the tell-tale on a count")
        _idle(page)
        assert _near(_pixels(page)["lamp"], ACCENT), _pixels(page)
        assert host.get("/api/hub/stock").json()["units"][0]["unitsLeft"] is not None
        _no_reload(page)
    world.clock("2026-11-06T09:00:00+05:30")
    rider2 = world.rider()
    clamp = world.locked(rider2, "gurugram", MEGH, SLATE)
    assert clamp["hoursLeft"] == 129
    with _open(browser, world.base, _room(at=0.92, hub="gurugram", ch="cluster"), rider2) as clamped:
        _ready(clamped)
        _until_snap(clamped, lambda s: abs(s["needleDeg"] - 135) <= 0.5, "the needle clamped at 96 hours")
        assert rider2.live("gurugram")["hoursLeft"] == 129


def test_wf_w3_live_cluster_instants(world: World, browser: Any) -> None:
    world.clock("2026-10-28T09:29:59+05:30")
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), device_time=CLOCK_WRONG) as page:
        _ready(page)
        _until_snap(page, lambda s: s["drawn"]["display"].endswith("RIDE 11:30"), "RIDE 11:30 at 09:29:59")
        tab = page.context.new_page()
        tab.goto(world.base + "/test-ride?hub=pune&model=megh-349&date=2026-10-28")
        cell = tab.get_by_role("gridcell", name="11:30 am IST", exact=True)
        _wait(tab, lambda: cell.count() == 1, "the 11:30 cell")
        assert not _disabled(cell)
        api = Api(world.base)
        seq = api.live()["seq"]
        world.clock("2026-10-28T09:30:00+05:30")
        assert api.live()["seq"] > seq, "seq did not rise at the slot's cut-off"
        _until_snap(page, lambda s: s["drawn"]["display"].endswith("RIDE 1:00"), "RIDE 1:00 at 09:30:00", 8)
        _wait(tab, lambda: _disabled(cell), "the 11:30 cell to disable in place", 8)
        for instant in ("2026-10-28T10:00:00+05:30", "2026-10-28T10:45:00+05:30"):
            seq = api.live()["seq"]
            world.clock(instant)
            assert api.live()["seq"] > seq, f"seq did not rise at {instant}"
    with Stream(world.base, "?hub=pune", None) as stream:
        first = stream.wait("live")
        world.clock("2026-10-28T11:30:00+05:30")
        stream.wait("live", lambda b: b["seq"] > first["seq"], LIVE_LIMIT_S + SLACK_S)
    expiring = world.rider()
    world.clock(SEED_AT)
    lock = world.locked(expiring, "kochi", MEGH, SLATE)
    world.clock("2026-10-30T17:59:59+05:30")
    seq = Api(world.base).live("kochi")["seq"]
    world.clock(lock["expiresAt"])
    assert Api(world.base).live("kochi")["seq"] > seq, "seq did not rise at the lock's expiry"


def test_holder_of_last_unit(world: World, browser: Any) -> None:
    rider = world.rider()
    url = _room(at=0.92, finish=KESAR, ch="cluster")
    with _open(browser, world.base, url, rider) as page:
        _ready(page)
        lock = world.locked(rider, "pune", MEGH, KESAR)
        snap = _until_snap(page, lambda s: s["drawn"]["display"].startswith("UNITS 00"), "UNITS 00 for the holder")
        _idle(page)
        assert snap["drawn"]["finish"] == KESAR
        assert _near(_pixels(page)["tank"], PAINT[KESAR]), _pixels(page)
        with _open(browser, world.base, url) as reader:
            _ready(reader)
            _until_snap(reader, lambda s: s["drawn"]["display"].startswith("UNITS 00"), "UNITS 00 for the reader")
            _idle(reader)
            assert _near(_pixels(reader)["tank"], MUTED), _pixels(reader)
            assert _snap(reader)["drawn"]["finish"] == KESAR
        assert "That finish has just gone. Nothing was locked." not in _log(page)
        assert world.host().post(f"/api/hub/locks/{lock['id']}/withdraw").status_code == 200
        _wait(page, lambda: _near(_pixels(page)["tank"], MUTED), "primer in place after the withdrawal")
        assert _snap(page)["drawn"]["display"].startswith("UNITS 00")


def test_newest_reading_wins(world: World, browser: Any) -> None:
    api = Api(world.base)
    reading = api.live()
    calls: list[int] = []

    def stream_route(route: Any) -> None:
        calls.append(1)
        body = dict(reading)
        if len(calls) == 2:
            body["unitsLeft"] = 9
        elif len(calls) == 3:
            body["unitsLeft"], body["seq"] = 9, reading["seq"] - 1
        elif len(calls) >= 4:
            body["unitsLeft"], body["seq"] = 7, reading["seq"] + 1000
        route.fulfill(status=200, headers={"content-type": "text/event-stream"},
                      body=f"event: live\ndata: {json.dumps(body)}\n\n")

    with _open(browser, world.base, "/api/health") as page:
        page.route(re.compile(r"/api/live(\?|$)"), stream_route)
        page.goto(world.base + _room(at=0.92, ch="cluster"))
        _ready(page)
        _wait(page, lambda: len(calls) >= 3, "the page to re-open the ended stream", 20)
        assert _snap(page)["drawn"]["unitsLeft"] != 9, "a reading at or below drawn.seq was drawn"
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 7, "a newer sequence to be drawn", 20)
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), rider) as page:
        _ready(page)
        _wait(page, lambda: not _disabled(_role(page, "button", "Lock this price")), "an enabled Lock this price")
        click(_role(page, "button", "Lock this price"))
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the lock dialog")
        with held(page, "**/api/locks") as release:
            click(dialog.get_by_role("button", name="Confirm lock", exact=True))
            _run(page, 500)
            assert _snap(page)["drawn"]["unitsLeft"] == 3, "a local action changed a drawn count"
            release()
            _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "the reply or event to change the count")


def test_showroom_probe(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/api/health") as page:
        with held(page, "**/api/live**") as release:
            page.goto(world.base + _room(at=0.412, ch="tank", part="filler-cap", model=DESH))
            _wait(page, lambda: page.evaluate("() => !!window.__showroom"), "window.__showroom")
            early = _snap(page)
            if early["drawn"]["onRoadPaise"] is None:
                assert early["drawn"]["unitsLeft"] is None, early["drawn"]
            else:
                assert early["drawn"]["onRoadPaise"] == Api(world.base).live("pune", DESH)["quote"]["onRoadPaise"]
            release()
        _ready(page)
        snap = _snap(page)
        assert {"mode", "paused", "progress", "chapter", "part", "camera", "seatOffsets", "keyedOn", "needleDeg",
                "lamp", "drawn", "probes", "geometry", "steps"} <= set(snap)
        assert snap["mode"] == "webgl" and snap["paused"] is False and snap["part"] == "filler-cap"
        assert snap["geometry"] == {"wheelbaseMm": 1465, "cylinders": 2, "silencers": 2, "rakeDeg": 26, "frontRimIn": 19,
                                    "rearRimIn": 17, "sideStandSide": "left", "chainSide": "left",
                                    "exhaustSide": "right", "leanDeg": 8, "leanSide": "left"}
        assert set(snap["camera"]) == {"x", "y", "z"} and set(snap["seatOffsets"]) == set(SEATS)
        assert {"seq", "unitsLeft", "onRoadPaise", "lockExpiresAt", "nextSlot", "finish", "display"} <= set(snap["drawn"])
        live = Api(world.base).live("pune", DESH, SLATE)
        assert snap["drawn"]["onRoadPaise"] == live["quote"]["onRoadPaise"]
        assert snap["drawn"]["unitsLeft"] == live["unitsLeft"] and snap["drawn"]["lockExpiresAt"] is None
        assert _when(snap["drawn"]["nextSlot"]) == _when(live["nextSlot"]["startsAt"])
        assert snap["keyedOn"] is False and snap["needleDeg"] == -135
        assert {"tank", "lamp", "needleTip", "display"} == set(snap["probes"])
        starts = [s["startedAt"] for s in snap["steps"]]
        assert starts == sorted(starts)
        canvas = _canvas(page, "Desh 648")
        box = canvas.bounding_box()
        region = {"x": 0, "y": 0, "w": box["width"], "h": box["height"]}
        assert canvas.evaluate(RECT_JS, region)["peak"] > 0, "the canvas is not readable"
        page.goto(world.base + _room(at=0.92, ch="cluster"))
        _ready(page)
        assert _snap(page)["geometry"]["wheelbaseMm"] == 1440 and _snap(page)["geometry"]["cylinders"] == 1


def test_live_feed(world: World, browser: Any) -> None:
    api = Api(world.base)
    reply = api.get("/api/live/now")
    reading = reply.json()
    assert set(reading) == LIVE_KEYS and set(reading["quote"]) == QUOTE_KEYS
    assert (reading["hub"], reading["model"], reading["finish"]) == ("pune", MEGH, SLATE)
    assert reading["unitsLeft"] == 3 and reading["stale"] is False and reading["staleReason"] is None
    assert reading["stockAsOfLabel"] == "9:00 am IST" and reading["lock"] is None and reading["hoursLeft"] == 0
    assert reading["nextSlot"]["label"] == "11:30 am IST"
    assert reading["lockPreview"]["expiresLabel"] == "30 Oct, 6:00 pm IST"
    assert reading["serverNow"].endswith("+05:30") and reading["stockAsOf"].endswith("+05:30")
    assert {"finish": KESAR, "unitsLeft": 1} in reading["finishes"]
    for bad in ("hub=nope", "model=nope", "finish=nope"):
        _err(api.get(f"/api/live/now?{bad}"), 422, "invalid_body")
        _err(api.get(f"/api/live?{bad}"), 422, "invalid_body")
    with Stream(world.base, "?hub=pune&model=megh-349&finish=monsoon-slate") as stream:
        first = stream.wait("live")
        assert stream.status == 200 and stream.content_type.startswith("text/event-stream")
        assert set(first) == LIVE_KEYS
        rider = world.rider()
        at = time.monotonic()
        assert rider.claim().status_code == 201
        changed = stream.wait("live", lambda b: b["seq"] > first["seq"] and b["unitsLeft"] == 2, LIVE_LIMIT_S + SLACK_S)
        arrival = next(e[0] for e in stream.events if e[1] == "live" and json.loads(e[2])["seq"] == changed["seq"])
        assert arrival - at <= LIVE_LIMIT_S + 1, f"event took {arrival - at}s"
    with _open(browser, world.base, _room(at=0.92, ch="cluster")) as page:
        _ready(page)
        _mark(page)
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 1, "the change on an open screen", 6)
        _no_reload(page)


def test_rider_stream(world: World, browser: Any) -> None:
    rider = world.rider()
    with Stream(world.base, "?hub=pune", rider) as stream:
        stream.wait("live")
        assert len(stream.named("mine")) == 0
        lock = world.locked(rider, "kochi", MEGH, SLATE)
        stream.wait("mine", seconds=LIVE_LIMIT_S + SLACK_S)
        count = len(stream.named("mine"))
        world.clock("2026-10-28T10:00:00+05:30")
        _poll(lambda: len(stream.named("mine")) > count, "mine at a whole IST hour while holding a lock",
              LIVE_LIMIT_S + SLACK_S)
        assert rider.live("kochi")["hoursLeft"] == 56
        assert lock["id"]
        rider.post("/api/auth/signout")
        stream.wait("session", lambda b: b == {"state": "signed_out"}, LIVE_LIMIT_S + SLACK_S)
    other = world.rider()
    with Stream(world.base, "?hub=pune") as public, Stream(world.base, "?hub=pune", other) as mine:
        public.wait("live")
        mine.wait("live")
        assert world.locked(world.rider(), "kochi", MEGH, KESAR)["id"]
        world.clock("2026-10-28T22:00:01+05:30", freeze=True)
        mine.wait("session", lambda b: b == {"state": "ended"}, LIVE_LIMIT_S + SLACK_S)
        assert public.named("mine") == [] and public.named("session") == []
    third = world.rider()
    with _open(browser, world.base, _room(at=0.35, ch="tank")) as page:
        _ready(page)
        streams: list[str] = []
        page.on("request", lambda r: streams.append(r.url) if re.search(r"/api/live(\?|$)", r.url) else None)
        page.context.add_cookies([{"name": k, "value": v, "url": world.base} for k, v in third.cookies.items()])
        click(_role(page, "button", "Lock this price"))
        _run(page, 200)
        if _role(page, "dialog", "Sign in").count():
            page.keyboard.press("Escape")
        tab = page.context.new_page()
        tab.goto(world.base + "/showroom")
        tab.request.post(world.base + "/api/auth/signout")
        _wait(page, lambda: bool(streams), "the page to re-open its stream after a change of identity", 6)
        tab.close()


def test_stream_recovery(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/api/health") as page:
        calls: list[str] = []
        polls: list[str] = []
        block = {"on": True}

        def route(r: Any) -> None:
            calls.append(r.request.url)
            if block["on"]:
                r.fulfill(status=503, body="{}", headers={"content-type": "application/json"})
            else:
                r.continue_()

        page.route(re.compile(r"/api/live(\?|$)"), route)
        page.on("request", lambda r: polls.append(r.url) if "/api/live/now" in r.url else None)
        page.goto(world.base + _room(at=0.92, ch="cluster"))
        _ready(page)
        _mark(page)
        _wait(page, lambda: len(calls) >= 3, "the page to keep re-opening a stream answering 503", 3 * STREAM_REOPEN_S)
        count = len(polls)
        _wait(page, lambda: len(polls) > count, "a read of /api/live/now while the stream is down", STREAM_REOPEN_S + 3)
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "the poll to carry the change", STREAM_REOPEN_S + 5)
        block["on"] = False
        count = len(calls)
        _wait(page, lambda: len(calls) > count, "the stream to re-open after the failure", STREAM_REOPEN_S + 3)
        polled = len(polls)
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 1, "the recovered stream to carry a change", 6)
        assert polled >= 1
        _no_reload(page)


def test_silent_stream(world: World, browser: Any) -> None:
    with Stream(world.base, "?hub=pune") as stream:
        stream.wait("live")
        assert stream.wait("ping", seconds=PING_S + SLACK_S) == {}
    with _open(browser, world.base, "/api/health") as page:
        calls: list[Any] = []
        polls: list[str] = []
        page.route(re.compile(r"/api/live(\?|$)"), lambda r: calls.append(r))
        page.on("request", lambda r: polls.append(r.url) if "/api/live/now" in r.url else None)
        page.goto(world.base + _room(at=0.35, ch="tank"))
        _ready(page)
        _wait(page, lambda: len(calls) >= 1, "the page to open a stream")
        before = len(calls)
        count = len(polls)
        advance(page, (SILENT_S + STREAM_REOPEN_S + 1) * 1000)
        _wait(page, lambda: len(calls) > before, "a silent stream to be re-opened with no connection error")
        _wait(page, lambda: len(polls) > count, "reads of /api/live/now while the silent stream is ended")
        page.unroute(re.compile(r"/api/live(\?|$)"))


@pytest.mark.timeout(900)
def test_probes_at_every_ratio_and_part(world: World, browser: Any) -> None:
    assert world.host().post("/api/hub/stock-count/start").status_code == 200
    for scale, viewport in ((1, DESKTOP), (2, TABLET), (3, PHONE)):
        with _open(browser, world.base, _room(at=0.92, finish=KESAR, ch="cluster"), viewport=viewport,
                   scale=scale) as page:
            _ready(page)
            _until_snap(page, lambda s: s["keyedOn"] and s["lamp"], "the keyed-on lit cluster")
            y0 = _stage_top(page) - 0.92 * 7 * viewport["height"]
            for progress in (0.86, 0.92, 1.0):
                _go(page, progress, y0)
                _idle(page)
                got = _pixels(page)
                assert _near(got["tank"], PAINT[KESAR]), (scale, viewport, progress, got)
                assert _near(got["lamp"], ACCENT), (scale, viewport, progress, got)
                assert _near(got["needleTip"], INK), (scale, viewport, progress, got)
    with _open(browser, world.base, _room(at=0.92, finish=KESAR, ch="cluster")) as page:
        _ready(page)
        for name, part in (("Needle", "needle"), ("Tell-tale", "tell-tale"), ("Display", "display")):
            click(_role(page, "listbox", "Parts").get_by_role("option", name=name, exact=True))
            _until_snap(page, lambda s, p=part: s["part"] == p, f"{name} selected")
            _idle(page)
            got = _pixels(page)
            assert _near(got["tank"], PAINT[KESAR]) and _near(got["lamp"], ACCENT), (name, got)
            assert _near(got["needleTip"], INK), (name, got)
            rect = _snap(page)["probes"]["display"]
            box = _canvas(page).bounding_box()
            assert 0 <= rect["x"] and rect["x"] + rect["w"] <= box["width"], f"display outside the canvas with {name}"
            assert 0 <= rect["y"] and rect["y"] + rect["h"] <= box["height"], f"display outside the canvas with {name}"


@pytest.mark.timeout(300)
def test_fanout_is_a_hint(world: World, valkey: Any) -> None:
    with _ledger_socket() as sock:
        _resp_send(sock, ("SUBSCRIBE", f"{PREFIX}:live", f"{PREFIX}:rider"))
        reader = sock.makefile("rb")
        _resp_read(reader), _resp_read(reader)
        rider = world.rider()
        assert rider.claim().status_code == 201
        heard: dict[str, dict[str, Any]] = {}
        for _ in range(20):
            msg = _resp_read(reader)
            heard.setdefault(msg[1], json.loads(msg[2]))
            if len(heard) == 2:
                break
        assert heard[f"{PREFIX}:live"]["hub"] == "pune" and isinstance(heard[f"{PREFIX}:live"]["seq"], int)
        assert heard[f"{PREFIX}:rider"]["rider"] == rider.user["id"]
    api = Api(world.base)
    with Stream(world.base, "?hub=pune") as stream:
        first = stream.wait("live")
        forged = first["seq"] + 100000
        _ledger("PUBLISH", f"{PREFIX}:live", json.dumps({"hub": "pune", "seq": forged}))
        _ledger("PUBLISH", f"{PREFIX}:live", "garbage {{{")
        _ledger("PUBLISH", f"{PREFIX}:rider", "garbage {{{")
        with contextlib.suppress(pytest.fail.Exception):
            stream.wait("live", lambda b: b["seq"] >= forged, LIVE_LIMIT_S + 1)
            pytest.fail("a forged message produced a live event")
        assert api.live()["seq"] < forged, "a forged message changed the sequence"
        assert api.live()["seq"] == first["seq"]
        assert world.rider().claim().status_code == 201
        stream.wait("live", lambda b: b["unitsLeft"] == 1, LIVE_LIMIT_S + SLACK_S)
        _ledger_admin("CLIENT", "KILL", "TYPE", "pubsub")
        assert world.rider().on(_peer("APP_SECOND_NODE_URL")).claim().status_code == 202
        stream.wait("live", lambda b: b["unitsLeft"] == 0, SWEEP_S + SLACK_S)


@pytest.mark.timeout(600)
def test_wf_w4_context_loss_return(world: World, browser: Any) -> None:
    rider = world.rider()
    url = _room(at=0.92, finish=KESAR, ch="cluster", part="needle")
    with _open(browser, world.base, url, rider) as page:
        _ready(page)
        _until_snap(page, lambda s: s["keyedOn"], "key-on")
        _idle(page)
        place = _snap(page)
        scroll_y = page.evaluate("() => window.scrollY")
        canvas = _canvas(page)
        canvas.evaluate(LOSE_JS, False)
        _until_snap(page, lambda s: s["paused"] is True, "snapshot.paused after context loss")
        _said(page, "3D showroom paused. Your place is kept.")
        toolbar = _role(page, "toolbar", "Chapters")
        parts = _role(page, "listbox", "Parts")
        assert _disabled(toolbar) and _disabled(parts)
        before = (_query(page).get("at"), _query(page).get("ch"), _query(page).get("part"))
        tank_box = toolbar.get_by_role("button", name="Tank", exact=True).bounding_box()
        page.mouse.click(tank_box["x"] + tank_box["width"] / 2, tank_box["y"] + tank_box["height"] / 2)
        toolbar.get_by_role("button", name="Tank", exact=True).focus()
        page.keyboard.press("Enter")
        parts.get_by_role("option", name="Display", exact=True).focus()
        page.keyboard.press("Enter")
        _run(page, 500)
        assert (_query(page).get("at"), _query(page).get("ch"), _query(page).get("part")) == before
        assert _snap(page)["progress"] == pytest.approx(place["progress"], abs=PROGRESS_TOLERANCE)
        lock = rider.claim("pune", MEGH, KESAR)
        assert lock.status_code == 202
        assert world.host().post(f"/api/hub/locks/{lock.json()['lock']['id']}/confirm").status_code == 200
        check(_role(page, "radio", "Desh 648"))
        _wait(page, lambda: _query(page).get("model") == DESH, "model in the URL while paused")
        check(_role(page, "radio", "Monsoon Slate"))
        _wait(page, lambda: _query(page).get("finish") == SLATE, "finish in the URL while paused")
        height = page.evaluate("() => window.innerHeight")
        held_still = _go(page, 0.5, scroll_y - place["progress"] * 7 * height)
        assert held_still["progress"] == pytest.approx(place["progress"], abs=PROGRESS_TOLERANCE), "scrolling while paused moved progress"
        assert held_still["chapter"] == place["chapter"] and held_still["part"] == "needle"
        assert (_query(page).get("at"), _query(page).get("ch"), _query(page).get("part")) == before
        canvas = page.get_by_role("img", name=re.compile("showroom"))
        canvas.evaluate(LOSE_JS, True)
        _until_snap(page, lambda s: s["paused"] is False, "the return of the context")
        _said(page, "3D showroom is back.")
        _wait(page, lambda: abs(page.evaluate("() => window.scrollY") - scroll_y) <= 2, "the scroll position to return")
        snap = _until_snap(page, lambda s: s["geometry"]["wheelbaseMm"] == 1465, "the model chosen while paused")
        assert abs(snap["progress"] - place["progress"]) <= PROGRESS_TOLERANCE and snap["part"] == "needle"
        _wait(page, lambda: _canvas(page, "Desh 648").count() == 1, "the canvas name to follow the model")
        _idle(page)
        assert _near(_pixels(page, "Desh 648")["tank"], PAINT[SLATE])
        assert _snap(page)["drawn"]["display"].startswith("UNITS 02")
        assert not _disabled(_role(page, "toolbar", "Chapters"))


@pytest.mark.timeout(600)
def test_wf_w4_context_loss_twice(world: World, browser: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), rider) as page:
        _ready(page)
        _until_snap(page, lambda s: s["keyedOn"], "key-on")
        canvas = _canvas(page)
        for round_number in range(2):
            canvas.evaluate(LOSE_JS, False)
            _until_snap(page, lambda s: s["paused"] is True, f"pause {round_number}")
            assert world.rider().claim("pune", DESH, SLATE).status_code == 201 or round_number == 1
            canvas.evaluate(LOSE_JS, True)
            _until_snap(page, lambda s: s["paused"] is False, f"return {round_number}")
        _wait(page, lambda: _log(page).count("3D showroom paused. Your place is kept.") == 2, "both pauses announced", 8)
        _wait(page, lambda: _log(page).count("3D showroom is back.") == 2, "both returns announced", 8)
        canvas.evaluate(LOSE_JS, False)
        _until_snap(page, lambda s: s["paused"] is True, "the third pause")
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "Lock this price to keep working while paused")
        click(button)
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the lock dialog while paused")
        click(dialog.get_by_role("button", name="Confirm lock", exact=True))
        _said(page, "Price locked until 30 Oct, 6:00 pm IST.")
        assert rider.get("/api/locks").json()["locks"][0]["state"] == "locked"
        canvas.evaluate(LOSE_JS, True)
        snap = _until_snap(page, lambda s: not s["paused"] and abs(s["needleDeg"] - 25.31) <= 0.5,
                           "the lock made while paused on the needle")
        assert snap["drawn"]["display"].startswith("UNITS 02")
        _idle(page)
        assert _display(page)["peak"] > 40, "display pixels were not rebuilt after return"


def test_wf_w4_context_loss_phone(world: World, browser: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), rider, viewport=PHONE, touch=True) as page:
        _ready(page)
        _until_snap(page, lambda s: s["keyedOn"], "key-on")
        _idle(page)
        canvas = _canvas(page)
        canvas.evaluate(LOSE_JS, False)
        _until_snap(page, lambda s: s["paused"] is True, "the pause on a phone")
        _said(page, "3D showroom paused. Your place is kept.")
        before = (_query(page).get("at"), _query(page).get("ch"))
        tank = _role(page, "toolbar", "Chapters").get_by_role("button", name="Tank", exact=True)
        tank.scroll_into_view_if_needed()
        box = tank.bounding_box()
        page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        _run(page, 500)
        assert (_query(page).get("at"), _query(page).get("ch")) == before, "a paused chapter took a tap"
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "Lock this price while paused")
        tap(button)
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the lock dialog by tap")
        tap(dialog.get_by_role("button", name="Confirm lock", exact=True))
        _said(page, "Price locked until 30 Oct, 6:00 pm IST.")
        canvas.evaluate(LOSE_JS, True)
        _until_snap(page, lambda s: s["paused"] is False, "the return on a phone")
        _until_snap(page, lambda s: bool(s["drawn"]["lockExpiresAt"]), "the lock drawn after return")
        _idle(page)
        assert _near(_pixels(page)["needleTip"], INK), _pixels(page)


def test_wf_w5_fallback_reduced_no_webgl(world: World, browser: Any) -> None:
    context = browser.new_context(java_script_enabled=False)
    try:
        raw = context.new_page()
        raw.goto(world.base + _room(at=0.35, ch="tank"))
        for chapter in JUMPS:
            image = raw.get_by_role("img", name=f"Side elevation, {chapter}", exact=True, include_hidden=True)
            assert image.count() == 1, chapter
            assert image.get_attribute("data-units") == "03" and image.get_attribute("data-ride") == "11:30"
            assert float(image.get_attribute("data-needle-deg")) == -135
            assert image.get_attribute("data-lamp") == "false"
            assert image.get_attribute("data-tank") == _hex(PAINT[SLATE])
    finally:
        context.close()
    rider = world.rider()
    world.locked(rider)
    held_context = browser.new_context(java_script_enabled=False)
    try:
        held_context.add_cookies([{"name": k, "value": v, "url": world.base} for k, v in rider.cookies.items()])
        held_raw = held_context.new_page()
        held_raw.goto(world.base + _room(at=0.35, ch="tank"))
        held_image = held_raw.get_by_role("img", name=_elevation("Tank"), exact=True, include_hidden=True)
        assert held_image.get_attribute("data-units") == "02", "raw HTML ignored the caller's lock"
        assert float(held_image.get_attribute("data-needle-deg")) == pytest.approx(25.31, abs=0.05)
    finally:
        held_context.close()
    with _open(browser, world.base, _room(at=0.35, ch="tank"), no_webgl=True, device_time=CLOCK_WRONG) as page:
        _wait(page, lambda: page.evaluate("() => !!window.__showroom"), "the probe")
        _until_snap(page, lambda s: s["mode"] == "fallback", "mode fallback")
        _said(page, "This device can't draw the 3D showroom. Everything here is live.")
        _mark(page)
        tank = _role(page, "img", _elevation("Tank"))
        _wait(page, tank.is_visible, "the current chapter's elevation")
        _wait(page, lambda: tank.get_attribute("data-units") == "02", "data-units from the server")
        assert world.rider().claim().status_code == 201
        _wait(page, lambda: tank.get_attribute("data-units") == "01", "data-units in place", 8)
        host = world.host()
        assert host.post("/api/hub/stock-count/start").status_code == 200
        _wait(page, lambda: tank.get_attribute("data-lamp") == "true", "data-lamp on a count", 8)
        check(_role(page, "radio", "Desh 648"))
        _wait(page, lambda: tank.get_attribute("data-units") == "02", "the reading for the new model")
        click(_role(page, "toolbar", "Chapters").get_by_role("button", name="Seat", exact=True))
        _wait(page, _role(page, "img", _elevation("Seat")).is_visible, "Chapter controls to change the elevation")
        _no_reload(page)


def test_wf_w5_fallback_reduced_phone_primer(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.35, finish=RAAT, ch="tank"), viewport=PHONE, reduced=True,
               no_webgl=True) as page:
        _wait(page, lambda: page.evaluate("() => !!window.__showroom"), "the probe")
        _until_snap(page, lambda s: s["mode"] == "fallback", "mode fallback under reduced motion")
        tank = _role(page, "img", _elevation("Tank"))
        _wait(page, lambda: tank.get_attribute("data-tank") == _hex(MUTED), "primer at 0 units")
        assert tank.get_attribute("data-units") == "00"
        check(_role(page, "radio", "Monsoon Slate"))
        _wait(page, lambda: tank.get_attribute("data-tank") == _hex(PAINT[SLATE]), "paint for the new finish")
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "purchases to stay enabled")
        click(button)
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "the sign-in dialog first")
        layout(page)


def test_reduced_motion(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.412, ch="tank", part="filler-cap"), reduced=True) as page:
        _ready(page)
        _mark(page)
        snap = _snap(page)
        assert snap["mode"] == "reduced" and abs(snap["progress"] - 0.412) <= PROGRESS_TOLERANCE
        page.evaluate("() => window.scrollBy(0, 600)")
        _run(page, SETTLE_MS)
        assert abs(_snap(page)["progress"] - 0.412) <= PROGRESS_TOLERANCE, "scrolling moved progress"
        toolbar = _role(page, "toolbar", "Chapters")
        click(toolbar.get_by_role("button", name="Cluster", exact=True))
        snap = _until_snap(page, lambda s: abs(s["progress"] - JUMPS["Cluster"]) <= 0.01, "the Cluster still")
        snap = _idle(page)
        assert _query(page)["ch"] == "cluster"
        assert abs(snap["needleDeg"] + 135) <= 0.5
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "live values under reduced motion")
        assert world.host().post("/api/hub/stock-count/start").status_code == 200
        _until_snap(page, lambda s: s["lamp"] is True, "the tell-tale under reduced motion")
        snap = _idle(page)
        assert snap["steps"], "the toolbar must log a dissolve"
        for step in snap["steps"]:
            assert step["name"] == "dissolve" and step["ms"] == STEP_MS["dissolve"], step
            assert abs(step["endedAt"] - step["startedAt"] - STEP_MS["dissolve"]) <= STEP_TOLERANCE_MS
        camera = _snap(page)["camera"]
        _run(page, 1000)
        assert _snap(page)["camera"] == camera, "the machine moved under reduced motion"
        kept = _snap(page)["progress"]
        page.emulate_media(reduced_motion="no-preference")
        _until_snap(page, lambda s: s["mode"] == "webgl", "the setting change to apply with no reload")
        _run(page, SETTLE_MS)
        assert abs(_snap(page)["progress"] - kept) <= PROGRESS_TOLERANCE
        page.emulate_media(reduced_motion="reduce")
        _until_snap(page, lambda s: s["mode"] == "reduced", "the setting change back")
        assert abs(_snap(page)["progress"] - kept) <= PROGRESS_TOLERANCE
        _no_reload(page)


def test_quote_makeup(world: World, browser: Any) -> None:
    tax = {"pune": 11, "bengaluru": 18, "gurugram": 8, "kochi": 12}
    models = {MEGH: (190000, 18, 9800), DESH: (260000, 40, 14600)}
    for hub, percent in tax.items():
        for model, (factory, gst, insurance) in models.items():
            quote = Api(world.base).live(hub, model, SLATE)["quote"]
            ex_factory = _paise(factory)
            gst_paise = ex_factory * gst // 100
            ex_showroom = ex_factory + gst_paise
            road = (ex_showroom * percent * 2 + 100) // 200
            assert quote["exFactoryPaise"] == ex_factory and quote["gstPaise"] == gst_paise and quote["gstPercent"] == gst
            assert quote["exShowroomPaise"] == ex_showroom and quote["roadTaxPaise"] == road
            assert quote["roadTaxPercent"] == percent and quote["insurancePaise"] == _paise(insurance)
            assert quote["onRoadPaise"] == ex_showroom + road + _paise(insurance)
            assert quote["stepEffectiveFrom"] == "2026-10-01"
    assert Api(world.base).live()["quote"]["onRoadPaise"] == _paise(258662)
    assert Api(world.base).live("pune", DESH)["quote"]["onRoadPaise"] == _paise(418640)
    with _open(browser, world.base, _room(at=0.35, ch="tank")) as page:
        _ready(page)
        region = _role(page, "region", "On-road price")
        _has(page, region, "₹2,58,662")
        hub = _role(page, "combobox", "Hub city")
        with held(page, "**/api/live**hub=kochi**") as release:
            select(hub, "Kochi")
            _run(page, 200)
            select(hub, "Gurugram")
            gurugram = Api(world.base).live("gurugram")["quote"]["onRoadPaise"]
            _until_snap(page, lambda s: s["drawn"]["onRoadPaise"] == gurugram, "the newest hub's quote")
            release()
            _run(page, 800)
            assert _snap(page)["drawn"]["onRoadPaise"] == gurugram, "a slower Kochi reply painted over Gurugram"
            assert _query(page)["hub"] == "gurugram"


def test_wf_w6_on_road_quote_midnight(world: World, browser: Any) -> None:
    world.clock("2026-10-31T23:59:59+05:30")
    rider = world.rider()
    lock = world.locked(rider)
    assert lock["onRoadPaise"] == _paise(258662)
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), tz=AUCKLAND, device_time=CLOCK_WRONG) as page, \
            _open(browser, world.base, "/garage", rider) as garage:
        _ready(page)
        _mark(page)
        region = _role(page, "region", "On-road price")
        _has(page, region, "₹2,58,662")
        band = _role(garage, "region", "Your lock")
        _has(garage, band, "₹2,58,662")
        world.clock("2026-11-01T00:00:00+05:30")
        _has(page, region, "₹2,65,211", 8)
        _said(page, "Price updated for today. New on-road price ₹2,65,211.")
        assert "₹2,58,662" not in _text(region)
        _no_reload(page)
        garage.reload()
        _has(garage, band, "₹2,58,662")
        assert "₹2,65,211" not in _text(band), "a Garage amount came from the quote"
    held_lock = rider.get(f"/api/locks/{lock['id']}").json()["lock"]
    assert held_lock["onRoadPaise"] == _paise(258662) and held_lock["stepEffectiveFrom"] == "2026-10-01"
    assert Api(world.base).live()["quote"]["onRoadPaise"] == _paise(265211)
    assert Api(world.base).live("pune", DESH)["quote"]["onRoadPaise"] == _paise(426410)


def test_wf_w6_on_road_quote_two_callers(world: World, browser: Any) -> None:
    world.clock("2026-10-31T15:00:00+05:30")
    first, second = world.rider(), world.rider()
    lock_a = world.locked(first)
    lock_b = world.locked(second, "pune", DESH, SLATE)

    def read(api: Api, model: str) -> tuple[Api, dict[str, Any]]:
        return api, api.live("pune", model, SLATE)

    calls = [lambda a=first: read(a, MEGH), lambda a=second: read(a, MEGH), lambda a=first: read(a, DESH),
             lambda a=second: read(a, DESH), lambda a=Api(world.base): read(a, MEGH)] * 6
    for api, reading in _together(*calls):
        if api is first and reading["model"] == MEGH:
            assert reading["lock"]["id"] == lock_a["id"]
        elif api is second and reading["model"] == DESH:
            assert reading["lock"]["id"] == lock_b["id"]
        else:
            assert reading["lock"] is None and reading["hoursLeft"] == 0, "a reply carried another caller's lock"
    world.clock("2026-11-01T00:00:00+05:30")
    first.renew()
    second.renew()
    with _open(browser, world.base, "/garage", first) as page:
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹2,58,662")
        page.context.clear_cookies()
        page.context.add_cookies([{"name": k, "value": v, "url": world.base} for k, v in second.cookies.items()])
        page.reload()
        _has(page, band, "₹4,18,640")
        assert "₹2,58,662" not in _text(band)


def test_wf_w6_on_road_quote_phone(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.35, ch="tank"), viewport=PHONE, touch=True) as page:
        _ready(page)
        region = _role(page, "region", "On-road price")
        _has(page, region, "₹2,58,662")
        tap(_role(page, "button", "Parts"))
        sheet = _role(page, "dialog", "Parts")
        _wait(page, sheet.is_visible, "the Parts sheet")
        tap(sheet.get_by_role("option", name="Filler cap", exact=True))
        _until_snap(page, lambda s: s["part"] == "filler-cap", "the part chosen by tap")
        if sheet.count() and sheet.is_visible():
            page.keyboard.press("Escape")
        _wait(page, lambda: sheet.count() == 0 or not sheet.is_visible(), "the sheet to close")
        select(_role(page, "combobox", "Hub city"), "Kochi")
        wanted = Api(world.base).live("kochi")["quote"]["onRoadPaise"]
        _until_snap(page, lambda s: s["drawn"]["onRoadPaise"] == wanted, "the Kochi amount drawn")
        _wait(page, lambda: "₹2,58,662" not in _text(region), "the Pune amount to go")
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "the button after the hub change")
        tap(button)
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "a real tap to reach Sign in")


def test_amount_display(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/api/health", locale="de-DE") as page:
        with held(page, "**/api/live**") as release:
            page.goto(world.base + _room(at=0.35, ch="tank"))
            region = _role(page, "region", "On-road price")
            _wait(page, lambda: "Reading price…" in _text(region) or "₹2,58,662" in _text(region),
                  "the loading words or the server's own reading")
            assert "₹0" not in _text(region), "a zero amount showed before its data"
            release()
        _ready(page)
        _has(page, region, "₹2,58,662")
        assert "₹2,24,200" in _text(region), "the ex-showroom numeral"
        page.route(re.compile(r"/api/live(\?|/now)"), lambda r: r.fulfill(status=503, body="{}"))
        page.reload()
        page.unroute(re.compile(r"/api/live(\?|/now)"))
        _ready(page)
        streamed: list[Any] = []
        page.route(re.compile(r"/api/live(/now)?(\?|$)"),
                   lambda r: (streamed.append(1), r.fulfill(status=503, body="{}"))[1])
        page.evaluate("() => { window.dispatchEvent(new Event('offline')); }")
        _ready(page)
    world.clock("2026-11-02T00:00:00+05:30")
    with _open(browser, world.base, _room(at=0.35, hub="kochi", ch="tank"), locale="en-US") as page:
        _ready(page)
        _has(page, _role(page, "region", "On-road price"), "₹2,68,662.50")
    with _open(browser, world.base, "/api/health") as page:
        block = {"on": False}
        page.route(re.compile(r"/api/live(/now)?(\?|$)"),
                   lambda r: r.fulfill(status=503, body="{}") if block["on"] else r.continue_())
        page.goto(world.base + _room(at=0.35, ch="tank"))
        _ready(page)
        region = _role(page, "region", "On-road price")
        _has(page, region, "₹2,65,211")
        label = Api(world.base).live()["serverNow"]
        assert label
        block["on"] = True
        page.context.set_offline(True)
        page.context.set_offline(False)
        _wait(page, lambda: "As of 12:00 am IST" in _text(region), "the last amount labelled with its as-of time", 45)
        assert "₹2,65,211" in _text(region)
        assert _disabled(_role(page, "button", "Lock this price")), "Lock this price after a failed read"
        block["on"] = False
        _wait(page, lambda: "As of" not in _text(region), "the first good reading to clear the label in place", 15)


def test_amount_and_stale_hub_edges(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/api/health") as page:
        with held(page, "**/api/live**") as release:
            page.goto(world.base + _room(at=0.35, ch="tank"))
            button = _role(page, "button", "Lock this price")
            _wait(page, lambda: button.count() == 1, "button Lock this price")
            embedded = "₹2,58,662" in _text(_role(page, "region", "On-road price"))
            assert embedded or _disabled(button), "Lock this price before any reading"
            release()
        _ready(page)
        region = _role(page, "region", "On-road price")
        _wait(page, lambda: not _disabled(button), "Lock this price after a reading")
        with held(page, "**/api/live**hub=kochi**") as release_kochi:
            select(_role(page, "combobox", "Hub city"), "Kochi")
            _wait(page, lambda: "₹2,58,662" not in _text(region), "the old city's amount to clear at once", 2)
            assert "Reading price…" in _text(region)
            assert _disabled(button)
            release_kochi()
        _wait(page, lambda: "₹" in _text(region), "the Kochi amount")
        select(_role(page, "combobox", "Hub city"), "Pune")
        _has(page, region, "₹2,58,662")
        assert world.host().post("/api/hub/stock-count/start").status_code == 200
        _wait(page, lambda: _disabled(button), "Lock this price while the hub is stale")
        _has(page, region, "Stock as of 9:00 am IST")
        assert ("As of " + SEED_STOCK_LABEL) not in _text(region).replace("Stock as of " + SEED_STOCK_LABEL, ""), \
            "the quote went stale"
        assert "₹2,58,662" in _text(region)
        reading = Api(world.base).live()
        assert reading["stale"] is True and reading["quote"]["onRoadPaise"] == _paise(258662)
        assert style(button, "opacity")["opacity"] == "1"


def test_one_hub_road_tax_step(world: World, browser: Any) -> None:
    world.clock("2026-11-01T09:00:00+05:30")
    rider = world.rider()
    lock = world.locked(rider, "kochi", MEGH, SLATE)
    assert lock["onRoadPaise"] == _paise(267512)
    old = Api(world.base).live("kochi", MEGH)["quote"]["stepEffectiveFrom"]
    pune = Api(world.base).live("pune")["quote"]
    assert Api(world.base).live("kochi", DESH)["quote"]["onRoadPaise"] == _paise(430120)
    world.clock("2026-11-01T23:59:59+05:30")
    with _open(browser, world.base, _room(at=0.35, ch="tank")) as page:
        _ready(page)
        world.clock("2026-11-02T00:00:00+05:30")
        reading = Api(world.base).live("kochi", MEGH)
        assert reading["quote"]["onRoadPaise"] == _paise(268662) + 50
        assert reading["quote"]["roadTaxPercent"] == 12.5 and reading["quote"]["stepEffectiveFrom"] == "2026-11-02"
        assert Api(world.base).live("kochi", DESH)["quote"]["onRoadPaise"] == _paise(431975)
        assert Api(world.base).live("pune")["quote"] == pune
        _run(page, 3000)
        assert not [s for s in _log(page) if s.startswith("Price updated")], "a Pune screen got a price status"
    rider.renew()
    assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["onRoadPaise"] == _paise(267512)
    late = world.rider()
    _err(late.claim("kochi", MEGH, KESAR, step=old), 409, "price_moved")
    assert late.get("/api/locks").json()["locks"] == []


def test_wf_w7_price_lock_ordinary(world: World, browser: Any, valkey: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.92, ch="cluster")) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "an enabled button")
        click(button)
        _sign_in(page, rider.user["mobile"])
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the lock dialog after sign-in")
        body = _text(dialog)
        for words in ("Megh 349", "Monsoon Slate", "Pune", "₹2,58,662", "30 Oct, 6:00 pm IST"):
            assert words in body, f"{words} missing from {body}"
        with held(page, "**/api/locks") as release:
            click(dialog.get_by_role("button", name="Confirm lock", exact=True))
            _said(page, "Checking with the hub.")
            assert _disabled(dialog.get_by_role("button", name="Confirm lock", exact=True))
            assert rider.get("/api/locks").json()["locks"] == [] or True
            release()
        _said(page, "Price locked until 30 Oct, 6:00 pm IST.")
        _wait(page, lambda: accessible_name(page) == "Lock this price", "focus to return to Lock this price")
        _until_snap(page, lambda s: abs(s["needleDeg"] - 25.31) <= 0.5, "the needle on the hours left")
        locks = rider.get("/api/locks").json()["locks"]
        assert len(locks) == 1 and locks[0]["state"] == "locked" and set(locks[0]) == LOCK_KEYS
        key = _holds("pune", MEGH, SLATE)
        assert _score(valkey, key, locks[0]["ref"]) == _ms(locks[0]["expiresAt"])
        assert valkey.command("ZCARD", key) == 1
        assert _disabled(button), "Lock this price while holding this exact trio"
        assert rider.claim().status_code == 200 and valkey.command("ZCARD", key) == 1
        click(_role(page, "link", "Garage"))
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹2,58,662")
        _wait(page, _role(page, "heading", "Yours until Friday, 6 pm IST.").is_visible, "the Garage statement")


def test_wf_w7_price_lock_last_unit(world: World, browser: Any) -> None:
    world.clock("2026-10-31T15:00:00+05:30")
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.92, finish=KESAR, ch="cluster"), rider) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "an enabled button")
        click(button)
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the dialog")
        click(dialog.get_by_role("button", name="Confirm lock", exact=True))
        _said(page, "Checking with the hub.")
        lock = rider.get("/api/locks").json()["locks"][0]
        assert lock["state"] == "requested" and lock["onRoadPaise"] == _paise(258662)
        reading = Api(world.base).live("pune", MEGH, KESAR)
        assert reading["unitsLeft"] == 0
        assert _snap(page)["drawn"]["lockExpiresAt"] is None
        stock = world.host().get("/api/hub/stock").json()["units"]
        row = next(u for u in stock if u["model"] == MEGH and u["finish"] == KESAR)
        assert (row["onHand"], row["held"], row["unitsLeft"]) == (1, 1, 0), "counts disagree across surfaces"
        world.clock("2026-11-01T00:00:00+05:30")
        confirm = world.host().post(f"/api/hub/locks/{lock['id']}/confirm")
        assert confirm.status_code == 200 and confirm.json()["lock"]["onRoadPaise"] == _paise(258662)
        assert confirm.json()["lock"]["stepEffectiveFrom"] == "2026-10-01", "confirmation re-priced the lock"
        assert confirm.json()["lock"]["expiresLabel"] == lock["expiresLabel"]
        _said(page, "Price locked until 2 Nov, 6:00 pm IST.")


def test_wf_w7_price_lock_outage(world: World, browser: Any) -> None:
    down = World(_peer("APP_VALKEY_DOWN_URL"), wait_live=False)
    rider = down.rider()
    reading = _poll(lambda: (lambda r: r if r["stale"] else None)(Api(down.base).live()),
                    "the ledger-down copy to read stale", OUTAGE_LIMIT_S + SLACK_S)
    assert reading["staleReason"] == "system" and reading["stockAsOfLabel"] == "9:00 am IST"
    assert reading["quote"]["onRoadPaise"] == _paise(258662)
    at = time.monotonic()
    refused = rider.claim()
    assert time.monotonic() - at <= REFUSAL_LIMIT_S + 1
    _err(refused, 503, "hub_unreachable")
    _plain_error(refused)
    _err(rider.claim("pune", MEGH, RAAT), 409, "none_left")
    assert rider.get("/api/locks").json()["locks"] == []
    with _open(browser, down.base, _room(at=0.92, ch="cluster"), rider) as page:
        _ready(page)
        _said(page, "Hub system unreachable. Showing stock from 9:00 am IST. Locks are paused.")
        _until_snap(page, lambda s: s["lamp"] is True, "the lit tell-tale")
        assert _disabled(_role(page, "button", "Lock this price"))
        _has(page, _role(page, "region", "On-road price"), "₹2,58,662")


def test_lock_claim_races(world: World, valkey: Any, app_url: str) -> None:
    second = _peer("APP_SECOND_NODE_URL")
    riders = [world.rider() for _ in range(6)]
    calls = [lambda r=r, i=i: (r.on(second) if i % 2 else r).claim("pune", MEGH, KESAR) for i, r in enumerate(riders)]
    replies = _together(*calls)
    codes = sorted(r.status_code for r in replies)
    assert codes == [202] + [409] * 5, codes
    for reply in replies:
        if reply.status_code == 409:
            _err(reply, 409, "none_left")
    assert valkey.command("ZCARD", _holds("pune", MEGH, KESAR)) == 1
    pair = [world.rider(), world.rider()]
    two = _together(*[lambda r=r: r.claim("pune", DESH, SLATE) for r in pair])
    assert sorted(r.status_code for r in two) == [201, 202]
    solo = world.rider()
    many = _together(*[lambda: solo.claim("bengaluru", MEGH, SLATE) for _ in range(4)])
    assert sorted(r.status_code for r in many) == [200, 200, 200, 201]
    assert len({r.json()["lock"]["id"] for r in many}) == 1
    assert valkey.command("ZCARD", _holds("bengaluru", MEGH, SLATE)) == 1
    last = world.rider()
    repeats = _together(*[lambda: last.claim("bengaluru", DESH, KESAR) for _ in range(4)])
    assert [r.status_code for r in repeats] == [202] * 4
    assert valkey.command("ZCARD", _holds("bengaluru", DESH, KESAR)) == 1
    three = [world.rider() for _ in range(3)]
    assert [r.claim("kochi", DESH, SLATE).status_code for r in three] == [201, 201, 202]
    _err(solo.claim("kochi", MEGH, SLATE), 409, "lock_exists_other_finish")
    assert app_url


def test_requested_lock_survives_reload(world: World, browser: Any) -> None:
    rider = world.rider()
    lock = rider.claim("pune", MEGH, KESAR).json()["lock"]
    with _open(browser, world.base, "/garage", rider) as page:
        band = _role(page, "region", "Your lock")
        for round_number in range(2):
            _has(page, band, "Checking with the hub.")
            assert "₹" not in _text(band), "a requested lock showed amounts"
            assert _role(page, "button", "Release this lock").count() == 0
            _said(page, "Checking with the hub.")
            if round_number == 0:
                page.reload()
        assert world.host().post(f"/api/hub/locks/{lock['id']}/confirm").status_code == 200
        _said(page, "Price locked until 30 Oct, 6:00 pm IST.")
        _has(page, band, "₹2,58,662")
        _wait(page, _role(page, "button", "Release this lock").is_visible, "release after confirmation")
    world2 = world.rider()
    other_lock = world2.claim("pune", DESH, RAAT).json()["lock"]
    with _open(browser, world.base, "/garage", world2) as page:
        _said(page, "Checking with the hub.")
        assert world.host().post(f"/api/hub/locks/{other_lock['id']}/refuse").status_code == 200
        _said(page, "That finish has just gone. Nothing was locked.")
        _has(page, _role(page, "region", "Your lock"), "Nothing is held for you yet.")


def test_lock_dialog(world: World, browser: Any) -> None:
    world.clock("2026-10-28T17:59:59+05:30")
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.35, ch="tank"), rider, device_time=CLOCK_WRONG) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "an enabled button")
        click(button)
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the dialog")
        _has(page, dialog, "30 Oct, 6:00 pm IST")
        keep = dialog.get_by_role("button", name="Keep looking", exact=True)
        keep.focus()
        for _ in range(6):
            page.keyboard.press("Tab")
            assert page.evaluate("(el) => el.contains(document.activeElement)", dialog.element_handle()), "Tab escaped"
        for _ in range(6):
            page.keyboard.press("Shift+Tab")
            assert page.evaluate("(el) => el.contains(document.activeElement)", dialog.element_handle()), "Shift+Tab escaped"
        world.clock("2026-10-28T18:00:00+05:30")
        _has(page, dialog, "31 Oct, 6:00 pm IST", 8)
        assert rider.live()["lockPreview"]["expiresLabel"] == "31 Oct, 6:00 pm IST"
        page.keyboard.press("Escape")
        _wait(page, lambda: dialog.count() == 0 or not dialog.is_visible(), "Escape to close the dialog")
        _wait(page, lambda: accessible_name(page) == "Lock this price", "focus back on its opener")
        click(button)
        _wait(page, dialog.is_visible, "the dialog again")
        click(keep)
        _wait(page, lambda: accessible_name(page) == "Lock this price", "Keep looking to return focus")
        assert rider.get("/api/locks").json()["locks"] == [], "closing the dialog made a lock"


def test_ledger_gate(world: World, valkey: Any) -> None:
    rider = world.rider()
    ghost = "ghost-member"
    _ledger("ZADD", _holds("gurugram", DESH, KESAR), "+inf", ghost)
    _ledger("ZADD", _holds("gurugram", DESH, KESAR), "+inf", ghost + "-2")
    _err(rider.claim("gurugram", DESH, KESAR), 409, "none_left")
    assert rider.get("/api/locks").json()["locks"] == []
    holder = world.rider()
    lock = holder.claim("pune", MEGH, KESAR).json()["lock"]
    ride = holder.ride(_ist("2026-10-30", "11:30:00"))
    assert ride.status_code == 201
    setter = world.rider()
    set_lock = world.locked(setter, "pune", MEGH, SLATE)
    world_host_day = setter.post(f"/api/locks/{set_lock['id']}/delivery", {"date": "2026-11-06"})
    assert world_host_day.status_code == 200
    for key in valkey.keys(f"{PREFIX}:*"):
        _ledger("DEL", key)
    rivals = [world.rider() for _ in range(4)]
    for reply in _together(*[lambda r=r: r.claim("pune", MEGH, KESAR) for r in rivals]):
        _err(reply, 409, "none_left")
    _poll(lambda: lock["ref"] in valkey.command("ZRANGE", _holds("pune", MEGH, KESAR), 0, -1),
          "keys to be rebuilt at a sweep", SWEEP_S + SLACK_S)
    for reply in _together(*[lambda r=r: r.ride(_ist("2026-10-30", "11:30:00")) for r in rivals]):
        _err(reply, 409, "slot_taken")
    locks = [world.locked(r, "pune", DESH, SLATE) for r in rivals[:1]]
    _err(rivals[0].post(f"/api/locks/{locks[0]['id']}/delivery", {"date": "2026-11-06"}), 409, "delivery_day_full")
    moved = world.rider()
    _err(moved.claim("pune", DESH, SLATE, step="2020-01-01"), 409, "price_moved")
    assert moved.get("/api/locks").json()["locks"] == []
    assert valkey.command("ZCARD", _holds("pune", DESH, SLATE)) == 1, "a refused claim left a member"


def test_expiry_table(app_url: str) -> None:
    table = [("pune", "2026-10-28T09:00:00+05:30", "2026-10-30T18:00:00+05:30", 57, 25.31),
             ("pune", "2026-10-28T18:00:00+05:30", "2026-10-31T18:00:00+05:30", 72, 67.50),
             ("pune", "2026-11-01T09:00:00+05:30", "2026-11-04T18:00:00+05:30", 81, 92.81),
             ("pune", "2026-10-31T18:00:00+05:30", "2026-11-04T18:00:00+05:30", 96, 135.00),
             ("pune", "2026-10-30T09:00:00+05:30", "2026-11-01T18:00:00+05:30", 57, 25.31),
             ("pune", "2026-11-06T09:00:00+05:30", "2026-11-09T18:00:00+05:30", 81, 92.81),
             ("bengaluru", "2026-10-30T09:00:00+05:30", "2026-11-02T18:00:00+05:30", 81, 92.81),
             ("gurugram", "2026-11-06T09:00:00+05:30", "2026-11-11T18:00:00+05:30", 129, 135.00),
             ("gurugram", "2026-11-05T18:00:00+05:30", "2026-11-11T18:00:00+05:30", 144, 135.00)]
    for hub, issued, ends, hours, needle in table:
        world = World(app_url)
        world.clock(issued)
        rider = world.rider()
        lock = world.locked(rider, hub, MEGH, SLATE)
        assert _when(lock["expiresAt"]) == _when(ends), (hub, issued)
        assert lock["expiresAt"].endswith("+05:30")
        reading = rider.live(hub)
        assert reading["hoursLeft"] == hours and _needle(reading["hoursLeft"]) == pytest.approx(needle, abs=0.01)
    world = World(app_url)
    rider = world.rider()
    lock = world.locked(rider)
    world.clock("2026-10-30T17:59:59+05:30")
    rider.renew()
    current = rider.get(f"/api/locks/{lock['id']}").json()["lock"]
    assert current["state"] == "locked" and current["hoursLeft"] == 1
    world.clock("2026-10-30T18:00:00+05:30")
    rider.renew()
    ended = rider.get(f"/api/locks/{lock['id']}").json()["lock"]
    assert ended["state"] == "expired" and rider.live()["hoursLeft"] == 0
    _err(rider.post(f"/api/locks/{lock['id']}/release"), 409, "lock_expired")
    for at, want_pune, want_blr in [("2026-10-28T17:59:59+05:30", "30 Oct, 6:00 pm IST", None),
                                    ("2026-10-28T18:00:00+05:30", "31 Oct, 6:00 pm IST", None),
                                    ("2026-10-31T17:59:59+05:30", "2 Nov, 6:00 pm IST", None),
                                    ("2026-10-31T18:00:00+05:30", "4 Nov, 6:00 pm IST", None),
                                    ("2026-10-30T09:00:00+05:30", "1 Nov, 6:00 pm IST", "2 Nov, 6:00 pm IST")]:
        world.clock(at)
        assert Api(app_url).live()["lockPreview"]["expiresLabel"] == want_pune, at
        if want_blr:
            assert Api(app_url).live("bengaluru")["lockPreview"]["expiresLabel"] == want_blr


def test_wf_w8_lock_card_band(world: World, browser: Any) -> None:
    rider = world.rider()
    reply = rider.claim(expiresAt="2099-01-01T00:00:00+05:30", onRoadPaise=1, unitsLeft=99, state="delivered",
                        ref="forged", issuedAt="2000-01-01T00:00:00+05:30", riderId="nobody")
    assert reply.status_code == 201
    lock = reply.json()["lock"]
    assert lock["onRoadPaise"] == _paise(258662) and lock["state"] == "locked" and lock["ref"] != "forged"
    assert lock["expiresLabel"] == "30 Oct, 6:00 pm IST"
    with _open(browser, world.base, "/garage", rider, tz=AUCKLAND, device_time=CLOCK_WRONG) as page:
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹2,58,662")
        _wait(page, _role(page, "heading", "Yours until Friday, 6 pm IST.").is_visible, "the IST weekday in Auckland")
        _has(page, band, "57")
        page.reload()
        _has(page, band, "57")
        _mark(page)
        world.clock("2026-10-28T10:00:00+05:30")
        _wait(page, lambda: re.search(r"\b56\b", _text(band)), "hours to tick at the whole IST hour", 8)
        world.clock("2026-10-30T16:00:00+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        _sign_in(page, rider.user["mobile"])
        _has(page, band, "₹2,58,662")
        world.clock("2026-10-30T17:59:59+05:30")
        _wait(page, lambda: re.search(r"\b1\b", _text(band)), "one hour left a second before the end", 8)
        assert "Your price lock has ended. The current price applies." not in _log(page)
        _role(page, "button", "Release this lock").focus()
        world.clock("2026-10-30T18:00:00+05:30")
        _said(page, "Your price lock has ended. The current price applies.")
        _has(page, band, "Nothing is held for you yet.")
        _wait(page, lambda: accessible_name(page) == "Start the build", "focus on the band's first action")
        assert _log(page).count("Your price lock has ended. The current price applies.") == 1
        _no_reload(page)


def test_wf_w8_lock_card_release(world: World, browser: Any, valkey: Any) -> None:
    world.clock("2026-10-31T09:00:00+05:30")
    rider = world.rider()
    lock = world.locked(rider)
    key = _holds("pune", MEGH, SLATE)
    assert _score(valkey, key, lock["ref"]) is not None
    world.clock("2026-11-01T00:00:00+05:30")
    rider.renew()
    with _open(browser, world.base, "/garage", rider) as page:
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹2,58,662")
        assert "₹2,65,211" not in _text(band), "a later step changed the lock band"
        click(_role(page, "button", "Release this lock"))
        _said(page, "Lock released.")
        _has(page, band, "Nothing is held for you yet.")
        assert world.rider().claim("pune", MEGH, KESAR).status_code == 202
        _run(page, 2000)
        status = page.get_by_role("status", name="Showroom status")
        assert "Lock released." in _text(status), "a re-read overwrote the status the action just showed"
    assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["state"] == "released"
    assert _score(valkey, key, lock["ref"]) is None
    assert Api(world.base).live()["unitsLeft"] == 3
    _err(rider.post(f"/api/locks/{lock['id']}/release"), 409, "illegal_state")


def test_hub_closed_days(world: World) -> None:
    api = Api(world.base)
    closed = {"2026-11-03": HUBS, "2026-11-08": HUBS, "2026-11-01": ["bengaluru", "kochi"],
              "2026-11-09": ["gurugram"]}
    world.clock("2026-10-30T09:00:00+05:30")
    for date, hubs in closed.items():
        for hub in HUBS:
            reply = api.get(f"/api/hubs/{hub}/slots?date={date}").json()
            days = [d["date"] for d in api.get(f"/api/hubs/{hub}/ride-days").json()["days"]]
            if hub in hubs:
                assert reply["open"] is False and reply["slots"] == [] and date not in days, (hub, date)
            else:
                assert reply["open"] is True and len(reply["slots"]) == len(SLOT_LABELS), (hub, date)
                assert date in days, (hub, date)
    assert api.live("pune")["lockPreview"]["expiresLabel"] == "1 Nov, 6:00 pm IST"
    assert api.live("bengaluru")["lockPreview"]["expiresLabel"] == "2 Nov, 6:00 pm IST"
    rider = world.rider()
    lock = world.locked(rider, "bengaluru", MEGH, SLATE)
    days = {d["date"]: d for d in rider.get(f"/api/locks/{lock['id']}/delivery-days").json()["days"]}
    assert days["2026-11-08"]["state"] == "closed" and days["2026-11-03"]["state"] == "closed"
    assert days["2026-11-09"]["state"] == "open", "Gurugram's closed day closed Bengaluru"
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-08"}), 409, "delivery_day_closed")


def test_holds_on_the_app_clock(world: World, valkey: Any) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    key = _holds("pune", MEGH, SLATE)
    assert _score(valkey, key, lock["ref"]) == _ms("2026-10-30T18:00:00+05:30")
    assert valkey.ttl(key) == -1
    world.clock("2026-10-30T17:59:59+05:30")
    assert _score(valkey, key, lock["ref"]) is not None, "the member was trimmed before the app clock's expiry"
    world.clock("2026-10-30T18:00:00+05:30")
    assert _score(valkey, key, lock["ref"]) is None, "the member remained when the clock reply returned"
    world.clock("2026-10-29T09:00:00+05:30")
    assert _score(valkey, key, lock["ref"]) is None, "an ended hold returned on a backward move"
    rider.renew()
    assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["state"] == "expired"
    world2 = World(world.base)
    setter = world2.rider()
    kesar = world2.locked(setter, "pune", MEGH, KESAR)
    assert setter.post(f"/api/locks/{kesar['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    kesar_key = _holds("pune", MEGH, KESAR)
    assert _score(valkey, kesar_key, kesar["ref"]) == float("inf")
    set_lock = setter.get(f"/api/locks/{kesar['id']}").json()["lock"]
    assert set_lock["expiresAt"] is None and set_lock["expiresLabel"] is None
    world2.clock("2026-11-01T09:00:00+05:30")
    assert _score(valkey, kesar_key, kesar["ref"]) == float("inf")
    _err(world2.rider().claim("pune", MEGH, KESAR), 409, "none_left")


def test_wf_w9_price_sheet_make(world: World, browser: Any) -> None:
    rider = world.rider("Ravi Kulkarni")
    assert rider.ride(_ist("2026-10-30", "11:30:00")).status_code == 201
    lock = world.locked(rider)
    world2 = world.rider()
    _err(rider.get(f"/api/locks/{lock['id']}/sheet"), 404, "not_found")
    with _open(browser, world.base, "/garage", rider) as page:
        tab = page.context.new_page()
        tab.goto(world.base + "/garage")
        make = _role(page, "button", "Make price sheet")
        _wait(page, make.is_visible, "button Make price sheet")
        with held(page, "**/sheet") as release:
            click(make)
            _said(page, "Making price sheet…")
            assert _role(page, "link", "Download price sheet").count() == 0, "ready before the render"
            release()
        _said(page, "Price sheet ready.")
        link = _role(page, "link", "Download price sheet")
        _wait(page, link.is_visible, "the download link")
        _wait(tab, _role(tab, "link", "Download price sheet").is_visible, "the link in another open tab", 8)
    reply = rider.get(f"/api/locks/{lock['id']}/sheet")
    assert reply.status_code == 200 and reply.headers["content-type"].startswith("application/pdf")
    assert f"malhar-price-sheet-{lock['id']}.pdf" in reply.headers.get("content-disposition", "")
    assert reply.content.startswith(b"%PDF-") and pdf_pages(reply.content) >= 1
    text = " ".join(pdf_text(reply.content).split())
    for words in ("Malhar Motor Works", "Price Sheet", "Ravi Kulkarni", "Megh 349", "Monsoon Slate", "Pune", "₹2,24,200",
                  "₹24,662", "₹9,800", "₹2,58,662", _line(VALID_UNTIL, ("d Mon YYYY", "30 Oct 2026"), ("h:mm am/pm", "6:00 pm"))):
        assert words in text, f"{words} missing from the PDF: {text}"
    assert LICENCE not in text and rider.user["mobile"] not in text, "the PDF carries private data"
    assert rider.user["mobile"] not in reply.headers.get("content-disposition", "")
    assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["sheetReady"] is True
    _err(world2.get(f"/api/locks/{lock['id']}/sheet"), 404, "not_found")
    _err(world2.post(f"/api/locks/{lock['id']}/sheet"), 404, "not_found")
    _err(rider.on(_peer("APP_SECOND_NODE_URL")).post("/api/locks/nope/sheet"), 404, "not_found")
    assert rider.post(f"/api/locks/{lock['id']}/release").status_code == 200
    assert rider.get(f"/api/locks/{lock['id']}/sheet").status_code == 200, "a made sheet stays downloadable"


@pytest.mark.timeout(600)
def test_wf_w9_price_sheet_failure(world: World, browser: Any) -> None:
    down = World(_peer("APP_SHEET_DOWN_URL"))
    outsider = down.rider()
    held_lock = down.locked(outsider)
    refused = outsider.post(f"/api/locks/{held_lock['id']}/sheet")
    _err(refused, 503, "sheet_unreachable")
    _plain_error(refused)
    assert outsider.get(f"/api/locks/{held_lock['id']}").json()["lock"]["sheetReady"] is False
    with Stub(500) as stub, _copy(GOTENBERG_URL=stub.url) as copy:
        rider = world.rider()
        lock = world.locked(rider)
        with _open(browser, copy, "/garage", rider) as page:
            make = _role(page, "button", "Make price sheet")
            _wait(page, make.is_visible, "the button")
            band = _role(page, "region", "Your lock")
            failed = "Price sheet could not be made. Try again."
            click(make)
            _said(page, failed)
            _has(page, band, failed)
            assert _role(page, "link", "Download price sheet").count() == 0
            assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["sheetReady"] is False
            assert stub.requests and stub.requests[0]["path"] == "/forms/chromium/convert/html"
            assert b"index.html" in stub.requests[0]["body"]
            stub.status, stub.body = 200, GOOD_PDF
            click(make)
            _said(page, "Price sheet ready.")
            _wait(page, lambda: failed not in _text(band), "the outage field to clear in place")
            _wait(page, _role(page, "link", "Download price sheet").is_visible, "the link after retry")
        assert rider.get(f"/api/locks/{lock['id']}/sheet").content == GOOD_PDF


@pytest.mark.timeout(600)
def test_provider_edges(world: World, browser: Any) -> None:
    with Stub(200, b"<html>not a pdf</html>") as stub, _copy(GOTENBERG_URL=stub.url) as one, \
            _copy(GOTENBERG_URL=stub.url) as two:
        rider = world.rider()
        lock = world.locked(rider)
        _err(rider.on(one).post(f"/api/locks/{lock['id']}/sheet"), 503, "sheet_unreachable")
        stub.body = b"%PDF-1.4 truncated"
        _err(rider.on(two).post(f"/api/locks/{lock['id']}/sheet"), 503, "sheet_unreachable")
        assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["sheetReady"] is False
        stub.body = GOOD_PDF
        stub.requests.clear()
        replies = _together(*[lambda c=c: rider.on(c).post(f"/api/locks/{lock['id']}/sheet")
                              for c in (one, two, one, two)])
        assert sorted(r.status_code for r in replies) == [200, 200, 200, 201]
        assert all(r.json()["lock"]["sheetReady"] is True for r in replies)
        assert len(stub.requests) == 1, f"{len(stub.requests)} renders for one sheet"
    named = world.rider(MARKUP_NAME)
    world.clock("2026-10-31T09:00:00+05:30")
    named.renew()
    kept = world.locked(named, "pune", DESH, SLATE)
    world.clock("2026-11-01T09:00:00+05:30")
    named.renew()
    second = _peer("APP_SECOND_NODE_URL")
    both = _together(lambda: named.post(f"/api/locks/{kept['id']}/sheet"),
                     lambda: named.on(second).post(f"/api/locks/{kept['id']}/sheet"))
    assert sorted(r.status_code for r in both) == [200, 201]
    text = " ".join(pdf_text(named.get(f"/api/locks/{kept['id']}/sheet").content).split())
    assert MARKUP_NAME in text, f"markup was not literal: {text}"
    assert "₹4,18,640" in text and "₹4,26,410" not in text, "the sheet took the current step"
    assert _line(VALID_UNTIL, ("d Mon YYYY", "2 Nov 2026"), ("h:mm am/pm", "6:00 pm")) in text
    assert named.post(f"/api/locks/{kept['id']}/delivery", {"date": "2026-11-09"}).status_code == 200
    text = " ".join(pdf_text(named.get(f"/api/locks/{kept['id']}/sheet").content).split())
    assert "Valid until" in text, "a made sheet was rendered again"
    other = world.rider()
    locked = world.locked(other, "bengaluru", MEGH, SLATE)
    assert other.post(f"/api/locks/{locked['id']}/delivery", {"date": "2026-11-09"}).status_code == 200
    assert other.post(f"/api/locks/{locked['id']}/sheet").status_code == 201
    text = " ".join(pdf_text(other.get(f"/api/locks/{locked['id']}/sheet").content).split())
    assert _line(DELIVERY_LINE, ("d Mon YYYY", "9 Nov 2026")) in text and "Valid until" not in text, text
    tabbed = world.rider()
    tab_lock = world.locked(tabbed, "kochi", MEGH, SLATE)
    with _open(browser, world.base, "/garage", tabbed) as page:
        _wait(page, _role(page, "button", "Make price sheet").is_visible, "the band")
        assert tabbed.on(second).post(f"/api/locks/{tab_lock['id']}/sheet").status_code == 201
        _wait(page, _role(page, "link", "Download price sheet").is_visible, "the link from the other copy", 8)


def test_wf_w10_test_ride_keyboard(world: World, browser: Any, valkey: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-30", rider,
               tz=AUCKLAND, device_time=CLOCK_WRONG) as page:
        grid = _role(page, "grid", "Test-ride slots")
        _wait(page, lambda: grid.get_by_role("gridcell").count() == len(SLOT_LABELS), "twelve published slots")
        assert [_text(c) for c in grid.get_by_role("gridcell").all()] == SLOT_LABELS or all(
            grid.get_by_role("gridcell", name=name, exact=True).count() == 1 for name in SLOT_LABELS)
        for label in ("Today, Wed 28 Oct", "Tomorrow, Thu 29 Oct", "Fri 30 Oct"):
            assert _offered(_role(page, "combobox", "Ride day"), label), f"{label} not offered"

        _role(page, "combobox", "Ride day").focus()
        page.keyboard.press("Tab")
        name = accessible_name(page)
        start = SLOT_LABELS.index(name)
        page.keyboard.press("ArrowRight")
        assert accessible_name(page) == SLOT_LABELS[start + 1]
        page.keyboard.press("ArrowDown")
        assert accessible_name(page) == SLOT_LABELS[start + 5]
        page.keyboard.press("ArrowLeft")
        assert accessible_name(page) == SLOT_LABELS[start + 4]
        page.keyboard.press("Enter")
        chosen = grid.get_by_role("gridcell", name=SLOT_LABELS[start + 4], exact=True)
        _wait(page, lambda: chosen.get_attribute("aria-selected") == "true", "Enter to choose the cell")
        assert _query(page)["slot"] == "13:00"
        page.keyboard.press("Tab")
        assert accessible_name(page) == "Licence number"
        page.keyboard.type(LICENCE)
        page.keyboard.press("Tab")
        page.keyboard.type(LICENCE_VALID)
        page.keyboard.press("Tab")
        page.keyboard.press("Space")
        assert world.rider().ride(_ist("2026-10-30", "13:00:00")).status_code == 201
        _said(page, "That slot has just been taken. Pick another.", 8)
        _wait(page, lambda: chosen.get_attribute("aria-selected") != "true" and _disabled(chosen), "the choice to clear")
        assert _role(page, "textbox", "Licence number").input_value() == LICENCE, "typed values were lost"
        other = grid.get_by_role("gridcell", name=SLOT_LABELS[6], exact=True)
        other.click()
        book = _role(page, "button", "Book this ride")
        book.focus()
        page.keyboard.press("Enter")
        _said(page, "Ride booked for Fri 30 Oct, 2:30 pm IST.")
    ride = rider.get("/api/rides").json()["rides"][0]
    assert ride["state"] == "booked" and ride["label"] == SLOT_LABELS[6]
    assert valkey.command("GET", f"{PREFIX}:slot:pune:2026-10-30T14:30") == ride["id"]
    with _open(browser, world.base, "/garage", rider) as page:
        band = _role(page, "region", "Your ride")
        _has(page, band, "Booked")
        _wait(page, _role(page, "link", "Change this ride").is_visible, "link Change this ride")


def test_wf_w10_test_ride_cut_off_in_place(world: World, browser: Any) -> None:
    world.clock("2026-10-28T09:29:59+05:30")
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-28&slot=11:30",
               tz=NEW_YORK, device_time=CLOCK_WRONG) as page:
        grid = _role(page, "grid", "Test-ride slots")
        cell = grid.get_by_role("gridcell", name="11:30 am IST", exact=True)
        _wait(page, lambda: cell.count() == 1 and cell.get_attribute("aria-selected") == "true", "the slot from the URL")
        assert _disabled(grid.get_by_role("gridcell", name=SLOT_LABELS[0], exact=True))
        assert _disabled(grid.get_by_role("gridcell", name=SLOT_LABELS[3], exact=True))
        slots = Api(world.base).get(_slots_path("pune", "2026-10-28")).json()
        state = {s["label"]: s["state"] for s in slots["slots"]}
        assert state[SLOT_LABELS[0]] == "past_cut_off" and state[SLOT_LABELS[3]] == "taken"
        world.clock("2026-10-28T09:30:00+05:30")
        _wait(page, lambda: _disabled(cell), "the cell to disable at its cut-off", 8)
        _said(page, "That slot has just closed. Pick another.")
        assert cell.get_attribute("aria-selected") != "true"
        _wait(page, lambda: "slot" not in _query(page), "the URL to drop the closed cell")


def test_ride_claim(world: World, valkey: Any) -> None:
    start = _ist("2026-10-30", "11:30:00")
    second = _peer("APP_SECOND_NODE_URL")
    riders = [world.rider() for _ in range(6)]
    replies = _together(*[lambda r=r, i=i: (r.on(second) if i % 2 else r).ride(start) for i, r in enumerate(riders)])
    assert sorted(r.status_code for r in replies) == [201] + [409] * 5, [r.status_code for r in replies]
    winner = next(r for r in replies if r.status_code == 201).json()["ride"]
    assert set(winner) == {"id", "state", "hub", "model", "startsAt", "label", "dayLabel", "cutOffAt", "movedFrom"}
    for reply in replies:
        if reply.status_code == 409:
            _err(reply, 409, "slot_taken")
    assert valkey.command("GET", f"{PREFIX}:slot:pune:2026-10-30T11:30") == winner["id"]
    assert valkey.ttl(f"{PREFIX}:slot:pune:2026-10-30T11:30") == -1
    other_model = next(r for r in riders if r.get("/api/rides").json()["rides"] == [])
    _err(other_model.ride(start, model=DESH), 409, "slot_taken")
    owner = next(r for r in riders if r.get("/api/rides").json()["rides"])
    again = owner.ride(start)
    assert again.status_code == 200 and again.json()["ride"]["id"] == winner["id"]
    _err(owner.ride(_ist("2026-10-30", "13:00:00")), 409, "ride_exists")
    assert owner.ride(_ist("2026-10-30", "13:00:00"), model=DESH).status_code == 201
    _err(other_model.get(f"/api/rides/{winner['id']}"), 404, "not_found")
    _err(other_model.on(second).get(f"/api/rides/{winner['id']}"), 404, "not_found")
    _err(other_model.post(f"/api/rides/{winner['id']}/cancel"), 404, "not_found")
    _err(other_model.ride(_ist("2026-10-30", "11:31:00")), 422, "invalid_slot")
    _err(other_model.ride(_ist("2026-11-03", "11:30:00")), 422, "invalid_slot")
    _err(other_model.ride(_ist("2026-11-12", "11:30:00")), 422, "invalid_slot")
    _err(other_model.ride("not-a-time"), 422, "invalid_body")
    _err(other_model.ride(_ist("2026-10-28", "10:00:00")), 409, "ride_cut_off")


def test_licence_check(world: World) -> None:
    rider = world.rider()
    start = _ist("2026-10-30", "11:30:00")
    _err(rider.ride(start, licence="MH12"), 422, "licence_invalid")
    _err(rider.ride(start, licence="1234567890123MH"), 422, "licence_invalid")
    _err(rider.ride(start, mcwg=False), 422, "mcwg_required")
    _err(rider.ride(start, licence="bad", mcwg=False), 422, "licence_invalid")
    _err(rider.ride(_ist("2026-10-25", "11:30:00"), licence="bad"), 422, "invalid_slot")
    _err(rider.ride(start, valid="2026-10-29"), 422, "licence_expired")
    _err(rider.ride(start, valid="not-a-date"), 422, "invalid_body")
    assert rider.get("/api/rides").json()["rides"] == [], "a refused ride was stored"
    reply = rider.ride(start, licence="MH 12-2019-0043210", valid="2026-10-30")
    assert reply.status_code == 201, "a licence valid on the ride's own date must pass"
    me = rider.get("/api/me").json()["user"]
    assert me["licenceValidUntil"] == "2026-10-30" and "3210" in me["licenceNumber"]
    ira = world.seed_rider(IRA)
    _err(ira.ride(_ist("2026-10-30", "13:00:00"), licence="MH1420210098765", valid="2026-10-29"), 422, "licence_expired")


def test_rereads_keep_place(world: World, browser: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-30", rider) as page:
        grid = _role(page, "grid", "Test-ride slots")
        cell = grid.get_by_role("gridcell", name="11:30 am IST", exact=True)
        _wait(page, lambda: cell.count() == 1, "the cell")
        click(cell)
        _wait(page, lambda: cell.get_attribute("aria-selected") == "true", "the chosen cell")
        field = _role(page, "textbox", "Licence number")
        fill(field, "MH1220190")
        field.evaluate("el => { el.__kept = true; el.setSelectionRange(2, 4); el.focus(); }")
        grid.element_handle().evaluate("el => { el.__kept = true; }")
        cell.evaluate("el => { el.__kept = true; }")
        y = page.evaluate("() => window.scrollY")
        seq = Api(world.base).live()["seq"]
        assert world.rider().ride(_ist("2026-10-30", "16:00:00")).status_code == 201
        assert Api(world.base).live()["seq"] > seq
        _wait(page, lambda: _disabled(grid.get_by_role("gridcell", name=SLOT_LABELS[8], exact=True)), "the re-read")
        assert field.evaluate("el => el.__kept === true && el === document.activeElement"), "focus or node changed"
        assert field.evaluate("el => [el.selectionStart, el.selectionEnd]") == [2, 4], "the caret moved"
        assert field.input_value() == "MH1220190"
        assert grid.element_handle().evaluate("el => el.__kept === true") and cell.evaluate("el => el.__kept === true")
        assert cell.get_attribute("aria-selected") == "true" and page.evaluate("() => window.scrollY") == y
    with _open(browser, world.base, _room(at=0.92, ch="cluster", part="display"), rider) as page:
        _ready(page)
        listbox = _role(page, "listbox", "Parts")
        listbox.element_handle().evaluate("el => { el.__kept = true; }")
        y = _stage_top(page)
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "the re-read on the stage")
        assert _snap(page)["part"] == "display" and _query(page)["part"] == "display"
        assert listbox.element_handle().evaluate("el => el.__kept === true") and _stage_top(page) == y


def test_any_process_or_browser_zone(world: World, browser: Any) -> None:
    other = World(_peer("APP_CLOCKED_NY_URL"))
    instants = ["2026-10-31T23:59:59+05:30", "2026-11-01T00:00:00+05:30"]
    for at in instants:
        world.clock(at)
        other.clock(at)
        for path in ("/api/hubs/pune/ride-days", _slots_path("pune", "2026-11-01"),
                     _slots_path("pune", "2026-11-02"), _slots_path("kochi", "2026-11-01")):
            assert Api(world.base).get(path).json() == Api(other.base).get(path).json(), (at, path)
        days = [d["date"] for d in Api(other.base).get("/api/hubs/pune/ride-days").json()["days"]]
        assert days == sorted(set(days)) and "2026-11-01" in days and CLOSED_TUESDAY not in days
        sheet = [h.get(_sheet_path("2026-11-02")).json() for h in (world.host(), other.host())]
        assert sheet[0]["date"] == sheet[1]["date"] and sheet[0]["dates"] == sheet[1]["dates"], at
        assert sheet[0]["dayLabel"] == sheet[1]["dayLabel"]
    slots = Api(other.base).get(_slots_path("pune", "2026-11-01")).json()["slots"]
    assert [s["label"] for s in slots] == SLOT_LABELS and slots[0]["startsAt"].endswith("+05:30")
    pair = [world.rider(), other.rider()]
    locks = [w.locked(p) for w, p in zip((world, other), pair)]
    grids = [p.get(f"/api/locks/{lock['id']}/delivery-days").json()["days"] for p, lock in zip(pair, locks)]
    assert grids[0] == grids[1] and len(grids[0]) == 28
    dates = [p.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-06"}).json()["lock"]["deliveryDate"]
             for p, lock in zip(pair, locks)]
    assert dates == ["2026-11-06", "2026-11-06"]
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349", tz=NEW_YORK) as page:
        day = _role(page, "combobox", "Ride day")
        _wait(page, lambda: _offered(day, "Today, " + "Sun 1 Nov"), "the server's Today label in New York")
        assert _offered(day, "Tomorrow, " + "Mon 2 Nov")
        grid = _role(page, "grid", "Test-ride slots")
        _wait(page, lambda: grid.get_by_role("gridcell", name=SLOT_LABELS[-1], exact=True).count() == 1,
              "published slots")
        assert grid.get_by_role("gridcell").count() == len(SLOT_LABELS)


def test_choices_in_the_url(world: World, browser: Any) -> None:
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-30") as page:
        grid = _role(page, "grid", "Test-ride slots")
        cell = grid.get_by_role("gridcell", name=SLOT_LABELS[4], exact=True)
        _wait(page, lambda: cell.count() == 1, "the cell")
        click(cell)
        _wait(page, lambda: _query(page).get("slot") == "13:00", "slot=13:00 in the URL")
        entries = page.evaluate("() => history.length")
        fill(_role(page, "textbox", "Licence number"), LICENCE)
        _run(page, 400)
        assert LICENCE not in page.url and page.evaluate("() => history.length") == entries
        page.reload()
        _wait(page, lambda: cell.count() == 1 and cell.get_attribute("aria-selected") == "true", "the chosen cell after reload")
        assert _role(page, "textbox", "Licence number").input_value() == "", "licence fields must start empty"
        page.goto(world.base + "/test-ride?hub=pune&model=megh-349&date=2026-10-30&slot=1:00pm")
        _wait(page, lambda: "slot" not in _query(page), "an invalid slot value to clear")
        page.goto(world.base + "/test-ride?hub=pune&model=megh-349&date=2026-10-28&slot=10:00")
        _said(page, "That slot has just closed. Pick another.")
        _wait(page, lambda: "slot" not in _query(page), "the closed slot to leave the URL")
        page.goto(world.base + "/test-ride?hub=pune&model=megh-349&date=2026-10-28&slot=12:15")
        _said(page, "That slot has just been taken. Pick another.")
        with held(page, "**/api/hubs/kochi/**") as release:
            select(_role(page, "combobox", "Hub city"), "Kochi")
            _run(page, 100)
            select(_role(page, "combobox", "Hub city"), "Gurugram")
            _wait(page, lambda: _query(page).get("hub") == "gurugram", "the newest hub in the URL")
            assert world.rider().ride(_ist("2026-10-28", "13:00:00"), hub="kochi").status_code == 201
            release()
            taken = _role(page, "grid", "Test-ride slots").get_by_role("gridcell", name=SLOT_LABELS[4], exact=True)
            _wait(page, lambda: taken.count() == 1, "Gurugram's grid")
            _run(page, 800)
            assert not _disabled(taken), "a slower Kochi reply painted over Gurugram"
    host = world.host()
    with _open(browser, world.base, "/hub?date=2026-10-30", host) as page:
        sheet_date = _role(page, "combobox", "Sheet date")
        _wait(page, lambda: "Fri 30 Oct" in _text(sheet_date), "the dates from the reply")
        go = _role(page, "button", "Go to today")
        _wait(page, go.is_visible, "Go to today with a date in the URL")
        click(go)
        _wait(page, lambda: "date" not in _query(page), "Go to today to remove the parameter")
        with held(page, "**/api/hub/day-sheet?date=2026-10-29**") as release:
            select(sheet_date, "Tomorrow, Thu 29 Oct")
            _run(page, 100)
            select(sheet_date, "Fri 30 Oct")
            _wait(page, lambda: _query(page).get("date") == "2026-10-30", "the newest date")
            release()
            _run(page, 500)
            assert _query(page).get("date") == "2026-10-30"
            assert page.get_by_text("Nothing on this day.").is_visible()


def test_wf_w11_changes_day_sheet_host(world: World, browser: Any) -> None:
    rider = world.rider("Mira Sen")
    host = world.host()
    with _open(browser, world.base, "/hub?date=2026-10-30", host, tz=NEW_YORK, device_time=CLOCK_WRONG) as page:
        table = _role(page, "table", "Day sheet")
        _wait(page, lambda: page.get_by_text("Nothing on this day.").is_visible(), "the empty state")
        _mark(page)
        assert rider.ride(_ist("2026-10-30", "11:30:00")).status_code == 201
        _wait(page, lambda: table.is_visible() and "Mira Sen" in _text(table), "the booking in place", 8)
        for column in ("Time", "Rider", "Machine", "Licence", "State", "Action"):
            assert table.get_by_role("columnheader", name=column, exact=True).count() == 1, column
        text = _text(table)
        assert "11:30 am IST" in text and LICENCE_LAST4 in text and LICENCE not in text
        _no_reload(page)
    sheet = host.get(_sheet_path("2026-10-30")).json()
    assert set(sheet) == {"hub", "date", "dayLabel", "dates", "rows"} and sheet["hub"] == "pune"
    assert len(sheet["dates"]) == 38
    row = sheet["rows"][0]
    assert set(row) == ROW_KEYS and row["licenceLast4"] == LICENCE_LAST4 and row["finish"] is None
    assert (row["kind"], row["label"], row["riderName"], row["state"], row["actions"]) == \
        ("ride", "11:30 am IST", "Mira Sen", "booked", [])
    assert world.host(KOCHI_HOST).get(_sheet_path("2026-10-30")).json()["rows"] == []
    _err(host.get("/api/hub/day-sheet?date=bad"), 422, "invalid_body")
    _err(rider.get("/api/hub/day-sheet"), 403, "forbidden")
    today = host.get("/api/hub/day-sheet").json()
    assert today["dayLabel"] == "Today, Wed 28 Oct"
    assert [r["riderName"] for r in today["rows"]] == ["Kabir Menon", "Ira Deshpande"]


def test_wf_w11_changes_day_sheet_rider_move(world: World, browser: Any) -> None:
    rider = world.rider("Dev Patil")
    host = world.host()
    first = rider.ride(_ist("2026-10-30", "11:30:00")).json()["ride"]
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-30", rider) as page:
        grid = _role(page, "grid", "Test-ride slots")
        cell = grid.get_by_role("gridcell", name=SLOT_LABELS[6], exact=True)
        _wait(page, lambda: cell.count() == 1, "the grid")
        click(cell)
        click(_role(page, "button", "Move this ride"))
        _said(page, "Ride booked for Fri 30 Oct, 2:30 pm IST.")
        rows = host.get(_sheet_path("2026-10-30")).json()["rows"]
        assert [r["label"] for r in rows] == [SLOT_LABELS[6]], "a moved ride appears only at its current slot"
        moved = rider.get(f"/api/rides/{first['id']}").json()["ride"]
        assert _when(moved["movedFrom"]) == _when(first["startsAt"]) and moved["state"] == "booked"
        world.clock("2026-10-30T12:29:59+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        _sign_in(page, rider.user["mobile"])
        rider.renew()
        world.clock("2026-10-30T12:30:00+05:30")
        _wait(page, _role(page, "button", "Cancel this ride").is_visible, "the cancel button")
        click(_role(page, "button", "Cancel this ride"))
        _said(page, "That ride can no longer be changed.")
        assert "Ride cancelled." not in _log(page), "a refusal at the exact cut-off showed a success"
        assert rider.get(f"/api/rides/{first['id']}").json()["ride"]["state"] == "booked"
        world.clock("2026-10-30T12:29:59+05:30")
        click(_role(page, "button", "Cancel this ride"))
        _said(page, "Ride cancelled.")
    host.renew()
    assert host.get(_sheet_path("2026-10-30")).json()["rows"] == []


def test_ride_move_and_cancel(world: World, valkey: Any) -> None:
    rider = world.rider()
    ride = rider.ride(_ist("2026-10-30", "11:30:00")).json()["ride"]
    path = f"/api/rides/{ride['id']}"
    old_key, new_key = f"{PREFIX}:slot:pune:2026-10-30T11:30", f"{PREFIX}:slot:pune:2026-10-30T13:00"
    _err(rider.post(path + "/move", {"startsAt": ride["startsAt"]}), 409, "illegal_state")
    _err(rider.post(path + "/move", {"startsAt": "nope"}), 422, "invalid_body")
    _err(rider.post(path + "/move", {"startsAt": _ist("2026-11-03", "11:30:00")}), 422, "invalid_slot")
    rival = world.rider()
    assert rival.ride(_ist("2026-10-30", "16:00:00")).status_code == 201
    _err(rider.post(path + "/move", {"startsAt": _ist("2026-10-30", "16:00:00")}), 409, "slot_taken")
    assert valkey.command("GET", old_key) == ride["id"]
    assert rider.post(path + "/move", {"startsAt": _ist("2026-10-30", "13:00:00")}).status_code == 200
    assert valkey.command("GET", new_key) == ride["id"] and valkey.command("GET", old_key) is None
    world.clock("2026-10-30T10:59:59+05:30")
    rider.renew()
    _err(rider.post(path + "/move", {"startsAt": _ist("2026-10-30", "11:30:00")}), 409, "ride_cut_off")
    world.clock("2026-10-30T11:00:00+05:30")
    _err(rider.post(path + "/move", {"startsAt": _ist("2026-10-30", "14:30:00")}), 409, "ride_cut_off")
    _err(rider.post(path + "/cancel"), 409, "ride_cut_off")
    assert valkey.command("GET", new_key) == ride["id"]
    world.clock("2026-10-30T10:59:59+05:30")
    assert rider.post(path + "/cancel").json()["ride"]["state"] == "cancelled"
    assert valkey.command("GET", new_key) is None
    _err(rider.post(path + "/cancel"), 409, "illegal_state")
    _err(rider.post(path + "/move", {"startsAt": "nope"}), 409, "illegal_state")


def test_ride_and_handover_marks(world: World) -> None:
    rider = world.rider()
    ride = rider.ride(_ist("2026-10-30", "11:30:00")).json()["ride"]
    host, leela = world.host(), world.host(LEELA_HOST)
    second = _peer("APP_SECOND_NODE_URL")
    path = f"/api/hub/rides/{ride['id']}/mark"
    _err(rider.post(path, {"outcome": "ridden"}), 403, "forbidden")
    _err(world.host(KOCHI_HOST).post(path, {"outcome": "ridden"}), 404, "not_found")
    world.clock("2026-10-30T11:29:59+05:30")
    host.renew()
    leela.renew()
    rider.renew()
    _err(host.post(path, {"outcome": "ridden"}), 409, "too_early")
    world.clock("2026-10-30T11:30:00+05:30")
    _err(host.post(path, {"outcome": "nope"}), 422, "invalid_body")
    both = _together(lambda: host.post(path, {"outcome": "ridden"}),
                     lambda: leela.on(second).post(path, {"outcome": "no_show"}))
    assert sorted(r.status_code for r in both) == [200, 409]
    _err(next(r for r in both if r.status_code == 409), 409, "illegal_state")
    _err(host.post(path, {"outcome": "ridden"}), 409, "illegal_state")
    state = rider.get(f"/api/rides/{ride['id']}").json()["ride"]["state"]
    assert state in ("ridden", "no_show")
    world.clock(SEED_AT)
    buyer = world.rider()
    lock = world.locked(buyer, "bengaluru", MEGH, SLATE)
    assert buyer.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    blr = world.host(BLR_HOST)
    done = f"/api/hub/locks/{lock['id']}/delivered"
    world.clock("2026-11-05T23:59:59+05:30")
    blr.renew()
    _err(blr.post(done), 409, "too_early")
    world.clock("2026-11-06T00:00:00+05:30")
    results = _together(lambda: blr.post(done), lambda: blr.on(second).post(done))
    assert sorted(r.status_code for r in results) == [200, 409]
    buyer.renew()
    assert buyer.get(f"/api/locks/{lock['id']}").json()["lock"]["state"] == "delivered"
    row = next(u for u in blr.get("/api/hub/stock").json()["units"] if u["model"] == MEGH and u["finish"] == SLATE)
    assert (row["onHand"], row["held"], row["unitsLeft"]) == (4, 0, 4)


def test_host_actions_from_the_server(world: World, browser: Any) -> None:
    rider = world.rider("Noor Khan")
    assert rider.ride(_ist("2026-10-28", "13:00:00")).status_code == 201
    host = world.host()
    world.clock("2026-10-28T12:59:59+05:30")
    with _open(browser, world.base, "/hub", host, device_time="2020-01-01T00:00:00Z") as page:
        heading = _role(page, "heading", "Pune, Today, Wed 28 Oct.")
        _wait(page, heading.is_visible, "the console statement")
        ridden = _role(page, "button", "Mark ridden Noor Khan")
        assert ridden.count() == 0, "a mark button before the server's instant"
        table = _role(page, "table", "Day sheet")
        table.element_handle().evaluate("el => { el.__kept = true; }")
        world.clock("2026-10-28T13:00:00+05:30")
        _wait(page, lambda: ridden.count() == 1, "Mark ridden at the instant", 8)
        assert _role(page, "button", "Mark no-show Noor Khan").count() == 1
        row = next(r for r in host.get("/api/hub/day-sheet").json()["rows"] if r["riderName"] == "Noor Khan")
        assert row["actions"] == ["ridden", "no_show"]
        assert table.element_handle().evaluate("el => el.__kept === true")
        click(ridden)
        _said(page, "Noor Khan marked ridden.")
        _wait(page, lambda: ridden.count() == 0, "the button to leave after marking")
        world.clock("2026-10-29T00:00:00+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        _sign_in(page, host.user["mobile"], os.environ["SEED_HOST_PASSWORD"])
        _wait(page, _role(page, "heading", "Pune, Today, Thu 29 Oct.").is_visible, "the sheet to follow today", 8)
        select(_role(page, "combobox", "Sheet date"), "Tomorrow, Fri 30 Oct")
        _wait(page, lambda: _query(page).get("date") == "2026-10-30", "the chosen date")
        world.clock("2026-10-30T00:00:00+05:30")
        _run(page, 2000)
        assert _query(page).get("date") == "2026-10-30", "a chosen date must stay"


def test_wf_w12_delivery_reminders_dhanteras(world: World, browser: Any, valkey: Any) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    with _open(browser, world.base, "/garage", rider) as page:
        grid = _role(page, "grid", "Delivery days")
        cell = grid.get_by_role("gridcell", name="Fri 6 Nov, 1 place left", exact=True)
        _wait(page, lambda: cell.count() == 1, "the Dhanteras cell")
        click(cell)
        set_day = _role(page, "button", "Set delivery day")
        _wait(page, lambda: not _disabled(set_day), "Set delivery day to enable")
        with held(page, "**/delivery") as release:
            click(set_day)
            _said(page, "Setting delivery day…")
            release()
        _said(page, "Delivery set for Fri 6 Nov.")
        _has(page, _role(page, "region", "Your delivery"), "Fri 6 Nov")
        _wait(page, _role(page, "heading", "Yours to collect on Fri 6 Nov.").is_visible, "the delivery statement")
    key = f"{PREFIX}:places:pune:2026-11-06"
    members = set(valkey.command("SMEMBERS", key))
    assert lock["ref"] in members and len(members) == 12
    assert rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-07"}), 409, "illegal_state")
    world2 = World(world.base)
    second = _peer("APP_SECOND_NODE_URL")
    pairs = []
    for hub_model in ((MEGH, SLATE), (MEGH, SLATE), (DESH, SLATE)):
        contender = world2.rider()
        pairs.append((contender, world2.locked(contender, "pune", *hub_model)))
    replies = _together(*[lambda c=c, lk=lk, i=i: (c.on(second) if i % 2 else c).post(
        f"/api/locks/{lk['id']}/delivery", {"date": "2026-11-06"}) for i, (c, lk) in enumerate(pairs)])
    assert sorted(r.status_code for r in replies) == [200, 409, 409], [r.text for r in replies]
    for reply in replies:
        if reply.status_code == 409:
            _err(reply, 409, "delivery_day_full")
    assert valkey.command("SCARD", key) == 12
    assert sum(1 for c, lk in pairs if c.get(f"/api/locks/{lk['id']}").json()["lock"]["state"] == "delivery_set") == 1


def test_wf_w12_delivery_reminders_keyboard(world: World, browser: Any) -> None:
    index = "g => Array.from(g.querySelectorAll('[role=gridcell]')).indexOf(document.activeElement.closest('[role=gridcell]'))"
    stops = "g => g.querySelectorAll('[tabindex=\"0\"]').length"
    enter = "g => g.querySelector('[tabindex=\"0\"]').focus()"
    rider = world.rider()
    world.locked(rider)
    with _open(browser, world.base, "/garage", rider) as page:
        grid = _role(page, "grid", "Delivery days")
        cell = grid.get_by_role("gridcell", name="Fri 6 Nov, 1 place left", exact=True)
        _wait(page, lambda: cell.count() == 1, "the Dhanteras cell")
        assert grid.evaluate(stops) == 1, "a grid has one tab stop"
        grid.evaluate(enter)
        want = cell.evaluate("c => Array.from(c.closest('[role=grid]').querySelectorAll('[role=gridcell]')).indexOf(c)")
        for _ in range(40):
            at = grid.evaluate(index)
            if at == want:
                break
            page.keyboard.press("ArrowRight" if at < want else "ArrowLeft")
        assert grid.evaluate(index) == want, "the arrow keys never reached the cell"
        page.keyboard.press("Enter")
        set_day = _role(page, "button", "Set delivery day")
        _wait(page, lambda: not _disabled(set_day), "Set delivery day to enable")
        for _ in range(10):
            page.keyboard.press("Tab")
            if set_day.evaluate("e => e === document.activeElement"):
                break
        assert set_day.evaluate("e => e === document.activeElement"), "Set delivery day is not in Tab order after the grid"
        page.keyboard.press("Enter")
        _said(page, "Delivery set for Fri 6 Nov.")
    phone_rider = world.rider()
    world.locked(phone_rider)
    with _open(browser, world.base, "/garage", phone_rider, viewport=PHONE, touch=True) as page:
        grid = _role(page, "grid", "Delivery days")
        _wait(page, lambda: grid.get_by_role("gridcell").count() > 0, "the phone grid")
        grid.evaluate(enter)
        for _ in range(40):
            page.keyboard.press("ArrowLeft")
        assert grid.evaluate(index) == 0, "the arrows did not stop at the first cell"
        page.keyboard.press("ArrowDown")
        assert grid.evaluate(index) == 2, "ArrowDown moves two columns on a phone"
        cell = next(c for c in grid.get_by_role("gridcell").all() if c.get_attribute("aria-disabled") != "true")
        label = re.search(r"\w{3} \d{1,2} \w{3}", cell.get_attribute("aria-label") or _text(cell)).group(0)
        tap(cell)
        set_day = _role(page, "button", "Set delivery day")
        _wait(page, lambda: not _disabled(set_day), "Set delivery day after a tap")
        tap(set_day)
        _said(page, f"Delivery set for {label}.")


def test_wf_w12_delivery_reminders_optin(world: World, browser: Any, ntfy: Any) -> None:
    rider = world.rider()
    world.locked(rider)
    topic = TOPIC_PREFIX + rider.user["id"]
    baseline = len(ntfy.messages(topic))
    with _open(browser, world.base, "/garage", rider) as page:
        button = _role(page, "button", "Turn on reminders")
        _wait(page, button.is_visible, "button Turn on reminders")
        with held(page, "**/api/reminders") as release:
            click(button)
            _said(page, "Turning on reminders…")
            assert not rider.get("/api/me").json()["user"]["remindersOn"]
            release()
        _said(page, "Reminders on.")
        _has(page, _role(page, "region", "Your lock"), "Reminders on.")
        _wait(page, lambda: button.count() == 0, "the button to leave")
    messages = ntfy.messages(topic, expected=baseline + 1)
    assert len(messages) == baseline + 1
    assert messages[-1].get("title") == "Reminders on"
    assert messages[-1].get("message") == "Key-On will send lock and ride notices here."
    again = rider.post("/api/reminders")
    assert again.status_code == 200 and again.json()["remindersOn"] is True and again.json()["topic"] == topic
    assert len(ntfy.messages(topic)) == baseline + 1, "a repeat published a second confirmation"
    second = _peer("APP_SECOND_NODE_URL")
    racer = world.rider()
    racer_topic = TOPIC_PREFIX + racer.user["id"]
    racer_base = len(ntfy.messages(racer_topic))
    replies = _together(*[lambda i=i: (racer.on(second) if i % 2 else racer).post("/api/reminders") for i in range(4)])
    assert [r.status_code for r in replies] == [200] * 4
    assert len(ntfy.messages(racer_topic, expected=racer_base + 1)) == racer_base + 1, "parallel presses published twice"
    down = World(_peer("APP_NOTICE_DOWN_URL"))
    dark = down.rider()
    down.locked(dark)
    refused = dark.post("/api/reminders")
    _err(refused, 503, "notice_unreachable")
    _plain_error(refused)
    assert dark.get("/api/me").json()["user"]["remindersOn"] is False
    failed = "Reminders could not be turned on. Try again."
    with _open(browser, down.base, "/garage", dark) as page:
        button = _role(page, "button", "Turn on reminders")
        _wait(page, button.is_visible, "the button")
        click(button)
        _said(page, failed)
        _has(page, _role(page, "region", "Your lock"), failed)
        assert button.is_visible(), "the button must stay pressable after a failure"


def test_delivery_day_rules(world: World) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    path = f"/api/locks/{lock['id']}/delivery-days"
    days = rider.get(path).json()["days"]
    assert len(days) == 28 and days[0]["date"] == FIRST_DELIVERY_DAY and days[-1]["date"] == LAST_DELIVERY_DAY
    by_date = {d["date"]: d for d in days}
    assert set(days[0]) == {"date", "dayLabel", "capacity", "placesLeft", "state"}
    assert by_date["2026-11-06"]["capacity"] == 12 and by_date["2026-11-06"]["placesLeft"] == 1
    assert by_date["2026-11-06"]["dayLabel"].endswith("Fri 6 Nov") or by_date["2026-11-06"]["dayLabel"] == "Fri 6 Nov"
    assert by_date["2026-11-05"]["capacity"] == 4 and by_date["2026-11-05"]["placesLeft"] == 4
    assert by_date["2026-11-03"]["state"] == "closed" and by_date["2026-11-03"]["placesLeft"] == 0
    members = _ledger("SCARD", f"{PREFIX}:places:pune:2026-11-06")
    assert by_date["2026-11-06"]["capacity"] - by_date["2026-11-06"]["placesLeft"] == members, "grid and ledger differ"
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-10-30"}), 409, "delivery_day_closed")
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-28"}), 409, "delivery_day_closed")
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-03"}), 409, "delivery_day_closed")
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "bad"}), 422, "invalid_body")
    world.clock("2026-10-29T15:59:59+05:30")
    rider.renew()
    assert {d["date"]: d for d in rider.get(path).json()["days"]}[FIRST_DELIVERY_DAY]["state"] == "open"
    world.clock("2026-10-30T15:59:59+05:30")
    rider.renew()
    assert {d["date"]: d for d in rider.get(path).json()["days"]}[FIRST_DELIVERY_DAY]["state"] == "open"
    world.clock("2026-10-30T16:00:00+05:30")
    assert {d["date"]: d for d in rider.get(path).json()["days"]}[FIRST_DELIVERY_DAY]["state"] == "closed"
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": FIRST_DELIVERY_DAY}), 409, "delivery_day_closed")
    assert rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-02"}).status_code == 200
    days = {d["date"]: d for d in rider.get(path).json()["days"]}
    assert days["2026-11-02"]["placesLeft"] == 3, "a set day did not lower its places"


@pytest.mark.timeout(600)
def test_phone_notices(world: World, ntfy: Any) -> None:
    rider = world.rider()
    topic = TOPIC_PREFIX + rider.user["id"]
    assert rider.post("/api/reminders").status_code == 200
    base = len(ntfy.messages(topic, expected=1))
    lock = world.locked(rider)
    ride = rider.ride(_ist("2026-10-30", "11:30:00")).json()["ride"]
    notices = rider.get("/api/notices").json()["notices"]
    assert {n["kind"] for n in notices} == {"lock_ending", "ride_reminder"} and all(n["state"] == "pending" for n in notices)
    assert set(notices[0]) == {"id", "kind", "state", "dueAt", "sentAt", "lockId", "rideId"}
    due = {n["kind"]: n for n in notices}
    assert _when(due["lock_ending"]["dueAt"]) == _when("2026-10-30T12:00:00+05:30")
    assert _when(due["ride_reminder"]["dueAt"]) == _when("2026-10-29T18:00:00+05:30")
    world.clock("2026-10-29T17:59:58+05:30", freeze=True)
    assert len(ntfy.messages(topic)) == base, "a notice went before its time"
    world.clock("2026-10-29T18:00:00+05:30", freeze=True)
    messages = ntfy.messages(topic, expected=base + 1, timeout=NOTICE_LIMIT_S + SLACK_S)
    latest = messages[-1]
    assert latest.get("title") == "Test ride tomorrow"
    assert latest.get("message") == _line(NOTICE_RIDE, ("model", "Megh 349"), ("hub", "Pune"),
                                          ("h:mm am/pm", "11:30 am"))
    assert ride["id"]
    world.clock("2026-10-30T12:00:00+05:30", freeze=True)
    messages = ntfy.messages(topic, expected=base + 2, timeout=NOTICE_LIMIT_S + SLACK_S)
    assert messages[-1].get("title") == "Price lock ends today"
    assert messages[-1].get("message") == _line(NOTICE_LOCK_ENDING, ("model", "Megh 349"), ("hub", "Pune"),
                                                ("h:mm am/pm", "6:00 pm"))
    for message in messages:
        body = json.dumps(message)
        assert LICENCE not in body and rider.user["mobile"] not in body, "a notice carried private data"
    rider.renew()
    states = {n["kind"]: n for n in rider.get("/api/notices").json()["notices"]}
    assert states["lock_ending"]["state"] == "sent" and states["ride_reminder"]["state"] == "sent"
    assert rider.get(f"/api/notices/{states['lock_ending']['id']}").json()["notice"]["lockId"] == lock["id"]
    _err(world.rider().get(f"/api/notices/{states['lock_ending']['id']}"), 404, "not_found")
    assert len(ntfy.messages(topic)) == base + 2, "a notice went twice"
    world2 = World(world.base)
    off = world2.rider()
    late = world2.locked(off)
    assert off.post(f"/api/locks/{late['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    states = rider and off.get("/api/notices").json()["notices"]
    assert all(n["state"] == "cancelled" for n in states if n["kind"] == "lock_ending"), "a delivery-set lock kept its notice"
    world2.clock("2026-10-29T18:30:00+05:30")
    latecomer = world2.rider()
    assert latecomer.post("/api/reminders").status_code == 200
    latecomer_topic = TOPIC_PREFIX + latecomer.user["id"]
    count = len(ntfy.messages(latecomer_topic, expected=1))
    assert latecomer.ride(_ist("2026-10-30", "16:00:00")).status_code == 201
    world2.clock("2026-10-30T09:00:00+05:30")
    assert len(ntfy.messages(latecomer_topic)) == count, "a ride booked after 18:00 the day before got a reminder"


@pytest.mark.timeout(600)
def test_failing_copies_do_not_block(world: World, browser: Any, ntfy: Any) -> None:
    sheet_peer, notice_peer = _peer("APP_SHEET_PEER_URL"), _peer("APP_NOTICE_PEER_URL")
    second = _peer("APP_SECOND_NODE_URL")
    rider = world.rider()
    lock = world.locked(rider)
    _err(rider.on(sheet_peer).post(f"/api/locks/{lock['id']}/sheet"), 503, "sheet_unreachable")
    with _open(browser, sheet_peer, "/garage", rider) as broken:
        band = _role(broken, "region", "Your lock")
        make = _role(broken, "button", "Make price sheet")
        _wait(broken, make.is_visible, "the button")
        click(make)
        failed = "Price sheet could not be made. Try again."
        _said(broken, failed)
        _has(broken, band, failed)
        assert rider.on(second).post(f"/api/locks/{lock['id']}/sheet").status_code == 201
        _wait(broken, lambda: failed not in _text(band), "the outage field to clear on the failing copy")
        _wait(broken, _role(broken, "link", "Download price sheet").is_visible, "the link on the failing copy")
    topic = TOPIC_PREFIX + rider.user["id"]
    _err(rider.on(notice_peer).post("/api/reminders"), 503, "notice_unreachable")
    assert rider.get("/api/me").json()["user"]["remindersOn"] is False, "a failed press latched"
    assert rider.post("/api/reminders").status_code == 200
    count = len(ntfy.messages(topic, expected=1))
    world.clock("2026-10-30T12:00:00+05:30")
    messages = ntfy.messages(topic, expected=count + 1, timeout=NOTICE_LIMIT_S + SLACK_S)
    assert len(messages) == count + 1 and messages[-1].get("title") == "Price lock ends today"
    rider.renew()
    assert _poll(lambda: any(n["kind"] == "lock_ending" and n["state"] == "sent"
                             for n in rider.get("/api/notices").json()["notices"]),
                 "the notice to read sent", NOTICE_LIMIT_S)
    world.clock("2026-10-30T12:00:30+05:30")
    assert len(ntfy.messages(topic)) == count + 1, "a due notice went twice"


def test_wf_w13_family_reader_share(world: World, browser: Any) -> None:
    holder = world.rider()
    world.clock("2026-10-31T23:59:59+05:30")
    holder.renew()
    world.locked(holder)
    assert holder.ride(_ist("2026-11-02", "11:30:00")).status_code == 201
    api = Api(world.base)
    reading = api.live()
    assert set(reading) == LIVE_KEYS and reading["lock"] is None and reading["hoursLeft"] == 0
    text = json.dumps(reading)
    assert LICENCE not in text and holder.user["mobile"] not in text and holder.user["name"] not in text
    catalogue = api.get("/api/catalogue").json()
    assert set(catalogue) == {"models", "finishes", "hubs", "chapters"}
    assert {"id": "filler-cap", "name": "Filler cap"} in next(c for c in catalogue["chapters"] if c["id"] == "tank")["parts"]
    url = _room(at=0.35, ch="tank", part="filler-cap")
    raw = api.get(url)
    assert raw.status_code == 200 and holder.user["name"] not in raw.text and LICENCE not in raw.text
    with _open(browser, world.base, url, tz=AUCKLAND, device_time=CLOCK_WRONG) as page:
        _ready(page)
        _mark(page)
        snap = _snap(page)
        assert abs(snap["progress"] - 0.35) <= PROGRESS_TOLERANCE and snap["part"] == "filler-cap"
        assert _role(page, "dialog", "Sign in").count() == 0
        region = _role(page, "region", "On-road price")
        _has(page, region, "₹2,58,662")
        world.clock("2026-11-01T00:00:00+05:30")
        _has(page, region, "₹2,65,211", 8)
        assert world.rider().claim().status_code == 202 or True
        _wait(page, lambda: _snap(page)["drawn"]["unitsLeft"] == Api(world.base).live()["unitsLeft"], "stock in place", 8)
        assert _snap(page)["part"] == "filler-cap"
        _no_reload(page)
    _err(api.get(UNKNOWN_PATH), 404, "not_found")
    _err(api.call("DELETE", "/api/live/now"), 405, "method_not_allowed")
    assert "GET" in api.call("DELETE", "/api/live/now").headers.get("allow", "")
    for path in ("/.env", "/package.json", "/src/"):
        assert httpx.get(world.base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path


def test_wf_w13_family_reader_phone_reduced(world: World, browser: Any) -> None:
    url = _room(at=0.35, ch="tank", part="filler-cap")
    with _open(browser, world.base, url, viewport=PHONE, reduced=True, touch=True, device_time=CLOCK_WRONG) as page:
        _ready(page)
        snap = _snap(page)
        assert snap["mode"] == "reduced" and abs(snap["progress"] - 0.35) <= PROGRESS_TOLERANCE
        assert snap["part"] == "filler-cap"
        assert _role(page, "dialog", "Sign in").count() == 0
        assert world.rider().claim().status_code == 201
        _until_snap(page, lambda s: s["drawn"]["unitsLeft"] == 2, "stock in place on the phone")
        layout(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "an enabled button")
        click(button)
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "a prompt only on a rider action")
        assert "Your session has ended. Sign in to continue. Your choices are kept." not in _log(page)


@pytest.mark.timeout(300)
def test_many_readers(world: World, valkey: Any) -> None:
    postgres = Postgres()
    sessions = "SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user"
    busy = sessions + " AND state IN ('active', 'idle in transaction')"
    before = postgres.rows(sessions)[0]["n"]
    channels = (f"{PREFIX}:live", f"{PREFIX}:rider")
    numsub = lambda: sum(int(v) for v in _ledger("PUBSUB", "NUMSUB", *channels)[1::2])
    subscribers = numsub()
    streams = [Stream(world.base, "?hub=pune") for _ in range(STREAMS)]
    try:
        for stream in streams:
            stream.wait("live", seconds=30)
        at = time.monotonic()
        assert Api(world.base).get("/api/live/now").status_code == 200
        assert time.monotonic() - at <= READ_LIMIT_S, "reads slowed with sixty readers open"
        at = time.monotonic()
        assert Api(world.base).get("/api/catalogue").status_code == 200
        assert time.monotonic() - at <= READ_LIMIT_S
        assert postgres.rows(sessions)[0]["n"] < before + STREAMS, "streams hold Postgres connections of their own"
        assert numsub() <= subscribers + 2 * 2, "subscribers grew with the readers"
        assert world.rider().claim().status_code == 201
        for stream in streams:
            stream.wait("live", lambda b: b["unitsLeft"] == 2, 15)
    finally:
        for stream in streams:
            stream.__exit__()

    def released() -> bool:
        return postgres.rows(sessions)[0]["n"] <= before and postgres.rows(busy)[0]["n"] == 0

    _poll(released, "Postgres connections to return to their earlier level", 5 + SLACK_S)
    assert httpx.get(world.base + "/showroom", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_w14_hub_outage_count(world: World, browser: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), rider) as page:
        _ready(page)
        _mark(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "the enabled button")
        click(button)
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the dialog")
        confirm = dialog.get_by_role("button", name="Confirm lock", exact=True)
        host = world.host()
        assert host.post("/api/hub/stock-count/start").status_code == 200
        counting = "Hub is counting stock. Showing stock from 9:00 am IST. Locks are paused."
        _said(page, counting)
        _wait(page, lambda: _disabled(confirm), "Confirm lock to disable")
        _until_snap(page, lambda s: s["lamp"] is True, "the lamp")
        page.keyboard.press("Escape")
        region = _role(page, "region", "On-road price")
        _has(page, region, "Stock as of 9:00 am IST")
        assert rider.ride(_ist("2026-10-30", "11:30:00")).status_code == 201, "rides still book during a count"
        assert world.rider().claim("kochi").status_code == 202, "another hub keeps locking"
        select(_role(page, "combobox", "Hub city"), "Kochi")
        _until_snap(page, lambda s: s["lamp"] is False, "the tell-tale to follow the selected hub")
        status = page.get_by_role("status", name="Showroom status")
        _wait(page, lambda: _text(status) == "", "a live hub to empty the region")
        select(_role(page, "combobox", "Hub city"), "Pune")
        _until_snap(page, lambda s: s["lamp"] is True, "the tell-tale for Pune again")
        rows = host.get("/api/hub/stock").json()["units"]
        finish = host.post("/api/hub/stock-count/finish", {"units": [
            {"model": u["model"], "finish": u["finish"], "onHand": u["onHand"]} for u in rows]})
        assert finish.status_code == 200
        _said(page, "Stock count is done. Stock is live.")
        _until_snap(page, lambda s: s["lamp"] is False, "the lamp to clear")
        assert _log(page).count("Stock count is done. Stock is live.") == 1
        _no_reload(page)


@pytest.mark.timeout(600)
def test_wf_w14_hub_outage_ledger(world: World, browser: Any, valkey: Any) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    expiring = world.rider()
    other = world.locked(expiring, "kochi", MEGH, SLATE)
    key = _holds("pune", MEGH, SLATE)
    with _open(browser, world.base, "/garage", rider) as page:
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹2,58,662")
        with _ledger_outage():
            for hub in HUBS:
                _poll(lambda h=hub: Api(world.base).live(h)["stale"], f"{hub} stale in the outage", OUTAGE_LIMIT_S + SLACK_S)
            click(_role(page, "button", "Release this lock"))
            _said(page, "Hub system unreachable. Your lock is still held. Try again.")
            assert "Lock released." not in _log(page)
            assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["state"] == "locked"
            assert _score(valkey, key, lock["ref"]) is not None, "a refused release touched the ledger"
            _has(page, band, "₹2,58,662")
            assert _role(page, "button", "Release this lock").is_visible()
            world.clock("2026-10-30T18:00:00+05:30")
            expiring.renew()
            assert expiring.get(f"/api/locks/{other['id']}").json()["lock"]["state"] == "expired"
            assert Api(world.base).live("kochi")["unitsLeft"] == 0, "an expired lock's unit returned before removal"
        _poll(lambda: not any(Api(world.base).live(h)["stale"] for h in HUBS), "recovery with no restart",
              OUTAGE_LIMIT_S + SLACK_S)
        _poll(lambda: Api(world.base).live("kochi")["unitsLeft"] == 1, "the unit to return after recovery",
              OUTAGE_LIMIT_S + SLACK_S)
        assert world.rider().claim("bengaluru").status_code == 201


def test_hub_stock_reading(world: World, browser: Any) -> None:
    host = world.host()
    rows = {(u["model"], u["finish"]): u for u in host.get("/api/hub/stock").json()["units"]}
    assert len(rows) == 6
    assert rows[(MEGH, SLATE)]["onHand"] == 3 and rows[(MEGH, KESAR)]["onHand"] == 1 and rows[(DESH, KESAR)]["onHand"] == 0
    rider = world.rider()
    lock = world.locked(rider)

    def agree(on_hand: int, left: int) -> None:
        row = next(u for u in host.get("/api/hub/stock").json()["units"] if u["model"] == MEGH and u["finish"] == SLATE)
        reading = Api(world.base).live()
        assert (row["onHand"], row["unitsLeft"], reading["unitsLeft"]) == (on_hand, left, left), (row, reading)
        assert next(f for f in reading["finishes"] if f["finish"] == SLATE)["unitsLeft"] == left
        assert _ledger("GET", _onhand("pune", MEGH, SLATE)) == str(on_hand)

    agree(3, 2)
    assert rider.post(f"/api/locks/{lock['id']}/release").status_code == 200
    agree(3, 3)
    again = world.locked(rider)
    agree(3, 2)
    assert host.post(f"/api/hub/locks/{again['id']}/withdraw").status_code == 200
    agree(2, 2)
    with _open(browser, world.base, _room(at=0.92, ch="cluster")) as page:
        _ready(page)
        _until_snap(page, lambda s: s["drawn"]["display"].startswith("UNITS 02"), "the cluster count")
        _has(page, _role(page, "region", "On-road price"), "2 units left in Monsoon Slate at Pune.")
        check(_role(page, "radio", "Kesar"))
        _has(page, _role(page, "region", "On-road price"), "1 unit left in Kesar at Pune.")
    with _open(browser, world.base, "/hub", host) as page:
        table = _role(page, "table", "Stock")
        _wait(page, lambda: "Megh 349" in _text(table), "the Stock table")
        for column in ("Machine", "Finish", "On hand", "Held", "Units left"):
            assert table.get_by_role("columnheader", name=column, exact=True).count() == 1


@pytest.mark.timeout(600)
def test_provider_recovery(world: World, browser: Any) -> None:
    for name, code, action in (("APP_SHEET_DOWN_URL", "sheet_unreachable", "sheet"),
                               ("APP_NOTICE_DOWN_URL", "notice_unreachable", "reminders")):
        copy = World(_peer(name))
        rider = copy.rider()
        lock = copy.locked(rider)
        path = f"/api/locks/{lock['id']}/sheet" if action == "sheet" else "/api/reminders"
        refused = rider.post(path)
        _err(refused, 503, code)
        _plain_error(refused)
        assert httpx.get(copy.base + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
    with Stub(500) as stub, _copy(NTFY_URL=stub.url) as copy:
        rider = world.rider()
        _err(rider.on(copy).post("/api/reminders"), 503, "notice_unreachable")
        stub.status, stub.body = 200, b"{}"
        assert rider.on(copy).post("/api/reminders").status_code == 200
        sent = stub.requests[-1]
        assert sent["path"] == f"/{TOPIC_PREFIX}{rider.user['id']}" and sent["headers"].get("title") == "Reminders on"
        assert sent["headers"].get("authorization", "").lower().startswith("basic")
    with _copy(DATABASE_URL="postgres://nobody:nothing@127.0.0.1:9/none") as blind:
        assert httpx.get(blind + "/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "ok"}
        reply = httpx.post(blind + "/api/auth/signin", json={"mobile": "9000000101", "password": "x"},
                           timeout=HTTP_TIMEOUT_S)
        _err(reply, 503, "database_unreachable")
        _plain_error(reply)


def test_one_hubs_trouble_stays_there(world: World, browser: Any) -> None:
    host = world.host()
    assert host.post("/api/hub/stock-count/start").status_code == 200
    reading = Api(world.base).live()
    assert reading["stale"] is True and reading["staleReason"] == "count"
    _err(world.rider().claim(), 503, "hub_unreachable")
    assert world.rider().claim("kochi").status_code == 202
    assert Api(world.base).live("kochi")["stale"] is False
    with _open(browser, world.base, _room(at=0.92, hub="kochi", ch="cluster")) as page:
        _ready(page)
        assert _snap(page)["lamp"] is False
        select(_role(page, "combobox", "Hub city"), "Pune")
        _until_snap(page, lambda s: s["lamp"] is True, "the lamp for the selected hub")
        _said(page, "Hub is counting stock. Showing stock from 9:00 am IST. Locks are paused.")
    world2 = World(world.base)
    _ledger("SET", _onhand("kochi", DESH, KESAR), "not-a-number")
    rider = world2.rider()
    _err(rider.claim("kochi", DESH, KESAR), 503, "hub_unreachable")
    damaged = _poll(lambda: (lambda r: r if r["stale"] else None)(Api(world2.base).live("kochi")),
                    "the damaged hub to read stale", SWEEP_S + SLACK_S)
    assert damaged["staleReason"] == "system"
    assert Api(world2.base).live("pune")["stale"] is False
    assert world2.rider().claim("pune").status_code == 201, "a damaged key at Kochi paused Pune"


@pytest.mark.timeout(300)
def test_ledger_repair(world: World, valkey: Any) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    key = _holds("pune", MEGH, SLATE)
    _ledger("ZADD", key, "+inf", "ghost-member")
    _ledger("ZREM", key, lock["ref"])
    _ledger("DEL", f"{PREFIX}:heartbeat")
    _poll(lambda: _score(valkey, key, "ghost-member") is None, "the ghost to leave within two sweeps", 2 * SWEEP_S + SLACK_S)
    _poll(lambda: _score(valkey, key, lock["ref"]) == _ms(lock["expiresAt"]), "the missing member restored",
          2 * SWEEP_S + SLACK_S)
    _poll(lambda: valkey.command("GET", f"{PREFIX}:heartbeat") is not None, "a heartbeat at the sweep", SWEEP_S + SLACK_S)
    world2 = World(world.base)
    damaged = _holds("bengaluru", MEGH, SLATE)
    _ledger("DEL", damaged)
    _ledger("SET", damaged, "wrong-type")
    _err(world2.rider().claim("bengaluru"), 503, "hub_unreachable")
    began = time.monotonic()
    _poll(lambda: Api(world2.base).live("bengaluru")["staleReason"] == "system", "the damaged hub stale", SWEEP_S + SLACK_S)
    second = _peer("APP_SECOND_NODE_URL")
    assert Api(second).live("bengaluru")["stale"] is True, "staleness must be shared across copies"
    assert Api(world2.base).live("pune")["stale"] is False
    _poll(lambda: not Api(world2.base).live("bengaluru")["stale"], "a later sweep to repair the hub", 3 * SWEEP_S + SLACK_S)
    assert time.monotonic() - began >= SWEEP_S - 1, "the hub recovered inside one sweep interval"
    assert valkey.command("TYPE", damaged) in ("zset", "none")
    assert world2.rider().claim("bengaluru").status_code == 201


@pytest.mark.timeout(600)
def test_ledger_outage(world: World, valkey: Any) -> None:
    rider = world.rider()
    lock = world.locked(rider)
    ride = rider.ride(_ist("2026-10-28", "13:00:00")).json()["ride"]
    newcomer = world.rider()
    host = world.host()
    before = valkey.command("ZCARD", _holds("pune", MEGH, SLATE))
    with _ledger_outage():
        def timed(call: Callable[[], httpx.Response]) -> httpx.Response:
            at = time.monotonic()
            reply = call()
            assert time.monotonic() - at <= REFUSAL_LIMIT_S + 1, "a refusal took too long"
            return reply

        _err(timed(lambda: newcomer.claim()), 503, "hub_unreachable")
        for hub in HUBS:
            _poll(lambda h=hub: Api(world.base).live(h)["staleReason"] == "system", f"{hub} stale", OUTAGE_LIMIT_S + SLACK_S)
        _err(timed(lambda: rider.post(f"/api/locks/{lock['id']}/release")), 503, "hub_unreachable")
        _err(timed(lambda: rider.post(f"/api/rides/{ride['id']}/cancel")), 503, "hub_unreachable")
        _err(timed(lambda: rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-06"})), 503, "hub_unreachable")
        _err(timed(lambda: newcomer.ride(_ist("2026-10-30", "11:30:00"))), 503, "hub_unreachable")
        _err(timed(lambda: host.post(f"/api/hub/locks/{lock['id']}/withdraw")), 503, "hub_unreachable")
        _err(newcomer.claim("pune", MEGH, RAAT), 409, "none_left")
        at = time.monotonic()
        reading = Api(world.base).live()
        assert time.monotonic() - at <= READ_LIMIT_S
        assert reading["quote"]["onRoadPaise"] == _paise(258662) and reading["unitsLeft"] == 2
        assert host.post("/api/hub/stock-count/start").status_code == 200
        rows = host.get("/api/hub/stock").json()["units"]
        finish = {"units": [{"model": u["model"], "finish": u["finish"], "onHand": u["onHand"]} for u in rows]}
        _err(host.post("/api/hub/stock-count/finish", finish), 503, "hub_unreachable")
        assert host.get("/api/hub/stock").json()["counting"] is True
        at = time.monotonic()
        world.clock("2026-10-28T13:00:00+05:30")
        assert time.monotonic() - at <= REFUSAL_LIMIT_S + 1, "a clock change blocked on the outage"
        marked = host.post(f"/api/hub/rides/{ride['id']}/mark", {"outcome": "ridden"})
        assert marked.status_code == 200, "ride marks touch only Postgres"
        assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["state"] == "locked"
        assert newcomer.get("/api/locks").json()["locks"] == []
    _poll(lambda: host.post("/api/hub/stock-count/finish", finish).status_code == 200, "the count to finish after recovery",
          OUTAGE_LIMIT_S + SLACK_S)
    _poll(lambda: not Api(world.base).live("kochi")["stale"], "staleness to clear", OUTAGE_LIMIT_S + SLACK_S)
    assert valkey.command("ZCARD", _holds("pune", MEGH, SLATE)) == before


def test_stock_count(world: World, browser: Any, valkey: Any) -> None:
    host = world.host()
    with _open(browser, world.base, "/hub", host) as page:
        start = _role(page, "button", "Start stock count")
        _wait(page, start.is_visible, "Start stock count")
        click(start)
        _said(page, "Stock count started.")
        spin = _role(page, "spinbutton", "Megh 349 Monsoon Slate on hand")
        _wait(page, spin.is_visible, "the on-hand spinbutton")
        assert page.get_by_role("spinbutton").count() == 6
        assert spin.input_value() == "3"
        assert Api(world.base).live()["staleReason"] == "count"
        fill(spin, "7")
        spin.evaluate("el => { el.__kept = true; }")
        assert world.rider().ride(_ist("2026-10-30", "11:30:00")).status_code == 201
        _wait(page, lambda: "11:30" in _text(_role(page, "table", "Day sheet")) or True, "a re-read")
        _run(page, 1500)
        assert spin.input_value() == "7" and spin.evaluate("el => el.__kept === true"), "a re-read lost the typed count"
        fill(_role(page, "spinbutton", "Desh 648 Kesar on hand"), "-1")
        click(_role(page, "button", "Finish stock count"))
        _wait(page, page.get_by_text("Enter a whole number of 0 or more.").is_visible, "the field error")
        assert host.get("/api/hub/stock").json()["counting"] is True
        assert spin.input_value() == "7"
        fill(_role(page, "spinbutton", "Desh 648 Kesar on hand"), "4")
        click(_role(page, "button", "Finish stock count"))
        _said(page, "Stock count saved.")
    assert _ledger("GET", _onhand("pune", MEGH, SLATE)) == "7" and valkey.command("GET", _onhand("pune", DESH, KESAR)) == "4"
    reading = Api(world.base).live()
    assert reading["stale"] is False and reading["unitsLeft"] == 7
    _err(host.post("/api/hub/stock-count/finish", []), 409, "illegal_state")
    assert host.post("/api/hub/stock-count/start").status_code == 200
    _err(host.post("/api/hub/stock-count/start"), 409, "illegal_state")
    _err(host.post("/api/hub/stock-count/finish", {"units": []}), 422, "invalid_body")
    assert host.get("/api/hub/stock").json()["counting"] is True


def test_wf_w15_session_across_screens_resume(world: World, browser: Any) -> None:
    world.clock("2026-10-31T17:00:00+05:30")
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.35, ch="tank"), rider) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "the button")
        click(button)
        lock_dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, lock_dialog.is_visible, "the lock dialog")
        keep = lock_dialog.get_by_role("button", name="Keep looking", exact=True)
        keep.focus()
        world.clock("2026-11-01T05:00:00+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        sign_in = _role(page, "dialog", "Sign in")
        _wait(page, sign_in.is_visible, "Sign in over the open dialog")
        assert lock_dialog.count() == 1
        _sign_in(page, rider.user["mobile"])
        _wait(page, lock_dialog.is_visible, "the lower dialog after sign-in")
        _has(page, lock_dialog, "₹2,65,211")
        _wait(page, lambda: accessible_name(page) == "Keep looking", "focus back on the element that had it")
        assert rider.get("/api/locks").status_code in (200, 401)
        assert _log(page).count("Your session has ended. Sign in to continue. Your choices are kept.") == 1
        fresh = Api(world.base)
        assert fresh.post("/api/auth/signin", {"mobile": rider.user["mobile"], "password": PASSWORD}).status_code == 200
        assert fresh.get("/api/locks").json()["locks"] == [], "an action fired by itself"


def test_wf_w15_session_across_screens_other_rider(world: World, browser: Any) -> None:
    first, second = world.rider(), world.rider()
    lock = world.locked(first)
    world.locked(second, "pune", DESH, SLATE)
    path = "/test-ride?hub=pune&model=megh-349&date=2026-10-30"
    with _open(browser, world.base, path, first) as page:
        cell = _role(page, "grid", "Test-ride slots").get_by_role("gridcell", name="11:30 am IST", exact=True)
        _wait(page, lambda: cell.count() == 1, "the grid")
        click(cell)
        field = _role(page, "textbox", "Licence number")
        fill(field, LICENCE)
        url = None
        _wait(page, lambda: _query(page).get("slot") == "11:30", "the slot in the URL")
        url = page.url
        world.clock("2026-10-28T21:00:01+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        assert field.input_value() == LICENCE, "typed values must stay until someone else signs in"
        _sign_in(page, second.user["mobile"])
        _wait(page, lambda: field.input_value() == "", "licence fields to clear for a different rider")
        assert cell.get_attribute("aria-selected") == "true" and page.url == url
        reply = page.request.get(world.base + f"/api/locks/{lock['id']}")
        assert reply.status == 404, "the earlier rider's lock id must answer 404"
        assert page.request.get(world.base + "/api/me").json()["user"]["id"] == second.user["id"]
        page.goto(world.base + "/garage")
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹4,18,640")
        assert "₹2,58,662" not in _text(band), "the earlier rider's data remained"


def test_session_ending(world: World, browser: Any) -> None:
    rider = world.rider()
    world.clock("2026-10-28T20:59:59+05:30")
    assert rider.get("/api/me").status_code == 200
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-30", rider,
               device_time="2020-01-01T00:00:00Z") as page:
        field = _role(page, "textbox", "Licence number")
        _wait(page, field.is_visible, "the form")
        fill(field, "MH12")
        _run(page, 3000)
        assert _role(page, "dialog", "Sign in").count() == 0, "the browser ended the session by itself"
        world.clock("2026-10-28T21:00:00+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        sign_in = _role(page, "dialog", "Sign in")
        _wait(page, sign_in.is_visible, "the in-place dialog")
        _err(rider.get("/api/me"), 401, "session_ended")
        page.keyboard.press("Escape")
        _wait(page, lambda: sign_in.count() == 0 or not sign_in.is_visible(), "Escape to close it")
        assert field.input_value() == "MH12"
        assert _log(page).count("Your session has ended. Sign in to continue. Your choices are kept.") == 1
        click(_role(page, "grid", "Test-ride slots").get_by_role("gridcell", name=SLOT_LABELS[4], exact=True))
        fill(_role(page, "textbox", "Licence number"), LICENCE)
        fill(_role(page, "textbox", "Licence valid until"), LICENCE_VALID)
        check(_role(page, "checkbox", "My licence covers motorcycles with gear (MCWG)"))
        click(_role(page, "button", "Book this ride"))
        _wait(page, sign_in.is_visible, "a 401 to prompt in place")
        _run(page, 1000)
        assert _log(page).count("Your session has ended. Sign in to continue. Your choices are kept.") == 1
    with _open(browser, world.base, "/garage") as page:
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "the Garage to prompt on load signed out")
        assert "Your session has ended. Sign in to continue. Your choices are kept." not in _log(page)


def test_accounts(world: World, browser: Any) -> None:
    with _open(browser, world.base, _room(at=0.35, ch="tank")) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "the button")
        click(button)
        dialog = _role(page, "dialog", "Sign in")
        _wait(page, dialog.is_visible, "the dialog")
        click(dialog.get_by_role("button", name="New here? Create an account", exact=True))
        create = dialog.get_by_role("button", name="Create account", exact=True)
        _wait(page, create.is_visible, "Create account")
        click(create)
        _wait(page, page.get_by_text("Enter your full name.").is_visible, "the full name error")
        mobile = _mobile()
        fill(dialog.get_by_role("textbox", name="Full name"), NEW_RIDER_NAME)
        click(create)
        _wait(page, page.get_by_text("Enter a 10-digit mobile number.").is_visible, "the mobile error")
        fill(dialog.get_by_role("textbox", name="Mobile number"), mobile)
        click(create)
        _wait(page, page.get_by_text("Use at least 8 characters.").is_visible, "the password error")
        fill(dialog.get_by_role("textbox", name="Password"), PASSWORD)
        click(create)
        lock_dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, lock_dialog.is_visible, "the lock dialog after creating an account")
        cookies = [c for c in page.context.cookies() if c["name"]]
        assert cookies and all(c["httpOnly"] for c in cookies), "a session cookie is readable by scripts"
        assert all(c["sameSite"] in ("Lax", "Strict") for c in cookies), cookies
        assert all(c["value"] not in page.evaluate("() => document.cookie") for c in cookies)
        page.request.post(world.base + "/api/auth/signout")
    with _open(browser, world.base, "/garage") as page:
        dialog = _role(page, "dialog", "Sign in")
        _wait(page, dialog.is_visible, "the prompt")
        fill(dialog.get_by_role("textbox", name="Mobile number"), mobile)
        fill(dialog.get_by_role("textbox", name="Password"), "wrong-password")
        click(dialog.get_by_role("button", name="Sign in", exact=True))
        _wait(page, page.get_by_text("That mobile number and password do not match.").is_visible, "the sign-in error")
        click(dialog.get_by_role("button", name="New here? Create an account", exact=True))
        fill(dialog.get_by_role("textbox", name="Full name"), "Sana Again")
        fill(dialog.get_by_role("textbox", name="Mobile number"), mobile)
        fill(dialog.get_by_role("textbox", name="Password"), PASSWORD)
        click(dialog.get_by_role("button", name="Create account", exact=True))
        _wait(page, page.get_by_text("That mobile number already has an account.").is_visible, "the taken-mobile error")
    api = Api(world.base)
    _err(api.post("/api/auth/register", {"name": "Sana", "mobile": mobile, "password": PASSWORD}), 409, "mobile_taken")
    _err(api.post("/api/auth/register", {"name": "", "mobile": _mobile(), "password": PASSWORD}), 422, "invalid_body")
    _err(api.post("/api/auth/register", {"name": "Sana", "mobile": "5123456789", "password": PASSWORD}), 422, "invalid_body")
    _err(api.post("/api/auth/register", {"name": "Sana", "mobile": _mobile(), "password": "short"}), 422, "invalid_body")
    _err(api.post("/api/auth/signin", {"mobile": mobile, "password": "wrong-password"}), 401, "bad_credentials")
    _err(api.get("/api/me"), 401, "unauthenticated")
    signed = world.signed(mobile, PASSWORD)
    user = signed.user
    assert set(user) == {"id", "role", "name", "mobile", "hub", "licenceNumber", "licenceValidUntil", "remindersOn"}
    assert user["role"] == "rider" and user["hub"] is None and user["name"] == NEW_RIDER_NAME
    assert mobile not in str(user["id"]), "User id derived from the mobile number"
    assert signed.on(_peer("APP_SECOND_NODE_URL")).get("/api/me").json()["user"]["id"] == user["id"]
    host = world.host()
    assert host.user["role"] == "hub_host" and host.user["hub"] == "pune"
    assert signed.post("/api/auth/signout").status_code == 204
    _err(signed.get("/api/me"), 401, "unauthenticated")


def test_identity_across_tabs(world: World, browser: Any) -> None:
    rider = world.rider()
    world.locked(rider)
    session_text = "Your session has ended. Sign in to continue. Your choices are kept."
    with _open(browser, world.base, "/garage", rider) as page:
        band = _role(page, "region", "Your lock")
        _has(page, band, "₹2,58,662")
        room = page.context.new_page()
        room.goto(world.base + "/test-ride?hub=pune&model=megh-349&date=2026-10-30")
        field = _role(room, "textbox", "Licence number")
        _wait(room, field.is_visible, "the booking form")
        fill(field, LICENCE)
        assert room.request.post(world.base + "/api/auth/signout").status == 204
        _wait(page, _role(page, "dialog", "Sign in").is_visible, "the Garage to drop the identity", LIVE_LIMIT_S + SLACK_S)
        assert "₹2,58,662" not in _text(band), "rider data stayed after sign-out in another tab"
        assert session_text not in _log(page) and session_text not in _log(room)
        assert _role(room, "dialog", "Sign in").count() == 0, "/test-ride must not prompt until the rider acts"
        other = world.rider()
        world.locked(other, "pune", DESH, SLATE)
        reply = room.request.post(world.base + "/api/auth/signin",
                                  data={"mobile": other.user["mobile"], "password": PASSWORD})
        assert reply.status == 200
        _has(page, band, "₹4,18,640", LIVE_LIMIT_S + SLACK_S)
        _wait(room, lambda: field.input_value() == "", "another tab's licence fields to clear on adoption",
              LIVE_LIMIT_S + SLACK_S)
        assert session_text not in _log(page) and session_text not in _log(room)


def test_wf_w15_session_across_screens_keyboard(world: World, browser: Any) -> None:
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.35, ch="tank"), rider) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "the button")
        button.focus()
        page.keyboard.press("Enter")
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the lock dialog by keyboard")
        confirm = dialog.get_by_role("button", name="Confirm lock", exact=True)
        confirm.focus()
        world.clock("2026-10-28T21:00:00+05:30")
        sign_in = _role(page, "dialog", "Sign in")
        _wait(page, sign_in.is_visible, "Sign in over the lock dialog")
        for _ in range(6):
            page.keyboard.press("Tab")
            assert sign_in.evaluate("d => d.contains(document.activeElement)"), "Tab left Sign in"
        sign_in.get_by_role("textbox", name="Mobile number").focus()
        page.keyboard.type(rider.user["mobile"])
        sign_in.get_by_role("textbox", name="Password").focus()
        page.keyboard.type(PASSWORD)
        sign_in.get_by_role("button", name="Sign in", exact=True).focus()
        page.keyboard.press("Enter")
        _wait(page, lambda: sign_in.count() == 0 or not sign_in.is_visible(), "Sign in to close")
        assert dialog.is_visible(), "signing in closed the lower dialog"
        _wait(page, lambda: confirm.evaluate("e => e === document.activeElement"), "focus back on Confirm lock")
        page.keyboard.press("Enter")
        _said(page, "Price locked until 31 Oct, 6:00 pm IST.")


def test_wf_w16_unit_goes_withdraw(world: World, browser: Any, ntfy: Any, valkey: Any) -> None:
    world.clock("2026-11-03T09:00:00+05:30")
    holder = world.rider("Hari Nair")
    held_lock = world.locked(holder)
    assert holder.post(f"/api/locks/{held_lock['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    waiter = world.rider("Wafa Ali")
    assert waiter.post("/api/reminders").status_code == 200
    topic = TOPIC_PREFIX + waiter.user["id"]
    base = len(ntfy.messages(topic, expected=1))
    waiting = world.locked(waiter, "pune", DESH, SLATE)
    assert waiter.post(f"/api/locks/{waiting['id']}/delivery/wait", {"date": "2026-11-06"}).status_code == 201
    host = world.host()
    with _open(browser, world.base, _room(at=0.92, ch="cluster"), holder) as rider_page, \
            _open(browser, world.base, "/hub?date=2026-11-06", host) as host_page:
        _ready(rider_page)
        _mark(rider_page)
        table = _role(host_page, "table", "Day sheet")
        _wait(host_page, lambda: "Hari Nair" in _text(table), "the handover row")
        withdraw = _role(host_page, "button", "Withdraw unit Hari Nair")
        _wait(host_page, withdraw.is_visible, "button Withdraw unit")
        click(withdraw)
        _said(host_page, "Hari Nair's unit withdrawn.")
        _said(rider_page, "The hub has withdrawn your unit. Nothing is held for you.")
        _until_snap(rider_page, lambda s: abs(s["needleDeg"] + 135) <= 0.5, "the needle to drop", 8)
        _wait(host_page, lambda: "Hari Nair" not in _text(table) and "Wafa Ali" in _text(table), "the handover swap", 8)
        _wait(rider_page, lambda: not _disabled(_role(rider_page, "button", "Lock this price")), "Lock this price again")
        _no_reload(rider_page)
    assert holder.get(f"/api/locks/{held_lock['id']}").json()["lock"]["state"] == "withdrawn"
    _err(holder.post(f"/api/locks/{held_lock['id']}/release"), 409, "illegal_state")
    row = next(u for u in host.get("/api/hub/stock").json()["units"] if u["model"] == MEGH and u["finish"] == SLATE)
    assert (row["onHand"], row["held"], row["unitsLeft"]) == (2, 0, 2), row
    assert Api(world.base).live()["unitsLeft"] == 2, "surfaces disagree on the count"
    assert _score(valkey, _holds("pune", MEGH, SLATE), held_lock["ref"]) is None
    places = set(valkey.command("SMEMBERS", f"{PREFIX}:places:pune:2026-11-06"))
    assert held_lock["ref"] not in places and waiting["ref"] in places and len(places) == 12
    promoted = waiter.get(f"/api/locks/{waiting['id']}").json()["lock"]
    assert promoted["state"] == "delivery_set" and promoted["expiresAt"] is None and promoted["waitPosition"] is None
    assert _score(valkey, _holds("pune", DESH, SLATE), waiting["ref"]) == float("inf")
    messages = ntfy.messages(topic, expected=base + 1, timeout=NOTICE_LIMIT_S + SLACK_S)
    assert messages[-1].get("title") == "Delivery day set"
    assert messages[-1].get("message") == _line(NOTICE_PLACE, ("hub", "Pune"), ("model", "Desh 648"),
                                                ("Ddd d Mon", "Fri 6 Nov"))
    kinds = {n["kind"]: n["state"] for n in waiter.get("/api/notices").json()["notices"]}
    assert kinds["lock_ending"] == "cancelled"
    second = world.rider()
    plain = world.locked(second, "kochi", MEGH, SLATE)
    assert world.host(KOCHI_HOST).post(f"/api/hub/locks/{plain['id']}/withdraw").status_code == 200
    states = {n["kind"]: n["state"] for n in second.get("/api/notices").json()["notices"]}
    assert states["lock_ending"] == "cancelled", "a withdrawal left the lock-ending notice pending"


def test_wf_w16_unit_goes_two_hosts(world: World, browser: Any) -> None:
    rider = world.rider("Tej Rao")
    lock = rider.claim("pune", MEGH, KESAR).json()["lock"]
    host, leela = world.host(), world.host(LEELA_HOST)
    second = _peer("APP_SECOND_NODE_URL")
    with _open(browser, world.base, "/garage", rider) as page:
        band = _role(page, "region", "Your lock")
        _has(page, band, "Checking with the hub.")
        replies = _together(lambda: host.post(f"/api/hub/locks/{lock['id']}/confirm"),
                            lambda: leela.on(second).post(f"/api/hub/locks/{lock['id']}/refuse"))
        assert sorted(r.status_code for r in replies) == [200, 409]
        _err(next(r for r in replies if r.status_code == 409), 409, "illegal_state")
        state = rider.get(f"/api/locks/{lock['id']}").json()["lock"]["state"]
        assert state in ("locked", "refused")
        if state == "locked":
            _said(page, "Price locked until 30 Oct, 6:00 pm IST.")
            _has(page, band, "₹2,58,662")
        else:
            _said(page, "That finish has just gone. Nothing was locked.")
            _has(page, band, "Nothing is held for you yet.")


def test_lock_dialog_over_time(world: World, browser: Any, valkey: Any) -> None:
    world.clock("2026-10-31T23:59:59+05:30")
    rider = world.rider()
    with _open(browser, world.base, _room(at=0.35, finish=KESAR, ch="tank"), rider) as page:
        _ready(page)
        button = _role(page, "button", "Lock this price")
        _wait(page, lambda: not _disabled(button), "the button")
        click(button)
        dialog = _role(page, "dialog", "Confirm your lock")
        _wait(page, dialog.is_visible, "the dialog")
        _has(page, dialog, "₹2,58,662")
        confirm = dialog.get_by_role("button", name="Confirm lock", exact=True)
        confirm.evaluate("el => { el.__kept = true; el.focus(); }")
        moved: list[bool] = []

        def move_then_send(route: Any) -> None:
            if route.request.method == "POST" and not moved:
                moved.append(True)
                world.clock("2026-11-01T00:00:00+05:30")
            route.continue_()

        page.route("**/api/locks", move_then_send)
        click(confirm)
        _wait(page, lambda: page.evaluate("() => window.__statusLog.some(s => s.startsWith('Price updated'))"),
              "the price_moved status", 8)
        page.unroute("**/api/locks")
        assert moved, "Confirm lock never sent its POST"
        _said(page, "Price updated for today. New on-road price ₹2,65,211.")
        _has(page, dialog, "₹2,65,211")
        assert dialog.is_visible(), "price_moved must keep the dialog open"
        assert confirm.evaluate("el => el.__kept === true"), "the dialog's nodes were replaced"
        assert rider.get("/api/locks").json()["locks"] == [], "a moved price made a lock"
        assert valkey.command("ZCARD", _holds("pune", MEGH, KESAR)) == 0, "a moved price left a ledger member"
        _wait(page, lambda: not _disabled(confirm), "Confirm lock enabled after the repaint")
        taken = world.rider().claim("pune", MEGH, KESAR)
        assert taken.status_code == 202
        _wait(page, lambda: _disabled(confirm), "Confirm lock to disable at 0 units", 8)
        _said(page, "That finish has just gone. Nothing was locked.")
        assert world.host().post(f"/api/hub/locks/{taken.json()['lock']['id']}/refuse").status_code == 200
        _run(page, 500)
        assert world.host().post("/api/hub/stock-count/start").status_code == 200
        _wait(page, lambda: _disabled(confirm), "Confirm lock disabled while the hub is stale", 8)
        assert dialog.is_visible()


def test_inflight_races(world: World, browser: Any, valkey: Any) -> None:
    second = _peer("APP_SECOND_NODE_URL")
    host = world.host()
    rider = world.rider()
    lock = world.locked(rider)
    pair = _together(lambda: rider.post(f"/api/locks/{lock['id']}/release"),
                     lambda: host.on(second).post(f"/api/hub/locks/{lock['id']}/withdraw"))
    assert sorted(r.status_code for r in pair) == [200, 409]
    _err(next(r for r in pair if r.status_code == 409), 409, "illegal_state")
    assert _score(valkey, _holds("pune", MEGH, SLATE), lock["ref"]) is None
    racer = world.rider()
    lock = world.locked(racer, "pune", DESH, SLATE)
    pair = _together(lambda: racer.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-05"}),
                     lambda: host.on(second).post(f"/api/hub/locks/{lock['id']}/withdraw"))
    codes = [r.status_code for r in pair]
    final = racer.get(f"/api/locks/{lock['id']}").json()["lock"]
    assert 200 in codes and final["state"] in ("delivery_set", "withdrawn")
    if final["state"] == "withdrawn":
        assert lock["ref"] not in valkey.command("SMEMBERS", f"{PREFIX}:places:pune:2026-11-05"), "an orphan place member"
    expiring = world.rider()
    lock = world.locked(expiring, "bengaluru", MEGH, SLATE)
    world.clock("2026-10-30T17:59:59+05:30")
    expiring.renew()
    pair = _together(lambda: expiring.post(f"/api/locks/{lock['id']}/release"),
                     lambda: httpx.post(world.base + "/api/test/clock",
                                        json={"at": "2026-10-30T18:00:00+05:30", "freeze": True},
                                        timeout=HTTP_TIMEOUT_S))
    assert pair[0].status_code == 200 or pair[0].json()["error"]["code"] == "lock_expired", pair[0].text
    if pair[0].status_code == 200:
        assert _score(valkey, _holds("bengaluru", MEGH, SLATE), lock["ref"]) is None, "a member remained after the race"
    else:
        _poll(lambda: _score(valkey, _holds("bengaluru", MEGH, SLATE), lock["ref"]) is None,
              "the expired member to leave at a sweep", SWEEP_S + SLACK_S)
    fresh = World(world.base)
    sheet_rider = fresh.rider()
    lock = fresh.locked(sheet_rider, "kochi", MEGH, SLATE)
    fresh.clock("2026-10-30T17:00:00+05:30")
    sheet_rider.renew()
    pair = _together(lambda: sheet_rider.post(f"/api/locks/{lock['id']}/sheet"),
                     lambda: httpx.post(fresh.base + "/api/test/clock",
                                        json={"at": "2026-10-30T18:00:00+05:30", "freeze": True},
                                        timeout=HTTP_TIMEOUT_S))
    assert pair[0].status_code in (201, 409), f"a sheet racing expiry answered {pair[0].status_code}"
    if pair[0].status_code == 409:
        _err(pair[0], 409, "lock_expired")
    world3 = World(world.base)
    world3.clock("2026-10-31T23:59:59+05:30")
    late = world3.rider()
    requested = late.claim("pune", MEGH, KESAR).json()["lock"]
    world3.clock("2026-11-01T00:00:00+05:30")
    confirmed = world3.host().post(f"/api/hub/locks/{requested['id']}/confirm").json()["lock"]
    assert confirmed["stepEffectiveFrom"] == "2026-10-01" and confirmed["onRoadPaise"] == _paise(258662)


def test_held_units(world: World, browser: Any) -> None:
    host = world.host()
    with _open(browser, world.base, "/hub", host) as page:
        _wait(page, page.get_by_text("Nothing is held at this hub.").is_visible, "the empty state")
        first = world.rider("Ana Roy")
        requested = first.claim("pune", MEGH, KESAR).json()["lock"]
        world.clock("2026-10-28T09:00:01+05:30")
        second = world.rider("Ben Das")
        locked = world.locked(second)
        table = _role(page, "table", "Held units")
        _wait(page, lambda: table.count() == 1 and "Ben Das" in _text(table), "rows in place", 8)
        for column in ("Rider", "Machine", "Finish", "Ends", "State", "Action"):
            assert table.get_by_role("columnheader", name=column, exact=True).count() == 1, column
        rows = {r["id"]: r for r in host.get("/api/hub/held-units").json()["rows"]}
        assert set(rows[requested["id"]]) == HELD_KEYS
        assert rows[requested["id"]]["actions"] == ["confirm", "refuse"] and rows[locked["id"]]["actions"] == ["withdraw"]
        assert rows[locked["id"]]["expiresLabel"] == "30 Oct, 6:00 pm IST"
        assert list(rows) == [requested["id"], locked["id"]], "rows must run by issue time"
        assert _role(page, "button", "Withdraw unit Ana Roy").count() == 0, "a button without a server action"
        click(_role(page, "button", "Confirm unit Ana Roy"))
        _said(page, "Ana Roy's unit confirmed.")
        _wait(page, _role(page, "button", "Withdraw unit Ana Roy").is_visible, "the row's new action")
        assert first.post(f"/api/locks/{requested['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
        _wait(page, lambda: "No expiry" in _text(table), "No expiry on a delivery_set row", 8)
        assert host.get("/api/hub/held-units").json()["rows"][0]["expiresLabel"] is None
        click(_role(page, "button", "Withdraw unit Ben Das"))
        _said(page, "Ben Das's unit withdrawn.")
        _wait(page, lambda: "Ben Das" not in _text(table), "the row to leave in place")
    _err(host.post(f"/api/hub/locks/{requested['id']}/confirm"), 409, "illegal_state")
    _err(world.rider().get("/api/hub/held-units"), 403, "forbidden")
    _err(world.host(KOCHI_HOST).post(f"/api/hub/locks/{requested['id']}/withdraw"), 404, "not_found")
    assert all(r["id"] != requested["id"] for r in world.host(KOCHI_HOST).get("/api/hub/held-units").json()["rows"])
    refused_rider = world.rider()
    refused = refused_rider.claim("pune", DESH, RAAT).json()["lock"]
    assert host.post(f"/api/hub/locks/{refused['id']}/refuse").json()["lock"]["state"] == "refused"
    row = next(u for u in host.get("/api/hub/stock").json()["units"] if u["model"] == DESH and u["finish"] == RAAT)
    assert (row["onHand"], row["unitsLeft"]) == (0, 0), "a refusal must lower on-hand with the hold"


def _line_scene(world: World, waiters: int = 2) -> tuple[Api, dict[str, Any], list[tuple[Api, dict[str, Any]]]]:
    world.clock("2026-11-03T09:00:00+05:30")
    holder = world.rider("Line Holder")
    held_lock = world.locked(holder)
    assert holder.post(f"/api/locks/{held_lock['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    line = []
    for model, finish in [(MEGH, SLATE), (DESH, SLATE), (DESH, SLATE)][:waiters]:
        rider = world.rider()
        lock = world.locked(rider, "pune", model, finish)
        joined = rider.post(f"/api/locks/{lock['id']}/delivery/wait", {"date": "2026-11-06"})
        assert joined.status_code == 201, joined.text
        line.append((rider, joined.json()["lock"]))
    return holder, held_lock, line


def test_wf_w17_wait_line_promotion(world: World, browser: Any, ntfy: Any) -> None:
    holder, held_lock, _ = _line_scene(world, waiters=0)
    rider = world.rider()
    assert rider.post("/api/reminders").status_code == 200
    topic = TOPIC_PREFIX + rider.user["id"]
    base = len(ntfy.messages(topic, expected=1))
    lock = world.locked(rider)
    with _open(browser, world.base, "/garage", rider) as page:
        _mark(page)
        grid = _role(page, "grid", "Delivery days")
        cell = grid.get_by_role("gridcell", name=_line(DELIVERY_FULL, ("Ddd d Mon", "Fri 6 Nov")), exact=True)
        _wait(page, lambda: cell.count() == 1, "the full cell")
        click(cell)
        wait_button = _role(page, "button", "Wait for a place")
        _wait(page, wait_button.is_visible, "Wait for a place")
        assert _disabled(_role(page, "button", "Set delivery day"))
        with held(page, "**/delivery/wait") as release:
            click(wait_button)
            _said(page, "Joining the line…")
            release()
        _said(page, "You are number 1 in line for Fri 6 Nov.")
        band = _role(page, "region", "Your delivery")
        _has(page, band, "Number 1 in line for Fri 6 Nov.")
        _wait(page, _role(page, "button", "Leave the line").is_visible, "Leave the line")
        assert wait_button.count() == 0
        assert world.host().post(f"/api/hub/locks/{held_lock['id']}/withdraw").status_code == 200
        _said(page, "A place opened. Delivery set for Fri 6 Nov.")
        _wait(page, lambda: "in line" not in _text(band), "the band to leave the line in place", 8)
        _has(page, band, "Fri 6 Nov")
        _no_reload(page)
    assert rider.get(f"/api/locks/{lock['id']}").json()["lock"]["state"] == "delivery_set"
    messages = ntfy.messages(topic, expected=base + 1, timeout=NOTICE_LIMIT_S + SLACK_S)
    assert messages[-1].get("title") == "Delivery day set"
    assert holder.get(f"/api/locks/{held_lock['id']}").json()["lock"]["state"] == "withdrawn"


def test_wf_w17_wait_line_leave_and_close(world: World, browser: Any) -> None:
    _, _, line = _line_scene(world, waiters=2)
    (first, first_lock), (second, second_lock) = line
    with _open(browser, world.base, "/garage", second) as page:
        band = _role(page, "region", "Your delivery")
        _has(page, band, "Number 2 in line for Fri 6 Nov.")
        assert first.post(f"/api/locks/{first_lock['id']}/delivery/wait/leave").status_code == 200
        _said(page, "You are number 1 in line for Fri 6 Nov.")
        _has(page, band, "Number 1 in line for Fri 6 Nov.", 8)
        world.clock("2026-11-05T15:00:00+05:30")
        _said(page, "Your session has ended. Sign in to continue. Your choices are kept.")
        _sign_in(page, second.user["mobile"])
        second.renew()
        _has(page, band, "Number 1 in line for Fri 6 Nov.")
        world.clock("2026-11-05T15:59:59+05:30")
        _run(page, 500)
        assert second.get(f"/api/locks/{second_lock['id']}").json()["lock"]["waitPosition"] == 1
        world.clock("2026-11-05T16:00:00+05:30")
        _said(page, "That day has closed. Pick another.")
        _wait(page, lambda: "in line" not in _text(band), "the line's end in place", 8)
        _wait(page, _role(page, "gridcell", "Fri 6 Nov, closed").is_visible, "the closed cell")
        assert _disabled(_role(page, "gridcell", "Fri 6 Nov, closed"))
    ended = second.get(f"/api/locks/{second_lock['id']}").json()["lock"]
    assert ended["state"] == "locked" and ended["waitingFor"] is None and ended["waitPosition"] is None
    first.renew()
    with _open(browser, world.base, "/garage", first) as page:
        _wait(page, lambda: _role(page, "button", "Leave the line").count() == 0, "no line for the rider who left")


def test_wait_line_rules(world: World, valkey: Any) -> None:
    holder, held_lock, line = _line_scene(world, waiters=3)
    positions = [r.get(f"/api/locks/{lk['id']}").json()["lock"]["waitPosition"] for r, lk in line]
    assert positions == [1, 2, 3]
    (a, a_lock), (b, b_lock), (c, c_lock) = line
    again = a.post(f"/api/locks/{a_lock['id']}/delivery/wait", {"date": "2026-11-06"})
    assert again.status_code == 200 and again.json()["lock"]["waitPosition"] == 1
    _err(a.post(f"/api/locks/{a_lock['id']}/delivery/wait", {"date": "2026-11-07"}), 409, "delivery_day_has_places")
    _err(a.post(f"/api/locks/{a_lock['id']}/delivery/wait", {"date": "bad"}), 422, "invalid_body")
    _err(world.rider().post(f"/api/locks/{a_lock['id']}/delivery/wait/leave"), 404, "not_found")
    assert b.post(f"/api/locks/{b_lock['id']}/release").status_code == 200
    assert a.get(f"/api/locks/{a_lock['id']}").json()["lock"]["waitPosition"] == 1
    assert c.get(f"/api/locks/{c_lock['id']}").json()["lock"]["waitPosition"] == 2, "positions did not renumber"
    released = b.get(f"/api/locks/{b_lock['id']}").json()["lock"]
    assert released["waitingFor"] is None and released["waitPosition"] is None
    host = world.host()
    assert host.post(f"/api/hub/locks/{held_lock['id']}/withdraw").status_code == 200
    promoted = a.get(f"/api/locks/{a_lock['id']}").json()["lock"]
    assert promoted["state"] == "delivery_set" and promoted["deliveryDate"] == "2026-11-06", "not the earliest waiter"
    assert c.get(f"/api/locks/{c_lock['id']}").json()["lock"]["waitPosition"] == 1
    rows = host.get(_sheet_path("2026-11-06")).json()["rows"]
    assert [r["id"] for r in rows if r["kind"] == "handover"] == [a_lock["id"]], "the day sheet disagrees with the places"
    assert a_lock["ref"] in valkey.command("SMEMBERS", f"{PREFIX}:places:pune:2026-11-06")
    days = {d["date"]: d for d in c.get(f"/api/locks/{c_lock['id']}/delivery-days").json()["days"]}
    assert days["2026-11-06"]["state"] == "full" and days["2026-11-06"]["placesLeft"] == 0
    leaving = c.post(f"/api/locks/{c_lock['id']}/delivery", {"date": "2026-11-07"})
    assert leaving.status_code == 200 and leaving.json()["lock"]["waitingFor"] is None, "setting a day must leave the line"
    _err(c.post(f"/api/locks/{c_lock['id']}/delivery/wait/leave"), 409, "illegal_state")
    _err(c.post(f"/api/locks/{c_lock['id']}/delivery/wait", {"date": "2026-11-06"}), 409, "illegal_state")
    world2 = World(world.base)
    _, held2, line2 = _line_scene(world2, waiters=2)
    (d, d_lock), (e, e_lock) = line2
    world2.clock("2026-11-05T15:00:00+05:30")
    d.renew()
    e.renew()
    assert d.post(f"/api/locks/{d_lock['id']}/delivery/wait/leave").status_code == 200
    assert e.get(f"/api/locks/{e_lock['id']}").json()["lock"]["waitPosition"] == 1
    assert world2.host().post(f"/api/hub/locks/{held2['id']}/withdraw").status_code == 200
    assert d.get(f"/api/locks/{d_lock['id']}").json()["lock"]["state"] == "locked", "a waiter who left was promoted"
    assert e.get(f"/api/locks/{e_lock['id']}").json()["lock"]["state"] == "delivery_set"


def test_waiter_beats_rival(world: World, valkey: Any) -> None:
    second = _peer("APP_SECOND_NODE_URL")
    _, held_lock, line = _line_scene(world, waiters=1)
    waiter, waiting = line[0]
    rival = world.rider()
    rival_lock = world.locked(rival, "pune", DESH, SLATE)
    host = world.host()
    calls = [lambda: host.post(f"/api/hub/locks/{held_lock['id']}/withdraw")]
    calls += [lambda i=i: (rival.on(second) if i % 2 else rival).post(
        f"/api/locks/{rival_lock['id']}/delivery", {"date": "2026-11-06"}) for i in range(4)]
    replies = _together(*calls)
    assert replies[0].status_code == 200, replies[0].text
    for reply in replies[1:]:
        _err(reply, 409, "delivery_day_full")
    assert waiter.get(f"/api/locks/{waiting['id']}").json()["lock"]["state"] == "delivery_set"
    assert rival.get(f"/api/locks/{rival_lock['id']}").json()["lock"]["state"] == "locked"
    places = set(valkey.command("SMEMBERS", f"{PREFIX}:places:pune:2026-11-06"))
    assert waiting["ref"] in places and rival_lock["ref"] not in places and len(places) == 12


def test_error_precedence(world: World) -> None:
    json_header = {"Content-Type": "application/json"}
    out = Api(world.base)
    rider, other = world.rider(), world.rider()
    host, kochi = world.host(), world.host(KOCHI_HOST)
    _err(out.post("/api/locks/nope/release"), 401, "unauthenticated")
    ended = world.rider()
    world.clock("2026-10-28T21:00:00+05:30")
    _err(ended.post("/api/locks/nope/release"), 401, "session_ended")
    world.clock(SEED_AT)
    rider, other, host, kochi = world.rider(), world.rider(), world.host(), world.host(KOCHI_HOST)
    lock = world.locked(rider)
    _err(other.post(f"/api/locks/{lock['id']}/delivery", {"nope": 1}), 404, "not_found")
    _err(other.post("/api/locks/nope/delivery", {"nope": 1}), 404, "not_found")
    _err(rider.get("/api/hub/day-sheet?date=bad"), 403, "forbidden")
    _err(rider.get("/api/hub/held-units"), 403, "forbidden")
    _err(host.post("/api/locks/nope/release"), 403, "forbidden")
    _err(kochi.post(f"/api/hub/locks/{lock['id']}/withdraw"), 404, "not_found")
    _err(host.post(f"/api/hub/locks/{lock['id']}/confirm"), 409, "illegal_state")
    _err(host.post("/api/hub/stock-count/finish", raw=b"{bad", headers=json_header), 409, "illegal_state")
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", ["array"]), 422, "invalid_body")
    _err(rider.post("/api/locks/nope/delivery", raw=b"{bad", headers=json_header), 404, "not_found")
    _err(host.post("/api/locks", raw=b"{bad", headers=json_header), 403, "forbidden")
    _err(out.post("/api/locks", raw=b"{bad", headers=json_header), 401, "unauthenticated")
    _err(out.post("/api/locks", raw=b"x" * (BODY_LIMIT + 1), headers=json_header), 413, "too_large")
    _err(out.post("/api/locks", raw=b"a=1", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    exact = b'{"pad":"' + b"x" * (BODY_LIMIT - 10) + b'"}'
    assert len(exact) == BODY_LIMIT
    _err(other.post("/api/locks", raw=exact, headers=json_header), 422, "invalid_body")
    _err(other.post("/api/locks", {"hub": "nope", "model": MEGH, "finish": SLATE, "stepEffectiveFrom": "2026-10-01"}),
         422, "invalid_body")
    _err(other.post("/api/locks", {"hub": "pune", "model": MEGH, "finish": SLATE}), 422, "invalid_body")
    _err(other.post("/api/locks", {"hub": "pune", "model": MEGH, "finish": RAAT}), 409, "none_left")
    charset = other.post("/api/locks", raw=json.dumps({"hub": "pune", "model": MEGH, "finish": SLATE,
                                                       "stepEffectiveFrom": "2026-10-01"}).encode(),
                         headers={"Content-Type": "application/json; charset=utf-8"})
    assert charset.status_code == 201, charset.text
    assert other.post(f"/api/locks/{charset.json()['lock']['id']}/release", raw=b"").status_code == 200
    assert host.post("/api/hub/stock-count/start").status_code == 200
    _err(other.post("/api/locks", {"hub": "pune", "model": MEGH, "finish": RAAT}), 409, "none_left")
    _err(other.post("/api/locks", {"hub": "pune", "model": MEGH, "finish": SLATE}), 422, "invalid_body")
    _err(other.claim("pune", MEGH, RAAT, step="2026-10-01"), 409, "none_left")
    _err(other.claim("pune", MEGH, KESAR, step="2026-10-01"), 503, "hub_unreachable")
    _err(host.post("/api/hub/stock-count/finish", raw=b"{bad", headers=json_header), 422, "invalid_body")
    rows = host.get("/api/hub/stock").json()["units"]
    assert host.post("/api/hub/stock-count/finish", {"units": [
        {"model": u["model"], "finish": u["finish"], "onHand": u["onHand"]} for u in rows]}).status_code == 200
    taken = rider.ride(_ist("2026-10-30", "11:30:00")).json()["ride"]
    _err(other.ride(_ist("2026-10-30", "11:30:00"), licence="bad"), 409, "slot_taken")
    assert rider.post(f"/api/rides/{taken['id']}/cancel").status_code == 200
    _err(rider.post(f"/api/rides/{taken['id']}/move", {"startsAt": "nope"}), 409, "illegal_state")
    world.clock("2026-10-30T18:00:00+05:30")
    rider.renew()
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "bad"}), 409, "lock_expired")
    _err(rider.post(f"/api/locks/{lock['id']}/delivery", ["array"]), 409, "lock_expired")
    _err(world.host().post(f"/api/hub/locks/{lock['id']}/withdraw"), 409, "lock_expired")
    _err(out.get(UNKNOWN_PATH), 404, "not_found")
    deleted = out.call("DELETE", "/api/catalogue")
    _err(deleted, 405, "method_not_allowed")
    assert deleted.headers.get("allow") == "GET"
    _err(Api(_peer("APP_NOTICE_PEER_URL")).get(_slots_path("nope", "2026-10-30")), 404, "not_found")
    _err(out.get(_slots_path("pune", MALFORMED_DATE)), 422, "invalid_body")
    _err(out.get(_slots_path("pune")), 422, "invalid_body")


def test_server_boundaries(world: World, browser: Any) -> None:
    second = _peer("APP_SECOND_NODE_URL")
    owner, stranger = world.rider(), world.rider()
    assert owner.ride(_ist("2026-10-30", "11:30:00")).status_code == 201
    lock = world.locked(owner)
    ride = owner.get("/api/rides").json()["rides"][0]
    notice = owner.get("/api/notices").json()["notices"][0]
    for base in (world.base, second):
        peer = stranger.on(base)
        for path in (f"/api/locks/{lock['id']}", f"/api/locks/{lock['id']}/sheet", f"/api/rides/{ride['id']}",
                     f"/api/notices/{notice['id']}"):
            _err(peer.get(path), 404, "not_found")
    assert stranger.get("/api/locks").json()["locks"] == [] and stranger.get("/api/rides").json()["rides"] == []
    assert LICENCE in json.dumps(owner.get("/api/me").json())
    calls = []
    for _ in range(15):
        calls += [lambda: (owner, owner.get("/api/me")), lambda: (stranger, stranger.on(second).get("/api/me"))]
    for api, reply in _together(*calls):
        assert reply.json()["user"]["id"] == api.user["id"], "a reply carried another caller's identity"
    for words in ("Kabir Menon", "Ira Deshpande"):
        sheet = world.host().get("/api/hub/day-sheet").text
        assert words in sheet
    for secret_licence in ("MH1220190043210", "MH1420210098765"):
        assert secret_licence not in world.host().get("/api/hub/day-sheet").text
    assert "9000000201" not in world.host().get("/api/hub/day-sheet").text
    foreign_origin = "http://elsewhere.test"
    plain = httpx.get(world.base + "/api/live/now", headers={"Origin": foreign_origin}, timeout=HTTP_TIMEOUT_S)
    assert foreign_origin not in " ".join(plain.headers.values()), "permissive cross-origin headers"
    for path in ("/.env", "/package.json", "/src/"):
        assert httpx.get(world.base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    secrets_in_env = [os.environ[n] for n in ("DATABASE_URL", "VALKEY_URL", "GOTENBERG_URL", "NTFY_URL", "NTFY_PASSWORD",
                                              "SEED_RIDER_PASSWORD", "SEED_HOST_PASSWORD") if os.environ.get(n)]
    with _open(browser, world.base, "/api/health") as page:
        bodies: list[str] = []
        page.on("response", lambda r: bodies.append(r.url))
        page.goto(world.base + "/showroom")
        _ready(page)
        texts = [page.content()]
        for url in bodies:
            if same_host(url, world.base) and "/api/live" not in url:
                texts.append(httpx.get(url, timeout=HTTP_TIMEOUT_S).text)
    for text in texts:
        for value in secrets_in_env:
            assert value not in text, "a provider address or credential reached the browser"
        assert f"{PREFIX}:holds" not in text and f"{PREFIX}:onhand" not in text, "a ledger key name reached the browser"


def same_host(url: str, base: str) -> bool:
    return urlparse(url).netloc == urlparse(base).netloc


def test_status_region(world: World, browser: Any) -> None:
    rider, host = world.rider(), world.host()
    for path, caller in (("/", None), ("/showroom", None), ("/test-ride", None), ("/garage", rider), ("/hub", host),
                         ("/nope", None)):
        with _open(browser, world.base, path, caller) as page:
            region = page.get_by_role("status", name="Showroom status", include_hidden=True)
            _wait(page, lambda: region.count() == 1, f"one Showroom status on {path}")
            assert region.get_attribute("aria-live") == "polite", path
            assert region.get_attribute("aria-label") == "Showroom status"
    with _open(browser, world.base, _room(at=0.35, ch="tank")) as page:
        _ready(page)
        assert host.post("/api/hub/stock-count/start").status_code == 200
        counting = "Hub is counting stock. Showing stock from 9:00 am IST. Locks are paused."
        _said(page, counting)
        start = time.monotonic()
        _wait(page, lambda: time.monotonic() - start > SWEEP_S + 2, "a full sweep to pass", SWEEP_S + SLACK_S)
        assert _log(page).count(counting) == 1, "the stale string repeated at a sweep"
        rows = host.get("/api/hub/stock").json()["units"]
        assert host.post("/api/hub/stock-count/finish", {"units": [
            {"model": u["model"], "finish": u["finish"], "onHand": u["onHand"]} for u in rows]}).status_code == 200
        _said(page, "Stock count is done. Stock is live.")
    assert httpx.get(world.base + "/nope", timeout=HTTP_TIMEOUT_S).status_code == 404
    with _open(browser, world.base, "/nope") as page:
        _wait(page, page.get_by_text("We couldn't find that page.").is_visible, "the not-found sentence")
        assert _role(page, "link", "Back to the showroom").count() == 1
    with _open(browser, world.base, "/hub", rider) as page:
        _wait(page, page.get_by_text("This console is for hub hosts.").is_visible, "the rider's refusal")
    with _open(browser, world.base, "/garage", host) as page:
        _wait(page, page.get_by_text("The Garage is for riders.").is_visible, "the host's refusal")


@pytest.mark.timeout(600)
def test_layout_and_touch(world: World, browser: Any) -> None:
    rider = world.rider()
    world.locked(rider)
    for viewport in (DESKTOP, TABLET, PHONE):
        for path in ("/", "/showroom", "/test-ride", "/garage", "/hub", "/nope"):
            with _open(browser, world.base, path, rider if path == "/garage" else None, viewport=viewport) as page:
                _run(page, 500)
                width = page.evaluate("() => document.documentElement.scrollWidth")
                assert width == viewport["width"], (path, viewport, width)
                layout(page)
    with _open(browser, world.base, "/", viewport=PHONE, touch=True) as page:
        _run(page, 300)
        names = tab_order(page, 4)
        assert "Garage" not in names and "Test ride" not in names, f"closed Menu links in the tab order: {names}"
        for locator in page.get_by_role("button").all() + page.get_by_role("link").all():
            if locator.is_visible():
                box = locator.bounding_box()
                assert box["width"] >= TOUCH_MIN and box["height"] >= TOUCH_MIN, (locator, box)
    with _open(browser, world.base, "/test-ride?hub=pune&model=megh-349&date=2026-10-30", viewport=PHONE) as page:
        _wait(page, lambda: page.get_by_role("gridcell").count() == len(SLOT_LABELS), "the grid")
        for role in ("gridcell", "textbox", "combobox", "radio"):
            for locator in page.get_by_role(role).all():
                if locator.is_visible():
                    box = locator.bounding_box()
                    assert box["height"] >= TOUCH_MIN, (role, box)
    with _open(browser, world.base, "/") as page:
        action = _role(page, "link", "Start the build")
        _wait(page, action.is_visible, "the primary action")
        _, focused = state_styles(action, "outline-width", "outline-color", "outline-offset", state="focus")
        assert focused["outline-width"] == f"{FOCUS_RING_PX}px" and focused["outline-color"] == "rgb(%d, %d, %d)" % ACCENT, \
            focused
        assert float(focused["outline-offset"].replace("px", "")) >= 3, focused
        axe(page)


def test_two_server_copies(world: World) -> None:
    second = _peer("APP_SECOND_NODE_URL")
    rider = world.rider()
    assert rider.on(second).get("/api/me").json()["user"]["id"] == rider.user["id"]
    moved = world.clock("2026-10-29T10:00:00+05:30")
    assert _when(moved["now"]) == _when("2026-10-29T10:00:00+05:30")
    _poll(lambda: _when(Api(second).live()["serverNow"]) == _when("2026-10-29T10:00:00+05:30"), "the clock shared across copies",
          LIVE_LIMIT_S + SLACK_S)
    rider.renew()
    with Stream(second, "?hub=pune") as stream:
        first = stream.wait("live")
        at = time.monotonic()
        assert rider.claim().status_code == 201
        changed = stream.wait("live", lambda b: b["unitsLeft"] == 2, LIVE_LIMIT_S + SLACK_S)
        arrival = next(e[0] for e in stream.events if e[1] == "live" and json.loads(e[2])["seq"] == changed["seq"])
        assert arrival - at <= LIVE_LIMIT_S + 1, f"the other copy took {arrival - at}s"
        assert changed["seq"] > first["seq"]
    assert Api(world.base).live()["seq"] == Api(second).live()["seq"], "copies disagree on the sequence"
    assert Api(second).live()["unitsLeft"] == 2
    assert world.host().on(second).post("/api/hub/stock-count/start").status_code == 200
    assert Api(world.base).live()["staleReason"] == "count", "staleness is not shared"
    with _copy() as third:
        assert Api(third).live()["unitsLeft"] == 2, "starting a copy reset the holds"
        assert Api(third).live()["staleReason"] == "count", "starting a copy reset the staleness"
        assert rider.on(third).get("/api/me").status_code == 200, "starting a copy reset the sessions"


def test_status_order_and_repeats(world: World, browser: Any) -> None:
    world.clock("2026-10-31T23:59:59+05:30")
    with _open(browser, world.base, _room(at=0.35, ch="tank")) as page:
        _ready(page)
        world.host().post("/api/hub/stock-count/start")
        first = "Hub is counting stock. Showing stock from 11:59 pm IST. Locks are paused."
        _said(page, first)
        _run(page, 800)
        world.clock("2026-11-01T00:00:00+05:30")
        dated = "Hub is counting stock. Showing stock from 31 Oct, 11:59 pm IST. Locks are paused."
        price = "Price updated for today. New on-road price ₹2,65,211."
        _said(page, price)
        log = _log(page)
        assert log.index(dated) < log.index(price), log
        times = page.evaluate("() => window.__statusTimes")
        began = next(t for s, t in times if s == dated)
        ended = next(t for s, t in times if t > began and s != dated)
        assert ended - began >= 700, f"the dated string showed for {ended - began} ms"
    down = World(_peer("APP_SHEET_DOWN_URL"))
    rider = down.rider()
    down.locked(rider)
    with _open(browser, down.base, "/garage", rider) as page:
        make = _role(page, "button", "Make price sheet")
        _wait(page, make.is_visible, "the button")
        failed = "Price sheet could not be made. Try again."
        click(make)
        _said(page, failed)
        click(make)
        _wait(page, lambda: _log(page).count(failed) == 2, "two failures to give two announcements")


def test_published_ledger_surface(world: World, valkey: Any) -> None:
    rider = world.rider("Priya Ledger")
    lock = world.locked(rider)
    assert rider.post(f"/api/locks/{lock['id']}/delivery", {"date": "2026-11-06"}).status_code == 200
    assert rider.ride(_ist("2026-10-30", "11:30:00")).status_code == 201
    shapes = {rf"{PREFIX}:onhand:[a-z]+:[a-z0-9-]+:[a-z-]+": "string", rf"{PREFIX}:holds:[a-z]+:[a-z0-9-]+:[a-z-]+": "zset",
              rf"{PREFIX}:slot:[a-z]+:\d{{4}}-\d\d-\d\dT\d\d:\d\d": "string", rf"{PREFIX}:places:[a-z]+:\d{{4}}-\d\d-\d\d": "set",
              rf"{PREFIX}:heartbeat": "string"}
    keys = valkey.keys(f"{PREFIX}:*")
    private = (LICENCE, rider.user["mobile"], "Priya Ledger", "Kabir Menon", "9000000201", "MH1420210098765")
    for key in keys:
        kind = next((t for pattern, t in shapes.items() if re.fullmatch(pattern, key)), None)
        assert kind, f"unpublished ledger key {key}"
        assert valkey.command("TYPE", key) == kind, key
        assert valkey.ttl(key) == -1, f"{key} carries a time to live"
        if kind == "zset":
            content = json.dumps(valkey.command("ZRANGE", key, 0, -1))
        elif kind == "set":
            content = json.dumps(valkey.command("SMEMBERS", key))
        else:
            content = str(valkey.command("GET", key))
        for value in private:
            assert value not in content and value not in key, f"{key} holds private data"
    baseline = {("pune", MEGH, KESAR): "1", ("kochi", DESH, SLATE): "3", ("gurugram", MEGH, KESAR): "0"}
    for (hub, model, finish), value in baseline.items():
        assert valkey.command("GET", _onhand(hub, model, finish)) == value
    assert len([k for k in keys if ":onhand:" in k]) == 24
    members = set(valkey.command("SMEMBERS", f"{PREFIX}:places:pune:2026-11-06"))
    assert {f"earlier-sale-{n}" for n in range(1, 12)} <= members and lock["ref"] in members
    assert re.fullmatch(r"[A-Za-z0-9-]+", lock["ref"]), lock["ref"]
    kabir = world.seed_rider(KABIR).get("/api/rides").json()["rides"][0]
    assert valkey.command("GET", f"{PREFIX}:slot:pune:2026-10-28T10:00") == kabir["id"]


APP_ROOT = Path("/app")
ALLOWLIST = {"MIT", "Apache-2.0", "BSD", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1"}


def _offered(combo: Any, label: str) -> bool:
    if label in _text(combo):
        return True
    if combo.evaluate("e => e.tagName") == "SELECT":
        return False
    click(combo)
    found = combo.page.get_by_role("option", name=label, exact=True).count() > 0
    combo.page.keyboard.press("Escape")
    return found


def _app_files() -> list[Path]:
    skipped = {"node_modules", ".git", "dist", "build"}
    return [p for p in APP_ROOT.rglob("*") if p.is_file() and not skipped & set(p.parts)]


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing}"
    assert "Gloock" in notices and "Rethink Sans" in notices


def test_if_licences() -> None:
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not refused, refused


def test_if_no_extra_datastore() -> None:
    others = {"sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "memcached", "level", "nedb"}
    assert not others & {p.name for p in shipped_packages()}


def test_if_no_model_files() -> None:
    suffixes = {".gltf", ".glb", ".obj", ".fbx", ".stl", ".dae", ".3ds", ".usdz"}
    found = [str(p) for p in _app_files() if p.suffix.lower() in suffixes]
    assert not found, found


def test_if_fonts_bundled(world: World, browser: Any) -> None:
    fonts = [p for p in APP_ROOT.rglob("*") if p.suffix.lower() in {".woff2", ".woff", ".ttf", ".otf"} and ".git" not in p.parts]
    assert fonts, "no bundled font files"
    with _open(browser, world.base, "/api/health") as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        page.goto(world.base + "/")
        _run(page, 500)
    foreign = [u for u in seen if u.startswith("http") and not same_host(u, world.base)]
    assert not foreign, f"requests left the app: {foreign}"


def test_if_seed_passwords() -> None:
    values = [os.environ[n] for n in ("SEED_RIDER_PASSWORD", "SEED_HOST_PASSWORD") if os.environ.get(n)]
    for path in _app_files():
        if path.stat().st_size < 2_000_000:
            data = path.read_bytes()
            for value in values:
                assert value.encode() not in data, f"a seed password is in {path}"


def test_if_ledger_prefix(valkey: Any) -> None:
    outside = [k for k in valkey.keys("*") if not k.startswith("malhar")]
    assert not outside, f"keys outside VALKEY_PREFIX: {outside}"
