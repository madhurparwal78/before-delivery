from __future__ import annotations

import hashlib
import io
import json
import math
import os
import re
import secrets
import signal
import socket
import subprocess
import tempfile
import threading
import time
import uuid
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Mailpit,
    addresses,
    advance,
    capture,
    changed,
    decode,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    settle,
    shipped_packages,
    style,
    tab_order,
    tap,
    unique,
    idempotency_key,
)
from conftest import text as mail_text


PASSWORD = "stone-course-1"
HTTP_TIMEOUT_S = 30
WAIT_S = 30
BOOT_S = 120
BOOT_POLL_S = 0.25
STEP_MS = 100
PROBE_MS = 2000
EDGE_PX = 1
MAIL_SETTLE_S = 2
POLL_SETTLE_S = 0.3
LIVE_MARGIN_S = 2
TTL_MARGIN_S = 1
RELAY_MAX_CONNECTIONS = 100000
RELAY_MAX_CHUNKS = 10000000
TAB_PRESSES = 30

WIDE = {"width": 1280, "height": 800}
MEDIUM = {"width": 768, "height": 1024}
NARROW = {"width": 375, "height": 812}
BANDS = {"wide": WIDE, "medium": MEDIUM, "narrow": NARROW}

PEN_ID = re.compile(r"[a-z0-9]{10}")
NOT_FOUND = {"error": "not_found", "message": "Nothing here."}
CONFIG_KEYS = ("preview_delay_ms", "draft_interval_ms", "search_debounce_ms", "loop_limit",
               "pane_limit_bytes", "max_tags", "live_poll_ms")
LIVE_POLL_MS = 1000
LIVE_LIMIT_S = 2
PREVIEW_MIN_MS = 300
PREVIEW_MAX_MS = 800
DEFAULT_BODY_LIMIT = 1000000
REST_MS = 320
CROSSFADE_MS = 600
LIFT_PX = 12
LIFT_MAX_MS = 180
REDUCED_NAV_MAX_MS = 180
SEP_PREVIEW_DEFAULT = 47
SEP_PANES_DEFAULT = 50
SEP_MIN = 15
SEP_MAX = 85
SEP_STEP = 5
BAND_BASE_PX = 6
BAND_LOG_PX = 4
MINUS = "\u2212"
PANES = ("html", "css", "js")
PANE_LABEL = {"html": "HTML", "css": "CSS", "js": "JS"}
SHARE_TABS = ("HTML", "CSS", "JS", "Result")
PHONE_TABS = ("HTML", "CSS", "JS", "Result", "Console")
SHELF = {
    "dayjs@1.11.13": ("dayjs.min.js", "dayjs", "MIT"),
    "lodash@4.17.21": ("lodash.min.js", "_", "MIT"),
    "matter-js@0.20.0": ("matter.min.js", "Matter", "MIT"),
    "tinycolor2@1.6.0": ("tinycolor.js", "tinycolor", "MIT"),
    "canvas-confetti@1.9.3": ("confetti.js", "confetti", "ISC"),
}
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
FONTS = ("Work Sans", "Fragment Mono")
COOKIE_ATTRS = "HttpOnly; SameSite=Lax; Path=/"
SET_COOKIE = "set-cookie"
CORS_HEADER = "access-control-allow-origin"
FRAME_HEADER = "x-frame-options"
SCHEME_SOURCES = ("http:", "https:")
OUTLINE_PX = 2
TYPED_TITLE = "Course"
TYPED_TAIL = "kk"
INDENT = "  "
PANE_LINES = ("a", "b")
DEMO_TAG = "demo-tag"
JS_NEW = 'console.log("new")'
ONE_HTML = "<p>one</p>"
MINE_JS = "let mine = 1"
KEEP_HTML = "<p>keep</p>"
SEALED_TITLE = "sealed"

STORAGE_SAVE = "Storage is unreachable, so this version was not saved. Your edits are still here."
STORAGE_EXPORT = "Storage is unreachable, so the export was not made. Your pen is unchanged."
CONFLICT = "Version {head} of this pen was saved somewhere else. Your edits are still here."
UNVERIFIED = "Verify your email to do this. We sent a link to {email}."
BANNER_SENT = ("Check {email} for a link to verify your account. Until then you can write and preview, "
               "but not save versions, publish, like or fork.")
BANNER_PENDING = "Your account is ready, but the verification email is not sent yet. Use Resend link in a moment."
RESEND_SENT = "Sent a new link to {email}."
RESEND_DOWN = "Mail is unreachable, so the link was not sent. Try Resend link again in a moment."
VERIFIED_LIVE = "Email verified. You can now save versions."
VERIFY_OK = "Your email is verified"
VERIFY_EXPIRED = "This link has expired. Sign in and use Resend link to get a new one."
VERIFY_INVALID = "This link is not valid. It may have been used already."
SIGNIN_WRONG = "That email or password is not right."
LOOP_LINE = "loop Stopped a loop on line {line} after {limit} iterations."
BLOCKED_SCRIPT = "blocked Script {url} is not on the shelf."
BLOCKED_REQUEST = "blocked Request to {url} was blocked. Pens cannot use the network."
NOT_ON_SHELF = "{text} is not on the shelf. Pick a pinned library from the list."
TAG_FORMAT = "Tags use 1 to 24 lowercase letters, digits or hyphens."
TAG_MAX = "A pen can have up to {max} tags."
TAG_DUPLICATE = "That tag is already on this pen."
DELETE_COPY = 'Delete "{title}" and all its versions? Its forks stay, but they will no longer link here.'
DELETED = 'Deleted "{title}"'
SHARE_PRIVATE = ("This pen is private, so the embed shows a not-found page. "
                 "Make it unlisted or public to embed it.")
DASHBOARD_EMPTY = "You have no pens yet. Start one, and every save becomes a version you can go back to."
COLLECTIONS_NONE = "No collections yet. Make one to keep related pens together."
COLLECTION_EMPTY = "This collection is empty. Add a pen with the box above."
SEARCH_REST = "Type to search public pens. Use tag:name to filter by tag."

DATE_JS = """iso => {
  const d = new Date(iso);
  const month = d.toLocaleString('en-US', {month: 'short'});
  const pad = n => String(n).padStart(2, '0');
  return `${d.getDate()} ${month} ${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}"""
PANE_TEXT_JS = "el => (typeof el.value === 'string' ? el.value : el.innerText)"
FOCUS_PROBE_JS = "el => { el.focus(); return document.activeElement === el || el.contains(document.activeElement); }"

CONSOLE_JS = "\n".join([
    'console.log("hi", 2, true, null, undefined, [1, "a"], {a: 1});',
    'console.info("i");',
    'console.warn("w");',
    'console.error(new TypeError("bad"));',
    "const ring = {}; ring.self = ring; console.log(ring);",
    'Promise.reject(new Error("nope"));',
    'throw new RangeError("boom");',
])
CONSOLE_EXPECTED = [
    'log hi 2 true null undefined [1,"a"] {"a":1}',
    "info i",
    "warn w",
    "error TypeError: bad",
    "log [unserialisable object]",
    "uncaught RangeError: boom (line 7)",
    "uncaught Unhandled rejection: nope",
]

SLIDER_VERSIONS = [
    {"html": "<p>a</p>", "css": "", "js": ""},
    {"html": "<p>a</p>\n<p>bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</p>", "css": "", "js": ""},
    {"html": "<p>a</p>\n<p>bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</p>", "css": "p { margin: 0 }", "js": ""},
    {"html": "<p>z</p>\n<p>bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb</p>", "css": "p { margin: 0 }",
     "js": "console.log(1)"},
]
SLIDER_TIMES = ["2026-11-01T08:15:00.000Z", "2026-11-01T09:20:00.000Z",
                "2026-11-02T10:25:00.000Z", "2026-11-03T14:02:00.000Z"]
COMPARE_VERSIONS = [
    {"html": "<h1>Arch</h1>\n<p>keystone</p>", "css": "h1 { color: black }", "js": ""},
    {"html": "<h1>Arch</h1>\n<p>voussoir</p>\n<p>springer</p>", "css": "h1 { color: black }",
     "js": "console.log(2)"},
    {"html": "<h1>Vault</h1>\n<p>voussoir</p>", "css": "h1 { color: black }\np { margin: 0 }",
     "js": "console.log(2)"},
]
CRLF_FILES = {
    "html": "<main>\r\n  <p>  spaced  </p>\r\n</main>\r\n",
    "css": "\tbody { margin: 0 }\r\n\r\n",
    "js": "const s = 'é✓';  \nconsole.log(s)\n",
}
FORBIDDEN_DATASTORES = {"sqlite3", "better-sqlite3", "sql.js", "level", "leveldown", "classic-level", "lmdb",
                        "redis", "ioredis", "lowdb", "nedb", "@seald-io/nedb", "meilisearch",
                        "@elastic/elasticsearch", "typesense", "lokijs", "pouchdb"}


def tok(prefix: str = "t") -> str:
    first, second = unique(prefix)
    return hashlib.sha256(f"{first}|{second}|{uuid.uuid4().hex}".encode()).hexdigest()[:10]


def person(role: str, verified: bool = True) -> dict[str, Any]:
    handle = f"{role}-{tok(role)}"
    return {"handle": handle, "email": f"{handle}@example.test", "password": PASSWORD, "verified": verified}


def random_pen_id() -> str:
    return "".join(secrets.choice("abcdefghijklmnopqrstuvwxyz0123456789") for _ in range(10))


def files(html: str = "", css: str = "", js: str = "") -> dict[str, str]:
    return {"html": html, "css": css, "js": js}


EMPTY = files()


def version(f: dict[str, str], libraries: tuple[str, ...] | list[str] = (), created_at: str | None = None) -> dict:
    body: dict[str, Any] = {"files": dict(f), "libraries": list(libraries)}
    if created_at is not None:
        body["created_at"] = created_at
    return body


def pen(key: str, owner: dict, title: str, visibility: str = "private", tags=(), versions=(), forked_from=None) -> dict:
    body: dict[str, Any] = {"key": key, "owner": owner["handle"], "title": title, "visibility": visibility,
                            "tags": list(tags), "versions": list(versions)}
    if forked_from is not None:
        body["forked_from"] = forked_from
    return body


def seed(base: str, users=(), pens=(), likes=(), collections=()) -> dict:
    body = {"users": list(users), "pens": list(pens), "likes": list(likes), "collections": list(collections)}
    r = httpx.post(f"{base}/api/grading/seed", json=body, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201, f"POST /api/grading/seed answered {r.status_code}: {r.text}"
    return r.json()


def one_pen(base: str, versions, *, visibility: str = "private", title: str | None = None, tags=(),
            verified: bool = True, role: str = "author") -> tuple[dict, str, str]:
    owner = person(role, verified)
    title = title or f"Study {tok()}"
    ids = seed(base, users=[owner], pens=[pen("p", owner, title, visibility, tags, versions)])
    return owner, ids["pens"]["p"], title


def config(base: str) -> dict:
    r = httpx.get(f"{base}/api/config", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, f"GET /api/config answered {r.status_code}"
    return r.json()


class Api:
    def __init__(self, base: str, handle: str | None = None) -> None:
        self.base = base
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        if handle is not None:
            r = self.http.post("/api/grading/session", json={"handle": handle})
            assert r.status_code == 200, f"POST /api/grading/session for {handle} answered {r.status_code}: {r.text}"

    def call(self, method: str, path: str, body: Any = None, key: str | None = None,
             headers: dict[str, str] | None = None) -> httpx.Response:
        h = dict(headers or {})
        if key is not None:
            h["Idempotency-Key"] = key
        if body is None:
            return self.http.request(method, path, headers=h)
        return self.http.request(method, path, json=body, headers=h)

    def ok(self, method: str, path: str, body: Any = None, status: int = 200, key: str | None = None) -> Any:
        r = self.call(method, path, body, key)
        assert r.status_code == status, f"{method} {path} answered {r.status_code}, expected {status}: {r.text}"
        return r.json() if r.content else None

    def pen(self, pen_id: str) -> dict:
        return self.ok("GET", f"/api/pens/{pen_id}")

    def versions(self, pen_id: str) -> list[dict]:
        return self.ok("GET", f"/api/pens/{pen_id}/versions")["versions"]

    def save(self, pen_id: str, base_version: int, f: dict, libraries=(), key: str | None = None) -> httpx.Response:
        return self.call("POST", f"/api/pens/{pen_id}/versions",
                         {"base_version": base_version, "files": f, "libraries": list(libraries)}, key=key)


def assert_error(r: httpx.Response, status: int, code: str, what: str) -> dict:
    assert r.status_code == status, f"{what}: expected {status} {code}, got {r.status_code}: {r.text}"
    body = r.json()
    assert body.get("error") == code and isinstance(body.get("message"), str), f"{what}: error body {body}"
    assert set(body) <= {"error", "message", "fields", "head"}, f"{what}: unpublished error fields {body}"
    return body


def assert_not_found(r: httpx.Response, what: str) -> None:
    assert r.status_code == 404 and r.json() == NOT_FOUND, f"{what}: expected the 404 not_found body, got {r.status_code}: {r.text}"


def canonical_sha(f: dict[str, str], libraries) -> str:
    out = b""
    for p in PANES:
        data = f[p].encode("utf-8")
        out += f"{p} {len(data)}\n".encode() + data + b"\n"
    out += f"libraries {','.join(libraries)}\n".encode()
    return hashlib.sha256(out).hexdigest()


def snapshot(pen_id: str, number: int) -> dict:
    return json.loads(S3().get(f"pens/{pen_id}/versions/{number}.json").decode("utf-8"))


def split_lines(s: str) -> list[str]:
    return [] if s == "" else s.split("\n")


def diff_rows(old: str, new: str) -> list[tuple[str, str]]:
    a, b = split_lines(old), split_lines(new)
    n, m = len(a), len(b)
    lcs = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(n - 1, -1, -1):
        for j in range(m - 1, -1, -1):
            lcs[i][j] = lcs[i + 1][j + 1] + 1 if a[i] == b[j] else max(lcs[i + 1][j], lcs[i][j + 1])
    rows: list[tuple[str, str]] = []
    removed: list[tuple[str, str]] = []
    added: list[tuple[str, str]] = []
    i = j = 0
    for _ in range(n + m):
        if i >= n or j >= m:
            break
        if a[i] == b[j] and lcs[i][j] == lcs[i + 1][j + 1] + 1:
            rows += removed + added
            removed, added = [], []
            rows.append(("same", a[i]))
            i, j = i + 1, j + 1
        elif lcs[i + 1][j] >= lcs[i][j + 1]:
            removed.append(("removed", a[i]))
            i += 1
        else:
            added.append(("added", b[j]))
            j += 1
    removed += [("removed", x) for x in a[i:]]
    added += [("added", x) for x in b[j:]]
    return rows + removed + added


def compare_versions(old: dict, new: dict) -> tuple[int, int, int, dict]:
    panes = {}
    for p in PANES:
        rows = diff_rows(old[p], new[p])
        panes[p] = {"added": sum(1 for c, _ in rows if c == "added"),
                    "removed": sum(1 for c, _ in rows if c == "removed"), "rows": rows}
    added = sum(panes[p]["added"] for p in PANES)
    removed = sum(panes[p]["removed"] for p in PANES)
    chars = sum(len(t) for p in PANES for c, t in panes[p]["rows"] if c != "same")
    return added, removed, chars, panes


def counts_text(added: int, removed: int) -> str:
    return f"+{added} {MINUS}{removed}"


def band_height(chars: int) -> float:
    return BAND_BASE_PX + BAND_LOG_PX * math.log2(1 + chars)


def mails_to(mail: Mailpit, address: str, count: int, match: Callable[[dict], bool] = lambda m: True,
             seconds: float = WAIT_S) -> list[dict]:
    def pick(settle_s: float) -> list[dict]:
        return [m for m in mail.messages(expected=0, settle=settle_s)
                if address.lower() in [a.lower() for a in addresses(m.get("To"))] and match(m)]

    deadline = time.monotonic() + seconds
    found: list[dict] = []
    while time.monotonic() < deadline:
        found = pick(POLL_SETTLE_S)
        if len(found) >= count:
            break
    return pick(MAIL_SETTLE_S) if count == 0 or len(found) >= count else found


def verify_link(message: dict) -> str:
    match = re.search(r"Open this link to verify your email: (\S+/verify\?token=\S+)", mail_text(message))
    assert match, f"verification body lacks the published link line: {mail_text(message)!r}"
    return match.group(1)


def token_of(link: str) -> str:
    return parse_qs(urlparse(link).query)["token"][0]


def wait_api(probe: Callable[[], Any], ok: Callable[[Any], bool], what: str, seconds: float = WAIT_S) -> Any:
    deadline = time.monotonic() + seconds
    seen: Any = None
    while time.monotonic() < deadline:
        seen = probe()
        if ok(seen):
            return seen
    pytest.fail(f"{what}; last observed {seen!r}")


def sign_in(page: Page, base: str, handle: str) -> None:
    r = page.request.post(f"{base}/api/grading/session", data={"handle": handle})
    assert r.status == 200, f"POST /api/grading/session for {handle} answered {r.status}"


@contextmanager
def opened(browser: Browser, base: str, path: str, handle: str | None = None, size: dict | None = None,
           reduced_motion: str = "no-preference") -> Iterator[Page]:
    with open_app(browser, f"{base}/api/health", reduced_motion=reduced_motion) as page:
        page.set_viewport_size(size or WIDE)
        if handle is not None:
            sign_in(page, base, handle)
        page.goto(f"{base}{path}")
        yield page


def wait_for(page: Page, probe: Callable[[], Any], ok: Callable[[Any], bool], what: str,
             seconds: float = WAIT_S, step_ms: float = STEP_MS) -> Any:
    deadline = time.monotonic() + seconds
    seen: Any = None
    while time.monotonic() < deadline:
        try:
            seen = probe()
        except PlaywrightError as exc:
            seen = f"<{type(exc).__name__}: {str(exc).splitlines()[0] if str(exc) else ''}>"
        else:
            if ok(seen):
                return seen
        if step_ms:
            advance(page, step_ms)
        else:
            page.evaluate("() => 0")
    pytest.fail(f"{what}; last observed {seen!r}")


def text_of(loc: Locator) -> str | None:
    if loc.count() == 0:
        return None
    return loc.first.inner_text(timeout=PROBE_MS).strip()


def wait_text(page: Page, loc: Locator, expected: str, what: str, **kw: Any) -> None:
    wait_for(page, lambda: text_of(loc), lambda v: v == expected, f"{what}: expected {expected!r}", **kw)


def wait_path(page: Page, pattern: str, what: str, **kw: Any) -> str:
    return wait_for(page, lambda: urlparse(page.url).path, lambda p: re.fullmatch(pattern, p) is not None, what, **kw)


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def preview(page: Page) -> Locator:
    return page.get_by_role("region", name="Preview", exact=True)


def pane(page: Page, key: str, include_hidden: bool = False) -> Locator:
    return page.get_by_role("textbox", name=f"{PANE_LABEL[key]} code", exact=True, include_hidden=include_hidden)


def sep(page: Page, name: str) -> Locator:
    return page.get_by_role("separator", name=name, exact=True)


def band(page: Page, n: int) -> Locator:
    return page.locator(f'[data-version="{n}"]').first


def restore_name(n: int) -> str:
    return f"Restore version {n}"


def pane_text(loc: Locator) -> str:
    return loc.evaluate(PANE_TEXT_JS)


def replace_pane(page: Page, key: str, value: str) -> None:
    pane(page, key).focus()
    page.keyboard.press("Control+a")
    page.keyboard.press("Delete")
    page.keyboard.type(value)


def render_seq(page: Page) -> int:
    hooks = page.get_by_role("region", name="Preview", exact=True, include_hidden=True)
    raw = hooks.first.get_attribute("data-render-seq", timeout=PROBE_MS)
    return int(raw) if raw and raw.isdigit() else 0


def wait_render(page: Page, at_least: int, what: str) -> int:
    return wait_for(page, lambda: render_seq(page), lambda v: v >= at_least, what)


def console_entries(page: Page) -> list[str]:
    log = page.get_by_role("log", name="Console", exact=True)
    return [t.strip() for t in log.get_by_role("listitem").all_inner_texts()]


def press_save(page: Page) -> None:
    page.keyboard.press("Control+s")


def wait_saved(page: Page, n: int) -> None:
    wait_text(page, status(page, "Save status"), f"Saved as version {n}", "the Save status after a save")


def set_focus_on(page: Page, loc: Locator) -> None:
    loc.focus()
    expect(loc).to_be_focused()


def focusable(loc: Locator) -> bool:
    return bool(loc.evaluate(FOCUS_PROBE_JS))


def directives(csp: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in csp.split(";"):
        bits = part.strip().split()
        if bits:
            out[bits[0].lower()] = bits[1:]
    return out


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


@contextmanager
def app_copy(overrides: dict[str, str], drop: tuple[str, ...] = ()) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {k: v for k, v in os.environ.items() if k not in drop}
    env.update(overrides)
    env["APP_PUBLIC_PORT"] = str(port)
    env["APP_PUBLIC_URL"] = base
    log = tempfile.NamedTemporaryFile(prefix="ashlar-copy-", suffix=".log", delete=False)
    proc = subprocess.Popen(manifest["serve"], shell=True, cwd=str(DEPLOYED_APP), env=env, stdout=log,
                            stderr=subprocess.STDOUT, start_new_session=True)

    def tail() -> str:
        return Path(log.name).read_text(errors="replace")[-4000:]

    try:
        deadline = time.monotonic() + BOOT_S
        up = False
        while time.monotonic() < deadline and not up:
            try:
                proc.wait(timeout=BOOT_POLL_S)
                pytest.fail(f"the app copy exited with {proc.returncode} before answering /api/health:\n{tail()}")
            except subprocess.TimeoutExpired:
                pass
            try:
                up = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT_S).status_code == 200
            except httpx.HTTPError:
                up = False
        if not up:
            pytest.fail(f"the app copy never answered GET /api/health with 200 on APP_PUBLIC_PORT:\n{tail()}")
        yield base
        if proc.poll() is not None:
            pytest.fail(f"the app copy exited with {proc.returncode} during the test:\n{tail()}")
    finally:
        try:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_TIMEOUT_S)
        except (ProcessLookupError, subprocess.TimeoutExpired):
            try:
                os.killpg(proc.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
        log.close()


class Relay:

    def __init__(self, host: str, port: int) -> None:
        self.target = (host, port)
        self.port = free_port()
        self.listener: socket.socket | None = None
        self.peers: list[socket.socket] = []
        self.lock = threading.Lock()

    def start(self) -> None:
        s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        s.bind(("127.0.0.1", self.port))
        s.listen(64)
        self.listener = s
        threading.Thread(target=self._accept, args=(s,), daemon=True).start()

    def _accept(self, s: socket.socket) -> None:
        for _ in range(RELAY_MAX_CONNECTIONS):
            try:
                client, _ = s.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT_S)
            except OSError:
                client.close()
                continue
            upstream.settimeout(None)
            with self.lock:
                self.peers += [client, upstream]
            for src, dst in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        for _ in range(RELAY_MAX_CHUNKS):
            try:
                data = src.recv(65536)
            except OSError:
                break
            if not data:
                break
            try:
                dst.sendall(data)
            except OSError:
                break
        for sock in (src, dst):
            try:
                sock.shutdown(socket.SHUT_RDWR)
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
        with self.lock:
            peers, self.peers = self.peers, []
        for p in peers:
            try:
                p.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            p.close()


@contextmanager
def silent_listener() -> Iterator[tuple[int, list]]:
    hits: list = []
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    s.bind(("127.0.0.1", 0))
    s.listen(16)

    def accept() -> None:
        for _ in range(RELAY_MAX_CONNECTIONS):
            try:
                conn, peer = s.accept()
            except OSError:
                return
            hits.append(peer)
            conn.close()

    threading.Thread(target=accept, daemon=True).start()
    try:
        yield s.getsockname()[1], hits
    finally:
        try:
            s.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        s.close()


def test_wf_cross_cutting_manifest_health_config(app_url):
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key], f"run.json lacks a string {key}"
    health = httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}, health.text
    cfg = config(app_url)
    assert set(CONFIG_KEYS) <= set(cfg), f"/api/config keys {sorted(cfg)}"
    assert cfg["live_poll_ms"] == LIVE_POLL_MS
    assert PREVIEW_MIN_MS <= cfg["preview_delay_ms"] <= PREVIEW_MAX_MS
    for key in CONFIG_KEYS:
        assert isinstance(cfg[key], int), f"{key} should be a number, got {cfg[key]!r}"
    probe = {
        "ASHLAR_PREVIEW_DELAY_MS": "700",
        "ASHLAR_DRAFT_INTERVAL_MS": "4321",
        "ASHLAR_SEARCH_DEBOUNCE_MS": "275",
        "ASHLAR_LOOP_LIMIT": "4321",
        "ASHLAR_PANE_LIMIT_BYTES": "12345",
        "ASHLAR_MAX_TAGS": "4",
    }
    with app_copy(probe) as copy:
        copy_cfg = config(copy)
        assert copy_cfg["preview_delay_ms"] == int(probe["ASHLAR_PREVIEW_DELAY_MS"])
        assert copy_cfg["draft_interval_ms"] == int(probe["ASHLAR_DRAFT_INTERVAL_MS"])
        assert copy_cfg["search_debounce_ms"] == int(probe["ASHLAR_SEARCH_DEBOUNCE_MS"])
        assert copy_cfg["loop_limit"] == int(probe["ASHLAR_LOOP_LIMIT"])
        assert copy_cfg["pane_limit_bytes"] == int(probe["ASHLAR_PANE_LIMIT_BYTES"])
        assert copy_cfg["max_tags"] == int(probe["ASHLAR_MAX_TAGS"])
        assert copy_cfg["live_poll_ms"] == LIVE_POLL_MS


