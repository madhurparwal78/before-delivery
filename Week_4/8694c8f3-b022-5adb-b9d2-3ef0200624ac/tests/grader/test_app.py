from __future__ import annotations

import hashlib
import io
import json
import os
import re
import socket
import subprocess
import struct
import tempfile
import threading
import time
import uuid
import zipfile
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    Valkey,
    advance,
    animations,
    camera,
    capture,
    changed,
    decode,
    difference,
    fill as cfill,
    held,
    layout,
    settle,
    licence_allowed,
    motion,
    open_app,
    same_origin,
    sample,
    scene_frames,
    select,
    shipped_packages,
    tab_order,
    unique,
)


HTTP_TIMEOUT = 60.0
UI_WAIT_S = 30.0
LOCK_WAIT_S = 75.0
COPY_BOOT_S = 120.0

SESSION_DAYS = 30
LOCK_TTL_S = 30
LOCK_EVENT_S = 2
PRESENCE_S = 2
CATCH_UP_S = 5
SHOW_SWITCH_S = 5
BANNER_S = 10
IDLE_COMMIT_MS = 2000
IDLE_WINDOW_MS = 2000
MIN_FPS = 30
RIG_DRAWER_MS = 500
JSON_LIMIT = 1_000_000
MODEL_LIMIT = 20_000_000
TEXTURE_LIMIT = 8_000_000
IMPORT_LIMIT = 50_000_000
TICKS_PER_BEAT = 96
TICKS_PER_BAR = 384
TICK_LIMIT = 24_576
SNAP_TICKS = 24
BPM_DEFAULT = 120
FAR_KEY_TICK = 6_336
TOUCH_MIN_PX = 44
WIDE_FROM_PX = 1024
NAME_MAX = 40
EMAIL_MAX = 254
NOTE_MAX = 200
FOV_MIN, FOV_MAX = 10, 120
FAR_MAX = 10_000
PRESENCE_TTL_S = 30

GIZMO_DRAG_PX = 120
ROTATE_DRAG_PX = 40
SCALE_DRAG_PX = 50
SCRUB_DRAG_PX = 30
SHIFT_DRAG_PX = 40
PLAY_SPAN_MS = 600
NARROW_W = 768
COOKIE_NAME = "ag_session"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax")
PROBE_DISPLAY = "Night Owl"
EMPTY_SCRIPT = "function onBeat(ctx) {}\n"
SCRIPT_X = "/* x */\n"
SCRIPT_ONE = "/* one */\n"
SCRIPT_TWO = "/* two */\n"
KEY_LABEL = "Twist"
SLOT_NAME = "Albedo"
RESTORE_FROM = 1
SKIN_SCRIPT = "Probe script"
SHOW_NOTE = "Doors at ten"
CURSOR_DOT = "Cursor colour"
BROWSE = "Browse texture for"
SKEW_HOURS = 6
LOCK_RACERS = 6
OP_RACERS = 8

SHOW_FORMAT = "afterglass-show/1"
EXPORT_FORMAT = "afterglass-export/1"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib"}

BOOTH_BODY = "Build the set in a browser. Play it on any screen in the room."
ERR_EMAIL = "Enter a valid email address"
ERR_PASSWORD = "Password must be at least 10 characters"
ERR_DISPLAY = "Display name must be 1 to 40 characters"
ERR_TAKEN = "An account with this email already exists"
ERR_CREDENTIALS = "Email or password is incorrect"
NO_SETS = "No sets yet"
INVITE_USED_COPY = "This invite link has already been used"
ANCESTOR_MSG = "A layer cannot be its own ancestor"
WIRE_DIRECTION = "Wires run from an output to an input"
WIRE_OCCUPIED = "This input already has a wire"
WIRE_LOOP = "This wire would make a loop"
NOT_EXPORT = "Not an Afterglass export"
STORAGE_BANNER = "Asset storage is unreachable. Uploads and publishing are paused."
COLLAB_BANNER = "Live collaboration is offline. Locks can\u2019t be taken right now."
BACK_ONLINE = "Back online. All changes synced."
CONFLICT_TITLE = "Someone changed this layer first"
NOTHING_LIVE = "Nothing is live yet"
ASSET_IN_USE_TITLE = "Asset still in use"

STARTER_SHADER = (
    "#version 300 es\n"
    "precision highp float;\n"
    "uniform float u_beat;\n"
    "uniform vec2 u_resolution;\n"
    "out vec4 fragColor;\n"
    "void main() {\n"
    "  vec2 uv = gl_FragCoord.xy / u_resolution;\n"
    "  float pulse = 0.5 + 0.5 * sin(u_beat * 6.2831853);\n"
    "  fragColor = vec4(uv * pulse, 0.5, 1.0);\n"
    "}\n"
)

PULSE_NODE_SCRIPT = (
    'registerNode("Pulse", {\n'
    '  inputs: ["beat"],\n'
    '  outputs: ["value"],\n'
    "  run(inputs) {\n"
    "    return { value: Math.abs(Math.sin(inputs.beat * Math.PI)) };\n"
    "  }\n"
    "});\n"
)

BROKEN_SHADER = (
    "#version 300 es\n"
    "precision highp float;\n"
    "uniform vec2 u_resolution;\n"
    "out vec4 fragColor;\n"
    "void main() {\n"
    "  vec2 uv = gl_FragCoord.xy / u_resolution;\n"
    "  fragColor = vec4(uv, 0.5, undefinedThing);\n"
    "  float extra = otherMissing;\n"
    "}\n"
)
BROKEN_LINE = 7


def solid_shader(r: float, g: float, b: float) -> str:
    return (
        "#version 300 es\n"
        "precision highp float;\n"
        "out vec4 fragColor;\n"
        "void main() {\n"
        f"  fragColor = vec4({r:.1f}, {g:.1f}, {b:.1f}, 1.0);\n"
        "}\n"
    )


@dataclass
class User:
    email: str
    password: str
    display_name: str
    id: str
    cookie: str
    base: str

    def __post_init__(self) -> None:
        self.c = self.api()

    def api(self, base: str | None = None) -> httpx.Client:
        return httpx.Client(
            base_url=(base or self.base).rstrip("/"),
            headers={"Cookie": f"ag_session={self.cookie}"},
            timeout=HTTP_TIMEOUT,
        )


def anon(base: str) -> httpx.Client:
    return httpx.Client(base_url=base.rstrip("/"), timeout=HTTP_TIMEOUT)


def new_id() -> str:
    return str(uuid.uuid4())


def op_id() -> str:
    return f"op-{uuid.uuid4().hex}"


def new_email(prefix: str) -> str:
    for part in unique(prefix):
        if isinstance(part, str) and "@" in part:
            return part.strip().lower()
    return f"{prefix}-{uuid.uuid4().hex[:10]}@example.test"


def new_display(prefix: str) -> str:
    return f"{prefix.title()} {uuid.uuid4().hex[:6]}"


def new_password() -> str:
    return f"booth-{uuid.uuid4().hex[:12]}"


def signup(base: str, prefix: str = "vj") -> User:
    email, display, password = new_email(prefix), new_display(prefix), new_password()
    r = httpx.post(
        f"{base.rstrip('/')}/api/auth/signup",
        json={"email": email, "password": password, "display_name": display},
        timeout=HTTP_TIMEOUT,
    )
    assert r.status_code == 201, f"POST /api/auth/signup creates an account: {r.status_code} {r.text}"
    cookie = r.cookies.get("ag_session")
    assert cookie, "signup sets the ag_session cookie"
    return User(email, password, display, r.json()["user"]["id"], cookie, base.rstrip("/"))


def err(r: httpx.Response) -> dict:
    body = r.json()
    assert isinstance(body, dict) and "error" in body, f"error shape {{'error':{{...}}}}: {r.text}"
    return body["error"]


def extra(r: httpx.Response, key: str) -> Any:
    body = r.json()
    if key in body.get("error", {}):
        return body["error"][key]
    assert key in body, f"{key!r} is in the error body or at the top level: {r.text}"
    return body[key]


def create_set(user: User, name: str | None = None, client: httpx.Client | None = None) -> dict:
    name = name or f"Set {uuid.uuid4().hex[:8]}"
    r = (client or user.c).post("/api/sets", json={"name": name, "starter": "blank-stage"})
    assert r.status_code == 201, f"POST /api/sets: {r.status_code} {r.text}"
    return r.json()


def doc_of(user: User, sid: str, client: httpx.Client | None = None) -> dict:
    r = (client or user.c).get(f"/api/sets/{sid}")
    assert r.status_code == 200, f"GET /api/sets/{sid}: {r.status_code} {r.text}"
    return r.json()


def by_name(doc: dict, name: str) -> dict:
    found = [lay for lay in doc["layers"] if lay["name"] == name]
    assert found, f"layer {name!r} is in the set document"
    return found[0]


def by_id(doc: dict, lid: str) -> dict:
    found = [lay for lay in doc["layers"] if lay["id"] == lid]
    assert found, f"layer {lid} is in the set document"
    return found[0]


def send_op(user: User | None, sid: str, target: str, type_: str, payload: dict,
            base: int | None = None, cid: str | None = None,
            client: httpx.Client | None = None) -> httpx.Response:
    body: dict[str, Any] = {"client_op_id": cid or op_id(), "target": target, "type": type_, "payload": payload}
    if base is not None:
        body["base_version"] = base
    c = client or (user.c if user else None)
    assert c is not None
    return c.post(f"/api/sets/{sid}/ops", json=body)


def commit(user: User, sid: str, target: str, type_: str, payload: dict,
           base: int | None = None, client: httpx.Client | None = None) -> dict:
    r = send_op(user, sid, target, type_, payload, base=base, client=client)
    assert r.status_code == 200, f"{type_} on {target} commits: {r.status_code} {r.text}"
    return r.json()


def add_layer(user: User, sid: str, name: str, kind: str, parent_id: str | None = None,
              client: httpx.Client | None = None) -> str:
    doc = doc_of(user, sid, client)
    count = sum(1 for lay in doc["layers"] if lay["parent_id"] == parent_id)
    lid = new_id()
    commit(user, sid, lid, "layer.add",
           {"parent_id": parent_id, "index": count, "name": name, "kind": kind}, client=client)
    return lid


def set_layer(user: User, sid: str, lid: str, path: str, value: Any,
              client: httpx.Client | None = None) -> dict:
    current = by_id(doc_of(user, sid, client), lid)
    return commit(user, sid, lid, "layer.set", {"path": path, "value": value},
                  base=current["version"], client=client)


def set_settings(user: User, sid: str, payload: dict) -> dict:
    doc = doc_of(user, sid)
    return commit(user, sid, "set", "set.update", payload, base=doc["set"]["settings_version"])


def put_key(user: User, sid: str, lid: str, prop: str, tick: int, value: float) -> dict:
    current = by_id(doc_of(user, sid), lid)
    return commit(user, sid, lid, "key.set", {"property": prop, "tick": tick, "value": value},
                  base=current["version"])


def add_script(user: User, sid: str, name: str, source: str) -> str:
    script_id = new_id()
    commit(user, sid, script_id, "script.add", {"name": name, "source": source})
    return script_id


def script_of(user: User, sid: str, script_id: str) -> dict:
    found = [s for s in doc_of(user, sid)["scripts"] if s["id"] == script_id]
    assert found, f"script {script_id} is in the set document"
    return found[0]


def save_shader(user: User, sid: str, lid: str, source: str) -> dict:
    current = by_id(doc_of(user, sid), lid)
    return commit(user, sid, lid, "shader.save", {"source": source}, base=current["version"])


def shader_versions(user: User, sid: str, lid: str, client: httpx.Client | None = None) -> list[dict]:
    r = (client or user.c).get(f"/api/sets/{sid}/layers/{lid}/shader/versions")
    assert r.status_code == 200, f"GET shader versions: {r.status_code} {r.text}"
    return r.json()["versions"]


def shader_source(user: User, sid: str, lid: str, n: int) -> dict:
    r = user.c.get(f"/api/sets/{sid}/layers/{lid}/shader/versions/{n}")
    assert r.status_code == 200, f"GET shader version {n}: {r.status_code} {r.text}"
    return r.json()


def node_key(node: dict) -> str:
    return node.get("node_id") or node.get("id")


def upload(user: User, sid: str, kind: str, filename: str, data: bytes, mime: str,
           base: str | None = None) -> httpx.Response:
    return user.api(base).post(f"/api/sets/{sid}/assets", data={"kind": kind},
                               files={"file": (filename, data, mime)})


def upload_ready(user: User, sid: str, kind: str, filename: str, data: bytes, mime: str) -> dict:
    r = upload(user, sid, kind, filename, data, mime)
    assert r.status_code == 201, f"asset upload: {r.status_code} {r.text}"
    asset = r.json()["asset"]
    assert asset["status"] == "ready"
    return asset


def assets_of(user: User, sid: str, client: httpx.Client | None = None) -> list[dict]:
    r = (client or user.c).get(f"/api/sets/{sid}/assets")
    assert r.status_code == 200, f"GET assets: {r.status_code} {r.text}"
    return r.json()["assets"]


def asset_of(user: User, sid: str, aid: str) -> dict | None:
    return next((a for a in assets_of(user, sid) if a["id"] == aid), None)


def publish(user: User, sid: str, client: httpx.Client | None = None, note: str | None = None) -> httpx.Response:
    body = {} if note is None else {"note": note}
    return (client or user.c).post(f"/api/sets/{sid}/shows", json=body)


def shows_of(user: User, sid: str) -> dict:
    r = user.c.get(f"/api/sets/{sid}/shows")
    assert r.status_code == 200, r.text
    return r.json()


def activity(user: User, sid: str, before: str | None = None) -> list[dict]:
    path = f"/api/sets/{sid}/activity" + (f"?before={before}" if before else "")
    r = user.c.get(path)
    assert r.status_code == 200, f"GET activity: {r.status_code} {r.text}"
    return r.json()["entries"]


def ops_of(user: User, sid: str, after: int = 0) -> list[dict]:
    r = user.c.get(f"/api/sets/{sid}/ops?after={after}")
    assert r.status_code == 200, r.text
    return r.json()["ops"]


