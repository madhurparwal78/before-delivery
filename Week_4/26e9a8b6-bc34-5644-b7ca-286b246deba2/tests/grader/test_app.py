from __future__ import annotations

import base64
import hashlib
import json
import os
import re
import struct
import time
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlsplit

import httpx
import pytest
from playwright.sync_api import Locator, Page, expect

from conftest import (
    Postgres,
    S3,
    addresses,
    advance,
    animations,
    camera,
    capture,
    click,
    decode,
    difference,
    fill,
    held,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    post_json,
    same_origin,
    session,
    shipped_packages,
    tab_order,
    tap,
)
from conftest import text as mail_text

APP_DIR = Path("/app")
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
VIEWPORTS = {"desktop": {"width": 1280, "height": 800}, "tablet": {"width": 768, "height": 1024}, "phone": {"width": 375, "height": 812}}
SMALL_VIEWPORTS = {"tablet": {"width": 768, "height": 1024}, "phone": {"width": 375, "height": 812}}

TARGET_PX = 44
SETTLE_MS = 64
LIVE_SECONDS = 2
COMMIT_MS = 250
APPLY_BEFORE_MS = 249
COUNT_MS = 640
HEADER_COUNT_MS = 800
NOTICE_MS = 5000
RECONNECT_MS = 1000
SEARCH_DEBOUNCE_MS = 250
PRESENCE_GRACE_SECONDS = 2
HEALTH_MAX_SECONDS = 3
GLB_CHECK_MAX_SECONDS = 5
SEARCH_DB_SECONDS = 2
GLB_MAX_DEPTH = 64
JSON_MAX_DEPTH = 32
BODY_LIMIT = 1000000
SEARCH_QUERY_MAX = 200
SEARCH_TAG_MAX = 8
PAGE_SIZE = 24
PAGE_SIZE_MAX = 100
GUIDE_TITLE_MAX = 120
STEP_TITLE_MAX = 120
STEP_TEXT_MAX = 2000
QUESTION_TEXT_MAX = 1000
SIGNIN_LIMIT = 5
RESEND_LIMIT = 3
SHORT_MODEL_BYTES = 400000
SHORT_MODEL_PARTS = 12
SHORT_QUESTION_WINDOW = 30
SHORT_TOKEN_TTL_SECONDS = 5
MASTER_GAIN = 0.25
YAW_STEP = 15
ZOOM_MAX = 3.00
ZOOM_MIN = 0.50
PITCH_MAX = 60
HUGE_INDEX = 99
UNKNOWN_API = "/api/no-such-route"
AUTHOR_MERGED = "Author merged"
CO_MERGED = "Co-author merged"

FRAME_MS = 16
POLL_SECONDS = 20
ROUND_TRIP_SLACK = 3
LIVE_WAIT = LIVE_SECONDS + ROUND_TRIP_SLACK
LIVE_SETUP_POLLS = 300
HTTP_TIMEOUT = 30
TAB_LIMIT = 120
MAIL_SETTLE = 0.2
PAGING_WORLDS = 25
SCROLL_DRAG_PX = 200
SCROLL_QUIET_S = 0.5
TOUCH_STEPS = 8
ORBIT_PX = 60
PINCH_START_PX = 40
PINCH_END_PX = 80
NOTICE_GAP_MS = 3000
FLOAT_COMPONENT = 5126

PUBLIC_STEPS = [
    (1, "Lift off the hopper", "Open up", 0.000, 30, 15, "€0.00", "Unplug the grinder, then turn the hopper a quarter turn and lift it straight up."),
    (2, "Free the upper burr", "Take out", 0.250, 45, 20, "€0.00", "Undo the two clips and lift the upper burr out by its handle."),
    (3, "Draw out the lower burr", "Take out", 0.500, 60, 10, "€0.00", "Pull the lower burr straight up off the drive shaft without twisting it."),
    (4, "Fit the new burr set", "Fit new", 0.850, 60, 25, "€18.90", "Seat the new burrs and turn them a quarter turn until they click."),
    (5, "Refit the chute and close up", "Close up", 0.000, 30, 15, "€21.30", "Press the new chute home, then refit the hopper and run a few beans through."),
]
PUBLIC_TOTAL = "€21.30"
TOOLBAR_ORDER = ["Add step", "Undo", "Redo", "Save version", "Versions", "Choose a model file", "Upload model", "Co-authors", "Publish", "Withdraw", "Delete guide"]
BIKE_HUB = "bike-hub.glb"
STILL_COPY = "3D view is not available here. Showing a still of this step."
READER_OUTAGE = "Storage unreachable. The steps and parts below still work."
AUTHOR_OUTAGE = "Storage unreachable. Uploading and publishing wait until it returns; your text still saves."
NOT_FOUND_COPY = "We could not find that page."
WITHDRAWN_COPY = "This guide was withdrawn."
UNCONFIRMED_COPY = "Confirm your email before you can do that. Check your inbox or send the message again."
BAD_TOKEN_COPY = "This confirmation link has expired or was replaced. Send a new one."
CONFIRMED_COPY = "Your email is confirmed."
MAIL_SUBJECT = "Confirm your Pennywasher account"
MARKUP_TEXT = "<b>x</b> **x** [a](b)"
EMOJI = "😀"
PACK_TITLE = "Pack fresh grease"
COAUTHOR_TITLE = "The co-author's title"
SHORTCUT_TEXT = "Saved by the shortcut."
CO_SECOND = "Co-author's second"
CO_THIRD = "Co-author's third"
UNDONE_TEXT = "This edit gets undone."
PHONE_FIX_TEXT = "Corrected from the phone."
OUTAGE_TEXT = "Saved during the outage."
UNSAVED_TEXT = "Typed and not yet saved."
RUN_IN_ANSWER = "Run a handful of old beans first."
UNCONFIRMED_PROBE = "Unconfirmed probe"
GREASE_QUESTION = "Should the shaft stay greased?"
BURR_QUESTION = "Which way do the burrs click?"
REFUSED_THIRD = "The refused third question"
API_THIRD = "API third"
AUTHOR_OWN_WORDS = "Author's own words"
CO_OWN_WORDS = "Co-author's own words"
HELD_BACK = "Held back"
ALREADY_STORED = "Already stored"
STALE_TEXT = "Typed before a stale save."
SPARE_PART = "Spare axle"
ESCAPE_WORD = "escape"
UNKNOWN_EMBED = "/embed/no-such-guide"
UNDERSCORE_WORD = "gr_nder"
PERCENT_WORD = "%"

PROBE_SCRIPT = r"""
(() => {
  if (window.__probe) return;
  const P = window.__probe = {live: [], lastKey: null, gl: {draws: 0, bytes: 0}, stay: false};
  for (const name of ['WebSocket', 'EventSource']) {
    const Native = window[name];
    if (!Native) continue;
    window[name] = new Proxy(Native, {construct(t, a, n) { const s = Reflect.construct(t, a, n); P.live.push(s); return s; }});
  }
  window.addEventListener('keydown', e => { P.lastKey = e; }, true);
  for (const G of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    if (!G) continue;
    const proto = G.prototype;
    for (const m of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const f = proto[m];
      if (f) proto[m] = function (...a) { P.gl.draws++; return f.apply(this, a); };
    }
    const bd = proto.bufferData;
    proto.bufferData = function (t, d, ...r) {
      if (t === this.ARRAY_BUFFER) P.gl.bytes += typeof d === 'number' ? d : (d && d.byteLength) || 0;
      return bd.call(this, t, d, ...r);
    };
  }
  const S = {contexts: 0, sources: [], gains: [], edges: [], last: new WeakMap()};
  if (window.AudioContext) {
    const Ctx = window.AudioContext;
    window.AudioContext = new Proxy(Ctx, {construct(t, a, n) { S.contexts++; return Reflect.construct(t, a, n); }});
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (...a) { S.sources.push(this); return start.apply(this, a); };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function (d, ...r) { S.edges.push([this, d]); return connect.call(this, d, ...r); };
    const createGain = BaseAudioContext.prototype.createGain;
    BaseAudioContext.prototype.createGain = function () { const g = createGain.call(this); S.gains.push(g); return g; };
    const Gain = window.GainNode;
    window.GainNode = new Proxy(Gain, {construct(t, a, n) {
      const g = Reflect.construct(t, a, n); S.gains.push(g);
      if (a[1] && typeof a[1].gain === 'number') S.last.set(g.gain, a[1].gain);
      return g;
    }});
    const value = Object.getOwnPropertyDescriptor(AudioParam.prototype, 'value');
    Object.defineProperty(AudioParam.prototype, 'value', {
      configurable: true,
      get() { return S.last.has(this) ? S.last.get(this) : value.get.call(this); },
      set(v) { S.last.set(this, v); value.set.call(this, v); },
    });
    for (const m of ['setValueAtTime', 'linearRampToValueAtTime', 'exponentialRampToValueAtTime', 'setTargetAtTime']) {
      const f = AudioParam.prototype[m];
      AudioParam.prototype[m] = function (v, ...r) { S.last.set(this, v); return f.call(this, v, ...r); };
    }
  }
  P.sound = () => {
    const gainsTo = (node, seen) => {
      if (node instanceof AudioDestinationNode) return [];
      if (seen.has(node)) return null;
      seen.add(node);
      for (const [from, to] of S.edges) {
        if (from !== node) continue;
        const rest = gainsTo(to, seen);
        if (rest) return (S.gains.includes(node) ? [node] : []).concat(rest);
      }
      return null;
    };
    return {
      contexts: S.contexts,
      gains: S.gains.length,
      started: S.sources.length,
      loops: S.sources.map(s => s.loop),
      generated: S.sources.map(s => !!s.buffer && s.buffer.length > 0),
      through: S.sources.map(s => (gainsTo(s, new Set()) || []).map(g => g.gain.value)),
    };
  };
})();
"""


def poll(check: Callable[[], Any], why: str, page: Page | None = None, seconds: float = POLL_SECONDS, budget_ms: int = 1000) -> Any:
    spent = 0
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = check()
        if value:
            return value
        if page is not None and spent < budget_ms:
            advance(page, FRAME_MS)
            spent += FRAME_MS
    pytest.fail(f"Within {seconds} s expected: {why}")


def squeeze(value: str | None) -> str:
    return " ".join((value or "").split())


def see(page: Page, locator: Locator, expected: str, seconds: float = POLL_SECONDS, budget_ms: int = 1000) -> None:
    found: list[list[str]] = [[]]

    def check() -> bool:
        found[0] = [squeeze(t) for t in locator.all_text_contents()]
        return expected in found[0]

    deadline = time.monotonic() + seconds
    spent = 0
    while time.monotonic() < deadline:
        if check():
            return
        if spent < budget_ms:
            advance(page, FRAME_MS)
            spent += FRAME_MS
    pytest.fail(f"Expected the text {expected!r}; the page showed {found[0]!r}")


def see_live(locator: Locator, expected: str, seconds: float = LIVE_WAIT) -> None:
    last: list[list[str]] = [[]]

    def check() -> bool:
        last[0] = [squeeze(t) for t in locator.all_text_contents()]
        return expected in last[0]

    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        if check():
            return
    pytest.fail(f"Within {seconds} s live, with the page clock paused, expected {expected!r}; saw {last[0]!r}")


def see_match(page: Page, locator: Locator, pattern: str, budget_ms: int = 1000) -> re.Match[str]:
    def check() -> re.Match[str] | None:
        for value in locator.all_text_contents():
            match = re.fullmatch(pattern, squeeze(value))
            if match:
                return match
        return None

    return poll(check, f"text matching {pattern!r}", page, budget_ms=budget_ms)


