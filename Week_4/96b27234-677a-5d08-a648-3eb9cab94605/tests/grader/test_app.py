from __future__ import annotations

import http
import json
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
from contextlib import ExitStack, contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Iterator
from urllib.parse import urlsplit, urlunsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    S3,
    addresses,
    advance,
    camera,
    center,
    click,
    fill,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session as cdp,
    shipped_packages,
    tab_order,
    tap,
    text as mail_text,
    until,
)

GRADING_KEY = os.environ.get("GRADING_KEY", "hearthtile-grading-7d31c9")
PASSWORD = "lantern-pass-1"
EXPECT_MS = 10_000
HTTP_SECONDS = 120
WAIT_SECONDS = 20
TAB_LIMIT = 80
TAB_PROBE = 30
BOOT_SECONDS = 180
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
MIN_TARGET_PX = 44
RIPPLE_STEP_MS = 60
RIPPLE_HOLD_MS = 500
OUTLINE_HOLD_MS = 2000
HOLD_REPEAT_MS = 250
DEDUPE_MS = 2000
RECONNECT_MS = 2000
CHAT_MAX = 300
CAPACITY_MAX = 50
INVITE_TTL = 604800
SHORT_STEP_MS = 2000
SHORT_GRACE_SECONDS = 2
HEALTH_SECONDS = 1
JSON_LIMIT = 64000
SETUP_LIMIT = 1000000
MULTIPART_LIMIT = 51000000
ALLOWED_LICENCES = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD"}
FAMILY_EMOJI = "\U0001F468\u200D\U0001F469\u200D\U0001F467\u200D\U0001F466"
DEVICE_TIME = "2031-01-01T00:00:00Z"
OUT_OF_SCOPE_PACKAGES = {
    "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3",
    "amqplib", "kafkajs", "nats", "mqtt", "level", "lmdb", "nedb",
}
SERVICE_IMAGES_BANNED = ("mongo", "mysql", "mariadb", "rabbitmq", "kafka", "nats")

expect.set_options(timeout=EXPECT_MS)

HIDDEN_ROOM = "Hidden Attic"
SIGNUP_NAME = "Sal Fern"

NAMES = {
    "ann": "Ann Ember",
    "ben": "Ben Reed",
    "carol": "Carol Moss",
    "dan": "Dan Fenn",
    "eve": "Eve Holt",
    "frank": "Frank Lowe",
    "gus": "Gus Tarn",
    "mod": "Mo Dale",
}

LOFT = {
    "width": 12,
    "height": 12,
    "spawn": [{"x": 1, "y": 1}],
    "walls": [{"x": 3, "y": 3}],
    "seats": [{"id": "seat-1", "x": 5, "y": 2}],
    "exits": [{"id": "exit-1", "x": 0, "y": 6}],
}
DEN_V1 = {"width": 8, "height": 8, "spawn": [{"x": 1, "y": 1}], "walls": [], "seats": [], "exits": []}
DEN_V2 = {"width": 8, "height": 8, "spawn": [{"x": 1, "y": 1}], "walls": [{"x": 3, "y": 3}], "seats": [], "exits": []}


def instance(env_name: str) -> str:
    value = os.environ.get(env_name)
    if not value:
        pytest.fail(f"{env_name} should name the published extra instance")
    return value.rstrip("/")


def client(base: str, cookies: Any = None) -> httpx.Client:
    return httpx.Client(base_url=base, timeout=HTTP_SECONDS, trust_env=False, cookies=cookies)


def tag() -> str:
    return uuid.uuid4().hex[:12]


def grading(base: str, path: str, body: Any, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key else {}
    return client(base).post(path, json=body, headers=headers)


def person(key: str, *, zone: str = "America/New_York", role: str = "member", avatar: str | None = None) -> dict:
    row = {
        "key": key,
        "email": f"{key}-{tag()}@world.example",
        "password": PASSWORD,
        "displayName": NAMES.get(key, key),
        "timeZone": zone,
        "siteRole": role,
    }
    if avatar:
        row["avatar"] = avatar
    return row


class World:
    def __init__(self, base: str, body: dict, ids: dict):
        self.base = base
        self.body = body
        self.ids = ids
        self.id = ids["worldId"]

    def pid(self, key: str) -> str:
        return self.ids["people"][key]

    def sid(self, key: str = "s1") -> str:
        return self.ids["sessions"][key]

    def email(self, key: str) -> str:
        return next(p["email"] for p in self.body["people"] if p["key"] == key)

    def signin(self, key: str, base: str | None = None) -> httpx.Client:
        c = client(base or self.base)
        r = c.post("/api/signin", json={"email": self.email(key), "password": PASSWORD})
        assert r.status_code == 200, r.text
        return c

    def clock(self, now: str | None, base: str | None = None) -> dict:
        r = grading(base or self.base, "/api/grading/clock", {"worldId": self.id, "now": now})
        assert r.status_code == 200, r.text
        return r.json()


def setup_world(base: str, **body: Any) -> World:
    r = grading(base, "/api/grading/setup", body)
    assert r.status_code == 201, r.text
    return World(base, body, r.json())


def loft_room(owner: str, key: str = "loft", name: str = "Test Loft", room_layout: dict | None = None) -> dict:
    return {"key": key, "name": name, "owner": owner, "rank": "Feather", "layout": room_layout or LOFT}


def den_room(owner: str, key: str = "den", name: str = "Test Den") -> dict:
    return {
        "key": key,
        "name": name,
        "owner": owner,
        "versions": [
            {"rank": "Feather", "layout": DEN_V1, "published": True},
            {"rank": "Linen", "layout": DEN_V2, "published": False},
        ],
    }


def live_world(
    base: str,
    placed: dict[str, tuple[int, int, str]],
    *,
    extra: tuple[str, ...] = (),
    room_layout: dict | None = None,
    capacity: int = 10,
    visibility: str = "public",
    **body: Any,
) -> World:
    keys = list(placed)
    host = keys[0]
    people = [person(k, avatar="fox") for k in keys] + [person(k, avatar="fox") for k in extra]
    placements = [{"person": k, "x": v[0], "y": v[1], "facing": v[2]} for k, v in placed.items()]
    return setup_world(
        base,
        people=people,
        avatars=[{"key": "fox", "name": "Copper Fox", "owner": host, "rank": "Feather"}],
        rooms=[loft_room(host, room_layout=room_layout)],
        sessions=[{
            "key": "s1", "room": "loft", "host": host, "visibility": visibility, "capacity": capacity,
            "community": None, "invitees": [], "placements": placements,
        }],
        **body,
    )


def err(r: httpx.Response, status: int, message: str) -> None:
    assert r.status_code == status, f"expected {status}, got {r.status_code}: {r.text}"
    assert r.json() == {"error": message}


def not_found(r: httpx.Response) -> None:
    err(r, 404, "Not found.")


def press(c: httpx.Client, sid: str, direction: str) -> httpx.Response:
    return c.post(f"/api/sessions/{sid}/step", json={"direction": direction})


def march(c: httpx.Client, sid: str, direction: str, tiles: int) -> None:
    moved = 0
    for _ in range(tiles * 2 + 2):
        r = press(c, sid, direction)
        assert r.status_code == 200, r.text
        if r.json()["result"] == "moved":
            moved += 1
        if moved == tiles:
            return
    pytest.fail(f"step {direction} should move {tiles} tiles after at most one turn")


def people_of(c: httpx.Client, sid: str) -> dict[str, dict]:
    r = c.get(f"/api/sessions/{sid}")
    assert r.status_code == 200, r.text
    return {p["personId"]: p for p in r.json()["people"]}


def chat(c: httpx.Client, sid: str, body: str) -> httpx.Response:
    return c.post(f"/api/sessions/{sid}/chat", json={"text": body})


def chat_texts(c: httpx.Client, sid: str) -> list[str]:
    r = c.get(f"/api/sessions/{sid}/chat")
    assert r.status_code == 200, r.text
    return [m["text"] for m in r.json()["messages"]]


def wait_for(check: Any, seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
    pytest.fail(contract)


def parse_instant(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def together(calls: list[Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call: Any) -> Any:
        barrier.wait(WAIT_SECONDS)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def mails_to(mail: Any, address: str, expected: int = 1, seconds: float = WAIT_SECONDS) -> list[dict]:
    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages(0, settle=0.2) if address in addresses(m["To"])]
        if len(found) >= expected:
            break
    return [m for m in mail.messages(0, settle=2) if address in addresses(m["To"])]


def link_token(message: dict, path: str) -> str:
    match = re.search(rf"{path}/([^\s\"'<>]+)", mail_text(message))
    assert match, f"mail should carry a link to {path}/<token>"
    return match.group(1)


def png(width: int, height: int) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = (b"\0" + b"\x80" * width) * height
    header = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b"")


def jpeg(width: int, height: int) -> bytes:
    app0 = b"\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
    sof0 = b"\xff\xc0\x00\x11\x08" + struct.pack(">HH", height, width) + b"\x03\x01\x11\x00\x02\x11\x01\x03\x11\x01"
    return b"\xff\xd8" + app0 + sof0 + b"\xff\xd9"


def pack_glb(doc: dict, binary: bytes = b"", *, version: int = 2, size: int | None = None) -> bytes:
    def assemble(data: bytes) -> bytes:
        body_doc = dict(doc)
        if data:
            body_doc["buffers"] = [{"byteLength": len(data)}]
        js = json.dumps(body_doc).encode()
        js += b" " * (-len(js) % 4)
        body = struct.pack("<I4s", len(js), b"JSON") + js
        if data:
            body += struct.pack("<I4s", len(data), b"BIN\0") + data
        return struct.pack("<4sII", b"glTF", version, 12 + len(body)) + body

    data = binary + b"\0" * (-len(binary) % 4)
    if size is None:
        return assemble(data)
    data = data or b"\0\0\0\0"
    for _ in range(8):
        gap = size - len(assemble(data))
        if gap == 0:
            return assemble(data)
        data = data + bytes(gap) if gap > 0 else data[:gap]
    pytest.fail("test GLB builder should reach the exact size")


def model(triangles: int = 0, materials: int = 0, image: bytes | None = None, size: int | None = None) -> bytes:
    doc: dict[str, Any] = {"asset": {"version": "2.0"}}
    binary = b""
    views: list[dict] = []
    if triangles:
        block = 1000
        binary = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0) + struct.pack("<3H", 0, 1, 2) * block
        views = [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36},
            {"buffer": 0, "byteOffset": 36, "byteLength": 6 * block},
        ]
        position = {
            "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
            "min": [0, 0, 0], "max": [1, 1, 0],
        }
        accessors = [position, {"bufferView": 1, "componentType": 5123, "count": 3 * block, "type": "SCALAR"}]
        meshes = [{"primitives": [{"attributes": {"POSITION": 0}, "indices": 1}]}]
        whole, rest = divmod(triangles, block)
        nodes = [{"mesh": 0} for _ in range(whole)]
        if rest:
            accessors.append({"bufferView": 1, "componentType": 5123, "count": 3 * rest, "type": "SCALAR"})
            meshes.append({"primitives": [{"attributes": {"POSITION": 0}, "indices": 2}]})
            nodes.append({"mesh": 1})
        doc.update(accessors=accessors, meshes=meshes, nodes=nodes, scenes=[{"nodes": list(range(len(nodes)))}], scene=0)
    if materials:
        doc["materials"] = [{"name": f"m{i}"} for i in range(materials)]
    if image is not None:
        binary += b"\0" * (-len(binary) % 4)
        views.append({"buffer": 0, "byteOffset": len(binary), "byteLength": len(image)})
        mime = "image/png" if image.startswith(b"\x89PNG") else "image/jpeg"
        doc["images"] = [{"bufferView": len(views) - 1, "mimeType": mime}]
        binary += image
    if views:
        doc["bufferViews"] = views
    return pack_glb(doc, binary, size=size)


def primitive_glb(primitives: list[dict], node_meshes: list[int], extra_meshes: int = 0) -> bytes:
    binary = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0) + struct.pack("<3H", 0, 1, 2) * 40
    accessors: list[dict] = [{
        "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 0],
    }]
    meshes = []
    for prim in primitives:
        attrs: dict[str, Any] = {"attributes": {"POSITION": len(accessors)}, "mode": prim.get("mode", 4)}
        accessors.append({
            "bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 0],
        } if "positions" not in prim else {
            "bufferView": 2, "componentType": 5126, "count": prim["positions"], "type": "VEC3",
            "min": [0, 0, 0], "max": [1, 1, 1],
        })
        if "indices" in prim:
            attrs["indices"] = len(accessors)
            accessors.append({"bufferView": 1, "componentType": 5123, "count": prim["indices"], "type": "SCALAR"})
        meshes.append({"primitives": [attrs]})
    meshes += [{"primitives": [{"attributes": {"POSITION": 0}}]} for _ in range(extra_meshes)]
    filler = bytes(12 * 60)
    nodes = [{"mesh": m} for m in node_meshes]
    doc = {
        "asset": {"version": "2.0"},
        "bufferViews": [
            {"buffer": 0, "byteOffset": 0, "byteLength": 36},
            {"buffer": 0, "byteOffset": 36, "byteLength": 240},
            {"buffer": 0, "byteOffset": 276, "byteLength": len(filler)},
        ],
        "accessors": accessors,
        "meshes": meshes,
        "nodes": nodes,
        "scenes": [{"nodes": list(range(len(nodes)))}],
        "scene": 0,
    }
    return pack_glb(doc, binary + filler)


def upload(
    c: httpx.Client, kind: str | None, name: str | None, data: bytes | None,
    *, filename: str = "model.glb", mime: str = "model/gltf-binary", room_layout: Any = LOFT,
) -> httpx.Response:
    form: dict[str, str] = {}
    if kind is not None:
        form["kind"] = kind
    if name is not None:
        form["name"] = name
    if kind == "room" and room_layout is not None:
        form["layout"] = room_layout if isinstance(room_layout, str) else json.dumps(room_layout)
    files = {"file": (filename, data, mime)} if data is not None else {"unused": ("", b"", "text/plain")}
    return c.post("/api/assets", data=form, files=files)


def upload_version(c: httpx.Client, asset: str, data: bytes, room_layout: dict | None = None) -> httpx.Response:
    form = {"layout": json.dumps(room_layout)} if room_layout else {}
    return c.post(f"/api/assets/{asset}/versions", data=form, files={"file": ("m.glb", data, "model/gltf-binary")})


class Sockets:
    def __init__(self) -> None:
        self.urls: dict[str, str] = {}
        self.opened: list[str] = []
        self.frames: list[str] = []


SOCKETS: dict[Page, Sockets] = {}


def watch_sockets(page: Page) -> Sockets:
    state = Sockets()
    SOCKETS[page] = state
    channel = cdp(page)
    channel.send("Network.enable")

    def created(event: dict) -> None:
        state.urls[event["requestId"]] = event["url"]

    def opened(event: dict) -> None:
        state.opened.append(state.urls.get(event["requestId"], ""))

    channel.on("Network.webSocketCreated", created)
    channel.on("Network.webSocketHandshakeResponseReceived", opened)
    page.on("websocket", lambda ws: ws.on("framereceived", lambda payload: state.frames.append(str(payload))))
    return state


def wait_socket(page: Page, sid: str, after: int = 0) -> None:
    state = SOCKETS[page]
    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        page.evaluate("1")
        if sum(f"/ws/sessions/{sid}" in u for u in state.opened) > after:
            return
    pytest.fail(f"the room page should open /ws/sessions/{sid}")


def socket_count(page: Page, sid: str) -> int:
    return sum(f"/ws/sessions/{sid}" in u for u in SOCKETS[page].opened)


@contextmanager
def browser_page(
    browser: Browser, world: World, key: str, path: str, *, base: str | None = None,
    viewport: dict | None = None, device_time: str | None = None, **options: Any,
) -> Iterator[Page]:
    origin = base or world.base
    with open_app(browser, f"{origin}/signin", **options) as page:
        page.set_viewport_size(viewport or DESKTOP)
        r = page.context.request.post(f"{origin}/api/signin", data={"email": world.email(key), "password": PASSWORD})
        assert r.ok, r.text()
        watch_sockets(page)
        if device_time:
            page.clock.set_fixed_time(device_time)
        go(page, f"{origin}{path}")
        yield page
        SOCKETS.pop(page, None)


@contextmanager
def room_page(browser: Browser, world: World, key: str, sid: str | None = None, **options: Any) -> Iterator[Page]:
    target = sid or world.sid()
    with browser_page(browser, world, key, f"/sessions/{target}", **options) as page:
        expect(room(page)).to_be_visible()
        wait_socket(page, target)
        yield page


def named(scope: Any, role: str, name: str) -> Locator:
    return scope.get_by_role(role, name=name, exact=True)


def room(page: Page) -> Locator:
    return named(page, "region", "Room")


def entry(page: Page, pid: str) -> Locator:
    return page.locator(f'[data-person-id="{pid}"][data-tile-x]')


def missing() -> str:
    return f"gone-{tag()}"


def heard(count: int) -> str:
    return f"Heard by {count}."


def feature(page: Page, feature_id: str) -> Locator:
    return page.locator(f'[data-feature-id="{feature_id}"]')


def expect_tile(page: Page, pid: str, x: int, y: int) -> None:
    expect(entry(page, pid)).to_have_attribute("data-tile-x", str(x))
    expect(entry(page, pid)).to_have_attribute("data-tile-y", str(y))


def expect_facing(page: Page, pid: str, facing: str) -> None:
    expect(entry(page, pid)).to_have_attribute("data-facing", facing)


def paragraphs(page: Page) -> Locator:
    return named(page, "status", "Room announcements").get_by_role("paragraph")


def said(page: Page, message: str) -> Locator:
    return paragraphs(page).filter(has_text=re.compile(rf"^\s*{re.escape(message)}\s*$"))


def alert_with(page: Page, message: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=message).first


def say(page: Page, body: str) -> None:
    field = named(page, "textbox", "Say something nearby")
    fill(field, body)
    field.focus()
    page.keyboard.press("Enter")


def let_go(gate: Any) -> None:
    (gate.release if hasattr(gate, "release") else gate)()


def tab_to(page: Page, target: Locator) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if target.evaluate("e => e === document.activeElement"):
            return
    pytest.fail("the control should be reachable with Tab")


def tab_stays_inside(page: Page, container: Locator) -> None:
    for key in ("Tab", "Shift+Tab"):
        for _ in range(TAB_PROBE):
            page.keyboard.press(key)
            assert container.evaluate("c => c.contains(document.activeElement)"), f"{key} left the open dialog"


def close_dialog_if_open(page: Page, name: str) -> None:
    if named(page, "dialog", name).count():
        page.keyboard.press("Escape")
    expect(named(page, "dialog", name)).to_be_hidden()


def version_item(page: Page, number: int) -> Locator:
    return named(page, "list", "Versions").get_by_role("listitem").and_(page.locator(f'[data-version="{number}"]'))


def after_navigation(page: Page, action: Any) -> Any:
    for attempt in range(3):
        try:
            return action()
        except PlaywrightError as error:
            text = str(error)
            if attempt == 2 or not ("interrupted by another navigation" in text or "context was destroyed" in text):
                raise
            page.wait_for_load_state("load")


def go(page: Page, url: str) -> None:
    after_navigation(page, lambda: page.goto(url))


def no_overflow(page: Page) -> None:
    after_navigation(page, lambda: layout(page))


def box(locator: Locator) -> dict[str, float]:
    found = locator.bounding_box()
    assert found, "the element should have a box"
    return found


class Relay:
    def __init__(self, url: str, default_port: int):
        parts = urlsplit(url)
        self.parts = parts
        self.target = (parts.hostname, parts.port or default_port)
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.listener: socket.socket | None = None

    def url(self) -> str:
        auth = self.parts.netloc.rpartition("@")[0]
        netloc = (auth + "@" if auth else "") + f"127.0.0.1:{self.port}"
        return urlunsplit((self.parts.scheme, netloc, self.parts.path, self.parts.query, self.parts.fragment))

    def open(self) -> None:
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", self.port))
        self.listener.listen(128)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        for _ in range(100000):
            try:
                inbound, _addr = self.listener.accept()
                outbound = socket.create_connection(self.target, timeout=30)
            except OSError:
                return
            outbound.settimeout(None)
            threading.Thread(target=self._pump, args=(inbound, outbound), daemon=True).start()
            threading.Thread(target=self._pump, args=(outbound, inbound), daemon=True).start()

    @staticmethod
    def _pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            for data in iter(lambda: source.recv(65536), b""):
                sink.sendall(data)
        except OSError:
            pass
        for s in (source, sink):
            try:
                s.close()
            except OSError:
                pass

    def close(self) -> None:
        if self.listener:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()


@contextmanager
def app_copy(overrides: dict[str, str]) -> Iterator[tuple[str, subprocess.Popen, Any]]:
    from conftest import DEPLOYED_APP

    manifest = json.loads(Path("/app/run.json").read_text())
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **overrides}
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        process = subprocess.Popen(
            manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env,
            stdout=log, stderr=subprocess.STDOUT, start_new_session=True,
        )
        try:
            yield base, process, log
        finally:
            os.killpg(process.pid, signal.SIGTERM)
            process.wait(timeout=30)


def log_tail(log: Any) -> str:
    log.flush()
    return Path(log.name).read_text()[-2000:]


def health_is(base: str, wanted: str, process: subprocess.Popen, log: Any) -> None:
    deadline = time.monotonic() + BOOT_SECONDS
    while time.monotonic() < deadline:
        if process.poll() is not None:
            pytest.fail(f"the started copy exited: {log_tail(log)}")
        try:
            if client(base).get("/api/health").json().get("status") == wanted:
                return
        except (httpx.HTTPError, ValueError):
            continue
    pytest.fail(f"GET /api/health should answer {wanted} on the started copy: {log_tail(log)}")


def ws_status(base: str, path: str, origin: str | None, cookie: str = "") -> int:
    parts = urlsplit(base)
    with socket.create_connection((parts.hostname, parts.port or 80), timeout=30) as conn:
        lines = [
            f"GET {path} HTTP/1.1", f"Host: {parts.netloc}", "Connection: Upgrade", "Upgrade: websocket",
            "Sec-WebSocket-Version: 13", "Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==",
        ]
        if origin:
            lines.append(f"Origin: {origin}")
        if cookie:
            lines.append(f"Cookie: {cookie}")
        conn.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
        return int(conn.recv(4096).split(b" ", 2)[1])


def test_health_routes() -> None:
    for env_name, wanted in (
        ("APP_SECOND_URL", "ok"), ("APP_TIMERS_URL", "ok"),
        ("APP_MINIO_DOWN_URL", "unavailable"), ("APP_VALKEY_DOWN_URL", "unavailable"),
    ):
        r = client(instance(env_name)).get("/api/health")
        assert r.status_code == 200, r.text
        assert r.json() == {"status": wanted}
        assert r.elapsed.total_seconds() < HEALTH_SECONDS


def test_grading_setup_and_worlds(app_url: str) -> None:
    def body() -> dict:
        return {
            "people": [
                person("ann", avatar="fox"),
                person("ben", zone="Europe/London", avatar="fox"),
                person("mod", zone="Asia/Tokyo", role="moderator"),
            ],
            "friendships": [["ann", "ben"]],
            "blocks": [{"from": "mod", "to": "ben"}],
            "mutes": [{"from": "ben", "to": "mod"}],
            "communities": [{
                "key": "stitch", "name": "Stitch Night", "timeZone": "America/New_York",
                "members": [{"person": "ann", "role": "owner"}, {"person": "ben", "role": "member"}],
            }],
            "avatars": [{"key": "fox", "name": "Copper Fox", "owner": "ann", "rank": "Feather"}],
            "rooms": [loft_room("ann"), den_room("ann")],
            "sessions": [{
                "key": "s1", "room": "loft", "host": "ann", "visibility": "public", "capacity": 10,
                "community": None, "invitees": [],
                "placements": [
                    {"person": "ann", "x": 2, "y": 2, "facing": "north"},
                    {"person": "ben", "x": 5, "y": 5, "facing": "south"},
                ],
            }],
            "reports": [{
                "key": "r1", "filer": "ann", "person": "ben", "session": "s1",
                "category": "other", "details": "Invented report.", "state": "open",
            }],
            "gatherings": [{
                "key": "g1", "community": "stitch", "title": "Spring Stitch", "startsLocal": "2027-03-07T19:00",
                "durationMinutes": 90, "recurrence": "weekly", "limit": 20, "attending": ["ann", "ben"],
            }],
        }

    w = setup_world(app_url, **body())
    assert set(w.ids["people"]) == {"ann", "ben", "mod"}
    for group, keys in (
        ("communities", {"stitch"}), ("avatars", {"fox"}), ("rooms", {"loft", "den"}),
        ("sessions", {"s1"}), ("reports", {"r1"}), ("gatherings", {"g1"}),
    ):
        assert set(w.ids[group]) == keys

    ann = w.signin("ann")
    me = ann.get("/api/me").json()
    assert me["worldId"] == w.id and me["personId"] == w.pid("ann") and me["avatarId"] == w.ids["avatars"]["fox"]
    placed = people_of(ann, w.sid())
    assert (placed[w.pid("ben")]["x"], placed[w.pid("ben")]["y"]) == (5, 5)

    den = w.ids["rooms"]["den"]
    detail = ann.get(f"/api/assets/{den}").json()
    assert sorted((v["version"], v["rank"], v["status"]) for v in detail["versions"]) == [
        (1, "Feather", "published"), (2, "Linen", "checked"),
    ]
    assert detail["currentVersion"] == 1
    assert w.signin("ben").get(f"/api/assets/{den}").json()["versions"][0]["version"] == 1
    assert len(w.signin("ben").get(f"/api/assets/{den}").json()["versions"]) == 1
    generated = ann.get(f"/api/assets/{den}/versions/2/file").content
    assert generated.startswith(b"glTF") and S3().get(f"assets/{den}/v2.glb") == generated
    measured = upload_version(ann, den, generated, DEN_V2)
    assert measured.status_code == 201 and measured.json()["rank"] == "Linen"

    other = setup_world(app_url, **body())
    stranger = other.signin("ann")
    assert w.sid() not in {s["id"] for s in stranger.get("/api/sessions").json()["sessions"]}
    assert stranger.get("/api/sessions", params={"q": "Test Loft"}).json()["total"] == 1
    assert other.ids["rooms"]["loft"] in {a["id"] for a in stranger.get("/api/assets").json()["assets"]}
    assert w.ids["rooms"]["loft"] not in {a["id"] for a in stranger.get("/api/assets").json()["assets"]}
    not_found(stranger.get(f"/api/sessions/{w.sid()}"))
    not_found(stranger.get(f"/api/assets/{den}"))
    not_found(stranger.get(f"/api/gatherings/{w.ids['gatherings']['g1']}"))
    not_found(stranger.get(f"/api/communities/{w.ids['communities']['stitch']}/members"))

    empty = grading(app_url, "/api/grading/setup", {})
    assert empty.status_code == 201 and empty.json()["worldId"]
    bad = grading(app_url, "/api/grading/setup", {"people": [person("ann")], "friendships": [["ann", "nobody"]]})
    assert bad.status_code == 422 and isinstance(bad.json()["error"], str)
    not_found(grading(app_url, "/api/grading/setup", {}, key="wrong-key"))
    not_found(grading(app_url, "/api/grading/setup", {}, key=None))
    too_big = b'{"people":[]' + b" " * SETUP_LIMIT + b"}"
    r = client(app_url).post(
        "/api/grading/setup", content=too_big,
        headers={"X-Grading-Key": GRADING_KEY, "Content-Type": "application/json"},
    )
    err(r, 413, "That request is too large.")
    big_enough = b'{"people":[]' + b" " * (JSON_LIMIT + 100) + b"}"
    r = client(app_url).post(
        "/api/grading/setup", content=big_enough,
        headers={"X-Grading-Key": GRADING_KEY, "Content-Type": "application/json"},
    )
    assert r.status_code == 201, r.text


def test_grading_clock_and_outage(app_url: str) -> None:
    second = instance("APP_SECOND_URL")
    placed = {"ann": (1, 7, "north"), "ben": (2, 7, "north"), "carol": (3, 7, "north"), "dan": (4, 7, "north")}
    w = live_world(app_url, placed)
    other = live_world(app_url, placed)
    answer = w.clock("2027-03-14T18:59:59-04:00")
    assert answer["worldId"] == w.id and parse_instant(answer["now"]) == parse_instant("2027-03-14T22:59:59Z")
    ann = w.signin("ann")
    first = ann.post(f"/api/sessions/{w.sid()}/votes", json={"personId": w.pid("ben")}).json()
    held_again = ann.post(f"/api/sessions/{w.sid()}/votes", json={"personId": w.pid("carol")}).json()
    assert first["closesAt"] == held_again["closesAt"]
    assert parse_instant(first["closesAt"]) == parse_instant("2027-03-14T23:00:59Z")

    other_vote = other.signin("ann").post(f"/api/sessions/{other.sid()}/votes", json={"personId": other.pid("ben")}).json()
    assert parse_instant(other_vote["closesAt"]) != parse_instant(first["closesAt"])

    w.clock("2027-03-14T23:00:59Z")
    votes = {v["id"]: v["status"] for v in ann.get(f"/api/sessions/{w.sid()}/votes").json()["votes"]}
    assert set(votes.values()) == {"failed"}
    statuses = other.signin("ann").get(f"/api/sessions/{other.sid()}/votes").json()["votes"]
    assert [v["status"] for v in statuses] == ["open"]

    released = w.clock(None)
    assert parse_instant(released["now"]) != parse_instant("2027-03-14T23:00:59Z")
    not_found(grading(app_url, "/api/grading/clock", {"worldId": f"unknown-{tag()}", "now": "2027-03-14T18:59:59-04:00"}))
    err(grading(app_url, "/api/grading/clock", {"worldId": w.id, "now": "not a time"}), 422, "Give a valid time.")
    not_found(grading(app_url, "/api/grading/clock", {"worldId": w.id, "now": None}, key="wrong-key"))

    err(grading(second, "/api/grading/outage", {"service": "disk", "down": True}), 422, "Choose valkey or minio.")
    not_found(grading(second, "/api/grading/outage", {"service": "valkey", "down": True}, key=None))
    for service in ("valkey", "minio"):
        try:
            r = grading(second, "/api/grading/outage", {"service": service, "down": True})
            assert r.status_code == 200 and r.json() == {"service": service, "down": True}
            assert client(second).get("/api/health").json() == {"status": "unavailable"}
            assert client(app_url).get("/api/health").json() == {"status": "ok"}
        finally:
            r = grading(second, "/api/grading/outage", {"service": service, "down": False})
        assert r.status_code == 200 and r.json() == {"service": service, "down": False}
        assert client(second).get("/api/health").json() == {"status": "ok"}


def test_instances_and_timers(app_url: str) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (3, 2, "north"), "carol": (4, 2, "north")})
    ann = w.signin("ann")
    across = client(second, cookies=dict(ann.cookies))
    assert across.get("/api/me").json()["personId"] == w.pid("ann")
    assert people_of(across, w.sid())[w.pid("ann")]["x"] == 2
    for direction in ("east", "south", "west", "north"):
        assert press(ann, w.sid(), direction).status_code == 200, "the primary runs with no minimum step interval"

    limits = {
        "CHAT_MAX_CHARS": "5",
        "SESSION_CAPACITY_MAX": "3",
        "VOTE_WINDOW_SECONDS": "7",
        "INVITE_TTL_SECONDS": "90",
    }
    with app_copy(limits) as (base, process, log):
        health_is(base, "ok", process, log)
        w.clock("2027-03-01T12:00:00Z")
        ann_copy = w.signin("ann", base)
        err(chat(ann_copy, w.sid(), "123456"), 422, "Messages can be at most 5 characters.")
        assert chat(ann_copy, w.sid(), "12345").status_code == 201
        err(
            ann_copy.post("/api/sessions", json={
                "roomId": w.ids["rooms"]["loft"], "visibility": "public", "capacity": 4, "communityId": None,
            }),
            422, "Capacity must be between 1 and 3.",
        )
        vote = ann_copy.post(f"/api/sessions/{w.sid()}/votes", json={"personId": w.pid("ben")}).json()
        assert parse_instant(vote["closesAt"]) == parse_instant("2027-03-01T12:00:07Z")
        invited = f"nobody-{tag()}@world.example"
        assert ann_copy.post("/api/friends/invites", json={"email": invited}).status_code == 202
        invite = next(i for i in ann_copy.get("/api/friends/invites").json()["invites"] if i["email"] == invited)
        assert parse_instant(invite["expiresAt"]) == parse_instant("2027-03-01T12:01:30Z")