def add_member(owner: User, sid: str, role: str, prefix: str = "guest") -> User:
    r = owner.c.post(f"/api/sets/{sid}/invites", json={"role": role})
    assert r.status_code == 201, f"invite: {r.status_code} {r.text}"
    guest = signup(owner.base, prefix)
    a = guest.c.post(f"/api/invites/{r.json()['token']}/accept")
    assert a.status_code == 200, f"accept invite: {a.status_code} {a.text}"
    return guest


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def together(n: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(n)

    def run(i: int) -> Any:
        barrier.wait()
        return fn(i)

    with ThreadPoolExecutor(n) as pool:
        return list(pool.map(run, range(n)))


def outage_url(env: str) -> str:
    url = os.environ.get(env)
    assert url, f"{env} names the outage instance"
    return url.rstrip("/")


def show_token(user: User, sid: str) -> str:
    return doc_of(user, sid)["set"]["show_token"]


def make_glb(tag: str) -> bytes:
    positions = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    gltf = {
        "asset": {"version": "2.0", "extras": {"probe": tag}},
        "scene": 0, "scenes": [{"nodes": [0]}], "nodes": [{"mesh": 0}],
        "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "buffers": [{"byteLength": len(positions)}],
        "bufferViews": [{"buffer": 0, "byteOffset": 0, "byteLength": len(positions)}],
        "accessors": [{"bufferView": 0, "componentType": 5126, "count": 3, "type": "VEC3",
                       "min": [0, 0, 0], "max": [1, 1, 0]}],
    }
    js = json.dumps(gltf).encode()
    js += b" " * (-len(js) % 4)
    binc = positions + b"\0" * (-len(positions) % 4)
    total = 12 + 8 + len(js) + 8 + len(binc)
    return (b"glTF" + struct.pack("<II", 2, total) + struct.pack("<I", len(js)) + b"JSON" + js
            + struct.pack("<I", len(binc)) + b"BIN\0" + binc)


def make_png(tag: str, size: int = 4) -> bytes:
    raw = b"".join(b"\0" + bytes([200, 40, 90]) * size for _ in range(size))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", size, size, 8, 2, 0, 0, 0)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"tEXt", b"Comment\0" + tag.encode())
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def make_jpeg(tag: str) -> bytes:
    return (b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
            + b"\xff\xfe" + struct.pack(">H", len(tag) + 2) + tag.encode() + b"\xff\xd9")


class Listener:

    def __init__(self, client: httpx.Client, path: str, want: Callable[[str, Any], bool], seconds: float):
        self.ready = threading.Event()
        self.result: tuple[str, Any, float] | None = None
        self.status: int | None = None
        self.content_type = ""
        self.seconds = seconds
        self.path = path
        self.thread = threading.Thread(target=self._run, args=(client, path, want, seconds), daemon=True)
        self.thread.start()
        assert self.ready.wait(HTTP_TIMEOUT), f"GET {path} opened an event stream"
        assert self.status == 200, f"GET {path} answers 200, got {self.status}"
        assert self.content_type.startswith("text/event-stream"), f"{path} is text/event-stream"

    def _run(self, client: httpx.Client, path: str, want: Callable[[str, Any], bool], seconds: float) -> None:
        deadline = time.monotonic() + seconds
        try:
            with client.stream("GET", path, timeout=httpx.Timeout(HTTP_TIMEOUT, read=seconds)) as r:
                self.status, self.content_type = r.status_code, r.headers.get("content-type", "")
                self.ready.set()
                event, data = "message", []
                for line in r.iter_lines():
                    if time.monotonic() > deadline:
                        return
                    if line == "":
                        if data:
                            try:
                                payload = json.loads("\n".join(data))
                            except ValueError:
                                payload = None
                            if want(event, payload):
                                self.result = (event, payload, time.monotonic())
                                return
                        event, data = "message", []
                    elif line.startswith("event:"):
                        event = line[6:].strip()
                    elif line.startswith("data:"):
                        data.append(line[5:].strip())
        except httpx.HTTPError:
            return
        finally:
            self.ready.set()

    def wait(self, what: str) -> tuple[str, Any, float]:
        self.thread.join(timeout=self.seconds + HTTP_TIMEOUT)
        if self.result is None:
            pytest.fail(f"{self.path}: expected {what} within {self.seconds} s")
        return self.result


CATCH = (PlaywrightError, LookupError, ValueError, TypeError, AttributeError)


def eventually(pages: Page | list[Page], check: Callable[[], Any], what: str,
               seconds: float = UI_WAIT_S, step_ms: float = 100) -> None:
    group = pages if isinstance(pages, list) else [pages]
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except CATCH:
            pass
        for p in group:
            advance(p, step_ms)
    pytest.fail(f"within {seconds} s: expected {what}")


def flat(value: str | None) -> str:
    return " ".join((value or "").split())


def text(loc: Locator) -> str:
    return flat(loc.first.text_content()) if loc.count() else ""


def visible(loc: Locator) -> Callable[[], bool]:
    return lambda: loc.count() > 0 and loc.first.is_visible()


def gone(loc: Locator) -> Callable[[], bool]:
    return lambda: loc.count() == 0 or not loc.first.is_visible()


def text_is(loc: Locator, expected: str) -> Callable[[], bool]:
    return lambda: text(loc) == expected


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def tree(page: Page) -> Locator:
    return page.get_by_role("tree", name="Layers", exact=True)


def row(page: Page, name: str) -> Locator:
    return tree(page).get_by_role("treeitem", name=name, exact=True)


def stage(page: Page) -> Locator:
    return page.get_by_role("img", name="Stage viewport", exact=True)


def frames(page: Page) -> int:
    raw = stage(page).get_attribute("data-frame")
    assert raw is not None, "the Stage viewport canvas carries data-frame"
    return int(raw)


def transport(page: Page, name: str) -> Locator:
    return page.get_by_role("group", name="Beat transport", exact=True).get_by_role("button", name=name, exact=True)


def spin(page: Page, label: str) -> Locator:
    return page.get_by_role("spinbutton", name=label, exact=True)


def tile(page: Page, name: str) -> None:
    page.get_by_role("navigation", name="Workbench", exact=True).get_by_role("button", name=name, exact=True).click()


def tab(page: Page, name: str) -> None:
    t = page.get_by_role("tablist", name="Workbench tabs", exact=True).get_by_role("tab", name=name, exact=True)
    eventually(page, visible(t), f"tab {name!r}")
    t.click()


def value_of(loc: Locator) -> float:
    raw = loc.get_attribute("aria-valuenow")
    if raw is None:
        try:
            raw = loc.input_value()
        except PlaywrightError:
            raw = loc.text_content() or ""
    return float(re.sub(r"[^0-9eE+\-.]", "", raw.replace("\u2212", "-")))


def is_focused(loc: Locator) -> bool:
    return bool(loc.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"))


def holds_focus(container: Locator) -> bool:
    return bool(container.first.evaluate("d => d.contains(document.activeElement)"))


def active_role(page: Page) -> str:
    return page.evaluate(
        """() => { const e = document.activeElement; if (!e) return '';
        const r = e.getAttribute('role'); if (r) return r;
        if (e.tagName === 'INPUT') return e.type === 'radio' ? 'radio' : e.type === 'checkbox' ? 'checkbox' : 'textbox';
        return ({BUTTON: 'button', A: 'link', TEXTAREA: 'textbox', SELECT: 'combobox'})[e.tagName] || e.tagName.toLowerCase(); }"""
    )


def focus_by_tab(page: Page, name: str, role: str | None = None, limit: int = 60) -> None:
    for _ in range(limit):
        names = tab_order(page, 1)
        if names and names[-1] == name and (role is None or active_role(page) == role):
            return
    pytest.fail(f"Tab reaches the control named {name!r}")


def sign_in_ui(page: Page, user: User) -> None:
    email = page.get_by_role("textbox", name="Email", exact=True)
    link = page.get_by_role("link", name="Sign in", exact=True)
    eventually(page, lambda: visible(email)() or visible(link)(), "the sign-in form or the 'Sign in' link")
    if not visible(email)():
        link.first.click()
    eventually(page, visible(email), "the sign-in form")
    email.first.fill(user.email)
    page.get_by_role("textbox", name="Password", exact=True).first.fill(user.password)
    page.get_by_role("button", name="Sign in", exact=True).first.click()
    eventually(page, visible(page.get_by_role("button", name="Account", exact=True)), "the signed-in shell")


def open_set(page: Page, set_name: str) -> None:
    rig = page.get_by_role("complementary", name="Rig panel", exact=True)
    entry = rig.get_by_text(set_name, exact=True)
    eventually(page, visible(entry), f"the workspace lists set {set_name!r}")
    entry.first.click()
    eventually(page, visible(tree(page)), "the layer tree of the opened set")
    eventually(page, lambda: frames(page) >= 1, "the first stage frame")


@contextmanager
def editor(browser: Browser, user: User, set_name: str, base: str | None = None, **opts: Any) -> Iterator[Page]:
    base = (base or user.base).rstrip("/")
    with open_app(browser, base + "/", **opts) as page:
        sign_in_ui(page, user)
        open_set(page, set_name)
        yield page


def reload_set(page: Page, set_name: str) -> None:
    page.reload()
    rig_entry = page.get_by_role("complementary", name="Rig panel", exact=True).get_by_text(set_name, exact=True)
    eventually(page, lambda: visible(tree(page))() or visible(rig_entry)(), "the set or the workspace after reload")
    if not visible(tree(page))():
        open_set(page, set_name)


def reveal(page: Page, name: str) -> Locator:
    target = row(page, name)
    for _ in range(12):
        if target.count() and target.first.is_visible():
            return target.first
        closed = tree(page).get_by_role("treeitem", expanded=False)
        if closed.count() == 0:
            advance(page, 100)
            continue
        closed.first.focus()
        page.keyboard.press("ArrowRight")
        advance(page, 100)
    pytest.fail(f"layer row {name!r} becomes visible in the tree")


def select_layer(page: Page, name: str) -> None:
    reveal(page, name).click()
    heading = page.get_by_role("region", name="Inspector", exact=True).get_by_role("heading", level=2, name=name, exact=True)
    eventually(page, visible(heading), f"the inspector retitles to {name!r}")


def drawer(page: Page, name: str) -> None:
    button = page.get_by_role("region", name="Inspector", exact=True).get_by_role("button", name=name, exact=True)
    eventually(page, visible(button), f"component drawer {name!r}")
    if button.first.get_attribute("aria-expanded") == "false":
        button.first.click()
    eventually(page, lambda: button.first.get_attribute("aria-expanded") == "true", f"drawer {name!r} open")


def field(page: Page, drawer_name: str, label: str) -> Locator:
    drawer(page, drawer_name)
    loc = spin(page, label)
    eventually(page, visible(loc), f"scrub field {label!r}")
    return loc.first


def add_from_menu(page: Page, item: str) -> None:
    menubar = page.get_by_role("menubar", name="Set menu", exact=True)
    menubar.get_by_role("menuitem", name="Add", exact=True).click()
    entry = page.get_by_role("menuitem", name=item, exact=True)
    eventually(page, visible(entry), f"Add menu item {item!r}")
    entry.first.click()


def add_node_ui(page: Page, title: str) -> None:
    page.get_by_role("button", name="Add node", exact=True).click()
    menu = page.get_by_role("menu", name="Node types", exact=True)
    eventually(page, visible(menu), "the Node types menu")
    menu.get_by_role("menuitem", name=title, exact=True).click()
    eventually(page, visible(page.get_by_role("button", name=f"{title} node", exact=True)), f"the {title} node")


def drag(page: Page, start: tuple[float, float], direction: tuple[float, float], distance: float,
         steps: int = 12, shift: bool = False, release: bool = True) -> None:
    x, y = start
    ux, uy = direction
    if shift:
        page.keyboard.down("Shift")
    page.mouse.move(x, y)
    page.mouse.down()
    for i in range(1, steps + 1):
        page.mouse.move(x + ux * distance * i / steps, y + uy * distance * i / steps)
        advance(page, 16)
    if release:
        page.mouse.up()
    if shift:
        page.keyboard.up("Shift")


def grips(page: Page) -> dict[str, tuple[float, float]] | None:
    canvas = stage(page)
    box = canvas.bounding_box()
    found: dict[str, tuple[float, float]] = {}
    for axis in "xyz":
        raw = canvas.get_attribute(f"data-gizmo-{axis}")
        if not raw:
            return None
        gx, gy = (float(v) for v in raw.split(","))
        found[axis] = (box["x"] + gx, box["y"] + gy)
    return found


def circumcenter(a: tuple[float, float], b: tuple[float, float], c: tuple[float, float]) -> tuple[float, float]:
    (ax, ay), (bx, by), (cx, cy) = a, b, c
    d = 2 * (ax * (by - cy) + bx * (cy - ay) + cx * (ay - by))
    assert abs(d) > 1e-6, "the three gizmo grips are not collinear"
    a2, b2, c2 = ax * ax + ay * ay, bx * bx + by * by, cx * cx + cy * cy
    return ((a2 * (by - cy) + b2 * (cy - ay) + c2 * (ay - by)) / d,
            (a2 * (cx - bx) + b2 * (ax - cx) + c2 * (bx - ax)) / d)


def drag_grip(page: Page, axis: str, distance: float) -> None:
    eventually(page, lambda: grips(page) is not None, "data-gizmo-x/y/z on the canvas")
    pts = grips(page)
    assert pts
    ox, oy = circumcenter(pts["x"], pts["y"], pts["z"])
    gx, gy = pts[axis]
    length = ((gx - ox) ** 2 + (gy - oy) ** 2) ** 0.5
    drag(page, (gx, gy), ((gx - ox) / length, (gy - oy) / length), distance)


def bars_beats(tick: int) -> str:
    bar = tick // TICKS_PER_BAR + 1
    beat = (tick % TICKS_PER_BAR) / TICKS_PER_BEAT + 1
    return f"{bar}:{beat:g}"


def seconds_at(tick: int, bpm: float) -> str:
    return f"{tick / TICKS_PER_BEAT * 60 / bpm:.3f}"


def session_user(page: Page, base: str, email: str, password: str, display: str) -> User:
    cookie = next(c["value"] for c in page.context.cookies() if c["name"] == "ag_session")
    me = httpx.get(f"{base}/api/me", headers={"Cookie": f"ag_session={cookie}"}, timeout=HTTP_TIMEOUT)
    assert me.status_code == 200, me.text
    return User(email, password, display, me.json()["user"]["id"], cookie, base)


def server_now(user: User, sid: str) -> datetime:
    r = user.c.get(f"/api/sets/{sid}/locks")
    assert r.status_code == 200, r.text
    return iso(r.json()["server_time"])


def blank_set_with(owner: User, kind: str = "tube", name: str | None = None) -> tuple[str, str, str, str]:
    set_name = f"Set {uuid.uuid4().hex[:8]}"
    sid = create_set(owner, set_name)["set"]["id"]
    layer_name = name or f"Tunnel {uuid.uuid4().hex[:4]}"
    lid = add_layer(owner, sid, layer_name, kind)
    return sid, set_name, lid, layer_name


def test_account_signup_signin(app_url):
    c = anon(app_url)
    tag = uuid.uuid4().hex[:12]
    ok_pw = new_password()
    bad_emails = [f"{tag}.example.test", f"{tag}@x@example.test", "@example.test", f"{tag}@exampletest",
                  f"{tag}@.example", f"{tag}@example.", f"{tag} vj@example.test",
                  tag + "a" * (EMAIL_MAX - len(tag) - len("@example.test") + 1) + "@example.test"]
    for bad in bad_emails:
        r = c.post("/api/auth/signup", json={"email": bad, "password": ok_pw, "display_name": PROBE_DISPLAY})
        assert r.status_code == 422, f"{bad!r} is refused"
        e = err(r)
        assert e["code"] == "validation" and e["fields"]["email"] == ERR_EMAIL and e["message"] == ERR_EMAIL
    r = c.post("/api/auth/signup", json={"email": new_email("pw"), "password": "nine-char", "display_name": "Owl"})
    assert r.status_code == 422 and err(r)["fields"]["password"] == ERR_PASSWORD and err(r)["message"] == ERR_PASSWORD
    for name in ["   ", "n" * (NAME_MAX + 1)]:
        r = c.post("/api/auth/signup", json={"email": new_email("dn"), "password": ok_pw, "display_name": name})
        assert r.status_code == 422 and err(r)["fields"]["display_name"] == ERR_DISPLAY
    both = c.post("/api/auth/signup", json={"email": "nope", "password": "short", "display_name": "Owl"})
    assert both.status_code == 422
    assert both.json()["error"]["fields"]["email"] == ERR_EMAIL
    assert both.json()["error"]["fields"]["password"] == ERR_PASSWORD
    assert both.json()["error"]["message"] == ERR_EMAIL, "message is the first field's message"

    edge = (tag + "e" * (EMAIL_MAX - len(tag) - len("@example.test"))) + "@example.test"
    assert len(edge) == EMAIL_MAX
    r = c.post("/api/auth/signup", json={"email": edge, "password": "ten-chars!", "display_name": "d" * NAME_MAX})
    assert r.status_code == 201, f"254-character email, 10-character password and 40-character name are valid: {r.text}"

    email = new_email("owner")
    password = f" spaced {uuid.uuid4().hex[:8]} "
    r = c.post("/api/auth/signup", json={"email": f"  {email.upper()}  ", "password": password,
                                         "display_name": f"  {PROBE_DISPLAY}  "})
    assert r.status_code == 201, r.text
    user = r.json()["user"]
    assert user["email"] == email and user["display_name"] == PROBE_DISPLAY and user["id"]
    raw_cookie = next(h for h in r.headers.get_list("set-cookie") if h.startswith(f"{COOKIE_NAME}="))
    low = raw_cookie.lower()
    assert all(f.lower() in low for f in COOKIE_FLAGS)
    max_age = re.search(r"max-age=(\d+)", low)
    if max_age:
        assert int(max_age.group(1)) == SESSION_DAYS * 86400
    else:
        expires = parsedate_to_datetime(re.search(r"expires=([^;]+)", raw_cookie, re.I).group(1))
        served = parsedate_to_datetime(r.headers["date"])
        assert abs((expires - served) - timedelta(days=SESSION_DAYS)) <= timedelta(days=1)
    cookie = r.cookies.get("ag_session")
    me = httpx.get(f"{app_url}/api/me", headers={"Cookie": f"ag_session={cookie}"}, timeout=HTTP_TIMEOUT)
    assert me.status_code == 200 and me.json()["user"]["id"] == user["id"]

    dup = c.post("/api/auth/signup", json={"email": email.upper(), "password": ok_pw, "display_name": "Other"})
    assert dup.status_code == 409 and err(dup)["code"] == "email_taken" and err(dup)["message"] == ERR_TAKEN

    for body in [{"email": email, "password": "wrong-password-1"}, {"email": email, "password": password.strip()},
                 {"email": new_email("ghost"), "password": password}]:
        bad = c.post("/api/auth/login", json=body)
        assert bad.status_code == 401
        assert err(bad)["code"] == "invalid_credentials" and err(bad)["message"] == ERR_CREDENTIALS
        assert f"{COOKIE_NAME}=" not in "".join(bad.headers.get_list("set-cookie")) or not bad.cookies.get("ag_session")
    good = c.post("/api/auth/login", json={"email": email, "password": password})
    assert good.status_code == 200 and good.json()["user"]["id"] == user["id"]
    login_cookie = good.cookies.get("ag_session")
    assert login_cookie
    out = httpx.post(f"{app_url}/api/auth/logout", headers={"Cookie": f"ag_session={login_cookie}"}, timeout=HTTP_TIMEOUT)
    assert out.status_code == 204
    after = httpx.get(f"{app_url}/api/me", headers={"Cookie": f"ag_session={login_cookie}"}, timeout=HTTP_TIMEOUT)
    assert after.status_code == 401 and err(after)["code"] == "unauthenticated"


def test_wf_onboarding_bad_signup(browser, app_url):
    email, password, display = new_email("booth"), new_password(), new_display("booth")
    with open_app(browser, app_url + "/") as page:
        booth = page.get_by_role("dialog", name="Afterglass", exact=True)
        eventually(page, visible(booth), "the booth dialog")
        booth.get_by_role("link", name="Create account", exact=True).click()
        box_email = page.get_by_role("textbox", name="Email", exact=True)
        box_pw = page.get_by_role("textbox", name="Password", exact=True)
        box_dn = page.get_by_role("textbox", name="Display name", exact=True)
        submit = page.get_by_role("button", name="Create account", exact=True)
        eventually(page, visible(box_email), "the create-account form")
        steps = [("not-an-email", password, display, ERR_EMAIL), (email, "short", display, ERR_PASSWORD),
                 (email, password, "   ", ERR_DISPLAY)]
        for e_val, p_val, d_val, message in steps:
            box_email.fill(e_val)
            box_pw.fill(p_val)
            box_dn.fill(d_val)
            submit.click()
            eventually(page, visible(page.get_by_text(message, exact=True)), f"the field error {message!r}")
        box_dn.fill(display)
        submit.click()
        eventually(page, visible(page.get_by_text(NO_SETS, exact=True)), "the empty workspace 'No sets yet'")
    login = anon(app_url).post("/api/auth/login", json={"email": email, "password": password})
    assert login.status_code == 200 and login.json()["user"]["display_name"] == display

    with open_app(browser, app_url + "/") as page:
        booth = page.get_by_role("dialog", name="Afterglass", exact=True)
        eventually(page, visible(booth), "the booth dialog")
        booth.get_by_role("link", name="Create account", exact=True).click()
        page.get_by_role("textbox", name="Email", exact=True).fill(email.upper())
        page.get_by_role("textbox", name="Password", exact=True).fill(new_password())
        page.get_by_role("textbox", name="Display name", exact=True).fill("Second")
        page.get_by_role("button", name="Create account", exact=True).click()
        eventually(page, visible(page.get_by_text(ERR_TAKEN, exact=True)), "the duplicate-email error")
    with open_app(browser, app_url + "/") as page:
        booth = page.get_by_role("dialog", name="Afterglass", exact=True)
        eventually(page, visible(booth), "the booth dialog")
        booth.get_by_role("link", name="Sign in", exact=True).click()
        page.get_by_role("textbox", name="Email", exact=True).fill(email)
        page.get_by_role("textbox", name="Password", exact=True).fill("wrong-password-1")
        page.get_by_role("button", name="Sign in", exact=True).click()
        eventually(page, visible(page.get_by_text(ERR_CREDENTIALS, exact=True)), "the credential error")


def test_wf_onboarding_happy(browser, app_url):
    email, password, display = new_email("first"), new_password(), new_display("first")
    set_name = f"Rehearsal {uuid.uuid4().hex[:6]}"
    with open_app(browser, app_url + "/") as page:
        booth = page.get_by_role("dialog", name="Afterglass", exact=True)
        eventually(page, visible(booth), "the booth dialog")
        booth.get_by_role("link", name="Create account", exact=True).click()
        page.get_by_role("textbox", name="Email", exact=True).fill(email)
        page.get_by_role("textbox", name="Password", exact=True).fill(password)
        page.get_by_role("textbox", name="Display name", exact=True).fill(display)
        page.get_by_role("button", name="Create account", exact=True).click()
        eventually(page, visible(page.get_by_text(NO_SETS, exact=True)), "'No sets yet' in the new workspace")
        user = session_user(page, app_url, email, password, display)
        assert user.c.get("/api/sets").json()["sets"] == []
        page.get_by_role("button", name="New set", exact=True).click()
        dialog = page.get_by_role("dialog", name="New set", exact=True)
        eventually(page, visible(dialog), "the New set dialog")
        dialog.get_by_role("textbox", name="Set name", exact=True).fill(set_name)
        dialog.get_by_role("radio", name="Blank stage", exact=True).check()
        dialog.get_by_role("button", name="Create set", exact=True).click()
        eventually(page, visible(tree(page)), "the layer tree")
        for name in ["Stage", "Main camera", "Key light", "Floor"]:
            reveal(page, name)
        sets = user.c.get("/api/sets").json()["sets"]
        mine = [s for s in sets if s["name"] == set_name]
        assert len(mine) == 1 and mine[0]["role"] == "owner" and mine[0]["bpm"] == BPM_DEFAULT
        assert mine[0]["head"] == 0 and mine[0]["live_number"] is None
        sid = mine[0]["id"]
        doc = doc_of(user, sid)
        s = doc["set"]
        assert s["settings_version"] == 1 and s["graph_version"] == 1 and s["head"] == 0
        stage_l, cam, light, floor = (by_name(doc, n) for n in ["Stage", "Main camera", "Key light", "Floor"])
        assert stage_l["kind"] == "group" and stage_l["parent_id"] is None and stage_l["index"] == 0
        assert stage_l["position"] == [0, 0, 0] and stage_l["output_buses"] == []
        assert cam["kind"] == "camera" and cam["parent_id"] == stage_l["id"] and cam["index"] == 0
        assert cam["position"] == [0, 2, 8] and cam["props"]["fov"] == 50
        assert cam["props"]["near"] == pytest.approx(0.1) and cam["props"]["far"] == 200 and cam["output_buses"] == []
        assert light["kind"] == "light" and light["index"] == 1 and light["position"] == [4, 6, 4]
        assert light["props"]["intensity"] == 1 and light["output_buses"] == []
        assert floor["kind"] == "plane" and floor["index"] == 2 and floor["scale"] == [10, 1, 10]
        assert floor["output_buses"] == ["main"] and floor["material"]["tint"] == [1, 1, 1]
        assert floor["material"]["tint_alpha"] == 1
        assert all(lay["version"] == 1 for lay in doc["layers"]) and len(doc["layers"]) == 4
        assert s["active_camera_id"] == cam["id"]
        assert len(doc["graph"]["nodes"]) == 1 and doc["graph"]["wires"] == []
        assert doc["keys"] == [] and doc["scripts"] == [] and assets_of(user, sid) == []

        add_from_menu(page, "Cube")
        eventually(page, lambda: len(doc_of(user, sid)["layers"]) == 5, "the Add > Cube layer committed")
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "Autosave announces 'Saved'")
        cube = [lay for lay in doc_of(user, sid)["layers"] if lay["kind"] == "cube"]
        assert len(cube) == 1 and cube[0]["output_buses"] == ["main"]
        ops = ops_of(user, sid)
        assert [o["seq"] for o in ops] == [1] and ops[0]["type"] == "layer.add"


def test_wf_onboarding_keyboard(browser, app_url):
    email, password, display = new_email("keys"), new_password(), new_display("keys")
    set_name = f"Keyboard {uuid.uuid4().hex[:6]}"
    with open_app(browser, app_url + "/") as page:
        eventually(page, visible(page.get_by_role("dialog", name="Afterglass", exact=True)), "the booth dialog")
        focus_by_tab(page, "Create account", role="link")
        page.keyboard.press("Enter")
        eventually(page, visible(page.get_by_role("textbox", name="Email", exact=True)), "the create-account form")
        for label, value in [("Email", email), ("Password", password), ("Display name", display)]:
            focus_by_tab(page, label, role="textbox")
            page.keyboard.type(value)
        focus_by_tab(page, "Create account", role="button")
        page.keyboard.press("Enter")
        eventually(page, visible(page.get_by_text(NO_SETS, exact=True)), "the empty workspace")
        user = session_user(page, app_url, email, password, display)

        opener = page.get_by_role("button", name="New set", exact=True)
        focus_by_tab(page, "New set", role="button")
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New set", exact=True)
        eventually(page, visible(dialog), "the New set dialog")
        eventually(page, lambda: holds_focus(dialog), "focus moves into the New set dialog")
        page.keyboard.press("Escape")
        eventually(page, gone(dialog), "Escape closes the New set dialog")
        eventually(page, lambda: is_focused(opener), "focus returns to New set")

        page.keyboard.press("Enter")
        eventually(page, visible(dialog), "the New set dialog reopens")
        eventually(page, lambda: holds_focus(dialog), "focus inside the dialog")
        for key in ["Shift+Tab"] * 6 + ["Tab"] * 8:
            page.keyboard.press(key)
            assert holds_focus(dialog), f"{key} keeps focus inside the New set dialog"
        focus_by_tab(page, "Set name", role="textbox", limit=12)
        page.keyboard.type(set_name)
        focus_by_tab(page, "Blank stage", role="radio", limit=12)
        page.keyboard.press("Space")
        focus_by_tab(page, "Create set", role="button", limit=12)
        page.keyboard.press("Enter")
        eventually(page, visible(row(page, "Stage")), "the Blank stage tree")
        sets = [s for s in user.c.get("/api/sets").json()["sets"] if s["name"] == set_name]
        assert len(sets) == 1, "exactly one set was created from the keyboard"
        assert {lay["name"] for lay in doc_of(user, sets[0]["id"])["layers"]} == {"Stage", "Main camera", "Key light", "Floor"}


def test_public_demo(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method != "GET" and "/api/sets" in r.url else None)
        booth = page.get_by_role("dialog", name="Afterglass", exact=True)
        eventually(page, visible(booth), "the booth dialog")
        body = text(booth)
        assert "Afterglass" in body and BOOTH_BODY in body
        assert booth.get_by_role("link", name="Sign in", exact=True).count() == 1
        assert booth.get_by_role("link", name="Create account", exact=True).count() == 1
        assert page.get_by_role("menubar", name="Set menu", exact=True).count() == 1
        for name in ["Tunnel", "Cube field", "Demo camera"]:
            assert row(page, name).count() == 1, f"demo layer {name!r} in the tree"
        booth.get_by_role("button", name="Close", exact=True).click()
        eventually(page, gone(booth), "Close dismisses the booth dialog")
        eventually(page, lambda: frames(page) >= 1, "the demo stage draws")
        before = frames(page)
        advance(page, IDLE_WINDOW_MS)
        assert frames(page) == before, "paused demo draws nothing while idle"
        play = transport(page, "Play")
        play.click()
        eventually(page, lambda: play.get_attribute("aria-pressed") == "true", "Play is pressed")
        start = frames(page)
        advance(page, 1000)
        assert frames(page) > start, "playing advances data-frame"
        shots = scene_frames(stage(page), steps=4, step_ms=500)
        assert all(s["draws"] > 0 for s in shots), "real WebGL draw calls while playing"
        changed(decode(shots[0]["png"]), decode(shots[-1]["png"]))
        transport(page, "Pause").click()
        eventually(page, lambda: play.get_attribute("aria-pressed") != "true", "Pause releases Play")
        select_layer(page, "Tunnel")
        twist = field(page, "Shape", "Twist")
        assert value_of(twist) == pytest.approx(0.35)
        assert value_of(field(page, "Shape", "Radius")) == pytest.approx(2)
        twist.focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        eventually(page, lambda: value_of(spin(page, "Twist").first) == pytest.approx(0.45), "demo Twist steps to 0.45")
        select_layer(page, "Demo camera")
        assert value_of(field(page, "Camera", "Field of view")) == pytest.approx(60)
        advance(page, IDLE_COMMIT_MS + 500)
        assert posts == [], f"demo edits are never saved: {posts}"


def test_op_log_gapless(app_url):
    owner = signup(app_url, "oplog")
    doc = create_set(owner)
    sid = doc["set"]["id"]
    assert doc["set"]["head"] == 0
    floor = by_name(doc, "Floor")
    r1 = commit(owner, sid, floor["id"], "layer.set", {"path": "position.x", "value": 1.5}, base=1)
    assert (r1["seq"], r1["target"], r1["version"], r1["replayed"]) == (1, floor["id"], 2, False)
    r2 = commit(owner, sid, "set", "set.update", {"name": f"Renamed {uuid.uuid4().hex[:4]}"}, base=1)
    assert (r2["seq"], r2["version"]) == (2, 2)
    r3 = commit(owner, sid, floor["id"], "key.set", {"property": "position.x", "tick": 0, "value": 1.5}, base=2)
    assert (r3["seq"], r3["version"]) == (3, 3)
    assert send_op(owner, sid, floor["id"], "layer.set", {"path": "position.x", "value": 9}, base=1).status_code == 409
    assert send_op(owner, sid, floor["id"], "layer.set", {"path": "scale.x", "value": 0}, base=3).status_code == 422
    assert doc_of(owner, sid)["set"]["head"] == 3, "refused ops consume no sequence number"
    r4 = commit(owner, sid, floor["id"], "layer.set", {"path": "position.z", "value": -2}, base=3)
    assert r4["seq"] == 4 and r4["version"] == 4

    def add(i: int) -> httpx.Response:
        return send_op(None, sid, new_id(), "layer.add",
                       {"parent_id": None, "index": 1, "name": f"Racer {i}", "kind": "cube"}, client=owner.api())

    adds = together(OP_RACERS, add)
    assert all(r.status_code == 200 for r in adds), [r.text for r in adds]
    assert sorted(r.json()["seq"] for r in adds) == list(range(5, 5 + OP_RACERS))

    def stale(i: int) -> httpx.Response:
        return send_op(None, sid, floor["id"], "layer.set", {"path": "position.y", "value": float(i)},
                       base=4, client=owner.api())

    race = together(LOCK_RACERS, stale)
    winners = [r for r in race if r.status_code == 200]
    assert len(winners) == 1, f"exactly one write on base 4 wins: {[r.status_code for r in race]}"
    assert all(r.status_code == 409 and err(r)["code"] == "stale_version" for r in race if r.status_code != 200)
    head = 5 + OP_RACERS
    assert winners[0].json()["seq"] == head

    r = owner.c.get(f"/api/sets/{sid}/ops?after=0")
    assert r.status_code == 200
    body = r.json()
    assert body["head"] == head and [o["seq"] for o in body["ops"]] == list(range(1, head + 1))
    for o in body["ops"]:
        assert o["actor"]["user_id"] == owner.id and o["actor"]["display_name"] == owner.display_name
        assert o["client_op_id"] and o["type"] and isinstance(o["payload"], dict) and iso(o["committed_at"])
    assert body["ops"][0]["payload"] == {"path": "position.x", "value": 1.5}
    page_two = owner.c.get(f"/api/sets/{sid}/ops?after=2&limit=2").json()
    assert [o["seq"] for o in page_two["ops"]] == [3, 4]
    bad = owner.c.get(f"/api/sets/{sid}/ops?after=abc")
    assert bad.status_code == 422 and "after" in err(bad)["fields"]
    final = doc_of(owner, sid)
    assert final["set"]["head"] == head and by_id(final, floor["id"])["version"] == 5


def test_wf_stage_building_gizmos(browser, app_url):
    owner = signup(app_url, "gizmo")
    set_name = f"Gizmo {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    with editor(browser, owner, set_name) as page:
        add_from_menu(page, "Cube")
        eventually(page, lambda: any(lay["kind"] == "cube" for lay in doc_of(owner, sid)["layers"]), "a cube layer")
        cube = next(lay for lay in doc_of(owner, sid)["layers"] if lay["kind"] == "cube")
        select_layer(page, cube["name"])
        for name in ["Grid snap", "Angle snap"]:
            toggle = page.get_by_role("toolbar", name="Snapping", exact=True).get_by_role("button", name=name, exact=True)
            if toggle.get_attribute("aria-pressed") != "true":
                toggle.click()
            eventually(page, lambda t=toggle: t.get_attribute("aria-pressed") == "true", f"{name} on")
        gizmos = page.get_by_role("toolbar", name="Gizmos", exact=True)

        def one_drag(mode: str, axis: str, distance: float) -> dict:
            head = doc_of(owner, sid)["set"]["head"]
            gizmos.get_by_role("radio", name=mode, exact=True).click()
            drag_grip(page, axis, distance)
            eventually(page, lambda: doc_of(owner, sid)["set"]["head"] == head + 1, f"{mode} release commits")
            advance(page, IDLE_COMMIT_MS + 500)
            assert doc_of(owner, sid)["set"]["head"] == head + 1, f"one {mode} drag is exactly one op"
            return by_id(doc_of(owner, sid), cube["id"])

        moved = one_drag("Move", "x", GIZMO_DRAG_PX)
        px = moved["position"][0]
        assert px != 0 and (px * 2) == pytest.approx(round(px * 2)), f"grid snap lands on 0.5 steps: {px}"
        assert abs(px) <= 1.5 and moved["position"][1:] == cube["position"][1:]
        rotated = one_drag("Rotate", "y", ROTATE_DRAG_PX)
        ry = rotated["rotation"][1]
        assert abs(ry) in (30, 45) and (ry / 15) == pytest.approx(round(ry / 15)), f"angle snap 15 degrees: {ry}"
        scaled = one_drag("Scale", "z", SCALE_DRAG_PX)
        assert scaled["scale"][2] == pytest.approx(1 + SCALE_DRAG_PX * 0.01, abs=0.03)
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "Autosave 'Saved'")
        reload_set(page, set_name)
        select_layer(page, cube["name"])
        assert value_of(field(page, "Transform", "Position X")) == pytest.approx(px, abs=0.005)
        assert value_of(spin(page, "Rotation Y").first) == pytest.approx(ry, abs=0.005)
        assert value_of(spin(page, "Scale Z").first) == pytest.approx(scaled["scale"][2], abs=0.005)


