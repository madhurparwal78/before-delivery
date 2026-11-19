from __future__ import annotations

import base64
import calendar
import gzip
import hashlib
import json
import os
import re
import socket
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    capture,
    center,
    click,
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
    style,
    tab_order,
    tap,
    text,
)


WAIT_S = 30
CASE_WAIT_S = 15
STEP_MS = 100
HTTP_TIMEOUT = 60
READ_TIMEOUT_MS = 2000
MAIL_WAIT_S = 45
WS_READ_S = 0.25
TOUCH_STEP_MS = 32
EXPIRY_SLACK_S = 45
RACERS = 6

MOTION_MAX_MS = 250
INSTANT_MS = 1
LIVE_WINDOW_S = 2
SEARCH_WINDOW_S = 2
RECONNECT_MS = 2000
SNAPSHOT_POLL_MS = 60000
JSON_LIMIT = 1000000
SNAPSHOT_LIMIT = 3000000
MIN_PHONE_TARGET = 44
SEPARATOR_DEFAULTS = (20, 50, 50)
PANE_MIN = 10
PANE_MAX = 90
SEPARATOR_STEP = 2
SEPARATOR_BIG_STEP = 10
MAX_INPUT_TABS = 10
PHONE = (375, 812)
TABLET = (768, 1024)
DESKTOP = (1280, 800)
FILE_PREVIEW_SPLIT_S = 3600

CONFIG_DEFAULTS = {
    "autobakeMs": 300,
    "regexBudgetMs": 2000,
    "inputMaxBytes": 2097152,
    "fileMaxBytes": 1048576,
    "outputDisplayBytes": 65536,
    "versionsKept": 20,
    "teamMax": 5,
    "shareTtlChoices": ["1h", "1d", "7d"],
}
TTL_UNITS = {"s": (1, "second"), "m": (60, "minute"), "h": (3600, "hour"), "d": (86400, "day")}

ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "Zlib", "OFL-1.1"}
SERVICE_ENV = [
    "DATABASE_URL", "S3_ENDPOINT", "S3_REGION", "S3_BUCKET", "S3_FORCE_PATH_STYLE", "S3_ACCESS_KEY_ID",
    "S3_SECRET_ACCESS_KEY", "SMTP_HOST", "SMTP_PORT", "MAIL_FROM", "MEILISEARCH_URL", "MEILISEARCH_API_KEY",
]
SECRET_ENV = ["S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "MEILISEARCH_API_KEY", "DATABASE_URL"]
OTHER_STORES = {
    "sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "lokijs",
    "level", "leveldown", "classic-level", "node-persist", "memcached", "mongodb", "mysql", "mysql2",
}
FOREIGN_ORIGIN = "http://elsewhere.test"

FAMILIES = ["Encoding", "Text", "Data formats", "Checksums", "Compression", "Flow"]
DEFAULT_FAVOURITES = ["To Base64", "From Base64", "To Hex", "Gunzip", "JSON Beautify"]
ENCODING_OPS = [
    "From Decimal", "To Decimal", "From Binary", "To Binary", "URL Decode", "URL Encode",
    "From Hexdump", "To Hexdump", "From Hex", "To Hex", "From Base64", "To Base64",
]
FLAG_BOXES = (("Global (g)", "g"), ("Ignore case (i)", "i"), ("Multiline (m)", "m"), ("Dot matches newline (s)", "s"))
STARTER_OPS = ["From Base64", "Gunzip", "JSON Beautify"]
STARTER_JSON = {
    "event": "invoice.paid",
    "invoice": {"id": "inv_1042", "amount": 4200, "currency": "EUR"},
    "items": ["kettle", "cloth"],
}
STARTER_OUTPUT = (
    "{\n"
    '  "event": "invoice.paid",\n'
    '  "invoice": {\n'
    '    "id": "inv_1042",\n'
    '    "amount": 4200,\n'
    '    "currency": "EUR"\n'
    "  },\n"
    '  "items": [\n'
    '    "kettle",\n'
    '    "cloth"\n'
    "  ]\n"
    "}"
)
HEXDUMP_EXAMPLE = (
    "00000000  57 72 69 6e 67 62 65 6e 63 68 20 68 65 78 64 75  |Wringbench hexdu|\n"
    + "00000010  " + "6d 70 0a".ljust(47) + "  |mp.|"
)
LINK_EXAMPLE = "/w#r=W3sib3AiOiJUbyBCYXNlNjQiLCJhcmdzIjp7ImFscGhhYmV0IjoiU3RhbmRhcmQifX1d&i=SGkh"
WRING_EXAMPLE = "wringline 1\n# name: Webhook body\nunb64\ngunzip\nJSON Beautify(indent=4)\nhexify(sep=colon)\n"
WRING_STEPS = [
    {"op": "From Base64", "args": {"alphabet": "Standard", "strict": False}, "disabled": False, "breakpoint": False},
    {"op": "Gunzip", "args": {}, "disabled": False, "breakpoint": False},
    {"op": "JSON Beautify", "args": {"indent": "4"}, "disabled": False, "breakpoint": False},
    {"op": "To Hex", "args": {"delimiter": "Colon"}, "disabled": False, "breakpoint": False},
]
BAKED = re.compile(r"^Baked in \d+ ms$")
STEP_NAME = re.compile(r"^Step \d+: ")


class Opt(str):
    pass


class Prefix(str):
    pass


def base_of(url: str) -> str:
    return url.rstrip("/")


def origin_of(url: str) -> str:
    parts = urlsplit(url)
    return f"{parts.scheme}://{parts.netloc}"


def instance(env: str) -> str:
    url = os.environ.get(env, "")
    assert url, f"{env} names the outage instance of the app"
    return url.rstrip("/")


def tag() -> str:
    return uuid.uuid4().hex[:8]


def call(base: str, method: str, path: str, sid: str | None = None, body: Any = None,
         raw: bytes | None = None, headers: dict[str, str] | None = None) -> httpx.Response:
    sent = dict(headers or {})
    if sid:
        sent["Cookie"] = f"wb_session={sid}"
    if body is not None:
        raw = json.dumps(body).encode()
        sent.setdefault("Content-Type", "application/json")
    return httpx.request(method, base + path, content=raw, headers=sent, timeout=HTTP_TIMEOUT)


def error_of(resp: httpx.Response, status: int, code: str, message: str | None = None) -> dict:
    assert resp.status_code == status, f"expected {status} {code}; got {resp.status_code} {resp.text[:400]}"
    body = resp.json()
    assert isinstance(body, dict) and "error" in body and set(body) <= {"error", "details"}, \
        f"the error body is {{\"error\": …}} plus an optional details object; got {body}"
    err = body["error"]
    assert isinstance(err, dict), f"error is an object; got {body}"
    if "details" in body and "details" not in err:
        err = {**err, "details": body["details"]}
    assert err.get("code") == code, f"expected code {code}; got {err}"
    assert isinstance(err.get("message"), str), f"error message is a string; got {err}"
    if message is not None:
        assert err["message"] == message, f"expected message {message!r}; got {err['message']!r}"
    return err


def config(base: str) -> dict:
    resp = call(base, "GET", "/api/config")
    assert resp.status_code == 200, resp.text
    return resp.json()


def server_now(base: str) -> datetime:
    return parsedate_to_datetime(call(base, "GET", "/api/health").headers["date"]).astimezone(timezone.utc)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc)


def brief_date(value: str) -> str:
    moment = parse_iso(value)
    return f"{moment.day} {calendar.month_name[moment.month]} {moment.year} at {moment:%H:%M} UTC"


def ttl_seconds(choice: str) -> int:
    return int(choice[:-1]) * TTL_UNITS[choice[-1]][0]


def ttl_label(choice: str) -> str:
    count = int(choice[:-1])
    unit = TTL_UNITS[choice[-1]][1]
    return f"{count} {unit}" + ("" if count == 1 else "s")


def b64url(raw: bytes) -> str:
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def b64(raw: bytes) -> str:
    return base64.b64encode(raw).decode()


def person(key: str, t: str) -> dict:
    return {"key": key, "email": f"{key}-{t}@kettle.test", "password": "kettle-pass-01",
            "displayName": f"{key.capitalize()} {t}"}


def seed(base: str, users: list, teams: list = (), recipes: list = (), files: list = (),
         snapshots: list = ()) -> dict:
    resp = call(base, "POST", "/api/grading/seed", body={
        "users": list(users), "teams": list(teams), "recipes": list(recipes),
        "files": list(files), "snapshots": list(snapshots)})
    assert resp.status_code == 201, f"POST /api/grading/seed answers 201; got {resp.status_code} {resp.text[:400]}"
    return resp.json()


def step(op: str, disabled: bool = False, breakpoint: bool = False, **args: Any) -> dict:
    return {"op": op, "args": args, "disabled": disabled, "breakpoint": breakpoint}


def create_recipe(base: str, sid: str, owner: dict, name: str, steps: list, tags: list = (),
                  note: str = "") -> dict:
    resp = call(base, "POST", "/api/recipes", sid, body={
        "name": name, "owner": owner, "tags": list(tags), "note": note, "steps": steps})
    assert resp.status_code == 201, f"POST /api/recipes answers 201; got {resp.status_code} {resp.text[:400]}"
    body = resp.json()
    assert body["version"]["n"] == 1
    return body["recipe"]


def save_version(base: str, sid: str, rid: str, base_version: int, name: str, steps: list,
                 note: str = "", tags: list = ()) -> httpx.Response:
    return call(base, "POST", f"/api/recipes/{rid}/versions", sid, body={
        "baseVersion": base_version, "name": name, "note": note, "tags": list(tags), "steps": steps})


def version_of(base: str, sid: str, rid: str, n: int) -> dict:
    resp = call(base, "GET", f"/api/recipes/{rid}/versions/{n}", sid)
    assert resp.status_code == 200, f"GET version {n} answers 200; got {resp.status_code} {resp.text[:300]}"
    return resp.json()["version"]


def recipes_named(base: str, sid: str, name: str) -> list[dict]:
    resp = call(base, "GET", "/api/recipes", sid)
    assert resp.status_code == 200, resp.text
    return [r for r in resp.json()["recipes"] if r["name"] == name]


def ops_of(steps: list) -> list[str]:
    return [s["op"] for s in steps]


def poll(probe: Callable[[], Any], what: str | Callable[[], str], seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        found = probe()
        if found:
            return found
    pytest.fail(what() if callable(what) else what)


def ws_connect(base: str, sid: str | None = None, origin: str | None = None) -> tuple[int, socket.socket, bytes]:
    parts = urlsplit(base)
    sock = socket.create_connection((parts.hostname, parts.port or 80), timeout=HTTP_TIMEOUT)
    key = base64.b64encode(os.urandom(16)).decode()
    lines = [
        "GET /api/live HTTP/1.1", f"Host: {parts.netloc}", "Upgrade: websocket", "Connection: Upgrade",
        f"Sec-WebSocket-Key: {key}", "Sec-WebSocket-Version: 13", f"Origin: {origin or origin_of(base)}",
    ]
    if sid:
        lines.append(f"Cookie: wb_session={sid}")
    sock.sendall(("\r\n".join(lines) + "\r\n\r\n").encode())
    data = b""
    while b"\r\n\r\n" not in data and len(data) < 65536:
        try:
            chunk = sock.recv(4096)
        except OSError:
            break
        if not chunk:
            break
        data += chunk
    status_line = data.partition(b"\r\n")[0].split()
    status = int(status_line[1]) if len(status_line) > 1 else 0
    return status, sock, data.partition(b"\r\n\r\n")[2]


def ws_messages(sock: socket.socket, pending: bytes, seconds: float) -> list[dict]:
    found: list[dict] = []
    buffer = pending
    deadline = time.monotonic() + seconds
    sock.settimeout(WS_READ_S)
    while time.monotonic() < deadline:
        while len(buffer) >= 2:
            length = buffer[1] & 0x7F
            offset = 2
            if length == 126:
                if len(buffer) < 4:
                    break
                length = int.from_bytes(buffer[2:4], "big")
                offset = 4
            elif length == 127:
                if len(buffer) < 10:
                    break
                length = int.from_bytes(buffer[2:10], "big")
                offset = 10
            if len(buffer) < offset + length:
                break
            opcode = buffer[0] & 0x0F
            payload = buffer[offset:offset + length]
            buffer = buffer[offset + length:]
            if opcode == 1:
                try:
                    found.append(json.loads(payload))
                except ValueError:
                    pass
        try:
            chunk = sock.recv(65536)
        except socket.timeout:
            continue
        except OSError:
            break
        if not chunk:
            break
        buffer += chunk
    return found


@contextmanager
def using(manager: Any) -> Iterator[Any]:
    if hasattr(manager, "__enter__"):
        with manager as value:
            yield value
    else:
        value = next(manager)
        try:
            yield value
        finally:
            manager.close()


@contextmanager
def opened(browser: Browser, url: str, *, width: int = DESKTOP[0], height: int = DESKTOP[1],
           reduced: bool = False, sid: str | None = None) -> Iterator[Page]:
    with using(open_app(browser, url, reduced_motion="reduce" if reduced else "no-preference")) as page:
        page.set_viewport_size({"width": width, "height": height})
        if sid:
            page.context.add_cookies([{"name": "wb_session", "value": sid, "url": origin_of(url) + "/"}])
            page.goto(url)
        yield page


READ = "el => (typeof el.value === 'string' ? el.value : (el.innerText ?? el.textContent ?? ''))"


def read(loc: Locator) -> str:
    try:
        return loc.evaluate(READ, timeout=READ_TIMEOUT_MS)
    except PlaywrightError:
        return ""


def eventually(page: Page, probe: Callable[[], Any], what: str | Callable[[], str], seconds: float = WAIT_S) -> None:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        try:
            if probe():
                return
        except PlaywrightError:
            pass
        advance(page, STEP_MS)
    pytest.fail(what() if callable(what) else what)


def shows(page: Page, loc: Locator, expected: str, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: read(loc).strip() == expected,
               lambda: f"expected {expected!r}; read {read(loc).strip()!r}", seconds)


def contains(page: Page, loc: Locator, expected: str, seconds: float = WAIT_S) -> None:
    eventually(page, lambda: expected in read(loc),
               lambda: f"expected to contain {expected!r}; read {read(loc).strip()!r}", seconds)


def output_box(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Output", exact=True)


def input_box(page: Page) -> Locator:
    return page.get_by_role("textbox", name="Input", exact=True)


def matches_output(actual: str, expected: str) -> bool:
    if isinstance(expected, Prefix):
        return actual.startswith(expected)
    return actual.rstrip("\n") == expected.rstrip("\n")


def output_is(page: Page, expected: str, seconds: float = WAIT_S) -> None:
    out = output_box(page)
    eventually(page, lambda: matches_output(read(out), expected),
               lambda: f"Output reads {expected!r}; got {read(out)!r}", seconds)


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def badge_says(page: Page, loc: Locator, word: str) -> None:
    eventually(page, lambda: word in (loc.evaluate("e => e.textContent || ''") if loc.count() else ""),
               lambda: f"expected to contain {word!r}; read {read(loc).strip()!r}")


def announced(page: Page, message: str) -> None:
    contains(page, status(page, "Workbench announcements"), message)


def button(page: Page | Locator, name: str) -> Locator:
    return page.get_by_role("button", name=name, exact=True)


def ready(page: Page, autobake: bool = False) -> None:
    clear = button(page, "Clear recipe")
    eventually(page, lambda: clear.is_visible(), "the workbench shows Clear recipe in the Recipe title bar")
    box = page.get_by_role("checkbox", name="Auto-bake", exact=True)
    if box.is_checked() != autobake:
        click(box)


def card(page: Page, n: int, op: str) -> Locator:
    return page.get_by_role("list", name="Recipe steps", exact=True).get_by_role(
        "listitem", name=f"Step {n}: {op}", exact=True)


def disable_box(page: Page, n: int) -> Locator:
    return page.get_by_role("checkbox", name=f"Disable step {n}", exact=True)


def step_cards(page: Page) -> Locator:
    return page.get_by_role("list", name="Recipe steps", exact=True).get_by_role("listitem", name=STEP_NAME)


def steps_are(page: Page, ops: list[str]) -> None:
    eventually(page, lambda: step_cards(page).count() == len(ops)
               and all(card(page, i + 1, op).count() == 1 for i, op in enumerate(ops)),
               lambda: f"Recipe steps are {ops}; {step_cards(page).count()} step cards shown")


def clear_recipe(page: Page) -> None:
    click(button(page, "Clear recipe"))
    steps_are(page, [])


def add_op(page: Page, op: str) -> None:
    finder = page.get_by_role("searchbox", name="Find operation", exact=True)
    fill(finder, op)
    option = page.get_by_role("listbox", name="Operations", exact=True).get_by_role("option", name=op, exact=True)
    eventually(page, lambda: option.count() == 1, f"Find operation lists {op}")
    click(option)


def set_arg(step_loc: Locator, label: str, value: Any) -> None:
    if label == "Flags":
        group = step_loc.get_by_role("group", name="Flags", exact=True)
        for name, letter in FLAG_BOXES:
            box = group.get_by_role("checkbox", name=name, exact=True)
            if box.is_checked() != (letter in value):
                click(box)
    elif isinstance(value, bool):
        box = step_loc.get_by_label(label, exact=True)
        if box.is_checked() != value:
            click(box)
    elif isinstance(value, Opt):
        select(step_loc.get_by_label(label, exact=True), str(value))
    else:
        fill(step_loc.get_by_label(label, exact=True), str(value))


def build(page: Page, steps: list, given: str) -> None:
    clear_recipe(page)
    fill(input_box(page), given)
    for i, (op, args) in enumerate(steps, 1):
        add_op(page, op)
        loc = card(page, i, op)
        eventually(page, lambda: loc.count() == 1, f"step {i} is {op}")
        for label, value in args.items():
            set_arg(loc, label, value)


def bake(page: Page) -> None:
    page.keyboard.press("Control+Enter")


def err(n: int, op: str, message: str) -> str:
    return f"Operation {n} ({op}): {message}"


def run_cases(page: Page, cases: list) -> None:
    failures = []
    for case_id, steps, given, expected in cases:
        try:
            build(page, steps, given)
            bake(page)
            output_is(page, expected, seconds=CASE_WAIT_S)
        except pytest.fail.Exception as exc:
            failures.append(f"{case_id}: {exc}")
    assert not failures, "catalogue cases failed:\n" + "\n".join(failures)


def has_text(loc: Locator, value: str) -> bool:
    return loc.get_by_text(value, exact=True).count() > 0


def is_current(loc: Locator) -> bool:
    return loc.evaluate("el => el.getAttribute('aria-current') === 'step' || !!el.querySelector('[aria-current=\"step\"]')")


def select_chars(page: Page, start: int, length: int) -> None:
    box = input_box(page)
    box.focus()
    page.keyboard.press("Control+Home")
    for _ in range(start):
        page.keyboard.press("ArrowRight")
    for _ in range(length):
        page.keyboard.press("Shift+ArrowRight")


def sep_value(loc: Locator, attribute: str = "aria-valuenow") -> int:
    return int(float(loc.get_attribute(attribute)))


def alert_with(page: Page, message: str) -> Locator:
    return page.get_by_role("alert").filter(has_text=message)


def input_alert(page: Page) -> Locator:
    return page.get_by_role("region", name="Input", exact=True).get_by_role("alert")


def gone(page: Page, loc: Locator) -> bool:
    if loc.count() == 0 or not loc.first.is_visible():
        return True
    box = loc.first.bounding_box()
    viewport = page.viewport_size
    return box is None or box["y"] >= viewport["height"] or box["y"] + box["height"] <= 0


def inert_or_hidden(loc: Locator) -> bool:
    if loc.count() == 0:
        return True
    return loc.first.evaluate(
        "el => !!el.closest('[inert]') || el.getClientRects().length === 0 || getComputedStyle(el).visibility === 'hidden'")


def choose_file(page: Page, name: str, data: bytes) -> None:
    with page.expect_file_chooser() as chooser:
        click(button(page, "Open file"))
    chooser.value.set_files(files=[{"name": name, "mimeType": "application/octet-stream", "buffer": data}])


def drop_file(page: Page, name: str, data: bytes) -> None:
    transfer = page.evaluate_handle(
        "([name, bytes]) => { const dt = new DataTransfer(); dt.items.add(new File([new Uint8Array(bytes)], name)); return dt; }",
        [name, list(data)])
    target = input_box(page)
    for event in ("dragenter", "dragover", "drop"):
        target.dispatch_event(event, {"dataTransfer": transfer})


def download_of(page: Page, control: Locator) -> tuple[str, bytes]:
    with page.expect_download() as info:
        click(control)
    download = info.value
    return download.suggested_filename, Path(download.path()).read_bytes()


def size_label(data: bytes) -> str:
    lines = 0 if not data else data.count(b"\n") + 1
    return f"{len(data)} {'byte' if len(data) == 1 else 'bytes'} · {lines} {'line' if lines == 1 else 'lines'}"


RECORDER = """() => {
  if (window.__wbMotion) return;
  window.__wbMotion = [];
  const seen = new WeakSet();
  const note = (target, anim) => {
    const timing = anim.effect && anim.effect.getComputedTiming ? anim.effect.getComputedTiming() : {};
    window.__wbMotion.push({target, duration: Number(timing.duration) || 0});
  };
  const scan = (event) => {
    const el = event.target;
    if (!(el instanceof Element)) return;
    for (const anim of el.getAnimations()) { if (!seen.has(anim)) { seen.add(anim); note(el, anim); } }
  };
  for (const type of ['animationstart', 'transitionrun', 'transitionstart']) document.addEventListener(type, scan, true);
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const anim = original.apply(this, args); seen.add(anim); note(this, anim); return anim; };
}"""
RECORDED = """el => (window.__wbMotion || []).filter(m => m.target === el || el.contains(m.target) || m.target.contains(el)).map(m => m.duration)"""


def recorded(loc: Locator) -> list[float]:
    try:
        return loc.evaluate(RECORDED, timeout=READ_TIMEOUT_MS)
    except PlaywrightError:
        return []


def longest_ms(value: str) -> float:
    longest = 0.0
    for part in value.split(","):
        part = part.strip()
        if part.endswith("ms"):
            longest = max(longest, float(part[:-2]))
        elif part.endswith("s"):
            longest = max(longest, float(part[:-1]) * 1000)
    return longest


def touch_drag(page: Page, start: tuple[float, float], end: tuple[float, float], moves: int = 8) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": start[0], "y": start[1]}]})
    advance(page, TOUCH_STEP_MS)
    for i in range(1, moves + 1):
        x = start[0] + (end[0] - start[0]) * i / moves
        y = start[1] + (end[1] - start[1]) * i / moves
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x, "y": y}]})
        advance(page, TOUCH_STEP_MS)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
    advance(page, TOUCH_STEP_MS)


