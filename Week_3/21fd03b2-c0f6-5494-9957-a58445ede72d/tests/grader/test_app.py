from __future__ import annotations

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
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Page, expect

from conftest import (
    DEPLOYED_APP,
    Postgres,
    S3,
    addresses,
    advance,
    camera,
    capture,
    changed,
    check,
    click,
    decode,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    state_styles,
    tab_order,
    tap,
    text,
    unique,
)


HTTP_TIMEOUT = 60
UI_S = 20
POLL_MS = 250
MAX_POLLS = 100000
PASSWORD = "bench-password-1"
LIVE_S = 2
PRESENCE_S = 2
READONLY_LIVE_S = 5
DEMOTION_S = 5
TAB_RELEASE_S = 5
LINK_DEAD_S = 5
LOCK_RECOVERY_S = 10
STATUS_FRESH_S = 5
BANNER_S = 5
MAIL_QUEUE_S = 30
MAIL_RETRY_S = 10
MAIL_WAIT_S = 30
BOOT_S = 30
SAVE_S = 10
LOCK_TTL_DEFAULT = 30
INVITE_TTL_DEFAULT = 604800
SHARE_TTL_DEFAULT = 2592000
SHORT_LOCK_TTL = 6
SHORT_LINK_TTL = 8
SHORT_INVITE_TTL = 8
CLOCK_SKEW_S = 2
STEP_HZ = 120
MAX_STEPS = 12000
ONE_FRAME_MS = 17
ACTIVITY_PAGE = 50
ACTIVITY_MAX_LIMIT = 100
UPLOAD_LIMIT = 10_000_000
JSON_LIMIT = 1_000_000
NAME_MAX = 60
FILE_NAME_MAX = 120
PASSWORD_MAX = 128
EXPOSED_MAX = 8
SCROLL_STORY_PX = 3000
SECTION_PX = 1000
TOOLBAR_FULL_PX = 2700
TOUCH_MIN_PX = 44
DESKTOP_MIN_PX = 24
STAGE_SHARE = 0.4
DOCK_COLUMN_SHARE = 0.5
GRAVITY = 9.81
NUDGE = 0.1
FINE_NUDGE = 0.01
SNAP_STEP = 0.25
ROTATE_DEG = 5
MILLIONTH = 1e-6
CAMERA_EPS = 1e-4
GL_FLOAT = 5126
REMOVED_KEY = "crate-x.name"
RELAY_CHUNK = 65536
RELAY_MAX_CONNECTIONS = 100000
RELAY_MAX_CHUNKS = 10**9
SIGNUP_RACE = 8
LOCK_RACE = 8
PATCH_RACE = 6
INVITE_RACE = 5
ABANDONED_STREAMS = 10
INTRUDER = "Intruder project"
NAME_TOO_LONG = "n" * (NAME_MAX + 1)

RAMP_DEFAULTS = {"mass_kg": 1, "angle_deg": 30, "length_m": 3, "friction": 0}
PENDULUM_DEFAULTS = {"mass_kg": 0.5, "length_m": 1, "release_deg": 20}
LAUNCHER_DEFAULTS = {"mass_kg": 0.2, "speed_mps": 5, "launch_angle_deg": 45, "height_m": 1}
TEMPLATES = {
    "blank": [],
    "ramp": [("ramp-1", "Ramp 1", "ramp", RAMP_DEFAULTS)],
    "pendulum": [("pendulum-1", "Pendulum 1", "pendulum", PENDULUM_DEFAULTS)],
    "launcher": [("launcher-1", "Launcher 1", "launcher", LAUNCHER_DEFAULTS)],
}
SOLVER = {"iterations": 4, "step": "1/120"}
UNIT_FACTORS = {"m": 1, "cm": 0.01, "mm": 0.001, "in": 0.0254, "ft": 0.3048}
EXPOSED = ["ramp-1.mass_kg", "ramp-1.angle_deg"]
TIMESTAMP = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$")
HEX64 = re.compile(r"^[0-9a-f]{64}$")

TYPE_COPY = "Upload a GLB, glTF, PNG or JPEG file."
DAMAGED_COPY = "This model file is damaged or is not glTF 2.0."
EXTERNAL_COPY = "Models must be self-contained: embed every buffer and texture."
NAME_COPY = 'Use a file name of 1 to 120 characters without slashes, backslashes or "..".'
UNIT_COPY = "Choose m, cm, mm, in or ft."
EXTENT_COPY = "After converting to metres the model must measure from 0.01 m to 100 m across."
TOO_LARGE_COPY = "Files must be 10,000,000 bytes or smaller."
NAMES_COPY = "Names need 1 to 60 characters."

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
SVG = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'

UPLOAD_CASES = {
    "glb": ("cube.glb", "glb", 201, "glb"),
    "gltf": ("cube.gltf", "gltf", 201, "gltf"),
    "png": ("tile.png", "png", 201, "png"),
    "jpeg": ("photo.jpg", "jpeg", 201, "jpeg"),
    "png-named-glb": ("tile.glb", "png", 201, "png"),
    "svg": ("diagram.svg", "svg", 422, TYPE_COPY),
    "svg-named-png": ("diagram.png", "svg", 422, TYPE_COPY),
    "plain-text-named-gltf": ("notes.gltf", "text", 422, TYPE_COPY),
    "gltf-no-scene": ("noscene.gltf", "gltf-no-scene", 422, DAMAGED_COPY),
    "gltf-no-bounds": ("nobounds.gltf", "gltf-no-minmax", 422, DAMAGED_COPY),
    "at-limit": ("limit.png", "png-limit", 201, "png"),
    "over-limit": ("huge.png", "png-over", 413, TOO_LARGE_COPY),
}

UPLOAD_IDS = ["glb", "gltf", "png", "jpeg", "png-named-glb", "svg", "svg-named-png", "plain-text-named-gltf", "gltf-no-scene", "gltf-no-bounds", "at-limit", "over-limit"]
REF_IDS = ["external-buffer", "external-image", "glb-external-image", "slash", "backslash", "two-dots", "control-character", "too-long"]
EXTENT_IDS = ["brief-example", "centimetres", "millimetres", "inches", "feet", "matrix-node", "named-scene", "glb-centimetres", "lower-limit", "too-small", "too-large", "unknown-unit"]

REF_CASES = {
    "external-buffer": ("cube.gltf", "gltf-external-buffer", "file", EXTERNAL_COPY),
    "external-image": ("cube.gltf", "gltf-external-image", "file", EXTERNAL_COPY),
    "glb-external-image": ("cube.glb", "glb-external-image", "file", EXTERNAL_COPY),
    "slash": ("models/cube.glb", "glb", "name", NAME_COPY),
    "backslash": ("models\\cube.glb", "glb", "name", NAME_COPY),
    "two-dots": ("cube..glb", "glb", "name", NAME_COPY),
    "control-character": ("cube\x07.glb", "glb", "name", NAME_COPY),
    "too-long": ("n" * (FILE_NAME_MAX - 3) + ".glb", "glb", "name", NAME_COPY),
}

Q45 = [0.0, math.sin(math.pi / 8), 0.0, math.cos(math.pi / 8)]
EXTENT_CASES = {
    "brief-example": {"half": 0.5, "unit": "m", "nodes": [{"scale": [0.5, 0.5, 0.5], "children": [1]}, {"mesh": 0, "rotation": Q45}], "metres": 0.707107},
    "centimetres": {"half": 25, "unit": "cm", "span": 50},
    "millimetres": {"half": 100, "unit": "mm", "span": 200},
    "inches": {"half": 5, "unit": "in", "span": 10},
    "feet": {"half": 1, "unit": "ft", "span": 2},
    "matrix-node": {"half": 0.5, "unit": "m", "nodes": [{"mesh": 0, "matrix": [2, 0, 0, 0, 0, 3, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]}], "span": 3},
    "named-scene": {"half": 0.5, "unit": "m", "nodes": [{"mesh": 0}, {"mesh": 0, "scale": [4, 4, 4]}], "scenes": [{"nodes": [0]}, {"nodes": [1]}], "scene": 1, "span": 4},
    "glb-centimetres": {"half": 25, "unit": "cm", "span": 50, "glb": True},
    "lower-limit": {"half": 0.5, "unit": "cm", "span": 1},
    "too-small": {"half": 0.2, "unit": "cm", "error": ("file", EXTENT_COPY)},
    "too-large": {"half": 60, "unit": "m", "error": ("file", EXTENT_COPY)},
    "unknown-unit": {"half": 0.5, "unit": "yd", "error": ("unit", UNIT_COPY)},
}

VIEWPORTS = {
    "1440x900": (1440, 900),
    "1280x800": (1280, 800),
    "1024x768": (1024, 768),
    "768x1024": (768, 1024),
    "390x844": (390, 844),
    "375x812": (375, 812),
}
LAB_DEATHS = ["unknown", "regenerated", "unpublished"]
LINK_DEATHS = ["revoked", "regenerated", "expired"]
LANDING_MODES = ["reduced-motion", "no-webgl"]


def ident(prefix: str) -> tuple[str, str]:
    first, second = unique(prefix)
    if "@" in first:
        email, name = first, second
    elif "@" in second:
        email, name = second, first
    else:
        email = re.sub(r"[^a-z0-9.-]", "-", first.lower()) + "@rampwright-tests.example"
        name = first
    return email.strip(), (name.strip() or prefix)[:NAME_MAX]


def tag() -> str:
    return uuid.uuid4().hex[:8]


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def canonical(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode()


def stamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def server_date(resp: httpx.Response) -> datetime | None:
    raw = resp.headers.get("date")
    return parsedate_to_datetime(raw) if raw else None


class Api:
    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT)
        self.email = ""
        self.name = ""
        self.password = PASSWORD
        self.user: dict[str, Any] = {}

    @property
    def uid(self) -> str:
        return str(self.user["id"])

    def call(self, method: str, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        if body is not None:
            kw["json"] = body
        return self.http.request(method, path, **kw)

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, {} if body is None else body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)


def ok(resp: httpx.Response, status: int) -> Any:
    assert resp.status_code == status, (
        f"{resp.request.method} {resp.request.url.path} answered {resp.status_code}: {resp.text[:500]}; expected {status}")
    if not resp.content:
        return {}
    try:
        return resp.json()
    except ValueError:
        return {}


def err(resp: httpx.Response, status: int, code: str) -> dict[str, Any]:
    assert resp.status_code == status, (
        f"{resp.request.method} {resp.request.url.path} answered {resp.status_code}: {resp.text[:500]}; expected {status} {code}")
    body = resp.json()
    assert set(body) == {"error"}, f"error body must be the one error shape (L713): {body}"
    assert body["error"]["code"] == code, f"error code {body['error'].get('code')}; expected {code}"
    assert isinstance(body["error"].get("message"), str) and body["error"]["message"], "error.message is a sentence"
    return body["error"]


def sign_up(base: str, prefix: str = "tutor", email: str | None = None, name: str | None = None) -> Api:
    address, display = ident(prefix)
    api = Api(base)
    api.email, api.name = email or address, name or display
    body = ok(api.post("/api/auth/sign-up", {"displayName": api.name, "email": api.email, "password": PASSWORD}), 201)
    api.user = body["user"]
    return api


def sign_in(base: str, email: str, password: str = PASSWORD) -> Api:
    api = Api(base)
    body = ok(api.post("/api/auth/sign-in", {"email": email, "password": password}), 200)
    api.user, api.email, api.password, api.name = body["user"], email, password, body["user"]["displayName"]
    return api


def landing_for(base: str, email: str, password: str = PASSWORD, **extra: Any) -> str:
    return str(ok(Api(base).post("/api/auth/sign-in", {"email": email, "password": password, **extra}), 200)["landing"])


def new_workspace(api: Api, name: str | None = None) -> tuple[str, str]:
    name = name or f"Bench {tag()}"
    return ok(api.post("/api/workspaces", {"name": name}), 201)["workspace"]["id"], name


def new_project(api: Api, wid: str, name: str | None = None) -> str:
    return ok(api.post(f"/api/workspaces/{wid}/projects", {"name": name or f"Forces {tag()}"}), 201)["project"]["id"]


def new_scene(api: Api, pid: str, template: str = "ramp", name: str | None = None) -> str:
    body = {"name": name or f"Slope trial {tag()}", "template": template}
    return ok(api.post(f"/api/projects/{pid}/scenes", body), 201)["scene"]["id"]


class Bench:

    def __init__(self, base: str, template: str = "ramp") -> None:
        self.base = base
        self.owner = sign_up(base, "owner")
        self.wid, self.ws_name = new_workspace(self.owner)
        self.project_name = f"Forces {tag()}"
        self.pid = new_project(self.owner, self.wid, self.project_name)
        self.scene_name = f"Slope trial {tag()}"
        self.sid = new_scene(self.owner, self.pid, template, self.scene_name)


def document(api: Api, sid: str) -> tuple[bytes, int]:
    resp = api.get(f"/api/scenes/{sid}/document")
    ok(resp, 200)
    return resp.content, int(resp.headers["X-Revision"])


def doc(api: Api, sid: str) -> dict[str, Any]:
    return json.loads(document(api, sid)[0])


def obj(document_: dict[str, Any], oid: str) -> dict[str, Any] | None:
    return next((o for o in document_["objects"] if o["id"] == oid), None)


def named(document_: dict[str, Any], name: str) -> dict[str, Any] | None:
    return next((o for o in document_["objects"] if o["name"] == name), None)


def patch(api: Api, sid: str, ops: list[dict[str, Any]], base: int | None = None, change: str | None = None) -> httpx.Response:
    if base is None:
        base = document(api, sid)[1]
    body = {"baseRevision": base, "changeId": change or str(uuid.uuid4()), "ops": ops}
    return api.call("PATCH", f"/api/scenes/{sid}", body)


def set_op(oid: str, fence_: int, field: str, value: Any) -> dict[str, Any]:
    return {"op": "set", "objectId": oid, "fence": fence_, "field": field, "value": value}


def scene_op(field: str, value: Any) -> dict[str, Any]:
    return {"op": "scene", "field": field, "value": value}


def crate(oid: str, name: str, position: list[float], mass: float = 1, scale: list[float] | None = None) -> dict[str, Any]:
    return {"assetId": None, "id": oid, "kind": "crate", "name": name, "params": {"mass_kg": mass},
            "position": position, "rotation": [0, 0, 0, 1], "scale": scale or [1, 1, 1]}


def lock(api: Api, sid: str, oid: str, tab: str | None = None) -> httpx.Response:
    return api.post(f"/api/scenes/{sid}/locks/{oid}", {"tab": tab} if tab else {})


def fence(api: Api, sid: str, oid: str, tab: str | None = None) -> int:
    return int(ok(lock(api, sid, oid, tab), 200)["lock"]["fence"])


def unlock(api: Api, sid: str, oid: str) -> None:
    ok(api.delete(f"/api/scenes/{sid}/locks/{oid}"), 204)


def set_field(api: Api, sid: str, oid: str, field: str, value: Any) -> None:
    held_fence = fence(api, sid, oid)
    ok(patch(api, sid, [set_op(oid, held_fence, field, value)]), 200)
    unlock(api, sid, oid)


def set_gravity(api: Api, sid: str, value: float) -> int:
    return int(ok(patch(api, sid, [scene_op("gravity", value)]), 200)["revision"])


def locks(api: Api, sid: str) -> list[dict[str, Any]]:
    return ok(api.get(f"/api/scenes/{sid}/presence"), 200)["locks"]


def verify(api: Api, sid: str, steps: int, params: dict[str, float] | None = None, path: str | None = None) -> str:
    body: dict[str, Any] = {"steps": steps}
    if params:
        body["params"] = params
    answer = ok(api.post(path or f"/api/scenes/{sid}/verify", body), 200)
    assert answer["step"] == steps and HEX64.match(answer["stateHash"]), f"verify answered {answer}"
    return str(answer["stateHash"])


def checkpoint(api: Api, sid: str, label: str) -> dict[str, Any]:
    return ok(api.post(f"/api/scenes/{sid}/checkpoints", {"label": label}), 201)["checkpoint"]


def publish(api: Api, sid: str, checkpoint_id: str, exposed: list[str]) -> dict[str, Any]:
    return ok(api.post(f"/api/scenes/{sid}/publish", {"checkpointId": checkpoint_id, "exposed": exposed}), 201)


def published_lab(base: str) -> tuple[Bench, dict[str, Any], dict[str, Any]]:
    b = Bench(base)
    cp = checkpoint(b.owner, b.sid, "Before class")
    return b, cp, publish(b.owner, b.sid, cp["id"], EXPOSED)["lab"]


