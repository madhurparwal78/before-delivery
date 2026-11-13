from __future__ import annotations

import hashlib
import json
import math
import os
import re
import secrets
import socket
import subprocess
import tempfile
import time
from contextlib import ExitStack, contextmanager
from datetime import datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    advance,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
)

TOL = 0.001
SOLVE_TOL = 0.0001
DESK = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
PHONE_TALL = (390, 844)
JSON_LIMIT = 1000000
ZOOM_ALL_PAD_PX = 24
FIND_MARGIN_PX = 48
SHEET_MAX_SHARE = 0.6
TAP_TARGET_PX = 44
LONG_PRESS_MS = 500
ZOOM_ALL_MS = 320
COMPARE_SWIPE_MS = 120
SHEET_PIN_MS = 200
TOAST_ENTER_MS = 120
SWIPE_START = 50
SWIPE_MAX = 100
PAGE_STEP = 10
PROGRESS_STEPS = {0, 20, 40, 60, 80, 100}
FAILED_AT = 80
DONE = 100
MIN_ZOOM, MAX_ZOOM = 0.05, 50
ARRAY_TURN = 360
PRESENCE_MS = int(os.environ.get("PLOT_PRESENCE_TIMEOUT_MS", "3000"))
LINK_TTL_MS = int(os.environ.get("PLOT_LINK_TTL_MS", "3600000"))
REVIEW_TTL_MS = int(os.environ.get("PLOT_REVIEW_TTL_MS", "3600000"))
OP_WINDOW = int(os.environ.get("PLOT_OP_WINDOW", "1000"))
DOM_CEILING = int(os.environ.get("PLOT_DOM_CEILING", "500"))
UNDERLAY_MAX = int(os.environ.get("PLOT_UNDERLAY_MAX_BYTES", "200000"))
QUOTA = int(os.environ.get("PLOT_DRAWING_QUOTA_BYTES", "500000"))
TEXT_MAX = int(os.environ.get("PLOT_TEXT_MAX_BYTES", "1000000"))
EXPORT_STEP_MS = int(os.environ.get("PLOT_EXPORT_STEP_MS", "200"))
LOGIN_RATE = int(os.environ.get("PLOT_LOGIN_RATE", "1000"))
PNG_SIG = b"\x89PNG\r\n\x1a\n"
JPEG_SOI = b"\xff\xd8\xff\xe0"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
PANELS = ["Entities", "Layers", "Properties", "Parameters", "Xrefs", "Versions", "Issues", "Markups"]
PHONE_TABS = ["Issues", "Markups", "Versions"]
EVIL = "http://evil.example"

HTTP_TIMEOUT = 30
WAIT_S = 30
STEP_MS = 100
BOOT_S = 180
POINTER_TOL = 0.1
PAN_TOL_PX = 1
LARGE_LINES = 1500
PASSWORD = "drafting-pass-1"
BLOCK_NAME = "Door"
ATTR_TAG = "MARK"
QUESTION = "Which kerb?"
SOURCE_SHEET = "Source"
VIEW_Y = 450
CORS_PREFIX = "access-control-"


def viewport(page: Page, scale: str) -> Locator:
    return drawing(page).locator(f'[data-scale="{scale}"]')


def in_viewport(vp: Locator, handle: str) -> Locator:
    return vp.locator(f'[data-entity-id="{handle}"]')


def dimension_text(vp: Locator) -> Locator:
    return vp.locator("[data-text-height-mm]")


def xref_entities(page: Page, name: str) -> Locator:
    prefixed = f'[data-entity-id^="{name}|"]'
    return drawing(page).locator(prefixed)


def grip_at(page: Page, kind: str, x: int, y: int) -> Locator:
    return drawing(page).locator(f'[data-grip="{kind}"][data-x="{x}"][data-y="{y}"]')


CROSSHAIR_SELECTOR = "[data-colour][data-x][data-y]:not([data-entity-id])"


ENTITY_ELEMENTS = "[data-entity-id]:not([data-grip])"


def crosshairs(page: Page) -> Locator:
    return drawing(page).locator(CROSSHAIR_SELECTOR)


def marked(page: Page, diff: str, handle: str | None = None) -> Locator:
    sel = f'[data-diff="{diff}"]' if handle is None else f'[data-entity-id="{handle}"][data-diff="{diff}"]'
    return drawing(page).locator(sel)


def uname(prefix: str = "u") -> str:
    return f"{prefix[:6]}_{secrets.token_hex(5)}"


def gid() -> str:
    return secrets.token_hex(8)


def seed(base: str, body: dict[str, Any]) -> dict[str, Any]:
    r = httpx.post(f"{base}/api/grading/seed", json=body, timeout=HTTP_TIMEOUT)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text[:500]}"
    return r.json()


def signed_in(base: str, username: str) -> httpx.Client:
    c = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    r = c.post("/api/grading/session", json={"username": username})
    assert r.status_code == 200, f"POST /api/grading/session answered {r.status_code}: {r.text[:300]}"
    return c


def by_key(value: Any, key: str) -> dict[str, dict[str, Any]]:
    if isinstance(value, dict):
        return value
    return {str(item.get(key)): item for item in value}


def by_handle(value: Any) -> dict[str, dict[str, Any]]:
    if isinstance(value, dict):
        return value
    return {str(item.get("handle") or item.get("id")): item for item in value}


def hnum(handle: str) -> int:
    return int(re.sub(r"\D", "", handle.split("|")[-1]) or 0)


def clock(base: str, ms: int) -> str:
    r = httpx.post(f"{base}/api/grading/clock", json={"advance_ms": ms}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200, f"POST /api/grading/clock answered {r.status_code}: {r.text[:300]}"
    return r.json()["now"]


def storage(base: str, down: bool) -> None:
    r = httpx.post(f"{base}/api/grading/storage", json={"down": down}, timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json().get("down") is down, f"grading storage answered {r.status_code}: {r.text}"


class World:
    def __init__(self, base: str, res: dict[str, Any], users: dict[str, str], names: dict[str, str]) -> None:
        self.base = base
        self.res = res
        self.users = users
        self.names = names
        self._clients: dict[str, httpx.Client] = {}

    def __getitem__(self, key: str) -> str:
        return self.users[key]

    @property
    def folder(self) -> str:
        return self.res["folders"]["f"]

    def client(self, key: str) -> httpx.Client:
        if key not in self._clients:
            self._clients[key] = signed_in(self.base, self.users[key])
        return self._clients[key]

    def did(self, key: str = "d") -> str:
        return self.res["drawings"][key]

    def sheet(self, key: str = "s") -> str:
        return self.res["sheets"][key]

    def version(self, sheet_key: str, number: int) -> str:
        return self.res["versions"][f"{sheet_key}:{number}"]

    def drawing(self, user: str, key: str = "d") -> dict[str, Any]:
        r = self.client(user).get(f"/api/drawings/{self.did(key)}")
        assert r.status_code == 200, f"GET /api/drawings/<id> answered {r.status_code}: {r.text[:300]}"
        return r.json()

    def ents(self, user: str, key: str = "d") -> dict[str, dict[str, Any]]:
        return by_handle(self.drawing(user, key)["entities"])

    def ops(self, user: str, ops: list[dict[str, Any]], key: str = "d", rev: int | None = None,
            command: str = "EDIT") -> httpx.Response:
        if rev is None:
            rev = self.drawing(user, key)["revision"]
        body = {"as": self.users[user], "base_revision": rev, "command": command, "group_id": gid(),
                "ops": [{"op_id": gid(), **op} for op in ops]}
        return httpx.post(f"{self.base}/api/grading/drawings/{self.did(key)}/ops", json=body, timeout=HTTP_TIMEOUT)

    def ok(self, user: str, ops: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
        r = self.ops(user, ops, **kw)
        assert r.status_code == 200, f"operation batch answered {r.status_code}: {r.text[:400]}"
        return r.json()

    def undo(self, user: str, key: str = "d", route: str = "undo") -> httpx.Response:
        return self.client(user).post(f"/api/drawings/{self.did(key)}/{route}", json={})


def build(base: str, people: dict[str, str | None], drawings: list[dict[str, Any]] = (),
          parent: dict[str, str | None] | None = None) -> World:
    keys = list(people) + [k for k in (parent or {}) if k not in people]
    users = {k: uname(k) for k in keys}
    folders = []
    if parent is not None:
        folders.append({"key": "p", "name": f"parent {gid()[:6]}", "parent": None,
                        "roles": {users[k]: r for k, r in parent.items() if r}})
    folders.append({"key": "f", "name": f"folder {gid()[:6]}", "parent": "p" if parent is not None else None,
                    "roles": {users[k]: r for k, r in people.items() if r}})
    ds = []
    for d in drawings:
        d = dict(d)
        d.setdefault("folder", "f")
        d.setdefault("name", f"{d['key']}_{secrets.token_hex(3)}")
        ds.append(d)
    res = seed(base, {"users": [{"username": u, "password": PASSWORD} for u in users.values()],
                      "folders": folders, "drawings": ds})
    return World(base, res, users, {d["key"]: d["name"] for d in ds})


def ln(h: str, x1: float, y1: float, x2: float, y2: float, layer: str = "0", **extra: Any) -> dict[str, Any]:
    return {"handle": h, "type": "line", "layer": layer, "x1": x1, "y1": y1, "x2": x2, "y2": y2, **extra}


def cir(h: str, cx: float, cy: float, r: float, layer: str = "0") -> dict[str, Any]:
    return {"handle": h, "type": "circle", "layer": layer, "cx": cx, "cy": cy, "r": r}


def arc(h: str, cx: float, cy: float, r: float, start: float, end: float, layer: str = "0") -> dict[str, Any]:
    return {"handle": h, "type": "arc", "layer": layer, "cx": cx, "cy": cy, "r": r, "start": start, "end": end}


def pl(h: str, points: list[list[float]], closed: bool, layer: str = "0") -> dict[str, Any]:
    return {"handle": h, "type": "pline", "layer": layer, "points": points, "closed": closed}


def ins(h: str, block: str, x: float, y: float, scale: float = 1, rotation: float = 0,
        attributes: dict[str, str] | None = None, layer: str = "0") -> dict[str, Any]:
    return {"handle": h, "type": "insert", "layer": layer, "block": block, "x": x, "y": y, "scale": scale,
            "rotation": rotation, "attributes": attributes or {}}


def dim(h: str, kind: str, refs: list[dict[str, Any]], tx: float, ty: float, layer: str = "0") -> dict[str, Any]:
    return {"handle": h, "type": "dimension", "layer": layer, "kind": kind, "style": "Standard", "refs": refs,
            "override": None, "text_x": tx, "text_y": ty}


def hat(h: str, sx: float, sy: float, layer: str = "0") -> dict[str, Any]:
    return {"handle": h, "type": "hatch", "layer": layer, "seed_x": sx, "seed_y": sy}


def layer(name: str, colour: str = "white", **flags: Any) -> dict[str, Any]:
    return {"name": name, "colour": colour, "linetype": "Continuous", "lineweight": 0.25,
            "on": flags.get("on", True), "frozen": flags.get("frozen", False), "locked": flags.get("locked", False)}


def add(entity: dict[str, Any]) -> dict[str, Any]:
    return {"type": "add", "entity": {k: v for k, v in entity.items() if k != "handle"}}


def near(a: Any, b: float, tol: float = TOL) -> bool:
    return a is not None and abs(float(a) - b) <= tol


def ends(e: dict[str, Any]) -> set[tuple[float, float]]:
    return {(round(float(e["x1"]), 3) + 0.0, round(float(e["y1"]), 3) + 0.0),
            (round(float(e["x2"]), 3) + 0.0, round(float(e["y2"]), 3) + 0.0)}


def new_handles(before: dict[str, Any], after: dict[str, Any]) -> list[str]:
    return sorted((h for h in after if h not in before), key=hnum)


def poll(fetch: Callable[[], Any], check: Callable[[Any], bool], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    value = None
    while time.monotonic() < deadline:
        value = fetch()
        if check(value):
            return value
    pytest.fail(f"{what}; last value: {str(value)[:400]}")


@contextmanager
def opened(browser: Browser, base: str, user: str | None, path: str, *, size: tuple[int, int] = DESK,
           reduced: str = "no-preference", view: tuple[str, float, float, float] | None = None) -> Iterator[Page]:
    with open_app(browser, base + "/api/health", reduced_motion=reduced) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if user:
            r = page.request.post(base + "/api/grading/session", data={"username": user})
            assert r.status == 200, f"grading session answered {r.status}"
        if view:
            r = page.request.post(base + "/api/grading/view",
                                  data={"drawing": view[0], "zoom": view[1], "pan_x": view[2], "pan_y": view[3]})
            assert r.status == 204, f"grading view answered {r.status}"
        page.goto(base + path)
        yield page


def eventually(page: Page, check: Callable[[], bool], what: str, seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if check():
                return
        except Exception as exc:
            last = exc
        advance(page, STEP_MS)
    pytest.fail(f"{what}" + (f"; last error: {last}" if last else ""))


def text(loc: Locator) -> str:
    if loc.count() == 0:
        return ""
    return " ".join((loc.first.text_content() or "").split())


def drawing(page: Page) -> Locator:
    return page.get_by_role("region", name="Drawing")


def entity(page: Page, handle: str) -> Locator:
    return drawing(page).locator(f'[data-entity-id="{handle}"]:not([data-grip])')


def cmd(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Command")


def prompt(page: Page) -> Locator:
    return page.get_by_role("status", name="Command prompt")


def announce(page: Page) -> Locator:
    return page.get_by_role("status", name="Drawing announcements")


def notices(page: Page) -> Locator:
    return page.get_by_role("status", name="Notices")


def attr(loc: Locator, name: str) -> str | None:
    return loc.first.get_attribute(name) if loc.count() else None


def focused(loc: Locator) -> bool:
    return loc.count() > 0 and loc.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)")


def ready(page: Page, revision: int | None = None) -> None:
    d = drawing(page)
    eventually(page, lambda: d.count() == 1 and attr(d, "data-pending-ops") == "0" and
               (revision is None or int(attr(d, "data-revision") or -1) >= revision),
               f"region Drawing settles with data-pending-ops 0 at revision {revision}")


def rev(page: Page) -> int:
    return int(attr(drawing(page), "data-revision") or 0)


def run(page: Page, *entries: str) -> None:
    box = cmd(page)
    for entry in entries:
        if entry:
            box.press_sequentially(entry)
        box.press("Enter")


def says(page: Page, loc: Locator, expected: str, exact: bool = True) -> None:
    eventually(page, lambda: (text(loc) == expected) if exact else (expected in text(loc)),
               f"expected {'text' if exact else 'text containing'} {expected!r}")


def prompt_is(page: Page, expected: str) -> None:
    says(page, prompt(page), expected)


def committed(page: Page, before: int) -> None:
    ready(page, before + 1)


def screen(page: Page, x: float, y: float) -> tuple[float, float]:
    d = drawing(page)
    box = d.bounding_box()
    z = float(attr(d, "data-zoom"))
    return box["x"] + x * z + float(attr(d, "data-pan-x")), box["y"] - y * z + float(attr(d, "data-pan-y"))


def pane_point(page: Page, sx: float, sy: float) -> tuple[float, float]:
    box = drawing(page).bounding_box()
    return box["x"] + sx, box["y"] + sy


def aid(page: Page, name: str, on: bool) -> None:
    b = page.get_by_role("group", name="Drafting aids").get_by_role("button", name=name)
    if (b.get_attribute("aria-pressed") == "true") != on:
        b.click()
    eventually(page, lambda: (b.get_attribute("aria-pressed") == "true") == on, f"{name} aria-pressed {on}")


def selected(page: Page) -> list[str]:
    return [h for h in drawing(page).locator('[aria-selected="true"][data-entity-id]').evaluate_all(
        "els => els.map(e => e.getAttribute('data-entity-id'))")]


def drag(page: Page, a: tuple[float, float], b: tuple[float, float]) -> None:
    page.mouse.move(*a)
    page.mouse.down()
    page.mouse.move((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, steps=4)
    page.mouse.move(*b, steps=4)
    page.mouse.up()


def view_values(page: Page) -> tuple[float, float, float]:
    d = drawing(page)
    return float(attr(d, "data-zoom")), float(attr(d, "data-pan-x")), float(attr(d, "data-pan-y"))


def panel(page: Page, name: str) -> Locator:
    return page.get_by_role("grid", name="Entities") if name == "Entities" else page.get_by_role("region", name=name)


def combo_text(loc: Locator) -> str:
    return loc.evaluate("e => (e.selectedOptions && e.selectedOptions.length) ? e.selectedOptions[0].textContent"
                        " : (e.value || e.textContent || '')").strip()


def swipe_pct(slider: Locator) -> int:
    value = slider.get_attribute("aria-valuetext") or ""
    m = re.match(r"(\d+)% newer version", value)
    return int(m.group(1)) if m else -1


def to_entities(page: Page) -> None:
    cmd(page).focus()
    page.keyboard.press("F6")
    page.keyboard.press("F6")
    eventually(page, lambda: focused(panel(page, "Entities")), "F6 twice reaches the Entities stop")


def select_via_list(page: Page, handle: str) -> None:
    to_entities(page)
    for _ in range(40):
        if selected(page) == [handle]:
            return
        page.keyboard.press("ArrowDown")
        advance(page, STEP_MS)
    pytest.fail(f"ArrowDown in grid Entities never selected {handle} alone; selected {selected(page)}")


RECORD_ANIMATIONS = """() => {
  if (window.__anims) return;
  window.__anims = [];
  const note = (a, opts) => {
    const rec = {id: (opts && typeof opts === 'object' && opts.id) || a.id || '', duration: 0};
    try { rec.duration = Number(a.effect.getTiming().duration) || 0; } catch (e) {}
    window.__anims.push(rec);
    queueMicrotask(() => { rec.id = a.id || rec.id;
      try { rec.duration = Number(a.effect.getTiming().duration) || 0; } catch (e) {} });
  };
  const animate = Element.prototype.animate;
  Element.prototype.animate = function (kf, opts) { const a = animate.call(this, kf, opts); note(a, opts); return a; };
  const play = Animation.prototype.play;
  Animation.prototype.play = function () { note(this, null); return play.call(this); };
}"""


def recorded(page: Page) -> list[dict[str, Any]]:
    return page.evaluate("() => window.__anims || []")


class Fingers:

    def __init__(self, page: Page) -> None:
        self.page = page
        self.cdp = session(page)
        self.cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})

    def send(self, kind: str, points: list[tuple[float, float]]) -> None:
        box = drawing(self.page).bounding_box()
        self.cdp.send("Input.dispatchTouchEvent", {"type": kind, "touchPoints": [
            {"x": box["x"] + x, "y": box["y"] + y, "id": i} for i, (x, y) in enumerate(points)]})

    def tap(self, x: float, y: float) -> None:
        self.send("touchStart", [(x, y)])
        advance(self.page, STEP_MS)
        self.send("touchEnd", [])


def png(size: int, salt: bytes = b"") -> bytes:
    body = PNG_SIG + salt
    return body + b"\0" * (size - len(body))


def upload(c: httpx.Client, did: str, body: bytes) -> httpx.Response:
    return c.post(f"/api/drawings/{did}/underlays", params={"x1": 0, "y1": 0, "x2": 10, "y2": 10}, content=body,
                  headers={"content-type": "application/octet-stream"})


def import_text(c: httpx.Client, did: str, body: bytes) -> httpx.Response:
    return c.post(f"/api/drawings/{did}/imports", content=body, headers={"content-type": "text/plain"})


def err(r: httpx.Response, status: int, code: str, message: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, f"expected {status} {code}, got {r.status_code}: {r.text[:400]}"
    body = r.json()
    assert body.get("error") == code, f"expected error {code}, got {body}"
    assert isinstance(body.get("message"), str), f"error body lacks a message sentence: {body}"
    if message is not None:
        assert body["message"] == message, f"expected message {message!r}, got {body['message']!r}"
    return body


def sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def run_manifest() -> dict[str, Any]:
    for p in (Path(DEPLOYED_APP) / "run.json", Path("/app/run.json")):
        if p.exists():
            return json.loads(p.read_text())
    pytest.fail("/app/run.json is missing")


def test_health_normal_and_outage(app_url: str) -> None:
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json().get("status") == "ok", r.text
    down = os.environ["APP_MINIO_DOWN_URL"]
    r = httpx.get(down + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json().get("status") == "unavailable", f"outage health: {r.status_code} {r.text}"
    try:
        storage(app_url, True)
        r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json().get("status") == "unavailable", "health must check MinIO afresh"
    finally:
        storage(app_url, False)
    r = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT)
    assert r.json().get("status") == "ok"


def test_grading_routes_when_on(app_url: str) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L7", 0, 0, 1, 1)],
                                        "generate": {"lines": 3, "spacing": 4}}])
    assert isinstance(w.res["folders"]["f"], str) and isinstance(w.did(), str)
    c = w.client("a")
    assert c.get("/api/me").json()["username"] == w["a"]
    dj = w.drawing("a")
    e = by_handle(dj["entities"])
    assert e["L7"]["type"] == "line" and near(e["L7"]["x2"], 1)
    gen = [v for h, v in e.items() if h != "L7"]
    assert len(gen) == 3, f"generate 3 lines gave {len(gen)}"
    starts = sorted((round(float(g["x1"]), 3), round(float(g["y1"]), 3)) for g in gen)
    assert starts == [(0.0, 0.0), (4.0, 0.0), (8.0, 0.0)], starts
    assert all(near(abs(float(g["x2"]) - float(g["x1"])), 1) and near(g["y1"], float(g["y2"])) for g in gen)
    highest = max(hnum(h) for h in e)
    assert hnum(str(dj["next_handle"])) == highest + 1
    r = c.post("/api/grading/view", json={"drawing": w.did(), "zoom": 2, "pan_x": 10, "pan_y": 20})
    assert r.status_code == 204
    step = 1000
    t1 = datetime.fromisoformat(clock(app_url, 0).replace("Z", "+00:00"))
    t2 = datetime.fromisoformat(clock(app_url, step).replace("Z", "+00:00"))
    assert (t2 - t1).total_seconds() * 1000 >= step, "grading clock did not move forward"
    before = dj["revision"]
    out = w.ok("a", [add(ln("x", 5, 5, 6, 6))], rev=before)
    assert out["revision"] == before + 1
    assert out["results"][0]["status"] == "applied" and out["results"][0]["handles"] == [f"L{highest + 1}"]
    assert f"L{highest + 1}" in w.ents("a")
    storage(app_url, True)
    storage(app_url, False)
    r = httpx.post(f"{app_url}/api/grading/seed", json={"users": [{"username": w["a"], "password": PASSWORD}]},
                   timeout=HTTP_TIMEOUT)
    err(r, 409, "username_taken")


@pytest.mark.timeout(600)
def test_grading_routes_off_answer_404(app_url: str) -> None:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        port = s.getsockname()[1]
    env = dict(os.environ)
    env.pop("PLOT_GRADING", None)
    env["APP_PUBLIC_PORT"] = str(port)
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    proc = subprocess.Popen(run_manifest()["serve"], shell=True, cwd=DEPLOYED_APP, env=env, stdout=log,
                            stderr=subprocess.STDOUT)
    base = f"http://127.0.0.1:{port}"
    try:
        deadline = time.monotonic() + BOOT_S
        while time.monotonic() < deadline:
            if proc.poll() is not None:
                pytest.fail(f"copy exited: {Path(log.name).read_text()[-2000:]}")
            try:
                if httpx.get(base + "/api/health", timeout=2).status_code == 200:
                    break
            except httpx.HTTPError:
                continue
        else:
            pytest.fail(f"copy never answered health: {Path(log.name).read_text()[-2000:]}")
        for path, body in [("/api/grading/seed", {}), ("/api/grading/session", {"username": "asha"}),
                           ("/api/grading/view", {"drawing": "x", "zoom": 1, "pan_x": 0, "pan_y": 0}),
                           ("/api/grading/clock", {"advance_ms": 1}), ("/api/grading/storage", {"down": True}),
                           ("/api/grading/drawings/x/ops", {"as": "asha", "base_revision": 0, "ops": []})]:
            err(httpx.post(base + path, json=body, timeout=HTTP_TIMEOUT), 404, "not_found")
    finally:
        proc.terminate()
        try:
            proc.wait(timeout=20)
        except subprocess.TimeoutExpired:
            proc.kill()


def test_accounts_register_login_and_forms(app_url: str, browser: Browser) -> None:
    user = uname("reg")
    c = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    r = c.post("/api/auth/register", json={"username": user, "password": PASSWORD})
    assert r.status_code == 201 and r.json()["username"] == user
    assert c.get("/api/me").json()["username"] == user, "register must sign the person in"
    assert c.post("/api/auth/logout").status_code == 204
    err(c.get("/api/me"), 401, "unauthenticated")
    r = c.post("/api/auth/login", json={"username": user, "password": PASSWORD})
    assert r.status_code == 200 and r.json()["username"] == user
    cookie = "; ".join(r.headers.get_list("set-cookie"))
    lowered = cookie.lower()
    assert "plot_session=" in cookie and "HttpOnly".lower() in lowered and "SameSite=Lax".lower() in lowered
    assert "Path=/" in cookie
    err(c.post("/api/auth/login", json={"username": user, "password": "wrong-pass-9"}), 401, "unauthenticated",
        "Wrong username or password.")
    err(httpx.post(app_url + "/api/auth/register", json={"username": user, "password": PASSWORD},
                   timeout=HTTP_TIMEOUT), 409, "username_taken")
    bad = err(httpx.post(app_url + "/api/auth/register", json={"username": "A!", "password": PASSWORD},
                         timeout=HTTP_TIMEOUT), 422, "invalid")
    assert isinstance(bad.get("fields"), dict)
    err(httpx.post(app_url + "/api/auth/register", json={"username": uname("s"), "password": "short"},
                   timeout=HTTP_TIMEOUT), 422, "invalid")
    with opened(browser, app_url, None, "/signin") as page:
        page.get_by_role("textbox", name="Username").fill(user)
        page.get_by_label("Password").fill("wrong-pass-9")
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: page.get_by_text("Wrong username or password.").count() > 0, "wrong-credentials copy")
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: page.request.get(app_url + "/api/me").status == 200, "UI sign-in sets the session")
        page.goto(app_url + "/register")
        page.get_by_role("textbox", name="Username").fill(uname("f"))
        page.get_by_label("Password").fill("short")
        page.get_by_role("button", name="Create account").click()
        eventually(page, lambda: page.get_by_text("Use at least 8 characters.").count() > 0, "short-password copy")
        page.get_by_role("textbox", name="Username").fill("A!")
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Create account").click()
        eventually(page, lambda: page.get_by_text("Use 3 to 24 lower-case letters, digits or underscores.").count() > 0,
                   "bad-username copy")
        page.get_by_role("textbox", name="Username").fill(user)
        page.get_by_role("button", name="Create account").click()
        eventually(page, lambda: page.get_by_text("That username is taken.").count() > 0, "username-taken copy")