def small_targets(scope: Page | Locator, roles: tuple[str, ...]) -> list[str]:
    small = []
    for role in roles:
        loc = scope.get_by_role(role)
        for i in range(loc.count()):
            item = loc.nth(i)
            if not item.is_visible():
                continue
            size = item.evaluate(
                "el => { const boxes = [el.getBoundingClientRect(), ...Array.from(el.labels || []).map(l => l.getBoundingClientRect())];"
                " return {w: Math.max(...boxes.map(b => b.width)), h: Math.max(...boxes.map(b => b.height))}; }")
            if size["w"] < MIN_PHONE_TARGET - 0.5 or size["h"] < MIN_PHONE_TARGET - 0.5:
                small.append(f"{role} {item.get_attribute('aria-label') or item.inner_text()[:40]!r}: {size}")
    return small


def mail_to(mail: Any, address: str, subject: str, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        hits = [m for m in mail.messages()
                if address.lower() in [a.lower() for a in addresses(m.get("To"))] and m.get("Subject") == subject]
        if hits:
            return hits
    pytest.fail(f"Mailpit holds an email to {address} with subject {subject!r}")


def mails_for(mail: Any, address: str) -> list[dict]:
    return [m for m in mail.messages() if address.lower() in [a.lower() for a in addresses(m.get("To"))]]


def sign_in_cookie(page: Page, base: str, sid: str) -> None:
    page.context.add_cookies([{"name": "wb_session", "value": sid, "url": base + "/"}])


def test_health_reports_storage(app_url):
    base = base_of(app_url)
    resp = call(base, "GET", "/api/health")
    assert resp.status_code == 200
    assert resp.headers["content-type"].startswith("application/json")
    assert resp.json() == {"status": "ok"}
    down = instance("APP_MINIO_DOWN_URL")
    resp = call(down, "GET", "/api/health")
    assert resp.status_code == 200, f"health never answers another status; got {resp.status_code}"
    assert resp.json() == {"status": "unavailable"}


def test_config_from_env(app_url):
    base = base_of(app_url)
    primary = config(base)
    for key, value in CONFIG_DEFAULTS.items():
        assert primary.get(key) == value, f"/api/config {key} is the default {value}; got {primary.get(key)}"
    short = instance("APP_SHORT_URL")
    limits = config(short)
    for key in ("outputDisplayBytes", "versionsKept", "teamMax", "fileMaxBytes", "inputMaxBytes", "shareTtlChoices"):
        assert limits.get(key) != CONFIG_DEFAULTS[key], f"the short-limits instance publishes its own {key}; got {limits.get(key)}"
    assert limits["autobakeMs"] == CONFIG_DEFAULTS["autobakeMs"]
    t = tag()
    sid = seed(short, [person("ana", t)])["users"]["ana"]["session"]
    cap = limits["fileMaxBytes"]
    ok = call(short, "POST", "/api/files", sid, raw=b"k" * cap,
              headers={"Content-Type": "application/octet-stream", "X-File-Name": f"cap-{t}.bin"})
    assert ok.status_code == 201, f"exactly the configured file cap is accepted; got {ok.status_code} {ok.text[:200]}"
    assert ok.json()["file"]["bytes"] == cap
    over = call(short, "POST", "/api/files", sid, raw=b"k" * (cap + 1),
                headers={"Content-Type": "application/octet-stream", "X-File-Name": f"over-{t}.bin"})
    error_of(over, 413, "file_too_large", f"File too large: {cap + 1} bytes (limit {cap} bytes).")
    bigger = call(base, "POST", "/api/files", seed(base, [person("ana", t)])["users"]["ana"]["session"],
                  raw=b"k" * (cap + 1), headers={"Content-Type": "application/octet-stream", "X-File-Name": f"p-{t}.bin"})
    assert bigger.status_code == 201, "the primary keeps its own larger cap"


def test_grading_routes(app_url):
    base = base_of(app_url)
    t = tag()
    now = server_now(base)
    past = "2020-01-01T00:00:00Z"
    file_bytes = base64.b64decode("YSxiDQoxLDINCg==")
    team_name = f"Kettle Integrations {t}"
    body = seed(
        base,
        users=[person("ana", t), person("bram", t)],
        teams=[{"key": "kettle", "name": team_name, "owner": "ana", "members": ["bram"]}],
        recipes=[{"key": "webhook", "owner": {"team": "kettle"}, "tags": ["webhook"], "versions": [
            {"author": "ana", "name": f"Webhook body {t}", "note": "first cut",
             "steps": [{"op": "From Base64", "args": {"alphabet": "Standard", "strict": False}}, {"op": "Gunzip", "args": {}}]},
            {"author": "bram", "name": f"Webhook body {t}", "note": "second cut", "steps": [{"op": "Gunzip", "args": {}}]},
        ]}],
        files=[{"key": "export", "owner": "ana", "name": "export.csv", "base64": "YSxiDQoxLDINCg=="}],
        snapshots=[
            {"key": "old", "owner": "ana", "recipe": "webhook", "version": 1, "inputBase64": "SGkh",
             "outputBase64": "SGkh", "ttl": "1h", "createdAt": past},
            {"key": "fresh", "owner": "ana", "recipe": "webhook", "version": 2, "fileKey": "export",
             "outputBase64": "SGkh", "ttl": "1d", "createdAt": iso(now)},
        ],
    )
    ana, bram = body["users"]["ana"], body["users"]["bram"]
    me = call(base, "GET", "/api/me", ana["session"])
    assert me.status_code == 200 and me.json()["user"]["displayName"] == f"Ana {t}"
    assert {"id": body["teams"]["kettle"]["id"], "name": team_name, "role": "owner"} in me.json()["teams"]
    roles = {x["name"]: x["role"] for x in call(base, "GET", "/api/me", bram["session"]).json()["teams"]}
    assert roles.get(team_name) == "member"
    signin = call(base, "POST", "/api/auth/signin", body={"email": f"ana-{t}@kettle.test", "password": "kettle-pass-01"})
    assert signin.status_code == 200, "seeded users are already verified"
    rid = body["recipes"]["webhook"]["id"]
    assert body["recipes"]["webhook"]["latestVersion"] == 2
    detail = call(base, "GET", f"/api/recipes/{rid}", bram["session"]).json()
    assert [v["n"] for v in detail["versions"]] == [2, 1]
    assert detail["recipe"]["owner"]["type"] == "team" and detail["recipe"]["owner"]["name"] == team_name
    assert ops_of(version_of(base, bram["session"], rid, 1)["steps"]) == ["From Base64", "Gunzip"]
    assert version_of(base, bram["session"], rid, 2)["author"]["displayName"] == f"Bram {t}"
    fid = body["files"]["export"]["id"]
    got = call(base, "GET", f"/api/files/{fid}", ana["session"])
    assert got.status_code == 200 and got.content == file_bytes
    assert S3().get(f"files/{fid}") == file_bytes
    old = body["snapshots"]["old"]
    assert old["status"] == "expired"
    assert parse_iso(old["expiresAt"]) == parse_iso(past) + timedelta(hours=1)
    snap = call(base, "GET", f"/api/snapshots/{old['token']}").json()["snapshot"]
    assert snap["status"] == "expired" and snap["recipe"] is None
    fresh = body["snapshots"]["fresh"]
    assert fresh["status"] == "active"
    assert S3().get(f"snapshots/{fresh['token']}/input") == file_bytes
    other = instance("APP_MINIO_DOWN_URL")
    osid = seed(other, [person("ana", t + "d")])["users"]["ana"]["session"]
    try:
        flip = call(other, "POST", "/api/grading/outage", body={"service": "meilisearch", "down": True})
        assert flip.status_code == 200 and flip.json() == {"service": "meilisearch", "down": True}
        error_of(call(other, "GET", f"/api/search?q=kettle{t}", osid), 503, "search_unavailable")
    finally:
        back = call(other, "POST", "/api/grading/outage", body={"service": "meilisearch", "down": False})
    assert back.status_code == 200 and back.json() == {"service": "meilisearch", "down": False}
    poll(lambda: call(other, "GET", f"/api/search?q=kettle{t}", osid).status_code == 200,
         "search answers 200 again after the outage route sets down false")


def test_error_precedence(app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(
        base,
        users=[person("ana", t), person("bram", t), person("carol", t)],
        teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]},
               {"key": "other", "name": f"Other {t}", "owner": "carol", "members": []}],
        recipes=[{"key": "mine", "owner": {"user": "ana"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Secret mine {t}", "note": "", "steps": [{"op": "To Hex", "args": {}}]}]},
                 {"key": "shared", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Secret shared {t}", "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}],
    )
    ana = world["users"]["ana"]["session"]
    bram = world["users"]["bram"]["session"]
    carol = world["users"]["carol"]["session"]
    mine = world["recipes"]["mine"]["id"]
    shared = world["recipes"]["shared"]["id"]
    kettle = world["teams"]["kettle"]["id"]
    other = world["teams"]["other"]["id"]
    oversize = b"{" + b" " * JSON_LIMIT + b"}"

    error_of(call(base, "GET", "/api/recipes"), 401, "unauthenticated", "Sign in first.")
    error_of(call(base, "GET", f"/api/recipes/{mine}"), 401, "unauthenticated", "Sign in first.")
    error_of(call(base, "POST", f"/api/recipes/{mine}/versions", raw=oversize,
                  headers={"Content-Type": "application/json"}), 401, "unauthenticated")
    for sid, path in ((bram, f"/api/recipes/{mine}"), (carol, f"/api/recipes/{shared}"),
                      (carol, f"/api/teams/{kettle}"), (carol, f"/api/recipes/{shared}/versions/1"),
                      (ana, f"/api/recipes/r_missing{t}")):
        resp = call(base, "GET", path, sid)
        error_of(resp, 404, "not_found", "Not found.")
        assert f"Secret" not in resp.text
    error_of(call(base, "POST", f"/api/recipes/{shared}/versions", carol, raw=oversize,
                  headers={"Content-Type": "application/json"}), 404, "not_found")
    error_of(call(base, "POST", f"/api/teams/{kettle}/invites", bram, body={"email": f"dan-{t}@kettle.test"}),
             403, "forbidden", "Only the team owner can do this.")
    error_of(call(base, "POST", f"/api/recipes/{mine}/versions", ana, raw=oversize,
                  headers={"Content-Type": "application/json"}), 413, "payload_too_large")
    assert save_version(base, ana, mine, 1, f"Secret mine {t}", [step("MD5")]).status_code == 201
    error_of(save_version(base, ana, mine, 1, f"Secret mine {t}", [step("Rot13")]), 409, "version_conflict")
    bad = error_of(save_version(base, ana, mine, 2, f"Secret mine {t}", [step("Rot13")]), 422,
                   "validation_failed", "Some fields need attention.")
    assert any(key.startswith("steps.0") for key in bad["details"]["fields"]), bad
    long_name = error_of(call(base, "POST", "/api/recipes", ana, body={
        "name": "n" * 81, "owner": {"type": "user", "id": world["users"]["ana"]["id"]}, "tags": [], "note": "",
        "steps": [step("To Hex")]}), 422, "validation_failed")
    assert "name" in long_name["details"]["fields"]
    error_of(call(base, "POST", "/api/recipes", bram, body={
        "name": f"Sneak {t}", "owner": {"type": "team", "id": other}, "tags": [], "note": "",
        "steps": [step("To Hex")]}), 404, "not_found")
    assert recipes_named(base, carol, f"Sneak {t}") == []
    assert call(base, "GET", f"/api/recipes/{mine}", ana).json()["recipe"]["latestVersion"] == 2


def test_server_boundary(app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    owner = {"type": "user", "id": world["users"]["ana"]["id"]}
    resp = call(base, "GET", "/api/health", headers={"Origin": FOREIGN_ORIGIN})
    assert resp.status_code == 200
    error_of(call(base, "POST", "/api/recipes", sid, body={"name": f"Foreign {t}", "owner": owner, "tags": [],
                                                           "note": "", "steps": [step("To Hex")]},
                  headers={"Origin": FOREIGN_ORIGIN}), 403, "forbidden")
    assert recipes_named(base, sid, f"Foreign {t}") == []

    def padded(obj: Any, size: int) -> bytes:
        raw = json.dumps(obj).encode()
        assert len(raw) <= size
        return raw + b" " * (size - len(raw))

    exact = padded({"name": f"Exact {t}", "owner": owner, "tags": [], "note": "", "steps": [step("To Hex")]}, JSON_LIMIT)
    ok = call(base, "POST", "/api/recipes", sid, raw=exact, headers={"Content-Type": "application/json"})
    assert ok.status_code == 201, f"a body of exactly the limit is accepted; got {ok.status_code} {ok.text[:200]}"
    error_of(call(base, "POST", "/api/recipes", sid, raw=exact + b" ", headers={"Content-Type": "application/json"}),
             413, "payload_too_large")
    snap = padded({"steps": [step("To Base64", alphabet="Standard")], "recipe": None, "inputBase64": "SGkh",
                   "outputBase64": "U0draA==", "ttl": "1d"}, SNAPSHOT_LIMIT)
    ok = call(base, "POST", "/api/snapshots", sid, raw=snap, headers={"Content-Type": "application/json"})
    assert ok.status_code == 201, f"a snapshot body of exactly its limit is accepted; got {ok.status_code}"
    error_of(call(base, "POST", "/api/snapshots", sid, raw=snap + b" ", headers={"Content-Type": "application/json"}),
             413, "payload_too_large")
    foreign_status, sock, _ = ws_connect(base, sid, origin=FOREIGN_ORIGIN)
    sock.close()
    status_code, sock, _ = ws_connect(base, sid)
    sock.close()
    assert status_code not in (401, 503), f"a same-origin upgrade with a session succeeds; got {status_code}"
    assert foreign_status != status_code, "a WebSocket upgrade from another origin is refused"
    served = [call(base, "GET", path).text for path in ("/", "/run.json", "/.env", "/package.json")]
    assert all("run-manifest-v1" not in body for body in served), "run.json is never served"
    assets = set(re.findall(r'(?:src|href)="(/[^"]+)"', served[0]))
    served += [call(base, "GET", path).text for path in assets]
    served.append(call(base, "GET", "/api/config").text)
    secrets = [os.environ.get(name, "") for name in SECRET_ENV]
    secrets.append(urlsplit(os.environ.get("DATABASE_URL", "")).password or "")
    for secret in [s for s in secrets if len(s) >= 6]:
        assert all(secret not in body for body in served), "a configured credential appears in a served response"
    for env in ("APP_MINIO_DOWN_URL", "APP_MEILISEARCH_DOWN_URL"):
        resp = call(instance(env), "GET", "/api/config")
        assert resp.status_code == 200, f"{env} serves while a dependency is unreachable"


def test_motion_and_reduced_motion(browser, app_url):
    base = base_of(app_url)
    for reduced in (False, True):
        with opened(browser, base + "/", reduced=reduced) as page:
            ready(page)
            page.evaluate(RECORDER)
            row = page.get_by_role("listbox", name="Encoding", exact=True).get_by_role("option", name="To Hex", exact=True)
            rest, hovered = state_styles(row, "background-color", state="hover")
            assert rest["background-color"] != hovered["background-color"], "operation row deepens on hover"
            hover_ms = longest_ms(style(row, "transition-duration")["transition-duration"])
            text_header = button(page, "Text")
            click(text_header)
            capture(page.get_by_role("region", name="Operations", exact=True))
            listbox = page.get_by_role("listbox", name="Text", exact=True)
            accordion = recorded(listbox) + recorded(text_header)
            add_op(page, "MD5")
            new_card = card(page, 4, "MD5")
            eventually(page, lambda: new_card.count() == 1, "MD5 arrives as step 4")
            capture(new_card)
            if not reduced:
                eventually(page, lambda: capture(new_card) is not None and max(recorded(new_card), default=0) > 0,
                           "a new step card slides in")
            arrival = recorded(new_card)
            fill(page.get_by_role("searchbox", name="Find operation", exact=True), "")
            click(button(page, "Edit favourites"))
            dialog = page.get_by_role("dialog", name="Edit favourites", exact=True)
            eventually(page, lambda: dialog.is_visible(), "Edit favourites opens")
            capture(dialog)
            if not reduced:
                eventually(page, lambda: capture(dialog) is not None and max(recorded(dialog), default=0) > 0,
                           "the dialog fades in")
            entrance = recorded(dialog)
            click(button(dialog, "Done"))
            if reduced:
                assert hover_ms <= INSTANT_MS, f"hover colour changes at once under reduced motion; {hover_ms} ms"
                for label, durations in (("step arrival", arrival), ("dialog", entrance), ("accordion", accordion)):
                    assert max(durations, default=0) <= INSTANT_MS, f"{label} has no motion under reduced motion: {durations}"
            else:
                assert 0 < hover_ms < MOTION_MAX_MS, f"operation row hover transition {hover_ms} ms"
                assert 0 < max(arrival) < MOTION_MAX_MS, f"step arrival durations {arrival}"
                assert 0 < max(entrance) < MOTION_MAX_MS, f"dialog entrance durations {entrance}"
                assert max(accordion, default=0) < MOTION_MAX_MS, f"accordion durations {accordion}"


def test_wf_keyboard_build_starter(browser, app_url):
    base = base_of(app_url)
    for path in ("/", "/w"):
        with opened(browser, base + path) as page:
            ready(page, autobake=True)
            for name in ("Operations", "Recipe", "Input", "Output"):
                expect(page.get_by_role("region", name=name, exact=True)).to_be_visible()
            for name in ("Library", "Import", "Team settings", "Sign in"):
                expect(page.get_by_role("link", name=name, exact=True)).to_be_visible()
            for name in ("Save", "Copy link", "Share snapshot", "Clear recipe"):
                expect(button(page, name)).to_be_visible()
            expect(page.get_by_text("Unsaved recipe", exact=True)).to_be_visible()
            steps_are(page, STARTER_OPS)
            output_is(page, STARTER_OUTPUT)
            typed = read(input_box(page)).strip()
            assert json.loads(gzip.decompress(base64.b64decode(typed))) == STARTER_JSON
            assert page.evaluate("() => document.scrollingElement.scrollHeight <= window.innerHeight + 1")
    with opened(browser, base + "/w") as page:
        ready(page)
        steps_are(page, STARTER_OPS)
        add_op(page, "MD5")
        steps_are(page, STARTER_OPS + ["MD5"])
        page.reload()
        ready(page)
        steps_are(page, STARTER_OPS + ["MD5"])


def test_operation_finder(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        ready(page)
        steps_are(page, STARTER_OPS)
        finder = page.get_by_role("searchbox", name="Find operation", exact=True)
        page.keyboard.press("Escape")
        page.keyboard.press("/")
        expect(finder).to_be_focused()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        advance(page, 500)
        assert step_cards(page).count() == 3, "with no text, ArrowDown and Enter do nothing"
        page.keyboard.type("BASE64")
        flat = page.get_by_role("listbox", name="Operations", exact=True)
        eventually(page, lambda: flat.get_by_role("option").count() == 2, "BASE64 matches two operations")
        for name in ("To Base64", "From Base64"):
            assert flat.get_by_role("option", name=name, exact=True).count() == 1
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        eventually(page, lambda: step_cards(page).count() == 4, "Enter adds the active option")
        first = "To Base64" if card(page, 4, "To Base64").count() == 1 else "From Base64"
        assert card(page, 4, first).count() == 1
        announced(page, f"Added {first} at step 4")
        expect(finder).to_be_focused()
        assert finder.evaluate("el => el.selectionStart === 0 && el.selectionEnd === el.value.length && el.value.length > 0")
        page.keyboard.type("base64")
        eventually(page, lambda: flat.get_by_role("option").count() == 2, "typing replaces the selected text")
        for _ in range(3):
            page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        eventually(page, lambda: step_cards(page).count() == 5, "Enter adds the active option again")
        second = "To Base64" if card(page, 5, "To Base64").count() == 1 else "From Base64"
        steps_are(page, STARTER_OPS + [first, second])
        page.keyboard.type("gunz")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        announced(page, "Added Gunzip at step 6")
        fill(finder, "")
        assert button(page, "Encoding").get_attribute("aria-expanded") == "true"
        for family in FAMILIES[1:]:
            assert button(page, family).get_attribute("aria-expanded") == "false"
        favourites = page.get_by_role("listbox", name="Favourites", exact=True)
        for name in DEFAULT_FAVOURITES:
            assert favourites.get_by_role("option", name=name, exact=True).count() == 1
        assert favourites.get_by_role("option").count() == len(DEFAULT_FAVOURITES)
        click(button(page, "Text"))
        eventually(page, lambda: button(page, "Text").get_attribute("aria-expanded") == "true", "Text opens")
        assert button(page, "Encoding").get_attribute("aria-expanded") == "false"
        expect(favourites).to_be_visible()
        click(page.get_by_role("listbox", name="Text", exact=True).get_by_role("option", name="Reverse", exact=True))
        announced(page, "Added Reverse at step 7")
        click(button(page, "Edit favourites"))
        dialog = page.get_by_role("dialog", name="Edit favourites", exact=True)
        gunzip_box = dialog.get_by_role("checkbox", name="Gunzip", exact=True)
        assert gunzip_box.is_checked(), "default favourites are checked"
        click(gunzip_box)
        click(dialog.get_by_role("checkbox", name="MD5", exact=True))
        click(button(dialog, "Done"))
        eventually(page, lambda: favourites.get_by_role("option", name="MD5", exact=True).count() == 1
                   and favourites.get_by_role("option", name="Gunzip", exact=True).count() == 0,
                   "Favourites follow Edit favourites")
        page.reload()
        ready(page)
        eventually(page, lambda: favourites.get_by_role("option", name="MD5", exact=True).count() == 1,
                   "Favourites are kept in this browser")


def test_wf_keyboard_build_step_keys(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        ready(page)
        steps_are(page, STARTER_OPS)
        card(page, 1, "From Base64").focus()
        page.keyboard.press("Alt+ArrowDown")
        announced(page, "Moved From Base64 to step 2")
        steps_are(page, ["Gunzip", "From Base64", "JSON Beautify"])
        moved = card(page, 2, "From Base64")
        moved.focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 2")
        eventually(page, lambda: disable_box(page, 2).is_checked(), "step 2 is disabled")
        page.keyboard.press("d")
        announced(page, "Enabled step 2")
        page.keyboard.press("b")
        announced(page, "Breakpoint set on step 2")
        toggle = button(page, "Toggle breakpoint on step 2")
        eventually(page, lambda: toggle.get_attribute("aria-pressed") == "true", "breakpoint pressed")
        page.keyboard.press("b")
        announced(page, "Breakpoint cleared on step 2")
        eventually(page, lambda: toggle.get_attribute("aria-pressed") == "false", "breakpoint released")
        page.keyboard.press("ArrowUp")
        expect(card(page, 1, "Gunzip")).to_be_focused()
        add_op(page, "Find and Replace")
        find = card(page, 4, "Find and Replace").get_by_label("Find", exact=True)
        find.focus()
        page.keyboard.type("bd")
        advance(page, 300)
        assert read(find) == "bd"
        assert not disable_box(page, 4).is_checked()
        assert button(page, "Toggle breakpoint on step 4").get_attribute("aria-pressed") == "false"
        card(page, 4, "Find and Replace").focus()
        page.keyboard.press("Delete")
        announced(page, "Removed Find and Replace from step 4")
        expect(card(page, 3, "JSON Beautify")).to_be_focused()
        card(page, 2, "From Base64").focus()
        page.keyboard.press("Delete")
        announced(page, "Removed From Base64 from step 2")
        expect(card(page, 2, "JSON Beautify")).to_be_focused()
        click(button(page, "Remove step 1"))
        announced(page, "Removed Gunzip from step 1")
        steps_are(page, ["JSON Beautify"])
        click(button(page, "Toggle breakpoint on step 1"))
        announced(page, "Breakpoint set on step 1")
        click(disable_box(page, 1))
        announced(page, "Disabled step 1")


def test_wf_keyboard_build_autobake(browser, app_url):
    base = base_of(app_url)
    delay = config(base)["autobakeMs"]
    with opened(browser, base + "/") as page:
        ready(page, autobake=True)
        assert page.get_by_role("checkbox", name="Auto-bake", exact=True).is_checked()
        expect(button(page, "Step")).to_be_visible()
        expect(button(page, "Bake")).to_be_visible()
        clear_recipe(page)
        add_op(page, "To Hex")
        steps_are(page, ["To Hex"])
        url = page.url
        fill(input_box(page), "Hi")
        advance(page, delay - 1)
        assert read(output_box(page)).rstrip("\n") != "48 69", "no bake before the auto-bake delay"
        output_is(page, "48 69")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "Bake status reads Baked in N ms")
        shows(page, status(page, "Output status"), "5 bytes · 1 line")
        announced(page, "Output updated")
        assert page.url == url, "the bake updates in place"
        click(page.get_by_role("checkbox", name="Auto-bake", exact=True))
        fill(input_box(page), "Ho")
        advance(page, delay * 4)
        assert read(output_box(page)).rstrip("\n") == "48 69", "unchecked Auto-bake does not bake on input"
        click(button(page, "Bake"))
        output_is(page, "48 6f")
        fill(input_box(page), "Hz")
        input_box(page).focus()
        bake(page)
        output_is(page, "48 7a")


def test_wf_keyboard_build_journey(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    name = f"Keyboard {t}"
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        auto = page.get_by_role("checkbox", name="Auto-bake", exact=True)
        button(page, "Clear recipe").focus()
        page.keyboard.press("Enter")
        steps_are(page, [])
        announced(page, "Recipe cleared")
        input_box(page).focus()
        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        page.keyboard.type("Hi")
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Input", exact=True)).to_be_focused()
        page.keyboard.press("/")
        for query in ("to base", "find and", "reverse", "md5"):
            page.keyboard.type(query)
            page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
        steps_are(page, ["To Base64", "Find and Replace", "Reverse", "MD5"])
        find = card(page, 2, "Find and Replace").get_by_label("Find", exact=True)
        card(page, 2, "Find and Replace").focus()
        for _ in range(12):
            if find.evaluate("el => el === document.activeElement"):
                break
            page.keyboard.press("Tab")
        assert find.evaluate("el => el === document.activeElement"), "Tab reaches the Find field of step 2"
        page.keyboard.type("=")
        card(page, 3, "Reverse").focus()
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Moved Reverse to step 2")
        card(page, 4, "MD5").focus()
        page.keyboard.press("Delete")
        announced(page, "Removed MD5 from step 4")
        card(page, 2, "Reverse").focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 2")
        card(page, 3, "Find and Replace").focus()
        page.keyboard.press("b")
        announced(page, "Breakpoint set on step 3")
        auto.focus()
        if auto.is_checked():
            page.keyboard.press("Space")
        bake(page)
        shows(page, status(page, "Bake status"), "Paused at step 3")
        announced(page, "Paused at step 3")
        output_is(page, "SGk=")
        expect(button(page, "Resume")).to_be_visible()
        assert has_text(card(page, 3, "Find and Replace"), "Current")
        bake(page)
        output_is(page, "SGk")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "the bake completes")
        page.keyboard.press("F8")
        shows(page, status(page, "Bake status"), "Paused at step 3")
        output_is(page, "SGk=")
        page.keyboard.press("F8")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "F8 completes the bake")
        output_is(page, "SGk")
        first = page.get_by_role("separator", name="Resize Operations and Recipe", exact=True)
        first.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: sep_value(first) == SEPARATOR_DEFAULTS[0] + SEPARATOR_STEP, "ArrowRight moves 2")
        page.keyboard.press("Shift+ArrowRight")
        eventually(page, lambda: sep_value(first) == SEPARATOR_DEFAULTS[0] + SEPARATOR_STEP + SEPARATOR_BIG_STEP, "Shift moves 10")
        page.keyboard.press("Home")
        eventually(page, lambda: sep_value(first) == PANE_MIN, "Home goes to the minimum")
        page.keyboard.press("End")
        eventually(page, lambda: sep_value(first) == SEPARATOR_DEFAULTS[1] - PANE_MIN, "End goes to the maximum")
        button(page, "Save").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
        eventually(page, lambda: dialog.is_visible(), "Save recipe opens")
        dialog.get_by_role("textbox", name="Recipe name", exact=True).focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(name)
        button(dialog, "Save version").focus()
        page.keyboard.press("Enter")
        announced(page, "Recipe saved as version 1")
    hits = recipes_named(base, sid, name)
    assert len(hits) == 1 and hits[0]["latestVersion"] == 1
    saved = version_of(base, sid, hits[0]["id"], 1)["steps"]
    assert ops_of(saved) == ["To Base64", "Reverse", "Find and Replace"]
    assert saved[1]["disabled"] is True and saved[2]["breakpoint"] is True
    assert saved[2]["args"]["find"] == "="


ENCODING_CASES = [
    ("to-base64", [("To Base64", {})], "Hello, world!", "SGVsbG8sIHdvcmxkIQ=="),
    ("to-base64-bytes", [("From Hex", {}), ("To Base64", {})], "fb ff fe 3e 3f", "+//+Pj8="),
    ("from-base64-loose", [("From Base64", {})], "SG k=\n", "Hi"),
    ("to-base64-url-safe", [("From Hex", {}), ("To Base64", {"Alphabet": Opt("URL-safe")})], "fb ff fe 3e 3f", "-__-Pj8"),
    ("from-base64-strict-space", [("From Base64", {"Strict": True})], "SG k=", err(1, "From Base64", "Invalid Base64 character ' ' at position 2")),
    ("from-base64-url-safe", [("From Base64", {"Alphabet": Opt("URL-safe")}), ("To Hex", {})], "-__-Pj8", "fb ff fe 3e 3f"),
    ("from-base64-strict-lf", [("From Base64", {"Strict": True})], "SG\nk=", err(1, "From Base64", "Invalid Base64 character '\\n' at position 2")),
    ("from-base64-padding", [("From Base64", {"Strict": True})], "SGk", err(1, "From Base64", "Base64 padding is missing")),
    ("from-base64-non-ascii", [("From Base64", {})], "é", err(1, "From Base64", "Invalid Base64 character '\\xc3' at position 0")),
    ("from-base64-inner-pad", [("From Base64", {})], "QU=B", err(1, "From Base64", "Invalid Base64 character '=' at position 2")),
    ("from-base64-triple-pad", [("From Base64", {})], "QQ===", err(1, "From Base64", "Invalid Base64 character '=' at position 4")),
    ("from-base64-length", [("From Base64", {})], "Q", err(1, "From Base64", "Base64 length is invalid")),
    ("to-hex-space", [("To Hex", {})], "Hi!\n", "48 69 21 0a"),
    ("to-hex-colon", [("To Hex", {"Delimiter": Opt("Colon")})], "Hi!\n", "48:69:21:0a"),
    ("from-hex", [("From Hex", {})], "48:69,21\n0A", "Hi!"),
    ("from-hex-digit", [("From Hex", {})], "48 6G", err(1, "From Hex", "Invalid hex digit 'G' at position 4")),
    ("from-hex-odd", [("From Hex", {})], "486", err(1, "From Hex", "Odd number of hex digits")),
    ("to-hexdump", [("To Hexdump", {})], "Wringbench hexdump\n", HEXDUMP_EXAMPLE),
    ("from-hexdump", [("From Hexdump", {})], HEXDUMP_EXAMPLE, "Wringbench hexdump"),
    ("from-hexdump-digit", [("From Hexdump", {})], "00000000  4g 69  |Hi|", err(1, "From Hexdump", "Invalid hexdump line 1")),
    ("url-encode", [("URL Encode", {})], "a b&c=d/é~", "a%20b%26c%3Dd%2F%C3%A9~"),
    ("from-hexdump-unclosed", [("From Hexdump", {})], "00000000  48 69  |Hi", err(1, "From Hexdump", "Invalid hexdump line 1")),
    ("url-encode-keep-reserved", [("URL Encode", {"Encode all reserved": False})], "a b&c=d/é~", "a%20b&c=d/%C3%A9~"),
    ("url-decode", [("URL Decode", {})], "a%2fb+c%C3%A9", "a/b+cé"),
    ("url-decode-error", [("URL Decode", {})], "ab%2", err(1, "URL Decode", "Invalid percent sequence at position 2")),
    ("to-binary", [("To Binary", {})], "Hi", "01001000 01101001"),
    ("from-binary", [("From Binary", {})], "01001000,01101001", "Hi"),
    ("from-binary-digit", [("From Binary", {})], "01002", err(1, "From Binary", "Invalid binary digit '2' at position 4")),
    ("to-decimal", [("To Decimal", {})], "Hi", "72 105"),
    ("from-binary-count", [("From Binary", {})], "0100100", err(1, "From Binary", "Bit count is not a multiple of 8")),
    ("from-decimal", [("From Decimal", {})], "72,105", "Hi"),
    ("from-decimal-range", [("From Decimal", {})], "72 256", err(1, "From Decimal", "Value 256 is not a byte")),
]


def test_wf_exact_encodings_catalogue(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        run_cases(page, ENCODING_CASES)


def test_wf_exact_encodings_separators(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        first = page.get_by_role("separator", name="Resize Operations and Recipe", exact=True)
        second = page.get_by_role("separator", name="Resize Recipe and Editors", exact=True)
        third = page.get_by_role("separator", name="Resize Input and Output", exact=True)
        assert (sep_value(first), sep_value(second), sep_value(third)) == SEPARATOR_DEFAULTS
        assert (sep_value(first, "aria-valuemin"), sep_value(first, "aria-valuemax")) == (PANE_MIN, SEPARATOR_DEFAULTS[1] - PANE_MIN)
        assert (sep_value(second, "aria-valuemin"), sep_value(second, "aria-valuemax")) == (SEPARATOR_DEFAULTS[0] + PANE_MIN, PANE_MAX)
        assert (sep_value(third, "aria-valuemin"), sep_value(third, "aria-valuemax")) == (PANE_MIN, PANE_MAX)
        assert first.get_attribute("aria-orientation") == "vertical" and third.get_attribute("aria-orientation") == "horizontal"
        first.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: sep_value(first) == SEPARATOR_DEFAULTS[0] + SEPARATOR_STEP, "ArrowRight moves 2")
        page.keyboard.press("Shift+ArrowLeft")
        eventually(page, lambda: sep_value(first) == SEPARATOR_DEFAULTS[0] + SEPARATOR_STEP - SEPARATOR_BIG_STEP, "Shift+ArrowLeft moves 10")
        page.keyboard.press("End")
        eventually(page, lambda: sep_value(first) == SEPARATOR_DEFAULTS[1] - PANE_MIN, "End reaches second minus 10")
        eventually(page, lambda: sep_value(second, "aria-valuemin") == sep_value(first) + PANE_MIN, "second minimum follows first")
        second.focus()
        page.keyboard.press("Home")
        eventually(page, lambda: sep_value(second) == sep_value(first) + PANE_MIN, "Home reaches first plus 10")
        page.keyboard.press("End")
        eventually(page, lambda: sep_value(second) == PANE_MAX, "End reaches 90")
        eventually(page, lambda: sep_value(first, "aria-valuemax") == PANE_MAX - PANE_MIN, "first maximum follows second")
        third.focus()
        page.keyboard.press("ArrowDown")
        eventually(page, lambda: abs(sep_value(third) - SEPARATOR_DEFAULTS[2]) == SEPARATOR_STEP, "ArrowDown moves 2")
        page.keyboard.press("Home")
        eventually(page, lambda: sep_value(third) == PANE_MIN, "Home reaches 10")
        x, y = center(first)
        page.mouse.dblclick(x, y)
        eventually(page, lambda: (sep_value(first), sep_value(second), sep_value(third)) == SEPARATOR_DEFAULTS,
                   "double-click restores 20, 50 and 50")
        x, y = center(first)
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(DESKTOP[0] * 0.3, y, steps=6)
        page.mouse.up()
        eventually(page, lambda: abs(sep_value(first) - 30) <= 1, "dragging resizes to the pointer")
        width = page.get_by_role("region", name="Operations", exact=True).bounding_box()["width"]
        assert abs(width / DESKTOP[0] - sep_value(first) / 100) <= 0.03, "the Operations pane follows the separator"
        finder = page.get_by_role("searchbox", name="Find operation", exact=True)
        page.keyboard.press("Escape")
        page.keyboard.press("/")
        expect(finder).to_be_focused()
        expected = [{"Edit favourites"}, {"Favourites", *DEFAULT_FAVOURITES}, {"Encoding"}, {"Encoding", *ENCODING_OPS},
                    {"Text"}, {"Data formats"}, {"Checksums"}, {"Compression"}, {"Flow"}, {"Resize Operations and Recipe"}]
        names = tab_order(page, len(expected))
        assert all(name in allowed for name, allowed in zip(names, expected)), f"Tab order on first load: {names}"
        fill(finder, "hex")
        finder.focus()
        names = tab_order(page, 2)
        assert names[0] in {"Operations", "From Hexdump", "To Hexdump", "From Hex", "To Hex"}, names
        assert names[1] == "Resize Operations and Recipe", names
        input_box(page).focus()
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Input", exact=True)).to_be_focused()
        finder.focus()
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Operations", exact=True)).to_be_focused()
        fill(finder, "")
        click(button(page, "Edit favourites"))
        dialog = page.get_by_role("dialog", name="Edit favourites", exact=True)
        eventually(page, lambda: dialog.is_visible(), "Edit favourites opens")
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(page, dialog), "Escape closes the dialog")
        expect(button(page, "Edit favourites")).to_be_focused()


def test_wf_text_bytes_input_encoding(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        ready(page)
        build(page, [("To Hex", {})], "aé€😀")
        shows(page, status(page, "Input status"), "10 bytes · 1 line")
        bake(page)
        output_is(page, "61 c3 a9 e2 82 ac f0 9f 98 80")
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "ISO-8859-1")
        contains(page, input_alert(page), "Character U+20AC cannot be encoded in ISO-8859-1")
        shows(page, status(page, "Input status"), "Not encodable")
        bake(page)
        advance(page, 1000)
        assert read(output_box(page)).rstrip("\n") == "61 c3 a9 e2 82 ac f0 9f 98 80", "no bake while the encoding error stands"
        fill(input_box(page), "aé")
        shows(page, status(page, "Input status"), "2 bytes · 1 line")
        bake(page)
        output_is(page, "61 e9")
        fill(input_box(page), "😀")
        contains(page, input_alert(page), "Character U+1F600 cannot be encoded in ISO-8859-1")
        fill(input_box(page), "aé")
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "UTF-16LE")
        shows(page, status(page, "Input status"), "4 bytes · 1 line")
        bake(page)
        output_is(page, "61 00 e9 00")
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "UTF-8")
        for given, expected in (("a\n", "2 bytes · 2 lines"), ("", "0 bytes · 0 lines"), ("x", "1 byte · 1 line")):
            fill(input_box(page), given)
            shows(page, status(page, "Input status"), expected)
    cr_recipe = b64url(b'[{"op":"To Hex","args":{"delimiter":"Space"}}]')
    for raw, expected in ((b"a\r\n\xff", "4 bytes · 2 lines"), (b"a\r\xff", "3 bytes · 1 line")):
        with opened(browser, f"{base}/w#r={cr_recipe}&i={b64url(raw)}") as page:
            ready(page)
            shows(page, status(page, "Input status"), expected)
    short = instance("APP_SHORT_URL")
    cap = config(short)["inputMaxBytes"]
    with opened(browser, short + "/") as page:
        ready(page)
        fill(input_box(page), "x" * cap)
        shows(page, status(page, "Input status"), f"{cap} bytes · 1 line")
        fill(input_box(page), "x" * (cap + 1))
        contains(page, input_alert(page), f"Input too large: {cap + 1} bytes (limit {cap} bytes).")
        eventually(page, lambda: len(read(input_box(page))) == cap, "the input stays as it was")
        shows(page, status(page, "Input status"), f"{cap} bytes · 1 line")


