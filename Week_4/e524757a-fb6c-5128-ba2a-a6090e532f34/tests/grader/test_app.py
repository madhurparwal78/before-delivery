from __future__ import annotations

import json
import os
import re
import struct
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import base64

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import (
    Mailpit,
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    axe,
    capture,
    center,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    post_json,
    same_origin,
    session,
    shipped_packages,
    tab_order,
    text,
)

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}
VIEWPORTS = {"phone": PHONE, "tablet": TABLET, "desktop": DESKTOP}
LAYOUT_CASES = ["phone", "tablet", "desktop"]
REWRITE_CASES = ["water_tile", "old_tick", "far_camera"]

TARGET_PX = 44
SIDE_SHEET_PX = 360
PANEL_SHARE = 0.4
FIGURE_MS = 600
FIGURE_MID_MS = 300
SHEET_MS = 334
STEP_MS = 100
HOLD_MS = 400
FILTER_MS = 250
LIVE_MS = 2000
CAMERA_GLIDE_MS = 320
GUIDE_DRAW_MS = 180
SHUTTER_MS = 210
STRETCH_MS = 600
GRACE_TICKS = 31
PHOTO_LIMIT = 2000000
PHOTO_LIMIT_SHORT = 200000
JSON_LIMIT = 64000
SEAT_MIN_SECONDS = 3
SEAT_MAX_SECONDS = 6
POSTCARD_WINDOW_SHORT = 30
DAY_TICKS = 14400

READY_SECONDS = 45
POLL_SECONDS = 15
RESULT_MS = 60000
HTTP_TIMEOUT = 30
SLICE_MS = 20
FUTURE_YEAR = 2041
FAR_ZONE = "Pacific/Auckland"
WRONG_CODE = "QQQQQZ"

SHOT_SPY = r"""
(() => {
  if (window.__shots) return;
  const spy = window.__shots = {overrides: null, sent: []};
  const asText = async value => typeof value === 'string' ? value : await value.text();
  const asBase64 = async blob => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  };
  const prepare = async form => {
    const pose = JSON.parse(await asText(form.get('pose')));
    const change = spy.overrides;
    if (change) {
      if (change.tile) pose.tile = change.tile;
      if (change.tickDelta) pose.tick += change.tickDelta;
      if (change.cameraOffset) pose.camera = [pose.tile[0] + change.cameraOffset[0], pose.tile[1] + change.cameraOffset[1]];
      if (change.extra) Object.assign(pose, change.extra);
      form.set('pose', JSON.stringify(pose));
    }
    const image = form.get('image');
    spy.sent.push({pose, image: await asBase64(image)});
  };
  const isPhoto = url => new URL(url, location.href).pathname === '/api/photos';
  const nativeFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : (input.url || String(input));
    if (init && init.body instanceof FormData && isPhoto(url)) await prepare(init.body);
    return nativeFetch.call(this, input, init);
  };
  const nativeOpen = XMLHttpRequest.prototype.open;
  const nativeSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__url = String(url);
    return nativeOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    if (body instanceof FormData && isPhoto(this.__url)) {
      prepare(body).then(() => nativeSend.call(this, body));
      return undefined;
    }
    return nativeSend.call(this, body);
  };
})();
"""

AUDIO_SPY = r"""
(() => {
  const spy = window.__audio = {contexts: [], gains: [], sources: [], started: [], edges: [], last: new Map()};
  const wrapClass = (name, list) => {
    const Native = window[name];
    if (!Native) return;
    window[name] = new Proxy(Native, {construct(target, args, next) {
      const made = Reflect.construct(target, args, next);
      list.push(made);
      return made;
    }});
  };
  wrapClass('AudioContext', spy.contexts);
  wrapClass('webkitAudioContext', spy.contexts);
  wrapClass('GainNode', spy.gains);
  wrapClass('AudioBufferSourceNode', spy.sources);
  const base = BaseAudioContext.prototype;
  const createGain = base.createGain;
  base.createGain = function () { const made = createGain.call(this); spy.gains.push(made); return made; };
  const createSource = base.createBufferSource;
  base.createBufferSource = function () { const made = createSource.call(this); spy.sources.push(made); return made; };
  const start = AudioBufferSourceNode.prototype.start;
  AudioBufferSourceNode.prototype.start = function (...args) { spy.started.push(this); return start.apply(this, args); };
  const connect = AudioNode.prototype.connect;
  AudioNode.prototype.connect = function (target, ...rest) { spy.edges.push([this, target]); return connect.call(this, target, ...rest); };
  for (const method of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
    const native = AudioParam.prototype[method];
    AudioParam.prototype[method] = function (value, ...rest) { spy.last.set(this, value); return native.call(this, value, ...rest); };
  }
  const valueOf = param => spy.last.has(param) ? spy.last.get(param) : param.value;
  const descriptor = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
  Object.defineProperty(AudioParam.prototype, 'value', {
    get() { return descriptor.get.call(this); },
    set(next) { spy.last.delete(this); descriptor.set.call(this, next); },
  });
  window.__audioReport = () => {
    const masters = spy.gains.filter(gain => spy.edges.some(([from, to]) => from === gain && to instanceof AudioDestinationNode));
    const master = masters[0];
    const feeding = master ? spy.gains.filter(gain => spy.edges.some(([from, to]) => from === gain && to === master)) : [];
    return {
      contexts: spy.contexts.length,
      gains: spy.gains.length,
      sources: spy.sources.length,
      looping: spy.started.filter(node => node.loop).length,
      masters: masters.length,
      master: master ? valueOf(master.gain) : null,
      feeding: feeding.map(gain => valueOf(gain.gain)),
    };
  };
})();
"""

SEED_CREATURES = [
    (1, "mossback-newt", "Mossback newt", 1, "always", (12, 6, "S")),
    (1, "reedpipe-heron", "Reedpipe heron", 2, "always", (6, 16, 10, 16, 10)),
    (1, "gloamfin-moth", "Gloamfin moth", 1, "dusk only", (18, 12, "W")),
    (1, "puddle-lark", "Puddle lark", 1, "rain only", (4, 4, 4, 9, 5)),
    (2, "bracken-hare", "Bracken hare", 1, "always", (8, 8, 14, 8, 6)),
    (2, "mossfern-stag", "Mossfern stag", 3, "always", (12, 13, 12, 18, 8)),
    (2, "lantern-toad", "Lantern toad", 1, "dusk only", (16, 12, "W")),
    (2, "drizzle-snail", "Drizzle snail", 1, "rain only", (20, 6, "S")),
    (3, "glasswing-crab", "Glasswing crab", 1, "always", (3, 6, 9, 6, 6)),
    (3, "tidewhistle-otter", "Tidewhistle otter", 2, "always", (15, 16, 20, 16, 8)),
    (3, "duskshell-snipe", "Duskshell snipe", 1, "dusk only", (6, 12, "E")),
    (3, "rainbead-gecko", "Rainbead gecko", 1, "rain only", (15, 3, 15, 8, 5)),
    (4, "cragtail-goat", "Cragtail goat", 2, "always", (8, 14, 8, 20, 10)),
    (4, "fell-mouse", "Fell mouse", 1, "always", (15, 4, 20, 4, 4)),
    (4, "mistcrown-owl", "Mistcrown owl", 2, "dusk only", (14, 8, "S")),
    (4, "cloudpuff-vole", "Cloudpuff vole", 1, "rain only", (6, 4, "E")),
    (5, "beacon-gull", "Beacon gull", 2, "always", (12, 20, 18, 20, 6)),
    (5, "shingle-plover", "Shingle plover", 1, "always", (4, 12, 4, 18, 5)),
    (5, "wickwing-bat", "Wickwing bat", 1, "dusk only", (8, 8, "S")),
    (5, "sleetfoot-fox", "Sleetfoot fox", 2, "rain only", (13, 4, 13, 10, 8)),
]
ISLANDS = ["Saltmarsh Harbour", "Fernhollow", "Driftglass Reef", "Mistcrown Fells", "Lantern Point"]

EXAMPLES = {
    1: dict(tick=6000, tile=[12, 10], heading="N", zoom=2, focus=4, creature="mossback-newt", score=(30, 25, 25, 20, 100)),
    2: dict(tick=6000, tile=[12, 10], heading="N", zoom=1, focus=2, creature="mossback-newt", score=(10, 25, 25, 10, 70)),
    3: dict(tick=6000, tile=[13, 10], heading="N", zoom=2, focus=8, creature="mossback-newt", score=(30, 5, 25, 0, 60)),
    4: dict(tick=6030, tile=[8, 20], heading="N", zoom=1, focus=4, creature="reedpipe-heron", score=(30, 15, 15, 20, 80)),
    5: dict(tick=11000, tile=[20, 12], heading="W", zoom=1, focus=2, creature="gloamfin-moth", score=(30, 25, 0, 20, 75)),
}
NEWT_NAME = "Mossback newt"
NEWT_100 = "Mossback newt: 100 points. Size 30, centring 25, facing 25, sharpness 20."


def make_png() -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))

    raw = b"\x00\xff\x00\x00" * 1
    return (
        b"\x89PNG\r\n\x1a\n"
        + chunk(b"IHDR", struct.pack(">IIBBBBB", 1, 1, 8, 2, 0, 0, 0))
        + chunk(b"IDAT", zlib.compress(raw))
        + chunk(b"IEND", b"")
    )


PNG = make_png()


def sized_png(size: int) -> bytes:
    return PNG + b"\x00" * (size - len(PNG))


def storage_down_url() -> str:
    return os.environ["APP_STORAGE_DOWN_URL"].rstrip("/")


def short_limits_url() -> str:
    return os.environ["APP_SHORT_LIMITS_URL"].rstrip("/")


def fresh_email() -> str:
    return f"grandparent-{uuid.uuid4().hex}@example.test"


def sql_text(value: str) -> str:
    return "'" + str(value).replace("'", "''") + "'"


def poll(check: Callable[[], Any], what: str, seconds: float = POLL_SECONDS) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
    pytest.fail(f"expected within {seconds} s: {what}")


def new_world(base: str, tick: int | None = None) -> dict[str, Any]:
    response = post_json(base, "/api/grading/world", {} if tick is None else {"tick": tick})
    assert response.status_code == 201, response.text
    return response.json()


def set_tick(base: str, world: dict[str, Any], tick: int) -> None:
    response = post_json(base, "/api/grading/clock", {"world": world["world"]["id"], "tick": tick})
    assert response.status_code == 200, response.text
    assert response.json()["tick"] == tick


class Api:

    def __init__(self, base: str, who: dict[str, Any] | None = None) -> None:
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        if who:
            response = self.http.post("/api/session", json={"email": who["email"], "password": who["password"]})
            assert response.status_code == 200, response.text

    def get(self, path: str) -> httpx.Response:
        return self.http.get(path)

    def post(self, path: str, body: Any = None, **headers: str) -> httpx.Response:
        return self.http.post(path, json={} if body is None else body, headers={k.replace("_", "-"): v for k, v in headers.items()})

    def put(self, path: str, body: Any = None) -> httpx.Response:
        return self.http.put(path, json={} if body is None else body)

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)

    def photo(self, pose: dict[str, Any], key: str | None = None, image: bytes = PNG) -> httpx.Response:
        headers = {"Shot-Key": key} if key else {}
        return self.http.post(
            "/api/photos",
            files={"image": ("photo.png", image, "image/png")},
            data={"pose": json.dumps(pose)},
            headers=headers,
        )


def make_pose(tile: list[int], heading: str, zoom: int, focus: int, tick: int, island: int = 1) -> dict[str, Any]:
    return {"island": island, "tile": tile, "camera": tile, "heading": heading, "zoom": zoom, "focus": focus, "tick": tick}


def example_pose(number: int) -> dict[str, Any]:
    example = EXAMPLES[number]
    return make_pose(example["tile"], example["heading"], example["zoom"], example["focus"], example["tick"])


def low_pose(tick: int = 6000) -> dict[str, Any]:
    return make_pose([12, 12], "N", 1, 16, tick)


def assert_error(response: httpx.Response, status: int, code: str, message: str | None = None) -> None:
    assert response.status_code == status, response.text
    body = response.json()
    assert body["error"] == code
    if message is not None:
        assert body["message"] == message


def photo_id(value: Any) -> str:
    return value["id"] if isinstance(value, dict) else value


def sign_in(page: Page, base: str, who: dict[str, Any], light: bool = True) -> None:
    response = page.context.request.post(f"{base}/api/session", data={"email": who["email"], "password": who["password"]})
    assert response.status == 200, response.text()
    if light:
        saved = page.context.request.put(f"{base}/api/me/settings", data={"music": 60, "effects": 80, "graphics": "light"})
        assert saved.status == 200, saved.text()


@contextmanager
def visit(browser: Any, base: str, who: dict[str, Any] | None, path: str, *, viewport: dict[str, int] = DESKTOP, light: bool = True, **options: Any) -> Iterator[Page]:
    with open_app(browser, f"{base}/signin", **options) as page:
        page.context.add_init_script(SHOT_SPY)
        page.set_viewport_size(viewport)
        if who:
            sign_in(page, base, who, light)
        page.goto(f"{base}{path}")
        yield page


@contextmanager
def play(browser: Any, base: str, who: dict[str, Any], path: str = "/play", **options: Any) -> Iterator[Page]:
    with visit(browser, base, who, path, **options) as page:
        ready(page)
        yield page


def make_coarse(page: Page) -> None:
    session(page).send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})


@contextmanager
def phone(browser: Any, base: str, who: dict[str, Any], path: str = "/play") -> Iterator[Page]:
    with open_app(browser, f"{base}/signin") as page:
        page.context.add_init_script(SHOT_SPY)
        page.set_viewport_size(PHONE)
        make_coarse(page)
        sign_in(page, base, who)
        page.goto(f"{base}{path}")
        ready(page)
        yield page


def open_tab(page: Page, base: str, path: str = "/play", wait_ready: bool = True) -> Page:
    tab = page.context.new_page()
    tab.set_viewport_size(DESKTOP)
    tab.goto(f"{base}{path}")
    if wait_ready:
        ready(tab)
    return tab


def view(page: Page) -> Locator:
    return page.get_by_role("application", name="World view", exact=True)