def events(api: Api, wid: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    before: str | None = None
    for _ in range(MAX_POLLS):
        params: dict[str, Any] = {"limit": ACTIVITY_MAX_LIMIT}
        if before:
            params["before"] = before
        body = ok(api.get(f"/api/workspaces/{wid}/activity", params=params), 200)
        out += body["events"]
        before = body["nextBefore"]
        if before is None:
            return out
    pytest.fail("GET /api/workspaces/<wid>/activity never answered nextBefore null")


def upload(api: Api, pid: str, data: bytes, name: str, unit: str | None = None) -> httpx.Response:
    params = {"name": name}
    if unit:
        params["unit"] = unit
    return api.http.post(f"/api/projects/{pid}/assets", params=params, content=data,
                         headers={"Content-Type": "application/octet-stream"})


def project_assets(api: Api, pid: str) -> tuple[list[dict[str, Any]], int]:
    body = ok(api.get(f"/api/projects/{pid}"), 200)
    return body["assets"], int(body["project"]["assetCount"])


def wait_api(check_: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    failure: BaseException | None = None
    for _ in range(MAX_POLLS):
        try:
            return check_()
        except (AssertionError, pytest.fail.Exception) as exc:
            failure = exc
        if time.monotonic() >= deadline:
            break
        threading.Event().wait(POLL_MS / 1000)
    pytest.fail(f"{what} did not hold within {seconds} s: {failure}")


def outage(var: str) -> str:
    url = os.environ.get(var, "")
    assert url, f"{var} is not set; the outage instance is needed"
    return url.rstrip("/")


def inbox(mail: Any, address: str, count: int, seconds: float = MAIL_WAIT_S) -> list[dict[str, Any]]:
    deadline = time.monotonic() + seconds
    found: list[dict[str, Any]] = []
    for _ in range(MAX_POLLS):
        found = [m for m in mail.messages() if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
        if len(found) >= count or time.monotonic() >= deadline:
            break
    assert len(found) >= count, f"Mailpit has {len(found)} message(s) to {address}; expected {count}"
    return found


def invite_tokens(messages: list[dict[str, Any]]) -> list[str]:
    found = [re.search(r"/invite/([A-Za-z0-9_-]+)", text(m)) for m in messages]
    return [m.group(1) for m in found if m]


def live_invite(base: str, tokens: list[str]) -> str:
    for token in tokens:
        resp = httpx.get(f"{base}/api/invites/{token}", timeout=HTTP_TIMEOUT)
        if resp.status_code == 200 and resp.json()["invite"]["status"] == "pending":
            return token
    pytest.fail(f"no pending invite among the emailed tokens {tokens}")


def add_member(owner: Api, wid: str, role: str, mail: Any, prefix: str = "cotutor") -> Api:
    member = sign_up(owner.base, prefix)
    ok(owner.post(f"/api/workspaces/{wid}/invites", {"email": member.email, "role": role}), 201)
    token = live_invite(owner.base, invite_tokens(inbox(mail, member.email, 1)))
    ok(member.post(f"/api/invites/{token}/accept"), 200)
    return member


def model_doc(half: float = 0.5, nodes: Any = None, scenes: Any = None, scene: int | None = None,
              minmax: bool = True, glb: bool = False, buffer_uri: str | None = None,
              images: list[dict[str, Any]] | None = None, label: str = "") -> tuple[dict[str, Any], bytes]:
    data = struct.pack("<9f", -half, -half, -half, half, half, half, -half, half, -half)
    accessor: dict[str, Any] = {"bufferView": 0, "componentType": GL_FLOAT, "count": 3, "type": "VEC3"}
    if minmax:
        accessor["min"], accessor["max"] = [-half] * 3, [half] * 3
    buffer: dict[str, Any] = {"byteLength": len(data)}
    if not glb:
        buffer["uri"] = buffer_uri or "data:application/octet-stream;base64," + base64.b64encode(data).decode()
    out: dict[str, Any] = {
        "asset": {"version": "2.0", "generator": f"rampwright-verifier {label}"},
        "buffers": [buffer], "bufferViews": [{"buffer": 0, "byteLength": len(data)}],
        "accessors": [accessor], "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
        "nodes": nodes if nodes is not None else [{"mesh": 0}],
    }
    if scenes != "none":
        out["scenes"] = scenes if scenes is not None else [{"nodes": [0]}]
    if scene is not None:
        out["scene"] = scene
    if images:
        out["images"] = images
    return out, data


def gltf_bytes(**kw: Any) -> bytes:
    return json.dumps(model_doc(**kw)[0], indent=1).encode()


def glb_bytes(**kw: Any) -> bytes:
    body, data = model_doc(glb=True, **kw)
    js = json.dumps(body, indent=1).encode()
    js += b" " * (-len(js) % 4)
    binary = data + b"\x00" * (-len(data) % 4)
    chunks = struct.pack("<I4s", len(js), b"JSON") + js + struct.pack("<I4s", len(binary), b"BIN\x00") + binary
    return b"glTF" + struct.pack("<II", 2, 12 + len(chunks)) + chunks


def png_bytes(label: str, size: int | None = None) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)
    raw = (PNG_SIGNATURE + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
           + chunk(b"tEXt", b"Comment\x00" + label.encode()) + chunk(b"IDAT", zlib.compress(b"\x00\xff\xff\xff"))
           + chunk(b"IEND", b""))
    return raw + b"\x00" * (size - len(raw)) if size else raw


def jpeg_bytes(label: str) -> bytes:
    return b"\xff\xd8\xff\xe0\x00\x10JFIF\x00" + label.encode() + b"\xff\xd9"


def sample_bytes(kind: str, label: str) -> bytes:
    builders: dict[str, Callable[[], bytes]] = {
        "glb": lambda: glb_bytes(label=label),
        "gltf": lambda: gltf_bytes(label=label),
        "png": lambda: png_bytes(label),
        "jpeg": lambda: jpeg_bytes(label),
        "svg": lambda: SVG,
        "text": lambda: f"plain notes {label}\n".encode(),
        "gltf-no-scene": lambda: gltf_bytes(scenes="none", label=label),
        "gltf-no-minmax": lambda: gltf_bytes(minmax=False, label=label),
        "png-limit": lambda: png_bytes(label, UPLOAD_LIMIT),
        "png-over": lambda: png_bytes(label, UPLOAD_LIMIT + 1),
        "gltf-external-buffer": lambda: gltf_bytes(buffer_uri="cube.bin", label=label),
        "gltf-external-image": lambda: gltf_bytes(images=[{"uri": "texture.png"}], label=label),
        "glb-external-image": lambda: glb_bytes(images=[{"uri": "texture.png"}], label=label),
    }
    return builders[kind]()


def soon(page: Page | None, assertion: Callable[[], Any], seconds: float, what: str, *others: Page) -> None:
    deadline = time.monotonic() + seconds
    failure: BaseException | None = None
    for _ in range(MAX_POLLS):
        try:
            assertion()
            return
        except AssertionError as exc:
            failure = exc
        if time.monotonic() >= deadline:
            break
        for each in ([page] if page else []) + list(others):
            advance(each, POLL_MS)
    pytest.fail(f"{what} did not hold within {seconds} s: {failure}")


def visible(page: Page, loc: Any, seconds: float = UI_S) -> None:
    soon(page, lambda: expect(loc).to_be_visible(timeout=POLL_MS), seconds, f"{loc} visible")


def says(page: Page, loc: Any, value: Any, seconds: float = UI_S, *others: Page) -> None:
    soon(page, lambda: expect(loc).to_have_text(value, timeout=POLL_MS), seconds, f"{loc} reads {value!r}", *others)


def shows(page: Page, loc: Any, value: Any, seconds: float = UI_S, *others: Page) -> None:
    soon(page, lambda: expect(loc).to_contain_text(value, timeout=POLL_MS), seconds, f"{loc} contains {value!r}", *others)


def at_url(page: Page, pattern: str, seconds: float = UI_S) -> re.Match[str]:
    soon(page, lambda: expect(page).to_have_url(re.compile(pattern), timeout=POLL_MS), seconds, f"address bar matches {pattern}")
    found = re.search(pattern, page.url)
    assert found
    return found


@contextmanager
def opened(browser: Browser, base: str, who: Api | None, path: str, size: tuple[int, int] = (1280, 800), **opts: Any) -> Iterator[Page]:
    with open_app(browser, base + "/sign-in", **opts) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if who is not None:
            resp = page.request.post(base + "/api/auth/sign-in", data={"email": who.email, "password": who.password})
            assert resp.status == 200, f"browser sign-in answered {resp.status}"
        page.goto(base + path)
        yield page


@contextmanager
def open_editor(browser: Browser, base: str, who: Api, wid: str, sid: str, size: tuple[int, int] = (1280, 800), **opts: Any) -> Iterator[Page]:
    with opened(browser, base, who, f"/w/{wid}/s/{sid}", size, **opts) as page:
        visible(page, stage(page))
        yield page


def stage(page: Page) -> Any:
    return page.get_by_role("application", name="Stage")


def row(page: Page, name: str) -> Any:
    return page.get_by_role("tree", name="Scene outline").get_by_role("treeitem", name=name)


def spin(page: Page, name: str) -> Any:
    return page.get_by_role("spinbutton", name=name, exact=True)


def status(page: Page, name: str) -> Any:
    return page.get_by_role("status", name=name)


def run_button(page: Page) -> Any:
    return page.get_by_role("button", name=re.compile(r"^(Run|Stop)$"))


def pause_button(page: Page) -> Any:
    return page.get_by_role("button", name=re.compile(r"^(Pause|Resume)$"))


def step_button(page: Page) -> Any:
    return page.get_by_role("button", name="Step", exact=True)


def readouts(page: Page) -> Any:
    return page.get_by_role("region", name="Derived readouts")


def telemetry(page: Page) -> tuple[int, str]:
    content = page.get_by_role("group", name="Run telemetry").inner_text()
    step = re.search(r"step (\d+)", content)
    digest = re.search(r"hash ([0-9a-f]{12})", content)
    assert step and digest, f"Run telemetry reads {content!r}; expected 'step <n>' and 'hash <12 hex>' (L224)"
    return int(step.group(1)), digest.group(1)


def inspecting(page: Page) -> None:
    inspector = page.get_by_role("region", name="Inspector")
    assert (inspector.get_by_role("spinbutton", name="Position X (m)").count() > 0
            or "Position X (m)" in inspector.inner_text()), "the inspector shows no object values"


def choose(page: Page, name: str) -> None:
    click(row(page, name))
    soon(page, lambda: inspecting(page), UI_S, f"{name} selected (inspector shows object values)")


def holder_is(page: Page | None, api: Api, sid: str, oid: str, uid: str | None, seconds: float = UI_S, *others: Page) -> None:
    def check_() -> None:
        current = [l["holder"]["userId"] for l in locks(api, sid) if l["objectId"] == oid]
        assert (current == [uid]) if uid else not current, f"lease on {oid} held by {current}; expected {uid}"
    soon(page, check_, seconds, f"lease on {oid}", *others)


def doc_until(page: Page | None, api: Api, sid: str, predicate: Callable[[dict[str, Any], int], bool], what: str, seconds: float = SAVE_S) -> dict[str, Any]:
    seen: dict[str, Any] = {}

    def check_() -> None:
        raw, rev = document(api, sid)
        parsed = json.loads(raw)
        assert predicate(parsed, rev), f"{what}: revision {rev} document {raw[:600]!r}"
        seen["d"] = parsed
    soon(page, check_, seconds, what)
    return seen["d"]


def no_editable_fields(scope: Any) -> None:
    spins = scope.get_by_role("spinbutton")
    for i in range(spins.count()):
        expect(spins.nth(i)).not_to_be_editable(timeout=POLL_MS)


def box(loc: Any) -> dict[str, float]:
    found = loc.bounding_box()
    assert found, f"{loc} has no layout box"
    return found


def inside(dialog: Any) -> bool:
    return bool(dialog.evaluate("d => d.contains(document.activeElement)"))


def run_and_step(page: Page, count: int, touch: bool = False) -> tuple[int, str]:
    act = tap if touch else click
    act(run_button(page))
    says(page, status(page, "Mode"), "RUNNING")
    act(pause_button(page))
    says(page, status(page, "Mode"), "PAUSED")
    start, _ = telemetry(page)
    for _ in range(count):
        act(step_button(page))
    soon(page, lambda: _assert_step(page, start + count), UI_S, "Step advances exactly one step each")
    return telemetry(page)


def _assert_step(page: Page, expected: int) -> None:
    assert telemetry(page)[0] == expected, f"telemetry step {telemetry(page)[0]}; expected {expected}"


def cam_equal(a: list[list[float]], b: list[list[float]]) -> bool:
    return len(a) == len(b) and all(abs(x - y) < CAMERA_EPS for m, n in zip(a, b) for x, y in zip(m, n))


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return int(probe.getsockname()[1])


class Relay:

    def __init__(self, target: tuple[str, int]) -> None:
        self.target = target
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.links: list[socket.socket] = []

    def start(self) -> None:
        lst = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lst.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        lst.bind(("127.0.0.1", self.port))
        lst.listen(64)
        self.listener = lst
        threading.Thread(target=self._accept, args=(lst,), daemon=True).start()

    def _accept(self, lst: socket.socket) -> None:
        for _ in range(RELAY_MAX_CONNECTIONS):
            try:
                client, _peer = lst.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            self.links += [client, upstream]
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        for _ in range(RELAY_MAX_CHUNKS):
            try:
                data = src.recv(RELAY_CHUNK)
                if not data:
                    break
                dst.sendall(data)
            except OSError:
                break
        for s in (src, dst):
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass

    def stop(self) -> None:
        if self.listener is not None:
            try:
                self.listener.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.listener.close()
            self.listener = None
        for s in self.links:
            try:
                s.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            s.close()
        self.links.clear()


def service_target(url: str, default_port: int) -> tuple[str, int]:
    parts = urlparse(url)
    return parts.hostname or "127.0.0.1", parts.port or default_port


def relay_url(url: str, port: int) -> str:
    parts = urlparse(url)
    auth = parts.netloc.rpartition("@")[0]
    return parts._replace(netloc=(auth + "@" if auth else "") + f"127.0.0.1:{port}").geturl()


def manifest() -> dict[str, Any]:
    for folder in (Path(DEPLOYED_APP), Path("/app")):
        candidate = folder / "run.json"
        if candidate.is_file():
            return json.loads(candidate.read_text())
    pytest.fail("run.json not found in the deployed app or /app")


@contextmanager
def app_copy(**overrides: str) -> Iterator[str]:
    port = free_port()
    env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}
    log = Path(tempfile.mkstemp(prefix="rampwright-copy-", suffix=".log")[1])
    with log.open("wb") as sink:
        proc = subprocess.Popen(manifest()["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=sink,
                                stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail() -> str:
        return log.read_text(errors="replace")[-3000:]
    try:
        deadline = time.monotonic() + BOOT_S
        up = False
        while time.monotonic() < deadline and not up:
            if proc.poll() is not None:
                pytest.fail(f"app copy exited with {proc.returncode}: {tail()}")
            try:
                up = httpx.get(base + "/api/health", timeout=2).status_code == 200
            except httpx.HTTPError:
                try:
                    proc.wait(timeout=POLL_MS / 1000)
                except subprocess.TimeoutExpired:
                    pass
        assert up, f"app copy did not answer /api/health within {BOOT_S} s: {tail()}"
        yield base
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass


def test_signup_and_signin(app_url: str) -> None:
    email, name = ident("signup")
    api = Api(app_url)
    body = ok(api.post("/api/auth/sign-up", {"displayName": name, "email": f"  {email} ", "password": PASSWORD}), 201)
    assert body["user"]["email"] == email and body["user"]["displayName"] == name, body
    assert body["landing"] == "/workspaces/new"
    assert ok(api.get("/api/me"), 200)["user"]["id"] == body["user"]["id"], "sign-up signs the person in (L889)"
    dup = Api(app_url).post("/api/auth/sign-up", {"displayName": name, "email": f" {email.upper()}", "password": PASSWORD})
    assert err(dup, 409, "email_taken")["fields"]["email"] == "An account already uses this email."
    other = Api(app_url)
    ok(other.post("/api/auth/sign-in", {"email": f" {email.upper()} ", "password": PASSWORD}), 200)
    assert ok(other.get("/api/me"), 200)["user"]["id"] == body["user"]["id"]
    err(Api(app_url).post("/api/auth/sign-in", {"email": email, "password": PASSWORD + "x"}), 401, "bad_credentials")
    ok(other.post("/api/auth/sign-out"), 204)
    err(other.get("/api/me"), 401, "unauthenticated")
    bad_email, bad_name = ident("signup-bad")
    fields = err(Api(app_url).post("/api/auth/sign-up", {"displayName": NAME_TOO_LONG, "email": bad_email, "password": "short"}), 422, "validation")["fields"]
    assert fields["displayName"] == "Enter a name of 1 to 60 characters."
    assert fields["password"] == "Use 10 to 128 characters."
    fields = err(Api(app_url).post("/api/auth/sign-up", {"displayName": bad_name, "email": "not-an-address", "password": PASSWORD}), 422, "validation")["fields"]
    assert fields["email"] == "Enter a valid email address."
    err(Api(app_url).post("/api/auth/sign-in", {"email": bad_email, "password": "short"}), 401, "bad_credentials")
    edge_email, edge_name = ident("signup-edge")
    ok(Api(app_url).post("/api/auth/sign-up", {"displayName": "n" * NAME_MAX, "email": edge_email, "password": "p" * PASSWORD_MAX}), 201)


def test_signup_concurrent(app_url: str) -> None:
    email, name = ident("race")
    variants = [email.upper() if i % 2 else f"  {email.lower()} " for i in range(SIGNUP_RACE)]
    gate = threading.Barrier(SIGNUP_RACE)

    def attempt(address: str) -> httpx.Response:
        client = Api(app_url)
        gate.wait(timeout=HTTP_TIMEOUT)
        return client.post("/api/auth/sign-up", {"displayName": name, "email": address, "password": PASSWORD})
    with ThreadPoolExecutor(SIGNUP_RACE) as pool:
        answers = list(pool.map(attempt, variants))
    codes = [r.status_code for r in answers]
    assert codes.count(201) == 1 and codes.count(409) == SIGNUP_RACE - 1, f"sign-up race answered {codes}"
    for r in answers:
        if r.status_code == 409:
            err(r, 409, "email_taken")
    winner = next(r for r in answers if r.status_code == 201).json()["user"]
    assert sign_in(app_url, email.lower()).user["id"] == winner["id"]


def test_signin_landing_routes(app_url: str) -> None:
    user = sign_up(app_url, "lander")
    assert landing_for(app_url, user.email) == "/workspaces/new"
    first, _ = new_workspace(user)
    second, _ = new_workspace(user)
    assert landing_for(app_url, user.email) == f"/w/{second}", "creating a workspace records it as last opened (L745)"
    ok(user.get(f"/api/workspaces/{first}"), 200)
    assert landing_for(app_url, user.email) == f"/w/{first}", "GET /api/workspaces/<wid> records last opened (L746)"
    assert ok(user.get("/api/me"), 200)["lastWorkspaceId"] == first
    dana = sign_in(app_url, "dana@whitcombe-tutoring.example", "dana-bench-2026")
    spaces = ok(dana.get("/api/me"), 200)["workspaces"]
    whitcombe = next(w for w in spaces if w["name"] == "Whitcombe Tutoring")
    assert landing_for(app_url, "dana@whitcombe-tutoring.example", "dana-bench-2026") == f"/w/{whitcombe['id']}"


def test_wf_onboarding_signin(browser: Browser, app_url: str) -> None:
    user = sign_up(app_url, "signin")
    first, _ = new_workspace(user)
    new_workspace(user)
    ok(user.get(f"/api/workspaces/{first}"), 200)
    bare = sign_up(app_url, "bare")
    with open_app(browser, app_url + "/sign-in") as page:
        fill(page.get_by_role("textbox", name="Email"), user.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in"))
        alert = page.get_by_role("alert").filter(has_text="There is a problem")
        shows(page, alert, "Email or password is incorrect.")
        assert "/sign-in" in page.url
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        at_url(page, rf"/w/{re.escape(first)}$")
        page.reload()
        at_url(page, rf"/w/{re.escape(first)}$")
        visible(page, page.get_by_role("region", name="Projects"))
    with open_app(browser, app_url + "/sign-in") as page:
        fill(page.get_by_role("textbox", name="Email"), bare.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        at_url(page, r"/workspaces/new$")
        page.reload()
        visible(page, page.get_by_role("textbox", name="Workspace name"))


def test_wf_onboarding_happy(browser: Browser, app_url: str) -> None:
    email, name = ident("starter")
    first_name, second_name = f"Bench {tag()}", f"Co-op {tag()}"
    with open_app(browser, app_url + "/") as page:
        visible(page, page.get_by_role("heading", name="Rampwright", level=1))
        click(page.get_by_role("link", name="Start a bench"))
        at_url(page, r"/sign-up$")
        fill(page.get_by_role("textbox", name="Display name"), name)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        at_url(page, r"/workspaces/new$")
        fill(page.get_by_role("textbox", name="Workspace name"), first_name)
        click(page.get_by_role("button", name="Create workspace"))
        first = at_url(page, r"/w/([^/?#]+)$").group(1)
        projects = page.get_by_role("region", name="Projects")
        shows(page, projects, "No projects yet. Create one to start a bench.")
        page.reload()
        at_url(page, rf"/w/{re.escape(first)}$")
        visible(page, projects)
        click(page.get_by_role("button", name="Account", exact=True))
        click(page.get_by_role("menu", name="Account").get_by_role("menuitem", name="New workspace"))
        at_url(page, r"/workspaces/new$")
        fill(page.get_by_role("textbox", name="Workspace name"), second_name)
        click(page.get_by_role("button", name="Create workspace"))
        second = at_url(page, r"/w/([^/?#]+)$").group(1)
        assert second != first
        click(page.get_by_role("button", name="Account", exact=True))
        click(page.get_by_role("menu", name="Account").get_by_role("menuitemradio", name=first_name))
        at_url(page, rf"/w/{re.escape(first)}$")
        page.reload()
        at_url(page, rf"/w/{re.escape(first)}$")
        page.goto(f"{app_url}/w/{second}")
        at_url(page, rf"/w/{re.escape(second)}$")
        shows(page, page.get_by_role("button", name="Account", exact=True), second_name)
    api = sign_in(app_url, email)
    me = ok(api.get("/api/me"), 200)
    mine = {w["id"]: (w["name"], w["role"]) for w in me["workspaces"]}
    assert mine.get(first) == (first_name, "owner") and mine.get(second) == (second_name, "owner"), mine
    assert me["lastWorkspaceId"] == second


RETURN_CASES = {
    "/w/abc123/activity": True,
    "//evil.example/w": False,
    "/\\evil.example": False,
    "%2F%2Fevil.example": False,
    "/w/%0Aabc": False,
    "/api/me": False,
    "https://evil.example/": False,
    "w/abc": False,
}


def test_safe_return_rule(app_url: str) -> None:
    user = sign_up(app_url, "returner")
    for value, safe in RETURN_CASES.items():
        landing = landing_for(app_url, user.email, **{"return": value})
        expected = value if safe else "/workspaces/new"
        assert landing == expected, f"return {value!r} landed on {landing!r}; expected {expected!r}"


def test_wf_onboarding_session_return(browser: Browser, app_url: str) -> None:
    user = sign_up(app_url, "session")
    wid, _ = new_workspace(user)
    path = f"/w/{wid}/activity"
    with opened(browser, app_url, user, path) as page:
        visible(page, page.get_by_role("list", name="Activity"))
        ok_status = page.request.post(app_url + "/api/auth/sign-out").status
        assert ok_status == 204
        page.reload()
        target = f"{app_url}/sign-in?return={quote(path, safe=chr(45) + '_.!~*' + chr(39) + '()')}"
        soon(page, lambda: expect(page).to_have_url(target, timeout=POLL_MS), UI_S, "signed-out visit goes to sign-in with the return path")
        fill(page.get_by_role("textbox", name="Email"), user.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        at_url(page, rf"{re.escape(path)}$")
        visible(page, page.get_by_role("list", name="Activity"))
    with open_app(browser, app_url + "/sign-in?return=%2F%2Fevil.example") as page:
        fill(page.get_by_role("textbox", name="Email"), user.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        at_url(page, rf"/w/{re.escape(wid)}$")
        assert same_origin(page.url, app_url), f"sign-in left the app for {page.url}"


def test_invite_email_and_supersede(app_url: str, mail: Any) -> None:
    owner = sign_up(app_url, "inviter")
    wid, ws = new_workspace(owner)
    email, _ = ident("invitee")
    path = f"/api/workspaces/{wid}/invites"
    first = ok(owner.post(path, {"email": email, "role": "viewer"}), 201)
    assert first["invite"]["status"] == "pending" and first["invite"]["role"] == "viewer"
    assert first["superseded"] is None and first["delivery"] == "sent"
    second = ok(owner.post(path, {"email": email.upper(), "role": "editor"}), 201)
    assert second["superseded"] == first["invite"]["id"]
    pending = [i for i in ok(owner.get(f"/api/workspaces/{wid}"), 200)["invites"] if i["email"].lower() == email.lower()]
    assert [i["id"] for i in pending] == [second["invite"]["id"]], pending
    messages = inbox(mail, email, 2)
    assert len(messages) == 2, f"expected one message per invite, got {len(messages)}"
    for m in messages:
        assert m.get("Subject") == f"{owner.name} invited you to {ws} on Rampwright"
        assert mail_from_address() in addresses(m.get("From"))
        assert "/invite/" in text(m)
    tokens = invite_tokens(messages)
    live = live_invite(app_url, tokens)
    assert ok(httpx.get(f"{app_url}/api/invites/{live}", timeout=HTTP_TIMEOUT), 200)["invite"]["role"] == "editor"
    stale = next(t for t in tokens if t != live)
    err(httpx.get(f"{app_url}/api/invites/{stale}", timeout=HTTP_TIMEOUT), 410, "invite_superseded")
    racer, _ = ident("invite-race")
    gate = threading.Barrier(INVITE_RACE)

    def attempt(_i: int) -> int:
        gate.wait(timeout=HTTP_TIMEOUT)
        return owner.post(path, {"email": racer, "role": "editor"}).status_code
    with ThreadPoolExecutor(INVITE_RACE) as pool:
        assert set(pool.map(attempt, range(INVITE_RACE))) == {201}
    pending = [i for i in ok(owner.get(f"/api/workspaces/{wid}"), 200)["invites"] if i["email"].lower() == racer.lower()]
    assert len(pending) == 1, f"simultaneous invites left {len(pending)} pending invites; expected 1"
    err(owner.post(path, {"email": owner.email, "role": "editor"}), 409, "already_member")
    assert err(owner.post(path, {"email": email, "role": "admin"}), 422, "validation")["fields"]["role"] == "Choose Editor or Viewer."
    assert err(owner.post(path, {"email": "nope", "role": "editor"}), 422, "validation")["fields"]["email"] == "Enter a valid email address."
    owner_mail = [m for m in mail.messages() if owner.email.lower() in [a.lower() for a in addresses(m.get("To"))]]
    assert owner_mail == [], "inviting a current member sends no mail (L962)"


def test_invite_lifecycle(app_url: str, mail: Any) -> None:
    owner = sign_up(app_url, "lifecycle")
    wid, _ = new_workspace(owner)
    path = f"/api/workspaces/{wid}/invites"
    accepted_user, revoked_user, other = sign_up(app_url, "accepter"), sign_up(app_url, "revoked"), sign_up(app_url, "stranger")
    sup_email, _ = ident("superseded")
    created = owner.post(path, {"email": accepted_user.email, "role": "editor"})
    a = ok(created, 201)["invite"]
    date = server_date(created)
    if date:
        delta = (stamp(a["expiresAt"]) - date).total_seconds()
        assert abs(delta - INVITE_TTL_DEFAULT) <= CLOCK_SKEW_S, f"expiresAt is {delta} s after creation"
    assert TIMESTAMP.match(a["expiresAt"])
    b = ok(owner.post(path, {"email": revoked_user.email, "role": "viewer"}), 201)["invite"]
    ok(owner.post(path, {"email": sup_email, "role": "viewer"}), 201)
    ok(owner.post(path, {"email": sup_email, "role": "editor"}), 201)
    token_a = invite_tokens(inbox(mail, accepted_user.email, 1))[0]
    token_b = invite_tokens(inbox(mail, revoked_user.email, 1))[0]
    sup_tokens = invite_tokens(inbox(mail, sup_email, 2))
    stale = next(t for t in sup_tokens if t != live_invite(app_url, sup_tokens))
    err(other.post(f"/api/invites/{token_a}/accept"), 403, "invite_email_mismatch")
    assert ok(httpx.get(f"{app_url}/api/invites/{token_a}", timeout=HTTP_TIMEOUT), 200)["invite"]["status"] == "pending"
    body = ok(accepted_user.post(f"/api/invites/{token_a}/accept"), 200)
    assert body == {"workspaceId": wid, "role": "editor", "landing": f"/w/{wid}"} or (
        body["workspaceId"] == wid and body["role"] == "editor" and body["landing"] == f"/w/{wid}"), body
    members = ok(owner.get(f"/api/workspaces/{wid}"), 200)["members"]
    assert any(m["userId"] == accepted_user.uid and m["role"] == "editor" for m in members)
    err(accepted_user.post(f"/api/invites/{token_a}/accept"), 409, "invite_used")
    err(owner.delete(f"{path}/{a['id']}"), 409, "invite_used")
    assert ok(httpx.get(f"{app_url}/api/invites/{token_a}", timeout=HTTP_TIMEOUT), 200)["invite"]["status"] == "accepted"
    revoked = ok(owner.delete(f"{path}/{b['id']}"), 200)["invite"]
    assert revoked["status"] == "revoked" and revoked["reason"] == "owner"
    view = ok(httpx.get(f"{app_url}/api/invites/{token_b}", timeout=HTTP_TIMEOUT), 200)["invite"]
    assert view["status"] == "revoked" and view["reason"] == "owner"
    err(revoked_user.post(f"/api/invites/{token_b}/accept"), 410, "invite_revoked")
    err(owner.delete(f"{path}/{b['id']}"), 410, "invite_revoked")
    sup_user = sign_up(app_url, "sup", email=sup_email)
    err(sup_user.post(f"/api/invites/{stale}/accept"), 410, "invite_superseded")
    old_id = next(i for i in [ok(owner.post(path, {"email": sup_email, "role": "viewer"}), 201)] if i)["superseded"]
    err(owner.delete(f"{path}/{old_id}"), 410, "invite_superseded")
    assert all(m["userId"] != revoked_user.uid for m in ok(owner.get(f"/api/workspaces/{wid}"), 200)["members"])


def test_invite_expiry(mail: Any) -> None:
    base = outage("APP_SHORT_URL")
    owner = sign_up(base, "expirer")
    wid, _ = new_workspace(owner)
    invitee = sign_up(base, "late")
    created = owner.post(f"/api/workspaces/{wid}/invites", {"email": invitee.email, "role": "editor"})
    invite = ok(created, 201)["invite"]
    expires = stamp(invite["expiresAt"])
    date = server_date(created)
    if date:
        assert 0 < (expires - date).total_seconds() <= SHORT_INVITE_TTL + CLOCK_SKEW_S
    token = invite_tokens(inbox(mail, invitee.email, 1))[0]

    def expired() -> None:
        resp = httpx.get(f"{base}/api/invites/{token}", timeout=HTTP_TIMEOUT)
        state = resp.json()["invite"]["status"] if resp.status_code == 200 else resp.status_code
        answered = server_date(resp)
        if state == "pending" and answered:
            assert answered < expires + timedelta(seconds=1), "an invite past expiresAt still read pending"
        assert state == "expired", f"invite status {state}"
        if answered:
            assert answered >= expires - timedelta(seconds=1), "invite read expired before expiresAt"
    wait_api(expired, SHORT_INVITE_TTL + MAIL_WAIT_S, "invite reads expired once the server clock reaches expiresAt")
    err(invitee.post(f"/api/invites/{token}/accept"), 410, "invite_expired")
    err(owner.delete(f"/api/workspaces/{wid}/invites/{invite['id']}"), 410, "invite_expired")
    assert all(m["userId"] != invitee.uid for m in ok(owner.get(f"/api/workspaces/{wid}"), 200)["members"])


@pytest.mark.timeout(900)
def test_mail_outage_queue(mail: Any) -> None:
    down = outage("APP_MAILPIT_DOWN_URL")
    owner = sign_up(down, "queued-owner")
    wid, _ = new_workspace(owner)
    path = f"/api/workspaces/{wid}/invites"
    dead_invite, _ = ident("withdrawn")
    reinvited, _ = ident("reinvited")
    share_dead, _ = ident("share-dead")
    share_live, _ = ident("share-live")
    live, _ = ident("queued")
    d = ok(owner.post(path, {"email": dead_invite, "role": "editor"}), 201)
    assert d["delivery"] == "queued"
    ok(owner.delete(f"{path}/{d['invite']['id']}"), 200)
    pid = new_project(owner, wid)
    gone = ok(owner.post(f"/api/projects/{pid}/share-links", {"email": share_dead}), 201)
    assert gone["delivery"] == "queued"
    ok(owner.delete(f"/api/share-links/{gone['link']['id']}"), 204)
    first = ok(owner.post(path, {"email": reinvited, "role": "viewer"}), 201)
    second = ok(owner.post(path, {"email": reinvited, "role": "editor"}), 201)
    assert first["delivery"] == second["delivery"] == "queued" and second["superseded"] == first["invite"]["id"]
    assert ok(owner.post(path, {"email": live, "role": "editor"}), 201)["delivery"] == "queued"
    assert ok(owner.post(f"/api/projects/{pid}/share-links", {"email": share_live}), 201)["delivery"] == "queued"
    sid = new_scene(owner, pid)
    cp = checkpoint(owner, sid, "Before class")
    assert publish(owner, sid, cp["id"], EXPOSED)["delivery"] == "queued"
    wait_api(lambda: ok(owner.get("/api/status"), 200)["mail"] == "down" or pytest.fail("status mail not down"), STATUS_FRESH_S + 1, "status reports mail down")
    window = MAIL_QUEUE_S + MAIL_RETRY_S
    inbox(mail, live, 1, window)
    inbox(mail, reinvited, 1, window)
    inbox(mail, share_live, 1, window)
    inbox(mail, owner.email, 1, window)
    everything = mail.messages()

    def count(address: str) -> list[dict[str, Any]]:
        return [m for m in everything if address.lower() in [a.lower() for a in addresses(m.get("To"))]]
    assert len(count(live)) == 1 and len(count(share_live)) == 1 and len(count(owner.email)) == 1
    again = count(reinvited)
    assert len(again) == 1, f"superseded invite was sent: {len(again)} messages"
    assert ok(httpx.get(f"{down}/api/invites/{invite_tokens(again)[0]}", timeout=HTTP_TIMEOUT), 200)["invite"]["role"] == "editor"
    assert count(dead_invite) == [] and count(share_dead) == [], "a message whose invite or link died was sent"


def test_wf_invites_accept_journey(browser: Browser, app_url: str, mail: Any) -> None:
    owner = sign_up(app_url, "journey-owner")
    wid, ws = new_workspace(owner)
    email, name = ident("journey-cotutor")
    with opened(browser, app_url, owner, f"/w/{wid}/settings") as page:
        for role in ("Viewer", "Editor"):
            fill(page.get_by_role("textbox", name="Invite email"), email)
            select(page.get_by_role("combobox", name="Invite role"), role)
            click(page.get_by_role("button", name="Send invite"))
            says(page, status(page, "Notices"), f"Invite sent to {email}")
        revoke = page.get_by_role("table", name="Pending invites").get_by_role("button", name=f"Revoke invite to {email}")
        soon(page, lambda: expect(revoke).to_have_count(1, timeout=POLL_MS), UI_S, "one pending invite row")
    tokens = invite_tokens(inbox(mail, email, 2))
    newest = live_invite(app_url, tokens)
    stale = next(t for t in tokens if t != newest)
    with open_app(browser, f"{app_url}/invite/{stale}") as page:
        visible(page, page.get_by_text("This invite was replaced by a newer one. Use the latest email."))
        page.goto(f"{app_url}/invite/{newest}")
        visible(page, page.get_by_role("heading", name=f"Join {ws}"))
        click(page.get_by_role("link", name="Create account"))
        at_url(page, r"/sign-up\?")
        fill(page.get_by_role("textbox", name="Display name"), name)
        fill(page.get_by_role("textbox", name="Email"), email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Create account"))
        at_url(page, rf"/invite/{re.escape(newest)}$")
        click(page.get_by_role("button", name="Accept invite"))
        at_url(page, rf"/w/{re.escape(wid)}$")
        page.reload()
        at_url(page, rf"/w/{re.escape(wid)}$")
    members = ok(owner.get(f"/api/workspaces/{wid}"), 200)["members"]
    assert any(m["email"].lower() == email.lower() and m["role"] == "editor" for m in members), members


def test_wf_invites_mail_outage(browser: Browser, mail: Any) -> None:
    down = outage("APP_MAILPIT_DOWN_URL")
    owner = sign_up(down, "outage-owner")
    wid, _ = new_workspace(owner)
    email, _ = ident("outage-invitee")
    with opened(browser, down, owner, f"/w/{wid}/settings") as page:
        fill(page.get_by_role("textbox", name="Invite email"), email)
        select(page.get_by_role("combobox", name="Invite role"), "Editor")
        click(page.get_by_role("button", name="Send invite"))
        says(page, status(page, "Notices"), f"Invite saved for {email}. The email will go out when mail is back.")
    pending = [i for i in ok(owner.get(f"/api/workspaces/{wid}"), 200)["invites"] if i["email"].lower() == email.lower()]
    assert len(pending) == 1
    delivered = inbox(mail, email, 1, MAIL_QUEUE_S + MAIL_RETRY_S)
    assert len(delivered) == 1 and len(inbox(mail, email, 1)) == 1, "queued invite delivered more than once"


def test_workspace_isolation(app_url: str) -> None:
    b = Bench(app_url)
    outsider = sign_up(app_url, "outsider")
    ghost = "zz" + uuid.uuid4().hex
    probes: list[tuple[str, str, Any]] = [
        ("GET", "/api/workspaces/{w}", None), ("GET", "/api/workspaces/{w}/projects", None),
        ("POST", "/api/workspaces/{w}/projects", {"name": INTRUDER}), ("GET", "/api/workspaces/{w}/activity", None),
        ("POST", "/api/workspaces/{w}/invites", {"email": outsider.email, "role": "editor"}),
        ("GET", "/api/projects/{p}", None), ("POST", "/api/projects/{p}/scenes", {"name": INTRUDER, "template": "blank"}),
        ("GET", "/api/scenes/{s}", None), ("GET", "/api/scenes/{s}/document", None),
        ("POST", "/api/scenes/{s}/verify", {"steps": 1}), ("GET", "/api/scenes/{s}/checkpoints", None),
        ("POST", "/api/scenes/{s}/checkpoints", {"label": INTRUDER}), ("POST", "/api/scenes/{s}/locks/ramp-1", {}),
        ("GET", "/api/scenes/{s}/presence", None),
        ("PATCH", "/api/scenes/{s}", {"baseRevision": 1, "changeId": str(uuid.uuid4()), "ops": [scene_op("gravity", 20)]}),
    ]
    for method, template, body in probes:
        real = err(outsider.call(method, template.format(w=b.wid, p=b.pid, s=b.sid), body), 404, "not_found")
        fake = err(outsider.call(method, template.format(w=ghost, p=ghost, s=ghost), body), 404, "not_found")
        assert set(real) == set(fake), f"{method} {template}: {real} vs {fake}"
    names = [p["name"] for p in ok(b.owner.get(f"/api/workspaces/{b.wid}/projects"), 200)["projects"]]
    assert INTRUDER not in names
    assert ok(b.owner.get(f"/api/scenes/{b.sid}/checkpoints"), 200)["checkpoints"] == []
    assert document(b.owner, b.sid)[1] == 1
    foreign = b.owner.post(f"/api/workspaces/{b.wid}/projects", {"name": INTRUDER}, headers={"Origin": "http://evil.example"})
    err(foreign, 403, "cross_origin")
    names = [p["name"] for p in ok(b.owner.get(f"/api/workspaces/{b.wid}/projects"), 200)["projects"]]
    assert INTRUDER not in names


def test_role_table(app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    editor = add_member(b.owner, b.wid, "editor", mail, "editor")
    viewer = add_member(b.owner, b.wid, "viewer", mail, "viewer")
    ok(editor.post(f"/api/workspaces/{b.wid}/projects", {"name": f"Editor {tag()}"}), 201)
    ok(editor.post(f"/api/projects/{b.pid}/scenes", {"name": f"Editor {tag()}", "template": "blank"}), 201)
    set_field(editor, b.sid, "ramp-1", "params.mass_kg", 2)
    cp = checkpoint(editor, b.sid, f"Editor {tag()}")
    ok(editor.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 200)
    asset = ok(upload(editor, b.pid, png_bytes(tag()), "tile.png"), 201)["asset"]
    owner_only = [
        ("POST", f"/api/scenes/{b.sid}/publish", {"checkpointId": cp["id"], "exposed": []}),
        ("POST", f"/api/scenes/{b.sid}/unpublish", {}), ("POST", f"/api/scenes/{b.sid}/lab-link/regenerate", {}),
        ("POST", f"/api/projects/{b.pid}/share-links", {}), ("GET", f"/api/projects/{b.pid}/share-links", None),
        ("POST", f"/api/workspaces/{b.wid}/invites", {"email": ident("nobody")[0], "role": "viewer"}),
        ("PATCH", f"/api/workspaces/{b.wid}/members/{viewer.uid}", {"role": "editor"}),
    ]
    for method, path, body in owner_only:
        err(editor.call(method, path, body), 403, "forbidden")
    rev = document(b.owner, b.sid)[1]
    viewer_writes = owner_only + [
        ("POST", f"/api/workspaces/{b.wid}/projects", {"name": INTRUDER}),
        ("POST", f"/api/projects/{b.pid}/scenes", {"name": INTRUDER, "template": "blank"}),
        ("PATCH", f"/api/scenes/{b.sid}", {"baseRevision": rev, "changeId": str(uuid.uuid4()), "ops": [scene_op("gravity", 20)]}),
        ("POST", f"/api/scenes/{b.sid}/locks/ramp-1", {}),
        ("POST", f"/api/scenes/{b.sid}/checkpoints", {"label": INTRUDER}),
        ("POST", f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}),
    ]
    for method, path, body in viewer_writes:
        err(viewer.call(method, path, body), 403, "forbidden")
    err(upload(viewer, b.pid, png_bytes(tag()), "tile.png"), 403, "forbidden")
    assert document(b.owner, b.sid)[1] == rev, "a refused viewer write changed the scene"
    names = [p["name"] for p in ok(b.owner.get(f"/api/workspaces/{b.wid}/projects"), 200)["projects"]]
    assert INTRUDER not in names
    for path in (f"/api/workspaces/{b.wid}", f"/api/workspaces/{b.wid}/projects", f"/api/projects/{b.pid}",
                 f"/api/scenes/{b.sid}", f"/api/scenes/{b.sid}/document", f"/api/scenes/{b.sid}/checkpoints",
                 f"/api/workspaces/{b.wid}/activity", f"/api/scenes/{b.sid}/presence", f"/api/assets/{asset['id']}/original"):
        ok(viewer.get(path), 200)
    verify(viewer, b.sid, 5)
    ok(viewer.call("PUT", f"/api/scenes/{b.sid}/presence", {"tab": f"tab-{tag()}", "cursor": None, "selected": None}), 204)


def test_role_change_next_request(app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    member = add_member(b.owner, b.wid, "editor", mail, "demotee")
    set_gravity(member, b.sid, 20)
    ok(lock(member, b.sid, "ramp-1"), 200)
    path = f"/api/workspaces/{b.wid}/members/{member.uid}"
    assert ok(b.owner.call("PATCH", path, {"role": "viewer"}), 200)["member"]["role"] == "viewer"
    err(patch(member, b.sid, [scene_op("gravity", 30)]), 403, "forbidden")
    err(lock(member, b.sid, "ramp-1"), 403, "forbidden")
    err(member.post(f"/api/workspaces/{b.wid}/projects", {"name": INTRUDER}), 403, "forbidden")
    err(member.post(f"/api/scenes/{b.sid}/checkpoints", {"label": INTRUDER}), 403, "forbidden")
    err(upload(member, b.pid, png_bytes(tag()), "tile.png"), 403, "forbidden")
    ok(member.get(f"/api/scenes/{b.sid}"), 200)
    assert not [l for l in locks(b.owner, b.sid) if l["objectId"] == "ramp-1"], "demotion keeps the member's lease"
    to_viewer = [m for m in inbox(mail, member.email, 2) if m.get("Subject") == f"Your role in {b.ws_name} is now Viewer"]
    assert len(to_viewer) == 1
    ok(b.owner.call("PATCH", path, {"role": "editor"}), 200)
    set_gravity(member, b.sid, 30)
    to_editor = [m for m in inbox(mail, member.email, 3) if m.get("Subject") == f"Your role in {b.ws_name} is now Editor"]
    assert len(to_editor) == 1
    err(b.owner.call("PATCH", f"/api/workspaces/{b.wid}/members/{b.owner.uid}", {"role": "viewer"}), 409, "owner_role_fixed")
    assert err(b.owner.call("PATCH", path, {"role": "admin"}), 422, "validation")["fields"]["role"] == "Choose Editor or Viewer."
    err(member.call("PATCH", f"/api/workspaces/{b.wid}/members/{b.owner.uid}", {"role": "viewer"}), 403, "forbidden")
    changed_events = [e for e in events(b.owner, b.wid) if e["action"] == "member.role_changed"]
    assert len(changed_events) == 2 and all(e["targetName"] == member.name for e in changed_events)


def test_activity_events(app_url: str, mail: Any) -> None:
    owner = sign_up(app_url, "logger")
    wid, ws = new_workspace(owner)
    editor = add_member(owner, wid, "editor", mail, "log-editor")
    viewer = add_member(owner, wid, "viewer", mail, "log-viewer")
    pname, sname = f"Forces {tag()}", f"Slope trial {tag()}"
    pid = new_project(owner, wid, pname)
    sid = new_scene(owner, pid, "ramp", sname)
    change = str(uuid.uuid4())
    first = ok(patch(owner, sid, [scene_op("gravity", 20)], base=1, change=change), 200)
    assert ok(patch(owner, sid, [scene_op("gravity", 20)], base=1, change=change), 200) == first
    err(patch(owner, sid, [scene_op("gravity", 99)]), 422, "validation")
    label = f"Before class {tag()}"
    checkpoint(owner, sid, label)
    expected = sorted([
        ("workspace.created", ws, owner.name), ("invite.created", editor.email, owner.name),
        ("invite.accepted", editor.email, editor.name), ("invite.created", viewer.email, owner.name),
        ("invite.accepted", viewer.email, viewer.name), ("project.created", pname, owner.name),
        ("scene.created", sname, owner.name), ("scene.edited", sname, owner.name),
        ("checkpoint.created", label, owner.name),
    ])
    for reader in (owner, editor, viewer):
        got = events(reader, wid)
        seen = sorted((e["action"], e["targetName"], e["actor"]["displayName"]) for e in got)
        assert seen == expected, f"activity for {reader.name}: {seen}"
        keys = [(e["at"], e["id"]) for e in got]
        assert all(TIMESTAMP.match(e["at"]) for e in got)
        assert [k[0] for k in keys] == sorted((k[0] for k in keys), reverse=True), "events are newest first"
    assert got[0]["action"] == "checkpoint.created"


def test_activity_paging(app_url: str) -> None:
    owner = sign_up(app_url, "pager")
    wid, _ = new_workspace(owner)
    with ThreadPoolExecutor(7) as pool:
        list(pool.map(lambda i: new_project(owner, wid, f"Unit {i} {tag()}"), range(7)))
    snapshot = [e["id"] for e in events(owner, wid)]
    assert len(snapshot) == 8
    path = f"/api/workspaces/{wid}/activity"
    collected: list[str] = []
    before: str | None = None
    for _ in range(4):
        params: dict[str, Any] = {"limit": 3}
        if before:
            params["before"] = before
        body = ok(owner.get(path, params=params), 200)
        ids = [e["id"] for e in body["events"]]
        assert len(ids) <= 3
        collected += ids
        if ids:
            assert body["nextBefore"] in (ids[-1], None)
        before = body["nextBefore"]
        new_project(owner, wid, f"Later {tag()}")
        if before is None:
            break
    assert collected == snapshot, f"paging returned {collected}; expected {snapshot} with no repeat or skip"
    for bad in ({"limit": 0}, {"limit": ACTIVITY_MAX_LIMIT + 1}, {"before": "nosuchevent0000"}):
        error = err(owner.get(path, params=bad), 422, "invalid_cursor")
        assert "fields" not in error
    stranger = sign_up(app_url, "pager-other")
    other_wid, _ = new_workspace(stranger)
    foreign = events(stranger, other_wid)[0]["id"]
    err(owner.get(path, params={"before": foreign}), 422, "invalid_cursor")
    assert ok(owner.get(path), 200)["nextBefore"] is None or len(ok(owner.get(path), 200)["events"]) == ACTIVITY_PAGE


@pytest.mark.timeout(1200)
def test_wf_roles_activity_viewer_review(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    viewer = add_member(b.owner, b.wid, "viewer", mail, "reviewer")
    with ThreadPoolExecutor(8) as pool:
        list(pool.map(lambda i: new_project(b.owner, b.wid, f"Unit {i} {tag()}"), range(ACTIVITY_PAGE)))
    label = f"Before class {tag()}"
    checkpoint(b.owner, b.sid, label)
    total = len(events(b.owner, b.wid))
    with open_app(browser, app_url + "/sign-in") as page:
        fill(page.get_by_role("textbox", name="Email"), viewer.email)
        fill(page.get_by_label("Password", exact=True), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        at_url(page, rf"/w/{re.escape(b.wid)}$")
        page.goto(f"{app_url}/w/{b.wid}/s/{b.sid}")
        says(page, status(page, "View only"), "View only")
        choose(page, "Ramp 1")
        shows(page, page.get_by_role("region", name="Inspector"), "Mass (kg): 1")
        no_editable_fields(page)
        expect(page.get_by_role("button", name="Add ramp")).to_be_disabled()
        click(run_button(page))
        says(page, status(page, "Mode"), "RUNNING")
        click(run_button(page))
        page.goto(f"{app_url}/w/{b.wid}/activity")
        items = page.get_by_role("list", name="Activity").get_by_role("listitem")
        soon(page, lambda: expect(items).to_have_count(ACTIVITY_PAGE, timeout=POLL_MS), UI_S, "newest 50 events shown")
        says(page, status(page, "Notices"), f"Showing {ACTIVITY_PAGE} events")
        expect(items.first).to_contain_text(f"{b.owner.name} saved checkpoint {label}")
        assert re.search(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}\s*$", items.first.inner_text())
        newest = events(b.owner, b.wid)[0]
        assert items.first.evaluate("li => li.querySelector('time')?.getAttribute('datetime')") == newest["at"]
        shown = items.all_inner_texts()
        click(page.get_by_role("button", name="Show older"))
        soon(page, lambda: expect(items).to_have_count(total, timeout=POLL_MS), UI_S, "Show older appends older events")
        assert items.all_inner_texts()[:ACTIVITY_PAGE] == shown, "rows already shown were reordered"
        says(page, status(page, "Notices"), f"Showing {total} events")
        expect(page.get_by_role("button", name="Show older")).to_have_count(0)


def test_wf_roles_activity_live_demotion(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    member = add_member(b.owner, b.wid, "editor", mail, "live-demotee")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as owner_page, \
            open_editor(browser, app_url, member, b.wid, b.sid) as page:
        choose(page, "Ramp 1")
        holder_is(page, b.owner, b.sid, "ramp-1", member.uid)
        ok(b.owner.call("PATCH", f"/api/workspaces/{b.wid}/members/{member.uid}", {"role": "viewer"}), 200)

        def view_only() -> None:
            expect(status(page, "View only")).to_have_text("View only", timeout=POLL_MS)
            expect(status(page, "Save status")).to_have_text("Not saved: you can no longer edit this scene.", timeout=POLL_MS)
            no_editable_fields(page)
        soon(page, view_only, DEMOTION_S, "open editor turns view-only", owner_page)
        assert not [l for l in locks(b.owner, b.sid) if l["objectId"] == "ramp-1"]
        shows(owner_page, status(owner_page, "Collaboration"), re.compile(rf"{re.escape(member.name)} is now Viewer|Ramp 1 is free to edit"), DEMOTION_S)
    err(patch(member, b.sid, [scene_op("gravity", 20)]), 403, "forbidden")
    err(lock(member, b.sid, "ramp-1"), 403, "forbidden")
    ok(member.call("PUT", f"/api/scenes/{b.sid}/presence", {"tab": f"tab-{tag()}", "cursor": [0, 0, 0], "selected": None}), 204)


def test_projects_scenes_templates(app_url: str) -> None:
    b = Bench(app_url)
    for template, objects in TEMPLATES.items():
        name = f"{template} scene {tag()}"
        created = ok(b.owner.post(f"/api/projects/{b.pid}/scenes", {"name": name, "template": template}), 201)["scene"]
        assert created["status"] == "draft" and created["revision"] == 1 and HEX64.match(created["stateHash"])
        raw, rev = document(b.owner, created["id"])
        parsed = json.loads(raw)
        assert rev == 1 and raw == canonical(parsed), f"{template} document is not canonical JSON: {raw[:300]!r}"
        assert parsed["gravity"] == GRAVITY and parsed["name"] == name and parsed["solver"] == SOLVER
        got = [(o["id"], o["name"], o["kind"], o["params"]) for o in parsed["objects"]]
        assert got == objects, f"{template}: {got}"
        for o in parsed["objects"]:
            assert o["assetId"] is None and o["position"] == [0, 0, 0] and o["rotation"] == [0, 0, 0, 1] and o["scale"] == [1, 1, 1]
        if template == "blank":
            assert created["stateHash"] == sha(canonical({"objects": [], "step": 0}))
    listed = {s["name"] for s in ok(b.owner.get(f"/api/projects/{b.pid}"), 200)["scenes"]}
    assert {f"{t} scene" for t in TEMPLATES} <= {n.rsplit(" ", 1)[0] for n in listed}
    assert err(b.owner.post(f"/api/workspaces/{b.wid}/projects", {"name": ""}), 422, "validation")["fields"]["name"] == NAMES_COPY
    assert err(b.owner.post(f"/api/projects/{b.pid}/scenes", {"name": NAME_TOO_LONG, "template": "ramp"}), 422, "validation")["fields"]["name"] == NAMES_COPY
    assert err(b.owner.post("/api/workspaces", {"name": ""}), 422, "validation")["fields"]["name"] == NAMES_COPY
    actions = [e["action"] for e in events(b.owner, b.wid)]
    assert actions.count("scene.created") == len(TEMPLATES) + 1 and actions.count("project.created") == 1


def test_wf_editing_create(browser: Browser, app_url: str) -> None:
    owner = sign_up(app_url, "creator")
    wid, _ = new_workspace(owner)
    pname, sname = f"Forces {tag()}", f"Slope trial {tag()}"
    with opened(browser, app_url, owner, f"/w/{wid}") as page:
        click(page.get_by_role("button", name="New project"))
        fill(page.get_by_role("textbox", name="Project name"), pname)
        click(page.get_by_role("button", name="Create project"))
        pid = at_url(page, rf"/w/{re.escape(wid)}/p/([^/?#]+)$").group(1)
        shows(page, page.get_by_role("region", name="Scenes"), "This project has no scenes yet.")
        for template, name in (("Ramp", sname), ("Blank", f"Notes {tag()}")):
            page.goto(f"{app_url}/w/{wid}/p/{pid}")
            click(page.get_by_role("button", name="New scene"))
            dialog = page.get_by_role("dialog", name="New scene")
            fill(dialog.get_by_role("textbox", name="Scene name"), name)
            check(dialog.get_by_role("radio", name=template))
            click(dialog.get_by_role("button", name="Create scene"))
            sid = at_url(page, rf"/w/{re.escape(wid)}/s/([^/?#]+)$").group(1)
            if template == "Ramp":
                visible(page, row(page, "Ramp 1"))
                assert doc(owner, sid)["objects"][0]["id"] == "ramp-1"
            else:
                shows(page, page.get_by_role("region", name="Outline"), "No objects. Add one from Props.")
                page.reload()
                shows(page, page.get_by_role("region", name="Outline"), "No objects. Add one from Props.")
    scenes = {s["name"]: s for s in ok(owner.get(f"/api/projects/{pid}"), 200)["scenes"]}
    assert sname in scenes and scenes[sname]["status"] == "draft"


def test_wf_editing_place_props(browser: Browser, app_url: str) -> None:
    b = Bench(app_url, "blank")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        outline = page.get_by_role("region", name="Outline")
        shows(page, outline, "No objects. Add one from Props.")
        props = page.get_by_role("region", name="Props")
        click(props.get_by_role("tab", name="Models"))
        shows(page, props, "No models yet. Upload one in Assets.")
        click(props.get_by_role("tab", name="Rigs"))
        before = decode(capture(stage(page)))
        click(props.get_by_role("button", name="Add ramp"))
        visible(page, row(page, "Ramp 1"))
        shows(page, outline, "1 objects")
        props.get_by_role("button", name="Add crate").focus()
        page.keyboard.press("Enter")
        visible(page, row(page, "Crate 1"))
        sb = box(stage(page))
        props.get_by_role("button", name="Add pendulum").drag_to(stage(page), target_position={"x": sb["width"] / 2, "y": sb["height"] / 2 - 60})
        visible(page, row(page, "Pendulum 1"))
        click(props.get_by_role("button", name="Add ramp"))
        visible(page, row(page, "Ramp 2"))
        shows(page, outline, "4 objects")
        soon(page, lambda: inspecting(page), UI_S, "new object selected")
        saved = doc_until(page, b.owner, b.sid, lambda d, _r: len(d["objects"]) == 4, "four placed objects saved")
        advance(page, 500)
        changed(before, decode(capture(stage(page))))
        fill(page.get_by_role("searchbox", name="Find objects"), "Pend")
        soon(page, lambda: expect(row(page, "Ramp 1")).to_have_count(0, timeout=POLL_MS), UI_S, "find filters rows")
        visible(page, row(page, "Pendulum 1"))
        fill(page.get_by_role("searchbox", name="Find objects"), "")
        visible(page, page.get_by_role("button", name="Hide Ramp 1"))
    for name, kind, params in (("Ramp 1", "ramp", RAMP_DEFAULTS), ("Crate 1", "crate", {"mass_kg": 1}),
                               ("Pendulum 1", "pendulum", PENDULUM_DEFAULTS), ("Ramp 2", "ramp", RAMP_DEFAULTS)):
        placed = named(saved, name)
        assert placed and placed["kind"] == kind and placed["params"] == params and placed["id"].startswith(kind), placed
        assert placed["position"][1] == 0, f"{name} is not on the ground"
    assert named(saved, "Ramp 1")["position"] == [0, 0, 0] and named(saved, "Crate 1")["position"] == [0, 0, 0]


def test_wf_editing_keyboard_nudge(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        row(page, "Ramp 1").focus()
        page.keyboard.press("Enter")
        holder_is(page, b.owner, b.sid, "ramp-1", b.owner.uid)
        stage(page).focus()

        def press_and_wait(key: str, revision: int) -> dict[str, Any]:
            page.keyboard.press(key)
            return doc_until(page, b.owner, b.sid, lambda _d, r: r >= revision, f"{key} saved as revision {revision}")

        def pos(d: dict[str, Any]) -> list[float]:
            found = named(d, "Ramp 1")
            assert found, "Ramp 1 missing"
            return found["position"]
        press_and_wait("ArrowRight", 2)
        assert pos(doc(b.owner, b.sid)) == pytest.approx([NUDGE, 0, 0], abs=MILLIONTH)
        press_and_wait("Shift+ArrowRight", 3)
        press_and_wait("PageUp", 4)
        press_and_wait("ArrowUp", 5)
        assert pos(doc(b.owner, b.sid)) == pytest.approx([NUDGE + FINE_NUDGE, NUDGE, -NUDGE], abs=MILLIONTH)
        page.keyboard.press("s")
        expect(page.get_by_role("button", name="Snap")).to_have_attribute("aria-pressed", "true")
        press_and_wait("ArrowRight", 6)
        snapped = round((NUDGE + FINE_NUDGE + SNAP_STEP) / SNAP_STEP) * SNAP_STEP
        assert pos(doc(b.owner, b.sid)) == pytest.approx([snapped, NUDGE, -NUDGE], abs=MILLIONTH)
        press_and_wait("Control+z", 7)
        assert pos(doc(b.owner, b.sid))[0] == pytest.approx(NUDGE + FINE_NUDGE, abs=MILLIONTH)
        press_and_wait("Control+Shift+z", 8)
        assert pos(doc(b.owner, b.sid))[0] == pytest.approx(snapped, abs=MILLIONTH)
        press_and_wait("Delete", 9)
        assert named(doc(b.owner, b.sid), "Ramp 1") is None
        soon(page, lambda: expect(row(page, "Ramp 1")).to_have_count(0, timeout=POLL_MS), UI_S, "Delete removes the row")
        press_and_wait("Control+z", 10)
        assert pos(doc(b.owner, b.sid)) == pytest.approx([snapped, NUDGE, -NUDGE], abs=MILLIONTH)
        page.keyboard.press("s")
        choose(page, "Ramp 1")
        stage(page).focus()
        page.keyboard.press("e")
        rotated = press_and_wait("ArrowRight", 11)
        quat = named(rotated, "Ramp 1")["rotation"]
        half_turn = math.radians(ROTATE_DEG) / 2
        assert abs(quat[1]) == pytest.approx(math.sin(half_turn), abs=MILLIONTH) and quat[0] == pytest.approx(0, abs=MILLIONTH)
        page.keyboard.press("t")
        scaled = named(press_and_wait("ArrowUp", 12), "Ramp 1")["scale"]
        assert len(set(scaled)) == 1 and abs(scaled[0] - 1) == pytest.approx(NUDGE, abs=MILLIONTH), scaled


def test_command_palette(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        dialog = page.get_by_role("dialog", name="Commands")
        options = page.get_by_role("listbox", name="Matching commands").get_by_role("option")
        stage(page).focus()
        page.keyboard.press("Control+k")
        visible(page, dialog)
        fill(dialog.get_by_role("combobox", name="Command"), "ADD CR")
        soon(page, lambda: expect(options).to_have_count(1, timeout=POLL_MS), UI_S, "filter to Add crate")
        expect(options.first).to_have_text("Add crate")
        page.keyboard.press("Enter")
        visible(page, row(page, "Crate 1"))
        doc_until(page, b.owner, b.sid, lambda d, _r: named(d, "Crate 1") is not None, "palette Add crate saved")
        stage(page).focus()
        page.keyboard.press("Meta+k")
        visible(page, dialog)
        fill(dialog.get_by_role("combobox", name="Command"), "add")
        soon(page, lambda: expect(options).to_have_count(4, timeout=POLL_MS), UI_S, "four Add commands")
        assert all("add" in t.lower() for t in options.all_inner_texts())
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        shows(page, page.get_by_role("region", name="Outline"), "3 objects")
        stage(page).focus()
        page.keyboard.press("Control+k")
        fill(dialog.get_by_role("combobox", name="Command"), "select ramp 1")
        soon(page, lambda: expect(options.first).to_have_text("Select Ramp 1", timeout=POLL_MS), UI_S, "Select command listed")
        page.keyboard.press("Enter")
        holder_is(page, b.owner, b.sid, "ramp-1", b.owner.uid)
        stage(page).focus()
        page.keyboard.press("Control+k")
        fill(dialog.get_by_role("combobox", name="Command"), "run")
        page.keyboard.press("Enter")
        says(page, status(page, "Mode"), "RUNNING")


def test_inline_rename(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "rename-co")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        choose(page, "Ramp 1")
        row(page, "Ramp 1").focus()
        page.keyboard.press("F2")
        field = page.get_by_role("textbox", name="Rename Ramp 1")
        visible(page, field)
        expect(field).to_have_value("Ramp 1")
        assert field.evaluate("e => [e.selectionStart, e.selectionEnd]") == [0, len("Ramp 1")]
        page.keyboard.type("Ramp")
        set_gravity(co, b.sid, 20)
        ok(co.call("PUT", f"/api/scenes/{b.sid}/presence", {"tab": f"tab-{tag()}", "cursor": [1, 0, 1], "selected": None}), 204)
        advance(page, (LOCK_TTL_DEFAULT // 3 + 2) * 1000)
        advance(page, LIVE_S * 1000)
        expect(field).to_be_visible()
        expect(field).to_have_value("Ramp")
        expect(field).to_be_focused()
        assert field.evaluate("e => [e.selectionStart, e.selectionEnd]") == [len("Ramp")] * 2
        page.keyboard.type(" A")
        page.keyboard.press("Enter")
        visible(page, row(page, "Ramp A"))
        expect(row(page, "Ramp A")).to_be_focused()
        doc_until(page, b.owner, b.sid, lambda d, _r: obj(d, "ramp-1")["name"] == "Ramp A", "rename committed")
        rev = document(b.owner, b.sid)[1]
        row(page, "Ramp A").dblclick()
        cancel = page.get_by_role("textbox", name="Rename Ramp A")
        visible(page, cancel)
        page.keyboard.type("Zed")
        page.keyboard.press("Escape")
        expect(row(page, "Ramp A")).to_be_focused()
        advance(page, 2000)
        assert document(b.owner, b.sid)[1] == rev and obj(doc(b.owner, b.sid), "ramp-1")["name"] == "Ramp A"


def test_material_popover(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "material-co")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        choose(page, "Ramp 1")
        material = page.get_by_role("button", name="Material")
        click(material)
        dialog = page.get_by_role("dialog", name="Material")
        visible(page, dialog)
        expect(dialog.get_by_role("radio", name="Frictionless")).to_be_checked()
        assert inside(dialog)
        set_gravity(co, b.sid, 20)
        advance(page, (LOCK_TTL_DEFAULT // 3 + 2) * 1000)
        expect(dialog).to_be_visible()
        assert inside(dialog)
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        soon(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), UI_S, "choice closes the popover")
        expect(spin(page, "Friction")).to_have_value("0.05")
        doc_until(page, b.owner, b.sid, lambda d, _r: obj(d, "ramp-1")["params"]["friction"] == 0.05, "Ice friction saved")
        rev = document(b.owner, b.sid)[1]
        click(material)
        visible(page, dialog)
        expect(dialog.get_by_role("radio", name="Ice")).to_be_checked()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Escape")
        soon(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), UI_S, "Escape closes the popover")
        expect(material).to_be_focused()
        advance(page, 2000)
        assert document(b.owner, b.sid)[1] == rev


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_editor_layouts(browser: Browser, app_url: str, viewport: str) -> None:
    w, h = VIEWPORTS[viewport]
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid, size=(w, h)) as page:
        layout(page)
        regions = {n: page.get_by_role("region", name=n) for n in ("Outline", "Inspector", "Props", "Assets")}
        sheet = page.get_by_role("tablist", name="Panels")
        if w >= 1000:
            expect(sheet).to_have_count(0)
            outline, inspector, props = box(regions["Outline"]), box(regions["Inspector"]), box(regions["Props"])
            assert outline["x"] + outline["width"] / 2 < w / 2 < inspector["x"] + inspector["width"] / 2
            assert props["y"] > outline["y"]
        elif w >= 600:
            expect(sheet).to_have_count(0)
            boxes = [box(regions[n]) for n in ("Outline", "Inspector", "Props", "Assets")]
            assert all(bx["x"] >= w * DOCK_COLUMN_SHARE for bx in boxes), boxes
            assert [bx["y"] for bx in boxes] == sorted(bx["y"] for bx in boxes)
        else:
            visible(page, sheet)
            assert box(sheet)["y"] >= h * STAGE_SHARE
            for name in ("Outline", "Inspector", "Props", "Assets"):
                tab = sheet.get_by_role("tab", name=name)
                tb = box(tab)
                assert tb["height"] >= TOUCH_MIN_PX and tb["width"] >= TOUCH_MIN_PX
            click(sheet.get_by_role("tab", name="Inspector"))
            visible(page, regions["Inspector"])
            assert box(regions["Inspector"])["y"] >= h * STAGE_SHARE
        layout(page)


def test_wf_readouts_invalid_entry(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    cases = [
        ("Mass (kg)", "1 lb", None, "0.453592", "mass_kg", 0.45359237),
        ("Mass (kg)", "5 st", "Use kg, g or lb.", None, None, None),
        ("Mass (kg)", "abc", "Enter a number.", None, None, None),
        ("Mass (kg)", "500", "Enter a value from 0.1 to 100.", None, None, None),
        ("Length (m)", "250 cm", None, "2.5", "length_m", 2.5),
        ("Length (m)", "3 yd", "Use m, cm, mm, in or ft.", None, None, None),
        ("Angle (degrees)", "30 grad", "Use deg or rad.", None, None, None),
        ("Mass (kg)", "2500 g", None, "2.5", "mass_kg", 2.5),
    ]
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        choose(page, "Ramp 1")
        holder_is(page, b.owner, b.sid, "ramp-1", b.owner.uid)
        for label, typed, error, shown, key, si in cases:
            field = spin(page, label)
            before_value = field.input_value()
            rev = document(b.owner, b.sid)[1]
            fill(field, typed)
            if typed == "1 lb":
                shows(page, readouts(page), "Potential energy: 6.67 J", 1)
            if error:
                visible(page, page.get_by_text(error, exact=True))
                expect(field).to_have_attribute("aria-invalid", "true")
                says(page, status(page, "Save status"), "Not saved: check the highlighted value", 1)
                shows(page, readouts(page), "Potential energy: n/a")
                advance(page, 1500)
                assert document(b.owner, b.sid)[1] == rev, f"invalid {typed!r} was saved"
                fill(field, before_value)
                page.keyboard.press("Tab")
                soon(page, lambda: expect(status(page, "Save status")).not_to_have_text("Not saved: check the highlighted value", timeout=POLL_MS), UI_S, "Save status leaves the field error")
            else:
                page.keyboard.press("Tab")
                expect(field).to_have_value(shown)
                doc_until(page, b.owner, b.sid, lambda d, _r, k=key, v=si: obj(d, "ramp-1")["params"][k] == pytest.approx(v, abs=MILLIONTH), f"{typed} saved in SI")
    def grab() -> int:
        resp = lock(b.owner, b.sid, "ramp-1")
        assert resp.status_code == 200, f"lease request answered {resp.status_code}: {resp.text[:200]}"
        return int(resp.json()["lock"]["fence"])
    held_fence = wait_api(grab, TAB_RELEASE_S + 1, "the closed editor's lease is released so a fresh lease is granted")
    fields = err(patch(b.owner, b.sid, [set_op("ramp-1", held_fence, "params.mass_kg", 500)]), 422, "validation")["fields"]
    assert fields == {"ramp-1.params.mass_kg": "Enter a value from 0.1 to 100."}
    assert err(patch(b.owner, b.sid, [scene_op("gravity", 0)]), 422, "validation")["fields"] == {"scene.gravity": "Enter a value from 0.1 to 30."}
    fields = err(patch(b.owner, b.sid, [set_op("ramp-1", held_fence, "position", [600, 0, 0])]), 422, "validation")["fields"]
    assert fields == {"ramp-1.position": "Keep objects within 500 m of the origin and scale between 0.01 and 100."}
    assert err(patch(b.owner, b.sid, [set_op("ramp-1", held_fence, "name", "")]), 422, "validation")["fields"] == {"ramp-1.name": NAMES_COPY}


def test_wf_readouts_live(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    set_field(b.owner, b.sid, "ramp-1", "params.mass_kg", 2)
    set_field(b.owner, b.sid, "ramp-1", "params.length_m", 4)
    pend = new_scene(b.owner, b.pid, "pendulum")
    launch = new_scene(b.owner, b.pid, "launcher")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        choose(page, "Ramp 1")
        region = readouts(page)
        expect(region).to_have_attribute("aria-live", "polite")
        for line in ("Potential energy: 39.24 J", "Speed at bottom: 6.26 m/s", "Time to bottom: 1.28 s"):
            shows(page, region, line)
        page.evaluate("() => { window.__rampwrightProbe = 1 }")
        field = spin(page, "Mass (kg)")
        field.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("2.5")
        expect(region).to_contain_text("Potential energy: 49.05 J", timeout=POLL_MS * 4)
        expect(region).to_contain_text("Speed at bottom: 6.26 m/s")
        expect(region).to_contain_text("Time to bottom: 1.28 s")
        click(page.get_by_role("button", name="Material"))
        click(page.get_by_role("dialog", name="Material").get_by_role("radio", name="Rubber mat"))
        shows(page, region, "Speed at bottom: 0.00 m/s")
        shows(page, region, "Time to bottom: n/a")
        assert page.evaluate("() => window.__rampwrightProbe") == 1, "the page reloaded"
        page.goto(f"{app_url}/w/{b.wid}/s/{pend}")
        choose(page, "Pendulum 1")
        shows(page, readouts(page), "Period: 2.01 s")
        shows(page, readouts(page), "Speed at bottom: 1.09 m/s")
        page.goto(f"{app_url}/w/{b.wid}/s/{launch}")
        choose(page, "Launcher 1")
        for line in ("Time of flight: 0.94 s", "Range: 3.32 m", "Peak height: 1.64 m"):
            shows(page, readouts(page), line)


def test_wf_readouts_remote_typing(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "readout-co")
    set_gravity(b.owner, b.sid, 20)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        choose(page, "Ramp 1")
        field = spin(page, "Mass (kg)")
        field.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("1 lb")
        set_gravity(co, b.sid, GRAVITY)
        shows(page, readouts(page), "Potential energy: 6.67 J", LIVE_S)
        expect(field).to_have_value("1 lb")
        expect(field).to_be_focused()
        assert field.evaluate("e => [e.selectionStart, e.selectionEnd]") == [len("1 lb")] * 2


def test_wf_run_cut_bench_to_run(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    w, h = 1280, 800
    with open_editor(browser, app_url, b.owner, b.wid, b.sid, size=(w, h)) as page:
        scene = ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]
        soon(page, lambda: assert_pre(page, scene["stateHash"]), UI_S, "telemetry shows step 0 and the scene hash")
        card = page.get_by_role("group", name="Run telemetry")
        card_box = box(card)
        expect(pause_button(page)).to_be_disabled()
        expect(step_button(page)).to_be_disabled()
        expect(status(page, "Mode")).to_have_count(0) if status(page, "Mode").count() == 0 else expect(status(page, "Mode")).to_be_hidden()
        cam_before = camera(page)
        click(page.get_by_role("group", name="Camera view").get_by_role("button", name="Top"))
        soon(page, lambda: _assert_camera_moved(page, cam_before), UI_S, "Top turns the camera")
        stage(page).focus()
        page.keyboard.press("r")
        advance(page, ONE_FRAME_MS)
        expect(run_button(page)).to_have_text("Stop", timeout=POLL_MS)
        expect(pause_button(page)).to_be_enabled(timeout=POLL_MS)
        expect(step_button(page)).to_be_enabled(timeout=POLL_MS)
        expect(status(page, "Mode")).to_have_text("RUNNING", timeout=POLL_MS)
        for name in ("Outline", "Inspector", "Props", "Assets"):
            expect(page.get_by_role("region", name=name)).to_be_hidden(timeout=POLL_MS)
        expect(page.get_by_role("group", name="Camera view")).to_be_hidden(timeout=POLL_MS)
        mark = page.get_by_role("img", name="Centre mark")
        mb, pill = box(mark), box(status(page, "Mode"))
        assert abs(mb["x"] + mb["width"] / 2 - w / 2) <= 1 and abs(mb["y"] + mb["height"] / 2 - h / 2) <= 1, mb
        assert abs(pill["x"] + pill["width"] / 2 - w / 2) <= 1 and pill["y"] < h / 2, pill
        assert mark.evaluate("(el, p) => !el.contains(document.elementFromPoint(p[0], p[1]))", [w / 2, h / 2]), "the reticle takes the pointer"
        assert box(card) == pytest.approx(card_box, abs=1)
        advance(page, 1000)
        content = card.inner_text()
        assert re.search(r"fps \d+", content) and re.search(r"ms \d+\.\d", content), content
        page.keyboard.press("p")
        says(page, status(page, "Mode"), "PAUSED")
        expect(pause_button(page)).to_have_text("Resume")
        step, _ = telemetry(page)
        assert step > 0
        page.keyboard.press("n")
        soon(page, lambda: _assert_step(page, step + 1), UI_S, "N advances exactly one step")
        click(page.get_by_role("button", name="More telemetry"))
        shows(page, card, verify(b.owner, b.sid, step + 1))
        page.keyboard.press("Escape")
        soon(page, lambda: assert_pre(page, scene["stateHash"]), UI_S, "Escape stops and restores step 0")
        expect(run_button(page)).to_have_text("Run")


def assert_pre(page: Page, state_hash: str) -> None:
    assert telemetry(page) == (0, state_hash[:12]), f"telemetry {telemetry(page)}; expected step 0 and {state_hash[:12]}"


def _assert_camera_moved(page: Page, before: list[list[float]]) -> None:
    assert not cam_equal(camera(page), before), "camera matrices unchanged"


def test_fixed_step_hash(browser: Browser, app_url: str) -> None:
    b = Bench(app_url, "blank")
    ok(patch(b.owner, b.sid, [{"op": "add", "object": crate("crate-1", "Crate 1", [1, 2, 3])}]), 200)
    expected0 = sha(canonical({"objects": [{"id": "crate-1", "position": [1, 2, 3], "rotation": [0, 0, 0, 1], "velocity": [0, 0, 0]}], "step": 0}))
    assert ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["stateHash"] == expected0
    one, two = verify(b.owner, b.sid, 1), verify(b.owner, b.sid, 2)
    assert len({one, two, expected0}) == 3, "the crate does not move under gravity"
    assert verify(b.owner, b.sid, STEP_HZ) == verify(b.owner, b.sid, STEP_HZ)
    for bad in (0, MAX_STEPS + 1):
        fields = err(b.owner.post(f"/api/scenes/{b.sid}/verify", {"steps": bad}), 422, "validation")["fields"]
        assert fields == {"steps": "Steps must be from 1 to 12000."}
    verify(b.owner, b.sid, MAX_STEPS)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        soon(page, lambda: assert_pre(page, expected0), UI_S, "step-0 telemetry hash")
        stage(page).focus()
        page.keyboard.press("r")
        start = page.evaluate("() => performance.now()")
        advance(page, 1000)
        page.keyboard.press("p")
        end = page.evaluate("() => performance.now()")
        step, digest = telemetry(page)
        expected = (end - start) * STEP_HZ / 1000
        assert abs(step - expected) <= 3, f"{step} steps after {end - start} ms; expected about {expected} at 1/120 s per step"
        assert digest == verify(b.owner, b.sid, step)[:12]


def test_verifier_agreement(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    ok(patch(b.owner, b.sid, [{"op": "add", "object": crate("cart-1", "Cart 1", [-2, 0, 0], 1, [0.4, 0.3, 0.25])}]), 200)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        step, digest = run_and_step(page, 7)
        full = verify(b.owner, b.sid, step)
        assert digest == full[:12]
        click(page.get_by_role("button", name="More telemetry"))
        shows(page, page.get_by_role("group", name="Run telemetry"), full)
        click(pause_button(page))
        advance(page, 400)
        click(pause_button(page))
        later, later_hash = telemetry(page)
        assert later > step and later_hash == verify(b.owner, b.sid, later)[:12]
        click(run_button(page))
        set_gravity(b.owner, b.sid, 20)
        new_hash = ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["stateHash"]
        soon(page, lambda: assert_pre(page, new_hash), LIVE_S + 1, "telemetry shows the new revision")
        step, digest = run_and_step(page, 5)
        assert digest == verify(b.owner, b.sid, step)[:12]


def test_wf_run_cut_stop_restores(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        outline = page.get_by_role("region", name="Outline")
        ob = box(outline)
        page.mouse.move(ob["x"] + 20, ob["y"] + 6)
        page.mouse.down()
        page.mouse.move(ob["x"] + 140, ob["y"] + 66, steps=6)
        page.mouse.up()
        moved = box(outline)
        assert moved["x"] != ob["x"] or moved["y"] != ob["y"], "dragging the Outline header did not move it"
        panel_title = "Props"
        click(page.get_by_role("button", name="Close " + panel_title))
        soon(page, lambda: expect(page.get_by_role("region", name="Props")).to_be_hidden(timeout=POLL_MS), UI_S, "Props closed")
        boxes = {n: box(page.get_by_role("region", name=n)) for n in ("Outline", "Inspector", "Assets")}
        raw, rev = document(b.owner, b.sid)
        _, pre_hash = telemetry(page)
        choose(page, "Ramp 1")
        pre_x = spin(page, "Position X (m)").input_value()
        stage(page).focus()
        page.keyboard.press("r")
        advance(page, 800)
        click(run_button(page))
        for name, before in boxes.items():
            assert box(page.get_by_role("region", name=name)) == pytest.approx(before, abs=1), f"{name} moved after Stop"
        expect(page.get_by_role("region", name="Props")).to_be_hidden()
        assert telemetry(page) == (0, pre_hash)
        expect(spin(page, "Position X (m)")).to_have_value(pre_x)
        advance(page, 3000)
        assert document(b.owner, b.sid) == (raw, rev), "a run saved the scene"
        click(page.get_by_role("button", name="Windows"))
        click(page.get_by_role("menu", name="Windows").get_by_role("menuitemcheckbox", name="Props"))
        visible(page, page.get_by_role("region", name="Props"))


def test_wf_run_cut_phone_touch(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    ok(patch(b.owner, b.sid, [{"op": "add", "object": crate("cart-1", "Cart 1", [-2, 0, 0], 1, [0.4, 0.3, 0.25])}]), 200)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as desk:
        desk_step, desk_hash = run_and_step(desk, 6)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid, size=(390, 844), reduced_motion="reduce") as phone:
        session(phone).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        for control in (run_button(phone), pause_button(phone), step_button(phone)):
            control.scroll_into_view_if_needed()
        phone_step, phone_hash = run_and_step(phone, 6, touch=True)
        layout(phone)
    full = verify(b.owner, b.sid, desk_step)
    assert desk_step == phone_step and desk_hash == phone_hash == full[:12], (desk_step, desk_hash, phone_step, phone_hash, full)


def test_patch_replay_and_conflicts(app_url: str) -> None:
    b = Bench(app_url)
    change = str(uuid.uuid4())
    first = ok(patch(b.owner, b.sid, [scene_op("gravity", 20)], base=1, change=change), 200)
    assert first["revision"] == 2
    assert ok(patch(b.owner, b.sid, [scene_op("gravity", 20)], base=1, change=change), 200) == first
    assert document(b.owner, b.sid)[1] == 2
    err(patch(b.owner, b.sid, [scene_op("gravity", 30)], base=1, change=change), 409, "change_id_reused")
    f = fence(b.owner, b.sid, "ramp-1")
    assert ok(patch(b.owner, b.sid, [set_op("ramp-1", f, "params.mass_kg", 2)], base=1), 200)["revision"] == 3
    conflict = err(patch(b.owner, b.sid, [scene_op("gravity", 30)], base=1), 412, "revision_conflict")
    assert conflict["details"] == {"currentRevision": 3, "conflicts": ["scene.gravity"]}
    assert document(b.owner, b.sid)[1] == 3 and doc(b.owner, b.sid)["gravity"] == 20
    assert ok(patch(b.owner, b.sid, [{"op": "add", "object": crate("crate-x", "Crate X", [1, 0, 1])}], base=1), 200)["revision"] == 4
    stale = err(patch(b.owner, b.sid, [set_op("ramp-1", f + 5, "params.mass_kg", 3)]), 409, "stale_lock")
    assert stale["details"] == {"objectId": "ramp-1"}
    cf = fence(b.owner, b.sid, "crate-x")
    ok(patch(b.owner, b.sid, [{"op": "remove", "objectId": "crate-x", "fence": cf}]), 200)
    removed = err(patch(b.owner, b.sid, [set_op("crate-x", cf, "name", "Back")], base=4), 412, "revision_conflict")
    assert REMOVED_KEY in removed["details"]["conflicts"]
    err(patch(b.owner, b.sid, [set_op("ghost-1", 1, "name", "Ghost")]), 404, "not_found")
    cp = checkpoint(b.owner, b.sid, f"Before class {tag()}")
    pre = document(b.owner, b.sid)[1]
    restored = ok(b.owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 200)["revision"]
    barrier = err(patch(b.owner, b.sid, [scene_op("name", f"Renamed {tag()}")], base=pre), 412, "revision_conflict")
    assert barrier["details"]["conflicts"] == ["scene.name"]
    assert document(b.owner, b.sid)[1] == restored
    ok(patch(b.owner, b.sid, [scene_op("name", f"Renamed {tag()}")], base=restored), 200)
    assert sum(e["action"] == "scene.edited" for e in events(b.owner, b.wid)) == 5


def test_concurrent_patch_one_wins(app_url: str) -> None:
    b = Bench(app_url)
    gate = threading.Barrier(PATCH_RACE)

    def attempt(i: int) -> httpx.Response:
        gate.wait(timeout=HTTP_TIMEOUT)
        return patch(b.owner, b.sid, [scene_op("gravity", 20 + i)], base=1)
    with ThreadPoolExecutor(PATCH_RACE) as pool:
        answers = list(pool.map(attempt, range(PATCH_RACE)))
    codes = [r.status_code for r in answers]
    assert codes.count(200) == 1 and codes.count(412) == PATCH_RACE - 1, codes
    for r in answers:
        if r.status_code == 412:
            err(r, 412, "revision_conflict")
    assert document(b.owner, b.sid)[1] == 2


def test_wf_autosave_conflict_offline(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        gravity = spin(page, "Gravity (m/s²)")
        visible(page, gravity)
        with held(page, f"**/api/scenes/{b.sid}") as gate:
            fill(gravity, "20")
            page.keyboard.press("Tab")
            says(page, status(page, "Save status"), "Saving...")
            gate.release()
        says(page, status(page, "Save status"), "All changes saved")
        rev = document(b.owner, b.sid)[1]
        page.context.set_offline(True)
        for value in ("30", "9.81"):
            fill(gravity, value)
            page.keyboard.press("Tab")
        says(page, status(page, "Save status"), "Offline: changes will save when you reconnect.")
        assert document(b.owner, b.sid)[1] == rev
        page.context.set_offline(False)
        says(page, status(page, "Save status"), "All changes saved", SAVE_S)
        final = doc_until(page, b.owner, b.sid, lambda _d, r: r == rev + 2, "two queued changes saved")
        assert final["gravity"] == GRAVITY


def test_wf_autosave_conflict_dialog(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "conflict-co")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        gravity = spin(page, "Gravity (m/s²)")
        visible(page, gravity)
        dialog = page.get_by_role("alertdialog", name="Scene changed elsewhere")
        for mine, theirs, choice in (("20", 30, "Keep my changes"), (str(GRAVITY), 30, "Use their version")):
            with held(page, f"**/api/scenes/{b.sid}") as gate:
                fill(gravity, mine)
                page.keyboard.press("Tab")
                says(page, status(page, "Save status"), "Saving...")
                set_gravity(co, b.sid, theirs if choice == "Use their version" else theirs - 1)
                gate.release()
            visible(page, dialog)
            says(page, status(page, "Save status"), "Not saved: this scene changed elsewhere")
            rev = document(b.owner, b.sid)[1]
            advance(page, (LOCK_TTL_DEFAULT // 3 + 2) * 1000)
            expect(dialog).to_be_visible()
            assert document(b.owner, b.sid)[1] == rev, "autosave retried while the dialog was open"
            for _ in range(4):
                page.keyboard.press("Tab")
                assert inside(dialog)
            click(dialog.get_by_role("button", name=choice))
            soon(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS), UI_S, "choice closes the dialog")
            if choice == "Keep my changes":
                doc_until(page, b.owner, b.sid, lambda d, _r: d["gravity"] == float(mine), "my change saved over theirs")
            else:
                expect(gravity).to_have_value(str(theirs))
                advance(page, 2000)
                assert doc(b.owner, b.sid)["gravity"] == theirs


def test_lock_lease_rules(app_url: str, mail: Any, valkey: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "lease-co")
    tabs = [f"tab-{uuid.uuid4().hex[:12]}" for _ in range(LOCK_RACE)]
    gate = threading.Barrier(LOCK_RACE)

    def attempt(tab_id: str) -> httpx.Response:
        gate.wait(timeout=HTTP_TIMEOUT)
        return lock(b.owner, b.sid, "ramp-1", tab_id)
    with ThreadPoolExecutor(LOCK_RACE) as pool:
        answers = list(pool.map(attempt, tabs))
    winners = [(t, r) for t, r in zip(tabs, answers) if r.status_code == 200]
    assert len(winners) == 1, [r.status_code for r in answers]
    for r in answers:
        if r.status_code != 200:
            holder = err(r, 409, "lock_held")["details"]["holder"]
            assert holder == {"userId": b.owner.uid, "displayName": b.owner.name}
    tab_id, granted = winners[0]
    lease = granted.json()["lock"]
    stored = json.loads(valkey.command("GET", f"rw:lock:{b.sid}:ramp-1"))
    assert stored["fence"] == lease["fence"] and stored["tab"] == tab_id and stored["userId"] == b.owner.uid
    assert 0 < valkey.ttl(f"rw:lock:{b.sid}:ramp-1") <= LOCK_TTL_DEFAULT
    assert int(valkey.command("GET", f"rw:fence:{b.sid}:ramp-1")) == lease["fence"]
    renewed = ok(lock(b.owner, b.sid, "ramp-1", tab_id), 200)["lock"]
    assert renewed["fence"] == lease["fence"] and stamp(renewed["expiresAt"]) >= stamp(lease["expiresAt"])
    held_err = err(lock(co, b.sid, "ramp-1"), 409, "lock_held")
    assert held_err["details"]["holder"]["userId"] == b.owner.uid and "expiresAt" in held_err["details"]
    err(co.delete(f"/api/scenes/{b.sid}/locks/ramp-1"), 409, "lock_held")
    unlock(b.owner, b.sid, "ramp-1")
    unlock(b.owner, b.sid, "ramp-1")
    assert valkey.command("GET", f"rw:lock:{b.sid}:ramp-1") is None
    assert fence(co, b.sid, "ramp-1") == lease["fence"] + 1
    err(lock(co, b.sid, "ghost-1"), 404, "not_found")


def test_lock_release_on_tab_close(app_url: str, valkey: Any) -> None:
    b = Bench(app_url)
    for _ in range(ABANDONED_STREAMS):
        tab_id = f"tab-{uuid.uuid4().hex[:12]}"
        with b.owner.http.stream("GET", f"/api/scenes/{b.sid}/live", params={"tab": tab_id}) as live:
            assert live.status_code == 200 and live.headers["content-type"].startswith("text/event-stream")
            fence(b.owner, b.sid, "ramp-1", tab_id)
        wait_api(lambda: (not [l for l in locks(b.owner, b.sid) if l["objectId"] == "ramp-1"]
                          and valkey.command("GET", f"rw:lock:{b.sid}:ramp-1") is None) or pytest.fail("lease still held"),
                 TAB_RELEASE_S, "lease released when its tab's live channel ended")
    observer = Postgres()

    def idle() -> None:
        rows = observer.rows("SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() "
                             "AND usename <> current_user AND state IN ('active', 'idle in transaction')")
        assert rows[0]["n"] == 0, f"{rows[0]['n']} app sessions still active or idle in transaction"
    wait_api(idle, TAB_RELEASE_S * 2, "abandoned streams released their database work")
    ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)
    ok(httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT), 200)


def test_lock_expiry_fencing(mail: Any) -> None:
    base = outage("APP_SHORT_URL")
    b = Bench(base)
    co = add_member(b.owner, b.wid, "editor", mail, "fence-co")
    first = fence(b.owner, b.sid, "ramp-1")
    ok(patch(b.owner, b.sid, [set_op("ramp-1", first, "params.mass_kg", 2)]), 200)
    wait_api(lambda: not [l for l in locks(b.owner, b.sid) if l["objectId"] == "ramp-1"] or pytest.fail("lease live"),
             SHORT_LOCK_TTL + CLOCK_SKEW_S + 2, "lease expires after LOCK_TTL_SECONDS")
    rev = document(b.owner, b.sid)[1]
    assert err(patch(b.owner, b.sid, [set_op("ramp-1", first, "params.mass_kg", 3)]), 409, "stale_lock")["details"] == {"objectId": "ramp-1"}
    second = fence(co, b.sid, "ramp-1")
    assert second == first + 1
    err(patch(b.owner, b.sid, [scene_op("gravity", 20), set_op("ramp-1", first, "params.mass_kg", 3)]), 409, "stale_lock")
    err(patch(b.owner, b.sid, [set_op("ramp-1", second, "params.mass_kg", 3)]), 409, "stale_lock")
    err(patch(b.owner, b.sid, [{"op": "remove", "objectId": "ramp-1", "fence": first}]), 409, "stale_lock")
    after = doc(b.owner, b.sid)
    assert document(b.owner, b.sid)[1] == rev and after["gravity"] == GRAVITY and obj(after, "ramp-1")["params"]["mass_kg"] == 2
    ok(patch(co, b.sid, [set_op("ramp-1", second, "params.mass_kg", 2.5)]), 200)
    assert obj(doc(b.owner, b.sid), "ramp-1")["params"]["mass_kg"] == 2.5


def test_wf_locks_presence_lock_held(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "held-co")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as owner_page, \
            open_editor(browser, app_url, co, b.wid, b.sid) as page:
        choose(owner_page, "Ramp 1")
        holder_is(owner_page, b.owner, b.sid, "ramp-1", b.owner.uid)
        choose(page, "Ramp 1")
        notice = f"{b.owner.name} is editing Ramp 1. You can view it but cannot change it until they finish."
        says(page, status(page, "Lock notice"), notice)
        no_editable_fields(page.get_by_role("region", name="Inspector"))
        heard: list[str] = []
        stage(owner_page).focus()
        owner_page.keyboard.press("Escape")

        def free_then_mine() -> None:
            heard.append(status(page, "Collaboration").inner_text())
            current = [l["holder"]["userId"] for l in locks(b.owner, b.sid) if l["objectId"] == "ramp-1"]
            assert current == [co.uid], f"lease holder {current}"
        soon(page, free_then_mine, UI_S, "co-tutor takes the freed lease", owner_page)
        assert "Ramp 1 is free to edit" in heard or soon_text(page, "Ramp 1 is free to edit"), heard
        mass = spin(page, "Mass (kg)")
        soon(page, lambda: expect(mass).to_be_editable(timeout=POLL_MS), UI_S, "fields become editable")
        fill(mass, "2.5")
        page.keyboard.press("Tab")
        doc_until(page, b.owner, b.sid, lambda d, _r: obj(d, "ramp-1")["params"]["mass_kg"] == 2.5, "co-tutor edit saved")


def soon_text(page: Page, value: str) -> bool:
    return value in status(page, "Collaboration").inner_text()


def test_wf_locks_presence_people(browser: Browser, app_url: str, mail: Any, valkey: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "people-co")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as owner_page:
        collab = status(owner_page, "Collaboration")
        heard: list[str] = []
        with open_editor(browser, app_url, co, b.wid, b.sid) as page:
            people = owner_page.get_by_role("list", name="People here")

            def joined() -> None:
                heard.append(collab.inner_text())
                expect(people).to_contain_text(co.name, timeout=POLL_MS)
            soon(owner_page, joined, PRESENCE_S + 1, "co-tutor listed in People here", page)
            shows(page, page.get_by_role("list", name="People here"), b.owner.name, PRESENCE_S + 1, owner_page)
            assert valkey.keys(f"rw:presence:{b.sid}:{co.uid}:*"), "no Valkey presence key for the co-tutor"
            sb = box(stage(page))
            page.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
            advance(page, PRESENCE_S * 1000)
            visible(owner_page, owner_page.get_by_role("img", name=f"Cursor: {co.name}"), PRESENCE_S + 1)
            ob = box(stage(owner_page))
            cb = box(owner_page.get_by_role("img", name=f"Cursor: {co.name}"))
            assert ob["x"] <= cb["x"] <= ob["x"] + ob["width"] and ob["y"] <= cb["y"] <= ob["y"] + ob["height"]
            expect(page.get_by_role("img", name=f"Cursor: {co.name}")).to_have_count(0)
            choose(page, "Ramp 1")
            soon(owner_page, lambda: heard.append(collab.inner_text()) or _contains(heard, f"{co.name} is now editing Ramp 1"), PRESENCE_S + 1, "lock change announced", page)
        soon(owner_page, lambda: heard.append(collab.inner_text()) or _contains(heard, f"{co.name} left the scene"), TAB_RELEASE_S + 1, "leave announced")
        expect(owner_page.get_by_role("list", name="People here")).not_to_contain_text(co.name)
        assert f"{co.name} joined the scene" in heard, heard
        wait_api(lambda: not valkey.keys(f"rw:presence:{b.sid}:{co.uid}:*") or pytest.fail("presence kept"), TAB_RELEASE_S, "presence removed when the tab closed")


def _contains(heard: list[str], value: str) -> None:
    assert value in heard, f"Collaboration announced {heard[-3:]}; expected {value!r}"


@pytest.mark.timeout(1200)
def test_wf_locks_presence_outage(browser: Browser, app_url: str) -> None:
    down = outage("APP_VALKEY_DOWN_URL")
    ok(httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT), 200)
    b = Bench(down)
    wait_api(lambda: ok(b.owner.get("/api/status"), 200)["locks"] == "down" or pytest.fail("locks not down"), STATUS_FRESH_S + 1, "status reports locks down")
    err(lock(b.owner, b.sid, "ramp-1"), 503, "lock_store_unavailable")
    err(patch(b.owner, b.sid, [scene_op("gravity", 20)]), 503, "lock_store_unavailable")
    assert document(b.owner, b.sid)[1] == 1
    verify(b.owner, b.sid, 10)
    with open_editor(browser, down, b.owner, b.wid, b.sid) as page:
        banner = page.get_by_role("alert").filter(has_text="Live editing is paused because the lock service is unreachable. You can still run the scene.")
        visible(page, banner, BANNER_S + 1)
        says(page, status(page, "Save status"), "Not saved: live editing is paused")
        visible(page, page.get_by_text("Presence unavailable", exact=True))
        no_editable_fields(page)
        stage(page).focus()
        page.keyboard.press("r")
        says(page, status(page, "Mode"), "RUNNING")
        advance(page, 500)
        assert telemetry(page)[0] > 0
    relay = Relay(service_target(os.environ["VALKEY_URL"], 6379))
    with app_copy(VALKEY_URL=relay_url(os.environ["VALKEY_URL"], relay.port)) as copy:
        owner = sign_in(copy, b.owner.email)
        primary = Bench(app_url)
        primary_owner = sign_in(copy, primary.owner.email)
        wait_api(lambda: ok(owner.get("/api/status"), 200)["locks"] == "down" or pytest.fail("locks not down"), STATUS_FRESH_S + 1, "copy reports locks down")
        err(lock(primary_owner, primary.sid, "ramp-1"), 503, "lock_store_unavailable")
        relay.start()
        try:
            def recovered() -> None:
                assert ok(owner.get("/api/status"), 200)["locks"] == "ok"
                assert lock(primary_owner, primary.sid, "ramp-1").status_code == 200
            wait_api(recovered, LOCK_RECOVERY_S, "edits accepted again after Valkey returns")
            unlock(primary_owner, primary.sid, "ramp-1")
        finally:
            relay.stop()


@pytest.mark.parametrize("case", UPLOAD_IDS, ids=UPLOAD_IDS)
def test_upload_type_checks(app_url: str, case: str) -> None:
    name, kind, code, expected = UPLOAD_CASES[case]
    b = Bench(app_url)
    data = sample_bytes(kind, tag())
    resp = upload(b.owner, b.pid, data, name)
    assets, count = project_assets(b.owner, b.pid)
    keys = S3().keys(f"assets/{b.pid}/")
    if code == 201:
        asset = ok(resp, 201)["asset"]
        assert asset["kind"] == expected and asset["bytes"] == len(data) and asset["sha256"] == sha(data)
        assert count == 1 and keys == [f"assets/{b.pid}/{sha(data)}"]
    elif code == 413:
        error = err(resp, 413, "payload_too_large")
        assert error["message"] == expected and "fields" not in error
        assert count == 0 and assets == [] and keys == []
    else:
        assert err(resp, 422, "validation")["fields"] == {"file": expected}
        assert count == 0 and assets == [] and keys == []


@pytest.mark.parametrize("case", REF_IDS, ids=REF_IDS)
def test_upload_refs_and_names(app_url: str, case: str) -> None:
    name, kind, field, copy = REF_CASES[case]
    b = Bench(app_url)
    data = sample_bytes(kind, tag())
    assert err(upload(b.owner, b.pid, data, name), 422, "validation")["fields"] == {field: copy}
    assets, count = project_assets(b.owner, b.pid)
    assert assets == [] and count == 0 and S3().keys(f"assets/{b.pid}/") == []


@pytest.mark.parametrize("case", EXTENT_IDS, ids=EXTENT_IDS)
def test_extent_rule(app_url: str, case: str) -> None:
    spec = EXTENT_CASES[case]
    b = Bench(app_url)
    build = glb_bytes if spec.get("glb") else gltf_bytes
    data = build(half=spec["half"], nodes=spec.get("nodes"), scenes=spec.get("scenes"), scene=spec.get("scene"), label=tag())
    resp = upload(b.owner, b.pid, data, f"model-{case}.{'glb' if spec.get('glb') else 'gltf'}", spec["unit"])
    if "error" in spec:
        key, copy = spec["error"]
        assert err(resp, 422, "validation")["fields"] == {key: copy}
        assert project_assets(b.owner, b.pid)[1] == 0 and S3().keys(f"assets/{b.pid}/") == []
        return
    asset = ok(resp, 201)["asset"]
    factor = UNIT_FACTORS[spec["unit"]]
    expected = spec.get("metres", spec.get("span", 0) * factor)
    assert asset["unit"] == spec["unit"] and asset["scaleToMetres"] == pytest.approx(factor)
    assert asset["extentMetres"] == pytest.approx(expected, abs=MILLIONTH), asset


def test_asset_stored_byte_exact(app_url: str) -> None:
    b = Bench(app_url)
    samples = {"glb": ("cube.glb", "model/gltf-binary"), "gltf": ("cube.gltf", "model/gltf+json"),
               "png": ("tile.png", "image/png"), "jpeg": ("photo.jpg", "image/jpeg")}
    stored: dict[str, dict[str, Any]] = {}
    for kind, (name, content_type) in samples.items():
        data = sample_bytes(kind, tag())
        asset = ok(upload(b.owner, b.pid, data, name, "cm"), 201)["asset"]
        assert asset["sha256"] == sha(data)
        assert S3().get(f"assets/{b.pid}/{sha(data)}") == data
        original = b.owner.get(f"/api/assets/{asset['id']}/original")
        ok(original, 200)
        assert original.content == data and original.headers["content-type"].startswith(content_type)
        assert original.headers["etag"] == f'"{sha(data)}"'
        if kind in ("png", "jpeg"):
            assert asset["unit"] is None and asset["scaleToMetres"] is None and asset["extentMetres"] is None
        stored[kind] = {"asset": asset, "data": data}
    replay = ok(upload(b.owner, b.pid, stored["glb"]["data"], "other.glb", "m"), 200)["asset"]
    assert replay == stored["glb"]["asset"], "a replay changed the asset"
    assert project_assets(b.owner, b.pid)[1] == len(samples)
    assert sum(e["action"] == "asset.uploaded" for e in events(b.owner, b.wid)) == len(samples)


@pytest.mark.timeout(1200)
def test_storage_outage_recovery(app_url: str) -> None:
    down = outage("APP_MINIO_DOWN_URL")
    b = Bench(app_url)
    owner = sign_in(down, b.owner.email)
    cp = checkpoint(b.owner, b.sid, "Before class")
    lab = publish(b.owner, b.sid, cp["id"], EXPOSED)["lab"]
    rev = document(b.owner, b.sid)[1]
    data = png_bytes(tag())
    err(upload(owner, b.pid, data, "tile.png"), 503, "storage_unavailable")
    err(owner.post(f"/api/scenes/{b.sid}/checkpoints", {"label": f"Later {tag()}"}), 503, "storage_unavailable")
    err(owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 503, "storage_unavailable")
    err(owner.post(f"/api/scenes/{b.sid}/publish", {"checkpointId": cp["id"], "exposed": EXPOSED}), 503, "storage_unavailable")
    err(httpx.get(f"{down}/api/labs/{lab['token']}", timeout=HTTP_TIMEOUT), 503, "storage_unavailable")
    wait_api(lambda: ok(owner.get("/api/status"), 200)["storage"] == "down" or pytest.fail("storage not down"), STATUS_FRESH_S + 1, "status storage down")
    assert project_assets(b.owner, b.pid)[1] == 0 and S3().keys(f"assets/{b.pid}/") == []
    assert len(ok(b.owner.get(f"/api/scenes/{b.sid}/checkpoints"), 200)["checkpoints"]) == 1
    scene = ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]
    assert scene["revision"] == rev and scene["lab"]["bundleHash"] == lab["bundleHash"]
    relay = Relay(service_target(os.environ["S3_ENDPOINT"], 80))
    with app_copy(S3_ENDPOINT=relay_url(os.environ["S3_ENDPOINT"], relay.port)) as copy:
        copy_owner = sign_in(copy, b.owner.email)
        err(upload(copy_owner, b.pid, data, "tile.png"), 503, "storage_unavailable")
        relay.start()
        try:
            ok(upload(copy_owner, b.pid, data, "tile.png"), 201)
            assert S3().get(f"assets/{b.pid}/{sha(data)}") == data
        finally:
            relay.stop()


def test_wf_assets_storage_outage(browser: Browser, app_url: str) -> None:
    down = outage("APP_MINIO_DOWN_URL")
    b, _cp, lab = published_lab(app_url)
    with open_editor(browser, down, b.owner, b.wid, b.sid) as page:
        visible(page, page.get_by_role("alert").filter(has_text="File storage is unreachable. Uploads, checkpoints and publishing are paused."), BANNER_S + 1)
        assets = page.get_by_role("region", name="Assets")
        with page.expect_file_chooser() as chooser:
            click(assets.get_by_role("button", name="Upload"))
        chooser.value.set_files(files=[{"name": "tile.png", "mimeType": "image/png", "buffer": png_bytes(tag())}])
        says(page, status(page, "Upload status"), "File storage is unreachable. Nothing was uploaded.")
        page.goto(f"{down}/lab/{lab['token']}")
        visible(page, page.get_by_role("heading", name="This lab cannot load right now"))
        visible(page, page.get_by_text("Try again in a minute.", exact=True))
    assert project_assets(b.owner, b.pid)[1] == 0


def test_wf_assets_browser(browser: Browser, app_url: str) -> None:
    b = Bench(app_url, "blank")
    stem = f"bench-cube-{tag()}"
    model_name, image_name = f"{stem}.glb", f"chart-{tag()}.png"
    half = 25
    model = glb_bytes(half=half, label=stem)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        assets = page.get_by_role("region", name="Assets")
        click(assets.get_by_role("tab", name="Files"))
        folders = assets.get_by_role("tree", name="Folders")
        click(folders.get_by_role("treeitem", name="Models"))
        shows(page, assets, "This folder is empty. Drop a GLB, glTF, PNG or JPEG file here.")
        select(assets.get_by_role("combobox", name="Model units"), "cm")
        with held(page, f"**/api/projects/{b.pid}/assets*") as gate:
            with page.expect_file_chooser() as chooser:
                click(assets.get_by_role("button", name="Upload"))
            chooser.value.set_files(files=[{"name": model_name, "mimeType": "model/gltf-binary", "buffer": model}])
            says(page, status(page, "Upload status"), f"Uploading {model_name}...")
            gate.release()
        says(page, status(page, "Upload status"), f"{model_name} added to Models")
        contents = assets.get_by_role("list", name="Folder contents").get_by_role("listitem")
        item = contents.filter(has_text=model_name)
        shows(page, item, f"{2 * half * UNIT_FACTORS['cm']:.2f} m")
        shows(page, assets, "Assets / Models")
        with page.expect_file_chooser() as chooser:
            click(assets.get_by_role("button", name="Upload"))
        chooser.value.set_files(files=[{"name": image_name, "mimeType": "image/png", "buffer": png_bytes(image_name)}])
        says(page, status(page, "Upload status"), f"{image_name} added to Images")
        shows(page, assets, "Assets / Images")
        visible(page, contents.filter(has_text=image_name))
        click(folders.get_by_role("treeitem", name="Models"))
        fill(assets.get_by_role("searchbox", name="Filter assets"), "zz-no-match")
        soon(page, lambda: expect(item).to_have_count(0, timeout=POLL_MS), UI_S, "filter hides the model")
        fill(assets.get_by_role("searchbox", name="Filter assets"), stem)
        visible(page, item)
        click(assets.get_by_role("button", name="List view"))
        expect(assets.get_by_role("button", name="List view")).to_have_attribute("aria-pressed", "true")
        expect(assets.get_by_role("slider", name="Thumbnail size")).to_be_visible()
        props = page.get_by_role("region", name="Props")
        click(props.get_by_role("tab", name="Models"))
        tile = props.get_by_role("button", name=re.compile(r"^Add " + re.escape(stem)))
        sb = box(stage(page))
        tile.drag_to(stage(page), target_position={"x": sb["width"] / 2, "y": sb["height"] / 2 - 80})
        visible(page, row(page, stem))
        asset_id = project_assets(b.owner, b.pid)[0]
        aid = next(a["id"] for a in asset_id if a["name"] == model_name)
        placed = doc_until(page, b.owner, b.sid, lambda d, _r: named(d, stem) is not None, "model placed and saved")
        model_obj = named(placed, stem)
        assert model_obj["kind"] == "model" and model_obj["assetId"] == aid and model_obj["params"] == {}
        assert model_obj["scale"] == pytest.approx([UNIT_FACTORS["cm"]] * 3)
        with page.expect_file_chooser() as chooser:
            click(assets.get_by_role("button", name="Upload"))
        chooser.value.set_files(files=[{"name": model_name, "mimeType": "model/gltf-binary", "buffer": model}])
        says(page, status(page, "Upload status"), f"{model_name} is already in this project")
    assert S3().get(f"assets/{b.pid}/{sha(model)}") == model
    assert project_assets(b.owner, b.pid)[1] == 2


def test_wf_assets_rejected_upload(browser: Browser, app_url: str) -> None:
    b = Bench(app_url, "blank")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        assets = page.get_by_role("region", name="Assets")
        for name, data, copy in (("diagram.svg", SVG, TYPE_COPY), ("cube..glb", glb_bytes(label=tag()), NAME_COPY)):
            with page.expect_file_chooser() as chooser:
                click(assets.get_by_role("button", name="Upload"))
            chooser.value.set_files(files=[{"name": name, "mimeType": "application/octet-stream", "buffer": data}])
            says(page, status(page, "Upload status"), copy)
    assert project_assets(b.owner, b.pid) == ([], 0) and S3().keys(f"assets/{b.pid}/") == []


def test_checkpoint_snapshot(app_url: str) -> None:
    b = Bench(app_url)
    raw, rev = document(b.owner, b.sid)
    scene = ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]
    cp = checkpoint(b.owner, b.sid, "Before class")
    assert cp["revision"] == rev and cp["documentSha256"] == sha(raw) and cp["stateHash"] == scene["stateHash"]
    assert TIMESTAMP.match(cp["createdAt"])
    assert S3().get(f"checkpoints/{b.sid}/{cp['id']}.json") == raw
    snap = b.owner.get(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/document")
    assert ok(snap, 200) is not None and snap.content == raw
    assert ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["status"] == "checkpointed"
    set_gravity(b.owner, b.sid, 20)
    later = checkpoint(b.owner, b.sid, f"After {tag()}")
    assert S3().get(f"checkpoints/{b.sid}/{later['id']}.json") == document(b.owner, b.sid)[0]
    assert [c["id"] for c in ok(b.owner.get(f"/api/scenes/{b.sid}/checkpoints"), 200)["checkpoints"]] == [later["id"], cp["id"]]
    assert ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["status"] == "checkpointed"
    assert err(b.owner.post(f"/api/scenes/{b.sid}/checkpoints", {"label": ""}), 422, "validation")["fields"] == {"label": NAMES_COPY}
    assert len(ok(b.owner.get(f"/api/scenes/{b.sid}/checkpoints"), 200)["checkpoints"]) == 2


def test_restore_byte_exact(app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "restore-co")
    snapshot, _ = document(b.owner, b.sid)
    cp = checkpoint(b.owner, b.sid, "Before class")
    set_gravity(b.owner, b.sid, 20)
    set_field(b.owner, b.sid, "ramp-1", "position", [2.5, 0, 0])
    verify(b.owner, b.sid, STEP_HZ)
    _, current = document(b.owner, b.sid)
    ok(lock(co, b.sid, "ramp-1"), 200)
    holders = err(b.owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 409, "locks_held")["details"]["holders"]
    assert holders == [{"userId": co.uid, "displayName": co.name}]
    assert document(b.owner, b.sid)[1] == current
    unlock(co, b.sid, "ramp-1")
    ok(lock(b.owner, b.sid, "ramp-1"), 200)
    body = ok(b.owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 200)
    assert body["revision"] == current + 1 and body["stateHash"] == cp["stateHash"]
    assert document(b.owner, b.sid) == (snapshot, current + 1)
    assert ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["stateHash"] == cp["stateHash"]
    verify(b.owner, b.sid, STEP_HZ)
    again = ok(b.owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 200)
    assert document(b.owner, b.sid) == (snapshot, current + 2) and again["revision"] == current + 2


def test_wf_checkpoints_journey(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        assets = page.get_by_role("region", name="Assets")
        click(assets.get_by_role("tab", name="Checkpoints"))
        shows(page, assets, "No checkpoints yet.")
        click(assets.get_by_role("button", name="New checkpoint"))
        fill(assets.get_by_role("textbox", name="Checkpoint name"), "Before class")
        click(assets.get_by_role("button", name="Save checkpoint"))
        says(page, status(page, "Notices"), "Checkpoint Before class saved")
        cps = ok(b.owner.get(f"/api/scenes/{b.sid}/checkpoints"), 200)["checkpoints"]
        assert [c["label"] for c in cps] == ["Before class"]
        snapshot = S3().get(f"checkpoints/{b.sid}/{cps[0]['id']}.json")
        choose(page, "Ramp 1")
        stage(page).focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        doc_until(page, b.owner, b.sid, lambda _d, r: r >= 3, "nudges saved")
        page.keyboard.press("r")
        advance(page, 500)
        page.keyboard.press("r")
        click(assets.get_by_role("button", name="Restore Before class"))
        confirm = page.get_by_role("alertdialog", name="Restore checkpoint")
        visible(page, confirm)
        click(confirm.get_by_role("button", name="Restore"))
        says(page, status(page, "Save status"), "Restored checkpoint Before class")
        assert document(b.owner, b.sid)[0] == snapshot
        visible(page, row(page, "Ramp 1"))
        choose(page, "Ramp 1")
        soon(page, lambda: expect(spin(page, "Position X (m)")).to_have_value("0", timeout=POLL_MS), UI_S, "inspector shows the restored position")
        soon(page, lambda: assert_pre(page, cps[0]["stateHash"]), UI_S, "telemetry hash returns to the checkpoint")


def test_wf_checkpoints_restore_barrier(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "barrier-co")
    cp = checkpoint(b.owner, b.sid, "Before class")
    snapshot = S3().get(f"checkpoints/{b.sid}/{cp['id']}.json")
    set_gravity(b.owner, b.sid, 20)
    with open_editor(browser, app_url, co, b.wid, b.sid) as page:
        gravity = spin(page, "Gravity (m/s²)")
        soon(page, lambda: expect(gravity).to_have_value("20", timeout=POLL_MS), UI_S, "co-tutor sees gravity 20")
        ok(b.owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 200)
        soon(page, lambda: expect(gravity).to_have_value(str(GRAVITY), timeout=POLL_MS), LIVE_S, "restored scene shown")
        with held(page, f"**/api/scenes/{b.sid}") as gate:
            fill(gravity, "30")
            page.keyboard.press("Tab")
            says(page, status(page, "Save status"), "Saving...")
            ok(b.owner.post(f"/api/scenes/{b.sid}/checkpoints/{cp['id']}/restore", {}), 200)
            gate.release()
        visible(page, page.get_by_role("alertdialog", name="Scene changed elsewhere"))
        assert document(b.owner, b.sid)[0] == snapshot, "a stale save overwrote the restore"
    dup = err(b.owner.post(f"/api/scenes/{b.sid}/checkpoints", {"label": "  before CLASS "}), 409, "checkpoint_name_taken")
    assert dup["fields"] == {"label": "A checkpoint with this name already exists."}
    assert len(ok(b.owner.get(f"/api/scenes/{b.sid}/checkpoints"), 200)["checkpoints"]) == 1


def test_wf_publish_lifecycle(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    extra = [{"op": "add", "object": crate(f"crate-{i}", f"Crate {i}", [i, 0, 2])} for i in range(1, 6)]
    ok(patch(b.owner, b.sid, extra), 200)
    err(b.owner.post(f"/api/scenes/{b.sid}/publish", {"checkpointId": "nosuchcheckpoint", "exposed": []}), 409, "no_checkpoint")
    err(b.owner.post(f"/api/scenes/{b.sid}/unpublish", {}), 409, "not_published")
    err(b.owner.post(f"/api/scenes/{b.sid}/lab-link/regenerate", {}), 409, "not_published")
    cp = checkpoint(b.owner, b.sid, "Before class")
    nine = ["ramp-1.mass_kg", "ramp-1.angle_deg", "ramp-1.length_m", "ramp-1.friction"] + [f"crate-{i}.mass_kg" for i in range(1, 6)]
    assert len(nine) == EXPOSED_MAX + 1
    assert err(b.owner.post(f"/api/scenes/{b.sid}/publish", {"checkpointId": cp["id"], "exposed": nine}), 422, "validation")["fields"] == {"exposed": "Choose up to 8 parameters from this scene."}
    assert err(b.owner.post(f"/api/scenes/{b.sid}/publish", {"checkpointId": cp["id"], "exposed": ["ramp-1.colour"]}), 422, "validation")["fields"] == {"exposed": "Choose up to 8 parameters from this scene."}
    first = publish(b.owner, b.sid, cp["id"], nine[:EXPOSED_MAX])["lab"]
    assert first["url"].endswith(f"/lab/{first['token']}") and HEX64.match(first["bundleHash"])
    assert ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["status"] == "published"
    set_gravity(b.owner, b.sid, 20)
    assert ok(httpx.get(f"{app_url}/api/labs/{first['token']}", timeout=HTTP_TIMEOUT), 200)["lab"]["bundleHash"] == first["bundleHash"]
    cp2 = checkpoint(b.owner, b.sid, f"After {tag()}")
    again = publish(b.owner, b.sid, cp2["id"], EXPOSED)["lab"]
    assert again["token"] == first["token"] and again["bundleHash"] != first["bundleHash"]
    assert stamp(again["publishedAt"]) >= stamp(first["publishedAt"])
    assert ok(b.owner.post(f"/api/scenes/{b.sid}/unpublish", {}), 200)["scene"]["status"] == "unpublished"
    err(httpx.get(f"{app_url}/api/labs/{first['token']}", timeout=HTTP_TIMEOUT), 404, "link_not_found")
    err(b.owner.post(f"/api/scenes/{b.sid}/unpublish", {}), 409, "not_published")
    err(b.owner.post(f"/api/scenes/{b.sid}/lab-link/regenerate", {}), 409, "not_published")
    with opened(browser, app_url, b.owner, f"/w/{b.wid}/p/{b.pid}") as page:
        shows(page, page.get_by_role("region", name="Scenes"), "Unpublished")
    third = publish(b.owner, b.sid, cp["id"], EXPOSED)["lab"]
    assert third["token"] != first["token"]
    regen = ok(b.owner.post(f"/api/scenes/{b.sid}/lab-link/regenerate", {}), 200)["lab"]
    assert regen["token"] != third["token"]
    err(httpx.get(f"{app_url}/api/labs/{third['token']}", timeout=HTTP_TIMEOUT), 404, "link_not_found")
    ok(httpx.get(f"{app_url}/api/labs/{regen['token']}", timeout=HTTP_TIMEOUT), 200)
    actions = [e["action"] for e in events(b.owner, b.wid)]
    assert actions.count("scene.published") == 3 and actions.count("scene.unpublished") == 1 and actions.count("lab_link.regenerated") == 1


def test_lab_bundle_immutable(app_url: str) -> None:
    b = Bench(app_url)
    data = glb_bytes(label=tag())
    asset = ok(upload(b.owner, b.pid, data, "cube.glb", "cm"), 201)["asset"]
    model = {"assetId": asset["id"], "id": "model-1", "kind": "model", "name": "cube", "params": {},
             "position": [2, 0, 0], "rotation": [0, 0, 0, 1], "scale": [0.01, 0.01, 0.01]}
    ok(patch(b.owner, b.sid, [{"op": "add", "object": model}]), 200)
    cp = checkpoint(b.owner, b.sid, "Before class")
    lab = publish(b.owner, b.sid, cp["id"], EXPOSED)["lab"]
    key = f"labs/{b.sid}/{lab['bundleHash']}.json"
    stored = S3().get(key)
    assert sha(stored) == lab["bundleHash"]
    served = httpx.get(f"{app_url}/api/labs/{lab['token']}/bundle", timeout=HTTP_TIMEOUT)
    assert ok(served, 200) is not None and served.content == stored
    bundle = json.loads(stored)
    assert stored == canonical(bundle)
    snapshot = json.loads(S3().get(f"checkpoints/{b.sid}/{cp['id']}.json"))
    assert bundle["document"] == snapshot and bundle["bundleVersion"] == 1 and bundle["checkpointId"] == cp["id"]
    assert sorted(bundle["exposed"]) == sorted(EXPOSED) and bundle["solver"] == SOLVER
    assert bundle["assets"] == [{"assetId": asset["id"], "kind": "glb", "scaleToMetres": 0.01, "sha256": sha(data)}]
    body = ok(httpx.get(f"{app_url}/api/labs/{lab['token']}", timeout=HTTP_TIMEOUT), 200)
    assert body["bundle"] == bundle and body["lab"]["bundleHash"] == lab["bundleHash"]
    got = httpx.get(f"{app_url}/api/labs/{lab['token']}/assets/{sha(data)}", timeout=HTTP_TIMEOUT)
    assert ok(got, 200) is not None and got.content == data
    assert httpx.get(f"{app_url}/api/labs/{lab['token']}/assets/{sha(b'not-named')}", timeout=HTTP_TIMEOUT).status_code == 404
    set_gravity(b.owner, b.sid, 20)
    cp2 = checkpoint(b.owner, b.sid, f"After {tag()}")
    second = publish(b.owner, b.sid, cp2["id"], EXPOSED)["lab"]
    assert second["bundleHash"] != lab["bundleHash"]
    assert sha(S3().get(f"labs/{b.sid}/{second['bundleHash']}.json")) == second["bundleHash"]
    assert S3().get(key) == stored, "a republish overwrote the earlier bundle"


def test_publish_email(app_url: str, mail: Any) -> None:
    b, cp, lab = published_lab(app_url)
    first = inbox(mail, b.owner.email, 1)
    assert len(first) == 1
    assert first[0].get("Subject") == f"Lab published: {b.scene_name}"
    assert f"/lab/{lab['token']}" in text(first[0]) and lab["bundleHash"] in text(first[0])
    assert mail_from_address() in addresses(first[0].get("From"))
    publish(b.owner, b.sid, cp["id"], EXPOSED)
    assert len(inbox(mail, b.owner.email, 2)) == 2


def test_wf_publish_dialog(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    co = add_member(b.owner, b.wid, "editor", mail, "publish-co")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        click(page.get_by_role("button", name="Publish"))
        dialog = page.get_by_role("dialog", name="Publish lab")
        visible(page, dialog)
        click(dialog.get_by_role("button", name="Publish lab"))
        says(page, status(page, "Notices"), "Save a checkpoint before publishing.")
        assert ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["lab"] is None
        page.keyboard.press("Escape")
        checkpoint(b.owner, b.sid, "Before class")
        page.reload()
        visible(page, stage(page))
        click(page.get_by_role("button", name="Publish"))
        visible(page, dialog)
        select(dialog.get_by_role("combobox", name="Checkpoint"), "Before class")
        check(dialog.get_by_role("checkbox", name="Ramp 1: Mass (kg)"))
        check(dialog.get_by_role("checkbox", name="Ramp 1: Angle (degrees)"))
        click(dialog.get_by_role("button", name="Publish lab"))
        says(page, status(page, "Notices"), re.compile(r"^Lab published at \S+/lab/[A-Za-z0-9_-]+$"))
        lab = ok(b.owner.get(f"/api/scenes/{b.sid}"), 200)["scene"]["lab"]
        assert sorted(lab["exposed"]) == sorted(EXPOSED)
        shows(page, dialog, f"/lab/{lab['token']}")
        assert status(page, "Notices").inner_text().endswith(f"/lab/{lab['token']}")
        click(dialog.get_by_role("button", name="Copy lab link"))
        says(page, status(page, "Notices"), "Copied")
        assert page.evaluate("() => navigator.clipboard.readText()").endswith(f"/lab/{lab['token']}")
    assert len(inbox(mail, b.owner.email, 1)) == 1
    with open_editor(browser, app_url, co, b.wid, b.sid) as page:
        for name in ("Publish", "Share"):
            button = page.get_by_role("button", name=name, exact=True)
            expect(button).to_be_disabled()
            expect(button).to_have_accessible_description("Only the workspace owner can share or publish.")


def test_wf_student_lab_journey(browser: Browser, app_url: str) -> None:
    b, _cp, lab = published_lab(app_url)
    with opened(browser, app_url, None, f"/lab/{lab['token']}") as page:
        visible(page, page.get_by_role("heading", name=b.scene_name, level=1))
        mass = page.get_by_role("slider", name="Ramp 1: Mass (kg)")
        angle = page.get_by_role("slider", name="Ramp 1: Angle (degrees)")
        before = readouts(page).inner_text()
        mass.focus()
        page.keyboard.press("ArrowRight")
        angle.focus()
        page.keyboard.press("ArrowRight")
        value = "el => Number(el.getAttribute('aria-valuenow') ?? el.value)"
        assert mass.evaluate(value) == pytest.approx(RAMP_DEFAULTS["mass_kg"] + 0.1)
        assert angle.evaluate(value) == pytest.approx(RAMP_DEFAULTS["angle_deg"] + 1)
        soon(page, lambda: expect(readouts(page)).not_to_have_text(before, timeout=POLL_MS), UI_S, "readouts update in place")
        step, digest = run_and_step(page, 5)
        expect(mass).to_be_disabled()
        params = {"ramp-1.mass_kg": round(RAMP_DEFAULTS["mass_kg"] + 0.1, 6), "ramp-1.angle_deg": RAMP_DEFAULTS["angle_deg"] + 1}
        lab_hash = verify(Api(app_url), "", step, params, f"/api/labs/{lab['token']}/verify")
        assert digest == lab_hash[:12]
        assert lab_hash != verify(Api(app_url), "", step, None, f"/api/labs/{lab['token']}/verify")
        click(run_button(page))
        soon(page, lambda: _assert_step(page, 0), UI_S, "Stop returns to step 0")
        expect(mass).to_be_enabled()


def test_lab_exposed_only(browser: Browser, app_url: str) -> None:
    _b, _cp, lab = published_lab(app_url)
    body = ok(httpx.get(f"{app_url}/api/labs/{lab['token']}", timeout=HTTP_TIMEOUT), 200)["lab"]
    entries = {e["key"]: e for e in body["exposed"]}
    assert set(entries) == set(EXPOSED)
    assert (entries["ramp-1.mass_kg"]["min"], entries["ramp-1.mass_kg"]["max"], entries["ramp-1.mass_kg"]["step"], entries["ramp-1.mass_kg"]["value"]) == (0.1, 100, 0.1, 1)
    assert (entries["ramp-1.angle_deg"]["min"], entries["ramp-1.angle_deg"]["max"], entries["ramp-1.angle_deg"]["step"], entries["ramp-1.angle_deg"]["value"]) == (1, 60, 1, 30)
    path = f"{app_url}/api/labs/{lab['token']}/verify"
    fields = err(httpx.post(path, json={"steps": 10, "params": {"ramp-1.length_m": 4}}, timeout=HTTP_TIMEOUT), 422, "validation")["fields"]
    assert fields == {"ramp-1.length_m": "ramp-1.length_m is not adjustable in this lab."}
    fields = err(httpx.post(path, json={"steps": 10, "params": {"ramp-1.mass_kg": 500}}, timeout=HTTP_TIMEOUT), 422, "validation")["fields"]
    assert fields == {"ramp-1.mass_kg": "Enter a value from 0.1 to 100."}
    fields = err(httpx.post(path, json={"steps": MAX_STEPS + 1}, timeout=HTTP_TIMEOUT), 422, "validation")["fields"]
    assert fields == {"steps": "Steps must be from 1 to 12000."}
    ok(httpx.post(path, json={"steps": 10, "params": {"ramp-1.angle_deg": 45}}, timeout=HTTP_TIMEOUT), 200)
    with opened(browser, app_url, None, f"/lab/{lab['token']}") as page:
        sliders = page.get_by_role("region", name="Lab parameters").get_by_role("slider")
        soon(page, lambda: expect(sliders).to_have_count(2, timeout=POLL_MS), UI_S, "only exposed sliders")
        expect(page.get_by_role("slider", name="Ramp 1: Length (m)")).to_have_count(0)


def test_wf_student_lab_phone(browser: Browser, app_url: str) -> None:
    _b, _cp, lab = published_lab(app_url)
    w, h = 390, 844
    with opened(browser, app_url, None, f"/lab/{lab['token']}", size=(w, h), reduced_motion="reduce") as page:
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        sheet = page.get_by_role("tablist", name="Lab panels")
        visible(page, sheet)
        assert box(sheet)["y"] >= h * STAGE_SHARE
        for name in ("Parameters", "Readouts"):
            visible(page, sheet.get_by_role("tab", name=name))
        layout(page)
        for role in ("button", "slider", "tab"):
            controls = page.get_by_role(role)
            for i in range(controls.count()):
                c = controls.nth(i)
                if c.is_visible():
                    cb = box(c)
                    assert cb["height"] >= TOUCH_MIN_PX and cb["width"] >= TOUCH_MIN_PX, f"{role} {i} is {cb}"
        still = camera(page)
        advance(page, 2000)
        assert cam_equal(camera(page), still), "the stage moved by itself"
        sb = box(stage(page))
        x, y = sb["x"] + sb["width"] / 2, sb["y"] + min(sb["height"], h * STAGE_SHARE) / 2
        cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
        for i in range(1, 6):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + i * 20, "y": y}]})
        cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        soon(page, lambda: _assert_camera_moved(page, still), UI_S, "one-finger drag orbits the camera")
        run_button(page).scroll_into_view_if_needed()
        tap(run_button(page))
        says(page, status(page, "Mode"), "RUNNING")
        advance(page, 500)
        assert telemetry(page)[0] > 0, "reduced motion stopped the simulation"


@pytest.mark.parametrize("case", LAB_DEATHS, ids=LAB_DEATHS)
def test_missing_lab_page(browser: Browser, app_url: str, case: str) -> None:
    token = "nolab" + uuid.uuid4().hex
    fresh = None
    if case != "unknown":
        b, _cp, lab = published_lab(app_url)
        token = lab["token"]
        if case == "regenerated":
            fresh = ok(b.owner.post(f"/api/scenes/{b.sid}/lab-link/regenerate", {}), 200)["lab"]["token"]
        else:
            ok(b.owner.post(f"/api/scenes/{b.sid}/unpublish", {}), 200)
    for method, path in (("GET", ""), ("GET", "/bundle"), ("POST", "/verify")):
        resp = httpx.request(method, f"{app_url}/api/labs/{token}{path}", json={"steps": 1} if method == "POST" else None, timeout=HTTP_TIMEOUT)
        err(resp, 404, "link_not_found")
    with opened(browser, app_url, None, f"/lab/{token}") as page:
        visible(page, page.get_by_role("heading", name="We couldn't find this lab"))
        visible(page, page.get_by_text("The link may have been withdrawn or replaced. Ask your tutor for a new one.", exact=True))
    if fresh:
        ok(httpx.get(f"{app_url}/api/labs/{fresh}", timeout=HTTP_TIMEOUT), 200)


def test_readonly_link_api(app_url: str) -> None:
    b = Bench(app_url)
    data = glb_bytes(label=tag())
    asset = ok(upload(b.owner, b.pid, data, "cube.glb"), 201)["asset"]
    model = {"assetId": asset["id"], "id": "model-1", "kind": "model", "name": "cube", "params": {},
             "position": [2, 0, 0], "rotation": [0, 0, 0, 1], "scale": [1, 1, 1]}
    ok(patch(b.owner, b.sid, [{"op": "add", "object": model}]), 200)
    created = b.owner.post(f"/api/projects/{b.pid}/share-links", {})
    body = ok(created, 201)
    link = body["link"]
    assert body["delivery"] is None and link["url"].endswith(f"/view/{link['token']}")
    date = server_date(created)
    if date:
        assert abs((stamp(link["expiresAt"]) - date).total_seconds() - SHARE_TTL_DEFAULT) <= CLOCK_SKEW_S
    anon = Api(app_url)
    view = ok(anon.get(f"/api/view/{link['token']}"), 200)
    assert view["project"]["name"] == b.project_name and [s["id"] for s in view["scenes"]] == [b.sid]
    scene = ok(anon.get(f"/api/view/{link['token']}/scenes/{b.sid}"), 200)
    assert scene["document"] == doc(b.owner, b.sid) and [a["sha256"] for a in scene["assets"]] == [sha(data)]
    for path in ("", f"/scenes/{b.sid}"):
        head = anon.call("HEAD", f"/api/view/{link['token']}{path}")
        assert head.status_code == 200 and head.content == b""
    got = anon.get(f"/api/view/{link['token']}/assets/{sha(data)}")
    assert ok(got, 200) is not None and got.content == data and got.headers["etag"] == f'"{sha(data)}"'
    err(anon.get(f"/api/view/{link['token']}/assets/{sha(b'unrelated')}"), 404, "link_not_found")
    rev = document(b.owner, b.sid)[1]
    for method, path, payload in (("POST", "", {}), ("PATCH", f"/scenes/{b.sid}", {"ops": []}), ("DELETE", "", None),
                                  ("PUT", f"/scenes/{b.sid}", {}), ("POST", f"/scenes/{b.sid}/checkpoints", {"label": "x"})):
        resp = anon.call(method, f"/api/view/{link['token']}{path}", payload)
        err(resp, 405, "read_only")
        assert resp.headers["allow"] == "GET, HEAD"
    assert document(b.owner, b.sid)[1] == rev
    assert verify(anon, b.sid, 30, path=f"/api/view/{link['token']}/scenes/{b.sid}/verify") == verify(b.owner, b.sid, 30)
    assert link["id"] in [l["id"] for l in ok(b.owner.get(f"/api/projects/{b.pid}/share-links"), 200)["links"]]


def test_wf_share_links_live_view(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    ok(patch(b.owner, b.sid, [{"op": "add", "object": crate("cart-1", "Cart 1", [-2, 0, 0], 1, [0.4, 0.3, 0.25])}]), 200)
    link = ok(b.owner.post(f"/api/projects/{b.pid}/share-links", {}), 201)["link"]
    with opened(browser, app_url, None, f"/view/{link['token']}/s/{b.sid}") as page:
        says(page, status(page, "View only"), "View only")
        choose(page, "Cart 1")
        inspector = page.get_by_role("region", name="Inspector")
        shows(page, inspector, "Position X (m): -2")
        expect(page.get_by_role("spinbutton")).to_have_count(0)
        page.evaluate("() => { window.__rampwrightProbe = 1 }")
        set_field(b.owner, b.sid, "cart-1", "position", [2.5, 0, 0])
        shows(page, inspector, "Position X (m): 2.5", READONLY_LIVE_S)
        shows(page, inspector, "Position X (m): 2.5", READONLY_LIVE_S)
        click(run_button(page))
        says(page, status(page, "Mode"), "RUNNING")
        click(run_button(page))
        ok(b.owner.delete(f"/api/share-links/{link['id']}"), 204)
        visible(page, page.get_by_role("heading", name="This link no longer works. Ask the owner for a new one.", level=1), LINK_DEAD_S)
        assert page.evaluate("() => window.__rampwrightProbe") == 1, "the read-only view reloaded"
        page.goto(f"{app_url}/view/{link['token']}")
        visible(page, page.get_by_role("heading", name="This link no longer works. Ask the owner for a new one.", level=1))


@pytest.mark.parametrize("case", LINK_DEATHS, ids=LINK_DEATHS)
def test_link_dead_next_request(app_url: str, case: str) -> None:
    base = outage("APP_SHORT_URL") if case == "expired" else app_url
    b = Bench(base)
    link = ok(b.owner.post(f"/api/projects/{b.pid}/share-links", {}), 201)["link"]
    expires = stamp(link["expiresAt"])
    read_s = LINK_DEAD_S + (SHORT_LINK_TTL + CLOCK_SKEW_S if case == "expired" else 0) + 1
    stream_client = httpx.Client(base_url=b.base, timeout=httpx.Timeout(HTTP_TIMEOUT, read=read_s))
    with stream_client.stream("GET", f"/api/view/{link['token']}/scenes/{b.sid}/live") as live:
        assert live.status_code == 200
        fresh = None
        if case == "revoked":
            ok(b.owner.delete(f"/api/share-links/{link['id']}"), 204)
        elif case == "regenerated":
            fresh = ok(b.owner.post(f"/api/share-links/{link['id']}/regenerate"), 201)["link"]
            assert fresh["token"] != link["token"] and stamp(fresh["expiresAt"]) >= expires
        else:
            def dead() -> None:
                resp = httpx.get(f"{base}/api/view/{link['token']}", timeout=HTTP_TIMEOUT)
                answered = server_date(resp)
                if resp.status_code == 200 and answered:
                    assert answered < expires + timedelta(seconds=1), "link still served after expiresAt"
                assert resp.status_code == 404, f"link answered {resp.status_code}"
            wait_api(dead, SHORT_LINK_TTL + LINK_DEAD_S, "link dies at expiresAt")
        anon = Api(base)
        err(anon.get(f"/api/view/{link['token']}"), 404, "link_not_found")
        err(anon.get(f"/api/view/{link['token']}/scenes/{b.sid}"), 404, "link_not_found")
        assert anon.call("HEAD", f"/api/view/{link['token']}").status_code == 404
        saw_dead = False
        deadline = time.monotonic() + LINK_DEAD_S
        try:
            for line in live.iter_lines():
                if line.strip() == "event: link_dead":
                    saw_dead = True
                    break
                if time.monotonic() > deadline:
                    break
        except httpx.ReadTimeout:
            pass
        assert saw_dead, "the open read-only stream did not send link_dead within five seconds"
    stream_client.close()
    active = [l["token"] for l in ok(b.owner.get(f"/api/projects/{b.pid}/share-links"), 200)["links"]]
    assert link["token"] not in active
    if fresh:
        assert fresh["token"] in active
        ok(Api(base).get(f"/api/view/{fresh['token']}"), 200)


def test_wf_share_links_dialog(browser: Browser, app_url: str, mail: Any) -> None:
    b = Bench(app_url)
    parent, _ = ident("parent")
    path = f"/api/projects/{b.pid}/share-links"
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=app_url)
        click(page.get_by_role("button", name="Share", exact=True))
        dialog = page.get_by_role("dialog", name="Share project")
        visible(page, dialog)
        shows(page, dialog, "No active links.")
        click(dialog.get_by_role("button", name="Create read-only link"))
        says(page, status(page, "Notices"), "Link created")
        rows = dialog.get_by_role("list", name="Active links").get_by_role("listitem")
        soon(page, lambda: expect(rows).to_have_count(1, timeout=POLL_MS), UI_S, "one active link row")
        expect(rows.first).to_contain_text(re.compile(r"Expires \S"))
        first = ok(b.owner.get(path), 200)["links"]
        assert len(first) == 1
        click(rows.first.get_by_role("button", name="Copy link"))
        says(page, status(page, "Notices"), "Copied")
        assert page.evaluate("() => navigator.clipboard.readText()").endswith(f"/view/{first[0]['token']}")
        fill(dialog.get_by_role("textbox", name="Email the link to"), parent)
        click(dialog.get_by_role("button", name="Create and email link"))
        says(page, status(page, "Notices"), f"Link emailed to {parent}")
        both = {l["token"] for l in ok(b.owner.get(path), 200)["links"]}
        assert len(both) == 2
        message = inbox(mail, parent, 1)[0]
        assert message.get("Subject") == f"{b.owner.name} shared {b.project_name} with you"
        emailed = next(t for t in both if t != first[0]["token"])
        assert f"/view/{emailed}" in text(message)
        click(rows.first.get_by_role("button", name="Regenerate link"))
        says(page, status(page, "Notices"), "New link created. The old link no longer works.")
        after = {l["token"] for l in ok(b.owner.get(path), 200)["links"]}
        gone = both - after
        assert len(gone) == 1 and len(after) == 2
        err(Api(app_url).get(f"/api/view/{gone.pop()}"), 404, "link_not_found")
        for _ in range(2):
            click(rows.first.get_by_role("button", name="Revoke link"))
            says(page, status(page, "Notices"), "Link revoked")
        shows(page, dialog, "No active links.")
    assert ok(b.owner.get(path), 200)["links"] == []
    for token in after:
        err(Api(app_url).get(f"/api/view/{token}"), 404, "link_not_found")


def _progress(page: Page, y: int, expected: str) -> None:
    img = page.get_by_role("img", name="Bench preview")
    page.evaluate("y => window.scrollTo(0, y)", y)
    soon(page, lambda: expect(img).to_have_attribute("data-progress", expected, timeout=POLL_MS), UI_S, f"data-progress at {y}")


def test_wf_cross_cutting_landing(browser: Browser, app_url: str) -> None:
    with opened(browser, app_url, None, "/") as page:
        visible(page, page.get_by_role("heading", name="Rampwright", level=1))
        for heading in ("Every number in metres, kilograms and seconds", "The same run on every student's screen", "Stop, and the bench is exactly as you left it"):
            visible(page, page.get_by_role("heading", name=heading, level=2))
        positions = [0, 750, 1500, 2250, SCROLL_STORY_PX]
        forward: dict[int, list[list[float]]] = {}
        for y in positions:
            _progress(page, y, f"{y / SCROLL_STORY_PX:.3f}")
            advance(page, POLL_MS)
            forward[y] = camera(page)
        assert not cam_equal(forward[0], forward[SECTION_PX + 500]), "camera did not move with scroll"
        _progress(page, TOOLBAR_FULL_PX, "0.900")
        visible(page, page.get_by_role("toolbar", name="Bench tools"))
        for y in reversed(positions):
            _progress(page, y, f"{y / SCROLL_STORY_PX:.3f}")
            soon(page, lambda yy=y: _assert_same_camera(page, forward[yy]), UI_S, f"camera at {y} matches the forward pass")
        _progress(page, 1500, "0.500")
        advance(page, POLL_MS)
        rest = camera(page)
        advance(page, 2000)
        assert cam_equal(camera(page), rest), "motion continued after scrolling stopped"
        click(page.get_by_role("link", name="Sign in"))
        at_url(page, r"/sign-in$")


def _assert_same_camera(page: Page, expected: list[list[float]]) -> None:
    assert cam_equal(camera(page), expected), "scrolling back did not reverse the camera exactly"


@pytest.mark.parametrize("mode", LANDING_MODES, ids=LANDING_MODES)
def test_landing_reduced_and_nowebgl(browser: Browser, app_url: str, mode: str) -> None:
    opts: dict[str, Any] = {"reduced_motion": "reduce"} if mode == "reduced-motion" else {"no_webgl": True}
    with opened(browser, app_url, None, "/", **opts) as page:
        visible(page, page.get_by_role("img", name="Bench preview"))
        visible(page, page.get_by_role("heading", name="Rampwright", level=1))
        if mode == "reduced-motion":
            stills = [(0, "0.000"), (SECTION_PX - 1, "0.000"), (SECTION_PX, "0.333"), (2 * SECTION_PX - 1, "0.333"),
                      (2 * SECTION_PX, "0.667"), (3 * SECTION_PX - 1, "0.667"), (3 * SECTION_PX, "1.000"), (1500, "0.333"), (0, "0.000")]
            cams: dict[str, list[list[float]]] = {}
            for y, expected in stills:
                _progress(page, y, expected)
                advance(page, POLL_MS)
                cams.setdefault(expected, camera(page))
                assert cam_equal(camera(page), cams[expected]), f"still at {y} differs from its key frame"
            assert not cam_equal(cams["0.000"], cams["0.333"])
            _progress(page, 3 * SECTION_PX, "1.000")
            visible(page, page.get_by_role("toolbar", name="Bench tools"))
        else:
            for y, expected in ((0, "0.000"), (1500, "0.500"), (SCROLL_STORY_PX, "1.000")):
                _progress(page, y, expected)
        for heading in ("Every number in metres, kilograms and seconds", "The same run on every student's screen", "Stop, and the bench is exactly as you left it"):
            expect(page.get_by_role("heading", name=heading, level=2)).to_have_count(1)
        click(page.get_by_role("link", name="Start a bench"))
        at_url(page, r"/sign-up$")


def test_wf_cross_cutting_keyboard(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    checkpoint(b.owner, b.sid, "Before class")
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        grid = page.get_by_role("button", name="Grid")
        grid.focus()
        page.keyboard.press("?")
        shortcuts = page.get_by_role("dialog", name="Keyboard shortcuts")
        visible(page, shortcuts)
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert inside(shortcuts), f"{key} left the Keyboard shortcuts dialog"
        page.keyboard.press("Escape")
        soon(page, lambda: expect(shortcuts).to_be_hidden(timeout=POLL_MS), UI_S, "Escape closes the dialog")
        expect(grid).to_be_focused()
        share = page.get_by_role("button", name="Share", exact=True)
        click(share)
        dialog = page.get_by_role("dialog", name="Share project")
        visible(page, dialog)
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert inside(dialog), f"{key} left Share project"
        page.keyboard.press("Escape")
        expect(share).to_be_focused()
        row(page, "Ramp 1").focus()
        page.keyboard.press("Control+k")
        visible(page, page.get_by_role("dialog", name="Commands"))
        page.keyboard.press("Escape")
        expect(row(page, "Ramp 1")).to_be_focused()
        assets = page.get_by_role("region", name="Assets")
        click(assets.get_by_role("tab", name="Checkpoints"))
        restore = assets.get_by_role("button", name="Restore Before class")
        rev = document(b.owner, b.sid)[1]
        click(restore)
        alert = page.get_by_role("alertdialog", name="Restore checkpoint")
        visible(page, alert)
        page.keyboard.press("Shift+Tab")
        assert inside(alert)
        page.keyboard.press("Escape")
        soon(page, lambda: expect(alert).to_be_hidden(timeout=POLL_MS), UI_S, "Escape chooses Cancel")
        expect(restore).to_be_focused()
        assert document(b.owner, b.sid)[1] == rev
        snap = page.get_by_role("button", name="Snap")
        snap.focus()
        pressed = grid.get_attribute("aria-pressed")
        page.keyboard.press("g")
        expect(grid).not_to_have_attribute("aria-pressed", pressed or "")
        page.get_by_role("region", name="Props").get_by_role("button", name="Add crate").focus()
        page.keyboard.press("r")
        says(page, status(page, "Mode"), "RUNNING")
        page.keyboard.press("Escape")
        soon(page, lambda: expect(run_button(page)).to_have_text("Run", timeout=POLL_MS), UI_S, "Escape stops the run")
        find = page.get_by_role("searchbox", name="Find objects")
        find.focus()
        page.keyboard.type("r")
        expect(find).to_have_value("r")
        expect(run_button(page)).to_have_text("Run")


def test_bench_toolbar(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    with open_editor(browser, app_url, b.owner, b.wid, b.sid) as page:
        bar = page.get_by_role("toolbar", name="Bench tools")
        names = tab_order(page, 2)
        assert names[1] == "Stage", f"Tab stops {names}: the toolbar is one stop, then the stage"
        run_button(page).focus()
        page.keyboard.press("ArrowRight")
        assert bar.evaluate("t => t.contains(document.activeElement)")
        expect(run_button(page)).not_to_be_focused()
        page.keyboard.press("End")
        assert bar.evaluate("t => t.contains(document.activeElement)")
        page.keyboard.press("Home")
        expect(run_button(page)).to_be_focused()
        order = [run_button(page), bar.get_by_role("button", name="Move"), bar.get_by_role("button", name="Snap"),
                 bar.get_by_role("link", name="Labs"), bar.get_by_role("button", name="Account", exact=True),
                 bar.get_by_text("Rampwright", exact=True)]
        xs = [box(loc)["x"] for loc in order]
        assert xs == sorted(xs), f"toolbar clusters out of order: {xs}"
        expect(bar.get_by_role("link", name="Rampwright")).to_have_count(0)
        assert f"/p/{b.pid}" in (bar.get_by_role("link", name="Labs").get_attribute("href") or ""), "Labs goes to the project page"
        account = bar.get_by_role("button", name="Account", exact=True)
        expect(account).to_contain_text(b.owner.name)
        expect(account).to_contain_text(b.ws_name)
        assert box(bar.get_by_role("button", name="Publish"))["height"] > box(run_button(page))["height"]
        for name in ("Move", "Rotate", "Scale", "Snap", "Grid", "Colliders", "Assets", "Windows", "Shortcuts"):
            cb = box(bar.get_by_role("button", name=name, exact=True))
            assert cb["width"] >= DESKTOP_MIN_PX and cb["height"] >= DESKTOP_MIN_PX, f"{name} is {cb}"
        snap = bar.get_by_role("button", name="Snap")
        rest, hover = state_styles(snap, "border-color", "color", state="hover")
        assert rest != hover, "hover does not change the chip"
        expect(snap).to_have_attribute("aria-pressed", "false")
        click(snap)
        expect(snap).to_have_attribute("aria-pressed", "true")
        expect(bar.get_by_role("button", name="Move")).to_have_attribute("aria-pressed", "true")
        stage(page).focus()
        page.keyboard.press("e")
        expect(bar.get_by_role("button", name="Rotate")).to_have_attribute("aria-pressed", "true")
        expect(bar.get_by_role("button", name="Move")).to_have_attribute("aria-pressed", "false")
        expect(pause_button(page)).to_be_disabled()


def test_run_manifest_and_health(browser: Browser, app_url: str) -> None:
    assert ok(httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "ok"}
    for var, service in (("APP_VALKEY_DOWN_URL", "locks"), ("APP_MINIO_DOWN_URL", "storage"), ("APP_MAILPIT_DOWN_URL", "mail")):
        base = outage(var)
        assert ok(httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "ok"}
        wait_api(lambda b_=base, s=service: ok(httpx.get(f"{b_}/api/status", timeout=HTTP_TIMEOUT), 200)[s] == "down" or pytest.fail(f"{s} not down"), STATUS_FRESH_S + 1, f"{var} reports {service} down")
    with app_copy() as copy:
        assert ok(httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "ok"}
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json", "/tsconfig.json"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404, f"{path} was served"
    err(httpx.get(f"{app_url}/api/no-such-endpoint", timeout=HTTP_TIMEOUT), 404, "not_found")
    user = sign_up(app_url, "limits")
    big = json.dumps({"name": "x" * JSON_LIMIT}).encode()
    err(user.http.post("/api/workspaces", content=big, headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    err(user.http.post("/api/workspaces", content=b"name=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    with opened(browser, app_url, None, "/no-such-page") as page:
        visible(page, page.get_by_role("heading", name="We couldn't find that page"))


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib", "OFL-1.1"}
EMBEDDED_STORES = {"sqlite3", "better-sqlite3", "sql.js", "lowdb", "nedb", "@seald-io/nedb", "level", "classic-level",
                   "lmdb", "pouchdb", "lokijs", "node-persist", "redis-memory-server", "ioredis-mock", "pglite", "@electric-sql/pglite"}


def test_if_run_manifest() -> None:
    data = json.loads(Path("/app/run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), f"run.json {key} missing"


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices or str(getattr(p, "version", "")) not in notices]
    assert not missing, f"packages missing from the notices: {missing[:20]}"
    assert "Inter" in notices and "JetBrains Mono" in notices


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_no_extra_datastore() -> None:
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & EMBEDDED_STORES, f"embedded stores shipped: {shipped & EMBEDDED_STORES}"
    found = []
    for root, dirs, files in os.walk(DEPLOYED_APP):
        dirs[:] = [d for d in dirs if d not in ("node_modules", ".git")]
        found += [os.path.join(root, f) for f in files if f.endswith((".sqlite", ".sqlite3", ".db", ".ldb"))]
    assert not found, f"database files on disk: {found}"


def test_if_service_config_unchanged(valkey: Any) -> None:
    assert Postgres().rows("SELECT 1 AS one") == [{"one": 1}]
    assert Postgres().tables(), "the provided database holds no app tables"
    assert isinstance(S3().keys(""), list)
    assert valkey.command("PING") in ("PONG", True, b"PONG")


def test_if_lockfile_committed() -> None:
    source = Path("/app/package-lock.json")
    assert source.is_file()
    deployed = Path(DEPLOYED_APP) / "package-lock.json"
    if deployed.resolve() != source.resolve() and deployed.is_file():
        assert deployed.read_bytes() == source.read_bytes(), "install changed package-lock.json"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    b = Bench(app_url)
    seen: list[tuple[str, str]] = []
    with opened(browser, app_url, b.owner, "/") as page:
        page.on("request", lambda r: seen.append((r.url, r.resource_type)))
        page.goto(app_url + "/")
        visible(page, page.get_by_role("heading", name="Rampwright", level=1))
        page.goto(f"{app_url}/w/{b.wid}/s/{b.sid}")
        visible(page, stage(page))
        advance(page, 1000)
    foreign = [u for u, _t in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, f"requests left the app origin: {foreign[:10]}"
    assert any(t == "font" for _u, t in seen), "no bundled font was loaded from the app origin"