def test_error_order(app_url: str) -> None:
    timers = instance("APP_TIMERS_URL")
    w = live_world(
        app_url, {"ann": (2, 2, "north"), "ben": (3, 2, "north"), "carol": (4, 2, "north"), "dan": (6, 6, "north")},
        communities=[{"key": "c", "name": "Stitch Night", "timeZone": "America/New_York",
                      "members": [{"person": "ann", "role": "owner"}, {"person": "ben", "role": "member"}]}],
    )
    anon = client(app_url)
    unknown = f"unknown-{tag()}"
    for method, path in (
        ("GET", "/api/me"), ("GET", "/api/sessions"), ("GET", "/api/friends"), ("GET", "/api/assets"),
        ("GET", "/api/communities"), ("GET", "/api/moderation/reports"), ("GET", f"/api/sessions/{unknown}"),
        ("POST", f"/api/sessions/{unknown}/step"), ("POST", "/api/reports"), ("DELETE", f"/api/blocks/{unknown}"),
    ):
        err(anon.request(method, path, json={} if method == "POST" else None), 401, "Sign in first.")

    ann = w.signin("ann")
    not_found(press(ann, unknown, "sideways"))
    not_found(ann.get(f"/api/assets/{unknown}"))
    not_found(ann.get("/api/moderation/reports"))
    ben = w.signin("ben")
    community = w.ids["communities"]["c"]
    barred = ben.post(f"/api/communities/{community}/gatherings", json={
        "title": "", "startsLocal": "bad", "durationMinutes": 1, "recurrence": "none", "limit": 0,
    })
    not_found(barred)

    vote = ann.post(f"/api/sessions/{w.sid()}/votes", json={"personId": w.pid("dan")}).json()
    r = ann.post(f"/api/sessions/{w.sid()}/votes/{vote['id']}/ballots", json={"choice": "maybe"})
    err(r, 409, "You have already voted.")
    r = ben.post(f"/api/sessions/{w.sid()}/votes/{vote['id']}/ballots", json={"choice": "maybe"})
    err(r, 422, "Choose yes or no.")

    w.clock("2027-03-01T12:00:00Z")
    fast = w.signin("carol", timers)
    assert press(fast, w.sid(), "east").status_code == 200
    err(press(fast, w.sid(), "up"), 422, "Choose north, east, south or west.")
    err(press(fast, w.sid(), "south"), 429, "Slow down a little.")

    down = w.signin("ann", instance("APP_VALKEY_DOWN_URL"))
    not_found(press(down, unknown, "north"))
    err(press(down, w.sid(), "up"), 422, "Choose north, east, south or west.")
    err(press(down, w.sid(), "east"), 503, "Live rooms are unavailable right now.")


def test_server_boundary(app_url: str, browser: Browser) -> None:
    anon = client(app_url)
    foreign = {"Origin": "http://elsewhere.example"}
    refused = "Cross-origin requests are refused."
    err(anon.post("/api/signin", json={}, headers=foreign), 403, refused)
    err(anon.post(f"/api/sessions/{missing()}/step", json={}, headers=foreign), 403, refused)
    own = {"Origin": app_url}
    assert anon.post("/api/signin", json={"email": "a@b.example", "password": "x"}, headers=own).status_code == 401
    assert anon.post("/api/signin", json={"email": "a@b.example", "password": "x"}).status_code == 401

    w = live_world(app_url, {"ann": (2, 2, "north")})
    ann = w.signin("ann")
    jar = "; ".join(f"{k}={v}" for k, v in ann.cookies.items())
    assert ws_status(app_url, "/ws/me", "http://elsewhere.example", jar) == 403
    assert ws_status(app_url, "/ws/me", app_url, jar) not in (401, 403, 404)
    assert ws_status(app_url, "/ws/me", None, "") != http.HTTPStatus.SWITCHING_PROTOCOLS

    payload = json.dumps({"email": "a@b.example", "password": "x"}).encode()
    at_limit = payload[:-1] + b" " * (JSON_LIMIT - len(payload)) + b"}"
    json_header = {"Content-Type": "application/json"}
    assert anon.post("/api/signin", content=at_limit, headers=json_header).status_code == 401
    over = payload[:-1] + b" " * (JSON_LIMIT + 1 - len(payload)) + b"}"
    err(anon.post("/api/signin", content=over, headers=json_header), 413, "That request is too large.")
    err(anon.post("/api/signin", content=b"not json", headers=json_header), 422, "Send a JSON body.")

    oversized = ann.post(
        "/api/assets", data={"kind": "avatar", "name": "Too big"},
        files={"file": ("m.glb", bytes(MULTIPART_LIMIT + 1), "model/gltf-binary")},
    )
    err(oversized, 413, "This model is over the Granite limit for file size.")

    for path in (
        "/run.json", "/package.json", "/package-lock.json", "/node_modules/three/package.json",
        "/.env", "/.git/config", "/%2e%2e/run.json", "/assets/%2e%2e/%2e%2e/run.json",
    ):
        r = ann.get(path)
        assert r.status_code == 404, f"{path} answered {r.status_code}"
        assert "run-manifest-v1" not in r.text
    loft = w.ids["rooms"]["loft"]
    assert ann.get(f"/assets/{loft}/v1.glb").status_code == 404

    seen: list[str] = []
    bodies: list[bytes] = []

    def record(response: Any) -> None:
        seen.append(response.url)
        if same_origin(response.url, app_url) and response.request.method == "GET":
            try:
                bodies.append(response.body())
            except Exception:
                return

    with open_app(browser, f"{app_url}/signin") as page:
        page.set_viewport_size(DESKTOP)
        page.on("response", record)
        page.on("request", lambda request: seen.append(request.url))
        r = page.context.request.post(f"{app_url}/api/signin", data={"email": w.email("ann"), "password": PASSWORD})
        assert r.ok
        go(page, f"{app_url}/sessions/{w.sid()}")
        expect(room(page)).to_be_visible()
    outside = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert not outside, f"the browser should call only its own origin: {outside}"
    assert seen and not any(GRADING_KEY.encode() in body for body in bodies)


def test_boot_with_services_unreachable() -> None:
    for name in ("DATABASE_URL", "VALKEY_URL", "S3_ENDPOINT"):
        assert os.environ.get(name), f"{name} should be available to start a copy of the app"
    database = Relay(os.environ["DATABASE_URL"], 5432)
    valkey_relay = Relay(os.environ["VALKEY_URL"], 6379)
    storage = Relay(os.environ["S3_ENDPOINT"], 9000)
    env = {"DATABASE_URL": database.url(), "VALKEY_URL": valkey_relay.url(), "S3_ENDPOINT": storage.url()}
    try:
        with app_copy(env) as (base, process, log):
            def waiting_alive() -> bool:
                assert process.poll() is None, f"the copy must keep retrying Postgres: {log_tail(log)}"
                return False

            deadline = time.monotonic() + 5
            while time.monotonic() < deadline:
                waiting_alive()
            database.open()
            health_is(base, "unavailable", process, log)
            valkey_relay.open()
            storage.open()
            health_is(base, "ok", process, log)
            assert process.poll() is None
    finally:
        for relay in (database, valkey_relay, storage):
            relay.close()


def test_signup_and_signin(app_url: str, mail: Any, browser: Browser) -> None:
    anon = client(app_url)
    email = f"signup-{tag()}@world.example"
    good = {"email": email, "password": "lantern-pass-9", "displayName": SIGNUP_NAME, "timeZone": "Asia/Tokyo"}
    r = anon.post("/api/signup", json=good)
    assert r.status_code == 202 and r.json() == {"status": "check-your-email"}
    messages = mails_to(mail, email)
    assert len(messages) == 1
    assert messages[0]["Subject"] == "Confirm your Hearthtile account"
    assert "hello@hearthtile.example" in addresses(messages[0]["From"])
    token = link_token(messages[0], "/confirm")

    wrong = {"error": "Email or password is wrong."}
    unconfirmed = anon.post("/api/signin", json={"email": email, "password": good["password"]})
    assert unconfirmed.status_code == 401 and unconfirmed.json() == wrong
    unknown = anon.post("/api/signin", json={"email": f"none-{tag()}@world.example", "password": good["password"]})
    assert unknown.status_code == 401 and unknown.json() == wrong

    replay = anon.post("/api/signup", json={**good, "displayName": "Changed Name"})
    assert replay.status_code == 202 and replay.json() == r.json()

    with open_app(browser, f"{app_url}/confirm/{token}") as page:
        expect(page.get_by_role("link", name=re.compile("sign in", re.I)).first).to_be_visible()
    assert len(mails_to(mail, email, 2, seconds=3)) == 1, "a known email gets no second mail"
    not_found(anon.post(f"/api/confirm/{token}"))
    not_found(anon.post(f"/api/confirm/{missing()}"))

    signed = client(app_url)
    r = signed.post("/api/signin", json={"email": email, "password": good["password"]})
    assert r.status_code == 200
    assert r.json()["displayName"] == SIGNUP_NAME and r.json()["timeZone"] == "Asia/Tokyo"
    assert r.json()["siteRole"] and r.json()["personId"]
    assert signed.get("/api/me").json()["worldId"] == "default"
    wrong_password = client(app_url).post("/api/signin", json={"email": email, "password": "not-the-password"})
    assert wrong_password.status_code == 401 and wrong_password.json() == wrong
    assert signed.post("/api/signout").json() == {"status": "signed-out"}
    err(signed.get("/api/me"), 401, "Sign in first.")

    for change, message in (
        ({"email": "not-an-email"}, "Enter a valid email address."),
        ({"password": "short"}, "Passwords need at least 10 characters."),
        ({"displayName": ""}, "Give a display name of 1 to 40 characters."),
        ({"displayName": "x" * 41}, "Give a display name of 1 to 40 characters."),
        ({"timeZone": "Mars/Olympus"}, "Choose a time zone from the list."),
    ):
        bad = {**good, "email": f"bad-{tag()}@world.example", **change}
        err(anon.post("/api/signup", json=bad), 422, message)

    with open_app(browser, f"{app_url}/signup") as page:
        fresh = f"page-{tag()}@world.example"
        fill(named(page, "textbox", "Email"), fresh)
        fill(page.get_by_label("Password"), "lantern-pass-9")
        fill(named(page, "textbox", "Display name"), "Page Person")
        select(named(page, "combobox", "Time zone"), "Europe/Berlin")
        click(named(page, "button", "Create account"))
        expect(named(page, "status", "Account result")).to_have_text("Check your email to confirm your account.")
    assert len(mails_to(mail, fresh)) == 1
    with open_app(browser, f"{app_url}/confirm/unknown-{tag()}") as page:
        expect(page.get_by_role("heading", name="This link isn't available.", exact=True)).to_be_visible()


def test_seed_data(app_url: str) -> None:
    def seeded(email: str, password: str) -> httpx.Client:
        c = client(app_url)
        r = c.post("/api/signin", json={"email": email, "password": password})
        assert r.status_code == 200, f"{email} should sign in with its seeded password"
        return c

    wren = seeded("wren@hearthtile.example", "lantern-wren-01")
    tomas = seeded("tomas@hearthtile.example", "lantern-tomas-02")
    imke = seeded("imke@hearthtile.example", "lantern-imke-03")
    priya = seeded("priya@hearthtile.example", "lantern-priya-04")
    me = wren.get("/api/me").json()
    assert me["displayName"] == "Wren Okafor" and me["timeZone"] == "America/New_York" and me["worldId"] == "default"
    assert tomas.get("/api/me").json()["timeZone"] == "Europe/London"
    assert imke.get("/api/me").json()["timeZone"] == "Europe/Berlin"
    priya_me = priya.get("/api/me").json()
    assert priya_me["siteRole"] == "moderator" and priya_me["avatarId"] is None and priya_me["timeZone"] == "Asia/Kolkata"
    assert tomas.get("/api/me").json()["personId"] in {f["personId"] for f in wren.get("/api/friends").json()["friends"]}

    assets = wren.get("/api/assets").json()["assets"]
    expected = {
        "Quilt Loft": ("room", "Feather"), "Reading Porch": ("room", "Feather"), "Paper Fox": ("avatar", "Feather"),
        "Tin Heron": ("avatar", "Linen"), "Moss Walker": ("avatar", "Cedar"),
    }
    store = S3()
    by_name: dict[str, dict] = {}
    for name, (kind, rank) in expected.items():
        rows = [a for a in assets if a["name"] == name]
        assert len(rows) == 1, f"{name} should be seeded exactly once"
        row = rows[0]
        by_name[name] = row
        assert (row["kind"], row["rank"], row["ownerName"], row["currentVersion"]) == (kind, rank, "Wren Okafor", 1)
        stored = store.get(f"assets/{row['id']}/v1.glb")
        assert stored.startswith(b"glTF") and struct.unpack("<I", stored[8:12])[0] == len(stored)
        assert wren.get(f"/api/assets/{row['id']}/versions/1/file").content == stored
    assert me["avatarId"] == by_name["Paper Fox"]["id"]
    assert tomas.get("/api/me").json()["avatarId"] == by_name["Tin Heron"]["id"]
    assert imke.get("/api/me").json()["avatarId"] == by_name["Moss Walker"]["id"]
    quilt = wren.get(f"/api/assets/{by_name['Quilt Loft']['id']}").json()["versions"][0]["layout"]
    assert quilt == {
        "width": 12, "height": 12, "spawn": [{"x": 1, "y": 1}, {"x": 2, "y": 1}, {"x": 3, "y": 1}],
        "walls": [{"x": 3, "y": 3}, {"x": 8, "y": 8}], "seats": [{"id": "seat-1", "x": 5, "y": 2}],
        "exits": [{"id": "exit-1", "x": 0, "y": 6}],
    }
    porch = wren.get(f"/api/assets/{by_name['Reading Porch']['id']}").json()["versions"][0]["layout"]
    assert porch == {
        "width": 8, "height": 8, "spawn": [{"x": 1, "y": 1}], "walls": [{"x": 4, "y": 4}],
        "seats": [{"id": "seat-1", "x": 6, "y": 2}], "exits": [{"id": "exit-1", "x": 7, "y": 6}],
    }

    communities = [c for c in wren.get("/api/communities").json()["communities"] if c["name"] == "Thursday Stitchers"]
    assert len(communities) == 1 and communities[0]["role"] == "owner"
    assert communities[0]["timeZone"] == "America/New_York"
    community = communities[0]["id"]
    roles = {m["displayName"]: m["role"] for m in wren.get(f"/api/communities/{community}/members").json()["members"]}
    assert roles == {"Wren Okafor": "owner", "Tomas Vale": "steward", "Imke Dorn": "member"}
    gatherings = wren.get(f"/api/communities/{community}/gatherings").json()["gatherings"]
    rows = [g for g in gatherings if g["title"] == "Thursday Stitch-In"]
    assert len(rows) == 1
    assert (rows[0]["recurrence"], rows[0]["durationMinutes"], rows[0]["limit"]) == ("weekly", 90, 30)
    assert rows[0]["attendingCount"] == 2 and rows[0]["attending"] is True

    summaries = [
        s for s in wren.get("/api/sessions", params={"q": "Quilt Loft"}).json()["sessions"]
        if s["hostName"] == "Wren Okafor" and s["roomName"] == "Quilt Loft" and s["capacity"] == 12
    ]
    assert len(summaries) == 1 and summaries[0]["visibility"] == "public"
    tiles = {
        p["displayName"]: (p["x"], p["y"], p["facing"])
        for p in people_of(wren, summaries[0]["id"]).values()
    }
    assert tiles == {
        "Wren Okafor": (2, 2, "south"), "Tomas Vale": (4, 3, "west"), "Imke Dorn": (6, 5, "north"),
    }


def test_webgl_fallback(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (6, 6, "east"), "ben": (9, 6, "west")})
    with room_page(browser, w, "ann", no_webgl=True) as page:
        fallback = page.get_by_role("status").filter(has_text="3D view unavailable. Everything else still works.")
        expect(fallback.first).to_be_visible()
        expect(named(page, "img", "Room view")).to_have_count(0)
        page.keyboard.press("ArrowRight")
        expect_tile(page, w.pid("ann"), 7, 6)
        press(w.signin("ben"), w.sid(), "south")
        expect_facing(page, w.pid("ben"), "south")
        say(page, f"fallback {tag()}")
        expect(named(page, "status", "Chat result")).to_have_text(heard(1))
        expect(room(page)).to_have_attribute("data-ripple", "growing")


def test_room_mirror_attributes(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (5, 3, "north")})
    ben_api = w.signin("ben")
    with room_page(browser, w, "ann") as page:
        region = room(page)
        expect(region).to_have_attribute("data-room-version", "1")
        expect(region).to_have_attribute("data-motion", "animated")
        expect(region).to_have_attribute("data-ripple", "none")
        expect(region).to_have_attribute("data-ripple-radius", "0")
        expect(region).to_contain_text("Room version 1")
        expect(named(page, "img", "Room view")).to_be_visible()
        expect(named(page, "list", "People here").get_by_role("listitem")).to_have_count(2)
        expect(named(page, "list", "Room features").get_by_role("listitem")).to_have_count(2)
        expect(named(page, "button", "Actions for Ben Reed")).to_be_visible()

        ann_entry = entry(page, w.pid("ann"))
        for attribute, value in (
            ("data-display-name", "Ann Ember"), ("data-tile-x", "2"), ("data-tile-y", "2"), ("data-facing", "north"),
            ("data-seated", "false"), ("data-avatar", "shown"), ("data-host", "true"),
        ):
            expect(ann_entry).to_have_attribute(attribute, value)
        expect(entry(page, w.pid("ben"))).to_have_attribute("data-host", "false")

        seat = feature(page, "seat-1")
        for attribute, value in (("data-kind", "seat"), ("data-tile-x", "5"), ("data-tile-y", "2"), ("data-occupied-by", "")):
            expect(seat).to_have_attribute(attribute, value)
        exit_tile = feature(page, "exit-1")
        for attribute, value in (("data-kind", "exit"), ("data-tile-x", "0"), ("data-tile-y", "6")):
            expect(exit_tile).to_have_attribute(attribute, value)

        assert ben_api.post(f"/api/sessions/{w.sid()}/sit").json()["result"] == "seated"
        expect(seat).to_have_attribute("data-occupied-by", w.pid("ben"))
        expect(entry(page, w.pid("ben"))).to_have_attribute("data-seated", "true")
        expect_tile(page, w.pid("ben"), 5, 2)
        assert ben_api.post(f"/api/sessions/{w.sid()}/stand").json()["result"] == "stood"
        expect(seat).to_have_attribute("data-occupied-by", "")
        expect_tile(page, w.pid("ben"), 5, 3)
        assert press(ben_api, w.sid(), "east").json()["result"] == "turned"
        expect_facing(page, w.pid("ben"), "east")
        assert press(ben_api, w.sid(), "east").json()["result"] == "moved"
        expect_tile(page, w.pid("ben"), 6, 3)

    detail = w.signin("ann").get(f"/api/sessions/{w.sid()}").json()
    assert detail["roomVersion"] == 1
    assert {f["id"]: (f["kind"], f["x"], f["y"]) for f in detail["features"]} == {
        "seat-1": ("seat", 5, 2), "exit-1": ("exit", 0, 6),
    }
    assert set(detail["people"][0]) == {"personId", "displayName", "x", "y", "facing", "seated", "avatar", "host"}


def test_turn_then_step(app_url: str) -> None:
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (5, 3, "north")})
    ann = w.signin("ann")
    sid = w.sid()
    assert press(ann, sid, "east").json() == {"result": "turned", "x": 2, "y": 2, "facing": "east"}
    assert people_of(ann, sid)[w.pid("ann")]["facing"] == "east"
    assert press(ann, sid, "east").json() == {"result": "moved", "x": 3, "y": 2, "facing": "east"}
    assert press(ann, sid, "south").json() == {"result": "turned", "x": 3, "y": 2, "facing": "south"}
    assert press(ann, sid, "west").json() == {"result": "turned", "x": 3, "y": 2, "facing": "west"}
    assert press(ann, sid, "west").json() == {"result": "moved", "x": 2, "y": 2, "facing": "west"}
    assert press(ann, sid, "north").json()["result"] == "turned"
    assert press(ann, sid, "north").json() == {"result": "moved", "x": 2, "y": 1, "facing": "north"}
    assert press(ann, sid, "south").json()["result"] == "turned"
    assert press(ann, sid, "south").json() == {"result": "moved", "x": 2, "y": 2, "facing": "south"}
    stored = people_of(ann, sid)[w.pid("ann")]
    assert (stored["x"], stored["y"], stored["facing"]) == (2, 2, "south")

    ben = w.signin("ben")
    assert ben.post(f"/api/sessions/{sid}/sit").status_code == 200
    for direction in ("north", "east"):
        err(press(ben, sid, direction), 409, "Stand up to move.")
        assert people_of(ben, sid)[w.pid("ben")]["facing"] == "north"
    err(press(ann, sid, "up"), 422, "Choose north, east, south or west.")


def test_refused_steps_and_pacing(app_url: str) -> None:
    timers = instance("APP_TIMERS_URL")
    w = live_world(app_url, {
        "ann": (2, 3, "east"), "ben": (4, 2, "east"), "carol": (6, 6, "east"), "dan": (7, 6, "north"),
        "eve": (11, 0, "north"),
    })
    sid = w.sid()
    ann, ben, carol, eve = w.signin("ann"), w.signin("ben"), w.signin("carol"), w.signin("eve")
    before = people_of(ann, sid)
    err(press(ann, sid, "east"), 409, "A wall blocks that way.")
    err(press(eve, sid, "north"), 409, "A wall blocks that way.")
    err(press(ben, sid, "east"), 409, "A seat blocks that way.")
    err(press(carol, sid, "east"), 409, "Someone is standing there.")
    assert people_of(ann, sid) == before, "a refused step changes nothing"

    w.clock("2027-03-01T12:00:00Z")
    paced = live_world(app_url, {"ann": (2, 3, "north"), "ben": (9, 9, "north")})
    paced.clock("2027-03-01T12:00:00Z", timers)
    fast = paced.signin("ann", timers)
    sid = paced.sid()
    assert press(fast, sid, "east").json()["result"] == "turned"
    err(press(fast, sid, "south"), 429, "Slow down a little.")
    assert people_of(fast, sid)[paced.pid("ann")]["facing"] == "east"
    paced.clock("2027-03-01T12:00:01Z", timers)
    err(press(fast, sid, "east"), 409, "A wall blocks that way.")
    err(press(fast, sid, "south"), 429, "Slow down a little.")
    assert SHORT_STEP_MS == 2000
    paced.clock("2027-03-01T12:00:02Z", timers)
    assert press(fast, sid, "south").json()["result"] == "turned", "refused presses do not restart the interval"


def test_sit_and_stand(app_url: str) -> None:
    w = live_world(app_url, {"ann": (5, 3, "north"), "ben": (4, 2, "east"), "carol": (9, 9, "north")})
    ann, ben, carol = w.signin("ann"), w.signin("ben"), w.signin("carol")
    sid = w.sid()
    err(carol.post(f"/api/sessions/{sid}/sit"), 409, "No seat in front of you.")
    err(ann.post(f"/api/sessions/{sid}/stand"), 409, "You are not seated.")
    seated = ann.post(f"/api/sessions/{sid}/sit")
    assert seated.status_code == 200 and seated.json()["result"] == "seated"
    assert (seated.json()["x"], seated.json()["y"]) == (5, 2)
    stored = people_of(ann, sid)[w.pid("ann")]
    assert stored["seated"] is True and (stored["x"], stored["y"]) == (5, 2)
    err(ben.post(f"/api/sessions/{sid}/sit"), 409, "That seat is taken.")
    assert carol.post(f"/api/sessions/{sid}/chat", json={"text": "still here"}).status_code == 201
    stood = ann.post(f"/api/sessions/{sid}/stand").json()
    assert stood["result"] == "stood" and (stood["x"], stood["y"]) == (5, 3)
    assert people_of(ann, sid)[w.pid("ann")]["seated"] is False

    assert ann.post(f"/api/sessions/{sid}/sit").status_code == 200
    assert ann.get(f"/api/sessions/{sid}").json()["features"]
    march(ben, sid, "south", 1)
    march(ben, sid, "east", 1)
    stored = people_of(ben, sid)[w.pid("ben")]
    assert (stored["x"], stored["y"]) == (5, 3), "the tile left by sitting is free"
    fallback = ann.post(f"/api/sessions/{sid}/stand").json()
    assert (fallback["x"], fallback["y"]) == (5, 1), "north is the first free neighbour of the seat"

    boxed = {
        "width": 12, "height": 12, "spawn": [{"x": 1, "y": 1}],
        "walls": [{"x": 5, "y": 1}, {"x": 6, "y": 2}, {"x": 4, "y": 2}],
        "seats": [{"id": "seat-1", "x": 5, "y": 2}], "exits": [],
    }
    tight = live_world(app_url, {"ann": (5, 3, "north"), "ben": (5, 4, "north")}, room_layout=boxed)
    a, b = tight.signin("ann"), tight.signin("ben")
    assert a.post(f"/api/sessions/{tight.sid()}/sit").status_code == 200
    assert press(b, tight.sid(), "north").json()["result"] == "moved"
    err(a.post(f"/api/sessions/{tight.sid()}/stand"), 409, "No space to stand.")
    assert people_of(a, tight.sid())[tight.pid("ann")]["seated"] is True


def test_wf_room_walk_keyboard_journey(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (6, 4, "south"), "carol": (11, 11, "north")})
    me = w.pid("ann")
    with room_page(browser, w, "ann") as page:
        start = named(page, "button", "Step north")
        start.focus()
        page.keyboard.press("ArrowRight")
        expect_facing(page, me, "east")
        expect_tile(page, me, 2, 2)
        page.keyboard.press("ArrowRight")
        expect_tile(page, me, 3, 2)
        page.keyboard.press("ArrowDown")
        expect_facing(page, me, "south")
        page.keyboard.press("ArrowDown")
        expect(said(page, "A wall blocks that way.")).to_have_count(1)
        expect_tile(page, me, 3, 2)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        expect_tile(page, me, 4, 2)

        page.keyboard.press("s")
        expect(entry(page, me)).to_have_attribute("data-seated", "true")
        expect_tile(page, me, 5, 2)
        page.keyboard.press("ArrowUp")
        expect(said(page, "Stand up to move.")).to_have_count(1)
        page.keyboard.press("s")
        expect(entry(page, me)).to_have_attribute("data-seated", "false")
        expect_tile(page, me, 4, 2)

        page.keyboard.press("n")
        expect(said(page, "Nearby: Ben Reed.")).to_have_count(1)

        page.keyboard.press("m")
        dialog = named(page, "dialog", "Person actions")
        expect(dialog).to_be_visible()
        expect(named(dialog, "button", "Block")).to_be_visible()
        expect(named(dialog, "button", "Mute")).to_be_visible()
        expect(named(dialog, "button", "Start removal vote")).to_be_visible()
        expect(named(dialog, "button", "Report")).to_be_visible()
        tab_stays_inside(page, dialog)
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("s")
        expect_facing(page, me, "east")
        expect(entry(page, me)).to_have_attribute("data-seated", "false")
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(start).to_be_focused()

        page.keyboard.press("t")
        field = named(page, "textbox", "Say something nearby")
        expect(field).to_be_focused()
        page.keyboard.type("sn")
        expect(field).to_have_value("sn")
        page.keyboard.press("ArrowLeft")
        expect_facing(page, me, "east")
        expect_tile(page, me, 4, 2)
        expect(entry(page, me)).to_have_attribute("data-seated", "false")
        page.keyboard.press("Escape")
        expect(start).to_be_focused()

        east = named(page, "button", "Step east")
        east.focus()
        click(field)
        expect(field).to_be_focused()
        page.keyboard.press("Escape")
        expect(east).to_be_focused()

    stored = people_of(w.signin("ann"), w.sid())[me]
    assert (stored["x"], stored["y"], stored["seated"]) == (4, 2, False)


def test_wf_room_walk_keyboard_announcements(app_url: str, browser: Browser) -> None:
    w = live_world(
        app_url, {"ann": (2, 0, "north"), "dan": (3, 0, "north"), "carol": (9, 0, "west")}, extra=("ben",),
    )
    with room_page(browser, w, "ann") as page:
        ben = w.signin("ben")
        assert ben.post(f"/api/sessions/{w.sid()}/join").status_code == 200
        expect(said(page, "Ben Reed arrived.")).to_have_count(1)
        expect(said(page, "Ben Reed is nearby.")).to_have_count(1)
        texts = [t.strip() for t in paragraphs(page).all_text_contents()]
        assert texts.index("Ben Reed arrived.") < texts.index("Ben Reed is nearby.")
        assert f"{NAMES['dan']} is nearby." not in texts, "people near at opening are never announced as nearby"
        assert ben.post(f"/api/sessions/{w.sid()}/leave").json() == {"status": "left"}
        expect(said(page, "Ben Reed left.")).to_have_count(1)
        assert press(w.signin("carol"), w.sid(), "west").json()["result"] == "moved"
        expect(said(page, "Carol Moss is nearby.")).to_have_count(1)
        page.keyboard.press("n")
        expect(said(page, "Nearby: Dan Fenn, Carol Moss.")).to_have_count(1)


def test_announcement_spacing_and_limit(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (2, 0, "north")})
    wall = "A wall blocks that way."
    alone = "Nobody is nearby."
    with room_page(browser, w, "ann") as page:
        page.keyboard.press("n")
        expect(said(page, alone)).to_have_count(1)
        page.keyboard.press("m")
        expect(said(page, alone)).to_have_count(1)
        expect(named(page, "dialog", "Person actions")).to_be_hidden()
        advance(page, DEDUPE_MS + 100)

        for _ in range(2):
            with page.expect_response(lambda r: r.url.endswith("/step") and r.status == 409):
                page.keyboard.press("ArrowUp")
        expect(said(page, wall)).to_have_count(1)
        advance(page, DEDUPE_MS - 100)
        with page.expect_response(lambda r: r.url.endswith("/step") and r.status == 409):
            page.keyboard.press("ArrowUp")
        expect(said(page, wall)).to_have_count(1)
        advance(page, DEDUPE_MS + 100)
        with page.expect_response(lambda r: r.url.endswith("/step") and r.status == 409):
            page.keyboard.press("ArrowUp")
        expect(said(page, wall)).to_have_count(2)

        for _ in range(13):
            page.keyboard.press("n")
            expect(paragraphs(page).last).to_have_text(alone)
            page.keyboard.press("ArrowUp")
            expect(paragraphs(page).last).to_have_text(wall)
        expect(paragraphs(page)).to_have_count(20)
        expect(paragraphs(page).last).to_have_text(wall)


def test_wf_room_walk_keyboard_refusals(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (4, 2, "east"), "ben": (4, 1, "south")})
    me = w.pid("ann")
    with room_page(browser, w, "ann") as page:
        named(page, "button", "Step south").focus()
        page.keyboard.press("ArrowRight")
        expect(said(page, "A seat blocks that way.")).to_have_count(1)
        expect_tile(page, me, 4, 2)
        page.keyboard.press("ArrowUp")
        expect_facing(page, me, "north")
        page.keyboard.press("ArrowUp")
        expect(said(page, "Someone is standing there.")).to_have_count(1)
        expect_tile(page, me, 4, 2)
        page.keyboard.press("ArrowDown")
        expect_facing(page, me, "south")
        page.keyboard.press("ArrowDown")
        expect_tile(page, me, 4, 3)
        page.keyboard.press("ArrowLeft")
        expect_facing(page, me, "west")
        page.keyboard.press("ArrowLeft")
        expect(said(page, "A wall blocks that way.")).to_have_count(1)
        expect_tile(page, me, 4, 3)
    stored = people_of(w.signin("ann"), w.sid())[me]
    assert (stored["x"], stored["y"], stored["facing"]) == (4, 3, "west")