def test_wf_cross_cutting_grading_routes(app_url):
    ada, bob = person("ada"), person("bob", verified=False)
    v1 = files(html="<p>hi</p>\r\n", css="p {\r\n\tcolor: red;\r\n}", js="")
    v2 = files(html="<p>hi</p>\r\n<p>again</p>", css=v1["css"], js="console.log('x')  ")
    created = ["2026-11-03T14:02:00.000Z", "2026-11-03T14:05:00.000Z"]
    title = f"Arches {tok()}"
    ids = seed(app_url, users=[ada, bob],
               pens=[pen("p0", ada, title, "public", ["css"],
                         [version(v1, [], created[0]), version(v2, ["dayjs@1.11.13"], created[1])]),
                     pen("p1", bob, f"{title} fork", "unlisted", [], [version(v2, ["dayjs@1.11.13"])],
                         forked_from={"key": "p0", "version": 2})],
               likes=[{"user": bob["handle"], "pen": "p0"}],
               collections=[{"key": "c1", "owner": ada["handle"], "title": "Studies", "pens": ["p0"]}])
    assert set(ids["users"]) == {ada["handle"], bob["handle"]}
    p0, p1 = ids["pens"]["p0"], ids["pens"]["p1"]
    assert PEN_ID.fullmatch(p0) and PEN_ID.fullmatch(p1) and PEN_ID.fullmatch(ids["collections"]["c1"])

    a, b = Api(app_url, ada["handle"]), Api(app_url, bob["handle"])
    me = a.ok("GET", "/api/me")["user"]
    assert me["handle"] == ada["handle"] and me["verified"] is True and me["email"] == ada["email"]
    assert b.ok("GET", "/api/me")["user"]["verified"] is False
    src = a.pen(p0)
    assert (src["head"], src["likes"], src["forks"], src["visibility"], src["tags"], src["owner"]) == \
        (2, 1, 1, "public", ["css"], ada["handle"])
    assert src["version"]["files"] == v2 and src["version"]["libraries"] == ["dayjs@1.11.13"]
    assert [(e["number"], e["created_at"]) for e in a.versions(p0)] == [(1, created[0]), (2, created[1])]
    for n, f, libs in ((1, v1, []), (2, v2, ["dayjs@1.11.13"])):
        snap = snapshot(p0, n)
        assert snap["files"] == f and snap["libraries"] == libs, f"snapshot {n} is not byte-exact"
        assert snap["sha256"] == canonical_sha(f, libs)
    fork = b.pen(p1)
    assert fork["forked_from"]["pen_id"] == p0 and fork["forked_from"]["version"] == 2
    assert fork["forked_from"]["title"] == title and fork["forked_from"]["owner"] == ada["handle"]
    coll = a.ok("GET", f"/api/collections/{ids['collections']['c1']}")
    assert [p["id"] for p in coll["pens"]] == [p0]

    r = httpx.post(f"{app_url}/api/grading/session", json={"handle": person("ghost")["handle"]}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 404
    again = httpx.post(f"{app_url}/api/grading/seed", json={"users": [ada]}, timeout=HTTP_TIMEOUT_S)
    assert_error(again, 409, "duplicate", "seeding an existing handle")

    newcomer = person("late")
    with app_copy({"ASHLAR_GRADING": "0"}) as off:
        unknown = httpx.post(f"{off}/api/{tok()}", json={}, timeout=HTTP_TIMEOUT_S)
        seeded = httpx.post(f"{off}/api/grading/seed", json={"users": [newcomer]}, timeout=HTTP_TIMEOUT_S)
        sess = httpx.post(f"{off}/api/grading/session", json={"handle": ada["handle"]}, timeout=HTTP_TIMEOUT_S)
        assert seeded.status_code == 404 and sess.status_code == 404
        assert seeded.content == unknown.content and sess.content == unknown.content, \
            "grading routes must answer exactly like an unknown path when ASHLAR_GRADING is not 1"
        assert SET_COOKIE not in sess.headers
    r = httpx.post(f"{app_url}/api/grading/session", json={"handle": newcomer["handle"]}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 404, "the disabled seed route created a user"


def test_wf_cross_cutting_error_precedence(app_url):
    t = tok()
    owner, other, unv = person("owner"), person("other"), person("unv", verified=False)
    v = [version(files(html="<p>one</p>"))]
    ids = seed(app_url, users=[owner, other, unv],
               pens=[pen("priv", owner, f"Private {t}", "private", versions=v),
                     pen("pub", owner, f"Public {t}", "public", versions=v),
                     pen("mine", unv, f"Mine {t}", "private", versions=v)])
    priv, pub, mine = ids["pens"]["priv"], ids["pens"]["pub"], ids["pens"]["mine"]
    limit = config(app_url)["pane_limit_bytes"]
    anon, o, w, u = Api(app_url), Api(app_url, other["handle"]), Api(app_url, owner["handle"]), Api(app_url, unv["handle"])
    missing = random_pen_id()

    huge = files(html="x" * (DEFAULT_BODY_LIMIT + 1))
    assert_error(anon.save(priv, 1, huge), 413, "body_too_large", "an oversized anonymous save")
    assert_error(anon.save(missing, 1, files()), 401, "not_signed_in", "an anonymous save to a missing pen")
    assert_not_found(o.save(priv, 1, files(html="x")), "a save to someone else's private pen")
    assert_not_found(o.save(missing, 1, files(html="x")), "a save to a missing pen")
    assert_error(o.save(pub, 1, files(html="x")), 403, "forbidden", "a save to someone else's public pen")
    assert_error(u.save(mine, 0, files(html="x")), 403, "unverified", "an unverified stale save")
    over = files(html="y" * (limit + 1))
    body = assert_error(w.save(priv, 0, over), 409, "version_conflict", "a stale oversized save")
    assert body["head"] == 1
    body = assert_error(w.save(priv, 1, over), 422, "validation", "an oversized save")
    assert isinstance(body.get("fields"), dict) and body["fields"], f"validation lacks fields: {body}"
    assert [e["number"] for e in w.versions(priv)] == [1]

    taken = anon.call("POST", "/api/signup", {"handle": owner["handle"], "email": f"x{t}@example.test",
                                              "password": "short"})
    body = assert_error(taken, 409, "duplicate", "sign-up with a taken handle and a bad password")
    assert isinstance(body.get("fields"), dict)
    bad = anon.call("POST", "/api/signup", {"handle": "A!", "email": "nope", "password": "short"})
    body = assert_error(bad, 422, "validation", "sign-up with invalid fields")
    assert {"handle", "email", "password"} <= set(body["fields"])

    down = os.environ["APP_STORAGE_DOWN_URL"]
    d_owner = person("down")
    dp = seed(down, users=[d_owner], pens=[pen("p", d_owner, f"Down {t}")])["pens"]["p"]
    da = Api(down, d_owner["handle"])
    down_limit = config(down)["pane_limit_bytes"]
    assert_error(da.save(dp, 0, files(html="y" * (down_limit + 1))), 422, "validation", "oversized save while storage is down")
    assert_error(da.save(dp, 0, files(html="ok")), 503, "storage_unavailable", "a valid save while storage is down")


def test_wf_cross_cutting_server_boundary(app_url):
    body_limit = 60000
    owner = person("owner")
    with app_copy({"ASHLAR_GRADING": "1", "ASHLAR_BODY_LIMIT_BYTES": str(body_limit)}) as copy:
        ids = seed(copy, users=[owner], pens=[pen("p", owner, f"Edge {tok()}", "public",
                                                    versions=[version(files(html="<p>edge</p>"))])])
        pen_id = ids["pens"]["p"]
        raw = json.dumps({"html": "<p>x</p>", "css": "", "js": "", "libraries": []})
        exact = (raw + " " * (body_limit - len(raw))).encode()
        assert len(exact) == body_limit
        r = httpx.post(f"{copy}/api/renders", content=exact, headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 201, f"a body exactly at the limit must be accepted: {r.status_code} {r.text}"
        r = httpx.post(f"{copy}/api/renders", content=exact + b" ", headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT_S)
        assert_error(r, 413, "body_too_large", "a body one byte over the limit")

        api = Api(copy)
        sess = api.http.post("/api/grading/session", json={"handle": owner["handle"]})
        cookie = [c for c in sess.headers.get_list(SET_COOKIE) if c.startswith("ashlar_session=")]
        assert cookie, f"no ashlar_session cookie: {sess.headers.get_list(SET_COOKIE)}"
        attrs = {a.strip().lower() for a in cookie[0].split(";")[1:]}
        wanted = {a.strip().lower() for a in COOKIE_ATTRS.split(";")}
        assert wanted <= attrs, cookie[0]
        signin = httpx.post(f"{copy}/api/signin", json={"email": owner["email"], "password": PASSWORD}, timeout=HTTP_TIMEOUT_S)
        assert signin.status_code == 200 and any(c.startswith("ashlar_session=") for c in signin.headers.get_list(SET_COOKIE))

        before = api.pen(pen_id)["title"]
        for origin in ("http://evil.example.test", "null"):
            r = api.call("PATCH", f"/api/pens/{pen_id}", {"title": f"Hijacked {tok()}"}, headers={"Origin": origin})
            body = assert_error(r, 403, "forbidden", f"a cookie write from Origin {origin}")
            assert body["message"] == "Cross-site request refused."
        assert api.pen(pen_id)["title"] == before
        r = api.call("PATCH", f"/api/pens/{pen_id}", {"title": f"Same site {tok()}"}, headers={"Origin": copy})
        assert r.status_code == 200, r.text
        r = api.call("PATCH", f"/api/pens/{pen_id}", {"title": f"No origin {tok()}"})
        assert r.status_code == 200, r.text
        bogus = httpx.post(f"{copy}/api/pens", json={}, headers={"Origin": "http://evil.example.test", "Cookie": "ashlar_session=bogus"}, timeout=HTTP_TIMEOUT_S)
        assert_error(bogus, 403, "forbidden", "a cross-site write with a stale cookie, before the sign-in check")
        big = api.call("PATCH", f"/api/pens/{pen_id}", {"title": "x" * body_limit}, headers={"Origin": "http://evil.example.test"})
        assert_error(big, 413, "body_too_large", "an oversized cross-site write")
        exempt = httpx.post(f"{copy}/api/signin", json={"email": owner["email"], "password": "wrong-password-1"},
                            headers={"Origin": "http://evil.example.test"}, timeout=HTTP_TIMEOUT_S)
        assert_error(exempt, 401, "bad_credentials", "a cookieless cross-site sign-in is exempt")

        cors = httpx.get(f"{copy}/api/config", headers={"Origin": "http://evil.example.test"}, timeout=HTTP_TIMEOUT_S)
        assert CORS_HEADER not in cors.headers
        pre = httpx.options(f"{copy}/api/pens", headers={"Origin": "http://evil.example.test",
                                                          "Access-Control-Request-Method": "POST"}, timeout=HTTP_TIMEOUT_S)
        assert CORS_HEADER not in pre.headers

        page_resp = httpx.get(f"{copy}/explore", timeout=HTTP_TIMEOUT_S)
        xfo = page_resp.headers.get(FRAME_HEADER, "").strip().upper()
        fa = directives(page_resp.headers.get("content-security-policy", "")).get("frame-ancestors")
        assert xfo in ("DENY", "SAMEORIGIN") or (fa is not None and "*" not in fa and all(
            t in ("'none'", "'self'") or same_origin(t, copy) for t in fa)), "pages other than /embed must refuse framing"
        embed = httpx.get(f"{copy}/embed/{pen_id}", timeout=HTTP_TIMEOUT_S)
        assert embed.status_code == 200
        efa = directives(embed.headers.get("content-security-policy", "")).get("frame-ancestors")
        assert FRAME_HEADER not in embed.headers and (efa is None or "*" in efa or any(s in efa for s in SCHEME_SOURCES))

        for path in ("/run.json", "/package.json", "/tsconfig.json", "/.env", "/src/server.ts"):
            r = httpx.get(f"{copy}{path}", timeout=HTTP_TIMEOUT_S)
            assert r.status_code == 404 and "run-manifest-v1" not in r.text, f"{path} must not be served"
        secrets_set = [os.environ.get(k, "") for k in ("S3_SECRET_ACCESS_KEY",)]
        db_password = urlparse(os.environ.get("DATABASE_URL", "")).password or ""
        secrets_set = [s for s in secrets_set + [db_password] if len(s) >= 4]
        landing = httpx.get(f"{copy}/", timeout=HTTP_TIMEOUT_S).text
        assets = set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', landing))
        bodies = [landing, page_resp.text, httpx.get(f"{copy}/api/config", timeout=HTTP_TIMEOUT_S).text]
        bodies += [httpx.get(f"{copy}{a}", timeout=HTTP_TIMEOUT_S).text for a in assets]
        for secret in secrets_set:
            assert all(secret not in b for b in bodies), "a credential value is served to the browser"

    mail_down = os.environ["APP_MAIL_DOWN_URL"]
    h = httpx.get(f"{mail_down}/api/health", timeout=HTTP_TIMEOUT_S)
    assert h.status_code == 200 and h.json() == {"status": "unavailable"}
    assert httpx.get(f"{mail_down}/", timeout=HTTP_TIMEOUT_S).status_code == 200


def test_wf_keyboard_authoring_first_pen(browser, app_url):
    author = person("author")
    seed(app_url, users=[author])
    html, css, js = "Stone courses", "p{color:red}", f'document.title="{TYPED_TITLE}"'
    with opened(browser, app_url, "/dashboard", author["handle"]) as page:
        expect(page.get_by_text(DASHBOARD_EMPTY, exact=True)).to_be_visible()
        start = page.get_by_role("button", name="Start a pen", exact=True).first
        start.focus()
        page.keyboard.press("Enter")
        path = wait_path(page, r"/pen/[a-z0-9]{10}", "Start a pen lands on /pen/<new pen id>")
        pen_id = path.rsplit("/", 1)[1]
        expect(page.get_by_text("Not saved yet", exact=True)).to_be_visible()
        seq = wait_render(page, 1, "the new pen's first render")
        for key, value in (("html", html), ("css", css), ("js", js)):
            pane(page, key).focus()
            page.keyboard.type(value)
        wait_for(page, lambda: preview(page).get_attribute("data-preview-text"), lambda v: v == html,
                 "the preview renders the typed HTML after the pause")
        assert render_seq(page) > seq
        assert preview(page).get_attribute("data-preview-title") == TYPED_TITLE
        press_save(page)
        wait_saved(page, 1)
        expect(page.get_by_text("Version 1", exact=True)).to_be_visible()
        assert urlparse(page.url).path == f"/pen/{pen_id}"

        stored = Api(app_url, author["handle"]).pen(pen_id)
        assert stored["head"] == 1 and stored["version"]["files"] == files(html, css, js)
        assert snapshot(pen_id, 1)["files"] == files(html, css, js)

        page.goto(f"{app_url}/dashboard")
        rows = page.get_by_role("list", name="Your pens").get_by_role("listitem")
        row = rows.filter(has=page.get_by_role("link", name="Untitled pen", exact=True))
        expect(row).to_have_count(1)
        expect(row).to_contain_text("Version 1")
        expect(row).to_contain_text("Updated ")
        row.get_by_role("link", name="Untitled pen", exact=True).click()
        wait_path(page, rf"/pen/{pen_id}", "the dashboard row links to the editor")
        wait_render(page, 1, "the reopened editor renders")
        for key, value in (("html", html), ("css", css), ("js", js)):
            assert pane_text(pane(page, key)) == value, f"{key} pane after reload"


def test_wf_keyboard_authoring_pane_keys(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="x"))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "the editor's first render")
        html = pane(page, "html")
        html.focus()
        page.keyboard.press("Escape")
        page.keyboard.press("ArrowLeft")
        page.keyboard.press("Tab")
        expect(html).to_be_focused()
        assert INDENT in pane_text(html), "a key after Escape must cancel the leave arming, so Tab indents"

        page.keyboard.press("Control+a")
        page.keyboard.press("Delete")
        page.keyboard.type(PANE_LINES[0])
        page.keyboard.press("Enter")
        page.keyboard.type(PANE_LINES[1])
        plain = "\n".join(PANE_LINES)
        indented = "\n".join(INDENT + line for line in PANE_LINES)
        trailing = plain + INDENT
        page.keyboard.press("Control+a")
        page.keyboard.press("Tab")
        assert pane_text(html) == indented
        page.keyboard.press("Shift+Tab")
        assert pane_text(html) == plain
        page.keyboard.press("Control+End")
        page.keyboard.press("Tab")
        assert pane_text(html) == trailing
        page.keyboard.press("Home")
        page.keyboard.press("Tab")
        assert pane_text(html) == PANE_LINES[0] + "\n" + INDENT + PANE_LINES[1] + INDENT
        page.keyboard.press("Shift+Tab")
        assert pane_text(html) == trailing

        page.keyboard.press("Escape")
        page.keyboard.press("Tab")
        expect(sep(page, "Resize HTML and CSS")).to_be_focused()
        html.focus()
        page.keyboard.press("Escape")
        page.keyboard.press("Shift+Tab")
        expect(sep(page, "Resize preview and code")).to_be_focused()
        pane(page, "css").focus()
        page.keyboard.press("Escape")
        page.keyboard.press("Shift+Tab")
        expect(sep(page, "Resize HTML and CSS")).to_be_focused()
        pane(page, "js").focus()
        page.keyboard.press("Escape")
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Console", exact=True)).to_be_focused()

        set_focus_on(page, page.get_by_role("button", name="Share", exact=True))
        press_save(page)
        wait_saved(page, 2)
        pane(page, "js").focus()
        page.keyboard.type("z")
        set_focus_on(page, sep(page, "Resize CSS and JS"))
        press_save(page)
        wait_saved(page, 3)
        api = Api(app_url, owner["handle"])
        assert api.ok("GET", f"/api/pens/{pen_id}/versions/2")["files"]["html"] == trailing
        assert api.ok("GET", f"/api/pens/{pen_id}/versions/3")["files"]["js"] == "z"


def test_wf_keyboard_authoring_preview_timing(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>one</p>", js='document.title = "first";'))])
    delay = config(app_url)["preview_delay_ms"]
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "the first render after load")
        wait_for(page, lambda: preview(page).get_attribute("data-preview-text"), lambda v: v == "one", "first render text")
        assert render_seq(page) == 1, "data-render-seq starts at 1"
        assert preview(page).get_attribute("data-preview-title") == "first"
        expect(status(page, "Preview status")).to_have_text("Preview updated")
        advance(page, delay * 2)
        assert render_seq(page) == 1, "no render without an edit"

        starts: list[str] = []

        def track(req) -> None:
            path = urlparse(req.url).path
            if path == "/api/renders" or path.startswith("/preview/"):
                starts.append(req.url)

        page.on("request", track)
        replace_pane(page, "html", "tw")
        advance(page, delay - 1)
        page.keyboard.type("o")
        advance(page, delay - 1)
        page.evaluate("() => 0")
        assert starts == [], f"a render started before {delay} ms after the last edit: {starts}"
        assert render_seq(page) == 1
        advance(page, 1)
        wait_for(page, lambda: render_seq(page), lambda v: v == 2, "a render once the delay after the last edit passed")
        assert preview(page).get_attribute("data-preview-text") == "two"
        assert preview(page).get_attribute("data-preview-title") == "first"
        expect(status(page, "Preview status")).to_have_text("Preview updated")
        advance(page, delay * 2)
        assert render_seq(page) == 2, "one edit burst renders exactly once"


def test_wf_keyboard_authoring_byte_exact(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>v1</p>"))])
    api = Api(app_url, owner["handle"])
    libs = ["lodash@4.17.21", "dayjs@1.11.13"]
    r = api.save(pen_id, 1, CRLF_FILES, libs)
    assert r.status_code == 201, r.text
    saved = r.json()
    assert saved["number"] == 2 and saved["files"] == CRLF_FILES and saved["libraries"] == libs
    assert saved["sha256"] == canonical_sha(CRLF_FILES, libs) and re.fullmatch(r"[0-9a-f]{64}", saved["sha256"])
    snap = snapshot(pen_id, 2)
    assert snap["files"] == CRLF_FILES and snap["libraries"] == libs and snap["sha256"] == saved["sha256"]
    assert snap["number"] == 2 and snap["pen_id"] == pen_id
    assert api.ok("GET", f"/api/pens/{pen_id}/versions/2")["files"] == CRLF_FILES

    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "the editor loads version 2")
        js = pane(page, "js")
        js.focus()
        page.keyboard.press("Control+End")
        page.keyboard.type(TYPED_TAIL)
        press_save(page)
        wait_saved(page, 3)
    v3 = snapshot(pen_id, 3)
    assert v3["files"]["html"] == CRLF_FILES["html"], "an untouched HTML pane with CRLF must be saved unchanged"
    assert v3["files"]["css"] == CRLF_FILES["css"], "an untouched CSS pane must be saved unchanged"
    assert v3["files"]["js"].endswith(TYPED_TAIL)
    assert v3["libraries"] == libs
    assert v3["sha256"] == canonical_sha(v3["files"], libs)


def test_wf_console_and_shelf_entries(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>console</p>", js=CONSOLE_JS))])
    delay = config(app_url)["preview_delay_ms"]
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "the first render")
        wait_for(page, lambda: console_entries(page), lambda v: len(v) >= len(CONSOLE_EXPECTED), "all console entries")
        assert console_entries(page) == CONSOLE_EXPECTED
        log = page.get_by_role("log", name="Console", exact=True)
        assert log.get_attribute("data-count") == str(len(CONSOLE_EXPECTED))
        toggle = page.get_by_role("button", name="Console", exact=True)
        assert str(len(CONSOLE_EXPECTED)) in toggle.inner_text(), "the Console toggle shows the visible count"

        replace_pane(page, "js", 'console.log("hi")')
        advance(page, delay)
        wait_for(page, lambda: console_entries(page), lambda v: v == ["log hi"], "a new render shows only its own entries")
        assert log.get_attribute("data-count") == "1"
        page.get_by_role("button", name="Clear console", exact=True).click()
        wait_for(page, lambda: console_entries(page), lambda v: v == [], "Clear console empties the log")
        assert log.get_attribute("data-count") == "0"


def test_wf_console_and_shelf_latest_render(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>start</p>", js='console.log("start")'))])
    delay = config(app_url)["preview_delay_ms"]
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "the first render")
        wait_for(page, lambda: console_entries(page), lambda v: v == ["log start"], "first render console")
        held_routes: list = []

        def hold_first(route) -> None:
            if not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route("**/api/renders", hold_first)
        replace_pane(page, "js", 'console.log("old")')
        advance(page, delay)
        wait_for(page, lambda: len(held_routes), lambda v: v == 1, "the first render request is held", step_ms=0)
        replace_pane(page, "js", JS_NEW)
        advance(page, delay)
        wait_for(page, lambda: console_entries(page), lambda v: v == ["log new"], "the latest render's console")
        seq = render_seq(page)
        done: list = []
        first_request = held_routes[0].request
        page.on("requestfinished", lambda req: done.append(req) if req == first_request else None)
        page.on("requestfailed", lambda req: done.append(req) if req == first_request else None)
        try:
            held_routes[0].continue_()
        except PlaywrightError:
            done.append(first_request)
        wait_for(page, lambda: len(done), lambda v: v >= 1, "the held render request completes", step_ms=0)
        advance(page, delay * 2)
        page.evaluate("() => 0")
        assert console_entries(page) == ["log new"], "a late earlier render must not reach the console"
        assert render_seq(page) == seq
        assert pane_text(pane(page, "js")) == JS_NEW


def test_wf_console_and_shelf_loop_guard(browser, app_url):
    limit = config(app_url)["loop_limit"]
    delay = config(app_url)["preview_delay_ms"]
    part = limit * 3 // 5
    script = "\n".join([
        'console.log("before");',
        "let n = 0;",
        "while (true) { n++; }",
        'console.log("after " + n);',
        "for (;;) {}",
        "do {} while (true);",
        "function walk(k) { let c = 0; for (let i = 0; i < k; i++) { c++; } return c; }",
        f"console.log(walk({part}) + walk({part}));",
        'document.title = "guarded";',
    ])
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>loops</p>", js=script))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "the guarded script renders")
        entries = wait_for(page, lambda: console_entries(page), lambda v: len(v) >= 6, "loop guard entries")
        assert len(entries) == 6, entries
        assert entries[0] == "log before"
        assert entries[1] == LOOP_LINE.format(line=3, limit=limit)
        assert re.fullmatch(r"log after \d+", entries[2]), entries[2]
        assert entries[3] == LOOP_LINE.format(line=5, limit=limit)
        assert entries[4] == LOOP_LINE.format(line=6, limit=limit)
        assert entries[5] == f"log {2 * part}", "loops under the limit, run twice, are counted per run"
        assert preview(page).get_attribute("data-preview-title") == "guarded"
        seq = render_seq(page)
        replace_pane(page, "html", "still here")
        advance(page, delay)
        wait_for(page, lambda: preview(page).get_attribute("data-preview-text"), lambda v: v == "still here",
                 "the editor and preview keep working after a guarded loop")
        assert render_seq(page) == seq + 1


def test_wf_console_and_shelf_shelf(browser, app_url):
    shelf = httpx.get(f"{app_url}/api/shelf", timeout=HTTP_TIMEOUT_S).json()["libraries"]
    assert {lib["id"] for lib in shelf} == set(SHELF)
    keys = set(S3().keys("shelf/"))
    for lib in shelf:
        file_name, global_name, licence = SHELF[lib["id"]]
        assert f"{lib['name']}@{lib['version']}" == lib["id"] and lib["global"] == global_name and lib["license"] == licence
        r = httpx.get(f"{app_url}/shelf/{lib['id']}/{file_name}", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.headers["content-type"].startswith("text/javascript")
        assert len(r.content) == lib["bytes"] and hashlib.sha256(r.content).hexdigest() == lib["sha256"]
        key = f"shelf/{lib['id']}/{file_name}"
        assert key in keys and S3().get(key) == r.content, f"{key} is not mirrored byte for byte"

    delay = config(app_url)["preview_delay_ms"]
    with silent_listener() as (port, hits):
        script_url = f"http://127.0.0.1:{port}/lib.js"
        data_url = f"http://127.0.0.1:{port}/data"
        html = f'<script src="{script_url}"></script><p>shelf</p>'
        js = f'console.log(typeof _);\ntry {{ fetch("{data_url}").catch(() => {{}}); }} catch (e) {{}}'
        owner, pen_id, _ = one_pen(app_url, [version(files(html=html, js=js))])
        with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
            wait_render(page, 1, "first render")
            want = {BLOCKED_SCRIPT.format(url=script_url), "log undefined", BLOCKED_REQUEST.format(url=data_url)}
            wait_for(page, lambda: set(console_entries(page)), lambda v: want <= v, "blocked script and request entries")

            settings_btn = page.get_by_role("button", name="Pen settings", exact=True)
            settings_btn.focus()
            page.keyboard.press("Enter")
            dialog = page.get_by_role("dialog", name="Pen settings")
            expect(dialog).to_be_visible()
            combo = dialog.get_by_role("combobox", name="Add library")
            combo.focus()
            page.keyboard.type("nope-lib")
            page.keyboard.press("Enter")
            wait_text(page, status(page, "Settings status"), NOT_ON_SHELF.format(text="nope-lib"), "shelf refusal")
            page.keyboard.press("Control+a")
            page.keyboard.press("Delete")
            page.keyboard.type("lodash")
            expect(dialog.get_by_role("option", name="lodash@4.17.21")).to_be_visible()
            page.keyboard.press("ArrowDown")
            page.keyboard.press("Enter")
            expect(dialog.get_by_role("button", name="Remove lodash@4.17.21")).to_be_visible()
            dialog.get_by_role("button", name="Close", exact=True).click()
            expect(settings_btn).to_be_focused()
            advance(page, delay)
            wait_for(page, lambda: console_entries(page), lambda v: "log function" in v,
                     "the picked shelf library is available in the preview")
            press_save(page)
            wait_saved(page, 2)
        assert hits == [], f"the blocked addresses were contacted: {hits}"
    assert Api(app_url, owner["handle"]).pen(pen_id)["version"]["libraries"] == ["lodash@4.17.21"]


def test_wf_signup_verification_join(browser, app_url, mail):
    handle = f"join-{tok()}"
    email = f"{handle}@example.test"
    password = "granite-path-9"
    with opened(browser, app_url, "/signup") as page:
        page.get_by_role("textbox", name="Handle", exact=True).fill(handle)
        page.get_by_role("textbox", name="Email", exact=True).fill(email)
        page.get_by_label("Password", exact=True).fill(password)
        page.get_by_role("button", name="Create account", exact=True).click()
        wait_path(page, r"/dashboard", "sign-up lands on /dashboard")
        banner = page.get_by_role("region", name="Verify your email")
        expect(banner.get_by_text(BANNER_SENT.format(email=email), exact=True)).to_be_visible()

        messages = mails_to(mail, email, 1)
        assert len(messages) == 1 and messages[0]["Subject"] == "Verify your Ashlar account"
        assert f"Hi {handle}," in mail_text(messages[0])
        link = verify_link(messages[0])

        page.get_by_role("button", name="Start a pen", exact=True).first.click()
        path = wait_path(page, r"/pen/[a-z0-9]{10}", "Start a pen lands on the editor")
        pen_id = path.rsplit("/", 1)[1]
        wait_render(page, 1, "the unverified editor previews")
        pane(page, "html").focus()
        page.keyboard.type("Draft line")
        press_save(page)
        wait_text(page, status(page, "Save status"), UNVERIFIED.format(email=email), "unverified save refusal")
        expect(page.get_by_text("Not saved yet", exact=True)).to_be_visible()

        other = page.context.new_page()
        parsed = urlparse(link)
        other.goto(f"{app_url}{parsed.path}?{parsed.query}")
        expect(other.get_by_role("heading", name=VERIFY_OK)).to_be_visible()
        wait_text(page, status(page, "Account status"), VERIFIED_LIVE, "the open page learns of verification",
                  seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
        expect(banner).to_have_count(0)
        pane(page, "html").focus()
        press_save(page)
        wait_saved(page, 1)
        stored = page.request.get(f"{app_url}/api/pens/{pen_id}").json()
        assert stored["head"] == 1 and stored["version"]["files"]["html"] == "Draft line"
        assert snapshot(pen_id, 1)["files"]["html"] == "Draft line"

        page.get_by_role("button", name="Sign out", exact=True).click()
        page.goto(f"{app_url}/signin")
        page.get_by_role("textbox", name="Email", exact=True).fill(email)
        page.get_by_label("Password", exact=True).fill("wrong-password-1")
        page.get_by_role("button", name="Sign in", exact=True).click()
        expect(page.get_by_role("alert").get_by_text(SIGNIN_WRONG, exact=True)).to_be_visible()
        page.get_by_label("Password", exact=True).fill(password)
        page.get_by_role("button", name="Sign in", exact=True).click()
        wait_path(page, r"/dashboard", "sign-in lands on /dashboard")


@pytest.mark.timeout(900)
def test_wf_signup_verification_email_rules(browser, app_url, mail):
    anon = Api(app_url)
    user = person("mail")
    r = anon.call("POST", "/api/signup", {"handle": user["handle"], "email": user["email"], "password": PASSWORD})
    assert r.status_code == 201 and r.json()["verification"] == "sent" and r.json()["user"]["verified"] is False
    first = mails_to(mail, user["email"], 1)
    assert len(first) == 1 and first[0]["Subject"] == "Verify your Ashlar account"
    assert f"Hi {user['handle']}," in mail_text(first[0])
    t1 = token_of(verify_link(first[0]))
    resend = anon.call("POST", "/api/verify/resend")
    assert resend.status_code == 202 and resend.json() == {"verification": "sent"}
    both = mails_to(mail, user["email"], 2)
    assert len(both) == 2
    t2 = next(token_of(verify_link(m)) for m in both if token_of(verify_link(m)) != t1)
    assert_error(anon.call("POST", "/api/verify", {"token": t1}), 422, "token_invalid", "a token replaced by resend")
    ok = anon.call("POST", "/api/verify", {"token": t2})
    assert ok.status_code == 200 and ok.json()["user"]["verified"] is True
    assert_error(anon.call("POST", "/api/verify", {"token": t2}), 422, "token_invalid", "a used token")
    assert_error(anon.call("POST", "/api/verify/resend"), 409, "already_verified", "resend after verifying")
    assert_error(anon.call("POST", "/api/verify", {"token": tok()}), 422, "token_invalid", "an unknown token")

    mail_down = os.environ["APP_MAIL_DOWN_URL"]
    d = Api(mail_down)
    du = person("maildown")
    r = d.call("POST", "/api/signup", {"handle": du["handle"], "email": du["email"], "password": PASSWORD})
    assert r.status_code == 201 and r.json()["verification"] == "pending"
    assert_error(d.call("POST", "/api/verify/resend"), 503, "mail_unavailable", "resend while mail is down")

    ttl_s = 3
    relay = Relay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    relay.start()
    try:
        with app_copy({"ASHLAR_GRADING": "1", "ASHLAR_VERIFY_TTL_SECONDS": str(ttl_s),
                       "SMTP_HOST": "127.0.0.1", "SMTP_PORT": str(relay.port)}) as copy:
            c = Api(copy)
            late = person("late")
            issued = time.monotonic()
            r = c.call("POST", "/api/signup", {"handle": late["handle"], "email": late["email"], "password": PASSWORD})
            assert r.status_code == 201 and r.json()["verification"] == "sent"
            msg = mails_to(mail, late["email"], 1)
            link = verify_link(msg[0])
            assert link.startswith(f"{copy}/verify?token="), "the link must use APP_PUBLIC_URL"
            while time.monotonic() < issued + ttl_s + TTL_MARGIN_S:
                mail.messages(expected=0, settle=POLL_SETTLE_S)
            assert_error(c.call("POST", "/api/verify", {"token": token_of(link)}), 422, "token_expired", "an expired link")
            with opened(browser, copy, f"/verify?token={token_of(link)}") as page:
                expect(page.get_by_role("heading", name=VERIFY_EXPIRED)).to_be_visible()
                page.goto(f"{copy}/verify?token={tok()}")
                expect(page.get_by_role("heading", name=VERIFY_INVALID)).to_be_visible()

            relay.stop()
            down_user = person("relay")
            with opened(browser, copy, "/api/health") as page:
                r = page.request.post(f"{copy}/api/signup", data={"handle": down_user["handle"], "email": down_user["email"],
                                                                  "password": PASSWORD})
                assert r.status == 201 and r.json()["verification"] == "pending"
                page.goto(f"{copy}/dashboard")
                banner = page.get_by_role("region", name="Verify your email")
                expect(banner.get_by_text(BANNER_PENDING, exact=True)).to_be_visible()
                banner.get_by_role("button", name="Resend link").click()
                wait_text(page, status(page, "Account status"), RESEND_DOWN, "resend while mail is unreachable")
                relay.start()
                banner.get_by_role("button", name="Resend link").click()
                wait_text(page, status(page, "Account status"), RESEND_SENT.format(email=down_user["email"]),
                          "resend once mail is back")
            back = mails_to(mail, down_user["email"], 1)
            assert len(back) == 1, "resend after recovery sends exactly one message"
            good = c.call("POST", "/api/verify", {"token": token_of(verify_link(back[0]))})
            assert good.status_code == 200 and good.json()["user"]["verified"] is True
    finally:
        relay.stop()


def test_wf_signup_verification_unverified(browser, app_url):
    t = tok()
    unv, owner = person("unv", verified=False), person("owner")
    ids = seed(app_url, users=[unv, owner],
               pens=[pen("mine", unv, f"Mine {t}", "private", versions=[version(files(html="<p>m</p>"))]),
                     pen("pub", owner, f"Public {t}", "public", versions=[version(files(html="<p>p</p>"))])])
    mine, pub = ids["pens"]["mine"], ids["pens"]["pub"]
    u, o = Api(app_url, unv["handle"]), Api(app_url, owner["handle"])
    created = u.ok("POST", "/api/pens", {}, status=201)
    assert created["head"] == 0 and created["title"] == "Untitled pen" and created["visibility"] == "private"
    u.ok("PATCH", f"/api/pens/{created['id']}", {"title": f"Renamed {t}"})
    u.ok("PATCH", f"/api/pens/{created['id']}", {"tags": ["draft"]})
    u.ok("POST", "/api/renders", {"html": "<p>x</p>", "css": "", "js": "", "libraries": []}, status=201)
    u.ok("POST", "/api/collections", {}, status=201)

    pens_before = {p["id"] for p in u.ok("GET", "/api/pens")["pens"]}
    assert_error(u.save(mine, 1, files(html="new")), 403, "unverified", "unverified save")
    assert_error(u.call("POST", f"/api/pens/{mine}/restore", {"version": 1, "base_version": 1}), 403, "unverified", "unverified restore")
    assert_error(u.call("PATCH", f"/api/pens/{mine}", {"visibility": "public"}), 403, "unverified", "unverified visibility")
    assert_error(u.call("PUT", f"/api/pens/{pub}/like"), 403, "unverified", "unverified like")
    assert_error(u.call("DELETE", f"/api/pens/{pub}/like"), 403, "unverified", "unverified unlike")
    assert_error(u.call("POST", f"/api/pens/{pub}/fork", key=idempotency_key()), 403, "unverified", "unverified fork")
    after = u.pen(mine)
    assert after["head"] == 1 and after["visibility"] == "private"
    assert [e["number"] for e in u.versions(mine)] == [1]
    assert S3().keys(f"pens/{mine}/") == [f"pens/{mine}/versions/1.json"]
    assert o.pen(pub)["likes"] == 0 and o.pen(pub)["forks"] == 0
    assert {p["id"] for p in u.ok("GET", "/api/pens")["pens"]} == pens_before

    with opened(browser, app_url, f"/pen/{pub}", unv["handle"]) as page:
        wait_render(page, 1, "the public pen renders for the unverified viewer")
        page.get_by_role("button", name="Like", exact=True).click()
        wait_text(page, status(page, "Likes"), UNVERIFIED.format(email=unv["email"]), "unverified like copy")
        page.get_by_role("button", name="Fork", exact=True).click()
        wait_text(page, status(page, "Forks"), UNVERIFIED.format(email=unv["email"]), "unverified fork copy")
        assert urlparse(page.url).path == f"/pen/{pub}"
    assert o.pen(pub)["likes"] == 0 and o.pen(pub)["forks"] == 0


def test_wf_panes_keyboard_separators(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>stage</p>"))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "first render")
        stage, hc, cj = sep(page, "Resize preview and code"), sep(page, "Resize HTML and CSS"), sep(page, "Resize CSS and JS")
        for s in (stage, hc, cj):
            assert s.get_attribute("aria-valuemin") == str(SEP_MIN) and s.get_attribute("aria-valuemax") == str(SEP_MAX)
        assert stage.get_attribute("aria-valuenow") == str(SEP_PREVIEW_DEFAULT)
        assert hc.get_attribute("aria-valuenow") == str(SEP_PANES_DEFAULT) == cj.get_attribute("aria-valuenow")
        assert stage.get_attribute("aria-orientation") == "vertical"
        assert hc.get_attribute("aria-orientation") == "horizontal" == cj.get_attribute("aria-orientation")
        pv, hp = preview(page).bounding_box(), pane(page, "html").bounding_box()
        assert pv["x"] + pv["width"] <= hp["x"] + EDGE_PX, "Side by side puts the stage left of the panes"

        def key(loc: Locator, press: str, expected: int) -> None:
            loc.focus()
            page.keyboard.press(press)
            wait_for(page, lambda: loc.get_attribute("aria-valuenow"), lambda v: v == str(expected),
                     f"{press} should leave aria-valuenow at {expected}", step_ms=0)

        key(stage, "ArrowRight", SEP_PREVIEW_DEFAULT + SEP_STEP)
        wait_for(page, lambda: preview(page).bounding_box()["width"], lambda w: w > pv["width"],
                 "Right on Resize preview and code grows the stage")
        for press, value in (("ArrowLeft", SEP_PREVIEW_DEFAULT), ("ArrowUp", SEP_PREVIEW_DEFAULT - SEP_STEP),
                             ("ArrowDown", SEP_PREVIEW_DEFAULT), ("Home", SEP_MIN), ("ArrowLeft", SEP_MIN),
                             ("ArrowUp", SEP_MIN), ("End", SEP_MAX), ("ArrowRight", SEP_MAX), ("ArrowDown", SEP_MAX)):
            key(stage, press, value)
        key(hc, "ArrowUp", SEP_PANES_DEFAULT - SEP_STEP)
        key(cj, "ArrowDown", SEP_PANES_DEFAULT + SEP_STEP)

        side = page.get_by_role("radio", name="Side by side", exact=True)
        expect(side).to_be_checked()
        side.focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio", name="Stacked", exact=True)).to_be_checked()
        wait_for(page, lambda: (stage.get_attribute("aria-orientation"), hc.get_attribute("aria-orientation"),
                                cj.get_attribute("aria-orientation")),
                 lambda v: v == ("horizontal", "vertical", "vertical"), "Stacked separator orientations", step_ms=0)
        boxes = {k: pane(page, k).bounding_box() for k in PANES}
        pv = preview(page).bounding_box()
        assert boxes["html"]["y"] + boxes["html"]["height"] <= pv["y"] + EDGE_PX, "Stacked puts the panes above the stage"
        assert boxes["html"]["x"] + boxes["html"]["width"] <= boxes["css"]["x"] + EDGE_PX
        assert boxes["css"]["x"] + boxes["css"]["width"] <= boxes["js"]["x"] + EDGE_PX
        key(stage, "End", SEP_MAX)
        key(stage, "ArrowUp", SEP_MAX - SEP_STEP)
        key(stage, "ArrowDown", SEP_MAX)

        page.get_by_role("radio", name="Stacked", exact=True).focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio", name="Preview first", exact=True)).to_be_checked()
        wait_for(page, lambda: stage.get_attribute("aria-orientation"), lambda v: v == "horizontal",
                 "Preview first separator orientation", step_ms=0)
        pv, hp = preview(page).bounding_box(), pane(page, "html").bounding_box()
        assert pv["y"] + pv["height"] <= hp["y"] + EDGE_PX, "Preview first puts the stage above the panes"
        key(stage, "End", SEP_MAX)
        key(hc, "Home", SEP_MIN)
        key(hc, "ArrowRight", SEP_MIN + SEP_STEP)
        key(cj, "End", SEP_MAX)
        key(cj, "ArrowLeft", SEP_MAX - SEP_STEP)

        page.reload()
        wait_render(page, 1, "render after reload")
        expect(page.get_by_role("radio", name="Preview first", exact=True)).to_be_checked()
        assert stage.get_attribute("aria-valuenow") == str(SEP_MAX)
        assert hc.get_attribute("aria-valuenow") == str(SEP_MIN + SEP_STEP)
        assert cj.get_attribute("aria-valuenow") == str(SEP_MAX - SEP_STEP)


@pytest.mark.parametrize("band_id", ["wide", "medium", "narrow"], ids=["wide", "medium", "narrow"])
def test_wf_panes_keyboard_breakpoints(browser, app_url, band_id):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>bands</p>"))])
    size = BANDS[band_id]
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"], size=size) as page:
        wait_render(page, 1, "first render")
        layout(page)
        radios = page.get_by_role("radiogroup", name="Layout")
        if band_id == "wide":
            pv, hp = preview(page).bounding_box(), pane(page, "html").bounding_box()
            assert pv["x"] >= 0 and pv["x"] + pv["width"] <= hp["x"] + EDGE_PX
            assert pv["x"] + pv["width"] / 2 < size["width"] / 2, "the stage is the left part of the split"
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            after = preview(page).bounding_box()
            assert abs(after["y"] - pv["y"]) <= EDGE_PX, "the wide stage stays put while the column scrolls"
            expect(radios).to_be_visible()
        elif band_id == "medium":
            pv = preview(page).bounding_box()
            boxes = {k: pane(page, k).bounding_box() for k in PANES}
            assert pv["y"] + pv["height"] <= boxes["html"]["y"] + EDGE_PX
            assert pv["x"] <= boxes["html"]["x"] + EDGE_PX
            assert pv["x"] + pv["width"] >= boxes["html"]["x"] + boxes["html"]["width"] - EDGE_PX
            assert boxes["html"]["y"] + boxes["html"]["height"] <= boxes["css"]["y"] + EDGE_PX
            assert boxes["css"]["y"] + boxes["css"]["height"] <= boxes["js"]["y"] + EDGE_PX
            log = page.get_by_role("log", name="Console", exact=True).bounding_box()
            assert log["y"] >= boxes["js"]["y"] + boxes["js"]["height"] - EDGE_PX, "console band below the panes"
            page.evaluate("() => window.scrollTo(0, document.documentElement.scrollHeight)")
            stuck = preview(page).bounding_box()
            assert -EDGE_PX <= stuck["y"] < size["height"] / 2, "the medium stage stays stuck at the top"
            assert not radios.is_visible()
        else:
            tabs = page.get_by_role("tablist", name="Panes")
            expect(tabs).to_be_visible()
            assert [t.strip() for t in tabs.get_by_role("tab").all_inner_texts()][:3] == ["HTML", "CSS", "JS"]
            for name in PHONE_TABS:
                expect(tabs.get_by_role("tab", name=name, exact=True)).to_have_count(1)
            expect(pane(page, "html")).to_be_visible()
            assert not pane(page, "css", include_hidden=True).first.is_visible()
            assert not radios.is_visible()
        layout(page)


def test_wf_phone_editing_hidden_inert(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>phone</p>"))], visibility="public")
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"], size=NARROW) as page:
        wait_render(page, 1, "first render")
        layout(page)
        tabs = page.get_by_role("tablist", name="Panes")
        tab = {n: tabs.get_by_role("tab", name=n, exact=True) for n in PHONE_TABS}
        expect(tab["HTML"]).to_have_attribute("aria-selected", "true")
        for n in PHONE_TABS[1:]:
            assert tab[n].evaluate("el => el.tabIndex") < 0, f"unselected tab {n} must be out of the tab order"
        for key_name, loc in (("css", pane(page, "css", True)), ("js", pane(page, "js", True))):
            assert not loc.first.is_visible() and not focusable(loc.first), f"hidden {key_name} pane took focus"
        clear = page.get_by_role("button", name="Clear console", exact=True, include_hidden=True)
        assert clear.count() == 0 or not focusable(clear.first), "the closed console's control took focus"
        copy_link = page.get_by_role("button", name="Copy link", exact=True, include_hidden=True)
        assert copy_link.count() == 0 or not focusable(copy_link.first), "the closed Share dialog's control took focus"

        tab["HTML"].focus()
        page.keyboard.press("ArrowRight")
        expect(tab["CSS"]).to_be_focused()
        expect(tab["HTML"]).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Enter")
        expect(tab["CSS"]).to_have_attribute("aria-selected", "true")
        expect(pane(page, "css")).to_be_visible()
        assert not focusable(pane(page, "html", True).first)
        page.keyboard.press("ArrowLeft")
        expect(tab["HTML"]).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(tab["Console"]).to_be_focused()
        page.keyboard.press("Home")
        expect(tab["HTML"]).to_be_focused()
        page.keyboard.press("End")
        expect(tab["Console"]).to_be_focused()
        page.keyboard.press(" ")
        expect(tab["Console"]).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("log", name="Console", exact=True)).to_be_visible()
        assert not focusable(pane(page, "css", True).first)

        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        names = tab_order(page, TAB_PRESSES)
        for forbidden in ("Explore", "The shelf", "Copy link", "Embed link", "CSS code", "JS code", "HTML code"):
            assert forbidden not in names, f"{forbidden} took focus while hidden: {names}"
        expect(page.get_by_role("button", name="Menu", exact=True)).to_be_visible()
        page.get_by_role("button", name="Menu", exact=True).click()
        menu = page.get_by_role("dialog", name="Menu")
        expect(menu.get_by_role("link", name="Explore", exact=True)).to_be_visible()
        layout(page)


def test_wf_phone_editing_reduced_motion(browser, app_url):
    vs = SLIDER_VERSIONS[:3]
    owner, pen_id, _ = one_pen(app_url, [version(f) for f in vs])
    with opened(browser, app_url, f"/pen/{pen_id}/history", owner["handle"], reduced_motion="reduce") as page:
        slider = page.get_by_role("slider", name="Core sample")
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "3", "slider at the head")
        slider.focus()
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: band(page, 2).get_attribute("data-selected"), lambda v: v == "true",
                 "Down selects band 2", step_ms=0)
        assert style(band(page, 2), "outline-width")["outline-width"] == f"{OUTLINE_PX}px"
        b2, b3 = band(page, 2).bounding_box(), band(page, 3).bounding_box()
        assert abs(b2["x"] - b3["x"]) <= EDGE_PX, "reduced motion replaces the lift"
        advance(page, REST_MS)
        a, r, _, _ = compare_versions(vs[2], vs[1])
        compare = page.get_by_role("region", name="Compare")
        wait_for(page, lambda: compare.get_by_text(counts_text(a, r), exact=True).count(), lambda v: v >= 1,
                 "compare counts at their final values without the count tick", step_ms=0)
        h1 = band(page, 1).bounding_box()["height"]
        restore = page.get_by_role("button", name=restore_name(2), exact=True)
        restore.focus()
        page.keyboard.press("Enter")
        editor = f"/pen/{pen_id}"
        state = wait_for(page, lambda: page.evaluate(
                             """() => { const b = document.querySelector('[data-version="4"]');
                                        return [location.pathname, b ? b.getBoundingClientRect().height : null]; }"""),
                         lambda v: v[0] == editor or v[1] is not None, "the restore lands", step_ms=0)
        if state[0] != editor:
            _, _, c4, _ = compare_versions(vs[2], vs[1])
            _, _, c1, _ = compare_versions(EMPTY, vs[0])
            h4 = state[1]
            assert abs(h4 - band_height(c4) * h1 / band_height(c1)) <= 2 * EDGE_PX, "the new band appears at full height"
            advance(page, REDUCED_NAV_MAX_MS)
            wait_path(page, editor, "reduced motion moves to the editor at once", step_ms=0)
        wait_text(page, status(page, "Save status"), "Restored version 2 as version 4", "restore announcement")


def test_wf_phone_editing_phone_edit(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>tile</p>", js='console.log("a");\nconsole.log("b");'))])
    delay = config(app_url)["preview_delay_ms"]
    css = "body{background:#123456}"
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"], size=NARROW) as page:
        wait_render(page, 1, "first render")
        layout(page)
        tabs = page.get_by_role("tablist", name="Panes")
        tap(tabs.get_by_role("tab", name="Result", exact=True))
        expect(preview(page)).to_be_visible()
        before = capture(preview(page))
        tap(tabs.get_by_role("tab", name="CSS", exact=True))
        tap(pane(page, "css"))
        page.keyboard.type(css)
        seq = render_seq(page)
        tap(tabs.get_by_role("tab", name="Result", exact=True))
        advance(page, delay)
        wait_for(page, lambda: render_seq(page), lambda v: v == seq + 1, "the CSS edit renders after the delay")
        changed(decode(before), decode(capture(preview(page))))
        console_tab = tabs.get_by_role("tab", name="Console", exact=True)
        tap(console_tab)
        log = page.get_by_role("log", name="Console", exact=True)
        expect(log).to_be_visible()
        wait_for(page, lambda: log.get_attribute("data-count"), lambda v: v == "2", "console count on the Console tab")
        assert "2" in console_tab.inner_text()
        tap(page.get_by_role("button", name="Save", exact=True))
        wait_saved(page, 2)
        layout(page)
    assert Api(app_url, owner["handle"]).pen(pen_id)["version"]["files"]["css"] == css


def test_wf_core_sample_slider(browser, app_url):
    vs = SLIDER_VERSIONS
    n = len(vs)
    owner, pen_id, _ = one_pen(app_url, [version(f, created_at=t) for f, t in zip(vs, SLIDER_TIMES)])
    stats = [compare_versions(a, b) for a, b in zip([EMPTY] + vs[:-1], vs)]
    for entry, st in zip(Api(app_url, owner["handle"]).versions(pen_id), stats):
        assert (entry["added"], entry["removed"], entry["changed_chars"]) == st[:3]
    with opened(browser, app_url, f"/pen/{pen_id}/history", owner["handle"]) as page:
        slider = page.get_by_role("slider", name="Core sample")
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == str(n), "slider at the head")
        assert slider.get_attribute("aria-orientation") == "vertical"
        dates = [page.evaluate(DATE_JS, t) for t in SLIDER_TIMES]

        def value_text(k: int) -> str:
            a, r = stats[k - 1][:2]
            return f"Version {k} of {n}, saved {dates[k - 1]}, +{a} {MINUS}{r}"

        assert slider.get_attribute("aria-valuetext") == value_text(n)
        heights = [band(page, k).bounding_box()["height"] for k in range(1, n + 1)]
        scale = heights[0] / band_height(stats[0][2])
        for k in range(n):
            assert abs(heights[k] - band_height(stats[k][2]) * scale) <= 2 * EDGE_PX, f"band {k + 1} height {heights}"
        assert band(page, 1).bounding_box()["y"] > band(page, n).bounding_box()["y"], "oldest band at the bottom"

        compare = page.get_by_role("region", name="Compare")
        heading = compare.get_by_role("heading", name=f"Comparing version {n} with version {n}")
        expect(heading).to_be_visible()
        slider.focus()
        page.keyboard.press("ArrowDown")
        assert slider.get_attribute("aria-valuenow") == str(n - 1)
        assert slider.get_attribute("aria-valuetext") == value_text(n - 1)
        assert band(page, n - 1).get_attribute("data-selected") == "true"
        assert band(page, n).get_attribute("data-selected") != "true"
        advance(page, REST_MS // 2)
        page.evaluate("() => 0")
        expect(heading).to_be_visible()
        settle(band(page, n - 1))
        advance(page, REST_MS - REST_MS // 2)
        expect(compare.get_by_role("heading", name=f"Comparing version {n} with version {n - 1}")).to_be_visible()
        settle(band(page, n - 1))
        settle(band(page, n))
        x1 = band(page, 1).bounding_box()["x"]
        assert abs(band(page, n - 1).bounding_box()["x"] - x1 - LIFT_PX) <= EDGE_PX, "the marked band lifts 12 px right"
        assert abs(band(page, n).bounding_box()["x"] - x1) <= EDGE_PX, "the previous band slides back"

        page.keyboard.press("Home")
        assert slider.get_attribute("aria-valuenow") == "1" and slider.get_attribute("aria-valuetext") == value_text(1)
        page.keyboard.press("End")
        assert slider.get_attribute("aria-valuenow") == str(n)
        tap(band(page, 2))
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "2", "a tap on band 2 moves the marker", step_ms=0)
        sb, b1 = slider.bounding_box(), band(page, 1).bounding_box()
        page.mouse.move(sb["x"] + sb["width"] / 2, sb["y"] + sb["height"] / 2)
        page.mouse.down()
        page.mouse.move(sb["x"] + sb["width"] / 2, b1["y"] + b1["height"] / 2, steps=8)
        page.mouse.up()
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "1", "dragging moves the marker", step_ms=0)


def test_wf_core_sample_compare(browser, app_url):
    vs = COMPARE_VERSIONS
    owner, pen_id, _ = one_pen(app_url, [version(f) for f in vs])
    api = Api(app_url, owner["handle"])
    added, removed, _, panes = compare_versions(vs[0], vs[2])
    d = api.ok("GET", f"/api/pens/{pen_id}/diff?a=1&b=3")
    assert (d["a"], d["b"], d["added"], d["removed"]) == (1, 3, added, removed)
    for p in PANES:
        assert d["panes"][p]["added"] == panes[p]["added"] and d["panes"][p]["removed"] == panes[p]["removed"]
        assert [(row["change"], row["text"]) for row in d["panes"][p]["rows"]] == panes[p]["rows"]
    assert_error(api.call("GET", f"/api/pens/{pen_id}/diff?b=3"), 422, "validation", "diff without a")
    assert_error(api.call("GET", f"/api/pens/{pen_id}/diff?a=one&b=3"), 422, "validation", "diff with a non-numeric a")

    with opened(browser, app_url, f"/pen/{pen_id}/history?a=v1&b=v3", owner["handle"]) as page:
        compare = page.get_by_role("region", name="Compare")
        expect(compare.get_by_role("heading", name="Comparing version 1 with version 3")).to_be_visible()
        wait_for(page, lambda: compare.get_by_text(counts_text(added, removed), exact=True).count(), lambda v: v >= 1,
                 "the total line after the count tick")
        for p in PANES:
            region = page.get_by_role("region", name=f"{PANE_LABEL[p]} changes")
            first = [ln.strip() for ln in region.inner_text().splitlines() if ln.strip()][0]
            assert first == counts_text(panes[p]["added"], panes[p]["removed"]), f"{p} pane counts"
            rows = region.locator("[data-change]")
            got = [(rows.nth(i).get_attribute("data-change"), rows.nth(i).inner_text()) for i in range(rows.count())]
            want = [c for c, _ in panes[p]["rows"]]
            values = [c for c, _ in got]
            assert len(values) == len(want), f"{p} row count {got}"
            assert all(values), f"{p} rows must carry data-change: {got}"
            groups: dict[str, set[str]] = {}
            for expected_change, value in zip(want, values):
                groups.setdefault(expected_change, set()).add(value)
            assert all(len(s) == 1 for s in groups.values()), f"{p} rows of one kind differ in data-change: {got}"
            assert len({next(iter(s)) for s in groups.values()}) == len(groups), \
                f"{p} same, added and removed rows must be told apart by data-change: {got}"
            for (_, shown), (_, line) in zip(got, panes[p]["rows"]):
                assert line in shown
        slider = page.get_by_role("slider", name="Core sample")
        assert slider.get_attribute("aria-valuenow") == "3"

        page.goto(f"{app_url}/pen/{pen_id}/history")
        expect(compare.get_by_role("heading", name="Comparing version 3 with version 3")).to_be_visible()
        slider.focus()
        page.keyboard.press("ArrowDown")
        advance(page, REST_MS)
        expect(compare.get_by_role("heading", name="Comparing version 3 with version 2")).to_be_visible()
        page.keyboard.press("Enter")
        expect(compare.get_by_role("heading", name="Comparing version 2 with version 2")).to_be_visible()
        page.keyboard.press("ArrowUp")
        advance(page, REST_MS)
        expect(compare.get_by_role("heading", name="Comparing version 2 with version 3")).to_be_visible()
        wait_for(page, lambda: parse_qs(urlparse(page.url).query), lambda q: q.get("a") == ["v2"] and q.get("b") == ["v3"],
                 "the address keeps ?a=v2&b=v3")
        page.reload()
        expect(compare.get_by_role("heading", name="Comparing version 2 with version 3")).to_be_visible()
        assert slider.get_attribute("aria-valuenow") == "3"
        page.goto(f"{app_url}/pen/{pen_id}/history?a=v9&b=v0")
        expect(compare.get_by_role("heading", name="Comparing version 3 with version 3")).to_be_visible()


LCS_VERSIONS = [
    {"html": "x", "css": "p\nq", "js": ""},
    {"html": "x\nx", "css": "q\np", "js": "z\n"},
]


def test_wf_core_sample_diff_counts(browser, app_url):
    vs = LCS_VERSIONS
    owner, pen_id, _ = one_pen(app_url, [version(f) for f in vs])
    api = Api(app_url, owner["handle"])
    added, removed, _, panes = compare_versions(vs[0], vs[1])
    assert (added, removed) == (4, 1)
    for entry, st in zip(api.versions(pen_id), [compare_versions(EMPTY, vs[0]), compare_versions(vs[0], vs[1])]):
        assert (entry["added"], entry["removed"], entry["changed_chars"]) == st[:3], entry
    d = api.ok("GET", f"/api/pens/{pen_id}/diff?a=1&b=2")
    assert (d["added"], d["removed"]) == (added, removed)
    for p in PANES:
        got = d["panes"][p]
        assert (got["added"], got["removed"]) == (panes[p]["added"], panes[p]["removed"]), f"{p} counts"
        shape = sorted((row["change"], len(row["text"])) for row in got["rows"])
        assert shape == sorted((c, len(t)) for c, t in panes[p]["rows"]), f"{p} rows {got['rows']}"
    with opened(browser, app_url, f"/pen/{pen_id}/history?a=v1&b=v2", owner["handle"]) as page:
        compare = page.get_by_role("region", name="Compare")
        expect(compare.get_by_role("heading", name="Comparing version 1 with version 2")).to_be_visible()
        wait_for(page, lambda: compare.get_by_text(counts_text(added, removed), exact=True).count(), lambda v: v >= 1,
                 "the total line shows the LCS counts")
        for p in PANES:
            region = page.get_by_role("region", name=f"{PANE_LABEL[p]} changes")
            first = [ln.strip() for ln in region.inner_text().splitlines() if ln.strip()][0]
            assert first == counts_text(panes[p]["added"], panes[p]["removed"]), f"{p} pane counts"
        slider = page.get_by_role("slider", name="Core sample")
        assert (slider.get_attribute("aria-valuetext") or "").endswith(counts_text(added, removed))


def test_wf_core_sample_restore(browser, app_url):
    vs = COMPARE_VERSIONS
    owner, pen_id, _ = one_pen(app_url, [version(f) for f in vs])
    api = Api(app_url, owner["handle"])
    originals = {k: S3().get(f"pens/{pen_id}/versions/{k}.json") for k in (1, 2, 3)}
    v1 = api.ok("GET", f"/api/pens/{pen_id}/versions/1")
    key = idempotency_key()
    r = api.call("POST", f"/api/pens/{pen_id}/restore", {"version": 1, "base_version": 3}, key=key)
    assert r.status_code == 201, r.text
    v4 = r.json()
    assert v4["number"] == 4 and v4["restored_from"] == 1
    assert v4["files"] == v1["files"] and v4["libraries"] == v1["libraries"] and v4["sha256"] == v1["sha256"]
    assert snapshot(pen_id, 4)["files"] == vs[0] and snapshot(pen_id, 4)["sha256"] == canonical_sha(vs[0], [])
    replay = api.call("POST", f"/api/pens/{pen_id}/restore", {"version": 1, "base_version": 3}, key=key)
    assert replay.status_code == 201 and replay.json() == v4
    body = assert_error(api.call("POST", f"/api/pens/{pen_id}/restore", {"version": 2, "base_version": 3}), 409,
                        "version_conflict", "a stale restore")
    assert body["head"] == 4
    assert [e["number"] for e in api.versions(pen_id)] == [1, 2, 3, 4]
    for k, raw in originals.items():
        assert S3().get(f"pens/{pen_id}/versions/{k}.json") == raw, f"version {k} was rewritten"

    with opened(browser, app_url, f"/pen/{pen_id}/history", owner["handle"]) as page:
        slider = page.get_by_role("slider", name="Core sample")
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "4", "slider at the head")
        expect(page.get_by_role("button", name=re.compile(r"^Restore version"))).to_have_count(0)
        slider.focus()
        page.keyboard.press("ArrowDown")
        advance(page, REST_MS)
        before = {k: band(page, k).bounding_box() for k in (1, 2, 3, 4)}
        restore = page.get_by_role("button", name=restore_name(3), exact=True)
        restore.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: band(page, 5).count(), lambda v: v > 0, "the new top band appears", step_ms=0)
        for k, box in before.items():
            now = band(page, k).bounding_box()
            assert abs(now["y"] - box["y"]) <= EDGE_PX, f"band {k} moved while the new band settled"
        wait_path(page, rf"/pen/{pen_id}", "after the settle the app moves to the editor")
        wait_text(page, status(page, "Save status"), "Restored version 3 as version 5", "restore announcement")
        expect(page.get_by_text("Version 5", exact=True)).to_be_visible()
    assert api.ok("GET", f"/api/pens/{pen_id}/versions/5")["restored_from"] == 3


