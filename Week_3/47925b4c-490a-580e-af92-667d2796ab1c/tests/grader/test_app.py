from __future__ import annotations

import concurrent.futures
import contextlib
import datetime as dt
import hashlib
import io
import json
import math
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
import zipfile
import zlib
from decimal import ROUND_HALF_EVEN, Decimal, localcontext
from pathlib import Path
from types import SimpleNamespace as NS
from typing import Any, Callable, Iterator
from urllib.parse import quote, urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    S3,
    WireMock,
    advance,
    animations,
    capture,
    click,
    decode,
    difference,
    fill,
    idempotency_key,
    layout,
    licence_allowed,
    motion,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    session,
    shipped_packages,
    unique,
)

HTTP_TIMEOUT_S = 90
TICK_S = 0.25
PAGE_POLL_MS = 300
UI_DEADLINE_S = 30
API_DEADLINE_S = 40
LEASE_DEADLINE_S = 120
BOOT_DEADLINE_S = 180
JSON_LIMIT = 1_000_000
PHOTO_LIMIT = 40_000_000
LINK_LIMIT = 30
LINK_WINDOW_S = 60
KEY_MAX = 128
STOPPED_KEY_S = 60
DESK_LIMIT_MS = 3_000
DESK_SETTLE_S = 15
EXPIRES_S = 1800
LAPSE_COMMIT_S = 10
SWEEP_S = 5
DELIVERY_S = 2
COMMENT_S = 15
DB_RETURN_S = 10
LINK_STREAM_CLOSE_S = 5
SHORT_SECONDS = 8
PRESS_LIMIT_MS = 20_000
PRESS_STALL_MS = PRESS_LIMIT_MS + 1_000
GLIDE_MAX_MS = 250
ROLL_MAX_MS = 400
STAGE_MAX_MS = 660
FOUR_DECIMALS = 0.00011
NATIVE_WIDTH = 1920
NATIVE_HEIGHT = 1200
VK20_LUMENS = 20_000
VK20_RATED_HOURS = 20_000
VK20_WATTS = 1900
MAINS_WATTS = 22170
CIRCUIT_16A_WATTS = 3680
FC_LUX = Decimal("10.7639104167")
FL_CDM2 = Decimal("3.4262591")
PI = Decimal("3.141592653589793")
RATE_CENTS = 16500
OUTPUT_START = 20_000
OUTPUT_STEP = 1_000
THROW_START = Decimal("1.3")
THROW_STEP = Decimal("0.1")
B02_LUMENS = VK20_LUMENS * (1 - 0.5 * 4000 / VK20_RATED_HOURS)
FACTORS = {1: 1000, 2: 1800, 3: 2500, 4: 3100, 5: 3600, 6: 4100, 7: 4600}
SEED_SITE = "zuiderhal"
SEED_LAYOUT = "zuiderhal-launch"
SEED_PATH = "/sites/zuiderhal/layouts/zuiderhal-launch"
SEED_ROWS = 24
SEED_COLUMNS = 48
LATE_CAPTURE = "2099-01-01T00:00:00+00:00"
OLD_CAPTURE = "2026-01-15T20:00:00+01:00"
WRONG_CLOCK_AHEAD = "2031-01-01T00:00:00Z"
WRONG_CLOCK_BEHIND = "2001-01-01T00:00:00Z"
SHOW_AT = "2027-07-01T20:00"
PHOTO_WIDTH = 400
PHOTO_HEIGHT = 300
ALLOWED_LICENCES = {
    "MIT", "ISC", "BSD", "BSD-2-Clause", "BSD-3-Clause", "0BSD", "Apache-2.0", "OFL", "OFL-1.1",
}

MOVEMENT_ORIGIN_PROBE = "https://elsewhere.example"
HOSTILE_NAME = "../../etc/passwd.jpg"
_TICK = threading.Event()


def outage(name: str) -> str:
    return os.environ[name].rstrip("/")


def uid() -> str:
    return uuid.uuid4().hex[:10].upper()


def far_day() -> str:
    start = dt.date(2090, 1, 1)
    return (start + dt.timedelta(days=random.randint(0, 3000))).isoformat()


def poll(fetch: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fetch()
        if last:
            return last
        _TICK.wait(TICK_S)
    pytest.fail(f"{what}; last saw {last!r}")


def api(
    base: str,
    method: str,
    path: str,
    body: Any = None,
    *,
    key: str | None = None,
    headers: dict[str, str] | None = None,
    content: bytes | None = None,
) -> httpx.Response:
    sent = dict(headers or {})
    if key is not None:
        sent["Idempotency-Key"] = key
    arguments: dict[str, Any] = {}
    if content is not None:
        arguments["content"] = content
    elif body is not None:
        arguments["content"] = json.dumps(body).encode()
        sent.setdefault("Content-Type", "application/json")
    return httpx.request(method, base + path, headers=sent, timeout=HTTP_TIMEOUT_S, **arguments)


def ok(resp: httpx.Response, status: int = 200) -> Any:
    assert resp.status_code == status, f"{resp.request.method} {resp.request.url}: {resp.status_code} {resp.text[:400]}"
    return resp.json()


def problem(resp: httpx.Response, status: int, code: str, detail: str | None = None) -> dict[str, Any]:
    assert resp.status_code == status, f"expected {status} {code}, got {resp.status_code} {resp.text[:400]}"
    assert "application/problem+json" in resp.headers.get("content-type", "")
    body = resp.json()
    assert body["type"] == f"urn:gevelwerk:problem:{code}"
    assert body["code"] == code
    assert body["status"] == status
    assert isinstance(body["title"], str) and body["title"]
    assert isinstance(body["detail"], str) and body["detail"]
    if detail is not None:
        assert body["detail"] == detail
    return body


def invalid(resp: httpx.Response, copy: str, pointer: str | None = None) -> None:
    body = problem(resp, 422, "validation_failed", "Some fields need fixing.")
    if pointer is None:
        assert copy in body["errors"].values(), body["errors"]
    else:
        assert body["errors"].get(pointer) == copy, body["errors"]


def Q(text: str, unit: str = "m") -> dict[str, str]:
    return {"text": text, "unit": unit}


def instant(text: str) -> dt.datetime:
    return dt.datetime.fromisoformat(text.replace("Z", "+00:00"))


def state(value: str) -> str:
    return value.replace("_", " ").casefold()


HIRED_IN = state("Hired in")
DRAFT = state("Draft")
OUT_OF_STEP = state("Out of step")


def new_site(base: str, width: str = "24", height: str = "12", name: str | None = None, show: str = SHOW_AT) -> dict[str, Any]:
    body = {"name": name or unique("Wall")[0], "width": Q(width), "height": Q(height), "showAtLocal": show}
    return ok(api(base, "POST", "/api/sites", body, key=idempotency_key()), 201)


def move(base: str, kind: str, serial: str, **extra: Any) -> httpx.Response:
    return api(base, "POST", "/api/kit/movements", {"kind": kind, "serial": serial, **extra}, key=idempotency_key())


def buy(base: str, model: str = "VK-20", hours: str | None = None) -> str:
    serial = f"T-{uid()}"
    extra: dict[str, Any] = {"model": model}
    if hours is not None:
        extra["loggedHours"] = hours
    ok(move(base, "bought", serial, **extra), 201)
    return serial


def shelf(base: str) -> dict[str, Any]:
    return ok(api(base, "GET", "/api/kit/shelf"))


def shelf_item(base: str, serial: str) -> dict[str, Any]:
    return next(i for i in shelf(base)["items"] if i["serial"] == serial)


def model_free(data: dict[str, Any], model: str = "VK-20") -> int:
    return next(m for m in data["models"] if m["model"] == model)["free"]


def journal(base: str, serial: str | None = None) -> list[dict[str, Any]]:
    items: list[dict[str, Any]] = []
    path = "/api/kit/movements?limit=200"
    for _ in range(200):
        page = ok(api(base, "GET", path))
        items += page["items"]
        if page["nextCursor"] is None:
            return [m for m in items if serial is None or m["serial"] == serial]
        path = f"/api/kit/movements?limit=200&after={quote(page['nextCursor'])}"
    pytest.fail("GET /api/kit/movements never reached nextCursor null")


def layout_of(base: str, layout_id: str) -> tuple[dict[str, Any], str]:
    resp = api(base, "GET", f"/api/layouts/{layout_id}")
    return ok(resp), resp.headers["etag"]


def place_input(lens: str, circuit: str, body: str | None = None, *, hold: str | None = None, model: str | None = None,
                aim: tuple[str, str] = ("6.5", "6"), pos: tuple[str, str] | None = None, standoff: str = "18",
                ratio: str = "1.3", shift: tuple[str, str] = ("0", "0")) -> dict[str, Any]:
    pos = pos or aim
    data: dict[str, Any] = {
        "lensSerial": lens, "aimAcross": Q(aim[0]), "aimDown": Q(aim[1]), "bodyAcross": Q(pos[0]), "bodyDown": Q(pos[1]),
        "standoff": Q(standoff), "ratio": ratio, "shiftAcrossPercent": shift[0], "shiftDownPercent": shift[1],
        "circuitId": circuit,
    }
    if body:
        data["bodySerial"] = body
    if hold:
        data["holdId"] = hold
    if model:
        data["model"] = model
    return data


def post_placement(base: str, layout_id: str, data: dict[str, Any]) -> httpx.Response:
    _, tag = layout_of(base, layout_id)
    return api(base, "POST", f"/api/layouts/{layout_id}/placements", data, key=idempotency_key(), headers={"If-Match": tag})


def ready(base: str, bodies: int = 1, width: str = "48", height: str = "12") -> NS:
    site = new_site(base, width, height)
    made = NS(site=site, id=site["id"], layout=site["layouts"][0]["id"], circuit=site["circuits"][0]["id"], serials=[], lenses=[])
    for index in range(bodies):
        serial, lens = buy(base), buy(base, "LS-13")
        made.serials.append(serial)
        made.lenses.append(lens)
        ok(post_placement(base, made.layout, place_input(lens, made.circuit, serial, aim=(str(6 + 8 * index), "6"))), 201)
    return made


def issue(base: str, layout_id: str, key: str | None = None) -> httpx.Response:
    return api(base, "POST", f"/api/layouts/{layout_id}/issue", {}, key=key or idempotency_key())


def issued(base: str, bodies: int = 1) -> NS:
    made = ready(base, bodies)
    made.sheet = ok(issue(base, made.layout), 201)
    made.token = made.sheet["techUrl"].rsplit("/", 1)[-1]
    return made


def sync(base: str, site_id: str, *ops: tuple[str, str, str, str]) -> list[dict[str, Any]]:
    operations = [{"operationId": str(uuid.uuid4()), "cell": c, "value": Q(t, u), "capturedAt": at} for c, t, u, at in ops]
    return ok(api(base, "POST", f"/api/sites/{site_id}/readings/sync", {"operations": operations}))["results"]


def readings(base: str, site_id: str, cell: str) -> list[dict[str, Any]]:
    return ok(api(base, "GET", f"/api/sites/{site_id}/cells/{cell}/readings"))["items"]


def layout_cell(base: str, layout_id: str, cell: str) -> dict[str, Any]:
    return ok(api(base, "GET", f"/api/layouts/{layout_id}/cells/{cell}"))


def png(width: int = PHOTO_WIDTH, height: int = PHOTO_HEIGHT, tone: int = 90) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    rows = b"".join(b"\x00" + bytes([(tone + y) % 256]) * width for y in range(height))
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


def jpeg(width: int = 64, height: int = 32, orientation: int = 6) -> bytes:
    def seg(marker: int, payload: bytes) -> bytes:
        return bytes([0xFF, marker]) + struct.pack(">H", len(payload) + 2) + payload
    tiff = b"MM\x00*\x00\x00\x00\x08" + struct.pack(">H", 1) + struct.pack(">HHIHH", 0x0112, 3, 1, orientation, 0) + struct.pack(">I", 0)
    sof = b"\x08" + struct.pack(">HH", height, width) + b"\x01\x01\x11\x00"
    table = bytes([1] + [0] * 15) + b"\x00"
    blocks = math.ceil(width / 8) * math.ceil(height / 8)
    return b"".join([
        b"\xff\xd8", seg(0xE1, b"Exif\x00\x00" + tiff), seg(0xDB, b"\x00" + b"\x01" * 64), seg(0xC0, sof),
        seg(0xC4, b"\x00" + table), seg(0xC4, b"\x10" + table), seg(0xDA, b"\x01\x01\x00\x00\x3f\x00"),
        bytes((blocks * 2 + 7) // 8), b"\xff\xd9",
    ])


def image_size(data: bytes) -> tuple[int, int]:
    if data.startswith(b"\x89PNG"):
        return struct.unpack(">II", data[16:24])
    assert data.startswith(b"\xff\xd8"), "upright working image is neither PNG nor JPEG"
    at = 2
    for _ in range(100):
        marker, size = data[at + 1], struct.unpack(">H", data[at + 2:at + 4])[0]
        if marker in (0xC0, 0xC1, 0xC2):
            height, width = struct.unpack(">HH", data[at + 5:at + 9])
            return width, height
        at += 2 + size
    pytest.fail("upright JPEG carries no frame header")


def upload(base: str, site_id: str, data: bytes, *, name: str | None = None, declared: str = "application/octet-stream", key: str | None = None) -> httpx.Response:
    headers = {"Content-Type": declared}
    if name is not None:
        headers["X-File-Name"] = quote(name, safe="")
    return api(base, "POST", f"/api/sites/{site_id}/photo", key=key or idempotency_key(), headers=headers, content=data)


def point(x: int, y: int, across: str, down: str) -> dict[str, Any]:
    return {"pixel": {"x": x, "y": y}, "wall": {"across": Q(across), "down": Q(down)}}


def rectify(base: str, site_id: str, points: list[dict[str, Any]], check: dict[str, Any]) -> httpx.Response:
    body = {"points": points, "check": check}
    first = api(base, "POST", f"/api/sites/{site_id}/rectification", body)
    if first.status_code != 422 or first.json().get("code") != "validation_failed":
        return first
    errors = first.json()["errors"]
    if not any("pixel" in k for k in errors) or "That point is outside the photo." in errors.values():
        return first
    def texted(p: dict[str, Any]) -> dict[str, Any]:
        return {**p, "pixel": {"x": str(p["pixel"]["x"]), "y": str(p["pixel"]["y"])}}
    return api(base, "POST", f"/api/sites/{site_id}/rectification", {"points": [texted(p) for p in points], "check": texted(check)})


def corner_points(width: str, height: str) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    w, h = Decimal(width), Decimal(height)
    points = [point(0, 0, "0", "0"), point(320, 0, width, "0"), point(320, 240, width, height), point(0, 240, "0", height)]
    return points, point(160, 120, str(w / 2), str(h / 2))


def rectified(base: str, width: str = "24", height: str = "12") -> dict[str, Any]:
    site = new_site(base, width, height)
    ok(upload(base, site["id"], png()), 201)
    points, check = corner_points(width, height)
    ok(rectify(base, site["id"], points, check))
    return ok(api(base, "GET", f"/api/sites/{site['id']}"))


def desk_answers(wiremock: WireMock, expires: int = 1800) -> NS:
    code = uid()
    desk = NS(ref=f"H-{code}", serial=f"KV-{code}", confirm=f"/v1/holds/H-{code}/confirm", release=f"/v1/holds/H-{code}/release")
    wiremock.stub("POST", "/v1/holds", status=201, json={
        "holdRef": desk.ref, "status": "held", "expiresInSeconds": expires, "serial": desk.serial, "loggedHours": 0,
    })
    return desk


def ask_hold(base: str, days: int = 1, day: str | None = None) -> httpx.Response:
    return api(base, "POST", "/api/holds", {"model": "VK-20", "from": day or far_day(), "days": days}, key=idempotency_key())


def held_hold(base: str, wiremock: WireMock, expires: int = 1800, days: int = 1) -> NS:
    desk = desk_answers(wiremock, expires)
    desk.hold = ok(ask_hold(base, days), 201)
    desk.id = desk.hold["id"]
    return desk


def hold_of(base: str, hold_id: str) -> dict[str, Any]:
    return ok(api(base, "GET", f"/api/holds/{hold_id}"))


def request_of(entry: dict[str, Any]) -> dict[str, Any]:
    return entry.get("request", entry)


def header_of(entry: dict[str, Any], name: str) -> str | None:
    for key, value in request_of(entry).get("headers", {}).items():
        if key.casefold() == name.casefold():
            if isinstance(value, dict):
                value = value.get("values", [None])
            return value[0] if isinstance(value, list) else value
    return None


def body_of(entry: dict[str, Any]) -> Any:
    request = request_of(entry)
    if request.get("bodyAsJson") is not None:
        return request["bodyAsJson"]
    return json.loads(request.get("body") or "null")


def asked_for(wiremock: WireMock, day: str) -> list[dict[str, Any]]:
    return [e for e in wiremock.requests("/v1/holds", "POST") if (body_of(e) or {}).get("from") == day]


class Stream:

    def __init__(self, base: str, path: str = "/api/events", last_event_id: str | None = None) -> None:
        self.url, self.frames, self.comments = base + path, [], []
        self.status: int | None = None
        self.connected, self.closed = threading.Event(), threading.Event()
        self.headers = {"Last-Event-ID": last_event_id} if last_event_id is not None else {}
        self._stop = False
        threading.Thread(target=self._run, daemon=True).start()
        self.connected.wait(COMMENT_S + DELIVERY_S)

    def _run(self) -> None:
        try:
            timeout = httpx.Timeout(HTTP_TIMEOUT_S, read=None)
            with httpx.stream("GET", self.url, headers=self.headers, timeout=timeout) as resp:
                self.status = resp.status_code
                self.connected.set()
                frame: dict[str, Any] = {}
                for line in resp.iter_lines():
                    if self._stop:
                        return
                    if line.startswith(":"):
                        self.comments.append(time.monotonic())
                    elif line == "":
                        if "data" in frame:
                            frame["payload"] = json.loads(frame["data"])
                            frame["arrived"] = time.monotonic()
                            self.frames.append(frame)
                        frame = {}
                    else:
                        field, _, value = line.partition(":")
                        frame[field] = value[1:] if value.startswith(" ") else value
        except (httpx.HTTPError, ValueError, RuntimeError):
            pass
        finally:
            self.connected.set()
            self.closed.set()

    def stop(self) -> None:
        self._stop = True

    def of(self, kind: str, **data: Any) -> list[dict[str, Any]]:
        found = []
        for frame in list(self.frames):
            payload = frame["payload"]
            if payload["type"] == kind and all(payload["data"].get(k) == v for k, v in data.items()):
                found.append(payload)
        return found


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def healthy(url: str) -> bool:
    with contextlib.suppress(httpx.TransportError):
        return httpx.get(url + "/api/health", timeout=DESK_LIMIT_MS / 1000).status_code == 200
    return False


def kill_group(proc: subprocess.Popen[bytes], sig: int = signal.SIGKILL) -> None:
    with contextlib.suppress(ProcessLookupError):
        os.killpg(proc.pid, sig)


@contextlib.contextmanager
def app_copy(**overrides: str) -> Iterator[NS]:
    port = free_port()
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), **overrides}
    serve = json.loads(Path("/app/run.json").read_text())["serve"]
    log = tempfile.NamedTemporaryFile(suffix=".log", delete=False)
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    copy = NS(url=f"http://127.0.0.1:{port}", proc=proc, tail=lambda: Path(log.name).read_bytes()[-2000:].decode("utf-8", "replace"))
    try:
        deadline = time.monotonic() + BOOT_DEADLINE_S
        while time.monotonic() < deadline and not healthy(copy.url):
            if proc.poll() is not None:
                pytest.fail(f"extra app copy exited with {proc.returncode}: {copy.tail()}")
            _TICK.wait(TICK_S)
        assert healthy(copy.url), f"extra app copy never answered GET /api/health: {copy.tail()}"
        yield copy
    finally:
        kill_group(proc)
        proc.wait()
        log.close()


class TcpRelay:

    def __init__(self, host: str, port: int) -> None:
        self.target, self.port, self.conns, self.listener = (host, port), free_port(), [], None
        self.expires = time.monotonic() + BOOT_DEADLINE_S * 5
        self.start()

    def start(self) -> None:
        listener = socket.socket()
        listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        listener.bind(("127.0.0.1", self.port))
        listener.listen(64)
        self.listener = listener
        threading.Thread(target=self._accept, args=(listener,), daemon=True).start()

    def _accept(self, listener: socket.socket) -> None:
        while time.monotonic() < self.expires:
            try:
                near, _ = listener.accept()
                far = socket.create_connection(self.target)
            except OSError:
                return
            self.conns += [near, far]
            threading.Thread(target=self._pump, args=(near, far), daemon=True).start()
            threading.Thread(target=self._pump, args=(far, near), daemon=True).start()

    def _pump(self, source: socket.socket, sink: socket.socket) -> None:
        with contextlib.suppress(OSError):
            while time.monotonic() < self.expires:
                data = source.recv(65536)
                if not data:
                    break
                sink.sendall(data)
        for side in (source, sink):
            with contextlib.suppress(OSError):
                side.shutdown(socket.SHUT_RDWR)

    def cut(self) -> None:
        with contextlib.suppress(OSError):
            self.listener.shutdown(socket.SHUT_RDWR)
        self.listener.close()
        for conn in self.conns:
            with contextlib.suppress(OSError):
                conn.shutdown(socket.SHUT_RDWR)
            conn.close()
        self.conns = []


def role(scope: Page | Locator, kind: str, name: str) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True)


def settled(page: Page, check: Callable[[], None], seconds: float = UI_DEADLINE_S, what: str = "screen state") -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        advance(page, 100)
        try:
            check()
            return
        except (AssertionError, PlaywrightError) as error:
            last = error
    pytest.fail(f"{what} never appeared: {last}")


def shows(page: Page, locator: Locator, seconds: float = UI_DEADLINE_S) -> None:
    settled(page, lambda: expect(locator).to_be_visible(timeout=PAGE_POLL_MS), seconds, str(locator))


def says(page: Page, locator: Locator, text: Any, seconds: float = UI_DEADLINE_S) -> None:
    settled(page, lambda: expect(locator).to_contain_text(text, timeout=PAGE_POLL_MS), seconds, f"{locator} saying {text}")


def heading(page: Page, sentence: str) -> Locator:
    return page.get_by_role("heading", level=1, name=sentence, exact=True)


def choose_photo(page: Page, name: str, data: bytes, mime: str) -> None:
    with page.expect_file_chooser() as chooser:
        click(role(page, "button", "Choose wall photo"))
    chooser.value.set_files({"name": name, "mimeType": mime, "buffer": data})


def fill_point(page: Page, group: str, spec: dict[str, Any]) -> None:
    area = role(page, "group", group)
    fill(role(area, "spinbutton", "Pixel across"), str(spec["pixel"]["x"]))
    fill(role(area, "spinbutton", "Pixel down"), str(spec["pixel"]["y"]))
    fill(role(area, "textbox", "Metres across"), spec["wall"]["across"]["text"])
    fill(role(area, "textbox", "Metres down"), spec["wall"]["down"]["text"])


def fill_rectification(page: Page, points: list[dict[str, Any]], check: dict[str, Any]) -> None:
    for number, spec in enumerate(points, start=1):
        fill_point(page, f"Point {number}", spec)
    fill_point(page, "Check point", check)
    click(role(page, "button", "Rectify wall"))


def save_reading(page: Page, cell: str, value: str, unit: str) -> None:
    form = role(page, "form", "Reading")
    fill(role(form, "textbox", "Cell"), cell)
    fill(role(form, "textbox", "Value"), value)
    select(role(form, "combobox", "Unit"), unit)
    click(role(form, "button", "Save reading"))


def described_text(locator: Locator) -> str:
    return locator.evaluate(
        "el => (el.getAttribute('aria-describedby') || '').split(/\\s+/)"
        ".map(id => (document.getElementById(id) || {}).textContent || '').join(' ')"
    )


def inside(locator: Locator) -> bool:
    return locator.evaluate("el => el.contains(document.activeElement)")


def spin(locator: Locator) -> Decimal:
    value = locator.get_attribute("aria-valuenow") or locator.input_value()
    return Decimal(value.replace(",", "."))


def focus_grid(page: Page, cell: str) -> None:
    grid = role(page, "grid", "Wall cells")
    shows(page, grid)
    role(grid, "gridcell", cell).focus()
    if not inside(grid):
        grid.focus()


def address_cell(page: Page) -> str | None:
    match = re.search(r"[?&]cell=([A-Z]+\d+)", page.url)
    return match.group(1) if match else None


def cell_copy(cell: dict[str, Any]) -> str:
    if cell["band"] == "No reading":
        return f"Cell {cell['cell']}, no reading."
    contrast = cell["contrastText"].split()[0]
    tail = ", blended." if cell["blended"] else "."
    return f"Cell {cell['cell']}, {contrast} to 1, {cell['pixelsPerMetre']} pixels per metre{tail}"


def cell_sentence(cell: dict[str, Any]) -> str:
    if cell["band"] == "No reading":
        return "THIS WALL HAS NO READING HERE"
    return f"THIS WALL READS AT {cell['contrastText'].split()[0]} TO 1"