def test_wf_stage_building_keyboard_tree(browser, app_url):
    owner = signup(app_url, "treekeys")
    set_name = f"Tree {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    box_name = f"Box {uuid.uuid4().hex[:4]}"
    box = add_layer(owner, sid, box_name, "cube")
    stage_id = by_name(doc_of(owner, sid), "Stage")["id"]
    with editor(browser, owner, set_name) as page:
        heading = lambda n: page.get_by_role("region", name="Inspector", exact=True).get_by_role(
            "heading", level=2, name=n, exact=True)

        def at(name: str) -> None:
            r = row(page, name)
            eventually(page, lambda: r.first.get_attribute("aria-selected") == "true" and is_focused(r),
                       f"focus and selection on {name!r}")
            eventually(page, visible(heading(name)), f"inspector titled {name!r}")

        reveal(page, "Stage").click()
        at("Stage")
        stage_row = row(page, "Stage").first
        if stage_row.get_attribute("aria-expanded") == "false":
            page.keyboard.press("ArrowRight")
        eventually(page, lambda: stage_row.get_attribute("aria-expanded") == "true", "Right opens Stage")
        page.keyboard.press("ArrowRight")
        at("Main camera")
        page.keyboard.press("ArrowDown")
        at("Key light")
        page.keyboard.press("ArrowLeft")
        at("Stage")
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: stage_row.get_attribute("aria-expanded") == "false", "Left closes Stage")
        eventually(page, gone(row(page, "Main camera")), "children hide when Stage collapses")
        page.keyboard.press("End")
        at(box_name)
        page.keyboard.press("Home")
        at("Stage")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: stage_row.get_attribute("aria-expanded") == "true", "Stage reopens")
        page.keyboard.press("End")
        at(box_name)
        page.keyboard.press("Alt+ArrowRight")
        eventually(page, lambda: by_id(doc_of(owner, sid), box)["parent_id"] == stage_id,
                   "Alt+Right makes Box a child of Stage")
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "Autosave 'Saved'")
        reveal(page, box_name).focus()
        page.keyboard.press("Alt+ArrowLeft")
        eventually(page, lambda: by_id(doc_of(owner, sid), box)["parent_id"] is None, "Alt+Left moves Box out")
        index = by_id(doc_of(owner, sid), box)["index"]
        reveal(page, box_name).focus()
        page.keyboard.press("Alt+ArrowUp" if index > 0 else "Alt+ArrowDown")
        expected = index - 1 if index > 0 else 1
        eventually(page, lambda: by_id(doc_of(owner, sid), box)["index"] == expected, "Alt+Up/Down reorders siblings")
        tops = sorted(lay["index"] for lay in doc_of(owner, sid)["layers"] if lay["parent_id"] is None)
        assert tops == list(range(len(tops)))


def test_layer_parenting(app_url):
    owner = signup(app_url, "parent")
    sid = create_set(owner)["set"]["id"]
    g = add_layer(owner, sid, "Rig A", "group")
    a = add_layer(owner, sid, "Box A", "cube")
    b = add_layer(owner, sid, "Box B", "cube")
    put_key(owner, sid, a, "position.x", 0, 1.0)
    before = doc_of(owner, sid)
    av = by_id(before, a)["version"]
    commit(owner, sid, a, "layer.reparent", {"parent_id": g, "index": 0}, base=av)
    d = doc_of(owner, sid)
    assert by_id(d, a)["parent_id"] == g and by_id(d, a)["index"] == 0 and by_id(d, a)["version"] == av + 1
    assert by_id(d, b)["index"] == 2 and by_id(d, b)["version"] == 1 and by_id(d, g)["version"] == 1
    head = d["set"]["head"]
    for target, parent in [(g, a), (g, g)]:
        r = send_op(owner, sid, target, "layer.reparent", {"parent_id": parent, "index": 0},
                    base=by_id(d, target)["version"])
        assert r.status_code == 422 and err(r)["fields"]["parent_id"] == ANCESTOR_MSG
    for index in [3, -1]:
        r = send_op(owner, sid, b, "layer.reparent", {"parent_id": None, "index": index}, base=by_id(d, b)["version"])
        assert r.status_code == 422 and "index" in err(r)["fields"]
    after = doc_of(owner, sid)
    assert after["set"]["head"] == head and by_id(after, g)["parent_id"] is None
    commit(owner, sid, b, "layer.reparent", {"parent_id": g, "index": 0}, base=by_id(after, b)["version"])
    d2 = doc_of(owner, sid)
    assert by_id(d2, b)["index"] == 0 and by_id(d2, a)["index"] == 1 and by_id(d2, a)["version"] == av + 1
    tops = sorted(lay["index"] for lay in d2["layers"] if lay["parent_id"] is None)
    assert tops == [0, 1]
    commit(owner, sid, g, "layer.remove", {}, base=by_id(d2, g)["version"])
    d3 = doc_of(owner, sid)
    assert {a, b, g}.isdisjoint({lay["id"] for lay in d3["layers"]})
    assert all(k["layer_id"] != a for k in d3["keys"])


def test_cameras_active_camera(browser, app_url):
    owner = signup(app_url, "camera")
    set_name = f"Cams {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    cam2 = add_layer(owner, sid, "Side camera", "camera")
    d = doc_of(owner, sid)
    c2 = by_id(d, cam2)
    assert c2["props"]["fov"] == 50 and c2["props"]["near"] == pytest.approx(0.1) and c2["props"]["far"] == 200
    for path, value, ok in [("props.fov", FOV_MIN - 0.01, False), ("props.fov", FOV_MAX + 0.01, False),
                            ("props.fov", FOV_MIN, True), ("props.fov", FOV_MAX, True),
                            ("props.near", 0.009, False), ("props.near", 10, True), ("props.far", 10, False),
                            ("props.far", FAR_MAX, True), ("props.far", FAR_MAX + 0.5, False)]:
        cur = by_id(doc_of(owner, sid), cam2)
        r = send_op(owner, sid, cam2, "layer.set", {"path": path, "value": value}, base=cur["version"])
        assert (r.status_code == 200) == ok, f"{path}={value} -> {r.status_code}"
        if not ok:
            assert r.status_code == 422
    set_layer(owner, sid, cam2, "props.near", 0.1)
    set_layer(owner, sid, cam2, "props.fov", 50)
    set_layer(owner, sid, cam2, "position", [0, 20, 0])
    set_layer(owner, sid, cam2, "rotation", [-90, 0, 0])
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    sv = doc_of(owner, sid)["set"]["settings_version"]
    assert send_op(owner, sid, "set", "set.update", {"active_camera_id": floor}, base=sv).status_code == 422
    main = by_name(doc_of(owner, sid), "Main camera")["id"]
    with editor(browser, owner, set_name) as page:
        before = decode(capture(stage(page)))
        select(page.get_by_role("combobox", name="Stage camera", exact=True), "Side camera")
        eventually(page, lambda: doc_of(owner, sid)["set"]["active_camera_id"] == cam2, "active camera becomes Side camera")
        advance(page, 200)
        changed(before, decode(capture(stage(page))))
    commit(owner, sid, cam2, "layer.remove", {}, base=by_id(doc_of(owner, sid), cam2)["version"])
    assert doc_of(owner, sid)["set"]["active_camera_id"] == main, "the first remaining camera becomes active"


def test_asset_upload_confirmed(app_url, browser):
    owner = signup(app_url, "upload")
    sid = create_set(owner)["set"]["id"]
    bucket = S3()
    png = make_png(uuid.uuid4().hex)
    asset = upload_ready(owner, sid, "texture", "rings.png", png, "image/png")
    assert asset["size"] == len(png) and asset["sha256"] == sha(png)
    assert asset["dependents"] == {"count": 0, "layers": [], "materials": [], "scripts": []}
    assert f"sets/{sid}/assets/{asset['id']}" in bucket.keys(f"sets/{sid}/assets/")
    keys_before = set(bucket.keys(f"sets/{sid}/assets/"))
    for kind, data, mime, field_name in [("model", png, "image/png", "file"), ("texture", b"GIF89a" + b"\0" * 20, "image/gif", "file"),
                                         ("video", png, "image/png", "kind")]:
        r = upload(owner, sid, kind, "bad.bin", data, mime)
        assert r.status_code == 422 and field_name in err(r)["fields"], r.text
    assert set(bucket.keys(f"sets/{sid}/assets/")) == keys_before
    assert [a["id"] for a in assets_of(owner, sid)] == [asset["id"]]

    down = outage_url("APP_MINIO_DOWN_URL")
    r = upload(owner, sid, "texture", "lost.png", make_png("lost"), "image/png", base=down)
    assert r.status_code == 503 and err(r)["code"] == "storage_unavailable"
    failed = extra(r, "asset")
    assert failed["status"] == "upload failed"
    listed = asset_of(owner, sid, failed["id"])
    assert listed and listed["status"] == "upload failed" and listed["dependents"]["count"] == 0
    assert f"sets/{sid}/assets/{failed['id']}" not in bucket.keys(f"sets/{sid}/assets/")
    floor = by_name(doc_of(owner, sid), "Floor")
    bind = send_op(owner, sid, floor["id"], "layer.set", {"path": "material.albedo_texture_id", "value": failed["id"]},
                   base=floor["version"])
    assert bind.status_code == 422 and "value" in err(bind)["fields"]
    content = owner.c.get(f"/api/assets/{failed['id']}/content")
    assert content.status_code == 409 and err(content)["code"] == "asset_not_ready"


def test_asset_bytes_exact(app_url):
    owner = signup(app_url, "bytes")
    sid = create_set(owner)["set"]["id"]
    outsider = signup(app_url, "outsider")
    bucket = S3()
    for kind, name, data, mime in [("model", "ring.glb", make_glb(uuid.uuid4().hex), "model/gltf-binary"),
                                   ("texture", "skin.png", make_png(uuid.uuid4().hex), "image/png"),
                                   ("texture", "grain.jpg", make_jpeg(uuid.uuid4().hex), "image/jpeg")]:
        asset = upload_ready(owner, sid, kind, name, data, mime)
        assert asset["sha256"] == sha(data) and asset["size"] == len(data)
        assert bucket.get(f"sets/{sid}/assets/{asset['id']}") == data
        r = owner.c.get(f"/api/assets/{asset['id']}/content")
        assert r.status_code == 200 and r.content == data
        assert r.headers["content-type"].split(";")[0] == mime
        assert r.headers["x-content-sha256"] == sha(data)
        assert outsider.c.get(f"/api/assets/{asset['id']}/content").status_code == 404


def test_asset_dependents_count(app_url):
    owner = signup(app_url, "deps")
    sid = create_set(owner)["set"]["id"]
    model = upload_ready(owner, sid, "model", "hull.glb", make_glb(uuid.uuid4().hex), "model/gltf-binary")
    tex = upload_ready(owner, sid, "texture", "skin.png", make_png(uuid.uuid4().hex), "image/png")

    def deps(aid: str) -> dict:
        found = asset_of(owner, sid, aid)
        assert found
        return found["dependents"]

    group = add_layer(owner, sid, "Hull rig", "group")
    hull = add_layer(owner, sid, "Hull", "model", parent_id=group)
    set_layer(owner, sid, hull, "model_asset_id", model["id"])
    d = deps(model["id"])
    assert d["count"] == 1 and d["layers"] == [{"id": hull, "name": "Hull"}]
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    wrong = send_op(owner, sid, floor, "layer.set", {"path": "material.albedo_texture_id", "value": model["id"]},
                    base=by_id(doc_of(owner, sid), floor)["version"])
    assert wrong.status_code == 422 and "value" in err(wrong)["fields"]
    set_layer(owner, sid, floor, "material.albedo_texture_id", tex["id"])
    set_layer(owner, sid, floor, "material.emissive_texture_id", tex["id"])
    assert deps(tex["id"])["count"] == 1, "one material counts once for both slots"
    cube = add_layer(owner, sid, "Cube skin", "cube")
    set_layer(owner, sid, cube, "material.albedo_texture_id", tex["id"])
    script = add_script(owner, sid, "Skin script", EMPTY_SCRIPT)
    commit(owner, sid, script, "script.save", {"source": EMPTY_SCRIPT, "asset_ids": [tex["id"]]}, base=1)
    d = deps(tex["id"])
    assert d["count"] == 3
    assert sorted(m["layer_id"] for m in d["materials"]) == sorted([floor, cube])
    assert d["scripts"] == [{"id": script, "name": "Skin script"}]
    bad = send_op(owner, sid, script, "script.save", {"source": SCRIPT_X, "asset_ids": [model["id"]]}, base=2)
    assert bad.status_code == 422 and "asset_ids" in err(bad)["fields"]
    assert script_of(owner, sid, script)["source"] == EMPTY_SCRIPT, "nothing in the refused save applied"
    commit(owner, sid, cube, "layer.remove", {}, base=by_id(doc_of(owner, sid), cube)["version"])
    assert deps(tex["id"])["count"] == 2
    commit(owner, sid, script, "script.remove", {}, base=script_of(owner, sid, script)["version"])
    assert deps(tex["id"])["count"] == 1 and deps(tex["id"])["scripts"] == []
    set_layer(owner, sid, floor, "material.albedo_texture_id", None)
    assert deps(tex["id"])["count"] == 1
    set_layer(owner, sid, floor, "material.emissive_texture_id", None)
    assert deps(tex["id"])["count"] == 0
    commit(owner, sid, group, "layer.remove", {}, base=by_id(doc_of(owner, sid), group)["version"])
    assert deps(model["id"])["count"] == 0, "removing a parent removes its model dependent"