def test_wf_core_sample_find_version(browser, app_url):
    good = files(html="<p>worked</p>", js='document.title = "good";')
    vs = [good, files(html="<p>worked</p>\n<p>tweak</p>"), files(html="<p>broken</p>")]
    owner, pen_id, _ = one_pen(app_url, [version(f) for f in vs])
    with opened(browser, app_url, f"/pen/{pen_id}/history", owner["handle"]) as page:
        slider = page.get_by_role("slider", name="Core sample")
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "3", "slider at the head")
        slider.focus()
        page.keyboard.press("Home")
        advance(page, REST_MS)
        compare = page.get_by_role("region", name="Compare")
        expect(compare.get_by_role("heading", name="Comparing version 3 with version 1")).to_be_visible()
        restore = page.get_by_role("button", name="Restore version 1", exact=True)
        restore.focus()
        page.keyboard.press("Enter")
        wait_path(page, rf"/pen/{pen_id}", "restore lands on the editor")
        wait_text(page, status(page, "Save status"), "Restored version 1 as version 4", "restore announcement")
        wait_for(page, lambda: preview(page).get_attribute("data-preview-text"), lambda v: v == "worked",
                 "the restored code runs in the preview")
        assert pane_text(pane(page, "html")) == good["html"]
    head = Api(app_url, owner["handle"]).pen(pen_id)
    assert head["head"] == 4 and head["version"]["files"] == good
    assert snapshot(pen_id, 4)["sha256"] == canonical_sha(good, [])