def test_wf_room_walk_keyboard_sit_stand(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (4, 2, "east"), "ben": (5, 3, "north")})
    ann_id, ben_id = w.pid("ann"), w.pid("ben")
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben") as ben_page:
        page.keyboard.press("s")
        expect(entry(page, ann_id)).to_have_attribute("data-seated", "true")
        expect_tile(page, ann_id, 5, 2)
        expect(feature(page, "seat-1")).to_have_attribute("data-occupied-by", ann_id)
        expect(entry(ben_page, ann_id)).to_have_attribute("data-seated", "true")
        ben_page.keyboard.press("s")
        expect(said(ben_page, "That seat is taken.")).to_have_count(1)
        page.keyboard.press("ArrowUp")
        expect(said(page, "Stand up to move.")).to_have_count(1)
        expect_facing(page, ann_id, "east")
        page.keyboard.press("s")
        expect(entry(page, ann_id)).to_have_attribute("data-seated", "false")
        expect_tile(page, ann_id, 4, 2)
        expect(feature(page, "seat-1")).to_have_attribute("data-occupied-by", "")
        page.keyboard.press("ArrowUp")
        expect_facing(page, ann_id, "north")
        page.keyboard.press("s")
        expect(said(page, "No seat in front of you.")).to_have_count(1)
        ben_page.keyboard.press("s")
        expect(entry(page, ben_id)).to_have_attribute("data-seated", "true")
        expect(feature(page, "seat-1")).to_have_attribute("data-occupied-by", ben_id)
        page.keyboard.press("ArrowRight")
        expect_facing(page, ann_id, "east")
        page.keyboard.press("s")
        expect(said(page, "That seat is taken.")).to_have_count(1)
        ben_page.keyboard.press("s")
        expect(entry(page, ben_id)).to_have_attribute("data-seated", "false")
        expect_tile(page, ben_id, 5, 3)


def test_wf_two_instance_live_meet(app_url: str, browser: Browser, valkey: Any) -> None:
    second = instance("APP_SECOND_URL")
    arena = {
        "width": 12, "height": 12, "spawn": [{"x": 6, "y": 5}], "walls": [], "seats": [], "exits": [],
    }
    w = live_world(app_url, {"ann": (4, 5, "east")}, extra=("ben",), room_layout=arena)
    sid, ann_id, ben_id = w.sid(), w.pid("ann"), w.pid("ben")
    with room_page(browser, w, "ann") as ann_page:
        navigations: list[str] = []
        ann_page.on("framenavigated", lambda frame: navigations.append(frame.url))
        with browser_page(browser, w, "ben", f"/sessions/{sid}", base=second) as ben_page:
            click(named(ben_page, "button", "Join session"))
            expect(room(ben_page)).to_be_visible()
            wait_socket(ben_page, sid)
            expect(said(ann_page, "Ben Reed arrived.")).to_have_count(1)
            expect_tile(ann_page, ben_id, 6, 5)
            expect_tile(ben_page, ann_id, 4, 5)

            ben_api = w.signin("ben", second)
            if people_of(ben_api, sid)[ben_id]["facing"] != "west":
                assert press(ben_api, sid, "west").json()["result"] == "turned"
            expect_facing(ann_page, ben_id, "west")
            before = valkey.hash(f"session:{sid}:positions")
            assert {ann_id, ben_id} <= set(before), "positions live in the published hash"
            assert valkey.command("EXISTS", f"presence:{ann_id}") == 1

            ann_page.keyboard.press("ArrowUp")
            expect_facing(ben_page, ann_id, "north")
            ann_page.keyboard.press("ArrowUp")
            expect_tile(ben_page, ann_id, 4, 4)
            after = valkey.hash(f"session:{sid}:positions")
            assert after[ann_id] != before[ann_id], "the positions hash follows a move"
            ann_page.keyboard.press("ArrowDown")
            ann_page.keyboard.press("ArrowDown")
            expect_tile(ben_page, ann_id, 4, 5)
            ann_page.keyboard.press("ArrowRight")
            expect_facing(ben_page, ann_id, "east")

            ann_page.keyboard.press("ArrowRight")
            ben_page.keyboard.press("ArrowLeft")
            refusal = "Someone is standing there."

            def winner() -> str | None:
                people = people_of(w.signin("ann"), sid)
                on_tile = [pid for pid, p in people.items() if (p["x"], p["y"]) == (5, 5)]
                return on_tile[0] if len(on_tile) == 1 else None

            won = wait_for(winner, WAIT_SECONDS, "exactly one person should hold the contested tile (5,5)")
            for page in (ann_page, ben_page):
                expect_tile(page, won, 5, 5)
            loser_page, winner_page = (ben_page, ann_page) if won == ann_id else (ann_page, ben_page)
            loser_id = ben_id if won == ann_id else ann_id
            loser_tile = (6, 5) if won == ann_id else (4, 5)
            expect(said(loser_page, refusal)).to_have_count(1)
            for page in (ann_page, ben_page):
                expect_tile(page, loser_id, *loser_tile)

            click(named(winner_page, "button", "Leave session"))
            winner_name = "Ann Ember" if won == ann_id else "Ben Reed"
            expect(said(loser_page, f"{winner_name} left.")).to_have_count(1)
            expect(entry(loser_page, won)).to_have_count(0)
        assert not [u for u in navigations if u.endswith(f"/sessions/{sid}") and won != ann_id]


def test_one_tile_one_winner(app_url: str, valkey: Any) -> None:
    second = instance("APP_SECOND_URL")
    for _ in range(3):
        w = live_world(app_url, {
            "ann": (6, 5, "south"), "ben": (7, 6, "west"), "carol": (6, 7, "north"), "dan": (5, 6, "east"),
        })
        sid = w.sid()
        clients = [
            w.signin("ann"), w.signin("ben", second), w.signin("carol"), w.signin("dan", second),
        ]
        directions = ["south", "west", "north", "east"]
        answers = together([
            (lambda c=c, d=d: press(c, sid, d)) for c, d in zip(clients, directions)
        ])
        moved = [(i, r) for i, r in enumerate(answers) if r.status_code == 200]
        assert len(moved) == 1, [r.text for r in answers]
        assert moved[0][1].json() | {"facing": None} == {"result": "moved", "x": 6, "y": 6, "facing": None}
        for i, r in enumerate(answers):
            if i != moved[0][0]:
                err(r, 409, "Someone is standing there.")
        people = people_of(clients[0], sid)
        on_tile = [p for p in people.values() if (p["x"], p["y"]) == (6, 6)]
        assert len(on_tile) == 1
        assert w.pid(["ann", "ben", "carol", "dan"][moved[0][0]]) == on_tile[0]["personId"]
        assert len(valkey.hash(f"session:{sid}:positions")) == 4

    winner_index = moved[0][0]
    winner = clients[winner_index]
    opposite = {"south": "north", "west": "east", "north": "south", "east": "west"}
    march(winner, sid, opposite[directions[winner_index]], 1)
    other_index = (winner_index + 1) % 4
    assert press(clients[other_index], sid, directions[other_index]).json()["result"] == "moved", "a step off frees a tile"


def test_exits_and_leaving(app_url: str, browser: Browser, valkey: Any) -> None:
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (1, 6, "west"), "carol": (1, 7, "north"), "dan": (9, 9, "north")})
    sid = w.sid()
    ann = w.signin("ann")
    ben = w.signin("ben")
    assert w.pid("ben") in valkey.hash(f"session:{sid}:positions")
    left = press(ben, sid, "west")
    assert left.status_code == 200 and left.json()["result"] == "left"
    assert w.pid("ben") not in people_of(ann, sid)
    assert w.pid("ben") not in valkey.hash(f"session:{sid}:positions")
    assert valkey.command("EXISTS", f"presence:{w.pid('ben')}") == 0
    detail = ben.get(f"/api/sessions/{sid}").json()
    assert "people" not in detail, "someone who left no longer reads the inside view"

    dan = w.signin("dan")
    assert dan.post(f"/api/sessions/{sid}/leave").json() == {"status": "left"}
    assert w.pid("dan") not in people_of(ann, sid)

    with room_page(browser, w, "carol") as page:
        page.keyboard.press("ArrowUp")
        expect_tile(page, w.pid("carol"), 1, 6)
        page.keyboard.press("ArrowLeft")
        expect_facing(page, w.pid("carol"), "west")
        page.keyboard.press("ArrowLeft")
        expect(page).to_have_url(re.compile(r"/sessions/?$"))
    assert w.pid("carol") not in people_of(ann, sid)


def test_wf_two_instance_live_grace(app_url: str, browser: Browser) -> None:
    timers = instance("APP_TIMERS_URL")
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (7, 7, "north")})
    sid, ben_id = w.sid(), w.pid("ben")
    ann = w.signin("ann")
    with room_page(browser, w, "ben") as page:
        page.keyboard.press("ArrowUp")
        expect_tile(page, ben_id, 7, 6)
        count = socket_count(page, sid)
        page.reload()
        expect(room(page)).to_be_visible()
        wait_socket(page, sid, after=count)
        expect_tile(page, ben_id, 7, 6)
    stored = people_of(ann, sid)[ben_id]
    assert (stored["x"], stored["y"]) == (7, 6), "a reload inside the grace keeps the tile"

    short = live_world(app_url, {"ann": (2, 2, "north"), "ben": (7, 7, "north")})
    observer = short.signin("ann", timers)
    with room_page(browser, short, "ben", base=timers) as first:
        second_tab = first.context.new_page()
        watch_sockets(second_tab)
        go(second_tab, f"{timers}/sessions/{short.sid()}")
        expect(room(second_tab)).to_be_visible()
        wait_socket(second_tab, short.sid())
        second_tab.close()
        deadline = time.monotonic() + SHORT_GRACE_SECONDS + 3
        while time.monotonic() < deadline:
            assert short.pid("ben") in people_of(observer, short.sid()), "closing one of two tabs changes nothing"
    closed_at = time.monotonic()
    wait_for(
        lambda: short.pid("ben") not in people_of(observer, short.sid()),
        SHORT_GRACE_SECONDS + 6, "a person with no sockets should leave after DROP_GRACE_SECONDS",
    )
    assert time.monotonic() - closed_at >= SHORT_GRACE_SECONDS - 0.5, "the departure waits out the grace"


def test_wf_two_instance_live_host_handover(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (4, 2, "north")})
    ann_id, ben_id, sid = w.pid("ann"), w.pid("ben"), w.sid()
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben", base=second) as ben_page:
        expect(entry(ben_page, ann_id)).to_have_attribute("data-host", "true")
        expect(named(page, "combobox", "Invite a friend")).to_be_visible()
        expect(named(ben_page, "combobox", "Invite a friend")).to_have_count(0)
        tab_to(page, named(page, "button", "Leave session"))
        page.keyboard.press("Enter")
        expect(said(ben_page, "Ben Reed is now the host.")).to_have_count(1)
        expect(entry(ben_page, ben_id)).to_have_attribute("data-host", "true")
        expect(named(ben_page, "combobox", "Invite a friend")).to_be_visible()
        expect(named(ben_page, "button", "Invite")).to_be_visible()
    assert w.signin("ben").get(f"/api/sessions/{sid}").json()["hostId"] == ben_id


def test_wf_two_instance_live_seat(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (1, 1, "north"), "ben": (8, 2, "west")})
    ben_id = w.pid("ben")
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben", base=second) as ben_page:
        ben_page.keyboard.press("ArrowLeft")
        expect_tile(page, ben_id, 7, 2)
        expect(said(page, "Ben Reed is nearby.")).to_have_count(1)
        expect(said(ben_page, "Ann Ember is nearby.")).to_have_count(1)
        ben_page.keyboard.press("ArrowLeft")
        expect_tile(page, ben_id, 6, 2)
        ben_page.keyboard.press("s")
        expect(entry(page, ben_id)).to_have_attribute("data-seated", "true")
        expect_tile(page, ben_id, 5, 2)
        expect(feature(page, "seat-1")).to_have_attribute("data-occupied-by", ben_id)
        page.keyboard.press("n")
        expect(said(page, "Nearby: Ben Reed.")).to_have_count(1)
        ben_page.keyboard.press("s")
        expect(entry(page, ben_id)).to_have_attribute("data-seated", "false")
        expect_tile(page, ben_id, 6, 2)
        expect(feature(page, "seat-1")).to_have_attribute("data-occupied-by", "")


def test_wf_two_instance_live_touch(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (3, 5, "north"), "ben": (2, 5, "east")})
    ann_id, ben_id = w.pid("ann"), w.pid("ben")
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben", base=second, viewport=PHONE) as phone:
        step_east = named(phone, "button", "Step east")
        tap(step_east)
        expect(said(phone, "Someone is standing there.")).to_have_count(1)
        expect_tile(page, ben_id, 2, 5)
        page.keyboard.press("ArrowUp")
        expect_tile(phone, ann_id, 3, 4)
        tap(step_east)
        expect_tile(phone, ben_id, 3, 5)
        expect_tile(page, ben_id, 3, 5)


def test_wf_two_instance_live_reload(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (4, 5, "west"), "ben": (9, 5, "north")})
    sid, ann_id = w.sid(), w.pid("ann")
    ann = w.signin("ann")
    with room_page(browser, w, "ben", base=second) as page:
        expect_tile(page, ann_id, 4, 5)
        go(page, f"{second}/friends")
        expect(named(page, "navigation", "Main")).to_be_visible()
        march(ann, sid, "west", 3)
        count = socket_count(page, sid)
        go(page, f"{second}/sessions/{sid}")
        expect(room(page)).to_be_visible()
        wait_socket(page, sid, after=count)
        expect_tile(page, ann_id, 1, 5)
        expect(said(page, "Ann Ember is nearby.")).to_have_count(0)
        march(ann, sid, "east", 1)
        expect_tile(page, ann_id, 2, 5)
        expect(said(page, "Ann Ember is nearby.")).to_have_count(0)
        march(ann, sid, "east", 1)
        expect_tile(page, ann_id, 3, 5)
        expect(said(page, "Ann Ember is nearby.")).to_have_count(1)


def test_wf_phone_touch_walk_hold(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (1, 5, "east")})
    me = w.pid("ann")
    with room_page(browser, w, "ann", viewport=PHONE) as page:
        for name in ("Step north", "Step east", "Step south", "Step west", "Sit or stand"):
            found = box(named(page, "button", name))
            assert found["width"] >= MIN_TARGET_PX and found["height"] >= MIN_TARGET_PX, name

        step_east = named(page, "button", "Step east")
        x, y = center(step_east)
        page.mouse.move(x, y)
        page.mouse.down()
        expect_tile(page, me, 2, 5)
        advance(page, HOLD_REPEAT_MS)
        expect_tile(page, me, 3, 5)
        advance(page, HOLD_REPEAT_MS - 1)
        expect_tile(page, me, 3, 5)
        advance(page, 1)
        expect_tile(page, me, 4, 5)
        page.mouse.move(1, 1)
        page.mouse.up()
        advance(page, HOLD_REPEAT_MS * 4)
        expect_tile(page, me, 4, 5)

        tap(named(page, "button", "Step south"))
        expect_facing(page, me, "south")
        advance(page, HOLD_REPEAT_MS * 4)
        expect_tile(page, me, 4, 5)
        tap(named(page, "button", "Step south"))
        expect_tile(page, me, 4, 6)
        advance(page, HOLD_REPEAT_MS * 4)
        expect_tile(page, me, 4, 6)

        canvas = box(named(page, "img", "Room view"))
        assert canvas["y"] + canvas["height"] <= box(named(page, "button", "People and chat"))["y"] + 1
    stored = people_of(w.signin("ann"), w.sid())[me]
    assert (stored["x"], stored["y"], stored["facing"]) == (4, 6, "south")


def test_wf_phone_touch_walk_sheet(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (7, 5, "west")})
    me = w.pid("ann")
    inside = {"Send", "Say something nearby", "Close", "Actions for Ben Reed", "Actions for Ann Ember"}
    with room_page(browser, w, "ann", viewport=PHONE) as page:
        sheet = named(page, "dialog", "People and chat")
        opener = named(page, "button", "People and chat")
        expect(sheet).to_be_hidden()
        expect(named(page, "list", "People here")).to_be_hidden()
        expect(named(page, "log", "Nearby chat")).to_be_hidden()
        expect(entry(page, w.pid("ben"))).to_have_attribute("data-display-name", "Ben Reed")
        assert press(w.signin("ben"), w.sid(), "north").json()["result"] == "turned"
        expect_facing(page, w.pid("ben"), "north")
        assert not inside & set(tab_order(page, 15)), "tab order never reaches a closed sheet"
        no_overflow(page)

        opener.focus()
        page.keyboard.press("Enter")
        expect(sheet).to_be_visible()
        assert sheet.evaluate("s => s.contains(document.activeElement)"), "focus lands inside the sheet"
        expect(named(sheet, "list", "People here")).to_be_visible()
        tab_stays_inside(page, sheet)

        field = named(sheet, "textbox", "Say something nearby")
        field.focus()
        page.keyboard.type("hello")
        at_end = field.evaluate("f => f.selectionStart")
        page.keyboard.press("ArrowLeft")
        assert field.evaluate("f => f.selectionStart") == at_end - 1, "arrow keys move the caret"
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowLeft")
        expect_facing(page, me, "north")
        expect_tile(page, me, 5, 5)

        click(named(sheet, "button", "Close"))
        advance(page, 100)
        click(opener)
        advance(page, 2000)
        expect(sheet).to_be_visible()
        box_after = box(sheet)
        assert box_after["y"] < PHONE["height"], "a reopened sheet stays in the viewport"

        page.keyboard.press("Escape")
        advance(page, 2000)
        expect(sheet).to_be_hidden()
        expect(opener).to_be_focused()
        assert not inside & set(tab_order(page, 15))

        page.keyboard.press("t")
        expect(sheet).to_be_visible()
        expect(named(sheet, "textbox", "Say something nearby")).to_be_focused()


LAYOUT_CASES = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}


@pytest.mark.parametrize("viewport_name", ["phone", "tablet", "desktop"], ids=["phone", "tablet", "desktop"])
def test_published_layouts(app_url: str, browser: Browser, viewport_name: str) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (7, 5, "north")})
    with room_page(browser, w, "ann", viewport=LAYOUT_CASES[viewport_name]) as page:
        no_overflow(page)
        canvas = box(named(page, "img", "Room view"))
        step = box(named(page, "button", "Step south"))
        assert canvas["y"] + canvas["height"] <= step["y"] + 1, "direction buttons sit below the canvas"
        opener = named(page, "button", "People and chat")
        expect(named(page, "status", "Room announcements")).to_have_count(1)
        if viewport_name == "phone":
            expect(opener).to_be_visible()
            assert step["y"] < box(opener)["y"] + box(opener)["height"]
            assert box(opener)["y"] + 1 >= canvas["y"] + canvas["height"]
            click(opener)
            sheet = named(page, "dialog", "People and chat")
            expect(sheet).to_be_visible()
            for role, name in (("list", "People here"), ("list", "Room features"), ("log", "Nearby chat")):
                expect(named(sheet, role, name)).to_have_count(1)
            expect(named(sheet, "status", "Room announcements")).to_have_count(0)
            no_overflow(page)
        else:
            expect(opener).to_have_count(0)
            people = box(named(page, "list", "People here"))
            log = box(named(page, "log", "Nearby chat"))
            if viewport_name == "tablet":
                assert step["y"] + step["height"] <= people["y"] + 1, "people list sits below the buttons"
                assert people["x"] + people["width"] <= log["x"] + 1, "people left, chat right"
                assert people["y"] < log["y"] + log["height"] and log["y"] < people["y"] + people["height"]
                assert canvas["y"] + canvas["height"] <= log["y"] + 1
            else:
                assert people["x"] + people["width"] <= canvas["x"] + 1, "people list is left of the canvas"
                assert canvas["x"] + canvas["width"] <= log["x"] + 1, "chat is right of the canvas"
                features = box(named(page, "list", "Room features"))
                assert people["y"] + people["height"] <= features["y"] + 1, "features sit below the people list"
        for path in ("/sessions", "/friends", "/studio", "/communities"):
            go(page, f"{app_url}{path}")
            expect(named(page, "navigation", "Main")).to_be_visible()
            no_overflow(page)


def test_wf_phone_touch_walk_refused(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (4, 3, "west")})
    me = w.pid("ann")
    with room_page(browser, w, "ann", viewport=PHONE) as page:
        sit = named(page, "button", "Sit or stand")
        tap(named(page, "button", "Step west"))
        expect(said(page, "A wall blocks that way.")).to_have_count(1)
        expect_tile(page, me, 4, 3)
        tap(named(page, "button", "Step north"))
        expect_facing(page, me, "north")
        tap(named(page, "button", "Step north"))
        expect_tile(page, me, 4, 2)
        tap(named(page, "button", "Step east"))
        expect_facing(page, me, "east")
        tap(sit)
        expect(entry(page, me)).to_have_attribute("data-seated", "true")
        expect_tile(page, me, 5, 2)
        tap(named(page, "button", "Step south"))
        expect(said(page, "Stand up to move.")).to_have_count(1)
        tap(sit)
        expect(entry(page, me)).to_have_attribute("data-seated", "false")
        expect_tile(page, me, 4, 2)
        tap(named(page, "button", "Step south"))
        expect_facing(page, me, "south")
        tap(sit)
        expect(said(page, "No seat in front of you.")).to_have_count(1)
        no_overflow(page)


def test_wf_phone_touch_walk_chat(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (7, 5, "west")})
    line = f"phone {tag()}"
    reply = f"desk {tag()}"
    with room_page(browser, w, "ann", viewport=PHONE) as page, room_page(browser, w, "ben") as ben_page:
        opener = named(page, "button", "People and chat")
        sheet = named(page, "dialog", "People and chat")
        tap(opener)
        expect(sheet).to_be_visible()
        field = named(sheet, "textbox", "Say something nearby")
        field.focus()
        page.keyboard.type(line)
        tap(named(sheet, "button", "Send"))
        expect(named(sheet, "status", "Chat result")).to_have_text(heard(1))
        expect(named(ben_page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {line}")
        say(ben_page, reply)
        expect(named(sheet, "log", "Nearby chat")).to_contain_text(f"Ben Reed: {reply}")
        tap(named(sheet, "button", "Close"))
        advance(page, 2000)
        expect(sheet).to_be_hidden()
        page.keyboard.press("t")
        expect(sheet).to_be_visible()
        expect(field).to_be_focused()
        page.keyboard.press("Escape")
        advance(page, 2000)
        expect(sheet).to_be_hidden()
        expect(opener).to_be_visible()


def test_wf_phone_touch_walk_closed_sheet_current(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (7, 5, "west")}, extra=("carol",))
    ben_id, carol_id, sid = w.pid("ben"), w.pid("carol"), w.sid()
    ben, carol = w.signin("ben"), w.signin("carol")
    with room_page(browser, w, "ann", viewport=PHONE) as page:
        sheet = named(page, "dialog", "People and chat")
        expect(sheet).to_be_hidden()
        march(ben, sid, "south", 1)
        expect_tile(page, ben_id, 7, 6)
        assert carol.post(f"/api/sessions/{sid}/join").status_code == 200
        expect(said(page, "Carol Moss arrived.")).to_have_count(1)
        expect(named(page, "status", "Room announcements")).to_be_visible()
        expect(entry(page, carol_id)).to_have_attribute("data-display-name", "Carol Moss")
        tap(named(page, "button", "People and chat"))
        expect(sheet).to_be_visible()
        people = named(sheet, "list", "People here")
        expect(named(people, "button", "Actions for Carol Moss")).to_be_visible()
        expect(named(people, "button", "Actions for Ben Reed")).to_be_visible()
        expect_tile(page, ben_id, 7, 6)


DISTANCE_CASES = {
    "x6": [11, 5, True],
    "x7": [12, 5, False],
    "corner6": [11, 11, True],
    "corner7": [12, 11, False],
    "north5": [5, 0, True],
}
OPEN_HALL = {"width": 13, "height": 12, "spawn": [{"x": 0, "y": 0}], "walls": [], "seats": [], "exits": []}


@pytest.mark.parametrize("case", list(DISTANCE_CASES), ids=list(DISTANCE_CASES))
def test_chat_distance_table(app_url: str, case: str) -> None:
    x, y, hears = DISTANCE_CASES[case]
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (x, y, "north")}, room_layout=OPEN_HALL)
    ann, ben = w.signin("ann"), w.signin("ben")
    body = f"distance {tag()}"
    r = chat(ann, w.sid(), body)
    assert r.status_code == 201 and r.json()["id"]
    assert r.json()["heardBy"] == (1 if hears else 0)
    assert (body in chat_texts(ben, w.sid())) is hears
    assert body in chat_texts(ann, w.sid())


