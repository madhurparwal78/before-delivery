from __future__ import annotations

import base64
import http.server
import json
import os
import re
import socket
import sqlite3
import struct
import subprocess
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from hashlib import sha256
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

import conftest
from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    animations,
    axe,
    center,
    check,
    click,
    decode,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    session,
    shipped_packages,
    style,
    tab_order,
    tap,
    text,
)

DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
SIDEWAYS = {"width": 812, "height": 375}
BELOW_RAIL = {"width": 767, "height": 900}
REFRESH_EVERY_MS = 10000
REFRESH_WINDOW_MS = 12000
CELL_GAP_MS = 30
CELL_SPREAD_MS = 800
NUMERAL_MS = 333
SEQUENCE_MAX_MS = 2000
SEAL_MIN_MS = 420
SEAL_MAX_MS = 640
TOP_TOLERANCE = 24
TARGET_PX = 44
MAX_JSON = 16384
MAX_UPLOAD = 10000000
TURN_MAX = 75
TURN_STEP = 15
TOPUP_MAX = "500.00"
LEDGER_LIMIT = 50
BUSY_WAIT_S = 5

HTTP_TIMEOUT_S = 40
REAL_WAIT_S = 30
POLL_S = 45
GRACE_MS = 2000
SEQUENCE_STEP_MS = 16
SAMPLE_STEP_MS = 30
RETRY_WAIT_S = 90
PAGES_BOUND = 400

CLUB = ZoneInfo("America/Chicago")
COORD_CODE = "COORD-2718"
VOL_CODE = "VOL-3141"
CODES = {"HH-1001": "HOME-1001", "HH-1002": "HOME-1002", "HH-1003": "HOME-1003", "HH-1004": "HOME-1004", "HH-1005": "HOME-1005", "HH-1006": "HOME-1006"}
HOUSEHOLD = {"HH-1001": "Okafor-Lindqvist household", "HH-1002": "Bellweather household", "HH-1003": "Tran-Osei household", "HH-1004": "Kowalczyk household", "HH-1005": "Ruiz-Abernathy household", "HH-1006": "Patel-Mercer household"}
CASE = {"P-OATS": "Rolled oats, 25 lb sack", "P-TAHINI": "Tahini, 12 jars", "P-OLIVE": "Olive oil, 6 bottles", "P-LENTIL": "Red lentils, 25 lb sack", "P-PNUT": "Peanut butter, 12 jars", "P-MAPLE": "Maple syrup, 6 jugs", "P-RICE": "Brown rice, 50 lb sack", "P-QUINOA": "Quinoa, 10 lb bag"}
PACK = {"P-OATS": 25, "P-TAHINI": 12, "P-OLIVE": 6, "P-LENTIL": 25, "P-PNUT": 12, "P-MAPLE": 6, "P-RICE": 50, "P-QUINOA": 10}
PRICE = {"P-OATS": 3850, "P-TAHINI": 4700, "P-OLIVE": 8999, "P-LENTIL": 4125, "P-PNUT": 5150, "P-MAPLE": 7400, "P-RICE": 6299, "P-QUINOA": 3333}
CARRIED_1001 = 12000
PDF = b"%PDF-1.4\n"
PNG = b"\x89PNG\r\n\x1a\n"
JPEG = b"\xff\xd8\xff"

GL_SPY = """(() => {
  window.__gl = {count: 0, list: [], hiddenDraws: 0};
  const seen = new WeakSet();
  const wrap = proto => {
    if (!proto) return;
    const original = proto.getContext;
    proto.getContext = function (type, ...rest) {
      const ctx = original.call(this, type, ...rest);
      if (ctx && /webgl/i.test(String(type)) && !seen.has(ctx)) {
        seen.add(ctx); window.__gl.list.push(ctx); window.__gl.count += 1;
      }
      return ctx;
    };
  };
  wrap(window.HTMLCanvasElement && HTMLCanvasElement.prototype);
  wrap(window.OffscreenCanvas && OffscreenCanvas.prototype);
  const prints = new WeakMap();
  const watch = (proto, method) => {
    if (!proto || !proto[method]) return;
    const original = proto[method];
    proto[method] = function (...args) {
      const result = original.apply(this, args);
      const c = this.canvas;
      if (c instanceof HTMLCanvasElement && (!c.isConnected || c.getClientRects().length === 0)) {
        const print = c.toDataURL();
        if (prints.has(c) && prints.get(c) !== print) window.__gl.hiddenDraws += 1;
        prints.set(c, print);
      }
      return result;
    };
  };
  watch(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'drawImage');
  watch(window.CanvasRenderingContext2D && CanvasRenderingContext2D.prototype, 'putImageData');
  watch(window.ImageBitmapRenderingContext && ImageBitmapRenderingContext.prototype, 'transferFromImageBitmap');
})();"""

EFFECTIVE_BG = """el => { let n = el; while (n) { const m = getComputedStyle(n).backgroundColor.match(/[\\d.]+/g).map(Number);
  if (m.length < 4 || m[3] > 0) return m.slice(0, 3); n = n.parentElement; } return [255, 255, 255]; }"""


def poll(probe: Callable[[], Any], what: str, seconds: float = POLL_S) -> Any:
    deadline = time.monotonic() + seconds
    while time.monotonic() < deadline:
        value = probe()
        if value:
            return value
    pytest.fail(f"expected within {seconds}s: {what}")


class Api:
    def __init__(self, base: str, code: str | None = None, household_code: str | None = None):
        self.base = base
        self.code = household_code
        self.http = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
        if code:
            want(self.http.post("/api/session", json={"code": code}), 200)

    def call(self, method: str, path: str, body: Any = None, *, key: str | None = None, etag: str | None = None,
             content: bytes | None = None, ctype: str | None = None, headers: dict | None = None) -> httpx.Response:
        sent = dict(headers or {})
        if key:
            sent["Idempotency-Key"] = key
        if etag:
            sent["If-Match"] = etag
        if content is not None:
            sent["Content-Type"] = ctype or ""
            return self.http.request(method, path, content=content, headers=sent)
        if body is not None:
            return self.http.request(method, path, json=body, headers=sent)
        return self.http.request(method, path, headers=sent)

    def cycle(self, cid: str) -> dict:
        return want(self.call("GET", f"/api/cycles/{cid}"), 200).json()

    def line(self, cid: str, pid: str) -> dict:
        return next(l for l in self.cycle(cid)["lines"] if l["product_id"] == pid)

    def credit(self) -> dict:
        return want(self.call("GET", f"/api/households/{self.code}/ledger?limit=1"), 200).json()


def want(response: httpx.Response, status: int, code: str | None = None) -> httpx.Response:
    assert response.status_code == status, f"{response.request.method} {response.request.url}: expected {status}, got {response.status_code} {response.text[:400]}"
    if code:
        assert response.json()["error"]["code"] == code, response.text[:400]
    return response


def coordinator(base: str) -> Api:
    return Api(base, COORD_CODE)


def volunteer(base: str) -> Api:
    return Api(base, VOL_CODE)


def household(base: str, code: str) -> Api:
    return Api(base, CODES[code], code)


def now() -> datetime:
    return datetime.now(timezone.utc)


def local(when: datetime) -> str:
    return when.astimezone(CLUB).strftime("%Y-%m-%dT%H:%M:%S")


def ui_time(when: datetime) -> str:
    return when.astimezone(CLUB).strftime("%Y-%m-%d %H:%M:%S")


def etag_of(cycle: dict) -> str:
    return f'"r{cycle["revision"]}"'


def fresh_name() -> str:
    return f"Cycle {uuid.uuid4().hex[:10]}"


def draft_body(name: str, cases, cutoff_in: float, pickup_in: float, pickup_len: float) -> dict:
    start = now()
    return {"name": name, "cutoff_local": local(start + timedelta(seconds=cutoff_in)),
            "pickup_start_local": local(start + timedelta(seconds=pickup_in)),
            "pickup_end_local": local(start + timedelta(seconds=pickup_in + pickup_len)), "product_ids": list(cases)}


def open_cycle(coord: Api, cases=("P-TAHINI",), name: str | None = None, cutoff_in: float = 3600, pickup_in: float = 7200, pickup_len: float = 7200) -> dict:
    made = want(coord.call("POST", "/api/cycles", draft_body(name or fresh_name(), cases, cutoff_in, pickup_in, pickup_len)), 201).json()
    return want(coord.call("POST", f"/api/cycles/{made['id']}/transitions", {"to": "open"}), 200).json()


def pledge(member: Api, cid: str, pid: str, units: int, key: str | None = None) -> httpx.Response:
    return member.call("PUT", f"/api/cycles/{cid}/lines/{pid}/pledge", {"units": units}, key=key or idempotency_key())


def withdraw(member: Api, cid: str, pid: str, key: str | None = None) -> httpx.Response:
    return member.call("DELETE", f"/api/cycles/{cid}/lines/{pid}/pledge", key=key or idempotency_key())


def top_up(member: Api, amount: str, key: str | None = None) -> tuple[str, httpx.Response]:
    used = key or idempotency_key()
    return used, member.call("POST", "/api/topups", {"amount": amount}, key=used)


def fund(member: Api, enough: int = 25000) -> None:
    for _ in range(20):
        if member.credit()["spendable_cents"] >= enough:
            return
        want(top_up(member, TOPUP_MAX)[1], 201)
    pytest.fail("POST /api/topups raised spendable credit; expected top-ups to add to it")


def setup_cycle(base: str, cases, pledges=(), *, funded: bool = False, **times) -> tuple[Api, str, str, dict]:
    coord = coordinator(base)
    cycle = open_cycle(coord, cases, **times)
    members: dict[str, Api] = {}
    for code, pid, units in pledges:
        member = members.setdefault(code, household(base, code))
        if funded:
            fund(member)
        want(pledge(member, cycle["id"], pid, units), 200)
    return coord, cycle["id"], cycle["name"], members


def pass_cutoff(coord: Api, cid: str) -> None:
    cycle = coord.cycle(cid)
    want(coord.call("PATCH", f"/api/cycles/{cid}", {"cutoff_local": local(now() + timedelta(seconds=2))}, etag=etag_of(cycle)), 200)
    poll(lambda: not coord.cycle(cid)["accepting_pledges"], "GET /api/cycles/<id> reports accepting_pledges false after cutoff")


def resolve(coord: Api, cid: str, pid: str, action: str) -> httpx.Response:
    return coord.call("POST", f"/api/cycles/{cid}/lines/{pid}/resolution", {"action": action})


def move(coord: Api, cid: str, *statuses: str) -> dict:
    latest = {}
    for status in statuses:
        latest = want(coord.call("POST", f"/api/cycles/{cid}/transitions", {"to": status}), 200).json()
    return latest


def take_up_rest(coord: Api, cid: str) -> None:
    for line in coord.cycle(cid)["lines"]:
        if line["status"] == "filling":
            want(resolve(coord, cid, line["product_id"], "take_up"), 200)


def ordered_cycle(base: str) -> tuple[Api, str, str]:
    coord, cid, name, _ = setup_cycle(base, ("P-QUINOA",))
    pass_cutoff(coord, cid)
    take_up_rest(coord, cid)
    move(coord, cid, "ordered")
    return coord, cid, name


def upload(api: Api, cid: str, kind: str, body: bytes, ctype: str) -> httpx.Response:
    return api.call("PUT", f"/api/cycles/{cid}/documents/{kind}", content=body, ctype=ctype)


def unique_pdf() -> bytes:
    return PDF + uuid.uuid4().hex.encode()


def bag_cycle(base: str, **times) -> tuple[Api, str, str]:
    coord, cid, name, _ = setup_cycle(base, ("P-OLIVE", "P-QUINOA"), [("HH-1002", "P-OLIVE", 2), ("HH-1002", "P-QUINOA", 1)], funded=True, **times)
    pass_cutoff(coord, cid)
    take_up_rest(coord, cid)
    move(coord, cid, "ordered", "received", "breakdown")
    return coord, cid, name


def closable_cycle(base: str, invoice: bool = True) -> tuple[Api, str, str, dict]:
    coord, cid, name, members = setup_cycle(base, ("P-OLIVE",), [("HH-1004", "P-OLIVE", 4), ("HH-1002", "P-OLIVE", 2)], funded=True)
    pass_cutoff(coord, cid)
    move(coord, cid, "ordered", "received", "breakdown")
    if invoice:
        want(upload(coord, cid, "invoice", unique_pdf(), "application/pdf"), 201)
    return coord, cid, name, members


def close(api: Api, cid: str, key: str | None = None) -> httpx.Response:
    return api.call("POST", f"/api/cycles/{cid}/transitions", {"to": "closed"}, key=key or idempotency_key())


def account_id_of(killbill, member: Api) -> str:
    key, response = top_up(member, "5.00")
    want(response, 201)
    return killbill.payment_by_key(f"topup-{member.code}-{key}")["accountId"]


def charges(killbill, account_id: str, cid: str) -> list[tuple[str, dict]]:
    found = []
    for invoice in killbill.invoices(account_id):
        for item in invoice.get("items", []):
            if item.get("itemType") == "EXTERNAL_CHARGE" and f"[{cid}]" in (item.get("description") or ""):
                found.append((invoice.get("status"), item))
    return found


def all_movements(member: Api) -> list[dict]:
    moved, before = [], None
    for _ in range(PAGES_BOUND):
        params = {"limit": LEDGER_LIMIT}
        if before:
            params["before"] = before
        page = want(member.http.get(f"/api/households/{member.code}/ledger", params=params), 200).json()
        moved += page["movements"]
        before = page["next_before"]
        if not before:
            return moved
    pytest.fail("GET ledger next_before reached null; expected the walk to end")