def test_wf_text_bytes_output_view(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        ready(page)
        build(page, [("From Hex", {})], "61 ff 62")
        bake(page)
        output_is(page, "61 ff 62")
        expect(page.get_by_text("Output is not valid UTF-8; showing hex.", exact=True)).to_be_visible()
        name, data = download_of(page, button(page, "Download output"))
        assert (name, data) == ("output.bin", b"a\xffb")
        build(page, [("From Hex", {})], "48 69")
        bake(page)
        output_is(page, "Hi")
        select(page.get_by_role("combobox", name="Output view", exact=True), "Hex")
        output_is(page, "48 69")
        select(page.get_by_role("combobox", name="Output view", exact=True), "Text")
        output_is(page, "Hi")
    short = instance("APP_SHORT_URL")
    cap = config(short)["outputDisplayBytes"]
    full = ("é" * cap).encode()
    with opened(browser, short + "/") as page:
        ready(page)
        build(page, [("Change Case", {"Case": Opt("Lower")})], "é" * cap)
        bake(page)
        output_is(page, full[:cap].decode("utf-8", "ignore"))
        expect(page.get_by_text(f"Showing the first {cap} of {len(full)} bytes. Download output for all of it.",
                                exact=True)).to_be_visible()
        name, data = download_of(page, button(page, "Download output"))
        assert (name, data) == ("output.txt", full)
        select(page.get_by_role("combobox", name="Output view", exact=True), "Hex")
        eventually(page, lambda: read(output_box(page)).split() == [f"{b:02x}" for b in full[:cap]],
                   "Hex view shows the first cap bytes")


TEXT_CASES = [
    ("encode-iso", [("Encode Text", {"Encoding": Opt("ISO-8859-1")})], "é", "e9"),
    ("encode-iso-error", [("Encode Text", {"Encoding": Opt("ISO-8859-1")})], "€", err(1, "Encode Text", "Character U+20AC cannot be encoded in ISO-8859-1")),
    ("decode-iso", [("From Hex", {}), ("Decode Text", {"Encoding": Opt("ISO-8859-1")})], "e9", "é"),
    ("decode-utf16-odd", [("From Hex", {}), ("Decode Text", {"Encoding": Opt("UTF-16LE")})], "61", err(2, "Decode Text", "UTF-16LE input has an odd number of bytes")),
    ("decode-utf16", [("From Hex", {}), ("Decode Text", {"Encoding": Opt("UTF-16LE")})], "68 00 69 00", "hi"),
    ("change-case-upper", [("Change Case", {"Case": Opt("Upper")})], "Straße", "STRASSE"),
    ("change-case-lower", [("Change Case", {"Case": Opt("Lower")})], "ÀB", "àb"),
    ("reverse-character", [("Reverse", {"By": Opt("Character")})], "a😀b", "b😀a"),
    ("reverse-line", [("Reverse", {"By": Opt("Line")}), ("To Hex", {})], "a\nb\nc\n", "63 0a 62 0a 61 0a"),
    ("remove-whitespace", [("Remove Whitespace", {})], "a b\tc\r\nd", "abcd"),
    ("remove-spaces-only", [("Remove Whitespace", {"Tabs": False, "Line breaks": False}), ("To Hex", {})], "a b\tc", "61 62 09 63"),
    ("normalize-lf", [("Normalize Line Endings", {"To": Opt("LF")}), ("To Hex", {})], "a\r\nb\rc", "61 0a 62 0a 63"),
    ("normalize-crlf", [("Normalize Line Endings", {"To": Opt("CRLF")}), ("To Hex", {})], "a\nb", "61 0d 0a 62"),
    ("sort-alpha", [("Sort Lines", {})], "pear\napple\nFig\n", "Fig\napple\npear\n"),
    ("sort-ignore-case", [("Sort Lines", {"Order": Opt("Alphabetical, ignore case")})], "pear\napple\nFig\n", "apple\nFig\npear\n"),
    ("sort-numeric", [("Sort Lines", {"Order": Opt("Numeric")})], "10\n9\n-2\nx\n", "-2\n9\n10\nx\n"),
    ("sort-numeric-reverse", [("Sort Lines", {"Order": Opt("Numeric"), "Reverse": True})], "10\n9\n-2\nx\n", "x\n10\n9\n-2\n"),
    ("sort-unique-ignore-case", [("Sort Lines", {"Order": Opt("Alphabetical, ignore case"), "Unique": True})], "b\nA\na\n", "A\nb\n"),
    ("unique-lines", [("Unique Lines", {})], "b\na\nb", "b\na"),
    ("json-beautify", [("JSON Beautify", {})], '{"a": 1.50, "b": [1]}', '{\n  "a": 1.5,\n  "b": [\n    1\n  ]\n}'),
    ("json-beautify-tab", [("JSON Beautify", {"Indent": Opt("Tab")})], '{"a":1}', '{\n\t"a": 1\n}'),
    ("json-beautify-error", [("JSON Beautify", {})], '{"a":}', err(1, "JSON Beautify", "Invalid JSON at line 1 column 6")),
    ("json-minify", [("JSON Minify", {})], '{"a": 1.50, "b": "\\u00e9"}', '{"a":1.5,"b":"é"}'),
    ("json-minify-number", [("JSON Minify", {})], "[12345678901234567890]", "[12345678901234567000]"),
    ("csv-to-json", [("CSV to JSON", {})], 'name,qty\n"Kettle, copper",2\n', '[\n  {\n    "name": "Kettle, copper",\n    "qty": "2"\n  }\n]'),
    ("csv-no-header", [("CSV to JSON", {"First row is header": False})], "a,b\r\n1,2", '[\n  [\n    "a",\n    "b"\n  ],\n  [\n    "1",\n    "2"\n  ]\n]'),
    ("csv-header-only", [("CSV to JSON", {})], "a,b\n", "[]"),
    ("csv-tab-delimiter", [("CSV to JSON", {"Delimiter": "\\t"})], "a\tb\n1\t2", '[\n  {\n    "a": "1",\n    "b": "2"\n  }\n]'),
    ("csv-unclosed", [("CSV to JSON", {})], 'a,b\n"x,1\n', err(1, "CSV to JSON", "Unclosed quote at line 2")),
    ("csv-row-count", [("CSV to JSON", {})], 'a,b\n"x\ny",1\n2\n', err(1, "CSV to JSON", "Row 3 has 1 fields; expected 2")),
    ("csv-duplicate", [("CSV to JSON", {})], "a,a\n1,2\n", err(1, "CSV to JSON", "Duplicate header 'a' at column 2")),
    ("json-to-csv", [("JSON to CSV", {})], '[{"a":"x,y","b":1,"d":{"k":[1]}},{"a":null,"c":true,"b":"q\\"r"}]', 'a,b,d\n"x,y",1,"{""k"":[1]}"\n,"q""r",'),
    ("json-to-csv-error", [("JSON to CSV", {})], '{"a":1}', err(1, "JSON to CSV", "JSON to CSV needs an array of objects")),
    ("md5", [("MD5", {})], "abc", "900150983cd24fb0d6963f7d28e17f72"),
    ("sha-1", [("SHA-1", {})], "abc", "a9993e364706816aba3e25717850c26c9cd0d89d"),
    ("sha-256", [("SHA-256", {})], "abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"),
    ("crc32", [("CRC32", {})], "abc", "352441c2"),
    ("text-invalid-utf8", [("From Hex", {}), ("Reverse", {})], "ff", err(2, "Reverse", "Input is not valid UTF-8 text")),
]


def test_wf_text_bytes_operations(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        run_cases(page, TEXT_CASES)


def test_wf_breakpoints_pause_resume(browser, app_url):
    base = base_of(app_url)
    t = tag()
    sid = seed(base, [person("ana", t)])["users"]["ana"]["session"]
    name = f"Breaks {t}"
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        build(page, [("To Hex", {}), ("Reverse", {}), ("To Base64", {})], "Hi")
        click(button(page, "Toggle breakpoint on step 3"))
        click(button(page, "Bake"))
        shows(page, status(page, "Bake status"), "Paused at step 3")
        announced(page, "Paused at step 3")
        output_is(page, "96 84")
        expect(button(page, "Resume")).to_be_visible()
        assert button(page, "Bake").count() == 0
        assert has_text(card(page, 3, "To Base64"), "Current") and is_current(card(page, 3, "To Base64"))
        click(button(page, "Resume"))
        output_is(page, "OTYgODQ=")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "Resume completes")
        click(button(page, "Toggle breakpoint on step 1"))
        click(button(page, "Bake"))
        shows(page, status(page, "Bake status"), "Paused at step 1")
        output_is(page, "Hi")
        click(button(page, "Toggle breakpoint on step 1"))
        click(button(page, "Toggle breakpoint on step 3"))
        click(button(page, "Step"))
        shows(page, status(page, "Bake status"), "Paused at step 2")
        output_is(page, "48 69")
        assert has_text(card(page, 2, "Reverse"), "Current")
        page.keyboard.press("F8")
        shows(page, status(page, "Bake status"), "Paused at step 3")
        output_is(page, "96 84")
        page.keyboard.press("F8")
        output_is(page, "OTYgODQ=")
        marks = page.get_by_text("Current", exact=True)
        eventually(page, lambda: not any(marks.nth(i).is_visible() for i in range(marks.count())),
                   "no step stays Current once the pause ends")
        click(disable_box(page, 2))
        page.keyboard.press("F8")
        shows(page, status(page, "Bake status"), "Paused at step 3")
        output_is(page, "48 69")
        assert not has_text(card(page, 2, "Reverse"), "Current")
        page.keyboard.press("F8")
        output_is(page, "NDggNjk=")
        click(button(page, "Toggle breakpoint on step 3"))
        click(button(page, "Save"))
        dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
        fill(dialog.get_by_role("textbox", name="Recipe name", exact=True), name)
        click(button(dialog, "Save version"))
        announced(page, "Recipe saved as version 1")
    saved = version_of(base, sid, recipes_named(base, sid, name)[0]["id"], 1)["steps"]
    assert [s["breakpoint"] for s in saved] == [False, False, True] and saved[1]["disabled"] is True


def test_wf_breakpoints_reduced_motion_lamp(browser, app_url):
    with opened(browser, base_of(app_url) + "/", reduced=True) as page:
        ready(page)
        build(page, [("To Hex", {}), ("Reverse", {}), ("To Base64", {})], "Hi")
        page.evaluate(RECORDER)
        click(button(page, "Step"))
        two = card(page, 2, "Reverse")
        eventually(page, lambda: has_text(two, "Current"), "the lamp is on step 2")
        capture(two)
        page.keyboard.press("F8")
        three = card(page, 3, "To Base64")
        eventually(page, lambda: has_text(three, "Current") and not has_text(two, "Current"), "the lamp moves to step 3")
        capture(three)
        for loc in (two, three):
            assert max(recorded(loc), default=0) <= INSTANT_MS, f"lamp motion under reduced motion: {recorded(loc)}"
            assert longest_ms(style(loc, "transition-duration")["transition-duration"]) <= INSTANT_MS


REGEX_CASES = [
    ("replace-example", [("Find and Replace", {"Find": r"(\w+)@(\w+)", "Replace": "$2 at $1"})], "ana@home bo@work", "home at ana work at bo"),
    ("replace-first-only", [("Find and Replace", {"Find": "a", "Replace": "b", "Flags": ""})], "aa", "ba"),
    ("replace-ignore-case", [("Find and Replace", {"Find": "A", "Replace": "x", "Flags": "gi"})], "aAb", "xxb"),
    ("replace-multiline", [("Find and Replace", {"Find": "^b", "Replace": "x", "Flags": "gm"})], "a\nb", "a\nx"),
    ("replace-dotall", [("Find and Replace", {"Find": "a.b", "Replace": "x", "Flags": "gs"})], "a\nb", "x"),
    ("replace-tokens", [("Find and Replace", {"Find": "b", "Replace": "[$&$$]"})], "abc", "a[b$]c"),
    ("replace-named", [("Find and Replace", {"Find": "(?<x>b)", "Replace": "$<x>$<x>"})], "abc", "abbc"),
    ("replace-empty-find", [("Find and Replace", {"Replace": "z"})], "xyz", "xyz"),
    ("extract", [("Extract Matches", {"Find": r"\d+"})], "a1b22c333", "1\n22\n333"),
    ("extract-ignore-case", [("Extract Matches", {"Find": "[a-c]", "Flags": "gi"})], "AbZ", "A\nb"),
    ("extract-none", [("Extract Matches", {"Find": r"\d"}), ("To Hex", {})], "xyz", ""),
    ("invalid", [("Find and Replace", {"Find": "("})], "abc", Prefix(err(1, "Find and Replace", "Invalid regular expression: "))),
]


def test_wf_regex_budget_operations(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        run_cases(page, REGEX_CASES)


def test_wf_regex_budget_watchdog(browser, app_url):
    base = base_of(app_url)
    budget = config(base)["regexBudgetMs"]
    with opened(browser, base + "/") as page:
        ready(page)
        build(page, [("Find and Replace", {"Find": "(a+)+$", "Replace": "x"})], "a" * 40 + "!")
        bake(page)
        advance(page, budget - STEP_MS)
        assert "Stopped after" not in read(output_box(page)), "the watchdog does not fire before the budget"
        output_is(page, err(1, "Find and Replace", f"Stopped after {budget} ms"))
        shows(page, status(page, "Bake status"), "Stopped at step 1")
        assert has_text(card(page, 1, "Find and Replace"), "Error")
        fill(card(page, 1, "Find and Replace").get_by_label("Find", exact=True), "a+")
        bake(page)
        output_is(page, "x!")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "the next bake completes")


def test_wf_regex_budget_change_cancels_runaway(browser, app_url):
    base = base_of(app_url)
    budget = config(base)["regexBudgetMs"]
    with opened(browser, base + "/") as page:
        ready(page)
        build(page, [("Find and Replace", {"Find": "(a+)+$", "Replace": "x"})], "a" * 40 + "!")
        bake(page)
        advance(page, budget // 4)
        assert "Stopped after" not in read(output_box(page)), "the bake is still running before the budget"
        fill(card(page, 1, "Find and Replace").get_by_label("Find", exact=True), "a+")
        bake(page)
        output_is(page, "x!")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "the next bake completes")


def test_wf_keyboard_build_shortcut_in_finder(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        ready(page)
        build(page, [("To Hex", {})], "Hi")
        finder = page.get_by_role("searchbox", name="Find operation", exact=True)
        click(finder)
        page.keyboard.press("Control+a")
        page.keyboard.type("md5")
        flat = page.get_by_role("listbox", name="Operations", exact=True)
        eventually(page, lambda: flat.get_by_role("option", name="MD5", exact=True).count() == 1, "Find operation lists MD5")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Control+Enter")
        output_is(page, "48 69")
        steps_are(page, ["To Hex"])
        fill(input_box(page), "Ho")
        fill(finder, "")
        favourites = page.get_by_role("listbox", name="Favourites", exact=True)
        favourites.focus()
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Control+Enter")
        output_is(page, "48 6f")
        steps_are(page, ["To Hex"])


def test_wf_regex_budget_operation_error(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Base64", {}), ("From Base64", {}), ("To Hex", {})], "!!")
        click(disable_box(page, 1))
        bake(page)
        output_is(page, err(2, "From Base64", "Invalid Base64 character '!' at position 0"))
        assert has_text(card(page, 2, "From Base64"), "Error")
        shows(page, status(page, "Bake status"), "Stopped at step 2")
        shows(page, status(page, "Output status"), "No output")


FORK_CASES = [
    ("example", [("Fork", {}), ("From Base64", {}), ("Merge", {})], "aGk=\nb2s=", "hi\nok"),
    ("branch-error", [("Fork", {}), ("From Base64", {}), ("Merge", {})], "aGk=\nb2s=\n!!", "Operation 2 (From Base64) in branch 3: Invalid Base64 character '!' at position 0"),
    ("joiner", [("Fork", {}), ("To Hex", {}), ("Merge", {"Joiner": ", "})], "a\nb\n", "61, 62"),
    ("tab-split", [("Fork", {"Split delimiter": "\\t"}), ("Change Case", {}), ("Merge", {"Joiner": "-"})], "a\tb", "A-B"),
    ("no-merge", [("Fork", {}), ("Change Case", {})], "a\nb", "A\nB"),
    ("merge-alone", [("Merge", {})], "x", err(1, "Merge", "Merge has no matching Fork")),
]


def test_wf_fork_merge_branches(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        run_cases(page, FORK_CASES)


def test_wf_fork_merge_teammate(browser, app_url):
    base = base_of(app_url)
    t = tag()
    fork = [{"op": "Fork", "args": {}}, {"op": "From Base64", "args": {}}, {"op": "Merge", "args": {}}]
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "fork", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Fork {t}", "note": "first cut", "steps": fork}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["fork"]["id"]
    url = f"{base}/w?recipe={rid}&version=1"
    with opened(browser, url, sid=ana) as one, opened(browser, url, sid=bram) as two:
        for page in (one, two):
            ready(page)
            steps_are(page, ["Fork", "From Base64", "Merge"])
        for given, expected in (("aGk=\nb2s=", "hi\nok"),
                                ("aGk=\nb2s=\n!!", "Operation 2 (From Base64) in branch 3: Invalid Base64 character '!' at position 0")):
            for page in (one, two):
                fill(input_box(page), given)
                bake(page)
                output_is(page, expected)
            assert read(output_box(one)) == read(output_box(two))
        resp = save_version(base, ana, rid, 1, f"Fork {t}", [step("Fork"), step("From Base64"), step("Merge"), step("Change Case")])
        assert resp.status_code == 201
        two.goto(f"{base}/w?recipe={rid}")
        ready(two)
        steps_are(two, ["Fork", "From Base64", "Merge", "Change Case"])
        fill(input_box(two), "aGk=\nb2s=")
        bake(two)
        output_is(two, "HI\nOK")
    detail = call(base, "GET", f"/api/recipes/{rid}", bram).json()
    assert [v["n"] for v in detail["versions"]] == [2, 1]
    assert ops_of(version_of(base, bram, rid, 1)["steps"]) == ["Fork", "From Base64", "Merge"]


def test_wf_files_store(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    data = b"id,note\r\n1,caf\xe9\r\n"
    name = f"export-{t}.csv"
    store = S3()
    before = set(store.keys("files/"))
    with opened(browser, base + "/") as page:
        ready(page)
        click(button(page, "Open file"))
        eventually(page, lambda: alert_with(page, "Sign in to save recipes, open files or share snapshots.").count() > 0,
                   "signed-out visitors see the sign-in alert")
    with opened(browser, base + "/", sid=ana) as page:
        ready(page)
        clear_recipe(page)
        fill(input_box(page), "typed")
        shows(page, status(page, "Input status"), size_label(b"typed"))
        with using(held(page, "**/api/files")) as gate:
            choose_file(page, name, data)
            contains(page, input_alert(page), f"Uploading {name}…")
            assert read(status(page, "Input status")).strip() == size_label(b"typed"), "the file is not the input before the 201"
            gate.release()
        shows(page, status(page, "Input status"), size_label(data))
        expect(input_box(page)).not_to_be_editable()
        bake(page)
        output_is(page, " ".join(f"{b:02x}" for b in data))
        click(button(page, "Clear input"))
        shows(page, status(page, "Input status"), "0 bytes · 0 lines")
        expect(input_box(page)).to_be_editable()
    stored = [k for k in store.keys("files/") if k not in before and store.get(k) == data]
    assert len(stored) == 1, "MinIO holds the dropped bytes exactly"
    fid = stored[0].split("/", 1)[1]
    got = call(base, "GET", f"/api/files/{fid}", ana)
    assert got.status_code == 200 and got.content == data
    error_of(call(base, "GET", f"/api/files/{fid}", bram), 404, "not_found")
    short = instance("APP_SHORT_URL")
    cap = config(short)["fileMaxBytes"]
    ssid = seed(short, [person("ana", t)])["users"]["ana"]["session"]
    with opened(browser, short + "/", sid=ssid) as page:
        ready(page)
        uploads: list[str] = []
        page.on("request", lambda r: uploads.append(r.url) if "/api/files" in r.url else None)
        choose_file(page, f"big-{t}.bin", b"z" * (cap + 1))
        contains(page, input_alert(page), f"File too large: {cap + 1} bytes (limit {cap} bytes).")
        assert uploads == [], "a file over the cap is refused before any upload"
    down = instance("APP_MINIO_DOWN_URL")
    dsid = seed(down, [person("ana", t + "d")])["users"]["ana"]["session"]
    error_of(call(down, "POST", "/api/files", dsid, raw=data,
                  headers={"Content-Type": "application/octet-stream", "X-File-Name": name}),
             503, "storage_unavailable", "Storage is unavailable. The file was not saved.")
    with opened(browser, down + "/", sid=dsid) as page:
        ready(page)
        fill(input_box(page), "kept")
        choose_file(page, name, data)
        contains(page, input_alert(page), "Storage is unavailable. The file was not saved.")
        shows(page, status(page, "Input status"), "4 bytes · 1 line")
    assert [k for k in store.keys("files/") if k not in before and k != stored[0] and store.get(k) == data] == []


def test_wf_files_gzip(browser, app_url):
    base = base_of(app_url)
    t = tag()
    sid = seed(base, [person("ana", t)])["users"]["ana"]["session"]
    raw = json.dumps(STARTER_JSON).encode()
    packed = gzip.compress(raw)
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        clear_recipe(page)
        drop_file(page, f"export-{t}.json.gz", packed)
        shows(page, status(page, "Input status"), size_label(packed))
        add_op(page, "Gunzip")
        bake(page)
        output_is(page, raw.decode())
        name, data = download_of(page, button(page, "Download output"))
        assert (name, data) == ("output.txt", raw)
        click(button(page, "Clear input"))
        for steps, expected in (([("Gzip", {}), ("To Hex", {})], Prefix("1f 8b")),
                                ([("Gzip", {"Level": 9}), ("Gunzip", {})], "kettle"),
                                ([("Gunzip", {})], err(1, "Gunzip", "Not gzip data"))):
            build(page, steps, "kettle")
            bake(page)
            output_is(page, expected)
        build(page, [("From Hex", {}), ("Gunzip", {})], "1f 8b 00 01")
        bake(page)
        output_is(page, err(2, "Gunzip", "Gzip data is damaged"))


def test_wf_files_suggestion(browser, app_url):
    base = base_of(app_url)
    suggested = re.compile(r"^Suggested: ")
    with opened(browser, base + "/") as page:
        ready(page)
        clear_recipe(page)
        for given, op in (("48 65 6c 6c", "From Hex"), ("48:65,6c\n6c", "From Hex"), ("deadbeef", "From Hex"),
                          ("SGVsbG8h", "From Base64"), ('{"a": [1]}', "JSON Beautify"), ("a%2Fb", "URL Decode"),
                          ("48 65 6c", None), ("SGk=", None), ("{not json", None), ("100%", None)):
            fill(input_box(page), given)
            if op:
                eventually(page, lambda: button(page, f"Suggested: {op}").count() == 1, f"{given!r} suggests {op}")
            else:
                advance(page, 1000)
                assert page.get_by_role("button", name=suggested).count() == 0, f"{given!r} suggests nothing"
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "ISO-8859-1")
        fill(input_box(page), "\x1f\x8bxyz")
        eventually(page, lambda: button(page, "Suggested: Gunzip").count() == 1, "1f 8b suggests Gunzip")
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "UTF-8")
        fill(input_box(page), "a%20b")
        eventually(page, lambda: button(page, "Suggested: URL Decode").count() == 1, "a%20b suggests URL Decode")
        click(button(page, "Suggested: URL Decode"))
        steps_are(page, ["URL Decode"])
        announced(page, "Added URL Decode at step 1")
        bake(page)
        output_is(page, "a b")


def test_wf_span_carry_example(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Hex", {}), ("To Base64", {})], "Hello")
        bake(page)
        output_is(page, "NDggNjUgNmMgNmMgNmY=")
        select_chars(page, 1, 3)
        eventually(page, lambda: has_text(card(page, 1, "To Hex"), "output 3–10")
                   and has_text(card(page, 2, "To Base64"), "output 4–15"), "chips show output 3–10 and 4–15")
        announced(page, "Span maps to characters 4 to 15 at step 2")
        shows(page, status(page, "Output status"), "20 bytes · 1 line · Selection maps to characters 4–15")
        add_op(page, "Reverse")
        bake(page)
        output_is(page, "=YmNgMmNgMmNgUjNggDN")
        select_chars(page, 1, 3)
        eventually(page, lambda: has_text(card(page, 3, "Reverse"), "span lost"), "Reverse loses the span")
        announced(page, "Span lost at step 3")
        shows(page, status(page, "Output status"), "20 bytes · 1 line")
        click(disable_box(page, 3))
        add_op(page, "Change Case")
        bake(page)
        output_is(page, "NDGGNJUGNMMGNMMGNMY=")
        select_chars(page, 1, 3)
        eventually(page, lambda: has_text(card(page, 4, "Change Case"), "output 4–15"), "Change Case carries the span")
        assert not has_text(card(page, 3, "Reverse"), "span lost")
        announced(page, "Span maps to characters 4 to 15 at step 4")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: not has_text(card(page, 1, "To Hex"), "output 3–10"), "an empty selection clears the chips")


def test_wf_span_carry_input_tabs(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Hex", {})], "Hello")
        bake(page)
        output_is(page, "48 65 6c 6c 6f")
        click(button(page, "New input"))
        tab2 = page.get_by_role("tab", name=f"Input {1 + 1}", exact=True)
        eventually(page, lambda: tab2.get_attribute("aria-selected") == "true", "New input selects Input 2")
        assert read(input_box(page)) == ""
        fill(input_box(page), "é")
        bake(page)
        output_is(page, "c3 a9")
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "ISO-8859-1")
        bake(page)
        output_is(page, "e9")
        select_chars(page, 0, 1)
        eventually(page, lambda: has_text(card(page, 1, "To Hex"), "output 0–1"), "tab 2 selection maps")
        click(page.get_by_role("tab", name="Input 1", exact=True))
        output_is(page, "48 65 6c 6c 6f")
        assert read(input_box(page)) == "Hello"
        select_chars(page, 1, 3)
        eventually(page, lambda: has_text(card(page, 1, "To Hex"), "output 3–10"), "tab 1 selection maps")
        tab1 = page.get_by_role("tab", name="Input 1", exact=True)
        tab1.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: tab2.get_attribute("aria-selected") == "true", "ArrowRight selects Input 2")
        output_is(page, "e9")
        eventually(page, lambda: has_text(card(page, 1, "To Hex"), "output 0–1"), "Input 2 keeps its selection")
        page.keyboard.press("ArrowLeft")
        output_is(page, "48 65 6c 6c 6f")
        eventually(page, lambda: has_text(card(page, 1, "To Hex"), "output 3–10"), "Input 1 keeps its selection")
        page.keyboard.press("Control+Alt+n")
        tab3 = page.get_by_role("tab", name=f"Input {1 + 2}", exact=True)
        eventually(page, lambda: tab3.get_attribute("aria-selected") == "true", "Ctrl+Alt+N adds and selects Input 3")
        for _ in range(MAX_INPUT_TABS):
            if button(page, "New input").is_disabled():
                break
            click(button(page, "New input"))
        tabs = page.get_by_role("tablist", name="Inputs", exact=True).get_by_role("tab")
        assert tabs.count() == MAX_INPUT_TABS
        expect(page.get_by_role("tab", name=f"Input {MAX_INPUT_TABS}", exact=True)).to_be_visible()
        expect(button(page, "New input")).to_be_disabled()


def test_wf_share_recipe_link(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin_of(base))
        ready(page)
        build(page, [("To Base64", {})], "Hi!")
        click(button(page, "Copy link"))
        link = page.get_by_role("textbox", name="Recipe link", exact=True)
        eventually(page, lambda: read(link).endswith(LINK_EXAMPLE), lambda: f"Recipe link {read(link)!r}")
        announced(page, "Link copied")
        assert page.evaluate("() => navigator.clipboard.readText()").endswith(LINK_EXAMPLE)
    with opened(browser, base + LINK_EXAMPLE) as page:
        ready(page)
        steps_are(page, ["To Base64"])
        assert read(input_box(page)) == "Hi!"
        output_is(page, "SGkh")
    rot = b64url(b'[{"op":"Rot13","args":{}}]')
    hex_recipe = b64url(b'[{"op":"To Hex","args":{"delimiter":"Space"}}]')
    for path, message in ((f"/w#r=%%%%&i=SGkh", "This link is damaged: the recipe part is not valid."),
                          (f"/w#r={rot}&i=SGkh", "This link is damaged: the recipe part is not valid."),
                          (f"/w#r={hex_recipe}&i=@@", "This link is damaged: the input part is not valid.")):
        with opened(browser, base + path) as page:
            eventually(page, lambda: alert_with(page, message).count() > 0, f"{path} shows {message!r}")
            steps_are(page, [])
            assert read(input_box(page)) == ""
    with opened(browser, f"{base}/w#r={hex_recipe}&i=_w") as page:
        ready(page)
        output_is(page, "ff")
        expect(input_box(page)).not_to_be_editable()


def test_wf_share_snapshot_lifecycle(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t)])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    choices = config(base)["shareTtlChoices"]
    day = next(c for c in choices if ttl_seconds(c) == TTL_UNITS["d"][0])
    with opened(browser, base + "/", sid=ana) as page:
        ready(page)
        build(page, [("To Base64", {})], "Hi")
        bake(page)
        output_is(page, "SGk=")
        click(button(page, "Share snapshot"))
        dialog = page.get_by_role("dialog", name="Share snapshot", exact=True)
        group = dialog.get_by_role("radiogroup", name="Expires after", exact=True)
        for choice in choices:
            assert group.get_by_role("radio", name=ttl_label(choice), exact=True).count() == 1
        click(group.get_by_role("radio", name=ttl_label(day), exact=True))
        click(button(dialog, "Create snapshot"))
        link = dialog.get_by_role("textbox", name="Snapshot link", exact=True)
        eventually(page, lambda: "/s/" in read(link), "the dialog shows the Snapshot link once Active")
        token = read(link).rsplit("/s/", 1)[1].strip()
        snap = call(base, "GET", f"/api/snapshots/{token}").json()["snapshot"]
        assert snap["status"] == "active" and snap["url"] == f"/s/{token}"
        assert parse_iso(snap["expiresAt"]) - parse_iso(snap["createdAt"]) == timedelta(seconds=ttl_seconds(day))
        contains(page, dialog.get_by_role("status", name="Snapshot status", exact=True), f"Active until {brief_date(snap['expiresAt'])}.")
    assert S3().get(f"snapshots/{token}/input") == b"Hi" and S3().get(f"snapshots/{token}/output") == b"SGk="
    error_of(call(base, "POST", "/api/snapshots", ana, body={"steps": [], "recipe": None, "inputBase64": "SGk=",
                                                             "outputBase64": "SGk=", "ttl": "2w"}), 422, "validation_failed")
    error_of(call(base, "DELETE", f"/api/snapshots/{token}", bram), 404, "not_found")
    assert call(base, "DELETE", f"/api/snapshots/{token}", ana).status_code == 204
    snap = call(base, "GET", f"/api/snapshots/{token}").json()["snapshot"]
    assert snap["status"] == "revoked" and snap["recipe"] is None
    error_of(call(base, "GET", f"/api/snapshots/{token}/input"), 409, "snapshot_revoked", "This snapshot was revoked.")
    with opened(browser, f"{base}/s/{token}") as page:
        badge_says(page, status(page, "Snapshot status"), "Revoked")
        contains(page, status(page, "Snapshot status"), "This snapshot was revoked.")
    down = instance("APP_MINIO_DOWN_URL")
    dsid = seed(down, [person("ana", t + "d")])["users"]["ana"]["session"]
    resp = call(down, "POST", "/api/snapshots", dsid, body={"steps": [step("To Base64", alphabet="Standard")], "recipe": None,
                                                            "inputBase64": "SGk=", "outputBase64": "U0drPQ==", "ttl": day})
    assert resp.status_code == 201 and resp.json()["snapshot"]["status"] == "pending"
    pending = resp.json()["snapshot"]["token"]
    error_of(call(down, "GET", f"/api/snapshots/{pending}/input"), 409, "snapshot_pending",
             "This snapshot is waiting for storage to confirm its input.")
    assert S3().keys(f"snapshots/{pending}/") == []
    with opened(browser, down + "/", sid=dsid) as page:
        ready(page)
        build(page, [("To Base64", {})], "Hi")
        click(button(page, "Share snapshot"))
        dialog = page.get_by_role("dialog", name="Share snapshot", exact=True)
        click(dialog.get_by_role("radio", name=ttl_label(day), exact=True))
        click(button(dialog, "Create snapshot"))
        snap_status = dialog.get_by_role("status", name="Snapshot status", exact=True)
        contains(page, snap_status, "Pending: storage has not confirmed the input yet.")
        link_box = dialog.get_by_role("textbox", name="Snapshot link", exact=True)
        before = snap_status.text_content() or ""
        shown = link_box.count()
        after = snap_status.text_content() or ""
        if "Pending" in before and "Pending" in after:
            assert shown == 0, "no Snapshot link while the snapshot reads Pending"


