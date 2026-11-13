from __future__ import annotations

import concurrent.futures
import hashlib
import hmac
import json as jsonlib
import os
import re
import socket
import threading
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, quote, urlencode, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page

from conftest import (
    Postgres,
    S3,
    advance,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    select,
    shipped_packages,
    style,
    tab_order,
    tap,
    unique,
)


APP_DIR = Path("/app")
GLOAM = "gloamrunner"
GLOAM_NAME = "Gloamrunner"
GLOAM_WIDGET_SECRET = "gloam-widget-4c1e9a"
GLOAM_SERVER_SECRET = "gloam-server-8d27b3"
FERRY_WIDGET_SECRET = "ferry-widget-2a6f10"
FERRY = "tiny-ferry"
FERRY_SERVER_SECRET = "ferry-server-5e93c4"
SECRET_OVERLAP_S = 600
SEEDED_JUNO = [("grant", "read", "*"), ("grant", "reply", "*"), ("grant", "close", "*"), ("grant", "receipts", "*"), ("deny", "receipts", "*"), ("deny", "read", "purchase")]
ACTIONS = ["read", "reply", "close", "receipts"]
TOPICS = ["bug", "account", "purchase", "other"]
MAX_PAGES = 5
GLOAM_LAUNCHER = "https://launcher.gloamrunner.example"
WREN = ("wren@gloamrunner.example", "lantern-keeper-42")
PIM = ("pim@tinyferry.example", "harbour-bell-77")
JUNO = ("juno@gloamrunner.example", "moth-lamp-31")
WREN_NAME = "Wren Ashdown"
JUNO_NAME = "Juno Reyes"
TALLOW_TEXT = "free skins here <script>alert('gotcha')</script> [claim now](javascript:alert(1)) http://169.254.169.254/latest/meta-data/"
TALLOW_AFTER = "free skins here alert('gotcha') [claim now] http://169.254.169.254/latest/meta-data/"
PATCH_TITLE = "Gloamrunner patch 0.9.4"
PATCH_DESCRIPTION = "The Hollow boss no longer freezes after the second lantern."
OUTAGE_COPY = "The game server isn't answering receipt lookups right now. Signed receipts in this thread are still checked."
NO_RECEIPTS_COPY = "The game server lists no receipts for this player."
RATE_NOTICE = re.compile(r"You're writing faster than the inbox can read\. Try again in (\d+) seconds\.")
LABELS = ["Signature", "Bucket", "Sanitiser", "Link"]
STAGES = ["signature", "bucket", "sanitiser", "link"]
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "CC0-1.0", "BlueOak-1.0.0", "OFL-1.1"}

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}

BUCKET_CAPACITY = 8
REFILL_SECONDS = 15
WINDOW_SECONDS = 300
JSON_LIMIT_BYTES = 65536
FILE_LIMIT_BYTES = 5000000
FILENAME_UNITS = 120
FIRST_LINE_CHARS = 120
FETCH_LIMIT_BYTES = 524288
FETCH_LIMIT_MS = 3000
LOOKUP_LIMIT_MS = 3000
LINK_SETTLE_S = 5
ATTACH_SETTLE_S = 10
LIVE_S = 2
WIDGET_REPLY_S = 5
STOP_WORK_S = 5
STREAM_COUNT = 60
PG_MAX_CONNECTIONS = 10
REPLY_MAX_CHARS = 4000
PAGE_LIMIT_MAX = 100
PLAYER_ID_MAX = 64
EDGE_FRACTION = 0.22
TABLET_EDGE_PX = 24
TABLET_COLUMN_PX = 400
PHONE_EDGE_PX = 16
TARGET_PX = 44
SIXTH_MS = 1000 / 6
QUARTER_MS = 1000 / 4
SEARCH_SETTLE_MS = 500
SHORT_ACCESS_TTL_S = 5

SHORT_FAMILY_TTL_S = 30
SHORT_IDEMPOTENCY_TTL_S = 20
TTL_SLACK_S = 10
HTTP_TIMEOUT_S = 30
SLACK_S = 1.5
POLL_S = 0.2
UI_S = 20
STEP_MS = 100
EDGE_TOL_PX = 4
INSTANT_MS = 1
TAB_PRESSES = 30
CONCURRENT = 5
WINDOW_MARGIN_S = 5
HOURS_OFF_MS = 5 * 3600 * 1000
LATE_LOOKUP_MS = 2000
STREAM_ABORTS = 10
OVER_AMOUNT = 1300

PNG_BYTES = bytes.fromhex("89504E470D0A1A0A") + b"\x00\x00\x00\rIHDR\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00"
JPEG_BYTES = bytes.fromhex("FFD8FF") + b"\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00\xff\xd9"
TEXT_BYTES = "hello from the launcher\n".encode()

_PACE = threading.Event()
_OFFSETS: dict[str, float] = {}


def pace() -> None:
    _PACE.wait(POLL_S)


def fresh(prefix: str = "t") -> str:
    name = re.sub(r"[^A-Za-z0-9]", "", unique(prefix)[0])[-12:]
    return f"{prefix}{name}{uuid.uuid4().hex[:8]}".lower()


def u16(text: str) -> int:
    return len(text.encode("utf-16-le")) // 2


def expect_status(r: httpx.Response, status: int, code: str | None = None, what: str = "") -> httpx.Response:
    label = what or f"{r.request.method} {r.request.url.path}"
    assert r.status_code == status, f"{label}: expected {status} {code or ''}, got {r.status_code} {r.text[:300]}"
    if code is not None:
        body = r.json()
        assert body.get("error", {}).get("code") == code, f"{label}: expected error code {code}, got {body}"
    return r


def field_error(r: httpx.Response, field: str) -> str:
    expect_status(r, 422, "validation")
    fields = r.json()["error"].get("fields", {})
    assert field in fields, f"{r.request.url.path}: expected fields.{field} in {fields}"
    return fields[field]


@contextmanager
def ctx(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
    else:
        value = next(obj)
        try:
            yield value
        finally:
            next(obj, None)


def wait_until(probe: Callable[[], Any], what: str, seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
        pace()
    pytest.fail(what)


def server_now(base: str) -> float:
    if base not in _OFFSETS:
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        date = r.headers.get("date")
        _OFFSETS[base] = parsedate_to_datetime(date).timestamp() - time.time() if date else 0.0
    return time.time() + _OFFSETS[base]


def iso(ts: float) -> str:
    return datetime.fromtimestamp(ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def stand_in() -> str:
    return os.environ["WIREMOCK_URL"].rstrip("/")


def parse_csp(header: str) -> dict[str, list[str]]:
    out: dict[str, list[str]] = {}
    for part in header.split(";"):
        tokens = part.split()
        if tokens:
            out[tokens[0].lower()] = tokens[1:]
    return out


class Staff:
    def __init__(self, base: str, creds: tuple[str, str]):
        self.base = base
        self.cookies: dict[str, str] = {}
        self.change_token: str | None = None
        r = self.call("POST", "/api/auth/login", json={"email": creds[0], "password": creds[1]})
        expect_status(r, 200, what=f"POST /api/auth/login as {creds[0]}")
        self.session = r.json()
        self.change_token = self.session["change_token"]

    def absorb(self, r: httpx.Response) -> None:
        for line in r.headers.get_list("set-cookie"):
            name, _, rest = line.partition("=")
            value = rest.split(";", 1)[0]
            lowered = rest.lower()
            if value and "max-age=0" not in lowered and "1970" not in lowered:
                self.cookies[name.strip()] = value
            else:
                self.cookies.pop(name.strip(), None)

    def cookie_header(self, jar: dict[str, str] | None = None) -> str:
        return "; ".join(f"{k}={v}" for k, v in (self.cookies if jar is None else jar).items())

    def call(self, method: str, path: str, *, json: Any = None, content: bytes | None = None,
             headers: dict[str, str] | None = None, change: bool = True, key: str | None = None,
             jar: dict[str, str] | None = None) -> httpx.Response:
        h: dict[str, str] = {}
        cookie = self.cookie_header(jar)
        if cookie:
            h["Cookie"] = cookie
        if change and method != "GET" and self.change_token:
            h["X-Change-Token"] = self.change_token
        if key is not None:
            h["Idempotency-Key"] = key
        if json is not None:
            content = jsonlib.dumps(json).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        r = httpx.request(method, self.base + path, content=content, headers=h, timeout=HTTP_TIMEOUT_S)
        if jar is None:
            self.absorb(r)
        return r

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)


class Player:
    def __init__(self, base: str, pid: str | None = None, game: str = GLOAM, secret: str = GLOAM_WIDGET_SECRET):
        self.base, self.game, self.secret = base, game, secret
        self.pid = pid or fresh("p")

    @property
    def signature(self) -> str:
        return hmac.new(self.secret.encode(), self.pid.encode(), hashlib.sha256).hexdigest()

    @property
    def page_path(self) -> str:
        return f"/widget/{self.game}?player={quote(self.pid)}&sig={self.signature}"

    def call(self, method: str, path: str, *, json: Any = None, content: bytes | None = None,
             headers: dict[str, str] | None = None, key: str | None = None, signature: str | None = None,
             bare: bool = False) -> httpx.Response:
        h: dict[str, str] = {} if bare else {"X-Hushline-Player": self.pid, "X-Hushline-Player-Signature": signature or self.signature}
        if key is not None:
            h["Idempotency-Key"] = key
        if json is not None:
            content = jsonlib.dumps(json).encode()
            h["Content-Type"] = "application/json"
        h.update(headers or {})
        return httpx.request(method, self.base + path, content=content, headers=h, timeout=HTTP_TIMEOUT_S)

    def send(self, body: str, topic: str | None = "bug", key: str | None = None) -> httpx.Response:
        payload: dict[str, Any] = {"body": body}
        if topic is not None:
            payload["topic"] = topic
        return self.call("POST", f"/api/widget/{self.game}/messages", json=payload, key=key or idempotency_key())

    def me(self) -> dict[str, Any]:
        r = self.call("GET", f"/api/widget/{self.game}/me")
        expect_status(r, 200)
        return r.json()

    def thread(self, tid: str) -> dict[str, Any]:
        r = self.call("GET", f"/api/widget/{self.game}/threads/{tid}")
        expect_status(r, 200)
        return r.json()

    def upload(self, mid: str, data: bytes, content_type: str, filename: str = "notes.txt",
               filename_star: str | None = None) -> httpx.Response:
        boundary = "hl" + uuid.uuid4().hex
        disposition = 'form-data; name="file"'
        disposition += f'; filename="{filename_star if filename_star is not None else filename}"'
        body = (f"--{boundary}\r\nContent-Disposition: {disposition}\r\nContent-Type: {content_type}\r\n\r\n").encode()
        body += data + f"\r\n--{boundary}--\r\n".encode()
        return self.call("POST", f"/api/widget/{self.game}/messages/{mid}/attachments", content=body,
                         headers={"Content-Type": f"multipart/form-data; boundary={boundary}"})

    def attachment(self, aid: str) -> httpx.Response:
        return self.call("GET", f"/api/widget/{self.game}/attachments/{aid}")

    def content(self, aid: str) -> httpx.Response:
        return self.call("GET", f"/api/widget/{self.game}/attachments/{aid}/content")


def open_thread(base: str, topic: str = "bug", body: str = "i never got the lantern pack",
                pid: str | None = None) -> tuple[Player, str, dict[str, Any]]:
    player = Player(base, pid)
    r = player.send(body, topic)
    expect_status(r, 201, what="first widget send")
    data = r.json()
    return player, data["thread"]["id"], data["message"]


def thread_body(staff: Staff, tid: str) -> dict[str, Any]:
    r = staff.get(f"/api/threads/{tid}")
    expect_status(r, 200)
    return r.json()


def of_kind(body: dict[str, Any], kind: str) -> list[dict[str, Any]]:
    return [m for m in body["messages"] if m["kind"] == kind]


def reply(staff: Staff, tid: str, text: str = "Thanks, I can reproduce it. A fix ships in the next patch.",
          key: str | None = None) -> httpx.Response:
    return staff.call("POST", f"/api/threads/{tid}/replies", json={"body": text}, key=key or idempotency_key())


def close(staff: Staff, tid: str) -> httpx.Response:
    return staff.call("POST", f"/api/threads/{tid}/close", json={})


def inbox(staff: Staff, status: str | None = None, q: str | None = None, limit: Any = None,
          cursor: str | None = None) -> httpx.Response:
    params = {k: v for k, v in (("status", status), ("q", q), ("limit", limit), ("cursor", cursor)) if v is not None}
    return staff.get("/api/inbox" + ("?" + urlencode(params) if params else ""))


def inbox_ok(staff: Staff, **kw: Any) -> dict[str, Any]:
    r = inbox(staff, **kw)
    expect_status(r, 200)
    return r.json()


def forensics_settled(staff: Staff, mid: str, seconds: float = LINK_SETTLE_S + SLACK_S) -> dict[str, Any]:
    def probe() -> dict[str, Any] | None:
        r = staff.get(f"/api/messages/{mid}/forensics")
        expect_status(r, 200)
        body = r.json()
        return body if body["settled"] else None
    return wait_until(probe, f"GET /api/messages/{mid}/forensics settled within {seconds}s", seconds)


def line(forensics: dict[str, Any], stage: str) -> dict[str, Any]:
    return {entry["stage"]: entry for entry in forensics["lines"]}[stage]


def sentence(forensics: dict[str, Any]) -> str:
    return "Checked: " + "; ".join(line(forensics, s)["verdict"] for s in STAGES) + "."


def wait_attachment(player: Player, aid: str, seconds: float = ATTACH_SETTLE_S + SLACK_S) -> dict[str, Any]:
    def probe() -> dict[str, Any] | None:
        r = player.attachment(aid)
        expect_status(r, 200)
        body = r.json()
        return body if body["status"] in ("attached", "failed") else None
    return wait_until(probe, f"attachment {aid} left uploading within {seconds}s", seconds)


def drain(player: Player, topic: str = "bug") -> httpx.Response:
    for i in range(BUCKET_CAPACITY + 2):
        r = player.send(f"flood {i}", topic)
        if r.status_code == 429:
            return r
        expect_status(r, 201)
    pytest.fail("widget sends kept answering 201 past the eight-token bucket; expected 429 rate_limited")


def sign_event(secret: str, stamp: str, raw: bytes) -> str:
    return "v1=" + hmac.new(secret.encode(), f"{stamp}.".encode() + raw, hashlib.sha256).hexdigest()


def post_event(base: str, event: dict[str, Any] | None = None, *, game: str = GLOAM, secret: str = GLOAM_SERVER_SECRET,
               ts: float | None = None, signature: str | None = None, raw: bytes | None = None,
               content_type: str = "application/json") -> httpx.Response:
    raw = jsonlib.dumps(event).encode() if raw is None else raw
    stamp = str(int(server_now(base) if ts is None else ts))
    sig = signature or sign_event(secret, stamp, raw)
    return httpx.post(f"{base}/api/hooks/{game}/events", content=raw, timeout=HTTP_TIMEOUT_S,
                      headers={"Content-Type": content_type, "X-Hushline-Timestamp": stamp, "X-Hushline-Signature": sig})


def nonce() -> str:
    return "n" + uuid.uuid4().hex


def _event(base: str, pid: str, kind: str, **fields: Any) -> dict[str, Any]:
    return {"nonce": nonce(), "type": kind, "player_id": pid, "occurred_at": iso(server_now(base)), **fields}


def receipt_event(base: str, pid: str, rid: str, amount: int = 499, currency: str = "USD", item: str = "Lantern Pack") -> dict[str, Any]:
    return _event(base, pid, "purchase.receipt", receipt_id=rid, item=item, amount_minor=amount, currency=currency)


def refund_event(base: str, pid: str, fid: str, rid: str, amount: int, currency: str) -> dict[str, Any]:
    return _event(base, pid, "purchase.refunded", refund_id=fid, receipt_id=rid, amount_minor=amount, currency=currency)


def match_event(base: str, pid: str, match_id: str) -> dict[str, Any]:
    return _event(base, pid, "match.finished", match_id=match_id, mode="Hollow Run", result="lost", duration_seconds=1260)


def accepted(base: str, event: dict[str, Any]) -> str:
    r = post_event(base, event)
    expect_status(r, 201, what=f"game-server event {event['type']}")
    assert r.json()["status"] == "accepted", r.json()
    return r.json()["message_id"]


def purchases_by_receipt(staff: Staff, tid: str) -> dict[str, dict[str, Any]]:
    return {p["receipt_id"]: p for p in thread_body(staff, tid)["purchases"]}


def juno_id(wren: Staff) -> str:
    r = wren.get("/api/team")
    expect_status(r, 200)
    for moderator in r.json()["moderators"]:
        if moderator["email"] == JUNO[0]:
            return moderator["id"]
    pytest.fail("GET /api/team lists the seeded moderator Juno Reyes")


def add_rule(wren: Staff, mod: str, effect: str, action: str, topic: str) -> str:
    r = wren.call("POST", f"/api/team/{mod}/rules", json={"effect": effect, "action": action, "topic": topic})
    assert r.status_code in (200, 201), f"POST /api/team/<id>/rules: expected 201 or 200, got {r.status_code} {r.text[:200]}"
    return r.json()["rule"]["id"]


def revoke_rule(wren: Staff, mod: str, rule_id: str) -> httpx.Response:
    return wren.call("DELETE", f"/api/team/{mod}/rules/{rule_id}")


class StreamReader:

    def __init__(self, base: str, path: str, headers: dict[str, str]):
        self.text = ""
        self.status: int | None = None
        self.lock = threading.Lock()
        self.ready = threading.Event()
        self.client = httpx.Client(timeout=httpx.Timeout(HTTP_TIMEOUT_S, read=None))
        self.thread = threading.Thread(target=self._run, args=(base + path, headers), daemon=True)
        self.thread.start()

    def _run(self, url: str, headers: dict[str, str]) -> None:
        try:
            with self.client.stream("GET", url, headers=headers) as r:
                self.status = r.status_code
                self.ready.set()
                for chunk in r.iter_text():
                    with self.lock:
                        self.text += chunk
        except Exception:
            pass
        finally:
            self.ready.set()

    def snapshot(self) -> str:
        with self.lock:
            return self.text

    def close(self) -> None:
        self.client.close()


def staff_stream(staff: Staff) -> StreamReader:
    reader = StreamReader(staff.base, "/api/stream", {"Cookie": staff.cookie_header(), "Accept": "text/event-stream"})
    assert reader.ready.wait(HTTP_TIMEOUT_S) and reader.status == 200, f"GET /api/stream answered {reader.status}"
    return reader


def frames_after(reader: StreamReader, offset: int) -> bool:
    return any(ln.startswith(("data:", "event:")) for ln in reader.snapshot()[offset:].splitlines())


def read_sse(url: str, headers: dict[str, str], seconds: float) -> list[tuple[str, str]]:
    events: list[tuple[str, str]] = []
    name, data = "message", []
    with httpx.stream("GET", url, headers=headers, timeout=httpx.Timeout(seconds)) as r:
        expect_status(r, 200, what="forensics stream")
        assert "text/event-stream" in r.headers.get("content-type", "")
        for raw_line in r.iter_lines():
            if raw_line == "":
                if data:
                    events.append((name, "\n".join(data)))
                name, data = "message", []
                if events and events[-1][0] == "settled":
                    break
            elif raw_line.startswith(":"):
                continue
            elif raw_line.startswith("event:"):
                name = raw_line[6:].strip()
            elif raw_line.startswith("data:"):
                value = raw_line[5:]
                data.append(value[1:] if value.startswith(" ") else value)
    return events


class Listener:

    def __init__(self) -> None:
        self.sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        self.sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.sock.bind(("127.0.0.1", 0))
        self.sock.listen()
        self.sock.settimeout(0.2)
        self.port = self.sock.getsockname()[1]
        self.hits = 0
        self.stop = threading.Event()
        self.thread = threading.Thread(target=self._run, daemon=True)
        self.thread.start()

    def _run(self) -> None:
        while not self.stop.is_set():
            try:
                conn, _ = self.sock.accept()
            except OSError:
                continue
            self.hits += 1
            conn.close()

    def close(self) -> None:
        self.stop.set()
        try:
            self.sock.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.sock.close()


def ui_wait(page: Page, probe: Callable[[], Any], what: str, seconds: float = UI_S) -> None:
    deadline = time.monotonic() + seconds
    last: Exception | None = None
    while time.monotonic() < deadline:
        try:
            if probe():
                return
        except Exception as exc:
            last = exc
        advance(page, STEP_MS)
    pytest.fail(what + (f" (last error: {last})" if last else ""))


def text_of(loc: Locator) -> str:
    return loc.inner_text(timeout=1000).strip()


def focused(loc: Locator) -> bool:
    return loc.evaluate("el => el === document.activeElement || el.contains(document.activeElement)")


def region(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name)


def messages(page: Page) -> Locator:
    return page.get_by_role("list", name="Messages").get_by_role("listitem")


def message_item(page: Page, text: str) -> Locator:
    return messages(page).filter(has_text=text).first


def thread_rows(page: Page) -> Locator:
    return page.get_by_role("list", name="Threads").get_by_role("link")


def row(page: Page, pid: str) -> Locator:
    return page.get_by_role("list", name="Threads").get_by_role("link", name=re.compile("^" + re.escape(pid)))


def heading(page: Page, pid: str) -> Locator:
    return page.get_by_role("heading", level=2, name=pid, exact=True)


def tamperglass(page: Page) -> Locator:
    return page.get_by_role("complementary", name="Tamperglass")


def check_lines(scope: Page | Locator) -> Locator:
    return scope.get_by_role("list", name="Checks").get_by_role("listitem")


def tab_count(page: Page, label: str) -> int:
    tab = page.get_by_role("tab", name=re.compile(rf"^{label} \d+$"))
    return int(re.search(r"(\d+)", text_of(tab)).group(1))


def meter_value(page: Page) -> str:
    return page.get_by_role("meter", name="Token bucket").evaluate(
        "el => el.getAttribute('aria-valuenow') ?? String(el.value)")


def lines_show(page: Page, scope: Locator, verdicts: list[str]) -> bool:
    lines = check_lines(scope)
    if lines.count() != len(LABELS):
        return False
    for i, label in enumerate(LABELS):
        text = text_of(lines.nth(i))
        if label not in text or verdicts[i] not in text:
            return False
    return True


def lines_checking(scope: Locator) -> bool:
    lines = check_lines(scope)
    return lines.count() == len(LABELS) and all(
        LABELS[i] in text_of(lines.nth(i)) and "checking" in text_of(lines.nth(i)) for i in range(len(LABELS)))


def sign_in(page: Page, base: str, creds: tuple[str, str]) -> None:
    if urlparse(page.url).path != "/signin":
        page.goto(base + "/signin")
    fill(page.get_by_role("textbox", name="Email"), creds[0])
    fill(page.get_by_label("Password", exact=True), creds[1])
    click(page.get_by_role("button", name="Sign in"))
    ui_wait(page, lambda: urlparse(page.url).path.startswith("/inbox"), f"signing in as {creds[0]} lands on /inbox")


@contextmanager
def staff_page(browser: Browser, base: str, creds: tuple[str, str], path: str = "/inbox",
               viewport: dict[str, int] | None = None, **options: Any) -> Iterator[Page]:
    with ctx(open_app(browser, base + "/signin", **options)) as page:
        page.set_viewport_size(viewport or DESKTOP)
        sign_in(page, base, creds)
        if path != "/inbox":
            page.goto(base + path)
        yield page


@contextmanager
def widget_page(browser: Browser, player: Player, viewport: dict[str, int] | None = None, **options: Any) -> Iterator[Page]:
    with ctx(open_app(browser, player.base + player.page_path, **options)) as page:
        page.set_viewport_size(viewport or DESKTOP)
        page.reload()
        yield page


def open_thread_page(page: Page, pid: str) -> None:
    ui_wait(page, lambda: heading(page, pid).is_visible(), f"the thread heading names {pid}")


MOTION_RECORDER = """() => {
  if (window.__hlMotion) { window.__hlMotion.length = 0; return; }
  const seen = new WeakSet();
  const records = window.__hlMotion = [];
  const note = (animation) => {
    if (!animation || !animation.effect || seen.has(animation)) return;
    seen.add(animation);
    const timing = animation.effect.getComputedTiming();
    records.push({el: animation.effect.target, duration: Number(timing.duration) || 0, iterations: timing.iterations});
  };
  const original = Element.prototype.animate;
  Element.prototype.animate = function (...args) { const a = original.apply(this, args); note(a); return a; };
  const scan = (event) => { for (const a of event.target.getAnimations()) note(a); };
  document.addEventListener('transitionrun', scan, true);
  document.addEventListener('animationstart', scan, true);
}"""
MOTION_IN = "(root) => (window.__hlMotion || []).filter(r => r.el && root.contains(r.el)).map(r => r.duration)"
MOTION_LOOPING = """() => (window.__hlMotion || []).some(r => r.iterations === Infinity)
  || document.getAnimations().some(a => a.effect && a.effect.getComputedTiming().iterations === Infinity)"""


def test_health_ok_with_services_down(app_url):
    for base in (app_url, os.environ["APP_WIREMOCK_DOWN_URL"], os.environ["APP_MINIO_DOWN_URL"]):
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        expect_status(r, 200, what=f"GET {base}/api/health")
        assert r.json() == {"status": "ok"}, r.text
        assert Staff(base, WREN).session["game"]["slug"] == GLOAM


HEADER_CASES = ["public_page", "health", "api_error", "signin_page", "asset", "widget_page", "unknown_page"]


@pytest.mark.parametrize("case", HEADER_CASES, ids=HEADER_CASES)
def test_security_headers(app_url, case):
    player = Player(app_url)
    if case == "asset":
        html = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
        found = re.search(r'(?:src|href)="(/[^"#?]+\.(?:js|css|woff2))"', html)
        assert found, "GET / references a built same-origin asset"
        path = found.group(1)
    else:
        path = {"public_page": "/", "health": "/api/health", "api_error": "/api/threads/" + fresh("x"),
                "signin_page": "/signin", "widget_page": player.page_path, "unknown_page": "/" + fresh("x")}[case]
    nonces = []
    for _ in range(2):
        r = httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S)
        raw = r.headers.get("content-security-policy", "")
        csp = parse_csp(raw)
        assert "'self'" in csp.get("default-src", []), f"{path}: default-src 'self' in {raw}"
        script = [t for t in csp.get("script-src", []) if t.startswith("'nonce-")]
        assert len(script) == 1, f"{path}: script-src carries one nonce: {raw}"
        nonces.append(script[0])
        assert "'none'" in csp.get("object-src", []) and "'none'" in csp.get("base-uri", []), raw
        assert "'unsafe-inline'" not in raw and "'unsafe-eval'" not in raw, raw
        ancestors = csp.get("frame-ancestors", [])
        if case == "widget_page":
            assert GLOAM_LAUNCHER in ancestors and "'none'" not in ancestors, raw
        else:
            assert ancestors == ["'none'"], raw
        assert r.headers.get("strict-transport-security") == "max-age=31536000; includeSubDomains"
        assert r.headers.get("x-content-type-options") == "nosniff"
        assert r.headers.get("referrer-policy") == "no-referrer"
    assert nonces[0] != nonces[1], f"{path}: the script nonce is fresh on every response"


def test_not_found_page_and_unserved_files(browser, app_url):
    missing = "/" + fresh("nowhere")
    r = httpx.get(app_url + missing, timeout=HTTP_TIMEOUT_S)
    expect_status(r, 404)
    assert "text/html" in r.headers.get("content-type", "")
    api = httpx.get(app_url + "/api/" + fresh("nowhere"), timeout=HTTP_TIMEOUT_S)
    expect_status(api, 404)
    error = api.json()["error"]
    assert isinstance(error["code"], str) and isinstance(error["message"], str)
    for probe in ("/.env", "/run.json", "/package.json", "/.git/config", "/src/server.ts", "/assets/index.js.map"):
        served = httpx.get(app_url + probe, timeout=HTTP_TIMEOUT_S)
        assert served.status_code == 404, f"GET {probe}: expected 404, got {served.status_code}"
        assert "    at " not in served.text
    with ctx(open_app(browser, app_url + missing)) as page:
        title = page.get_by_role("heading", level=1, name="There's no page here.", exact=True)
        ui_wait(page, title.is_visible, "the not-found heading is shown")
        back = page.get_by_role("link", name="Back to the inbox", exact=True)
        assert urlparse(back.get_attribute("href") or "").path == "/inbox"


def test_sign_in_cookies_and_change_token(app_url):
    r = httpx.post(app_url + "/api/auth/login", json={"email": WREN[0], "password": WREN[1]}, timeout=HTTP_TIMEOUT_S)
    expect_status(r, 200)
    body = r.json()
    assert body["user"]["email"] == WREN[0] and body["user"]["name"] == WREN_NAME and body["user"]["role"] == "developer"
    assert body["game"]["slug"] == GLOAM and body["game"]["name"] == GLOAM_NAME
    assert isinstance(body["change_token"], str) and body["change_token"]
    lines = {ln.split("=", 1)[0].strip(): ln for ln in r.headers.get_list("set-cookie")}
    jar = {}
    for name in ("hl_access", "hl_refresh"):
        assert name in lines, f"login sets {name}"
        attrs = [a.strip().lower() for a in lines[name].split(";")[1:]]
        assert "HttpOnly".lower() in attrs and "SameSite=Strict".lower() in attrs, lines[name]
        jar[name] = lines[name].split("=", 1)[1].split(";", 1)[0]
    assert "Path".lower() + "=" + "/api/auth" in [a.strip().lower() for a in lines["hl_refresh"].split(";")[1:]]
    session = httpx.get(app_url + "/api/auth/session", timeout=HTTP_TIMEOUT_S,
                        headers={"Cookie": "; ".join(f"{k}={v}" for k, v in jar.items())})
    expect_status(session, 200)
    assert session.json()["change_token"] == body["change_token"]
    assert Staff(app_url, JUNO).session["user"]["role"] == "moderator"
    wrong = httpx.post(app_url + "/api/auth/login", json={"email": WREN[0], "password": PIM[1]}, timeout=HTTP_TIMEOUT_S)
    expect_status(wrong, 401, "invalid_credentials")
    assert not any(ln.startswith("hl_access=") and not ln.startswith("hl_access=;") for ln in wrong.headers.get_list("set-cookie"))
    missing = httpx.post(app_url + "/api/auth/login", json={"password": WREN[1]}, timeout=HTTP_TIMEOUT_S)
    assert field_error(missing, "email") == "Enter your email."
    empty = httpx.post(app_url + "/api/auth/login", json={"email": WREN[0], "password": ""}, timeout=HTTP_TIMEOUT_S)
    assert field_error(empty, "password") == "Enter your password."


def test_access_token_ttl_and_logout_revocation(app_url):
    long_lived = Staff(app_url, WREN)
    started = time.monotonic()
    staff = Staff(app_url, WREN)
    old = dict(staff.cookies)
    expect_status(staff.get("/api/auth/session"), 200)
    expect_status(staff.call("POST", "/api/auth/logout"), 204)
    expect_status(staff.get("/api/auth/session", jar=old), 401, "unauthenticated")
    short = Staff(os.environ["APP_SHORT_TIMERS_URL"], WREN)
    expect_status(short.get("/api/auth/session"), 200)
    wait_until(lambda: short.get("/api/auth/session", jar=dict(short.cookies)).status_code == 401,
               f"short-timers access token answers 401 unauthenticated within {SHORT_ACCESS_TTL_S}s",
               SHORT_ACCESS_TTL_S + 2 * SLACK_S)
    expect_status(short.get("/api/auth/session", jar=dict(short.cookies)), 401, "unauthenticated")
    assert time.monotonic() - started > SHORT_ACCESS_TTL_S - 1
    expect_status(long_lived.get("/api/auth/session"), 200, what="default 600 s access token still valid")


def test_refresh_rotation_and_reuse_revokes_family(app_url):
    staff = Staff(app_url, WREN)
    first = dict(staff.cookies)
    token = staff.change_token
    r = staff.call("POST", "/api/auth/refresh")
    expect_status(r, 200)
    assert r.json()["change_token"] == token
    assert staff.cookies["hl_refresh"] != first["hl_refresh"], "refresh rotates hl_refresh"
    expect_status(staff.get("/api/auth/session"), 200)
    reused = staff.call("POST", "/api/auth/refresh", jar={"hl_refresh": first["hl_refresh"]})
    expect_status(reused, 401, "refresh_reused")
    expect_status(staff.get("/api/auth/session"), 401, "unauthenticated")
    expect_status(staff.call("POST", "/api/auth/refresh", jar=dict(staff.cookies)), 401)

    racer = Staff(app_url, WREN)
    jar = dict(racer.cookies)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: racer.call("POST", "/api/auth/refresh", jar=jar), range(2)))
    codes = [res.json().get("error", {}).get("code") if res.status_code != 200 else None for res in results]
    assert "refresh_reused" in codes, f"two parallel refreshes with one token: expected refresh_reused, got {codes}"
    expect_status(racer.get("/api/auth/session", jar=jar), 401)
    for res in results:
        if res.status_code == 200:
            winner = {ln.split("=", 1)[0].strip(): ln.split("=", 1)[1].split(";", 1)[0] for ln in res.headers.get_list("set-cookie")}
            expect_status(racer.get("/api/auth/session", jar=winner), 401)
            expect_status(racer.call("POST", "/api/auth/refresh", jar=winner), 401)