def test_wf_proximity_chat_edge_three_members(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (8, 2, "north"), "carol": (9, 2, "west")})
    body = f"secret {tag()}"
    with room_page(browser, w, "ann") as ann_page, room_page(browser, w, "ben") as ben_page, \
            room_page(browser, w, "carol") as carol_page:
        with held(ann_page, "**/api/sessions/*/chat") as gate:
            say(ann_page, body)
            expect(named(ann_page, "status", "Chat result")).to_have_text("Sending...")
            let_go(gate)
        expect(named(ann_page, "status", "Chat result")).to_have_text(heard(1))
        expect(named(ben_page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {body}")
        expect(named(ann_page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {body}")
        carol_api = w.signin("carol")
        assert body not in chat_texts(carol_api, w.sid())
        assert press(w.signin("ben"), w.sid(), "north").json()["result"] == "moved"
        assert press(carol_api, w.sid(), "west").json()["result"] == "moved"
        expect_tile(carol_page, w.pid("carol"), 8, 2)
        expect(named(carol_page, "log", "Nearby chat")).not_to_contain_text(body)
        assert not [f for f in SOCKETS[carol_page].frames if body in f], "a non-recipient socket carries nothing"
        assert any(body in f for f in SOCKETS[ben_page].frames), "the recipient's socket carried it"
        assert body not in chat_texts(carol_api, w.sid())
        history = w.signin("ben").get(f"/api/sessions/{w.sid()}/chat").json()["messages"]
        row = next(m for m in history if m["text"] == body)
        assert row["fromId"] == w.pid("ann") and row["fromName"] == "Ann Ember"


def test_wf_proximity_chat_edge_length(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (3, 2, "north")})
    ann, ben = w.signin("ann"), w.signin("ben")
    sid = w.sid()
    over = f"Messages can be at most {CHAT_MAX} characters."
    assert chat(ann, sid, "x" * CHAT_MAX).status_code == 201
    err(chat(ann, sid, "x" * (CHAT_MAX + 1)), 422, over)
    assert chat(ann, sid, FAMILY_EMOJI * CHAT_MAX).status_code == 201
    err(chat(ann, sid, FAMILY_EMOJI * (CHAT_MAX + 1)), 422, over)
    err(chat(ann, sid, ""), 422, "Write something to send.")
    err(chat(ann, sid, "   "), 422, "Write something to send.")
    assert FAMILY_EMOJI * (CHAT_MAX + 1) not in chat_texts(ben, sid)
    with room_page(browser, w, "ann") as page:
        say(page, "y" * (CHAT_MAX + 1))
        expect(named(page, "status", "Chat result")).to_have_text(over)
        expect(room(page)).to_have_attribute("data-ripple", "none")
        say(page, "   ")
        expect(named(page, "status", "Chat result")).to_have_text("Write something to send.")
    assert "y" * (CHAT_MAX + 1) not in chat_texts(ben, sid)


def test_earshot_ripple(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north")})
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben") as listener:
        region = room(page)
        say(page, f"ripple {tag()}")
        expect(named(page, "status", "Chat result")).to_have_text(heard(1))
        expect(region).to_have_attribute("data-ripple", "growing")
        expect(region).to_have_attribute("data-ripple-radius", "0")
        expect(named(listener, "log", "Nearby chat")).to_contain_text("ripple")
        expect(room(listener)).to_have_attribute("data-ripple", "none")
        for radius in range(1, 7):
            advance(page, RIPPLE_STEP_MS)
            expect(region).to_have_attribute("data-ripple-radius", str(radius))
        advance(page, RIPPLE_HOLD_MS - 100)
        expect(region).to_have_attribute("data-ripple-radius", "6")
        advance(page, 200)
        expect(region).to_have_attribute("data-ripple", "none")
        expect(region).to_have_attribute("data-ripple-radius", "0")

        say(page, f"first {tag()}")
        expect(region).to_have_attribute("data-ripple", "growing")
        advance(page, RIPPLE_STEP_MS * 2)
        expect(region).to_have_attribute("data-ripple-radius", "2")
        say(page, f"second {tag()}")
        expect(region).to_have_attribute("data-ripple-radius", "0")
        advance(page, RIPPLE_STEP_MS)
        expect(region).to_have_attribute("data-ripple-radius", "1")
        advance(page, RIPPLE_STEP_MS * 5 + RIPPLE_HOLD_MS + 100)
        expect(region).to_have_attribute("data-ripple", "none")

        say(page, "   ")
        expect(named(page, "status", "Chat result")).to_have_text("Write something to send.")
        expect(region).to_have_attribute("data-ripple", "none")
        expect(region).to_have_attribute("data-ripple-radius", "0")


def test_wf_proximity_chat_edge_keyboard(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (7, 5, "west")})
    line = f"keys {tag()}"
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben") as ben_page:
        field = named(page, "textbox", "Say something nearby")
        click(field)
        expect(field).to_be_focused()
        page.keyboard.press("Escape")
        expect(room(page)).to_be_focused()
        page.keyboard.press("ArrowRight")
        expect_facing(page, w.pid("ann"), "east")
        start = named(page, "button", "Step north")
        start.focus()
        page.keyboard.press("t")
        expect(field).to_be_focused()
        page.keyboard.press("Escape")
        expect(start).to_be_focused()
        page.keyboard.press("t")
        expect(field).to_be_focused()
        page.keyboard.type(line)
        result = named(page, "status", "Chat result")
        with held(page, f"**/api/sessions/{w.sid()}/chat") as gate:
            page.keyboard.press("Enter")
            expect(result).to_have_text("Sending...")
            let_go(gate)
        expect(result).to_have_text(heard(1))
        expect(named(page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {line}")
        expect(named(ben_page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {line}")


def test_wf_proximity_chat_edge_walk_out(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (1, 3, "east"), "ben": (7, 3, "east")})
    sid, ben_id = w.sid(), w.pid("ben")
    ben = w.signin("ben", second)
    first, missed, third = f"first {tag()}", f"missed {tag()}", f"third {tag()}"
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben", base=second) as ben_page:
        result = named(page, "status", "Chat result")
        log = named(ben_page, "log", "Nearby chat")
        say(page, first)
        expect(result).to_have_text(heard(1))
        expect(log).to_contain_text(f"Ann Ember: {first}")

        ben_page.keyboard.press("ArrowRight")
        expect_tile(ben_page, ben_id, 8, 3)
        say(page, missed)
        expect(result).to_have_text(heard(0))
        ben_page.keyboard.press("ArrowLeft")
        expect_facing(ben_page, ben_id, "west")
        ben_page.keyboard.press("ArrowLeft")
        expect_tile(ben_page, ben_id, 7, 3)
        say(page, third)
        expect(result).to_have_text(heard(1))
        expect(log).to_contain_text(f"Ann Ember: {third}")
        expect(log).not_to_contain_text(missed)
        assert not [f for f in SOCKETS[ben_page].frames if missed in f]
    assert missed not in chat_texts(ben, sid)
    assert first in chat_texts(ben, sid) and third in chat_texts(ben, sid)


def test_wf_session_visibility_open_and_handover(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol"), person("dan")],
        friendships=[["ann", "ben"], ["ann", "carol"]],
        rooms=[loft_room("ann")],
    )
    ben, carol, dan = w.signin("ben"), w.signin("carol"), w.signin("dan")
    with browser_page(browser, w, "ann", "/sessions") as page:
        opener = named(page, "button", "Open a session")
        click(opener)
        dialog = named(page, "dialog", "Open a session")
        expect(dialog).to_be_visible()
        select(named(dialog, "combobox", "Room"), "Test Loft")
        select(named(dialog, "combobox", "Visibility"), "friends")
        fill(named(dialog, "spinbutton", "Capacity"), "5")
        click(named(dialog, "button", "Open session"))
        expect(room(page)).to_be_visible()
        expect(page).to_have_url(re.compile(r"/sessions/[^/]+$"))
        sid = page.url.rstrip("/").rsplit("/", 1)[1]
        wait_socket(page, sid)
        host_detail = w.signin("ann").get(f"/api/sessions/{sid}").json()
        assert host_detail["hostId"] == w.pid("ann") and host_detail["visibility"] == "friends"
        assert host_detail["capacity"] == 5 and host_detail["count"] == 1 and host_detail["status"] == "open"

        assert sid in {s["id"] for s in ben.get("/api/sessions").json()["sessions"]}
        assert sid not in {s["id"] for s in dan.get("/api/sessions").json()["sessions"]}
        not_found(dan.post(f"/api/sessions/{sid}/join"))
        assert ben.post(f"/api/sessions/{sid}/join").status_code == 200
        assert carol.post(f"/api/sessions/{sid}/join").status_code == 200

        with room_page(browser, w, "ben", sid) as ben_page:
            click(named(page, "button", "Leave session"))
            expect(said(ben_page, "Ben Reed is now the host.")).to_have_count(1)
            expect(entry(ben_page, w.pid("ben"))).to_have_attribute("data-host", "true")
            assert ben.get(f"/api/sessions/{sid}").json()["hostId"] == w.pid("ben")
    assert ben.post(f"/api/sessions/{sid}/leave").json() == {"status": "left"}
    assert carol.get(f"/api/sessions/{sid}").json()["hostId"] == w.pid("carol")
    assert carol.post(f"/api/sessions/{sid}/leave").json() == {"status": "left"}
    not_found(carol.get(f"/api/sessions/{sid}"))
    not_found(carol.post(f"/api/sessions/{sid}/join"))
    assert sid not in {s["id"] for s in carol.get("/api/sessions").json()["sessions"]}


def test_session_open_validation(app_url: str) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben")],
        rooms=[
            loft_room("ann"),
            {"key": "draft", "name": "Draft", "owner": "ann",
             "versions": [{"rank": "Feather", "layout": DEN_V1, "published": False}]},
        ],
        communities=[{"key": "c", "name": "Stitch Night", "timeZone": "America/New_York",
                      "members": [{"person": "ben", "role": "owner"}, {"person": "ann", "role": "member"}]}],
    )
    ann = w.signin("ann")
    loft = w.ids["rooms"]["loft"]

    def open_session(**change: Any) -> httpx.Response:
        return ann.post("/api/sessions", json={
            "roomId": loft, "visibility": "public", "capacity": 3, "communityId": None, **change,
        })

    capacity_text = f"Capacity must be between 1 and {CAPACITY_MAX}."
    err(open_session(capacity=0), 422, capacity_text)
    err(open_session(capacity=CAPACITY_MAX + 1), 422, capacity_text)
    for allowed in (1, CAPACITY_MAX):
        made = open_session(capacity=allowed)
        assert made.status_code == 201 and made.json()["capacity"] == allowed
        assert ann.post(f"/api/sessions/{made.json()['id']}/leave").status_code == 200
    err(open_session(visibility="secret"), 422, "Choose public, friends, community or invite.")
    err(open_session(visibility="community"), 422, "Choose a community for this session.")
    not_found(open_session(visibility="community", communityId=w.ids["communities"]["c"]))
    not_found(open_session(roomId=w.ids["rooms"]["draft"]))


VISIBILITY_ROWS = {
    "any": ["public"],
    "friend": ["public", "friends"],
    "community-member": ["public", "community"],
    "invited": ["public", "invite"],
    "blocked-by-host": ["public"],
    "blocks-host": ["public"],
    "removed": [],
    "other-world": [],
}


@pytest.mark.parametrize("row", list(VISIBILITY_ROWS), ids=list(VISIBILITY_ROWS))
def test_visibility_table(app_url: str, row: str) -> None:
    all_in = row in ("blocked-by-host", "blocks-host")
    friends = [["host", "viewer"]] if row == "friend" or all_in else []
    members = [{"person": "host", "role": "owner"}]
    if row == "community-member" or all_in:
        members.append({"person": "viewer", "role": "member"})
    invitees = ["viewer"] if row == "invited" or all_in else []
    blocks = {"blocked-by-host": [{"from": "host", "to": "viewer"}], "blocks-host": [{"from": "viewer", "to": "host"}]}
    placements = [{"person": "host", "x": 2, "y": 2, "facing": "north"}]
    if row == "removed":
        placements += [
            {"person": "viewer", "x": 3, "y": 2, "facing": "north"},
            {"person": "third", "x": 4, "y": 2, "facing": "north"},
        ]
    sessions = [
        {
            "key": level, "room": "loft", "host": "host", "visibility": level, "capacity": 10,
            "community": "c" if level == "community" else None,
            "invitees": invitees if level == "invite" else [], "placements": placements,
        }
        for level in ("public", "friends", "community", "invite")
    ]
    w = setup_world(
        app_url,
        people=[person("host"), person("viewer"), person("third")],
        friendships=friends,
        blocks=blocks.get(row, []),
        communities=[{"key": "c", "name": "Stitch Night", "timeZone": "America/New_York", "members": members}],
        rooms=[loft_room("host")],
        sessions=sessions,
    )
    if row == "removed":
        host, third = w.signin("host"), w.signin("third")
        for level in ("public", "friends", "community", "invite"):
            sid = w.sid(level)
            vote = host.post(f"/api/sessions/{sid}/votes", json={"personId": w.pid("viewer")}).json()
            cast = third.post(f"/api/sessions/{sid}/votes/{vote['id']}/ballots", json={"choice": "yes"})
            assert cast.status_code == 201 and cast.json()["status"] == "passed"
    if row == "other-world":
        elsewhere = setup_world(app_url, people=[person("viewer")])
        viewer = elsewhere.signin("viewer")
    else:
        viewer = w.signin("viewer")

    may = set(VISIBILITY_ROWS[row])
    listed = viewer.get("/api/sessions").json()
    wanted_ids = {w.sid(level) for level in may}
    assert {s["id"] for s in listed["sessions"]} == wanted_ids
    assert listed["total"] == len(wanted_ids)
    for level in ("public", "friends", "community", "invite"):
        sid = w.sid(level)
        if level in may:
            assert viewer.get(f"/api/sessions/{sid}").status_code == 200
            joined = viewer.post(f"/api/sessions/{sid}/join")
            assert joined.status_code == 200 and joined.json()["count"] == 2
            again = viewer.post(f"/api/sessions/{sid}/join")
            assert again.status_code == 200 and again.json()["count"] == 2
        else:
            not_found(viewer.get(f"/api/sessions/{sid}"))
            not_found(viewer.post(f"/api/sessions/{sid}/join"))


def test_barred_sessions_stay_hidden(app_url: str) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("dan")],
        friendships=[["ann", "ben"]],
        rooms=[loft_room("ann", name=HIDDEN_ROOM), loft_room("dan", key="porch", name="Open Porch")],
        sessions=[
            {"key": "secret", "room": "loft", "host": "ann", "visibility": "invite", "capacity": 1,
             "community": None, "invitees": [], "placements": [{"person": "ann", "x": 2, "y": 2, "facing": "north"}]},
            {"key": "open", "room": "porch", "host": "dan", "visibility": "public", "capacity": 4,
             "community": None, "invitees": []},
        ],
    )
    other = setup_world(app_url, people=[person("zed")], rooms=[loft_room("zed", name="Far Room")])
    ben = w.signin("ben")
    sid = w.sid("secret")
    for path in ("/api/sessions", "/api/sessions?q=Hidden", "/api/sessions?q=Ann", "/api/friends"):
        r = ben.get(path)
        assert r.status_code == 200
        assert sid not in r.text and HIDDEN_ROOM not in r.text
    everything = ben.get("/api/sessions").json()
    assert [s["id"] for s in everything["sessions"]] == [w.sid("open")] and everything["total"] == 1
    assert ben.get("/api/sessions", params={"q": "Hidden"}).json() == {"sessions": [], "total": 0}
    friend = next(f for f in ben.get("/api/friends").json()["friends"] if f["personId"] == w.pid("ann"))
    assert friend["presence"] == "online" and friend["session"] is None

    not_found(ben.get(f"/api/sessions/{sid}"))
    not_found(ben.post(f"/api/sessions/{sid}/join"))
    not_found(press(ben, sid, "north"))
    not_found(chat(ben, sid, "hello"))
    not_found(ben.get(f"/api/sessions/{sid}/chat"))
    not_found(ben.get(f"/api/sessions/{sid}/votes"))

    ann = w.signin("ann")
    far = other.pid("zed")
    not_found(ann.post(f"/api/sessions/{sid}/invitees", json={"personId": far}))
    not_found(ann.post(f"/api/sessions/{sid}/votes", json={"personId": far}))
    not_found(ann.post("/api/sessions", json={
        "roomId": other.ids["rooms"]["loft"], "visibility": "public", "capacity": 2, "communityId": None,
    }))
    not_found(ann.post("/api/reports", json={
        "personId": far, "sessionId": sid, "category": "other", "details": "Invented report.",
    }))


def test_wf_session_visibility_barred_page(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol")],
        friendships=[["ann", "ben"], ["carol", "ben"]],
        rooms=[loft_room("ann")],
        sessions=[
            {"key": "secret", "room": "loft", "host": "ann", "visibility": "invite", "capacity": 3,
             "community": None, "invitees": [], "placements": [{"person": "ann", "x": 2, "y": 2, "facing": "north"}]},
            {"key": "pals", "room": "loft", "host": "carol", "visibility": "friends", "capacity": 3,
             "community": None, "invitees": [], "placements": [{"person": "carol", "x": 2, "y": 2, "facing": "north"}]},
        ],
    )
    with browser_page(browser, w, "ben", f"/sessions/{w.sid('secret')}") as page:
        expect(page.get_by_role("heading", name="This session isn't available.", exact=True)).to_be_visible()
        expect(named(page, "button", "Join session")).to_have_count(0)
        go(page, f"{app_url}/sessions")
        friends = named(page, "list", "Friends' sessions")
        expect(named(friends, "button", "Join Carol Moss")).to_be_visible()
        expect(named(friends, "button", "Join Ann Ember")).to_have_count(0)
        expect(friends.locator(f'[data-session-id="{w.sid("pals")}"]')).to_have_count(1)
        expect(named(page, "list", "Sessions").locator(f'[data-session-id="{w.sid("secret")}"]')).to_have_count(0)
        search = named(page, "searchbox", "Search sessions")
        fill(search, "Test Loft")
        expect(named(page, "list", "Sessions").locator(f'[data-session-id="{w.sid("pals")}"]')).to_have_count(1)
        fill(search, f"nothing-{tag()}")
        expect(named(page, "list", "Sessions").locator(f'[data-session-id="{w.sid("pals")}"]')).to_have_count(0)
        expect(named(page, "status", "Session count")).to_contain_text("0")


def test_last_capacity_place(app_url: str) -> None:
    second = instance("APP_SECOND_URL")
    keys = ["a1", "a2", "a3", "a4", "a5", "a6", "a7", "a8"]
    w = setup_world(
        app_url,
        people=[person("host")] + [person(k) for k in keys] + [person("twice")],
        rooms=[loft_room("host")],
        sessions=[
            {"key": "last", "room": "loft", "host": "host", "visibility": "public", "capacity": 2,
             "community": None, "invitees": []},
            {"key": "tabs", "room": "loft", "host": "host", "visibility": "public", "capacity": 3,
             "community": None, "invitees": []},
        ],
    )
    sid = w.sid("last")
    clients = [w.signin(k, second if i % 2 else app_url) for i, k in enumerate(keys)]
    answers = together([(lambda c=c: c.post(f"/api/sessions/{sid}/join")) for c in clients])
    winners = [r for r in answers if r.status_code == 200]
    assert len(winners) == 1, [r.text for r in answers]
    for r in answers:
        if r.status_code != 200:
            err(r, 409, "This session is full.")
    host = w.signin("host")
    assert host.get(f"/api/sessions/{sid}").json()["count"] == 2
    assert len(people_of(host, sid)) == 2

    tabs = w.sid("tabs")
    first, other_tab = w.signin("twice"), w.signin("twice", second)
    answers = together([
        lambda: first.post(f"/api/sessions/{tabs}/join"), lambda: other_tab.post(f"/api/sessions/{tabs}/join"),
    ])
    assert [r.status_code for r in answers] == [200, 200]
    assert host.get(f"/api/sessions/{tabs}").json()["count"] == 2, "two tabs count once"


def test_wf_session_visibility_last_place_race(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (2, 2, "north")}, extra=("ben", "carol"), capacity=2)
    sid = w.sid()
    with browser_page(browser, w, "ben", f"/sessions/{sid}") as ben_page, \
            browser_page(browser, w, "carol", f"/sessions/{sid}", base=second) as carol_page:
        ben_join = named(ben_page, "button", "Join session")
        carol_join = named(carol_page, "button", "Join session")
        expect(ben_join).to_be_visible()
        expect(carol_join).to_be_visible()
        ben_join.focus()
        carol_join.focus()
        ben_page.keyboard.press("Enter")
        carol_page.keyboard.press("Enter")

        def settled() -> dict | None:
            people = people_of(w.signin("ann"), sid)
            return people if len(people) == 2 else None

        people = wait_for(settled, WAIT_SECONDS, "exactly one new person should take the last place")
        ben_won = w.pid("ben") in people
        assert ben_won != (w.pid("carol") in people)
        loser, winner = (carol_page, ben_page) if ben_won else (ben_page, carol_page)
        expect(room(winner)).to_be_visible()
        expect(named(loser, "status", "Session result")).to_have_text("This session is full.")
        assert w.signin("ann").get(f"/api/sessions/{sid}").json()["count"] == 2


def test_friend_presence(app_url: str, browser: Browser) -> None:
    timers = instance("APP_TIMERS_URL")
    w = setup_world(
        app_url,
        people=[person(k) for k in ("ann", "ben", "carol", "dan", "eve", "frank")],
        friendships=[["ann", k] for k in ("ben", "carol", "dan", "eve", "frank")],
        blocks=[{"from": "eve", "to": "ann"}],
        rooms=[loft_room("ann")],
        sessions=[
            {"key": "open", "room": "loft", "host": "ben", "visibility": "public", "capacity": 4, "community": None,
             "invitees": [], "placements": [{"person": "ben", "x": 2, "y": 2, "facing": "north"}]},
            {"key": "secret", "room": "loft", "host": "carol", "visibility": "invite", "capacity": 4, "community": None,
             "invitees": [], "placements": [{"person": "carol", "x": 2, "y": 2, "facing": "north"}]},
            {"key": "pals", "room": "loft", "host": "frank", "visibility": "friends", "capacity": 4, "community": None,
             "invitees": [], "placements": [{"person": "frank", "x": 2, "y": 2, "facing": "north"}]},
        ],
    )
    ann = w.signin("ann")

    def presence() -> dict[str, dict]:
        return {f["personId"]: f for f in ann.get("/api/friends").json()["friends"]}

    friends = presence()
    assert friends[w.pid("ben")]["presence"] == "in-session"
    assert friends[w.pid("ben")]["session"] == {"id": w.sid("open"), "roomName": "Test Loft"}
    assert friends[w.pid("carol")]["presence"] == "online" and friends[w.pid("carol")]["session"] is None
    assert friends[w.pid("dan")]["presence"] == "offline" and friends[w.pid("dan")]["session"] is None
    assert w.pid("eve") not in friends
    eve = w.signin("eve")
    assert w.pid("ann") not in {f["personId"] for f in eve.get("/api/friends").json()["friends"]}
    assert eve.delete(f"/api/blocks/{w.pid('ann')}").json() == {"blocked": False}
    assert w.pid("eve") in presence()

    with browser_page(browser, w, "dan", "/friends", base=timers) as dan_page:
        expect(named(dan_page, "navigation", "Main")).to_be_visible()
        wait_for(
            lambda: presence()[w.pid("dan")]["presence"] == "online", WAIT_SECONDS,
            "a person with an open /ws/me socket should read online",
        )
    wait_for(
        lambda: presence()[w.pid("dan")]["presence"] == "offline", SHORT_GRACE_SECONDS + 8,
        "a person with no sockets should read offline after DROP_GRACE_SECONDS",
    )

    with browser_page(browser, w, "ann", "/friends") as page:
        rows = named(page, "list", "Friends")
        ben_row = rows.locator(f'[data-person-id="{w.pid("ben")}"]')
        expect(ben_row).to_have_attribute("data-presence", "in-session")
        expect(named(ben_row, "button", "Join Ben Reed")).to_be_visible()
        carol_row = rows.locator(f'[data-person-id="{w.pid("carol")}"]')
        expect(carol_row).to_have_attribute("data-presence", "online")
        expect(named(carol_row, "button", "Join Carol Moss")).to_have_count(0)
        expect(named(carol_row, "button", "Remove friend Carol Moss")).to_be_visible()
        dan_row = rows.locator(f'[data-person-id="{w.pid("dan")}"]')
        expect(dan_row).to_have_attribute("data-presence", "offline")
        dan = w.signin("dan")
        assert dan.post(f"/api/sessions/{w.sid('open')}/join").status_code == 200
        with room_page(browser, w, "dan", w.sid("open"), base=instance("APP_SECOND_URL")) as dan_page:
            expect(dan_row).to_have_attribute("data-presence", "in-session")
            expect(named(dan_row, "button", "Join Dan Fenn")).to_be_visible()
            tab_to(dan_page, named(dan_page, "button", "Leave session"))
            dan_page.keyboard.press("Enter")
            expect(dan_row).not_to_have_attribute("data-presence", "in-session")
            expect(named(dan_row, "button", "Join Dan Fenn")).to_have_count(0)
        go(page, f"{app_url}/sessions")
        lounge = named(page, "list", "Friends' sessions")
        expect(named(lounge, "button", "Join Frank Lowe")).to_be_visible()
        expect(named(lounge, "button", "Join Ben Reed")).to_have_count(0)
        tab_to(page, named(lounge, "button", "Join Frank Lowe"))
        page.keyboard.press("Enter")
        expect(room(page)).to_be_visible()


def test_wf_session_visibility_search_live(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol"), person("dan")],
        rooms=[loft_room("ann"), den_room("carol"), loft_room("ben", key="attic", name=HIDDEN_ROOM)],
        sessions=[
            {"key": "loft", "room": "loft", "host": "ann", "visibility": "public", "capacity": 5, "community": None,
             "invitees": [], "placements": [{"person": "ann", "x": 2, "y": 2, "facing": "north"}]},
            {"key": "den", "room": "den", "host": "carol", "visibility": "public", "capacity": 5, "community": None,
             "invitees": [], "placements": [{"person": "carol", "x": 6, "y": 6, "facing": "north"}]},
            {"key": "secret", "room": "attic", "host": "ben", "visibility": "invite", "capacity": 5, "community": None,
             "invitees": [], "placements": [{"person": "ben", "x": 2, "y": 2, "facing": "north"}]},
        ],
    )
    with room_page(browser, w, "carol", w.sid("den")) as host_page, browser_page(browser, w, "dan", "/sessions") as page:
        sessions = named(page, "list", "Sessions")
        count = named(page, "status", "Session count")
        expect(count).to_contain_text("2")
        expect(sessions.locator(f'[data-session-id="{w.sid("secret")}"]')).to_have_count(0)
        page.evaluate("window.keptAcrossSearch = true")
        search = named(page, "searchbox", "Search sessions")
        tab_to(page, search)
        page.keyboard.type(HIDDEN_ROOM)
        expect(count).to_contain_text("0")
        expect(sessions.locator("[data-session-id]")).to_have_count(0)
        page.keyboard.press("Control+a")
        page.keyboard.type("Test Den")
        expect(count).to_contain_text("1")
        expect(named(sessions, "button", "Join Test Loft")).to_have_count(0)
        join = named(sessions, "button", "Join Test Den")
        expect(join).to_be_visible()
        assert page.evaluate("window.keptAcrossSearch") is True, "a search never reloads the page"
        tab_to(page, join)
        page.keyboard.press("Enter")
        expect(room(page)).to_be_visible()
        expect(said(host_page, "Dan Fenn arrived.")).to_have_count(1)
    assert w.pid("dan") in people_of(w.signin("carol"), w.sid("den"))


def test_wf_session_visibility_outage_alert(app_url: str, browser: Browser) -> None:
    down = instance("APP_VALKEY_DOWN_URL")
    message = "Live rooms are unavailable right now."
    w = live_world(app_url, {"ann": (2, 2, "north")}, extra=("carol",))
    sid = w.sid()
    with browser_page(browser, w, "carol", "/sessions", base=down) as page:
        join = named(named(page, "list", "Sessions"), "button", "Join Test Loft")
        expect(join).to_be_visible()
        click(join)
        expect(alert_with(page, message)).to_be_visible()

        go(page, f"{down}/sessions")
        opener = named(page, "button", "Open a session")
        click(opener)
        dialog = named(page, "dialog", "Open a session")
        expect(dialog).to_be_visible()
        select(named(dialog, "combobox", "Room"), "Test Loft")
        select(named(dialog, "combobox", "Visibility"), "public")
        fill(named(dialog, "spinbutton", "Capacity"), "3")
        click(named(dialog, "button", "Open session"))
        expect(alert_with(page, message)).to_be_visible()
    assert w.pid("carol") not in people_of(w.signin("ann"), sid), "a refused join saves nothing"
    listed = w.signin("carol").get("/api/sessions").json()
    assert [s["id"] for s in listed["sessions"]] == [sid] and listed["total"] == 1, "a refused open leaves no session"


def test_wf_avatar_upload_keyboard_journey(app_url: str, browser: Browser) -> None:
    w = setup_world(app_url, people=[person("ann"), person("ben")])
    data = model(triangles=5001, materials=3, image=png(600, 1))
    with browser_page(browser, w, "ann", "/studio") as page:
        kind = named(page, "combobox", "Kind")
        tab_to(page, kind)
        page.keyboard.press("a")
        expect(named(page, "textbox", "Room layout")).to_have_count(0)
        name_field = named(page, "textbox", "Model name")
        tab_to(page, name_field)
        page.keyboard.type("Copper Fox")
        file_field = page.get_by_label("Model file")
        tab_to(page, file_field)
        with page.expect_file_chooser() as chooser:
            page.keyboard.press("Space")
        chooser.value.set_files({"name": "fox.glb", "mimeType": "model/gltf-binary", "buffer": data})
        tab_to(page, named(page, "button", "Upload model"))
        with held(page, "**/api/assets") as gate:
            page.keyboard.press("Enter")
            expect(named(page, "status", "Upload result")).to_have_text("Checking your file...")
            let_go(gate)
        expect(named(page, "status", "Upload result")).to_have_text("Rank: Linen. Worst measure: triangles.")
        table = named(page, "table", "Measures")
        expect(table.get_by_role("row")).to_have_count(5)
        for index, cells in enumerate((
            ["triangles", "5001", "Linen"], ["materials", "3", "Linen"],
            ["texture size", "600", "Linen"], ["file size", str(len(data)), "Feather"],
        ), start=1):
            expect(table.get_by_role("row").nth(index)).to_have_text(
                re.compile(r"^\s*" + r"\s*".join(re.escape(c) for c in cells) + r"\s*$")
            )

        ann = w.signin("ann")
        assets = ann.get("/api/assets", params={"mine": "true", "kind": "avatar"}).json()
        assert assets["total"] == 1
        asset = assets["assets"][0]["id"]
        assert ann.get(f"/api/assets/{asset}").json()["versions"][0]["status"] == "checked"
        ben = w.signin("ben")
        assert asset not in {a["id"] for a in ben.get("/api/assets").json()["assets"]}

        item = version_item(page, 1)
        expect(item).to_have_attribute("data-version-status", "checked")
        tab_to(page, named(item, "button", "Publish version"))
        page.keyboard.press("Space")
        expect(named(page, "status", "Version result")).to_have_text("Version 1 published.")
        expect(version_item(page, 1)).to_have_attribute("data-version-status", "published")

    detail = ben.get(f"/api/assets/{asset}").json()
    assert detail["currentVersion"] == 1 and detail["rank"] == "Linen" and detail["versions"][0]["status"] == "published"
    assert S3().get(f"assets/{asset}/v1.glb") == data
    assert ben.get(f"/api/assets/{asset}/versions/1/file").content == data


def test_wf_avatar_upload_keyboard_renamed_file(app_url: str, browser: Browser) -> None:
    w = setup_world(app_url, people=[person("ann")])
    with browser_page(browser, w, "ann", "/studio") as page:
        select(named(page, "combobox", "Kind"), "avatar")
        fill(named(page, "textbox", "Model name"), "Copper Fox")
        page.get_by_label("Model file").set_input_files(
            {"name": "fox.glb", "mimeType": "model/gltf-binary", "buffer": png(4, 4)},
        )
        click(named(page, "button", "Upload model"))
        expect(named(page, "status", "Upload result")).to_have_text("This file is not a GLB model.")
        ann = w.signin("ann")
        assert ann.get("/api/assets", params={"mine": "true"}).json()["total"] == 0

        real = model(triangles=10)
        page.get_by_label("Model file").set_input_files(
            {"name": "notes.txt", "mimeType": "text/plain", "buffer": real},
        )
        click(named(page, "button", "Upload model"))
        expect(named(page, "status", "Upload result")).to_have_text("Rank: Feather. Worst measure: triangles.")
    assets = ann.get("/api/assets", params={"mine": "true"}).json()
    assert assets["total"] == 1
    assert S3().get(f"assets/{assets['assets'][0]['id']}/v1.glb") == real


def test_refused_uploads(app_url: str) -> None:
    w = setup_world(app_url, people=[person("ann")])
    ann = w.signin("ann")
    good = model(triangles=10)
    base_doc: dict[str, Any] = {"asset": {"version": "2.0"}}
    header = struct.pack("<4sII", b"glTF", 2, 0)
    broken_js = b"{not json!!!"
    broken = struct.pack("<4sII", b"glTF", 2, 12 + 8 + len(broken_js)) + struct.pack("<I4s", len(broken_js), b"JSON") + broken_js
    binary_only = struct.pack("<I4s", 4, b"BIN\0") + b"\0\0\0\0"
    no_json = struct.pack("<4sII", b"glTF", 2, 12 + len(binary_only)) + binary_only
    bad_length = pack_glb(base_doc)
    bad_length = bad_length[:8] + struct.pack("<I", len(bad_length) + 4) + bad_length[12:]
    bad_image = model(image=b"not an image file")
    uri_buffer = pack_glb({**base_doc, "buffers": [{"uri": "outside.bin", "byteLength": 4}]})
    uri_image = pack_glb({**base_doc, "images": [{"uri": "outside.png"}]})
    uri_and_damaged = pack_glb({**base_doc, "buffers": [{"uri": "outside.bin", "byteLength": 4}]}, version=1)
    not_glb = "This file is not a GLB model."
    damaged = "This GLB file is damaged."
    outside = "This GLB refers to files outside itself."
    assert header
    for data, message in (
        (png(4, 4), not_glb),
        (b"GLB but not really", not_glb),
        (pack_glb(base_doc, version=1), damaged),
        (bad_length, damaged),
        (broken, damaged),
        (no_json, damaged),
        (bad_image, damaged),
        (uri_buffer, outside),
        (uri_image, outside),
        (uri_and_damaged, damaged),
    ):
        err(upload(ann, "avatar", "Refused", data), 422, message)

    err(upload(ann, "scenery", "Refused", good), 422, "Choose room or avatar.")
    err(upload(ann, "avatar", "", good), 422, "Give the model a name of 1 to 80 characters.")
    err(upload(ann, "avatar", "x" * 81, good), 422, "Give the model a name of 1 to 80 characters.")
    err(upload(ann, "avatar", "No file", None), 422, "Choose a file to upload.")
    err(upload(ann, "scenery", "", None), 422, "Choose room or avatar.")
    layout_text = "This room layout is not valid."
    for bad_layout in (
        "not json",
        {**LOFT, "width": 3},
        {**LOFT, "height": 41},
        {**LOFT, "spawn": []},
        {**LOFT, "walls": [{"x": 12, "y": 0}]},
        {**LOFT, "walls": [{"x": 1, "y": 1}]},
        {**LOFT, "seats": [{"id": "s", "x": 5, "y": 2}, {"id": "s", "x": 6, "y": 2}]},
    ):
        err(upload(ann, "room", "Bad layout", good, room_layout=bad_layout), 422, layout_text)
    err(upload(ann, "room", "Bad layout", png(4, 4), room_layout="not json"), 422, layout_text)
    assert ann.get("/api/assets", params={"mine": "true"}).json()["total"] == 0

    sneaky = upload(ann, "avatar", "Sneaky", good, filename="../../escape.glb", mime="text/plain")
    assert sneaky.status_code == 201
    asset = sneaky.json()["assetId"]
    assert S3().keys(f"assets/{asset}/") == [f"assets/{asset}/v1.glb"]
    assert not S3().keys("escape")


def test_rank_measures(app_url: str) -> None:
    w = setup_world(app_url, people=[person("ann")])
    ann = w.signin("ann")

    def measures(data: bytes) -> dict:
        r = upload(ann, "avatar", f"Measure {tag()}", data)
        assert r.status_code == 201, r.text
        assert len(data) == r.json()["measures"]["fileSize"]
        return r.json()

    assert measures(primitive_glb([{"indices": 30}], [0, 0]))["measures"]["triangles"] == 20, "two nodes count twice"
    assert measures(primitive_glb([{"indices": 30}], [], 0))["measures"]["triangles"] == 0, "an unreferenced mesh is 0"
    assert measures(primitive_glb([{"positions": 30}], [0]))["measures"]["triangles"] == 10, "position count over 3"
    assert measures(primitive_glb([{"indices": 30, "mode": 5}], [0]))["measures"]["triangles"] == 28, "strip minus 2"
    assert measures(primitive_glb([{"indices": 30, "mode": 6}], [0]))["measures"]["triangles"] == 28, "fan minus 2"
    assert measures(primitive_glb([{"indices": 30, "mode": 0}], [0]))["measures"]["triangles"] == 0, "points are 0"
    assert measures(primitive_glb([{"indices": 30, "mode": 1}], [0]))["measures"]["triangles"] == 0, "lines are 0"
    assert measures(model(materials=5))["measures"]["materials"] == 5
    assert measures(model())["measures"]["textureSize"] == 0
    assert measures(model(image=png(300, 1)))["measures"]["textureSize"] == 300
    assert measures(model(image=png(1, 400)))["measures"]["textureSize"] == 400
    assert measures(model(image=jpeg(512, 90)))["measures"]["textureSize"] == 512

    feather = measures(model(triangles=5000, materials=2, image=png(512, 1), size=900000))
    assert (feather["rank"], feather["worstMeasure"]) == ("Feather", "triangles")
    linen = measures(model(triangles=5001, materials=2, image=png(512, 1), size=900000))
    assert (linen["rank"], linen["worstMeasure"]) == ("Linen", "triangles")
    cedar = measures(model(triangles=100, materials=5))
    assert (cedar["rank"], cedar["worstMeasure"]) == ("Cedar", "materials")
    assert set(cedar["measures"]) == {"triangles", "materials", "textureSize", "fileSize"}

    stored = ann.get(f"/api/assets/{cedar['assetId']}").json()
    row = stored["versions"][0]
    assert (row["rank"], row["worstMeasure"]) == ("Cedar", "materials") and row["measures"] == cedar["measures"]


RANK_ROWS = {
    "avatar-feather": ["avatar", "Feather", "Linen", 5000, 2, 512, 1000000],
    "avatar-linen": ["avatar", "Linen", "Cedar", 15000, 4, 1024, 4000000],
    "avatar-cedar": ["avatar", "Cedar", "Granite", 40000, 8, 2048, 10000000],
    "avatar-granite": ["avatar", "Granite", None, 100000, 16, 4096, 20000000],
    "room-feather": ["room", "Feather", "Linen", 20000, 8, 1024, 4000000],
    "room-linen": ["room", "Linen", "Cedar", 60000, 16, 2048, 12000000],
    "room-cedar": ["room", "Cedar", "Granite", 150000, 32, 4096, 30000000],
    "room-granite": ["room", "Granite", None, 400000, 64, 8192, 50000000],
}


@pytest.mark.parametrize("row", list(RANK_ROWS), ids=list(RANK_ROWS))
@pytest.mark.timeout(1200)
def test_rank_limits(app_url: str, row: str) -> None:
    kind, rank, heavier, triangles, materials, texture, size = RANK_ROWS[row]
    w = setup_world(app_url, people=[person("ann")])
    ann = w.signin("ann")
    cases = (
        ("triangles", model(triangles=triangles), model(triangles=triangles + 1)),
        ("materials", model(materials=materials), model(materials=materials + 1)),
        ("texture size", model(image=png(texture, 1)), model(image=png(texture + 1, 1))),
        ("file size", model(size=size), model(size=size + 4)),
    )
    for measure, at_limit, above in cases:
        r = upload(ann, kind, f"{row} {tag()}", at_limit)
        assert r.status_code == 201, r.text
        assert r.json()["rank"] == rank, f"{measure} at its limit"
        assert r.json()["worstMeasure"] == ("triangles" if rank == "Feather" else measure)
        over = upload(ann, kind, f"{row} {tag()}", above)
        if heavier:
            assert over.status_code == 201, over.text
            assert (over.json()["rank"], over.json()["worstMeasure"]) == (heavier, measure)
        else:
            status = 413 if measure == "file size" else 422
            err(over, status, f"This model is over the Granite limit for {measure}.")
    tie = upload(ann, kind, f"{row} tie", model(triangles=triangles, materials=materials))
    assert tie.status_code == 201
    assert (tie.json()["rank"], tie.json()["worstMeasure"]) == (rank, "triangles")


def test_stored_byte_for_byte(app_url: str) -> None:
    w = setup_world(app_url, people=[person("ann"), person("ben")])
    other = setup_world(app_url, people=[person("zed")])
    ann, ben, zed = w.signin("ann"), w.signin("ben"), other.signin("zed")
    original = pack_glb({"asset": {"version": "2.0"}, "extras": {"z": 1, "a": "keep this order", "note": "é"}}, b"\x01\x02\x03\x04")
    first = upload(ann, "avatar", "Keepsake", original)
    assert first.status_code == 201, first.text
    asset = first.json()["assetId"]
    store = S3()
    assert store.keys(f"assets/{asset}/") == [f"assets/{asset}/v1.glb"]
    assert store.get(f"assets/{asset}/v1.glb") == original
    read = ann.get(f"/api/assets/{asset}/versions/1/file")
    assert read.status_code == 200 and read.content == original
    assert read.headers["content-type"].startswith("model/gltf-binary")

    not_found(ben.get(f"/api/assets/{asset}/versions/1/file"))
    assert ann.post(f"/api/assets/{asset}/versions/1/publish").json() == {
        "assetId": asset, "version": 1, "status": "published",
    }
    assert ben.get(f"/api/assets/{asset}/versions/1/file").content == original
    not_found(zed.get(f"/api/assets/{asset}/versions/1/file"))

    second_bytes = model(triangles=7)
    second = upload_version(ann, asset, second_bytes)
    assert second.status_code == 201 and second.json()["version"] == 2
    assert store.get(f"assets/{asset}/v2.glb") == second_bytes
    assert store.get(f"assets/{asset}/v1.glb") == original
    err(upload_version(ann, asset, png(4, 4)), 422, "This file is not a GLB model.")
    assert sorted(store.keys(f"assets/{asset}/")) == [f"assets/{asset}/v1.glb", f"assets/{asset}/v2.glb"]
    assert sorted(v["version"] for v in ann.get(f"/api/assets/{asset}").json()["versions"]) == [1, 2]


def expect_measures(table: Locator, rows: list[list[str]]) -> None:
    expect(table.get_by_role("row")).to_have_count(len(rows) + 1)
    for index, cells in enumerate(rows, start=1):
        expect(table.get_by_role("row").nth(index)).to_have_text(
            re.compile(r"^\s*" + r"\s*".join(re.escape(c) for c in cells) + r"\s*$")
        )


def pick_model(page: Page, data: bytes) -> None:
    page.get_by_label("Model file").set_input_files({"name": "fox.glb", "mimeType": "model/gltf-binary", "buffer": data})


def test_wf_avatar_upload_keyboard_refusals(app_url: str, browser: Browser) -> None:
    w = setup_world(app_url, people=[person("ann")])
    with browser_page(browser, w, "ann", "/studio") as page:
        result = named(page, "status", "Upload result")
        upload_button = named(page, "button", "Upload model")
        tab_to(page, named(page, "combobox", "Kind"))
        page.keyboard.press("a")
        tab_to(page, upload_button)
        page.keyboard.press("Enter")
        expect(result).to_have_text("Give the model a name of 1 to 80 characters.")
        tab_to(page, named(page, "textbox", "Model name"))
        page.keyboard.type("Copper Fox")
        tab_to(page, upload_button)
        page.keyboard.press("Enter")
        expect(result).to_have_text("Choose a file to upload.")
        outside = {"asset": {"version": "2.0"}, "buffers": [{"uri": "outside.bin", "byteLength": 4}]}
        for data, message in (
            (b"plain words, not a model", "This file is not a GLB model."),
            (b"glTF" + struct.pack("<I", 2), "This GLB file is damaged."),
            (pack_glb({"asset": {"version": "2.0"}}, version=1), "This GLB file is damaged."),
            (pack_glb(outside), "This GLB refers to files outside itself."),
            (model(materials=17), "This model is over the Granite limit for materials."),
        ):
            pick_model(page, data)
            tab_to(page, upload_button)
            page.keyboard.press("Enter")
            expect(result).to_have_text(message)
    assert w.signin("ann").get("/api/assets", params={"mine": "true"}).json()["total"] == 0


def test_wf_avatar_upload_keyboard_measures(app_url: str, browser: Browser) -> None:
    w = setup_world(app_url, people=[person("ann")])
    cases = (
        (model(triangles=100, materials=5), "Rank: Cedar. Worst measure: materials.",
         [["triangles", "100", "Feather"], ["materials", "5", "Cedar"], ["texture size", "0", "Feather"]]),
        (model(triangles=5001), "Rank: Linen. Worst measure: triangles.",
         [["triangles", "5001", "Linen"], ["materials", "0", "Feather"], ["texture size", "0", "Feather"]]),
        (model(triangles=5000, materials=2, image=png(512, 1)), "Rank: Feather. Worst measure: triangles.",
         [["triangles", "5000", "Feather"], ["materials", "2", "Feather"], ["texture size", "512", "Feather"]]),
    )
    with browser_page(browser, w, "ann", "/studio") as page:
        for data, message, rows in cases:
            page.reload()
            tab_to(page, named(page, "combobox", "Kind"))
            page.keyboard.press("a")
            tab_to(page, named(page, "textbox", "Model name"))
            page.keyboard.type(f"Paper {tag()}")
            pick_model(page, data)
            tab_to(page, named(page, "button", "Upload model"))
            page.keyboard.press("Enter")
            expect(named(page, "status", "Upload result")).to_have_text(message)
            expect_measures(named(page, "table", "Measures"), [*rows, ["file size", str(len(data)), "Feather"]])
    assert w.signin("ann").get("/api/assets", params={"mine": "true"}).json()["total"] == len(cases)


def test_wf_avatar_upload_keyboard_phone_wear(app_url: str, browser: Browser) -> None:
    seeded = "Paper One"
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben")],
        avatars=[{"key": "paper", "name": seeded, "owner": "ann", "rank": "Feather"}],
    )
    ann, ben = w.signin("ann"), w.signin("ben")
    with browser_page(browser, w, "ann", "/studio", viewport=PHONE) as phone, \
            browser_page(browser, w, "ben", "/sessions") as page:
        wear = named(page, "combobox", "Wear avatar")
        expect(wear).to_contain_text(seeded)
        select(named(phone, "combobox", "Kind"), "avatar")
        fill(named(phone, "textbox", "Model name"), "Copper Fox")
        pick_model(phone, model(triangles=100))
        tap(named(phone, "button", "Upload model"))
        expect(named(phone, "status", "Upload result")).to_have_text("Rank: Feather. Worst measure: triangles.")
        no_overflow(phone)
        page.reload()
        expect(wear).to_contain_text(seeded)
        expect(wear).not_to_contain_text("Copper Fox")

        tap(named(version_item(phone, 1), "button", "Publish version"))
        expect(named(phone, "status", "Version result")).to_have_text("Version 1 published.")
        page.reload()
        expect(wear).to_contain_text("Copper Fox")
        select(wear, "Copper Fox")
    asset = next(a["id"] for a in ann.get("/api/assets", params={"mine": "true", "kind": "avatar"}).json()["assets"]
                 if a["id"] != w.ids["avatars"]["paper"])
    wait_for(lambda: ben.get("/api/me").json()["avatarId"] == asset, WAIT_SECONDS, "choosing an avatar should wear it")


def test_wf_room_version_live_publish(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol")],
        rooms=[den_room("ann")],
        sessions=[{
            "key": "s1", "room": "den", "host": "carol", "visibility": "public", "capacity": 5,
            "community": None, "invitees": [],
            "placements": [
                {"person": "carol", "x": 6, "y": 6, "facing": "north"},
                {"person": "ben", "x": 2, "y": 3, "facing": "east"},
            ],
        }],
    )
    sid, ben_id, asset = w.sid(), w.pid("ben"), w.ids["rooms"]["den"]
    ben = w.signin("ben")
    with room_page(browser, w, "ben") as member:
        expect(room(member)).to_have_attribute("data-room-version", "1")
        with browser_page(browser, w, "ann", "/studio") as studio:
            item = version_item(studio, 2)
            expect(item).to_have_attribute("data-version-status", "checked")
            click(named(item, "button", "Publish version"))
            expect(named(studio, "status", "Version result")).to_have_text("Version 2 published.")
            expect(version_item(studio, 2)).to_have_attribute("data-version-status", "published")
        assert w.signin("ann").get(f"/api/assets/{asset}").json()["currentVersion"] == 2
        assert S3().keys(f"assets/{asset}/v2.glb") == [f"assets/{asset}/v2.glb"]

        expect(room(member)).to_have_attribute("data-room-version", "1")
        member.keyboard.press("ArrowRight")
        expect_tile(member, ben_id, 3, 3)
        count = socket_count(member, sid)
        member.reload()
        expect(room(member)).to_be_visible()
        wait_socket(member, sid, after=count)
        expect(room(member)).to_have_attribute("data-room-version", "1")
        expect(room(member)).to_contain_text("Room version 1")
        assert ben.get(f"/api/sessions/{sid}").json()["roomVersion"] == 1

        click(named(member, "button", "Leave session"))
        wait_for(lambda: "people" not in ben.get(f"/api/sessions/{sid}").json(), WAIT_SECONDS, "leaving should end the inside view")
        go(member, f"{app_url}/sessions/{sid}")
        click(named(member, "button", "Join session"))
        expect(room(member)).to_have_attribute("data-room-version", "2")
        expect(room(member)).to_contain_text("Room version 2")
    assert ben.get(f"/api/sessions/{sid}").json()["roomVersion"] == 2
    assert w.signin("carol").get(f"/api/sessions/{sid}").json()["roomVersion"] == 1


def test_walking_your_own_version(app_url: str) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("a1"), person("c1"), person("b2")],
        rooms=[den_room("ann")],
        sessions=[{
            "key": "s1", "room": "den", "host": "a1", "visibility": "public", "capacity": 5, "community": None,
            "invitees": [],
            "placements": [
                {"person": "a1", "x": 2, "y": 3, "facing": "east"},
                {"person": "c1", "x": 3, "y": 2, "facing": "south"},
            ],
        }],
    )
    sid = w.sid()
    a1, c1, b2 = w.signin("a1"), w.signin("c1"), w.signin("b2")
    asset = w.ids["rooms"]["den"]
    assert w.signin("ann").post(f"/api/assets/{asset}/versions/2/publish").status_code == 200
    assert a1.get(f"/api/sessions/{sid}").json()["roomVersion"] == 1
    joined = b2.post(f"/api/sessions/{sid}/join")
    assert joined.status_code == 200 and joined.json()["roomVersion"] == 2
    assert joined.json()["layout"]["walls"] == [{"x": 3, "y": 3}]
    assert a1.get(f"/api/sessions/{sid}").json()["layout"]["walls"] == []

    march(b2, sid, "east", 3)
    march(b2, sid, "south", 2)
    assert press(b2, sid, "west").json()["result"] == "turned"
    err(press(b2, sid, "west"), 409, "A wall blocks that way.")
    moved = press(a1, sid, "east").json()
    assert (moved["result"], moved["x"], moved["y"]) == ("moved", 3, 3)
    err(press(c1, sid, "south"), 409, "Someone is standing there.")
    err(press(b2, sid, "west"), 409, "A wall blocks that way.")
    people = people_of(a1, sid)
    assert (people[w.pid("a1")]["x"], people[w.pid("a1")]["y"]) == (3, 3)
    assert (people[w.pid("b2")]["x"], people[w.pid("b2")]["y"]) == (4, 3)