@pytest.mark.timeout(900)
def test_wf_share_server_clock(browser, app_url):
    short = instance("APP_SHORT_URL")
    t = tag()
    sid = seed(short, [person("ana", t)])["users"]["ana"]["session"]
    choice = min(config(short)["shareTtlChoices"], key=ttl_seconds)
    assert ttl_seconds(choice) <= 60, f"the short-limits instance offers a ttl of a minute or less; got {choice}"
    resp = call(short, "POST", "/api/snapshots", sid, body={"steps": [step("To Base64", alphabet="Standard")], "recipe": None,
                                                            "inputBase64": "SGk=", "outputBase64": "U0drPQ==", "ttl": choice})
    assert resp.status_code == 201
    token = resp.json()["snapshot"]["token"]
    created = parse_iso(resp.json()["snapshot"]["createdAt"])
    poll(lambda: call(short, "GET", f"/api/snapshots/{token}").json()["snapshot"]["status"] == "active",
         "the snapshot becomes active once storage confirms")
    with opened(browser, short + "/") as ahead:
        ahead.clock.set_system_time(created + timedelta(days=1))
        ahead.goto(f"{short}/s/{token}")
        badge_says(ahead, status(ahead, "Snapshot status"), "Active")
        assert "Expired" not in status(ahead, "Snapshot status").evaluate("e => e.textContent || ''"), \
            "a device clock past expiry never decides"
        deadline = time.monotonic() + ttl_seconds(choice) + EXPIRY_SLACK_S
        snap = {}
        while time.monotonic() < deadline:
            snap = call(short, "GET", f"/api/snapshots/{token}").json()["snapshot"]
            if snap["status"] == "expired":
                break
            advance(ahead, STEP_MS)
        else:
            pytest.fail("GET /api/snapshots/:token reads expired after the ttl by the server clock")
        assert snap["recipe"] is None
        message = f"This snapshot expired on {brief_date(snap['expiresAt'])}."
        error_of(call(short, "GET", f"/api/snapshots/{token}/output"), 409, "snapshot_expired", message)
        advance(ahead, SNAPSHOT_POLL_MS)
        contains(ahead, status(ahead, "Snapshot status"), message)
    with opened(browser, short + "/") as behind:
        behind.clock.set_system_time(created - timedelta(days=1))
        behind.goto(f"{short}/s/{token}")
        badge_says(behind, status(behind, "Snapshot status"), "Expired")
        contains(behind, status(behind, "Snapshot status"), message)


