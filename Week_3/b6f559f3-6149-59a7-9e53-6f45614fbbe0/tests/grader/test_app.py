from __future__ import annotations

import concurrent.futures
import contextlib
import base64
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
import time
import uuid
import zlib
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

import conftest
from conftest import (
    S3,
    Mailpit,
    addresses,
    advance,
    camera,
    capture,
    click,
    decode,
    difference,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    motion,
    open_app,
    same_origin,
    select,
    shipped_packages,
    style,
    tap,
    text,
    unique,
)

INES = "ines@lumenyard.test"
MARA = "mara@lumenyard.test"
TOMAS = "tomas@lumenyard.test"
PAVEL = "pavel@quarryhall.test"
PASSWORDS = {INES: "halation-ines-01", MARA: "halation-mara-01", TOMAS: "halation-tomas-01", PAVEL: "halation-pavel-01"}
NAMES = {INES: "Ines Okafor", MARA: "Mara Lindqvist", TOMAS: "Tomas Reyes", PAVEL: "Pavel Duarte"}

AUTOSAVE_MS = 800
LOCK_TIMEOUT_S = 30
PUBLISH_LIMIT = 20
INVITE_TTL_H = 72
MODEL_MAX_BYTES = 2097152
MODEL_MAX_VERTICES = 50000
JSON_MAX_BYTES = 1048576
PURGE_DAYS = 30
LIVE_S = 2
LEAVE_MS = 1200
MAIL_RETRY_S = 10
LIGHT_RISE_MS = 800
FRAME_MS = 1000 / 60
REST_FOCUS = "0.800, 0.900"

GRADING_KEY = os.environ.get("GRADING_KEY", "hs-grading-key-5e1c9a7d")
APP_TIME_ZONE = os.environ.get("APP_TIME_ZONE", "Europe/Lisbon")
DEPLOYED_APP = getattr(conftest, "DEPLOYED_APP", Path("/app"))
APP_ROOT = Path("/app")
HTTP_TIMEOUT = 120
WAIT_S = 30
FOCUS_TRIES = 25
SETTLE_MS = 400
WRONG_DEVICE_TIME = datetime(2031, 3, 1, 3, 0, tzinfo=timezone.utc)
FOREIGN_ORIGIN = "http://elsewhere.invalid"

SPRING = {"type": "spring", "stiffness": 170, "damping": 26, "mass": 1}


def r3(x: float) -> str:
    q = math.floor(abs(x) * 1000 + 0.5) / 1000
    v = q if x >= 0 else -q
    return "0.000" if v == 0 else f"{v:.3f}"


def vec(*xs: float) -> str:
    return ", ".join(r3(x) for x in xs)


SVG_NAME = "mark.svg"
CORS_HEADER = "access-control-allow-origin"
MUST_BETWEEN = "Must be between"
PROPERTY_KEY = "property"


def cloth_text(name: str, x: float, y: float, z: float) -> str:
    return f"Cloth point {name} at {vec(x, y, z)}"


def particle_text(n: int, x: float, y: float, z: float) -> str:
    return f"Particle {n} at {vec(x, y, z)}"


def azimuth_text(a: float) -> str:
    return f"Camera azimuth {r3(a)}°"


def tilt_target_text(x: float, y: float) -> str:
    return f"Tilt target {vec(x, y)}"


def counts_text(editors: int, viewers: int) -> str:
    e = "editor" if editors == 1 else "editors"
    v = "viewer" if viewers == 1 else "viewers"
    return f"{editors} {e} · {viewers} {v}"


def property_readout(page: Page, field: str) -> Locator:
    return page.get_by_role("region", name="Readouts").locator(f'[data-readout="{PROPERTY_KEY}"]').filter(has_text=re.compile(rf"^{field} "))


def sample_text(hexstr: str) -> str:
    r, g, b = (int(hexstr[i:i + 2], 16) for i in (0, 2, 4))
    return f"#{hexstr.upper()} · rgb({r}, {g}, {b})"


def rgb_hex(r: int, g: int, b: int) -> str:
    return f"{r:02X}{g:02X}{b:02X}"


def time_readout(frame: int) -> str:
    ms = int(math.floor(frame * 1000 / 60 + 0.5))
    return f"{ms // 60000:02d}:{(ms // 1000) % 60:02d}.{ms % 1000:03d}"


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def local_date_time(value: datetime) -> tuple[str, str]:
    d = value.astimezone(ZoneInfo(APP_TIME_ZONE))
    return f"{d.day} {d.strftime('%b')} {d.year}", d.strftime("%H:%M")


def imul(a: int, b: int) -> int:
    return (a * b) & 0xFFFFFFFF


def mulberry32(seed: int) -> Callable[[], float]:
    state = [seed & 0xFFFFFFFF]

    def nxt() -> float:
        state[0] = (state[0] + 0x6D2B79F5) & 0xFFFFFFFF
        t = state[0]
        t = imul(t ^ (t >> 15), t | 1)
        t ^= (t + imul(t ^ (t >> 7), t | 61)) & 0xFFFFFFFF
        return ((t ^ (t >> 14)) & 0xFFFFFFFF) / 4294967296

    return nxt


def norm(value: Any) -> Any:
    if isinstance(value, bool) or value is None or isinstance(value, str):
        return value
    if isinstance(value, (int, float)):
        return round(float(value), 3)
    if isinstance(value, dict):
        return {k: norm(v) for k, v in value.items()}
    if isinstance(value, list):
        return [norm(v) for v in value]
    return value


def new_id(prefix: str) -> str:
    return f"{prefix}{uuid.uuid4().hex[:16]}"


def fresh_email(prefix: str = "guest") -> str:
    a, b = unique(prefix)
    return (b if "@" in b else a).lower()


def fresh_name(prefix: str) -> str:
    a, b = unique(prefix)
    token = a if "@" not in a else b
    return f"{prefix} {token}"[:40]


def http(method: str, base: str, path: str, sess: str | None = None, *, headers: dict | None = None, **kw: Any) -> httpx.Response:
    h = dict(headers or {})
    if sess:
        h["Cookie"] = f"hs_session={sess}"
    with httpx.Client(base_url=base, timeout=HTTP_TIMEOUT, follow_redirects=False) as c:
        return c.request(method, path, headers=h, **kw)


def expect_status(r: httpx.Response, status: int, what: str) -> httpx.Response:
    assert r.status_code == status, f"{what}: expected {status}, got {r.status_code} {r.text[:600]}"
    return r


def expect_error(r: httpx.Response, status: int, code: str, message: str | None, what: str) -> dict:
    expect_status(r, status, what)
    body = r.json()
    assert body.get("error") == code, f"{what}: error code {body!r}"
    if message is not None:
        assert body.get("message") == message, f"{what}: message {body!r}"
    return body


def grading(base: str, path: str, body: Any = None, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key else {}
    return http("POST", base, path, headers=headers, json=body if body is not None else {})


def server_now(base: str) -> datetime:
    r = expect_status(grading(base, "/api/grading/clock", {"advanceMs": 0}), 200, "clock read")
    return parse_iso(r.json()["now"])


def advance_server(base: str, ms: int) -> datetime:
    r = expect_status(grading(base, "/api/grading/clock", {"advanceMs": ms}), 200, "clock advance")
    now = parse_iso(r.json()["now"])
    for email, person in _SEEDS.get(base, {}).get("people", {}).items():
        resp = http("POST", base, "/api/session", json={"email": email, "password": PASSWORDS[email]})
        fresh = resp.cookies.get("hs_session") if resp.status_code == 200 else None
        if fresh:
            person["session"] = fresh
    return now


def outage_url(var: str) -> str:
    url = os.environ.get(var)
    if not url:
        pytest.fail(f"{var} is not set; the outage instance must be reachable")
    return url.rstrip("/")


_SEEDS: dict[str, dict] = {}


@pytest.fixture
def seed(app_url: str) -> dict:
    if app_url not in _SEEDS:
        expect_status(grading(app_url, "/api/grading/reset"), 200, "grading reset")
        r = expect_status(grading(app_url, "/api/grading/seed"), 201, "grading seed")
        _SEEDS[app_url] = r.json()
    return _SEEDS[app_url]


def S(seed: dict, email: str) -> str:
    return seed["people"][email]["session"]


@dataclass
class Proj:
    id: str
    name: str
    scenes: dict[str, str]
    layers: dict[str, str]

    @property
    def scene(self) -> str:
        return next(iter(self.scenes.values()))


def layer(name: str, kind: str, order: int, props: dict | None = None, **fields: Any) -> dict:
    d = {"id": new_id("l"), "name": name, "kind": kind, "order": order, "parentId": None, "props": props or {}}
    d.update(fields)
    return d


def scene(name: str, layers: list[dict], **fields: Any) -> dict:
    return {"id": new_id("s"), "name": name, "layers": layers, **fields}


def import_project(base: str, seed: dict, scenes: list[dict], *, who: str = INES, prefix: str = "Study", workspace: str = "Lumen Yard") -> Proj:
    name = fresh_name(prefix)
    body = json.dumps({"schemaVersion": 3, "name": name, "scenes": scenes}).encode()
    r = http("POST", base, "/api/imports", S(seed, who), data={"workspaceId": seed["workspaces"][workspace]},
             files={"file": ("scene.json", body, "application/json")})
    summary = expect_status(r, 201, "import project").json()["project"]
    return Proj(summary["id"], summary["name"], {s["name"]: s["id"] for s in scenes},
                {l["name"]: l["id"] for s in scenes for l in s["layers"]})


def cube(name: str, order: int = 0, **props: Any) -> dict:
    return layer(name, "Primitive", order, {"primitive": "Cube", **props})


def change(kind: str, **fields: Any) -> dict:
    return {"type": kind, **fields}


def ops(base: str, sess: str, p: Proj, changes: list[dict], *, scene_id: str | None = None, op_id: str | None = None) -> httpx.Response:
    return http("POST", base, f"/api/projects/{p.id}/ops", sess,
                json={"opId": op_id or new_id("op"), "sceneId": scene_id or p.scene, "changes": changes})


def set_layer(base: str, sess: str, p: Proj, name: str, values: dict, bp: str = "desktop") -> httpx.Response:
    return ops(base, sess, p, [change("updateLayer", layerId=p.layers[name], set=values, breakpoint=bp)])


def inspect(base: str, sess: str, p: Proj, scene_id: str | None = None, **q: Any) -> dict:
    params = {"scene": scene_id or p.scene, **{k: v for k, v in q.items() if v is not None}}
    r = http("GET", base, f"/api/projects/{p.id}/inspect", sess, params=params)
    return expect_status(r, 200, f"inspect {params}").json()


def publish(base: str, sess: str, pid: str, body: dict | None = None, key: str | None = None) -> httpx.Response:
    return http("POST", base, f"/api/projects/{pid}/versions", sess, json=body if body is not None else {},
                headers={"Idempotency-Key": key or idempotency_key()})


def upload(base: str, sess: str, pid: str, kind: str, fname: str, data: bytes, ctype: str) -> httpx.Response:
    return http("POST", base, f"/api/projects/{pid}/assets", sess, data={"kind": kind}, files={"file": (fname, data, ctype)})


def project(base: str, sess: str, pid: str) -> dict:
    return expect_status(http("GET", base, f"/api/projects/{pid}", sess), 200, "GET project").json()


def layers_by_name(document: dict) -> dict[str, dict]:
    return {l["name"]: l for s in document["scenes"] for l in s["layers"]}


def prop(lay: dict, path: str) -> Any:
    node: Any = lay.get("props", {})
    if path in node:
        return node[path]
    for part in path.split("."):
        node = node[part]
    return node


def versions(base: str, sess: str, pid: str) -> list[dict]:
    return expect_status(http("GET", base, f"/api/projects/{pid}/versions", sess), 200, "versions").json()["versions"]


def summary_of(base: str, sess: str, pid: str) -> dict:
    return project(base, sess, pid)["project"]


def mails(mail: Mailpit, *, to: str | None = None, subject: str | None = None, expected: int = 1, seconds: float = WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = [m for m in mail.messages()
                 if (to is None or to.lower() in [a.lower() for a in addresses(m.get("To"))])
                 and (subject is None or (m.get("Subject") or "") == subject)]
        if expected and len(found) >= expected:
            return found
    if expected == 0:
        return found
    pytest.fail(f"Mailpit: expected {expected} mail(s) to {to} with subject {subject!r}; found {len(found)}")


def token_from(message: dict) -> str:
    m = re.search(r"/invite/([A-Za-z0-9._~%-]+)", text(message))
    assert m, "invite mail carries the accept link /invite/<token> (L1061)"
    return m.group(1).rstrip(".")


def invite_and_accept(base: str, seed: dict, mail: Mailpit, p: Proj, email: str, role: str) -> None:
    r = http("POST", base, f"/api/projects/{p.id}/invites", S(seed, INES), json={"email": email, "role": role})
    expect_status(r, 201, f"invite {email}")
    msg = mails(mail, to=email, subject=f"Join {p.name} in Halation Studio")[0]
    r = http("POST", base, f"/api/invites/{token_from(msg)}/accept", json={"password": PASSWORDS[email]})
    expect_status(r, 200, f"accept invite for {email}")


@contextlib.contextmanager
def app_page(browser: Browser, base: str, path: str, sess: str | None = None, *, viewport: tuple[int, int] | None = None,
             wrong_clock: bool = False, **opts: Any) -> Iterator[Page]:
    with open_app(browser, base + "/signin", **opts) as page:
        if viewport:
            page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if sess:
            page.context.add_cookies([{"name": "hs_session", "value": sess, "url": base}])
        if wrong_clock:
            page.clock.set_system_time(WRONG_DEVICE_TIME)
        page.goto(base + path)
        yield page


def eventually(page: Page, check: Callable[[], bool], what: str, seconds: float = WAIT_S, step_ms: float = 50) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (PlaywrightError, ValueError, TypeError, KeyError) as exc:
            last = exc
        advance(page, step_ms)
    pytest.fail(f"{what} (last error: {last})")


def live(page: Page, check: Callable[[], bool], what: str, seconds: float = LIVE_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except (PlaywrightError, ValueError, TypeError):
            pass
        advance(page, 16)
    pytest.fail(f"{what} within {seconds} s")


def shows(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.is_visible()


def text_of(loc: Locator) -> str:
    return loc.first.inner_text().strip() if loc.count() else ""


def focused(loc: Locator) -> bool:
    for _ in range(FOCUS_TRIES):
        if loc.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            return True
    return False


def wait_editor(page: Page) -> None:
    eventually(page, lambda: shows(page.get_by_role("tree", name="Layers")), "editor shows the Layers tree (L132)")


def row(page: Page, name: str) -> Locator:
    return page.get_by_role("treeitem", name=re.compile(rf"^{re.escape(name)}, ")).first


def select_layer(page: Page, name: str) -> None:
    r = row(page, name)
    eventually(page, lambda: shows(r), f"layer row {name}")
    r.get_by_text(re.compile(rf"^{re.escape(name)}$")).first.click()


def spin(page: Page, name: str) -> Locator:
    return page.get_by_role("spinbutton", name=name, exact=True)


def field_num(loc: Locator) -> float:
    v = loc.get_attribute("aria-valuenow")
    if v is None or v == "":
        v = loc.input_value()
    return float(v)


def commit(page: Page, name: str, value: Any) -> None:
    f = spin(page, name)
    f.click()
    f.fill(str(value))
    f.press("Enter")


@contextlib.contextmanager
def saved(page: Page) -> Iterator[None]:
    with page.expect_response(lambda r: r.request.method == "POST" and r.url.split("?")[0].endswith("/ops"),
                              timeout=WAIT_S * 1000) as info:
        yield
        advance(page, AUTOSAVE_MS)
    assert info.value.status == 200, f"autosave ops answered {info.value.status}"
    eventually(page, lambda: text_of(page.get_by_role("status", name="Save status")) == "All changes saved",
               "Save status reads All changes saved (L294)")


def readout(page: Page, key: str) -> Locator:
    return page.get_by_role("region", name="Readouts").locator(f'[data-readout="{key}"]').first


def readout_is(page: Page, key: str, expected: str, what: str = "") -> None:
    eventually(page, lambda: text_of(readout(page, key)) == expected,
               f"readout {key} shows {expected!r} {what} (now {text_of(readout(page, key))!r})")


def editor_status(page: Page, expected: str) -> None:
    eventually(page, lambda: text_of(page.get_by_role("status", name="Editor status")) == expected
               or shows(page.get_by_text(expected, exact=True)), f"status shows {expected!r}")


def seek(page: Page, frame: int) -> Locator:
    ph = page.get_by_role("slider", name="Playhead")
    ph.focus()
    ph.press("Home")
    for _ in range(frame // 10):
        ph.press("Shift+ArrowRight")
    for _ in range(frame % 10):
        ph.press("ArrowRight")
    eventually(page, lambda: field_num(ph) == frame, f"Playhead at frame {frame}")
    return ph


def drag(page: Page, loc: Locator, dx: float, dy: float, shift: bool = False) -> None:
    boxes: list = []
    eventually(page, lambda: boxes.append(loc.bounding_box()) or boxes[-1] is not None, "drag handle is on screen")
    box = boxes[-1]
    x, y = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
    if shift:
        page.keyboard.down("Shift")
    page.mouse.move(x, y)
    page.mouse.down()
    page.mouse.move(x + dx, y + dy, steps=10)
    page.mouse.up()
    if shift:
        page.keyboard.up("Shift")


def choose_menu_item(page: Page, name: str) -> Locator:
    item = page.get_by_role("menuitem", name=name, exact=True)
    eventually(page, lambda: shows(item), f"menu item {name}")
    return item


def embed_values(page: Page, layer_name: str) -> dict:
    item = page.get_by_role("list", name="Scene values").locator(f'[data-layer-name="{layer_name}"]').first
    return json.loads(item.get_attribute("data-values"))


def png(w: int, h: int, rgb: tuple[int, int, int] = (0x33, 0x66, 0x99)) -> bytes:
    raw = b"".join(b"\0" + bytes(rgb) * w for _ in range(h))

    def chunk(t: bytes, d: bytes) -> bytes:
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw)) + chunk(b"IEND", b""))


def svg(*paths: str) -> bytes:
    body = "".join(f'<path d="{d}"/>' for d in paths)
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400">{body}</svg>'.encode()


def _pad4(b: bytes) -> bytes:
    return b + b"\0" * ((4 - len(b) % 4) % 4)


def gltf_parts(*, version: str = "2.0", matrix: bool = False, turn_interp: str = "LINEAR", vertex_count: int | None = None,
               compressed: bool = False) -> tuple[dict, bytes]:
    views: list[dict] = []
    accessors: list[dict] = []
    blob = b""

    def add(data: bytes, acc: dict) -> int:
        nonlocal blob
        blob = _pad4(blob)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data)})
        blob += data
        accessors.append({"bufferView": len(views) - 1, **acc})
        return len(accessors) - 1

    if vertex_count is None:
        pos: list[float] = []
        nrm: list[float] = []
        idx: list[int] = []
        for axis in range(3):
            for sign in (1, -1):
                base = len(pos) // 3
                others = [a for a in range(3) if a != axis]
                for u, v in ((-0.5, -0.5), (0.5, -0.5), (0.5, 0.5), (-0.5, 0.5)):
                    p = [0.0, 0.0, 0.0]
                    p[axis] = 0.5 * sign
                    p[others[0]], p[others[1]] = u, v
                    pos += p
                    n = [0.0, 0.0, 0.0]
                    n[axis] = float(sign)
                    nrm += n
                idx += [base, base + 1, base + 2, base, base + 2, base + 3]
        count = len(pos) // 3
        a_pos = add(struct.pack(f"<{len(pos)}f", *pos), {"componentType": 5126, "count": count, "type": "VEC3", "min": [-0.5] * 3, "max": [0.5] * 3})
        a_nrm = add(struct.pack(f"<{len(nrm)}f", *nrm), {"componentType": 5126, "count": count, "type": "VEC3"})
        a_idx = add(struct.pack(f"<{len(idx)}H", *idx), {"componentType": 5123, "count": len(idx), "type": "SCALAR"})
        prim = {"attributes": {"POSITION": a_pos, "NORMAL": a_nrm}, "indices": a_idx, "mode": 4}
    else:
        zeros = bytes(12 * vertex_count)
        a_pos = add(zeros, {"componentType": 5126, "count": vertex_count, "type": "VEC3", "min": [0, 0, 0], "max": [0, 0, 0]})
        a_nrm = add(zeros, {"componentType": 5126, "count": vertex_count, "type": "VEC3"})
        prim = {"attributes": {"POSITION": a_pos, "NORMAL": a_nrm}, "mode": 4}
    s45 = math.sin(math.radians(45))
    t_in = add(struct.pack("<2f", 0, 2), {"componentType": 5126, "count": 2, "type": "SCALAR", "min": [0], "max": [2]})
    t_rot = add(struct.pack("<8f", 0, 0, 0, 1, 0, s45, 0, s45), {"componentType": 5126, "count": 2, "type": "VEC4"})
    t_tr = add(struct.pack("<6f", 0, 0, 0, 2, 1, 0), {"componentType": 5126, "count": 2, "type": "VEC3"})
    h_in = add(struct.pack("<3f", 0, 0.5, 1), {"componentType": 5126, "count": 3, "type": "SCALAR", "min": [0], "max": [1]})
    h_tr = add(struct.pack("<9f", 0, 0, 0, 0, 1, 0, 0, 0, 0), {"componentType": 5126, "count": 3, "type": "VEC3"})
    arm: dict = {"name": "Arm", "mesh": 0}
    if matrix:
        arm["matrix"] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
    doc: dict = {
        "asset": {"version": version},
        "scene": 0,
        "scenes": [{"nodes": [0, 1]}],
        "nodes": [arm, {"name": "Foot", "mesh": 0, "translation": [0, -1, 0]}],
        "meshes": [{"primitives": [prim]}],
        "accessors": accessors,
        "bufferViews": views,
        "buffers": [{"byteLength": len(blob)}],
        "animations": [
            {"name": "Turn", "samplers": [{"input": t_in, "output": t_rot, "interpolation": turn_interp},
                                          {"input": t_in, "output": t_tr, "interpolation": turn_interp}],
             "channels": [{"sampler": 0, "target": {"node": 0, "path": "rotation"}},
                          {"sampler": 1, "target": {"node": 0, "path": "translation"}}]},
            {"name": "Hop", "samplers": [{"input": h_in, "output": h_tr, "interpolation": "STEP"}],
             "channels": [{"sampler": 0, "target": {"node": 1, "path": "translation"}}]},
        ],
    }
    if compressed:
        doc["extensionsUsed"] = ["KHR_draco_mesh_compression"]
        doc["extensionsRequired"] = ["KHR_draco_mesh_compression"]
    return doc, blob


def gltf_bytes(external: bool = False, pad_to: int | None = None, **kw: Any) -> bytes:
    doc, blob = gltf_parts(**kw)
    doc["buffers"][0]["uri"] = "swing.bin" if external else "data:application/octet-stream;base64," + base64.b64encode(blob).decode()
    out = json.dumps(doc).encode()
    if pad_to is not None:
        out += b" " * (pad_to - len(out))
    return out


def glb_bytes() -> bytes:
    doc, blob = gltf_parts()
    j = json.dumps(doc).encode()
    j += b" " * ((4 - len(j) % 4) % 4)
    b = _pad4(blob)
    total = 12 + 8 + len(j) + 8 + len(b)
    return (struct.pack("<III", 0x46546C67, 2, total) + struct.pack("<II", len(j), 0x4E4F534A) + j
            + struct.pack("<II", len(b), 0x004E4942) + b)


def model_project(base: str, seed: dict, prefix: str) -> tuple[Proj, str, bytes]:
    p = import_project(base, seed, [scene("Main", [])], prefix=prefix)
    data = gltf_bytes()
    r = upload(base, S(seed, INES), p.id, "model", "swing.gltf", data, "model/gltf+json")
    asset = expect_status(r, 201, "upload swing.gltf").json()["asset"]
    return p, asset["id"], data


def add_layer(base: str, sess: str, p: Proj, lay: dict) -> str:
    ref = new_id("ref")
    top = [l for l in project(base, sess, p.id)["document"]["scenes"][0]["layers"] if l.get("parentId") is None]
    lay = {"parentId": None, "order": len(top), **lay}
    r = ops(base, sess, p, [change("addLayer", layer=lay, ref=ref)])
    new = expect_status(r, 200, f"addLayer {lay.get('name')}").json()["ids"][ref]
    p.layers[lay["name"]] = new
    return new


def test_health_reports_storage(app_url: str) -> None:
    r = expect_status(http("GET", app_url, "/api/health"), 200, "health")
    assert r.json() == {"status": "ok"}
    r = expect_status(http("GET", outage_url("APP_MINIO_DOWN_URL"), "/api/health"), 200, "health with storage down is never 503")
    assert r.json() == {"status": "unavailable"}


def test_grading_routes_hidden_and_seed_map(app_url: str, seed: dict) -> None:
    for path, body in (("/api/grading/reset", {}), ("/api/grading/seed", {}), ("/api/grading/clock", {"advanceMs": 0})):
        assert grading(app_url, path, body, key=None).status_code == 404, f"{path} without key"
        assert grading(app_url, path, body, key="not-the-key").status_code == 404, f"{path} with a wrong key"
    before = server_now(app_url)
    after = advance_server(app_url, 60000)
    assert after - before >= timedelta(seconds=60), "clock route moves the server clock forward by advanceMs"
    assert after - before < timedelta(seconds=180), "clock moves by advanceMs plus real time only"
    assert set(seed["workspaces"]) >= {"Lumen Yard", "Quarry Hall"}
    for email in (INES, MARA, TOMAS, PAVEL):
        person = seed["people"][email]
        assert person["name"] == NAMES[email] and person["id"]
        me = expect_status(http("GET", app_url, "/api/me", person["session"]), 200, f"session of {email}").json()
        assert me["user"]["email"] == email
    projects = seed["projects"]
    for name in ("Lumen hero", "Orbit study", "Logo forge", "Model bay", "Banner test", "Easing lab", "Variable room",
                 "Backdrop", "Phone kit", "Quarry teaser"):
        assert projects[name]["id"], f"seed map lists {name}"
    assert projects["Model bay"]["versions"] == [1]
    assert projects["Lumen hero"]["versions"] == []
    assert set(projects["Backdrop"]["scenes"]) == {"Blend", "Ramp", "Grain"}
    assert set(projects["Lumen hero"]["layers"]) >= {"Halo cube", "Pebble", "Swing", "Sparks"}
    assert set(projects["Model bay"]["assets"]) >= {"swing.gltf", "grain-plate.png"}
    down = outage_url("APP_MAILPIT_DOWN_URL")
    expect_status(grading(down, "/api/grading/reset"), 200, "reset copy")
    expect_status(grading(down, "/api/grading/seed"), 201, "seed copy")
    expect_status(http("POST", down, "/api/session", json={"email": INES, "password": PASSWORDS[INES]}), 200, "seeded sign-in")
    assert grading(down, "/api/grading/reset").json() == {"status": "reset"}
    expect_error(http("POST", down, "/api/session", json={"email": INES, "password": PASSWORDS[INES]}), 401,
                 "bad_credentials", "Email or password is incorrect.", "people are gone after reset")


def test_signin_by_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    r = http("POST", app_url, "/api/session", json={"email": INES, "password": "wrong-password-0"})
    expect_error(r, 401, "bad_credentials", "Email or password is incorrect.", "bad credentials")
    assert "hs_session" not in r.cookies
    with open_app(browser, app_url + "/signin") as page:
        email = page.get_by_role("textbox", name="Email")
        password = page.get_by_role("textbox", name="Password")
        for _ in range(25):
            if focused(email):
                break
            page.keyboard.press("Tab")
        else:
            pytest.fail("Tab reaches the Email field on /signin")
        page.keyboard.type(INES)
        page.keyboard.press("Tab")
        assert focused(password), "Tab moves from Email to Password"
        page.keyboard.type("wrong-password-0")
        page.keyboard.press("Enter")
        eventually(page, lambda: text_of(page.get_by_role("alert")) == "Email or password is incorrect.", "sign-in error alert (L309)")
        assert not any(c["name"] == "hs_session" for c in page.context.cookies())
        password.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(PASSWORDS[INES])
        with held(page, "**/api/session") as gate:
            page.keyboard.press("Enter")
            eventually(page, lambda: shows(page.get_by_role("button", name="Signing in…")), "pending copy Signing in… (L309)")
            gate.release()
        eventually(page, lambda: page.url.rstrip("/").endswith("/projects"), "lands on the project list")
        cookie = next((c for c in page.context.cookies() if c["name"] == "hs_session"), None)
        assert cookie and cookie["httpOnly"] and cookie["sameSite"] == "Lax" and cookie["path"] == "/", f"hs_session cookie {cookie}"