def test_restore_and_removal(app_url: str) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben", avatar="fox"), person("carol")],
        avatars=[{"key": "fox", "name": "Copper Fox", "owner": "ann", "rank": "Feather"}],
        rooms=[den_room("ann"), loft_room("ann")],
        sessions=[
            {"key": "s1", "room": "den", "host": "carol", "visibility": "public", "capacity": 5, "community": None,
             "invitees": [], "placements": [{"person": "carol", "x": 2, "y": 2, "facing": "north"}]},
            {"key": "s2", "room": "loft", "host": "ben", "visibility": "public", "capacity": 5, "community": None,
             "invitees": [], "placements": [
                 {"person": "ben", "x": 2, "y": 2, "facing": "north"},
                 {"person": "carol", "x": 4, "y": 4, "facing": "north"},
             ]},
        ],
    )
    ann, ben, carol = w.signin("ann"), w.signin("ben"), w.signin("carol")
    asset = w.ids["rooms"]["den"]
    store = S3()
    v1_bytes = store.get(f"assets/{asset}/v1.glb")
    not_found(ben.post(f"/api/assets/{asset}/versions/2/publish"))
    not_found(ben.delete(f"/api/assets/{asset}/versions/2"))
    not_found(ben.post(f"/api/assets/{asset}/versions/1/restore"))

    assert ann.post(f"/api/assets/{asset}/versions/2/publish").json()["status"] == "published"
    err(ann.post(f"/api/assets/{asset}/versions/2/publish"), 409, "This version is already published.")

    restored = ann.post(f"/api/assets/{asset}/versions/1/restore")
    assert restored.status_code == 201, restored.text
    assert restored.json()["version"] == 3 and restored.json()["rank"] == "Feather"
    assert restored.json()["assetId"] == asset and restored.json()["worstMeasure"]
    assert store.get(f"assets/{asset}/v3.glb") == v1_bytes
    detail = ann.get(f"/api/assets/{asset}").json()
    assert detail["currentVersion"] == 3
    v3 = next(v for v in detail["versions"] if v["version"] == 3)
    assert v3["layout"] == DEN_V1 and v3["status"] == "published"

    err(ann.delete(f"/api/assets/{asset}/versions/1"), 409, "This version is in use by an open session.")
    assert store.keys(f"assets/{asset}/v1.glb") == [f"assets/{asset}/v1.glb"]

    assert ann.delete(f"/api/assets/{asset}/versions/2").json() == {"status": "removed"}
    assert not store.keys(f"assets/{asset}/v2.glb")
    not_found(ann.get(f"/api/assets/{asset}/versions/2/file"))
    not_found(ben.get(f"/api/assets/{asset}/versions/2/file"))
    not_found(ann.delete(f"/api/assets/{asset}/versions/2"))
    assert 2 not in [v["version"] for v in ann.get(f"/api/assets/{asset}").json()["versions"]]
    assert 2 not in [v["version"] for v in ben.get(f"/api/assets/{asset}").json()["versions"]]
    next_number = upload_version(ann, asset, model(triangles=3), DEN_V1)
    assert next_number.status_code == 201 and next_number.json()["version"] == 4, "numbers are never reused"

    assert carol.post(f"/api/sessions/{w.sid()}/leave").status_code == 200
    assert ann.delete(f"/api/assets/{asset}/versions/3").json() == {"status": "removed"}
    assert ann.get(f"/api/assets/{asset}").json()["currentVersion"] == 1
    assert ann.delete(f"/api/assets/{asset}/versions/1").json() == {"status": "removed"}
    not_found(ann.get(f"/api/assets/{asset}"))
    not_found(ben.get(f"/api/assets/{asset}"))
    assert not store.keys(f"assets/{asset}/"), "removing the only published version removes every object"
    assert asset not in {a["id"] for a in ann.get("/api/assets").json()["assets"]}

    fox = w.ids["avatars"]["fox"]
    assert people_of(carol, w.sid("s2"))[w.pid("ben")]["avatar"] == "shown"
    assert ann.delete(f"/api/assets/{fox}").json() == {"status": "removed"}
    assert people_of(carol, w.sid("s2"))[w.pid("ben")]["avatar"] == "fallback"


def test_wf_room_version_live_restore_remove(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol")],
        rooms=[den_room("ann")],
        sessions=[{
            "key": "s1", "room": "den", "host": "carol", "visibility": "public", "capacity": 5, "community": None,
            "invitees": [],
            "placements": [
                {"person": "carol", "x": 6, "y": 6, "facing": "north"},
                {"person": "ben", "x": 2, "y": 2, "facing": "north"},
            ],
        }],
    )
    asset, sid = w.ids["rooms"]["den"], w.sid()
    ann, ben = w.signin("ann"), w.signin("ben")
    store = S3()
    assert ann.post(f"/api/assets/{asset}/versions/2/publish").status_code == 200
    with browser_page(browser, w, "ann", "/studio") as page:
        result = named(page, "status", "Version result")
        click(named(version_item(page, 1), "button", "Restore version 1"))
        expect(result).to_have_text("Version 1 restored as version 3.")
        expect(version_item(page, 3)).to_have_attribute("data-version-status", "published")
        click(named(version_item(page, 1), "button", "Remove version 1"))
        expect(result).to_have_text("This version is in use by an open session.")
        expect(version_item(page, 1)).to_have_count(1)
        click(named(version_item(page, 2), "button", "Remove version 2"))
        expect(result).to_have_text("Version 2 removed.")
        expect(version_item(page, 2)).to_have_count(0)
        expect(result).to_have_text("Version 2 removed.")
    assert not store.keys(f"assets/{asset}/v2.glb")
    assert store.get(f"assets/{asset}/v3.glb") == store.get(f"assets/{asset}/v1.glb")
    not_found(ben.get(f"/api/assets/{asset}/versions/2/file"))
    assert 2 not in [v["version"] for v in ben.get(f"/api/assets/{asset}").json()["versions"]]
    assert ben.post(f"/api/sessions/{sid}/leave").status_code == 200
    rejoined = ben.post(f"/api/sessions/{sid}/join")
    assert rejoined.json()["roomVersion"] == 3 and rejoined.json()["layout"] == DEN_V1


def test_wf_room_version_live_own_walls(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol"), person("dan")],
        rooms=[den_room("ann")],
        sessions=[{
            "key": "s1", "room": "den", "host": "carol", "visibility": "public", "capacity": 5, "community": None,
            "invitees": [],
            "placements": [
                {"person": "carol", "x": 4, "y": 3, "facing": "west"},
                {"person": "ben", "x": 3, "y": 4, "facing": "north"},
            ],
        }],
    )
    sid, ben_id, dan_id = w.sid(), w.pid("ben"), w.pid("dan")
    assert w.signin("ann").post(f"/api/assets/{w.ids['rooms']['den']}/versions/2/publish").status_code == 200
    dan, carol = w.signin("dan"), w.signin("carol")
    with room_page(browser, w, "ben") as ben_page, browser_page(browser, w, "dan", f"/sessions/{sid}") as dan_page:
        click(named(dan_page, "button", "Join session"))
        expect(room(dan_page)).to_have_attribute("data-room-version", "2")
        expect(room(ben_page)).to_have_attribute("data-room-version", "1")
        wait_socket(dan_page, sid)
        march(dan, sid, "east", 1)
        march(dan, sid, "south", 2)
        expect_tile(dan_page, dan_id, 2, 3)
        dan_page.keyboard.press("ArrowRight")
        expect_facing(dan_page, dan_id, "east")
        dan_page.keyboard.press("ArrowRight")
        expect(said(dan_page, "A wall blocks that way.")).to_have_count(1)
        expect_tile(dan_page, dan_id, 2, 3)

        ben_page.keyboard.press("ArrowUp")
        expect_tile(ben_page, ben_id, 3, 3)
        expect_tile(dan_page, ben_id, 3, 3)
        err(press(carol, sid, "west"), 409, "Someone is standing there.")
        err(press(dan, sid, "east"), 409, "A wall blocks that way.")


def test_wf_room_version_live_versions_keyboard(app_url: str, browser: Browser) -> None:
    w = setup_world(app_url, people=[person("ann")], rooms=[den_room("ann")])
    asset = w.ids["rooms"]["den"]
    store = S3()
    with browser_page(browser, w, "ann", "/studio") as page:
        result = named(page, "status", "Version result")
        expect(version_item(page, 2)).to_have_attribute("data-version-status", "checked")
        tab_to(page, named(version_item(page, 2), "button", "Publish version"))
        with held(page, f"**/api/assets/{asset}/versions/2/publish") as gate:
            page.keyboard.press("Enter")
            expect(result).to_have_text("Saving...")
            let_go(gate)
        expect(result).to_have_text("Version 2 published.")
        expect(version_item(page, 2)).to_have_attribute("data-version-status", "published")

        tab_to(page, named(version_item(page, 1), "button", "Restore version 1"))
        with held(page, f"**/api/assets/{asset}/versions/1/restore") as gate:
            page.keyboard.press("Enter")
            expect(result).to_have_text("Saving...")
            let_go(gate)
        expect(result).to_have_text("Version 1 restored as version 3.")
        expect(version_item(page, 3)).to_have_attribute("data-version-status", "published")

        tab_to(page, named(version_item(page, 2), "button", "Remove version 2"))
        with held(page, f"**/api/assets/{asset}/versions/2") as gate:
            page.keyboard.press("Enter")
            expect(result).to_have_text("Saving...")
            let_go(gate)
        expect(result).to_have_text("Version 2 removed.")
        expect(version_item(page, 2)).to_have_count(0)
    assert not store.keys(f"assets/{asset}/v2.glb")
    assert store.get(f"assets/{asset}/v3.glb") == store.get(f"assets/{asset}/v1.glb")
    added = upload_version(w.signin("ann"), asset, model(), DEN_V1)
    assert added.status_code == 201 and added.json()["version"] == 4


def test_wf_room_version_live_numbers_never_reused(app_url: str, browser: Browser) -> None:
    w = setup_world(app_url, people=[person("ann")], rooms=[den_room("ann")])
    asset = w.ids["rooms"]["den"]
    with browser_page(browser, w, "ann", "/studio") as page:
        result = named(page, "status", "Version result")
        expect(version_item(page, 2)).to_have_attribute("data-version-status", "checked")
        tab_to(page, named(version_item(page, 2), "button", "Remove version 2"))
        page.keyboard.press("Enter")
        expect(result).to_have_text("Version 2 removed.")
        expect(version_item(page, 2)).to_have_count(0)
        tab_to(page, named(version_item(page, 1), "button", "Restore version 1"))
        page.keyboard.press("Enter")
        expect(result).to_have_text("Version 1 restored as version 3.")
        expect(version_item(page, 3)).to_have_attribute("data-version-status", "published")
        expect(version_item(page, 2)).to_have_count(0)
    versions = w.signin("ann").get(f"/api/assets/{asset}").json()["versions"]
    assert sorted(v["version"] for v in versions) == [1, 3]


def test_wf_room_version_live_rejoin_announced(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol")],
        rooms=[den_room("ann")],
        sessions=[{
            "key": "s1", "room": "den", "host": "carol", "visibility": "public", "capacity": 5, "community": None,
            "invitees": [],
            "placements": [
                {"person": "carol", "x": 6, "y": 6, "facing": "north"},
                {"person": "ben", "x": 2, "y": 3, "facing": "east"},
            ],
        }],
    )
    sid = w.sid()
    ben = w.signin("ben")
    assert w.signin("ann").post(f"/api/assets/{w.ids['rooms']['den']}/versions/2/publish").status_code == 200
    with room_page(browser, w, "carol") as carol_page, room_page(browser, w, "ben") as page:
        expect(room(page)).to_have_attribute("data-room-version", "1")
        tab_to(page, named(page, "button", "Leave session"))
        page.keyboard.press("Enter")
        expect(said(carol_page, "Ben Reed left.")).to_have_count(1)
        wait_for(lambda: "people" not in ben.get(f"/api/sessions/{sid}").json(), WAIT_SECONDS, "leaving should end the inside view")
        go(page, f"{app_url}/sessions/{sid}")
        tab_to(page, named(page, "button", "Join session"))
        page.keyboard.press("Enter")
        expect(room(page)).to_have_attribute("data-room-version", "2")
        expect(room(page)).to_contain_text("Room version 2")
        expect(said(carol_page, "Ben Reed arrived.")).to_have_count(1)
        expect(room(carol_page)).to_have_attribute("data-room-version", "1")
    assert ben.get(f"/api/sessions/{sid}").json()["roomVersion"] == 2


def test_wf_safety_both_ways_block(app_url: str, browser: Browser) -> None:
    w = live_world(
        app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north")}, friendships=[["ann", "ben"]],
    )
    ann_id, ben_id, sid = w.pid("ann"), w.pid("ben"), w.sid()
    ann, ben = w.signin("ann"), w.signin("ben")
    err(ann.post(f"/api/blocks/{ann_id}"), 422, "You cannot do that to yourself.")
    with room_page(browser, w, "ann") as ann_page, room_page(browser, w, "ben") as ben_page:
        ann_page.keyboard.press("m")
        dialog = named(ann_page, "dialog", "Person actions")
        block = named(dialog, "button", "Block")
        tab_to(ann_page, block)
        ann_page.keyboard.press("Enter")
        expect(named(ann_page, "status", "Safety result")).to_have_text("Blocked.")
        close_dialog_if_open(ann_page, "Person actions")

        for page, other in ((ann_page, ben_id), (ben_page, ann_id)):
            expect(entry(page, other)).to_have_attribute("data-avatar", "fallback")
            expect(entry(page, other)).to_have_attribute("data-display-name", "Someone")
        frames_from = len(SOCKETS[ann_page].frames)
        assert press(ben, sid, "south").json()["result"] == "turned"
        expect_facing(ann_page, ben_id, "south")
        assert not [f for f in SOCKETS[ann_page].frames[frames_from:] if "Ben Reed" in f]
        assert people_of(ben, sid)[ann_id]["displayName"] == "Someone"
        assert people_of(ann, sid)[ben_id]["displayName"] == "Someone"

        body = f"blocked {tag()}"
        say(ann_page, body)
        expect(named(ann_page, "status", "Chat result")).to_have_text(heard(0))
        assert chat(ben, sid, f"reply {body}").json()["heardBy"] == 0
        assert body not in chat_texts(ben, sid)
        assert f"reply {body}" not in chat_texts(ann, sid)
        assert ben_id not in {f["personId"] for f in ann.get("/api/friends").json()["friends"]}
        assert ann_id not in {f["personId"] for f in ben.get("/api/friends").json()["friends"]}
        assert ann.post(f"/api/blocks/{ben_id}").json() == {"blocked": True}, "a replay answers the same"

        count = socket_count(ann_page, sid)
        ann_page.reload()
        expect(room(ann_page)).to_be_visible()
        wait_socket(ann_page, sid, after=count)
        expect(entry(ann_page, ben_id)).to_have_attribute("data-display-name", "Someone")

        ann_page.keyboard.press("m")
        unblock = named(named(ann_page, "dialog", "Person actions"), "button", "Unblock")
        tab_to(ann_page, unblock)
        ann_page.keyboard.press("Enter")
        expect(named(ann_page, "status", "Safety result")).to_have_text("Unblocked.")
        close_dialog_if_open(ann_page, "Person actions")
        for page, other, name in ((ann_page, ben_id, "Ben Reed"), (ben_page, ann_id, "Ann Ember")):
            expect(entry(page, other)).to_have_attribute("data-display-name", name)
            expect(entry(page, other)).to_have_attribute("data-avatar", "shown")
        assert chat(ann, sid, f"back {body}").json()["heardBy"] == 1
        assert f"back {body}" in chat_texts(ben, sid)
        assert ben_id in {f["personId"] for f in ann.get("/api/friends").json()["friends"]}

        assert ben.post(f"/api/blocks/{ann_id}").json() == {"blocked": True}
        expect(entry(ann_page, ben_id)).to_have_attribute("data-display-name", "Someone")
        assert ben.post(f"/api/sessions/{sid}/leave").status_code == 200
        expect(said(ann_page, "Someone left.")).to_have_count(1)
        assert ann.delete(f"/api/blocks/{ben_id}").json() == {"blocked": False}
        assert ben.delete(f"/api/blocks/{ann_id}").json() == {"blocked": False}
        assert ben.delete(f"/api/blocks/{ann_id}").json() == {"blocked": False}, "a replay answers the same"


