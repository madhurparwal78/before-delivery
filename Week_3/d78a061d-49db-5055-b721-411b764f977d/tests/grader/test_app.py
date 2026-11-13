from __future__ import annotations

import contextlib
import hashlib
import importlib
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import sys
import tempfile
import threading
import time
import urllib.parse
import uuid
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from decimal import ROUND_HALF_UP, Decimal
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, BrowserContext, Locator, Page, expect

from conftest import (
    advance,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    session,
    state_styles,
    tab_order,
    unique,
)


def _load(name: str, *modules: str) -> Any:
    for module_name in ("conftest",) + modules:
        try:
            module = importlib.import_module(module_name)
        except ImportError:
            continue
        if hasattr(module, name):
            return getattr(module, name)
    raise ImportError(f"verifier helper {name} not found")


S3 = _load("S3", "minio_client", "clients.minio", "s3")
mail_addresses = _load("addresses", "mailpit", "mailpit_client", "clients.mailpit")
mail_text = _load("text", "mailpit", "mailpit_client", "clients.mailpit")
mail_from_address = _load("mail_from_address", "mailpit", "mailpit_client", "clients.mailpit")

RULEBOOK_VERSION = "2026.11-r1"
VALIDATOR_VERSION = "2.0.0-dev.3.10"
EMOJI = "👍🏽"
NAME_MAX = 20
PASSWORD_MAX = 128
CHAT_MAX = 280
STROKES_MAX = 24
POINTS_MAX = 200
VERTEX_MAX = 12000
UPLOAD_MAX = 15728640
QUOTA_BYTES = 62914560
TICKS_PER_SECOND = 20
READY_WINDOW_S = 20
VERDICT_MAX_S = 30
R04_LIMIT = 20000
R05_LIMIT = 64
R09_LIMIT = 2048
R04_MESH_TRIANGLES = 10001
R04_TWO_NODE_MEASURED = 20002
STRIP_INDICES = 12
STRIP_MEASURED = 10
THUMB_PX = 256
JSON_LIMIT = 1000000
PLANE_PX = 320
ARM_LIMIT = 180
ARM_KEY_STEP = 15
ARM_PAGE_STEP = 45
UNDO_DEPTH = 50
ORBIT_STEP = 15
TILT_MAX = 60
TURN_MIN_S = 30
TURN_MAX_S = 40
TURN_RESUME_S = 3
INFLATE_MIN_MS = 250
INFLATE_MAX_MS = 400
FLY_MIN_MS = 400
FLY_MAX_MS = 600
CATCH_MIN_MS = 500
CATCH_MAX_MS = 700
CROSSFADE_MIN_MS = 100
CROSSFADE_MAX_MS = 150
PLANE_YAW_END = -35
CAMERA_MIN_MS = 300
CAMERA_MAX_MS = 500
FLYTHROUGH_MIN_MS = 3000
FLYTHROUGH_MAX_MS = 5000
STILL_MAX_MS = 1000
STATS_MAX_MS = 500
COMPLETE_ROUTE_S = 2
SYNC_S = 1
PRESENCE_ONLINE_S = 2
PRESENCE_LAST_TAB_S = 4
PRESENCE_HEARTBEAT_S = 32
PRESENCE_FRESH_S = 30
CHAT_WINDOW_S = 10
CHAT_RATE = 5
CURSOR_STEP_M = 0.05
POINT_GAP_M = 0.02
STEP_M = 0.2
PUDDLE_DAMAGE = 0.5
HUMANOID_BONES = (
    "hips", "spine", "chest", "neck", "head", "leftUpperArm", "leftLowerArm", "leftHand",
    "rightUpperArm", "rightLowerArm", "rightHand", "leftUpperLeg", "leftLowerLeg", "leftFoot",
    "rightUpperLeg", "rightLowerLeg", "rightFoot",
)
ALLOWED_LICENCES = {
    "MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib",
    "BlueOak-1.0.0", "OFL-1.1", "CC0-1.0",
}

HTTP_S = 60
POLL_S = 0.1
SLICE_MS = 250
UI_S = 20
RT_S = 20
WALK_S = 30
MAIL_S = 30
BOOT_S = 120
SLACK_S = 1.5
STEP_MS = 20
FINE_STEP_MS = 10
TRACE_LIMIT = 2000
SHORT_TTL_WAIT_S = 60
GRACE_WAIT_S = 40
NPM_S = 300

PASSWORD = "graphite-hollow-77"
NEW_PASSWORD = "eraser-shavings-88"
WRONG_CLOCK = datetime(2001, 1, 1, 3, 0, tzinfo=timezone.utc)
OLD_HERO = "Viejo"
NEW_HERO = "Nuevo"
THIRD_HERO = "Tercero"
RENAMED_HERO = "Graphite Ace"

LINK_RE = re.compile(r"/(verify|reset-password)\?token=([A-Za-z0-9._~%-]+)")
HTML_LANG_RE = re.compile(r"\blang=[\"']?(en|ja|es)\b")
CDP_SESSIONS: dict[int, Any] = {}
NUMBER_RE = r"(\d+)"
CORS_PREFIX = "access-control-"
MOTION_DEFAULT = "no-preference"
SOLO = "lantern-road"
ANNOUNCE = {
    "en": "Reach <reach> m, weight <weight> kg, swing speed <swing> per second, <used> of <limit> vertices.",
    "es": "Alcance <reach> m, peso <weight> kg, velocidad de golpe <swing> por segundo, <used> de <limit> vértices.",
}


def filled(template: str, **values: Any) -> str:
    for key, value in values.items():
        template = template.replace(f"<{key}>", str(value))
    return template


def filled_re(template: str, *keys: str, **values: Any) -> re.Pattern[str]:
    pattern = re.escape(filled(template, **values))
    for key in keys:
        pattern = pattern.replace(re.escape(f"<{key}>"), NUMBER_RE)
    return re.compile(pattern)


def titled(screen: str) -> str:
    return filled("<screen> · Linewright", screen=screen)


def slot_path(slot: int) -> str:
    return f"/api/characters/slots/{slot}"


def complete_route(story: str, chapter: int) -> str:
    return f"/stories/{story}/chapters/{chapter}/complete"


def solo_progress(p: Any) -> dict[str, Any]:
    return p.http.get(f"/api/stories/{SOLO}/progress").json()["progress"]


def at(page: Page, path: str) -> None:
    assert urllib.parse.urlsplit(page.url).path == path, page.url


def slot_radio(dialog: Locator, label: str, holder: str | None = None) -> Locator:
    pattern = "^" + re.escape(label) + (".*" + re.escape(holder) if holder else "")
    return dialog.get_by_role("radio", name=re.compile(pattern))


def stat_texts(locale: str, reach: float, weight: float, swing: float) -> list[str]:
    return [filled("<reach> m", reach=fmt(reach, locale, 2)), filled("<weight> kg", weight=fmt(weight, locale, 2)),
            filled("<swing>/s", swing=fmt(swing, locale, 2))]


def announcement(locale: str, reach: float, weight: float, swing: float, used: int) -> str:
    return filled(ANNOUNCE[locale], reach=fmt(reach, locale, 2), weight=fmt(weight, locale, 2),
                  swing=fmt(swing, locale, 2), used=fmt(used, locale), limit=fmt(VERTEX_MAX, locale))


def meter_text(used: int) -> str:
    return filled("Vértices: <used> / <limit>", used=fmt(used, "es"), limit=fmt(VERTEX_MAX, "es"))


def env_url(name: str) -> str:
    value = os.environ.get(name, "")
    assert value, f"{name} must be set for the verifier"
    return value.rstrip("/")


def poll(fn: Callable[[], Any], seconds: float, what: str) -> Any:
    end = time.monotonic() + seconds
    last: Exception | None = None
    while True:
        try:
            value = fn()
        except (AssertionError, httpx.HTTPError, KeyError, TypeError) as error:
            value, last = None, error
        if value:
            return value
        if time.monotonic() > end:
            raise AssertionError(f"timed out after {seconds}s waiting for {what}: {last}")
        threading.Event().wait(POLL_S)


def hold_true(fn: Callable[[], bool], seconds: float, what: str) -> None:
    end = time.monotonic() + seconds
    while time.monotonic() < end:
        assert fn(), f"stopped holding: {what}"
        threading.Event().wait(POLL_S)


def see(page: Page, check: Callable[[], None], seconds: float = UI_S, step_ms: float = 100) -> None:
    end = time.monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if time.monotonic() > end:
                raise
            advance(page, step_ms)


def shows(page: Page, locator: Locator, value: str | re.Pattern, seconds: float = UI_S) -> None:
    see(page, lambda: expect(locator).to_have_text(value, timeout=SLICE_MS), seconds)


def holds(page: Page, locator: Locator, value: str, seconds: float = UI_S) -> None:
    see(page, lambda: expect(locator).to_contain_text(value, timeout=SLICE_MS), seconds)


def appears(page: Page, locator: Locator, seconds: float = UI_S) -> None:
    see(page, lambda: expect(locator).to_be_visible(timeout=SLICE_MS), seconds)


def focused(page: Page, locator: Locator, seconds: float = UI_S) -> None:
    see(page, lambda: expect(locator).to_be_focused(timeout=SLICE_MS), seconds)


def attr(page: Page, locator: Locator, name: str, value: str, seconds: float = UI_S) -> None:
    see(page, lambda: expect(locator).to_have_attribute(name, value, timeout=SLICE_MS), seconds, step_ms=20)


def lang_of(page: Page) -> str:
    return page.evaluate("document.documentElement.lang")


def combo_text(combo: Locator) -> str:
    return combo.evaluate(
        "e => e.tagName === 'SELECT' ? (e.selectedOptions[0] ? e.selectedOptions[0].textContent : '')"
        " : (e.value || e.textContent || '')"
    )


def picker_options(page: Page, combo: Locator) -> list[str]:
    if combo.evaluate("e => e.tagName") == "SELECT":
        return combo.evaluate("e => Array.from(e.options).map(o => o.textContent.trim())")
    combo.click()
    options = [o.strip() for o in page.get_by_role("option").all_inner_texts()]
    page.keyboard.press("Escape")
    return options


def inside(container: Locator) -> bool:
    return container.evaluate("e => e.contains(document.activeElement)")


def ax_present(page: Page, role: str, name: str) -> bool:
    nodes = session(page).send("Accessibility.getFullAXTree")["nodes"]
    for node in nodes:
        if node.get("ignored"):
            continue
        node_role = str((node.get("role") or {}).get("value", "")).lower()
        node_name = str((node.get("name") or {}).get("value", ""))
        if node_role == role and node_name == name:
            return True
    return False


def enable_touch(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    CDP_SESSIONS[id(page)] = cdp
    return cdp


def touch(page: Page, kind: str, points: list[tuple[float, float]]) -> None:
    cdp = CDP_SESSIONS.get(id(page)) or enable_touch(page)
    cdp.send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [{"x": x, "y": y, "id": i + 1} for i, (x, y) in enumerate(points)],
    })


def value_ok(page: Page, slider: Locator, value: str) -> None:
    def check() -> None:
        text = slider.get_attribute("aria-valuetext")
        if text is not None:
            assert text == value, f"value text {text!r} != {value!r}"
        else:
            expect(page.get_by_text(value, exact=True).first).to_be_visible(timeout=SLICE_MS)
    see(page, check)


def half_up(value: float, places: int) -> float:
    quantum = Decimal(1).scaleb(-places)
    return float(Decimal(repr(value)).quantize(quantum, rounding=ROUND_HALF_UP))


def fmt(value: float, locale: str, decimals: int = 0) -> str:
    negative = value < 0 and round(abs(value), decimals) != 0
    whole, _, frac = f"{abs(value):.{decimals}f}".partition(".")
    if locale == "es":
        grouped = f"{int(whole):,}".replace(",", ".") if len(whole) >= 5 else whole
        out = grouped + ("," + frac if decimals else "")
    else:
        out = f"{int(whole):,}" + ("." + frac if decimals else "")
    return ("-" if negative else "") + out


@contextlib.contextmanager
def opened(browser: Browser, url: str, **options: Any) -> Iterator[Page]:
    manager = open_app(browser, url, **options)
    if hasattr(manager, "__enter__"):
        with manager as page:
            yield page
        return
    page = next(manager)
    try:
        yield page
    finally:
        with contextlib.suppress(StopIteration):
            next(manager)


@contextlib.contextmanager
def holding(page: Page, glob: str) -> Iterator[Any]:
    manager = held(page, glob)
    if hasattr(manager, "__enter__"):
        with manager as handle:
            yield handle
        return
    handle = next(manager)
    try:
        yield handle
    finally:
        with contextlib.suppress(StopIteration):
            next(manager)


@dataclass(eq=False)
class Player:
    base: str
    http: httpx.Client
    email: str
    password: str
    name: str
    locale: str
    id: str

    def on(self, base: str) -> "Player":
        http = httpx.Client(base_url=base, timeout=HTTP_S, follow_redirects=False)
        r = http.post("/api/auth/signin", json={"email": self.email, "password": self.password})
        assert r.status_code == 200, r.text
        return replace(self, base=base, http=http)


def identity(prefix: str = "lw") -> tuple[str, str]:
    parts = unique(prefix)
    email = next((p for p in parts if "@" in p), f"{uuid.uuid4().hex[:20]}@linewright.test")
    return email, prefix[:2] + uuid.uuid4().hex[:12]


def signup(base: str, locale: str = "en", *, name: str | None = None, password: str = PASSWORD,
           headers: dict[str, str] | None = None) -> Player:
    email, display = identity()
    http = httpx.Client(base_url=base, timeout=HTTP_S, follow_redirects=False, headers=headers or {})
    r = http.post("/api/auth/signup", json={
        "email": email, "password": password, "display_name": name or display, "locale": locale})
    assert r.status_code == 201, r.text
    return Player(base, http, email, password, name or display, locale, r.json()["account"]["id"])


def mails_to(mail: Any, email: str, count: int, seconds: float = MAIL_S) -> list[dict[str, Any]]:
    def mine() -> list[dict[str, Any]] | None:
        found = [m for m in mail.messages(0, 0.5)
                 if email.lower() in [a.lower() for a in mail_addresses(m.get("To"))]]
        return found if len(found) >= count else None
    return poll(mine, seconds, f"{count} email(s) to {email}")


def message_tokens(message: dict[str, Any]) -> list[tuple[str, str]]:
    found: list[tuple[str, str]] = []
    for part in (message.get("HTML") or "", mail_text(message) or ""):
        for kind, token in LINK_RE.findall(part):
            if (kind, token) not in found:
                found.append((kind, token))
    return found


def new_token(mail: Any, email: str, kind: str, known: set[str]) -> str:
    def fresh() -> str | None:
        for m in mail.messages(0, 0.5):
            if email.lower() not in [a.lower() for a in mail_addresses(m.get("To"))]:
                continue
            for k, token in message_tokens(m):
                if k == kind and token not in known:
                    return token
        return None
    return poll(fresh, MAIL_S, f"new {kind} link for {email}")


def verify(p: Player, mail: Any) -> None:
    token = new_token(mail, p.email, "verify", set())
    r = p.http.post("/api/auth/verify", json={"token": token})
    assert r.status_code == 200, r.text


def verified(base: str, mail: Any, locale: str = "en") -> Player:
    p = signup(base, locale)
    verify(p, mail)
    return p


def befriend(a: Player, b: Player) -> None:
    r = a.http.post("/api/friends/requests", json={"display_name": b.name, "client_request_id": idempotency_key()})
    assert r.status_code == 201, r.text
    r = b.http.post(f"/api/friends/requests/{r.json()['request']['id']}/accept")
    assert r.status_code == 200, r.text


def crew(base: str, mail: Any, *locales: str) -> list[Player]:
    players = [verified(base, mail, loc) for loc in locales]
    for other in players[1:]:
        befriend(players[0], other)
    return players


def equipped_hero(p: Player) -> dict[str, Any]:
    hid = p.http.get("/api/me").json()["equipped_character_id"]
    return p.http.get(f"/api/characters/{hid}").json()["character"]


def hero_body(hero: dict[str, Any], **changes: Any) -> dict[str, Any]:
    body = {k: hero[k] for k in ("revision", "name", "parts", "proportions", "pose", "material",
                                 "accessories", "model_id", "weapon_id")}
    body.update(changes)
    return body


def slot_hero(p: Player, slot: int) -> dict[str, Any] | None:
    return next((c for c in p.http.get("/api/characters").json()["characters"] if c["slot"] == slot), None)


def stroke(points: list[tuple[float, float]], thickness: float = 0.04) -> dict[str, Any]:
    return {"thickness": thickness, "points": [list(pt) for pt in points]}


def line_strokes(count: int, points_each: int, thickness: float = 0.04) -> list[dict[str, Any]]:
    return [stroke([(-0.9 + 1.8 * i / (points_each - 1), 0.0) for i in range(points_each)], thickness)
            for _ in range(count)]


def forge(p: Player, strokes: list[dict[str, Any]], hero_id: str | None = None) -> dict[str, Any]:
    r = p.http.post("/api/weapons", json={"character_id": hero_id or equipped_hero(p)["id"], "strokes": strokes})
    assert r.status_code == 201, r.text
    return r.json()["weapon"]