@pytest.mark.timeout(900)
def test_login_rate_limit_per_username(app_url: str) -> None:
    from concurrent.futures import ThreadPoolExecutor
    w = build(app_url, {"a": "edit", "b": "edit"})

    def attempt(_: int) -> int:
        return httpx.post(app_url + "/api/auth/login", json={"username": w["a"], "password": "wrong-pass-9"},
                          timeout=HTTP_TIMEOUT).status_code

    with ThreadPoolExecutor(max_workers=16) as pool:
        codes = list(pool.map(attempt, range(LOGIN_RATE)))
    assert 429 not in codes, f"{codes.count(429)} of the first {LOGIN_RATE} attempts were limited"
    err(httpx.post(app_url + "/api/auth/login", json={"username": w["a"], "password": PASSWORD},
                   timeout=HTTP_TIMEOUT), 429, "rate_limited")
    err(httpx.post(app_url + "/api/auth/login", json={"username": w["b"], "password": "wrong-pass-9"},
                   timeout=HTTP_TIMEOUT), 401, "unauthenticated")


def test_error_shape_and_order(app_url: str) -> None:
    w = build(app_url, {"m": "manage", "e": "edit", "v": "view", "k": "markup", "o": None},
              [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    big = b'{"name":"' + b"x" * (JSON_LIMIT + 10) + b'"}'
    err(httpx.post(app_url + "/api/folders", content=big, timeout=HTTP_TIMEOUT,
                   headers={"content-type": "application/json", "origin": EVIL}), 413, "too_large")
    err(httpx.post(app_url + "/api/folders", json={"name": "x", "parent_id": None}, timeout=HTTP_TIMEOUT,
                   headers={"origin": EVIL}), 403, "cross_origin", "Requests from other sites are refused.")
    err(httpx.get(f"{app_url}/api/drawings/{w.did()}", timeout=HTTP_TIMEOUT), 401, "unauthenticated")
    err(w.client("o").put(f"/api/folders/{w.folder}/roles/{w['v']}", json={"role": "edit"}), 404, "not_found")
    err(w.client("v").put(f"/api/folders/{w.folder}/roles/{w['k']}", json={"role": "edit"}), 403, "forbidden")
    r = w.ops("v", [{"type": "add", "entity": {"type": "circle", "layer": "0", "cx": 0, "cy": 0, "r": -1}}])
    err(r, 403, "read_only")
    busy = w.ok("e", [add(ln("x", i, 1, i, 2)) for i in range(OP_WINDOW + 1)])
    assert busy["revision"] > OP_WINDOW
    r = w.ops("e", [{"type": "add", "entity": {"type": "circle", "layer": "0", "cx": 0, "cy": 0, "r": -1}}], rev=0)
    err(r, 409, "stale_base", "This change is too old. Reload the drawing and try again.")
    r = w.ops("e", [{"type": "add", "entity": {"type": "circle", "layer": "0", "cx": 0, "cy": 0, "r": -1}}])
    err(r, 422, "invalid")


def test_server_boundary(app_url: str) -> None:
    w = build(app_url, {"a": "manage"}, [{"key": "d"}])
    c = w.client("a")
    name = f"evil {gid()}"
    r = c.post("/api/folders", json={"name": name, "parent_id": None}, headers={"origin": EVIL})
    err(r, 403, "cross_origin", "Requests from other sites are refused.")
    assert name not in json.dumps(c.get("/api/folders").json()), "a refused write changed something"
    r = c.get("/api/folders", headers={"origin": EVIL})
    assert not [k for k in r.headers if k.lower().startswith(CORS_PREFIX)], "server sent a cross-origin header"
    u = urlparse(app_url)
    req = (f"GET /api/drawings/{w.did()}/live HTTP/1.1\r\nHost: {u.netloc}\r\nUpgrade: websocket\r\n"
           "Connection: Upgrade\r\nSec-WebSocket-Version: 13\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\n"
           f"Origin: {EVIL}\r\nCookie: plot_session={c.cookies.get('plot_session')}\r\n\r\n")
    with socket.create_connection((u.hostname, u.port or 80), timeout=HTTP_TIMEOUT) as s:
        s.sendall(req.encode())
        status = s.recv(4096).split(b" ")[1]
    assert status == b"403", f"live upgrade from another origin answered {status!r}"
    prefix = b'{"name":"'
    tail = b'","parent_id":null}'
    exact = prefix + b"x" * (JSON_LIMIT - len(prefix) - len(tail)) + tail
    assert len(exact) == JSON_LIMIT
    r = c.post("/api/folders", content=exact, headers={"content-type": "application/json"})
    assert r.status_code != 413, "a body exactly at the limit must be allowed"
    over = prefix + b"x" * (JSON_LIMIT - len(prefix) - len(tail) + 1) + tail
    err(c.post("/api/folders", content=over, headers={"content-type": "application/json"}), 413, "too_large")
    for path in ("/.env", "/package.json", "/src/server.ts"):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT)
        assert r.status_code == 404, f"{path} answered {r.status_code}"
    err(httpx.get(app_url + f"/api/nothing-{gid()}", timeout=HTTP_TIMEOUT), 404, "not_found")
    down = os.environ["APP_MINIO_DOWN_URL"]
    wd = build(down, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 1, 0)]}])
    assert "L1" in wd.ents("a")
    wd.ok("a", [add(ln("x", 2, 2, 3, 3))])
    assert httpx.get(down + "/", timeout=HTTP_TIMEOUT).status_code == 200


LIVE_JS = """([url, since]) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url);
  window.__live = {ws, msgs: []};
  ws.onmessage = (event) => window.__live.msgs.push(JSON.parse(event.data));
  ws.onopen = () => { ws.send(JSON.stringify({type: 'hello', since})); resolve(true); };
  ws.onerror = () => reject(new Error('live socket failed'));
})"""


def test_live_channel_sequence_and_replay(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    ctx = browser.new_context()
    try:
        ctx.request.post(app_url + "/api/grading/session", data={"username": w["a"]})
        page = ctx.new_page()
        page.goto(app_url + "/api/health")
        url = app_url.replace("http", "ws", 1) + f"/api/drawings/{w.did()}/live"
        page.evaluate(LIVE_JS, [url, 0])
        for i in range(3):
            w.ok("a", [add(ln("x", i, 0, i, 1))])
        page.wait_for_function("() => window.__live.msgs.filter(m => m.type === 'ops').length >= 3",
                               timeout=WAIT_S * 1000)
        first = page.evaluate("() => window.__live.msgs")
        seqs = [m["seq"] for m in first]
        assert seqs[0] == 1 and seqs == list(range(1, len(seqs) + 1)), f"seq numbers not consecutive: {seqs}"
        last = seqs[-1]
        page.evaluate("() => window.__live.ws.close()")
        for i in range(2):
            w.ok("a", [add(ln("x", i, 5, i, 6))])
        page.evaluate(LIVE_JS, [url, last])
        page.wait_for_function("() => window.__live.msgs.filter(m => m.type === 'ops').length >= 2",
                               timeout=WAIT_S * 1000)
        again = page.evaluate("() => window.__live.msgs")
        seqs = [m["seq"] for m in again]
        assert seqs[0] == last + 1 and seqs == list(range(last + 1, last + 1 + len(seqs))), seqs
        assert [m["type"] for m in again].count("ops") == 2, "replay must hold exactly the two missed groups"
    finally:
        ctx.close()


def test_live_page_applies_messages(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        sockets: list[str] = []
        page.on("websocket", lambda ws: sockets.append(ws.url))
        page.reload()
        ready(page)
        page.evaluate("() => { window.__stay = 1; }")
        out = w.ok("b", [add(ln("x", 0, 5, 10, 5))])
        handle = out["results"][0]["handles"][0]
        eventually(page, lambda: entity(page, handle).count() == 1 and rev(page) == out["revision"],
                   "the other person's line appears live")
        assert page.evaluate("() => window.__stay") == 1, "page reloaded instead of applying the message"
        assert len([u for u in sockets if "/live" in u]) == 1, f"expected one live socket, saw {sockets}"


VIEWPORTS = {"375x812": PHONE, "768x1024": TABLET, "1280x800": DESK}


@pytest.mark.parametrize("vp", ["375x812", "768x1024", "1280x800"], ids=["375x812", "768x1024", "1280x800"])
def test_breakpoint_layouts(app_url: str, browser: Browser, vp: str) -> None:
    w = build(app_url, {"a": "manage"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                          "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False,
                                                      "attributes": {}, "viewports": [], "publish": 1}]}])
    size = VIEWPORTS[vp]
    with opened(browser, app_url, w["a"], "/folders", size=size) as page:
        eventually(page, lambda: page.get_by_role("button", name="New drawing").count() > 0, "folders list loads")
        layout(page)
        page.goto(f"{app_url}/drawings/{w.did()}")
        ready(page)
        layout(page)
        d = drawing(page).bounding_box()
        if size == DESK:
            boxes = {n: panel(page, n).bounding_box() for n in PANELS}
            assert all(boxes.values()), f"every panel is open at start on a desk: {boxes}"
            assert boxes["Entities"]["x"] + boxes["Entities"]["width"] <= d["x"] + PAN_TOL_PX
            assert boxes["Layers"]["y"] > boxes["Entities"]["y"]
            right = PANELS[2:]
            assert all(boxes[n]["x"] >= d["x"] + d["width"] - PAN_TOL_PX for n in right)
            assert [boxes[n]["y"] for n in right] == sorted(boxes[n]["y"] for n in right)
            assert cmd(page).bounding_box()["y"] > d["y"]
            for n in PANELS:
                assert page.get_by_role("button", name=n, exact=True).first.get_attribute("aria-expanded") == "true"
            handles = [panel(page, n).element_handle() for n in PANELS]
            assert page.evaluate("els => els.every((e, i) => i === 0 || "
                                 "(els[i-1].compareDocumentPosition(e) & Node.DOCUMENT_POSITION_FOLLOWING))", handles)
        elif size == TABLET:
            tabs = page.get_by_role("tablist", name="Panels").get_by_role("tab")
            assert [" ".join(t.split()) for t in tabs.all_inner_texts()] == PANELS
            assert tabs.nth(0).get_attribute("aria-selected") == "true"
            assert page.get_by_role("tablist", name="Panels").bounding_box()["y"] >= d["y"] + d["height"] - PAN_TOL_PX
            header = page.get_by_role("button", name="Layers", exact=True)
            assert panel(page, "Entities").is_visible() and (not panel(page, "Layers").is_visible() or
                                                             (header.count() > 0 and header.first.get_attribute("aria-expanded") == "false"))
            assert d["width"] >= size[0] - TAP_TARGET_PX
        else:
            assert panel(page, "Entities").count() == 0 or not panel(page, "Entities").is_visible()
            assert not panel(page, "Issues").is_visible(), "no panel is open at start on a phone"
            page.get_by_role("button", name="Panels").click()
            sheet = page.get_by_role("dialog", name="Panel")
            eventually(page, lambda: sheet.is_visible(), "bottom sheet opens")
            box = sheet.bounding_box()
            assert box["y"] >= size[1] * (1 - SHEET_MAX_SHARE) - PAN_TOL_PX, f"sheet covers too much: {box}"
            tabs = sheet.get_by_role("tab")
            assert [" ".join(t.split()) for t in tabs.all_inner_texts()] == PHONE_TABS
            assert sheet.get_by_role("tab", name="Issues").get_attribute("aria-selected") == "true"
        page.goto(f"{app_url}/versions/{w.version('s', 1)}")
        eventually(page, lambda: drawing(page).count() == 1, "review screen loads")
        layout(page)


MOTION_CASES = {"motion": "no-preference", "reduce": "reduce"}


@pytest.mark.parametrize("mode", list(MOTION_CASES), ids=list(MOTION_CASES))
def test_motion_ids_and_reduced_motion(app_url: str, browser: Browser, mode: str) -> None:
    w = build(app_url, {"a": "edit", "m": "manage"},
              [{"key": "d", "entities": [ln("L1", 0, 0, 100, 50)],
                "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False, "attributes": {},
                            "viewports": [], "publish": 2}]}])
    reduced = MOTION_CASES[mode]
    want = {"zoom-all": ZOOM_ALL_MS, "compare-swipe": COMPARE_SWIPE_MS, "toast-enter": TOAST_ENTER_MS,
            "sheet-pin": SHEET_PIN_MS}
    seen: list[dict[str, Any]] = []
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}", reduced=reduced) as page:
        ready(page)
        page.evaluate(RECORD_ANIMATIONS)
        run(page, "ZA")
        box = drawing(page).bounding_box()
        z = min((box["width"] - 2 * ZOOM_ALL_PAD_PX) / 100, (box["height"] - 2 * ZOOM_ALL_PAD_PX) / 50)
        eventually(page, lambda: abs(view_values(page)[0] - z) <= TOL * max(1, z) * 10, f"ZOOMALL zoom {z}")
        zz, px, py = view_values(page)
        assert abs(px - (box["width"] / 2 - 50 * zz)) <= PAN_TOL_PX and abs(py - (box["height"] / 2 + 25 * zz)) <= PAN_TOL_PX
        assert focused(cmd(page))
        page.get_by_role("button", name="Compare").click()
        slider = page.get_by_role("slider", name="Compare swipe")
        eventually(page, lambda: slider.count() == 1, "compare view opens")
        slider.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: swipe_pct(slider) == SWIPE_START + 1, "slider moves by 1")
        assert slider.get_attribute("aria-valuetext") == f"{SWIPE_START + 1}% newer version"
        r = w.client("m").put(f"/api/folders/{w.folder}/roles/{w['a']}", json={"role": "markup"})
        assert r.status_code == 200
        says(page, notices(page), "Your role is now markup.", exact=False)
        seen += recorded(page)
    with opened(browser, app_url, w["m"], f"/versions/{w.version('s', 2)}", size=PHONE, reduced=reduced) as page:
        eventually(page, lambda: drawing(page).count() == 1, "review screen loads")
        page.evaluate(RECORD_ANIMATIONS)
        fingers = Fingers(page)
        fingers.tap(150, 300)
        dialog = page.get_by_role("dialog", name="New issue")
        eventually(page, lambda: dialog.is_visible(), "tap opens New issue")
        dialog.get_by_role("textbox", name="Issue title").fill("Kerb line")
        dialog.get_by_role("button", name="Pin issue").click()
        eventually(page, lambda: drawing(page).locator("[data-issue-pin]").count() >= 1, "pin placed")
        seen += recorded(page)
    if mode == "motion":
        for anim_id, ms in want.items():
            assert any(a["id"] == anim_id and abs(a["duration"] - ms) <= 1 for a in seen), \
                f"animation {anim_id} with {ms} ms not run; saw {seen}"
    else:
        running = [a for a in seen if a["id"] in want and a["duration"] > 0]
        assert not running, f"reduced motion still ran {running}"


FIRST_PROMPTS = {
    "LINE": ("L", "LINE: from point"),
    "PLINE": ("PL", "PLINE: from point"),
    "RECT": ("REC", "RECT: first corner"),
    "CIRCLE": ("C", "CIRCLE: centre"),
    "ARC": ("A", "ARC: centre"),
    "MOVE": ("M", "MOVE: pick entities (Enter ends picking)"),
    "COPY": ("CO", "COPY: pick entities (Enter ends picking)"),
    "ROTATE": ("RO", "ROTATE: pick entities (Enter ends picking)"),
    "SCALE": ("SC", "SCALE: pick entities (Enter ends picking)"),
    "MIRROR": ("MI", "MIRROR: pick entities (Enter ends picking)"),
    "OFFSET": ("O", "OFFSET: distance"),
    "TRIM": ("TR", "TRIM: pick cutting edges (Enter for every entity)"),
    "EXTEND": ("EX", "EXTEND: pick boundaries (Enter for every entity)"),
    "FILLET": ("F", "FILLET: radius"),
    "CHAMFER": ("CHA", "CHAMFER: first distance"),
    "ARRAY": ("AR", "ARRAY: pick entities (Enter ends picking)"),
    "HATCH": ("H", "HATCH: pick a point inside"),
    "DIST": ("DI", "DIST: first point"),
    "AREA": ("AA", "AREA: pick a closed entity or a point inside"),
    "ERASE": ("E", "ERASE: pick entities (Enter ends picking)"),
    "EXPLODE": ("X", "EXPLODE: pick block inserts (Enter ends picking)"),
    "BLOCK": ("B", "BLOCK: name"),
    "INSERT": ("I", "INSERT: block name"),
    "DIMLINEAR": ("DL", "DIMLINEAR: first point"),
    "DIMALIGNED": ("DA", "DIMALIGNED: first point"),
    "DIMANGLE": ("DG", "DIMANGLE: first line"),
    "DIMRADIUS": ("DR", "DIMRADIUS: pick circle or arc"),
    "CONSTRAIN": ("CN", "CONSTRAIN: kind (coincident, horizontal, vertical, parallel, perpendicular, equal, fixed, "
                        "length, radius)"),
    "PARAM": ("PM", "PARAM: name = expression"),
    "XATTACH": ("XA", "XATTACH: drawing name"),
    "XBIND": ("XB", "XBIND: xref name"),
}


def test_command_stage_prompts(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"},
              [{"key": "src"}, {"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 0, 0, 10), cir("C3", 50, 0, 2)],
                                "blocks": [{"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)],
                                            "attributes": []}]}])
    src = w.names["src"]
    later = [
        ("L", ["0,0"], "LINE: to point (Enter ends, U steps back)"),
        ("PL", ["0,0"], "PLINE: to point (Enter ends, U steps back, CL closes)"),
        ("REC", ["0,0"], "RECT: opposite corner"),
        ("C", ["0,0"], "CIRCLE: radius"),
        ("A", ["0,0"], "ARC: start point"), ("A", ["0,0", "1,0"], "ARC: end point"),
        ("DI", ["0,0"], "DIST: second point"),
        ("F", ["1"], "FILLET: first line"), ("F", ["1", "L1"], "FILLET: second line"),
        ("CHA", ["1"], "CHAMFER: second distance"), ("CHA", ["1", "1"], "CHAMFER: first line"),
        ("CHA", ["1", "1", "L1"], "CHAMFER: second line"),
        ("O", ["1"], "OFFSET: pick entity"), ("O", ["1", "L1"], "OFFSET: pick side"),
        ("DL", ["0,0"], "DIMLINEAR: second point"), ("DL", ["0,0", "1,0"], "DIMLINEAR: line position"),
        ("DA", ["0,0"], "DIMALIGNED: second point"), ("DA", ["0,0", "1,0"], "DIMALIGNED: line position"),
        ("DG", ["L1"], "DIMANGLE: second line"), ("DG", ["L1", "L2"], "DIMANGLE: arc position"),
        ("DR", ["C3"], "DIMRADIUS: text position"),
        ("TR", [""], "TRIM: pick the part to remove (Enter ends)"),
        ("EX", [""], "EXTEND: pick the end to extend (Enter ends)"),
        ("B", ["Gate"], "BLOCK: base point"), ("B", ["Gate", "0,0"], "BLOCK: pick entities (Enter ends picking)"),
        ("B", ["Gate", "0,0", "L1", ""], "BLOCK: attribute TAG=default (Enter for none)"),
        ("I", ["Door"], "INSERT: insertion point"), ("I", ["Door", "0,0"], "INSERT: scale (Enter is 1)"),
        ("I", ["Door", "0,0", ""], "INSERT: rotation in degrees (Enter is 0)"),
        ("CN", ["coincident"], "CONSTRAIN: pick first point"), ("CN", ["coincident", "0,0"], "CONSTRAIN: pick second point"),

        ("CN", ["parallel", "L1"], "CONSTRAIN: pick second entity"),
        ("CN", ["length", "L1"], "CONSTRAIN: expression"),
        ("M", ["L1", ""], "MOVE: from point"), ("M", ["L1", "", "0,0"], "MOVE: to point"),
        ("CO", ["L1", ""], "COPY: from point"), ("CO", ["L1", "", "0,0"], "COPY: to point (Enter ends)"),
        ("RO", ["L1", ""], "ROTATE: about point"), ("RO", ["L1", "", "0,0"], "ROTATE: angle in degrees"),
        ("SC", ["L1", ""], "SCALE: about point"), ("SC", ["L1", "", "0,0"], "SCALE: factor"),
        ("MI", ["L1", ""], "MIRROR: axis first point"), ("MI", ["L1", "", "0,0"], "MIRROR: axis second point"),
        ("MI", ["L1", "", "0,0", "0,1"], "MIRROR: keep originals? Y or N (Enter is Y)"),
        ("AR", ["L1", ""], "ARRAY: R for rows or P for polar"), ("AR", ["L1", "", "R"], "ARRAY: rows"),
        ("AR", ["L1", "", "R", "2"], "ARRAY: columns"), ("AR", ["L1", "", "R", "2", "2"], "ARRAY: row gap"),
        ("AR", ["L1", "", "R", "2", "2", "1"], "ARRAY: column gap"), ("AR", ["L1", "", "P"], "ARRAY: centre"),
        ("AR", ["L1", "", "P", "0,0"], "ARRAY: count"), ("AR", ["L1", "", "P", "0,0", "3"], "ARRAY: total angle"),
        ("XA", [src], "XATTACH: xref name"), ("XA", [src, "Site"], "XATTACH: insertion point"),
        ("XA", [src, "Site", "0,0"], "XATTACH: scale (Enter is 1)"),
        ("XA", [src, "Site", "0,0", ""], "XATTACH: rotation in degrees (Enter is 0)"),
    ]
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        prompt_is(page, "Ready. Type a command.")
        for name, (alias, first) in FIRST_PROMPTS.items():
            run(page, alias.lower())
            prompt_is(page, first)
            cmd(page).press("Escape")
            prompt_is(page, "Cancelled.")
            cmd(page).press_sequentially(name)
            cmd(page).press(" ")
            prompt_is(page, first)
            cmd(page).press("Escape")
        for alias, entries, expected in later:
            run(page, alias, *entries)
            prompt_is(page, expected)
            cmd(page).press("Escape")
            prompt_is(page, "Cancelled.")
        run(page, "B")
        cmd(page).press_sequentially("a")
        cmd(page).press(" ")
        advance(page, STEP_MS)
        assert text(prompt(page)) == "BLOCK: name", "Space is a character at a name stage"
        cmd(page).press("Escape")
    assert set(w.ents("a")) == {"L1", "L2", "C3"}, "cancelled commands must drop their uncommitted work"


def test_point_forms_and_value_refusals(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "src"}, {"key": "d"}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        run(page, "L", "2,3", "@5,0", "@10<90", "")
        ready(page, 1)
        run(page, "C", "@0,0", "@3,4")
        eventually(page, lambda: any(e["type"] == "circle" for e in w.ents("a").values()), "circle committed")
        run(page, "zzz")
        prompt_is(page, "Unknown command: ZZZ. Nothing happened.")
        run(page, "L", "abc")
        prompt_is(page, "That isn't a point. Try 10,20 or @5,0 or @10<45.")
        run(page, "0,0")
        prompt_is(page, "LINE: to point (Enter ends, U steps back)")
        cmd(page).press("Escape")
        run(page, "F", "x")
        prompt_is(page, "That isn't a number.")
        cmd(page).press("Escape")
        run(page, "C", "0,0", "0")
        prompt_is(page, "Enter a number greater than 0.")
        cmd(page).press("Escape")
        run(page, "I", "Nope")
        prompt_is(page, "No block named Nope.")
        cmd(page).press("Escape")
        run(page, "XA", "Nope")
        prompt_is(page, "No drawing named Nope in this folder.")
        cmd(page).press("Escape")
        run(page, "XB", "Nope")
        prompt_is(page, "No xref named Nope.")
        cmd(page).press("Escape")
        run(page, "M", "500,500")
        prompt_is(page, "Nothing there to pick.")
        cmd(page).press("Escape")
    e = w.ents("a")
    lines = sorted((ends(v) for v in e.values() if v["type"] == "line"), key=lambda s: sorted(s))
    assert {(2.0, 3.0), (7.0, 3.0)} in lines and {(7.0, 3.0), (7.0, 13.0)} in lines, lines
    circles = [v for v in e.values() if v["type"] == "circle"]
    assert len(circles) == 1 and near(circles[0]["cx"], 7) and near(circles[0]["cy"], 13) and near(circles[0]["r"], 5)
    assert len(e) == 3, f"refused values must not add geometry: {sorted(e)}"


def test_keyboard_map_and_focus(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 5, 10, 5)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}", size=DESK) as page:
        ready(page)
        cmd(page).focus()
        stops = [cmd(page), drawing(page)] + [panel(page, n) for n in PANELS]
        for stop in stops[1:] + stops[:1]:
            page.keyboard.press("F6")
            eventually(page, lambda: focused(stop), "F6 moves to the next published stop")
        page.keyboard.press("Shift+F6")
        eventually(page, lambda: focused(panel(page, "Markups")), "Shift+F6 goes back to the last panel")
        page.get_by_role("button", name="Layers", exact=True).first.click()
        eventually(page, lambda: page.get_by_role("button", name="Layers", exact=True).first.get_attribute(
            "aria-expanded") == "false", "Layers collapses")
        to_entities(page)
        page.keyboard.press("F6")
        eventually(page, lambda: focused(panel(page, "Properties")), "a collapsed panel is not a stop")
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(cmd(page)), "Escape in a panel returns to Command")
        drawing(page).focus()
        page.keyboard.press("l")
        eventually(page, lambda: focused(cmd(page)) and "l" in cmd(page).input_value().lower(), "printable key goes to Command")
        cmd(page).press("Escape")
        cmd(page).fill("")
        for key, name in [("F3", "Snap"), ("F8", "Ortho"), ("F9", "Grid")]:
            b = page.get_by_role("group", name="Drafting aids").get_by_role("button", name=name)
            was = b.get_attribute("aria-pressed") == "true"
            page.keyboard.press(key)
            eventually(page, lambda: (b.get_attribute("aria-pressed") == "true") != was, f"{key} toggles {name}")
            says(page, announce(page), f"{name} {'off' if was else 'on'}", exact=False)
            assert focused(cmd(page)), "aid keys leave focus unchanged"
        ortho = page.get_by_role("group", name="Drafting aids").get_by_role("button", name="Ortho")
        aid(page, "Ortho", True)
        cmd(page).focus()
        page.keyboard.press("F10")
        eventually(page, lambda: page.get_by_role("group", name="Drafting aids").get_by_role(
            "button", name="Polar").get_attribute("aria-pressed") == "true" and ortho.get_attribute("aria-pressed") == "false",
                   "Polar on turns Ortho off")
        run(page, "LA")
        eventually(page, lambda: focused(page.get_by_role("grid", name="Layer list")), "LAYER focuses Layer list")
        cmd(page).focus()
        run(page, "PM", "")
        eventually(page, lambda: focused(page.get_by_role("grid", name="Parameter list")), "PARAM Enter focuses Parameter list")
        before = rev(page)
        run(page, "L", "20,20", "30,20", "")
        committed(page, before)
        page.get_by_role("button", name="New layer").focus()
        page.keyboard.press("Control+z")
        eventually(page, lambda: len(w.ents("a")) == 2, "Ctrl+Z with a button focused undoes my last group")
        before = rev(page)
        run(page, "L", "20,20", "30,20", "")
        committed(page, before)
        cmd(page).focus()
        page.keyboard.press("U")
        eventually(page, lambda: len(w.ents("a")) == 2, "U in an empty Command at Ready undoes")
        assert focused(cmd(page))
        to_entities(page)
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: len(selected(page)) == 1, "ArrowDown in Entities selects one entity")
        page.keyboard.press("Delete")
        eventually(page, lambda: len(w.ents("a")) == 1, "Delete erases the selection")
        eventually(page, lambda: focused(cmd(page)), "focus returns to Command after Delete")