def test_wf_safety_both_ways_mute(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north")})
    ann_id, ben_id, sid = w.pid("ann"), w.pid("ben"), w.sid()
    ann, ben = w.signin("ann"), w.signin("ben")
    err(ben.post(f"/api/mutes/{ben_id}"), 422, "You cannot do that to yourself.")
    with room_page(browser, w, "ben") as ben_page, room_page(browser, w, "ann") as ann_page:
        ben_page.keyboard.press("m")
        mute = named(named(ben_page, "dialog", "Person actions"), "button", "Mute")
        tab_to(ben_page, mute)
        ben_page.keyboard.press("Enter")
        expect(named(ben_page, "status", "Safety result")).to_have_text("Muted.")
        close_dialog_if_open(ben_page, "Person actions")

        hidden_line = f"muted {tag()}"
        say(ann_page, hidden_line)
        expect(named(ann_page, "status", "Chat result")).to_have_text(heard(0))
        expect(named(ann_page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {hidden_line}")
        expect(named(ben_page, "log", "Nearby chat")).not_to_contain_text(hidden_line)
        assert hidden_line not in chat_texts(ben, sid)
        assert not [f for f in SOCKETS[ben_page].frames if hidden_line in f]

        heard_line = f"heard {tag()}"
        say(ben_page, heard_line)
        expect(named(ben_page, "status", "Chat result")).to_have_text(heard(1))
        expect(named(ann_page, "log", "Nearby chat")).to_contain_text(f"Ben Reed: {heard_line}")
        expect(entry(ann_page, ben_id)).to_have_attribute("data-display-name", "Ben Reed")
        expect(entry(ann_page, ben_id)).to_have_attribute("data-avatar", "shown")
        expect(entry(ben_page, ann_id)).to_have_attribute("data-display-name", "Ann Ember")
        assert ben.post(f"/api/mutes/{ann_id}").json() == {"muted": True}

        count = socket_count(ben_page, sid)
        ben_page.reload()
        expect(room(ben_page)).to_be_visible()
        wait_socket(ben_page, sid, after=count)
        assert chat(ann, sid, f"still {hidden_line}").json()["heardBy"] == 0

        ben_page.keyboard.press("m")
        unmute = named(named(ben_page, "dialog", "Person actions"), "button", "Unmute")
        tab_to(ben_page, unmute)
        ben_page.keyboard.press("Enter")
        expect(named(ben_page, "status", "Safety result")).to_have_text("Unmuted.")
    assert chat(ann, sid, f"open {hidden_line}").json()["heardBy"] == 1
    assert f"open {hidden_line}" in chat_texts(ben, sid)
    assert hidden_line not in chat_texts(ben, sid), "unmuting never reveals what was missed"
    assert ben.delete(f"/api/mutes/{ann_id}").json() == {"muted": False}


def test_hide_above_rank(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[
            person("ann", avatar="cedar"), person("ben", avatar="linen"), person("carol", avatar="feather"),
            person("dan"), person("eve", avatar="linen"), person("frank", avatar="granite"),
        ],
        blocks=[{"from": "ann", "to": "eve"}],
        avatars=[
            {"key": "feather", "name": "Paper One", "owner": "ann", "rank": "Feather"},
            {"key": "linen", "name": "Paper Two", "owner": "ann", "rank": "Linen"},
            {"key": "cedar", "name": "Paper Three", "owner": "ann", "rank": "Cedar"},
            {"key": "granite", "name": "Paper Four", "owner": "ann", "rank": "Granite"},
        ],
        rooms=[loft_room("ann")],
        sessions=[{
            "key": "s1", "room": "loft", "host": "ann", "visibility": "public", "capacity": 10, "community": None,
            "invitees": [],
            "placements": [
                {"person": k, "x": i + 1, "y": 7, "facing": "north"}
                for i, k in enumerate(("ann", "ben", "carol", "dan", "eve", "frank"))
            ],
        }],
    )
    ids = {k: w.pid(k) for k in ("ann", "ben", "carol", "dan", "eve", "frank")}
    ben_api = w.signin("ben")
    with room_page(browser, w, "ann") as page:
        expect(entry(page, ids["ben"])).to_have_attribute("data-avatar", "shown")
        select(named(page, "combobox", "Hide avatars above"), "Feather")
        expect(named(page, "status", "Safety result")).to_have_text("Avatars above Feather are hidden.")
        for key, state in (
            ("ben", "hidden"), ("frank", "hidden"), ("carol", "shown"), ("dan", "fallback"), ("eve", "fallback"),
            ("ann", "shown"),
        ):
            expect(entry(page, ids[key])).to_have_attribute("data-avatar", state)
        expect(entry(page, ids["ben"])).to_have_attribute("data-display-name", "Ben Reed")
        expect_tile(page, ids["ben"], 2, 7)
        assert people_of(ben_api, w.sid())[ids["frank"]]["avatar"] == "shown", "the setting is for the viewer only"
        ann = w.signin("ann")
        assert ann.get("/api/me").json()["hideAbove"] == "Feather"

        select(named(page, "combobox", "Hide avatars above"), "Linen")
        expect(named(page, "status", "Safety result")).to_have_text("Avatars above Linen are hidden.")
        expect(entry(page, ids["ben"])).to_have_attribute("data-avatar", "shown")
        expect(entry(page, ids["frank"])).to_have_attribute("data-avatar", "hidden")

        select(named(page, "combobox", "Hide avatars above"), "Show all")
        expect(named(page, "status", "Safety result")).to_have_text("All avatars are shown.")
        expect(entry(page, ids["frank"])).to_have_attribute("data-avatar", "shown")
        assert ann.get("/api/me").json()["hideAbove"] is None
    for rank in ("Cedar", "Granite", "Feather"):
        assert ann.put("/api/me/hide-above", json={"rank": rank}).json() == {"hideAbove": rank}
    assert people_of(ann, w.sid())[ids["ben"]]["avatar"] == "hidden"
    assert ann.put("/api/me/hide-above", json={"rank": None}).json() == {"hideAbove": None}


def test_wf_safety_both_ways_block_announced(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (2, 2, "north"), "ben": (3, 2, "north")}, blocks=[{"from": "ann", "to": "ben"}])
    ann_id, ben_id, sid = w.pid("ann"), w.pid("ben"), w.sid()
    with room_page(browser, w, "ann") as page, room_page(browser, w, "ben", base=second) as ben_page:
        expect(entry(page, ben_id)).to_have_attribute("data-display-name", "Someone")
        expect(entry(ben_page, ann_id)).to_have_attribute("data-display-name", "Someone")
        page.keyboard.press("ArrowRight")
        expect_facing(page, ann_id, "east")
        page.keyboard.press("ArrowRight")
        expect(said(page, "Someone is standing there.")).to_have_count(1)
        expect_tile(page, ann_id, 2, 2)

        tab_to(ben_page, named(ben_page, "button", "Leave session"))
        ben_page.keyboard.press("Enter")
        expect(said(page, "Someone left.")).to_have_count(1)
        expect(entry(page, ben_id)).to_have_count(0)
        go(ben_page, f"{second}/sessions/{sid}")
        tab_to(ben_page, named(ben_page, "button", "Join session"))
        ben_page.keyboard.press("Enter")
        expect(said(page, "Someone arrived.")).to_have_count(1)
        expect(said(page, "Someone is nearby.")).to_have_count(1)
        page.keyboard.press("n")
        expect(said(page, "Nearby: Someone.")).to_have_count(1)
        expect(named(page, "status", "Room announcements")).not_to_contain_text("Ben Reed")
        assert not [f for f in SOCKETS[page].frames if "Ben Reed" in f]


def test_wf_safety_both_ways_friend_list(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north")}, friendships=[["ann", "ben"]])
    ann_id, ben_id = w.pid("ann"), w.pid("ben")
    ann = w.signin("ann")
    with room_page(browser, w, "ann") as page, browser_page(browser, w, "ben", "/friends") as ben_page:
        ben_friends = named(ben_page, "list", "Friends")
        expect(ben_friends.locator(f'[data-person-id="{ann_id}"]')).to_have_count(1)
        page.keyboard.press("m")
        tab_to(page, named(named(page, "dialog", "Person actions"), "button", "Block"))
        page.keyboard.press("Enter")
        expect(named(page, "status", "Safety result")).to_have_text("Blocked.")
        ben_page.reload()
        expect(named(ben_page, "navigation", "Main")).to_be_visible()
        expect(ben_friends.locator(f'[data-person-id="{ann_id}"]')).to_have_count(0)
        expect(named(ben_page, "button", "Remove friend Ann Ember")).to_have_count(0)
        go(page, f"{app_url}/friends")
        expect(named(page, "navigation", "Main")).to_be_visible()
        expect(named(page, "list", "Friends").locator(f'[data-person-id="{ben_id}"]')).to_have_count(0)

        assert ann.delete(f"/api/blocks/{ben_id}").json() == {"blocked": False}
        ben_page.reload()
        expect(ben_friends.locator(f'[data-person-id="{ann_id}"]')).to_have_count(1)
        page.reload()
        expect(named(page, "list", "Friends").locator(f'[data-person-id="{ben_id}"]')).to_have_count(1)


def test_wf_safety_both_ways_hide_keyboard(app_url: str, browser: Browser) -> None:
    w = setup_world(
        app_url,
        people=[
            person("ann", avatar="feather"), person("ben", avatar="linen"), person("carol", avatar="feather"),
            person("frank", avatar="granite"),
        ],
        avatars=[
            {"key": "feather", "name": "Paper One", "owner": "ann", "rank": "Feather"},
            {"key": "linen", "name": "Paper Two", "owner": "ann", "rank": "Linen"},
            {"key": "granite", "name": "Paper Four", "owner": "ann", "rank": "Granite"},
        ],
        rooms=[loft_room("ann")],
        sessions=[{
            "key": "s1", "room": "loft", "host": "ann", "visibility": "public", "capacity": 10, "community": None,
            "invitees": [],
            "placements": [
                {"person": k, "x": i + 1, "y": 7, "facing": "north"}
                for i, k in enumerate(("ann", "ben", "carol", "frank"))
            ],
        }],
    )
    ann_id, ben_id, frank_id, sid = w.pid("ann"), w.pid("ben"), w.pid("frank"), w.sid()
    with room_page(browser, w, "ann") as page, room_page(browser, w, "carol") as carol_page:
        hide = named(page, "combobox", "Hide avatars above")
        tab_to(page, hide)
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("f")
        expect(named(page, "status", "Safety result")).to_have_text("Avatars above Feather are hidden.")
        expect(entry(page, ben_id)).to_have_attribute("data-avatar", "hidden")
        expect(entry(carol_page, ben_id)).to_have_attribute("data-avatar", "shown")
        select(hide, "Linen")
        expect(named(page, "status", "Safety result")).to_have_text("Avatars above Linen are hidden.")
        expect(entry(page, ben_id)).to_have_attribute("data-avatar", "shown")
        expect(entry(page, frank_id)).to_have_attribute("data-avatar", "hidden")
        expect(entry(page, ann_id)).to_have_attribute("data-avatar", "shown")
        expect_tile(page, ann_id, 1, 7)
        expect_facing(page, ann_id, "north")

        count = socket_count(page, sid)
        page.reload()
        expect(room(page)).to_be_visible()
        wait_socket(page, sid, after=count)
        expect(entry(page, frank_id)).to_have_attribute("data-avatar", "hidden")
        assert hide.evaluate("s => s.selectedOptions[0].text").strip() == "Linen"
        expect(entry(carol_page, frank_id)).to_have_attribute("data-avatar", "shown")
    stored = people_of(w.signin("ann"), sid)[ann_id]
    assert (stored["x"], stored["y"], stored["facing"], stored["seated"]) == (1, 7, "north", False)


def test_wf_safety_both_ways_phone_mute(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north")})
    ben_id, sid = w.pid("ben"), w.sid()
    ann = w.signin("ann")
    hidden_line, open_line = f"hidden {tag()}", f"open {tag()}"
    with room_page(browser, w, "ann", viewport=PHONE) as page, room_page(browser, w, "ben") as ben_page:
        tap(named(page, "button", "People and chat"))
        sheet = named(page, "dialog", "People and chat")
        expect(sheet).to_be_visible()
        tap(named(sheet, "button", "Actions for Ben Reed"))
        tap(named(named(page, "dialog", "Person actions"), "button", "Mute"))
        expect(named(page, "status", "Safety result")).to_have_text("Muted.")
        say(ben_page, hidden_line)
        expect(named(ben_page, "status", "Chat result")).to_have_text(heard(0))
        assert not [f for f in SOCKETS[page].frames if hidden_line in f]
        assert hidden_line not in chat_texts(ann, sid)
        expect(entry(page, ben_id)).to_have_attribute("data-display-name", "Ben Reed")
        assert chat(ann, sid, open_line).json()["heardBy"] == 1
        expect(named(ben_page, "log", "Nearby chat")).to_contain_text(f"Ann Ember: {open_line}")


def test_wf_vote_removal_keyboard(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north"), "carol": (9, 9, "north")})
    sid = w.sid()
    ann = w.signin("ann")
    with room_page(browser, w, "ann") as ann_page, room_page(browser, w, "ben") as ben_page, \
            room_page(browser, w, "carol") as carol_page:
        ann_page.keyboard.press("m")
        start = named(named(ann_page, "dialog", "Person actions"), "button", "Start removal vote")
        tab_to(ann_page, start)
        ann_page.keyboard.press("Enter")
        close_dialog_if_open(ann_page, "Person actions")
        panel = named(carol_page, "region", "Removal vote")
        expect(panel).to_have_attribute("data-vote-status", "open")
        expect(panel).to_contain_text("Vote on removing Ben Reed.")
        rows = ann.get(f"/api/sessions/{sid}/votes").json()["votes"]
        assert len(rows) == 1
        assert (rows[0]["targetId"], rows[0]["eligible"], rows[0]["needed"], rows[0]["yes"], rows[0]["no"]) == (
            w.pid("ben"), 2, 2, 1, 0,
        )
        tab_to(carol_page, named(panel, "button", "Vote yes"))
        carol_page.keyboard.press("Enter")
        expect(named(carol_page, "status", "Vote result")).to_have_text("Vote counted.")
        expect(alert_with(ben_page, "The room voted to remove you.")).to_be_visible()
        expect(said(ann_page, "Ben Reed was removed by a vote.")).to_have_count(1)
        expect(entry(ann_page, w.pid("ben"))).to_have_count(0)
    votes = ann.get(f"/api/sessions/{sid}/votes").json()["votes"]
    assert votes[0]["status"] == "passed" and votes[0]["yes"] == 2
    assert w.pid("ben") not in people_of(ann, sid)
    ben = w.signin("ben")
    not_found(ben.post(f"/api/sessions/{sid}/join"))
    not_found(ben.get(f"/api/sessions/{sid}"))
    assert sid not in {s["id"] for s in ben.get("/api/sessions").json()["sessions"]}


def test_vote_refusals(app_url: str) -> None:
    w = live_world(
        app_url,
        {"ann": (1, 7, "north"), "ben": (2, 7, "north"), "carol": (3, 7, "north"), "dan": (4, 7, "north")},
        extra=("eve", "frank"),
    )
    sid = w.sid()
    ann, ben, carol, eve = w.signin("ann"), w.signin("ben"), w.signin("carol"), w.signin("eve")

    def start(c: httpx.Client, target: str) -> httpx.Response:
        return c.post(f"/api/sessions/{sid}/votes", json={"personId": target})

    err(start(ann, w.pid("ann")), 422, "You cannot start a vote about yourself.")
    not_found(start(ann, w.pid("frank")))
    opened = start(ann, w.pid("ben"))
    assert opened.status_code == 201, opened.text
    vote = opened.json()
    assert (vote["eligible"], vote["needed"], vote["yes"], vote["status"]) == (3, 2, 1, "open")
    err(start(carol, w.pid("ben")), 409, "A vote on this person is already open.")

    ballots = f"/api/sessions/{sid}/votes/{vote['id']}/ballots"
    err(ann.post(ballots, json={"choice": "no"}), 409, "You have already voted.")
    err(ben.post(ballots, json={"choice": "yes"}), 409, "You cannot vote on this.")
    assert eve.post(f"/api/sessions/{sid}/join").status_code == 200
    err(eve.post(ballots, json={"choice": "yes"}), 409, "You cannot vote on this.")
    err(carol.post(ballots, json={"choice": "perhaps"}), 422, "Choose yes or no.")
    no = carol.post(ballots, json={"choice": "no"})
    assert no.status_code == 201 and no.json()["no"] == 1 and no.json()["status"] == "open"
    assert ben.post(f"/api/sessions/{sid}/leave").status_code == 200
    assert ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]["status"] == "open", "it stays open if the target leaves"
    other = ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]
    assert other["eligible"] == 3

    pair = live_world(app_url, {"ann": (1, 7, "north"), "ben": (2, 7, "north")})
    err(
        pair.signin("ann").post(f"/api/sessions/{pair.sid()}/votes", json={"personId": pair.pid("ben")}),
        409, "Too few people to vote.",
    )


THRESHOLD_ROWS = {"e2": [2, 2], "e3": [3, 2], "e4": [4, 3], "e5": [5, 3], "e6": [6, 4], "e7": [7, 5], "e10": [10, 6]}


@pytest.mark.parametrize("row", list(THRESHOLD_ROWS), ids=list(THRESHOLD_ROWS))
def test_vote_thresholds(app_url: str, row: str) -> None:
    eligible, needed = THRESHOLD_ROWS[row]
    keys = [f"p{i}" for i in range(eligible + 1)]
    placed = {k: (i + 1, 7, "north") for i, k in enumerate(keys)}
    w = live_world(app_url, placed, capacity=20)
    sid = w.sid()
    target = keys[-1]
    voters = keys[:-1]
    starter = w.signin(voters[0])
    vote = starter.post(f"/api/sessions/{sid}/votes", json={"personId": w.pid(target)})
    assert vote.status_code == 201, vote.text
    body = vote.json()
    assert (body["eligible"], body["needed"], body["yes"], body["status"]) == (eligible, needed, 1, "open")
    for count, key in enumerate(voters[1:needed], start=2):
        cast = w.signin(key).post(f"/api/sessions/{sid}/votes/{body['id']}/ballots", json={"choice": "yes"})
        assert cast.status_code == 201, cast.text
        assert cast.json()["yes"] == count
        assert cast.json()["status"] == ("passed" if count == needed else "open")
    assert w.pid(target) not in people_of(starter, sid)


def test_vote_window(app_url: str) -> None:
    w = live_world(app_url, {"ann": (1, 7, "north"), "ben": (2, 7, "north"), "carol": (3, 7, "north"), "dan": (4, 7, "north")})
    sid = w.sid()
    ann, ben, carol = w.signin("ann"), w.signin("ben"), w.signin("carol")
    w.clock("2027-03-01T12:00:00Z")
    vote = ann.post(f"/api/sessions/{sid}/votes", json={"personId": w.pid("dan")}).json()
    assert parse_instant(vote["closesAt"]) == parse_instant("2027-03-01T12:01:00Z")
    ballots = f"/api/sessions/{sid}/votes/{vote['id']}/ballots"
    w.clock("2027-03-01T12:00:59Z")
    counted = carol.post(ballots, json={"choice": "no"})
    assert counted.status_code == 201 and counted.json()["status"] == "open" and counted.json()["no"] == 1
    w.clock("2027-03-01T12:01:00Z")
    assert ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]["status"] == "failed"
    err(ben.post(ballots, json={"choice": "yes"}), 409, "This vote has closed.")
    assert w.pid("dan") in people_of(ann, sid), "a failed vote removes nobody"


def test_wf_vote_removal_wrong_device_clock(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (1, 7, "north"), "carol": (2, 7, "north"), "dan": (3, 7, "north"), "ben": (4, 7, "north")})
    sid = w.sid()
    ann = w.signin("ann")
    w.clock("2027-03-01T12:00:00Z")
    with room_page(browser, w, "carol", device_time=DEVICE_TIME) as page:
        vote = ann.post(f"/api/sessions/{sid}/votes", json={"personId": w.pid("ben")})
        assert vote.status_code == 201
        panel = named(page, "region", "Removal vote")
        expect(panel).to_have_attribute("data-vote-status", "open")
        click(named(panel, "button", "Vote no"))
        expect(named(page, "status", "Vote result")).to_have_text("Vote counted.")
        w.clock("2027-03-01T12:00:59Z")
        expect(panel).to_have_attribute("data-vote-status", "open")
        w.clock("2027-03-01T12:01:00Z")
        expect(said(page, "The vote did not pass.")).to_have_count(1)
    assert ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]["status"] == "failed"
    assert w.pid("ben") in people_of(ann, sid)


def test_wf_vote_removal_start_refusals(app_url: str, browser: Browser) -> None:
    pair = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north")})
    with room_page(browser, pair, "ann") as page:
        page.keyboard.press("m")
        tab_to(page, named(named(page, "dialog", "Person actions"), "button", "Start removal vote"))
        page.keyboard.press("Enter")
        expect(page.locator("body")).to_contain_text("Too few people to vote.")
    assert pair.signin("ann").get(f"/api/sessions/{pair.sid()}/votes").json()["votes"] == []

    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north"), "carol": (9, 9, "north")})
    carol = w.signin("carol")
    assert carol.post(f"/api/sessions/{w.sid()}/votes", json={"personId": w.pid("ben")}).status_code == 201
    with room_page(browser, w, "ann") as page:
        expect(named(page, "region", "Removal vote")).to_have_attribute("data-vote-status", "open")
        page.keyboard.press("m")
        tab_to(page, named(named(page, "dialog", "Person actions"), "button", "Start removal vote"))
        page.keyboard.press("Enter")
        expect(page.locator("body")).to_contain_text("A vote on this person is already open.")
    assert len(carol.get(f"/api/sessions/{w.sid()}/votes").json()["votes"]) == 1