def race(*calls: Callable[[], Any]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(call):
        barrier.wait(HTTP_TIMEOUT_S)
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return [f.result() for f in [pool.submit(run, c) for c in calls]]


def usd(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def hold_of(pid: str, units: int) -> int:
    return units * -(-PRICE[pid] // PACK[pid])


def outage(name: str) -> str:
    return os.environ[name].rstrip("/")


def club_today() -> str:
    return now().astimezone(CLUB).strftime("%Y-%m-%d")


def accessible_name(page: Page) -> str | None:
    try:
        snapshot = page.locator(":focus").first.aria_snapshot(timeout=2000)
    except Exception:
        return None
    lines = snapshot.strip().splitlines()
    first = lines[0] if lines else ""
    if first.startswith("- '"):
        body = first[3:].rstrip(":")
        first = "- " + body[:body.rindex("'")].replace("''", "'") if "'" in body else first
    elif first.startswith('- "'):
        first = "- " + json.JSONDecoder().raw_decode(first[2:])[0]
    match = re.match(r'^- [\w-]+ "((?:[^"\\]|\\.)*)"', first)
    return json.loads(f'"{match.group(1)}"') if match else None


conftest.accessible_name = accessible_name


def capture(locator: Locator) -> bytes:
    locator.scroll_into_view_if_needed()
    return conftest.capture(locator)


def new_db(tmp_path: Path) -> Path:
    return tmp_path / f"{uuid.uuid4().hex[:10]}.db"


def prefix_of(db: Path) -> str:
    return f"t{db.stem}"


@contextmanager
def app_copy(db: Path, **env: str) -> Iterator[str]:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    serve = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())["serve"]
    log = Path(os.environ.get("TMPDIR") or "/tmp") / f"{db.stem}.{port}.log"
    settings = {**os.environ, "APP_PUBLIC_PORT": str(port), "TALLY_DB_PATH": str(db), "TALLY_KB_KEY_PREFIX": prefix_of(db), **env}
    settings.setdefault("MAIL_FROM", "Tare & Tally <pickup@tare-and-tally.example>")
    with log.open("wb") as sink:
        process = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, env=settings, stdout=sink, stderr=subprocess.STDOUT, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def healthy():
        assert process.poll() is None, f"app copy exited: {log.read_text()[-2000:]}"
        try:
            return httpx.get(f"{base}/api/health", timeout=2).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        poll(healthy, f"app copy answers GET /api/health; log: {log}", 60)
        yield base
    finally:
        os.killpg(process.pid, 15)
        process.wait(timeout=20)


class KillBillRelay:

    def __init__(self, up: bool = True):
        self.up = up
        self.journal: list[tuple[str, str]] = []
        self.lose: Callable[[str, str], bool] = lambda method, path: False
        self.alter: Callable[[str, str, bytes], bytes] = lambda method, path, body: body
        target = os.environ["KILLBILL_URL"].rstrip("/")
        relay = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def log_message(self, *args):
                return

            def relay(self):
                size = int(self.headers.get("Content-Length") or 0)
                body = self.rfile.read(size) if size else b""
                if not relay.up:
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                relay.journal.append((self.command, self.path))
                sent = {k: v for k, v in self.headers.items() if k.lower() not in {"content-length", "accept-encoding", "connection"}}
                body = relay.alter(self.command, self.path, body)
                answer = httpx.request(self.command, target + self.path, content=body, headers=sent, timeout=HTTP_TIMEOUT_S)
                if relay.lose(self.command, self.path):
                    self.connection.shutdown(socket.SHUT_RDWR)
                    return
                self.send_response(answer.status_code)
                for k, v in answer.headers.items():
                    if k.lower() not in {"content-length", "transfer-encoding", "content-encoding", "connection", "date", "server"}:
                        self.send_header(k, v)
                self.send_header("Content-Length", str(len(answer.content)))
                self.end_headers()
                self.wfile.write(answer.content)

            do_GET = do_POST = do_PUT = do_DELETE = do_HEAD = relay

        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        self.url = f"http://127.0.0.1:{self.server.server_address[1]}"
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()


class TcpRelay:

    def __init__(self, host: str, port: int):
        self.target = (host, port)
        self.up = False
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", 0))
        self.listener.listen()
        self.port = self.listener.getsockname()[1]
        threading.Thread(target=self.accept, daemon=True).start()

    def accept(self):
        for _ in range(100000):
            try:
                client, _addr = self.listener.accept()
            except OSError:
                return
            if not self.up:
                client.close()
                continue
            upstream = socket.create_connection(self.target)
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self.pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def pipe(a, b):
        try:
            for _ in range(100000):
                data = a.recv(65536)
                if not data:
                    break
                b.sendall(data)
        except OSError:
            pass
        for s in (a, b):
            try:
                s.close()
            except OSError:
                pass

    def stop(self):
        try:
            self.listener.shutdown(socket.SHUT_RDWR)
        except OSError:
            pass
        self.listener.close()


def role(scope, kind: str, name: str) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True)


def squeeze(value: str | None) -> str:
    return " ".join((value or "").split())


def pump(page: Page, probe: Callable[[], Any], what: str, page_ms: int | None = None) -> None:
    deadline = time.monotonic() + REAL_WAIT_S
    spent = 0
    while time.monotonic() < deadline:
        if probe():
            return
        if page_ms is None or spent < page_ms:
            advance(page, 50)
            spent += 50
        elif spent < page_ms + GRACE_MS:
            advance(page, SEQUENCE_STEP_MS)
            spent += SEQUENCE_STEP_MS
        else:
            page.evaluate("1")
    pytest.fail(f"expected: {what} (page time used {spent} ms)")


def frames(page: Page, count: int = 3) -> None:
    for _ in range(count):
        advance(page, SEQUENCE_STEP_MS)


def sign_in(page: Page, code: str) -> None:
    box = role(page, "textbox", "Access code")
    pump(page, lambda: box.count() > 0, "the sign-in panel shows textbox Access code")
    fill(box, code)
    click(role(page, "button", "Sign in"))
    pump(page, lambda: role(page, "button", "Sign out").count() > 0, "signing in shows button Sign out")


@contextmanager
def signed_in(browser: Browser, base: str, code: str, path: str = "/", view: dict = DESKTOP, spy: bool = False, **options) -> Iterator[Page]:
    with open_app(browser, base + path, **options) as page:
        page.set_viewport_size(view)
        if spy:
            page.add_init_script(GL_SPY)
            page.reload()
        sign_in(page, code)
        yield page


def path_of(page: Page) -> str:
    return urlsplit(page.url).path


def block(page: Page, case: str) -> Locator:
    return role(page, "article", case)


def on_cycle(page: Page, case: str) -> Locator:
    pump(page, lambda: block(page, case).count() > 0, f"article {case} is on the member cycle page")
    return block(page, case)


def cells(page: Page, case: str) -> list[str]:
    return block(page, case).locator("[data-cell]").evaluate_all("els => els.map(e => e.getAttribute('data-cell'))")


def to_go(page: Page, case: str) -> int | None:
    found = block(page, case).get_by_text(re.compile(r"^\s*\d+ to go\s*$"))
    if found.count() == 0:
        return None
    return int(squeeze(found.first.text_content()).split()[0])


def crate(page: Page, case: str) -> Locator:
    return block(page, case).get_by_role("img", name=re.compile(r"^Crate of "))


def crate_named(page: Page, case: str, filled: int, pack: int, state: str) -> bool:
    return role(page, "img", f"Crate of {case}: {filled} of {pack} units pledged, {state}").count() == 1


def spin(page: Page, case: str) -> Locator:
    return role(page, "spinbutton", f"Units of {case}")


def spin_value(locator: Locator) -> int:
    return int(locator.evaluate("e => e.value !== undefined && e.value !== '' ? e.value : e.getAttribute('aria-valuenow')"))


def turn(page: Page, case: str) -> Locator:
    return role(page, "slider", f"Turn crate of {case}")


def turned(page: Page, case: str) -> int:
    return int(turn(page, case).get_attribute("aria-valuenow"))


def step_to(page: Page, case: str, units: int) -> None:
    spin(page, case).focus()
    page.keyboard.press("Home")
    for _ in range(units):
        page.keyboard.press("ArrowUp")


def pledge_button(page: Page, case: str) -> Locator:
    return block(page, case).get_by_role("button", name=re.compile(rf"^(Pledge {re.escape(case)}|Saving\.\.\.)$"))


def live(page: Page, name: str) -> str:
    return squeeze(role(page, "status", name).text_content())


def announced(page: Page, region: str, copy: str, page_ms: int | None = None) -> None:
    pump(page, lambda: live(page, region) == copy, f"status {region} reads {copy!r}", page_ms)


def visible_text(page: Page) -> str:
    return squeeze(page.locator("body").inner_text())


def shows(page: Page, copy: str) -> bool:
    return copy in visible_text(page)


def reads_disabled(locator: Locator) -> bool:
    return locator.evaluate("e => e.disabled === true || e.getAttribute('aria-disabled') === 'true'")


def run_refresh(page: Page, cid: str) -> None:
    seen: list[Any] = []

    def watch(response):
        if response.request.method == "GET" and urlsplit(response.url).path == f"/api/cycles/{cid}":
            seen.append(response)

    page.on("response", watch)
    advance(page, REFRESH_EVERY_MS)
    pump(page, lambda: bool(seen), "the page asked GET /api/cycles/<id> within its 10 second refresh", GRACE_MS)
    seen[0].finished()
    page.remove_listener("response", watch)
    frames(page, 5)


def await_answer(page: Page, method: str, fragment: str, act: Callable[[], None]) -> None:
    seen: list[Any] = []

    def watch(response):
        if response.request.method == method and fragment in response.url:
            seen.append(response)

    page.on("response", watch)
    act()
    deadline = time.monotonic() + REAL_WAIT_S
    while time.monotonic() < deadline and not seen:
        page.evaluate("1")
    page.remove_listener("response", watch)
    assert seen, f"expected a {method} response for {fragment}"
    seen[0].finished()
    page.evaluate("1")


class StaleRefresh:

    def __init__(self, page: Page, cid: str):
        self.kept: tuple[Any, Any] | None = None
        self.armed = True
        self.glob = f"**/api/cycles/{cid}"
        self.page = page
        page.route(self.glob, self.handle)

    def handle(self, route):
        if self.armed and route.request.method == "GET":
            self.armed = False
            self.kept = (route, route.fetch())
        else:
            route.fallback()

    def deliver(self):
        route, response = self.kept
        route.fulfill(response=response)
        frames(self.page, 5)


def release(gate: Any) -> None:
    (gate.release if hasattr(gate, "release") else gate)()


def inside_viewport(page: Page, locator: Locator) -> None:
    box = locator.bounding_box()
    size = page.viewport_size
    assert box, "the element has a box on screen"
    assert box["x"] >= -0.5 and box["y"] >= -0.5 and box["x"] + box["width"] <= size["width"] + 0.5 and box["y"] + box["height"] <= size["height"] + 0.5, f"{box} is outside {size}"


def hit(locator: Locator) -> bool:
    x, y = center(locator)
    return locator.evaluate("(e, [x, y]) => { const t = document.elementFromPoint(x, y); return e === t || e.contains(t); }", [x, y])


def uncovered(locator: Locator) -> bool:
    try:
        return hit(locator)
    except AssertionError:
        return False


def big_enough(locator: Locator) -> None:
    box = locator.bounding_box()
    assert box and box["width"] >= TARGET_PX - 0.5 and box["height"] >= TARGET_PX - 0.5, f"control is {box}; expected at least 44 by 44"


def page_stays_put(page: Page) -> None:
    before = page.evaluate("window.scrollY")
    page.mouse.wheel(0, 400)
    frames(page)
    assert page.evaluate("window.scrollY") == before, "the page behind an open dialog scrolled"


def png_rgb(data: bytes) -> list[list[tuple[int, int, int]]]:
    assert data[:8] == PNG, "capture returned a PNG"
    pos, idat, width, height, kind = 8, b"", 0, 0, 0
    while pos < len(data):
        size = struct.unpack(">I", data[pos:pos + 4])[0]
        tag, body = data[pos + 4:pos + 8], data[pos + 8:pos + 8 + size]
        pos += 12 + size
        if tag == b"IHDR":
            width, height, _depth, kind = struct.unpack(">IIBB", body[:10])
        elif tag == b"IDAT":
            idat += body
    channels = {2: 3, 6: 4}[kind]
    raw, stride, at = zlib.decompress(idat), width * channels, 0
    previous, rows = bytearray(stride), []
    for _ in range(height):
        method = raw[at]
        line = bytearray(raw[at + 1:at + 1 + stride])
        at += stride + 1
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = previous[i]
            c = previous[i - channels] if i >= channels else 0
            if method == 1:
                line[i] = (line[i] + a) & 255
            elif method == 2:
                line[i] = (line[i] + b) & 255
            elif method == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif method == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append([tuple(line[x * channels:x * channels + 3]) for x in range(width)])
        previous = line
    return rows


def picture(locator: Locator) -> list[list[tuple[int, int, int]]]:
    return png_rgb(capture(locator))


def patches(image, colour) -> int:
    height, width = len(image), len(image[0])
    match = [[all(abs(p[i] - colour[i]) <= TOP_TOLERANCE for i in range(3)) for p in row] for row in image]
    solid = {(x, y) for y in range(height - 3) for x in range(width - 3) if all(match[y + j][x + i] for j in range(4) for i in range(4))}
    count = 0
    while solid:
        count += 1
        stack = [solid.pop()]
        while stack:
            x, y = stack.pop()
            for nx in (x - 1, x, x + 1):
                for ny in (y - 1, y, y + 1):
                    if (nx, ny) in solid:
                        solid.remove((nx, ny))
                        stack.append((nx, ny))
    return count


def cell_colour(page: Page, case: str, value: str) -> tuple[int, int, int]:
    image = picture(block(page, case).locator(f"[data-cell='{value}']").first)
    return image[len(image) // 2][len(image[0]) // 2]


def luminance(rgb) -> float:
    parts = [(c / 255) / 12.92 if c / 255 <= 0.03928 else (((c / 255) + 0.055) / 1.055) ** 2.4 for c in rgb]
    return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]


def contrast(a, b) -> float:
    la, lb = sorted((luminance(a), luminance(b)), reverse=True)
    return (la + 0.05) / (lb + 0.05)


def corners_match(page: Page, case: str) -> None:
    image = picture(crate(page, case))
    background = block(page, case).evaluate(EFFECTIVE_BG)
    for pixel in (image[1][1], image[1][-2], image[-2][1], image[-2][-2]):
        assert all(abs(pixel[i] - background[i]) <= TOP_TOLERANCE for i in range(3)), f"crate corner {pixel} differs from block background {background}"


def my_mail(mail, needle: str, count: int) -> list[dict]:
    def mine(settle):
        return [m for m in mail.messages(settle=settle) if needle in m["Subject"] or needle in text(m)]

    poll(lambda: len(mine(0)) >= count, f"Mailpit holds {count} message(s) naming {needle}")
    return mine(1.5)


def test_wf_setup_sign_in(browser, app_url):
    with open_app(browser, app_url + "/") as page:
        fill(role(page, "textbox", "Access code"), "WRONG-0000")
        click(role(page, "button", "Sign in"))
        pump(page, lambda: shows(page, "That code doesn't match anyone in this club."), "the published sign-in error shows")
        assert role(page, "button", "Sign out").count() == 0
    for code, home, who in ((COORD_CODE, "/coordinator", "Marisol Ferreira-Quinn"), (VOL_CODE, "/breakdown", "Desmond Achterberg"), ("HOME-1001", "/", "Okafor-Lindqvist household")):
        with signed_in(browser, app_url, code) as page:
            pump(page, lambda: path_of(page) == home, f"{code} lands on {home}")
            pump(page, lambda: all(x.casefold() in visible_text(page).casefold() for x in (who, "Elm Street Basement Co-op")), "the top bar names the club and the person")
    want(httpx.post(f"{app_url}/api/session", json={"code": "WRONG-0000"}), 401, "invalid_code")
    good = want(httpx.post(f"{app_url}/api/session", json={"code": "HOME-1001"}), 200)
    assert good.json() == {"role": "member", "name": "Okafor-Lindqvist household", "household_code": "HH-1001"}
    cookie = good.headers["set-cookie"].lower()
    assert cookie.startswith("tally_session=") and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie
    assert want(httpx.get(f"{app_url}/api/me", cookies=good.cookies), 200).json() == good.json()


def test_role_and_household_boundaries(app_url):
    coord, vol, a, b = coordinator(app_url), volunteer(app_url), household(app_url, "HH-1001"), household(app_url, "HH-1002")
    cid = open_cycle(coord)["id"]
    draft = want(coord.call("POST", "/api/cycles", {"name": fresh_name()}), 201).json()["id"]
    for path in ("/api/me", "/api/cycles", f"/api/cycles/{cid}", "/api/club", "/api/payments/status"):
        want(Api(app_url).call("GET", path), 401, "unauthenticated")
    base = f"/api/cycles/{cid}"
    member_barred = [
        ("GET", "/api/catalog", None, None), ("POST", "/api/cycles", {"name": fresh_name()}, None),
        ("PATCH", base, {"name": "x"}, None), ("POST", f"{base}/transitions", {"to": "open"}, None),
        ("POST", f"{base}/lines/P-TAHINI/resolution", {"action": "drop"}, None),
        ("POST", f"{base}/lines/P-TAHINI/shorts", {"units": 1}, idempotency_key()),
        ("GET", f"{base}/documents", None, None), ("GET", f"{base}/bags", None, None),
        ("GET", f"{base}/flags", None, None), ("GET", f"{base}/daily", None, None), ("GET", f"{base}/receipts", None, None),
    ]
    for method, path, body, key in member_barred:
        want(a.call(method, path, body, key=key), 403, "forbidden")
    want(upload(a, cid, "invoice", unique_pdf(), "application/pdf"), 403, "forbidden")
    want(a.call("GET", "/api/households/HH-1002/ledger"), 403, "forbidden")
    want(a.call("GET", "/api/households/HH-1001/ledger"), 200)
    want(vol.call("GET", "/api/households/HH-1001/ledger"), 403, "forbidden")
    want(vol.call("PUT", f"{base}/lines/P-TAHINI/pledge", {"units": 1}, key=idempotency_key()), 403, "forbidden")
    want(coord.call("POST", "/api/topups", {"amount": "5.00"}, key=idempotency_key()), 403, "forbidden")
    want(vol.call("GET", "/api/topups"), 403, "forbidden")
    want(vol.call("GET", f"{base}/receipts"), 403, "forbidden")
    want(coord.call("POST", f"{base}/bags/HH-1001/flags", {"product_id": "P-TAHINI", "units": 1}), 403, "forbidden")
    for who in (a, vol):
        want(who.call("GET", f"/api/cycles/{draft}"), 404, "not_found")
        assert draft not in [c["id"] for c in want(who.call("GET", "/api/cycles"), 200).json()["cycles"]]
    fund(a)
    want(pledge(a, cid, "P-TAHINI", 2), 200)
    other = b.line(cid, "P-TAHINI")
    assert "mine" not in other["cells"] and other["cells"].count("taken") == 2, "another household's units read as taken"
    assert coord.cycle(cid)["credit"] is None and coord.line(cid, "P-TAHINI")["my_units"] is None


def test_wf_setup_draft_and_open(browser, app_url):
    name = fresh_name()
    start = now()
    cutoff, pick_a, pick_b = start + timedelta(hours=2), start + timedelta(hours=3), start + timedelta(hours=5)
    with signed_in(browser, app_url, COORD_CODE, "/coordinator/cycles/new") as page:
        fill(role(page, "textbox", "Cycle name"), name)
        fill(role(page, "textbox", "Cutoff (club time)"), ui_time(cutoff))
        fill(role(page, "textbox", "Pickup starts (club time)"), ui_time(pick_a))
        fill(role(page, "textbox", "Pickup ends (club time)"), ui_time(pick_b))
        check(role(page, "checkbox", CASE["P-TAHINI"]))
        check(role(page, "checkbox", CASE["P-OLIVE"]))
        click(role(page, "button", "Save draft"))
        pump(page, lambda: re.fullmatch(r"/coordinator/cycles/cy-\d+", path_of(page)), "saving replaces the address with /coordinator/cycles/<cycle id>")
        announced(page, "Coordinator updates", f"Saved draft {name}.")
        cid = path_of(page).rsplit("/", 1)[1]
        coord = coordinator(app_url)
        saved = coord.cycle(cid)
        assert saved["status"] == "draft" and [l["product_id"] for l in saved["lines"]] == ["P-TAHINI", "P-OLIVE"]
        page.reload()
        field = role(page, "textbox", "Cycle name")
        pump(page, lambda: field.count() > 0 and field.input_value() == name, "reloading shows the saved draft")
        assert role(page, "checkbox", CASE["P-OLIVE"]).is_checked() and not role(page, "checkbox", CASE["P-OATS"]).is_checked()
        click(role(page, "button", "Open cycle"))
        announced(page, "Coordinator updates", f"{name} is now open.")
        assert path_of(page) == f"/coordinator/cycles/{cid}"
        opened = coord.cycle(cid)
        assert opened["status"] == "open" and opened["accepting_pledges"] is True
        pump(page, lambda: shows(page, f"CUTOFF {opened['cutoff_display']}") and shows(page, f"PICKUP {opened['pickup_display']}"), "the opened cycle prints its times")
    assert cid in [c["id"] for c in want(household(app_url, "HH-1001").call("GET", "/api/cycles"), 200).json()["cycles"]]


def test_no_open_cycle_message(browser, tmp_path):
    message = "There's no open cycle right now. The next case list appears here when the coordinator opens it."
    with app_copy(new_db(tmp_path)) as base:
        with signed_in(browser, base, "HOME-1001") as page:
            links = role(page, "list", "Open cycles").get_by_role("link", name="Cycle 44", exact=True)
            pump(page, lambda: links.count() == 1, "the open list links Cycle 44 while it is open")
            assert not shows(page, message)
            pass_cutoff(coordinator(base), "cy-44")
            page.reload()
            pump(page, lambda: shows(page, message), "the empty-cycle message shows when no cycle is open")
            assert role(page, "list", "Open cycles").count() == 0
            assert page.get_by_role("article").count() == 0


def test_wf_setup_landing(browser, app_url):
    _, cid, name, _ = setup_cycle(app_url, ("P-TAHINI",))
    target = f"/cycles/{cid}"
    with signed_in(browser, app_url, "HOME-1001", target) as page:
        on_cycle(page, CASE["P-TAHINI"])
        assert path_of(page) == target
        page.reload()
        on_cycle(page, CASE["P-TAHINI"])
        assert path_of(page) == target
        page.goto(app_url + "/")
        page.goto(app_url + target)
        on_cycle(page, CASE["P-TAHINI"])
        click(role(page, "button", "Sign out"))
        pump(page, lambda: path_of(page) == "/" and role(page, "textbox", "Access code").count() == 1, "sign-out shows the sign-in panel at /")
        assert accessible_name(page) == "Access code"
        page.go_back()
        pump(page, lambda: role(page, "textbox", "Access code").count() == 1, "Back after sign-out shows the sign-in panel")
        assert page.get_by_role("article").count() == 0 and not shows(page, name) and not shows(page, "Okafor-Lindqvist household")
    with open_app(browser, app_url + "/") as page:
        page.goto(app_url + target)
        sign_in(page, COORD_CODE)
        pump(page, lambda: path_of(page) == "/coordinator", "a coordinator on a member address lands on /coordinator")
        page.go_back()
        frames(page)
        assert path_of(page) != target, "Back must not return to the forbidden address"
    with signed_in(browser, app_url, VOL_CODE, "/coordinator") as page:
        pump(page, lambda: path_of(page) == "/breakdown", "a volunteer on a coordinator address lands on /breakdown")
    with signed_in(browser, app_url, "HOME-1001", "/credit") as page:
        pump(page, lambda: role(page, "table", "Credit history").count() == 1, "the credit history shows at /credit")
        assert path_of(page) == "/credit"
    with signed_in(browser, app_url, "HOME-1001", "/?next=/credit") as page:
        frames(page)
        assert path_of(page) == "/"
    with signed_in(browser, app_url, "HOME-1001", "/no-such-screen") as page:
        pump(page, lambda: role(page, "heading", "Page not found").count() == 1, "an unknown path shows Page not found")
        assert page.get_by_role("link").count() >= 1


def test_sign_out_forgets_page(browser, app_url):
    case = CASE["P-TAHINI"]
    coord, cid, name, members = setup_cycle(app_url, ("P-TAHINI",), [("HH-1001", "P-TAHINI", 3), ("HH-1002", "P-TAHINI", 2)], funded=True)
    second = members["HH-1002"]
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        pump(page, lambda: cells(page, case).count("mine") == 3, "the first household sees its 3 units")
        turn(page, case).focus()
        page.keyboard.press("End")
        assert turned(page, case) == TURN_MAX
        step_to(page, case, 7)
        click(role(page, "button", "Sign out"))
        pump(page, lambda: role(page, "textbox", "Access code").count() == 1, "sign-out shows the panel")
        sign_in(page, CODES["HH-1002"])
        link = role(page, "list", "Open cycles").get_by_role("link", name=name, exact=True)
        pump(page, lambda: link.count() == 1, "the next household's home lists the cycle")
        click(link)
        on_cycle(page, case)
        expected = second.line(cid, "P-TAHINI")["cells"]
        pump(page, lambda: cells(page, case) == expected, "the next household's cells come from its own session")
        assert cells(page, case).count("mine") == 2 and spin_value(spin(page, case)) == 2 and turned(page, case) == 0
        credit = second.credit()
        panel = squeeze(role(page, "region", "Credit").inner_text())
        assert usd(credit["spendable_cents"]) in panel and usd(credit["held_cents"]) in panel
        assert live(page, "Pledge updates") == ""
        assert not shows(page, "Okafor-Lindqvist household")
    a = household(app_url, "HH-1001")
    answers = race(*[(lambda m=m: (m.code, m.line(cid, "P-TAHINI")["my_units"], m.call("GET", "/api/me").json()["household_code"])) for m in [a, second] * 12])
    for code, units, me in answers:
        assert me == code and units == {"HH-1001": 3, "HH-1002": 2}[code], "a response carried another household's data"


def test_wf_member_pledge_confirmed_only(browser, app_url):
    case, pid = CASE["P-TAHINI"], "P-TAHINI"
    coord, cid, _, _ = setup_cycle(app_url, (pid,))
    me, other = household(app_url, "HH-1001"), household(app_url, "HH-1002")
    fund(me)
    fund(other)
    before = me.credit()
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        pump(page, lambda: crate_named(page, case, 0, 12, "filling"), "the crate is named")
        frames(page, 10)
        still = capture(crate(page, case))
        step_to(page, case, 2)
        with held(page, f"**/lines/{pid}/pledge") as gate:
            click(pledge_button(page, case))
            pump(page, lambda: squeeze(pledge_button(page, case).text_content()) == "Saving...", "the Pledge button reads Saving...")
            assert reads_disabled(pledge_button(page, case))
            frames(page, 10)
            assert cells(page, case).count("mine") == 0 and to_go(page, case) == 12 and crate_named(page, case, 0, 12, "filling")
            assert capture(crate(page, case)) == still, "the crate drew while the request was in flight"
            release(gate)
            pump(page, lambda: cells(page, case).count("mine") == 2 and to_go(page, case) == 10, "after the 200 the cells and numeral show the pledge")
        announced(page, "Pledge updates", f"Pledged 2 of {case}. 10 to go.")
        pump(page, lambda: crate_named(page, case, 2, 12, "filling"), "the crate name follows the server")
        line = me.line(cid, pid)
        assert line["my_units"] == 2 and line["pledged_units"] == 2 and line["cells"][:2] == ["mine", "mine"]
        now_credit = me.credit()
        assert now_credit["held_cents"] == before["held_cents"] + hold_of(pid, 2)
        assert usd(now_credit["spendable_cents"]) in squeeze(role(page, "region", "Credit").inner_text()) or pump(page, lambda: usd(now_credit["spendable_cents"]) in squeeze(role(page, "region", "Credit").inner_text()), "the panel shows spendable after the hold") is None
        step_to(page, case, 12)
        want(pledge(other, cid, pid, 9), 200)
        click(pledge_button(page, case))
        announced(page, "Pledge updates", f"Only 1 left on {case}. Your pledge was not changed.")
        pump(page, lambda: cells(page, case).count("mine") == 2, "a refusal leaves the household's own cells")
        assert me.line(cid, pid)["my_units"] == 2 and me.credit()["held_cents"] == now_credit["held_cents"]


def test_one_pledge_per_tap_or_retry(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, _ = setup_cycle(app_url, (pid,))
    me = household(app_url, "HH-1001")
    fund(me)
    key = idempotency_key()
    first = want(pledge(me, cid, pid, 2, key), 200)
    replay = want(pledge(me, cid, pid, 2, key), 200)
    assert replay.headers.get("Idempotent-Replay") == "true" and replay.json() == first.json()
    assert me.line(cid, pid)["version"] == first.json()["line"]["version"]
    want(pledge(me, cid, pid, 3, key), 409, "idempotency_key_reused")
    want(withdraw(me, cid, pid, key), 409, "idempotency_key_reused")
    assert me.line(cid, pid)["my_units"] == 2
    for bad in (None, "short", "bad key with spaces!!"):
        answer = me.call("PUT", f"/api/cycles/{cid}/lines/{pid}/pledge", {"units": 3}, headers={"Idempotency-Key": bad} if bad else None)
        want(answer, 422, "validation")
        assert "idempotency_key" in answer.json()["error"]["fields"]
    together = idempotency_key()
    version = me.line(cid, pid)["version"]
    answers = race(*[lambda: pledge(me, cid, pid, 4, together) for _ in range(5)])
    assert {a.status_code for a in answers} == {200} and len({a.text for a in answers}) == 1
    assert me.line(cid, pid)["version"] == version + 1 and me.line(cid, pid)["my_units"] == 4
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        step_to(page, case, 5)
        sent = []
        page.on("request", lambda r: sent.append(r) if r.method == "PUT" and "/pledge" in r.url else None)
        pledge_button(page, case).dblclick()
        pump(page, lambda: cells(page, case).count("mine") == 5, "the double tap ends on the chosen units")
        frames(page, 20)
        assert len(sent) == 1, f"a double tap sent {len(sent)} PUT requests"
    assert me.line(cid, pid)["my_units"] == 5


def test_units_to_go_follow_server_order(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, _ = setup_cycle(app_url, (pid,))
    a, b, c = household(app_url, "HH-1001"), household(app_url, "HH-1002"), household(app_url, "HH-1003")
    for m in (a, b, c):
        fund(m)

    def expect_line(order: list[tuple[str, int]]):
        line = b.line(cid, pid)
        pattern = [("mine" if who == "b" else "taken") for who, units in order for _ in range(units)]
        total = sum(units for _, units in order)
        assert line["cells"] == pattern + ["empty"] * (12 - total)
        assert line["pledged_units"] == total and line["units_to_go"] == 12 - total
        return line["version"]

    version = 1
    steps = [
        (lambda: pledge(a, cid, pid, 2), [("a", 2)]),
        (lambda: pledge(b, cid, pid, 3), [("a", 2), ("b", 3)]),
        (lambda: pledge(c, cid, pid, 1), [("a", 2), ("b", 3), ("c", 1)]),
        (lambda: pledge(a, cid, pid, 1), [("a", 1), ("b", 3), ("c", 1)]),
        (lambda: withdraw(a, cid, pid), [("b", 3), ("c", 1)]),
        (lambda: pledge(a, cid, pid, 2), [("b", 3), ("c", 1), ("a", 2)]),
    ]
    with signed_in(browser, app_url, "HOME-1002", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        for act, order in steps:
            want(act(), 200)
            version += 1
            assert expect_line(order) == version, "the line version rises by exactly 1 per committed change"
            run_refresh(page, cid)
            expected = b.line(cid, pid)
            pump(page, lambda: cells(page, case) == expected["cells"] and to_go(page, case) == expected["units_to_go"], "the page shows the server's order and number")


def test_last_units_race_across_processes(tmp_path):
    db = new_db(tmp_path)
    with app_copy(db) as one, app_copy(db) as two:
        coord = coordinator(one)
        cid = open_cycle(coord, ("P-QUINOA",))["id"]
        want(pledge(household(one, "HH-1001"), cid, "P-QUINOA", 8), 200)
        racers = [household(one, "HH-1002"), household(two, "HH-1003"), household(one, "HH-1004"), household(two, "HH-1005")]
        answers = race(*[(lambda m=m: pledge(m, cid, "P-QUINOA", 2)) for m in racers])
        wins = [a for a in answers if a.status_code == 200]
        assert len(wins) == 1, [a.status_code for a in answers]
        for loser in answers:
            if loser.status_code != 200:
                want(loser, 409, "not_enough_units")
        line = coord.line(cid, "P-QUINOA")
        assert line["pledged_units"] == 10 and line["units_to_go"] == 0 and line["status"] == "sealed"
        assert line["version"] == 3


def test_wf_member_pledge_live_redraw(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, members = setup_cycle(app_url, (pid,), [("HH-1002", pid, 3), ("HH-1001", pid, 2)], funded=True)
    other, me = members["HH-1002"], members["HH-1001"]
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        pump(page, lambda: cells(page, case)[3:5] == ["mine", "mine"], "the household's cells sit after the earlier pledger")
        page.evaluate("window.__sameDocument = true")
        for act, filled in ((lambda: pledge(other, cid, pid, 1), 3), (lambda: withdraw(other, cid, pid), 2), (lambda: pledge(other, cid, pid, 4), 6)):
            shown = cells(page, case)
            want(act(), 200)
            expected = me.line(cid, pid)
            pump(page, lambda: cells(page, case) != shown, "another household's change reaches the grid", REFRESH_WINDOW_MS)
            assert cells(page, case) == expected["cells"], "a refresh redraws every cell in one go, with no stagger"
            assert to_go(page, case) == expected["units_to_go"]
            assert spin(page, case).get_attribute("aria-valuemax") == str(expected["my_units"] + expected["units_to_go"])
            pump(page, lambda: crate_named(page, case, filled, 12, "filling"), "the crate name follows the redraw", GRACE_MS)
            assert role(page, "img", f"{filled} of 12 units pledged").count() == 1
        assert page.evaluate("window.__sameDocument") is True, "the page reloaded"
        assert live(page, "Pledge updates") == "", "a refresh wrote to the live region"


def test_stale_refresh_never_undoes_pledge(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, _ = setup_cycle(app_url, (pid,))
    me = household(app_url, "HH-1001")
    fund(me)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        stale = StaleRefresh(page, cid)
        pump(page, lambda: stale.kept is not None, "the page refreshes within 10 seconds", REFRESH_WINDOW_MS)
        step_to(page, case, 4)
        click(pledge_button(page, case))
        pump(page, lambda: cells(page, case).count("mine") == 4, "the confirmed pledge fills the cells")
        pump(page, lambda: to_go(page, case) == 8, "the numeral reaches the server's number")
        frames(page, 60)
        shown = capture(crate(page, case))
        stale.deliver()
        assert cells(page, case).count("mine") == 4 and to_go(page, case) == 8
        assert crate_named(page, case, 4, 12, "filling") and role(page, "img", "4 of 12 units pledged").count() == 1
        assert spin(page, case).get_attribute("aria-valuemax") == "12"
        assert capture(crate(page, case)) == shown, "an older line touched the crate"
    line = me.line(cid, pid)
    assert line["version"] == 2
    want(pledge(me, cid, pid, 5), 200)
    assert me.line(cid, pid)["version"] == 3
    me.cycle(cid)
    assert me.line(cid, pid)["version"] == 3, "reads never change a line version"


def test_wf_pledge_keyboard_stepping(browser, app_url):
    t, m = CASE["P-TAHINI"], CASE["P-MAPLE"]
    _, cid, _, members = setup_cycle(app_url, ("P-TAHINI", "P-MAPLE"), [("HH-1001", "P-TAHINI", 1), ("HH-1002", "P-MAPLE", 6)], funded=True)
    me = members["HH-1001"]
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, t)
        turn(page, t).focus()
        assert tab_order(page, 5) == [f"Fewer units of {t}", f"Units of {t}", f"More units of {t}", f"Pledge {t}", f"Withdraw from {t}"]
        sent = []
        page.on("request", lambda r: sent.append(r) if r.method == "PUT" else None)
        field = spin(page, t)
        field.focus()
        page.keyboard.press("ArrowUp")
        assert spin_value(field) == 2
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        assert spin_value(field) == 0
        page.keyboard.press("ArrowDown")
        assert spin_value(field) == 0
        page.keyboard.press("End")
        assert spin_value(field) == 12 == int(field.get_attribute("aria-valuemax"))
        page.keyboard.press("ArrowUp")
        assert spin_value(field) == 12
        page.keyboard.press("Home")
        assert spin_value(field) == 0
        for _ in range(3):
            page.keyboard.press("ArrowUp")
        frames(page)
        assert sent == [], "stepping alone sent a request"
        page.keyboard.press("Enter")
        pump(page, lambda: cells(page, t).count("mine") == 3, "Enter sends the chosen units")
        assert me.line(cid, "P-TAHINI")["my_units"] == 3 and accessible_name(page) == f"Units of {t}"
        for case in (t, m):
            assert crate(page, case).count() == 1
            assert page.get_by_role("slider", name=f"Turn crate of {case}", exact=True).count() == 1
            assert page.get_by_role("spinbutton", name=f"Units of {case}", exact=True).count() == 1
            assert page.get_by_role("button", name=f"Pledge {case}", exact=True).count() == 1
        assert crate(page, t).evaluate("e => e.tabIndex") < 0 or crate(page, t).get_attribute("tabindex") is None
        page.set_viewport_size(PHONE)
        pump(page, lambda: role(page, "tablist", "Cases").count() == 1, "the tab bar shows below 768")
        assert block(page, m).count() == 0, "the hidden panel's block is in the accessibility tree"
        role(page, "tab", "Open").focus()
        names = tab_order(page, 30)
        assert not [n for n in names if n and m in n], f"Tab reached a hidden-panel control: {names}"
        role(page, "tab", "Open").focus()
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        pump(page, lambda: block(page, m).count() == 1 and block(page, t).count() == 0, "keyboard selects the Sealed panel")


def test_wf_pledge_keyboard_announcements(browser, tmp_path):
    t, q, o, r = CASE["P-TAHINI"], CASE["P-QUINOA"], CASE["P-OLIVE"], CASE["P-OATS"]
    with app_copy(new_db(tmp_path)) as base:
        coord = coordinator(base)
        cid = open_cycle(coord, ("P-TAHINI", "P-QUINOA", "P-OLIVE", "P-OATS"))["id"]
        helper = household(base, "HH-1002")
        third = household(base, "HH-1003")
        want(pledge(helper, cid, "P-QUINOA", 9), 200)
        want(pledge(third, cid, "P-OATS", 23), 200)
        with signed_in(browser, base, "HOME-1001", f"/cycles/{cid}") as page:
            on_cycle(page, t)

            def send(case, units):
                step_to(page, case, units)
                page.keyboard.press("Enter")

            send(t, 2)
            announced(page, "Pledge updates", f"Pledged 2 of {t}. 10 to go.")
            pump(page, lambda: to_go(page, t) == 10, "the numeral ends on 10")
            send(t, 1)
            announced(page, "Pledge updates", f"Pledged 1 of {t}. 11 to go.")
            pump(page, lambda: to_go(page, t) == 11, "the numeral ends on 11")
            click(role(page, "button", f"Withdraw from {t}"))
            pump(page, lambda: role(page, "dialog", "Withdraw pledge").count() == 1, "the dialog opens")
            click(role(role(page, "dialog", "Withdraw pledge"), "button", "Withdraw"))
            announced(page, "Pledge updates", f"Withdrew from {t}. 12 to go.")
            send(q, 1)
            announced(page, "Pledge updates", f"Pledged 1 of {q}. Case sealed.")
            send(o, 6)
            announced(page, "Pledge updates", f"Not enough credit for {o}. Top up to pledge more.")
            step_to(page, r, 2)
            want(pledge(third, cid, "P-OATS", 24), 200)
            page.keyboard.press("Enter")
            announced(page, "Pledge updates", f"Only 1 left on {r}. Your pledge was not changed.")
            page.route("**/lines/P-TAHINI/pledge", lambda route: route.abort())
            send(t, 1)
            announced(page, "Pledge updates", f"Couldn't confirm your pledge on {t}. Check your connection and try again.")
            page.unroute("**/lines/P-TAHINI/pledge")
            step_to(page, t, 3)
            pass_cutoff(coord, cid)
            page.keyboard.press("Enter")
            announced(page, "Pledge updates", f"Cutoff has passed. {t} was not changed.")


def test_refresh_keeps_what_youre_doing(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, members = setup_cycle(app_url, (pid, "P-MAPLE"), [("HH-1001", pid, 1), ("HH-1002", "P-MAPLE", 6)], funded=True)
    other = household(app_url, "HH-1003")
    fund(other)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        step_to(page, case, 2)
        page.keyboard.press("Enter")
        announced(page, "Pledge updates", f"Pledged 2 of {case}. 10 to go.")
        pump(page, lambda: to_go(page, case) == 10, "the sequence ends")
        turn(page, case).focus()
        page.keyboard.press("ArrowRight")
        step_to(page, case, 9)
        want(pledge(other, cid, pid, 2), 200)
        run_refresh(page, cid)
        pump(page, lambda: to_go(page, case) == 8, "the refresh reaches the block", GRACE_MS)
        assert accessible_name(page) == f"Units of {case}", "the refresh moved focus"
        assert spin_value(spin(page, case)) == 9, "the refresh reset a stepped value"
        assert spin(page, case).get_attribute("aria-valuemax") == "10"
        assert turned(page, case) == TURN_STEP and live(page, "Pledge updates") == f"Pledged 2 of {case}. 10 to go."
        want(pledge(other, cid, pid, 8), 200)
        run_refresh(page, cid)
        pump(page, lambda: spin(page, case).get_attribute("aria-valuemax") == "4", "the maximum follows", GRACE_MS)
        assert spin_value(spin(page, case)) == 4, "a step above the new maximum is lowered to it"
        click(role(page, "button", "Top up"))
        amount = role(page, "textbox", "Amount in dollars")
        pump(page, lambda: amount.count() == 1, "the top-up dialog opens")
        typed_amount = "12.34"
        fill(amount, typed_amount)
        want(withdraw(other, cid, pid), 200)
        run_refresh(page, cid)
        assert role(page, "dialog", "Top up credit").count() == 1 and amount.input_value() == typed_amount
        assert accessible_name(page) == "Amount in dollars"
        page.keyboard.press("Escape")
        pump(page, lambda: role(page, "dialog", "Top up credit").count() == 0, "Escape closes the dialog")
        page.set_viewport_size(PHONE)
        pump(page, lambda: role(page, "tab", "Sealed").count() == 1, "the tab bar shows")
        click(role(page, "tab", "Sealed"))
        run_refresh(page, cid)
        assert role(page, "tab", "Sealed").get_attribute("aria-selected") == "true", "the refresh changed the selected tab"


def test_wf_withdraw_releases_hold(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, members = setup_cycle(app_url, (pid,), [("HH-1001", pid, 3)], funded=True)
    me = members["HH-1001"]
    held_before = me.credit()["held_cents"]
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        click(role(page, "button", f"Withdraw from {case}"))
        dialog = role(page, "dialog", "Withdraw pledge")
        pump(page, lambda: dialog.count() == 1, "the withdraw dialog opens")
        assert f"Withdraw your 3 from {case}?" in squeeze(dialog.inner_text())
        click(role(dialog, "button", "Withdraw"))
        announced(page, "Pledge updates", f"Withdrew from {case}. 12 to go.")
        pump(page, lambda: cells(page, case) == ["empty"] * 12 and to_go(page, case) == 12, "the cells empty and the numeral counts up")
        pump(page, lambda: accessible_name(page) == f"Units of {case}", "focus settles on the spinbutton")
        assert role(page, "button", f"Withdraw from {case}").count() == 0
    assert me.credit()["held_cents"] == held_before - hold_of(pid, 3)
    assert me.line(cid, pid)["my_units"] in (0, None) or me.line(cid, pid)["my_units"] == 0
    want(withdraw(me, cid, pid), 404, "not_found")


def test_wf_withdraw_after_cutoff(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    coord, cid, name, members = setup_cycle(app_url, (pid,), [("HH-1001", pid, 3)], funded=True)
    me = members["HH-1001"]
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        click(role(page, "button", f"Withdraw from {case}"))
        dialog = role(page, "dialog", "Withdraw pledge")
        pump(page, lambda: dialog.count() == 1, "the withdraw dialog opens")
        held_now = me.credit()["held_cents"]
        pass_cutoff(coord, cid)
        click(role(dialog, "button", "Withdraw"))
        announced(page, "Pledge updates", f"Cutoff has passed. {case} was not changed.")
        pump(page, lambda: shows(page, f"Cutoff has passed. Pledges for {name} are closed."), "the cutoff banner shows")
    want(withdraw(me, cid, pid), 409, "cutoff_passed")
    assert me.line(cid, pid)["my_units"] == 3 and me.credit()["held_cents"] == held_now


def test_withdraw_dialog_focus(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    _, cid, _, members = setup_cycle(app_url, (pid,), [("HH-1001", pid, 2)], funded=True)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        opener = role(page, "button", f"Withdraw from {case}")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Withdraw pledge")
        pump(page, lambda: dialog.count() == 1 and accessible_name(page) == "Keep pledge", "the dialog opens with focus on Keep pledge")
        assert set(tab_order(page, 6)) == {"Keep pledge", "Withdraw"}, "Tab left the dialog"
        role(dialog, "button", "Keep pledge").focus()
        page.keyboard.press("Escape")
        pump(page, lambda: accessible_name(page) == f"Withdraw from {case}", "Escape returns focus to the opener")
        page.keyboard.press("Enter")
        pump(page, lambda: dialog.count() == 1 and accessible_name(page) == "Keep pledge", "reopening during exit keeps the dialog with its opening focus")
        advance(page, 2000)
        frames(page)
        assert dialog.count() == 1 and dialog.is_visible() and accessible_name(page) == "Keep pledge", "a stale close timer hid the reopened dialog"
        inside_viewport(page, dialog)
        click(role(dialog, "button", "Keep pledge"))
        pump(page, lambda: dialog.count() == 0 or not dialog.is_visible(), "Keep pledge closes the dialog")
        pump(page, lambda: accessible_name(page) == f"Withdraw from {case}", "Keep pledge returns focus")
        step_to(page, case, 0)
        page.keyboard.press("Enter")
        pump(page, lambda: dialog.count() == 1, "choosing 0 and pledging opens the withdraw dialog")
    assert members["HH-1001"].line(cid, pid)["my_units"] == 2


def test_withdraw_by_touch_on_phone(browser, app_url):
    pid, case = "P-OLIVE", CASE["P-OLIVE"]
    _, cid, _, members = setup_cycle(app_url, (pid,), [("HH-1004", pid, 4), ("HH-1002", pid, 2)], funded=True)
    with signed_in(browser, app_url, "HOME-1002", f"/cycles/{cid}", PHONE, reduced_motion="reduce") as page:
        sealed = role(page, "tab", "Sealed")
        pump(page, lambda: sealed.count() == 1, "the tab bar shows at 375")
        tap(sealed)
        on_cycle(page, case)
        assert "Sealed" in squeeze(block(page, case).inner_text())
        for name in (f"Fewer units of {case}", f"More units of {case}", f"Withdraw from {case}"):
            big_enough(role(page, "button", name))
        tap(role(page, "button", f"Withdraw from {case}"))
        dialog = role(page, "dialog", "Withdraw pledge")
        pump(page, lambda: dialog.count() == 1, "the dialog opens")
        frames(page)
        inside_viewport(page, dialog)
        for name in ("Withdraw", "Keep pledge"):
            big_enough(role(dialog, "button", name))
            assert hit(role(dialog, "button", name))
        page_stays_put(page)
        tap(role(dialog, "button", "Withdraw"))
        pump(page, lambda: accessible_name(page) == "Open", "unsealing from the Sealed tab moves focus to the Open tab")
        assert sealed.get_attribute("aria-selected") == "true", "unsealing changed the selected tab"
        assert block(page, case).count() == 0, "the unsealed block left the Sealed panel"
    line = members["HH-1002"].line(cid, pid)
    assert line["status"] == "filling" and line["units_to_go"] == 2


def test_wf_top_up_confirmed(browser, app_url, killbill):
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI",))
    me = household(app_url, "HH-1003")
    before = me.credit()
    with signed_in(browser, app_url, "HOME-1003", f"/cycles/{cid}") as page:
        on_cycle(page, CASE["P-TAHINI"])
        keys = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key")) if r.method == "POST" and r.url.endswith("/api/topups") else None)
        opener = role(page, "button", "Top up")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Top up credit")
        pump(page, lambda: accessible_name(page) == "Amount in dollars", "the dialog opens with focus in the amount")
        fill(role(page, "textbox", "Amount in dollars"), "19.99")
        panel_before = squeeze(role(page, "region", "Credit").inner_text())
        with held(page, "**/api/topups") as gate:
            click(dialog.get_by_role("button", name=re.compile(r"^Confirm top-up$|^Confirming\.\.\.$")))
            confirm = dialog.get_by_role("button", name=re.compile(r"^Confirm top-up$|^Confirming\.\.\.$"))
            pump(page, lambda: squeeze(confirm.text_content()) == "Confirming...", "the button reads Confirming...")
            assert reads_disabled(confirm) and squeeze(role(page, "region", "Credit").inner_text()) == panel_before
            release(gate)
            after = before["spendable_cents"] + 1999
            announced(page, "Credit updates", f"Top-up of $19.99 confirmed. Spendable credit is now {usd(after)}.")
        pump(page, lambda: dialog.count() == 0 and accessible_name(page) == "Top up", "the dialog closes and focus returns to Top up")
        pump(page, lambda: usd(after) in squeeze(role(page, "region", "Credit").inner_text()), "the panel shows the server's credit")
    external = f"topup-HH-1003-{keys[0]}"
    payment = killbill.payment_by_key(external)
    assert payment and payment["paymentExternalKey"] == external
    purchases = [t for t in payment["transactions"] if t["transactionType"] == "PURCHASE"]
    assert len(purchases) == 1 and purchases[0]["status"] == "SUCCESS" and Decimal(str(purchases[0]["amount"])) == Decimal("19.99")
    assert purchases[0]["transactionExternalKey"] == external
    assert killbill.default_plugin(payment["accountId"]), "the household's account has a default payment method"
    newest = me.call("GET", "/api/households/HH-1003/ledger?limit=1").json()["movements"][0]
    assert newest["kind"] == "top_up" and newest["memo"] == "Top-up"
    assert {l["account"]: l["amount_cents"] for l in newest["legs"]} == {"household:HH-1003": 1999, "clearing:killbill": -1999}
    assert me.credit()["balance_cents"] == before["balance_cents"] + 1999


def test_wf_top_up_bad_amount_recovery(browser, app_url, killbill):
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI",))
    me = household(app_url, "HH-1003")
    before = me.credit()
    with signed_in(browser, app_url, "HOME-1003", f"/cycles/{cid}") as page:
        on_cycle(page, CASE["P-TAHINI"])
        keys = []
        page.on("request", lambda r: keys.append(r.headers.get("idempotency-key")) if r.method == "POST" and r.url.endswith("/api/topups") else None)
        click(role(page, "button", "Top up"))
        amount = role(page, "textbox", "Amount in dollars")
        pump(page, lambda: amount.count() == 1, "the dialog opens")
        fill(amount, "4.999")
        click(role(page, "button", "Confirm top-up"))
        copy = "Enter an amount from $5.00 to $500.00."
        pump(page, lambda: shows(page, copy), "the published amount error shows")
        expect(amount).to_have_accessible_description(copy)
        assert role(page, "dialog", "Top up credit").count() == 1 and amount.input_value() == "4.999"
        assert me.credit()["balance_cents"] == before["balance_cents"]
        assert all(killbill.payment_by_key(f"topup-HH-1003-{k}") is None for k in keys), "a refused amount reached Kill Bill"
        fill(amount, "6.50")
        click(role(page, "button", "Confirm top-up"))
        pump(page, lambda: role(page, "dialog", "Top up credit").count() == 0, "the corrected amount closes the dialog")
    assert me.credit()["balance_cents"] == before["balance_cents"] + 650


def test_landed_payment_confirmed_once(tmp_path, killbill):
    relay = KillBillRelay()
    db = new_db(tmp_path)
    try:
        with app_copy(db, KILLBILL_URL=relay.url) as base:
            me = household(base, "HH-1006")
            relay.lose = lambda method, path: method == "POST" and "/payments" in path
            landed_cents = int(Decimal("12.34") * 100)
            key, first = top_up(me, "12.34")
            want(first, 503, "payments_paused")
            assert me.credit()["balance_cents"] == 0, "an unconfirmed top-up added credit"
            relay.lose = lambda method, path: False
            external = f"topup-HH-1006-{key}"
            landed = killbill.payment_by_key(external)
            assert landed, "the relay forwarded the payment to Kill Bill"
            posts = len([j for j in relay.journal if j[0] == "POST" and "/payments" in j[1]])
            _, second = top_up(me, "12.34", key)
            assert want(second, 201).json()["credit"]["balance_cents"] == landed_cents
            assert len([j for j in relay.journal if j[0] == "POST" and "/payments" in j[1]]) == posts, "the retry created a second payment"
            account = killbill.account_by_key(f"{prefix_of(db)}-HH-1006")
            assert account and account["email"] == "hh1006@elmstreet.example" and account["currency"] == "USD" and account["name"] == HOUSEHOLD["HH-1006"]
            assert len([p for p in killbill.payments(account["accountId"]) if p["paymentExternalKey"] == external]) == 1
            assert [m["kind"] for m in all_movements(me)].count("top_up") == 1
            relay.lose = lambda method, path: method == "POST" and "/payments" in path
            other, third = top_up(me, "20.00")
            want(third, 503, "payments_paused")
            relay.lose = lambda method, path: False
            _, wrong = top_up(me, "21.00", other)
            want(wrong, 409, "idempotency_key_reused")
            assert me.credit()["balance_cents"] == landed_cents, "a key found with another amount recorded something"
    finally:
        relay.stop()


def test_spendable_credit_and_holds(browser, tmp_path):
    db = new_db(tmp_path)
    table = {"HH-1001": 4596, "HH-1002": 6040, "HH-1003": 4432, "HH-1004": 3500, "HH-1005": 1500, "HH-1006": 0}
    with app_copy(db) as one, app_copy(db) as two:
        for code, cents in table.items():
            assert household(one, code).credit()["spendable_cents"] == cents, code
        a = household(one, "HH-1005")
        b = household(two, "HH-1005")
        for _ in range(3):
            answers = race(lambda: pledge(a, "cy-44", "P-OLIVE", 1), lambda: pledge(b, "cy-44", "P-TAHINI", 1))
            codes = sorted(r.status_code for r in answers)
            assert codes == [200, 409], f"exactly one pledge must win: {[r.text[:200] for r in answers]}"
            loser = next(r for r in answers if r.status_code == 409)
            assert loser.json()["error"]["code"] == "insufficient_credit"
            credit = a.credit()
            assert credit["spendable_cents"] >= 0 and credit["balance_cents"] - credit["held_cents"] == credit["spendable_cents"]
            winner = 0 if answers[0].status_code == 200 else 1
            want(withdraw(a, "cy-44", ("P-OLIVE", "P-TAHINI")[winner]), 200)
            assert a.credit()["spendable_cents"] == table["HH-1005"], "a withdrawal releases its hold"
        want(pledge(a, "cy-44", "P-OLIVE", 2), 409, "insufficient_credit")
        assert a.credit()["held_cents"] == 0
        with signed_in(browser, one, "HOME-1001", "/cycles/cy-44") as page:
            on_cycle(page, CASE["P-TAHINI"])
            panel = squeeze(role(page, "region", "Credit").inner_text()).upper()
            for label, cents in (("BALANCE", 12000), ("HELD", 7404), ("SPENDABLE", 4596)):
                assert label in panel and usd(cents) in panel


def test_wf_top_up_payments_paused(browser, app_url, killbill):
    down = outage("APP_KILLBILL_DOWN_URL")
    fund(household(app_url, "HH-1001"))
    me = household(down, "HH-1001")
    coord = coordinator(down)
    cid = open_cycle(coord, ("P-RICE",))["id"]
    before = me.credit()
    typed = "10.00"
    key, refused = top_up(me, typed)
    want(refused, 503, "payments_paused")
    assert killbill.payment_by_key(f"topup-HH-1001-{key}") is None
    assert me.credit() == before, "a refused top-up changed credit"
    assert want(me.call("GET", "/api/payments/status"), 200).json() == {"payments": "paused"}
    banner = "Payments are paused. We can't take top-ups right now; your credit and pledges are safe."
    with signed_in(browser, down, "HOME-1001", f"/cycles/{cid}") as page:
        case = CASE["P-RICE"]
        on_cycle(page, case)
        pump(page, lambda: shows(page, banner), "the payments-paused banner shows")
        assert banner in squeeze(role(page, "region", "Notices").inner_text())
        click(role(page, "button", "Top up"))
        amount = role(page, "textbox", "Amount in dollars")
        pump(page, lambda: amount.count() == 1, "the dialog opens")
        fill(amount, typed)
        click(role(page, "button", "Confirm top-up"))
        announced(page, "Credit updates", "Top-up not taken. Your credit has not changed.")
        assert role(page, "dialog", "Top up credit").count() == 1 and amount.input_value() == typed
        assert accessible_name(page) == "Confirm top-up"
        page.keyboard.press("Escape")
        pump(page, lambda: role(page, "dialog", "Top up credit").count() == 0, "Escape closes the dialog")
        step_to(page, case, 1)
        page.keyboard.press("Enter")
        pump(page, lambda: cells(page, case).count("mine") == 1, "a pledge against existing credit works during the outage")
    assert want(household(app_url, "HH-1001").call("GET", "/api/payments/status"), 200).json() == {"payments": "available"}


AMOUNT_CASES = {
    "cents": ("19.99", 1999),
    "one_decimal": ("$250.5", 25050),
    "spaces": ("  7.05  ", 705),
    "whole": ("5", 500),
    "top": ("500.00", 50000),
    "trailing_dot": ("5.", None),
    "exponent": ("1e2", None),
    "negative": ("-5", None),
    "bad_group": ("$1,00", None),
    "three_decimals": ("4.999", None),
    "empty": ("", None),
    "below": ("4.99", None),
    "above": ("500.01", None),
    "grouped_above": ("1,000", None),
}


@pytest.mark.parametrize("case", list(AMOUNT_CASES), ids=list(AMOUNT_CASES))
def test_typed_dollars_exact_cents(app_url, killbill, case):
    typed, cents = AMOUNT_CASES[case]
    me = household(app_url, "HH-1004")
    before = me.credit()["balance_cents"]
    key, answer = top_up(me, typed)
    external = f"topup-HH-1004-{key}"
    if cents is None:
        want(answer, 422, "validation")
        assert "amount" in answer.json()["error"]["fields"]
        assert killbill.payment_by_key(external) is None and me.credit()["balance_cents"] == before
        return
    body = want(answer, 201).json()
    assert body["topup"]["amount_cents"] == cents and body["topup"]["status"] == "confirmed"
    assert body["credit"]["balance_cents"] == before + cents
    purchase = next(t for t in killbill.payment_by_key(external)["transactions"] if t["transactionType"] == "PURCHASE")
    assert Decimal(str(purchase["amount"])) == Decimal(cents) / 100 and purchase["status"] == "SUCCESS"


def test_top_up_retried_without_double_charge(browser, app_url, killbill):
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI",))
    me = household(app_url, "HH-1002")
    before = me.credit()
    count_before = want(me.call("GET", "/api/topups"), 200).json()["topups"]
    keys: list[str] = []
    lost = {"next": True}

    def lossy(route):
        keys.append(route.request.headers.get("idempotency-key"))
        if lost["next"]:
            lost["next"] = False
            route.fetch()
            route.abort()
        else:
            route.fallback()

    with signed_in(browser, app_url, "HOME-1002", f"/cycles/{cid}") as page:
        on_cycle(page, CASE["P-TAHINI"])
        page.route("**/api/topups", lossy)
        click(role(page, "button", "Top up"))
        amount = role(page, "textbox", "Amount in dollars")
        pump(page, lambda: amount.count() == 1, "the dialog opens")
        typed = "11.11"
        cents = int(Decimal(typed) * 100)
        fill(amount, typed)
        confirm = role(page, "button", "Confirm top-up")
        click(confirm)
        pump(page, lambda: shows(page, "Couldn't confirm your top-up. Check your connection and try again."), "the no-response copy shows")
        assert amount.input_value() == typed and accessible_name(page) == "Confirm top-up"
        click(confirm)
        after = before["spendable_cents"] + cents
        announced(page, "Credit updates", f"Top-up of ${typed} confirmed. Spendable credit is now {usd(after)}.")
        assert keys[0] == keys[1], "the retry from the open dialog must reuse its key"
        external = f"topup-HH-1002-{keys[0]}"
        assert killbill.payment_by_key(external)
        assert me.credit()["balance_cents"] == before["balance_cents"] + cents
        topups = want(me.call("GET", "/api/topups"), 200).json()["topups"]
        assert len(topups) == len(count_before) + 1
        want(top_up(me, "11.12", keys[0])[1], 409, "idempotency_key_reused")
        assert me.credit()["balance_cents"] == before["balance_cents"] + cents
        lost["next"] = True
        keys.clear()
        pump(page, lambda: uncovered(role(page, "button", "Top up")), "the closed dialog has left", 1000)
        click(role(page, "button", "Top up"))
        pump(page, lambda: amount.count() == 1, "the dialog reopens")
        fill(amount, "7.00")
        click(confirm)
        pump(page, lambda: len(keys) == 1 and shows(page, "Couldn't confirm your top-up. Check your connection and try again."), "the second attempt loses its reply")
        fill(amount, "8.00")
        click(confirm)
        pump(page, lambda: role(page, "dialog", "Top up credit").count() == 0, "the edited amount goes through")
        assert keys[1] != keys[0], "an edited amount must get a new key"


def test_wf_top_up_recovers_without_restart(browser, tmp_path):
    relay = KillBillRelay(up=False)
    banner = "Payments are paused. We can't take top-ups right now; your credit and pledges are safe."
    try:
        with app_copy(new_db(tmp_path), KILLBILL_URL=relay.url) as base:
            me = household(base, "HH-1001")
            want(top_up(me, "9.00")[1], 503, "payments_paused")
            with signed_in(browser, base, "HOME-1001", "/cycles/cy-44") as page:
                case = CASE["P-TAHINI"]
                on_cycle(page, case)
                pump(page, lambda: shows(page, banner), "the banner shows while Kill Bill is unreachable")
                spin(page, case).focus()
                relay.up = True
                poll(lambda: me.call("GET", "/api/payments/status").json()["payments"] == "available", "GET /api/payments/status returns available once Kill Bill answers")
                pump(page, lambda: not shows(page, banner), "the banner clears without a reload", REFRESH_WINDOW_MS)
                assert accessible_name(page) == f"Units of {case}" and live(page, "Credit updates") == ""
            assert want(top_up(me, "9.00")[1], 201).json()["credit"]["balance_cents"] == CARRIED_1001 + int(Decimal("9.00") * 100)
    finally:
        relay.stop()


def test_server_decides_cutoff(app_url):
    pid = "P-RICE"
    coord, cid, _, members = setup_cycle(app_url, (pid,), [("HH-1001", pid, 1)], funded=True)
    me = members["HH-1001"]
    moved = coord.cycle(cid)
    later = now() + timedelta(hours=1)
    assert want(coord.call("PATCH", f"/api/cycles/{cid}", {"cutoff_local": local(later)}, etag=etag_of(moved)), 200).json()["accepting_pledges"] is True
    want(pledge(me, cid, pid, 2), 200)
    pass_cutoff(coord, cid)
    cycle = coord.cycle(cid)
    assert cycle["status"] == "sealing" and cycle["accepting_pledges"] is False
    assert datetime.strptime(cycle["cutoff_at"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) <= now()
    listed = next(c for c in want(me.call("GET", "/api/cycles"), 200).json()["cycles"] if c["id"] == cid)
    assert listed["status"] == "sealing"
    version = me.line(cid, pid)["version"]
    want(pledge(me, cid, pid, 3), 409, "cutoff_passed")
    want(withdraw(me, cid, pid), 409, "cutoff_passed")
    line = me.line(cid, pid)
    assert line["my_units"] == 2 and line["version"] == version


def test_wf_cutoff_page_left_open(browser, app_url):
    pid, case = "P-RICE", CASE["P-RICE"]
    coord, cid, name, _ = setup_cycle(app_url, (pid,))
    member = household(app_url, "HH-1001")
    fund(member)
    long_ago = datetime(2001, 1, 1, tzinfo=timezone.utc)
    far_ahead = datetime(2090, 1, 1, tzinfo=timezone.utc)
    banner = f"Cutoff has passed. Pledges for {name} are closed."
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as behind, signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as ahead:
        behind.clock.set_system_time(long_ago)
        ahead.clock.set_system_time(far_ahead)
        on_cycle(behind, case)
        on_cycle(ahead, case)
        assert not shows(ahead, banner), "a device clock past cutoff closed an open cycle"
        step_to(ahead, case, 1)
        ahead.keyboard.press("Enter")
        pump(ahead, lambda: cells(ahead, case).count("mine") == 1, "the page with a fast clock still pledges")
        step_to(ahead, case, 2)
        pass_cutoff(coord, cid)
        ahead.keyboard.press("Enter")
        announced(ahead, "Pledge updates", f"Cutoff has passed. {case} was not changed.")
        pump(ahead, lambda: shows(ahead, banner) and reads_disabled(pledge_button(ahead, case)), "the next attempt shows the banner and disables pledging")
        pump(behind, lambda: shows(behind, banner), "a page left open shows the banner within 12 seconds", REFRESH_WINDOW_MS)
        assert banner in squeeze(role(behind, "region", "Notices").inner_text())
        assert reads_disabled(pledge_button(behind, case)), "pledge controls stay enabled after cutoff"
        pump(behind, lambda: to_go(behind, case) == 49, "the block stays as the server left it")
    assert member.line(cid, pid)["my_units"] == 1


def test_club_time_on_every_device(browser, app_url):
    coord = coordinator(app_url)
    example = want(coord.call("POST", "/api/cycles", {"name": fresh_name(), "cutoff_local": "2026-11-05T20:00"}), 201).json()
    assert example["cutoff_display"] == "Thu 5 Nov, 8:00 pm CST"
    cycle = open_cycle(coord, ("P-TAHINI",))
    cid = cycle["id"]
    for zone in ("Asia/Tokyo", "Pacific/Honolulu"):
        with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": zone})
            page.reload()
            on_cycle(page, CASE["P-TAHINI"])
            pump(page, lambda: shows(page, f"CUTOFF {cycle['cutoff_display']}") and shows(page, f"PICKUP {cycle['pickup_display']}"), f"member page in {zone} prints the API strings")
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Asia/Tokyo"})
        page.reload()
        pump(page, lambda: shows(page, f"CUTOFF {cycle['cutoff_display']}"), "the coordinator page prints the same string")
    assert re.search(r" (CST|CDT)$", cycle["cutoff_display"]), cycle["cutoff_display"]


def test_cutoff_edges(app_url):
    pid = "P-RICE"
    coord, cid, _, _ = setup_cycle(app_url, (pid,))
    me = household(app_url, "HH-1001")
    fund(me)
    key, gone = idempotency_key(), idempotency_key()
    stored = want(pledge(me, cid, pid, 2, key), 200)
    want(pledge(me, cid, pid, 3), 200)
    stored_again = want(withdraw(me, cid, pid, gone), 200)
    want(pledge(me, cid, pid, 3), 200)
    cycle = coord.cycle(cid)
    when = now() + timedelta(seconds=2)
    want(coord.call("PATCH", f"/api/cycles/{cid}", {"cutoff_local": local(when)}, etag=etag_of(cycle)), 200)
    revision = cycle["revision"] + 1
    probe = Api(app_url)
    poll(lambda: probe.call("GET", "/api/health").status_code == 200 and now() >= when + timedelta(seconds=1), "the published cutoff instant has passed")
    late = coord.call("PATCH", f"/api/cycles/{cid}", {"cutoff_local": local(now() + timedelta(hours=1))}, etag=f'"r{revision}"')
    want(late, 409, "wrong_cycle_state")
    replay = want(pledge(me, cid, pid, 2, key), 200)
    assert replay.headers.get("Idempotent-Replay") == "true" and replay.json() == stored.json()
    again = want(withdraw(me, cid, pid, gone), 200)
    assert again.headers.get("Idempotent-Replay") == "true" and again.json() == stored_again.json()
    want(pledge(me, cid, pid, 4), 409, "cutoff_passed")
    want(withdraw(me, cid, pid), 409, "cutoff_passed")
    after = coord.cycle(cid)
    assert after["status"] == "sealing" and after["revision"] == revision
    assert after["lines"][0]["pledged_units"] == 3


def test_no_lost_cycle_edits(browser, tmp_path):
    db = new_db(tmp_path)
    with app_copy(db) as one, app_copy(db) as two:
        c1, c2 = coordinator(one), coordinator(two)
        cycle = open_cycle(c1, ("P-TAHINI",))
        cid, name, tag = cycle["id"], cycle["name"], etag_of(cycle)
        want(c1.call("PATCH", f"/api/cycles/{cid}", {"pickup_end_local": local(now() + timedelta(hours=5))}), 428, "precondition_required")
        def edit(api, minutes):
            return lambda: api.call("PATCH", f"/api/cycles/{cid}", {"pickup_end_local": local(now() + timedelta(hours=4, minutes=minutes))}, etag=tag)
        answers = race(*[edit(c1 if i % 2 else c2, i) for i in range(6)])
        wins = [a for a in answers if a.status_code == 200]
        assert len(wins) == 1, [a.status_code for a in answers]
        current = c1.cycle(cid)
        assert current["revision"] == cycle["revision"] + 1
        for loser in answers:
            if loser.status_code != 200:
                want(loser, 412, "stale_cycle")
                assert loser.headers["etag"] == etag_of(current)
        assert current["pickup_end_at"] == wins[0].json()["pickup_end_at"]
        with signed_in(browser, one, COORD_CODE, f"/coordinator/cycles/{cid}") as first, signed_in(browser, two, COORD_CODE, f"/coordinator/cycles/{cid}") as second:
            field_a = role(first, "textbox", "Pickup ends (club time)")
            field_b = role(second, "textbox", "Pickup ends (club time)")
            pump(first, lambda: field_a.count() == 1, "the first screen shows the time fields")
            pump(second, lambda: field_b.count() == 1, "the second screen shows the time fields")
            winner = now() + timedelta(hours=6)
            fill(field_a, ui_time(winner))
            click(role(first, "button", "Save times"))
            announced(first, "Coordinator updates", f"Saved times for {name}.")
            fill(field_b, ui_time(now() + timedelta(hours=7)))
            click(role(second, "button", "Save times"))
            announced(second, "Coordinator updates", f"Someone else changed {name}. The latest times are shown; check them and save again.")
            assert field_b.input_value() == ui_time(winner).rsplit(":", 1)[0] or field_b.input_value() == ui_time(winner)
            pump(second, lambda: accessible_name(second) == "Save times", "focus stays on Save times")
        assert c1.cycle(cid)["pickup_end_at"] == winner.strftime("%Y-%m-%dT%H:%M:%SZ")


def test_wf_cutoff_coordinator_across(browser, app_url):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    coord, cid, name, _ = setup_cycle(app_url, (pid,))
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        pickup = role(page, "textbox", "Pickup starts (club time)")
        pump(page, lambda: pickup.count() == 1 and role(page, "textbox", "Cutoff (club time)").count() == 1, "the time fields show while open")
        typed = ui_time(now() + timedelta(hours=9))
        click(role(page, "button", "Save times"))
        announced(page, "Coordinator updates", f"Saved times for {name}.")
        fill(pickup, typed)
        pickup.focus()
        pass_cutoff(coord, cid)
        pump(page, lambda: role(page, "textbox", "Cutoff (club time)").count() == 0 and role(page, "button", f"Drop {case}").count() == 1, "the page changes within 12 seconds with no reload", REFRESH_WINDOW_MS)
        assert role(page, "button", f"Take up {case}").count() == 1
        assert pickup.input_value() == typed, "the refresh discarded a typed pickup time"
        assert accessible_name(page) == "Pickup starts (club time)", "the refresh moved focus"
        assert live(page, "Coordinator updates") == f"Saved times for {name}."
        assert "12 TO GO" in squeeze(role(page, "region", "At cutoff").inner_text())


def test_refusal_outranks_inflight_refresh(browser, app_url):
    pid, case = "P-RICE", CASE["P-RICE"]
    coord, cid, name, _ = setup_cycle(app_url, (pid,))
    fund(household(app_url, "HH-1001"))
    banner = f"Cutoff has passed. Pledges for {name} are closed."
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        stale = StaleRefresh(page, cid)
        pump(page, lambda: stale.kept is not None, "the page refreshes within 10 seconds", REFRESH_WINDOW_MS)
        assert json.loads(stale.kept[1].text())["accepting_pledges"] is True
        pass_cutoff(coord, cid)
        step_to(page, case, 1)
        page.keyboard.press("Enter")
        announced(page, "Pledge updates", f"Cutoff has passed. {case} was not changed.")
        pump(page, lambda: shows(page, banner), "the refusal shows the cutoff banner")
        stale.deliver()
        assert shows(page, banner), "an earlier refresh removed the cutoff banner"
        assert reads_disabled(pledge_button(page, case)), "an earlier refresh re-enabled pledging"


def test_wf_sealing_resolve_cases(browser, app_url):
    t, o, q = CASE["P-TAHINI"], CASE["P-OLIVE"], CASE["P-OATS"]
    coord, cid, name, members = setup_cycle(app_url, ("P-TAHINI", "P-OLIVE", "P-OATS"), [("HH-1002", "P-TAHINI", 5), ("HH-1004", "P-OLIVE", 6), ("HH-1002", "P-OATS", 5)], funded=True)
    pass_cutoff(coord, cid)
    member = members["HH-1002"]
    held_before = member.credit()["held_cents"]
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        region = role(page, "region", "At cutoff")
        pump(page, lambda: region.count() == 1 and role(region, "group", t).count() == 1, "the at-cutoff region shows each case")
        pump(page, lambda: "7 TO GO" in squeeze(role(region, "group", t).inner_text()), "an unfilled case states its number")
        assert "SEALED" in squeeze(role(region, "group", o).inner_text())
        assert "20 TO GO" in squeeze(role(region, "group", q).inner_text())
        assert role(page, "button", f"Drop {o}").count() == 0, "a sealed case offers no resolve buttons"
        place = role(page, "button", "Place order")
        assert reads_disabled(place), "Place order is disabled while a case is filling"
        drop = role(page, "button", f"Drop {t}")
        drop.focus()
        page.keyboard.press("Enter")
        announced(page, "Coordinator updates", f"Dropped {t}. Holds released.")
        pump(page, lambda: accessible_name(page) == t, "focus moves to the case's group")
        assert "DROPPED" in squeeze(role(region, "group", t).inner_text())
        assert member.credit()["held_cents"] == held_before - hold_of("P-TAHINI", 5)
        dropped = member.line(cid, "P-TAHINI")
        assert dropped["status"] == "dropped" and dropped["my_units"] == 5 and dropped["cells"].count("mine") == 5
        click(role(page, "button", f"Take up {q}"))
        announced(page, "Coordinator updates", f"The club took up 20 of {q}.")
        pump(page, lambda: "TAKEN UP" in squeeze(role(region, "group", q).inner_text()), "the state word follows")
        taken = coord.line(cid, "P-OATS")
        assert taken["status"] == "taken_up" and taken["pledged_units"] == 25 and taken["units_to_go"] == 0
        pump(page, lambda: not reads_disabled(place), "Place order enables once all are resolved")
        lines = squeeze(role(page, "table", "Lines").inner_text())
        assert "dropped" in lines and "taken up" in lines and "sealed" in lines


def test_exact_unit_shares(tmp_path):
    with app_copy(new_db(tmp_path)) as base:
        coord, me = coordinator(base), household(base, "HH-1001")
        path = "/api/cycles/cy-44/lines/P-TAHINI/shares"
        want(coord.call("GET", path), 409, "line_not_sealed")
        want(pledge(me, "cy-44", "P-TAHINI", 3), 200)
        shares = want(me.call("GET", path), 200).json()
        assert (shares["price_cents"], shares["pack"], shares["unit_base_cents"], shares["remainder_cents"]) == (4700, 12, 391, 8)
        assert [(s["pledger"], s["units"], s["first_unit"], s["share_cents"]) for s in shares["shares"]] == [("HH-1002", 5, 1, 1960), ("HH-1003", 4, 6, 1567), ("HH-1001", 3, 10, 1173)]
        cid = open_cycle(coord, ("P-RICE",))["id"]
        want(pledge(household(base, "HH-1002"), cid, "P-RICE", 1), 200)
        pass_cutoff(coord, cid)
        want(resolve(coord, cid, "P-RICE", "take_up"), 200)
        rice = want(coord.call("GET", f"/api/cycles/{cid}/lines/P-RICE/shares"), 200).json()
        assert rice["unit_base_cents"] == PRICE["P-RICE"] // PACK["P-RICE"] and rice["remainder_cents"] == PRICE["P-RICE"] % PACK["P-RICE"]
        assert [s["pledger"] for s in rice["shares"]] == ["HH-1002", "club"]
        assert rice["shares"][0]["share_cents"] == rice["unit_base_cents"] + 1 and sum(s["share_cents"] for s in rice["shares"]) == PRICE["P-RICE"]


def test_wf_sealing_place_order(browser, app_url):
    coord, cid, name, _ = setup_cycle(app_url, ("P-TAHINI", "P-OATS"))
    pass_cutoff(coord, cid)
    want(coord.call("POST", f"/api/cycles/{cid}/transitions", {"to": "ordered"}), 409, "unresolved_lines")
    assert coord.cycle(cid)["status"] == "sealing"
    want(resolve(coord, cid, "P-OATS", "drop"), 200)
    want(resolve(coord, cid, "P-TAHINI", "take_up"), 200)
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        place = role(page, "button", "Place order")
        pump(page, lambda: place.count() == 1 and not reads_disabled(place), "Place order is enabled once every case is resolved")
        click(place)
        announced(page, "Coordinator updates", f"{name} is now ordered.")
        pump(page, lambda: role(page, "button", "Mark received").count() == 1 and role(page, "button", "Place order").count() == 0, "only the next transition shows")
    assert coord.cycle(cid)["status"] == "ordered"
    dead = open_cycle(coord, ("P-TAHINI", "P-OATS"))["id"]
    pass_cutoff(coord, dead)
    for pid in ("P-TAHINI", "P-OATS"):
        want(resolve(coord, dead, pid, "drop"), 200)
    want(coord.call("POST", f"/api/cycles/{dead}/transitions", {"to": "ordered"}), 409, "nothing_to_order")
    assert coord.cycle(dead)["status"] == "sealing"


def test_one_resolution_per_case(browser, tmp_path):
    pid, case = "P-TAHINI", CASE["P-TAHINI"]
    db = new_db(tmp_path)
    with app_copy(db) as one, app_copy(db) as two:
        c1, c2 = coordinator(one), coordinator(two)
        cid = open_cycle(c1, (pid, "P-OATS", "P-QUINOA"))["id"]
        member = household(one, "HH-1002")
        want(pledge(member, cid, pid, 2), 200)
        want(resolve(c1, cid, pid, "drop"), 409, "wrong_cycle_state")
        want(resolve(c1, cid, pid, "keep"), 409, "wrong_cycle_state")
        for code, units in (("HH-1001", 6), ("HH-1002", 4)):
            want(pledge(household(one, code), cid, "P-QUINOA", units), 200)
        pass_cutoff(c1, cid)
        want(resolve(c1, cid, "P-QUINOA", "drop"), 409, "line_already_full")
        want(resolve(c1, cid, "P-QUINOA", "keep"), 409, "line_already_full")
        want(resolve(c1, cid, pid, "keep"), 422, "validation")
        answers = race(*[(lambda c=c, a=a: resolve(c, cid, pid, a)) for c, a in ((c1, "drop"), (c2, "take_up"), (c1, "take_up"), (c2, "drop"), (c1, "drop"), (c2, "take_up"), (c1, "take_up"), (c2, "drop"))])
        wins = [a for a in answers if a.status_code == 200]
        assert len(wins) == 1, [a.status_code for a in answers]
        for loser in answers:
            if loser.status_code != 200:
                want(loser, 409, "line_already_resolved")
        want(resolve(c1, cid, pid, "keep"), 409, "line_already_resolved")
        final = c1.line(cid, pid)
        assert final == {**final, "status": wins[0].json()["status"], "version": 3}
        assert final["pledged_units"] == (2 if final["status"] == "dropped" else 12)
        with signed_in(browser, one, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
            take = role(page, "button", f"Take up {CASE['P-OATS']}")
            pump(page, lambda: take.count() == 1, "the resolve buttons show")
            want(resolve(c2, cid, "P-OATS", "drop"), 200)
            click(take)
            announced(page, "Coordinator updates", f"{CASE['P-OATS']} was already dropped. Nothing changed.")
            pump(page, lambda: accessible_name(page) == CASE["P-OATS"], "focus moves to the case's group")
        assert c1.line(cid, "P-OATS")["status"] == "dropped"


def contrast_audit(page: Page) -> None:
    page.add_script_tag(path=str(conftest.AXE))
    page.evaluate(
        """options => {
          window.__CONTRAST__ = null;
          axe.run(document, options).then(
            value => { window.__CONTRAST__ = {error: null, violations: value.violations.map(v => v.nodes.map(n => n.target))}; },
            error => { window.__CONTRAST__ = {error: String(error), violations: []}; });
        }""",
        {"runOnly": {"type": "rule", "values": ["color-contrast"]}},
    )
    for _ in range(625):
        status = page.evaluate("window.__CONTRAST__")
        if status:
            assert status["error"] is None, status["error"]
            assert not status["violations"], f"contrast violations: {status['violations']}"
            return
        conftest.advance(page, 16)
    raise AssertionError("contrast audit did not settle under controlled time")


def jsonc(text_: str) -> Any:
    out, i, quote = [], 0, False
    slash, star = chr(47), chr(42)
    while i < len(text_):
        ch = text_[i]
        if quote:
            out.append(ch)
            if ch == chr(92) and i + 1 < len(text_):
                out.append(text_[i + 1])
                i += 1
            elif ch == '"':
                quote = False
        elif ch == '"':
            quote = True
            out.append(ch)
        elif ch == slash and text_[i + 1:i + 2] == slash:
            while i < len(text_) and text_[i] != "\n":
                i += 1
            continue
        elif ch == slash and text_[i + 1:i + 2] == star:
            end = text_.find(star + slash, i + 2)
            i = len(text_) if end < 0 else end + 2
            continue
        else:
            out.append(ch)
        i += 1
    return json.loads(re.sub(r",(\s*[}\]])", r"\1", "".join(out)))


def compiler_option(path: Path, name: str, depth: int = 0) -> Any:
    config = jsonc(path.read_text())
    if name in config.get("compilerOptions", {}):
        return config["compilerOptions"][name]
    parents = config.get("extends") or []
    for parent in reversed([parents] if isinstance(parents, str) else parents):
        if parent.startswith("."):
            target = (path.parent / parent).resolve()
        else:
            target = DEPLOYED_APP / "node_modules" / parent
            target = target / "tsconfig.json" if target.is_dir() else target
        if depth < 5 and target.suffix != ".json" and not target.exists():
            target = target.with_suffix(".json")
        if depth < 5 and target.exists():
            value = compiler_option(target, name, depth + 1)
            if value is not None:
                return value
    return None


def test_state_words_and_contrast(browser, app_url):
    s, u, d, f = CASE["P-OLIVE"], CASE["P-QUINOA"], CASE["P-TAHINI"], CASE["P-OATS"]
    coord, cid, _, _ = setup_cycle(app_url, ("P-OLIVE", "P-QUINOA", "P-TAHINI", "P-OATS"), [("HH-1001", "P-OLIVE", 4), ("HH-1002", "P-OLIVE", 2), ("HH-1001", "P-QUINOA", 2), ("HH-1001", "P-TAHINI", 3), ("HH-1001", "P-OATS", 1)], funded=True)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, s)
        filling = squeeze(block(page, f).inner_text())
        assert "Sealed" in squeeze(block(page, s).inner_text())
        assert not re.search(r"\b(Sealed|TAKEN UP|DROPPED)\b", filling), "a filling case has no state text"
        pass_cutoff(coord, cid)
        want(resolve(coord, cid, "P-QUINOA", "take_up"), 200)
        want(resolve(coord, cid, "P-TAHINI", "drop"), 200)
        pump(page, lambda: "TAKEN UP" in squeeze(block(page, u).inner_text()) and "DROPPED" in squeeze(block(page, d).inner_text()), "state words follow the resolutions", REFRESH_WINDOW_MS)
        frames(page, 10)
        for case, value in ((s, "mine"), (s, "taken"), (u, "mine"), (u, "taken"), (d, "mine"), (f, "mine")):
            cell = block(page, case).locator(f"[data-cell='{value}']").first
            image = picture(cell)
            sample = image[max(1, len(image) // 5)][max(1, len(image[0]) // 5)]
            background = block(page, case).evaluate(EFFECTIVE_BG)
            assert contrast(sample, background) >= 3, f"{case} {value} cell {sample} on {background}"
        for case in (f,):
            empty = block(page, case).locator("[data-cell]").nth(cells(page, case).index("empty"))
            image = picture(empty)
            background = block(page, case).evaluate(EFFECTIVE_BG)
            assert max(contrast(p, background) for row in image for p in row) >= 3, "an empty cell's outline is too faint"
        contrast_audit(page)


def test_resolutions_appear_on_every_screen(browser, app_url):
    d, u = CASE["P-TAHINI"], CASE["P-QUINOA"]
    coord, cid, _, members = setup_cycle(app_url, ("P-TAHINI", "P-QUINOA"), [("HH-1001", "P-TAHINI", 3), ("HH-1001", "P-QUINOA", 2)], funded=True)
    pass_cutoff(coord, cid)
    me = members["HH-1001"]
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as acting, signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as watching, signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", PHONE, reduced_motion="reduce") as phone:
        pump(acting, lambda: role(acting, "button", f"Drop {d}").count() == 1, "the resolve buttons show")
        pump(watching, lambda: role(watching, "button", f"Drop {d}").count() == 1, "the other screen shows them too")
        on_cycle(phone, d)
        click(role(acting, "button", f"Drop {d}"))
        announced(acting, "Coordinator updates", f"Dropped {d}. Holds released.")
        click(role(acting, "button", f"Take up {u}"))
        announced(acting, "Coordinator updates", f"The club took up 8 of {u}.")
        region = role(watching, "region", "At cutoff")
        pump(watching, lambda: "DROPPED" in squeeze(role(region, "group", d).inner_text()) and "TAKEN UP" in squeeze(role(region, "group", u).inner_text()), "the other coordinator screen follows", REFRESH_WINDOW_MS)
        assert role(watching, "button", f"Drop {d}").count() == 0 and role(watching, "button", f"Take up {u}").count() == 0
        assert not reads_disabled(role(watching, "button", "Place order"))
        assert live(watching, "Coordinator updates") == ""
        pump(phone, lambda: "DROPPED" in squeeze(block(phone, d).inner_text()), "the member's block reads DROPPED", REFRESH_WINDOW_MS)
        assert crate_named(phone, d, 3, 12, "dropped") and reads_disabled(pledge_button(phone, d))
        assert block(phone, u).count() == 0, "a taken-up case belongs in the Sealed panel"
        credit = me.credit()
        pump(phone, lambda: usd(credit["held_cents"]) in squeeze(role(phone, "region", "Credit").inner_text()), "the holds on the panel follow", REFRESH_WINDOW_MS)
        tap(role(phone, "tab", "Sealed"))
        on_cycle(phone, u)
        assert "TAKEN UP" in squeeze(block(phone, u).inner_text()) and crate_named(phone, u, 10, 10, "taken up")
        assert cells(phone, u).count("taken") == 8 and live(phone, "Pledge updates") == ""


def test_wf_documents_upload_and_replace(browser, app_url):
    coord, cid, _ = ordered_cycle(app_url)
    invoice, slip, newer = unique_pdf(), JPEG + uuid.uuid4().bytes, PDF + uuid.uuid4().hex.encode() + b"-second"
    store = S3()
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        field = page.get_by_label("Distributor invoice (PDF)")
        pump(page, lambda: field.count() == 1, "the invoice input shows")
        field.set_input_files({"name": "invoice.pdf", "mimeType": "application/pdf", "buffer": invoice})
        with held(page, "**/documents/invoice") as gate:
            click(role(page, "button", "Upload invoice"))
            pump(page, lambda: shows(page, "Uploading..."), "the button reads Uploading...")
            assert want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"] == []
            release(gate)
            announced(page, "Coordinator updates", f"Saved invoice ({len(invoice)} bytes).")
        assert store.get(f"cycles/{cid}/invoice.pdf") == invoice
        page.get_by_label("Packing slip photo").set_input_files({"name": "slip.jpg", "mimeType": "image/jpeg", "buffer": slip})
        click(role(page, "button", "Upload packing slip"))
        announced(page, "Coordinator updates", f"Saved packing slip ({len(slip)} bytes).")
        field.set_input_files({"name": "invoice.pdf", "mimeType": "application/pdf", "buffer": newer})
        click(role(page, "button", "Upload invoice"))
        announced(page, "Coordinator updates", f"Saved invoice ({len(newer)} bytes).")
    assert store.get(f"cycles/{cid}/invoice.pdf") == newer and store.get(f"cycles/{cid}/packing-slip.jpg") == slip
    records = {d["kind"]: d for d in want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"]}
    assert records["invoice"]["bytes"] == len(newer) and records["invoice"]["sha256"] == sha256(newer).hexdigest()
    assert records["invoice"]["key"] == f"cycles/{cid}/invoice.pdf"
    assert want(coord.call("GET", f"/api/cycles/{cid}/documents/invoice"), 200).content == newer
    assert want(coord.call("GET", f"/api/cycles/{cid}/documents/packing-slip"), 200).content == slip
    early = open_cycle(coord)["id"]
    want(upload(coord, early, "invoice", unique_pdf(), "application/pdf"), 409, "wrong_cycle_state")


def test_wf_documents_refuses_false_files(browser, app_url):
    coord, cid, _ = ordered_cycle(app_url)
    store = S3()
    before = store.keys(f"cycles/{cid}/")
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        invoice = page.get_by_label("Distributor invoice (PDF)")
        slip = page.get_by_label("Packing slip photo")
        pump(page, lambda: invoice.count() == 1, "the file inputs show")
        invoice.set_input_files({"name": "fake.pdf", "mimeType": "application/pdf", "buffer": b"plain text, not a document"})
        click(role(page, "button", "Upload invoice"))
        announced(page, "Coordinator updates", "That file isn't a PDF.")
        slip.set_input_files({"name": "fake.png", "mimeType": "image/png", "buffer": JPEG + b"not a png"})
        click(role(page, "button", "Upload packing slip"))
        announced(page, "Coordinator updates", "That file isn't a JPEG or PNG photo.")
        invoice.set_input_files({"name": "big.pdf", "mimeType": "application/pdf", "buffer": PDF + b"0" * MAX_UPLOAD})
        click(role(page, "button", "Upload invoice"))
        announced(page, "Coordinator updates", "That file is over 10 MB. Your upload was not saved.")
    assert store.keys(f"cycles/{cid}/") == before
    assert want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"] == []


def test_wf_documents_storage_outage(browser):
    down = outage("APP_MINIO_DOWN_URL")
    coord, cid, _ = ordered_cycle(down)
    store = S3()
    before = store.keys(f"cycles/{cid}/")
    want(upload(coord, cid, "invoice", unique_pdf(), "application/pdf"), 503, "storage_unavailable")
    want(upload(coord, cid, "packing-slip", PNG + b"x", "image/png"), 503, "storage_unavailable")
    with signed_in(browser, down, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        field = page.get_by_label("Distributor invoice (PDF)")
        pump(page, lambda: field.count() == 1, "the invoice input shows")
        field.set_input_files({"name": "invoice.pdf", "mimeType": "application/pdf", "buffer": unique_pdf()})
        click(role(page, "button", "Upload invoice"))
        announced(page, "Coordinator updates", "File storage is unavailable. Your upload was not saved.")
    assert want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"] == []
    assert store.keys(f"cycles/{cid}/") == before


def test_one_packing_slip(app_url):
    coord, cid, _ = ordered_cycle(app_url)
    store = S3()
    jpeg, png, second = JPEG + uuid.uuid4().bytes, PNG + uuid.uuid4().bytes, JPEG + uuid.uuid4().bytes + b"2"

    def slips():
        return [k for k in store.keys(f"cycles/{cid}/") if "packing-slip" in k]

    want(upload(coord, cid, "packing-slip", jpeg, "image/jpeg"), 201)
    assert slips() == [f"cycles/{cid}/packing-slip.jpg"]
    assert want(upload(coord, cid, "packing-slip", png, "image/png"), 201).json()["key"] == f"cycles/{cid}/packing-slip.png"
    poll(lambda: slips() == [f"cycles/{cid}/packing-slip.png"], "the old JPEG key is deleted after the PNG commits")
    assert store.get(f"cycles/{cid}/packing-slip.png") == png
    download = want(coord.call("GET", f"/api/cycles/{cid}/documents/packing-slip"), 200)
    assert download.content == png and "packing-slip.png" in download.headers["content-disposition"]
    refused = upload(coordinator(outage("APP_MINIO_DOWN_URL")), cid, "packing-slip", second, "image/jpeg")
    want(refused, 503, "storage_unavailable")
    assert slips() == [f"cycles/{cid}/packing-slip.png"] and store.get(f"cycles/{cid}/packing-slip.png") == png
    records = want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"]
    slip = [d for d in records if d["kind"] == "packing-slip"]
    assert len(slip) == 1 and slip[0]["sha256"] == sha256(png).hexdigest()
    assert want(coord.call("GET", f"/api/cycles/{cid}/documents/packing-slip"), 200).content == png


UPLOAD_CASES = {
    "pdf": ("invoice", "application/pdf", b"%PDF-1.7 body", 0, 201),
    "jpeg": ("packing-slip", "image/jpeg", b"\xff\xd8\xff\xe0 body", 0, 201),
    "png": ("packing-slip", "image/png", b"\x89PNG\r\n\x1a\n body", 0, 201),
    "type_case_and_parameter": ("packing-slip", "image/PNG; name=x", b"\x89PNG\r\n\x1a\n body", 0, 201),
    "exact_limit": ("invoice", "application/pdf", b"%PDF-", 9999995, 201),
    "over_limit": ("invoice", "application/pdf", b"%PDF-", 9999996, 413),
    "jpeg_sent_as_png": ("packing-slip", "image/png", b"\xff\xd8\xff\xe0 body", 0, 415),
    "png_sent_as_jpeg": ("packing-slip", "image/jpeg", b"\x89PNG\r\n\x1a\n body", 0, 415),
    "short_png_signature": ("packing-slip", "image/png", b"\x89PNG\r\n", 0, 415),
    "svg": ("packing-slip", "image/svg+xml", b"<svg xmlns='http://www.w3.org/2000/svg'><script>x</script></svg>", 0, 415),
    "text_as_pdf": ("invoice", "application/pdf", b"plain text", 0, 415),
    "empty": ("invoice", "application/pdf", b"", 0, 415),
}


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_uploads_checked_by_bytes(app_url, case):
    kind, declared, head, pad, status = UPLOAD_CASES[case]
    coord, cid, _ = ordered_cycle(app_url)
    store = S3()
    before = store.keys(f"cycles/{cid}/")
    body = head + b"0" * pad
    answer = upload(coord, cid, kind, body, declared)
    want(answer, status)
    if status != 201:
        assert answer.json()["error"]["code"] == {413: "too_large", 415: "unsupported_media_type"}[status]
        if status == 415:
            want(upload(Api(app_url), cid, kind, body, declared), 415, "unsupported_media_type")
            want(upload(household(app_url, "HH-1001"), cid, kind, body, declared), 415, "unsupported_media_type")
        assert store.keys(f"cycles/{cid}/") == before, "a refused upload reached MinIO"
        assert want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"] == []
        return
    record = answer.json()
    assert record["bytes"] == len(body) and record["sha256"] == sha256(body).hexdigest()
    assert store.get(record["key"]) == body
    download = want(coord.call("GET", f"/api/cycles/{cid}/documents/{kind}"), 200)
    assert download.content == body and download.headers["x-content-type-options"] == "nosniff"
    filename = record["key"].rsplit("/", 1)[1]
    assert download.headers["content-disposition"] == f'attachment; filename="{filename}"'
    assert download.headers["content-type"].split(";")[0].lower() == declared.split(";")[0].lower()


def test_one_upload_at_a_time(app_url):
    coord, cid, _ = ordered_cycle(app_url)
    other = coordinator(outage("APP_KILLBILL_DOWN_URL"))
    bodies = [PDF + uuid.uuid4().hex.encode() + b"0" * 3000000 for _ in range(6)]
    answers = race(*[(lambda api=(coord if i % 2 else other), b=b: upload(api, cid, "invoice", b, "application/pdf")) for i, b in enumerate(bodies)])
    codes = [a.status_code for a in answers]
    assert 201 in codes and set(codes) <= {201, 409}, codes
    for loser in answers:
        if loser.status_code == 409:
            want(loser, 409, "upload_in_progress")
    record = want(coord.call("GET", f"/api/cycles/{cid}/documents"), 200).json()["documents"]
    assert [d["kind"] for d in record] == ["invoice"]
    stored = S3().get(f"cycles/{cid}/invoice.pdf")
    assert sha256(stored).hexdigest() == record[0]["sha256"] and stored in bodies
    assert want(coord.call("GET", f"/api/cycles/{cid}/documents/invoice"), 200).content == stored
    assert [k for k in S3().keys(f"cycles/{cid}/") if "invoice" in k] == [f"cycles/{cid}/invoice.pdf"]


def received_olive(base: str, funded: bool = True) -> tuple[Api, str, str, dict]:
    coord, cid, name, members = setup_cycle(base, ("P-OLIVE",), [("HH-1004", "P-OLIVE", 4), ("HH-1002", "P-OLIVE", 2)], funded=funded)
    pass_cutoff(coord, cid)
    move(coord, cid, "ordered", "received")
    return coord, cid, name, members


def post_short(coord: Api, cid: str, pid: str, units: int, key: str | None = None) -> httpx.Response:
    return coord.call("POST", f"/api/cycles/{cid}/lines/{pid}/shorts", {"units": units}, key=key or idempotency_key())


def test_wf_short_shipments_record(browser, app_url):
    pid, case = "P-OLIVE", CASE["P-OLIVE"]
    coord, cid, name, members = received_olive(app_url)
    line_before = coord.line(cid, pid)
    holds = {c: m.credit()["held_cents"] for c, m in members.items()}
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        opener = role(page, "button", f"Record short: {case}")
        pump(page, lambda: opener.count() == 1, "the row action shows")
        click(opener)
        dialog = role(page, "dialog", "Record short shipment")
        pump(page, lambda: dialog.count() == 1 and accessible_name(page) == "Units short", "the dialog opens with focus in Units short")
        fill(role(dialog, "spinbutton", "Units short"), "3")
        click(role(dialog, "button", "Record short"))
        announced(page, "Coordinator updates", f"Recorded 3 short on {case}. Notices queued for 2 households.")
        pump(page, lambda: dialog.count() == 0 and accessible_name(page) == f"Record short: {case}", "the dialog closes and returns focus")
        click(opener)
        pump(page, lambda: dialog.count() == 1, "the dialog reopens")
        fill(role(dialog, "spinbutton", "Units short"), "4")
        click(role(dialog, "button", "Record short"))
        pump(page, lambda: shows(page, "Enter 1 to 3 units."), "the field error names the remaining units")
    line = coord.line(cid, pid)
    assert line["short_units"] == 3 and line["version"] == line_before["version"] + 1
    assert (line["pledged_units"], line["units_to_go"], line["status"], line["cells"]) == (line_before["pledged_units"], line_before["units_to_go"], line_before["status"], line_before["cells"])
    assert {c: m.credit()["held_cents"] for c, m in members.items()} == holds
    assert members["HH-1002"].line(cid, pid)["my_units"] == 2
    want(post_short(members["HH-1002"], "cy-nope", pid, 1), 404, "not_found")
    want(post_short(members["HH-1002"], cid, pid, 1), 403, "forbidden")
    extra = want(post_short(coord, cid, pid, 1), 201).json()
    assert extra["affected"] == [{"pledger": "HH-1004", "short_units": 1, "credit_cents": 1500}] and isinstance(extra["short_id"], int)
    want(post_short(coord, cid, pid, 3), 422, "validation")
    early, _, _ = ordered_cycle(app_url)[1], None, None
    want(post_short(coord, early, "P-QUINOA", 1), 409, "wrong_cycle_state")


def test_short_notice_mail_and_block(browser, app_url, mail):
    pid, case = "P-OLIVE", CASE["P-OLIVE"]
    coord, cid, name, members = setup_cycle(app_url, (pid,), [("HH-1004", pid, 4)], funded=True)
    pass_cutoff(coord, cid)
    take_up_rest(coord, cid)
    move(coord, cid, "ordered", "received")
    with signed_in(browser, app_url, "HOME-1004", f"/cycles/{cid}") as page:
        on_cycle(page, case)
        turn(page, case).focus()
        run_refresh(page, cid)
        answer = want(post_short(coord, cid, pid, 3), 201).json()
        assert sorted((a["pledger"], a["short_units"]) for a in answer["affected"]) == [("HH-1004", 1), ("club", 2)]
        sent = my_mail(mail, name, 1)
        assert len(sent) == 1, "exactly one notice goes out and none to the club"
        notice = sent[0]
        assert notice["Subject"] == f"Short shipment: {case}" and addresses(notice["To"]) == ["hh1004@elmstreet.example"]
        assert squeeze(text(notice)) == f"{name}: 1 of your 4 units of {case} did not arrive. You will not be charged for them."
        assert notice["MessageID"].strip("<>") == f"short-{answer['short_id']}-HH-1004@tare-and-tally.example"
        copy = f"Short shipment: 1 of your 4 units didn't arrive. You won't be charged for them."
        pump(page, lambda: copy in squeeze(block(page, case).inner_text()), "the notice shows in the block within 12 seconds", REFRESH_WINDOW_MS)
        assert accessible_name(page) == f"Turn crate of {case}" and live(page, "Pledge updates") == ""
        assert crate_named(page, case, 6, 6, "taken up")


def test_record_short_dialog_reachable(browser, app_url):
    pids = ("P-QUINOA", "P-TAHINI", "P-OATS", "P-MAPLE")
    coord, cid, _, _ = setup_cycle(app_url, pids)
    pass_cutoff(coord, cid)
    take_up_rest(coord, cid)
    move(coord, cid, "ordered", "received")
    case = CASE[pids[-1]]
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        opener = role(page, "button", f"Record short: {case}")
        dialog = role(page, "dialog", "Record short shipment")
        for view in (PHONE, TABLET, DESKTOP, SIDEWAYS):
            page.set_viewport_size(view)
            pump(page, lambda: opener.count() == 1, "the last row's action shows")
            opener.scroll_into_view_if_needed()
            frames(page)
            inside_viewport(page, opener)
            layout(page)
            click(opener)
            pump(page, lambda: dialog.count() == 1 and accessible_name(page) == "Units short", f"the dialog opens at {view}")
            frames(page, 25)
            inside_viewport(page, dialog)
            for kind, label in (("spinbutton", "Units short"), ("button", "Record short"), ("button", "Cancel")):
                control = role(dialog, kind, label)
                inside_viewport(page, control)
                assert hit(control), f"{label} is covered at {view}"
                if kind == "button":
                    big_enough(control)
            page_stays_put(page)
            click(role(dialog, "button", "Cancel"))
            pump(page, lambda: dialog.count() == 0 and accessible_name(page) == f"Record short: {case}", "Cancel returns focus to the opener")
        page.set_viewport_size(PHONE)
        click(opener)
        pump(page, lambda: dialog.count() == 1, "the dialog opens")
        field = role(dialog, "spinbutton", "Units short")
        fill(field, "99")
        click(role(dialog, "button", "Record short"))
        pump(page, lambda: shows(page, "Enter 1 to 6 units."), "the field error shows")
        field.focus()
        want(post_short(coord, cid, pids[-1], 1), 201)
        run_refresh(page, cid)
        pump(page, lambda: "1" in squeeze(role(page, "table", "Lines").text_content()), "the refresh reached the table", GRACE_MS)
        assert dialog.count() == 1 and field.input_value() == "99" and accessible_name(page) == "Units short"
        assert shows(page, "Enter 1 to 6 units."), "the refresh removed the field error"


def test_wf_short_shipments_lost_reply(browser, app_url, mail):
    pid, case = "P-OLIVE", CASE["P-OLIVE"]
    coord, cid, name, _ = received_olive(app_url)
    keys, lost = [], {"next": True}

    def lossy(route):
        keys.append(route.request.headers.get("idempotency-key"))
        if lost["next"]:
            lost["next"] = False
            route.fetch()
            route.abort()
        else:
            route.fallback()

    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        opener = role(page, "button", f"Record short: {case}")
        pump(page, lambda: opener.count() == 1, "the row action shows")
        page.route("**/shorts", lossy)
        click(opener)
        dialog = role(page, "dialog", "Record short shipment")
        pump(page, lambda: dialog.count() == 1, "the dialog opens")
        fill(role(dialog, "spinbutton", "Units short"), "1")
        click(role(dialog, "button", "Record short"))
        pump(page, lambda: shows(page, f"Couldn't confirm the short on {case}. Check your connection and try again."), "the no-response copy shows")
        assert accessible_name(page) == "Record short"
        click(role(dialog, "button", "Record short"))
        announced(page, "Coordinator updates", f"Recorded 1 short on {case}. Notices queued for 1 households.")
    assert keys[0] == keys[1], "the retry must reuse its key"
    assert coord.line(cid, pid)["short_units"] == 1
    assert len(my_mail(mail, name, 1)) == 1
    key = idempotency_key()
    first = want(post_short(coord, cid, pid, 1, key), 201)
    replay = want(post_short(coord, cid, pid, 1, key), 201)
    assert replay.json() == first.json() and replay.headers.get("Idempotent-Replay") == "true"
    want(post_short(coord, cid, pid, 2, key), 409, "idempotency_key_reused")
    assert coord.line(cid, pid)["short_units"] == 2
    second = coordinator(outage("APP_KILLBILL_DOWN_URL"))
    answers = race(*[(lambda api=(coord if i % 2 else second): post_short(api, cid, pid, 2)) for i in range(5)])
    assert sorted(a.status_code for a in answers) == [201, 201, 422, 422, 422], [a.text[:120] for a in answers]
    assert coord.line(cid, pid)["short_units"] == 6


def open_bag(page: Page, cycle_name: str, household_name: str) -> Locator:
    bags = role(page, "list", "Bags")

    def ready():
        return bags.count() > 0

    pump(page, ready, "the bags list shows for the cycle in breakdown")
    opener = role(bags, "button", f"{household_name} bag")
    pump(page, lambda: opener.count() == 1, "the household's bag is listed")
    return opener


def test_wf_breakdown_pack_by_keyboard(browser, tmp_path):
    who, name_o, name_q = HOUSEHOLD["HH-1002"], CASE["P-OLIVE"], CASE["P-QUINOA"]
    with app_copy(new_db(tmp_path)) as base:
        coord, cid, name = bag_cycle(base)
        with signed_in(browser, base, VOL_CODE, "/breakdown") as page:
            opener = open_bag(page, name, who)
            opener.focus()
            page.keyboard.press("Enter")
            region = role(page, "region", f"{who} bag")
            first, last = role(region, "checkbox", f"2 of {name_o}"), role(region, "checkbox", f"1 of {name_q}")
            pump(page, lambda: first.count() == 1 and accessible_name(page) == f"2 of {name_o}", "the bag opens with focus on its first checkbox")
            page.keyboard.press("Space")
            announced(page, "Bag updates", f"Packed 2 of {name_o} for {who}.")
            assert first.is_checked()
            page.keyboard.press("Tab")
            assert accessible_name(page) == f"Flag short: {name_o}"
            page.keyboard.press("Tab")
            assert accessible_name(page) == f"1 of {name_q}"
            item = role(page, "list", "Bags").get_by_role("listitem").filter(has_text=who)
            with held(page, "**/items/P-QUINOA") as gate:
                page.keyboard.press("Space")
                pump(page, lambda: last.is_checked(), "the box shows the requested state at once")
                assert reads_disabled(last) and "PACKED" not in item.inner_text().upper(), "PACKED showed before the server answered"
                release(gate)
                pump(page, lambda: "PACKED" in item.inner_text(), "PACKED shows after the server confirms")
            pump(page, lambda: f"{who} bag is packed." in live(page, "Bag updates"), "the last tick announces the packed bag")
            assert accessible_name(page) == f"1 of {name_q}"
        bags = want(coord.call("GET", f"/api/cycles/{cid}/bags"), 200).json()["bags"]
        bag = next(b for b in bags if b["household_code"] == "HH-1002")
        assert bag["packed"] is True and all(i["packed"] for i in bag["items"])


def test_wf_breakdown_refused_tick(browser, tmp_path):
    who, name_o, name_q = HOUSEHOLD["HH-1002"], CASE["P-OLIVE"], CASE["P-QUINOA"]
    with app_copy(new_db(tmp_path)) as base:
        coord, cid, name = bag_cycle(base)
        display = coord.cycle(cid)["pickup_display"]
        with signed_in(browser, base, VOL_CODE, "/breakdown") as page:
            click(open_bag(page, name, who))
            region = role(page, "region", f"{who} bag")
            good, bad = role(region, "checkbox", f"2 of {name_o}"), role(region, "checkbox", f"1 of {name_q}")
            pump(page, lambda: good.count() == 1, "the checklist shows")
            page.route("**/items/P-QUINOA", lambda route: route.fulfill(status=409, content_type="application/json; charset=utf-8", body=json.dumps({"error": {"code": "outside_pickup_window", "message": "refused"}})))
            good.focus()
            page.keyboard.press("Space")
            announced(page, "Bag updates", f"Packed 2 of {name_o} for {who}.")
            bad.focus()
            page.keyboard.press("Space")
            announced(page, "Bag updates", f"Outside the pickup window. Pickup is {display}.")
            pump(page, lambda: not bad.is_checked(), "the refused box goes back")
            assert good.is_checked(), "a refusal changed another item's box"
            assert accessible_name(page) == f"1 of {name_q}"
            assert "PACKED" not in role(page, "list", "Bags").inner_text()
        items = {i["product_id"]: i["packed"] for b in coord.call("GET", f"/api/cycles/{cid}/bags").json()["bags"] if b["household_code"] == "HH-1002" for i in b["items"]}
        assert items == {"P-OLIVE": True, "P-QUINOA": False}


def test_flag_short_from_bag(browser, tmp_path):
    who, case = HOUSEHOLD["HH-1002"], CASE["P-OLIVE"]
    with app_copy(new_db(tmp_path)) as base:
        coord, cid, name = bag_cycle(base)
        member = household(base, "HH-1002")
        before = member.credit()
        with signed_in(browser, base, VOL_CODE, "/breakdown") as page:
            click(open_bag(page, name, who))
            flag = role(page, "button", f"Flag short: {case}")
            pump(page, lambda: flag.count() == 1, "the flag button shows")
            flag.focus()
            page.keyboard.press("Enter")
            dialog = role(page, "dialog", "Flag short")
            pump(page, lambda: dialog.count() == 1 and accessible_name(page) == "Units missing", "the dialog opens with focus in Units missing")
            page.keyboard.press("Escape")
            pump(page, lambda: accessible_name(page) == f"Flag short: {case}", "Escape returns focus to the row")
            page.keyboard.press("Enter")
            field = role(dialog, "spinbutton", "Units missing")
            pump(page, lambda: field.count() == 1, "the dialog reopens")
            fill(field, "3")
            click(role(dialog, "button", "Flag"))
            pump(page, lambda: shows(page, "Enter 1 to 2 units."), "the field error names the item's units")
            fill(field, "1")
            click(role(dialog, "button", "Flag"))
            announced(page, "Bag updates", f"Flagged 1 missing of {case} for the coordinator.")
            pump(page, lambda: accessible_name(page) == f"Flag short: {case}", "focus returns to the row's flag button")
        flags = want(coord.call("GET", f"/api/cycles/{cid}/flags"), 200).json()["flags"]
        assert [(f["household_code"], f["product_id"], f["units"]) for f in flags] == [("HH-1002", "P-OLIVE", 1)]
        vol = volunteer(base)
        want(vol.call("POST", f"/api/cycles/{cid}/bags/HH-1002/flags", {"product_id": "P-OLIVE", "units": 3}), 422, "validation")
        assert member.credit() == before
        with signed_in(browser, base, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
            listed = role(page, "list", "Volunteer flags")
            pump(page, lambda: listed.count() == 1 and f"{who}: 1 missing of {case}" in squeeze(listed.inner_text()), "the coordinator sees the flag")


def test_pickup_window_on_server(tmp_path):
    item = "/bags/HH-1002/items/P-OLIVE"
    with app_copy(new_db(tmp_path)) as base:
        vol = volunteer(base)
        _, inside, _ = bag_cycle(base, pickup_in=11 * 3600, pickup_len=3600)
        want(vol.call("PUT", f"/api/cycles/{inside}{item}", {"packed": True}), 200)
        want(vol.call("POST", f"/api/cycles/{inside}/bags/HH-1002/flags", {"product_id": "P-OLIVE", "units": 1}), 201)
        want(vol.call("PUT", f"/api/cycles/{inside}{item}", {"packed": "yes"}), 422, "validation")
        _, early, _ = bag_cycle(base, pickup_in=13 * 3600, pickup_len=3600)
        want(vol.call("PUT", f"/api/cycles/{early}{item}", {"packed": True}), 409, "outside_pickup_window")
        want(vol.call("POST", f"/api/cycles/{early}/bags/HH-1002/flags", {"product_id": "P-OLIVE", "units": 1}), 409, "outside_pickup_window")
        assert not next(b for b in vol.call("GET", f"/api/cycles/{early}/bags").json()["bags"] if b["household_code"] == "HH-1002")["packed"]
        coord, late, _, _ = setup_cycle(base, ("P-OLIVE",), [("HH-1002", "P-OLIVE", 1)])
        want(vol.call("GET", f"/api/cycles/{late}/bags"), 409, "wrong_cycle_state")
        pass_cutoff(coord, late)
        take_up_rest(coord, late)
        move(coord, late, "ordered", "received")
        want(vol.call("PUT", f"/api/cycles/{late}{item}", {"packed": True}), 409, "wrong_cycle_state")
        want(vol.call("PUT", f"/api/cycles/{late}{item}", {"packed": "yes"}), 409, "wrong_cycle_state")
        want(vol.call("PUT", f"/api/cycles/{late}/bags/HH-9999/items/P-OLIVE", {"packed": True}), 404, "not_found")
        ends = now() + timedelta(seconds=5)
        body = {"pickup_start_local": local(now() + timedelta(seconds=2)), "pickup_end_local": local(ends)}
        want(coord.call("PATCH", f"/api/cycles/{late}", body, etag=etag_of(coord.cycle(late))), 200)
        move(coord, late, "breakdown")
        want(vol.call("PUT", f"/api/cycles/{late}{item}", {"packed": True}), 200)
        probe = Api(base)
        poll(lambda: probe.call("GET", "/api/health").status_code == 200 and now() >= ends + timedelta(seconds=1), "pickup has ended")
        want(vol.call("PUT", f"/api/cycles/{late}{item}", {"packed": False}), 409, "outside_pickup_window")


def test_wf_breakdown_phone_packing(browser, tmp_path):
    who, case = HOUSEHOLD["HH-1002"], CASE["P-OLIVE"]
    label = f"2 of {case}"
    with app_copy(new_db(tmp_path)) as base:
        coord, cid, name = bag_cycle(base)
        for view in (PHONE, SIDEWAYS):
            with signed_in(browser, base, VOL_CODE, "/breakdown", view, reduced_motion="reduce") as page:
                tap(open_bag(page, name, who))
                region = role(page, "region", f"{who} bag")
                box = role(region, "checkbox", label)
                pump(page, lambda: box.count() == 1, "the checklist shows")
                frames(page)
                assert animations(region) == [], "the bag region animates under reduced motion"
                layout(page)
                words = region.get_by_text(label, exact=True).first
                height = words.evaluate("e => (e.closest('label') || e).getBoundingClientRect().height")
                assert height >= TARGET_PX - 0.5, f"the row label is {height} px tall"
                was = box.is_checked()
                tap(words)
                pump(page, lambda: box.is_checked() != was and not reads_disabled(box), "tapping the label text toggles the item")
                flag = role(region, "button", f"Flag short: {case}")
                big_enough(flag)
                tap(flag)
                dialog = role(page, "dialog", "Flag short")
                pump(page, lambda: dialog.count() == 1, "the flag dialog opens")
                frames(page)
                inside_viewport(page, dialog)
                assert animations(dialog) == []
                for control in ("Flag", "Cancel"):
                    big_enough(role(dialog, "button", control))
                    assert hit(role(dialog, "button", control))
                page_stays_put(page)
                tap(role(dialog, "button", "Cancel"))
                pump(page, lambda: accessible_name(page) == f"Flag short: {case}", "Cancel returns focus to the row")


def test_wf_close_happy(browser, app_url, killbill):
    case = CASE["P-OLIVE"]
    coord, cid, name, members = closable_cycle(app_url)
    accounts = {c: account_id_of(killbill, m) for c, m in members.items()}
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        button = role(page, "button", "Close cycle")
        pump(page, lambda: button.count() == 1, "Close cycle shows in breakdown")
        click(button)
        announced(page, "Coordinator updates", f"{name} is closed. 2 receipts are queued for sending.")
        table = role(page, "table", "Receipts")
        pump(page, lambda: table.count() == 1 and all(HOUSEHOLD[c] in table.inner_text() or c in table.inner_text() for c in ("HH-1004", "HH-1002")), "the receipts table lists both households")
    assert coord.cycle(cid)["status"] == "closed"
    for code, amount in (("HH-1004", "60.00"), ("HH-1002", "29.99")):
        items = charges(killbill, accounts[code], cid)
        assert len(items) == 1 and items[0][1]["description"] == f"{name}: {case} [{cid}]"
        assert Decimal(str(items[0][1]["amount"])) == Decimal(amount)


def test_charges_posted_once(tmp_path, killbill):
    db = new_db(tmp_path)
    relay = KillBillRelay()
    try:
        with app_copy(db, KILLBILL_URL=relay.url) as base:
            coord, cid, name, _ = setup_cycle(base, ("P-OLIVE",), [("HH-1004", "P-OLIVE", 2), ("HH-1002", "P-OLIVE", 2)])
            pass_cutoff(coord, cid)
            take_up_rest(coord, cid)
            move(coord, cid, "ordered", "received", "breakdown")
            want(upload(coord, cid, "invoice", unique_pdf(), "application/pdf"), 201)
            want(post_short(coord, cid, "P-OLIVE", 4), 201)
            relay.lose = lambda method, path: method == "POST" and "/invoices/charges/" in path
            key = idempotency_key()
            want(close(coord, cid, key), 503, "payments_paused")
            assert coord.cycle(cid)["status"] == "closing"
            relay.lose = lambda method, path: False
            posted = [j for j in relay.journal if j[0] == "POST" and "/invoices/charges/" in j[1]]
            want(close(coord, cid, key), 200)
            assert [j for j in relay.journal if j[0] == "POST" and "/invoices/charges/" in j[1]] == posted, "a landed charge was posted again"
            payer = killbill.account_by_key(f"{prefix_of(db)}-HH-1004")
            items = charges(killbill, payer["accountId"], cid)
            assert len(items) == 1 and Decimal(str(items[0][1]["amount"])) == Decimal("30.00")
            zero = killbill.account_by_key(f"{prefix_of(db)}-HH-1002")
            assert zero is None or charges(killbill, zero["accountId"], cid) == [], "a zero net charge got an item"
            coord2, bad, _, _ = setup_cycle(base, ("P-QUINOA",), [("HH-1003", "P-QUINOA", 2)])
            pass_cutoff(coord2, bad)
            take_up_rest(coord2, bad)
            move(coord2, bad, "ordered", "received", "breakdown")
            want(upload(coord2, bad, "invoice", unique_pdf(), "application/pdf"), 201)
            relay.lose = lambda method, path: method == "POST" and "/invoices/charges/" in path
            relay.alter = lambda method, path, body: re.sub(rb'"amount"\s*:\s*"?[\d.]+"?', b'"amount":1.23', body) if method == "POST" and "/invoices/charges/" in path else body
            want(close(coord2, bad), 503, "payments_paused")
            relay.lose = lambda method, path: False
            relay.alter = lambda method, path, body: body
            want(close(coord2, bad), 409, "charge_mismatch")
            cycle = coord2.cycle(bad)
            assert cycle["status"] == "closing"
            assert want(coord2.call("GET", f"/api/cycles/{bad}/receipts"), 200).json()["receipts"] == []
            account = killbill.account_by_key(f"{prefix_of(db)}-HH-1003")
            assert len(charges(killbill, account["accountId"], bad)) == 1
    finally:
        relay.stop()


def test_wf_close_kill_bill_down(browser, app_url, killbill):
    coord, cid, name, members = closable_cycle(app_url, invoice=False)
    accounts = {c: account_id_of(killbill, m) for c, m in members.items()}
    down = outage("APP_KILLBILL_DOWN_URL")
    revision = coord.cycle(cid)["revision"]
    with signed_in(browser, down, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        button = role(page, "button", "Close cycle")
        pump(page, lambda: button.count() == 1, "Close cycle shows in breakdown")
        click(button)
        announced(page, "Coordinator updates", "Upload the distributor invoice before closing.")
        cycle = coord.cycle(cid)
        assert cycle["status"] == "breakdown" and cycle["revision"] == revision
        want(upload(coord, cid, "invoice", unique_pdf(), "application/pdf"), 201)
        totals = {c: m.credit() for c, m in members.items()}
        history = {c: len(all_movements(m)) for c, m in members.items()}
        pump(page, lambda: not reads_disabled(button), "the button is enabled after its request answers")
        click(button)
        announced(page, "Coordinator updates", f"Close did not finish. {name} stays in closing and can be closed again.")
    closing = coord.cycle(cid)
    assert closing["status"] == "closing" and closing["revision"] == revision + 1
    assert want(coord.call("GET", f"/api/cycles/{cid}/receipts"), 200).json()["receipts"] == []
    for code, member in members.items():
        assert member.credit() == totals[code] and len(all_movements(member)) == history[code], "a failed close half-posted"
        assert charges(killbill, accounts[code], cid) == []
    want(close(coord, cid), 200)
    assert coord.cycle(cid)["status"] == "closed"


def test_close_is_idempotent(browser, app_url, killbill):
    coord, cid, name, members = closable_cycle(app_url)
    account = account_id_of(killbill, members["HH-1004"])
    want(coord.call("POST", f"/api/cycles/{cid}/transitions", {"to": "closed"}), 422, "validation")
    want(close(members["HH-1004"], "cy-nope"), 404, "not_found")
    want(close(members["HH-1004"], cid), 403, "forbidden")
    key = idempotency_key()
    want(close(coordinator(outage("APP_KILLBILL_DOWN_URL")), cid, key), 503, "payments_paused")
    first = want(close(coord, cid, key), 200)
    assert first.json()["receipts_queued"] == 2 and first.json()["cycle"]["status"] == "closed"
    assert first.headers["etag"] == f'"r{first.json()["cycle"]["revision"]}"'
    items = charges(killbill, account, cid)
    movements = len(all_movements(members["HH-1004"]))
    replay = want(close(coord, cid, key), 200)
    assert replay.headers.get("Idempotent-Replay") == "true" and replay.json() == first.json()
    want(close(coord, cid), 409, "illegal_transition")
    assert len(charges(killbill, account, cid)) == len(items) == 1 and len(all_movements(members["HH-1004"])) == movements
    coord2, second, name2, _ = closable_cycle(app_url)
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{second}") as page:
        button = role(page, "button", "Close cycle")
        pump(page, lambda: button.count() == 1, "Close cycle shows")
        sent = []
        page.on("request", lambda r: sent.append(r) if r.method == "POST" and r.url.endswith("/transitions") else None)
        button.dblclick()
        announced(page, "Coordinator updates", f"{name2} is closed. 2 receipts are queued for sending.")
        assert len(sent) == 1, f"a double click sent {len(sent)} close requests"
        assert sent[0].headers.get("idempotency-key")


def test_close_confirmed_by_providers(browser, app_url, killbill):
    coord, cid, name, members = closable_cycle(app_url)
    account = account_id_of(killbill, members["HH-1004"])
    before = coord.cycle(cid)
    down = outage("APP_MINIO_DOWN_URL")
    key = idempotency_key()
    want(close(coordinator(down), cid, key), 503, "storage_unavailable")
    after = coord.cycle(cid)
    assert after["status"] == "breakdown" and after["revision"] == before["revision"]
    assert charges(killbill, account, cid) == [], "Kill Bill was touched before the invoice was confirmed"
    with signed_in(browser, down, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        button = role(page, "button", "Close cycle")
        pump(page, lambda: button.count() == 1, "Close cycle shows")
        click(button)
        announced(page, "Coordinator updates", f"File storage is unavailable. {name} was not closed.")
    assert coord.cycle(cid)["status"] == "breakdown"
    final = want(close(coord, cid, key), 200).json()["cycle"]
    assert final["revision"] == before["revision"] + 2
    items = charges(killbill, account, cid)
    assert len(items) == 1 and items[0][0] == "COMMITTED", items


def test_wf_ledger_receipts_paired_history(browser, app_url):
    case = CASE["P-OLIVE"]
    coord, cid, name, members = closable_cycle(app_url)
    want(post_short(coord, cid, "P-OLIVE", 3), 201)
    before = {c: m.credit() for c, m in members.items()}
    want(close(coord, cid), 200)
    expected = {"HH-1004": (6000, 1500), "HH-1002": (2999, 2999)}
    for code, member in members.items():
        moved = all_movements(member)
        own = f"household:{code}"
        total = 0
        for movement in moved:
            assert len(movement["legs"]) == 2 and sum(l["amount_cents"] for l in movement["legs"]) == 0
            total += sum(l["amount_cents"] for l in movement["legs"] if l["account"] == own)
        credit = member.credit()
        assert total == credit["balance_cents"], "the credit history does not sum to the balance"
        ours = [m for m in moved if m["cycle_id"] == cid]
        charge, short = expected[code]
        legs = {m["kind"]: {l["account"]: l["amount_cents"] for l in m["legs"]} for m in ours}
        assert legs == {"pledge_charge": {own: -charge, "club:distributor": charge}, "short_credit": {own: short, "club:distributor": -short}}
        assert {m["memo"] for m in ours} == {f"{name}: {case}"} and len({m["created_at"] for m in ours}) == 1
        assert credit["balance_cents"] == before[code]["balance_cents"] - charge + short
    with signed_in(browser, app_url, "HOME-1002", "/credit") as page:
        table = role(page, "table", "Credit history")
        pump(page, lambda: table.count() == 1 and f"{name}: {case}" in squeeze(table.inner_text()), "the memo prints character for character")
        header = squeeze(table.get_by_role("row").first.inner_text())
        for column in ("DATE", "KIND", "MEMO", "AMOUNT"):
            assert column in header
        pump(page, lambda: usd(members["HH-1002"].credit()["balance_cents"]) in visible_text(page), "the balance figure shows")


def test_wf_ledger_receipts_receipt_mail(app_url, mail):
    case = CASE["P-OLIVE"]
    coord, cid, name, members = closable_cycle(app_url)
    want(post_short(coord, cid, "P-OLIVE", 3), 201)
    want(close(coord, cid), 200)
    subject = f"Pickup receipt: {name}"

    def receipts():
        return [m for m in mail.messages(settle=0) if m["Subject"] == subject]

    poll(lambda: len(receipts()) >= 2, "Mailpit holds both pickup receipts")
    found = [m for m in mail.messages(settle=1.5) if m["Subject"] == subject]
    assert len(found) == 2
    by_to = {addresses(m["To"])[0]: m for m in found}
    balance = members["HH-1002"].credit()["balance_cents"]
    assert text(by_to["hh1002@elmstreet.example"]).strip().splitlines() == [
        f"Pickup receipt for {HOUSEHOLD['HH-1002']}, {name}",
        f"{case}: 2 units, $29.99, short 2 units, credit $29.99",
        "Charged this cycle: $0.00",
        f"New balance: {usd(balance)}",
    ]
    assert text(by_to["hh1004@elmstreet.example"]).strip().splitlines()[1:3] == [f"{case}: 4 units, $60.00, short 1 units, credit $15.00", "Charged this cycle: $45.00"]
    assert by_to["hh1002@elmstreet.example"]["MessageID"].strip("<>") == f"receipt-{cid}-HH-1002@tare-and-tally.example"
    assert "pickup@tare-and-tally.example" in addresses(by_to["hh1002@elmstreet.example"]["From"])
    table = poll(lambda: (lambda r: r if all(x["status"] == "sent" for x in r) else None)(want(coord.call("GET", f"/api/cycles/{cid}/receipts"), 200).json()["receipts"]), "both receipts read sent")
    assert sorted(r["household_code"] for r in table) == ["HH-1002", "HH-1004"]


def test_wf_ledger_receipts_mail_down(browser, app_url, mail):
    coord, cid, name, _ = closable_cycle(app_url)
    down = outage("APP_MAILPIT_DOWN_URL")
    want(close(coordinator(down), cid), 200)
    path = f"/api/cycles/{cid}/receipts"
    poll(lambda: all(r["failed_attempts"] >= 2 and r["status"] == "queued" for r in want(coord.call("GET", path), 200).json()["receipts"]), "failed_attempts counts up with each retry while mail is down", RETRY_WAIT_S)
    assert [m for m in mail.messages(settle=1.5) if name in m["Subject"]] == [], "a process with another endpoint sent the queued mail"
    with signed_in(browser, down, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
        pump(page, lambda: "Receipts are queued and will send when mail is back." in squeeze(role(page, "region", "Notices").inner_text()), "the mail queued banner shows")


def test_mail_recovers_and_stays_with_owner(tmp_path, mail):
    relay = TcpRelay(os.environ["SMTP_HOST"], int(os.environ["SMTP_PORT"]))
    db = new_db(tmp_path)
    try:
        with app_copy(db, SMTP_HOST="127.0.0.1", SMTP_PORT=str(relay.port), MAIL_RETRY_SECONDS="1") as owner, app_copy(db, MAIL_RETRY_SECONDS="1"):
            coord, cid, name, _ = setup_cycle(owner, ("P-QUINOA",), [("HH-1002", "P-QUINOA", 2)])
            pass_cutoff(coord, cid)
            take_up_rest(coord, cid)
            move(coord, cid, "ordered", "received", "breakdown")
            want(upload(coord, cid, "invoice", unique_pdf(), "application/pdf"), 201)
            want(close(coord, cid), 200)
            path = f"/api/cycles/{cid}/receipts"
            poll(lambda: want(coord.call("GET", path), 200).json()["receipts"][0]["failed_attempts"] >= 2, "the owning process counts failed attempts")
            assert [m for m in mail.messages(settle=2.5) if name in m["Subject"]] == [], "a process with another endpoint delivered the receipt"
            relay.up = True
            poll(lambda: want(coord.call("GET", path), 200).json()["receipts"][0]["status"] == "sent", "the next retry sends the receipt")
            assert len(my_mail(mail, f"Pickup receipt: {name}", 1)) == 1
    finally:
        relay.stop()


def test_paged_credit_history(browser, app_url):
    me = household(app_url, "HH-1003")
    total = me.credit()["total_movements"]
    for _ in range(max(0, LEDGER_LIMIT + 3 - total)):
        want(top_up(me, "5.00")[1], 201)
    path = "/api/households/HH-1003/ledger"
    for bad in ("0", "51", "x"):
        answer = want(me.http.get(path, params={"limit": bad}), 422, "validation")
        assert "limit" in answer.json()["error"]["fields"]
    assert "before" in want(me.http.get(path, params={"before": "not-a-cursor"}), 422, "validation").json()["error"]["fields"]
    forged = base64.urlsafe_b64encode(b"2099-01-01T00:00:00Z|999999").decode().rstrip("=")
    assert "before" in want(me.http.get(path, params={"before": forged}), 422, "validation").json()["error"]["fields"]
    assert len(want(me.http.get(path), 200).json()["movements"]) == 20
    first = want(me.http.get(path, params={"limit": 7}), 200).json()
    existing = first["total_movements"]
    seen = list(first["movements"])
    cursor = first["next_before"]
    want(top_up(me, "5.00")[1], 201)
    for _ in range(PAGES_BOUND):
        if not cursor:
            break
        page = want(me.http.get(path, params={"limit": 7, "before": cursor}), 200).json()
        assert page["total_movements"] == existing + 1 and page["balance_cents"] == me.credit()["balance_cents"]
        seen += page["movements"]
        cursor = page["next_before"]
    ids = [m["id"] for m in seen]
    assert len(ids) == existing == len(set(ids)), "a page repeated or skipped a movement"
    order = [(m["created_at"], m["id"]) for m in seen]
    assert order == sorted(order, reverse=True), "history is newest first, then by id"
    with signed_in(browser, app_url, "HOME-1003", "/credit") as page:
        table = role(page, "table", "Credit history")
        pump(page, lambda: table.count() == 1 and table.get_by_role("row").count() > 1, "the table shows")
        button = role(page, "button", "Show older movements")
        everything = existing + 1
        for _ in range(PAGES_BOUND):
            if button.count() == 0:
                break
            button.focus()
            previous_text = live(page, "Credit updates")
            rows_before = table.get_by_role("row").count()
            page.keyboard.press("Enter")
            pump(page, lambda: live(page, "Credit updates") != previous_text and table.get_by_role("row").count() > rows_before, "older rows append and the count is announced")
            pump(page, lambda: re.fullmatch(rf"Showing \d+ of {everything} movements\.", live(page, "Credit updates")), "the published paging copy reads out")
            if button.count():
                assert accessible_name(page) == "Show older movements"
        shown = int(live(page, "Credit updates").split()[1])
        assert shown == everything
        pump(page, lambda: accessible_name(page) == "Credit history", "focus moves to the table when no older movements remain")


def test_wf_ledger_receipts_unicode_subject(app_url, mail):
    coord = coordinator(app_url)
    head = f"Céleste ☕ ♥ {uuid.uuid4().hex[:8]} "
    name = (head + "é" * 60)[:60]
    assert len(name) == 60
    for bad in (name + "é", "two\nlines", "two\rlines", "tab\there", "bell\x07", "c1\x85", "   "):
        answer = want(coord.call("POST", "/api/cycles", {"name": bad}), 422, "validation")
        assert "name" in answer.json()["error"]["fields"], repr(bad)
    trimmed = want(coord.call("POST", "/api/cycles", {"name": f"  {name}  "}), 201).json()
    assert trimmed["name"] == name
    cycle = open_cycle(coord, ("P-QUINOA",), name=name)
    cid = cycle["id"]
    member = household(app_url, "HH-1002")
    fund(member)
    want(pledge(member, cid, "P-QUINOA", 2), 200)
    pass_cutoff(coord, cid)
    take_up_rest(coord, cid)
    move(coord, cid, "ordered", "received", "breakdown")
    want(upload(coord, cid, "invoice", unique_pdf(), "application/pdf"), 201)
    want(close(coord, cid), 200)
    subject = f"Pickup receipt: {name}"
    poll(lambda: [m for m in mail.messages(settle=0) if m["Subject"] == subject], "Mailpit's decoded Subject equals the published text")
    found = [m for m in mail.messages(settle=1.5) if m["Subject"] == subject]
    assert len(found) == 1 and addresses(found[0]["To"]) == ["hh1002@elmstreet.example"]
    assert text(found[0]).strip().splitlines()[0] == f"Pickup receipt for {HOUSEHOLD['HH-1002']}, {name}"


def test_times_entered_in_club_time(app_url):
    coord = coordinator(app_url)

    def draft(**times):
        return coord.call("POST", "/api/cycles", {"name": fresh_name(), **times})

    summer = want(draft(cutoff_local="2027-06-01T20:00:15"), 201).json()
    def utc(text: str) -> str:
        return datetime.fromisoformat(text).replace(tzinfo=CLUB, fold=0).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    assert summer["cutoff_at"] == utc("2027-06-01T20:00:15") and summer["cutoff_display"].endswith("8:00:15 pm CDT")
    plain = want(draft(cutoff_local="2027-12-01T08:05"), 201).json()
    assert plain["cutoff_at"] == utc("2027-12-01T08:05") and plain["cutoff_display"].endswith("8:05 am CST")
    repeated = want(draft(cutoff_local="2027-11-07T01:30"), 201).json()
    assert repeated["cutoff_at"] == utc("2027-11-07T01:30") and repeated["cutoff_display"].endswith("1:30 am CDT")
    gap = want(draft(cutoff_local="2027-03-14T02:30"), 422, "validation")
    assert "cutoff_local" in gap.json()["error"]["fields"]
    for bad in ("2027-03-14 02:30", "soon", "2027-13-01T10:00"):
        assert "pickup_start_local" in want(draft(pickup_start_local=bad), 422, "validation").json()["error"]["fields"]
    empty = want(draft(), 201).json()
    assert empty["cutoff_at"] is None and empty["cutoff_display"] is None and empty["revision"] == 1


def test_opening_rules_report_every_field(app_url):
    coord = coordinator(app_url)
    made = want(coord.call("POST", "/api/cycles", {"name": fresh_name()}), 201).json()
    cid, tag = made["id"], etag_of(made)
    path = f"/api/cycles/{cid}/transitions"
    start = now()
    fields = want(coord.call("POST", path, {"to": "open"}), 422, "validation").json()["error"]["fields"]
    assert {"product_ids", "cutoff_local", "pickup_start_local", "pickup_end_local"} <= set(fields)
    want(coord.call("POST", path, {"to": "open", "name": "x"}), 428, "precondition_required")
    bad = {"to": "open", "name": " ", "cutoff_local": local(start - timedelta(hours=1)), "pickup_start_local": local(start - timedelta(hours=2)), "pickup_end_local": local(start + timedelta(hours=11)), "product_ids": []}
    fields = want(coord.call("POST", path, bad, etag=tag), 422, "validation").json()["error"]["fields"]
    assert {"name", "cutoff_local", "pickup_start_local", "pickup_end_local", "product_ids"} <= set(fields)
    unchanged = coord.cycle(cid)
    assert unchanged["status"] == "draft" and unchanged["revision"] == 1 and unchanged["name"] == made["name"] and unchanged["cutoff_at"] is None
    gap = dict(bad, cutoff_local="2027-03-14T02:30", name=made["name"], product_ids=["P-TAHINI"], pickup_start_local=local(start + timedelta(hours=2)), pickup_end_local=local(start + timedelta(hours=3)))
    fields = want(coord.call("POST", path, gap, etag=tag), 422, "validation").json()["error"]["fields"]
    assert set(fields) == {"cutoff_local"}, "a rule depending on an invalid time must be skipped"
    assert "product_ids" in want(coord.call("POST", path, dict(gap, cutoff_local=local(start + timedelta(hours=1)), product_ids=["P-NOPE"]), etag=tag), 422, "validation").json()["error"]["fields"]
    limit = dict(gap, cutoff_local=local(start + timedelta(hours=1)), pickup_end_local=local(start + timedelta(hours=14, seconds=1)))
    assert set(want(coord.call("POST", path, limit, etag=tag), 422, "validation").json()["error"]["fields"]) == {"pickup_end_local"}
    good = dict(limit, pickup_end_local=local(start + timedelta(hours=14)))
    opened = want(coord.call("POST", path, good, etag=tag), 200).json()
    assert opened["status"] == "open" and opened["revision"] == 2 and opened["accepting_pledges"] is True
    past = local(now() - timedelta(days=1))
    draft = want(coord.call("POST", "/api/cycles", {"name": fresh_name(), "cutoff_local": past}), 201).json()
    saved = want(coord.call("PATCH", f"/api/cycles/{draft['id']}", {"cutoff_local": past}, etag=etag_of(draft)), 200).json()
    assert saved["status"] == "draft" and saved["revision"] == 2


def test_cycle_state_machine(app_url):
    coord = coordinator(app_url)
    made = want(coord.call("POST", "/api/cycles", {"name": fresh_name(), **{k: v for k, v in draft_body("x", ("P-QUINOA",), 3600, 7200, 3600).items() if k != "name"}}), 201).json()
    cid = made["id"]
    path = f"/api/cycles/{cid}/transitions"

    def refused(*targets):
        before = coord.cycle(cid)
        for target in targets:
            answer = coord.call("POST", path, {"to": target}, key=idempotency_key() if target == "closed" else None)
            want(answer, 409, "illegal_transition")
        after = coord.cycle(cid)
        assert (after["status"], after["revision"]) == (before["status"], before["revision"])

    refused("sealing", "ordered", "received", "breakdown", "closing", "closed", "draft")
    assert move(coord, cid, "open")["revision"] == made["revision"] + 1
    refused("open", "sealing", "ordered", "received", "breakdown", "closing", "closed")
    pass_cutoff(coord, cid)
    revision = coord.cycle(cid)["revision"]
    assert coord.cycle(cid)["revision"] == revision, "the cutoff switch never changes the revision"
    refused("open", "sealing", "received", "breakdown", "closing", "closed", "draft")
    take_up_rest(coord, cid)
    for index, (target, wrong) in enumerate((("ordered", ("sealing", "breakdown", "closed")), ("received", ("ordered", "closed")), ("breakdown", ("received", "closing")))):
        assert move(coord, cid, target)["revision"] == revision + index + 1
        refused(*wrong)


def test_pledges_by_day(browser, tmp_path):
    with app_copy(new_db(tmp_path)) as base:
        coord, member = coordinator(base), household(base, "HH-1001")
        seed = want(coord.call("GET", "/api/cycles/cy-44/daily"), 200).json()
        today = club_today()
        assert seed["time_zone"] == "America/Chicago"
        assert seed["days"] == [{"date": today, "units_pledged": 19, "units_withdrawn": 0}]
        cid = open_cycle(coord, ("P-OATS",))["id"]
        for action, expected in ((lambda: pledge(member, cid, "P-OATS", 5), (5, 0)), (lambda: pledge(member, cid, "P-OATS", 3), (5, 2)), (lambda: pledge(member, cid, "P-OATS", 4), (6, 2)), (lambda: withdraw(member, cid, "P-OATS"), (6, 6))):
            want(action(), 200)
            days = want(coord.call("GET", f"/api/cycles/{cid}/daily"), 200).json()["days"]
            assert sum(d["units_pledged"] for d in days) == expected[0] and sum(d["units_withdrawn"] for d in days) == expected[1]
        assert today in [d["date"] for d in days] or club_today() in [d["date"] for d in days]
        assert [d["date"] for d in days] == sorted(d["date"] for d in days)
        with signed_in(browser, base, COORD_CODE, f"/coordinator/cycles/{cid}") as page:
            table = role(page, "table", "Pledges by day")
            pump(page, lambda: table.count() == 1 and days[0]["date"] in table.inner_text(), "the table prints the date")
            shown = squeeze(table.inner_text())
            assert all(col in shown for col in ("DATE", "PLEDGED", "WITHDRAWN"))
            assert f"{days[0]['date']} {days[0]['units_pledged']} {days[0]['units_withdrawn']}" in shown


def test_pickup_limit_across_clock_changes(app_url):
    coord = coordinator(app_url)

    def draft(start, end):
        return coord.call("POST", "/api/cycles", {"name": fresh_name(), "pickup_start_local": start, "pickup_end_local": end})

    fall = want(draft("2027-11-06T20:00", "2027-11-07T07:00"), 201).json()
    assert fall["pickup_display"] == "Sat 6 Nov, 8:00 pm CDT to Sun 7 Nov, 7:00 am CST"
    too_long = want(draft("2027-11-06T20:00", "2027-11-07T07:00:01"), 422, "validation")
    assert "pickup_end_local" in too_long.json()["error"]["fields"], "eleven wall-clock hours here are twelve elapsed"
    spring = want(draft("2027-03-13T20:00", "2027-03-14T09:00"), 201).json()
    shown = spring["pickup_display"]
    assert " to " in shown and shown.index("CST") < shown.index("CDT"), shown
    same = want(draft("2027-07-10T09:00", "2027-07-10T12:00"), 201).json()
    assert " to " in same["pickup_display"] and same["pickup_display"].endswith("CDT") and "CST" not in same["pickup_display"]
    assert "pickup_end_local" in want(draft("2027-07-10T09:00", "2027-07-10T09:00"), 422, "validation").json()["error"]["fields"]


def test_wf_cycle_lifecycle_problem_summary(browser, app_url):
    name_error = "Cycle name: Name the cycle in 1 to 60 characters on one line."
    gap_error = "Cutoff (club time): That time doesn't exist in club time."
    start = now()
    with signed_in(browser, app_url, COORD_CODE, "/coordinator/cycles/new") as page:
        name, cutoff = role(page, "textbox", "Cycle name"), role(page, "textbox", "Cutoff (club time)")
        pump(page, lambda: name.count() == 1, "the form shows")
        fill(cutoff, "2027-03-14 02:30")
        click(role(page, "button", "Save draft"))
        announced(page, "Coordinator updates", "2 problems stop this cycle from saving.")
        summary = role(page, "list", "Problems with this cycle")
        links = summary.get_by_role("link")
        assert links.all_inner_texts() == [name_error, gap_error]
        assert accessible_name(page) == name_error, "focus moves to the first problem link"
        expect(cutoff).to_have_accessible_description("That time doesn't exist in club time.")
        click(role(summary, "link", gap_error))
        pump(page, lambda: accessible_name(page) == "Cutoff (club time)", "the link moves focus to its field")
        fill(cutoff, ui_time(start + timedelta(hours=1)))
        click(role(page, "button", "Save draft"))
        announced(page, "Coordinator updates", "1 problem stops this cycle from saving.")
        assert links.all_inner_texts() == [name_error]
        expect(cutoff).not_to_have_attribute("aria-invalid", "true")
        fresh = fresh_name()
        fill(name, fresh)
        click(role(page, "button", "Save draft"))
        pump(page, lambda: re.fullmatch(r"/coordinator/cycles/cy-\d+", path_of(page)), "the fixed form saves")
        pump(page, lambda: summary.count() == 0, "the summary disappears on a successful save")
        click(role(page, "button", "Open cycle"))
        announced(page, "Coordinator updates", "3 problems stop this cycle from opening.")
        assert links.all_inner_texts() == ["Pickup starts (club time): Use YYYY-MM-DD HH:MM in club time.", "Pickup ends (club time): Use YYYY-MM-DD HH:MM in club time.", "Cases: Tick at least one case."]
        click(role(summary, "link", "Cases: Tick at least one case."))
        pump(page, lambda: accessible_name(page) == CASE["P-OATS"], "the Cases link focuses the first checkbox")
        fill(role(page, "textbox", "Pickup starts (club time)"), ui_time(start + timedelta(hours=2)))
        fill(role(page, "textbox", "Pickup ends (club time)"), ui_time(start + timedelta(hours=3)))
        click(role(page, "button", "Open cycle"))
        announced(page, "Coordinator updates", "1 problem stops this cycle from opening.")
        assert links.all_inner_texts() == ["Cases: Tick at least one case."]
    answer = coordinator(app_url).call("POST", "/api/cycles", {"name": "", "cutoff_local": "2027-03-14T02:30", "product_ids": ["P-NOPE"]})
    assert {"name", "cutoff_local", "product_ids"} <= set(want(answer, 422, "validation").json()["error"]["fields"])


def test_wf_cycle_lifecycle_keyboard_draft(browser, app_url):
    start = now()
    name = fresh_name()
    catalogue = list(CASE.values())
    with signed_in(browser, app_url, COORD_CODE, "/coordinator/cycles/new") as page:
        field = role(page, "textbox", "Cycle name")
        pump(page, lambda: field.count() == 1, "the form shows")
        field.focus()
        order = tab_order(page, 4 + len(catalogue))
        assert order == ["Cutoff (club time)", "Pickup starts (club time)", "Pickup ends (club time)", *catalogue, "Save draft"], order
        field.focus()
        page.keyboard.type(name)
        page.keyboard.press("Enter")
        pump(page, lambda: re.fullmatch(r"/coordinator/cycles/cy-\d+", path_of(page)), "Enter in a field saves the draft")
        cid = path_of(page).rsplit("/", 1)[1]
        open_button = role(page, "button", "Open cycle")
        pump(page, lambda: open_button.count() == 1, "the draft's own address offers Open cycle")
        open_button.focus()
        page.keyboard.press("Enter")
        link = "Cutoff (club time): Use YYYY-MM-DD HH:MM in club time."
        pump(page, lambda: accessible_name(page) == link, "focus moves to the first problem link")
        page.keyboard.press("Enter")
        pump(page, lambda: accessible_name(page) == "Cutoff (club time)", "Enter on the link moves focus to its field")
        page.keyboard.type(ui_time(start + timedelta(hours=1)))
        page.keyboard.press("Tab")
        page.keyboard.type(ui_time(start + timedelta(hours=2)))
        page.keyboard.press("Tab")
        page.keyboard.type(ui_time(start + timedelta(hours=3)))
        page.keyboard.press("Tab")
        assert accessible_name(page) == catalogue[0]
        page.keyboard.press("Space")
        assert role(page, "checkbox", catalogue[0]).is_checked()
        for _ in catalogue:
            page.keyboard.press("Tab")
        assert accessible_name(page) == "Save draft"
        page.keyboard.press("Tab")
        assert accessible_name(page) == "Open cycle"
        page.keyboard.press("Enter")
        announced(page, "Coordinator updates", f"{name} is now open.")
    cycle = coordinator(app_url).cycle(cid)
    assert cycle["status"] == "open" and [l["product_id"] for l in cycle["lines"]] == [next(iter(CASE))]


def test_wf_crate_state_agrees(browser, app_url):
    t, s, d = CASE["P-TAHINI"], CASE["P-OLIVE"], CASE["P-QUINOA"]
    coord, cid, _, members = setup_cycle(app_url, ("P-TAHINI", "P-OLIVE", "P-QUINOA"), [("HH-1002", "P-TAHINI", 3), ("HH-1001", "P-OLIVE", 4), ("HH-1002", "P-OLIVE", 2), ("HH-1001", "P-QUINOA", 2), ("HH-1002", "P-QUINOA", 1)], funded=True)
    fund(household(app_url, "HH-1001"))
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, t)
        step_to(page, t, 2)
        page.keyboard.press("Enter")
        pump(page, lambda: crate_named(page, t, 5, 12, "filling") and to_go(page, t) == 7, "the crate follows the confirmed pledge")
        frames(page, 130)
        for _ in range(2):
            pump(page, lambda: picture(crate(page, t)) is not None, "the crate is drawn")
            frames(page, 5)
            image = picture(crate(page, t))
            assert patches(image, cell_colour(page, t, "mine")) == 2, "the household's unit tops do not match its cells"
            assert patches(image, cell_colour(page, t, "taken")) == 3, "other households' unit tops do not match their cells"
            corners_match(page, t)
            page.reload()
            on_cycle(page, t)
            pump(page, lambda: crate_named(page, t, 5, 12, "filling"), "the crate name survives a reload")
        assert crate_named(page, s, 6, 6, "sealed")
        frames(page, 5)
        shut = picture(crate(page, s))
        assert patches(shut, cell_colour(page, t, "mine")) == 0, "a shut lid must hide the units"
        corners_match(page, s)
        want(withdraw(members["HH-1002"], cid, "P-OLIVE"), 200)
        pump(page, lambda: crate_named(page, s, 4, 6, "filling"), "an unsealed crate follows", REFRESH_WINDOW_MS)
        frames(page, 5)
        assert patches(picture(crate(page, s)), cell_colour(page, s, "mine")) == 4
        pass_cutoff(coord, cid)
        want(resolve(coord, cid, "P-QUINOA", "drop"), 200)
        pump(page, lambda: crate_named(page, d, 3, 10, "dropped"), "a dropped crate is named", REFRESH_WINDOW_MS)
        frames(page, 5)
        muted = cell_colour(page, d, "mine")
        assert patches(picture(crate(page, d)), muted) == 3, "dropped tops match a dropped block's filled cell"
        want(resolve(coord, cid, "P-TAHINI", "take_up"), 200)
        pump(page, lambda: crate_named(page, t, 12, 12, "taken up"), "a taken-up crate is named", REFRESH_WINDOW_MS)


def test_wf_crate_state_live_refresh(browser, app_url):
    t = CASE["P-TAHINI"]
    _, cid, _, members = setup_cycle(app_url, ("P-TAHINI",), [("HH-1002", "P-TAHINI", 1), ("HH-1001", "P-TAHINI", 2)], funded=True)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, t)
        pump(page, lambda: crate_named(page, t, 3, 12, "filling"), "the crate shows the seed line")
        frames(page, 5)
        want(pledge(members["HH-1002"], cid, "P-TAHINI", 4), 200)
        pump(page, lambda: crate_named(page, t, 6, 12, "filling"), "the crate name follows the refresh", REFRESH_WINDOW_MS)
        assert role(page, "img", "6 of 12 units pledged").count() == 1 and to_go(page, t) == 6, "name, grid and numeral change in one frame"
        frames(page)
        image = picture(crate(page, t))
        assert patches(image, cell_colour(page, t, "mine")) == 2 and patches(image, cell_colour(page, t, "taken")) == 4
        assert live(page, "Pledge updates") == ""


def test_crate_still_when_idle(browser, app_url):
    t, m = CASE["P-TAHINI"], CASE["P-MAPLE"]
    _, cid, _, members = setup_cycle(app_url, ("P-TAHINI", "P-MAPLE"), [("HH-1002", "P-TAHINI", 2), ("HH-1002", "P-MAPLE", 6)], funded=True)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", PHONE, spy=True) as page:
        on_cycle(page, t)
        frames(page, 10)
        first = capture(crate(page, t))
        for _ in range(2):
            run_refresh(page, cid)
            advance(page, 1000)
            assert capture(crate(page, t)) == first, "the crate drew with no published cause"
        click(role(page, "tab", "Sealed"))
        on_cycle(page, m)
        frames(page, 2)
        assert decode(capture(crate(page, m))).variance() > 0, "a newly shown crate is blank"
        draws = page.evaluate("window.__gl.hiddenDraws")
        want(pledge(members["HH-1002"], cid, "P-TAHINI", 5), 200)
        run_refresh(page, cid)
        advance(page, 500)
        assert page.evaluate("window.__gl.hiddenDraws") == draws, "a crate in a hidden panel drew"
        click(role(page, "tab", "Open"))
        on_cycle(page, t)
        frames(page, 2)
        assert crate_named(page, t, 5, 12, "filling")
        assert patches(picture(crate(page, t)), cell_colour(page, t, "taken")) == 5, "the shown panel's crate has the newest picture by the next frame"


def test_one_webgl_context(browser, app_url):
    pids = tuple(CASE)
    _, cid, name, _ = setup_cycle(app_url, pids)
    with signed_in(browser, app_url, COORD_CODE, f"/coordinator/cycles/{cid}", spy=True) as page:
        pump(page, lambda: role(page, "table", "Lines").count() == 1, "the coordinator screen shows")
        assert page.evaluate("window.__gl.count") == 0
    warnings = []
    with signed_in(browser, app_url, "HOME-1001", "/", spy=True) as page:
        page.on("console", lambda m: warnings.append(m.text) if "too many active" in m.text.lower() else None)
        link = role(page, "list", "Open cycles").get_by_role("link", name=name, exact=True)
        pump(page, lambda: link.count() == 1, "the home lists the cycle")
        assert page.evaluate("window.__gl.count") == 0, "member home created a WebGL context"
        click(link)
        for case in CASE.values():
            on_cycle(page, case)
            pump(page, lambda: crate(page, case).count() == 1, "every block has its crate")
        frames(page, 10)
        for view in (PHONE, DESKTOP, SIDEWAYS, TABLET):
            page.set_viewport_size(view)
            frames(page, 5)
        click(role(page, "link", "Credit history"))
        pump(page, lambda: role(page, "table", "Credit history").count() == 1, "the history shows")
        page.go_back()
        on_cycle(page, CASE["P-TAHINI"])
        frames(page, 5)
        assert page.evaluate("window.__gl.count") <= 1, "a document created more than one WebGL context"
        assert page.evaluate("window.__gl.count") == 1, "the member cycle draws through WebGL here"
    assert warnings == []


def crate_changes(page: Page, case: str, total_ms: int, step_ms: int) -> list[int]:
    previous, times, elapsed = capture(crate(page, case)), [], 0
    while elapsed < total_ms:
        advance(page, step_ms)
        elapsed += step_ms
        current = capture(crate(page, case))
        if current != previous:
            times.append(elapsed)
        previous = current
    return times


def test_wf_crate_effects_reduced_motion(browser, tmp_path):
    q = CASE["P-QUINOA"]
    with app_copy(new_db(tmp_path)) as base:
        coord = coordinator(base)
        cid = open_cycle(coord, ("P-QUINOA",))["id"]
        want(pledge(household(base, "HH-1002"), cid, "P-QUINOA", 5), 200)
        with signed_in(browser, base, "HOME-1001", f"/cycles/{cid}", reduced_motion="reduce") as page:
            on_cycle(page, q)
            frames(page, 5)
            step_to(page, q, 5)
            await_answer(page, "PUT", "/lines/P-QUINOA/pledge", lambda: page.keyboard.press("Enter"))
            before = capture(crate(page, q))
            frames(page, 2)
            assert cells(page, q).count("mine") == 5 and to_go(page, q) == 0, "the final state arrives on the next frame"
            assert "Sealed" in squeeze(block(page, q).inner_text()) and crate_named(page, q, 10, 10, "sealed")
            assert animations(block(page, q)) == [], "an animation ran under reduced motion"
            changes = 1 if capture(crate(page, q)) != before else 0
            changes += len(crate_changes(page, q, 400, SEQUENCE_STEP_MS))
            assert changes <= 2, f"{changes} crate frames for one change"
            announced(page, "Pledge updates", f"Pledged 5 of {q}. Case sealed.")
            assert accessible_name(page) == f"Units of {q}"
            click(role(page, "button", f"Withdraw from {q}"))
            dialog = role(page, "dialog", "Withdraw pledge")
            pump(page, lambda: dialog.count() == 1, "the dialog appears")
            frames(page, 1)
            assert animations(dialog) == []
            click(role(dialog, "button", "Withdraw"))
            announced(page, "Pledge updates", f"Withdrew from {q}. 5 to go.")
            pump(page, lambda: cells(page, q).count("mine") == 0, "the reversal jumps to its end")
            frames(page, 5)
            page.emulate_media(reduced_motion="no-preference")
            step_to(page, q, 5)
            await_answer(page, "PUT", "/lines/P-QUINOA/pledge", lambda: page.keyboard.press("Enter"))
            motion_frames = len(crate_changes(page, q, SEQUENCE_MAX_MS, SAMPLE_STEP_MS))
            assert motion_frames > 2, "a preference change must take effect on the next change, without reload"


def test_wf_crate_effects_fill_and_seal(browser, tmp_path):
    q, o = CASE["P-QUINOA"], CASE["P-OLIVE"]
    with app_copy(new_db(tmp_path)) as base:
        coord = coordinator(base)
        cid = open_cycle(coord, ("P-QUINOA", "P-OLIVE"))["id"]
        want(pledge(household(base, "HH-1002"), cid, "P-QUINOA", 9), 200)
        with signed_in(browser, base, "HOME-1001", f"/cycles/{cid}") as page:
            on_cycle(page, q)
            frames(page, 10)
            still = capture(crate(page, o))
            step_to(page, o, 6)
            page.keyboard.press("Enter")
            announced(page, "Pledge updates", f"Not enough credit for {o}. Top up to pledge more.")
            frames(page, 20)
            assert capture(crate(page, o)) == still, "a refused pledge drew on the crate"
            step_to(page, q, 1)
            await_answer(page, "PUT", "/lines/P-QUINOA/pledge", lambda: page.keyboard.press("Enter"))
            times = crate_changes(page, q, SEQUENCE_MAX_MS + 300, SAMPLE_STEP_MS)
            assert times, "the crate moved on the confirmed change"
            assert times[-1] <= SEQUENCE_MAX_MS, f"the crate settled at {times[-1]} ms"
            segments = [[times[0]]]
            for at in times[1:]:
                if at - segments[-1][-1] > 2 * SAMPLE_STEP_MS:
                    segments.append([at])
                else:
                    segments[-1].append(at)
            assert len(segments) >= 2, f"the unit's drop and the seal step must be separate moves: {times}"
            seal = segments[-1][-1] - segments[-1][0]
            assert SEAL_MIN_MS - 2 * SAMPLE_STEP_MS <= seal <= SEAL_MAX_MS + 2 * SAMPLE_STEP_MS, f"the seal step took {seal} ms"
            assert crate_named(page, q, 10, 10, "sealed") and to_go(page, q) == 0
            assert patches(picture(crate(page, q)), cell_colour(page, o, "empty")) >= 0
            mine = (214, 90, 30)
            shut = capture(crate(page, q))
            click(role(page, "button", f"Withdraw from {q}"))
            dialog = role(page, "dialog", "Withdraw pledge")
            pump(page, lambda: dialog.count() == 1, "the dialog opens")
            await_answer(page, "DELETE", "/lines/P-QUINOA/pledge", lambda: click(role(dialog, "button", "Withdraw")))
            reverse = crate_changes(page, q, SEQUENCE_MAX_MS + 300, SAMPLE_STEP_MS)
            assert reverse and reverse[-1] <= SEQUENCE_MAX_MS and capture(crate(page, q)) != shut
            assert crate_named(page, q, 9, 10, "filling") and mine


def test_wf_crate_effects_interrupted(browser, tmp_path):
    q = CASE["P-QUINOA"]
    with app_copy(new_db(tmp_path)) as base:
        coord = coordinator(base)
        cid = open_cycle(coord, ("P-QUINOA",))["id"]
        other = household(base, "HH-1002")
        me = household(base, "HH-1001")
        want(pledge(other, cid, "P-QUINOA", 2), 200)
        with signed_in(browser, base, "HOME-1001", f"/cycles/{cid}") as page:
            on_cycle(page, q)
            frames(page, 5)
            old = {}
            def keep_old(route):
                if route.request.method == "GET" and "body" not in old:
                    old["body"] = route.fetch()
                route.fallback()
            page.route(f"**/api/cycles/{cid}", keep_old)
            run_refresh(page, cid)
            page.unroute(f"**/api/cycles/{cid}")
            hold: list[Any] = []

            def catch(route):
                if route.request.method == "GET" and not hold:
                    hold.append(route)
                else:
                    route.fallback()

            page.route(f"**/api/cycles/{cid}", catch)
            step_to(page, q, 4)
            await_answer(page, "PUT", "/lines/P-QUINOA/pledge", lambda: page.keyboard.press("Enter"))
            deadline = time.monotonic() + REAL_WAIT_S
            while time.monotonic() < deadline and not hold:
                page.evaluate("1")
            assert hold, "the page asks for the cycle after a pledge response"
            advance(page, CELL_GAP_MS)
            assert cells(page, q).count("mine") < 4 or animations(block(page, q)) != [], "the sequence is still running"
            want(pledge(other, cid, "P-QUINOA", 3), 200)
            newest = me.line(cid, "P-QUINOA")
            hold[0].fallback()
            page.unroute(f"**/api/cycles/{cid}")
            pump(page, lambda: cells(page, q) == newest["cells"], "the newer line replaces the running sequence", GRACE_MS)
            frames(page, 1)
            assert to_go(page, q) == newest["units_to_go"] and crate_named(page, q, 7, 10, "filling")
            settled = capture(crate(page, q))
            assert crate_changes(page, q, SEQUENCE_MAX_MS, 100) == [], "a step of the cancelled sequence ran"
            assert capture(crate(page, q)) == settled and cells(page, q) == newest["cells"]
            page.route(f"**/api/cycles/{cid}", lambda route: route.fulfill(response=old["body"]))
            run_refresh(page, cid)
            assert capture(crate(page, q)) == settled and cells(page, q) == newest["cells"], "an older line touched the crate"


def test_wf_crate_input_rotation(browser, app_url):
    t, m = CASE["P-TAHINI"], CASE["P-MAPLE"]
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI", "P-MAPLE"), [("HH-1002", "P-MAPLE", 6)], funded=True)
    fund(household(app_url, "HH-1001"))
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", TABLET) as page:
        rail, tabs = role(page, "complementary", "Sealed cases"), role(page, "tablist", "Cases")
        on_cycle(page, t)

        def cross(view):
            page.set_viewport_size(view)
            frames(page, 2)
            narrow = view["width"] < TABLET["width"]
            pump(page, lambda: (tabs.count(), rail.count()) == ((1, 0) if narrow else (0, 1)), f"one of rail and tabs at {view}", 1000)

        step_to(page, t, 1)
        page.keyboard.press("Enter")
        announced(page, "Pledge updates", f"Pledged 1 of {t}. 11 to go.")
        pump(page, lambda: to_go(page, t) == 11, "the sequence ends")
        turn(page, t).focus()
        page.keyboard.press("ArrowRight")
        step_to(page, t, 3)
        last = live(page, "Pledge updates")
        cross(BELOW_RAIL)
        assert accessible_name(page) == f"Units of {t}" and spin_value(spin(page, t)) == 3 and turned(page, t) == TURN_STEP
        assert role(page, "tab", "Open").get_attribute("aria-selected") == "true" and live(page, "Pledge updates") == last
        role(page, "tab", "Open").focus()
        assert not [n for n in tab_order(page, 25) if n and m in n], "Tab reached the hidden panel"
        layout(page)
        role(page, "tab", "Sealed").focus()
        cross(TABLET)
        pump(page, lambda: accessible_name(page) == "Sealed cases", "focus moves to the rail from tab Sealed")
        cross(BELOW_RAIL)
        pump(page, lambda: accessible_name(page) == "Sealed", "focus moves to tab Sealed from the rail")
        assert role(page, "tab", "Sealed").get_attribute("aria-selected") == "true"
        role(page, "tab", "Open").focus()
        cross(SIDEWAYS)
        pump(page, lambda: accessible_name(page) == f"Units of {t}", "focus moves to the first open block from tab Open")
        spin(page, m).focus()
        cross(PHONE)
        assert accessible_name(page) == f"Units of {m}" and role(page, "tab", "Sealed").get_attribute("aria-selected") == "true", "the selected tab holds the focused case"
        click(role(page, "button", "Top up"))
        amount = role(page, "textbox", "Amount in dollars")
        pump(page, lambda: amount.count() == 1, "the dialog opens")
        typed = "7.77"
        fill(amount, typed)
        cross(SIDEWAYS)
        assert role(page, "dialog", "Top up credit").count() == 1 and amount.input_value() == typed and accessible_name(page) == "Amount in dollars"
        inside_viewport(page, role(page, "dialog", "Top up credit"))
        assert live(page, "Pledge updates") == last and live(page, "Credit updates") == ""


def test_wf_crate_input_turning(browser, app_url):
    t = CASE["P-TAHINI"]
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI", "P-OATS"))
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", reduced_motion="reduce") as page:
        on_cycle(page, t)
        slider = turn(page, t)
        assert turned(page, t) == 0 and slider.get_attribute("aria-valuemin") == "-75" and slider.get_attribute("aria-valuemax") == "75"
        frames(page, 5)
        home = capture(crate(page, t))
        slider.focus()
        for key, value in (("ArrowRight", TURN_STEP), ("ArrowUp", 2 * TURN_STEP), ("ArrowLeft", TURN_STEP), ("ArrowDown", 0), ("End", TURN_MAX), ("ArrowRight", TURN_MAX), ("Home", -TURN_MAX), ("ArrowLeft", -TURN_MAX)):
            page.keyboard.press(key)
            assert turned(page, t) == value, key
        frames(page)
        assert capture(crate(page, t)) != home, "turning did not change the picture"
        corners_match(page, t)
        page.keyboard.press("End")
        frames(page)
        corners_match(page, t)
        box = slider.bounding_box()
        assert box["height"] >= TARGET_PX - 0.5, "the TURN strip is at least 44 px tall"
        for fraction, expected in ((0.5, 0), (0.75, 37.5), (0.02, -72)):
            page.mouse.click(box["x"] + box["width"] * fraction, box["y"] + box["height"] / 2)
            frames(page)
            assert abs(turned(page, t) - expected) <= 5, f"strip at {fraction} gave {turned(page, t)}"
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        start = turned(page, t)
        spin(page, t).focus()
        c = crate(page, t).bounding_box()
        x, y = c["x"] + c["width"] / 2, c["y"] + c["height"] / 2
        page.mouse.move(x, y)
        page.mouse.down()
        page.mouse.move(x + 40, y)
        page.mouse.up()
        frames(page)
        assert abs(turned(page, t) - (start + 20)) <= 1, "a mouse drag turns 0.5 degrees per pixel, rightward positive"
        assert accessible_name(page) == f"Units of {t}", "dragging moved focus"
        assert live(page, "Pledge updates") == ""
        kept = turned(page, t)
        run_refresh(page, cid)
        assert turned(page, t) == kept, "a refresh turned the crate"
        page.reload()
        on_cycle(page, t)
        assert turned(page, t) == 0, "a page load resets the turn"
        page.set_viewport_size(PHONE)
        cdp = session(page)
        cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
        frames(page)
        crate(page, t).evaluate("e => e.scrollIntoView({block: 'center'})")
        frames(page)
        c = crate(page, t).bounding_box()
        x, y = c["x"] + c["width"] / 2, c["y"] + c["height"] / 2

        def swipe(dx, dy):
            cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
            for step in range(1, 11):
                cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": x + dx * step / 10, "y": y + dy * step / 10}]})
            cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
            frames(page)

        swipe(40, 0)
        assert abs(turned(page, t) - 20) <= 2, "a sideways touch turns the crate"
        before_scroll = page.evaluate("window.scrollY")
        swipe(0, -120)
        pump(page, lambda: page.evaluate("window.scrollY") > before_scroll, "a vertical swipe scrolls the page")
        assert abs(turned(page, t) - 20) <= 2, "a vertical swipe turned the crate"


def test_crate_survives_size_changes(browser, app_url):
    t, m = CASE["P-TAHINI"], CASE["P-MAPLE"]
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI", "P-MAPLE"), [("HH-1002", "P-MAPLE", 6)], funded=True)
    measure = "c => { const r = c.getBoundingClientRect(); return {w: c.width, h: c.height, rw: r.width, rh: r.height, dpr: devicePixelRatio}; }"
    for scale in (1, 2, 3):
        with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", scale=scale) as page:
            on_cycle(page, t)
            for view in (DESKTOP, TABLET, PHONE, SIDEWAYS):
                page.set_viewport_size(view)
                frames(page, 2)
                on_cycle(page, t)
                size = crate(page, t).evaluate(measure)
                ratio = min(size["dpr"], 2)
                assert abs(size["w"] - size["rw"] * ratio) <= 1.01 and abs(size["h"] - size["rh"] * ratio) <= 1.01, f"{view}: {size}"
                assert abs(size["rw"] / size["rh"] - 4 / 3) <= 0.05, f"the picture is four wide to three tall: {size}"
                if view["height"] < 500:
                    assert 120 - 0.5 <= size["rw"] <= 200 + 0.5 and size["rh"] <= 150 + 0.5, f"sideways crate: {size}"
                assert decode(capture(crate(page, t))).variance() > 0, f"the crate is blank at {view}"
            page.set_viewport_size(DESKTOP)
            frames(page, 2)
            railed = crate(page, m).evaluate(measure)
            assert railed["rw"] >= 120 - 0.5 and decode(capture(crate(page, m))).variance() > 0


def test_wf_crate_fallback_no_webgl(browser, app_url):
    t, m = CASE["P-TAHINI"], CASE["P-MAPLE"]
    _, cid, _, members = setup_cycle(app_url, ("P-TAHINI", "P-MAPLE"), [("HH-1002", "P-TAHINI", 2), ("HH-1002", "P-MAPLE", 6)], funded=True)
    fund(household(app_url, "HH-1001"))
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", reduced_motion="reduce", no_webgl=True) as page:
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.reload()
        on_cycle(page, t)
        pump(page, lambda: crate_named(page, t, 2, 12, "filling") and crate_named(page, m, 6, 6, "sealed"), "still crates carry their names")
        assert page.get_by_role("slider").count() == 0, "the turn control is absent without WebGL"
        frames(page, 5)
        assert decode(capture(crate(page, m))).variance() > 0
        step_to(page, t, 3)
        page.keyboard.press("Enter")
        announced(page, "Pledge updates", f"Pledged 3 of {t}. 7 to go.")
        pump(page, lambda: crate_named(page, t, 5, 12, "filling"), "the still crate follows the pledge")
        frames(page, 3)
        image = picture(crate(page, t))
        assert patches(image, cell_colour(page, t, "mine")) == 3 and patches(image, cell_colour(page, t, "taken")) == 2
        want(pledge(members["HH-1002"], cid, "P-TAHINI", 4), 200)
        pump(page, lambda: crate_named(page, t, 7, 12, "filling"), "the still crate follows a refresh", REFRESH_WINDOW_MS)
        assert live(page, "Pledge updates") == f"Pledged 3 of {t}. 7 to go."
        assert errors == [], f"uncaught errors: {errors}"


def test_wf_crate_fallback_lost_context(browser, app_url):
    t = CASE["P-TAHINI"]
    _, cid, _, members = setup_cycle(app_url, ("P-TAHINI",), [("HH-1002", "P-TAHINI", 2)], funded=True)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}", spy=True) as page:
        on_cycle(page, t)
        pump(page, lambda: page.evaluate("window.__gl.count") == 1, "the crate draws through one WebGL context")
        slider = turn(page, t)
        slider.focus()
        page.keyboard.press("ArrowRight")
        frames(page, 3)
        page.evaluate("window.__ext = window.__gl.list[0].getExtension('WEBGL_lose_context'); window.__ext.loseContext()")
        pump(page, lambda: slider.get_attribute("aria-disabled") == "true", "the slider is paused while the context is lost")
        assert accessible_name(page) == f"Turn crate of {t}" and turned(page, t) == TURN_STEP
        page.keyboard.press("ArrowRight")
        assert turned(page, t) == TURN_STEP, "the paused slider took input"
        frames(page, 3)
        assert patches(picture(crate(page, t)), cell_colour(page, t, "taken")) == 2, "the still drawing shows the same tops"
        want(pledge(members["HH-1002"], cid, "P-TAHINI", 5), 200)
        pump(page, lambda: crate_named(page, t, 5, 12, "filling") and patches(picture(crate(page, t)), cell_colour(page, t, "taken")) == 5, "the still crate follows the server", REFRESH_WINDOW_MS)
        page.evaluate("window.__ext.restoreContext()")
        pump(page, lambda: slider.get_attribute("aria-disabled") != "true", "the slider works again after restore")
        frames(page, 3)
        page.keyboard.press("ArrowRight")
        assert turned(page, t) == 2 * TURN_STEP
        page.keyboard.press("ArrowLeft")
        frames(page, 3)
        assert decode(capture(crate(page, t))).variance() > 0
        assert page.evaluate("window.__gl.count") == 1, "restoring created a new context"
        assert live(page, "Pledge updates") == ""


def test_wf_cross_cutting_manifest_and_health(tmp_path):
    db = tmp_path / "nested" / "folder" / f"{uuid.uuid4().hex[:10]}.db"
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1" and all(isinstance(manifest[k], str) for k in ("install", "build", "serve"))
    db.parent.parent.mkdir(parents=True)
    dead = "127.0.0.1"
    with app_copy(db, KILLBILL_URL=f"http://{dead}:9", SMTP_HOST=dead, SMTP_PORT="9", S3_ENDPOINT=f"http://{dead}:9") as base:
        health = want(httpx.get(f"{base}/api/health"), 200)
        assert health.json() == {"status": "ok"} and health.headers["content-type"].startswith("application/json")
        assert db.exists(), "the database lives at TALLY_DB_PATH"
        member = household(base, "HH-1001")
        assert member.credit()["balance_cents"] == CARRIED_1001
        line = member.line("cy-44", "P-MAPLE")
        assert line["status"] == "sealed" and line["version"] == 2
    with app_copy(db) as again:
        assert household(again, "HH-1001").credit()["balance_cents"] == CARRIED_1001, "a restart must not reseed"


def test_server_boundary(browser, app_url, tmp_path):
    host = urlsplit(app_url).netloc
    pad = b'{"code":"' + b"x" * (MAX_JSON - 11) + b'"}'
    assert len(pad) == MAX_JSON
    json_type = {"Content-Type": "application/json"}
    want(httpx.post(f"{app_url}/api/session", content=pad, headers=json_type), 401, "invalid_code")
    want(httpx.post(f"{app_url}/api/session", content=pad[:-2] + b'x"}', headers=json_type), 413, "too_large")
    want(httpx.post(f"{app_url}/api/session", content=b"code=x", headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    evil = httpx.post(f"{app_url}/api/session", json={"code": "HOME-1001"}, headers={"Origin": "http://evil.example"})
    want(evil, 403, "forbidden")
    opaque = httpx.post(f"{app_url}/api/session", json={"code": "HOME-1001"}, headers={"Origin": "null"})
    want(opaque, 403, "forbidden")
    ok = want(httpx.post(f"{app_url}/api/session", json={"code": "HOME-1001"}, headers={"Origin": f"http://{host}"}), 200)
    assert not [h for h in ok.headers if h.lower().startswith("access-control-")]
    want(httpx.get(f"{app_url}/api/nope", cookies=ok.cookies), 404, "not_found")
    want(httpx.post(f"{app_url}/api/cycles", content=b"x" * (MAX_JSON + 1), headers=json_type), 413, "too_large")
    index = httpx.get(f"{app_url}/")
    assert "no-store" in index.headers.get("cache-control", ""), "app pages must not be stored"
    for path, secret in (("/run.json", b"run-manifest-v1"), ("/package.json", b'"dependencies"'), ("/.env", b"KILLBILL"), ("/data/tally.db", b"SQLite format"), ("/node_modules/three/package.json", b'"three"'), ("/tsconfig.json", b"compilerOptions"), ("/src/server.ts", b"import ")):
        assert secret not in httpx.get(app_url + path).content, f"{path} served private content"
    assets = [index.content]
    with signed_in(browser, app_url, "HOME-1001") as page:
        urls = page.evaluate("[...document.scripts].map(s => s.src).filter(Boolean)")
        assets += [httpx.get(u).content for u in urls]
    for name in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID"):
        value = os.environ.get(name, "")
        if value:
            assert all(value.encode() not in a for a in assets), f"{name} reached the browser"
    db = new_db(tmp_path)
    with app_copy(db) as one, app_copy(db) as two:
        cid = open_cycle(coordinator(one), ("P-RICE",))["id"]
        members = [household(one if i % 2 else two, code) for i, code in enumerate(("HH-1001", "HH-1002", "HH-1003", "HH-1004"))]
        calls = []
        for member in members:
            for units in (1, 2, 1):
                calls.append(lambda m=member, u=units: pledge(m, cid, "P-RICE", u))
        assert {a.status_code for a in race(*calls)} == {200}, "concurrent writers must wait, not fail"
        member = members[0]
        key = idempotency_key()
        lock = sqlite3.connect(db, timeout=HTTP_TIMEOUT_S, isolation_level=None)
        lock.execute("BEGIN IMMEDIATE")
        try:
            began = time.monotonic()
            blocked = pledge(member, cid, "P-RICE", 3, key)
            want(blocked, 503, "database_busy")
            assert time.monotonic() - began >= BUSY_WAIT_S - 0.5, "the request must wait up to 5 seconds"
        finally:
            lock.execute("ROLLBACK")
            lock.close()
        assert want(pledge(member, cid, "P-RICE", 3, key), 200).headers.get("Idempotent-Replay") != "true", "a 503 is not stored"


def test_wf_cross_cutting_responsive_layout(browser, app_url):
    pids = ("P-TAHINI", "P-OLIVE", "P-OATS", "P-LENTIL", "P-MAPLE")
    _, cid, _, _ = setup_cycle(app_url, pids, [("HH-1002", "P-MAPLE", 6)], funded=True)
    with open_app(browser, app_url + "/") as page:
        for view, wide in ((PHONE, 0.9), (DESKTOP, 0.25)):
            page.set_viewport_size(view)
            frames(page)
            layout(page)
            panel = role(page, "textbox", "Access code").bounding_box()
            assert panel["width"] >= view["width"] * wide * 0.5
    screens = {"HOME-1001": ["/", f"/cycles/{cid}", "/credit"], COORD_CODE: ["/coordinator", "/coordinator/cycles/new", f"/coordinator/cycles/{cid}"], VOL_CODE: ["/breakdown"]}
    for code, paths in screens.items():
        with signed_in(browser, app_url, code) as page:
            for path in paths:
                page.goto(app_url + path)
                pump(page, lambda: role(page, "button", "Sign out").count() == 1, f"{path} shows the top bar")
                for view in (PHONE, TABLET, DESKTOP):
                    page.set_viewport_size(view)
                    frames(page, 3)
                    layout(page)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, CASE["P-TAHINI"])
        open_cases = [CASE[p] for p in pids[:4]]
        for view, across in ((DESKTOP, 3), (TABLET, 2), (SIDEWAYS, 2), (PHONE, 1)):
            page.set_viewport_size(view)
            frames(page, 3)
            lefts = [round(block(page, c).bounding_box()["x"]) for c in open_cases]
            assert len(set(lefts[:across])) == across and lefts[across] == lefts[0], f"{view}: {lefts}"
            rail, tabs = role(page, "complementary", "Sealed cases").count(), role(page, "tablist", "Cases").count()
            assert (rail, tabs) == ((1, 0) if view["width"] >= TABLET["width"] else (0, 1))
        page.set_viewport_size(DESKTOP)
        frames(page, 3)
        for case, cols, rows in ((CASE["P-TAHINI"], 4, 3), (CASE["P-OLIVE"], 3, 2), (CASE["P-OATS"], 5, 5)):
            spots = block(page, case).locator("[data-cell]").evaluate_all("els => els.map(e => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; })")
            assert len({s[0] for s in spots}) == cols and len({s[1] for s in spots}) == rows, f"{case}: {spots}"
            assert spots == sorted(spots, key=lambda s: (s[1], s[0])), "cells appear in reading order"
        page.set_viewport_size(SIDEWAYS)
        frames(page, 3)
        click(role(page, "button", "Top up"))
        dialog = role(page, "dialog", "Top up credit")
        pump(page, lambda: dialog.count() == 1, "the dialog opens sideways")
        frames(page, 25)
        inside_viewport(page, dialog)
        for name in ("Confirm top-up", "Cancel"):
            big_enough(role(dialog, "button", name))
            inside_viewport(page, role(dialog, "button", name))
            assert hit(role(dialog, "button", name))


def sequence(page: Page, case: str, total_ms: int) -> tuple[list[tuple[int, list[str], int | None]], list[float]]:
    samples, delays, elapsed = [], [], 0
    while elapsed <= total_ms:
        samples.append((elapsed, cells(page, case), to_go(page, case)))
        if not delays and len(samples) > 0:
            delays = block(page, case).locator("[data-cell]").evaluate_all("els => els.map(e => Math.max(0, ...e.getAnimations({subtree: true}).map(a => Number(a.effect.getTiming().delay) || 0)))")
            delays = delays if any(delays) else []
        advance(page, SEQUENCE_STEP_MS)
        elapsed += SEQUENCE_STEP_MS
    return samples, delays


def starts_of(samples, before: list[str], indexes: list[int], delays: list[float]) -> list[float]:
    firsts = []
    for i in indexes:
        firsts.append(next((t for t, c, _ in samples if c[i] != before[i]), None))
    assert None not in firsts, "every changed cell reached its new value"
    if len(set(firsts)) == 1 and delays:
        return [delays[i] for i in indexes]
    return firsts


def test_fill_the_case_sequence(browser, app_url):
    t, r = CASE["P-TAHINI"], CASE["P-RICE"]
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI", "P-RICE"))
    me = household(app_url, "HH-1001")
    fund(me, 25000)
    with signed_in(browser, app_url, "HOME-1001", f"/cycles/{cid}") as page:
        on_cycle(page, t)
        frames(page, 5)
        before = cells(page, t)
        step_to(page, t, 5)
        await_answer(page, "PUT", "/lines/P-TAHINI/pledge", lambda: page.keyboard.press("Enter"))
        samples, delays = sequence(page, t, SEQUENCE_MAX_MS)
        starts = starts_of(samples, before, list(range(5)), delays)
        assert starts == sorted(starts), f"cells must change in reading order: {starts}"
        gap = (starts[-1] - starts[0]) / 4
        assert CELL_GAP_MS / 2 <= gap <= CELL_GAP_MS * 2, f"mean gap between cell starts is {gap} ms"
        numerals = [(at, n) for at, _, n in samples]
        changes = [at for (at, n), (_, m) in zip(numerals[1:], numerals) if n != m]
        values = [n for i, (_, n) in enumerate(numerals) if i == 0 or n != numerals[i - 1][1]]
        assert values[0] == 12 and values[-1] == 7 and all(a - b == 1 for a, b in zip(values, values[1:])), f"the numeral counts by ones: {values}"
        assert changes[0] >= starts[-1], "the numeral starts after the cells"
        assert NUMERAL_MS / 2 <= changes[-1] - changes[0] + SEQUENCE_STEP_MS <= NUMERAL_MS * 2, f"the count took {changes[-1] - changes[0]} ms"
        assert changes[-1] <= SEQUENCE_MAX_MS
        final = me.line(cid, "P-TAHINI")["cells"]
        assert samples[-1][1] == final
        click(role(page, "button", f"Withdraw from {t}"))
        dialog = role(page, "dialog", "Withdraw pledge")
        pump(page, lambda: dialog.count() == 1, "the dialog opens")
        await_answer(page, "DELETE", "/lines/P-TAHINI/pledge", lambda: click(role(dialog, "button", "Withdraw")))
        back, back_delays = sequence(page, t, SEQUENCE_MAX_MS)
        rising = starts_of(back, final, list(range(5)), back_delays)
        assert rising == sorted(rising, reverse=True), f"a withdrawal changes cells from the last backwards: {rising}"
        assert back[-1][1] == ["empty"] * 12 and back[-1][2] == 12
        whole = cells(page, r)
        step_to(page, r, 50)
        await_answer(page, "PUT", "/lines/P-RICE/pledge", lambda: page.keyboard.press("Enter"))
        big, big_delays = sequence(page, r, SEQUENCE_MAX_MS)
        rice_starts = starts_of(big, whole, list(range(50)), big_delays)
        assert rice_starts[-1] - rice_starts[0] <= CELL_SPREAD_MS * 1.25, f"starts spread over {rice_starts[-1] - rice_starts[0]} ms"
        assert big[-1][1] == ["mine"] * 50 and big[-1][2] == 0, "all 50 cells and the numeral end within 2 seconds"
        assert "Sealed" in squeeze(block(page, r).inner_text()) and role(page, "complementary", "Sealed cases").get_by_role("article", name=r, exact=True).count() == 1
        assert accessible_name(page) == f"Units of {r}"


ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1"}
APP = Path("/app")


def test_if_run_manifest():
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest.get(k), str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices():
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"not in THIRD_PARTY_NOTICES.md: {missing}"
    assert "Archivo" in notices and "IBM Plex Sans" in notices


def test_if_licences_allowed():
    bad = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"
    assert "OFL" in (APP / "THIRD_PARTY_NOTICES.md").read_text()


def test_if_no_extra_datastore():
    drivers = {"pg", "mysql", "mysql2", "mongodb", "mongoose", "redis", "ioredis", "memcached", "cassandra-driver", "valkey"}
    assert not [p.name for p in shipped_packages() if p.name in drivers]


def test_if_seeded_credentials_unchanged(killbill):
    assert killbill.account_by_key(f"probe-{uuid.uuid4().hex}") is None
    assert isinstance(S3().keys("cycles/"), list)


def test_if_strict_typescript():
    root = APP / "tsconfig.json"
    configs = [root] if root.exists() else sorted(c for c in APP.rglob("tsconfig.json")
                                                  if not {"node_modules", "dist", "build"} & set(c.parts))
    assert configs, "no tsconfig.json"
    for config in configs:
        if compiler_option(config, "strict") is not True:
            refs = [config.parent / r["path"] for r in jsonc(config.read_text()).get("references", [])]
            refs = [r / "tsconfig.json" if r.is_dir() else r for r in refs]
            assert refs and all(compiler_option(r, "strict") is True for r in refs), (config, refs)
    sources = [p for p in APP.rglob("*.ts") if "node_modules" not in p.parts and not p.name.endswith(".d.ts")]
    assert sources, "no TypeScript source under /app"


def test_if_no_foreign_network(browser, app_url):
    _, cid, _, _ = setup_cycle(app_url, ("P-TAHINI",))
    with open_app(browser, app_url + f"/cycles/{cid}") as page:
        seen = []
        page.on("request", lambda r: seen.append(r.url))
        page.reload()
        sign_in(page, "HOME-1001")
        on_cycle(page, CASE["P-TAHINI"])
        frames(page, 10)
    foreign = [u for u in seen if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, f"foreign requests: {foreign}"


def test_if_three_is_shipped():
    package = json.loads((APP / "package.json").read_text())
    assert "three" in package.get("dependencies", {})
    assert "three" in [p.name for p in shipped_packages()]