def _project_routes(pid: str) -> list[tuple[str, str, dict]]:
    return [
        ("GET", f"/api/projects/{pid}", {}),
        ("GET", f"/api/projects/{pid}/versions", {}),
        ("GET", f"/api/projects/{pid}/members", {}),
        ("GET", f"/api/projects/{pid}/export", {}),
        ("GET", f"/api/projects/{pid}/inspect", {"params": {"scene": "x"}}),
        ("POST", f"/api/projects/{pid}/ops", {"json": {"opId": new_id("op"), "sceneId": "x", "changes": []}}),
        ("POST", f"/api/projects/{pid}/versions", {"json": {}, "headers": {"Idempotency-Key": idempotency_key()}}),
        ("POST", f"/api/projects/{pid}/invites", {"json": {"email": fresh_email("probe"), "role": "Editor"}}),
        ("DELETE", f"/api/projects/{pid}", {}),
        ("POST", f"/api/projects/{pid}/restore", {}),
    ]


def test_unseen_projects_answer_404(app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    purged = import_project(app_url, seed, [scene("Main", [cube("Slab")])], prefix="Purge")
    expect_status(publish(app_url, ines, purged.id), 201, "publish before trash")
    expect_status(http("DELETE", app_url, f"/api/projects/{purged.id}", ines), 200, "trash")
    advance_server(app_url, PURGE_DAYS * 86400000 + 60000)
    ines = S(seed, INES)
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        if http("GET", app_url, f"/api/projects/{purged.id}", ines).status_code == 404:
            break
    else:
        pytest.fail("GET /api/projects/<id> never answered 404 after the purge date passed; expected 404 for a purged project")
    projects = seed["projects"]
    unknown = new_id("p")
    cases = [
        (ines, projects["Quarry teaser"]["id"], "another workspace's project"),
        (S(seed, PAVEL), projects["Lumen hero"]["id"], "another workspace's project"),
        (S(seed, MARA), projects["Orbit study"]["id"], "project Mara is not a member of"),
        (ines, unknown, "unknown project"),
        (ines, purged.id, "purged project"),
    ]
    for sess, pid, label in cases:
        for method, path, kw in _project_routes(pid):
            r = http(method, app_url, path, sess, **kw)
            expect_error(r, 404, "not_found", "Not found.", f"{label}: {method} {path}")
    for pid, label in ((projects["Lumen hero"]["id"], "unpublished"), (unknown, "unknown"), (purged.id, "purged")):
        r = http("GET", app_url, f"/embed/{pid}")
        assert r.status_code == 404 and "This scene is not published." in r.text, f"{label} embed page"
        assert http("GET", app_url, f"/api/embed/{pid}/scene").status_code == 404, f"{label} embed scene"
        assert http("GET", app_url, f"/api/embed/{pid}/version").status_code == 404, f"{label} embed version"
    deadline = time.monotonic() + WAIT_S
    left = S3().keys(f"projects/{purged.id}/")
    while left and time.monotonic() < deadline:
        left = S3().keys(f"projects/{purged.id}/")
    assert left == [], "purge removes every stored object (L498)"


def test_error_order_and_shape(app_url: str, seed: dict, mail: Mailpit) -> None:
    ines, tomas = S(seed, INES), S(seed, TOMAS)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Order")
    bad = [change("updateLayer", layerId=p.layers["Block"], set={"position.x": 1000}, breakpoint="desktop")]
    body = {"opId": new_id("op"), "sceneId": p.scene, "changes": bad}
    r = http("POST", app_url, f"/api/projects/{p.id}/ops", headers={"Origin": FOREIGN_ORIGIN}, json=body)
    expect_error(r, 403, "cross_origin", "Requests must come from this site.", "cross-origin write before sign-in")
    assert CORS_HEADER not in {k.lower() for k in r.headers}
    expect_error(http("POST", app_url, f"/api/projects/{new_id('p')}/ops", json=body), 401, "unauthenticated", "Sign in to continue.", "401 first")
    expect_error(publish(app_url, S(seed, MARA), seed["projects"]["Orbit study"]["id"]), 404, "not_found", "Not found.", "404 before 403")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    good_id = new_id("op")
    first = expect_status(set_layer_with(app_url, ines, p, good_id), 200, "valid op").json()
    expect_status(http("DELETE", app_url, f"/api/projects/{p.id}", ines), 200, "trash")
    expect_error(ops(app_url, tomas, p, bad), 403, "forbidden", "Viewers can't edit this project.", "403 before 409/422")
    replay = expect_status(set_layer_with(app_url, ines, p, good_id), 200, "replay after 403 checks, before 409")
    assert replay.json() == first, "replayed opId returns the stored response"
    expect_error(ops(app_url, ines, p, bad), 409, "trashed", "This project is in the trash. Restore it to edit.", "409 before 422")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/restore", ines), 200, "restore")
    err = expect_error(ops(app_url, ines, p, bad), 422, "validation", None, "422 validation")
    assert any(v.startswith(MUST_BETWEEN) for v in err["errors"].values())
    assert err["message"] == next(iter(err["errors"].values())), "message is the first field message"
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.x") == 1, "refused write changed nothing"
    r = http("POST", app_url, f"/api/projects/{p.id}/ops", ines, headers={"Content-Type": "text/plain"}, content=b"{}")
    expect_error(r, 415, "unsupported_media_type", "Send application/json.", "415")
    head = json.dumps({"opId": new_id("op"), "sceneId": p.scene, "changes": []}).encode()
    for size, too_big in ((JSON_MAX_BYTES, False), (JSON_MAX_BYTES + 1, True)):
        r = http("POST", app_url, f"/api/projects/{p.id}/ops", ines, headers={"Content-Type": "application/json"},
                 content=head + b" " * (size - len(head)))
        if too_big:
            expect_error(r, 413, "too_large", "Request body is larger than 1048576 bytes.", "body over the limit")
        else:
            assert r.status_code != 413, "a body of exactly 1,048,576 bytes is allowed"
    q = import_project(app_url, seed, [scene("Main", [cube("Slab")])], prefix="Limit")
    for n in range(PUBLISH_LIMIT):
        expect_status(publish(app_url, ines, q.id), 201, f"publish {n + 1}")
    limit_msg = f"This project has reached its limit of {PUBLISH_LIMIT} published versions."
    expect_error(publish(app_url, ines, q.id), 409, "limit_reached", limit_msg, "limit")
    down = outage_url("APP_MINIO_DOWN_URL")
    expect_error(publish(down, ines, q.id), 409, "limit_reached", limit_msg, "limit before storage outage")
    r = http("POST", down, f"/api/projects/{q.id}/versions", ines, json={})
    expect_error(r, 422, "validation", None, "missing Idempotency-Key: 422 before limit and 503")
    assert len(versions(app_url, ines, q.id)) == PUBLISH_LIMIT


def set_layer_with(base: str, sess: str, p: Proj, op_id: str) -> httpx.Response:
    return ops(base, sess, p, [change("updateLayer", layerId=p.layers["Block"], set={"position.x": 1}, breakpoint="desktop")], op_id=op_id)


def test_invite_by_mail_single_use(app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Invite")
    guest = fresh_email("editor")
    expect_error(http("POST", app_url, f"/api/projects/{p.id}/invites", ines, json={"email": "not-an-email", "role": "Editor"}),
                 422, "validation", "Enter a valid email address.", "bad email")
    now = server_now(app_url)
    r = expect_status(http("POST", app_url, f"/api/projects/{p.id}/invites", ines, json={"email": guest, "role": "Editor"}), 201, "invite")
    expires = parse_iso(r.json()["invite"]["expiresAt"])
    assert timedelta(hours=INVITE_TTL_H) <= expires - now < timedelta(hours=INVITE_TTL_H, minutes=5), "expiry = now + INVITE_TTL_HOURS"
    expect_error(http("POST", app_url, f"/api/projects/{p.id}/invites", ines, json={"email": guest, "role": "Viewer"}),
                 422, "validation", f"An invite to {guest} is already pending.", "duplicate pending invite")
    sent = mails(mail, to=guest, subject=f"Join {p.name} in Halation Studio")
    assert len(mails(mail, to=guest, expected=0, seconds=3)) == 1, "exactly one invite mail"
    msg = sent[0]
    assert mail_from_address() in addresses(msg.get("From")) or mail_from_address() in str(msg.get("From"))
    body = text(msg)
    date, clock = local_date_time(expires)
    assert f"This link works once and expires on {date} at {clock}." in body
    assert "Ines Okafor" in body and "Editor" in body
    token = token_from(msg)
    members = http("GET", app_url, f"/api/projects/{p.id}/members", ines).json()
    assert guest not in [m["email"] for m in members["members"]], "no membership before accept"
    info = expect_status(http("GET", app_url, f"/api/invites/{token}"), 200, "invite info").json()
    assert info["projectName"] == p.name and info["role"] == "Editor" and info["email"] == guest and info["accountExists"] is False
    expect_error(http("POST", app_url, f"/api/invites/{token}/accept", ines, json={}), 409, "wrong_person",
                 f"This invite was sent to {guest}. Sign out to accept it.", "signed in as someone else")
    expect_error(http("POST", app_url, f"/api/invites/{token}/accept", json={"name": "Guest Editor", "password": "short"}),
                 422, "validation", "Choose a password of at least 10 characters.", "short password")
    r = expect_status(http("POST", app_url, f"/api/invites/{token}/accept", json={"name": "Guest Editor", "password": "guest-password-01"}), 200, "accept")
    assert r.json() == {"projectId": p.id, "role": "Editor"} or (r.json()["projectId"] == p.id and r.json()["role"] == "Editor")
    new_sess = r.cookies.get("hs_session")
    assert new_sess, "accepting signs the person in"
    assert project(app_url, new_sess, p.id)["project"]["role"] == "Editor"
    assert summary_of(app_url, ines, p.id)["editorCount"] == 1
    expect_error(http("POST", app_url, f"/api/invites/{token}/accept", json={"name": "Again", "password": "guest-password-01"}),
                 410, "invite_unavailable", "This invite link has already been used or has expired.", "second use")
    expect_error(http("POST", app_url, f"/api/projects/{p.id}/invites", ines, json={"email": guest, "role": "Viewer"}),
                 422, "validation", f"{guest} is already a member.", "invite to a member")
    late = fresh_email("late")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/invites", ines, json={"email": late, "role": "Viewer"}), 201, "second invite")
    late_token = token_from(mails(mail, to=late, subject=f"Join {p.name} in Halation Studio")[0])
    advance_server(app_url, INVITE_TTL_H * 3600000 + 60000)
    ines = S(seed, INES)
    expect_error(http("GET", app_url, f"/api/invites/{late_token}"), 410, "invite_unavailable", None, "expired token")
    expect_error(http("POST", app_url, f"/api/invites/{late_token}/accept", json={"name": "Late", "password": "guest-password-01"}),
                 410, "invite_unavailable", None, "expired accept")
    assert summary_of(app_url, ines, p.id)["viewerCount"] == 0


@pytest.mark.timeout(900)
def test_mail_outage_queues_and_sends_once(app_url: str, mail: Mailpit) -> None:
    down = outage_url("APP_MAILPIT_DOWN_URL")
    expect_status(grading(down, "/api/grading/reset"), 200, "reset mail-down copy")
    md = expect_status(grading(down, "/api/grading/seed"), 201, "seed mail-down copy").json()
    p = import_project(down, md, [scene("Main", [cube("Block")])], prefix="Queued")
    ines = S(md, INES)
    guest = fresh_email("queued")
    r = expect_status(http("POST", down, f"/api/projects/{p.id}/invites", ines, json={"email": guest, "role": "Editor"}), 201, "invite during outage")
    invites = http("GET", down, f"/api/projects/{p.id}/members", ines).json()["invites"]
    assert [i["status"] for i in invites if i["email"] == guest] == ["queued"]
    expect_status(publish(down, ines, p.id), 201, "publish during outage")
    assert [v["notice"] for v in versions(down, ines, p.id)] == ["queued"]
    invite_subject, notice_subject = f"Join {p.name} in Halation Studio", f"{p.name} version 1 is live"
    assert mails(mail, to=guest, subject=invite_subject, expected=0, seconds=3) == []
    manifest = json.loads((APP_ROOT / "run.json").read_text())
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ, APP_PUBLIC_PORT=str(port), DATABASE_URL=os.environ["DATABASE_URL"] + "_maildown",
               S3_BUCKET=os.environ["S3_BUCKET"] + "-maildown")
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
    try:
        copy = f"http://127.0.0.1:{port}"
        deadline = time.monotonic() + 120
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                log.seek(0)
                pytest.fail(f"mail-working copy exited: {log.read()[-2000:]}")
            try:
                if http("GET", copy, "/api/health").status_code == 200:
                    break
            except httpx.HTTPError:
                continue
        else:
            pytest.fail("mail-working copy never answered /api/health")
        mails(mail, to=guest, subject=invite_subject, seconds=MAIL_RETRY_S * 6)
        mails(mail, to=INES, subject=notice_subject, seconds=MAIL_RETRY_S * 6)
        end = time.monotonic() + MAIL_RETRY_S * 2.5
        while time.monotonic() < end:
            assert len(mails(mail, to=guest, subject=invite_subject, expected=0, seconds=1)) == 1, "invite sent exactly once"
            assert len(mails(mail, to=INES, subject=notice_subject, expected=0, seconds=1)) == 1, "notice sent exactly once"
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(timeout=30)


def test_autosave_and_reload(browser: Browser, app_url: str, seed: dict) -> None:
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Autosave")
    with app_page(browser, app_url, f"/projects/{p.id}", S(seed, INES)) as page:
        wait_editor(page)
        select_layer(page, "Block")
        sent: list[str] = []
        page.on("request", lambda req: sent.append(req.url) if req.method == "POST" and req.url.endswith("/ops") else None)
        with held(page, "**/ops") as gate:
            commit(page, "Position X", 3)
            advance(page, AUTOSAVE_MS)
            eventually(page, lambda: page.evaluate("1") == 1 and len(sent) >= 1, "ops request sent within AUTOSAVE_MS (L531)", step_ms=0)
            eventually(page, lambda: text_of(page.get_by_role("status", name="Save status")) == "Saving…", "Saving… while pending", step_ms=0)
            gate.release()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Save status")) == "All changes saved", "All changes saved")
        assert prop(layers_by_name(project(app_url, S(seed, INES), p.id)["document"])["Block"], "position.x") == 3
        page.reload()
        wait_editor(page)
        select_layer(page, "Block")
        eventually(page, lambda: field_num(spin(page, "Position X")) == 3, "Position X is 3 after reload")


def test_landing_follow_light_stage(browser: Browser, app_url: str) -> None:
    with open_app(browser, app_url + "/") as page:
        stage = page.get_by_role("region", name="Follow Light stage")
        eventually(page, lambda: shows(stage), "Follow Light stage visible", step_ms=0)
        level = lambda: float(stage.get_attribute("data-light-level"))
        assert level() == 0, "stage starts black (L268)"
        seen = []
        for _ in range(4):
            advance(page, LIGHT_RISE_MS / 4)
            seen.append(level())
        assert 0 < seen[0] < 1 and seen == sorted(seen), f"light climbs over 800 ms: {seen}"
        advance(page, SETTLE_MS)
        assert math.isclose(level(), 1, abs_tol=1e-3), "light settles at 1"
        assert stage.get_attribute("data-light-focus") == REST_FOCUS
        box = stage.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.25)
        advance(page, 500)
        fx, fy = (float(v) for v in stage.get_attribute("data-light-focus").split(","))
        assert fx < 0.8 and fy < 0.9, "light focus trails toward the pointer"
        header = page.get_by_role("banner").bounding_box()
        page.mouse.move(header["x"] + 5, header["y"] + 5)
        advance(page, LEAVE_MS + SETTLE_MS)
        assert stage.get_attribute("data-light-focus") == REST_FOCUS, "focus eases back to rest within 1.2 s"
        still_a = capture(stage)
        advance(page, 1000)
        assert difference(decode(still_a), decode(capture(stage))) == 0, "stage is completely still without input (L273)"
        h1 = page.get_by_role("heading", level=1, name="Scenes that hold their shape")
        word = h1.get_by_text("shape", exact=True)
        st = style(word, "font-family", "font-style")
        assert re.search(r"serif|georgia", st["font-family"], re.I)
        assert st["font-style"] == "italic"
        expect(page.get_by_role("link", name="New Republish any version as the next one")).to_be_visible()
        click(page.get_by_role("link", name="Open editor", exact=True))
        eventually(page, lambda: page.url.rstrip("/").endswith("/signin"), "Open editor goes to /signin when signed out")
    with open_app(browser, app_url + "/", reduced_motion="reduce") as page:
        stage = page.get_by_role("region", name="Follow Light stage")
        advance(page, 100)
        h1 = page.get_by_role("heading", level=1, name="Scenes that hold their shape")
        tops = lambda: h1.evaluate("e => [e, ...e.querySelectorAll('*')].map(c => Math.round(c.getBoundingClientRect().top))")
        start = tops()
        for _ in range(6):
            advance(page, 100)
            assert tops() == start, "headline appears with no movement under reduced motion"
        box = stage.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.25, box["y"] + box["height"] * 0.25)
        advance(page, 500)
        assert stage.get_attribute("data-light-focus") == REST_FOCUS, "light does not follow the pointer under reduced motion"


VIEWPORTS = {"375x812": (375, 812), "768x1024": (768, 1024), "1280x800": (1280, 800)}
TILE_COLUMNS = {375: 2, 768: 3, 1280: 4}
MOSAIC_COLUMNS = {375: 1, 768: 2, 1280: 3}
TARGET_PX = 44


@pytest.mark.parametrize("size", list(VIEWPORTS.values()), ids=list(VIEWPORTS))
def test_three_viewports_layout(browser: Browser, app_url: str, seed: dict, size: tuple[int, int]) -> None:
    w, h = size
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Layout")
    with app_page(browser, app_url, "/", viewport=size) as page:
        eventually(page, lambda: shows(page.get_by_role("region", name="Follow Light stage")), "landing")
        layout(page)
        banner = page.get_by_role("banner")
        expect(banner.get_by_role("link", name="Halation Studio home")).to_be_visible()
        expect(banner.get_by_role("link", name="Sign in").or_(banner.get_by_role("button", name="Sign in")).first).to_be_visible()
        marquee = page.get_by_role("region", name="Published embeds")
        expect(marquee.get_by_text("Published from Halation Studio")).to_be_visible()
        for name in ("Northwind Kiln hero", "Pell & Sorrel launch", "Quiet Orbit pricing", "Ferrous Lab intro", "Tallow Street drop", "Marrow FM teaser"):
            assert marquee.get_by_text(name).count() >= 1, f"marquee lists {name}"
        tiles = page.get_by_role("region", name="Layer kinds")
        boxes = [tiles.get_by_text(title, exact=True).first.bounding_box()
                 for title in ("Primitives", "Extruded type", "Models", "Particles", "Cloth", "Effects")]
        first_row = [b for b in boxes if abs(b["y"] - boxes[0]["y"]) < 4]
        assert len(first_row) == TILE_COLUMNS[w], f"layer kind tiles use {TILE_COLUMNS[w]} columns at {w}px, saw {len(first_row)}"
        if w == 375:
            for loc in (page.get_by_role("link", name="Open editor", exact=True),):
                b = loc.bounding_box()
                assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX
        footer = page.get_by_role("contentinfo")
        expect(footer.get_by_text("© 2026 Tinderbox Optics")).to_be_visible()
        for name in ("Open editor ↗", "Editor", "Embeds", "Versions", "Release notes"):
            expect(footer.get_by_role("link", name=name, exact=True)).to_be_visible()
        opener = footer.get_by_role("link", name="Keyboard shortcuts").or_(footer.get_by_role("button", name="Keyboard shortcuts")).first
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Keyboard shortcuts")
        eventually(page, lambda: shows(dialog), "Keyboard shortcuts dialog opens")
        page.keyboard.press("Escape")
        eventually(page, lambda: not shows(dialog) and focused(opener), "Escape closes it and focus returns")
    with app_page(browser, app_url, "/signin", viewport=size) as page:
        eventually(page, lambda: shows(page.get_by_role("button", name="Sign in")), "sign-in page")
        layout(page)
        if w == 375:
            b = page.get_by_role("button", name="Sign in").bounding_box()
            assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX
    with app_page(browser, app_url, "/projects", S(seed, INES), viewport=size) as page:
        cards = page.get_by_role("article")
        eventually(page, lambda: cards.count() >= 3, "project mosaic cards")
        layout(page)
        xs = {round(c.bounding_box()["x"]) for c in cards.all()[:9] if c.bounding_box()}
        assert len(xs) == MOSAIC_COLUMNS[w], f"project thumbnail mosaic uses {MOSAIC_COLUMNS[w]} columns at {w}px"
    with app_page(browser, app_url, f"/projects/{p.id}", S(seed, INES), viewport=size) as page:
        if w == 375:
            tabs = page.get_by_role("tablist", name="Editor panels")
            eventually(page, lambda: shows(tabs), "phone editor shows Editor panels")
            layout(page)
            for name in ("Layers", "Stage", "Inspector", "Timeline"):
                b = tabs.get_by_role("tab", name=name).bounding_box()
                assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, f"{name} tab is 44 px"
            b = page.get_by_role("button", name="More actions").bounding_box()
            assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX
        else:
            wait_editor(page)
            layout(page)
            tree = page.get_by_role("tree", name="Layers").bounding_box()
            stage = page.get_by_role("group", name="Stage").bounding_box()
            reads = page.get_by_role("region", name="Readouts").bounding_box()
            timeline = page.get_by_role("region", name="Timeline").bounding_box()
            if w == 768:
                assert stage["y"] + stage["height"] <= min(tree["y"], reads["y"]) + 1, "tablet: stage spans the top"
                assert tree["x"] + tree["width"] <= reads["x"] + 1, "tablet: Layers and Inspector side by side"
            else:
                assert tree["x"] < stage["x"] < reads["x"], "desktop: Layers, stage, Inspector columns"
                assert timeline["x"] <= tree["x"] + 1 and timeline["x"] + timeline["width"] >= reads["x"] + reads["width"] - 1
            assert timeline["y"] >= stage["y"] + stage["height"] - 1, "timeline at the bottom"
    with app_page(browser, app_url, f"/embed/{seed['projects']['Model bay']['id']}", viewport=size) as page:
        eventually(page, lambda: shows(page.get_by_role("region", name=re.compile(r"^Model bay, version 1$"))), "embed")
        layout(page)


def test_wf_primitive_transform_steps_and_gizmo(browser: Browser, app_url: str, seed: dict) -> None:
    prims = {"Cube": "Triangles 12", "Sphere": "Triangles 960", "Cylinder": "Triangles 128", "Torus": "Triangles 1536", "Plane": "Triangles 2"}
    layers = [layer(name, "Primitive", i, {"primitive": name}) for i, name in enumerate(prims)]
    p = import_project(app_url, seed, [scene("Main", layers)], prefix="Prims")
    ines = S(seed, INES)
    for name, tri in prims.items():
        assert inspect(app_url, ines, p, layer=p.layers[name])["readouts"]["triangles"] == tri
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Sphere")
        readout_is(page, "triangles", "Triangles 960")
        select_layer(page, "Cube")
        readout_is(page, "triangles", "Triangles 12")
        with saved(page):
            px = spin(page, "Position X")
            px.focus()
            px.press("ArrowUp")
            eventually(page, lambda: round(field_num(px), 3) == 0.1, "ArrowUp steps 0.1")
            assert focused(px), "focus stays on the stepped field"
            px.press("Shift+ArrowUp")
            eventually(page, lambda: round(field_num(px), 3) == 1.1, "Shift+ArrowUp steps 1")
            ry = spin(page, "Rotation Y")
            ry.focus()
            ry.press("ArrowUp")
            ry.press("Shift+ArrowUp")
            eventually(page, lambda: round(field_num(ry), 3) == 16, "rotation steps 1 and 15")
            sx = spin(page, "Scale X")
            sx.focus()
            sx.press("ArrowDown")
            eventually(page, lambda: round(field_num(sx), 3) == 0.9, "scale steps 0.1")
            sx.press("Shift+ArrowUp")
            eventually(page, lambda: round(field_num(sx), 3) == 1.9, "scale Shift step 1")
            commit(page, "Rotation Z", 45)
        with saved(page):
            drag(page, page.get_by_role("button", name="Move along X"), 50, 0)
            eventually(page, lambda: round(field_num(spin(page, "Position X")), 3) == 1.6, "Move along X: 0.01 per px")
        with saved(page):
            drag(page, page.get_by_role("button", name="Move along Y"), 0, -47, shift=True)
        with saved(page):
            drag(page, page.get_by_role("button", name="Rotate around Y"), 30, 0)
            eventually(page, lambda: round(field_num(spin(page, "Rotation Y")), 3) == 31, "Rotate ring: 0.5° per px")
    block = layers_by_name(project(app_url, ines, p.id)["document"])["Cube"]
    assert prop(block, "position.x") == 1.6 and prop(block, "rotation.y") == 31 and prop(block, "rotation.z") == 45
    assert round(prop(block, "scale.x"), 3) == 1.9
    y = prop(block, "position.y")
    assert abs(y * 10 - round(y * 10)) < 1e-6 and abs(y - 0.47) <= 0.1, f"Shift move snaps to 0.1 near the drag: {y}"


PROJECTION = {
    "centre-desktop": ({"position": {"x": 1, "y": 2, "z": 0}}, {}, "desktop", None, {"screen-point": "806.85, 231.29 px"}),
    "centre-fov35": ({"position": {"x": 1, "y": 2, "z": 0}}, {"camera": {"fov": 35}}, "desktop", None, {"screen-point": "848.45, 148.10 px"}),
    "centre-mobile": ({"position": {"x": 1, "y": 2, "z": 0}}, {}, "mobile", None, {"screen-point": "285.50, 241.00 px"}),
    "cube-vertex": ({"position": {"x": 1, "y": 2, "z": 0}, "rotation": {"x": 0, "y": 45, "z": 0}, "scale": {"x": 2, "y": 1, "z": 1}}, {}, "desktop",
                    "+x +y +z", {"vertex-world": "2.061, 2.500, -0.354", "vertex-point": "892.86, 195.28 px", "screen-point": "806.85, 231.29 px"}),
    "rotated-vertex": ({"rotation": {"x": 30, "y": 45, "z": 0}}, {}, "desktop", "+x +y +z", {"vertex-world": "0.837, 0.183, 0.129", "vertex-point": "793.61, 388.90 px"}),
    "behind-camera": ({"position": {"x": 0, "y": 0, "z": 20}}, {}, "desktop", None, {"screen-point": "Not visible"}),
}


@pytest.mark.parametrize("case", list(PROJECTION.values()), ids=["centre-desktop", "centre-fov35", "centre-mobile", "cube-vertex", "rotated-vertex", "behind-camera"])
def test_projection_readouts(app_url: str, seed: dict, case: tuple) -> None:
    props, scene_fields, bp, vertex, expected = case
    p = import_project(app_url, seed, [scene("Main", [cube("Probe", **props)], **scene_fields)], prefix="Project")
    got = inspect(app_url, S(seed, INES), p, layer=p.layers["Probe"], breakpoint=bp, vertex=vertex)["readouts"]
    for key, value in expected.items():
        assert got.get(key) == value, f"{key}: {got.get(key)!r} != {value!r}"