def matches_server(page: Page, base: str, layout_id: str, cell: str) -> None:
    def check() -> None:
        assert address_cell(page) == cell, f"address names {address_cell(page)}, expected {cell}"
        data = layout_cell(base, layout_id, cell)
        expect(role(page, "status", "Cell reading")).to_have_text(cell_copy(data), timeout=PAGE_POLL_MS)
        expect(heading(page, cell_sentence(data))).to_be_visible(timeout=PAGE_POLL_MS)
    settled(page, check, what=f"cell {cell} figures matching the server")


def free_sentence(free: int) -> str:
    return "THE SHELF HOLDS 1 FREE BODY" if free == 1 else f"THE SHELF HOLDS {free} FREE BODIES"


def shows_free(page: Page, base: str, model: str = "VK-20", on_shelf: bool = False) -> None:
    def check() -> None:
        data = shelf(base)
        expect(role(page, "list", "Free bodies")).to_contain_text(f"{model} {model_free(data, model)} free", timeout=PAGE_POLL_MS)
        if on_shelf:
            expect(heading(page, free_sentence(data["freeBodies"]))).to_be_visible(timeout=PAGE_POLL_MS)
    settled(page, check, what="free counts equal to GET /api/kit/shelf")


def wrong_clock(page: Page, when: str) -> None:
    page.clock.set_fixed_time(when)
    page.reload()


def holds_sentence(n: int) -> str:
    return "1 BODY ON HOLD" if n == 1 else f"{n} BODIES ON HOLD"


def held_count(base: str) -> int:
    return sum(1 for h in ok(api(base, "GET", "/api/holds"))["items"] if state(h["status"]) == "held")


def test_wf_survey_wall_journey(browser: Browser, app_url: str) -> None:
    down = outage("APP_MINIO_DOWN_URL")
    name = unique("Wall")[0]
    picture = png()
    with open_app(browser, app_url + "/sites") as page:
        form = role(page, "form", "New site")
        shows(page, form)
        fill(role(form, "textbox", "Site name"), name)
        fill(role(form, "textbox", "Wall width"), "8")
        fill(role(form, "textbox", "Wall height"), "6")
        select(role(form, "combobox", "Length unit"), "m")
        fill(role(form, "textbox", "Show time"), SHOW_AT)
        click(role(form, "button", "Save site"))
        link = role(role(page, "table", "Walls"), "link", name)
        shows(page, link)
        assert (link.get_attribute("href") or "").endswith("/survey")
        click(link)
        shows(page, heading(page, "NO WALL YET"))
        site_id = re.search(r"/sites/([^/]+)/survey", page.url).group(1)

        with open_app(browser, f"{down}/sites/{site_id}/survey") as broken:
            shows(broken, role(broken, "button", "Choose wall photo"))
            choose_photo(broken, "wall.png", picture, "image/png")
            says(broken, role(broken, "alert", "Outage"),
                 "The wall store isn't answering. Your readings and layouts still work; the photo was not kept.")
        problem(api(app_url, "GET", f"/api/sites/{site_id}/photo"), 404, "not_found")
        shows(page, heading(page, "NO WALL YET"))

        choose_photo(page, "wall.png", picture, "image/png")
        photo = role(page, "img", "Upright wall photo")
        shows(page, photo)
        pixel_across = role(role(page, "group", "Check point"), "spinbutton", "Pixel across")
        pixel_across.focus()
        box = photo.bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        settled(page, lambda: expect(pixel_across).not_to_have_value("", timeout=PAGE_POLL_MS), what="clicked pixel in the focused group")
        assert PHOTO_WIDTH / 4 < spin(pixel_across) < PHOTO_WIDTH * 3 / 4, "clicking the photo's middle fills a pixel near the middle of its width"

        points, check = corner_points("8", "6")
        fill_rectification(page, points, check)
        says(page, role(page, "status", "Rectify"), "Rectified to 0.000 m.")
        shows(page, heading(page, "THIS WALL IS MEASURED TO 0.000 M"))
        digest = hashlib.sha256(picture).hexdigest()
        assert S3().get(f"photos/{site_id}/{digest}") == picture
        assert S3().keys(f"tiles/{site_id}/{digest}/"), "rectified tiles reached the wall store"

        page.goto(app_url + "/sites")
        wall = role(role(page, "table", "Walls"), "link", name)
        shows(page, wall)
        assert re.search(rf"/sites/{site_id}/layouts/[^/?]+", wall.get_attribute("href") or "")
        click(wall)
        shows(page, role(page, "grid", "Wall cells"))
        shows(page, role(page, "img", "Show-night loupe"))
        expect(heading(page, "NO WALL YET")).to_have_count(0)


def test_wf_survey_wall_refusal_recovery(browser: Browser, app_url: str) -> None:
    site = new_site(app_url, "8", "6")["id"]
    with open_app(browser, f"{app_url}/sites/{site}/survey") as page:
        shows(page, role(page, "button", "Choose wall photo"))
        choose_photo(page, "wall.jpg", b"not an image at all", "image/jpeg")
        says(page, role(page, "alert", "Outage"), "That file isn't a JPEG or PNG photo, whatever its name says.")
        assert S3().keys(f"photos/{site}/") == []
        choose_photo(page, "wall.png", png(), "image/png")
        shows(page, role(page, "img", "Upright wall photo"))
        points, _ = corner_points("8", "6")
        fill_rectification(page, points, point(160, 120, "5", "3"))
        says(page, role(page, "alert", "Outage"), "Those points disagree by 1.000 m; the limit is 0.050 m.")
        shows(page, heading(page, "NO WALL YET"))
        assert ok(api(app_url, "GET", f"/api/sites/{site}"))["rectified"] is False
        fill_rectification(page, points, point(160, 120, "4", "3"))
        says(page, role(page, "status", "Rectify"), "Rectified to 0.000 m.")
        shows(page, heading(page, "THIS WALL IS MEASURED TO 0.000 M"))
    assert ok(api(app_url, "GET", f"/api/sites/{site}"))["residualMetres"] == "0.000"


def six(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.000001"), rounding=ROUND_HALF_EVEN))


NUMBER_CASES = {
    "comma": ["1,8", "lx", None],
    "point": ["1.8", "lx", None],
    "zero": ["0", "lx", None],
    "zero_comma": ["0,5", "lx", None],
    "eighteen_chars": ["123456789012345678", "lx", None],
    "comma_and_point": ["1.200,5", "lx", "Write the number without thousands separators, for example 1200,5."],
    "two_commas": ["1,200,5", "lx", "Write the number without thousands separators, for example 1200,5."],
    "two_points": ["1.200.5", "lx", "Write the number without thousands separators, for example 1200,5."],
    "space": ["1 200", "lx", "Write the number without thousands separators, for example 1200,5."],
    "apostrophe": ["1'200", "lx", "Write the number without thousands separators, for example 1200,5."],
    "letters": ["abc", "lx", "Enter a number such as 1,8."],
    "exponent": ["1e3", "lx", "Enter a number such as 1,8."],
    "empty": ["", "lx", "Enter a number such as 1,8."],
    "no_leading_digit": [",5", "lx", "Enter a number such as 1,8."],
    "no_trailing_digit": ["5,", "lx", "Enter a number such as 1,8."],
    "leading_zero": ["01", "lx", "Enter a number such as 1,8."],
    "negative_zero": ["-0", "lx", "Enter a number such as 1,8."],
    "plus": ["+1", "lx", "Enter a number such as 1,8."],
    "nineteen_chars": ["1234567890123456789", "lx", "Enter a number such as 1,8."],
    "below_zero": ["-5", "lx", "A reading can't be below zero."],
}


def test_wf_reading_units_entry(browser: Browser, app_url: str) -> None:
    site = new_site(app_url)["id"]
    with open_app(browser, f"{app_url}/sites/{site}/survey") as page:
        shows(page, role(page, "form", "Reading"))
        save_reading(page, "C3", "1,8", "fc")
        rows = role(page, "table", "Readings").get_by_role("row")
        settled(page, lambda: expect(rows.filter(has_text=re.compile(r"1,8\s*fc"))).to_have_count(1, timeout=PAGE_POLL_MS),
                what="readings row with entered text and unit")
        says(page, role(page, "status", "Sync"), "Waiting to sync 0")
    item = readings(app_url, site, "C3")[0]
    assert item["entered"] == {"text": "1,8", "unit": "fc"} and item["canonicalLux"] == six(Decimal("1.8") * FC_LUX)


def test_wf_reading_units_replay(browser: Browser, app_url: str) -> None:
    site = new_site(app_url)["id"]
    op = {"operationId": str(uuid.uuid4()), "cell": "D4", "value": Q("77,25", "lx"), "capturedAt": OLD_CAPTURE}
    path = f"/api/sites/{site}/readings/sync"
    first = ok(api(app_url, "POST", path, {"operations": [op]}))["results"][0]
    again = ok(api(outage("APP_PEER_URL"), "POST", path, {"operations": [op]}))["results"][0]
    assert (first["status"], again["status"]) == ("applied", "duplicate")
    with open_app(browser, f"{app_url}/sites/{site}/survey") as page:
        rows = role(page, "table", "Readings").get_by_role("row").filter(has_text="77,25")
        settled(page, lambda: expect(rows).to_have_count(1, timeout=PAGE_POLL_MS), what="one row for the replayed reading")
    assert len(readings(app_url, site, "D4")) == 1


def test_wf_reading_units_stale_sentence(browser: Browser, app_url: str) -> None:
    short = outage("APP_SHORT_URL")
    site = rectified(short, "12", "8")
    layout_id = site["layouts"][0]["id"]
    sync(short, site["id"], ("C3", "30", "lx", OLD_CAPTURE))
    poll(lambda: ok(api(short, "GET", f"/api/sites/{site['id']}"))["stale"], SHORT_SECONDS * 2, "site never read stale")
    with open_app(browser, f"{short}/sites/{site['id']}/layouts/{layout_id}?cell=C3") as page:
        sentence = page.get_by_text("These readings are stale; street lighting and foliage change.", exact=True).first
        shows(page, sentence)
        title = page.get_by_role("heading", level=1)
        assert sentence.bounding_box()["y"] >= title.bounding_box()["y"], "the stale sentence sits below the heading"
    assert layout_cell(short, layout_id, "C3")["stale"] is True


@contextlib.contextmanager
def open_offline_app(browser: Browser, url: str) -> Iterator[Page]:
    with contextlib.closing(browser.new_context(viewport={"width": 1280, "height": 800}, has_touch=True, service_workers="allow")) as context:
        context.add_init_script(path=Path(__file__).parent / "instrument.js")
        tab = context.new_page()
        tab.set_default_timeout(5000)
        tab.set_default_navigation_timeout(15000)
        now = int(time.time())
        tab.clock.install(time=now)
        tab.clock.pause_at(now + 10)
        tab.goto(url)
        yield tab


def expect_worker(page: Page) -> None:
    active = page.evaluate("navigator.serviceWorker.getRegistration().then(found => Boolean(found && found.active))")
    assert active, "no active service worker"


def test_wf_offline_walk_queue_and_return(browser: Browser, app_url: str) -> None:
    site = new_site(app_url)["id"]
    url = f"{app_url}/sites/{site}/survey"
    with open_offline_app(browser, url) as page:
        context = page.context
        page.set_viewport_size({"width": 375, "height": 812})
        says(page, role(page, "status", "Sync"), "Waiting to sync 0")
        settled(page, lambda: expect_worker(page), what="an active service worker keeping the app shell")
        context.set_offline(True)
        page.reload()
        shows(page, role(page, "form", "Reading"))
        save_reading(page, "E5", "5,5", "lx")
        save_reading(page, "E6", "6,5", "lx")
        says(page, role(page, "status", "Sync"), "Waiting to sync 2")
        click(role(page, "button", "Sync now"))
        says(page, role(page, "status", "Sync"), "Waiting to sync 2")
        assert readings(app_url, site, "E5") == []

        page.close()
        page = context.new_page()
        page.goto(url)
        says(page, role(page, "status", "Sync"), "Waiting to sync 2")

        forwarded = {"count": 0}
        def lose_answer(route: Any) -> None:
            route.fetch()
            forwarded["count"] += 1
            route.abort()
        pattern = "**/api/sites/*/readings/sync"
        context.route(pattern, lose_answer)
        context.set_offline(False)
        def sent() -> bool:
            advance(page, 500)
            if forwarded["count"] == 0:
                with contextlib.suppress(PlaywrightError):
                    role(page, "button", "Sync now").click(timeout=PAGE_POLL_MS)
            return forwarded["count"] > 0
        poll(sent, API_DEADLINE_S, "the queue never sent readings once signal returned")
        poll(lambda: len(readings(app_url, site, "E5")) == 1, API_DEADLINE_S, "the forwarded send never reached the server")
        says(page, role(page, "status", "Sync"), "Waiting to sync 2")

        context.unroute(pattern)
        click(role(page, "button", "Sync now"))
        says(page, role(page, "status", "Sync"), "Waiting to sync 0")
        assert len(readings(app_url, site, "E5")) == 1 and len(readings(app_url, site, "E6")) == 1
        rows = role(page, "table", "Readings").get_by_role("row")
        settled(page, lambda: expect(rows.filter(has_text="5,5")).to_have_count(1, timeout=PAGE_POLL_MS), what="one row after retry")


def test_wf_offline_walk_rejected_reading(browser: Browser, app_url: str) -> None:
    site = new_site(app_url)["id"]
    with open_app(browser, f"{app_url}/sites/{site}/survey") as page:
        shows(page, role(page, "form", "Reading"))
        save_reading(page, "F6", "1.200,5", "lx")
        sync_status = role(page, "status", "Sync")
        says(page, sync_status, "Waiting to sync 0")
        says(page, sync_status, "Needs fixing 1")
        value = role(role(page, "form", "Reading"), "textbox", "Value")
        settled(page, lambda: assert_contains(described_text(value), "Write the number without thousands separators, for example 1200,5."),
                what="field copy tied to Value")
    assert readings(app_url, site, "F6") == []


def assert_contains(text: str, part: str) -> None:
    assert part in text, f"{part!r} not in {text!r}"


def test_wf_offline_walk_other_screen(browser: Browser, app_url: str) -> None:
    site = new_site(app_url)["id"]
    peer = outage("APP_PEER_URL")
    with open_app(browser, f"{peer}/sites/{site}/survey") as other:
        table = role(other, "table", "Readings")
        shows(other, table)
        with open_app(browser, f"{app_url}/sites/{site}/survey") as page:
            shows(page, role(page, "form", "Reading"))
            save_reading(page, "G7", "88,5", "lx")
            says(page, role(page, "status", "Sync"), "Waiting to sync 0")
        rows = table.get_by_role("row").filter(has_text="88,5")
        settled(other, lambda: expect(rows).to_have_count(1, timeout=PAGE_POLL_MS), what="the reading on the other screen")
    assert len(readings(app_url, site, "G7")) == 1
    assert readings(app_url, site, "G7")[0]["canonicalLux"] == six(Decimal("88.5"))


def test_wf_kit_ledger_two_screens(browser: Browser, app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    site = new_site(app_url, "5", "5")
    layout_id = site["layouts"][0]["id"]
    with open_app(browser, app_url + "/kit") as shelf_page, open_app(browser, f"{peer}/sites/{site['id']}/layouts/{layout_id}") as other:
        form = role(shelf_page, "form", "Record a movement")
        shows(shelf_page, form)
        shows(other, role(other, "list", "Free bodies"))
        before = model_free(shelf(app_url))
        serial = f"T-{uid()}"
        select(role(form, "combobox", "Movement"), "Bought")
        fill(role(form, "textbox", "Serial"), serial)
        fill(role(form, "textbox", "Model"), "VK-20")
        click(role(form, "button", "Record movement"))
        says(shelf_page, role(shelf_page, "status", "Kit"), "Movement recorded.")
        assert model_free(shelf(app_url)) == before + 1
        shows_free(shelf_page, app_url, on_shelf=True)
        shows_free(other, peer)
        assert any(b["serial"] == serial and b["free"] for b in ok(api(peer, "GET", f"/api/layouts/{layout_id}/picker"))["bodies"])

        select(role(form, "combobox", "Movement"), "Sent to site")
        fill(role(form, "textbox", "Serial"), serial)
        select(role(form, "combobox", "Destination site"), site["name"])
        click(role(form, "button", "Record movement"))
        poll(lambda: shelf_item(app_url, serial)["location"] == f"site:{site['id']}", API_DEADLINE_S, "movement form never moved the serial")
        assert model_free(shelf(app_url)) == before
        shows_free(shelf_page, app_url, on_shelf=True)
        shows_free(other, peer)

        sent = journal(app_url, serial)[0]
        reverse = role(shelf_page, "button", f"Reverse {sent['id']}")
        shows(shelf_page, reverse)
        settled(shelf_page, lambda: click(reverse), what="Reverse free to press while the live list settles")
        poll(lambda: journal(app_url, serial)[0]["reversesId"] == sent["id"], API_DEADLINE_S, "Reverse never posted a reversing movement")
        assert model_free(shelf(app_url)) == before + 1
        shows_free(shelf_page, app_url, on_shelf=True)
        shows_free(other, peer)


def test_wf_kit_ledger_bindings_and_fold(browser: Browser, app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    made = ready(app_url)
    serial = made.serials[0]
    with open_app(browser, app_url + "/kit") as page:
        shows(page, role(page, "list", "Free bodies"))
        before = model_free(shelf(app_url))
        assert shelf_item(app_url, serial)["free"] is True
        sheet = ok(issue(app_url, made.layout), 201)
        assert shelf_item(app_url, serial)["free"] is False
        assert shelf_item(app_url, serial)["location"] == "shelf", "a binding does not move the ledger"
        assert model_free(shelf(app_url)) == before - 1
        shows_free(page, app_url, on_shelf=True)
        picker = ok(api(app_url, "GET", f"/api/layouts/{made.layout}/picker"))
        assert model_free(picker) == model_free(shelf(app_url))
        assert next(b for b in picker["bodies"] if b["serial"] == serial)["free"] is False
        ok(api(app_url, "POST", f"/api/sheets/{sheet['id']}/withdraw", {}))
        assert shelf_item(app_url, serial)["free"] is True
        assert model_free(shelf(app_url)) == before
        shows_free(page, app_url, on_shelf=True)
    data = shelf(app_url)
    bodies = [i for i in data["items"] if i["kind"] == "body"]
    assert data["freeBodies"] == sum(1 for i in bodies if i["free"])
    for entry in data["models"]:
        assert entry["free"] == sum(1 for i in data["items"] if i["model"] == entry["model"] and i["free"])
    assert [m["model"] for m in data["models"]] == sorted(m["model"] for m in data["models"])
    assert [i["serial"] for i in data["items"]] == sorted(i["serial"] for i in data["items"])
    poll(lambda: api(app_url, "GET", "/api/kit/shelf").content == api(peer, "GET", "/api/kit/shelf").content,
         API_DEADLINE_S, "two processes never returned byte-identical shelves")


def test_wf_kit_ledger_refused_moves(browser: Browser, app_url: str) -> None:
    serial = buy(app_url)
    with open_app(browser, app_url + "/kit") as page:
        form = role(page, "form", "Record a movement")
        shows(page, form)
        before = shelf(app_url)["freeBodies"]
        band = role(page, "alert", "Outage")
        select(role(form, "combobox", "Movement"), "Bought")
        fill(role(form, "textbox", "Serial"), serial)
        fill(role(form, "textbox", "Model"), "VK-20")
        click(role(form, "button", "Record movement"))
        says(page, band, "That serial is already in your kit.")
        ghost = f"T-{uid()}"
        select(role(form, "combobox", "Movement"), "Retired")
        fill(role(form, "textbox", "Serial"), ghost)
        click(role(form, "button", "Record movement"))
        says(page, band, "That serial isn't in your kit.")
        assert shelf(app_url)["freeBodies"] == before
    assert len(journal(app_url, serial)) == 1 and journal(app_url, ghost) == []
    problem(move(app_url, "hired_in", serial), 409, "hired_in_by_hold_only", "A hired body arrives through a confirmed hold.")
    problem(move(app_url, "retired", f"T-{uid()}"), 422, "serial_unknown", "That serial isn't in your kit.")


def open_dialog_by_key(page: Page, cell: str) -> Locator:
    focus_grid(page, cell)
    page.keyboard.press("p")
    dialog = role(page, "dialog", "Place a body")
    shows(page, dialog)
    return dialog


def test_wf_layout_placing_keyboard(browser: Browser, app_url: str) -> None:
    site = rectified(app_url, "12", "8")
    layout_id = site["layouts"][0]["id"]
    body, lens = buy(app_url), buy(app_url, "LS-13")
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}?cell=D7") as page:
        grid = role(page, "grid", "Wall cells")
        dialog = open_dialog_by_key(page, "D7")
        assert spin(role(dialog, "spinbutton", "Aim across")) == Decimal("2")
        assert spin(role(dialog, "spinbutton", "Aim down")) == Decimal("3.5")
        assert spin(role(dialog, "spinbutton", "Body across")) == Decimal("2")
        assert spin(role(dialog, "spinbutton", "Body down")) == Decimal("3.5")
        assert role(dialog, "textbox", "Standoff").input_value() == "18"
        assert role(dialog, "textbox", "Zoom ratio").input_value() == "1,3"
        assert role(dialog, "textbox", "Shift across").input_value() == "0"
        assert role(dialog, "textbox", "Shift down").input_value() == "0"
        for press in ["Tab"] * 22 + ["Shift+Tab"] * 22:
            page.keyboard.press(press)
            assert inside(dialog), f"{press} left the open dialog"
        page.keyboard.press("Escape")
        settled(page, lambda: expect(dialog).to_have_count(0, timeout=PAGE_POLL_MS), what="dialog closed by Escape")
        assert inside(grid), "focus returns to the grid after a shortcut"
        assert layout_of(app_url, layout_id)[0]["placements"] == [], "Escape closes without saving"

        in_wall = role(page, "region", "Wall").get_by_role("button")
        if in_wall.count():
            in_wall.first.focus()
            page.keyboard.press("p")
            shows(page, dialog)
            page.keyboard.press("Escape")
            settled(page, lambda: expect(dialog).to_have_count(0, timeout=PAGE_POLL_MS), what="dialog closed by Escape")

        dialog = open_dialog_by_key(page, "D7")
        select(role(dialog, "combobox", "Body"), f"{body} VK-20")
        select(role(dialog, "combobox", "Lens"), f"{lens} LS-13")
        select(role(dialog, "combobox", "Circuit"), "Mains")
        across = role(dialog, "spinbutton", "Aim across")
        across.focus()
        page.keyboard.press("ArrowUp")
        assert spin(across) == Decimal("2.5")
        down = role(dialog, "spinbutton", "Aim down")
        down.focus()
        page.keyboard.press("ArrowDown")
        assert spin(down) == Decimal("3")
        save = role(dialog, "button", "Save placement")
        save.focus()
        page.keyboard.press("Enter")
        settled(page, lambda: expect(dialog).to_have_count(0, timeout=PAGE_POLL_MS), what="dialog closed by saving")
        view = poll(lambda: layout_of(app_url, layout_id)[0], API_DEADLINE_S, "layout never loaded")
        placed = view["placements"][0]
        assert placed["bodySerial"] == body and placed["lensSerial"] == lens
        assert Decimal(placed["aimAcross"]) == Decimal("2.5") and Decimal(placed["aimDown"]) == 3
        assert Decimal(placed["bodyAcross"]) == 2

        aim_button = role(role(page, "list", "Placements"), "button", f"Aim {body}")
        shows(page, aim_button)
        aim_button.focus()
        page.keyboard.press("Enter")
        aim_dialog = role(page, "dialog", f"Aim {body}")
        shows(page, aim_dialog)
        assert spin(role(aim_dialog, "spinbutton", "Aim across")) == Decimal("2.5")
        page.keyboard.press("Escape")
        settled(page, lambda: expect(aim_button).to_be_focused(timeout=PAGE_POLL_MS), what="focus back on the opener")
        page.keyboard.press("Enter")
        shows(page, aim_dialog)
        across = role(aim_dialog, "spinbutton", "Aim across")
        across.focus()
        page.keyboard.press("ArrowUp")
        role(aim_dialog, "button", "Save placement").focus()
        page.keyboard.press("Enter")
        poll(lambda: Decimal(layout_of(app_url, layout_id)[0]["placements"][0]["aimAcross"]) == 3, API_DEADLINE_S, "Aim dialog never changed the aim")
        assert layout_of(app_url, layout_id)[0]["version"] == view["version"] + 1

        remove = role(page, "button", f"Remove {body}")
        shows(page, remove)
        click(remove)
        poll(lambda: layout_of(app_url, layout_id)[0]["placements"] == [], API_DEADLINE_S, "Remove never removed the placement")


def test_wf_layout_placing_three_widths(browser: Browser, app_url: str) -> None:
    site = rectified(app_url, "48", "12")
    layout_id = site["layouts"][0]["id"]
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}?cell=D7") as page:
        for index, (width, height) in enumerate(((375, 812), (768, 1024), (1280, 800))):
            body, lens = buy(app_url), buy(app_url, "LS-13")
            page.set_viewport_size({"width": width, "height": height})
            page.reload()
            dialog = open_dialog_by_key(page, "D7")
            layout(page)
            select(role(dialog, "combobox", "Body"), f"{body} VK-20")
            select(role(dialog, "combobox", "Lens"), f"{lens} LS-13")
            for name in ("Aim across", "Body across"):
                fill(role(dialog, "spinbutton", name), str(6 + 14 * index))
            save = role(dialog, "button", "Save placement")
            save.scroll_into_view_if_needed()
            box = save.bounding_box()
            assert box["x"] >= 0 and box["x"] + box["width"] <= width, f"Save placement overflows at {width}"
            assert box["y"] + box["height"] <= height, f"Save placement falls below the screen at {height}"
            click(save)
            poll(lambda: any(p["bodySerial"] == body for p in layout_of(app_url, layout_id)[0]["placements"]),
                 API_DEADLINE_S, f"Save placement at {width} wrote nothing")


def test_wf_layout_placing_stale_window(browser: Browser, app_url: str) -> None:
    site = rectified(app_url, "48", "12")
    layout_id = site["layouts"][0]["id"]
    circuit = site["circuits"][0]["id"]
    mine, my_lens = buy(app_url), buy(app_url, "LS-13")
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}?cell=D7") as page:
        page.context.route("**/api/events*", lambda route: route.abort())
        page.reload()
        dialog = open_dialog_by_key(page, "D7")
        select(role(dialog, "combobox", "Body"), f"{mine} VK-20")
        select(role(dialog, "combobox", "Lens"), f"{my_lens} LS-13")
        theirs = buy(app_url)
        ok(post_placement(outage("APP_PEER_URL"), layout_id, place_input(buy(app_url, "LS-13"), circuit, theirs, aim=("30", "6"))), 201)
        click(role(dialog, "button", "Save placement"))
        says(page, role(page, "alert", "Outage"), "This layout changed in another window. Reload it to carry on.")
    placed = [p["bodySerial"] for p in layout_of(app_url, layout_id)[0]["placements"]]
    assert placed == [theirs], "the stale save must not overwrite or join the newer layout"