def button(page: Any, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def region(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def result_dialog(page: Page) -> Locator:
    return page.get_by_role("dialog", name="Photo result", exact=True)


def figure(scope: Any, name: str) -> Locator:
    return scope.locator(f'[data-figure="{name}"]:visible').first


def ready(page: Page, target: Locator | None = None) -> None:
    target = target if target is not None else view(page)
    deadline = time.monotonic() + READY_SECONDS
    while time.monotonic() < deadline:
        advance(page, STEP_MS)
        if target.count() and target.first.get_attribute("data-state") == "ready":
            return
    pytest.fail("the scene reached data-state=\"ready\" (L222, L772)")


def hooks(target: Locator) -> dict[str, str]:
    return target.evaluate("el => ({...el.dataset})")


def next_step(page: Page, target: Locator | None = None) -> dict[str, str]:
    target = target if target is not None else view(page)
    before = int(target.get_attribute("data-step"))
    for _ in range(STEP_MS // SLICE_MS + 3):
        advance(page, SLICE_MS)
        now = int(target.get_attribute("data-step"))
        if now > before:
            assert now == before + 1, "one data-step per 100 ms of page time (L247)"
            return hooks(target)
    pytest.fail("data-step advanced within one step of page time (L206, L247)")


def hold(page: Page, key: str, ms: int = HOLD_MS) -> None:
    page.keyboard.down(key)
    advance(page, ms)
    page.keyboard.up(key)
    advance(page, SLICE_MS)


def game_focus(page: Page) -> Locator:
    target = view(page)
    target.focus()
    return target


def is_photo_post(response: Any) -> bool:
    return response.request.method == "POST" and urlparse(response.url).path == "/api/photos"


def shoot(page: Page, action: Callable[[], None] | None = None) -> Any:
    with page.expect_response(is_photo_post, timeout=RESULT_MS) as info:
        if action:
            action()
        else:
            page.keyboard.press("Enter")
    return info.value


def keyboard_photo(page: Page, zoom_presses: int = 1, focus_presses: int = 0) -> Any:
    game_focus(page)
    page.keyboard.press("c")
    for _ in range(zoom_presses):
        page.keyboard.press("+")
    for _ in range(focus_presses):
        page.keyboard.press("f")
    return shoot(page)


def expect_result(page: Page) -> Locator:
    dialog = result_dialog(page)
    expect(dialog).to_be_visible(timeout=RESULT_MS)
    return dialog


def mark_page(page: Page) -> None:
    page.evaluate("window.__noReload = true")


def assert_no_reload(page: Page) -> None:
    assert page.evaluate("window.__noReload === true"), "the page reloaded during a live change (L251)"


def pin_focus(page: Page) -> None:
    page.evaluate("window.__pinned = document.activeElement")


def assert_focus_kept(page: Page) -> None:
    assert page.evaluate("document.activeElement === window.__pinned"), "a live change moved focus (L251)"


def wraps_inside(page: Page, container: Locator, presses: int = 8) -> None:
    for key in ("Tab", "Shift+Tab"):
        for _ in range(presses):
            page.keyboard.press(key)
            assert container.evaluate("el => el.contains(document.activeElement)"), f"{key} left the open dialog (L291)"


def rows_for(player_id: str) -> list[dict[str, Any]]:
    return Postgres().rows(f"SELECT id::text AS id, creature_id::text AS creature_id, total FROM photos WHERE player_id::text = {sql_text(player_id)}")


def ledger_sum(player_id: str) -> int:
    rows = Postgres().rows(f"SELECT COALESCE(SUM(amount), 0)::int AS film FROM film_ledger WHERE player_id::text = {sql_text(player_id)} AND account = 'satchel'")
    return rows[0]["film"]


def assert_pairs(player_id: str) -> None:
    rows = Postgres().rows(
        "SELECT change_id::text AS change_id, COUNT(*)::int AS n, SUM(amount)::int AS total, COUNT(DISTINCT account)::int AS accounts "
        f"FROM film_ledger WHERE player_id::text = {sql_text(player_id)} GROUP BY change_id"
    )
    assert rows, "the player has film_ledger rows (L635)"
    for row in rows:
        assert row["n"] == 2 and row["total"] == 0 and row["accounts"] == 2, row


def photo_spends(player_id: str) -> int:
    rows = Postgres().rows(f"SELECT COUNT(*)::int AS n FROM film_ledger WHERE player_id::text = {sql_text(player_id)} AND account = 'satchel' AND reason = 'photo'")
    return rows[0]["n"]


def stored_key(photo: str, store: S3 | None = None) -> str:
    keys = (store or S3()).keys(f"photos/{photo}")
    assert len(keys) == 1 and re.fullmatch(rf"photos/{re.escape(photo)}\.(png|jpg)", keys[0]), keys
    return keys[0]


def object_keys() -> set[str]:
    return set(S3().keys("photos/"))


def orphans_since(before: set[str]) -> set[str]:
    fresh = {Path(key).stem for key in object_keys() - before}
    if not fresh:
        return set()
    listed = ",".join(sql_text(item) for item in fresh)
    known = {row["id"] for row in Postgres().rows(f"SELECT id::text AS id FROM photos WHERE id::text IN ({listed})")}
    return fresh - known


def mail_to(mail: Mailpit, address: str, expected: int = 1) -> list[dict[str, Any]]:
    def found() -> list[dict[str, Any]]:
        return [m for m in mail.messages(settle=0.2) if address in addresses(m.get("To", []))]

    poll(lambda: len(found()) >= expected, f"{expected} Mailpit message(s) to the test's own recipient")
    return [m for m in mail.messages(settle=1.5) if address in addresses(m.get("To", []))]


def no_mail_to(mail: Mailpit, address: str) -> None:
    assert not [m for m in mail.messages(settle=1.5) if address in addresses(m.get("To", []))]


def requests_to(page: Page, method: str, path: str) -> list[Any]:
    seen: list[Any] = []
    page.on("request", lambda r: seen.append(r) if r.method == method and urlparse(r.url).path == path else None)
    return seen


def release(gate: Any) -> None:
    (gate.release if hasattr(gate, "release") else gate)()


def touch(page: Page, kind: str, points: list[tuple[float, float]]) -> None:
    session(page).send("Input.dispatchTouchEvent", {
        "type": kind,
        "touchPoints": [{"x": x, "y": y, "id": index} for index, (x, y) in enumerate(points)],
    })


def touch_tap(locator: Locator) -> None:
    page = locator.page
    locator.scroll_into_view_if_needed()
    point = center(locator)
    touch(page, "touchStart", [point])
    touch(page, "touchEnd", [])


def stick(page: Page, dx: int, dy: int, ms: int = HOLD_MS) -> None:
    x, y = center(page.get_by_role("group", name="Joystick", exact=True))
    touch(page, "touchStart", [(x, y)])
    touch(page, "touchMove", [(x + dx, y + dy)])
    advance(page, ms)
    touch(page, "touchEnd", [])
    touch(page, "touchStart", [(x, y)])
    touch(page, "touchCancel", [])
    advance(page, SLICE_MS)


def two_fingers(page: Page, start: list[tuple[int, int]], moves: list[list[tuple[int, int]]]) -> None:
    touch(page, "touchStart", start)
    for move in moves:
        touch(page, "touchMove", move)
    touch(page, "touchEnd", [])


def tile_point(island_map: Locator, x: int, y: int) -> tuple[float, float]:
    box = island_map.bounding_box()
    size = int(island_map.get_attribute("data-tile-size"))
    return box["x"] + (x + 0.5) * size, box["y"] + (y + 0.5) * size


def tap_tile(page: Page, x: int, y: int) -> None:
    island_map = page.get_by_role("application", name="Island map", exact=True)
    island_map.scroll_into_view_if_needed()
    point = tile_point(island_map, x, y)
    touch(page, "touchStart", [point])
    touch(page, "touchEnd", [])


def walk_until(page: Page, tile: str, limit: int = 60) -> list[str]:
    tiles: list[str] = []
    for _ in range(limit):
        now = next_step(page)["tile"]
        if not tiles or tiles[-1] != now:
            tiles.append(now)
        if now == tile:
            return tiles
    pytest.fail(f"the explorer walked to {tile} (L593); saw {tiles}")


def parse_film(page: Page) -> int:
    return int(re.match(r"\d+", figure(page, "film").inner_text()).group())


def line(page: Page, content: str) -> Locator:
    return page.get_by_text(content, exact=True).first


def join_by_keys(page: Page, code: str) -> None:
    game_focus(page)
    page.keyboard.press("m")
    opener = button(page, "Join a safari")
    opener.focus()
    page.keyboard.press("Enter")
    expect(page.get_by_role("textbox", name="Safari code", exact=True)).to_be_focused()
    page.keyboard.type(code)
    page.keyboard.press("Enter")


def dismiss_dialog(page: Page, dialog: Locator) -> None:
    if dialog.is_visible():
        page.keyboard.press("Escape")


def creature_expected(entry: tuple, tick: int) -> dict[str, Any]:
    island, cid, name, size, _present, route = entry
    if len(route) == 3:
        x, y, heading = route
    else:
        ax, ay, bx, by, per = route
        length = abs(bx - ax) + abs(by - ay)
        ux, uy = (bx > ax) - (bx < ax), (by > ay) - (by < ay)
        k = (tick // per) % (2 * length)
        toward = {(1, 0): "E", (-1, 0): "W", (0, 1): "S", (0, -1): "N"}
        if k < length:
            x, y, heading = ax + ux * k, ay + uy * k, toward[(ux, uy)]
        else:
            x, y, heading = bx - ux * (k - length), by - uy * (k - length), toward[(-ux, -uy)]
    return {"id": cid, "name": name, "island": island, "size": size, "x": x, "y": y, "heading": heading}


def present_at(entry: tuple, tick: int) -> bool:
    hour = (tick % DAY_TICKS) * 24 // DAY_TICKS
    rule = entry[4]
    if rule == "dusk only":
        return 18 <= hour < 20
    if rule == "rain only":
        return 6 <= hour < 9
    return True


def creatures_of(api: Api, island: int = 1) -> str:
    world = api.get("/api/world").json()
    present = sorted((c for c in world["creatures"] if c["island"] == island), key=lambda c: c["id"])
    return ";".join(f'{c["id"]}@{c["x"]},{c["y"]},{c["heading"]}' for c in present)


def board_rows(page: Page) -> Locator:
    table = page.get_by_role("table", name="Challenge board", exact=True)
    return table.get_by_role("row").filter(has=page.get_by_role("cell"))


def enter_by_keys(page: Page, radio_name: str) -> None:
    opener = button(page, "Enter a photo")
    opener.focus()
    page.keyboard.press("Enter")
    radio = page.get_by_role("radio", name=radio_name, exact=True)
    radio.focus()
    page.keyboard.press("Space")
    expect(radio).to_be_checked()
    button(page.get_by_role("dialog", name="Enter a photo", exact=True), "Enter photo").focus()
    page.keyboard.press("Enter")


def open_postcard_by_keys(page: Page, creature_name: str) -> Locator:
    game_focus(page)
    page.keyboard.press("j")
    opener = button(page, f"Send {creature_name} photo as a postcard")
    opener.focus()
    page.keyboard.press("Enter")
    dialog = page.get_by_role("dialog", name="Send postcard", exact=True)
    expect(dialog).to_be_visible()
    return opener


def write_postcard(page: Page, recipient: str, words: str) -> None:
    field = page.get_by_role("textbox", name="Recipient email", exact=True)
    field.focus()
    page.keyboard.type(recipient)
    page.get_by_role("textbox", name="Your line", exact=True).focus()
    page.keyboard.type(words)
    button(page, "Post").focus()


def test_wf_title_and_first_steps_happy(browser, app_url):
    world = new_world(app_url)
    api = Api(app_url, world["explorer"])
    with visit(browser, app_url, world["explorer"], "/") as page:
        guide = page.get_by_role("application", name="Guide creature", exact=True)
        guide.focus()
        page.keyboard.press("ArrowRight")
        expect(guide).to_have_attribute("data-spin", "15")
        page.keyboard.press("Space")
        expect(guide).to_have_attribute("data-nudges", "1")
        page.get_by_role("link", name="Start walking", exact=True).focus()
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/play"))
        ready(page)
        target = game_focus(page)
        expect(target).to_have_attribute("data-tile", "3,12")
        hold(page, "d")
        expect(target).to_have_attribute("data-tile", "5,12")
        page.keyboard.press("r")
        hold(page, "d")
        expect(target).to_have_attribute("data-tile", "9,12")
        page.keyboard.press("Space")
        states = [next_step(page) for _ in range(4)]
        assert [s["gait"] for s in states] == ["jump"] * 4
        landed = [9 + 2, 12]
        assert states[-1]["tile"] == f"{landed[0]},{landed[1]}"
        page.keyboard.press("e")
        expect(target).to_have_attribute("data-yaw", "180")
        poll(lambda: api.get("/api/me").json()["position"]["tile"] == landed, "PUT /api/me/position saved the landing tile (L595)")
        page.reload()
        ready(page)
        expect(view(page)).to_have_attribute("data-tile", f"{landed[0]},{landed[1]}")


def test_wf_title_and_first_steps_signed_out_start(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    api = Api(app_url, who)
    assert api.put("/api/me/settings", {"music": 60, "effects": 80, "graphics": "light"}).status_code == 200
    with visit(browser, app_url, None, "/") as page:
        page.get_by_role("link", name="Sign in", exact=True).focus()
        page.get_by_role("link", name="Start walking", exact=True).focus()
        page.keyboard.press("Enter")
        expect(page).to_have_url(re.compile(r"/signin\?next="))
        page.get_by_role("textbox", name="Email", exact=True).fill(who["email"])
        page.get_by_label("Password").fill(who["password"])
        page.keyboard.press("Enter")
        expect(page).to_have_url(f"{app_url}/play", timeout=RESULT_MS)
        ready(page)
        game_focus(page)
        hold(page, "s")
        expect(view(page)).to_have_attribute("data-tile", "3,14")
        poll(lambda: api.get("/api/me").json()["position"]["tile"] == [3, 14], "the walked tile saved")


def test_title_tab_order(browser, app_url):
    world = new_world(app_url)
    for who, account in ((None, "Sign in"), (world["explorer"], "Account")):
        with visit(browser, app_url, who, "/") as page:
            names = tab_order(page, 10)
            published = ["Hushfoot", "Islands", "Text world", account, "Start walking", "Guide creature", "Reset view", "Sound", "Demo zoom", "Demo focus"]
            assert len(names) == len(published)
            for got, wanted in zip(names, published):
                assert wanted in got, (names, published)


def test_guide_creature_keyboard(browser, app_url):
    with visit(browser, app_url, None, "/") as page:
        guide = page.get_by_role("application", name="Guide creature", exact=True)
        status = region(page, "Guide status")
        guide.focus()
        expect(guide).to_have_attribute("data-spin", "0")
        expect(guide).to_have_attribute("data-zoom", "1.00")
        expect(guide).to_have_attribute("data-nudges", "0")
        page.keyboard.press("ArrowRight")
        expect(status).to_have_text("Wump faces 15 degrees.")
        page.keyboard.press("ArrowRight")
        expect(guide).to_have_attribute("data-spin", "30")
        expect(status).to_have_text("Wump faces 30 degrees.")
        page.keyboard.press("+")
        expect(guide).to_have_attribute("data-zoom", "1.25")
        expect(status).to_have_text(f"Wump at {int(1.25 * 100)} percent.")
        page.keyboard.press("Space")
        expect(guide).to_have_attribute("data-nudges", "1")
        expect(status).to_have_text("Wump hops.")
        page.keyboard.press("q")
        expect(guide).to_have_attribute("data-spin", "15")
        page.keyboard.press("e")
        expect(guide).to_have_attribute("data-spin", "30")
        for _ in range(6):
            page.keyboard.press("+")
        expect(guide).to_have_attribute("data-zoom", "2.00")
        page.keyboard.press("Home")
        expect(guide).to_have_attribute("data-spin", "0")
        expect(guide).to_have_attribute("data-zoom", "1.00")
        expect(guide).to_have_attribute("data-stretch", "0.00")
        page.keyboard.press("ArrowLeft")
        expect(guide).to_have_attribute("data-spin", "345")


def test_guide_creature_pointer_pull(browser, app_url):
    with visit(browser, app_url, None, "/") as page:
        guide = page.get_by_role("application", name="Guide creature", exact=True)
        guide.scroll_into_view_if_needed()
        x, y = center(guide)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 100, y, steps=5)
        expect(guide).to_have_attribute("data-spin", "75")
        expect(guide).to_have_attribute("data-stretch", "0.50")
        page.mouse.up()
        advance(page, STRETCH_MS)
        expect(guide).to_have_attribute("data-stretch", "0.00")
        expect(guide).to_have_attribute("data-spin", "75")
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 300, y, steps=5)
        expect(guide).to_have_attribute("data-stretch", "1.00")
        page.mouse.up()
        advance(page, STRETCH_MS)
        expect(guide).to_have_attribute("data-stretch", "0.00")


def test_published_walk_and_run_steps(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"]) as page:
        target = game_focus(page)
        hold(page, "d")
        expect(target).to_have_attribute("data-tile", "5,12")
        page.keyboard.press("r")
        hold(page, "d")
        expect(target).to_have_attribute("data-tile", "9,12")
    world = new_world(app_url)
    with play(browser, app_url, world["friend"]) as page:
        target = game_focus(page)
        next_step(page)
        page.keyboard.down("d")
        walked = [next_step(page) for _ in range(4)]
        page.keyboard.up("d")
        assert [s["tile"] for s in walked] == ["4,12", "4,12", "5,12", "5,12"]
        assert {s["heading"] for s in walked} == {"E"}
        assert {s["gait"] for s in walked} == {"walk"}
        assert next_step(page)["gait"] == "idle"
        page.keyboard.press("r")
        page.keyboard.down("d")
        ran = [next_step(page) for _ in range(4)]
        page.keyboard.up("d")
        assert [s["tile"] for s in ran] == ["6,12", "7,12", "8,12", "9,12"]
        assert {s["gait"] for s in ran} == {"run"}


def test_rock_stop_and_jump(browser, app_url):
    world = new_world(app_url)
    api = Api(app_url, world["friend"])
    assert api.put("/api/me/position", {"island": 1, "tile": [7, 5], "heading": "E"}).status_code == 200
    with play(browser, app_url, world["friend"]) as page:
        target = game_focus(page)
        expect(target).to_have_attribute("data-tile", "7,5")
        hold(page, "s")
        expect(target).to_have_attribute("data-tile", "7,5")
        expect(target).to_have_attribute("data-heading", "S")
        next_step(page)
        page.keyboard.press("Space")
        states = [next_step(page) for _ in range(4)]
        assert [s["gait"] for s in states] == ["jump"] * 4
        assert [s["tile"] for s in states] == ["7,5", "7,5", "7,5", "7,7"]
        assert next_step(page)["gait"] == "idle"
    start = [14, 4]
    assert api.put("/api/me/position", {"island": 1, "tile": start, "heading": "E"}).status_code == 200
    with play(browser, app_url, world["friend"]) as page:
        game_focus(page)
        next_step(page)
        page.keyboard.press("Space")
        states = [next_step(page) for _ in range(4)]
        assert states[-1]["tile"] == f"{start[0]},{start[1]}", "a jump onto water lands back on its starting tile (L591)"


def test_explore_camera_keys_and_focus_scope(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"]) as page:
        target = game_focus(page)
        expect(target).to_have_attribute("data-yaw", "90")
        expect(target).to_have_attribute("data-zoom", "2")
        page.keyboard.press("q")
        expect(target).to_have_attribute("data-yaw", "0")
        page.keyboard.press("q")
        expect(target).to_have_attribute("data-yaw", "270")
        page.keyboard.press("e")
        page.keyboard.press("e")
        page.keyboard.press("e")
        expect(target).to_have_attribute("data-yaw", "180")
        page.keyboard.press("+")
        expect(target).to_have_attribute("data-zoom", "3")
        page.keyboard.press("+")
        page.keyboard.press("+")
        expect(target).to_have_attribute("data-zoom", "4")
        page.keyboard.press("Home")
        expect(target).to_have_attribute("data-yaw", "90")
        expect(target).to_have_attribute("data-zoom", "2")
        page.keyboard.press("-")
        page.keyboard.press("-")
        expect(target).to_have_attribute("data-zoom", "1")
        page.keyboard.press("Tab")
        expect(target).not_to_be_focused()
        hold(page, "d")
        expect(target).to_have_attribute("data-tile", "3,12")


def test_wf_phone_play_happy(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    with phone(browser, app_url, who) as page:
        mark_page(page)
        target = view(page)
        stick(page, 30, 0)
        expect(target).to_have_attribute("data-tile", "5,12")
        touch_tap(button(page, "Run"))
        stick(page, 30, 0)
        expect(target).to_have_attribute("data-tile", "9,12")
        touch_tap(button(page, "Jump"))
        states = [next_step(page) for _ in range(4)]
        landing_x, landing_y = 9 + 2, 12
        assert states[-1]["tile"] == f"{landing_x},{landing_y}"
        touch_tap(button(page, "Run"))
        touch_tap(button(page, "Map"))
        advance(page, SHEET_MS)
        goal_y = landing_y - 2
        tap_tile(page, landing_x, goal_y)
        assert walk_until(page, f"{landing_x},{goal_y}") == [f"{landing_x},{landing_y - 1}", f"{landing_x},{goal_y}"]
        touch_tap(button(page, "Close map"))
        advance(page, SHEET_MS)
        expect(page.get_by_role("dialog", name="Map", exact=True)).to_have_count(0)
        touch_tap(button(page, "Camera"))
        touch_tap(button(page, "Zoom in"))
        touch_tap(button(page, "Focus"))
        expect(target).to_have_attribute("data-zoom", "2")
        expect(target).to_have_attribute("data-focus", "8")
        response = shoot(page, lambda: touch_tap(button(page, "Take photo")))
        assert response.status == 201
        dialog = expect_result(page)
        advance(page, FIGURE_MS)
        expect(figure(dialog, "score-size")).to_have_text("30")
        expect(figure(dialog, "score-centring")).to_have_text("5")
        expect(figure(dialog, "score-facing")).to_have_text("25")
        expect(figure(dialog, "score-sharpness")).to_have_text("0")
        expect(figure(dialog, "score-total")).to_have_text("60 / 100")
        expect(figure(page, "film")).to_have_text(f"{36 - 1 + 6} frames")
        assert_no_reload(page)
    photos = [row for row in rows_for(who["id"]) if row["id"] != world["photos"]["friend_heron"]]
    assert [row["total"] for row in photos] == [60]


def test_wf_phone_play_refused_shot_recovers(browser, app_url):
    world = new_world(app_url)
    who = world["rival"]
    before = len(rows_for(who["id"]))
    with phone(browser, app_url, who, "/play?island=1&spot=2") as page:
        touch_tap(button(page, "Camera"))
        stick(page, 30, 0, STEP_MS)
        expect(view(page)).to_have_attribute("data-heading", "E")
        response = shoot(page, lambda: touch_tap(button(page, "Take photo")))
        assert response.status == 422
        expect(region(page, "Photo status")).to_contain_text("No creature in frame. Photo refused.")
        expect(result_dialog(page)).to_have_count(0)
        assert len(rows_for(who["id"])) == before
        stick(page, 0, -30, STEP_MS)
        expect(view(page)).to_have_attribute("data-heading", "N")
        response = shoot(page, lambda: touch_tap(button(page, "Take photo")))
        assert response.status == 201
        expect_result(page)
    assert len(rows_for(who["id"])) == before + 1


def test_joystick_holds_a_direction(browser, app_url):
    world = new_world(app_url)
    with phone(browser, app_url, world["friend"]) as page:
        target = view(page)
        stick(page, 0, -10)
        expect(target).to_have_attribute("data-tile", "3,12")
        stick(page, 0, -30)
        expect(target).to_have_attribute("data-tile", "3,10")
        expect(target).to_have_attribute("data-heading", "N")
        advance(page, 3 * STEP_MS)
        expect(target).to_have_attribute("data-tile", "3,10")
        expect(target).to_have_attribute("data-gait", "idle")


def test_run_and_jump_by_tap(browser, app_url):
    world = new_world(app_url)
    with phone(browser, app_url, world["friend"]) as page:
        run = button(page, "Run")
        expect(run).to_have_attribute("aria-pressed", "false")
        touch_tap(run)
        expect(run).to_have_attribute("aria-pressed", "true")
        stick(page, 0, -30)
        expect(view(page)).to_have_attribute("data-tile", "3,8")
        touch_tap(button(page, "Jump"))
        states = [next_step(page) for _ in range(4)]
        assert [s["gait"] for s in states] == ["jump"] * 4
        assert [s["tile"] for s in states] == ["3,8", "3,8", "3,8", "3,6"]


def test_tapped_map_tile_walks_published_path(browser, app_url):
    world = new_world(app_url)
    with phone(browser, app_url, world["friend"]) as page:
        touch_tap(button(page, "Map"))
        advance(page, SHEET_MS)
        tap_tile(page, 12, 10)
        walked = walk_until(page, "12,10")
        assert walked == ["3,11", "3,10"] + [f"{x},10" for x in range(4, 13)]
        expect(page.get_by_role("dialog", name="Map", exact=True)).to_be_visible()
        tap_tile(page, 16, 4)
        expect(region(page, "World status")).to_contain_text("No path to that spot.")
        next_step(page)
        expect(view(page)).to_have_attribute("data-tile", "12,10")


def test_two_finger_orbit_and_pinch(browser, app_url):
    world = new_world(app_url)
    with phone(browser, app_url, world["friend"], "/play?island=1&spot=2") as page:
        target = view(page)
        box = target.bounding_box()
        x, y = int(box["x"] + box["width"] / 2), int(box["y"] + box["height"] * 0.4)
        page.evaluate("0")
        game_focus(page)
        page.keyboard.press("e")
        expect(target).to_have_attribute("data-yaw", "90")

        def sideways(px: int) -> None:
            two_fingers(page, [(x - 40, y), (x + 40, y)], [[(x - 40 + px, y), (x + 40 + px, y)]])

        sideways(61)
        expect(target).to_have_attribute("data-yaw", "121")
        sideways(-62)
        expect(target).to_have_attribute("data-yaw", "90")
        sideways(-61)
        expect(target).to_have_attribute("data-yaw", "59")

        def pinch(steps: list[int]) -> None:
            two_fingers(page, [(x - 40, y), (x + 40, y)], [[(x - 40 - d // 2, y), (x + 40 + d // 2, y)] for d in steps])

        expect(target).to_have_attribute("data-zoom", "2")
        pinch([40])
        expect(target).to_have_attribute("data-zoom", "3")
        pinch([40, 80])
        expect(target).to_have_attribute("data-zoom", "4")
        pinch([-40, -60])
        expect(target).to_have_attribute("data-zoom", "3")

        touch_tap(button(page, "Camera"))
        expect(target).to_have_attribute("data-mode", "photo")
        expect(target).to_have_attribute("data-zoom", "1")
        yaw = target.get_attribute("data-yaw")
        pinch([40])
        expect(target).to_have_attribute("data-zoom", "2")
        pinch([40])
        expect(target).to_have_attribute("data-zoom", "4")
        pinch([40])
        expect(target).to_have_attribute("data-zoom", "4")
        pinch([-40])
        expect(target).to_have_attribute("data-zoom", "2")
        pinch([-40])
        expect(target).to_have_attribute("data-zoom", "1")
        sideways(61)
        expect(target).to_have_attribute("data-yaw", yaw)


def assert_bottom_sheet(dialog: Locator) -> None:
    box = dialog.bounding_box()
    assert abs(box["x"]) <= 1 and abs(box["width"] - PHONE["width"]) <= 1, box
    assert abs(box["y"] + box["height"] - PHONE["height"]) <= 1, box


def test_phone_sheets_close_completely(browser, app_url):
    world = new_world(app_url)
    with phone(browser, app_url, world["friend"], "/play?island=1&spot=2") as page:
        for opener_name, dialog_name, closer in (("Map", "Map", "Close map"), ("Album", "Album", "Close album")):
            opener = button(page, opener_name)
            touch_tap(opener)
            dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
            expect(dialog).to_be_visible()
            advance(page, SHEET_MS)
            assert_bottom_sheet(dialog)
            touch_tap(button(page, closer))
            advance(page, SHEET_MS)
            expect(dialog).to_have_count(0)
            expect(opener).to_be_focused()
            assert not [name for name in tab_order(page, 12) if closer in name]
        touch_tap(button(page, "Camera"))
        take = button(page, "Take photo")
        assert shoot(page, lambda: touch_tap(take)).status == 201
        dialog = expect_result(page)
        advance(page, SHEET_MS)
        assert_bottom_sheet(dialog)
        touch_tap(button(page, "Close"))
        advance(page, SHEET_MS)
        expect(dialog).to_have_count(0)
        expect(take).to_be_focused()
        assert not [name for name in tab_order(page, 12) if name == "Close"]


def assert_targets(page: Page) -> None:
    width = page.viewport_size["width"]
    for role in ("button", "link"):
        for control in page.get_by_role(role).all():
            if not control.is_visible():
                continue
            box = control.bounding_box()
            if not box or box["x"] + box["width"] <= 0 or box["x"] >= width:
                continue
            label = control.get_attribute("aria-label") or control.inner_text()
            assert box["width"] >= TARGET_PX - 0.5 and box["height"] >= TARGET_PX - 0.5, (page.url, role, label, box)


@pytest.mark.parametrize("case", LAYOUT_CASES, ids=LAYOUT_CASES)
def test_published_layouts(browser, app_url, case):
    world = new_world(app_url)
    size = VIEWPORTS[case]
    handle = world["explorer"]["handle"]
    with visit(browser, app_url, world["friend"], "/play?island=1&spot=2", viewport=size, has_touch=case == "phone") as page:
        ready(page)
        target = view(page)
        joystick = page.get_by_role("group", name="Joystick", exact=True)
        layout(page)
        if case == "phone":
            box = target.bounding_box()
            assert box["width"] >= size["width"] - 1 and box["height"] >= size["height"] - 1, box
            make_coarse(page)
            page.reload()
            ready(page)
            for control in (joystick, button(page, "Run"), button(page, "Jump")):
                expect(control).to_be_visible()
        else:
            for control in (joystick, button(page, "Run"), button(page, "Jump")):
                expect(control).to_be_hidden()
            if case == "tablet":
                make_coarse(page)
                page.reload()
                ready(page)
                if page.evaluate("matchMedia('(pointer: coarse)').matches"):
                    expect(joystick).to_be_visible()
                    expect(button(page, "Run")).to_be_visible()
                    expect(button(page, "Jump")).to_be_visible()
        if case != "desktop":
            assert_targets(page)
        game_focus(page)
        page.keyboard.press("m")
        advance(page, SHEET_MS)
        island_map = page.get_by_role("application", name="Island map", exact=True)
        expect(island_map).to_be_visible()
        if case == "desktop":
            panel = page.get_by_role("complementary", name="Map and album", exact=True)
            box = panel.bounding_box()
            assert abs(box["width"] - PANEL_SHARE * size["width"]) <= 2, box
            assert abs(box["x"] + box["width"] - size["width"]) <= 1, box
            expect(page.get_by_role("separator", name="Resize map and album", exact=True)).to_have_attribute("aria-valuenow", "50")
            pages_list = page.get_by_role("list", name="Album pages", exact=True)
            expect(pages_list).to_be_visible()
            assert island_map.bounding_box()["x"] < pages_list.bounding_box()["x"]
        else:
            sheet = page.get_by_role("dialog", name="Map", exact=True)
            box = sheet.bounding_box()
            if case == "phone":
                assert abs(box["width"] - size["width"]) <= 1, box
                assert abs(box["y"] + box["height"] - size["height"]) <= 1, box
            else:
                assert abs(box["width"] - SIDE_SHEET_PX) <= 1, box
                assert abs(box["x"] + box["width"] - size["width"]) <= 1, box
            page.keyboard.press("Escape")
            advance(page, SHEET_MS)
            game_focus(page)
            page.keyboard.press("j")
            advance(page, SHEET_MS)
            pages_list = page.get_by_role("list", name="Album pages", exact=True)
        lefts = {round(item.bounding_box()["x"]) for item in pages_list.get_by_role("listitem").all()}
        assert len(lefts) == 2, f"album pages sit in two columns (L158): {lefts}"
        page.keyboard.press("Escape")
        advance(page, SHEET_MS)
        game_focus(page)
        page.keyboard.press("c")
        assert shoot(page).status == 201
        dialog = expect_result(page)
        advance(page, SHEET_MS)
        box = dialog.bounding_box()
        if case == "phone":
            assert abs(box["width"] - size["width"]) <= 1, box
        else:
            assert abs(box["width"] - SIDE_SHEET_PX) <= 1, box
            assert abs(box["x"] + box["width"] - size["width"]) <= 1, box
        page.keyboard.press("Escape")
        for path in ("/", "/board", "/boards/1", "/text-world", "/hall", "/ranger", f"/hall/{handle}"):
            page.goto(f"{app_url}{path}")
            layout(page)
            if case != "desktop":
                assert_targets(page)
        hall_box = page.get_by_role("application", name="Gallery hall", exact=True).bounding_box()
        hung_box = page.get_by_role("list", name="Hung photos", exact=True).bounding_box()
        if case == "phone":
            assert hall_box["y"] + hall_box["height"] <= hung_box["y"] + 1, (hall_box, hung_box)
        else:
            assert hall_box["x"] + hall_box["width"] <= hung_box["x"] + 1 or hung_box["x"] + hung_box["width"] <= hall_box["x"] + 1, (hall_box, hung_box)


def test_wf_photo_keyboard_happy(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        response = keyboard_photo(page)
        assert response.status == 201
        pid = response.json()["photo"]["id"]
        expect_result(page)
        advance(page, FIGURE_MS)
        page.keyboard.press("Escape")
        expect(result_dialog(page)).to_have_count(0)
        page.keyboard.press("c")
        expect(view(page)).to_have_attribute("data-mode", "explore")
        page.keyboard.press("j")
        advance(page, FIGURE_MS)
        expect(figure(page, "album-pages")).to_have_text("4 of 4 pages")
        expect(page.get_by_role("img", name=f"{NEWT_NAME} photo", exact=True)).to_be_visible()
    albums = Api(app_url, who).get("/api/me/albums").json()
    newt = next(p for p in albums["albums"][0]["pages"] if p["creature"] == "mossback-newt")
    assert newt["filled"] and newt["photo_id"] == pid and newt["total"] == 100
    assert stored_key(pid)


def test_wf_photo_keyboard_refusal_then_kept(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    spends_before = photo_spends(who["id"])
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        game_focus(page)
        page.keyboard.press("c")
        page.keyboard.press("+")
        page.keyboard.press("e")
        assert shoot(page).status == 422
        expect(region(page, "Photo status")).to_contain_text("No creature in frame. Photo refused.")
        expect(result_dialog(page)).to_have_count(0)
        assert photo_spends(who["id"]) == spends_before
        page.keyboard.press("q")
        response = shoot(page)
        assert response.status == 201
        expect_result(page)
        expect(region(page, "Photo status")).not_to_contain_text("No creature in frame")
    assert photo_spends(who["id"]) == spends_before + 1


def test_entering_photo_mode_by_keyboard(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"], "/play?island=1&spot=2") as page:
        target = game_focus(page)
        expect(target).to_have_attribute("data-focus", "")
        page.keyboard.press("e")
        page.keyboard.press("+")
        expect(target).to_have_attribute("data-yaw", "90")
        expect(target).to_have_attribute("data-zoom", "3")
        expect(target).to_have_attribute("data-in-view", "")
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-mode", "photo")
        expect(target).to_have_attribute("data-yaw", "0")
        expect(target).to_have_attribute("data-zoom", "1")
        expect(target).to_have_attribute("data-focus", "4")
        expect(target).to_have_attribute("data-in-view", "mossback-newt")
        expect(region(page, "Frame guide")).to_have_text("Mossback newt in frame")
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-mode", "explore")
        expect(target).to_have_attribute("data-yaw", "90")
        expect(target).to_have_attribute("data-zoom", "3")
        expect(target).to_have_attribute("data-in-view", "")


def test_turning_changes_the_frame_guide(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"], "/play?island=1&spot=2") as page:
        target = game_focus(page)
        page.keyboard.press("c")
        page.keyboard.press("e")
        expect(target).to_have_attribute("data-heading", "E")
        expect(target).to_have_attribute("data-in-view", "")
        expect(region(page, "Frame guide")).to_have_text("No creature in frame")
        page.keyboard.press("q")
        expect(target).to_have_attribute("data-heading", "N")
        expect(target).to_have_attribute("data-in-view", "mossback-newt")
        expect(region(page, "Frame guide")).to_have_text("Mossback newt in frame")
        expect(target).to_have_attribute("data-tile", "12,10")


def test_scoring_pending_and_one_announcement(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        status = region(page, "Photo status")
        game_focus(page)
        page.keyboard.press("c")
        page.keyboard.press("+")
        with held(page, "**/api/photos") as gate:
            page.keyboard.press("Enter")
            expect(status).to_have_text("Scoring…")
            expect(result_dialog(page)).to_have_count(0)
            release(gate)
            expect_result(page)
        expect(status).to_contain_text(NEWT_100)
        advance(page, FIGURE_MS)
        assert status.inner_text().count(NEWT_100) == 1


def test_score_figures_count_up(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        assert keyboard_photo(page).status == 201
        dialog = expect_result(page)
        advance(page, FIGURE_MID_MS)
        middle = re.fullmatch(r"(\d+) / 100", figure(dialog, "score-total").inner_text())
        assert middle and 0 < int(middle.group(1)) < 100, middle
        advance(page, FIGURE_MS - FIGURE_MID_MS)
        expect(figure(dialog, "score-total")).to_have_text("100 / 100")
        expect(figure(dialog, "score-size")).to_have_text("30")
        expect(figure(dialog, "score-centring")).to_have_text("25")
        expect(figure(dialog, "score-facing")).to_have_text("25")
        expect(figure(dialog, "score-sharpness")).to_have_text("20")


def test_result_survives_the_world(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        assert keyboard_photo(page).status == 201
        dialog = expect_result(page)
        advance(page, FIGURE_MS)
        expect(button(dialog, "Close")).to_be_focused()
        before = dialog.inner_text()
        for tick, weather in ((6030, "clear"), (11000, "clear"), (4000, "rain")):
            set_tick(app_url, world, tick)
            expect(view(page)).to_have_attribute("data-tick", str(tick), timeout=LIVE_MS)
            expect(view(page)).to_have_attribute("data-weather", weather)
            advance(page, 2 * STEP_MS)
            expect(dialog).to_be_visible()
            assert dialog.inner_text() == before
        wraps_inside(page, dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(view(page)).to_be_focused()


def test_album_shows_only_a_stored_photo(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        other = open_tab(page, app_url)
        game_focus(other)
        other.keyboard.press("j")
        expect(figure(other, "album-pages")).to_have_text("3 of 4 pages")
        expect(other.get_by_role("img", name=f"{NEWT_NAME} photo", exact=True)).to_have_count(0)
        expect(other.get_by_text("Not photographed yet.").first).to_be_visible()
        response = keyboard_photo(page)
        assert response.status == 201
        body = response.json()["photo"]
        uploaded = base64.b64decode(page.evaluate("window.__shots.sent[window.__shots.sent.length - 1].image"))
        expect(other.get_by_role("img", name=f"{NEWT_NAME} photo", exact=True)).to_be_visible(timeout=LIVE_MS)
        advance(page, FIGURE_MS)
        expect(figure(other, "album-pages")).to_have_text("4 of 4 pages")
        expect_result(page)
        page.keyboard.press("Escape")
        page.keyboard.press("c")
        page.keyboard.press("j")
        advance(page, FIGURE_MS)
        expect(figure(page, "album-pages")).to_have_text("4 of 4 pages")
        image = page.get_by_role("img", name=f"{NEWT_NAME} photo", exact=True)
        source = image.evaluate("el => el.currentSrc || el.src")
        assert same_origin(source, app_url), source
        assert urlparse(source).path == body["image_url"]
        poll(lambda: image.evaluate("el => el.complete && el.naturalWidth > 0"), "the album image loaded from storage")
    stored = S3().get(stored_key(body["id"]))
    assert stored == uploaded
    assert httpx.get(f'{app_url}{body["image_url"]}', timeout=HTTP_TIMEOUT).status_code in (200, 404)
    assert Api(app_url, world["explorer"]).get(body["image_url"]).content == uploaded


def assert_score(body: dict[str, Any], number: int) -> None:
    example = EXAMPLES[number]
    score = body["score"]
    assert body["creature"] == example["creature"]
    assert (score["size"], score["centring"], score["facing"], score["sharpness"], score["total"]) == example["score"]


def assert_result_rows(dialog: Locator, score: tuple[int, int, int, int, int]) -> None:
    expect(figure(dialog, "score-size")).to_have_text(str(score[0]))
    expect(figure(dialog, "score-centring")).to_have_text(str(score[1]))
    expect(figure(dialog, "score-facing")).to_have_text(str(score[2]))
    expect(figure(dialog, "score-sharpness")).to_have_text(str(score[3]))
    expect(figure(dialog, "score-total")).to_have_text(f"{score[4]} / 100")


def test_wf_server_scoring_examples_by_keys(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        response = keyboard_photo(page)
        assert response.status == 201
        assert_score(response.json()["photo"], 1)
        dialog = expect_result(page)
        advance(page, FIGURE_MS)
        assert_result_rows(dialog, EXAMPLES[1]["score"])
    with play(browser, app_url, world["friend"], "/play?island=1&spot=2") as page:
        game_focus(page)
        hold(page, "d", STEP_MS)
        expect(view(page)).to_have_attribute("data-tile", "13,10")
        page.keyboard.press("c")
        page.keyboard.press("w")
        page.keyboard.press("+")
        page.keyboard.press("f")
        expect(view(page)).to_have_attribute("data-focus", "8")
        response = shoot(page)
        assert response.status == 201
        assert_score(response.json()["photo"], 3)
        dialog = expect_result(page)
        advance(page, FIGURE_MS)
        assert_result_rows(dialog, EXAMPLES[3]["score"])
    set_tick(app_url, world, 6030)
    with play(browser, app_url, world["rival"], "/play?island=1&spot=3") as page:
        game_focus(page)
        page.keyboard.press("c")
        expect(view(page)).to_have_attribute("data-in-view", "reedpipe-heron,mossback-newt")
        response = shoot(page)
        assert response.status == 201
        assert_score(response.json()["photo"], 4)
        dialog = expect_result(page)
        advance(page, FIGURE_MS)
        assert_result_rows(dialog, EXAMPLES[4]["score"])
    assert {r["total"] for r in rows_for(world["rival"]["id"])} >= {80}


def test_wf_server_scoring_forged_values_ignored(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        page.evaluate("window.__shots.overrides = {extra: {score: {total: 100, size: 30}, total: 100, weather: 'rain'}}")
        game_focus(page)
        hold(page, "d", STEP_MS)
        page.keyboard.press("c")
        page.keyboard.press("w")
        page.keyboard.press("+")
        page.keyboard.press("f")
        response = shoot(page)
        assert response.status == 201
        body = response.json()
        assert_score(body["photo"], 3)
        dialog = expect_result(page)
        advance(page, FIGURE_MS)
        assert_result_rows(dialog, EXAMPLES[3]["score"])
    row = [r for r in rows_for(who["id"]) if r["id"] == body["photo"]["id"]]
    assert row and row[0]["total"] == 60


def test_worked_examples_and_refusal_order_on_the_api(app_url):
    world = new_world(app_url)
    api = Api(app_url, world["friend"])
    for number, stop in ((1, 6000), (2, 6000), (3, 6000), (4, 6030), (5, 11000)):
        set_tick(app_url, world, stop)
        response = api.photo(example_pose(number))
        assert response.status_code == 201, response.text
        assert_score(response.json()["photo"], number)

    world = new_world(app_url)
    who = world["rival"]
    api = Api(app_url, who)
    fine = low_pose()
    bad_island = {**fine, "island": 9}
    water = {**fine, "tile": [15, 4], "camera": [15, 4]}
    old = {**fine, "tick": 6000 - GRACE_TICKS}
    ahead = {**fine, "tick": 6001}
    far = {**fine, "camera": [14, 12]}
    empty = make_pose([3, 12], "E", 1, 4, 6000)
    before = len(rows_for(who["id"]))
    too_big = sized_png(PHOTO_LIMIT + 1)
    assert_error(Api(app_url).photo(bad_island, image=b"not an image"), 401, "not_signed_in", "Sign in first.")
    assert_error(api.photo(bad_island, image=too_big), 413, "photo_too_large", "Photos can be at most 2,000,000 bytes.")
    assert_error(api.photo(bad_island, image=b"not an image"), 415, "not_an_image", "Photos must be PNG or JPEG images.")
    assert_error(api.photo(bad_island), 422, "bad_pose", "That photo's details aren't valid.")
    assert_error(api.photo({**water, "tick": 6000 - GRACE_TICKS}), 422, "tick_passed", "That moment has passed. Photo refused.")
    assert_error(api.photo({**water, "tick": 6001}), 422, "tick_ahead", "That moment hasn't happened yet. Photo refused.")
    assert_error(api.photo({**water, "camera": [18, 4]}), 422, "cannot_stand", "No one could stand there. Photo refused.")
    assert_error(api.photo({**empty, "camera": [5, 12]}), 422, "camera_too_far", "The camera was too far from the explorer. Photo refused.")
    assert_error(api.photo(empty), 422, "nothing_in_frame", "No creature in frame. Photo refused.")
    assert_error(api.photo(old), 422, "tick_passed")
    assert_error(api.photo(ahead), 422, "tick_ahead")
    assert_error(api.photo(far), 422, "camera_too_far")
    assert len(rows_for(who["id"])) == before
    assert ledger_sum(who["id"]) == 36

    key = idempotency_key()
    assert api.photo(fine, key=key).status_code == 201
    assert_error(api.photo(bad_island, key=key), 409, "shot_key_reused", "That shot key was already used for another photo.")
    for _ in range(34):
        assert api.photo(fine).status_code == 201
    assert ledger_sum(who["id"]) == 1
    with ThreadPoolExecutor(2) as pool:
        both = list(pool.map(lambda _: api.photo(fine), range(2)))
    assert sorted(r.status_code for r in both) == [201, 409]
    assert_error(next(r for r in both if r.status_code == 409), 409, "out_of_film", "Out of film. Refill at Saltmarsh Harbour.")
    assert ledger_sum(who["id"]) == 0
    assert_error(api.photo(bad_island), 409, "out_of_film")
    assert_error(api.photo(bad_island, image=b"not an image"), 415, "not_an_image")
    assert_pairs(who["id"])


def test_photo_size_limit_on_short_limits():
    base = short_limits_url()
    world = new_world(base)
    api = Api(base, world["friend"])
    assert_error(api.photo(low_pose(), image=sized_png(PHOTO_LIMIT_SHORT + 1)), 413, "photo_too_large", "Photos can be at most 200,000 bytes.")
    exact = sized_png(PHOTO_LIMIT_SHORT)
    response = api.photo(low_pose(), image=exact)
    assert response.status_code == 201, response.text
    assert S3("-short").get(stored_key(response.json()["photo"]["id"], S3("-short"))) == exact


@pytest.mark.parametrize("case", REWRITE_CASES, ids=REWRITE_CASES)
def test_rewritten_poses_are_refused(browser, app_url, case):
    change, message = {
        "water_tile": ({"tile": [15, 4]}, "No one could stand there. Photo refused."),
        "old_tick": ({"tickDelta": -GRACE_TICKS}, "That moment has passed. Photo refused."),
        "far_camera": ({"cameraOffset": [2, 0]}, "The camera was too far from the explorer. Photo refused."),
    }[case]
    world = new_world(app_url)
    who = world["explorer"]
    before_rows = len(rows_for(who["id"]))
    before_keys = object_keys()
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        page.evaluate("change => { window.__shots.overrides = change; }", change)
        response = keyboard_photo(page)
        assert response.status == 422
        expect(region(page, "Photo status")).to_contain_text(message)
        advance(page, FIGURE_MS)
        expect(result_dialog(page)).to_have_count(0)
        expect(figure(page, "film")).to_have_text("30 frames")
    assert len(rows_for(who["id"])) == before_rows
    assert not orphans_since(before_keys)
    assert ledger_sum(who["id"]) == 30


def test_nothing_in_frame_is_refused(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    before_rows = len(rows_for(who["id"]))
    before_keys = object_keys()
    with play(browser, app_url, who) as page:
        target = game_focus(page)
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-in-view", "")
        response = shoot(page)
        assert response.status == 422
        assert response.json()["error"] == "nothing_in_frame"
        expect(region(page, "Photo status")).to_contain_text("No creature in frame. Photo refused.")
        advance(page, FIGURE_MS)
        expect(result_dialog(page)).to_have_count(0)
        expect(figure(page, "film")).to_have_text("30 frames")
    assert len(rows_for(who["id"])) == before_rows
    assert not orphans_since(before_keys)


def test_one_shot_key_makes_one_photo(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    api = Api(app_url, who)
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        response = keyboard_photo(page)
        assert response.status == 201
        key = response.request.headers.get("shot-key")
        assert key, "the page sends a new Shot-Key (L306)"
        first = response.json()
        sent = page.evaluate("window.__shots.sent[window.__shots.sent.length - 1]")
        image = base64.b64decode(sent["image"])
        replay = api.photo(sent["pose"], key=key, image=image)
        assert replay.status_code == 201
        assert replay.json() == first
        assert photo_spends(who["id"]) == 1
        assert_error(api.photo({**sent["pose"], "focus": 8}, key=key, image=image), 409, "shot_key_reused", "That shot key was already used for another photo.")
        assert photo_spends(who["id"]) == 1
        page.reload()
        ready(page)
        expect(figure(page, "film")).to_have_text(f"{ledger_sum(who['id'])} frames")
    fresh = idempotency_key()
    assert_error(api.photo(make_pose([3, 12], "E", 1, 4, 6000), key=fresh), 422, "nothing_in_frame")
    spends = photo_spends(who["id"])
    with ThreadPoolExecutor(5) as pool:
        answers = list(pool.map(lambda _: api.photo(low_pose(), key=fresh), range(5)))
    assert {r.status_code for r in answers} == {201}
    assert len({r.json()["photo"]["id"] for r in answers}) == 1
    assert photo_spends(who["id"]) == spends + 1


def test_two_presses_keep_one_photo(browser, app_url):
    world = new_world(app_url)
    who = world["rival"]
    before = len(rows_for(who["id"]))
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        posts = requests_to(page, "POST", "/api/photos")
        game_focus(page)
        page.keyboard.press("c")
        page.keyboard.press("+")
        with held(page, "**/api/photos") as gate:
            page.keyboard.press("Enter")
            advance(page, 50)
            page.keyboard.press("Enter")
            expect(region(page, "Photo status")).to_have_text("Scoring…")
            release(gate)
            expect_result(page)
        assert len(posts) == 1
    assert len(rows_for(who["id"])) == before + 1
    assert photo_spends(who["id"]) == 1


def test_interleaved_players_keep_their_own_answers(browser, app_url):
    heron_line = "Reedpipe heron: 70 points. Size 30, centring 5, facing 15, sharpness 20."
    for reverse in (False, True):
        world = new_world(app_url)
        with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as first:
            with play(browser, app_url, world["friend"], "/play?island=1&spot=3") as second:
                game_focus(first)
                first.keyboard.press("c")
                first.keyboard.press("+")
                game_focus(second)
                second.keyboard.press("c")
                with held(first, "**/api/photos") as first_gate, held(second, "**/api/photos") as second_gate:
                    first.keyboard.press("Enter")
                    second.keyboard.press("Enter")
                    expect(region(first, "Photo status")).to_have_text("Scoring…")
                    expect(region(second, "Photo status")).to_have_text("Scoring…")
                    order = [(second_gate, second), (first_gate, first)] if reverse else [(first_gate, first), (second_gate, second)]
                    for gate, owner in order:
                        release(gate)
                        expect_result(owner)
                advance(first, FIGURE_MS)
                advance(second, FIGURE_MS)
                expect(region(first, "Photo status")).to_contain_text(NEWT_100)
                expect(region(first, "Photo status")).not_to_contain_text("Reedpipe heron")
                expect(region(second, "Photo status")).to_contain_text(heron_line)
                expect(region(second, "Photo status")).not_to_contain_text("Mossback newt")
                expect(figure(result_dialog(first), "score-total")).to_have_text("100 / 100")
                expect(figure(result_dialog(second), "score-total")).to_have_text("70 / 100")
                expect(figure(first, "film")).to_have_text("35 frames")
                expect(figure(second, "film")).to_have_text(f"{36 - 1 + 6} frames")


def test_wf_world_clock_and_creatures_two_screens(browser, app_url):
    world = new_world(app_url)
    api = Api(app_url, world["explorer"])
    stops = [
        (6000, "clear", "mossback-newt@12,6,S;reedpipe-heron@6,16,E"),
        (11000, "clear", "gloamfin-moth@18,12,W;mossback-newt@12,6,S;reedpipe-heron@10,16,W"),
        (4000, "rain", "mossback-newt@12,6,S;puddle-lark@4,4,S;reedpipe-heron@6,16,E"),
    ]
    with play(browser, app_url, world["explorer"]) as first:
        with play(browser, app_url, world["friend"]) as second:
            for tick, weather, creatures in stops:
                set_tick(app_url, world, tick)
                for page in (first, second):
                    expect(view(page)).to_have_attribute("data-tick", str(tick), timeout=LIVE_MS)
                    expect(view(page)).to_have_attribute("data-weather", weather)
                    expect(view(page)).to_have_attribute("data-creatures", creatures)
                assert creatures_of(api) == creatures
                assert api.get("/api/world").json()["weather"] == weather


def test_wf_world_clock_and_creatures_late_arrival(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"]) as first:
        set_tick(app_url, world, 11000)
        expect(view(first)).to_have_attribute("data-tick", "11000", timeout=LIVE_MS)
        with play(browser, app_url, world["friend"]) as second:
            for name in ("data-tick", "data-weather", "data-creatures", "data-world-hour"):
                expect(view(second)).to_have_attribute(name, view(first).get_attribute(name))
            assert creatures_of(Api(app_url, world["friend"])) == view(second).get_attribute("data-creatures")
            expect(region(second, "World status")).not_to_contain_text("Dusk falls on the islands.")


def test_same_tick_and_creatures_on_both_screens(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"]) as first:
        with play(browser, app_url, world["rival"]) as second:
            for page in (first, second):
                expect(view(page)).to_have_attribute("data-tick", "6000")
                expect(view(page)).to_have_attribute("data-creatures", "mossback-newt@12,6,S;reedpipe-heron@6,16,E")


def test_clock_change_arrives_with_page_clock_paused(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"]) as first:
        with play(browser, app_url, world["friend"]) as second:
            times = [page.evaluate("performance.now()") for page in (first, second)]
            set_tick(app_url, world, 6030)
            for page in (first, second):
                expect(view(page)).to_have_attribute("data-creatures", "mossback-newt@12,6,S;reedpipe-heron@9,16,E", timeout=LIVE_MS)
            assert [page.evaluate("performance.now()") for page in (first, second)] == times


def test_device_clock_is_ignored(browser, app_url):
    world = new_world(app_url)
    with visit(browser, app_url, world["friend"], "/signin") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": FAR_ZONE})
        page.clock.set_system_time(f"{FUTURE_YEAR}-03-14T02:00:00Z")
        page.goto(f"{app_url}/play")
        ready(page)
        assert page.evaluate("new Date().getFullYear()") >= FUTURE_YEAR - 1
        target = view(page)
        expect(target).to_have_attribute("data-world-hour", "10")
        expect(target).to_have_attribute("data-weather", "clear")
        expect(page.get_by_role("timer", name="World time", exact=True)).to_have_text("10:00")


def test_dusk_arrives_from_the_server(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"], "/play?island=1&spot=4") as page:
        target = game_focus(page)
        advance(page, STEP_MS)
        morning = decode(capture(target))
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-in-view", "reedpipe-heron")
        page.keyboard.press("c")
        advance(page, CAMERA_GLIDE_MS + STEP_MS)
        morning = decode(capture(target))
        set_tick(app_url, world, 11000)
        expect(region(page, "World status")).to_contain_text("Dusk falls on the islands.", timeout=LIVE_MS)
        expect(target).to_have_attribute("data-world-hour", "18")
        expect(target).to_have_attribute("data-creatures", re.compile(r"gloamfin-moth@18,12,W"))
        expect(page.get_by_role("timer", name="World time", exact=True)).to_have_text("18:20")
        advance(page, STEP_MS)
        dusk = decode(capture(target))
        assert difference(morning, dusk) > 0, "the scene at dusk differs from the scene at 10:00 (L353)"
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-in-view", "gloamfin-moth,reedpipe-heron")
        set_tick(app_url, world, 6000 + DAY_TICKS)
        expect(region(page, "World status")).to_contain_text("Dusk is over.", timeout=LIVE_MS)


def test_rain_arrives_from_the_server(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"]) as page:
        target = view(page)
        expect(target).to_have_attribute("data-weather", "clear")
        set_tick(app_url, world, 4000)
        expect(region(page, "World status")).to_contain_text("Rain begins on the islands.", timeout=LIVE_MS)
        expect(target).to_have_attribute("data-weather", "rain")
        expect(target).to_have_attribute("data-creatures", re.compile(r"puddle-lark@4,4,S"))
        set_tick(app_url, world, 6000)
        expect(region(page, "World status")).to_contain_text("The rain stops.", timeout=LIVE_MS)
        expect(target).to_have_attribute("data-weather", "clear")
        expect(target).not_to_have_attribute("data-creatures", re.compile(r"puddle-lark"))


def test_route_rule_on_the_world_api(app_url):
    world = new_world(app_url)
    api = Api(app_url, world["friend"])
    clock = {6000: ("10:00", "clear", False), 6030: ("10:03", "clear", False), 11000: ("18:20", "clear", True), 4000: ("06:40", "rain", False)}
    for tick in (6000, 6030, 11000, 4000, 0, 5555, 6000 + DAY_TICKS):
        set_tick(app_url, world, tick)
        body = api.get("/api/world").json()
        assert body["tick"] == tick
        wanted = sorted((creature_expected(c, tick) for c in SEED_CREATURES if present_at(c, tick)), key=lambda c: c["id"])
        assert [c["id"] for c in body["creatures"]] == [c["id"] for c in wanted]
        for got, expected in zip(body["creatures"], wanted):
            assert {k: got[k] for k in expected} == expected
        if tick in clock:
            assert (body["time"], body["weather"], body["dusk"]) == clock[tick]
    set_tick(app_url, world, 6000)
    plain = api.get("/api/world").json()
    forged = api.http.get("/api/world", params={"tick": 11000, "weather": "rain", "hour": 18}).json()
    assert forged["tick"] == 6000 and forged["weather"] == "clear" and forged["dusk"] is False
    assert forged["creatures"] == plain["creatures"]
    assert api.get("/api/world").json()["tick"] == 6000, "a grading world stays frozen (L587)"
    assert_error(post_json(app_url, "/api/grading/clock", {"world": f"unknown-{uuid.uuid4().hex}", "tick": 6000}), 404, "not_found")
    assert_error(post_json(app_url, "/api/grading/clock", {"world": world["world"]["id"], "tick": -1}), 422, "bad_request")
    main = Api(app_url, {"email": "ranger@hushfoot.example", "password": "Harbour-Ranger-1"})
    start = main.get("/api/world").json()["tick"]
    poll(lambda: main.get("/api/world").json()["tick"] > start, "the main world's clock advances on server time")


def test_wf_albums_stamps_lighthouse_happy(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    api = Api(app_url, who)
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        other = open_tab(page, app_url)
        expect(view(other)).to_have_attribute("data-lighthouse", "closed")
        assert keyboard_photo(page).status == 201
        expect(view(other)).to_have_attribute("data-lighthouse", "open", timeout=LIVE_MS)
        advance(page, FIGURE_MS)
        expect(figure(other, "stamps")).to_have_text("3 stamps")
        game_focus(other)
        other.keyboard.press("j")
        advance(page, FIGURE_MS)
        expect(figure(other, "album-pages")).to_have_text("4 of 4 pages")
        other.keyboard.press("Escape")
        expect_result(page)
        page.keyboard.press("Escape")
        opener = button(page, "Restart expedition")
        opener.focus()
        page.keyboard.press("Enter")
        restart = button(page.get_by_role("alertdialog", name="Restart the expedition?", exact=True), "Restart")
        restart.focus()
        page.keyboard.press("Enter")
        for tab in (page, other):
            expect(view(tab)).to_have_attribute("data-lighthouse", "closed", timeout=LIVE_MS)
            expect(view(tab)).to_have_attribute("data-tile", "3,12", timeout=LIVE_MS)
        advance(page, FIGURE_MS)
        for tab in (page, other):
            expect(figure(tab, "stamps")).to_have_text("0 stamps")
            expect(figure(tab, "film")).to_have_text("36 frames")
    state = api.get("/api/me").json()
    assert state["stamps"] == 0 and state["film"] == 36 and state["lighthouse"] == "closed"
    assert ledger_sum(who["id"]) == 36
    assert len(api.get("/api/me/photos").json()["photos"]) == 4
    assert len(api.get("/api/me/hall").json()["hall"]["frames"]) == 3


def test_wf_albums_stamps_lighthouse_low_score_then_filled(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    api = Api(app_url, who)
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        response = keyboard_photo(page, zoom_presses=2, focus_presses=1)
        assert response.status == 201
        body = response.json()["photo"]
        assert body["score"]["total"] == 50
        assert body["album"]["page_filled"] is False and body["album"]["stamp_earned"] is False
        expect_result(page)
        advance(page, FIGURE_MS)
        expect(figure(page, "film")).to_have_text("29 frames")
        expect(view(page)).to_have_attribute("data-lighthouse", "closed")
        expect(region(page, "Photo status")).not_to_contain_text("Album page filled")
        assert api.get("/api/me").json()["stamps"] == 2
        page.keyboard.press("Escape")
        page.keyboard.press("c")
        response = keyboard_photo(page)
        assert response.status == 201
        assert response.json()["photo"]["album"] == {"page_filled": True, "pages_filled": 4, "stamp_earned": True}
    assert api.get("/api/me").json()["stamps"] == 3
    assert ledger_sum(who["id"]) == 29 - 1 + 6


def test_page_stamp_and_lighthouse_announcements(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        assert keyboard_photo(page).status == 201
        expect_result(page)
        expect(region(page, "Photo status")).to_contain_text(NEWT_100)
        expect(region(page, "Photo status")).to_contain_text("Album page filled: Mossback newt.")
        status = region(page, "World status")
        expect(status).to_contain_text("Stamp earned for Saltmarsh Harbour. You have 3 stamps.", timeout=LIVE_MS)
        expect(status).to_contain_text("The lighthouse at Lantern Point is open.", timeout=LIVE_MS)
        expect(view(page)).to_have_attribute("data-lighthouse", "open")


def test_other_tab_follows_stamps(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with play(browser, app_url, who) as page:
        expect(figure(page, "stamps")).to_have_text("2 stamps")
        button(page, "Map").focus()
        mark_page(page)
        pin_focus(page)
        response = Api(app_url, who).photo(example_pose(1))
        assert response.status_code == 201
        expect(view(page)).to_have_attribute("data-lighthouse", "open", timeout=LIVE_MS)
        advance(page, FIGURE_MS)
        expect(figure(page, "stamps")).to_have_text("3 stamps")
        assert_no_reload(page)
        assert_focus_kept(page)


def test_film_figure_equals_the_paired_ledger(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    api = Api(app_url, who)
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        expect(figure(page, "film")).to_have_text("30 frames")
        assert keyboard_photo(page).status == 201
        expect_result(page)
        advance(page, FIGURE_MID_MS)
        assert 30 < parse_film(page) < 35
        advance(page, FIGURE_MS - FIGURE_MID_MS)
        expect(figure(page, "film")).to_have_text("35 frames")
        assert_pairs(who["id"])
        assert ledger_sum(who["id"]) == 35
        page.goto(f"{app_url}/play?island=2&spot=1")
        ready(page)
        game_focus(page)
        page.keyboard.press("j")
        expect(button(page, "Refill film")).to_be_disabled()
        assert_error(api.post("/api/me/refill"), 409, "not_at_harbour", "Refill film works only on Saltmarsh Harbour.")
        page.goto(f"{app_url}/play?island=1&spot=1")
        ready(page)
        game_focus(page)
        page.keyboard.press("j")
        refill = button(page, "Refill film")
        expect(refill).to_be_enabled()
        click(refill)
        expect(region(page, "World status")).to_contain_text("Film refilled to 36 frames.")
        advance(page, FIGURE_MS)
        expect(figure(page, "film")).to_have_text("36 frames")
        expect(refill).to_be_disabled()
    assert ledger_sum(who["id"]) == 36
    assert_pairs(who["id"])
    rows_before = Postgres().rows(f"SELECT COUNT(*)::int AS n FROM film_ledger WHERE player_id::text = {sql_text(who['id'])}")[0]["n"]
    assert_error(api.post("/api/me/refill"), 409, "film_full", "Your film is already full.")
    assert Postgres().rows(f"SELECT COUNT(*)::int AS n FROM film_ledger WHERE player_id::text = {sql_text(who['id'])}")[0]["n"] == rows_before


def test_album_tabs_by_keyboard(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"]) as page:
        game_focus(page)
        page.keyboard.press("j")
        tablist = page.get_by_role("tablist", name="Islands", exact=True)
        expect(tablist).to_be_visible()
        assert tablist.evaluate("el => el.contains(document.activeElement)")
        expect(page.get_by_role("tab", name="Saltmarsh Harbour", exact=True)).to_be_focused()
        advance(page, FIGURE_MS)
        expect(figure(page, "album-pages")).to_have_text("3 of 4 pages")
        page.keyboard.press("ArrowRight")
        fernhollow = page.get_by_role("tab", name="Fernhollow", exact=True)
        expect(fernhollow).to_be_focused()
        expect(fernhollow).to_have_attribute("aria-selected", "true")
        advance(page, FIGURE_MS)
        expect(figure(page, "album-pages")).to_have_text("0 of 4 pages")
        page.keyboard.press("ArrowLeft")
        advance(page, FIGURE_MS)
        expect(figure(page, "album-pages")).to_have_text("3 of 4 pages")
        page.keyboard.press("Escape")
        expect(view(page)).to_be_focused()


def test_restart_confirmation_by_keyboard(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with play(browser, app_url, who) as page:
        opener = button(page, "Restart expedition")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("alertdialog", name="Restart the expedition?", exact=True)
        expect(dialog).to_be_visible()
        expect(dialog).to_contain_text("Start the whole expedition again?")
        wraps_inside(page, dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        button(dialog, "Keep playing").focus()
        page.keyboard.press("Enter")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        expect(figure(page, "film")).to_have_text("30 frames")
        expect(figure(page, "stamps")).to_have_text("2 stamps")
    state = Api(app_url, who).get("/api/me").json()
    assert state["film"] == 30 and state["stamps"] == 2


def test_restart_reaches_every_tab_and_the_text_world(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    api = Api(app_url, who)
    with play(browser, app_url, who, "/play?island=1&spot=2") as page:
        other = open_tab(page, app_url)
        words = open_tab(page, app_url, "/text-world", wait_ready=False)
        expect(line(words, "Stamps: 2")).to_be_visible()
        game_focus(other)
        other.keyboard.press("j")
        expect(figure(other, "album-pages")).to_have_text("3 of 4 pages")
        click(button(page, "Restart expedition"))
        click(button(page.get_by_role("alertdialog", name="Restart the expedition?", exact=True), "Restart"))
        for tab in (page, other):
            expect(view(tab)).to_have_attribute("data-tile", "3,12", timeout=LIVE_MS)
            expect(view(tab)).to_have_attribute("data-lighthouse", "closed", timeout=LIVE_MS)
            expect(region(tab, "World status")).to_contain_text("Expedition restarted. You are on Saltmarsh Harbour.", timeout=LIVE_MS)
        expect(line(words, "Stamps: 0")).to_be_visible(timeout=LIVE_MS)
        expect(page).to_have_url(re.compile(r"/play(\?(?!.*island=).*)?$"))
        advance(page, FIGURE_MS)
        for tab in (page, other):
            expect(figure(tab, "film")).to_have_text("36 frames")
            expect(figure(tab, "stamps")).to_have_text("0 stamps")
        expect(figure(other, "album-pages")).to_have_text("0 of 4 pages")
        expect(line(words, "Film: 36 frames")).to_be_visible()
        expect(line(words, "Lighthouse: closed")).to_be_visible()
        expect(line(words, "You are on Saltmarsh Harbour at tile 3, 12.")).to_be_visible()
        expect(words.get_by_text("0 of 4 album pages", exact=True)).to_have_count(5)
        expect(line(words, "Reedpipe heron: always, photographed, best 74 points")).to_be_visible()
    albums = api.get("/api/me/albums").json()
    assert albums["stamps"] == 0 and albums["film"] == 36 and albums["lighthouse"] == "closed"
    assert all(a["pages_filled"] == 0 for a in albums["albums"])
    position = api.get("/api/me").json()["position"]
    assert position["island"] == 1 and position["tile"] == [3, 12]
    assert len(api.get("/api/me/photos").json()["photos"]) == 3
    assert len(api.get("/api/me/hall").json()["hall"]["frames"]) == 3


def hall_item(page: Page, creature: str, frame: int) -> Locator:
    return page.get_by_role("list", name="Hall order", exact=True).get_by_role("listitem", name=f"{creature} photo, frame {frame}", exact=True)


def test_wf_gallery_hall_happy(browser, app_url):
    world = new_world(app_url)
    owner, visitor = world["explorer"], world["friend"]
    with visit(browser, app_url, owner, "/hall") as mine:
        item = hall_item(mine, "Reedpipe heron", 1)
        item.focus()
        mine.keyboard.press("Alt+ArrowDown")
        expect(hall_item(mine, "Reedpipe heron", 2)).to_be_focused()
        click(button(mine, "Save hall"))
        expect(region(mine, "Gallery status")).to_contain_text("Hall saved.")
        with visit(browser, app_url, visitor, f"/hall/{owner['handle']}") as theirs:
            hall = theirs.get_by_role("application", name="Gallery hall", exact=True)
            ready(theirs, hall)
            hung = theirs.get_by_role("list", name="Hung photos", exact=True).get_by_role("listitem")
            expect(hung.nth(0)).to_contain_text("Gloamfin moth")
            expect(hung.nth(1)).to_contain_text("Reedpipe heron")
            hall.focus()
            hold(theirs, "w")
            expect(hall).to_have_attribute("data-tile", "2,11")
            click(button(theirs, "View Reedpipe heron photo"))
            viewer = theirs.get_by_role("dialog", name="Photo viewer", exact=True)
            expect(viewer).to_be_visible()
            theirs.keyboard.press("Escape")
            like = button(theirs, "Like Reedpipe heron photo")
            click(like)
            expect(like).to_have_attribute("aria-pressed", "true")
            expect(region(mine, "Gallery status")).to_contain_text(f"{visitor['name']} liked your Reedpipe heron photo.", timeout=LIVE_MS)
            advance(mine, FIGURE_MS)
            expect(figure(hall_item(mine, "Reedpipe heron", 2), "likes")).to_have_text("1 like")
    heron = world["photos"]["heron"]
    rows = Postgres().rows(f"SELECT visitor_id::text AS visitor FROM likes WHERE photo_id::text = {sql_text(heron)}")
    assert rows == [{"visitor": visitor["id"]}]
    frames = Api(app_url, owner).get("/api/me/hall").json()["hall"]["frames"]
    assert [photo_id(f["photo"]) for f in frames][:2] == [world["photos"]["moth"], heron]


def test_wf_gallery_hall_signed_out_visitor(browser, app_url):
    world = new_world(app_url)
    owner, visitor = world["explorer"], world["friend"]
    path = f"/hall/{owner['handle']}"
    with visit(browser, app_url, None, path) as page:
        click(button(page, "Like Reedpipe heron photo"))
        expect(page).to_have_url(re.compile(r"/signin\?next="))
        page.get_by_role("textbox", name="Email", exact=True).fill(visitor["email"])
        page.get_by_label("Password").fill(visitor["password"])
        click(button(page, "Sign in"))
        expect(page).to_have_url(f"{app_url}{path}", timeout=RESULT_MS)
        like = button(page, "Like Reedpipe heron photo")
        expect(like).to_have_attribute("aria-pressed", "false")
        click(like)
        expect(like).to_have_attribute("aria-pressed", "true")
    heron = world["photos"]["heron"]
    poll(lambda: len(Postgres().rows(f"SELECT 1 AS one FROM likes WHERE photo_id::text = {sql_text(heron)}")) == 1, "one likes row")


def test_reorder_the_hall_by_keyboard(browser, app_url):
    world = new_world(app_url)
    with visit(browser, app_url, world["explorer"], "/hall") as page:
        item = hall_item(page, "Reedpipe heron", 1)
        item.focus()
        page.keyboard.press("Alt+ArrowDown")
        moved = hall_item(page, "Reedpipe heron", 2)
        expect(moved).to_be_focused()
        status = region(page, "Gallery status")
        expect(status).to_contain_text("Reedpipe heron photo moved to frame 2 of 3.")
        expect(hall_item(page, "Gloamfin moth", 1)).to_be_visible()
        button(page, "Save hall").focus()
        page.keyboard.press("Enter")
        expect(status).to_contain_text("Hall saved.")
        page.reload()
        expect(hall_item(page, "Gloamfin moth", 1)).to_be_visible()
        expect(hall_item(page, "Reedpipe heron", 2)).to_be_visible()
        expect(hall_item(page, "Puddle lark", 3)).to_be_visible()


def test_walk_a_hall_by_keys(browser, app_url):
    world = new_world(app_url)
    with visit(browser, app_url, world["friend"], f"/hall/{world['explorer']['handle']}") as page:
        hall = page.get_by_role("application", name="Gallery hall", exact=True)
        ready(page, hall)
        expect(hall).to_have_attribute("data-tile", "2,13")
        hall.focus()
        hold(page, "w")
        expect(hall).to_have_attribute("data-tile", "2,11")
        expect(hall).to_have_attribute("data-heading", "N")
        page.keyboard.press("r")
        hold(page, "w", 20 * STEP_MS)
        expect(hall).to_have_attribute("data-tile", "2,0")
        page.keyboard.press("r")
        hold(page, "a", 10 * STEP_MS)
        expect(hall).to_have_attribute("data-tile", "0,0")
        page.reload()
        ready(page, hall)
        expect(hall).to_have_attribute("data-tile", "2,13")


def test_photo_viewer_by_keyboard(browser, app_url):
    world = new_world(app_url)
    with visit(browser, app_url, world["friend"], f"/hall/{world['explorer']['handle']}") as page:
        opener = button(page, "View Reedpipe heron photo")
        opener.focus()
        page.keyboard.press("Enter")
        viewer = page.get_by_role("dialog", name="Photo viewer", exact=True)
        expect(viewer).to_have_attribute("data-zoom", "1")
        page.keyboard.press("+")
        expect(viewer).to_have_attribute("data-zoom", "2")
        for _ in range(4):
            page.keyboard.press("+")
        expect(viewer).to_have_attribute("data-zoom", "4")
        page.keyboard.press("-")
        expect(viewer).to_have_attribute("data-zoom", "3")
        page.keyboard.press("Escape")
        expect(viewer).to_have_count(0)
        expect(opener).to_be_focused()


def test_like_counts_move_in_place(browser, app_url):
    world = new_world(app_url)
    owner, visitor = world["explorer"], world["friend"]
    with visit(browser, app_url, owner, "/hall") as mine:
        figure_loc = figure(hall_item(mine, "Reedpipe heron", 1), "likes")
        expect(figure_loc).to_have_text("0 likes")
        button(mine, "Save hall").focus()
        mine.evaluate("window.scrollTo(0, 40)")
        scroll = mine.evaluate("window.scrollY")
        mark_page(mine)
        pin_focus(mine)
        with visit(browser, app_url, visitor, f"/hall/{owner['handle']}") as theirs:
            click(button(theirs, "Like Reedpipe heron photo"))
            message = f"{visitor['name']} liked your Reedpipe heron photo."
            status = region(mine, "Gallery status")
            expect(status).to_contain_text(message, timeout=LIVE_MS)
            advance(mine, FIGURE_MS)
            expect(figure_loc).to_have_text("1 like")
            assert status.inner_text().count(message) == 1
        assert_no_reload(mine)
        assert_focus_kept(mine)
        assert mine.evaluate("window.scrollY") == scroll


def test_one_like_per_visitor_and_request_scoped_readers(browser, app_url):
    world = new_world(app_url)
    owner, visitor, third = world["explorer"], world["friend"], world["rival"]
    heron = world["photos"]["heron"]
    path = f"/hall/{owner['handle']}"
    likes = lambda: Postgres().rows(f"SELECT visitor_id::text AS visitor FROM likes WHERE photo_id::text = {sql_text(heron)}")
    assert_error(Api(app_url, owner).put(f"/api/photos/{heron}/like"), 403, "own_photo", "You can't like your own photo.")
    with visit(browser, app_url, owner, "/hall") as mine, visit(browser, app_url, visitor, path) as first:
        second = open_tab(first, app_url, path, wait_ready=False)
        click(button(first, "Like Reedpipe heron photo"))
        expect(button(second, "Like Reedpipe heron photo")).to_have_attribute("aria-pressed", "true", timeout=LIVE_MS)
        repeat = second.context.request.put(f"{app_url}/api/photos/{heron}/like", data={})
        assert repeat.status == 200 and repeat.json() == {"likes": 1, "liked": True}
        assert likes() == [{"visitor": visitor["id"]}]
        figure_loc = figure(hall_item(mine, "Reedpipe heron", 1), "likes")
        advance(mine, FIGURE_MS)
        expect(figure_loc).to_have_text("1 like")
        click(button(second, "Like Reedpipe heron photo"))
        expect(button(first, "Like Reedpipe heron photo")).to_have_attribute("aria-pressed", "false", timeout=LIVE_MS)
        expect(region(mine, "Gallery status")).to_be_attached()
        deadline = time.monotonic() + LIVE_MS / 1000
        while time.monotonic() < deadline:
            advance(mine, STEP_MS)
            if figure_loc.inner_text() == "0 likes":
                break
        advance(mine, FIGURE_MS)
        expect(figure_loc).to_have_text("0 likes")
        assert likes() == []
    readers = {"owner": Api(app_url, owner), "visitor": Api(app_url, visitor), "third": Api(app_url, third)}
    assert readers["visitor"].put(f"/api/photos/{heron}/like").status_code == 200
    expectations = {
        "owner": (owner, False, 30),
        "visitor": (visitor, True, 36),
        "third": (third, False, 36),
    }

    def read(role: str) -> None:
        who, liked, film = expectations[role]
        hall = readers[role].get(f"/api/halls/{owner['handle']}").json()["hall"]
        frame = next(f for f in hall["frames"] if photo_id(f["photo"]) == heron)
        assert frame["liked_by_me"] is liked, role
        me = readers[role].get("/api/me").json()
        assert me["player"]["id"] == who["id"] and me["film"] == film, role

    with ThreadPoolExecutor(6) as pool:
        list(pool.map(read, list(expectations) * 15))
    for who, film in ((visitor, 36), (third, 36)):
        with visit(browser, app_url, who, "/") as page:
            click(page.get_by_role("button", name="Account"))
            menu = page.get_by_role("menu", name="Account", exact=True)
            expect(menu).to_be_visible()
            expect(page.get_by_role("button", name="Account")).to_contain_text(who["name"])
            expect(menu).to_contain_text(str(film))


def test_public_hall_switch(browser, app_url):
    world = new_world(app_url)
    owner, visitor = world["explorer"], world["friend"]
    api = Api(app_url, visitor)
    moth = world["photos"]["moth"]
    path = f"/hall/{owner['handle']}"
    with visit(browser, app_url, owner, "/hall") as mine, visit(browser, app_url, visitor, path) as theirs:
        switch = mine.get_by_role("switch", name="Public hall", exact=True)
        expect(switch).to_be_checked()
        assert api.get(f"/api/photos/{moth}/image").status_code == 200
        click(switch)
        expect(region(mine, "Gallery status")).to_contain_text("Hall is now private.")
        assert_error(api.get(f"/api/halls/{owner['handle']}"), 404, "not_found")
        assert_error(api.get(f"/api/photos/{moth}/image"), 404, "not_found")
        assert httpx.get(f"{app_url}/api/photos/{moth}/image", timeout=HTTP_TIMEOUT).status_code == 404
        assert Api(app_url, owner).get(f"/api/photos/{moth}/image").status_code == 200
        theirs.reload()
        expect(theirs.get_by_role("heading", name="No gallery here", exact=True)).to_be_visible()
        click(switch)
        expect(region(mine, "Gallery status")).to_contain_text("Hall is now public.")
        assert api.get(f"/api/halls/{owner['handle']}").status_code == 200
        assert api.get(f"/api/photos/{moth}/image").status_code == 200
        theirs.reload()
        expect(button(theirs, "Like Gloamfin moth photo")).to_be_visible()


def test_wf_shared_safari_happy(browser, app_url):
    world = new_world(app_url)
    host, guest = world["explorer"], world["friend"]
    code = world["safari"]["code"]
    rival = Api(app_url, world["rival"])
    with play(browser, app_url, host) as mine, play(browser, app_url, guest) as theirs:
        expect(mine.get_by_role("region", name="Safari", exact=True)).to_contain_text(f"Safari code {code}")
        join_by_keys(theirs, code)
        expect(region(theirs, "Safari status")).to_contain_text(f"You joined {host['name']}'s safari.")
        expect(region(mine, "Safari status")).to_contain_text(f"{guest['name']} joined your safari.", timeout=LIVE_MS)
        dismiss_dialog(theirs, theirs.get_by_role("dialog", name="Join a safari", exact=True))
        assert_error(rival.post(f"/api/safaris/{code}/join"), 409, "safari_full", "That safari is full.")
        game_focus(mine)
        hold(mine, "d")
        expect(view(theirs)).to_have_attribute("data-host-tile", "5,12", timeout=LIVE_MS)
        posted = Api(app_url, host).post(f"/api/safaris/{code}/sightings", {"island": 1, "tile": [9, 9]})
        assert posted.status_code == 201
        expect(theirs.get_by_role("list", name="Sightings", exact=True)).to_contain_text(f"Sighting at 9, 9 by {host['name']}", timeout=LIVE_MS)
        response = Api(app_url, host).photo(example_pose(1))
        assert response.status_code == 201
        feed = theirs.get_by_role("log", name="Safari feed", exact=True)
        expect(feed).to_contain_text(f"{host['name']} photographed Mossback newt: 100 points.", timeout=LIVE_MS)
        click(button(theirs.get_by_role("region", name="Safari", exact=True), "Leave safari"))
        expect(region(mine, "Safari status")).to_contain_text(f"{guest['name']} left. The guest seat is free.", timeout=LIVE_MS)
    joined = rival.post(f"/api/safaris/{code}/join")
    assert joined.status_code == 200, joined.text
    assert joined.json()["safari"]["status"] == "joined"
    assert joined.json()["safari"]["guest"]


def test_wf_shared_safari_host_ends(browser, app_url):
    world = new_world(app_url)
    host, guest = world["explorer"], world["friend"]
    code = world["safari"]["code"]
    api = Api(app_url, host)
    with play(browser, app_url, host) as mine:
        click(button(mine.get_by_role("region", name="Safari", exact=True), "End safari"))
        expect(region(mine, "Safari status")).to_contain_text("Safari ended.")
    assert_error(Api(app_url, guest).post(f"/api/safaris/{code}/join"), 409, "safari_ended", "That safari has ended.")
    assert_error(api.post(f"/api/safaris/{code}/sightings", {"island": 1, "tile": [9, 9]}), 409, "safari_ended")
    assert_error(api.post(f"/api/safaris/{code}/end"), 409, "safari_ended")


def test_join_a_safari_by_keyboard(browser, app_url):
    world = new_world(app_url)
    host, guest = world["explorer"], world["friend"]
    code = world["safari"]["code"]
    with play(browser, app_url, guest) as page:
        game_focus(page)
        page.keyboard.press("m")
        opener = button(page, "Join a safari")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Join a safari", exact=True)
        field = page.get_by_role("textbox", name="Safari code", exact=True)
        expect(field).to_be_focused()
        wraps_inside(page, dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(field).to_be_focused()
        page.keyboard.type(WRONG_CODE)
        page.keyboard.press("Enter")
        expect(region(page, "Safari status")).to_contain_text("No safari with that code.")
        expect(field).to_be_focused()
        fill(field, "")
        field.focus()
        page.keyboard.type(code.lower())
        page.keyboard.press("Enter")
        expect(region(page, "Safari status")).to_contain_text(f"You joined {host['name']}'s safari.")
        dismiss_dialog(page, dialog)
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
    current = Api(app_url, host).get("/api/safaris/current").json()["safari"]
    assert current["status"] == "joined" and current["guest"]


def test_host_position_arrives_live(browser, app_url):
    world = new_world(app_url)
    host, guest = world["explorer"], world["friend"]
    with play(browser, app_url, host) as mine, play(browser, app_url, guest) as theirs:
        expect(view(theirs)).to_have_attribute("data-host-tile", "")
        joined = Api(app_url, guest).post(f"/api/safaris/{world['safari']['code']}/join")
        assert joined.status_code == 200
        mark_page(theirs)
        game_focus(mine)
        next_step(mine)
        mine.keyboard.down("d")
        for wanted in ("4,12", "4,12", "5,12", "5,12", "6,12"):
            assert next_step(mine)["tile"] == wanted
            expect(view(theirs)).to_have_attribute("data-host-tile", wanted, timeout=LIVE_MS)
            expect(view(theirs)).to_have_attribute("data-host-island", "1")
        mine.keyboard.up("d")
        expect(view(theirs)).to_have_attribute("data-tile", "3,12")
        expect(view(mine)).to_have_attribute("data-host-tile", "")
        assert_no_reload(theirs)


def test_sightings_by_map_keyboard(browser, app_url):
    world = new_world(app_url)
    host, guest = world["explorer"], world["friend"]
    code = world["safari"]["code"]
    wanted = f"Sighting at 4, 11 by {host['name']}"
    guest_api = Api(app_url, guest)
    assert guest_api.post(f"/api/safaris/{code}/join").status_code == 200
    with play(browser, app_url, host) as mine, play(browser, app_url, guest) as theirs:
        lists = [page.get_by_role("list", name="Sightings", exact=True) for page in (mine, theirs)]
        for sightings in lists:
            expect(sightings).to_contain_text(f"Sighting at 12, 6 by {host['name']}", timeout=LIVE_MS)
        kept = [sightings.get_by_role("listitem").first.element_handle() for sightings in lists]
        game_focus(mine)
        mine.keyboard.press("m")
        island_map = mine.get_by_role("application", name="Island map", exact=True)
        expect(island_map).to_be_focused()
        expect(island_map).to_have_attribute("data-cursor", "3,12")
        mine.keyboard.press("ArrowRight")
        mine.keyboard.press("ArrowUp")
        expect(island_map).to_have_attribute("data-cursor", "4,11")
        mine.keyboard.press("s")
        for page, sightings, handle in zip((mine, theirs), lists, kept):
            expect(sightings).to_contain_text(wanted, timeout=LIVE_MS)
            expect(region(page, "Safari status")).to_contain_text(wanted, timeout=LIVE_MS)
            assert handle.evaluate("el => el.isConnected"), "a live change never replaces a list wholesale (L251)"
        game_focus(theirs)
        theirs.keyboard.press("m")
        expect(theirs.get_by_role("application", name="Island map", exact=True)).to_be_focused()
        theirs.keyboard.press("s")
        assert_error(guest_api.post(f"/api/safaris/{code}/sightings", {"island": 1, "tile": [5, 5]}), 403, "not_host", "Only the host can do that.")
    current = Api(app_url, host).get("/api/safaris/current").json()["safari"]
    assert sorted((s["x"], s["y"]) for s in current["sightings"]) == [(4, 11), (12, 6)]


def test_host_photos_reach_the_guest(browser, app_url):
    world = new_world(app_url)
    host, guest = world["explorer"], world["friend"]
    code = world["safari"]["code"]
    host_api = Api(app_url, host)
    guest_api = Api(app_url, guest)
    before = host_api.photo(make_pose([12, 10], "N", 1, 4, 6000))
    assert before.status_code == 201
    assert guest_api.post(f"/api/safaris/{code}/join").status_code == 200
    with play(browser, app_url, guest) as theirs:
        feed = theirs.get_by_role("log", name="Safari feed", exact=True)
        game_focus(theirs)
        theirs.keyboard.press("j")
        tablist = theirs.get_by_role("tablist", name="Islands", exact=True)
        expect(tablist).to_be_visible()
        pin_focus(theirs)
        kept = []
        for pose, creature, total in ((example_pose(1), "Mossback newt", 100), (make_pose([8, 20], "N", 1, 4, 6000), "Reedpipe heron", 70)):
            response = host_api.photo(pose)
            assert response.status_code == 201
            kept.append(response.json()["photo"])
            expect(feed).to_contain_text(f"{host['name']} photographed {creature}: {total} points.", timeout=LIVE_MS)
            image = feed.get_by_role("img", name=f"{creature} photo by {host['name']}", exact=True)
            expect(image).to_be_attached(timeout=LIVE_MS)
            assert same_origin(image.evaluate("el => el.currentSrc || el.src"), app_url)
            assert_focus_kept(theirs)
            expect(tablist).to_be_visible()
        expect(feed).not_to_contain_text("80 points")
    for photo in kept:
        assert guest_api.get(photo["image_url"]).status_code == 200
    assert_error(Api(app_url, world["rival"]).get(kept[0]["image_url"]), 404, "not_found")


def test_one_winner_for_the_last_seat(browser, app_url):
    world = new_world(app_url)
    code = world["safari"]["code"]
    host = world["explorer"]
    with play(browser, app_url, world["friend"]) as first, play(browser, app_url, world["rival"]) as second:
        answers: list[int] = []
        for page in (first, second):
            page.on("response", lambda r: answers.append(r.status) if urlparse(r.url).path.endswith("/join") else None)
        pattern = re.compile(rf"You joined {re.escape(host['name'])}'s safari\.|That safari is full\.")
        with held(first, "**/api/safaris/*/join") as first_gate, held(second, "**/api/safaris/*/join") as second_gate:
            join_by_keys(first, code)
            join_by_keys(second, code)
            release(first_gate)
            release(second_gate)
            expect(region(first, "Safari status")).to_contain_text(pattern)
            expect(region(second, "Safari status")).to_contain_text(pattern)
        texts = [region(first, "Safari status").inner_text(), region(second, "Safari status").inner_text()]
        assert sum("That safari is full." in t for t in texts) == 1, texts
        assert sum("You joined" in t for t in texts) == 1, texts
        assert sorted(answers) == [200, 409]
    assert Api(app_url, host).get("/api/safaris/current").json()["safari"]["guest"]

    world = new_world(app_url)
    code = world["safari"]["code"]
    players = [Api(app_url, world[name]) for name in ("friend", "rival", "ranger", "ranger2")]
    with ThreadPoolExecutor(4) as pool:
        results = list(pool.map(lambda api: api.post(f"/api/safaris/{code}/join"), players))
    assert sorted(r.status_code for r in results) == [200, 409, 409, 409]
    for result in results:
        if result.status_code == 409:
            assert_error(result, 409, "safari_full", "That safari is full.")
    winner = players[[r.status_code for r in results].index(200)]
    assert winner.get("/api/safaris/current").json()["safari"]["guest"]


@pytest.mark.timeout(300)
def test_closed_guest_page_frees_seat_and_connection(browser):
    base = short_limits_url()
    world = new_world(base)
    host, guest = world["explorer"], world["friend"]
    code = world["safari"]["code"]
    host_api = Api(base, host)
    rival = Api(base, world["rival"])
    with play(browser, base, host) as mine:
        with play(browser, base, guest) as theirs:
            joined = time.monotonic()
            assert theirs.context.request.post(f"{base}/api/safaris/{code}/join", data={}).status == 200
            expect(region(mine, "Safari status")).to_contain_text(f"{guest['name']} joined your safari.", timeout=LIVE_MS)
            theirs.close()
            closed = time.monotonic()
            assert_error(rival.post(f"/api/safaris/{code}/join"), 409, "safari_full")
            poll(lambda: host_api.get("/api/safaris/current").json()["safari"]["guest"] is None, "the seat frees after the guest's page closes", SEAT_MAX_SECONDS + 5)
            freed = time.monotonic()
            assert freed - joined >= SEAT_MIN_SECONDS, freed - joined
            assert freed - closed <= SEAT_MAX_SECONDS, freed - closed
            expect(region(mine, "Safari status")).to_contain_text(f"{guest['name']} left. The guest seat is free.", timeout=LIVE_MS)
    assert rival.post(f"/api/safaris/{code}/join").status_code == 200
    streamer = Api(base, guest)
    for _ in range(10):
        with streamer.http.stream("GET", "/api/live") as stream:
            assert stream.status_code == 200
            for _chunk in stream.iter_raw():
                break
    observer = Postgres("_short")
    sql = "SELECT pid FROM pg_stat_activity WHERE datname = current_database() AND usename <> current_user AND state IN ('active', 'idle in transaction', 'idle in transaction (aborted)')"
    poll(lambda: not observer.rows(sql), "no app session active or idle in transaction after ten closed streams")
    assert httpx.get(f"{base}/signin", timeout=HTTP_TIMEOUT).status_code == 200


@pytest.mark.timeout(120)
def test_returning_guest_keeps_the_seat():
    base = short_limits_url()
    world = new_world(base)
    host_api = Api(base, world["explorer"])
    guest = Api(base, world["friend"])
    assert guest.post(f"/api/safaris/{world['safari']['code']}/join").status_code == 200
    with guest.http.stream("GET", "/api/live") as stream:
        for _chunk in stream.iter_raw():
            break
    with guest.http.stream("GET", "/api/live") as stream:
        chunks = stream.iter_raw()
        next(chunks)
        deadline = time.monotonic() + SEAT_MAX_SECONDS + 1
        while time.monotonic() < deadline:
            assert host_api.get("/api/safaris/current").json()["safari"]["guest"], "the returning guest lost the seat (L647)"


def waiting_item(page: Page, words: str) -> Locator:
    return page.get_by_role("list", name="Waiting notes", exact=True).get_by_role("listitem").filter(has_text=words)


def pin_by_keys(page: Page, words: str) -> None:
    box = page.get_by_role("textbox", name="Your note", exact=True)
    box.focus()
    page.keyboard.type(words)
    button(page, "Pin note").focus()
    page.keyboard.press("Enter")


def test_wf_notice_board_pin_and_approve(browser, app_url):
    world = new_world(app_url)
    words = f"Tide table {uuid.uuid4().hex[:8]}"
    friend_api = Api(app_url, world["friend"])
    with visit(browser, app_url, world["explorer"], "/board") as author, visit(browser, app_url, world["friend"], "/board") as reader:
        pin_by_keys(author, words)
        expect(region(author, "Notes status")).to_contain_text("Note pinned.")
        board = reader.get_by_role("list", name="Notice board", exact=True)
        expect(board).not_to_contain_text(words)
        assert words not in [n["text"] for n in friend_api.get("/api/notes").json()["notes"]]
        with visit(browser, app_url, world["ranger"], "/ranger") as ranger:
            click(button(waiting_item(ranger, words), "Approve"))
            expect(board).to_contain_text(words, timeout=LIVE_MS)
    note = next(n for n in friend_api.get("/api/notes").json()["notes"] if n["text"] == words)
    assert note["status"] == "approved"


def test_wf_notice_board_decline_is_told(browser, app_url):
    world = new_world(app_url)
    words = "Seal pups on the dock at low tide."
    with visit(browser, app_url, world["friend"], "/board") as author:
        with visit(browser, app_url, world["ranger"], "/ranger") as ranger:
            click(button(waiting_item(ranger, words), "Decline"))
            ranger.get_by_role("radio", name="Unkind", exact=True).check()
            click(button(ranger.get_by_role("dialog", name="Decline note", exact=True), "Decline note"))
            expect(region(author, "Notes status")).to_contain_text("Your note was declined: Unkind.", timeout=LIVE_MS)
    own = next(n for n in Api(app_url, world["friend"]).get("/api/notes").json()["notes"] if n["text"] == words)
    assert own["status"] == "declined" and own["reason"] == "Unkind"
    assert words not in [n["text"] for n in Api(app_url, world["explorer"]).get("/api/notes").json()["notes"]]


def test_pin_a_note_by_keyboard_shown_as_typed(browser, app_url):
    world = new_world(app_url)
    words = "<b>Low</b> tide **today**"
    author_api = Api(app_url, world["explorer"])
    with visit(browser, app_url, world["explorer"], "/board") as page:
        posts = requests_to(page, "POST", "/api/notes")
        box = page.get_by_role("textbox", name="Your note", exact=True)
        box.focus()
        page.keyboard.type(words)
        pin = button(page, "Pin note")
        pin.focus()
        with held(page, "**/api/notes") as gate:
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            expect(region(page, "Notes status")).to_contain_text("Pinning…")
            release(gate)
            expect(region(page, "Notes status")).to_contain_text("Note pinned.")
        assert len(posts) == 1
        expect(box).to_have_value("")
        expect(box).to_be_focused()
        item = page.get_by_role("list", name="Notice board", exact=True).get_by_role("listitem").filter(has_text=words)
        expect(item).to_have_count(1)
        expect(item).to_contain_text("Waiting for a ranger")
        assert item.evaluate("el => el.querySelector('b') === null")
        box.focus()
        page.keyboard.type(words[:11])
        with visit(browser, app_url, world["friend"], "/board") as other:
            expect(other.get_by_role("list", name="Notice board", exact=True)).not_to_contain_text(words)
        assert Api(app_url, world["ranger"]).post(f"/api/notes/{world['notes']['pending']}/approve").status_code == 200
        expect(region(page, "Notes status")).to_contain_text("New note on the board.", timeout=LIVE_MS)
        set_tick(app_url, world, 6030)
        advance(page, FIGURE_MS)
        expect(box).to_have_value(words[:11])
        expect(box).to_be_focused()
    mine = [n for n in author_api.get("/api/notes").json()["notes"] if n["text"] == words]
    assert len(mine) == 1 and mine[0]["status"] == "pending"
    assert words not in [n["text"] for n in Api(app_url, world["friend"]).get("/api/notes").json()["notes"]]
    key = idempotency_key()
    body = {"text": "Replay of one draft."}
    first = author_api.post("/api/notes", body, Request_Key=key)
    assert first.status_code == 201
    again = author_api.post("/api/notes", body, Request_Key=key)
    assert again.status_code == 201 and again.json() == first.json()
    assert_error(author_api.post("/api/notes", {"text": "Another draft."}, Request_Key=key), 409, "request_key_reused", "That request key was already used for something else.")
    assert len([n for n in author_api.get("/api/notes").json()["notes"] if n["text"] == body["text"]]) == 1


def test_approved_notes_arrive_live(browser, app_url):
    world = new_world(app_url)
    words = "<b>Low</b> tide **today**"
    author = Api(app_url, world["explorer"])
    note = author.post("/api/notes", {"text": words}).json()["note"]
    with visit(browser, app_url, world["friend"], "/board") as reader, visit(browser, app_url, world["explorer"], "/board") as writer:
        board = reader.get_by_role("list", name="Notice board", exact=True)
        kept = board.get_by_role("listitem").filter(has_text="Fresh water at the harbour tap.").element_handle()
        expect(board).not_to_contain_text(words)
        with visit(browser, app_url, world["ranger"], "/ranger") as ranger:
            approve = button(waiting_item(ranger, words), "Approve")
            approve.focus()
            ranger.keyboard.press("Enter")
            item = board.get_by_role("listitem").filter(has_text=words)
            expect(item).to_have_count(1, timeout=LIVE_MS)
            assert item.evaluate("el => el.querySelector('b') === null")
            expect(region(reader, "Notes status")).to_contain_text("New note on the board.", timeout=LIVE_MS)
            expect(region(writer, "Notes status")).to_contain_text("Your note is on the board.", timeout=LIVE_MS)
            expect(region(ranger, "Notes status")).to_contain_text("Note approved.")
            assert kept.evaluate("el => el.isConnected")
    assert_error(Api(app_url, world["friend"]).post(f"/api/notes/{note['id']}/approve"), 403, "not_ranger", "Only rangers can do that.")


def test_decline_by_keyboard_with_a_reason(browser, app_url):
    world = new_world(app_url)
    words = "Seal pups on the dock at low tide."
    pending = world["notes"]["pending"]
    assert_error(Api(app_url, world["ranger"]).post(f"/api/notes/{pending}/decline", {"reason": "Boring"}), 422, "bad_reason", "Choose a reason.")
    with visit(browser, app_url, world["friend"], "/board") as author, visit(browser, app_url, world["ranger"], "/ranger") as ranger:
        opener = button(waiting_item(ranger, words), "Decline")
        opener.focus()
        ranger.keyboard.press("Enter")
        dialog = ranger.get_by_role("dialog", name="Decline note", exact=True)
        expect(dialog).to_be_visible()
        expect(dialog.get_by_role("radiogroup", name="Reason", exact=True)).to_be_visible()
        wraps_inside(ranger, dialog)
        ranger.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        ranger.keyboard.press("Enter")
        radio = dialog.get_by_role("radio", name="Shares personal details", exact=True)
        radio.focus()
        ranger.keyboard.press("Space")
        expect(radio).to_be_checked()
        button(dialog, "Decline note").focus()
        ranger.keyboard.press("Enter")
        expect(region(author, "Notes status")).to_contain_text("Your note was declined: Shares personal details.", timeout=LIVE_MS)
        expect(region(ranger, "Notes status")).to_contain_text("Note declined.")
    own = next(n for n in Api(app_url, world["friend"]).get("/api/notes").json()["notes"] if n["id"] == pending)
    assert own["status"] == "declined" and own["reason"] == "Shares personal details"


def test_two_rangers_on_one_note(browser, app_url):
    world = new_world(app_url)
    words = "Seal pups on the dock at low tide."
    pending = world["notes"]["pending"]
    first, second = world["ranger"], world["ranger2"]
    message = f"Already approved by {first['name']}."
    with visit(browser, app_url, second, "/ranger") as page:
        with held(page, f"**/api/notes/{pending}/approve") as gate:
            click(button(waiting_item(page, words), "Approve"))
            winner = Api(app_url, first).post(f"/api/notes/{pending}/approve")
            assert winner.status_code == 200 and winner.json()["note"]["status"] == "approved"
            release(gate)
            expect(region(page, "Notes status")).to_contain_text(message)
    assert_error(Api(app_url, second).post(f"/api/notes/{pending}/decline", {"reason": "Unkind"}), 409, "note_decided", message)
    assert next(n for n in Api(app_url, world["friend"]).get("/api/notes").json()["notes"] if n["id"] == pending)["status"] == "approved"
    note = Api(app_url, world["explorer"]).post("/api/notes", {"text": "Two rangers at once."}).json()["note"]
    rangers = [Api(app_url, first), Api(app_url, second)]
    with ThreadPoolExecutor(2) as pool:
        answers = list(pool.map(lambda api: api.post(f"/api/notes/{note['id']}/approve"), rangers))
    assert sorted(r.status_code for r in answers) == [200, 409]
    assert next(r for r in answers if r.status_code == 409).json()["error"] == "note_decided"


def test_note_length_limit(browser, app_url):
    world = new_world(app_url)
    api = Api(app_url, world["explorer"])
    with visit(browser, app_url, world["explorer"], "/board") as page:
        pin_by_keys(page, "x" * 141)
        expect(region(page, "Notes status")).to_contain_text("Notes can be at most 140 characters.")
        assert "x" * 141 not in [n["text"] for n in api.get("/api/notes").json()["notes"]]
        box = page.get_by_role("textbox", name="Your note", exact=True)
        fill(box, "y" * 140)
        click(button(page, "Pin note"))
        expect(region(page, "Notes status")).to_contain_text("Note pinned.")
        fill(box, "   ")
        click(button(page, "Pin note"))
        expect(region(page, "Notes status")).to_contain_text("Write a note first.")
    assert "y" * 140 in [n["text"] for n in api.get("/api/notes").json()["notes"]]
    body = json.dumps({"text": "Body at the size limit."})
    exact = body + " " * (JSON_LIMIT - len(body))
    allowed = api.http.post("/api/notes", content=exact, headers={"Content-Type": "application/json"})
    assert allowed.status_code == 201, allowed.text
    over = api.http.post("/api/notes", content=exact + " ", headers={"Content-Type": "application/json"})
    assert_error(over, 413, "too_large", "That request is too large.")


def test_unconfirmed_players_cannot_pin(browser, app_url):
    world = new_world(app_url)
    words = "A newcomer's first note."
    message = "Confirm your email to post postcards, pin notes and enter boards."
    api = Api(app_url, world["newcomer"])
    with visit(browser, app_url, world["newcomer"], "/board") as page:
        with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == "/api/notes") as info:
            pin_by_keys(page, words)
        assert info.value.status == 403
        expect(region(page, "Notes status")).to_contain_text(message)
    assert_error(api.post("/api/notes", {"text": words}), 403, "unconfirmed", message)
    assert words not in [n["text"] for n in api.get("/api/notes").json()["notes"]]
    assert words not in [n["text"] for n in Api(app_url, world["ranger"]).get("/api/ranger/notes").json()["notes"]]


def post_ok(api: Api, photo: str, recipient: str, words: str, **headers: str) -> dict[str, Any]:
    response = api.post("/api/postcards", {"photo": photo, "recipient": recipient, "line": words}, **headers)
    assert response.status_code == 201, response.text
    return response.json()["postcard"]


def test_wf_postcards_happy(browser, app_url, mail):
    world = new_world(app_url)
    who = world["explorer"]
    recipient = fresh_email()
    words = "Saw this at dusk, thinking of you."
    with play(browser, app_url, who) as page:
        open_postcard_by_keys(page, "Gloamfin moth")
        write_postcard(page, recipient, words)
        page.keyboard.press("Enter")
        expect(region(page, "Postcard status")).to_have_text("Postcard posted.", timeout=RESULT_MS)
    messages = mail_to(mail, recipient)
    assert len(messages) == 1
    match = re.search(r"/postcards/([^\s]+)", text(messages[0]))
    assert match, "the message carries the postcard link (L672)"
    with visit(browser, app_url, None, f"/postcards/{match.group(1)}") as public:
        body = public.locator("body")
        expect(body).to_contain_text("Gloamfin moth")
        expect(body).to_contain_text("81")
        expect(body).to_contain_text("Saltmarsh Harbour")
        expect(body).to_contain_text(words)
        expect(body).to_contain_text(f"Sent by {who['name']}")
        assert who["email"] not in public.content()


def test_wf_postcards_invalid_then_fixed(browser, app_url, mail):
    world = new_world(app_url)
    recipient = fresh_email()
    with play(browser, app_url, world["explorer"]) as page:
        open_postcard_by_keys(page, "Gloamfin moth")
        status = region(page, "Postcard status")
        write_postcard(page, "not-an-address", "Hello from the harbour.")
        page.keyboard.press("Enter")
        expect(status).to_have_text("Enter a valid email address.")
        fill(page.get_by_role("textbox", name="Recipient email", exact=True), recipient)
        fill(page.get_by_role("textbox", name="Your line", exact=True), "   ")
        click(button(page, "Post"))
        expect(status).to_have_text("Write a line for your postcard.")
        no_mail_to(mail, recipient)
        fill(page.get_by_role("textbox", name="Your line", exact=True), "Hello from the harbour.")
        click(button(page, "Post"))
        expect(status).to_have_text("Postcard posted.", timeout=RESULT_MS)
    assert len(mail_to(mail, recipient)) == 1


def test_post_by_keyboard_once(browser, app_url, mail):
    world = new_world(app_url)
    who = world["explorer"]
    recipient = fresh_email()
    words = "One press or two, one postcard."
    with play(browser, app_url, who) as page:
        opener = open_postcard_by_keys(page, "Gloamfin moth")
        dialog = page.get_by_role("dialog", name="Send postcard", exact=True)
        wraps_inside(page, dialog)
        page.keyboard.press("Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(page.get_by_role("textbox", name="Recipient email", exact=True)).to_be_focused()
        posts = requests_to(page, "POST", "/api/postcards")
        write_postcard(page, recipient, words)
        status = region(page, "Postcard status")
        with held(page, "**/api/postcards") as gate:
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            expect(status).to_have_text("Posting…")
            no_mail_to(mail, recipient)
            release(gate)
            expect(status).to_have_text("Postcard posted.", timeout=RESULT_MS)
        assert len(posts) == 1
        assert posts[0].headers.get("request-key"), "each draft carries one Request-Key (L316)"
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        assert status.inner_text().count("Postcard posted.") == 1
    assert len(mail_to(mail, recipient)) == 1
    api = Api(app_url, who)
    second = fresh_email()
    key = idempotency_key()
    first = post_ok(api, world["photos"]["moth"], second, "Replay this.", Request_Key=key)
    assert post_ok(api, world["photos"]["moth"], second, "Replay this.", Request_Key=key) == first
    conflict = api.post("/api/postcards", {"photo": world["photos"]["moth"], "recipient": second, "line": "Other."}, Request_Key=key)
    assert_error(conflict, 409, "request_key_reused", "That request key was already used for something else.")
    assert len(mail_to(mail, second)) == 1


def test_postcard_message_content(app_url, mail):
    world = new_world(app_url)
    who = world["explorer"]
    recipient = fresh_email()
    words = "Back <i>soon</i> **dear**"
    moth = world["photos"]["moth"]
    card = post_ok(Api(app_url, who), moth, recipient, words)
    messages = mail_to(mail, recipient)
    assert len(messages) == 1
    message = messages[0]
    assert mail_from_address() in addresses(message.get("From"))
    assert message["Subject"] == f"A postcard from {who['name']} on Saltmarsh Harbour"
    body = text(message)
    assert words in body
    assert "Gloamfin moth, 81 points" in body
    assert f"/postcards/{card['id']}" in body
    assert not message.get("HTML")
    assert not message.get("ReplyTo")
    assert who["email"] not in json.dumps(message)
    stored = S3().get(stored_key(moth))
    attachments = message.get("Attachments", [])
    assert len(attachments) == 1 and attachments[0]["Size"] == len(stored), attachments
    mailpit = os.environ.get("MAILPIT_URL")
    if mailpit:
        part = httpx.get(f"{mailpit.rstrip('/')}/api/v1/message/{message['ID']}/part/{attachments[0]['PartID']}", timeout=HTTP_TIMEOUT)
        assert part.status_code == 200 and part.content == stored


def test_public_postcard_page(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    words = "Back <i>soon</i> **dear**"
    moth = world["photos"]["moth"]
    card = post_ok(Api(app_url, who), moth, fresh_email(), words)
    answer = httpx.get(f"{app_url}/api/postcards/{card['id']}", timeout=HTTP_TIMEOUT)
    assert answer.status_code == 200
    public = answer.json()["postcard"]
    assert public["creature_name"] == "Gloamfin moth" and public["total"] == 81
    assert public["island_name"] == "Saltmarsh Harbour" and public["line"] == words and public["sender_name"] == who["name"]
    assert who["email"] not in answer.text
    assert httpx.get(f'{app_url}{public["image_url"]}', timeout=HTTP_TIMEOUT).content == S3().get(stored_key(moth))
    with visit(browser, app_url, None, f"/postcards/{card['id']}") as page:
        body = page.locator("body")
        expect(body).to_contain_text(words)
        expect(body).to_contain_text("Gloamfin moth")
        expect(body).to_contain_text("81")
        expect(body).to_contain_text("Saltmarsh Harbour")
        expect(body).to_contain_text(f"Sent by {who['name']}")
        assert page.evaluate("document.querySelector('i') === null || !document.querySelector('i').textContent.includes('soon')")
        def shown() -> bool:
            for image in page.get_by_role("img").all():
                source = image.evaluate("el => el.currentSrc || el.src")
                if same_origin(source, app_url) and urlparse(source).path == public["image_url"] and image.evaluate("el => el.complete && el.naturalWidth > 0"):
                    return True
            return False
        poll(shown, "the postcard image loads from the app's origin")
        assert who["email"] not in page.content()
        page.goto(f"{app_url}/postcards/unknown-{uuid.uuid4().hex}")
        expect(page.get_by_role("heading", name="No postcard here", exact=True)).to_be_visible()
    assert_error(httpx.get(f"{app_url}/api/postcards/unknown-{uuid.uuid4().hex}", timeout=HTTP_TIMEOUT), 404, "not_found")


def test_postcard_with_storage_unreachable(browser, app_url, mail):
    down = storage_down_url()
    world = new_world(app_url)
    who = world["explorer"]
    recipient = fresh_email()
    words = "Storage is sleeping."
    moth = world["photos"]["moth"]
    with play(browser, down, who) as page:
        open_postcard_by_keys(page, "Gloamfin moth")
        write_postcard(page, recipient, words)
        with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == "/api/postcards") as info:
            page.keyboard.press("Enter")
        assert info.value.status == 503
        assert info.value.json()["error"] == "storage_unavailable"
        expect(region(page, "Postcard status")).to_have_text("Storage unreachable. Postcard not sent.")
    no_mail_to(mail, recipient)
    post_ok(Api(app_url, who), moth, recipient, words)
    assert len(mail_to(mail, recipient)) == 1


@pytest.mark.timeout(240)
def test_postcard_rate_limit(browser, mail):
    base = short_limits_url()
    world = new_world(base)
    who = world["explorer"]
    api = Api(base, who)
    moth = world["photos"]["moth"]
    message = "You can send 2 postcards an hour. Try again later."
    for _ in range(2):
        post_ok(api, moth, fresh_email(), "Within the limit.")
    refused = fresh_email()
    with play(browser, base, who) as page:
        open_postcard_by_keys(page, "Gloamfin moth")
        write_postcard(page, refused, "Over the limit.")
        page.keyboard.press("Enter")
        expect(region(page, "Postcard status")).to_have_text(message)
    answer = api.post("/api/postcards", {"photo": moth, "recipient": refused, "line": "Over the limit."})
    started = time.monotonic()
    assert_error(answer, 429, "postcard_limit", message)
    wait = int(answer.headers["Retry-After"])
    assert 1 <= wait <= POSTCARD_WINDOW_SHORT
    no_mail_to(mail, refused)

    def reopened() -> bool:
        return api.post("/api/postcards", {"photo": moth, "recipient": fresh_email(), "line": "After the window."}).status_code == 201

    poll(reopened, "a postcard is accepted once the oldest leaves the window (L651)", POSTCARD_WINDOW_SHORT + 5)
    assert time.monotonic() - started >= wait - 2, "the postcard was accepted before Retry-After ran out (L651)"


def test_confirmation_code_by_mail(browser, app_url, mail):
    world = new_world(app_url)
    who = world["newcomer"]
    api = Api(app_url, who)
    response = api.photo(example_pose(1))
    assert response.status_code == 201
    photo = response.json()["photo"]["id"]
    recipient = fresh_email()
    with play(browser, app_url, who) as page:
        open_postcard_by_keys(page, "Mossback newt")
        write_postcard(page, recipient, "My first postcard.")
        page.keyboard.press("Enter")
        expect(region(page, "Postcard status")).to_have_text("Confirm your email to post postcards, pin notes and enter boards.")
        no_mail_to(mail, recipient)
        page.goto(f"{app_url}/confirm")
        click(button(page, "Send a new code"))
        expect(region(page, "Account status")).to_have_text("New code sent.", timeout=RESULT_MS)
        messages = mail_to(mail, who["email"])
        assert len(messages) == 1
        assert messages[0]["Subject"] == "Your Hushfoot confirmation code"
        match = re.search(r"Your code is (\d{6})\.", text(messages[0]))
        assert match, "the message carries a six-digit code (L671)"
        code = match.group(1)
        field = page.get_by_role("textbox", name="Confirmation code", exact=True)
        fill(field, "000000" if code != "000000" else "000001")
        click(button(page, "Confirm"))
        expect(region(page, "Account status")).to_have_text("That code isn't right.")
        fill(field, code)
        click(button(page, "Confirm"))
        expect(region(page, "Account status")).to_have_text("Email confirmed.")
    assert api.get("/api/me").json()["player"]["confirmed"] is True
    post_ok(api, photo, recipient, "My first postcard.")
    assert len(mail_to(mail, recipient)) == 1


def test_signup_mails_a_code(browser, app_url, mail):
    email = fresh_email()
    name = f"Fern {uuid.uuid4().hex[:6]}"
    with visit(browser, app_url, None, "/signup") as page:
        page.get_by_role("textbox", name="Name", exact=True).fill(name)
        page.get_by_role("textbox", name="Email", exact=True).fill(email)
        page.get_by_label("Password").fill("Tideline-Walk-1")
        click(button(page, "Create account"))
        messages = mail_to(mail, email)
    assert len(messages) == 1 and re.search(r"Your code is \d{6}\.", text(messages[0]))
    assert messages[0]["Subject"] == "Your Hushfoot confirmation code"
    taken = post_json(app_url, "/api/signup", {"name": name, "email": email, "password": "Tideline-Walk-1"})
    assert_error(taken, 409, "email_taken", "That email already has an account.")
    assert_error(post_json(app_url, "/api/signup", {"name": "", "email": fresh_email(), "password": "Tideline-Walk-1"}), 422, "bad_name", "Enter a name of 1 to 40 characters.")
    assert_error(post_json(app_url, "/api/signup", {"name": name, "email": "nope", "password": "Tideline-Walk-1"}), 422, "bad_email", "Enter a valid email address.")
    assert_error(post_json(app_url, "/api/signup", {"name": name, "email": fresh_email(), "password": "short"}), 422, "bad_password", "Use a password of at least 8 characters.")


def board_message(api: Api, name: str) -> tuple[str, dict[str, Any]]:
    body = api.http.get("/api/boards/1", params={"player": name}).json()
    return f"Showing {body['shown']} of {body['total']} entries for “{name}”.", body


def enter_api(base: str, who: dict[str, Any], photo: str, island: int = 1) -> httpx.Response:
    return Api(base, who).post(f"/api/boards/{island}/entries", {"photo": photo})


def test_wf_challenge_boards_happy(browser, app_url):
    world = new_world(app_url)
    explorer, friend, rival = world["explorer"], world["friend"], world["rival"]
    with visit(browser, app_url, explorer, "/boards/1") as first, visit(browser, app_url, friend, "/boards/1") as second:
        mark_page(first)
        mark_page(second)
        expect(board_rows(first)).to_have_count(1)
        enter_by_keys(first, "Reedpipe heron photo, 74")
        expect(board_rows(second)).to_have_count(2, timeout=LIVE_MS)
        enter_by_keys(second, "Reedpipe heron photo, 74")
        for page in (first, second):
            rows = board_rows(page)
            expect(rows).to_have_count(3, timeout=LIVE_MS)
            expect(rows.nth(0)).to_contain_text(friend["name"], timeout=LIVE_MS)
            expect(rows.nth(1)).to_contain_text(explorer["name"])
            expect(rows.nth(2)).to_contain_text(rival["name"])
            assert_no_reload(page)
        message, _ = board_message(Api(app_url, explorer), friend["name"])
        first.get_by_role("searchbox", name="Filter players", exact=True).focus()
        first.keyboard.type(friend["name"])
        advance(first, FILTER_MS)
        expect(region(first, "Board status")).to_have_text(message)
        expect(board_rows(first)).to_have_count(1)
    body = Api(app_url, explorer).get("/api/boards/1").json()
    assert [(e["rank"], e["handle"], e["total"]) for e in body["entries"]] == [(1, friend["handle"], 74), (2, explorer["handle"], 74), (3, rival["handle"], 66)]


def test_wf_challenge_boards_refusals(browser, app_url):
    world = new_world(app_url)
    newcomer = world["newcomer"]
    api = Api(app_url, newcomer)
    assert api.photo(example_pose(1)).status_code == 201
    assert_error(enter_api(app_url, world["explorer"], world["photos"]["heron"], 2), 422, "wrong_island", "That photo wasn't taken on this island.")
    with visit(browser, app_url, newcomer, "/boards/1") as page:
        enter_by_keys(page, f"{NEWT_NAME} photo, 100")
        expect(region(page, "Board status")).to_have_text("Confirm your email to post postcards, pin notes and enter boards.")
        expect(board_rows(page)).to_have_count(1)
    for island, wanted in ((1, 1), (2, 0)):
        assert api.get(f"/api/boards/{island}").json()["total"] == wanted
    unknown_island = 9
    assert_error(api.get(f"/api/boards/{unknown_island}"), 404, "not_found")


def test_enter_a_photo_by_keyboard(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with visit(browser, app_url, who, "/boards/1") as page:
        mark_page(page)
        opener = button(page, "Enter a photo")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Enter a photo", exact=True)
        expect(dialog).to_be_visible()
        names = [radio.get_attribute("aria-label") or radio.evaluate("el => el.labels && el.labels[0] ? el.labels[0].innerText : el.innerText") for radio in dialog.get_by_role("radiogroup", name="Your photos", exact=True).get_by_role("radio").all()]
        assert [name.strip() for name in names] == ["Gloamfin moth photo, 81", "Reedpipe heron photo, 74", "Puddle lark photo, 66"]
        wraps_inside(page, dialog)
        radio = dialog.get_by_role("radio", name="Reedpipe heron photo, 74", exact=True)
        radio.focus()
        page.keyboard.press("Space")
        expect(radio).to_be_checked()
        button(dialog, "Enter photo").focus()
        page.keyboard.press("Enter")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
        row = board_rows(page).filter(has_text=who["name"])
        expect(row).to_have_count(1)
        expect(row).to_contain_text("Reedpipe heron")
        expect(row).to_contain_text("74")
        assert_no_reload(page)


def test_ranking_and_tie_break_move_in_place(browser, app_url):
    world = new_world(app_url)
    explorer, friend, rival = world["explorer"], world["friend"], world["rival"]
    with visit(browser, app_url, explorer, "/boards/1") as first, visit(browser, app_url, rival, "/boards/1") as second:
        assert enter_api(app_url, explorer, world["photos"]["heron"]).status_code == 201
        for page in (first, second):
            expect(board_rows(page).nth(0)).to_contain_text(explorer["name"], timeout=LIVE_MS)
        assert enter_api(app_url, friend, world["photos"]["friend_heron"]).status_code == 201
        for page in (first, second):
            rows = board_rows(page)
            expect(rows.nth(0)).to_contain_text(friend["name"], timeout=LIVE_MS)
            expect(rows.nth(0).get_by_role("cell").nth(0)).to_have_text("1")
            expect(rows.nth(1)).to_contain_text(explorer["name"])
            expect(rows.nth(1).get_by_role("cell").nth(0)).to_have_text("2")
            expect(rows.nth(2)).to_contain_text(rival["name"])
            expect(rows.nth(2).get_by_role("cell").nth(0)).to_have_text("3")
            expect(region(page, "Board status")).to_have_text(f"Board updated. {friend['name']} is now number 1.", timeout=LIVE_MS)


def test_filter_waits_for_the_last_keystroke(browser, app_url):
    world = new_world(app_url)
    rival = world["rival"]
    assert enter_api(app_url, world["explorer"], world["photos"]["heron"]).status_code == 201
    assert enter_api(app_url, world["friend"], world["photos"]["friend_heron"]).status_code == 201
    message, body = board_message(Api(app_url, world["explorer"]), rival["name"])
    assert body["shown"] == 1 and body["total"] == 3
    with visit(browser, app_url, world["explorer"], "/boards/1") as page:
        expect(board_rows(page)).to_have_count(3)
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url) if urlparse(r.url).path == "/api/boards/1" and "player=" in r.url else None)
        page.get_by_role("searchbox", name="Filter players", exact=True).focus()
        for char in rival["name"]:
            page.keyboard.type(char)
            advance(page, STEP_MS)
        advance(page, FILTER_MS - STEP_MS - 1)
        page.evaluate("0")
        assert seen == []
        advance(page, 1)
        expect(region(page, "Board status")).to_have_text(message)
        assert len(seen) == 1
        assert parse_qs(urlparse(seen[0]).query)["player"] == [rival["name"]]
        rows = board_rows(page)
        expect(rows).to_have_count(1)
        expect(rows.nth(0)).to_contain_text(rival["name"])
        expect(rows.nth(0).get_by_role("cell").nth(0)).to_have_text("3")


def test_older_filter_answer_is_ignored(browser, app_url):
    world = new_world(app_url)
    rival, friend = world["rival"], world["friend"]
    assert enter_api(app_url, friend, world["photos"]["friend_heron"]).status_code == 201
    message, _ = board_message(Api(app_url, world["explorer"]), friend["name"])
    with visit(browser, app_url, world["explorer"], "/boards/1") as page:
        stash: list[Any] = []

        def hold_older(route: Any) -> None:
            if parse_qs(urlparse(route.request.url).query).get("player") == [rival["name"]]:
                stash.append(route)
            else:
                route.continue_()

        page.route(re.compile(r"/api/boards/1\?player="), hold_older)
        box = page.get_by_role("searchbox", name="Filter players", exact=True)
        fill(box, rival["name"])
        advance(page, FILTER_MS)
        poll(lambda: (page.evaluate("0"), stash)[1], "the older filter request went out")
        fill(box, friend["name"])
        advance(page, FILTER_MS)
        status = region(page, "Board status")
        expect(status).to_have_text(message)
        with page.expect_response(lambda r: "player=" in r.url and parse_qs(urlparse(r.url).query).get("player") == [rival["name"]]):
            stash[0].continue_()
        advance(page, FILTER_MS)
        expect(status).to_have_text(message)
        rows = board_rows(page)
        expect(rows).to_have_count(1)
        expect(rows.nth(0)).to_contain_text(friend["name"])


def test_failed_board_load_stays_visible(browser, app_url):
    world = new_world(app_url)
    rival, friend = world["rival"], world["friend"]
    failure = "Couldn't load the board. Try again."
    with visit(browser, app_url, world["explorer"], "/boards/1") as page:
        watcher = open_tab(page, app_url, "/boards/1", wait_ready=False)
        pattern = re.compile(r"/api/boards/1\?player=")
        page.route(pattern, lambda route: route.abort())
        box = page.get_by_role("searchbox", name="Filter players", exact=True)
        fill(box, rival["name"])
        advance(page, FILTER_MS)
        status = region(page, "Board status")
        expect(status).to_have_text(failure)
        advance(page, 3 * FIGURE_MS)
        expect(status).to_have_text(failure)
        set_tick(app_url, world, 6030)
        assert enter_api(app_url, friend, world["photos"]["friend_heron"]).status_code == 201
        expect(board_rows(watcher).nth(0)).to_contain_text(friend["name"], timeout=LIVE_MS)
        advance(page, FIGURE_MS)
        expect(status).to_have_text(failure)
        page.unroute(pattern)
        message, _ = board_message(Api(app_url, world["explorer"]), rival["name"])
        fill(box, rival["name"] + " ")
        fill(box, rival["name"])
        advance(page, FILTER_MS)
        expect(status).to_have_text(message)


def test_browser_cannot_set_a_board_score(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    heron = world["photos"]["heron"]
    with visit(browser, app_url, who, "/boards/1") as page:
        def forge(route: Any) -> None:
            route.continue_(post_data=json.dumps({**route.request.post_data_json, "score": 100, "total": 100}))

        page.route("**/api/boards/1/entries", forge)
        enter_by_keys(page, "Reedpipe heron photo, 74")
        row = board_rows(page).filter(has_text=who["name"])
        expect(row).to_have_count(1)
        expect(row.get_by_role("cell").nth(3)).to_have_text("74")
        page.reload()
        expect(region(page, "Board status")).to_have_text("2 entries")
        expect(board_rows(page).filter(has_text=who["name"]).get_by_role("cell").nth(3)).to_have_text("74")
    total = next(r["total"] for r in rows_for(who["id"]) if r["id"] == heron)
    entries = Api(app_url, who).get("/api/boards/1").json()
    mine = [e for e in entries["entries"] if e["handle"] == who["handle"]]
    assert entries["total"] == 2 and len(mine) == 1 and mine[0]["total"] == total == 74
    replaced = enter_api(app_url, who, world["photos"]["moth"])
    assert replaced.status_code == 200
    kept = enter_api(app_url, who, world["photos"]["lark"])
    assert kept.status_code == 200
    entries = Api(app_url, who).get("/api/boards/1").json()
    mine = [e for e in entries["entries"] if e["handle"] == who["handle"]]
    assert entries["total"] == 2 and [e["total"] for e in mine] == [81]


def test_wf_reduced_motion_and_text_world_photo_and_sail(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with play(browser, app_url, who, "/play?island=1&spot=2", reduced_motion="reduce") as page:
        words = open_tab(page, app_url, "/text-world", wait_ready=False)
        expect(line(words, "3 of 4 album pages")).to_be_visible()
        assert keyboard_photo(page).status == 201
        dialog = expect_result(page)
        expect(figure(dialog, "score-total")).to_have_text("100 / 100")
        expect(region(page, "Photo status")).to_contain_text(NEWT_100)
        expect(line(words, "Mossback newt: always, photographed, best 100 points")).to_be_visible(timeout=LIVE_MS)
        page.keyboard.press("Escape")
        page.keyboard.press("c")
        page.keyboard.press("m")
        click(button(page, "Sail to Fernhollow"))
        expect(view(page)).to_have_attribute("data-island", "2")
        expect(line(words, "You are on Fernhollow at tile 3, 12.")).to_be_visible(timeout=LIVE_MS)
        expect(line(words, "Stamps: 3")).to_be_visible()
        expect(line(words, "Lighthouse: open")).to_be_visible()
    state = Api(app_url, who).get("/api/me").json()
    assert state["position"]["island"] == 2 and state["stamps"] == 3 and state["lighthouse"] == "open"


def test_wf_reduced_motion_and_text_world_refill(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with visit(browser, app_url, who, "/text-world", reduced_motion="reduce", no_webgl=True) as page:
        expect(line(page, "Film: 30 frames")).to_be_visible()
        click(button(page, "Refill film"))
        expect(region(page, "Text world status")).to_have_text("Film refilled to 36 frames.")
        expect(line(page, "Film: 36 frames")).to_be_visible()
    assert ledger_sum(who["id"]) == 36
    assert_pairs(who["id"])


def test_photo_mode_cuts_under_reduced_motion(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"], "/play?island=1&spot=2", reduced_motion="reduce") as page:
        target = game_focus(page)
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-mode", "photo")
        expect(target).to_have_attribute("data-guide", "drawn")
        advance(page, SLICE_MS)
        placed = target.get_attribute("data-camera")
        advance(page, CAMERA_GLIDE_MS + STEP_MS)
        assert target.get_attribute("data-camera") == placed
        page.keyboard.press("c")
        advance(page, SLICE_MS)
        page.keyboard.press("e")
        page.keyboard.press("+")
        advance(page, SLICE_MS)
        page.keyboard.press("Home")
        expect(target).to_have_attribute("data-yaw", "0")
        expect(target).to_have_attribute("data-zoom", "2")
        advance(page, SLICE_MS)
        placed = target.get_attribute("data-camera")
        advance(page, CAMERA_GLIDE_MS + STEP_MS)
        assert target.get_attribute("data-camera") == placed
    with play(browser, app_url, world["rival"], "/play?island=1&spot=2") as page:
        target = game_focus(page)
        page.keyboard.press("c")
        expect(target).to_have_attribute("data-guide", "drawing")
        advance(page, GUIDE_DRAW_MS // 2)
        middle = target.get_attribute("data-camera")
        advance(page, CAMERA_GLIDE_MS)
        expect(target).to_have_attribute("data-guide", "drawn")
        assert target.get_attribute("data-camera") != middle


def test_shutter_and_figures_under_reduced_motion(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2", reduced_motion="reduce") as page:
        target = game_focus(page)
        page.keyboard.press("c")
        page.keyboard.press("+")
        with held(page, "**/api/photos") as gate:
            page.keyboard.press("Enter")
            expect(region(page, "Photo status")).to_have_text("Scoring…")
            expect(target).to_have_attribute("data-shutter", "idle")
            assert not animations(target)
            release(gate)
            dialog = expect_result(page)
        expect(target).to_have_attribute("data-shutter", "idle")
        assert not animations(target)
        expect(figure(dialog, "score-total")).to_have_text("100 / 100")
        expect(figure(dialog, "score-size")).to_have_text("30")
        expect(figure(page, "film")).to_have_text("35 frames")
        expect(region(page, "Photo status")).to_contain_text(NEWT_100)
    world = new_world(app_url)
    with play(browser, app_url, world["explorer"], "/play?island=1&spot=2") as page:
        target = game_focus(page)
        page.keyboard.press("c")
        page.keyboard.press("+")
        with held(page, "**/api/photos") as gate:
            page.keyboard.press("Enter")
            expect(target).to_have_attribute("data-shutter", "moving")
            advance(page, SHUTTER_MS + SLICE_MS)
            expect(target).to_have_attribute("data-shutter", "idle")
            release(gate)
            expect_result(page)


def test_stillness_under_reduced_motion(browser, app_url):
    world = new_world(app_url)
    with play(browser, app_url, world["friend"], "/play?gfx=full", reduced_motion="reduce", light=False) as page:
        target = view(page)
        advance(page, 5 * STEP_MS)
        before = decode(capture(target))
        advance(page, 10 * STEP_MS)
        after = decode(capture(target))
        assert before.variance() > 0, "the scene rendered something"
        assert difference(before, after) == 0
    with visit(browser, app_url, None, "/", reduced_motion="reduce") as page:
        guide = page.get_by_role("application", name="Guide creature", exact=True)
        guide.focus()
        page.keyboard.press("Space")
        expect(guide).to_have_attribute("data-nudges", "1")
        expect(guide).to_have_attribute("data-stretch", "0.00")
        expect(region(page, "Guide status")).to_have_text("Wump hops.")
        assert not animations(guide)


def test_text_world_follows_the_explorer_live(browser, app_url):
    world = new_world(app_url)
    wanted = "You are on Fernhollow at tile 3, 12."
    with play(browser, app_url, world["friend"]) as page:
        words = open_tab(page, app_url, "/text-world", wait_ready=False)
        expect(line(words, "You are on Saltmarsh Harbour at tile 3, 12.")).to_be_visible()
        button(words, "Sail to Driftglass Reef").focus()
        mark_page(words)
        pin_focus(words)
        game_focus(page)
        page.keyboard.press("m")
        click(button(page, "Sail to Fernhollow"))
        expect(region(words, "Text world status")).to_have_text(wanted, timeout=LIVE_MS)
        expect(line(words, wanted)).to_be_visible(timeout=LIVE_MS)
        assert_no_reload(words)
        assert_focus_kept(words)
    assert Api(app_url, world["friend"]).get("/api/me").json()["position"]["island"] == 2


def test_still_fallback_without_webgl(browser, app_url):
    world = new_world(app_url)
    who = world["explorer"]
    with visit(browser, app_url, who, "/play", no_webgl=True) as page:
        advance(page, 10 * STEP_MS)
        expect(page.locator('[data-state="still"]').first).to_be_attached()
        expect(page.get_by_role("img", name="Still map of Saltmarsh Harbour", exact=True)).to_be_visible()
        expect(page.get_by_text("3D is not available here. The text world below has everything.", exact=True)).to_be_visible()
        state = Api(app_url, who).get("/api/me").json()
        expect(page.get_by_role("heading", name="Your progress", level=2, exact=True)).to_be_visible()
        expect(line(page, f"Stamps: {state['stamps']}")).to_be_visible()
        expect(line(page, f"Film: {state['film']} frames")).to_be_visible()
        expect(line(page, "3 of 4 album pages")).to_be_visible()
        expect(line(page, "You are on Saltmarsh Harbour at tile 3, 12.")).to_be_visible()


def creature_line(entry: tuple, best: dict[str, int]) -> str:
    _, cid, name, _, present, _ = entry
    if cid in best:
        return f"{name}: {present}, photographed, best {best[cid]} points"
    return f"{name}: {present}, not photographed yet"


def test_text_world_content_and_access(browser, app_url):
    world = new_world(app_url)
    best = {"reedpipe-heron": 74, "gloamfin-moth": 81, "puddle-lark": 66}
    with visit(browser, app_url, world["explorer"], "/text-world", no_webgl=True) as page:
        headings = [h.inner_text().strip() for h in page.get_by_role("heading", level=2).all()]
        assert headings == ISLANDS + ["Your progress"]
        for entry in SEED_CREATURES:
            expect(line(page, creature_line(entry, best))).to_be_visible()
        expect(page.get_by_text("3 of 4 album pages", exact=True)).to_have_count(1)
        expect(page.get_by_text("0 of 4 album pages", exact=True)).to_have_count(4)
        for content in ("Stamps: 2", "Lighthouse: closed", "Film: 30 frames", "You are on Saltmarsh Harbour at tile 3, 12."):
            expect(line(page, content)).to_be_visible()
        axe(page)
        expect(button(page, "Sail to Saltmarsh Harbour")).to_have_count(0)
        refill = button(page, "Refill film")
        click(refill)
        expect(line(page, "Film: 36 frames")).to_be_visible()
        expect(region(page, "Text world status")).to_have_text("Film refilled to 36 frames.")
        click(button(page, "Sail to Fernhollow"))
        expect(line(page, "You are on Fernhollow at tile 3, 12.")).to_be_visible()
        expect(button(page, "Sail to Saltmarsh Harbour")).to_be_visible()
        expect(button(page, "Sail to Fernhollow")).to_have_count(0)
        expect(refill).to_be_disabled()
    with visit(browser, app_url, None, "/text-world", no_webgl=True) as page:
        expect(line(page, "Sign in to see your progress.")).to_be_visible()
        expect(line(page, "Reedpipe heron: always")).to_be_visible()
        expect(page.get_by_text("of 4 album pages")).to_have_count(0)
        expect(page.get_by_text("Stamps:")).to_have_count(0)
        expect(button(page, "Refill film")).to_have_count(0)
        expect(button(page, "Sail to Fernhollow")).to_have_count(0)


def test_wf_sound_settings_and_links_one_visit(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    with visit(browser, app_url, who, "/signin") as page:
        strays: list[str] = []
        page.on("request", lambda r: strays.append(r.url) if r.url.startswith("http") and not same_origin(r.url, app_url) else None)
        page.goto(f"{app_url}/play?island=3&spot=2")
        ready(page)
        target = view(page)
        sound = button(page, "Sound")
        click(sound)
        expect(sound).to_have_attribute("aria-pressed", "true")
        click(sound)
        expect(sound).to_have_attribute("aria-pressed", "false")
        click(button(page, "Settings"))
        music = page.get_by_role("slider", name="Music volume", exact=True)
        music.focus()
        page.keyboard.press("ArrowLeft")
        click(button(page, "Save settings"))
        expect(region(page, "Settings status")).to_have_text("Settings saved.")
        page.keyboard.press("Escape")
        game_focus(page)
        page.keyboard.press("m")
        click(button(page, "Sail to Fernhollow"))
        expect(target).to_have_attribute("data-island", "2")
        page.go_back(wait_until="commit")
        expect(target).to_have_attribute("data-island", "3")
        assert page.context.request.delete(f"{app_url}/api/session").status == 204
        page.goto(f"{app_url}/play?island=1&spot=2")
        expect(page).to_have_url(re.compile(r"/signin\?next="))
        page.get_by_role("textbox", name="Email", exact=True).fill(who["email"])
        page.get_by_label("Password").fill(who["password"])
        click(button(page, "Sign in"))
        expect(page).to_have_url(f"{app_url}/play?island=1&spot=2", timeout=RESULT_MS)
        ready(page)
        expect(view(page)).to_have_attribute("data-tile", "12,10")
        assert not strays, strays
    state = Api(app_url, who).get("/api/me").json()
    assert state["settings"]["music"] == 55
    assert state["position"]["island"] == 1 and state["position"]["tile"] == [12, 10]


def test_wf_sound_settings_and_links_save_failure_recovers(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    api = Api(app_url, who)
    with play(browser, app_url, who) as page:
        click(button(page, "Settings"))
        music = page.get_by_role("slider", name="Music volume", exact=True)
        music.focus()
        page.keyboard.press("ArrowLeft")
        page.route("**/api/me/settings", lambda route: route.abort())
        click(button(page, "Save settings"))
        status = region(page, "Settings status")
        expect(status).to_have_text("Couldn't save settings. Try again.")
        assert api.get("/api/me/settings").json()["settings"]["music"] == 60
        page.unroute("**/api/me/settings")
        click(button(page, "Save settings"))
        expect(status).to_have_text("Settings saved.")
    assert api.get("/api/me/settings").json()["settings"]["music"] == 55


def test_sound_starts_only_on_request(browser, app_url):
    world = new_world(app_url)
    with visit(browser, app_url, world["friend"], "/signin") as page:
        page.context.add_init_script(AUDIO_SPY)
        for path in ("/", "/play"):
            page.goto(f"{app_url}{path}")
            if path == "/play":
                ready(page)
            advance(page, STEP_MS)
            report = page.evaluate("window.__audioReport()")
            assert (report["contexts"], report["gains"], report["sources"]) == (0, 0, 0), report
        sound = button(page, "Sound")
        expect(sound).to_have_attribute("aria-pressed", "false")
        sound.focus()
        page.keyboard.press("Enter")
        expect(sound).to_have_attribute("aria-pressed", "true")
        report = page.evaluate("window.__audioReport()")
        assert report["contexts"] == 1 and report["sources"] >= 1 and report["looping"] >= 1, report
        assert report["masters"] == 1 and report["master"] == 1, report
        assert any(abs(value - 0.6) < 0.001 for value in report["feeding"]), report
        page.keyboard.press("Enter")
        expect(sound).to_have_attribute("aria-pressed", "false")
        report = page.evaluate("window.__audioReport()")
        assert report["master"] == 0 and report["contexts"] == 1, report
        page.keyboard.press("Enter")
        expect(sound).to_have_attribute("aria-pressed", "true")
        report = page.evaluate("window.__audioReport()")
        assert report["master"] == 1 and report["contexts"] == 1, report
        page.reload()
        ready(page)
        expect(button(page, "Sound")).to_have_attribute("aria-pressed", "false")
        assert page.evaluate("window.__audioReport()")["contexts"] == 0


def slider_value(slider: Locator) -> str:
    return slider.evaluate("el => el.getAttribute('aria-valuenow') || el.value")


def test_settings_by_keyboard(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    api = Api(app_url, who)
    with play(browser, app_url, who, "/play?gfx=light", light=False) as page:
        opener = button(page, "Settings")
        opener.focus()
        page.keyboard.press("Enter")
        music = page.get_by_role("slider", name="Music volume", exact=True)
        music.focus()
        assert slider_value(music) == "60"
        for _ in range(4):
            page.keyboard.press("ArrowLeft")
        assert slider_value(music) == "40"
        radio = page.get_by_role("radio", name="Light", exact=True)
        radio.focus()
        page.keyboard.press("Space")
        expect(radio).to_be_checked()
        button(page, "Save settings").focus()
        page.keyboard.press("Enter")
        expect(region(page, "Settings status")).to_have_text("Settings saved.")
    saved = api.get("/api/me/settings").json()["settings"]
    assert saved["music"] == 40 and saved["graphics"] == "light"
    with play(browser, app_url, who, light=False) as page:
        expect(view(page)).to_have_attribute("data-preset", "light")
        click(button(page, "Settings"))
        assert slider_value(page.get_by_role("slider", name="Music volume", exact=True)) == "40"
        expect(page.get_by_role("radio", name="Light", exact=True)).to_be_checked()
        page.goto(f"{app_url}/play?gfx=balanced")
        ready(page)
        expect(view(page)).to_have_attribute("data-preset", "balanced")
        assert api.get("/api/me/settings").json()["settings"]["graphics"] == "light"
        page.goto(f"{app_url}/play")
        ready(page)
        expect(view(page)).to_have_attribute("data-preset", "light")
    assert_error(api.put("/api/me/settings", {"music": 40, "effects": 80, "graphics": "ultra"}), 422, "bad_request")


def test_deep_links_sailing_and_back(browser, app_url):
    world = new_world(app_url)
    deep = f"{app_url}/play?island=3&spot=2"
    with play(browser, app_url, world["friend"], "/play?island=3&spot=2") as page:
        target = view(page)
        for _ in range(2):
            expect(target).to_have_attribute("data-island", "3")
            expect(target).to_have_attribute("data-tile", "12,10")
            expect(target).to_have_attribute("data-heading", "N")
            if page.evaluate("window.__reloaded === true"):
                break
            page.reload()
            ready(page)
            page.evaluate("window.__reloaded = true")
        game_focus(page)
        hold(page, "d", STEP_MS)
        expect(target).to_have_attribute("data-tile", "13,10")
        assert page.url == deep
        mark_page(page)
        page.keyboard.press("m")
        click(button(page, "Sail to Fernhollow"))
        expect(page).to_have_url(f"{app_url}/play?island=2&spot=1")
        expect(target).to_have_attribute("data-island", "2")
        expect(target).to_have_attribute("data-tile", "3,12")
        page.go_back(wait_until="commit")
        expect(target).to_have_attribute("data-island", "3")
        expect(target).to_have_attribute("data-tile", "13,10")
        assert_no_reload(page)


def test_sign_in_round_trip_and_unknown_spots(browser, app_url):
    world = new_world(app_url)
    who = world["friend"]
    assert Api(app_url, who).put("/api/me/settings", {"music": 60, "effects": 80, "graphics": "light"}).status_code == 200

    def submit(page: Page, password: str) -> None:
        page.get_by_role("textbox", name="Email", exact=True).fill(who["email"])
        page.get_by_label("Password").fill(password)
        click(button(page, "Sign in"))

    with visit(browser, app_url, None, "/play?island=1&spot=2") as page:
        expect(page).to_have_url(re.compile(r"/signin\?next="))
        assert parse_qs(urlparse(page.url).query)["next"] == ["/play?island=1&spot=2"]
        submit(page, who["password"] + "x")
        expect(region(page, "Account status")).to_have_text("That email and password don't match.")
        submit(page, who["password"])
        expect(page).to_have_url(f"{app_url}/play?island=1&spot=2", timeout=RESULT_MS)
    for target in ("https%3A%2F%2Fexample.invalid%2F", "%2F%2Fexample.invalid%2F"):
        with visit(browser, app_url, None, f"/signin?next={target}") as page:
            submit(page, who["password"])
            expect(page).to_have_url(f"{app_url}/play", timeout=RESULT_MS)
    notice = "That spot doesn't exist. You are at Saltmarsh Harbour, spot 1."
    for path in ("/play?island=9&spot=1", "/play?island=1&spot=9"):
        with play(browser, app_url, who, path) as page:
            expect(region(page, "World status")).to_contain_text(notice)
            expect(page).to_have_url(f"{app_url}/play?island=1&spot=1")
            expect(view(page)).to_have_attribute("data-tile", "3,12")


def test_private_halls_answer_404_everywhere(browser, app_url):
    world = new_world(app_url)
    owner = world["rival"]
    handle = owner["handle"]
    private = world["photos"]["rival_private"]
    for api in (Api(app_url, world["friend"]), Api(app_url)):
        assert_error(api.get(f"/api/halls/{handle}"), 404, "not_found", "Nothing here.")
        assert_error(api.get(f"/api/photos/{private}/image"), 404, "not_found")
    friend = Api(app_url, world["friend"])
    assert_error(friend.put(f"/api/photos/{private}/like"), 404, "not_found")
    assert_error(friend.delete(f"/api/photos/{private}/like"), 404, "not_found")
    assert_error(friend.get(f"/api/photos/{private}"), 404, "not_found")
    for who in (world["friend"], None):
        with visit(browser, app_url, who, f"/hall/{handle}") as page:
            expect(page.get_by_role("heading", name="No gallery here", exact=True)).to_be_visible()
    mine = Api(app_url, owner)
    assert mine.get(f"/api/photos/{private}/image").status_code == 200
    with visit(browser, app_url, owner, f"/hall/{handle}") as page:
        expect(page.get_by_role("heading", name="No gallery here", exact=True)).to_have_count(0)
        expect(page.get_by_role("list", name="Hung photos", exact=True)).to_contain_text("Mossback newt")


def test_play_continues_with_storage_unreachable(browser, app_url):
    down = storage_down_url()
    world = new_world(app_url)
    who = world["explorer"]
    before_rows = len(rows_for(who["id"]))
    before_keys = object_keys()
    with play(browser, down, who, "/play?island=1&spot=2") as page:
        response = keyboard_photo(page)
        assert response.status == 503
        assert response.json()["error"] == "storage_unavailable"
        expect(region(page, "Photo status")).to_contain_text("Storage unreachable. Photo not kept, and your frame is still on the roll.")
        expect(result_dialog(page)).to_have_count(0)
        advance(page, FIGURE_MS)
        expect(figure(page, "film")).to_have_text("30 frames")
        page.keyboard.press("c")
        target = view(page)
        expect(target).to_have_attribute("data-mode", "explore")
        hold(page, "d")
        expect(target).to_have_attribute("data-tile", "14,10")
        page.keyboard.press("m")
        expect(page.get_by_role("application", name="Island map", exact=True)).to_be_visible()
        page.keyboard.press("Escape")
        game_focus(page)
        page.keyboard.press("j")
        advance(page, FIGURE_MS)
        expect(figure(page, "album-pages")).to_have_text("3 of 4 pages")
        page.goto(f"{down}/text-world")
        expect(line(page, "Film: 30 frames")).to_be_visible()
        expect(line(page, "Reedpipe heron: always, photographed, best 74 points")).to_be_visible()
    assert len(rows_for(who["id"])) == before_rows
    assert ledger_sum(who["id"]) == 30
    assert not orphans_since(before_keys)
    health = httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "unavailable"}
    healthy = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT)
    assert healthy.status_code == 200 and healthy.json() == {"status": "ok"}
    image = httpx.get(f"{down}/api/photos/{world['photos']['moth']}/image", timeout=HTTP_TIMEOUT)
    assert_error(image, 503, "storage_unavailable", "Storage unreachable. Photo not available.")
    assert_error(post_json(down, "/api/grading/world", {}), 503, "storage_unavailable")


APP = Path("/app")
ALLOWLIST = {"MIT", "MIT-0", "Apache-2.0", "BSD", "0BSD", "BSD-1-Clause", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL", "OFL-1.1", "CC0", "CC0-1.0"}
SKIPPED_DIRS = {"node_modules", "dist", "build", "out", ".git", ".next", "coverage"}
CODE_SUFFIXES = {".ts", ".tsx", ".mts", ".cts", ".js", ".jsx", ".mjs", ".cjs", ".html", ".css"}


def own_files() -> list[Path]:
    return [
        path for path in APP.rglob("*")
        if path.is_file() and path.suffix in CODE_SUFFIXES and not SKIPPED_DIRS.intersection(path.relative_to(APP).parts)
    ]


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key]


def test_if_typescript():
    files = own_files()
    typed = [p for p in files if p.suffix in {".ts", ".tsx", ".mts", ".cts"}]
    untyped = [p for p in files if p.suffix in {".js", ".jsx", ".mjs", ".cjs"}]
    assert typed and len(typed) > len(untyped), (len(typed), untyped)


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, missing
    assert "Albert Sans" in notices


def test_if_licences():
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not refused, refused


def test_if_only_published_datastores():
    forbidden = {"redis", "ioredis", "memcached", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "amqplib", "kafkajs", "bullmq", "sendgrid", "@sendgrid/mail", "mailgun.js"}
    found = sorted(forbidden.intersection(p.name for p in shipped_packages()))
    assert not found, found


def test_if_no_remote_assets():
    remote = re.compile(r"""(?:https?:)?//[\w.-]+\.[a-z]{2,}/[^\s"'`)]*\.(?:js|mjs|css|woff2?|ttf|otf|png|jpe?g|webp|gif|svg|glb|gltf|mp3|ogg|wav)\b""", re.I)
    hits = [(str(path), match.group()) for path in own_files() for match in remote.finditer(path.read_text(errors="ignore"))]
    assert not hits, hits


def test_if_no_forbidden_browser_apis():
    forbidden = re.compile(r"serviceWorker|requestPointerLock|getGamepads|navigator\.xr|XRSession|DeviceOrientationEvent|DeviceMotionEvent|deviceorientation|devicemotion")
    hits = [(str(path), match.group()) for path in own_files() for match in forbidden.finditer(path.read_text(errors="ignore"))]
    assert not hits, hits