def test_guarded_asset_delete(app_url):
    owner = signup(app_url, "delete")
    sid = create_set(owner)["set"]["id"]
    bucket = S3()
    used = upload_ready(owner, sid, "texture", "used.png", make_png(uuid.uuid4().hex), "image/png")
    shown = upload_ready(owner, sid, "texture", "shown.png", make_png(uuid.uuid4().hex), "image/png")
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    set_layer(owner, sid, floor, "material.albedo_texture_id", used["id"])
    set_layer(owner, sid, floor, "material.emissive_texture_id", shown["id"])
    assert publish(owner, sid).status_code == 201
    assert publish(owner, sid).status_code == 201
    set_layer(owner, sid, floor, "material.emissive_texture_id", None)
    r = owner.c.delete(f"/api/sets/{sid}/assets/{used['id']}")
    assert r.status_code == 409 and err(r)["code"] == "asset_in_use"
    assert r.json()["error"]["dependents"]["materials"][0]["layer_id"] == floor
    r = owner.c.delete(f"/api/sets/{sid}/assets/{shown['id']}")
    assert r.status_code == 409 and err(r)["code"] == "asset_in_shows"
    assert r.json()["error"]["show_versions"] == [1, 2]
    for kept in (used, shown):
        assert asset_of(owner, sid, kept["id"]) is not None
        assert bucket.get(f"sets/{sid}/assets/{kept['id']}")
    spare = upload_ready(owner, sid, "texture", "spare.png", make_png(uuid.uuid4().hex), "image/png")
    assert owner.c.delete(f"/api/sets/{sid}/assets/{spare['id']}").status_code == 204
    assert asset_of(owner, sid, spare["id"]) is None
    assert f"sets/{sid}/assets/{spare['id']}" not in bucket.keys(f"sets/{sid}/assets/")
    assert owner.c.get(f"/api/assets/{spare['id']}/content").status_code == 404
    down = outage_url("APP_MINIO_DOWN_URL")
    failed = extra(upload(owner, sid, "texture", "lost.png", make_png("lost"), "image/png", base=down), "asset")
    assert owner.c.delete(f"/api/sets/{sid}/assets/{failed['id']}").status_code == 204
    assert asset_of(owner, sid, failed["id"]) is None


def test_wf_assets_bind(browser, app_url):
    owner = signup(app_url, "bind")
    set_name = f"Bind {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    glb, png = make_glb(uuid.uuid4().hex), make_png(uuid.uuid4().hex)
    with editor(browser, owner, set_name) as page:
        fetched: list[str] = []
        page.on("request", lambda r: fetched.append(r.url))
        tile(page, "Assets")
        picker = page.get_by_label("Choose GLB or texture file")
        for name, data, mime in [("hull.glb", glb, "model/gltf-binary"), ("rings.png", png, "image/png")]:
            picker.set_input_files(files={"name": name, "mimeType": mime, "buffer": data})
            eventually(page, lambda d=data: any(a["sha256"] == sha(d) and a["status"] == "ready"
                                                for a in assets_of(owner, sid)), f"{name} ready")
            asset = next(a for a in assets_of(owner, sid) if a["sha256"] == sha(data))
            eventually(page, text_is(status(page, "Asset upload"), f"{asset['name']} is ready"), f"'{asset['name']} is ready'")
            item = page.get_by_role("list", name="Asset shelf", exact=True).get_by_role("listitem").filter(has_text=asset["name"])
            eventually(page, lambda i=item: "ready" in text(i), f"shelf row for {asset['name']} reads ready")
        model = next(a for a in assets_of(owner, sid) if a["sha256"] == sha(glb))
        texture = next(a for a in assets_of(owner, sid) if a["sha256"] == sha(png))
        tile(page, "Layers")
        add_from_menu(page, "Model")
        eventually(page, lambda: any(lay["kind"] == "model" for lay in doc_of(owner, sid)["layers"]), "a model layer")
        hull = next(lay for lay in doc_of(owner, sid)["layers"] if lay["kind"] == "model")
        select_layer(page, hull["name"])
        drawer(page, "Model")
        select(page.get_by_role("combobox", name="Model asset", exact=True), model["name"])
        eventually(page, lambda: by_id(doc_of(owner, sid), hull["id"])["model_asset_id"] == model["id"], "model bound")
        eventually(page, lambda: any(f"/assets/{model['id']}/content" in u for u in fetched), "the stage fetches the GLB")
        select_layer(page, "Floor")
        drawer(page, "Material")
        page.get_by_role("button", name=f"{BROWSE} Albedo", exact=True).click()
        chooser = page.get_by_role("dialog", name="Choose texture", exact=True)
        eventually(page, visible(chooser), "the Choose texture dialog")
        chooser.get_by_role("listbox", name="Textures", exact=True).get_by_role("option", name=texture["name"], exact=True).click()
        chooser.get_by_role("button", name="Use texture", exact=True).click()
        floor_id = by_name(doc_of(owner, sid), "Floor")["id"]
        eventually(page, lambda: by_id(doc_of(owner, sid), floor_id)["material"]["albedo_texture_id"] == texture["id"],
                   "albedo bound")
        slot = page.get_by_role("group", name="Albedo texture", exact=True)
        eventually(page, lambda: texture["name"] in text(slot), "the slot shows the texture name")
        tile(page, "Assets")
        shelf = page.get_by_role("list", name="Asset shelf", exact=True)
        for asset in (model, texture):
            item = shelf.get_by_role("listitem").filter(has_text=asset["name"])
            eventually(page, lambda i=item: "1 dependents" in text(i), f"{asset['name']} shows '1 dependents'")
            assert asset_of(owner, sid, asset["id"])["dependents"]["count"] == 1


def test_wf_assets_in_use_dialog(browser, app_url):
    owner = signup(app_url, "inuse")
    set_name = f"InUse {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    used = upload_ready(owner, sid, "texture", f"used-{uuid.uuid4().hex[:4]}.png", make_png(uuid.uuid4().hex), "image/png")
    shown = upload_ready(owner, sid, "texture", f"shown-{uuid.uuid4().hex[:4]}.png", make_png(uuid.uuid4().hex), "image/png")
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    set_layer(owner, sid, floor, "material.albedo_texture_id", used["id"])
    set_layer(owner, sid, floor, "material.emissive_texture_id", shown["id"])
    assert publish(owner, sid).status_code == 201 and publish(owner, sid).status_code == 201
    set_layer(owner, sid, floor, "material.emissive_texture_id", None)
    with editor(browser, owner, set_name) as page:
        tile(page, "Assets")
        alert = page.get_by_role("alertdialog", name=ASSET_IN_USE_TITLE, exact=True)
        opener = page.get_by_role("button", name=f"Delete {used['name']}", exact=True)
        opener.click()
        eventually(page, visible(alert), "the Asset still in use dialog")
        body = text(alert)
        assert f"{used['name']} is used by:" in body and "Materials" in body and "Floor" in body
        alert.get_by_role("button", name="OK", exact=True).click()
        eventually(page, gone(alert), "OK closes the dialog")
        page.get_by_role("button", name=f"Delete {shown['name']}", exact=True).click()
        eventually(page, visible(alert), "the dialog for a published asset")
        assert f"{shown['name']} is part of published show versions 1, 2." in text(alert)
        alert.get_by_role("button", name="OK", exact=True).click()
    assert asset_of(owner, sid, used["id"]) and asset_of(owner, sid, shown["id"])


def test_shader_compile_feedback(browser, app_url):
    owner = signup(app_url, "glsl")
    sid, set_name, lid, name = blank_set_with(owner, "shader", f"Glow {uuid.uuid4().hex[:4]}")
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        tab(page, "Shader editor")
        source = page.get_by_role("textbox", name="GLSL source", exact=True)
        eventually(page, visible(source), "the GLSL source editor")
        advance(page, 300)
        before = decode(capture(stage(page)))
        compile_status = status(page, "Shader compile")
        cfill(source.first, BROKEN_SHADER)
        page.get_by_role("button", name="Save shader", exact=True).click()
        eventually(page, lambda: text(compile_status).startswith(f"Line {BROKEN_LINE}: ")
                   and "undefinedThing" in text(compile_status), "'Line 7: <message>' for the first error")
        advance(page, 300)
        broken = decode(capture(stage(page)))
        cfill(source.first, solid_shader(1, 0, 0))
        page.get_by_role("button", name="Save shader", exact=True).click()
        eventually(page, text_is(compile_status, "Compiled"), "'Compiled'")
        advance(page, 300)
        fixed = decode(capture(stage(page)))
        assert difference(before, broken) < difference(before, fixed), "a failed compile keeps the last good program"
    versions = shader_versions(owner, sid, lid)
    assert [v["number"] for v in versions] == [3, 2, 1]
    assert shader_source(owner, sid, lid, 2)["source"] == BROKEN_SHADER, "a shader that does not compile still saves"


def test_shader_versions(app_url):
    owner = signup(app_url, "shaderv")
    sid, _, lid, _ = blank_set_with(owner, "shader", "Glow")
    editor_user = add_member(owner, sid, "editor")
    versions = shader_versions(owner, sid, lid)
    assert len(versions) == 1 and versions[0]["number"] == 1 and versions[0]["restored_from"] is None
    v1 = shader_source(owner, sid, lid, 1)
    assert v1["source"] == STARTER_SHADER and v1["sha256"] == sha(STARTER_SHADER.encode())
    s2, s3 = solid_shader(1, 0, 0), solid_shader(0, 0, 1)
    save_shader(owner, sid, lid, s2)
    cur = by_id(doc_of(owner, sid), lid)
    commit(editor_user, sid, lid, "shader.save", {"source": s3}, base=cur["version"])
    versions = shader_versions(owner, sid, lid)
    assert [v["number"] for v in versions] == [3, 2, 1]
    assert versions[0]["author"] == {"user_id": editor_user.id, "display_name": editor_user.display_name}
    assert versions[1]["author"]["user_id"] == owner.id
    for v, src in zip(versions, [s3, s2, STARTER_SHADER]):
        assert v["sha256"] == sha(src.encode()) and v["size"] == len(src.encode()) and iso(v["created_at"])
        assert v["restored_from"] is None
    assert iso(versions[0]["created_at"]) >= iso(versions[1]["created_at"]) >= iso(versions[2]["created_at"])
    assert owner.c.get(f"/api/sets/{sid}/layers/{lid}/shader/versions/99").status_code == 404


def test_wf_shaders_keyboard_save(browser, app_url):
    owner = signup(app_url, "ctrls")
    sid, set_name, lid, name = blank_set_with(owner, "shader", f"Glow {uuid.uuid4().hex[:4]}")
    script = add_script(owner, sid, "Pulse script", SCRIPT_ONE)
    new_shader, new_script = solid_shader(0, 1, 0), SCRIPT_TWO
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        tab(page, "Shader editor")
        source = page.get_by_role("textbox", name="GLSL source", exact=True).first
        cfill(source, new_shader)
        source.focus()
        page.keyboard.press("ControlOrMeta+s")
        eventually(page, lambda: shader_versions(owner, sid, lid)[0]["number"] == 2, "Ctrl+S saves shader version 2")
        eventually(page, text_is(status(page, "Shader compile"), "Compiled"), "'Compiled' after Ctrl+S")
        tab(page, "Script editor")
        page.get_by_role("list", name="Scripts", exact=True).get_by_text("Pulse script", exact=True).click()
        box = page.get_by_role("textbox", name="Script source", exact=True).first
        cfill(box, new_script)
        box.focus()
        page.keyboard.press("ControlOrMeta+s")
        eventually(page, lambda: script_of(owner, sid, script)["source"] == new_script, "Ctrl+S saves the script")
        advance(page, IDLE_COMMIT_MS + 500)
    assert shader_source(owner, sid, lid, 2)["source"] == new_shader and len(shader_versions(owner, sid, lid)) == 2
    assert script_of(owner, sid, script)["version"] == 2


def test_shader_restore_exact(app_url):
    owner = signup(app_url, "restore")
    sid, _, lid, _ = blank_set_with(owner, "shader", "Glow")
    s2 = "#version 300 es\r\nprecision highp float;\t// caf\u00e9 \u2726  \r\nout vec4 fragColor;\nvoid main() { fragColor = vec4(1.0); }  \n"
    s3 = solid_shader(0, 0, 1)
    save_shader(owner, sid, lid, s2)
    save_shader(owner, sid, lid, s3)
    snapshot = {n: shader_source(owner, sid, lid, n) for n in (1, 2, 3)}
    cur = by_id(doc_of(owner, sid), lid)
    commit(owner, sid, lid, "shader.restore", {"from_version": 2}, base=cur["version"])
    versions = shader_versions(owner, sid, lid)
    assert versions[0]["number"] == 4 and versions[0]["restored_from"] == 2
    v4 = shader_source(owner, sid, lid, 4)
    assert v4["source"] == s2 and v4["sha256"] == sha(s2.encode()) == snapshot[2]["sha256"]
    cur = by_id(doc_of(owner, sid), lid)
    commit(owner, sid, lid, "shader.restore", {"from_version": 1}, base=cur["version"])
    assert shader_source(owner, sid, lid, 5)["source"] == STARTER_SHADER
    for n, before in snapshot.items():
        assert shader_source(owner, sid, lid, n) == before, f"version {n} unchanged"
    assert [v["number"] for v in shader_versions(owner, sid, lid)] == [5, 4, 3, 2, 1]


def test_wf_shaders_journey(browser, app_url):
    owner = signup(app_url, "journey")
    set_name = f"Shaders {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    with editor(browser, owner, set_name) as page:
        add_from_menu(page, "Shader layer")
        eventually(page, lambda: any(lay["kind"] == "shader" for lay in doc_of(owner, sid)["layers"]), "a shader layer")
        layer = next(lay for lay in doc_of(owner, sid)["layers"] if lay["kind"] == "shader")
        select_layer(page, layer["name"])
        tab(page, "Shader editor")
        source = page.get_by_role("textbox", name="GLSL source", exact=True).first
        save = page.get_by_role("button", name="Save shader", exact=True)
        compile_status = status(page, "Shader compile")
        cfill(source, BROKEN_SHADER)
        save.click()
        eventually(page, lambda: text(compile_status).startswith(f"Line {BROKEN_LINE}: "), "the line-numbered error")
        cfill(source, solid_shader(1, 0, 0))
        save.click()
        eventually(page, text_is(compile_status, "Compiled"), "'Compiled' after the fix")
        cfill(source, solid_shader(0, 0, 1))
        save.click()
        eventually(page, lambda: shader_versions(owner, sid, layer["id"])[0]["number"] == 4, "version 4 saved")
        eventually(page, text_is(compile_status, "Compiled"), "'Compiled'")
        advance(page, 300)
        blue = decode(capture(stage(page)))
        history = page.get_by_role("list", name="Shader history", exact=True)
        eventually(page, lambda: "Version 4" in text(history) and owner.display_name in text(history), "history lists version 4")
        history.get_by_role("button", name=f"Restore version {RESTORE_FROM}", exact=True).click()
        eventually(page, lambda: shader_versions(owner, sid, layer["id"])[0]["restored_from"] == 1, "restore commits")
        eventually(page, lambda: "Restored from version 1" in text(history), "history marks the restore")
        advance(page, 300)
        changed(blue, decode(capture(stage(page))))
    top = shader_versions(owner, sid, layer["id"])[0]
    assert top["number"] == 5 and shader_source(owner, sid, layer["id"], 5)["source"] == STARTER_SHADER


def graph_of(user: User, sid: str) -> dict:
    return doc_of(user, sid)["graph"]


def nodes_added(user: User, sid: str, page: Page, titles: list[str]) -> list[dict]:
    known = {node_key(n) for n in graph_of(user, sid)["nodes"]}
    found = []
    for title in titles:
        add_node_ui(page, title)
        eventually(page, lambda: len(graph_of(user, sid)["nodes"]) > len(known) + len(found), f"{title} node committed")
        fresh = [n for n in graph_of(user, sid)["nodes"] if node_key(n) not in known | {node_key(f) for f in found}]
        found.append(fresh[0])
    return found


def wire(user: User, sid: str, a: dict, out: str, b: dict, inp: str) -> httpx.Response:
    return send_op(user, sid, "graph", "graph.wire.add",
                   {"wire_id": new_id(), "from": {"node_id": node_key(a), "port": out},
                    "to": {"node_id": node_key(b), "port": inp}})


def node_params(user: User, sid: str, node: dict, params: dict) -> None:
    commit(user, sid, "graph", "graph.node.update", {"node_id": node_key(node), "params": params},
           base=graph_of(user, sid)["version"])


WIRE_CASES = ["from_input", "to_output", "same_node", "occupied_input", "cycle"]


@pytest.mark.parametrize("case", WIRE_CASES, ids=WIRE_CASES)
def test_graph_wiring_rules(browser, app_url, case):
    owner = signup(app_url, "wires")
    set_name = f"Graph {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    beat = graph_of(owner, sid)["nodes"][0]
    with editor(browser, owner, set_name) as page:
        tab(page, "Node graph")
        lfo, remap = nodes_added(owner, sid, page, ["LFO", "Remap"])
    plan = {
        "from_input": (None, (lfo, "beat", remap, "in"), WIRE_DIRECTION),
        "to_output": (None, (beat, "beat", lfo, "value"), WIRE_DIRECTION),
        "same_node": (None, (lfo, "value", lfo, "beat"), WIRE_DIRECTION),
        "occupied_input": ((beat, "beat", lfo, "beat"), (beat, "phase", lfo, "beat"), WIRE_OCCUPIED),
        "cycle": ((lfo, "value", remap, "in"), (remap, "out", lfo, "beat"), WIRE_LOOP),
    }[case]
    pre, attempt, message = plan
    if pre:
        r = wire(owner, sid, *pre)
        assert r.status_code == 200, f"precondition wire commits: {r.text}"
    before = graph_of(owner, sid)
    head = doc_of(owner, sid)["set"]["head"]
    r = wire(owner, sid, *attempt)
    assert r.status_code == 422, f"{case}: {r.status_code} {r.text}"
    e = err(r)
    assert e["code"] == "validation" and e["fields"]["to"] == message
    after = graph_of(owner, sid)
    assert after["wires"] == before["wires"] and after["version"] == before["version"]
    assert doc_of(owner, sid)["set"]["head"] == head


def test_wf_node_graph_keyboard_wire(browser, app_url):
    owner = signup(app_url, "kwire")
    set_name = f"KWire {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    beat = graph_of(owner, sid)["nodes"][0]
    with editor(browser, owner, set_name) as page:
        tab(page, "Node graph")
        (lfo,) = nodes_added(owner, sid, page, ["LFO"])
        head = doc_of(owner, sid)["set"]["head"]
        page.get_by_role("button", name="Beat clock node", exact=True).focus()
        page.keyboard.press("c")
        dialog = page.get_by_role("dialog", name="Connect wire", exact=True)
        eventually(page, visible(dialog), "the Connect wire dialog")
        from_list = dialog.get_by_role("listbox", name="From port", exact=True)
        to_list = dialog.get_by_role("listbox", name="To port", exact=True)
        eventually(page, lambda: holds_focus(from_list), "focus starts in From port")
        for _ in range(6):
            chosen = from_list.get_by_role("option", selected=True)
            label = text(chosen).lower()
            if chosen.count() and "beat" in label and "phase" not in label:
                break
            page.keyboard.press("ArrowDown")
        else:
            pytest.fail("From port offers the Beat clock 'beat' output")
        page.keyboard.press("Tab")
        eventually(page, lambda: holds_focus(to_list), "Tab moves to To port")
        if to_list.get_by_role("option", selected=True).count() == 0:
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        eventually(page, lambda: len(graph_of(owner, sid)["wires"]) == 1, "the wire commits")
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "Autosave 'Saved'")
        advance(page, IDLE_COMMIT_MS + 500)
    w = graph_of(owner, sid)["wires"][0]
    assert w["from"] == {"node_id": node_key(beat), "port": "beat"}
    assert w["to"] == {"node_id": node_key(lfo), "port": "beat"}
    new_ops = ops_of(owner, sid, after=head)
    assert [o["type"] for o in new_ops] == ["graph.wire.add"], "one keyboard connect is one op"


def test_wf_node_graph_live(browser, app_url):
    owner = signup(app_url, "live")
    set_name = f"Live {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    box = add_layer(owner, sid, "Box", "cube")
    beat = graph_of(owner, sid)["nodes"][0]
    with editor(browser, owner, set_name) as page:
        tab(page, "Node graph")
        lfo, remap, prop = nodes_added(owner, sid, page, ["LFO", "Remap", "Layer property"])
        node_params(owner, sid, lfo, {"shape": "sine", "rate_beats": 1})
        node_params(owner, sid, remap, {"in_min": -1, "in_max": 1, "out_min": -3, "out_max": 3})
        node_params(owner, sid, prop, {"layer_id": box, "property": "position.x"})
        for a, out, b, inp in [(beat, "beat", lfo, "beat"), (lfo, "value", remap, "in")]:
            assert wire(owner, sid, a, out, b, inp).status_code == 200
        reload_set(page, set_name)
        play = transport(page, "Play")
        play.click()
        eventually(page, lambda: play.get_attribute("aria-pressed") == "true", "playing")
        advance(page, 300)
        m1 = camera(page)
        advance(page, 300)
        assert camera(page) == m1, "nothing is driven before the Layer property wire"
        transport(page, "Pause").click()
        assert wire(owner, sid, remap, "out", prop, "value").status_code == 200
        reload_set(page, set_name)
        head = doc_of(owner, sid)["set"]["head"]
        transport(page, "Play").click()
        advance(page, 300)
        m2 = camera(page)
        advance(page, 250)
        m3 = camera(page)
        assert m2 != m3, "the wired chain moves the cube between frames"
        transport(page, "Pause").click()
        advance(page, IDLE_COMMIT_MS + 500)
    assert by_id(doc_of(owner, sid), box)["position"][0] == 0
    assert doc_of(owner, sid)["set"]["head"] == head, "graph values are never committed"


def readout(page: Page) -> str:
    return text(page.get_by_role("timer", name="Playhead position", exact=True))