class Api:

    def __init__(self, base: str, account: dict[str, Any] | None = None) -> None:
        self.base = base
        self.client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
        self.cookies: dict[str, str] = {}
        if account:
            reply = self.post("/api/session", {"email": account["email"], "password": account["password"]})
            assert reply.status_code == 200, f"POST /api/session answered {reply.status_code}: {reply.text[:300]}"

    def send(self, method: str, path: str, **kwargs: Any) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        self.client.cookies.clear()
        reply = self.client.request(method, path, headers=headers, **kwargs)
        for line in reply.headers.get_list("set-cookie"):
            name, _, value = line.split(";")[0].partition("=")
            self.cookies[name.strip()] = value.strip()
        return reply

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.send("GET", path, **kwargs)

    def post(self, path: str, body: Any = None, **kwargs: Any) -> httpx.Response:
        return self.send("POST", path, json={} if body is None else body, **kwargs)

    def put(self, path: str, body: Any = None) -> httpx.Response:
        return self.send("PUT", path, json={} if body is None else body)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.send("PATCH", path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.send("DELETE", path)

    def upload(self, guide_id: str, data: bytes, name: str = BIKE_HUB) -> httpx.Response:
        return self.send(
            "POST",
            f"/api/guides/{guide_id}/model",
            content=data,
            headers={"Content-Type": "model/gltf-binary", "X-File-Name": quote(name)},
        )

    def working(self, guide_id: str) -> dict[str, Any]:
        reply = self.get(f"/api/guides/{guide_id}/working")
        assert reply.status_code == 200, f"GET working answered {reply.status_code}"
        return reply.json()

    def commit(self, guide_id: str, field: str, value: Any) -> httpx.Response:
        based_on = self.working(guide_id)["field_revisions"][field]
        reply = self.patch(f"/api/guides/{guide_id}/working", {"field": field, "value": value, "based_on": based_on})
        assert reply.status_code == 200, f"PATCH {field} answered {reply.status_code}: {reply.text[:300]}"
        return reply


def has(reply: httpx.Response, status: int, **fields: Any) -> None:
    assert reply.status_code == status, f"Expected {status} {fields}; got {reply.status_code}: {reply.text[:300]}"
    body = reply.json()
    for key, value in fields.items():
        assert body.get(key) == value, f"Expected {key}={value!r} in {body}"


def make_world(base: str) -> dict[str, Any]:
    reply = post_json(base, "/api/grading/world", {})
    assert reply.status_code == 201, f"POST /api/grading/world answered {reply.status_code}: {reply.text[:300]}"
    return reply.json()


def suffix_of(world: dict[str, Any]) -> str:
    return world["guides"]["public"]["title"].rsplit(" ", 1)[1]


def storage_down_url() -> str:
    return os.environ["APP_STORAGE_DOWN_URL"].rstrip("/")


def short_limits_url() -> str:
    return os.environ["APP_SHORT_LIMITS_URL"].rstrip("/")


def sample(base: str, name: str = BIKE_HUB) -> bytes:
    reply = httpx.get(f"{base}/samples/{name}", timeout=HTTP_TIMEOUT)
    assert reply.status_code == 200, f"GET /samples/{name} answered {reply.status_code}"
    assert reply.headers["content-type"].startswith("model/gltf-binary")
    return reply.content


def new_guide(api: Api, title: str = "Probe guide") -> dict[str, Any]:
    reply = api.post("/api/guides", {"title": title, "currency": "EUR"})
    assert reply.status_code == 201, f"POST /api/guides answered {reply.status_code}: {reply.text[:300]}"
    return reply.json()


def cost_text(symbol: str, minor: int) -> str:
    return f"{symbol}{minor // 100:,}.{minor % 100:02d}"


def amount(value: str | None) -> float:
    return float(re.sub(r"[^0-9.\-]", "", value or "0") or 0)


def wrap_glb(document: bytes, binary: bytes | None) -> bytes:
    chunks = struct.pack("<II", len(document), 0x4E4F534A) + document
    if binary is not None:
        chunks += struct.pack("<II", len(binary), 0x004E4942) + binary
    return b"glTF" + struct.pack("<II", 2, 12 + len(chunks)) + chunks


def make_glb(names: list[str], uri: str | None = None, size: int | None = None) -> bytes:
    positions = struct.pack("<9f", 0, 0, 0, 1, 0, 0, 0, 1, 0)
    buffer: dict[str, Any] = {"byteLength": len(positions)}
    if uri:
        buffer["uri"] = uri
    document = json.dumps(
        {
            "asset": {"version": "2.0"},
            "scene": 0,
            "scenes": [{"nodes": list(range(len(names)))}],
            "nodes": [{"name": name, "mesh": 0} for name in names],
            "meshes": [{"primitives": [{"attributes": {"POSITION": 0}}]}],
            "accessors": [{"bufferView": 0, "componentType": FLOAT_COMPONENT, "count": 3, "type": "VEC3", "min": [0, 0, 0], "max": [1, 1, 0]}],
            "bufferViews": [{"buffer": 0, "byteLength": len(positions)}],
            "buffers": [buffer],
        }
    ).encode()
    binary = None if uri else positions
    overhead = 12 + 8 + (8 + len(binary) if binary is not None else 0)
    if size is not None:
        document += b" " * (size - overhead - len(document))
    else:
        document += b" " * (-len(document) % 4)
    return wrap_glb(document, binary)


def deep_glb(depth: int) -> bytes:
    nested = '{"a":' * depth + "1" + "}" * depth
    document = ('{"asset":{"version":"2.0"},"extras":' + nested + "}").encode()
    return wrap_glb(document + b" " * (-len(document) % 4), None)


def sign_in_page(page: Page, origin: str, account: dict[str, Any]) -> None:
    reply = page.request.post(f"{origin}/api/session", data={"email": account["email"], "password": account["password"]})
    assert reply.status == 200, f"POST /api/session answered {reply.status}"


def wait_live(page: Page) -> None:
    for _ in range(LIVE_SETUP_POLLS):
        if page.evaluate("() => window.__probe.live.some(s => s.readyState === 1)"):
            origin = "{0.scheme}://{0.netloc}".format(urlsplit(page.url))
            page.request.get(f"{origin}/api/health")
            return
        advance(page, FRAME_MS)


@contextmanager
def opened(
    browser: Any,
    url: str,
    viewport: dict[str, int] = DESKTOP,
    account: dict[str, Any] | None = None,
    reduced_motion: str = "no-preference",
    no_webgl: bool = False,
    live: bool = False,
    touch: bool = False,
    requests: list[str] | None = None,
) -> Iterator[Page]:
    origin = "{0.scheme}://{0.netloc}".format(urlsplit(url))
    with open_app(browser, f"{origin}/api/health", reduced_motion=reduced_motion, no_webgl=no_webgl) as page:
        page.set_viewport_size(viewport)
        page.context.add_init_script(PROBE_SCRIPT)
        cdp = session(page)
        if touch:
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if account:
            sign_in_page(page, origin, account)
        if requests is not None:
            page.on("request", lambda r: requests.append(r.url))
        page.goto(url)
        if live:
            wait_live(page)
        yield page


def second_tab(page: Page, url: str) -> Page:
    tab = page.context.new_page()
    tab.goto(url)
    wait_live(tab)
    return tab


def role(page: Page | Locator, kind: str, name: str) -> Locator:
    return page.get_by_role(kind, name=name, exact=True)


def stage(page: Page) -> Locator:
    return role(page, "application", "Model stage")


def status(page: Page, name: str) -> Locator:
    return role(page, "status", name)


def figure(page: Page, name: str) -> Locator:
    return page.locator(f'[data-figure="{name}"]:visible').first


def callouts_of(page: Page, name: str | None = None) -> list[dict[str, float]]:
    return page.evaluate(
        """name => [...document.querySelectorAll('[data-callout]')]
            .filter(el => name === null || el.getAttribute('data-callout') === name)
            .filter(el => {
                const r = el.getBoundingClientRect();
                const s = getComputedStyle(el);
                return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none';
            })
            .map(el => { const r = el.getBoundingClientRect(); return {x: r.x, y: r.y, width: r.width, height: r.height}; })""",
        name,
    )


def markup_count(locator: Locator) -> int:
    return locator.evaluate("el => el.querySelectorAll(\"b, strong, a[href='b']\").length")


def body_text(page: Page) -> str:
    return squeeze(page.locator("body").inner_text())


def hook(page: Page, name: str) -> str | None:
    return stage(page).get_attribute(f"data-{name}")


def wait_state(page: Page, state: str = "ready", budget_ms: int = 4000) -> None:
    poll(lambda: stage(page).count() and hook(page, "state") == state, f"Model stage data-state={state}", page, budget_ms=budget_ms)


def press(page: Page, key: str) -> None:
    page.keyboard.press(key)
    advance(page, SETTLE_MS)


def tab_to(page: Page, target: Locator) -> None:
    expect(target).to_be_attached()
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if target.evaluate("el => el === document.activeElement"):
            return
    pytest.fail(f"Tab never reached {target}")


def mark_page(page: Page) -> None:
    page.evaluate("() => { window.__probe.stay = true; }")


def assert_no_reload(page: Page) -> None:
    assert page.evaluate("() => window.__probe.stay"), "The page reloaded; the brief asks for an in-place update"


def scroll(page: Page, y: float) -> None:
    page.evaluate(
        """y => new Promise(done => {
            const before = window.scrollY;
            addEventListener('scroll', () => done(), {once: true});
            window.scrollTo({top: y, behavior: 'instant'});
            if (window.scrollY === before) done();
        })""",
        y,
    )
    advance(page, SETTLE_MS)


def settled_y(page: Page, n: int) -> float:
    return (n + 0.65) * page.viewport_size["height"]


def progress_copy(n: int, total: int = 5) -> str:
    step = PUBLIC_STEPS[n - 1]
    return f"Step {n} of {total}: {step[1]}. Parts so far: {step[6]}."


def assert_pose(page: Page, explode: float, yaw: float, pitch: float) -> None:
    assert abs(float(hook(page, "explode") or -1) - explode) < 0.002, f"data-explode {hook(page, 'explode')}, expected {explode}"
    assert abs(float(hook(page, "yaw") or 999) - yaw) <= 1, f"data-yaw {hook(page, 'yaw')}, expected {yaw}"
    assert abs(float(hook(page, "pitch") or 999) - pitch) <= 1, f"data-pitch {hook(page, 'pitch')}, expected {pitch}"


def assert_settled(page: Page, n: int) -> None:
    step = PUBLIC_STEPS[n - 1]
    assert hook(page, "step") == str(n), f"data-step {hook(page, 'step')}, expected {n}"
    assert_pose(page, step[3], step[4], step[5])
    assert hook(page, "zoom") == "1.00"


def ready_editor(page: Page, field: str = "Step 1 title") -> None:
    poll(lambda: role(page, "textbox", field).count() > 0, f"editor field {field}", page)
    poll(lambda: squeeze(status(page, "Latest version").text_content()).startswith(("Latest version", "No saved")), "Latest version status", page)
    wait_live(page)


def commit_ui(page: Page, field: Locator, value: str) -> None:
    fill(field, value)
    advance(page, COMMIT_MS)


def step_field(api: Api, guide_id: str, n: int, key: str) -> Any:
    return api.working(guide_id)["steps"][n - 1][key]


def wait_field(api: Api, guide_id: str, n: int, key: str, value: Any, page: Page | None = None) -> None:
    poll(lambda: step_field(api, guide_id, n, key) == value, f"working step {n} {key} == {value!r}", page, budget_ms=COMMIT_MS)


def part_id(work: dict[str, Any], name: str) -> str:
    return next(p["id"] for p in work["parts"] if p["name"] == name)


def select_part(page: Page, label: str) -> None:
    item = role(page, "treeitem", label)
    click(item)
    press(page, "Enter")


def versions(api: Api, guide_id: str) -> list[dict[str, Any]]:
    reply = api.get(f"/api/guides/{guide_id}/versions")
    assert reply.status_code == 200, f"GET versions answered {reply.status_code}"
    return reply.json()["items"]


def version(api: Api, guide_id: str, number: int) -> dict[str, Any]:
    reply = api.get(f"/api/guides/{guide_id}/versions/{number}")
    assert reply.status_code == 200, f"GET version {number} answered {reply.status_code}"
    return reply.json()


def is_focused(locator: Locator) -> bool:
    return locator.count() > 0 and locator.evaluate("el => el === document.activeElement")


def assert_dialog_wrap(page: Page, dialog: Locator, controls: list[Locator]) -> None:
    poll(lambda: is_focused(controls[0]), "the dialog's first control takes focus", page, budget_ms=SETTLE_MS)
    visited: list[int] = []
    for _ in controls:
        visited.append(next((i for i, c in enumerate(controls) if is_focused(c)), -1))
        press(page, "Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "Tab left the open dialog"
    assert sorted(visited) == list(range(len(controls))), f"Tab visited controls {visited}"
    assert is_focused(controls[0]), "Tab past the last control did not wrap to the first"
    press(page, "Shift+Tab")
    assert dialog.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab left the open dialog"
    assert is_focused(controls[visited[-1]]), "Shift+Tab from the first control did not wrap to the last"
    press(page, "Tab")


def drop_file(page: Page, name: str, data: bytes) -> None:
    stage(page).evaluate(
        """(el, [name, b64]) => {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            const dt = new DataTransfer();
            dt.items.add(new File([bytes], name));
            const r = el.getBoundingClientRect();
            const x = r.x + r.width / 2, y = r.y + r.height / 2;
            const target = document.elementFromPoint(x, y) || el;
            for (const type of ['dragenter', 'dragover', 'drop'])
                target.dispatchEvent(new DragEvent(type, {bubbles: true, cancelable: true, composed: true, dataTransfer: dt, clientX: x, clientY: y}));
        }""",
        [name, base64.b64encode(data).decode()],
    )
    advance(page, SETTLE_MS)


def choose_file(page: Page, key: str, name: str, data: bytes) -> None:
    role(page, "button", "Choose a model file").focus()
    with page.expect_file_chooser(timeout=POLL_SECONDS * 1000) as chooser:
        page.keyboard.press(key)
    chooser.value.set_files({"name": name, "mimeType": "application/octet-stream", "buffer": data})
    advance(page, SETTLE_MS)


def release_held(gate: Any) -> None:
    (gate.release if hasattr(gate, "release") else gate)()


def gl_counters(page: Page) -> dict[str, int]:
    return page.evaluate("() => window.__probe.gl")


def sound_state(page: Page) -> dict[str, Any]:
    return page.evaluate("() => window.__probe.sound()")


def touch(page: Page, kind: str, points: list[tuple[float, float]]) -> None:
    session(page).send(
        "Input.dispatchTouchEvent",
        {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]},
    )


def drag(page: Page, start: tuple[float, float], delta: tuple[float, float]) -> None:
    touch(page, "touchStart", [start])
    for i in range(1, TOUCH_STEPS + 1):
        touch(page, "touchMove", [(start[0] + delta[0] * i / TOUCH_STEPS, start[1] + delta[1] * i / TOUCH_STEPS)])
    touch(page, "touchEnd", [])
    advance(page, SETTLE_MS)


def scroll_rest(page: Page, seconds: float = POLL_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    last, quiet = page.evaluate("() => window.scrollY"), time.monotonic()
    while time.monotonic() < deadline:
        now = page.evaluate("() => window.scrollY")
        if now != last:
            last, quiet = now, time.monotonic()
        elif time.monotonic() - quiet >= SCROLL_QUIET_S:
            return
    pytest.fail(f"Within {seconds} s expected: the page to stop scrolling after the drag")


def stage_center(page: Page) -> tuple[float, float]:
    box = stage(page).bounding_box()
    assert box, "Model stage has no box"
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def undersized(page: Page) -> list[str]:
    small: list[str] = []
    for kind in ("button", "link", "switch", "tab", "checkbox", "combobox", "textbox", "searchbox", "spinbutton", "slider", "treeitem"):
        for element in page.get_by_role(kind).all():
            if not element.is_visible():
                continue
            size = element.evaluate(
                """el => {
                    const label = el.closest('label') || (el.labels && el.labels[0]);
                    const own = el.getBoundingClientRect();
                    const area = label ? label.getBoundingClientRect() : own;
                    return {w: Math.max(own.width, area.width), h: Math.max(own.height, area.height),
                            name: el.getAttribute('aria-label') || el.textContent || el.id};
                }"""
            )
            if size["w"] < TARGET_PX - 0.5 or size["h"] < TARGET_PX - 0.5:
                small.append(f"{kind} {size['name']!r} {size['w']:.0f}x{size['h']:.0f}")
    return small


def mails_for(mail: Any, email: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages(settle=MAIL_SETTLE) if email in addresses(m["To"])]


def inbox(mail: Any, email: str, expected: int) -> list[dict[str, Any]]:
    return poll(lambda: (lambda found: found if len(found) >= expected else None)(mails_for(mail, email)), f"{expected} messages to {email}")


def token_of(message: dict[str, Any]) -> str:
    match = re.search(r"/confirm\?token=([^\s\"'<>&]+)", mail_text(message))
    assert match, "The message carries no /confirm?token= link"
    return match.group(1)


def sign_in_form(page: Page, account: dict[str, Any]) -> None:
    fill(page.get_by_label("Email", exact=True), account["email"])
    fill(page.get_by_label("Password", exact=True), account["password"])
    click(role(page, "button", "Sign in"))
    advance(page, SETTLE_MS)


def path_and_query(page: Page) -> str:
    parts = urlsplit(page.url)
    return parts.path + (f"?{parts.query}" if parts.query else "")


def wait_path(page: Page, predicate: Callable[[str], bool], why: str) -> None:
    poll(lambda: predicate(path_and_query(page)), why, page, budget_ms=2000)


def test_wf_keyboard_authoring_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    axle = part_id(api.working(guide["id"]), "Axle")
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as page:
        ready_editor(page)
        other = second_tab(page, url)
        ready_editor(other)
        page.bring_to_front()
        tab_to(page, role(page, "button", "Add step"))
        press(page, "Enter")
        see(page, status(page, "Editor status"), "Step 6 added.")
        expect(role(page, "textbox", "Step 6 title")).to_be_focused()
        page.keyboard.type("Pack fresh grease")
        advance(page, COMMIT_MS)
        tab_to(page, role(page, "textbox", "Step 6 text"))
        page.keyboard.type("Work the grease in with a clean finger.")
        advance(page, COMMIT_MS)
        tab_to(page, role(page, "checkbox", "Axle"))
        press(page, "Space")
        tab_to(page, role(page, "slider", "Apart amount"))
        press(page, "ArrowRight")
        press(page, "ArrowRight")
        advance(page, COMMIT_MS)
        poll(lambda: step_field(api, guide["id"], 6, "explode") > 0 and step_field(api, guide["id"], 6, "focus_parts") == [axle], "new step's parts and apart amount in the working copy", page)
        page.keyboard.press("Control+s")
        see(page, status(page, "Editor status"), "Saved as version 2.")
        see_live(status(other, "Latest version"), "Latest version 2")
        saved = version(api, guide["id"], 2)["steps"][5]
        assert saved["title"] == PACK_TITLE and saved["focus_parts"] == [axle] and saved["explode"] > 0
        tab_to(page, role(page, "textbox", "Step 6 title"))
        press(page, "Alt+ArrowUp")
        see(page, status(page, "Editor status"), "Step 6 moved to position 5.")
        wait_field(api, guide["id"], 5, "title", "Pack fresh grease", page)
        tab_to(page, role(page, "separator", "Resize stage and steps"))
        press(page, "End")
        expect(role(page, "separator", "Resize stage and steps")).to_have_attribute("aria-valuenow", "70")


def test_wf_keyboard_authoring_limit_recovery(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        field = role(page, "textbox", "Step 1 title")
        field.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("t" * (STEP_TITLE_MAX + 1))
        advance(page, COMMIT_MS)
        see(page, status(page, "Editor status"), f"Step 1 title can be at most {STEP_TITLE_MAX} characters.")
        press(page, "Backspace")
        advance(page, COMMIT_MS)
        wait_field(api, guide["id"], 1, "title", "t" * STEP_TITLE_MAX, page)
        page.keyboard.press("Control+s")
        see(page, status(page, "Editor status"), "Saved as version 2.")
    assert version(api, guide["id"], 2)["steps"][0]["title"] == "t" * STEP_TITLE_MAX


def test_toolbar_tab_order(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/edit/{world['guides']['draft']['slug']}", account=world["author"]) as page:
        ready_editor(page)
        toolbar = role(page, "toolbar", "Editor tools")
        role(toolbar, "button", TOOLBAR_ORDER[0]).focus()
        names = [squeeze(n) for n in tab_order(page, len(TOOLBAR_ORDER) - 1)]
        assert names == TOOLBAR_ORDER[1:], f"Toolbar Tab order was {names}"
        for name in reversed(TOOLBAR_ORDER[:-1]):
            page.keyboard.press("Shift+Tab")
            expect(role(toolbar, "button", name)).to_be_focused()


def test_add_step_and_parts_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    axle = part_id(api.working(guide["id"]), "Axle")
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        assert role(page, "textbox", "Step 6 title").count() == 0
        role(page, "button", "Add step").focus()
        press(page, "Enter")
        see(page, status(page, "Editor status"), "Step 6 added.")
        expect(role(page, "textbox", "Step 6 title")).to_be_focused()
        assert hook(page, "step") == "6"
        poll(lambda: len(api.working(guide["id"])["steps"]) == 6, "sixth step in the working copy", page)
        box = role(role(page, "group", "Parts in this step"), "checkbox", "Axle")
        expect(box).not_to_be_checked()
        box.focus()
        press(page, "Space")
        expect(box).to_be_checked()
        advance(page, COMMIT_MS)
        wait_field(api, guide["id"], 6, "focus_parts", [axle], page)
        expect(role(page, "textbox", "Callout for Axle")).to_be_visible()
        press(page, "Space")
        advance(page, COMMIT_MS)
        wait_field(api, guide["id"], 6, "focus_parts", [], page)


def test_apart_slider_applies_after_delay(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/edit/{world['guides']['draft']['slug']}", account=world["author"]) as page:
        ready_editor(page)
        wait_state(page)
        role(page, "textbox", "Step 1 title").focus()
        advance(page, SETTLE_MS)
        before = hook(page, "explode")
        slider = role(page, "slider", "Apart amount")
        slider.focus()
        page.keyboard.press("ArrowRight")
        advance(page, APPLY_BEFORE_MS - 100)
        page.keyboard.press("ArrowRight")
        advance(page, APPLY_BEFORE_MS)
        assert hook(page, "explode") == before, "data-explode changed before the 250 ms delay after the last key"
        advance(page, 1)
        assert hook(page, "explode") != before, "data-explode did not change at 250 ms"
        assert float(hook(page, "explode") or 0) > float(before or 0)


def test_save_shortcut_from_step_text(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as page:
        ready_editor(page)
        other = second_tab(page, url)
        ready_editor(other)
        see(other, status(other, "Latest version"), "Latest version 1")
        page.bring_to_front()
        field = role(page, "textbox", "Step 2 text")
        commit_ui(page, field, "Saved by the shortcut.")
        wait_field(api, guide["id"], 2, "text", "Saved by the shortcut.", page)
        field.focus()
        page.keyboard.press("Control+s")
        assert page.evaluate("() => window.__probe.lastKey.defaultPrevented"), "Ctrl+S left the browser's save dialog default active"
        see(page, status(page, "Editor status"), "Saved as version 2.")
        see(page, status(page, "Latest version"), "Latest version 2")
        see_live(status(other, "Latest version"), "Latest version 2")
    assert version(api, guide["id"], 2)["steps"][1]["text"] == SHORTCUT_TEXT
    assert versions(api, guide["id"])[0]["number"] == 2


def test_step_move_and_separator_keys(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    first = step_field(api, guide["id"], 1, "title")
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        role(page, "textbox", "Step 1 title").focus()
        press(page, "Alt+ArrowUp")
        see(page, status(page, "Editor status"), "Step 1 is already first.")
        press(page, "Alt+ArrowDown")
        see(page, status(page, "Editor status"), "Step 1 moved to position 2.")
        expect(role(page, "textbox", "Step 2 title")).to_be_focused()
        expect(role(page, "textbox", "Step 2 title")).to_have_value(first)
        wait_field(api, guide["id"], 2, "title", first, page)
        press(page, "Alt+ArrowUp")
        see(page, status(page, "Editor status"), "Step 2 moved to position 1.")
        wait_field(api, guide["id"], 1, "title", first, page)
        separator = role(page, "separator", "Resize stage and steps")
        expect(separator).to_have_attribute("aria-valuenow", "50")
        separator.focus()
        for key, value in (("ArrowLeft", "45"), ("ArrowRight", "50"), ("Home", "30"), ("ArrowLeft", "30")):
            press(page, key)
            expect(separator).to_have_attribute("aria-valuenow", value)
        narrow = stage(page).bounding_box()
        for key, value in (("End", "70"), ("ArrowRight", "70")):
            press(page, key)
            expect(separator).to_have_attribute("aria-valuenow", value)
        wide = stage(page).bounding_box()
        assert narrow and wide and wide["width"] > narrow["width"], "The panes did not resize with the separator"


@pytest.mark.parametrize("case", ["guide_title", "step_text"], ids=["guide_title", "step_text"])
def test_typed_limits_keep_text(browser: Any, app_url: str, case: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    work = api.working(guide["id"])
    if case == "guide_title":
        label, limit, path = "Guide title", GUIDE_TITLE_MAX, "title"
        read = lambda: api.working(guide["id"])["title"]
    else:
        label, limit, path = "Step 1 text", STEP_TEXT_MAX, f"step/{work['steps'][0]['id']}/text"
        read = lambda: api.working(guide["id"])["steps"][0]["text"]
    exact = EMOJI * limit
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        field = role(page, "textbox", label)
        commit_ui(page, field, exact)
        poll(lambda: read() == exact, f"{label} stored at exactly {limit} code points", page)
        over = exact + EMOJI
        commit_ui(page, field, over)
        see(page, status(page, "Editor status"), f"{label} can be at most {limit:,} characters.")
        advance(page, NOTICE_MS)
        see(page, status(page, "Editor status"), "", budget_ms=SETTLE_MS)
        expect(field).to_have_value(over)
        assert read() == exact, "The refused text reached the working copy"
    based_on = api.working(guide["id"])["field_revisions"][path]
    reply = api.patch(f"/api/guides/{guide['id']}/working", {"field": path, "value": over, "based_on": based_on})
    has(reply, 422, error="too_long", field=path, limit=limit)


def test_wf_undo_redo_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    original = api.working(guide["id"])["steps"]
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        commit_ui(author, role(author, "textbox", "Step 1 text"), "The author's draft sentence.")
        wait_field(api, guide["id"], 1, "text", "The author's draft sentence.", author)
        role(author, "textbox", "Step 2 title").focus()
        press(author, "Alt+ArrowUp")
        see(author, status(author, "Editor status"), "Step 2 moved to position 1.")
        wait_field(api, guide["id"], 1, "id", original[1]["id"], author)
        commit_ui(coauthor, role(coauthor, "textbox", "Step 3 title"), "The co-author's title")
        wait_field(api, guide["id"], 3, "title", "The co-author's title", coauthor)

        poll(lambda: role(author, "textbox", "Step 3 title").input_value() == "The co-author's title", "co-author's edit in the author's page")
        press(author, "Control+z")
        see(author, status(author, "Editor status"), "Undid: Move step 2 to 1.")
        wait_field(api, guide["id"], 1, "id", original[0]["id"], author)
        press(author, "Control+z")
        see(author, status(author, "Editor status"), "Undid: Edit step 1 text.")
        wait_field(api, guide["id"], 1, "text", original[0]["text"], author)
        press(author, "Control+Shift+z")
        see(author, status(author, "Editor status"), "Redid: Edit step 1 text.")
        wait_field(api, guide["id"], 1, "text", "The author's draft sentence.", author)
        press(author, "Control+z")
        wait_field(api, guide["id"], 1, "text", original[0]["text"], author)
        poll(lambda: role(coauthor, "textbox", "Step 1 text").input_value() == original[0]["text"], "undo reaches the co-author")
        assert role(coauthor, "textbox", "Step 3 title").input_value() == COAUTHOR_TITLE
        author.keyboard.press("Control+s")
        see(author, status(author, "Editor status"), "Saved as version 2.")
    saved = version(api, guide["id"], 2)["steps"]
    assert [s["id"] for s in saved] == [s["id"] for s in original]
    assert saved[0]["text"] == original[0]["text"]
    assert saved[2]["title"] == COAUTHOR_TITLE


def test_wf_undo_redo_add_and_delete(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    original = [s["id"] for s in api.working(guide["id"])["steps"]]
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        role(page, "button", "Add step").focus()
        press(page, "Enter")
        poll(lambda: len(api.working(guide["id"])["steps"]) == 6, "added step in the working copy", page)
        press(page, "Control+z")
        see(page, status(page, "Editor status"), "Undid: Add step 6.")
        poll(lambda: [s["id"] for s in api.working(guide["id"])["steps"]] == original, "undo of the add deletes the step", page)
        role(page, "button", "Delete step 5").focus()
        press(page, "Enter")
        see(page, status(page, "Editor status"), "Step 5 deleted.")
        poll(lambda: len(api.working(guide["id"])["steps"]) == 4, "deleted step gone from the working copy", page)
        press(page, "Control+z")
        see(page, status(page, "Editor status"), "Undid: Delete step 5.")
        poll(lambda: [s["id"] for s in api.working(guide["id"])["steps"]] == original, "undo brings the step back with its id", page)


def test_undo_restores_step_text(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    original = step_field(api, guide["id"], 2, "text")
    edited = f"line one\n  {MARKUP_TEXT} {EMOJI}"
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        field = role(page, "textbox", "Step 2 text")
        commit_ui(page, field, edited)
        wait_field(api, guide["id"], 2, "text", edited, page)
        field.focus()
        press(page, "Control+z")
        see(page, status(page, "Editor status"), "Undid: Edit step 2 text.")
        expect(field).to_have_value(original)
        wait_field(api, guide["id"], 2, "text", original, page)
        press(page, "Control+Shift+z")
        see(page, status(page, "Editor status"), "Redid: Edit step 2 text.")
        expect(field).to_have_value(edited)
        wait_field(api, guide["id"], 2, "text", edited, page)


def test_undo_of_step_move(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    steps = api.working(guide["id"])["steps"]
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        role(page, "textbox", "Step 1 title").focus()
        press(page, "Alt+ArrowDown")
        wait_field(api, guide["id"], 2, "id", steps[0]["id"], page)
        expect(role(page, "textbox", "Step 1 title")).to_have_value(steps[1]["title"])
        press(page, "Control+z")
        see(page, status(page, "Editor status"), "Undid: Move step 1 to 2.")
        wait_field(api, guide["id"], 1, "id", steps[0]["id"], page)
        expect(role(page, "textbox", "Step 1 title")).to_have_value(steps[0]["title"])
        expect(role(page, "textbox", "Step 2 title")).to_have_value(steps[1]["title"])


def test_undo_spares_coauthor_edit(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    co_api = Api(app_url, world["coauthor"])
    original = step_field(api, guide["id"], 1, "title")
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        commit_ui(author, role(author, "textbox", "Step 1 title"), "Author's first")
        wait_field(api, guide["id"], 1, "title", "Author's first", author)
        commit_ui(coauthor, role(coauthor, "textbox", "Step 2 title"), "Co-author's second")
        wait_field(co_api, guide["id"], 2, "title", "Co-author's second", coauthor)
        poll(lambda: role(author, "textbox", "Step 2 title").input_value() == "Co-author's second", "co-author's edit reaches the author")
        press(author, "Control+z")
        wait_field(api, guide["id"], 1, "title", original, author)
        assert step_field(api, guide["id"], 2, "title") == CO_SECOND
        assert role(author, "textbox", "Step 2 title").input_value() == CO_SECOND
        assert role(coauthor, "textbox", "Step 2 title").input_value() == CO_SECOND
        commit_ui(author, role(author, "textbox", "Step 3 title"), "Author's third")
        wait_field(api, guide["id"], 3, "title", "Author's third", author)
        poll(lambda: role(coauthor, "textbox", "Step 3 title").input_value() == "Author's third", "author's edit reaches the co-author")
        commit_ui(coauthor, role(coauthor, "textbox", "Step 3 title"), "Co-author's third")
        wait_field(co_api, guide["id"], 3, "title", "Co-author's third", coauthor)
        poll(lambda: role(author, "textbox", "Step 3 title").input_value() == "Co-author's third", "overwrite reaches the author")
        press(author, "Control+z")
        see(author, status(author, "Editor status"), f"Cannot undo: {world['coauthor']['name']} has changed this since.")
        assert step_field(api, guide["id"], 3, "title") == CO_THIRD
        assert role(author, "textbox", "Step 3 title").input_value() == CO_THIRD
        assert role(coauthor, "textbox", "Step 3 title").input_value() == CO_THIRD


def test_guide_total_follows_price(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    work = api.working(guide["id"])
    assert work["guide_total_text"] == "£6.40"
    new_price = 420
    expected = cost_text("£", new_price + 320)
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        mark_page(page)
        see(page, figure(page, "total-cost"), "£6.40")
        select_part(page, "Left bearing")
        price = role(page, "textbox", "Unit price")
        commit_ui(page, price, "4.20")
        see(page, figure(page, "total-cost"), expected)
        see(page, status(page, "Editor status"), f"Guide total {expected}.")
        assert_no_reload(page)
        assert api.working(guide["id"])["guide_total_text"] == expected
        press(page, "Control+z")
        see(page, figure(page, "total-cost"), "£6.40")
        poll(lambda: api.working(guide["id"])["guide_total"] == 640, "undo returns the earlier total in the working copy", page)
        assert_no_reload(page)


def test_shortcuts_on_toolbar_and_empty_stacks(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    original = step_field(api, guide["id"], 1, "text")
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        button = role(page, "button", "Save version")
        button.focus()
        press(page, "Control+z")
        see(page, status(page, "Editor status"), "Nothing to undo.")
        press(page, "Control+Shift+z")
        see(page, status(page, "Editor status"), "Nothing to redo.")
        commit_ui(page, role(page, "textbox", "Step 1 text"), "Shortcut edit")
        wait_field(api, guide["id"], 1, "text", "Shortcut edit", page)
        button.focus()
        press(page, "Control+z")
        see(page, status(page, "Editor status"), "Undid: Edit step 1 text.")
        wait_field(api, guide["id"], 1, "text", original, page)
        expect(button).to_be_focused()
        press(page, "Control+Shift+z")
        see(page, status(page, "Editor status"), "Redid: Edit step 1 text.")
        wait_field(api, guide["id"], 1, "text", "Shortcut edit", page)
        press(page, "Control+z")
        commit_ui(page, role(page, "textbox", "Step 1 text"), "Newer edit")
        wait_field(api, guide["id"], 1, "text", "Newer edit", page)
        press(page, "Control+Shift+z")
        see(page, status(page, "Editor status"), "Nothing to redo.")


def test_saving_the_undone_state(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    original = step_field(api, guide["id"], 4, "text")
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        field = role(page, "textbox", "Step 4 text")
        commit_ui(page, field, "This edit gets undone.")
        wait_field(api, guide["id"], 4, "text", "This edit gets undone.", page)
        field.focus()
        press(page, "Control+z")
        wait_field(api, guide["id"], 4, "text", original, page)
        page.keyboard.press("Control+s")
        see(page, status(page, "Editor status"), "Saved as version 2.")
    saved = json.dumps(version(api, guide["id"], 2))
    assert UNDONE_TEXT not in saved
    assert version(api, guide["id"], 2)["steps"][3]["text"] == original


def test_wf_scroll_reading_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reading = httpx.get(f"{app_url}/api/guides/{guide['id']}", timeout=HTTP_TIMEOUT).json()
    assert [s["parts_cost_text"] for s in reading["steps"]] == [s[6] for s in PUBLIC_STEPS]
    with opened(browser, f"{app_url}/g/{guide['slug']}") as page:
        wait_state(page)
        for n in [1, 2, 3, 4, 5, 4, 3, 2, 1]:
            scroll(page, settled_y(page, n))
            advance(page, COUNT_MS)
            assert_settled(page, n)
            see(page, status(page, "Step counter"), f"0{n} / 05")
            see(page, status(page, "Reading progress"), progress_copy(n))
            see(page, figure(page, "parts-cost"), PUBLIC_STEPS[n - 1][6])
            expect(role(page, "heading", PUBLIC_STEPS[n - 1][1])).to_be_visible()
        height = page.viewport_size["height"]
        assert abs(page.evaluate("() => document.documentElement.scrollHeight") - height * 7) <= 2
        scroll(page, 6 * height)
        advance(page, COUNT_MS)
        assert hook(page, "step") == "5"
        see(page, figure(page, "closing-total"), PUBLIC_TOTAL)


def test_wf_scroll_reading_orbit_then_scroll(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2") as page:
        wait_state(page)
        height = page.viewport_size["height"]
        stage(page).focus()
        press(page, "ArrowLeft")
        assert hook(page, "yaw") == str(45 - YAW_STEP)
        scroll(page, 3.5 * height)
        assert_pose(page, 0.375, 52.5, 15)
        scroll(page, 3.65 * height)
        assert_settled(page, 3)
        scroll(page, 3.5 * height)
        assert_pose(page, 0.375, 52.5, 15)


def test_scroll_position_sets_step(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}") as page:
        wait_state(page)
        height = page.viewport_size["height"]
        marks = [(height - 1, 1), (height, 1), (2 * height - 1, 1), (2 * height, 2), (3 * height - 1, 2), (3 * height, 3), (4 * height, 4), (5 * height, 5), (6 * height, 5), (5 * height - 1, 4), (2 * height + 1, 2)]
        for y, n in marks:
            scroll(page, y)
            assert hook(page, "step") == str(n), f"At y={y} data-step is {hook(page, 'step')}, expected {n}"
            see(page, status(page, "Step counter"), f"0{n} / 05")
            see(page, status(page, "Reading progress"), progress_copy(n))


def test_apart_follows_band(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}") as page:
        wait_state(page)
        height = page.viewport_size["height"]
        pairs = [(2, 0.0, 0.25), (3, 0.25, 0.5), (4, 0.5, 0.85), (5, 0.85, 0.0)]
        for n, old, new in pairs:
            points = [(0.0, old), (0.35, old), (0.425, old + (new - old) * 0.25), (0.5, old + (new - old) * 0.5), (0.575, old + (new - old) * 0.75), (0.65, new), (0.9, new)]
            for fraction, expected in points:
                scroll(page, (n + fraction) * height)
                value = float(hook(page, "explode") or -1)
                assert abs(value - expected) < 0.01, f"Step {n} at {fraction}: data-explode {value}, expected {expected}"
            for fraction, expected in reversed(points):
                scroll(page, (n + fraction) * height)
                value = float(hook(page, "explode") or -1)
                assert abs(value - expected) < 0.01, f"Back through step {n} at {fraction}: data-explode {value}, expected {expected}"
        scroll(page, settled_y(page, 3))
        advance(page, SETTLE_MS)
        third = camera(page)
        scroll(page, settled_y(page, 4))
        advance(page, SETTLE_MS)
        fourth = camera(page)
        assert third and fourth and third != fourth, "Camera matrices did not change between steps with different poses"
        scroll(page, settled_y(page, 3))
        advance(page, SETTLE_MS)
        assert_settled(page, 3)


def test_parts_cost_counts_both_ways(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}") as page:
        wait_state(page)
        height = page.viewport_size["height"]
        scroll(page, 3.9 * height)
        advance(page, COUNT_MS)
        cost = figure(page, "parts-cost")
        see(page, cost, "€0.00")

        def run(y: float, old: str, new: str) -> None:
            scroll(page, y)
            seen = []
            for _ in range(2):
                advance(page, 128)
                seen.append(amount(cost.text_content()))
            low, high = sorted((amount(old), amount(new)))
            assert all(low < v < high for v in seen), f"Count from {old} to {new} showed {seen}"
            ordered = seen == sorted(seen, reverse=amount(new) < amount(old))
            assert ordered and seen[0] != seen[1], f"Count from {old} to {new} did not move toward {new}: {seen}"
            advance(page, COUNT_MS - 256)
            see(page, cost, new, budget_ms=SETTLE_MS)

        run(4 * height, "€0.00", "€18.90")
        run(5 * height, "€18.90", "€21.30")
        run(4.9 * height, "€21.30", "€18.90")
        run(3.9 * height, "€18.90", "€0.00")


def test_header_figures_count_up(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}") as page:
        poll(lambda: figure(page, "total-cost").count() > 0, "the header total figure")
        total, parts, steps = figure(page, "total-cost"), figure(page, "part-count"), figure(page, "step-count")
        poll(lambda: amount(total.text_content()) < amount(PUBLIC_TOTAL) and amount(parts.text_content()) < 9, "header figures below their final text before the clock moves")
        advance(page, HEADER_COUNT_MS // 2)
        assert 0 < amount(total.text_content()) < amount(PUBLIC_TOTAL), f"Mid-count total {total.text_content()}"
        assert 0 < amount(parts.text_content()) < 9, f"Mid-count parts {parts.text_content()}"
        advance(page, HEADER_COUNT_MS // 2 + SETTLE_MS)
        see(page, total, PUBLIC_TOTAL, budget_ms=SETTLE_MS)
        see(page, parts, "9", budget_ms=SETTLE_MS)
        see(page, steps, "5", budget_ms=SETTLE_MS)


def test_stage_keys_orbit_and_zoom(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2") as page:
        wait_state(page)
        model = stage(page)
        model.focus()
        for key, name, value in (
            ("ArrowLeft", "yaw", "30"),
            ("ArrowRight", "yaw", "45"),
            ("ArrowUp", "pitch", "35"),
            ("ArrowDown", "pitch", "20"),
            ("+", "zoom", "1.25"),
            ("-", "zoom", "1.00"),
        ):
            press(page, key)
            assert hook(page, name) == value, f"{key}: data-{name} {hook(page, name)}, expected {value}"
        for _ in range(8):
            press(page, "ArrowUp")
        assert hook(page, "pitch") == str(PITCH_MAX)
        for _ in range(16):
            press(page, "ArrowDown")
        assert hook(page, "pitch") == str(-PITCH_MAX)
        for _ in range(10):
            press(page, "+")
        assert float(hook(page, "zoom") or 0) == ZOOM_MAX
        for _ in range(20):
            press(page, "-")
        assert float(hook(page, "zoom") or 0) == ZOOM_MIN
        for _ in range(30):
            press(page, "ArrowRight")
            assert -180 <= int(hook(page, "yaw") or 999) <= 180
        press(page, "Home")
        assert (hook(page, "yaw"), hook(page, "pitch"), hook(page, "zoom")) == ("45", "20", "1.00")
        press(page, "Tab")
        assert not is_focused(model), "Tab did not leave the stage"


@pytest.mark.parametrize("viewport", list(VIEWPORTS.values()), ids=list(VIEWPORTS))
def test_reader_layouts_and_own_origin(browser: Any, app_url: str, viewport: dict[str, int]) -> None:
    world = make_world(app_url)
    requests: list[str] = []
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=3", viewport=viewport, requests=requests) as page:
        wait_state(page)
        advance(page, SETTLE_MS * 8)
        width, height = viewport["width"], viewport["height"]
        box = stage(page).bounding_box()
        heading = role(page, "heading", PUBLIC_STEPS[2][1]).bounding_box()
        bar = role(page, "button", "Next step").bounding_box()
        assert box and heading and bar
        if width == DESKTOP["width"]:
            assert abs(box["x"] - 0.42 * width) <= 2 and abs(box["x"] + box["width"] - width) <= 2
            assert abs(box["y"]) <= 2 and abs(box["height"] - height) <= 2
            assert heading["x"] + heading["width"] <= box["x"] + 2, "The steps column is not left of the stage"
            assert bar["x"] < box["x"] and bar["y"] < height / 2, "The reader bar is not atop the steps column"
        else:
            share = 0.46 if width == TABLET["width"] else 0.40
            assert abs(box["height"] - share * height) <= 2, f"Stage height {box['height']}"
            assert abs(box["y"]) <= 2 and abs(box["width"] - width) <= 2
            assert heading["y"] >= box["y"] + box["height"] - 2, "The step panel is not below the stage"
            assert bar["y"] + bar["height"] <= height + 1 and bar["y"] > height / 2, "The reader bar is not fixed at the bottom"
        before = stage(page).bounding_box()
        scroll(page, settled_y(page, 4))
        assert stage(page).bounding_box() == before, "The stage moved with the scroll"
        scroll(page, settled_y(page, 3))
        advance(page, SETTLE_MS * 8)
        layout(page)
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
        callouts = callouts_of(page)
        if width == PHONE["width"]:
            assert len(callouts) == 0, "A phone shows floating callouts"
            status_box = status(page, "Stage status").bounding_box()
            parts_box = role(page, "list", "Parts").bounding_box()
            assert status_box and parts_box
            assert box["y"] + box["height"] - 2 <= status_box["y"] and status_box["y"] <= parts_box["y"] and parts_box["y"] <= heading["y"]
        else:
            assert len(callouts_of(page, "Lower burr")) == 1
            assert len(callouts_of(page, "Drive shaft")) == 1
            for area in callouts:
                assert area and area["x"] >= -1 and area["y"] >= -1 and area["x"] + area["width"] <= width + 1 and area["y"] + area["height"] <= height + 1, f"Callout outside the viewport: {area}"
    outside = [u for u in requests if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
    assert not outside, f"Requests left the app's origin: {outside}"
    assert any("/api/models/" in u for u in requests), "The reader never fetched the guide's model"


def test_wf_deep_link_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    public, private = world["guides"]["public"], world["guides"]["private"]
    with opened(browser, f"{app_url}/g/{public['slug']}?step=3") as page, opened(browser, f"{app_url}/api/health", account=world["reader"]) as other:
        advance(page, SETTLE_MS)
        poll(lambda: hook(page, "step") == "3", "the step address opens step 3", page, budget_ms=SETTLE_MS)
        assert_settled(page, 3)
        scroll(page, settled_y(page, 4))
        wait_path(page, lambda p: p.endswith("?step=4"), "address replaced with ?step=4")
        click(role(page, "button", "Next step"))
        advance(page, SETTLE_MS)
        wait_path(page, lambda p: p.endswith("?step=5"), "address ?step=5 after Next step")
        page.go_back()
        poll(lambda: hook(page, "step") == "4", "Back returns to step 4", page)
        page.reload()
        poll(lambda: hook(page, "step") == "4", "reload keeps step 4", page)
        click(role(page, "button", "Ask the author"))
        wait_path(page, lambda p: p.startswith("/signin"), "signed-out Ask goes to sign-in")
        sign_in_form(page, world["reader"])
        wait_path(page, lambda p: p == f"/g/{public['slug']}?step=4", "sign-in returns to the step")
        poll(lambda: hook(page, "step") == "4", "step 4 after sign-in", page)
        role(page, "button", "Ask the author").focus()
        press(page, "Enter")
        fill(role(page, "textbox", "Your question"), "Which way do the burrs click?")
        click(role(page, "button", "Send question"))
        see(page, status(page, "Guide status"), "Question sent.")
        response = other.goto(f"{app_url}/g/{private['slug']}")
        assert response and response.status == 404
    questions = httpx.get(f"{app_url}/api/guides/{public['id']}/questions", timeout=HTTP_TIMEOUT).json()["items"]
    assert any(q["text"] == BURR_QUESTION and q["step"] == 4 for q in questions)


def test_wf_deep_link_each_viewport(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    public = world["guides"]["public"]
    for viewport in VIEWPORTS.values():
        with opened(browser, f"{app_url}/g/{public['slug']}?step=4", viewport=viewport) as page:
            advance(page, SETTLE_MS)
            poll(lambda: hook(page, "step") == "4", "step 4 from the address", page, budget_ms=SETTLE_MS)
            assert_settled(page, 4)
            assert abs(page.evaluate("() => window.scrollY") - settled_y(page, 4)) <= 2
            layout(page)
            box = stage(page).bounding_box()
            heading = role(page, "heading", PUBLIC_STEPS[3][1]).bounding_box()
            assert box and heading
            if viewport["width"] == DESKTOP["width"]:
                assert heading["x"] < box["x"], "Desktop steps column is not left of the stage"
            else:
                assert heading["y"] >= box["y"] + box["height"] - 2, "The step panel is not below the stage"
            page.reload()
            poll(lambda: hook(page, "step") == "4", "reload keeps the step", page)


def test_wf_deep_link_published_surface(browser: Any, app_url: str) -> None:
    api = Api(app_url)
    has(api.get(UNKNOWN_API), 404, error="not_found")
    wrong = api.send("DELETE", "/api/health")
    has(wrong, 405, error="method_not_allowed")
    assert wrong.headers.get("Allow"), "405 carries no Allow header"
    has(api.send("POST", "/api/session", content="plain", headers={"Content-Type": "text/plain"}), 415, error="unsupported_media_type")
    deep = "[" * (JSON_MAX_DEPTH + 1) + "]" * (JSON_MAX_DEPTH + 1)
    has(api.send("POST", "/api/session", content=deep, headers={"Content-Type": "application/json"}), 422, error="too_deep")
    frame = '{"email":"","password":""}'
    exact = '{"pad":"' + "x" * (BODY_LIMIT - len('{"pad":""}')) + '"}'
    assert api.send("POST", "/api/session", content=exact, headers={"Content-Type": "application/json"}).status_code != 413
    over = '{"pad":"' + "x" * (BODY_LIMIT + 1 - len('{"pad":""}')) + '"}'
    has(api.send("POST", "/api/session", content=over, headers={"Content-Type": "application/json"}), 413, error="body_too_large", limit=BODY_LIMIT)
    assert frame
    for probe in ("/.env", "/package.json", "/run.json", "/src/server.ts", "/api/debug", "/models/", "/models", "/minio/"):
        assert api.get(probe).status_code == 404, f"{probe} is served; only published routes may answer"
    with opened(browser, f"{app_url}/no-such-page") as page:
        response = page.goto(f"{app_url}/no-such-page")
        assert response and response.status == 404
        see(page, page.get_by_text(NOT_FOUND_COPY, exact=True), NOT_FOUND_COPY)


def test_step_address_opens_settled(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=4") as page:
        for _ in range(2):
            poll(lambda: stage(page).count() > 0 and figure(page, "total-cost").count() > 0, "stage and figures on a step address")
            advance(page, SETTLE_MS)
            poll(lambda: hook(page, "step") == "4", "data-step from the address")
            assert_settled(page, 4)
            see(page, figure(page, "parts-cost"), "€18.90", budget_ms=0)
            see(page, figure(page, "total-cost"), PUBLIC_TOTAL, budget_ms=0)
            see(page, figure(page, "part-count"), "9", budget_ms=0)
            see(page, figure(page, "step-count"), "5", budget_ms=0)
            see(page, status(page, "Reading progress"), progress_copy(4), budget_ms=0)
            page.reload()


def test_address_follows_reading(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    slug = world["guides"]["public"]["slug"]
    with opened(browser, f"{app_url}/g/{slug}") as page:
        wait_state(page)
        mark_page(page)
        entries = page.evaluate("() => history.length")
        for n in (2, 3):
            scroll(page, settled_y(page, n))
            wait_path(page, lambda p, n=n: p == f"/g/{slug}?step={n}", f"address ?step={n} on scroll")
        assert page.evaluate("() => history.length") == entries, "Scrolling added a history entry"
        click(role(page, "button", "Next step"))
        advance(page, SETTLE_MS)
        wait_path(page, lambda p: p == f"/g/{slug}?step=4", "Next step address")
        assert page.evaluate("() => history.length") == entries + 1, "Next step added no history entry"
        click(role(page, "link", f"Step 5: {PUBLIC_STEPS[4][1]}"))
        advance(page, SETTLE_MS)
        wait_path(page, lambda p: p == f"/g/{slug}?step=5", "step link address")
        assert page.evaluate("() => history.length") == entries + 2
        page.go_back()
        poll(lambda: hook(page, "step") == "4", "Back returns to step 4", page)
        assert path_and_query(page) == f"/g/{slug}?step=4"
        assert_no_reload(page)
        click(role(page, "button", "Previous step"))
        advance(page, SETTLE_MS)
        wait_path(page, lambda p: p == f"/g/{slug}?step=3", "Previous step address")
        poll(lambda: hook(page, "step") == "3", "Previous step sets step 3", page)
        assert_no_reload(page)


def test_step_past_the_end(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step={HUGE_INDEX}") as page:
        notice = "This guide has 5 steps. Showing step 5."
        see(page, page.get_by_text(notice, exact=True), notice)
        poll(lambda: hook(page, "step") == "5", "the last step opens", page, budget_ms=SETTLE_MS)
        assert_settled(page, 5)


def test_sign_in_returns_to_step(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    path = f"/g/{world['guides']['public']['slug']}?step=3"
    with opened(browser, f"{app_url}{path}") as page:
        poll(lambda: role(page, "button", "Ask the author").count() > 0, "Ask the author", page)
        click(role(page, "button", "Ask the author"))
        wait_path(page, lambda p: p.startswith("/signin"), "sign-in page")
        assert parse_qs(urlsplit(page.url).query)["next"] == [path]
        sign_in_form(page, world["reader"])
        wait_path(page, lambda p: p == path, "return to the exact path")
        poll(lambda: hook(page, "step") == "3", "return to step 3", page)
        assert page.request.get(f"{app_url}/api/session").status == 200


NON_LOCAL_NEXT = {
    "absolute": "https://example.test/x",
    "double_slash": "//example.test/x",
    "slash_backslash": "/\\example.test/x",
    "backslash_pair": "\\\\example.test/x",
    "scheme": "javascript:alert(1)",
}


@pytest.mark.parametrize("target", list(NON_LOCAL_NEXT.values()), ids=list(NON_LOCAL_NEXT))
def test_non_local_return_lands_on_dashboard(browser: Any, app_url: str, target: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/signin?next={quote(target, safe='')}") as page:
        poll(lambda: page.get_by_label("Email", exact=True).count() > 0, "sign-in form", page)
        sign_in_form(page, world["reader"])
        wait_path(page, lambda p: p == "/dashboard", "the dashboard after a non-local return")
        assert same_origin(page.url, app_url)


def test_private_guide_hidden(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["private"]
    owner = Api(app_url, world["author"])
    reading = owner.get(f"/api/guides/{guide['id']}")
    assert reading.status_code == 200 and reading.json()["title"] == guide["title"]
    model = reading.json()["model_id"]
    assert owner.get(f"/api/models/{model}.glb").status_code == 200
    assert owner.get(f"/g/{guide['slug']}").status_code == 200
    assert owner.get(f"/embed/{guide['slug']}").status_code == 404, "The embed must answer 404 even to the owner of a private guide"
    for api in (Api(app_url), Api(app_url, world["reader"])):
        for path in (f"/g/{guide['slug']}", f"/embed/{guide['slug']}"):
            assert api.get(path).status_code == 404, f"{path} is reachable"
        for path in (f"/api/guides/{guide['id']}", f"/api/guides/{guide['id']}/versions", f"/api/guides/{guide['id']}/versions/1", f"/api/guides/{guide['id']}/questions", f"/api/models/{model}.glb"):
            has(api.get(path), 404, error="not_found")
        has(api.post(f"/api/guides/{guide['id']}/forks"), 404, error="not_found")
        found = api.get("/api/search", params={"q": guide["title"]}).json()
        assert all(item["id"] != guide["id"] for item in found["items"]), "A private guide appeared in search"
    for account in (None, world["reader"]):
        with opened(browser, f"{app_url}/g/{guide['slug']}", account=account) as page:
            see(page, page.get_by_text(NOT_FOUND_COPY, exact=True), NOT_FOUND_COPY)
            assert guide["title"] not in page.content()


def test_wf_reduced_motion_buttons(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reading = httpx.get(f"{app_url}/api/guides/{guide['id']}", timeout=HTTP_TIMEOUT).json()
    with opened(browser, f"{app_url}/g/{guide['slug']}", reduced_motion="reduce") as page:
        wait_state(page)
        for n in range(2, 6):
            click(role(page, "button", "Next step"))
            advance(page, SETTLE_MS)
            assert_settled(page, n)
            see(page, figure(page, "parts-cost"), reading["steps"][n - 1]["parts_cost_text"], budget_ms=0)
            see(page, status(page, "Reading progress"), progress_copy(n))
        expect(role(page, "button", "Next step")).to_have_attribute("aria-disabled", "true")
        for n in range(4, 0, -1):
            click(role(page, "button", "Previous step"))
            advance(page, SETTLE_MS)
            assert_settled(page, n)
            see(page, figure(page, "parts-cost"), PUBLIC_STEPS[n - 1][6], budget_ms=0)
        expect(role(page, "button", "Previous step")).to_have_attribute("aria-disabled", "true")


def test_wf_reduced_motion_stills(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    for n in range(1, 6):
        reply = httpx.get(f"{app_url}/api/guides/{guide['id']}/stills/{n}", timeout=HTTP_TIMEOUT)
        assert reply.status_code == 200 and reply.headers["content-type"].startswith("image/") and reply.content
    with opened(browser, f"{app_url}/g/{guide['slug']}", reduced_motion="reduce", no_webgl=True) as page:
        wait_state(page, "still")
        for n in range(1, 6):
            expect(role(page, "img", f"{guide['title']}, step {n} still")).to_be_visible()
            see(page, figure(page, "parts-cost"), PUBLIC_STEPS[n - 1][6], budget_ms=0)
            see(page, status(page, "Reading progress"), progress_copy(n))
            if n < 5:
                click(role(page, "button", "Next step"))
                advance(page, SETTLE_MS)


def test_step_buttons_replace_scrolling(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}", reduced_motion="reduce") as page:
        wait_state(page)
        click(role(page, "button", "Next step"))
        advance(page, SETTLE_MS)
        assert hook(page, "step") == "2"
        expect(page.get_by_text(PUBLIC_STEPS[1][7], exact=True)).to_be_visible()
        see(page, status(page, "Reading progress"), progress_copy(2))
        height = page.viewport_size["height"]
        for y in (0, 4 * height, 6 * height):
            scroll(page, y)
            assert hook(page, "step") == "2", f"Scrolling to {y} changed the step under reduced motion"
            see(page, status(page, "Reading progress"), progress_copy(2), budget_ms=0)
        click(role(page, "button", "Previous step"))
        advance(page, SETTLE_MS)
        assert hook(page, "step") == "1"
        expect(page.get_by_text(PUBLIC_STEPS[0][7], exact=True)).to_be_visible()


def test_pose_snaps_without_animation(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=3", reduced_motion="reduce") as page:
        wait_state(page)
        advance(page, SETTLE_MS)
        before = camera(page)
        click(role(page, "button", "Next step"))
        advance(page, SETTLE_MS)
        assert_settled(page, 4)
        assert animations(stage(page)) == [], "Animations run on the stage under reduced motion"
        assert animations(figure(page, "parts-cost")) == [], "Animations run on the figure under reduced motion"
        first = camera(page)
        assert first != before, "The drawn camera did not change for the new pose"
        advance(page, COUNT_MS)
        assert camera(page) == first, "Camera matrices moved after the first drawn frame"


def test_figures_final_at_once(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}", reduced_motion="reduce") as page:
        poll(lambda: figure(page, "total-cost").count() > 0, "reader figures")
        see(page, figure(page, "total-cost"), PUBLIC_TOTAL, budget_ms=0)
        see(page, figure(page, "part-count"), "9", budget_ms=0)
        see(page, figure(page, "step-count"), "5", budget_ms=0)
        see(page, figure(page, "parts-cost"), "€0.00", budget_ms=0)
        for _ in range(2):
            click(role(page, "button", "Next step"))
        advance(page, SETTLE_MS)
        click(role(page, "button", "Next step"))
        seen = []
        for _ in range(4):
            advance(page, FRAME_MS)
            seen.append(figure(page, "parts-cost").text_content())
        assert set(seen) <= {"€0.00", "€18.90"}, f"A value between old and new appeared: {seen}"
        assert seen[-1] == "€18.90"


def test_still_fallback_without_webgl(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    with opened(browser, f"{app_url}/g/{guide['slug']}", no_webgl=True) as page:
        wait_state(page, "still")
        image = role(page, "img", f"{guide['title']}, step 1 still")
        expect(image).to_be_visible()
        poll(lambda: decode(capture(image)).variance() > 0, "the still shows a drawn image", page)
        see(page, status(page, "Stage status"), STILL_COPY)
        expect(page.get_by_text(PUBLIC_STEPS[0][7], exact=True)).to_be_visible()
        assert gl_counters(page)["draws"] == 0


def test_still_follows_step_buttons(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    with opened(browser, f"{app_url}/g/{guide['slug']}?step=3", no_webgl=True) as page:
        wait_state(page, "still")
        first = role(page, "img", f"{guide['title']}, step 3 still")
        poll(lambda: decode(capture(first)).variance() > 0, "still of step 3", page)
        before = decode(capture(first))
        click(role(page, "button", "Next step"))
        advance(page, SETTLE_MS)
        following = role(page, "img", f"{guide['title']}, step 4 still")
        expect(following).to_be_visible()
        expect(first).to_have_count(0)
        expect(page.get_by_text(PUBLIC_STEPS[3][7], exact=True)).to_be_visible()
        poll(lambda: difference(before, decode(capture(following))) > 0, "the still's pixels change with the step", page)


def test_reduced_motion_controls_fit_thumb(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2", viewport=PHONE, reduced_motion="reduce") as page:
        wait_state(page)
        for name in ("Previous step", "Next step"):
            box = role(page, "button", name).bounding_box()
            assert box and box["width"] >= TARGET_PX - 0.5 and box["height"] >= TARGET_PX - 0.5, f"{name} is {box}"
        layout(page)
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")


def test_wf_phone_reader(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2", viewport=PHONE, touch=True) as page:
        wait_state(page)
        switch = role(page, "switch", "Free look")
        expect(switch).to_have_attribute("aria-checked", "false")
        expect(role(page, "list", "Parts")).to_contain_text("Upper burr")
        start = page.evaluate("() => window.scrollY")
        drag(page, stage_center(page), (0, -SCROLL_DRAG_PX))
        poll(lambda: page.evaluate("() => window.scrollY") > start, "a vertical drag scrolls the page", page, budget_ms=SETTLE_MS)
        scroll_rest(page)
        tap(switch)
        advance(page, SETTLE_MS)
        expect(switch).to_have_attribute("aria-checked", "true")
        yaw = hook(page, "yaw")
        drag(page, stage_center(page), (ORBIT_PX, 0))
        poll(lambda: hook(page, "yaw") != yaw, "free look orbits the stage", page, budget_ms=SETTLE_MS)


def test_wf_phone_author(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, viewport=PHONE, account=world["author"], live=True, touch=True) as phone, opened(browser, url, account=world["author"], live=True) as desk:
        ready_editor(desk)
        poll(lambda: role(phone, "tab", "Steps").count() > 0, "Editor panes tabs", phone)
        tap(role(phone, "tab", "Steps"))
        advance(phone, SETTLE_MS)
        commit_ui(phone, role(phone, "textbox", "Step 3 text"), "Corrected from the phone.")
        wait_field(api, guide["id"], 3, "text", "Corrected from the phone.", phone)
        tap(role(phone, "button", "Save version"))
        advance(phone, SETTLE_MS)
        see(phone, status(phone, "Editor status"), "Saved as version 2.")
        see_live(status(desk, "Latest version"), "Latest version 2")
    assert version(api, guide["id"], 2)["steps"][2]["text"] == PHONE_FIX_TEXT


def test_editor_panes_on_phone(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/edit/{world['guides']['draft']['slug']}", viewport=PHONE, account=world["author"], touch=True) as page:
        tablist = role(page, "tablist", "Editor panes")
        poll(lambda: tablist.count() > 0, "Editor panes tablist", page)
        wait_live(page)
        probes = {"Stage": ("slider", "Apart amount"), "Steps": ("textbox", "Step 1 text"), "Parts": ("tree", "Model parts")}

        def shows(name: str) -> None:
            expect(role(tablist, "tab", name)).to_have_attribute("aria-selected", "true")
            for pane, (kind, label) in probes.items():
                expect(role(page, kind, label)).to_have_count(1 if pane == name else 0)

        tap(role(tablist, "tab", "Stage"))
        advance(page, SETTLE_MS)
        shows("Stage")
        tap(role(tablist, "tab", "Steps"))
        advance(page, SETTLE_MS)
        shows("Steps")
        tap(role(tablist, "tab", "Parts"))
        advance(page, SETTLE_MS)
        shows("Parts")
        role(tablist, "tab", "Parts").focus()
        press(page, "ArrowLeft")
        shows("Steps")
        press(page, "ArrowLeft")
        shows("Stage")
        names = [squeeze(n) for n in tab_order(page, 25)]
        for hidden in ("Step 1 text", "Step 1 title", "Guide title", "Unit price"):
            assert hidden not in names, f"Hidden pane control {hidden} is in the Tab order"
        role(tablist, "tab", "Stage").focus()
        press(page, "ArrowRight")
        shows("Steps")


def test_parts_list_replaces_callouts(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=3", viewport=PHONE, reduced_motion="reduce") as page:
        wait_state(page)
        parts = role(page, "list", "Parts")
        expect(parts).to_contain_text("Lower burr")
        expect(parts).to_contain_text("Drive shaft")
        expect(parts.get_by_role("listitem")).to_have_count(2)
        numbered = parts.evaluate("el => el.tagName === 'OL' || /\\d/.test(el.innerText)")
        assert numbered, "The Parts list is not numbered"
        box, area = stage(page).bounding_box(), parts.bounding_box()
        assert box and area and area["y"] >= box["y"] + box["height"] - 2
        assert len(callouts_of(page)) == 0
        click(role(page, "button", "Previous step"))
        advance(page, SETTLE_MS)
        expect(parts).to_contain_text("Upper burr")
        expect(parts).not_to_contain_text("Drive shaft")


def test_vertical_drag_scrolls_page(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2", viewport=PHONE, touch=True) as page:
        wait_state(page)
        start = page.evaluate("() => window.scrollY")
        yaw, pitch = hook(page, "yaw"), hook(page, "pitch")
        drag(page, stage_center(page), (0, -SCROLL_DRAG_PX))
        poll(lambda: page.evaluate("() => window.scrollY") > start + 50, "a one-finger drag scrolled the page", page, budget_ms=SETTLE_MS)
        advance(page, SETTLE_MS)
        assert (hook(page, "yaw"), hook(page, "pitch")) == (yaw, pitch), "The drag orbited the stage with Free look off"


def test_free_look_orbits_and_pinches(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2", viewport=PHONE, touch=True) as page:
        wait_state(page)
        tap(role(page, "switch", "Free look"))
        advance(page, SETTLE_MS)
        start = page.evaluate("() => window.scrollY")
        yaw, pitch = int(hook(page, "yaw") or 0), int(hook(page, "pitch") or 0)
        center_point = stage_center(page)
        drag(page, center_point, (ORBIT_PX, 0))
        poll(lambda: int(hook(page, "yaw") or 0) != yaw, "drag changes yaw", page, budget_ms=SETTLE_MS)
        assert abs(abs(int(hook(page, "yaw") or 0) - yaw) - ORBIT_PX / 2) <= 4, f"yaw {yaw} -> {hook(page, 'yaw')}"
        drag(page, center_point, (0, -ORBIT_PX))
        poll(lambda: int(hook(page, "pitch") or 0) != pitch, "drag changes pitch", page, budget_ms=SETTLE_MS)
        assert page.evaluate("() => window.scrollY") == start, "A free-look drag scrolled the page"
        x, y = center_point
        touch(page, "touchStart", [(x - PINCH_START_PX, y), (x + PINCH_START_PX, y)])
        for i in range(1, TOUCH_STEPS + 1):
            half = PINCH_START_PX + (PINCH_END_PX - PINCH_START_PX) * i / TOUCH_STEPS
            touch(page, "touchMove", [(x - half, y), (x + half, y)])
        touch(page, "touchEnd", [])
        advance(page, SETTLE_MS)
        expected = PINCH_END_PX / PINCH_START_PX
        poll(lambda: abs(float(hook(page, "zoom") or 0) - expected) <= 0.25, "pinch multiplies data-zoom by the finger ratio", page, budget_ms=SETTLE_MS)


def test_phone_edit_reaches_desktop(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, viewport=PHONE, account=world["author"], live=True, touch=True) as phone, opened(browser, url, account=world["author"], live=True) as desk:
        ready_editor(desk)
        mark_page(desk)
        tap(role(phone, "tab", "Steps"))
        advance(phone, SETTLE_MS)
        commit_ui(phone, role(phone, "textbox", "Step 2 text"), "Live from the phone.")
        desk_field = role(desk, "textbox", "Step 2 text")
        poll(lambda: desk_field.input_value() == "Live from the phone.", "the phone edit in the desktop field within the live delay", seconds=LIVE_WAIT)
        assert_no_reload(desk)


@pytest.mark.parametrize("viewport", list(SMALL_VIEWPORTS.values()), ids=list(SMALL_VIEWPORTS))
def test_phone_and_tablet_geometry(browser: Any, app_url: str, viewport: dict[str, int]) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/g/{world['guides']['public']['slug']}?step=2", viewport=viewport) as page:
        wait_state(page)
        layout(page)
        assert undersized(page) == [], f"Reader controls under 44 px: {undersized(page)}"
    with opened(browser, f"{app_url}/edit/{world['guides']['draft']['slug']}", viewport=viewport, account=world["author"]) as page:
        poll(lambda: stage(page).count() > 0, "editor stage", page)
        wait_live(page)
        expect(role(page, "separator", "Resize stage and steps")).to_have_count(0)
        if viewport["width"] == PHONE["width"]:
            for name in ("Stage", "Steps", "Parts"):
                role(page, "tab", name).click()
                advance(page, SETTLE_MS)
                layout(page)
                assert undersized(page) == [], f"Editor {name} controls under 44 px: {undersized(page)}"
        else:
            expect(role(page, "tablist", "Editor panes")).to_have_count(0)
            poll(lambda: role(page, "textbox", "Step 1 title").count() > 0, "step rows", page)
            box, title = stage(page).bounding_box(), role(page, "textbox", "Step 1 title").bounding_box()
            assert box and title and title["y"] >= box["y"] + box["height"] - 2, "Tablet stage is not stacked above the steps"
            layout(page)
            assert undersized(page) == [], f"Editor controls under 44 px: {undersized(page)}"


def test_wf_model_upload_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    data = sample(app_url)
    api = Api(app_url, world["author"])
    guide = new_guide(api)
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        see(page, status(page, "Stage status"), "No model yet. Drop a .glb on the stage or use Choose a model file.")
        ready_editor(page, "Guide title")
        drop_file(page, BIKE_HUB, data)
        see(page, status(page, "Stage status"), f"Previewing {BIKE_HUB}. It is not uploaded.")
        choose_file(page, "Enter", BIKE_HUB, data)
        see(page, status(page, "Stage status"), f"Previewing {BIKE_HUB}. It is not uploaded.")
        role(page, "button", "Upload model").focus()
        press(page, "Enter")
        see(page, status(page, "Stage status"), f"{BIKE_HUB} is stored. {len(data):,} bytes confirmed.")
    model = poll(lambda: api.working(guide["id"])["model"], "stored model in the working copy")
    assert model["state"] == "stored" and model["bytes"] == len(data) and model["sha256"] == hashlib.sha256(data).hexdigest()
    assert S3().get(f"models/{model['id']}.glb") == data


def test_wf_model_upload_refusals(browser: Any) -> None:
    base = short_limits_url()
    world = make_world(base)
    api = Api(base, world["author"])
    guide = new_guide(api)
    with opened(browser, f"{base}/edit/{guide['slug']}", account=world["author"]) as page:
        poll(lambda: stage(page).count() > 0, "editor stage", page)
        ready_editor(page, "Guide title")
        drop_file(page, "notes.glb", b"plain text, renamed")
        see(page, status(page, "Stage status"), "notes.glb is not a glTF 2.0 binary file.")
        expect(role(page, "button", "Upload model")).to_have_attribute("aria-disabled", "true")
        valid = make_glb(["Cap", "Spring"])
        drop_file(page, "valid.glb", valid)
        see(page, status(page, "Stage status"), "Previewing valid.glb. It is not uploaded.")
        click(role(page, "button", "Upload model"))
        see(page, status(page, "Stage status"), f"valid.glb is stored. {len(valid)} bytes confirmed.")
    model = poll(lambda: api.working(guide["id"])["model"], "stored model on short-limits")
    assert S3("-short").get(f"models/{model['id']}.glb") == valid


def test_wf_model_upload_outage(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    base = storage_down_url()
    api = Api(app_url, world["author"])
    guide = new_guide(api)
    with opened(browser, f"{base}/edit/{guide['slug']}", account=world["author"]) as page:
        poll(lambda: stage(page).count() > 0, "editor stage", page)
        ready_editor(page, "Guide title")
        drop_file(page, BIKE_HUB, sample(app_url))
        see(page, status(page, "Stage status"), f"Previewing {BIKE_HUB}. It is not uploaded.")
        click(role(page, "button", "Upload model"))
        see(page, status(page, "Stage status"), AUTHOR_OUTAGE)
    assert api.working(guide["id"])["model"] is None, "A failed upload left a model row"


def test_drop_preview_stays_in_browser(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    api = Api(app_url, world["author"])
    guide = new_guide(api)
    data = sample(app_url)
    requests: list[str] = []
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], requests=requests) as page:
        see(page, status(page, "Stage status"), "No model yet. Drop a .glb on the stage or use Choose a model file.")
        ready_editor(page, "Guide title")
        before = gl_counters(page)
        requests.clear()
        drop_file(page, BIKE_HUB, data)
        see(page, status(page, "Stage status"), f"Previewing {BIKE_HUB}. It is not uploaded.")
        wait_state(page, "preview")
        poll(lambda: gl_counters(page)["draws"] > before["draws"], "preview draw calls rise", page)
        assert gl_counters(page)["bytes"] > before["bytes"], "No vertex bytes were uploaded for the preview"
        sent = [u for u in requests if not u.startswith(("data:", "blob:"))]
        assert sent == [], f"A preview sent requests: {sent}"
    assert api.working(guide["id"])["model"] is None


def test_choose_file_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    api = Api(app_url, world["author"])
    guide = new_guide(api)
    data = sample(app_url)
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        poll(lambda: role(page, "button", "Choose a model file").count() > 0, "toolbar", page)
        ready_editor(page, "Guide title")
        upload = role(page, "button", "Upload model")
        expect(upload).to_have_attribute("aria-disabled", "true")
        role(page, "button", "Choose a model file").focus()
        with page.expect_file_chooser(timeout=POLL_SECONDS * 1000):
            page.keyboard.press("Enter")
        choose_file(page, "Space", BIKE_HUB, data)
        see(page, status(page, "Stage status"), f"Previewing {BIKE_HUB}. It is not uploaded.")
        wait_state(page, "preview")
        expect(upload).not_to_have_attribute("aria-disabled", "true")
        upload.focus()
        with held(page, "**/api/guides/*/model") as gate:
            page.keyboard.press("Enter")
            see(page, status(page, "Stage status"), f"Uploading {BIKE_HUB}: 0%.", budget_ms=0)
            assert api.working(guide["id"])["model"] is None, "Stored before the request reached the server"
            advance(page, SETTLE_MS)
            copy = squeeze(status(page, "Stage status").text_content())
            assert re.fullmatch(rf"Uploading {re.escape(BIKE_HUB)}: \d+%\.", copy), f"Stage status during upload: {copy!r}"
            release_held(gate)
        see(page, status(page, "Stage status"), f"{BIKE_HUB} is stored. {len(data):,} bytes confirmed.")


def test_stored_only_after_minio_confirms(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    data = make_glb(["Hub shell", "Axle", "Spare axle"])
    before_parts = {p["id"]: p for p in api.working(guide["id"])["parts"]}
    keys_before = set(S3().keys("models/"))
    reply = api.upload(guide["id"], data, "../../escape.glb")
    assert reply.status_code == 201, f"Upload answered {reply.status_code}: {reply.text[:300]}"
    body = reply.json()
    model = body["model"]
    assert model["state"] == "stored" and model["bytes"] == len(data) and model["sha256"] == hashlib.sha256(data).hexdigest()
    assert len(model["bbox_mm"]) == 3 and model["scale_confirmed"] is False
    key = f"models/{model['id']}.glb"
    assert S3().get(key) == data
    assert set(S3().keys("models/")) - keys_before == {key}
    assert all(ESCAPE_WORD not in k for k in S3().keys("models/"))
    served = api.get(f"/api/models/{model['id']}.glb")
    assert served.status_code == 200 and served.content == data and served.headers["content-type"].startswith("model/gltf-binary")
    work = api.working(guide["id"])
    parts = {p["id"]: p for p in work["parts"]}
    assert set(before_parts) <= set(parts), "A replacement lost a part"
    assert sorted(body["unbound"]) == sorted(p["name"] for p in parts.values() if p["unbound"])
    assert {"Left cone", "Right cone", "Locknut"} <= set(body["unbound"])
    assert not any(p["unbound"] for p in parts.values() if p["name"] in ("Hub shell", "Axle"))
    assert any(p["name"] == SPARE_PART and p["node_path"] == f"{SPARE_PART}[0]" for p in parts.values()), "A node with no part did not become a part"
    latest = work["latest_version"]
    has(api.post(f"/api/guides/{guide['id']}/versions", {"base_version": latest}), 201)
    refused = api.post(f"/api/guides/{guide['id']}/publish")
    has(refused, 422, error="unbound_parts")
    assert "Left cone" in refused.json()["parts"]
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        unbound = role(page, "list", "Unbound parts")
        expect(unbound).to_contain_text("Left cone")


def test_upload_refusals_name_the_reason(browser: Any) -> None:
    base = short_limits_url()
    world = make_world(base)
    api = Api(base, world["author"])
    guide = new_guide(api)
    cases = [
        ("notes.glb", b"plain text with a .glb name", "notes.glb is not a glTF 2.0 binary file.", 422, {"error": "not_glb"}),
        ("big.glb", make_glb(["Cap"], size=SHORT_MODEL_BYTES + 1), f"This file is over the limit of {SHORT_MODEL_BYTES:,} bytes.", 413, {"error": "model_too_large", "limit": SHORT_MODEL_BYTES}),
        ("many.glb", make_glb([f"Part {i}" for i in range(SHORT_MODEL_PARTS + 1)]), f"many.glb has {SHORT_MODEL_PARTS + 1} parts. The limit is {SHORT_MODEL_PARTS} parts.", 422, {"error": "too_many_parts", "count": SHORT_MODEL_PARTS + 1, "limit": SHORT_MODEL_PARTS}),
        ("outside.glb", make_glb(["Cap"], uri="https://example.test/buffer.bin"), "outside.glb refers to outside files, so it cannot be used.", 422, {"error": "external_uri"}),
    ]
    store = S3("-short")
    keys = set(store.keys("models/"))
    with opened(browser, f"{base}/edit/{guide['slug']}", account=world["author"]) as page:
        poll(lambda: stage(page).count() > 0, "editor stage", page)
        ready_editor(page, "Guide title")
        for name, data, copy, code, fields in cases:
            drop_file(page, name, data)
            see(page, status(page, "Stage status"), copy)
            expect(role(page, "button", "Upload model")).to_have_attribute("aria-disabled", "true")
            has(api.upload(guide["id"], data, name), code, **fields)
        assert set(store.keys("models/")) == keys, "A refused upload stored an object"
        assert api.working(guide["id"])["model"] is None, "A refused upload left a model row"
        exact_bytes = make_glb(["Cap"], size=SHORT_MODEL_BYTES)
        assert len(exact_bytes) == SHORT_MODEL_BYTES
        drop_file(page, "exact.glb", exact_bytes)
        see(page, status(page, "Stage status"), "Previewing exact.glb. It is not uploaded.")
        click(role(page, "button", "Upload model"))
        see(page, status(page, "Stage status"), f"exact.glb is stored. {SHORT_MODEL_BYTES:,} bytes confirmed.")
    exact_parts = make_glb([f"Part {i}" for i in range(SHORT_MODEL_PARTS)])
    reply = api.upload(guide["id"], exact_parts, "twelve.glb")
    assert reply.status_code == 201, f"A model at exactly the part limit answered {reply.status_code}"
    assert store.get(f"models/{reply.json()['model']['id']}.glb") == exact_parts


def test_pathological_glb_refused_in_time(app_url: str) -> None:
    world = make_world(app_url)
    api = Api(app_url, world["author"])
    guide = new_guide(api)
    bad_length = bytearray(make_glb(["Cap"]))
    bad_length[8] += 4
    wrong_version = bytearray(make_glb(["Cap"]))
    wrong_version[4] = 1
    bin_first = b"glTF" + struct.pack("<II", 2, 12 + 8 + 4) + struct.pack("<II", 4, 0x004E4942) + b"\0\0\0\0"
    for data in (deep_glb(GLB_MAX_DEPTH + 1), wrap_glb(b"{not json", None), bytes(bad_length), bytes(wrong_version), bin_first):
        started = time.monotonic()
        has(api.upload(guide["id"], data, "crafted.glb"), 422, error="not_glb")
        assert time.monotonic() - started < GLB_CHECK_MAX_SECONDS, "Checking one file took too long"
    assert api.working(guide["id"])["model"] is None


def test_storage_outage_for_authors(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    base = storage_down_url()
    api = Api(base, world["author"])
    has(api.upload(guide["id"], sample(app_url)), 503, error="storage_unavailable")
    started = time.monotonic()
    health = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
    assert health.status_code == 200 and health.json() == {"status": "unavailable"}
    assert time.monotonic() - started < HEALTH_MAX_SECONDS + ROUND_TRIP_SLACK
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    has(httpx.post(f"{base}/api/grading/world", json={}, timeout=HTTP_TIMEOUT), 503, error="storage_unavailable")
    has(api.post(f"/api/guides/{guide['id']}/publish"), 503, error="storage_unavailable")
    with opened(browser, f"{base}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        see(page, status(page, "Stage status"), AUTHOR_OUTAGE, budget_ms=2000)
        wait_state(page, "error")
        commit_ui(page, role(page, "textbox", "Step 1 text"), "Saved during the outage.")
        wait_field(api, guide["id"], 1, "text", "Saved during the outage.", page)
        role(page, "textbox", "Step 1 text").focus()
        page.keyboard.press("Control+s")
        see(page, status(page, "Editor status"), "Saved as version 2.")
        click(role(page, "button", "Publish"))
        see(page, status(page, "Editor status"), "Storage unreachable. Publishing waits until it returns.")
    primary = Api(app_url, world["author"])
    assert primary.working(guide["id"])["state"] == "draft"
    assert version(primary, guide["id"], 2)["steps"][0]["text"] == OUTAGE_TEXT


def test_storage_outage_for_readers(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    base = storage_down_url()
    with opened(browser, f"{base}/g/{guide['slug']}?step=4", viewport=PHONE) as page:
        see(page, status(page, "Stage status"), READER_OUTAGE, budget_ms=2000)
        wait_state(page, "error")
        expect(page.get_by_text(PUBLIC_STEPS[3][7], exact=True)).to_be_visible()
        expect(role(page, "list", "Parts")).to_contain_text("Lower burr")
        see(page, figure(page, "parts-cost"), "€18.90")
        assert httpx.get(f"{base}/api/guides/{guide['id']}", timeout=HTTP_TIMEOUT).json()["total_cost_text"] == PUBLIC_TOTAL
        model = httpx.get(f"{base}/api/guides/{guide['id']}", timeout=HTTP_TIMEOUT).json()["model_id"]
        has(httpx.get(f"{base}/api/models/{model}.glb", timeout=HTTP_TIMEOUT), 503, error="storage_unavailable")
        advance(page, NOTICE_MS)
        see(page, status(page, "Stage status"), READER_OUTAGE, budget_ms=0)


def open_versions(page: Page) -> Locator:
    button = role(page, "button", "Versions")
    button.focus()
    press(page, "Enter")
    expect(button).to_have_attribute("aria-expanded", "true")
    region = role(page, "region", "Versions")
    expect(region).to_be_visible()
    return region


def compare_by_keyboard(page: Page, region: Locator, older: int, newer: int) -> Locator:
    for number in (newer, older):
        box = role(region, "checkbox", f"Version {number}")
        poll(lambda n=number: role(region, "checkbox", f"Version {n}").count() > 0, f"Version {number} checkbox", page)
        box.focus()
        press(page, "Space")
        expect(box).to_be_checked()
    button = role(region, "button", "Compare")
    expect(button).not_to_have_attribute("aria-disabled", "true")
    button.focus()
    press(page, "Enter")
    compare = role(page, "region", "Version compare")
    expect(compare).to_be_visible()
    return compare


def test_wf_versions_restore_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    api = Api(app_url, world["author"])
    before = {n: version(api, guide["id"], n) for n in (1, 2, 3)}
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as page:
        ready_editor(page)
        other = second_tab(page, url)
        ready_editor(other)
        page.bring_to_front()
        region = open_versions(page)
        compare = compare_by_keyboard(page, region, 1, 3)
        expect(compare).to_contain_text("Parts cost difference +€4.90")
        restore = role(region, "button", "Restore version 1")
        restore.focus()
        press(page, "Enter")
        press(page, "Enter")
        see(page, status(page, "Editor status"), "Restored version 1 as version 4.")
        see_live(status(other, "Latest version"), "Latest version 4")
        advance(page, NOTICE_MS)
        see(page, status(page, "Editor status"), "", budget_ms=SETTLE_MS)
        expect(compare).to_be_visible()
        expect(compare).to_contain_text("Parts cost difference +€4.90")
    items = versions(api, guide["id"])
    assert items[0]["number"] == 4 and items[0]["restored_from"] == 1
    assert version(api, guide["id"], 4)["steps"] == before[1]["steps"]
    assert api.working(guide["id"])["steps"] == before[1]["steps"]


def test_wf_versions_cancel_keeps_history(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    api = Api(app_url, world["author"])
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        ready_editor(page)
        region = open_versions(page)
        restore = role(region, "button", "Restore version 2")
        restore.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Restore version 2")
        role(dialog, "button", "Cancel").focus()
        press(page, "Enter")
        expect(dialog).to_have_count(0)
        expect(restore).to_be_focused()
        role(region, "checkbox", "Version 1").focus()
        press(page, "Escape")
        expect(role(page, "region", "Versions")).to_have_count(0)
        expect(role(page, "button", "Versions")).to_be_focused()
        expect(role(page, "button", "Versions")).to_have_attribute("aria-expanded", "false")
    assert [v["number"] for v in versions(api, guide["id"])] == [3, 2, 1]


def test_picking_versions_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/edit/{world['guides']['public']['slug']}", account=world["author"]) as page:
        ready_editor(page)
        region = open_versions(page)
        compare_button = role(region, "button", "Compare")
        expect(compare_button).to_have_attribute("aria-disabled", "true")
        boxes = {n: role(region, "checkbox", f"Version {n}") for n in (1, 2, 3)}
        tab_to(page, boxes[3])
        press(page, "Space")
        expect(compare_button).to_have_attribute("aria-disabled", "true")
        tab_to(page, boxes[2])
        press(page, "Space")
        expect(compare_button).not_to_have_attribute("aria-disabled", "true")
        tab_to(page, boxes[1])
        press(page, "Space")
        expect(boxes[3]).not_to_be_checked()
        expect(boxes[2]).to_be_checked()
        expect(boxes[1]).to_be_checked()
        compare_button.focus()
        press(page, "Enter")
        compare = role(page, "region", "Version compare")
        expect(compare).to_contain_text("Parts cost difference +€2.40")


def test_compare_labels_and_cost_difference(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reply = httpx.get(f"{app_url}/api/guides/{guide['id']}/versions/compare", params={"older": 1, "newer": 3}, timeout=HTTP_TIMEOUT)
    assert reply.status_code == 200
    body = reply.json()
    assert body["cost_difference"] == 490 and body["cost_difference_text"] == "+€4.90"
    assert [a["title"] for a in body["added"]] == ["Refit the chute and close up"]
    assert [r["title"] for r in body["removed"]] == ["Unplug and empty the grinder"]
    assert {m["title"] for m in body["moved"]} == {"Free the upper burr", "Draw out the lower burr"}
    assert [c["title"] for c in body["changed"]] == ["Fit the new burr set"]
    assert {"part": "Lower burr", "field": "unit_price", "from": 1640, "to": 1890} in body["part_changes"]
    assert {"part": "Bean chute", "field": "fitted_at", "from": None, "to": "Refit the chute and close up"} in body["part_changes"]
    second = httpx.get(f"{app_url}/api/guides/{guide['id']}/versions/compare", params={"older": 2, "newer": 3}, timeout=HTTP_TIMEOUT).json()
    assert second["cost_difference_text"] == "+€2.50"
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        ready_editor(page)
        compare = compare_by_keyboard(page, open_versions(page), 1, 3)
        words = squeeze(compare.inner_text())
        rows = [
            "Moved Step 2: Free the upper burr",
            "Moved Step 3: Draw out the lower burr",
            "Changed Step 4: Fit the new burr set",
            "Added Step 5: Refit the chute and close up",
            "Removed Was step 1: Unplug and empty the grinder",
        ]
        spots = [words.find(row) for row in rows]
        assert all(s >= 0 for s in spots) and spots == sorted(spots), f"Compare rows out of the published order: {words}"
        for line in ("Removed: by hand.", "Added: until they click.", "Parts cost difference +€4.90", "€16.40", "€18.90"):
            assert line in words, f"Compare lacks {line!r}: {words}"


def test_restore_dialog_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    api = Api(app_url, world["author"])
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        ready_editor(page)
        region = open_versions(page)
        opener = role(region, "button", "Restore version 1")
        opener.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Restore version 1")
        expect(dialog).to_be_visible()
        assert_dialog_wrap(page, dialog, [role(dialog, "button", "Restore"), role(dialog, "button", "Cancel")])
        press(page, "Escape")
        expect(dialog).to_have_count(0)
        expect(opener).to_be_focused()
    assert versions(api, guide["id"])[0]["number"] == 3, "Escape restored a version"


def test_restore_appends_version(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    api = Api(app_url, world["author"])
    before = {n: version(api, guide["id"], n) for n in (1, 2, 3)}
    listing = versions(api, guide["id"])
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"]) as page:
        ready_editor(page)
        region = open_versions(page)
        click(role(region, "button", "Restore version 2"))
        advance(page, SETTLE_MS)
        click(role(role(page, "dialog", "Restore version 2"), "button", "Restore"))
        see(page, status(page, "Editor status"), "Restored version 2 as version 4.")
        see(page, status(page, "Latest version"), "Latest version 4")
    items = versions(api, guide["id"])
    assert items[0]["number"] == 4 and items[0]["restored_from"] == 2 and items[1:] == listing
    for number, snapshot in before.items():
        assert version(api, guide["id"], number) == snapshot, f"Restore rewrote version {number}"
    restored = version(api, guide["id"], 4)
    assert restored["steps"] == before[2]["steps"] and restored["parts"] == before[2]["parts"]
    reading = httpx.get(f"{app_url}/api/guides/{guide['id']}", timeout=HTTP_TIMEOUT).json()
    assert reading["published_version"] == 3, "Restoring changed what is published"


def test_new_version_live_in_second_tab(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as other:
        ready_editor(other)
        region = open_versions(other)
        expect(role(region, "checkbox", "Version 4")).to_have_count(0)
        mark_page(other)
        has(Api(app_url, world["author"]).post(f"/api/guides/{guide['id']}/versions/1/restore"), 201)
        see_live(status(other, "Latest version"), "Latest version 4")
        poll(lambda: role(region, "checkbox", "Version 4").count() == 1, "Version 4 in the Versions region live", seconds=LIVE_WAIT)
        assert_no_reload(other)


def test_compare_outlasts_notices(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    data = sample(app_url)
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        notice = status(page, "Editor status")
        role(page, "button", "Save version").focus()
        press(page, "Control+z")
        see(page, notice, "Nothing to undo.", budget_ms=0)
        advance(page, NOTICE_GAP_MS)
        press(page, "Control+Shift+z")
        see(page, notice, "Nothing to redo.", budget_ms=0)
        advance(page, NOTICE_MS - NOTICE_GAP_MS)
        see(page, notice, "Nothing to redo.", budget_ms=0)
        advance(page, NOTICE_GAP_MS)
        see(page, notice, "", budget_ms=0)
        compare = compare_by_keyboard(page, open_versions(page), 1, 2)
        shown = squeeze(compare.inner_text())
        drop_file(page, BIKE_HUB, data)
        wait_state(page, "preview")
        field = role(page, "textbox", "Step 1 text")
        fill(field, UNSAVED_TEXT)
        role(page, "textbox", "Step 1 title").focus()
        press(page, "Alt+ArrowUp")
        see(page, notice, "Step 1 is already first.")
        advance(page, NOTICE_MS)
        see(page, notice, "", budget_ms=0)
        reader = Api(app_url, world["reader"])
        has(reader.post(f"/api/guides/{guide['id']}/questions", {"step": 1, "text": "Does the hopper twist?"}), 201)
        see_live(status(page, "Question alerts"), f"New question on {guide['title']}, step 1.")
        expect(compare).to_be_visible()
        assert squeeze(compare.inner_text()) == shown, "The compare changed under a notice or question"
        expect(field).to_have_value(UNSAVED_TEXT)
        assert hook(page, "state") == "preview"
        see(page, status(page, "Stage status"), f"Previewing {BIKE_HUB}. It is not uploaded.", budget_ms=0)


def fork_by_keyboard(page: Page) -> None:
    button = role(page, "button", "Fork guide")
    poll(lambda: button.count() > 0, "Fork guide", page)
    button.focus()
    press(page, "Enter")
    dialog = role(page, "dialog", "Fork guide")
    expect(dialog).to_be_visible()
    role(dialog, "button", "Fork version 3").focus()
    press(page, "Enter")


def test_wf_forking_happy(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reader = Api(app_url, world["reader"])
    with opened(browser, f"{app_url}/g/{guide['slug']}", account=world["author"], live=True) as author, opened(browser, f"{app_url}/g/{guide['slug']}", account=world["reader"]) as page:
        see(author, status(author, "Fork count"), "0 forks")
        mark_page(author)
        fork_by_keyboard(page)
        wait_path(page, lambda p: p.startswith("/edit/"), "the fork's editor opens")
        slug = urlsplit(page.url).path.rsplit("/", 1)[1]
        credit = f"Forked from {guide['title']} by {world['author']['name']}, version 3."
        see(page, page.get_by_text(credit, exact=True), credit)
        see_live(status(author, "Fork count"), "1 fork")
        assert_no_reload(author)
        page.goto(f"{app_url}/dashboard")
        page.reload()
        fork_title = f"{guide['title']} (fork)"
        poll(lambda: role(page, "link", fork_title).count() > 0, "the fork on the dashboard after reload", page)
    forks = reader.get("/api/dashboard").json()["forks"]
    assert [f["slug"] for f in forks] == [slug]


def test_wf_forking_signed_out_returns(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    path = f"/g/{guide['slug']}?step=2"
    with opened(browser, f"{app_url}{path}") as page:
        poll(lambda: role(page, "button", "Fork guide").count() > 0, "Fork guide", page)
        click(role(page, "button", "Fork guide"))
        wait_path(page, lambda p: p.startswith("/signin"), "sign-in page")
        assert parse_qs(urlsplit(page.url).query)["next"] == [path]
        assert Api(app_url, world["author"]).get(f"/api/guides/{guide['id']}").json()["fork_count"] == 0
        sign_in_form(page, world["reader"])
        wait_path(page, lambda p: p == path, "return to the step")
        fork_by_keyboard(page)
        wait_path(page, lambda p: p.startswith("/edit/"), "the fork's editor")
    assert Api(app_url).get(f"/api/guides/{guide['id']}").json()["fork_count"] == 1


def test_fork_dialog_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    with opened(browser, f"{app_url}/g/{guide['slug']}", account=world["reader"]) as page:
        button = role(page, "button", "Fork guide")
        poll(lambda: button.count() > 0, "Fork guide", page)
        button.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Fork guide")
        assert_dialog_wrap(page, dialog, [role(dialog, "button", "Fork version 3"), role(dialog, "button", "Cancel")])
        press(page, "Escape")
        expect(dialog).to_have_count(0)
        expect(button).to_be_focused()
        assert Api(app_url).get(f"/api/guides/{guide['id']}").json()["fork_count"] == 0
        press(page, "Enter")
        role(dialog, "button", "Fork version 3").focus()
        press(page, "Enter")
        wait_path(page, lambda p: p.startswith("/edit/"), "the fork's editor")
        assert urlsplit(page.url).path != f"/edit/{guide['slug']}"
        poll(lambda: role(page, "textbox", "Guide title").count() > 0, "editor fields", page)
        expect(role(page, "textbox", "Guide title")).to_have_value(f"{guide['title']} (fork)")
    assert Api(app_url).get(f"/api/guides/{guide['id']}").json()["fork_count"] == 1


def test_fork_credit_and_json(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reader = Api(app_url, world["reader"])
    reply = reader.post(f"/api/guides/{guide['id']}/forks")
    assert reply.status_code == 201, f"Fork answered {reply.status_code}: {reply.text[:300]}"
    body = reply.json()
    expected = {"guide_id": guide["id"], "title": guide["title"], "author_name": world["author"]["name"], "version": 3}
    assert body["forked_from"] == expected
    reading = reader.get(f"/api/guides/{body['id']}").json()
    assert reading["forked_from"] == expected and reading["title"] == f"{guide['title']} (fork)" and reading["state"] == "draft"
    assert [v["number"] for v in versions(reader, body["id"])] == [1]
    with opened(browser, f"{app_url}/g/{body['slug']}", account=world["reader"]) as page:
        credit = f"Forked from {guide['title']} by {world['author']['name']}, version 3."
        see(page, page.get_by_text(credit, exact=True), credit)
        link = role(page, "link", guide["title"])
        expect(link).to_have_attribute("href", re.compile(rf"/g/{re.escape(guide['slug'])}"))


def test_fork_count_updates_live(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    with opened(browser, f"{app_url}/g/{guide['slug']}", live=True) as page:
        see(page, status(page, "Fork count"), "0 forks")
        mark_page(page)
        has(Api(app_url, world["reader"]).post(f"/api/guides/{guide['id']}/forks"), 201)
        see_live(status(page, "Fork count"), "1 fork")
        has(Api(app_url, world["coauthor"]).post(f"/api/guides/{guide['id']}/forks"), 201)
        see_live(status(page, "Fork count"), "2 forks")
        assert_no_reload(page)
    assert Api(app_url).get(f"/api/guides/{guide['id']}").json()["fork_count"] == 2


def test_fork_stays_independent(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    author, reader = Api(app_url, world["author"]), Api(app_url, world["reader"])
    fork = reader.post(f"/api/guides/{guide['id']}/forks").json()
    snapshot = reader.get(f"/api/guides/{fork['id']}").json()
    model_bytes = reader.get(f"/api/models/{snapshot['model_id']}.glb").content
    source = author.working(guide["id"])
    author.commit(guide["id"], f"step/{source['steps'][0]['id']}/text", "Changed at the source.")
    has(author.post(f"/api/guides/{guide['id']}/versions", {"base_version": source["latest_version"]}), 201)
    has(author.post(f"/api/guides/{guide['id']}/withdraw"), 200, state="withdrawn")
    has(author.post(f"/api/guides/{guide['id']}/publish"), 200, state="published")
    assert author.delete(f"/api/guides/{guide['id']}").status_code == 204
    after = reader.get(f"/api/guides/{fork['id']}").json()
    for key in ("steps", "parts", "forked_from", "model_id", "title"):
        assert after[key] == snapshot[key], f"The fork's {key} changed with the source"
    served = reader.get(f"/api/models/{after['model_id']}.glb")
    assert served.status_code == 200 and served.content == model_bytes
    with opened(browser, f"{app_url}/g/{fork['slug']}", account=world["reader"]) as page:
        wait_state(page)
        credit = f"Forked from {guide['title']} by {world['author']['name']}, version 3."
        see(page, page.get_by_text(credit, exact=True), credit)
        expect(role(page, "link", guide["title"])).to_have_count(0)
        poll(lambda: gl_counters(page)["draws"] > 0, "the fork's stage draws its model", page)


def test_forks_shelf_and_empty_shelves(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    empties = {"Questions": "No questions waiting.", "Drafts": "Nothing on the bench yet.", "Published": "Nothing out in the world yet.", "Forks": "No forks yet. Find a guide worth adapting.", "Collections": "No collections yet."}
    with opened(browser, f"{app_url}/dashboard", account=world["reader"]) as page:
        for heading, sentence in empties.items():
            poll(lambda h=heading: page.get_by_role("heading", level=2, name=h, exact=True).count() > 0, f"{heading} shelf heading", page)
            see(page, page.get_by_text(sentence, exact=True), sentence)
        fork = Api(app_url, world["reader"]).post(f"/api/guides/{guide['id']}/forks").json()
        page.reload()
        link = role(page, "link", f"{guide['title']} (fork)")
        poll(lambda: link.count() > 0, "the fork row after reload", page)
        expect(link).to_have_attribute("href", re.compile(rf"/edit/{re.escape(fork['slug'])}"))
        expect(page.get_by_text(empties["Forks"], exact=True)).to_have_count(0)
    with opened(browser, f"{app_url}/dashboard", account=world["reader"]) as fresh:
        poll(lambda: role(fresh, "link", f"{guide['title']} (fork)").count() > 0, "the fork row in a new session", fresh)


def test_private_guide_cannot_be_forked(app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["private"]
    reader, owner = Api(app_url, world["reader"]), Api(app_url, world["author"])
    has(reader.post(f"/api/guides/{guide['id']}/forks"), 404, error="not_found")
    has(Api(app_url).post(f"/api/guides/{guide['id']}/forks"), 404, error="not_found")
    reading = owner.get(f"/api/guides/{guide['id']}").json()
    assert reading["fork_count"] == 0, "A refused fork counted"
    assert reader.get("/api/dashboard").json()["forks"] == []
    has(reader.get(f"/api/models/{reading['model_id']}.glb"), 404, error="not_found")
    for probe in ("/api/models", "/api/models/", "/api/forks"):
        assert reader.get(probe).status_code == 404, f"{probe} answers; bucket listings are never offered"


def start_conflict(author: Page, coauthor: Page, api: Api, guide_id: str, mine: str, theirs: str) -> Locator:
    author_field = role(author, "textbox", "Step 1 text")
    fill(author_field, mine)
    commit_ui(coauthor, role(coauthor, "textbox", "Step 1 text"), theirs)
    wait_field(api, guide_id, 1, "text", theirs, coauthor)
    dialog = role(author, "alertdialog", "Edit conflict")
    poll(lambda: dialog.count() > 0, "the Edit conflict dialog", author, budget_ms=COMMIT_MS + SETTLE_MS)
    return dialog


def test_wf_co_editing_keep_mine(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        see_live(role(author, "list", "People editing").get_by_role("listitem"), f"{world['coauthor']['name']}, step 1")
        see_live(role(coauthor, "list", "People editing").get_by_role("listitem"), f"{world['author']['name']}, step 1")
        commit_ui(author, role(author, "textbox", "Step 2 title"), AUTHOR_MERGED)
        commit_ui(coauthor, role(coauthor, "textbox", "Step 3 title"), CO_MERGED)
        wait_field(api, guide["id"], 2, "title", AUTHOR_MERGED, author)
        wait_field(api, guide["id"], 3, "title", CO_MERGED, coauthor)
        dialog = start_conflict(author, coauthor, api, guide["id"], "Mine wins", "Theirs loses")
        keep = role(dialog, "button", "Keep mine")
        keep.focus()
        press(author, "Enter")
        see(author, status(author, "Editor status"), "Kept your text in Step 1 text.")
        wait_field(api, guide["id"], 1, "text", "Mine wins", author)
        poll(lambda: role(coauthor, "textbox", "Step 1 text").input_value() == "Mine wins", "the chosen value in the co-author's field", seconds=LIVE_WAIT)
    work = api.working(guide["id"])
    assert work["steps"][1]["title"] == AUTHOR_MERGED and work["steps"][2]["title"] == CO_MERGED


def test_wf_co_editing_escape_raises_again(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        dialog = start_conflict(author, coauthor, api, guide["id"], HELD_BACK, ALREADY_STORED)
        press(author, "Escape")
        expect(dialog).to_have_count(0)
        field = role(author, "textbox", "Step 1 text")
        expect(field).to_have_value(HELD_BACK)
        assert step_field(api, guide["id"], 1, "text") == ALREADY_STORED
        fill(field, "Held back again")
        advance(author, COMMIT_MS)
        poll(lambda: dialog.count() > 0, "the next commit raises the dialog again", author, budget_ms=SETTLE_MS)
        assert step_field(api, guide["id"], 1, "text") == ALREADY_STORED


def test_people_editing_shows_who_and_where(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    url = f"{app_url}/edit/{world['guides']['draft']['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author:
        ready_editor(author)
        items = role(author, "list", "People editing").get_by_role("listitem")
        expect(items).to_have_count(0)
        tab = second_tab(author, url)
        ready_editor(tab)
        author.bring_to_front()
        expect(items).to_have_count(0)
        with opened(browser, url, account=world["coauthor"], live=True) as coauthor:
            ready_editor(coauthor)
            see_live(items, f"{world['coauthor']['name']}, step 1")
            role(coauthor, "textbox", "Step 3 title").focus()
            advance(coauthor, SETTLE_MS)
            see_live(items, f"{world['coauthor']['name']}, step 3")
            expect(items).to_have_count(1)
    with opened(browser, url, viewport=PHONE, account=world["coauthor"]) as phone:
        tablist = role(phone, "tablist", "Editor panes")
        poll(lambda: tablist.count() > 0, "Editor panes", phone)
        people, tabs = role(phone, "list", "People editing").bounding_box(), tablist.bounding_box()
        assert people and tabs
        assert people["y"] + people["height"] <= tabs["y"] + 1, "People editing is not above the tabs"


def test_presence_drops_after_tab_closes(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    url = f"{app_url}/edit/{world['guides']['draft']['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author:
        ready_editor(author)
        items = role(author, "list", "People editing").get_by_role("listitem")
        with opened(browser, url, account=world["coauthor"], live=True) as coauthor:
            ready_editor(coauthor)
            see_live(items, f"{world['coauthor']['name']}, step 1")
            coauthor.close()
            poll(lambda: items.count() == 0, "the entry leaves People editing", seconds=PRESENCE_GRACE_SECONDS + LIVE_WAIT)


def test_different_fields_merge(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        fill(role(author, "textbox", "Step 1 title"), "Author field")
        fill(role(coauthor, "textbox", "Step 1 text"), "Co-author field")
        advance(author, COMMIT_MS)
        advance(coauthor, COMMIT_MS)
        poll(lambda: step_field(api, guide["id"], 1, "title") == "Author field" and step_field(api, guide["id"], 1, "text") == "Co-author field", "both edits in the working copy")
        for page in (author, coauthor):
            poll(lambda p=page: role(p, "textbox", "Step 1 title").input_value() == "Author field" and role(p, "textbox", "Step 1 text").input_value() == "Co-author field", "both edits on both pages", seconds=LIVE_WAIT)
            expect(role(page, "alertdialog", "Edit conflict")).to_have_count(0)


def test_same_field_conflict_dialog(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        dialog = start_conflict(author, coauthor, api, guide["id"], AUTHOR_OWN_WORDS, CO_OWN_WORDS)
        copy = f"{world['coauthor']['name']} changed Step 1 text while you were editing it."
        expect(dialog.get_by_text(copy, exact=True)).to_be_visible()
        for piece in ("Yours", "Theirs", AUTHOR_OWN_WORDS, CO_OWN_WORDS):
            expect(dialog).to_contain_text(piece)
        assert_dialog_wrap(author, dialog, [role(dialog, "button", "Keep mine"), role(dialog, "button", "Take theirs")])
        assert step_field(api, guide["id"], 1, "text") == CO_OWN_WORDS, "The stored value changed before a choice"


@pytest.mark.parametrize("choice", ["Keep mine", "Take theirs"], ids=["keep_mine", "take_theirs"])
def test_conflict_choices_store_value(browser: Any, app_url: str, choice: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    url = f"{app_url}/edit/{guide['slug']}"
    with opened(browser, url, account=world["author"], live=True) as author, opened(browser, url, account=world["coauthor"], live=True) as coauthor:
        ready_editor(author)
        ready_editor(coauthor)
        dialog = start_conflict(author, coauthor, api, guide["id"], "Value from author", "Value from co-author")
        click(role(dialog, "button", choice))
        advance(author, SETTLE_MS)
        expected, copy = ("Value from author", "Kept your text in Step 1 text.") if choice == "Keep mine" else ("Value from co-author", f"Took the text from {world['coauthor']['name']} in Step 1 text.")
        see(author, status(author, "Editor status"), copy)
        wait_field(api, guide["id"], 1, "text", expected, author)
        expect(dialog).to_have_count(0)
        expect(role(author, "textbox", "Step 1 text")).to_have_value(expected)
        poll(lambda: role(coauthor, "textbox", "Step 1 text").input_value() == expected, "the chosen value in the co-author's field", seconds=LIVE_WAIT)


def test_stale_saves_refused(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    api = Api(app_url, world["author"])
    co_api = Api(app_url, world["coauthor"])
    work = api.working(guide["id"])
    field = f"step/{work['steps'][0]['id']}/title"
    co_api.commit(guide["id"], field, "Saved elsewhere")
    has(co_api.post(f"/api/guides/{guide['id']}/versions", {"base_version": 1}), 201, number=2)
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)

        def stale_base(route: Any) -> None:
            if route.request.method == "POST":
                route.continue_(post_data=json.dumps({"base_version": 1}))
            else:
                route.continue_()

        page.route("**/api/guides/*/versions", stale_base)
        text_field = role(page, "textbox", "Step 2 text")
        commit_ui(page, text_field, "Typed before a stale save.")
        wait_field(api, guide["id"], 2, "text", "Typed before a stale save.", page)
        text_field.focus()
        page.keyboard.press("Control+s")
        see(page, status(page, "Editor status"), "Version 2 was saved elsewhere. Nothing was overwritten.")
        expect(text_field).to_have_value(STALE_TEXT)
        expect(role(page, "region", "Version compare")).to_be_visible()
        page.unroute("**/api/guides/*/versions")
    reply = api.post(f"/api/guides/{guide['id']}/versions", {"base_version": 1})
    has(reply, 409, error="version_conflict", current=2)
    assert field in reply.json()["fields"]
    assert versions(api, guide["id"])[0]["number"] == 2, "A stale save wrote a version"
    assert version(api, guide["id"], 2)["steps"][1]["text"] != STALE_TEXT


def test_wf_questions_live_happy(browser: Any, app_url: str, mail: Any) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    newcomer = world["newcomer"]
    question = "Do the new burrs need a run-in?"
    with opened(browser, f"{app_url}/dashboard", account=world["author"], live=True) as dashboard, opened(browser, f"{app_url}/g/{guide['slug']}?step=4", account=newcomer) as page:
        ask = role(page, "button", "Ask the author")
        poll(lambda: ask.count() > 0, "Ask the author", page)
        click(ask)
        see(page, status(page, "Guide status"), UNCONFIRMED_COPY)
        click(role(page, "button", "Resend confirmation"))
        see(page, status(page, "Guide status"), f"We sent a new confirmation message to {newcomer['email']}.")
        token = token_of(inbox(mail, newcomer["email"], 1)[0])
        page.goto(f"{app_url}/confirm?token={token}")
        see(page, status(page, "Account status"), CONFIRMED_COPY)
        page.goto(f"{app_url}/g/{guide['slug']}?step=4")
        wait_live(page)
        poll(lambda: ask.count() > 0, "Ask the author", page)
        ask.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Ask the author")
        expect(dialog).to_contain_text("Asking about step 4")
        page.keyboard.type(question)
        role(dialog, "button", "Send question").focus()
        press(page, "Enter")
        see(page, status(page, "Guide status"), "Question sent.")
        see_live(status(dashboard, "Question alerts"), f"New question on {guide['title']}, step 4.")
        questions = role(dashboard, "list", "Questions")
        row = questions.get_by_role("listitem").filter(has_text=question)
        poll(lambda: row.count() == 1, "the question row on the dashboard", seconds=LIVE_WAIT)
        click(role(row, "button", "Answer"))
        advance(dashboard, SETTLE_MS)
        answer = role(dashboard, "dialog", "Answer question")
        fill(role(answer, "textbox", "Your answer"), RUN_IN_ANSWER)
        click(role(answer, "button", "Send answer"))
        see_live(status(page, "Question alerts"), f"{world['author']['name']} answered your question on step 4.")
        expect(role(page, "list", "Questions on this step")).to_contain_text(RUN_IN_ANSWER)
    items = httpx.get(f"{app_url}/api/guides/{guide['id']}/questions", timeout=HTTP_TIMEOUT).json()["items"]
    stored = next(q for q in items if q["text"] == question)
    assert stored["step"] == 4 and stored["asked_by"] == newcomer["name"] and stored["answer"]["text"] == RUN_IN_ANSWER


def test_wf_questions_live_invalid_recovery(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    with opened(browser, f"{app_url}/g/{guide['slug']}?step=2", account=world["reader"]) as page:
        ask = role(page, "button", "Ask the author")
        poll(lambda: ask.count() > 0, "Ask the author", page)
        click(ask)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Ask the author")
        field = role(dialog, "textbox", "Your question")
        send = role(dialog, "button", "Send question")
        click(send)
        see(page, status(page, "Ask status"), "Write a question first.")
        over = EMOJI * (QUESTION_TEXT_MAX + 1)
        fill(field, over)
        click(send)
        see(page, status(page, "Ask status"), f"Your question can be at most {QUESTION_TEXT_MAX:,} characters.")
        expect(dialog).to_be_visible()
        expect(field).to_have_value(over)
        fill(field, EMOJI * QUESTION_TEXT_MAX)
        click(send)
        see(page, status(page, "Guide status"), "Question sent.")
    items = httpx.get(f"{app_url}/api/guides/{guide['id']}/questions", timeout=HTTP_TIMEOUT).json()["items"]
    assert any(q["text"] == EMOJI * QUESTION_TEXT_MAX and q["step"] == 2 for q in items)
    assert not any(q["text"] == over for q in items)


def test_unconfirmed_account_refused(browser: Any, app_url: str, mail: Any) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    newcomer = world["newcomer"]
    api = Api(app_url, newcomer)
    assert api.get("/api/session").json()["user"]["confirmed"] is False
    assert mails_for(mail, newcomer["email"]) == [], "World creation sent mail"
    has(api.put(f"/api/guides/{guide['id']}/like"), 403, error="unconfirmed")
    has(api.post(f"/api/guides/{guide['id']}/questions", {"step": 1, "text": "Unconfirmed probe"}), 403, error="unconfirmed")
    for reply in (api.upload(guide["id"], sample(app_url)), api.post(f"/api/guides/{guide['id']}/versions", {"base_version": 3})):
        assert reply.status_code == 403 and reply.json()["error"] in ("unconfirmed", "forbidden"), f"{reply.status_code}: {reply.text[:200]}"
    public = Api(app_url)
    assert public.get(f"/api/guides/{guide['id']}").json()["like_count"] == 0
    assert all(q["text"] != UNCONFIRMED_PROBE for q in public.get(f"/api/guides/{guide['id']}/questions").json()["items"])
    with opened(browser, f"{app_url}/g/{guide['slug']}?step=2", account=newcomer) as page:
        ask = role(page, "button", "Ask the author")
        poll(lambda: ask.count() > 0, "Ask the author", page)
        click(ask)
        see(page, status(page, "Guide status"), UNCONFIRMED_COPY)
        expect(role(page, "dialog", "Ask the author")).to_have_count(0)
        click(role(page, "button", "Resend confirmation"))
        see(page, status(page, "Guide status"), f"We sent a new confirmation message to {newcomer['email']}.")
    assert len(inbox(mail, newcomer["email"], 1)) == 1


def test_confirmation_message_from_mailpit(browser: Any, app_url: str, mail: Any) -> None:
    world = make_world(app_url)
    newcomer = world["newcomer"]
    api = Api(app_url, newcomer)
    has(api.post("/api/account/resend"), 200, sent=True)
    first = inbox(mail, newcomer["email"], 1)[0]
    assert addresses(first["From"]) == [mail_from_address()]
    assert first["Subject"] == MAIL_SUBJECT
    token = token_of(first)
    public_url = os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")
    assert f"{public_url}/confirm?token={token}" in mail_text(first), "The link does not use the public origin"
    resend = api.post("/api/account/resend")
    has(resend, 200, sent=True)
    second = next(t for t in (token_of(m) for m in inbox(mail, newcomer["email"], 2)) if t != token)
    leaks = [resend.text, api.get("/api/session").text, api.get("/api/dashboard").text, api.get("/confirm").text]
    assert not any(token in leak or second in leak for leak in leaks), "A response carried a confirmation token"
    has(api.post("/api/account/confirm", {"token": token}), 410, error="token_invalid")
    assert api.get("/api/session").json()["user"]["confirmed"] is False
    with opened(browser, f"{app_url}/confirm?token={token}") as page:
        see(page, status(page, "Account status"), BAD_TOKEN_COPY)
        expect(role(page, "button", "Send a new link")).to_be_visible()
        page.goto(f"{app_url}/confirm?token={second}")
        see(page, status(page, "Account status"), CONFIRMED_COPY)
        assert second not in page.content(), "The page's markup carries the token"
    assert api.get("/api/session").json()["user"]["confirmed"] is True, "The link did not confirm the account"
    has(Api(app_url).post("/api/account/confirm", {"token": second}), 410, error="token_invalid")
    has(api.post("/api/account/resend"), 409, error="already_confirmed")
    short = short_limits_url()
    late = make_world(short)["newcomer"]
    late_api = Api(short, late)
    has(late_api.post("/api/account/resend"), 200, sent=True)
    expiring = token_of(inbox(mail, late["email"], 1)[0])
    deadline = time.monotonic() + SHORT_TOKEN_TTL_SECONDS + 1
    while time.monotonic() < deadline:
        late_api.get("/api/health")
    has(late_api.post("/api/account/confirm", {"token": expiring}), 410, error="token_invalid")
    assert late_api.get("/api/session").json()["user"]["confirmed"] is False


def test_ask_dialog_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    with opened(browser, f"{app_url}/g/{guide['slug']}?step=3", account=world["reader"]) as page:
        ask = role(page, "button", "Ask the author")
        poll(lambda: ask.count() > 0, "Ask the author", page)
        ask.focus()
        press(page, "Enter")
        dialog = role(page, "dialog", "Ask the author")
        expect(dialog).to_contain_text("Asking about step 3")
        assert_dialog_wrap(page, dialog, [role(dialog, "textbox", "Your question"), role(dialog, "button", "Send question"), role(dialog, "button", "Cancel")])
        press(page, "Escape")
        expect(dialog).to_have_count(0)
        expect(ask).to_be_focused()
        press(page, "Enter")
        fill(role(dialog, "textbox", "Your question"), GREASE_QUESTION)
        role(dialog, "button", "Send question").focus()
        press(page, "Enter")
        see(page, status(page, "Guide status"), "Question sent.")
        expect(dialog).to_have_count(0)
        expect(role(page, "list", "Questions on this step")).to_contain_text(GREASE_QUESTION)
    items = httpx.get(f"{app_url}/api/guides/{guide['id']}/questions", timeout=HTTP_TIMEOUT).json()["items"]
    assert any(q["text"] == GREASE_QUESTION and q["step"] == 3 for q in items)


def test_question_reaches_open_dashboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reader = Api(app_url, world["reader"])
    with opened(browser, f"{app_url}/dashboard", account=world["author"], live=True) as page:
        questions = role(page, "list", "Questions")
        poll(lambda: questions.count() > 0, "the Questions list", page)
        mark_page(page)
        rows = questions.get_by_role("listitem")
        has(reader.post(f"/api/guides/{guide['id']}/questions", {"step": 2, "text": "First live question"}), 201)
        see_live(status(page, "Question alerts"), f"New question on {guide['title']}, step 2.")
        poll(lambda: rows.filter(has_text="First live question").count() == 1, "first question on the open dashboard", seconds=LIVE_WAIT)
        page.context.set_offline(True)
        page.evaluate(
            """() => { for (const s of window.__probe.live) { s.close(); if (window.EventSource && s instanceof EventSource) s.dispatchEvent(new Event('error')); } }"""
        )
        has(reader.post(f"/api/guides/{guide['id']}/questions", {"step": 5, "text": "Asked while the connection was down"}), 201)
        page.context.set_offline(False)
        advance(page, RECONNECT_MS)
        poll(lambda: rows.filter(has_text="Asked while the connection was down").count() >= 1, "the missed question after the connection returns", page, budget_ms=RECONNECT_MS)
        wait_live(page)
        has(reader.post(f"/api/guides/{guide['id']}/questions", {"step": 1, "text": "After the reconnect"}), 201)
        poll(lambda: rows.filter(has_text="After the reconnect").count() == 1, "the live connection works again", seconds=LIVE_WAIT)
        for text_value in ("First live question", "Asked while the connection was down", "After the reconnect"):
            assert rows.filter(has_text=text_value).count() == 1, f"{text_value!r} is missing or repeated"
        assert_no_reload(page)


def test_literal_text_and_live_answers(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reader = Api(app_url, world["reader"])
    question = f"{MARKUP_TEXT} question"
    answer_text = f"{MARKUP_TEXT} answer"
    reply = reader.post(f"/api/guides/{guide['id']}/questions", {"step": 2, "text": question})
    assert reply.status_code == 201 and reply.json()["text"] == question
    with opened(browser, f"{app_url}/g/{guide['slug']}?step=2", account=world["reader"], live=True) as page, opened(browser, f"{app_url}/dashboard", account=world["author"]) as dashboard:
        listing = role(page, "list", "Questions on this step")
        poll(lambda: listing.count() > 0, "questions on this step", page)
        expect(listing).to_contain_text(question)
        assert markup_count(listing) == 0, "Markup was interpreted in a question"
        row = role(dashboard, "list", "Questions").get_by_role("listitem").filter(has_text=question)
        poll(lambda: row.count() == 1, "the question row", dashboard)
        assert markup_count(row) == 0
        click(role(row, "button", "Answer"))
        advance(dashboard, SETTLE_MS)
        answer = role(dashboard, "dialog", "Answer question")
        fill(role(answer, "textbox", "Your answer"), answer_text)
        click(role(answer, "button", "Send answer"))
        see_live(status(page, "Question alerts"), f"{world['author']['name']} answered your question on step 2.")
        expect(listing).to_contain_text(answer_text)
        assert markup_count(listing) == 0, "Markup was interpreted in an answer"
    items = reader.get(f"/api/guides/{guide['id']}/questions").json()["items"]
    stored = next(q for q in items if q["text"] == question)
    assert stored["answer"]["text"] == answer_text and stored["answer"]["answered_by"] == world["author"]["name"]
    has(Api(app_url, world["author"]).post(f"/api/questions/{stored['id']}/answer", {"text": "Twice"}), 409, error="already_answered")


def test_limits_tell_when_to_try_again(browser: Any, app_url: str, mail: Any) -> None:
    base = short_limits_url()
    world = make_world(base)
    guide = world["guides"]["public"]
    reader = Api(base, world["reader"])
    has(reader.post(f"/api/guides/{guide['id']}/questions", {"step": 1, "text": ""}), 422)
    for number in (1, 2):
        has(reader.post(f"/api/guides/{guide['id']}/questions", {"step": 1, "text": f"Allowed question {number}"}), 201)
    with opened(browser, f"{base}/g/{guide['slug']}?step=1", account=world["reader"]) as page:
        ask = role(page, "button", "Ask the author")
        poll(lambda: ask.count() > 0, "Ask the author", page)
        click(ask)
        advance(page, SETTLE_MS)
        dialog = role(page, "dialog", "Ask the author")
        fill(role(dialog, "textbox", "Your question"), REFUSED_THIRD)
        click(role(dialog, "button", "Send question"))
        see_match(page, status(page, "Ask status"), r"Too many questions\. Try again in \d+ seconds\.")
        expect(role(dialog, "textbox", "Your question")).to_have_value(REFUSED_THIRD)
    refused = reader.post(f"/api/guides/{guide['id']}/questions", {"step": 1, "text": API_THIRD})
    has(refused, 429, error="rate_limited")
    retry = int(refused.headers["Retry-After"])
    assert 0 < retry <= SHORT_QUESTION_WINDOW and refused.json()["retry_after"] == retry
    stored = Api(base).get(f"/api/guides/{guide['id']}/questions").json()["items"]
    assert all(q["text"] not in (API_THIRD, REFUSED_THIRD) for q in stored), "A refused question was stored"

    primary_world = make_world(app_url)
    victim = primary_world["reader"]
    anon = Api(app_url)
    for _ in range(SIGNIN_LIMIT):
        has(anon.post("/api/session", {"email": victim["email"], "password": "wrong-password-1"}), 401, error="bad_credentials")
    limited = anon.post("/api/session", {"email": victim["email"], "password": victim["password"]})
    has(limited, 429, error="rate_limited")
    assert int(limited.headers["Retry-After"]) > 0
    with opened(browser, f"{app_url}/signin") as page:
        poll(lambda: page.get_by_label("Email", exact=True).count() > 0, "sign-in form", page)
        sign_in_form(page, victim)
        see_match(page, status(page, "Account status"), r"Too many sign-in attempts\. Try again in \d+ seconds\.")

    newcomer = primary_world["newcomer"]
    api = Api(app_url, newcomer)
    for _ in range(RESEND_LIMIT):
        has(api.post("/api/account/resend"), 200, sent=True)
    limited = api.post("/api/account/resend")
    has(limited, 429, error="rate_limited")
    assert int(limited.headers["Retry-After"]) > 0
    assert len(inbox(mail, newcomer["email"], RESEND_LIMIT)) == RESEND_LIMIT, "A refused resend sent mail"
    with opened(browser, f"{app_url}/confirm", account=newcomer) as page:
        link = role(page, "button", "Send a new link")
        poll(lambda: link.count() > 0, "Send a new link", page)
        click(link)
        see_match(page, status(page, "Account status"), r"Too many messages\. Try again in \d+ seconds\.")


def test_wf_discover_signed_out_search(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    suffix = suffix_of(world)
    public = world["guides"]["public"]
    with opened(browser, f"{app_url}/search") as page:
        box = role(page, "searchbox", "Search guides")
        poll(lambda: box.count() > 0, "Search guides", page)
        fill(box, suffix)
        advance(page, SEARCH_DEBOUNCE_MS)
        see(page, status(page, "Search status"), "1 guide found.")
        expect(page.get_by_text(public["title"]).first).to_be_visible()
        combo = role(page, "combobox", "Filter by tag")
        combo.focus()
        page.keyboard.type("burrs")
        press(page, "Enter")
        see(page, status(page, "Search status"), "1 guide found.")
        role(page, "button", "Remove tag burrs").focus()
        press(page, "Enter")
        combo.focus()
        page.keyboard.type("bike")
        press(page, "Enter")
        see(page, status(page, "Search status"), "No guides found.")
    found = httpx.get(f"{app_url}/api/search", params={"q": suffix}, timeout=HTTP_TIMEOUT).json()
    assert [item["id"] for item in found["items"]] == [public["id"]] and found["total"] == 1


def test_wf_discover_collection_and_like(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    public, draft = world["guides"]["public"], world["guides"]["draft"]
    collection = world["collection"]
    author = Api(app_url, world["author"])
    has(author.post(f"/api/collections/{collection['id']}/items", {"guide_id": draft["id"]}), 201)
    with opened(browser, f"{app_url}/c/{collection['slug']}", account=world["author"]) as page:
        rows = role(page, "list", "Guides in this collection").get_by_role("listitem")
        poll(lambda: rows.count() == 2, "two collection rows", page)
        rows.filter(has_text=public["title"]).focus()
        press(page, "Alt+ArrowDown")
        see(page, status(page, "Collection status"), f"{public['title']} moved to position 2.")
    order = [i["guide_id"] for i in author.get(f"/api/collections/{collection['id']}").json()["items"]]
    assert order == [draft["id"], public["id"]]
    with opened(browser, f"{app_url}/g/{public['slug']}", account=world["author"], live=True) as author_page, opened(browser, f"{app_url}/g/{public['slug']}", account=world["reader"]) as reader_page:
        see(author_page, status(author_page, "Like count"), "0 likes")
        like = role(reader_page, "button", "Like")
        poll(lambda: like.count() > 0, "Like", reader_page)
        like.focus()
        press(reader_page, "Enter")
        see_live(status(author_page, "Like count"), "1 like")
    assert Api(app_url).get(f"/api/guides/{public['id']}").json()["like_count"] == 1


def test_search_updates_in_place(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    suffix = suffix_of(world)
    with opened(browser, f"{app_url}/search") as page:
        box = role(page, "searchbox", "Search guides")
        poll(lambda: box.count() > 0, "Search guides", page)
        count = figure(page, "result-count")
        poll(lambda: figure(page, "result-count").count() > 0, "the huge count", page)
        mark_page(page)
        entries = page.evaluate("() => history.length")
        box.focus()
        page.keyboard.type(suffix[:3])
        advance(page, SEARCH_DEBOUNCE_MS - 1)
        page.keyboard.type(suffix[3:])
        advance(page, SEARCH_DEBOUNCE_MS - 1)
        assert f"q={suffix}" not in page.url, "The search ran before the delay after the last key"
        advance(page, 1)
        see(page, status(page, "Search status"), "1 guide found.")
        see(page, count, "1")
        expect(page.get_by_text(world["guides"]["public"]["title"]).first).to_be_visible()
        assert f"q={suffix}" in page.url
        assert page.evaluate("() => history.length") == entries, "Typing added a history entry"
        fill(box, f"{suffix} absentword")
        advance(page, SEARCH_DEBOUNCE_MS)
        see(page, status(page, "Search status"), "No guides found.")
        see(page, count, "0")
        expect(page.get_by_text(world["guides"]["public"]["title"])).to_have_count(0)
        assert_no_reload(page)


def test_tags_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    suffix = suffix_of(world)
    with opened(browser, f"{app_url}/search?q={suffix}") as page:
        combo = role(page, "combobox", "Filter by tag")
        poll(lambda: combo.count() > 0, "Filter by tag", page)
        see(page, status(page, "Search status"), "1 guide found.")
        combo.focus()
        page.keyboard.type("bur")
        advance(page, COMMIT_MS)
        poll(lambda: role(page, "option", "burrs").count() > 0, "the burrs option", page)
        press(page, "ArrowDown")
        press(page, "Enter")
        expect(role(page, "button", "Remove tag burrs")).to_be_visible()
        see(page, status(page, "Search status"), "1 guide found.")
        assert parse_qs(urlsplit(page.url).query).get("tag") == ["burrs"]
        combo.focus()
        page.keyboard.type("bike")
        press(page, "Enter")
        expect(role(page, "button", "Remove tag bike")).to_be_visible()
        see(page, status(page, "Search status"), "No guides found.")
        combo.focus()
        expect(combo).to_have_value("")
        press(page, "Backspace")
        expect(role(page, "button", "Remove tag bike")).to_have_count(0)
        expect(role(page, "button", "Remove tag burrs")).to_be_visible()
        see(page, status(page, "Search status"), "1 guide found.")
        click(role(page, "button", "Remove tag burrs"))
        advance(page, SETTLE_MS)
        assert "burrs" not in parse_qs(urlsplit(page.url).query).get("tag", [])


def test_search_lives_in_address(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    suffix = suffix_of(world)
    guides = world["guides"]
    with opened(browser, f"{app_url}/search?q={suffix}&tag=coffee&tag=burrs") as page:
        box = role(page, "searchbox", "Search guides")
        for _ in range(2):
            poll(lambda: box.count() > 0, "Search guides", page)
            expect(box).to_have_value(suffix)
            expect(role(page, "button", "Remove tag coffee")).to_be_visible()
            expect(role(page, "button", "Remove tag burrs")).to_be_visible()
            see(page, status(page, "Search status"), "1 guide found.")
            page.reload()
        page.goto(f"{app_url}/search?q={suffix}")
        see(page, status(page, "Search status"), "1 guide found.")
        for key in ("private", "draft", "withdrawn"):
            expect(page.get_by_text(guides[key]["title"])).to_have_count(0)
    for query in ({"q": suffix}, {"q": f"bike {suffix}"}, {"q": f"controller {suffix}"}, {"tag": "bike", "q": suffix}):
        found = httpx.get(f"{app_url}/api/search", params=query, timeout=HTTP_TIMEOUT).json()
        ids = {item["id"] for item in found["items"]}
        assert not ids & {guides[k]["id"] for k in ("private", "draft", "withdrawn")}, f"A hidden guide matched {query}"
    item = httpx.get(f"{app_url}/api/search", params={"q": suffix}, timeout=HTTP_TIMEOUT).json()["items"][0]
    assert item["id"] == guides["public"]["id"] and item["parts_cost_text"] == PUBLIC_TOTAL and item["step_count"] == 5


def test_paging_and_search_limits(browser: Any, app_url: str) -> None:
    worlds = [make_world(app_url) for _ in range(PAGING_WORLDS)]
    created = {w["guides"]["public"]["id"] for w in worlds}
    query = "burrs"
    seen: list[str] = []
    cursor: str | None = None
    first = True
    for _ in range(TAB_LIMIT):
        params: dict[str, Any] = {"q": query, "limit": 5}
        if cursor:
            params["cursor"] = cursor
        page_json = httpx.get(f"{app_url}/api/search", params=params, timeout=HTTP_TIMEOUT).json()
        assert len(page_json["items"]) <= 5
        seen.extend(item["id"] for item in page_json["items"])
        if first:
            make_world(app_url)
            first = False
        cursor = page_json["next_cursor"]
        if not cursor:
            break
    else:
        pytest.fail("GET /api/search kept offering a next cursor; expected the list to end")
    assert len(seen) == len(set(seen)), "A cursor page repeated a guide"
    assert created <= set(seen), "A cursor page skipped a guide"
    capped = httpx.get(f"{app_url}/api/search", params={"q": query, "limit": 1000}, timeout=HTTP_TIMEOUT).json()
    assert len(capped["items"]) <= PAGE_SIZE_MAX
    default = httpx.get(f"{app_url}/api/search", params={"q": query}, timeout=HTTP_TIMEOUT).json()
    assert len(default["items"]) == PAGE_SIZE and default["next_cursor"]
    has(httpx.get(f"{app_url}/api/search", params={"q": "x" * (SEARCH_QUERY_MAX + 1)}, timeout=HTTP_TIMEOUT), 422, error="query_too_long", limit=SEARCH_QUERY_MAX)
    assert httpx.get(f"{app_url}/api/search", params={"q": "x" * SEARCH_QUERY_MAX}, timeout=HTTP_TIMEOUT).status_code == 200
    has(httpx.get(f"{app_url}/api/search", params={"tag": [f"t{i}" for i in range(SEARCH_TAG_MAX + 1)]}, timeout=HTTP_TIMEOUT), 422, error="too_many_tags", limit=SEARCH_TAG_MAX)
    assert httpx.get(f"{app_url}/api/search", params={"tag": [f"t{i}" for i in range(SEARCH_TAG_MAX)]}, timeout=HTTP_TIMEOUT).status_code == 200
    suffix = suffix_of(worlds[0])
    started = time.monotonic()
    wild = httpx.get(f"{app_url}/api/search", params={"q": "%_\\(" * (SEARCH_QUERY_MAX // 4)}, timeout=HTTP_TIMEOUT)
    assert wild.status_code in (200, 503) and time.monotonic() - started < SEARCH_DB_SECONDS + ROUND_TRIP_SLACK
    assert httpx.get(f"{app_url}/api/search", params={"q": f"{suffix} {UNDERSCORE_WORD}"}, timeout=HTTP_TIMEOUT).json()["total"] == 0, "_ matched as a pattern"
    assert httpx.get(f"{app_url}/api/search", params={"q": f"{suffix} {PERCENT_WORD}"}, timeout=HTTP_TIMEOUT).json()["total"] == 0, "% matched as a pattern"
    with opened(browser, f"{app_url}/search?q={query}") as page:
        poll(lambda: role(page, "button", "Load more").count() > 0, "Load more", page, budget_ms=2000)
        current = httpx.get(f"{app_url}/api/search", params={"q": query, "limit": PAGE_SIZE + 1}, timeout=HTTP_TIMEOUT).json()["items"]
        later = page.get_by_text(current[PAGE_SIZE]["title"], exact=True)
        earlier = page.get_by_text(current[0]["title"], exact=True)
        poll(lambda: earlier.count() > 0, "the first page of rows", page)
        before = earlier.count()
        assert later.count() == 0, "A second-page guide showed before Load more"
        click(role(page, "button", "Load more"))
        advance(page, SETTLE_MS)
        poll(lambda: later.count() > 0, "Load more adds the next guide", page)
        assert earlier.count() == before, "Load more repeated a guide"
        box = role(page, "searchbox", "Search guides")
        fill(box, "x" * (SEARCH_QUERY_MAX + 1))
        advance(page, SEARCH_DEBOUNCE_MS)
        see(page, status(page, "Search status"), f"Search terms can be at most {SEARCH_QUERY_MAX} characters.")
        expect(box).to_have_value("x" * (SEARCH_QUERY_MAX + 1))
        page.goto(f"{app_url}/search")
        combo = role(page, "combobox", "Filter by tag")
        poll(lambda: combo.count() > 0, "Filter by tag", page)
        combo.focus()
        for i in range(SEARCH_TAG_MAX + 1):
            page.keyboard.type(f"t{i}")
            press(page, "Enter")
        see(page, status(page, "Search status"), f"Search can use at most {SEARCH_TAG_MAX} tags.")


def test_collection_order_by_keyboard(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    public, draft = world["guides"]["public"], world["guides"]["draft"]
    collection = world["collection"]
    author = Api(app_url, world["author"])
    has(author.post(f"/api/collections/{collection['id']}/items", {"guide_id": draft["id"]}), 201, position=2)
    has(author.post(f"/api/collections/{collection['id']}/items", {"guide_id": draft["id"]}), 409, error="already_in_collection")
    with opened(browser, f"{app_url}/c/{collection['slug']}", account=world["author"]) as page:
        rows = role(page, "list", "Guides in this collection").get_by_role("listitem")
        notice = status(page, "Collection status")
        poll(lambda: rows.count() == 2, "two collection rows", page)
        rows.filter(has_text=public["title"]).focus()
        press(page, "Alt+ArrowUp")
        see(page, notice, f"{public['title']} is already first.")
        press(page, "Alt+ArrowDown")
        see(page, notice, f"{public['title']} moved to position 2.")
        expect(rows.nth(1)).to_contain_text(public["title"])
        press(page, "Alt+ArrowDown")
        see(page, notice, f"{public['title']} is already last.")
        page.reload()
        poll(lambda: rows.count() == 2, "collection rows after reload", page)
        expect(rows.nth(0)).to_contain_text(draft["title"])
        expect(rows.nth(1)).to_contain_text(public["title"])
    stored = author.get(f"/api/collections/{collection['id']}").json()["items"]
    assert [i["guide_id"] for i in stored] == [draft["id"], public["id"]]
    refused = Api(app_url, world["reader"]).post(f"/api/collections/{collection['id']}/items/{public['id']}/move", {"position": 1})
    assert (refused.status_code, refused.json().get("error")) in ((403, "forbidden"), (404, "not_found")), f"A non-owner move answered {refused.status_code}: {refused.text[:300]}"
    after = author.get(f"/api/collections/{collection['id']}").json()["items"]
    assert [i["guide_id"] for i in after] == [draft["id"], public["id"]], "A non-owner changed the order"


def test_likes_count_once_and_live(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["public"]
    reader, coauthor = Api(app_url, world["reader"]), Api(app_url, world["coauthor"])
    with opened(browser, f"{app_url}/g/{guide['slug']}", account=world["author"], live=True) as author_page, opened(browser, f"{app_url}/g/{guide['slug']}", account=world["reader"]) as page:
        count = status(author_page, "Like count")
        see(author_page, count, "0 likes")
        mark_page(author_page)
        like = role(page, "button", "Like")
        poll(lambda: like.count() > 0, "Like", page)
        expect(like).to_have_attribute("aria-pressed", "false")
        click(like)
        advance(page, SETTLE_MS)
        expect(like).to_have_attribute("aria-pressed", "true")
        see(page, status(page, "Guide status"), "Liked.")
        see_live(count, "1 like")
        has(reader.put(f"/api/guides/{guide['id']}/like"), 200, liked=True, like_count=1)
        has(coauthor.put(f"/api/guides/{guide['id']}/like"), 200, liked=True, like_count=2)
        see_live(count, "2 likes")
        click(like)
        advance(page, SETTLE_MS)
        expect(like).to_have_attribute("aria-pressed", "false")
        see(page, status(page, "Guide status"), "Like removed.")
        see_live(count, "1 like")
        assert_no_reload(author_page)
    has(reader.delete(f"/api/guides/{guide['id']}/like"), 200, liked=False, like_count=1)
    assert Api(app_url).get(f"/api/guides/{guide['id']}").json()["like_count"] == 1


def embed_journey(browser: Any, app_url: str, viewport: dict[str, int]) -> None:
    world = make_world(app_url)
    guide, withdrawn = world["guides"]["public"], world["guides"]["withdrawn"]
    with opened(browser, f"{app_url}/embed/{guide['slug']}?step=3", viewport=viewport) as page:
        poll(lambda: stage(page).count() > 0 and hook(page, "step") == "3", "the embed opens at step 3", page, budget_ms=SETTLE_MS)
        assert_settled(page, 3)
        for name in ("Like", "Fork guide", "Ask the author", "Add to collection"):
            expect(role(page, "button", name)).to_have_count(0)
        wait_state(page)
        click(role(page, "button", "Next step"))
        advance(page, COUNT_MS + SETTLE_MS)
        assert_settled(page, 4)
        see(page, figure(page, "parts-cost"), "€18.90", budget_ms=0)
        see(page, status(page, "Reading progress"), progress_copy(4))
        click(role(page, "button", "Previous step"))
        advance(page, COUNT_MS + SETTLE_MS)
        assert_settled(page, 3)
        sound = role(page, "button", "Workshop sound")
        assert sound_state(page)["contexts"] == 0
        click(sound)
        advance(page, SETTLE_MS)
        expect(sound).to_have_attribute("aria-pressed", "true")
        assert sound_state(page)["through"] == [[MASTER_GAIN]]
        click(sound)
        advance(page, SETTLE_MS)
        expect(sound).to_have_attribute("aria-pressed", "false")
        assert sound_state(page)["through"] == [[0]]
        layout(page)
        response = page.goto(f"{app_url}/embed/{withdrawn['slug']}")
        assert response and response.status == 410
        see(page, page.get_by_text(WITHDRAWN_COPY, exact=True), WITHDRAWN_COPY)
    has(Api(app_url).get(f"/api/guides/{withdrawn['id']}"), 410, error="withdrawn")


def test_wf_embed_and_sound_desktop(browser: Any, app_url: str) -> None:
    embed_journey(browser, app_url, DESKTOP)


def test_wf_embed_and_sound_phone(browser: Any, app_url: str) -> None:
    embed_journey(browser, app_url, PHONE)


def test_embed_opens_settled(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    slug = world["guides"]["public"]["slug"]
    for n in (3, 4):
        with opened(browser, f"{app_url}/embed/{slug}?step={n}") as page:
            poll(lambda n=n: stage(page).count() > 0 and figure(page, "parts-cost").count() > 0, "embed stage and cost")
            advance(page, SETTLE_MS)
            poll(lambda n=n: hook(page, "step") == str(n), f"embed data-step {n}")
            assert_settled(page, n)
            see(page, figure(page, "parts-cost"), PUBLIC_STEPS[n - 1][6], budget_ms=0)
            see(page, status(page, "Step counter"), f"0{n} / 05", budget_ms=0)
            expect(page.get_by_text(PUBLIC_STEPS[n - 1][7], exact=True)).to_be_visible()
            for name in ("Previous step", "Next step", "Workshop sound"):
                expect(role(page, "button", name)).to_be_visible()
            expect(role(page, "link", "Open on Pennywasher")).to_have_attribute("href", re.compile(rf"/g/{re.escape(slug)}"))
            for name in ("Like", "Fork guide", "Add to collection", "Ask the author", "Save version"):
                expect(role(page, "button", name)).to_have_count(0)
            assert page.get_by_role("textbox").count() == 0, "The embed offers an editable field"


def test_embed_ignores_session(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide, withdrawn = world["guides"]["public"], world["guides"]["withdrawn"]
    url = f"{app_url}/embed/{guide['slug']}?step=3"
    shown: list[str] = []
    for account in (None, world["author"]):
        with opened(browser, f"{app_url}/api/health", account=account) as page:
            responses: list[Any] = []
            page.on("response", lambda response: responses.append(response))
            cookies = page.context.cookies()
            page.goto(url)
            poll(lambda: stage(page).count() > 0 and hook(page, "step") == "3", "embed at step 3", page, budget_ms=SETTLE_MS)
            wait_state(page)
            shown.append(body_text(page))
            assert page.context.cookies() == cookies, "The embed changed the cookies"
            setters = [r.url for r in responses if same_origin(r.url, app_url) and "set-cookie" in r.all_headers()]
            assert setters == [], f"Embed responses set cookies: {setters}"
    assert shown[0] == shown[1], "The embed differs between signed-in and signed-out contexts"
    assert world["author"]["name"] not in shown[1] or world["author"]["name"] in shown[0], "The embed shows the viewer's account name"
    assert world["author"]["email"] not in shown[1]

    def csp(path: str, code: int) -> str:
        reply = httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT)
        assert reply.status_code == code, f"{path} answered {reply.status_code}"
        if path.startswith("/embed/"):
            assert "X-Frame-Options" not in reply.headers, f"{path} carries X-Frame-Options"
        return squeeze(reply.headers.get("content-security-policy")).rstrip(";")

    for path, code in ((f"/embed/{guide['slug']}", 200), (f"/embed/{withdrawn['slug']}", 410), (UNKNOWN_EMBED, 404)):
        assert csp(path, code) == "frame-ancestors *", f"{path} has the wrong framing header"
    for path, code in (("/", 200), ("/search", 200), ("/signin", 200), (f"/g/{guide['slug']}", 200), ("/no-such-page", 404)):
        assert csp(path, code) == "frame-ancestors 'self'", f"{path} has the wrong framing header"


def test_sound_stays_off_until_pressed(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    slug = world["guides"]["public"]["slug"]
    with opened(browser, f"{app_url}/embed/{slug}") as page:
        wait_state(page)
        sound = role(page, "button", "Workshop sound")
        expect(sound).to_have_attribute("aria-pressed", "false")
        advance(page, COUNT_MS)
        click(role(page, "button", "Next step"))
        advance(page, COUNT_MS)
        state = sound_state(page)
        assert (state["contexts"], state["gains"], state["started"]) == (0, 0, 0), f"Audio exists before the first press: {state}"
        click(sound)
        advance(page, SETTLE_MS)
        assert sound_state(page)["started"] == 1
        page.reload()
        wait_state(page)
        expect(sound).to_have_attribute("aria-pressed", "false")
        state = sound_state(page)
        assert (state["contexts"], state["gains"], state["started"]) == (0, 0, 0), "A new page load did not start with sound off"
        page.goto(f"{app_url}/embed/{slug}?sound=off")
        wait_state(page)
        expect(sound).to_have_count(0)
        expect(role(page, "button", "Next step")).to_be_visible()


def test_sound_presses_set_master_gain(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    slug = world["guides"]["public"]["slug"]
    for path in (f"/g/{slug}", f"/embed/{slug}"):
        requests: list[str] = []
        with opened(browser, f"{app_url}{path}", requests=requests) as page:
            wait_state(page)
            sound = role(page, "button", "Workshop sound")
            for pressed, level in (("true", MASTER_GAIN), ("false", 0), ("true", MASTER_GAIN)):
                click(sound)
                advance(page, SETTLE_MS)
                expect(sound).to_have_attribute("aria-pressed", pressed)
                state = sound_state(page)
                assert state["contexts"] == 1 and state["started"] == 1, f"Expected one context and source: {state}"
                assert state["loops"] == [True] and state["generated"] == [True], f"The source is not a looping generated buffer: {state}"
                assert state["through"] == [[level]], f"Master gain should be {level}: {state}"
        audio = [u for u in requests if re.search(r"\.(mp3|ogg|wav|m4a|aac|flac)(\?|$)", u)]
        assert audio == [], f"Sound fetched an audio file: {audio}"


def test_publish_states_reach_embed(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    guide = world["guides"]["draft"]
    author = Api(app_url, world["author"])
    anon = Api(app_url)
    embed, reader = f"/embed/{guide['slug']}", f"/g/{guide['slug']}"
    assert anon.get(embed).status_code == 404 and anon.get(reader).status_code == 404
    assert author.get(embed).status_code == 404, "The embed must answer 404 to the owner of a draft"
    assert anon.get(f"/embed/{world['guides']['private']['slug']}").status_code == 404
    assert anon.get(UNKNOWN_EMBED).status_code == 404
    has(author.post(f"/api/guides/{guide['id']}/withdraw"), 409, error="illegal_transition", to="withdrawn")

    has(Api(app_url, world["coauthor"]).post(f"/api/guides/{guide['id']}/publish"), 403, error="forbidden")
    with opened(browser, f"{app_url}/edit/{guide['slug']}", account=world["author"], live=True) as page:
        ready_editor(page)
        notice = status(page, "Editor status")
        click(role(page, "button", "Publish"))
        see(page, notice, "Published version 1.")
        assert anon.get(embed).status_code == 200 and anon.get(reader).status_code == 200
        has(author.post(f"/api/guides/{guide['id']}/publish"), 409, error="illegal_transition", to="published")
        click(role(page, "button", "Withdraw"))
        see(page, notice, "Withdrawn.")
        for path in (embed, reader):
            assert anon.get(path).status_code == 410 and author.get(path).status_code == 410
        has(author.post(f"/api/guides/{guide['id']}/withdraw"), 409, error="illegal_transition", to="withdrawn")
        has(anon.get(f"/api/guides/{guide['id']}"), 410, error="withdrawn")
        with opened(browser, f"{app_url}{embed}") as outside:
            see(outside, outside.get_by_text(WITHDRAWN_COPY, exact=True), WITHDRAWN_COPY)
            outside.goto(f"{app_url}{reader}")
            see(outside, outside.get_by_text(WITHDRAWN_COPY, exact=True), WITHDRAWN_COPY)
            outside.goto(f"{app_url}{UNKNOWN_EMBED}")
            see(outside, outside.get_by_text(NOT_FOUND_COPY, exact=True), NOT_FOUND_COPY)
        click(role(page, "button", "Publish"))
        see(page, notice, "Published version 1.")
        assert anon.get(embed).status_code == 200, "The embed did not return after publishing again"
    fresh = new_guide(author)
    with opened(browser, f"{app_url}/edit/{fresh['slug']}", account=world["author"], live=True) as page:
        publish = role(page, "button", "Publish")
        poll(lambda: publish.count() > 0, "Publish", page)
        wait_live(page)
        notice = status(page, "Editor status")
        click(publish)
        see(page, notice, "Save a version before publishing.")
        has(author.post(f"/api/guides/{fresh['id']}/publish"), 422, error="no_version")
        has(author.post(f"/api/guides/{fresh['id']}/versions", {"base_version": None}), 201, number=1)
        see_live(status(page, "Latest version"), "Latest version 1")
        click(publish)
        see(page, notice, "Upload a model before publishing.")
        has(author.post(f"/api/guides/{fresh['id']}/publish"), 422, error="model_not_stored")
        has(author.upload(fresh["id"], sample(app_url)), 201)
        has(author.post(f"/api/guides/{fresh['id']}/versions", {"base_version": 1}), 201, number=2)
        see_live(status(page, "Latest version"), "Latest version 2")
        click(publish)
        see(page, notice, "Confirm the model scale before publishing.")
        has(author.post(f"/api/guides/{fresh['id']}/publish"), 422, error="scale_unconfirmed")
    assert author.working(fresh["id"])["state"] == "draft", "A refused publish changed the state"


def test_embed_fits_phone(browser: Any, app_url: str) -> None:
    world = make_world(app_url)
    with opened(browser, f"{app_url}/embed/{world['guides']['public']['slug']}?step=3", viewport=PHONE) as page:
        wait_state(page)
        advance(page, SETTLE_MS * 8)
        layout(page)
        assert page.evaluate("() => document.documentElement.scrollWidth <= window.innerWidth")
        parts = role(page, "list", "Parts")
        expect(parts).to_contain_text("Lower burr")
        expect(parts).to_contain_text("Drive shaft")
        assert len(callouts_of(page)) == 0, "The phone embed shows floating callouts"
        assert undersized(page) == [], f"Embed controls under 44 px: {undersized(page)}"


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
EXTRA_DATASTORES = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "memcached", "amqplib", "bullmq", "kafkajs", "nedb", "lowdb", "level"}


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip(), f"run.json lacks a {key} command"


def test_if_notices_list_packages_and_fonts() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"Shipped packages missing from the notices: {missing}"
    for font in ("Dela Gothic One", "DM Sans"):
        assert font in notices, f"{font} is missing from the notices"


def test_if_licences_allowed() -> None:
    refused = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not refused, f"Licences outside the allowlist: {refused}"


def test_if_only_postgres_and_minio() -> None:
    assert Postgres().tables(), "Postgres holds no tables"
    assert S3().keys("models/"), "MinIO holds no model objects"
    extra = sorted(p.name for p in shipped_packages() if p.name in EXTRA_DATASTORES)
    assert not extra, f"Other datastore clients ship: {extra}"


def test_if_no_third_party_requests(browser: Any, app_url: str) -> None:
    slug = "coffee-grinder-fit-new-burrs"
    for path in ("/", "/search", "/signin", f"/embed/{slug}"):
        requests: list[str] = []
        with opened(browser, f"{app_url}{path}", requests=requests) as page:
            advance(page, SETTLE_MS)
            poll(lambda: role(page, "link", "Pennywasher").count() > 0 or path.startswith("/embed/"), f"{path} rendered", page)
        outside = [u for u in requests if not u.startswith(("data:", "blob:")) and not same_origin(u, app_url)]
        assert not outside, f"{path} requested other origins: {outside}"


def test_if_no_service_worker() -> None:
    skipped = {"node_modules", ".git", "dist", "build"}
    found = []
    for path in APP_DIR.rglob("*"):
        if skipped & set(path.parts) or not path.is_file() or path.suffix not in {".ts", ".tsx", ".js", ".mjs", ".cjs", ".html"}:
            continue
        if "serviceWorker.register" in path.read_text(errors="ignore"):
            found.append(str(path))
    assert not found, f"Service worker registration in: {found}"


def test_if_lockfile_committed() -> None:
    names = ("package-lock.json", "npm-shrinkwrap.json")
    assert any((APP_DIR / name).is_file() for name in names), "No npm lockfile under /app"