def test_wf_vote_removal_phone_touch(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north"), "carol": (9, 9, "north")})
    ben_id = w.pid("ben")
    with room_page(browser, w, "ann", viewport=PHONE) as page, room_page(browser, w, "ben") as ben_page, \
            room_page(browser, w, "carol", viewport=PHONE) as carol_page:
        tap(named(page, "button", "People and chat"))
        sheet = named(page, "dialog", "People and chat")
        expect(sheet).to_be_visible()
        tap(named(sheet, "button", "Actions for Ben Reed"))
        tap(named(named(page, "dialog", "Person actions"), "button", "Start removal vote"))
        panel = named(carol_page, "region", "Removal vote")
        expect(panel).to_have_attribute("data-vote-status", "open")
        expect(panel).to_contain_text("Vote on removing Ben Reed.")
        tap(named(panel, "button", "Vote yes"))
        expect(named(carol_page, "status", "Vote result")).to_have_text("Vote counted.")
        expect(alert_with(ben_page, "The room voted to remove you.")).to_be_visible()
        expect(said(page, "Ben Reed was removed by a vote.")).to_have_count(1)
        expect(said(carol_page, "Ben Reed was removed by a vote.")).to_have_count(1)
        expect(entry(carol_page, ben_id)).to_have_count(0)
        no_overflow(carol_page)


def test_wf_vote_removal_across_instances_rejoin(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = live_world(app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north"), "carol": (9, 9, "north")})
    sid, ben_id = w.sid(), w.pid("ben")
    ann = w.signin("ann")
    w.clock("2027-03-01T12:00:00Z")
    with room_page(browser, w, "ben", device_time=DEVICE_TIME) as ben_page, \
            room_page(browser, w, "carol", base=second, device_time=DEVICE_TIME) as page:
        assert ann.post(f"/api/sessions/{sid}/votes", json={"personId": ben_id}).status_code == 201
        panel = named(page, "region", "Removal vote")
        expect(panel).to_have_attribute("data-vote-status", "open")
        w.clock("2027-03-01T12:00:59Z")
        tab_to(page, named(panel, "button", "Vote yes"))
        page.keyboard.press("Enter")
        expect(named(page, "status", "Vote result")).to_have_text("Vote counted.")
        expect(alert_with(ben_page, "The room voted to remove you.")).to_be_visible()
        expect(entry(page, ben_id)).to_have_count(0)

        go(ben_page, f"{app_url}/sessions/{sid}")
        expect(ben_page.get_by_role("heading", name="This session isn't available.", exact=True)).to_be_visible()
        expect(named(ben_page, "button", "Join session")).to_have_count(0)
        go(ben_page, f"{app_url}/sessions")
        expect(named(ben_page, "navigation", "Main")).to_be_visible()
        expect(named(ben_page, "button", "Join Test Loft")).to_have_count(0)
    assert ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]["status"] == "passed"


def test_wf_vote_removal_late_joiner(app_url: str, browser: Browser) -> None:
    w = live_world(
        app_url, {"ann": (5, 5, "north"), "ben": (6, 5, "north"), "carol": (9, 9, "north"), "dan": (10, 9, "north")},
        extra=("frank",),
    )
    sid = w.sid()
    ann = w.signin("ann")
    with room_page(browser, w, "ann") as page, room_page(browser, w, "carol") as carol_page, \
            room_page(browser, w, "dan") as dan_page, browser_page(browser, w, "frank", f"/sessions/{sid}") as frank_page:
        page.keyboard.press("m")
        tab_to(page, named(named(page, "dialog", "Person actions"), "button", "Start removal vote"))
        page.keyboard.press("Enter")
        panel = named(dan_page, "region", "Removal vote")
        expect(panel).to_have_attribute("data-vote-status", "open")
        vote = ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]
        assert (vote["eligible"], vote["needed"], vote["yes"]) == (3, 2, 1)

        tab_to(frank_page, named(frank_page, "button", "Join session"))
        frank_page.keyboard.press("Enter")
        expect(room(frank_page)).to_be_visible()
        ballots = f"/api/sessions/{sid}/votes/{vote['id']}/ballots"
        err(w.signin("frank").post(ballots, json={"choice": "yes"}), 409, "You cannot vote on this.")
        err(w.signin("ben").post(ballots, json={"choice": "no"}), 409, "You cannot vote on this.")

        tab_to(dan_page, named(panel, "button", "Vote no"))
        dan_page.keyboard.press("Enter")
        expect(named(dan_page, "status", "Vote result")).to_have_text("Vote counted.")
        expect(entry(page, w.pid("ben"))).to_have_count(1)
        carol_panel = named(carol_page, "region", "Removal vote")
        tab_to(carol_page, named(carol_panel, "button", "Vote yes"))
        carol_page.keyboard.press("Enter")
        expect(said(frank_page, "Ben Reed was removed by a vote.")).to_have_count(1)
    final = ann.get(f"/api/sessions/{sid}/votes").json()["votes"][0]
    assert (final["status"], final["eligible"], final["yes"], final["no"]) == ("passed", 3, 2, 1)


def report_world(base: str, **body: Any) -> World:
    return setup_world(
        base,
        people=[person("ann"), person("ben"), person("carol"), person("mod", zone="Asia/Tokyo", role="moderator")],
        rooms=[loft_room("ann")],
        sessions=[{
            "key": "s1", "room": "loft", "host": "carol", "visibility": "public", "capacity": 10, "community": None,
            "invitees": [],
            "placements": [
                {"person": "carol", "x": 10, "y": 10, "facing": "north"},
                {"person": "ann", "x": 5, "y": 5, "facing": "north"},
                {"person": "ben", "x": 6, "y": 5, "facing": "north"},
            ],
        }],
        **body,
    )


OPEN_REPORT = {
    "reports": [{
        "key": "r1", "filer": "ann", "person": "ben", "session": "s1",
        "category": "other", "details": "Invented report.", "state": "open",
    }],
}


def test_wf_report_moderator_file_and_triage(app_url: str, browser: Browser, mail: Any) -> None:
    w = report_world(app_url)
    details = f"Invented details {tag()}"
    with room_page(browser, w, "ann") as page:
        page.keyboard.press("m")
        tab_to(page, named(named(page, "dialog", "Person actions"), "button", "Report"))
        page.keyboard.press("Enter")
        dialog = named(page, "dialog", "Report someone")
        expect(dialog).to_be_visible()
        tab_to(page, named(dialog, "combobox", "Category"))
        page.keyboard.press("h")
        tab_to(page, named(dialog, "textbox", "Details"))
        page.keyboard.type(details)
        tab_to(page, named(dialog, "button", "Send report"))
        page.keyboard.press("Enter")
        expect(named(page, "status", "Report result")).to_have_text("Report sent.")

    moderator = w.signin("mod")
    reports = moderator.get("/api/moderation/reports").json()["reports"]
    row = next(r for r in reports if r["details"] == details)
    assert (row["personId"], row["sessionId"], row["state"]) == (w.pid("ben"), w.sid(), "open")
    assert row["category"].startswith("h")
    with browser_page(browser, w, "mod", "/moderation") as page:
        item = page.locator(f'[data-report-id="{row["id"]}"]')
        expect(item).to_have_attribute("data-report-state", "open")
        expect(item).to_contain_text(details)
        for hidden_button in ("Warn", "Suspend", "Dismiss"):
            expect(named(item, "button", hidden_button)).to_have_count(0)
        expect(page.locator("body")).not_to_contain_text("Ann Ember")
        expect(page.locator("body")).not_to_contain_text(w.email("ann"))
        click(named(item, "button", "Start review"))
        expect(named(page, "status", "Moderation result")).to_have_text("Report moved to reviewing.")
        expect(item).to_have_attribute("data-report-state", "reviewing")
        click(named(item, "button", "Dismiss"))
        expect(named(page, "status", "Moderation result")).to_have_text("Report moved to dismissed.")
    final = next(r for r in moderator.get("/api/moderation/reports").json()["reports"] if r["id"] == row["id"])
    assert final["state"] == "dismissed"
    for message in mail.messages(0, settle=1):
        assert w.email("ann") not in mail_text(message) and details not in mail_text(message)


def test_report_anonymity_and_validation(app_url: str) -> None:
    w = report_world(app_url, blocks=[{"from": "ben", "to": "ann"}], **OPEN_REPORT)
    outsider_world = setup_world(app_url, people=[person("zed", role="moderator")])
    ann, carol, moderator = w.signin("ann"), w.signin("carol"), w.signin("mod")
    sid, ben_id = w.sid(), w.pid("ben")

    def report(c: httpx.Client, **change: Any) -> httpx.Response:
        return c.post("/api/reports", json={
            "personId": ben_id, "sessionId": sid, "category": "harassment", "details": "Invented report.", **change,
        })

    made = report(ann)
    assert made.status_code == 201 and made.json()["state"] == "open" and set(made.json()) == {"id", "state"}
    err(report(ann, category="spam"), 422, "Choose a category.")
    err(report(ann, details=""), 422, "Write 1 to 1000 characters.")
    err(report(ann, details="x" * 1001), 422, "Write 1 to 1000 characters.")
    assert report(ann, details="x" * 1000).status_code == 201
    err(report(ann, personId=w.pid("ann")), 422, "You cannot report yourself.")
    not_found(report(moderator))
    not_found(report(ann, personId=outsider_world.pid("zed")))
    assert carol.post(f"/api/sessions/{sid}/leave").status_code == 200
    assert report(carol, details="left since").status_code == 201, "someone who has been in the session may report"

    listing = moderator.get("/api/moderation/reports")
    keys = {"id", "personId", "personName", "sessionId", "roomName", "category", "details", "state", "action", "createdAt"}
    assert listing.json()["reports"]
    for row in listing.json()["reports"]:
        assert set(row) == keys
    for secret in (w.pid("ann"), w.pid("carol"), "Ann Ember", w.email("ann")):
        assert secret not in listing.text
    assert made.json()["id"] not in outsider_world.signin("zed").get("/api/moderation/reports").text


def test_report_moves(app_url: str) -> None:
    w = report_world(app_url, **OPEN_REPORT)
    moderator, ann = w.signin("mod"), w.signin("ann")
    rid = w.ids["reports"]["r1"]

    def move(c: httpx.Client, **body: Any) -> httpx.Response:
        return c.post(f"/api/moderation/reports/{rid}/move", json=body)

    not_found(ann.get("/api/moderation/reports"))
    not_found(move(ann, state="reviewing"))
    err(client(app_url).get("/api/moderation/reports"), 401, "Sign in first.")
    illegal = "This report cannot move that way."
    err(move(moderator, state="dismissed"), 409, illegal)
    err(move(moderator, state="upheld", action="warn"), 409, illegal)
    moved = move(moderator, state="reviewing")
    assert moved.status_code == 200 and moved.json()["state"] == "reviewing" and moved.json()["id"] == rid
    err(move(moderator, state="reviewing"), 409, illegal)
    err(move(moderator, state="upheld"), 422, "Choose warn or suspend.")
    err(move(moderator, state="upheld", action="ban"), 422, "Choose warn or suspend.")
    err(move(moderator, state="closed"), 422, "Choose a valid state.")
    upheld = move(moderator, state="upheld", action="warn")
    assert upheld.status_code == 200 and upheld.json()["state"] == "upheld" and upheld.json()["action"] == "warn"
    err(move(moderator, state="dismissed"), 409, illegal)
    err(move(moderator, state="reviewing"), 409, illegal)
    not_found(moderator.post(f"/api/moderation/reports/{missing()}/move", json={"state": "reviewing"}))


def test_wf_report_moderator_suspend(app_url: str, browser: Browser) -> None:
    w = report_world(app_url, **OPEN_REPORT)
    sid, ben_id, rid = w.sid(), w.pid("ben"), w.ids["reports"]["r1"]
    ben_api = w.signin("ben")
    assert ben_api.get("/api/me").status_code == 200
    with room_page(browser, w, "ben") as ben_page, room_page(browser, w, "ann") as ann_page, \
            browser_page(browser, w, "mod", "/moderation") as mod_page:
        item = mod_page.locator(f'[data-report-id="{rid}"]')
        click(named(item, "button", "Start review"))
        expect(item).to_have_attribute("data-report-state", "reviewing")
        click(named(item, "button", "Suspend"))
        expect(named(mod_page, "status", "Moderation result")).to_have_text("Report moved to upheld.")
        expect(alert_with(ben_page, "A moderator has removed you from this session.")).to_be_visible()
        expect(said(ann_page, "Ben Reed left.")).to_have_count(1)
        expect(entry(ann_page, ben_id)).to_have_count(0)
    err(ben_api.get("/api/me"), 401, "Sign in first.")
    err(
        client(app_url).post("/api/signin", json={"email": w.email("ben"), "password": PASSWORD}),
        401, "Email or password is wrong.",
    )
    assert ben_id not in people_of(w.signin("ann"), sid)
    row = next(r for r in w.signin("mod").get("/api/moderation/reports").json()["reports"] if r["id"] == rid)
    assert (row["state"], row["action"]) == ("upheld", "suspend")


def test_wf_report_moderator_warn(app_url: str, browser: Browser) -> None:
    w = report_world(app_url, **OPEN_REPORT)
    extra = grading(app_url, "/api/grading/clock", {"worldId": w.id, "now": None})
    assert extra.status_code == 200
    moderator, rid = w.signin("mod"), w.ids["reports"]["r1"]
    path = f"/api/moderation/reports/{rid}/move"
    assert moderator.post(path, json={"state": "reviewing"}).status_code == 200
    warned_text = "A moderator has warned you."
    with room_page(browser, w, "ben") as page:
        with browser_page(browser, w, "mod", "/moderation") as mod_page:
            click(named(mod_page.locator(f'[data-report-id="{rid}"]'), "button", "Warn"))
            expect(named(mod_page, "status", "Moderation result")).to_have_text("Report moved to upheld.")
        expect(alert_with(page, warned_text)).to_be_visible()
        expect(room(page)).to_be_visible()
        page.keyboard.press("ArrowUp")
        expect_tile(page, w.pid("ben"), 6, 4)
    with browser_page(browser, w, "ben", "/friends") as page:
        expect(named(page, "navigation", "Main")).to_be_visible()
        wait_for(lambda: page.evaluate("1") == 1 and any("/ws/me" in u for u in SOCKETS[page].opened), WAIT_SECONDS,
                 "a signed-in page should open /ws/me")
        page.wait_for_load_state("networkidle")
        expect(page.get_by_role("alert").filter(has_text=warned_text)).to_have_count(0)
    ben = w.signin("ben")
    assert ben.get("/api/me").status_code == 200
    assert w.pid("ben") in people_of(ben, w.sid())

    assert ben.post("/api/reports", json={
        "personId": w.pid("ann"), "sessionId": w.sid(), "category": "other", "details": "Invented report.",
    }).status_code == 201
    second = next(r for r in moderator.get("/api/moderation/reports").json()["reports"] if r["personId"] == w.pid("ann"))
    second_path = f"/api/moderation/reports/{second['id']}/move"
    assert moderator.post(second_path, json={"state": "reviewing"}).status_code == 200
    assert moderator.post(second_path, json={"state": "upheld", "action": "warn"}).json()["action"] == "warn"
    with browser_page(browser, w, "ann", "/friends") as page:
        expect(alert_with(page, warned_text)).to_be_visible()
        page.reload()
        expect(named(page, "navigation", "Main")).to_be_visible()
        expect(page.get_by_role("alert").filter(has_text=warned_text)).to_have_count(0)


def test_wf_report_moderator_queue_keyboard(app_url: str, browser: Browser) -> None:
    w = report_world(app_url, **OPEN_REPORT)
    rid = w.ids["reports"]["r1"]
    with browser_page(browser, w, "mod", "/moderation") as page, browser_page(browser, w, "ann", "/moderation") as other:
        expect(other.get_by_role("heading", name="Page not found.", exact=True)).to_be_visible()
        expect(named(other, "table", "Reports")).to_have_count(0)
        expect(named(named(other, "navigation", "Main"), "link", "Moderation")).to_have_count(0)
        expect(named(named(page, "navigation", "Main"), "link", "Moderation")).to_be_visible()

        result = named(page, "status", "Moderation result")
        item = page.locator(f'[data-report-id="{rid}"]')
        tab_to(page, named(item, "button", "Start review"))
        with held(page, f"**/api/moderation/reports/{rid}/move") as gate:
            page.keyboard.press("Enter")
            expect(result).to_have_text("Saving...")
            let_go(gate)
        expect(result).to_have_text("Report moved to reviewing.")
        expect(item).to_have_attribute("data-report-state", "reviewing")
        expect(named(item, "button", "Start review")).to_have_count(0)
        for legal in ("Warn", "Suspend", "Dismiss"):
            expect(named(item, "button", legal)).to_be_visible()
        tab_to(page, named(item, "button", "Dismiss"))
        page.keyboard.press("Enter")
        expect(result).to_have_text("Report moved to dismissed.")
        expect(item).to_have_attribute("data-report-state", "dismissed")
        for gone in ("Start review", "Warn", "Suspend", "Dismiss"):
            expect(named(item, "button", gone)).to_have_count(0)


def test_wf_report_moderator_phone_queue(app_url: str, browser: Browser) -> None:
    w = report_world(app_url, reports=[
        {"key": "r1", "filer": "ann", "person": "ben", "session": "s1",
         "category": "other", "details": "Invented report.", "state": "open"},
        {"key": "r2", "filer": "carol", "person": "ann", "session": "s1",
         "category": "other", "details": "Invented second report.", "state": "open"},
    ])
    rid = w.ids["reports"]["r1"]
    with browser_page(browser, w, "mod", "/moderation", viewport=PHONE) as page:
        expect(named(page, "table", "Reports")).to_be_visible()
        no_overflow(page)
        item = page.locator(f'[data-report-id="{rid}"]')
        tap(named(item, "button", "Start review"))
        expect(named(page, "status", "Moderation result")).to_have_text("Report moved to reviewing.")
        expect(item).to_have_attribute("data-report-state", "reviewing")
        for legal in ("Warn", "Suspend", "Dismiss"):
            expect(named(item, "button", legal)).to_be_visible()
        no_overflow(page)


def test_wf_report_moderator_blocked_reporter(app_url: str, browser: Browser) -> None:
    w = report_world(app_url, blocks=[{"from": "ben", "to": "ann"}])
    details = f"Invented details {tag()}"
    with room_page(browser, w, "ann") as page:
        expect(entry(page, w.pid("ben"))).to_have_attribute("data-display-name", "Someone")
        page.keyboard.press("m")
        tab_to(page, named(named(page, "dialog", "Person actions"), "button", "Report"))
        page.keyboard.press("Enter")
        dialog = named(page, "dialog", "Report someone")
        tab_to(page, named(dialog, "combobox", "Category"))
        page.keyboard.press("i")
        tab_to(page, named(dialog, "textbox", "Details"))
        page.keyboard.type(details)
        tab_to(page, named(dialog, "button", "Send report"))
        page.keyboard.press("Enter")
        expect(named(page, "status", "Report result")).to_have_text("Report sent.")
    row = next(r for r in w.signin("mod").get("/api/moderation/reports").json()["reports"] if r["details"] == details)
    assert row["personId"] == w.pid("ben") and row["category"] == "impersonation"
    assert w.pid("ann") not in json.dumps(row)
    with browser_page(browser, w, "mod", "/moderation") as page:
        item = page.locator(f'[data-report-id="{row["id"]}"]')
        expect(item).to_contain_text(details)
        expect(page.locator("body")).not_to_contain_text("Ann Ember")
        expect(page.locator("body")).not_to_contain_text(w.email("ann"))


def test_wf_report_moderator_suspend_instances(app_url: str, browser: Browser) -> None:
    second = instance("APP_SECOND_URL")
    w = report_world(app_url, **OPEN_REPORT)
    rid = w.ids["reports"]["r1"]
    with room_page(browser, w, "ben", base=second) as ben_page, room_page(browser, w, "ann") as ann_page, \
            browser_page(browser, w, "mod", "/moderation") as page:
        item = page.locator(f'[data-report-id="{rid}"]')
        tab_to(page, named(item, "button", "Start review"))
        page.keyboard.press("Enter")
        expect(item).to_have_attribute("data-report-state", "reviewing")
        tab_to(page, named(item, "button", "Suspend"))
        page.keyboard.press("Enter")
        expect(named(page, "status", "Moderation result")).to_have_text("Report moved to upheld.")
        expect(alert_with(ben_page, "A moderator has removed you from this session.")).to_be_visible()
        expect(said(ann_page, "Ben Reed left.")).to_have_count(1)

        go(ben_page, f"{second}/signin")
        fill(named(ben_page, "textbox", "Email"), w.email("ben"))
        fill(ben_page.get_by_label("Password"), PASSWORD)
        click(named(ben_page, "button", "Sign in"))
        expect(named(ben_page, "status", "Account result")).to_have_text("Email or password is wrong.")


def community_world(base: str) -> World:
    return setup_world(
        base,
        people=[person("ann"), person("ben"), person("carol"), person("dan")],
        communities=[{
            "key": "c", "name": "Stitch Night", "timeZone": "America/New_York",
            "members": [
                {"person": "ann", "role": "owner"}, {"person": "ben", "role": "steward"},
                {"person": "carol", "role": "member"},
            ],
        }],
        rooms=[loft_room("ann")],
        sessions=[{
            "key": "s1", "room": "loft", "host": "ann", "visibility": "community", "capacity": 10, "community": "c",
            "invitees": [],
            "placements": [
                {"person": "ann", "x": 2, "y": 7, "facing": "north"}, {"person": "ben", "x": 4, "y": 7, "facing": "north"},
            ],
        }],
    )


GATHERING_BODY = {
    "title": "Spring Stitch", "startsLocal": "2027-03-07T19:00", "durationMinutes": 90,
    "recurrence": "none", "limit": 20,
}


def test_wf_community_demotion_live(app_url: str, browser: Browser) -> None:
    w = community_world(app_url)
    community = w.ids["communities"]["c"]
    ben = w.signin("ben")
    made = ben.post(f"/api/communities/{community}/gatherings", json=GATHERING_BODY)
    assert made.status_code == 201, made.text
    with room_page(browser, w, "ben") as ben_page, browser_page(browser, w, "ann", f"/communities/{community}") as owner:
        schedule = named(ben_page, "button", "Schedule gathering")
        expect(schedule).to_be_visible()
        schedule.focus()
        select(named(owner, "combobox", "Role for Ben Reed"), "member")
        expect(named(owner, "status", "Community result")).to_have_text("Role changed.")
        expect(schedule).to_have_count(0)
        focused_heading = """() => {
            const active = document.activeElement;
            return !!active && active.matches('h1,h2,h3,h4,h5,h6,[role=heading]');
        }"""
        assert ben_page.evaluate(focused_heading), "focus moves to the main heading when its control disappears"
    not_found(ben.post(f"/api/communities/{community}/gatherings", json=GATHERING_BODY))
    not_found(ben.post("/api/sessions", json={
        "roomId": w.ids["rooms"]["loft"], "visibility": "community", "capacity": 3, "communityId": community,
    }))
    roles = {m["personId"]: m["role"] for m in w.signin("ann").get(f"/api/communities/{community}/members").json()["members"]}
    assert roles[w.pid("ben")] == "member"
    assert w.pid("ben") in people_of(w.signin("ann"), w.sid()), "a demotion does not end the session"


def test_wf_community_demotion_removed_member(app_url: str, browser: Browser) -> None:
    w = community_world(app_url)
    community = w.ids["communities"]["c"]
    with room_page(browser, w, "ben") as ben_page, browser_page(browser, w, "ann", f"/communities/{community}") as owner:
        schedule = named(ben_page, "button", "Schedule gathering")
        expect(schedule).to_be_visible()
        schedule.focus()
        click(named(owner, "button", "Remove Ben Reed"))
        expect(named(owner, "status", "Community result")).to_have_text("Member removed.")
        expect(alert_with(ben_page, "You are no longer in this community.")).to_be_visible()
        expect(schedule).to_have_count(0)
        until(ben_page, """() => {
            const active = document.activeElement;
            return !!active && active.matches('h1,h2,h3,h4,h5,h6,[role=heading]');
        }""")
    ben, ann = w.signin("ben"), w.signin("ann")
    assert w.pid("ben") not in people_of(ann, w.sid())
    not_found(ben.get(f"/api/communities/{community}/members"))
    not_found(ben.get(f"/api/sessions/{w.sid()}"))


def test_role_change_rules(app_url: str) -> None:
    w = community_world(app_url)
    community = w.ids["communities"]["c"]
    ann, ben, carol = w.signin("ann"), w.signin("ben"), w.signin("carol")
    members = f"/api/communities/{community}/members"
    err(ann.put(f"{members}/{w.pid('ann')}", json={"role": "member"}), 409, "A community needs an owner.")
    err(ann.put(f"{members}/{w.pid('ben')}", json={"role": "king"}), 422, "Choose owner, steward or member.")
    not_found(ben.put(f"{members}/{w.pid('carol')}", json={"role": "steward"}))
    not_found(carol.post(members, json={"personId": w.pid("dan")}))
    added = ben.post(members, json={"personId": w.pid("dan")})
    assert added.status_code == 201 and added.json() == {"personId": w.pid("dan"), "role": "member"}
    not_found(ben.delete(f"{members}/{w.pid('ann')}"))
    assert ben.delete(f"{members}/{w.pid('dan')}").json() == {"status": "removed"}
    changed = ann.put(f"{members}/{w.pid('carol')}", json={"role": "steward"})
    assert changed.status_code == 200 and changed.json() == {"personId": w.pid("carol"), "role": "steward"}
    not_found(ben.delete(f"{members}/{w.pid('carol')}"))
    assert ann.delete(f"{members}/{w.pid('carol')}").json() == {"status": "removed"}
    assert ann.post("/api/communities", json={"name": "", "timeZone": "Asia/Tokyo"}).json() == {
        "error": "Give the community a name of 1 to 80 characters.",
    }
    err(ann.post("/api/communities", json={"name": "Quilters", "timeZone": "Mars/Base"}), 422, "Choose a time zone from the list.")
    made = ann.post("/api/communities", json={"name": "Quilters", "timeZone": "Asia/Tokyo"})
    assert made.status_code == 201 and made.json()["role"] == "owner"


MEMBER_KEYS = {
    "member": ["personId", "displayName", "role"],
    "steward": ["personId", "displayName", "role", "joinedAt"],
    "owner": ["personId", "displayName", "role", "joinedAt", "email"],
}


@pytest.mark.parametrize("caller", list(MEMBER_KEYS), ids=list(MEMBER_KEYS))
def test_member_fields_by_role(app_url: str, caller: str) -> None:
    w = community_world(app_url)
    key = {"member": "carol", "steward": "ben", "owner": "ann"}[caller]
    r = w.signin(key).get(f"/api/communities/{w.ids['communities']['c']}/members")
    assert r.status_code == 200
    body = r.json()
    assert body["total"] == 3 and len(body["members"]) == 3
    for row in body["members"]:
        assert set(row) == set(MEMBER_KEYS[caller])
    assert (w.email("carol") in r.text) is (caller == "owner")
    not_found(w.signin("dan").get(f"/api/communities/{w.ids['communities']['c']}/members"))


def test_community_boundary(app_url: str) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("bea"), person("cy")],
        communities=[
            {"key": "a", "name": "First", "timeZone": "America/New_York", "members": [{"person": "ann", "role": "owner"}]},
            {"key": "b", "name": "Second", "timeZone": "America/New_York",
             "members": [{"person": "bea", "role": "owner"}, {"person": "cy", "role": "member"}]},
        ],
        rooms=[loft_room("bea")],
        sessions=[{
            "key": "sb", "room": "loft", "host": "bea", "visibility": "community", "capacity": 4, "community": "b",
            "invitees": [], "placements": [{"person": "bea", "x": 2, "y": 2, "facing": "north"}],
        }],
        gatherings=[{
            "key": "gb", "community": "b", "title": "Second Stitch", "startsLocal": "2027-03-07T19:00",
            "durationMinutes": 90, "recurrence": "weekly", "limit": 20, "attending": [],
        }],
    )
    other = setup_world(app_url, people=[person("zed")])
    ann = w.signin("ann")
    a, b = w.ids["communities"]["a"], w.ids["communities"]["b"]
    gathering = w.ids["gatherings"]["gb"]
    not_found(ann.get(f"/api/communities/{b}/members"))
    not_found(ann.get(f"/api/communities/{b}/gatherings"))
    not_found(ann.get(f"/api/gatherings/{gathering}"))
    not_found(ann.post(f"/api/communities/{b}/members", json={"personId": w.pid("ann")}))
    not_found(ann.post(f"/api/communities/{b}/gatherings", json={"title": ""}))
    not_found(ann.post(f"/api/communities/{a}/gatherings/{gathering}/attend"))
    not_found(ann.delete(f"/api/communities/{a}/gatherings/{gathering}/attend"))
    not_found(ann.put(f"/api/communities/{a}/members/{w.pid('cy')}", json={"role": "steward"}))
    not_found(ann.delete(f"/api/communities/{a}/members/{w.pid('cy')}"))
    not_found(ann.post(f"/api/communities/{a}/members", json={"personId": other.pid("zed")}))
    not_found(ann.post("/api/sessions", json={
        "roomId": w.ids["rooms"]["loft"], "visibility": "community", "capacity": 3, "communityId": b,
    }))
    not_found(ann.get(f"/api/sessions/{w.sid('sb')}"))
    not_found(ann.post(f"/api/sessions/{w.sid('sb')}/join"))
    not_found(other.signin("zed").get(f"/api/communities/{a}/members"))


def test_wf_community_demotion_keyboard_owner(app_url: str, browser: Browser) -> None:
    w = community_world(app_url)
    community, ben_id = w.ids["communities"]["c"], w.pid("ben")
    with room_page(browser, w, "ben") as ben_page, browser_page(browser, w, "ann", f"/communities/{community}") as owner:
        schedule = named(ben_page, "button", "Schedule gathering")
        expect(schedule).to_be_visible()
        tab_to(owner, named(owner, "combobox", "Role for Ben Reed"))
        owner.keyboard.press("m")
        expect(named(owner, "status", "Community result")).to_have_text("Role changed.")
        expect(schedule).to_have_count(0)
        ben_page.keyboard.press("ArrowUp")
        expect_tile(ben_page, ben_id, 4, 6)
    not_found(w.signin("ben").post(f"/api/communities/{community}/gatherings", json=GATHERING_BODY))
    stored = people_of(w.signin("ann"), w.sid())[ben_id]
    assert (stored["x"], stored["y"]) == (4, 6)


def test_wf_community_demotion_steward_view(app_url: str, browser: Browser) -> None:
    w = community_world(app_url)
    community, sid = w.ids["communities"]["c"], w.sid()
    ben, carol = w.signin("ben"), w.signin("carol")
    assert carol.post(f"/api/sessions/{sid}/join").status_code == 200
    members = f"/api/communities/{community}/members"
    assert set(ben.get(members).json()["members"][0]) == {"personId", "displayName", "role", "joinedAt"}
    w.clock("2027-03-01T12:00:00Z")
    with room_page(browser, w, "carol") as carol_page, room_page(browser, w, "ben") as room_view, \
            browser_page(browser, w, "ben", f"/communities/{community}") as page:
        tab_to(room_view, named(room_view, "button", "Schedule gathering"))
        room_view.keyboard.press("Enter")
        dialog = named(room_view, "dialog", "Schedule gathering")
        expect(dialog).to_be_visible()
        tab_to(room_view, named(dialog, "textbox", "Title"))
        room_view.keyboard.type("Spring Stitch")
        tab_to(room_view, named(dialog, "textbox", "Starts"))
        room_view.keyboard.type("2027-03-07T19:00")
        tab_to(room_view, named(dialog, "spinbutton", "Duration in minutes"))
        room_view.keyboard.type("90")
        tab_to(room_view, named(dialog, "combobox", "Repeats"))
        room_view.keyboard.press("n")
        tab_to(room_view, named(dialog, "spinbutton", "Limit"))
        room_view.keyboard.type("20")
        tab_to(room_view, named(dialog, "button", "Save gathering"))
        room_view.keyboard.press("Enter")
        expect(named(room_view, "status", "Gathering result")).to_have_text("Gathering scheduled.")
        titles = [g["title"] for g in ben.get(f"/api/communities/{community}/gatherings").json()["gatherings"]]
        assert "Spring Stitch" in titles

        remove = named(page, "button", "Remove Carol Moss")
        tab_to(page, remove)
        page.keyboard.press("Enter")
        expect(named(page, "status", "Community result")).to_have_text("Member removed.")
        expect(alert_with(carol_page, "You are no longer in this community.")).to_be_visible()
        expect(remove).to_have_count(0)

        assert w.signin("ann").put(f"{members}/{w.pid('ben')}", json={"role": "member"}).status_code == 200
        page.reload()
        expect(named(page, "table", "Members")).to_be_visible()
        expect(named(page, "button", "Schedule gathering")).to_have_count(0)
    assert set(ben.get(members).json()["members"][0]) == {"personId", "displayName", "role"}
    assert w.pid("carol") not in people_of(ben, sid)


def test_wf_community_demotion_boundary_pages(app_url: str, browser: Browser) -> None:
    other_name = "Quilt Club"
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("dan")],
        communities=[
            {"key": "c", "name": "Stitch Night", "timeZone": "America/New_York",
             "members": [{"person": "ann", "role": "owner"}, {"person": "ben", "role": "member"}]},
            {"key": "o", "name": other_name, "timeZone": "America/New_York", "members": [{"person": "dan", "role": "owner"}]},
        ],
        rooms=[loft_room("ann"), loft_room("dan", key="club", name="Test Den")],
        sessions=[{
            "key": "s1", "room": "club", "host": "dan", "visibility": "community", "capacity": 5, "community": "o",
            "invitees": [], "placements": [{"person": "dan", "x": 2, "y": 2, "facing": "north"}],
        }],
    )
    other = w.ids["communities"]["o"]
    ann = w.signin("ann")
    with browser_page(browser, w, "ann", "/sessions") as page, browser_page(browser, w, "dan", "/communities") as dan_page:
        expect(dan_page.locator("body")).to_contain_text(other_name)
        opener = named(page, "button", "Open a session")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        dialog = named(page, "dialog", "Open a session")
        expect(dialog).to_be_visible()
        tab_to(page, named(dialog, "combobox", "Visibility"))
        page.keyboard.press("c")
        community = named(dialog, "combobox", "Community")
        expect(community).to_contain_text("Stitch Night")
        expect(community).not_to_contain_text(other_name)
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()

        go(page, f"{app_url}/communities")
        expect(page.locator("body")).to_contain_text("Stitch Night")
        expect(page.locator("body")).not_to_contain_text(other_name)
        go(page, f"{app_url}/sessions/{w.sid()}")
        expect(page.get_by_role("heading", name="This session isn't available.", exact=True)).to_be_visible()
    not_found(ann.get(f"/api/communities/{other}/members"))
    not_found(ann.post(f"/api/communities/{other}/gatherings", json=GATHERING_BODY))
    not_found(ann.post("/api/sessions", json={
        "roomId": w.ids["rooms"]["loft"], "visibility": "community", "capacity": 3, "communityId": other,
    }))


def test_wf_community_demotion_phone(app_url: str, browser: Browser) -> None:
    w = community_world(app_url)
    community, ben_id = w.ids["communities"]["c"], w.pid("ben")
    with room_page(browser, w, "ben", viewport=PHONE) as phone, \
            browser_page(browser, w, "ann", f"/communities/{community}") as owner:
        schedule = named(phone, "button", "Schedule gathering")
        expect(schedule).to_be_visible()
        select(named(owner, "combobox", "Role for Ben Reed"), "member")
        expect(named(owner, "status", "Community result")).to_have_text("Role changed.")
        expect(schedule).to_have_count(0)
        tap(named(phone, "button", "Step north"))
        expect_tile(phone, ben_id, 4, 6)
        no_overflow(phone)
    assert w.pid("ben") in people_of(w.signin("ann"), w.sid())


ZONE_DISPLAYS = {
    "America/New_York": ["Sun 10 Jan 2027, 7:00 AM EST", "Sun 11 Jul 2027, 7:00 AM EDT"],
    "America/Los_Angeles": ["Sun 10 Jan 2027, 4:00 AM PST", "Sun 11 Jul 2027, 4:00 AM PDT"],
    "Europe/London": ["Sun 10 Jan 2027, 12:00 PM GMT", "Sun 11 Jul 2027, 12:00 PM BST"],
    "Europe/Berlin": ["Sun 10 Jan 2027, 1:00 PM CET", "Sun 11 Jul 2027, 1:00 PM CEST"],
    "Asia/Kolkata": ["Sun 10 Jan 2027, 5:30 PM IST", "Sun 11 Jul 2027, 4:30 PM IST"],
    "Asia/Tokyo": ["Sun 10 Jan 2027, 9:00 PM JST", "Sun 11 Jul 2027, 8:00 PM JST"],
    "Australia/Sydney": ["Sun 10 Jan 2027, 11:00 PM AEDT", "Sun 11 Jul 2027, 9:00 PM AEST"],
}


def zone_world(base: str, community_zone: str = "America/New_York", **body: Any) -> World:
    return setup_world(
        base,
        people=[
            person("ann"), person("ben", zone="Europe/London"), person("carol"),
        ],
        communities=[{
            "key": "c", "name": "Stitch Night", "timeZone": community_zone,
            "members": [
                {"person": "ann", "role": "owner"}, {"person": "ben", "role": "member"},
                {"person": "carol", "role": "member"},
            ],
        }],
        **body,
    )


def test_wf_gathering_time_zones_display(app_url: str, browser: Browser) -> None:
    w = zone_world(app_url)
    community = w.ids["communities"]["c"]
    w.clock("2027-03-01T12:00:00Z")
    ann, ben = w.signin("ann"), w.signin("ben")
    with browser_page(browser, w, "ann", f"/communities/{community}") as page:
        opener = named(page, "button", "Schedule gathering")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = named(page, "dialog", "Schedule gathering")
        expect(dialog).to_be_visible()
        tab_stays_inside(page, dialog)
        fill(named(dialog, "textbox", "Title"), "Spring Stitch")
        fill(named(dialog, "textbox", "Starts"), "2027-03-07T19:00")
        fill(named(dialog, "spinbutton", "Duration in minutes"), "90")
        select(named(dialog, "combobox", "Repeats"), "weekly")
        fill(named(dialog, "spinbutton", "Limit"), "20")
        click(named(dialog, "button", "Save gathering"))
        expect(named(page, "status", "Gathering result")).to_have_text("Gathering scheduled.")
        rows = ann.get(f"/api/communities/{community}/gatherings").json()
        assert rows["total"] == 1
        gid = rows["gatherings"][0]["id"]
        expect(named(page, "list", "Gatherings").locator(f'[data-gathering-id="{gid}"]')).to_have_attribute(
            "data-status", "upcoming",
        )
        go(page, f"{app_url}/gatherings/{gid}")
        items = named(page, "list", "Occurrences").get_by_role("listitem")
        expect(items.nth(0)).to_contain_text("Sun 7 Mar 2027, 7:00 PM EST")
        expect(items.nth(1)).to_contain_text("Sun 14 Mar 2027, 7:00 PM EDT")
        expect(items.nth(3)).to_contain_text("Sun 28 Mar 2027, 7:00 PM EDT")
    with browser_page(browser, w, "ben", f"/gatherings/{gid}") as page:
        items = named(page, "list", "Occurrences").get_by_role("listitem")
        expect(items.nth(0)).to_contain_text("Mon 8 Mar 2027, 12:00 AM GMT")
        expect(items.nth(1)).to_contain_text("Sun 14 Mar 2027, 11:00 PM GMT")
        expect(items.nth(3)).to_contain_text("Mon 29 Mar 2027, 12:00 AM BST")
        expect(items.nth(0)).to_have_attribute("data-status", "upcoming")
        click(named(page, "button", "Attend"))
        expect(named(page, "status", "Gathering result")).to_have_text("You're attending.")
        click(named(page, "button", "Stop attending"))
        expect(named(page, "status", "Gathering result")).to_have_text("You're no longer attending.")
        click(named(page, "button", "Attend"))
        expect(named(page, "status", "Gathering result")).to_have_text("You're attending.")
    stored = ben.get(f"/api/gatherings/{gid}").json()
    assert stored["attending"] is True and stored["attendingCount"] == 1
    assert stored["display"] == "Mon 8 Mar 2027, 12:00 AM GMT"
    first = stored["occurrences"][0]
    assert parse_instant(first["startsAt"]) == parse_instant("2027-03-08T00:00:00Z")
    assert first["startsLocal"].startswith("2027-03-07T19:00")
    assert ann.get(f"/api/gatherings/{gid}").json()["display"] == "Sun 7 Mar 2027, 7:00 PM EST"


def test_every_zone_prints_its_abbreviation(app_url: str) -> None:
    zones = list(ZONE_DISPLAYS)
    keys = [f"z{i}" for i in range(len(zones))]
    w = setup_world(
        app_url,
        people=[person("owner", zone="Europe/London")] + [person(k, zone=z) for k, z in zip(keys, zones)],
        communities=[{
            "key": "c", "name": "Stitch Night", "timeZone": "Europe/London",
            "members": [{"person": "owner", "role": "owner"}] + [{"person": k, "role": "member"} for k in keys],
        }],
        gatherings=[
            {"key": "winter", "community": "c", "title": "Winter", "startsLocal": "2027-01-10T12:00",
             "durationMinutes": 60, "recurrence": "none", "limit": 20, "attending": []},
            {"key": "summer", "community": "c", "title": "Summer", "startsLocal": "2027-07-11T12:00",
             "durationMinutes": 60, "recurrence": "none", "limit": 20, "attending": []},
        ],
    )
    w.clock("2027-01-01T12:00:00Z")
    for key, zone in zip(keys, zones):
        reader = w.signin(key)
        winter, summer = ZONE_DISPLAYS[zone]
        assert reader.get(f"/api/gatherings/{w.ids['gatherings']['winter']}").json()["display"] == winter
        assert reader.get(f"/api/gatherings/{w.ids['gatherings']['summer']}").json()["display"] == summer


def test_daylight_saving_rules(app_url: str, browser: Browser) -> None:
    def gathering(key: str, starts: str, recurrence: str = "none") -> dict:
        return {
            "key": key, "community": "c", "title": key, "startsLocal": starts, "durationMinutes": 30,
            "recurrence": recurrence, "limit": 20, "attending": [],
        }

    w = zone_world(app_url, gatherings=[
        gathering("missing", "2027-03-14T02:30"), gathering("repeated", "2027-11-07T01:30"),
        gathering("weekly", "2027-03-07T02:30", "weekly"), gathering("evening", "2027-03-07T19:00", "weekly"),
    ])
    w.clock("2027-03-01T12:00:00Z")
    ann, ben = w.signin("ann"), w.signin("ben")
    moved_note = "This time doesn't exist that day, so it moves forward."
    twice_note = "This time happens twice that day. This is the first."
    ids = w.ids["gatherings"]

    missing = ann.get(f"/api/gatherings/{ids['missing']}").json()["occurrences"]
    assert len(missing) == 1
    assert parse_instant(missing[0]["startsAt"]) == parse_instant("2027-03-14T07:30:00Z")
    assert missing[0]["display"].endswith("EDT") and missing[0]["note"] == moved_note
    assert ben.get(f"/api/gatherings/{ids['missing']}").json()["occurrences"][0]["note"] == moved_note

    repeated = ann.get(f"/api/gatherings/{ids['repeated']}").json()["occurrences"][0]
    assert parse_instant(repeated["startsAt"]) == parse_instant("2027-11-07T05:30:00Z")
    assert repeated["display"].endswith("EDT") and repeated["note"] == twice_note

    weekly = ann.get(f"/api/gatherings/{ids['weekly']}").json()["occurrences"]
    assert len(weekly) == 8
    assert weekly[0]["note"] is None and weekly[0]["display"].endswith("EST")
    assert parse_instant(weekly[0]["startsAt"]) == parse_instant("2027-03-07T07:30:00Z")
    assert weekly[1]["note"] == moved_note and weekly[1]["display"].endswith("EDT")
    assert parse_instant(weekly[1]["startsAt"]) == parse_instant("2027-03-14T07:30:00Z")
    assert weekly[2]["note"] is None and weekly[2]["display"].endswith("EDT")
    assert parse_instant(weekly[2]["startsAt"]) == parse_instant("2027-03-21T06:30:00Z")

    evening = ben.get(f"/api/gatherings/{ids['evening']}").json()["occurrences"]
    assert evening[0]["display"] == "Mon 8 Mar 2027, 12:00 AM GMT"
    assert evening[1]["display"] == "Sun 14 Mar 2027, 11:00 PM GMT"
    assert evening[3]["display"] == "Mon 29 Mar 2027, 12:00 AM BST"
    assert all(o["startsLocal"][11:16] == "19:00" for o in evening)

    with browser_page(browser, w, "ben", f"/gatherings/{ids['missing']}") as page:
        expect(named(page, "list", "Occurrences").get_by_role("listitem").first).to_contain_text(moved_note)
        go(page, f"{app_url}/gatherings/{ids['repeated']}")
        expect(named(page, "list", "Occurrences").get_by_role("listitem").first).to_contain_text(twice_note)

    w.clock("2027-10-20T12:00:00Z")
    autumn = ann.get(f"/api/gatherings/{ids['evening']}").json()["occurrences"]
    instants = {parse_instant(o["startsAt"]) for o in autumn}
    assert parse_instant("2027-10-31T23:00:00Z") in instants
    assert parse_instant("2027-11-08T00:00:00Z") in instants