def test_beat_locked_keys(browser, app_url):
    owner = signup(app_url, "keys")
    sid, set_name, lid, name = blank_set_with(owner)
    for tick, ok in [(TICK_LIMIT, False), (-1, False), (TICK_LIMIT - 1, True)]:
        cur = by_id(doc_of(owner, sid), lid)
        r = send_op(owner, sid, lid, "key.set", {"property": "props.twist", "tick": tick, "value": 0.1}, base=cur["version"])
        assert (r.status_code == 200) == ok and (ok or r.status_code == 422), f"tick {tick}: {r.status_code}"
    cur = by_id(doc_of(owner, sid), lid)
    commit(owner, sid, lid, "key.remove", {"property": "props.twist", "tick": TICK_LIMIT - 1}, base=cur["version"])
    put_key(owner, sid, lid, "props.twist", FAR_KEY_TICK, 0.5)
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        tab(page, "Timeline")
        far = page.get_by_role("button", name=f"Key Twist at {bars_beats(FAR_KEY_TICK)}", exact=True)
        assert bars_beats(FAR_KEY_TICK) == "17:3"
        eventually(page, lambda: far.count() == 1, "the diamond 'Key Twist at 17:3'")
        far.click()
        eventually(page, lambda: readout(page) == "17:3 33.000 s", "readout '17:3 33.000 s'")
        transport(page, "Stop").click()
        eventually(page, lambda: readout(page) == "1:1 0.000 s", "Stop returns to 1:1")
        transport(page, "Step beat").click()
        eventually(page, lambda: readout(page) == "1:2 0.500 s", "Step beat moves one beat")
        drawer(page, "Shape")
        dot = page.get_by_role("button", name=f"Keyframe {KEY_LABEL}", exact=True)
        dot.click()
        eventually(page, lambda: any(k["tick"] == TICKS_PER_BEAT for k in doc_of(owner, sid)["keys"]), "key at tick 96")
        eventually(page, lambda: dot.get_attribute("aria-pressed") == "true", "the dot is pressed at a key")
        assert page.get_by_role("button", name=f"Key {KEY_LABEL} at {bars_beats(TICKS_PER_BEAT)}", exact=True).count() == 1
        transport(page, "Stop").click()
        transport(page, "Play").click()
        advance(page, PLAY_SPAN_MS)
        transport(page, "Pause").click()
        match = re.fullmatch(r"\d+:[\d.]+ (\d+\.\d{3}) s", readout(page))
        assert match, f"readout format '<bar:beat> <seconds> s': {readout(page)!r}"
        raw_ticks = float(match.group(1)) * BPM_DEFAULT / 60 * TICKS_PER_BEAT
        expected = int(raw_ticks / SNAP_TICKS + 0.5) * SNAP_TICKS
        assert expected not in (0, TICKS_PER_BEAT), "the probe lands between existing keys"
        dot.click()
        eventually(page, lambda: any(k["tick"] == expected for k in doc_of(owner, sid)["keys"]),
                   f"key snapped to tick {expected}")
        assert page.get_by_role("button", name=f"Key Twist at {bars_beats(expected)}", exact=True).count() == 1
    ticks = sorted(k["tick"] for k in doc_of(owner, sid)["keys"])
    assert all(t % SNAP_TICKS == 0 for t in ticks)


def test_wf_beat_timeline_bpm_change(browser, app_url):
    owner = signup(app_url, "bpm")
    sid, set_name, lid, name = blank_set_with(owner)
    put_key(owner, sid, lid, "props.twist", FAR_KEY_TICK, 0.5)
    put_key(owner, sid, lid, "props.twist", TICKS_PER_BEAT, 0.2)
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        tab(page, "Timeline")
        bpm = spin(page, "BPM").first
        cfill(bpm, "140")
        page.keyboard.press("Enter")
        eventually(page, lambda: doc_of(owner, sid)["set"]["bpm"] == 140, "BPM 140 committed")
        far = page.get_by_role("button", name=f"Key {KEY_LABEL} at {bars_beats(FAR_KEY_TICK)}", exact=True)
        eventually(page, lambda: far.count() == 1, "the key still at 17:3")
        far.click()
        eventually(page, lambda: readout(page) == f"17:3 {seconds_at(FAR_KEY_TICK, 140)} s", "'17:3 28.286 s'")
        page.get_by_role("button", name=f"Key {KEY_LABEL} at {bars_beats(TICKS_PER_BEAT)}", exact=True).click()
        eventually(page, lambda: readout(page) == f"1:2 {seconds_at(TICKS_PER_BEAT, 140)} s", "'1:2 0.429 s'")
    assert sorted(k["tick"] for k in doc_of(owner, sid)["keys"]) == [TICKS_PER_BEAT, FAR_KEY_TICK]


def test_wf_beat_timeline_scrub_key(browser, app_url):
    owner = signup(app_url, "scrub")
    sid, set_name, lid, name = blank_set_with(owner)
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        twist = field(page, "Shape", "Twist")
        box = twist.bounding_box()
        head = doc_of(owner, sid)["set"]["head"]
        f0 = frames(page)
        drag(page, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2), (1, 0), SCRUB_DRAG_PX, release=False)
        advance(page, 100)
        assert frames(page) > f0, "the stage redraws during the drag"
        assert doc_of(owner, sid)["set"]["head"] == head, "nothing commits before release"
        page.mouse.up()
        eventually(page, lambda: doc_of(owner, sid)["set"]["head"] == head + 1, "release commits")
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "Autosave 'Saved'")
        advance(page, IDLE_COMMIT_MS + 500)
        assert doc_of(owner, sid)["set"]["head"] == head + 1, "one drag is one op"
        value = by_id(doc_of(owner, sid), lid)["props"]["twist"]
        assert value == pytest.approx(SCRUB_DRAG_PX * 0.1, abs=0.15)
        tab(page, "Timeline")
        page.get_by_role("button", name=f"Keyframe {KEY_LABEL}", exact=True).click()
        diamond = page.get_by_role("button", name=f"Key {KEY_LABEL} at {bars_beats(0)}", exact=True)
        eventually(page, lambda: diamond.count() == 1, "the diamond at 1:1")
        assert readout(page) == f"{bars_beats(0)} {seconds_at(0, BPM_DEFAULT)} s"
    keys = doc_of(owner, sid)["keys"]
    assert [(k["property"], k["tick"]) for k in keys] == [("props.twist", 0)]
    assert keys[0]["value"] == pytest.approx(value)


def test_scrub_field_input(browser, app_url):
    owner = signup(app_url, "spin")
    sid, set_name, lid, name = blank_set_with(owner)
    twist_of = lambda: by_id(doc_of(owner, sid), lid)["props"]["twist"]
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        tw = field(page, "Shape", "Twist")
        tw.focus()
        for key in ["ArrowUp"] * 3 + ["Shift+ArrowUp"] * 2:
            page.keyboard.press(key)
        assert value_of(tw) == pytest.approx(0.32)
        page.keyboard.press("Enter")
        eventually(page, lambda: twist_of() == pytest.approx(0.32), "Enter commits 0.32")
        transport(page, "Step beat").focus()
        advance(page, 500)
        head = doc_of(owner, sid)["set"]["head"]
        tw.focus()
        for key in ["ArrowRight", "ArrowRight", "Shift+ArrowLeft"]:
            page.keyboard.press(key)
        assert value_of(tw) == pytest.approx(0.51)
        page.keyboard.press("Escape")
        eventually(page, lambda: value_of(spin(page, "Twist").first) == pytest.approx(0.32), "Escape reverts")
        advance(page, IDLE_COMMIT_MS + 1000)
        assert doc_of(owner, sid)["set"]["head"] == head and twist_of() == pytest.approx(0.32), "Escape commits nothing"
        cfill(tw, "50")
        page.keyboard.press("Enter")
        eventually(page, lambda: twist_of() == pytest.approx(10), "values clamp to Twist's +10 limit")
        cfill(spin(page, "Twist").first, "0")
        page.keyboard.press("Enter")
        eventually(page, lambda: twist_of() == pytest.approx(0), "Twist back to 0")
        box = spin(page, "Twist").first.bounding_box()
        drag(page, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2), (1, 0), SHIFT_DRAG_PX, shift=True)
        eventually(page, lambda: twist_of() == pytest.approx(SHIFT_DRAG_PX * 0.01, abs=0.03), "Shift drag 0.01 per px")
        bpm = spin(page, "BPM").first
        bpm.focus()
        page.keyboard.press("Shift+ArrowUp")
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        eventually(page, lambda: doc_of(owner, sid)["set"]["bpm"] == pytest.approx(120.2), "BPM steps 0.1 even with Shift")
        cfill(spin(page, "BPM").first, "120.25")
        page.keyboard.press("Enter")
        eventually(page, lambda: doc_of(owner, sid)["set"]["bpm"] == pytest.approx(120.3), "120.25 rounds half up to 120.3")
        box = spin(page, "BPM").first.bounding_box()
        drag(page, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2), (1, 0), 10, shift=True)
        eventually(page, lambda: doc_of(owner, sid)["set"]["bpm"] == pytest.approx(121.3, abs=0.11), "BPM drag 0.1 per px with Shift")


def console_lines(page: Page) -> list[str]:
    log = page.get_by_role("log", name="Console", exact=True)
    items = log.get_by_role("listitem")
    if items.count():
        return [flat(t) for t in items.all_text_contents()]
    return [flat(t) for t in (log.first.inner_text() if log.count() else "").splitlines() if t.strip()]


def test_sandboxed_scripts(browser, app_url):
    owner = signup(app_url, "script")
    sid, set_name, box, box_name = blank_set_with(owner, "cube", f"Box {uuid.uuid4().hex[:4]}")
    probe = uuid.uuid4().hex
    add_script(owner, sid, "Pulse script",
               "function onBeat(ctx) {\n  console.log(\"beat\", ctx.beat);\n"
               f"  ctx.set(\"{box_name}\", \"position.y\", ctx.beat % 2 === 0 ? 2 : -2);\n}}\n")
    net_name = f"Net probe {uuid.uuid4().hex[:4]}"
    add_script(owner, sid, net_name, f"function onBeat(ctx) {{ fetch(\"/api/health?probe={probe}\"); }}\n")
    add_script(owner, sid, "Page probe", "function onBeat(ctx) { document.title = \"hijacked\"; }\n")
    with editor(browser, owner, set_name) as page:
        urls: list[str] = []
        page.context.on("request", lambda r: urls.append(r.url))
        title = page.title()
        head = doc_of(owner, sid)["set"]["head"]
        tab(page, "Console")
        transport(page, "Play").click()
        eventually(page, lambda: "Pulse script: beat 0" in console_lines(page), "'Pulse script: beat 0'")
        m0 = camera(page)
        eventually(page, lambda: "Pulse script: beat 1" in console_lines(page), "'Pulse script: beat 1'")
        advance(page, 100)
        assert camera(page) != m0, "ctx.set drives the stage"
        eventually(page, lambda: "Pulse script: beat 2" in console_lines(page), "'Pulse script: beat 2'")
        lines = [l for l in console_lines(page) if l.startswith("Pulse script: beat ")]
        assert lines[:3] == ["Pulse script: beat 0", "Pulse script: beat 1", "Pulse script: beat 2"]
        eventually(page, lambda: f"{net_name} stopped: network access is not allowed" in console_lines(page),
                   "the network refusal line")
        transport(page, "Pause").click()
        assert page.title() == title, "scripts cannot touch the page"
        assert not any(probe in u for u in urls), "the script's request never left the sandbox"
    assert by_id(doc_of(owner, sid), box)["position"][1] == 0
    assert doc_of(owner, sid)["set"]["head"] == head


def test_script_errors(browser, app_url):
    owner = signup(app_url, "throws")
    sid, set_name, _, _ = blank_set_with(owner, "cube", "Box")
    thrower, spinner = f"Thrower {uuid.uuid4().hex[:4]}", f"Spinner {uuid.uuid4().hex[:4]}"
    add_script(owner, sid, thrower, "function onBeat(ctx) {\n  throw new Error(\"boom\");\n}\n")
    add_script(owner, sid, spinner, "function onBeat(ctx) {\n  let n = 0;\n  for (let i = 0; i < 3e9; i++) { n += i; }\n}\n")
    throw_re = re.compile(rf"^{re.escape(thrower)}: line 2: .*boom")
    spin_line = f"{spinner} stopped: onBeat took longer than 50 ms"
    with editor(browser, owner, set_name) as page:
        tab(page, "Console")
        transport(page, "Play").click()
        eventually(page, lambda: any(throw_re.match(l) for l in console_lines(page)), "the thrower's line in Console")
        eventually(page, lambda: spin_line in console_lines(page), "the runaway's line in Console", seconds=60)
        state = text(status(page, "Script status"))
        assert state == spin_line or throw_re.match(state), f"Script status mirrors a script message: {state!r}"
        f1 = frames(page)
        advance(page, 1000)
        assert frames(page) > f1, "the stage keeps drawing after script errors"
        assert sum(1 for l in console_lines(page) if throw_re.match(l)) == 1, "a thrown script stays stopped"


def test_wf_scripts_plugin_node(browser, app_url):
    owner = signup(app_url, "plugin")
    sid, set_name, box, _ = blank_set_with(owner, "cube", "Box")
    beat = graph_of(owner, sid)["nodes"][0]
    with editor(browser, owner, set_name) as page:
        tab(page, "Script editor")
        page.get_by_role("button", name="New script", exact=True).click()
        eventually(page, lambda: len(doc_of(owner, sid)["scripts"]) == 1, "New script commits")
        cfill(page.get_by_role("textbox", name="Script source", exact=True).first, PULSE_NODE_SCRIPT)
        page.get_by_role("button", name="Save script", exact=True).click()
        eventually(page, lambda: doc_of(owner, sid)["scripts"][0]["source"] == PULSE_NODE_SCRIPT, "script saved")
        tab(page, "Node graph")
        pulse, prop = nodes_added(owner, sid, page, ["Pulse", "Layer property"])
        assert pulse["type"] == "Pulse"
        node_params(owner, sid, prop, {"layer_id": box, "property": "position.y"})
        assert wire(owner, sid, beat, "beat", pulse, "beat").status_code == 200
        assert wire(owner, sid, pulse, "value", prop, "value").status_code == 200
        reload_set(page, set_name)
        transport(page, "Play").click()
        advance(page, 300)
        m1 = camera(page)
        advance(page, 200)
        assert camera(page) != m1, "the plugin node drives the cube"


def test_wf_assets_script_assets_dialog(browser, app_url):
    owner = signup(app_url, "uses")
    sid, set_name, _, _ = blank_set_with(owner, "cube", "Box")
    tex = upload_ready(owner, sid, "texture", f"skin-{uuid.uuid4().hex[:4]}.png", make_png(uuid.uuid4().hex), "image/png")
    model = upload_ready(owner, sid, "model", f"hull-{uuid.uuid4().hex[:4]}.glb", make_glb(uuid.uuid4().hex), "model/gltf-binary")
    script = add_script(owner, sid, SKIN_SCRIPT, EMPTY_SCRIPT)
    with editor(browser, owner, set_name) as page:
        tab(page, "Script editor")
        page.get_by_role("list", name="Scripts", exact=True).get_by_text(SKIN_SCRIPT, exact=True).click()
        for tick in (True, False):
            page.get_by_role("button", name="Uses assets", exact=True).click()
            dialog = page.get_by_role("dialog", name="Script assets", exact=True)
            eventually(page, visible(dialog), "the Script assets dialog")
            assert dialog.get_by_role("checkbox", name=model["name"], exact=True).count() == 0, "models are never listed"
            box = dialog.get_by_role("checkbox", name=tex["name"], exact=True)
            box.set_checked(tick)
            version = script_of(owner, sid, script)["version"]
            dialog.get_by_role("button", name="Done", exact=True).click()
            want = [tex["id"]] if tick else []
            eventually(page, lambda w=want: script_of(owner, sid, script)["asset_ids"] == w, f"asset_ids {want}")
            advance(page, IDLE_COMMIT_MS + 500)
            assert script_of(owner, sid, script)["version"] == version + 1, "Done saves exactly once"
            assert asset_of(owner, sid, tex["id"])["dependents"]["count"] == (1 if tick else 0)


def test_capability_invites(app_url):
    owner = signup(app_url, "inviter")
    set_name = f"Invites {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    r = owner.c.post(f"/api/sets/{sid}/invites", json={"role": "editor"})
    assert r.status_code == 201
    inv = r.json()
    assert inv["role"] == "editor" and inv["url"] == f"/join/{inv['token']}"
    guest, late = signup(app_url, "guest"), signup(app_url, "late")
    info = guest.c.get(f"/api/invites/{inv['token']}").json()
    assert info == {"set_name": set_name, "role": "editor", "owner_display_name": owner.display_name, "used": False}
    assert anon(app_url).post(f"/api/invites/{inv['token']}/accept").status_code == 401
    a = guest.c.post(f"/api/invites/{inv['token']}/accept")
    assert a.status_code == 200 and a.json() == {"set_id": sid, "role": "editor"}
    assert guest.c.post(f"/api/invites/{inv['token']}/accept").json()["role"] == "editor"
    assert guest.c.get(f"/api/invites/{inv['token']}").json()["used"] is True
    taken = late.c.post(f"/api/invites/{inv['token']}/accept")
    assert taken.status_code == 410 and err(taken)["code"] == "invite_used"
    assert late.c.get(f"/api/sets/{sid}").status_code == 404
    listed = [s for s in guest.c.get("/api/sets").json()["sets"] if s["id"] == sid]
    assert listed and listed[0]["role"] == "editor"
    members = {m["user_id"]: m["role"] for m in owner.c.get(f"/api/sets/{sid}/members").json()["members"]}
    assert members[guest.id] == "editor" and members[owner.id] == "owner" and late.id not in members
    v = owner.c.post(f"/api/sets/{sid}/invites", json={"role": "viewer"}).json()
    assert late.c.post(f"/api/invites/{v['token']}/accept").json() == {"set_id": sid, "role": "viewer"}
    v2 = owner.c.post(f"/api/sets/{sid}/invites", json={"role": "viewer"}).json()
    assert guest.c.post(f"/api/invites/{v2['token']}/accept").json()["role"] == "editor", "existing members keep their role"
    bad = owner.c.post(f"/api/sets/{sid}/invites", json={"role": "admin"})
    assert bad.status_code == 422 and "role" in err(bad)["fields"]
    assert guest.c.get(f"/api/invites/{uuid.uuid4().hex}").status_code == 404


def test_wf_co_editing_join(browser, app_url):
    owner = signup(app_url, "host")
    set_name = f"B2B {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    inv = owner.c.post(f"/api/sets/{sid}/invites", json={"role": "editor"}).json()
    guest, other = signup(app_url, "guest"), signup(app_url, "other")
    with open_app(browser, app_url + inv["url"]) as page:
        sign_in_ui(page, guest)
        join = page.get_by_role("dialog", name=f"Join {set_name}", exact=True)
        eventually(page, visible(join), "the join dialog after sign-in")
        join.get_by_role("button", name=re.compile(r"^Join as editor$", re.I)).click()
        eventually(page, lambda: any(s["id"] == sid and s["role"] == "editor"
                                     for s in guest.c.get("/api/sets").json()["sets"]), "guest joined as editor")
    with open_app(browser, app_url + inv["url"]) as page:
        sign_in_ui(page, other)
        eventually(page, visible(page.get_by_text(INVITE_USED_COPY, exact=True)), "the used-link copy")
    assert other.c.get(f"/api/sets/{sid}").status_code == 404


def test_role_permissions(app_url):
    owner = signup(app_url, "boss")
    sid = create_set(owner)["set"]["id"]
    editor_u, viewer, outsider = add_member(owner, sid, "editor"), add_member(owner, sid, "viewer"), signup(app_url, "out")
    tex = upload_ready(owner, sid, "texture", "p.png", make_png(uuid.uuid4().hex), "image/png")
    assert publish(owner, sid).status_code == 201
    floor = by_name(doc_of(owner, sid), "Floor")
    lock = f"/api/sets/{sid}/layers/{floor['id']}/lock"
    writes: dict[str, Callable[[User], httpx.Response]] = {
        "op": lambda u: send_op(u, sid, floor["id"], "layer.set", {"path": "position.x", "value": 1}, base=0),
        "lock": lambda u: u.c.post(lock),
        "heartbeat": lambda u: u.c.post(lock + "/heartbeat"),
        "unlock": lambda u: u.c.delete(lock),
        "presence": lambda u: u.c.post(f"/api/sets/{sid}/presence", json={"selection": None}),
        "upload": lambda u: upload(u, sid, "texture", "v.png", make_png("v"), "image/png"),
        "export": lambda u: u.c.post(f"/api/sets/{sid}/exports"),
        "invite": lambda u: u.c.post(f"/api/sets/{sid}/invites", json={"role": "viewer"}),
        "publish": lambda u: publish(u, sid),
        "rollback": lambda u: u.c.post(f"/api/sets/{sid}/shows/rollback"),
        "activate": lambda u: u.c.post(f"/api/sets/{sid}/shows/1/activate"),
        "delete": lambda u: u.c.delete(f"/api/sets/{sid}/assets/{tex['id']}"),
    }
    head = doc_of(owner, sid)["set"]["head"]
    for name, call in writes.items():
        r = call(viewer)
        assert r.status_code == 403 and err(r)["code"] == "forbidden", f"viewer {name}: {r.status_code}"
    assert doc_of(owner, sid)["set"]["head"] == head and len(shows_of(owner, sid)["versions"]) == 1
    for path in [f"/api/sets/{sid}", f"/api/sets/{sid}/assets", f"/api/sets/{sid}/activity",
                 f"/api/sets/{sid}/shows", f"/api/sets/{sid}/members"]:
        assert viewer.c.get(path).status_code == 200
    assert doc_of(viewer, sid)["set"]["role"] == "viewer"
    for name in ["invite", "publish", "rollback", "activate", "delete"]:
        r = writes[name](editor_u)
        assert r.status_code == 403 and err(r)["code"] == "forbidden", f"editor {name}: {r.status_code}"
    assert asset_of(owner, sid, tex["id"]) is not None
    assert send_op(editor_u, sid, floor["id"], "layer.set", {"path": "position.x", "value": 1},
                   base=floor["version"]).status_code == 200
    assert editor_u.c.post(f"/api/sets/{sid}/presence", json={"selection": None}).status_code == 200
    assert upload(editor_u, sid, "texture", "e.png", make_png("e"), "image/png").status_code == 201
    assert editor_u.c.post(f"/api/sets/{sid}/exports").status_code == 201
    assert owner.c.post(lock).status_code == 201
    assert editor_u.c.delete(lock).status_code == 403, "editors cannot release someone else's lock"
    assert owner.c.delete(lock).status_code == 204
    assert editor_u.c.post(lock).status_code == 201
    assert owner.c.delete(lock).status_code == 204, "the owner force-releases"
    assert outsider.c.get(f"/api/sets/{sid}").status_code == 404
    assert err(writes["op"](outsider))["code"] == "not_found"
    assert anon(app_url).get(f"/api/sets/{sid}").status_code == 401