CHANGE_CASES = ["reply", "close", "rule_grant", "rule_revoke", "logout", "login"]


@pytest.mark.parametrize("case", CHANGE_CASES, ids=CHANGE_CASES)
def test_change_token_and_origin_required(app_url, case):
    foreign = "https://evil.example"
    own = f"{urlparse(app_url).scheme}://{urlparse(app_url).netloc}"
    wren = Staff(app_url, WREN)
    mod = juno_id(wren)
    cleanup: list[str] = []
    state: dict[str, Any] = {}

    if case in ("reply", "close"):
        _, tid, _ = open_thread(app_url)
        if case == "close":
            expect_status(reply(wren, tid), 201)
        method, path, body = ("POST", f"/api/threads/{tid}/replies", {"body": "Open Settings, then Profile, and edit the name field."}) \
            if case == "reply" else ("POST", f"/api/threads/{tid}/close", {})
        def unchanged() -> bool:
            thread = thread_body(wren, tid)
            return thread["status"] == ("waiting" if case == "reply" else "answered") and len(of_kind(thread, "reply")) == (0 if case == "reply" else 1)
        ok_status = 201 if case == "reply" else 200
    elif case == "rule_grant":
        method, path, body = "POST", f"/api/team/{mod}/rules", {"effect": "grant", "action": "read", "topic": "bug"}
        def count() -> int:
            return sum(1 for m in wren.get("/api/team").json()["moderators"] if m["id"] == mod
                       for rl in m["rules"] if (rl["effect"], rl["action"], rl["topic"]) == ("grant", "read", "bug"))
        state["before"] = count()
        def unchanged() -> bool:
            return count() == state["before"]
        ok_status = None
    elif case == "rule_revoke":
        rid = add_rule(wren, mod, "grant", "read", "bug")
        cleanup.append(rid)
        method, path, body = "DELETE", f"/api/team/{mod}/rules/{rid}", None
        def unchanged() -> bool:
            return any(rl["id"] == rid for m in wren.get("/api/team").json()["moderators"] for rl in m["rules"])
        ok_status = 204
    elif case == "logout":
        method, path, body = "POST", "/api/auth/logout", None
        def unchanged() -> bool:
            return wren.get("/api/auth/session").status_code == 200
        ok_status = 204
    else:
        method, path, body = "POST", "/api/auth/login", {"email": WREN[0], "password": WREN[1]}
        def unchanged() -> bool:
            return True
        ok_status = 200

    def attempt(headers: dict[str, str], with_token: bool, suffix: str = "", extra_cookie: str = "") -> httpx.Response:
        jar = dict(wren.cookies)
        h = dict(headers)
        if with_token and case != "login":
            h["X-Change-Token"] = wren.change_token
        if extra_cookie:
            h["Cookie"] = wren.cookie_header(jar) + "; " + extra_cookie
        if case == "login":
            return httpx.post(app_url + path, json=body, headers=h, timeout=HTTP_TIMEOUT_S)
        return wren.call(method, path + suffix, json=body, headers=h, change=False, jar=jar,
                         key=idempotency_key() if case == "reply" else None)

    try:
        variants = [("foreign Origin", attempt({"Origin": foreign}, True))]
        if case != "login":
            variants += [
                ("no change token", attempt({}, False)),
                ("wrong change token", attempt({"X-Change-Token": "wrong" + wren.change_token}, False)),
                ("change token in the query", attempt({}, False, f"?X-Change-Token={wren.change_token}&change_token={wren.change_token}")),
                ("change token as a cookie", attempt({}, False, "", f"X-Change-Token={wren.change_token}; change_token={wren.change_token}")),
            ]
        for what, r in variants:
            expect_status(r, 403, "change_refused", f"{case} with {what}")
            assert not [h for h in r.headers if h.lower().startswith("access-control-allow")], f"{case}: no CORS headers"
            if case == "login":
                assert not any(ln.startswith("hl_access=") for ln in r.headers.get_list("set-cookie"))
            assert unchanged(), f"{case} with {what} changed state"
        preflight = httpx.request("OPTIONS", app_url + path, timeout=HTTP_TIMEOUT_S,
                                  headers={"Origin": foreign, "Access-Control-Request-Method": method})
        assert not [h for h in preflight.headers if h.lower().startswith("access-control-allow")], "preflight carries no CORS headers"
        good = attempt({"Origin": own}, True)
        if ok_status is None:
            assert good.status_code in (200, 201), f"rule grant with token: {good.status_code} {good.text[:200]}"
            cleanup.append(good.json()["rule"]["id"])
        else:
            expect_status(good, ok_status, what=f"{case} with the change token and own Origin")
        if case == "logout":
            expect_status(wren.get("/api/auth/session"), 401)
        if case == "rule_revoke":
            expect_status(revoke_rule(Staff(app_url, WREN), mod, cleanup[0]), 404, what="revoking a rule that no longer exists")
    finally:
        admin = Staff(app_url, WREN)
        for rid in cleanup:
            revoke_rule(admin, mod, rid)


def test_widget_identity_required(app_url):
    wren = Staff(app_url, WREN)
    player = Player(app_url)
    other = Player(app_url)
    ferry_sig = hmac.new(FERRY_WIDGET_SECRET.encode(), player.pid.encode(), hashlib.sha256).hexdigest()
    attempts = [
        ("missing identity", player, {"bare": True}),
        ("another player's signature", player, {"signature": other.signature}),
        ("signed with another game's widget secret", player, {"signature": ferry_sig}),
        ("malformed player id", Player(app_url, pid="bad id!"), {}),

        ("unknown game", Player(app_url, pid=player.pid, game=fresh("g")), {}),
    ]
    for what, who, opts in attempts:
        expect_status(who.call("GET", f"/api/widget/{who.game}/me", **opts), 401, "invalid_identity", f"me with {what}")
        sent = who.call("POST", f"/api/widget/{who.game}/messages", json={"body": "i never got the lantern pack", "topic": "bug"},
                        key=idempotency_key(), **opts)
        expect_status(sent, 401, "invalid_identity", f"send with {what}")
    me = player.me()
    assert me["thread_id"] is None and me["bucket"]["level"] == BUCKET_CAPACITY, me
    assert inbox_ok(wren, q=player.pid)["counts"] == {"waiting": 0, "answered": 0, "closed": 0}
    sent = player.send("i never got the lantern pack")
    expect_status(sent, 201)
    tid = sent.json()["thread"]["id"]
    expect_status(player.call("GET", f"/api/widget/{GLOAM}/threads/{tid}", signature=other.signature), 401, "invalid_identity")
    assert len(of_kind(player.thread(tid), "player")) == 1


def test_players_see_only_their_own_thread(app_url):
    owner, tid, msg = open_thread(app_url)
    aid = expect_status(owner.upload(msg["id"], TEXT_BYTES, "text/plain"), 202).json()["attachment"]["id"]
    wait_attachment(owner, aid)
    intruder, _, _ = open_thread(app_url)
    unknown = fresh("x")
    pairs = [
        (f"/api/widget/{GLOAM}/threads/{tid}", f"/api/widget/{GLOAM}/threads/{unknown}"),
        (f"/api/widget/{GLOAM}/attachments/{aid}", f"/api/widget/{GLOAM}/attachments/{unknown}"),
        (f"/api/widget/{GLOAM}/attachments/{aid}/content", f"/api/widget/{GLOAM}/attachments/{unknown}/content"),
    ]
    for foreign_path, unknown_path in pairs:
        a = intruder.call("GET", foreign_path)
        b = intruder.call("GET", unknown_path)
        expect_status(a, 404, "not_found")
        expect_status(b, 404, "not_found")
        assert a.json() == b.json(), f"{foreign_path}: foreign id body equals unknown id body"
    foreign_upload = intruder.upload(msg["id"], TEXT_BYTES, "text/plain")
    unknown_upload = intruder.upload(unknown, TEXT_BYTES, "text/plain")
    expect_status(foreign_upload, 404, "not_found")
    assert foreign_upload.json() == expect_status(unknown_upload, 404).json()
    owned = [m for m in owner.thread(tid)["messages"] if m["id"] == msg["id"]][0]
    assert [a["id"] for a in owned["attachments"]] == [aid], "no attachment was added through another player's identity"


def test_widget_send_idempotency(app_url):
    player = Player(app_url)
    key = idempotency_key()
    first = expect_status(player.send("Harbour Bell skin didn't show up after I paid.", "purchase", key=key), 201)
    tid = first.json()["thread"]["id"]
    again = expect_status(player.send("Harbour Bell skin didn't show up after I paid.", "purchase", key=key), 201)
    assert again.headers.get("idempotent-replay") == "true" and again.json() == first.json()
    expect_status(player.send("a different body", "purchase", key=key), 422, "idempotency_mismatch")
    missing = player.call("POST", f"/api/widget/{GLOAM}/messages", json={"body": "no key", "topic": "bug"})
    assert field_error(missing, "idempotency_key") == "Send again from the form."
    field_error(player.send("bad key", "bug", key="bad key!"), "idempotency_key")
    race_key = idempotency_key()
    with concurrent.futures.ThreadPoolExecutor(CONCURRENT) as pool:
        racers = list(pool.map(lambda _: player.send("raced send", None, key=race_key), range(CONCURRENT)))
    fresh_ones = [r for r in racers if r.status_code == 201 and r.headers.get("idempotent-replay") != "true"]
    assert len(fresh_ones) == 1, [r.status_code for r in racers]
    for r in racers:
        if r is not fresh_ones[0]:
            assert (r.status_code == 201 and r.headers.get("idempotent-replay") == "true") or \
                   (r.status_code == 409 and r.json()["error"]["code"] == "idempotency_in_progress"), r.text[:200]
    assert len(of_kind(player.thread(tid), "player")) == 2
    drain(player)
    count = len(of_kind(player.thread(tid), "player"))
    replay = expect_status(player.send("Harbour Bell skin didn't show up after I paid.", "purchase", key=key), 201)
    assert replay.headers.get("idempotent-replay") == "true" and replay.json() == first.json()
    assert player.me()["bucket"]["level"] == 0
    assert len(of_kind(player.thread(tid), "player")) == count