def test_wf_layout_placing_picker_counts(browser: Browser, app_url: str) -> None:
    site = rectified(app_url, "24", "12")
    layout_id = site["layouts"][0]["id"]
    other = new_site(app_url, "5", "5")["id"]
    body, lens, away = buy(app_url), buy(app_url, "LS-13"), buy(app_url)
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}?cell=D7") as page:
        shows_free(page, app_url)
        before = model_free(shelf(app_url))
        picker = ok(api(app_url, "GET", f"/api/layouts/{layout_id}/picker"))
        assert model_free(picker) == before
        ok(move(app_url, "sent_to_site", away, siteId=other), 201)
        assert model_free(shelf(app_url)) == before - 1
        shows_free(page, app_url)
        picker = ok(api(app_url, "GET", f"/api/layouts/{layout_id}/picker"))
        assert model_free(picker) == before - 1
        dialog = open_dialog_by_key(page, "D7")
        select(role(dialog, "combobox", "Body"), f"{body} VK-20")
        select(role(dialog, "combobox", "Lens"), f"{lens} LS-13")
        click(role(dialog, "button", "Save placement"))
        poll(lambda: layout_of(app_url, layout_id)[0]["placements"], API_DEADLINE_S, "the picked body never reached the layout")
    problem(post_placement(app_url, layout_id, place_input(buy(app_url, "LS-13"), site["circuits"][0]["id"], away, aim=("20", "6"))), 409, "body_not_available",
            f"{away} isn't on the shelf or at this site.")


def expected_lux(lumens: float, aim: tuple[float, float], cell: tuple[float, float], recess: float = 0.0, share: float = 1.0) -> float:
    standoff, ratio = 18.0, 1.3
    width = standoff / ratio
    area = width * width * NATIVE_HEIGHT / NATIVE_WIDTH
    lateral2 = (cell[0] - aim[0]) ** 2 + (cell[1] - aim[1]) ** 2
    depth = standoff + recess
    distance2 = lateral2 + depth * depth
    recess_share = max(0.0, 1 - recess * (math.sqrt(lateral2) / depth) / 0.5)
    return lumens / area * (standoff * standoff / distance2) * (depth / math.sqrt(distance2)) * recess_share * share


def near(value: float, expected: float) -> None:
    assert abs(value - expected) <= FOUR_DECIMALS, f"{value} is not {expected} at four decimals"


def png_row(data: bytes, row: int) -> tuple[list[int], tuple[int, int, int, int]]:
    at, compressed, header = 8, b"", (0, 0, 0, 0)
    for _ in range(100000):
        size = struct.unpack(">I", data[at:at + 4])[0]
        kind, payload = data[at + 4:at + 8], data[at + 8:at + 8 + size]
        if kind == b"IHDR":
            width, height, depth, colour = struct.unpack(">IIBB", payload[:10])
            header = (width, height, depth, colour)
        if kind == b"IDAT":
            compressed += payload
        if kind == b"IEND":
            break
        at += 12 + size
    raw = zlib.decompress(compressed)
    width = header[0]
    previous = [0] * width
    for y in range(row + 1):
        start = y * (width + 1)
        kind, line = raw[start], raw[start + 1:start + 1 + width]
        if kind == 0:
            current = list(line)
        elif kind == 2:
            current = [(b + p) & 255 for b, p in zip(line, previous)]
        else:
            current = [0] * width
            for x in range(width):
                a = current[x - 1] if x else 0
                b, c = previous[x], previous[x - 1] if x else 0
                if kind == 1:
                    guess = a
                elif kind == 3:
                    guess = (a + b) // 2
                else:
                    p = a + b - c
                    pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                    guess = a if pa <= pb and pa <= pc else (b if pb <= pc else c)
                current[x] = (line[x] + guess) & 255
        previous = current
    return previous, header


def finished_job(base: str, layout_id: str) -> dict[str, Any]:
    job = ok(api(base, "POST", f"/api/layouts/{layout_id}/mask-jobs", {}, key=idempotency_key()), 202)
    def done() -> Any:
        current = ok(api(base, "GET", f"/api/mask-jobs/{job['id']}"))
        return current if current["phase"] == "done" else None
    return poll(done, LEASE_DEADLINE_S, "mask job never reached phase done")


ORDER_HOOK = """() => {
  window.__order = [];
  const original = history.replaceState.bind(history);
  history.replaceState = (...args) => { window.__order.push('address'); return original(...args); };
  for (const el of document.querySelectorAll('[role=status]')) {
    if (el.getAttribute('aria-label') === 'Cell reading' || el.textContent.startsWith('Cell ')) {
      new MutationObserver(() => window.__order.push('status')).observe(el, {childList: true, characterData: true, subtree: true});
    }
  }
}"""


def wait_wall(page: Page) -> Locator:
    wall = role(page, "region", "Wall")
    shows(page, role(page, "grid", "Wall cells"))
    shows(page, role(page, "img", "Show-night loupe"))
    return wall


def test_wf_loupe_proof_pointer_sequence(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}{SEED_PATH}?cell=F12") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        wall = wait_wall(page)
        loupe = role(page, "img", "Show-night loupe")
        start_cell = address_cell(page)
        page.evaluate(ORDER_HOOK)
        entries = page.evaluate("history.length")
        box = wall.bounding_box()

        target = (box["x"] + box["width"] * 0.3, box["y"] + box["height"] * 0.3)
        start = loupe.bounding_box()
        page.mouse.move(*target)
        path = motion(loupe, GLIDE_MAX_MS)
        distinct = {tuple(sorted(sample.items())) for sample in path}
        assert len(distinct) >= 2, "the frame must travel to the cell, not stay put"
        first_cell = None
        def arrived() -> None:
            nonlocal first_cell
            first_cell = address_cell(page)
            assert first_cell and first_cell != start_cell, f"address still names {first_cell}"
        settled(page, arrived, what="address gaining the pointer's cell")
        matches_server(page, app_url, SEED_LAYOUT, first_cell)
        assert page.evaluate("history.length") == entries, "the address changes without a history entry"
        lit = decode(capture(loupe))
        moved = loupe.bounding_box()
        assert moved != start, "the frame follows the pointer"
        reach = moved["width"] + moved["height"]
        centre = (moved["x"] + moved["width"] / 2, moved["y"] + moved["height"] / 2)
        assert abs(centre[0] - target[0]) + abs(centre[1] - target[1]) <= reach, "the frame sits over the pointer's cell"

        page.evaluate("window.__order.length = 0")
        page.mouse.move(box["x"] + box["width"] * 0.75, box["y"] + box["height"] * 0.3)
        advance(page, GLIDE_MAX_MS)
        def second() -> None:
            current = address_cell(page)
            assert current and current != first_cell
        settled(page, second, what="address following the pointer")
        second_cell = address_cell(page)
        matches_server(page, app_url, SEED_LAYOUT, second_cell)
        order = page.evaluate("window.__order")
        assert "address" in order, f"the address never changed through replaceState: {order}"
        if "status" in order:
            assert order.index("address") < order.index("status"), f"address precedes the announcement: {order}"

        before = loupe.bounding_box()
        advance(page, GLIDE_MAX_MS)
        assert loupe.bounding_box() == before, "the frame settles inside its glide"

        page.goto(f"{app_url}{SEED_PATH}?cell=A1")
        wait_wall(page)
        hatched = decode(capture(role(page, "img", "Show-night loupe")))
        clipped = (lit.width, lit.height) != (hatched.width, hatched.height)
        assert clipped or difference(lit, hatched) > 0, "the loupe redraws for a hatched cell"

        page.goto(f"{app_url}{SEED_PATH}?cell={second_cell}")
        wait_wall(page)
        shows(page, heading(page, cell_sentence(layout_cell(app_url, SEED_LAYOUT, second_cell))))
        page.reload()
        wait_wall(page)
        shows(page, heading(page, cell_sentence(layout_cell(app_url, SEED_LAYOUT, second_cell))))
        assert address_cell(page) == second_cell

        page.goto(f"{app_url}{SEED_PATH}?cell=ZZ999")
        wait_wall(page)
        title = page.get_by_role("heading", level=1)
        lowest = min(c["contrast"] for c in ok(api(app_url, "GET", f"/api/layouts/{SEED_LAYOUT}/cells"))["items"] if c["contributions"])
        says(page, title, f"THIS WALL READS AT {lowest:.1f} TO 1")


def rolling(page: Page, title: Locator) -> bool:
    title.evaluate(
        "el => { window.__h = new Set([el.textContent]); new MutationObserver(() => { window.__h.add(el.textContent); }).observe(el, "
        "{subtree: true, childList: true, characterData: true, attributes: true}); }"
    )
    page.keyboard.press("ArrowRight")
    active = False
    for _ in range(8):
        advance(page, 25)
        active = active or bool(animations(title))
    return active or page.evaluate("window.__h.size") >= 4


def test_wf_loupe_proof_grid_walk(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}{SEED_PATH}?cell=A1") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        wait_wall(page)
        grid = role(page, "grid", "Wall cells")
        rows = grid.get_attribute("aria-rowcount") or str(grid.get_by_role("row").count())
        columns = grid.get_attribute("aria-colcount") or str(grid.get_by_role("row").first.get_by_role("gridcell").count())
        assert int(rows) == SEED_ROWS and int(columns) == SEED_COLUMNS
        focus_grid(page, "A1")
        page.keyboard.press("ArrowRight")
        matches_server(page, app_url, SEED_LAYOUT, "B1")
        page.keyboard.press("ArrowLeft")
        matches_server(page, app_url, SEED_LAYOUT, "A1")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowUp")
        matches_server(page, app_url, SEED_LAYOUT, "A1")
        page.keyboard.press("ArrowDown")
        matches_server(page, app_url, SEED_LAYOUT, "A2")
        page.keyboard.press("Shift+ArrowRight")
        matches_server(page, app_url, SEED_LAYOUT, "F2")
        page.keyboard.press("Shift+ArrowUp")
        matches_server(page, app_url, SEED_LAYOUT, "F1")
        page.keyboard.press("Shift+ArrowLeft")
        matches_server(page, app_url, SEED_LAYOUT, "A1")
        page.keyboard.press("End")
        matches_server(page, app_url, SEED_LAYOUT, "AV1")
        page.keyboard.press("ArrowRight")
        matches_server(page, app_url, SEED_LAYOUT, "AV1")
        page.keyboard.press("Home")
        matches_server(page, app_url, SEED_LAYOUT, "A1")
        page.keyboard.press("Control+End")
        matches_server(page, app_url, SEED_LAYOUT, "AV24")
        page.keyboard.press("ArrowDown")
        matches_server(page, app_url, SEED_LAYOUT, "AV24")
        page.keyboard.press("Control+Home")
        matches_server(page, app_url, SEED_LAYOUT, "A1")

        page.goto(f"{app_url}{SEED_PATH}?cell=W12")
        wait_wall(page)
        focus_grid(page, "W12")
        page.keyboard.press("ArrowRight")
        matches_server(page, app_url, SEED_LAYOUT, "X12")
        assert layout_cell(app_url, SEED_LAYOUT, "X12")["blended"] is True
        says(page, role(page, "status", "Cell reading"), ", blended.")

        page.keyboard.press("f")
        stage = role(page, "dialog", "Full wall")
        shows(page, stage)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert inside(stage), "Tab left the open stage"
        page.keyboard.press("Escape")
        settled(page, lambda: expect(stage).to_have_count(0, timeout=PAGE_POLL_MS), what="stage closed by Escape")
        advance(page, STAGE_MAX_MS)
        assert inside(grid), "focus returns to the grid after the F shortcut"

        opener = role(page, "button", "Open the full wall")
        click(opener)
        shows(page, stage)
        close = role(stage, "button", "Close the full wall")
        click(close)
        settled(page, lambda: expect(stage).to_have_count(0, timeout=PAGE_POLL_MS), what="stage closed by its button")
        advance(page, STAGE_MAX_MS)
        settled(page, lambda: expect(opener).to_be_focused(timeout=PAGE_POLL_MS), what="focus back on the slot")


def test_wf_loupe_proof_touch_pan(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}{SEED_PATH}?cell=M12") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
        page.reload()
        wall = wait_wall(page)
        loupe = role(page, "img", "Show-night loupe")
        region = wall.bounding_box()
        before = loupe.bounding_box()
        assert abs(before["x"] + before["width"] / 2 - (region["x"] + region["width"] / 2)) <= before["width"] / 2
        assert abs(before["y"] + before["height"] / 2 - (region["y"] + region["height"] / 2)) <= before["height"] / 2
        start_cell = address_cell(page)
        scroll = page.evaluate("window.scrollY")
        x, y = region["x"] + region["width"] / 2, region["y"] + region["height"] / 2
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for step in range(1, 9):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x - 8 * step, "y": y - 6 * step}]})
            advance(page, 30)
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        def panned() -> None:
            current = address_cell(page)
            assert current and current != start_cell, f"address still names {current}"
        settled(page, panned, what="the drag bringing a new cell under the loupe")
        matches_server(page, app_url, SEED_LAYOUT, address_cell(page))
        assert page.evaluate("window.scrollY") == scroll, "a drag begun on the wall never scrolls the page"
        after = loupe.bounding_box()
        assert abs(after["x"] - before["x"]) < 2 and abs(after["y"] - before["y"]) < 2, "the loupe stays fixed while the wall pans"
        layout(page)


def stub_quote(wiremock: WireMock, rate: int, days: int, net: int, vat: int, total: int) -> None:
    wiremock.stub("POST", "/v1/quotes", json={
        "dayRateCents": rate, "days": days, "factorPermille": FACTORS[days], "netCents": net, "vatCents": vat, "totalCents": total,
    })


def half_even(numerator: int, denominator: int) -> int:
    quotient, remainder = divmod(numerator, denominator)
    twice = remainder * 2
    if twice > denominator or (twice == denominator and quotient % 2):
        quotient += 1
    return quotient


def test_wf_hire_hold_ui_journey(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    site = rectified(app_url, "24", "12")
    layout_id = site["layouts"][0]["id"]
    lens = buy(app_url, "LS-13")
    desk = desk_answers(wiremock)
    day = far_day()
    with open_app(browser, app_url + "/hire") as page:
        form = role(page, "form", "Check stock")
        shows(page, form)
        select(role(form, "combobox", "Model"), "VK-20")
        fill(role(form, "textbox", "First day"), day)
        fill(role(form, "spinbutton", "Days"), "1")
        click(role(form, "button", "Check stock"))
        poll(lambda: any(e["query"].get("from") == day for e in wiremock.requests("/v1/stock", "GET")), API_DEADLINE_S, "Check stock never asked the desk")
        click(role(page, "button", "Ask for a hold"))
        status = role(page, "status", "Hire")
        says(page, status, re.compile(r"Held for (30:00|29:\d\d)"))
        hold = next(h for h in ok(api(app_url, "GET", "/api/holds"))["items"] if h["holdRef"] == desk.ref)
        assert len(asked_for(wiremock, day)) == 1
        settled(page, lambda: expect(heading(page, holds_sentence(held_count(app_url)))).to_be_visible(timeout=PAGE_POLL_MS), what="holds sentence")

        with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}?cell=D7") as bench:
            dialog = open_dialog_by_key(bench, "D7")
            select(role(dialog, "combobox", "Body"), f"{desk.serial} VK-20 on hold")
            select(role(dialog, "combobox", "Lens"), f"{lens} LS-13")
            click(role(dialog, "button", "Save placement"))
            poll(lambda: layout_of(app_url, layout_id)[0]["placements"], API_DEADLINE_S, "the on-hold option drew no placement")
            placed = layout_of(app_url, layout_id)[0]["placements"][0]
            assert placed["status"] == "On hold" and placed["holdId"] == hold["id"]
            assert journal(app_url, desk.serial) == [], "drawing a hold hires nothing"

            click(role(page, "button", f"Quote {hold['id']}"))
            says(page, status, "Quote € 199,65 including 21% VAT.")
            click(role(page, "button", f"Confirm {hold['id']}"))
            says(page, status, f"Hired in. {desk.serial} is on your shelf.")
            assert len(wiremock.requests(desk.confirm)) == 1
            assert [m["kind"] for m in journal(app_url, desk.serial)] == ["hired_in"]
            assert state(hold_of(app_url, hold["id"])["status"]) == HIRED_IN
            settled(bench, lambda: expect(role(role(bench, "list", "Placements"), "button", f"Aim {desk.serial}")).to_be_visible(timeout=PAGE_POLL_MS),
                    what="the placement bodied on the open layout")
    assert layout_of(app_url, layout_id)[0]["placements"][0]["status"] == "Bodied"


def test_wf_hire_hold_wrong_device_clock(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    hold = held_hold(app_url, wiremock)
    for clock in (WRONG_CLOCK_AHEAD, WRONG_CLOCK_BEHIND):
        with open_app(browser, app_url + "/hire") as page:
            wrong_clock(page, clock)
            row = role(page, "table", "Holds").get_by_role("row").filter(has=role(page, "button", f"Confirm {hold.id}"))
            says(page, row, re.compile(r"Held for (30:00|29:\d\d)"))
            says(page, row, "Held")
    assert state(hold_of(app_url, hold.id)["status"]) == "held"


def test_wf_hire_outage_ui_band(browser: Browser, app_url: str) -> None:
    down = outage("APP_WIREMOCK_DOWN_URL")
    day = far_day()
    with open_app(browser, down + "/hire") as page:
        form = role(page, "form", "Check stock")
        shows(page, form)
        select(role(form, "combobox", "Model"), "VK-20")
        fill(role(form, "textbox", "First day"), day)
        fill(role(form, "spinbutton", "Days"), "1")
        click(role(page, "button", "Ask for a hold"))
        says(page, role(page, "alert", "Outage"), "The hire desk isn't answering. Your shelf and layouts still work; nothing has been held.")
        assert all(state(h["status"]) == "released" for h in ok(api(down, "GET", "/api/holds"))["items"] if h["from"] == day)
        click(role(page.get_by_role("navigation"), "link", "Shelf"))
        kit = role(page, "form", "Record a movement")
        shows(page, kit)
        serial = f"T-{uid()}"
        select(role(kit, "combobox", "Movement"), "Bought")
        fill(role(kit, "textbox", "Serial"), serial)
        fill(role(kit, "textbox", "Model"), "VK-20")
        click(role(kit, "button", "Record movement"))
        says(page, role(page, "status", "Kit"), "Movement recorded.")
    assert shelf_item(app_url, serial)["free"] is True


def test_wf_hire_outage_ask_ambiguous(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    desk = NS(ref=f"H-{uid()}", serial=f"KV-{uid()}")
    wiremock.fault("POST", "/v1/holds")
    day = far_day()
    with open_app(browser, app_url + "/hire") as page:
        form = role(page, "form", "Check stock")
        shows(page, form)
        select(role(form, "combobox", "Model"), "VK-20")
        fill(role(form, "textbox", "First day"), day)
        fill(role(form, "spinbutton", "Days"), "1")
        click(role(page, "button", "Ask for a hold"))
        says(page, role(page, "alert", "Outage"), "The hire desk isn't answering. Your shelf and layouts still work; nothing has been held.")
        says(page, role(page, "status", "Hire"), "Asked; still checking with the hire desk")
        hold = next(h for h in ok(api(app_url, "GET", "/api/holds"))["items"] if h["from"] == day)
        assert state(hold["status"]) == "asked"
        poll(lambda: len(asked_for(wiremock, day)) >= 2, DESK_SETTLE_S * 2, "an ambiguous ask was never replayed")
        wiremock.stub("POST", "/v1/holds", status=201, json={
            "holdRef": desk.ref, "status": "held", "expiresInSeconds": 1800, "serial": desk.serial, "loggedHours": 0,
        })
        poll(lambda: state(hold_of(app_url, hold["id"])["status"]) == "released", DESK_SETTLE_S + SWEEP_S * 2, "a granted hold was never handed back")
        says(page, role(page, "status", "Hire"), "Released.")
    keys = {header_of(e, "Idempotency-Key") for e in asked_for(wiremock, day)}
    assert len(keys) == 1 and None not in keys, "replays carry the same key"
    poll(lambda: len(wiremock.requests(f"/v1/holds/{desk.ref}/release", "POST")) == 1, API_DEADLINE_S, "no release reached the desk")
    assert journal(app_url, desk.serial) == []


def test_wf_hire_outage_confirm_ambiguous(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    hold = held_hold(app_url, wiremock)
    ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
    wiremock.fault("POST", hold.confirm)
    with open_app(browser, app_url + "/hire") as page:
        button = role(page, "button", f"Confirm {hold.id}")
        shows(page, button)
        click(button)
        pending = "The hire desk isn't answering. Your hold stands and the confirmation is still being checked."
        says(page, role(page, "alert", "Outage"), pending)
        assert state(hold_of(app_url, hold.id)["status"]) == "held"
        assert journal(app_url, hold.serial) == [], "an ambiguous confirm is never guessed as hired"
        problem(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()), 503, "hire_desk_pending", pending)
        poll(lambda: len(wiremock.requests(hold.confirm)) >= 2, DESK_SETTLE_S * 2, "an unsettled confirm was never replayed")
        wiremock.stub("POST", hold.confirm, json={"status": "hired"})
        says(page, role(page, "status", "Hire"), f"Hired in. {hold.serial} is on your shelf.", DESK_SETTLE_S * 2)
    assert state(hold_of(app_url, hold.id)["status"]) == HIRED_IN
    assert len({header_of(e, "Idempotency-Key") for e in wiremock.requests(hold.confirm)}) == 1
    assert [m["kind"] for m in journal(app_url, hold.serial)] == ["hired_in"]


def test_wf_hire_outage_confirm_lapses(app_url: str, wiremock: WireMock) -> None:
    hold = held_hold(app_url, wiremock, expires=4)
    ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
    wiremock.stub("POST", hold.confirm, status=200, json={"status": "hired"}, delay_ms=DESK_LIMIT_MS + 1000)
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()), 503, "hire_desk_pending")
    wiremock.fault("POST", hold.confirm)
    def past() -> Any:
        current = hold_of(app_url, hold.id)
        return current if instant(current["serverNow"]) >= instant(current["expiresAt"]) else None
    current = poll(past, API_DEADLINE_S, "the hold window never ended")
    assert state(current["status"]) == "held" and current["remainingSeconds"] == 0, "an unsettled confirm keeps the hold Held"
    wiremock.stub("POST", hold.confirm, status=409, json={"error": "hold_expired"})
    poll(lambda: state(hold_of(app_url, hold.id)["status"]) == "lapsed", DESK_SETTLE_S + SWEEP_S * 2, "hold_expired never settled as Lapsed")
    assert journal(app_url, hold.serial) == []
    assert state(hold_of(outage("APP_PEER_URL"), hold.id)["status"]) == "lapsed"