def test_presence(browser, app_url):
    owner = signup(app_url, "host")
    set_name = f"Presence {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, set_name)["set"]["id"]
    guest = add_member(owner, sid, "editor")
    kv = Valkey()
    with editor(browser, owner, set_name) as host, editor(browser, guest, set_name) as visitor:
        people = host.get_by_role("list", name="In this set", exact=True)
        g_item = people.get_by_role("listitem").filter(has_text=guest.display_name)
        eventually([host, visitor], visible(g_item), "the guest in the owner's presence list")
        eventually([host, visitor], lambda: g_item.get_by_role("img", name=f"{CURSOR_DOT} green", exact=True).count() == 1,
                   "the guest's dot is green")
        o_item = visitor.get_by_role("list", name="In this set", exact=True).get_by_role("listitem").filter(has_text=owner.display_name)
        eventually([host, visitor], lambda: o_item.get_by_role("img", name=f"{CURSOR_DOT} blue", exact=True).count() == 1
                   and "nothing selected" in text(o_item), "the owner is blue with nothing selected")
        for layer in ["Floor", "Key light"]:
            select_layer(visitor, layer)
            eventually([host, visitor], lambda l=layer: l in text(g_item), f"owner sees the guest on {layer}",
                       seconds=PRESENCE_S, step_ms=50)
        raw = kv.command("GET", f"afterglass:presence:{sid}:{guest.id}")
        stored = json.loads(raw)
        assert stored["colour"] == "green" and stored["display_name"] == guest.display_name
        assert stored["selection"] == by_name(doc_of(owner, sid), "Key light")["id"]
        assert 0 < kv.ttl(f"afterglass:presence:{sid}:{guest.id}") <= PRESENCE_TTL_S
        members = {m["user_id"]: m for m in owner.c.get(f"/api/sets/{sid}/presence").json()["members"]}
        assert members[owner.id]["colour"] == "blue" and members[guest.id]["colour"] == "green"


@pytest.mark.timeout(300)
def test_lock_lease_server_clock(app_url, valkey):
    owner = signup(app_url, "lease")
    sid, _, lid, _ = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    lock = f"/api/sets/{sid}/layers/{lid}/lock"
    r = guest.c.post(lock)
    assert r.status_code == 201
    g = r.json()
    assert g["holder"] == {"user_id": guest.id, "display_name": guest.display_name} and g["ttl_seconds"] == LOCK_TTL_S
    assert abs((iso(g["expires_at"]) - iso(g["server_time"])).total_seconds() - LOCK_TTL_S) <= 1
    assert valkey.command("GET", f"afterglass:lock:{sid}:{lid}") == guest.id
    assert 0 < valkey.ttl(f"afterglass:lock:{sid}:{lid}") <= LOCK_TTL_S
    assert guest.c.post(lock).status_code == 200, "re-requesting renews"
    hb_bad = owner.c.post(lock + "/heartbeat")
    assert hb_bad.status_code == 409 and err(hb_bad)["code"] == "lock_not_held"
    hb = guest.c.post(lock + "/heartbeat")
    hb_local = time.monotonic()
    assert hb.status_code == 200
    body = hb.json()
    assert iso(body["expires_at"]) >= iso(g["expires_at"])
    ttl = (iso(body["expires_at"]) - iso(body["server_time"])).total_seconds()
    assert abs(ttl - LOCK_TTL_S) <= 1
    listener = Listener(owner.api(), f"/api/sets/{sid}/events?after={doc_of(owner, sid)['set']['head']}",
                        lambda ev, p: ev == "lock" and p and p.get("layer_id") == lid and p.get("reason") == "expired",
                        LOCK_WAIT_S)
    _, payload, arrived = listener.wait("event: lock with reason 'expired'")
    elapsed = arrived - hb_local
    assert ttl - LOCK_EVENT_S <= elapsed <= ttl + LOCK_EVENT_S + 2, f"expiry after {elapsed:.1f} s, lease {ttl:.1f} s"
    assert payload["holder"] is None
    locks = owner.c.get(f"/api/sets/{sid}/locks").json()["locks"]
    assert all(l["layer_id"] != lid for l in locks)
    assert valkey.ttl(f"afterglass:lock:{sid}:{lid}") == -2
    assert owner.c.post(lock).status_code == 201
    assert owner.c.delete(lock).status_code == 204
    again = owner.c.delete(lock)
    assert again.status_code == 409 and err(again)["code"] == "lock_not_held"


def test_wf_co_editing_lock(browser, app_url):
    owner = signup(app_url, "host")
    sid, set_name, lid, name = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    skewed = server_now(owner, sid) + timedelta(hours=SKEW_HOURS)
    with editor(browser, owner, set_name) as host, editor(browser, guest, set_name) as visitor:
        host.clock.set_system_time(skewed)
        both = [host, visitor]
        select_layer(visitor, name)
        visitor.get_by_role("button", name="Take lock", exact=True).click()
        eventually(both, visible(visitor.get_by_role("button", name="Release lock", exact=True)), "guest holds the lock")
        icon = row(host, name).get_by_role("img", name=f"Locked by {guest.display_name}", exact=True)
        eventually(both, lambda: icon.count() == 1, "the owner's tree shows the lock icon")
        select_layer(host, name)
        host.get_by_role("button", name="Take lock", exact=True).click()
        eventually(both, text_is(status(host, "Notifications"), f"Locked by {guest.display_name}"), "'Locked by <guest>'")
        locks = owner.c.get(f"/api/sets/{sid}/locks").json()["locks"]
        assert [l["holder"]["user_id"] for l in locks if l["layer_id"] == lid] == [guest.id]
        tw = field(visitor, "Shape", "Twist")
        tw.focus()
        visitor.keyboard.press("ArrowUp")
        visitor.keyboard.press("ArrowUp")
        visitor.keyboard.press("Enter")
        eventually(both, lambda: by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.2), "guest edit commits")
        eventually(both, lambda: value_of(field(host, "Shape", "Twist")) == pytest.approx(0.2), "owner sees the value",
                   seconds=PRESENCE_S + 1)
        advance(host, 60_000)
        assert icon.count() == 1, "the icon ignores the device clock"
        visitor.get_by_role("button", name="Release lock", exact=True).click()
        eventually(both, lambda: icon.count() == 0, "the icon clears on the release event")
    assert all(l["layer_id"] != lid for l in owner.c.get(f"/api/sets/{sid}/locks").json()["locks"])


def test_one_lock_winner(app_url, valkey):
    owner = signup(app_url, "race")
    sid = create_set(owner)["set"]["id"]
    racers = [owner] + [add_member(owner, sid, "editor", f"racer{i}") for i in range(LOCK_RACERS - 1)]
    for _ in range(2):
        lid = add_layer(owner, sid, f"Hot {uuid.uuid4().hex[:4]}", "cube")
        results = together(LOCK_RACERS, lambda i: racers[i].api().post(f"/api/sets/{sid}/layers/{lid}/lock"))
        won = [i for i, r in enumerate(results) if r.status_code == 201]
        assert len(won) == 1, [r.status_code for r in results]
        winner = racers[won[0]]
        for i, r in enumerate(results):
            if i == won[0]:
                continue
            assert r.status_code == 409 and err(r)["code"] == "lock_held"
            assert r.json()["error"]["holder"]["user_id"] == winner.id and r.json()["error"]["expires_at"]
            assert racers[i].c.post(f"/api/sets/{sid}/layers/{lid}/lock/heartbeat").status_code == 409
        assert valkey.command("GET", f"afterglass:lock:{sid}:{lid}") == winner.id


def test_stale_writes(app_url):
    owner = signup(app_url, "stale")
    sid, _, lid, _ = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    commit(owner, sid, lid, "layer.set", {"path": "position.x", "value": 4}, base=1)
    head = doc_of(owner, sid)["set"]["head"]
    r = send_op(guest, sid, lid, "layer.set", {"path": "props.twist", "value": 0.5}, base=1)
    assert r.status_code == 409
    e = r.json()["error"]
    assert e["code"] == "stale_version" and e["current_version"] == 2
    assert e["current"]["position"][0] == 4 and e["changed_by"] == {"user_id": owner.id, "display_name": owner.display_name}
    cur = by_id(doc_of(owner, sid), lid)
    assert cur["props"]["twist"] == 0 and cur["version"] == 2 and doc_of(owner, sid)["set"]["head"] == head
    future = send_op(guest, sid, lid, "layer.set", {"path": "props.twist", "value": 0.5}, base=9)
    assert future.status_code == 422 and "base_version" in err(future)["fields"]
    assert guest.c.post(f"/api/sets/{sid}/layers/{lid}/lock").status_code == 201
    for base in (1, 2):
        locked = send_op(owner, sid, lid, "layer.set", {"path": "props.twist", "value": 0.9}, base=base)
        assert locked.status_code == 423 and err(locked)["code"] == "layer_locked"
        assert locked.json()["error"]["holder"]["user_id"] == guest.id and locked.json()["error"]["expires_at"]
    commit(guest, sid, lid, "layer.set", {"path": "props.twist", "value": 0.5}, base=2)
    assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == 0.5


def conflict_setup(browser: Browser, app_url: str):
    owner = signup(app_url, "host")
    sid, set_name, lid, name = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    return owner, guest, sid, set_name, lid, name


def provoke_conflict(page: Page, owner: User, sid: str, lid: str, name: str, bodies: list[dict]) -> Locator:
    page.on("request", lambda r: bodies.append(r.post_data_json) if r.method == "POST" and r.url.endswith("/ops") else None)
    select_layer(page, name)
    tw = field(page, "Shape", "Twist")
    tw.focus()
    with held(page, "**/api/sets/*/ops") as hold:
        for _ in range(5):
            page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        eventually(page, lambda: len(bodies) >= 1, "the guest's op is sent")
        set_layer(owner, sid, lid, "props.twist", 0.9)
        hold.release()
    alert = page.get_by_role("alertdialog", name=CONFLICT_TITLE, exact=True)
    eventually(page, visible(alert), "the conflict dialog")
    assert f"{owner.display_name} changed {name} before your edit arrived." in text(alert)
    eventually(page, lambda: is_focused(alert.get_by_role("button", name="Keep theirs", exact=True)), "focus on Keep theirs")
    return alert


def test_wf_lock_conflict_reapply(browser, app_url):
    owner, guest, sid, set_name, lid, name = conflict_setup(browser, app_url)
    bodies: list[dict] = []
    with editor(browser, guest, set_name) as page:
        alert = provoke_conflict(page, owner, sid, lid, name, bodies)
        alert.get_by_role("button", name="Reapply mine", exact=True).click()
        eventually(page, lambda: by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.5), "Reapply commits 0.5")
        eventually(page, lambda: value_of(spin(page, "Twist").first) == pytest.approx(0.5), "guest shows the committed value")
    assert by_id(doc_of(owner, sid), lid)["version"] == 3
    guest_ops = [o for o in ops_of(owner, sid) if o["actor"]["user_id"] == guest.id]
    assert len(guest_ops) == 1 and guest_ops[0]["client_op_id"] != bodies[0]["client_op_id"]


def test_wf_lock_conflict_keep_theirs(browser, app_url):
    owner, guest, sid, set_name, lid, name = conflict_setup(browser, app_url)
    with editor(browser, guest, set_name) as page:
        alert = provoke_conflict(page, owner, sid, lid, name, [])
        for _ in range(4):
            page.keyboard.press("Tab")
            assert holds_focus(alert), "Tab stays inside the conflict dialog"
        page.keyboard.press("Shift+Tab")
        assert holds_focus(alert)
        page.keyboard.press("Escape")
        eventually(page, gone(alert), "Escape closes the dialog")
        eventually(page, lambda: value_of(spin(page, "Twist").first) == pytest.approx(0.9), "guest sees theirs")
        advance(page, IDLE_COMMIT_MS + 500)
    assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.9)
    assert not [o for o in ops_of(owner, sid) if o["actor"]["user_id"] == guest.id]


def test_wf_lock_conflict_locked_edit(browser, app_url):
    owner, guest, sid, set_name, lid, name = conflict_setup(browser, app_url)
    skewed = server_now(owner, sid) + timedelta(hours=SKEW_HOURS)
    with editor(browser, owner, set_name) as page:
        page.clock.set_system_time(skewed)
        icon = row(page, name).get_by_role("img", name=f"Locked by {guest.display_name}", exact=True)
        select_layer(page, name)
        tw = field(page, "Shape", "Twist")
        assert guest.c.post(f"/api/sets/{sid}/layers/{lid}/lock").status_code == 201
        eventually(page, lambda: icon.count() == 1, "the lock icon from the server's lock event")
        tw.focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        eventually(page, text_is(status(page, "Notifications"), f"This layer is locked by {guest.display_name}"),
                   "'This layer is locked by <guest>'")
        assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == 0
        assert guest.c.delete(f"/api/sets/{sid}/layers/{lid}/lock").status_code == 204
        eventually(page, lambda: icon.count() == 0, "the icon clears on the release event")


def test_ops_exactly_once(app_url):
    owner = signup(app_url, "once")
    sid = create_set(owner)["set"]["id"]
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    cid = op_id()
    payload = {"path": "position.x", "value": 2.5}
    first = send_op(owner, sid, floor, "layer.set", payload, base=1, cid=cid)
    assert first.status_code == 200 and first.json()["replayed"] is False
    entries = len(activity(owner, sid))
    again = send_op(owner, sid, floor, "layer.set", payload, base=1, cid=cid)
    assert again.status_code == 200 and again.json() == {**first.json(), "replayed": True}
    d = doc_of(owner, sid)
    assert d["set"]["head"] == 1 and by_id(d, floor)["version"] == 2 and len(activity(owner, sid)) == entries
    for p, base in [({"path": "position.x", "value": 3}, 1), (payload, 2)]:
        r = send_op(owner, sid, floor, "layer.set", p, base=base, cid=cid)
        assert r.status_code == 409 and err(r)["code"] == "op_id_reused"
    assert by_id(doc_of(owner, sid), floor)["position"][0] == 2.5
    lid, add_cid = new_id(), op_id()
    body = {"parent_id": None, "index": 1, "name": "Twin", "kind": "cube"}
    assert send_op(owner, sid, lid, "layer.add", body, cid=add_cid).status_code == 200
    assert send_op(owner, sid, lid, "layer.add", body, cid=add_cid).json()["replayed"] is True
    taken = send_op(owner, sid, lid, "layer.add", body)
    assert taken.status_code == 409 and err(taken)["code"] == "id_taken"
    assert send_op(owner, sid, floor, "layer.set", payload, base=2, cid="short").status_code == 422
    par = op_id()
    results = together(5, lambda i: send_op(None, sid, floor, "layer.set", {"path": "position.z", "value": 1}, base=2,
                                            cid=par, client=owner.api()))
    assert all(r.status_code == 200 for r in results)
    assert sum(1 for r in results if r.json()["replayed"] is False) == 1
    assert len({r.json()["seq"] for r in results}) == 1
    assert sum(1 for o in ops_of(owner, sid) if o["client_op_id"] == par) == 1


def offline_edits(page: Page, count: int) -> None:
    tw = spin(page, "Twist").first
    for _ in range(count):
        tw.focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        advance(page, 200)


def test_offline_banner(browser, app_url):
    owner = signup(app_url, "offline")
    sid, set_name, lid, name = blank_set_with(owner)
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        field(page, "Shape", "Twist")
        head = doc_of(owner, sid)["set"]["head"]
        page.context.set_offline(True)
        offline_edits(page, 1)
        conn = status(page, "Connection")
        eventually(page, text_is(conn, "Connection lost. 1 change waiting to sync."), "the singular banner")
        assert text(status(page, "Autosave")) == "Waiting to sync"
        offline_edits(page, 1)
        eventually(page, text_is(conn, "Connection lost. 2 changes waiting to sync."), "the count rises to 2")
        assert text(status(page, "Autosave")) == "Waiting to sync"
        assert value_of(spin(page, "Twist").first) == pytest.approx(0.2), "edits keep applying locally"
        assert doc_of(owner, sid)["set"]["head"] == head, "nothing reached the server while offline"
        page.context.set_offline(False)
        eventually(page, lambda: by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.2), "queue drains")


def test_wf_offline_replay_reconnect(browser, app_url):
    owner = signup(app_url, "host")
    sid, set_name, lid, name = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    with editor(browser, guest, set_name) as page:
        select_layer(page, name)
        field(page, "Shape", "Twist")
        page.context.set_offline(True)
        offline_edits(page, 2)
        eventually(page, text_is(status(page, "Connection"), "Connection lost. 2 changes waiting to sync."), "banner 2")
        set_layer(owner, sid, floor, "position.x", 3.5)
        page.context.set_offline(False)
        eventually(page, text_is(status(page, "Notifications"), BACK_ONLINE), "the reconnect toast")
        eventually(page, gone(status(page, "Connection")), "the banner disappears", seconds=5)
        select_layer(page, "Floor")
        eventually(page, lambda: value_of(field(page, "Transform", "Position X")) == pytest.approx(3.5), "caught up")
    mine = [o for o in ops_of(owner, sid) if o["actor"]["user_id"] == guest.id]
    assert [round(o["payload"]["value"], 3) for o in mine] == [0.1, 0.2]
    assert len({o["client_op_id"] for o in mine}) == 2
    assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.2)


def test_wf_offline_replay_lost_ack(browser, app_url):
    owner = signup(app_url, "ack")
    sid, set_name, lid, name = blank_set_with(owner)
    before = [o["client_op_id"] for o in ops_of(owner, sid)]
    with editor(browser, owner, set_name) as page:
        calls: list[dict] = []

        def handler(route: Any) -> None:
            calls.append(route.request.post_data_json)
            if len(calls) == 1:
                route.fetch()
                route.abort()
            else:
                route.continue_()

        page.route("**/api/sets/*/ops", handler)
        select_layer(page, name)
        field(page, "Shape", "Twist")
        offline_edits(page, 1)
        eventually(page, lambda: len(calls) >= 2, "the browser replays the unacknowledged op")
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "'Saved' once acknowledged")
    assert calls[1]["client_op_id"] == calls[0]["client_op_id"]
    after = [o["client_op_id"] for o in ops_of(owner, sid)]
    assert after[:len(before)] == before, "earlier ops are untouched"
    assert after[len(before):] == [calls[0]["client_op_id"]], "the replayed op is applied exactly once"
    assert by_id(doc_of(owner, sid), lid)["version"] == 2


def test_show_publish_immutable(app_url):
    owner = signup(app_url, "publish")
    sid, _, lid, name = blank_set_with(owner)
    bucket = S3()
    tex = upload_ready(owner, sid, "texture", "t.png", make_png(uuid.uuid4().hex), "image/png")
    floor = by_name(doc_of(owner, sid), "Floor")["id"]
    set_layer(owner, sid, floor, "material.albedo_texture_id", tex["id"])
    assert publish(owner, sid, note="n" * (NOTE_MAX + 1)).status_code == 422
    r = publish(owner, sid, note=SHOW_NOTE)
    assert r.status_code == 201
    v = r.json()["show_version"]
    assert v["number"] == 1 and v["status"] == "published" and v["live"] is True and v["note"] == SHOW_NOTE
    assert v["published_by"]["user_id"] == owner.id
    key = f"sets/{sid}/shows/1/bundle.json"
    stored = bucket.get(key)
    assert sha(stored) == v["sha256"] and len(stored) == v["size"]
    bundle = json.loads(stored.decode("utf-8"))
    assert bundle["format"] == SHOW_FORMAT and bundle["set"]["bpm"] == BPM_DEFAULT
    assert any(l["name"] == name for l in bundle["layers"]) and any(a["id"] == tex["id"] for a in bundle["assets"])
    set_layer(owner, sid, lid, "props.twist", 4)
    assert bucket.get(key) == stored
    v2 = publish(owner, sid).json()["show_version"]
    assert v2["number"] == 2 and bucket.get(key) == stored
    assert any(l["name"] == name and l["props"]["twist"] == 4 for l in json.loads(bucket.get(f"sets/{sid}/shows/2/bundle.json"))["layers"])
    failed = publish(owner, sid, client=owner.api(outage_url("APP_MINIO_DOWN_URL")))
    assert failed.status_code == 503 and err(failed)["code"] == "storage_unavailable"
    fv = failed.json()["error"]["show_version"] if "show_version" in failed.json()["error"] else failed.json()["show_version"]
    assert fv["status"] == "store failed" and fv["live"] is False
    shows = shows_of(owner, sid)
    assert shows["live_number"] == 2
    assert next(x for x in shows["versions"] if x["number"] == fv["number"])["status"] == "store failed"
    act = owner.c.post(f"/api/sets/{sid}/shows/{fv['number']}/activate")
    assert act.status_code == 409 and err(act)["code"] == "not_published"
    assert anon(app_url).get(f"/api/show/{show_token(owner, sid)}").json()["version"]["number"] == 2