def test_wf_primitive_transform_place_torus(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [])], prefix="Torus")
    with app_page(browser, app_url, f"/projects/{p.id}", ines, wrong_clock=True) as page:
        wait_editor(page)
        add = page.get_by_role("button", name="Add layer")
        add.focus()
        page.keyboard.press("Enter")
        eventually(page, lambda: shows(page.get_by_role("menu", name="Add layer")), "Add layer menu opens")
        torus_item = page.get_by_role("menuitem", name="Torus", exact=True)
        for _ in range(40):
            if focused(torus_item):
                break
            page.keyboard.press("ArrowDown")
        else:
            pytest.fail("ArrowDown reaches Torus in the Add layer menu")
        with saved(page):
            page.keyboard.press("Enter")
            eventually(page, lambda: focused(row(page, "Torus")), "focus moves to the new layer row (L202)")
        with saved(page):
            px = spin(page, "Position X")
            px.focus()
            px.press("Shift+ArrowUp")
            py = spin(page, "Position Y")
            py.focus()
            py.press("Shift+ArrowUp")
            py.press("Shift+ArrowUp")
            commit(page, "Rotation Y", 45)
        with saved(page):
            drag(page, page.get_by_role("button", name="Rotate around Z"), 20, 0)
        readout_is(page, "screen-point", "806.85, 231.29 px")
        select(page.get_by_role("combobox", name="Vertex"), "+x +y +z")
        doc = project(app_url, ines, p.id)["document"]
        torus_id = layers_by_name(doc)["Torus"]["id"]
        api = inspect(app_url, ines, p, layer=torus_id, vertex="+x +y +z")["readouts"]
        readout_is(page, "vertex-point", api["vertex-point"], "(server evaluator)")
        readout_is(page, "vertex-world", api["vertex-world"], "(server evaluator)")
        before = api["vertex-point"]
        select_layer(page, "Camera")
        with saved(page):
            commit(page, "Field of view", 35)
        select_layer(page, "Torus")
        select(page.get_by_role("combobox", name="Vertex"), "+x +y +z")
        readout_is(page, "screen-point", "848.45, 148.10 px")
        api = inspect(app_url, ines, p, layer=torus_id, vertex="+x +y +z")["readouts"]
        assert api["vertex-point"] != before
        readout_is(page, "vertex-point", api["vertex-point"], "after narrowing the field of view")
        page.reload()
        wait_editor(page)
        select_layer(page, "Torus")
        readout_is(page, "screen-point", "848.45, 148.10 px", "after reload")
    doc = project(app_url, ines, p.id)["document"]
    torus = layers_by_name(doc)["Torus"]
    assert prop(torus, "primitive") == "Torus"
    assert (prop(torus, "position.x"), prop(torus, "position.y"), prop(torus, "rotation.y"), prop(torus, "rotation.z")) == (1, 2, 45, 10)
    assert doc["scenes"][0]["camera"]["fov"] == 35


TEXT_PROPS = {"source": "text", "letterHeight": 1, "depth": 0.2, "bevelSegments": 1}
EXTRUSION = {
    "halo-bevel": ("text", "HALO", 0.02, {"bounds": "Bounds 2.740 × 1.040 × 0.240", "triangles": "Triangles 1120"}),
    "halo-flat": ("text", "HALO", 0, {"triangles": "Triangles 480"}),
    "halo-lowercase": ("text", "halo", 0.02, {"bounds": "Bounds 2.740 × 1.040 × 0.240", "triangles": "Triangles 1120"}),
    "char-refused": ("char", "HAL@", 0, 'Character "@" is not in the built-in outline font.'),
    "svg-rectangle": ("svg", svg("M0 0 L200 0 L200 100 L0 100 Z"), 0, {"bounds": "Bounds 2.000 × 1.000 × 0.200", "triangles": "Triangles 12"}),
    "svg-relative": ("svg", svg("m0 0 h200 v100 h-200 z"), 0, {"bounds": "Bounds 2.000 × 1.000 × 0.200", "triangles": "Triangles 12"}),
    "svg-not-svg": ("refuse", b"plain text, not markup", 0, "This file is not an SVG."),
    "svg-three-paths": ("refuse", svg("M0 0 C10 10 20 20 30 0 Z", "M0 0 L1 0 L1 1 Z", "M2 2 L3 2 L3 3 Z"), 0,
                        "This SVG has 3 paths. Extrusion needs exactly one path."),
    "svg-curve": ("refuse", svg("M0 0 C10 10 20 20 30 0 Z"), 0, "Only straight-line path commands (M, L, H, V, Z) are supported."),
    "svg-crossing": ("refuse", svg("M0 0 L100 100 L100 0 L0 100 Z"), 0, "The path crosses itself."),
}


@pytest.mark.parametrize("case", list(EXTRUSION.values()), ids=["halo-bevel", "halo-flat", "halo-lowercase", "char-refused", "svg-rectangle", "svg-relative", "svg-not-svg", "svg-three-paths", "svg-curve", "svg-crossing"])
def test_extrusion_bounds_and_refusals(app_url: str, seed: dict, case: tuple) -> None:
    mode, source, bevel, expected = case
    ines = S(seed, INES)
    if mode in ("text", "char"):
        p = import_project(app_url, seed, [scene("Main", [layer("Wordmark", "Extrusion", 0, {**TEXT_PROPS, "text": "HALO", "bevelSize": bevel})])], prefix="Extrude")
        if mode == "char":
            err = expect_error(set_layer(app_url, ines, p, "Wordmark", {"text": source}), 422, "validation", expected, "unsupported character")
            assert err["message"] == expected
            assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Wordmark"], "text") == "HALO"
            return
        if source != "HALO":
            expect_status(set_layer(app_url, ines, p, "Wordmark", {"text": source}), 200, "lowercase text")
        got = inspect(app_url, ines, p, layer=p.layers["Wordmark"])["readouts"]
    else:
        p = import_project(app_url, seed, [scene("Main", [])], prefix="Svg")
        r = upload(app_url, ines, p.id, "svg", SVG_NAME, source, "image/svg+xml")
        if mode == "refuse":
            err = expect_error(r, 422, "validation", expected, "SVG refusal")
            assert err["errors"]["file"] == expected
            assert all(a.get("fileName") != SVG_NAME or a.get("status") != "confirmed" for a in project(app_url, ines, p.id)["assets"])
            return
        asset = expect_status(r, 201, "svg upload").json()["asset"]
        lid = add_layer(app_url, ines, p, {"name": "Mark", "kind": "Extrusion", "props": {"source": "svg", "svgAssetId": asset["id"]}})
        got = inspect(app_url, ines, p, layer=lid)["readouts"]
    for key, value in expected.items():
        assert got.get(key) == value, f"{key}: {got.get(key)!r} != {value!r}"


def test_wf_extrusion_materials_logo_draw_order(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [
        cube("Base", 0),
        cube("Lens", 1, material={"kind": "Glass", "backFaceRefraction": True}),
        cube("Halo", 2, depthTest=False),
    ])], prefix="Forge")
    api = inspect(app_url, ines, p, layer=p.layers["Lens"])["readouts"]
    assert api["ior"] == "IOR 1.250" and api["triangles-drawn"] == "Triangles drawn 24"
    assert inspect(app_url, ines, p, layer=p.layers["Base"])["readouts"]["triangles-drawn"] == "Triangles drawn 12"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Base")
        items = lambda: [t.strip() for t in page.get_by_role("list", name="Draw order").get_by_role("listitem").all_inner_texts()]
        eventually(page, lambda: items() == ["Base · depth on", "Lens · back faces", "Lens · front faces", "Halo · depth off · on top"], "initial Draw order")
        with saved(page):
            click(page.get_by_role("switch", name="Depth testing"))
        eventually(page, lambda: items() == ["Lens · back faces", "Lens · front faces", "Base · depth off · on top", "Halo · depth off · on top"],
                   "Draw order after turning depth testing off")
        with saved(page):
            select(page.get_by_role("combobox", name="Material"), "Glass")
        readout_is(page, "ior", "IOR 1.250")
        readout_is(page, "triangles-drawn", "Triangles drawn 12")
    base = layers_by_name(project(app_url, ines, p.id)["document"])["Base"]
    assert prop(base, "depthTest") is False
    assert inspect(app_url, ines, p, layer=p.layers["Base"])["readouts"]["ior"] == "IOR 1.250"


def test_wf_extrusion_materials_uploads_kept(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [])], prefix="Uploads")
    mark = svg("M0 0 L200 0 L200 100 L0 100 Z")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        click(page.get_by_role("button", name="Add layer"))
        with saved(page):
            with page.expect_file_chooser() as chooser:
                click(choose_menu_item(page, "Extruded SVG"))
            chooser.value.set_files(files=[{"name": SVG_NAME, "mimeType": "image/svg+xml", "buffer": mark}])
            editor_status(page, f"{SVG_NAME} is ready.")
        eventually(page, lambda: page.get_by_role("tree", name="Layers").get_by_role("treeitem").count() >= 2, "an extrusion row appears")
    s3 = S3()
    data = project(app_url, ines, p.id)
    svg_asset = next(a for a in data["assets"] if a["fileName"] == SVG_NAME)
    assert svg_asset["status"] == "confirmed" and svg_asset["sha256"] == hashlib.sha256(mark).hexdigest()
    assert any(l["kind"] == "Extrusion" for l in layers_by_name(data["document"]).values())
    image = png(64, 64)
    model = gltf_bytes()
    r = expect_status(upload(app_url, ines, p.id, "image", "grain-plate.png", image, "image/png"), 201, "png").json()["asset"]
    assert r["status"] == "confirmed" and r["width"] == 64 and r["height"] == 64 and r["bytes"] == len(image)
    m = expect_status(upload(app_url, ines, p.id, "model", "swing.gltf", model, "model/gltf+json"), 201, "gltf").json()["asset"]
    assert [c["name"] for c in m["clips"]] == ["Turn", "Hop"]
    for asset, raw, ctype in ((svg_asset, mark, None), (r, image, "image/png"), (m, model, "model/gltf+json")):
        key = f"projects/{p.id}/assets/{asset['id']}/original"
        assert s3.get(key) == raw, f"MinIO holds the submitted bytes at {key}"
        got = expect_status(http("GET", app_url, f"/api/assets/{asset['id']}/original", ines), 200, "original download")
        assert got.content == raw and asset["sha256"] == hashlib.sha256(raw).hexdigest()
        if ctype:
            assert got.headers["content-type"].startswith(ctype)
    assert http("GET", app_url, f"/api/assets/{r['id']}/original", S(seed, PAVEL)).status_code == 404, "originals only after the visibility check"
    keys_before = set(s3.keys(f"projects/{p.id}/"))
    layers_before = len(layers_by_name(project(app_url, ines, p.id)["document"]))
    down = outage_url("APP_MINIO_DOWN_URL")
    expect_error(upload(down, ines, p.id, "image", "late.png", image, "image/png"), 503, "storage_unavailable",
                 "Storage is unavailable, so uploads are paused. Published scenes still play.", "upload with storage down")
    after = project(app_url, ines, p.id)
    assert not [a for a in after["assets"] if a["fileName"] == "late.png" and a.get("status") == "confirmed"], "unconfirmed upload never usable"
    assert len(layers_by_name(after["document"])) == layers_before and set(s3.keys(f"projects/{p.id}/")) == keys_before


def _size_msg(size: int) -> str:
    return f"This file is {size / 1048576:.1f} MB; the limit is {MODEL_MAX_BYTES / 1048576:.1f} MB."


GLTF_CASES = {
    "gltf-accepted": (lambda: gltf_bytes(), "swing.gltf", None),
    "glb-accepted": (lambda: glb_bytes(), "swing.glb", None),
    "at-byte-limit": (lambda: gltf_bytes(pad_to=MODEL_MAX_BYTES), "edge.gltf", None),
    "too-large": (lambda: gltf_bytes(pad_to=MODEL_MAX_BYTES + 1), "big.gltf", _size_msg(MODEL_MAX_BYTES + 1)),
    "not-parseable": (lambda: b"{ this is not gltf", "broken.gltf", "This file is not a valid glTF or GLB file."),
    "version-1": (lambda: gltf_bytes(version="1.0"), "old.gltf", "Only glTF 2.0 files are supported."),
    "compressed": (lambda: gltf_bytes(compressed=True), "draco.gltf", "Compressed meshes (KHR_draco_mesh_compression) are not supported."),
    "external-uri": (lambda: gltf_bytes(external=True), "external.gltf", "External buffer URIs are not supported: embed buffers in the file."),
    "node-matrix": (lambda: gltf_bytes(matrix=True), "matrix.gltf", "Node matrices are not supported; use translation, rotation and scale."),
    "cubicspline": (lambda: gltf_bytes(turn_interp="CUBICSPLINE"), "spline.gltf", "Animation interpolation CUBICSPLINE is not supported; use LINEAR or STEP."),
    "matrix-before-cubicspline": (lambda: gltf_bytes(matrix=True, turn_interp="CUBICSPLINE"), "both.gltf",
                                  "Node matrices are not supported; use translation, rotation and scale."),
    "too-many-vertices": (lambda: gltf_bytes(vertex_count=MODEL_MAX_VERTICES + 1), "dense.gltf",
                          f"This model has {MODEL_MAX_VERTICES + 1} vertices; the limit is {MODEL_MAX_VERTICES}."),
}


@pytest.mark.parametrize("case", list(GLTF_CASES.values()), ids=["gltf-accepted", "glb-accepted", "at-byte-limit", "too-large", "not-parseable", "version-1", "compressed", "external-uri", "node-matrix", "cubicspline", "matrix-before-cubicspline", "too-many-vertices"])
def test_gltf_subset_and_refusals(app_url: str, seed: dict, case: tuple) -> None:
    build, fname, refusal = case
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [])], prefix="Gltf")
    data = build()
    r = upload(app_url, ines, p.id, "model", fname, data, "model/gltf-binary" if fname.endswith(".glb") else "model/gltf+json")
    if refusal is None:
        asset = expect_status(r, 201, f"{fname} accepted").json()["asset"]
        assert asset["status"] == "confirmed"
        assert [(c["name"], round(c["durationS"], 3)) for c in asset["clips"]] == [("Turn", 2.0), ("Hop", 1.0)]
        return
    err = expect_error(r, 422, "validation", refusal, f"{fname} refused")
    assert err["errors"]["file"] == refusal
    assert not [a for a in project(app_url, ines, p.id)["assets"] if a["fileName"] == fname and a.get("status") == "confirmed"]


def test_wf_gltf_clips_model_sampling(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [])], prefix="Bay")
    data = gltf_bytes()
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        click(page.get_by_role("button", name="Add layer"))
        with saved(page):
            with page.expect_file_chooser() as chooser:
                click(choose_menu_item(page, "Model"))
            chooser.value.set_files(files=[{"name": "swing.gltf", "mimeType": "model/gltf+json", "buffer": data}])
            editor_status(page, "swing.gltf is ready.")
        clips = page.get_by_role("list", name="Clips")
        eventually(page, lambda: clips.get_by_role("listitem").filter(has_text="Turn · 2.000 s").count() == 1, "clip Turn · 2.000 s listed")
        assert clips.get_by_role("listitem").filter(has_text="Hop · 1.000 s").count() == 1
        with saved(page):
            play = page.get_by_role("button", name="Play Turn")
            if shows(play):
                click(play)
            loop_turn = page.get_by_role("switch", name="Loop Turn")
            if not loop_turn.is_checked():
                click(loop_turn)
            commit(page, "Speed Turn", 1.5)
        select(page.get_by_role("combobox", name="Node"), "Arm")
        seek(page, 156)
        readout_is(page, "node-quaternion", "Quaternion 0.0000, 0.6788, 0.0000, 0.7343")
    doc = project(app_url, ines, p.id)
    model = next(l for l in layers_by_name(doc["document"]).values() if l["kind"] == "Model")
    turn = next(c for c in prop(model, "clips") if c["name"] == "Turn")
    assert turn["play"] is True and turn["loop"] is True and turn["speed"] == 1.5
    assert inspect(app_url, ines, p, layer=model["id"], frame=156, node="Arm")["readouts"]["node-quaternion"] == "Quaternion 0.0000, 0.6788, 0.0000, 0.7343"
    asset = next(a for a in doc["assets"] if a["fileName"] == "swing.gltf")
    assert S3().get(f"projects/{p.id}/assets/{asset['id']}/original") == data

    def clip_layer(name: str, turn_cfg: dict, hop_cfg: dict) -> str:
        return add_layer(app_url, ines, p, {"name": name, "kind": "Model", "props": {"modelAssetId": asset["id"], "clips": [
            {"name": "Turn", "play": False, "loop": False, "speed": 1, "offsetMs": 0, **turn_cfg},
            {"name": "Hop", "play": False, "loop": False, "speed": 1, "offsetMs": 0, **hop_cfg}]}})

    def node(lid: str, frame: int, name: str) -> dict:
        return inspect(app_url, ines, p, layer=lid, frame=frame, node=name)["readouts"]

    linear = clip_layer("Linear", {"play": True}, {})
    at_half = node(linear, 30, "Arm")
    assert at_half["node-quaternion"] == "Quaternion 0.0000, 0.1951, 0.0000, 0.9808"
    assert at_half["node-euler"] == f"Euler {vec(0, 22.5, 0)}" and at_half["node-translation"] == f"Translation {vec(0.5, 0.25, 0)}"
    later = node(linear, 90, "Arm")
    assert later["node-quaternion"] == "Quaternion 0.0000, 0.5556, 0.0000, 0.8315" and later["node-euler"] == f"Euler {vec(0, 67.5, 0)}"
    once = clip_layer("Once", {"play": True, "speed": 1.5}, {})
    assert node(once, 156, "Arm")["node-quaternion"] == node(once, 80, "Arm")["node-quaternion"], "non-looping clip holds at its duration"
    assert node(once, 156, "Arm")["node-quaternion"] != "Quaternion 0.0000, 0.6788, 0.0000, 0.7343"
    zero, one = f"Translation {vec(0, 0, 0)}", f"Translation {vec(0, 1, 0)}"
    step = clip_layer("Step", {}, {"play": True})
    foot = [node(step, f, "Foot")["node-translation"] for f in (15, 30, 45, 59, 60)]
    assert foot == [zero, one, one, one, zero], f"STEP keeps the keyframe at or before c: {foot}"
    offset = clip_layer("Offset", {}, {"play": True, "offsetMs": 500})
    assert [node(offset, f, "Foot")["node-translation"] for f in (30, 60)] == [zero, one], "offset delays clip time"
    idle = clip_layer("Idle", {}, {"play": False})
    assert node(idle, 30, "Foot")["node-translation"] == zero, "a clip that isn't playing stays at c = 0"


def test_wf_gltf_clips_storage_outage(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p, aid, _ = model_project(app_url, seed, "Outage")
    add_layer(app_url, ines, p, {"name": "Swing", "kind": "Model", "props": {"modelAssetId": aid}})
    expect_status(publish(app_url, ines, p.id), 201, "publish v1")
    s3 = S3()
    bundle = s3.get(f"projects/{p.id}/versions/1/scene.json")
    keys_before = set(s3.keys(f"projects/{p.id}/"))
    assets_before = len(project(app_url, ines, p.id)["assets"])
    down = outage_url("APP_MINIO_DOWN_URL")
    expect_error(upload(down, ines, p.id, "model", "swing.gltf", gltf_bytes(), "model/gltf+json"), 503, "storage_unavailable",
                 "Storage is unavailable, so uploads are paused. Published scenes still play.", "upload")
    expect_error(publish(down, ines, p.id), 503, "storage_unavailable",
                 "Storage is unavailable, so publishing is paused. Published scenes still play.", "publish")
    imp = json.dumps({"schemaVersion": 3, "name": fresh_name("Down"), "scenes": [scene("Main", [])]}).encode()
    r = http("POST", down, "/api/imports", ines, data={"workspaceId": seed["workspaces"]["Lumen Yard"]}, files={"file": ("a.json", imp, "application/json")})
    expect_error(r, 503, "storage_unavailable", None, "import")
    assert [v["number"] for v in versions(app_url, ines, p.id)] == [1], "no version row stays"
    confirmed = [a for a in project(app_url, ines, p.id)["assets"] if a.get("status") == "confirmed"]
    assert len(confirmed) == 1 and len(project(app_url, ines, p.id)["assets"]) >= assets_before
    assert set(s3.keys(f"projects/{p.id}/")) == keys_before, "outage writes no object"
    r = expect_status(http("GET", down, f"/api/embed/{p.id}/scene"), 200, "embed scene from row")
    assert r.headers["x-scene-source"] == "row" and r.headers["x-halation-version"] == "1" and r.content == bundle
    primary = http("GET", app_url, f"/api/embed/{p.id}/scene")
    assert primary.headers["x-scene-source"] == "bundle" and primary.content == bundle
    expect_error(http("GET", down, f"/api/embed/{p.id}/assets/{aid}"), 503, "storage_unavailable", None, "embed asset")
    with app_page(browser, down, f"/embed/{p.id}") as page:
        eventually(page, lambda: shows(page.get_by_role("region", name=f"{p.name}, version 1")), "embed renders version 1")
        eventually(page, lambda: page.get_by_role("img", name="Swing (storage unavailable)").count() == 1, "named placeholder")


SWARM = {"mode": "emit", "seed": 7, "burst": 3, "rate": 30, "speed": 2, "gravity": 9.8, "lifetime": 0.5, "orbit": 90,
         "attractor": {"x": 0, "y": 1, "z": 0, "strength": 4}}
DRIFT = {"mode": "emit", "seed": 7, "burst": 3, "rate": 0, "speed": 2, "gravity": 9.8, "lifetime": 2, "trailLength": 8}


def test_wf_particles_emitter_inspect(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Swarm", "Particles", 0, SWARM), layer("Drift", "Particles", 1, DRIFT)])], prefix="Swarm")
    rd = lambda frame, n, name="Swarm": inspect(app_url, ines, p, layer=p.layers[name], frame=frame, particle=n)["readouts"]
    assert rd(2, 1, "Drift")["particle"] == particle_text(1, -0.065, -0.067, 0.064)
    f29 = rd(29, 1)
    assert f29["live-particles"] == "Live particles 17" and f29["particle"] == particle_text(1, -0.433, -1.367, 1.006)
    assert rd(30, 4)["live-particles"] == "Live particles 15"
    assert "is not alive" not in rd(30, 4)["particle"] and "is not alive" not in rd(30, 18)["particle"]
    assert rd(30, 3)["particle"] == f"Particle 3 is not alive at {time_readout(30)}."
    f45 = rd(45, 20)
    assert f45["live-particles"] == "Live particles 15" and f45["particle"] == particle_text(20, 0.042, -0.222, -0.337)
    assert rd(45, 1)["particle"] == f"Particle 1 is not alive at {time_readout(45)}."
    with app_page(browser, app_url, f"/projects/{p.id}", ines, wrong_clock=True) as page:
        wait_editor(page)
        select_layer(page, "Swarm")
        ph = seek(page, 45)
        assert ph.get_attribute("aria-valuetext") == "00:00.750"
        commit(page, "Particle number", 20)
        readout_is(page, "particle", particle_text(20, 0.042, -0.222, -0.337))
        readout_is(page, "live-particles", "Live particles 15")
        commit(page, "Particle number", 1)
        readout_is(page, "particle", f"Particle 1 is not alive at {time_readout(45)}.")


def test_wf_particles_formation_trails(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    word = layer("Wordmark", "Extrusion", 0, {**TEXT_PROPS, "text": "HALO", "bevelSize": 0.02})
    form = layer("Formation", "Particles", 1, {"mode": "form", "seed": 7, "formation": {"target": word["id"], "count": 32, "durationMs": 1500}})
    p = import_project(app_url, seed, [scene("Main", [word, form, layer("Drift", "Particles", 2, DRIFT)])], prefix="Form")
    rnd = mulberry32(42)
    assert [f"{rnd():.10f}" for _ in range(4)] == ["0.6011037519", "0.4482905590", "0.8524657935", "0.6697340414"], "reference PRNG (L872)"
    starts = mulberry32(7)
    expected0 = []
    for i in (1, 2):
        u = [starts(), starts(), starts()]
        expected0.append(f"Particle {i} at {vec(*(4 * x - 2 for x in u))}")
    rd = lambda frame, n, name="Formation": inspect(app_url, ines, p, layer=p.layers[name], frame=frame, particle=n)["readouts"]
    assert rd(0, 1)["live-particles"] == "Live particles 32"
    assert [rd(0, 1)["particle"], rd(0, 2)["particle"]] == expected0, "start points (4u−2) drawn in particle order"
    for frame in (90, 120):
        assert rd(frame, 1)["particle"] == particle_text(1, -1.350, 0.500, 0.120)
        assert rd(frame, 6)["particle"] == particle_text(6, -0.050, 0.500, 0.120)
        assert rd(frame, 17)["particle"] == particle_text(17, -1.350, 0.500, 0.120)
    assert rd(2, 1, "Drift")["trail-points"] == f"Trail points {min(8, 2 + 1)}"
    assert rd(20, 1, "Drift")["trail-points"] == "Trail points 8"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Formation")
        commit(page, "Particle number", 6)
        ph = seek(page, 120)
        assert focused(ph), "focus stays on the Playhead"
        readout_is(page, "particle", particle_text(6, -0.050, 0.500, 0.120))


BANNER = {"columns": 4, "rows": 4, "seed": 3, "pinned": "Top", "windStrength": 2, "windDirection": 0}


def test_wf_cloth_banner_points(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Banner", "Cloth", 0, BANNER)])], prefix="Banner")
    pt = lambda frame, name: inspect(app_url, ines, p, layer=p.layers["Banner"], frame=frame, point=name)["readouts"]["cloth-point"]
    assert pt(0, "R4 C1") == cloth_text("R4 C1", -0.150, -0.300, 0.000)
    assert pt(30, "R4 C1") == cloth_text("R4 C1", -0.051, -0.285, 0.001)
    assert pt(60, "R4 C1") == cloth_text("R4 C1", -0.114, -0.300, 0.000)
    assert pt(30, "R2 C4") == cloth_text("R2 C4", 0.180, -0.097, -0.001)
    assert pt(0, "R1 C2") == pt(60, "R1 C2"), "pinned points never move"
    with app_page(browser, app_url, f"/projects/{p.id}", ines, wrong_clock=True) as page:
        wait_editor(page)
        select_layer(page, "Banner")
        select(page.get_by_role("combobox", name="Cloth point"), "R4 C1")
        seek(page, 30)
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.051, -0.285, 0.001))
    expect_status(set_layer(app_url, ines, p, "Banner", {"pinned": "Corners"}), 200, "pin corners")
    assert pt(30, "R4 C1") == cloth_text("R4 C1", -0.031, -0.276, 0.001)


def test_wf_cloth_reduce_motion(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p, aid, _ = model_project(app_url, seed, "Still")
    for lay in ({"name": "Banner", "kind": "Cloth", "props": BANNER},
                {"name": "Spinner", "kind": "Primitive", "props": {"primitive": "Cube"}},
                {"name": "Swarm", "kind": "Particles", "props": SWARM},
                {"name": "Swing", "kind": "Model", "props": {"modelAssetId": aid, "clips": [{"name": "Turn", "play": True, "loop": True, "speed": 1, "offsetMs": 0}]}},
                {"name": "Probe", "kind": "Primitive", "props": {"primitive": "Sphere"},
                 "events": {"tilt": {"enabled": True, "maxTilt": 12, "sensitivity": 1, "momentum": 1}}}):
        add_layer(app_url, ines, p, lay)
    spinner = p.layers["Spinner"]
    expect_status(ops(app_url, ines, p, [change("setKeyframe", layerId=spinner, property="rotation.y", frame=0, value=0, easing="linear"),
                                         change("setKeyframe", layerId=spinner, property="rotation.y", frame=60, value=90, easing="linear"),
                                         change("updateScene", set={"orbit.enabled": True, "orbit.startAngle": 0, "orbit.endAngle": 90}, breakpoint="desktop")]),
                  200, "keyframes and orbit")
    q = lambda **kw: inspect(app_url, ines, p, **kw)
    assert q(layer=spinner, frame=30, reducedMotion=1)["values"]["rotation.y"] == 90, "keyframes show the end pose"
    assert q(layer=p.layers["Banner"], frame=30, point="R4 C1", reducedMotion=1)["readouts"]["cloth-point"] == cloth_text("R4 C1", -0.150, -0.300, 0.000)
    sw0 = q(layer=p.layers["Swarm"], frame=0, particle=1)["readouts"]
    sw29 = q(layer=p.layers["Swarm"], frame=29, particle=1, reducedMotion=1)["readouts"]
    assert sw29["live-particles"] == sw0["live-particles"] and sw29["particle"] == sw0["particle"], "particles show frame 0"
    assert q(layer=p.layers["Swing"], frame=30, node="Arm", reducedMotion=1)["readouts"]["node-quaternion"] == \
        q(layer=p.layers["Swing"], frame=0, node="Arm")["readouts"]["node-quaternion"], "clips show frame 0"
    assert q(scroll=0, reducedMotion=1)["readouts"]["camera-azimuth"] == azimuth_text(90), "orbit shows its end angle"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        rm_switch = page.get_by_role("switch", name="Reduce motion")
        rm_switch.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: rm_switch.is_checked(), "Reduce motion turns on by keyboard")
        select_layer(page, "Banner")
        select(page.get_by_role("combobox", name="Cloth point"), "R4 C1")
        seek(page, 30)
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.150, -0.300, 0.000), "(frame-0 state)")
        select_layer(page, "Probe")
        click(page.get_by_role("switch", name="Preview"))
        stage = page.get_by_role("group", name="Stage")
        stage.focus()
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        advance(page, 1000)
        readout_is(page, "tilt-y", "Tilt Y 0.000", "(tilt stays at rest)")
        readout_is(page, "tilt-target", "Tilt target 0.000, 6.000", "(target still reported)")
    expect_status(publish(app_url, ines, p.id), 201, "publish")
    with app_page(browser, app_url, f"/embed/{p.id}", reduced_motion="reduce") as page:
        eventually(page, lambda: shows(page.get_by_role("region", name=f"{p.name}, version 1")), "embed")
        advance(page, 500)
        eventually(page, lambda: embed_values(page, "Spinner")["rotation.y"] == 90, "embed shows the keyframe end pose")