def test_wf_share_byte_exact(browser, app_url):
    base = base_of(app_url)
    t = tag()
    data = b"a,b\r\n\xff1\r\n"
    world = seed(base, [person("ana", t)],
                 recipes=[{"key": "r", "owner": {"user": "ana"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Raw {t}", "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}],
                 snapshots=[{"key": "old", "owner": "ana", "recipe": "r", "version": 1, "inputBase64": b64(data),
                             "outputBase64": b64(data), "ttl": "1h", "createdAt": "2020-01-01T00:00:00Z"}])
    sid = world["users"]["ana"]["session"]
    old = world["snapshots"]["old"]
    error_of(call(base, "GET", f"/api/snapshots/{old['token']}/output"), 409, "snapshot_expired",
             f"This snapshot expired on {brief_date(old['expiresAt'])}.")
    day = next(c for c in config(base)["shareTtlChoices"] if ttl_seconds(c) == TTL_UNITS["d"][0])
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        clear_recipe(page)
        choose_file(page, f"raw-{t}.csv", data)
        shows(page, status(page, "Input status"), size_label(data))
        bake(page)
        click(button(page, "Share snapshot"))
        dialog = page.get_by_role("dialog", name="Share snapshot", exact=True)
        click(dialog.get_by_role("radio", name=ttl_label(day), exact=True))
        click(button(dialog, "Create snapshot"))
        link = dialog.get_by_role("textbox", name="Snapshot link", exact=True)
        eventually(page, lambda: "/s/" in read(link), "the snapshot becomes Active with its link")
        token = read(link).rsplit("/s/", 1)[1].strip()
    with opened(browser, f"{base}/s/{token}") as page:
        expect(page.get_by_role("heading", name="Shared snapshot", exact=True)).to_be_visible()
        badge_says(page, status(page, "Snapshot status"), "Active")
        _, got = download_of(page, button(page, "Download input"))
        assert got == data
        _, got = download_of(page, button(page, "Download output"))
        assert got == data
    resp = call(base, "GET", f"/api/snapshots/{token}/input")
    assert resp.status_code == 200 and resp.content == data
    assert 'filename="input.bin"' in resp.headers["content-disposition"]
    assert resp.headers["content-disposition"].startswith("attachment")
    assert "output.bin" in call(base, "GET", f"/api/snapshots/{token}/output").headers["content-disposition"]
    assert S3().get(f"snapshots/{token}/input") == data


def test_wf_versions_retention(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    name, renamed = f"Kettle check {t}", f"Kettle renamed {t}"
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        click(button(page, "Save"))
        dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
        fill(dialog.get_by_role("textbox", name="Recipe name", exact=True), name)
        fill(dialog.get_by_role("textbox", name="Version note", exact=True), "first cut")
        fill(dialog.get_by_role("textbox", name="Tags", exact=True), " kettle , json,")
        select(dialog.get_by_role("combobox", name="Save to", exact=True), "Personal")
        click(button(dialog, "Save version"))
        announced(page, "Recipe saved as version 1")
        expect(page.get_by_text(f"{name} · version 1", exact=True)).to_be_visible()
        add_op(page, "MD5")
        expect(page.get_by_text(f"{name} · version 1 · edited", exact=True)).to_be_visible()
        click(button(page, "Save"))
        dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
        eventually(page, lambda: dialog.is_visible(), "Save recipe opens again")
        assert dialog.get_by_role("combobox", name="Save to", exact=True).count() == 0
        fill(dialog.get_by_role("textbox", name="Recipe name", exact=True), renamed)
        click(button(dialog, "Save version"))
        announced(page, "Recipe saved as version 2")
        page.goto(base + "/library")
        row = page.get_by_role("list", name="Recipes", exact=True).get_by_role("listitem", name=renamed, exact=True)
        eventually(page, lambda: row.count() == 1 and "version 2" in read(row), "Library shows the renamed recipe at version 2")
    rid = recipes_named(base, sid, renamed)[0]["id"]
    one = version_of(base, sid, rid, 1)
    assert one["name"] == name and one["tags"] == ["kettle", "json"] and one["note"] == "first cut"
    assert ops_of(one["steps"]) == STARTER_OPS
    assert ops_of(version_of(base, sid, rid, 2)["steps"]) == STARTER_OPS + ["MD5"]
    stale = error_of(save_version(base, sid, rid, 1, renamed, [step("MD5")]), 409, "version_conflict",
                     f"Version 2 was saved by Ana {t} while you were editing.")
    assert stale["details"] == {"latestVersion": 2, "authorName": f"Ana {t}"}
    bad = error_of(save_version(base, sid, rid, 2, renamed, [step("MD5")], tags=["Bad Tag"]), 422, "validation_failed")
    assert bad["details"]["fields"]["tags"] == "Tags need 1 to 30 lowercase letters, digits or hyphens each, 10 at most."
    assert call(base, "GET", f"/api/recipes/{rid}", sid).json()["recipe"]["latestVersion"] == 2
    short = instance("APP_SHORT_URL")
    kept = config(short)["versionsKept"]
    sworld = seed(short, [person("ana", t)])
    ssid = sworld["users"]["ana"]["session"]
    srid = create_recipe(short, ssid, {"type": "user", "id": sworld["users"]["ana"]["id"]}, name, [step("MD5")])["id"]
    latest = 1
    for _ in range(kept + 1):
        resp = save_version(short, ssid, srid, latest, name, [step("MD5"), step("To Hex")], note=f"after {latest}")
        assert resp.status_code == 201 and resp.json()["version"]["n"] == latest + 1
        latest += 1
    listed = [v["n"] for v in call(short, "GET", f"/api/recipes/{srid}", ssid).json()["versions"]]
    assert listed == list(range(latest, latest - kept, -1))
    error_of(call(short, "GET", f"/api/recipes/{srid}/versions/1", ssid), 404, "not_found")


def test_wf_versions_compare(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    owner = {"type": "user", "id": world["users"]["ana"]["id"]}
    name = f"Compare {t}"
    rid = create_recipe(base, sid, owner, name, [step("To Base64"), step("To Hex", delimiter="Space"), step("SHA-256")])["id"]
    assert save_version(base, sid, rid, 1, name, [step("SHA-256"), step("To Base64"), step("To Hex", delimiter="Colon")]).status_code == 201
    expected = ["Moved SHA-256 from step 3 to step 1", "Changed To Hex at step 3: Delimiter from Space to Colon"]
    assert call(base, "GET", f"/api/recipes/{rid}/compare?from=1&to=2", sid).json()["changes"] == expected
    with opened(browser, f"{base}/library/{rid}", sid=sid) as page:
        expect(page.get_by_role("heading", name=name, level=1)).to_be_visible()
        versions = page.get_by_role("list", name="Versions", exact=True)
        for n in (2, 1):
            expect(versions.get_by_role("listitem", name=f"Version {n}", exact=True)).to_be_visible()
        click(button(page, "Compare versions"))
        dialog = page.get_by_role("dialog", name="Compare versions", exact=True)
        items = dialog.get_by_role("list", name="Changes", exact=True).get_by_role("listitem")
        eventually(page, lambda: [read(items.nth(i)).strip() for i in range(items.count())] == expected,
                   "Compare versions defaults to the two newest versions")
        click(button(dialog, "Close"))
    renamed = f"Compare renamed {t}"
    third = [step("SHA-256", disabled=True), step("To Hex", delimiter="Colon"), step("MD5")]
    assert save_version(base, sid, rid, 2, renamed, third).status_code == 201
    assert call(base, "GET", f"/api/recipes/{rid}/compare?from=2&to=3", sid).json()["changes"] == [
        f"Renamed from {name} to {renamed}", "Removed To Base64 from step 2", "Disabled SHA-256 at step 1", "Added MD5 at step 3"]
    assert save_version(base, sid, rid, 3, renamed, third[:2] + [step("MD5", breakpoint=True)]).status_code == 201
    assert call(base, "GET", f"/api/recipes/{rid}/compare?from=3&to=4", sid).json()["changes"] == []
    with opened(browser, f"{base}/library/{rid}", sid=sid) as page:
        click(button(page, "Compare versions"))
        dialog = page.get_by_role("dialog", name="Compare versions", exact=True)
        eventually(page, lambda: dialog.get_by_text("These versions have the same steps.", exact=True).count() > 0,
                   "no change lines read These versions have the same steps.")
    other = create_recipe(base, sid, owner, f"Strict {t}", [step("From Base64", strict=False)])["id"]
    assert save_version(base, sid, other, 1, f"Strict {t}", [step("From Base64", strict=True)]).status_code == 201
    assert call(base, "GET", f"/api/recipes/{other}/compare?from=1&to=2", sid).json()["changes"] == [
        "Changed From Base64 at step 1: Strict from off to on"]
    error_of(call(base, "GET", f"/api/recipes/{rid}/compare?from=99&to=4", sid), 404, "not_found")


def test_wf_versions_restore(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    first = [step("To Hex", disabled=True, delimiter="Colon"), step("MD5", breakpoint=True)]
    rid = create_recipe(base, sid, {"type": "user", "id": world["users"]["ana"]["id"]}, f"Alpha {t}", first, tags=["alpha"])["id"]
    assert save_version(base, sid, rid, 1, f"Beta {t}", [step("Gunzip")], tags=["beta"]).status_code == 201
    assert save_version(base, sid, rid, 2, f"Gamma {t}", [step("SHA-1")]).status_code == 201
    with opened(browser, f"{base}/library/{rid}", sid=sid) as page:
        restore1 = button(page, "Restore version 1")
        eventually(page, lambda: restore1.is_visible(), "history lists Restore version 1")
        assert button(page, "Restore version 3").count() == 0
        click(restore1)
        dialog = page.get_by_role("dialog", name="Restore version", exact=True)
        expect(dialog.get_by_text(f"Restore version {1} as a new version?", exact=True)).to_be_visible()
        click(button(dialog, "Restore"))
        shows(page, status(page, "Library announcements"), "Restored version 1 as version 4")
    detail = call(base, "GET", f"/api/recipes/{rid}", sid).json()
    assert [v["n"] for v in detail["versions"]] == [4, 3, 2, 1]
    one, four = version_of(base, sid, rid, 1), version_of(base, sid, rid, 4)
    assert four["steps"] == one["steps"]
    assert (four["name"], four["tags"], four["note"]) == (f"Alpha {t}", ["alpha"], "Restored from version 1")
    error_of(call(base, "POST", f"/api/recipes/{rid}/restore", sid, body={"version": 2, "baseVersion": 3}), 409, "version_conflict")
    error_of(call(base, "POST", f"/api/recipes/{rid}/restore", sid, body={"version": 99, "baseVersion": 4}), 404, "not_found")
    assert call(base, "GET", f"/api/recipes/{rid}", sid).json()["recipe"]["latestVersion"] == 4


def test_wf_versions_import(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    owner = {"type": "user", "id": world["users"]["ana"]["id"]}
    bad_text = WRING_EXAMPLE.replace("gunzip", "rot13").replace("hexify(sep=colon)", "hexify(case=upper)")
    with opened(browser, base + "/import", sid=sid) as page:
        expect(page.get_by_role("heading", name="Import recipes", exact=True)).to_be_visible()
        report = page.get_by_role("region", name="Import report", exact=True)
        fill(page.get_by_role("textbox", name="Wring Line text", exact=True), WRING_EXAMPLE)
        select(page.get_by_role("combobox", name="Save to", exact=True), "Personal")
        click(button(page, "Import"))
        contains(page, report, "Created Webhook body (version 1) from 4 lines.")
        expect(report.get_by_role("link", name="Open in workbench", exact=True)).to_be_visible()
        click(button(page, "Import"))
        contains(page, report, "Already imported as Webhook body (version 1). Nothing was created.")
        fill(page.get_by_role("textbox", name="Wring Line text", exact=True), bad_text)
        click(button(page, "Import"))
        contains(page, report, "2 lines did not match. Nothing was created.")
        contains(page, report, "Line 4: unknown operation 'rot13'")
        contains(page, report, "Line 6: unknown argument 'case' for To Hex")
    hits = recipes_named(base, sid, "Webhook body")
    assert len(hits) == 1, "the re-import and the rejected import created nothing"
    assert version_of(base, sid, hits[0]["id"], 1)["steps"] == WRING_STEPS
    resp = call(base, "POST", "/api/imports", sid, body={"text": "wring 1\nb64\n", "owner": owner})
    rejected = error_of(resp, 422, "import_unmatched", "1 line did not match. Nothing was created.")
    assert rejected["details"]["lines"] == ["Line 1: expected 'wringline 1'"]
    resp = call(base, "POST", "/api/imports", sid, body={"text": "wringline 1\nTo Base64(alphabet=klingon)\n", "owner": owner})
    assert error_of(resp, 422, "import_unmatched")["details"]["lines"] == ["Line 2: invalid value 'klingon' for Alphabet of To Base64"]
    esc = f"wringline 1\n# name: Esc {t}\n\n# a comment\nfind_and-REPLACE( pattern = a\\;b ; with = \\) )\nSHA 256\nFrom Base64(strict=yes)\n"
    resp = call(base, "POST", "/api/imports", sid, body={"text": esc, "owner": owner})
    assert resp.status_code == 201, resp.text
    created = resp.json()["import"]
    assert (created["status"], created["version"], created["lineCount"]) == ("created", 1, 3)
    steps = version_of(base, sid, created["recipe"]["id"], 1)["steps"]
    assert ops_of(steps) == ["Find and Replace", "SHA-256", "From Base64"]
    assert (steps[0]["args"]["find"], steps[0]["args"]["replace"], steps[0]["args"]["flags"]) == ("a;b", ")", "g")
    assert steps[2]["args"]["strict"] is True
    again = call(base, "POST", "/api/imports", sid, body={"text": esc.replace("\n", "\r\n"), "owner": owner})
    assert again.status_code == 200
    assert again.json()["import"]["status"] == "already_imported"
    assert again.json()["import"]["message"] == f"Already imported as Esc {t} (version 1). Nothing was created."
    assert len(recipes_named(base, sid, f"Esc {t}")) == 1


def test_library_search(browser, app_url, meilisearch):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t), person("carol", t), person("dave", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]},
                        {"key": "other", "name": f"Other {t}", "owner": "carol", "members": []}])
    users = world["users"]
    ana, bram, carol = users["ana"]["session"], users["bram"]["session"], users["carol"]["session"]
    word = f"zq{t}"

    def found(sid: str, q: str, rid: str) -> bool:
        resp = call(base, "GET", f"/api/search?q={q}", sid)
        return resp.status_code == 200 and rid in [r["id"] for r in resp.json()["results"]]

    mine = create_recipe(base, ana, {"type": "user", "id": users["ana"]["id"]}, f"Personal {t}",
                         [step("Find and Replace", find=word, replace="", flags="g"), step("Gunzip")],
                         tags=["kettle"], note=f"note{t}")["id"]
    poll(lambda: found(ana, word, mine), "a personal save is searchable by argument value within 2 seconds", SEARCH_WINDOW_S)
    team = create_recipe(base, ana, {"type": "team", "id": world["teams"]["kettle"]["id"]}, f"Team {t}",
                         [step("Gunzip")], tags=[f"tag-{t}"], note="shared")["id"]
    poll(lambda: found(bram, f"tag-{t}", team), "a team save is searchable by tag within 2 seconds", SEARCH_WINDOW_S)
    theirs = create_recipe(base, carol, {"type": "team", "id": world["teams"]["other"]["id"]}, f"Carol {t}",
                           [step("Find and Replace", find=word)])["id"]
    poll(lambda: found(carol, word, theirs), "carol's save is searchable", SEARCH_WINDOW_S)
    for q, rid in ((f"Personal {t}", mine), (f"note{t}", mine), ("gunzp", mine), ("gunzp", team)):
        assert found(ana, q, rid), f"ana finds {rid} by {q!r}"
    ids = [r["id"] for r in call(base, "GET", f"/api/search?q={word}", ana).json()["results"]]
    assert theirs not in ids
    bram_ids = [r["id"] for r in call(base, "GET", f"/api/search?q={word}", bram).json()["results"]]
    assert mine not in bram_ids and theirs not in bram_ids
    carol_hits = call(base, "GET", f"/api/search?q={word}", carol).json()
    assert [r["id"] for r in carol_hits["results"]] == [theirs] and carol_hits["total"] == 1
    index = "recipes"
    doc = meilisearch.document(index, mine)
    assert doc and doc["name"] == f"Personal {t}" and word in doc["argumentValues"]
    assert set(doc["operations"]) == {"Find and Replace", "Gunzip"}
    assert doc["ownerUserId"] == users["ana"]["id"] and doc["teamId"] is None and doc["latestVersion"] == 1
    team_doc = meilisearch.document(index, team)
    assert team_doc["teamId"] == world["teams"]["kettle"]["id"] and team_doc["ownerUserId"] is None
    settings = meilisearch.settings(index)
    assert settings["searchableAttributes"] == ["name", "tags", "operations", "argumentValues", "note"]
    assert {"ownerUserId", "teamId"} <= set(settings["filterableAttributes"])
    with opened(browser, base + "/library", sid=ana) as page:
        listing = page.get_by_role("list", name="Recipes", exact=True)
        shows(page, status(page, "Library status"), "2 recipes")
        personal_row = listing.get_by_role("listitem", name=f"Personal {t}", exact=True)
        assert "Personal" in read(personal_row) and "version 1" in read(personal_row)
        assert f"Kettle {t}" in read(listing.get_by_role("listitem", name=f"Team {t}", exact=True))
        expect(personal_row.get_by_role("link", name=f"Personal {t}", exact=True)).to_be_visible()
        box = page.get_by_role("searchbox", name="Search recipes", exact=True)
        fill(box, word)
        box.press("Enter")
        shows(page, status(page, "Library status"), "1 result")
        fill(box, f"nomatch{t}")
        box.press("Enter")
        eventually(page, lambda: page.get_by_text(f"No recipes match nomatch{t}.", exact=True).count() > 0,
                   "an empty search reads No recipes match <query>.")
    with opened(browser, base + "/library", sid=users["dave"]["session"]) as page:
        eventually(page, lambda: page.get_by_text("No recipes yet. Save one from the workbench.", exact=True).count() > 0,
                   "an empty library shows its copy")
        shows(page, status(page, "Library status"), "0 recipes")


def test_search_outage_fallback(browser, app_url):
    down = instance("APP_MEILISEARCH_DOWN_URL")
    t = tag()
    world = seed(down, [person("ana", t)])
    sid = world["users"]["ana"]["session"]
    owner = {"type": "user", "id": world["users"]["ana"]["id"]}
    older = create_recipe(down, sid, owner, f"Older {t}", [step("MD5")])["id"]
    create_recipe(down, sid, owner, f"Newer {t}", [step("SHA-1")])
    assert save_version(down, sid, older, 1, f"Older {t}", [step("MD5"), step("To Hex")]).status_code == 201
    assert call(down, "POST", f"/api/recipes/{older}/opened", sid).status_code == 204
    message = "Search is unavailable. Showing recent recipes."
    error_of(call(down, "GET", "/api/search?q=older", sid), 503, "search_unavailable", message)
    with opened(browser, down + "/library", sid=sid) as page:
        shows(page, status(page, "Library status"), "2 recipes")
        assert page.get_by_role("alert").filter(has_text=message).count() == 0, "no notice on page load"
        box = page.get_by_role("searchbox", name="Search recipes", exact=True)
        fill(box, f"Newer {t}")
        box.press("Enter")
        eventually(page, lambda: alert_with(page, message).count() > 0, "the search notice appears after a query")
        items = page.get_by_role("list", name="Recipes", exact=True).get_by_role("listitem")
        eventually(page, lambda: [items.nth(i).get_attribute("aria-label") or read(items.nth(i)) for i in range(items.count())] != []
                   and items.count() == 2, "every recipe stays listed")
        assert items.first.get_by_role("link", name=f"Older {t}", exact=True).count() == 1, "most recently used first"
        shows(page, status(page, "Library status"), "2 recipes")
        fill(box, "")
        eventually(page, lambda: alert_with(page, message).count() == 0, "emptying the query clears the notice")


def test_wf_team_live_signup(browser, app_url, mail):
    base = base_of(app_url)
    t = tag()
    email, display, password = f"signup-{t}@kettle.test", f"Sign {t}", "kettle-pass-01"
    with opened(browser, base + "/signup") as page:
        fill(page.get_by_role("textbox", name="Display name", exact=True), display)
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), password)
        click(button(page, "Create account"))
        shows(page, status(page, "Account status"), f"Check your inbox. We sent a confirmation link to {email}.")
    message = mail_to(mail, email, "Confirm your Wringbench account")[0]
    assert mail_from_address() in addresses(message.get("From"))
    token = re.search(r"/verify/([A-Za-z0-9._~%-]+)", text(message)).group(1)
    error_of(call(base, "POST", "/api/auth/signin", body={"email": email, "password": password}), 403, "email_unverified",
             "Confirm your email first. We sent you a link.")
    error_of(call(base, "POST", "/api/auth/signup", body={"displayName": display, "email": email, "password": password}),
             409, "email_taken", "An account with this email already exists.")
    short_pw = f"short-{t}@kettle.test"
    error_of(call(base, "POST", "/api/auth/signup", body={"displayName": display, "email": short_pw, "password": "short"}),
             422, "validation_failed")
    with opened(browser, f"{base}/verify/{token}") as page:
        shows(page, status(page, "Account status"), "Your account is confirmed. You can sign in now.")
    with opened(browser, f"{base}/verify/{token}") as page:
        shows(page, status(page, "Account status"), "This link is no longer valid.")
    error_of(call(base, "POST", "/api/auth/verify", body={"token": token}), 404, "not_found")
    with opened(browser, base + "/signin") as page:
        fill(page.get_by_role("textbox", name="Email", exact=True), email)
        fill(page.get_by_label("Password", exact=True), "wrong-pass-99")
        click(button(page, "Sign in"))
        contains(page, status(page, "Account status"), "Email or password is wrong.")
        fill(page.get_by_label("Password", exact=True), password)
        click(button(page, "Sign in"))
        eventually(page, lambda: button(page, "Sign out").count() > 0, "the info strip offers Sign out once signed in")
        cookie = next(c["value"] for c in page.context.cookies() if c["name"] == "wb_session")
    assert call(base, "GET", "/api/me", cookie).json()["user"]["email"] == email
    assert len(mails_for(mail, email)) == 1, "the refused duplicate sign-up sent nothing"
    assert mails_for(mail, short_pw) == []