def test_dialog_tab_wraps_and_escape_returns(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        opener = page.get_by_role("button", name="Export", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Export")
        eventually(page, lambda: dialog.is_visible(), "Export dialog opens")
        for key in ["Tab"] * 8 + ["Shift+Tab"] * 8:
            page.keyboard.press(key)
            assert focused(dialog), f"{key} left the open dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: not dialog.is_visible() and focused(opener), "Escape closes and returns to Export")


def test_entity_list_labels_and_keys(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "layers": [layer("Walls", "red")],
                                        "blocks": [{"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)],
                                                    "attributes": []}],
                                        "entities": [ln("L1", 0, 0, 10, 0, "Walls"), cir("C2", 5, 5, 2, "Walls"),
                                                     arc("A3", 0, 0, 5, 0, 90, "Walls"),
                                                     pl("P4", [[0, 20], [3, 20], [3, 24]], False),
                                                     pl("P5", [[20, 0], [24, 0], [24, 3], [20, 3]], True), hat("H6", 21, 1),
                                                     dim("D7", "linear", [{"handle": "L1", "point": "start"},
                                                                          {"handle": "L1", "point": "end"}], 5, -3),
                                                     ins("I8", "Door", 5000, 5000, 2, 90)]}])
    labels = ["Line L1, layer Walls, from 0,0 to 10,0, length 10",
              "Circle C2, layer Walls, centre 5,5, radius 2, area 12.566",
              "Arc A3, layer Walls, centre 0,0, radius 5, from 0 to 90 degrees, length 7.854",
              "Polyline P4, layer 0, 3 points, open, length 7",
              "Polyline P5, layer 0, 4 points, closed, length 14, area 12",
              "Hatch H6, layer 0, area 12",
              "Dimension D7, layer 0, linear, value 10.00",
              "Block I8, layer 0, Door at 5000,5000, scale 2, rotation 90"]
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}", view=(w.did(), 10, 100, 300)) as page:
        ready(page)
        grid = page.get_by_role("grid", name="Entities")
        assert grid.get_attribute("aria-rowcount") == str(len(labels))
        for i, label in enumerate(labels):
            row = page.get_by_role("row", name=label, exact=True)
            eventually(page, lambda: row.count() == 1, f"row {label!r}")
            assert row.get_attribute("aria-rowindex") is not None
        to_entities(page)
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: len(selected(page)) == 1, "ArrowDown selects that entity alone")
        first = selected(page)
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: len(selected(page)) == 1 and selected(page) != first, "next row selects alone")
        page.keyboard.press("Space")
        eventually(page, lambda: selected(page) == [], "Space toggles the row's entity off")
        page.keyboard.press("Space")
        eventually(page, lambda: len(selected(page)) == 1, "Space toggles it back on")
        for _ in range(len(labels) + 2):
            if selected(page) == ["I8"]:
                break
            page.keyboard.press("ArrowDown")
            advance(page, STEP_MS)
        assert selected(page) == ["I8"], f"ArrowDown never reached I8; selected {selected(page)}"
        page.keyboard.press("Enter")
        pane = drawing(page).bounding_box()

        def inside() -> bool:
            b = entity(page, "I8").bounding_box()
            return b is not None and b["x"] >= pane["x"] + FIND_MARGIN_PX - PAN_TOL_PX and \
                b["x"] + b["width"] <= pane["x"] + pane["width"] - FIND_MARGIN_PX + PAN_TOL_PX and \
                b["y"] >= pane["y"] + FIND_MARGIN_PX - PAN_TOL_PX and \
                b["y"] + b["height"] <= pane["y"] + pane["height"] - FIND_MARGIN_PX + PAN_TOL_PX
        eventually(page, inside, "Enter pans the entity at least 48 px inside each pane edge")
        assert focused(grid)


def _journey_one(page: Page) -> None:
    box = cmd(page)
    box.press_sequentially("L")
    box.press(" ")
    prompt_is(page, "LINE: from point")
    for entry, expected in [("0,0", "LINE: to point (Enter ends, U steps back)"),
                            ("@10,0", "LINE: to point (Enter ends, U steps back)"),
                            ("@10<90", "LINE: to point (Enter ends, U steps back)")]:
        run(page, entry)
        prompt_is(page, expected)
        assert focused(cmd(page))
    box.press_sequentially("U")
    box.press("Enter")
    advance(page, STEP_MS)
    if text(prompt(page)) == "LINE: to point (Enter ends, U steps back)":
        box.press("Enter")
    prompt_is(page, "Ready. Type a command.")
    box.press("Enter")
    prompt_is(page, "LINE: from point")
    box.press("Escape")
    prompt_is(page, "Cancelled.")
    assert focused(cmd(page))


def test_wf_command_line_drafting_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        cmd(page).focus()
        _journey_one(page)
        ready(page, 1)
        says(page, announce(page), "Line L1 added", exact=False)
        label = "Line L1, layer 0, from 0,0 to 10,0, length 10"
        row = page.get_by_role("row", name=label, exact=True)
        eventually(page, lambda: row.count() == 1, "entity list reads the line back")
        assert page.get_by_role("grid", name="Entities").get_attribute("aria-rowcount") == "1"
    e = w.ents("a")
    assert list(e) == ["L1"] and ends(e["L1"]) == {(0.0, 0.0), (10.0, 0.0)}, e


def test_wf_command_line_drafting_recovery(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        run(page, "foo")
        prompt_is(page, "Unknown command: FOO. Nothing happened.")
        run(page, "L", "x,y")
        prompt_is(page, "That isn't a point. Try 10,20 or @5,0 or @10<45.")
        run(page, "1,1", "@3<0")
        prompt_is(page, "LINE: to point (Enter ends, U steps back)")
        cmd(page).press("Escape")
        prompt_is(page, "Cancelled.")
        advance(page, STEP_MS)
        assert w.ents("a") == {}, "Escape must drop the uncommitted line"
        run(page, "c", "5,5", "0")
        prompt_is(page, "Enter a number greater than 0.")
        run(page, "2")
        ready(page, 1)
        label = "Circle C1, layer 0, centre 5,5, radius 2, area 12.566"
        row = page.get_by_role("row", name=label, exact=True)
        eventually(page, lambda: row.count() == 1, "circle row label")
        assert focused(cmd(page))
    e = w.ents("a")
    assert list(e) == ["C1"] and near(e["C1"]["r"], 2) and near(e["C1"]["cx"], 5)


def test_snap_priority_aperture_and_aids(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 10.4, -2, 10.4, 2), ln("L3", 20, 5, 25, 5), ln("L4", 25.4, 5, 30, 5)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}", view=(w.did(), 10, 100, 300)) as page:
        ready(page)
        d = drawing(page)
        aid(page, "Snap", True)
        aid(page, "Grid", False)

        def snap_at(sx: float, sy: float) -> tuple[str | None, str | None, str | None]:
            page.mouse.move(*pane_point(page, sx, sy))
            advance(page, STEP_MS)
            return attr(d, "data-snap-kind"), attr(d, "data-snap-x"), attr(d, "data-snap-y")

        assert snap_at(203, 300) == ("endpoint", "10", "0"), "endpoint must beat a nearer midpoint"
        assert snap_at(353, 250) == ("endpoint", "25.4", "5"), "the closer endpoint wins"
        assert snap_at(150, 294) == ("midpoint", "5", "0")
        assert snap_at(150, 288)[0] == "none", "a candidate 12 px away is outside the 10 px aperture"
        aid(page, "Snap", False)
        aid(page, "Ortho", True)
        cases = [((7.3, -7.9), False, None), ((7.3, -7.9), True, (7, -10))]
        for target, grid_on, exact in cases:
            aid(page, "Grid", grid_on)
            before = rev(page)
            run(page, "L", "0,-10")
            page.mouse.click(*screen(page, *target))
            cmd(page).press("Enter")
            committed(page, before)
        aid(page, "Polar", True)
        assert page.get_by_role("group", name="Drafting aids").get_by_role("button", name="Ortho").get_attribute(
            "aria-pressed") == "false"
        for target in [(3.1, -6.7), (3.4, -8.9)]:
            aid(page, "Grid", True)
            before = rev(page)
            run(page, "L", "0,-10")
            page.mouse.click(*screen(page, *target))
            cmd(page).press("Enter")
            committed(page, before)
    lines = [v for h, v in w.ents("a").items() if h not in {"L1", "L2", "L3", "L4"}]
    far = [v for v in lines if not near(v["x2"], 0) or not near(v["y2"], -10)]
    assert len(lines) == 4, f"expected four new lines, got {lines}"
    ortho_free = [v for v in lines if near(v["y2"], -10) and abs(float(v["x2"]) - 7.3) <= POINTER_TOL]
    assert ortho_free, "Ortho keeps the larger delta and zeroes the other"
    assert any(near(v["x2"], 7) and near(v["y2"], -10) for v in lines), "Ortho then Grid rounds only x"
    diag = 5 / math.sqrt(2)
    assert any(near(v["x2"], diag) and near(v["y2"], -10 + diag) for v in lines), "Polar 45 then Grid rounds distance"
    assert any(near(v["x2"], 3) and near(v["y2"], -9) for v in lines), "Polar off-axis then Grid rounds both"
    assert far


def test_selection_grips_properties_nudges(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 0, 5, 10, 5), ln("L3", 20, 0, 35, 0)]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 300)) as page:
        ready(page)
        aid(page, "Snap", False)
        aid(page, "Ortho", False)
        aid(page, "Polar", False)
        aid(page, "Grid", True)
        a, b = screen(page, -1, 6), screen(page, 11, -1)
        page.mouse.move(*a)
        page.mouse.down()
        page.mouse.move(*b, steps=4)
        assert drawing(page).locator('[data-window="window"]').count() == 1
        page.mouse.up()
        eventually(page, lambda: sorted(selected(page)) == ["L1", "L2"], "window selects wholly inside entities")
        a, b = screen(page, 25, -3), screen(page, 15, 1)
        page.mouse.move(*a)
        page.mouse.down()
        page.mouse.move(*b, steps=4)
        assert drawing(page).locator('[data-window="crossing"]').count() == 1
        page.mouse.up()
        eventually(page, lambda: sorted(selected(page)) == ["L1", "L2", "L3"], "crossing selects touched entities")
        page.keyboard.down("Shift")
        drag(page, screen(page, -1, 6), screen(page, 11, -1))
        page.keyboard.up("Shift")
        eventually(page, lambda: selected(page) == ["L3"], "Shift window removes from the selection")
        page.mouse.click(*screen(page, 5, 0))
        eventually(page, lambda: sorted(selected(page)) == ["L1", "L3"], "click toggles an entity in")
        says(page, page.get_by_role("region", name="Properties"), "*VARIES*", exact=False)
        page.mouse.click(*screen(page, 27, 0))
        eventually(page, lambda: selected(page) == ["L1"], "click toggles an entity out")
        says(page, page.get_by_role("region", name="Properties"), "10", exact=False)
        grip = grip_at(page, "end", 10, 0)
        eventually(page, lambda: grip.count() == 1, "end grip at 10,0")
        gb = grip.bounding_box()
        before = rev(page)
        drag(page, (gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2), screen(page, 12, 3))
        committed(page, before)
        assert ends(w.ents("a")["L1"]) == {(0.0, 0.0), (12.0, 3.0)}
        r = w.undo("a")
        assert r.status_code == 200 and r.json()["command"] == "GRIP"
        assert ends(w.ents("a")["L1"]) == {(0.0, 0.0), (10.0, 0.0)}
        ready(page, r.json()["revision"])
        cmd(page).focus()
        page.keyboard.press("F6")
        eventually(page, lambda: focused(drawing(page)), "F6 reaches the drawing")
        before = rev(page)
        page.keyboard.press("ArrowRight")
        committed(page, before)
        before = rev(page)
        page.keyboard.press("Shift+ArrowUp")
        committed(page, before)
        assert focused(drawing(page)), "a nudge leaves focus unchanged"
    assert ends(w.ents("a")["L1"]) == {(1.0, 10.0), (11.0, 10.0)}
    r = w.undo("a")
    assert r.status_code == 200 and r.json()["command"] == "NUDGE"
    assert ends(w.ents("a")["L1"]) == {(1.0, 0.0), (11.0, 0.0)}, "one nudge is one undo step"


def test_presence_colours_follow_and_timeout(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit", "c": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    did = w.did()
    path = f"/drawings/{did}"
    hairs = "[data-colour][data-x][data-y]:not([data-entity-id])"
    with ExitStack() as a_stack, ExitStack() as b_stack:
        pa = a_stack.enter_context(opened(browser, app_url, w["a"], path, view=(did, 10, 100, 300)))
        ready(pa)
        pb = b_stack.enter_context(opened(browser, app_url, w["b"], path, view=(did, 10, 100, 300)))
        ready(pb)
        people = pb.get_by_role("list", name="People here")
        eventually(pb, lambda: w["a"] in text(people) and w["b"] in text(people), "both people listed")
        pa.mouse.move(*screen(pa, 5, 5))
        cross = drawing(pb).locator(hairs)
        eventually(pb, lambda: cross.count() == 1 and near(attr(cross, "data-x"), 5, POINTER_TOL) and
                   near(attr(cross, "data-y"), 5, POINTER_TOL), "A's crosshair follows A's pointer live")
        assert attr(cross, "data-colour") == "1" and w["a"] in text(cross)
        pb.get_by_role("button", name=f"Follow {w['a']}").click()
        pa.mouse.move(*screen(pa, 2, 2))
        pa.mouse.wheel(0, -120)
        eventually(pa, lambda: view_values(pa)[0] != 10, "A zooms")
        eventually(pb, lambda: abs(view_values(pb)[0] - view_values(pa)[0]) <= TOL, "follower copies A's zoom")
        pb.mouse.move(*screen(pb, 1, 1))
        pb.mouse.wheel(0, 120)
        says(pb, announce(pb), f"Stopped following {w['a']}.", exact=False)
        mine = view_values(pb)[0]
        pa.mouse.wheel(0, -120)
        eventually(pa, lambda: abs(view_values(pa)[0] - mine) > TOL, "A zooms again")
        advance(pb, STEP_MS * 5)
        assert abs(view_values(pb)[0] - mine) <= TOL, "the follow stopped once the follower zoomed"
        a_stack.close()
        clock(app_url, PRESENCE_MS + 1)
        eventually(pb, lambda: w["a"] not in text(people) and drawing(pb).locator(hairs).count() == 0,
                   "A is removed after PLOT_PRESENCE_TIMEOUT_MS")
        with opened(browser, app_url, w["c"], path, view=(did, 10, 100, 300)) as pc:
            ready(pc)
            pc.mouse.move(*screen(pc, 3, 3))
            cross = drawing(pb).locator(hairs)
            eventually(pb, lambda: cross.count() == 1 and attr(cross, "data-colour") == "1",
                       "C takes the freed lowest colour index 1")


def test_wf_pointer_drafting_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 10.4, -2, 10.4, 2)]}])
    did, path = w.did(), f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path, view=(did, 10, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], path, view=(did, 10, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        aid(pa, "Snap", True)
        pa.mouse.move(*pane_point(pa, 203, 300))
        eventually(pa, lambda: attr(drawing(pa), "data-snap-kind") == "endpoint", "endpoint wins over midpoint")
        eventually(pb, lambda: crosshairs(pb).filter(
                                                   has_text=w["a"]).count() == 1, "B sees A's named crosshair")
        before = rev(pa)
        run(pa, "L")
        pa.mouse.click(*pane_point(pa, 203, 300))
        aid(pa, "Snap", False)
        aid(pa, "Ortho", True)
        aid(pa, "Grid", True)
        pa.mouse.click(*screen(pa, 15, 3.7))
        cmd(pa).press("Enter")
        committed(pa, before)
        new = new_handles({"L1": 1, "L2": 1}, w.ents("a"))
        assert len(new) == 1 and ends(w.ents("a")[new[0]]) == {(10.0, 0.0), (15.0, 0.0)}
        eventually(pb, lambda: entity(pb, new[0]).count() == 1 and attr(entity(pb, new[0]), "data-x2") == "15",
                   "B sees the new line live")
        says(pb, announce(pb), f"{w['a']} changed 1 entity", exact=False)
        drag(pa, screen(pa, -1, 1), screen(pa, 10.2, -1))
        eventually(pa, lambda: selected(pa) == ["L1"], "window selects L1")
        cmd(pa).focus()
        pa.keyboard.press("F6")
        before = rev(pa)
        pa.keyboard.press("ArrowUp")
        committed(pa, before)
        says(pb, announce(pb), f"{w['a']} moved L1", exact=False)
        aid(pa, "Ortho", False)
        aid(pa, "Polar", False)
        aid(pa, "Grid", False)
        grip = grip_at(pa, "end", 10, 1)
        eventually(pa, lambda: grip.count() == 1, "grip at the nudged end")
        gb = grip.bounding_box()
        before = rev(pa)
        drag(pa, (gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2), screen(pa, 12, 4))
        committed(pa, before)
        eventually(pb, lambda: attr(entity(pb, "L1"), "data-x2") == "12", "B sees the grip edit live")
    assert ends(w.ents("b")["L1"]) == {(0.0, 1.0), (12.0, 4.0)}


def test_wf_pointer_drafting_crossing_erase(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 0, 5, 10, 5), ln("L3", 30, 0, 40, 0)]}])
    did, path = w.did(), f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path, view=(did, 10, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], path, view=(did, 10, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        aid(pa, "Snap", False)
        drag(pa, screen(pa, 6, 12), screen(pa, 4, -3))
        eventually(pa, lambda: sorted(selected(pa)) == ["L1", "L2"], "crossing selects both lines")
        before = rev(pa)
        pa.keyboard.press("Delete")
        committed(pa, before)
        says(pa, announce(pa), "Erased 2 entities", exact=False)
        eventually(pb, lambda: entity(pb, "L1").count() == 0 and entity(pb, "L2").count() == 0, "B sees the erase")
        says(pb, announce(pb), f"{w['a']} changed 2 entities", exact=False)
        assert set(w.ents("b")) == {"L3"}
        cmd(pa).focus()
        pa.keyboard.press("Control+z")
        eventually(pb, lambda: entity(pb, "L1").count() == 1 and entity(pb, "L2").count() == 1, "one undo restores both")
    assert set(w.ents("b")) == {"L1", "L2", "L3"}


def test_trim_and_extend(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [
        ln("L1", 5, -5, 5, 5), ln("L2", 0, 0, 10, 0),
        ln("L3", 3, 15, 3, 25), ln("L4", 7, 15, 7, 25), ln("L5", 0, 20, 10, 20),
        cir("C6", 0, 50, 5), ln("L7", 0, 40, 0, 60), pl("P8", [[200, 0], [210, 0]], False),
        ln("L9", 100, 300, 110, 300), ln("L10", 0, 80, 3, 80), ln("L11", 5, 75, 5, 85)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        before = rev(page)
        run(page, "TR", "L1", "", "8,0", "")
        committed(page, before)
        says(page, announce(page), "Trim: 1 entity changed", exact=False)
        assert ends(w.ents("a")["L2"]) == {(0.0, 0.0), (5.0, 0.0)}
        snap = w.ents("a")
        before = rev(page)
        run(page, "TR", "L3", "L4", "", "5,20", "")
        committed(page, before)
        says(page, announce(page), "Trim: 2 entities changed", exact=False)
        e = w.ents("a")
        added = new_handles(snap, e)
        assert ends(e["L5"]) == {(0.0, 20.0), (3.0, 20.0)} and len(added) == 1
        assert ends(e[added[0]]) == {(7.0, 20.0), (10.0, 20.0)} and hnum(added[0]) > max(hnum(h) for h in snap)
        before = rev(page)
        run(page, "TR", "L7", "", "5,50", "")
        committed(page, before)
        e = w.ents("a")
        assert "C6" not in e
        arcs = [h for h, v in e.items() if v["type"] == "arc"]
        assert len(arcs) == 1 and arcs[0].startswith("A") and hnum(arcs[0]) != 6
        a = e[arcs[0]]
        assert near(a["cx"], 0) and near(a["cy"], 50) and near(a["r"], 5) and near(a["start"], 90) and near(a["end"], 270)
        r = w.undo("a")
        assert r.status_code == 200
        e = w.ents("a")
        assert "C6" in e and arcs[0] not in e, "one undo restores the circle with its handle"
        ready(page, r.json()["revision"])
        run(page, "TR", "", "P8")
        prompt_is(page, "TRIM works on lines, arcs and circles. Explode a polyline first.")
        run(page, "105,300")
        prompt_is(page, "Nothing to trim: that entity doesn't cross a cutting edge.")
        cmd(page).press("Escape")
        before = rev(page)
        run(page, "EX", "L11", "", "2.5,80", "")
        committed(page, before)
        assert ends(w.ents("a")["L10"]) == {(0.0, 80.0), (5.0, 80.0)}
        run(page, "EX", "", "0.5,80")
        prompt_is(page, "Nothing to extend: no boundary in that direction.")
        cmd(page).press("Escape")
    r = w.undo("a")
    assert r.status_code == 200 and ends(w.ents("a")["L10"]) == {(0.0, 80.0), (3.0, 80.0)}


def test_fillet_and_chamfer(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 0, 0, 0, 10), ln("L3", 100, 0, 110, 0), ln("L4", 112, 2, 112, 10),
        ln("L5", 200, 0, 210, 0), ln("L6", 200, 5, 210, 5), ln("L7", 300, 0, 310, 0), ln("L8", 300, 0, 300, 10),
        ln("L9", 400, 0, 410, 0), ln("L10", 400, 0, 400, 10), ln("L11", 500, 0, 510, 0), ln("L12", 512, 2, 512, 10)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        snap = w.ents("a")
        before = rev(page)
        run(page, "F", "2", "8,0", "0,8")
        committed(page, before)
        e = w.ents("a")
        assert ends(e["L1"]) == {(2.0, 0.0), (10.0, 0.0)} and ends(e["L2"]) == {(0.0, 2.0), (0.0, 10.0)}
        arcs = [e[h] for h in new_handles(snap, e)]
        assert len(arcs) == 1 and arcs[0]["type"] == "arc"
        assert all(near(arcs[0][k], v) for k, v in {"cx": 2, "cy": 2, "r": 2, "start": 180, "end": 270}.items())
        snap = e
        before = rev(page)
        run(page, "F", "0", "105,0", "112,5")
        committed(page, before)
        e = w.ents("a")
        assert ends(e["L3"]) == {(100.0, 0.0), (112.0, 0.0)} and ends(e["L4"]) == {(112.0, 0.0), (112.0, 10.0)}
        assert new_handles(snap, e) == [], "radius 0 adds no arc"
        run(page, "F", "1", "205,0", "205,5")
        prompt_is(page, "These lines are parallel. Nothing to fillet.")
        cmd(page).press("Escape")
        run(page, "F", "20", "305,0", "300,5")
        prompt_is(page, "Radius too large for these lines.")
        cmd(page).press("Escape")
        snap = w.ents("a")
        before = rev(page)
        run(page, "CHA", "2", "3", "405,0", "400,5")
        committed(page, before)
        e = w.ents("a")
        assert ends(e["L9"]) == {(402.0, 0.0), (410.0, 0.0)} and ends(e["L10"]) == {(400.0, 3.0), (400.0, 10.0)}
        joins = [e[h] for h in new_handles(snap, e)]
        assert len(joins) == 1 and ends(joins[0]) == {(402.0, 0.0), (400.0, 3.0)}
        snap = e
        before = rev(page)
        run(page, "CHA", "0", "0", "505,0", "512,5")
        committed(page, before)
        e = w.ents("a")
        assert ends(e["L11"]) == {(500.0, 0.0), (512.0, 0.0)} and ends(e["L12"]) == {(512.0, 0.0), (512.0, 10.0)}
        assert new_handles(snap, e) == []
        run(page, "CHA", "1", "1", "205,0", "205,5")
        prompt_is(page, "These lines are parallel. Nothing to chamfer.")
        cmd(page).press("Escape")
        run(page, "CHA", "20", "20", "305,0", "300,5")
        prompt_is(page, "Distance too large for these lines.")
        cmd(page).press("Escape")
        assert focused(cmd(page))


def test_offset_mirror_array(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), cir("C2", 50, 0, 5), cir("C3", 80, 0, 2), arc("A4", 5, 100, 2, 0, 90),
        ln("L5", 200, 0, 201, 0), ln("L6", 301, 0, 302, 0), ln("L7", 401, 0, 402, 0)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        snap = w.ents("a")
        before = rev(page)
        run(page, "O", "2", "5,0", "5,5", "55,0", "60,0", "")
        committed(page, before)
        says(page, announce(page), "Offset: 2 entities added", exact=False)
        e = w.ents("a")
        made = [e[h] for h in new_handles(snap, e)]
        assert any(v["type"] == "line" and ends(v) == {(0.0, 2.0), (10.0, 2.0)} for v in made)
        assert any(v["type"] == "circle" and near(v["cx"], 50) and near(v["r"], 7) for v in made)
        r = w.undo("a")
        assert r.status_code == 200 and set(w.ents("a")) == set(snap), "one undo removes the whole OFFSET run"
        ready(page, r.json()["revision"])
        run(page, "O", "3", "82,0", "80,0")
        prompt_is(page, "Offset would make a radius of zero or less.")
        cmd(page).press("Escape")
        snap = w.ents("a")
        before = rev(page)
        run(page, "MI", "A4", "", "0,0", "0,10", "N")
        committed(page, before)
        says(page, announce(page), "Mirrored 1 entity", exact=False)
        e = w.ents("a")
        assert "A4" not in e
        m = [e[h] for h in new_handles(snap, e)]
        assert len(m) == 1 and all(near(m[0][k], v) for k, v in {"cx": -5, "cy": 100, "r": 2, "start": 90, "end": 180}.items())
        snap = e
        before = rev(page)
        run(page, "AR", "L5", "", "R", "2", "3", "5", "10")
        committed(page, before)
        says(page, announce(page), "Arrayed: 5 copies added", exact=False)
        e = w.ents("a")
        copies = new_handles(snap, e)
        offsets = [(round(float(e[h]["x1"]) - 200, 3), round(float(e[h]["y1"]), 3)) for h in copies]
        assert offsets == [(10.0, 0.0), (20.0, 0.0), (0.0, 5.0), (10.0, 5.0), (20.0, 5.0)], offsets
        snap = e
        before = rev(page)
        run(page, "AR", "L6", "", "P", "300,0", "4", str(ARRAY_TURN))
        committed(page, before)
        says(page, announce(page), "Arrayed: 3 copies added", exact=False)
        e = w.ents("a")
        got = [ends(e[h]) for h in new_handles(snap, e)]
        assert got == [{(300.0, 1.0), (300.0, 2.0)}, {(299.0, 0.0), (298.0, 0.0)}, {(300.0, -1.0), (300.0, -2.0)}], got
        snap = e
        before = rev(page)
        run(page, "AR", "L7", "", "P", "400,0", "3", "180")
        committed(page, before)
        e = w.ents("a")
        got = [ends(e[h]) for h in new_handles(snap, e)]
        assert got == [{(400.0, 1.0), (400.0, 2.0)}, {(399.0, 0.0), (398.0, 0.0)}], got
    r = w.undo("a")
    assert r.status_code == 200 and set(w.ents("a")) == set(snap), "one undo removes every copy"


def test_wf_modify_chain_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 5, -5, 5, 5), ln("L2", 0, 0, 10, 0), ln("L3", 20, 0, 30, 0)]}])
    path = f"/drawings/{w.did()}"
    start = w.ents("a")
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        steps = [("TR", "L1", "", "8,0", ""), ("O", "2", "25,0", "25,5", ""), ("MI", "L3", "", "0,0", "0,10", "Y"),
                 ("AR", "L3", "", "R", "1", "2", "1", "40")]
        for entries in steps:
            before = rev(pa)
            run(pa, *entries)
            committed(pa, before)
            target = rev(pa)
            eventually(pb, lambda: rev(pb) >= target, f"B receives {entries[0]} live")
            says(pb, announce(pb), f"{w['a']} changed", exact=False)
        assert attr(entity(pb, "L2"), "data-x2") == "5"
        assert len(w.ents("a")) == len(start) + 3
        cmd(pa).focus()
        for _ in steps:
            before = rev(pa)
            pa.keyboard.press("Control+z")
            committed(pa, before)
        says(pa, announce(pa), "Undo: TRIM", exact=False)
        eventually(pb, lambda: attr(entity(pb, "L2"), "data-x2") == "10", "B sees the trim undone")
    end = w.ents("a")
    assert set(end) == set(start) and all(ends(end[h]) == ends(start[h]) for h in start)