def frames_seq(page: Page, loc: Locator, n: int, step_ms: float = 4) -> list[str]:
    seq: list[str] = []
    last = text_of(loc)
    for _ in range(int(n * FRAME_MS / step_ms) + 200):
        advance(page, step_ms)
        v = text_of(loc)
        if v != last:
            seq.append(v)
            last = v
        if len(seq) >= n:
            return seq
    pytest.fail(f"readout changed only {len(seq)} times over {n} frames")


def test_wf_tilt_orbit_cursor_tilt(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    probe = layer("Probe", "Primitive", 0, {"primitive": "Sphere", "position": {"x": 1, "y": 2, "z": 0}},
                  events={"tilt": {"enabled": True, "maxTilt": 12, "sensitivity": 1, "momentum": 1}})
    p = import_project(app_url, seed, [scene("Main", [probe])], prefix="Tilt")
    with app_page(browser, app_url, f"/projects/{p.id}", ines, wrong_clock=True) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        click(page.get_by_role("switch", name="Preview"))
        stage = page.get_by_role("group", name="Stage")
        stage.focus()
        tilt_y = readout(page, "tilt-y")
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        seq = frames_seq(page, tilt_y, 30)
        assert (seq[0], seq[9], seq[29]) == ("Tilt Y 0.480", "Tilt Y 3.394", "Tilt Y 5.508"), seq[:30]
        readout_is(page, "tilt-target", "Tilt target 0.000, 6.000")
        readout_is(page, "tilt-x", "Tilt X 0.000")
        advance(page, 10000)
        readout_is(page, "tilt-y", "Tilt Y 6.000")
        page.keyboard.press("Escape")
        for at_ms, step_ms, exact in ((300, 300, 1.411), (600, 300, 0.232)):
            advance(page, step_ms)
            value = float(text_of(tilt_y).split()[-1])
            assert exact - 0.0015 <= value <= 6 * (1 - _gb_glide((at_ms - 2 * FRAME_MS) / LEAVE_MS)) + 0.0015, (at_ms, value)
        advance(page, LEAVE_MS)
        readout_is(page, "tilt-y", "Tilt Y 0.000")
        readout_is(page, "light-focus", f"Light focus {REST_FOCUS}")
        for _ in range(15):
            page.keyboard.press("ArrowRight")
        advance(page, 10000)
        readout_is(page, "tilt-target", tilt_target_text(0, 12), "(within the max tilt)")
        page.keyboard.press("Escape")
        advance(page, LEAVE_MS + SETTLE_MS)
        box = stage.bounding_box()
        page.mouse.move(box["x"] + box["width"] * 0.75, box["y"] + box["height"] * 0.5)
        advance(page, 10000)
        readout_is(page, "tilt-y", "Tilt Y 6.000", "(pointer at 75 % width)")
        fx, fy = (float(v) for v in text_of(readout(page, "light-focus")).removeprefix("Light focus ").split(","))
        assert fx < 0.8 and fy < 0.9, "light focus follows the pointer"
        header = page.get_by_role("banner").bounding_box()
        page.mouse.move(header["x"] + 5, header["y"] + 5)
        advance(page, LEAVE_MS + SETTLE_MS)
        readout_is(page, "tilt-y", "Tilt Y 0.000")
        readout_is(page, "light-focus", f"Light focus {REST_FOCUS}")
        click(page.get_by_role("switch", name="Preview"))
        with saved(page):
            commit(page, "Momentum", 0.5)
            commit(page, "Max tilt", 24)
        click(page.get_by_role("switch", name="Preview"))
        stage.focus()
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        readout_is(page, "tilt-target", tilt_target_text(0, 12), "(max tilt 24 doubles the target)")
    tilt = layers_by_name(project(app_url, ines, p.id)["document"])["Probe"]["events"]["tilt"]
    assert tilt["maxTilt"] == 24 and tilt["momentum"] == 0.5
    q = import_project(app_url, seed, [scene("Main", [layer("Probe", "Primitive", 0, {"primitive": "Sphere"},
                       events={"tilt": {"enabled": True, "maxTilt": 12, "sensitivity": 1, "momentum": 0.5}})])], prefix="Momentum")
    with app_page(browser, app_url, f"/projects/{q.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        click(page.get_by_role("switch", name="Preview"))
        page.get_by_role("group", name="Stage").focus()
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        assert frames_seq(page, readout(page, "tilt-y"), 1)[0] == "Tilt Y 3.240"


def test_wf_tilt_orbit_scroll_orbit(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Probe", position={"x": 1, "y": 2, "z": 0})],
                                             orbit={"enabled": True, "startAngle": 0, "endAngle": 90})], prefix="Orbit")
    full = inspect(app_url, ines, p, layer=p.layers["Probe"], scroll=100)["readouts"]
    assert full["camera-azimuth"] == azimuth_text(90) and full["screen-point"] == "720.00, 211.99 px"
    half = inspect(app_url, ines, p, layer=p.layers["Probe"], scroll=50)["readouts"]
    assert half["camera-azimuth"] == azimuth_text(45) and half["screen-point"] == "786.09, 218.08 px"
    r = http("GET", app_url, f"/api/projects/{p.id}/inspect", ines, params={"scene": p.scene, "scroll": 150})
    expect_error(r, 422, "validation", None, "scroll outside 0–100")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        slider = page.get_by_role("slider", name="Scroll progress")
        slider.focus()
        slider.press("End")
        readout_is(page, "camera-azimuth", azimuth_text(90))
        readout_is(page, "screen-point", "720.00, 211.99 px")
        assert focused(slider)
        slider.press("Home")
        for _ in range(50):
            slider.press("ArrowRight")
        readout_is(page, "camera-azimuth", azimuth_text(45))
    expect_status(publish(app_url, ines, p.id), 201, "publish")
    with app_page(browser, app_url, f"/embed/{p.id}", viewport=(1280, 800)) as page:
        region = page.get_by_role("region", name=f"{p.name}, version 1")
        eventually(page, lambda: shows(region), "embed")
        progress: list[float] = []
        mats: dict[float, Any] = {}
        for frac in (0, 0.25, 0.5, 0.75, 1, 0.75, 0.5, 0.25, 0):
            page.evaluate("f => window.scrollTo(0, f * (document.documentElement.scrollHeight - window.innerHeight))", frac)
            advance(page, 100)
            progress.append(float(region.get_attribute("data-scroll-progress")))
            if frac in (0, 1):
                mats.setdefault(frac, camera(page))
        fwd, back = progress[:5], progress[4:]
        assert all(a < b for a, b in zip(fwd, fwd[1:])) and round(fwd[-1]) == 100, f"forward progress {fwd}"
        assert all(a > b for a, b in zip(back, back[1:])) and round(back[-1]) == 0, f"reverse progress {back}"
        assert mats[0] != mats[1], "camera matrices change with scroll"


EASING = {
    "ease": ("position.y", "ease", 1, 30, 0.802),
    "ease-in": ("position.y", "ease-in", 1, 30, 0.315),
    "ease-out": ("position.y", "ease-out", 1, 30, 0.685),
    "ease-in-out": ("position.y", "ease-in-out", 1, 30, 0.5),
    "glide": ("position.y", "glide", 1, 30, 0.961),
    "anticipate": ("position.y", "anticipate", 1, 30, -0.087),
    "elastic": ("position.y", "elastic", 1, 30, 1.016),
    "bouncy": ("position.y", "bouncy", 1, 30, 0.766),
    "spring-15": ("position.y", SPRING, 1, 15, 0.845),
    "spring-30": ("position.y", SPRING, 1, 30, 0.983),
    "rotation-ease-out": ("rotation.y", "ease-out", 90, 30, 61.618),
    "rotation-ease-in": ("rotation.y", "ease-in", 90, 30, 28.382),
    "invalid-easing": ("position.y", "wobble", 1, 30, None),
    "spring-on-event": ("events", SPRING, 1, 30, None),
}


@pytest.mark.parametrize("case", list(EASING.values()), ids=["ease", "ease-in", "ease-out", "ease-in-out", "glide", "anticipate", "elastic", "bouncy", "spring-15", "spring-30", "rotation-ease-out", "rotation-ease-in", "invalid-easing", "spring-on-event"])
def test_easing_values(app_url: str, seed: dict, case: tuple) -> None:
    path, easing, end, frame, expected = case
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Turner")])], prefix="Ease")
    lid = p.layers["Turner"]
    if path == "events":
        r = set_layer(app_url, ines, p, "Turner", {"events.appear": {"enabled": True, "durationMs": 600, "delayMs": 0, "easing": easing, "from": {}}})
        err = expect_error(r, 422, "validation", "Choose one of the listed easings.", "Spring on an event")
        assert any(k.endswith("easing") for k in err["errors"])
        return
    r = ops(app_url, ines, p, [change("setKeyframe", layerId=lid, property=path, frame=0, value=0, easing=easing),
                               change("setKeyframe", layerId=lid, property=path, frame=60, value=end, easing="linear")])
    if expected is None:
        err = expect_error(r, 422, "validation", "Choose one of the listed easings.", "unlisted easing")
        assert any(k.endswith("easing") for k in err["errors"])
        assert layers_by_name(project(app_url, ines, p.id)["document"])["Turner"]["keyframes"] == []
        return
    expect_status(r, 200, "keyframes")
    got = inspect(app_url, ines, p, layer=lid, frame=frame)["values"][path]
    assert round(got, 3) == expected, f"{path} at frame {frame} with {easing}: {got}"


def test_wf_keyframe_easing_timeline_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Turner")])], prefix="Timeline")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Turner")
        ph = seek(page, 45)
        page.keyboard.press("k")
        eventually(page, lambda: shows(page.get_by_text("Choose a property first.", exact=True)), "K without a property")
        spin(page, "Rotation Y").focus()
        ph = seek(page, 45)
        assert ph.get_attribute("aria-valuetext") == "00:00.750"
        with saved(page):
            page.keyboard.press("k")
            editor_status(page, "Keyframe added at 00:00.750")
        assert focused(ph), "focus stays on the Playhead after K"
        kf = page.get_by_role("button", name="Rotation Y keyframe at 00:00.750")
        eventually(page, lambda: shows(kf), "keyframe button")
        kf.focus()
        with saved(page):
            for _ in range(3):
                page.keyboard.press("Shift+ArrowRight")
            moved = page.get_by_role("button", name="Rotation Y keyframe at 00:01.250")
            eventually(page, lambda: shows(moved) and focused(moved), "moved keyframe renamed and focused (L202)")
        with saved(page):
            select(page.get_by_role("combobox", name="Easing"), "Ease out")
        seek(page, 45)
        play = page.get_by_role("button", name="Play")
        play.focus()
        with saved(page):
            page.keyboard.press("k")
            eventually(page, lambda: shows(page.get_by_role("button", name="Rotation Y keyframe at 00:00.750")), "K from Play")
        page.get_by_role("button", name="Rotation Y keyframe at 00:00.750").focus()
        with saved(page):
            page.keyboard.press("Delete")
            eventually(page, lambda: page.get_by_role("button", name="Rotation Y keyframe at 00:00.750").count() == 0, "Delete removes it")
    kfs = layers_by_name(project(app_url, ines, p.id)["document"])["Turner"]["keyframes"]
    assert [(k["property"], k["frame"], k["easing"]) for k in kfs] == [("rotation.y", 75, "ease-out")], kfs


def test_wf_keyframe_easing_undo_replay(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block", 0), cube("Other", 1)])], prefix="Undo")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Block")
        with saved(page):
            commit(page, "Position X", 2)
        click(page.get_by_role("button", name="Undo"))
        editor_status(page, "Undone")
        eventually(page, lambda: prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.x") == 0, "undo stored")
        click(page.get_by_role("button", name="Redo"))
        editor_status(page, "Redone")
        eventually(page, lambda: prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.x") == 2, "redo stored")
    px = lambda: prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.x")
    py = lambda: prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.y")
    a = new_id("op")
    upd = lambda field, v, op: ops(app_url, ines, p, [change("updateLayer", layerId=p.layers["Block"], set={field: v}, breakpoint="desktop")], op_id=op)
    first = expect_status(upd("position.x", 5, a), 200, "op A").json()
    assert expect_status(upd("position.x", 5, a), 200, "replay A").json() == first
    expect_error(upd("position.x", 6, a), 409, "idempotency_conflict", None, "same opId, different body")
    second = expect_status(upd("position.y", 3, new_id("op")), 200, "op B").json()
    assert second["undoDepth"] == first["undoDepth"] + 1, "replay recorded the step once"
    u = new_id("op")
    und = expect_status(http("POST", app_url, f"/api/projects/{p.id}/undo", ines, json={"opId": u}), 200, "undo").json()
    assert expect_status(http("POST", app_url, f"/api/projects/{p.id}/undo", ines, json={"opId": u}), 200, "replay undo").json() == und
    assert (px(), py()) == (5, 0), "replayed undo applied once"
    rd = new_id("op")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/redo", ines, json={"opId": rd}), 200, "redo")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/redo", ines, json={"opId": rd}), 200, "replay redo")
    assert py() == 3
    expect_error(http("POST", app_url, f"/api/projects/{p.id}/redo", ines, json={"opId": new_id("op")}), 409, "nothing_to_redo", None, "redo empty")
    invite_and_accept(app_url, seed, mail, p, MARA, "Editor")
    mara = S(seed, MARA)
    expect_status(ops(app_url, mara, p, [change("updateLayer", layerId=p.layers["Other"], set={"position.z": 4}, breakpoint="desktop")]), 200, "Mara edits")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/undo", mara, json={"opId": new_id("op")}), 200, "Mara undo")
    assert (px(), py()) == (5, 3), "Mara's undo leaves Ines's steps"
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Other"], "position.z") == 0
    q = import_project(app_url, seed, [scene("Main", [])], prefix="Limit")
    limit = int(os.environ.get("UNDO_LIMIT", "100"))
    for i in range(limit + 1):
        expect_status(ops(app_url, ines, q, [change("addVariable", variable={"name": f"v{i}", "type": "Number", "value": i})]), 200, f"step {i}")
    for i in range(limit):
        expect_status(http("POST", app_url, f"/api/projects/{q.id}/undo", ines, json={"opId": new_id("op")}), 200, f"undo {i + 1}")
    expect_error(http("POST", app_url, f"/api/projects/{q.id}/undo", ines, json={"opId": new_id("op")}), 409, "nothing_to_undo", None,
                 "history keeps at most UNDO_LIMIT steps")
    assert [v["name"] for v in project(app_url, ines, q.id)["document"]["variables"]] == ["v0"]


def test_wf_breakpoints_override_reset(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Halo", position={"x": 1, "y": 2, "z": 0}, rotation={"x": 0, "y": 45, "z": 0}), layer("Plate", "Rectangle", 1)])], prefix="Bp")
    expect_status(set_layer(app_url, ines, p, "Halo", {"rotation.y": 30}, bp="tablet"), 200, "tablet override")
    for bp, value, source in (("desktop", 45, "Desktop"), ("tablet", 30, "Tablet"), ("mobile", 30, "Tablet")):
        got = inspect(app_url, ines, p, layer=p.layers["Halo"], breakpoint=bp)
        assert got["values"]["rotation.y"] == value and got["sources"]["rotation.y"] == source, (bp, got["values"], got["sources"])
    expect_error(set_layer(app_url, ines, p, "Plate", {"blendMode": "Multiply"}, bp="tablet"), 422, "validation",
                 "Blend mode can't differ between breakpoints.", "non-overridable field")
    with app_page(browser, app_url, f"/projects/{p.id}", ines, wrong_clock=True) as page:
        wait_editor(page)
        select_layer(page, "Halo")
        reset = page.get_by_role("button", name="Reset Rotation Y to inherited value")
        assert not shows(reset), "no reset marker on Desktop"
        tablet = page.get_by_role("radio", name="Tablet")
        tablet.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: tablet.get_attribute("aria-checked") == "true" or tablet.is_checked(), "Tablet chosen by keyboard")
        assert focused(tablet)
        eventually(page, lambda: field_num(spin(page, "Rotation Y")) == 30 and shows(reset), "Tablet value and reset marker")
        click(page.get_by_role("radio", name="Mobile"))
        prop_readout = property_readout(page, "Rotation Y")
        eventually(page, lambda: text_of(prop_readout) == "Rotation Y 30.000 (from Tablet)", "inspector names the level")
        click(page.get_by_role("radio", name="Tablet"))
        with saved(page):
            click(reset)
        eventually(page, lambda: field_num(spin(page, "Rotation Y")) == 45, "inherits Desktop again")
    got = inspect(app_url, ines, p, layer=p.layers["Halo"], breakpoint="tablet")
    assert got["values"]["rotation.y"] == 45 and got["sources"]["rotation.y"] == "Desktop"


EMBED_WIDTHS = {1024: (45, 60), 1023: (30, 60), 640: (30, 60), 639: (30, 10)}


def test_wf_breakpoints_embed_widths(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Halo", rotation={"x": 0, "y": 45, "z": 0}),
                                                      layer("Sparks", "Particles", 1, {"mode": "emit", "seed": 7, "rate": 60})])], prefix="Widths")
    expect_status(set_layer(app_url, ines, p, "Halo", {"rotation.y": 30}, bp="tablet"), 200, "tablet override")
    expect_status(set_layer(app_url, ines, p, "Sparks", {"rate": 10}, bp="mobile"), 200, "mobile override")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        click(page.get_by_role("button", name="Publish"))
        editor_status(page, "Version 1 is live.")
    assert [v["number"] for v in versions(app_url, ines, p.id)] == [1]
    for width, (rot, rate) in EMBED_WIDTHS.items():
        with app_page(browser, app_url, f"/embed/{p.id}", viewport=(width, 800), wrong_clock=True) as page:
            eventually(page, lambda: shows(page.get_by_role("region", name=f"{p.name}, version 1")), "embed")
            eventually(page, lambda: embed_values(page, "Halo")["rotation.y"] == rot and embed_values(page, "Sparks")["rate"] == rate,
                       f"embed at {width}px shows rotation {rot} and rate {rate}")