def test_wf_hold_lapse_device_clock(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    live = held_hold(app_url, wiremock)
    gone = held_hold(app_url, wiremock, expires=2)
    poll(lambda: state(hold_of(app_url, gone.id)["status"]) == "lapsed", API_DEADLINE_S, "short hold never lapsed")
    with open_app(browser, app_url + "/hire") as page:
        wrong_clock(page, WRONG_CLOCK_BEHIND)
        table = role(page, "table", "Holds")
        says(page, table, "Lapsed")
        row = table.get_by_role("row").filter(has=role(page, "button", f"Quote {live.id}"))
        says(page, row, re.compile(r"Held for (30:00|29:\d\d)"))
    with open_app(browser, app_url + "/hire") as page:
        wrong_clock(page, WRONG_CLOCK_AHEAD)
        row = role(page, "table", "Holds").get_by_role("row").filter(has=role(page, "button", f"Quote {live.id}"))
        says(page, row, re.compile(r"Held for (30:00|29:\d\d)"))
    assert state(hold_of(app_url, live.id)["status"]) == "held"


def test_wf_hold_lapse_placement_returns(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    site = rectified(app_url, "24", "12")
    layout_id, circuit = site["layouts"][0]["id"], site["circuits"][0]["id"]
    hold = held_hold(app_url, wiremock, expires=8)
    drawn = ok(post_placement(app_url, layout_id, place_input(buy(app_url, "LS-13"), circuit, hold=hold.id)), 201)
    stream = Stream(app_url)
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}") as page, open_app(browser, app_url + "/hire") as hire:
        placements = role(page, "list", "Placements")
        shows(page, placements)
        settled(hire, lambda: expect(heading(hire, holds_sentence(held_count(app_url)))).to_be_visible(timeout=PAGE_POLL_MS), what="holds sentence")
        says(page, placements, "Needs a body", 8 + LAPSE_COMMIT_S + UI_DEADLINE_S)
        shows(page, role(placements, "button", "Aim placement 1"))
        shows(page, role(placements, "button", "Remove placement 1"))
        settled(hire, lambda: expect(heading(hire, holds_sentence(held_count(app_url)))).to_be_visible(timeout=PAGE_POLL_MS), what="holds sentence after lapse")
    after, _ = layout_of(app_url, layout_id)
    assert after["placements"][0]["status"] == "Needs a body" and after["placements"][0]["holdId"] is None
    assert after["version"] == drawn["version"] + 1
    poll(lambda: stream.of("layout.changed", id=layout_id, version=after["version"]), DELIVERY_S * 3, "lapse wrote no layout.changed")
    stream.stop()


def test_wf_hold_lapse_release_returns(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    made = ready(app_url, 0)
    hold = held_hold(app_url, wiremock)
    version = ok(post_placement(app_url, made.layout, place_input(buy(app_url, "LS-13"), made.circuit, hold=hold.id)), 201)["version"]
    with open_app(browser, app_url + "/hire") as page:
        button = role(page, "button", f"Release {hold.id}")
        shows(page, button)
        click(button)
        says(page, role(page, "status", "Hire"), "Released.")
    assert len(wiremock.requests(hold.release, "POST")) == 1
    assert state(hold_of(app_url, hold.id)["status"]) == "released" and hold_of(app_url, hold.id)["remainingSeconds"] == 0
    after, _ = layout_of(app_url, made.layout)
    assert after["placements"][0]["status"] == "Needs a body" and after["version"] == version + 1
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()), 409, "hold_not_held", "This hold is no longer held.")


def test_wf_issue_sheet_ui_happy(browser: Browser, app_url: str) -> None:
    site = rectified(app_url, "24", "12")
    layout_id = site["layouts"][0]["id"]
    serial, lens = buy(app_url), buy(app_url, "LS-13")
    ok(post_placement(app_url, layout_id, place_input(lens, site["circuits"][0]["id"], serial)), 201)
    free = model_free(shelf(app_url))
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}") as page:
        shows_free(page, app_url)
        click(role(page, "button", "Issue rig sheet"))
        says(page, role(page, "status", "Issue"), "Issued.", PRESS_LIMIT_MS / 1000)
        link = role(page, "link", "Open the sheet")
        shows(page, link)
        shows_free(page, app_url)
        click(link)
        shows(page, heading(page, "THIS SHEET IS ISSUED"))
        sheet_id = re.search(r"/sheets/([^/?]+)", page.url).group(1)
        sheet = ok(api(app_url, "GET", f"/api/sheets/{sheet_id}"))
        box = role(page, "textbox", "Technician link")
        settled(page, lambda: assert_contains(box.input_value(), sheet["techUrl"]), what="technician link on the sheet page")
    assert state(sheet["status"]) == "issued" and sheet["version"] == 1 and sheet["linkActive"] is True
    assert sheet["key"] == f"sheets/{sheet_id}/rig-sheet.pdf"
    stored = S3().get(sheet["key"])
    assert stored.startswith(b"%PDF") and pdf_pages(stored) >= 1
    assert hashlib.sha256(stored).hexdigest() == sheet["sha256"] and len(stored) == sheet["bytes"]
    assert api(app_url, "GET", f"/api/sheets/{sheet_id}/pdf").content == stored
    assert model_free(shelf(app_url)) == free - 1


def test_wf_issue_sheet_press_outage(browser: Browser, app_url: str) -> None:
    made = ready(outage("APP_GOTENBERG_DOWN_URL"))
    down = outage("APP_GOTENBERG_DOWN_URL")
    site = made.id
    ok(upload(app_url, site, png()), 201)
    points, check = corner_points("48", "12")
    ok(rectify(app_url, site, points, check))
    before = set(S3().keys("sheets/"))
    with open_app(browser, f"{down}/sites/{site}/layouts/{made.layout}") as page:
        click(role(page, "button", "Issue rig sheet"))
        says(page, role(page, "alert", "Outage"), "The rig sheet press isn't answering. Your layout is unchanged; nothing has been issued.")
        expect(role(page, "link", "Open the sheet")).to_have_count(0)
    assert state(layout_of(app_url, made.layout)[0]["sheetStatus"]) == DRAFT
    assert set(S3().keys("sheets/")) == before
    assert shelf_item(app_url, made.serials[0])["free"] is True


def _swallow_issue(base: str, layout_id: str, key: str) -> None:
    with contextlib.suppress(httpx.HTTPError):
        issue(base, layout_id, key)


def test_wf_tech_link_open_and_tick(browser: Browser, app_url: str) -> None:
    made = issued(app_url)
    with open_app(browser, f"{app_url}/sheets/{made.sheet['id']}") as artist, open_app(browser, f"{app_url}/rig/{made.token}") as tech:
        title = heading(tech, "THIS RIG HAS 1 CIRCUIT TO PROVE")
        shows(tech, title)
        expect(tech.get_by_role("navigation")).to_have_count(0)
        shows(tech, role(tech, "link", "Open the PDF"))
        circuits = role(artist, "list", "Circuits")
        shows(artist, circuits)
        box = role(role(tech, "list", "Circuits"), "checkbox", "Mains is live")
        settled(tech, lambda: click(box), what="the Mains box free to press while the live list settles")
        says(tech, role(tech, "status", "Rig"), "Mains marked live.")
        poll(lambda: ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))["circuits"][0]["live"], API_DEADLINE_S, "tick never reached the sheet")
        live = ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))["circuits"][0]
        assert live["live"] is True and live["confirmedAt"]
        shows(tech, title)
        settled(tech, lambda: click(box), what="the Mains box free to press while the live list settles")
        says(tech, role(tech, "status", "Rig"), "Mains marked not live.")
    assert ok(api(app_url, "GET", f"/api/rig/{made.token}"))["circuits"][0]["live"] is False


def assert_differs(now: str, before: str) -> None:
    assert now != before, "the list did not change"


def test_wf_tech_link_ended_copy(browser: Browser, app_url: str) -> None:
    made = issued(app_url)
    with open_app(browser, f"{app_url}/rig/{made.token}") as page:
        shows(page, heading(page, "THIS RIG HAS 1 CIRCUIT TO PROVE"))
        assert api(app_url, "DELETE", f"/api/sheets/{made.sheet['id']}/link").status_code == 204
        copy = "This rig sheet link has ended. Ask the projection artist for a new one."
        settled(page, lambda: expect(page.get_by_text(copy).first).to_be_visible(timeout=PAGE_POLL_MS), LINK_STREAM_CLOSE_S + UI_DEADLINE_S, "ended copy")
        page.goto(f"{app_url}/rig/{uid()}{uid()}{uid()}")
        settled(page, lambda: expect(page.get_by_text("This rig sheet link doesn't exist.").first).to_be_visible(timeout=PAGE_POLL_MS), what="unknown link copy")
    problem(api(app_url, "GET", f"/api/rig/{made.token}"), 410, "link_ended")


def test_wf_frozen_masks_out_of_step(browser: Browser, app_url: str) -> None:
    made = issued(app_url)
    stored = S3().get(made.sheet["key"])
    with open_app(browser, f"{app_url}/sheets/{made.sheet['id']}") as artist, open_app(browser, f"{app_url}/rig/{made.token}") as tech:
        shows(artist, heading(artist, "THIS SHEET IS ISSUED"))
        shows(tech, heading(tech, "THIS RIG HAS 1 CIRCUIT TO PROVE"))
        view, tag = layout_of(app_url, made.layout)
        ok(api(outage("APP_PEER_URL"), "PATCH", f"/api/layouts/{made.layout}/placements/{view['placements'][0]['id']}", {"ratio": "1.4"}, headers={"If-Match": tag}))
        shows(artist, heading(artist, "THIS SHEET IS OUT OF STEP"))
        copy = "This sheet is out of step with the layout. Ask the artist before rigging."
        says(tech, role(tech, "status", "Rig"), copy)
        says(tech, role(tech, "alert", "Outage"), copy)
        settled(tech, lambda: click(role(role(tech, "list", "Circuits"), "checkbox", "Mains is live")), what="the Mains box free to press while the live list settles")
        poll(lambda: ok(api(app_url, "GET", f"/api/rig/{made.token}"))["circuits"][0]["live"], API_DEADLINE_S, "an Out of step sheet can still be ticked")
    assert state(ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))["status"]) == OUT_OF_STEP
    assert S3().get(made.sheet["key"]) == stored
    assert api(app_url, "GET", f"/api/rig/{made.token}/sheet.pdf").content == stored


def test_wf_frozen_masks_reissue_atomic(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    made = issued(app_url)
    view, tag = layout_of(app_url, made.layout)
    ok(api(app_url, "PATCH", f"/api/layouts/{made.layout}/placements/{view['placements'][0]['id']}", {"ratio": "1.4"}, headers={"If-Match": tag}))
    wiremock.stub("POST", "/forms/chromium/convert/html", status=500, body="press fault")
    problem(issue(outage("APP_PRESS_FAULT_URL"), made.layout), 503, "press_unavailable")
    assert state(ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))["status"]) == OUT_OF_STEP
    ok(api(app_url, "GET", f"/api/rig/{made.token}"))
    second = ok(issue(app_url, made.layout), 201)
    assert second["version"] == 2 and state(second["status"]) == "issued" and second["id"] != made.sheet["id"]
    assert state(ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))["status"]) == "withdrawn"
    assert S3().get(made.sheet["key"]).startswith(b"%PDF") and S3().get(second["key"]).startswith(b"%PDF")
    problem(api(app_url, "GET", f"/api/rig/{made.token}"), 410, "link_ended")
    problem(issue(app_url, made.layout), 409, "sheet_already_issued")
    with open_app(browser, f"{app_url}/sheets/{made.sheet['id']}") as page:
        shows(page, heading(page, "THIS SHEET IS WITHDRAWN"))


def test_wf_frozen_masks_withdraw_link(browser: Browser, app_url: str) -> None:
    made = issued(app_url)
    with open_app(browser, f"{app_url}/sheets/{made.sheet['id']}") as page:
        button = role(page, "button", "Withdraw sheet")
        shows(page, button)
        assert shelf_item(app_url, made.serials[0])["free"] is False
        click(button)
        shows(page, heading(page, "THIS SHEET IS WITHDRAWN"))
    problem(api(app_url, "GET", f"/api/rig/{made.token}"), 410, "link_ended")
    assert shelf_item(app_url, made.serials[0])["free"] is True and shelf_item(app_url, made.lenses[0])["free"] is True
    problem(api(app_url, "POST", f"/api/sheets/{made.sheet['id']}/withdraw", {}), 409, "sheet_withdrawn")
    assert S3().get(made.sheet["key"]).startswith(b"%PDF")
    assert ok(issue(app_url, made.layout), 201)["version"] == 2, "withdrawn sheets keep counting"


def build_masks(page: Page) -> str:
    with page.expect_response(lambda r: "/mask-jobs" in r.url and r.request.method == "POST") as info:
        click(role(page, "button", "Build masks"))
    return info.value.json()["id"]


def test_wf_frozen_masks_ui_build(browser: Browser) -> None:
    slow = outage("APP_SLOW_MASKS_URL")
    made = issued(slow, 2)
    with open_app(browser, f"{slow}/sheets/{made.sheet['id']}") as page:
        shows(page, role(page, "button", "Build masks"))
        cancelled = build_masks(page)
        says(page, role(page, "status", "Masks"), re.compile(r"(queued|rendering|storing): \d of 3"))
        click(role(page, "button", "Cancel masks"))
        poll(lambda: ok(api(slow, "GET", f"/api/mask-jobs/{cancelled}"))["phase"] == "cancelled", API_DEADLINE_S, "Cancel masks never cancelled the job")
        says(page, role(page, "status", "Masks"), re.compile(r"cancelled: \d of 3"))
        job = build_masks(page)
        bar = role(page, "progressbar", "Mask bundle")
        shows(page, bar)
        link = role(page, "link", "Download masks")
        shows(page, link, LEASE_DEADLINE_S)
        says(page, role(page, "status", "Masks"), "done: 3 of 3")
        downloaded = api(slow, "GET", link.get_attribute("href")).content
    current = ok(api(slow, "GET", f"/api/mask-jobs/{job}"))
    assert downloaded == S3("-slow").get(current["key"]) and hashlib.sha256(downloaded).hexdigest() == current["sha256"]


def test_wf_cross_cutting_live_screens(browser: Browser, app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    site = rectified(app_url, "24", "12")
    layout_id = site["layouts"][0]["id"]
    with open_app(browser, f"{peer}/kit") as page, open_app(browser, f"{peer}/sites/{site['id']}/layouts/{layout_id}") as bench:
        shows_free(page, peer, on_shelf=True)
        serial = buy(app_url)
        shows_free(page, peer, on_shelf=True)
        ok(post_placement(app_url, layout_id, place_input(buy(app_url, "LS-13"), site["circuits"][0]["id"], serial)), 201)
        shows(bench, role(role(bench, "list", "Placements"), "button", f"Aim {serial}"))
        page.context.set_offline(True)
        advance(page, 1000)
        page.context.set_offline(False)
        buy(app_url)
        shows_free(page, peer, on_shelf=True)


def hero_signature(title: Locator, *properties: str) -> list[str]:
    return title.evaluate(
        "(el, props) => [el, ...el.querySelectorAll('*')].map(n => { const s = getComputedStyle(n);"
        " return props.map(p => s.getPropertyValue(p)).join('|') + '|' + Math.round(n.getBoundingClientRect().width * 10); })",
        list(properties),
    )


def test_wf_cross_cutting_copy(browser: Browser, app_url: str, wiremock: WireMock) -> None:
    with open_app(browser, app_url + "/sites") as page:
        form = role(page, "form", "New site")
        shows(page, form)
        count = len(ok(api(app_url, "GET", "/api/sites"))["items"])
        fill(role(form, "textbox", "Site name"), "")
        fill(role(form, "textbox", "Wall width"), "1.200,5")
        fill(role(form, "textbox", "Wall height"), "99")
        fill(role(form, "textbox", "Show time"), "tonight")
        click(role(form, "button", "Save site"))
        for name, copy in (
            ("Site name", "Give the site a name of 1 to 80 characters without hidden or line-break characters."),
            ("Wall width", "Write the number without thousands separators, for example 1200,5."),
            ("Show time", "Enter a date and time as YYYY-MM-DDTHH:mm."),
        ):
            box = role(form, "textbox", name)
            settled(page, lambda: assert_contains(described_text(box), copy), what=f"{name} field copy")
        assert len(ok(api(app_url, "GET", "/api/sites"))["items"]) == count
        sites = len(ok(api(app_url, "GET", "/api/sites"))["items"])
        shows(page, heading(page, "1 WALL ON FILE" if sites == 1 else f"{sites} WALLS ON FILE"))
    with open_app(browser, app_url + "/hire") as page:
        form = role(page, "form", "Check stock")
        shows(page, form)
        select(role(form, "combobox", "Model"), "VK-12")
        fill(role(form, "textbox", "First day"), far_day())
        fill(role(form, "spinbutton", "Days"), "1")
        click(role(page, "button", "Ask for a hold"))
        says(page, role(page, "alert", "Outage"), "The hire desk has no body free for those dates.")
    made = ready(app_url, 0)
    with open_app(browser, f"{app_url}/sites/{made.id}/survey") as page:
        shows(page, heading(page, "NO WALL YET"))
    with open_app(browser, f"{app_url}/sites/{made.id}/layouts/{made.layout}") as page:
        shows(page, heading(page, "NO WALL YET"))
        click(role(page, "button", "Issue rig sheet"))
        says(page, role(page, "alert", "Outage"), "0 placements still need a confirmed body.")


def test_photo_judged_by_content(app_url: str) -> None:
    site = new_site(app_url)["id"]
    store = S3()
    not_images = [
        ("wall.jpg", "image/jpeg", b"this is plain text, not a photo"),
        ("wall.png", "image/png", b"GIF89a\x01\x00\x01\x00\x00\x00\x00;"),
        ("wall.png", "image/svg+xml", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>"),
        ("wall.jpg", "image/jpeg", b"%PDF-1.7\n"),
        ("wall.png", "image/png", b"\x89PNG\r\n\x1a\n"),
        ("wall.jpg", "image/jpeg", b"\xff\xd8\xff\xd9"),
    ]
    copy = "That file isn't a JPEG or PNG photo, whatever its name says."
    for name, declared, data in not_images:
        problem(upload(app_url, site, data, name=name, declared=declared), 415, "photo_not_image", copy)
    assert store.keys(f"photos/{site}/") == [], "a refused file left an object in the wall store"
    problem(api(app_url, "GET", f"/api/sites/{site}/photo"), 404, "not_found")

    picture = png()
    named = f"{uid()}.txt"
    accepted = ok(upload(app_url, site, picture, name=named, declared="text/plain"), 201)
    assert (accepted["widthPx"], accepted["heightPx"], accepted["orientation"]) == (PHOTO_WIDTH, PHOTO_HEIGHT, 1)
    assert accepted["fileName"] == named

    at_limit = picture + b"\x00" * (PHOTO_LIMIT - len(picture))
    fits = new_site(app_url)["id"]
    assert ok(upload(app_url, fits, at_limit), 201)["bytes"] == PHOTO_LIMIT
    over = new_site(app_url)["id"]
    problem(upload(app_url, over, at_limit + b"\x00"), 413, "photo_too_large", "That photo is over the 40,000,000 byte limit.")
    assert store.keys(f"photos/{over}/") == []


def test_photo_kept_byte_for_byte(app_url: str) -> None:
    site = new_site(app_url)["id"]
    picture = jpeg()
    digest = hashlib.sha256(picture).hexdigest()
    key = idempotency_key()
    down = outage("APP_MINIO_DOWN_URL")
    problem(
        upload(down, site, picture, key=key), 503, "wall_store_unavailable",
        "The wall store isn't answering. Your readings and layouts still work; the photo was not kept.",
    )
    problem(api(app_url, "GET", f"/api/sites/{site}/photo"), 404, "not_found")
    points, check = corner_points("8", "6")
    problem(rectify(app_url, site, points, check), 409, "photo_missing", "Upload a wall photo first.")

    stored = ok(upload(app_url, site, picture, name=HOSTILE_NAME, declared="image/heic", key=key), 201)
    assert stored["sha256"] == digest and stored["bytes"] == len(picture)
    assert stored["key"] == f"photos/{site}/{digest}", "the file name never forms a key"
    assert stored["fileName"] == HOSTILE_NAME
    assert S3().get(stored["key"]) == picture
    served = api(app_url, "GET", f"/api/sites/{site}/photo")
    assert served.content == picture
    assert digest in served.headers["etag"] and not served.headers["etag"].startswith("W/")


def test_operation_applies_once(app_url: str) -> None:
    site = new_site(app_url)["id"]
    peer = outage("APP_PEER_URL")
    path = f"/api/sites/{site}/readings/sync"
    op = {"operationId": str(uuid.uuid4()), "cell": "H8", "value": Q("12", "lx"), "capturedAt": OLD_CAPTURE}
    bases = [app_url, peer] * 4
    with concurrent.futures.ThreadPoolExecutor(len(bases)) as pool:
        answers = list(pool.map(lambda b: ok(api(b, "POST", path, {"operations": [op]}))["results"][0]["status"], bases))
    assert sorted(answers) == ["applied"] + ["duplicate"] * (len(bases) - 1)
    assert len(readings(app_url, site, "H8")) == 1

    changed = {**op, "value": Q("99", "lx")}
    result = ok(api(peer, "POST", path, {"operations": [changed]}))["results"][0]
    assert result["status"] == "conflict" and result["code"] == "operation_id_reused"
    assert readings(app_url, site, "H8")[0]["entered"]["text"] == "12", "a conflict leaves the first reading"

    good = {"operationId": str(uuid.uuid4()), "cell": "H9", "value": Q("3", "lx"), "capturedAt": OLD_CAPTURE}
    bad_cell = {"operationId": str(uuid.uuid4()), "cell": "ZZ999", "value": Q("3", "lx"), "capturedAt": OLD_CAPTURE}
    bad_time = {"operationId": str(uuid.uuid4()), "cell": "H9", "value": Q("3", "lx"), "capturedAt": "yesterday"}
    mixed = ok(api(app_url, "POST", path, {"operations": [bad_cell, good, bad_time]}))["results"]
    assert [r["operationId"] for r in mixed] == [bad_cell["operationId"], good["operationId"], bad_time["operationId"]]
    assert [r["status"] for r in mixed] == ["rejected", "applied", "rejected"]
    assert mixed[0]["code"] == "validation_failed" and mixed[0]["errors"]["/cell"] == "That cell isn't on this wall."
    assert mixed[2]["errors"]["/capturedAt"] == "Give the capture time as an instant with its offset."
    assert mixed[1]["readingId"]

    make = lambda: {"operationId": str(uuid.uuid4()), "cell": "H10", "value": Q("1", "lx"), "capturedAt": OLD_CAPTURE}
    invalid(api(app_url, "POST", path, {"operations": []}), "Send 1 to 500 readings at a time.", "/operations")
    invalid(api(app_url, "POST", path, {"operations": [make() for _ in range(501)]}), "Send 1 to 500 readings at a time.", "/operations")
    assert readings(app_url, site, "H10") == []
    full = ok(api(app_url, "POST", path, {"operations": [make() for _ in range(500)]}))["results"]
    assert {r["status"] for r in full} == {"applied"} and len(full) == 500
    assert len(readings(app_url, site, "H10")) == 500


def test_movement_pairs_and_pages(app_url: str) -> None:
    site = new_site(app_url)["id"]
    serial = f"T-{uid()}"
    first = ok(move(app_url, "bought", serial, model="VK-20"), 201)
    assert first["kind"] == "bought" and first["serial"] == serial and first["reversesId"] is None
    assert first["entries"] == [{"location": "outside", "delta": -1}, {"location": "shelf", "delta": 1}]
    sent = ok(move(app_url, "sent_to_site", serial, siteId=site), 201)
    assert sent["entries"] == [{"location": "shelf", "delta": -1}, {"location": f"site:{site}", "delta": 1}]
    back = ok(move(app_url, "returned", serial), 201)
    assert back["entries"] == [{"location": f"site:{site}", "delta": -1}, {"location": "shelf", "delta": 1}]
    gone = ok(move(app_url, "retired", serial), 201)
    assert gone["entries"] == [{"location": "shelf", "delta": -1}, {"location": "retired", "delta": 1}]
    assert shelf_item(app_url, serial)["location"] == "retired"
    history = journal(app_url, serial)
    assert [m["id"] for m in history] == [gone["id"], back["id"], sent["id"], first["id"]], "newest first"
    for movement in history:
        assert sum(e["delta"] for e in movement["entries"]) == 0 and len(movement["entries"]) == 2

    bought = [buy(app_url) for _ in range(5)]
    page1 = ok(api(app_url, "GET", "/api/kit/movements?limit=2"))
    assert len(page1["items"]) == 2 and page1["nextCursor"]
    written_between = buy(app_url)
    page2 = ok(api(app_url, "GET", f"/api/kit/movements?limit=2&after={quote(page1['nextCursor'])}"))
    page3 = ok(api(app_url, "GET", f"/api/kit/movements?limit=1&after={quote(page2['nextCursor'])}"))
    seen = [m["serial"] for m in page1["items"] + page2["items"] + page3["items"]]
    assert seen == list(reversed(bought)), "a write between pages neither repeats nor skips a movement"
    assert written_between not in seen
    assert ok(api(app_url, "GET", "/api/kit/movements?limit=1"))["items"][0]["serial"] == written_between

    problem(api(app_url, "GET", "/api/kit/movements?after=%21%21unreadable%21%21"), 404, "not_found")
    for limit in ("0", "201", "2.5", "x"):
        invalid(api(app_url, "GET", f"/api/kit/movements?limit={limit}"), "Ask for 1 to 200 at a time.")
    assert len(ok(api(app_url, "GET", "/api/kit/movements?limit=200"))["items"]) <= 200

    fold: dict[str, str] = {}
    for movement in reversed(journal(app_url)):
        fold[movement["serial"]] = next(e["location"] for e in movement["entries"] if e["delta"] == 1)
    for item in shelf(app_url)["items"]:
        assert item["location"] == fold[item["serial"]], "the shelf is a fold of the journal"


def test_phone_sheet_band(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}{SEED_PATH}?cell=M12") as page:
        page.set_viewport_size({"width": 375, "height": 812})
        wait_wall(page)
        data = layout_cell(app_url, SEED_LAYOUT, "M12")
        toggle = role(page, "button", "Readings")
        shows(page, toggle)
        assert toggle.get_attribute("aria-expanded") == "false"
        shows(page, page.get_by_text(data["band"]).first)
        click(toggle)
        settled(page, lambda: expect(toggle).to_have_attribute("aria-expanded", "true", timeout=PAGE_POLL_MS), what="sheet expanded")
        panel = role(page, "region", "Readings")
        shows(page, panel)
        says(page, panel, data["band"])
        shows(page, role(page, "region", "Bodies"))
        click(toggle)
        settled(page, lambda: expect(toggle).to_have_attribute("aria-expanded", "false", timeout=PAGE_POLL_MS), what="sheet collapsed")


def test_quote_exact_cents(app_url: str, wiremock: WireMock) -> None:
    for days in range(1, 8):
        net = half_even(RATE_CENTS * FACTORS[days], 1000)
        vat = half_even(net * 21, 100)
        stub_quote(wiremock, RATE_CENTS, days, net, vat, net + vat)
        hold = held_hold(app_url, wiremock, days=days)
        quote_body = ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
        assert quote_body == {
            "dayRateCents": RATE_CENTS, "days": days, "factorPermille": FACTORS[days], "netCents": net, "vatCents": vat,
            "totalCents": net + vat, "providerTotalCents": net + vat, "matches": True,
        }
        asked = [body_of(e) for e in wiremock.requests("/v1/quotes", "POST")]
        assert {"holdRef": hold.ref, "days": days} in asked
        assert hold_of(app_url, hold.id)["quote"]["totalCents"] == net + vat

    rate = 16505
    net = half_even(rate * FACTORS[3], 1000)
    vat = half_even(net * 21, 100)
    wiremock.stub("GET", "/v1/stock", json={"model": "VK-20", "available": 4, "dayRateCents": rate})
    stub_quote(wiremock, rate, 3, net, vat, net + vat)
    hold = held_hold(app_url, wiremock, days=3)
    odd = ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
    assert (odd["netCents"], odd["vatCents"], odd["totalCents"], odd["matches"]) == (net, vat, net + vat, True)


def test_issue_all_or_nothing(app_url: str, wiremock: WireMock) -> None:
    made = ready(app_url)
    press = outage("APP_PRESS_FAULT_URL")
    path = "/forms/chromium/convert/html"
    key = idempotency_key()
    store = S3()
    before = set(store.keys("sheets/"))
    stream = Stream(app_url)
    press_copy = "The rig sheet press isn't answering. Your layout is unchanged; nothing has been issued."
    store_copy = "The sheet store isn't answering. Your layout is unchanged; nothing has been issued."

    def untouched() -> None:
        assert state(layout_of(app_url, made.layout)[0]["sheetStatus"]) == DRAFT
        assert shelf_item(app_url, made.serials[0])["free"] is True
        assert set(store.keys("sheets/")) == before, "a failed issue left a stray object"

    for stubbed in (
        {"status": 500, "body": "press fault"},
        {"status": 200, "body": "<html>not a pdf</html>", "headers": {"Content-Type": "text/html"}},
        {"status": 200, "body": "not a pdf either", "headers": {"Content-Type": "application/pdf"}},
    ):
        wiremock.stub("POST", path, **stubbed)
        problem(issue(press, made.layout, key), 503, "press_unavailable", press_copy)
        untouched()
    assert wiremock.requests(path, "POST"), "the press was never called"

    wiremock.stub("POST", path, status=200, body="%PDF-late", headers={"Content-Type": "application/pdf"}, delay_ms=PRESS_STALL_MS)
    with concurrent.futures.ThreadPoolExecutor(1) as pool:
        stalled = pool.submit(issue, press, made.layout, key)
        assert ok(api(press, "GET", "/api/kit/shelf"))["models"] and not stalled.done(), "a silent press slows only its own action"
        problem(stalled.result(), 503, "press_unavailable", press_copy)
    untouched()

    problem(issue(outage("APP_GOTENBERG_DOWN_URL"), made.layout, key), 503, "press_unavailable", press_copy)
    problem(issue(outage("APP_STORE_FAULT_URL"), made.layout, key), 503, "sheet_store_unavailable", store_copy)
    problem(issue(outage("APP_MINIO_DOWN_URL"), made.layout, key), 503, "sheet_store_unavailable", store_copy)
    untouched()
    assert stream.of("sheet.changed") == [] or all(f["aggregateId"] for f in stream.of("sheet.changed"))
    sheet = ok(issue(app_url, made.layout, key), 201)
    assert sheet["version"] == 1, "failed attempts consumed no version and the 5xx outcome was not stored"
    assert len(stream.of("sheet.changed", id=sheet["id"])) <= 1
    problem(issue(app_url, made.layout), 409, "sheet_already_issued", "This layout already has an issued sheet.")
    stream.stop()


def test_link_lifecycle(app_url: str) -> None:
    made = issued(app_url)
    old, ends = made.token, made.sheet["linkEndsAt"]
    stream = Stream(app_url, f"/api/rig/{old}/events")
    assert stream.status == 200
    renewed = ok(api(app_url, "POST", f"/api/sheets/{made.sheet['id']}/link", {}), 201)
    new = renewed["techUrl"].rsplit("/", 1)[-1]
    assert new != old and renewed["linkEndsAt"] == ends and renewed["linkActive"] is True
    ended = "This rig sheet link has ended. Ask the projection artist for a new one."
    problem(api(app_url, "GET", f"/api/rig/{old}"), 410, "link_ended", ended)
    problem(api(app_url, "GET", f"/api/rig/{old}/sheet.pdf"), 410, "link_ended", ended)
    circuit = made.sheet["circuits"][0]["id"]
    problem(api(app_url, "POST", f"/api/rig/{old}/circuits/{circuit}/live", {"live": True}), 410, "link_ended", ended)
    assert stream.closed.wait(LINK_STREAM_CLOSE_S + TICK_S), "a replaced link's stream stayed open"
    ok(api(app_url, "GET", f"/api/rig/{new}"))

    second = Stream(app_url, f"/api/rig/{new}/events")
    assert api(app_url, "DELETE", f"/api/sheets/{made.sheet['id']}/link").status_code == 204
    problem(api(app_url, "GET", f"/api/rig/{new}"), 410, "link_ended", ended)
    assert second.closed.wait(LINK_STREAM_CLOSE_S + TICK_S), "a revoked link's stream stayed open"
    current = ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))
    assert current["techUrl"] is None and current["linkActive"] is False

    third = ok(api(app_url, "POST", f"/api/sheets/{made.sheet['id']}/link", {}), 201)["techUrl"].rsplit("/", 1)[-1]
    ok(api(app_url, "POST", f"/api/sheets/{made.sheet['id']}/withdraw", {}))
    problem(api(app_url, "GET", f"/api/rig/{third}"), 410, "link_ended", ended)
    problem(api(app_url, "POST", f"/api/sheets/{made.sheet['id']}/link", {}), 409, "sheet_withdrawn", "This sheet has been withdrawn.")