def test_token_bucket_per_player(app_url):
    player, tid, _ = open_thread(app_url, "bug", "flood start")
    for i in range(BUCKET_CAPACITY - 1):
        expect_status(player.send(f"flood {i}"), 201)
    refused = player.send("one too many")
    expect_status(refused, 429, "rate_limited")
    wait = int(refused.headers["retry-after"])
    assert 1 <= wait <= REFILL_SECONDS
    me = player.me()["bucket"]
    assert me["level"] == 0 and me["capacity"] == BUCKET_CAPACITY and 1 <= me["retry_after_seconds"] <= REFILL_SECONDS
    assert len(of_kind(player.thread(tid), "player")) == BUCKET_CAPACITY, "the refused send stored nothing"
    bystander = Player(app_url)
    expect_status(bystander.send("not slowed"), 201)
    assert bystander.me()["bucket"]["level"] == BUCKET_CAPACITY - 1
    burst = Player(app_url)
    expect_status(burst.send("burst opener"), 201)
    with concurrent.futures.ThreadPoolExecutor(BUCKET_CAPACITY + 4) as pool:
        results = list(pool.map(lambda i: burst.send(f"burst {i}", None), range(BUCKET_CAPACITY + 4)))
    codes = sorted(r.status_code for r in results)
    assert codes.count(201) == BUCKET_CAPACITY - 1 and codes.count(429) == 5, codes
    wait_until(lambda: player.me()["bucket"]["level"] >= 1, f"a token refills within {wait}s", wait + 2 * SLACK_S)
    assert player.me()["bucket"]["retry_after_seconds"] is None
    expect_status(player.send("after the refill"), 201)


def test_attachment_limits(app_url):
    player, tid, msg = open_thread(app_url)
    for i in range(3):
        expect_status(player.upload(msg["id"], TEXT_BYTES, "text/plain", f"log{i}.txt"), 202)
    assert field_error(player.upload(msg["id"], TEXT_BYTES, "text/plain", "log3.txt"), "file") == "Three files per message at most."
    second = expect_status(player.send("another one"), 201).json()["message"]
    assert field_error(player.upload(second["id"], b"", "text/plain", "empty.txt"), "file") == "Attach a PNG, JPEG or plain-text file."
    expect_status(player.upload(second["id"], b"a" * (FILE_LIMIT_BYTES + 1), "text/plain", "big.txt"), 413, "too_large")
    exact = expect_status(player.upload(second["id"], b"a" * FILE_LIMIT_BYTES, "text/plain", "max.txt"), 202)
    assert exact.json()["attachment"]["size"] == FILE_LIMIT_BYTES
    body = player.thread(tid)
    counts = {m["id"]: len(m["attachments"]) for m in body["messages"]}
    assert counts[msg["id"]] == 3 and counts[second["id"]] == 1, counts


def test_attachments_served_only_through_hushline(app_url):
    owner, tid, msg = open_thread(app_url)
    aid = expect_status(owner.upload(msg["id"], TEXT_BYTES, "text/plain", "launcher.txt"), 202).json()["attachment"]["id"]
    assert wait_attachment(owner, aid)["status"] == "attached"
    wren = Staff(app_url, WREN)
    for r in (owner.content(aid), wren.get(f"/api/attachments/{aid}/content")):
        expect_status(r, 200)
        assert r.content == TEXT_BYTES
        assert r.headers["content-type"] == "text/plain; charset=utf-8"
        assert "sandbox" in parse_csp(r.headers.get("content-security-policy", "")), r.headers.get("content-security-policy")
        assert r.headers.get("x-content-type-options") == "nosniff"
    for r in (owner.attachment(aid), wren.get(f"/api/attachments/{aid}")):
        expect_status(r, 200)
        flat = jsonlib.dumps(r.json())
        assert f"attachments/{GLOAM}" not in flat and "http" not in flat, f"attachment body names no bucket address: {flat}"
    unknown = fresh("x")
    pim = Staff(app_url, PIM)
    a, b = pim.get(f"/api/attachments/{aid}/content"), pim.get(f"/api/attachments/{unknown}/content")
    expect_status(a, 404)
    assert a.json() == expect_status(b, 404).json()
    stranger, _, _ = open_thread(app_url)
    expect_status(stranger.content(aid), 404, "not_found")
    assert S3().get(f"attachments/{GLOAM}/{aid}") == TEXT_BYTES


TYPE_CASES = ["png", "jpeg", "text", "png_declared_text", "text_declared_png", "jpeg_declared_png", "binary_declared_text", "nul_declared_text"]
TYPE_INPUTS = {
    "png": ("png", "image/png", "image/png"),
    "jpeg": ("jpeg", "image/jpeg", "image/jpeg"),
    "text": ("text", "text/plain", "text/plain"),
    "png_declared_text": ("png", "text/plain", None),
    "text_declared_png": ("text", "image/png", None),
    "jpeg_declared_png": ("jpeg", "image/png", None),
    "binary_declared_text": ("binary", "text/plain", None),
    "nul_declared_text": ("nul", "text/plain", None),
}


@pytest.mark.parametrize("case", TYPE_CASES, ids=TYPE_CASES)
def test_upload_type_from_bytes(app_url, case):
    data = {"png": PNG_BYTES, "jpeg": JPEG_BYTES, "text": TEXT_BYTES, "binary": b"\xff\xfe\xfa\x80", "nul": b"lantern\x00pack"}
    kind, declared, detected = TYPE_INPUTS[case]
    player, tid, msg = open_thread(app_url)
    r = player.upload(msg["id"], data[kind], declared, "upload.bin")
    if detected is None:
        assert field_error(r, "file") == "Attach a PNG, JPEG or plain-text file."
        owned = [m for m in player.thread(tid)["messages"] if m["id"] == msg["id"]][0]
        assert owned["attachments"] == []
        return
    expect_status(r, 202)
    attachment = r.json()["attachment"]
    assert attachment["content_type"] == detected and attachment["status"] == "uploading"
    assert wait_attachment(player, attachment["id"])["status"] == "attached"
    served = expect_status(player.content(attachment["id"]), 200)
    assert served.headers["content-type"] == (detected if detected != "text/plain" else "text/plain; charset=utf-8")
    assert served.content == data[kind]
    assert S3().get(f"attachments/{GLOAM}/{attachment['id']}") == data[kind]


FILENAME_CASES = ["hostile", "long", "split_surrogate", "path_only"]
HOSTILE_NAME = "../../évilX-Injected: 1.png"


@pytest.mark.parametrize("case", FILENAME_CASES, ids=FILENAME_CASES)
def test_stored_filename_and_download_header(app_url, case):
    submitted = {"hostile": HOSTILE_NAME, "long": "a" * (FILENAME_UNITS + 10), "split_surrogate": "b" * (FILENAME_UNITS - 1) + "😀c",
                 "path_only": "x/  "}[case]
    stored = {"hostile": "évilX-Injected: 1.png", "long": "a" * FILENAME_UNITS, "split_surrogate": "b" * (FILENAME_UNITS - 1),
              "path_only": "attachment"}[case]
    header = ("attachment; filename=\"_vilX-Injected: 1.png\"; filename*=UTF-8''%C3%A9vilX-Injected%3A%201.png" if case == "hostile"
              else f"attachment; filename=\"{stored}\"; filename*=UTF-8''{stored}")
    data = PNG_BYTES if case == "hostile" else TEXT_BYTES
    player, _, msg = open_thread(app_url)
    r = expect_status(player.upload(msg["id"], data, "image/png" if case == "hostile" else "text/plain", filename_star=submitted), 202)
    aid = r.json()["attachment"]["id"]
    assert r.json()["attachment"]["filename"] == stored
    assert wait_attachment(player, aid)["status"] == "attached"
    wren = Staff(app_url, WREN)
    assert expect_status(wren.get(f"/api/attachments/{aid}"), 200).json()["filename"] == stored
    for served in (player.content(aid), wren.get(f"/api/attachments/{aid}/content")):
        expect_status(served, 200)
        assert served.headers.get("content-disposition") == header


def test_wf_player_attachment_store_confirms(browser, app_url):
    player = Player(app_url)
    uploads: list[Any] = []
    with widget_page(browser, player) as page:
        page.on("response", lambda resp: uploads.append(resp) if resp.request.method == "POST" and resp.url.endswith("/attachments") else None)
        select(page.get_by_role("combobox", name="Topic"), "Bug")
        fill(page.get_by_role("textbox", name="Message"), "screenshot attached")
        page.get_by_label("Attach a file").set_input_files(files=[{"name": "shot.png", "mimeType": "image/png", "buffer": PNG_BYTES}])
        announcements = region(page, "Widget announcements")
        with ctx(held(page, "**/attachments")) as hold:
            click(page.get_by_role("button", name="Send"))
            ui_wait(page, lambda: text_of(announcements) == "Uploading shot.png...", "the upload announces its pending copy")
            hold.release()
        conversation = page.get_by_role("list", name="Conversation")
        ui_wait(page, lambda: "attached" in text_of(conversation.get_by_role("listitem").filter(has_text="shot.png").first)
                and text_of(announcements) == "Attached shot.png.", "the attachment reads attached and is announced")
        assert uploads and uploads[0].status == 202 and uploads[0].json()["attachment"]["status"] == "uploading"
    tid = player.me()["thread_id"]
    attachment = [a for m in player.thread(tid)["messages"] for a in m["attachments"]][0]
    assert attachment["status"] == "attached" and attachment["filename"] == "shot.png" and attachment["content_type"] == "image/png"
    assert S3().get(f"attachments/{GLOAM}/{attachment['id']}") == PNG_BYTES


def test_wf_player_attachment_store_down(browser):
    base = os.environ["APP_MINIO_DOWN_URL"]
    player = Player(base)
    with widget_page(browser, player) as page:
        select(page.get_by_role("combobox", name="Topic"), "Bug")
        fill(page.get_by_role("textbox", name="Message"), "screenshot attached")
        page.get_by_label("Attach a file").set_input_files(files=[{"name": "shot.png", "mimeType": "image/png", "buffer": PNG_BYTES}])
        click(page.get_by_role("button", name="Send"))
        conversation = page.get_by_role("list", name="Conversation")
        ui_wait(page, lambda: "failed" in text_of(conversation.get_by_role("listitem").filter(has_text="shot.png").first)
                and text_of(region(page, "Widget announcements")) == "shot.png didn't upload. Send it again later.",
                "the attachment reads failed with the published copy", seconds=ATTACH_SETTLE_S + UI_S)
    tid = player.me()["thread_id"]
    attachment = [a for m in player.thread(tid)["messages"] for a in m["attachments"]][0]
    assert attachment["status"] == "failed"
    expect_status(player.content(attachment["id"]), 409, "not_attached")
    assert S3().keys(f"attachments/{GLOAM}/{attachment['id']}") == []


HOOK_CASES = ["accepted", "bad_signature", "stale_past", "stale_future", "edge_inside", "nonce_seen", "nonce_race",
              "unknown_game", "too_large", "not_json", "bad_currency", "missing_field", "occurred_at_not_iso"]


@pytest.mark.parametrize("case", HOOK_CASES, ids=HOOK_CASES)
def test_signed_game_server_events(app_url, case):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    rid = fresh("r")
    event = receipt_event(app_url, player.pid, rid)
    now = server_now(app_url)
    purchased = 0
    if case == "accepted":
        r = expect_status(post_event(app_url, event), 201)
        assert r.json()["status"] == "accepted" and r.json()["message_id"]
        purchased = 1
    elif case == "bad_signature":
        expect_status(post_event(app_url, event, secret=FERRY_WIDGET_SECRET), 401, "bad_signature")
    elif case == "stale_past":
        expect_status(post_event(app_url, event, ts=now - WINDOW_SECONDS - WINDOW_MARGIN_S), 401, "stale_timestamp")
    elif case == "stale_future":
        expect_status(post_event(app_url, event, ts=now + WINDOW_SECONDS + WINDOW_MARGIN_S), 401, "stale_timestamp")
    elif case == "edge_inside":
        expect_status(post_event(app_url, event, ts=now - WINDOW_SECONDS + WINDOW_MARGIN_S), 201)
        purchased = 1
    elif case == "nonce_seen":
        raw = jsonlib.dumps(event).encode()
        expect_status(post_event(app_url, raw=raw), 201)
        expect_status(post_event(app_url, raw=raw), 409, "nonce_seen")
        purchased = 1
    elif case == "nonce_race":
        raw = jsonlib.dumps(event).encode()
        with concurrent.futures.ThreadPoolExecutor(CONCURRENT) as pool:
            results = list(pool.map(lambda _: post_event(app_url, raw=raw), range(CONCURRENT)))
        codes = sorted(r.status_code for r in results)
        assert codes == [201] + [409] * (CONCURRENT - 1), codes
        purchased = 1
    elif case == "unknown_game":
        expect_status(post_event(app_url, event, game=fresh("g")), 404, "not_found")
    elif case == "too_large":
        expect_status(post_event(app_url, {**event, "pad": "x" * JSON_LIMIT_BYTES}), 413)
    elif case == "not_json":
        expect_status(post_event(app_url, event, content_type="text/plain"), 415)
    elif case == "bad_currency":
        r = post_event(app_url, {**event, "currency": "XYZ"})
        assert field_error(r, "currency") == "Use one of the published currencies."
    elif case == "missing_field":
        r = post_event(app_url, {k: v for k, v in event.items() if k != "receipt_id"})
        assert field_error(r, "receipt_id") == "This field is missing or not valid."
    else:
        for bad in ("Mon, 02 Nov 2026 19:12:00 GMT", "2 Nov 2026 19:12", "November 2, 2026"):
            r = post_event(app_url, {**event, "nonce": nonce(), "occurred_at": bad})
            assert field_error(r, "occurred_at") == "This field is missing or not valid.", bad
    body = thread_body(wren, tid)
    assert [p["receipt_id"] for p in body["purchases"]].count(rid) == purchased, body["purchases"]