def test_gathering_status_and_limit(app_url: str) -> None:
    def gathering(key: str, starts: str, minutes: int, recurrence: str = "none", limit: int = 5) -> dict:
        return {
            "key": key, "community": "c", "title": key, "startsLocal": starts, "durationMinutes": minutes,
            "recurrence": recurrence, "limit": limit, "attending": [],
        }

    w = zone_world(app_url, gatherings=[
        gathering("once", "2027-06-06T19:00", 90), gathering("gap", "2027-03-14T01:30", 60),
        gathering("weekly", "2027-06-06T19:00", 90, "weekly"), gathering("tight", "2027-09-05T19:00", 90, limit=1),
    ])
    ann, ben, carol = w.signin("ann"), w.signin("ben"), w.signin("carol")
    ids, community = w.ids["gatherings"], w.ids["communities"]["c"]

    def status(key: str) -> str:
        return ann.get(f"/api/gatherings/{ids[key]}").json()["status"]

    for now, wanted in (
        ("2027-06-06T22:44:59Z", "upcoming"), ("2027-06-06T22:45:00Z", "open"),
        ("2027-06-07T00:29:59Z", "open"), ("2027-06-07T00:30:00Z", "ended"),
    ):
        w.clock(now)
        assert status("once") == wanted, now
    err(ann.post(f"/api/communities/{community}/gatherings/{ids['once']}/attend"), 409, "This gathering has ended.")
    weekly = ann.get(f"/api/gatherings/{ids['weekly']}").json()
    assert weekly["status"] == "upcoming" and weekly["occurrences"][0]["startsLocal"].startswith("2027-06-13")
    once = ann.get(f"/api/gatherings/{ids['once']}").json()
    assert len(once["occurrences"]) == 1 and once["occurrences"][0]["status"] == "ended"

    w.clock("2027-03-14T07:29:59Z")
    assert status("gap") == "open"
    w.clock("2027-03-14T07:30:00Z")
    assert status("gap") == "ended", "the end is the start plus duration in elapsed time"

    w.clock("2027-08-01T12:00:00Z")
    attend = f"/api/communities/{community}/gatherings/{ids['tight']}/attend"
    answers = together([lambda c=c: c.post(attend) for c in (ann, ben, carol)])
    wins = [r for r in answers if r.status_code == 200]
    assert len(wins) == 1, [r.text for r in answers]
    assert wins[0].json() == {"attending": True, "count": 1}
    for r in answers:
        if r.status_code != 200:
            err(r, 409, "This gathering is full.")
    winner = next(c for c, r in zip((ann, ben, carol), answers) if r.status_code == 200)
    assert winner.post(attend).json() == {"attending": True, "count": 1}, "a replay answers the same"
    assert winner.delete(attend).json() == {"attending": False, "count": 0}

    create = f"/api/communities/{community}/gatherings"
    good = {"title": "Stitch", "startsLocal": "2027-09-05T19:00", "durationMinutes": 60, "recurrence": "none", "limit": 5}
    for change, message in (
        ({"title": ""}, "Give the gathering a title of 1 to 120 characters."),
        ({"title": "x" * 121}, "Give the gathering a title of 1 to 120 characters."),
        ({"startsLocal": "soon"}, "Enter the start as a local date and time."),
        ({"durationMinutes": 14}, "Duration must be 15 to 480 minutes."),
        ({"durationMinutes": 481}, "Duration must be 15 to 480 minutes."),
        ({"recurrence": "daily"}, "Choose none or weekly."),
        ({"limit": 0}, "Limit must be 1 to 500."),
        ({"limit": 501}, "Limit must be 1 to 500."),
    ):
        err(ann.post(create, json={**good, **change}), 422, message)
    assert ann.post(create, json={**good, "durationMinutes": 15, "limit": 500}).status_code == 201


def test_wf_gathering_time_zones_device_clock(app_url: str, browser: Browser) -> None:
    w = zone_world(app_url, gatherings=[{
        "key": "once", "community": "c", "title": "Spring Stitch", "startsLocal": "2027-06-06T19:00",
        "durationMinutes": 90, "recurrence": "none", "limit": 20, "attending": [],
    }])
    gid = w.ids["gatherings"]["once"]
    community = w.ids["communities"]["c"]
    ann = w.signin("ann")
    for now, wanted in (
        ("2027-06-06T12:00:00Z", "upcoming"), ("2027-06-06T23:00:00Z", "open"), ("2027-06-07T00:30:00Z", "ended"),
    ):
        w.clock(now)
        assert ann.get(f"/api/gatherings/{gid}").json()["status"] == wanted
        with browser_page(browser, w, "ben", f"/gatherings/{gid}", device_time=DEVICE_TIME) as page:
            item = named(page, "list", "Occurrences").get_by_role("listitem").first
            expect(item).to_have_attribute("data-status", wanted)
            expect(item).to_contain_text(wanted)
            if wanted == "upcoming":
                tab_to(page, named(page, "button", "Attend"))
                page.keyboard.press("Enter")
                expect(named(page, "status", "Gathering result")).to_have_text("You're attending.")
            go(page, f"{app_url}/communities/{community}")
            row = named(page, "list", "Gatherings").locator(f'[data-gathering-id="{gid}"]')
            expect(row).to_have_attribute("data-status", wanted)


def test_exactly_once_reminders(app_url: str, mail: Any) -> None:
    second = instance("APP_SECOND_URL")
    title = f"Spring Stitch {tag()}"
    w = zone_world(app_url, gatherings=[{
        "key": "g", "community": "c", "title": title, "startsLocal": "2027-03-07T19:00", "durationMinutes": 90,
        "recurrence": "weekly", "limit": 20, "attending": ["ann", "ben"],
    }])
    gid = w.ids["gatherings"]["g"]
    w.clock("2027-03-07T22:59:59Z")
    assert not mails_to(mail, w.email("ann"), 1, seconds=3)
    assert not mails_to(mail, w.email("ben"), 1, seconds=1)

    together([
        lambda: w.clock("2027-03-07T23:00:00Z", app_url),
        lambda: w.clock("2027-03-07T23:00:00Z", second),
    ])
    for key, display in (("ann", "Sun 7 Mar 2027, 7:00 PM EST"), ("ben", "Mon 8 Mar 2027, 12:00 AM GMT")):
        messages = mails_to(mail, w.email(key), 1)
        assert len(messages) == 1, f"{key} should get exactly one reminder"
        assert messages[0]["Subject"] == f"Starting soon: {title}"
        assert f"{title} starts {display}." in mail_text(messages[0])
        assert f"/gatherings/{gid}" in mail_text(messages[0])
    w.clock("2027-03-07T23:30:00Z")
    assert len(mails_to(mail, w.email("ann"), 2, seconds=3)) == 1, "no second reminder for one occurrence"
    assert not mails_to(mail, w.email("carol"), 1, seconds=1), "only attending people get a reminder"

    late_title = f"Late Stitch {tag()}"
    late = zone_world(app_url, gatherings=[{
        "key": "g", "community": "c", "title": late_title, "startsLocal": "2027-03-07T19:00", "durationMinutes": 90,
        "recurrence": "none", "limit": 20, "attending": ["ann"],
    }])
    late.clock("2027-03-08T00:10:00Z")
    assert not mails_to(mail, late.email("ann"), 1, seconds=3), "an occurrence already started sends nothing"


def test_wf_gathering_time_zones_schedule_keyboard(app_url: str, browser: Browser) -> None:
    w = zone_world(app_url)
    community = w.ids["communities"]["c"]
    w.clock("2027-03-01T12:00:00Z")
    note = "This time doesn't exist that day, so it moves forward."
    with browser_page(browser, w, "ann", f"/communities/{community}") as page:
        result = named(page, "status", "Gathering result")
        tab_to(page, named(page, "button", "Schedule gathering"))
        page.keyboard.press("Enter")
        dialog = named(page, "dialog", "Schedule gathering")
        expect(dialog).to_be_visible()
        tab_to(page, named(dialog, "textbox", "Title"))
        page.keyboard.type("Spring Stitch")
        tab_to(page, named(dialog, "textbox", "Starts"))
        page.keyboard.type("2027-03-14T02:30")
        duration = named(dialog, "spinbutton", "Duration in minutes")
        tab_to(page, duration)
        page.keyboard.type("10")
        tab_to(page, named(dialog, "combobox", "Repeats"))
        page.keyboard.press("w")
        tab_to(page, named(dialog, "spinbutton", "Limit"))
        page.keyboard.type("5")
        save = named(dialog, "button", "Save gathering")
        tab_to(page, save)
        page.keyboard.press("Enter")
        expect(result).to_have_text("Duration must be 15 to 480 minutes.")
        tab_to(page, duration)
        page.keyboard.type("60")
        tab_to(page, save)
        page.keyboard.press("Enter")
        expect(result).to_have_text("Gathering scheduled.")
        gid = w.signin("ann").get(f"/api/communities/{community}/gatherings").json()["gatherings"][0]["id"]
        go(page, f"{app_url}/gatherings/{gid}")
        items = named(page, "list", "Occurrences").get_by_role("listitem")
        expect(items.nth(0)).to_contain_text(note)
        expect(items.nth(1)).not_to_contain_text(note)
    ben = w.signin("ben").get(f"/api/gatherings/{gid}").json()
    assert ben["durationMinutes"] == 60 and ben["recurrence"] == "weekly"
    first = ben["occurrences"][0]
    assert parse_instant(first["startsAt"]) == parse_instant("2027-03-14T07:30:00Z")
    assert first["display"].endswith("GMT") and first["note"] == note
    with browser_page(browser, w, "ben", f"/gatherings/{gid}") as page:
        items = named(page, "list", "Occurrences").get_by_role("listitem")
        expect(items.nth(0)).to_contain_text(first["display"])
        expect(items.nth(0)).to_contain_text(note)


def test_wf_gathering_time_zones_attend_keyboard(app_url: str, browser: Browser) -> None:
    w = zone_world(app_url, gatherings=[{
        "key": "g", "community": "c", "title": "Spring Stitch", "startsLocal": "2027-06-06T19:00",
        "durationMinutes": 90, "recurrence": "weekly", "limit": 1, "attending": [],
    }, {
        "key": "race", "community": "c", "title": "Summer Stitch", "startsLocal": "2027-06-13T19:00",
        "durationMinutes": 90, "recurrence": "none", "limit": 1, "attending": [],
    }])
    gid = w.ids["gatherings"]["g"]
    w.clock("2027-06-01T12:00:00Z")
    with browser_page(browser, w, "ann", f"/gatherings/{gid}") as page, \
            browser_page(browser, w, "ben", f"/gatherings/{gid}") as ben_page:
        result = named(page, "status", "Gathering result")
        ben_result = named(ben_page, "status", "Gathering result")
        tab_to(page, named(page, "button", "Attend"))
        with held(page, "**/attend") as gate:
            page.keyboard.press("Enter")
            expect(result).to_have_text("Saving...")
            let_go(gate)
        expect(result).to_have_text("You're attending.")
        tab_to(ben_page, named(ben_page, "button", "Attend"))
        ben_page.keyboard.press("Enter")
        expect(ben_result).to_have_text("This gathering is full.")
        tab_to(page, named(page, "button", "Stop attending"))
        page.keyboard.press("Enter")
        expect(result).to_have_text("You're no longer attending.")
        tab_to(ben_page, named(ben_page, "button", "Attend"))
        ben_page.keyboard.press("Enter")
        expect(ben_result).to_have_text("You're attending.")
    stored = w.signin("ben").get(f"/api/gatherings/{gid}").json()
    assert stored["attending"] is True and stored["attendingCount"] == 1
    assert w.signin("ann").get(f"/api/gatherings/{gid}").json()["attending"] is False

    race, second = w.ids["gatherings"]["race"], instance("APP_SECOND_URL")
    final = re.compile(r"^\s*(You're attending\.|This gathering is full\.)\s*$")
    with ExitStack() as stack:
        pages = [
            stack.enter_context(browser_page(browser, w, "ann", f"/gatherings/{race}")),
            stack.enter_context(browser_page(browser, w, "ben", f"/gatherings/{race}", base=second)),
            stack.enter_context(browser_page(browser, w, "carol", f"/gatherings/{race}", base=second)),
        ]
        gates = []
        for each in pages:
            gates.append(stack.enter_context(held(each, "**/attend")))
            tab_to(each, named(each, "button", "Attend"))
            each.keyboard.press("Enter")
            expect(named(each, "status", "Gathering result")).to_have_text("Saving...")
        for gate in gates:
            let_go(gate)
        texts = []
        for each in pages:
            result = named(each, "status", "Gathering result")
            expect(result).to_have_text(final)
            texts.append(result.inner_text().strip())
        assert texts.count("You're attending.") == 1, texts
    assert w.signin("ann").get(f"/api/gatherings/{race}").json()["attendingCount"] == 1


def test_wf_gathering_time_zones_reminder_phone(app_url: str, browser: Browser, mail: Any) -> None:
    title = f"Spring Stitch {tag()}"
    w = zone_world(app_url, gatherings=[{
        "key": "g", "community": "c", "title": title, "startsLocal": "2027-03-07T19:00", "durationMinutes": 90,
        "recurrence": "weekly", "limit": 20, "attending": ["ben", "carol"],
    }])
    gid = w.ids["gatherings"]["g"]
    w.clock("2027-03-07T22:59:59Z")
    assert not mails_to(mail, w.email("ben"), 1, seconds=3)
    w.clock("2027-03-07T23:00:00Z")
    messages = mails_to(mail, w.email("ben"), 1)
    assert len(messages) == 1, "the person should get exactly one reminder"
    assert f"{title} starts Mon 8 Mar 2027, 12:00 AM GMT." in mail_text(messages[0])
    assert link_token(messages[0], "/gatherings") == gid
    with browser_page(browser, w, "ben", f"/gatherings/{gid}", viewport=PHONE, device_time=DEVICE_TIME) as page:
        items = named(page, "list", "Occurrences").get_by_role("listitem")
        expect(items.nth(0)).to_have_attribute("data-status", "upcoming")
        tap(named(page, "button", "Stop attending"))
        expect(named(page, "status", "Gathering result")).to_have_text("You're no longer attending.")
        no_overflow(page)
        w.clock("2027-03-07T23:45:00Z")
        page.reload()
        expect(items.nth(0)).to_have_attribute("data-status", "open")
        expect(items.nth(0)).to_contain_text("open")
    w.clock("2027-03-14T22:00:00Z")
    assert len(mails_to(mail, w.email("carol"), 2)) == 2, "someone still attending gets the next occurrence's reminder"
    assert len(mails_to(mail, w.email("ben"), 2, seconds=3)) == 1, "someone who stopped gets no more"


def test_wf_invite_reduced_outage_invite(app_url: str, browser: Browser, mail: Any) -> None:
    w = setup_world(app_url, people=[person("ann"), person("ben"), person("carol")])
    ann, ben = w.signin("ann"), w.signin("ben")
    with browser_page(browser, w, "ann", "/friends") as page:
        field = named(page, "textbox", "Friend's email")
        tab_to(page, field)
        page.keyboard.type(w.email("ben"))
        tab_to(page, named(page, "button", "Send invite"))
        with held(page, "**/api/friends/invites") as gate:
            page.keyboard.press("Enter")
            expect(named(page, "status", "Invite result")).to_have_text("Sending invite...")
            let_go(gate)
        expect(named(page, "status", "Invite result")).to_have_text("Invite on its way.")

        messages = mails_to(mail, w.email("ben"))
        assert len(messages) == 1 and messages[0]["Subject"] == "Ann Ember invited you to Hearthtile"
        token = link_token(messages[0], "/invites")

        fill(field, w.email("carol"))
        click(named(page, "button", "Send invite"))
        revoke = named(named(page, "list", "Sent invites"), "button", f"Revoke invite to {w.email('carol')}")
        expect(revoke).to_be_visible()
        carol_token = link_token(mails_to(mail, w.email("carol"))[0], "/invites")
        tab_to(page, revoke)
        page.keyboard.press("Enter")
        dead = {i["email"]: i["state"] for i in ann.get("/api/friends/invites").json()["invites"]}
        wait_for(
            lambda: {i["email"]: i["state"] for i in ann.get("/api/friends/invites").json()["invites"]}[w.email("carol")] == "revoked",
            WAIT_SECONDS, "revoking should set the invite state to revoked",
        )
        assert w.email("ben") in dead

    heading = "This invite isn't available."
    with browser_page(browser, w, "ben", f"/invites/{token}") as page:
        accept = named(page, "button", "Accept invite")
        tab_to(page, accept)
        page.keyboard.press("Enter")
        wait_for(
            lambda: w.pid("ann") in {f["personId"] for f in ben.get("/api/friends").json()["friends"]},
            WAIT_SECONDS, "accepting should make the pair friends",
        )
        go(page, f"{app_url}/invites/{token}")
        expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
        expect(named(page, "button", "Accept invite")).to_have_count(0)
    with browser_page(browser, w, "carol", f"/invites/{carol_token}") as page:
        expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
    assert w.pid("ben") in {f["personId"] for f in ann.get("/api/friends").json()["friends"]}
    assert w.pid("ann") not in {f["personId"] for f in w.signin("carol").get("/api/friends").json()["friends"]}


def test_invite_lifetime_and_refusals(app_url: str, mail: Any) -> None:
    w = setup_world(
        app_url,
        people=[person("ann"), person("ben"), person("carol"), person("dan"), person("eve")],
        blocks=[{"from": "dan", "to": "ann"}],
    )
    other = setup_world(app_url, people=[person("zed")])
    ann = w.signin("ann")
    invites = "/api/friends/invites"
    err(ann.post(invites, json={"email": "not-an-email"}), 422, "Enter a valid email address.")
    w.clock("2027-03-01T12:00:00Z")
    stranger = f"unknown-{tag()}@world.example"
    known = ann.post(invites, json={"email": w.email("ben")})
    unknown = ann.post(invites, json={"email": stranger})
    assert known.status_code == unknown.status_code == 202
    assert known.json() == unknown.json() == {"status": "sent"}
    assert len(mails_to(mail, stranger)) == 1

    def token_for(email: str) -> str:
        return link_token(mails_to(mail, email)[0], "/invites")

    ben_token = token_for(w.email("ben"))
    anon = client(app_url)
    assert anon.get(f"/api/invites/{ben_token}").json() == {"from": "Ann Ember"}
    not_found(ann.post(f"/api/invites/{ben_token}/accept"))
    not_found(other.signin("zed").post(f"/api/invites/{ben_token}/accept"))

    row = next(i for i in ann.get(invites).json()["invites"] if i["email"] == w.email("ben"))
    assert row["state"] == "pending"
    assert parse_instant(row["expiresAt"]) == parse_instant("2027-03-01T12:00:00Z") + timedelta(seconds=INVITE_TTL)
    w.clock("2027-03-08T11:59:59Z")
    assert anon.get(f"/api/invites/{ben_token}").status_code == 200
    w.clock("2027-03-08T12:00:00Z")
    not_found(anon.get(f"/api/invites/{ben_token}"))
    not_found(w.signin("ben").post(f"/api/invites/{ben_token}/accept"))
    row = next(i for i in ann.get(invites).json()["invites"] if i["email"] == w.email("ben"))
    assert row["state"] == "expired"
    assert w.pid("ann") not in {f["personId"] for f in w.signin("ben").get("/api/friends").json()["friends"]}

    assert ann.post(invites, json={"email": w.email("carol")}).status_code == 202
    carol_token = token_for(w.email("carol"))
    assert w.signin("carol").post(f"/api/invites/{carol_token}/accept").json() == {"status": "friends"}
    not_found(w.signin("carol").post(f"/api/invites/{carol_token}/accept"))
    assert next(i for i in ann.get(invites).json()["invites"] if i["email"] == w.email("carol"))["state"] == "used"

    assert ann.post(invites, json={"email": w.email("dan")}).status_code == 202
    not_found(w.signin("dan").post(f"/api/invites/{token_for(w.email('dan'))}/accept"))

    assert ann.post(invites, json={"email": w.email("eve")}).status_code == 202
    eve_token = token_for(w.email("eve"))
    invite_id = next(i for i in ann.get(invites).json()["invites"] if i["email"] == w.email("eve"))["id"]
    assert ann.delete(f"{invites}/{invite_id}").json() == {"status": "revoked"}
    not_found(anon.get(f"/api/invites/{eve_token}"))
    not_found(anon.get(f"/api/invites/{missing()}"))
    assert w.signin("carol").delete(f"/api/friends/{w.pid('ann')}").json() == {"status": "removed"}


def test_reduced_motion(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ann": (5, 5, "east"), "ben": (9, 5, "north")})
    running = "() => document.getAnimations().filter(a => a.playState === 'running').length"
    with room_page(browser, w, "ann", reduced_motion="reduce") as page:
        region = room(page)
        expect(region).to_have_attribute("data-motion", "reduced")
        say(page, f"quiet {tag()}")
        expect(named(page, "status", "Chat result")).to_have_text(heard(1))
        expect(region).to_have_attribute("data-ripple", "outline")
        expect(region).to_have_attribute("data-ripple-radius", "6")
        assert page.evaluate(running) == 0
        advance(page, OUTLINE_HOLD_MS - 100)
        expect(region).to_have_attribute("data-ripple", "outline")
        advance(page, 200)
        expect(region).to_have_attribute("data-ripple", "none")
        expect(region).to_have_attribute("data-ripple-radius", "0")

        named(page, "button", "Step north").focus()
        page.keyboard.press("ArrowRight")
        expect_tile(page, w.pid("ann"), 6, 5)
        assert page.evaluate(running) == 0
        advance(page, 50)
        settled = camera(page)
        advance(page, 1000)
        assert camera(page) == settled, "the camera cuts rather than glides"

        page.emulate_media(reduced_motion="no-preference")
        expect(region).to_have_attribute("data-motion", "animated")
        page.emulate_media(reduced_motion="reduce")
        expect(region).to_have_attribute("data-motion", "reduced")

        page.set_viewport_size(PHONE)
        opener = named(page, "button", "People and chat")
        click(opener)
        sheet = named(page, "dialog", "People and chat")
        expect(sheet).to_be_visible()
        assert page.evaluate(running) == 0
        click(named(sheet, "button", "Close"))
        expect(sheet).to_be_hidden()
        assert page.evaluate(running) == 0


def test_wf_invite_reduced_outage_minio(app_url: str, browser: Browser) -> None:
    down = instance("APP_MINIO_DOWN_URL")
    w = setup_world(app_url, people=[person("ann")])
    message = "File storage is unavailable. Nothing was saved."
    with browser_page(browser, w, "ann", "/studio", base=down) as page:
        select(named(page, "combobox", "Kind"), "avatar")
        fill(named(page, "textbox", "Model name"), "Outage Fox")
        page.get_by_label("Model file").set_input_files(
            {"name": "fox.glb", "mimeType": "model/gltf-binary", "buffer": model(triangles=10)},
        )
        click(named(page, "button", "Upload model"))
        expect(alert_with(page, message)).to_be_visible()
        advance(page, 5000)
        expect(alert_with(page, message)).to_be_visible()
    assert w.signin("ann").get("/api/assets", params={"mine": "true"}).json()["total"] == 0


def test_file_storage_outage(app_url: str) -> None:
    down = instance("APP_MINIO_DOWN_URL")
    w = setup_world(app_url, people=[person("ann")], rooms=[den_room("ann")])
    asset = w.ids["rooms"]["den"]
    ann, off = w.signin("ann"), w.signin("ann", down)
    saved = "File storage is unavailable. Nothing was saved."
    keys = S3().keys(f"assets/{asset}/")
    versions = ann.get(f"/api/assets/{asset}").json()["versions"]
    err(upload(off, "avatar", "Refused", png(4, 4)), 422, "This file is not a GLB model.")
    err(upload(off, "avatar", "Outage", model(triangles=4)), 503, saved)
    err(upload_version(off, asset, model(triangles=4), DEN_V1), 503, saved)
    err(off.post(f"/api/assets/{asset}/versions/1/restore"), 503, saved)
    err(off.delete(f"/api/assets/{asset}/versions/2"), 503, saved)
    err(off.get(f"/api/assets/{asset}/versions/1/file"), 503, "File storage is unavailable.")
    assert S3().keys(f"assets/{asset}/") == keys
    assert ann.get(f"/api/assets/{asset}").json()["versions"] == versions
    assert ann.get("/api/assets", params={"mine": "true", "kind": "avatar"}).json()["total"] == 0
    assert off.get("/api/communities").status_code == 200


def test_live_room_outage(app_url: str, browser: Browser) -> None:
    down = instance("APP_VALKEY_DOWN_URL")
    second = instance("APP_SECOND_URL")
    message = "Live rooms are unavailable right now."
    w = live_world(
        app_url, {"ann": (2, 2, "north"), "ben": (7, 7, "north"), "dan": (9, 9, "north")}, extra=("carol",),
        friendships=[["carol", "ann"]],
        communities=[{"key": "c", "name": "Stitch Night", "timeZone": "Asia/Tokyo",
                      "members": [{"person": "carol", "role": "owner"}]}],
    )
    sid, carol_off = w.sid(), w.signin("carol", down)
    carol_on = w.signin("carol")
    err(carol_off.post(f"/api/sessions/{sid}/join"), 503, message)
    err(carol_off.post("/api/sessions", json={
        "roomId": w.ids["rooms"]["loft"], "visibility": "public", "capacity": 3, "communityId": None,
    }), 503, message)
    assert w.pid("carol") not in people_of(w.signin("ann"), sid)
    assert carol_on.get("/api/sessions").json()["total"] == 1, "a refused open leaves no session"
    assert carol_off.get("/api/sessions").status_code == 200
    assert carol_off.get("/api/communities").status_code == 200
    assert carol_off.get("/api/assets").status_code == 200
    friend = next(f for f in carol_off.get("/api/friends").json()["friends"] if f["personId"] == w.pid("ann"))
    assert friend["presence"] == "offline"
    ann_off = w.signin("ann", down)
    for call in (
        lambda: press(ann_off, sid, "east"),
        lambda: ann_off.post(f"/api/sessions/{sid}/sit"),
        lambda: ann_off.post(f"/api/sessions/{sid}/stand"),
        lambda: chat(ann_off, sid, "hello"),
        lambda: ann_off.post(f"/api/sessions/{sid}/votes", json={"personId": w.pid("ben")}),
    ):
        err(call(), 503, message)

    with browser_page(browser, w, "carol", f"/sessions/{sid}", base=down) as page:
        click(named(page, "button", "Join session"))
        expect(alert_with(page, message)).to_be_visible()
        advance(page, RECONNECT_MS * 2)
        expect(alert_with(page, message)).to_be_visible()
        go(page, f"{down}/communities")
        expect(named(page, "navigation", "Main")).to_be_visible()
    assert w.pid("carol") not in people_of(w.signin("ann"), sid)

    ben_primary = w.signin("ben")
    with room_page(browser, w, "ann", base=second) as page:
        try:
            r = grading(second, "/api/grading/outage", {"service": "valkey", "down": True})
            assert r.status_code == 200
            page.keyboard.press("ArrowRight")
            expect(alert_with(page, message)).to_be_visible()
            expect_tile(page, w.pid("ann"), 2, 2)
            expect_tile(page, w.pid("ben"), 7, 7)
            march(ben_primary, sid, "west", 1)
        finally:
            r = grading(second, "/api/grading/outage", {"service": "valkey", "down": False})
            assert r.status_code == 200
        until(page, """() => {
            const alerts = [...document.querySelectorAll('[role=alert]')];
            return !alerts.some(a => a.textContent.includes('Live rooms are unavailable right now.'))
                && document.body.textContent.includes('Live room restored.');
        }""")
        expect(said(page, "Live room restored.")).to_have_count(1)
        expect_tile(page, w.pid("ben"), 6, 7)
    assert w.pid("ann") in people_of(ben_primary, sid), "an outage never removes anyone"


def test_wf_invite_reduced_outage_join_friend(app_url: str, browser: Browser) -> None:
    w = live_world(app_url, {"ben": (4, 4, "north")}, extra=("ann",), friendships=[["ann", "ben"]])
    sid, me = w.sid(), w.pid("ann")
    running = "() => document.getAnimations().filter(a => a.playState === 'running').length"
    with room_page(browser, w, "ben") as ben_page, browser_page(browser, w, "ann", "/friends", reduced_motion="reduce") as page:
        join = named(named(page, "list", "Friends"), "button", "Join Ben Reed")
        tab_to(page, join)
        page.keyboard.press("Enter")
        region = room(page)
        expect(region).to_have_attribute("data-motion", "reduced")
        wait_socket(page, sid)
        expect(said(ben_page, "Ann Ember arrived.")).to_have_count(1)
        expect_tile(page, me, 1, 1)
        if people_of(w.signin("ann"), sid)[me]["facing"] != "south":
            page.keyboard.press("ArrowDown")
            expect_facing(page, me, "south")
        page.keyboard.press("ArrowDown")
        expect_tile(page, me, 1, 2)
        assert page.evaluate(running) == 0
        say(page, f"quiet {tag()}")
        expect(named(page, "status", "Chat result")).to_have_text(heard(1))
        expect(region).to_have_attribute("data-ripple", "outline")
        expect(region).to_have_attribute("data-ripple-radius", "6")
        assert page.evaluate(running) == 0
        expect(room(ben_page)).to_have_attribute("data-ripple", "none")
        expect_tile(ben_page, me, 1, 2)


def test_wf_invite_reduced_outage_phone_accept(app_url: str, browser: Browser, mail: Any) -> None:
    w = setup_world(app_url, people=[person("ann"), person("ben"), person("carol")])
    ann, ben = w.signin("ann"), w.signin("ben")
    for key in ("ben", "carol"):
        assert ann.post("/api/friends/invites", json={"email": w.email(key)}).status_code == 202
    used = link_token(mails_to(mail, w.email("ben"))[0], "/invites")
    revoked = link_token(mails_to(mail, w.email("carol"))[0], "/invites")
    row = next(i for i in ann.get("/api/friends/invites").json()["invites"] if i["email"] == w.email("carol"))
    assert ann.delete(f"/api/friends/invites/{row['id']}").json() == {"status": "revoked"}
    with browser_page(browser, w, "ben", f"/invites/{used}", viewport=PHONE) as page:
        tap(named(page, "button", "Accept invite"))
        wait_for(
            lambda: w.pid("ann") in {f["personId"] for f in ben.get("/api/friends").json()["friends"]},
            WAIT_SECONDS, "accepting should make the pair friends",
        )
        no_overflow(page)
    heading = "This invite isn't available."
    with browser_page(browser, w, "carol", f"/invites/{revoked}", viewport=PHONE) as page:
        expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
        expect(named(page, "button", "Accept invite")).to_have_count(0)
        seen = page.locator("body").inner_text()
        for token in (used, missing()):
            go(page, f"{app_url}/invites/{token}")
            expect(page.get_by_role("heading", name=heading, exact=True)).to_be_visible()
            assert page.locator("body").inner_text() == seen, "every dead link looks identical"
    assert w.pid("ann") not in {f["personId"] for f in w.signin("carol").get("/api/friends").json()["friends"]}


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field]


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing}"


def test_if_allowed_licences() -> None:
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not refused, f"packages outside the allowed licences: {refused}"


def test_if_only_four_services() -> None:
    extra = sorted({p.name for p in shipped_packages()} & OUT_OF_SCOPE_PACKAGES)
    assert not extra, f"out-of-scope datastore or broker packages: {extra}"


def source_files(*suffixes: str) -> list[Path]:
    skipped = {"node_modules", "dist", "build", ".next", ".git", "out"}
    return [
        path for path in Path("/app").rglob("*")
        if path.suffix in suffixes and path.is_file() and not skipped & set(path.parts)
    ]


def test_if_typescript_source() -> None:
    typescript = source_files(".ts", ".tsx")
    javascript = source_files(".js", ".jsx", ".mjs", ".cjs")
    assert typescript, "the source should hold TypeScript files"
    assert len(typescript) > len(javascript), "TypeScript should be the application's source language"


def test_if_shipped_assets_named() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    unnamed = [p.name for p in source_files(".woff", ".woff2", ".ttf", ".otf") if p.name not in notices]
    assert not unnamed, f"font files not named in the notices: {unnamed}"


def test_if_service_definitions() -> None:
    definitions = [p for p in source_files(".yml", ".yaml") if "compose" in p.name]
    for path in definitions:
        body = path.read_text().lower()
        assert not [word for word in SERVICE_IMAGES_BANNED if word in body], f"{path} adds another service"