def test_wf_fork_credit_fork(browser, app_url, mail):
    author, forker = person("author"), person("forker")
    title = f"Arches {tok()}"
    src = seed(app_url, users=[author, forker],
               pens=[pen("s", author, title, "public", versions=[version(files(html="<p>src</p>"))])])["pens"]["s"]
    with opened(browser, app_url, f"/pen/{src}", author["handle"]) as owner_page, \
            opened(browser, app_url, f"/pen/{src}", forker["handle"]) as page:
        wait_render(owner_page, 1, "owner page render")
        wait_text(owner_page, status(owner_page, "Forks"), "0 forks", "initial fork count")
        wait_render(page, 1, "viewer render")
        fork_btn = page.get_by_role("button", name="Fork", exact=True)
        fork_btn.focus()
        page.keyboard.press("Enter")
        path = wait_path(page, rf"/pen/(?!{src}$)[a-z0-9]{{10}}", "fork lands on its editor")
        fork_id = path.rsplit("/", 1)[1]
        assert fork_id != src
        credit = page.get_by_role("link", name=f"Forked from {title} by {author['handle']}", exact=True)
        expect(credit).to_be_visible()
        assert urlparse(credit.get_attribute("href")).path == f"/pen/{src}"
        wait_text(owner_page, status(owner_page, "Forks"), "1 fork", "the author's open page shows the fork",
                  seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
    assert Api(app_url, author["handle"]).pen(src)["forks"] == 1
    fork = Api(app_url, forker["handle"]).pen(fork_id)
    assert fork["owner"] == forker["handle"] and fork["forked_from"]["pen_id"] == src
    assert len(mails_to(mail, author["email"], 1, lambda m: title in m.get("Subject", ""))) == 1


def test_wf_fork_credit_notice(browser, app_url, mail):
    t = tok()
    author, forker, seeder = person("author"), person("forker"), person("seeder")
    v = [version(files(html="<p>n</p>"))]
    titles = {k: f"{k} {t}" for k in ("Public", "Unlisted", "Pressed")}
    ids = seed(app_url, users=[author, forker, seeder],
               pens=[pen("pub", author, titles["Public"], "public", versions=v),
                     pen("unl", author, titles["Unlisted"], "unlisted", versions=v),
                     pen("ui", author, titles["Pressed"], "public", versions=v),
                     pen("seeded", seeder, f"Seeded {t}", "unlisted", versions=v, forked_from={"key": "pub", "version": 1})])
    pub, unl, ui = ids["pens"]["pub"], ids["pens"]["unl"], ids["pens"]["ui"]
    key = idempotency_key()
    results: list[httpx.Response] = []
    barrier = threading.Barrier(2)

    def go() -> None:
        client = Api(app_url, forker["handle"])
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        results.append(client.call("POST", f"/api/pens/{pub}/fork", key=key))

    threads = [threading.Thread(target=go) for _ in range(2)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=HTTP_TIMEOUT_S)
    created = [r.json()["id"] for r in results if r.status_code == 201]
    assert created and len(set(created)) == 1, [(r.status_code, r.text) for r in results]
    f = Api(app_url, forker["handle"])
    replay = f.call("POST", f"/api/pens/{pub}/fork", key=key)
    assert replay.status_code == 201 and replay.json()["id"] == created[0]
    assert Api(app_url, author["handle"]).pen(pub)["forks"] == 2, "one seeded fork plus exactly one new fork"
    f.ok("POST", f"/api/pens/{unl}/fork", status=201, key=idempotency_key())
    Api(app_url, author["handle"]).ok("POST", f"/api/pens/{pub}/fork", status=201, key=idempotency_key())

    with opened(browser, app_url, f"/pen/{ui}", forker["handle"]) as page:
        wait_render(page, 1, "render")
        fork_btn = page.get_by_role("button", name="Fork", exact=True)
        with held(page, "**/api/pens/*/fork") as gate:
            fork_btn.focus()
            page.keyboard.press("Enter")
            expect(fork_btn).to_be_disabled()
            page.keyboard.press("Enter")
            getattr(gate, "release", gate)()
        wait_path(page, rf"/pen/(?!{ui}$)[a-z0-9]{{10}}", "the pressed fork lands")
        assert urlparse(page.url).path != f"/pen/{ui}"
    assert Api(app_url, author["handle"]).pen(ui)["forks"] == 1

    subject = f'{forker["handle"]} forked your pen "{titles["Public"]}"'
    notices = mails_to(mail, author["email"], 1, lambda m: m.get("Subject") == subject)
    assert len(notices) == 1
    body = mail_text(notices[0])
    assert f'{forker["handle"]} forked "{titles["Public"]}" into a new pen.' in body
    assert re.search(rf"See the fork: \S+/pen/{created[0]}\b", body)
    pressed = mails_to(mail, author["email"], 1, lambda m: titles["Pressed"] in m.get("Subject", ""))
    assert len(pressed) == 1
    everything = mails_to(mail, author["email"], 0)
    assert not [m for m in everything if titles["Unlisted"] in m.get("Subject", "")], "no notice for an unlisted source"
    assert not [m for m in everything if m.get("Subject", "").startswith(f"{author['handle']} forked")], "no notice for own fork"
    assert not [m for m in everything if m.get("Subject", "").startswith(f"{seeder['handle']} forked")], "no notice for seeded forks"
    assert not mails_to(mail, forker["email"], 0, lambda m: "forked" in m.get("Subject", ""))


def test_wf_fork_credit_lineage(browser, app_url):
    t = tok()
    author, forker, other = person("author"), person("forker"), person("other")
    head = files(html="<p>v2</p>\r\n", css="p{}", js="1")
    ids = seed(app_url, users=[author, forker, other],
               pens=[pen("s", author, f"Source {t}", "public", ["css"],
                         [version(files(html="<p>v1</p>")), version(head, ["dayjs@1.11.13"])]),
                     pen("priv", author, f"Private {t}", "private", versions=[version(files(html="p"))]),
                     pen("empty", author, f"Empty {t}", "public")])
    src, priv, empty = ids["pens"]["s"], ids["pens"]["priv"], ids["pens"]["empty"]
    a, f, o = Api(app_url, author["handle"]), Api(app_url, forker["handle"]), Api(app_url, other["handle"])
    fork = f.ok("POST", f"/api/pens/{src}/fork", status=201, key=idempotency_key())
    assert fork["visibility"] == "unlisted" and fork["title"] == f"Source {t}" and fork["tags"] == ["css"]
    assert fork["forked_from"]["pen_id"] == src and fork["forked_from"]["version"] == 2
    v1 = f.ok("GET", f"/api/pens/{fork['id']}/versions/1")
    assert v1["files"] == head and v1["libraries"] == ["dayjs@1.11.13"] and v1["sha256"] == canonical_sha(head, ["dayjs@1.11.13"])
    assert snapshot(fork["id"], 1)["files"] == head
    second = o.ok("POST", f"/api/pens/{src}/fork", status=201, key=idempotency_key())
    assert a.pen(src)["forks"] == 2
    o.ok("DELETE", f"/api/pens/{second['id']}", status=204)
    assert a.pen(src)["forks"] == 1, "deleting a fork lowers the count"
    own = a.ok("POST", f"/api/pens/{priv}/fork", status=201, key=idempotency_key())
    assert own["visibility"] == "private"
    assert_not_found(f.call("POST", f"/api/pens/{priv}/fork", key=idempotency_key()), "forking someone else's private pen")
    assert_error(f.call("POST", f"/api/pens/{empty}/fork", key=idempotency_key()), 409, "nothing_to_fork", "forking head 0")

    a.ok("PATCH", f"/api/pens/{src}", {"visibility": "private"})
    assert f.pen(fork["id"])["forked_from"] == {"hidden": True}
    with opened(browser, app_url, f"/pen/{fork['id']}", forker["handle"]) as page:
        wait_render(page, 1, "fork render")
        expect(page.get_by_text("Forked from a private pen", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name=re.compile(r"^Forked from"))).to_have_count(0)
        a.ok("DELETE", f"/api/pens/{src}", status=204)
        assert f.pen(fork["id"])["forked_from"] == {"removed": True}
        page.reload()
        wait_render(page, 1, "fork render after source deletion")
        expect(page.get_by_text("Forked from a removed pen", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name=re.compile(r"^Forked from"))).to_have_count(0)


def test_wf_fork_credit_delete(browser, app_url):
    t = tok()
    author, fan, forker = person("author"), person("fan"), person("forker")
    title = f"Doomed {t}"
    ids = seed(app_url, users=[author, fan, forker],
               pens=[pen("s", author, title, "public", versions=[version(files(html="<p>d</p>")), version(files(html="<p>e</p>"))])],
               likes=[{"user": fan["handle"], "pen": "s"}],
               collections=[{"key": "c", "owner": fan["handle"], "title": f"Keep {t}", "pens": ["s"]}])
    src, coll = ids["pens"]["s"], ids["collections"]["c"]
    fork = Api(app_url, forker["handle"]).ok("POST", f"/api/pens/{src}/fork", status=201, key=idempotency_key())
    assert S3().keys(f"pens/{src}/")
    with opened(browser, app_url, f"/pen/{src}", author["handle"]) as page:
        wait_render(page, 1, "render")
        settings_btn = page.get_by_role("button", name="Pen settings", exact=True)
        settings_btn.focus()
        page.keyboard.press("Enter")
        delete_btn = page.get_by_role("dialog", name="Pen settings").get_by_role("button", name="Delete pen")
        delete_btn.focus()
        page.keyboard.press("Enter")
        confirm = page.get_by_role("alertdialog", name="Delete this pen?")
        expect(confirm.get_by_text(DELETE_COPY.format(title=title), exact=True)).to_be_visible()
        expect(confirm.get_by_role("button", name="Cancel")).to_be_focused()
        page.keyboard.press("Escape")
        expect(delete_btn).to_be_focused()
        page.keyboard.press("Enter")
        confirm.get_by_role("button", name="Delete", exact=True).click()
        wait_path(page, r"/dashboard", "delete lands on /dashboard")
        wait_text(page, status(page, "Dashboard status"), DELETED.format(title=title), "delete announcement")

    a, anon = Api(app_url, author["handle"]), Api(app_url)
    for path in (f"/api/pens/{src}", f"/api/pens/{src}/versions", f"/api/pens/{src}/versions/1",
                 f"/api/pens/{src}/diff?a=1&b=2", f"/api/pens/{src}/export"):
        assert_not_found(a.call("GET", path), f"GET {path} after delete")
    assert_not_found(a.call("POST", "/api/renders", {"pen_id": src}), "a render of a deleted pen")
    missing = random_pen_id()
    gone, never = anon.call("GET", f"/embed/{src}"), anon.call("GET", f"/embed/{missing}")
    assert gone.status_code == 404 and gone.content == never.content
    assert S3().keys(f"pens/{src}/") == []
    assert all(p["id"] != src for p in anon.ok("GET", f"/api/search?q={t}")["pens"])
    fan_api = Api(app_url, fan["handle"])
    assert fan_api.ok("GET", f"/api/collections/{coll}")["pens"] == []
    assert [c["count"] for c in fan_api.ok("GET", "/api/collections")["collections"] if c["id"] == coll] == [0]
    kept = Api(app_url, forker["handle"]).pen(fork["id"])
    assert kept["head"] == 1 and kept["forked_from"] == {"removed": True}
    assert S3().keys(f"pens/{fork['id']}/") == [f"pens/{fork['id']}/versions/1.json"]


def test_wf_two_tab_conflict_saves(app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>1</p>"))])
    racers = 5
    results: list[tuple[int, httpx.Response]] = []
    barrier = threading.Barrier(racers)

    def go(i: int) -> None:
        client = Api(app_url, owner["handle"])
        barrier.wait(timeout=HTTP_TIMEOUT_S)
        results.append((i, client.save(pen_id, 1, files(html=f"<p>racer {i}</p>"))))

    threads = [threading.Thread(target=go, args=(i,)) for i in range(racers)]
    for th in threads:
        th.start()
    for th in threads:
        th.join(timeout=HTTP_TIMEOUT_S)
    winners = [(i, r) for i, r in results if r.status_code == 201]
    assert len(results) == racers and len(winners) == 1, [(i, r.status_code) for i, r in results]
    for _, r in results:
        if r.status_code != 201:
            assert assert_error(r, 409, "version_conflict", "a losing simultaneous save")["head"] == 2
    i, win = winners[0]
    assert win.json()["number"] == 2 and snapshot(pen_id, 2)["files"]["html"] == f"<p>racer {i}</p>"

    api = Api(app_url, owner["handle"])
    assert api.save(pen_id, 2, files(html="<p>3</p>")).json()["number"] == 3
    key = idempotency_key()
    first = api.save(pen_id, 3, files(html="<p>4</p>"), key=key)
    assert first.status_code == 201 and first.json()["number"] == 4
    replay = api.save(pen_id, 3, files(html="<p>4</p>"), key=key)
    assert replay.status_code == 201 and replay.json() == first.json(), "a replay returns the stored response"
    assert_error(api.save(pen_id, 3, files(html="<p>other</p>"), key=key), 409, "idempotency_conflict", "same key, other body")
    entries = api.versions(pen_id)
    assert [e["number"] for e in entries] == [1, 2, 3, 4]
    for e in entries:
        snap = snapshot(pen_id, e["number"])
        assert snap["sha256"] == e["sha256"] == canonical_sha(snap["files"], snap["libraries"])


def test_wf_two_tab_conflict_alert(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html=ONE_HTML))])
    api = Api(app_url, owner["handle"])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as a:
        wait_render(a, 1, "tab A render")
        b = a.context.new_page()
        b.set_viewport_size(WIDE)
        b.goto(f"{app_url}/pen/{pen_id}")
        wait_render(b, 1, "tab B render")
        a.bring_to_front()
        replace_pane(a, "html", "two")
        press_save(a)
        wait_saved(a, 2)
        b.bring_to_front()
        advance(b, LIVE_POLL_MS * 2)
        assert pane_text(pane(b, "html")) == ONE_HTML, "the editor never replaces code on its own"
        replace_pane(b, "js", MINE_JS)
        press_save(b)
        alert = b.get_by_role("alert").filter(has_text=CONFLICT.format(head=2))
        expect(alert).to_be_visible()
        keep = b.get_by_role("button", name="Keep mine as next version", exact=True)
        expect(keep).to_be_focused()
        assert pane_text(pane(b, "js")) == MINE_JS
        assert (text_of(status(b, "Save status")) or "") == ""
        b.keyboard.press("Tab")
        expect(b.get_by_role("button", name="Load latest", exact=True)).to_be_focused()
        b.keyboard.press("Shift+Tab")
        expect(keep).to_be_focused()
        b.keyboard.press("Enter")
        wait_saved(b, 3)
        expect(alert).to_have_count(0)
        v3 = api.ok("GET", f"/api/pens/{pen_id}/versions/3")["files"]
        assert v3["js"] == MINE_JS and v3["html"] == ONE_HTML

        a.bring_to_front()
        replace_pane(a, "js", "let theirs = 2")
        press_save(a)
        expect(a.get_by_role("alert").filter(has_text=CONFLICT.format(head=3))).to_be_visible()
        a.get_by_role("button", name="Load latest", exact=True).click()
        wait_text(a, status(a, "Save status"), "Loaded version 3", "Load latest")
        assert pane_text(pane(a, "js")) == MINE_JS and pane_text(pane(a, "html")) == ONE_HTML
    assert [e["number"] for e in api.versions(pen_id)] == [1, 2, 3]
    assert assert_error(api.save(pen_id, 1, files()), 409, "version_conflict", "API stale save")["head"] == 3