def test_wf_modify_chain_refusals(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 5, -5, 5, 5), ln("L2", 0, 0, 10, 0), pl("P3", [[0, 20], [10, 20]], False)]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        r0 = rev(pa)
        run(pa, "TR", "", "P3")
        prompt_is(pa, "TRIM works on lines, arcs and circles. Explode a polyline first.")
        assert rev(pa) == r0
        run(pa, "8,0", "")
        committed(pa, r0)
        eventually(pb, lambda: attr(entity(pb, "L2"), "data-x2") == "5", "B sees the trim after recovery")
        run(pa, "O", "x")
        prompt_is(pa, "That isn't a number.")
        r1 = rev(pa)
        run(pa, "1", "2,0", "2,5", "")
        committed(pa, r1)
    assert any(ends(v) == {(0.0, 1.0), (5.0, 1.0)} for v in w.ents("b").values())


def test_layers_inheritance_and_states(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "layers": [layer("Walls", "red"), layer("Hidden", "green")],
                                        "entities": [ln("L1", 0, 0, 10, 0, "Walls"), ln("L2", 0, 5, 10, 5, "Walls"),
                                                     ln("L3", 0, 9, 10, 9, "Hidden"),
                                                     pl("P4", [[50, 0], [51, 0], [51, 1], [50, 1]], True, "Hidden")]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        assert attr(entity(page, "L1"), "data-colour") == "red"
        rows = page.get_by_role("grid", name="Layer list").get_by_role("row")
        walls = rows.filter(has_text="Walls")
        select(walls.get_by_role("combobox", name="Colour"), "blue")
        eventually(page, lambda: attr(entity(page, "L1"), "data-colour") == "blue", "ByLayer colour follows the layer")
        assert by_key(w.drawing("a")["layers"], "name")["Walls"]["colour"] == "blue"
        r = w.undo("a")
        assert r.status_code == 200 and r.json()["command"] == "LAYER"
        eventually(page, lambda: attr(entity(page, "L1"), "data-colour") == "red", "undo restores the colour")
        hidden = rows.filter(has_text="Hidden")
        hidden.get_by_role("button", name="On").click()
        eventually(page, lambda: entity(page, "L3").count() == 0, "an off layer is not drawn")
        out = w.ok("a", [add(hat("x", 50.5, 0.5))])
        assert out["results"][0]["status"] == "applied", "hatch search still uses an off layer"
        hidden.get_by_role("button", name="Frozen").click()
        eventually(page, lambda: by_key(w.drawing("a")["layers"], "name")["Hidden"]["frozen"] is True, "frozen")
        err(w.ops("a", [add(hat("x", 50.5, 0.5))]), 422, "invalid", "No closed boundary around that point.")
        refused_select(page.get_by_role("combobox", name="Current layer"), "Hidden")
        eventually(page, lambda: page.get_by_text("Frozen layers can't be current.").count() > 0, "frozen current refused")
    err(w.ops("a", [{"type": "layer_delete", "name": "0"}]), 422, "invalid", "Layer 0 can't be deleted.")
    err(w.ops("a", [{"type": "layer_delete", "name": "Walls"}]), 422, "invalid", "Layer Walls has 2 entities. Move them first.")
    w.ok("a", [{"type": "layer_state_save", "name": "Base"}], command="LAYERSTATE")
    w.ok("a", [{"type": "layer_set", "name": "Walls", "set": {"colour": "green"}}], command="LAYER")
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        page.get_by_role("list", name="Layer states").get_by_role("button", name="Restore").first.click()
        eventually(page, lambda: attr(entity(page, "L1"), "data-colour") == "red", "Restore puts the state back")
    r = w.undo("a")
    assert r.status_code == 200 and r.json()["command"] == "LAYERSTATE"


def test_layer_lock_drops_live_selection(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Walls"), layer("Beams")],
                                                     "entities": [ln("L1", 0, 0, 10, 0, "Walls"), ln("L2", 0, 2, 10, 2, "Walls"),
                                                                  ln("L3", 0, 20, 10, 20, "Beams"), ln("L4", 0, 22, 10, 22, "Beams")]}])
    did = w.did()
    with opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 400)) as pb:
        ready(pb)
        aid(pb, "Snap", False)
        drag(pb, screen(pb, -1, 3), screen(pb, 11, -1))
        eventually(pb, lambda: sorted(selected(pb)) == ["L1", "L2"], "B selects both Walls lines")
        w.ok("a", [{"type": "layer_set", "name": "Walls", "set": {"locked": True}}], command="LAYER")
        says(pb, notices(pb), f"{w['a']} locked Walls. 2 entities left your selection.", exact=False)
        eventually(pb, lambda: selected(pb) == [], "selection leaves the locked layer")
        drag(pb, screen(pb, -1, 23), screen(pb, 11, 19))
        eventually(pb, lambda: sorted(selected(pb)) == ["L3", "L4"], "B selects both Beams lines")
        w.ok("a", [{"type": "layer_set", "name": "Beams", "set": {"frozen": True}}], command="LAYER")
        says(pb, notices(pb), f"{w['a']} locked Beams. 2 entities left your selection.", exact=False)
        eventually(pb, lambda: selected(pb) == [], "selection leaves the frozen layer")
    err(w.ops("b", [{"type": "move", "handles": ["L1"], "dx": 1, "dy": 0}]), 403, "layer_locked", "Layer Walls is locked.")
    err(w.ops("b", [add(ln("x", 0, 0, 1, 1, "Walls"))]), 403, "layer_locked", "Layer Walls is locked.")
    assert ends(w.ents("b")["L1"]) == {(0.0, 0.0), (10.0, 0.0)} and len(w.ents("b")) == 4


def test_wf_layers_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Walls", "red"), layer("Doors", "white")],
                                                     "entities": [ln("L1", 0, 0, 10, 0, "Walls"), ln("L2", 0, 2, 10, 2, "Walls"),
                                                                  ln("L3", 0, 30, 10, 30, "Doors")]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 400)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}") as pb:
        ready(pa)
        ready(pb)
        aid(pa, "Snap", False)
        drag(pa, screen(pa, -1, 3), screen(pa, 11, -1))
        eventually(pa, lambda: sorted(selected(pa)) == ["L1", "L2"], "A holds a selection")
        rows = pb.get_by_role("grid", name="Layer list").get_by_role("row")
        rows.filter(has_text="Walls").get_by_role("button", name="Frozen").click()
        says(pa, notices(pa), f"{w['b']} locked Walls. 2 entities left your selection.", exact=False)
        eventually(pa, lambda: entity(pa, "L1").count() == 0 and selected(pa) == [], "frozen layer hides on A")
        ready(pb)
        select(rows.filter(has_text="Doors").get_by_role("combobox", name="Colour"), "cyan")
        eventually(pa, lambda: attr(entity(pa, "L3"), "data-colour") == "cyan", "A sees the inherited colour")
    lm = by_key(w.drawing("a")["layers"], "name")
    assert lm["Walls"]["frozen"] is True and lm["Doors"]["colour"] == "cyan"


def test_wf_layers_errors(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Walls")],
                                                     "entities": [ln("L1", 0, 0, 10, 0, "Walls")]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 400)) as pa:
        ready(pa)
        rows = pa.get_by_role("grid", name="Layer list").get_by_role("row")
        rows.filter(has_text="Walls").get_by_role("button", name="Locked").click()
        eventually(pa, lambda: by_key(w.drawing("a")["layers"], "name")["Walls"]["locked"] is True, "Walls locks")
        aid(pa, "Snap", False)
        drag(pa, screen(pa, -1, 1), screen(pa, 11, -1))
        advance(pa, STEP_MS)
        assert selected(pa) == [], "entities on locked layers cannot be selected"
        rows.filter(has_text="Walls").get_by_role("button", name="Frozen").click()
        refused_select(pa.get_by_role("combobox", name="Current layer"), "Walls")
        eventually(pa, lambda: pa.get_by_text("Frozen layers can't be current.").count() > 0, "frozen current text")
    err(w.ops("b", [{"type": "modify", "handle": "L1", "set": {"x2": 20}}]), 403, "layer_locked", "Layer Walls is locked.")
    assert ends(w.ents("a")["L1"]) == {(0.0, 0.0), (10.0, 0.0)}


def test_blocks_inserts_attributes(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 1, 0, colour="ByBlock"), ln("L2", 5, 5, 6, 5)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        before = rev(page)
        run(page, "B", BLOCK_NAME, "0,0", "L1", "", f"{ATTR_TAG}=A1", "")
        committed(page, before)
        says(page, announce(page), f"Block {BLOCK_NAME} defined", exact=False)
        e = w.ents("a")
        assert "L1" not in e
        first = [h for h, v in e.items() if v["type"] == "insert"]
        assert len(first) == 1 and e[first[0]]["block"] == BLOCK_NAME and near(e[first[0]]["x"], 0)
        before = rev(page)
        run(page, "I", BLOCK_NAME, "10,0", "2", "90")
        committed(page, before)
        e = w.ents("a")
        second = [h for h, v in e.items() if v["type"] == "insert" and h not in first]
        s = e[second[0]]
        assert near(s["x"], 10) and near(s["scale"], 2) and near(s["rotation"], 90) and s["attributes"] == {ATTR_TAG: "A1"}
        select_via_list(page, second[0])
        field = page.get_by_role("region", name="Properties").get_by_role("textbox", name=ATTR_TAG)
        field.fill("B7")
        field.press("Enter")
        eventually(page, lambda: w.ents("a")[second[0]]["attributes"].get(ATTR_TAG) == "B7", "per-insert value saved")
        assert w.ents("a")[first[0]]["attributes"].get(ATTR_TAG) == "A1", "other insert keeps its value"
        r = w.undo("a")
        assert r.status_code == 200 and r.json()["command"] == "PROPERTIES"
    w.ok("a", [{"type": "block_define", "name": "Frame", "base": [0, 0], "handles": [first[0], "L2"], "attributes": []}],
         command="BLOCK")
    frame = by_key(w.drawing("a")["blocks"], "name")["Frame"]
    inner = by_handle(frame["entities"]).values()
    assert any(v["type"] == "insert" and v["block"] == BLOCK_NAME for v in inner), "blocks may nest"


def test_block_redefine_explode_purge(app_url: str, browser: Browser) -> None:
    door = {"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)], "attributes": [{"tag": "MARK", "default": "A1"}]}
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("E1"), layer("E2")], "blocks": [
        door, {"name": "Outer", "base": [0, 0], "entities": [ins("I51", "Door", 0, 0)], "attributes": []},
        {"name": "Unused1", "base": [0, 0], "entities": [ln("L52", 0, 0, 1, 1)], "attributes": []},
        {"name": "Unused2", "base": [0, 0], "entities": [ln("L53", 0, 0, 1, 1)], "attributes": []}],
        "entities": [ins("I1", "Door", 10, 0, 2, 90, {"MARK": "X9"}), ins("I2", "Door", 20, 0, 1, 0, {"MARK": "A1"}),
                     ln("L3", 0, 0, 0, 3), ins("I4", "Outer", 50, 50)]}])
    did = w.did()
    with opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 400)) as pb:
        ready(pb)
        tall = entity(pb, "I1").bounding_box()
        assert tall["height"] > tall["width"]
        w.ok("a", [{"type": "block_define", "name": "Door", "base": [0, 0], "handles": ["L3"],
                    "attributes": [{"tag": "MARK", "default": "Z"}, {"tag": "NOTE", "default": "N"}]}], command="BLOCK")

        def flat() -> bool:
            b = entity(pb, "I1").bounding_box()
            return b is not None and b["width"] > b["height"]
        eventually(pb, flat, "B's insert redraws with the new definition live")
        e = w.ents("a")
        assert e["I1"]["attributes"].get("MARK") == "X9" and e["I2"]["attributes"].get("MARK") == "A1"
        err(w.ops("a", [{"type": "block_define", "name": "Door", "base": [0, 0], "handles": ["I4"], "attributes": []}]),
            422, "invalid", "Block Door can't contain itself: Door -> Outer -> Door.")
        snap = w.ents("a")
        w.ok("a", [{"type": "explode", "handle": "I1"}], command="EXPLODE")
        e = w.ents("a")
        made = [e[h] for h in new_handles(snap, e)]
        assert "I1" not in e and len(made) == 1 and ends(made[0]) == {(4.0, 0.0), (10.0, 0.0)}
        before = rev(pb)
        run(pb, "X", "I2", "")
        committed(pb, before)
        says(pb, announce(pb), "Exploded I2: 1 entity added", exact=False)
        run(pb, "PU")
        prompt_is(pb, "Purged 2 blocks, 2 layers.")
    dj = w.drawing("a")
    names = set(by_key(dj["blocks"], "name"))
    assert {"Unused1", "Unused2"}.isdisjoint(names) and {"Door", "Outer"} <= names
    assert {"E1", "E2"}.isdisjoint(by_key(dj["layers"], "name"))


def test_wf_blocks_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 1, 0), ln("L2", 5, 5, 6, 5), ln("L3", 0, 0, 0, 2)]}])
    did, path = w.did(), f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "B", BLOCK_NAME, "0,0", "L1", "", f"{ATTR_TAG}=A1", "")
        committed(pa, before)
        door = [h for h, v in w.ents("a").items() if v["type"] == "insert"][0]
        before = rev(pa)
        run(pa, "B", "Frame", "0,0", door, "L2", "", "")
        committed(pa, before)
        frame = [h for h, v in w.ents("a").items() if v["type"] == "insert"][0]
        eventually(pb, lambda: entity(pb, frame).count() == 1, "B sees the nested insert")
        before = rev(pa)
        run(pa, "B", BLOCK_NAME, "0,0", "L3", "", "")
        committed(pa, before)
        says(pa, announce(pa), f"Block {BLOCK_NAME} redefined", exact=False)
        eventually(pb, lambda: rev(pb) >= rev(pa), "B receives the redefinition")
        run(pa, "B", BLOCK_NAME, "0,0", frame, "", "")
        prompt_is(pa, f"Block {BLOCK_NAME} can't contain itself: {BLOCK_NAME} -> Frame -> {BLOCK_NAME}.")
        cmd(pa).press("Escape")
        before = rev(pa)
        run(pa, "X", frame, "")
        committed(pa, before)
        eventually(pb, lambda: entity(pb, frame).count() == 0, "B sees the explode")
    e = w.ents("b")
    assert frame not in e and any(v["type"] == "insert" and v["block"] == BLOCK_NAME for v in e.values())
    door_def = by_key(w.drawing("a")["blocks"], "name")[BLOCK_NAME]
    assert any(v["type"] == "line" and ends(v) == {(0.0, 0.0), (0.0, 2.0)} for v in by_handle(door_def["entities"]).values())


def test_wf_blocks_concurrent_redefine(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "blocks": [
        {"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)], "attributes": []}],
        "entities": [ln("L1", 0, 0, 0, 4)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        pa.get_by_role("switch", name="Work offline").click()
        run(pa, "I", "Door", "10,0", "", "")
        says(pa, pa.get_by_role("status", name="Connection"), "You're working offline. 1 change waiting.")
        w.ok("b", [{"type": "block_define", "name": "Door", "base": [0, 0], "handles": ["L1"], "attributes": []}],
             command="BLOCK")
        pa.get_by_role("switch", name="Work offline").click()
        says(pa, pa.get_by_role("status", name="Connection"), "Back online: 1 change sent, 1 conflict.")
        says(pa, notices(pa), f"{w['b']} redefined Door. Your insert uses the new one.", exact=False)
    e = w.ents("a")
    assert any(v["type"] == "insert" and near(v["x"], 10) for v in e.values())
    door = by_key(w.drawing("a")["blocks"], "name")["Door"]
    assert any(ends(v) == {(0.0, 0.0), (0.0, 4.0)} for v in by_handle(door["entities"]).values())


def test_associative_dimensions(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L3", 100, 0, 110, 0), ln("L4", 100, 0, 110, 10), cir("C5", 200, 0, 2.5)]}])
    ref = [{"handle": "L1", "point": "start"}, {"handle": "L1", "point": "end"}]
    out = w.ok("a", [add(dim("x", "aligned", ref, 5, 2)), add(dim("x", "linear", ref, 5, -2)),
                     add(dim("x", "angular", [{"handle": "L3"}, {"handle": "L4"}], 105, 3)),
                     add(dim("x", "radial", [{"handle": "C5", "point": "centre"}], 203, 0))])
    al, li, an, ra = (r["handles"][0] for r in out["results"])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        val = lambda h: attr(entity(pa, h), "data-value")
        eventually(pa, lambda: [val(al), val(li), val(an), val(ra)] == ["10.00", "10.00", "45.00", "2.50"], "initial values")
        w.ok("b", [{"type": "modify", "handle": "L1", "set": {"x2": 13, "y2": 4}}], command="MOVE")
        eventually(pa, lambda: val(al) == "13.60" and val(li) == "13.00", "values follow a remote change live")
        w.ok("a", [{"type": "dim_style_set", "name": "Standard", "precision": 3, "prefix": "", "suffix": "", "scale": 1,
                    "text_height_mm": 2.5}])
        eventually(pa, lambda: val(al) == "13.601", "precision follows the style")
        assert w.undo("b").status_code == 200
        eventually(pa, lambda: val(al) == "10.000", "values follow undo")
        w.ok("a", [{"type": "delete", "handles": ["L1"]}], command="ERASE")
        eventually(pa, lambda: attr(entity(pa, al), "data-associative") == "false" and val(al) == "10.000", "association lost")
        says(pa, notices(pa), f"Dimension {al} lost its geometry.", exact=False)
        assert w.undo("a").status_code == 200
        eventually(pa, lambda: attr(entity(pa, al), "data-associative") == "true", "undoing the delete regains it")
        assert page_row(pa, f"Dimension {al}, layer 0, aligned, value 10.000")


def page_row(page: Page, label: str) -> bool:
    row = page.get_by_role("row", name=label, exact=True)
    eventually(page, lambda: row.count() == 1, f"row {label!r}")
    return True


def test_associative_hatch(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        pl("P1", [[0, 0], [10, 0], [10, 10], [0, 10]], True), cir("C2", 5, 5, 2), cir("C3", 5, 5, 1),
        ln("L4", 20, 0, 30, 0), ln("L5", 30, 0, 30, 10), ln("L6", 30, 10, 20, 10), arc("A7", 20, 5, 5, 90, 270)]}])
    out = w.ok("a", [add(hat("x", 25, 5))])
    h2 = out["results"][0]["handles"][0]
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        snap = w.ents("a")
        before = rev(pa)
        run(pa, "H", "1,1")
        committed(pa, before)
        h1 = new_handles(snap, w.ents("a"))[0]
        area = lambda h: attr(entity(pa, h), "data-area")
        eventually(pa, lambda: near(area(h1), 100 - math.pi * 4), "outer minus one-level island")
        eventually(pa, lambda: near(area(h2), 100 + 12.5 * math.pi), "arc segment adds outward bulge")
        w.ok("b", [{"type": "modify", "handle": "P1", "set": {"points": [[0, 0], [12, 0], [12, 10], [0, 10]]}}])
        eventually(pa, lambda: near(area(h1), 120 - math.pi * 4), "area follows a remote edit")
        w.ok("a", [{"type": "delete", "handles": ["L5"]}], command="ERASE")
        eventually(pa, lambda: attr(entity(pa, h2), "data-associative") == "false" and near(area(h2), 100 + 12.5 * math.pi),
                   "broken boundary keeps its area")
        says(pa, notices(pa), f"Hatch {h2}: boundary broken. It no longer follows its edges.", exact=False)
        assert w.undo("a").status_code == 200
        eventually(pa, lambda: attr(entity(pa, h2), "data-associative") == "true", "undo restores the link")
        run(pa, "H", "500,500")
        prompt_is(pa, "No closed boundary around that point.")


def test_wf_dimensions_hatch_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 20, 0, 30, 0), pl("P4", [[40, 0], [44, 0], [44, 4], [40, 4]], True), cir("C5", 42, 2, 1)]}])
    out = w.ok("a", [add(dim("x", "linear", [{"handle": "L1", "point": "end"}, {"handle": "L2", "point": "start"}], 15, 2)),
                     add(hat("x", 40.5, 0.5))])
    dh, hh = (r["handles"][0] for r in out["results"])
    did, path = w.did(), f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        select_via_list(pa, "L2")
        cmd(pa).focus()
        pa.keyboard.press("F6")
        before = rev(pa)
        pa.keyboard.press("ArrowRight")
        committed(pa, before)
        w.ok("a", [{"type": "move", "handles": ["C5"], "dx": 10, "dy": 0}], command="MOVE")
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, dh), "data-value") == "11.00", "dimension recalculates")
            eventually(page, lambda: near(attr(entity(page, hh), "data-area"), 16), "hatch drops the moved island")
        w.ok("a", [{"type": "delete", "handles": ["P4"]}], command="ERASE")
        eventually(pb, lambda: attr(entity(pb, hh), "data-associative") == "false", "B sees the broken hatch")
        cmd(pa).focus()
        pa.keyboard.press("Control+z")
        eventually(pb, lambda: attr(entity(pb, hh), "data-associative") == "true", "B sees the restored link")
    assert near(w.ents("a")["L2"]["x1"], 21) and "P4" in w.ents("a")


def test_wf_dimensions_hatch_concurrent(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 20, 0, 30, 0)]}])
    out = w.ok("a", [add(dim("x", "linear", [{"handle": "L1", "point": "end"}, {"handle": "L2", "point": "start"}], 15, 2))])
    dh = out["results"][0]["handles"][0]
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        base = rev(pa)
        assert w.ok("a", [{"type": "move", "handles": ["L2"], "dx": 5, "dy": 0}], rev=base, command="MOVE")["results"][0]["status"] == "applied"
        late = w.ok("b", [{"type": "move", "handles": ["L2"], "dx": 2, "dy": 0}], rev=base, command="MOVE")
        assert late["results"][0]["status"] == "rebased"
        says(pa, notices(pa), f"{w['b']} moved L2 after you.", exact=False)
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, dh), "data-value") == "12.00", "value of the winning move")
    assert near(w.ents("a")["L2"]["x1"], 22)


def test_constraints_and_parameters(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 4, 0), ln("L2", 0, 5, 4, 6)]}])
    w.ok("a", [{"type": "parameter_set", "name": "d1", "expression": "5"}], command="PARAM")
    w.ok("a", [{"type": "constraint_add", "kind": "fixed", "refs": [{"handle": "L1", "point": "start"}]}])
    w.ok("a", [{"type": "constraint_add", "kind": "length", "refs": [{"handle": "L1", "point": None}], "expression": "d1"}])
    length = lambda e: math.hypot(float(e["x2"]) - float(e["x1"]), float(e["y2"]) - float(e["y1"]))
    e = w.ents("a")["L1"]
    assert near(e["x1"], 0, SOLVE_TOL) and near(e["y1"], 0, SOLVE_TOL) and near(length(e), 5, SOLVE_TOL)
    w.ok("a", [{"type": "parameter_set", "name": "d1", "expression": "2*(3+1)"}], command="PARAM")
    e = w.ents("a")["L1"]
    assert near(length(e), 8, SOLVE_TOL) and near(e["x1"], 0, SOLVE_TOL)
    w.ok("a", [{"type": "constraint_add", "kind": "horizontal", "refs": [{"handle": "L2", "point": None}]}])
    e = w.ents("a")["L2"]
    assert abs(float(e["y1"]) - float(e["y2"])) <= SOLVE_TOL
    count = len(w.drawing("a")["constraints"])
    err(w.ops("a", [{"type": "constraint_add", "kind": "length", "refs": [{"handle": "L1", "point": None}], "expression": "3"}]),
        422, "invalid", "Over-constrained: length L1 = 3 conflicts with length L1 = d1.")
    assert len(w.drawing("a")["constraints"]) == count
    err(w.ops("a", [{"type": "parameter_set", "name": "d2", "expression": "d3+1"}]), 422, "invalid", "Unknown parameter: d3.")
    w.ok("a", [{"type": "parameter_set", "name": "d3", "expression": "1"}])
    w.ok("a", [{"type": "parameter_set", "name": "d2", "expression": "d3+1"}])
    body = err(w.ops("a", [{"type": "parameter_set", "name": "d3", "expression": "d2*2"}]), 422, "invalid")
    assert body["message"] in {"Expression cycle: d3 -> d2 -> d3.", "Expression cycle: d2 -> d3 -> d2."}, body
    w.ok("a", [{"type": "parameter_set", "name": "d4", "expression": "0"}])
    body = err(w.ops("a", [{"type": "parameter_set", "name": "d5", "expression": "10/d4"}]), 422, "invalid")
    assert body["message"] in {"Expression divides by zero: d5.", "Expression divides by zero: d4."}, body
    params = by_key(w.drawing("a")["parameters"], "name")
    assert params["d3"]["expression"] == "1" and "d5" not in params
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        says(page, page.get_by_role("region", name="Parameters"), "d1", exact=False)
        says(page, page.get_by_role("grid", name="Parameter list"), "8", exact=False)