def test_link_window_by_server_clock(browser: Browser, app_url: str) -> None:
    short = outage("APP_SHORT_URL")
    made = issued(short)
    assert instant(made.sheet["linkEndsAt"]) == instant(made.sheet["issuedAt"]) + dt.timedelta(seconds=SHORT_SECONDS)
    circuit = made.sheet["circuits"][0]["id"]
    replaced = made.token
    fresh = ok(api(short, "POST", f"/api/sheets/{made.sheet['id']}/link", {}), 201)["techUrl"].rsplit("/", 1)[-1]
    over = "This sheet's link window is over."
    with open_app(browser, f"{short}/rig/{fresh}") as page:
        wrong_clock(page, WRONG_CLOCK_BEHIND)
        poll(lambda: api(short, "GET", f"/api/rig/{fresh}/sheet.pdf").status_code == 409, SHORT_SECONDS * 3, "the link window never ended")
        settled(page, lambda: expect(page.get_by_text(over).first).to_be_visible(timeout=PAGE_POLL_MS), what="window-over copy on the open page")
    for token in (fresh, replaced):
        problem(api(short, "GET", f"/api/rig/{token}"), 409, "link_window_over", over)
        problem(api(short, "GET", f"/api/rig/{token}/events"), 409, "link_window_over", over)
        problem(api(short, "POST", f"/api/rig/{token}/circuits/{circuit}/live", {"live": True}), 409, "link_window_over", over)
    problem(api(short, "POST", f"/api/sheets/{made.sheet['id']}/link", {}), 409, "link_window_over", over)


def test_site_measured_wall(app_url: str) -> None:
    site = ok(api(app_url, "POST", "/api/sites", {
        "name": unique("Wall")[0], "width": Q("10,2"), "height": Q("20", "ft"), "showAtLocal": "2027-07-01T20:00",
    }, key=idempotency_key()), 201)
    assert (site["columns"], site["rows"]) == (21, 13)
    assert Decimal(site["widthMetres"]) == Decimal("10.2")
    assert Decimal(site["heightMetres"]) == Decimal("6.096")
    assert site["rectified"] is False and site["residualMetres"] is None and site["demo"] is False
    assert [(c["name"], c["kind"], c["capacityWatts"]) for c in site["circuits"]] == [("Mains", "400V-CEE-32A", MAINS_WATTS)]
    assert [(l["name"], state(l["sheetStatus"])) for l in site["layouts"]] == [("Main layout", DRAFT)]
    assert instant(site["showAt"]) == dt.datetime(2027, 7, 1, 18, 0, tzinfo=dt.timezone.utc)
    cells = ok(api(app_url, "GET", f"/api/sites/{site['id']}/cells"))
    assert (cells["columns"], cells["rows"], len(cells["items"])) == (21, 13, 21 * 13)
    assert {"A1", "U13"} <= {c["cell"] for c in cells["items"]}
    first = next(c for c in cells["items"] if c["cell"] == "A1")
    assert Decimal(first["reflectance"]) == Decimal("0.6") and Decimal(first["recessMetres"]) == 0

    wide_site = new_site(app_url, '14', '1')
    wide = ok(api(app_url, "GET", f"/api/sites/{wide_site['id']}/cells"))
    assert {"Z1", "AA1", "AB2"} <= {c["cell"] for c in wide["items"]}
    assert len(wide["items"]) == wide_site["columns"] * wide_site["rows"], "no cell beyond the last column"

    gap = new_site(app_url, show="2027-03-28T02:30")
    assert instant(gap["showAt"]) == dt.datetime(2027, 3, 28, 1, 0, tzinfo=dt.timezone.utc)
    fold = new_site(app_url, show="2027-10-31T02:30")
    assert instant(fold["showAt"]) == dt.datetime(2027, 10, 31, 0, 30, tzinfo=dt.timezone.utc)

    assert new_site(app_url, "100", "40")["columns"] == 200
    size_copy = "The wall must be from 1 to 100 metres wide and from 1 to 40 metres high."
    name_copy = "Give the site a name of 1 to 80 characters without hidden or line-break characters."
    base_body = {"name": "x", "width": Q("10"), "height": Q("10"), "showAtLocal": SHOW_AT}
    for change, copy, pointer in (
        ({"width": Q("100,1")}, size_copy, None),
        ({"width": Q("0,5")}, size_copy, None),
        ({"height": Q("40.5")}, size_copy, None),
        ({"name": "a\u200db"}, name_copy, "/name"),
        ({"name": "a\u2028b"}, name_copy, "/name"),
        ({"name": ""}, name_copy, "/name"),
        ({"name": "e\u0301" * 81}, name_copy, "/name"),
        ({"showAtLocal": "01/07/2027 20:00"}, "Enter a date and time as YYYY-MM-DDTHH:mm.", "/showAtLocal"),
        ({"width": Q("10", "yd")}, "Choose one of the listed units.", "/width/unit"),
    ):
        invalid(api(app_url, "POST", "/api/sites", {**base_body, **change}, key=idempotency_key()), copy, pointer)
    long_name = ok(api(app_url, "POST", "/api/sites", {**base_body, "name": "e\u0301" * 80}, key=idempotency_key()), 201)
    assert long_name["name"] == "\u00e9" * 80, "name is NFC-normalised and counted in grapheme clusters"


def test_upright_copy_honours_orientation(app_url: str) -> None:
    site = new_site(app_url, "10", "10")["id"]
    picture = jpeg(64, 32, 6)
    stored = ok(upload(app_url, site, picture), 201)
    assert (stored["widthPx"], stored["heightPx"], stored["orientation"]) == (32, 64, 6)
    upright = api(app_url, "GET", f"/api/sites/{site}/photo/upright")
    assert upright.status_code == 200
    assert image_size(upright.content) == (32, 64)
    assert S3().get(stored["key"]) == picture

    good = [point(1, 1, "0", "0"), point(31, 1, "3", "0"), point(31, 61, "3", "6"), point(1, 61, "0", "6")]
    centre = point(16, 31, "1.5", "3")
    outside = [point(50, 1, "0", "0"), *good[1:]]
    invalid(rectify(app_url, site, outside, centre), "That point is outside the photo.", "/points/0/pixel")
    out_check = point(50, 31, "1.5", "3")
    invalid(rectify(app_url, site, good, out_check), "That point is outside the photo.", "/check/pixel")
    done = ok(rectify(app_url, site, good, centre))
    assert Decimal(done["residualMetres"]) == 0, "points past the raw photo height only fit the upright image"

    flat = new_site(app_url, "10", "10")["id"]
    plain = ok(upload(app_url, flat, jpeg(64, 32, 1)), 201)
    assert (plain["widthPx"], plain["heightPx"], plain["orientation"]) == (64, 32, 1)
    untagged = new_site(app_url, "10", "10")["id"]
    assert ok(upload(app_url, untagged, png()), 201)["orientation"] == 1


def test_rectification_and_check_point(app_url: str) -> None:
    site = new_site(app_url, "8", "6")["id"]
    store = S3()
    ok(upload(app_url, site, png()), 201)
    trapezoid = [point(100, 100, "0", "0"), point(300, 100, "8", "0"), point(350, 250, "8", "6"), point(50, 250, "0", "6")]

    over = rectify(app_url, site, trapezoid, point(200, 160, "4,051", "3"))
    problem(over, 422, "residual_too_high", "Those points disagree by 0.051 m; the limit is 0.050 m.")
    assert ok(api(app_url, "GET", f"/api/sites/{site}"))["rectified"] is False
    assert store.keys(f"tiles/{site}/") == [], "a refused rectification stored tiles"

    line = [point(10, 10, "0", "0"), point(100, 10, "8", "0"), point(200, 10, "8", "6"), point(50, 250, "0", "6")]
    problem(rectify(app_url, site, line, point(200, 160, "4", "3")), 422, "points_degenerate",
            "Three of those points lie on one line, so they can't fix the wall.")
    invalid(rectify(app_url, site, trapezoid[:3], point(200, 160, "4", "3")), "Set exactly four points and one check point.", "/points")
    ghost = new_site(app_url, "8", "6")["id"]
    problem(rectify(app_url, ghost, trapezoid, point(200, 160, "4", "3")), 409, "photo_missing")
    problem(rectify(outage("APP_MINIO_DOWN_URL"), site, trapezoid, point(200, 160, "4", "3")), 503, "wall_store_unavailable")
    assert ok(api(app_url, "GET", f"/api/sites/{site}"))["rectified"] is False

    at_limit = ok(rectify(app_url, site, trapezoid, point(200, 160, "4,05", "3")))
    assert at_limit["residualMetres"] == "0.050", "the limit is inclusive on the rounded value"

    exact = ok(rectify(app_url, site, trapezoid, point(200, 160, "4", "3")))
    assert exact["residualMetres"] == "0.000", "the diagonals' crossing maps to the wall's centre only under a real homography"
    matrix = exact["homography"]
    assert len(matrix) == 9 and matrix[8] == 1
    for spec in trapezoid:
        x, y = spec["pixel"]["x"], spec["pixel"]["y"]
        w = matrix[6] * x + matrix[7] * y + matrix[8]
        across = (matrix[0] * x + matrix[1] * y + matrix[2]) / w
        down = (matrix[3] * x + matrix[4] * y + matrix[5]) / w
        assert across == pytest.approx(float(spec["wall"]["across"]["text"]), abs=0.001)
        assert down == pytest.approx(float(spec["wall"]["down"]["text"]), abs=0.001)
    after = ok(api(app_url, "GET", f"/api/sites/{site}"))
    assert after["rectified"] is True and after["residualMetres"] == "0.000"
    assert exact["tiles"], "an accepted rectification names its tiles"
    objects = set(store.keys(f"tiles/{site}/"))
    for tile in exact["tiles"]:
        assert tile in objects
    assert store.get(exact["tiles"][0]).startswith(b"\x89PNG")

    ok(upload(app_url, site, png(tone=40)), 201)
    assert ok(api(app_url, "GET", f"/api/sites/{site}"))["rectified"] is False, "a new photo clears the rectification"


def test_reading_keeps_entered(app_url: str) -> None:
    site = new_site(app_url)["id"]
    with localcontext() as ctx:
        ctx.prec = 80
        fl_text = FL_CDM2 * 2 * PI / Decimal("0.6")
        cases = [
            ("A1", "1,8", "fc", six(Decimal("1.8") * FC_LUX)),
            ("A2", "1200,5", "lx", "1200.500000"),
            ("A3", "10.5", "cd/m2", six(Decimal("10.5") * PI / Decimal("0.6"))),
            ("A4", "2", "fL", six(fl_text)),
            ("A5", "0.0000005", "lx", "0.000000"),
            ("A6", "0.0000015", "lx", "0.000002"),
            ("A7", "123456789012345678", "lx", "123456789012345678.000000"),
            ("A8", "99999999999999,125", "fc", six(Decimal("99999999999999.125") * FC_LUX)),
        ]
    results = sync(app_url, site, *[(c, t, u, OLD_CAPTURE) for c, t, u, _ in cases])
    assert [r["status"] for r in results] == ["applied"] * len(cases)
    for cell, text, unit, lux in cases:
        item = readings(app_url, site, cell)[0]
        assert item["entered"] == {"text": text, "unit": unit}
        assert item["canonicalLux"] == lux, f"{text} {unit} is {lux} lx exactly"
        assert item["counts"] is True
    listed = {c["cell"]: c for c in ok(api(app_url, "GET", f"/api/sites/{site}/cells"))["items"]}
    assert listed["A1"]["ambientLux"] == cases[0][3] and listed["A1"]["readingCount"] == 1

    ok(api(app_url, "PATCH", f"/api/sites/{site}/cells/A3", {"reflectance": "0,5"}))
    assert readings(app_url, site, "A3")[0]["canonicalLux"] == cases[2][3], "canonical lux never changes after acceptance"
    later = sync(app_url, site, ("A3", "10.5", "cd/m2", LATE_CAPTURE))
    assert later[0]["status"] == "applied"
    with localcontext() as ctx:
        ctx.prec = 80
        assert readings(app_url, site, "A3")[0]["canonicalLux"] == six(Decimal("10.5") * PI / Decimal("0.5"))

    invalid(api(app_url, "PATCH", f"/api/sites/{site}/cells/A1", {"reflectance": "1,1"}), "Reflectance runs above 0 and up to 1.", "/reflectance")
    invalid(api(app_url, "PATCH", f"/api/sites/{site}/cells/A1", {"recess": Q("2,5")}), "Recess runs from 0 to 2 metres.")


@pytest.mark.parametrize("case", list(NUMBER_CASES), ids=list(NUMBER_CASES))
def test_number_forms(app_url: str, case: str) -> None:
    text, unit, copy = NUMBER_CASES[case]
    site = new_site(app_url)["id"]
    result = sync(app_url, site, ("B2", text, unit, OLD_CAPTURE))[0]
    if copy is None:
        assert result["status"] == "applied"
        assert readings(app_url, site, "B2")[0]["entered"] == {"text": text, "unit": unit}
    else:
        assert result["status"] == "rejected" and result["code"] == "validation_failed"
        assert result["errors"]["/value/text"] == copy
        assert readings(app_url, site, "B2") == []
    op = {"operationId": str(uuid.uuid4()), "cell": "B2", "value": 5, "capturedAt": OLD_CAPTURE}
    bare = ok(api(app_url, "POST", f"/api/sites/{site}/readings/sync", {"operations": [op]}))["results"][0]
    assert bare["errors"]["/value"] == "Enter a number such as 1,8."
    bad_unit = sync(app_url, site, ("B3", "5", "parsec", OLD_CAPTURE))[0]
    assert bad_unit["errors"]["/value/unit"] == "Choose one of the listed units."


def test_stale_reading_set(app_url: str) -> None:
    short = outage("APP_SHORT_URL")
    made = ready(short)
    began = time.monotonic()
    sync(short, made.id, ("M12", "30", "lx", LATE_CAPTURE))
    site = ok(api(short, "GET", f"/api/sites/{made.id}"))
    counted = readings(short, made.id, "M12")[0]["countedAt"]
    assert instant(site["staleAt"]) == instant(counted) + dt.timedelta(seconds=SHORT_SECONDS)
    if time.monotonic() - began < SHORT_SECONDS / 2:
        assert site["stale"] is False, "a reading set just accepted is not yet stale"
    poll(lambda: ok(api(short, "GET", f"/api/sites/{made.id}"))["stale"], SHORT_SECONDS * 2, "site never read stale at staleAt")
    assert ok(api(short, "GET", f"/api/sites/{made.id}/cells"))["stale"] is True
    cell = layout_cell(short, made.layout, "M12")
    assert cell["stale"] is True
    assert cell["contrast"] is not None and cell["contrast"] > 1, "a stale cell still computes"
    assert cell["band"] in ("Washed out", "Reads as graphics", "Reads as image")
    sync(short, made.id, ("M12", "31", "lx", LATE_CAPTURE))
    assert ok(api(short, "GET", f"/api/sites/{made.id}"))["stale"] is False, "a new reading restarts the age"


def test_newest_capture_counts(app_url: str) -> None:
    site = new_site(app_url)["id"]
    sync(app_url, site, ("J2", "20", "lx", "2026-03-02T20:00:00+01:00"))
    sync(app_url, site, ("J2", "10", "lx", "2026-03-01T20:00:00+01:00"))
    items = readings(app_url, site, "J2")
    assert [i["entered"]["text"] for i in items] == ["20", "10"], "newest counted first, both kept"
    assert [i["counts"] for i in items] == [True, False]
    cell = next(c for c in ok(api(app_url, "GET", f"/api/sites/{site}/cells"))["items"] if c["cell"] == "J2")
    assert cell["ambientLux"] == six(Decimal(items[0]["entered"]["text"])) and cell["readingCount"] == 2

    sync(app_url, site, ("J3", "30", "lx", LATE_CAPTURE))
    ahead = readings(app_url, site, "J3")[0]
    assert ahead["capturedAt"] != ahead["countedAt"]
    assert instant(ahead["capturedAt"]) == instant(LATE_CAPTURE), "the capture time stays as sent"
    assert instant(ahead["countedAt"]) == instant(ahead["acceptedAt"]), "a capture later than acceptance counts at acceptance"
    sync(app_url, site, ("J3", "40", "lx", LATE_CAPTURE))
    assert readings(app_url, site, "J3")[0]["entered"]["text"] == "40", "a clock ahead cannot outrank later true acceptances"
    sync(app_url, site, ("J3", "50", "lx", OLD_CAPTURE))
    assert readings(app_url, site, "J3")[0]["entered"]["text"] == "40", "an old capture arriving last does not count"

    tie = "2026-04-01T20:00:00+02:00"
    sync(app_url, site, ("J4", "1", "lx", tie))
    sync(app_url, site, ("J4", "2", "lx", tie))
    assert readings(app_url, site, "J4")[0]["entered"]["text"] == "2", "the later acceptance wins a tie"