def build_glb(*, hips_rotation: tuple[float, ...] | None = None, hips_matrix: bool = False,
              missing: tuple[str, ...] = (), skins: int = 1, triangles: int = 0, triangle_nodes: int = 1,
              unused_triangles: int = 0, strip_indices: int = 0, bad_refs: int = 0, version: int = 2,
              extensions: tuple[str, ...] = ()) -> bytes:
    blob = bytearray()
    views: list[dict[str, Any]] = []
    accessors: list[dict[str, Any]] = []

    def add_view(data: bytes, target: int) -> int:
        while len(blob) % 4:
            blob.append(0)
        views.append({"buffer": 0, "byteOffset": len(blob), "byteLength": len(data), "target": target})
        blob.extend(data)
        return len(views) - 1

    def add_accessor(view: int, ctype: int, count: int, kind: str, **extra: Any) -> int:
        accessors.append({"bufferView": view, "componentType": ctype, "count": count, "type": kind, **extra})
        return len(accessors) - 1

    position = add_accessor(add_view(struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0), 34962), 5126, 3, "VEC3",
                            min=[0, 0, 0], max=[1, 1, 0])
    joints = add_accessor(add_view(bytes(12), 34962), 5121, 3, "VEC4")
    weights = add_accessor(add_view(struct.pack("<12f", *([1, 0, 0, 0] * 3)), 34962), 5126, 3, "VEC4")
    nodes: list[dict[str, Any]] = [{"name": f"extra{i}" if bone in missing else bone}
                                   for i, bone in enumerate(HUMANOID_BONES)]
    nodes[0]["children"] = list(range(1, len(HUMANOID_BONES)))
    if hips_matrix:
        nodes[0]["matrix"] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1]
    elif hips_rotation is not None:
        nodes[0]["rotation"] = list(hips_rotation)
    meshes: list[dict[str, Any]] = [{"primitives": [{
        "attributes": {"POSITION": position, "JOINTS_0": joints, "WEIGHTS_0": weights}, "mode": 0}]}]
    nodes.append({"name": "body", "mesh": 0, "skin": 0})
    scene = [0, len(nodes) - 1]

    def index_mesh(count: int, mode: int) -> int:
        values = ([0, 1, 2] * (count // 3 + 1))[:count]
        idx = add_accessor(add_view(struct.pack(f"<{count}H", *values), 34963), 5123, count, "SCALAR")
        meshes.append({"primitives": [{"attributes": {"POSITION": position}, "indices": idx, "mode": mode}]})
        return len(meshes) - 1

    if triangles:
        mesh = index_mesh(3 * triangles, 4)
        for _ in range(triangle_nodes):
            nodes.append({"mesh": mesh})
            scene.append(len(nodes) - 1)
    if unused_triangles:
        index_mesh(3 * unused_triangles, 4)
    if strip_indices:
        mesh = index_mesh(strip_indices, 5)
        nodes.append({"mesh": mesh})
        scene.append(len(nodes) - 1)
    scene.extend(len(nodes) + 50 + i for i in range(bad_refs))
    while len(blob) % 4:
        blob.append(0)
    doc: dict[str, Any] = {
        "asset": {"version": "2.0"}, "scene": 0, "scenes": [{"nodes": scene}], "nodes": nodes,
        "meshes": meshes, "skins": [{"joints": list(range(len(HUMANOID_BONES)))} for _ in range(skins)],
        "accessors": accessors, "bufferViews": views, "buffers": [{"byteLength": len(blob)}],
    }
    if extensions:
        doc["extensionsUsed"] = list(extensions)
    js = json.dumps(doc, separators=(",", ":")).encode()
    js += b" " * (-len(js) % 4)
    total = 12 + 8 + len(js) + 8 + len(blob)
    return (struct.pack("<4sII", b"glTF", version, total) + struct.pack("<I4s", len(js), b"JSON") + js
            + struct.pack("<I4s", len(blob), b"BIN\x00") + bytes(blob))


def model_name(prefix: str = "hero") -> str:
    return f"{prefix}_{uuid.uuid4().hex[:10]}.glb"


def upload(p: Player, data: bytes, filename: str, ctype: str = "model/gltf-binary") -> httpx.Response:
    return p.http.post("/api/models", content=data, headers={
        "Content-Type": ctype, "X-Filename": urllib.parse.quote(filename, safe="")})


def verdict(p: Player, mid: str) -> dict[str, Any]:
    def judged() -> dict[str, Any] | None:
        m = p.http.get(f"/api/models/{mid}").json()["model"]
        return m if m["status"] in ("accepted", "equipped", "rejected") else None
    return poll(judged, VERDICT_MAX_S + SLACK_S, f"verdict for model {mid}")


def judged_upload(p: Player, data: bytes, filename: str | None = None) -> dict[str, Any]:
    r = upload(p, data, filename or model_name())
    assert r.status_code == 201, r.text
    return verdict(p, r.json()["model"]["id"])


def rule(model: dict[str, Any], rule_id: str) -> dict[str, Any]:
    return next(r for r in model["report"]["rules"] if r["id"] == rule_id)


def equip_model(p: Player, mid: str | None) -> httpx.Response:
    hero = equipped_hero(p)
    return p.http.put(f"/api/characters/slots/{hero['slot']}", json=hero_body(hero, model_id=mid))


def make_party(leader: Player, members: list[Player], story: str = "smudged-keep") -> str:
    r = leader.http.post("/api/parties", json={"story_id": story})
    assert r.status_code == 201, r.text
    pid = r.json()["party"]["id"]
    for m in members:
        token = invite(leader, pid, m)
        r = m.http.post(f"/api/invites/{token}/accept")
        assert r.status_code == 200, r.text
    return pid


def invite(leader: Player, pid: str, member: Player) -> str:
    r = leader.http.post(f"/api/parties/{pid}/invites", json={"account_id": member.id})
    assert r.status_code == 201, r.text
    return r.json()["invite"]["token"]


def party_of(p: Player, pid: str) -> dict[str, Any]:
    r = p.http.get(f"/api/parties/{pid}")
    assert r.status_code == 200, r.text
    return r.json()["party"]


def start_coop(pid: str, leader: Player, members: list[Player]) -> str:
    assert leader.http.post(f"/api/parties/{pid}/ready-check").status_code == 201
    for p in [leader, *members]:
        r = p.http.post(f"/api/parties/{pid}/ready-check/response", json={"ready": True})
        assert r.status_code == 200, r.text
    party = poll(lambda: (lambda pa: pa if pa["status"] == "in_session" and pa["session_id"] else None)(
        party_of(leader, pid)), RT_S, "party in session")
    return party["session_id"]


def start_solo(p: Player, chapter: int = 1) -> dict[str, Any]:
    r = p.http.post(f"/api/stories/{SOLO}/sessions", json={"chapter": chapter})
    assert r.status_code == 201, r.text
    return r.json()


def snapshot(p: Player, sid: str) -> dict[str, Any]:
    r = p.http.get(f"/api/sessions/{sid}")
    assert r.status_code == 200, r.text
    return r.json()["session"]


def member(snap: dict[str, Any], account_id: str) -> dict[str, Any] | None:
    return next((m for m in snap["members"] if m["account_id"] == account_id), None)


def channel_messages(p: Player, channel: str) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    after = 0
    while True:
        r = p.http.get(f"/api/chat/{channel}/messages", params={"after_seq": after})
        assert r.status_code == 200, r.text
        page = r.json()["messages"]
        out.extend(page)
        if len(page) < 100:
            return out
        after = page[-1]["seq"]


def post_chat(p: Player, channel: str, body: str, cid: str | None = None) -> httpx.Response:
    return p.http.post(f"/api/chat/{channel}/messages", json={"client_message_id": cid or idempotency_key(), "body": body})


RT_OPEN = """(key) => new Promise((resolve) => {
  window.__lw = window.__lw || {};
  const box = { msgs: [], snap: null, closed: false };
  window.__lw[key] = box;
  const ws = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/api/realtime');
  box.ws = ws;
  ws.onmessage = (e) => {
    const raw = String(e.data);
    let type = null;
    try { type = JSON.parse(raw).type; } catch (err) { type = null; }
    if (type === 'snapshot') { box.snap = raw; } else { box.msgs.push(raw); }
  };
  ws.onopen = () => resolve(true);
  ws.onclose = () => { box.closed = true; resolve(false); };
})"""


class Tab:

    def __init__(self, ctx: BrowserContext, base: str) -> None:
        self.page = ctx.new_page()
        self.page.goto(base + "/api/health")
        self.log: list[dict[str, Any]] = []
        assert self.page.evaluate(RT_OPEN, "t"), "realtime socket did not open"

    def send(self, msg: dict[str, Any]) -> None:
        self.page.evaluate("([m]) => window.__lw.t.ws.send(m)", [json.dumps(msg)])

    def pull(self) -> list[dict[str, Any]]:
        raws = self.page.evaluate("([i]) => window.__lw.t.msgs.slice(i)", [len(self.log)])
        self.log.extend(json.loads(r) for r in raws)
        return self.log

    def wait(self, pred: Callable[[dict[str, Any]], bool], since: int = 0, seconds: float = RT_S,
             what: str = "realtime message") -> dict[str, Any]:
        return poll(lambda: next((m for m in self.pull()[since:] if pred(m)), None), seconds, what)

    def events(self, stream: str) -> list[dict[str, Any]]:
        return [m for m in self.pull() if m.get("type") == "event" and m.get("stream") == stream]

    def intent(self, sid: str, action: str, intent_id: str | None = None, **extra: Any) -> dict[str, Any]:
        iid = intent_id or str(uuid.uuid4())
        mark = len(self.pull())
        self.send({"type": "intent", "session_id": sid, "intent_id": iid, "action": action, **extra})
        return self.wait(lambda m: m.get("type") == "ack" and m.get("intent_id") == iid, mark, what=f"ack {iid}")

    def close(self) -> None:
        self.page.close()


def connect(ctx: BrowserContext, base: str, *, resume: dict[str, int] | None = None,
            session_id: str | None = None) -> Tab:
    tab = Tab(ctx, base)
    tab.send({"type": "hello", "resume": resume or {}})
    tab.send({"type": "heartbeat"})
    if session_id:
        tab.send({"type": "join_session", "session_id": session_id})
        tab.wait(lambda m: m.get("type") in ("joined", "join_refused") and m.get("session_id") == session_id)
    return tab


@contextlib.contextmanager
def account_ctx(browser: Browser, p: Player, base: str | None = None) -> Iterator[BrowserContext]:
    ctx = browser.new_context()
    try:
        r = ctx.request.post((base or p.base) + "/api/auth/signin", data={"email": p.email, "password": p.password})
        assert r.status == 200, r.text()
        yield ctx
    finally:
        ctx.close()


@contextlib.contextmanager
def ui(browser: Browser, p: Player | None, path: str, *, base: str | None = None,
       viewport: tuple[int, int] | None = None, touch_screen: bool = False, accept_language: str | None = None,
       wrong_clock: bool = False, **options: Any) -> Iterator[Page]:
    root = base or (p.base if p else "")
    with opened(browser, root + "/signin", **options) as page:
        if viewport:
            page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        if touch_screen:
            enable_touch(page)
        if accept_language:
            page.set_extra_http_headers({"Accept-Language": accept_language})
        if p:
            r = page.request.post(root + "/api/auth/signin", data={"email": p.email, "password": p.password})
            assert r.status == 200, r.text()
        if wrong_clock:
            page.clock.set_system_time(WRONG_CLOCK)
        page.goto(root + path)
        yield page


def walk(p: Player, tab: Tab, sid: str, x: float, z: float) -> dict[str, Any]:
    ack = tab.intent(sid, "move_to", x=x, z=z)
    assert ack["applied"] is True and ack["reason"] is None, ack

    def arrived() -> bool:
        pos = member(snapshot(p, sid), p.id)["position"]
        return abs(pos["x"] - x) < 0.001 and abs(pos["z"] - z) < 0.001
    poll(arrived, WALK_S, f"hero at ({x}, {z})")
    return ack


def collected(snap: dict[str, Any]) -> set[str]:
    return {m["id"] for m in snap["motes"] if m["collected_by"]}


def finish_chapter(p: Player, tab: Tab, sid: str) -> None:
    for x, z in ((4, 0), (4, 4), (0, 4), (0, -8)):
        walk(p, tab, sid, x, z) if (x, z) != (0, -8) else tab.intent(sid, "move_to", x=x, z=z)
    poll(lambda: snapshot(p, sid)["status"] == "complete" or None, WALK_S, "session complete")


def deployed_dir() -> str:
    module = sys.modules.get("conftest")
    return str(getattr(module, "DEPLOYED_APP", None) or os.environ.get("DEPLOYED_APP") or "/app")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    port = s.getsockname()[1]
    s.close()
    return port


class AppCopy:
    def __init__(self, overrides: dict[str, str]) -> None:
        self.port = free_port()
        self.base = f"http://127.0.0.1:{self.port}"
        self.env = {**os.environ, **overrides, "APP_PUBLIC_PORT": str(self.port), "APP_PUBLIC_URL": self.base}
        self.log = tempfile.NamedTemporaryFile(prefix="lw-copy-", suffix=".log", delete=False)
        self.proc: subprocess.Popen[bytes] | None = None

    def tail(self) -> str:
        return Path(self.log.name).read_text(errors="replace")[-4000:]

    def start(self) -> None:
        serve = json.loads(Path("/app/run.json").read_text())["serve"]
        self.proc = subprocess.Popen(serve, shell=True, cwd=deployed_dir(), env=self.env, stdout=self.log,
                                     stderr=subprocess.STDOUT, start_new_session=True)

        def healthy() -> bool:
            assert self.proc and self.proc.poll() is None, f"copy exited:\n{self.tail()}"
            with contextlib.suppress(httpx.HTTPError):
                return httpx.get(self.base + "/api/health", timeout=2).status_code == 200
            return False
        poll(healthy, BOOT_S, f"copy health\n{self.tail()}")

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                os.killpg(self.proc.pid, signal.SIGKILL)
                self.proc.wait()


class Relay:
    def __init__(self, port: int, target: tuple[str, int]) -> None:
        self.port, self.target, self.sock = port, target, None

    def start(self) -> None:
        self.sock = socket.socket()
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", self.port))
        self.sock.listen(16)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.sock.accept()
            except OSError:
                return
            up = socket.create_connection(self.target)
            for a, b in ((conn, up), (up, conn)):
                threading.Thread(target=self._pump, args=(a, b), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        with contextlib.suppress(OSError):
            while data := src.recv(65536):
                dst.sendall(data)
        with contextlib.suppress(OSError):
            dst.shutdown(socket.SHUT_WR)

    def stop(self) -> None:
        if self.sock:
            with contextlib.suppress(OSError):
                self.sock.shutdown(socket.SHUT_RDWR)
            self.sock.close()


def test_wf_account_signup_to_hangar(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    email, name = identity("ja")

    def hangar_ok(page: Page) -> None:
        see(page, lambda: expect(page).to_have_title(titled("格納庫"), timeout=SLICE_MS))
        assert lang_of(page) == "ja"
        region = page.get_by_role("region", name="装備中のヒーロー")
        appears(page, region.get_by_role("heading", level=1, name=name))
        appears(page, page.get_by_role("application", name="ヒーローのプレビュー"))

    with ui(browser, None, "/", base=base, accept_language="es-ES,es;q=0.9") as page:
        assert lang_of(page) == "es"
        select(page.get_by_role("combobox", name="Idioma"), "日本語")
        appears(page, page.get_by_role("combobox", name="言語"))
        page.goto(base + "/signup")
        assert lang_of(page) == "ja"
        expect(page).to_have_title(titled("アカウント作成"))
        page.get_by_role("textbox", name="表示名").fill(name)
        page.get_by_role("textbox", name="メールアドレス").fill(email)
        page.get_by_role("textbox", name="パスワード").fill(PASSWORD)
        page.get_by_role("button", name="アカウントを作成").click()
        message = mails_to(mail, email, 1)[0]
        assert message["Subject"] == "Linewright アカウントの確認"
        token = next(t for k, t in message_tokens(message) if k == "verify")
        page.goto(f"{base}/verify?token={token}")
        appears(page, page.get_by_role("heading", name="メールアドレスを確認しました。"))
        assert "日本語" in combo_text(page.get_by_role("combobox", name="言語"))
        page.request.post(base + "/api/auth/signout")
        page.goto(base + "/signin")
        page.get_by_role("textbox", name="メールアドレス").fill(email)
        page.get_by_role("textbox", name="パスワード").fill(PASSWORD)
        page.get_by_role("button", name="サインイン").click()
        see(page, lambda: at(page, "/hangar"))
        hangar_ok(page)
        page.reload()
        hangar_ok(page)
        page.request.post(base + "/api/auth/signout")
        for path in ("/", "/signin", "/forgot-password"):
            page.goto(base + path)
            assert lang_of(page) == "ja", path
            assert "日本語" in combo_text(page.get_by_role("combobox", name="言語")), path
    player = Player(base, httpx.Client(base_url=base, timeout=HTTP_S), email, PASSWORD, name, "ja", "")
    with ui(browser, player, "/hangar") as fresh:
        hangar_ok(fresh)
    r = player.http.post("/api/auth/signin", json={"email": email, "password": PASSWORD})
    assert r.status_code == 200
    account = r.json()["account"]
    assert account["email_verified"] is True and account["locale"] == "ja"


def test_wf_account_signin_lands_hangar(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = signup(base, "en")
    hero = equipped_hero(p)
    r = p.http.put(f"/api/characters/slots/{hero['slot']}", json=hero_body(hero, name=RENAMED_HERO))
    assert r.status_code == 200, r.text

    def hangar_ok(page: Page) -> None:
        see(page, lambda: expect(page).to_have_title(titled("Hangar"), timeout=SLICE_MS))
        region = page.get_by_role("region", name="Equipped hero")
        appears(page, region.get_by_role("heading", level=1, name=RENAMED_HERO))
        appears(page, page.get_by_role("application", name="Hero preview"))

    with ui(browser, None, "/signin", base=base) as page:
        page.get_by_role("textbox", name="Email").fill(p.email)
        page.get_by_role("textbox", name="Password").fill(p.password)
        page.get_by_role("button", name="Sign in").click()
        see(page, lambda: at(page, "/hangar"))
        hangar_ok(page)
        page.reload()
        assert page.url.endswith("/hangar")
        hangar_ok(page)
    with ui(browser, p, "/hangar") as fresh:
        assert fresh.url.endswith("/hangar")
        hangar_ok(fresh)


def test_wf_account_name_password_limits(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    es = {"Accept-Language": "es-ES"}
    display_msg = "El nombre visible debe tener entre 3 y 20 caracteres."
    password_msg = "La contraseña debe tener entre 10 y 128 caracteres."
    cases = [
        ("display_name", "ab", PASSWORD, display_msg),
        ("display_name", "  ab  ", PASSWORD, display_msg),
        ("display_name", EMOJI * (NAME_MAX + 1), PASSWORD, display_msg),
        ("password", None, "a" * 9, password_msg),
        ("password", None, EMOJI * 9, password_msg),
        ("password", None, "a" * (PASSWORD_MAX + 1), password_msg),
    ]
    for field_name, display, password, message in cases:
        email, fresh = identity()
        r = httpx.post(base + "/api/auth/signup", headers=es, timeout=HTTP_S, json={
            "email": email, "password": password, "display_name": display or fresh, "locale": "es"})
        assert r.status_code == 422, (field_name, display, r.text)
        assert r.json()["error"]["fields"][field_name] == message
        assert httpx.post(base + "/api/auth/signin", json={"email": email, "password": password},
                          timeout=HTTP_S).status_code == 401
    for display, password in ((EMOJI * 10 + uuid.uuid4().hex[:10], PASSWORD),
                              (None, EMOJI * 33), (None, "b" * PASSWORD_MAX)):
        p = signup(base, "es", name=display, password=password)
        assert p.http.get("/api/me").json()["account"]["display_name"] == p.name
    p = signup(base, "es")
    hero = equipped_hero(p)
    r = p.http.put(slot_path(2), json=hero_body(hero, revision=None, name="ab"))
    assert r.status_code == 422
    assert r.json()["error"]["fields"]["name"] == "El nombre del héroe debe tener entre 3 y 20 caracteres."
    assert slot_hero(p, 2) is None
    r = p.http.put(slot_path(2), json=hero_body(hero, revision=None, name=EMOJI * NAME_MAX))
    assert r.status_code == 201, r.text
    email, fresh = identity()
    with ui(browser, None, "/signup", base=base, accept_language="es-ES") as page:
        calls: list[str] = []
        page.route("**/api/auth/signup", lambda route: (calls.append(route.request.url), route.continue_()))
        page.get_by_role("textbox", name="Nombre visible").fill("ab")
        page.get_by_role("textbox", name="Correo electrónico").fill(email)
        page.get_by_role("textbox", name="Contraseña").fill(PASSWORD)
        page.get_by_role("button", name="Crear cuenta").click()
        appears(page, page.get_by_text(display_msg).first)
        expect(page.get_by_role("textbox", name="Nombre visible")).to_have_attribute("aria-invalid", "true")
        assert calls == []
    assert httpx.post(base + "/api/auth/signin", json={"email": email, "password": PASSWORD},
                      timeout=HTTP_S).status_code == 401


def test_wf_account_email_links(browser: Browser, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    p = signup(base)
    t1 = new_token(mail, p.email, "verify", set())
    r = p.http.post("/api/auth/verification/resend")
    assert r.status_code == 202 and r.json()["verification_email"] == "sent"
    t2 = new_token(mail, p.email, "verify", {t1})
    anon = httpx.Client(base_url=base, timeout=HTTP_S)

    def gone(path: str, body: dict[str, Any], code: str, message: str) -> None:
        r = anon.post(path, json=body)
        assert r.status_code == 410, r.text
        assert r.json()["error"]["code"] == code and r.json()["error"]["message"] == message

    replaced = "A newer link was sent. Use the link in the latest email."
    used = "This link has already been used."
    expired = "This link has expired. Request a new one."
    gone("/api/auth/verify", {"token": t1}, "link_replaced", replaced)
    assert anon.post("/api/auth/verify", json={"token": t2}).json()["account"]["email_verified"] is True
    gone("/api/auth/verify", {"token": t2}, "link_used", used)
    assert anon.post("/api/auth/verify", json={"token": uuid.uuid4().hex}).status_code == 404
    assert anon.post("/api/auth/password-reset", json={"email": p.email}).status_code == 202
    r1 = new_token(mail, p.email, "reset-password", set())
    assert anon.post("/api/auth/password-reset", json={"email": p.email}).status_code == 202
    r2 = new_token(mail, p.email, "reset-password", {r1})
    gone("/api/auth/password-reset/confirm", {"token": r1, "password": NEW_PASSWORD}, "link_replaced", replaced)
    assert anon.post("/api/auth/password-reset/confirm", json={"token": r2, "password": NEW_PASSWORD}).status_code == 200
    assert anon.post("/api/auth/password-reset", json={"email": p.email}).status_code == 202
    r3 = new_token(mail, p.email, "reset-password", {r1, r2})
    gone("/api/auth/password-reset/confirm", {"token": r2, "password": NEW_PASSWORD}, "link_used", used)
    first = anon.post("/api/auth/password-reset/confirm", json={"token": r3, "password": "short"})
    assert first.status_code == 422, "a fresh link must not already be expired"
    poll(lambda: anon.post("/api/auth/password-reset/confirm",
                           json={"token": r3, "password": "short"}).status_code == 410,
         SHORT_TTL_WAIT_S, "reset link expiry")
    gone("/api/auth/password-reset/confirm", {"token": r3, "password": NEW_PASSWORD}, "link_expired", expired)
    gone("/api/auth/password-reset/confirm", {"token": r1, "password": NEW_PASSWORD}, "link_replaced", replaced)
    with ui(browser, None, f"/verify?token={t2}", base=base) as page:
        appears(page, page.get_by_role("heading", name=used))
        page.goto(f"{base}/verify?token={t1}")
        appears(page, page.get_by_role("heading", name=replaced))
        page.goto(f"{base}/reset-password?token={r3}")
        button = page.get_by_role("button", name="Set new password")
        if button.count():
            page.get_by_role("textbox", name="Password").fill(NEW_PASSWORD)
            button.click()
        appears(page, page.get_by_role("heading", name=expired))


def test_wf_account_picker_public_pages(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    junk = uuid.uuid4().hex
    paths = ["/", "/signup", "/signin", "/forgot-password", f"/reset-password?token={junk}", f"/verify?token={junk}",
             "/no-such-page-" + uuid.uuid4().hex[:6]]
    with ui(browser, None, "/", base=base) as page:
        for path in paths:
            response = page.goto(base + path)
            combo = page.get_by_role("combobox", name="Language")
            appears(page, combo)
            assert picker_options(page, combo) == ["English", "日本語", "Español"], path
        assert response is not None and response.status == 404
    p = signup(base, "es")
    with ui(browser, p, "/hangar", accept_language="ja") as page:
        appears(page, page.get_by_role("combobox", name="Idioma"))
        page.request.post(base + "/api/auth/signout")
        for path in ("/", "/signin"):
            page.goto(base + path)
            assert lang_of(page) == "es"
            assert "Español" in combo_text(page.get_by_role("combobox", name="Idioma"))


def test_wf_outages_mail_down_signup_banner(browser: Browser, app_url: str, mail: Any) -> None:
    base, down = app_url.rstrip("/"), env_url("APP_MAIL_DOWN_URL")
    email, name = identity("es")
    banner_text = "No pudimos enviar tu correo de verificación. Reenvíalo cuando quieras."
    with ui(browser, None, "/signup", base=down, accept_language="es-ES") as page:
        page.get_by_role("textbox", name="Nombre visible").fill(name)
        page.get_by_role("textbox", name="Correo electrónico").fill(email)
        page.get_by_role("textbox", name="Contraseña").fill(PASSWORD)
        page.get_by_role("button", name="Crear cuenta").click()
        p = poll(lambda: (lambda c: c if c.post("/api/auth/signin", json={"email": email, "password": PASSWORD}
                                               ).status_code == 200 else None)(
            httpx.Client(base_url=down, timeout=HTTP_S)), UI_S, "account created")
        account = p.get("/api/me").json()["account"]
        assert account["verification_email"] == "not_sent" and account["email_verified"] is False
        page.goto(down + "/hangar")
        banner = page.get_by_role("alert").filter(has_text=banner_text)
        appears(page, banner)
        page.reload()
        appears(page, banner)
        page.request.post(down + "/api/auth/signout")
        page.request.post(down + "/api/auth/signin", data={"email": email, "password": PASSWORD})
        page.goto(down + "/hangar")
        appears(page, banner)
        page.get_by_role("button", name="Reenviar correo").click()
        assert p.post("/api/auth/verification/resend").json()["error"]["code"] == "mail_unavailable"
        page.reload()
        appears(page, banner)
    assert p.get("/api/me").json()["account"]["verification_email"] == "not_sent"
    assert [m for m in mail.messages(0, 1.5) if email in mail_addresses(m.get("To"))] == []
    player = Player(base, httpx.Client(base_url=base, timeout=HTTP_S), email, PASSWORD, name, "es", "")
    with ui(browser, player, "/hangar") as page:
        appears(page, page.get_by_role("alert").filter(has_text=banner_text))
        page.get_by_role("button", name="Reenviar correo").click()
        shows(page, page.get_by_role("status", name="Avisos"), f"Correo de verificación enviado a {email}.")
        see(page, lambda: expect(page.get_by_role("alert").filter(has_text=banner_text)).to_have_count(0, timeout=SLICE_MS))
    assert mails_to(mail, email, 1)[0]["Subject"] == "Confirma tu cuenta de Linewright"
    assert p.get("/api/me").json()["account"]["verification_email"] == "sent"


def test_wf_outages_upload_storage_down(browser: Browser, app_url: str) -> None:
    base, down = app_url.rstrip("/"), env_url("APP_MINIO_DOWN_URL")
    p = signup(base, "ja")
    pd = p.on(down)
    banner_text = "モデルの保存先に接続できません。ファイルは保存されていません。数分後にもう一度お試しください。"
    name = model_name("down")
    with ui(browser, p, "/models", base=down) as page:
        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name="モデルをアップロード").click()
        chooser.value.set_files(files={"name": name, "mimeType": "model/gltf-binary", "buffer": build_glb()})
        banner = page.get_by_role("alert").filter(has_text=banner_text)
        appears(page, banner)
        r = upload(pd, build_glb(), model_name("down"))
        assert r.status_code == 503 and r.json()["error"]["code"] == "storage_unavailable"
        page.reload()
        appears(page, banner)
        expect(page.get_by_role("list", name="マイモデル").get_by_role("button", name=name)).to_have_count(0)
    assert p.http.get("/api/me").json()["account"]["storage_notice"] == "upload_unavailable"
    assert p.http.get("/api/models").json()["models"] == []
    assert S3().keys(f"models/{p.id}/") == []
    assert upload(p, build_glb(), model_name()).status_code == 201
    assert p.http.get("/api/me").json()["account"]["storage_notice"] is None
    with ui(browser, p, "/models") as page:
        appears(page, page.get_by_role("list", name="マイモデル"))
        expect(page.get_by_role("alert").filter(has_text=banner_text)).to_have_count(0)


def test_wf_outages_delete_all_or_nothing(browser: Browser, app_url: str) -> None:
    base, down = app_url.rstrip("/"), env_url("APP_MINIO_DOWN_URL")
    p = signup(base, "es")
    name = model_name("del")
    model = judged_upload(p, build_glb(), name)
    assert model["status"] == "accepted"
    assert equip_model(p, model["id"]).status_code == 200
    prefix = f"models/{p.id}/{model['id']}/"
    keys = sorted(S3().keys(prefix))
    assert keys == [prefix + "original.glb", prefix + "thumbnail.png"]
    pd = p.on(down)
    r = pd.http.delete(f"/api/models/{model['id']}")
    assert r.status_code == 503 and r.json()["error"]["code"] == "storage_unavailable"
    assert p.http.get(f"/api/models/{model['id']}").json()["model"]["status"] == "equipped"
    assert equipped_hero(p)["model_id"] == model["id"]
    assert sorted(S3().keys(prefix)) == keys
    assert p.http.get("/api/me").json()["account"]["storage_notice"] == "delete_unavailable"
    with ui(browser, p, "/models", base=down) as page:
        item = page.get_by_role("list", name="Mis modelos").get_by_role("button", name=name)
        appears(page, item)
        item.click()
        delete = page.get_by_role("button", name="Eliminar modelo")
        delete.click()
        appears(page, page.get_by_role("alert").filter(
            has_text="El almacenamiento de modelos no está disponible. Tu modelo no se ha eliminado. "
                     "Inténtalo de nuevo en unos minutos."))
        expect(item).to_have_attribute("aria-current", "true")
        holds(page, page.get_by_role("list", name="Mis modelos").get_by_role("listitem").filter(
            has=page.get_by_role("button", name=name)), "Equipado")
        focused(page, delete)
    assert p.http.delete(f"/api/models/{model['id']}").status_code == 204
    assert p.http.get(f"/api/models/{model['id']}").status_code == 404
    assert S3().keys(prefix) == []
    assert equipped_hero(p)["model_id"] is None
    assert p.http.get("/api/me").json()["account"]["storage_notice"] is None


def test_wf_outages_recover_without_restart(app_url: str, mail: Any) -> None:
    for down in (env_url("APP_MAIL_DOWN_URL"), env_url("APP_MINIO_DOWN_URL")):
        r = httpx.get(down + "/api/health", timeout=HTTP_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
        p = signup(down)
        assert p.http.get("/api/characters").status_code == 200
        assert p.http.post("/api/weapons/preview", json={"strokes": []}).status_code == 200
    smtp_target = (os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    s3 = urllib.parse.urlparse(os.environ["S3_ENDPOINT"])
    s3_target = (s3.hostname or "127.0.0.1", s3.port or (443 if s3.scheme == "https" else 80))
    smtp_relay, s3_relay = Relay(free_port(), smtp_target), Relay(free_port(), s3_target)
    copy = AppCopy({"SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(smtp_relay.port),
                    "S3_ENDPOINT": f"http://127.0.0.1:{s3_relay.port}"})
    try:
        copy.start()
        p = signup(copy.base)
        assert p.http.get("/api/me").json()["account"]["verification_email"] == "not_sent"
        r = p.http.post("/api/auth/verification/resend")
        assert r.status_code == 503 and r.json()["error"]["code"] == "mail_unavailable"
        assert upload(p, build_glb(), model_name()).status_code == 503
        smtp_relay.start()
        s3_relay.start()
        r = p.http.post("/api/auth/verification/resend")
        assert r.status_code == 202, f"{r.text}\n{copy.tail()}"
        assert mails_to(mail, p.email, 1)
        r = upload(p, build_glb(), model_name())
        assert r.status_code == 201, r.text
        assert f"models/{p.id}/{r.json()['model']['id']}/original.glb" in S3().keys(f"models/{p.id}/")
    finally:
        copy.stop()
        smtp_relay.stop()
        s3_relay.stop()


def test_wf_hero_builder_keyboard_save(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "es")
    with ui(browser, p, "/builder") as page:
        for group in ("Cabeza", "Piernas", "Acabado", "Anclaje de mano izquierda"):
            page.get_by_role("radiogroup", name=group, exact=True).get_by_role("radio", checked=True).focus()
            page.keyboard.press("ArrowRight")
        spine = page.get_by_role("slider", name="Largo de la columna")
        spine.focus()
        for _ in range(5):
            page.keyboard.press("ArrowRight")
        value_ok(page, spine, "1,25")
        arm = page.get_by_role("slider", name="Ángulo del brazo derecho")
        arm.focus()
        for _ in range(3):
            page.keyboard.press("ArrowRight")
        value_ok(page, arm, "45°")
        page.keyboard.press("Control+z")
        value_ok(page, arm, filled("<n>°", n=2 * ARM_KEY_STEP))
        page.keyboard.press("Control+Shift+z")
        value_ok(page, arm, "45°")
        opener = page.get_by_role("button", name="Guardar en ranura")
        for _ in range(3):
            page.keyboard.press("Tab")
            if opener.evaluate("e => e === document.activeElement"):
                break
        focused(page, opener)
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Guardar héroe")
        appears(page, dialog)
        focused(page, slot_radio(dialog, filled("Ranura <n>", n=1)))
        page.keyboard.press("ArrowDown")
        slot2 = slot_radio(dialog, filled("Ranura <n>", n=2))
        expect(slot2).to_be_checked()
        save = dialog.get_by_role("button", name="Guardar")
        for _ in range(3):
            page.keyboard.press("Tab")
            if save.evaluate("e => e === document.activeElement"):
                break
        focused(page, save)
        notes = page.get_by_role("status", name="Avisos")
        page.keyboard.press("Enter")
        shows(page, notes, filled("Guardado en la ranura <n>.", n=2))
        see(page, lambda: expect(dialog).to_have_count(0, timeout=SLICE_MS))
        focused(page, opener)
    hero = slot_hero(p, 2)
    assert hero is not None
    assert hero["proportions"]["spine_length"] == 1.25
    assert hero["pose"]["right_arm_raise"] == 0.7854
    assert hero["parts"]["head"] != "round" and hero["parts"]["legs"] != "thin"
    assert hero["material"] != "graphite" and hero["accessories"]["left_hand"] != "none"
    assert equipped_hero(p)["slot"] == 1


def test_builder_keyboard_tab_order(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/builder", viewport=(1280, 800)) as page:
        head = page.get_by_role("slider", name="Head size")
        head.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Control+z")
        expect(page.get_by_role("button", name="Undo")).to_be_enabled()
        expect(page.get_by_role("button", name="Redo")).to_be_enabled()
        preview = page.get_by_role("application", name="Hero preview")
        preview.focus()
        assert tab_order(page, 12) == [
            "Hero name", "Head size", "Neck length", "Spine length", "Upper arm length", "Forearm length",
            "Thigh length", "Shin length", "Right arm raise", "Undo", "Redo", "Save to slot"]
        preview.focus()
        for group in ("Left hand socket", "Back socket", "Head socket", "Material", "Legs", "Arms", "Torso", "Head"):
            page.keyboard.press("Shift+Tab")
            assert inside(page.get_by_role("radiogroup", name=group, exact=True)), group
        page.keyboard.press("Shift+Tab")
        assert inside(page.get_by_role("navigation", name="Main"))
        for control in (preview, page.get_by_role("textbox", name="Hero name"), page.get_by_role("button", name="Undo")):
            rest, focus = state_styles(control, "outline-style", "outline-width", "box-shadow", state="focus")
            assert rest != focus
        preview.focus()
        for key in ("ArrowRight", "ArrowUp", "+"):
            page.keyboard.press(key)
        attr(page, preview, "data-orbit", "15")
        attr(page, preview, "data-tilt", "25")
        attr(page, preview, "data-distance", "3.50")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("ArrowLeft")
        attr(page, preview, "data-orbit", str(360 - ORBIT_STEP))
        for _ in range(5):
            page.keyboard.press("ArrowUp")
        attr(page, preview, "data-tilt", str(TILT_MAX))
        for _ in range(8):
            page.keyboard.press("ArrowDown")
        attr(page, preview, "data-tilt", "-10")
        for _ in range(5):
            page.keyboard.press("-")
        attr(page, preview, "data-distance", "6.00")
        head.focus()
        page.keyboard.press("Home")
        value_ok(page, head, "0.50")
        page.keyboard.press("End")
        value_ok(page, head, "1.50")
        page.keyboard.press("PageDown")
        value_ok(page, head, fmt(1.5 - 4 * 0.05, "en", 2))
        material = page.get_by_role("radiogroup", name="Material")
        checked = material.get_by_role("radio", checked=True)
        before = checked.evaluate("e => Array.from(e.closest('[role=radiogroup]') ? [] : []).length")
        first = material.get_by_role("radio", checked=True).element_handle()
        material.get_by_role("radio", checked=True).focus()
        page.keyboard.press("ArrowRight")
        see(page, lambda: expect(material.get_by_role("radio", checked=True)).to_have_count(1, timeout=SLICE_MS))
        assert material.get_by_role("radio", checked=True).element_handle() != first or before is not None
        assert not material.get_by_role("radio", checked=True).evaluate("(e, f) => e === f", first)


def test_builder_undo_redo(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/builder") as page:
        arm = page.get_by_role("slider", name="Right arm raise")
        arm.focus()
        for i in range(UNDO_DEPTH + 5):
            page.keyboard.press("End" if i % 2 == 0 else "Home")
        value_ok(page, arm, f"{ARM_LIMIT}°")
        undo, redo = page.get_by_role("button", name="Undo"), page.get_by_role("button", name="Redo")
        page.get_by_role("button", name="Save to slot").focus()
        for _ in range(UNDO_DEPTH - 1):
            page.keyboard.press("Control+z")
        expect(undo).to_be_enabled()
        undo.click()
        value_ok(page, arm, f"{ARM_LIMIT}°")
        expect(undo).to_be_disabled()
        redo.focus()
        page.keyboard.press("Control+y")
        value_ok(page, arm, f"-{ARM_LIMIT}°")
        redo.click()
        value_ok(page, arm, f"{ARM_LIMIT}°")
        arm.focus()
        page.keyboard.press("ArrowLeft")
        value_ok(page, arm, f"{ARM_LIMIT - ARM_KEY_STEP}°")
        expect(redo).to_be_disabled()
        name = page.get_by_role("textbox", name="Hero name")
        name.focus()
        page.keyboard.press("Control+z")
        value_ok(page, arm, f"{ARM_LIMIT - ARM_KEY_STEP}°")


def test_right_arm_raise(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    hero = equipped_hero(p)
    assert p.http.put(slot_path(1), json=hero_body(hero, pose={"right_arm_raise": 1.0})).status_code == 200
    with ui(browser, p, f"/builder/{hero['id']}") as page:
        arm = page.get_by_role("slider", name="Right arm raise")
        value_ok(page, arm, "57°")
        preview = page.get_by_role("application", name="Hero preview")
        advance(page, 200)
        hand_before = preview.get_attribute("data-hand-px")
        arm.focus()
        page.keyboard.press("ArrowRight")
        value_ok(page, arm, filled("<n>°", n=72))
        see(page, lambda: expect(preview).not_to_have_attribute("data-hand-px", hand_before or "", timeout=SLICE_MS), step_ms=50)
        page.keyboard.press("PageUp")
        value_ok(page, arm, f"{72 + ARM_PAGE_STEP}°")
        page.keyboard.press("PageDown")
        page.get_by_role("button", name="Save to slot").click()
        dialog = page.get_by_role("dialog", name="Save hero")
        slot_radio(dialog, filled("Slot <n>", n=1)).check()
        dialog.get_by_role("button", name="Save").click()
        shows(page, page.get_by_role("status", name="Notifications"), filled("Saved to slot <n>.", n=1))
        arm.focus()
        page.keyboard.press("Home")
        value_ok(page, arm, f"-{ARM_LIMIT}°")
        page.keyboard.press("End")
        value_ok(page, arm, f"{ARM_LIMIT}°")
    assert slot_hero(p, 1)["pose"]["right_arm_raise"] == half_up(math.radians(72), 4)
    for sent in (0.78539816, -0.12345, 3.1416, -3.1416):
        r = p.http.put(slot_path(1), json=hero_body(slot_hero(p, 1), pose={"right_arm_raise": sent}))
        assert r.status_code == 200, r.text
        assert r.json()["character"]["pose"]["right_arm_raise"] == half_up(sent, 4)
    r = p.http.put(slot_path(1), json=hero_body(slot_hero(p, 1), pose={"right_arm_raise": 3.1417}))
    assert r.status_code == 422 and "pose" in r.json()["error"]["fields"]
    body = hero_body(slot_hero(p, 1))
    body.pop("pose")
    assert p.http.put(slot_path(1), json=body).json()["character"]["pose"]["right_arm_raise"] == 0


def test_save_dialog_focus_trap(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "ja")
    with ui(browser, p, "/builder") as page:
        opener = page.get_by_role("button", name="スロットに保存")
        dialog = page.get_by_role("dialog", name="ヒーローを保存")
        opener.click()
        first = slot_radio(dialog, filled("スロット<n>", n=1))
        focused(page, first)
        page.keyboard.press("Shift+Tab")
        assert inside(dialog)
        page.keyboard.press("Tab")
        focused(page, first)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert inside(dialog)
        page.keyboard.press("Escape")
        see(page, lambda: expect(dialog).to_have_count(0, timeout=SLICE_MS))
        focused(page, opener)
        opener.click()
        dialog.get_by_role("button", name="キャンセル").click()
        focused(page, opener)
        opener.click()
        slot_radio(dialog, filled("スロット<n>", n=3)).check()
        dialog.get_by_role("button", name="保存").click()
        shows(page, page.get_by_role("status", name="お知らせ"), filled("スロット<n>に保存しました。", n=3))
        focused(page, opener)
        opener.click()
        appears(page, slot_radio(dialog, filled("スロット<n>", n=3), p.name))
    assert slot_hero(p, 3) is not None


def test_wf_hero_builder_stale_slot(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "es")
    hero = equipped_hero(p)
    stale = "Esta ranura cambió en otra pestaña. Recárgala antes de guardar."
    old = p.http.put(slot_path(2), json=hero_body(hero, revision=None, name=OLD_HERO)).json()["character"]
    with ui(browser, p, "/builder") as page:
        arm = page.get_by_role("slider", name="Ángulo del brazo derecho")
        arm.focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        value_ok(page, arm, filled("<n>°", n=2 * ARM_KEY_STEP))
        page.get_by_role("button", name="Guardar en ranura").click()
        dialog = page.get_by_role("dialog", name="Guardar héroe")
        slot_radio(dialog, filled("Ranura <n>", n=2)).check()
        expect(slot_radio(dialog, filled("Ranura <n>", n=2))).to_be_checked()
        r = p.http.put(slot_path(2), json=hero_body(old, name=NEW_HERO))
        assert r.status_code == 200 and r.json()["character"]["id"] == old["id"]
        assert r.json()["character"]["revision"] == old["revision"] + 1
        save = dialog.get_by_role("button", name="Guardar")
        notes = page.get_by_role("status", name="Avisos")
        before_notes = notes.inner_text()
        with holding(page, "**/api/characters/slots/*") as hold:
            save.click()
            pending = dialog.get_by_role("button", name="Procesando...")
            appears(page, pending)
            expect(pending).to_be_disabled()
            expect(pending).to_be_focused()
            expect(dialog.get_by_role("button", name="Cancelar")).to_be_disabled()
            expect(slot_radio(dialog, filled("Ranura <n>", n=2))).to_be_disabled()
            page.keyboard.press("Escape")
            expect(dialog).to_be_visible()
            assert notes.inner_text() == before_notes
            hold.release()
        shows(page, notes, stale)
        expect(dialog).to_be_visible()
        appears(page, slot_radio(dialog, filled("Ranura <n>", n=2), NEW_HERO))
        expect(save).to_be_enabled()
        focused(page, save)
        value_ok(page, arm, filled("<n>°", n=2 * ARM_KEY_STEP))
        page.keyboard.press("Escape")
        arm.focus()
        page.keyboard.press("Control+z")
        value_ok(page, arm, f"{ARM_KEY_STEP}°")
    assert slot_hero(p, 2)["name"] == NEW_HERO and slot_hero(p, 2)["pose"]["right_arm_raise"] == 0


def test_stale_slot_rejected(app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "es")
    hero = equipped_hero(p)
    stale = "Esta ranura cambió en otra pestaña. Recárgala antes de guardar."
    first = p.http.put(slot_path(2), json=hero_body(hero, revision=None, name=OLD_HERO))
    assert first.status_code == 201, first.text
    old = first.json()["character"]
    newer = p.http.put(slot_path(2), json=hero_body(old, name=NEW_HERO))
    assert newer.status_code == 200 and newer.json()["character"]["id"] == old["id"]
    assert newer.json()["character"]["revision"] == old["revision"] + 1
    for revision in (old["revision"], None, old["revision"] + 5):
        r = p.http.put(slot_path(2), json=hero_body(old, revision=revision, name=THIRD_HERO))
        assert r.status_code == 412, (revision, r.text)
        assert r.json()["error"] == {"code": "stale_revision", "message": stale}
    kept = slot_hero(p, 2)
    assert kept["name"] == NEW_HERO and kept["revision"] == old["revision"] + 1


def test_builder_layout_bottom_sheet(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/builder", viewport=(1280, 800)) as page:
        layout(page)
        parts = page.get_by_role("region", name="Parts").bounding_box()
        name_box = page.get_by_role("textbox", name="Hero name").bounding_box()
        assert parts and name_box and parts["x"] + parts["width"] <= name_box["x"]
        assert parts["x"] < 640 < name_box["x"]
        expect(page.get_by_role("button", name="Parts sheet")).to_have_count(0)
        for size in ((768, 1024), (375, 812)):
            page.set_viewport_size({"width": size[0], "height": size[1]})
            enable_touch(page)
            page.reload()
            handle = page.get_by_role("button", name="Parts sheet")
            appears(page, handle)
            layout(page)
            expect(handle).to_have_attribute("aria-expanded", "false")
            appears(page, page.get_by_role("radiogroup", name="Head", exact=True))
            assert not ax_present(page, "radiogroup", "Torso")
            hidden_radio = page.get_by_role("radiogroup", name="Torso", include_hidden=True).get_by_role(
                "radio", include_hidden=True).first
            assert not hidden_radio.evaluate("e => { e.focus(); return document.activeElement === e; }")
            names = tab_order(page, 30)
            assert not {"Hero name", "Save to slot", "Right arm raise", "Undo"} & set(names)
            head_group = page.get_by_role("radiogroup", name="Head", exact=True)
            original = head_group.get_by_role("radio", checked=True).element_handle()
            head_group.get_by_role("radio", checked=True).focus()
            page.keyboard.press("ArrowRight")
            page.keyboard.press("Control+z")
            see(page, lambda: assert_(head_group.get_by_role("radio", checked=True).evaluate("(e, o) => e === o", original)))
            handle.click()
            attr(page, handle, "aria-expanded", "true")
            assert ax_present(page, "radiogroup", "Torso")
            layout(page)
            handle.focus()
            page.keyboard.press("Enter")
            attr(page, handle, "aria-expanded", "false")


def assert_(condition: bool) -> None:
    assert condition


@pytest.mark.parametrize("motion", ["full motion", "reduced motion"], ids=["full_motion", "reduced_motion"])
def test_touch_orbit_zoom(browser: Browser, app_url: str, motion: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/builder", viewport=(768, 1024), touch_screen=True,
            reduced_motion="reduce" if motion == "reduced motion" else MOTION_DEFAULT) as page:
        page.reload()
        preview = page.get_by_role("application", name="Hero preview")
        appears(page, preview)
        box = preview.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        view0 = page.evaluate("[scrollX, scrollY, visualViewport ? visualViewport.scale : 1]")
        orbit0 = int(preview.get_attribute("data-orbit"))
        touch(page, "touchStart", [(cx - 60, cy)])
        for i in range(1, 7):
            touch(page, "touchMove", [(cx - 60 + 20 * i, cy)])
            advance(page, 50)
        expect(preview).to_have_attribute("data-gesture", "orbit")
        touch(page, "touchEnd", [])
        attr(page, preview, "data-gesture", "none")
        assert 0 < (int(preview.get_attribute("data-orbit")) - orbit0) % 360 < 180
        d0 = float(preview.get_attribute("data-distance"))
        touch(page, "touchStart", [(cx - 20, cy), (cx + 20, cy)])
        for i in range(1, 7):
            touch(page, "touchMove", [(cx - 20 - 12 * i, cy), (cx + 20 + 12 * i, cy)])
            advance(page, 50)
        expect(preview).to_have_attribute("data-gesture", "zoom")
        touch(page, "touchEnd", [])
        advance(page, 100)
        d1 = float(preview.get_attribute("data-distance"))
        assert 2.0 <= d1 < d0
        for _ in range(3):
            touch(page, "touchStart", [(cx - 150, cy), (cx + 150, cy)])
            for i in range(1, 8):
                touch(page, "touchMove", [(cx - 150 + 20 * i, cy), (cx + 150 - 20 * i, cy)])
                advance(page, 50)
            touch(page, "touchEnd", [])
        advance(page, 100)
        d2 = float(preview.get_attribute("data-distance"))
        assert d1 < d2 <= 6.0
        attr(page, preview, "data-gesture", "none")
        assert page.evaluate("[scrollX, scrollY, visualViewport ? visualViewport.scale : 1]") == view0


def draw_vertical(page: Page, plane: Locator) -> None:
    plane.focus()
    page.keyboard.press("Space")
    for _ in range(4):
        page.keyboard.press("ArrowUp")
    page.keyboard.press("Space")
    page.keyboard.press("Enter")


LIFT_JS = """e => ({lift: e.getAttribute('data-lift'), yaw: e.getAttribute('data-plane-yaw'),
  opacity: e.getAttribute('data-plane-opacity'), arc: e.getAttribute('data-arc-height'),
  gap: e.getAttribute('data-grip-gap'), radius: e.getAttribute('data-tube-radius'),
  equipped: e.getAttribute('data-equipped-weapon')})"""


def lift_trace(page: Page, plane: Locator, end_state: str, step_ms: int) -> list[tuple[int, dict[str, str]]]:
    t, trace = 0, [(0, plane.evaluate(LIFT_JS))]
    while trace[-1][1]["lift"] != end_state and len(trace) < TRACE_LIMIT:
        advance(page, step_ms)
        t += step_ms
        trace.append((t, plane.evaluate(LIFT_JS)))
    assert trace[-1][1]["lift"] == end_state, trace[-5:]
    return trace


def first_at(trace: list[tuple[int, dict[str, str]]], state: str, after: int = 0) -> int:
    return next(t for t, s in trace if s["lift"] == state and t >= after)


def test_wf_forge_to_session_draw_and_forge(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/forge") as page:
        plane = page.get_by_role("application", name="Drawing plane")
        appears(page, plane)
        expect(plane).to_have_attribute("data-cursor-x", "0.00")
        expect(plane).to_have_attribute("data-cursor-y", "0.00")
        plane.focus()
        page.keyboard.press("Space")
        attr(page, plane, "data-stroke-points", "1")
        for _ in range(4):
            page.keyboard.press("ArrowUp")
        attr(page, plane, "data-cursor-y", "0.20")
        page.keyboard.press("Space")
        attr(page, plane, "data-stroke-points", "2")
        page.keyboard.press("Space")
        attr(page, plane, "data-stroke-points", "2")
        page.keyboard.press("Enter")
        trace = lift_trace(page, plane, "inflating", STEP_MS)
        start = first_at(trace, "inflating")
        trace += [(start + t, s) for t, s in lift_trace(page, plane, "idle", STEP_MS)[1:]]
        assert INFLATE_MIN_MS - STEP_MS <= first_at(trace, "idle", start) - start <= INFLATE_MAX_MS + STEP_MS
        radii = [float(s["radius"]) for t, s in trace if t >= start]
        assert radii == sorted(radii) and radii[-1] > 0
        expect(plane).to_have_attribute("data-strokes", "1")
        expect(plane).to_have_attribute("data-stroke-points", "0")
        page.get_by_role("button", name="Forge").click()
        trace = lift_trace(page, plane, "socketed", STEP_MS)
        fly, catch, done = first_at(trace, "flying"), first_at(trace, "catching"), first_at(trace, "socketed")
        assert FLY_MIN_MS - STEP_MS <= catch - fly <= FLY_MAX_MS + STEP_MS
        assert CATCH_MIN_MS - STEP_MS <= done - catch <= CATCH_MAX_MS + STEP_MS
        flying = [s for t, s in trace if fly <= t < catch]
        yaws = [int(s["yaw"]) for s in flying]
        opacities = [float(s["opacity"]) for s in flying]
        assert yaws == sorted(yaws, reverse=True) and opacities == sorted(opacities, reverse=True)
        assert int(trace[-1][1]["yaw"]) == PLANE_YAW_END and trace[-1][1]["opacity"] == "0.00"
        assert max(float(s["arc"]) for s in flying) > 0
        assert trace[-1][1]["gap"] == "0.000"
        shows(page, page.get_by_role("status", name="Notifications"), "Weapon saved to the armoury.")
        weapons = p.http.get("/api/weapons").json()["weapons"]
        assert len(weapons) == 1 and trace[-1][1]["equipped"] == weapons[0]["id"]
        assert weapons[0]["strokes"] == [stroke([(0, 0), (0, 0.2)])]
        assert equipped_hero(p)["weapon_id"] == weapons[0]["id"]
        page.goto(app_url.rstrip("/") + "/armoury")
        holds(page, page.get_by_role("list", name="Armoury"), f"Weapon {weapons[0]['number']}")


def test_forge_lift_reduced_motion(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/forge", reduced_motion="reduce") as page:
        plane = page.get_by_role("application", name="Drawing plane")
        appears(page, plane)
        draw_vertical(page, plane)
        samples = []
        for _ in range(10):
            advance(page, STEP_MS)
            samples.append(plane.evaluate(LIFT_JS))
        assert {s["lift"] for s in samples} == {"idle"}
        assert len({s["radius"] for s in samples}) == 1 and float(samples[0]["radius"]) > 0
        page.get_by_role("button", name="Forge").click()
        trace = lift_trace(page, plane, "socketed", FINE_STEP_MS)
        assert {s["lift"] for _, s in trace} <= {"idle", "crossfading", "socketed"}
        fade = first_at(trace, "socketed") - first_at(trace, "crossfading")
        assert CROSSFADE_MIN_MS - FINE_STEP_MS <= fade <= CROSSFADE_MAX_MS + FINE_STEP_MS
        assert {s["yaw"] for _, s in trace} == {"0"}
        assert trace[-1][1]["gap"] == "0.000"
        assert trace[-1][1]["equipped"] == p.http.get("/api/weapons").json()["weapons"][0]["id"]


def within_page_ms(page: Page, check: Callable[[], None], budget_ms: int) -> None:
    spent = 0
    while True:
        try:
            check()
            return
        except AssertionError:
            if spent >= budget_ms:
                raise
            advance(page, 50)
            spent += 50


def serpentine(x0: float, y0: float, band: float, count: int) -> list[tuple[float, float]]:
    pts, x, y, direction = [], 8.0, band, 1
    while len(pts) < count:
        pts.append((x0 + x, y0 + y))
        if 8 <= x + 4 * direction <= PLANE_PX - 8:
            x += 4 * direction
        else:
            y, direction = y + 4, -direction
    return pts


def test_wf_forge_to_session_live_stats(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "es")
    with ui(browser, p, "/forge", viewport=(1280, 800)) as page:
        plane = page.get_by_role("application", name="Plano de dibujo")
        stats = page.get_by_role("region", name="Estadísticas del arma")
        announce = page.get_by_role("status", name="Actualización de estadísticas")
        appears(page, plane)
        url = page.url
        for text in stat_texts("es", 0, 0, 0):
            holds(page, stats, text)
        appears(page, page.get_by_text(meter_text(0)))
        draw_vertical(page, plane)

        def drawn() -> None:
            for text in stat_texts("es", 0.2, 0.5, 2.86):
                expect(stats).to_contain_text(text, timeout=SLICE_MS)
            expect(page.get_by_text(meter_text(16))).to_be_visible(timeout=SLICE_MS)
            expect(announce).to_have_text(announcement("es", 0.2, 0.5, 2.86, 16), timeout=SLICE_MS)
        within_page_ms(page, drawn, STATS_MAX_MS)
        assert page.url == url
        page.get_by_role("button", name="Borrar plano").click()
        within_page_ms(page, lambda: expect(announce).to_have_text(
            announcement("es", 0, 0, 0, 0), timeout=SLICE_MS), STATS_MAX_MS)
        box = plane.bounding_box()
        for s in range(8):
            pts = serpentine(box["x"], box["y"], 8 + 36 * s, 188)
            page.mouse.move(*pts[0])
            page.mouse.down()
            for pt in pts[1:]:
                page.mouse.move(*pt)
            page.mouse.up()
            advance(page, 50)
        attr(page, plane, "data-strokes", "8")
        appears(page, page.get_by_text("Supera el límite de vértices"))
        shows(page, page.get_by_role("status", name="Avisos"), "Un arma puede tener como máximo 12.000 vértices.")
        expect(page.get_by_role("button", name="Forjar")).to_be_disabled()
        page.get_by_role("button", name="Deshacer trazo").click()
        within_page_ms(page, lambda: expect(page.get_by_text("Supera el límite de vértices")).to_have_count(
            0, timeout=SLICE_MS), STATS_MAX_MS)
        expect(page.get_by_role("button", name="Forjar")).to_be_enabled()
        assert page.url == url


def test_wf_forge_to_session_latest_drawing_wins(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    r = p.http.post("/api/weapons/preview", json={"strokes": [], "drawing_revision": 7})
    assert r.json()["drawing_revision"] == 7
    assert p.http.post("/api/weapons/preview", json={"strokes": []}).json()["drawing_revision"] is None
    with ui(browser, p, "/forge") as page:
        revisions: list[Any] = []
        parked: list[Any] = []

        def handler(route: Any) -> None:
            revisions.append(route.request.post_data_json.get("drawing_revision"))
            if not parked:
                parked.append(route)
            else:
                route.continue_()
        page.route("**/api/weapons/preview", handler)
        plane = page.get_by_role("application", name="Drawing plane")
        appears(page, plane)
        draw_vertical(page, plane)
        see(page, lambda: assert_(bool(parked)))
        page.get_by_role("button", name="Undo stroke").click()
        zero = announcement("en", 0, 0, 0, 0)
        announce = page.get_by_role("status", name="Forge stats")
        shows(page, announce, zero)
        with contextlib.suppress(Exception):
            parked[0].continue_()
        for _ in range(10):
            advance(page, 100)
            expect(announce).to_have_text(zero, timeout=SLICE_MS)
            expect(page.get_by_role("region", name="Weapon stats")).not_to_contain_text(
                stat_texts("en", 0.2, 0.5, 2.86)[0], timeout=SLICE_MS)
    assert all(isinstance(v, int) for v in revisions) and len(revisions) >= 2
    assert revisions == sorted(revisions) and revisions[-1] > revisions[0]


def expected_stats(strokes: list[dict[str, Any]]) -> tuple[float, float, float, int]:
    points = [pt for s in strokes for pt in s["points"]]
    if not points:
        return 0.0, 0.0, 0.0, 0
    grip = points[0]
    reach = max(math.dist(grip, pt) for pt in points)
    weight = sum(math.pi * (s["thickness"] / 2) ** 2 * math.dist(a, b) * 2000
                 for s in strokes for a, b in zip(s["points"], s["points"][1:]))
    swing = 3 / (1 + weight * reach / 2)
    return half_up(reach, 2), half_up(weight, 2), half_up(swing, 2), 8 * len(points)


STAT_CASES = {
    "vertical": ([stroke([(0, 0), (0, 1)])], (1.00, 2.51, 1.33, 16)),
    "horizontal": ([stroke([(0, 0), (0.2, 0)])], (0.20, 0.50, 2.86, 16)),
    "empty": ([], (0.0, 0.0, 0.0, 0)),
    "polyline": ([stroke([(0, 0), (0.3, 0.4), (-0.5, 0.9), (0.2, -0.7)], 0.05),
                  stroke([(0.6, 0.6), (0.9, -0.2)], 0.02)], None),
}


@pytest.mark.parametrize("case", ["vertical", "horizontal", "empty", "polyline"],
                         ids=["vertical", "horizontal", "empty", "polyline"])
def test_weapon_stats_formulas(app_url: str, case: str) -> None:
    p = signup(app_url.rstrip("/"))
    strokes, expected = STAT_CASES[case]
    expected = expected or expected_stats(strokes)
    r = p.http.post("/api/weapons/preview", json={"strokes": strokes})
    assert r.status_code == 200, r.text
    body = r.json()
    assert (body["stats"]["reach_m"], body["stats"]["weight_kg"], body["stats"]["swing_per_s"], body["vertices"]) == expected
    assert body["strokes"] == len(strokes)
    if strokes:
        r = p.http.post("/api/weapons", json={"character_id": equipped_hero(p)["id"], "strokes": strokes,
                                              "stats": {"reach_m": 9.99, "weight_kg": 0.01, "swing_per_s": 9.99}})
        assert r.status_code == 201, r.text
        weapon = r.json()["weapon"]
        assert (weapon["stats"]["reach_m"], weapon["stats"]["weight_kg"], weapon["stats"]["swing_per_s"],
                weapon["vertices"]) == expected
        assert p.http.get(f"/api/weapons/{weapon['id']}").json()["weapon"]["stats"] == weapon["stats"]


def test_wf_weapon_forge_form_limits(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "es")
    count_msg = "Un arma necesita entre 1 y 24 trazos."
    vertex_msg = "Un arma puede tener como máximo 12.000 vértices."
    shape_msg = "Cada trazo necesita entre 2 y 200 puntos dentro del plano."
    thick_msg = "El grosor del trazo debe estar entre 0,01 y 0,08 m."
    with ui(browser, p, "/forge") as page:
        plane = page.get_by_role("application", name="Plano de dibujo")
        notes = page.get_by_role("status", name="Avisos")
        forge_button = page.get_by_role("button", name="Forjar")
        appears(page, plane)
        expect(forge_button).to_be_disabled()
        plane.focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        shows(page, notes, shape_msg)
        attr(page, plane, "data-strokes", "0")
        for i in range(STROKES_MAX + 1):
            page.keyboard.press("Space")
            page.keyboard.press("ArrowUp" if i % 2 == 0 else "ArrowDown")
            page.keyboard.press("Space")
            page.keyboard.press("Enter")
            if i == STROKES_MAX - 1:
                attr(page, plane, "data-strokes", str(STROKES_MAX))
                see(page, lambda: expect(forge_button).to_be_enabled(timeout=SLICE_MS))
                expect(page.get_by_text("Demasiados trazos")).to_have_count(0)
        attr(page, plane, "data-strokes", str(STROKES_MAX + 1))
        appears(page, page.get_by_text("Demasiados trazos"))
        shows(page, notes, count_msg)
        expect(forge_button).to_be_disabled()
        page.get_by_role("button", name="Deshacer trazo").click()
        see(page, lambda: expect(page.get_by_text("Demasiados trazos")).to_have_count(0, timeout=SLICE_MS))
        see(page, lambda: expect(forge_button).to_be_enabled(timeout=SLICE_MS))
    hero_id = equipped_hero(p)["id"]

    def refuse(strokes: list[dict[str, Any]], fields: dict[str, str]) -> None:
        r = p.http.post("/api/weapons", json={"character_id": hero_id, "strokes": strokes})
        assert r.status_code == 422, r.text
        assert r.json()["error"]["fields"] == fields

    refuse([], {"strokes": count_msg})
    refuse(line_strokes(STROKES_MAX + 1, 2), {"strokes": count_msg})
    refuse(line_strokes(8, 188), {"vertices": vertex_msg})
    refuse(line_strokes(STROKES_MAX + 1, 61), {"strokes": count_msg, "vertices": vertex_msg})
    refuse([stroke([(0, 0), (0, 1)], 0.09)], {"thickness": thick_msg})
    refuse([stroke([(0, 0), (0, 1)], 0.009)], {"thickness": thick_msg})
    refuse([stroke([(0, 0), (1.01, 0)])], {"strokes": shape_msg})
    refuse([stroke([(0, 0)])], {"strokes": shape_msg})
    refuse(line_strokes(1, POINTS_MAX + 1), {"strokes": shape_msg})
    preview = p.http.post("/api/weapons/preview", json={"strokes": line_strokes(STROKES_MAX + 1, 2)}).json()
    assert preview["within_limits"] is False and preview["over"] == ["strokes"]
    preview = p.http.post("/api/weapons/preview", json={"strokes": line_strokes(8, 188)}).json()
    assert preview["within_limits"] is False and preview["over"] == ["vertices"]
    edges = [stroke([(-1.0, -1.0), (1.0, 1.0)], 0.01), stroke([(1.0, -1.0), (-1.0, 1.0)], 0.08)] + line_strokes(1, POINTS_MAX)
    assert p.http.post("/api/weapons/preview", json={"strokes": edges}).json()["within_limits"] is True
    weapon = forge(p, line_strokes(15, 100))
    assert weapon["vertices"] == VERTEX_MAX
    assert len(p.http.get("/api/weapons").json()["weapons"]) == 1


def test_wf_weapon_forge_armoury(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/armoury") as page:
        appears(page, page.get_by_role("heading", name="Your armoury is empty"))
        appears(page, page.get_by_text("Draw a weapon in the forge to see it here."))
        older = forge(p, [stroke([(0, 0), (0.2, 0)])])
        newer = forge(p, [stroke([(0, 0), (0, 1)])])
        page.reload()
        armoury = page.get_by_role("list", name="Armoury")
        cards = armoury.get_by_role("listitem")
        see(page, lambda: expect(cards).to_have_count(2, timeout=SLICE_MS))
        expect(cards.nth(0)).to_contain_text(f"Weapon {newer['number']}")
        expect(cards.nth(1)).to_contain_text(f"Weapon {older['number']}")
        for text in stat_texts("en", 1.0, 2.51, 1.33):
            expect(cards.nth(0)).to_contain_text(text)
        older_card = cards.filter(has_text=f"Weapon {older['number']}")
        newer_card = cards.filter(has_text=f"Weapon {newer['number']}")
        older_card.get_by_role("button", name="Equip").click()
        poll(lambda: equipped_hero(p)["weapon_id"] == older["id"], UI_S, "equip applied")
        with holding(page, "**/api/weapons/*") as hold:
            newer_card.get_by_role("button", name="Delete").click()
            pending = newer_card.get_by_role("button", name="Working...")
            appears(page, pending)
            expect(pending).to_be_disabled()
            hold.release()
        url = page.url
        see(page, lambda: expect(cards).to_have_count(1, timeout=SLICE_MS))
        shows(page, page.get_by_role("status", name="Notifications"), "Weapon deleted.")
        focused(page, older_card.get_by_role("button", name="Equip"))
        older_card.get_by_role("button", name="Delete").click()
        empty = page.get_by_role("heading", name="Your armoury is empty")
        focused(page, empty)
        assert page.url == url
    assert p.http.get("/api/weapons").json()["weapons"] == []


@pytest.mark.parametrize("scale", [1, 2], ids=["dpr1", "dpr2"])
def test_wf_weapon_forge_plane_coordinates(browser: Browser, app_url: str, scale: int) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/forge", viewport=(375, 812), touch_screen=True, scale=scale) as page:
        page.reload()
        plane = page.get_by_role("application", name="Drawing plane")
        appears(page, plane)
        box = plane.bounding_box()
        assert abs(box["width"] - PLANE_PX) < 0.5 and abs(box["height"] - PLANE_PX) < 0.5
        preview = page.get_by_role("application", name="Hero preview")
        advance(page, 200)
        hx, hy = (int(v) for v in preview.get_attribute("data-hand-px").split(","))
        pbox = preview.bounding_box()
        hand = (pbox["x"] + hx, pbox["y"] + hy)
        assert not (box["x"] <= hand[0] <= box["x"] + box["width"] and box["y"] <= hand[1] <= box["y"] + box["height"])
        x = box["x"] + PLANE_PX / 2
        touch(page, "touchStart", [(x, box["y"] + PLANE_PX / 2)])
        for step in range(1, 41):
            touch(page, "touchMove", [(x, box["y"] + PLANE_PX / 2 - 4 * step + (0.5 if step == 40 else 0))])
            advance(page, 16)
        touch(page, "touchEnd", [])
        attr(page, plane, "data-strokes", "1")
        page.get_by_role("button", name="Forge").click()
        poll(lambda: p.http.get("/api/weapons").json()["weapons"], UI_S, "weapon saved")
    points = p.http.get("/api/weapons").json()["weapons"][0]["strokes"][0]["points"]
    pixel = 2 / PLANE_PX
    assert abs(points[0][0]) <= pixel and abs(points[0][1]) <= pixel
    assert all(abs(px) <= pixel for px, _ in points)
    ys = [py for _, py in points]
    assert ys == sorted(ys) and ys[-1] >= 1 - POINT_GAP_M


def test_deleted_weapon_in_session(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    weapon = forge(p, [stroke([(0, 0), (0, 1)])])
    sid = start_solo(p)["session_id"]
    with account_ctx(browser, p) as ctx:
        tab = connect(ctx, p.base, session_id=sid)
        assert member(snapshot(p, sid), p.id)["weapon"] is not None
        assert p.http.delete(f"/api/weapons/{weapon['id']}").status_code == 204
        poll(lambda: member(snapshot(p, sid), p.id)["weapon"] is None, SYNC_S + SLACK_S, "weapon null in snapshot")
        ack = tab.intent(sid, "swing")
        assert ack["applied"] is False and ack["reason"] == "no_weapon" and isinstance(ack["tick"], int)
    assert p.http.get(f"/api/weapons/{weapon['id']}").status_code == 404
    assert p.http.get("/api/weapons").json()["weapons"] == []
    assert all(c["weapon_id"] is None for c in p.http.get("/api/characters").json()["characters"])
    again = forge(p, [stroke([(0, 0), (0, 1)])])
    assert type(again["number"]) is int and again["number"] == weapon["number"] + 1


def status_log(locator: Locator) -> None:
    locator.evaluate("""(el) => { window.__statusLog = []; new MutationObserver(() => {
        const t = el.textContent.trim(); const log = window.__statusLog;
        if (log[log.length - 1] !== t) log.push(t); }).observe(el, {subtree: true, childList: true, characterData: true}); }""")


def check_stages(log: list[str], stages: list[str]) -> None:
    assert "" not in log, log
    assert log and log[0] == stages[0] and log[-1] == stages[-1], log
    positions = [stages.index(entry) for entry in log]
    assert positions == sorted(set(positions)), log


def test_wf_model_in_session_upload_fix_equip(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "es")
    bad = build_glb(hips_rotation=(0, 0.7071, 0, 0.7071), triangles=R04_MESH_TRIANGLES, triangle_nodes=2)
    bad_name, good_name = model_name("malo"), model_name("bueno")
    with ui(browser, p, "/models") as page:
        status = page.get_by_role("status", name="Estado de la subida")
        appears(page, status)
        status_log(status)
        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name="Subir modelo").click()
        chooser.value.set_files(files={"name": bad_name, "mimeType": "model/gltf-binary", "buffer": bad})
        item = page.get_by_role("list", name="Mis modelos").get_by_role("button", name=bad_name)
        appears(page, item)
        item.click()
        expect(item).to_have_attribute("aria-current", "true")
        verdict_copy = filled("Rechazado: <n> reglas no superadas.", n=2)
        rejected_heading = filled("Modelo rechazado: <n> reglas no superadas", n=2)
        shows(page, status, verdict_copy, VERDICT_MAX_S + SLACK_S)
        check_stages(page.evaluate("window.__statusLog"), [
            "Subiendo...", "Guardado. Esperando la validación.",
            f"Validando con el reglamento {RULEBOOK_VERSION}.", verdict_copy])
        report = page.get_by_role("region", name="Informe de validación")
        appears(page, report.get_by_role("heading", name=rejected_heading))
        for text in ("Rotación w 0,7071, x 0,0000, y 0,7071, z 0,0000",
                     f"Medido {fmt(R04_TWO_NODE_MEASURED, 'es')}, límite {fmt(R04_LIMIT, 'es')}",
                     "Reglas no superadas", f"Juzgado con el reglamento {RULEBOOK_VERSION}"):
            holds(page, report, text)
        item.focus()
        r = upload(p, build_glb(), good_name)
        assert r.status_code == 201
        good_id = r.json()["model"]["id"]
        good_item = page.get_by_role("list", name="Mis modelos").get_by_role("button", name=good_name)
        appears(page, good_item)
        poll(lambda: p.http.get(f"/api/models/{good_id}").json()["model"]["status"] == "accepted", VERDICT_MAX_S + SLACK_S, "fix accepted")
        holds(page, page.get_by_role("list", name="Mis modelos").get_by_role("listitem").filter(
            has=page.get_by_role("button", name=good_name)), "Aceptado")
        expect(item).to_be_focused()
        expect(item).to_have_attribute("aria-current", "true")
        expect(report.get_by_role("heading", name=rejected_heading)).to_be_visible()
        good_item.click()
        appears(page, report.get_by_role("heading", name="Modelo aceptado"))
        page.get_by_role("button", name="Equipar modelo").click()
        shows(page, page.get_by_role("status", name="Avisos"), "Modelo equipado.")
    assert equipped_hero(p)["model_id"] == good_id
    assert p.http.get(f"/api/models/{good_id}").json()["model"]["status"] == "equipped"


def test_wf_model_in_session_fix_and_equip(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    bad_name, good_name = model_name("bad"), model_name("good")
    bad = judged_upload(p, build_glb(missing=("neck",)), bad_name)
    assert bad["status"] == "rejected"
    with ui(browser, p, "/models") as page:
        models = page.get_by_role("list", name="My models")
        models.get_by_role("button", name=bad_name).click()
        report = page.get_by_role("region", name="Upload report")
        appears(page, report.get_by_role("heading", name="Model rejected: 1 rule failed"))
        for text in ("Failed rules", "Passed rules", "Not checked", "All required humanoid bones",
                     filled("Missing: <measured>", measured="neck"), "Hips upright at rest",
                     filled("Measured <measured>, limit <limit>", measured=0, limit=fmt(R04_LIMIT, "en"))):
            holds(page, report, text)
        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name="Upload model").click()
        chooser.value.set_files(files={"name": good_name, "mimeType": "model/gltf-binary", "buffer": build_glb()})
        good_item = models.get_by_role("button", name=good_name)
        appears(page, good_item)
        holds(page, models.get_by_role("listitem").filter(has=page.get_by_role("button", name=good_name)), "Accepted",
              VERDICT_MAX_S + SLACK_S)
        good_item.click()
        appears(page, report.get_by_role("heading", name="Model accepted"))
        page.get_by_role("button", name="Equip model").click()
        shows(page, page.get_by_role("status", name="Notifications"), "Model equipped.")
    good = next(m for m in p.http.get("/api/models").json()["models"] if m["filename"] == good_name)
    assert good["status"] == "equipped" and equipped_hero(p)["model_id"] == good["id"]
    assert p.http.get(f"/api/models/{bad['id']}").json()["model"]["status"] == "rejected"


def test_wf_model_in_session_storage_confirms(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = signup(base)
    name = model_name("never")
    with ui(browser, p, "/models", base=env_url("APP_MINIO_DOWN_URL")) as page:
        status = page.get_by_role("status", name="Upload status")
        appears(page, status)
        status_log(status)
        with page.expect_file_chooser() as chooser:
            page.get_by_role("button", name="Upload model").click()
        chooser.value.set_files(files={"name": name, "mimeType": "model/gltf-binary", "buffer": build_glb()})
        appears(page, page.get_by_role("alert"))
        assert "Stored. Waiting to validate." not in page.evaluate("window.__statusLog")
        expect(page.get_by_role("list", name="My models").get_by_role("button", name=name)).to_have_count(0)
    data = build_glb()
    r = upload(p, data, model_name())
    assert r.status_code == 201
    model = r.json()["model"]
    assert model["status"] == "stored" and model["rulebook_version"] is None and model["report"] is None
    key = f"models/{p.id}/{model['id']}/original.glb"
    assert key in S3().keys(f"models/{p.id}/")
    judged = verdict(p, model["id"])
    assert judged["status"] == "accepted" and judged["rulebook_version"] == RULEBOOK_VERSION


def test_originals_kept_with_verdict(app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    data = build_glb(hips_rotation=(0, 0.7071, 0, 0.7071))
    r = upload(p, data, model_name())
    assert r.status_code == 201, r.text
    model = r.json()["model"]
    key = f"models/{p.id}/{model['id']}/original.glb"
    assert S3().get(key) == data
    assert model["sha256"] == hashlib.sha256(data).hexdigest() and model["size_bytes"] == len(data)
    judged = verdict(p, model["id"])
    assert judged["status"] == "rejected" and judged["rulebook_version"] == RULEBOOK_VERSION
    assert judged["report"]["rulebook_version"] == RULEBOOK_VERSION
    assert S3().get(key) == data
    file = p.http.get(f"/api/models/{model['id']}/file")
    assert file.status_code == 200 and file.content == data
    assert file.headers["content-type"].startswith("model/gltf-binary")
    assert "attachment" in file.headers.get("content-disposition", "")
    judged_upload(p, build_glb())
    again = p.http.get(f"/api/models/{model['id']}").json()["model"]
    assert (again["status"], again["rulebook_version"], again["report"]) == (
        judged["status"], RULEBOOK_VERSION, judged["report"])


def test_upload_intake(app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    r = upload(p, build_glb(), model_name(), ctype="text/plain")
    assert r.status_code == 415 and r.json()["error"] == {"code": "unsupported_type",
                                                          "message": "This file is not a glTF binary (.glb)."}
    r = upload(p, b"GLTX" + build_glb()[4:], model_name())
    assert r.status_code == 415 and r.json()["error"]["code"] == "not_gltf"
    big = b"glTF" + struct.pack("<II", 2, UPLOAD_MAX + 1) + bytes(UPLOAD_MAX + 1 - 12)
    try:
        r = upload(p, big, model_name())
        assert r.status_code == 413 and r.json()["error"] == {"code": "too_large", "message": "Uploads can be at most 15 MiB."}
    except httpx.TransportError:
        pass
    assert p.http.get("/api/models").json()["models"] == []
    assert S3().keys(f"models/{p.id}/") == []
    for raw, cleaned in (("../../etc/passwd", "passwd.glb"), ("...", "model.glb")):
        r = upload(p, build_glb(), raw, ctype="application/octet-stream")
        assert r.status_code == 201, r.text
        m = r.json()["model"]
        assert m["filename"] == cleaned
        assert f"models/{p.id}/{m['id']}/original.glb" in S3().keys(f"models/{p.id}/")
    exact = b"glTF" + struct.pack("<II", 2, UPLOAD_MAX) + bytes(UPLOAD_MAX - 12)
    first_big = upload(p, exact, model_name())
    assert first_big.status_code == 201, first_big.text
    used = sum(m["size_bytes"] for m in p.http.get("/api/models").json()["models"])
    while QUOTA_BYTES - used > 0:
        size = min(UPLOAD_MAX, QUOTA_BYTES - used)
        assert size >= 12
        assert upload(p, b"glTF" + struct.pack("<II", 2, size) + bytes(size - 12), model_name()).status_code == 201
        used += size
    r = upload(p, build_glb(), model_name())
    assert r.status_code == 413 and r.json()["error"] == {
        "code": "quota_exceeded",
        "message": "You've used your 60 MiB of model storage. Delete a model to upload another."}
    assert p.http.delete(f"/api/models/{first_big.json()['model']['id']}").status_code == 204
    assert upload(p, build_glb(), model_name()).status_code == 201


def test_rulebook_and_report(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "ja")
    book = p.http.get("/api/rulebook").json()
    assert book["version"] == RULEBOOK_VERSION and book["validator"] == VALIDATOR_VERSION
    assert [r["id"] for r in book["rules"]] == [f"R{i:02d}" for i in range(1, 11)]
    assert [r["limit"] for r in book["rules"]] == [None, 0, 0, R04_LIMIT, R05_LIMIT, None, 8, 0, R09_LIMIT, None]
    assert book["rules"][0]["title"] == "glTF 2.0バイナリ形式である"
    assert book["rules"][9]["title"] == "腰ボーンが直立の基本姿勢"
    good = judged_upload(p, build_glb())
    assert good["status"] == "accepted" and good["report"]["failed_count"] == 0
    expected = {"R01": (None, None), "R02": (0, 0), "R03": (0, 0), "R04": (0, R04_LIMIT), "R06": ("", None),
                "R07": (0, 8), "R08": (0, 0), "R09": (0, R09_LIMIT), "R10": ([0, 0, 0, 1], None)}
    for rid, (measured, limit) in expected.items():
        entry = rule(good, rid)
        assert (entry["status"], entry["measured"], entry["limit"]) == ("pass", measured, limit), rid
    assert rule(good, "R05")["limit"] == R05_LIMIT and rule(good, "R05")["measured"] <= R05_LIMIT
    thumb = p.http.get(f"/api/models/{good['id']}/thumbnail")
    assert thumb.status_code == 200 and thumb.content[:8] == b"\x89PNG\r\n\x1a\n"
    assert struct.unpack(">II", thumb.content[16:24]) == (THUMB_PX, THUMB_PX)
    r01_name = model_name("v1")
    v1 = judged_upload(p, build_glb(version=1), r01_name)
    assert v1["status"] == "rejected" and v1["report"]["failed_count"] == 1
    assert (rule(v1, "R01")["status"], rule(v1, "R01")["measured"]) == ("fail", None)
    assert all((r["status"], r["measured"], r["limit"]) == ("skipped", None, None) for r in v1["report"]["rules"][1:])
    assert p.http.get(f"/api/models/{v1['id']}/thumbnail").status_code == 404
    skins = judged_upload(p, build_glb(skins=2))
    assert (rule(skins, "R05")["status"], rule(skins, "R05")["measured"], rule(skins, "R05")["limit"]) == ("fail", 2, 1)
    assert rule(skins, "R06")["status"] == "skipped" and rule(skins, "R10")["status"] == "skipped"
    ext = judged_upload(p, build_glb(extensions=("EXT_linewright_probe",)))
    assert (rule(ext, "R03")["status"], rule(ext, "R03")["measured"]) == ("fail", 1)
    q = signup(app_url.rstrip("/"))
    en_name = model_name("v1")
    judged_upload(q, build_glb(version=1), en_name)
    with ui(browser, q, "/models") as page:
        page.get_by_role("list", name="My models").get_by_role("button", name=en_name).click()
        report = page.get_by_role("region", name="Upload report")
        appears(page, report.get_by_role("heading", name="Model rejected: 1 rule failed"))
        for text in ("Checked from the file header", "Not checked because an earlier rule failed", "Not checked",
                     "File is a glTF 2.0 binary"):
            holds(page, report, text)


TRIANGLE_CASES = {
    "two_nodes": ({"triangles": R04_MESH_TRIANGLES, "triangle_nodes": 2}, "R04", "fail", R04_TWO_NODE_MEASURED),
    "one_node_unused": ({"triangles": R04_MESH_TRIANGLES, "unused_triangles": R04_MESH_TRIANGLES}, "R04", "pass", R04_MESH_TRIANGLES),
    "strip": ({"strip_indices": STRIP_INDICES}, "R04", "pass", STRIP_MEASURED),
    "three_errors": ({"bad_refs": 3}, "R02", "fail", 3),
}


@pytest.mark.parametrize("case", ["two_nodes", "one_node_unused", "strip", "three_errors"],
                         ids=["two_nodes", "one_node_unused", "strip", "three_errors"])
def test_scene_triangles_and_validator(app_url: str, case: str) -> None:
    p = signup(app_url.rstrip("/"))
    kwargs, rid, status, measured = TRIANGLE_CASES[case]
    model = judged_upload(p, build_glb(**kwargs))
    entry = rule(model, rid)
    assert (entry["status"], entry["measured"]) == (status, measured), model["report"]
    if case == "three_errors":
        assert all(r["status"] == "skipped" and r["measured"] is None for r in model["report"]["rules"][2:])


def test_r10_upright_rest_pose(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    x = math.sqrt(1 - 0.99985 ** 2)
    cases = [
        ({"hips_rotation": (0, 0.70710678, 0, 0.70710678)}, "fail", [0, 0.7071, 0, 0.7071]),
        ({}, "pass", [0, 0, 0, 1]),
        ({"hips_matrix": True}, "fail", None),
        ({"hips_rotation": (x, 0, 0, -0.99985)}, "pass", [half_up(x, 4), 0, 0, -0.9999]),
        ({"missing": ("neck", "head")}, "skipped", None),
    ]
    matrix_name = ""
    for kwargs, status, measured in cases:
        name = model_name("r10")
        model = judged_upload(p, build_glb(**kwargs), name)
        entry = rule(model, "R10")
        assert (entry["status"], entry["measured"], entry["limit"]) == (status, measured, None), kwargs
        if "missing" in kwargs:
            assert (rule(model, "R06")["status"], rule(model, "R06")["measured"]) == ("fail", ", ".join(("neck", "head")))
        if kwargs.get("hips_matrix"):
            matrix_name = name
    with ui(browser, p, "/models") as page:
        page.get_by_role("list", name="My models").get_by_role("button", name=matrix_name).click()
        holds(page, page.get_by_role("region", name="Upload report"), "Rest pose given as a matrix")


def test_only_accepted_models_equip(app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    rejected = judged_upload(p, build_glb(version=1))
    revision = equipped_hero(p)["revision"]
    r = equip_model(p, rejected["id"])
    assert r.status_code == 409 and r.json()["error"] == {"code": "model_not_accepted",
                                                          "message": "Only accepted models can be equipped."}
    assert equipped_hero(p)["revision"] == revision and equipped_hero(p)["model_id"] is None
    fresh = upload(p, build_glb(), model_name()).json()["model"]
    r = equip_model(p, fresh["id"])
    if r.status_code != 200:
        assert r.status_code == 409 and r.json()["error"]["code"] == "model_not_accepted"
    good = judged_upload(p, build_glb())
    assert equip_model(p, good["id"]).status_code == 200
    assert p.http.get(f"/api/models/{good['id']}").json()["model"]["status"] == "equipped"
    assert equip_model(p, None).status_code == 200
    assert p.http.get(f"/api/models/{good['id']}").json()["model"]["status"] == "accepted"


def test_shared_model_in_session(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    a, b = crew(base, mail, "en", "en")
    outsider = signup(base)
    data = build_glb()
    model = judged_upload(a, data)
    assert equip_model(a, model["id"]).status_code == 200
    weapon = forge(a, [stroke([(0, 0), (0, 1)])])
    assert b.http.get(f"/api/models/{model['id']}").status_code == 404
    pid = make_party(a, [b])
    sid = start_coop(pid, a, [b])
    url = f"/api/sessions/{sid}/members/{a.id}/model"
    entry = member(snapshot(b, sid), a.id)
    assert entry["model_url"] == url and entry["weapon"]["strokes"] == weapon["strokes"]
    assert entry["weapon"]["stats"] == weapon["stats"]
    r = b.http.get(url)
    assert r.status_code == 200 and hashlib.sha256(r.content).hexdigest() == model["sha256"]
    assert "attachment" in r.headers.get("content-disposition", "")
    for path in (url, f"/api/sessions/{sid}", f"/api/models/{model['id']}", f"/api/models/{model['id']}/file"):
        assert outsider.http.get(path).status_code == 404, path
    assert equip_model(a, None).status_code == 200
    poll(lambda: member(snapshot(b, sid), a.id)["model_url"] is None and b.http.get(url).status_code == 404,
         SYNC_S + SLACK_S, "model withdrawn from session")


def test_removed_member_loses_access(browser: Browser, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    a, b = crew(base, mail, "en", "en")
    model = judged_upload(a, build_glb())
    assert equip_model(a, model["id"]).status_code == 200
    pid = make_party(a, [b])
    sid = start_coop(pid, a, [b])
    url = f"/api/sessions/{sid}/members/{a.id}/model"
    with account_ctx(browser, a) as actx, account_ctx(browser, b) as bctx:
        connect(bctx, base, session_id=sid)
        tab = connect(actx, base, session_id=sid)
        tab.close()
        poll(lambda: member(snapshot(b, sid), a.id)["status"] == "dropped", SYNC_S + SLACK_S, "A dropped")
        assert b.http.get(url).status_code == 200
        assert a.http.get(f"/api/sessions/{sid}").status_code == 200
        poll(lambda: member(snapshot(b, sid), a.id) is None, GRACE_WAIT_S, "A removed")
        channel = f"session-{sid}"
        poll(lambda: all(c.get(path, params=params).status_code == 404 for c, path, params in (
            (a.http, f"/api/sessions/{sid}", {}), (a.http, f"/api/parties/{pid}", {}),
            (a.http, f"/api/chat/{channel}/messages", {"after_seq": 0}), (a.http, url, {}), (b.http, url, {}))),
            SYNC_S + SLACK_S, "access withdrawn")
        again = connect(actx, base, session_id=sid)
        refused = again.wait(lambda m: m.get("type") == "join_refused")
        assert refused["event"]["kind"] == "not_a_member"


def test_wf_solo_story_play_chapter(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    route = "/stories/lantern-road/chapters/1/complete"
    with ui(browser, p, "/stories") as page:
        page.get_by_role("button", name=filled("Play chapter <n>", n=1)).click()
        see(page, lambda: assert_("/play/" in page.url))
        sid = page.url.rsplit("/", 1)[1]
        skip = page.get_by_role("button", name="Skip")
        if skip.count():
            skip.click()
        page.get_by_role("application", name="Game view").focus()
        page.keyboard.down("d")
        see(page, lambda: assert_(math.hypot(member(snapshot(p, sid), p.id)["position"]["x"],
                                             member(snapshot(p, sid), p.id)["position"]["z"]) > 0.5), step_ms=250)
        page.keyboard.up("d")
        with account_ctx(browser, p) as ctx:
            tab = connect(ctx, p.base, session_id=sid)
            walk(p, tab, sid, 4, 0)
            holds(page, page.get_by_role("status", name="Objective"), filled("Ink motes: <collected>/3", collected=1))
            walk(p, tab, sid, 4, 4)
            walk(p, tab, sid, 0, 4)
            holds(page, page.get_by_role("status", name="Objective"), "The gate is open.")
            tab.intent(sid, "move_to", x=0, z=-8)
            poll(lambda: snapshot(p, sid)["status"] == "complete", WALK_S, "chapter complete")
            see(page, lambda: expect(page).to_have_url(re.compile(re.escape(route) + "$"), timeout=SLICE_MS),
                COMPLETE_ROUTE_S + SLACK_S)
        heading = filled("Chapter <n> complete", n=1)
        appears(page, page.get_by_role("heading", name=heading))
        appears(page, page.get_by_role("button", name="Next chapter").or_(page.get_by_role("link", name="Next chapter")))
        page.reload()
        appears(page, page.get_by_role("heading", name=heading))
    progress = solo_progress(p)
    assert 1 in progress["completed_chapters"] and progress["unlocked_chapter"] == 2
    assert progress["checkpoint"] is None
    other = signup(app_url.rstrip("/"))
    r = other.http.get(route)
    assert r.status_code == 404


def test_chapter_complete_route(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    p = signup(base)
    route = "/stories/lantern-road/chapters/1/complete"
    assert p.http.get(route).status_code == 404
    sid = start_solo(p)["session_id"]
    with ui(browser, p, f"/play/{sid}") as page:
        appears(page, page.get_by_role("application", name="Game view"))
        with account_ctx(browser, p) as ctx:
            finish_chapter(p, connect(ctx, base, session_id=sid), sid)
        see(page, lambda: expect(page).to_have_url(re.compile(re.escape(route) + "$"), timeout=SLICE_MS),
            COMPLETE_ROUTE_S + SLACK_S)
        heading = filled("Chapter <n> complete", n=1)
        appears(page, page.get_by_role("heading", name=heading))
        page.reload()
        appears(page, page.get_by_role("heading", name=heading))
    with ui(browser, p, route) as deep:
        appears(deep, deep.get_by_role("heading", name=heading))
        see(deep, lambda: expect(deep).to_have_title(titled("Chapter complete"), timeout=SLICE_MS))
    assert p.http.get(complete_route(SOLO, 2)).status_code == 404
    other = signup(base)
    with ui(browser, other, route) as page:
        response = page.goto(base + route)
        assert response is not None and response.status == 404
        appears(page, page.get_by_role("heading", name="We couldn't find that page."))


def test_fixed_step_world(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    forge(p, [stroke([(0, 0), (0, 1)])])
    sid = start_solo(p)["session_id"]
    with account_ctx(browser, p) as ctx:
        tab = connect(ctx, p.base, session_id=sid)
        ack = tab.intent(sid, "move_to", x=1.95, z=0)
        assert isinstance(ack["tick"], int) and ack["applied"] is True
        for _ in range(15):
            snap = snapshot(p, sid)
            k = snap["tick"] - ack["tick"]
            assert abs(member(snap, p.id)["position"]["x"] - min(1.95, STEP_M * k)) < 0.001, (k, snap["tick"])
            threading.Event().wait(POLL_S)
        poll(lambda: member(snapshot(p, sid), p.id)["position"]["x"] == 1.95, WALK_S, "arrive")
        t0, s0 = time.monotonic(), snapshot(p, sid)["tick"]
        swing = tab.intent(sid, "swing")
        assert swing["applied"] is True and "m1" not in collected(snapshot(p, sid))
        walk(p, tab, sid, 2, 0)
        early = tab.intent(sid, "swing")
        if early["tick"] - swing["tick"] < TICKS_PER_SECOND / 1.33:
            assert early["reason"] == "cooldown" and early["applied"] is False
        poll(lambda: snapshot(p, sid)["tick"] - swing["tick"] >= TICKS_PER_SECOND / 1.33 + 1, WALK_S, "cooldown over")
        assert tab.intent(sid, "swing")["applied"] is True
        poll(lambda: "m1" in collected(snapshot(p, sid)), SYNC_S + SLACK_S, "swing collects m1")
        elapsed, ticks = time.monotonic() - t0, snapshot(p, sid)["tick"] - s0
        assert TICKS_PER_SECOND * 0.8 <= ticks / elapsed <= TICKS_PER_SECOND * 1.2
        out = tab.intent(sid, "move_to", x=25, z=0)
        assert out["applied"] is False and out["reason"] == "out_of_bounds" and isinstance(out["tick"], int)
        iid = str(uuid.uuid4())
        first = tab.intent(sid, "move_to", intent_id=iid, x=-8, z=-8)
        dup = tab.intent(sid, "move_to", intent_id=iid, x=8, z=8)
        assert first["applied"] is True and (dup["applied"], dup["duplicate"]) == (False, True)
        poll(lambda: member(snapshot(p, sid), p.id)["position"] == {"x": -8, "z": -8}, WALK_S, "inside puddle")
        a, b = snapshot(p, sid), None
        poll(lambda: snapshot(p, sid)["tick"] > a["tick"] + 10, WALK_S, "ticks pass")
        b = snapshot(p, sid)
        assert member(a, p.id)["health"] - member(b, p.id)["health"] == pytest.approx(PUDDLE_DAMAGE * (b["tick"] - a["tick"]), abs=0.001)
        def knocked_out() -> bool:
            entry = member(snapshot(p, sid), p.id)
            pos = entry["position"]
            on_path = abs(pos["x"] - pos["z"]) < 0.001 and -8 <= pos["x"] <= 0
            return entry["health"] == 100 and on_path
        poll(knocked_out, WALK_S, "knocked out back to spawn with full health")


def test_wf_solo_story_resume_checkpoint(browser: Browser, app_url: str) -> None:
    copy = AppCopy({})
    try:
        copy.start()
        p = signup(copy.base)
        sid = start_solo(p)["session_id"]
        with account_ctx(browser, p, copy.base) as ctx:
            tab = connect(ctx, copy.base, session_id=sid)
            walk(p, tab, sid, 4, 0)
            walk(p, tab, sid, -4, 0)
            poll(lambda: snapshot(p, sid)["checkpoint_reached"], SYNC_S + SLACK_S, "checkpoint")
            walk(p, tab, sid, 4, 4)
            prog = solo_progress(p)
            assert prog["checkpoint"] == {"chapter": 1, "motes": ["m1"]}
            tab.close()
        copy.stop()
        copy.start()
        prog = solo_progress(p)
        assert prog["checkpoint"] == {"chapter": 1, "motes": ["m1"]}
        started = start_solo(p)
        assert started["resumed_from_checkpoint"] is True
        snap = snapshot(p, started["session_id"])
        assert member(snap, p.id)["position"] == {"x": -4, "z": 0} and member(snap, p.id)["health"] == 100
        assert collected(snap) == {"m1"}
        outsider = signup(copy.base)
        assert outsider.http.get(f"/api/sessions/{started['session_id']}").status_code == 404
        assert solo_progress(outsider)["checkpoint"] is None
    finally:
        copy.stop()


def test_checkpoint_keeps_motes(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    sid = start_solo(p)["session_id"]
    with account_ctx(browser, p) as ctx:
        tab = connect(ctx, p.base, session_id=sid)
        walk(p, tab, sid, 4, 0)
        walk(p, tab, sid, -4, 0)
        poll(lambda: solo_progress(p)["checkpoint"] == {"chapter": 1, "motes": ["m1"]},
             SYNC_S + SLACK_S, "first checkpoint save")
        walk(p, tab, sid, 4, 4)
        assert collected(snapshot(p, sid)) == {"m1", "m2"}
        hold_true(lambda: solo_progress(p)["checkpoint"] == {"chapter": 1, "motes": ["m1"]},
                  SYNC_S + SLACK_S, "later mote not saved without checkpoint")
        walk(p, tab, sid, 0, 0)
        walk(p, tab, sid, -4, 0)
        poll(lambda: solo_progress(p)["checkpoint"]["motes"] == ["m1", "m2"],
             SYNC_S + SLACK_S, "second checkpoint save")


def test_wf_friends_add_friend(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    a, b = verified(base, mail, "es"), verified(base, mail, "ja")
    with ui(browser, a, "/lobby") as apage:
        apage.get_by_role("textbox", name="Nombre visible del amigo").fill(b.name)
        apage.get_by_role("button", name="Enviar solicitud").click()
        shows(apage, apage.get_by_role("status", name="Avisos"), f"Solicitud de amistad enviada a {b.name}.")
        with ui(browser, b, "/lobby") as bpage:
            bpage.get_by_role("button", name=f"{a.name}さんを承認").click()
            shows(bpage, bpage.get_by_role("status", name="お知らせ"), f"{a.name}さんとフレンドになりました。")
            holds(bpage, bpage.get_by_role("list", name="フレンド").get_by_role("listitem").filter(has_text=a.name), "オンライン")
            holds(apage, apage.get_by_role("list", name="Amigos").get_by_role("listitem").filter(has_text=b.name), "En línea")
    assert b.id in [f["account_id"] for f in a.http.get("/api/friends").json()["friends"]]
    assert a.id in [f["account_id"] for f in b.http.get("/api/friends").json()["friends"]]


def test_friend_request_rules(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    a, b, c = verified(base, mail), verified(base, mail), signup(base)
    key = idempotency_key()
    first = a.http.post("/api/friends/requests", json={"display_name": b.name.upper(), "client_request_id": key})
    assert first.status_code == 201 and first.json()["request"]["to"]["account_id"] == b.id
    replay = a.http.post("/api/friends/requests", json={"display_name": b.name.upper(), "client_request_id": key})
    assert replay.status_code == 201 and replay.json() == first.json()
    assert a.http.post("/api/friends/requests", json={"display_name": c.name, "client_request_id": key}
                       ).json()["error"]["code"] == "idempotency_conflict"
    for sender, target in ((a, b), (b, a)):
        r = sender.http.post("/api/friends/requests", json={"display_name": target.name, "client_request_id": idempotency_key()})
        assert r.status_code == 409 and r.json()["error"]["code"] == "request_pending"
    for name, message in ((a.name, "You can't add yourself."), ("zz" + uuid.uuid4().hex[:10], "No player has that display name.")):
        r = a.http.post("/api/friends/requests", json={"display_name": name, "client_request_id": idempotency_key()})
        assert r.status_code == 422 and r.json()["error"]["fields"]["display_name"] == message
    r = c.http.post("/api/friends/requests", json={"display_name": a.name, "client_request_id": idempotency_key()})
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_unverified"
    incoming = b.http.get("/api/friends").json()["incoming"]
    assert [i["id"] for i in incoming if i["from"]["account_id"] == a.id] == [first.json()["request"]["id"]]
    rid = first.json()["request"]["id"]
    assert a.http.post(f"/api/friends/requests/{rid}/accept").status_code != 200
    assert b.http.post(f"/api/friends/requests/{rid}/accept").json()["friend"]["account_id"] == a.id
    r = b.http.post(f"/api/friends/requests/{rid}/accept")
    assert r.status_code == 409 and r.json()["error"]["code"] == "request_closed"
    r = a.http.post("/api/friends/requests", json={"display_name": b.name, "client_request_id": idempotency_key()})
    assert r.status_code == 409 and r.json()["error"]["code"] == "already_friends"


def test_wf_friends_presence_tabs(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    a, b = crew(base, mail, "en", "en")
    with ui(browser, a, "/lobby", wrong_clock=True) as page:
        item = page.get_by_role("list", name="Friends").get_by_role("listitem").filter(has_text=b.name)
        holds(page, item, "Offline")
        with account_ctx(browser, b) as ctx:
            t1, t2 = connect(ctx, base), connect(ctx, base)
            holds(page, item, "Online", PRESENCE_ONLINE_S + SLACK_S)
            t1.close()
            hold_true(lambda: "Online" in item.inner_text(), PRESENCE_LAST_TAB_S + 1, "online with one tab left")
            t2.close()
            holds(page, item, "Offline", PRESENCE_LAST_TAB_S + SLACK_S)
            connect(ctx, base)
            holds(page, item, "Online", PRESENCE_ONLINE_S + SLACK_S)
            beat = time.monotonic()
            hold_true(lambda: "Online" in item.inner_text(), PRESENCE_FRESH_S - 8, "online inside heartbeat window")
            holds(page, item, "Offline", PRESENCE_HEARTBEAT_S - (time.monotonic() - beat) + SLACK_S)
    assert next(f for f in a.http.get("/api/friends").json()["friends"] if f["account_id"] == b.id)["presence"] == "offline"


def test_wf_ready_check_keyboard_dialog(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m = crew(base, mail, "en", "ja")
    pid = make_party(lead, [m])
    with ui(browser, lead, f"/party/{pid}") as lpage, ui(browser, m, f"/party/{pid}") as mpage:
        leave = mpage.get_by_role("button", name="パーティーを抜ける")
        appears(mpage, leave)
        leave.focus()
        start = lpage.get_by_role("button", name="Start ready check")
        start.click()
        ldialog = lpage.get_by_role("alertdialog", name="Ready check")
        focused(lpage, ldialog.get_by_role("button", name="Ready", exact=True))
        deadline = party_of(lead, pid)["ready_check"]["deadline_at"]
        lpage.keyboard.press("Escape")
        focused(lpage, start)
        start.click()
        appears(lpage, ldialog)
        assert party_of(lead, pid)["ready_check"]["deadline_at"] == deadline
        mdialog = mpage.get_by_role("alertdialog", name="準備確認")
        focused(mpage, mdialog.get_by_role("button", name="準備OK"))
        for _ in range(4):
            mpage.keyboard.press("Tab")
            assert inside(mdialog)
        mpage.keyboard.press("Escape")
        focused(mpage, leave)
        mpage.get_by_role("button", name="準備確認を開く").click()
        appears(mpage, mdialog)
        ready = mdialog.get_by_role("button", name="準備OK")
        for _ in range(3):
            if ready.evaluate("e => e === document.activeElement"):
                break
            mpage.keyboard.press("Tab")
        mpage.keyboard.press("Space")
        see(mpage, lambda: expect(ready).to_be_disabled(timeout=SLICE_MS))
        expect(mdialog.get_by_role("button", name="まだ")).to_be_disabled()
        expect(mdialog).to_be_visible()
        lready = ldialog.get_by_role("button", name="Ready", exact=True)
        for _ in range(3):
            if lready.evaluate("e => e === document.activeElement"):
                break
            lpage.keyboard.press("Tab")
        lpage.keyboard.press("Enter")
        poll(lambda: party_of(lead, pid)["status"] == "in_session", RT_S, "session started")


def test_wf_ready_check_server_timer(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m, n = crew(base, mail, "en", "ja", "es")
    pid = make_party(lead, [m, n])

    ja_left, es_left = filled_re("残り<seconds>秒", "seconds"), filled_re("Quedan <seconds> s", "seconds")

    def seconds_of(text: str, pattern: Any) -> int:
        found = re.fullmatch(pattern, text.strip())
        assert found, text
        return int(found.group(1))

    with ui(browser, m, f"/party/{pid}", wrong_clock=True) as mpage, ui(browser, n, f"/party/{pid}") as npage:
        r = lead.http.post(f"/api/parties/{pid}/ready-check")
        assert r.status_code == 201
        assert lead.http.post(f"/api/parties/{pid}/ready-check").json()["error"]["code"] == "wrong_state"
        mtimer = mpage.get_by_role("alertdialog", name="準備確認").get_by_role("timer", name="残り時間")
        appears(mpage, mtimer)

        def matches_server(timer: Locator, pattern: str) -> None:
            shown = seconds_of(timer.inner_text(), pattern)
            assert abs(shown - party_of(lead, pid)["ready_check"]["remaining_seconds"]) <= 1, shown
        see(mpage, lambda: matches_server(mtimer, ja_left))
        before = mtimer.inner_text()
        mpage.clock.fast_forward("01:00:00")
        assert mtimer.inner_text() == before
        ndialog = npage.get_by_role("alertdialog", name="Comprobación de listos")
        ndialog.get_by_role("button", name="Listo", exact=True).click()
        poll(lambda: party_of(lead, pid)["ready_check"]["responses"][n.id] == "ready", RT_S, "N answered")
        see(npage, lambda: matches_server(ndialog.get_by_role("timer", name="Tiempo restante"), es_left))
        mpage.reload()
        see(mpage, lambda: matches_server(mtimer, ja_left))
        assert party_of(lead, pid)["status"] == "ready_check"
        poll(lambda: party_of(lead, pid)["status"] == "forming", READY_WINDOW_S + SLACK_S * 4, "check ended by server")
    assert party_of(lead, pid)["ready_check"] is None
    r = m.http.post(f"/api/parties/{pid}/ready-check/response", json={"ready": True})
    assert r.status_code == 409 and r.json()["error"]["code"] == "no_ready_check"
    texts = {msg["text"] for msg in channel_messages(lead, f"party-{pid}")}
    assert filled("Ready check failed: <n> not ready.", n=2) in texts
    assert filled("準備確認に失敗しました: 未準備<n>人。", n=2) in {
        msg["text"] for msg in channel_messages(m, f"party-{pid}")}


def test_ready_check_reload_reopens(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m, n = crew(base, mail, "en", "ja", "es")
    pid = make_party(lead, [m, n])
    with ui(browser, m, f"/party/{pid}") as mpage, ui(browser, n, f"/party/{pid}") as npage:
        appears(mpage, mpage.get_by_role("button", name="パーティーを抜ける"))
        appears(npage, npage.get_by_role("button", name="Salir del grupo"))
        assert lead.http.post(f"/api/parties/{pid}/ready-check").status_code == 201
        assert n.http.post(f"/api/parties/{pid}/ready-check/response", json={"ready": True}).status_code == 200
        mpage.reload()
        npage.reload()

        def server_seconds(timer: Locator, pattern: str) -> None:
            found = re.search(pattern, timer.inner_text())
            assert found, timer.inner_text()
            assert abs(int(found.group(1)) - party_of(lead, pid)["ready_check"]["remaining_seconds"]) <= 1

        mdialog = mpage.get_by_role("alertdialog", name="準備確認")
        focused(mpage, mdialog.get_by_role("button", name="準備OK"))
        see(mpage, lambda: server_seconds(mdialog.get_by_role("timer", name="残り時間"),
                                          filled_re("残り<seconds>秒", "seconds")))
        ndialog = npage.get_by_role("alertdialog", name="Comprobación de listos")
        appears(npage, ndialog)
        see(npage, lambda: expect(ndialog.get_by_role("button", name="Listo", exact=True)).to_be_disabled(timeout=SLICE_MS))
        expect(ndialog.get_by_role("button", name="No listo", exact=True)).to_be_disabled()
        see(npage, lambda: server_seconds(ndialog.get_by_role("timer", name="Tiempo restante"),
                                          filled_re("Quedan <seconds> s", "seconds")))
    assert party_of(lead, pid)["status"] == "ready_check"


def test_ready_check_deadline(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m = crew(base, mail, "en", "en")
    pid = make_party(lead, [m])
    with ui(browser, m, f"/party/{pid}", wrong_clock=True) as page:
        appears(page, page.get_by_role("button", name="Leave party"))
        r = lead.http.post(f"/api/parties/{pid}/ready-check")
        assert r.status_code == 201, r.text
        check = r.json()["party"]["ready_check"]
        server_now = int(parsedate_to_datetime(r.headers["date"]).timestamp())
        assert type(check["deadline_at"]) is int and type(check["remaining_seconds"]) is int
        assert READY_WINDOW_S - 1 <= check["deadline_at"] - server_now <= READY_WINDOW_S + 1
        assert 0 < check["remaining_seconds"] <= READY_WINDOW_S + 1
        assert party_of(m, pid)["ready_check"]["deadline_at"] == check["deadline_at"]
        timer = page.get_by_role("alertdialog", name="Ready check").get_by_role("timer", name="Time left")

        def server_seconds() -> None:
            found = filled_re("<seconds> s left", "seconds").fullmatch(timer.inner_text().strip())
            assert found, timer.inner_text()
            assert abs(int(found.group(1)) - party_of(m, pid)["ready_check"]["remaining_seconds"]) <= 1
        see(page, server_seconds)


def test_wf_coop_rejoin_drop_and_rejoin(browser: Browser, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    a, b = crew(base, mail, "en", "es")
    pid = make_party(a, [b], "smudged-keep")
    sid = start_coop(pid, a, [b])
    with account_ctx(browser, a) as actx, account_ctx(browser, b) as bctx:
        tb = connect(bctx, base, session_id=sid)
        t1 = connect(actx, base, session_id=sid)
        walk(a, t1, sid, 2, 0)
        with ui(browser, b, f"/play/{sid}", wrong_clock=True) as bpage:
            roster = bpage.get_by_role("list", name="Miembros de la partida").get_by_role("listitem").filter(has_text=a.name)
            appears(bpage, roster)
            t1.close()
            first = poll(lambda: (lambda e: e if e["status"] == "dropped" else None)(member(snapshot(b, sid), a.id)),
                         SYNC_S + SLACK_S, "first drop")
            line = poll(lambda: next((msg["text"] for msg in channel_messages(b, f"party-{pid}") if msg["code"] == "dropped"), None),
                        RT_S, "dropped line")
            grace = int(filled_re("<name> perdió la conexión. Su puesto se reserva <seconds> segundos.", "seconds",
                                  name=a.name).fullmatch(line).group(1))
            assert isinstance(first["grace_remaining_seconds"], int) and 0 < first["grace_remaining_seconds"] <= grace
            pm = next(x for x in party_of(b, pid)["members"] if x["account_id"] == a.id)
            assert pm["connection"] == "dropped" and pm["grace_remaining_seconds"] <= grace
            seat_line = filled_re("Puesto reservado: <seconds> s", "seconds")
            see(bpage, lambda: expect(roster).to_contain_text(seat_line, timeout=SLICE_MS))
            assert int(seat_line.search(roster.inner_text()).group(1)) <= grace
            poll(lambda: member(snapshot(b, sid), a.id)["grace_remaining_seconds"] <= grace - 3, grace, "grace runs down")
            t2 = connect(actx, base, session_id=sid)
            back = member(snapshot(a, sid), a.id)
            assert back["status"] == "connected" and back["position"] == {"x": 2, "z": 0}
            assert party_of(a, pid)["id"] == pid
            t3 = connect(actx, base, session_id=sid)
            t2.close()
            hold_true(lambda: member(snapshot(b, sid), a.id)["status"] == "connected", SYNC_S + SLACK_S, "still connected")
            t3.close()
            second = poll(lambda: (lambda e: e if e["status"] == "dropped" else None)(member(snapshot(b, sid), a.id)),
                          SYNC_S + SLACK_S, "second drop")
            assert second["grace_remaining_seconds"] >= grace - 1
            poll(lambda: member(snapshot(b, sid), a.id) is None, GRACE_WAIT_S, "seat released")
            assert a.id not in [x["account_id"] for x in party_of(b, pid)["members"]]
            codes = [msg["code"] for msg in channel_messages(b, f"party-{pid}") if msg["kind"] == "system"]
            assert (codes.count("dropped"), codes.count("rejoined"), codes.count("removed")) == (2, 1, 1)
            finish_chapter(b, tb, sid)
            see(bpage, lambda: at(bpage, complete_route("smudged-keep", 1)), COMPLETE_ROUTE_S + SLACK_S)


def test_wf_coop_rejoin_grace_nobody_progress(browser: Browser, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    a, b = crew(base, mail, "en", "en")
    pid = make_party(a, [b], "eraser-ferry")
    sid = start_coop(pid, a, [b])
    with account_ctx(browser, a) as actx, account_ctx(browser, b) as bctx:
        ta, tb = connect(actx, base, session_id=sid), connect(bctx, base, session_id=sid)
        walk(a, ta, sid, 4, 0)
        walk(a, ta, sid, -4, 0)
        poll(lambda: party_of(a, pid)["progress"]["checkpoint"] == {"chapter": 1, "motes": ["m1"]}, SYNC_S + SLACK_S, "checkpoint")
        walk(a, ta, sid, 4, 4)
        ta.close()
        tb.close()
        poll(lambda: party_of(a, pid)["status"] == "forming", GRACE_WAIT_S, "party back to forming")
        assert {x["account_id"] for x in party_of(a, pid)["members"]} == {a.id, b.id}
        again = connect(actx, base, session_id=sid)
        assert again.wait(lambda msg: msg.get("type") == "join_refused")["event"]["kind"] == "session_ended"
    progress = party_of(a, pid)["progress"]
    assert progress["checkpoint"] == {"chapter": 1, "motes": ["m1"]} and progress["unlocked_chapter"] == 1
    sid2 = start_coop(pid, a, [b])
    snap = snapshot(a, sid2)
    assert snap["chapter"] == 1 and collected(snap) == {"m1"}
    assert all(x["position"] == {"x": -4, "z": 0} and x["health"] == 100 for x in snap["members"])


def test_wf_coop_rejoin_same_seat(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    a, b = crew(base, mail, "en", "es")
    pid = make_party(a, [b])
    sid = start_coop(pid, a, [b])
    with account_ctx(browser, a) as actx, account_ctx(browser, b) as bctx:
        connect(bctx, base, session_id=sid)
        t1 = connect(actx, base, session_id=sid)
        walk(a, t1, sid, 2, 0)
        t1.close()
        poll(lambda: member(snapshot(b, sid), a.id)["status"] == "dropped", SYNC_S + SLACK_S, "A dropped")
        assert next(x for x in party_of(b, pid)["members"] if x["account_id"] == a.id)["connection"] == "dropped"
        with ui(browser, a, f"/play/{sid}") as page:
            appears(page, page.get_by_role("application", name="Game view"))
            back = poll(lambda: (lambda e: e if e["status"] == "connected" else None)(member(snapshot(b, sid), a.id)),
                        RT_S, "A rejoined")
            assert back["position"] == {"x": 2, "z": 0} and back["grace_remaining_seconds"] is None
            assert len(snapshot(b, sid)["members"]) == 2
            party = party_of(a, pid)
            assert party["session_id"] == sid and {x["account_id"] for x in party["members"]} == {a.id, b.id}
            appears(page, page.get_by_role("list", name="Session members").get_by_role("listitem").filter(has_text=a.name))


def test_grace_held_by_server(browser: Browser, mail: Any) -> None:
    base = env_url("APP_SHORT_URL")
    a, b = crew(base, mail, "en", "en")
    pid = make_party(a, [b])
    sid = start_coop(pid, a, [b])
    with account_ctx(browser, a) as actx, account_ctx(browser, b) as bctx:
        connect(bctx, base, session_id=sid)
        ta = connect(actx, base, session_id=sid)
        with ui(browser, b, f"/play/{sid}", wrong_clock=True) as page:
            item = page.get_by_role("list", name="Session members").get_by_role("listitem").filter(has_text=a.name)
            appears(page, item)
            ta.close()
            dropped = poll(lambda: (lambda e: e if e and e["status"] == "dropped" else None)(member(snapshot(b, sid), a.id)),
                           SYNC_S + SLACK_S, "A dropped")
            assert type(dropped["grace_remaining_seconds"]) is int and dropped["grace_remaining_seconds"] > 0

            def shows_server_grace() -> None:
                found = filled_re("Seat held: <seconds> s", "seconds").search(item.inner_text())
                assert found, item.inner_text()
                entry = member(snapshot(b, sid), a.id)
                assert entry and entry["grace_remaining_seconds"] is not None
                assert abs(int(found.group(1)) - entry["grace_remaining_seconds"]) <= 1
            see(page, shows_server_grace)
            page.clock.fast_forward("01:00:00")
            see(page, shows_server_grace)
            poll(lambda: member(snapshot(b, sid), a.id) is None, GRACE_WAIT_S, "seat released by the server")
    party = party_of(b, pid)
    assert a.id not in [x["account_id"] for x in party["members"]] and party["status"] == "in_session"


def test_wf_coop_rejoin_emote_hotkeys(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    a, b = crew(base, mail, "en", "es")
    pid = make_party(a, [b])
    sid = start_coop(pid, a, [b])
    with account_ctx(browser, b) as bctx, ui(browser, a, f"/play/{sid}") as page:
        tb = connect(bctx, base, session_id=sid)
        skip = page.get_by_role("button", name="Skip")
        if skip.count():
            skip.click()
        emotes = page.get_by_role("button", name="Emotes")
        log = page.get_by_role("log", name="Session events")
        emotes.focus()
        page.keyboard.press("e")
        focused(page, page.get_by_role("menu", name="Emotes").get_by_role("menuitem", name="Wave"))
        page.keyboard.press("Escape")
        focused(page, emotes)
        page.keyboard.press("3")
        holds(page, log, filled("<name>: <emote>", name=a.name, emote="Bow"))
        page.keyboard.press("e")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        holds(page, log, filled("<name>: <emote>", name=a.name, emote="Cheer"))
        poll(lambda: {e["event"].get("emote") for e in tb.events(f"session:{sid}") if e["event"]["kind"] == "emote"} >= {"bow", "cheer"},
             RT_S, "emotes on B's stream")
        message = page.get_by_role("textbox", name="Message")
        message.focus()
        page.keyboard.press("1")
        expect(message).to_have_value("1")
        hold_true(lambda: "wave" not in {e["event"].get("emote") for e in tb.events(f"session:{sid}")}, SYNC_S + SLACK_S, "no wave")


def test_streams_survive_restart(browser: Browser) -> None:
    copy = AppCopy({})
    try:
        copy.start()
        p = signup(copy.base)
        sid = start_solo(p)["session_id"]
        stream = f"session:{sid}"
        with account_ctx(browser, p, copy.base) as ctx:
            tab = connect(ctx, copy.base, session_id=sid)
            kept = str(uuid.uuid4())
            for i in range(10):
                tab.intent(sid, "emote", intent_id=kept if i == 0 else None, emote="wave")
            seqs = poll(lambda: (lambda s: s if len(s) >= 10 else None)([e["seq"] for e in tab.events(stream)]), RT_S, "events")
            assert all(isinstance(s, int) for s in seqs) and seqs == list(range(seqs[0], seqs[0] + len(seqs)))
            top = seqs[-1]
            tab.close()
        copy.stop()
        copy.start()
        with account_ctx(browser, p, copy.base) as ctx:
            tab = connect(ctx, copy.base, resume={stream: top - 1}, session_id=sid)
            replay = poll(lambda: tab.events(stream), RT_S, "replay")
            assert min(e["seq"] for e in replay) == top and all(e["seq"] > top - 1 for e in replay)
            dup = tab.intent(sid, "emote", intent_id=kept, emote="wave")
            assert (dup["applied"], dup["duplicate"]) == (False, True)
            seen = max(e["seq"] for e in tab.events(stream))
            tab.intent(sid, "emote", emote="cheer")
            fresh = poll(lambda: [e for e in tab.events(stream) if e["seq"] > seen], RT_S, "post-restart event")
            assert fresh[0]["seq"] == seen + 1
    finally:
        copy.stop()


def test_wf_party_night_gather_and_play(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m = crew(base, mail, "en", "es")
    outsider = signup(base)
    with ui(browser, lead, "/lobby") as lpage:
        lpage.get_by_role("button", name="Create party").click()
        party = poll(lambda: lead.http.get("/api/parties/current").json()["party"], UI_S, "party created")
        pid = party["id"]
        if not lpage.url.endswith(f"/party/{pid}"):
            lpage.goto(f"{base}/party/{pid}")
        select(lpage.get_by_role("combobox", name="Co-op story"), "The Eraser Ferry")
        poll(lambda: party_of(lead, pid)["story_id"] == "eraser-ferry", UI_S, "story chosen")
        lpage.get_by_role("button", name=f"Invite {m.name}").click()
        token = poll(lambda: next((i["token"] for i in m.http.get("/api/invites").json()["invites"] if i["party_id"] == pid), None), UI_S, "invite")
        with ui(browser, m, f"/invite/{token}") as mpage:
            mpage.get_by_role("button", name="Unirse al grupo").click()
            see(mpage, lambda: expect(mpage).to_have_url(re.compile(rf"/party/{pid}$"), timeout=SLICE_MS))
            mpage.reload()
            holds(mpage, mpage.get_by_role("list", name="Miembros"), m.name)
            holds(lpage, lpage.get_by_role("list", name="Party members"), m.name, PRESENCE_ONLINE_S + SLACK_S)
            with ui(browser, m, f"/party/{pid}") as deep:
                holds(deep, deep.get_by_role("list", name="Miembros"), lead.name)
            sid = start_coop(pid, lead, [m])
            for page, title in ((lpage, titled("The Eraser Ferry")), (mpage, titled("El ferry de goma"))):
                see(page, lambda page=page: expect(page).to_have_url(re.compile(rf"/play/{sid}$"), timeout=SLICE_MS))
                see(page, lambda page=page, title=title: expect(page).to_have_title(title, timeout=SLICE_MS))
            route = complete_route("eraser-ferry", 1)
            with account_ctx(browser, lead) as ctx:
                finish_chapter(lead, connect(ctx, base, session_id=sid), sid)
            for page in (lpage, mpage):
                see(page, lambda page=page: expect(page).to_have_url(re.compile(re.escape(route) + "$"), timeout=SLICE_MS),
                    COMPLETE_ROUTE_S + SLACK_S)
            appears(lpage, lpage.get_by_role("heading", name=filled("Chapter <n> complete", n=1)))
            appears(mpage, mpage.get_by_role("heading", name=filled("Capítulo <n> completado", n=1)))
            appears(lpage, lpage.get_by_role("button", name="Back to lobby").or_(lpage.get_by_role("link", name="Back to lobby")))
            expect(mpage.get_by_role("button", name="Volver a la sala").or_(mpage.get_by_role("link", name="Volver a la sala"))).to_have_count(0)
            lpage.reload()
            appears(lpage, lpage.get_by_role("heading", name=filled("Chapter <n> complete", n=1)))
    with ui(browser, outsider, route) as opage:
        response = opage.goto(base + route)
        assert response is not None and response.status == 404
        appears(opage, opage.get_by_role("heading", name="We couldn't find that page."))
    progress = party_of(lead, pid)["progress"]
    assert 1 in progress["completed_chapters"] and progress["unlocked_chapter"] == 2
    assert lead.http.post(f"/api/parties/{pid}/return").json()["party"]["status"] == "forming"
    assert snapshot(lead, start_coop(pid, lead, [m]))["chapter"] == 2


def test_wf_party_night_gather(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m = crew(base, mail, "en", "en")
    unverified = signup(base)
    r = unverified.http.post("/api/parties", json={"story_id": "smudged-keep"})
    assert r.status_code == 403 and r.json()["error"]["code"] == "email_unverified"
    with ui(browser, lead, "/lobby") as page:
        page.get_by_role("button", name="Create party").click()
        party = poll(lambda: lead.http.get("/api/parties/current").json()["party"], UI_S, "party created")
        pid = party["id"]
        assert party["leader_id"] == lead.id and party["status"] == "forming"
        if not page.url.endswith(f"/party/{pid}"):
            page.goto(f"{base}/party/{pid}")
        page.get_by_role("button", name=f"Invite {m.name}").click()
        token = poll(lambda: next((i["token"] for i in m.http.get("/api/invites").json()["invites"]
                                   if i["party_id"] == pid), None), UI_S, "invite sent")
        assert m.http.post(f"/api/invites/{token}/accept").status_code == 200
        holds(page, page.get_by_role("list", name="Party members"), m.name, PRESENCE_ONLINE_S + SLACK_S)
    final = party_of(lead, pid)
    assert {x["account_id"] for x in final["members"]} == {lead.id, m.id}
    assert final["story_id"] in ("smudged-keep", "eraser-ferry")


def test_invite_lands_on_lobby(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, m = crew(base, mail, "en", "ja")
    r = lead.http.post("/api/parties", json={"story_id": "smudged-keep"})
    assert r.status_code == 201, r.text
    pid = r.json()["party"]["id"]
    token = invite(lead, pid, m)

    def lobby_ok(page: Page) -> None:
        see(page, lambda: expect(page).to_have_title(titled("パーティーロビー"), timeout=SLICE_MS))
        members = page.get_by_role("list", name="メンバー")
        holds(page, members, lead.name)
        holds(page, members, m.name)

    with ui(browser, m, f"/invite/{token}") as page:
        page.get_by_role("button", name="パーティーに参加").click()
        see(page, lambda: expect(page).to_have_url(re.compile(rf"/party/{pid}$"), timeout=SLICE_MS))
        lobby_ok(page)
        page.reload()
        assert page.url.endswith(f"/party/{pid}")
        lobby_ok(page)
    with ui(browser, m, f"/party/{pid}") as deep:
        lobby_ok(deep)
    assert m.http.get("/api/parties/current").json()["party"]["id"] == pid


def parker(box: list[Any]) -> Callable[[Any], None]:
    def park(route: Any) -> None:
        box.append(route)
    return park


def test_wf_party_night_fourth_seat_race(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, x, y, p_en, p_ja, p_es = crew(base, mail, "en", "en", "en", "en", "ja", "es")
    pid = make_party(lead, [x, y])
    hopefuls = {p_en: ("Join party", "Working...", "This party is full (4 of 4).", "Notifications", "Party members"),
                p_ja: ("パーティーに参加", "処理中...", "このパーティーは満員です（4/4）。", "お知らせ", "メンバー"),
                p_es: ("Unirse al grupo", "Procesando...", "Este grupo está completo (4 de 4).", "Avisos", "Miembros")}
    tokens = {pl: invite(lead, pid, pl) for pl in hopefuls}
    with contextlib.ExitStack() as stack:
        pages, parked = {}, {}
        for pl in hopefuls:
            page = stack.enter_context(ui(browser, pl, f"/invite/{tokens[pl]}"))
            parked[pl] = []
            page.route("**/api/invites/*/accept", parker(parked[pl]))
            pages[pl] = page
        for pl, page in pages.items():
            page.get_by_role("button", name=hopefuls[pl][0]).click()
        for pl, page in pages.items():
            see(page, lambda pl=pl: assert_(bool(parked[pl])))
            pending = page.get_by_role("button", name=hopefuls[pl][1])
            expect(pending).to_be_disabled()
            assert re.search(r"/invite/", page.url)
            expect(page.get_by_role("list", name=hopefuls[pl][4])).to_have_count(0)
        for pl in hopefuls:
            parked[pl][0].continue_()
        winners = []
        for pl, page in pages.items():
            def settled(page: Page = page, pl: Player = pl) -> None:
                if re.search(rf"/party/{pid}$", page.url):
                    return
                expect(page.get_by_role("status", name=hopefuls[pl][3])).to_have_text(hopefuls[pl][2], timeout=SLICE_MS)
            see(page, settled)
            if re.search(rf"/party/{pid}$", page.url):
                winners.append(pl)
            else:
                expect(page.get_by_role("button", name=hopefuls[pl][0])).to_be_enabled()
                expect(page.get_by_role("list", name=hopefuls[pl][4])).to_have_count(0)
        assert len(winners) == 1
    members = [mm["account_id"] for mm in party_of(lead, pid)["members"]]
    assert len(members) == 4 and winners[0].id in members
    losers = [pl for pl in hopefuls if pl is not winners[0]]
    for pl in losers:
        assert pl.http.get("/api/parties/current").json()["party"] is None
    assert x.http.post(f"/api/parties/{pid}/leave").status_code == 204
    barrier = threading.Barrier(len(losers))
    results: dict[str, int] = {}

    def race(pl: Player) -> None:
        barrier.wait()
        results[pl.id] = pl.http.post(f"/api/invites/{tokens[pl]}/accept").status_code
    threads = [threading.Thread(target=race, args=(pl,)) for pl in losers]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert sorted(results.values()) == [200, 409]
    assert len(party_of(lead, pid)["members"]) == 4
    still = next(pl for pl in losers if results[pl.id] == 409)
    assert tokens[still] in [i["token"] for i in still.http.get("/api/invites").json()["invites"]]


def test_party_leader_rules(app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, a, b, c = crew(base, mail, "en", "en", "en", "en")
    pid = make_party(lead, [a, b, c])
    assert lead.http.post(f"/api/parties/{pid}/leader", json={"account_id": b.id}).json()["party"]["leader_id"] == b.id
    r = lead.http.post(f"/api/parties/{pid}/ready-check")
    assert r.status_code == 403 and r.json()["error"] == {"code": "not_leader", "message": "Only the party leader can do that."}
    assert b.http.post(f"/api/parties/{pid}/leader", json={"account_id": str(uuid.uuid4())}).status_code == 404
    assert b.http.post(f"/api/parties/{pid}/leave").status_code == 204
    assert party_of(lead, pid)["leader_id"] == lead.id
    barrier = threading.Barrier(2)

    def leave(pl: Player) -> None:
        barrier.wait()
        assert pl.http.post(f"/api/parties/{pid}/leave").status_code == 204
    threads = [threading.Thread(target=leave, args=(pl,)) for pl in (lead, a)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    party = party_of(c, pid)
    assert [mm["account_id"] for mm in party["members"]] == [c.id] and party["leader_id"] == c.id
    texts = [msg["text"] for msg in channel_messages(c, f"party-{pid}")]
    assert f"{b.name} is now the party leader." in texts and f"{c.name} is now the party leader." in texts


def test_party_system_lines_localised(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    lead, j, s = crew(base, mail, "en", "ja", "es")
    pid = make_party(lead, [j, s])
    assert lead.http.post(f"/api/parties/{pid}/ready-check").status_code == 201
    assert j.http.post(f"/api/parties/{pid}/ready-check/response", json={"ready": False}).status_code == 200
    assert lead.http.post(f"/api/parties/{pid}/leader", json={"account_id": s.id}).status_code == 200
    expected = {
        lead: [f"{j.name} joined the party.", "Ready check started: 20 seconds to answer.", filled("Ready check failed: <n> not ready.", n=3),
               f"{s.name} is now the party leader."],
        j: [f"{j.name}さんがパーティーに参加しました。", "準備確認を開始しました。20秒以内に回答してください。",
            filled("準備確認に失敗しました: 未準備<n>人。", n=3), f"{s.name}さんがリーダーになりました。"],
        s: [f"{j.name} se unió al grupo.", "Comprobación de listos iniciada: 20 segundos para responder.",
            filled("Comprobación fallida: <n> sin confirmar.", n=3), f"{s.name} es ahora líder del grupo."],
    }
    for reader, lines in expected.items():
        msgs = channel_messages(reader, f"party-{pid}")
        system = [msg for msg in msgs if msg["kind"] == "system"]
        assert all(msg["author"] is None and msg["code"] for msg in system)
        for line in lines:
            assert line in [msg["text"] for msg in system], (reader.locale, line)
    assert j.http.post(f"/api/parties/{pid}/leave").status_code == 204
    assert f"{j.name} salió del grupo." in [msg["text"] for msg in channel_messages(s, f"party-{pid}")]
    with ui(browser, s, f"/party/{pid}") as page:
        holds(page, page.get_by_role("log", name="Mensajes"), f"{j.name} se unió al grupo.")


def test_wf_reconnect_chat_phone_drawer(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    with ui(browser, p, "/lobby", viewport=(375, 812), touch_screen=True) as page:
        page.reload()
        layout(page)
        opener = page.get_by_role("button", name="Open chat")
        appears(page, opener)
        assert not ax_present(page, "textbox", "Message") and not ax_present(page, "log", "Messages")
        assert not {"Message", "Send"} & set(tab_order(page, 25))
        opener.click()
        drawer = page.get_by_role("dialog", name="Chat")
        message = drawer.get_by_role("textbox", name="Message")
        focused(page, message)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert inside(drawer)
        message.fill(EMOJI * CHAT_MAX)
        see(page, lambda: expect(message).to_have_accessible_description(filled("<used>/280", used=CHAT_MAX),
                                                                         timeout=SLICE_MS))
        expect(message).to_have_value(EMOJI * CHAT_MAX)
        message.press("Enter")
        see(page, lambda: expect(message).to_have_value("", timeout=SLICE_MS))
        bodies = [f"note-{uuid.uuid4().hex[:8]}" for _ in range(CHAT_RATE - 1)]
        for body in bodies[:-1]:
            message.fill(body)
            message.press("Enter")
            see(page, lambda: expect(message).to_have_value("", timeout=SLICE_MS))
        page.context.set_offline(True)
        message.fill(bodies[-1])
        drawer.get_by_role("button", name="Send").click()
        appears(page, drawer.get_by_role("button", name="Working..."))
        expect(message).to_have_value(bodies[-1])
        page.context.set_offline(False)
        see(page, lambda: expect(message).to_have_value("", timeout=SLICE_MS))
        sixth = f"late-{uuid.uuid4().hex[:8]}"
        page.context.set_offline(True)
        advance(page, 500)
        page.context.set_offline(False)
        message.fill(sixth)
        message.press("Enter")
        shows(page, page.get_by_role("status", name="Chat status"),
              filled_re("Slow down: you can send again in <seconds> s.", "seconds"))
        expect(message).to_have_value(sixth)
        expect(drawer).to_be_visible()

        def delivered() -> bool:
            if message.input_value() == sixth:
                message.press("Enter")
            advance(page, 500)
            return sum(m["body"] == sixth for m in channel_messages(p, "lobby")) == 1
        poll(delivered, CHAT_WINDOW_S + SLACK_S * 4, "message after cooldown")
        msgs = channel_messages(p, "lobby")
        for body in [EMOJI * CHAT_MAX, *bodies, sixth]:
            assert sum(m["body"] == body and m["author"]["account_id"] == p.id for m in msgs) == 1, body
        draft = f"draft-{uuid.uuid4().hex[:6]}"
        message.fill(draft)
        page.context.set_offline(True)
        advance(page, 2000)
        page.context.set_offline(False)
        advance(page, 2000)
        expect(drawer).to_be_visible()
        expect(message).to_have_value(draft)
        page.keyboard.press("Escape")
        focused(page, opener)
        assert not ax_present(page, "textbox", "Message")
        page.set_viewport_size({"width": 768, "height": 1024})
        page.reload()
        appears(page, page.get_by_role("textbox", name="Message"))
        expect(page.get_by_role("button", name="Open chat")).to_have_count(0)
        layout(page)


def test_chat_api_limits_idempotency(app_url: str) -> None:
    base = app_url.rstrip("/")
    p = signup(base, "es")
    sid = start_solo(p)["session_id"]
    for channel in ("lobby", f"session-{sid}"):
        cid = idempotency_key()
        body = EMOJI * CHAT_MAX
        first = post_chat(p, channel, body, cid)
        assert first.status_code == 201 and first.json()["message"]["body"] == body
        assert isinstance(first.json()["message"]["seq"], int)
        replay = post_chat(p, channel, body, cid)
        assert replay.status_code == 201 and replay.json()["message"]["id"] == first.json()["message"]["id"]
        assert sum(m["id"] == first.json()["message"]["id"] for m in channel_messages(p, channel)) == 1
        conflict = post_chat(p, channel, "otro", cid)
        assert conflict.status_code == 409 and conflict.json()["error"]["code"] == "idempotency_conflict"
        for bad in (EMOJI * (CHAT_MAX + 1), "   ", ""):
            r = post_chat(p, channel, bad)
            assert r.status_code == 422
            assert r.json()["error"]["fields"]["body"] == "Los mensajes deben tener entre 1 y 280 caracteres."
    channel = f"session-{sid}"
    assert signup(base).http.get(f"/api/chat/{channel}/messages", params={"after_seq": 0}).status_code == 404


def test_chat_rate_limit(app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    channel = f"session-{start_solo(p)['session_id']}"
    sent = [(idempotency_key(), f"m{i}-{uuid.uuid4().hex[:6]}") for i in range(CHAT_RATE)]
    for cid, body in sent:
        assert post_chat(p, channel, body, cid).status_code == 201
    sixth_id, sixth = idempotency_key(), f"six-{uuid.uuid4().hex[:6]}"
    r = post_chat(p, channel, sixth, sixth_id)
    assert r.status_code == 429 and r.json()["error"]["code"] == "rate_limited"
    retry = int(r.headers["retry-after"])
    assert 1 <= retry <= CHAT_WINDOW_S
    assert r.json()["error"]["message"] == f"Slow down: you can send again in {retry} s."
    assert sixth not in [m["body"] for m in channel_messages(p, channel)]
    assert post_chat(p, channel, sent[-1][1], sent[-1][0]).status_code == 201
    assert post_chat(p, "lobby", sixth).status_code == 201
    poll(lambda: post_chat(p, channel, sixth, sixth_id).status_code == 201, retry + SLACK_S * 2, "cooldown over")
    assert [m["body"] for m in channel_messages(p, channel)].count(sixth) == 1


def test_wf_reconnect_chat_no_duplicates(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    p = signup(base)
    sid = start_solo(p)["session_id"]
    chat_stream, session_stream = f"chat:session-{sid}", f"session:{sid}"
    with account_ctx(browser, p) as ctx:
        t1 = connect(ctx, base, session_id=sid)
        assert post_chat(p, f"session-{sid}", "uno").status_code == 201
        iid = str(uuid.uuid4())
        t1.intent(sid, "emote", intent_id=iid, emote="wave")
        s1 = poll(lambda: t1.events(chat_stream), RT_S, "chat event")[-1]["seq"]
        e1 = poll(lambda: t1.events(session_stream), RT_S, "emote event")[-1]["seq"]
        t1.close()
        t2 = connect(ctx, base, resume={chat_stream: s1, session_stream: e1}, session_id=sid)
        dup = t2.intent(sid, "emote", intent_id=iid, emote="wave")
        assert (dup["applied"], dup["duplicate"]) == (False, True)
        assert post_chat(p, f"session-{sid}", "dos").status_code == 201
        fresh = poll(lambda: t2.events(chat_stream), RT_S, "new chat event")
        assert [e["seq"] for e in fresh] == [s1 + 1]
        assert all(e["seq"] > e1 for e in t2.events(session_stream))
    friend = verified(base, mail)
    body = f"once-{uuid.uuid4().hex[:8]}"
    with ui(browser, p, "/lobby") as page:
        assert post_chat(p, "lobby", body).status_code == 201
        assert friend.http.post("/api/friends/requests", json={"display_name": p.name, "client_request_id": idempotency_key()}).status_code == 201
        log = page.get_by_role("log", name="Messages")
        see(page, lambda: expect(log.get_by_text(body)).to_have_count(1, timeout=SLICE_MS))
        accept = page.get_by_role("button", name=f"Accept {friend.name}")
        see(page, lambda: expect(accept).to_have_count(1, timeout=SLICE_MS))
        page.context.set_offline(True)
        advance(page, 3000)
        page.context.set_offline(False)
        advance(page, 3000)
        see(page, lambda: expect(log.get_by_text(body)).to_have_count(1, timeout=SLICE_MS))
        expect(accept).to_have_count(1)
        page.reload()
        see(page, lambda: expect(log.get_by_text(body)).to_have_count(1, timeout=SLICE_MS))
        expect(accept).to_have_count(1)


def test_character_counters(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"), "ja")
    with ui(browser, p, "/builder") as page:
        name = page.get_by_role("textbox", name="ヒーロー名")
        name.fill(EMOJI * (NAME_MAX + 1))
        see(page, lambda: expect(name).to_have_accessible_description(filled("<used>/20", used=NAME_MAX + 1),
                                                                      timeout=SLICE_MS))
        expect(name).to_have_value(EMOJI * (NAME_MAX + 1))
        limit = page.get_by_text("ヒーロー名は3〜20文字にしてください。").first
        appears(page, limit)
        page.get_by_role("button", name="スロットに保存").click()
        expect(page.get_by_role("dialog", name="ヒーローを保存")).to_have_count(0)
        appears(page, limit)
        name.fill(EMOJI * NAME_MAX)
        see(page, lambda: expect(name).to_have_accessible_description(filled("<used>/20", used=NAME_MAX),
                                                                      timeout=SLICE_MS))
        page.goto(p.base + "/lobby")
        message = page.get_by_role("textbox", name="メッセージ")
        appears(page, message)
        message.fill(EMOJI * (CHAT_MAX + 1))
        see(page, lambda: expect(message).to_have_accessible_description(filled("<used>/280", used=CHAT_MAX + 1),
                                                                         timeout=SLICE_MS))
        message.press("Enter")
        shows(page, page.get_by_role("status", name="チャットの状態"), "メッセージは1〜280文字にしてください。")
        expect(message).to_have_value(EMOJI * (CHAT_MAX + 1))
    assert not [m for m in channel_messages(p, "lobby") if m["author"] and m["author"]["account_id"] == p.id]


def test_numeric_seq_and_after_seq(browser: Browser, app_url: str) -> None:
    p = signup(app_url.rstrip("/"))
    sid = start_solo(p)["session_id"]
    channel = f"session-{sid}"
    seqs: list[int] = []
    for i in range(11):
        cid, body = idempotency_key(), f"n{i}"
        r = poll(lambda: (lambda res: res if res.status_code == 201 else None)(post_chat(p, channel, body, cid)),
                 CHAT_WINDOW_S + SLACK_S * 4, "chat accepted")
        seq = r.json()["message"]["seq"]
        assert type(seq) is int
        seqs.append(seq)
    boundary = next(s for s in seqs if len(str(s + 1)) > len(str(s)) and s + 1 in seqs)
    page = p.http.get(f"/api/chat/{channel}/messages", params={"after_seq": boundary}).json()["messages"]
    got = [m["seq"] for m in page]
    assert got == sorted(got) and boundary + 1 in got and all(s > boundary for s in got)
    for bad in ("abc", "-1", "1.5", ""):
        r = p.http.get(f"/api/chat/{channel}/messages", params={"after_seq": bad})
        assert r.status_code == 422 and "after_seq" in r.json()["error"]["fields"], bad
    with account_ctx(browser, p) as ctx:
        tab = connect(ctx, p.base, resume={f"chat:{channel}": boundary}, session_id=sid)
        events = poll(lambda: tab.events(f"chat:{channel}"), RT_S, "resumed chat events")
        assert all(type(e["seq"]) is int and e["seq"] > boundary for e in events)
        assert boundary + 1 in [e["seq"] for e in events]
        joined = next(m for m in tab.pull() if m.get("type") == "joined")
        assert type(joined["tick"]) is int and type(tab.intent(sid, "emote", emote="bow")["tick"]) is int
    assert type(forge(p, [stroke([(0, 0), (0, 1)])])["number"]) is int
    r = p.http.post("/api/weapons/preview", json={"strokes": [], "drawing_revision": "3"})
    assert r.status_code == 422 and "drawing_revision" in r.json()["error"]["fields"]


@pytest.mark.parametrize("locale", ["en", "ja", "es"], ids=["en", "ja", "es"])
def test_wf_language_roundtrip_verification_email(app_url: str, mail: Any, locale: str) -> None:
    base = app_url.rstrip("/")
    other = {"en": "ja", "ja": "es", "es": "en"}[locale]
    p = signup(base, locale, headers={"Accept-Language": other, "Cookie": f"lw_locale={other}"})
    subjects = {"en": "Confirm your Linewright account", "ja": "Linewright アカウントの確認",
                "es": "Confirma tu cuenta de Linewright"}
    messages = mails_to(mail, p.email, 1)
    assert len([m for m in mail.messages(0, 1.5) if p.email in mail_addresses(m.get("To"))]) == 1
    message = messages[0]
    assert message["Subject"] == subjects[locale]
    assert mail_addresses(message.get("From")) == [mail_from_address()]
    html, plain = message.get("HTML") or "", mail_text(message) or ""
    assert HTML_LANG_RE.search(html).group(1) == locale
    public = os.environ.get("APP_PUBLIC_URL", base).rstrip("/")
    text_links = re.findall(r"https?://[^\s<>\"']+", plain)
    html_links = re.findall(r"href=[\"']([^\"']+)", html)
    assert len(text_links) == 1 and len(html_links) == 1 and text_links[0] == html_links[0].replace("&amp;", "&")
    assert re.fullmatch(re.escape(public) + r"/verify\?token=[A-Za-z0-9._~%-]+", text_links[0])
    if locale == "ja":
        assert re.search(r"[\u3040-\u30ff\u4e00-\u9fff]", plain)


def test_wf_language_roundtrip_password_reset(browser: Browser, app_url: str, mail: Any) -> None:
    base = app_url.rstrip("/")
    p = signup(base, "es")
    with ui(browser, None, "/", base=base) as page:
        assert page.request.put(base + "/api/locale", data={"locale": "ja"}).status == 204
        page.goto(base + "/forgot-password")
        page.get_by_role("textbox", name="メールアドレス").fill(p.email)
        page.get_by_role("button", name="再設定リンクを送信").click()
        shows(page, page.get_by_role("status", name="お知らせ"), "そのメールアドレスのアカウントがあれば、再設定リンクを送信しました。")
        message = poll(lambda: next((m for m in mails_to(mail, p.email, 1) if any(k == "reset-password" for k, _ in message_tokens(m))), None),
                       MAIL_S, "reset mail")
        assert message["Subject"] == "Restablece tu contraseña de Linewright"
        assert HTML_LANG_RE.search(message.get("HTML") or "").group(1) == "es"
        token = next(t for k, t in message_tokens(message) if k == "reset-password")
        page.goto(f"{base}/reset-password?token={token}")
        page.reload()
        assert page.url.endswith(f"/reset-password?token={token}")
        page.get_by_role("textbox", name="パスワード").fill(NEW_PASSWORD)
        page.get_by_role("button", name="新しいパスワードを設定").click()
        shows(page, page.get_by_role("status", name="お知らせ"), "パスワードを変更しました。新しいパスワードでサインインしてください。")
    assert p.http.get("/api/me").status_code == 401
    anon = httpx.Client(base_url=base, timeout=HTTP_S)
    r = anon.post("/api/auth/signin", json={"email": p.email, "password": PASSWORD})
    assert r.status_code == 401 and r.json()["error"]["code"] == "invalid_credentials"
    assert anon.post("/api/auth/signin", json={"email": p.email, "password": NEW_PASSWORD}).status_code == 200


def test_wf_language_roundtrip_reset_mail_down(browser: Browser, app_url: str, mail: Any) -> None:
    down = env_url("APP_MAIL_DOWN_URL")
    p = signup(app_url.rstrip("/"))
    anon = httpx.Client(base_url=down, timeout=HTTP_S)
    for email in (p.email, identity()[0]):
        r = anon.post("/api/auth/password-reset", json={"email": email})
        assert r.status_code == 503 and r.json()["error"]["code"] == "mail_unavailable"
    with ui(browser, None, "/forgot-password", base=down) as page:
        page.get_by_role("textbox", name="Email").fill(p.email)
        page.get_by_role("button", name="Send reset link").click()
        appears(page, page.get_by_role("alert").filter(has_text="We couldn't send the reset email. Try again in a few minutes."))
    assert len(mails_to(mail, p.email, 1)) == 1


def test_page_shell_locale(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    cases = [("/signin", "es", "es", titled("Iniciar sesión"), "Idioma", "Español"),
             ("/signup", "ja-JP", "ja", titled("アカウント作成"), "言語", "日本語"),
             ("/forgot-password", "en-US", "en", titled("Forgot password"), "Language", "English"),
             ("/", "es", "es", "Linewright", "Idioma", "Español"),
             ("/nowhere-" + uuid.uuid4().hex[:6], "ja", "ja", titled("ページが見つかりません"), "言語", "日本語")]
    for path, header, lang, title, combo, label in cases:
        ctx = browser.new_context(java_script_enabled=False, extra_http_headers={"Accept-Language": header})
        page = ctx.new_page()
        page.goto(base + path)
        assert lang_of(page) == lang and page.title() == title, path
        assert label in combo_text(page.get_by_role("combobox", name=combo))
        ctx.close()
    p = signup(base, "es")
    ctx = browser.new_context(java_script_enabled=False, extra_http_headers={"Accept-Language": "ja"})
    assert ctx.request.post(base + "/api/auth/signin", data={"email": p.email, "password": p.password}).status == 200
    page = ctx.new_page()
    for path, title in (("/hangar", "Refugio"), ("/builder", "Taller de héroes"), ("/forge", "Forja de armas"),
                        ("/armoury", "Armería"), ("/models", "Mis modelos"), ("/stories", "Historias"), ("/lobby", "Sala")):
        page.goto(base + path)
        assert lang_of(page) == "es" and page.title() == f"{title} · Linewright", path
    ctx.close()
    r = httpx.put(base + "/api/locale", json={"locale": "fr"}, timeout=HTTP_S)
    assert r.status_code == 422 and "locale" in r.json()["error"]["fields"]
    r = httpx.put(base + "/api/locale", json={"locale": "ja"}, timeout=HTTP_S)
    assert r.status_code == 204
    assert r.cookies.get("lw_locale") == "ja"
    with ui(browser, None, "/signin", base=base) as page:
        select(page.get_by_role("combobox", name="Language"), "Español")
        see(page, lambda: assert_(lang_of(page) == "es"))
        appears(page, page.get_by_role("combobox", name="Idioma"))
        page.reload()
        assert lang_of(page) == "es"
    with ui(browser, p, "/hangar") as page:
        select(page.get_by_role("combobox", name="Idioma"), "日本語")
        poll(lambda: p.http.get("/api/me").json()["account"]["locale"] == "ja", UI_S, "account locale saved")


def test_locale_resolution_order(app_url: str) -> None:
    base = app_url.rstrip("/")

    def lang(path: str = "/signin", **headers: str) -> str:
        r = httpx.get(base + path, headers=headers, timeout=HTTP_S)
        return HTML_LANG_RE.search(r.text).group(1)

    assert lang(**{"Accept-Language": "es-MX,es;q=0.9"}) == "es"
    assert lang(**{"Accept-Language": "fr-FR,ja;q=0.5,en;q=0.4"}) == "ja"
    assert lang(**{"Accept-Language": "en;q=0,es;q=0.3"}) == "es"
    assert lang(**{"Accept-Language": "ja;q=0.5,es;q=0.5"}) == "ja"
    assert lang(**{"Accept-Language": "ES-es"}) == "es"
    assert lang(**{"Accept-Language": "fr-FR"}) == "en"
    assert lang() == "en"
    assert lang(**{"Accept-Language": "es", "Cookie": "lw_locale=ja"}) == "ja"
    assert lang(**{"Accept-Language": "es", "Cookie": "lw_locale=xx"}) == "es"
    r = httpx.post(base + "/api/auth/signin", json={"email": identity()[0], "password": PASSWORD},
                   headers={"Accept-Language": "ja"}, timeout=HTTP_S)
    assert r.json()["error"]["message"] == "メールアドレスまたはパスワードが正しくありません。"
    p = signup(base, "es")
    client = httpx.Client(base_url=base, timeout=HTTP_S, cookies={"lw_locale": "ja"})
    r = client.post("/api/auth/signin", json={"email": p.email, "password": p.password})
    assert r.cookies.get("lw_locale") == "es"
    client.cookies.set("lw_locale", "ja")
    page = client.get("/hangar")
    assert HTML_LANG_RE.search(page.text).group(1) == "es"
    client.cookies.set("lw_locale", "es")
    r = client.post("/api/auth/signout")
    assert r.status_code == 204 and "lw_locale" not in r.cookies
    assert HTML_LANG_RE.search(client.get("/signin").text).group(1) == "es"


def test_account_scoped_records(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    a, b = signup(base), signup(base)
    hero = equipped_hero(a)
    weapon = forge(a, [stroke([(0, 0), (0, 1)])])
    model = judged_upload(a, build_glb())
    sid = start_solo(a)["session_id"]
    for method, path in (("GET", f"/api/characters/{hero['id']}"), ("POST", f"/api/characters/{hero['id']}/equip"),
                         ("DELETE", f"/api/characters/{hero['id']}"), ("GET", f"/api/weapons/{weapon['id']}"),
                         ("DELETE", f"/api/weapons/{weapon['id']}"), ("GET", f"/api/models/{model['id']}"),
                         ("GET", f"/api/models/{model['id']}/file"), ("GET", f"/api/models/{model['id']}/thumbnail"),
                         ("DELETE", f"/api/models/{model['id']}"), ("GET", f"/api/sessions/{sid}")):
        r = b.http.request(method, path)
        assert r.status_code == 404 and r.json()["error"]["code"] == "not_found", path
    mine = equipped_hero(b)
    for change in ({"weapon_id": weapon["id"]}, {"model_id": model["id"]}):
        r = b.http.put(slot_path(2), json=hero_body(mine, revision=None, **change))
        assert r.status_code == 404, change
    r = b.http.post("/api/weapons", json={"character_id": hero["id"], "strokes": [stroke([(0, 0), (0, 1)])]})
    assert r.status_code == 404
    assert a.http.get(f"/api/characters/{hero['id']}").status_code == 200
    assert a.http.get(f"/api/weapons/{weapon['id']}").status_code == 200
    assert a.http.get(f"/api/models/{model['id']}").json()["model"]["status"] == "accepted"
    assert b.http.get("/api/weapons").json()["weapons"] == []


@pytest.mark.parametrize("mode", ["full motion", "reduced motion", "without WebGL"], ids=["full_motion", "reduced_motion", "no_webgl"])
def test_scene_motion_and_fallbacks(browser: Browser, app_url: str, mode: str) -> None:
    p = signup(app_url.rstrip("/"))
    reduced, still = mode == "reduced motion", mode == "without WebGL"
    with ui(browser, p, "/hangar", reduced_motion="reduce" if reduced else MOTION_DEFAULT, no_webgl=still) as page:
        preview = page.get_by_role("application", name="Hero preview")
        appears(page, preview)
        if still:
            expect(preview).to_have_attribute("data-renderer", "still")
            appears(page, page.get_by_text("3D view unavailable on this device."))
            preview.focus()
            page.keyboard.press("ArrowRight")
            attr(page, preview, "data-orbit", str(ORBIT_STEP))
        elif reduced:
            expect(preview).to_have_attribute("data-turntable", "off")
            orbit = preview.get_attribute("data-orbit")
            advance(page, 10000)
            assert preview.get_attribute("data-orbit") == orbit
        else:
            expect(preview).to_have_attribute("data-renderer", "webgl")
            attr(page, preview, "data-turntable", "on")
            total, last = 0, int(preview.get_attribute("data-orbit"))
            for _ in range(10):
                advance(page, 1000)
                now = int(preview.get_attribute("data-orbit"))
                step = (now - last) % 360
                assert step > 0
                total, last = total + step, now
            assert 10 * 360 / TURN_MAX_S - 1 <= total <= 10 * 360 / TURN_MIN_S + 1
        if not still:
            box = preview.bounding_box()
            cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
            before = preview.get_attribute("data-orbit")
            page.mouse.move(cx, cy)
            page.mouse.down()
            for i in range(1, 6):
                page.mouse.move(cx + 20 * i, cy)
                advance(page, 50)
            page.mouse.up()
            advance(page, 50)
            assert preview.get_attribute("data-orbit") != before
            expect(preview).to_have_attribute("data-turntable", "off")
            if not reduced:
                advance(page, TURN_RESUME_S * 1000 - 500)
                expect(preview).to_have_attribute("data-turntable", "off")
                advance(page, 1000)
                attr(page, preview, "data-turntable", "on")
        page.goto(p.base + "/builder")
        preview = page.get_by_role("application", name="Hero preview")
        appears(page, preview)
        if still:
            appears(page, page.get_by_text("3D view unavailable on this device."))
        else:
            page.get_by_role("radiogroup", name="Torso").get_by_role("radio", checked=True).click()
            moving, t, seen_focus = [], 0, False
            while t <= CAMERA_MAX_MS + 200:
                state = preview.evaluate("e => [e.getAttribute('data-camera-moving'), e.getAttribute('data-camera-focus')]")
                moving.append((t, state[0]))
                seen_focus = seen_focus or state[1] == "torso"
                advance(page, 25)
                t += 25
            assert seen_focus
            on = [t for t, m in moving if m == "true"]
            if reduced:
                assert on == []
            else:
                assert on and CAMERA_MIN_MS - 25 <= on[-1] - on[0] + 25 <= CAMERA_MAX_MS + 25
        sid = start_solo(p)["session_id"]
        page.goto(f"{p.base}/play/{sid}")
        view = page.get_by_role("application", name="Game view")
        appears(page, view)
        if still:
            expect(view).to_have_attribute("data-renderer", "still")
            appears(page, page.get_by_role("list", name="Session members"))
        else:
            start_state = view.get_attribute("data-flythrough")
            assert start_state == ("still" if reduced else "playing")
            t = 0
            while view.get_attribute("data-flythrough") != "done" and t <= FLYTHROUGH_MAX_MS + 500:
                advance(page, 100)
                t += 100
            if reduced:
                assert t <= STILL_MAX_MS + 100
            else:
                assert FLYTHROUGH_MIN_MS - 100 <= t <= FLYTHROUGH_MAX_MS + 100


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    r = httpx.get(base + "/api/health", timeout=HTTP_S)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers.get("x-content-type-options") == "nosniff"
    evil = "http://evil.example"
    r = httpx.put(base + "/api/locale", json={"locale": "en"}, headers={"Origin": evil}, timeout=HTTP_S)
    assert r.status_code == 403 and r.json()["error"]["code"] == "cross_origin"
    assert not [k for k in r.headers if k.lower().startswith(CORS_PREFIX)]
    r = httpx.options(base + "/api/locale", headers={"Origin": evil}, timeout=HTTP_S)
    assert not [k for k in r.headers if k.lower().startswith(CORS_PREFIX)]
    assert httpx.put(base + "/api/locale", json={"locale": "en"}, timeout=HTTP_S).status_code == 204
    head, tail = b'{"locale":"en","pad":"', b'"}'
    exact = head + b"x" * (JSON_LIMIT - len(head) - len(tail)) + tail
    assert len(exact) == JSON_LIMIT
    ok = httpx.put(base + "/api/locale", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_S)
    assert ok.status_code != 413
    over = head + b"x" * (JSON_LIMIT + 1 - len(head) - len(tail)) + tail
    r = httpx.put(base + "/api/locale", content=over, headers={"Content-Type": "application/json"}, timeout=HTTP_S)
    assert r.status_code == 413 and r.json()["error"]["code"] == "body_too_large"
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/src/server.ts"):
        assert httpx.get(base + path, timeout=HTTP_S).status_code == 404, path
    p = signup(base)
    for client in (httpx.Client(base_url=base, timeout=HTTP_S), p.http):
        r = client.get("/nowhere-" + uuid.uuid4().hex[:6])
        assert r.status_code == 404 and HTML_LANG_RE.search(r.text)
    r = httpx.get(base + "/hangar", timeout=HTTP_S, follow_redirects=False)
    assert r.status_code == 303 and r.headers["location"].endswith("/signin")
    home = httpx.get(base + "/", timeout=HTTP_S).text
    secrets = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID")]
    db = urllib.parse.urlparse(os.environ.get("DATABASE_URL", ""))
    secrets.append(db.password or "")
    for src in re.findall(r"(?:src|href)=[\"'](/[^\"']+\.(?:js|css|html))", home):
        body = httpx.get(base + src, timeout=HTTP_S).text
        for secret in filter(None, secrets):
            assert secret not in body, src


def shipped_packages() -> dict[tuple[str, str], dict[str, Any]]:
    cwd = "/app" if Path("/app/node_modules").exists() else deployed_dir()
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=cwd,
                         capture_output=True, text=True, timeout=NPM_S)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], dict[str, Any]] = {}

    def walk(deps: dict[str, Any] | None) -> None:
        for name, info in (deps or {}).items():
            if not isinstance(info, dict) or not info.get("version") or info.get("missing"):
                continue
            if (name, info["version"]) in found:
                continue
            found[(name, info["version"])] = info
            walk(info.get("dependencies"))
    walk(tree.get("dependencies"))
    assert found, out.stderr[-2000:]
    return found


def licence_ok(expr: str) -> bool:
    tokens = [t for t in re.findall(r"[A-Za-z0-9.+-]+", expr) if t not in ("OR", "AND", "WITH")]
    return any(t in ALLOWED_LICENCES for t in tokens) if " OR " in expr else bool(tokens) and all(t in ALLOWED_LICENCES for t in tokens)


def notices() -> str:
    path = Path("/app/THIRD_PARTY_NOTICES.md")
    assert path.exists()
    return path.read_text()


def test_if_run_manifest(app_url: str) -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(v, str) and v for v in manifest.values())
    assert httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_S).status_code == 200


def test_if_third_party_notices() -> None:
    text = notices()
    missing = sorted({name for name, _ in shipped_packages() if name not in text})
    assert missing == []
    for font in ("Fredoka", "Nunito", "Noto Sans JP"):
        assert font in text


def test_if_licences_allowed() -> None:
    bad = []
    for (name, version), info in shipped_packages().items():
        licence = info.get("license")
        if licence is None and info.get("path"):
            licence = json.loads((Path(info["path"]) / "package.json").read_text()).get("license")
        if isinstance(licence, dict):
            licence = licence.get("type")
        if not licence or not licence_ok(str(licence)):
            bad.append(f"{name}@{version}: {licence}")
    assert bad == []


def test_if_only_postgres_and_minio() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    names = {k.rsplit("node_modules/", 1)[-1] for k in lock.get("packages", {}) if k}
    banned = {"sqlite3", "better-sqlite3", "sqlite", "@libsql/client", "redis", "ioredis", "lowdb", "nedb",
              "@seald-io/nedb", "level", "leveldown", "classic-level", "pouchdb", "lokijs", "node-persist"}
    assert names & banned == set()
    for cmd in Path("/proc").glob("[0-9]*/cmdline"):
        with contextlib.suppress(OSError):
            assert b"redis-server" not in cmd.read_bytes()


def test_if_assets_and_icons() -> None:
    text = notices()
    for path in Path("/app").rglob("*"):
        if any(part in ("node_modules", ".git", "dist", "build") for part in path.parts):
            continue
        if path.suffix.lower() in (".glb", ".gltf", ".fbx", ".obj"):
            assert path.name in text and "CC0" in text, path
    assert any(re.search(r"(?i)icon", line) and re.search(r"\b(MIT|ISC)\b", line) for line in text.splitlines())


def test_if_lockfile_used() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    pkg = json.loads(Path("/app/package.json").read_text())
    for name in {**pkg.get("dependencies", {}), **pkg.get("devDependencies", {})}:
        assert f"node_modules/{name}" in lock["packages"], name
    assert re.search(r"\bnpm (ci|install|i)\b", json.loads(Path("/app/run.json").read_text())["install"])


def test_if_service_config_unchanged() -> None:
    specs = [":(glob)**/docker-compose*.y*ml", ":(glob)**/compose*.y*ml"]
    if Path("/app/.git").exists():
        log = subprocess.run(["git", "-C", "/app", "log", "--format=%H", "--diff-filter=MDR", "--", *specs],
                             capture_output=True, text=True)
        status = subprocess.run(["git", "-C", "/app", "status", "--porcelain", "--", *specs], capture_output=True, text=True)
        assert log.stdout.strip() == "" and status.stdout.strip() == ""
    for path in list(Path("/app").glob("**/docker-compose*.y*ml")) + list(Path("/app").glob("**/compose*.y*ml")):
        if "node_modules" in path.parts:
            continue
        body = path.read_text()
        assert all(s in body for s in ("postgres", "minio", "mailpit")), path


def test_if_pinned_validator() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    entry = lock["packages"].get("node_modules/gltf-validator")
    assert entry and entry["version"] == VALIDATOR_VERSION and not entry.get("dev")