def test_wf_two_tab_conflict_draft(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html=KEEP_HTML))])
    interval = config(app_url)["draft_interval_ms"]
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        region = page.get_by_role("region", name="Unsaved draft")
        html = pane(page, "html")
        replace_pane(page, "html", "draft text")
        advance(page, interval + STEP_MS)
        page.reload()
        wait_render(page, 1, "render after reload")
        expect(region).to_be_visible()
        assert re.search(r"You have unsaved edits from \d{2}:\d{2}\.", region.inner_text())
        assert pane_text(html) == KEEP_HTML
        region.get_by_role("button", name="Restore draft").click()
        expect(html).to_be_focused()
        expect(region).to_have_count(0)
        assert pane_text(html) == "draft text"
        page.reload()
        wait_render(page, 1, "render after second reload")
        expect(region).to_be_visible()
        region.get_by_role("button", name="Discard draft").click()
        expect(html).to_be_focused()
        assert pane_text(html) == KEEP_HTML
        page.reload()
        wait_render(page, 1, "render after discard")
        advance(page, interval)
        expect(region).to_have_count(0)

        replace_pane(page, "html", "draft two")
        advance(page, interval + STEP_MS)
        page.reload()
        wait_render(page, 1, "render with second draft")
        region.get_by_role("button", name="Restore draft").click()
        press_save(page)
        wait_saved(page, 2)
        page.reload()
        wait_render(page, 1, "render after save")
        advance(page, interval)
        expect(region).to_have_count(0)
    assert Api(app_url, owner["handle"]).pen(pen_id)["version"]["files"]["html"] == "draft two"


def test_wf_live_likes_toggle(browser, app_url):
    t = tok()
    author, fan, second = person("author"), person("fan"), person("second")
    ids = seed(app_url, users=[author, fan, second],
               pens=[pen("p", author, f"Liked {t}", "public", versions=[version(files(html="<p>l</p>"))]),
                     pen("priv", author, f"Private {t}", "private", versions=[version(files(html="p"))])])
    p, priv = ids["pens"]["p"], ids["pens"]["priv"]
    a, f, s = Api(app_url, author["handle"]), Api(app_url, fan["handle"]), Api(app_url, second["handle"])
    with opened(browser, app_url, f"/pen/{p}", fan["handle"]) as page:
        wait_render(page, 1, "render")
        like = page.get_by_role("button", name="Like", exact=True)
        expect(like).to_have_attribute("aria-pressed", "false")
        wait_text(page, status(page, "Likes"), "0 likes", "initial likes")
        like.click()
        expect(like).to_have_attribute("aria-pressed", "true")
        wait_text(page, status(page, "Likes"), "1 like", "after Like")
        assert f.pen(p)["likes"] == 1 and f.pen(p)["liked"] is True
        like.click()
        expect(like).to_have_attribute("aria-pressed", "false")
        wait_text(page, status(page, "Likes"), "0 likes", "after unlike")
        assert f.pen(p)["likes"] == 0
    assert f.ok("PUT", f"/api/pens/{p}/like") == {"liked": True, "likes": 1}
    assert f.ok("PUT", f"/api/pens/{p}/like") == {"liked": True, "likes": 1}
    assert s.ok("PUT", f"/api/pens/{p}/like") == {"liked": True, "likes": 2}
    assert f.ok("DELETE", f"/api/pens/{p}/like") == {"liked": False, "likes": 1}
    assert f.ok("DELETE", f"/api/pens/{p}/like") == {"liked": False, "likes": 1}
    assert a.pen(p)["likes"] == 1
    assert [x["likes"] for x in a.ok("GET", f"/api/search?q={t}")["pens"] if x["id"] == p] == [1]
    assert_error(a.call("PUT", f"/api/pens/{priv}/like"), 403, "forbidden", "liking one's own private pen")
    assert_not_found(f.call("PUT", f"/api/pens/{priv}/like"), "liking someone else's private pen")
    assert a.pen(priv)["likes"] == 0