def test_wf_variables_presets_bind_delete(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Spinner")])], prefix="Vars")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        click(page.get_by_role("tab", name="Variables"))
        for name, kind in (("spin", "Number"), ("boost", "Number")):
            page.get_by_role("textbox", name="New variable name").fill(name)
            select(page.get_by_role("combobox", name="Variable type"), kind)
            with saved(page):
                click(page.get_by_role("button", name="Add variable"))
        with saved(page):
            spin_field = page.get_by_role("spinbutton", name="spin value").or_(page.get_by_role("textbox", name="spin value")).first
            spin_field.fill("45")
            spin_field.press("Enter")
        boost = page.get_by_role("spinbutton", name="boost value").or_(page.get_by_role("textbox", name="boost value")).first
        with saved(page):
            boost.fill("150")
            boost.press("Enter")
        lid = p.layers["Spinner"]
        expect_status(ops(app_url, ines, p, [change("bind", layerId=lid, property="rotation.y", variable="spin"),
                                             change("bind", layerId=lid, property="scale.x", variable="boost")]), 200, "bind")
        got = inspect(app_url, ines, p, layer=lid)["values"]
        assert got["rotation.y"] == 45 and got["scale.x"] == 100, "Number clamps to the property range"
        select_layer(page, "Spinner")
        eventually(page, lambda: shows(page.get_by_text("Bound to spin").first) and shows(page.get_by_text("Bound to boost"))
                   and shows(page.get_by_text("Clamped to 100")), "bound and clamped notes")
        expect(spin(page, "Scale X")).not_to_be_editable()
        expect(spin(page, "Rotation Y")).not_to_be_editable()
        delete = page.get_by_role("button", name="Delete spin")
        delete.focus()
        with saved(page):
            page.keyboard.press("Enter")
            editor_status(page, "Deleted spin. 1 property keeps its last value.")
    doc = project(app_url, ines, p.id)["document"]
    spinner = layers_by_name(doc)["Spinner"]
    assert "spin" not in [v["name"] for v in doc["variables"]] and "spin" not in json.dumps(spinner["bindings"])
    assert inspect(app_url, ines, p, layer=p.layers["Spinner"])["values"]["rotation.y"] == 45
    expect_error(ops(app_url, ines, p, [change("addVariable", variable={"name": "Bad Name", "type": "Number", "value": 1})]), 422, "validation",
                 "Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).", "bad name")
    expect_error(ops(app_url, ines, p, [change("addVariable", variable={"name": "boost", "type": "Number", "value": 1})]), 422, "validation",
                 "A variable named boost already exists.", "duplicate")
    expect_status(ops(app_url, ines, p, [change("addVariable", variable={"name": "tint", "type": "Colour", "value": "#B7A4FF"})]), 200, "colour var")
    expect_status(ops(app_url, ines, p, [change("bind", layerId=p.layers["Spinner"], property="position.x", variable="tint")]), 422, "incompatible bind")


def test_wf_variables_presets_live_apply(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Spinner")])], prefix="Presets")
    v = lambda name, value: change("updateVariable", name=name, value=value)
    expect_status(ops(app_url, ines, p, [change("addVariable", variable={"name": "spin", "type": "Number", "value": 90}),
                                         change("addVariable", variable={"name": "boost", "type": "Number", "value": 2})]), 200, "vars")
    expect_status(ops(app_url, ines, p, [change("savePreset", name="Lively")]), 200, "save preset")
    expect_status(ops(app_url, ines, p, [v("spin", 45), v("boost", 150),
                                         change("addVariable", variable={"name": "tint", "type": "Colour", "value": "#B7A4FF"}),
                                         change("bind", layerId=p.layers["Spinner"], property="rotation.y", variable="spin")]), 200, "reset values")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    vars_of = lambda: {x["name"]: x["value"] for x in project(app_url, ines, p.id)["document"]["variables"]}
    before = vars_of()
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner, app_page(browser, app_url, f"/projects/{p.id}", S(seed, TOMAS)) as viewer:
        wait_editor(owner)
        wait_editor(viewer)
        click(viewer.get_by_role("tab", name="Variables"))
        spin_y = viewer.get_by_role("spinbutton", name="spin value").or_(viewer.get_by_role("textbox", name="spin value")).first
        eventually(viewer, lambda: field_num(spin_y) == 45, "viewer sees spin y 45")
        click(owner.get_by_role("tab", name="Presets"))
        click(owner.get_by_role("button", name="Apply Lively"))
        editor_status(owner, "Applied Lively.")
        live(viewer, lambda: field_num(spin_y) == 90, "preset reaches the viewer")
        after = vars_of()
        assert after["spin"] == 90 and after["boost"] == 2 and after["tint"] == before["tint"]
        assert inspect(app_url, ines, p, layer=p.layers["Spinner"])["values"]["rotation.y"] == 90
        click(owner.get_by_role("button", name="Undo"))
        editor_status(owner, "Undone")
        live(viewer, lambda: field_num(spin_y) == 45, "undo reaches the viewer")
    assert norm(vars_of()) == norm(before), "one undo restores every variable exactly"


WASH = {"x": 0, "y": 0, "width": 1440, "height": 810, "fill": "#CC8844", "opacity": 60}
BLEND = {"Normal": "8F7A66", "Multiply": "2D4956", "Screen": "9597A9", "Overlay": "456A7C", "Darken": "336666", "Lighten": "8F7A99"}


def test_wf_compositing_blend_sample(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    scenes = [scene("Edit", [layer("Wash", "Rectangle", 0, WASH)], background="#336699")]
    for mode in BLEND:
        scenes.append(scene(mode, [layer(f"Wash {mode}", "Rectangle", 0, WASH, blendMode=mode),
                                   layer(f"Words {mode}", "Text", 1, {"text": "Ship it", "fill": "#FFFFFF"})], background="#336699"))
    mask = {"x": 0, "y": 0, "width": 720, "height": 810, "fill": "#FFFFFF", "opacity": 50}
    scenes.append(scene("Masked", [layer("Mask", "Rectangle", 0, mask, maskAbove=True), layer("Wash m", "Rectangle", 1, WASH)], background="#336699"))
    scenes.append(scene("Hidden mask", [layer("Mask h", "Rectangle", 0, mask, maskAbove=True, visible=False), layer("Wash h", "Rectangle", 1, WASH)], background="#336699"))
    scenes.append(scene("Ellipse", [layer("Dot", "Ellipse", 0, {"x": 0, "y": 0, "width": 100, "height": 100, "fill": "#CC8844"})], background="#336699"))
    p = import_project(app_url, seed, scenes, prefix="Blend")
    sample = lambda name, x=10, y=10: inspect(app_url, ines, p, scene_id=p.scenes[name], sampleX=x, sampleY=y)["readouts"]["sample"]
    for mode, hexstr in BLEND.items():
        assert sample(mode) == sample_text(hexstr), mode
    assert sample("Masked") == sample_text("617080")
    assert sample("Hidden mask") == sample_text("8F7A66")
    assert sample("Ellipse", 1, 1) == sample_text("336699") and sample("Ellipse", 50, 50) == sample_text("CC8844")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Wash")
        with saved(page):
            select(page.get_by_role("combobox", name="Blend mode"), "Multiply")
        commit(page, "Sample X", 9)
        commit(page, "Sample Y", 10)
        sx = spin(page, "Sample X")
        sx.focus()
        sx.press("ArrowUp")
        eventually(page, lambda: field_num(sx) == 10 and focused(sx), "Sample X steps by keyboard and keeps focus")
        readout_is(page, "sample", sample_text("2D4956"))
    assert layers_by_name(project(app_url, ines, p.id)["document"])["Wash"]["blendMode"] == "Multiply"
    assert sample("Edit") == sample_text("2D4956")


def _glow(hexstr: str, strength: float, threshold: float) -> str:
    c = [int(hexstr[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    y = 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]
    k = 1 + strength * max(0, y - threshold)
    return rgb_hex(*(int(math.floor(min(1, max(0, v * k)) * 255 + 0.5)) for v in c))


def test_wf_compositing_gradients_effects(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    box = {"x": 0.5, "y": 0.5, "width": 1000, "height": 1000}
    two = [{"color": "#FF0000", "position": 0}, {"color": "#0000FF", "position": 100}]
    three = [{"color": "#FF0000", "position": 0}, {"color": "#FFFF00", "position": 40}, {"color": "#0000FF", "position": 100}]
    rect = {"x": 0, "y": 0, "width": 5, "height": 5, "fill": "#CC8844", "opacity": 100}
    p = import_project(app_url, seed, [
        scene("Two stop", [layer("Ramp a", "Gradient", 0, {**box, "gradient": {"type": "Linear", "angle": 0, "stops": two}})], background="#000000"),
        scene("Three stop", [layer("Ramp b", "Gradient", 0, {**box, "gradient": {"type": "Linear", "angle": 0, "stops": three}})], background="#000000"),
        scene("Radial", [layer("Ramp c", "Gradient", 0, {**box, "gradient": {"type": "Radial", "centerX": 50, "centerY": 50, "radius": 100, "stops": two}})], background="#000000"),
        scene("Grain", [], background="#336699"),
        scene("Pixel", [layer("Chip", "Rectangle", 0, rect)], background="#336699"),
    ], prefix="Effects")
    smp = lambda name, x, y: inspect(app_url, ines, p, scene_id=p.scenes[name], sampleX=x, sampleY=y)["readouts"]["sample"]
    assert smp("Two stop", 250, 10) == sample_text(rgb_hex(191, 0, 64))
    assert smp("Three stop", 700, 10) == sample_text(rgb_hex(128, 128, 128))
    assert smp("Radial", 525, 500) == sample_text(rgb_hex(191, 0, 64))
    with app_page(browser, app_url, f"/projects/{p.id}", ines, wrong_clock=True) as page:
        wait_editor(page)
        scene_box = page.get_by_role("combobox", name="Scene")

        def add_effect(item: str) -> None:
            click(page.get_by_role("button", name="Add layer"))
            with saved(page):
                click(choose_menu_item(page, item))

        def at(x: int, y: int) -> None:
            commit(page, "Sample X", x)
            commit(page, "Sample Y", y)

        select(scene_box, "Grain")
        add_effect("Grain")
        with saved(page):
            commit(page, "Grain amount", 0.15)
            commit(page, "Grain seed", 7)
        at(10, 20)
        readout_is(page, "sample", sample_text(rgb_hex(37, 88, 139)))
        with saved(page):
            click(page.get_by_role("switch", name="Enabled"))
        readout_is(page, "sample", sample_text("336699"), "(disabled effect passes through)")
        with saved(page):
            click(page.get_by_role("switch", name="Enabled"))
        add_effect("Glow")
        with saved(page):
            commit(page, "Glow threshold", 0.1)
        at(10, 20)
        readout_is(page, "sample", sample_text(_glow(rgb_hex(37, 88, 139), 1, 0.1)), "(glow over grain)")
        select(scene_box, "Pixel")
        at(6, 6)
        readout_is(page, "sample", sample_text("336699"))
        add_effect("Blur")
        readout_is(page, "blur", "σ 4.00 · 25 taps")
        at(6, 6)
        readout_is(page, "sample", sample_text("336699"), "(blur is not applied to the sample)")
        add_effect("Chromatic aberration")
        readout_is(page, "aberration", "R +4 px · B -4 px")
        add_effect("Pixelate")
        at(6, 6)
        readout_is(page, "sample", sample_text("CC8844"), "(pixelate reads the cell centre)")
    assert smp("Grain", 10, 20) == sample_text(_glow(rgb_hex(37, 88, 139), 1, 0.1))
    assert smp("Pixel", 6, 6) == sample_text("CC8844")


def test_wf_live_collab_editor_viewer(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block", 0), layer("Ring", "Primitive", 1, {"primitive": "Torus"})])], prefix="Collab")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner:
        wait_editor(owner)

        def send(email: str, role: str, double: bool) -> None:
            if not shows(owner.get_by_role("dialog", name="Members")):
                click(owner.get_by_role("button", name="Members"))
            if not shows(owner.get_by_role("dialog", name="Invite people")):
                click(owner.get_by_role("button", name="Invite people"))
            dialog = owner.get_by_role("dialog", name="Invite people")
            dialog.get_by_role("textbox", name="Email").fill(email)
            click(dialog.get_by_role("radio", name=role))
            button = dialog.get_by_role("button", name="Send invite")
            button.dblclick() if double else click(button)
            eventually(owner, lambda: text_of(owner.get_by_role("status", name="Members status")) == f"Invite sent to {email}.", f"invite to {email}")

        send(MARA, "Editor", False)
        send(TOMAS, "Viewer", True)
        subject = f"Join {p.name} in Halation Studio"
        assert len(mails(mail, to=TOMAS, subject=subject)) == 1
        assert len(mails(mail, to=TOMAS, subject=subject, expected=0, seconds=3)) == 1, "double click sends one mail"
        invites = http("GET", app_url, f"/api/projects/{p.id}/members", ines).json()["invites"]
        assert len([i for i in invites if i["email"] == TOMAS]) == 1, "double click makes one invite"
        token = token_from(mails(mail, to=MARA, subject=subject)[0])
        expect_status(http("POST", app_url, f"/api/invites/{token_from(mails(mail, to=TOMAS, subject=subject)[0])}/accept",
                           json={"password": PASSWORDS[TOMAS]}), 200, "Tomas accepts")
        owner.keyboard.press("Escape")
        owner.keyboard.press("Escape")
        with open_app(browser, f"{app_url}/invite/{token}") as editor:
            eventually(editor, lambda: shows(editor.get_by_role("heading", name=f"Join {p.name} as Editor")), "invite page")
            editor.get_by_role("textbox", name="Password").fill(PASSWORDS[MARA])
            click(editor.get_by_role("button", name="Accept invite"))
            eventually(editor, lambda: editor.url.rstrip("/").endswith(f"/projects/{p.id}"), "accepting opens the project")
            wait_editor(editor)
            with app_page(browser, app_url, f"/projects/{p.id}", S(seed, TOMAS)) as viewer:
                wait_editor(viewer)
                eventually(owner, lambda: shows(owner.get_by_role("img", name="Mara Lindqvist is here"))
                           and shows(owner.get_by_role("img", name="Tomas Reyes is here")), "presence")
                select_layer(owner, "Block")
                select_layer(viewer, "Block")
                select_layer(editor, "Block")
                with saved(editor):
                    commit(editor, "Position X", 3)
                live(owner, lambda: field_num(spin(owner, "Position X")) == 3, "editor's change reaches the owner")
                live(viewer, lambda: field_num(spin(viewer, "Position X")) == 3, "editor's change reaches the viewer")
                select_layer(editor, "Ring")
                select_layer(owner, "Ring")
                editor.get_by_role("slider", name="Playhead").focus()
                with saved(owner):
                    commit(owner, "Position Y", 2)
                live(editor, lambda: field_num(spin(editor, "Position Y")) == 2, "owner's change reaches the editor")
                for loc in (spin(viewer, "Position X"), viewer.get_by_role("button", name="Add layer")):
                    expect(loc).to_be_disabled()
                expect(spin(viewer, "Position X")).to_have_accessible_description("Viewers can't edit this project.")
                expect(viewer.get_by_role("slider", name="Playhead")).to_be_enabled()
    doc = layers_by_name(project(app_url, ines, p.id)["document"])
    assert prop(doc["Block"], "position.x") == 3 and prop(doc["Ring"], "position.y") == 2


def test_wf_live_collab_locks(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines, mara = S(seed, INES), S(seed, MARA)
    p = import_project(app_url, seed, [scene("Main", [cube("Block", 0), cube("Ring", 1), cube("Fresh", 2), cube("Pinned", 3)])], prefix="Locks")
    invite_and_accept(app_url, seed, mail, p, MARA, "Editor")
    held_msg = "Mara Lindqvist is editing this layer."
    expect_status(set_layer(app_url, mara, p, "Ring", {"position.x": 1}), 200, "Mara edits Ring")
    expect_error(set_layer(app_url, ines, p, "Ring", {"position.x": 2}), 409, "layer_held", held_msg, "Ines refused")
    expect_error(http("PUT", app_url, f"/api/projects/{p.id}/layers/{p.layers['Ring']}/lock", ines), 409, "layer_held", None, "lock held")
    advance_server(app_url, (LOCK_TIMEOUT_S + 1) * 1000)
    expect_status(set_layer(app_url, ines, p, "Ring", {"position.x": 2}), 200, "lock times out after LOCK_TIMEOUT_SECONDS")
    expect_status(http("PUT", app_url, f"/api/projects/{p.id}/layers/{p.layers['Block']}/lock", mara), 200, "Mara takes Block")
    expect_status(http("DELETE", app_url, f"/api/projects/{p.id}/layers/{p.layers['Block']}/lock", mara), 204, "deselect release")
    expect_status(set_layer(app_url, ines, p, "Block", {"position.y": 1}), 200, "Ines edits after release")
    expect_status(http("DELETE", app_url, f"/api/projects/{p.id}/layers/{p.layers['Block']}/lock", ines), 204, "release")
    url = f"/api/projects/{p.id}/layers/{p.layers['Fresh']}/lock"
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        codes = sorted(f.result().status_code for f in [pool.submit(http, "PUT", app_url, url, s) for s in (ines, mara)])
    assert codes == [200, 409], f"exactly one lock winner: {codes}"
    expect_status(set_layer(app_url, ines, p, "Pinned", {"locked": True}), 200, "lock flag on")
    expect_error(set_layer(app_url, ines, p, "Pinned", {"position.x": 1}), 409, "layer_locked", "Pinned is locked.", "locked layer")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner, app_page(browser, app_url, f"/projects/{p.id}", mara) as editor:
        wait_editor(owner)
        wait_editor(editor)
        select_layer(editor, "Block")
        with saved(editor):
            commit(editor, "Position Z", 1)
        live(owner, lambda: "Held by Mara Lindqvist" in text_of(row(owner, "Block")), "owner sees who holds the layer", seconds=WAIT_S)
        editor.get_by_role("slider", name="Playhead").focus()
        deadline = time.monotonic() + WAIT_S
        while time.monotonic() < deadline:
            advance(editor, 50)
            if http("PUT", app_url, f"/api/projects/{p.id}/layers/{p.layers['Block']}/lock", ines).status_code == 200:
                break
        else:
            pytest.fail("lock released when the holder's inspector loses focus")
        live(owner, lambda: "Held by" not in text_of(row(owner, "Block")) or "Ines" in text_of(row(owner, "Block")), "row no longer held by Mara", seconds=WAIT_S)


def test_wf_live_collab_roles_counts(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines, mara, tomas = S(seed, INES), S(seed, MARA), S(seed, TOMAS)
    group = layer("Folder", "Group", 2)
    p = import_project(app_url, seed, [scene("Main", [layer("A", "Rectangle", 0), layer("B", "Ellipse", 1), group,
                                                      {**layer("C", "Rectangle", 0), "parentId": group["id"]}])], prefix="Counts")
    invite_and_accept(app_url, seed, mail, p, MARA, "Editor")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/invites", ines, json={"email": fresh_email("pending"), "role": "Viewer"}), 201, "pending invite")

    def recount() -> tuple[int, int, int]:
        doc = project(app_url, ines, p.id)["document"]
        members = http("GET", app_url, f"/api/projects/{p.id}/members", ines).json()["members"]
        return (sum(1 for l in layers_by_name(doc).values() if l["kind"] != "Group"),
                sum(1 for m in members if m["role"] == "Editor"), sum(1 for m in members if m["role"] == "Viewer"))

    def check(layers: int, live_v: int | None, editors: int, viewers: int) -> None:
        s = summary_of(app_url, ines, p.id)
        assert (s["layerCount"], s["liveVersion"], s["editorCount"], s["viewerCount"]) == (layers, live_v, editors, viewers), s
        assert recount() == (layers, editors, viewers)

    check(3, None, 1, 1)
    expect_error(ops(app_url, tomas, p, [change("deleteLayer", layerId=p.layers["A"])]), 403, "forbidden", "Viewers can't edit this project.", "viewer edit")
    expect_error(publish(app_url, mara, p.id), 403, "forbidden", "Only the owner can publish.", "editor publish")
    stray = fresh_email("stray")
    expect_error(http("POST", app_url, f"/api/projects/{p.id}/invites", mara, json={"email": stray, "role": "Viewer"}), 403, "forbidden",
                 "Only the owner can manage members.", "editor invite")
    expect_error(http("DELETE", app_url, f"/api/projects/{p.id}", mara), 403, "forbidden", "Only the owner can manage members.", "editor trash")
    assert versions(app_url, ines, p.id) == [] and mails(mail, to=stray, expected=0, seconds=3) == []
    with app_page(browser, app_url, "/projects", mara) as page:
        card = page.get_by_role("article", name=p.name)
        eventually(page, lambda: shows(card), "card in the project thumbnail mosaic")
        assert (card.get_attribute("data-layer-count"), card.get_attribute("data-live-version"),
                card.get_attribute("data-editor-count"), card.get_attribute("data-viewer-count")) == ("3", "", "1", "1")
        body = card.inner_text()
        assert "3 layers" in body and "Not published" in body and counts_text(1, 1) in body
        assert card.get_by_role("button", name=f"Move {p.name} to trash").count() == 0
    expect_status(publish(app_url, ines, p.id), 201, "publish")
    check(3, 1, 1, 1)
    expect_status(ops(app_url, ines, p, [change("deleteLayer", layerId=p.layers["C"])]), 200, "delete layer in group")
    check(2, 1, 1, 1)
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/undo", ines, json={"opId": new_id("op")}), 200, "undo")
    check(3, 1, 1, 1)
    tomas_id = seed["people"][TOMAS]["id"]
    expect_status(http("DELETE", app_url, f"/api/projects/{p.id}/members/{tomas_id}", ines), 204, "remove viewer")
    check(3, 1, 1, 0)
    expect_status(http("DELETE", app_url, f"/api/projects/{p.id}", ines), 200, "trash")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/restore", ines), 200, "restore")
    check(3, 1, 1, 0)
    with app_page(browser, app_url, "/projects", mara) as page:
        card = page.get_by_role("article", name=p.name)
        eventually(page, lambda: shows(card) and card.get_attribute("data-viewer-count") == "0", "card recomputed")
        assert card.get_attribute("data-live-version") == "1" and "Live version 1" in card.inner_text() and counts_text(1, 0) in card.inner_text()


def test_wf_publish_embed_publish_once(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Publish")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        with held(page, "**/versions") as gate:
            page.get_by_role("button", name="Publish").dblclick()
            busy = page.get_by_role("button").filter(has_text="Publishing…").first
            eventually(page, lambda: shows(busy), "Publishing… while pending")
            expect(busy).to_be_disabled()
            gate.release()
        editor_status(page, "Version 1 is live.")
    vs = versions(app_url, ines, p.id)
    assert [v["number"] for v in vs] == [1], "one click, one version"
    s3 = S3()
    bundle = s3.get(f"projects/{p.id}/versions/1/scene.json")
    export1 = expect_status(http("GET", app_url, f"/api/projects/{p.id}/versions/1/export", ines), 200, "export v1").content
    assert bundle == export1 and vs[0]["sha256"] == hashlib.sha256(bundle).hexdigest()
    assert json.loads(bundle)["schemaVersion"] == 3 and p.layers["Block"] in bundle.decode()
    key = idempotency_key()
    v2 = expect_status(publish(app_url, ines, p.id, key=key), 201, "v2").json()
    assert expect_status(publish(app_url, ines, p.id, key=key), 201, "replay").json() == v2
    expect_error(publish(app_url, ines, p.id, {"fromVersion": 1}, key=key), 409, "idempotency_conflict",
                 "This key was already used for a different request.", "key conflict")
    same = idempotency_key()
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        res = [f.result() for f in [pool.submit(publish, app_url, ines, p.id, None, same) for _ in range(2)]]
    assert [r.status_code for r in res] == [201, 201] and res[0].json()["version"]["number"] == res[1].json()["version"]["number"] == 3
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        res = [f.result() for f in [pool.submit(publish, app_url, ines, p.id) for _ in range(2)]]
    assert sorted(r.json()["version"]["number"] for r in res) == [4, 5], "different keys get consecutive numbers"
    expect_status(set_layer(app_url, ines, p, "Block", {"position.x": 7}), 200, "edit after publish")
    assert http("GET", app_url, f"/api/projects/{p.id}/versions/1/export", ines).content == export1, "versions never change"
    six = expect_status(publish(app_url, ines, p.id, {"fromVersion": 1}), 201, "republish v1").json()["version"]
    assert six["number"] == 6
    export6 = json.loads(http("GET", app_url, f"/api/projects/{p.id}/versions/6/export", ines).content)
    assert norm(export6["scenes"]) == norm(json.loads(export1)["scenes"])
    expect_status(publish(app_url, ines, p.id, {"fromVersion": 99}), 422, "unknown fromVersion")
    for method in ("PUT", "PATCH", "DELETE"):
        expect_error(http(method, app_url, f"/api/projects/{p.id}/versions/1", ines, json={}), 405, "immutable",
                     "Published versions can't be changed.", method)
    expect_status(publish(outage_url("APP_MINIO_DOWN_URL"), ines, p.id), 503, "publish with storage down")
    assert sorted(v["number"] for v in versions(app_url, ines, p.id)) == [1, 2, 3, 4, 5, 6] and not s3.keys(f"projects/{p.id}/versions/7/")
    assert expect_status(publish(app_url, ines, p.id), 201, "next").json()["version"]["number"] == 7, "numbers stay gapless"
    statuses = {v["number"]: v["status"] for v in versions(app_url, ines, p.id)}
    assert statuses[7] == "live" and all(s == "superseded" for n, s in statuses.items() if n != 7)


def test_wf_publish_embed_live_swap(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Swap")
    expect_status(publish(app_url, ines, p.id), 201, "v1")
    bundle1 = http("GET", app_url, f"/api/embed/{p.id}/scene").content
    with app_page(browser, app_url, f"/embed/{p.id}") as embed:
        eventually(embed, lambda: shows(embed.get_by_role("region", name=f"{p.name}, version 1")), "embed v1")
        advance(embed, 50)
        eventually(embed, lambda: embed_values(embed, "Block")["position.x"] == 0, "embed v1 values")
        embed.evaluate("() => { window.__kept = 1; }")
        expect_status(set_layer(app_url, ines, p, "Block", {"position.x": 5}), 200, "unpublished edit")
        r = http("GET", app_url, f"/api/embed/{p.id}/scene")
        assert r.content == bundle1 and r.headers["x-halation-version"] == "1" and r.headers["x-scene-source"] == "bundle"
        advance(embed, 1000)
        assert embed_values(embed, "Block")["position.x"] == 0, "unpublished edits never reach an embed"
        expect_status(publish(app_url, ines, p.id), 201, "v2")
        live(embed, lambda: shows(embed.get_by_role("region", name=f"{p.name}, version 2")) and embed_values(embed, "Block")["position.x"] == 5, "swap to v2")
        assert embed.evaluate("() => window.__kept") == 1, "swapped in place without a reload"
        with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
            page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
            wait_editor(page)
            click(page.get_by_role("button", name="Versions"))
            dialog = page.get_by_role("dialog", name="Versions")
            eventually(page, lambda: shows(dialog), "Versions dialog")
            click(dialog.get_by_role("button", name="Republish version 1"))
            editor_status(page, "Version 3 is live.")
            live(embed, lambda: shows(embed.get_by_role("region", name=f"{p.name}, version 3")) and embed_values(embed, "Block")["position.x"] == 0, "swap to v3")
            items = dialog.get_by_role("list", name="Versions").get_by_role("listitem")
            eventually(page, lambda: items.filter(has_text=re.compile(r"^Version 3 · .* · Live")).count() == 1
                       and items.filter(has_text=re.compile(r"^Version 1 · .* · Superseded")).count() == 1, "version list")
            code = dialog.get_by_role("textbox", name="Embed code").input_value()
            assert f"/embed/{p.id}" in code
            click(dialog.get_by_role("button", name="Copy embed code"))
            editor_status(page, "Embed code copied.")
            assert page.evaluate("() => navigator.clipboard.readText()") == code
    assert http("GET", app_url, f"/api/embed/{p.id}/version").json() == {"number": 3}


def test_wf_publish_embed_notices(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Notice")
    invite_and_accept(app_url, seed, mail, p, MARA, "Editor")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    key = idempotency_key()
    expect_status(publish(app_url, ines, p.id, key=key), 201, "v1")
    subject = f"{p.name} version 1 is live"
    for who in (INES, MARA):
        msg = mails(mail, to=who, subject=subject)[0]
        assert "Ines Okafor" in text(msg)
    expect_status(publish(app_url, ines, p.id, key=key), 201, "replay")
    for who, n in ((INES, 1), (MARA, 1), (TOMAS, 0)):
        assert len(mails(mail, to=who, subject=subject, expected=0, seconds=3)) == n, f"{who} gets {n} notice(s)"
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline and versions(app_url, ines, p.id)[0]["notice"] != "sent":
        pass
    assert versions(app_url, ines, p.id)[0]["notice"] == "sent"
    expect_status(publish(app_url, ines, p.id, {"fromVersion": 1}), 201, "republish")
    for who in (INES, MARA):
        assert len(mails(mail, to=who, subject=f"{p.name} version 2 is live")) == 1
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        click(page.get_by_role("button", name="Versions"))
        items = page.get_by_role("list", name="Versions").get_by_role("listitem")
        eventually(page, lambda: items.filter(has_text=re.compile(r"^Version 1 · ")).filter(has_text="Notice sent").count() == 1, "Notice sent")


def phone_action(page: Page, name: str) -> None:
    btn = page.get_by_role("button", name=name, exact=True)
    if shows(btn):
        tap(btn.first)
        return
    tap(page.get_by_role("button", name="More actions"))
    for loc in (page.get_by_role("menuitem", name=name, exact=True), page.get_by_role("button", name=name, exact=True)):
        for item in loc.all():
            if item.is_visible():
                tap(item)
                return
    pytest.fail(f"{name} reachable from the header or More actions")


def big_enough(loc: Locator) -> None:
    b = loc.bounding_box()
    assert b and b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, f"touched control is 44 px: {b}"


def test_wf_phone_layers_import_phone_edit(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Base", "Rectangle", 0), layer("Glow", "Ellipse", 1),
                                                      layer("Spark", "Polygon", 2), layer("Caption", "Text", 3, {"text": "Ship it"})])], prefix="Phone")
    stored = lambda: layers_by_name(project(app_url, ines, p.id)["document"])
    count = lambda: summary_of(app_url, ines, p.id)["layerCount"]
    with app_page(browser, app_url, f"/projects/{p.id}", ines, viewport=(390, 844)) as page:
        tab = page.get_by_role("tablist", name="Editor panels").get_by_role("tab", name="Layers")
        eventually(page, lambda: shows(tab), "Editor panels")
        big_enough(tab)
        tap(tab)
        wait_editor(page)

        def menu(layer_name: str, item: str) -> None:
            opener = page.get_by_role("button", name=f"Actions for {layer_name}")
            big_enough(opener)
            tap(opener)
            entry = choose_menu_item(page, item)
            big_enough(entry)
            with saved(page):
                tap(entry)

        menu("Caption", "Move down")
        assert stored()["Caption"]["order"] < stored()["Spark"]["order"], "Move down lowers Caption below Spark"
        menu("Glow", "Duplicate")
        glows = [l for l in stored().values() if l["kind"] == "Ellipse"]
        assert len(glows) == 2 and count() == 5
        hide = page.get_by_role("button", name="Hide Spark")
        big_enough(hide)
        with saved(page):
            tap(hide)
        eventually(page, lambda: shows(page.get_by_role("button", name="Show Spark")), "Hide toggles to Show")
        assert stored()["Spark"]["visible"] is False
        menu("Base", "Group")
        groups = [l for l in stored().values() if l["kind"] == "Group"]
        assert len(groups) == 1 and stored()["Base"]["parentId"] == groups[0]["id"] and count() == 5, "groups are not counted"
        phone_action(page, "Undo")
        editor_status(page, "Undone")
        eventually(page, lambda: stored()["Base"]["parentId"] is None and not [l for l in stored().values() if l["kind"] == "Group"], "undo ungroups")
        phone_action(page, "Redo")
        editor_status(page, "Redone")
        eventually(page, lambda: any(l["kind"] == "Group" for l in stored().values()), "redo groups again")
    assert count() == sum(1 for l in stored().values() if l["kind"] != "Group") == 5


def test_wf_phone_layers_import_trash_restore(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block", 0), cube("Turner", 1)])], prefix="Trash")
    ring = p.layers["Turner"]
    expect_status(ops(app_url, ines, p, [
        change("setKeyframe", layerId=ring, property="rotation.y", frame=0, value=0, easing="linear"),
        change("setKeyframe", layerId=ring, property="rotation.y", frame=60, value=90, easing="ease-out"),
        change("addVariable", variable={"name": "lift", "type": "Number", "value": 3}),
        change("bind", layerId=ring, property="position.y", variable="lift")]), 200, "keyframes and binding")
    expect_status(set_layer(app_url, ines, p, "Turner", {"position.x": 2}, bp="tablet"), 200, "override")
    expect_status(publish(app_url, ines, p.id), 201, "v1")
    export_url = f"/api/projects/{p.id}/export"
    before = norm(http("GET", app_url, export_url, ines).json())
    v1 = http("GET", app_url, f"/api/projects/{p.id}/versions/1/export", ines).content
    expect_status(ops(app_url, ines, p, [change("deleteLayer", layerId=ring)]), 200, "delete layer")
    assert "Turner" not in layers_by_name(project(app_url, ines, p.id)["document"])
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/undo", ines, json={"opId": new_id("op")}), 200, "undo delete")
    assert norm(http("GET", app_url, export_url, ines).json()) == before, "undone delete restores the layer exactly"
    s = expect_status(http("DELETE", app_url, f"/api/projects/{p.id}", ines), 200, "trash").json()["project"]
    assert s["status"] == "trashed" and parse_iso(s["purgeAt"]) - parse_iso(s["trashedAt"]) == timedelta(days=PURGE_DAYS)
    r = http("GET", app_url, f"/embed/{p.id}")
    assert r.status_code == 404 and "This scene is not published." in r.text
    expect_error(set_layer(app_url, ines, p, "Block", {"position.x": 1}), 409, "trashed", "This project is in the trash. Restore it to edit.", "edit trashed")
    expect_error(publish(app_url, ines, p.id), 409, "trashed", None, "publish trashed")
    expect_error(http("DELETE", app_url, f"/api/projects/{p.id}", ines), 409, "already_trashed", "This project is already in the trash.", "trash twice")
    date, _ = local_date_time(parse_iso(s["purgeAt"]))
    with app_page(browser, app_url, "/projects", ines, wrong_clock=True) as page:
        page.set_default_timeout(WAIT_S * 1000)
        tab = page.get_by_role("tablist", name="Projects").get_by_role("tab", name="Trash")
        eventually(page, lambda: shows(tab), "Projects tabs")
        click(tab)
        item = page.get_by_role("listitem").filter(has_text=f"{p.name} · purges on {date}")
        eventually(page, lambda: shows(item), "Trash tab shows the server purge date")
        click(page.get_by_role("button", name=f"Restore {p.name}"))
        eventually(page, lambda: shows(page.get_by_text(f"Restored {p.name}.", exact=True)), "Restored status")
    assert summary_of(app_url, ines, p.id)["status"] == "active"
    assert norm(http("GET", app_url, export_url, ines).json()) == before, "restore brings everything back exactly"
    assert http("GET", app_url, f"/api/projects/{p.id}/versions/1/export", ines).content == v1
    assert http("GET", app_url, f"/api/embed/{p.id}/scene").content == v1
    expect_error(http("POST", app_url, f"/api/projects/{p.id}/restore", ines), 409, "not_trashed", "This project is not in the trash.", "restore active")


IMPORT_REFUSALS = [
    (b"{not json", "This file is not valid JSON."),
    (json.dumps({"name": "x", "scenes": []}).encode(), "Missing field: schemaVersion"),
    (json.dumps({"schemaVersion": 4, "name": "x", "scenes": []}).encode(), "This file uses schema version 4; this app reads up to version 3."),
    (json.dumps({"schemaVersion": 3, "name": "x", "scenes": [{"id": "s1", "name": "Main", "camera": {"fov": 500}, "layers": [
        {"id": "a", "name": "A", "kind": "Rectangle"}, {"id": "b", "name": "B", "kind": "Rectangle"}, {"id": "c", "name": "C"}]}]}).encode(),
     "Missing field: scenes[0].layers[2].kind"),
    (json.dumps({"schemaVersion": 3, "name": "x", "scenes": [{"id": "s1", "name": "Main", "camera": {"fov": 500}, "layers": []}]}).encode(),
     "Value out of range: scenes[0].camera.fov is 500 (allowed 10 to 120)."),
]


def test_wf_phone_layers_import_json(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    name = fresh_name("Imported")
    sid, lid = new_id("s"), new_id("l")
    original = json.dumps({"schemaVersion": 3, "name": name, "scenes": [{"id": sid, "name": "Main", "layers": [
        {"id": lid, "name": "Plate", "kind": "Rectangle"}]}]}, indent=1).encode()
    with app_page(browser, app_url, "/projects", ines) as page:
        page.set_default_timeout(WAIT_S * 1000)
        opener = page.get_by_role("button", name="Import JSON")
        eventually(page, lambda: page.get_by_role("article").count() > 0 and shows(opener), "project cards and Import JSON button")
        with page.expect_file_chooser() as chooser:
            click(opener)
        chooser.value.set_files(files=[{"name": "hero.json", "mimeType": "application/json", "buffer": original}])
        eventually(page, lambda: shows(page.get_by_text(re.compile(rf"^Created .*{re.escape(name)}.*\(imported\)\.$"))), "import status")
        with page.expect_file_chooser() as chooser:
            click(opener)
        chooser.value.set_files(files=[{"name": "bad.json", "mimeType": "application/json", "buffer": IMPORT_REFUSALS[2][0]}])
        eventually(page, lambda: IMPORT_REFUSALS[2][1] in text_of(page.get_by_role("alert")), "refusal shown in an alert")
    listed = http("GET", app_url, "/api/projects", ines, params={"status": "active"}).json()["projects"]
    pid = next(x["id"] for x in listed if x["name"] == f"{name} (imported)")
    assert S3().get(f"projects/{pid}/imports/original.json") == original
    assert http("GET", app_url, f"/api/projects/{pid}/import/original", ines).content == original
    assert b"durationMs" not in original
    export = http("GET", app_url, f"/api/projects/{pid}/export", ines).json()
    assert export["schemaVersion"] == 3 and export["name"] == f"{name} (imported)"
    sc = export["scenes"][0]
    assert sc["id"] == sid and sc["layers"][0]["id"] == lid
    assert (sc["background"], sc["environment"], sc["durationMs"], sc["camera"]["fov"], sc["camera"]["near"], sc["camera"]["far"]) == \
        ("#0B0B0E", "Flat", 5000, 50, 0.1, 100)
    assert sc["camera"]["position"] == {"x": 0, "y": 0, "z": 10}
    lay = sc["layers"][0]
    assert (lay["visible"], lay["locked"], lay["maskAbove"], lay["blendMode"], lay["overrides"], lay["keyframes"]) == \
        (True, False, False, "Normal", {"tablet": {}, "mobile": {}}, [])
    r = http("POST", app_url, "/api/imports", ines, data={"workspaceId": seed["workspaces"]["Lumen Yard"]},
             files={"file": ("again.json", json.dumps(export).encode(), "application/json")})
    again = expect_status(r, 201, "re-import export").json()["project"]["id"]
    export2 = http("GET", app_url, f"/api/projects/{again}/export", ines).json()
    export.pop("name")
    export2.pop("name")
    assert norm(export2) == norm(export), "re-import exports identically apart from name"
    names_before = {x["name"] for x in http("GET", app_url, "/api/projects", ines, params={"status": "active"}).json()["projects"]}
    for raw, message in IMPORT_REFUSALS:
        r = http("POST", app_url, "/api/imports", ines, data={"workspaceId": seed["workspaces"]["Lumen Yard"]},
                 files={"file": ("broken.json", raw, "application/json")})
        err = expect_error(r, 422, "validation", message, f"refusal {message}")
        assert err["errors"]["file"] == message
    kind = json.dumps({"schemaVersion": 3, "name": "x", "scenes": [{"id": "s1", "name": "Main", "layers": [{"id": "a", "name": "A", "kind": "Blob"}]}]}).encode()
    r = http("POST", app_url, "/api/imports", ines, data={"workspaceId": seed["workspaces"]["Lumen Yard"]}, files={"file": ("k.json", kind, "application/json")})
    assert re.match(r'^Unknown layer kind "Blob" at scenes\[0\]\.layers\[0\]', expect_status(r, 422, "unknown kind").json()["message"])
    after = {x["name"] for x in http("GET", app_url, "/api/projects", ines, params={"status": "active"}).json()["projects"]}
    assert after == names_before, "refused imports create no project"
    plain = import_project(app_url, seed, [scene("Main", [])], prefix="Plain")
    assert plain.id
    expect_status(http("GET", app_url, f"/api/projects/{seed['projects']['Phone kit']['id']}/import/original", ines), 404, "not imported")


def test_if_run_manifest() -> None:
    m = json.loads((APP_ROOT / "run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(m.get(key), str) and m[key].strip(), key


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "BlueOak-1.0.0"}


def test_if_third_party_notices() -> None:
    notices = (APP_ROOT / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [pkg.name for pkg in shipped_packages() if pkg.name not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"


def test_if_licence_allowlist() -> None:
    bad = [(pkg.name, pkg.licence) for pkg in shipped_packages() if not licence_allowed(pkg.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad[:20]}"


EXTRA_STORES = {"redis", "ioredis", "mongodb", "mongoose", "bullmq", "bull", "amqplib", "kafkajs", "sqlite3", "better-sqlite3", "memcached", "nats", "level"}


def test_if_no_extra_datastores() -> None:
    names = {pkg.name for pkg in shipped_packages()}
    assert not names & EXTRA_STORES, f"extra datastore clients: {names & EXTRA_STORES}"


MEDIA_SUFFIXES = {".ttf", ".otf", ".woff", ".woff2", ".eot", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".avif", ".glb", ".gltf",
                  ".hdr", ".ktx2", ".mp4", ".webm", ".mov"}


def test_if_no_shipped_media() -> None:
    skip = {"node_modules", ".git", "dist", "build"}
    found = [str(f) for f in APP_ROOT.rglob("*") if f.is_file() and f.suffix.lower() in MEDIA_SUFFIXES and not skip & set(f.relative_to(APP_ROOT).parts)]
    assert not found, f"media files shipped: {found[:20]}"


def test_if_seeded_settings_unchanged() -> None:
    down = outage_url("APP_MAILPIT_DOWN_URL")
    expect_status(grading(down, "/api/grading/reset"), 200, "reset with the provided key")
    start = parse_iso(os.environ.get("APP_START_AT", "2026-11-06T10:00:00Z"))
    now = server_now(down)
    assert timedelta(0) <= now - start < timedelta(minutes=5), f"clock after reset {now}"


def test_if_lockfile_used() -> None:
    lock = json.loads((APP_ROOT / "package-lock.json").read_text())
    assert lock.get("lockfileVersion")
    install = json.loads((APP_ROOT / "run.json").read_text())["install"]
    assert "npm ci" in install or "npm install" in install


def test_if_no_outside_fetches(browser: Browser, app_url: str, seed: dict) -> None:
    outside: list[str] = []
    for path, sess in (("/", None), (f"/projects/{seed['projects']['Model bay']['id']}", S(seed, INES)), (f"/embed/{seed['projects']['Model bay']['id']}", None)):
        with app_page(browser, app_url, path, sess) as page:
            page.on("request", lambda req: outside.append(req.url)
                    if not req.url.startswith(("data:", "blob:")) and not same_origin(req.url, app_url) else None)
            page.reload()
            advance(page, 2000)
    assert not outside, f"outside requests: {outside[:10]}"


GA_CAMERA_Z = 10
GA_DESKTOP = (1440, 810)
GA_FOV = 50
GA_PARTICLE_MAX = 2000
GA_FRAMES_PER_S = 60
GA_GLIDE = (0.22, 1, 0.36, 1)
GA_CUBE_CORNER = (0.5, 0.5, 0.5)


def _ga_round(x: float, decimals: int) -> str:
    k = 10 ** decimals
    q = math.floor(abs(x) * k + 0.5) / k
    v = q if x >= 0 else -q
    return f"{0.0 if v == 0 else v:.{decimals}f}"


def _ga_world(local: tuple, pos: tuple = (0, 0, 0), rot: tuple = (0, 0, 0), scale: tuple = (1, 1, 1)) -> tuple:
    x, y, z = (local[i] * scale[i] for i in range(3))
    a = math.radians(rot[0])
    y, z = y * math.cos(a) - z * math.sin(a), y * math.sin(a) + z * math.cos(a)
    b = math.radians(rot[1])
    x, z = x * math.cos(b) + z * math.sin(b), -x * math.sin(b) + z * math.cos(b)
    c = math.radians(rot[2])
    x, y = x * math.cos(c) - y * math.sin(c), x * math.sin(c) + y * math.cos(c)
    return x + pos[0], y + pos[1], z + pos[2]


def _ga_screen(world: tuple, fov: float = GA_FOV, size: tuple = GA_DESKTOP) -> str:
    w, h = size
    xc, yc, zc = world[0], world[1], world[2] - GA_CAMERA_Z
    f = 1 / math.tan(math.radians(fov) / 2)
    ndc_x = (f / (w / h)) * xc / -zc
    ndc_y = f * yc / -zc
    return f"{_ga_round((ndc_x + 1) / 2 * w, 2)}, {_ga_round((1 - ndc_y) / 2 * h, 2)} px"


def _ga_slerp(q0: tuple, q1: tuple, t: float) -> tuple:
    dot = sum(a * b for a, b in zip(q0, q1))
    if dot < 0:
        q1, dot = tuple(-v for v in q1), -dot
    if dot > 0.9995:
        q = tuple(a + (b - a) * t for a, b in zip(q0, q1))
    else:
        th = math.acos(dot)
        q = tuple((math.sin((1 - t) * th) * a + math.sin(t * th) * b) / math.sin(th) for a, b in zip(q0, q1))
    n = math.sqrt(sum(v * v for v in q))
    return tuple(v / n for v in q)


def _ga_turn(c: float) -> tuple[str, str]:
    s45 = math.sin(math.radians(45))
    t = min(max(c / 2, 0), 1)
    q = _ga_slerp((0, 0, 0, 1), (0, s45, 0, s45), t)
    quat = "Quaternion " + ", ".join(_ga_round(v, 4) for v in q)
    return quat, f"Translation {vec(2 * t, 1 * t, 0)}"


def _ga_bezier(x1: float, y1: float, x2: float, y2: float, x: float) -> float:
    def bez(p1: float, p2: float, s: float) -> float:
        return 3 * (1 - s) ** 2 * s * p1 + 3 * (1 - s) * s * s * p2 + s ** 3
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        if bez(x1, x2, mid) < x:
            lo = mid
        else:
            hi = mid
    return bez(y1, y2, (lo + hi) / 2)


def _ga_emit(props: dict, frame: int) -> dict[int, dict]:
    rnd = mulberry32(int(props["seed"]))
    dt = 1 / GA_FRAMES_PER_S
    g, spd, rate = props["gravity"], props["speed"], props["rate"]
    att = props.get("attractor", {})
    strength = att.get("strength", 0)
    ax, ay, az = att.get("x", 0), att.get("y", 0), att.get("z", 0)
    life = int(math.floor(props["lifetime"] * GA_FRAMES_PER_S + 0.5))
    theta = math.radians(props.get("orbit", 0) * dt)
    live: dict[int, dict] = {}
    nxt = [1]

    def spawn(k: int) -> None:
        if len(live) + 1 > GA_PARTICLE_MAX:
            return
        u = (rnd(), rnd(), rnd())
        live[nxt[0]] = {"born": k, "p": [0.0, 0.0, 0.0], "v": [(2 * x - 1) * spd for x in u]}
        nxt[0] += 1

    for _ in range(int(props["burst"])):
        spawn(0)
    for k in range(1, frame + 1):
        for n in sorted(live):
            p, v = live[n]["p"], live[n]["v"]
            a = (strength * (ax - p[0]), -g + strength * (ay - p[1]), strength * (az - p[2]))
            for i in range(3):
                v[i] += a[i] * dt
                p[i] += v[i] * dt
            x, z = p[0], p[2]
            p[0], p[2] = x * math.cos(theta) + z * math.sin(theta), -x * math.sin(theta) + z * math.cos(theta)
        for n in [n for n, q in live.items() if k >= q["born"] + life]:
            del live[n]
        for _ in range(int(math.floor(rate * k / 60) - math.floor(rate * (k - 1) / 60))):
            spawn(k)
    return live


def _ga_halo_corner(index: int, letter: float = 1, depth: float = 0.2, bevel: float = 0.02, text: str = "HALO") -> tuple:
    chars = [i for i, ch in enumerate(text) if ch != " "]
    v = 4 * len(chars)
    i, corner = divmod(index % v, 4)
    width = letter * (0.7 * len(text) - 0.1)
    left = -width / 2 + chars[i] * 0.7 * letter
    top = letter / 2
    xs = (left, left + 0.6 * letter, left + 0.6 * letter, left)
    ys = (top, top, top - letter, top - letter)
    return xs[corner], ys[corner], depth / 2 + bevel


def _ga_formation(n: int, frame: int, seed_value: int = 7, duration_ms: float = 1500) -> str:
    rnd = mulberry32(seed_value)
    start = (0.0, 0.0, 0.0)
    for _ in range(n):
        start = tuple(4 * rnd() - 2 for _ in range(3))
    target = _ga_halo_corner(n - 1)
    t = frame * 1000 / GA_FRAMES_PER_S / duration_ms
    e = 1.0 if t >= 1 else _ga_bezier(*GA_GLIDE, t)
    return particle_text(n, *(s + (g - s) * e for s, g in zip(start, target)))


def _ga_tap_tab(page: Page, name: str) -> None:
    tab = page.get_by_role("tablist", name="Editor panels").get_by_role("tab", name=name)
    eventually(page, lambda: shows(tab), f"Editor panels tab {name}")
    tap(tab)


def _ga_clip_time(page: Page, clip: str) -> Locator:
    key = "clip-time"
    return page.get_by_role("region", name="Readouts").locator(f'[data-readout="{key}"]').filter(has_text=re.compile(rf"^{re.escape(clip)} "))


def _ga_draw_order(page: Page) -> list[str]:
    return [t.strip() for t in page.get_by_role("list", name="Draw order").get_by_role("listitem").all_inner_texts()]


GA_ROTATION_STEP, GA_ROTATION_SHIFT = 1, 15
GA_SCALE_STEP, GA_SCALE_SHIFT = 0.1, 1
GA_REFRACTION_STEP = 0.05
GA_SPEED_STEP = 0.25
GA_RING_DEG_PER_PX = 0.5
GA_HOP_KEYS = ((0, 0), (0.5, 1), (1, 0))
GA_HOP_S = 1


def _ga_press(loc: Locator, key: str, times: int) -> None:
    loc.focus()
    for _ in range(times):
        loc.press(key)


def _ga_hop(frame: int, offset_s: float, loop: bool) -> tuple[str, str]:
    c = max(0.0, frame / GA_FRAMES_PER_S - offset_s)
    c = math.fmod(c, GA_HOP_S) if loop else min(c, GA_HOP_S)
    y = [v for t, v in GA_HOP_KEYS if t <= c + 1e-9][-1]
    return f"Hop {r3(c)} s", f"Translation {vec(0, y, 0)}"


def _ga_playhead(page: Page, frame: int) -> Locator:
    ph = page.get_by_role("slider", name="Playhead")
    eventually(page, lambda: field_num(ph) == frame, f"Playhead at frame {frame}")
    return ph


def test_wf_primitive_transform_shift_steps_vertex(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Spinner")])], prefix="Steps")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Spinner")
        with saved(page):
            rx = spin(page, "Rotation X")
            _ga_press(rx, "Shift+ArrowUp", 2)
            eventually(page, lambda: round(field_num(rx), 3) == 2 * GA_ROTATION_SHIFT, "Shift+ArrowUp steps Rotation X by 15")
            assert focused(rx), "focus stays on Rotation X (L202)"
            sy = spin(page, "Scale Y")
            _ga_press(sy, "Shift+ArrowUp", 2)
            sy.press("ArrowDown")
            scale_y = 1 + 2 * GA_SCALE_SHIFT - GA_SCALE_STEP
            eventually(page, lambda: round(field_num(sy), 3) == round(scale_y, 3), "Scale Y steps 1 (Shift) and 0.1")
        select(page.get_by_role("combobox", name="Vertex"), "+x +y +z")
        world = _ga_world(GA_CUBE_CORNER, rot=(2 * GA_ROTATION_SHIFT, 0, 0), scale=(1, scale_y, 1))
        readout_is(page, "vertex-world", vec(*world), "(scale first, then rotation about X)")
        readout_is(page, "vertex-point", _ga_screen(world))
    block = layers_by_name(project(app_url, ines, p.id)["document"])["Spinner"]
    assert prop(block, "rotation.x") == 2 * GA_ROTATION_SHIFT and round(prop(block, "scale.y"), 3) == round(scale_y, 3)


def test_wf_primitive_transform_ring_shift_snap(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Slab")])], prefix="Ring")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Slab")
        rx = spin(page, "Rotation X")
        ring = page.get_by_role("button", name="Rotate around X")
        coarse_px = 40
        fine_px = -26
        with saved(page):
            drag(page, ring, coarse_px, 0, shift=True)
            eventually(page, lambda: round(field_num(rx), 3) == GA_ROTATION_SHIFT, "Shift drag snaps to 15°")
        with saved(page):
            drag(page, ring, fine_px, 0)
            coarse_then_fine = GA_ROTATION_SHIFT + fine_px * GA_RING_DEG_PER_PX
            eventually(page, lambda: round(field_num(rx), 3) == coarse_then_fine, "plain drag moves 0.5° per px")
        select(page.get_by_role("combobox", name="Vertex"), "+x +y +z")
        world = _ga_world(GA_CUBE_CORNER, rot=(coarse_then_fine, 0, 0))
        readout_is(page, "vertex-world", vec(*world))
        readout_is(page, "vertex-point", _ga_screen(world))
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Slab"], "rotation.x") == coarse_then_fine


def test_wf_primitive_transform_fov_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    halo = cube("Halo cube", position={"x": 1, "y": 2, "z": 0}, rotation={"x": 0, "y": 45, "z": 0}, scale={"x": 2, "y": 1, "z": 1})
    p = import_project(app_url, seed, [scene("Main", [halo])], prefix="Frame")
    fov = GA_FOV - 5
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Halo cube")
        select(page.get_by_role("combobox", name="Vertex"), "+x +y +z")
        readout_is(page, "vertex-point", "892.86, 195.28 px", "(default camera)")
        select_layer(page, "Camera")
        field = spin(page, "Field of view")
        with saved(page):
            _ga_press(field, "ArrowDown", 5)
            eventually(page, lambda: round(field_num(field), 3) == fov, "ArrowDown steps Field of view by 1")
            assert focused(field), "focus stays on Field of view"
        select_layer(page, "Halo cube")
        select(page.get_by_role("combobox", name="Vertex"), "+x +y +z")
        corner = _ga_world(GA_CUBE_CORNER, (1, 2, 0), (0, 45, 0), (2, 1, 1))
        readout_is(page, "screen-point", _ga_screen((1, 2, 0), fov))
        readout_is(page, "vertex-point", _ga_screen(corner, fov))
        readout_is(page, "vertex-world", vec(*corner), "(the camera does not move the world point)")
    assert project(app_url, ines, p.id)["document"]["scenes"][0]["camera"]["fov"] == fov


def test_wf_extrusion_materials_refraction_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Slab", material={"kind": "Glass"})])], prefix="Glass")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Slab")
        readout_is(page, "ior", "IOR 1.250")
        field = spin(page, "Refraction strength")
        with saved(page):
            _ga_press(field, "ArrowUp", 2)
            up = 1 + 2 * GA_REFRACTION_STEP
            eventually(page, lambda: round(field_num(field), 3) == round(up, 3), "ArrowUp steps 0.05")
            readout_is(page, "ior", f"IOR {_ga_round(1 + 0.25 * up, 3)}")
            _ga_press(field, "ArrowDown", 6)
            down = up - 6 * GA_REFRACTION_STEP
            eventually(page, lambda: round(field_num(field), 3) == round(down, 3), "ArrowDown steps 0.05")
            readout_is(page, "ior", f"IOR {_ga_round(1 + 0.25 * down, 3)}")
            assert focused(field), "focus stays on Refraction strength"
    slab = layers_by_name(project(app_url, ines, p.id)["document"])["Slab"]
    assert round(prop(slab, "material.refraction"), 3) == round(down, 3)


def test_wf_extrusion_materials_both_sides_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Base", 0), layer("Probe", "Primitive", 1, {"primitive": "Cylinder"})])], prefix="Faces")
    tri = 128
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        readout_is(page, "triangles-drawn", f"Triangles drawn {tri}")
        eventually(page, lambda: _ga_draw_order(page) == ["Base · depth on", "Probe · depth on"], "front-only Draw order")
        faces = page.get_by_role("radiogroup", name="Faces")
        with saved(page):
            both = faces.get_by_role("radio", name="Both sides")
            both.focus()
            both.press("Space")
            eventually(page, lambda: both.is_checked(), "Both sides selected by keyboard")
        readout_is(page, "triangles-drawn", f"Triangles drawn {2 * tri}")
        readout_is(page, "triangles", f"Triangles {tri}")
        eventually(page, lambda: _ga_draw_order(page) == ["Base · depth on", "Probe · back faces", "Probe · front faces"],
                   "Both sides draws back faces first, then front faces")
        assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Probe"], "faces") == "both"
        with saved(page):
            front = faces.get_by_role("radio", name="Front only")
            front.focus()
            front.press("Space")
            eventually(page, lambda: front.is_checked(), "Front only selected by keyboard")
        readout_is(page, "triangles-drawn", f"Triangles drawn {tri}")
        eventually(page, lambda: _ga_draw_order(page) == ["Base · depth on", "Probe · depth on"], "single item again")
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Probe"], "faces") == "front"


def test_wf_extrusion_materials_upload_pending(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [])], prefix="Pending")
    name = "grain-plate.png"
    image = png(64, 64)
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        with held(page, "**/assets") as gate:
            click(page.get_by_role("button", name="Add layer"))
            with page.expect_file_chooser() as chooser:
                click(choose_menu_item(page, "Image"))
            chooser.value.set_files(files=[{"name": name, "mimeType": "image/png", "buffer": image}])
            editor_status(page, f"Uploading {name}…")
            assert not project(app_url, ines, p.id)["assets"], "no asset exists before storage confirms"
            assert not [l for l in layers_by_name(project(app_url, ines, p.id)["document"]).values() if l["kind"] == "Image"]
            gate.release()
        editor_status(page, f"{name} is ready.")
        eventually(page, lambda: shows(row(page, "Image")), "the Image layer row appears once the upload is confirmed")
    data = project(app_url, ines, p.id)
    asset = next(a for a in data["assets"] if a["fileName"] == name)
    assert asset["status"] == "confirmed" and asset["sha256"] == hashlib.sha256(image).hexdigest()
    got = expect_status(http("GET", app_url, f"/api/assets/{asset['id']}/original", ines), 200, "original download")
    assert got.content == image and got.headers["content-type"].startswith("image/png")
    assert S3().get(f"projects/{p.id}/assets/{asset['id']}/original") == image


def test_wf_gltf_clips_speed_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p, aid, _ = model_project(app_url, seed, "Speed")
    add_layer(app_url, ines, p, {"name": "Swing", "kind": "Model", "props": {"modelAssetId": aid, "clips": [
        {"name": "Turn", "play": True, "loop": False, "speed": 1, "offsetMs": 0},
        {"name": "Hop", "play": False, "loop": False, "speed": 1, "offsetMs": 0}]}})
    speed = 1 - 2 * GA_SPEED_STEP
    frame = 120
    c = frame / GA_FRAMES_PER_S * speed
    quat, trans = _ga_turn(c)
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Swing")
        field = spin(page, "Speed Turn")
        with saved(page):
            _ga_press(field, "ArrowDown", 2)
            eventually(page, lambda: round(field_num(field), 3) == speed, "ArrowDown steps Speed by 0.25")
        select(page.get_by_role("combobox", name="Node"), "Arm")
        seek(page, frame)
        readout_is(page, "node-quaternion", quat)
        readout_is(page, "node-translation", trans)
        readout_is(page, "node-euler", f"Euler {vec(0, 90 * c / 2, 0)}")
        eventually(page, lambda: text_of(_ga_clip_time(page, "Turn")) == f"Turn {r3(c)} s", "clip time Turn readout")
    model = layers_by_name(project(app_url, ines, p.id)["document"])["Swing"]
    assert next(cl for cl in prop(model, "clips") if cl["name"] == "Turn")["speed"] == speed


def test_wf_gltf_clips_step_loop_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p, aid, _ = model_project(app_url, seed, "Hop")
    offset_ms = 250
    add_layer(app_url, ines, p, {"name": "Swing", "kind": "Model", "props": {"modelAssetId": aid, "clips": [
        {"name": "Turn", "play": False, "loop": False, "speed": 1, "offsetMs": 0},
        {"name": "Hop", "play": False, "loop": False, "speed": 1, "offsetMs": offset_ms}]}})
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Swing")
        with saved(page):
            play = page.get_by_role("button", name="Play Hop")
            play.focus()
            play.press("Enter")
            eventually(page, lambda: shows(page.get_by_role("button", name="Pause Hop")), "Play Hop turns into Pause Hop")
            loop = page.get_by_role("switch", name="Loop Hop")
            loop.focus()
            loop.press("Space")
            eventually(page, lambda: loop.is_checked(), "Loop Hop on by keyboard")
        select(page.get_by_role("combobox", name="Node"), "Foot")
        for frame in (44, 46, 74, 76, 106):
            clip, trans = _ga_hop(frame, offset_ms / 1000, True)
            seek(page, frame)
            readout_is(page, "node-translation", trans, f"at frame {frame}")
            eventually(page, lambda: text_of(_ga_clip_time(page, "Hop")) == clip, f"{clip} at frame {frame}")
    hop = next(cl for cl in prop(layers_by_name(project(app_url, ines, p.id)["document"])["Swing"], "clips") if cl["name"] == "Hop")
    assert hop["play"] is True and hop["loop"] is True and hop["offsetMs"] == offset_ms


def test_wf_gltf_clips_outage_placeholder_phone(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p, aid, _ = model_project(app_url, seed, "Placeholder")
    add_layer(app_url, ines, p, {"name": "Swing", "kind": "Model", "props": {"modelAssetId": aid}})
    add_layer(app_url, ines, p, {"name": "Slab", "kind": "Primitive", "props": {"primitive": "Cube", "position": {"x": 1, "y": 2, "z": 0}}})
    expect_status(publish(app_url, ines, p.id), 201, "publish version 1")
    down = outage_url("APP_MINIO_DOWN_URL")
    with app_page(browser, down, f"/embed/{p.id}", viewport=(390, 844)) as page:
        region = page.get_by_role("region", name=f"{p.name}, version 1")
        eventually(page, lambda: shows(region), "outage embed renders version 1 from the row")
        assert region.get_attribute("data-version") == "1"
        eventually(page, lambda: page.get_by_role("img", name="Swing (storage unavailable)").count() == 1, "named placeholder for Swing")
        assert page.get_by_role("img", name="Slab (storage unavailable)").count() == 0, "a primitive needs no stored asset"
        eventually(page, lambda: (embed_values(page, "Slab")["position.x"], embed_values(page, "Slab")["position.y"]) == (1, 2),
                   "the primitive still resolves its values")
    with app_page(browser, app_url, f"/embed/{p.id}", viewport=(390, 844)) as page:
        eventually(page, lambda: shows(page.get_by_role("region", name=f"{p.name}, version 1")), "primary embed")
        eventually(page, lambda: embed_values(page, "Slab")["position.x"] == 1 and isinstance(embed_values(page, "Swing"), dict),
                   "primary embed lists both layers")
        assert page.get_by_role("img", name="Swing (storage unavailable)").count() == 0, "no placeholder while storage works"


def test_wf_particles_live_count_playhead(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Swarm", "Particles", 0, SWARM)])], prefix="Count")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Swarm")
        commit(page, "Particle number", 3)
        ph = page.get_by_role("slider", name="Playhead")
        ph.focus()
        steps = (("Home", 0), ("Shift+ArrowRight", 10), ("Shift+ArrowRight", 20), ("Shift+ArrowRight", 30), ("ArrowLeft", 29))
        for key, frame in steps:
            ph.press(key)
            _ga_playhead(page, frame)
            readout_is(page, "live-particles", f"Live particles {len(_ga_emit(SWARM, frame))}", f"at frame {frame}")
        assert ph.get_attribute("aria-valuetext") == time_readout(29)
        assert focused(ph), "focus stays on the Playhead"
        alive = _ga_emit(SWARM, 29)
        readout_is(page, "particle", particle_text(3, *alive[3]["p"]), "(burst particle 3 still alive)")
        ph.press("ArrowRight")
        _ga_playhead(page, 30)
        readout_is(page, "live-particles", "Live particles 15")
        readout_is(page, "particle", f"Particle 3 is not alive at {time_readout(30)}.")


def test_wf_particles_trail_points_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Drift", "Particles", 0, DRIFT)])], prefix="Trail")
    trail = DRIFT["trailLength"]
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Drift")
        commit(page, "Particle number", 1)
        ph = seek(page, 3)
        readout_is(page, "trail-points", f"Trail points {min(trail, 3 + 1)}")
        for _ in range(4):
            ph.press("ArrowRight")
        _ga_playhead(page, 7)
        readout_is(page, "trail-points", f"Trail points {min(trail, 7 + 1)}")
        pos = particle_text(1, *_ga_emit(DRIFT, 7)[1]["p"])
        readout_is(page, "particle", pos)
        field = spin(page, "Trail length")
        with saved(page):
            commit(page, "Trail length", trail - 3)
            eventually(page, lambda: round(field_num(field), 3) == trail - 3, "Trail length lowered")
        readout_is(page, "trail-points", f"Trail points {min(trail - 3, 7 + 1)}")
        readout_is(page, "particle", pos, "(trail never affects motion)")
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Drift"], "trailLength") == trail - 3


def test_wf_particles_formation_phone(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    word = layer("Wordmark", "Extrusion", 0, {**TEXT_PROPS, "text": "HALO", "bevelSize": 0.02})
    form = layer("Formation", "Particles", 1, {"mode": "form", "seed": 7, "formation": {"target": word["id"], "count": 32, "durationMs": 1500}})
    p = import_project(app_url, seed, [scene("Main", [word, form])], prefix="Phone form")
    assert _ga_formation(1, 90) == particle_text(1, -1.350, 0.500, 0.120), "reference rest point (L898)"
    assert _ga_formation(6, 90) == particle_text(6, -0.050, 0.500, 0.120), "reference rest point (L898)"
    with app_page(browser, app_url, f"/projects/{p.id}", ines, viewport=(390, 844)) as page:
        _ga_tap_tab(page, "Layers")
        wait_editor(page)
        target = row(page, "Formation")
        eventually(page, lambda: shows(target), "Formation row")
        tap(target.get_by_text(re.compile(r"^Formation$")).first)
        _ga_tap_tab(page, "Inspector")
        number = spin(page, "Particle number")
        eventually(page, lambda: shows(number), "Particle number field on the Inspector tab")
        tap(number)
        number.fill("2")
        number.press("Enter")
        for frame in (45, 90):
            _ga_tap_tab(page, "Timeline")
            seek(page, frame)
            _ga_tap_tab(page, "Inspector")
            readout_is(page, "particle", _ga_formation(2, frame), f"at frame {frame}")
            readout_is(page, "live-particles", "Live particles 32")


_GB_GLIDE = (0.22, 1, 0.36, 1)
_GB_ARTBOARD = (1440, 810)
_GB_FOV = 50
_GB_CAMERA_DISTANCE = 10


def _gb_r2(x: float) -> str:
    q = math.floor(abs(x) * 100 + 0.5) / 100
    v = q if x >= 0 else -q
    return "0.00" if v == 0 else f"{v:.2f}"


def _gb_glide(t: float) -> float:
    x1, y1, x2, y2 = _GB_GLIDE
    if t <= 0:
        return 0.0
    if t >= 1:
        return 1.0
    bx = lambda s: 3 * (1 - s) ** 2 * s * x1 + 3 * (1 - s) * s * s * x2 + s ** 3
    by = lambda s: 3 * (1 - s) ** 2 * s * y1 + 3 * (1 - s) * s * s * y2 + s ** 3
    lo, hi = 0.0, 1.0
    for _ in range(200):
        mid = (lo + hi) / 2
        lo, hi = (mid, hi) if bx(mid) < t else (lo, mid)
    return by((lo + hi) / 2)


def _gb_smoothed(target: float, start: float, momentum: float, frames: int) -> float:
    return target + (start - target) * (0.92 * momentum) ** frames


def _gb_screen_point(p: tuple[float, float, float], azimuth: float) -> str:
    w, h = _GB_ARTBOARD
    a = math.radians(azimuth)
    cam = (_GB_CAMERA_DISTANCE * math.sin(a), 0.0, _GB_CAMERA_DISTANCE * math.cos(a))
    fwd = [-c for c in cam]
    n = math.sqrt(sum(c * c for c in fwd))
    fwd = [c / n for c in fwd]
    side = [-fwd[2], 0.0, fwd[0]]
    n = math.sqrt(sum(c * c for c in side))
    side = [c / n for c in side]
    up = [side[1] * fwd[2] - side[2] * fwd[1], side[2] * fwd[0] - side[0] * fwd[2], side[0] * fwd[1] - side[1] * fwd[0]]
    d = [p[i] - cam[i] for i in range(3)]
    xc = sum(side[i] * d[i] for i in range(3))
    yc = sum(up[i] * d[i] for i in range(3))
    zc = -sum(fwd[i] * d[i] for i in range(3))
    f = 1 / math.tan(math.radians(_GB_FOV) / 2)
    ndc_x = (f / (w / h)) * xc / (-zc)
    ndc_y = f * yc / (-zc)
    return f"{_gb_r2((ndc_x + 1) / 2 * w)}, {_gb_r2((1 - ndc_y) / 2 * h)} px"


def _gb_frames(page: Page, track: Locator, others: dict[str, Locator], n: int, step_ms: float = 4) -> list[dict[str, str]]:
    snaps: list[dict[str, str]] = []
    last = text_of(track)
    for _ in range(int(n * FRAME_MS / step_ms) + 200):
        advance(page, step_ms)
        v = text_of(track)
        if v != last:
            snaps.append({"track": v, **{k: text_of(loc) for k, loc in others.items()}})
            last = v
        if len(snaps) >= n:
            return snaps
    pytest.fail(f"readout changed only {len(snaps)} times over {n} frames")


def _gb_probe(name: str = "Probe", **events: Any) -> dict:
    return layer(name, "Primitive", 0, {"primitive": "Sphere", "position": {"x": 1, "y": 2, "z": 0}}, events=events)


def test_wf_cloth_playhead_keyboard_points(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Banner", "Cloth", 0, BANNER)])], prefix="Cloth keys")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Banner")
        point = page.get_by_role("combobox", name="Cloth point")
        select(point, "R2 C4")
        ph = seek(page, 30)
        assert ph.get_attribute("aria-valuetext") == time_readout(30)
        readout_is(page, "cloth-point", cloth_text("R2 C4", 0.180, -0.097, -0.001), "(L915)")
        select(point, "R4 C1")
        ph.focus()
        for _ in range(3):
            ph.press("Shift+ArrowRight")
        eventually(page, lambda: field_num(ph) == 60, "Shift+ArrowRight moves ten frames each (L229)")
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.114, -0.300, 0.000), "at frame 60 (L914)")
        ph.press("Home")
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.150, -0.300, 0.000), "at frame 0 (L914)")
        assert focused(ph), "focus stays on the Playhead"


def test_wf_cloth_pinned_edge_editor(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Banner", "Cloth", 0, BANNER)])], prefix="Cloth pins")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Banner")
        edge = page.get_by_role("combobox", name="Pinned edge")
        with saved(page):
            select(edge, "Corners")
        select(page.get_by_role("combobox", name="Cloth point"), "R4 C1")
        ph = seek(page, 30)
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.031, -0.276, 0.001), "with Corners pinned (L916)")
        with saved(page):
            select(edge, "Left")
        rest = cloth_text("R4 C1", -0.150, -0.300, 0.000)
        readout_is(page, "cloth-point", rest, "pinned by Left at frame 30")
        ph.focus()
        for _ in range(3):
            ph.press("Shift+ArrowRight")
        eventually(page, lambda: field_num(ph) == 60, "Playhead at frame 60")
        readout_is(page, "cloth-point", rest, "pinned by Left at frame 60")
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Banner"], "pinned") == "Left"


def test_wf_cloth_reduce_motion_switch_click(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Banner", "Cloth", 0, BANNER), cube("Probe", 1, position={"x": 1, "y": 2, "z": 0})],
                                             orbit={"enabled": True, "startAngle": 0, "endAngle": 90})], prefix="Cloth still")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        page.get_by_role("slider", name="Scroll progress").focus()
        page.keyboard.press("Home")
        readout_is(page, "camera-azimuth", azimuth_text(0))
        readout_is(page, "screen-point", "806.85, 231.29 px", "(L750)")
        rm = page.get_by_role("switch", name="Reduce motion")
        click(rm)
        eventually(page, lambda: rm.is_checked(), "Reduce motion turns on by click")
        readout_is(page, "camera-azimuth", azimuth_text(90), "(the orbit shows its end angle, L983)")
        readout_is(page, "screen-point", "720.00, 211.99 px", "(L978)")
        select_layer(page, "Banner")
        select(page.get_by_role("combobox", name="Cloth point"), "R4 C1")
        seek(page, 60)
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.150, -0.300, 0.000), "(frame-0 state, L985)")
        click(rm)
        eventually(page, lambda: not rm.is_checked(), "Reduce motion turns off by click")
        readout_is(page, "cloth-point", cloth_text("R4 C1", -0.114, -0.300, 0.000), "(live frame 60, L914)")


def test_wf_tilt_orbit_keyboard_diagonal(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [_gb_probe(tilt={"enabled": True, "maxTilt": 12, "sensitivity": 1, "momentum": 1})])],
                       prefix="Tilt diag")
    n, m = -0.3, 0.2
    target_y, target_x = n * 1 * 12, -m * 1 * 12
    focus_x, focus_y = (n + 1) / 2, (m + 1) / 2
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        click(page.get_by_role("switch", name="Preview"))
        page.get_by_role("group", name="Stage").focus()
        for key in ("ArrowLeft", "ArrowLeft", "ArrowLeft", "ArrowDown", "ArrowDown"):
            page.keyboard.press(key)
        snaps = _gb_frames(page, readout(page, "tilt-y"), {"x": readout(page, "tilt-x"), "focus": readout(page, "light-focus")}, 30)
        for k in (1, 10, 30):
            assert snaps[k - 1]["track"] == f"Tilt Y {r3(_gb_smoothed(target_y, 0, 1, k))}", (k, snaps[k - 1])
        for k in (1, 30):
            assert snaps[k - 1]["x"] == f"Tilt X {r3(_gb_smoothed(target_x, 0, 1, k))}", (k, snaps[k - 1])
            assert snaps[k - 1]["focus"] == f"Light focus {vec(_gb_smoothed(focus_x, 0.8, 1, k), _gb_smoothed(focus_y, 0.9, 1, k))}", (k, snaps[k - 1])
        readout_is(page, "tilt-target", tilt_target_text(target_x, target_y))


def test_wf_tilt_orbit_leave_eases_back(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [_gb_probe(tilt={"enabled": True, "maxTilt": 24, "sensitivity": 0.5, "momentum": 1})])],
                       prefix="Tilt leave")
    m = -0.5
    target_x = -m * 0.5 * 24
    focus = (0.5, (m + 1) / 2)
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        click(page.get_by_role("switch", name="Preview"))
        page.get_by_role("group", name="Stage").focus()
        for _ in range(5):
            page.keyboard.press("ArrowUp")
        readout_is(page, "tilt-target", tilt_target_text(target_x, 0))
        advance(page, 10000)
        readout_is(page, "tilt-x", f"Tilt X {r3(target_x)}")
        readout_is(page, "tilt-y", f"Tilt Y {r3(0)}")
        readout_is(page, "light-focus", f"Light focus {vec(*focus)}")
        page.keyboard.press("Escape")
        shown = []
        for at_ms in (300, 600):
            advance(page, at_ms - (shown and 300 or 0))
            value = float(text_of(readout(page, "tilt-x")).split()[-1])
            low = target_x * (1 - _gb_glide(at_ms / LEAVE_MS))
            high = target_x * (1 - _gb_glide(max(0.0, at_ms - 2 * FRAME_MS) / LEAVE_MS))
            assert low - 0.0015 <= value <= high + 0.0015, (at_ms, value, low, high)
            shown.append(value)
        assert shown[0] > shown[1] > 0, "tilt eases back toward rest, not in one jump"
        advance(page, LEAVE_MS)
        readout_is(page, "tilt-x", f"Tilt X {r3(0)}")
        readout_is(page, "light-focus", f"Light focus {REST_FOCUS}")


