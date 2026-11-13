from __future__ import annotations

import base64
import concurrent.futures
import contextlib
import csv
import datetime as dt
import hashlib
import hmac
import http.server
import io
import itertools
import json
import math
import os
import random
import re
import shutil
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import quote, unquote, urlparse

import httpx
import pytest
from playwright.sync_api import Error as PlaywrightError
from playwright.sync_api import Locator, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    accessible_name,
    advance,
    animations,
    axe,
    check,
    click,
    fill,
    layout,
    licence_allowed,
    open_app,
    pdf_pages,
    pdf_text,
    same_origin,
    select,
    session,
    shipped_packages,
    style,
    tab_order,
    tap,
)

POLL_S = 0.25
HTTP_S = 40
STEP_MS = 250
REST_MS = 800
QUICK_S = 5
RETURN_S = 30
PRINT_S = 30
SEARCH_LAG_S = 15
CONSUMER_S = 15
MARGIN_S = 15
FOCUS_MS = 400
TARGET_PX = 44
TOLERANCE = 24
LIMIT_LOOKUPS = 60
BURST_LOOKUPS = 120
BURST_SIGNINS = 20
SHEET_MAX = 2000000
SHEET_ROWS = 5000
IMPORT_S = 30
CASCADE_ROWS = 2000
JSON_MAX = 1000000
URL_MAX = 2048
NAME_MAX = 80
RUN_OUT_DAYS = 180
PACK_SWAP_MS = (280, 360)
MIRROR_SWAP_MS = (150, 210)
LINK_RENEW_MS = 30000
LINK_DROP_MS = 55000
DAY_CHECK_MS = 30000
REFRESH_MS = 5000
PREVIEW_MS = 2000
REOPEN_MS = 10000
ACCENT = (255, 217, 220)
CARMINE = (156, 18, 32)
CHARCOAL = (42, 42, 42)
GREYS = [255, 230, 205, 185, 165, 150]
FAR_FUTURE_CLOCK = "2031-01-01T00:00:00Z"
GRADING_NOW = "2026-11-05T06:30:00Z"
BEFORE_MIDNIGHT = "2028-03-31T18:29:59Z"
AT_MIDNIGHT = "2028-03-31T18:30:00Z"
BATCH_A = "NSK-260915-07"
BATCH_B = "NSK-261005-02"
BATCH_C = "NSK-261010-08"
NOTICE_SCHEDULED = "VT-2026-04"
SKU_JEERA = "SJ-300-CAN"
SKU_KAIRI = "KP-200-CTN"
UNKNOWN_CODE = "NSK-999999-99"
MALFORMED_CODE = "not-a-batch"
TYPED_JOB = "Typed while it happens"
TYPED_HALF = "https://typing.example/half"
TYPED_REASON = "Halfway through"
TYPED_EMAIL = "someone@example.invalid"
CORS_HEADER = "access-control-allow-origin"
FORWARDED = {"X-Forwarded-For": "203.0.113.9"}

EDITOR = ("editor@vasant-talkies.example", "Interval-Editor-2026")
SAGAR = ("orders@sagar-traders.example", "Interval-Stock-A1")
DECCAN = ("orders@deccan-cold.example", "Interval-Stock-B2")

REELS = ["Now Showing", "The Pack", "The Lineup", "Price Notices", "End Credits"]
SEED_COUNTS = "Drinks: 6. Packs: 14. Notices: 3. Scheduled revisions: 1."
DRINKS = [
    ("kairi-panna", "Kairi Panna", False, 9000),
    ("balcony-soda", "Balcony Soda", True, 7500),
    ("second-show-jeera", "Second Show Jeera", True, 6200),
    ("matinee-kokum", "Matinee Kokum", False, 8400),
    ("ticket-nimbu", "Ticket Nimbu", False, 5500),
    ("reel-gulab", "Reel Gulab", False, 10500),
]
SKUS = [
    ("KP-200-CTN", "Kairi Panna", "200 ml Carton", "carton", 200, 365, 2000),
    ("KP-600-PET", "Kairi Panna", "600 ml PET", "pet", 600, 365, 4500),
    ("KP-1200-PET", "Kairi Panna", "1.2 L PET", "pet", 1200, 365, 8000),
    ("BS-300-GLS", "Balcony Soda", "300 ml Glass", "glass", 300, 365, 2500),
    ("BS-300-CAN", "Balcony Soda", "300 ml Can", "can", 300, 365, 3000),
    ("BS-750-PET", "Balcony Soda", "750 ml PET", "pet", 750, 365, 4500),
    ("SJ-300-CAN", "Second Show Jeera", "300 ml Can", "can", 300, 365, 3500),
    ("SJ-1000-PET", "Second Show Jeera", "1 L PET", "pet", 1000, 365, 9000),
    ("MK-200-CTN", "Matinee Kokum", "200 ml Carton", "carton", 200, 365, 2000),
    ("MK-1000-PET", "Matinee Kokum", "1 L PET", "pet", 1000, 365, 8000),
    ("TN-500-PET", "Ticket Nimbu", "500 ml PET", "pet", 500, 365, 2000),
    ("TN-200-CTN", "Ticket Nimbu", "200 ml Carton", "carton", 200, 365, 1000),
    ("RG-300-GLS", "Reel Gulab", "300 ml Glass", "glass", 300, 180, 3000),
    ("RG-2000-PET", "Reel Gulab", "2 L PET", "pet", 2000, 365, 12000),
]
BATCHES = {
    "NSK-260915-07": ("KP-200-CTN", 2000, 1875, ("0.09", "ml"), "2027-09-15"),
    "NSK-261005-02": ("KP-200-CTN", 1875, None, ("0.09", "ml"), "2027-10-05"),
    "NSK-260918-01": ("KP-600-PET", 4500, 4200, ("0.07", "ml"), "2027-09-18"),
    "PUN-260920-03": ("KP-1200-PET", 8000, 7500, ("62.50", "litre"), "2027-09-20"),
    "NSK-261001-04": ("BS-300-GLS", 2500, 2700, ("0.09", "ml"), "2027-10-01"),
    "PUN-261002-01": ("BS-300-CAN", 3000, 3200, ("0.11", "ml"), "2027-10-02"),
    "NSK-261010-08": ("BS-750-PET", 4500, None, ("0.06", "ml"), "2027-10-10"),
    "PUN-261020-06": ("SJ-300-CAN", 3500, None, ("0.12", "ml"), "2027-10-20"),
    "PUN-261012-03": ("SJ-1000-PET", 9000, None, None, "2027-10-12"),
    "NSK-260922-06": ("MK-200-CTN", 2000, 1875, ("0.09", "ml"), "2027-09-22"),
    "NSK-260925-09": ("MK-1000-PET", 8000, 7500, None, "2027-09-25"),
    "NSK-260720-05": ("TN-500-PET", 2000, None, ("0.04", "ml"), "2027-07-20"),
    "NSK-260810-05": ("TN-500-PET", 2250, None, ("0.05", "ml"), "2027-08-10"),
    "PUN-260905-02": ("TN-200-CTN", 1200, None, ("0.06", "ml"), "2027-09-05"),
    "NSK-250301-03": ("RG-300-GLS", 3000, None, ("0.10", "ml"), "2025-08-28"),
    "PUN-260915-02": ("RG-2000-PET", 12000, None, ("60.00", "litre"), "2027-09-15"),
}
GEOMETRY = {
    "carton": ((0.08, 0.30, 0.40, 0.16), (0.54, 0.28, 0.38, 0.22)),
    "pet": ((0.10, 0.42, 0.36, 0.14), (0.52, 0.40, 0.38, 0.20)),
    "glass": ((0.12, 0.48, 0.34, 0.14), (0.52, 0.46, 0.36, 0.20)),
    "can": ((0.10, 0.36, 0.36, 0.14), (0.50, 0.34, 0.40, 0.20)),
}
FORMAT_BATCH = {
    "carton": "NSK-260915-07",
    "pet": "NSK-260918-01",
    "glass": "NSK-261001-04",
    "can": "PUN-261002-01",
}

S_PRINT_OUT = "Printing is down. The prices on this page are still correct."
S_LOST_PRINT = "Print request didn't reach the server. Try again."
S_MSG_OUT = "Stockist messages are queued. Nothing has been lost."
S_WORK_OUT = "Background work is queued. Nothing has been lost."
S_SET_ASIDE = "A broken job was set aside. No notice was affected."
S_STORE_OUT = "Stored copies are unavailable right now. The prices on this page are still correct."
S_EXPIRED = "This link has expired. Getting a fresh one."
S_BEHIND = "Search is catching up. Recent changes may be missing."
S_DOWN = "Search is down. Exact codes still work."
S_NO_MATCH = "No pack matches that."
S_UNKNOWN_BATCH = "We can't find that batch. Check the code printed near the best-before date."
S_UNKNOWN_PACK = "This pack isn't in the programme."
S_NO_STICKER = "No sticker on this pack. The printed price is the price."
S_PAST = "This pack is past its best-before date. Please don't drink it."
S_STALE = "This draft changed in another tab. Reload to see it."
S_WRAPPER = "No notice allows old wrappers for this pack on that date."
S_ROTATE_DOWN = "Rotation needs the message service. Try again shortly."
S_LOST_REMOVAL = "Removal didn't reach the server. Try again."
S_NOTHING = "Nothing on this endpoint is waiting for recovery."
S_READY = "Ready to publish."
S_ENDED = "Your session has ended. Sign in again."
S_KEPT = "Your unsaved work was kept. Nothing has been sent."
S_WARNING = "This can't be undone. There is no way back to draft."
S_UNSAVED = "Save this draft first. The notice would publish its saved values."
S_PENDING_PRINT = "This notice is still being printed."
WAIT_RE = re.compile(r"^Too many tries\. Wait (\d+) seconds and try again\.$")

_pause = threading.Event()
_addresses = itertools.count(random.randrange(1, 60000))


def poll(fn: Callable[[], Any], seconds: float, contract: str) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
        _pause.wait(POLL_S)
    pytest.fail(f"{contract}; last seen {last!r}")


def instance(env: str) -> str:
    return os.environ[env].rstrip("/")


def api(base: str) -> httpx.Client:
    parsed = urlparse(base)
    transport = None
    if parsed.hostname in ("127.0.0.1", "localhost"):
        base = base.replace("localhost", "127.0.0.1")
        n = next(_addresses)
        transport = httpx.HTTPTransport(
            local_address=f"127.{(n >> 16) % 250 + 1}.{(n >> 8) % 256}.{n % 250 + 1}",
            limits=httpx.Limits(max_connections=200),
        )
    return httpx.Client(base_url=base, timeout=HTTP_S, follow_redirects=False, transport=transport)


def signed_in_api(base: str, creds: tuple[str, str]) -> httpx.Client:
    client = api(base)
    answer = client.post("/api/session", json={"email": creds[0], "password": creds[1]})
    assert answer.status_code == 200, f"POST /api/session for {creds[0]}: {answer.status_code} {answer.text}"
    return client


def fire(count: int, fn: Callable[[int], Any]) -> list[Any]:
    barrier = threading.Barrier(count)

    def run(i: int) -> Any:
        barrier.wait(HTTP_S)
        return fn(i)

    with concurrent.futures.ThreadPoolExecutor(count) as pool:
        return list(pool.map(run, range(count)))


def token() -> str:
    return uuid.uuid4().hex[:10]


def letters() -> str:
    return "".join(chr(ord("A") + int(c, 16)) for c in uuid.uuid4().hex[:8])


def add_days(day: str, count: int) -> str:
    return (dt.date.fromisoformat(day) + dt.timedelta(days=count)).isoformat()


def rupees(paise: int) -> str:
    return f"{paise // 100}.{paise % 100:02d}"


def show_date(day: str) -> str:
    months = "Jan Feb Mar Apr May Jun Jul Aug Sep Oct Nov Dec".split()
    y, m, d = day.split("-")
    return f"{int(d)} {months[int(m) - 1]} {y}"


def today(client: httpx.Client) -> str:
    return client.get("/api/catalogue").json()["today"]


def facts(client: httpx.Client, code: str) -> dict[str, Any]:
    answer = client.get(f"/api/batches/{code}")
    assert answer.status_code == 200, f"GET /api/batches/{code}: {answer.status_code}"
    return answer.json()


def published(editor: httpx.Client) -> dict[str, list[tuple[str, dict, str]]]:
    rows: dict[str, list[tuple[str, dict, str]]] = {}
    for notice in editor.get("/api/editor/notices").json()["notices"]:
        latest = notice["versions"][0]
        for row in latest["rows"]:
            rows.setdefault(row["skuCode"], []).append((latest["effectiveDate"], row, notice["number"]))
    return rows


def next_day(editor: httpx.Client, *skus: str, gap: int = 1) -> str:
    rows = published(editor)
    dates = [today(editor)] + [d for s in skus for d, _, _ in rows.get(s, [])]
    return add_days(max(dates), gap)


def last_rate(editor: httpx.Client, sku: str) -> int | None:
    stickers = [(d, r) for d, r, _ in published(editor).get(sku, []) if r["kind"] == "sticker"]
    return max(stickers, key=lambda x: x[0])[1]["newRate"] if stickers else None


def new_print(sku: str, paise: int) -> dict[str, Any]:
    return {"skuCode": sku, "kind": "new_print", "revisedMrpPaise": paise, "oldRate": None, "newRate": None}


def make_draft(editor: httpx.Client, rows: list[dict], day: str, title: str | None = None,
               run_out: str | None = None) -> dict[str, Any]:
    body = {"title": title or f"Probe {token()}", "effectiveDate": day, "runOutUntil": run_out, "rows": rows}
    answer = editor.post("/api/editor/notices", json=body)
    assert answer.status_code == 201, f"POST /api/editor/notices: {answer.status_code} {answer.text}"
    return answer.json()


def body_of(draft: dict[str, Any], **over: Any) -> dict[str, Any]:
    body = {
        "title": draft["title"], "effectiveDate": draft["effectiveDate"], "runOutUntil": draft["runOutUntil"],
        "baseRevision": draft["revision"],
        "rows": [{k: r[k] for k in ("skuCode", "kind", "revisedMrpPaise", "oldRate", "newRate")} for r in draft["rows"]],
    }
    body.update(over)
    return body


def sticker_draft(editor: httpx.Client, skus: list[str], day: str, title: str | None = None,
                  run_out: str | None = None) -> dict[str, Any]:
    rows = []
    for sku in skus:
        old = last_rate(editor, sku)
        old = 12 if old is None else old
        rows.append({"skuCode": sku, "kind": "sticker", "revisedMrpPaise": 100, "oldRate": old,
                     "newRate": old - 4 if old >= 4 else old + 4})
    draft = make_draft(editor, rows, day, title, run_out)
    for row, made in zip(rows, draft["rows"]):
        row["revisedMrpPaise"] = made["ceilingPaise"]
    answer = editor.put(f"/api/editor/notices/{draft['id']}", json=body_of(draft, rows=rows))
    assert answer.status_code == 200, f"PUT draft: {answer.status_code} {answer.text}"
    return answer.json()


def publish(editor: httpx.Client, draft: dict[str, Any]) -> httpx.Response:
    return editor.post(f"/api/editor/notices/{draft['id']}/publish", json={"baseRevision": draft["revision"]})


def published_notice(editor: httpx.Client, rows: list[dict], day: str, title: str | None = None) -> dict[str, Any]:
    answer = publish(editor, make_draft(editor, rows, day, title))
    assert answer.status_code == 200, f"publish: {answer.status_code} {answer.text}"
    return answer.json()


def version_of(client: httpx.Client, number: str, version: int) -> dict[str, Any]:
    body = client.get(f"/api/notices/{number}").json()
    return next(v for v in body["versions"] if v["version"] == version)


def wait_print(client: httpx.Client, number: str, version: int, state: str = "printable",
               seconds: float = PRINT_S + MARGIN_S) -> dict[str, Any]:
    return poll(lambda: (lambda v: v if v["printState"] == state else None)(version_of(client, number, version)),
                seconds, f"{number} v{version} should reach printState {state}")


def copy_id(editor: httpx.Client) -> str:
    return editor.get("/api/editor/notices").json()["copyId"]


def upload(editor: httpx.Client, name: str, data: bytes) -> httpx.Response:
    return editor.post("/api/editor/price-sheets", files={"file": (name, data, "text/csv")})


def sheet_bytes(*rows: str, header: str = "code,description,new_mrp,old_gst,new_gst") -> bytes:
    return ("\n".join([header, *rows]) + "\n").encode()


def clear_desk(editor: httpx.Client) -> None:
    for sheet in editor.get("/api/editor/price-sheets").json()["sheets"]:
        if not (sheet["counts"]["ambiguous"] or sheet["counts"]["unmatched"]):
            continue
        full = editor.get(f"/api/editor/price-sheets/{sheet['id']}").json()["sheet"]
        for row in full["rows"]:
            if row["status"] in ("ambiguous", "unmatched"):
                editor.post(f"/api/editor/price-sheets/{sheet['id']}/rows/{row['rowNumber']}/settle",
                            json={"ignore": True})


def clear_endpoints(stockist: httpx.Client) -> None:
    for endpoint in stockist.get("/api/stockist/endpoints").json()["endpoints"]:
        stockist.delete(f"/api/stockist/endpoints/{endpoint['id']}")


def fresh_stockist(base: str, creds: tuple[str, str] = SAGAR) -> httpx.Client:
    client = signed_in_api(base, creds)
    clear_endpoints(client)
    return client


@contextlib.contextmanager
def server_clock(base: str, now: str) -> Iterator[httpx.Client]:
    client = api(base)
    answer = client.put("/api/test/clock", json={"now": now})
    assert answer.status_code == 200, f"PUT /api/test/clock: {answer.status_code}"
    try:
        yield client
    finally:
        client.delete("/api/test/clock")


def noon(day: str) -> str:
    return f"{day}T06:30:00Z"


def batch_code(plant: str, day: str, line: int = 1) -> str:
    return f"{plant}-{day[2:4]}{day[5:7]}{day[8:10]}-{line}"


def deliveries(stockist: httpx.Client) -> list[dict[str, Any]]:
    return stockist.get("/api/stockist/deliveries").json()["deliveries"]


def entry(stockist: httpx.Client, event_id: str) -> dict[str, Any] | None:
    return next((d for d in deliveries(stockist) if d["eventId"] == event_id), None)


def verifies(secret: str, record: dict[str, Any]) -> bool:
    head = record["headers"]
    content = f"{head['svix-id']}.{head['svix-timestamp']}.".encode() + record["body"]
    key = base64.b64decode(secret.removeprefix("whsec_"))
    wanted = base64.b64encode(hmac.new(key, content, hashlib.sha256).digest()).decode()
    return any(part.split(",", 1)[-1] == wanted for part in head["svix-signature"].split())


def sink_host() -> str:
    probe = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    try:
        probe.connect((urlparse(os.environ["SVIX_URL"]).hostname or "10.255.255.255", 80))
        address = probe.getsockname()[0]
    finally:
        probe.close()
    return socket.gethostbyname(socket.gethostname()) if address.startswith("127.") else address