def test_wf_constraints_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 5, 0), ln("L2", 0, 5, 4, 6)],
                                                     "parameters": [{"name": "d1", "expression": "5"}],
                                                     "constraints": [{"kind": "fixed", "refs": [{"handle": "L1", "point": "start"}]},
                                                                     {"kind": "length", "refs": [{"handle": "L1", "point": None}],
                                                                      "expression": "d1"}]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "PM", "d1 = 7")
        committed(pa, before)
        eventually(pb, lambda: near(math.hypot(float(attr(entity(pb, "L1"), "data-x2")), float(attr(entity(pb, "L1"), "data-y2"))), 7),
                   "B sees L1 solved to 7")
        says(pb, pb.get_by_role("grid", name="Parameter list"), "7", exact=False)
        before = rev(pa)
        run(pa, "CN", "horizontal", "L2")
        committed(pa, before)
    e = w.ents("a")
    assert abs(float(e["L2"]["y1"]) - float(e["L2"]["y2"])) <= SOLVE_TOL
    assert near(math.hypot(float(e["L1"]["x2"]), float(e["L1"]["y2"])), 7, SOLVE_TOL)


def test_wf_constraints_rollback(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                                     "parameters": [{"name": "d1", "expression": "5"}],
                                                     "constraints": [{"kind": "fixed", "refs": [{"handle": "L1", "point": None}]}]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pb:
        ready(pa)
        aid(pa, "Snap", False)
        pa.mouse.click(*screen(pa, 5, 0))
        grip = grip_at(pa, "end", 10, 0)
        eventually(pa, lambda: grip.count() == 1, "end grip shown")
        gb = grip.bounding_box()
        drag(pa, (gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2), screen(pa, 14, 3))
        ready(pa)
        eventually(pa, lambda: attr(entity(pa, "L1"), "data-x2") == "10" and attr(entity(pa, "L1"), "data-y2") == "0",
                   "refused drag rolls back on screen")
        eventually(pa, lambda: focused(cmd(pa)), "focus returns to Command after rollback")
        assert attr(entity(pb, "L1"), "data-x2") == "10"
        run(pa, "PM", "d1 = d9")
        prompt_is(pa, "Unknown parameter: d9.")
    assert ends(w.ents("a")["L1"]) == {(0.0, 0.0), (10.0, 0.0)}
    assert by_key(w.drawing("a")["parameters"], "name")["d1"]["expression"] == "5"


def _xref_world(base: str) -> World:
    return build(base, {"a": "edit", "b": "edit"}, [
        {"key": "src", "layers": [layer("Walls")], "entities": [ln("L1", 0, 0, 10, 0, "Walls"), ln("L2", 0, 50, 10, 50, "Walls")],
         "sheets": [{"key": "ss", "name": "Source", "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]},
        {"key": "d"}])


def test_xrefs_attach_clip_reload_bind(app_url: str, browser: Browser) -> None:
    w = _xref_world(app_url)
    w.ok("b", [{"type": "xref_attach", "name": "Site", "source": w.did("src"), "x": 100, "y": 0, "scale": 2, "rotation": 0}])
    with opened(browser, app_url, w["b"], f"/drawings/{w.did()}") as pb:
        ready(pb)
        x = entity(pb, "Site|L1")
        eventually(pb, lambda: x.count() == 1, "xref entity drawn")
        assert [attr(x, k) for k in ("data-x1", "data-y1", "data-x2", "data-y2")] == ["100", "0", "120", "0"]
        says(pb, pb.get_by_role("region", name="Layers"), "Site|Walls", exact=False)
        r = w.ops("b", [{"type": "move", "handles": ["Site|L1"], "dx": 1, "dy": 0}])
        assert r.status_code >= 400, "xref entities are read-only"
        w.ok("b", [{"type": "xref_clip", "name": "Site", "rect": [90, -10, 130, 10]}], command="XCLIP")
        eventually(pb, lambda: entity(pb, "Site|L2").count() == 0 and x.count() == 1, "clip hides entities outside")
        r = w.undo("b")
        assert r.status_code == 200 and r.json()["command"] == "XCLIP"
        w.ok("a", [add(ln("x", 0, 20, 5, 20, "Walls"))], key="src")
        assert w.client("a").post(f"/api/sheets/{w.sheet('ss')}/versions", json={}).status_code == 201
        says(pb, pb.get_by_role("status", name="Xref notice"), "Site has a new version. Reload?", exact=False)
        pb.get_by_role("region", name="Xrefs").get_by_role("button", name="Reload").first.click()
        eventually(pb, lambda: xref_entities(pb, "Site").count() >= 2, "reload brings new source geometry")
    r = w.undo("b")
    assert r.status_code == 200 and r.json()["command"] == "XRELOAD"
    src, host = w.names["src"], w.names["d"]
    err(w.ops("a", [{"type": "xref_attach", "name": "Back", "source": w.did(), "x": 0, "y": 0, "scale": 1, "rotation": 0}],
              key="src"), 422, "invalid", f"Circular reference: {src} -> {host} -> {src}.")
    w.ok("b", [{"type": "xref_bind", "name": "Site"}])
    dj = w.drawing("b")
    assert "Site" in by_key(dj["blocks"], "name") and "Site$Walls" in by_key(dj["layers"], "name")


def test_wf_xrefs_happy(app_url: str, browser: Browser) -> None:
    w = _xref_world(app_url)
    did = w.did()
    with opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pb:
        ready(pb)
        before = rev(pb)
        run(pb, "XA", w.names["src"], "Site", "0,0", "", "")
        committed(pb, before)
        page_row(pb, "Line Site|L1, layer Site|Walls, from 0,0 to 10,0, length 10")
        aid(pb, "Snap", True)
        pb.mouse.move(*pane_point(pb, 201, 300))
        eventually(pb, lambda: attr(drawing(pb), "data-snap-kind") == "endpoint" and attr(drawing(pb), "data-snap-x") == "10",
                   "snaps use xref entities")
        w.ok("a", [add(ln("x", 0, 20, 5, 20, "Walls"))], key="src")
        with opened(browser, app_url, w["a"], f"/drawings/{w.did('src')}") as pa:
            ready(pa)
            pa.get_by_role("tablist", name="Layouts").get_by_role("tab", name=SOURCE_SHEET).click()
            pa.get_by_role("button", name="Publish sheet").click()
            says(pa, pa.get_by_role("status", name="Storage notice"), "Published version 2.", exact=False)
        says(pb, pb.get_by_role("status", name="Xref notice"), "Site has a new version. Reload?", exact=False)
        pb.get_by_role("region", name="Xrefs").get_by_role("button", name="Reload").first.click()
        eventually(pb, lambda: xref_entities(pb, "Site").count() >= 3, "reloaded entities")
    assert "Site" in by_key(w.drawing("b")["xrefs"], "name")


def test_wf_xrefs_circular(app_url: str, browser: Browser) -> None:
    w = _xref_world(app_url)
    w.ok("b", [{"type": "xref_attach", "name": "Site", "source": w.did("src"), "x": 0, "y": 0, "scale": 1, "rotation": 0}])
    src, host = w.names["src"], w.names["d"]
    with opened(browser, app_url, w["a"], f"/drawings/{w.did('src')}") as pa:
        ready(pa)
        circ = f"Circular reference: {src} -> {host} -> {src}."
        shown = False
        for entry in ["XA", host, "Back", "0,0", "", ""]:
            run(pa, entry)
            advance(pa, STEP_MS)
            if text(prompt(pa)) == circ:
                shown = True
                break
        assert shown, f"XATTACH never showed {circ!r}; prompt reads {text(prompt(pa))!r}"
        cmd(pa).press("Escape")
    assert not by_key(w.drawing("a", "src")["xrefs"], "name")


def test_sheets_viewports_title_block(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "layers": [layer("Walls")], "entities": [
        ln("L1", 1000, 500, 1010, 500), ln("L2", 1000, 400, 1010, 400, "Walls"),
        dim("D3", "aligned", [{"handle": "L1", "point": "start"}, {"handle": "L1", "point": "end"}], 1005, 502)]}])
    c = w.client("a")
    s1 = c.post(f"/api/drawings/{w.did()}/sheets", json={"name": "Stage layout", "size": "A3"})
    s2 = c.post(f"/api/drawings/{w.did()}/sheets", json={"name": "Title block only", "size": "A4"})
    assert s1.status_code == 201 and s2.status_code == 201 and s2.json()["number"] == s1.json()["number"] + 1
    sid = s1.json()["id"]
    assert c.post(f"/api/sheets/{sid}/viewports", json={"x": 10, "y": 10, "width": 200, "height": 100, "scale": "1:50",
                                                         "view_x": 0, "view_y": 0, "frozen_layers": ["Walls"]}).status_code == 201
    assert c.post(f"/api/sheets/{sid}/viewports", json={"x": 220, "y": 10, "width": 180, "height": 100, "scale": "1:20",
                                                         "view_x": 1000, "view_y": VIEW_Y, "frozen_layers": []}).status_code == 201
    assert c.patch(f"/api/sheets/{sid}", json={"attributes": {"Project": "Larch Row"}}).status_code == 200
    err(c.patch(f"/api/sheets/{sid}", json={"attributes": {"Title": "Other"}}), 422, "invalid")
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        page.get_by_role("tablist", name="Layouts").get_by_role("tab", name="Stage layout").click()
        v1, v2 = viewport(page, "1:50"), viewport(page, "1:20")
        eventually(page, lambda: v1.count() == 1 and v2.count() == 1, "both viewports drawn")
        l1 = in_viewport(v1, "L1")
        assert near(attr(l1, "data-paper-x"), 130) and near(attr(l1, "data-paper-y"), 50)
        assert in_viewport(v1, "L2").count() == 0, "Walls frozen only in the 1:50 viewport"
        l2 = in_viewport(v2, "L2")
        assert near(attr(l2, "data-paper-x"), 310) and near(attr(l2, "data-paper-y"), 62.5)
        t = dimension_text(v1)
        assert near(attr(t, "data-text-height-mm"), 2.5) and near(attr(t, "data-world-text-height"), 125)
        assert attr(v2, "data-view-x") == "1000" and attr(v2, "data-view-y") == str(VIEW_Y)
        for value in ("Varies", "Larch Row", "Stage layout", w["a"]):
            eventually(page, lambda: page.get_by_text(value).count() > 0, f"title block shows {value}")


def test_publish_confirmed_by_storage(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                        "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False,
                                                    "attributes": {}, "viewports": [], "publish": 0}]}])
    sid, c = w.sheet(), w.client("a")
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        page.get_by_role("tablist", name="Layouts").get_by_role("tab", name="Plot plan").click()
        notice = page.get_by_role("status", name="Storage notice")
        with held(page, "**/api/sheets/*/versions") as gate:
            page.get_by_role("button", name="Publish sheet").click()
            says(page, notice, "Publishing…", exact=False)
            assert not [v for v in c.get(f"/api/sheets/{sid}/versions").json()["versions"] if v["state"] == "published"]
            gate.release()
        says(page, notice, "Published version 1.", exact=False)
        says(page, announce(page), "Published version 1.", exact=False)
    keys = S3().keys(f"versions/{sid}/")
    assert f"versions/{sid}/1.json" in keys and f"versions/{sid}/1.svg" in keys
    snap = json.loads(S3().get(f"versions/{sid}/1.json"))
    assert "sheet" in snap and "L1" in json.dumps(snap["model"]["entities"])
    assert b"<svg" in S3().get(f"versions/{sid}/1.svg")
    try:
        storage(app_url, True)
        err(c.post(f"/api/sheets/{sid}/versions", json={}), 503, "storage_unavailable")
        assert [v["number"] for v in c.get(f"/api/sheets/{sid}/versions").json()["versions"]] == [1]
    finally:
        storage(app_url, False)
    r = c.post(f"/api/sheets/{sid}/versions", json={})
    assert r.status_code == 201 and r.json()["number"] == 2 and r.json()["state"] == "published"
    assert f"versions/{sid}/2.json" in S3().keys(f"versions/{sid}/")


def _run_export(base: str, c: httpx.Client, job: str, final: str) -> tuple[dict[str, Any], set[int]]:
    seen: set[int] = set()
    deadline = time.monotonic() + WAIT_S
    while time.monotonic() < deadline:
        j = c.get(f"/api/exports/{job}").json()
        seen.add(j["progress"])
        if j["state"] == final:
            return j, seen
        clock(base, EXPORT_STEP_MS)
    pytest.fail(f"export {job} never reached {final}")


def test_export_jobs(app_url: str) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    c, did = w.client("a"), w.did()
    r = c.post(f"/api/drawings/{did}/exports", json={"format": "plot.txt"})
    assert r.status_code == 202 and r.json()["state"] == "queued" and r.json()["progress"] == 0
    job = r.json()["id"]
    err(c.get(f"/api/exports/{job}/download"), 409, "not_ready")
    j, seen = _run_export(app_url, c, job, "ready")
    assert seen <= PROGRESS_STEPS and j["progress"] == DONE and j["download_url"] == f"/api/exports/{job}/download"
    body = c.get(j["download_url"]).content
    assert body.startswith(b"plotfold 1\n") and S3().get(f"exports/{did}/{job}.plot.txt") == body
    err(c.post(f"/api/exports/{job}/retry"), 409, "illegal_transition")
    r = c.post(f"/api/drawings/{did}/exports", json={"format": "svg"})
    j, _ = _run_export(app_url, c, r.json()["id"], "ready")
    svg = c.get(j["download_url"]).content
    assert b"<svg" in svg and b'data-entity-id="L1"' in svg
    try:
        storage(app_url, True)
        job = c.post(f"/api/drawings/{did}/exports", json={"format": "plot.txt"}).json()["id"]
        j, _ = _run_export(app_url, c, job, "failed")
        assert j["progress"] == FAILED_AT and j["download_url"] is None
        err(c.get(f"/api/exports/{job}/download"), 409, "not_ready")
        assert f"exports/{did}/{job}.plot.txt" not in S3().keys(f"exports/{did}/")
    finally:
        storage(app_url, False)
    r = c.post(f"/api/exports/{job}/retry")
    assert r.status_code == 202 and r.json()["state"] == "running" and r.json()["progress"] == 0
    _run_export(app_url, c, job, "ready")
    assert f"exports/{did}/{job}.plot.txt" in S3().keys(f"exports/{did}/")


CANON = (b'plotfold 1\nlayer "Walls" red Dashed 0.5 on thawed unlocked\nline L1 "Walls" 0 0 10 0\n'
         b'circle C2 "0" 5 5 2\narc A3 "Walls" 0 0 5 0 90\npline P4 "0" closed 0 0 4 0 4 3\n')


def test_storage_outage_instance(app_url: str, browser: Browser) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    w = build(down, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                     "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False,
                                                 "attributes": {}, "viewports": [], "publish": 0}]}])
    c, did = w.client("a"), w.did()
    w.ok("a", [add(ln("x", 0, 5, 10, 5))])
    err(c.post(f"/api/sheets/{w.sheet()}/versions", json={}), 503, "storage_unavailable")
    err(upload(c, did, png(64)), 503, "storage_unavailable")
    err(import_text(c, did, CANON), 503, "storage_unavailable")
    err(import_text(c, did, b"plotfold 1\nwidget 1 2\n"), 503, "storage_unavailable")
    with opened(browser, down, w["a"], f"/drawings/{did}") as page:
        ready(page)
        page.get_by_role("tablist", name="Layouts").get_by_role("tab", name="Plot plan").click()
        notice = page.get_by_role("status", name="Storage notice")
        page.get_by_role("button", name="Publish sheet").click()
        says(page, notice, "File storage is unavailable. Nothing was published. Try again in a moment.", exact=False)
        says(page, announce(page), "File storage is unavailable. Nothing was published. Try again in a moment.", exact=False)
        page.get_by_role("button", name="Add underlay").click()
        dlg = page.get_by_role("dialog", name="Add underlay")
        dlg.get_by_label("Image file").set_input_files(files=[{"name": "site.png", "mimeType": "image/png", "buffer": png(64)}])
        dlg.get_by_role("textbox", name="First corner").fill("0,0")
        dlg.get_by_role("textbox", name="Opposite corner").fill("10,10")
        dlg.get_by_role("button", name="Attach").click()
        says(page, notice, "File storage is unavailable. Nothing was added. Try again in a moment.", exact=False)
        page.keyboard.press("Escape")
        page.get_by_role("button", name="Export", exact=True).click()
        dlg = page.get_by_role("dialog", name="Export")
        dlg.get_by_role("radio", name="Plotfold text").check()
        dlg.get_by_role("button", name="Start export").click()
        says(page, notice, "Export failed: file storage is unavailable.", exact=False)
        eventually(page, lambda: page.get_by_role("button", name="Retry export").count() == 1, "Retry export offered")
        before = rev(page)
        page.keyboard.press("Escape")
        run(page, "L", "20,20", "30,20", "")
        committed(page, before)
    assert len(w.ents("a")) == 3, "editing keeps working during the outage"


def test_storage_recovers_without_restart(app_url: str) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    c, did = w.client("a"), w.did()
    image = png(128, gid().encode())
    try:
        storage(app_url, True)
        err(upload(c, did, image), 503, "storage_unavailable")
        err(import_text(c, did, CANON), 503, "storage_unavailable")
        assert f"underlays/{did}/{sha(image)}.png" not in S3().keys(f"underlays/{did}/")
    finally:
        storage(app_url, False)
    r = upload(c, did, image)
    assert r.status_code == 201 and r.json()["key"] == f"underlays/{did}/{sha(image)}.png"
    assert S3().get(f"underlays/{did}/{sha(image)}.png") == image
    r = import_text(c, did, CANON)
    assert r.status_code == 201 and S3().get(f"imports/{did}/{sha(CANON)}.plot.txt") == CANON


def test_wf_sheets_publish_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                        "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False, "attributes": {},
                                                    "viewports": [{"x": 10, "y": 10, "width": 200, "height": 100, "scale": "1:50",
                                                                   "view_x": 0, "view_y": 0, "frozen_layers": []}], "publish": 0}]}])
    sid, did = w.sheet(), w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}") as page:
        ready(page)
        page.get_by_role("tablist", name="Layouts").get_by_role("tab", name="Plot plan").click()
        notice = page.get_by_role("status", name="Storage notice")
        page.get_by_role("button", name="Publish sheet").click()
        says(page, notice, "Published version 1.", exact=False)
        page.get_by_role("button", name="Export", exact=True).click()
        dlg = page.get_by_role("dialog", name="Export")
        dlg.get_by_role("radio", name="SVG").check()
        dlg.get_by_role("button", name="Start export").click()
        says(page, notice, "Export started.", exact=False)
        bar = page.get_by_role("progressbar", name="Export")
        values: set[int] = set()
        link = page.get_by_role("link", name="Download export")

        def done() -> bool:
            if bar.count():
                v = bar.first.evaluate("e => e.getAttribute('aria-valuenow') ?? "
                                       "(e.value === undefined ? null : String(e.value))")
                if v is not None:
                    values.add(int(float(v)))
            return link.count() == 1
        eventually(page, done, "Download export offered")
        assert values <= PROGRESS_STEPS and values, f"progress values {values}"
        says(page, notice, "Export ready.", exact=False)
        body = page.request.get(app_url + link.get_attribute("href")).body()
    assert f"versions/{sid}/1.svg" in S3().keys(f"versions/{sid}/")
    exports = [k for k in S3().keys(f"exports/{did}/") if k.endswith(".svg")]
    assert len(exports) == 1 and S3().get(exports[0]) == body


def test_wf_sheets_publish_outage(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                        "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False,
                                                    "attributes": {}, "viewports": [], "publish": 0}]}])
    sid, did = w.sheet(), w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}") as page:
        ready(page)
        page.get_by_role("tablist", name="Layouts").get_by_role("tab", name="Plot plan").click()
        notice = page.get_by_role("status", name="Storage notice")
        try:
            storage(app_url, True)
            page.get_by_role("button", name="Publish sheet").click()
            says(page, notice, "File storage is unavailable. Nothing was published. Try again in a moment.", exact=False)
            page.get_by_role("button", name="Export", exact=True).click()
            dlg = page.get_by_role("dialog", name="Export")
            dlg.get_by_role("radio", name="Plotfold text").check()
            dlg.get_by_role("button", name="Start export").click()
            says(page, notice, "Export failed: file storage is unavailable.", exact=False)
            assert not S3().keys(f"versions/{sid}/")
        finally:
            storage(app_url, False)
        page.get_by_role("button", name="Retry export").click()
        eventually(page, lambda: page.get_by_role("link", name="Download export").count() == 1, "retry succeeds")
        page.keyboard.press("Escape")
        page.get_by_role("button", name="Publish sheet").click()
        says(page, notice, "Published version 1.", exact=False)
    assert f"versions/{sid}/1.json" in S3().keys(f"versions/{sid}/")
    assert [k for k in S3().keys(f"exports/{did}/") if k.endswith(".plot.txt")]


def test_server_ordered_operations(app_url: str) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "layers": [layer("Shut", locked=True)], "entities": [ln("L1", 0, 0, 10, 0)]}])
    c, did = w.client("a"), w.did()
    r0 = w.drawing("a")["revision"]
    op = {"op_id": gid(), "type": "add", "entity": {"type": "line", "layer": "0", "x1": 0, "y1": 1, "x2": 1, "y2": 1}}
    body = {"base_revision": r0, "group_id": gid(), "command": "LINE", "ops": [op]}
    first = c.post(f"/api/drawings/{did}/ops", json=body)
    assert first.status_code == 200 and first.json()["revision"] == r0 + 1
    again = c.post(f"/api/drawings/{did}/ops", json=body)
    assert again.status_code == 200 and again.json()["results"] == first.json()["results"]
    assert w.drawing("a")["revision"] == r0 + 1 and len(w.ents("a")) == 2, "a replay changes nothing"
    bad = {"base_revision": r0 + 1, "group_id": gid(), "command": "LINE",
           "ops": [{"op_id": gid(), "type": "add", "entity": {"type": "line", "layer": "0", "x1": 5, "y1": 5, "x2": 6, "y2": 6}},
                   {"op_id": gid(), "type": "add", "entity": {"type": "circle", "layer": "Shut", "cx": 0, "cy": 0, "r": 1}}]}
    err(c.post(f"/api/drawings/{did}/ops", json=bad), 403, "layer_locked", "Layer Shut is locked.")
    assert w.drawing("a")["revision"] == r0 + 1 and len(w.ents("a")) == 2, "a failed group applies nothing"
    three = w.ok("a", [add(ln("x", i, 9, i, 10)) for i in range(3)])
    assert three["revision"] == r0 + 4
    big = w.ok("a", [add(ln("x", i, 20, i, 21)) for i in range(OP_WINDOW)])
    top = big["revision"]
    err(w.ops("a", [{"type": "move", "handles": ["L1"], "dx": 1, "dy": 0}], rev=top - OP_WINDOW - 1), 409, "stale_base",
        "This change is too old. Reload the drawing and try again.")
    assert w.ops("a", [{"type": "move", "handles": ["L1"], "dx": 1, "dy": 0}], rev=top - OP_WINDOW).status_code == 200