def test_wf_team_live_invite(browser, app_url, mail):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t), person("carol", t)])
    users = world["users"]
    ana, bram, carol = users["ana"]["session"], users["bram"]["session"], users["carol"]["session"]
    team_name = f"Kettle {t}"
    bram_email, bram_name = f"bram-{t}@kettle.test", f"Bram {t}"
    with opened(browser, base + "/team", sid=ana) as page:
        expect(page.get_by_role("heading", name="Team settings", exact=True)).to_be_visible()
        fill(page.get_by_role("textbox", name="Team name", exact=True), team_name)
        click(button(page, "Create team"))
        header = button(page, team_name)
        eventually(page, lambda: header.count() == 1, "the new team has its accordion header")
        if header.get_attribute("aria-expanded") != "true":
            click(header)
        click(button(page, "Invite teammate"))
        dialog = page.get_by_role("dialog", name="Invite teammate", exact=True)
        fill(dialog.get_by_role("textbox", name="Email", exact=True), bram_email)
        click(button(dialog, "Send invite"))
        contains(page, status(page, "Team announcements"), f"Invite sent to {bram_email}.")
    team_id = next(x["id"] for x in call(base, "GET", "/api/me", ana).json()["teams"] if x["name"] == team_name)
    invite = mail_to(mail, bram_email, f"Join {team_name} on Wringbench")[0]
    assert f"Ana {t}" in text(invite)
    token = re.search(r"/invite/([A-Za-z0-9._~%-]+)", text(invite)).group(1)
    error_of(call(base, "POST", f"/api/invites/{token}/accept", carol), 403, "invite_wrong_account",
             f"This invite was sent to {bram_email}.")
    with opened(browser, f"{base}/invite/{token}") as page:
        shows(page, status(page, "Account status"), f"Sign in or create an account with {bram_email} to join {team_name}.")
    with opened(browser, f"{base}/invite/{token}", sid=bram) as page:
        expect(page.get_by_role("heading", name=f"Join {team_name}", exact=True)).to_be_visible()
        click(button(page, f"Join {team_name}"))
        contains(page, status(page, "Account status"), f"{bram_name} joined {team_name}.")
    assert {"id": team_id, "name": team_name, "role": "member"} in call(base, "GET", "/api/me", bram).json()["teams"]
    error_of(call(base, "GET", f"/api/invites/{token}"), 404, "not_found")
    error_of(call(base, "POST", f"/api/teams/{team_id}/invites", ana, body={"email": bram_email}), 409, "already_member",
             f"{bram_email} is already in this team.")
    error_of(call(base, "POST", f"/api/teams/{team_id}/invites", bram, body={"email": f"dan-{t}@kettle.test"}), 403, "forbidden")
    error_of(call(base, "DELETE", f"/api/teams/{team_id}/members/{users['ana']['id']}", ana), 409, "cannot_remove_owner",
             "The owner cannot be removed.")
    shared = create_recipe(base, ana, {"type": "team", "id": team_id}, f"Shared {t}", [step("MD5")])["id"]
    assert call(base, "GET", f"/api/recipes/{shared}", bram).status_code == 200
    with opened(browser, base + "/team", sid=ana) as page:
        header = button(page, team_name)
        eventually(page, lambda: header.count() == 1, "team header present")
        if header.get_attribute("aria-expanded") != "true":
            click(header)
        expect(page.get_by_role("list", name=f"Members of {team_name}", exact=True)).to_be_visible()
        click(button(page, f"Remove {bram_name}"))
        click(button(page.get_by_role("dialog", name="Remove teammate", exact=True), "Remove"))
        contains(page, status(page, "Team announcements"), f"Removed {bram_name}.")
    error_of(call(base, "GET", f"/api/recipes/{shared}", bram), 404, "not_found")
    short = instance("APP_SHORT_URL")
    cap = config(short)["teamMax"]
    keys = [f"m{i}" for i in range(cap - 2)]
    sworld = seed(short, [person("ana", t)] + [person(k, t) for k in keys] + [person("xena", t), person("yuri", t)],
                  teams=[{"key": "full", "name": f"Full {t}", "owner": "ana", "members": keys}])
    s_ana = sworld["users"]["ana"]["session"]
    full_id = sworld["teams"]["full"]["id"]
    for who in ("xena", "yuri"):
        assert call(short, "POST", f"/api/teams/{full_id}/invites", s_ana, body={"email": f"{who}-{t}@kettle.test"}).status_code == 201
    x_token = re.search(r"/invite/([A-Za-z0-9._~%-]+)", text(mail_to(mail, f"xena-{t}@kettle.test", f"Join Full {t} on Wringbench")[0])).group(1)
    y_token = re.search(r"/invite/([A-Za-z0-9._~%-]+)", text(mail_to(mail, f"yuri-{t}@kettle.test", f"Join Full {t} on Wringbench")[0])).group(1)
    assert call(short, "POST", f"/api/invites/{x_token}/accept", sworld["users"]["xena"]["session"]).status_code == 200
    error_of(call(short, "POST", f"/api/invites/{y_token}/accept", sworld["users"]["yuri"]["session"]), 409, "team_full",
             f"This team is full ({cap} of {cap}).")
    late = f"zoe-{t}@kettle.test"
    error_of(call(short, "POST", f"/api/teams/{full_id}/invites", s_ana, body={"email": late}), 409, "team_full",
             f"This team is full ({cap} of {cap}).")
    assert mails_for(mail, late) == [], "a refused invite sends no email"


def test_wf_team_live_dialog_escape(browser, app_url):
    base = base_of(app_url)
    t = tag()
    team_name = f"Kettle {t}"
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": team_name, "owner": "ana", "members": ["bram"]}])
    ana, team_id = world["users"]["ana"]["session"], world["teams"]["kettle"]["id"]
    bram_name = f"Bram {t}"
    with opened(browser, base + "/team", sid=ana) as page:
        header = button(page, team_name)
        eventually(page, lambda: header.count() == 1, "team header present")
        if header.get_attribute("aria-expanded") != "true":
            click(header)
        for opener_name, dialog_name in (("Invite teammate", "Invite teammate"), (f"Remove {bram_name}", "Remove teammate")):
            opener = button(page, opener_name)
            click(opener)
            dialog = page.get_by_role("dialog", name=dialog_name, exact=True)
            expect(dialog).to_be_visible()
            page.keyboard.press("Escape")
            eventually(page, lambda: dialog.count() == 0, f"Escape closes {dialog_name}")
            eventually(page, lambda: holds_focus(opener), f"Escape in {dialog_name} returns focus to {opener_name}")
    team = call(base, "GET", f"/api/teams/{team_id}", ana).json()["team"]
    assert team["invites"] == [], "Escape sends no invite"
    assert bram_name in [m["displayName"] for m in team["members"]], "Escape removes nobody"


def test_wf_team_live_update_banner(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t), person("carol", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "hook", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Hook {t}", "note": "first cut", "steps": [{"op": "From Base64", "args": {}}]}]}])
    users = world["users"]
    ana, bram, carol = users["ana"]["session"], users["bram"]["session"], users["carol"]["session"]
    rid = world["recipes"]["hook"]["id"]
    refused, sock, _ = ws_connect(base)
    sock.close()
    assert refused == 401, f"an upgrade without a session is refused with 401; got {refused}"
    with opened(browser, f"{base}/w?recipe={rid}", sid=bram) as bench, opened(browser, base + "/library", sid=bram) as library:
        ready(bench)
        steps_are(bench, ["From Base64"])
        fill(input_box(bench), "aGk=")
        row = library.get_by_role("list", name="Recipes", exact=True).get_by_role("listitem", name=f"Hook {t}", exact=True)
        eventually(library, lambda: row.count() == 1, "Library lists the team recipe")
        b_status, b_sock, b_rest = ws_connect(base, bram)
        c_status, c_sock, c_rest = ws_connect(base, carol)
        assert (b_status, c_status) == (101, 101)
        resp = save_version(base, ana, rid, 1, f"Hook v2 {t}", [step("From Base64"), step("Change Case")])
        assert resp.status_code == 201
        banner = status(bench, "Recipe update")
        contains(bench, banner, f"Recipe updated by Ana {t}", seconds=LIVE_WINDOW_S)
        renamed = library.get_by_role("list", name="Recipes", exact=True).get_by_role("listitem", name=f"Hook v2 {t}", exact=True)
        eventually(library, lambda: renamed.count() == 1 and "version 2" in read(renamed),
                   "the open Library shows version 2 and the new name in place", LIVE_WINDOW_S)
        member_msgs = ws_messages(b_sock, b_rest, LIVE_WINDOW_S)
        outsider_msgs = ws_messages(c_sock, c_rest, LIVE_WINDOW_S)
        b_sock.close()
        c_sock.close()
        saved = [m for m in member_msgs if m.get("type") == "version_saved" and m.get("recipeId") == rid]
        assert saved and saved[0]["version"] == 2 and saved[0]["authorName"] == f"Ana {t}"
        assert saved[0]["teamId"] == world["teams"]["kettle"]["id"]
        assert [m for m in outsider_msgs if m.get("recipeId") == rid] == [], "nobody outside the team receives it"
        announced(bench, f"Recipe updated by Ana {t}")
        click(button(banner, "Load latest"))
        steps_are(bench, ["From Base64", "Change Case"])
        assert read(input_box(bench)) == "aGk="
        expect(bench.get_by_text(f"Hook v2 {t} · version 2", exact=True)).to_be_visible()


def test_wf_team_live_outage_catchup(browser):
    down_base = instance("APP_MEILISEARCH_DOWN_URL")
    t = tag()
    world = seed(down_base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "hook", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Hook {t}", "note": "", "steps": [{"op": "MD5", "args": {}}]}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["hook"]["id"]
    with opened(browser, f"{down_base}/w?recipe={rid}", sid=bram) as page:
        ready(page)
        steps_are(page, ["MD5"])
        notice = status(page, "Service notice")
        try:
            assert call(down_base, "POST", "/api/grading/outage", body={"service": "live", "down": True}).status_code == 200
            shows(page, notice, "Live updates paused. Reconnecting…")
            refused, sock, _ = ws_connect(down_base, bram)
            sock.close()
            assert refused == 503, f"upgrades are refused with 503 while the channel is down; got {refused}"
            assert save_version(down_base, ana, rid, 1, f"Hook {t}", [step("MD5"), step("To Hex")]).status_code == 201
        finally:
            call(down_base, "POST", "/api/grading/outage", body={"service": "live", "down": False})
        advance(page, RECONNECT_MS)
        contains(page, status(page, "Recipe update"), f"Recipe updated by Ana {t}")
        shows(page, notice, "")


def test_wf_stale_save_concurrent(app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "r", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana" if i % 2 else "bram", "name": f"Race {t}", "note": f"v{i}",
                      "steps": [{"op": "MD5", "args": {}}]} for i in range(1, 6)]}])
    sids = [world["users"]["ana"]["session"], world["users"]["bram"]["session"]]
    rid = world["recipes"]["r"]["id"]
    assert world["recipes"]["r"]["latestVersion"] == 5
    barrier = threading.Barrier(RACERS)
    results: list[httpx.Response | None] = [None] * RACERS

    def racer(i: int) -> None:
        barrier.wait()
        results[i] = save_version(base, sids[i % 2], rid, 5, f"Race {t}", [step("MD5"), step("To Hex")], note=f"racer {i}")

    threads = [threading.Thread(target=racer, args=(i,)) for i in range(RACERS)]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join(HTTP_TIMEOUT)
    winners = [r for r in results if r is not None and r.status_code == 201]
    assert len(winners) == 1, f"exactly one save wins; got {[r.status_code if r else None for r in results]}"
    assert winners[0].json()["version"]["n"] == 6
    author = winners[0].json()["version"]["author"]["displayName"]
    for resp in results:
        if resp is winners[0]:
            continue
        lost = error_of(resp, 409, "version_conflict", f"Version 6 was saved by {author} while you were editing.")
        assert lost["details"] == {"latestVersion": 6, "authorName": author}
    detail = call(base, "GET", f"/api/recipes/{rid}", sids[0]).json()
    assert detail["recipe"]["latestVersion"] == 6 and [v["n"] for v in detail["versions"]][:2] == [6, 5]


def test_wf_stale_save_dialog(browser, app_url):
    base = base_of(app_url)
    t = tag()
    name = f"Stale {t}"
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "r", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": name, "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["r"]["id"]
    team_id = world["teams"]["kettle"]["id"]

    def save_stale(page: Page, newest: int) -> Locator:
        keep = button(page, "Keep mine")
        if keep.count() and keep.is_visible():
            click(keep)
        click(button(page, "Save"))
        dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
        click(button(dialog, "Save version"))
        changed = page.get_by_role("dialog", name="This recipe changed", exact=True)
        eventually(page, lambda: changed.is_visible(), "a stale save opens This recipe changed")
        contains(page, changed, f"Version {newest} was saved by Ana {t} while you were editing.")
        expect(button(changed, "Load latest")).to_be_focused()
        return changed

    with opened(browser, f"{base}/w?recipe={rid}", sid=bram) as page:
        ready(page)
        steps_are(page, ["To Hex"])
        fill(input_box(page), "kettle")
        add_op(page, "Reverse")
        assert save_version(base, ana, rid, 1, name, [step("To Hex"), step("MD5")]).status_code == 201
        changed = save_stale(page, 2)
        names = tab_order(page, 6)
        assert set(names) <= {"Load latest", "Save as copy", "Cancel"}, f"Tab stays inside the dialog: {names}"
        for _ in range(4):
            page.keyboard.press("Shift+Tab")
            assert changed.evaluate("el => el.contains(document.activeElement)"), "Shift+Tab stays inside the dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(page, changed), "Escape closes the dialog")
        expect(button(page, "Save")).to_be_focused()
        steps_are(page, ["To Hex", "Reverse"])
        changed = save_stale(page, 2)
        click(button(changed, "Cancel"))
        eventually(page, lambda: gone(page, changed), "Cancel closes the dialog")
        expect(button(page, "Save")).to_be_focused()
        steps_are(page, ["To Hex", "Reverse"])
        changed = save_stale(page, 2)
        click(button(changed, "Load latest"))
        steps_are(page, ["To Hex", "MD5"])
        assert read(input_box(page)) == "kettle"
        add_op(page, "SHA-1")
        assert save_version(base, ana, rid, 2, name, [step("To Hex"), step("CRC32")]).status_code == 201
        changed = save_stale(page, 3)
        click(button(changed, "Save as copy"))
        copy_name = f"{name} (copy)"
        poll(lambda: recipes_named(base, bram, copy_name), f"Save as copy creates {copy_name!r}")
    copy = recipes_named(base, bram, copy_name)[0]
    assert copy["owner"]["type"] == "team" and copy["owner"]["id"] == team_id
    assert ops_of(version_of(base, bram, copy["id"], 1)["steps"]) == ["To Hex", "MD5", "SHA-1"]
    assert call(base, "GET", f"/api/recipes/{rid}", ana).json()["recipe"]["latestVersion"] == 3