def test_one_winner_move(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    serial = buy(app_url)
    sites = [new_site(app_url, "5", "5")["id"] for _ in range(6)]
    bases = [app_url, peer] * 3
    with concurrent.futures.ThreadPoolExecutor(len(sites)) as pool:
        answers = list(pool.map(lambda a: move(a[0], "sent_to_site", serial, siteId=a[1]), zip(bases, sites)))
    winners = [r for r in answers if r.status_code == 201]
    assert len(winners) == 1, [r.text[:200] for r in answers]
    for loser in answers:
        if loser.status_code != 201:
            problem(loser, 409, "serial_not_there", "That serial isn't where this movement starts.")
    assert [m["kind"] for m in journal(app_url, serial)] == ["sent_to_site", "bought"]
    target = next(e["location"] for e in winners[0].json()["entries"] if e["delta"] == 1)
    assert shelf_item(app_url, serial)["location"] == target
    assert shelf_item(peer, serial)["location"] == target


def test_bound_serial_limits(app_url: str) -> None:
    made = issued(app_url)
    serial = made.serials[0]
    other = new_site(app_url, "5", "5")["id"]
    before = len(journal(app_url, serial))
    problem(move(app_url, "sent_to_site", serial, siteId=other), 409, "body_in_issued_rig", f"{serial} is already in an issued rig.")
    problem(move(app_url, "retired", serial), 409, "body_in_issued_rig", f"{serial} is already in an issued rig.")
    bought = journal(app_url, serial)[0]
    problem(api(app_url, "POST", f"/api/kit/movements/{bought['id']}/reverse", {}, key=idempotency_key()), 409, "body_in_issued_rig")
    assert len(journal(app_url, serial)) == before
    ok(move(app_url, "sent_to_site", serial, siteId=made.id), 201)
    assert shelf_item(app_url, serial)["location"] == f"site:{made.id}"


def test_corrections_by_reversal(app_url: str) -> None:
    site = new_site(app_url, "5", "5")["id"]
    serial = buy(app_url)
    sent = ok(move(app_url, "sent_to_site", serial, siteId=site), 201)
    reverse = ok(api(app_url, "POST", f"/api/kit/movements/{sent['id']}/reverse", {}, key=idempotency_key()), 201)
    assert reverse["reversesId"] == sent["id"] and reverse["id"] != sent["id"]
    assert reverse["entries"] == [{"location": f"site:{site}", "delta": -1}, {"location": "shelf", "delta": 1}]
    assert shelf_item(app_url, serial)["location"] == "shelf"
    history = journal(app_url, serial)
    assert sent in history and reverse in history, "the original entry stays as posted"

    problem(api(app_url, "POST", f"/api/kit/movements/{sent['id']}/reverse", {}, key=idempotency_key()), 409, "reversal_not_possible",
            "That serial has moved since, so this movement can't be reversed.")
    for method in ("PATCH", "PUT", "DELETE"):
        resp = api(app_url, method, f"/api/kit/movements/{sent['id']}", {} if method != "DELETE" else None)
        assert resp.status_code in (404, 405), f"{method} on a movement must not exist"
        assert resp.json()["code"] in ("not_found", "method_not_allowed")
    assert journal(app_url, serial) == history


def test_show_hours_derating(app_url: str) -> None:
    made = ready(app_url)
    serial = made.serials[0]
    ok(api(app_url, "PATCH", f"/api/sites/{made.id}/cells/M12", {"reflectance": "0.6"}))
    sync(app_url, made.id, ("M12", "30", "lx", OLD_CAPTURE))
    fresh = layout_cell(app_url, made.layout, "M12")
    assert fresh["contributions"][0]["effectiveLumens"] == VK20_LUMENS

    started, added = 5000, 1000
    aged = buy(app_url, hours=str(started))
    item = shelf_item(app_url, aged)
    assert item["effectiveLumens"] == VK20_LUMENS * (1 - 0.5 * 5000 / VK20_RATED_HOURS)
    key = idempotency_key()
    path = f"/api/kit/bodies/{aged}/hours"
    logged = ok(api(app_url, "POST", path, {"hours": "1000"}, key=key))
    assert logged["serial"] == aged and Decimal(logged["loggedHours"]) == started + added
    assert logged["effectiveLumens"] == VK20_LUMENS * (1 - 0.5 * (started + added) / VK20_RATED_HOURS)
    replay = api(app_url, "POST", path, {"hours": "1000"}, key=key)
    assert replay.headers.get("Idempotency-Replayed") == "true"
    assert Decimal(shelf_item(app_url, aged)["loggedHours"]) == started + added, "a replay adds no hours"
    ok(api(app_url, "POST", path, {"hours": "0,5"}, key=idempotency_key()))
    assert Decimal(shelf_item(app_url, aged)["loggedHours"]) == started + added + Decimal("0.5")

    hours_copy = "Show hours must be above 0 and up to 1000."
    for bad in ("0", "1000,5"):
        invalid(api(app_url, "POST", path, {"hours": bad}, key=idempotency_key()), hours_copy, "/hours")
    problem(api(app_url, "POST", f"/api/kit/bodies/T-{uid()}/hours", {"hours": "1"}, key=idempotency_key()), 422, "serial_unknown")

    worn = buy(app_url, hours="19900")
    ok(api(app_url, "POST", f"/api/kit/bodies/{worn}/hours", {"hours": "1000"}, key=idempotency_key()))
    assert shelf_item(app_url, worn)["effectiveLumens"] == VK20_LUMENS / 2, "output stops at 50% past rated hours"

    ok(api(app_url, "POST", f"/api/kit/bodies/{serial}/hours", {"hours": "1000"}, key=idempotency_key()))
    later = layout_cell(app_url, made.layout, "M12")
    assert later["contributions"][0]["effectiveLumens"] == VK20_LUMENS * (1 - 0.5 * 1000 / VK20_RATED_HOURS)
    assert later["projectedLux"] < fresh["projectedLux"], "hours take effect in every sum at the next read"


def test_placement_limits(app_url: str) -> None:
    made = ready(app_url, 0, "48", "12")
    lens, circuit = buy(app_url, "LS-13"), made.circuit
    body = buy(app_url)
    version = layout_of(app_url, made.layout)[0]["version"]
    refusals = [
        (place_input(lens, circuit, body, ratio="1,1"), "This lens zooms from 1.2 to 1.6 to 1.", None),
        (place_input(lens, circuit, body, ratio="1,7"), "This lens zooms from 1.2 to 1.6 to 1.", None),
        (place_input(lens, circuit, body, shift=("31", "0")), "This lens shifts up to 30% that way.", None),
        (place_input(lens, circuit, body, shift=("-31", "0")), "This lens shifts up to 30% that way.", None),
        (place_input(lens, circuit, body, shift=("0", "51")), "This lens shifts up to 50% that way.", None),
        (place_input(lens, circuit, body, aim=("6.5", "6"), pos=("15.5", "6")), "That throw hits the wall at 26.6 degrees; the limit is 25.", "/standoff"),
        (place_input(lens, circuit, body, aim=("6.25", "6")), "Aim on a half-metre step.", None),
        (place_input(f"T-{uid()}", circuit, body), None, "/lensSerial"),
    ]
    for data, copy, pointer in refusals:
        resp = post_placement(app_url, made.layout, data)
        if copy is None:
            copy = f"{data['lensSerial']} isn't on the shelf or at this site."
        invalid(resp, copy, pointer)
    aim_ft = place_input(lens, circuit, body)
    aim_ft["aimAcross"] = Q("5", "ft")
    invalid(post_placement(app_url, made.layout, aim_ft), "Aim on a half-metre step.")
    assert layout_of(app_url, made.layout)[0]["version"] == version, "a refused placement commits nothing"

    edge = ok(post_placement(app_url, made.layout, place_input(lens, circuit, body, ratio="1,2", shift=("30", "-50"))), 201)
    placement = edge["placements"][0]
    assert placement["status"] == "Bodied" and placement["bodySerial"] == body and placement["lensSerial"] == lens
    assert placement["throwMetres"] == pytest.approx(18) and placement["obliquityDegrees"] == pytest.approx(0)
    assert placement["imageWidthMetres"] == pytest.approx(15)
    assert placement["imageHeightMetres"] == pytest.approx(15 * NATIVE_HEIGHT / NATIVE_WIDTH)
    problem(post_placement(app_url, made.layout, place_input(buy(app_url, "LS-13"), circuit, body, aim=("30", "6"))), 409, "body_already_in_layout",
            f"{body} is already in this layout.")
    problem(post_placement(app_url, made.layout, place_input(lens, circuit, buy(app_url), aim=("30", "6"))), 409, "body_already_in_layout",
            f"{lens} is already in this layout.")
    missing = f"T-{uid()}"
    problem(post_placement(app_url, made.layout, place_input(buy(app_url, "LS-13"), circuit, missing, aim=("30", "6"))), 409, "body_not_available",
            f"{missing} isn't on the shelf or at this site.")
    stacked = [ok(post_placement(app_url, made.layout, place_input(buy(app_url, "LS-13"), circuit, buy(app_url), aim=("6.5", "6"))), 201)]
    assert len(stacked[0]["placements"]) == 2
    third = post_placement(app_url, made.layout, place_input(buy(app_url, "LS-13"), circuit, buy(app_url), aim=("6.5", "6")))
    invalid(third, "No cell can sit under more than two bodies.", "/aimAcross")
    assert len(layout_of(app_url, made.layout)[0]["placements"]) == 2


def test_conditional_layout_writes(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    made = ready(app_url, 0)
    view, tag = layout_of(app_url, made.layout)
    assert not tag.startswith("W/") and tag.startswith('"')
    path = f"/api/layouts/{made.layout}/placements"
    data = place_input(buy(app_url, "LS-13"), made.circuit, buy(app_url))
    required = "This change needs the layout's current version."
    problem(api(app_url, "POST", path, data, key=idempotency_key()), 428, "precondition_required", required)
    problem(api(app_url, "POST", path, data, key=idempotency_key(), headers={"If-Match": "*"}), 428, "precondition_required", required)
    changed = "This layout changed in another window. Reload it to carry on."
    problem(api(app_url, "POST", path, data, key=idempotency_key(), headers={"If-Match": '"stale"'}), 412, "layout_changed", changed)
    problem(api(app_url, "POST", path, data, key=idempotency_key(), headers={"If-Match": f"W/{tag}"}), 412, "layout_changed", changed)

    cached = api(app_url, "GET", f"/api/layouts/{made.layout}", headers={"If-None-Match": tag})
    assert cached.status_code // 100 == 3 and cached.content == b""
    written = api(app_url, "POST", path, data, key=idempotency_key(), headers={"If-Match": tag})
    after = ok(written, 201)
    assert after["version"] == view["version"] + 1 and after["hash"] != view["hash"]
    new_tag = written.headers["etag"]
    assert new_tag != tag
    problem(api(app_url, "POST", path, place_input(buy(app_url, "LS-13"), made.circuit, buy(app_url), aim=("30", "6")),
                key=idempotency_key(), headers={"If-Match": tag}), 412, "layout_changed")

    placement_id = after["placements"][0]["id"]
    contenders = [(app_url, "1.3"), (peer, "1.4"), (app_url, "1.5"), (peer, "1.6")]
    with concurrent.futures.ThreadPoolExecutor(len(contenders)) as pool:
        answers = list(pool.map(
            lambda c: api(c[0], "PATCH", f"/api/layouts/{made.layout}/placements/{placement_id}", {"ratio": c[1]}, headers={"If-Match": new_tag}),
            contenders,
        ))
    assert sorted(r.status_code for r in answers) == [200, 412, 412, 412], [r.text[:200] for r in answers]
    settled_view, settled_tag = layout_of(peer, made.layout)
    assert settled_view["version"] == after["version"] + 1

    removed = ok(api(app_url, "DELETE", f"/api/layouts/{made.layout}/placements/{placement_id}", headers={"If-Match": settled_tag}))
    assert removed["hash"] == view["hash"], "hash returns to an old value when the data does"
    assert removed["version"] == settled_view["version"] + 1, "version never returns"


def either_reading(actual: float, per_cell: float, per_placement: list[float]) -> None:
    assert any(abs(actual - value) <= FOUR_DECIMALS for value in [per_cell, *per_placement]), f"{actual} is neither {per_cell} nor one of {per_placement}"


def test_photometric_sums(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    ambient = float(Decimal(8) * FC_LUX)
    open_cell = layout_cell(app_url, SEED_LAYOUT, "C5")
    lux = expected_lux(VK20_LUMENS, (6.5, 6.0), (1.25, 2.25))
    near(open_cell["projectedLux"], lux)
    assert open_cell["ambientLux"] == six(Decimal(8) * FC_LUX)
    near(open_cell["totalLux"], lux + ambient)
    near(open_cell["contrast"], (lux + ambient) / ambient)
    near(open_cell["luminanceCdM2"], (lux + ambient) * 0.6 / math.pi)
    near(open_cell["litLevel"], 1 - 1 / ((lux + ambient) / ambient))
    assert open_cell["pixelsPerMetre"] == round(NATIVE_WIDTH * 1.3 / 18)
    assert open_cell["blended"] is False and len(open_cell["contributions"]) == 1
    contribution = open_cell["contributions"][0]
    assert contribution["effectiveLumens"] == VK20_LUMENS and contribution["share"] == 1
    placements = layout_of(app_url, SEED_LAYOUT)[0]["placements"]
    either_reading(contribution["throwMetres"], math.sqrt(5.25 ** 2 + 3.75 ** 2 + 18 ** 2), [p["throwMetres"] for p in placements])
    either_reading(contribution["obliquityDegrees"], math.degrees(math.atan(math.sqrt(5.25 ** 2 + 3.75 ** 2) / 18)), [p["obliquityDegrees"] for p in placements])

    window = layout_cell(app_url, SEED_LAYOUT, "K10")
    recessed = expected_lux(VK20_LUMENS, (6.5, 6.0), (5.25, 4.75), recess=0.4)
    near(window["projectedLux"], recessed)
    near(window["luminanceCdM2"], (recessed + 30) * 0.1 / math.pi)

    derated = layout_cell(app_url, SEED_LAYOUT, "AJ12")
    assert derated["contributions"][0]["effectiveLumens"] == B02_LUMENS, "NW-B02 at 4000 hours is derated"
    near(derated["projectedLux"], expected_lux(B02_LUMENS, (17.5, 6.0), (17.75, 5.75)))

    dark = layout_cell(app_url, SEED_LAYOUT, "A1")
    assert dark["projectedLux"] == 0 and dark["pixelsPerMetre"] == 0 and dark["contrast"] == 1
    assert dark["band"] == "Washed out" and dark["hatched"] is True and dark["contributions"] == []

    first = api(app_url, "GET", f"/api/layouts/{SEED_LAYOUT}/cells")
    assert first.content == api(peer, "GET", f"/api/layouts/{SEED_LAYOUT}/cells").content
    items = ok(first)["items"]
    assert len(items) == SEED_ROWS * SEED_COLUMNS
    assert [i["cell"] for i in items[:2]] == ["A1", "B1"], "row then column order"
    assert items[SEED_COLUMNS]["cell"] == "A2"

    floored = ready(app_url)
    sync(app_url, floored.id, ("M12", "0", "lx", OLD_CAPTURE))
    floor_cell = layout_cell(app_url, floored.layout, "M12")
    assert abs(floor_cell["contrast"] - (floor_cell["projectedLux"] + 0.1) / 0.1) <= 11 * FOUR_DECIMALS, "contrast over the 0.1 lx floor"
    assert readings(app_url, floored.id, "M12")[0]["canonicalLux"] == six(Decimal(0))


def test_blend_zone_and_mask_ramp(app_url: str) -> None:
    width = 18 / 1.3
    left = 17.5 - width / 2
    right = 6.5 + width / 2
    t = (11.75 - left) / (right - left)
    cell = layout_cell(app_url, SEED_LAYOUT, "X12")
    assert cell["blended"] is True
    assert len(cell["contributions"]) == 2
    by_lumens = sorted(cell["contributions"], key=lambda c: -c["effectiveLumens"])
    near(by_lumens[0]["share"], 1 - t)
    near(by_lumens[1]["share"], t)
    assert by_lumens[0]["share"] + by_lumens[1]["share"] == pytest.approx(1, abs=0.0002)
    near(by_lumens[0]["lux"], expected_lux(VK20_LUMENS, (6.5, 6.0), (11.75, 5.75), share=1 - t))
    near(by_lumens[1]["lux"], expected_lux(B02_LUMENS, (17.5, 6.0), (11.75, 5.75), share=t))
    near(cell["projectedLux"], by_lumens[0]["lux"] + by_lumens[1]["lux"])
    assert cell["pixelsPerMetre"] == round(NATIVE_WIDTH * 1.3 / 18)
    assert layout_cell(app_url, SEED_LAYOUT, "M12")["blended"] is False

    job = finished_job(app_url, SEED_LAYOUT)
    bundle = api(app_url, "GET", f"/api/mask-jobs/{job['id']}/bundle").content
    archive = zipfile.ZipFile(io.BytesIO(bundle))
    row = 600
    left_row, header = png_row(archive.read("masks/NW-B01.png"), row)
    right_row, _ = png_row(archive.read("masks/NW-B02.png"), row)
    assert header == (NATIVE_WIDTH, NATIVE_HEIGHT, 8, 0), "an 8-bit grey image at native size"
    def across(column: int, centre: float) -> float:
        return centre - width / 2 + (column + 0.5) / NATIVE_WIDTH * width
    assert left_row[0] == 0, "off the wall the mask is 0"
    assert right_row[NATIVE_WIDTH - 1] == 0, "off the wall the mask is 0"
    assert left_row[NATIVE_WIDTH // 4] == 255, "outside any blend the mask is 255"
    for fraction in (0.8, 0.85, 0.9, 0.95):
        column = int(NATIVE_WIDTH * fraction)
        x = across(column, 6.5)
        if left < x < right:
            share = 1 - (x - left) / (right - left)
            assert abs(left_row[column] - share ** (1 / 2.2) * 255) <= 1, f"left mask at column {column} is off the ramp"
    for fraction in (0.05, 0.1, 0.15):
        column = int(NATIVE_WIDTH * fraction)
        x = across(column, 17.5)
        if left < x < right:
            share = (x - left) / (right - left)
            assert abs(right_row[column] - share ** (1 / 2.2) * 255) <= 1, f"right mask at column {column} is off the ramp"


def test_verdict_bands(app_url: str) -> None:
    made = ready(app_url)
    probe = {"M12": 1.97, "L12": 3.97, "K12": 9.0}
    for cell, ratio in probe.items():
        sync(app_url, made.id, (cell, "30", "lx", OLD_CAPTURE))
        projected = layout_cell(app_url, made.layout, cell)["projectedLux"]
        sync(app_url, made.id, (cell, f"{projected / ratio:.6f}", "lx", LATE_CAPTURE))
    low, middle, high = (layout_cell(app_url, made.layout, c) for c in probe)
    assert low["contrastText"] == "3.0 to 1" and low["contrast"] < 3
    assert low["band"] == "Washed out" and low["hatched"] is True
    assert middle["contrastText"] == f"{5.0:.1f} to 1" and middle["contrast"] < 5
    assert middle["band"] == "Reads as graphics" and middle["hatched"] is False
    assert high["contrast"] >= 5 and high["band"] == "Reads as image" and high["hatched"] is False
    near(high["litLevel"], 1 - 1 / high["contrast"])
    empty = layout_cell(app_url, made.layout, "J12")
    assert empty["band"] == "No reading"
    for member in ("contrast", "projectedLux", "totalLux", "luminanceCdM2", "litLevel"):
        assert empty[member] is None, f"{member} is null without a reading"


def test_second_window_figures(browser: Browser, app_url: str) -> None:
    site = rectified(app_url, "24", "12")
    layout_id = site["layouts"][0]["id"]
    circuit = site["circuits"][0]["id"]
    ok(post_placement(app_url, layout_id, place_input(buy(app_url, "LS-13"), circuit, buy(app_url))), 201)
    sync(app_url, site["id"], ("L12", "30", "lx", OLD_CAPTURE), ("M12", "30", "lx", OLD_CAPTURE))
    with open_app(browser, f"{app_url}/sites/{site['id']}/layouts/{layout_id}?cell=L12") as page:
        wait_wall(page)
        focus_grid(page, "L12")
        page.keyboard.press("ArrowRight")
        matches_server(page, app_url, layout_id, "M12")
        before = layout_cell(app_url, layout_id, "M12")
        peer = outage("APP_PEER_URL")
        ok(post_placement(peer, layout_id, place_input(buy(app_url, "LS-13"), circuit, buy(app_url), aim=("12", "6"))), 201)
        page.keyboard.press("ArrowLeft")
        matches_server(page, app_url, layout_id, "L12")
        page.keyboard.press("ArrowRight")
        after = layout_cell(app_url, layout_id, "M12")
        assert after["blended"] is True and before["blended"] is False
        matches_server(page, app_url, layout_id, "M12")
        says(page, role(page, "status", "Cell reading"), ", blended.")
        page.reload()
        shows(page, heading(page, cell_sentence(after)))


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}{SEED_PATH}?cell=F12", reduced_motion="reduce") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        wait_wall(page)
        loupe = role(page, "img", "Show-night loupe")
        focus_grid(page, "F12")
        title = page.get_by_role("heading", level=1)
        assert rolling(page, title) is False, "digits swap without rolling under reduced motion"
        matches_server(page, app_url, SEED_LAYOUT, "G12")
        focus_grid(page, "G12")
        page.keyboard.press("ArrowRight")
        advance(page, 0)
        assert animations(loupe) == [], "the loupe jumps directly under reduced motion"
        first = loupe.bounding_box()
        advance(page, GLIDE_MAX_MS)
        assert loupe.bounding_box() == first, "no follow lag under reduced motion"
        matches_server(page, app_url, SEED_LAYOUT, "H12")
        page.keyboard.press("Shift+ArrowRight")
        matches_server(page, app_url, SEED_LAYOUT, "M12")
        click(role(page, "button", "Open the full wall"))
        stage = role(page, "dialog", "Full wall")
        advance(page, 0)
        shows(page, stage)
        assert animations(stage) == [], "the stage opens at once under reduced motion"
    with open_app(browser, f"{app_url}{SEED_PATH}?cell=F12") as page:
        page.set_viewport_size({"width": 1280, "height": 800})
        wait_wall(page)
        focus_grid(page, "F12")
        assert rolling(page, page.get_by_role("heading", level=1)) is True, "numerals roll without the reduced-motion setting"
        advance(page, ROLL_MAX_MS)
        matches_server(page, app_url, SEED_LAYOUT, "G12")
        click(role(page, "button", "Open the full wall"))
        stage = role(page, "dialog", "Full wall")
        path = motion(stage, STAGE_MAX_MS)
        assert len({tuple(sorted(s.items())) for s in path}) >= 2, "the stage grows from the slot"


def test_stock_and_hold_asked(app_url: str, wiremock: WireMock) -> None:
    day = far_day()
    stock_days = 2
    stock = ok(api(app_url, "GET", f"/api/hire/stock?model=VK-20&from={day}&days={stock_days}"))
    assert stock == {"model": "VK-20", "available": 4, "dayRateCents": RATE_CENTS}
    calls = [e["query"] for e in wiremock.requests("/v1/stock", "GET")]
    assert {"model": "VK-20", "from": day, "days": str(stock_days)} in calls, calls

    desk = desk_answers(wiremock)
    hold_day = far_day()
    hold = ok(ask_hold(app_url, 2, hold_day), 201)
    assert state(hold["status"]) == "held" and hold["holdRef"] == desk.ref and hold["serial"] == desk.serial
    assert hold["model"] == "VK-20" and hold["from"] == hold_day and hold["days"] == 2
    assert instant(hold["expiresAt"]) > instant(hold["serverNow"])
    assert EXPIRES_S - DESK_SETTLE_S <= hold["remainingSeconds"] <= EXPIRES_S, "expiresInSeconds is counted by the server"
    entries = asked_for(wiremock, hold_day)
    assert len(entries) == 1
    assert body_of(entries[0]) == {"model": "VK-20", "from": hold_day, "days": 2}
    first_key = header_of(entries[0], "Idempotency-Key")
    assert first_key

    other_day = far_day()
    ok(ask_hold(app_url, 1, other_day), 201)
    assert header_of(asked_for(wiremock, other_day)[0], "Idempotency-Key") != first_key, "ask keys are unique per hold"

    wiremock.stub("POST", "/v1/holds", status=409, json={"error": "no_stock"})
    none_day = far_day()
    problem(ask_hold(app_url, 1, none_day), 409, "no_stock", "The hire desk has no body free for those dates.")
    assert all(h["from"] != none_day or state(h["status"]) == "released" for h in ok(api(app_url, "GET", "/api/holds"))["items"])

    count = len(wiremock.requests("/v1/holds", "POST"))
    past = api(app_url, "POST", "/api/holds", {"model": "VK-20", "from": "2000-01-01", "days": 1}, key=idempotency_key())
    invalid(past, "The first day can't be before today in Brussels.", "/from")
    for days in (0, 8):
        invalid(api(app_url, "POST", "/api/holds", {"model": "VK-20", "from": far_day(), "days": days}, key=idempotency_key()),
                "A hire runs for 1 to 7 days.", "/days")
    assert len(wiremock.requests("/v1/holds", "POST")) == count, "a refused ask never reaches the desk"


def test_total_mismatch_blocks_confirm(app_url: str, wiremock: WireMock) -> None:
    hold = held_hold(app_url, wiremock)
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()), 409, "quote_required",
            "Quote this hold before confirming it.")
    stub_quote(wiremock, RATE_CENTS, 1, RATE_CENTS, 3465, 19966)
    body = ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
    assert (body["totalCents"], body["providerTotalCents"], body["matches"]) == (19965, 19966, False)
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()), 409, "quote_total_mismatch",
            "The hire desk's total of € 199,66 differs from ours of € 199,65. Nothing can be confirmed.")
    assert wiremock.requests(hold.confirm) == [], "a mismatch must never reach the confirm endpoint"
    assert state(hold_of(app_url, hold.id)["status"]) == "held"
    assert journal(app_url, hold.serial) == []

    stub_quote(wiremock, RATE_CENTS, 1, RATE_CENTS, 3465, 19965)
    assert ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))["matches"] is True
    hired = ok(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()))
    assert state(hired["status"]) == HIRED_IN, "the latest stored quote decides"
    sent = wiremock.requests(hold.confirm)
    assert len(sent) == 1 and body_of(sent[0]) == {"totalCents": 19965}
    assert header_of(sent[0], "Idempotency-Key")