def test_conflict_rules(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Temp")],
                                                     "blocks": [{"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)],
                                                                 "attributes": []}],
                                                     "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 10, 10, 10), ln("L3", 0, 0, 0, 3),
                                                                  ln("L4", 0, 30, 10, 30)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        base = w.drawing("a")["revision"]
        w.ok("a", [{"type": "move", "handles": ["L1"], "dx": 5, "dy": 0}], rev=base, command="MOVE")
        late = w.ok("b", [{"type": "move", "handles": ["L1"], "dx": 0, "dy": 3}], rev=base, command="MOVE")
        assert late["results"][0]["status"] == "rebased"
        says(pa, notices(pa), f"{w['b']} moved L1 after you.", exact=False)
        eventually(pa, lambda: attr(entity(pa, "L1"), "data-y1") == "3" and attr(entity(pa, "L1"), "data-x1") == "0",
                   "A's screen shows the server's result")
        base = w.drawing("a")["revision"]
        w.ok("a", [{"type": "modify", "handle": "L4", "set": {"x2": 20}}], rev=base)
        assert w.ok("b", [{"type": "modify", "handle": "L4", "set": {"y2": 7}}], rev=base)["results"][0]["status"] == "rebased"
        says(pa, notices(pa), f"{w['b']} changed L4 after you.", exact=False)
        base = w.drawing("a")["revision"]
        w.ok("b", [{"type": "delete", "handles": ["L2"]}], rev=base, command="ERASE")
        assert w.ok("a", [{"type": "modify", "handle": "L2", "set": {"x2": 20}}], rev=base)["results"][0]["status"] == "dropped"
        says(pa, notices(pa), f"{w['b']} deleted L2. Your change was dropped.", exact=False)
        base = w.drawing("a")["revision"]
        w.ok("b", [{"type": "layer_delete", "name": "Temp"}], rev=base, command="LAYER")
        res = w.ok("a", [add(ln("x", 50, 0, 60, 0, "Temp"))], rev=base)["results"][0]
        assert res["status"] == "redirected"
        says(pa, notices(pa), f"{w['b']} deleted layer Temp. Your entity is on layer 0.", exact=False)
        base = w.drawing("a")["revision"]
        w.ok("b", [{"type": "block_define", "name": "Door", "base": [0, 0], "handles": ["L3"], "attributes": []}], rev=base, command="BLOCK")
        ins_res = w.ok("a", [add(ins("x", "Door", 70, 0))], rev=base, command="INSERT")["results"][0]
        assert ins_res["status"] == "redirected"
        says(pa, notices(pa), f"{w['b']} redefined Door. Your insert uses the new one.", exact=False)
    e = w.ents("a")
    assert ends(e["L1"]) == {(0.0, 3.0), (10.0, 3.0)} and ends(e["L4"]) == {(0.0, 30.0), (10.0, 7.0)}
    assert "L2" not in e and e[res["handles"][0]]["layer"] == "0"


def test_work_offline_queue(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 10, 10, 10)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        conn = pa.get_by_role("status", name="Connection")
        says(pa, conn, "Live")
        pa.get_by_role("switch", name="Work offline").click()
        run(pa, "L", "0,20", "5,20", "")
        run(pa, "M", "L1", "", "0,0", "1,0")
        run(pa, "M", "L2", "", "0,0", "2,0")
        says(pa, conn, "You're working offline. 3 changes waiting.")
        eventually(pa, lambda: attr(entity(pa, "L2"), "data-x1") == "2", "optimistic geometry on screen")
        assert len(w.ents("a")) == 2, "nothing reaches the server while offline"
        w.ok("b", [{"type": "move", "handles": ["L1"], "dx": 0, "dy": 4}], command="MOVE")
        w.ok("b", [{"type": "delete", "handles": ["L2"]}], command="ERASE")
        pa.reload()
        sw = pa.get_by_role("switch", name="Work offline")
        eventually(pa, lambda: "3 changes waiting" in text(conn) or "Back online" in text(conn),
                   "the queue survives the reload")
        if "changes waiting" in text(conn):
            sw.click()
        says(pa, conn, "Back online: 3 changes sent, 2 conflicts.")
        says(pa, notices(pa), f"{w['b']} deleted L2. Your change was dropped.", exact=False)
        eventually(pa, lambda: entity(pa, "L2").count() == 0, "dropped edit rolls back on screen")
        eventually(pa, lambda: focused(cmd(pa)), "focus in Command after rollback")
    e = w.ents("a")
    assert ends(e["L1"]) == {(1.0, 0.0), (11.0, 0.0)}, "queued move kept its original base revision"
    assert "L2" not in e and any(ends(v) == {(0.0, 20.0), (5.0, 20.0)} for v in e.values())


def test_per_person_undo_redo(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 0, 10, 10, 10),
        dim("D3", "aligned", [{"handle": "L2", "point": "start"}, {"handle": "L2", "point": "end"}], 5, 12)],
        "constraints": [{"kind": "horizontal", "refs": [{"handle": "L2", "point": None}]}]}])
    c, did = w.client("a"), w.did()
    err(w.undo("a"), 409, "nothing_to_undo")

    def mine(op: dict[str, Any], command: str) -> None:
        r = c.post(f"/api/drawings/{did}/ops", json={"base_revision": w.drawing("a")["revision"], "group_id": gid(),
                                                      "command": command, "ops": [{"op_id": gid(), **op}]})
        assert r.status_code == 200, r.text
    mine({"type": "move", "handles": ["L1"], "dx": 1, "dy": 0}, "MOVE")
    other = w.ok("b", [add(ln("x", 50, 50, 60, 50))])["results"][0]["handles"][0]
    r = w.undo("a")
    assert r.status_code == 200 and r.json()["command"] == "MOVE"
    assert near(w.ents("a")["L1"]["x1"], 0) and other in w.ents("a"), "undo never touches another person's group"
    assert w.undo("a", route="redo").json()["command"] == "MOVE" and near(w.ents("a")["L1"]["x1"], 1)
    err(w.undo("a", route="redo"), 409, "nothing_to_redo")
    assert w.undo("a").status_code == 200
    mine({"type": "move", "handles": ["L1"], "dx": 0, "dy": 1}, "MOVE")
    err(w.undo("a", route="redo"), 409, "nothing_to_redo")
    mine({"type": "delete", "handles": ["L2"]}, "ERASE")
    mine({"type": "move", "handles": ["L1"], "dx": 2, "dy": 0}, "MOVE")
    w.ok("b", [{"type": "move", "handles": ["L1"], "dx": 0, "dy": 5}], command="MOVE")
    err(w.undo("a"), 409, "undo_superseded", f"Can't undo: {w['b']} changed L1 after you.")
    fresh = signed_in(app_url, w["a"])
    r = fresh.post(f"/api/drawings/{did}/undo", json={})
    assert r.status_code == 200 and r.json()["command"] == "ERASE", "the stack survives a new session"
    dj = w.drawing("a")
    e = by_handle(dj["entities"])
    assert "L2" in e and {x["handle"] for x in e["D3"]["refs"]} == {"L2"}
    assert any("L2" in json.dumps(k["refs"]) for k in dj["constraints"])
    with opened(browser, app_url, w["a"], f"/drawings/{did}") as page:
        ready(page)
        eventually(page, lambda: attr(entity(page, "D3"), "data-associative") == "true", "dimension link restored")


def test_wf_offline_conflicts_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 10, 10, 10)]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        for p in (pa, pb):
            p.get_by_role("switch", name="Work offline").click()
        run(pa, "E", "L2", "")
        run(pa, "M", "L1", "", "0,0", "1,0")
        run(pb, "M", "L1", "", "0,0", "0,2")
        run(pb, "M", "L2", "", "0,0", "3,0")
        pa.get_by_role("switch", name="Work offline").click()
        says(pa, pa.get_by_role("status", name="Connection"), "Back online: 2 changes sent, 0 conflicts.")
        pb.get_by_role("switch", name="Work offline").click()
        says(pb, pb.get_by_role("status", name="Connection"), "Back online: 2 changes sent, 2 conflicts.")
        says(pb, notices(pb), f"{w['a']} deleted L2. Your change was dropped.", exact=False)
        says(pa, notices(pa), f"{w['b']} moved L1 after you.", exact=False)
        cmd(pa).focus()
        pa.keyboard.press("Control+z")
        eventually(pa, lambda: pa.get_by_text(f"Can't undo: {w['b']} changed L1 after you.").count() > 0, "skip text shown")
        pa.keyboard.press("Control+z")
        eventually(pa, lambda: entity(pa, "L2").count() == 1, "next undo restores the erase")
    e = w.ents("a")
    assert ends(e["L1"]) == {(0.0, 2.0), (10.0, 2.0)} and ends(e["L2"]) == {(0.0, 10.0), (10.0, 10.0)}


def test_wf_offline_conflicts_reload(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        conn = pa.get_by_role("status", name="Connection")
        pa.get_by_role("switch", name="Work offline").click()
        run(pa, "L", "0,0", "5,0", "")
        says(pa, conn, "You're working offline. 1 change waiting.")
        pa.get_by_role("switch", name="Work offline").click()
        says(pa, conn, "Back online: 1 change sent, 0 conflicts.")
        revision = w.drawing("a")["revision"]
        pa.reload()
        ready(pa)
        says(pa, conn, "Live")
        advance(pa, STEP_MS * 5)
    assert len(w.ents("a")) == 1 and w.drawing("a")["revision"] == revision


def _drop_new_inserts(w: World) -> None:
    extra = [h for h, v in w.ents("a").items() if v["type"] == "insert" and h != "I4"]
    if extra:
        w.ok("a", [{"type": "delete", "handles": extra}])


def _compare_world(base: str) -> World:
    w = build(base, {"a": "edit", "m": "manage", "r": "markup"}, [{"key": "d", "blocks": [
        {"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)], "attributes": []}],
        "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 10, 10, 10), ln("L3", 0, 20, 10, 20), ins("I4", "Door", 50, 0)],
        "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]}])
    return w


def test_delta_swipe_compare(app_url: str, browser: Browser) -> None:
    w = _compare_world(app_url)
    w.ok("a", [{"type": "modify", "handle": "L2", "set": {"x2": 12}}])
    w.ok("a", [{"type": "delete", "handles": ["L3"]}, {"type": "move", "handles": ["L1"], "dx": 0.0005, "dy": 0}])
    added = w.ok("a", [add(ln("x", 0, 40, 5, 40))])["results"][0]["handles"][0]
    w.ok("a", [{"type": "block_define", "name": "Door", "base": [0, 0], "handles": [added], "attributes": []}])
    _drop_new_inserts(w)
    added = w.ok("a", [add(ln("x", 0, 60, 5, 60))])["results"][0]["handles"][0]
    c = w.client("a")
    assert c.post(f"/api/sheets/{w.sheet()}/versions", json={}).status_code == 201
    cmp = c.get(f"/api/sheets/{w.sheet()}/compare", params={"from": 1, "to": 2}).json()
    assert (cmp["added"], cmp["removed"], cmp["changed"]) == (1, 1, 2), cmp
    diff = {x["id"]: x["diff"] for x in cmp["entities"]}
    assert diff["L1"] == "same" and diff["L2"] == "changed" and diff["L3"] == "removed"
    assert diff["I4"] == "changed" and diff[added] == "added"
    hist = c.get(f"/api/drawings/{w.did()}/entities/L2/history").json()["history"]
    assert hist[0]["username"] == w["a"]
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        page.get_by_role("button", name="Compare").click()
        early, late = page.get_by_role("combobox", name="Earlier version"), page.get_by_role("combobox", name="Later version")
        eventually(page, lambda: combo_text(early) == "v1" and combo_text(late) == "v2", "defaults to the two newest")
        says(page, page.get_by_role("status", name="Compare counts"), "Added 1, removed 1, changed 2")
        slider = page.get_by_role("slider", name="Compare swipe")
        assert swipe_pct(slider) == SWIPE_START
        slider.focus()
        for key, value in [("ArrowRight", SWIPE_START + 1), ("PageUp", SWIPE_START + 1 + PAGE_STEP),
                           ("ArrowLeft", SWIPE_START + PAGE_STEP), ("PageDown", SWIPE_START), ("Home", 0), ("End", SWIPE_MAX)]:
            page.keyboard.press(key)
            eventually(page, lambda: swipe_pct(slider) == value, f"{key} sets {value}")
        assert slider.get_attribute("aria-valuetext") == f"{SWIPE_MAX}% newer version"
        assert drawing(page).locator("[data-swipe-divider]").count() == 1
        page.get_by_role("switch", name="Overlay").click()
        eventually(page, lambda: marked(page, "added").count() >= 1 and
                   marked(page, "removed").count() >= 1, "overlay marks entities")
        assert not drawing(page).locator("[data-swipe-divider]").first.is_visible()
        marked(page, "changed", "L2").first.dispatch_event("click")
        pattern = re.compile(rf"{re.escape(w['a'])} \w+ at \d{{4}}-\d{{2}}-\d{{2}} \d{{2}}:\d{{2}} UTC")
        eventually(page, lambda: bool(pattern.search(text(page.get_by_role("region", name="Entity history")))), "history line")


def test_restore_version(app_url: str, browser: Browser) -> None:
    w = _compare_world(app_url)
    v1 = w.version("s", 1)
    snap = w.client("a").get(f"/api/versions/{v1}").json()["snapshot"]
    old = by_handle(snap["model"]["entities"])
    w.ok("a", [{"type": "modify", "handle": "L2", "set": {"x2": 12}}])
    w.ok("a", [{"type": "delete", "handles": ["L3"]}])
    extra = w.ok("a", [add(ln("x", 0, 40, 5, 40))])["results"][0]["handles"][0]
    with opened(browser, app_url, w["a"], f"/versions/{v1}") as page:
        eventually(page, lambda: drawing(page).count() == 1, "review screen loads")
        page.get_by_role("region", name="Versions").get_by_role("button", name="Restore this version").click()
        eventually(page, lambda: "L3" in w.ents("a"), "restore applied")
    e = w.ents("a")
    assert set(e) == set(old) and extra not in e
    assert ends(e["L2"]) == ends(old["L2"]) and ends(e["L3"]) == ends(old["L3"])
    assert [v["id"] for v in w.client("a").get(f"/api/sheets/{w.sheet()}/versions").json()["versions"]] == [v1]
    hist = w.client("a").get(f"/api/drawings/{w.did()}/entities/L2/history").json()["history"]
    assert hist[0]["command"] == "RESTORE" and len(hist) >= 2
    r = w.undo("a")
    assert r.status_code == 200 and r.json()["command"] == "RESTORE" and extra in w.ents("a")


def test_markups_carried_forward(app_url: str, browser: Browser) -> None:
    w = _compare_world(app_url)
    v1, c = w.version("s", 1), w.client("r")
    for kind, box in [("cloud", (0, -1, 10, 1)), ("arrow", (-3, -2, 0, 0)), ("text", (100, 100, 101, 101))]:
        r = c.post(f"/api/versions/{v1}/markups", json={"kind": kind, "x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3],
                                                        "text": "Check kerb"})
        assert r.status_code == 201 and r.json()["flag"] is None
    w.ok("a", [{"type": "modify", "handle": "L1", "set": {"x2": 9}}])
    v2 = w.client("a").post(f"/api/sheets/{w.sheet()}/versions", json={}).json()["id"]
    flags = {m["kind"]: m["flag"] for m in c.get(f"/api/versions/{v2}/markups").json()["markups"]}
    assert flags == {"cloud": "geometry-changed", "arrow": "geometry-changed", "text": None}, flags
    assert len(c.get(f"/api/versions/{v1}/markups").json()["markups"]) == 3
    with opened(browser, app_url, w["r"], f"/versions/{v2}") as page:
        eventually(page, lambda: page.locator('[data-flag="geometry-changed"]').count() >= 2, "flags on screen")
        eventually(page, lambda: page.get_by_text("Geometry changed under this markup").count() >= 1, "flag label")


def test_review_steps_and_approvals(app_url: str) -> None:
    w = _compare_world(app_url)
    ca, cm, cr = w.client("a"), w.client("m"), w.client("r")
    v1 = w.version("s", 1)
    assert cr.post(f"/api/versions/{v1}/review", json={}).status_code == 403
    r = ca.post(f"/api/versions/{v1}/review", json={})
    assert r.status_code == 201 and r.json()["state"] == "in_review"
    steps = r.json()["steps"]
    assert [(s["role"], s["state"]) for s in steps] == [("markup", "pending"), ("manage", "waiting")] and steps[0]["due_at"]
    err(cm.post(f"/api/versions/{v1}/review/manage/approve", json={"comment": "ok"}), 409, "out_of_order",
        "Waiting on the step before.")
    r = cr.post(f"/api/versions/{v1}/review/markup/approve", json={"comment": "ok"})
    assert r.status_code == 200
    stamp = re.compile(rf"Approved by {re.escape(w['r'])} at \d{{4}}-\d{{2}}-\d{{2}} \d{{2}}:\d{{2}} UTC")
    assert any(stamp.fullmatch(str(s.get("text", s)) if isinstance(s, dict) else s) or stamp.search(json.dumps(s))
               for s in r.json()["stamps"])
    err(cr.post(f"/api/versions/{v1}/review/manage/approve", json={"comment": "ok"}), 403, "forbidden")
    r = cm.post(f"/api/versions/{v1}/review/manage/approve", json={"comment": "ok"})
    assert r.status_code == 200 and r.json()["state"] == "approved"
    err(ca.post(f"/api/versions/{v1}/review", json={}), 409, "illegal_transition", "A version can't go from approved to in_review.")
    v2 = ca.post(f"/api/sheets/{w.sheet()}/versions", json={}).json()["id"]
    versions = {v["id"]: v for v in ca.get(f"/api/sheets/{w.sheet()}/versions").json()["versions"]}
    assert versions[v1]["state"] == "approved" and versions[v1]["replaced_by"]
    assert ca.post(f"/api/versions/{v2}/review", json={}).status_code == 201
    r = cr.post(f"/api/versions/{v2}/review/markup/reject", json={"comment": "no"})
    assert r.status_code == 200 and r.json()["state"] == "rejected"
    v3 = ca.post(f"/api/sheets/{w.sheet()}/versions", json={}).json()["id"]
    assert ca.post(f"/api/versions/{v3}/review", json={}).status_code == 201
    clock(app_url, REVIEW_TTL_MS + 1)
    assert {v["id"]: v for v in ca.get(f"/api/sheets/{w.sheet()}/versions").json()["versions"]}[v3]["state"] == "published"
    err(cr.post(f"/api/versions/{v3}/review/markup/approve", json={"comment": "late"}), 409, "review_expired",
        "This review expired.")
    assert ca.post(f"/api/versions/{v3}/review", json={}).status_code == 201
    ca.post(f"/api/sheets/{w.sheet()}/versions", json={})
    err(cr.post(f"/api/versions/{v3}/review/markup/approve", json={"comment": "ok"}), 409, "review_voided",
        "Review voided: version 4 replaced this one.")


def test_wf_compare_review_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "r": "markup"}, [
        {"key": "src", "entities": [ln("L1", 0, 0, 10, 0)],
         "sheets": [{"key": "ss", "name": "Source", "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]},
        {"key": "d", "entities": [ln("L1", 0, 50, 10, 50)],
         "xrefs": [{"name": "Site", "source": "src", "x": 0, "y": 0, "scale": 1, "rotation": 0, "clip": None}],
         "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]}])
    ca, cr = w.client("a"), w.client("r")
    v1 = w.version("s", 1)
    cr.post(f"/api/versions/{v1}/markups", json={"kind": "cloud", "x1": 0, "y1": 49, "x2": 10, "y2": 51, "text": "Check"})
    w.ok("a", [add(ln("x", 0, 5, 3, 5))], key="src")
    ca.post(f"/api/sheets/{w.sheet('ss')}/versions", json={})
    w.ok("a", [{"type": "xref_reload", "name": "Site"}], command="XRELOAD")
    w.ok("a", [{"type": "modify", "handle": "L1", "set": {"x2": 12}}])
    v2 = ca.post(f"/api/sheets/{w.sheet()}/versions", json={}).json()["id"]
    assert ca.post(f"/api/versions/{v2}/review", json={}).status_code == 201
    with opened(browser, app_url, w["r"], f"/versions/{v2}") as page:
        eventually(page, lambda: drawing(page).count() == 1, "review screen loads")
        page.get_by_role("button", name="Compare").click()
        says(page, page.get_by_role("status", name="Compare counts"), "Added 1, removed 0, changed 1")
        slider = page.get_by_role("slider", name="Compare swipe")
        slider.focus()
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: swipe_pct(slider) == SWIPE_START - 1, "ArrowLeft by 1")
        eventually(page, lambda: page.get_by_text("Geometry changed under this markup").count() >= 1, "flagged markup")
        versions = page.get_by_role("region", name="Versions")
        versions.get_by_role("button", name="Approve").click()
        eventually(page, lambda: re.search(rf"Approved by {re.escape(w['r'])} at \d{{4}}-\d{{2}}-\d{{2}} \d{{2}}:\d{{2}} UTC",
                                           text(versions)) is not None, "stamp shown")
        ca.post(f"/api/sheets/{w.sheet()}/versions", json={})
        says(page, versions, "Review voided: version 3 replaced this one.", exact=False)
    states = {v["id"]: v["state"] for v in ca.get(f"/api/sheets/{w.sheet()}/versions").json()["versions"]}
    assert states[v2] == "voided"


def test_wf_compare_review_reduced_motion(app_url: str, browser: Browser) -> None:
    w = _compare_world(app_url)
    w.ok("a", [{"type": "delete", "handles": ["L3"]}])
    v2 = w.client("a").post(f"/api/sheets/{w.sheet()}/versions", json={}).json()["id"]
    with opened(browser, app_url, w["r"], f"/versions/{v2}", reduced="reduce") as page:
        eventually(page, lambda: drawing(page).count() == 1, "review screen loads")
        page.evaluate(RECORD_ANIMATIONS)
        page.get_by_role("button", name="Compare").click()
        says(page, page.get_by_role("status", name="Compare counts"), "Added 0, removed 1, changed 0")
        slider = page.get_by_role("slider", name="Compare swipe")
        slider.focus()
        page.keyboard.press("PageUp")
        eventually(page, lambda: swipe_pct(slider) == SWIPE_START + PAGE_STEP, "PageUp by 10")
        assert focused(slider)
        assert not [a for a in recorded(page) if a["id"] == "compare-swipe" and a["duration"] > 0]
    cmp = w.client("r").get(f"/api/sheets/{w.sheet()}/compare", params={"from": 1, "to": 2}).json()
    assert (cmp["added"], cmp["removed"], cmp["changed"]) == (0, 1, 0)


def _field_world(base: str) -> World:
    return build(base, {"a": "edit", "m": "manage", "r": "markup"}, [{"key": "d", "entities": [ln("L1", 0, 0, 100, 0)],
                 "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]}])


def test_phone_gestures(app_url: str, browser: Browser) -> None:
    w = _field_world(app_url)
    with opened(browser, app_url, w["r"], f"/versions/{w.version('s', 1)}", size=PHONE) as page:
        eventually(page, lambda: drawing(page).count() == 1, "review screen loads")
        f = Fingers(page)
        z0, px0, py0 = view_values(page)
        f.send("touchStart", [(100, 100), (200, 100)])
        f.send("touchMove", [(50, 100), (250, 100)])
        z1 = round(min(MAX_ZOOM, max(MIN_ZOOM, z0 * 2)), 4)
        eventually(page, lambda: near(view_values(page)[0], z1), "pinch move 1 zoom")
        assert near(view_values(page)[1], round(150 - (150 - px0) * z1 / z0, 4))
        f.send("touchMove", [(50, 150), (350, 150)])
        z2 = round(min(MAX_ZOOM, max(MIN_ZOOM, z0 * 3)), 4)
        eventually(page, lambda: near(view_values(page)[0], z2), "pinch move 2 computed from start values")
        _, px, py = view_values(page)
        assert near(px, round(200 - (150 - px0) * z2 / z0, 4)) and near(py, round(150 - (100 - py0) * z2 / z0, 4))
        f.send("touchEnd", [])
        z, px, py = view_values(page)
        f.send("touchStart", [(100, 300), (200, 300)])
        f.send("touchMove", [(130, 320), (230, 320)])
        eventually(page, lambda: near(view_values(page)[1], px + 30) and near(view_values(page)[2], py + 20), "two-finger pan")
        f.send("touchEnd", [])
        menu = page.get_by_role("menu", name="Sheet actions")
        f.send("touchStart", [(150, 400)])
        advance(page, LONG_PRESS_MS - 1)
        assert not menu.is_visible(), "no menu before 500 ms"
        f.send("touchEnd", [])
        dialog = page.get_by_role("dialog", name="New issue")
        eventually(page, lambda: dialog.is_visible(), "a short touch is a tap")
        page.keyboard.press("Escape")
        f.send("touchStart", [(150, 400)])
        advance(page, LONG_PRESS_MS)
        eventually(page, lambda: menu.is_visible(), "long press opens Sheet actions")
        f.send("touchEnd", [])
        names = [" ".join(t.split()) for t in menu.get_by_role("menuitem").all_inner_texts()]
        assert names == ["Pin issue here", "Measure from here", "Show versions"]
        menu.get_by_role("menuitem", name="Show versions").click()
        eventually(page, lambda: page.get_by_role("dialog", name="Panel").get_by_role("tab", name="Versions").get_attribute(
            "aria-selected") == "true", "Show versions opens the Versions tab")
        page.keyboard.press("Escape")
        z, _, _ = view_values(page)
        f.send("touchStart", [(100, 200)])
        advance(page, LONG_PRESS_MS)
        f.send("touchEnd", [])
        menu.get_by_role("menuitem", name="Measure from here").click()
        f.tap(100, 300)
        m = None

        def measured() -> bool:
            nonlocal m
            m = re.search(r"DIST: ([\d.]+) units, angle ([\d.]+) degrees", page.content())
            return m is not None
        eventually(page, measured, "measure result in the DIST format")
        assert abs(float(m.group(1)) - 100 / z) <= TOL * 10 and near(m.group(2), 270)
        run(page, "L")
        prompt_is(page, "Drawing commands aren't available on a phone. Open this drawing on a desktop to edit.")


def test_issues_and_rfis(app_url: str, browser: Browser) -> None:
    w = _field_world(app_url)
    cr, ca, cm = w.client("r"), w.client("a"), w.client("m")
    v1 = w.version("s", 1)
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa:
        ready(pa)
        issue = cr.post(f"/api/versions/{v1}/issues", json={"title": "Kerb line", "x": 5, "y": 5}).json()
        assert issue["state"] == "open" and issue["creator"] == w["r"]
        listing = pa.get_by_role("list", name="Issue list")
        says(pa, listing, "Kerb line", exact=False)
        iid = issue["id"]
        err(cr.post(f"/api/issues/{iid}/transitions", json={"to": "closed"}), 409, "illegal_transition",
            "An issue can't go from open to closed.")
        rfi = cr.post(f"/api/issues/{iid}/rfis", json={"question": QUESTION, "addressee": w["a"]}).json()
        assert rfi["state"] == "draft" and rfi["ball_in_court"] == w["r"] and rfi["issue_id"] == iid
        issues = {i["id"]: i for i in ca.get(f"/api/drawings/{w.did()}/issues").json()["issues"]}
        assert rfi["id"] in issues[iid]["rfi_ids"]
        err(ca.post(f"/api/rfis/{rfi['id']}/transitions", json={"to": "sent"}), 403, "not_ball_in_court",
            f"This RFI is with {w['r']}.")
        err(cr.post(f"/api/rfis/{rfi['id']}/transitions", json={"to": "answered", "answer": "x"}), 409, "illegal_transition",
            "An RFI can't go from draft to answered.")
        sent = cr.post(f"/api/rfis/{rfi['id']}/transitions", json={"to": "sent"}).json()
        assert sent["state"] == "sent" and sent["ball_in_court"] == w["a"]
        art = pa.get_by_role("article", name=f"RFI: {QUESTION}")
        says(pa, art, f"With {w['a']}", exact=False)
        err(ca.post(f"/api/rfis/{rfi['id']}/transitions", json={"to": "answered"}), 422, "invalid")
        ans = ca.post(f"/api/rfis/{rfi['id']}/transitions", json={"to": "answered", "answer": "The north one"}).json()
        assert ans["state"] == "answered" and ans["ball_in_court"] == w["r"]
        says(pa, art, f"With {w['r']}", exact=False)
        assert cr.post(f"/api/issues/{iid}/transitions", json={"to": "answered"}).status_code == 200
        err(cr.post(f"/api/issues/{iid}/transitions", json={"to": "closed"}), 409, "rfi_open", "Close its RFI first.")
        assert cr.post(f"/api/rfis/{rfi['id']}/transitions", json={"to": "closed"}).json()["state"] == "closed"
        assert cr.post(f"/api/issues/{iid}/transitions", json={"to": "closed"}).json()["state"] == "closed"
        err(ca.post(f"/api/issues/{iid}/transitions", json={"to": "open"}), 403, "forbidden")
        assert cm.post(f"/api/issues/{iid}/transitions", json={"to": "open"}).json()["state"] == "open"


def test_folder_roles_applied_live(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"e": None, "v": "view"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)],
                                                   "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False,
                                                               "attributes": {}, "viewports": [], "publish": 1}]}],
              parent={"m": "manage", "e": "edit", "o": None})
    other = build(app_url, {"z": "edit"}, [{"key": "d"}])
    ce, cv, cm = w.client("e"), w.client("v"), w.client("m")
    assert w.drawing("e")["role"] == "edit", "role inherited from the parent folder"
    err(w.ops("v", [{"type": "move", "handles": ["L1"], "dx": 1, "dy": 0}]), 403, "read_only")
    err(cv.post(f"/api/versions/{w.version('s', 1)}/markups", json={"kind": "text", "x1": 0, "y1": 0, "x2": 1, "y2": 1,
                                                                     "text": "x"}), 403, "forbidden")
    err(ce.put(f"/api/folders/{w.folder}/roles/{w['v']}", json={"role": "edit"}), 403, "forbidden")
    outsider = signed_in(app_url, other["z"])
    err(outsider.get(f"/api/drawings/{w.did()}"), 404, "not_found")
    err(outsider.get(f"/api/versions/{w.version('s', 1)}"), 404, "not_found")
    err(outsider.post(f"/api/versions/{w.version('s', 1)}/issues", json={"title": "x", "x": 0, "y": 0}), 404, "not_found")
    err(other.ops("z", [{"type": "xref_attach", "name": "Peek", "source": w.did(), "x": 0, "y": 0, "scale": 1, "rotation": 0}]),
        404, "not_found")
    assert cm.patch(f"/api/sheets/{w.sheet()}", json={"locked": True}).status_code == 200
    err(ce.patch(f"/api/sheets/{w.sheet()}", json={"attributes": {"Project": "x"}}), 403, "sheet_locked",
        f"This sheet is locked by {w['m']}.")
    err(ce.patch(f"/api/sheets/{w.sheet()}", json={"locked": False}), 403, "forbidden")
    with opened(browser, app_url, w["e"], f"/drawings/{w.did()}") as page:
        ready(page)
        assert page.get_by_role("button", name="Publish sheet").count() == 1
        r = cm.put(f"/api/folders/{w.folder}/roles/{w['e']}", json={"role": "view"})
        assert r.status_code == 200 and r.json() == {"username": w["e"], "role": "view", "inherited": False}
        says(page, notices(page), "Your role is now view.", exact=False)
        eventually(page, lambda: focused(drawing(page)) and page.get_by_role("button", name="Publish sheet").count() == 0,
                   "controls leave and focus moves to the drawing")
        run(page, "L")
        prompt_is(page, "You can view this drawing but not edit it.")
        assert cm.delete(f"/api/folders/{w.folder}/roles/{w['e']}").status_code == 204
        assert cm.delete(f"/api/folders/{w.res['folders']['p']}/roles/{w['e']}").status_code == 204
        eventually(page, lambda: page.get_by_text("You no longer have access to this drawing.").count() > 0, "revoked live")
    err(ce.get(f"/api/drawings/{w.did()}"), 404, "not_found")


def test_view_links(app_url: str, browser: Browser) -> None:
    w = _field_world(app_url)
    cm, ca = w.client("m"), w.client("a")
    v1 = w.version("s", 1)
    err(ca.post(f"/api/versions/{v1}/links", json={}), 403, "forbidden")
    link = cm.post(f"/api/versions/{v1}/links", json={}).json()
    token = link["url"].removeprefix("/v/")
    r = httpx.get(f"{app_url}/api/links/{token}", timeout=HTTP_TIMEOUT)
    assert r.status_code == 200 and r.json()["id"] == v1
    with opened(browser, app_url, None, link["url"]) as page:
        eventually(page, lambda: drawing(page).count() == 1, "link page shows the version")
        assert page.get_by_role("region", name="Issues").count() == 0
        assert page.request.get(f"{app_url}/api/drawings/{w.did()}").status >= 400
        assert page.request.post(f"{app_url}/api/versions/{v1}/markups", data={"kind": "text"}).status >= 400
        assert cm.delete(f"/api/links/{link['id']}").status_code == 204
        eventually(page, lambda: page.get_by_text("This link was turned off.").count() > 0, "turned-off text live")
    err(httpx.get(f"{app_url}/api/links/{token}", timeout=HTTP_TIMEOUT), 410, "link_revoked")
    second = cm.post(f"/api/versions/{v1}/links", json={}).json()
    with opened(browser, app_url, None, second["url"]) as page:
        eventually(page, lambda: drawing(page).count() == 1, "second link opens")
        clock(app_url, LINK_TTL_MS + 1)
        eventually(page, lambda: page.get_by_text("This link has expired.").count() > 0, "expired text live")
    err(httpx.get(f"{app_url}/api/links/{second['url'].removeprefix('/v/')}", timeout=HTTP_TIMEOUT), 410, "link_expired")


def test_wf_phone_field_review_happy(app_url: str, browser: Browser) -> None:
    w = _field_world(app_url)
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pd, \
            opened(browser, app_url, w["r"], f"/versions/{w.version('s', 1)}", size=PHONE) as pp:
        ready(pd)
        eventually(pp, lambda: drawing(pp).count() == 1, "phone review loads")
        Fingers(pp).tap(150, 300)
        dlg = pp.get_by_role("dialog", name="New issue")
        eventually(pp, lambda: dlg.is_visible(), "tap opens New issue")
        dlg.get_by_role("textbox", name="Issue title").fill("Kerb line")
        dlg.get_by_role("button", name="Pin issue").click()
        eventually(pp, lambda: drawing(pp).locator("[data-issue-pin]").count() == 1, "pin placed")
        pp.get_by_role("button", name="Panels").click()
        sheet = pp.get_by_role("dialog", name="Panel")
        item = sheet.get_by_role("list", name="Issue list").get_by_role("listitem").filter(has_text="Kerb line")
        item.get_by_role("button", name="Create RFI").click()
        rfi = pp.get_by_role("dialog", name="New RFI")
        rfi.get_by_role("textbox", name="Question").fill(QUESTION)
        select(rfi.get_by_role("combobox", name="Addressee"), w["a"])
        rfi.get_by_role("button", name="Save RFI").click()
        art = sheet.get_by_role("article", name=f"RFI: {QUESTION}")
        eventually(pp, lambda: art.count() == 1, "RFI listed")
        art.get_by_role("button", name="Send RFI").click()
        desk_art = pd.get_by_role("article", name=f"RFI: {QUESTION}")
        says(pd, desk_art, f"With {w['a']}", exact=False)
        desk_art.get_by_role("textbox", name="RFI answer").fill("The north one")
        desk_art.get_by_role("button", name="Answer RFI").click()
        says(pp, art, f"With {w['r']}", exact=False)
        item.get_by_role("button", name="Close issue").click()
        eventually(pp, lambda: "An issue can't go from open to closed." in text(notices(pp)) or
                   "Close its RFI first." in text(notices(pp)), "a refused close shows a published rejection text")
        issues = w.client("a").get(f"/api/drawings/{w.did()}/issues").json()["issues"]
        mine = [i for i in issues if i["title"] == "Kerb line"]
        assert len(mine) == 1 and len(mine[0]["rfi_ids"]) == 1
        assert w.client("m").delete(f"/api/folders/{w.folder}/roles/{w['r']}").status_code == 204
        eventually(pp, lambda: pp.get_by_text("You no longer have access to this drawing.").count() > 0, "phone loses access live")
    err(w.client("r").get(f"/api/drawings/{w.did()}"), 404, "not_found")


PHONE_SIZES = [PHONE, PHONE_TALL]


def test_wf_phone_field_review_layout(app_url: str, browser: Browser) -> None:
    w = _field_world(app_url)
    for size in PHONE_SIZES:
        with opened(browser, app_url, w["r"], f"/versions/{w.version('s', 1)}", size=size) as page:
            eventually(page, lambda: drawing(page).count() == 1, "phone review loads")
            layout(page)
            opener = page.get_by_role("button", name="Panels")
            b = opener.bounding_box()
            assert b["width"] >= TAP_TARGET_PX and b["height"] >= TAP_TARGET_PX
            opener.focus()
            page.keyboard.press("Enter")
            sheet = page.get_by_role("dialog", name="Panel")
            eventually(page, lambda: sheet.is_visible(), "bottom sheet opens")
            assert sheet.bounding_box()["y"] >= size[1] * (1 - SHEET_MAX_SHARE) - PAN_TOL_PX
            for t in PHONE_TABS:
                tb = sheet.get_by_role("tab", name=t).bounding_box()
                assert tb["height"] >= TAP_TARGET_PX and tb["width"] >= TAP_TARGET_PX
            for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
                page.keyboard.press(key)
                assert focused(sheet), f"{key} left the bottom sheet"
            page.keyboard.press("Escape")
            eventually(page, lambda: focused(opener), "Escape returns focus to Panels")


BROKEN = (b'plotfold 1\nlayer "Walls" white Continuous 0.25 on thawed unlocked\nline L1 "Walls" 0 0 1 1\nline L2 "Walls" 0 0 10\n'
          b'circle C2 "Nope" 0 0 1\narc A3 "0" 0 0 x 0 90\nwidget 1 2\nend\nline L1 "0" 0 0 1 1\n'
          b'pline P4 "0" open 0 0 1\nattr TAG "v"\ninsert I5 "0" "Missing" 0 0 1 0\nblock "B" 0 0\n')
BROKEN_LINES = ['Line 4: line needs 4 numbers, got 3', 'Line 5: layer "Nope" is not defined', 'Line 6: "x" is not a number',
                'Line 7: unknown record "widget"', 'Line 8: end has no block', 'Line 9: handle L1 is used twice',
                'Line 10: pline needs an even count of at least 4 numbers, got 3', 'Line 11: attr has nothing to attach to',
                'Line 12: block "Missing" is not defined', 'Line 13: block "B" has no end']
MERGE = (b'plotfold 1\nlayer "Walls" white Continuous 0.25 on thawed unlocked\nlayer "Kerb" red Dashed 0.5 on thawed unlocked\n'
         b'line L1 "Walls" 0 0 10 0\nline L2 "Kerb" 0 5 10 5\ncircle C3 "0" 5 5 2\npline P4 "0" open 0 0 1 1\n')


def test_drawing_text_format(app_url: str) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "layers": [layer("Walls")]}, {"key": "e"}])
    c, did = w.client("a"), w.did()
    body = err(import_text(c, did, BROKEN), 422, "parse_failed")
    assert body["lines"] == BROKEN_LINES
    assert S3().get(f"imports/{did}/{sha(BROKEN)}.plot.txt") == BROKEN, "the file is stored byte for byte before parsing"
    err(import_text(c, did, b"plotfold 2\n"), 422, "wrong_type")
    r = import_text(c, did, MERGE)
    assert r.status_code == 201
    j = r.json()
    assert j["adds"] == {"entities": 4, "layers": 2, "blocks": 0} and j["renames"] == [{"from": "Walls", "to": "Walls (2)"}]
    w.ok("a", [{"type": "import_merge", "import_id": j["import_id"]}], command="IMPORT")
    e = w.ents("a")
    assert sorted(v["layer"] for v in e.values() if v["type"] == "line") == ["Kerb", "Walls (2)"]
    assert w.undo("a").json()["command"] == "IMPORT" and w.ents("a") == {}
    ce = w.client("a")
    imp = import_text(ce, w.did("e"), CANON).json()
    w.ok("a", [{"type": "import_merge", "import_id": imp["import_id"]}], key="e", command="IMPORT")
    job = ce.post(f"/api/drawings/{w.did('e')}/exports", json={"format": "plot.txt"}).json()["id"]
    j, _ = _run_export(app_url, ce, job, "ready")
    assert ce.get(j["download_url"]).content == CANON, "export of canonical input must give the same bytes"


def test_upload_checks(app_url: str) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    c, did = w.client("a"), w.did()
    over = b"GIF89a" + b"\0" * UNDERLAY_MAX
    err(upload(c, did, over), 413, "too_large")
    err(upload(c, did, b"GIF89a" + b"\0" * 64), 422, "wrong_type")
    a = png(UNDERLAY_MAX, b"a")
    r = upload(c, did, a)
    assert r.status_code == 201 and r.json()["key"] == f"underlays/{did}/{sha(a)}.png" and r.json()["bytes"] == UNDERLAY_MAX
    again = upload(c, did, a)
    assert again.status_code == 200 and again.json()["id"] == r.json()["id"]
    jpg = JPEG_SOI + b"b" + b"\0" * (UNDERLAY_MAX - 5)
    r = upload(c, did, jpg)
    assert r.status_code == 201 and r.json()["key"] == f"underlays/{did}/{sha(jpg)}.jpg"
    rest = png(QUOTA - 2 * UNDERLAY_MAX, b"c")
    assert upload(c, did, rest).status_code == 201, "exactly the quota is allowed"
    err(upload(c, did, b"GIF89a" + b"\0" * 64), 422, "wrong_type")
    extra = png(64, b"d")
    err(upload(c, did, extra), 409, "quota_exceeded")
    keys = S3().keys(f"underlays/{did}/")
    assert S3().get(f"underlays/{did}/{sha(a)}.png") == a and f"underlays/{did}/{sha(extra)}.png" not in keys
    assert len(keys) == 3
    head = b"plotfold 1\n"
    exact = head + b"#" * (TEXT_MAX - len(head) - 1) + b"\n"
    r = import_text(c, did, exact)
    assert r.status_code == 201 and r.json()["key"] == f"imports/{did}/{sha(exact)}.plot.txt"
    err(import_text(c, did, exact + b"#"), 413, "too_large")
    bad = b"plotfold 1\n\xff\xfe\n"
    err(import_text(c, did, bad), 422, "wrong_type")
    assert f"imports/{did}/{sha(bad)}.plot.txt" not in S3().keys(f"imports/{did}/")


def test_large_drawing_and_find(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "generate": {"lines": LARGE_LINES, "spacing": 2}}])
    e = w.ents("a")
    corner = [h for h, v in e.items() if near(v["x1"], 0) and near(v["y1"], 0)][0]
    last = max(e, key=hnum)
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}") as page:
        ready(page)
        box = drawing(page).bounding_box()
        page.request.post(app_url + "/api/grading/view", data={"drawing": did, "zoom": 2, "pan_x": box["width"] / 2 - 200,
                                                               "pan_y": box["height"] / 2})
        page.reload()
        ready(page)
        d = drawing(page)
        count = lambda: d.locator(ENTITY_ELEMENTS).count()
        assert attr(d, "data-total-entities") == str(LARGE_LINES) and count() <= DOM_CEILING
        assert page.get_by_role("grid", name="Entities").get_attribute("aria-rowcount") == str(LARGE_LINES)
        assert entity(page, corner).count() == 0, "the far corner entity has no element"
        aid(page, "Snap", True)
        page.mouse.move(*pane_point(page, box["width"] / 2 - 201, box["height"] / 2))
        eventually(page, lambda: attr(d, "data-snap-kind") == "endpoint" and attr(d, "data-snap-x") == "0", "snap off-page entity")
        page.mouse.wheel(0, 240)
        advance(page, STEP_MS)
        assert attr(d, "data-total-entities") == str(LARGE_LINES) and count() <= DOM_CEILING
        run(page, "FD")
        search = page.get_by_role("searchbox", name="Find text")
        eventually(page, lambda: focused(search), "FIND focuses Find text")
        search.fill(last.lower())
        page.get_by_role("button", name="Next match").click()
        says(page, page.get_by_role("status", name="Find count"), "1 of 1")
        eventually(page, lambda: attr(entity(page, last), "aria-selected") == "true", "match selected")
        b, pane = entity(page, last).bounding_box(), d.bounding_box()
        assert b["x"] >= pane["x"] + FIND_MARGIN_PX - PAN_TOL_PX and b["y"] >= pane["y"] + FIND_MARGIN_PX - PAN_TOL_PX
        assert count() <= DOM_CEILING + 1
        search.fill("0")
        page.get_by_role("button", name="Next match").click()
        says(page, page.get_by_role("status", name="Find count"), f"1 of {LARGE_LINES}")
        search.fill("nothing_here")
        says(page, page.get_by_role("status", name="Find count"), "No matches.")
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(cmd(page)), "Escape leaves Find to Command")