def test_one_purchase_per_receipt_and_refund(app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    rid, fid = fresh("r"), fresh("f")
    original = accepted(app_url, receipt_event(app_url, player.pid, rid, 499, "USD"))
    dup = expect_status(post_event(app_url, receipt_event(app_url, player.pid, rid, 1200, "JPY", "Ember Lantern Bundle")), 200)
    assert dup.json() == {"status": "duplicate", "message_id": original}
    refund_original = accepted(app_url, refund_event(app_url, player.pid, fid, rid, 100, "USD"))
    dup_refund = expect_status(post_event(app_url, refund_event(app_url, player.pid, fid, rid, 200, "USD")), 200)
    assert dup_refund.json() == {"status": "duplicate", "message_id": refund_original}
    rid2, fid2 = fresh("r"), fresh("f")
    for make in (lambda: receipt_event(app_url, player.pid, rid2, 1200, "JPY", "Ember Lantern Bundle"),
                 lambda: refund_event(app_url, player.pid, fid2, rid2, 400, "JPY")):
        events = [make() for _ in range(CONCURRENT)]
        with concurrent.futures.ThreadPoolExecutor(CONCURRENT) as pool:
            results = list(pool.map(lambda e: post_event(app_url, e), events))
        codes = sorted(r.status_code for r in results)
        assert codes == [200] * (CONCURRENT - 1) + [201], codes
        winner = [r for r in results if r.status_code == 201][0].json()["message_id"]
        assert all(r.json()["message_id"] == winner for r in results if r.status_code == 200)
    purchases = purchases_by_receipt(wren, tid)
    assert purchases[rid]["amount_minor"] == 499 and purchases[rid]["currency"] == "USD" and purchases[rid]["item"] == "Lantern Pack"
    assert purchases[rid]["refunded_minor"] == 100
    assert purchases[rid2]["refunded_minor"] == 400
    events = [m["event"] for m in thread_body(wren, tid)["messages"] if m["kind"] == "event" and m["event"]["verdict"] == "accepted"]
    assert sum(1 for e in events if e["type"] == "purchase.receipt" and e["receipt_id"] == rid) == 1
    assert sum(1 for e in events if e["type"] == "purchase.refunded" and e["refund_id"] in (fid, fid2)) == 2


def test_wf_server_receipt_refused_record(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    rid = fresh("r")
    raw = jsonlib.dumps(receipt_event(app_url, player.pid, rid)).encode()
    expect_status(post_event(app_url, raw=raw), 201)
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        expect_status(post_event(app_url, raw=raw), 409, "nonce_seen")
        ui_wait(page, lambda: messages(page).filter(has_text="Refused game-server event: purchase.receipt").count() >= 1,
                "the refused entry appears in the open thread", seconds=LIVE_S + UI_S)
        ui_wait(page, lambda: text_of(region(page, "Inbox announcements")) ==
                f"Refused a game-server event for {player.pid}: nonce already seen.", "the refusal is announced")
        assert page.get_by_role("list", name="Purchases").get_by_role("listitem").filter(has_text=rid).count() == 1
    expect_status(post_event(app_url, receipt_event(app_url, player.pid, fresh("r")), secret=FERRY_WIDGET_SECRET), 401, "bad_signature")
    body = thread_body(wren, tid)
    refused = [m for m in body["messages"] if m["kind"] == "event" and m["event"]["verdict"] == "refused"]
    assert len(refused) == 2, [m["event"] for m in refused]
    verdicts = sorted(line(forensics_settled(wren, m["id"]), "signature")["verdict"] for m in refused)
    assert verdicts == ["signature refused: bad signature", "signature refused: nonce already seen"]
    assert [p["receipt_id"] for p in body["purchases"]] == [rid]
    assert body["status"] == "waiting"
    assert not [m for m in player.thread(tid)["messages"] if m["kind"] == "event" and m["event"]["verdict"] == "refused"]
    stranger = fresh("p")
    expect_status(post_event(app_url, receipt_event(app_url, stranger, fresh("r")), secret=FERRY_WIDGET_SECRET), 401, "bad_signature")
    assert inbox_ok(wren, q=stranger)["counts"] == {"waiting": 0, "answered": 0, "closed": 0}


AMOUNT_ROWS = [("JPY", 1200, "1200 JPY"), ("KWD", 1250, "1.250 KWD"), ("KWD", 125, "0.125 KWD"), ("USD", 0, "0.00 USD"),
               ("JPY", 0, "0 JPY"), ("EUR", 1234567, "12345.67 EUR"), ("USD", 499, "4.99 USD")]


def test_wf_server_receipt_currencies(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    rids = []
    for currency, amount, _ in AMOUNT_ROWS:
        rid = fresh("r")
        rids.append(rid)
        accepted(app_url, receipt_event(app_url, player.pid, rid, amount, currency))
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        purchases = page.get_by_role("list", name="Purchases").get_by_role("listitem")
        for rid, (_, _, shown) in zip(rids, AMOUNT_ROWS):
            ui_wait(page, lambda: shown in text_of(purchases.filter(has_text=rid).first), f"purchase {rid} shows {shown}")
        assert "," not in text_of(purchases.filter(has_text=rids[5]).first)
    with widget_page(browser, player) as page:
        conversation = page.get_by_role("list", name="Conversation")
        ui_wait(page, lambda: "Purchase recorded: Lantern Pack, 4.99 USD" in text_of(conversation), "the widget shows the receipt entry")
        assert "Purchase recorded: Lantern Pack, 1.250 KWD" in text_of(conversation)
    stored = purchases_by_receipt(wren, tid)
    for rid, (currency, amount, _) in zip(rids, AMOUNT_ROWS):
        assert stored[rid]["amount_minor"] == amount and stored[rid]["currency"] == currency


def test_wf_server_receipt_refund_ledger(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    yen, full, free, foreign = fresh("r"), fresh("r"), fresh("r"), fresh("r")
    early = refund_event(app_url, player.pid, fresh("f"), yen, 300, "JPY")
    early_id = accepted(app_url, early)
    early_body = [m for m in thread_body(wren, tid)["messages"] if m["id"] == early_id][0]
    assert early_body["event"]["refund_applied"] is None
    accepted(app_url, receipt_event(app_url, player.pid, yen, 1200, "JPY", "Ember Lantern Bundle"))
    accepted(app_url, refund_event(app_url, player.pid, fresh("f"), yen, 100, "JPY"))
    again = expect_status(post_event(app_url, {**early, "nonce": nonce(), "amount_minor": 999}), 200)
    assert again.json() == {"status": "duplicate", "message_id": early_id}
    accepted(app_url, receipt_event(app_url, player.pid, full, 499, "USD"))
    for _ in range(2):
        accepted(app_url, refund_event(app_url, player.pid, fresh("f"), full, 300, "USD"))
    accepted(app_url, receipt_event(app_url, player.pid, free, 0, "USD"))
    accepted(app_url, refund_event(app_url, player.pid, fresh("f"), free, 100, "USD"))
    accepted(app_url, receipt_event(app_url, player.pid, foreign, 499, "USD"))
    foreign_refund = accepted(app_url, refund_event(app_url, player.pid, fresh("f"), foreign, 100, "EUR"))
    body = thread_body(wren, tid)
    ledger = {p["receipt_id"]: (p["amount_minor"], p["refunded_minor"], p["status"]) for p in body["purchases"]}
    assert ledger[yen] == (1200, 400, "partly_refunded")
    assert ledger[full] == (499, 499, "refunded")
    assert ledger[free] == (0, 0, "paid")
    assert ledger[foreign] == (499, 0, "paid")
    events = {m["id"]: m["event"] for m in body["messages"] if m["kind"] == "event"}
    assert events[early_id]["refund_applied"] is True and events[foreign_refund]["refund_applied"] is False
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        items = page.get_by_role("list", name="Purchases").get_by_role("listitem")
        ui_wait(page, lambda: "partly refunded: 400 JPY" in text_of(items.filter(has_text=yen).first), "the yen bundle reads partly refunded")
        assert "refunded" in text_of(items.filter(has_text=full).first) and "partly" not in text_of(items.filter(has_text=full).first)
        assert "paid" in text_of(items.filter(has_text=free).first)
        assert message_item(page, f"Refund not applied: {foreign}, currency differs").is_visible()


def test_wf_link_unfurl_hostile_message(browser, app_url):
    wren = Staff(app_url, WREN)
    attribute_trap = '[look](https://example.test/" onmouseover="window.__hlPwned=1) and &lt;b&gt;x&lt;/b&gt;'
    player, tid, _ = open_thread(app_url, "other", TALLOW_TEXT)
    expect_status(player.send(attribute_trap), 201)
    stored = [m["body"] for m in of_kind(thread_body(wren, tid), "player")]
    assert stored == [TALLOW_TEXT, attribute_trap]

    def inspect(page: Page, items: Locator) -> None:
        hostile = items.filter(has_text="alert('gotcha')").first
        ui_wait(page, hostile.is_visible, "the hostile message is shown as words")
        assert "<script>" not in text_of(hostile) and "claim now" in text_of(hostile)
        trap = items.filter(has_text="&lt;b&gt;x&lt;/b&gt;").first
        assert trap.is_visible(), "entity text stays literal"
        for item in (hostile, trap):
            links = item.get_by_role("link")
            for i in range(links.count()):
                href = links.nth(i).get_attribute("href") or ""
                assert re.match(r"^(https?:|mailto:)", href, re.I), f"link outside the allowlist: {href}"
                links.nth(i).hover()
        assert page.evaluate("() => window.__hlPwned") is None

    dialogs: list[str] = []
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        open_thread_page(page, player.pid)
        inspect(page, messages(page))
        click(message_item(page, "alert('gotcha')"))
        ui_wait(page, lambda: "refused: metadata" in text_of(check_lines(tamperglass(page)).nth(3)), "Tamperglass settles")
        assert page.evaluate("() => window.__hlPwned") is None
    with widget_page(browser, player) as page:
        page.on("dialog", lambda d: (dialogs.append(d.message), d.dismiss()))
        inspect(page, page.get_by_role("list", name="Conversation").get_by_role("listitem"))
    assert dialogs == [], f"a script ran: {dialogs}"


def test_wf_link_unfurl_sanitiser_record(browser, app_url):
    wren = Staff(app_url, WREN)
    emoji = "😀 <b>hi</b>"
    cases = [
        (TALLOW_TEXT, TALLOW_AFTER, ["<script>", "</script>", "(javascript:alert(1))"]),
        (emoji, "😀 hi", ["<b>", "</b>"]),
        ("a <b no close", "a <b no close", []),
        ("[x](javascript:alert(1)", "[x](javascript:alert(1)", []),
        ("[ok](HTTPS://example.test/x) and [no](data:text/html,hi)", "[ok](HTTPS://example.test/x) and [no]", ["(data:text/html,hi)"]),
    ]
    player = Player(app_url)
    mids = []
    for i, (before, _, _) in enumerate(cases):
        r = expect_status(player.send(before, "other" if i == 0 else None), 201)
        mids.append(r.json()["message"]["id"])
        tid = r.json()["thread"]["id"]
    for mid, (before, after, removed) in zip(mids, cases):
        stage = line(forensics_settled(wren, mid), "sanitiser")
        assert stage["before"] == before and stage["after"] == after, stage
        assert [span["text"] for span in stage["removed"]] == removed, stage["removed"]
        cursor = 0
        for span in stage["removed"]:
            index = before.index(span["text"], cursor)
            assert span["start"] == u16(before[:index]) and span["end"] == u16(before[:index]) + u16(span["text"]), span
            cursor = index + len(span["text"])
        assert stage["verdict"] == (f"{len(removed)} removed" if removed else "nothing removed")
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        click(message_item(page, "alert('gotcha')"))
        pane = tamperglass(page)
        ui_wait(page, lambda: TALLOW_AFTER in text_of(pane) or "free skins here alert('gotcha') [claim now]" in text_of(pane),
                "Tamperglass shows the after text")
        struck = pane.get_by_text("<script>", exact=True).first
        assert struck.evaluate(
            """el => { for (let n = el; n; n = n.parentElement) {
                 if (getComputedStyle(n).textDecorationLine.includes('line-through')) return true; }
               return false; }"""), "removed span is struck through"


LINK_CLASS_CASES = ["metadata_v4", "metadata_v6", "loopback", "loopback_decimal", "loopback_hex", "loopback_octal", "loopback_name",
                    "loopback_v6", "loopback_mapped_v6", "private_10", "private_172", "private_192", "private_v6", "link_local",
                    "link_local_v6", "shared", "reserved_zero", "reserved_multicast", "reserved_v6", "public_stand_in", "first_link_only"]
LINK_CLASS_EXPECT = {
    "metadata_v4": ("http://169.254.169.254/latest/meta-data/", "refused: metadata", "169.254.169.254"),
    "metadata_v6": ("[m](http://[fd00:ec2::254]/)", "refused: metadata", None),
    "loopback": ("http://127.0.0.1:{port}/x", "refused: loopback", "127.0.0.1"),
    "loopback_decimal": ("http://2130706433:{port}/x", "refused: loopback", "127.0.0.1"),
    "loopback_hex": ("http://0x7f000001:{port}/x", "refused: loopback", "127.0.0.1"),
    "loopback_octal": ("http://0177.0.0.1:{port}/x", "refused: loopback", "127.0.0.1"),
    "loopback_name": ("http://localhost:{port}/x", "refused: loopback", None),
    "loopback_v6": ("[l](http://[::1]:{port}/x)", "refused: loopback", None),
    "loopback_mapped_v6": ("[l](http://[::ffff:127.0.0.1]:{port}/x)", "refused: loopback", None),
    "private_10": ("http://10.0.0.1/x", "refused: private", "10.0.0.1"),
    "private_172": ("http://172.16.0.1/x", "refused: private", "172.16.0.1"),
    "private_192": ("http://192.168.1.1/x", "refused: private", "192.168.1.1"),
    "private_v6": ("[p](http://[fc00::1]/x)", "refused: private", None),
    "link_local": ("http://169.254.1.1/x", "refused: link-local", "169.254.1.1"),
    "link_local_v6": ("[p](http://[fe80::1]/x)", "refused: link-local", None),
    "shared": ("http://100.64.0.1/x", "refused: shared", "100.64.0.1"),
    "reserved_zero": ("http://0.0.0.0:{port}/x", "refused: reserved", "0.0.0.0"),
    "reserved_multicast": ("http://224.0.0.1/x", "refused: reserved", "224.0.0.1"),
    "reserved_v6": ("[r](http://[::]:{port}/x)", "refused: reserved", None),
    "public_stand_in": ("{stand_in}/web/patch-notes", "fetched", None),
    "first_link_only": ("http://169.254.169.254/latest/meta-data/ then {stand_in}/web/{ns}", "refused: metadata", "169.254.169.254"),
}


@pytest.mark.parametrize("case", LINK_CLASS_CASES, ids=LINK_CLASS_CASES)
def test_link_refusal_classes(app_url, wiremock, case):
    wren = Staff(app_url, WREN)
    ns = fresh("w")
    wiremock.stub("GET", f"/web/{ns}", body=f"<html><head><title>{PATCH_TITLE}</title></head></html>", headers={"Content-Type": "text/html"})
    listener = Listener()
    try:
        template, verdict, address = LINK_CLASS_EXPECT[case]
        link = template.format(port=listener.port, stand_in=stand_in(), ns=ns)
        player, tid, msg = open_thread(app_url, "other", f"look {link} now")
        stage = line(forensics_settled(wren, msg["id"]), "link")
        assert stage["verdict"] == verdict, f"{link}: {stage}"
        if address:
            assert stage["address"] == address, stage
        unfurl = [m for m in thread_body(wren, tid)["messages"] if m["id"] == msg["id"]][0]["unfurl"]
        if verdict == "fetched":
            assert unfurl["title"] == PATCH_TITLE and unfurl["description"] == PATCH_DESCRIPTION
            assert wiremock.requests("/web/patch-notes")
        else:
            assert unfurl is None
        if case == "first_link_only":
            assert wiremock.requests(f"/web/{ns}") == [], "only the first link is fetched"
        assert listener.hits == 0, "a refused link reached the local listener"
    finally:
        listener.close()


REDIRECT_CASES = ["redirect_public", "redirect_metadata", "redirect_loopback", "three_redirects", "four_redirects",
                  "too_large", "exact_limit", "timed_out", "not_a_page"]


def _page_html(size: int) -> str:
    head = f"<!doctype html><html><head><title>{PATCH_TITLE}</title></head><body>"
    tail = "</body></html>"
    return head + "a" * (size - len(head) - len(tail)) + tail


@pytest.mark.parametrize("case", REDIRECT_CASES, ids=REDIRECT_CASES)
def test_link_redirects_and_caps(app_url, wiremock, case):
    wren = Staff(app_url, WREN)
    ns = fresh("w")
    html = {"Content-Type": "text/html"}
    path = {"redirect_public": "/web/patch-notes-short", "redirect_metadata": "/web/free-skins", "redirect_loopback": "/web/back-door"}.get(case, f"/web/{ns}-0")
    if case in ("three_redirects", "four_redirects"):
        hops = 3 if case == "three_redirects" else 4
        for i in range(hops):
            target = f"/web/{ns}-{i + 1}" if i % 2 else f"{stand_in()}/web/{ns}-{i + 1}"
            wiremock.stub("GET", f"/web/{ns}-{i}", status=302, headers={"Location": target})
        wiremock.stub("GET", f"/web/{ns}-{hops}", body=_page_html(FETCH_LIMIT_BYTES // 8), headers=html)
    elif case == "too_large":
        wiremock.stub("GET", path, body=_page_html(FETCH_LIMIT_BYTES + 1), headers=html)
    elif case == "exact_limit":
        wiremock.stub("GET", path, body=_page_html(FETCH_LIMIT_BYTES), headers=html)
    elif case == "timed_out":
        wiremock.stub("GET", path, body=_page_html(FETCH_LIMIT_BYTES // 8), headers=html, delay_ms=FETCH_LIMIT_MS + 1500)
    elif case == "not_a_page":
        wiremock.stub("GET", path, body=PATCH_TITLE, headers={"Content-Type": "text/plain"})
    expected = {"redirect_public": "fetched", "redirect_metadata": "refused: metadata", "redirect_loopback": "refused: loopback",
                "three_redirects": "fetched", "four_redirects": "refused: too many redirects", "too_large": "failed: too large",
                "exact_limit": "fetched", "timed_out": "failed: timed out", "not_a_page": "failed: not a page"}[case]
    _, tid, msg = open_thread(app_url, "other", f"see {stand_in()}{path}.")
    stage = line(forensics_settled(wren, msg["id"]), "link")
    assert stage["verdict"] == expected, stage
    if case == "redirect_metadata":
        assert stage["address"] == "169.254.169.254"
    if case == "redirect_loopback":
        assert stage["address"] == "127.0.0.1"
    if case == "four_redirects":
        assert wiremock.requests(f"/web/{ns}-4") == [], "the fourth redirect is never followed"
    unfurl = [m for m in thread_body(wren, tid)["messages"] if m["id"] == msg["id"]][0]["unfurl"]
    assert (unfurl is not None and unfurl["title"] == PATCH_TITLE) if expected == "fetched" else unfurl is None


def test_inbox_counts_and_search_permitted(app_url):
    tag = fresh("q")
    wren, juno, pim = Staff(app_url, WREN), Staff(app_url, JUNO), Staff(app_url, PIM)
    word = fresh("w")
    _, bug_t, _ = open_thread(app_url, "bug", f"Lantern {word}\nsecond line", pid=f"{tag}a")
    _, long_t, _ = open_thread(app_url, "account", "L" * (FIRST_LINE_CHARS + 10), pid=f"{tag}b")
    _, pur_t, _ = open_thread(app_url, "purchase", "i never got the lantern pack", pid=f"{tag}c")
    _, ans_t, _ = open_thread(app_url, "other", "free skins", pid=f"{tag}d")
    expect_status(reply(wren, ans_t), 201)
    waiting = inbox_ok(wren, q=tag)
    assert waiting["counts"] == {"waiting": 3, "answered": 1, "closed": 0}, waiting["counts"]
    rows = {t["id"]: t for t in waiting["threads"]}
    assert set(rows) == {bug_t, long_t, pur_t}
    assert rows[bug_t]["first_line"] == f"Lantern {word}" and rows[bug_t]["topic"] == "bug" and rows[bug_t]["status"] == "waiting"
    assert rows[bug_t]["player"] == {"id": f"{tag}a", "name": f"{tag}a"}
    assert rows[long_t]["first_line"] == "L" * FIRST_LINE_CHARS
    assert inbox_ok(wren, q=tag) == inbox_ok(wren, status="waiting", q=tag)
    assert [t["id"] for t in inbox_ok(wren, status="answered", q=tag)["threads"]] == [ans_t]
    seen = inbox_ok(juno, q=tag)
    assert seen["counts"] == {"waiting": 2, "answered": 1, "closed": 0} and pur_t not in {t["id"] for t in seen["threads"]}
    assert inbox_ok(pim, q=tag) == {"counts": {"waiting": 0, "answered": 0, "closed": 0}, "threads": [], "next_cursor": None}
    found = inbox_ok(wren, q=word.upper())
    assert [t["id"] for t in found["threads"]] == [bug_t] and found["counts"]["waiting"] == 1
    assert field_error(inbox(wren, status="pending"), "status") == "Choose waiting, answered or closed."


def test_inbox_cursor_pages(app_url):
    tag = fresh("q")
    wren, juno = Staff(app_url, WREN), Staff(app_url, JUNO)
    created = []
    for i in range(8):
        topic = "purchase" if i % 3 == 1 else "bug"
        _, tid, _ = open_thread(app_url, topic, f"page walk {i}", pid=f"{tag}{i}")
        created.append((tid, topic))

    def walk(staff: Staff, limit: int, status: str = "waiting", first: dict[str, Any] | None = None) -> list[list[str]]:
        pages, cursor = [], None
        if first is not None:
            pages.append([t["id"] for t in first["threads"]])
            cursor = first["next_cursor"]
            if cursor is None:
                return pages
        for _ in range(len(created) + 3):
            body = inbox_ok(staff, status=status, q=tag, limit=limit, cursor=cursor)
            pages.append([t["id"] for t in body["threads"]])
            cursor = body["next_cursor"]
            if cursor is None:
                return pages
        pytest.fail("GET /api/inbox kept returning next_cursor; expected the walk to end")

    pages = walk(juno, 2)
    assert all(len(p) == 2 for p in pages[:-1]), pages
    assert [t for p in pages for t in p] == [t for t, topic in created if topic != "purchase"]
    first = inbox_ok(wren, q=tag, limit=3)
    assert [t["id"] for t in first["threads"]] == [t for t, _ in created[:3]]
    moved = created[6][0]
    expect_status(reply(wren, moved), 201)
    _, late, _ = open_thread(app_url, "bug", "joined mid-walk", pid=f"{tag}x")
    flat = [t for p in walk(wren, 3, first=first) for t in p]
    for tid, _ in created:
        if tid != moved:
            assert flat.count(tid) == 1, f"{tid} appeared {flat.count(tid)} times"
    assert flat.count(late) <= 1 and flat.count(moved) <= 1
    cursor = first["next_cursor"]
    assert field_error(inbox(wren, status="answered", q=tag, cursor=cursor), "cursor") == "Start the list again."
    field_error(inbox(wren, q=tag + "z", cursor=cursor), "cursor")
    field_error(inbox(wren, q=tag, cursor="not-a-cursor"), "cursor")
    for bad in (0, PAGE_LIMIT_MAX + 1, "abc"):
        assert field_error(inbox(wren, q=tag, limit=bad), "limit") == "Choose a page size from 1 to 100."
    assert len(inbox_ok(wren, q=tag, limit=1)["threads"]) == 1
    assert len(inbox_ok(wren, q=tag, limit=PAGE_LIMIT_MAX)["threads"]) == 8
    for tid in (created[0][0], created[2][0]):
        expect_status(reply(wren, tid), 201)
    assert [t["id"] for t in inbox_ok(wren, status="answered", q=tag)["threads"]] == [moved, created[2][0], created[0][0]]


def test_empty_inbox_copy(browser, app_url):
    tag = fresh("q")
    with staff_page(browser, app_url, WREN, f"/inbox?q={tag}") as page:
        ui_wait(page, page.get_by_text("No threads here.", exact=True).is_visible, "an empty search shows the empty copy")
        assert thread_rows(page).count() == 0
        page.goto(f"{app_url}/inbox?status=answered&q={tag}")
        ui_wait(page, page.get_by_text("No threads here.", exact=True).is_visible, "an empty Answered tab shows the empty copy")
    wren = Staff(app_url, WREN)
    mod = juno_id(wren)
    rule = add_rule(wren, mod, "deny", "read", "*")
    try:
        with staff_page(browser, app_url, JUNO) as page:
            ui_wait(page, page.get_by_text("No one is waiting. Back to the game.", exact=True).is_visible, "an empty Waiting tab shows its copy")
            assert thread_rows(page).count() == 0 and tab_count(page, "Waiting") == 0
            assert page.get_by_text("No threads here.", exact=True).count() == 0
    finally:
        revoke_rule(wren, mod, rule)


def test_wf_developer_triage_thread_view(browser, app_url):
    wren = Staff(app_url, WREN)
    pid = fresh("p")
    rid, rid2 = fresh("r"), fresh("r")
    accepted(app_url, match_event(app_url, pid, fresh("m")))
    accepted(app_url, receipt_event(app_url, pid, rid, 499, "USD"))
    accepted(app_url, receipt_event(app_url, pid, rid2, 1200, "JPY", "Ember Lantern Bundle"))
    accepted(app_url, refund_event(app_url, pid, fresh("f"), rid2, 400, "JPY"))
    player, tid, msg = open_thread(app_url, "purchase", f"see {stand_in()}/web/patch-notes", pid=pid)
    aid = expect_status(player.upload(msg["id"], TEXT_BYTES, "text/plain", "notes.txt"), 202).json()["attachment"]["id"]
    wait_attachment(player, aid)
    assert line(forensics_settled(wren, msg["id"]), "link")["verdict"] == "fetched"
    reply_text = "Thanks, I can reproduce it. A fix ships in the next patch."
    expect_status(reply(wren, tid, reply_text), 201)
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, pid)
        needles = ["Match lost: Hollow Run, 21 min", "Purchase recorded: Lantern Pack, 4.99 USD",
                   "Purchase recorded: Ember Lantern Bundle, 1200 JPY", f"Refund recorded: {rid2}, 400 JPY", "notes.txt", reply_text]
        ui_wait(page, lambda: all(any(n in t for t in messages(page).all_inner_texts()) for n in needles), "every entry is shown")
        texts = messages(page).all_inner_texts()
        positions = [next(i for i, t in enumerate(texts) if n in t) for n in needles]
        assert positions == sorted(positions), f"entries out of time order: {positions}"
        player_item = message_item(page, "notes.txt")
        for word in ("attached", PATCH_TITLE, PATCH_DESCRIPTION, urlparse(stand_in()).hostname):
            assert word in text_of(player_item), f"player message shows {word}"
        assert WREN_NAME in text_of(message_item(page, reply_text))
        purchases = page.get_by_role("list", name="Purchases").get_by_role("listitem")
        assert "4.99 USD" in text_of(purchases.filter(has_text=rid).first) and "paid" in text_of(purchases.filter(has_text=rid).first)
        assert "partly refunded: 400 JPY" in text_of(purchases.filter(has_text=rid2).first)
    body = thread_body(wren, tid)
    times = [m["created_at"] for m in body["messages"]]
    assert len(body["messages"]) == 6 and [m["kind"] for m in body["messages"]][-2:] == ["player", "reply"]
    assert times == sorted(times)


def test_developers_stay_inside_their_game(app_url):
    player, tid, msg = open_thread(app_url)
    aid = expect_status(player.upload(msg["id"], TEXT_BYTES, "text/plain"), 202).json()["attachment"]["id"]
    wait_attachment(player, aid)
    wren, pim = Staff(app_url, WREN), Staff(app_url, PIM)
    mod = juno_id(wren)
    unknown = fresh("x")
    routes = [("GET", "/api/threads/{}", None), ("GET", "/api/messages/{}/forensics", None), ("GET", "/api/attachments/{}", None),
              ("GET", "/api/attachments/{}/content", None), ("GET", "/api/threads/{}/receipt-lookup", None),
              ("POST", "/api/threads/{}/close", {}), ("POST", "/api/threads/{}/replies", {"body": "hello"}),
              ("POST", "/api/team/{}/rules", {"effect": "deny", "action": "read", "topic": "*"})]
    ids = {"/api/threads/{}": tid, "/api/messages/{}/forensics": msg["id"], "/api/attachments/{}": aid, "/api/attachments/{}/content": aid,
           "/api/threads/{}/receipt-lookup": tid, "/api/threads/{}/close": tid, "/api/threads/{}/replies": tid, "/api/team/{}/rules": mod}
    for method, template, body in routes:
        key = idempotency_key() if "replies" in template else None
        foreign = pim.call(method, template.format(ids[template]), json=body, key=key)
        missing = pim.call(method, template.format(unknown), json=body, key=idempotency_key() if key else None)
        expect_status(foreign, 404, what=f"{method} {template} with another game's id")
        assert foreign.json() == expect_status(missing, 404).json()
    assert thread_body(wren, tid)["status"] == "waiting"
    otter = [t["id"] for t in inbox_ok(pim, q="p-otter-5")["threads"]][0]
    a, b = wren.get(f"/api/threads/{otter}"), wren.get(f"/api/threads/{unknown}")
    expect_status(a, 404)
    assert a.json() == expect_status(b, 404).json()


def test_verdicts_stored_and_streamed(app_url):
    wren = Staff(app_url, WREN)
    player, tid, m1 = open_thread(app_url, "bug", "first words")
    m2 = expect_status(player.send("second words"), 201).json()["message"]
    f1, f2 = forensics_settled(wren, m1["id"]), forensics_settled(wren, m2["id"])
    assert [entry["stage"] for entry in f1["lines"]] == STAGES
    assert line(f1, "signature")["verdict"] == "signature valid"
    b1, b2 = line(f1, "bucket"), line(f2, "bucket")
    assert (b1["previous"], b1["level"], b1["capacity"], b1["verdict"]) == (8, 7, 8, "7 of 8")
    assert b2["previous"] == b1["level"] and b2["verdict"] == f"{b2['level']} of 8"
    san = line(f1, "sanitiser")
    assert (san["verdict"], san["before"], san["after"], san["removed"]) == ("nothing removed", "first words", "first words", [])
    assert line(f1, "link")["verdict"] == "no link"
    events = read_sse(f"{app_url}/api/messages/{m1['id']}/forensics/stream", {"Cookie": wren.cookie_header()}, HTTP_TIMEOUT_S)
    stages = [jsonlib.loads(data) for name, data in events if name == "stage"]
    assert stages == f1["lines"], stages
    assert events[-1][0] == "settled" and jsonlib.loads(events[-1][1]) == f1
    drain(player)
    assert forensics_settled(wren, m1["id"]) == f1, "stored verdicts never change"
    event_id = accepted(app_url, match_event(app_url, player.pid, fresh("m")))
    fe = forensics_settled(wren, event_id)
    assert [entry["verdict"] for entry in fe["lines"]] == ["signature valid", "not metered", "no player text", "no link"]
    assert (line(fe, "bucket")["previous"], line(fe, "bucket")["level"], line(fe, "bucket")["capacity"]) == (None, None, None)
    assert line(fe, "sanitiser")["before"] is None and line(fe, "sanitiser")["after"] is None
    reply_id = expect_status(reply(wren, tid), 201).json()["message"]["id"]
    assert expect_status(wren.get(f"/api/messages/{reply_id}/forensics"), 200).json()["lines"] == []


def test_wf_developer_reply_close_reply(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "bug", "The Hollow boss freezes after the *second* lantern.")
    text = "Thanks, I can reproduce it. A fix ships in the next patch."
    with widget_page(browser, player) as widget, staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        box = page.get_by_role("textbox", name="Reply")
        fill(box, text)
        box.press("Control+Enter")
        box.press("Control+Enter")
        ui_wait(page, lambda: thread_body(wren, tid)["status"] == "answered", "the reply answers the thread")
        sent_at = time.monotonic()
        conversation = widget.get_by_role("list", name="Conversation")
        ui_wait(widget, lambda: text in text_of(conversation) and f"{GLOAM_NAME} support" in text_of(conversation),
                "the reply reaches the widget", seconds=WIDGET_REPLY_S + SLACK_S)
        assert time.monotonic() - sent_at <= WIDGET_REPLY_S + SLACK_S
        ui_wait(page, lambda: WREN_NAME in text_of(message_item(page, text)), "the workspace attributes the reply")
    replies = of_kind(thread_body(wren, tid), "reply")
    assert [r["body"] for r in replies] == [text] and replies[0]["author"]["name"] == WREN_NAME
    expect_status(close(wren, tid), 200)
    expect_status(reply(wren, tid, "too late"), 409, "thread_closed")
    assert len(of_kind(thread_body(wren, tid), "reply")) == 1


def test_close_rules_and_race(app_url):
    wren = Staff(app_url, WREN)
    _, tid, _ = open_thread(app_url)
    expect_status(close(wren, tid), 409, "not_answered")
    assert thread_body(wren, tid)["status"] == "waiting"
    expect_status(reply(wren, tid), 201)
    with concurrent.futures.ThreadPoolExecutor(2) as pool:
        results = list(pool.map(lambda _: close(wren, tid), range(2)))
    assert sorted(r.status_code for r in results) == [200, 409]
    winner = [r for r in results if r.status_code == 200][0]
    assert winner.json()["thread"] == {"id": tid, "status": "closed"}
    expect_status([r for r in results if r.status_code == 409][0], 409, "already_closed")
    expect_status(close(wren, tid), 409, "already_closed")
    assert thread_body(wren, tid)["status"] == "closed"


def test_reply_and_close_announcements(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url)
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        status = region(page, "Inbox announcements")
        click(page.get_by_role("button", name="Close thread"))
        ui_wait(page, lambda: text_of(status) == "Answer the player before closing.", "close on a waiting thread is refused")
        click(page.get_by_role("button", name="Send reply"))
        ui_wait(page, page.get_by_text("Write a reply before sending.", exact=True).first.is_visible, "an empty reply shows the field error")
        fill(page.get_by_role("textbox", name="Reply"), "Thanks, I can reproduce it.")
        with ctx(held(page, f"**/api/threads/{tid}/replies")) as hold:
            click(page.get_by_role("button", name="Send reply"))
            ui_wait(page, lambda: text_of(status) == "Sending reply...", "pending reply copy")
            hold.release()
        ui_wait(page, lambda: text_of(status) == f"Reply sent to {player.pid}.", "reply success copy")
        page.goto(f"{app_url}/inbox/{tid}?status=answered&q={player.pid}")
        open_thread_page(page, player.pid)
        with ctx(held(page, f"**/api/threads/{tid}/close")) as hold:
            click(page.get_by_role("button", name="Close thread"))
            ui_wait(page, lambda: text_of(status) == "Closing thread...", "pending close copy")
            hold.release()
        ui_wait(page, lambda: text_of(status) == "Thread closed.", "close success copy")
        page.goto(f"{app_url}/inbox/{tid}")
        open_thread_page(page, player.pid)
        click(page.get_by_role("button", name="Close thread"))
        ui_wait(page, lambda: text_of(region(page, "Inbox announcements")) == "This thread is already closed.", "already-closed copy")
        fill(page.get_by_role("textbox", name="Reply"), "One more thing.")
        click(page.get_by_role("button", name="Send reply"))
        ui_wait(page, lambda: text_of(region(page, "Inbox announcements")) ==
                "This thread is closed. It reopens when the player writes again.", "closed-thread reply copy")
    other, tid2, _ = open_thread(app_url)
    with staff_page(browser, app_url, WREN, f"/inbox/{tid2}") as page:
        open_thread_page(page, other.pid)
        page.route(f"**/api/threads/{tid2}/replies", lambda route: route.abort())
        fill(page.get_by_role("textbox", name="Reply"), "Thanks, I can reproduce it.")
        click(page.get_by_role("button", name="Send reply"))
        ui_wait(page, lambda: text_of(region(page, "Inbox announcements")) == "Reply not sent. Try again.", "network failure copy")
    assert of_kind(thread_body(wren, tid2), "reply") == []


def test_reply_idempotency(app_url):
    wren = Staff(app_url, WREN)
    _, tid, _ = open_thread(app_url)
    key = idempotency_key()
    first = expect_status(reply(wren, tid, "Open Settings, then Profile.", key), 201)
    again = expect_status(reply(wren, tid, "Open Settings, then Profile.", key), 201)
    assert again.headers.get("idempotent-replay") == "true" and again.json() == first.json()
    expect_status(reply(wren, tid, "something else", key), 422, "idempotency_mismatch")
    missing = wren.call("POST", f"/api/threads/{tid}/replies", json={"body": "no key"})
    assert field_error(missing, "idempotency_key") == "Send again from the form."
    race = idempotency_key()
    with concurrent.futures.ThreadPoolExecutor(CONCURRENT) as pool:
        results = list(pool.map(lambda _: reply(wren, tid, "raced reply", race), range(CONCURRENT)))
    assert sum(1 for r in results if r.status_code == 201 and r.headers.get("idempotent-replay") != "true") == 1
    assert all(r.status_code == 201 or (r.status_code == 409 and r.json()["error"]["code"] == "idempotency_in_progress") for r in results)
    expect_status(close(wren, tid), 200)
    late = expect_status(reply(wren, tid, "Open Settings, then Profile.", key), 201)
    assert late.headers.get("idempotent-replay") == "true" and late.json() == first.json()
    assert len(of_kind(thread_body(wren, tid), "reply")) == 2 and thread_body(wren, tid)["status"] == "closed"
    _, tid2, _ = open_thread(app_url)
    assert field_error(reply(wren, tid2, "   "), "body") == "Write a reply before sending."
    assert field_error(reply(wren, tid2, "x" * (REPLY_MAX_CHARS + 1)), "body") == "Replies can be up to 4,000 characters."
    expect_status(reply(wren, tid2, "x" * REPLY_MAX_CHARS), 201)

    short_base = os.environ["APP_SHORT_TIMERS_URL"]
    short = Staff(short_base, WREN)
    _, tid3, _ = open_thread(short_base)
    key3 = idempotency_key()
    expect_status(reply(short, tid3, "kept for a while", key3), 201)
    stored_at = time.monotonic()
    deadline = stored_at + SHORT_IDEMPOTENCY_TTL_S + TTL_SLACK_S
    while time.monotonic() < deadline:
        r = reply(short, tid3, "kept for a while", key3)
        if r.status_code == 401:
            expect_status(short.call("POST", "/api/auth/refresh"), 200)
            continue
        expect_status(r, 201)
        if r.headers.get("idempotent-replay") != "true":
            assert time.monotonic() - stored_at >= SHORT_IDEMPOTENCY_TTL_S - 1, "the key expired early"
            break
        pace()
    else:
        pytest.fail("the same Idempotency-Key kept replaying past IDEMPOTENCY_KEY_TTL_SECONDS; expected it to be treated as new")
    assert len(of_kind(thread_body(short, tid3), "reply")) == 2


def test_wf_developer_reply_close_landing(browser, app_url):
    wren = Staff(app_url, WREN)
    tag = fresh("q")
    threads = {}
    for name in ("a", "b", "c"):
        player, tid, _ = open_thread(app_url, "bug", f"answered {name}", pid=f"{tag}{name}")
        expect_status(reply(wren, tid), 201)
        threads[name] = (player.pid, tid)
    query = {"status": ["answered"], "q": [tag]}
    with staff_page(browser, app_url, WREN, f"/inbox/{threads['b'][1]}?status=answered&q={tag}") as page:
        open_thread_page(page, threads["b"][0])
        ui_wait(page, lambda: thread_rows(page).count() == 3, "three answered rows load")
        click(page.get_by_role("button", name="Close thread"))
        for closed, landing in (("b", "a"), ("a", "b")):
            pid, tid = threads[landing]
            ui_wait(page, lambda: urlparse(page.url).path == f"/inbox/{tid}" and parse_qs(urlparse(page.url).query) == query,
                    f"closing {closed} opens {landing} with the query kept")
            ui_wait(page, lambda: focused(heading(page, pid)) and row(page, pid).get_attribute("aria-current") == "page",
                    f"{landing}'s heading has focus and its row is current")
            assert "closed" in text_of(row(page, threads[closed][0]))
            if closed == "b":
                click(page.get_by_role("button", name="Close thread"))
        click(page.get_by_role("button", name="Sign out"))
        ui_wait(page, lambda: urlparse(page.url).path == "/signin" and
                text_of(region(page, "Sign-in announcements")) == "You're signed out.", "sign-out lands on /signin")
    assert thread_body(wren, threads["a"][1])["status"] == "closed" and thread_body(wren, threads["b"][1])["status"] == "closed"
    assert thread_body(wren, threads["c"][1])["status"] == "answered"


def test_wf_developer_reply_close_expired_session(browser):
    base = os.environ["APP_SHORT_TIMERS_URL"]
    tag = fresh("q")
    player, tid, _ = open_thread(base, "bug", "first words", pid=f"{tag}a")
    path = f"/inbox/{tid}?q={tag}"
    with staff_page(browser, base, WREN, path) as page:
        refreshes: list[str] = []
        page.on("request", lambda req: refreshes.append(req.url) if req.method == "POST" and urlparse(req.url).path == "/api/auth/refresh" else None)
        open_thread_page(page, player.pid)

        def access_expired() -> bool:
            jar = {c["name"]: c["value"] for c in page.context.cookies()}
            if "hl_access" not in jar:
                return True
            return httpx.get(base + "/api/auth/session", headers={"Cookie": f"hl_access={jar['hl_access']}"}, timeout=HTTP_TIMEOUT_S).status_code == 401
        wait_until(access_expired, "the browser's access token expires", SHORT_ACCESS_TTL_S + 2 * SLACK_S)
        text = "Thanks, I can reproduce it."
        fill(page.get_by_role("textbox", name="Reply"), text)
        click(page.get_by_role("button", name="Send reply"))
        ui_wait(page, lambda: [r["body"] for r in of_kind(thread_body(Staff(base, WREN), tid), "reply")] == [text], "the reply is stored once")
        rotated_at = time.monotonic()
        assert len(refreshes) == 1, f"expected exactly one refresh, saw {len(refreshes)}"
        assert urlparse(page.url).path == f"/inbox/{tid}" and page.get_by_text("Reply not sent. Try again.").count() == 0
        draft = "Open Settings, then Profile, and edit the name field."
        fill(page.get_by_role("textbox", name="Reply"), draft)
        sent = False
        deadline = rotated_at + SHORT_FAMILY_TTL_S + TTL_SLACK_S
        while time.monotonic() < deadline and urlparse(page.url).path != "/signin":
            advance(page, STEP_MS)
            if not sent and time.monotonic() - rotated_at > SHORT_FAMILY_TTL_S + LIVE_S:
                click(page.get_by_role("button", name="Send reply"))
                sent = True
        assert urlparse(page.url).path == "/signin", "an ended session lands on /signin"
        ui_wait(page, lambda: text_of(region(page, "Sign-in announcements")) == "Your session ended. Sign in again.", "session-ended copy")
        fill(page.get_by_role("textbox", name="Email"), WREN[0])
        fill(page.get_by_label("Password", exact=True), WREN[1])
        click(page.get_by_role("button", name="Sign in"))
        ui_wait(page, lambda: urlparse(page.url).path == f"/inbox/{tid}" and parse_qs(urlparse(page.url).query) == {"q": [tag]},
                "sign-in returns to the same thread URL")
        ui_wait(page, lambda: page.get_by_role("textbox", name="Reply").input_value() == draft, "the unsent draft is restored")
    assert [r["body"] for r in of_kind(thread_body(Staff(base, WREN), tid), "reply")] == [text], "the draft was not sent"


def _stub_receipts(wiremock: Any, pid: str, receipts: list[dict[str, Any]], **kw: Any) -> str:
    path = f"/v1/games/{GLOAM}/players/{pid}/receipts"
    wiremock.stub("GET", path, json={"player_id": pid, "receipts": receipts}, headers={"Content-Type": "application/json"}, **kw)
    return path


def _receipt(rid: str, item: str = "Lantern Pack", amount: int = 499, currency: str = "USD", status: str = "paid") -> dict[str, Any]:
    return {"receipt_id": rid, "item": item, "amount_minor": amount, "currency": currency, "purchased_at": "2026-11-02T18:04:00Z", "status": status}


def test_wf_receipt_lookup_record(browser, app_url, wiremock):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    rid = fresh("r")
    accepted(app_url, receipt_event(app_url, player.pid, rid))
    path = _stub_receipts(wiremock, player.pid, [_receipt(rid)])
    with staff_page(browser, app_url, WREN) as page:
        with ctx(held(page, "**/receipt-lookup")) as hold:
            page.goto(f"{app_url}/inbox/{tid}")
            ui_wait(page, lambda: text_of(region(page, "Game server")) == "Asking the game server...", "lookup pending copy")
            hold.release()
        record = page.get_by_role("region", name="Game server record")
        ui_wait(page, lambda: all(w in text_of(record) for w in (rid, "Lantern Pack", "4.99 USD", "paid")), "the record lists the receipt")
        item = page.get_by_role("list", name="Purchases").get_by_role("listitem").filter(has_text=rid).first
        ui_wait(page, lambda: "on the game server" in text_of(item) and "not on" not in text_of(item), "comparison words shown")
        page.reload()
        ui_wait(page, lambda: rid in text_of(page.get_by_role("region", name="Game server record")), "the record returns after reload")
    calls = wiremock.requests(path)
    assert len(calls) >= 2, "each opening asks the game server afresh"
    assert all("application/json" in jsonlib.dumps(c) for c in calls)
    body = expect_status(wren.get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
    assert body["available"] is True and body["purchases"] == [{"receipt_id": rid, "on_game_server": True, "differences": []}]
    assert body["receipts"][0]["receipt_id"] == rid and body["receipts"][0]["amount_minor"] == 499


def test_wf_receipt_lookup_outage_recovery(browser, app_url, wiremock):
    down = os.environ["APP_WIREMOCK_DOWN_URL"]
    player, tid, _ = open_thread(app_url, "purchase")
    rid = fresh("r")
    accepted(app_url, receipt_event(app_url, player.pid, rid))
    with staff_page(browser, down, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        ui_wait(page, lambda: text_of(region(page, "Game server")) == OUTAGE_COPY, "outage copy on the down instance")
        item = page.get_by_role("list", name="Purchases").get_by_role("listitem").filter(has_text=rid).first
        assert "paid" in text_of(item) and "game server" not in text_of(item)
        fill(page.get_by_role("textbox", name="Reply"), "Thanks, I can reproduce it.")
        click(page.get_by_role("button", name="Send reply"))
        ui_wait(page, lambda: thread_body(Staff(app_url, WREN), tid)["status"] == "answered", "the reply still works during the outage")
    outage = expect_status(Staff(down, WREN).get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
    assert outage == {"available": False, "receipts": [], "purchases": [{"receipt_id": rid, "on_game_server": None, "differences": []}]}
    path = f"/v1/games/{GLOAM}/players/{player.pid}/receipts"
    wiremock.fault("GET", path)
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        ui_wait(page, lambda: text_of(region(page, "Game server")) == OUTAGE_COPY, "outage copy while the lookup fails")
        _stub_receipts(wiremock, player.pid, [_receipt(rid)])
        click(page.get_by_role("button", name="Look up receipts again"))
        ui_wait(page, lambda: rid in text_of(page.get_by_role("region", name="Game server record")), "the retried lookup fills the record")
        assert OUTAGE_COPY not in text_of(region(page, "Game server"))
    _stub_receipts(wiremock, player.pid, [_receipt(rid)], delay_ms=LOOKUP_LIMIT_MS + 1500)
    assert expect_status(Staff(app_url, WREN).get(f"/api/threads/{tid}/receipt-lookup"), 200).json()["available"] is False


def test_wf_receipt_lookup_late_answer(browser, app_url, wiremock):
    tag = fresh("q")
    pa, ta, _ = open_thread(app_url, "purchase", "first", pid=f"{tag}a")
    pb, tb, _ = open_thread(app_url, "purchase", "second", pid=f"{tag}b")
    rid = fresh("r")
    accepted(app_url, receipt_event(app_url, pa.pid, rid))
    _stub_receipts(wiremock, pa.pid, [_receipt(rid)], delay_ms=LATE_LOOKUP_MS)
    with staff_page(browser, app_url, WREN, f"/inbox?q={tag}") as page:
        ui_wait(page, lambda: thread_rows(page).count() == 2, "two rows load")
        click(row(page, pa.pid))
        open_thread_page(page, pa.pid)
        opened_at = time.monotonic()
        page.get_by_role("button", name="Close thread").focus()
        page.keyboard.press("n")
        open_thread_page(page, pb.pid)
        ui_wait(page, lambda: text_of(region(page, "Game server")) == NO_RECEIPTS_COPY, "the new thread shows its own lookup")
        ui_wait(page, lambda: time.monotonic() - opened_at > LATE_LOOKUP_MS / 1000 + SLACK_S, "the late answer has arrived")
        assert rid not in text_of(page.get_by_role("region", name="Game server record"))
        assert text_of(region(page, "Game server")) == NO_RECEIPTS_COPY
        page.goto(f"{app_url}/inbox")
        search = page.get_by_role("searchbox", name="Search threads")
        with ctx(held(page, f"**/api/inbox?*{pa.pid}*")) as hold:
            fill(search, pa.pid)
            advance(page, SEARCH_SETTLE_MS + STEP_MS)
            fill(search, pb.pid)
            ui_wait(page, lambda: thread_rows(page).count() == 1 and row(page, pb.pid).count() == 1, "rows follow the latest query")
            hold.release()
        advance(page, SEARCH_SETTLE_MS)
        ui_wait(page, lambda: row(page, pb.pid).count() == 1 and row(page, pa.pid).count() == 0, "the late answer is discarded")


def test_purchases_compared_with_game_server(browser, app_url, wiremock):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    same, diff, missing, money = (fresh("r") for _ in range(4))
    accepted(app_url, receipt_event(app_url, player.pid, same))
    accepted(app_url, receipt_event(app_url, player.pid, diff, 1200, "JPY", "Ember Lantern Bundle"))
    accepted(app_url, refund_event(app_url, player.pid, fresh("f"), diff, 400, "JPY"))
    accepted(app_url, receipt_event(app_url, player.pid, missing))
    accepted(app_url, receipt_event(app_url, player.pid, money, 499, "EUR"))
    _stub_receipts(wiremock, player.pid, [_receipt(same), _receipt(diff, "Lantern Pack", OVER_AMOUNT, "JPY", "paid"), _receipt(money)])
    body = expect_status(wren.get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
    assert [p["receipt_id"] for p in body["purchases"]] == [p["receipt_id"] for p in thread_body(wren, tid)["purchases"]]
    found = {p["receipt_id"]: (p["on_game_server"], p["differences"]) for p in body["purchases"]}
    assert found == {same: (True, []), diff: (True, ["item", "amount", "status"]), missing: (False, []), money: (True, ["currency"])}
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        items = page.get_by_role("list", name="Purchases").get_by_role("listitem")
        expected = {diff: "on the game server, differs: item, amount, status", missing: "not on the game server",
                    money: "on the game server, differs: currency"}
        for rid, words in expected.items():
            ui_wait(page, lambda: words in text_of(items.filter(has_text=rid).first), f"{rid} reads {words}")
        assert "differs" not in text_of(items.filter(has_text=same).first) and "on the game server" in text_of(items.filter(has_text=same).first)


def test_wf_moderator_grants_team_screen(browser, app_url):
    wren, juno = Staff(app_url, WREN), Staff(app_url, JUNO)
    mod = juno_id(wren)
    _, tid, _ = open_thread(app_url, "bug")
    expect_status(juno.get("/api/team"), 403, "forbidden")
    bad = wren.call("POST", f"/api/team/{mod}/rules", json={"effect": "maybe", "action": "fly", "topic": "everything"})
    fields = field_error(bad, "effect") and bad.json()["error"]["fields"]
    assert fields == {"effect": "Choose grant or deny.", "action": "Choose read, reply, close or receipts.",
                      "topic": "Choose bug, account, purchase, other or all topics."}
    def rule_count() -> int:
        return sum(len(m["rules"]) for m in wren.get("/api/team").json()["moderators"] if m["id"] == mod)
    before_rules = rule_count()
    forged = {"effect": "deny", "action": "reply", "topic": "bug"}
    expect_status(wren.call("POST", f"/api/team/{mod}/rules", json=forged, change=False), 403, "change_refused")
    expect_status(wren.call("POST", f"/api/team/{mod}/rules", json=forged, headers={"Origin": "https://evil.example"}),
                  403, "change_refused")
    assert rule_count() == before_rules, "a refused rule change stored a rule"
    try:
        with staff_page(browser, app_url, WREN, "/team") as page:
            ui_wait(page, page.get_by_role("heading", level=1, name="Team", exact=True).is_visible, "Team heading")
            rules = page.get_by_role("region", name=JUNO_NAME).get_by_role("list", name="Rules")
            assert "deny receipts on all topics" in text_of(rules) and "deny read on purchase threads" in text_of(rules)
            select(page.get_by_role("combobox", name="Effect"), "deny")
            select(page.get_by_role("combobox", name="Action"), "reply")
            select(page.get_by_role("combobox", name="Topic"), "bug")
            click(page.get_by_role("button", name="Add rule"))
            ui_wait(page, lambda: text_of(region(page, "Team announcements")) == "Rule added.", "Rule added. is announced")
            ui_wait(page, lambda: "deny reply on bug threads" in text_of(rules), "the rule is listed")
            expect_status(reply(juno, tid), 403, "forbidden")
            expect_status(juno.get(f"/api/threads/{tid}"), 200)
            click(page.get_by_role("button", name="Revoke " + "deny reply on bug threads"))
            ui_wait(page, lambda: text_of(region(page, "Team announcements")) == "Rule revoked.", "Rule revoked. is announced")
            expect_status(reply(juno, tid), 201)
    finally:
        for m in wren.get("/api/team").json()["moderators"]:
            for rl in m["rules"]:
                if m["id"] == mod and (rl["effect"], rl["action"], rl["topic"]) == ("deny", "reply", "bug"):
                    revoke_rule(wren, mod, rl["id"])


def test_deny_overrides_every_surface(app_url):
    wren, juno = Staff(app_url, WREN), Staff(app_url, JUNO)
    tag = fresh("q")
    bp, bt, bm = open_thread(app_url, "bug", "bug words", pid=f"{tag}b")
    pp, pt, pm = open_thread(app_url, "purchase", "purchase words", pid=f"{tag}p")
    aid_b = expect_status(bp.upload(bm["id"], TEXT_BYTES, "text/plain"), 202).json()["attachment"]["id"]
    aid_p = expect_status(pp.upload(pm["id"], TEXT_BYTES, "text/plain"), 202).json()["attachment"]["id"]
    wait_attachment(bp, aid_b)
    wait_attachment(pp, aid_p)
    rid = fresh("r")
    receipt_id = accepted(app_url, receipt_event(app_url, bp.pid, rid))
    refund_id = accepted(app_url, refund_event(app_url, bp.pid, fresh("f"), rid, 100, "USD"))
    match_id = accepted(app_url, match_event(app_url, bp.pid, fresh("m")))
    seen = thread_body(juno, bt)
    types = [m["event"]["type"] for m in seen["messages"] if m["kind"] == "event"]
    assert "match.finished" in types and "purchase.receipt" not in types and "purchase.refunded" not in types
    assert seen["purchases"] == []
    for mid in (receipt_id, refund_id):
        expect_status(juno.get(f"/api/messages/{mid}/forensics"), 404)
    expect_status(juno.get(f"/api/messages/{match_id}/forensics"), 200)
    expect_status(juno.get(f"/api/threads/{bt}/receipt-lookup"), 403, "forbidden")
    expect_status(juno.get(f"/api/attachments/{aid_b}"), 200)
    assert bt not in [t["id"] for t in inbox_ok(juno, q=rid)["threads"]]
    assert bt in [t["id"] for t in inbox_ok(wren, q=rid)["threads"]]
    unknown = fresh("x")
    for path in (f"/api/threads/{{}}", f"/api/threads/{{}}/receipt-lookup"):
        a, b = juno.get(path.format(pt)), juno.get(path.format(unknown))
        expect_status(a, 404)
        assert a.json() == expect_status(b, 404).json()
    for path in (f"/api/messages/{pm['id']}/forensics", f"/api/attachments/{aid_p}", f"/api/attachments/{aid_p}/content"):
        expect_status(juno.get(path), 404)
    expect_status(reply(juno, pt), 404)
    expect_status(close(juno, pt), 404)
    assert inbox_ok(juno, q=tag)["counts"]["waiting"] == 1 and inbox_ok(wren, q=tag)["counts"]["waiting"] == 2
    assert inbox_ok(juno, q=pp.pid)["threads"] == []
    juno_stream, wren_stream = staff_stream(juno), staff_stream(wren)
    juno_at, wren_at = len(juno_stream.snapshot()), len(wren_stream.snapshot())
    try:
        rid2 = fresh("r")
        accepted(app_url, receipt_event(app_url, bp.pid, rid2))
        expect_status(pp.send("more purchase words"), 201)
        expect_status(bp.send("more bug words"), 201)
        wait_until(lambda: frames_after(juno_stream, juno_at), "Juno's stream carries an update for the readable thread", LIVE_S + SLACK_S)
        wait_until(lambda: frames_after(wren_stream, wren_at), "Wren's stream carries an update for the purchase thread", LIVE_S + SLACK_S)
        text = juno_stream.snapshot()
        assert pp.pid not in text and pt not in text and rid2 not in text, "a denied thread or receipt reached Juno's stream"
    finally:
        juno_stream.close()
        wren_stream.close()


def test_wf_moderator_grants_live_deny(browser, app_url):
    wren = Staff(app_url, WREN)
    mod = juno_id(wren)
    tag = fresh("q")
    tp, tt, _ = open_thread(app_url, "bug", "bug words", pid=f"{tag}t")
    up, ut, _ = open_thread(app_url, "account", "account words", pid=f"{tag}u")
    stream = staff_stream(Staff(app_url, JUNO))
    rule = None
    try:
        with staff_page(browser, app_url, JUNO, f"/inbox/{tt}?q={tag}") as page:
            open_thread_page(page, tp.pid)
            ui_wait(page, lambda: thread_rows(page).count() == 2 and tab_count(page, "Waiting") == 2, "both rows load")
            rule = add_rule(wren, mod, "deny", "read", "bug")
            changed_at = time.monotonic()
            ui_wait(page, lambda: urlparse(page.url).path == "/inbox" and parse_qs(urlparse(page.url).query) == {"q": [tag]}
                    and text_of(region(page, "Inbox announcements")) == "That thread is no longer available."
                    and row(page, tp.pid).count() == 0 and tab_count(page, "Waiting") == 1,
                    "the hidden thread leaves the open workspace", seconds=LIVE_S + SLACK_S)
            ui_wait(page, lambda: time.monotonic() - changed_at > LIVE_S, "the two-second window has passed")
            offset = len(stream.snapshot())
            hidden = fresh("w")
            expect_status(tp.send(hidden), 201)
            expect_status(up.send("visible words"), 201)
            wait_until(lambda: frames_after(stream, offset), "Juno's stream carries an update for the readable thread", LIVE_S + SLACK_S)
            later = stream.snapshot()[offset:]
            assert tp.pid not in later and tt not in later and hidden not in later
            expect_status(revoke_rule(wren, mod, rule), 204)
            rule = None
            ui_wait(page, lambda: row(page, tp.pid).count() == 1, "the row returns after the revoke", seconds=LIVE_S + SLACK_S)
    finally:
        stream.close()
        if rule:
            revoke_rule(wren, mod, rule)


def test_wf_keyboard_inbox_shortcuts(browser, app_url):
    wren = Staff(app_url, WREN)
    tag = fresh("q")
    pa, ta, _ = open_thread(app_url, "bug", "first words from a", pid=f"{tag}a")
    expect_status(pa.send("second words from a"), 201)
    pb, tb, _ = open_thread(app_url, "bug", "words from b", pid=f"{tag}b")
    with staff_page(browser, app_url, WREN, f"/inbox?q={tag}") as page:
        ui_wait(page, lambda: thread_rows(page).count() == 2, "rows load")
        click(row(page, pa.pid))
        open_thread_page(page, pa.pid)
        page.get_by_role("button", name="Close thread").focus()
        page.keyboard.press("n")
        ui_wait(page, lambda: urlparse(page.url).path == f"/inbox/{tb}" and parse_qs(urlparse(page.url).query) == {"q": [tag]}, "N opens the next row")
        page.get_by_role("button", name="Sign out").focus()
        page.keyboard.press("p")
        ui_wait(page, lambda: urlparse(page.url).path == f"/inbox/{ta}", "P opens the previous row")
        first, second = message_item(page, "first words from a"), message_item(page, "second words from a")
        row(page, pa.pid).focus()
        page.keyboard.press("j")
        ui_wait(page, lambda: first.get_attribute("aria-current") == "true" and focused(first), "J selects and focuses the first message")
        ui_wait(page, lambda: "signature valid" in text_of(check_lines(tamperglass(page)).nth(0)), "Tamperglass follows the selection")
        page.keyboard.press("j")
        ui_wait(page, lambda: second.get_attribute("aria-current") == "true", "J steps to the next message")
        page.keyboard.press("k")
        ui_wait(page, lambda: first.get_attribute("aria-current") == "true", "K steps back")
        page.keyboard.press("r")
        box = page.get_by_role("textbox", name="Reply")
        ui_wait(page, lambda: focused(box), "R focuses the reply field")
        page.keyboard.press("j")
        assert box.input_value() == "j" and first.get_attribute("aria-current") == "true", "keys type text inside the reply field"
        first.focus()
        with page.expect_response(lambda r: urlparse(r.url).path == f"/api/threads/{ta}/close") as closing:
            page.keyboard.press("c")
        assert closing.value.status == 409 and urlparse(page.url).path == f"/inbox/{ta}"
        first.focus()
        page.keyboard.press("t")
        lines = check_lines(tamperglass(page))
        ui_wait(page, lambda: focused(lines.nth(0)), "T focuses the first Tamperglass line")
        page.keyboard.press("ArrowDown")
        ui_wait(page, lambda: focused(lines.nth(1)), "Down moves to the next line")
    assert thread_body(wren, ta)["status"] == "waiting"
    with staff_page(browser, app_url, WREN, f"/inbox/{ta}?q={tag}", viewport=TABLET) as page:
        open_thread_page(page, pa.pid)
        url = page.url
        opener = page.get_by_role("button", name="Threads", exact=True)
        click(opener)
        drawer = page.get_by_role("dialog", name="Threads")
        ui_wait(page, lambda: drawer.is_visible() and focused(drawer), "the drawer opens with focus inside")
        for key in "njkprct":
            page.keyboard.press(key)
            advance(page, STEP_MS)
            assert page.url == url and focused(drawer), f"{key} acted while the drawer was open"
        for _ in range(TAB_PRESSES):
            page.keyboard.press("Tab")
            assert focused(drawer), "Tab left the open drawer"
        page.keyboard.press("Escape")
        ui_wait(page, lambda: page.get_by_role("dialog", name="Threads").count() == 0 and focused(opener), "Escape closes and refocuses the opener")


def test_wf_keyboard_inbox_breakpoints(browser, app_url):
    player, tid, _ = open_thread(app_url)
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        listing, head, pane = page.get_by_role("list", name="Threads"), heading(page, player.pid), tamperglass(page)
        ui_wait(page, lambda: listing.is_visible() and pane.is_visible(), "three panes at 1280")
        lb, hb, pb = listing.bounding_box(), head.bounding_box(), pane.bounding_box()
        assert lb["x"] < hb["x"] < pb["x"], (lb, hb, pb)
        assert abs(hb["x"] - EDGE_FRACTION * DESKTOP["width"]) <= EDGE_TOL_PX, hb
        layout(page)
        page.set_viewport_size(TABLET)
        ui_wait(page, lambda: page.get_by_role("button", name="Threads", exact=True).is_visible() and listing.count() == 0
                and pane.is_visible(), "thread plus Tamperglass at 768")
        hb, pb = head.bounding_box(), pane.bounding_box()
        assert abs(hb["x"] - TABLET_EDGE_PX) <= EDGE_TOL_PX
        assert abs(pb["x"] - (2 * TABLET_EDGE_PX + TABLET_COLUMN_PX)) <= EDGE_TOL_PX
        assert abs(pb["x"] + pb["width"] - (TABLET["width"] - TABLET_EDGE_PX)) <= EDGE_TOL_PX
        layout(page)
        page.set_viewport_size(PHONE)
        ui_wait(page, lambda: page.get_by_role("button", name="Open Tamperglass").is_visible() and pane.count() == 0
                and page.get_by_role("dialog", name="Tamperglass").count() == 0, "the thread alone at 375")
        assert abs(head.bounding_box()["x"] - PHONE_EDGE_PX) <= EDGE_TOL_PX
        layout(page)


def test_wf_keyboard_inbox_closed_overlays_inert(browser, app_url):
    player, tid, _ = open_thread(app_url)
    for viewport in (PHONE, TABLET):
        with staff_page(browser, app_url, WREN, f"/inbox/{tid}", viewport=viewport) as page:
            open_thread_page(page, player.pid)

            def assert_closed() -> None:
                ui_wait(page, lambda: page.get_by_role("dialog", name="Threads").count() == 0
                        and page.get_by_role("dialog", name="Tamperglass").count() == 0, "overlays closed")
                names = tab_order(page, TAB_PRESSES)
                assert "Close threads" not in names and "Close Tamperglass" not in names, names
                reached = []
                for _ in range(TAB_PRESSES):
                    page.keyboard.press("Tab")
                    reached.append(any(focused(r) for r in thread_rows(page).all()))
                assert not any(reached), "a thread row in the closed drawer took focus"
                layout(page)

            assert_closed()
            opener = page.get_by_role("button", name="Threads", exact=True)
            click(opener)
            ui_wait(page, lambda: page.get_by_role("dialog", name="Threads").is_visible(), "drawer opens")
            page.keyboard.press("Escape")
            ui_wait(page, lambda: focused(opener), "focus returns to Threads")
            assert_closed()
            if viewport is PHONE:
                sheet_opener = page.get_by_role("button", name="Open Tamperglass")
                click(sheet_opener)
                sheet = page.get_by_role("dialog", name="Tamperglass")
                ui_wait(page, lambda: sheet.is_visible() and focused(sheet), "sheet opens with focus inside")
                click(page.get_by_role("button", name="Close Tamperglass"))
                ui_wait(page, lambda: focused(sheet_opener), "focus returns to Open Tamperglass")
                assert_closed()
                click(sheet_opener)
                ui_wait(page, sheet.is_visible, "sheet reopens")
                page.keyboard.press("Escape")
                page.keyboard.press("T")
                advance(page, 1000)
                assert page.get_by_role("dialog", name="Tamperglass").is_visible(), "a close under way never hides a reopened sheet"


def test_wf_tamperglass_motion_stream_lines(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, m1 = open_thread(app_url, "bug", "hello there")
    m2 = expect_status(player.send("and again"), 201).json()["message"]
    expect_status(reply(wren, tid, "Open Settings, then Profile."), 201)
    f1, f2 = forensics_settled(wren, m1["id"]), forensics_settled(wren, m2["id"])
    v1, v2 = [e["verdict"] for e in f1["lines"]], [e["verdict"] for e in f2["lines"]]
    assert v1 != v2
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        pane = tamperglass(page)
        ui_wait(page, lambda: "Select a message to see what was checked." in text_of(pane), "no selection copy")
        with ctx(held(page, f"**/api/messages/{m1['id']}/forensics/stream*")) as hold:
            click(message_item(page, "hello there"))
            ui_wait(page, lambda: lines_checking(pane), "all four lines read checking")
            hold.release()
        ui_wait(page, lambda: lines_show(page, pane, v1), "lines settle to the stored forensics")
        assert meter_value(page) == str(line(f1, "bucket")["level"])
        with ctx(held(page, f"**/api/messages/{m1['id']}/forensics/stream*")) as hold:
            click(message_item(page, "and again"))
            click(message_item(page, "hello there"))
            click(message_item(page, "and again"))
            ui_wait(page, lambda: lines_show(page, pane, v2), "the latest selection settles")
            hold.release()
            advance(page, 1000)
            assert lines_show(page, pane, v2), "the earlier stream wrote into the lines"
            assert meter_value(page) == str(line(f2, "bucket")["level"])
        click(message_item(page, "Open Settings, then Profile."))
        ui_wait(page, lambda: "Replies are not checked." in text_of(pane), "replies are not checked")


def test_tamperglass_settle_and_fill_motion(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, msg = open_thread(app_url, "bug", "hello there")
    verdicts = [e["verdict"] for e in forensics_settled(wren, msg["id"])["lines"]]
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        page.evaluate(MOTION_RECORDER)
        click(message_item(page, "hello there"))
        pane = tamperglass(page)
        ui_wait(page, lambda: lines_show(page, pane, verdicts), "lines settle")
        lines = check_lines(pane)
        settle = lines.nth(0).evaluate(MOTION_IN)
        assert settle and 0 < max(settle) < QUARTER_MS, f"settle durations {settle}"
        fill_moves = lines.nth(1).evaluate(MOTION_IN) + page.get_by_role("meter", name="Token bucket").evaluate(MOTION_IN)
        assert fill_moves and SIXTH_MS <= max(fill_moves) <= 2 * QUARTER_MS, f"fill durations {fill_moves}"
        assert "7 of 8" in text_of(lines.nth(1))
        assert not page.evaluate(MOTION_LOOPING), "a looping animation is running"


def test_wf_tamperglass_motion_reduced(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, msg = open_thread(app_url, "bug", "hello there")
    f = forensics_settled(wren, msg["id"])
    verdicts = [e["verdict"] for e in f["lines"]]
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}", reduced_motion="reduce") as page:
        open_thread_page(page, player.pid)
        page.evaluate(MOTION_RECORDER)
        click(message_item(page, "hello there"))
        pane = tamperglass(page)
        ui_wait(page, lambda: lines_show(page, pane, verdicts), "lines settle")
        assert meter_value(page) == str(line(f, "bucket")["level"])
        moved = page.get_by_role("list", name="Checks").evaluate(MOTION_IN)
        assert all(d <= INSTANT_MS for d in moved), f"transitions under reduced motion: {moved}"
        ui_wait(page, lambda: text_of(region(page, "Verdicts")) == sentence(f), "the announcement is unchanged")
        page.set_viewport_size(PHONE)
        page.evaluate(MOTION_RECORDER)
        click(page.get_by_role("button", name="Open Tamperglass"))
        sheet = page.get_by_role("dialog", name="Tamperglass")
        ui_wait(page, sheet.is_visible, "sheet opens")
        sheet_box = sheet.bounding_box()
        advance(page, QUARTER_MS)
        assert sheet.bounding_box() == sheet_box, "the sheet slid"
        page.keyboard.press("Escape")
        ui_wait(page, lambda: page.get_by_role("dialog", name="Tamperglass").count() == 0, "the sheet closes")
        click(page.get_by_role("button", name="Threads", exact=True))
        drawer = page.get_by_role("dialog", name="Threads")
        ui_wait(page, drawer.is_visible, "drawer opens")
        drawer_box = drawer.bounding_box()
        advance(page, QUARTER_MS)
        assert drawer.bounding_box() == drawer_box, "the drawer slid"


def test_wf_tamperglass_motion_announced(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, m1 = open_thread(app_url, "bug", "first words")
    m2 = expect_status(player.send("second words"), 201).json()["message"]
    f1, f2 = forensics_settled(wren, m1["id"]), forensics_settled(wren, m2["id"])
    assert sentence(f1) == "Checked: signature valid; 7 of 8; nothing removed; no link."
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        verdict = region(page, "Verdicts")
        click(message_item(page, "first words"))
        ui_wait(page, lambda: text_of(verdict) == sentence(f1), "the settled sentence is announced")
        with ctx(held(page, f"**/api/messages/{m2['id']}/forensics/stream*")) as hold:
            click(message_item(page, "second words"))
            ui_wait(page, lambda: lines_checking(tamperglass(page)), "second selection checking")
            assert text_of(verdict) == sentence(f1), "nothing announced before the lines settle"
            hold.release()
        ui_wait(page, lambda: text_of(verdict) == sentence(f2), "the second sentence is announced")
        with ctx(held(page, f"**/api/messages/{m1['id']}/forensics/stream*")) as hold:
            click(message_item(page, "first words"))
            click(message_item(page, "second words"))
            ui_wait(page, lambda: lines_show(page, tamperglass(page), [e["verdict"] for e in f2["lines"]]), "latest selection settles")
            hold.release()
            advance(page, 1000)
        assert text_of(verdict) == sentence(f2), "the abandoned selection was announced"


def test_streams_hold_no_connection_each(app_url):
    wren = Staff(app_url, WREN)
    pg = Postgres()
    count_sql = "select count(*)::int as n from pg_stat_activity where application_name = 'hushline'"
    busy_sql = count_sql + " and state in ('active', 'idle in transaction', 'idle in transaction (aborted)')"
    readers = [staff_stream(wren) for _ in range(STREAM_COUNT)]
    try:
        assert 1 <= pg.rows(count_sql)[0]["n"] <= PG_MAX_CONNECTIONS
        player = Player(app_url)
        offsets = [len(r.snapshot()) for r in readers]
        started = time.monotonic()
        sent = player.send("i never got the lantern pack")
        assert time.monotonic() - started <= LIVE_S, "the send answered within two seconds"
        expect_status(sent, 201)
        tid = sent.json()["thread"]["id"]
        wait_until(lambda: all(frames_after(r, o) for r, o in zip(readers, offsets)),
                   "the live update reaches all 60 streams within two seconds", started + LIVE_S + SLACK_S - time.monotonic())
        assert pg.rows(count_sql)[0]["n"] <= PG_MAX_CONNECTIONS
    finally:
        for r in readers:
            r.close()
    for _ in range(STREAM_ABORTS):
        staff_stream(wren).close()
    wait_until(lambda: pg.rows(busy_sql)[0]["n"] == 0, "no hushline session stays active or idle in transaction after streams close",
               STOP_WORK_S + SLACK_S)
    expect_status(httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S), 200)
    expect_status(inbox(wren), 200)


def test_wf_developer_triage_url_state(browser, app_url):
    wren = Staff(app_url, WREN)
    tag = fresh("q")
    pa, _, _ = open_thread(app_url, "bug", "waiting words", pid=f"{tag}a")
    pb, tb, _ = open_thread(app_url, "bug", "answered words", pid=f"{tag}b")
    expect_status(reply(wren, tb), 201)
    search_value = lambda page: page.get_by_role("searchbox", name="Search threads").input_value()
    with staff_page(browser, app_url, WREN) as page:
        click(page.get_by_role("tab", name=re.compile(r"^Answered \d+$")))
        ui_wait(page, lambda: parse_qs(urlparse(page.url).query).get("status") == ["answered"], "the tab enters the URL")
        fill(page.get_by_role("searchbox", name="Search threads"), tag)
        ui_wait(page, lambda: urlparse(page.url).query == urlencode({"status": "answered", "q": tag}), "search follows status in the URL")
        ui_wait(page, lambda: thread_rows(page).count() == 1 and row(page, pb.pid).count() == 1, "rows match")
        page.reload()
        answered = page.get_by_role("tab", name=re.compile(r"^Answered \d+$"))
        ui_wait(page, lambda: answered.get_attribute("aria-selected") == "true" and search_value(page) == tag
                and row(page, pb.pid).count() == 1, "reload restores tab, search and rows")
        page.go_back()
        ui_wait(page, lambda: urlparse(page.url).query == "" and search_value(page) == ""
                and page.get_by_role("tab", name=re.compile(r"^Waiting \d+$")).get_attribute("aria-selected") == "true", "Back restores Waiting")
        page.go_forward()
        ui_wait(page, lambda: search_value(page) == tag and row(page, pb.pid).count() == 1, "Forward restores the search")
    with staff_page(browser, app_url, WREN, f"/inbox?status=answered&q={tag}") as page:
        ui_wait(page, lambda: search_value(page) == tag and row(page, pb.pid).count() == 1 and row(page, pa.pid).count() == 0, "a shared link shows the same rows")
        page.goto(f"{app_url}/inbox?status=bogus&q={tag}")
        ui_wait(page, lambda: "status" not in parse_qs(urlparse(page.url).query) and row(page, pa.pid).count() == 1, "unknown status falls back to Waiting")


def test_wf_developer_triage_live_rows(browser, app_url):
    wren = Staff(app_url, WREN)
    tag = fresh("q")
    pa, _, _ = open_thread(app_url, "bug", "a words", pid=f"{tag}a")
    pb, _, _ = open_thread(app_url, "bug", "b words", pid=f"{tag}b")
    pd, td, _ = open_thread(app_url, "bug", "d words", pid=f"{tag}d")
    expect_status(reply(wren, td), 201)
    with staff_page(browser, app_url, WREN, f"/inbox?q={tag}") as page:
        ui_wait(page, lambda: thread_rows(page).count() == 2 and tab_count(page, "Waiting") == 2 and tab_count(page, "Answered") == 1, "initial rows")
        row(page, pb.pid).focus()
        pc = Player(app_url, f"{tag}c")
        expect_status(pc.send("c words"), 201)
        ui_wait(page, lambda: row(page, pc.pid).count() == 1 and tab_count(page, "Waiting") == 3, "the new thread appears", seconds=LIVE_S + SLACK_S)
        ui_wait(page, lambda: text_of(region(page, "Inbox announcements")) == f"{pc.pid} is waiting.", "arrival is announced")
        expect_status(pd.send("d is back"), 201)
        ui_wait(page, lambda: row(page, pd.pid).count() == 1 and tab_count(page, "Waiting") == 4 and tab_count(page, "Answered") == 0,
                "the answered thread re-enters Waiting", seconds=LIVE_S + SLACK_S)
        expect_status(pa.send("a newer first line"), 201)
        ui_wait(page, lambda: "a newer first line" in text_of(row(page, pa.pid)), "the first line updates", seconds=LIVE_S + SLACK_S)
        ui_wait(page, lambda: thread_rows(page).all_inner_texts()[-1].startswith(pa.pid), "the row moves to its sorted place")
        assert focused(row(page, pb.pid)), "focus stayed on the same row"


def test_wf_player_asks_happy(browser, app_url):
    wren = Staff(app_url, WREN)
    player = Player(app_url)
    with widget_page(browser, player) as page:
        ui_wait(page, page.get_by_role("heading", level=1, name=f"Help with {GLOAM_NAME}").is_visible, "widget heading")
        select(page.get_by_role("combobox", name="Topic"), "Bug")
        fill(page.get_by_role("textbox", name="Message"), "i never got the lantern pack")
        page.get_by_role("button", name="Send").dblclick()
        conversation = page.get_by_role("list", name="Conversation")
        ui_wait(page, lambda: conversation.get_by_role("listitem").filter(has_text="i never got the lantern pack").count() == 1, "one message appears")
        tid = wait_until(lambda: player.me()["thread_id"], "me reports the new thread", UI_S)
        body = thread_body(wren, tid)
        assert (body["status"], body["topic"]) == ("waiting", "bug") and [m["body"] for m in of_kind(body, "player")] == ["i never got the lantern pack"]
        expect_status(reply(wren, tid, "Open Settings, then Profile."), 201)
        ui_wait(page, lambda: "Open Settings, then Profile." in text_of(conversation), "the reply arrives", seconds=WIDGET_REPLY_S + SLACK_S)
        assert page.get_by_role("combobox", name="Topic").count() == 0
        key = idempotency_key()
        first = expect_status(player.send("still nothing", None, key), 201)
        assert thread_body(wren, tid)["status"] == "waiting"
        expect_status(reply(wren, tid), 201)
        replay = expect_status(player.send("still nothing", None, key), 201)
        assert replay.json() == first.json() and thread_body(wren, tid)["status"] == "answered"
        expect_status(close(wren, tid), 200)
        fill(page.get_by_role("textbox", name="Message"), "it happened again")
        click(page.get_by_role("button", name="Send"))
        ui_wait(page, lambda: thread_body(wren, tid)["status"] == "waiting", "a new message reopens the closed thread")
    assert len(of_kind(thread_body(wren, tid), "player")) == 3


def test_wf_player_asks_phone_touch(browser, app_url):
    player = Player(app_url)
    with widget_page(browser, player, viewport=PHONE) as page:
        topic, message, send = (page.get_by_role("combobox", name="Topic"), page.get_by_role("textbox", name="Message"),
                                page.get_by_role("button", name="Send"))
        picker_input = page.get_by_label("Attach a file")
        picker = picker_input if picker_input.is_visible() else page.get_by_text("Attach a file", exact=True).first
        for name, target in (("Topic", topic), ("Message", message), ("Attach a file", picker), ("Send", send)):
            box = target.bounding_box()
            assert box and box["width"] >= TARGET_PX and box["height"] >= TARGET_PX, f"{name} target {box}"
        tap(topic)
        select(topic, "Account")
        tap(message)
        page.keyboard.type("How do I change my display name?")
        with page.expect_file_chooser() as chooser:
            tap(picker)
        chooser.value.set_files(files=[{"name": "shot.png", "mimeType": "image/png", "buffer": PNG_BYTES}])
        tap(send)
        ui_wait(page, lambda: "shot.png" in text_of(page.get_by_role("list", name="Conversation")), "the message and file appear")
        layout(page)
    tid = player.me()["thread_id"]
    body = player.thread(tid)
    assert body["topic"] == "account" and body["messages"][0]["body"] == "How do I change my display name?"
    aid = body["messages"][0]["attachments"][0]["id"]
    assert wait_attachment(player, aid)["status"] == "attached"
    assert S3().get(f"attachments/{GLOAM}/{aid}") == PNG_BYTES


def test_wf_player_asks_drafts_survive(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "bug", "The Hollow boss freezes after the *second* lantern.")
    with widget_page(browser, player) as page:
        message = page.get_by_role("textbox", name="Message")
        page.get_by_label("Attach a file").set_input_files(files=[{"name": "shot.png", "mimeType": "image/png", "buffer": PNG_BYTES}])
        fill(message, "half-typed follow-up")
        message.focus()
        page.keyboard.press("End")
        caret = message.evaluate("el => el.selectionStart")
        announced = text_of(region(page, "Widget announcements"))
        expect_status(reply(wren, tid, "Thanks, I can reproduce it."), 201)
        ui_wait(page, lambda: "Thanks, I can reproduce it." in text_of(page.get_by_role("list", name="Conversation")), "the reply arrives",
                seconds=WIDGET_REPLY_S + SLACK_S)
        assert message.input_value() == "half-typed follow-up" and focused(message)
        assert message.evaluate("el => el.selectionStart") == caret
        assert page.get_by_text("shot.png").first.is_visible()
        assert text_of(region(page, "Widget announcements")) == announced
    newcomer = Player(app_url)
    with widget_page(browser, newcomer) as page:
        select(page.get_by_role("combobox", name="Topic"), "Account")
        fill(page.get_by_role("textbox", name="Message"), "How do I change my display name?")
        for _ in range(3):
            advance(page, WIDGET_REPLY_S * 1000)
        click(page.get_by_role("button", name="Send"))
        ui_wait(page, lambda: newcomer.me()["thread_id"] is not None, "the message is sent")
    assert newcomer.thread(newcomer.me()["thread_id"])["topic"] == "account"


def test_workspace_drafts_survive_live_updates(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, msg = open_thread(app_url, "bug", "first words")
    verdicts = [e["verdict"] for e in forensics_settled(wren, msg["id"])["lines"]]
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        first = message_item(page, "first words")
        click(first)
        ui_wait(page, lambda: lines_show(page, tamperglass(page), verdicts) and text_of(region(page, "Verdicts")), "lines settle")
        announced = text_of(region(page, "Verdicts"))
        box = page.get_by_role("textbox", name="Reply")
        fill(box, "Thanks, I can")
        box.focus()
        expect_status(player.send("more words"), 201)
        ui_wait(page, lambda: message_item(page, "more words").is_visible(), "the new message appears", seconds=LIVE_S + SLACK_S)
        assert box.input_value() == "Thanks, I can" and focused(box)
        assert first.get_attribute("aria-current") == "true"
        assert lines_show(page, tamperglass(page), verdicts) and text_of(region(page, "Verdicts")) == announced


def test_wf_player_flood_notice(browser, app_url):
    player, tid, _ = open_thread(app_url, "bug", "flood 0")
    with widget_page(browser, player) as page:
        posts: list[Any] = []
        refusals: list[Any] = []
        page.on("request", lambda r: posts.append(r) if r.method == "POST" and urlparse(r.url).path.endswith("/messages") else None)
        page.on("response", lambda r: refusals.append(r) if r.status == 429 else None)
        drain(player)
        count = len(of_kind(player.thread(tid), "player"))
        fill(page.get_by_role("textbox", name="Message"), "one more try")
        click(page.get_by_role("button", name="Send"))
        status, send = region(page, "Widget announcements"), page.get_by_role("button", name="Send")
        ui_wait(page, lambda: refusals and RATE_NOTICE.fullmatch(text_of(status)), "the rate-limit notice is announced")
        assert RATE_NOTICE.fullmatch(text_of(status)).group(1) == refusals[0].headers["retry-after"]
        assert send.get_attribute("aria-disabled") == "true"
        before = len(posts)
        box = send.bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        advance(page, STEP_MS)
        assert len(posts) == before and len(of_kind(player.thread(tid), "player")) == count
    quick, qtid, _ = open_thread(app_url, "bug", "quick 0")
    for i in range(BUCKET_CAPACITY - 2):
        expect_status(quick.send(f"quick {i + 1}"), 201)
    with widget_page(browser, quick) as page:
        fill(page.get_by_role("textbox", name="Message"), "the eighth")
        click(page.get_by_role("button", name="Send"))
        ui_wait(page, lambda: RATE_NOTICE.fullmatch(text_of(region(page, "Widget announcements")))
                and page.get_by_role("button", name="Send").get_attribute("aria-disabled") == "true", "notice after the eighth send")
    assert len(of_kind(quick.thread(qtid), "player")) == BUCKET_CAPACITY


def test_wf_player_flood_wrong_clock(browser, app_url):
    player, tid, _ = open_thread(app_url, "bug", "flood 0")
    drain(player)
    with widget_page(browser, player) as page:
        now_ms = page.evaluate("() => Date.now()")
        page.clock.set_system_time(datetime.fromtimestamp((now_ms + HOURS_OFF_MS) / 1000, timezone.utc))
        page.reload()
        status, send = region(page, "Widget announcements"), page.get_by_role("button", name="Send")
        ui_wait(page, lambda: RATE_NOTICE.fullmatch(text_of(status)), "the notice shows at once after reload")
        notice = text_of(status)
        assert 1 <= int(RATE_NOTICE.fullmatch(notice).group(1)) <= REFILL_SECONDS
        assert send.get_attribute("aria-disabled") == "true"
        posts: list[Any] = []
        page.on("request", lambda r: posts.append(r) if r.method == "POST" and urlparse(r.url).path.endswith("/messages") else None)
        fill(page.get_by_role("textbox", name="Message"), "let me write")
        box = send.bounding_box()
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        assert posts == [], "Send sent while the bucket was empty"
        if int(RATE_NOTICE.fullmatch(notice).group(1)) > 4:
            advance(page, 1000)
            assert text_of(status) == notice, "the notice counted down"
        wait_until(lambda: player.me()["bucket"]["level"] >= 1, "the server refills a token", REFILL_SECONDS + 2 * SLACK_S)
        ui_wait(page, lambda: text_of(status) == "You can write again." and send.get_attribute("aria-disabled") != "true",
                "the widget asks me again and clears the notice")


def _jsonc(path: Path) -> dict[str, Any]:
    text, out, i, in_string = path.read_text(), [], 0, False
    while i < len(text):
        c = text[i]
        if in_string:
            out.append(c)
            if c == "\\":
                out.append(text[i + 1])
                i += 2
                continue
            in_string = c != '"'
        elif c == '"':
            in_string = True
            out.append(c)
        elif text.startswith("/" * 2, i):
            j = text.find("\n", i)
            i = len(text) if j < 0 else j
            continue
        elif text.startswith("/*", i):
            j = text.find("*/", i + 2)
            i = len(text) if j < 0 else j + 2
            continue
        else:
            out.append(c)
        i += 1
    return jsonlib.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def test_if_run_manifest():
    data = jsonlib.loads((APP_DIR / "run.json").read_text())
    assert data.get("_schema") == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data.get(key), str) and data[key].strip(), key


def test_if_third_party_notices():
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    assert "EB Garamond" in text
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in text or p.version not in text]
    assert missing == [], f"packages missing from the notices: {missing}"


def test_if_licences_allowed():
    bad = [f"{p.name}: {p.licence}" for p in shipped_packages() if not licence_allowed(p.licence, ALLOWED_LICENCES)]
    assert bad == [], bad
    assert "OFL-1.1" in (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    forbidden = {"redis", "ioredis", "@redis/client", "sqlite3", "better-sqlite3", "sqlite", "@libsql/client", "lowdb", "nedb",
                 "memcached", "level", "leveldown", "lokijs", "pouchdb", "keyv", "node-persist"}
    shipped = {p.name for p in shipped_packages()}
    assert shipped & forbidden == set(), shipped & forbidden


def test_if_service_baseline_untouched(app_url, wiremock):
    wren = Staff(app_url, WREN)
    tid = [t["id"] for t in inbox_ok(wren, q="p-ash-17")["threads"]][0]
    body = expect_status(wren.get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
    assert [(r["receipt_id"], r["item"], r["amount_minor"], r["currency"], r["status"]) for r in body["receipts"]] == [
        ("gr-rcpt-1001", "Lantern Pack", 499, "USD", "paid"), ("gr-rcpt-1002", "Ember Lantern Bundle", 1200, "JPY", "partly_refunded")]


def test_if_strict_typescript():
    config = _jsonc(APP_DIR / "tsconfig.json")
    strict = config.get("compilerOptions", {}).get("strict")
    if strict is None and isinstance(config.get("extends"), str) and config["extends"].startswith("."):
        strict = _jsonc((APP_DIR / config["extends"]).resolve()).get("compilerOptions", {}).get("strict")
    assert strict is True
    ignored = {"node_modules", ".git", "dist", "build", "out", ".next", "coverage"}
    gitignore = APP_DIR / ".gitignore"
    if gitignore.exists():
        ignored |= {ln.strip().strip("/") for ln in gitignore.read_text().splitlines() if ln.strip() and not ln.startswith("#") and "*" not in ln}
    offenders = []
    for root, dirs, files in os.walk(APP_DIR):
        dirs[:] = [d for d in dirs if d not in ignored]
        offenders += [os.path.join(root, f) for f in files
                      if f.endswith((".js", ".mjs", ".cjs", ".jsx")) and ".config." not in f]
    assert offenders == [], offenders


def test_if_package_lock():
    lock = jsonlib.loads((APP_DIR / "package-lock.json").read_text())
    assert isinstance(lock, dict) and lock, "package-lock.json is a non-empty JSON object"
    install = jsonlib.loads((APP_DIR / "run.json").read_text())["install"]
    assert "npm ci" in install, f"the install command uses the committed lockfile: {install}"


def at(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def later_than(base: str, stamp: str) -> None:
    wait_until(lambda: server_now(base) > at(stamp).timestamp() + 1, f"server time passes {stamp} by a second", 3)


def statistics(staff: Staff, tid: str) -> dict[str, Any]:
    body = thread_body(staff, tid)
    assert "statistics" in body, f"GET /api/threads/{tid} carries statistics"
    return body["statistics"]


def test_thread_statistics_count_only_what_happened(app_url):
    wren = Staff(app_url, WREN)
    player = Player(app_url)
    key = idempotency_key()
    tid = expect_status(player.send("the lantern flickers", "bug", key=key), 201).json()["thread"]["id"]
    start = {"player_messages": 1, "replies": 0, "reopens": 0, "first_reply_at": None, "first_closed_at": None, "last_closed_at": None}
    assert statistics(wren, tid) == start
    expect_status(player.send("the lantern flickers", "bug", key=key), 201)
    accepted(app_url, match_event(app_url, player.pid, fresh("m")))
    expect_status(close(wren, tid), 409, "not_answered")
    assert statistics(wren, tid) == start, "a replay, an event and a refused close leave the statistics unchanged"
    first = expect_status(reply(wren, tid), 201).json()["message"]
    expect_status(player.send("still flickering", key=idempotency_key()), 201)
    answered = statistics(wren, tid)
    assert (answered["replies"], answered["player_messages"], answered["reopens"]) == (1, 2, 0), answered
    assert answered["first_reply_at"] == first["created_at"]
    expect_status(reply(wren, tid, "A fix ships in the next patch."), 201)
    expect_status(close(wren, tid), 200)
    closed = statistics(wren, tid)
    assert closed["first_closed_at"] is not None and closed["first_closed_at"] == closed["last_closed_at"], closed
    expect_status(close(wren, tid), 409, "already_closed")
    expect_status(reply(wren, tid, "One more note."), 409, "thread_closed")
    assert statistics(wren, tid) == closed, "refused closes and replies leave the statistics unchanged"
    reopen_key = idempotency_key()
    expect_status(player.send("it came back", key=reopen_key), 201)
    expect_status(player.send("and again", key=idempotency_key()), 201)
    expect_status(player.send("it came back", key=reopen_key), 201)
    reopened = statistics(wren, tid)
    assert (reopened["reopens"], reopened["player_messages"], reopened["replies"]) == (1, 4, 2), reopened
    later_than(app_url, closed["last_closed_at"])
    expect_status(reply(wren, tid, "Second fix is out."), 201)
    expect_status(close(wren, tid), 200)
    expect_status(player.send("third time", key=idempotency_key()), 201)
    final = statistics(wren, tid)
    assert (final["reopens"], final["replies"], final["player_messages"]) == (2, 3, 5), final
    assert final["first_reply_at"] == first["created_at"]
    assert final["first_closed_at"] == closed["first_closed_at"]
    assert at(final["last_closed_at"]) > at(final["first_closed_at"])
    assert "statistics" not in player.thread(tid), "the widget thread body has no statistics"


def test_waiting_since_first_unanswered_message(app_url):
    wren = Staff(app_url, WREN)
    player = Player(app_url)
    key = idempotency_key()
    sent = expect_status(player.send("first words", "account", key=key), 201).json()
    tid, first = sent["thread"]["id"], sent["message"]

    def seen(status: str) -> Any:
        body = thread_body(wren, tid)
        assert body["status"] == status, body["status"]
        rows = [t for t in inbox_ok(wren, status=status, q=player.pid)["threads"] if t["id"] == tid]
        assert len(rows) == 1, f"thread {tid} is listed once under {status}"
        assert "waiting_since" in rows[0] and rows[0]["waiting_since"] == body["waiting_since"], (rows[0], body.get("waiting_since"))
        return body["waiting_since"]

    assert seen("waiting") == first["created_at"]
    later_than(app_url, first["created_at"])
    expect_status(player.send("more words", key=idempotency_key()), 201)
    expect_status(player.send("first words", "account", key=key), 201)
    accepted(app_url, match_event(app_url, player.pid, fresh("m")))
    assert seen("waiting") == first["created_at"], "later messages, replays and events keep waiting_since"
    expect_status(reply(wren, tid), 201)
    assert seen("answered") is None
    later_than(app_url, first["created_at"])
    again = expect_status(player.send("one more thing", key=idempotency_key()), 201).json()["message"]
    assert seen("waiting") == again["created_at"] != first["created_at"]
    expect_status(reply(wren, tid), 201)
    expect_status(close(wren, tid), 200)
    assert seen("closed") is None
    later_than(app_url, again["created_at"])
    back = expect_status(player.send("back again", key=idempotency_key()), 201).json()["message"]
    expect_status(player.send("and more", key=idempotency_key()), 201)
    assert seen("waiting") == back["created_at"]


def set_server_secret(staff: Staff, secret: str, **kw: Any) -> httpx.Response:
    return staff.call("PUT", "/api/game/server-secret", json={"secret": secret}, **kw)


def test_server_secret_rotation_one_overlap(app_url):
    pim, juno = Staff(app_url, PIM), Staff(app_url, JUNO)
    player = Player(app_url, game=FERRY, secret=FERRY_WIDGET_SECRET)
    expect_status(player.send("harbour bell missing", "purchase"), 201)
    first, second = "rot-" + uuid.uuid4().hex[:20], "rot~" + uuid.uuid4().hex[:20]

    def deliver(secret: str) -> httpx.Response:
        return post_event(app_url, receipt_event(app_url, player.pid, fresh("r")), game=FERRY, secret=secret)

    def verdict(r: httpx.Response) -> str:
        mid = expect_status(r, 201).json()["message_id"]
        return line(forensics_settled(pim, mid), "signature")["verdict"]

    expect_status(set_server_secret(juno, first), 403, "forbidden")
    expect_status(set_server_secret(pim, first, change=False), 403, "change_refused")
    field_error(set_server_secret(pim, "short-secret"), "secret")
    field_error(set_server_secret(pim, "has a space inside it"), "secret")
    assert verdict(deliver(FERRY_SERVER_SECRET)) == "signature valid", "refused changes leave the secret as it was"
    try:
        changed = expect_status(set_server_secret(pim, first), 200)
        overlap = at(changed.json()["previous_valid_until"]).timestamp() - server_now(app_url)
        assert abs(overlap - SECRET_OVERLAP_S) <= 30, f"previous_valid_until is about {SECRET_OVERLAP_S}s ahead, got {overlap:.0f}s"
        assert first not in changed.text and FERRY_SERVER_SECRET not in changed.text
        assert verdict(deliver(first)) == "signature valid"
        assert verdict(deliver(FERRY_SERVER_SECRET)) == "signature valid: previous secret"
        expect_status(deliver("ferry-wrong-secret-0"), 401, "bad_signature")
        expect_status(set_server_secret(pim, second), 200)
        expect_status(deliver(FERRY_SERVER_SECRET), 401, "bad_signature")
        assert verdict(deliver(first)) == "signature valid: previous secret"
        assert verdict(deliver(second)) == "signature valid"
        accepted(app_url, receipt_event(app_url, fresh("p"), fresh("r")))
    finally:
        expect_status(set_server_secret(pim, FERRY_SERVER_SECRET), 200)
    assert verdict(deliver(FERRY_SERVER_SECRET)) == "signature valid"
    assert verdict(deliver(second)) == "signature valid: previous secret"
    expect_status(deliver(first), 401, "bad_signature")


def _page(wiremock: Any, path: str, pid: str, receipts: list[dict[str, Any]], next_cursor: str | None,
          cursor: str | None = None, status: int = 200) -> None:
    wiremock.stub("GET", path, status=status, json={"player_id": pid, "receipts": receipts, "next_cursor": next_cursor},
                  query={"cursor": cursor} if cursor else None)


def test_receipt_lookup_follows_pages(app_url, wiremock):
    wren = Staff(app_url, WREN)

    def purchase_thread(rids: list[str]) -> tuple[Player, str, str]:
        player, tid, _ = open_thread(app_url, "purchase")
        for rid in rids:
            accepted(app_url, receipt_event(app_url, player.pid, rid))
        return player, tid, f"/v1/games/{GLOAM}/players/{player.pid}/receipts"

    r1, r2, r3 = fresh("r"), fresh("r"), fresh("r")
    player, tid, path = purchase_thread([r1, r3])
    c2, c3 = "c2-" + uuid.uuid4().hex[:8], "c3-" + uuid.uuid4().hex[:8]
    _page(wiremock, path, player.pid, [_receipt(r1)], c2)
    _page(wiremock, path, player.pid, [_receipt(r2, "Ember Lantern Bundle", 1200, "JPY")], c3, cursor=c2)
    _page(wiremock, path, player.pid, [_receipt(r3, amount=OVER_AMOUNT)], None, cursor=c3)
    body = expect_status(wren.get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
    assert body["available"] is True, body
    assert [x["receipt_id"] for x in body["receipts"]] == [r1, r2, r3]
    assert body["purchases"] == [{"receipt_id": r1, "on_game_server": True, "differences": []},
                                 {"receipt_id": r3, "on_game_server": True, "differences": ["amount"]}]
    assert [c["query"].get("cursor") for c in wiremock.requests(path)] == [None, c2, c3]

    def unavailable(pages: list[tuple[str | None, str | None, int]], asked: int) -> None:
        rid = fresh("r")
        player, tid, path = purchase_thread([rid])
        for cursor, next_cursor, status in pages:
            _page(wiremock, path, player.pid, [_receipt(fresh("r"))], next_cursor, cursor=cursor, status=status)
        got = expect_status(wren.get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
        assert got == {"available": False, "receipts": [], "purchases": [{"receipt_id": rid, "on_game_server": None, "differences": []}]}, (pages, got)
        assert len(wiremock.requests(path)) == asked, f"expected {asked} game-server calls for {pages}"

    unavailable([(None, "p2", 200), ("p2", None, 500)], 2)
    unavailable([(None, "p2", 200), ("p2", None, 404)], 2)
    unavailable([(None, "p2", 200), ("p2", "p2", 200)], 2)
    chain = [(None, "p2", 200)] + [(f"p{i}", f"p{i + 1}", 200) for i in range(2, MAX_PAGES + 2)]
    unavailable(chain, MAX_PAGES)


def effective(staff: Staff, mod: str) -> dict[tuple[str, str], tuple[bool, list[str]]]:
    entries = expect_status(staff.get(f"/api/team/{mod}/effective"), 200).json()["effective"]
    assert [(e["action"], e["topic"]) for e in entries] == [(a, t) for a in ACTIONS for t in TOPICS]
    return {(e["action"], e["topic"]): (e["allowed"], e["decided_by"]) for e in entries}


def expected_effective(rules: list[dict[str, Any]]) -> dict[tuple[str, str], tuple[bool, list[str]]]:
    def matching(effect: str, action: str, topic: str) -> list[str]:
        return [r["id"] for r in rules if r["effect"] == effect and r["action"] == action and r["topic"] in (topic, "*")]

    out: dict[tuple[str, str], tuple[bool, list[str]]] = {}
    for action in ACTIONS:
        for topic in TOPICS:
            denies, grants = matching("deny", action, topic), matching("grant", action, topic)
            if denies:
                out[(action, topic)] = (False, denies)
            elif not grants:
                out[(action, topic)] = (False, [])
            elif action != "read" and not out[("read", topic)][0]:
                out[(action, topic)] = (False, out[("read", topic)][1])
            else:
                out[(action, topic)] = (True, grants)
    return out


def test_effective_permissions_with_deciding_rules(app_url):
    wren, juno, pim = Staff(app_url, WREN), Staff(app_url, JUNO), Staff(app_url, PIM)
    mod = juno_id(wren)
    added: list[str] = []

    def rules_in_order() -> list[dict[str, Any]]:
        listed = next(m for m in expect_status(wren.get("/api/team"), 200).json()["moderators"] if m["id"] == mod)["rules"]
        shape = lambda r: (r["effect"], r["action"], r["topic"])
        seeded = [next(r for r in listed if shape(r) == want) for want in SEEDED_JUNO]
        ids = {r["id"] for r in seeded} | set(added)
        return seeded + [r for r in listed if r["id"] not in ids] + [next(r for r in listed if r["id"] == i) for i in added]

    seeded = rules_in_order()[:len(SEEDED_JUNO)]
    start = effective(wren, mod)
    assert start[("read", "purchase")] == (False, [seeded[5]["id"]])
    assert start[("reply", "purchase")] == (False, [seeded[5]["id"]])
    assert all(start[("receipts", t)] == (False, [seeded[4]["id"]]) for t in TOPICS)
    assert start[("read", "bug")] == (True, [seeded[0]["id"]])
    assert start == expected_effective(rules_in_order())
    expect_status(juno.get(f"/api/team/{mod}/effective"), 403, "forbidden")
    foreign, unknown = pim.get(f"/api/team/{mod}/effective"), pim.get(f"/api/team/{fresh('x')}/effective")
    assert expect_status(foreign, 404).json() == expect_status(unknown, 404).json()
    try:
        for effect, action, topic in (("deny", "reply", "bug"), ("grant", "read", "purchase"), ("grant", "close", "account"),
                                      ("deny", "read", "*"), ("grant", "reply", "bug")):
            added.append(add_rule(wren, mod, effect, action, topic))
            assert effective(wren, mod) == expected_effective(rules_in_order()), f"after {effect} {action} {topic}"
        for rid in list(added[:2]):
            expect_status(revoke_rule(wren, mod, rid), 204)
            added.remove(rid)
            assert effective(wren, mod) == expected_effective(rules_in_order()), f"after revoking {rid}"
    finally:
        for rid in added:
            revoke_rule(wren, mod, rid)
    assert effective(wren, mod) == start


def test_widget_signature_exact_lowercase_hex(app_url):
    wren = Staff(app_url, WREN)
    player = Player(app_url)
    upper = player.signature.upper()
    assert upper != player.signature
    expect_status(player.call("GET", f"/api/widget/{GLOAM}/me", signature=upper), 401, "invalid_identity")
    sent = player.call("POST", f"/api/widget/{GLOAM}/messages", json={"body": "uppercase hello", "topic": "bug"},
                       key=idempotency_key(), signature=upper)
    expect_status(sent, 401, "invalid_identity")
    assert inbox_ok(wren, q=player.pid)["counts"] == {"waiting": 0, "answered": 0, "closed": 0}
    assert player.me()["thread_id"] is None, "the refused requests created no thread"


def test_secret_route_checks_access_before_body(app_url):
    pim, juno = Staff(app_url, PIM), Staff(app_url, JUNO)
    bad, h = b"{", {"Content-Type": "application/json"}
    bare = httpx.put(app_url + "/api/game/server-secret", content=bad, headers=h, timeout=HTTP_TIMEOUT_S)
    expect_status(bare, 401, "unauthenticated")
    expect_status(pim.call("PUT", "/api/game/server-secret", content=bad, headers=h, change=False), 403, "change_refused")
    expect_status(juno.call("PUT", "/api/game/server-secret", content=bad, headers=h), 403, "forbidden")
    expect_status(pim.call("PUT", "/api/game/server-secret", content=bad, headers=h), 422, "validation")


def test_sanitiser_and_link_inside_link_labels(app_url, wiremock):
    wren = Staff(app_url, WREN)
    raw = "[<b>hi</b>](https://example.test/x)"
    _, _, tagged = open_thread(app_url, "other", raw)
    stage = line(forensics_settled(wren, tagged["id"]), "sanitiser")
    assert stage["after"] == raw.replace("<b>", "").replace("</b>", ""), stage
    assert stage["removed"] == [{"start": 1, "end": 4, "text": "<b>"}, {"start": 6, "end": 10, "text": "</b>"}], stage
    assert stage["verdict"] == "2 removed"
    _, _, labelled = open_thread(app_url, "other", "[http://10.0.0.1/x](mailto:help@gloam.example)")
    link = line(forensics_settled(wren, labelled["id"]), "link")
    assert (link["verdict"], link["address"]) == ("refused: private", "10.0.0.1"), link
    _, _, before_target = open_thread(app_url, "other", f"[see http://10.0.0.1/x]({stand_in()}/web/patch-notes)")
    link = line(forensics_settled(wren, before_target["id"]), "link")
    assert (link["verdict"], link["address"]) == ("refused: private", "10.0.0.1"), link
    assert wiremock.requests("/web/patch-notes") == [], "the later target is not fetched"


def test_show_more_threads_announces_rows(browser, app_url):
    tag = fresh("sm")
    for i in range(26):
        expect_status(Player(app_url, f"{tag}{i:02d}").send(f"page words {tag}", "bug"), 201)
    with staff_page(browser, app_url, WREN, f"/inbox?q={tag}") as page:
        ui_wait(page, lambda: thread_rows(page).count() == 25, "the first page shows 25 rows")
        click(page.get_by_role("button", name="Show more threads"))
        ui_wait(page, lambda: thread_rows(page).count() == 26, "the next page is appended")
        ui_wait(page, lambda: text_of(region(page, "Inbox announcements")) == "Showing 26 threads.", "the row total is announced")
        ui_wait(page, lambda: focused(row(page, f"{tag}25")), "focus moves to the first appended row")
        assert page.get_by_role("button", name="Show more threads").count() == 0


def test_receipt_lookup_empty_string_cursor(app_url, wiremock):
    wren = Staff(app_url, WREN)
    player, tid, _ = open_thread(app_url, "purchase")
    r1, r2 = fresh("r"), fresh("r")
    accepted(app_url, receipt_event(app_url, player.pid, r1))
    path = f"/v1/games/{GLOAM}/players/{player.pid}/receipts"
    wiremock.stub("GET", path, json={"player_id": player.pid, "receipts": [_receipt(r1)], "next_cursor": ""})
    wiremock.stub("GET", path, json={"player_id": player.pid, "receipts": [_receipt(r2)], "next_cursor": None}, query={"cursor": ""})
    body = expect_status(wren.get(f"/api/threads/{tid}/receipt-lookup"), 200).json()
    assert len(wiremock.requests(path)) == 2, "the empty cursor is asked for as a second page"
    assert body["available"] is True and [x["receipt_id"] for x in body["receipts"]] == [r1, r2], body


def test_team_rule_route_checks_access_before_body(app_url):
    wren, juno = Staff(app_url, WREN), Staff(app_url, JUNO)
    mod = juno_id(wren)
    bad, h = b"{", {"Content-Type": "application/json"}
    bare = httpx.post(f"{app_url}/api/team/{mod}/rules", content=bad, headers=h, timeout=HTTP_TIMEOUT_S)
    expect_status(bare, 401, "unauthenticated")
    expect_status(wren.call("POST", f"/api/team/{mod}/rules", content=bad, headers=h, change=False), 403, "change_refused")
    expect_status(wren.call("POST", f"/api/team/{fresh('x')}/rules", content=bad, headers=h), 404, "not_found")
    expect_status(juno.call("POST", f"/api/team/{mod}/rules", content=bad, headers=h), 403, "forbidden")
    expect_status(wren.call("POST", f"/api/team/{mod}/rules", content=bad, headers=h), 422, "validation")


def test_null_origin_is_a_foreign_origin(app_url):
    r = httpx.post(app_url + "/api/auth/login", json={"email": WREN[0], "password": WREN[1]},
                   headers={"Origin": "null"}, timeout=HTTP_TIMEOUT_S)
    expect_status(r, 403, "change_refused")
    assert not any(c.startswith("hl_access=") for c in r.headers.get_list("set-cookie")), "no session cookie is set"
    wren = Staff(app_url, WREN)
    _, tid, _ = open_thread(app_url)
    sent = wren.call("POST", f"/api/threads/{tid}/replies", json={"body": "hi"}, key=idempotency_key(), headers={"Origin": "null"})
    expect_status(sent, 403, "change_refused")
    assert thread_body(wren, tid)["status"] == "waiting" and of_kind(thread_body(wren, tid), "reply") == []


def test_closed_thread_conflict_before_body_validation(app_url):
    wren = Staff(app_url, WREN)
    _, tid, _ = open_thread(app_url)
    expect_status(reply(wren, tid), 201)
    expect_status(close(wren, tid), 200)
    expect_status(reply(wren, tid, "   "), 409, "thread_closed")
    expect_status(reply(wren, tid, "x" * (REPLY_MAX_CHARS + 1)), 409, "thread_closed")
    assert thread_body(wren, tid)["status"] == "closed"


def test_bucket_count_steps_from_stage_previous(browser, app_url):
    wren = Staff(app_url, WREN)
    player, tid, first = open_thread(app_url, "bug", "bucket one")
    expect_status(player.send("bucket two"), 201)
    third = expect_status(player.send("bucket three"), 201).json()["message"]
    f1, f3 = forensics_settled(wren, first["id"]), forensics_settled(wren, third["id"])
    b1, b3 = line(f1, "bucket"), line(f3, "bucket")
    assert b3["level"] < b1["previous"] - 1, (b1, b3)
    allowed = set(range(b1["level"], b1["previous"] + 1))
    with staff_page(browser, app_url, WREN, f"/inbox/{tid}") as page:
        open_thread_page(page, player.pid)
        pane = tamperglass(page)
        click(message_item(page, "bucket three"))
        ui_wait(page, lambda: lines_show(page, pane, [e["verdict"] for e in f3["lines"]]), "the third message settles")
        advance(page, 1000)
        click(message_item(page, "bucket one"))
        seen: list[int] = []
        settled_for = 0
        deadline = time.monotonic() + UI_S
        while time.monotonic() < deadline and settled_for < 2 * QUARTER_MS:
            advance(page, 16)
            shown = text_of(check_lines(pane).nth(1))
            found = re.search(r"(\d+) of 8", shown)
            if found and "checking" not in shown:
                seen.append(int(found.group(1)))
                settled_for = settled_for + 16 if seen[-1] == b1["level"] else 0
        assert seen and seen[-1] == b1["level"], seen
        assert set(seen) <= allowed, f"the count stepped through {seen}; the stage moves from {b1['previous']} to {b1['level']}"


def test_flood_notice_follows_the_emptying_send_before_uploads(browser, app_url):
    player, tid, _ = open_thread(app_url, "bug", "flood 0")
    for i in range(BUCKET_CAPACITY - 2):
        expect_status(player.send(f"flood {i + 1}"), 201)
    assert player.me()["bucket"]["level"] == 1
    with widget_page(browser, player) as page:
        status, send = region(page, "Widget announcements"), page.get_by_role("button", name="Send")
        fill(page.get_by_role("textbox", name="Message"), "the eighth, with a file")
        page.get_by_label("Attach a file").set_input_files(files=[{"name": "notes.txt", "mimeType": "text/plain", "buffer": TEXT_BYTES}])
        asked: list[Any] = []
        page.on("request", lambda r: asked.append(r) if r.method == "GET" and urlparse(r.url).path.endswith("/me") else None)
        with ctx(held(page, "**/attachments")) as hold:
            before = len(asked)
            click(send)
            ui_wait(page, lambda: len(asked) > before and send.get_attribute("aria-disabled") == "true",
                    "me is asked and Send is disabled straight after the emptying send, while its upload is still pending")
            assert len(of_kind(player.thread(tid), "player")) == BUCKET_CAPACITY
            hold.release()
        ui_wait(page, lambda: RATE_NOTICE.fullmatch(text_of(status)) is not None or send.get_attribute("aria-disabled") == "true",
                "the empty bucket still holds Send after the upload")