def test_wf_tilt_orbit_scroll_slider_keys(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Probe", position={"x": 1, "y": 2, "z": 0})],
                                             orbit={"enabled": True, "startAngle": 0, "endAngle": 45})], prefix="Orbit keys")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Probe")
        slider = page.get_by_role("slider", name="Scroll progress")
        slider.focus()
        slider.press("Home")
        readout_is(page, "camera-azimuth", azimuth_text(0))
        readout_is(page, "screen-point", "806.85, 231.29 px", "(L750)")
        slider.press("End")
        readout_is(page, "camera-azimuth", azimuth_text(45))
        readout_is(page, "screen-point", "786.09, 218.08 px", "(L978)")
        for _ in range(50):
            slider.press("ArrowLeft")
        eventually(page, lambda: field_num(slider) == 50, "Scroll progress 50 by keyboard")
        azimuth = 0 + (45 - 0) * 0.5
        readout_is(page, "camera-azimuth", azimuth_text(azimuth))
        readout_is(page, "screen-point", _gb_screen_point((1, 2, 0), azimuth))
        assert focused(slider), "focus stays on Scroll progress"


def test_wf_keyframe_easing_arrow_frame_steps(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Turner")])], prefix="Frame steps")
    name = lambda frame: f"Position Y keyframe at {time_readout(frame)}"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Turner")
        spin(page, "Position Y").focus()
        ph = seek(page, 1)
        assert ph.get_attribute("aria-valuetext") == time_readout(1)
        readout_is(page, "time", time_readout(1))
        with saved(page):
            page.keyboard.press("k")
            editor_status(page, f"Keyframe added at {time_readout(1)}")
        kf = page.get_by_role("button", name=name(1))
        eventually(page, lambda: shows(kf), "keyframe button at frame 1")
        kf.focus()
        with saved(page):
            page.keyboard.press("ArrowLeft")
            at0 = page.get_by_role("button", name=name(0))
            eventually(page, lambda: shows(at0) and focused(at0), "ArrowLeft moves it one frame and keeps focus (L230, L202)")
        with saved(page):
            page.keyboard.press("Shift+ArrowRight")
            at10 = page.get_by_role("button", name=name(10))
            eventually(page, lambda: shows(at10) and focused(at10), "Shift+ArrowRight moves it ten frames and keeps focus")
    kfs = layers_by_name(project(app_url, ines, p.id)["document"])["Turner"]["keyframes"]
    assert [(k["property"], k["frame"], k["easing"]) for k in kfs] == [("position.y", 10, "linear")], kfs


def test_wf_keyframe_easing_drag_snaps_playhead(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    kfs = [{"property": "rotation.y", "frame": 30, "value": 0, "easing": "linear"},
           {"property": "rotation.y", "frame": 90, "value": 90, "easing": "linear"}]
    p = import_project(app_url, seed, [scene("Main", [{**cube("Turner"), "keyframes": kfs}])], prefix="Snap")
    name = lambda frame: f"Rotation Y keyframe at {time_readout(frame)}"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Turner")
        seek(page, 60)
        k30, k90 = page.get_by_role("button", name=name(30)), page.get_by_role("button", name=name(90))
        eventually(page, lambda: shows(k30) and shows(k90), "keyframe buttons at frames 30 and 90")
        b30, b90 = k30.bounding_box(), k90.bounding_box()
        x30, x90 = b30["x"] + b30["width"] / 2, b90["x"] + b90["width"] / 2
        playhead_x = (x30 + x90) / 2
        with saved(page):
            drag(page, k90, playhead_x + 3 - x90, 0)
            moved = page.get_by_role("button", name=name(60))
            eventually(page, lambda: shows(moved), "the dragged keyframe snaps onto the playhead")
        assert page.get_by_role("button", name=name(90)).count() == 0
    stored = layers_by_name(project(app_url, ines, p.id)["document"])["Turner"]["keyframes"]
    assert sorted(k["frame"] for k in stored) == [30, 60], stored


def test_wf_keyframe_easing_undo_redo_keys(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Undo keys")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Block")
        with saved(page):
            commit(page, "Position X", 2.5)
        with saved(page):
            commit(page, "Position Y", -1.5)
        page.get_by_role("group", name="Stage").focus()
        page.keyboard.press("Control+z")
        editor_status(page, "Undone")
        eventually(page, lambda: field_num(spin(page, "Position Y")) == 0 and field_num(spin(page, "Position X")) == 2.5,
                   "first undo reverts only Position Y")
        page.keyboard.press("Control+z")
        eventually(page, lambda: field_num(spin(page, "Position X")) == 0, "second undo reverts Position X")
        page.keyboard.press("Control+z")
        editor_status(page, "Nothing to undo")
        page.keyboard.press("Control+Shift+z")
        editor_status(page, "Redone")
        eventually(page, lambda: field_num(spin(page, "Position X")) == 2.5 and field_num(spin(page, "Position Y")) == 0,
                   "redo reapplies Position X only")
    block = layers_by_name(project(app_url, ines, p.id)["document"])["Block"]
    assert (prop(block, "position.x"), prop(block, "position.y")) == (2.5, 0), block["props"]


def test_wf_breakpoints_mobile_override_typed(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Halo", rotation={"x": 0, "y": 45, "z": 0})])], prefix="Bp mobile")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Halo")
        mobile = page.get_by_role("radio", name="Mobile")
        mobile.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: mobile.is_checked() and focused(mobile), "Mobile chosen by keyboard with focus kept")
        with saved(page):
            commit(page, "Rotation Y", 10)
        reset = page.get_by_role("button", name="Reset Rotation Y to inherited value")
        readout = property_readout(page, "Rotation Y")
        eventually(page, lambda: shows(reset) and text_of(readout) == f"Rotation Y {r3(10)}", "Mobile override with its reset marker")
        tablet = page.get_by_role("radio", name="Tablet")
        tablet.focus()
        page.keyboard.press("Space")
        eventually(page, lambda: tablet.is_checked(), "Tablet chosen by keyboard")
        eventually(page, lambda: field_num(spin(page, "Rotation Y")) == 45 and not shows(reset)
                   and text_of(readout) == f"Rotation Y {r3(45)} (from Desktop)", "Tablet does not inherit from Mobile")
    for bp, value, source in (("mobile", 10, "Mobile"), ("tablet", 45, "Desktop"), ("desktop", 45, "Desktop")):
        got = inspect(app_url, ines, p, layer=p.layers["Halo"], breakpoint=bp)
        assert (got["values"]["rotation.y"], got["sources"]["rotation.y"]) == (value, source), (bp, got["values"], got["sources"])


def test_wf_breakpoints_reset_mobile_by_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Halo", rotation={"x": 0, "y": 45, "z": 0})])], prefix="Bp reset")
    expect_status(set_layer(app_url, ines, p, "Halo", {"rotation.y": 30}, bp="tablet"), 200, "tablet override")
    expect_status(set_layer(app_url, ines, p, "Halo", {"rotation.y": 20}, bp="mobile"), 200, "mobile override")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Halo")
        mobile = page.get_by_role("radio", name="Mobile")
        click(mobile)
        eventually(page, lambda: mobile.is_checked(), "Mobile chosen")
        readout = property_readout(page, "Rotation Y")
        eventually(page, lambda: field_num(spin(page, "Rotation Y")) == 20 and text_of(readout) == f"Rotation Y {r3(20)}",
                   "Mobile override shows without a level suffix")
        reset = page.get_by_role("button", name="Reset Rotation Y to inherited value")
        reset.focus()
        with saved(page):
            page.keyboard.press("Enter")
        eventually(page, lambda: field_num(spin(page, "Rotation Y")) == 30 and text_of(readout) == "Rotation Y 30.000 (from Tablet)"
                   and not shows(reset), "Mobile inherits the Tablet override again (L555, L170)")
    for bp, value, source in (("mobile", 30, "Tablet"), ("tablet", 30, "Tablet"), ("desktop", 45, "Desktop")):
        got = inspect(app_url, ines, p, layer=p.layers["Halo"], breakpoint=bp)
        assert (got["values"]["rotation.y"], got["sources"]["rotation.y"]) == (value, source), (bp, got["values"], got["sources"])


def test_wf_breakpoints_embed_device_sizes(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Halo", position={"x": 1, "y": 2, "z": 0})])], prefix="Bp sizes")
    expect_status(set_layer(app_url, ines, p, "Halo", {"scale.x": 2}, bp="tablet"), 200, "tablet override")
    expect_status(set_layer(app_url, ines, p, "Halo", {"position.x": -1}, bp="mobile"), 200, "mobile override")
    expect_status(publish(app_url, ines, p.id), 201, "publish")
    cases = (((390, 844), -1, 2), ((834, 1112), 1, 2), ((1440, 810), 1, 1))
    for size, pos_x, scale_x in cases:
        with app_page(browser, app_url, f"/embed/{p.id}", viewport=size) as page:
            eventually(page, lambda: shows(page.get_by_role("region", name=f"{p.name}, version 1")), "embed")
            eventually(page, lambda: (embed_values(page, "Halo")["position.x"], embed_values(page, "Halo")["scale.x"]) == (pos_x, scale_x),
                       f"embed at {size} shows position.x {pos_x} and scale.x {scale_x}")


_GC_ROT_MAX = 360
_GC_BACK = "336699"
_GC_SOURCE = "CC8844"


def _gc_blend(back: str, src: str, mode: str, alpha: float) -> str:
    def b(cb: float, cs: float) -> float:
        if mode == "Normal":
            return cs
        if mode == "Multiply":
            return cb * cs
        if mode == "Screen":
            return cb + cs - cb * cs
        if mode == "Overlay":
            return 2 * cb * cs if cb <= 0.5 else 1 - 2 * (1 - cb) * (1 - cs)
        if mode == "Darken":
            return min(cb, cs)
        return max(cb, cs)
    out = []
    for i in (0, 2, 4):
        cb, cs = int(back[i:i + 2], 16) / 255, int(src[i:i + 2], 16) / 255
        out.append(int(math.floor((cb * (1 - alpha) + b(cb, cs) * alpha) * 255 + 0.5)))
    return rgb_hex(*out)


def _gc_var(page: Page, name: str) -> Locator:
    return page.get_by_role("spinbutton", name=f"{name} value").or_(page.get_by_role("textbox", name=f"{name} value")).first


def _gc_notice(page: Page, message: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=message).or_(page.get_by_text(message, exact=True)).first


def test_wf_variables_presets_name_refusals_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Spinner")])], prefix="Names")
    name = "glow"
    bad = "9lives"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        click(page.get_by_role("tab", name="Variables"))
        box = page.get_by_role("textbox", name="New variable name")
        add = page.get_by_role("button", name="Add variable")

        def attempt(text_in: str) -> None:
            box.fill("")
            box.press_sequentially(text_in)
            select(page.get_by_role("combobox", name="Variable type"), "Number")
            add.focus()
            add.press("Enter")

        with saved(page):
            attempt(name)
        eventually(page, lambda: shows(_gc_var(page, name)), f"{name} value field appears")
        attempt(name)
        eventually(page, lambda: shows(_gc_notice(page, f"A variable named {name} already exists.")), "duplicate name refused (L302)")
        attempt(bad)
        eventually(page, lambda: shows(_gc_notice(page, "Use a lowercase letter first, then lowercase letters, digits or _ (at most 32 characters).")),
                   "invalid name refused (L302, L1000)")
        assert _gc_var(page, bad).count() == 0, "a refused name makes no value field"
    names = [v["name"] for v in project(app_url, ines, p.id)["document"]["variables"]]
    assert names.count(name) == 1 and bad not in names, names


def test_wf_variables_presets_clamp_reaches_viewer(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Spinner")])], prefix="Clamp")
    var = "turn"
    start = 30
    typed = _GC_ROT_MAX + 40
    expect_status(ops(app_url, ines, p, [change("addVariable", variable={"name": var, "type": "Number", "value": start})]), 200, "add variable")
    expect_status(ops(app_url, ines, p, [change("bind", layerId=p.layers["Spinner"], property="rotation.y", variable=var)]), 200, "bind variable")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner, \
            app_page(browser, app_url, f"/projects/{p.id}", S(seed, TOMAS)) as viewer:
        wait_editor(owner)
        wait_editor(viewer)
        select_layer(viewer, "Spinner")
        rot = spin(viewer, "Rotation Y")
        eventually(viewer, lambda: field_num(rot) == start and shows(viewer.get_by_text(f"Bound to {var}")), "viewer sees the bound value")
        click(owner.get_by_role("tab", name="Variables"))
        value = _gc_var(owner, var)
        eventually(owner, lambda: shows(value), "variable value field")
        with saved(owner):
            value.fill(str(typed))
            value.press("Enter")
        live(viewer, lambda: field_num(rot) == _GC_ROT_MAX and shows(viewer.get_by_text(f"Clamped to {_GC_ROT_MAX}")),
             "viewer sees the clamped bound value")
        select_layer(owner, "Spinner")
        own_rot = spin(owner, "Rotation Y")
        eventually(owner, lambda: field_num(own_rot) == _GC_ROT_MAX and shows(owner.get_by_text(f"Bound to {var}")), "owner's bound field")
        expect(own_rot).not_to_be_editable()
    assert inspect(app_url, ines, p, layer=p.layers["Spinner"])["values"]["rotation.y"] == _GC_ROT_MAX
    stored = {v["name"]: v["value"] for v in project(app_url, ines, p.id)["document"]["variables"]}
    assert stored[var] == typed, "the Number keeps its own value; only the binding clamps"


def test_wf_variables_presets_editor_applies_by_keyboard(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Spinner")])], prefix="Dawn")
    s0, b0, s1, b1 = 10, 2, 50, 7
    expect_status(ops(app_url, ines, p, [change("addVariable", variable={"name": "spin", "type": "Number", "value": s0}),
                                         change("addVariable", variable={"name": "boost", "type": "Number", "value": b0})]), 200, "vars")
    invite_and_accept(app_url, seed, mail, p, MARA, "Editor")
    preset = "Dawn"
    tint = "#B7A4FF"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner:
        wait_editor(owner)
        click(owner.get_by_role("tab", name="Presets"))
        owner.get_by_role("textbox", name="Preset name").fill(preset)
        save = owner.get_by_role("button", name="Save preset")
        save.focus()
        with saved(owner):
            save.press("Enter")
        presets = project(app_url, ines, p.id)["document"]["presets"]
        assert [norm(x["values"]) for x in presets if x["name"] == preset] == [norm({"spin": s0, "boost": b0})], presets
        click(owner.get_by_role("tab", name="Variables"))
        spin_v, boost_v = _gc_var(owner, "spin"), _gc_var(owner, "boost")
        for field, value in ((spin_v, s1), (boost_v, b1)):
            eventually(owner, lambda: shows(field), "variable value field")
            with saved(owner):
                field.fill(str(value))
                field.press("Enter")
        expect_status(ops(app_url, ines, p, [change("addVariable", variable={"name": "tint", "type": "Colour", "value": tint})]), 200, "tint after save")
        with app_page(browser, app_url, f"/projects/{p.id}", S(seed, MARA)) as editor:
            wait_editor(editor)
            click(editor.get_by_role("tab", name="Presets"))
            apply = editor.get_by_role("button", name=f"Apply {preset}")
            eventually(editor, lambda: shows(apply), "the saved preset is listed for the editor")
            apply.focus()
            apply.press("Enter")
            editor_status(editor, f"Applied {preset}.")
            live(owner, lambda: field_num(spin_v) == s0 and field_num(boost_v) == b0, "preset reaches the owner")
            assert {v["name"]: v["value"] for v in project(app_url, ines, p.id)["document"]["variables"]}["tint"] == tint
            editor.keyboard.press("Control+z")
            editor_status(editor, "Undone")
            live(owner, lambda: field_num(spin_v) == s1 and field_num(boost_v) == b1, "one undo restores both values for the owner")


def test_wf_compositing_opacity_keys_resample(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    for mode, hexstr in BLEND.items():
        assert _gc_blend(_GC_BACK, _GC_SOURCE, mode, WASH["opacity"] / 100) == hexstr, f"formula reproduces the L697 worked example ({mode})"
    p = import_project(app_url, seed, [scene("Main", [layer("Wash", "Rectangle", 0, WASH, blendMode="Screen")], background="#336699")], prefix="Nudge")
    up, down = WASH["opacity"] + 10, WASH["opacity"] + 10 - 1
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Wash")
        commit(page, "Sample X", 10)
        commit(page, "Sample Y", 10)
        readout_is(page, "sample", sample_text(BLEND["Screen"]))
        opacity = spin(page, "Opacity")
        opacity.focus()
        opacity.press("Shift+ArrowUp")
        eventually(page, lambda: field_num(opacity) == up and focused(opacity), "Shift+ArrowUp steps Opacity by 10 (L571)")
        readout_is(page, "sample", sample_text(_gc_blend(_GC_BACK, _GC_SOURCE, "Screen", up / 100)))
        opacity.press("ArrowDown")
        eventually(page, lambda: field_num(opacity) == down and focused(opacity), "ArrowDown steps Opacity by 1 (L571)")
        readout_is(page, "sample", sample_text(_gc_blend(_GC_BACK, _GC_SOURCE, "Screen", down / 100)))
        select(page.get_by_role("combobox", name="Blend mode"), "Lighten")
        final = sample_text(_gc_blend(_GC_BACK, _GC_SOURCE, "Lighten", down / 100))
        readout_is(page, "sample", final)
        eventually(page, lambda: inspect(app_url, ines, p, sampleX=10, sampleY=10)["readouts"]["sample"] == final, "stored edit samples the same")
    wash = layers_by_name(project(app_url, ines, p.id)["document"])["Wash"]
    assert wash["blendMode"] == "Lighten" and prop(wash, "opacity") == down


def test_wf_compositing_mask_switch_keyboard_viewer(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    veil = {"x": 0, "y": 0, "width": 720, "height": 810, "fill": "#FFFFFF", "opacity": 50}
    p = import_project(app_url, seed, [scene("Main", [layer("Veil", "Rectangle", 0, veil), layer("Wash", "Rectangle", 1, WASH)],
                                             background="#336699")], prefix="Mask")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    a_veil, a_wash = veil["opacity"] / 100, WASH["opacity"] / 100
    drawn = sample_text(_gc_blend(_gc_blend(_GC_BACK, "FFFFFF", "Normal", a_veil), _GC_SOURCE, "Normal", a_wash))
    masked = sample_text(_gc_blend(_GC_BACK, _GC_SOURCE, "Normal", a_wash * a_veil))
    assert masked == sample_text("617080"), "formula reproduces the L698 mask worked example"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner, \
            app_page(browser, app_url, f"/projects/{p.id}", S(seed, TOMAS)) as viewer:
        for pg in (owner, viewer):
            wait_editor(pg)
            select_layer(pg, "Wash")
            commit(pg, "Sample X", 10)
            commit(pg, "Sample Y", 10)
            readout_is(pg, "sample", drawn, "(mask off: the veil is drawn)")
        select_layer(owner, "Veil")
        switch = owner.get_by_role("switch", name="Mask the layer above")
        eventually(owner, lambda: shows(switch) and not switch.is_checked(), "mask switch starts off")
        switch.focus()
        with saved(owner):
            switch.press("Space")
        eventually(owner, lambda: switch.is_checked(), "Space turns the mask on")
        readout_is(owner, "sample", masked, "(mask on)")
        live(viewer, lambda: text_of(readout(viewer, "sample")) == masked, "viewer's Sample follows the mask")
    assert layers_by_name(project(app_url, ines, p.id)["document"])["Veil"]["maskAbove"] is True


def test_wf_compositing_gradient_stop_keys(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    box = {"x": 0.5, "y": 0.5, "width": 1000, "height": 1000}
    two = [{"color": "#FF0000", "position": 0}, {"color": "#0000FF", "position": 100}]
    p = import_project(app_url, seed, [scene("Main", [layer("Ramp", "Gradient", 0, {**box, "gradient": {"type": "Linear", "angle": 0, "stops": two}})],
                                             background="#000000")], prefix="Stops")
    sx, sy = 250, 10
    t = ((sx + 0.5) - (box["x"] + box["width"] / 2)) / box["width"] + 0.5
    assert abs(t - 0.25) < 1e-9
    presses = 25
    end = 100 - presses
    frac = t / (end / 100)
    moved = sample_text(rgb_hex(int(math.floor(255 * (1 - frac) + 0.5)), 0, int(math.floor(255 * frac + 0.5))))
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        select_layer(page, "Ramp")
        commit(page, "Sample X", sx)
        commit(page, "Sample Y", sy)
        readout_is(page, "sample", sample_text(rgb_hex(191, 0, 64)), "(L712 worked example)")
        stops = page.get_by_role("list", name="Gradient stops").get_by_role("listitem")
        eventually(page, lambda: stops.count() == 2, "two stops listed")
        position = stops.nth(1).get_by_role("spinbutton")
        position.focus()
        for _ in range(presses):
            position.press("ArrowDown")
        eventually(page, lambda: field_num(position) == end and focused(position), "ArrowDown moves the stop by 1 each and keeps focus")
        readout_is(page, "sample", moved, "(stop moved)")
        eventually(page, lambda: [s["position"] for s in prop(layers_by_name(project(app_url, ines, p.id)["document"])["Ramp"], "gradient.stops")] == [0, end],
                   "stop position is saved")
    assert inspect(app_url, ines, p, sampleX=sx, sampleY=sy)["readouts"]["sample"] == moved


def test_wf_live_collab_lock_refusal_then_timeout(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines, mara = S(seed, INES), S(seed, MARA)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Hold")
    invite_and_accept(app_url, seed, mail, p, MARA, "Editor")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner, app_page(browser, app_url, f"/projects/{p.id}", mara) as editor:
        wait_editor(owner)
        wait_editor(editor)
        select_layer(editor, "Block")
        with saved(editor):
            commit(editor, "Position X", 1)
        eventually(owner, lambda: f"Held by {NAMES[MARA]}" in text_of(row(owner, "Block")), "owner sees who holds Block (L132)")
        select_layer(owner, "Block")
        field = spin(owner, "Position X")
        eventually(owner, lambda: shows(field), "owner's Position X field")
        if field.is_editable():
            commit(owner, "Position X", 2)
            eventually(owner, lambda: shows(_gc_notice(owner, f"{NAMES[MARA]} is editing this layer.")), "refusal names the holder (L300)")
        else:
            expect(field).not_to_be_editable()
        assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.x") == 1
        advance_server(app_url, (LOCK_TIMEOUT_S + 1) * 1000)
        owner.reload()
        wait_editor(owner)
        eventually(owner, lambda: shows(row(owner, "Block")) and "Held by" not in text_of(row(owner, "Block")), "the lock timed out on server time")
        select_layer(owner, "Block")
        after = 3
        with saved(owner):
            commit(owner, "Position X", after)
        eventually(editor, lambda: f"Held by {NAMES[INES]}" in text_of(row(editor, "Block")), "Mara now sees the owner holding Block")
    assert prop(layers_by_name(project(app_url, ines, p.id)["document"])["Block"], "position.x") == after


def test_wf_live_collab_presence_both_ways(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Here")
    invite_and_accept(app_url, seed, mail, p, TOMAS, "Viewer")
    tomas_here, ines_here = f"{NAMES[TOMAS]} is here", f"{NAMES[INES]} is here"
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as owner:
        wait_editor(owner)
        with app_page(browser, app_url, f"/projects/{p.id}", S(seed, TOMAS)) as viewer:
            wait_editor(viewer)
            eventually(owner, lambda: shows(owner.get_by_role("img", name=tomas_here)), "owner sees the viewer present")
            eventually(viewer, lambda: shows(viewer.get_by_role("img", name=ines_here)), "viewer sees the owner present")
            assert owner.get_by_role("img", name=ines_here).count() == 0, "presence lists only other people"
            assert viewer.get_by_role("img", name=tomas_here).count() == 0, "presence lists only other people"
        eventually(owner, lambda: owner.get_by_role("img", name=tomas_here).count() == 0, "the viewer's avatar leaves with the viewer")


def test_wf_publish_embed_keyboard_publish_swaps_embed(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Keypub")
    expect_status(publish(app_url, ines, p.id), 201, "v1")
    expect_status(set_layer(app_url, ines, p, "Block", {"position.x": 5}), 200, "working edit")
    with app_page(browser, app_url, f"/embed/{p.id}") as embed:
        first = embed.get_by_role("region", name=f"{p.name}, version 1")
        eventually(embed, lambda: shows(first) and first.get_attribute("data-version") == "1", "embed shows version 1")
        advance(embed, 50)
        eventually(embed, lambda: embed_values(embed, "Block")["position.x"] == 0, "the embed plays only the live version")
        with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
            wait_editor(page)
            button = page.get_by_role("button", name="Publish", exact=True)
            button.focus()
            button.press("Enter")
            editor_status(page, "Version 2 is live.")
            second = embed.get_by_role("region", name=f"{p.name}, version 2")
            live(embed, lambda: shows(second) and second.get_attribute("data-version") == "2" and embed_values(embed, "Block")["position.x"] == 5,
                 "embed swaps to version 2")
            assert embed.get_by_role("region", name=f"{p.name}, version 1").count() == 0, "only the latest live version shows"
    assert sorted(v["number"] for v in versions(app_url, ines, p.id)) == [1, 2]


def test_wf_publish_embed_republish_by_keyboard(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Rekey")
    expect_status(publish(app_url, ines, p.id), 201, "v1")
    expect_status(set_layer(app_url, ines, p, "Block", {"position.x": 5}), 200, "edit")
    expect_status(publish(app_url, ines, p.id), 201, "v2")
    with app_page(browser, app_url, f"/projects/{p.id}", ines) as page:
        wait_editor(page)
        opener = page.get_by_role("button", name="Versions")
        opener.focus()
        opener.press("Enter")
        dialog = page.get_by_role("dialog", name="Versions")
        again = dialog.get_by_role("button", name="Republish version 1")
        eventually(page, lambda: shows(dialog) and shows(again), "Versions dialog opened by keyboard")
        again.focus()
        with held(page, "**/versions") as gate:
            again.press("Enter")
            busy = page.get_by_role("button").filter(has_text="Publishing…").first
            eventually(page, lambda: shows(busy), "Publishing… while pending")
            expect(busy).to_be_disabled()
            gate.release()
        editor_status(page, "Version 3 is live.")
        items = dialog.get_by_role("list", name="Versions").get_by_role("listitem")
        eventually(page, lambda: items.filter(has_text=re.compile(r"^Version 3 · .* · Live")).count() == 1
                   and items.filter(has_text=re.compile(r"^Version 2 · .* · Superseded")).count() == 1, "version list after republish")
    vs = {v["number"]: v["status"] for v in versions(app_url, ines, p.id)}
    assert vs == {1: "superseded", 2: "superseded", 3: "live"}, vs
    e1 = json.loads(http("GET", app_url, f"/api/projects/{p.id}/versions/1/export", ines).content)
    e3 = json.loads(http("GET", app_url, f"/api/projects/{p.id}/versions/3/export", ines).content)
    assert norm(e3["scenes"]) == norm(e1["scenes"]), "republish stores version 1's scene"
    assert inspect(app_url, ines, p, layer=p.layers["Block"], version=3)["values"]["position.x"] == 0


D_PHONE = (390, 844)
D_FOCUS_RE = re.compile(r"^\d\.\d{3}, \d\.\d{3}$")


def _d_onscreen(page: Page, loc: Locator) -> bool:
    if not shows(loc):
        return False
    b = loc.first.bounding_box()
    vp = page.viewport_size
    return bool(b and vp and b["width"] > 0 and b["height"] > 0 and b["x"] < vp["width"] and b["x"] + b["width"] > 0
                and b["y"] < vp["height"] and b["y"] + b["height"] > 0)


def _d_focus(stage: Locator) -> tuple[float, float]:
    raw = stage.get_attribute("data-light-focus") or ""
    assert D_FOCUS_RE.match(raw), f"data-light-focus is '<x>, <y>' with 3 decimals (L119): {raw!r}"
    fx, fy = (float(v) for v in raw.split(","))
    return fx, fy


def _d_touch(cdp: Any, kind: str, x: float = 0, y: float = 0) -> None:
    points = [{"x": x, "y": y, "id": 1}] if kind != "touchEnd" else []
    cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": points})


def test_wf_phone_layers_import_tabs_move_up(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [layer("Base", "Rectangle", 0), layer("Glow", "Ellipse", 1),
                                                      layer("Spark", "Polygon", 2), layer("Caption", "Text", 3, {"text": "Ship it"})])],
                       prefix="Pocket")
    with app_page(browser, app_url, f"/projects/{p.id}", ines, viewport=D_PHONE) as page:
        tabs = page.get_by_role("tablist", name="Editor panels")
        stage_tab, layers_tab = tabs.get_by_role("tab", name="Stage"), tabs.get_by_role("tab", name="Layers")
        tree, stage = page.get_by_role("tree", name="Layers"), page.get_by_role("group", name="Stage", exact=True)
        eventually(page, lambda: shows(stage_tab) and shows(layers_tab), "Editor panels tabs on the phone (L107)")
        big_enough(stage_tab)
        tap(stage_tab)
        eventually(page, lambda: shows(tabs.get_by_role("tab", name="Stage", selected=True)) and _d_onscreen(page, stage)
                   and not _d_onscreen(page, tree), "tapping Stage shows the stage panel alone (L107, L235)")
        big_enough(layers_tab)
        tap(layers_tab)
        eventually(page, lambda: shows(tabs.get_by_role("tab", name="Layers", selected=True)) and _d_onscreen(page, tree)
                   and not _d_onscreen(page, stage), "tapping Layers shows the Layers panel alone (L107, L235)")
        bottom_up = ["Base", "Glow", "Spark", "Caption"]
        eventually(page, lambda: [row(page, n).get_attribute("data-order") for n in bottom_up] == [str(i) for i in range(len(bottom_up))],
                   "data-order counts from 0 at the bottom (L132)")
        opener = page.get_by_role("button", name="Actions for Base")
        big_enough(opener)
        tap(opener)
        entry = choose_menu_item(page, "Move up")
        big_enough(entry)
        with saved(page):
            tap(entry)
        bottom_up = ["Glow", "Base", "Spark", "Caption"]
        eventually(page, lambda: [row(page, n).get_attribute("data-order") for n in bottom_up] == [str(i) for i in range(len(bottom_up))],
                   "Move up lifts Base one place in stack order (L213, L215)")
        top_first = [page.get_by_role("treeitem", name="Camera, Camera")] + [row(page, n) for n in reversed(bottom_up)]
        ys = [loc.bounding_box()["y"] for loc in top_first]
        assert ys == sorted(ys) and len(set(ys)) == len(ys), f"rows list Camera, then the topmost layer first (L132): {ys}"
    stored = layers_by_name(project(app_url, ines, p.id)["document"])
    assert stored["Glow"]["order"] < stored["Base"]["order"] < stored["Spark"]["order"] < stored["Caption"]["order"], "stored stack order"


def test_wf_phone_layers_import_phone_refusal_then_import(browser: Browser, app_url: str, seed: dict) -> None:
    bad_name, good_name = fresh_name("Tilted"), fresh_name("Pocket")
    bad = json.dumps({"schemaVersion": 3, "name": bad_name, "scenes": [
        {"id": new_id("s"), "name": "Main", "camera": {"fov": 5}, "layers": []},
        {"id": new_id("s"), "name": "Main", "camera": {"fov": 500}, "layers": []}]}).encode()
    refusal = "Value out of range: scenes[0].camera.fov is 5 (allowed 10 to 120)."
    good = json.dumps({"schemaVersion": 3, "name": good_name, "scenes": [{"id": new_id("s"), "name": "Main", "layers": [
        {"id": new_id("l"), "name": "Base", "kind": "Rectangle"}]}]}).encode()
    with app_page(browser, app_url, "/projects", S(seed, INES), viewport=D_PHONE) as page:
        page.set_default_timeout(WAIT_S * 1000)
        opener = page.get_by_role("button", name="Import JSON")
        eventually(page, lambda: page.get_by_role("article").count() > 0 and shows(opener), "project cards and Import JSON on the phone")
        big_enough(opener)
        with page.expect_file_chooser() as chooser:
            tap(opener)
        chooser.value.set_files(files=[{"name": "tilted.json", "mimeType": "application/json", "buffer": bad}])
        eventually(page, lambda: any(refusal in a.inner_text() for a in page.get_by_role("alert").all()),
                   "first out-of-range value is reported in an alert (L1010, L1016)")
        with page.expect_file_chooser() as chooser:
            tap(opener)
        chooser.value.set_files(files=[{"name": "pocket.json", "mimeType": "application/json", "buffer": good}])
        card = page.get_by_role("article", name=f"{good_name} (imported)")
        eventually(page, lambda: shows(card), "valid import shows the '<name> (imported)' card (L1018, L129)")
        assert card.get_attribute("data-layer-count") == str(1) and card.get_attribute("data-live-version") == ""
        body = card.inner_text()
        assert "1 layer" in body and "Not published" in body and counts_text(0, 0) in body, f"card text (L129): {body!r}"
        assert page.get_by_role("article", name=f"{bad_name} (imported)").count() == 0, "the refused file created no project"


def test_wf_cross_cutting_invite_accept_in_browser(browser: Browser, app_url: str, seed: dict, mail: Mailpit) -> None:
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Joinery")
    guest = fresh_email("joiner")
    expect_status(http("POST", app_url, f"/api/projects/{p.id}/invites", S(seed, INES), json={"email": guest, "role": "Editor"}), 201, "invite")
    link = f"/invite/{token_from(mails(mail, to=guest, subject=f'Join {p.name} in Halation Studio')[0])}"
    gone = "This invite link has already been used or has expired."
    with app_page(browser, app_url, link) as page:
        eventually(page, lambda: shows(page.get_by_role("heading", name=f"Join {p.name} as Editor")), "invite page names project and role (L160)")
        page.get_by_role("textbox", name="Your name").fill("Joiner Guest")
        pw = page.get_by_role("textbox", name="Choose a password")
        pw.fill("short-pw")
        click(page.get_by_role("button", name="Accept invite"))
        eventually(page, lambda: text_of(page.get_by_role("alert")) == "Choose a password of at least 10 characters.", "short password alert (L308)")
        pw.fill("joiner-password-01")
        with held(page, "**/accept") as gate:
            click(page.get_by_role("button", name="Accept invite"))
            eventually(page, lambda: shows(page.get_by_role("button", name="Joining…")), "button reads Joining… (L308)")
            gate.release()
        eventually(page, lambda: page.url.split("?")[0].rstrip("/").endswith(f"/projects/{p.id}"), "accepting opens the project (L308, L492)")
        wait_editor(page)
        sess = next((c["value"] for c in page.context.cookies() if c["name"] == "hs_session"), None)
    assert sess, "accepting signs the new person in (L492)"
    assert project(app_url, sess, p.id)["project"]["role"] == "Editor"
    assert summary_of(app_url, S(seed, INES), p.id)["editorCount"] == 1
    with app_page(browser, app_url, link) as page:
        used = lambda: shows(page.get_by_text(gone, exact=True))
        heading = page.get_by_role("heading", name=f"Join {p.name} as Editor")
        accept = page.get_by_role("button", name="Accept invite")
        eventually(page, lambda: used() or (shows(heading) and shows(accept)), "used link page settles")
        if not used():
            page.get_by_role("textbox", name="Your name").fill("Second Try")
            page.get_by_role("textbox", name="Choose a password").fill("second-password-01")
            click(accept)
        eventually(page, used, "a used invite link shows the used-link text (L308, L490)")
        assert not any(c["name"] == "hs_session" for c in page.context.cookies()), "a used link signs nobody in"
    assert summary_of(app_url, S(seed, INES), p.id)["editorCount"] == 1, "the used link added no member"


def test_wf_cross_cutting_unseen_in_browser(browser: Browser, app_url: str, seed: dict) -> None:
    ines = S(seed, INES)
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Shelf")
    expect_status(publish(app_url, ines, p.id), 201, "publish v1")
    quarry = seed["projects"]["Quarry teaser"]["id"]
    with app_page(browser, app_url, f"/embed/{p.id}") as page:
        eventually(page, lambda: shows(page.get_by_role("region", name=f"{p.name}, version 1")), "embed shows version 1 (L161)")
        expect_status(http("DELETE", app_url, f"/api/projects/{p.id}", ines), 200, "trash")
        resp = page.reload()
        assert resp is not None and resp.status == 404, "trashed project's embed answers 404 (L449, L486)"
        eventually(page, lambda: shows(page.get_by_text("This scene is not published.")), "not-published page text (L316)")
        resp = page.goto(f"{app_url}/embed/{quarry}")
        assert resp is not None and resp.status == 404, "another workspace's unpublished embed answers 404"
        eventually(page, lambda: shows(page.get_by_text("This scene is not published.")), "not-published page text")
    with app_page(browser, app_url, "/projects", ines) as page:
        seen: list[int] = []
        page.on("response", lambda r: seen.append(r.status) if quarry in r.url else None)
        page.goto(f"{app_url}/projects/{quarry}")
        eventually(page, lambda: 404 in seen, "another workspace's project answers 404 in the browser (L486)")
        advance(page, SETTLE_MS)
        assert 403 not in seen, f"never 403 (L32): {seen}"
        assert not shows(row(page, "Slab")), "nothing of Quarry teaser is shown to Ines"


def test_wf_cross_cutting_nudges_save_once(browser: Browser, app_url: str, seed: dict) -> None:
    p = import_project(app_url, seed, [scene("Main", [cube("Block")])], prefix="Nudge")
    step = 0.1
    with app_page(browser, app_url, f"/projects/{p.id}", S(seed, INES)) as page:
        wait_editor(page)
        select_layer(page, "Block")
        field = spin(page, "Position X")
        field.focus()
        op_ids: list[str] = []
        page.on("request", lambda req: op_ids.append(json.loads(req.post_data or "{}").get("opId", ""))
                if req.method == "POST" and req.url.split("?")[0].endswith("/ops") else None)
        with held(page, "**/ops") as gate:
            for _ in range(3):
                field.press("ArrowUp")
            assert focused(field), "focus stays on the nudged field (L202)"
            advance(page, AUTOSAVE_MS)
            eventually(page, lambda: page.evaluate("1") == 1 and len(op_ids) >= 1, "the step is sent within AUTOSAVE_MS (L531)", step_ms=0)
            eventually(page, lambda: text_of(page.get_by_role("status", name="Save status")) == "Saving…", "Saving… while pending (L294)", step_ms=0)
            gate.release()
        eventually(page, lambda: text_of(page.get_by_role("status", name="Save status")) == "All changes saved", "All changes saved (L294)")
        advance(page, AUTOSAVE_MS * 2)
        assert len(set(op_ids)) == 1, f"nudges less than AUTOSAVE_MS apart merge into one step (L530): {op_ids}"
        stored = prop(layers_by_name(project(app_url, S(seed, INES), p.id)["document"])["Block"], "position.x")
        assert round(stored, 3) == round(3 * step, 3), f"stored position.x {stored}"
        page.reload()
        wait_editor(page)
        select_layer(page, "Block")
        eventually(page, lambda: round(field_num(spin(page, "Position X")), 3) == round(3 * step, 3), "Position X after reload (L36)")


def test_wf_cross_cutting_queued_invite_row(browser: Browser, app_url: str) -> None:
    down = outage_url("APP_MAILPIT_DOWN_URL")
    expect_status(grading(down, "/api/grading/reset"), 200, "reset mail-down copy")
    md = expect_status(grading(down, "/api/grading/seed"), 201, "seed mail-down copy").json()
    p = import_project(down, md, [scene("Main", [cube("Block")])], prefix="Outbox")
    guest = fresh_email("waiting")
    with app_page(browser, down, f"/projects/{p.id}", S(md, INES)) as page:
        wait_editor(page)
        click(page.get_by_role("button", name="Members"))
        members = page.get_by_role("dialog", name="Members")
        eventually(page, lambda: shows(members), "Members dialog (L156)")
        click(members.get_by_role("button", name="Invite people"))
        invite = page.get_by_role("dialog", name="Invite people")
        eventually(page, lambda: shows(invite), "Invite people dialog (L157)")
        invite.get_by_role("textbox", name="Email").fill(guest)
        invite.get_by_role("radiogroup", name="Role").get_by_role("radio", name="Editor").check()
        click(invite.get_by_role("button", name="Send invite"))
        eventually(page, lambda: text_of(page.get_by_role("status", name="Members status")) == f"Invite sent to {guest}.",
                   "invite still succeeds during the mail outage (L307)")
        queued_row = page.get_by_role("list", name="Members").get_by_role("listitem").filter(
            has_text=f"{guest} · Editor · Invite queued — mail is unavailable")
        eventually(page, lambda: shows(queued_row), "the invite row shows the queued copy (L156, L1064)")
    invites = http("GET", down, f"/api/projects/{p.id}/members", S(md, INES)).json()["invites"]
    assert [i["status"] for i in invites if i["email"] == guest] == ["queued"], "the mail waits in the outbox"


def test_wf_cross_cutting_landing_touch_light(browser: Browser, app_url: str) -> None:
    with app_page(browser, app_url, "/", viewport=D_PHONE) as page:
        stage = page.get_by_role("region", name="Follow Light stage")
        eventually(page, lambda: shows(stage), "Follow Light stage visible", step_ms=0)
        advance(page, LIGHT_RISE_MS + SETTLE_MS)
        assert stage.get_attribute("data-light-focus") == REST_FOCUS, "focus rests at (0.800, 0.900) before input (L967)"
        box = stage.bounding_box()
        x, y = box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.15
        assert stage.evaluate("(e, p) => e.contains(document.elementFromPoint(p.x, p.y))", {"x": x, "y": y}), "touch point is over the stage"
        cdp = page.context.new_cdp_session(page)
        _d_touch(cdp, "touchStart", x, y)
        samples = []
        for _ in range(6):
            advance(page, 100)
            samples.append(_d_focus(stage))
        _d_touch(cdp, "touchEnd")
        xs, ys = [s[0] for s in samples], [s[1] for s in samples]
        assert xs[-1] < 0.8 and ys[-1] < 0.9, f"the light focus leans toward the touch (L271, L967): {samples}"
        assert xs == sorted(xs, reverse=True) and ys == sorted(ys, reverse=True), f"per-frame smoothing approaches without overshoot (L959): {samples}"
        assert min(xs) >= 0 and min(ys) >= 0, f"focus stays between rest and the touch target: {samples}"
    with app_page(browser, app_url, "/", viewport=D_PHONE, reduced_motion="reduce") as page:
        stage = page.get_by_role("region", name="Follow Light stage")
        eventually(page, lambda: shows(stage), "Follow Light stage visible", step_ms=0)
        advance(page, LIGHT_RISE_MS + SETTLE_MS)
        box = stage.bounding_box()
        x, y = box["x"] + box["width"] * 0.1, box["y"] + box["height"] * 0.15
        cdp = page.context.new_cdp_session(page)
        _d_touch(cdp, "touchStart", x, y)
        advance(page, 600)
        assert stage.get_attribute("data-light-focus") == REST_FOCUS, "reduced motion: the light does not follow a touch (L285, L986)"
        _d_touch(cdp, "touchEnd")