def test_hired_in_only_on_confirm(app_url: str, wiremock: WireMock) -> None:
    made = ready(app_url, 0)
    hold = held_hold(app_url, wiremock)
    lens = buy(app_url, "LS-13")
    drawn = ok(post_placement(app_url, made.layout, place_input(lens, made.circuit, hold=hold.id)), 201)
    placement = drawn["placements"][0]
    assert placement["status"] == "On hold" and placement["holdId"] == hold.id
    assert journal(app_url, hold.serial) == [], "a held body is not in the kit"
    problem(issue(app_url, made.layout), 409, "layout_needs_bodies", "1 placements still need a confirmed body.")

    ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
    version = layout_of(app_url, made.layout)[0]["version"]
    hired = ok(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()))
    assert state(hired["status"]) == HIRED_IN and hired["remainingSeconds"] == 0
    movement = journal(app_url, hold.serial)
    assert [m["kind"] for m in movement] == ["hired_in"]
    assert movement[0]["entries"] == [{"location": "rental_house", "delta": -1}, {"location": "shelf", "delta": 1}]
    assert shelf_item(app_url, hold.serial)["location"] == "shelf"
    after, _ = layout_of(app_url, made.layout)
    assert after["placements"][0]["status"] == "Bodied" and after["placements"][0]["bodySerial"] == hold.serial
    assert after["version"] == version + 1, "turning Bodied is a committed layout write"
    ok(issue(app_url, made.layout), 201)
    assert len(wiremock.requests(hold.confirm)) == 1
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/release", {}, key=idempotency_key()), 409, "hold_not_held", "This hold is no longer held.")
    problem(move(app_url, "returned", hold.serial), 409, "body_in_issued_rig")

    refused = held_hold(app_url, wiremock)
    ok(api(app_url, "POST", f"/api/holds/{refused.id}/quote", {}))
    wiremock.stub("POST", refused.confirm, status=409, json={"error": "hold_expired"})
    resp = api(app_url, "POST", f"/api/holds/{refused.id}/confirm", {}, key=idempotency_key())
    assert resp.status_code >= 400 or state(resp.json()["status"]) == "lapsed"
    poll(lambda: state(hold_of(app_url, refused.id)["status"]) == "lapsed", API_DEADLINE_S, "desk's hold_expired never read Lapsed")
    assert journal(app_url, refused.serial) == [], "a refused confirm posts no movement"

    known = buy(app_url)
    wiremock.stub("POST", "/v1/holds", status=201, json={
        "holdRef": f"H-{uid()}", "status": "held", "expiresInSeconds": 1800, "serial": known, "loggedHours": 0,
    })
    clash = ok(ask_hold(app_url), 201)
    ok(api(app_url, "POST", f"/api/holds/{clash['id']}/quote", {}))
    problem(api(app_url, "POST", f"/api/holds/{clash['id']}/confirm", {}, key=idempotency_key()), 409, "serial_already_in_kit",
            "The hire desk offered a serial that's already in your kit.")
    assert wiremock.requests(f"/v1/holds/{clash['holdRef']}/confirm") == [], "refused before any desk call"


def test_idempotency_keys(app_url: str, wiremock: WireMock) -> None:
    peer = outage("APP_PEER_URL")
    key = idempotency_key()
    name = unique("Wall")[0]
    body = {"name": name, "width": Q("5"), "height": Q("5"), "showAtLocal": SHOW_AT}
    first = api(app_url, "POST", "/api/sites", body, key=key)
    site = ok(first, 201)
    assert "Idempotency-Replayed" not in first.headers
    replay = api(peer, "POST", "/api/sites", body, key=key)
    assert replay.status_code == 201 and replay.json() == site
    assert replay.headers["Idempotency-Replayed"] == "true"
    problem(api(app_url, "POST", "/api/sites", {**body, "name": name + "x"}, key=key), 409, "idempotency_key_reused",
            "That Idempotency-Key was already used for a different request.")
    assert sum(1 for s in ok(api(app_url, "GET", "/api/sites"))["items"] if s["name"] == name) == 1

    same_scope = api(app_url, "POST", f"/api/sites/{site['id']}/circuits", {"name": "Side", "kind": "230V-16A"}, key=key)
    assert ok(same_scope, 201)["capacityWatts"] == CIRCUIT_16A_WATTS, "a key is scoped by method and path"

    required = "This action needs an Idempotency-Key header."
    problem(api(app_url, "POST", "/api/sites", body), 400, "idempotency_key_required", required)
    problem(api(app_url, "POST", "/api/sites", body, key="k" * (KEY_MAX + 1)), 400, "idempotency_key_required", required)
    problem(api(app_url, "POST", "/api/sites", body, key=""), 400, "idempotency_key_required", required)
    assert api(app_url, "POST", "/api/sites", {**body, "name": unique("Wall")[0]}, key=uid() + "k" * (KEY_MAX - 10)).status_code == 201

    serial = f"T-{uid()}"
    parallel_key = idempotency_key()
    move_body = {"kind": "bought", "serial": serial, "model": "VK-20"}
    bases = [app_url, peer] * 4
    with concurrent.futures.ThreadPoolExecutor(len(bases)) as pool:
        answers = list(pool.map(lambda b: api(b, "POST", "/api/kit/movements", move_body, key=parallel_key), bases))
    assert {r.status_code for r in answers} == {201}, [r.text[:200] for r in answers]
    assert len({r.json()["id"] for r in answers}) == 1, "parallel requests with one key share one outcome"
    assert len(journal(app_url, serial)) == 1

    desk_answers(wiremock)
    day = far_day()
    hold_key = idempotency_key()
    hold_body = {"model": "VK-20", "from": day, "days": 1}
    with concurrent.futures.ThreadPoolExecutor(len(bases)) as pool:
        holds = list(pool.map(lambda b: api(b, "POST", "/api/holds", hold_body, key=hold_key), bases))
    assert {r.status_code for r in holds} == {201}, [r.text[:200] for r in holds]
    assert len({r.json()["id"] for r in holds}) == 1
    assert len(asked_for(wiremock, day)) == 1, "one key, one desk call"


def test_hire_desk_outage(app_url: str, wiremock: WireMock) -> None:
    down = outage("APP_WIREMOCK_DOWN_URL")
    unavailable = "The hire desk isn't answering. Your shelf and layouts still work; nothing has been held."
    problem(api(down, "GET", f"/api/hire/stock?model=VK-20&from={far_day()}&days=1"), 503, "hire_desk_unavailable", unavailable)
    refused = problem(ask_hold(down), 503, "hire_desk_unavailable", unavailable)
    assert state(hold_of(app_url, refused["holdId"])["status"]) == "released", "a refused first send is definite"

    hold = held_hold(app_url, wiremock)
    wiremock_count = len(wiremock.requests(hold.release))
    stands = "The hire desk isn't answering. Your hold stands until it lapses."
    problem(api(down, "POST", f"/api/holds/{hold.id}/quote", {}), 503, "hire_release_unavailable", stands)
    problem(api(down, "POST", f"/api/holds/{hold.id}/release", {}, key=idempotency_key()), 503, "hire_release_unavailable", stands)
    assert state(hold_of(down, hold.id)["status"]) == "held"
    assert len(wiremock.requests(hold.release)) == wiremock_count

    assert ok(api(down, "GET", "/api/health")) == {"status": "ok"}
    made = ready(down)
    serial = buy(down)
    assert shelf_item(down, serial)["free"] is True
    ok(post_placement(down, made.layout, place_input(buy(down, "LS-13"), made.circuit, serial, aim=("30", "6"))), 201)
    assert len(layout_of(down, made.layout)[0]["placements"]) == 2

    wiremock.fault("GET", "/v1/stock")
    problem(api(app_url, "GET", f"/api/hire/stock?model=VK-20&from={far_day()}&days=1"), 503, "hire_desk_unavailable", unavailable)
    wiremock.stub("GET", "/v1/stock", json={"model": "VK-20", "available": 4, "dayRateCents": RATE_CENTS})
    assert ok(api(app_url, "GET", f"/api/hire/stock?model=VK-20&from={far_day()}&days=1"))["available"] == 4, "recovers without a restart"


def test_hold_window_server_clock(app_url: str, wiremock: WireMock) -> None:
    hold = held_hold(app_url, wiremock, expires=6)
    seen_lapsed = False
    deadline = time.monotonic() + API_DEADLINE_S
    while time.monotonic() < deadline and not seen_lapsed:
        current = hold_of(app_url, hold.id)
        now, end = instant(current["serverNow"]), instant(current["expiresAt"])
        if now < end:
            assert state(current["status"]) == "held"
            assert abs(current["remainingSeconds"] - math.ceil((end - now).total_seconds())) <= 1
        else:
            assert state(current["status"]) == "lapsed" and current["remainingSeconds"] == 0
            seen_lapsed = True
        _TICK.wait(TICK_S)
    assert seen_lapsed, "GET /api/holds/<id> never read Lapsed after expiresAt"
    lapsed = "This hold has lapsed. Bodies drawn on it need a body again."
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}), 409, "hold_lapsed", lapsed)
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()), 409, "hold_lapsed", lapsed)
    problem(api(app_url, "POST", f"/api/holds/{hold.id}/release", {}, key=idempotency_key()), 409, "hold_lapsed", lapsed)
    assert wiremock.requests(hold.confirm) == []


def test_lapse_once_across_processes(app_url: str, wiremock: WireMock) -> None:
    stream = Stream(app_url)
    hold = held_hold(app_url, wiremock, expires=3)
    poll(lambda: stream.of("hold.changed", id=hold.id, status=hold_of(app_url, hold.id)["status"]) if state(hold_of(app_url, hold.id)["status"]) == "lapsed" else None,
         3 + LAPSE_COMMIT_S + DELIVERY_S, "no Lapsed event within the sweep bound")
    poll(lambda: len(wiremock.requests(hold.release, "POST")) >= 1, API_DEADLINE_S, "the desk never received release")
    deadline = time.monotonic() + SWEEP_S * 2 + 1
    while time.monotonic() < deadline:
        assert len(wiremock.requests(hold.release, "POST")) == 1, "an answered release is sent once across processes"
        _TICK.wait(TICK_S)
    assert len([f for f in stream.of("hold.changed", id=hold.id) if state(f["data"]["status"]) == "lapsed"]) == 1

    failing = NS(**vars(desk_answers(wiremock, expires=2)))
    wiremock.fault("POST", failing.release)
    failing.id = ok(ask_hold(app_url), 201)["id"]
    poll(lambda: len(wiremock.requests(failing.release, "POST")) >= 2, API_DEADLINE_S, "a failed release was not retried")
    wiremock.stub("POST", failing.release, json={"status": "released"})
    count = len(wiremock.requests(failing.release, "POST"))
    poll(lambda: len(wiremock.requests(failing.release, "POST")) > count, API_DEADLINE_S, "release was not repeated until answered")
    count = len(wiremock.requests(failing.release, "POST"))
    deadline = time.monotonic() + SWEEP_S * 2 + 1
    while time.monotonic() < deadline:
        assert len(wiremock.requests(failing.release, "POST")) <= count + 1, "release continued after an answer"
        _TICK.wait(TICK_S)
    stream.stop()


def test_issue_gates(app_url: str) -> None:
    empty = ready(app_url, 0)
    problem(issue(app_url, empty.layout), 409, "layout_needs_bodies", "0 placements still need a confirmed body.")
    short = ready(app_url, 1)
    ok(post_placement(app_url, short.layout, place_input(buy(app_url, "LS-13"), short.circuit, model="VK-20", aim=("30", "6"))), 201)
    assert layout_of(app_url, short.layout)[0]["placements"][1]["status"] == "Needs a body"
    problem(issue(app_url, short.layout), 409, "layout_needs_bodies", "1 placements still need a confirmed body.")
    assert shelf_item(app_url, short.serials[0])["free"] is True

    moved = ready(app_url, 1)
    other = new_site(app_url, "5", "5")["id"]
    ok(move(app_url, "sent_to_site", moved.serials[0], siteId=other), 201)
    problem(issue(app_url, moved.layout), 409, "body_not_available", f"{moved.serials[0]} isn't on the shelf or at this site.")

    heavy = ready(app_url, 0)
    circuits = {}
    for name in ("Beta", "Alpha"):
        circuits[name] = ok(api(app_url, "POST", f"/api/sites/{heavy.id}/circuits", {"name": name, "kind": "230V-16A"}, key=idempotency_key()), 201)["id"]
    for index, name in enumerate(("Beta", "Beta", "Alpha", "Alpha")):
        ok(post_placement(app_url, heavy.layout, place_input(buy(app_url, "LS-13"), circuits[name], buy(app_url), aim=(str(6 + 8 * index), "6"))), 201)
    loads = {c["name"]: c for c in ok(api(app_url, "GET", f"/api/layouts/{heavy.layout}/circuits"))["items"]}
    assert loads["Alpha"]["loadWatts"] == 2 * VK20_WATTS and loads["Alpha"]["capacityWatts"] == CIRCUIT_16A_WATTS
    assert loads["Alpha"]["overloaded"] is True and loads["Mains"]["overloaded"] is False
    problem(issue(app_url, heavy.layout), 409, "circuit_overloaded", f"Circuit Alpha is overloaded: {2 * VK20_WATTS} W on {CIRCUIT_16A_WATTS} W.")
    for made in (empty, short, moved, heavy):
        assert state(layout_of(app_url, made.layout)[0]["sheetStatus"]) == DRAFT
        assert made.layout not in " ".join(S3().keys("sheets/"))


@pytest.mark.timeout(400)
def test_issue_survives_stopped_process(app_url: str, wiremock: WireMock) -> None:
    made = ready(app_url)
    path = "/forms/chromium/convert/html"
    key = idempotency_key()
    wiremock.stub("POST", path, status=200, body="%PDF-late", headers={"Content-Type": "application/pdf"}, delay_ms=PRESS_LIMIT_MS - 5000)
    with app_copy(GOTENBERG_URL=os.environ["WIREMOCK_URL"]) as copy, concurrent.futures.ThreadPoolExecutor(1) as pool:
        attempt = pool.submit(_swallow_issue, copy.url, made.layout, key)
        poll(lambda: wiremock.requests(path, "POST"), API_DEADLINE_S, "the copy never reached the press")
        kill_group(copy.proc)
        copy.proc.wait()
        attempt.result()
    def retried() -> Any:
        resp = issue(app_url, made.layout, key)
        return resp if resp.status_code == 201 else None
    sheet = poll(retried, STOPPED_KEY_S + API_DEADLINE_S, "the stopped process's key never came free").json()
    assert sheet["version"] == 1 and state(sheet["status"]) == "issued"
    assert S3().get(sheet["key"]).startswith(b"%PDF-1"), "the stored PDF is the real one"