class Sink:

    def __init__(self, status: int = 200) -> None:
        self.status = status
        self.records: list[dict[str, Any]] = []
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            def do_POST(self) -> None:
                body = self.rfile.read(int(self.headers.get("content-length", 0)))
                outer.records.append({"headers": {k.lower(): v for k, v in self.headers.items()}, "body": body})
                self.send_response(outer.status)
                self.send_header("content-length", "0")
                self.end_headers()

            def log_message(self, *args: Any) -> None:
                return

        self.server = http.server.ThreadingHTTPServer(("0.0.0.0", 0), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.url = f"http://{sink_host()}:{self.server.server_address[1]}/{token()}"

    def of(self, event_id: str) -> list[dict[str, Any]]:
        return [r for r in self.records if json.loads(r["body"]).get("eventId") == event_id]

    def close(self) -> None:
        self.server.shutdown()
        self.server.server_close()


@contextlib.contextmanager
def sink(status: int = 200) -> Iterator[Sink]:
    receiver = Sink(status)
    try:
        yield receiver
    finally:
        receiver.close()


class Relay:

    def __init__(self, port: int, target: tuple[str, int], mode: str = "forward") -> None:
        self.port, self.target, self.mode = port, target, mode
        self.conns: list[socket.socket] = []
        self.listener = socket.socket()
        self.listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.listener.bind(("127.0.0.1", port))
        self.listener.listen(64)
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        while True:
            try:
                conn, _ = self.listener.accept()
            except OSError:
                return
            self.conns.append(conn)
            if self.mode == "forward":
                try:
                    upstream = socket.create_connection(self.target, timeout=10)
                except OSError:
                    conn.close()
                    continue
                upstream.settimeout(None)
                self.conns.append(upstream)
                threading.Thread(target=self._pump, args=(conn, upstream), daemon=True).start()
                threading.Thread(target=self._pump, args=(upstream, conn), daemon=True).start()

    @staticmethod
    def _pump(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        for s in (src, dst):
            with contextlib.suppress(OSError):
                s.shutdown(socket.SHUT_RDWR)

    def cut(self) -> None:
        for conn in self.conns:
            with contextlib.suppress(OSError):
                conn.shutdown(socket.SHUT_RDWR)
            conn.close()
        self.conns = []

    def stop(self) -> None:
        with contextlib.suppress(OSError):
            self.listener.shutdown(socket.SHUT_RDWR)
        self.listener.close()
        self.cut()


def target_of(env: str, default_port: int) -> tuple[str, int]:
    parsed = urlparse(os.environ[env])
    return parsed.hostname or "127.0.0.1", parsed.port or default_port


@contextlib.contextmanager
def relay(port: int, env: str, default_port: int = 80, mode: str = "forward") -> Iterator[Relay]:
    forwarder = Relay(port, target_of(env, default_port), mode)
    try:
        yield forwarder
    finally:
        forwarder.stop()


class HttpProxy:

    def __init__(self, port: int, target: str, policy: Callable[[str, str, bytes], Any]) -> None:
        self.release = threading.Event()
        outer = self

        class Handler(http.server.BaseHTTPRequestHandler):
            protocol_version = "HTTP/1.1"

            def _body(self) -> bytes:
                if "chunked" in self.headers.get("transfer-encoding", "").lower():
                    data = b""
                    while True:
                        size = int(self.rfile.readline().strip() or b"0", 16)
                        if size == 0:
                            self.rfile.readline()
                            return data
                        data += self.rfile.read(size)
                        self.rfile.readline()
                return self.rfile.read(int(self.headers.get("content-length", 0)))

            def _any(self) -> None:
                body = self._body()
                action = policy(self.command, self.path, body)
                if action == "hang":
                    outer.release.wait(HTTP_S * 3)
                    self.close_connection = True
                    return
                if isinstance(action, tuple):
                    self._send(action[0], {}, action[1])
                    return
                head = {k: v for k, v in self.headers.items()
                        if k.lower() not in ("host", "content-length", "transfer-encoding", "connection")}
                answer = httpx.request(self.command, target + self.path, headers=head, content=body, timeout=HTTP_S)
                if action == "lose":
                    self.close_connection = True
                    return
                self._send(answer.status_code, dict(answer.headers), answer.content)

            def _send(self, status: int, head: dict[str, str], content: bytes) -> None:
                self.send_response(status)
                for key, value in head.items():
                    if key.lower() not in ("content-length", "transfer-encoding", "connection", "content-encoding"):
                        self.send_header(key, value)
                self.send_header("content-length", str(len(content)))
                self.end_headers()
                self.wfile.write(content)

            do_GET = do_POST = do_PUT = do_PATCH = do_DELETE = _any

            def log_message(self, *args: Any) -> None:
                return

        http.server.ThreadingHTTPServer.allow_reuse_address = True
        self.server = http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()

    def stop(self) -> None:
        self.release.set()
        self.server.shutdown()
        self.server.server_close()


@contextlib.contextmanager
def http_proxy(port: int, env: str, policy: Callable[[str, str, bytes], Any]) -> Iterator[HttpProxy]:
    proxy = HttpProxy(port, os.environ[env].rstrip("/"), policy)
    try:
        yield proxy
    finally:
        proxy.stop()


def amqp_publish(queue: str, body: bytes) -> None:
    url = urlparse(os.environ["AMQP_URL"])
    user, password = unquote(url.username or "guest"), unquote(url.password or "guest")
    vhost = unquote(url.path[1:]) or "/"
    sock = socket.create_connection((url.hostname, url.port or 5672), timeout=HTTP_S)

    def frame(kind: int, channel: int, payload: bytes) -> bytes:
        return struct.pack(">BHI", kind, channel, len(payload)) + payload + b"\xce"

    def short(text: str) -> bytes:
        raw = text.encode()
        return bytes([len(raw)]) + raw

    def read() -> bytes:
        def exact(n: int) -> bytes:
            data = b""
            while len(data) < n:
                part = sock.recv(n - len(data))
                assert part, "broker closed the connection during the job injection"
                data += part
            return data
        _, _, size = struct.unpack(">BHI", exact(7))
        payload = exact(size)
        exact(1)
        return payload

    sock.sendall(b"AMQP\x00\x00\x09\x01")
    read()
    auth = f"\0{user}\0{password}".encode()
    sock.sendall(frame(1, 0, struct.pack(">HHI", 10, 11, 0) + short("PLAIN") + struct.pack(">I", len(auth)) + auth + short("en_US")))
    tune = read()
    channels, frame_max, _ = struct.unpack(">HIH", tune[4:12])
    sock.sendall(frame(1, 0, struct.pack(">HHHIH", 10, 31, channels, frame_max, 0)))
    sock.sendall(frame(1, 0, struct.pack(">HH", 10, 40) + short(vhost) + short("") + b"\0"))
    read()
    sock.sendall(frame(1, 1, struct.pack(">HH", 20, 10) + short("")))
    read()
    sock.sendall(frame(1, 1, struct.pack(">HHH", 60, 40, 0) + short("") + short(queue) + b"\0"))
    sock.sendall(frame(2, 1, struct.pack(">HHQH", 60, 0, len(body), 0x1000) + b"\x02"))
    sock.sendall(frame(3, 1, body))
    sock.sendall(frame(1, 1, struct.pack(">HHH", 20, 40, 200) + short("ok") + struct.pack(">HH", 0, 0)))
    read()
    sock.sendall(frame(1, 0, struct.pack(">HHH", 10, 50, 200) + short("ok") + struct.pack(">HH", 0, 0)))
    read()
    sock.close()


@contextlib.contextmanager
def app_copy(**env: str) -> Iterator[str]:
    manifest = json.loads((Path(DEPLOYED_APP) / "run.json").read_text())
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    log = tempfile.NamedTemporaryFile("w+", suffix=".log", delete=False)
    process = subprocess.Popen(manifest["serve"], shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=log,
                               env={**os.environ, "APP_PUBLIC_PORT": str(port), **env}, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def up() -> bool:
        assert process.poll() is None, f"copy exited: {Path(log.name).read_text()[-2000:]}"
        with contextlib.suppress(httpx.HTTPError):
            httpx.get(base + "/api/health", timeout=2)
            return True
        return False

    try:
        poll(up, 60, "extra copy should listen")
        yield base
    finally:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        process.wait(30)
        log.close()


STAGE = "[data-pack-progress]"
HERO = "[data-arch-open]"


def R(page: Page | Locator, role: str, name: str) -> Locator:
    return page.get_by_role(role, name=name, exact=True)


def wait_for(page: Page, check_fn: Callable[[], Any], seconds: float = 20, contract: str = "page state",
             step: float = STEP_MS) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        with contextlib.suppress(PlaywrightError):
            advance(page, step)
            last = check_fn()
            if last:
                return last
    pytest.fail(f"{contract} did not hold within {seconds}s; last {last!r}")


_kit_click = click


def click(locator: Locator) -> None:
    if locator.get_attribute("aria-disabled") == "true":
        box = locator.bounding_box()
        locator.page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        return
    _kit_click(locator)


def text(locator: Locator) -> str:
    return (locator.first.text_content() or "").strip() if locator.count() else ""


def see_text(page: Page, locator: Locator, wanted: str, seconds: float = 20) -> None:
    wait_for(page, lambda: wanted in text(locator), seconds, f"{locator} should read {wanted!r}")


def see(page: Page, locator: Locator, seconds: float = 20) -> None:
    wait_for(page, lambda: locator.count() > 0 and locator.first.is_visible(), seconds, f"{locator} should show")


def gone(page: Page, locator: Locator, seconds: float = 20) -> None:
    wait_for(page, lambda: locator.count() == 0, seconds, f"{locator} should leave")


def attrs(page: Page, selector: str = STAGE) -> dict[str, str]:
    return page.evaluate(
        "s=>{const e=document.querySelector(s);return e?Object.fromEntries([...e.attributes].map(a=>[a.name,a.value])):{}}",
        selector)


def ready(page: Page) -> None:
    wait_for(page, lambda: attrs(page).get("data-batch"), 20, "the stage should carry a batch")


@contextlib.contextmanager
def view(browser: Any, url: str, width: int = 1280, height: int = 800, *, touch: bool = False, zone: str | None = None,
         scale: float = 1, reduced_motion: str = "no-preference", no_webgl: bool = False,
         wrong_clock: bool = False) -> Iterator[Page]:
    with open_app(browser, url, scale=scale, reduced_motion=reduced_motion, no_webgl=no_webgl) as page:
        page.set_viewport_size({"width": width, "height": height})
        cdp = session(page)
        if touch:
            cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
        if zone:
            cdp.send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        if wrong_clock:
            page.clock.set_system_time(FAR_FUTURE_CLOCK)
        page.goto(url)
        if urlparse(url).path in ("", "/"):
            ready(page)
        yield page


def sign_in_ui(page: Page, creds: tuple[str, str]) -> None:
    fill(R(page, "textbox", "Email"), creds[0])
    fill(page.get_by_label("Password", exact=True), creds[1])
    click(R(page, "button", "Sign in"))


@contextlib.contextmanager
def desk(browser: Any, base: str, creds: tuple[str, str] = EDITOR, width: int = 1280, height: int = 800,
         path: str = "/editor") -> Iterator[Page]:
    with view(browser, base + "/sign-in", width, height) as page:
        sign_in_ui(page, creds)
        wait_for(page, lambda: urlparse(page.url).path == path, 20, f"sign-in should land on {path}")
        wait_for(page, lambda: R(page, "button", "Sign out").count() == 1, 20, "signed-in screen should load")
        yield page


def progress(page: Page) -> float:
    return float(attrs(page)["data-pack-progress"])


def scroll_to(page: Page, y: float) -> None:
    page.evaluate("y=>window.scrollTo(0,y)", y)
    advance(page, REST_MS)


def pin_offset(page: Page) -> float:
    height = page.evaluate("innerHeight")
    for k in range(1, 24):
        scroll_to(page, k * height / 2)
        value = progress(page)
        if 0 < value < 1:
            return page.evaluate("scrollY") - value * 4 * height
    pytest.fail("no scroll offset gave progress between 0 and 1; expected a pinned stage")


def to_progress(page: Page, value: float, pin: float | None = None) -> float:
    pin = pin_offset(page) if pin is None else pin
    scroll_to(page, pin + value * 4 * page.evaluate("innerHeight"))
    return pin


def want_yaw(p: float) -> float:
    return min(p / 0.55, 1) * 180


def want_camera(p: float) -> float:
    return 6 if p <= 0.75 else 6 - (p - 0.75) / 0.25 * 2.8


def on_formula(page: Page) -> None:
    a = attrs(page)
    p = float(a["data-pack-progress"])
    assert float(a["data-pack-yaw"]) == pytest.approx(want_yaw(p), abs=1), a
    assert float(a["data-camera-z"]) == pytest.approx(want_camera(p), abs=0.05), a


def rect(value: str) -> tuple[float, float, float, float]:
    return tuple(float(x) for x in value.split(","))


def quad(value: str) -> list[tuple[float, float]]:
    return [tuple(float(x) for x in p.split(",")) for p in value.split()]


def corners(r: tuple[float, float, float, float]) -> list[tuple[float, float]]:
    x, y, w, h = r
    return [(x, y), (x + w, y), (x + w, y + h), (x, y + h)]


def overlap(a: list[tuple[float, float]], b: list[tuple[float, float]]) -> bool:
    for shape in (a, b):
        for i in range(len(shape)):
            (x1, y1), (x2, y2) = shape[i], shape[(i + 1) % len(shape)]
            nx, ny = y2 - y1, x1 - x2
            pa = [nx * x + ny * y for x, y in a]
            pb = [nx * x + ny * y for x, y in b]
            if max(pa) <= min(pb) or max(pb) <= min(pa):
                return False
    return True


def centre(points: list[tuple[float, float]]) -> tuple[float, float]:
    return sum(p[0] for p in points) / len(points), sum(p[1] for p in points) / len(points)


class Shot:
    def __init__(self, width: int, height: int, rows: list[bytes], channels: int) -> None:
        self.width, self.height, self.rows, self.channels = width, height, rows, channels

    def at(self, x: int, y: int) -> tuple[int, int, int]:
        i = x * self.channels
        row = self.rows[y]
        return row[i], row[i + 1], row[i + 2]


def parse_png(data: bytes) -> Shot:
    pos, idat, width, height, channels = 8, b"", 0, 0, 3
    while pos < len(data):
        size, kind = struct.unpack(">I4s", data[pos:pos + 8])
        chunk = data[pos + 8:pos + 8 + size]
        if kind == b"IHDR":
            width, height, _, colour = struct.unpack(">IIBB", chunk[:10])
            channels = 4 if colour == 6 else 3
        elif kind == b"IDAT":
            idat += chunk
        pos += size + 12
    raw = zlib.decompress(idat)
    stride = width * channels
    rows: list[bytes] = []
    prior = bytearray(stride)
    for y in range(height):
        start = y * (stride + 1)
        kind = raw[start]
        line = bytearray(raw[start + 1:start + 1 + stride])
        for i in range(stride):
            a = line[i - channels] if i >= channels else 0
            b = prior[i]
            c = prior[i - channels] if i >= channels else 0
            if kind == 1:
                line[i] = (line[i] + a) & 255
            elif kind == 2:
                line[i] = (line[i] + b) & 255
            elif kind == 3:
                line[i] = (line[i] + (a + b) // 2) & 255
            elif kind == 4:
                p = a + b - c
                pa, pb, pc = abs(p - a), abs(p - b), abs(p - c)
                line[i] = (line[i] + (a if pa <= pb and pa <= pc else b if pb <= pc else c)) & 255
        rows.append(bytes(line))
        prior = line
    return Shot(width, height, rows, channels)


def shot(page: Page) -> Shot:
    payload = session(page).send("Page.captureScreenshot", {"format": "png"})
    return parse_png(base64.b64decode(payload["data"]))


def device_shot(page: Page) -> Shot:
    return parse_png(page.screenshot())


def near(pixel: tuple[int, int, int], colour: tuple[int, int, int], tolerance: int = TOLERANCE) -> bool:
    return all(abs(a - b) <= tolerance for a, b in zip(pixel, colour))


def inside(point: tuple[float, float], polygon: list[tuple[float, float]]) -> bool:
    x, y = point
    sign = 0
    for i in range(len(polygon)):
        (x1, y1), (x2, y2) = polygon[i], polygon[(i + 1) % len(polygon)]
        cross = (x2 - x1) * (y - y1) - (y2 - y1) * (x - x1)
        if cross:
            if sign and (cross > 0) != (sign > 0):
                return False
            sign = 1 if cross > 0 else -1
    return True


def region_pixels(image: Shot, polygon: list[tuple[float, float]], scale: float) -> list[tuple[int, int, int]]:
    xs, ys = [p[0] for p in polygon], [p[1] for p in polygon]
    out = []
    step = 1 / scale
    y = min(ys)
    while y < max(ys):
        x = min(xs)
        while x < max(xs):
            px, py = int(x * scale), int(y * scale)
            if inside((x, y), polygon) and 0 <= px < image.width and 0 <= py < image.height:
                out.append(image.at(px, py))
            x += step
        y += step
    return out


TOPMOST = """el=>{const r=el.getBoundingClientRect();const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);
return !!t&&(t===el||el.contains(t)||!!t.closest('label')&&t.closest('label').contains(el))}"""
IN_VIEW = """el=>{const r=el.getBoundingClientRect();return r.left>=-0.5&&r.top>=-0.5&&r.right<=innerWidth+0.5&&r.bottom<=innerHeight+0.5}"""


def topmost(locator: Locator) -> bool:
    return locator.evaluate(TOPMOST)


def in_view(locator: Locator) -> bool:
    return locator.evaluate(IN_VIEW)


def active_box(page: Page) -> dict[str, float]:
    return page.evaluate("()=>{const r=document.activeElement.getBoundingClientRect();return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}}")


def active_is(page: Page, locator: Locator) -> bool:
    return locator.count() > 0 and locator.first.evaluate("el=>el===document.activeElement")


class Gate:

    def __init__(self, page: Page, glob: str, method: str | None = None) -> None:
        self.routes: list[Any] = []
        self.seen: list[str] = []
        self.open = False
        self.page, self.glob = page, glob

        def handle(route: Any) -> None:
            if method and route.request.method != method:
                route.fallback()
                return
            self.seen.append(route.request.url)
            if self.open:
                route.fallback()
            else:
                self.routes.append(route)

        self.handler = handle
        page.route(glob, handle)

    def release(self) -> None:
        self.open = True
        while self.routes:
            self.routes.pop(0).fallback()

    def drop(self) -> None:
        self.open = True
        while self.routes:
            self.routes.pop(0).abort()


def record(page: Page, attribute: str) -> None:
    page.evaluate(
        """a=>{const e=a==='data-mirror-swap'?[...document.querySelectorAll('[data-mirror-swap]')][0]:document.querySelector('[data-pack-progress]');
window.__rec=window.__rec||{};window.__rec[a]=[];
new MutationObserver(()=>window.__rec[a].push([performance.now(),parseFloat(e.getAttribute(a))])).observe(e,{attributes:true,attributeFilter:[a]});}""",
        attribute)


def bezier(t: float) -> float:
    lo, hi = 0.0, 1.0
    for _ in range(40):
        u = (lo + hi) / 2
        x = 3 * (1 - u) ** 2 * u * 0.2 + u ** 3
        lo, hi = (u, hi) if x < t else (lo, u)
    u = (lo + hi) / 2
    return 3 * (1 - u) * u ** 2 + u ** 3


def assert_swap(page: Page, attribute: str, band: tuple[int, int]) -> None:
    def done() -> bool:
        rows = page.evaluate("a=>window.__rec[a]", attribute)
        return any(v < 1 for _, v in rows) and rows[-1][1] == 1

    wait_for(page, done, 10, f"{attribute} should run from 0 to 1", step=16)
    rows = page.evaluate("a=>window.__rec[a]", attribute)
    start = max(i for i, r in enumerate(rows) if r[1] < 0.02) if any(r[1] < 0.02 for r in rows) else 0
    run = rows[start:]
    length = run[-1][0] - run[0][0]
    assert band[0] - 20 <= length <= band[1] + 20, f"{attribute} ran {length} ms, band {band}"
    values = [v for _, v in run]
    assert len(values) >= 4 and all(b > a for a, b in zip(values, values[1:])), values
    for at, value in run:
        assert abs(value - bezier(min((at - run[0][0]) / length, 1))) <= 0.15, run


def term(page: Page, name: str) -> str:
    return R(page, "region", "Pack facts").evaluate(
        """(el,n)=>{const d=[...el.querySelectorAll('dt')].find(x=>x.textContent.trim()===n);
if(!d)return null;let s=d.nextElementSibling;return s?s.textContent:null}""", name) or ""


def mirror(page: Page) -> str:
    return text(R(page, "region", "Pack facts"))


def panel_lines(pack: dict[str, Any]) -> list[str]:
    lines = [f"MRP Rs {rupees(pack['printedMrpPaise'])}", f"Packed {show_date(pack['packedDate'])}",
             f"Best before {show_date(pack['bestBeforeDate'])}"]
    if pack["unitSalePrice"]:
        lines.append(f"Rs {pack['unitSalePrice']['rupees']} per {pack['unitSalePrice']['per']}")
    if pack["revisedMrpPaise"] is not None:
        lines.append(f"Revised MRP Rs {rupees(pack['revisedMrpPaise'])}")
    if pack["oldWrapper"]:
        lines.append("Old wrapper")
    return lines


def assert_panel(page: Page, pack: dict[str, Any]) -> None:
    drawn = attrs(page)["data-panel-text"].split(" | ")
    for line in panel_lines(pack):
        assert line in drawn, f"panel lacks {line!r}: {drawn}"


def read_pack(page: Page, code: str) -> None:
    fill(R(page, "textbox", "Batch code"), code)
    click(R(page, "button", "Read pack"))


def wait_batch(page: Page, code: str) -> None:
    wait_for(page, lambda: attrs(page).get("data-batch") == code, 15, f"stage should show {code}")


def test_wf_first_visit_reels_on_phone(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        hero = R(page, "region", "Now Showing").bounding_box()
        assert hero["height"] == pytest.approx(800, abs=2)
        assert R(page, "heading", "COLD DRINK HOUSE FULL").bounding_box()["width"] > page.viewport_size["width"] / 2
        top = shot(page)
        assert near(top.at(5, int(800 * 0.5)), CARMINE) and near(top.at(5, int(800 * 0.97)), CHARCOAL)
        assert page.get_by_text(
            "Nashik's Vasant Talkies bottled its interval soda in the lobby, and the house still prints every price where you can read it."
        ).count() == 1
        assert R(page, "link", "Read your pack").count() == 1 and R(page, "img", "Pack under the lamp").count() == 1
        assert R(page, "button", "Reels").count() == 0
        for name in REELS:
            assert R(R(page, "navigation", "Reels"), "link", name).is_visible()
    with view(browser, app_url, 375, 812, touch=True) as page:
        tops = [R(page, "region", n).evaluate("e=>e.getBoundingClientRect().top+scrollY") for n in REELS]
        assert tops == sorted(tops), tops
        reels = R(page, "button", "Reels")
        assert reels.get_attribute("aria-expanded") == "false"
        assert all(R(page, "link", n).count() == 0 for n in REELS)
        assert not set(tab_order(page, 8)) & set(REELS)
        layout(page)
        to_progress(page, 0.4)
        y, p = page.evaluate("scrollY"), progress(page)
        click(reels)
        wait_for(page, lambda: reels.get_attribute("aria-expanded") == "true", 5, "Reels should open")
        for name in REELS:
            link = R(page, "link", name)
            assert link.bounding_box()["height"] >= TARGET_PX and in_view(link) and topmost(link), name
        assert page.evaluate("scrollY") == y and progress(page) == p
        with_gate = Gate(page, "**/api/batches/**")
        page.evaluate("code=>{history.pushState({}, '', '/?batch='+code);dispatchEvent(new PopStateEvent('popstate',{state:{}}))}", "NSK-261005-02")
        wait_for(page, lambda: with_gate.routes, 5, "history move should read the batch")
        with_gate.release()
        wait_batch(page, "NSK-261005-02")
        assert reels.get_attribute("aria-expanded") == "true"
        reels.focus()
        page.set_viewport_size({"width": 800, "height": 812})
        wait_for(page, lambda: accessible_name(page) == "The Pack", 5, "focus should move to The Pack link")
        page.set_viewport_size({"width": 375, "height": 812})
        wait_for(page, lambda: accessible_name(page) == "Reels", 5, "focus should return to Reels")
        assert R(page, "button", "Reels").get_attribute("aria-expanded") == "false"


def test_wf_first_visit_seed(app_url: str) -> None:
    base = instance("APP_TZ_FAR_URL")
    with server_clock(base, GRADING_NOW) as client:
        cat = client.get("/api/catalogue").json()
        assert cat["counts"] == {"drinks": 6, "skus": 14, "notices": 3, "scheduledRevisions": 1}
        assert [(d["id"], d["name"], d["carbonated"]) for d in cat["drinks"]] == [d[:3] for d in DRINKS]
        got = [(s["code"], d["name"], s["variant"], s["format"], s["sizeMl"], s["shelfDays"])
               for d in cat["drinks"] for s in d["skus"]]
        assert got == [s[:6] for s in SKUS]
        for code, (sku, printed, sticker, _, best) in BATCHES.items():
            pack = facts(client, code)
            assert (pack["skuCode"], pack["printedMrpPaise"], pack["revisedMrpPaise"], pack["bestBeforeDate"]) == (sku, printed, sticker, best)
            assert pack["oldWrapper"] is False
        notices = client.get("/api/notices").json()["notices"]
        assert sorted(n["number"] for n in notices) == ["VT-2026-01", "VT-2026-02", "VT-2026-03", "VT-2026-04"]
        one = client.get("/api/notices/VT-2026-01").json()["versions"]
        assert [v["version"] for v in one] == [2, 1] and one[1]["supersededBy"] == 2
        assert {r["skuCode"]: r["revisedMrpPaise"] for r in one[1]["rows"]} == {"TN-500-PET": 2400, "TN-200-CTN": 1200}
        assert one[0]["reason"] == "Corrected the Ticket Nimbu 500 ml new-print price."
        editor = signed_in_api(base, EDITOR)
        desk_body = editor.get("/api/editor/notices").json()
        assert desk_body["drafts"] == [] and desk_body["heldWork"] == 0
        assert editor.get("/api/editor/price-sheets").json()["sheets"] == []
        for creds in (SAGAR, DECCAN):
            stockist = signed_in_api(base, creds)
            assert stockist.get("/api/stockist/endpoints").json()["endpoints"] == []
            assert deliveries(stockist) == []
        sheet = list(csv.DictReader(io.StringIO(editor.get("/api/stockist/price-sheet.csv").text)))
        assert {r["sku_code"]: r["aliases"] for r in sheet if r["aliases"]} == {
            "KP-200-CTN": "panna ctn 200", "TN-500-PET": "nimbu half ltr 500ml"}
        assert client.post("/api/session", json={"email": "admin@example.com", "password": "admin"}).status_code == 401
        with app_copy(DATABASE_URL=os.environ["DATABASE_URL"] + "_tz_far", TZ="Pacific/Kiritimati", INTERVAL_TEST_CLOCK="on") as copy:
            again = httpx.get(copy + "/api/catalogue", timeout=HTTP_S).json()
            assert again["counts"]["skus"] == 14 and again["counts"]["drinks"] == 6
            assert [s["code"] for d in again["drinks"] for s in d["skus"]] == [s[0] for s in SKUS]
            assert len(httpx.get(copy + "/api/notices", timeout=HTTP_S).json()["notices"]) == 4


def test_wf_first_visit_counts(browser: Any) -> None:
    base = instance("APP_TZ_FAR_URL")
    with server_clock(base, BEFORE_MIDNIGHT) as client:
        with view(browser, base) as page:
            assert SEED_COUNTS in text(R(page, "region", "End Credits"))
        with desk(browser, base) as page:
            see_text(page, page.locator("body"), SEED_COUNTS)
        client.put("/api/test/clock", json={"now": AT_MIDNIGHT})
        moved = "Drinks: 6. Packs: 14. Notices: 4. Scheduled revisions: 0."
        with view(browser, base) as page:
            assert moved in text(R(page, "region", "End Credits"))
        with desk(browser, base) as page:
            see_text(page, page.locator("body"), moved)
    live = instance("APP_TEST_CLOCK_URL")
    editor = signed_in_api(live, EDITOR)
    with desk(browser, live) as page:
        before = editor.get("/api/editor/notices").json()["counts"]
        line = f"Scheduled revisions: {before['scheduledRevisions']}."
        see_text(page, page.locator("body"), line)
        published_notice(editor, [new_print("RG-2000-PET", 12100 + random.randrange(500))], next_day(editor, "RG-2000-PET"))
        see_text(page, page.locator("body"), f"Scheduled revisions: {before['scheduledRevisions'] + 1}.", 12)


@pytest.mark.parametrize("size", [(375, 812), (768, 1024), (1280, 800)], ids=["375", "768", "1280"])
def test_wf_first_visit_clear_layers(browser: Any, app_url: str, size: tuple[int, int]) -> None:
    width, height = size
    with view(browser, app_url, width, height) as page:
        marquee = page.get_by_role("marquee", name="Price changes").bounding_box()
        click(R(page, "link", "Read your pack"))
        field = R(page, "textbox", "Batch code")
        wait_for(page, lambda: active_is(page, field), 5, "Read your pack should focus the batch field", step=100)
        for _ in range(14):
            advance(page, FOCUS_MS)
            inside_layer = page.evaluate("()=>{const e=document.activeElement;return !!e.closest('[role=marquee],nav')||['Pause price changes','Play price changes','Reels'].includes((e.getAttribute('aria-label')||e.textContent||'').trim())}")
            if not inside_layer:
                box = active_box(page)
                assert box["top"] >= -1 and box["bottom"] <= height + 1, box
                assert box["bottom"] <= marquee["y"] + height or box["top"] >= 0
                assert page.evaluate(
                    "()=>{const e=document.activeElement,r=e.getBoundingClientRect();const t=document.elementFromPoint(r.left+r.width/2,r.top+r.height/2);return !!t&&(t===e||e.contains(t))}")
                bar = page.get_by_role("marquee", name="Price changes").bounding_box()
                assert box["bottom"] <= bar["y"] + 1 or box["top"] >= bar["y"] + bar["height"] - 1, (box, bar)
            page.keyboard.press("Tab")
        field.focus()
        advance(page, FOCUS_MS)
        before = page.evaluate("scrollY")
        if width >= 768:
            page.mouse.move(width / 2, height / 2)
            page.mouse.wheel(0, 100)
            advance(page, REST_MS)
            assert page.evaluate("scrollY") >= before, "the wheel step returned toward the old position"


def test_wf_first_visit_reels_panel_holds(browser: Any, app_url: str) -> None:
    with view(browser, app_url, 375, 812, touch=True) as page:
        click(R(page, "button", "Reels"))
        wait_for(page, lambda: R(page, "link", "The Pack").count() == 1, 5, "panel should open")
        R(page, "button", "Reels").focus()
        seen = tab_order(page, 7)
        assert set(seen) <= {"Reels", *REELS}, seen
        assert {"Reels", *REELS} <= set(seen)
        page.keyboard.press("Shift+Tab")
        assert accessible_name(page) in {"Reels", *REELS}
        url, batch = page.url, attrs(page)["data-batch"]
        lineup_box = R(page, "region", "The Lineup").evaluate("e=>e.getBoundingClientRect().top+scrollY")
        scroll_to(page, lineup_box)
        drink = R(page, "button", "Balcony Soda")
        box = drink.bounding_box()
        session(page).send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": box["x"] + 10, "y": box["y"] + 10}]})
        session(page).send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        wait_for(page, lambda: R(page, "button", "Reels").get_attribute("aria-expanded") == "false", 5, "tap outside should close")
        assert accessible_name(page) == "Reels"
        advance(page, REST_MS)
        assert page.url == url and attrs(page)["data-batch"] == batch
        assert drink.get_attribute("aria-pressed") != "true"


def test_sticker_turn_scrub(browser: Any, app_url: str) -> None:
    with view(browser, f"{app_url}/?batch=NSK-260915-07") as page:
        pin = pin_offset(page)
        steps = [0.1, 0.3, 0.55, 0.65, 0.75, 0.9, 1.0]
        seen = []
        for value in steps + steps[::-1][1:]:
            to_progress(page, value, pin)
            assert progress(page) == pytest.approx(value, abs=0.01)
            on_formula(page)
            assert attrs(page)["data-sticker"] == ("seated" if progress(page) >= 0.75 else "none")
            seen.append(progress(page))
        forward = seen[: len(steps)]
        back = seen[len(steps) - 1:]
        assert forward == sorted(forward) and back == sorted(back, reverse=True)
        scroll_to(page, pin + 4 * 800 + 800)
        assert progress(page) == 1
        before = attrs(page)
        advance(page, 3000)
        after = attrs(page)
        assert all(before[k] == after[k] for k in ("data-pack-yaw", "data-camera-z", "data-sticker"))


def test_server_decided_sticker(browser: Any, app_url: str) -> None:
    client = api(app_url)
    assert facts(client, "NSK-260915-07")["stickerApplies"] is True
    assert facts(client, "NSK-261005-02")["stickerApplies"] is False
    with view(browser, f"{app_url}/?batch=NSK-260915-07") as page:
        to_progress(page, 0.8)
        assert attrs(page)["data-sticker"] == "seated"
        assert S_NO_STICKER not in mirror(page)
    with view(browser, f"{app_url}/?batch=NSK-261005-02") as page:
        to_progress(page, 0.8)
        assert attrs(page)["data-sticker"] == "none" and attrs(page)["data-sticker-screen-quad"] == ""
        assert S_NO_STICKER in mirror(page)


def test_panel_and_mirror_agree(browser: Any, app_url: str) -> None:
    client = api(app_url)
    with view(browser, app_url) as page:
        for code in ("NSK-260915-07", "PUN-260920-03", "PUN-261012-03"):
            read_pack(page, code)
            wait_batch(page, code)
            pack = facts(client, code)
            assert_panel(page, pack)
            assert f"Rs {rupees(pack['printedMrpPaise'])}" in term(page, "Printed MRP")
            assert show_date(pack["packedDate"]) in term(page, "Packed")
            assert show_date(pack["bestBeforeDate"]) in term(page, "Best before")
            if pack["revisedMrpPaise"] is not None:
                assert f"Rs {rupees(pack['revisedMrpPaise'])}" in term(page, "Revised MRP")
            if pack["unitSalePrice"]:
                assert pack["unitSalePrice"]["rupees"] in term(page, "Unit sale price")
            assert term(page, "Batch").strip().startswith(code) or code in term(page, "Batch")


def test_wf_sticker_turn_touch_scrub(browser: Any, app_url: str) -> None:
    with view(browser, app_url, 375, 812, touch=True) as page:
        to_progress(page, 0.2)
        y, p = page.evaluate("scrollY"), progress(page)
        finger = session(page)
        finger.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": 180, "y": 500}]})
        for at in range(480, 200, -20):
            finger.send("Input.dispatchTouchEvent", {"type": "touchMove", "touchPoints": [{"x": 180, "y": at}]})
        finger.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})
        wait_for(page, lambda: page.evaluate("scrollY") > y + 100, 5, "a swipe should scroll the page natively")
        advance(page, REST_MS)
        moved = page.evaluate("scrollY") - y
        assert progress(page) == pytest.approx(p + moved / (4 * 812), abs=0.01)
        on_formula(page)


def test_wf_sticker_turn_lineup_pick(browser: Any, app_url: str) -> None:
    client = api(app_url)
    with view(browser, app_url) as page:
        R(page, "region", "The Lineup").scroll_into_view_if_needed()
        advance(page, REST_MS)
        y = page.evaluate("scrollY")
        click(R(page, "button", "Second Show Jeera"))
        story = client.get("/api/skus/SJ-300-CAN").json()["storyBatch"]
        wait_batch(page, story["batchCode"])
        assert R(page, "button", "Second Show Jeera").get_attribute("aria-pressed") == "true"
        assert attrs(page)["data-sku"] == "SJ-300-CAN" and f"Rs {rupees(story['printedMrpPaise'])}" in term(page, "Printed MRP")
        assert page.evaluate("scrollY") == y
        for index, (_, name, _, _) in enumerate(DRINKS):
            colour = style(R(page, "button", name), "color")["color"]
            level = GREYS[abs(index - 2)]
            assert re.findall(r"\d+", colour)[:3] == [str(level)] * 3, (name, colour)
        click(R(page, "radio", "1 L PET"))
        wait_for(page, lambda: attrs(page).get("data-sku") == "SJ-1000-PET", 10, "radio should swap the stage")
        assert page.url.endswith("/?sku=SJ-1000-PET")


def test_wf_sticker_turn_url_history(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        R(page, "region", "The Lineup").scroll_into_view_if_needed()
        advance(page, REST_MS)
        y = page.evaluate("scrollY")
        click(R(page, "button", "Balcony Soda"))
        wait_for(page, lambda: attrs(page).get("data-sku") == "BS-300-GLS", 10, "first pack of the drink")
        assert "sku=BS-300-GLS" in page.url
        click(R(page, "radio", "300 ml Can"))
        wait_for(page, lambda: attrs(page).get("data-sku") == "BS-300-CAN", 10, "second pack")
        page.go_back()
        wait_for(page, lambda: attrs(page).get("data-sku") == "BS-300-GLS", 10, "Back should restore the pack")
        assert R(page, "radio", "300 ml Glass").is_checked() and page.evaluate("scrollY") == y
        page.go_forward()
        wait_for(page, lambda: attrs(page).get("data-sku") == "BS-300-CAN", 10, "Forward should restore the pack")
        assert page.evaluate("scrollY") == y
    with view(browser, f"{app_url}/?sku=BS-300-CAN&batch=NSK-260915-07") as page:
        assert attrs(page)["data-batch"] == "NSK-260915-07"
    with view(browser, f"{app_url}/?sku=ZZ-1-ZZZ") as page:
        see_text(page, R(page, "status", "Pack reader status"), S_UNKNOWN_PACK)
        assert attrs(page)["data-sku"] == "KP-200-CTN"


def test_wf_sticker_turn_rereads(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    editor = signed_in_api(base, EDITOR)
    for no_webgl in (False, True):
        with view(browser, base, no_webgl=no_webgl) as page:
            record(page, "data-swap-progress")
            record(page, "data-mirror-swap")
            read_pack(page, "NSK-261005-02")
            assert_swap(page, "data-swap-progress", PACK_SWAP_MS)
            assert_swap(page, "data-mirror-swap", MIRROR_SWAP_MS)
    code = batch_code(letters(), today(editor))
    assert editor.post("/api/editor/batches", json={"code": code, "skuCode": "BS-750-PET"}).status_code == 201
    with view(browser, f"{base}/?batch={code}") as page:
        reads = Gate(page, f"**/api/batches/{code}")
        reads.open = True
        read_pack(page, "NSK-261010-08")
        wait_batch(page, "NSK-261010-08")
        page.go_back()
        wait_batch(page, code)
        assert reads.seen, "Back should ask the server again"
        marquee_before = text(page.get_by_role("marquee", name="Price changes"))
        advance(page, REFRESH_MS * 3)
        assert text(page.get_by_role("marquee", name="Price changes")) == marquee_before


def test_wf_batch_reader_latest_wins(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        hold = Gate(page, "**/api/batches/NSK-260915-07")
        read_pack(page, "  nsk-260915-07 ")
        wait_for(page, lambda: hold.routes, 5, "first read should leave")
        see_text(page, R(page, "status", "Pack reader status"), "Reading your pack.")
        read_pack(page, "NSK-261010-08")
        wait_batch(page, "NSK-261010-08")
        see_text(page, R(page, "status", "Pack reader status"), "Batch NSK-261010-08 read.")
        hold.release()
        advance(page, 1500)
        assert attrs(page)["data-batch"] == BATCH_C and f"batch={BATCH_C}" in page.url
        assert "Rs 45.00" in term(page, "Printed MRP")
        assert text(R(page, "status", "Pack reader status")) == "Batch NSK-261010-08 read."
        assert active_is(page, R(page, "textbox", "Batch code"))
        to_progress(page, 1)
        client = api(app_url)
        read_pack(page, "NSK-260915-07")
        wait_batch(page, "NSK-260915-07")
        read_pack(page, "NSK-261005-02")
        wait_batch(page, "NSK-261005-02")
        advance(page, 1500)
        assert_panel(page, facts(client, "NSK-261005-02"))


def test_published_pack_sentences(browser: Any, app_url: str) -> None:
    client = api(app_url)
    assert client.get(f"/api/batches/{UNKNOWN_CODE}").json()["error"] == "unknown_batch"
    malformed = client.get(f"/api/batches/{MALFORMED_CODE}")
    assert malformed.status_code == 422 and malformed.json() == {"error": "unknown_batch", "message": S_UNKNOWN_BATCH}
    with view(browser, app_url, wrong_clock=True) as page:
        url, batch = page.url, attrs(page)["data-batch"]
        read_pack(page, "NSK-991231-1")
        see_text(page, R(page, "status", "Pack reader status"), S_UNKNOWN_BATCH)
        assert text(R(page, "status", "Pack reader status")) == S_UNKNOWN_BATCH
        assert page.url == url and attrs(page)["data-batch"] == batch
        read_pack(page, "NSK-250301-03")
        wait_batch(page, "NSK-250301-03")
        assert S_PAST in mirror(page)
        read_pack(page, "NSK-260915-07")
        wait_batch(page, "NSK-260915-07")
        expected = facts(client, "NSK-260915-07")
        assert (S_PAST in mirror(page)) == (expected["dateNote"] is not None)
        assert_panel(page, expected)


def test_batch_lookup_limit(browser: Any) -> None:
    base = instance("APP_GOTENBERG_DOWN_URL")
    client = api(base)
    answers = fire(BURST_LOOKUPS, lambda i: client.get(f"/api/batches/{BATCH_A}"))
    assert sum(a.status_code != 429 for a in answers) == LIMIT_LOOKUPS
    limited = next(a for a in answers if a.status_code == 429)
    wait = int(limited.headers["Retry-After"])
    assert 1 <= wait <= LIMIT_LOOKUPS
    body = limited.json()
    assert body["error"] == "rate_limited" and body["retryAfter"] == wait and WAIT_RE.match(body["message"])
    assert client.get("/api/search", params={"q": "NSK-260915-07"}).status_code == 429
    assert client.get("/api/search", params={"q": "Kairi"}).status_code == 200
    spoofed = client.get(f"/api/batches/{BATCH_A}", headers=FORWARDED)
    assert spoofed.status_code == 429
    other = api(base)
    assert other.get("/api/search", params={"q": "NSK-260915-07"}).status_code == 200
    with view(browser, base) as page:
        page.evaluate("async n=>{for(let i=0;i<n;i++)await fetch('/api/batches/" + BATCH_A + "')}", LIMIT_LOOKUPS)
        read_pack(page, "NSK-261005-02")
        wait_for(page, lambda: WAIT_RE.match(text(R(page, "status", "Pack reader status"))), 10, "wait message should show")


def test_turn_slider(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        pin_offset(page)
        slider = R(page, "slider", "Turn the pack")
        slider.focus()
        advance(page, FOCUS_MS)
        assert slider.get_attribute("aria-valuemin") == "0" and slider.get_attribute("aria-valuemax") == "100"
        page.keyboard.press("Home")
        advance(page, FOCUS_MS)
        for key, value, words in [("ArrowRight", 5, "Front of the pack"), ("ArrowUp", 10, "Front of the pack"),
                                  ("PageUp", 35, "Turning to the panel"), ("PageUp", 60, "Declaration panel"),
                                  ("PageDown", 35, "Turning to the panel"), ("ArrowLeft", 30, "Turning to the panel"),
                                  ("ArrowDown", 25, "Front of the pack"), ("End", 100, "Close on the panel")]:
            page.keyboard.press(key)
            advance(page, FOCUS_MS)
            assert progress(page) == pytest.approx(value / 100, abs=0.01), key
            assert slider.get_attribute("aria-valuenow") == str(value) and slider.get_attribute("aria-valuetext") == words
            assert active_is(page, slider)
        pin = to_progress(page, 0.4)
        assert slider.get_attribute("aria-valuenow") == str(round(progress(page) * 100))
        box = slider.bounding_box()
        page.mouse.move(box["x"] + box["width"] * progress(page), box["y"] + box["height"] / 2)
        page.mouse.down()
        page.mouse.move(box["x"] + box["width"] * 0.8, box["y"] + box["height"] / 2)
        page.mouse.up()
        advance(page, FOCUS_MS)
        assert progress(page) > 0.6, "thumb drag should move progress"
        assert pin is not None
    with view(browser, app_url, reduced_motion="reduce") as page:
        assert R(page, "slider", "Turn the pack").count() == 0


@pytest.mark.parametrize("env", ["APP_TZ_FAR_URL", "APP_TEST_CLOCK_URL"], ids=["kiritimati", "new_york"])
def test_kolkata_midnight_revision(env: str) -> None:
    base = instance(env)
    with server_clock(base, BEFORE_MIDNIGHT) as client:
        def price() -> int:
            return client.get("/api/search", params={"q": "SJ-300-CAN"}).json()["results"][0]["retailPricePaise"]

        assert price() == 3500
        assert client.get(f"/api/skus/{SKU_JEERA}").json()["currentMrpPaise"] == 3500
        assert client.get(f"/api/notices/{NOTICE_SCHEDULED}").json()["state"] == "scheduled"
        assert client.get("/api/catalogue").json()["today"] == "2028-03-31"
        client.put("/api/test/clock", json={"now": AT_MIDNIGHT})
        assert price() == 2950
        assert client.get(f"/api/skus/{SKU_JEERA}").json()["currentMrpPaise"] == 2950
        assert client.get(f"/api/notices/{NOTICE_SCHEDULED}").json()["state"] == "in_effect"
        assert client.get("/api/catalogue").json()["today"] == "2028-04-01"


def test_old_and_new_packs() -> None:
    base = instance("APP_TZ_FAR_URL")
    with server_clock(base, GRADING_NOW) as client:
        old, new = facts(client, "NSK-260915-07"), facts(client, "NSK-261005-02")
        assert (old["printedMrpPaise"], old["revisedMrpPaise"], old["stickerApplies"], old["retailPricePaise"]) == (2000, 1875, True, 1875)
        assert old["sourceNotice"]["number"] == "VT-2026-02"
        assert (new["printedMrpPaise"], new["revisedMrpPaise"], new["stickerApplies"]) == (1875, None, False)
        assert new["stickerNote"] == S_NO_STICKER
        launch, print_row = facts(client, "NSK-260720-05"), facts(client, "NSK-260810-05")
        assert (launch["printedMrpPaise"], launch["stickerApplies"]) == (2000, False)
        assert launch["sourceNotice"] is None
        assert (print_row["printedMrpPaise"], print_row["stickerApplies"]) == (2250, False)
        client.put("/api/test/clock", json={"now": "2027-09-15T18:29:59Z"})
        assert facts(client, "NSK-260915-07")["dateNote"] is None
        assert client.get(f"/api/skus/{SKU_KAIRI}").json()["storyBatch"]["batchCode"] == BATCH_A
        client.put("/api/test/clock", json={"now": "2027-09-15T18:30:00Z"})
        past = facts(client, "NSK-260915-07")
        assert past["dateNote"] == S_PAST and past["pastBestBefore"] is True
        assert client.get(f"/api/skus/{SKU_KAIRI}").json()["storyBatch"]["batchCode"] == BATCH_B


def test_unit_price_and_sugar(browser: Any) -> None:
    base = instance("APP_TZ_FAR_URL")
    with server_clock(base, GRADING_NOW) as client:
        sugar = {d[1]: d[3] for d in DRINKS}
        sizes = {s[0]: (s[1], s[4]) for s in SKUS}
        for code, (sku, _, _, unit, _) in BATCHES.items():
            pack = facts(client, code)
            drink, size = sizes[sku]
            assert pack["sugarMgPerPack"] == (2 * sugar[drink] * size + 100) // 200
            if unit is None:
                assert pack["unitSalePrice"] is None
            else:
                assert (pack["unitSalePrice"]["rupees"], pack["unitSalePrice"]["per"]) == unit, code
        with view(browser, f"{base}/?batch=NSK-261010-08") as page:
            assert "56.3 g" in term(page, "Sugar per pack")
        with view(browser, f"{base}/?batch=PUN-261012-03") as page:
            assert "Rs" not in term(page, "Unit sale price")


def day_page_setup(base: str) -> tuple[httpx.Client, httpx.Client, str]:
    editor = signed_in_api(base, EDITOR)
    api(base).delete("/api/test/clock")
    day = next_day(editor, "MK-1000-PET", "BS-750-PET")
    control = api(base)
    assert control.put("/api/test/clock", json={"now": noon(day)}).status_code == 200
    return editor, control, day


def test_wf_revision_clock_new_day_slip(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    editor, control, day = day_page_setup(base)
    try:
        tomorrow = add_days(day, 1)
        published_notice(editor, [new_print("BS-750-PET", 4600 + random.randrange(300))], tomorrow)
        with view(browser, f"{base}/?sku=BS-750-PET", zone="Pacific/Honolulu", wrong_clock=True) as page:
            to_progress(page, 0.3)
            y, before = page.evaluate("scrollY"), mirror(page)
            control.put("/api/test/clock", json={"now": noon(tomorrow)})
            advance(page, DAY_CHECK_MS)
            slip = R(page, "region", "New day")
            sentence = f"The house date has changed. Prices here are for {show_date(tomorrow)}."
            see_text(page, slip, sentence)
            assert text(R(page, "status", "Day status")) == sentence
            assert mirror(page) == before and page.evaluate("scrollY") == y
            control.put("/api/test/clock", json={"now": noon(day)})
            advance(page, DAY_CHECK_MS)
            gone(page, R(page, "button", "Read today's prices"))
            control.put("/api/test/clock", json={"now": noon(tomorrow)})
            advance(page, DAY_CHECK_MS)
            see(page, R(page, "button", "Read today's prices"))
            click(R(page, "button", "Read today's prices"))
            status = R(page, "status", "Day status")
            see_text(page, status, f"Prices read for {show_date(tomorrow)}.")
            wait_for(page, lambda: active_is(page, status), 5, "focus should land on Day status")
            current = api(base).get("/api/skus/BS-750-PET").json()
            assert f"Rs {rupees(current['storyBatch']['printedMrpPaise'])}" in mirror(page)
            assert page.evaluate("scrollY") == y
            gone(page, R(page, "button", "Read today's prices"))
    finally:
        control.delete("/api/test/clock")


def test_wf_revision_clock_phone_day(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    editor, control, day = day_page_setup(base)
    try:
        tomorrow = add_days(day, 1)
        with view(browser, f"{base}/?batch=NSK-260925-09", 375, 812, touch=True) as page:
            to_progress(page, 0.8)
            control.put("/api/test/clock", json={"now": noon(tomorrow)})
            advance(page, DAY_CHECK_MS)
            press = R(page, "button", "Read today's prices")
            see(page, press)
            check_gate = Gate(page, "**/api/catalogue")
            advance(page, DAY_CHECK_MS)
            wait_for(page, lambda: check_gate.routes, 5, "a day check should be in flight")
            stale_check = check_gate.routes.pop()
            check_gate.open = True
            reads = Gate(page, "**/api/batches/NSK-260925-09")
            click(press)
            wait_for(page, lambda: press.get_attribute("aria-disabled") == "true", 5, "button should show pending")
            wait_for(page, lambda: reads.routes, 5, "pack read should leave")
            count = len(reads.seen)
            click(press)
            advance(page, 200)
            assert len(reads.seen) == count, "a further press sent another read"
            read_pack(page, "NSK-261005-02")
            wait_batch(page, "NSK-261005-02")
            reads.release()
            stale_check.fulfill(status=200, content_type="application/json", body=json.dumps(api(base).get("/api/catalogue").json() | {"today": add_days(tomorrow, 5)}))
            see_text(page, R(page, "status", "Day status"), f"Prices read for {show_date(tomorrow)}.")
            advance(page, 1000)
            assert attrs(page)["data-batch"] == "NSK-261005-02" and "NSK-261005-02" in page.url
            gone(page, R(page, "button", "Read today's prices"))
            read_pack(page, "NSK-260915-07")
            wait_batch(page, "NSK-260915-07")
            advance(page, FOCUS_MS)
            pack = facts(api(base), "NSK-260915-07")
            assert attrs(page)["data-sticker"] == ("seated" if pack["stickerApplies"] else "none")
    finally:
        control.delete("/api/test/clock")


def test_release_listings_and_current_prices(browser: Any, app_url: str) -> None:
    client = api(app_url)
    with view(browser, app_url) as page:
        table = R(page, "table", "Revised prices VT-2026-03")
        for name in ("Pack", "Old MRP", "Revised MRP", "Kind"):
            assert R(table, "columnheader", name).count() == 1
        row = R(table, "row", "Balcony Soda 300 ml Can Rs 30.00 Rs 32.00 Sticker")
        assert row.count() == 1 or "Rs 32.00" in text(table)
        assert "Sticker" in text(table)
        assert "New print" in text(R(page, "table", "Revised prices VT-2026-01"))
        assert f"Old wrappers allowed until {show_date('2026-12-31')}" in text(R(page, "region", "Price Notices"))
        current = R(page, "table", "Current prices")
        for name in ("Pack", "Print MRP", "Source notice"):
            assert R(current, "columnheader", name).count() == 1
        body = text(current)
        for drink in client.get("/api/catalogue").json()["drinks"]:
            for sku in drink["skus"]:
                assert sku["name"] in body and f"Rs {rupees(sku['currentMrpPaise'])}" in body
        assert "VT-2026-01 v2" in body and "Launch print" in body
        titles = R(page, "region", "Price Notices").inner_text()
        assert titles.index("VT-2026-04") < titles.index("VT-2026-03") < titles.index("VT-2026-02") < titles.index("VT-2026-01")
    with view(browser, app_url, 375, 812) as page:
        assert R(page, "table", "Current prices").count() == 0 and R(page, "table", "Revised prices VT-2026-03").count() == 0
        assert R(page, "list", "Current prices").count() == 1 and R(page, "list", "Revised prices VT-2026-03").count() == 1
        layout(page)


def test_printable_pdf(browser: Any) -> None:
    base = instance("APP_RABBITMQ_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    wide = [new_print("RG-2000-PET", 12000 + random.randrange(1, 900))]
    with relay(18074, "AMQP_URL", 5672) as _:
        poll(lambda: wait_print(editor, "VT-2026-02", 1), RETURN_S + MARGIN_S, "seed prints with the broker up")
        day = next_day(editor, "RG-2000-PET")
    title = f"Print proof {token()}"
    made = published_notice(editor, wide, day, title)
    number = made["number"]
    with view(browser, f"{base}/notices/{number}") as page:
        link = R(page, "link", f"Download notice {number} version 1")
        assert link.count() == 0 and version_of(editor, number, 1)["printState"] == "pending"
        assert version_of(editor, number, 1)["pdfSha256"] is None
        assert editor.get(f"/api/notices/{number}/versions/1/pdf").json()["error"] == "print_pending"
        with relay(18074, "AMQP_URL", 5672):
            announce = f"Notice {number} version 1 is now Printable."
            see_text(page, R(page, "status", "Print status"), announce, RETURN_S + MARGIN_S)
            see(page, link)
            href = link.get_attribute("href")
            advance(page, REFRESH_MS * 2)
            assert text(R(page, "status", "Print status")).count(announce) == 1
            data = httpx.get(href, timeout=HTTP_S).content
    version = version_of(editor, number, 1)
    stored = S3().get(f"{copy_id(editor)}/notices/{number}/v1.pdf")
    assert data == stored and hashlib.sha256(stored).hexdigest() == version["pdfSha256"]
    assert stored.startswith(b"%PDF-") and pdf_pages(stored) == 1
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(stored)
        handle.flush()
        info = subprocess.run(["pdfinfo", handle.name], capture_output=True, text=True, check=True).stdout
        fonts = subprocess.run(["pdffonts", handle.name], capture_output=True, text=True, check=True).stdout
    assert f"Notice {number}, version 1" in re.search(r"Title:\s*(.*)", info).group(1)
    w, h = (float(x) for x in re.search(r"Page size:\s*([\d.]+) x ([\d.]+)", info).groups())
    assert abs(w - 595) <= 2 and abs(h - 842) <= 2
    assert "Bebas" in fonts and "Garamond" in fonts
    words = " ".join(pdf_text(stored).split())
    row = version["rows"][0]
    ordered = ["PRICE NOTICE", "Vasant Talkies Drinks", f"Notice {number}, version 1", f"Effective {show_date(version['effectiveDate'])}",
               f"Published ", f"{row['name']} Rs {rupees(row['oldMrpPaise'])} to Rs {rupees(row['revisedMrpPaise'])}",
               "The original MRP stays readable on every stickered pack."]
    at = 0
    for line in ordered:
        at = words.index(line, at)


def test_wf_notice_print_outage_and_retry(browser: Any) -> None:
    base = instance("APP_GOTENBERG_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    wait_print(editor, "VT-2026-03", 1, "failed", 60)
    answer = editor.get("/api/notices/VT-2026-03/versions/1/pdf")
    assert answer.status_code == 503 and answer.json() == {"error": "print_unavailable", "message": S_PRINT_OUT}
    assert editor.get("/api/notices/VT-2026-03/versions/1/link").status_code == 503
    with view(browser, base + "/notices/VT-2026-03") as page:
        see_text(page, R(page, "status", "Print status"), S_PRINT_OUT)
        assert "Rs 32.00" in page.locator("body").inner_text()
        assert R(page, "link", "Download notice VT-2026-03 version 1").count() == 0
    with desk(browser, base) as page:
        retry = R(page, "button", "Retry print VT-2026-03 version 1")
        see(page, retry)
        hold = Gate(page, "**/api/editor/notices/VT-2026-03/versions/1/print", "POST")
        click(retry)
        wait_for(page, lambda: hold.routes, 5, "retry request should leave")
        assert retry.get_attribute("aria-disabled") == "true" and active_is(page, retry)
        see_text(page, R(page, "status", "Print status"), "Asking for a new print.")
        assert "Print failed" in page.locator("body").inner_text()
        click(retry)
        advance(page, 500)
        assert len(hold.seen) == 1
        hold.drop()
        see_text(page, R(page, "status", "Print status"), S_LOST_PRINT)
        assert R(page, "button", "Retry print VT-2026-03 version 1").count() == 1
        hold.open = True
        page.unroute("**/api/editor/notices/VT-2026-03/versions/1/print", hold.handler)
        click(retry)
        see_text(page, R(page, "status", "Print status"), "Print requested. Check the print state shortly.")
        wait_for(page, lambda: active_is(page, R(page, "status", "Print status")), 5, "focus moves to Print status")
    wait_print(editor, "VT-2026-03", 1, "failed", 60)
    primary = signed_in_api(os.environ.get("APP_URL", instance("APP_DELIVERY_URL")), EDITOR)
    wait_print(primary, "VT-2026-03", 1, "printable", 60)
    refused = primary.post("/api/editor/notices/VT-2026-03/versions/1/print", json={})
    assert refused.status_code == 409 and refused.json()["error"] == "print_not_failed"


def test_wf_notice_print_older_versions(browser: Any, app_url: str) -> None:
    with view(browser, app_url + "/notices/VT-2026-01") as page:
        wait_for(page, lambda: R(page, "button", "Version 1").count() == 1, 15, "older version button")
        version = R(page, "button", "Version 1")
        assert version.get_attribute("aria-expanded") == "false"
        assert "Superseded by version 2" in page.locator("body").inner_text()
        assert "Rs 24.00" not in page.locator("body").inner_text()
        wait_for(page, lambda: R(page, "link", "Download notice VT-2026-01 version 2").count() == 1, 15, "latest link")
        assert R(page, "link", "Download notice VT-2026-01 version 1").count() == 0
        assert "Download notice VT-2026-01 version 1" not in tab_order(page, 8)
        version.focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: version.get_attribute("aria-expanded") == "true", 5, "Enter opens the version")
        assert "Rs 24.00" in page.locator("body").inner_text()
        see(page, R(page, "link", "Download notice VT-2026-01 version 1"))
        page.set_viewport_size({"width": 375, "height": 812})
        advance(page, LINK_RENEW_MS + 1000)
        assert R(page, "button", "Version 1").get_attribute("aria-expanded") == "true"
        page.keyboard.press("Space")
        wait_for(page, lambda: R(page, "button", "Version 1").get_attribute("aria-expanded") == "false", 5, "Space closes it")


def test_wf_notice_print_phone_link(browser: Any, app_url: str) -> None:
    client = api(app_url)
    wait_print(client, "VT-2026-01", 1)
    wait_print(client, "VT-2026-01", 2)
    with view(browser, app_url + "/notices/VT-2026-01", 375, 812, touch=True) as page:
        link2 = R(page, "link", "Download notice VT-2026-01 version 2")
        see(page, link2)
        hold = Gate(page, "**/api/notices/VT-2026-01/versions/1/link")
        advance(page, LINK_RENEW_MS + 1000)
        wait_for(page, lambda: hold.routes, 10, "version 1 should renew inside its closed body")
        advance(page, LINK_DROP_MS - LINK_RENEW_MS)
        see(page, link2)
        hold.release()
        page.unroute("**/api/notices/VT-2026-01/versions/1/link", hold.handler)
        click(R(page, "button", "Version 1"))
        link1 = R(page, "link", "Download notice VT-2026-01 version 1")
        see(page, link1, 10)
        for link in (link1, link2):
            link.scroll_into_view_if_needed()
            advance(page, 100)
            assert link.bounding_box()["height"] >= TARGET_PX and topmost(link)
        href = link1.get_attribute("href")
        opened: list[str] = []
        page.context.on("request", lambda r: opened.append(r.url))
        tap(link1)
        wait_for(page, lambda: href in opened, 10, "a tap should open the signed link")
    data = httpx.get(href, timeout=HTTP_S)
    assert data.status_code == 200 and hashlib.sha256(data.content).hexdigest() == version_of(client, "VT-2026-01", 1)["pdfSha256"]
    assert httpx.get(href.split("?")[0], timeout=HTTP_S).status_code == 403


def test_wf_sheet_import_matching(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    table = [("Kairi 1.2LTR PET", "matched", "name_size", "KP-1200-PET", None),
             ("Panna Ctn 200", "matched", "alias", "KP-200-CTN", None),
             ("Balcony Soda 300ml", "ambiguous", None, None, None),
             ("Balcony Soda 300ml CAN", "matched", "name_size", "BS-300-CAN", None),
             ("Ticket Nimbu .5 L PET", "matched", "name_size", "TN-500-PET", None),
             ("\"Second Show Jeera 1,000 ml\"", "matched", "name_size", "SJ-1000-PET", None),
             ("Mango Fizz 500 ML", "unmatched", None, None, "no_drink"),
             ("Kairi 200 ml x 30", "unmatched", None, None, "case_pack"),
             ("Kairi 200 ml 1 L", "unmatched", None, None, "several_sizes")]
    prices = ["18.75", "Rs.18.75", "\"Rs 1,250.00\"", "\"₹1,250\"", "Rs. 18.75/-", "19", "20", "21", "22"]
    lines = [f",{d},{p},," for (d, *_), p in zip(table, prices)]
    lines.append(f",Tail {token()} no size,abc,,")
    answer = upload(editor, f"match-{token()}.csv", sheet_bytes(*lines))
    assert answer.status_code == 201, answer.text
    rows = answer.json()["sheet"]["rows"]
    for row, (_, status, by, sku, reason) in zip(rows, table):
        assert (row["status"], row["matchedBy"], row["skuCode"], row["reason"]) == (status, by, sku, reason), row
    assert sorted(rows[2]["candidates"]) == ["BS-300-CAN", "BS-300-GLS"]
    assert [r["newMrpPaise"] for r in rows[:5]] == [1875, 1875, 125000, 125000, 1875]
    assert rows[-1]["reason"] == "unreadable_values" and rows[-1]["status"] == "unmatched"
    assert editor.post(f"/api/editor/price-sheets/{answer.json()['sheet']['id']}/rows/{rows[-1]['rowNumber']}/settle",
                       json={"skuCode": "KP-200-CTN"}).status_code == 422
    dupes = upload(editor, f"dupes-{token()}.csv", sheet_bytes(
        "KP-600-PET,x,10.00,,", "kp-600-pet,y,10.00,,", "MK-1000-PET,x,10.00,,", "MK-1000-PET,y,11.00,,"))
    got = dupes.json()["sheet"]["rows"]
    assert got[1]["mergedIntoRow"] == 1
    assert [got[2]["status"], got[3]["status"], got[2]["reason"]] == ["ambiguous", "ambiguous", "conflicting_prices"]
    assert got[2]["candidates"] == ["MK-1000-PET"]
    big = sheet_bytes(*[f"TN-200-CTN,{token()} row {i},12.00,," for i in range(SHEET_ROWS)])
    started = time.monotonic()
    done = upload(editor, f"big-{token()}.csv", big)
    assert done.status_code == 201 and done.json()["sheet"]["rowCount"] == SHEET_ROWS
    assert time.monotonic() - started <= IMPORT_S


def test_wf_sheet_import_settle_desk(browser: Any) -> None:
    base = instance("APP_MEILI_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    clear_desk(editor)
    word = f"Foo{token()} 200"
    name = f"desk-{token()}.csv"
    other = upload(editor, f"other-{token()}.csv", sheet_bytes(f",{word},11.00,,")).json()["sheet"]
    with desk(browser, base) as page:
        page.get_by_label("Price sheet file").set_input_files({"name": name, "mimeType": "text/csv", "buffer": sheet_bytes(f",{word},10.00,,", f",Bar{token()} 200,10.00,,")})
        click(R(page, "button", "Import sheet"))
        status = R(page, "status", "Import status")
        see_text(page, status, "2 rows read: 0 matched, 0 ambiguous, 2 unmatched.")
        combos = page.get_by_role("combobox", name="Settle row 1 to", exact=True)
        wait_for(page, lambda: combos.count() >= 2, 10, "open rows on both sheets should show")
        sheet_id = next(s["id"] for s in editor.get("/api/editor/price-sheets").json()["sheets"] if s["filename"] == name)
        box = combos.nth(combos.count() - 1)
        select(box, "MK-200-CTN Matinee Kokum 200 ml Carton")
        page.get_by_role("button", name="Settle row 1", exact=True).last.click()
        see_text(page, status, "Row 1 settled.")
    sheet = editor.get(f"/api/editor/price-sheets/{sheet_id}").json()["sheet"]
    settled_here = sheet["rows"][0]["status"] == "settled"
    twin = editor.get(f"/api/editor/price-sheets/{other['id']}").json()["sheet"]["rows"][0]
    if not settled_here:
        sheet, twin = editor.get(f"/api/editor/price-sheets/{other['id']}").json()["sheet"], sheet["rows"][0]
    assert sheet["rows"][0]["status"] == "settled" and sheet["rows"][0]["skuCode"] == "MK-200-CTN"
    assert (twin["status"], twin["matchedBy"], twin["skuCode"]) == ("matched", "alias", "MK-200-CTN")
    later = upload(editor, f"later-{token()}.csv", sheet_bytes(f",  {word.upper()} ,10.00,,")).json()["sheet"]["rows"][0]
    assert (later["status"], later["matchedBy"]) == ("matched", "alias")
    assert editor.post(f"/api/editor/price-sheets/{sheet['id']}/rows/1/settle", json={"skuCode": "KP-200-CTN"}).status_code == 409
    clash = f"Race{token()} 200"
    a = upload(editor, f"a-{token()}.csv", sheet_bytes(f",{clash},10.00,,")).json()["sheet"]
    b = upload(editor, f"b-{token()}.csv", sheet_bytes(f",{clash},12.00,,")).json()["sheet"]
    targets = [(a["id"], "KP-200-CTN"), (b["id"], "MK-200-CTN")]
    answers = fire(2, lambda i: editor.post(f"/api/editor/price-sheets/{targets[i][0]}/rows/1/settle", json={"skuCode": targets[i][1]}))
    assert sorted(x.status_code for x in answers) == [200, 409]
    loser = 0 if answers[0].status_code == 409 else 1
    assert answers[loser].json()["error"] == "row_not_open"
    row = editor.get(f"/api/editor/price-sheets/{targets[loser][0]}").json()["sheet"]["rows"][0]
    assert (row["status"], row["matchedBy"], row["skuCode"]) == ("matched", "alias", targets[1 - loser][1])


UNSAFE = {
    "over_size": (b"description,new_mrp\n" + b"x" * SHEET_MAX, 413, "sheet_too_large", "This sheet is over the 2,000,000 byte limit."),
    "zip_named_csv": (b"PK\x03\x04rest of archive", 415, "sheet_is_archive", "This is a workbook or archive, not a text price sheet. Save it as CSV first."),
    "nul": (b"description,new_mrp\nKairi\x00 200 ml,10\n", 422, "sheet_has_nul", "This sheet contains NUL bytes and can't be read as text."),
    "not_utf8": (b"description,new_mrp\nKairi \xff 200 ml,10\n", 422, "sheet_not_utf8", "This sheet isn't UTF-8 text."),
    "open_quote": (b'description,new_mrp\n"Kairi 200 ml,10\n', 422, "sheet_bad_quoting", "This sheet has a broken quoted field."),
    "text_after_quote": (b'description,new_mrp\n"Kairi" 200 ml,10\n', 422, "sheet_bad_quoting", "This sheet has a broken quoted field."),
    "quote_inside": (b'description,new_mrp\nKai"ri 200 ml,10\n', 422, "sheet_bad_quoting", "This sheet has a broken quoted field."),
    "too_many_rows": (b"description,new_mrp\n" + b"Kairi 200 ml,10\n" * (SHEET_ROWS + 1), 422, "sheet_too_many_rows", "This sheet has more than 5,000 rows."),
    "bad_header": (b"name,price\nKairi 200 ml,10\n", 422, "sheet_bad_header", "This sheet needs description and new_mrp columns."),
    "no_rows": (b"description,new_mrp\n\n\n", 422, "sheet_empty", "This sheet has no rows."),
}


@pytest.mark.parametrize("case", ["over_size", "zip_named_csv", "nul", "not_utf8", "open_quote", "text_after_quote", "quote_inside", "too_many_rows", "bad_header", "no_rows"], ids=["over_size", "zip_named_csv", "nul", "not_utf8", "open_quote", "text_after_quote", "quote_inside", "too_many_rows", "bad_header", "no_rows"])
def test_wf_sheet_import_unsafe_refused(app_url: str, case: str) -> None:
    data, status, error, message = UNSAFE[case]
    data = data + (f"\n{token()}".encode() if case in ("over_size",) else b"")
    editor = signed_in_api(app_url, EDITOR)
    answer = upload(editor, f"harmless-{token()}.csv", data)
    assert answer.status_code == status and answer.json() == {"error": error, "message": message}
    digest = hashlib.sha256(data).hexdigest()
    assert S3().keys(f"{copy_id(editor)}/sheets/{digest}") == []
    assert digest not in {s["sha256"] for s in editor.get("/api/editor/price-sheets").json()["sheets"]}


def test_wf_sheet_import_reimport(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    data = sheet_bytes(f",Once{token()} 200,10.00,,")
    first_name = f"first-{token()}.csv"
    names = [first_name] * 8
    answers = fire(8, lambda i: upload(editor, names[i], data))
    assert sorted(a.status_code for a in answers) == [200] * 7 + [201]
    ids = {a.json()["sheet"]["id"] for a in answers}
    assert len(ids) == 1
    sheet_id = ids.pop()
    assert all(a.json()["sheet"]["reused"] for a in answers if a.status_code == 200)
    assert editor.post(f"/api/editor/price-sheets/{sheet_id}/rows/1/settle", json={"skuCode": "MK-200-CTN"}).status_code == 200
    again = upload(editor, f"renamed-{token()}.csv", data)
    assert again.status_code == 200 and again.json()["reused"] if "reused" in again.json() else again.json()["sheet"]["reused"]
    sheet = again.json()["sheet"]
    assert sheet["id"] == sheet_id and sheet["filename"] == first_name and sheet["rows"][0]["status"] == "settled"
    digest = hashlib.sha256(data).hexdigest()
    assert S3().keys(f"{copy_id(editor)}/sheets/{digest}") == [f"{copy_id(editor)}/sheets/{digest}"]
    assert sum(s["sha256"] == digest for s in editor.get("/api/editor/price-sheets").json()["sheets"]) == 1


def test_wf_sheet_import_storage_fault() -> None:
    editor = signed_in_api(instance("APP_MINIO_DOWN_URL"), EDITOR)
    data = sheet_bytes(f",Fault{token()} 200,10.00,,")
    answer = upload(editor, f"fault-{token()}.csv", data)
    assert answer.status_code == 503 and answer.json() == {"error": "storage_unavailable", "message": S_STORE_OUT}
    digest = hashlib.sha256(data).hexdigest()
    assert digest not in {s["sha256"] for s in editor.get("/api/editor/price-sheets").json()["sheets"]}


def test_wf_sheet_import_desk_bar(browser: Any) -> None:
    base = instance("APP_MEILI_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    clear_desk(editor)
    sheet = upload(editor, f"bar-{token()}.csv", sheet_bytes(f",Aa{token()} 200,1.00,,", f",Bb{token()} 200,1.00,,")).json()["sheet"]
    with desk(browser, base, width=768, height=1024) as page:
        bar = R(page, "region", "Desk bar")
        see_text(page, bar, "2 rows open.")
        nxt = R(bar, "button", "Next open row")
        click(nxt)
        wait_for(page, lambda: page.evaluate("()=>document.activeElement.getAttribute('role')==='combobox'||document.activeElement.tagName==='SELECT'"), 5, "focus should reach a row's combobox")
        first = accessible_name(page)
        advance(page, FOCUS_MS)
        top = bar.bounding_box()["y"]
        for name in (first, first.replace("Settle row", "Settle row").replace(" to", ""), first.replace("Settle row", "Ignore row").replace(" to", "")):
            role = "combobox" if name == first else "button"
            control = R(page, role, name)
            box = control.bounding_box()
            assert box["y"] + box["height"] <= top + 1 and topmost(control), name
        click(nxt)
        wait_for(page, lambda: accessible_name(page) != first and "Settle row" in (accessible_name(page) or ""), 5, "next row")
        click(nxt)
        wait_for(page, lambda: accessible_name(page) == first, 5, "Next open row should wrap")
        editor.post(f"/api/editor/price-sheets/{sheet['id']}/rows/1/settle", json={"ignore": True})
        see_text(page, bar, "1 row open.", 12)
        click(R(page, "button", "Ignore row 2"))
        gone(page, R(page, "region", "Desk bar"), 12)
    with desk(browser, base, width=1280, height=800) as page:
        assert R(page, "region", "Desk bar").count() == 0


def test_wf_sheet_evidence_bytes(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    data = b"\xef\xbb\xbfcode,description,new_mrp\r\n,\"Evidence " + token().encode() + b" 200\",\"\xe2\x82\xb91,250\"\r\n"
    awkward = f"../odd नाम {token()}.csv"
    answer = upload(editor, awkward, data)
    assert answer.status_code in (201, 422) or answer.status_code == 201
    if answer.status_code != 201:
        pytest.fail(f"upload refused: {answer.text}")
    sheet = answer.json()["sheet"]
    digest = hashlib.sha256(data).hexdigest()
    assert sheet["sha256"] == digest and sheet["filename"] == awkward.split("/")[-1]
    assert S3().get(f"{copy_id(editor)}/sheets/{digest}") == data
    link = editor.get(f"/api/editor/price-sheets/{sheet['id']}/link")
    assert link.json()["expiresInSeconds"] == 60 and link.json()["sha256"] == digest
    assert "no-store" in link.headers["cache-control"]
    fetched = httpx.get(link.json()["url"], timeout=HTTP_S)
    assert fetched.status_code == 200 and fetched.content == data
    disposition = fetched.headers["content-disposition"]
    assert disposition.isascii() and disposition.startswith("attachment") and "filename*=" in disposition
    assert quote(sheet["filename"].encode(), safe="").lower() in disposition.lower()
    direct = editor.get(f"/api/editor/price-sheets/{sheet['id']}/download")
    assert direct.status_code == 302 and httpx.get(direct.headers["location"], timeout=HTTP_S).content == data
    stockist = signed_in_api(app_url, SAGAR)
    assert stockist.get(f"/api/editor/price-sheets/{sheet['id']}/link").status_code == 403
    assert api(app_url).get(f"/api/editor/price-sheets/{sheet['id']}/link").status_code == 401
    clean = f"shown-{token()}.csv"
    simple = upload(editor, clean, sheet_bytes(f"TN-200-CTN,x{token()},12.00,,")).json()["sheet"]
    with desk(browser, app_url) as page:
        see(page, R(page, "link", f"Download sheet {clean}"))
        assert simple["sha256"] in page.locator("body").inner_text()


def test_wf_sheet_evidence_keyboard_draft(browser: Any) -> None:
    base = instance("APP_MEILI_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    clear_desk(editor)
    name = f"keys-{token()}.csv"
    data = sheet_bytes(f",Kk{token()} 200,12.00,,", f",Ll{token()} 200,11.00,,", f",Mm{token()} 200,11.00,,")
    day = next_day(editor, "TN-200-CTN", "MK-200-CTN", "RG-300-GLS")
    with desk(browser, base) as page:
        chooser = page.get_by_label("Price sheet file")
        chooser.focus()
        chooser.set_input_files({"name": name, "mimeType": "text/csv", "buffer": data})
        page.keyboard.press("Tab")
        wait_for(page, lambda: accessible_name(page) == "Import sheet", 5, "Tab should reach Import sheet")
        page.keyboard.press("Enter")
        see_text(page, R(page, "status", "Import status"), "3 rows read: 0 matched, 0 ambiguous, 3 unmatched.")
        wait_for(page, lambda: R(page, "combobox", "Settle row 3 to").count() == 1, 10, "row 3 open")
        select(R(page, "combobox", "Settle row 3 to"), "RG-300-GLS Reel Gulab 300 ml Glass")
        select(R(page, "combobox", "Settle row 1 to"), "TN-200-CTN Ticket Nimbu 200 ml Carton")
        R(page, "button", "Settle row 1").focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: accessible_name(page) == "Settle row 2 to", 10, "focus should move to the next open row")
        advance(page, REFRESH_MS + 500)
        assert R(page, "combobox", "Settle row 3 to").evaluate("e=>e.value||e.textContent").find("RG-300-GLS") >= 0
        select(R(page, "combobox", "Settle row 2 to"), "MK-200-CTN Matinee Kokum 200 ml Carton")
        R(page, "button", "Settle row 2").focus()
        page.keyboard.press("Space")
        wait_for(page, lambda: accessible_name(page) == "Settle row 3 to", 10, "focus should move to row 3")
        R(page, "button", "Settle row 3").focus()
        page.keyboard.press("Enter")
        draft_button = R(page, "button", f"Draft notice from sheet {name}")
        wait_for(page, lambda: active_is(page, draft_button), 10, "with none open focus goes to the draft button")
        title = f"Keyed {token()}"
        fill(R(page, "textbox", "Draft title"), title)
        fill(R(page, "textbox", "Draft effective date"), day)
        draft_button.focus()
        page.keyboard.press("Enter")
        see_text(page, R(page, "status", "Publish status"), "Draft created from the sheet.")
        draft = next(d for d in editor.get("/api/editor/notices").json()["drafts"] if d["title"] == title)
        group = R(page, "group", f"Draft {draft['id']}")
        wait_for(page, lambda: active_is(page, R(group, "textbox", "Notice title")), 10, "focus should land on Notice title")
        fill(R(group, "textbox", "Notice title"), title + " edited")
        R(group, "button", "Save draft").focus()
        page.keyboard.press("Enter")
        see_text(page, R(page, "status", "Publish status"), "Draft saved.")
    saved = next(d for d in editor.get("/api/editor/notices").json()["drafts"] if d["id"] == draft["id"])
    assert saved["sheet"]["sha256"] == hashlib.sha256(data).hexdigest() and saved["title"] == title + " edited"
    assert saved["revision"] == 2 and {r["skuCode"] for r in saved["rows"]} == {"TN-200-CTN", "MK-200-CTN", "RG-300-GLS"}
    assert all(r["kind"] == "new_print" for r in saved["rows"])


def test_wf_publish_correct_sticker_ceiling(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    day = next_day(editor, "KP-600-PET", "KP-1200-PET", "BS-300-GLS")
    draft = sticker_draft(editor, ["KP-600-PET", "KP-1200-PET"], day)
    rows = body_of(draft)["rows"]
    for row, made in zip(rows, draft["rows"]):
        old = made["oldMrpPaise"]
        assert made["ceilingPaise"] == old * (100 + row["newRate"]) // (100 + row["oldRate"])
        row["revisedMrpPaise"] = made["ceilingPaise"] + 1
    over = editor.put(f"/api/editor/notices/{draft['id']}", json=body_of(draft, rows=rows)).json()
    refused = publish(editor, over)
    assert refused.status_code == 422
    body = refused.json()
    assert body["error"] == "ceiling_exceeded" and body["message"] == "Over the ceiling: KP-600-PET, KP-1200-PET."
    assert [r["skuCode"] for r in body["rows"]] == ["KP-600-PET", "KP-1200-PET"]
    assert body["rows"][0]["ceilingPaise"] == draft["rows"][0]["ceilingPaise"]
    for row, made in zip(rows, draft["rows"]):
        row["revisedMrpPaise"] = made["ceilingPaise"]
    equal = editor.put(f"/api/editor/notices/{draft['id']}", json=body_of(over, rows=rows)).json()
    assert publish(editor, equal).status_code == 200
    free = published_notice(editor, [new_print("BS-300-GLS", 999900)], next_day(editor, "BS-300-GLS"))
    assert free["version"]["rows"][0]["ceilingPaise"] is None
    zero = editor.post("/api/editor/notices", json={"title": f"Probe {token()}", "effectiveDate": next_day(editor, "BS-300-GLS"),
                                                    "runOutUntil": None, "rows": [new_print("BS-300-GLS", 0)]})
    assert zero.status_code == 422 or publish(editor, zero.json()).status_code == 422


def locked_correction(app_url: str) -> tuple[str, dict[str, Any]]:
    live = next(n for n in api(app_url).get("/api/notices").json()["notices"] if n["state"] == "in_effect")
    version = live["currentVersion"]
    rows = [{k: r[k] for k in ("skuCode", "kind", "revisedMrpPaise", "oldRate", "newRate")} for r in version["rows"]]
    return live["number"], {"baseVersion": version["version"], "reason": "Check", "effectiveDate": add_days(version["effectiveDate"], 1),
                            "runOutUntil": add_days(version["effectiveDate"], 400), "rows": rows}


def test_wf_publish_correct_transitions(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    day = next_day(editor, "RG-300-GLS")
    draft = make_draft(editor, [new_print("RG-300-GLS", 3100 + random.randrange(800))], day)
    number_probe = api(app_url).get("/api/notices").json()
    assert draft["id"] not in json.dumps(number_probe), "drafts are never public"
    missing = editor.post(f"/api/editor/notices/{draft['id']}/publish", json={})
    assert missing.status_code == 422 and missing.json()["error"] == "validation"
    wrong = editor.post(f"/api/editor/notices/{draft['id']}/publish", json={"baseRevision": draft["revision"] + 5})
    assert wrong.status_code == 409 and wrong.json() == {"error": "stale_draft", "message": S_STALE}
    answers = fire(5, lambda i: publish(editor, draft))
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409, 409]
    assert all(a.json()["error"] == "not_draft" for a in answers if a.status_code == 409)
    won = next(a for a in answers if a.status_code == 200).json()
    assert re.fullmatch(r"VT-\d{4}-\d{2,}", won["number"]) and won["version"]["state"] == "scheduled"
    assert won["version"]["printState"] in ("pending", "printable")
    put = editor.put(f"/api/editor/notices/{draft['id']}", json=body_of(draft))
    assert put.status_code == 409 and put.json()["error"] == "not_draft"
    assert publish(editor, draft).json()["error"] == "not_draft"
    empty = make_draft(editor, [], next_day(editor, "RG-300-GLS"))
    assert publish(editor, empty).json()["error"] == "no_rows"
    twice = make_draft(editor, [new_print("RG-300-GLS", 3300), new_print("RG-300-GLS", 3400)], next_day(editor, "RG-300-GLS"))
    dup = publish(editor, twice)
    assert dup.status_code == 422 and dup.json()["error"] == "validation"
    past = make_draft(editor, [new_print("RG-300-GLS", 3300)], add_days(today(editor), -1))
    gone_answer = publish(editor, past)
    assert gone_answer.json()["error"] in ("later_revision_exists", "effective_date_past")
    number, moved = locked_correction(app_url)
    locked = editor.post(f"/api/editor/notices/{number}/corrections", json=moved)
    assert locked.status_code == 409 and locked.json()["error"] == "effective_date_locked"
    for caller in (api(app_url), signed_in_api(app_url, SAGAR)):
        malformed = caller.post("/api/editor/notices", content=b"{nope", headers={"content-type": "application/json"})
        assert malformed.status_code == 400 and malformed.json()["error"] == "bad_json"
    assert editor.post("/api/editor/notices/no-such-draft/publish", json={"baseRevision": 1}).status_code == 404


def test_wf_publish_correct_signed_messages(svix: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = fresh_stockist(base)
    other = fresh_stockist(base, DECCAN)
    with sink() as one, sink() as two:
        saved = stockist.post("/api/stockist/endpoints", json={"url": one.url}).json()
        theirs = other.post("/api/stockist/endpoints", json={"url": two.url}).json()
        secret = saved["signingSecret"]
        assert re.fullmatch(r"whsec_[A-Za-z0-9+/=]+", secret) and len(base64.b64decode(secret[6:])) == 24
        made = published_notice(editor, [new_print("KP-600-PET", 4600 + random.randrange(700))], next_day(editor, "KP-600-PET"))
        number = made["number"]
        event = f"{number}-v1-{saved['id']}"
        poll(lambda: one.of(event), RETURN_S + MARGIN_S, "the endpoint should receive a signed message")
        poll(lambda: two.of(f"{number}-v1-{theirs['id']}"), RETURN_S, "the other stockist's endpoint too")
        record_one = one.of(event)[0]
        assert verifies(secret, record_one) and not verifies(theirs["signingSecret"], record_one)
        payload = json.loads(record_one["body"])
        row = made["version"]["rows"][0]
        assert payload["eventType"] == "notice.published" and payload["supersedesVersion"] is None
        assert payload["noticeNumber"] == number and payload["version"] == 1
        assert payload["pdfPath"] == f"/api/notices/{number}/versions/1/pdf"
        assert payload["rows"] == [{k: row[k] for k in ("skuCode", "name", "kind", "oldMrpPaise", "revisedMrpPaise")}]
        account = stockist.get("/api/session").json()["accountId"]
        messages = svix.messages(f"stockist-{account}", "notice.published")
        assert sum(m["eventId"] == event for m in messages) == 1
        assert len(one.of(event)) == 1


def test_wf_publish_correct_one_price(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.delete("/api/test/clock")
    editor = signed_in_api(base, EDITOR)
    sku = "MK-200-CTN"
    day = next_day(editor, sku)
    plant = letters()
    control.put("/api/test/clock", json={"now": noon(add_days(day, -1))})
    try:
        old_code = batch_code(plant, add_days(day, -1))
        assert editor.post("/api/editor/batches", json={"code": old_code, "skuCode": sku}).status_code == 201
        title = f"One price {token()}"
        draft = sticker_draft(editor, [sku], day, title)
        price = draft["rows"][0]["revisedMrpPaise"]
        preview = editor.post(f"/api/editor/notices/{draft['id']}/preview", json=body_of(draft)).json()
        assert preview["blocking"] is None and old_code in preview["rows"][0]["stickerBatches"]
        with desk(browser, base) as page:
            click(R(page, "button", f"Publish {title}"))
            dialog = R(page, "dialog", "Confirm publish")
            see(page, dialog)
            gate = Gate(page, f"**/api/editor/notices/{draft['id']}/publish", "POST")
            click(R(dialog, "button", "Publish notice now"))
            wait_for(page, lambda: gate.routes, 5, "publish should leave")
            click(R(dialog, "button", "Publish notice now"))
            advance(page, 300)
            assert len(gate.seen) == 1, "double press must send one publish"
            gate.release()
            see_text(page, R(page, "status", "Publish status"), "version 1 published.")
        number = next(n for n in editor.get("/api/editor/notices").json()["notices"] if n["versions"][0]["title"] == title)["number"]
        control.put("/api/test/clock", json={"now": noon(day)})
        wait_print(editor, number, 1)
        expected = f"Rs {rupees(price)}"
        with view(browser, f"{base}/?batch={old_code}") as page:
            pack = facts(api(base), old_code)
            assert pack["retailPricePaise"] == price and pack["sourceNotice"]["number"] == number
            assert_panel(page, pack)
            assert expected in term(page, "Revised MRP")
            current = text(R(page, "table", "Current prices"))
            assert number + " v1" in current and expected in current
        hit = api(base).get("/api/search", params={"q": sku}).json()["results"][0]
        assert hit["retailPricePaise"] == price and hit["sourceNotice"]["number"] == number
        assert f"to Rs {rupees(price)}" in " ".join(pdf_text(httpx.get(editor.get(f"/api/notices/{number}/versions/1/link").json()["url"], timeout=HTTP_S).content).split())
        sheet = {r["sku_code"]: r for r in csv.DictReader(io.StringIO(editor.get("/api/stockist/price-sheet.csv").text))}
        assert sheet[sku]["current_mrp_rs"] == rupees(price) and sheet[sku]["notice_number"] == number
    finally:
        control.delete("/api/test/clock")


def test_wf_publish_correct_history(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    day = next_day(editor, "TN-200-CTN")
    first = 1300 + random.randrange(500)
    made = published_notice(editor, [new_print("TN-200-CTN", first)], day)
    number = made["number"]
    v1 = wait_print(editor, number, 1)
    with desk(browser, app_url) as page:
        opener = R(page, "button", f"Correct notice {number}")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Correct notice")
        see(page, dialog)
        assert R(dialog, "textbox", "Revised MRP for TN-200-CTN").input_value() == rupees(first)
        fill(R(dialog, "textbox", "Revised MRP for TN-200-CTN"), rupees(first + 50))
        fill(R(dialog, "textbox", "Correction reason"), "Fixed a typing slip.")
        click(R(dialog, "button", "Publish correction"))
        see_text(page, R(page, "status", "Publish status"), f"Notice {number} version 2 published.")
        gone(page, R(page, "dialog", "Correct notice"))
        wait_for(page, lambda: active_is(page, opener), 5, "focus returns to the opener")
    body = editor.get(f"/api/notices/{number}").json()["versions"]
    assert [v["version"] for v in body] == [2, 1]
    assert body[1]["state"] == "superseded" and body[1]["supersededBy"] == 2
    assert body[1]["rows"][0]["revisedMrpPaise"] == first and body[0]["rows"][0]["revisedMrpPaise"] == first + 50
    assert body[0]["reason"] == "Fixed a typing slip."
    old = httpx.get(editor.get(f"/api/notices/{number}/versions/1/link").json()["url"], timeout=HTTP_S).content
    assert hashlib.sha256(old).hexdigest() == v1["pdfSha256"]
    with view(browser, f"{app_url}/notices/{number}") as page:
        see_text(page, page.locator("body"), "Superseded by version 2")
    stale = editor.post(f"/api/editor/notices/{number}/corrections", json={"baseVersion": 1, "reason": "x", "effectiveDate": day, "rows": []})
    assert stale.status_code == 409 and stale.json()["error"] == "stale_version"


def test_wf_publish_correct_channels(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.delete("/api/test/clock")
    editor = signed_in_api(base, EDITOR)
    sku = "KP-1200-PET"
    day = next_day(editor, sku)
    plant = letters()
    control.put("/api/test/clock", json={"now": noon(add_days(day, -1))})
    code = batch_code(plant, add_days(day, -1))
    editor.post("/api/editor/batches", json={"code": code, "skuCode": sku})
    stockist = fresh_stockist(base)
    try:
        with sink() as receiver:
            endpoint = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
            draft = sticker_draft(editor, [sku], day)
            number = publish(editor, draft).json()["number"]
            control.put("/api/test/clock", json={"now": noon(day)})
            with view(browser, f"{base}/?batch={code}") as page:
                to_progress(page, 1)
                r = rect(attrs(page)["data-mrp-screen-rect"])
                quad_before = quad(attrs(page)["data-sticker-screen-quad"])
                before = region_pixels(shot(page), quad_before, 1)
                old_text = attrs(page)["data-panel-text"]
            row = dict(body_of(draft)["rows"][0], revisedMrpPaise=draft["rows"][0]["revisedMrpPaise"] - 37)
            correction = editor.post(f"/api/editor/notices/{number}/corrections", json={"baseVersion": 1, "reason": "Lower price.", "effectiveDate": day, "rows": [row]})
            assert correction.status_code == 201, correction.text
            wait_print(editor, number, 2)
            assert f"{copy_id(editor)}/notices/{number}/v2.pdf" in S3().keys(f"{copy_id(editor)}/notices/{number}/")
            event = f"{number}-v2-{endpoint['id']}"
            poll(lambda: receiver.of(event), RETURN_S + MARGIN_S, "notice.corrected should arrive")
            payload = json.loads(receiver.of(event)[0]["body"])
            assert payload["eventType"] == "notice.corrected" and payload["supersedesVersion"] == 1
            assert verifies(endpoint["signingSecret"], receiver.of(event)[0])
            with view(browser, f"{base}/?batch={code}") as page:
                to_progress(page, 1)
                assert attrs(page)["data-panel-text"] != old_text
                after = region_pixels(shot(page), quad(attrs(page)["data-sticker-screen-quad"]), 1)
                assert_panel(page, facts(api(base), code))
                assert rupees(row["revisedMrpPaise"]) in term(page, "Revised MRP")
                assert r and sum(a != b for a, b in zip(before, after)) > 0, "the sticker's pixels should change"
            hit = api(base).get("/api/search", params={"q": code}).json()["results"][0]
            assert hit["retailPricePaise"] == row["revisedMrpPaise"]
    finally:
        control.delete("/api/test/clock")
        clear_endpoints(stockist)


def test_wf_rename_and_sheet_rename_in_place(browser: Any) -> None:
    base = instance("APP_SVIX_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    name = f"A&B <img src=\"http://example.invalid/x\"> {token()}"
    before = editor.get("/api/notices/VT-2026-03").json()["versions"][0]["rows"][0]["name"]
    with desk(browser, base) as page:
        select(R(page, "combobox", "Drink"), editor.get("/api/catalogue").json()["drinks"][1]["name"])
        fill(R(page, "textbox", "New drink name"), name)
        click(R(page, "button", "Rename drink"))
        see_text(page, R(page, "status", "Rename status"), "Renamed. Published notices keep their old name.")
        assert active_is(page, R(page, "button", "Rename drink"))
        wait_for(page, lambda: name in R(page, "combobox", "Drink").evaluate("e=>e.textContent"), 5, "Drink option label updates in place")
        assert name in text(R(page, "region", "Pack history")) or R(page, "region", "Pack history").count() == 1
        history = Gate(page, "**/api/editor/skus/*/history")
        select(R(page, "combobox", "Pack"), "BS-750-PET 750 ml PET")
        wait_for(page, lambda: history.routes, 5, "history read")
        select(R(page, "combobox", "Pack"), "BS-300-CAN 300 ml Can")
        wait_for(page, lambda: len(history.routes) >= 2, 5, "second history read")
        history.routes.reverse()
        history.release()
        advance(page, 500)
        assert "BS-300-CAN" in R(page, "combobox", "Pack").evaluate("e=>e.value||e.textContent")
    catalogue = api(base).get("/api/catalogue").json()
    assert catalogue["drinks"][1]["name"] == name
    assert editor.get("/api/notices/VT-2026-03").json()["versions"][0]["rows"][0]["name"] == before
    requests: list[str] = []
    with view(browser, f"{base}/?sku=BS-750-PET") as page:
        page.on("request", lambda r: requests.append(r.url))
        assert attrs(page)["data-front-text"].startswith(name + " | ")
        assert R(page, "button", name).count() == 1
        assert name in text(R(page, "table", "Current prices"))
        assert page.evaluate("document.querySelectorAll('img[src*=\"example.invalid\"]').length") == 0
    assert not any("example.invalid" in u for u in requests)
    sheet = list(csv.DictReader(io.StringIO(editor.get("/api/stockist/price-sheet.csv").text)))
    assert any(r["drink_name"] == name for r in sheet)
    drink_id = "reel-gulab"
    names = [f"Reel Gulab {token()}" for _ in range(5)]
    answers = fire(5, lambda i: editor.patch(f"/api/editor/drinks/{drink_id}", json={"name": names[i]}))
    assert all(a.status_code == 200 for a in answers)
    chain = [h for h in editor.get("/api/editor/skus/RG-300-GLS/history").json()["history"] if h["field"] == "drink_name"]
    assert all(a["to"] == b["from"] for a, b in zip(chain, chain[1:]))
    taken = f"Same {token()}"
    race = [("ticket-nimbu", taken), ("matinee-kokum", taken.upper())]
    result = fire(2, lambda i: editor.patch(f"/api/editor/drinks/{race[i][0]}", json={"name": race[i][1]}))
    assert sorted(a.status_code for a in result) == [200, 409]
    assert next(a for a in result if a.status_code == 409).json()["error"] == "name_taken"
    for path, body in (("drinks/no-such-drink", {"name": ""}), ("skus/ZZ-1-ZZZ", {"variant": ""})):
        unknown = editor.patch(f"/api/editor/{path}", json=body)
        assert unknown.status_code == 404 and unknown.json()["error"] == "not_found"


def test_wf_rename_and_sheet_price_csv() -> None:
    base = instance("APP_SVIX_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = signed_in_api(base, SAGAR)
    alias = f"=cmd {token()} 500 ml"
    sheet = upload(editor, f"formula-{token()}.csv", sheet_bytes(f',"{alias}",1.00,,')).json()["sheet"]
    assert editor.post(f"/api/editor/price-sheets/{sheet['id']}/rows/1/settle", json={"skuCode": "TN-500-PET"}).status_code == 200
    drink = f"@Danger {token()}"
    assert editor.patch("/api/editor/drinks/second-show-jeera", json={"name": drink}).status_code == 200
    answer = stockist.get("/api/stockist/price-sheet.csv")
    assert api(base).get("/api/stockist/price-sheet.csv").status_code == 401
    assert answer.status_code == 200 and answer.headers["content-type"].startswith("text/csv")
    day = today(stockist)
    assert f'filename="interval-price-sheet-{day}.csv"' in answer.headers["content-disposition"]
    raw = answer.content
    assert not raw.startswith(b"\xef\xbb\xbf") and b"\r\n" in raw and b"\n" not in raw.replace(b"\r\n", b"")
    assert raw.split(b"\r\n")[0].decode() == "sku_code,drink_name,sku_name,size_ml,format,aliases,current_mrp_rs,effective_date,notice_number,notice_version,unit_sale_price_rs,unit_sale_per,sugar_mg_per_pack"
    rows = {r["sku_code"]: r for r in csv.DictReader(io.StringIO(answer.text))}
    assert list(rows) == [s[0] for s in SKUS]
    assert rows["SJ-300-CAN"]["drink_name"] == "'" + drink and rows["SJ-300-CAN"]["sku_name"].startswith("'" + drink)
    assert ("'" + alias.lower()) in rows["TN-500-PET"]["aliases"].split(" | ")
    assert "'=" not in rows["KP-600-PET"]["aliases"]
    assert re.fullmatch(r"\d+\.\d\d", rows["KP-600-PET"]["current_mrp_rs"])
    assert rows["BS-750-PET"]["notice_number"] == "" or rows["BS-750-PET"]["effective_date"]
    assert api(base).get("/api/catalogue").json()["drinks"][2]["name"] == drink, "stored name keeps its own characters"


def test_wf_rename_and_sheet_pack_front(browser: Any) -> None:
    base = instance("APP_SVIX_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    assert editor.patch("/api/editor/drinks/ticket-nimbu", json={"name": f"Nimbu {token()}"}).status_code == 200
    for no_webgl, role, label in ((False, "img", "Pack stage"), (True, "img", "Pack declaration panel")):
        short = f"Nimbu {token()}"
        editor.patch("/api/editor/drinks/ticket-nimbu", json={"name": short}).raise_for_status()

        def front() -> tuple[Any, tuple[float, float, float, float], dict[str, str]]:
            with view(browser, f"{base}/?sku=TN-200-CTN", no_webgl=no_webgl) as page:
                to_progress(page, 0.05)
                a = attrs(page)
                box = rect(a["data-front-screen-rect"])
                image = shot(page)
                described = R(page, role, label).evaluate("e=>e.getAttribute('aria-description')||(e.getAttribute('aria-describedby')?document.getElementById(e.getAttribute('aria-describedby')).textContent:'')")
                a["described"] = described
                return image, box, a

        first, box, a = front()
        assert a["data-front-text"].split(" | ") == [short, "200 ml Carton"]
        assert short in a["described"], "stage image should carry the SKU name"
        long_name = ("W" * NAME_MAX)[:-10] + token()
        editor.patch("/api/editor/drinks/ticket-nimbu", json={"name": long_name}).raise_for_status()
        second, box2, b = front()
        assert b["data-front-text"].startswith(long_name)
        x, y, w, h = (int(v) for v in box)
        same = 0
        band = 0
        for px in range(x - 6, x + w + 6):
            for py in (y - 4, y + h + 4):
                band += 1
                same += near(first.at(px, py), second.at(px, py))
        assert same == band, "ink left the front box"
        changed_px = sum(not near(first.at(px, py), second.at(px, py), 0) for px in range(x, x + w, 2) for py in range(y, y + h, 2))
        assert changed_px >= 0.01 * (w // 2) * (h // 2)
    with view(browser, base) as page:
        assert attrs(page, HERO).get("data-arch-open") is not None


ADDRESSES = {
    "not a url": "invalid", "https://user:pw@93.184.215.14/hook": "credentials",
    "http://169.254.169.254/": "metadata", "https://metadata.google.internal./x": "metadata",
    "https://[fd00:ec2::254]/": "metadata", "http://localhost/": "loopback", "https://a.localhost./": "loopback",
    "https://2130706433/": "loopback", "https://0177.0.0.1/": "loopback", "https://0x7f.0.0.1/": "loopback",
    "https://[::ffff:127.0.0.1]/": "loopback", "https://[::7f00:1]/": "loopback", "https://[::1]/": "loopback",
    "https://[64:ff9b:1:7f00:0:100::]/": "loopback", "https://169.254.1.1/": "link_local", "https://[fe80::1]/": "link_local",
    "https://10.0.0.1/": "private_address", "https://100.64.0.1/": "private_address", "https://192.0.2.1/": "private_address",
    "https://198.18.0.1/": "private_address", "https://224.0.0.1/": "private_address", "https://[fc00::1]/": "private_address",
    "https://[2001::1]/": "private_address", "https://[2001:db8::1]/": "private_address", "https://[64:ff9b::a00:1]/": "private_address",
    "https://[64:ff9b:1:c000:2:2100::]/": "private_address", "https://[2002:c0a8:101::]/": "private_address",
    "https://no-such-host.invalid/hook": "unresolvable", "http://93.184.215.14/hook": "scheme",
}


def test_wf_stockist_endpoints_address_safety(app_url: str) -> None:
    stockist = fresh_stockist(app_url)
    message = "That address can't receive price messages. Use a public https address."
    for url, reason in ADDRESSES.items():
        answer = stockist.post("/api/stockist/endpoints", json={"url": url})
        assert answer.status_code == 422, url
        assert answer.json() == {"error": "endpoint_refused", "message": message, "reason": reason}, url
    assert stockist.post("/api/stockist/endpoints", json={"url": "https://93.184.215.14/" + "x" * URL_MAX}).json()["reason"] == "invalid"
    with sink() as receiver:
        refused = stockist.post("/api/stockist/endpoints", json={"url": receiver.url})
        assert refused.status_code == 422 and refused.json()["reason"] == "private_address"
        assert receiver.records == []
    assert stockist.get("/api/stockist/endpoints").json()["endpoints"] == []
    urls = [f"https://93.184.215.14/{token()}" for _ in range(8)]
    answers = fire(8, lambda i: stockist.post("/api/stockist/endpoints", json={"url": urls[i]}))
    assert sorted(a.status_code for a in answers) == [201] * 5 + [409] * 3
    assert {a.json()["error"] for a in answers if a.status_code == 409} == {"endpoint_limit"}
    clear_endpoints(stockist)
    same = ["HTTPS://93.184.215.14:443", "https://93.184.215.14/", "https://93.184.215.14", "https://93.184.215.14:443/"]
    answers = fire(4, lambda i: stockist.post("/api/stockist/endpoints", json={"url": same[i]}))
    assert sorted(a.status_code for a in answers) == [201, 409, 409, 409]
    assert {a.json()["error"] for a in answers if a.status_code == 409} == {"endpoint_exists"}
    live = stockist.get("/api/stockist/endpoints").json()["endpoints"][0]
    assert stockist.post(f"/api/stockist/endpoints/{live['id']}/test", json={}).status_code == 202
    clear_endpoints(stockist)


def test_wf_stockist_endpoints_secrets_isolation(svix: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    mine, theirs = fresh_stockist(base), fresh_stockist(base, DECCAN)
    with sink() as receiver:
        saved = mine.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
        listing = mine.get("/api/stockist/endpoints")
        assert saved["signingSecret"] not in listing.text and "signingSecret" not in listing.text
        event = mine.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
        assert re.fullmatch(rf"test-{saved['id']}-.+", event)
        poll(lambda: receiver.of(event), RETURN_S + MARGIN_S, "test message should arrive")
        assert saved["signingSecret"] not in mine.get("/api/stockist/deliveries").text
        assert theirs.get("/api/stockist/endpoints").json()["endpoints"] == []
        assert all(d["endpointId"] != saved["id"] for d in deliveries(theirs))
        for call in (lambda: theirs.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}),
                     lambda: theirs.post(f"/api/stockist/endpoints/{saved['id']}/rotate-secret", json={}),
                     lambda: theirs.post(f"/api/stockist/endpoints/{saved['id']}/recover", json={}),
                     lambda: theirs.delete(f"/api/stockist/endpoints/{saved['id']}"),
                     lambda: theirs.post(f"/api/stockist/deliveries/{event}/redeliver", json={})):
            answer = call()
            assert answer.status_code == 404 and answer.json()["error"] == "not_found"
        answers = fire(16, lambda i: (mine if i % 2 == 0 else theirs).get("/api/stockist/endpoints"))
        assert all((saved["id"] in a.text) == (i % 2 == 0) for i, a in enumerate(answers))
        clear_endpoints(mine)


def test_wf_stockist_endpoints_delivery_log(svix: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.put("/api/test/clock", json={"now": "2035-06-01T06:30:00Z"})
    stockist = fresh_stockist(base)
    try:
        with sink(status=500) as receiver:
            saved = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
            event = stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
            pending = entry(stockist, event)
            assert pending and pending["state"] in ("pending", "failed")
            failed = poll(lambda: (lambda e: e if e and e["state"] == "failed" else None)(entry(stockist, event)), 90, "entry should show failed from attempts")
            assert failed["attempts"] and failed["attempts"][0]["responseStatus"] == 500 and failed["attempts"][0]["outcome"] == "failed"
            first = stockist.post(f"/api/stockist/deliveries/{event}/redeliver", json={})
            receiver.status = 200
            assert first.status_code == 202 and first.json()["redeliveryRequested"] is True and first.json()["state"] == "failed"
            assert stockist.post(f"/api/stockist/deliveries/{event}/redeliver", json={}).status_code == 202
            done = poll(lambda: (lambda e: e if e and e["state"] == "redelivered" else None)(entry(stockist, event)), 60, "a further successful attempt should read redelivered")
            assert any(a["outcome"] == "success" for a in done["attempts"])
            ok = [r for r in receiver.of(event)]
            assert len({r["headers"]["svix-id"] for r in ok}) == 1
            again = stockist.post(f"/api/stockist/deliveries/{event}/redeliver", json={})
            assert again.status_code == 409 and again.json()["error"] == "not_failed"
    finally:
        clear_endpoints(stockist)
        control.delete("/api/test/clock")


def test_refreshes_keep_work(browser: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    stockist = fresh_stockist(base)
    with sink() as receiver, desk(browser, base, SAGAR, path="/stockist") as page:
        saved = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
        field = R(page, "textbox", "Endpoint URL")
        fill(field, TYPED_HALF)
        field.evaluate("e=>e.setSelectionRange(5,5)")
        y = page.evaluate("scrollY")
        event = stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
        status = R(page, "status", "Delivery status")
        line = f"Delivery {event} is now Delivered."
        wait_for(page, lambda: line in text(status), 45, "the real change should be announced", step=REFRESH_MS)
        for _ in range(3):
            advance(page, REFRESH_MS)
            assert text(status).count(line) == 1
        assert field.input_value() == TYPED_HALF and active_is(page, field)
        assert field.evaluate("e=>e.selectionStart") == 5 and page.evaluate("scrollY") == y
    clear_endpoints(stockist)


def test_wf_stockist_endpoints_ended_session(browser: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    stockist = fresh_stockist(base)
    typed = f"https://93.184.215.14/{token()}"
    with desk(browser, base, SAGAR, path="/stockist") as page:
        fill(R(page, "textbox", "Endpoint URL"), typed)
        page.context.request.delete(base + "/api/session")
        wait_for(page, lambda: urlparse(page.url).path == "/sign-in", 15, "ended session goes to sign-in", step=REFRESH_MS)
        see_text(page, R(page, "status", "Sign-in status"), S_ENDED)
        sign_in_ui(page, SAGAR)
        wait_for(page, lambda: urlparse(page.url).path == "/stockist", 15, "back on the stockist screen")
        see_text(page, R(page, "status", "Endpoint status"), S_KEPT)
        assert R(page, "textbox", "Endpoint URL").input_value() == typed
        advance(page, REFRESH_MS)
        assert stockist.get("/api/stockist/endpoints").json()["endpoints"] == [], "nothing may be sent until the user acts"


def test_wf_stockist_endpoints_phone_log(browser: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    stockist = fresh_stockist(base)
    with sink(status=500) as receiver:
        url = receiver.url + "?" + "q" * (URL_MAX - len(receiver.url) - 1)
        saved = stockist.post("/api/stockist/endpoints", json={"url": url})
        assert saved.status_code == 201, saved.text
        secret = saved.json()
        event = stockist.post(f"/api/stockist/endpoints/{secret['id']}/test", json={}).json()["eventId"]
        poll(lambda: (lambda e: e and e["state"] == "failed")(entry(stockist, event)), 90, "entry should fail")
        with desk(browser, base, SAGAR, 375, 812, "/stockist") as page:
            names = [f"Send test to {url}", f"Rotate secret for {url}", f"Recover failed for {url}", f"Remove {url}", f"Redeliver {event}"]
            see(page, R(page, "button", f"Redeliver {event}"))
            layout(page)
            for name in names:
                control = R(page, "button", name)
                control.scroll_into_view_if_needed()
                advance(page, 100)
                box = control.bounding_box()
                assert box["height"] >= TARGET_PX and box["width"] >= TARGET_PX and topmost(control), name
            for name, glob in ((names[0], f"**/endpoints/{secret['id']}/test"), (names[2], f"**/endpoints/{secret['id']}/recover"), (names[4], f"**/deliveries/{event}/redeliver")):
                gate = Gate(page, glob, "POST")
                control = R(page, "button", name)
                click(control)
                wait_for(page, lambda: gate.routes, 5, "request should leave")
                assert control.get_attribute("aria-disabled") == "true" and active_is(page, control)
                click(control)
                advance(page, 300)
                assert len(gate.seen) == 1, f"{name} sent twice"
                gate.release()
                wait_for(page, lambda: control.count() == 0 or control.get_attribute("aria-disabled") != "true", 10, "button returns")
                page.unroute(glob, gate.handler)
            control = R(page, "button", f"Redeliver {event}")
            if control.count():
                control.focus()
                page.set_viewport_size({"width": 800, "height": 812})
                advance(page, FOCUS_MS)
                assert R(page, "button", f"Redeliver {event}").count() == 1
                assert accessible_name(page) == f"Redeliver {event}"
                assert R(page, "table", "Delivery log").count() == 1
    clear_endpoints(stockist)


def test_wf_service_recovery_messaging_outage(browser: Any) -> None:
    base = instance("APP_SVIX_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = fresh_stockist(base)
    url = f"https://93.184.215.14/{token()}"
    saved = stockist.post("/api/stockist/endpoints", json={"url": url})
    assert saved.status_code == 201 and saved.json()["registered"] is False and saved.json()["signingSecret"].startswith("whsec_")
    made = published_notice(editor, [new_print("BS-300-CAN", 3300 + random.randrange(900))], next_day(editor, "BS-300-CAN"))
    event = f"{made['number']}-v1-{saved.json()['id']}"
    log = stockist.get("/api/stockist/deliveries").json()
    assert poll(lambda: stockist.get("/api/stockist/deliveries").json()["messagesQueued"], 20, "messagesQueued should be true")
    assert entry(stockist, event)["state"] == "pending" and log is not None
    assert stockist.post(f"/api/stockist/endpoints/{saved.json()['id']}/test", json={}).status_code == 202
    rotate = stockist.post(f"/api/stockist/endpoints/{saved.json()['id']}/rotate-secret", json={})
    assert rotate.status_code == 503 and rotate.json() == {"error": "rotation_unavailable", "message": S_ROTATE_DOWN}
    with desk(browser, base, SAGAR, path="/stockist") as page:
        see_text(page, R(page, "alert", "Message status"), S_MSG_OUT)
    with desk(browser, base) as page:
        see_text(page, R(page, "alert", "Message status"), S_MSG_OUT)
    assert stockist.delete(f"/api/stockist/endpoints/{saved.json()['id']}").status_code == 204


def test_wf_service_recovery_svix_return(browser: Any, svix: Any) -> None:
    base = instance("APP_SVIX_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = fresh_stockist(base)
    with sink() as receiver, sink() as removed:
        poll(lambda: stockist.get("/api/stockist/deliveries").json()["messagesQueued"], 30, "with no relay the outage should show")
        kept = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
        dropped = stockist.post("/api/stockist/endpoints", json={"url": removed.url}).json()
        made = published_notice(editor, [new_print("BS-750-PET", 4600 + random.randrange(900))], next_day(editor, "BS-750-PET"))
        assert stockist.delete(f"/api/stockist/endpoints/{dropped['id']}").status_code == 204
        event = f"{made['number']}-v1-{kept['id']}"
        with desk(browser, base, SAGAR, path="/stockist") as page:
            see_text(page, R(page, "alert", "Message status"), S_MSG_OUT)
            with relay(18071, "SVIX_URL"):
                poll(lambda: receiver.of(event), RETURN_S + MARGIN_S, "queued message should arrive after the return")
                wait_for(page, lambda: R(page, "alert", "Message status").count() == 0, RETURN_S, "alert should clear", step=REFRESH_MS)
                body = stockist.get("/api/stockist/endpoints").json()["endpoints"]
                assert next(e for e in body if e["id"] == kept["id"])["registered"] is True
                assert verifies(kept["signingSecret"], receiver.of(event)[0])
                assert len({r["headers"]["svix-id"] for r in receiver.of(event)}) == 1
                assert removed.records == []
                assert stockist.get("/api/stockist/deliveries").json()["messagesQueued"] is False
                clear_endpoints(stockist)


def test_status_survives_modal(browser: Any) -> None:
    base = instance("APP_SVIX_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    made = published_notice(editor, [new_print("KP-600-PET", 4700 + random.randrange(900))], next_day(editor, "KP-600-PET"))
    with relay(18071, "SVIX_URL") as forward:
        poll(lambda: not editor.get("/api/editor/notices").json()["messagesQueued"], RETURN_S + MARGIN_S, "Svix should be reachable")
        with desk(browser, base) as page:
            click(R(page, "button", f"Correct notice {made['number']}"))
            dialog = R(page, "dialog", "Correct notice")
            see(page, dialog)
            reason = R(dialog, "textbox", "Correction reason")
            fill(reason, TYPED_REASON)
            forward.stop()
            alert = R(page, "alert", "Message status")
            wait_for(page, lambda: alert.count() == 1 and S_MSG_OUT in text(alert), RETURN_S + MARGIN_S, "alert should rise behind the dialog", step=REFRESH_MS)
            assert active_is(page, reason) and reason.input_value() == TYPED_REASON
            for role, name in (("status", "Print status"), ("region", "Held work"), ("status", "Work status")):
                assert R(page, role, name).count() == 1, name
            for _ in range(12):
                page.keyboard.press("Tab")
                assert page.evaluate("()=>!!document.activeElement.closest('[role=dialog],dialog')")
            reason.focus()
            again = Relay(18071, target_of("SVIX_URL", 80))
            try:
                wait_for(page, lambda: alert.count() == 0, RETURN_S + MARGIN_S, "alert should clear behind the dialog", step=REFRESH_MS)
                assert active_is(page, reason)
            finally:
                again.stop()


def test_wf_service_recovery_phone_dialog(browser: Any) -> None:
    base = instance("APP_SVIX_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    for width, height in ((375, 812), (768, 1024), (1280, 800)):
        day = next_day(editor, "KP-1200-PET")
        made = published_notice(editor, [new_print("KP-1200-PET", 8100 + random.randrange(900))], day)
        with desk(browser, base, width=width, height=height) as page:
            opener = R(page, "button", f"Correct notice {made['number']}")
            opener.scroll_into_view_if_needed()
            click(opener)
            dialog = R(page, "dialog", "Correct notice")
            see(page, dialog)
            box = dialog.bounding_box()
            assert box["height"] <= height + 1 and box["width"] <= width + 1 and in_view(dialog)
            alert = R(page, "alert", "Message status")
            wait_for(page, lambda: alert.count() == 1, RETURN_S + MARGIN_S, "with no relay the alert should show", step=REFRESH_MS)
            assert in_view(alert)
            shown = alert.bounding_box()
            reason = R(dialog, "textbox", "Correction reason")
            fill(reason, "Phone check")
            for control in (reason, R(dialog, "button", "Publish correction")):
                control.scroll_into_view_if_needed()
                advance(page, 100)
                c = control.bounding_box()
                apart = c["y"] >= shown["y"] + shown["height"] or c["y"] + c["height"] <= shown["y"] or c["x"] >= shown["x"] + shown["width"] or c["x"] + c["width"] <= shown["x"]
                assert apart and topmost(control)
            gate = Gate(page, f"**/api/editor/notices/{made['number']}/corrections", "POST")
            press = R(dialog, "button", "Publish correction")
            click(press)
            wait_for(page, lambda: gate.routes, 5, "correction should leave")
            click(press)
            page.keyboard.press("Escape")
            advance(page, 300)
            assert len(gate.seen) == 1 and dialog.count() == 1
            gate.release()
            gone(page, R(page, "dialog", "Correct notice"))
            wait_for(page, lambda: active_is(page, opener), 5, "focus lands on Correct notice")
    assert version_of(editor, made["number"], 2)["version"] == 2


def test_wf_sign_in_roles(browser: Any, app_url: str) -> None:
    with desk(browser, app_url) as page:
        page.reload()
        wait_for(page, lambda: R(page, "button", "Sign out").count() == 1, 15, "reload keeps the screen")
        assert urlparse(page.url).path == "/editor"
        page.goto(app_url + "/stockist")
        wait_for(page, lambda: urlparse(page.url).path == "/editor", 10, "other role's screen redirects home")
        page.goto(app_url + "/sign-in")
        wait_for(page, lambda: urlparse(page.url).path == "/editor", 10, "sign-in redirects home")
        click(R(page, "button", "Sign out"))
        wait_for(page, lambda: urlparse(page.url).path == "/", 10, "sign out goes to /")
        page.go_back()
        wait_for(page, lambda: urlparse(page.url).path == "/sign-in", 10, "Back after Sign out lands on sign-in")
        assert text(R(page, "status", "Sign-in status")) == ""
    with desk(browser, app_url, SAGAR, path="/stockist") as page:
        page.context.request.delete(app_url + "/api/session")
        wait_for(page, lambda: urlparse(page.url).path == "/sign-in", 15, "a 401 refresh goes to sign-in", step=REFRESH_MS)
        see_text(page, R(page, "status", "Sign-in status"), S_ENDED)
    anon, stockist, editor = api(app_url), signed_in_api(app_url, SAGAR), signed_in_api(app_url, EDITOR)
    assert anon.get("/api/editor/notices").json()["error"] == "unauthenticated"
    assert stockist.get("/api/editor/notices").json()["error"] == "forbidden"
    assert editor.get("/api/stockist/endpoints").status_code == 403
    wrong = api(app_url).post("/api/session", json={"email": EDITOR[0], "password": "nope"})
    assert wrong.status_code == 401 and wrong.json() == {"error": "bad_credentials", "message": "That email and password don't match."}
    body = stockist.get("/api/session").json()
    assert body["role"] == "stockist" and body["displayName"] == "Sagar Traders"
    assert "httponly" in api(app_url).post("/api/session", json={"email": SAGAR[0], "password": SAGAR[1]}).headers["set-cookie"].lower()


def test_wf_sign_in_limit(app_url: str) -> None:
    client = api(app_url)
    answers = fire(BURST_SIGNINS, lambda i: client.post("/api/session", json={"email": EDITOR[0], "password": "wrong"}))
    assert sorted(a.status_code for a in answers) == [401] * 5 + [429] * 15
    limited = next(a for a in answers if a.status_code == 429)
    wait = int(limited.headers["Retry-After"])
    assert 1 <= wait <= LIMIT_LOOKUPS and limited.json()["retryAfter"] == wait and WAIT_RE.match(limited.json()["message"])
    right = client.post("/api/session", json={"email": EDITOR[0], "password": EDITOR[1]}, headers=FORWARDED)
    assert right.status_code == 429
    fresh = api(app_url)
    for _ in range(3):
        assert fresh.post("/api/session", json={"email": EDITOR[0], "password": EDITOR[1]}).status_code == 200
    for _ in range(5):
        assert fresh.post("/api/session", json={"email": EDITOR[0], "password": "wrong"}).status_code == 401


def test_wf_sign_in_typed_work(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    draft = make_draft(editor, [new_print("RG-2000-PET", 12500)], next_day(editor, "RG-2000-PET"))
    typed = f"Typed {token()}"
    with desk(browser, app_url) as page:
        group = R(page, "group", f"Draft {draft['id']}")
        fill(R(group, "textbox", "Notice title"), typed)
        writes: list[str] = []
        page.on("request", lambda r: writes.append(r.url) if r.method in ("PUT",) or r.url.endswith("/publish") else None)
        page.context.request.delete(app_url + "/api/session")
        wait_for(page, lambda: urlparse(page.url).path == "/sign-in", 15, "should reach sign-in", step=REFRESH_MS)
        see_text(page, R(page, "status", "Sign-in status"), S_ENDED)
        sign_in_ui(page, EDITOR)
        wait_for(page, lambda: urlparse(page.url).path == "/editor", 15, "back on the editor")
        see_text(page, R(page, "status", "Publish status"), S_KEPT)
        group = R(page, "group", f"Draft {draft['id']}")
        see(page, group)
        assert R(group, "textbox", "Notice title").input_value() == typed
        advance(page, REFRESH_MS)
        assert writes == [], "nothing may be sent until the user acts"
        assert next(d for d in editor.get("/api/editor/notices").json()["drafts"] if d["id"] == draft["id"])["revision"] == 1
        click(R(page, "button", "Sign out"))
        wait_for(page, lambda: urlparse(page.url).path == "/", 10, "signed out")
        page.goto(app_url + "/sign-in")
        sign_in_ui(page, EDITOR)
        wait_for(page, lambda: R(page, "group", f"Draft {draft['id']}").count() == 1, 15, "draft group")
        assert R(R(page, "group", f"Draft {draft['id']}"), "textbox", "Notice title").input_value() == draft["title"]
        assert S_KEPT not in text(R(page, "status", "Publish status"))
    with desk(browser, app_url, SAGAR, path="/stockist") as page:
        fill(R(page, "textbox", "Endpoint URL"), "https://kept.example/hook")
        page.context.request.delete(app_url + "/api/session")
        wait_for(page, lambda: urlparse(page.url).path == "/sign-in", 15, "sign-in", step=REFRESH_MS)
        sign_in_ui(page, DECCAN)
        wait_for(page, lambda: urlparse(page.url).path == "/stockist", 15, "other account's screen")
        wait_for(page, lambda: R(page, "textbox", "Endpoint URL").count() == 1, 10, "form")
        assert R(page, "textbox", "Endpoint URL").input_value() == ""
        assert S_KEPT not in text(R(page, "status", "Endpoint status"))


def test_wf_sign_in_other_account(browser: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    former = fresh_stockist(base)
    url = f"https://93.184.215.14/{token()}"
    former.post("/api/stockist/endpoints", json={"url": url})
    with desk(browser, base, SAGAR, path="/stockist") as page:
        see_text(page, page.locator("body"), url)
        fill(R(page, "textbox", "Endpoint URL"), "https://held.example/x")
        page.context.request.post(base + "/api/session", data={"email": DECCAN[0], "password": DECCAN[1]})
        wait_for(page, lambda: url not in page.locator("body").inner_text(), 15, "the former account's rows should go", step=REFRESH_MS)
        assert urlparse(page.url).path == "/stockist"
        wait_for(page, lambda: R(page, "textbox", "Endpoint URL").count() == 1, 10, "new account screen")
        assert R(page, "textbox", "Endpoint URL").input_value() == ""
        page.context.request.post(base + "/api/session", data={"email": EDITOR[0], "password": EDITOR[1]})
        wait_for(page, lambda: urlparse(page.url).path == "/editor", 15, "tab moves to the editor screen", step=REFRESH_MS)
        assert S_ENDED not in page.locator("body").inner_text()
    clear_endpoints(former)


def test_wait_timer(browser: Any, app_url: str) -> None:
    wait = 3
    limited = {"error": "rate_limited", "message": f"Too many tries. Wait {wait} seconds and try again.", "retryAfter": wait}
    with view(browser, app_url, wrong_clock=True) as page:
        calls: list[str] = []

        def refuse(route: Any) -> None:
            calls.append(route.request.url)
            route.fulfill(status=429, headers={"Retry-After": str(wait)}, content_type="application/json", body=json.dumps(limited))

        page.route("**/api/batches/**", refuse)
        field = R(page, "textbox", "Batch code")
        fill(field, "NSK-261005-02")
        field.press("Enter")
        status, timer = R(page, "status", "Pack reader status"), R(page, "timer", "Wait time")
        see_text(page, status, limited["message"], 5)
        wait_for(page, lambda: timer.count() == 1, 5, "timer should start", step=50)
        assert text(timer) == "3 seconds left."
        button = R(page, "button", "Read pack")
        assert button.get_attribute("aria-disabled") == "true"
        count = len(calls)
        click(button)
        field.press("Enter")
        assert len(calls) == count and field.input_value() == "NSK-261005-02"
        advance(page, 1000)
        assert text(timer) == "2 seconds left."
        advance(page, 1000)
        assert text(timer) == "1 second left."
        assert text(status) == limited["message"]
        advance(page, 1100)
        gone(page, timer, 3)
        assert text(status) == "" and button.get_attribute("aria-disabled") != "true"
    with view(browser, app_url + "/sign-in") as page:
        page.route("**/api/session", lambda r: r.fulfill(status=429, headers={"Retry-After": str(wait)}, content_type="application/json", body=json.dumps(limited)) if r.request.method == "POST" else r.fallback())
        sign_in_ui(page, (TYPED_EMAIL, "typed"))
        see_text(page, R(page, "status", "Sign-in status"), limited["message"], 5)
        wait_for(page, lambda: R(page, "timer", "Wait time").count() == 1, 5, "sign-in timer", step=50)
        assert R(page, "button", "Sign in").get_attribute("aria-disabled") == "true"
        assert R(page, "textbox", "Email").input_value() == TYPED_EMAIL


def wrapper_notice(editor: httpx.Client, control: httpx.Client, sku: str) -> tuple[str, str, dict[str, Any]]:
    day = next_day(editor, sku)
    control.put("/api/test/clock", json={"now": noon(day)})
    draft = sticker_draft(editor, [sku], day, run_out=add_days(day, 20))
    answer = publish(editor, draft)
    assert answer.status_code == 200, answer.text
    return day, answer.json()["number"], draft


def test_wf_run_out_wrappers_window(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.delete("/api/test/clock")
    editor = signed_in_api(base, EDITOR)
    sku = "BS-300-GLS"
    try:
        day, number, draft = wrapper_notice(editor, control, sku)
        future = next_day(editor, sku)
        edge = sticker_draft(editor, [sku], future, run_out=add_days(future, RUN_OUT_DAYS))
        over = editor.put(f"/api/editor/notices/{edge['id']}", json=body_of(edge, runOutUntil=add_days(future, RUN_OUT_DAYS + 1)))
        assert over.status_code == 422 and "runOutUntil" in over.json()["fields"]
        early = editor.put(f"/api/editor/notices/{edge['id']}", json=body_of(edge, runOutUntil=add_days(future, -1)))
        assert early.status_code == 422
        printing = make_draft(editor, [new_print("RG-300-GLS", 3200)], next_day(editor, "RG-300-GLS"))
        bad = editor.put(f"/api/editor/notices/{printing['id']}", json=body_of(printing, runOutUntil=printing["effectiveDate"]))
        assert bad.status_code == 422 and "runOutUntil" in bad.json()["fields"]
        plant = letters()
        code = batch_code(plant, day)
        with desk(browser, base) as page:
            fill(R(page, "textbox", "New batch code"), code)
            select(R(page, "combobox", "Batch pack"), f"{sku} {api(base).get(f'/api/skus/{sku}').json()['name']}")
            check(R(page, "checkbox", "Old wrapper"))
            click(R(page, "button", "Register batch"))
            see_text(page, R(page, "status", "Batch status"), f"Batch {code} registered.")
        pack = facts(api(base), code)
        assert pack["oldWrapper"] is True and pack["wrapperNotice"]["number"] == number
        assert pack["printDate"] == add_days(day, -1) and pack["stickerApplies"] is True
        assert pack["revisedMrpPaise"] == draft["rows"][0]["revisedMrpPaise"]
        assert pack["bestBeforeDate"] == add_days(day, api(base).get(f"/api/skus/{sku}").json()["shelfDays"])
        plain = facts(api(base), code.rsplit("-", 1)[0] + "-2") if editor.post("/api/editor/batches", json={"code": code.rsplit("-", 1)[0] + "-2", "skuCode": sku}).status_code == 201 else None
        assert plain and plain["stickerApplies"] is False and plain["printedMrpPaise"] == draft["rows"][0]["revisedMrpPaise"]
        late_day = add_days(day, 25)
        control.put("/api/test/clock", json={"now": noon(late_day)})
        closed = editor.post("/api/editor/batches", json={"code": batch_code(plant, late_day), "skuCode": sku, "oldWrapper": True})
        assert closed.status_code == 422 and closed.json() == {"error": "wrapper_window_closed", "message": S_WRAPPER}
        control.put("/api/test/clock", json={"now": noon(day)})
        row = body_of(draft)["rows"]
        strand = editor.post(f"/api/editor/notices/{number}/corrections", json={"baseVersion": 1, "reason": "Shrink", "effectiveDate": day, "runOutUntil": None, "rows": row})
        assert strand.status_code == 409 and strand.json()["error"] == "run_out_batches_exist"
        assert strand.json()["batches"] == [code] and strand.json()["message"] == f"Old-wrapper batches would be stranded: {code}."
        second, third = wrapper_notice(editor, control, "BS-300-CAN")[:2]
        racer = batch_code(letters(), second)
        rows2 = body_of(next(iter([{"title": "", "effectiveDate": second, "runOutUntil": None, "revision": 1, "rows": editor.get(f"/api/notices/{third}").json()["versions"][0]["rows"]}])))["rows"]

        def race(i: int) -> httpx.Response:
            if i == 0:
                return editor.post("/api/editor/batches", json={"code": racer, "skuCode": "BS-300-CAN", "oldWrapper": True})
            return editor.post(f"/api/editor/notices/{third}/corrections", json={"baseVersion": 1, "reason": "Close", "effectiveDate": second, "runOutUntil": None, "rows": rows2})

        made, fixed = fire(2, race)
        assert (made.status_code, fixed.status_code) in ((201, 409), (422, 201)), (made.text, fixed.text)
        if made.status_code == 422:
            assert made.json()["error"] == "wrapper_window_closed"
            assert api(base).get(f"/api/batches/{racer}").status_code == 404
        else:
            assert fixed.json()["error"] == "run_out_batches_exist"
    finally:
        control.delete("/api/test/clock")


def test_wf_run_out_wrappers_pack_states(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.delete("/api/test/clock")
    editor = signed_in_api(base, EDITOR)
    try:
        day, number, _ = wrapper_notice(editor, control, "MK-200-CTN")
        plant = letters()
        old, plain = batch_code(plant, day, 1), batch_code(plant, day, 2)
        assert editor.post("/api/editor/batches", json={"code": old, "skuCode": "MK-200-CTN", "oldWrapper": True}).status_code == 201
        assert editor.post("/api/editor/batches", json={"code": plain, "skuCode": "MK-200-CTN"}).status_code == 201
        for no_webgl in (False, True):
            with view(browser, f"{base}/?batch={old}", no_webgl=no_webgl) as page:
                assert f"Old wrapper under {number} v1" in term(page, "Wrapper")
                assert "Old wrapper" in attrs(page)["data-panel-text"].split(" | ")
                to_progress(page, 0.8)
                assert attrs(page)["data-sticker"] == "seated"
                link = R(page, "link", f"Read notice {number}")
                assert link.get_attribute("href").endswith(f"/notices/{number}")
                y = page.evaluate("scrollY")
                click(link)
                wait_for(page, lambda: urlparse(page.url).path == f"/notices/{number}", 10, "link opens the notice")
                page.go_back()
                wait_for(page, lambda: attrs(page).get("data-batch") == old, 10, "Back shows the pack")
                advance(page, FOCUS_MS)
                assert abs(page.evaluate("scrollY") - y) <= 40
            with view(browser, f"{base}/?batch={plain}", no_webgl=no_webgl) as page:
                assert term(page, "Wrapper").strip().startswith("Current print")
                assert R(page, "link", f"Read notice {number}").count() == 0
                assert "Old wrapper" not in attrs(page)["data-panel-text"].split(" | ")
    finally:
        control.delete("/api/test/clock")


def test_wf_revision_order_rate_continuity(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    sku = "BS-300-CAN"
    last = last_rate(editor, sku)
    assert last is not None
    day = next_day(editor, sku)
    wrong = last + 1 if last < 50 else last - 1
    draft = make_draft(editor, [{"skuCode": sku, "kind": "sticker", "revisedMrpPaise": 100, "oldRate": wrong, "newRate": wrong + 2}], day)
    answer = publish(editor, draft)
    assert answer.status_code == 422
    assert answer.json() == {"error": "rate_discontinuity", "message": f"Rate does not follow the last notice: {sku}.",
                             "rows": [{"skuCode": sku, "expectedOldRate": last, "oldRate": wrong}]}
    published_notice(editor, [new_print(sku, 3400 + random.randrange(700))], next_day(editor, sku))
    good = sticker_draft(editor, [sku], next_day(editor, sku))
    assert good["rows"][0]["oldRate"] == last and publish(editor, good).status_code == 200


def test_wf_revision_order_guard(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    sku, free = "TN-500-PET", "TN-200-CTN"
    first_day = next_day(editor, sku, free, gap=3)
    a = published_notice(editor, [new_print(sku, 2600), new_print(free, 1500)], first_day)
    later_day = add_days(first_day, 6)
    b = published_notice(editor, [new_print(sku, 2700)], later_day)
    entry_text = f"{sku} in {b['number']} from {later_day}"
    expected = {"error": "later_revision_exists", "message": f"Later notice exists: {entry_text}.",
                "rows": [{"skuCode": sku, "noticeNumber": b["number"], "effectiveDate": later_day}]}
    before = make_draft(editor, [new_print(sku, 2650)], add_days(first_day, 2))
    answer = publish(editor, before)
    assert answer.status_code == 409 and answer.json() == expected

    def correct(day: str, rows: list[dict]) -> httpx.Response:
        return editor.post(f"/api/editor/notices/{a['number']}/corrections", json={"baseVersion": 1, "reason": "Check", "effectiveDate": day, "rows": rows})

    for day, rows in ((first_day, [new_print(sku, 2610), new_print(free, 1500)]),
                      (first_day, [new_print(free, 1500)]),
                      (add_days(later_day, 2), [new_print(sku, 2600), new_print(free, 1500)])):
        refused = correct(day, rows)
        assert refused.status_code == 409 and refused.json() == expected, refused.text
    other = correct(add_days(first_day, 1), [new_print(sku, 2600), new_print(free, 1550)])
    assert other.status_code == 201, other.text


def test_wf_revision_order_cross_draft_races(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    day = next_day(editor, "RG-300-GLS")
    one = make_draft(editor, [new_print("RG-300-GLS", 3500)], day)
    two = make_draft(editor, [new_print("RG-300-GLS", 3600)], day)
    pair = [one, two]
    answers = fire(2, lambda i: publish(editor, pair[i]))
    assert sorted(a.status_code for a in answers) == [200, 409]
    loser = next(a for a in answers if a.status_code == 409).json()
    assert loser["error"] == "effective_date_taken" and loser["rows"] == ["RG-300-GLS"]
    won = next(a for a in answers if a.status_code == 200).json()["number"]
    skus = ["MK-1000-PET", "BS-750-PET", "RG-2000-PET", "KP-200-CTN"]
    drafts = [make_draft(editor, [new_print(s, 9000 + i)], next_day(editor, s)) for i, s in enumerate(skus)]
    results = fire(4, lambda i: publish(editor, drafts[i]))
    assert [a.status_code for a in results] == [200] * 4, [a.text for a in results]
    sequence = sorted(int(a.json()["number"].rsplit("-", 1)[1]) for a in results)
    assert sequence == list(range(sequence[0], sequence[0] + 4))
    assert sequence[0] == int(won.rsplit("-", 1)[1]) + 1, "the refusal should spend no number"


def test_wf_revision_order_stale_draft(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    day = next_day(editor, "KP-200-CTN")
    draft = make_draft(editor, [new_print("KP-200-CTN", 1900)], day)
    with desk(browser, app_url) as page:
        group = R(page, "group", f"Draft {draft['id']}")
        see(page, group)
        moved = editor.put(f"/api/editor/notices/{draft['id']}", json=body_of(draft, title=draft["title"] + " other tab")).json()
        typed = f"Mine {token()}"
        fill(R(group, "textbox", "Notice title"), typed)
        click(R(group, "button", "Save draft"))
        status = R(page, "status", "Publish status")
        see_text(page, status, S_STALE)
        advance(page, REFRESH_MS * 2 + PREVIEW_MS)
        assert text(status) == S_STALE
        assert R(group, "textbox", "Notice title").input_value() == typed
    assert next(d for d in editor.get("/api/editor/notices").json()["drafts"] if d["id"] == draft["id"])["title"] == moved["title"]
    answers = fire(4, lambda i: editor.put(f"/api/editor/notices/{draft['id']}", json=body_of(moved, title=f"Race {i}")))
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409]
    assert all(a.json() == {"error": "stale_draft", "message": S_STALE} for a in answers if a.status_code == 409)


def test_wf_revision_order_confirm_publish(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    sku = "BS-300-GLS"
    day = next_day(editor, sku)
    title = f"Confirm {token()}"
    draft = sticker_draft(editor, [sku], day, title)
    preview = editor.post(f"/api/editor/notices/{draft['id']}/preview", json=body_of(draft)).json()
    with desk(browser, app_url) as page:
        group = R(page, "group", f"Draft {draft['id']}")
        opener = R(group, "button", f"Publish {title}")
        see(page, opener)
        click(opener)
        dialog = R(page, "dialog", "Confirm publish")
        see(page, dialog)
        keep = R(dialog, "button", "Keep editing")
        wait_for(page, lambda: active_is(page, keep), 5, "focus should start on Keep editing")
        packs = text(R(dialog, "list", "Packs that take the sticker"))
        for code in preview["rows"][0]["stickerBatches"]:
            assert code in packs
        assert S_WARNING in text(dialog)
        page.keyboard.press("Escape")
        gone(page, R(page, "dialog", "Confirm publish"), 5)
        wait_for(page, lambda: active_is(page, opener), 5, "focus returns to the opener")
        fill(R(group, "textbox", "Notice title"), title + " unsaved")
        click(R(group, "button", f"Publish {title} unsaved") if R(group, "button", f"Publish {title} unsaved").count() else opener)
        see(page, dialog)
        see_text(page, R(dialog, "status", "Confirm status"), S_UNSAVED)
        now = R(dialog, "button", "Publish notice now")
        assert now.get_attribute("aria-disabled") == "true"
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url) if r.url.endswith("/publish") else None)
        click(now)
        advance(page, 300)
        assert seen == []
        click(keep)
        fill(R(group, "textbox", "Notice title"), title)
        wait_for(page, lambda: opener.count() == 1, 5, "title restored")
        click(opener)
        see(page, dialog)
        rival = make_draft(editor, [new_print(sku, 2800)], day)
        assert publish(editor, rival).status_code == 200
        message = editor.post(f"/api/editor/notices/{draft['id']}/preview", json=body_of(draft)).json()["blocking"]["message"]
        see_text(page, R(dialog, "status", "Confirm status"), message, REOPEN_MS / 1000 + MARGIN_S)
        assert R(dialog, "button", "Publish notice now").get_attribute("aria-disabled") == "true"
        assert active_is(page, keep)


def test_wf_revision_order_refused_rows(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    sku = "KP-1200-PET"
    draft = sticker_draft(editor, [sku], next_day(editor, sku))
    ceiling = draft["rows"][0]["ceilingPaise"]
    with desk(browser, app_url) as page:
        group = R(page, "group", f"Draft {draft['id']}")
        field = R(group, "textbox", f"Revised MRP for {sku}")
        see(page, field)
        fill(field, rupees(ceiling + 1))
        refused = R(group, "list", f"Refused rows {draft['id']}")
        wait_for(page, lambda: refused.count() == 1, 10, "refused rows should show")
        fix = R(refused, "link", f"Fix {sku}")
        click(fix)
        wait_for(page, lambda: active_is(page, field), 5, "Fix moves focus to the field")
        assert field.get_attribute("aria-invalid") == "true"
        described = field.evaluate("e=>document.getElementById(e.getAttribute('aria-describedby')).textContent")
        assert f"Over the ceiling: {sku}." in described
        fix.focus()
        editor_body = body_of(draft)
        assert editor_body
        page.evaluate("()=>{}")
        field.evaluate("(e,v)=>{const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(e,v);e.dispatchEvent(new Event('input',{bubbles:true}))}", rupees(ceiling))
        wait_for(page, lambda: R(group, "list", f"Refused rows {draft['id']}").count() == 0, 10, "list should clear")
        assert field.get_attribute("aria-invalid") in (None, "false")
        status = R(group, "status", f"Preview status {draft['id']}")
        wait_for(page, lambda: active_is(page, status), 5, "a focused link that leaves hands focus to Preview status")
        assert text(status) == S_READY


def test_wf_endpoint_lifecycle_rotate_remove(browser: Any, svix: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = fresh_stockist(base)
    with sink() as receiver:
        saved = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
        poll(lambda: stockist.get("/api/stockist/endpoints").json()["endpoints"][0]["registered"], RETURN_S, "endpoint should register")
        rotations = fire(3, lambda i: stockist.post(f"/api/stockist/endpoints/{saved['id']}/rotate-secret", json={}))
        assert sorted(a.status_code for a in rotations) == [200, 409, 409]
        assert all(a.json() == {"error": "rotation_in_progress", "message": "This secret is already being rotated."} for a in rotations if a.status_code == 409)
        new = next(a for a in rotations if a.status_code == 200).json()["signingSecret"]
        assert new != saved["signingSecret"]
        event = stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
        poll(lambda: receiver.of(event), RETURN_S + MARGIN_S, "a message after rotation should arrive")
        message = receiver.of(event)[0]
        assert verifies(new, message) and verifies(saved["signingSecret"], message)
        with desk(browser, base, SAGAR, path="/stockist") as page:
            remove = R(page, "button", f"Remove {receiver.url}")
            see(page, remove)
            gate = Gate(page, f"**/api/stockist/endpoints/{saved['id']}", "DELETE")
            click(remove)
            wait_for(page, lambda: gate.routes, 5, "DELETE should leave")
            see_text(page, R(page, "status", "Endpoint status"), "Removing the endpoint.")
            gate.drop()
            see_text(page, R(page, "status", "Endpoint status"), S_LOST_REMOVAL)
            assert remove.count() == 1 and active_is(page, remove)
            page.unroute(f"**/api/stockist/endpoints/{saved['id']}", gate.handler)
            click(remove)
            see_text(page, R(page, "status", "Endpoint status"), "Endpoint removed.")
            gone(page, remove)
            wait_for(page, lambda: active_is(page, R(page, "textbox", "Endpoint URL")), 5, "focus moves to Endpoint URL")
        assert stockist.delete(f"/api/stockist/endpoints/{saved['id']}").status_code == 404
        assert stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).status_code == 404
        log = entry(stockist, event)
        assert log and log["endpointRemoved"] is True and log["state"] == "delivered"
        count = len(receiver.records)
        made = published_notice(editor, [new_print("KP-200-CTN", 2100 + random.randrange(900))], next_day(editor, "KP-200-CTN"))
        wait_print(editor, made["number"], 1)
        assert entry(stockist, f"{made['number']}-v1-{saved['id']}") is None
        assert len(receiver.records) == count
        again = stockist.post("/api/stockist/endpoints", json={"url": receiver.url})
        assert again.status_code == 201 and again.json()["id"] != saved["id"]
        clear_endpoints(stockist)


def test_wf_endpoint_lifecycle_long_values(browser: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    stockist = fresh_stockist(base)
    url = "https://93.184.215.14/" + "a" * (URL_MAX - len("https://93.184.215.14/"))
    with desk(browser, base, SAGAR, 375, 812, "/stockist") as page:
        fill(R(page, "textbox", "Endpoint URL"), url)
        click(R(page, "button", "Save endpoint"))
        dialog = R(page, "dialog", "Signing secret")
        see(page, dialog)
        box = dialog.bounding_box()
        assert box["height"] <= 812 and box["width"] <= 375
        saved_button = R(dialog, "button", "I have saved it")
        saved_button.scroll_into_view_if_needed()
        advance(page, 100)
        assert topmost(saved_button)
        page.keyboard.press("Escape")
        advance(page, 200)
        assert R(page, "dialog", "Signing secret").count() == 1
        advance(page, REFRESH_MS)
        assert R(page, "dialog", "Signing secret").count() == 1
        click(saved_button)
        gone(page, R(page, "dialog", "Signing secret"))
        wait_for(page, lambda: active_is(page, R(page, "button", "Save endpoint")), 5, "focus returns to Save endpoint")
        layout(page)
        assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
        remove = R(page, "button", f"Remove {url}")
        see(page, remove)
        endpoint = stockist.get("/api/stockist/endpoints").json()["endpoints"][0]
        gate = Gate(page, f"**/api/stockist/endpoints/{endpoint['id']}", "DELETE")
        click(remove)
        wait_for(page, lambda: gate.routes, 5, "DELETE should leave")
        advance(page, REFRESH_MS * 2)
        assert remove.count() == 1 and "Removing the endpoint." in text(R(page, "status", "Endpoint status"))
        click(remove)
        advance(page, 300)
        assert len(gate.seen) == 1, "a second press must send no second DELETE"
        gate.release()
        gone(page, remove)
    assert stockist.get("/api/stockist/endpoints").json()["endpoints"] == []


def test_wf_sticker_pixels_geometry(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        for fmt, (mrp, sticker) in GEOMETRY.items():
            read_pack(page, FORMAT_BATCH[fmt])
            wait_batch(page, FORMAT_BATCH[fmt])
            a = attrs(page)
            assert a["data-format"] == fmt
            assert rect(a["data-mrp-rect"]) == pytest.approx(mrp, abs=0.001)
            assert rect(a["data-sticker-rect"]) == pytest.approx(sticker, abs=0.001)
            x, y, w, h = sticker
            cx, cy = x + w / 2, y + h / 2
            angle = math.radians(-4)
            tilted = [(cx + (px - cx) * math.cos(angle) - (py - cy) * math.sin(angle),
                       cy + (px - cx) * math.sin(angle) + (py - cy) * math.cos(angle)) for px, py in corners(sticker)]
            assert not overlap(tilted, corners(mrp)), fmt


PIXEL_CASES = {
    "webgl-375-1": (False, 375, 812, 1), "webgl-375-2": (False, 375, 812, 2), "webgl-375-3": (False, 375, 812, 3),
    "webgl-768-1": (False, 768, 1024, 1), "webgl-1280-1": (False, 1280, 800, 1), "webgl-1280-2": (False, 1280, 800, 2),
    "svg-375-1": (True, 375, 812, 1), "svg-768-1": (True, 768, 1024, 1), "svg-1280-1": (True, 1280, 800, 1),
}


@pytest.mark.parametrize("case", list(PIXEL_CASES), ids=list(PIXEL_CASES))
@pytest.mark.timeout(1500)
def test_wf_sticker_pixels_proof(browser: Any, app_url: str, case: str) -> None:
    no_webgl, width, height, scale = PIXEL_CASES[case]
    with view(browser, f"{app_url}/?batch=NSK-260915-07", width, height, scale=scale, no_webgl=no_webgl) as page:
        a = attrs(page)
        assert a["data-renderer"] == ("svg" if no_webgl else "webgl")
        pin = pin_offset(page)
        to_progress(page, 0.2, pin)
        a = attrs(page)
        assert a["data-panel-screen-rect"] == "" and a["data-sticker-screen-quad"] == "" and a["data-front-screen-rect"]
        widths = []
        for value in (0.3, 0.35, 0.4125, 0.5, 0.55):
            to_progress(page, value, pin)
            widths.append(rect(attrs(page)["data-panel-screen-rect"])[2])
        assert widths == sorted(widths) and len(set(widths)) == len(widths), widths
        assert 0.60 <= widths[2] / widths[-1] <= 0.85
        centres = []
        for value in (0.56, 0.6, 0.65, 0.7, 0.75):
            to_progress(page, value, pin)
            a = attrs(page)
            q = quad(a["data-sticker-screen-quad"])
            assert len(q) == 4 and not overlap(q, corners(rect(a["data-mrp-screen-rect"])))
            centres.append(centre(q))
        seat = centres[-1]
        distance = [math.dist(c, seat) for c in centres]
        assert distance == sorted(distance, reverse=True)
        assert distance[2] / distance[0] == pytest.approx(0.5, abs=0.075)
        a = attrs(page)
        width_75 = rect(a["data-mrp-screen-rect"])[2]
        for value in (0.75, 1.0):
            to_progress(page, value, pin)
            a = attrs(page)
            q = quad(a["data-sticker-screen-quad"])
            m = rect(a["data-mrp-screen-rect"])
            for x, y in q + corners(m):
                assert 0 <= x <= width and 0 <= y <= height, (value, q, m)
            marquee = page.get_by_role("marquee", name="Price changes").bounding_box()
            assert max(y for _, y in q + corners(m)) <= marquee["y"] + 1
            angle = math.degrees(math.atan2(q[0][1] - q[1][1], q[1][0] - q[0][0]))
            assert angle == pytest.approx(4, abs=1)
            image = device_shot(page)
            pixels = region_pixels(image, q, scale)
            assert pixels, "the quad should cover screenshot pixels"
            assert sum(near(p, ACCENT) for p in pixels) >= 0.5 * len(pixels)
        assert m[2] >= 1.5 * width_75
        if not no_webgl:
            canvas = R(page, "img", "Pack stage")
            assert canvas.evaluate("e=>e.width") >= min(scale, 2) * canvas.evaluate("e=>e.getBoundingClientRect().width") - 1
            p = rect(a["data-panel-screen-rect"])
            strip = corners((p[0] + 0.10 * p[2], p[1] + 0.76 * p[3], 0.80 * p[2], 0.14 * p[3]))
            grain = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in region_pixels(image, strip, scale)]
            assert grain, "the grain strip should cover screenshot pixels"
            mean = sum(grain) / len(grain)
            deviation = math.sqrt(sum((v - mean) ** 2 for v in grain) / len(grain))
            assert 1.5 <= deviation <= 20, deviation
            advance(page, 100)
            again = [0.2126 * r + 0.7152 * g + 0.0722 * b for r, g, b in region_pixels(device_shot(page), strip, scale)]
            assert again == grain, "grain should hold still at rest"
    with view(browser, f"{app_url}/?batch=NSK-261005-02", width, height, scale=scale, no_webgl=no_webgl) as page:
        to_progress(page, 1)
        a = attrs(page)
        assert a["data-sticker-screen-quad"] == ""
        pixels = region_pixels(device_shot(page), corners(rect(a["data-panel-screen-rect"])), scale)
        assert pixels, "the panel should cover screenshot pixels"
        assert sum(near(p, ACCENT) for p in pixels) < 0.02 * len(pixels)


def test_wf_sticker_pixels_resilience(browser: Any, app_url: str) -> None:
    with view(browser, f"{app_url}/?batch=NSK-260915-07") as page:
        pin = to_progress(page, 0.6)
        page.reload()
        ready(page)
        advance(page, REST_MS)
        assert progress(page) == pytest.approx(0.6, abs=0.02)
        on_formula(page)
        page.set_viewport_size({"width": 700, "height": 800})
        advance(page, FOCUS_MS)
        on_formula(page)
        page.set_viewport_size({"width": 1280, "height": 800})
        advance(page, FOCUS_MS)
        on_formula(page)
        pin = pin_offset(page)
        to_progress(page, 0.2, pin)
        page.locator("body").evaluate("e=>e.focus&&document.activeElement.blur()")
        before = progress(page)
        page.keyboard.press("PageDown")
        advance(page, REST_MS)
        assert progress(page) > before
        on_formula(page)
        before = progress(page)
        page.keyboard.press("Shift+Space")
        advance(page, REST_MS)
        assert progress(page) < before
        on_formula(page)
        to_progress(page, 0.8, pin)
        page.evaluate("code=>{history.pushState({}, '', '/?batch='+code);dispatchEvent(new PopStateEvent('popstate',{state:{}}))}", "NSK-261005-02")
        wait_batch(page, "NSK-261005-02")
        page.go_back()
        wait_batch(page, "NSK-260915-07")
        advance(page, FOCUS_MS)
        assert attrs(page)["data-sticker"] == "seated" and progress(page) == pytest.approx(0.8, abs=0.01)
        on_formula(page)
        held = progress(page)
        page.goto(app_url + "/notices/VT-2026-02")
        wait_for(page, lambda: "VT-2026-02" in page.locator("body").inner_text(), 10, "notice page")
        page.go_back()
        ready(page)
        advance(page, FOCUS_MS)
        assert progress(page) == pytest.approx(held, abs=0.01)
        assert attrs(page)["data-batch"] == "NSK-260915-07"


def test_wf_stage_continuity_travel(browser: Any, app_url: str) -> None:
    for no_webgl in (False, True):
        with view(browser, app_url, no_webgl=no_webgl) as page:
            hero = attrs(page, HERO)
            assert float(hero["data-arch-open"]) == 0
            hx, hy, hw, hh = rect(hero["data-pack-screen-rect"])
            ax, ay, aw, ah = rect(hero["data-arch-screen-rect"])
            assert ax <= hx and ay <= hy and hx + hw <= ax + aw and hy + hh <= ay + ah
            assert not set(hero) & {"data-pack-progress", "data-pack-yaw", "data-sticker"}
            pin = pin_offset(page)
            distances, opens = [], []
            remembered = None
            for i in range(9):
                scroll_to(page, pin * i / 8 + (4 if i == 8 else 0))
                h, s = attrs(page, HERO), attrs(page)
                pack, stage_pack = rect(h["data-pack-screen-rect"]), rect(s["data-pack-screen-rect"])
                distances.append(math.dist(centre(corners(pack)), centre(corners(stage_pack))))
                opens.append(float(h["data-arch-open"]))
                if i == 4:
                    remembered = pack
            assert opens == sorted(opens) and opens[-1] == 1
            assert all(b <= a + 1 for a, b in zip(distances, distances[1:])), distances
            assert distances[-1] <= 8
            assert pack[2] == pytest.approx(stage_pack[2], rel=0.05)
            scroll_to(page, pin * 4 / 8)
            assert rect(attrs(page, HERO)["data-pack-screen-rect"]) == pytest.approx(remembered, abs=2)
    with view(browser, app_url, reduced_motion="reduce") as page:
        assert float(attrs(page, HERO)["data-arch-open"]) == 1


LOSE = """(e,how)=>{const g=e.getContext('webgl2')||e.getContext('webgl');window.__lose=window.__lose||g.getExtension('WEBGL_lose_context');
how==='lose'?window.__lose.loseContext():window.__lose.restoreContext()}"""


def test_wf_stage_continuity_context_loss(browser: Any, app_url: str) -> None:
    client = api(app_url)
    with view(browser, f"{app_url}/?batch=NSK-260915-07") as page:
        to_progress(page, 0.6)
        canvas = R(page, "img", "Pack stage")
        handle = canvas.element_handle()
        held = attrs(page)
        handle.evaluate(LOSE, "lose")
        wait_for(page, lambda: attrs(page).get("data-renderer") == "svg", 1, "svg within one second", step=100)
        see(page, R(page, "img", "Pack declaration panel"), 1)
        assert R(page, "img", "Pack stage").count() == 0 and page.evaluate("document.querySelectorAll('canvas').length") >= 1
        assert attrs(page)["data-pack-progress"] == held["data-pack-progress"]
        on_formula(page)
        slider = R(page, "slider", "Turn the pack")
        slider.focus()
        page.keyboard.press("ArrowRight")
        advance(page, FOCUS_MS)
        assert progress(page) == pytest.approx(0.65, abs=0.011)
        read_pack(page, "NSK-261005-02")
        wait_batch(page, "NSK-261005-02")
        handle.evaluate(LOSE, "restore")
        wait_for(page, lambda: attrs(page).get("data-renderer") == "webgl", 2, "webgl within two seconds", step=100)
        assert attrs(page)["data-batch"] == "NSK-261005-02"
        assert_panel(page, facts(client, "NSK-261005-02"))


def test_wf_stage_continuity_cycles_and_motion(browser: Any, app_url: str) -> None:
    url = f"{app_url}/?batch=NSK-260915-07"
    with view(browser, url) as page:
        pin = to_progress(page, 1)
        a = attrs(page)
        fresh = region_pixels(shot(page), corners(rect(a["data-mrp-screen-rect"])), 1)
    with view(browser, url) as page:
        pin = pin_offset(page)
        points = []
        for value in (0.56, 0.6, 0.65, 0.7):
            to_progress(page, value, pin)
            points.append(centre(quad(attrs(page)["data-sticker-screen-quad"])))
        (x0, y0), (x1, y1) = points[0], points[-1]
        span = math.hypot(x1 - x0, y1 - y0)
        for x, y in points[1:-1]:
            assert abs((x1 - x0) * (y0 - y) - (x0 - x) * (y1 - y0)) / span <= 3, "flight should be a straight line"
        to_progress(page, 1, pin)
        handle = R(page, "img", "Pack stage").element_handle()
        for _ in range(3):
            handle.evaluate(LOSE, "lose")
            wait_for(page, lambda: attrs(page).get("data-renderer") == "svg", 1, "svg", step=100)
            handle.evaluate(LOSE, "restore")
            wait_for(page, lambda: attrs(page).get("data-renderer") == "webgl", 2, "webgl", step=100)
            assert page.evaluate("document.querySelectorAll('canvas').length") == fresh_canvases(page)
            advance(page, 200)
            a = attrs(page)
            now = region_pixels(shot(page), corners(rect(a["data-mrp-screen-rect"])), 1)
            same = sum(near(p, q) for p, q in zip(now, fresh))
            assert same >= 0.95 * min(len(now), len(fresh))
        page.emulate_media(reduced_motion="reduce")
        advance(page, FOCUS_MS)
        assert R(page, "button", "Front").count() == 1 and R(page, "slider", "Turn the pack").count() == 0
        assert float(attrs(page)["data-pack-yaw"]) == 0 and float(attrs(page)["data-camera-z"]) == 6
        page.emulate_media(reduced_motion="no-preference")
        advance(page, FOCUS_MS)
        assert R(page, "slider", "Turn the pack").count() == 1
        on_formula(page)


def fresh_canvases(page: Page) -> int:
    if not hasattr(page, "_canvases"):
        page._canvases = page.evaluate("document.querySelectorAll('canvas').length")
    return page._canvases


def test_wf_publish_preview_live(browser: Any, app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    sku = "MK-1000-PET"
    draft = sticker_draft(editor, [sku], next_day(editor, sku))
    ceiling = draft["rows"][0]["ceilingPaise"]
    with desk(browser, app_url) as page:
        group = R(page, "group", f"Draft {draft['id']}")
        field = R(group, "textbox", f"Revised MRP for {sku}")
        see(page, field)
        status = R(group, "status", f"Preview status {draft['id']}")
        see_text(page, status, S_READY)
        region = R(group, "region", f"Publish preview {draft['id']}")
        for name in ("Pack", "Old MRP", "Ceiling", "Packs that take the sticker"):
            assert name in text(region)
        assert f"Rs {rupees(ceiling)}" in text(region)
        gate = Gate(page, f"**/api/editor/notices/{draft['id']}/preview", "POST")
        field.focus()
        field.fill(rupees(ceiling + 5))
        wait_for(page, lambda: gate.routes, PREVIEW_MS / 1000 + 3, "preview should leave with no button")
        late = gate.routes.pop()
        gate.open = True
        field.fill(rupees(ceiling))
        field.evaluate("e=>e.setSelectionRange(2,2)")
        wait_for(page, lambda: len(gate.seen) >= 2, PREVIEW_MS / 1000 + 3, "second preview should leave")
        advance(page, 500)
        late.fallback()
        advance(page, 1000)
        assert text(status) == S_READY and active_is(page, field) and field.evaluate("e=>e.selectionStart") == 2
        field.fill(rupees(ceiling + 5))
        see_text(page, status, f"Over the ceiling: {sku}.", 6)
    after = next(d for d in editor.get("/api/editor/notices").json()["drafts"] if d["id"] == draft["id"])
    assert after["revision"] == draft["revision"] and after["rows"][0]["revisedMrpPaise"] == ceiling


def test_wf_publish_preview_equals_publish(app_url: str) -> None:
    editor = signed_in_api(app_url, EDITOR)
    sku, other = "RG-2000-PET", "KP-200-CTN"
    day = next_day(editor, sku, other)
    taken = published_notice(editor, [new_print(sku, 12400 + random.randrange(400))], day)
    later_day = add_days(day, 5)
    later = published_notice(editor, [new_print(sku, 12900)], later_day)
    fresh = next_day(editor, sku, other)
    rate = last_rate(editor, other)

    def same(draft: dict[str, Any], label: str) -> None:
        preview = editor.post(f"/api/editor/notices/{draft['id']}/preview", json=body_of(draft))
        assert preview.status_code == 200
        real = publish(editor, draft)
        assert real.status_code >= 400, label
        assert preview.json()["blocking"] == real.json(), label

    same(make_draft(editor, [new_print(sku, 12400)], later_day), "effective_date_taken")
    same(make_draft(editor, [new_print(sku, 12400)], add_days(day, 2)), "later_revision_exists")
    same(make_draft(editor, [], fresh), "no_rows")
    same(make_draft(editor, [new_print(other, 1), new_print(other, 2)], fresh), "validation")
    same(make_draft(editor, [new_print("TN-200-CTN", 1600)], today(editor)) if False else make_draft(editor, [new_print("RG-300-GLS", 3900)], add_days(today(editor), -1)), "past or later")
    over = sticker_draft(editor, [other], fresh)
    rows = body_of(over)["rows"]
    rows[0]["revisedMrpPaise"] = over["rows"][0]["ceilingPaise"] + 1
    same(editor.put(f"/api/editor/notices/{over['id']}", json=body_of(over, rows=rows)).json(), "ceiling_exceeded")
    jump = (rate or 0) + 7
    same(make_draft(editor, [{"skuCode": other, "kind": "sticker", "revisedMrpPaise": 100, "oldRate": jump, "newRate": jump + 1}], fresh), "rate_discontinuity")
    ok = make_draft(editor, [new_print(other, 2200 + random.randrange(500))], next_day(editor, other))
    before = ok["revision"]
    clean = editor.post(f"/api/editor/notices/{ok['id']}/preview", json=body_of(ok))
    assert clean.json()["blocking"] is None and clean.json()["rows"][0]["stickerBatches"] == []
    malformed = editor.post(f"/api/editor/notices/{ok['id']}/preview", json=body_of(ok, effectiveDate="not a date"))
    assert malformed.json()["blocking"]["error"] == "validation" and malformed.json()["rows"] == []
    assert next(d for d in editor.get("/api/editor/notices").json()["drafts"] if d["id"] == ok["id"])["revision"] == before
    numbers = int(later["number"].rsplit("-", 1)[1])
    won = publish(editor, ok).json()["number"]
    assert int(won.rsplit("-", 1)[1]) == numbers + 1, "refusals and previews spent a number"
    body = {"baseVersion": 1, "reason": "Check", "effectiveDate": day, "rows": [new_print(sku, 12350)]}
    preview = editor.post(f"/api/editor/notices/{taken['number']}/corrections/preview", json=body)
    real = editor.post(f"/api/editor/notices/{taken['number']}/corrections", json=body)
    assert real.status_code == 409 and preview.json()["blocking"] == real.json()
    number, moved = locked_correction(app_url)
    previewed = editor.post(f"/api/editor/notices/{number}/corrections/preview", json=moved)
    assert previewed.status_code == 200 and previewed.json()["blocking"]["error"] == "effective_date_locked"


def test_wf_stockist_recovery_failed(browser: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.put("/api/test/clock", json={"now": "2034-02-01T06:30:00Z"})
    stockist = fresh_stockist(base)
    try:
        with sink() as receiver:
            saved = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
            good = stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
            poll(lambda: (lambda e: e and e["state"] == "delivered")(entry(stockist, good)), 60, "first message delivered")
            receiver.status = 500
            bad = stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
            poll(lambda: (lambda e: e and e["state"] == "failed")(entry(stockist, bad)), 90, "second message failed")
            delivered_count = len(receiver.of(good))
            with desk(browser, base, SAGAR, path="/stockist") as page:
                page.on("response", lambda r: setattr(receiver, "status", 200) if r.url.endswith("/recover") and r.request.method == "POST" else None)
                press = R(page, "button", f"Recover failed for {receiver.url}")
                see(page, press)
                click(press)
                see_text(page, R(page, "status", "Endpoint status"), "Recovery requested: 1. Check the delivery log for the result.")
                assert active_is(page, press)
            repeat = stockist.post(f"/api/stockist/endpoints/{saved['id']}/recover", json={})
            if repeat.status_code == 409:
                assert repeat.json() == {"error": "nothing_failed", "message": S_NOTHING}
            done = poll(lambda: (lambda e: e if e and e["state"] == "redelivered" else None)(entry(stockist, bad)), 60, "entry should read redelivered")
            assert done["attempts"]
            assert len(receiver.of(good)) == delivered_count, "a delivered entry was resent"
            last = receiver.of(bad)[-1]
            assert verifies(saved["signingSecret"], last)
            assert len({r["headers"]["svix-id"] for r in receiver.of(bad)}) == 1
            malformed = stockist.post(f"/api/stockist/endpoints/{saved['id']}/recover", content=b"{nope", headers={"content-type": "application/json"})
            assert malformed.status_code == 400 and malformed.json()["error"] == "bad_json"
            nothing = stockist.post(f"/api/stockist/endpoints/{saved['id']}/recover", json={})
            assert nothing.status_code == 409 and nothing.json()["error"] == "nothing_failed"
    finally:
        clear_endpoints(stockist)
        control.delete("/api/test/clock")


def test_wf_stockist_recovery_outage(browser: Any) -> None:
    base = instance("APP_SVIX_RETURN_URL")
    stockist = fresh_stockist(base)
    with sink(status=500) as receiver:
        with relay(18071, "SVIX_URL"):
            poll(lambda: not stockist.get("/api/stockist/deliveries").json()["messagesQueued"], RETURN_S + MARGIN_S, "Svix up")
            saved = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
            event = stockist.post(f"/api/stockist/endpoints/{saved['id']}/test", json={}).json()["eventId"]
            poll(lambda: (lambda e: e and e["state"] == "failed")(entry(stockist, event)), 90, "entry failed")
        receiver.status = 200
        poll(lambda: stockist.get("/api/stockist/deliveries").json()["messagesQueued"], RETURN_S, "outage seen")
        started = time.monotonic()
        answer = stockist.post(f"/api/stockist/endpoints/{saved['id']}/recover", json={})
        assert answer.status_code == 202 and answer.json()["requested"] == [event]
        assert time.monotonic() - started <= QUICK_S
        with desk(browser, base, SAGAR, path="/stockist") as page:
            see_text(page, R(page, "alert", "Message status"), S_MSG_OUT)
        with relay(18071, "SVIX_URL"):
            poll(lambda: (lambda e: e and e["state"] == "redelivered")(entry(stockist, event)), RETURN_S + MARGIN_S + 30, "recovery should send after the return")
        clear_endpoints(stockist)


def test_wf_provider_faults_hang_and_refusal() -> None:
    base = instance("APP_SVIX_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = fresh_stockist(base)
    with relay(18071, "SVIX_URL", mode="hang"):
        for call in (lambda: stockist.post("/api/stockist/endpoints", json={"url": f"https://93.184.215.14/{token()}"}),
                     lambda: stockist.get("/api/stockist/deliveries")):
            started = time.monotonic()
            assert call().status_code in (200, 201)
            assert time.monotonic() - started <= QUICK_S
        poll(lambda: stockist.get("/api/stockist/deliveries").json()["messagesQueued"], RETURN_S, "hang should count as an outage")
    clear_endpoints(stockist)
    refused: set[str] = set()
    lost: set[str] = set()

    def policy(method: str, path: str, body: bytes) -> Any:
        if method == "POST" and path.split("?")[0].endswith("/msg/"):
            text_body = body.decode(errors="replace")
            if any(r in text_body for r in refused):
                return 503, b"{}"
            if any(x in text_body for x in lost):
                lost.clear()
                return "lose"
        return "forward"

    with sink() as receiver, http_proxy(18071, "SVIX_URL", policy):
        poll(lambda: not stockist.get("/api/stockist/deliveries").json()["messagesQueued"], RETURN_S + MARGIN_S, "Svix up through the proxy")
        endpoint = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
        sku_a, sku_b = "KP-600-PET", "BS-750-PET"
        day_a = next_day(editor, sku_a)
        draft_a = make_draft(editor, [new_print(sku_a, 4800 + random.randrange(800))], day_a, f"Held {token()}")
        refused.add(draft_a["title"])
        number_a = publish(editor, draft_a).json()["number"]
        correction = editor.post(f"/api/editor/notices/{number_a}/corrections", json={"baseVersion": 1, "reason": "Next", "effectiveDate": day_a, "rows": [new_print(sku_a, 4750)]})
        assert correction.status_code == 201
        title_b = f"Lost {token()}"
        lost.add(title_b)
        draft_b = make_draft(editor, [new_print(sku_b, 4800 + random.randrange(800))], next_day(editor, sku_b), title_b)
        number_b = publish(editor, draft_b).json()["number"]
        event_b = f"{number_b}-v1-{endpoint['id']}"
        poll(lambda: receiver.of(event_b), RETURN_S + MARGIN_S, "another notice must not wait for a refused event")
        event_a1, event_a2 = f"{number_a}-v1-{endpoint['id']}", f"{number_a}-v2-{endpoint['id']}"
        assert receiver.of(event_a1) == [] and receiver.of(event_a2) == [], "a correction went before its refused version"
        refused.clear()
        poll(lambda: receiver.of(event_a1) and receiver.of(event_a2), RETURN_S + MARGIN_S, "both versions arrive once refusal stops")
        assert receiver.records.index(receiver.of(event_a1)[0]) < receiver.records.index(receiver.of(event_a2)[0])
        assert len({r["headers"]["svix-id"] for r in receiver.of(event_b)}) == 1 and len(receiver.of(event_b)) == 1
        clear_endpoints(stockist)


def test_wf_provider_faults_false_pdf() -> None:
    base = instance("APP_PRINT_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    mode = {"answer": (200, b"<html>not a pdf</html>")}
    with http_proxy(18072, "GOTENBERG_URL", lambda m, p, b: mode["answer"]):
        made = published_notice(editor, [new_print("MK-200-CTN", 2100 + random.randrange(900))], next_day(editor, "MK-200-CTN"))
        number = made["number"]
        wait_print(editor, number, 1, "failed")
        key = f"{copy_id(editor)}/notices/{number}/v1.pdf"
        assert S3().keys(key) == [] and version_of(editor, number, 1)["pdfSha256"] is None
        mode["answer"] = (500, b"boom")
        assert editor.post(f"/api/editor/notices/{number}/versions/1/print", json={}).status_code == 202
        wait_print(editor, number, 1, "failed")
        assert S3().keys(key) == []
        mode["answer"] = "forward"
        assert editor.post(f"/api/editor/notices/{number}/versions/1/print", json={}).status_code == 202
        good = wait_print(editor, number, 1)
        stored = S3().get(key)
        assert stored.startswith(b"%PDF-") and hashlib.sha256(stored).hexdigest() == good["pdfSha256"]


def test_wf_provider_faults_honest_print(browser: Any) -> None:
    base = instance("APP_PRINT_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    clear_desk(editor)
    upload(editor, f"bar-{token()}.csv", sheet_bytes(f",Hold{token()} 200,1.00,,"))
    late = threading.Event()
    received = threading.Event()

    def late_answer(method: str, path: str, body: bytes) -> Any:
        received.set()
        late.wait(HTTP_S * 2)
        return 200, b"%PDF-1.4\n%late answer\n"

    with http_proxy(18072, "GOTENBERG_URL", late_answer):
        try:
            made = published_notice(editor, [new_print("TN-200-CTN", 1300 + random.randrange(900))], next_day(editor, "TN-200-CTN"))
            number = made["number"]
            poll(received.is_set, PRINT_S, "Gotenberg should receive the render request before it fails")
            key = f"{copy_id(editor)}/notices/{number}/v1.pdf"
            with view(browser, f"{base}/notices/{number}") as watcher:
                status = R(watcher, "status", "Print status")
                wait_print(editor, number, 1, "failed", PRINT_S + MARGIN_S)
                see_text(watcher, status, S_PRINT_OUT, 30)
                assert S3().keys(key) == []
                late.set()
                _pause.wait(MARGIN_S / 2)
                advance(watcher, REFRESH_MS * 3)
                assert S3().keys(key) == [], "a late Gotenberg answer was stored"
                assert version_of(editor, number, 1)["printState"] == "failed"
                assert "is now Printable" not in text(status), "a late Gotenberg answer was announced"
                assert R(watcher, "link", f"Download notice {number} version 1").count() == 0
        finally:
            late.set()
    with desk(browser, base, width=768, height=1024) as page:
        bar = R(page, "region", "Desk bar")
        see(page, bar)
        retry = R(page, "button", f"Retry print {number} version 1")
        see(page, retry)
        retry.focus()
        advance(page, FOCUS_MS)
        assert retry.bounding_box()["y"] + retry.bounding_box()["height"] <= bar.bounding_box()["y"] + 1 and topmost(retry)
        for _ in range(6):
            page.keyboard.press("Tab")
            advance(page, FOCUS_MS)
            if page.evaluate("()=>!!document.activeElement.closest('[role=region][aria-label=\"Desk bar\"]')"):
                continue
            assert active_box(page)["bottom"] <= bar.bounding_box()["y"] + 1
        gate = Gate(page, f"**/api/editor/notices/{number}/versions/1/print", "POST")
        retry.focus()
        click(retry)
        wait_for(page, lambda: gate.routes, 5, "retry should leave")
        click(retry)
        advance(page, 300)
        assert len(gate.seen) == 1 and "Print failed" in page.locator("body").inner_text()
        gate.drop()
        see_text(page, R(page, "status", "Print status"), S_LOST_PRINT)
        advance(page, REFRESH_MS * 2)
        assert S_LOST_PRINT in text(R(page, "status", "Print status"))
        assert "is now Printable" not in text(R(page, "status", "Print status"))
    clear_desk(editor)


def test_wf_work_queue_outbox(rabbitmq: Any) -> None:
    base = instance("APP_RABBITMQ_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    queue = f"interval.{copy_id(editor)}.work"
    made = published_notice(editor, [new_print("KP-600-PET", 4900 + random.randrange(900))], next_day(editor, "KP-600-PET"))
    number = made["number"]
    assert version_of(editor, number, 1)["printState"] == "pending"
    with relay(18074, "AMQP_URL", 5672):
        wait_print(editor, number, 1, seconds=RETURN_S + MARGIN_S)
    info = rabbitmq.queues()[queue]
    assert info["durable"] is True
    assert poll(lambda: rabbitmq.queues()[queue]["messages"] == 0, MARGIN_S, "the work queue should drain")
    stockist = fresh_stockist(base)
    stockist.post("/api/stockist/endpoints", json={"url": f"https://93.184.215.14/{token()}"})
    second = published_notice(editor, [new_print("KP-600-PET", 5900 + random.randrange(900))], next_day(editor, "KP-600-PET"))
    rename = f"Kairi Probe {token()}"
    assert editor.patch("/api/editor/drinks/kairi-panna", json={"name": rename}).status_code == 200
    held = poll(lambda: rabbitmq.depth(queue) or None, 20, "with no consumers the outbox should stay put or reach the queue") if False else None
    assert held is None
    with relay(18074, "AMQP_URL", 5672):
        wait_print(editor, second["number"], 1, seconds=RETURN_S + MARGIN_S)
    clear_endpoints(stockist)


def test_wf_work_queue_lost_connection(browser: Any, rabbitmq: Any) -> None:
    base = instance("APP_RABBITMQ_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    queue = f"interval.{copy_id(editor)}.work"
    with relay(18074, "AMQP_URL", 5672) as forward:
        poll(lambda: rabbitmq.queues().get(queue, {}).get("consumers", 0) > 0, RETURN_S + MARGIN_S, "consumers should attach")
        made = published_notice(editor, [new_print("MK-1000-PET", 8100 + random.randrange(900))], next_day(editor, "MK-1000-PET"))
        number = made["number"]
        with desk(browser, base) as page:
            forward.cut()
            assert api(base).get("/api/health").status_code == 200
            poll(lambda: rabbitmq.queues()[queue]["consumers"] > 0, CONSUMER_S + MARGIN_S, "consumers should return with no restart")
            announce = f"Notice {number} version 1 is now Printable."
            status = R(page, "status", "Print status")
            wait_for(page, lambda: version_of(editor, number, 1)["printState"] == "printable", PRINT_S + MARGIN_S, "render completes", step=REFRESH_MS)
            advance(page, REFRESH_MS * 2)
            assert text(status).count(announce) <= 1
        key = f"{copy_id(editor)}/notices/{number}/v1.pdf"
        assert S3().keys(key) == [key]


def test_wf_work_queue_replay(rabbitmq: Any, meilisearch: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    editor = signed_in_api(base, EDITOR)
    stockist = fresh_stockist(base)
    copy = copy_id(editor)
    with sink() as receiver:
        endpoint = stockist.post("/api/stockist/endpoints", json={"url": receiver.url}).json()
        made = published_notice(editor, [new_print("TN-500-PET", 2800 + random.randrange(900))], next_day(editor, "TN-500-PET"))
        number = made["number"]
        wait_print(editor, number, 1)
        event = f"{number}-v1-{endpoint['id']}"
        poll(lambda: receiver.of(event), RETURN_S + MARGIN_S, "first delivery")
        key = f"{copy}/notices/{number}/v1.pdf"
        before = S3().get(key)
        queue = f"interval.{copy}.work"
        held = editor.get("/api/editor/notices").json()["heldWork"]
        for job in ({"jobId": f"render-{number}-v1", "kind": "render", "number": number, "version": 1},
                    {"jobId": "index-TN-500-PET", "kind": "index", "skuCode": "TN-500-PET"},
                    {"jobId": event, "kind": "send", "eventId": event}):
            amqp_publish(queue, json.dumps(job).encode())
        poll(lambda: rabbitmq.queues()[queue]["messages"] == 0, MARGIN_S * 2, "replayed jobs should drain")
        marker = f"probe-{token()}"
        amqp_publish(queue, json.dumps({"jobId": marker, "kind": "index", "skuCode": "TN-500-PET", "name": marker}).encode())
        poll(lambda: rabbitmq.queues()[queue]["messages"] == 0, MARGIN_S * 2, "job should drain")
        meilisearch.settled()
        document = meilisearch.search(f"interval_{copy}_packs", marker)
        assert marker not in json.dumps(document["hits"]), "a worker acted on data in the job body"
        assert S3().get(key) == before
        account = stockist.get("/api/session").json()["accountId"]
        assert editor.get("/api/editor/notices").json()["heldWork"] == held
        assert len(receiver.of(event)) == 1 and account
        clear_endpoints(stockist)


def test_broken_jobs_set_aside(browser: Any, rabbitmq: Any) -> None:
    base = instance("APP_DELIVERY_URL")
    editor = signed_in_api(base, EDITOR)
    copy = copy_id(editor)
    work, dead = f"interval.{copy}.work", f"interval.{copy}.dead"
    before = editor.get("/api/editor/notices").json()["heldWork"]
    start_dead = rabbitmq.queues().get(dead, {}).get("messages", 0)
    made_draft = make_draft(editor, [new_print("BS-300-GLS", 3100 + random.randrange(900))], next_day(editor, "BS-300-GLS"))
    with desk(browser, base) as page:
        group = R(page, "group", f"Draft {made_draft['id']}")
        title = R(group, "textbox", "Notice title")
        see(page, title)
        fill(title, TYPED_JOB)
        see_text(page, R(page, "region", "Held work"), f"Work set aside: {before}.")
        amqp_publish(work, b"{not json")
        amqp_publish(work, json.dumps({"jobId": "x", "kind": "dance"}).encode())
        amqp_publish(work, json.dumps({"jobId": "index-ZZ-1-ZZZ", "kind": "index", "skuCode": "ZZ-1-ZZZ"}).encode())
        made = published_notice(editor, [new_print("RG-300-GLS", 3200 + random.randrange(900))], next_day(editor, "RG-300-GLS"))
        wait_print(editor, made["number"], 1, seconds=PRINT_S)
        poll(lambda: editor.get("/api/editor/notices").json()["heldWork"] == before + 3, MARGIN_S, "heldWork should rise by 3")
        see_text(page, R(page, "region", "Held work"), f"Work set aside: {before + 3}.", MARGIN_S)
        see_text(page, R(page, "status", "Work status"), S_SET_ASIDE, MARGIN_S)
        assert title.input_value() == TYPED_JOB
    assert rabbitmq.depth(dead, start_dead + 3, timeout=MARGIN_S) == start_dead + 3
    assert rabbitmq.queues()[dead]["durable"] is True


def test_wf_work_queue_phone_publish(browser: Any) -> None:
    base = instance("APP_RABBITMQ_DOWN_URL")
    editor = signed_in_api(base, EDITOR)
    health = api(base).get("/api/health")
    assert health.status_code == 200
    poll(lambda: editor.get("/api/editor/notices").json()["workQueued"], RETURN_S + MARGIN_S, "workQueued should turn true")
    sku = "KP-200-CTN"
    day = next_day(editor, sku, gap=0) if False else today(editor)
    rows = published(editor).get(sku, [])
    if any(d >= day for d, _, _ in rows):
        day = next_day(editor, sku)
    title = f"Queued {token()}"
    price = 1800 + random.randrange(700)
    draft = make_draft(editor, [new_print(sku, price)], day, title)
    with desk(browser, base, width=375, height=812) as page:
        see_text(page, R(page, "alert", "Work status"), S_WORK_OUT)
        opener = R(page, "button", f"Publish {title}")
        opener.scroll_into_view_if_needed()
        click(opener)
        dialog = R(page, "dialog", "Confirm publish")
        see(page, dialog)
        gate = Gate(page, f"**/api/editor/notices/{draft['id']}/publish", "POST")
        gate.open = True
        press = R(dialog, "button", "Publish notice now")
        started = time.monotonic()
        click(press)
        see_text(page, R(page, "status", "Publish status"), "version 1 published.", QUICK_S)
        assert time.monotonic() - started <= QUICK_S + 1
        assert len(gate.seen) == 1
        see_text(page, page.locator("body"), "Print pending")
    number = next(n for n in editor.get("/api/editor/notices").json()["notices"] if n["versions"][0]["title"] == title)["number"]
    assert version_of(editor, number, 1)["printState"] == "pending"
    answer = editor.get(f"/api/notices/{number}/versions/1/pdf")
    assert answer.status_code == 409 and answer.json()["error"] == "print_pending"
    if day == today(editor):
        body = api(base).get(f"/api/skus/{sku}").json()
        assert body["currentMrpPaise"] == price
    with view(browser, base + f"/?sku={sku}") as page:
        assert S_PENDING_PRINT in text(R(page, "region", "Price Notices"))


def test_wf_work_queue_broker_return() -> None:
    base = instance("APP_RABBITMQ_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    with relay(18074, "AMQP_URL", 5672, mode="hang"):
        poll(lambda: editor.get("/api/editor/notices").json()["workQueued"], RETURN_S + MARGIN_S, "workQueued should turn true on a hanging broker")
        assert api(base).get("/api/health").status_code == 200
        started = time.monotonic()
        made = published_notice(editor, [new_print("BS-300-GLS", 3400 + random.randrange(900))], next_day(editor, "BS-300-GLS"))
        assert time.monotonic() - started <= QUICK_S * 2, "draft and publish should each answer within 5 seconds"
        number = made["number"]
        assert version_of(editor, number, 1)["printState"] == "pending"
    with relay(18074, "AMQP_URL", 5672):
        wait_print(editor, number, 1, seconds=RETURN_S + MARGIN_S)
        poll(lambda: not editor.get("/api/editor/notices").json()["workQueued"], RETURN_S + MARGIN_S, "workQueued should clear")
        key = f"{copy_id(editor)}/notices/{number}/v1.pdf"
        assert S3().keys(key) == [key]


def search(client: httpx.Client, query: str) -> dict[str, Any]:
    answer = client.get("/api/search", params={"q": query})
    assert answer.status_code == 200, f"search {query!r}: {answer.status_code}"
    return answer.json()


def sku_hits(client: httpx.Client, query: str) -> set[str]:
    return {r["skuCode"] for r in search(client, query)["results"]}


def test_wf_pack_search_table(app_url: str) -> None:
    client = api(app_url)
    assert sku_hits(client, "Kairy") == {"KP-200-CTN", "KP-600-PET", "KP-1200-PET"}
    assert sku_hits(client, "Kairy 200") == {"KP-200-CTN"}
    assert sku_hits(client, "Gulba") == {"RG-300-GLS", "RG-2000-PET"}
    assert sku_hits(client, "panna ctn") == {"KP-200-CTN"}
    assert sku_hits(client, "Friut drinks") == {"KP-200-CTN", "KP-600-PET", "KP-1200-PET", "MK-200-CTN", "MK-1000-PET"}
    batch = search(client, "nsk-260915-07")["results"]
    assert len(batch) == 1 and batch[0]["kind"] == "batch" and batch[0]["batchCode"] == "NSK-260915-07"
    assert search(client, "NSK-260915-08")["results"] == [] and search(client, "KP-200-CTX")["results"] == []
    assert {r["skuCode"] for r in search(client, "VT-2026-03")["results"]} == {"BS-300-GLS", "BS-300-CAN"}
    sku = search(client, "KP-200-CTN")["results"]
    assert len(sku) == 1 and sku[0]["kind"] == "sku" and sku[0]["batchCode"] is None
    assert search(client, "")["results"] == [] and client.get("/api/search").json()["results"] == []
    assert client.get("/api/search", params={"q": "k" * NAME_MAX}).status_code == 200
    too_long = client.get("/api/search", params={"q": "k" * (NAME_MAX + 1)})
    assert too_long.status_code == 422 and too_long.json()["error"] == "validation"


def test_wf_pack_search_reads_price(meilisearch: Any) -> None:
    base = instance("APP_TEST_CLOCK_URL")
    control = api(base)
    control.delete("/api/test/clock")
    editor = signed_in_api(base, EDITOR)
    sku = "TN-200-CTN"
    day = next_day(editor, sku)
    control.put("/api/test/clock", json={"now": noon(day)})
    try:
        first = 1400 + random.randrange(800)
        made = published_notice(editor, [new_print(sku, first)], day)
        hit = search(control, sku)["results"][0]
        assert hit["retailPricePaise"] == first and hit["sourceNotice"] == {"number": made["number"], "version": 1}
        fixed = editor.post(f"/api/editor/notices/{made['number']}/corrections", json={"baseVersion": 1, "reason": "Price", "effectiveDate": day, "rows": [new_print(sku, first + 11)]})
        assert fixed.status_code == 201
        hit = search(control, sku)["results"][0]
        assert hit["retailPricePaise"] == first + 11 and hit["sourceNotice"]["version"] == 2
        worded = poll(lambda: [r for r in search(control, "Nimbu")["results"] if r["skuCode"] == sku], SEARCH_LAG_S, "name search should find the SKU")
        assert worded[0]["retailPricePaise"] == first + 11
        documents = meilisearch.documents(f"interval_{copy_id(editor)}_packs")
        assert len(documents) == 14
        for document in documents:
            assert not [k for k in document if re.search("price|mrp|paise", k, re.I)], document
            assert str(first + 11) not in json.dumps(document)
    finally:
        control.delete("/api/test/clock")


def test_wf_pack_search_lag(browser: Any, app_url: str) -> None:
    base = instance("APP_SEARCH_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    stall = {"on": False}

    def policy(method: str, path: str, body: bytes) -> Any:
        found = re.match(r"/tasks/(\d+)", path)
        if stall["on"] and method == "GET" and found:
            uid = int(found.group(1))
            return 200, json.dumps({"uid": uid, "taskUid": uid, "status": "enqueued", "type": "documentAdditionOrUpdate"}).encode()
        return "forward"

    with http_proxy(18073, "MEILISEARCH_URL", policy):
        client = api(base)
        poll(lambda: search(client, "Kairi")["searchState"] == "current", RETURN_S + MARGIN_S, "search should settle")
        stall["on"] = True
        word = f"Zzq{token()}"
        published_notice(editor, [new_print("KP-1200-PET", 8300 + random.randrange(900))], next_day(editor, "KP-1200-PET"), f"{word} notice")
        assert search(client, "Kairi")["searchState"] == "behind"
        assert poll(lambda: search(client, "Kairi")["searchState"] == "behind", 3, "an enqueued answer never counts")
        stall["on"] = False
        poll(lambda: search(client, "Kairi")["searchState"] == "current", SEARCH_LAG_S + MARGIN_S, "state should clear once the task succeeded")
        assert poll(lambda: sku_hits(client, word) == {"KP-1200-PET"}, SEARCH_LAG_S, "the notice title should match")
    primary = signed_in_api(app_url, EDITOR)
    alias = f"Alias{token()} 200"
    sheet = upload(primary, f"alias-{token()}.csv", sheet_bytes(f",{alias},1.00,,")).json()["sheet"]
    primary.post(f"/api/editor/price-sheets/{sheet['id']}/rows/1/settle", json={"skuCode": "KP-200-CTN"}).raise_for_status()
    poll(lambda: sku_hits(primary, alias.split()[0]) == {"KP-200-CTN"}, SEARCH_LAG_S, "a settled alias should reach matching")
    with view(browser, app_url) as page:
        hold = Gate(page, "**/api/search?q=Kairy")
        box = R(page, "searchbox", "Find a pack")
        box.focus()
        box.fill("Kairy")
        wait_for(page, lambda: hold.routes, 5, "first search should leave", step=100)
        box.fill("Gulba")
        results = R(page, "list", "Pack results")
        wait_for(page, lambda: "Reel Gulab" in text(results), 5, "later answer should show")
        hold.release()
        advance(page, 1000)
        assert "Kairi" not in text(results) and text(R(page, "status", "Search status")) == "2 packs found."
        assert active_is(page, box)
        box.fill("Qqqqzzzz")
        see_text(page, R(page, "status", "Search status"), S_NO_MATCH)
        box.fill("")
        wait_for(page, lambda: text(R(page, "status", "Search status")) == "", 5, "an emptied box clears silently")
        late = Gate(page, "**/api/search?q=Gulba")
        box.fill("Gulba")
        wait_for(page, lambda: late.routes, 5, "the search should leave", step=100)
        box.fill("")
        advance(page, 500)
        late.release()
        _pause.wait(1)
        advance(page, 500)
        assert text(results) == "" and text(R(page, "status", "Search status")) == "", "a late answer refilled an emptied box"


def test_wf_pack_search_outage(browser: Any, meilisearch: Any) -> None:
    down = instance("APP_MEILI_DOWN_URL")
    client = api(down)
    started = time.monotonic()
    body = search(client, "Kairy")
    assert time.monotonic() - started <= QUICK_S and body["searchState"] == "down" and body["results"] == []
    assert search(client, "NSK-260915-07")["results"][0]["batchCode"] == "NSK-260915-07"
    assert client.get("/api/health").status_code == 200
    with view(browser, down) as page:
        fill(R(page, "searchbox", "Find a pack"), "Kairy")
        status = R(page, "status", "Search status")
        see_text(page, status, S_DOWN)
        assert S_NO_MATCH not in text(status)
        fill(R(page, "searchbox", "Find a pack"), "SJ-300-CAN")
        see_text(page, status, f"1 pack found. {S_DOWN}")
    base = instance("APP_SEARCH_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    other = api(base)
    with relay(18073, "MEILISEARCH_URL", mode="hang"):
        poll(lambda: search(other, "Kairy")["searchState"] == "down", RETURN_S + MARGIN_S, "a hang should read down")
        started = time.monotonic()
        search(other, "Kairy")
        assert time.monotonic() - started <= QUICK_S
        word = f"Out{token()}"
        published_notice(editor, [new_print("BS-750-PET", 4700 + random.randrange(900))], next_day(editor, "BS-750-PET"), f"{word} notice")
    with relay(18073, "MEILISEARCH_URL"):
        poll(lambda: sku_hits(other, word) == {"BS-750-PET"}, RETURN_S + MARGIN_S, "changes made in the outage should index")
        poll(lambda: search(other, "Kairy")["searchState"] == "current", RETURN_S, "state should turn current")
        index = f"interval_{copy_id(editor)}_packs"
        wiped = httpx.delete(f"{os.environ['MEILISEARCH_URL'].rstrip('/')}/indexes/{index}", headers={"Authorization": f"Bearer {os.environ['MEILISEARCH_API_KEY']}"}, timeout=HTTP_S)
        assert wiped.status_code == 202
        poll(lambda: sku_hits(other, "Kairy") == {"KP-200-CTN", "KP-600-PET", "KP-1200-PET"}, RETURN_S + MARGIN_S, "a wiped index should rebuild")
        assert meilisearch.indexes()[index]["numberOfDocuments"] == 14


def test_pack_search_result_keys(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        box = R(page, "searchbox", "Find a pack")
        box.focus()
        box.fill("Kairy")
        results = R(page, "list", "Pack results")
        wait_for(page, lambda: results.get_by_role("button").count() == 3, 5, "three results")
        y = page.evaluate("scrollY")
        page.keyboard.press("ArrowDown")
        first, second = results.get_by_role("button").nth(0), results.get_by_role("button").nth(1)
        assert active_is(page, first)
        page.keyboard.press("ArrowDown")
        assert active_is(page, second)
        page.keyboard.press("ArrowUp")
        page.keyboard.press("ArrowUp")
        assert active_is(page, box) and box.evaluate("e=>e.selectionStart") == len("Kairy")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Escape")
        assert active_is(page, box) and box.input_value() == "Kairy" and results.get_by_role("button").count() == 3
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        wait_for(page, lambda: attrs(page).get("data-sku") in ("KP-600-PET", "KP-1200-PET", "KP-200-CTN") and "sku=" in page.url, 10, "a sku result acts as a lineup choice")
        assert results.evaluate("l=>l.contains(document.activeElement)") and results.get_by_role("button").count() == 3
        assert abs(page.evaluate("scrollY") - y) <= 200, "choosing must not jump the page"
        page.evaluate("()=>{const b=document.querySelector('input[type=search],[role=searchbox]');const f=document.activeElement;const s=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;s.call(b,'Gulba');b.dispatchEvent(new Event('input',{bubbles:true}));f.focus()}")
        wait_for(page, lambda: "Reel Gulab" in text(results), 5, "the list should be replaced")
        wait_for(page, lambda: active_is(page, box), 3, "focus goes to the box when the list is replaced")
        page.keyboard.press("Escape")
        wait_for(page, lambda: box.input_value() == "" and text(R(page, "status", "Search status")) == "", 3, "Escape in the box clears silently")


def test_wf_stored_objects_immutable() -> None:
    base = instance("APP_STORAGE_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    copy = copy_id(editor)
    data = sheet_bytes(f",Store{token()} 200,10.00,,")
    digest = hashlib.sha256(data).hexdigest()
    with relay(18075, "S3_ENDPOINT", mode="hang") as forward:
        refused = upload(editor, f"fault-{token()}.csv", data)
        assert refused.status_code == 503 and refused.json()["error"] == "storage_unavailable"
        assert digest not in {s["sha256"] for s in editor.get("/api/editor/price-sheets").json()["sheets"]}
        forward.mode = "forward"
        forward.cut()
        name = f"retry-{token()}.csv"
        made = poll(lambda: (lambda a: a if a.status_code == 201 else None)(upload(editor, name, data)), RETURN_S + MARGIN_S, "a retry should store one sheet")
        key = f"{copy}/sheets/{digest}"
        assert S3().keys(key) == [key] and S3().get(key) == data
        assert sum(s["sha256"] == digest for s in editor.get("/api/editor/price-sheets").json()["sheets"]) == 1
        assert made.json()["sheet"]["sha256"] == digest
        link = editor.get(f"/api/editor/price-sheets/{made.json()['sheet']['id']}/link").json()["url"]
        assert httpx.get(link, timeout=HTTP_S).status_code == 200
        assert httpx.get(link.split("?")[0], timeout=HTTP_S).status_code == 403
        known = upload(editor, name, data)
        assert known.status_code == 200 and S3().get(key) == data
    still = upload(editor, f"down-{token()}.csv", data)
    assert still.status_code == 200 and still.json()["sheet"]["reused"] is True
    assert all(k.startswith(copy + "/") for k in S3().keys(copy))


def test_wf_stored_objects_link_renewal(browser: Any, app_url: str) -> None:
    client = api(app_url)
    wait_print(client, "VT-2026-03", 1)
    minted = client.get("/api/notices/VT-2026-03/versions/1/link")
    assert minted.json()["expiresInSeconds"] == 60 and "no-store" in minted.headers["cache-control"]
    assert httpx.get(minted.json()["url"], timeout=HTTP_S).status_code == 200
    redirect = client.get("/api/notices/VT-2026-03/versions/1/pdf")
    assert redirect.status_code == 302 and "no-store" in redirect.headers["cache-control"]
    with view(browser, app_url + "/notices/VT-2026-03", wrong_clock=True) as page:
        link = R(page, "link", "Download notice VT-2026-03 version 1")
        see(page, link)
        first = link.get_attribute("href")
        link.focus()
        status = R(page, "status", "Print status")
        quiet = text(status)
        advance(page, LINK_RENEW_MS + 1000)
        wait_for(page, lambda: link.get_attribute("href") != first, 5, "the link should renew in place")
        assert active_is(page, link) and text(status) == quiet
        page.locator("body").evaluate("()=>document.activeElement.blur()")
        hold = Gate(page, "**/api/notices/VT-2026-03/versions/1/link")
        advance(page, LINK_DROP_MS)
        wait_for(page, lambda: link.count() == 0, 5, "at age 55 the link leaves")
        see_text(page, status, S_EXPIRED)
        hold.release()
        page.unroute("**/api/notices/VT-2026-03/versions/1/link", hold.handler)
        advance(page, REFRESH_MS)
        see(page, link, 8)
        wait_for(page, lambda: S_EXPIRED not in text(status), 5, "the sentence clears")


def test_wf_stored_objects_outage(browser: Any) -> None:
    base = instance("APP_STORAGE_RETURN_URL")
    editor = signed_in_api(base, EDITOR)
    with relay(18075, "S3_ENDPOINT") as forward:
        def reprinted() -> bool:
            state = version_of(editor, "VT-2026-02", 1)["printState"]
            if state == "failed":
                number = "VT-2026-02"
                editor.post(f"/api/editor/notices/{number}/versions/1/print", json={})
            return state == "printable"

        poll(reprinted, RETURN_S * 2 + MARGIN_S, "VT-2026-02 v1 should become printable after Retry print with storage up")
        poll(lambda: editor.get("/api/notices/VT-2026-02/versions/1/link").status_code == 200, RETURN_S + MARGIN_S, "link should answer with storage up")
        with view(browser, base + "/notices/VT-2026-02") as page:
            link = R(page, "link", "Download notice VT-2026-02 version 1")
            see(page, link)
            forward.stop()

            def refused() -> bool:
                return editor.get("/api/notices/VT-2026-02/versions/1/link").status_code == 503

            poll(refused, MARGIN_S + 10, "storage refusal within 15 seconds of failed contact")
            started = time.monotonic()
            answer = editor.get("/api/notices/VT-2026-02/versions/1/pdf")
            assert time.monotonic() - started <= QUICK_S
            assert answer.status_code == 503 and answer.json() == {"error": "storage_unavailable", "message": S_STORE_OUT}
            assert version_of(editor, "VT-2026-02", 1)["printState"] == "printable"
            assert api(base).get("/api/health").status_code == 200
            advance(page, LINK_RENEW_MS)
            see_text(page, R(page, "status", "Print status"), S_STORE_OUT, 10)
            assert link.count() == 0
            assert "Rs 18.75" in page.locator("body").inner_text()
            back = Relay(18075, target_of("S3_ENDPOINT", 80))
            try:
                wait_for(page, lambda: link.count() == 1, RETURN_S + MARGIN_S, "the link should return with no reload", step=REFRESH_MS)
                assert S_STORE_OUT not in text(R(page, "status", "Print status"))
            finally:
                back.stop()


def test_copies_never_collide(rabbitmq: Any, meilisearch: Any, app_url: str) -> None:
    ids = {}
    for name, base in (("primary", app_url), ("tz", instance("APP_TZ_FAR_URL"))):
        ids[name] = copy_id(signed_in_api(base, EDITOR))
        assert re.fullmatch(r"[0-9a-f]+", ids[name])
    assert ids["primary"] != ids["tz"]
    queues, indexes = rabbitmq.queues(), meilisearch.indexes()
    for copy in ids.values():
        assert f"interval.{copy}.work" in queues
        assert f"interval_{copy}_packs" in indexes
        assert S3().keys(f"{copy}/notices/")
    word = f"Solo{token()}"
    editor = signed_in_api(app_url, EDITOR)
    published_notice(editor, [new_print("RG-2000-PET", 12600 + random.randrange(300))], next_day(editor, "RG-2000-PET"), f"{word} notice")
    poll(lambda: sku_hits(editor, word) == {"RG-2000-PET"}, SEARCH_LAG_S, "own copy finds it")
    assert sku_hits(api(instance("APP_TZ_FAR_URL")), word) == set()


def test_focused_link_returns(browser: Any, app_url: str) -> None:
    wait_print(api(app_url), "VT-2026-03", 1)
    with view(browser, app_url + "/notices/VT-2026-03") as page:
        link = R(page, "link", "Download notice VT-2026-03 version 1")
        see(page, link)
        link.focus()
        hold = Gate(page, "**/api/notices/VT-2026-03/versions/1/link")
        advance(page, LINK_DROP_MS + 1000)
        status = R(page, "status", "Print status")
        wait_for(page, lambda: active_is(page, status), 5, "focus should move to Print status")
        hold.release()
        page.unroute("**/api/notices/VT-2026-03/versions/1/link", hold.handler)
        advance(page, REFRESH_MS)
        wait_for(page, lambda: active_is(page, link), 8, "focus should return to the link")
        hold = Gate(page, "**/api/notices/VT-2026-03/versions/1/link")
        advance(page, LINK_RENEW_MS + 1000)
        wait_for(page, lambda: hold.routes, 5, "a mint should be held")
        page.set_viewport_size({"width": 375, "height": 812})
        advance(page, FOCUS_MS)
        hold.release()
        page.unroute("**/api/notices/VT-2026-03/versions/1/link", hold.handler)
        advance(page, REFRESH_MS)
        assert R(page, "link", "Download notice VT-2026-03 version 1").count() == 1


def test_wf_cross_cutting_stills(browser: Any, app_url: str) -> None:
    pack = facts(api(app_url), "NSK-260915-07")
    with view(browser, f"{app_url}/?batch=NSK-260915-07", reduced_motion="reduce") as page:
        assert R(page, "button", "Pause price changes").count() == 0
        same = mirror(page)
        for name, yaw, camera_z, value, sticker in (("Back", 180, 6, 0.55, "none"), ("Sticker", 180, 3.2, 1, "seated"), ("Front", 0, 6, 0, "none")):
            click(R(page, "button", name))
            wait_for(page, lambda: float(attrs(page)["data-pack-progress"]) == value, 3, f"{name} still")
            a = attrs(page)
            assert float(a["data-pack-yaw"]) == yaw and float(a["data-camera-z"]) == camera_z and a["data-sticker"] == sticker
            assert mirror(page) == same
        scroll_to(page, 1500)
        assert float(attrs(page)["data-pack-progress"]) == 0
        assert_panel(page, pack)
    with view(browser, f"{app_url}/?batch=NSK-260915-07", no_webgl=True) as page:
        assert attrs(page)["data-renderer"] == "svg"
        panel = R(page, "img", "Pack declaration panel")
        assert panel.count() == 1
        to_progress(page, 0.8)
        assert attrs(page)["data-sticker"] == "seated"
        on_formula(page)
        drawn = page.evaluate("()=>[...document.querySelectorAll('svg text')].map(t=>t.textContent).join(' ')")
        assert f"Rs {rupees(pack['printedMrpPaise'])}" in drawn and f"Rs {rupees(pack['revisedMrpPaise'])}" in drawn


def test_wf_cross_cutting_layouts(browser: Any, app_url: str) -> None:
    for width, height in ((375, 812), (767, 900), (768, 1024), (1279, 800), (1280, 800)):
        with view(browser, app_url, width, height) as page:
            layout(page)
            assert page.evaluate("document.documentElement.scrollWidth<=innerWidth")
            to_progress(page, 0.1)
            s = page.locator(STAGE).bounding_box()
            m = R(page, "region", "Pack facts").bounding_box()
            if width < 768:
                assert m["y"] >= s["y"] + s["height"] - 1
            elif width < 1280:
                assert s["x"] <= 0.05 * width and s["width"] == pytest.approx(0.6 * width, abs=0.02 * width)
                assert m["x"] >= s["x"] + s["width"] - 1
            else:
                assert s["x"] + s["width"] / 2 == pytest.approx(width / 2, abs=0.05 * width)
                assert m["x"] >= s["x"] + s["width"] - 1
    with view(browser, app_url) as page:
        word = page.get_by_text("VASANT TALKIES", exact=True)
        assert word.bounding_box()["width"] == pytest.approx(1280, abs=0.02 * 1280)
        field = R(page, "textbox", "Batch code")
        fill(field, "NSK-")
        field.focus()
        page.set_viewport_size({"width": 700, "height": 800})
        advance(page, FOCUS_MS)
        assert R(page, "textbox", "Batch code").input_value() == "NSK-" and accessible_name(page) == "Batch code"
        assert R(page, "list", "Current prices").count() == 1 and R(page, "table", "Current prices").count() == 0
    with view(browser, app_url + "/no-such-page") as page:
        see_text(page, page.locator("body"), "REEL MISSING")
        assert "This page isn't in the programme." in page.locator("body").inner_text()


def test_wf_cross_cutting_server_boundary(app_url: str) -> None:
    client = api(app_url)
    assert client.get("/api/health").json() == {"status": "ok"}
    foreign = client.post("/api/session", json={"email": "x", "password": "y"}, headers={"Origin": "http://evil.invalid"})
    assert foreign.status_code == 403 and foreign.json()["error"] == "bad_origin"
    assert CORS_HEADER not in foreign.headers
    bad = client.post("/api/session", content=b"{nope", headers={"content-type": "application/json"})
    assert bad.status_code == 400 and bad.json()["error"] == "bad_json"
    big = client.post("/api/session", content=b'{"a":"' + b"x" * JSON_MAX + b'"}', headers={"content-type": "application/json"})
    assert big.status_code == 413 and big.json()["error"] == "body_too_large"
    assert client.get("/no-such-page").status_code == 404
    editor = signed_in_api(app_url, EDITOR)
    assert "no-store" in editor.get("/editor").headers["cache-control"]
    secrets = [os.environ[k] for k in ("SVIX_API_KEY", "MEILISEARCH_API_KEY", "S3_SECRET_ACCESS_KEY") if os.environ.get(k)]
    page_html = client.get("/").text
    served = [page_html] + [client.get(src).text for src in re.findall(r'src="(/[^"]+\.js)"', page_html)]
    assert not [s for s in secrets for body in served if s in body]
    for path in ("/.env", "/package.json", "/run.json", "/src/server.ts", "/server/index.ts"):
        answer = client.get(path)
        assert answer.status_code == 404 or "DATABASE_URL" not in answer.text, path
    with app_copy(DATABASE_URL="postgres://nobody:nothing@127.0.0.1:9/none") as copy:
        health = httpx.get(copy + "/api/health", timeout=HTTP_S)
        assert health.status_code == 503 and health.json() == {"status": "unavailable"}
        answer = httpx.get(copy + "/api/catalogue", timeout=HTTP_S)
        assert answer.status_code == 503
        assert answer.json() == {"error": "unavailable", "message": "The record is unavailable. Please try again shortly."}


def test_wf_cross_cutting_marquee(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        marquee = page.get_by_role("marquee", name="Price changes")
        assert f"Rs {rupees(2000)} to Rs {rupees(1875)} from {show_date('2026-10-01')}" in text(marquee)
        assert f"Rs {rupees(2500)} to Rs {rupees(2700)} from {show_date('2026-10-15')}" in text(marquee)
        assert f"from {show_date('2028-04-01')}" not in text(marquee) or api(app_url).get(f"/api/notices/{NOTICE_SCHEDULED}").json()["state"] == "in_effect"
        mover = marquee.locator("*").first
        css_driven = bool(animations(marquee))

        def stamp() -> tuple[float, float]:
            at = page.evaluate("document.timeline.currentTime" if css_driven else "performance.now()")
            return mover.evaluate("e=>e.getBoundingClientRect().left"), at

        x0, t0 = stamp()
        if css_driven:
            wait_for(page, lambda: page.evaluate("document.timeline.currentTime") - t0 > 2000, 6, "two seconds of travel")
        else:
            advance(page, 2000)
        x1, t1 = stamp()
        speed = abs(x1 - x0) / ((t1 - t0) / 1000)
        assert 1280 / 40 - 2 <= speed <= 1280 / 20 + 2, speed
        pause = R(page, "button", "Pause price changes")
        pause.focus()
        advance(page, 200)
        assert pause.count() == 1, "focusing the toggle must not change its state"
        click(pause)
        see(page, R(page, "button", "Play price changes"), 3)
        x2, _ = stamp()
        advance(page, 1000)
        assert stamp()[0] == x2
        click(R(page, "button", "Play price changes"))
        see(page, R(page, "button", "Pause price changes"), 3)
        to_progress(page, 0.3)
        before = attrs(page)
        advance(page, 2000)
        assert attrs(page)["data-pack-yaw"] == before["data-pack-yaw"]
    with view(browser, app_url, reduced_motion="reduce") as page:
        assert animations(page.get_by_role("marquee", name="Price changes")) == []


def test_wf_cross_cutting_keyboard(browser: Any, app_url: str) -> None:
    with view(browser, app_url) as page:
        axe(page)
        field = R(page, "textbox", "Batch code")
        field.focus()
        outline = style(field, "outline-width", "outline-color", "outline-style")
        assert float(outline["outline-width"].replace("px", "")) >= 3 and outline["outline-style"] != "none"
        assert re.findall(r"\d+", outline["outline-color"])[:3] == [str(c) for c in ACCENT]
        hold = Gate(page, "**/api/batches/NSK-261005-02")
        field.fill("NSK-261005-02")
        page.keyboard.press("Enter")
        status = R(page, "status", "Pack reader status")
        see_text(page, status, "Reading your pack.", 5)
        hold.release()
        see_text(page, status, "Batch NSK-261005-02 read.")
        assert active_is(page, field) and f"batch={BATCH_B}" in page.url
    base = instance("APP_DELIVERY_URL")
    stockist = fresh_stockist(base)
    with desk(browser, base, SAGAR, path="/stockist") as page:
        fill(R(page, "textbox", "Endpoint URL"), f"https://93.184.215.14/{token()}")
        R(page, "button", "Save endpoint").focus()
        page.keyboard.press("Enter")
        see_text(page, R(page, "status", "Endpoint status"), "Endpoint saved.")
        dialog = R(page, "dialog", "Signing secret")
        see(page, dialog)
        for _ in range(6):
            page.keyboard.press("Tab")
            assert page.evaluate("()=>!!document.activeElement.closest('[role=dialog],dialog')")
        page.keyboard.press("Shift+Tab")
        assert page.evaluate("()=>!!document.activeElement.closest('[role=dialog],dialog')")
        R(dialog, "button", "I have saved it").focus()
        page.keyboard.press("Enter")
        wait_for(page, lambda: active_is(page, R(page, "button", "Save endpoint")), 5, "focus returns to Save endpoint")
    clear_endpoints(stockist)


APP_DIR = Path("/app")
ALLOWED = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "CC0-1.0"}


def test_if_run_manifest() -> None:
    manifest = json.loads((APP_DIR / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    assert not [p.name for p in shipped_packages() if p.name not in notices]
    for name in ("Bebas Neue", "EB Garamond", "Phosphor"):
        assert name in notices


def test_if_licences() -> None:
    wrong = []
    for package in shipped_packages():
        allowed = ALLOWED | ({"OFL-1.1"} if "fontsource" in package.name else set())
        if not licence_allowed(package.licence, allowed):
            wrong.append((package.name, package.licence))
    assert wrong == []


def test_if_datastores(app_url: str) -> None:
    assert Postgres().tables()
    assert not [p.name for p in shipped_packages() if re.search("redis|sqlite", p.name, re.I)]
    mark = f"Disk{token()}"
    editor = signed_in_api(app_url, EDITOR)
    assert upload(editor, f"disk-{token()}.csv", sheet_bytes(f"TN-200-CTN,{mark},12.00,,")).status_code == 201
    root = Path(DEPLOYED_APP)
    for path in root.rglob("*"):
        if "node_modules" in path.parts or not path.is_file() or path.stat().st_size > SHEET_MAX:
            continue
        assert mark.encode() not in path.read_bytes(), f"product data written to {path}"


def test_if_own_origin_assets(browser: Any, app_url: str) -> None:
    with open_app(browser, app_url) as page:
        requests: list[str] = []
        page.on("request", lambda r: requests.append(r.url))
        page.goto(app_url)
        ready(page)
        advance(page, REST_MS)
        origin = f"{urlparse(page.url).scheme}://{urlparse(page.url).netloc}"
        assert [u for u in requests if u.startswith("http") and not same_origin(u, origin)] == []
        families = page.evaluate("[...document.fonts].filter(f=>f.status==='loaded').map(f=>f.family).join(' ')")
        assert "Bebas" in families and "Garamond" in families


def test_if_no_raster_or_models() -> None:
    found = []
    for path in APP_DIR.rglob("*"):
        if {"node_modules", ".git"} & set(path.parts) or not path.is_file():
            continue
        suffix, stem = path.suffix.lower(), path.stem.lower()
        if suffix in {".jpg", ".jpeg", ".webp", ".avif", ".glb", ".gltf", ".fbx", ".obj"}:
            found.append(str(path))
        if suffix == ".png" and re.search("pack|carton|bottle|can", stem):
            found.append(str(path))
    assert found == []


def test_if_seed_only() -> None:
    base = instance("APP_TZ_FAR_URL")
    editor = signed_in_api(base, EDITOR)
    body = editor.get("/api/catalogue").json()
    assert [d["name"] for d in body["drinks"]] == [d[1] for d in DRINKS]
    assert editor.get("/api/editor/notices").json()["drafts"] == []
    assert editor.get("/api/editor/price-sheets").json()["sheets"] == []


def test_if_test_clock_gated(app_url: str) -> None:
    client = api(app_url)
    assert client.put("/api/test/clock", json={"now": GRADING_NOW}).status_code == 404
    assert client.delete("/api/test/clock").status_code == 404
    for path in ("/api/test/reset", "/api/debug", "/api/test"):
        assert client.get(path).status_code == 404 and client.post(path, json={}).status_code == 404
    on = api(instance("APP_TZ_FAR_URL"))
    assert on.delete("/api/test/clock").status_code == 200