def test_show_link_api(app_url):
    owner = signup(app_url, "venue")
    sid, set_name, _, _ = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    token, public = show_token(owner, sid), anon(app_url)
    pre = public.get(f"/api/show/{token}")
    assert pre.status_code == 404 and err(pre)["code"] == "not_published"
    assert public.get(f"/api/show/{token}/bundle").status_code == 404
    tex = upload_ready(owner, sid, "texture", "t.png", make_png(uuid.uuid4().hex), "image/png")
    set_layer(owner, sid, by_name(doc_of(owner, sid), "Floor")["id"], "material.albedo_texture_id", tex["id"])
    v = publish(owner, sid).json()["show_version"]
    info = public.get(f"/api/show/{token}")
    assert info.status_code == 200
    body = info.json()
    assert body["set_name"] == set_name and body["bpm"] == BPM_DEFAULT
    assert body["version"]["number"] == 1 and body["version"]["sha256"] == v["sha256"] and body["version"]["size"] == v["size"]
    b = public.get(f"/api/show/{token}/bundle")
    assert b.status_code == 200 and b.content == S3().get(f"sets/{sid}/shows/1/bundle.json")
    assert b.headers["content-type"].startswith("application/json")
    assert b.headers["x-bundle-sha256"] == v["sha256"] == sha(b.content) and b.headers["x-show-version"] == "1"
    for payload in (info.text, b.text):
        for secret in (owner.email, guest.email):
            assert secret not in payload, "the show link exposes no emails"
        assert "members" not in json.loads(payload)
    a = public.get(f"/api/show/{token}/assets/{tex['id']}")
    assert a.status_code == 200 and a.content == make_png_bytes_of(owner, tex)
    later = upload_ready(owner, sid, "texture", "late.png", make_png(uuid.uuid4().hex), "image/png")
    assert public.get(f"/api/show/{token}/assets/{later['id']}").status_code == 404
    publish(owner, sid, client=owner.api(outage_url("APP_MINIO_DOWN_URL")))
    assert public.get(f"/api/show/{token}/bundle").headers["x-show-version"] == "1", "a failed version is never served"


def make_png_bytes_of(owner: User, asset: dict) -> bytes:
    r = owner.c.get(f"/api/assets/{asset['id']}/content")
    assert r.status_code == 200 and sha(r.content) == asset["sha256"]
    return r.content


def test_wf_show_publish_show_page(browser, app_url):
    owner = signup(app_url, "showpage")
    sid, _, _, _ = blank_set_with(owner)
    token = show_token(owner, sid)
    with open_app(browser, f"{app_url}/show/{token}") as page:
        eventually(page, visible(page.get_by_text(NOTHING_LIVE, exact=True)), "'Nothing is live yet'")
    v = publish(owner, sid).json()["show_version"]
    with open_app(browser, f"{app_url}/show/{token}") as page:
        show_stage = page.get_by_role("img", name="Show stage", exact=True)
        eventually(page, visible(show_stage), "the show stage")
        shots = scene_frames(show_stage, steps=2, step_ms=500)
        assert any(s["draws"] > 0 for s in shots)
        assert tree(page).count() == 0 and page.get_by_role("menubar", name="Set menu").count() == 0
        page.get_by_role("button", name="Show info", exact=True).click()
        region = page.get_by_role("region", name="Show info", exact=True)
        eventually(page, visible(region), "the Show info panel")
        info = text(region)
        assert "Version 1" in info and f"SHA-256 {v['sha256']}" in info and "Published " in info
        page.keyboard.press("i")
        eventually(page, gone(region), "I hides the panel")
        page.keyboard.press("i")
        eventually(page, visible(region), "I shows the panel")
        assert owner.email not in (page.content() or "")


def test_show_rollback(app_url):
    owner = signup(app_url, "rollback")
    sid, _, lid, _ = blank_set_with(owner)
    token, public = show_token(owner, sid), anon(app_url)
    publish(owner, sid)
    b1 = public.get(f"/api/show/{token}/bundle").content
    set_layer(owner, sid, lid, "props.twist", -7)
    publish(owner, sid)
    b2 = public.get(f"/api/show/{token}/bundle").content
    assert b1 != b2
    listener = Listener(anon(app_url), f"/api/show/{token}/events",
                        lambda ev, p: ev == "show" and p and p.get("live_number") == 1, SHOW_SWITCH_S + 5)
    r = owner.c.post(f"/api/sets/{sid}/shows/rollback")
    assert r.status_code == 200 and r.json() == {"live_number": 1, "previous_live_number": 2}
    listener.wait("event: show with live_number 1")
    got = public.get(f"/api/show/{token}/bundle")
    assert got.content == b1 and got.headers["x-show-version"] == "1"
    shows = shows_of(owner, sid)
    assert shows["live_number"] == 1 and next(v for v in shows["versions"] if v["number"] == 2)["status"] == "published"
    again = owner.c.post(f"/api/sets/{sid}/shows/rollback")
    assert again.status_code == 409 and err(again)["code"] == "no_previous_version"
    act = owner.c.post(f"/api/sets/{sid}/shows/2/activate")
    assert act.status_code == 200 and act.json() == {"live_number": 2, "previous_live_number": 1}
    assert public.get(f"/api/show/{token}/bundle").content == b2
    assert S3().get(f"sets/{sid}/shows/1/bundle.json") == b1


def test_wf_show_publish_venue(browser, app_url):
    owner = signup(app_url, "night")
    sid, set_name, lid, _ = blank_set_with(owner)
    token = show_token(owner, sid)
    with editor(browser, owner, set_name) as page:
        tile(page, "Shows")
        show_status = status(page, "Show status")
        page.get_by_role("button", name="Publish show", exact=True).click()
        eventually(page, text_is(show_status, "Version 1 is live"), "'Version 1 is live'")
        b1 = anon(app_url).get(f"/api/show/{token}/bundle").content
        assert page.get_by_role("link", name="Show link", exact=True).get_attribute("href").endswith(f"/show/{token}")
        with open_app(browser, f"{app_url}/show/{token}") as venue:
            info_btn = venue.get_by_role("button", name="Show info", exact=True)
            eventually(venue, visible(info_btn), "the venue page loads version 1")
            info_btn.click()
            region = venue.get_by_role("region", name="Show info", exact=True)
            eventually(venue, lambda: "Version 1" in text(region), "venue shows Version 1")
            set_layer(owner, sid, lid, "props.twist", 9)
            page.get_by_role("button", name="Publish show", exact=True).click()
            eventually(page, text_is(show_status, "Version 2 is live"), "'Version 2 is live'")
            eventually([venue, page], lambda: "Version 2" in text(region), "venue switches to Version 2",
                       seconds=SHOW_SWITCH_S, step_ms=250)
            page.get_by_role("button", name="Roll back", exact=True).click()
            eventually(page, text_is(show_status, "Rolled back. Version 1 is live"), "the rollback copy")
            eventually([venue, page], lambda: "Version 1" in text(region), "venue returns to Version 1",
                       seconds=SHOW_SWITCH_S, step_ms=250)
        make_live = page.get_by_role("button", name=re.compile(r"^Make version \d+ live$"))
        live_row = (page.get_by_role("list", name="Show versions", exact=True).get_by_role("listitem")
                    .filter(has_not=make_live).filter(has_text="live"))
        assert live_row.count() == 1 and "1" in text(live_row), "only version 1's row is marked live"
    assert anon(app_url).get(f"/api/show/{token}/bundle").content == b1


def rich_set(owner: User) -> tuple[str, str]:
    name = f"Night Set {uuid.uuid4().hex[:6]}"
    sid = create_set(owner, name)["set"]["id"]
    rig = add_layer(owner, sid, "Rig", "group")
    box = add_layer(owner, sid, "Box", "cube", parent_id=rig)
    set_layer(owner, sid, box, "position", [1, 2, 3])
    set_layer(owner, sid, box, "rotation", [0, 45, 0])
    set_layer(owner, sid, box, "scale", [2, 2, 2])
    tube = add_layer(owner, sid, "Tunnel", "tube")
    set_layer(owner, sid, tube, "props.twist", 0.35)
    put_key(owner, sid, tube, "props.twist", FAR_KEY_TICK, 0.8)
    glow = add_layer(owner, sid, "Glow", "shader")
    save_shader(owner, sid, glow, solid_shader(1, 0, 0))
    commit(owner, sid, glow, "shader.restore", {"from_version": 1}, base=by_id(doc_of(owner, sid), glow)["version"])
    tex = upload_ready(owner, sid, "texture", "skin.png", make_png(uuid.uuid4().hex), "image/png")
    set_layer(owner, sid, box, "material.albedo_texture_id", tex["id"])
    script = add_script(owner, sid, "Pulse script", "function onBeat(ctx) {}\n")
    commit(owner, sid, script, "script.save", {"source": "function onBeat(ctx) { }\n", "asset_ids": [tex["id"]]}, base=1)
    set_settings(owner, sid, {"bpm": 132.5})
    return sid, name


def scene_shape(user: User, sid: str) -> dict:
    doc = doc_of(user, sid)
    names = {l["id"]: l["name"] for l in doc["layers"]}
    assets = {a["id"]: (a["name"], a["sha256"], a["status"]) for a in assets_of(user, sid)}

    def mat(l: dict) -> Any:
        m = l.get("material")
        if not m:
            return None
        return {**m, "albedo_texture_id": assets.get(m.get("albedo_texture_id")),
                "emissive_texture_id": assets.get(m.get("emissive_texture_id"))}

    layers = sorted(json.dumps([l["name"], l["kind"], names.get(l["parent_id"]), l["index"], l["position"], l["rotation"],
                                l["scale"], l["props"], mat(l), l["output_buses"], assets.get(l.get("model_asset_id"))],
                               sort_keys=True) for l in doc["layers"])
    shaders = {l["name"]: [(v["number"], v["restored_from"], shader_source(user, sid, l["id"], v["number"])["source"])
                           for v in shader_versions(user, sid, l["id"])] for l in doc["layers"] if l["kind"] == "shader"}
    return {
        "bpm": doc["set"]["bpm"], "layers": layers,
        "keys": sorted((names[k["layer_id"]], k["property"], k["tick"], k["value"]) for k in doc["keys"]),
        "graph": (sorted(n["type"] for n in doc["graph"]["nodes"]), len(doc["graph"]["wires"])),
        "scripts": sorted((s["name"], s["source"], tuple(sorted(assets[a][0] for a in s["asset_ids"]))) for s in doc["scripts"]),
        "shaders": shaders, "assets": sorted(assets.values()),
    }


def export_zip(owner: User, sid: str) -> tuple[dict, bytes]:
    r = owner.c.post(f"/api/sets/{sid}/exports")
    assert r.status_code == 201, r.text
    exp = r.json()["export"]
    d = owner.c.get(exp["download_url"])
    assert d.status_code == 200
    return exp, d.content


def test_export_bytes(app_url):
    owner = signup(app_url, "export")
    sid, name = rich_set(owner)
    r = owner.c.post(f"/api/sets/{sid}/exports")
    assert r.status_code == 201
    exp = r.json()["export"]
    assert exp["download_url"] == f"/api/exports/{exp['id']}/download"
    stored = S3().get(f"sets/{sid}/exports/{exp['id']}.zip")
    assert sha(stored) == exp["sha256"] and len(stored) == exp["size"]
    d = owner.c.get(exp["download_url"])
    assert d.status_code == 200 and d.content == stored
    assert d.headers["content-type"].startswith("application/zip") and d.headers["x-content-sha256"] == exp["sha256"]
    slug = re.sub(r"[^a-z0-9]+", "-", name.lower())
    assert d.headers["content-disposition"] == f'attachment; filename="{slug}.afterglass.zip"'
    with zipfile.ZipFile(io.BytesIO(stored)) as z:
        manifest = json.loads(z.read("set.json"))
        assert manifest["format"] == EXPORT_FORMAT
        for asset in assets_of(owner, sid):
            assert sha(z.read(f"assets/{asset['id']}")) == asset["sha256"]
    assert signup(app_url, "nosy").c.get(exp["download_url"]).status_code == 404


def test_import_new_set(app_url):
    owner = signup(app_url, "import")
    sid, name = rich_set(owner)
    _, data = export_zip(owner, sid)
    bucket = S3()
    before = set(bucket.keys("imports/"))
    r = owner.c.post("/api/sets/import", files={"file": ("set.afterglass.zip", data, "application/zip")})
    assert r.status_code == 201, r.text
    new = r.json()
    nid = new["set"]["id"]
    assert nid != sid and new["set"]["name"] == f"{name} (imported)" and new["set"]["role"] == "owner"
    assert any(bucket.get(k) == data for k in set(bucket.keys("imports/")) - before), "the upload is stored byte for byte"
    old_ids = {l["id"] for l in doc_of(owner, sid)["layers"]}
    assert old_ids.isdisjoint({l["id"] for l in doc_of(owner, nid)["layers"]})
    assert scene_shape(owner, nid) == scene_shape(owner, sid)
    for asset in assets_of(owner, nid):
        assert asset["status"] == "ready" and sha(bucket.get(f"sets/{nid}/assets/{asset['id']}")) == asset["sha256"]
    junk = io.BytesIO()
    with zipfile.ZipFile(junk, "w") as z:
        z.writestr("notes.txt", "hello")
    for blob in (b"not a zip at all", junk.getvalue()):
        bad = owner.c.post("/api/sets/import", files={"file": ("x.zip", blob, "application/zip")})
        assert bad.status_code == 422 and err(bad)["code"] == "validation" and err(bad)["fields"]["file"] == NOT_EXPORT
    imported = [s for s in owner.c.get("/api/sets").json()["sets"] if s["name"] == f"{name} (imported)"]
    assert len(imported) == 1


def test_wf_export_import_storage_outage(app_url):
    owner = signup(app_url, "impdown")
    sid, name = rich_set(owner)
    _, data = export_zip(owner, sid)
    r = owner.api(outage_url("APP_MINIO_DOWN_URL")).post("/api/sets/import", files={"file": ("s.zip", data, "application/zip")})
    assert r.status_code == 503 and err(r)["code"] == "storage_unavailable" and err(r)["message"] == STORAGE_BANNER
    assert not [s for s in owner.c.get("/api/sets").json()["sets"] if s["name"].endswith("(imported)")]


def test_wf_export_import_journey(browser, app_url):
    owner = signup(app_url, "move")
    sid, name = rich_set(owner)
    exp, data = export_zip(owner, sid)
    assert sha(data) == exp["sha256"]
    nid = owner.c.post("/api/sets/import", files={"file": ("s.zip", data, "application/zip")}).json()["set"]["id"]
    with editor(browser, owner, f"{name} (imported)") as page:
        for layer in ["Rig", "Box", "Tunnel", "Glow", "Stage", "Floor"]:
            reveal(page, layer)
        select_layer(page, "Tunnel")
        tab(page, "Timeline")
        eventually(page, lambda: page.get_by_role("button", name=f"Key {KEY_LABEL} at {bars_beats(FAR_KEY_TICK)}",
                                                  exact=True).count() == 1, "the key")
        select_layer(page, "Glow")
        tab(page, "Shader editor")
        hist = page.get_by_role("list", name="Shader history", exact=True)
        eventually(page, lambda: "Restored from version 1" in text(hist), "the imported history")
        tab(page, "Script editor")
        eventually(page, lambda: "Pulse script" in text(page.get_by_role("list", name="Scripts", exact=True)), "the script")
    assert scene_shape(owner, nid) == scene_shape(owner, sid)


def test_storage_outage(app_url):
    owner = signup(app_url, "nostore")
    sid, _, lid, _ = blank_set_with(owner)
    tex = upload_ready(owner, sid, "texture", "t.png", make_png(uuid.uuid4().hex), "image/png")
    publish(owner, sid)
    token = show_token(owner, sid)
    down = owner.api(outage_url("APP_MINIO_DOWN_URL"))
    eventually_api(lambda: down.get("/api/status").json()["storage"] == "unreachable", "status storage unreachable", BANNER_S)
    assert down.get("/api/status").json()["collab"] == "ok"
    for r in [upload(owner, sid, "texture", "u.png", make_png("u"), "image/png", base=outage_url("APP_MINIO_DOWN_URL")),
              publish(owner, sid, client=down), down.post(f"/api/sets/{sid}/exports"),
              down.get(f"/api/assets/{tex['id']}/content"), down.get(f"/api/show/{token}/bundle"),
              down.delete(f"/api/sets/{sid}/assets/{tex['id']}")]:
        assert r.status_code == 503 and err(r)["code"] == "storage_unavailable" and err(r)["message"] == STORAGE_BANNER
    assert down.get(f"/api/show/{token}").json()["version"]["number"] == 1
    assert anon(app_url).get(f"/api/show/{token}").json()["version"]["number"] == 1
    commit(owner, sid, lid, "layer.set", {"path": "props.twist", "value": 1.5},
           base=by_id(doc_of(owner, sid), lid)["version"], client=down)
    commit(owner, sid, add_layer(owner, sid, "Glow", "shader"), "shader.save", {"source": solid_shader(0, 1, 0)},
           base=1, client=down) if False else None
    assert down.post(f"/api/sets/{sid}/layers/{lid}/lock").status_code == 201
    assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == 1.5 and asset_of(owner, sid, tex["id"]) is not None


def eventually_api(check: Callable[[], bool], what: str, seconds: float) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (httpx.HTTPError, LookupError, ValueError):
            pass
        httpx.get("http://127.0.0.1:9", timeout=0.25) if False else threading.Event().wait(0.25)
    pytest.fail(f"within {seconds} s: expected {what}")


def test_wf_outages_activity_collab_offline(browser, app_url, valkey):
    owner = signup(app_url, "nocollab")
    sid, set_name, lid, name = blank_set_with(owner)
    guest = add_member(owner, sid, "editor")
    base = outage_url("APP_VALKEY_DOWN_URL")
    down = owner.api(base)
    eventually_api(lambda: down.get("/api/status").json()["collab"] == "unreachable", "status collab unreachable", BANNER_S)
    for r in [down.post(f"/api/sets/{sid}/layers/{lid}/lock"), down.post(f"/api/sets/{sid}/layers/{lid}/lock/heartbeat"),
              down.get(f"/api/sets/{sid}/locks"), down.post(f"/api/sets/{sid}/presence", json={"selection": None}),
              down.get(f"/api/sets/{sid}/presence")]:
        assert r.status_code == 503 and err(r)["code"] == "collab_offline" and err(r)["message"] == COLLAB_BANNER
    with editor(browser, owner, set_name, base=base) as host, editor(browser, guest, set_name, base=base) as visitor:
        both = [host, visitor]
        for p in both:
            eventually(both, text_is(status(p, "Service status"), COLLAB_BANNER), "the collaboration banner", seconds=BANNER_S)
        select_layer(visitor, name)
        tw = field(visitor, "Shape", "Twist")
        take = visitor.get_by_role("button", name="Take lock", exact=True)
        if take.count():
            take.click()
            advance(visitor, 1000)
        assert visitor.get_by_role("button", name="Release lock", exact=True).count() == 0
        assert valkey.ttl(f"afterglass:lock:{sid}:{lid}") == -2, "no lock was taken"
        commit(owner, sid, lid, "layer.set", {"path": "props.twist", "value": 0.7},
               base=by_id(doc_of(owner, sid), lid)["version"], client=down)
        eventually(both, lambda: value_of(tw) == pytest.approx(0.7), "the guest catches up", seconds=CATCH_UP_S, step_ms=250)
    assert ops_of(owner, sid)[-1]["payload"] == {"path": "props.twist", "value": 0.7}


def test_activity_log(app_url):
    owner = signup(app_url, "log")
    sid, _, lid, _ = blank_set_with(owner)
    set_layer(owner, sid, lid, "props.twist", 0.35)
    keep = upload_ready(owner, sid, "texture", "k.png", make_png(uuid.uuid4().hex), "image/png")
    publish(owner, sid)
    publish(owner, sid)
    owner.c.post(f"/api/sets/{sid}/shows/rollback")
    owner.c.post(f"/api/sets/{sid}/shows/2/activate")
    publish(owner, sid, client=owner.api(outage_url("APP_MINIO_DOWN_URL")))
    spare = upload_ready(owner, sid, "texture", "s.png", make_png(uuid.uuid4().hex), "image/png")
    assert owner.c.delete(f"/api/sets/{sid}/assets/{spare['id']}").status_code == 204
    guest = add_member(owner, sid, "editor")
    assert guest.c.post(f"/api/sets/{sid}/layers/{lid}/lock").status_code == 201
    assert owner.c.delete(f"/api/sets/{sid}/layers/{lid}/lock").status_code == 204
    _, data = export_zip(owner, sid)
    nid = owner.c.post("/api/sets/import", files={"file": ("s.zip", data, "application/zip")}).json()["set"]["id"]
    entries = activity(owner, sid)
    actions = [e["action"] for e in entries]
    for action in ["layer.add", "layer.set", "asset.upload", "show.publish", "show.rollback", "show.activate",
                   "show.store_failed", "asset.delete", "member.join", "lock.force_release", "set.export"]:
        assert action in actions, f"activity has {action}"
    assert actions.count("show.publish") == 2
    join = next(e for e in entries if e["action"] == "member.join")
    assert join["actor"] == {"user_id": guest.id, "display_name": guest.display_name}
    for e in entries:
        assert e["id"] and iso(e["at"]) and isinstance(e["summary"], str) and e["summary"].strip()
    assert [iso(e["at"]) for e in entries] == sorted((iso(e["at"]) for e in entries), reverse=True)
    older = activity(owner, sid, before=entries[0]["id"])
    assert [e["id"] for e in older] == [e["id"] for e in entries[1:]][:len(older)]
    assert "set.import" in [e["action"] for e in activity(owner, nid)]
    assert keep["id"]