def test_one_winner_issue(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    made = ready(app_url)
    layouts = [made.layout]
    for index in range(3):
        extra = ok(api(app_url, "POST", f"/api/sites/{made.id}/layouts", {"name": f"Copy {index}"}, key=idempotency_key()), 201)
        ok(post_placement(app_url, extra["id"], place_input(made.lenses[0], made.circuit, made.serials[0], aim=("6", "6"))), 201)
        layouts.append(extra["id"])
    before = set(S3().keys("sheets/"))
    with concurrent.futures.ThreadPoolExecutor(4) as pool:
        answers = list(pool.map(lambda pair: issue(pair[0], pair[1]), zip([app_url, peer, app_url, peer], layouts)))
    winners = [r for r in answers if r.status_code == 201]
    assert len(winners) == 1, [r.text[:200] for r in answers]
    for loser in answers:
        if loser.status_code != 201:
            problem(loser, 409, "body_in_issued_rig")
    assert set(S3().keys("sheets/")) - before == {winners[0].json()["key"]}
    statuses = sorted(state(layout_of(app_url, l)[0]["sheetStatus"]) for l in layouts)
    assert statuses == [DRAFT] * 3 + ["issued"]


def test_rig_sheet_pdf_contents(app_url: str, wiremock: WireMock) -> None:
    site = new_site(app_url, "24", "12", show="2027-07-01T20:00")
    layout_id, circuit = site["layouts"][0]["id"], site["circuits"][0]["id"]
    hold = held_hold(app_url, wiremock)
    lens = buy(app_url, "LS-13")
    ok(post_placement(app_url, layout_id, place_input(lens, circuit, hold=hold.id, ratio="1.4", shift=("10", "-5"))), 201)
    ok(api(app_url, "POST", f"/api/holds/{hold.id}/quote", {}))
    ok(api(app_url, "POST", f"/api/holds/{hold.id}/confirm", {}, key=idempotency_key()))
    sync(app_url, site["id"], ("M12", "30", "lx", OLD_CAPTURE))
    sheet = ok(issue(app_url, layout_id), 201)
    stored = S3().get(sheet["key"])
    text = " ".join(pdf_text(stored).split())
    contrast = layout_cell(app_url, layout_id, "M12")["contrastText"].split()[0]
    for fact in (
        "Rig sheet", site["name"], "Main layout", "Sheet version 1", "Show time 2027-07-01 20:00", f"Lowest reading {contrast} to 1",
        "Scale 1:100", hold.serial, lens, "Aim 6.5 / 6.0 m", "Standoff 18.0 m", "Ratio 1.4 to 1", "Shift 10.0% / -5.0%",
        "Mains", "400V-CEE-32A", f"{VK20_WATTS} W of {MAINS_WATTS} W",
    ):
        assert fact in text, f"{fact!r} missing from the rig sheet: {text[:600]}"
    for price in ("VAT", "199,65", "19965", "165,00", "16500"):
        assert price not in text, f"the rig sheet shows {price!r}"
    bare = ready(app_url)
    bare_sheet = ok(issue(app_url, bare.layout), 201)
    bare_text = " ".join(pdf_text(api(app_url, "GET", f"/api/sheets/{bare_sheet['id']}/pdf").content).split())
    assert "Lowest reading none" in bare_text
    assert "Scale 1:200" in bare_text, "a 48 m wall fits 0.27 m at 1:200"


def test_technician_view_reveals_only_sheet(app_url: str, wiremock: WireMock) -> None:
    other = new_site(app_url, "5", "5")
    made = issued(app_url)
    token = made.token
    assert re.fullmatch(r"[A-Za-z0-9_-]{22,}", token), "an opaque URL-safe token of at least 128 bits"
    resp = api(app_url, "GET", f"/api/rig/{token}")
    view = ok(resp)
    assert view["siteName"] == made.site["name"] and view["layoutName"] == "Main layout"
    assert state(view["sheetStatus"]) == "issued" and view["issuedAt"] == made.sheet["issuedAt"]
    assert [(c["name"], c["loadWatts"], c["capacityWatts"], c["live"]) for c in view["circuits"]] == [("Mains", VK20_WATTS, MAINS_WATTS, False)]
    assert "no-store" in resp.headers["cache-control"] and resp.headers["referrer-policy"] == "no-referrer"
    assert other["name"] not in resp.text
    for word in ("dayRateCents", "totalCents", "quote", "netCents"):
        assert word not in resp.text
    pdf = api(app_url, "GET", f"/api/rig/{token}/sheet.pdf")
    assert pdf.headers["content-type"].startswith("application/pdf") and pdf.content == S3().get(made.sheet["key"])
    assert "no-store" in pdf.headers["cache-control"]
    html = api(app_url, "GET", f"/rig/{token}")
    assert html.status_code == 200 and "no-store" in html.headers["cache-control"] and html.headers["referrer-policy"] == "no-referrer"
    assert made.site["name"] not in html.text and "Mains" not in html.text, "the page's own HTML holds no sheet data"
    problem(api(app_url, "GET", f"/api/rig/{uid()}{uid()}{uid()}"), 404, "link_not_found", "This rig sheet link doesn't exist.")
    circuit = made.sheet["circuits"][0]["id"]
    refused = [
        api(app_url, "POST", f"/api/rig/{token}/circuits/{circuit}/live", {"live": "yes"}),
        api(app_url, "DELETE", f"/api/rig/{token}"),
        api(app_url, "GET", f"/api/rig/{uid()}{uid()}{uid()}"),
    ]
    with httpx.stream("GET", f"{app_url}/api/rig/{token}/events", timeout=HTTP_TIMEOUT_S) as events:
        refused.append(events)
    for answer in refused:
        assert "no-store" in answer.headers.get("cache-control", ""), f"{answer.request.method} {answer.request.url} {answer.status_code} may be stored"
        assert answer.headers.get("referrer-policy") == "no-referrer", f"{answer.request.method} {answer.request.url} {answer.status_code} lacks Referrer-Policy: no-referrer"


def test_checklist_only_write(app_url: str) -> None:
    made, other = issued(app_url), issued(app_url)
    circuit, foreign = made.sheet["circuits"][0]["id"], other.sheet["circuits"][0]["id"]
    live = f"/api/rig/{made.token}/circuits/{circuit}/live"
    layout_before = layout_of(app_url, made.layout)[0]
    stream = Stream(app_url)
    ticked = ok(api(app_url, "POST", live, {"live": True}))
    assert ticked["id"] == circuit and ticked["live"] is True and ticked["confirmedAt"]
    poll(lambda: stream.of("circuit.confirmed", circuitId=circuit, live=True), DELIVERY_S * 2, "tick wrote no event")
    ok(api(app_url, "POST", live, {"live": True}))
    assert len(stream.of("circuit.confirmed", circuitId=circuit)) == 1, "a tick that changes nothing writes no event"
    problem(api(app_url, "POST", f"/api/rig/{made.token}/circuits/{foreign}/live", {"live": True}), 404, "not_found")
    assert ok(api(app_url, "GET", f"/api/rig/{other.token}"))["circuits"][0]["live"] is False
    invalid(api(app_url, "POST", live, {"live": "yes"}), "Say true or false.", "/live")
    problem(api(app_url, "POST", live, {"live": True, "name": "x"}), 422, "unknown_field", "Unknown field: name.")
    problem(api(app_url, "POST", live, {"live": True}, headers={"Origin": MOVEMENT_ORIGIN_PROBE}), 403, "origin_refused", "This request came from another site.")
    for method, path in (("DELETE", f"/api/rig/{made.token}"), ("POST", f"/api/rig/{made.token}"), ("PUT", live), ("POST", f"/api/rig/{made.token}/sheet.pdf")):
        problem(api(app_url, method, path, {} if method != "DELETE" else None), 405, "method_not_allowed", "That method isn't allowed here.")
    assert "allow" in api(app_url, "DELETE", f"/api/rig/{made.token}").headers
    problem(api(app_url, "POST", f"/api/rig/{made.token}/withdraw", {}), 404, "not_found")
    assert layout_of(app_url, made.layout)[0]["version"] == layout_before["version"]
    assert state(ok(api(app_url, "GET", f"/api/sheets/{made.sheet['id']}"))["status"]) == "issued"
    stream.stop()


@pytest.mark.timeout(240)
def test_shared_link_limit(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    made, other = issued(app_url), issued(app_url)
    path = f"/api/rig/{made.token}"
    for index in range(LINK_LIMIT):
        ok(api(peer if index % 2 else app_url, "GET", path))
    for base in (app_url, peer):
        limited = api(base, "GET", path)
        problem(limited, 429, "link_rate_limited", "Too many requests on this link. Try again shortly.")
        retry = limited.headers["retry-after"]
        assert retry.isdigit() and 0 < int(retry) <= LINK_WINDOW_S
    ok(api(app_url, "GET", f"/api/rig/{other.token}"))
    poll(lambda: api(app_url, "GET", path).status_code == 200, LINK_WINDOW_S + DELIVERY_S * 5, "no slot freed after the rolling window")


def test_mask_job_phases_and_cancel(app_url: str) -> None:
    slow = outage("APP_SLOW_MASKS_URL")
    made = ready(slow, 2)
    start_view, _ = layout_of(slow, made.layout)
    job = ok(api(slow, "POST", f"/api/layouts/{made.layout}/mask-jobs", {}, key=idempotency_key()), 202)
    assert job["layoutHash"] == start_view["hash"] and job["stepsTotal"] == 3 and job["stepsDone"] == 0
    problem(api(slow, "GET", f"/api/mask-jobs/{job['id']}/bundle"), 404, "not_found")
    ok(post_placement(slow, made.layout, place_input(buy(slow, "LS-13"), made.circuit, buy(slow), aim=("30", "6"))), 201)
    phases, done_values = [], []
    deadline = time.monotonic() + LEASE_DEADLINE_S
    current = job
    while time.monotonic() < deadline and current["phase"] != "done":
        current = ok(api(slow, "GET", f"/api/mask-jobs/{job['id']}"))
        phases.append(current["phase"])
        done_values.append(current["stepsDone"])
        _TICK.wait(TICK_S)
    assert current["phase"] == "done", f"mask job never finished: {phases[-5:]}"
    assert set(phases) <= {"queued", "rendering", "storing", "waiting_for_store", "done"}
    assert "rendering" in phases and done_values == sorted(done_values)
    assert any(0 < value < 3 for value in done_values), "progress must pass through real steps"
    assert current["stepsDone"] == 3 and current["layoutHash"] == start_view["hash"]
    names = zipfile.ZipFile(io.BytesIO(api(slow, "GET", f"/api/mask-jobs/{job['id']}/bundle").content)).namelist()
    assert names == sorted(f"masks/{s}.png" for s in made.serials), "the bundle is the layout at the job's start"
    problem(api(slow, "DELETE", f"/api/mask-jobs/{job['id']}"), 409, "job_finished", "This mask job has already finished.")

    cancel_me = ok(api(slow, "POST", f"/api/layouts/{made.layout}/mask-jobs", {}, key=idempotency_key()), 202)
    assert api(slow, "DELETE", f"/api/mask-jobs/{cancel_me['id']}").status_code == 200
    poll(lambda: ok(api(slow, "GET", f"/api/mask-jobs/{cancel_me['id']}"))["phase"] == "cancelled", API_DEADLINE_S, "job never cancelled")
    final = ok(api(slow, "GET", f"/api/mask-jobs/{cancel_me['id']}"))
    assert final["stepsDone"] < final["stepsTotal"]
    problem(api(slow, "GET", f"/api/mask-jobs/{cancel_me['id']}/bundle"), 404, "not_found")
    assert f"masks/{made.layout}/{final['layoutHash']}.zip" not in S3("-slow").keys(f"masks/{made.layout}/")

    short = ready(app_url, 0)
    ok(post_placement(app_url, short.layout, place_input(buy(app_url, "LS-13"), short.circuit, model="VK-20")), 201)
    problem(api(app_url, "POST", f"/api/layouts/{short.layout}/mask-jobs", {}, key=idempotency_key()), 409, "layout_needs_bodies")


def test_bundle_byte_identical(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    made = ready(app_url, 2)
    first = finished_job(app_url, made.layout)
    bundle = api(app_url, "GET", f"/api/mask-jobs/{first['id']}/bundle")
    assert bundle.headers["content-type"].startswith("application/zip")
    second = finished_job(peer, made.layout)
    assert api(peer, "GET", f"/api/mask-jobs/{second['id']}/bundle").content == bundle.content
    assert first["sha256"] == second["sha256"] == hashlib.sha256(bundle.content).hexdigest()
    assert first["key"] == f"masks/{made.layout}/{first['layoutHash']}.zip"
    assert S3().get(first["key"]) == bundle.content
    archive = zipfile.ZipFile(io.BytesIO(bundle.content))
    infos = archive.infolist()
    assert [i.filename for i in infos] == sorted(f"masks/{s}.png" for s in made.serials)
    for info in infos:
        assert info.compress_type == zipfile.ZIP_STORED and info.date_time == (1980, 1, 1, 0, 0, 0)
        data = archive.read(info)
        assert data.startswith(b"\x89PNG")
        assert struct.unpack(">IIBB", data[16:26]) == (NATIVE_WIDTH, NATIVE_HEIGHT, 8, 0)
        for chunk in (b"tIME", b"tEXt", b"iTXt", b"zTXt"):
            assert chunk not in data[:64] and chunk not in data[-64:], f"{chunk!r} chunk in a mask"
        serial = info.filename.split("/")[1].removesuffix(".png")
        assert S3().get(f"masks/{made.layout}/{first['layoutHash']}/{serial}.png") == data

    view, tag = layout_of(app_url, made.layout)
    pid = view["placements"][0]["id"]
    changed = api(app_url, "PATCH", f"/api/layouts/{made.layout}/placements/{pid}", {"ratio": "1.4"}, headers={"If-Match": tag})
    assert ok(changed)["hash"] != view["hash"]
    reverted = ok(api(app_url, "PATCH", f"/api/layouts/{made.layout}/placements/{pid}", {"ratio": "1.3"}, headers={"If-Match": changed.headers["etag"]}))
    assert reverted["hash"] == view["hash"]
    third = finished_job(peer, made.layout)
    assert api(app_url, "GET", f"/api/mask-jobs/{third['id']}/bundle").content == bundle.content


@pytest.mark.timeout(400)
def test_job_resumes_after_stopped_process(app_url: str) -> None:
    slow, peer = outage("APP_SLOW_MASKS_URL"), outage("APP_SLOW_MASKS_PEER_URL")
    env = {
        "DATABASE_URL": os.environ["DATABASE_URL"] + "_slow", "S3_BUCKET": os.environ["S3_BUCKET"] + "-slow", "MASK_STEP_MILLISECONDS": "1500",
    }
    made = ready(slow, 2)
    with app_copy(**env) as copy:
        job = ok(api(copy.url, "POST", f"/api/layouts/{made.layout}/mask-jobs", {}, key=idempotency_key()), 202)
        kill_group(copy.proc, signal.SIGSTOP)
        seen = []
        def finished() -> Any:
            current = ok(api(peer, "GET", f"/api/mask-jobs/{job['id']}"))
            seen.append(current["stepsDone"])
            return current if current["phase"] == "done" else None
        final = poll(finished, LEASE_DEADLINE_S, "no healthy process resumed the stopped job")
        assert seen == sorted(seen), f"stepsDone fell: {seen}"
        bundle = api(slow, "GET", f"/api/mask-jobs/{job['id']}/bundle").content
        kill_group(copy.proc, signal.SIGCONT)
        deadline = time.monotonic() + SWEEP_S * 2
        while time.monotonic() < deadline:
            current = ok(api(slow, "GET", f"/api/mask-jobs/{job['id']}"))
            assert current["phase"] == "done" and current["stepsDone"] == final["stepsDone"], "a stopped worker's late write was not fenced"
            _TICK.wait(TICK_S)
        assert api(peer, "GET", f"/api/mask-jobs/{job['id']}/bundle").content == bundle
        assert hashlib.sha256(bundle).hexdigest() == final["sha256"]


@pytest.mark.timeout(500)
def test_job_resumes_after_store_block(browser: Browser) -> None:
    down = outage("APP_STORE_DOWN_ALONE_URL")
    env = {"DATABASE_URL": os.environ["DATABASE_URL"] + "_storedown", "S3_BUCKET": os.environ["S3_BUCKET"] + "-storedown"}
    with app_copy(**env) as copy:
        made = issued(copy.url)
    with open_app(browser, f"{down}/sheets/{made.sheet['id']}") as page:
        shows(page, role(page, "button", "Build masks"))
        job_id = build_masks(page)
        poll(lambda: ok(api(down, "GET", f"/api/mask-jobs/{job_id}"))["phase"] == "waiting_for_store", API_DEADLINE_S, "job never set waiting_for_store")
        says(page, role(page, "status", "Masks"), "The sheet store isn't answering. The mask bundle will carry on when it returns.")
    blocked = ok(api(down, "GET", f"/api/mask-jobs/{job_id}"))
    with app_copy(**env) as copy:
        def done() -> Any:
            current = ok(api(copy.url, "GET", f"/api/mask-jobs/{job_id}"))
            return current if current["phase"] == "done" else None
        final = poll(done, LEASE_DEADLINE_S, "a healthy process never resumed the store-blocked job")
        assert final["stepsDone"] >= blocked["stepsDone"]
        assert S3("-storedown").get(final["key"]) == api(copy.url, "GET", f"/api/mask-jobs/{job_id}/bundle").content


def test_outbox_stream_resume(app_url: str) -> None:
    peer = outage("APP_PEER_URL")
    stream = Stream(app_url)
    assert stream.status == 200
    serial = f"T-{uid()}"
    ok(move(peer, "bought", serial, model="VK-20"), 201)
    returned_at = time.monotonic()
    frame = poll(lambda: [f for f in stream.frames if f["payload"]["type"] == "kit.moved" and f["payload"]["data"]["serial"] == serial], DELIVERY_S + TICK_S * 2, "kit.moved missed the delivery bound")[0]
    assert frame["arrived"] - returned_at <= DELIVERY_S
    payload = frame["payload"]
    assert frame["event"] == "kit.moved" and frame["id"] == str(payload["sequence"])
    assert payload["aggregate"] == "kit" and payload["aggregateId"] == serial and instant(payload["at"])
    assert set(payload["data"]) == {"movementId", "serial", "from", "to"} and (payload["data"]["from"], payload["data"]["to"]) == ("outside", "shelf")

    count = len(stream.frames)
    problem(move(app_url, "bought", serial, model="VK-20"), 409, "serial_exists")
    resume_at = frame["id"]
    serials = [f"T-{uid()}" for _ in range(8)]
    bases = [app_url, peer] * 4
    with concurrent.futures.ThreadPoolExecutor(8) as pool:
        for resp in pool.map(lambda pair: move(pair[0], "bought", pair[1], model="VK-20"), zip(bases, serials)):
            ok(resp, 201)
    poll(lambda: all(stream.of("kit.moved", serial=s) for s in serials), DELIVERY_S * 3, "a concurrent commit never reached the stream")
    assert all(f["payload"]["data"].get("serial") in serials or f["payload"]["type"] != "kit.moved" for f in stream.frames[count:]), "a refused action wrote an event"
    sequence = [int(f["id"]) for f in stream.frames]
    assert sequence == sorted(set(sequence)) and sequence == list(range(sequence[0], sequence[-1] + 1)), f"sequence not dense: {sequence}"
    resumed = Stream(peer, last_event_id=resume_at)
    poll(lambda: all(resumed.of("kit.moved", serial=s) for s in serials), DELIVERY_S * 3, "resume on another process missed events")
    got = [int(f["id"]) for f in resumed.frames]
    assert got == list(range(int(resume_at) + 1, got[-1] + 1)), f"resume had gaps or duplicates: {got}"
    assert poll(lambda: stream.comments, COMMENT_S + DELIVERY_S, "no comment line inside the published interval")
    stream.stop()
    resumed.stop()


@pytest.mark.timeout(400)
def test_stream_survives_database_loss(app_url: str) -> None:
    parts = urlsplit(os.environ["DATABASE_URL"])
    credentials, _, place = parts.netloc.rpartition("@")
    host, _, port = place.partition(":")
    relay = TcpRelay(host, int(port or 5432))
    netloc = f"{credentials}@127.0.0.1:{relay.port}" if credentials else f"127.0.0.1:{relay.port}"
    with app_copy(DATABASE_URL=urlunsplit(parts._replace(netloc=netloc))) as copy:
        stream = Stream(copy.url)
        before = f"T-{uid()}"
        ok(move(app_url, "bought", before, model="VK-20"), 201)
        poll(lambda: stream.of("kit.moved", serial=before), DELIVERY_S * 3, "stream missed an event before the loss")
        last = stream.frames[-1]["id"]
        relay.cut()
        poll(lambda: api(copy.url, "GET", "/api/health").status_code == 503, API_DEADLINE_S, "health never reported the lost database")
        problem(api(copy.url, "GET", "/api/health"), 503, "database_unavailable", "The workspace can't reach its records right now. Try again shortly.")
        problem(api(copy.url, "GET", "/api/kit/shelf"), 503, "database_unavailable")
        during = f"T-{uid()}"
        ok(move(app_url, "bought", during, model="VK-20"), 201)
        relay.start()
        poll(lambda: healthy(copy.url), API_DEADLINE_S, "the copy needed a restart to recover")
        assert copy.proc.poll() is None
        def delivered_or_closed() -> bool:
            return bool(stream.of("kit.moved", serial=during)) or stream.closed.is_set()
        poll(delivered_or_closed, DB_RETURN_S + TICK_S * 4, "an open stream neither resumed nor closed")
        resumed = Stream(copy.url, last_event_id=last)
        poll(lambda: resumed.of("kit.moved", serial=during), DB_RETURN_S, "resume lost the event committed during the loss")
        got = [int(f["id"]) for f in resumed.frames]
        assert got == list(range(int(last) + 1, got[-1] + 1)), f"resume had gaps or duplicates: {got}"
        stream.stop()
        resumed.stop()


def test_problem_details_precedence(app_url: str) -> None:
    problem(api(app_url, "GET", "/api/nothing-here"), 404, "not_found", "Nothing here.")
    problem(api(app_url, "GET", "/missing-file.js"), 404, "not_found", "Nothing here.")
    refused = api(app_url, "DELETE", "/api/sites")
    problem(refused, 405, "method_not_allowed", "That method isn't allowed here.")
    assert "POST" in refused.headers["allow"]
    good = {"name": unique("Wall")[0], "width": Q("5"), "height": Q("5"), "showAtLocal": SHOW_AT}
    json_type = {"Content-Type": "application/json"}
    too_large = b'{"pad":"' + b"x" * JSON_LIMIT + b'"}'
    problem(api(app_url, "POST", "/api/sites", content=too_large, headers=json_type, key=idempotency_key()), 413, "body_too_large", "That request body is too large.")
    exact = b'{"name":"' + b"x" * (JSON_LIMIT - 11) + b'"}'
    assert len(exact) == JSON_LIMIT
    assert api(app_url, "POST", "/api/sites", content=exact, headers=json_type, key=idempotency_key()).status_code == 422, "the limit is inclusive"
    problem(api(app_url, "POST", "/api/sites", content=b"{}", headers={"Content-Type": "text/plain"}, key=idempotency_key()), 415, "unsupported_media_type", "This request must be JSON.")
    problem(api(app_url, "POST", "/api/sites", content=b"{oops", headers=json_type, key=idempotency_key()), 400, "malformed_body", "That request body couldn't be read.")
    problem(api(app_url, "POST", "/api/sites", [], key=idempotency_key()), 400, "malformed_body")
    problem(api(app_url, "POST", "/api/sites", {**good, "extra": 1}, key=idempotency_key()), 422, "unknown_field", "Unknown field: extra.")
    nested = {**good, "width": {**Q("5"), "extra": 1}}
    assert problem(api(app_url, "POST", "/api/sites", nested, key=idempotency_key()), 422, "unknown_field")
    for sneaky in (b'{"__proto__":{}}', b'{"constructor":{}}'):
        problem(api(app_url, "POST", "/api/sites", content=sneaky, headers=json_type, key=idempotency_key()), 422, "unknown_field")
    invalid(api(app_url, "POST", "/api/sites", {k: v for k, v in good.items() if k != "name"}, key=idempotency_key()), "This is required.", "/name")

    foreign = {"Origin": MOVEMENT_ORIGIN_PROBE}
    problem(api(app_url, "DELETE", "/api/sites", headers=foreign), 403, "origin_refused")
    problem(api(app_url, "DELETE", "/api/sites", content=b"{oops", headers=json_type), 405, "method_not_allowed")
    problem(api(app_url, "POST", "/api/sites", content=b"{oops", headers=json_type), 400, "malformed_body")
    ghost = f"/api/sites/{uid()}/circuits"
    problem(api(app_url, "POST", ghost, {"name": "x", "kind": "230V-16A"}), 400, "idempotency_key_required")
    problem(api(app_url, "POST", ghost, {"name": "x", "kind": "230V-16A"}, key=idempotency_key()), 404, "not_found")

    made = ready(app_url, 0)
    path = f"/api/layouts/{made.layout}/placements"
    bad = place_input("x", made.circuit, ratio="zero")
    problem(api(app_url, "POST", path, bad, key=idempotency_key()), 428, "precondition_required")
    problem(api(app_url, "POST", path, bad, key=idempotency_key(), headers={"If-Match": '"old"'}), 412, "layout_changed")
    key = idempotency_key()
    site_body = {**good, "name": unique("Wall")[0]}
    stored = ok(api(app_url, "POST", "/api/sites", site_body, key=key), 201)
    assert api(app_url, "POST", "/api/sites", site_body, key=key).json() == stored, "a replay answers before any state check"
    problem(api(app_url, "POST", f"/api/sites/{made.id}/rectification", {"points": []}), 409, "photo_missing")


def test_server_boundary(app_url: str) -> None:
    body = {"name": unique("Wall")[0], "width": Q("5"), "height": Q("5"), "showAtLocal": SHOW_AT}
    for origin in (MOVEMENT_ORIGIN_PROBE, "null", app_url.replace("http://", "https://")):
        problem(api(app_url, "POST", "/api/sites", body, key=idempotency_key(), headers={"Origin": origin}), 403, "origin_refused", "This request came from another site.")
    ok(api(app_url, "POST", "/api/sites", body, key=idempotency_key(), headers={"Origin": app_url}), 201)
    ok(api(app_url, "POST", "/api/sites", {**body, "name": unique("Wall")[0]}, key=idempotency_key()), 201)

    secrets = [os.environ[n] for n in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL") if os.environ.get(n)]
    for path in ("/run.json", "/package.json", "/.env", "/.git/config", "/node_modules/.package-lock.json", "/tsconfig.json",
                 "/THIRD_PARTY_NOTICES.md/../run.json", "/%2e%2e/run.json", "/assets/%2e%2e/%2e%2e/package.json"):
        resp = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S)
        assert "run-manifest-v1" not in resp.text and resp.headers.get("content-type", "").split(";")[0] != "application/json", f"{path} served a project file"
        assert not any(s in resp.text for s in secrets), f"{path} leaked a credential"
    html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
    for asset in re.findall(r"""(?:src|href)=["'](/[^"']+)["']""", html):
        served = httpx.get(app_url + asset, timeout=HTTP_TIMEOUT_S).text
        assert not any(s in served for s in secrets), f"{asset} carries a credential"

    for name in ("APP_MINIO_DOWN_URL", "APP_GOTENBERG_DOWN_URL", "APP_WIREMOCK_DOWN_URL"):
        base = outage(name)
        assert ok(api(base, "GET", "/api/health")) == {"status": "ok"}
        assert shelf(base)["models"]
    fault = api(outage("APP_WIREMOCK_DOWN_URL"), "GET", f"/api/hire/stock?model=VK-20&from={far_day()}&days=1")
    problem(fault, 503, "hire_desk_unavailable", "The hire desk isn't answering. Your shelf and layouts still work; nothing has been held.")
    assert os.environ["WIREMOCK_URL"] not in fault.text


def test_hero_sentence_controls(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        title = heading(page, "MEASURE THE WALL BEFORE THE LIGHT")
        shows(page, title)
        shows(page, role(page, "link", "Nachtwit"))
        assert role(page, "link", "Survey a wall").get_attribute("href").rstrip("/").endswith("/sites")
        wall = role(page, "img", "Zuiderhal demo wall")
        output, throw = role(page, "slider", "Output"), role(page, "slider", "Throw")
        capitals = role(page, "switch", "Capitals")
        assert animations(title) == [] and animations(wall) == [], "nothing moves unless a chip is changed"
        expect(page.get_by_text("20 000 lm", exact=True).first).to_be_visible()
        expect(page.get_by_text("1.3 to 1", exact=True).first).to_be_visible()
        lit, type_before = decode(capture(wall)), hero_signature(title, "font-weight", "font-variation-settings")
        output.focus()
        page.keyboard.press("ArrowRight")
        stepped = f"{OUTPUT_START + OUTPUT_STEP:,}".replace(",", " ") + " lm"
        says(page, page.get_by_text(stepped, exact=True).first, stepped)
        page.keyboard.press("End")
        says(page, page.get_by_text("40 000 lm", exact=True).first, "40 000 lm")
        advance(page, 300)
        assert difference(lit, decode(capture(wall))) > 0, "Output changes the wall's brightness"
        assert hero_signature(title, "font-weight", "font-variation-settings") != type_before, "Output changes the headline's weight"
        page.keyboard.press("Home")
        says(page, page.get_by_text("5 000 lm", exact=True).first, "5 000 lm")
        gaps = hero_signature(title, "letter-spacing", "word-spacing", "column-gap")
        throw.focus()
        page.keyboard.press("ArrowRight")
        thrown = f"{THROW_START + THROW_STEP} to 1"
        says(page, page.get_by_text(thrown, exact=True).first, thrown)
        page.keyboard.press("End")
        says(page, page.get_by_text("3.0 to 1", exact=True).first, "3.0 to 1")
        advance(page, 300)
        assert hero_signature(title, "letter-spacing", "word-spacing", "column-gap") != gaps, "Throw changes the gaps between letters"
        page.keyboard.press("Home")
        says(page, page.get_by_text("0.8 to 1", exact=True).first, "0.8 to 1")
        assert capitals.get_attribute("aria-checked") == "true"
        capitals.focus()
        page.keyboard.press("Space")
        shows(page, heading(page, "Measure the wall before the light"))
        assert capitals.get_attribute("aria-checked") == "false"
        click(capitals)
        shows(page, title)
        click(role(page, "link", "Survey a wall"))
        settled(page, lambda: assert_contains(page.url, "/sites"), what="the action going to the wall list")


def test_published_layouts(browser: Browser, app_url: str) -> None:
    with open_app(browser, f"{app_url}{SEED_PATH}") as page:
        wait_wall(page)
        wall, readings_region, bodies = role(page, "region", "Wall"), role(page, "region", "Readings"), role(page, "region", "Bodies")
        for width, height in ((375, 812), (767, 812)):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, 300)
            layout(page)
            box = wall.bounding_box()
            assert abs(box["width"] - width) <= 1 and box["x"] <= 1, f"Wall fills the width at {width}"
            toggle = role(page, "button", "Readings").bounding_box()
            assert toggle["y"] >= box["y"] and toggle["y"] + toggle["height"] <= height, "the collapsed sheet sits on the bottom edge"
            assert role(page, "button", "Readings").get_attribute("aria-expanded") == "false"
        for width, height in ((768, 1024), (1279, 1024)):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, 300)
            layout(page)
            w, r, b = wall.bounding_box(), readings_region.bounding_box(), bodies.bounding_box()
            assert w["x"] + w["width"] <= r["x"] + 1 and abs(r["x"] - b["x"]) <= 1, f"two columns at {width}"
            assert r["y"] + r["height"] <= b["y"] + 1, f"Readings stacks above Bodies at {width}"
        for width, height in ((1280, 800),):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, 300)
            layout(page)
            w, r, b = wall.bounding_box(), readings_region.bounding_box(), bodies.bounding_box()
            assert w["x"] + w["width"] <= r["x"] + 1 and r["x"] + r["width"] <= b["x"] + 1, "Wall, Readings and Bodies side by side"
            assert b["x"] + b["width"] <= width and r["y"] < w["y"] + w["height"] and b["y"] < w["y"] + w["height"]


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for member in ("install", "build", "serve"):
        assert isinstance(manifest[member], str) and manifest[member]


def test_if_notices_list_everything() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for package in shipped_packages():
        assert package.name in notices, f"{package.name} is missing from the notices"
    for name in ("Imbue", "Albert Sans", "Lucide"):
        assert name in notices, f"{name} is missing from the notices"


def test_if_licences_allowed() -> None:
    for package in shipped_packages():
        assert licence_allowed(package.licence, ALLOWED_LICENCES), f"{package.name}: {package.licence}"


def test_if_only_named_datastores() -> None:
    names = {package.name for package in shipped_packages()}
    assert not names & {"redis", "ioredis", "sqlite3", "better-sqlite3", "level", "lowdb", "nedb"}
    for pattern in ("*.sqlite", "*.sqlite3", "*.rdb"):
        found = [p for p in Path(DEPLOYED_APP).rglob(pattern) if "node_modules" not in p.parts]
        assert found == [], f"file-based state on disk: {found}"


def test_if_browser_stays_same_origin(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        requested: list[str] = []
        page.on("request", lambda request: requested.append(request.url))
        for path in ("/", "/sites", "/kit", "/hire", SEED_PATH):
            page.goto(app_url + path)
            advance(page, 500)
    foreign = [u for u in requested if u.startswith("http") and not same_origin(u, app_url)]
    assert foreign == [], f"requests left the origin: {foreign}"


def test_if_service_configuration_unchanged(app_url: str, wiremock: WireMock) -> None:
    day = far_day()
    assert ok(api(app_url, "GET", f"/api/hire/stock?model=VK-20&from={day}&days=1"))["dayRateCents"] == RATE_CENTS
    assert ok(api(app_url, "GET", f"/api/hire/stock?model=VK-12&from={day}&days=1"))["available"] == 0
    for path in Path("/app").glob("*compose*.y*ml"):
        assert "Redis".casefold() not in path.read_text().casefold(), f"{path} adds a datastore"