def test_wf_live_likes_live(browser, app_url):
    author, fan = person("author"), person("fan")
    p = seed(app_url, users=[author, fan],
             pens=[pen("p", author, f"Live {tok()}", "public", versions=[version(files(html="<p>l</p>"))])])["pens"]["p"]
    f = Api(app_url, fan["handle"])
    with opened(browser, app_url, f"/pen/{p}", author["handle"]) as owner_page, \
            opened(browser, app_url, f"/pen/{p}") as reader:
        for pg in (owner_page, reader):
            wait_render(pg, 1, "render")
            wait_text(pg, status(pg, "Likes"), "0 likes", "initial likes")
            assert status(pg, "Likes").get_attribute("aria-live") in (None, "polite")
        f.ok("PUT", f"/api/pens/{p}/like")
        for pg in (owner_page, reader):
            wait_text(pg, status(pg, "Likes"), "1 like", "a like reaches the open page", seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
        f.ok("DELETE", f"/api/pens/{p}/like")
        for pg in (owner_page, reader):
            wait_text(pg, status(pg, "Likes"), "0 likes", "an unlike reaches the open page", seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)


def test_wf_collections_search_collections(browser, app_url):
    t = tok()
    author = person("author")
    titles = [f"Alpha {t}", f"Beta {t}", f"Gamma {t}"]
    ids = seed(app_url, users=[author], pens=[pen(f"p{i}", author, ti, versions=[version(files(html="x"))])
                                              for i, ti in enumerate(titles)])
    api = Api(app_url, author["handle"])
    max_tags = config(app_url)["max_tags"]
    with opened(browser, app_url, "/collections", author["handle"]) as page:
        expect(page.get_by_text(COLLECTIONS_NONE, exact=True)).to_be_visible()
        page.get_by_role("button", name="New collection", exact=True).click()
        path = wait_path(page, r"/collections/[a-z0-9]{10}", "New collection lands on its page")
        cid = path.rsplit("/", 1)[1]
        expect(page.get_by_role("textbox", name="Collection title")).to_have_value("Untitled collection")
        expect(page.get_by_text(COLLECTION_EMPTY, exact=True)).to_be_visible()
        combo = page.get_by_role("combobox", name="Add a pen")
        for title in titles + [titles[0]]:
            expected = f"{title} is already in this collection." if title == titles[0] and \
                page.get_by_role("list", name="Collection pens").get_by_role("listitem").count() == 3 else f"Added {title}"
            combo.focus()
            page.keyboard.press("Control+a")
            page.keyboard.type(title)
            page.get_by_role("option", name=title, exact=True).click()
            wait_text(page, status(page, "Collection status"), expected, "collection add announcement")
        lst = page.get_by_role("list", name="Collection pens")
        expect(lst.get_by_role("listitem")).to_have_count(3)
        expect(lst.get_by_role("button", name=f"Remove {titles[2]}")).to_be_visible()
        gamma = lst.get_by_role("link", name=titles[2], exact=True)
        gamma.focus()
        page.keyboard.press("Alt+ArrowUp")
        wait_text(page, status(page, "Collection status"), f"Moved {titles[2]} to position 2 of 3", "move announcement")
        expect(gamma).to_be_focused()
        page.reload()
        wait_for(page, lambda: [x.strip() for x in lst.get_by_role("link").all_inner_texts()],
                 lambda v: v == [titles[0], titles[2], titles[1]], "collection order after reload")
    assert [p["title"] for p in api.ok("GET", f"/api/collections/{cid}")["pens"]] == [titles[0], titles[2], titles[1]]

    p0 = ids["pens"]["p0"]
    with opened(browser, app_url, f"/pen/{p0}", author["handle"]) as page:
        wait_render(page, 1, "render")
        page.get_by_role("button", name="Pen settings", exact=True).click()
        dialog = page.get_by_role("dialog", name="Pen settings")
        box = dialog.get_by_role("textbox", name="Add tag")

        def add_tag(value: str) -> None:
            box.fill(value)
            box.press("Enter")

        add_tag("  Demo-Tag  ")
        expect(dialog.get_by_role("button", name=f"Remove tag {DEMO_TAG}")).to_be_visible()
        add_tag("bad tag!")
        wait_text(page, status(page, "Settings status"), TAG_FORMAT, "tag format copy")
        add_tag("demo-tag")
        wait_text(page, status(page, "Settings status"), TAG_DUPLICATE, "duplicate tag copy")
        extra = [f"t{i}" for i in range(max_tags - 1)]
        for tag in extra:
            add_tag(tag)
            expect(dialog.get_by_role("button", name=f"Remove tag {tag}")).to_be_visible()
        add_tag("overflow")
        wait_text(page, status(page, "Settings status"), TAG_MAX.format(max=max_tags), "too many tags copy")
    assert api.pen(p0)["tags"] == ["demo-tag"] + extra
    p1 = ids["pens"]["p1"]
    assert_error(api.call("PATCH", f"/api/pens/{p1}", {"tags": ["Upper"]}), 422, "validation", "uppercase tag")
    assert_error(api.call("PATCH", f"/api/pens/{p1}", {"tags": [f"x{i}" for i in range(max_tags + 1)]}), 422, "validation", "too many tags")
    assert api.pen(p1)["tags"] == []


def test_wf_collections_search_search(browser, app_url):
    tq = tok()
    owner, l1, l2, l3 = person("owner"), person("likera"), person("likerb"), person("likerc")
    tag = f"t-{tq}"
    v = [version(files(html="x"))]
    ids = seed(app_url, users=[owner, l1, l2, l3],
               pens=[pen("p1", owner, f"Quarry {tq} alpha", "public", versions=v),
                     pen("p2", owner, f"Quarry {tq} beta", "public", versions=v),
                     pen("p3", owner, f"Quarry {tq} gamma", "unlisted", versions=v),
                     pen("p4", owner, f"Quarry {tq} delta", "private", versions=v),
                     pen("p5", owner, "Unrelated", "public", [tag], versions=v)],
               likes=[{"user": l1["handle"], "pen": "p1"}, {"user": l2["handle"], "pen": "p1"},
                      {"user": l3["handle"], "pen": "p5"}])
    p = ids["pens"]
    anon = Api(app_url)

    def ids_for(q: str) -> list[str]:
        r = anon.http.get("/api/search", params={"q": q}).json()
        assert r["total"] == len(r["pens"])
        return [x["id"] for x in r["pens"]]

    assert ids_for(tq) == [p["p1"], p["p5"], p["p2"]]
    assert ids_for(tq.upper()) == [p["p1"], p["p5"], p["p2"]]
    assert ids_for(f"tag:{tag}") == [p["p5"]]
    assert ids_for(f"{tq} beta") == [p["p2"]]
    assert anon.http.get("/api/search", params={"q": ""}).json()["total"] == 0

    debounce = config(app_url)["search_debounce_ms"]
    with opened(browser, app_url, "/explore") as page:
        expect(page.get_by_text(SEARCH_REST, exact=True)).to_be_visible()
        history_len = page.evaluate("() => history.length")
        held_routes: list = []

        def hold_first(route) -> None:
            if not held_routes:
                held_routes.append(route)
            else:
                route.continue_()

        page.route(lambda url: urlparse(url).path == "/api/search", hold_first)
        box = page.get_by_role("searchbox", name="Search pens")
        box.focus()
        page.keyboard.type(tq)
        advance(page, debounce)
        wait_for(page, lambda: len(held_routes), lambda v: v == 1, "the first query is held", step_ms=0)
        page.keyboard.type(" beta")
        advance(page, debounce)
        results = page.get_by_role("list", name="Results")
        wait_text(page, status(page, "Search results"), "1 pen found", "latest query count")
        assert results.get_by_role("link").all_inner_texts() == [f"Quarry {tq} beta"]
        try:
            held_routes[0].continue_()
        except PlaywrightError:
            pass
        advance(page, debounce * 4)
        page.evaluate("() => 0")
        assert text_of(status(page, "Search results")) == "1 pen found", "a late earlier answer must be discarded"
        assert results.get_by_role("link").all_inner_texts() == [f"Quarry {tq} beta"]
        assert parse_qs(urlparse(page.url).query)["q"] == [f"{tq} beta"]
        assert page.evaluate("() => history.length") == history_len
        page.unroute(lambda url: urlparse(url).path == "/api/search")
        page.reload()
        wait_text(page, status(page, "Search results"), "1 pen found", "search repeats on reload")
        box.fill(tq)
        advance(page, debounce)
        wait_text(page, status(page, "Search results"), "3 pens found", "three results")
        assert [x.strip() for x in results.get_by_role("link").all_inner_texts()][:3] == \
            [f"Quarry {tq} alpha", "Unrelated", f"Quarry {tq} beta"]
        box.fill(f"{tq}zzzz")
        advance(page, debounce)
        wait_text(page, status(page, "Search results"), "No pens match", "no match copy")


def test_wf_collections_search_visibility(browser, app_url):
    t = tok()
    author, other = person("author"), person("other")
    ids = seed(app_url, users=[author, other],
               pens=[pen("p", author, f"Shown {t}", "private", versions=[version(files(html="v"))])],
               collections=[{"key": "c", "owner": other["handle"], "title": f"Watch {t}", "pens": []}])
    pid, cid = ids["pens"]["p"], ids["collections"]["c"]
    anon, o, a = Api(app_url), Api(app_url, other["handle"]), Api(app_url, author["handle"])

    def in_search() -> bool:
        return pid in [x["id"] for x in anon.http.get("/api/search", params={"q": t}).json()["pens"]]

    with opened(browser, app_url, f"/pen/{pid}", author["handle"]) as page:
        wait_render(page, 1, "render")
        page.get_by_role("button", name="Pen settings", exact=True).click()
        dialog = page.get_by_role("dialog", name="Pen settings")
        expect(dialog.get_by_role("radio", name="Private")).to_be_focused()
        page.keyboard.press("ArrowRight")
        wait_text(page, status(page, "Settings status"), "This pen is now unlisted.", "unlisted copy")
        assert anon.call("GET", f"/api/pens/{pid}").status_code == 200 and not in_search()
        assert anon.call("GET", f"/embed/{pid}").status_code == 200
        page.keyboard.press("ArrowRight")
        wait_text(page, status(page, "Settings status"), "This pen is now public.", "public copy")
        assert in_search()
        o.ok("POST", f"/api/collections/{cid}/pens", {"pen_id": pid}, status=201)
        assert_error(o.call("PATCH", f"/api/pens/{pid}", {"visibility": "private"}), 403, "forbidden", "a non-owner visibility change")
        page.keyboard.press("ArrowLeft")
        wait_text(page, status(page, "Settings status"), "This pen is now unlisted.", "back to unlisted")
        page.keyboard.press("ArrowLeft")
        wait_text(page, status(page, "Settings status"), "This pen is now private.", "private copy")
    assert_not_found(anon.call("GET", f"/api/pens/{pid}"), "anonymous view of a now-private pen")
    assert_not_found(o.call("GET", f"/api/pens/{pid}"), "another user's view of a now-private pen")
    assert anon.call("GET", f"/embed/{pid}").status_code == 404 and not in_search()
    assert o.ok("GET", f"/api/collections/{cid}")["pens"] == []
    assert a.ok("PATCH", f"/api/pens/{pid}", {"visibility": "private"})["visibility"] == "private"


def test_wf_embed_share_share(browser, app_url):
    t = tok()
    author = person("author")
    title = f"Shared {t}"
    ids = seed(app_url, users=[author], pens=[pen("p", author, title, "public", versions=[version(files(html="s"))]),
                                              pen("q", author, f"Hidden {t}", "private", versions=[version(files(html="h"))])])
    pid = ids["pens"]["p"]
    public = os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")
    with opened(browser, app_url, f"/pen/{pid}", author["handle"]) as page:
        page.context.grant_permissions(["clipboard-read", "clipboard-write"])
        wait_render(page, 1, "render")
        share = page.get_by_role("button", name="Share", exact=True)
        share.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Share")
        expect(dialog).to_be_visible()
        checked = [n for n in SHARE_TABS if dialog.get_by_role("radio", name=n, exact=True).is_checked()]
        assert len(checked) == 1
        expect(dialog.get_by_role("radio", name=checked[0], exact=True)).to_be_focused()
        nxt = SHARE_TABS[(SHARE_TABS.index(checked[0]) + 1) % len(SHARE_TABS)]
        page.keyboard.press("ArrowRight")
        expect(dialog.get_by_role("radio", name=nxt, exact=True)).to_be_checked()
        link = f"{public}/embed/{pid}?tab={nxt.lower()}"
        expect(dialog.get_by_role("textbox", name="Embed link")).to_have_value(link)
        expect(dialog.get_by_role("textbox", name="Embed code")).to_have_value(
            f'<iframe src="{link}" title="{title} on Ashlar" width="100%" height="400"></iframe>')
        dialog.get_by_role("button", name="Copy link").click()
        wait_text(page, status(page, "Share status"), "Link copied", "copy announcement")
        assert page.evaluate("() => navigator.clipboard.readText()") == link
        allowed = set(SHARE_TABS) | {"Embed link", "Embed code", "Copy link", "Close"}
        names = tab_order(page, len(allowed) * 2)
        assert set(names) <= allowed, f"Tab left the Share dialog: {names}"
        page.keyboard.press("Escape")
        expect(dialog).to_be_hidden()
        expect(share).to_be_focused()
        names = tab_order(page, TAB_PRESSES)
        assert not {"Copy link", "Embed link", "Embed code"} & set(names), "the closed dialog is inert"

        page.goto(f"{app_url}/pen/{ids['pens']['q']}")
        wait_render(page, 1, "private render")
        page.get_by_role("button", name="Share", exact=True).click()
        expect(page.get_by_role("dialog", name="Share").get_by_text(SHARE_PRIVATE, exact=True)).to_be_visible()


def test_wf_embed_share_embed(browser, app_url):
    head = files(html="<p>embedded</p>", css="p { color: teal }", js="window.ran = true;")
    owner, pid, title = one_pen(app_url, [version(files(html="<p>old</p>")), version(head)], visibility="unlisted")
    with opened(browser, app_url, f"/embed/{pid}?tab=css") as page:
        tabs = page.get_by_role("tablist", name="Embed")
        tab = {n: tabs.get_by_role("tab", name=n, exact=True) for n in SHARE_TABS}
        expect(tab["CSS"]).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel")).to_contain_text(head["css"])
        expect(page.get_by_role("textbox")).to_have_count(0)
        expect(page.get_by_role("link", name="Open on Ashlar")).to_be_visible()
        expect(page.get_by_text(title, exact=True).first).to_be_visible()
        for n in SHARE_TABS:
            if n != "CSS":
                assert tab[n].evaluate("el => el.tabIndex") < 0
        tab["CSS"].focus()
        page.keyboard.press("ArrowRight")
        expect(tab["JS"]).to_be_focused()
        page.keyboard.press("Enter")
        expect(tab["JS"]).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("tabpanel")).to_contain_text(head["js"])
        page.keyboard.press("Home")
        expect(tab["HTML"]).to_be_focused()
        page.keyboard.press("ArrowLeft")
        expect(tab["Result"]).to_be_focused()
        page.keyboard.press(" ")
        expect(tab["Result"]).to_have_attribute("aria-selected", "true")
        seq = wait_render(page, 1, "embed result render")
        assert preview(page).get_attribute("data-preview-text") == "embedded"
        page.get_by_role("button", name="Rerun", exact=True).click()
        wait_for(page, lambda: render_seq(page), lambda v: v == seq + 1, "Rerun renders again")
        for query in ("", "?tab=bogus"):
            page.goto(f"{app_url}/embed/{pid}{query}")
            expect(page.get_by_role("tab", name="Result", exact=True)).to_have_attribute("aria-selected", "true")


def test_wf_embed_share_private(browser, app_url):
    owner, viewer = person("owner"), person("viewer")
    pid = seed(app_url, users=[owner, viewer], pens=[pen("p", owner, f"Secret {tok()}", "private",
                                                         versions=[version(files(html="s"))])])["pens"]["p"]
    missing = random_pen_id()
    routes = [("GET", "/api/pens/{id}", None), ("GET", "/api/pens/{id}/versions", None),
              ("GET", "/api/pens/{id}/versions/1", None), ("GET", "/api/pens/{id}/diff?a=1&b=1", None),
              ("GET", "/api/pens/{id}/export", None), ("PUT", "/api/pens/{id}/like", None),
              ("POST", "/api/pens/{id}/fork", None), ("PATCH", "/api/pens/{id}", {"title": "x"}),
              ("POST", "/api/renders", {"pen_id": "{id}"}), ("POST", "/api/renders", {"pen_id": "{id}", "version": 1})]
    pages = ["/embed/{id}", "/pen/{id}", "/pen/{id}/history"]
    for caller in (Api(app_url), Api(app_url, viewer["handle"])):
        signed = caller.http.cookies.get("ashlar_session") is not None
        for method, path, body in routes:
            def go(i: str) -> httpx.Response:
                b = json.loads(json.dumps(body).replace("{id}", i)) if body else None
                return caller.call(method, path.replace("{id}", i), b)
            hidden, never = go(pid), go(missing)
            assert (hidden.status_code, hidden.content) == (never.status_code, never.content), f"{method} {path}"
            if signed or method == "GET" or path == "/api/renders":
                assert_not_found(hidden, f"{method} {path} on a private pen")
        for path in pages:
            hidden, never = caller.call("GET", path.replace("{id}", pid)), caller.call("GET", path.replace("{id}", missing))
            assert hidden.status_code == 404 and hidden.content == never.content, path
    own = Api(app_url, owner["handle"])
    assert own.call("GET", f"/api/pens/{pid}").status_code == 200
    with opened(browser, app_url, f"/embed/{pid}") as page:
        expect(page.get_by_role("heading", name="Nothing here")).to_be_visible()
        expect(page.get_by_text("This pen does not exist, or it is not shared with you.", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="Go to Explore")).to_be_visible()


SANDBOX_JS = "\n".join([
    'try { document.cookie; console.log("cookie read"); } catch (e) { console.log(e.name); }',
    'try { localStorage.length; console.log("storage read"); } catch (e) { console.log(e.name); }',
    f'document.title = "{SEALED_TITLE}";',
    "window.parent.document.title;",
])