def test_wf_outages_activity_degraded_night(browser, app_url):
    owner = signup(app_url, "rough")
    sid, set_name, lid, name = blank_set_with(owner)
    publish(owner, sid)
    base = outage_url("APP_MINIO_DOWN_URL")
    skewed = server_now(owner, sid) + timedelta(hours=SKEW_HOURS)
    with editor(browser, owner, set_name, base=base) as page:
        page.clock.set_system_time(skewed)
        eventually(page, text_is(status(page, "Service status"), STORAGE_BANNER), "the storage banner", seconds=BANNER_S)
        tile(page, "Assets")
        page.get_by_label("Choose GLB or texture file").set_input_files(
            files={"name": "lost.png", "mimeType": "image/png", "buffer": make_png(uuid.uuid4().hex)})
        eventually(page, lambda: any(a["status"] == "upload failed" for a in assets_of(owner, sid)), "a failed asset")
        failed = next(a for a in assets_of(owner, sid) if a["status"] == "upload failed")
        eventually(page, text_is(status(page, "Asset upload"), f"{failed['name']} upload failed"), "'<name> upload failed'")
        shelf_row = page.get_by_role("list", name="Asset shelf", exact=True).get_by_role("listitem").filter(has_text=failed["name"])
        assert "upload failed" in text(shelf_row)
        tile(page, "Shows")
        page.get_by_role("button", name="Publish show", exact=True).click()
        eventually(page, text_is(status(page, "Show status"), "Publish failed. Version 1 is still live."), "the publish failure copy")
        tile(page, "Layers")
        select_layer(page, name)
        tw = field(page, "Shape", "Twist")
        tw.focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("Enter")
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "editing still saves")
        tile(page, "Activity")
        entries = activity(owner, sid)
        rows = page.get_by_role("list", name="Activity", exact=True).get_by_role("listitem")
        eventually(page, lambda: rows.count() == len(entries), "one Activity row per entry")
    assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.1)
    assert shows_of(owner, sid)["live_number"] == 1
    assert {"show.store_failed", "layer.set"} <= {e["action"] for e in activity(owner, sid)}


@pytest.mark.timeout(300)
def test_health_and_port(app_url):
    r = anon(app_url).get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    port = urlparse(app_url).port
    if port is not None:
        assert port == int(os.environ.get("APP_PUBLIC_PORT", "4173"))
    manifest = json.loads((DEPLOYED_APP / "run.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        free = s.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, "APP_PUBLIC_PORT": str(free)}, start_new_session=True)
    try:
        deadline = time.monotonic() + COPY_BOOT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"serve exited: {Path(log.name).read_text()[-2000:]}")
            try:
                h = httpx.get(f"http://127.0.0.1:{free}/api/health", timeout=2)
                if h.status_code == 200 and h.json() == {"status": "ok"}:
                    break
            except httpx.HTTPError:
                threading.Event().wait(0.5)
        else:
            pytest.fail(f"copy on APP_PUBLIC_PORT={free} answered health: {Path(log.name).read_text()[-2000:]}")
    finally:
        os.killpg(proc.pid, 15)
        proc.wait(timeout=30)


def test_server_boundary(app_url):
    owner = signup(app_url, "edge")
    sid = create_set(owner)["set"]["id"]
    c = anon(app_url)
    probe = c.get("/api/health", headers={"Origin": "http://evil.example"})
    assert not any(h.lower().startswith("access-control-") for h in probe.headers.keys())
    before = len(owner.c.get("/api/sets").json()["sets"])
    foreign = owner.c.post("/api/sets", json={"name": "x", "starter": "blank-stage"}, headers={"Origin": "http://evil.example"})
    assert foreign.status_code == 403 and err(foreign)["code"] == "forbidden"
    assert len(owner.c.get("/api/sets").json()["sets"]) == before

    def padded(size: int) -> bytes:
        head = b'{"name":"x","starter":"blank-stage","pad":"'
        return head + b"a" * (size - len(head) - 2) + b'"}'

    ok = owner.c.post("/api/sets", content=padded(JSON_LIMIT), headers={"Content-Type": "application/json"})
    assert ok.status_code != 413
    big = c.post("/api/sets", content=padded(JSON_LIMIT + 1), headers={"Content-Type": "application/json"})
    assert big.status_code == 413 and err(big)["code"] == "too_large", "413 precedes 401"
    wrong = c.post("/api/sets", content=b"name=x", headers={"Content-Type": "text/plain"})
    assert wrong.status_code == 415 and err(wrong)["code"] == "unsupported_media_type"
    for kind, limit in [("texture", TEXTURE_LIMIT), ("model", MODEL_LIMIT)]:
        magic = b"\x89PNG\r\n\x1a\n" if kind == "texture" else b"glTF"
        r = upload(owner, sid, kind, "big.bin", magic + b"\0" * (limit + 1 - len(magic)), "application/octet-stream")
        assert r.status_code == 413 and err(r)["code"] == "too_large", kind
    r = owner.c.post("/api/sets/import", files={"file": ("big.zip", b"PK" + b"\0" * (IMPORT_LIMIT - 1), "application/zip")})
    assert r.status_code == 413
    assert c.get(f"/api/sets/{new_id()}").status_code == 401
    assert owner.c.get(f"/api/sets/{new_id()}").status_code == 404
    for path in ["/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/pg/package.json",
                 "/tsconfig.json", "/src/server.ts", "/%2e%2e/run.json"]:
        assert c.get(path).status_code == 404, f"{path} is never served"
    secrets = [os.environ.get(n, "") for n in ["S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL", "VALKEY_URL"]]
    secrets += [urlparse(os.environ.get("DATABASE_URL", "")).password or ""]
    secrets = [s for s in secrets if len(s) >= 6]
    html = c.get("/").text
    served = [html] + [c.get(src).text for src in re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', html)]
    served.append(c.get("/api/status").text)
    for body in served:
        for secret in secrets:
            assert secret not in body, "a credential value is served to the browser"


VIEWPORTS = {"1440x900": (1440, 900), "1280x800": (1280, 800), "768x1024": (768, 1024), "375x812": (375, 812)}


def controls_inside(page: Page, width: int, skip: Locator) -> None:
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    drawer = skip.element_handle() if skip.count() else None
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if not control.is_visible():
            continue
        if drawer is not None and control.evaluate("(e, d) => d.contains(e)", drawer):
            continue
        control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
        box = control.bounding_box()
        assert box and box["x"] >= -1 and box["x"] + box["width"] <= width + 1


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_wf_cross_cutting_responsive(browser, app_url, viewport):
    owner = signup(app_url, "resp")
    set_name = f"Resp {uuid.uuid4().hex[:6]}"
    create_set(owner, set_name)
    w, h = VIEWPORTS[viewport]
    with editor(browser, owner, set_name) as page:
        page.set_viewport_size({"width": w, "height": h})
        advance(page, 600)
        dims = page.evaluate("({sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight})")
        assert dims["sw"] <= w and dims["sh"] <= h, f"no document scroll at {viewport}: {dims}"
        if w >= WIDE_FROM_PX:
            layout(page)
        else:
            controls_inside(page, w, skip=page.get_by_role("complementary", name="Rig panel", exact=True))
        nav = page.get_by_role("navigation", name="Workbench", exact=True).bounding_box()
        canvas = stage(page).bounding_box()
        tabs = page.get_by_role("tablist", name="Workbench tabs", exact=True).bounding_box()
        assert tabs["y"] >= canvas["y"] + canvas["height"] - 1, "the timeline dock sits under the stage"
        if w >= WIDE_FROM_PX:
            menu = page.get_by_role("menubar", name="Set menu", exact=True).bounding_box()
            rig = page.get_by_role("complementary", name="Rig panel", exact=True).bounding_box()
            assert nav["x"] + nav["width"] <= canvas["x"] + 1 and nav["height"] >= h * 0.9
            assert menu["y"] + menu["height"] <= canvas["y"] + 1
            assert rig["x"] >= canvas["x"] + canvas["width"] - 1 and rig["x"] + rig["width"] <= w + 1
        else:
            assert nav["y"] + nav["height"] >= h - 2 and nav["y"] > canvas["y"], "dock along the bottom edge"
            for btn in page.get_by_role("navigation", name="Workbench", exact=True).get_by_role("button").all():
                b = btn.bounding_box()
                assert b["width"] >= TOUCH_MIN_PX and b["height"] >= TOUCH_MIN_PX
            toggle = page.get_by_role("button", name="Rig panel", exact=True)
            assert toggle.get_attribute("aria-expanded") == "false"
            toggle.click()
            eventually(page, lambda: toggle.get_attribute("aria-expanded") == "true", "the drawer opens")
            settle_page = page.get_by_role("complementary", name="Rig panel", exact=True)
            eventually(page, lambda: (lambda b: b and b["x"] >= -1 and b["x"] + b["width"] <= w + 1)(settle_page.bounding_box()),
                       "the drawer lies inside the viewport")
            layout(page)


def test_wf_cross_cutting_dialogs(browser, app_url):
    owner = signup(app_url, "dialogs")
    sid, set_name, lid, name = blank_set_with(owner)
    with editor(browser, owner, set_name) as page:
        select_layer(page, name)
        drawer(page, "Material")
        for opener_name, dialog_name in [("Tint", "Tint")]:
            opener = page.get_by_role("button", name=opener_name, exact=True)
            opener.click()
            dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
            eventually(page, visible(dialog), f"the {dialog_name} dialog")
            eventually(page, lambda: is_focused(dialog.get_by_role("spinbutton", name="Red", exact=True)), "focus on Red")
            for key in ["Shift+Tab"] * 5 + ["Tab"] * 7:
                page.keyboard.press(key)
                assert holds_focus(dialog), f"{key} stays inside {dialog_name}"
            page.keyboard.press("Escape")
            eventually(page, gone(dialog), "Escape closes it")
            eventually(page, lambda: is_focused(opener), "focus returns to the opener")
        tile(page, "Shows")
        inviter = page.get_by_role("button", name="Invite guest VJ", exact=True)
        inviter.click()
        dialog = page.get_by_role("dialog", name="Invite to this set", exact=True)
        eventually(page, visible(dialog), "the invite dialog")
        eventually(page, lambda: holds_focus(dialog), "focus inside the invite dialog")
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert holds_focus(dialog)
        page.keyboard.press("Escape")
        eventually(page, lambda: is_focused(inviter), "focus returns to Invite guest VJ")
        tile(page, "Layers")
        gizmos = page.get_by_role("toolbar", name="Gizmos", exact=True)
        reveal(page, name).focus()
        for key, mode in [("e", "Rotate"), ("r", "Scale"), ("w", "Move")]:
            page.keyboard.press(key)
            eventually(page, lambda m=mode: gizmos.get_by_role("radio", name=m, exact=True).is_checked(), f"{key} picks {mode}")
        gizmos.get_by_role("radio", name="Move", exact=True).focus()
        page.keyboard.press("r")
        eventually(page, lambda: gizmos.get_by_role("radio", name="Scale", exact=True).is_checked(), "R from the gizmo strip")
        reveal(page, name).focus()
        play = transport(page, "Play")
        page.keyboard.press("Space")
        eventually(page, lambda: play.get_attribute("aria-pressed") == "true", "Space plays from a tree row")
        page.keyboard.press("Space")
        eventually(page, lambda: play.get_attribute("aria-pressed") != "true", "Space pauses")
        transport(page, "Stop").click()
        drawer(page, "Shape")
        page.get_by_role("button", name=f"Keyframe {KEY_LABEL}", exact=True).focus()
        page.keyboard.press("k")
        eventually(page, lambda: [(k["property"], k["tick"]) for k in doc_of(owner, sid)["keys"]] == [("props.twist", 0)],
                   "K keys the focused row")


def test_autosave_announcements(browser, app_url):
    owner = signup(app_url, "autosave")
    sid, set_name, lid, name = blank_set_with(owner)
    with editor(browser, owner, set_name) as page:
        posts: list[str] = []
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and r.url.endswith("/ops") else None)
        select_layer(page, name)
        tw = field(page, "Shape", "Twist")
        tw.focus()
        page.keyboard.press("ArrowUp")
        advance(page, IDLE_COMMIT_MS - 500)
        assert posts == [], "nothing commits before two seconds idle"
        with held(page, "**/api/sets/*/ops") as hold:
            advance(page, 600)
            eventually(page, lambda: len(posts) == 1, "the idle commit is sent")
            eventually(page, text_is(status(page, "Autosave"), "Saving"), "'Saving' while in flight")
            hold.release()
        eventually(page, text_is(status(page, "Autosave"), "Saved"), "'Saved' after the acknowledgement")
        assert by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.1)
        tw.focus()
        page.keyboard.press("ArrowUp")
        reveal(page, name).focus()
        eventually(page, lambda: by_id(doc_of(owner, sid), lid)["props"]["twist"] == pytest.approx(0.2), "blur commits",
                   step_ms=10, seconds=5)


def test_motion_and_reduced_motion(browser, app_url):
    owner = signup(app_url, "motion")
    sid, set_name, lid, name = blank_set_with(owner)
    with editor(browser, owner, set_name) as page:
        advance(page, 500)
        f0 = frames(page)
        advance(page, IDLE_WINDOW_MS)
        assert frames(page) == f0, "nothing draws while paused and idle"
        transport(page, "Play").click()
        start = frames(page)
        advance(page, 1000)
        assert frames(page) - start >= MIN_FPS
        transport(page, "Pause").click()
        page.set_viewport_size({"width": 768, "height": 1024})
        rig = page.get_by_role("complementary", name="Rig panel", exact=True)
        page.get_by_role("button", name="Rig panel", exact=True).click()
        path = motion(rig, RIG_DRAWER_MS)
        assert path and path[0].get("x") != path[-1].get("x"), "the drawer slides"
        if "dt" in path[0]:
            assert (path[-1]["dt"] - path[0]["dt"]) * 1000 <= RIG_DRAWER_MS + 1, "slides within half a second"
        else:
            assert path[-2].get("x") == path[-1].get("x"), "settled within half a second"
        settle(rig)
        end = rig.bounding_box()
        assert end and end["x"] >= -1 and end["x"] + end["width"] <= NARROW_W + 1, "the open drawer lies inside the viewport"
    with editor(browser, owner, set_name, reduced_motion="reduce") as page:
        select_layer(page, name)
        tw = field(page, "Shape", "Twist")
        advance(page, 500)
        f0 = frames(page)
        box = tw.bounding_box()
        drag(page, (box["x"] + box["width"] / 2, box["y"] + box["height"] / 2), (1, 0), SCRUB_DRAG_PX, release=False)
        assert frames(page) == f0, "no per-frame redraw during a reduced-motion scrub"
        page.mouse.up()
        advance(page, 500)
        assert frames(page) == f0 + 1, "exactly one frame per release"
        page.set_viewport_size({"width": 768, "height": 1024})
        rig = page.get_by_role("complementary", name="Rig panel", exact=True)
        page.get_by_role("button", name="Rig panel", exact=True).click()
        b = sample(rig)
        assert b["x"] >= -1 and b["x"] + b["width"] <= NARROW_W + 1, "the drawer appears at once"
        assert not [a for a in animations(rig) if float(a.get("duration") or 0) > 0]


def test_seed_inspector_components(browser, app_url):
    owner = signup(app_url, "seedui")
    box_name = f"Box {uuid.uuid4().hex[:4]}"
    sid, set_name, cube, name = blank_set_with(owner, "cube", box_name)
    tex = upload_ready(owner, sid, "texture", f"seed-{uuid.uuid4().hex[:4]}.png", make_png(uuid.uuid4().hex), "image/png")
    set_layer(owner, sid, cube, "material.albedo_texture_id", tex["id"])
    set_layer(owner, sid, cube, "output_buses", ["main", "side"])
    with editor(browser, owner, set_name) as page:
        gizmos = page.get_by_role("toolbar", name="Gizmos", exact=True)
        for mode in ("Move", "Rotate", "Scale"):
            assert gizmos.get_by_role("radio", name=mode, exact=True).count() == 1
        snapping = page.get_by_role("toolbar", name="Snapping", exact=True)
        for pill in ("Grid snap", "Angle snap"):
            btn = snapping.get_by_role("button", name=pill, exact=True)
            first = btn.get_attribute("aria-pressed")
            assert first in ("true", "false"), "snap pills carry aria-pressed"
            btn.click()
            eventually(page, lambda b=btn, f=first: b.get_attribute("aria-pressed") != f, f"{pill} toggles")
            btn.click()
            eventually(page, lambda b=btn, f=first: b.get_attribute("aria-pressed") == f, f"{pill} toggles back")
        select_layer(page, "Stage")
        assert page.get_by_role("region", name="Inspector", exact=True).get_by_role(
            "button", name="Outputs", exact=True).count() == 0, "groups show no Outputs drawer"
        select_layer(page, name)
        inspector = page.get_by_role("region", name="Inspector", exact=True)
        assert inspector.get_by_role("heading", level=2, name=name, exact=True).count() == 1
        assert inspector.get_by_role("button", name="Take lock", exact=True).count() == 1
        drawer(page, "Material")
        tint = page.get_by_role("button", name="Tint", exact=True)
        tint.click()
        tint_dialog = page.get_by_role("dialog", name="Tint", exact=True)
        eventually(page, visible(tint_dialog), "the Tint dialog")
        for channel in ("Red", "Green", "Blue"):
            assert tint_dialog.get_by_role("spinbutton", name=channel, exact=True).count() == 1
        page.keyboard.press("Escape")
        eventually(page, gone(tint_dialog), "Escape closes Tint")
        albedo = page.get_by_role("group", name="Albedo texture", exact=True)
        emissive = page.get_by_role("group", name="Emissive texture", exact=True)
        eventually(page, lambda: tex["name"] in text(albedo), "the albedo slot shows the texture name")
        assert "Texture" in text(emissive), "the empty slot shows the placeholder"
        for slot in (albedo, emissive):
            assert slot.get_by_role("button", name=re.compile(r"^Browse texture for ")).count() == 1
        page.get_by_role("button", name=f"Clear {SLOT_NAME}", exact=True).click()
        eventually(page, lambda: by_id(doc_of(owner, sid), cube)["material"]["albedo_texture_id"] is None, "Clear unbinds")
        drawer(page, "Outputs")
        ticked = [re.escape(n) for n in ("Main", "Side screens")]
        listed = re.compile(r"\s*,\s*".join(ticked) + "|" + r"\s*,\s*".join(reversed(ticked)))
        eventually(page, lambda: bool(listed.search(text(inspector))), "the field lists the ticked buses")
        page.get_by_role("button", name="Choose output buses", exact=True).click()
        buses = page.get_by_role("dialog", name="Output buses", exact=True)
        eventually(page, visible(buses), "the Output buses dialog")
        assert buses.get_by_role("checkbox", name="Main", exact=True).is_checked()
        assert buses.get_by_role("checkbox", name="Side screens", exact=True).is_checked()
        assert not buses.get_by_role("checkbox", name="LED strip", exact=True).is_checked()
        page.keyboard.press("Escape")
        eventually(page, gone(buses), "Escape closes Output buses")


def test_if_run_manifest():
    m = json.loads(Path("/app/run.json").read_text())
    assert m["_schema"] == "run-manifest-v1"
    assert all(isinstance(m[k], str) and m[k].strip() for k in ("install", "build", "serve"))


def test_if_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for p in shipped_packages():
        assert p.name in notices and str(p.version) in notices, f"{p.name}@{p.version} listed"
    for font in ["Arimo", "PT Sans", "JetBrains Mono"]:
        assert font in notices


def test_if_licences():
    bad = [f"{p.name}@{p.version}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, bad
    assert "OFL-1.1" in Path("/app/THIRD_PARTY_NOTICES.md").read_text()


def test_if_datastores():
    banned = {"sqlite3", "better-sqlite3", "sql.js", "@libsql/client", "lowdb", "nedb", "level", "mongodb", "mysql",
              "mysql2", "pouchdb", "lokijs"}
    assert not [p.name for p in shipped_packages() if p.name in banned]
    files = [f for f in DEPLOYED_APP.rglob("*") if f.suffix in {".sqlite", ".sqlite3", ".db"} and "node_modules" not in f.parts]
    assert not files, files
    assert Postgres().tables()


def test_if_no_third_party(browser, app_url):
    owner = signup(app_url, "origin")
    set_name = f"Origin {uuid.uuid4().hex[:6]}"
    create_set(owner, set_name)
    with open_app(browser, app_url + "/") as page:
        urls: list[str] = []
        page.context.on("request", lambda r: urls.append(r.url))
        page.reload()
        sign_in_ui(page, owner)
        open_set(page, set_name)
        advance(page, 1000)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, foreign


def test_if_service_config(app_url, valkey):
    owner = signup(app_url, "creds")
    sid = create_set(owner)["set"]["id"]
    asset = upload_ready(owner, sid, "texture", "c.png", make_png(uuid.uuid4().hex), "image/png")
    assert Postgres().rows("SELECT 1 AS ok") == [{"ok": 1}]
    assert f"sets/{sid}/assets/{asset['id']}" in S3().keys(f"sets/{sid}/")
    assert valkey.command("PING") in ("PONG", True, b"PONG")


def test_if_lockfile():
    source = Path("/app/package-lock.json")
    assert source.is_file()
    assert (DEPLOYED_APP / "package-lock.json").read_bytes() == source.read_bytes()