def _import_pick(page: Page, data: bytes, opening: Callable[[], None]) -> None:
    files = [{"name": "plan.plot.txt", "mimeType": "text/plain", "buffer": data}]
    page.once("filechooser", lambda chooser: chooser.set_files(files=files))
    if not page.evaluate("() => !!document.querySelector('dialog[open] input[type=file]')"):
        opening()
    advance(page, STEP_MS)
    field = page.evaluate_handle("() => document.querySelector('dialog[open] input[type=file]')").as_element()
    if field:
        field.set_input_files(files=files)


def _import_ui(page: Page, data: bytes) -> None:
    _import_pick(page, data, page.get_by_role("button", name="Import", exact=True).click)


def test_wf_import_large_drawing_happy(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "layers": [layer("Walls")], "generate": {"lines": LARGE_LINES, "spacing": 2}}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        _import_ui(page, BROKEN)
        dlg = page.get_by_role("dialog", name="Import preview")
        errors = dlg.get_by_role("list", name="Import errors").get_by_role("listitem")
        eventually(page, lambda: [" ".join(t.split()) for t in errors.all_inner_texts()] == BROKEN_LINES, "line errors listed")
        dlg.get_by_role("button", name="Cancel").click()
        _import_ui(page, MERGE)
        eventually(page, lambda: "Adds 4 entities, 2 layers, 0 blocks." in text(dlg), "merge preview")
        renamed = "Walls renamed Walls (2)"
        assert renamed in text(dlg)
        before = rev(page)
        dlg.get_by_role("button", name="Merge").click()
        committed(page, before)
        says(page, page.get_by_role("status", name="Storage notice"), "Imported 4 entities.", exact=False)
        assert len(w.ents("a")) == LARGE_LINES + 4
        cmd(page).focus()
        page.keyboard.press("Control+z")
        eventually(page, lambda: len(w.ents("a")) == LARGE_LINES, "one undo removes the merge")
        run(page, "FD")
        page.get_by_role("searchbox", name="Find text").fill("0")
        page.get_by_role("button", name="Next match").click()
        says(page, page.get_by_role("status", name="Find count"), f"1 of {LARGE_LINES}")
        assert len(selected(page)) == 1
    c = w.client("a")
    job = c.post(f"/api/drawings/{w.did()}/exports", json={"format": "plot.txt"}).json()["id"]
    j, _ = _run_export(app_url, c, job, "ready")
    text_out = c.get(j["download_url"]).content
    assert text_out.startswith(b"plotfold 1\n") and text_out.count(b"\nline ") == LARGE_LINES


def test_wf_import_large_drawing_outage(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}") as page:
        ready(page)
        try:
            storage(app_url, True)
            _import_ui(page, CANON)
            says(page, page.get_by_role("status", name="Storage notice"),
                 "File storage is unavailable. Nothing was added. Try again in a moment.", exact=False)
            assert f"imports/{did}/{sha(CANON)}.plot.txt" not in S3().keys(f"imports/{did}/")
        finally:
            storage(app_url, False)
        _import_ui(page, CANON)
        dlg = page.get_by_role("dialog", name="Import preview")
        eventually(page, lambda: "Adds 4 entities, 1 layers, 0 blocks." in text(dlg), "preview after recovery")
        before = rev(page)
        dlg.get_by_role("button", name="Merge").click()
        committed(page, before)
    assert len(w.ents("a")) == 4 and S3().get(f"imports/{did}/{sha(CANON)}.plot.txt") == CANON


def test_if_run_manifest(app_url: str) -> None:
    m = json.loads(Path("/app/run.json").read_text())
    assert m.get("_schema") == "run-manifest-v1"
    assert all(isinstance(m.get(k), str) and m[k] for k in ("install", "build", "serve"))
    assert httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT).status_code == 200


def test_if_third_party_notices() -> None:
    notes = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notes]
    assert not missing, f"packages missing from notices: {missing[:20]}"
    assert "Funnel Display" in notes and "Funnel Sans" in notes


def test_if_licences_allowed() -> None:
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad[:20]}"


def test_if_backing_services_only() -> None:
    banned = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "amqplib", "kafkajs",
              "nodemailer", "meilisearch", "@elastic/elasticsearch", "bullmq", "bull", "level", "lowdb", "nedb", "memcached"}
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & banned, f"extra backing-service clients shipped: {shipped & banned}"
    files = [p for p in Path(DEPLOYED_APP).rglob("*") if p.suffix in {".sqlite", ".sqlite3", ".db"} and "node_modules" not in p.parts]
    assert not files, f"embedded database files: {files[:5]}"


def test_if_compose_unchanged() -> None:
    path = Path("/logs/agent/trajectory.json")
    if not path.exists():
        return
    data = json.loads(path.read_text())
    hits: list[str] = []

    def walk(node: Any, tool: str = "") -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or tool)
            for k, v in node.items():
                if k in {"file_path", "path"} and isinstance(v, str) and re.search(r"compose[^/]*\.ya?ml$", v) \
                        and re.search(r"write|edit|replace|create", name, re.I):
                    hits.append(v)
                if k == "command" and isinstance(v, str) and re.search(r"(>>?|sed -i[^|;&]*|tee (-a )?)\s*\S*compose[^\s/]*\.ya?ml", v):
                    hits.append(v)
                walk(v, name)
        elif isinstance(node, list):
            for v in node:
                walk(v, tool)
    walk(data)
    assert not hits, f"compose files were changed: {hits[:5]}"


def test_if_no_external_origins(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    urls: list[str] = []
    with opened(browser, app_url, w["a"], "/") as page:
        page.on("request", lambda r: urls.append(r.url))
        page.reload()
        eventually(page, lambda: page.get_by_role("region", name="Sheet strip").count() == 1, "landing loads")
        page.goto(app_url + "/folders")
        page.goto(f"{app_url}/drawings/{w.did()}")
        ready(page)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not foreign, f"external requests: {foreign[:10]}"


def test_if_lockfile_used() -> None:
    assert Path("/app/package-lock.json").exists()
    assert "npm ci" in json.loads(Path("/app/run.json").read_text())["install"]


def refused_select(box: Locator, option: str) -> None:
    try:
        select(box, option)
    except AssertionError:
        pass


def page_rows(page: Page, label: str) -> int:
    return page.get_by_role("row", name=label, exact=True).count()


def test_wf_pointer_keys_list_and_watcher(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 0, 5, 6, 12)]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        aid(pa, "Ortho", False)
        aid(pa, "Polar", False)
        aid(pa, "Grid", False)
        cmd(pa).focus()
        aids = pa.get_by_role("group", name="Drafting aids")
        for key, name, sentence in [("F8", "Ortho", "Ortho on"), ("F10", "Polar", "Polar on")]:
            pa.keyboard.press(key)
            eventually(pa, lambda: aids.get_by_role("button", name=name).get_attribute("aria-pressed") == "true", f"{key} presses {name}")
            says(pa, announce(pa), sentence, exact=False)
            assert focused(cmd(pa)), f"{key} leaves focus unchanged"
        assert aids.get_by_role("button", name="Ortho").get_attribute("aria-pressed") == "false", "Polar turns Ortho off"
        pa.keyboard.press("F10")
        says(pa, announce(pa), "Polar off", exact=False)
        pa.keyboard.press("F9")
        says(pa, announce(pa), "Grid on", exact=False)
        pa.keyboard.press("F9")
        says(pa, announce(pa), "Grid off", exact=False)
        aid(pa, "Snap", False)
        drag(pa, screen(pa, -1, 14), screen(pa, 11, -1))
        eventually(pa, lambda: sorted(selected(pa)) == ["L1", "L2"], "window selects both")
        props = pa.get_by_role("region", name="Properties")
        says(pa, props, "*VARIES*", exact=False)
        pa.keyboard.down("Shift")
        drag(pa, screen(pa, -1, 14), screen(pa, 7, 4))
        pa.keyboard.up("Shift")
        eventually(pa, lambda: selected(pa) == ["L1"], "Shift with a window removes L2")
        eventually(pa, lambda: "*VARIES*" not in text(props) and "10" in text(props), "Properties shows L1's length")
        cmd(pa).focus()
        pa.keyboard.press("F6")
        eventually(pa, lambda: focused(drawing(pa)), "F6 reaches the drawing")
        before = rev(pa)
        pa.keyboard.press("ArrowRight")
        committed(pa, before)
        says(pa, announce(pa), "Moved 1 entity", exact=False)
        says(pb, announce(pb), f"{w['a']} moved L1", exact=False)
        before = rev(pa)
        pa.keyboard.press("Shift+ArrowUp")
        committed(pa, before)
        eventually(pb, lambda: attr(entity(pb, "L1"), "data-x1") == "1" and attr(entity(pb, "L1"), "data-y1") == "10", "B sees both nudges")
        assert focused(drawing(pa)), "a nudge leaves focus on the drawing"
        page_row(pb, "Line L1, layer 0, from 1,10 to 11,10, length 10")


def test_wf_modify_trim_undo_watched(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0), ln("L2", 5, -5, 5, 5)]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "TR", "L2", "", "8,0", "")
        committed(pa, before)
        says(pa, announce(pa), "Trim: 1 entity changed", exact=False)
        eventually(pb, lambda: attr(entity(pb, "L1"), "data-x2") == "5", "B sees the trim")
        page_row(pb, "Line L1, layer 0, from 0,0 to 5,0, length 5")
        assert focused(cmd(pa))
        pa.keyboard.press("Control+z")
        eventually(pb, lambda: attr(entity(pb, "L1"), "data-x2") == "10", "one undo restores the whole trim on B")
        pa.keyboard.press("Control+Shift+z")
        eventually(pb, lambda: attr(entity(pb, "L1"), "data-x2") == "5", "redo trims again on B")
        ready(pa)
        w.ok("b", [{"type": "move", "handles": ["L1"], "dx": 0, "dy": 3}], command="MOVE")
        eventually(pa, lambda: attr(entity(pa, "L1"), "data-y1") == "3", "A sees B's move")
        pa.keyboard.press("Control+z")
        eventually(pa, lambda: pa.get_by_text(f"Can't undo: {w['b']} changed L1 after you.").count() > 0, "skip text")
        assert attr(entity(pb, "L1"), "data-x2") == "5", "the skipped undo changes nothing"