def test_wf_phone_sheet(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/", width=PHONE[0], height=PHONE[1]) as page:
        tabs = page.get_by_role("tablist", name="Workbench panes", exact=True)
        eventually(page, lambda: tabs.is_visible(), "the phone layout shows Workbench panes")
        for name in ("Operations", "Recipe", "Input", "Output"):
            assert tabs.get_by_role("tab", name=name, exact=True).count() == 1
        assert all(not s.is_visible() for s in page.get_by_role("separator").all()), "separators are hidden on phones"
        tap(tabs.get_by_role("tab", name="Recipe", exact=True))
        add = button(page, "Add operation")
        eventually(page, lambda: add.is_visible(), "the Recipe panel shows Add operation")
        assert inert_or_hidden(input_box(page)), "other panels are inert"
        page.keyboard.press("Escape")
        page.keyboard.press("/")
        eventually(page, lambda: tabs.get_by_role("tab", name="Operations", exact=True).get_attribute("aria-selected") == "true",
                   "/ selects the Operations tab")
        expect(page.get_by_role("searchbox", name="Find operation", exact=True)).to_be_focused()
        tap(tabs.get_by_role("tab", name="Recipe", exact=True))
        steps_are(page, STARTER_OPS)
        tap(add)
        sheet = page.get_by_role("dialog", name="Add operation", exact=True)
        eventually(page, lambda: sheet.is_visible(), "the sheet opens")
        search = sheet.get_by_role("searchbox", name="Search operations", exact=True)
        expect(search).to_be_focused()
        fill(search, "gunz")
        tap(sheet.get_by_role("listbox", name="Operation sheet", exact=True).get_by_role("option", name="Gunzip", exact=True))
        eventually(page, lambda: gone(page, sheet), "tapping an option closes the sheet")
        announced(page, "Added Gunzip at step 4")
        steps_are(page, STARTER_OPS + ["Gunzip"])
        expect(add).to_be_focused()
        assert inert_or_hidden(page.get_by_role("searchbox", name="Search operations", exact=True))
        names = tab_order(page, 40)
        assert "Search operations" not in names and "Operation sheet" not in names
        for width, height in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size({"width": width, "height": height})
            advance(page, 500)
            layout(page)


def test_wf_phone_touch_reorder(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/", width=PHONE[0], height=PHONE[1], reduced=True) as page:
        tabs = page.get_by_role("tablist", name="Workbench panes", exact=True)
        eventually(page, lambda: tabs.is_visible(), "phone layout")
        tap(tabs.get_by_role("tab", name="Recipe", exact=True))
        steps_are(page, STARTER_OPS)
        auto = page.get_by_role("checkbox", name="Auto-bake", exact=True)
        if auto.is_checked():
            tap(auto)
        eventually(page, lambda: not auto.is_checked(), "a tap turns Auto-bake off")
        handle = button(page, "Reorder step 1")
        handle.scroll_into_view_if_needed()
        start = center(handle)
        neighbour = card(page, 2, "Gunzip").bounding_box()
        touch_drag(page, start, (start[0], start[1] + neighbour["height"] * 0.6))
        announced(page, "Moved From Base64 to step 2")
        steps_are(page, ["Gunzip", "From Base64", "JSON Beautify"])
        roles = ("button", "link", "tab", "checkbox", "combobox", "radio")
        small = small_targets(page, roles)
        tap(tabs.get_by_role("tab", name="Input", exact=True))
        small += small_targets(page, roles)
        assert not small, "phone controls under 44 by 44 px:\n" + "\n".join(small)


TEXT_FAMILY_OPS = [
    "Encode Text", "Decode Text", "Change Case", "Reverse", "Remove Whitespace", "Normalize Line Endings",
    "Find and Replace", "Extract Matches", "Sort Lines", "Unique Lines",
]
HEXDUMP_WIDTH_8 = (
    "00000000  57 72 69 6e 67 62 65 6e  |Wringben|\n"
    + "00000008  " + "63 68 0a".ljust(23) + "  |ch.|"
)
HEXDUMP_WIDTH_16 = "00000000  " + "57 72 69 6e 67 62 65 6e 63 68 0a".ljust(47) + "  |Wringbench.|"
TEXT_EDGE_CASES = [
    ("change-case-invalid-utf8", [("From Hex", {}), ("Change Case", {})], "ff", err(2, "Change Case", "Input is not valid UTF-8 text")),
    ("sort-numeric-ties", [("Sort Lines", {"Order": Opt("Numeric")})], "2\n1.0\n 5\n1\n", "1.0\n1\n2\n 5\n"),
    ("sort-unique-reverse", [("Sort Lines", {"Order": Opt("Alphabetical, ignore case"), "Unique": True, "Reverse": True})],
     "b\nA\na\nB\n", "b\nA\n"),
    ("remove-keep-breaks", [("Remove Whitespace", {"Line breaks": False})], "a b\nc\td", "ab\ncd"),
    ("unique-lines-order", [("Unique Lines", {})], "x\ny\nx\nz", "x\ny\nz"),
    ("json-beautify-indent-4", [("JSON Beautify", {"Indent": Opt("4")})], '{"a":[true]}', '{\n    "a": [\n        true\n    ]\n}'),
    ("json-past-end", [("JSON Beautify", {})], '{"a":1', err(1, "JSON Beautify", "Invalid JSON at line 1 column 7")),
    ("csv-empty", [("CSV to JSON", {})], "", "[]"),
    ("csv-row-count-no-header", [("CSV to JSON", {"First row is header": False})], "a,b\n1\n",
     err(1, "CSV to JSON", "Row 2 has 1 fields; expected 2")),
    ("crc32-zero-padded", [("CRC32", {})], "c", "06b9df6f"),
]


def chosen(loc: Locator) -> str:
    return loc.evaluate(
        "e => e.tagName === 'SELECT' ? (e.selectedOptions[0]?.label || e.selectedOptions[0]?.text || '').trim()"
        " : ((typeof e.value === 'string' && e.value) || e.textContent || '').trim()")


def holds_focus(loc: Locator) -> bool:
    return loc.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def chips(loc: Locator) -> int:
    return loc.get_by_text(re.compile(r"^output \d+–\d+$")).count()


def save_in_page(page: Page) -> None:
    click(button(page, "Save"))
    dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
    eventually(page, lambda: dialog.is_visible(), "Save recipe opens")
    click(button(dialog, "Save version"))


def test_wf_exact_encodings_keyboard_arguments(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        clear_recipe(page)
        fill(input_box(page), "Hi")
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Input", exact=True)).to_be_focused()
        finder = page.get_by_role("searchbox", name="Find operation", exact=True)
        page.keyboard.press("/")
        expect(finder).to_be_focused()
        page.keyboard.press("Control+a")
        page.keyboard.type("to binary")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        steps_are(page, ["To Binary"])
        announced(page, "Added To Binary at step 1")
        select(card(page, 1, "To Binary").get_by_label("Delimiter", exact=True), "Comma")
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Recipe", exact=True)).to_be_focused()
        page.keyboard.press("Control+Enter")
        output_is(page, "01001000,01101001")
        announced(page, "Output updated")
        page.keyboard.press("/")
        expect(finder).to_be_focused()
        page.keyboard.press("Control+a")
        page.keyboard.type("from binary")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        steps_are(page, ["To Binary", "From Binary"])
        announced(page, "Added From Binary at step 2")
        page.keyboard.press("Control+Enter")
        output_is(page, "Hi")
        card(page, 2, "From Binary").focus()
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Moved From Binary to step 1")
        steps_are(page, ["From Binary", "To Binary"])
        page.keyboard.press("Control+Enter")
        output_is(page, err(1, "From Binary", "Invalid binary digit 'H' at position 0"))
        shows(page, status(page, "Bake status"), "Stopped at step 1")
        assert has_text(card(page, 1, "From Binary"), "Error")
        page.keyboard.press("ArrowDown")
        expect(card(page, 2, "To Binary")).to_be_focused()


def test_wf_exact_encodings_hexdump_width(browser, app_url):
    base = base_of(app_url)
    t = tag()
    sid = seed(base, [person("ana", t)])["users"]["ana"]["session"]
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        build(page, [("To Hexdump", {"Width": 8})], "Wringbench\n")
        width = card(page, 1, "To Hexdump").get_by_label("Width", exact=True)
        width.focus()
        page.keyboard.press("Control+Enter")
        output_is(page, HEXDUMP_WIDTH_8)
        shows(page, status(page, "Output status"), size_label(HEXDUMP_WIDTH_8.encode()))
        width.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("16")
        page.keyboard.press("Control+Enter")
        output_is(page, HEXDUMP_WIDTH_16)
        clear_recipe(page)
        dump = HEXDUMP_WIDTH_8.replace("\n", "\r\n\r\n").encode()
        drop_file(page, f"dump-{t}.txt", dump)
        shows(page, status(page, "Input status"), size_label(dump))
        add_op(page, "From Hexdump")
        bake(page)
        output_is(page, "Wringbench")
        broken = (HEXDUMP_WIDTH_8.split("\n")[0] + "\r\n\r\n00000008  zz 68  |?h|").encode()
        drop_file(page, f"broken-{t}.txt", broken)
        shows(page, status(page, "Input status"), size_label(broken))
        bake(page)
        output_is(page, err(1, "From Hexdump", "Invalid hexdump line 3"))


def test_wf_exact_encodings_family_keyboard(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        clear_recipe(page)
        finder = page.get_by_role("searchbox", name="Find operation", exact=True)
        assert read(finder) == ""
        finder.focus()
        page.keyboard.press("Tab")
        expect(button(page, "Edit favourites")).to_be_focused()
        page.keyboard.press("Tab")
        favourites = page.get_by_role("listbox", name="Favourites", exact=True)
        eventually(page, lambda: holds_focus(favourites), "Tab reaches the Favourites listbox")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        eventually(page, lambda: step_cards(page).count() == 1, "Enter in Favourites adds an operation")
        first = next((op for op in DEFAULT_FAVOURITES if card(page, 1, op).count() == 1), None)
        assert first, "the added step is one of the Favourites"
        announced(page, f"Added {first} at step 1")
        page.keyboard.press("Tab")
        expect(button(page, "Encoding")).to_be_focused()
        page.keyboard.press("Tab")
        assert holds_focus(page.get_by_role("listbox", name="Encoding", exact=True)), "the open family's listbox follows its header"
        page.keyboard.press("Tab")
        text_header = button(page, "Text")
        expect(text_header).to_be_focused()
        page.keyboard.press("Enter")
        eventually(page, lambda: text_header.get_attribute("aria-expanded") == "true", "Enter opens Text")
        eventually(page, lambda: button(page, "Encoding").get_attribute("aria-expanded") == "false", "opening Text closes Encoding")
        expect(favourites).to_be_visible()
        page.keyboard.press("Tab")
        text_list = page.get_by_role("listbox", name="Text", exact=True)
        eventually(page, lambda: holds_focus(text_list), "the Text listbox is the stop after its header")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        eventually(page, lambda: step_cards(page).count() == 2, "Enter in the Text listbox adds an operation")
        second = next((op for op in TEXT_FAMILY_OPS if card(page, 2, op).count() == 1), None)
        assert second, "the second step is a Text operation"
        announced(page, f"Added {second} at step 2")
        page.keyboard.press("Tab")
        expect(button(page, "Data formats")).to_be_focused()


def test_wf_text_bytes_encoding_switch(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Hex", {})], "é€")
        shows(page, status(page, "Input status"), "5 bytes · 1 line")
        encoding = page.get_by_role("combobox", name="Input encoding", exact=True)
        select(encoding, "UTF-16LE")
        shows(page, status(page, "Input status"), "4 bytes · 1 line")
        assert read(input_box(page)) == "é€", "changing the encoding keeps the text"
        bake(page)
        output_is(page, "e9 00 ac 20")
        page.keyboard.press("Escape")
        page.keyboard.press("Control+Alt+n")
        tab2 = page.get_by_role("tab", name=f"Input {1 + 1}", exact=True)
        eventually(page, lambda: tab2.get_attribute("aria-selected") == "true", "Ctrl+Alt+N selects Input 2")
        assert chosen(encoding) == "UTF-8", "a new tab starts with UTF-8"
        shows(page, status(page, "Input status"), "0 bytes · 0 lines")
        fill(input_box(page), "€")
        select(encoding, "ISO-8859-1")
        contains(page, input_alert(page), "Character U+20AC cannot be encoded in ISO-8859-1")
        shows(page, status(page, "Input status"), "Not encodable")
        tab2.focus()
        page.keyboard.press("ArrowLeft")
        tab1 = page.get_by_role("tab", name="Input 1", exact=True)
        eventually(page, lambda: tab1.get_attribute("aria-selected") == "true", "ArrowLeft selects Input 1")
        assert chosen(encoding) == "UTF-16LE", "Input 1 keeps its encoding"
        shows(page, status(page, "Input status"), "4 bytes · 1 line")
        output_is(page, "e9 00 ac 20")
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: tab2.get_attribute("aria-selected") == "true", "ArrowRight selects Input 2")
        shows(page, status(page, "Input status"), "Not encodable")
        assert chosen(encoding) == "ISO-8859-1"


def test_wf_text_bytes_edge_operations(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        run_cases(page, TEXT_EDGE_CASES)
        build(page, [("From Hex", {}), ("Change Case", {})], "ff")
        bake(page)
        shows(page, status(page, "Output status"), "No output")
        shows(page, status(page, "Bake status"), "Stopped at step 2")


def test_wf_breakpoints_keyboard_toggle(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Hex", {}), ("Reverse", {}), ("To Base64", {})], "Hi")
        card(page, 2, "Reverse").focus()
        page.keyboard.press("b")
        announced(page, "Breakpoint set on step 2")
        page.keyboard.press("Control+Enter")
        shows(page, status(page, "Bake status"), "Paused at step 2")
        announced(page, "Paused at step 2")
        output_is(page, "48 69")
        assert is_current(card(page, 2, "Reverse"))
        page.keyboard.press("Control+Enter")
        output_is(page, "OTYgODQ=")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "the shortcut resumes to the end")
        card(page, 2, "Reverse").focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 2")
        page.keyboard.press("F8")
        shows(page, status(page, "Bake status"), "Paused at step 3")
        output_is(page, "48 69")
        assert has_text(card(page, 3, "To Base64"), "Current")
        assert not has_text(card(page, 2, "Reverse"), "Current"), "a disabled step never becomes Current"
        page.keyboard.press("F8")
        output_is(page, "NDggNjk=")
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "no enabled step remains")
        card(page, 3, "To Base64").focus()
        page.keyboard.press("b")
        announced(page, "Breakpoint set on step 3")
        page.keyboard.press("Control+Enter")
        shows(page, status(page, "Bake status"), "Paused at step 3")
        expect(button(page, "Resume")).to_be_visible()
        fill(input_box(page), "Ho")
        eventually(page, lambda: button(page, "Resume").count() == 0 and button(page, "Bake").count() == 1,
                   "an input change ends the pause")
        marks = page.get_by_text("Current", exact=True)
        eventually(page, lambda: not any(marks.nth(i).is_visible() for i in range(marks.count())),
                   "no step stays Current once the pause ends")


def test_wf_breakpoints_lamp_motion(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Hex", {}), ("Reverse", {}), ("To Base64", {})], "Hi")
        page.evaluate(RECORDER)
        click(button(page, "Step"))
        two = card(page, 2, "Reverse")
        eventually(page, lambda: has_text(two, "Current") and is_current(two), "Step from rest pauses before step 2")
        shows(page, status(page, "Bake status"), "Paused at step 2")
        output_is(page, "48 69")
        announced(page, "Paused at step 2")
        expect(button(page, "Resume")).to_be_visible()
        page.keyboard.press("F8")
        three = card(page, 3, "To Base64")
        eventually(page, lambda: has_text(three, "Current") and not has_text(two, "Current"), "the lamp moves to step 3")
        announced(page, "Paused at step 3")
        lamp_ms = longest_ms(style(three, "transition-duration")["transition-duration"])
        assert 0 < lamp_ms < MOTION_MAX_MS, f"the lamp fill changes over a short transition; got {lamp_ms} ms"
        assert three.get_attribute("aria-current") == "step" or is_current(three)


def test_wf_breakpoints_link_keeps_flags(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin_of(base))
        ready(page)
        build(page, [("To Hex", {}), ("Reverse", {}), ("To Base64", {})], "Hi")
        card(page, 2, "Reverse").focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 2")
        card(page, 3, "To Base64").focus()
        page.keyboard.press("b")
        announced(page, "Breakpoint set on step 3")
        button(page, "Copy link").focus()
        page.keyboard.press("Enter")
        link = page.get_by_role("textbox", name="Recipe link", exact=True)
        eventually(page, lambda: "/w#r=" in read(link), lambda: f"Recipe link {read(link)!r}")
        announced(page, "Link copied")
        fragment = read(link).strip().split("#", 1)[1]
    parts = dict(item.split("=", 1) for item in fragment.split("&"))
    encoded = parts["r"]
    steps = json.loads(base64.urlsafe_b64decode(encoded + "=" * (-len(encoded) % 4)))
    assert [s["op"] for s in steps] == ["To Hex", "Reverse", "To Base64"]
    assert list(steps[0]) == ["op", "args"]
    assert list(steps[1]) == ["op", "args", "disabled"] and steps[1]["disabled"] is True
    assert list(steps[2]) == ["op", "args", "breakpoint"] and steps[2]["breakpoint"] is True
    with opened(browser, f"{base}/w#{fragment}") as other:
        ready(other)
        steps_are(other, ["To Hex", "Reverse", "To Base64"])
        assert disable_box(other, 2).is_checked()
        assert button(other, "Toggle breakpoint on step 3").get_attribute("aria-pressed") == "true"
        shows(other, status(other, "Bake status"), "Paused at step 3")
        output_is(other, "48 69")
        other.keyboard.press("Control+Enter")
        output_is(other, "NDggNjk=")


def test_wf_regex_budget_extract_watchdog(browser, app_url):
    base = base_of(app_url)
    budget = config(base)["regexBudgetMs"]
    given = "A" * 40 + "!"
    with opened(browser, base + "/") as page:
        ready(page)
        build(page, [("Change Case", {"Case": Opt("Lower")}), ("Extract Matches", {"Find": "(a+)+$"})], given)
        bake(page)
        advance(page, budget - STEP_MS)
        assert "Stopped after" not in read(output_box(page)), "the watchdog waits for the whole budget"
        output_is(page, err(2, "Extract Matches", f"Stopped after {budget} ms"))
        assert has_text(card(page, 2, "Extract Matches"), "Error")
        shows(page, status(page, "Bake status"), "Stopped at step 2")
        page.keyboard.press("Escape")
        page.keyboard.press("/")
        finder = page.get_by_role("searchbox", name="Find operation", exact=True)
        expect(finder).to_be_focused()
        page.keyboard.press("Control+a")
        page.keyboard.type("md5")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        announced(page, "Added MD5 at step 3")
        card(page, 2, "Extract Matches").focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 2")
        page.keyboard.press("Control+Enter")
        output_is(page, hashlib.md5(given.lower().encode()).hexdigest())
        eventually(page, lambda: BAKED.match(read(status(page, "Bake status")).strip()), "the fresh worker bakes")


def test_wf_regex_budget_flags_keyboard(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("Find and Replace", {})], "Cat cat\ncAT")
        first = card(page, 1, "Find and Replace")
        find = first.get_by_label("Find", exact=True)
        replace = first.get_by_label("Replace", exact=True)
        find.focus()
        page.keyboard.type("^c(at)")
        replace.focus()
        page.keyboard.type("<$1>")
        flags = first.get_by_role("group", name="Flags", exact=True)
        for name in ("Ignore case (i)", "Multiline (m)"):
            box = flags.get_by_role("checkbox", name=name, exact=True)
            box.focus()
            page.keyboard.press("Space")
            eventually(page, lambda: box.is_checked(), f"Space checks {name}")
        assert flags.get_by_role("checkbox", name="Global (g)", exact=True).is_checked()
        page.keyboard.press("Control+Enter")
        output_is(page, "<at> cat\n<AT>")
        announced(page, "Output updated")
        find.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("(")
        page.keyboard.press("Control+Enter")
        output_is(page, Prefix(err(1, "Find and Replace", "Invalid regular expression: ")))
        assert has_text(first, "Error")
        shows(page, status(page, "Output status"), "No output")
        shows(page, status(page, "Bake status"), "Stopped at step 1")
        page.keyboard.press("Escape")
        expect(page.get_by_role("region", name="Recipe", exact=True)).to_be_focused()
        find.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("t$")
        replace.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type("T!")
        page.keyboard.press("Control+Enter")
        output_is(page, "Cat caT!\ncAT!")
        assert not has_text(first, "Error")


def test_wf_fork_merge_keyboard_disable(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("Fork", {}), ("To Hex", {}), ("Merge", {"Joiner": "\\t"})], "a\nb\n")
        bake(page)
        output_is(page, "61\t62")
        card(page, 2, "To Hex").focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 2")
        page.keyboard.press("Control+Enter")
        output_is(page, "a\tb")
        page.keyboard.press("d")
        announced(page, "Enabled step 2")
        page.keyboard.press("Alt+ArrowUp")
        announced(page, "Moved To Hex to step 1")
        steps_are(page, ["To Hex", "Fork", "Merge"])
        page.keyboard.press("Control+Enter")
        output_is(page, "61 0a 62 0a")
        card(page, 1, "To Hex").focus()
        page.keyboard.press("Delete")
        announced(page, "Removed To Hex from step 1")
        expect(card(page, 1, "Fork")).to_be_focused()
        page.keyboard.press("Control+Enter")
        output_is(page, "a\tb")


def test_wf_fork_merge_first_branch_error(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("Fork", {}), ("From Hex", {}), ("Merge", {"Joiner": ","})], "6869\nzz\nqq")
        bake(page)
        output_is(page, "Operation 2 (From Hex) in branch 2: Invalid hex digit 'z' at position 0")
        shows(page, status(page, "Bake status"), "Stopped at step 2")
        shows(page, status(page, "Output status"), "No output")
        assert has_text(card(page, 2, "From Hex"), "Error")
        fill(input_box(page), "6869\n6f6b\n")
        bake(page)
        output_is(page, "hi,ok")
        assert not has_text(card(page, 2, "From Hex"), "Error")
        build(page, [("Fork", {"Split delimiter": ","}), ("Change Case", {})], "a,b")
        bake(page)
        output_is(page, "A\nB")


def test_wf_fork_merge_teammate_live(browser, app_url):
    base = base_of(app_url)
    t = tag()
    fork = [{"op": "Fork", "args": {}}, {"op": "From Base64", "args": {}}, {"op": "Merge", "args": {}}]
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "fork", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Fork {t}", "note": "", "steps": fork}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["fork"]["id"]
    url = f"{base}/w?recipe={rid}"
    with opened(browser, url, sid=ana) as one, opened(browser, url, sid=bram) as two:
        for page in (one, two):
            ready(page)
            steps_are(page, ["Fork", "From Base64", "Merge"])
        given = "aGk=\nb2s="
        fill(input_box(two), given)
        bake(two)
        output_is(two, "hi\nok")
        add_op(one, "Change Case")
        save_in_page(one)
        announced(one, "Recipe saved as version 2")
        banner = status(two, "Recipe update")
        contains(two, banner, f"Recipe updated by Ana {t}", seconds=LIVE_WINDOW_S)
        announced(two, f"Recipe updated by Ana {t}")
        assert "Recipe updated by" not in read(status(one, "Recipe update")), "the saving workbench shows no banner"
        click(button(banner, "Load latest"))
        steps_are(two, ["Fork", "From Base64", "Merge", "Change Case"])
        assert read(input_box(two)) == given
        bake(two)
        output_is(two, "HI\nOK")
        expect(two.get_by_text(f"Fork {t} · version 2", exact=True)).to_be_visible()


def test_wf_files_invalid_text_keyboard_clear(browser, app_url):
    base = base_of(app_url)
    t = tag()
    sid = seed(base, [person("ana", t)])["users"]["ana"]["session"]
    data = b"ok\xff"
    with opened(browser, base + "/") as page:
        ready(page)
        drop_file(page, f"raw-{t}.bin", data)
        eventually(page, lambda: alert_with(page, "Sign in to save recipes, open files or share snapshots.").count() > 0,
                   "a signed-out drop shows the sign-in alert")
    with opened(browser, base + "/", sid=sid) as page:
        ready(page)
        clear_recipe(page)
        drop_file(page, f"raw-{t}.bin", data)
        shows(page, status(page, "Input status"), "3 bytes · 1 line")
        eventually(page, lambda: read(input_box(page)) == "ok�", "undecodable bytes show as the replacement character")
        expect(input_box(page)).not_to_be_editable()
        select(page.get_by_role("combobox", name="Input encoding", exact=True), "ISO-8859-1")
        eventually(page, lambda: read(input_box(page)) == "okÿ", "the file is shown decoded with ISO-8859-1")
        shows(page, status(page, "Input status"), "3 bytes · 1 line")
        add_op(page, "To Hex")
        bake(page)
        output_is(page, "6f 6b ff")
        select_chars(page, 0, 2)
        advance(page, 500)
        assert chips(card(page, 1, "To Hex")) == 0, "Span carry works only on typed input"
        button(page, "Clear input").focus()
        page.keyboard.press("Enter")
        shows(page, status(page, "Input status"), "0 bytes · 0 lines")
        expect(input_box(page)).to_be_editable()


def test_wf_files_exact_cap_download(browser, app_url):
    short = instance("APP_SHORT_URL")
    t = tag()
    limits = config(short)
    cap = limits["fileMaxBytes"]
    sid = seed(short, [person("ana", t)])["users"]["ana"]["session"]
    data = b"k" * cap
    name = f"cap-{t}.txt"
    with opened(browser, short + "/", sid=sid) as page:
        ready(page)
        clear_recipe(page)
        with using(held(page, "**/api/files")) as gate:
            choose_file(page, name, data)
            contains(page, input_alert(page), f"Uploading {name}…")
            gate.release()
        shows(page, status(page, "Input status"), f"{cap} bytes · 1 line")
        add_op(page, "Change Case")
        bake(page)
        if cap > limits["outputDisplayBytes"]:
            expect(page.get_by_text(f"Showing the first {limits['outputDisplayBytes']} of {cap} bytes. Download output for all of it.",
                                    exact=True)).to_be_visible()
        got_name, got = download_of(page, button(page, "Download output"))
        assert (got_name, got) == ("output.txt", b"K" * cap)


def test_wf_span_carry_binary_and_lost_case(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Binary", {"Delimiter": Opt("None")})], "Hi!")
        bake(page)
        output_is(page, "010010000110100100100001")
        select_chars(page, 1, 1)
        eventually(page, lambda: has_text(card(page, 1, "To Binary"), "output 8–15"), "To Binary maps [1, 2) to 8–15")
        announced(page, "Span maps to characters 8 to 15 at step 1")
        shows(page, status(page, "Output status"), "24 bytes · 1 line · Selection maps to characters 8–15")
        build(page, [("Change Case", {"Case": Opt("Lower")}), ("To Hex", {})], "Hİ")
        bake(page)
        output_is(page, "68 69 cc 87")
        select_chars(page, 0, 1)
        eventually(page, lambda: has_text(card(page, 1, "Change Case"), "span lost"), "a length change loses the span")
        assert chips(card(page, 2, "To Hex")) == 0, "later steps show no chip"
        announced(page, "Span lost at step 1")
        shows(page, status(page, "Output status"), "11 bytes · 1 line")


def test_wf_span_carry_clamp_and_disabled(browser, app_url):
    with opened(browser, base_of(app_url) + "/") as page:
        ready(page)
        build(page, [("To Hex", {"Delimiter": Opt("None")}), ("To Base64", {})], "Hello")
        bake(page)
        output_is(page, "NDg2NTZjNmM2Zg==")
        select_chars(page, 1, 3)
        eventually(page, lambda: has_text(card(page, 1, "To Hex"), "output 2–7")
                   and has_text(card(page, 2, "To Base64"), "output 0–11"), "chips read output 2–7 and output 0–11")
        announced(page, "Span maps to characters 0 to 11 at step 2")
        shows(page, status(page, "Output status"), "16 bytes · 1 line · Selection maps to characters 0–11")
        card(page, 1, "To Hex").focus()
        page.keyboard.press("d")
        announced(page, "Disabled step 1")
        page.keyboard.press("Control+Enter")
        output_is(page, "SGVsbG8=")
        select_chars(page, 1, 3)
        eventually(page, lambda: has_text(card(page, 2, "To Base64"), "output 0–7"), "a disabled step passes the range through")
        assert chips(card(page, 1, "To Hex")) == 0, "a disabled step shows no chip"
        shows(page, status(page, "Output status"), "8 bytes · 1 line · Selection maps to characters 0–7")


def test_wf_span_carry_keyboard_reselect(browser, app_url):
    with opened(browser, base_of(app_url) + "/", reduced=True) as page:
        ready(page)
        build(page, [("To Hex", {})], "Hello")
        bake(page)
        output_is(page, "48 65 6c 6c 6f")
        page.evaluate(RECORDER)
        select_chars(page, 1, 3)
        first = card(page, 1, "To Hex")
        eventually(page, lambda: has_text(first, "output 3–10"), "three characters map to output 3–10")
        page.keyboard.press("Shift+ArrowLeft")
        eventually(page, lambda: has_text(first, "output 3–7"), "shrinking the selection by keyboard updates the chip")
        announced(page, "Span maps to characters 3 to 7 at step 1")
        shows(page, status(page, "Output status"), "14 bytes · 1 line · Selection maps to characters 3–7")
        assert max(recorded(first), default=0) <= INSTANT_MS, f"chips change with no motion: {recorded(first)}"
        page.keyboard.press("Shift+ArrowLeft")
        page.keyboard.press("Shift+ArrowLeft")
        eventually(page, lambda: chips(first) == 0, "an empty selection clears every chip")
        shows(page, status(page, "Output status"), "14 bytes · 1 line")


def test_wf_share_link_keyboard(browser, app_url):
    base = base_of(app_url)
    with opened(browser, base + "/") as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"], origin=origin_of(base))
        ready(page)
        build(page, [("To Hex", {"Delimiter": Opt("Colon")})], "Hi!")
        button(page, "Copy link").focus()
        page.keyboard.press("Enter")
        link = page.get_by_role("textbox", name="Recipe link", exact=True)
        eventually(page, lambda: "/w#r=" in read(link), lambda: f"Recipe link {read(link)!r}")
        announced(page, "Link copied")
        fragment = read(link).strip().split("#", 1)[1]
        fill(input_box(page), "Ho")
        eventually(page, lambda: link.count() == 0 or not link.is_visible(), "Recipe link goes away after an input change")
    with opened(browser, f"{base}/w#{fragment}") as other:
        ready(other)
        steps_are(other, ["To Hex"])
        assert read(input_box(other)) == "Hi!"
        output_is(other, "48:69:21")
    bad = b64url(b'[{"op":"To Hex","args":{"delimiter":"Semicolon"}}]')
    with opened(browser, f"{base}/w#r={bad}&i=@@") as broken:
        eventually(broken, lambda: alert_with(broken, "This link is damaged: the recipe part is not valid.").count() > 0,
                   "an invalid argument damages the recipe part, which is checked before the input part")
        steps_are(broken, [])


def test_wf_team_live_keep_mine_and_remove(browser, app_url):
    base = base_of(app_url)
    t = tag()
    team = f"Kettle {t}"
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": team, "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "hook", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Hook {t}", "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["hook"]["id"]
    with opened(browser, f"{base}/w?recipe={rid}", sid=bram) as bench, opened(browser, base + "/team", sid=ana) as owner:
        ready(bench)
        steps_are(bench, ["To Hex"])
        add_op(bench, "MD5")
        expect(bench.get_by_text(f"Hook {t} · version 1 · edited", exact=True)).to_be_visible()
        assert save_version(base, ana, rid, 1, f"Hook {t}", [step("To Hex"), step("SHA-1")]).status_code == 201
        banner = status(bench, "Recipe update")
        contains(bench, banner, f"Recipe updated by Ana {t}", seconds=LIVE_WINDOW_S)
        click(button(banner, "Keep mine"))
        eventually(bench, lambda: "Recipe updated by" not in read(banner), "Keep mine dismisses the banner")
        steps_are(bench, ["To Hex", "MD5"])
        header = button(owner, team)
        eventually(owner, lambda: header.count() == 1, "Team settings lists the team")
        if header.get_attribute("aria-expanded") != "true":
            click(header)
        members = owner.get_by_role("list", name=f"Members of {team}", exact=True)
        eventually(owner, lambda: members.is_visible() and f"Bram {t}" in read(members), "the member list shows Bram")
        click(button(owner, f"Remove Bram {t}"))
        dialog = owner.get_by_role("dialog", name="Remove teammate", exact=True)
        eventually(owner, lambda: dialog.is_visible(), "Remove teammate opens")
        click(button(dialog, "Remove"))
        contains(owner, status(owner, "Team announcements"), f"Removed Bram {t}.")
    error_of(call(base, "GET", f"/api/recipes/{rid}", bram), 404, "not_found")
    with opened(browser, base + "/library", sid=bram) as library:
        region = library.get_by_role("region", name="Library", exact=True)
        contains(library, region, "No recipes yet. Save one from the workbench.")
        shows(library, status(library, "Library status"), "0 recipes")


def test_wf_stale_save_own_other_tab(browser, app_url):
    base = base_of(app_url)
    t = tag()
    name = f"Own {t}"
    world = seed(base, [person("ana", t)],
                 recipes=[{"key": "r", "owner": {"user": "ana"}, "tags": [], "versions": [
                     {"author": "ana", "name": name, "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}])
    sid = world["users"]["ana"]["session"]
    url = f"{base}/w?recipe={world['recipes']['r']['id']}"
    with opened(browser, url, sid=sid) as one, opened(browser, url, sid=sid) as two:
        for page in (one, two):
            ready(page)
            steps_are(page, ["To Hex"])
        add_op(one, "MD5")
        save_in_page(one)
        announced(one, "Recipe saved as version 2")
        banner = status(two, "Recipe update")
        contains(two, banner, f"Recipe updated by Ana {t}", seconds=LIVE_WINDOW_S)
        assert "Recipe updated by" not in read(status(one, "Recipe update")), "the saving tab shows no banner"
        click(button(banner, "Keep mine"))
        add_op(two, "SHA-1")
        save_in_page(two)
        changed = two.get_by_role("dialog", name="This recipe changed", exact=True)
        eventually(two, lambda: changed.is_visible(), "a save from the kept version is stale")
        contains(two, changed, f"Version 2 was saved by Ana {t} while you were editing.")
        expect(button(changed, "Load latest")).to_be_focused()
        click(button(changed, "Load latest"))
        steps_are(two, ["To Hex", "MD5"])
        expect(two.get_by_text(f"{name} · version 2", exact=True)).to_be_visible()


def test_wf_stale_save_keyboard_copy(browser, app_url):
    base = base_of(app_url)
    t = tag()
    name = f"Keys {t}"
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "r", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": name, "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["r"]["id"]
    with opened(browser, f"{base}/w?recipe={rid}", sid=bram) as page:
        ready(page)
        steps_are(page, ["To Hex"])
        add_op(page, "Reverse")
        assert save_version(base, ana, rid, 1, name, [step("To Hex"), step("MD5")]).status_code == 201
        button(page, "Save").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Save recipe", exact=True)
        eventually(page, lambda: dialog.is_visible(), "Enter on Save opens Save recipe")
        button(dialog, "Save version").focus()
        page.keyboard.press("Enter")
        changed = page.get_by_role("dialog", name="This recipe changed", exact=True)
        eventually(page, lambda: changed.is_visible(), "the stale save opens This recipe changed")
        expect(button(changed, "Load latest")).to_be_focused()
        copy = button(changed, "Save as copy")
        for _ in range(4):
            if holds_focus(copy):
                break
            page.keyboard.press("Tab")
            assert holds_focus(changed), "Tab stays inside the dialog"
        assert holds_focus(copy), "Tab reaches Save as copy"
        page.keyboard.press("Enter")
        poll(lambda: recipes_named(base, bram, f"{name} (copy)"), f"Save as copy creates {name} (copy)")
    made = recipes_named(base, bram, f"{name} (copy)")[0]
    assert made["owner"]["type"] == "team"
    assert ops_of(version_of(base, bram, made["id"], 1)["steps"]) == ["To Hex", "Reverse"]
    assert call(base, "GET", f"/api/recipes/{rid}", ana).json()["recipe"]["latestVersion"] == 2


def test_wf_stale_save_load_latest_keeps_tabs(browser, app_url):
    base = base_of(app_url)
    t = tag()
    name = f"Tabs {t}"
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "r", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": name, "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    rid = world["recipes"]["r"]["id"]
    with opened(browser, f"{base}/w?recipe={rid}", sid=bram) as page:
        ready(page)
        fill(input_box(page), "one")
        click(button(page, "New input"))
        eventually(page, lambda: page.get_by_role("tab", name=f"Input {1 + 1}", exact=True).get_attribute("aria-selected") == "true",
                   "New input selects Input 2")
        fill(input_box(page), "two")
        add_op(page, "Reverse")
        assert save_version(base, ana, rid, 1, name, [step("To Hex"), step("MD5")]).status_code == 201
        save_in_page(page)
        changed = page.get_by_role("dialog", name="This recipe changed", exact=True)
        eventually(page, lambda: changed.is_visible(), "the stale save opens This recipe changed")
        click(button(changed, "Load latest"))
        steps_are(page, ["To Hex", "MD5"])
        assert read(input_box(page)) == "two"
        click(page.get_by_role("tab", name="Input 1", exact=True))
        eventually(page, lambda: read(input_box(page)) == "one", "Input 1 keeps its text")
        expect(page.get_by_text(f"{name} · version 2", exact=True)).to_be_visible()
        add_op(page, "SHA-1")
        save_in_page(page)
        announced(page, "Recipe saved as version 3")
    assert ops_of(version_of(base, bram, rid, 3)["steps"]) == ["To Hex", "MD5", "SHA-1"]


def test_wf_stale_save_modal_inert(browser, app_url):
    base = base_of(app_url)
    t = tag()
    name = f"Modal {t}"
    world = seed(base, [person("ana", t)],
                 recipes=[{"key": "r", "owner": {"user": "ana"}, "tags": [], "versions": [
                     {"author": "ana", "name": name, "note": "", "steps": [{"op": "To Hex", "args": {}}]}]}])
    sid = world["users"]["ana"]["session"]
    rid = world["recipes"]["r"]["id"]
    with opened(browser, f"{base}/w?recipe={rid}", sid=sid) as page:
        ready(page)
        steps_are(page, ["To Hex"])
        assert save_version(base, sid, rid, 1, name, [step("To Hex"), step("CRC32")]).status_code == 201
        keep = button(page, "Keep mine")
        eventually(page, lambda: keep.count() == 1 and keep.is_visible(), "the saver's other workbench shows the banner")
        click(keep)
        add_op(page, "SHA-1")
        save_in_page(page)
        changed = page.get_by_role("dialog", name="This recipe changed", exact=True)
        eventually(page, lambda: changed.is_visible(), "the stale save opens This recipe changed")
        contains(page, changed, f"Version 2 was saved by Ana {t} while you were editing.")
        expect(button(changed, "Load latest")).to_be_focused()
        page.keyboard.press("/")
        advance(page, 200)
        assert holds_focus(changed), "while the modal is open the page behind is inert"
        assert not page.get_by_role("searchbox", name="Find operation", exact=True).evaluate(
            "el => el === document.activeElement")
        for _ in range(5):
            page.keyboard.press("Tab")
            assert holds_focus(changed), "Tab wraps inside the dialog"
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(page, changed), "Escape closes the dialog")
        expect(button(page, "Save")).to_be_focused()
        steps_are(page, ["To Hex", "SHA-1"])
        expect(page.get_by_text(f"{name} · version 1 · edited", exact=True)).to_be_visible()


def test_wf_phone_sheet_escape_and_wrap(browser, app_url):
    with opened(browser, base_of(app_url) + "/", width=PHONE[0], height=PHONE[1], reduced=True) as page:
        tabs = page.get_by_role("tablist", name="Workbench panes", exact=True)
        eventually(page, lambda: tabs.is_visible(), "the phone layout shows Workbench panes")
        tap(tabs.get_by_role("tab", name="Recipe", exact=True))
        add = button(page, "Add operation")
        eventually(page, lambda: add.is_visible(), "the Recipe panel shows Add operation")
        page.evaluate(RECORDER)
        tap(add)
        sheet = page.get_by_role("dialog", name="Add operation", exact=True)
        eventually(page, lambda: sheet.is_visible(), "the sheet opens")
        capture(sheet)
        assert max(recorded(sheet), default=0) <= INSTANT_MS, f"the sheet appears in place under reduced motion: {recorded(sheet)}"
        expect(sheet.get_by_role("searchbox", name="Search operations", exact=True)).to_be_focused()
        for _ in range(6):
            page.keyboard.press("Tab")
            assert holds_focus(sheet), "Tab wraps inside the sheet"
        for _ in range(3):
            page.keyboard.press("Shift+Tab")
            assert holds_focus(sheet), "Shift+Tab wraps inside the sheet"
        page.keyboard.press("Escape")
        eventually(page, lambda: gone(page, sheet), "Escape closes the sheet")
        expect(add).to_be_focused()
        assert inert_or_hidden(page.get_by_role("searchbox", name="Search operations", exact=True))
        tap(add)
        eventually(page, lambda: sheet.is_visible(), "the sheet opens again")
        tap(button(sheet, "Close"))
        eventually(page, lambda: gone(page, sheet), "Close closes the sheet")
        tap(tabs.get_by_role("tab", name="Input", exact=True))
        eventually(page, lambda: tabs.get_by_role("tab", name="Input", exact=True).get_attribute("aria-selected") == "true",
                   "tapping Input selects it")
        assert inert_or_hidden(add), "the Recipe panel is inert while Input is shown"


def test_wf_phone_live_update(browser, app_url):
    base = base_of(app_url)
    t = tag()
    world = seed(base, [person("ana", t), person("bram", t)],
                 teams=[{"key": "kettle", "name": f"Kettle {t}", "owner": "ana", "members": ["bram"]}],
                 recipes=[{"key": "hook", "owner": {"team": "kettle"}, "tags": [], "versions": [
                     {"author": "ana", "name": f"Hook {t}", "note": "", "steps": [{"op": "From Base64", "args": {}}]}]}])
    ana, bram = world["users"]["ana"]["session"], world["users"]["bram"]["session"]
    url = f"{base}/w?recipe={world['recipes']['hook']['id']}"
    with opened(browser, url, sid=ana) as desk, opened(browser, url, width=PHONE[0], height=PHONE[1], sid=bram) as phone:
        ready(desk)
        steps_are(desk, ["From Base64"])
        tabs = phone.get_by_role("tablist", name="Workbench panes", exact=True)
        eventually(phone, lambda: tabs.is_visible(), "the phone layout shows Workbench panes")
        tap(tabs.get_by_role("tab", name="Input", exact=True))
        fill(input_box(phone), "aGk=")
        tap(tabs.get_by_role("tab", name="Recipe", exact=True))
        steps_are(phone, ["From Base64"])
        add_op(desk, "Change Case")
        save_in_page(desk)
        announced(desk, "Recipe saved as version 2")
        banner = status(phone, "Recipe update")
        contains(phone, banner, f"Recipe updated by Ana {t}", seconds=LIVE_WINDOW_S)
        announced(phone, f"Recipe updated by Ana {t}")
        tap(button(banner, "Load latest"))
        steps_are(phone, ["From Base64", "Change Case"])
        tap(tabs.get_by_role("tab", name="Input", exact=True))
        assert read(input_box(phone)) == "aGk="
        phone.keyboard.press("Control+Enter")
        tap(tabs.get_by_role("tab", name="Output", exact=True))
        output_is(phone, "HI")


def test_wf_phone_touch_reorder_two_places(browser, app_url):
    with opened(browser, base_of(app_url) + "/", width=PHONE[0], height=PHONE[1], reduced=True) as page:
        tabs = page.get_by_role("tablist", name="Workbench panes", exact=True)
        eventually(page, lambda: tabs.is_visible(), "phone layout")
        tap(tabs.get_by_role("tab", name="Recipe", exact=True))
        steps_are(page, STARTER_OPS)
        auto = page.get_by_role("checkbox", name="Auto-bake", exact=True)
        if auto.is_checked():
            tap(auto)
        eventually(page, lambda: not auto.is_checked(), "a tap turns Auto-bake off")
        handle = button(page, "Reorder step 1")
        handle.scroll_into_view_if_needed()
        start = center(handle)
        second = card(page, 2, "Gunzip").bounding_box()["height"]
        third = card(page, 3, "JSON Beautify").bounding_box()["height"]
        touch_drag(page, start, (start[0], start[1] + second + third * 0.6), moves=12)
        announced(page, "Moved From Base64 to step 3")
        steps_are(page, ["Gunzip", "JSON Beautify", "From Base64"])
        handle = button(page, "Reorder step 3")
        handle.scroll_into_view_if_needed()
        start = center(handle)
        above = card(page, 2, "JSON Beautify").bounding_box()["height"]
        touch_drag(page, start, (start[0], start[1] - above * 0.6))
        announced(page, "Moved From Base64 to step 2")
        steps_are(page, ["Gunzip", "From Base64", "JSON Beautify"])
        page.keyboard.press("Control+Enter")
        tap(tabs.get_by_role("tab", name="Output", exact=True))
        output_is(page, err(1, "Gunzip", "Not gzip data"))


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip(), f"run.json {key} is a command string"


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    packages = shipped_packages()
    missing = [p.name for p in packages if p.name not in notices]
    assert not missing, f"packages missing from the notices: {missing}"
    licences = {p.licence for p in packages if p.licence}
    assert all(l in notices for l in licences if " " not in l), "each licence is listed"
    for name in ("Inter", "Fragment Mono", "Lucide"):
        assert name in notices, f"{name} is listed"


def test_if_licences_allowed():
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"packages outside the allowed licences: {bad}"


def test_if_no_other_datastore():
    names = {p.name for p in shipped_packages()}
    assert not names & OTHER_STORES, f"extra datastore packages: {names & OTHER_STORES}"
    stray = [str(p) for p in DEPLOYED_APP.rglob("*") if "node_modules" not in p.parts
             and p.suffix in {".sqlite", ".sqlite3", ".db"}]
    assert not stray, f"state files on disk: {stray}"


def test_if_service_env_untouched():
    manifest = Path("/app/run.json").read_text()
    for name in SERVICE_ENV:
        assert f"{name}=" not in manifest, f"run.json sets {name}"
    for root in (Path("/app"), DEPLOYED_APP):
        for env_file in root.glob(".env*"):
            if env_file.name.endswith((".example", ".sample", ".template", ".dist")):
                continue
            body = env_file.read_text(errors="ignore")
            assert not [n for n in SERVICE_ENV if re.search(rf"^\s*{n}\s*=\s*\S", body, re.M)], f"{env_file} overrides service values"


def test_if_typescript_and_lockfile():
    lock = json.loads(Path("/app/package-lock.json").read_text())
    assert isinstance(lock, dict) and lock
    files = [p for p in Path("/app").rglob("*") if p.is_file() and not {"node_modules", ".git", "build", "dist"} & set(p.parts)]
    assert any(p.suffix in {".ts", ".tsx"} for p in files), "the source is TypeScript"
    plain = [str(p) for p in files if "src" in p.parts and p.suffix in {".js", ".jsx", ".mjs", ".cjs"}]
    assert not plain, f"JavaScript source files: {plain}"


def test_if_same_origin_requests(browser, app_url):
    base = base_of(app_url)
    t = tag()
    sid = seed(base, [person("ana", t)])["users"]["ana"]["session"]
    with opened(browser, base + "/", sid=sid) as page:
        urls: list[str] = []
        page.on("request", lambda r: urls.append(r.url))
        for path in ("/", "/library", "/import", "/team", "/signin"):
            page.goto(base + path)
            advance(page, 1000)
    foreign = [u for u in urls if not u.startswith(("data:", "blob:")) and not same_origin(u, origin_of(base))]
    assert not foreign, f"requests to other origins: {foreign}"