def test_wf_preview_isolation_sandbox(browser, app_url):
    owner, pid, _ = one_pen(app_url, [version(files(html=f"<p>{SEALED_TITLE}</p>", js=SANDBOX_JS))])
    with opened(browser, app_url, f"/pen/{pid}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        expect(status(page, "Preview status")).to_have_text("Preview updated")
        frame = page.get_by_title("Pen preview", exact=True)
        tokens = (frame.get_attribute("sandbox") or "").split()
        assert "allow-scripts" in tokens and "allow-same-origin" not in tokens
        src = urlparse(frame.get_attribute("src") or "")
        assert src.path.startswith("/preview/")
        entries = wait_for(page, lambda: console_entries(page), lambda v: len(v) >= 3, "sandbox entries")
        assert entries[:2] == ["log SecurityError", "log SecurityError"]
        assert entries[2].startswith("uncaught SecurityError: ") and entries[2].endswith("(line 4)")
        assert preview(page).get_attribute("data-preview-title") == SEALED_TITLE
        assert page.title() != SEALED_TITLE
        r = httpx.get(f"{app_url}{src.path}", timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200 and r.headers["content-type"].startswith("text/html")
    csp = directives(r.headers.get("content-security-policy", ""))
    assert "allow-scripts" in csp.get("sandbox", []) and "allow-same-origin" not in csp.get("sandbox", [])
    assert csp.get("connect-src") == ["'none'"]
    scripts = csp.get("script-src", csp.get("default-src", []))
    assert scripts and not {"*", *SCHEME_SOURCES} & set(scripts)
    for d in ("img-src", "font-src"):
        assert set(csp.get(d, csp.get("default-src", ["*"]))) <= {"data:", "blob:", "'none'"}, d
    gone = httpx.get(f"{app_url}/preview/{tok()}", timeout=HTTP_TIMEOUT_S)
    assert gone.status_code == 404 and gone.headers["content-type"].startswith("text/plain")


def test_wf_preview_isolation_gate(browser, app_url):
    js = "\n".join([
        'window.parent.postMessage({source: "ashlar-preview", render: location.pathname.split("/").pop(), '
        'nonce: "forged", kind: "log", text: "forged by pen", line: null, title: null}, "*");',
        'console.log("genuine");',
        'setTimeout(() => console.log("stale"), 2000);',
    ])
    owner, pid, _ = one_pen(app_url, [version(files(html="<p>gate</p>", js=js))])
    delay = config(app_url)["preview_delay_ms"]
    with opened(browser, app_url, f"/pen/{pid}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        wait_for(page, lambda: console_entries(page), lambda v: "log genuine" in v, "genuine entry", step_ms=0)
        render_id = urlparse(page.get_by_title("Pen preview", exact=True).get_attribute("src")).path.rsplit("/", 1)[1]
        page.evaluate("""rid => window.postMessage({source: 'ashlar-preview', render: rid, nonce: 'x', kind: 'log',
                         text: 'forged by page', line: null, title: null}, '*')""", render_id)
        page.evaluate("() => 0")
        assert console_entries(page) == ["log genuine"]
        advance(page, LIVE_POLL_MS)
        replace_pane(page, "html", "next")
        advance(page, delay)
        wait_render(page, 2, "the second render")
        advance(page, LIVE_POLL_MS)
        page.evaluate("() => 0")
        assert console_entries(page) == ["log genuine"], "an earlier render's late message must not show"
        assert page.get_by_role("log", name="Console", exact=True).get_attribute("data-count") == "1"


@pytest.mark.timeout(900)
def test_wf_storage_outage_outage(browser, app_url):
    down = os.environ["APP_STORAGE_DOWN_URL"]
    h = httpx.get(f"{down}/api/health", timeout=HTTP_TIMEOUT_S)
    assert h.status_code == 200 and h.json() == {"status": "unavailable"}
    assert httpx.get(f"{down}/", timeout=HTTP_TIMEOUT_S).status_code == 200
    r = httpx.post(f"{down}/api/renders", json={"html": "<p>x</p>", "css": "", "js": "", "libraries": []}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 201 and httpx.get(f"{down}{r.json()['url']}", timeout=HTTP_TIMEOUT_S).status_code == 200

    endpoint = urlparse(os.environ["S3_ENDPOINT"])
    relay = Relay(endpoint.hostname, endpoint.port or 80)
    try:
        with app_copy({"ASHLAR_GRADING": "1", "S3_ENDPOINT": f"http://127.0.0.1:{relay.port}"}) as copy:
            assert httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "unavailable"}
            relay.start()
            wait_api(lambda: httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT_S).json(), lambda v: v == {"status": "ok"},
                     "health recovers once storage answers, without a restart")
            owner, pid, _ = one_pen(copy, [version(files(html="one")), version(files(html="two"))])
            api = Api(copy, owner["handle"])
            with opened(browser, copy, f"/pen/{pid}", owner["handle"]) as page:
                wait_render(page, 1, "render")
                hist = page.context.new_page()
                hist.set_viewport_size(WIDE)
                hist.goto(f"{copy}/pen/{pid}/history")
                slider = hist.get_by_role("slider", name="Core sample")
                wait_for(hist, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "2", "history loaded")
                relay.stop()
                assert httpx.get(f"{copy}/api/health", timeout=HTTP_TIMEOUT_S).json() == {"status": "unavailable"}
                assert_error(api.save(pid, 2, files(html="api")), 503, "storage_unavailable", "API save while down")

                page.bring_to_front()
                replace_pane(page, "html", "kept edit")
                press_save(page)
                wait_text(page, status(page, "Save status"), STORAGE_SAVE, "save outage copy")
                expect(page.get_by_text("Version 2", exact=True)).to_be_visible()
                assert pane_text(pane(page, "html")) == "kept edit"
                page.get_by_role("button", name="Export", exact=True).click()
                wait_text(page, status(page, "Export status"), STORAGE_EXPORT, "export outage copy")

                hist.bring_to_front()
                slider.focus()
                hist.keyboard.press("Home")
                advance(hist, REST_MS)
                hist.get_by_role("button", name="Restore version 1", exact=True).click()
                wait_text(hist, status(hist, "History status"), "Storage is unreachable, so version 1 was not restored.",
                          "restore outage copy")
                assert [e["number"] for e in api.versions(pid)] == [1, 2]
                assert sorted(S3().keys(f"pens/{pid}/")) == [f"pens/{pid}/versions/1.json", f"pens/{pid}/versions/2.json"]

                relay.start()
                page.bring_to_front()
                pane(page, "html").focus()
                press_save(page)
                wait_saved(page, 3)
            assert [e["number"] for e in api.versions(pid)] == [1, 2, 3]
            assert snapshot(pid, 3)["files"]["html"] == "kept edit"
    finally:
        relay.stop()


def test_wf_storage_outage_export(browser, app_url):
    owner, pid, _ = one_pen(app_url, [version(files(html="<p>old</p>")), version(CRLF_FILES)])
    api = Api(app_url, owner["handle"])
    r = api.call("GET", f"/api/pens/{pid}/export")
    assert r.status_code == 200 and r.headers["content-type"].startswith("application/zip")
    assert r.headers["content-disposition"] == f'attachment; filename="{pid}-v2.zip"'
    stored = snapshot(pid, 2)["files"]

    def check(data: bytes) -> None:
        z = zipfile.ZipFile(io.BytesIO(data))
        assert sorted(z.namelist()) == ["index.html", "script.js", "style.css"]
        for name, p in (("index.html", "html"), ("style.css", "css"), ("script.js", "js")):
            assert z.read(name) == stored[p].encode("utf-8") == CRLF_FILES[p].encode("utf-8"), name

    check(r.content)
    blank = api.ok("POST", "/api/pens", {}, status=201)["id"]
    assert_error(api.call("GET", f"/api/pens/{blank}/export"), 409, "nothing_to_export", "export with no version")
    with opened(browser, app_url, f"/pen/{pid}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        export = page.get_by_role("button", name="Export", exact=True)
        export.focus()
        with page.expect_download() as info:
            page.keyboard.press("Enter")
        check(Path(info.value.path()).read_bytes())
        wait_text(page, status(page, "Export status"), "Exported version 2", "export announcement")
        page.goto(f"{app_url}/pen/{blank}")
        wait_render(page, 1, "blank render")
        export.focus()
        page.keyboard.press("Enter")
        wait_text(page, status(page, "Export status"), "Save a version before exporting.", "failed export copy")
        expect(export).to_be_focused()


SIGNUP_HANDLE = "Use 3 to 20 lowercase letters, digits or hyphens."
SIGNUP_EMAIL = "Enter an email address like name@example.com."
SIGNUP_PASSWORD = "Use at least 10 characters."
SIGNUP_TAKEN = "That handle is taken."
STORAGE_DELETE = "Storage is unreachable, so the pen was not deleted."
CROSS_SITE = "Cross-site request refused."
CONSOLE_KEEP = 500
TOOLBAR = ["Save", "Like", "Fork", "Share", "History", "Export", "Pen settings"]
FOREIGN_ORIGIN = "http://framer.example"


def query_of(page: Page) -> dict[str, str]:
    return {k: v[0] for k, v in parse_qs(urlparse(page.url).query).items()}


def second_page(page: Page, url: str, size: dict | None = None) -> Page:
    other = page.context.new_page()
    other.set_viewport_size(size or WIDE)
    other.goto(url)
    return other


def test_wf_keyboard_authoring_toolbar_keys(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>bar</p>"))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "first render")
        title = page.get_by_role("textbox", name="Pen title", exact=True)
        set_focus_on(page, title)
        names = tab_order(page, len(TOOLBAR) + 2)
        assert names == TOOLBAR + ["Side by side", "Pen preview"], f"editor tab order: {names}"
        replace_pane(page, "css", "p { margin: 0 }")
        set_focus_on(page, title)
        press_save(page)
        wait_saved(page, 2)
        expect(page.get_by_text("Version 2", exact=True)).to_be_visible()
    assert Api(app_url, owner["handle"]).pen(pen_id)["version"]["files"]["css"] == "p { margin: 0 }"


def test_wf_console_and_shelf_console_band(browser, app_url):
    total = 600
    js = f'Array.from({{length: {total}}}, (_, i) => i).forEach(i => console.log("e" + i));'
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>many</p>", js=js))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "first render")
        log = page.get_by_role("log", name="Console", exact=True)
        wait_for(page, lambda: log.get_attribute("data-count"), lambda v: v == str(total), "every entry is counted")
        entries = console_entries(page)
        assert len(entries) == CONSOLE_KEEP, f"the console keeps the latest {CONSOLE_KEEP}: {len(entries)}"
        assert entries[0] == f"log e{total - CONSOLE_KEEP}" and entries[-1] == f"log e{total - 1}"
        toggle = page.get_by_role("button", name="Console", exact=True)
        expect(toggle).to_have_attribute("aria-expanded", "true")
        toggle.focus()
        page.keyboard.press("Enter")
        expect(toggle).to_have_attribute("aria-expanded", "false")
        expect(log).to_be_hidden()
        clear = page.get_by_role("button", name="Clear console", exact=True, include_hidden=True)
        assert clear.count() == 0 or not focusable(clear.first), "Clear console is out of reach while closed"
        page.keyboard.press("Enter")
        expect(toggle).to_have_attribute("aria-expanded", "true")
        expect(log).to_be_visible()
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Clear console", exact=True)).to_be_focused()
        page.keyboard.press("Enter")
        wait_for(page, lambda: log.get_attribute("data-count"), lambda v: v == "0", "Clear console resets the count")
        assert console_entries(page) == []
        assert "0" in toggle.inner_text()


def test_wf_signup_verification_field_errors(browser, app_url):
    taken = person("taken")
    seed(app_url, users=[taken])
    with opened(browser, app_url, "/signup") as page:
        create = page.get_by_role("button", name="Create account", exact=True)
        create.focus()
        page.keyboard.press("Enter")
        alert = page.get_by_role("alert").filter(has_text="There is a problem")
        expect(alert).to_be_visible()
        fields = {SIGNUP_HANDLE: page.get_by_role("textbox", name="Handle", exact=True),
                  SIGNUP_EMAIL: page.get_by_role("textbox", name="Email", exact=True),
                  SIGNUP_PASSWORD: page.get_by_label("Password", exact=True)}
        for copy, field in fields.items():
            link = alert.get_by_role("link", name=copy, exact=True)
            expect(link).to_have_count(1)
            link.focus()
            page.keyboard.press("Enter")
            expect(field).to_be_focused()
        expect(page).to_have_url(re.compile(r".*/signup"))
        fields[SIGNUP_HANDLE].fill(taken["handle"])
        fields[SIGNUP_EMAIL].fill(f"fresh-{tok()}@example.test")
        fields[SIGNUP_PASSWORD].fill("granite-path-9")
        create.focus()
        page.keyboard.press("Enter")
        expect(alert.get_by_role("link", name=SIGNUP_TAKEN, exact=True)).to_be_visible()
        expect(alert.get_by_role("link")).to_have_count(1)
        alert.get_by_role("link", name=SIGNUP_TAKEN, exact=True).focus()
        page.keyboard.press("Enter")
        expect(fields[SIGNUP_HANDLE]).to_be_focused()


def test_wf_signup_verification_other_browser(browser, app_url, mail):
    user = person("joiner", verified=False)
    with opened(browser, app_url, "/api/health") as page:
        r = page.request.post(f"{app_url}/api/signup",
                              data={"handle": user["handle"], "email": user["email"], "password": PASSWORD})
        assert r.status == 201 and r.json()["verification"] == "sent"
        made = page.request.post(f"{app_url}/api/pens", data={})
        assert made.status == 201
        pen_id = made.json()["id"]
        page.goto(f"{app_url}/dashboard")
        editor = second_page(page, f"{app_url}/pen/{pen_id}")
        wait_render(editor, 1, "the unverified editor previews")
        for pg in (page, editor):
            expect(pg.get_by_role("region", name="Verify your email")).to_be_visible()
        link = verify_link(mails_to(mail, user["email"], 1)[0])
        parsed = urlparse(link)
        with opened(browser, app_url, f"{parsed.path}?{parsed.query}") as other:
            expect(other.get_by_role("heading", name=VERIFY_OK)).to_be_visible()
            for pg in (page, editor):
                wait_text(pg, status(pg, "Account status"), VERIFIED_LIVE, "verification reaches every open page",
                          seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
                expect(pg.get_by_role("region", name="Verify your email")).to_have_count(0)
            other.reload()
            expect(other.get_by_role("heading", name=VERIFY_INVALID)).to_be_visible()
        editor.bring_to_front()
        replace_pane(editor, "html", "<p>verified</p>")
        press_save(editor)
        wait_saved(editor, 1)
    assert Api(app_url, user["handle"]).pen(pen_id)["version"]["files"]["html"] == "<p>verified</p>"


def test_wf_panes_keyboard_stacked_share(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>stack</p>"))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "first render")
        page.get_by_role("radio", name="Side by side", exact=True).focus()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_role("radio", name="Stacked", exact=True)).to_be_checked()
        stage = sep(page, "Resize preview and code")
        wait_for(page, lambda: stage.get_attribute("aria-orientation"), lambda v: v == "horizontal",
                 "Stacked orientation", step_ms=0)
        assert stage.get_attribute("aria-valuenow") == str(SEP_PREVIEW_DEFAULT)
        before = preview(page).bounding_box()["height"]
        stage.focus()
        page.keyboard.press("ArrowDown")
        wait_for(page, lambda: stage.get_attribute("aria-valuenow"), lambda v: v == str(SEP_PREVIEW_DEFAULT + SEP_STEP),
                 "Down adds 5 to the preview share", step_ms=0)
        wait_for(page, lambda: preview(page).bounding_box()["height"], lambda h: h > before,
                 "the lower stage grows", step_ms=0)
        grown = preview(page).bounding_box()["height"]
        for press, value in (("ArrowLeft", SEP_PREVIEW_DEFAULT), ("ArrowUp", SEP_PREVIEW_DEFAULT - SEP_STEP)):
            page.keyboard.press(press)
            wait_for(page, lambda: stage.get_attribute("aria-valuenow"), lambda v, value=value: v == str(value),
                     f"{press} in Stacked", step_ms=0)
        wait_for(page, lambda: preview(page).bounding_box()["height"], lambda h: h < grown,
                 "the stage shrinks again", step_ms=0)
        for press, value in (("End", SEP_MAX), ("ArrowDown", SEP_MAX), ("Home", SEP_MIN), ("ArrowUp", SEP_MIN)):
            page.keyboard.press(press)
            wait_for(page, lambda: stage.get_attribute("aria-valuenow"), lambda v, value=value: v == str(value),
                     f"{press} clamps", step_ms=0)


def test_wf_panes_keyboard_layout_bands(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>bands</p>"))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "first render")
        page.get_by_role("radio", name="Side by side", exact=True).focus()
        page.keyboard.press("ArrowRight")
        stacked = page.get_by_role("radio", name="Stacked", exact=True)
        expect(stacked).to_be_checked()
        page.set_viewport_size(MEDIUM)
        radios = page.get_by_role("radiogroup", name="Layout", include_hidden=True)
        wait_for(page, lambda: radios.first.is_visible(), lambda v: v is False, "radios hidden in the medium band", step_ms=0)
        assert not focusable(page.get_by_role("radio", name="Stacked", exact=True, include_hidden=True).first)
        pv = preview(page).bounding_box()
        boxes = {k: pane(page, k).bounding_box() for k in PANES}
        assert pv["y"] + pv["height"] <= boxes["html"]["y"] + EDGE_PX, "medium: stage above the panes"
        assert boxes["html"]["y"] + boxes["html"]["height"] <= boxes["css"]["y"] + EDGE_PX, "medium: panes stacked"
        layout(page)
        page.set_viewport_size(WIDE)
        expect(stacked).to_be_visible()
        expect(stacked).to_be_checked()
        boxes = {k: pane(page, k).bounding_box() for k in PANES}
        assert boxes["html"]["x"] + boxes["html"]["width"] <= boxes["css"]["x"] + EDGE_PX, "Stacked columns return"
        assert boxes["html"]["y"] + boxes["html"]["height"] <= preview(page).bounding_box()["y"] + EDGE_PX


def test_wf_panes_keyboard_every_pen(browser, app_url):
    owner = person("author")
    ids = seed(app_url, users=[owner], pens=[pen("a", owner, f"First {tok()}", versions=[version(files(html="a"))]),
                                             pen("b", owner, f"Second {tok()}", versions=[version(files(html="b"))])])
    with opened(browser, app_url, f"/pen/{ids['pens']['a']}", owner["handle"]) as page:
        wait_render(page, 1, "pen A render")
        page.get_by_role("radio", name="Side by side", exact=True).focus()
        page.keyboard.press("ArrowLeft")
        expect(page.get_by_role("radio", name="Preview first", exact=True)).to_be_checked()
        hc = sep(page, "Resize HTML and CSS")
        hc.focus()
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        wait_for(page, lambda: hc.get_attribute("aria-valuenow"), lambda v: v == str(SEP_PANES_DEFAULT - 2 * SEP_STEP),
                 "two Up presses in Preview first", step_ms=0)
        page.goto(f"{app_url}/pen/{ids['pens']['b']}")
        wait_render(page, 1, "pen B render")
        expect(page.get_by_role("radio", name="Preview first", exact=True)).to_be_checked()
        assert sep(page, "Resize HTML and CSS").get_attribute("aria-valuenow") == str(SEP_PANES_DEFAULT - 2 * SEP_STEP)
        with opened(browser, app_url, f"/pen/{ids['pens']['b']}", owner["handle"]) as fresh:
            wait_render(fresh, 1, "pen B in another browser")
            expect(fresh.get_by_role("radio", name="Side by side", exact=True)).to_be_checked()
            assert sep(fresh, "Resize HTML and CSS").get_attribute("aria-valuenow") == str(SEP_PANES_DEFAULT)


def test_wf_phone_editing_menu(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>menu</p>"))])
    with opened(browser, app_url, "/dashboard", owner["handle"], size=NARROW) as page:
        expect(page.get_by_role("list", name="Your pens")).to_be_visible()
        layout(page)
        menu_btn = page.get_by_role("button", name="Menu", exact=True)
        expect(menu_btn).to_be_visible()
        expect(page.get_by_role("button", name="Start a pen", exact=True).first).to_be_visible()
        for name in ("Explore", "The shelf"):
            hidden = page.get_by_role("link", name=name, exact=True, include_hidden=True)
            assert all(not hidden.nth(i).is_visible() for i in range(hidden.count())), f"{name} shows outside Menu"
        tap(menu_btn)
        menu = page.get_by_role("dialog", name="Menu")
        expect(menu).to_be_visible()
        for name in ("Dashboard", "Explore", "Collections", "The shelf"):
            expect(menu.get_by_role("link", name=name, exact=True)).to_be_visible()
        tap(menu.get_by_role("link", name="The shelf", exact=True))
        wait_path(page, r"/shelf", "the Menu link navigates")
        expect(page.get_by_role("table", name="Pinned libraries")).to_be_visible()
        layout(page)


def test_wf_phone_editing_phone_reload(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html="<p>phone</p>"))])
    js = 'document.title = "tapped";'
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"], size=NARROW) as page:
        wait_render(page, 1, "first render")
        tabs = page.get_by_role("tablist", name="Panes")
        tap(tabs.get_by_role("tab", name="JS", exact=True))
        expect(tabs.get_by_role("tab", name="JS", exact=True)).to_have_attribute("aria-selected", "true")
        tap(pane(page, "js"))
        page.keyboard.type(js)
        hooks = page.get_by_role("region", name="Preview", exact=True, include_hidden=True).first
        wait_for(page, lambda: hooks.get_attribute("data-preview-title"), lambda v: v == "tapped",
                 "the edit renders after the delay, though the Result panel is hidden")
        tap(page.get_by_role("button", name="Save", exact=True))
        wait_saved(page, 2)
        page.reload()
        wait_render(page, 1, "render after reload")
        expect(tabs.get_by_role("tab", name="HTML", exact=True)).to_have_attribute("aria-selected", "true")
        for name in PHONE_TABS[1:]:
            assert tabs.get_by_role("tab", name=name, exact=True).evaluate("el => el.tabIndex") < 0
        expect(page.get_by_text("Version 2", exact=True)).to_be_visible()
        tap(tabs.get_by_role("tab", name="JS", exact=True))
        assert pane_text(pane(page, "js")) == js
        layout(page)


def test_wf_core_sample_address(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(f, created_at=t) for f, t in zip(SLIDER_VERSIONS, SLIDER_TIMES)])
    n = len(SLIDER_VERSIONS)
    with opened(browser, app_url, f"/pen/{pen_id}/history?a=v2&b=v3", owner["handle"]) as page:
        slider = page.get_by_role("slider", name="Core sample")
        compare = page.get_by_role("region", name="Compare")
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == "3", "the marker opens on B")
        expect(compare.get_by_text("Comparing version 2 with version 3", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name=restore_name(3), exact=True)).to_be_visible()
        page.goto(f"{app_url}/pen/{pen_id}/history?a=v9&b=v0")
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == str(n), "fallback marker at N")
        expect(compare.get_by_text(f"Comparing version {n} with version {n}", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name=restore_name(n), exact=True)).to_have_count(0)
        slider.focus()
        page.keyboard.press("Home")
        advance(page, REST_MS)
        wait_for(page, lambda: query_of(page), lambda q: q == {"a": f"v{n}", "b": "v1"}, "B follows the resting marker")
        page.keyboard.press("Enter")
        wait_for(page, lambda: query_of(page), lambda q: q == {"a": "v1", "b": "v1"}, "Enter pins A", step_ms=0)
        page.keyboard.press("End")
        advance(page, REST_MS)
        wait_for(page, lambda: query_of(page), lambda q: q == {"a": "v1", "b": f"v{n}"}, "End moves B to the head")
        page.reload()
        wait_for(page, lambda: slider.get_attribute("aria-valuenow"), lambda v: v == str(n), "reload keeps the marker")
        expect(compare.get_by_text(f"Comparing version 1 with version {n}", exact=True)).to_be_visible()


def test_wf_fork_credit_hidden_source(browser, app_url, mail):
    author, forker = person("author"), person("forker")
    title = f"Lintel {tok()}"
    src = seed(app_url, users=[author, forker],
               pens=[pen("s", author, title, "unlisted", versions=[version(files(html="<p>u</p>"))])])["pens"]["s"]
    with opened(browser, app_url, f"/pen/{src}", forker["handle"]) as page:
        wait_render(page, 1, "the unlisted pen renders by link")
        page.get_by_role("button", name="Fork", exact=True).focus()
        page.keyboard.press(" ")
        path = wait_path(page, rf"/pen/(?!{src}$)[a-z0-9]{{10}}", "the fork lands on its editor")
        fork_id = path.rsplit("/", 1)[1]
        assert fork_id != src
        expect(page.get_by_role("link", name=f"Forked from {title} by {author['handle']}", exact=True)).to_be_visible()
        Api(app_url, author["handle"]).ok("PATCH", f"/api/pens/{src}", {"visibility": "private"})
        page.reload()
        wait_render(page, 1, "the fork after the source turned private")
        expect(page.get_by_text("Forked from a private pen", exact=True)).to_be_visible()
        expect(page.get_by_role("link", name=re.compile(r"^Forked from"))).to_have_count(0)
    fork = Api(app_url, forker["handle"]).pen(fork_id)
    assert fork["visibility"] == "unlisted" and fork["forked_from"] == {"hidden": True}
    assert mails_to(mail, author["email"], 0, lambda m: title in m.get("Subject", "")) == []


def test_wf_two_tab_conflict_load_latest(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html=ONE_HTML))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as a:
        wait_render(a, 1, "tab A render")
        b = second_page(a, f"{app_url}/pen/{pen_id}")
        wait_render(b, 1, "tab B render")
        a.bring_to_front()
        for n, text in ((2, "two"), (3, "three")):
            replace_pane(a, "html", text)
            press_save(a)
            wait_saved(a, n)
        b.bring_to_front()
        advance(b, LIVE_POLL_MS * 2)
        replace_pane(b, "css", "p { padding: 0 }")
        press_save(b)
        expect(b.get_by_role("alert").filter(has_text=CONFLICT.format(head=3))).to_be_visible()
        expect(b.get_by_role("button", name="Keep mine as next version", exact=True)).to_be_focused()
        b.keyboard.press("Tab")
        expect(b.get_by_role("button", name="Load latest", exact=True)).to_be_focused()
        b.keyboard.press("Enter")
        wait_text(b, status(b, "Save status"), "Loaded version 3", "Load latest")
        assert pane_text(pane(b, "html")) == "three" and pane_text(pane(b, "css")) == ""
        replace_pane(b, "js", "let after = 4")
        press_save(b)
        wait_saved(b, 4)
        a.bring_to_front()
        replace_pane(a, "js", "let stale = 1")
        press_save(a)
        expect(a.get_by_role("alert").filter(has_text=CONFLICT.format(head=4))).to_be_visible()
    assert [e["number"] for e in Api(app_url, owner["handle"]).versions(pen_id)] == [1, 2, 3, 4]


def test_wf_two_tab_conflict_two_browsers(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html=ONE_HTML))])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as first, \
            opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as second:
        wait_render(first, 1, "first browser render")
        wait_render(second, 1, "second browser render")
        replace_pane(first, "html", "first wins")
        press_save(first)
        wait_saved(first, 2)
        replace_pane(second, "js", MINE_JS)
        set_focus_on(second, sep(second, "Resize CSS and JS"))
        press_save(second)
        alert = second.get_by_role("alert").filter(has_text=CONFLICT.format(head=2))
        expect(alert).to_be_visible()
        keep = second.get_by_role("button", name="Keep mine as next version", exact=True)
        expect(keep).to_be_focused()
        assert pane_text(pane(second, "js")) == MINE_JS
        second.keyboard.press(" ")
        wait_saved(second, 3)
        expect(alert).to_have_count(0)
    api = Api(app_url, owner["handle"])
    v3 = api.ok("GET", f"/api/pens/{pen_id}/versions/3")["files"]
    assert v3["html"] == ONE_HTML and v3["js"] == MINE_JS
    assert api.ok("GET", f"/api/pens/{pen_id}/versions/2")["files"]["html"] == "first wins"


def test_wf_two_tab_conflict_draft_cleared(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html=KEEP_HTML))])
    interval = config(app_url)["draft_interval_ms"]
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        Api(app_url, owner["handle"]).save(pen_id, 1, files(html="<p>elsewhere</p>"))
        replace_pane(page, "html", "draft before conflict")
        advance(page, interval + STEP_MS)
        press_save(page)
        expect(page.get_by_role("alert").filter(has_text=CONFLICT.format(head=2))).to_be_visible()
        page.get_by_role("button", name="Load latest", exact=True).focus()
        page.keyboard.press("Enter")
        wait_text(page, status(page, "Save status"), "Loaded version 2", "Load latest")
        page.reload()
        wait_render(page, 1, "render after reload")
        advance(page, interval)
        expect(page.get_by_role("region", name="Unsaved draft")).to_have_count(0)
        assert pane_text(pane(page, "html")) == "<p>elsewhere</p>"


def test_wf_live_likes_keyboard(browser, app_url):
    author, fan = person("author"), person("fan")
    p = seed(app_url, users=[author, fan],
             pens=[pen("p", author, f"Keyed {tok()}", "public", versions=[version(files(html="<p>k</p>"))])])["pens"]["p"]
    with opened(browser, app_url, f"/pen/{p}", fan["handle"]) as page:
        wait_render(page, 1, "render")
        like = page.get_by_role("button", name="Like", exact=True)
        like.focus()
        page.keyboard.press(" ")
        expect(like).to_have_attribute("aria-pressed", "true")
        wait_text(page, status(page, "Likes"), "1 like", "after Space")
        page.reload()
        wait_render(page, 1, "render after reload")
        expect(like).to_have_attribute("aria-pressed", "true")
        wait_text(page, status(page, "Likes"), "1 like", "after reload")
        like.focus()
        page.keyboard.press("Enter")
        expect(like).to_have_attribute("aria-pressed", "false")
        wait_text(page, status(page, "Likes"), "0 likes", "after Enter")
    stored = Api(app_url, fan["handle"]).pen(p)
    assert stored["likes"] == 0 and stored["liked"] is False