def test_wf_layers_state_restore_live(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Walls", "red")], "layer_states": [{"name": "Plain"}],
                                                     "entities": [ln("L1", 0, 0, 10, 0, "Walls")]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        run(pa, "LA")
        grid = pa.get_by_role("grid", name="Layer list")
        eventually(pa, lambda: focused(grid), "LAYER moves focus into Layer list")
        grid.get_by_role("row").filter(has_text="Walls").get_by_role("button", name="Frozen").click()
        eventually(pb, lambda: entity(pb, "L1").count() == 0, "frozen on B")
        page_row(pb, "Line L1, layer Walls, from 0,0 to 10,0, length 10")
        pa.get_by_role("list", name="Layer states").get_by_role("button", name="Restore").click()
        eventually(pb, lambda: entity(pb, "L1").count() == 1 and attr(entity(pb, "L1"), "data-colour") == "red", "restored on B")
        ready(pa)
        assert w.undo("a").status_code == 200
        eventually(pb, lambda: entity(pb, "L1").count() == 0, "one undo re-freezes on B")
        eventually(pa, lambda: entity(pa, "L1").count() == 0, "one undo re-freezes on A")


def test_wf_layers_off_versus_frozen_hatch(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Edge")], "entities": [cir("C1", 0, 0, 2, "Edge")]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 300, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 300, 300)) as pb:
        ready(pa)
        ready(pb)
        row = pa.get_by_role("grid", name="Layer list").get_by_role("row").filter(has_text="Edge")
        row.get_by_role("button", name="Frozen").click()
        eventually(pb, lambda: entity(pb, "C1").count() == 0, "frozen on B")
        run(pa, "H", "0,0")
        prompt_is(pa, "No closed boundary around that point.")
        assert focused(cmd(pa))
        pa.keyboard.press("Escape")
        row.get_by_role("button", name="Frozen").click()
        eventually(pb, lambda: entity(pb, "C1").count() == 1, "thawed on B")
        row.get_by_role("button", name="On").click()
        eventually(pb, lambda: entity(pb, "C1").count() == 0, "off on B")
        aid(pa, "Snap", True)
        pa.mouse.move(*screen(pa, 0, 0))
        eventually(pa, lambda: attr(drawing(pa), "data-snap-kind") == "none", "snaps skip an off layer")
        before = rev(pa)
        run(pa, "H", "0,0")
        committed(pa, before)
        e = w.ents("a")
        h = next(k for k, v in e.items() if v["type"] == "hatch")
        page_row(pb, f"Hatch {h}, layer 0, area 12.566")
        assert near(attr(entity(pb, h), "data-area"), math.pi * 4)


def test_wf_blocks_keyboard_insert_explode(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "blocks": [
        {"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)], "attributes": [{"tag": "MARK", "default": "A1"}]}]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "I", "Door", "5,5", "2", "90")
        committed(pa, before)
        e = w.ents("a")
        h = next(k for k, v in e.items() if v["type"] == "insert")
        assert e[h]["attributes"].get("MARK") == "A1"
        label = f"Block {h}, layer 0, Door at 5,5, scale 2, rotation 90"
        page_row(pa, label)
        page_row(pb, label)
        assert focused(cmd(pa))
        before = rev(pa)
        run(pa, "X", h, "")
        committed(pa, before)
        says(pa, announce(pa), f"Exploded {h}: 1 entity added", exact=False)
        e = w.ents("a")
        new = next(k for k, v in e.items() if v["type"] == "line")
        assert h not in e
        page_row(pb, f"Line {new}, layer 0, from 5,5 to 5,7, length 2")
        assert w.undo("a").status_code == 200
        eventually(pb, lambda: page_rows(pb, label) == 1 and page_rows(pb, f"Line {new}, layer 0, from 5,5 to 5,7, length 2") == 0, "undo restores the insert")
    assert w.ents("a")[h]["attributes"].get("MARK") == "A1"


def test_wf_blocks_purge_refusal_and_undo(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 1, 0)], "blocks": [
        {"name": "Gate", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)], "attributes": []},
        {"name": "Post", "base": [0, 0], "entities": [ln("L51", 0, 0, 1, 1)], "attributes": []}]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "PU")
        committed(pa, before)
        prompt_is(pa, "Purged 2 blocks, 0 layers.")
        run(pa, "I", "Gate")
        prompt_is(pa, "No block named Gate.")
        cmd(pa).press("Escape")
        says(pa, prompt(pa), "Cancelled.")
        assert focused(cmd(pa))
        undone = w.undo("a")
        assert undone.status_code == 200
        ready(pa, undone.json()["revision"])
        eventually(pa, lambda: "Gate" in by_key(w.drawing("a")["blocks"], "name"), "undo restores the definitions")
        before = rev(pa)
        run(pa, "I", "Gate", "3,3", "", "")
        committed(pa, before)
        h = next(k for k, v in w.ents("a").items() if v["type"] == "insert")
        page_row(pb, f"Block {h}, layer 0, Gate at 3,3, scale 1, rotation 0")


def test_wf_dimension_after_concurrent_move_and_undo(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 20, 0, 30, 0),
        dim("D3", "linear", [{"handle": "L1", "point": "end"}, {"handle": "L2", "point": "start"}], 15, 2)]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        select_via_list(pa, "L2")
        pa.keyboard.press("Shift+F6")
        eventually(pa, lambda: focused(drawing(pa)), "Shift+F6 goes back to the drawing")
        before = rev(pa)
        pa.keyboard.press("ArrowRight")
        committed(pa, before)
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, "D3"), "data-value") == "11.00", "the value follows A's nudge")
        w.ok("b", [{"type": "move", "handles": ["L1"], "dx": 3, "dy": 0}], command="MOVE")
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, "D3"), "data-value") == "8.00", "the value follows B's move")
        cmd(pa).focus()
        pa.keyboard.press("Control+z")
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, "D3"), "data-value") == "7.00", "undo reverses only A's nudge")
            page_row(page, "Dimension D3, layer 0, linear, value 7.00")
        assert attr(entity(pb, "L1"), "data-x2") == "13" and attr(entity(pb, "L2"), "data-x1") == "20"
        assert attr(entity(pa, "D3"), "data-associative") == "true"


def test_wf_hatch_island_broken_boundary_undo(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        ln("L1", 0, 0, 10, 0), ln("L2", 10, 0, 10, 10), ln("L3", 10, 10, 0, 10), ln("L4", 0, 10, 0, 0),
        pl("P5", [[4, 4], [6, 4], [6, 6], [4, 6]], True)]}])
    made = w.ok("a", [add(hat("x", 1, 1))])
    assert made["results"][0]["handles"] == ["H6"], "next_handle is one more than the highest number used"
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        for page in (pa, pb):
            eventually(page, lambda: near(attr(entity(page, "H6"), "data-area"), 96), "outer area minus island")
        w.ok("b", [{"type": "modify", "handle": "P5", "set": {"points": [[4, 4], [7, 4], [7, 7], [4, 7]]}}], command="PROPERTIES")
        for page in (pa, pb):
            eventually(page, lambda: near(attr(entity(page, "H6"), "data-area"), 91), "area follows the island")
        page_row(pa, "Hatch H6, layer 0, area 91")
        select_via_list(pa, "L2")
        before = rev(pa)
        pa.keyboard.press("Delete")
        committed(pa, before)
        says(pa, notices(pa), "Hatch H6: boundary broken. It no longer follows its edges.", exact=False)
        assert focused(cmd(pa)), "Delete leaves focus in Command"
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, "H6"), "data-associative") == "false" and near(attr(entity(page, "H6"), "data-area"), 91), "last shape kept")
        pa.keyboard.press("Control+z")
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, "H6"), "data-associative") == "true" and entity(page, "L2").count() == 1, "undo restores the link")
            assert near(attr(entity(page, "H6"), "data-area"), 91)


def test_wf_constraints_equal_after_grip_drag(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 5, 0), ln("L2", 0, 5, 5, 5)],
                                                     "constraints": [{"kind": "fixed", "refs": [{"handle": "L2", "point": None}]},
                                                                     {"kind": "equal", "refs": [{"handle": "L1", "point": None},
                                                                                                 {"handle": "L2", "point": None}]}]}])
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 10, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        aid(pa, "Snap", False)
        pa.mouse.move(*screen(pa, 2.5, 0))
        pa.mouse.click(*screen(pa, 2.5, 0))
        grip = grip_at(pa, "end", 5, 0)
        eventually(pa, lambda: grip.count() == 1, "end grip shown")
        gb = grip.bounding_box()
        before = rev(pa)
        drag(pa, (gb["x"] + gb["width"] / 2, gb["y"] + gb["height"] / 2), screen(pa, 8, 0))
        committed(pa, before)

        def holds(page: Page) -> bool:
            l1, l2 = entity(page, "L1"), entity(page, "L2")
            xs = [float(attr(l1, n)) for n in ("data-x1", "data-y1", "data-x2", "data-y2")]
            return near(math.hypot(xs[2] - xs[0], xs[3] - xs[1]), 5, 2 * POINTER_TOL) and near(xs[2], 8, POINTER_TOL) and \
                attr(l2, "data-x1") == "0" and attr(l2, "data-x2") == "5" and attr(l2, "data-y1") == "5"
        eventually(pa, lambda: holds(pa), "A: constraints hold and the dragged point stays")
        eventually(pb, lambda: holds(pb), "B: the same result live")
    e = w.ents("a")
    assert near(math.hypot(float(e["L1"]["x2"]) - float(e["L1"]["x1"]), float(e["L1"]["y2"]) - float(e["L1"]["y1"])), 5, SOLVE_TOL)


def test_wf_constraints_typed_refusals_keep_state(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 3, 4)],
                                                     "parameters": [{"name": "d1", "expression": "5"}, {"name": "d2", "expression": "d1 * 2"}],
                                                     "constraints": [{"kind": "fixed", "refs": [{"handle": "L1", "point": None}]}]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        run(pa, "PM", "d1 = d2 + 1")
        eventually(pa, lambda: text(prompt(pa)) in ("Expression cycle: d1 -> d2 -> d1.", "Expression cycle: d2 -> d1 -> d2."), "cycle text")
        assert focused(cmd(pa))
        cmd(pa).press("Escape")
        run(pa, "CN", "horizontal", "L1")
        says(pa, prompt(pa), "Over-constrained:", exact=False)
        cmd(pa).press("Escape")
        for page in (pa, pb):
            assert attr(entity(page, "L1"), "data-x2") == "3" and attr(entity(page, "L1"), "data-y2") == "4"
        assert len(w.drawing("a")["constraints"]) == 1
        before = rev(pa)
        run(pa, "PM", "d1 = 7")
        committed(pa, before)
        says(pb, pb.get_by_role("grid", name="Parameter list"), "14", exact=False)


def test_wf_hatch_and_dimension_follow_parameter(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "entities": [
        cir("C1", 0, 0, 3), hat("H2", 0, 0), dim("D3", "radial", [{"handle": "C1", "point": "centre"}], 4, 4)],
        "parameters": [{"name": "d1", "expression": "3"}],
        "constraints": [{"kind": "radius", "refs": [{"handle": "C1", "point": None}], "expression": "d1"}]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "PM", "d1 = 4")
        committed(pa, before)
        for page in (pa, pb):
            eventually(page, lambda: near(attr(entity(page, "C1"), "data-r"), 4, SOLVE_TOL) and attr(entity(page, "D3"), "data-value") == "4.00" and
                       near(attr(entity(page, "H2"), "data-area"), math.pi * 16), "parameter edit reaches circle, dimension and hatch")
            page_row(page, "Hatch H2, layer 0, area 50.265")
        assert w.undo("a").status_code == 200
        for page in (pa, pb):
            eventually(page, lambda: attr(entity(page, "D3"), "data-value") == "3.00" and near(attr(entity(page, "H2"), "data-area"), math.pi * 9), "undo returns them")


def _xref_host(base: str) -> World:
    return build(base, {"a": "edit", "b": "edit"}, [
        {"key": "src", "layers": [layer("Walls")], "entities": [ln("L1", 0, 0, 10, 0, "Walls"), ln("L2", 0, 50, 10, 50, "Walls")],
         "sheets": [{"key": "ss", "name": SOURCE_SHEET, "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]},
        {"key": "d", "xrefs": [{"name": "Site", "source": "src", "x": 0, "y": 0, "scale": 1, "rotation": 0}]}])


def test_wf_xref_typed_attach_transform_rows(app_url: str, browser: Browser) -> None:
    w = _xref_world(app_url)
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        before = rev(pa)
        run(pa, "XA", w.names["src"], "Site", "5,5", "2", "90")
        committed(pa, before)
        for page in (pa, pb):
            page_row(page, "Line Site|L1, layer Site|Walls, from 5,5 to 5,25, length 20")
            page_row(page, "Line Site|L2, layer Site|Walls, from -95,5 to -95,25, length 20")
            says(page, page.get_by_role("grid", name="Layer list"), "Site|Walls", exact=False)
        assert focused(cmd(pa))
        assert w.undo("a").status_code == 200
        grid = pb.get_by_role("grid", name="Entities")
        eventually(pb, lambda: grid.get_attribute("aria-rowcount") == "0", "undo removes the xref rows on B")


def test_wf_xref_clip_undo_and_typed_bind(app_url: str, browser: Browser) -> None:
    w = _xref_host(app_url)
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 2, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 2, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        eventually(pa, lambda: xref_entities(pa, "Site").count() == 2, "both xref lines drawn")
        w.ok("b", [{"type": "xref_clip", "name": "Site", "rect": [-1, -1, 20, 20]}], command="XCLIP")
        eventually(pa, lambda: entity(pa, "Site|L2").count() == 0 and entity(pa, "Site|L1").count() == 1, "clip hides L2 on A")
        assert w.undo("b").status_code == 200
        eventually(pa, lambda: entity(pa, "Site|L2").count() == 1, "B's undo returns L2 on A")
        run(pa, "XB", "Nope")
        prompt_is(pa, "No xref named Nope.")
        cmd(pa).press("Escape")
        before = rev(pa)
        run(pa, "XB", "Site")
        committed(pa, before)
        for page in (pa, pb):
            says(page, page.get_by_role("grid", name="Layer list"), "Site$Walls", exact=False)
        assert "Site" in by_key(w.drawing("a")["blocks"], "name")
        assert any(v["type"] == "insert" and v["block"] == "Site" for v in w.ents("a").values())


def test_wf_xref_reload_notice_both_and_undo(app_url: str, browser: Browser) -> None:
    w = _xref_host(app_url)
    did = w.did()
    w.ok("a", [add(ln("x", 0, 20, 5, 20, "Walls"))], key="src")
    with opened(browser, app_url, w["a"], f"/drawings/{did}", view=(did, 2, 100, 300)) as pa, \
            opened(browser, app_url, w["b"], f"/drawings/{did}", view=(did, 2, 100, 300)) as pb:
        ready(pa)
        ready(pb)
        assert w.client("a").post(f"/api/sheets/{w.sheet('ss')}/versions", json={}).status_code == 201
        for page in (pa, pb):
            says(page, page.get_by_role("status", name="Xref notice"), "Site has a new version. Reload?", exact=False)
            assert xref_entities(page, "Site").count() == 2, "nothing changes before the reload"
        before = rev(pa)
        pa.get_by_role("region", name="Xrefs").get_by_role("button", name="Reload").first.click()
        committed(pa, before)
        for page in (pa, pb):
            eventually(page, lambda: xref_entities(page, "Site").count() == 3, "reload updates both")
        assert w.undo("a").status_code == 200
        eventually(pb, lambda: xref_entities(pb, "Site").count() == 2, "one undo reverses the reload on B")


def test_wf_export_dialog_keyboard_outage_retry(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "entities": [ln("L1", 0, 0, 10, 0)]}])
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        opener = page.get_by_role("button", name="Export", exact=True)
        opener.focus()
        page.keyboard.press("Enter")
        dlg = page.get_by_role("dialog", name="Export")
        eventually(page, lambda: dlg.count() == 1, "Export dialog opens from the keyboard")
        for _ in range(6):
            page.keyboard.press("Tab")
            assert focused(dlg), "Tab stays inside the dialog"
        dlg.get_by_role("radio", name="Plotfold text").check()
        try:
            storage(app_url, True)
            start = dlg.get_by_role("button", name="Start export")
            start.focus()
            page.keyboard.press("Enter")
            says(page, page.get_by_text("Export failed: file storage is unavailable.").first, "Export failed: file storage is unavailable.")
            bar = dlg.get_by_role("progressbar", name="Export")
            if bar.count():
                assert int(float(bar.first.evaluate("e => e.getAttribute('aria-valuenow') ?? String(e.value)"))) == FAILED_AT
            r = w.ops("a", [add(ln("x", 0, 5, 5, 5))])
            assert r.status_code == 200, "drawing keeps working during an outage"
        finally:
            storage(app_url, False)
        dlg.get_by_role("button", name="Retry export").click()
        eventually(page, lambda: dlg.get_by_role("link", name="Download export").count() == 1, "retry reaches ready")
        says(page, page.get_by_role("status", name="Storage notice"), "Export ready.", exact=False)
        if bar.count():
            assert int(float(bar.first.evaluate("e => e.getAttribute('aria-valuenow') ?? String(e.value)"))) == DONE
        page.keyboard.press("Escape")
        eventually(page, lambda: dlg.count() == 0 and focused(opener), "Escape returns focus to the opener")


def test_wf_offline_undo_queue_and_deleted_layer(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Temp")], "entities": [ln("L1", 0, 0, 10, 0)]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        select(pa.get_by_role("combobox", name="Current layer"), "Temp")
        status = pa.get_by_role("status", name="Connection")
        says(pa, status, "Live")
        pa.get_by_role("switch", name="Work offline").click()
        says(pa, status, "You're working offline. 0 changes waiting.")
        run(pa, "L", "1,1", "2,2", "")
        says(pa, status, "You're working offline. 1 change waiting.")
        run(pa, "L", "3,3", "4,4", "")
        says(pa, status, "You're working offline. 2 changes waiting.")
        cmd(pa).focus()
        pa.keyboard.press("Control+z")
        says(pa, status, "You're working offline. 1 change waiting.")
        w.ok("b", [{"type": "layer_delete", "name": "Temp"}], command="LAYER")
        pa.get_by_role("switch", name="Work offline").click()
        says(pa, status, "Back online: 1 change sent, 1 conflict.")
        says(pa, notices(pa), f"{w['b']} deleted layer Temp. Your entity is on layer 0.", exact=False)
        e = w.ents("b")
        lines = [k for k in e if k != "L1"]
        assert len(lines) == 1, f"one line survives offline undo, got {lines}"
        page_row(pb, f"Line {lines[0]}, layer 0, from 1,1 to 2,2, length 1.414")


def test_wf_compare_counts_block_and_xref_flag_void(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "m": "manage", "r": "markup"}, [
        {"key": "src", "layers": [layer("Walls")], "entities": [ln("L1", 0, 0, 10, 0, "Walls")],
         "sheets": [{"key": "ss", "name": SOURCE_SHEET, "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]},
        {"key": "d", "blocks": [{"name": "Door", "base": [0, 0], "entities": [ln("L50", 0, 0, 1, 0)], "attributes": []}],
         "entities": [ln("L1", 200, 0, 210, 0), ins("I4", "Door", 50, 0)],
         "xrefs": [{"name": "Site", "source": "src", "x": 0, "y": 0, "scale": 1, "rotation": 0}],
         "sheets": [{"key": "s", "name": "Plot plan", "size": "A3", "locked": False, "attributes": {}, "viewports": [], "publish": 1}]}])
    v1, rc, ac = w.version("s", 1), w.client("r"), w.client("a")
    for kind, box in [("cloud", (49, -1, 52, 1)), ("text", (500, 500, 501, 501))]:
        r = rc.post(f"/api/versions/{v1}/markups", json={"kind": kind, "x1": box[0], "y1": box[1], "x2": box[2], "y2": box[3], "text": "Check kerb"})
        assert r.status_code == 201
    assert ac.post(f"/api/versions/{v1}/review", json={}).status_code == 201
    w.ok("a", [add(ln("x", 0, 20, 5, 20, "Walls"))], key="src")
    assert ac.post(f"/api/sheets/{w.sheet('ss')}/versions", json={}).status_code == 201
    w.ok("a", [{"type": "xref_reload", "name": "Site"}], command="XRELOAD")
    fresh = w.ok("a", [add(ln("x", 300, 300, 302, 300))])["results"][0]["handles"][0]
    w.ok("a", [{"type": "block_define", "name": "Door", "base": [300, 300], "handles": [fresh], "attributes": []}])
    _drop_new_inserts(w)
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as pa, opened(browser, app_url, w["r"], f"/versions/{v1}") as pr:
        ready(pa)
        pa.get_by_role("tablist", name="Layouts").get_by_role("tab", name="Plot plan").click()
        publish = pa.get_by_role("button", name="Publish sheet")
        publish.focus()
        pa.keyboard.press("Enter")
        says(pa, pa.get_by_role("status", name="Storage notice"), "Published version 2.", exact=False)
        pa.get_by_role("button", name="Compare").click()
        says(pa, pa.get_by_role("status", name="Compare counts"), "Added 1, removed 0, changed 1")
        err(rc.post(f"/api/versions/{v1}/review/markup/approve", json={"comment": "late"}), 409, "review_voided",
            "Review voided: version 2 replaced this one.")
    v2 = rc.get(f"/api/sheets/{w.sheet()}/versions").json()["versions"][-1]["id"]
    with opened(browser, app_url, w["r"], f"/versions/{v2}") as pr2:
        eventually(pr2, lambda: pr2.locator('[data-flag="geometry-changed"]').count() >= 1, "the cloud over the insert is flagged")
    flags = {m["kind"]: m["flag"] for m in rc.get(f"/api/versions/{v2}/markups").json()["markups"]}
    assert flags == {"cloud": "geometry-changed", "text": None}, flags


def test_wf_import_keyboard_preview_two_people(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "layers": [layer("Walls")]}])
    path = f"/drawings/{w.did()}"
    with opened(browser, app_url, w["a"], path) as pa, opened(browser, app_url, w["b"], path) as pb:
        ready(pa)
        ready(pb)
        opener = pa.get_by_role("button", name="Import", exact=True)
        opener.focus()
        _import_pick(pa, MERGE, lambda: pa.keyboard.press("Enter"))
        dlg = pa.get_by_role("dialog", name="Import preview")
        eventually(pa, lambda: "Adds 4 entities, 2 layers, 0 blocks." in text(dlg), "preview")
        for _ in range(4):
            pa.keyboard.press("Tab")
            assert focused(dlg), "Tab stays inside the preview"
        pa.keyboard.press("Escape")
        eventually(pa, lambda: dlg.count() == 0 and focused(opener), "Escape returns focus to Import")
        assert attr(drawing(pb), "data-total-entities") == "0"
        _import_ui(pa, MERGE)
        before = rev(pa)
        dlg.get_by_role("button", name="Merge").click()
        committed(pa, before)
        eventually(pb, lambda: attr(drawing(pb), "data-total-entities") == "4" and
                   pb.get_by_role("grid", name="Entities").get_attribute("aria-rowcount") == "4", "merge is live on B")
        assert w.undo("a").status_code == 200
        eventually(pb, lambda: attr(drawing(pb), "data-total-entities") == "0", "one undo removes the merge on B")


def test_wf_large_entity_list_screen_reader(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d", "generate": {"lines": LARGE_LINES, "spacing": 2}}])
    e = w.ents("a")
    order = sorted(e, key=hnum)
    with opened(browser, app_url, w["a"], f"/drawings/{w.did()}") as page:
        ready(page)
        d, grid = drawing(page), page.get_by_role("grid", name="Entities")
        assert grid.get_attribute("aria-rowcount") == str(LARGE_LINES)
        to_entities(page)
        third = order[2]
        select_via_list(page, third)
        v = e[third]
        row = page.get_by_role("row", name=f"Line {third}, layer 0, from {v['x1']:g},{v['y1']:g} to {v['x2']:g},{v['y2']:g}, length 1", exact=True)
        eventually(page, lambda: row.count() == 1, "the third row has its label")
        assert row.get_attribute("aria-rowindex") == "3"
        page.keyboard.press("Enter")
        eventually(page, lambda: entity(page, third).count() == 1, "Enter pans to the entity")
        assert focused(grid)
        pane = d.bounding_box()
        page.mouse.move(pane["x"] + pane["width"] / 2, pane["y"] + pane["height"] / 2)
        for _ in range(3):
            page.mouse.wheel(0, 240)
            advance(page, STEP_MS)
            assert d.locator(ENTITY_ELEMENTS).count() <= DOM_CEILING + 1, "ceiling plus the selected entity"
            assert attr(d, "data-total-entities") == str(LARGE_LINES)
        assert entity(page, third).count() == 1, "a selected entity keeps its element"


def test_wf_large_remote_edit_off_screen_snap_find(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit", "b": "edit"}, [{"key": "d", "generate": {"lines": LARGE_LINES, "spacing": 2}}])
    e = w.ents("a")
    corner = [h for h, v in e.items() if near(v["x1"], 0) and near(v["y1"], 0)][0]
    did = w.did()
    with opened(browser, app_url, w["a"], f"/drawings/{did}") as page:
        ready(page)
        box = drawing(page).bounding_box()
        r = page.request.post(app_url + "/api/grading/view", data={"drawing": did, "zoom": 2, "pan_x": box["width"] / 2 - 200, "pan_y": box["height"] / 2})
        assert r.status == 204
        page.reload()
        ready(page)
        d = drawing(page)
        assert entity(page, corner).count() == 0, "the corner entity has no element"
        aid(page, "Snap", True)
        target = pane_point(page, box["width"] / 2 - 200, box["height"] / 2 + 6)
        page.mouse.move(*target)
        before = rev(page)
        w.ok("b", [{"type": "move", "handles": [corner], "dx": 0, "dy": -3}], command="MOVE")
        ready(page, before + 1)
        assert attr(d, "data-total-entities") == str(LARGE_LINES)
        page.mouse.move(target[0] + 2, target[1])
        page.mouse.move(*target)
        eventually(page, lambda: attr(d, "data-snap-kind") == "endpoint" and attr(d, "data-snap-x") == "0" and attr(d, "data-snap-y") == "-3", "snap uses the remote move")
        run(page, "FD")
        search = page.get_by_role("searchbox", name="Find text")
        eventually(page, lambda: focused(search), "FIND focuses Find text")
        search.fill(corner.lower())
        page.get_by_role("button", name="Next match").click()
        says(page, page.get_by_role("status", name="Find count"), "1 of 1")
        eventually(page, lambda: attr(entity(page, corner), "aria-selected") == "true" and attr(entity(page, corner), "data-y1") == "-3", "Find reaches the moved entity")
        page.keyboard.press("Escape")
        eventually(page, lambda: focused(cmd(page)), "Escape leaves Find to Command")


def test_accounts_keyboard_refusals_and_hidden_drawing(app_url: str, browser: Browser) -> None:
    w = build(app_url, {"a": "edit"}, [{"key": "d"}])
    name = uname("k")
    with opened(browser, app_url, None, "/register") as page:
        user = page.get_by_role("textbox", name="Username")
        eventually(page, lambda: user.count() == 1, "register form")
        user.focus()
        page.keyboard.type("A!")
        page.keyboard.press("Tab")
        page.keyboard.type(PASSWORD)
        page.keyboard.press("Enter")
        eventually(page, lambda: page.get_by_text("Use 3 to 24 lower-case letters, digits or underscores.").count() > 0, "bad username text")
        user.fill(w["a"])
        user.press("Enter")
        eventually(page, lambda: page.get_by_text("That username is taken.").count() > 0, "taken text")
        user.fill(name)
        user.press("Enter")
        eventually(page, lambda: any(c["name"] == "plot_session" and c["httpOnly"] for c in page.context.cookies()),
                   "signed in with an HttpOnly plot_session")
        page.goto(f"{app_url}/drawings/{w.did()}")
        eventually(page, lambda: page.get_by_text("We couldn't find that page.").count() > 0, "a drawing with no role does not exist")
        assert drawing(page).count() == 0