def test_wf_live_likes_fork_count(browser, app_url):
    author, forker, watcher = person("author"), person("forker"), person("reader")
    p = seed(app_url, users=[author, forker, watcher],
             pens=[pen("p", author, f"Counted {tok()}", "public", versions=[version(files(html="<p>c</p>"))])])["pens"]["p"]
    f = Api(app_url, forker["handle"])
    with opened(browser, app_url, f"/pen/{p}", author["handle"]) as owner_page, \
            opened(browser, app_url, f"/pen/{p}", watcher["handle"]) as reader:
        for pg in (owner_page, reader):
            wait_render(pg, 1, "render")
            wait_text(pg, status(pg, "Forks"), "0 forks", "initial forks")
        fork = f.ok("POST", f"/api/pens/{p}/fork", status=201, key=idempotency_key())
        for pg in (owner_page, reader):
            wait_text(pg, status(pg, "Forks"), "1 fork", "a fork reaches the open page", seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
        f.ok("DELETE", f"/api/pens/{fork['id']}", status=204)
        for pg in (owner_page, reader):
            wait_text(pg, status(pg, "Forks"), "0 forks", "a deleted fork reaches the open page",
                      seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)


def test_wf_live_likes_two_fans(browser, app_url):
    author, fan1, fan2 = person("author"), person("fan"), person("fan")
    p = seed(app_url, users=[author, fan1, fan2],
             pens=[pen("p", author, f"Shared {tok()}", "public", versions=[version(files(html="<p>s</p>"))])])["pens"]["p"]
    with opened(browser, app_url, f"/pen/{p}", author["handle"]) as owner_page, \
            opened(browser, app_url, f"/pen/{p}", fan1["handle"]) as one, \
            opened(browser, app_url, f"/pen/{p}", fan2["handle"]) as two:
        for pg in (owner_page, one, two):
            wait_render(pg, 1, "render")
        for pg in (one, two):
            pg.get_by_role("button", name="Like", exact=True).focus()
            pg.keyboard.press("Enter")
            expect(pg.get_by_role("button", name="Like", exact=True)).to_have_attribute("aria-pressed", "true")
        for pg in (owner_page, one, two):
            wait_text(pg, status(pg, "Likes"), "2 likes", "both likes reach every open page",
                      seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
    assert Api(app_url, author["handle"]).pen(p)["likes"] == 2


def test_wf_collections_search_tag_order(browser, app_url):
    t = f"t{tok()}"
    author, fan1, fan2 = person("author"), person("fan"), person("fan")
    titles = {k: f"{k.upper()} {t}" for k in ("a", "b", "c")}
    seed(app_url, users=[author, fan1, fan2],
         pens=[pen(k, author, titles[k], "public", tags=[t], versions=[version(files(html=k))]) for k in titles],
         likes=[{"user": fan1["handle"], "pen": "b"}, {"user": fan2["handle"], "pen": "b"},
                {"user": fan1["handle"], "pen": "c"}])
    with opened(browser, app_url, "/explore", fan1["handle"]) as page:
        box = page.get_by_role("searchbox", name="Search pens")
        box.focus()
        page.keyboard.type(f"tag:{t}")
        wait_text(page, status(page, "Search results"), "3 pens found", "tag search count")
        results = page.get_by_role("list", name="Results")
        order = [titles["b"], titles["c"], titles["a"]]
        wait_for(page, lambda: [x.strip() for x in results.get_by_role("link").all_inner_texts()],
                 lambda v: [x for x in v if x in order] == order, "results ordered by likes")
        assert query_of(page) == {"q": f"tag:{t}"}
        page.reload()
        wait_text(page, status(page, "Search results"), "3 pens found", "the address repeats the search")
        box.focus()
        page.keyboard.press("End")
        page.keyboard.type(" zzqq")
        wait_text(page, status(page, "Search results"), "No pens match", "no match count")


def test_wf_collections_search_collection_rows(browser, app_url):
    t = tok()
    me, them = person("me"), person("them")
    mine, theirs = f"Mine {t}", f"Theirs {t}"
    ids = seed(app_url, users=[me, them],
               pens=[pen("m", me, mine, versions=[version(files(html="m"))]),
                     pen("t", them, theirs, "public", versions=[version(files(html="t"))])],
               collections=[{"key": "c", "owner": me["handle"], "title": f"Studies {t}", "pens": ["m", "t"]}])
    cid = ids["collections"]["c"]
    with opened(browser, app_url, f"/collections/{cid}", me["handle"]) as page:
        lst = page.get_by_role("list", name="Collection pens")
        expect(lst.get_by_role("listitem")).to_have_count(2)
        combo = page.get_by_role("combobox", name="Add a pen")
        combo.focus()
        page.keyboard.type(mine)
        page.get_by_role("option", name=mine, exact=True).click()
        wait_text(page, status(page, "Collection status"), f"{mine} is already in this collection.", "duplicate add")
        lst.get_by_role("button", name=f"Remove {mine}").focus()
        page.keyboard.press("Enter")
        expect(lst.get_by_role("listitem")).to_have_count(1)
        combo.focus()
        page.keyboard.press("Control+a")
        page.keyboard.type(mine)
        page.get_by_role("option", name=mine, exact=True).click()
        wait_text(page, status(page, "Collection status"), f"Added {mine}", "re-add")
        wait_for(page, lambda: [x.strip() for x in lst.get_by_role("link").all_inner_texts()],
                 lambda v: v == [theirs, mine], "a re-added pen goes to the end")
        Api(app_url, them["handle"]).ok("PATCH", f"/api/pens/{ids['pens']['t']}", {"visibility": "private"})
        page.reload()
        wait_for(page, lambda: [x.strip() for x in lst.get_by_role("link").all_inner_texts()],
                 lambda v: v == [mine], "a pen hidden from the owner drops out")
    assert_not_found(Api(app_url, them["handle"]).call("GET", f"/api/collections/{cid}"), "someone else's collection")


def test_wf_embed_share_visibility_live(browser, app_url):
    owner, pid, _ = one_pen(app_url, [version(files(html="<p>vis</p>"))], visibility="public")
    with opened(browser, app_url, f"/pen/{pid}", owner["handle"]) as page, \
            opened(browser, app_url, f"/embed/{pid}") as reader:
        expect(reader.get_by_role("tablist", name="Embed")).to_be_visible()
        wait_render(page, 1, "render")
        page.get_by_role("button", name="Pen settings", exact=True).focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Pen settings")
        expect(dialog.get_by_role("radio", name="Public", exact=True)).to_be_focused()
        for name, copy in (("Unlisted", "This pen is now unlisted."), ("Private", "This pen is now private.")):
            page.keyboard.press("ArrowLeft")
            expect(dialog.get_by_role("radio", name=name, exact=True)).to_be_checked()
            wait_text(page, status(page, "Settings status"), copy, f"{name} announcement")
            if name == "Unlisted":
                reader.reload()
                expect(reader.get_by_role("tablist", name="Embed")).to_be_visible()
        reader.reload()
        expect(reader.get_by_role("heading", name="Nothing here")).to_be_visible()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        wait_text(page, status(page, "Settings status"), "This pen is now public.", "Public announcement")
        page.keyboard.press("Escape")
        expect(page.get_by_role("button", name="Pen settings", exact=True)).to_be_focused()
        reader.reload()
        expect(reader.get_by_role("tablist", name="Embed")).to_be_visible()
    assert Api(app_url, owner["handle"]).pen(pid)["visibility"] == "public"


def test_wf_embed_share_every_tab(browser, app_url):
    owner, pid, _ = one_pen(app_url, [version(files(html="<p>tabs</p>", css="p { color: red }"))], visibility="public")
    public = os.environ.get("APP_PUBLIC_URL", app_url).rstrip("/")
    with opened(browser, app_url, f"/pen/{pid}", owner["handle"]) as page, \
            opened(browser, app_url, "/api/health") as reader:
        wait_render(page, 1, "render")
        share = page.get_by_role("button", name="Share", exact=True)
        share.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Share")
        expect(dialog).to_be_visible()
        seen: dict[str, str] = {}
        for _ in SHARE_TABS:
            checked = next(n for n in SHARE_TABS if dialog.get_by_role("radio", name=n, exact=True).is_checked())
            link = dialog.get_by_role("textbox", name="Embed link").input_value()
            assert link == f"{public}/embed/{pid}?tab={checked.lower()}"
            seen[checked] = link
            page.keyboard.press("ArrowRight")
        assert set(seen) == set(SHARE_TABS)
        dialog.get_by_role("button", name="Close", exact=True).click()
        expect(dialog).to_be_hidden()
        expect(share).to_be_focused()
        for name, link in seen.items():
            reader.goto(f"{app_url}{urlparse(link).path}?{urlparse(link).query}")
            expect(reader.get_by_role("tab", name=name, exact=True)).to_have_attribute("aria-selected", "true")


def test_wf_preview_isolation_other_viewer(browser, app_url):
    js = "\n".join([
        'try { console.log(document.cookie); } catch (e) { console.log(e.name); }',
        'try { fetch("/api/me", {credentials: "include"}).catch(() => {}); } catch (e) {}',
    ])
    author, viewer = person("author"), person("viewer")
    pid = seed(app_url, users=[author, viewer],
               pens=[pen("p", author, f"Curious {tok()}", "public",
                         versions=[version(files(html="<p>curious</p>", js=js))])])["pens"]["p"]
    with opened(browser, app_url, f"/pen/{pid}", author["handle"]) as own, \
            opened(browser, app_url, f"/pen/{pid}", viewer["handle"]) as page:
        cookie = next(c["value"] for c in page.context.cookies() if c["name"] == "ashlar_session")
        for pg in (own, page):
            wait_render(pg, 1, "render")
            want = {"log SecurityError", BLOCKED_REQUEST.format(url="/api/me")}
            entries = wait_for(pg, lambda pg=pg: console_entries(pg), lambda v: want <= set(v), "isolation entries")
            assert all(cookie not in e for e in entries), "the session cookie reached the console"
            assert cookie not in (preview(pg).get_attribute("data-preview-text") or "")
        me = page.request.get(f"{app_url}/api/me")
        assert me.status == 200 and me.json()["user"]["handle"] == viewer["handle"]


def test_wf_preview_isolation_cross_site_writes(browser, app_url):
    owner, pid, title = one_pen(app_url, [version(files(html="<p>cs</p>"))])
    with opened(browser, app_url, f"/pen/{pid}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        for origin in ("null", FOREIGN_ORIGIN):
            r = page.request.patch(f"{app_url}/api/pens/{pid}", data={"title": "Hijacked"},
                                   headers={"Origin": origin})
            assert r.status == 403 and r.json() == {"error": "forbidden", "message": CROSS_SITE}, origin
            r = page.request.post(f"{app_url}/api/pens/{pid}/versions", headers={"Origin": origin},
                                  data={"base_version": 1, "files": files(html="x"), "libraries": []})
            assert r.status == 403 and r.json()["message"] == CROSS_SITE, origin
        replace_pane(page, "html", "<p>same origin</p>")
        press_save(page)
        wait_saved(page, 2)
    stored = Api(app_url, owner["handle"]).pen(pid)
    assert stored["title"] == title and stored["head"] == 2


def test_wf_preview_isolation_framing(browser, app_url):
    owner, pid, _ = one_pen(app_url, [version(files(html="<p>framed</p>"))], visibility="public")
    host = f"{FOREIGN_ORIGIN}/host"
    html = (f'<iframe name="embed" src="{app_url}/embed/{pid}"></iframe>'
            f'<iframe name="editor" src="{app_url}/pen/{pid}"></iframe>')
    with opened(browser, app_url, "/api/health") as page:
        page.route(host, lambda route: route.fulfill(status=200, content_type="text/html", body=html))
        page.goto(host)
        embed = page.frame(name="embed")
        assert embed is not None
        wait_for(page, lambda: embed.get_by_role("tablist", name="Embed").count(), lambda v: v == 1,
                 "the embed renders inside another site's frame", step_ms=0)
        editor = page.frame(name="editor")
        assert editor is not None
        wait_for(page, lambda: editor.url, lambda u: not u.startswith(app_url), "the editor refuses another site's frame",
                 step_ms=0)
        assert editor.get_by_role("region", name="Preview").count() == 0


def test_wf_storage_outage_working_pages(browser, app_url):
    down = os.environ["APP_STORAGE_DOWN_URL"]
    owner, fan = person("author"), person("fan")
    pid = seed(down, users=[owner, fan], pens=[pen("p", owner, f"Weather {tok()}", "public")])["pens"]["p"]
    with opened(browser, down, f"/pen/{pid}", owner["handle"]) as page, \
            opened(browser, down, f"/pen/{pid}", fan["handle"]) as other:
        wait_render(page, 1, "the editor previews while storage is down")
        replace_pane(page, "html", "<p>kept</p>")
        wait_for(page, lambda: preview(page).get_attribute("data-preview-text"), lambda v: v == "kept",
                 "the edit renders while storage is down")
        press_save(page)
        wait_text(page, status(page, "Save status"), STORAGE_SAVE, "save outage copy")
        expect(page.get_by_text("Not saved yet", exact=True)).to_be_visible()
        assert pane_text(pane(page, "html")) == "<p>kept</p>"
        export = page.get_by_role("button", name="Export", exact=True)
        export.focus()
        page.keyboard.press("Enter")
        wait_text(page, status(page, "Export status"), "Save a version before exporting.", "409 comes before 503")
        expect(export).to_be_focused()
        wait_render(other, 1, "the fan's render")
        other.get_by_role("button", name="Like", exact=True).focus()
        other.keyboard.press("Enter")
        wait_text(page, status(page, "Likes"), "1 like", "likes keep working during the outage",
                  seconds=LIVE_LIMIT_S + LIVE_MARGIN_S)
    assert Api(down, owner["handle"]).pen(pid)["head"] == 0


def test_wf_storage_outage_delete_refused(browser, app_url):
    down = os.environ["APP_STORAGE_DOWN_URL"]
    owner = person("author")
    title = f"Keep {tok()}"
    pid = seed(down, users=[owner], pens=[pen("p", owner, title)])["pens"]["p"]
    with opened(browser, down, f"/pen/{pid}", owner["handle"]) as page:
        wait_render(page, 1, "render")
        page.get_by_role("button", name="Pen settings", exact=True).focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Pen settings")
        delete_pen = dialog.get_by_role("button", name="Delete pen", exact=True)
        delete_pen.focus()
        page.keyboard.press("Enter")
        confirm = page.get_by_role("alertdialog", name="Delete this pen?")
        expect(confirm).to_contain_text(DELETE_COPY.format(title=title))
        expect(confirm.get_by_role("button", name="Cancel", exact=True)).to_be_focused()
        page.keyboard.press("Escape")
        expect(delete_pen).to_be_focused()
        page.keyboard.press("Enter")
        confirm.get_by_role("button", name="Delete", exact=True).focus()
        page.keyboard.press("Enter")
        wait_text(page, status(page, "Settings status"), STORAGE_DELETE, "delete outage copy")
        assert urlparse(page.url).path == f"/pen/{pid}"
    assert Api(down, owner["handle"]).pen(pid)["title"] == title


def test_wf_storage_outage_search_and_collections(browser, app_url):
    down = os.environ["APP_STORAGE_DOWN_URL"]
    t = tok()
    author, reader = person("author"), person("reader")
    title = f"Outage {t}"
    seed(down, users=[author, reader], pens=[pen("p", author, title, "public")])
    with opened(browser, down, "/explore", reader["handle"]) as page:
        box = page.get_by_role("searchbox", name="Search pens")
        box.focus()
        page.keyboard.type(t)
        wait_text(page, status(page, "Search results"), "1 pen found", "search works while storage is down")
        expect(page.get_by_role("list", name="Results").get_by_role("link", name=title, exact=True)).to_be_visible()
        page.goto(f"{down}/collections")
        page.get_by_role("button", name="New collection", exact=True).focus()
        page.keyboard.press("Enter")
        wait_path(page, r"/collections/[a-z0-9]{10}", "New collection lands on its page")
        combo = page.get_by_role("combobox", name="Add a pen")
        combo.focus()
        page.keyboard.type(title)
        page.get_by_role("option", name=title, exact=True).click()
        wait_text(page, status(page, "Collection status"), f"Added {title}", "collections work while storage is down")


def test_wf_two_tab_conflict_phone_tab(browser, app_url):
    owner, pen_id, _ = one_pen(app_url, [version(files(html=ONE_HTML))])
    api = Api(app_url, owner["handle"])
    with opened(browser, app_url, f"/pen/{pen_id}", owner["handle"]) as a:
        wait_render(a, 1, "tab A render")
        b = second_page(a, f"{app_url}/pen/{pen_id}", NARROW)
        wait_render(b, 1, "phone tab render")
        a.bring_to_front()
        replace_pane(a, "html", "two")
        press_save(a)
        wait_saved(a, 2)
        b.bring_to_front()
        advance(b, LIVE_POLL_MS * 2)
        tabs = b.get_by_role("tablist", name="Panes")
        tap(tabs.get_by_role("tab", name="CSS", exact=True))
        tap(pane(b, "css"))
        b.keyboard.type("p { margin: 0 }")
        press_save(b)
        alert = b.get_by_role("alert").filter(has_text=CONFLICT.format(head=2))
        expect(alert).to_be_visible()
        keep = b.get_by_role("button", name="Keep mine as next version", exact=True)
        expect(keep).to_be_focused()
        b.keyboard.press("Enter")
        wait_saved(b, 3)
        expect(alert).to_have_count(0)
    v3 = api.ok("GET", f"/api/pens/{pen_id}/versions/3")["files"]
    assert v3["css"] == "p { margin: 0 }" and v3["html"] == ONE_HTML

def test_wf_collections_search_pending_latest(browser, app_url):
    tq = tok()
    owner = person("owner")
    v = [version(files(html="x"))]
    seed(app_url, users=[owner], pens=[pen("p1", owner, f"Quarry {tq} alpha", "public", versions=v),
                                       pen("p2", owner, f"Quarry {tq} beta", "public", versions=v)])
    debounce = config(app_url)["search_debounce_ms"]
    with opened(browser, app_url, "/explore") as page:
        expect(page.get_by_text(SEARCH_REST, exact=True)).to_be_visible()
        held_routes: list = []
        page.route(lambda url: urlparse(url).path == "/api/search", lambda route: held_routes.append(route))
        box = page.get_by_role("searchbox", name="Search pens")
        box.focus()
        page.keyboard.type(tq)
        advance(page, debounce)
        wait_for(page, lambda: len(held_routes), lambda v: v == 1, "the first query is held", step_ms=0)
        page.keyboard.type(" beta")
        advance(page, debounce)
        wait_for(page, lambda: len(held_routes), lambda v: v == 2, "the latest query is held", step_ms=0)
        try:
            held_routes[0].continue_()
            held_routes[0].request.response()
        except PlaywrightError:
            pass
        advance(page, debounce * 2)
        page.evaluate("() => 0")
        results = page.get_by_role("list", name="Results")
        assert text_of(status(page, "Search results")) != "2 pens found", "an earlier answer must not paint the count"
        assert f"Quarry {tq} alpha" not in results.get_by_role("link").all_inner_texts(), \
            "an earlier answer must not paint the list"
        held_routes[1].continue_()
        wait_text(page, status(page, "Search results"), "1 pen found", "the latest query's count")
        assert results.get_by_role("link").all_inner_texts() == [f"Quarry {tq} beta"]


def test_if_run_manifest():
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest.get(key), str) and manifest[key].strip()


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"shipped packages missing from the notices: {missing}"
    for lib_id in SHELF:
        assert lib_id.rsplit("@", 1)[0] in notices, lib_id
    for font in FONTS:
        assert font in notices, font


def test_if_licences(app_url):
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert not bad, f"disallowed licences: {bad}"
    for lib in httpx.get(f"{app_url}/api/shelf", timeout=HTTP_TIMEOUT_S).json()["libraries"]:
        assert licence_allowed(lib["license"], ALLOWED_LICENCES), lib
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    assert "OFL-1.1" in notices or "OFL" in notices, "fonts must be listed with their licence"


def test_if_datastores():
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & FORBIDDEN_DATASTORES, shipped & FORBIDDEN_DATASTORES
    found = [str(f) for f in Path("/app").rglob("*") if f.is_file() and "node_modules" not in f.parts
             and f.suffix in (".sqlite", ".sqlite3", ".db")]
    assert not found, found


def test_if_no_outside_hosts(browser, app_url):
    owner, pid, _ = one_pen(app_url, [version(files(html="<p>x</p>", js="_.noop()"), ["lodash@4.17.21"])])
    seen: list[str] = []
    with opened(browser, app_url, "/", owner["handle"]) as page:
        page.on("request", lambda req: seen.append(req.url))
        for path in ("/", "/explore", "/shelf", f"/pen/{pid}"):
            page.goto(f"{app_url}{path}")
            advance(page, CROSSFADE_MS)
        wait_render(page, 1, "editor render")
    outside = [u for u in seen if not (same_origin(u, app_url) or u.split(":", 1)[0] in ("data", "blob", "about"))]
    assert not outside, f"requests to outside hosts: {outside}"


def test_if_service_definitions_unedited():
    trajectory = Path("/logs/agent/trajectory.json")
    if not trajectory.exists():
        return
    raw = trajectory.read_text()
    protected = re.compile(r"(^|/)((docker-)?compose(\.[\w-]+)?\.ya?ml|\.env(\.[\w-]+)?)$")
    shell_touch = re.compile(
        r"(?:(?<![=\-])>>?\s*|\b(?:tee|rm|mv|cp)\b\s+|\bsed\s+-i\S*\s+)"
        r"[^;&|\n]*?(?<=[\s/\"'>])(?:(?:docker-)?compose[\w.-]*\.ya?ml|\.env(?:\.[\w-]+)?)(?=[\s\"';&|]|$)")
    write_tools = {"write", "edit", "multiedit", "str_replace", "create", "notebookedit", "str_replace_editor"}
    hits: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            name = str(node.get("name") or node.get("tool") or node.get("tool_name") or "").lower()
            inp = node.get("input") or node.get("arguments") or node.get("parameters")
            if isinstance(inp, str):
                try:
                    inp = json.loads(inp)
                except ValueError:
                    inp = None
            if isinstance(inp, dict):
                path = str(inp.get("file_path") or inp.get("path") or "")
                if name in write_tools and protected.search(path):
                    hits.append(f"{name} {path}")
                cmd = inp.get("command")
                if isinstance(cmd, str) and shell_touch.search(cmd):
                    hits.append(cmd)
            for v in node.values():
                walk(v)
        elif isinstance(node, list):
            for v in node:
                walk(v)

    walk(json.loads(raw))
    assert not hits, f"service definitions or environment files were edited: {hits}"


def test_if_typescript_source():
    skip = {"node_modules", "dist", "build", ".git"}
    files_all = [f for f in Path("/app").rglob("*") if f.is_file() and not skip & set(f.parts)]
    assert any(f.suffix in (".ts", ".tsx") for f in files_all), "no TypeScript source found"
    shelf_files = {name for name, _, _ in SHELF.values()}
    ts_dirs = {f.parent for f in files_all if f.suffix in (".ts", ".tsx")}
    bad = [str(f) for f in files_all if f.suffix in (".js", ".mjs", ".cjs") and f.parent in ts_dirs
           and f.name not in shelf_files and not re.search(r"(\.config\.|^\.?eslintrc|^\.?prettierrc)", f.name)]
    assert not bad, f"hand-written JavaScript source: {bad}"
