from __future__ import annotations

import contextlib
import csv
import io
import json
import os
import re
import secrets
import shutil
import signal
import socket
import subprocess
import tempfile
import threading
import time
import zlib
from datetime import date, datetime, time as dtime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urlparse, urlunparse
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Page

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    app_user_env,
    as_app_user,
    center,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    text,
    unique,
)


ZONE = "America/Chicago"
KZ = ZoneInfo(ZONE)
KITCHEN_NAME = "Halsted Street Kitchen"
PASSWORD = "prep-shift-2026"
INES = "ines@halsted-kitchen.test"
ROSA = "rosa@tamalcart.test"
OWEN = "owen@crumbco.test"
PRIYA = "priya@lakefrontprep.test"
TOMAS = "tomas@tamalcart.test"
LENA = "lena@tamalcart.test"
ABE = "abe@crumbco.test"
ROSA_BUSINESS = "Rosa's Tamal Cart"
CRUMB_BUSINESS = "Northside Crumb Co."
LAKE_BUSINESS = "Lakefront Meal Prep"
MAIL_FROM = "passboard@halsted-kitchen.test"

STATIONS = {
    "oven-1": ("Convection Oven 1", "28.00", 30),
    "oven-2": ("Deck Oven", "26.00", 30),
    "kettle-1": ("Steam Kettle", "32.00", 45),
    "prep-a": ("Prep Station A", "18.00", 15),
    "prep-b": ("Prep Station B", "18.00", 15),
    "cold-1": ("Walk-in Shelf 1", "6.00", 0),
}
PACKS = {
    "pack-10": ("10-hour pack", 600, "230.00"),
    "pack-25": ("25-hour pack", 1500, "525.00"),
}
OPENS = 5 * 60
CLOSES = 24 * 60
CELL = 15
BOOKING_DAYS_AHEAD = 28
CHECK_IN_OPENS = 15
MAX_FILE_BYTES = 5_000_000
MAX_UPLOAD_BYTES = 5_250_000
MAX_JSON_BYTES = 65_536
MAX_NAME_CHARS = 120
MAX_REASON = 200
MAX_ADJUST = 6000
MIN_TOKEN_CHARS = 43
PACKET_MAX_DAYS = 31
PACKET_MAX_EXPIRY_DAYS = 30
SETTLE_SECONDS = 30
HEALTH_SECONDS = 10
SWEEP_SECONDS = 15
FLIGHT_MS = (280, 400)
ROLL_MS = (200, 300)
SHAKE_MS = (250, 450)
DRAWER_MS = (175, 350)
HOVER_S = (0.12, 0.2)
STILL_MS = 1
MIN_TARGET_PX = 44
VIEWPORTS = {"375": (375, 812), "768": (768, 1024), "1280": (1280, 800)}
DESKTOP = (1280, 800)
CSV_HEADER = "date,station,business,start,end,cleaning_until,booked_hours,prepaid_hours,overage_hours,overage_amount,status,payment"
ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}
CSV_TYPE = "text/csv; charset=utf-8"
NEUTRALISED_LEADS = ("=", "+", "-", "@", "\t", "\r")
SESSION_COOKIE = "passboard_session"
COOKIE_ATTRS = ("HttpOnly", "SameSite=Lax", "Path=/")
SET_COOKIE = "Set-Cookie"
CORS_HEADER = "Access-Control-Allow-Origin"
DOC_ROSA_COI = "doc-rosa-coi"
DOC_LAKE_COI = "doc-lake-coi"
DOC_LENA_CARD = "doc-lena-card"
PACK_10 = "pack-10"

HTTP_TIMEOUT = 60
UI_SECONDS = 25
MAIL_SECONDS = 45
POLL_SLACK = 10
BOOT_SECONDS = 120
SWEEP_SETTLE = SWEEP_SECONDS + 5
TAB_LIMIT = 80
FOREIGN_ORIGIN = "http://evil.example"
BROWSER_ZONE = "Pacific/Kiritimati"
DEAD_DB_URL = "postgresql://passboard:passboard@127.0.0.1:9/passboard"
DAYTIME = dtime(10, 0)

PDF_BYTES = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\n"
PNG_BYTES = b"\x89PNG\r\n\x1a\n" + bytes(32)
JPEG_BYTES = b"\xff\xd8\xff\xe0" + bytes(32)
SVG_BYTES = b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'
HTML_BYTES = b"<html><body><script>alert(1)</script></body></html>"


@contextlib.contextmanager
def entered(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
        return
    value = next(obj)
    try:
        yield value
    finally:
        with contextlib.suppress(StopIteration):
            next(obj)


def poll(check: Callable[[], Any], seconds: float, what: str) -> Any:
    deadline = time.monotonic() + seconds
    while True:
        result = check()
        if result:
            return result
        assert time.monotonic() < deadline, f"timed out after {seconds}s waiting for {what}"


def hm(minute: int) -> str:
    return f"{minute // 60:02d}:{minute % 60:02d}"


def mins(clock: str) -> int:
    h, m = clock.split(":")
    return int(h) * 60 + int(m)


def money(value: Decimal) -> str:
    return str(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def hours(minutes: int) -> str:
    return money(Decimal(minutes) / 60)


def priced(minutes: int, rate: str) -> str:
    return money(Decimal(minutes) / 60 * Decimal(rate))


def parse_instant(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    assert parsed.tzinfo is not None, value
    return parsed


def kitchen_iso(moment: datetime) -> str:
    return moment.astimezone(KZ).isoformat(timespec="seconds")


def wall(day: date, minute: int) -> datetime:
    if minute == CLOSES:
        return datetime.combine(day + timedelta(days=1), dtime(0, 0), tzinfo=KZ)
    return datetime.combine(day, dtime(minute // 60, minute % 60), tzinfo=KZ)


def board_date(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b} {day.year}"


def paint_cost(minutes: int, balance: int, rate: str) -> str:
    prepaid = min(minutes, balance)
    return f"{minutes // 60}:{minutes % 60:02d} · {hours(prepaid)} h prepaid + ${priced(minutes - prepaid, rate)}"


def squash(value: str) -> str:
    return " ".join(value.split())


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


def tag(prefix: str) -> str:
    return unique(prefix)[0]


def purchase_path(pack_id: str) -> str:
    return f"/api/packs/{pack_id}/purchase"


def document_path(doc_id: str, suffix: str = "") -> str:
    return f"/api/documents/{doc_id}{suffix}"


class Api:
    def __init__(self, base: str, email: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.client = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, follow_redirects=False)
        self.user: dict[str, Any] | None = None
        if email:
            self.login(email)

    def login(self, email: str) -> "Api":
        r = self.client.post("/api/session", json={"email": email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        self.user = r.json()["user"]
        return self

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.client.get(path, params=params or None)

    def post(self, path: str, body: Any = None, key: str | None = None, **headers: str) -> httpx.Response:
        if key:
            headers["Idempotency-Key"] = key
        return self.client.post(path, json={} if body is None else body, headers=headers)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.client.patch(path, json=body)

    def delete(self, path: str) -> httpx.Response:
        return self.client.delete(path)

    def upload(self, fields: dict[str, str], filename: str, content: bytes, ctype: str) -> httpx.Response:
        return self.client.post("/api/documents", data=fields, files={"file": (filename, content, ctype)})


def kitchen(api: Api) -> dict[str, Any]:
    r = api.get("/api/kitchen")
    assert r.status_code == 200, r.text
    return r.json()


def server_now(api: Api) -> datetime:
    return parse_instant(kitchen(api)["now"])


def today_of(api: Api) -> date:
    return date.fromisoformat(kitchen(api)["today"])


def balance(api: Api) -> int:
    r = api.get("/api/me")
    assert r.status_code == 200, r.text
    return r.json()["balance_minutes"]


def ledger(api: Api, member_id: str | None = None) -> dict[str, Any]:
    r = api.get("/api/ledger", member_id=member_id) if member_id else api.get("/api/ledger")
    assert r.status_code == 200, r.text
    return r.json()


def segments(api: Api, station_id: str, day: date) -> list[dict[str, Any]]:
    r = api.get("/api/board", date=day.isoformat())
    assert r.status_code == 200, r.text
    for station in r.json()["stations"]:
        if station["id"] == station_id:
            return station["segments"]
    raise AssertionError(f"station {station_id} missing from board")


def booking_of(api: Api, booking_id: str) -> dict[str, Any]:
    r = api.get(f"/api/bookings/{booking_id}")
    assert r.status_code == 200, r.text
    return r.json()["booking"]


def find_free(api: Api, station_id: str, day: date, duration: int, earliest: int = OPENS,
              latest: int | None = None) -> int | None:
    tail = STATIONS[station_id][2]
    busy = [(mins(s["start"]), mins(s.get("tail_end") or s["end"])) for s in segments(api, station_id, day)]
    start = -(-max(earliest, OPENS) // CELL) * CELL
    while start + duration + tail <= CLOSES and (latest is None or start <= latest):
        end = start + duration + tail
        if all(end <= b0 or start >= b1 for b0, b1 in busy):
            return start
        start += CELL
    return None


def find_slot(api: Api, station_id: str, offsets: Any, duration: int, earliest: int = OPENS,
              latest: int | None = None) -> tuple[int, date, int]:
    today = today_of(api)
    for offset in offsets:
        day = today + timedelta(days=offset)
        start = find_free(api, station_id, day, duration, earliest, latest)
        if start is not None:
            return offset, day, start
    raise AssertionError(f"no free {duration}-minute slot on {station_id}")


def place_hold(api: Api, station_id: str, offsets: Any, duration: int, earliest: int = OPENS,
               latest: int | None = None) -> dict[str, Any]:
    for _ in range(10):
        _, day, start = find_slot(api, station_id, offsets, duration, earliest, latest)
        r = api.post("/api/holds", {"station_id": station_id, "date": day.isoformat(),
                                    "start": hm(start), "end": hm(start + duration)})
        if r.status_code == 201:
            return r.json()["hold"]
        assert r.status_code == 409 and r.json().get("error") == "slot_taken", r.text
    raise AssertionError("could not place a hold")


def confirm(api: Api, hold: dict[str, Any], key: str | None = None) -> httpx.Response:
    return api.post(f"/api/holds/{hold['id']}/confirm", {}, key=key)


def book(api: Api, station_id: str, offsets: Any, duration: int, earliest: int = OPENS,
         latest: int | None = None) -> dict[str, Any]:
    hold = place_hold(api, station_id, offsets, duration, earliest, latest)
    r = confirm(api, hold)
    assert r.status_code == 201, r.text
    return r.json()["booking"]


def book_now(api: Api, duration: int = CELL) -> dict[str, Any]:
    for _ in range(3):
        now = server_now(api).astimezone(KZ)
        start = (now.hour * 60 + now.minute) // CELL * CELL + CELL
        for station_id, (_, _, tail) in STATIONS.items():
            if start + duration + tail > CLOSES:
                continue
            r = api.post("/api/holds", {"station_id": station_id, "date": now.date().isoformat(),
                                        "start": hm(start), "end": hm(start + duration)})
            if r.status_code == 201:
                c = confirm(api, r.json()["hold"])
                assert c.status_code == 201, c.text
                return c.json()["booking"]
            if r.status_code == 422:
                break
    raise AssertionError("no station free at the next 15-minute cell today")


def adjust(ines: Api, member_id: str, minutes: int, reason: str) -> dict[str, Any]:
    r = ines.post("/api/ledger/adjustments", {"member_id": member_id, "minutes": minutes, "reason": reason})
    assert r.status_code == 201, r.text
    return r.json()


def cap_balance(ines: Api, member: Api, member_id: str, minutes: int) -> None:
    while (extra := balance(member) - minutes) > 0:
        adjust(ines, member_id, -min(extra // CELL * CELL or CELL, MAX_ADJUST), tag("cap"))


def new_packet(ines: Api, start: date, end: date, expires: datetime) -> dict[str, Any]:
    r = ines.post("/api/packets", {"from": start.isoformat(), "to": end.isoformat(), "expires_at": kitchen_iso(expires)})
    assert r.status_code == 201, r.text
    return r.json()["packet"]


def check_in(api: Api, booking_id: str) -> httpx.Response:
    return api.post(f"/api/bookings/{booking_id}/check-ins", {})


def wait_server_until(api: Api, instant: datetime) -> None:
    remaining = max(0.0, (instant - server_now(api)).total_seconds())
    poll(lambda: server_now(api) >= instant, remaining + POLL_SLACK, f"server clock to reach {instant}")


def mail_matches(mail: Any, to: str, subject: Any, body: tuple[Any, ...] = (), settle: float | None = None) -> list[dict[str, Any]]:
    messages = mail.messages() if settle is None else mail.messages(settle=settle)
    found = []
    for message in messages:
        if to.lower() not in [a.lower() for a in addresses(message.get("To"))]:
            continue
        subj = message.get("Subject", "")
        if not (subject(subj) if callable(subject) else subj == subject):
            continue
        content = text(message)
        if all(any(p in content for p in part) if isinstance(part, tuple) else part in content for part in body):
            found.append(message)
    return found


def date_forms(day: str) -> tuple[str, ...]:
    d = date.fromisoformat(day)
    return (day, f"{d.day} {d:%b} {d.year}", f"{d.day} {d:%B} {d.year}", f"{d:%b} {d.day}, {d.year}", f"{d:%B} {d.day}, {d.year}")


def await_mail(mail: Any, to: str, subject: Any, at_least: int, body: tuple[Any, ...] = ()) -> int:
    return poll(lambda: len(mail_matches(mail, to, subject, body)) >= at_least and len(mail_matches(mail, to, subject, body)),
                MAIL_SECONDS, f"{at_least} mail(s) to {to}")


def kb_purchases(killbill: Any, member_id: str) -> dict[str, float]:
    account = killbill.account_by_key(member_id)
    if account is None:
        return {}
    found: dict[str, float] = {}
    for payment in killbill.payments(account["accountId"]):
        for txn in payment.get("transactions") or []:
            if txn.get("transactionType") == "PURCHASE" and txn.get("status") == "SUCCESS":
                found[txn.get("transactionId") or payment["paymentId"]] = float(txn["amount"])
    return found


def new_purchases(killbill: Any, member_id: str, before: dict[str, float]) -> list[float]:
    return [v for k, v in kb_purchases(killbill, member_id).items() if k not in before]


def pdf_text(data: bytes) -> str:
    with contextlib.suppress(ImportError):
        import pypdf
        return "\n".join(page.extract_text() or "" for page in pypdf.PdfReader(io.BytesIO(data)).pages)
    if shutil.which("pdftotext"):
        out = subprocess.run(["pdftotext", "-", "-"], input=data, capture_output=True, timeout=HTTP_TIMEOUT)
        return out.stdout.decode("utf-8", "replace")
    chunks = []
    for raw in re.findall(rb"stream\r?\n(.*?)\r?\nendstream", data, re.S):
        with contextlib.suppress(zlib.error):
            raw = zlib.decompress(raw)
        chunks.extend(m.decode("latin-1") for m in re.findall(rb"\(((?:\\.|[^\\)])*)\)", raw))
        for m in re.findall(rb"<([0-9A-Fa-f\s]{2,})>", raw):
            with contextlib.suppress(ValueError):
                hexed = bytes.fromhex(m.decode().replace(" ", "").replace("\n", ""))
                chunks.append((hexed.decode("utf-16-be", "ignore") if hexed[:2] == b"\xfe\xff" or b"\x00" in hexed else hexed.decode("latin-1")))
    return " ".join(chunks)


def manifest() -> dict[str, Any]:
    deployed = Path(DEPLOYED_APP) / "run.json"
    return json.loads((deployed if deployed.exists() else Path("/app/run.json")).read_text())


def fresh_database() -> str:
    base = os.environ["DATABASE_URL"]
    name = "passboard_" + secrets.token_hex(6)
    subprocess.run(["psql", base, "-v", "ON_ERROR_STOP=1", "-c", f'CREATE DATABASE "{name}"'],
                   check=True, capture_output=True, timeout=HTTP_TIMEOUT)
    return urlparse(base)._replace(path="/" + name).geturl()


class Copy:
    def __init__(self, env: dict[str, str]) -> None:
        self.port = free_port()
        self.url = f"http://127.0.0.1:{self.port}"
        self.log = tempfile.NamedTemporaryFile(prefix="passboard-copy-", suffix=".log", delete=False)
        self.started = time.monotonic()
        self.proc = subprocess.Popen(
            as_app_user(manifest()["serve"]), cwd=DEPLOYED_APP,
            env=app_user_env(APP_PUBLIC_PORT=str(self.port), **env),
            stdout=self.log, stderr=subprocess.STDOUT, start_new_session=True)

    def tail(self) -> str:
        return Path(self.log.name).read_text(errors="replace")[-3000:]

    def healthy(self) -> bool:
        with contextlib.suppress(httpx.HTTPError):
            r = httpx.get(self.url + "/api/health", timeout=2)
            return r.status_code == 200 and r.json() == {"status": "ok"}
        return False

    def wait_healthy(self, seconds: float) -> float:
        while not self.healthy():
            assert self.proc.poll() is None, f"copy exited early:\n{self.tail()}"
            assert time.monotonic() - self.started < seconds, f"no health within {seconds}s:\n{self.tail()}"
        return time.monotonic() - self.started

    def stop(self) -> None:
        if self.proc.poll() is None:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(self.proc.pid, signal.SIGTERM)
            try:
                self.proc.wait(timeout=15)
            except subprocess.TimeoutExpired:
                with contextlib.suppress(ProcessLookupError):
                    os.killpg(self.proc.pid, signal.SIGKILL)
        self.log.close()


@contextlib.contextmanager
def app_copy(health_seconds: float = BOOT_SECONDS, **env: str) -> Iterator[Copy]:
    copy = Copy(env)
    try:
        copy.wait_healthy(health_seconds)
        yield copy
    finally:
        copy.stop()


@pytest.fixture(scope="module")
def daytime_url() -> Iterator[str]:
    start = datetime.combine(datetime.now(KZ).date(), DAYTIME, tzinfo=KZ)
    with app_copy(DATABASE_URL=fresh_database(), PASSBOARD_NOW=kitchen_iso(start)) as copy:
        yield copy.url


class Relay:

    def __init__(self, target_url: str) -> None:
        parsed = urlparse(target_url)
        self.target = (parsed.hostname, parsed.port or (443 if parsed.scheme == "https" else 80))
        self.port = free_port()
        self.url = urlunparse(parsed._replace(netloc=f"127.0.0.1:{self.port}"))
        self.listener: socket.socket | None = None

    def up(self) -> None:
        srv = socket.socket()
        srv.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        srv.bind(("127.0.0.1", self.port))
        srv.listen(64)
        self.listener = srv
        threading.Thread(target=self._accept, daemon=True).start()

    def _accept(self) -> None:
        assert self.listener is not None
        while True:
            try:
                client, _ = self.listener.accept()
            except OSError:
                return
            try:
                upstream = socket.create_connection(self.target, timeout=HTTP_TIMEOUT)
                upstream.settimeout(None)
            except OSError:
                client.close()
                continue
            for src, dst in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(src, dst), daemon=True).start()

    @staticmethod
    def _pipe(src: socket.socket, dst: socket.socket) -> None:
        try:
            while data := src.recv(65536):
                dst.sendall(data)
        except OSError:
            pass
        finally:
            for s in (src, dst):
                with contextlib.suppress(OSError):
                    s.shutdown(socket.SHUT_RDWR)

    def stop(self) -> None:
        if self.listener is not None:
            with contextlib.suppress(OSError):
                self.listener.shutdown(socket.SHUT_RDWR)
            self.listener.close()
            self.listener = None


def visible(locator: Any) -> bool:
    return locator.count() > 0 and locator.first.is_visible()


def wait_for(page: Page, check: Callable[[], Any], what: str, seconds: float = UI_SECONDS) -> None:
    deadline = time.monotonic() + seconds
    last = time.monotonic()
    while True:
        with contextlib.suppress(Exception):
            if check():
                return
        now = time.monotonic()
        assert now < deadline, f"timed out after {seconds}s waiting for {what}"
        advance(page, max(1.0, (now - last) * 1000))
        last = now


def updates(page: Page) -> Any:
    return page.get_by_role("status", name="Updates")


def problems(page: Page) -> Any:
    return page.get_by_role("alert", name="Problems")


def shows(locator: Any, copy: str) -> Callable[[], bool]:
    return lambda: copy in squash(locator.inner_text())


def sign_in(page: Page, email: str) -> None:
    fill(page.get_by_role("textbox", name="Email"), email)
    fill(page.get_by_label("Password"), PASSWORD)
    click(page.get_by_role("button", name="Sign in"))
    wait_for(page, lambda: page.get_by_role("navigation", name="Main").count() > 0, "signed-in frame")


@contextlib.contextmanager
def signed_in(browser: Browser, base: str, email: str, *, reduced_motion: str = "no-preference",
              viewport: tuple[int, int] = DESKTOP) -> Iterator[Page]:
    with entered(open_app(browser, base.rstrip("/") + "/", reduced_motion=reduced_motion)) as page:
        page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        sign_in(page, email)
        yield page


def nav(page: Page, name: str) -> None:
    menu = page.get_by_role("button", name="Menu")
    link = page.get_by_role("navigation", name="Main").get_by_role("link", name=name, exact=True)
    if visible(menu) and not visible(link):
        click(menu)
    wait_for(page, lambda: link.is_visible(), f"nav link {name}")
    click(link)


def show_date(page: Page, today: date, offset: int) -> None:
    wait_for(page, lambda: visible(page.get_by_role("heading", name="Line board")), "board heading")
    for step in range(1, offset + 1):
        click(page.get_by_role("button", name="Next day"))
        shown = board_date(today + timedelta(days=step))
        wait_for(page, lambda: visible(page.get_by_text(shown)), f"board date {shown}")
    wait_for(page, lambda: page.get_by_role("gridcell").count() > 0, "board cells")


def cell(page: Page, station: str, minute: int, state: str | None = None) -> Any:
    if state:
        return page.get_by_role("gridcell", name=f"{station}, {hm(minute)}, {state}", exact=True)
    return page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(station)}, {hm(minute)}, "))


def cell_point(locator: Any) -> tuple[float, float]:
    box = locator.bounding_box()
    assert box is not None
    return box["x"] + box["width"] / 2, box["y"] + box["height"] / 2


def paint_down(page: Page, station: str, minute: int) -> None:
    anchor = cell(page, station, minute).first
    anchor.evaluate("e => e.scrollIntoView({block: 'center', inline: 'center'})")
    x, y = center(anchor)
    page.mouse.move(x, y)
    page.mouse.down()
    advance(page, 50)


def paint_to(page: Page, station: str, last_cell: int) -> None:
    x, y = cell_point(cell(page, station, last_cell).first)
    page.mouse.move(x, y, steps=8)
    advance(page, 50)


VISIBLE_TEXT_JS = """e => { const box = e.getBoundingClientRect(); let out = '';
  const clip = n => { for (let a = n.parentElement; a; a = a.parentElement) { const s = getComputedStyle(a);
      if (s.overflow !== 'visible' || s.overflowX !== 'visible' || s.overflowY !== 'visible' || s.clipPath !== 'none') return a.getBoundingClientRect();
      if (a === e) break; } return box; };
  const walker = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const c = clip(t);
    for (let i = 0; i < t.data.length; i++) { const r = document.createRange(); r.setStart(t, i); r.setEnd(t, i + 1);
      const b = r.getBoundingClientRect(); const x = b.left + b.width / 2, y = b.top + b.height / 2;
      if (b.width && x >= c.left && x <= c.right && y >= c.top && y <= c.bottom && getComputedStyle(t.parentElement).visibility !== 'hidden') out += t.data[i]; } }
  return out; }"""


def visible_text(locator: Any) -> str:
    return str(locator.first.evaluate(VISIBLE_TEXT_JS))


def ticket(page: Page, station: str, day: date, start: int, end: int, state: str) -> Any:
    return page.get_by_role("button", name=f"Ticket {station}, {day.isoformat()} {hm(start)}–{hm(end)}, {state}", exact=True)


def focused(locator: Any) -> bool:
    return bool(locator.first.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"))


def focus_grid(page: Page) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if page.evaluate("() => !!document.activeElement && document.activeElement.getAttribute('role') === 'gridcell'"):
            return
    raise AssertionError("Tab never reached the line board grid")


def move_cursor(page: Page, station: str, minute: int) -> None:
    row = page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(station)}, "))
    on_row = lambda: row.evaluate_all("els => els.some(e => e === document.activeElement || e.contains(document.activeElement))")
    for key in ["ArrowDown"] * len(STATIONS) + ["ArrowUp"] * (2 * len(STATIONS)):
        if on_row():
            break
        page.keyboard.press(key)
    assert on_row(), f"cursor never reached the {station} row"
    index = row.evaluate_all("els => els.findIndex(e => e === document.activeElement || e.contains(document.activeElement))")
    delta = (minute - OPENS) // CELL - index
    for _ in range(abs(delta)):
        page.keyboard.press("ArrowRight" if delta > 0 else "ArrowLeft")
    wait_for(page, lambda: focused(cell(page, station, minute)), f"cursor on {station} {hm(minute)}")


def member_scope(page: Page, business: str) -> Any:
    form = page.get_by_role("form", name="Adjust hours")
    for role in ("row", "listitem", "article", "group", "region"):
        scope = page.get_by_role(role).filter(has_text=business).filter(has=form)
        if scope.count():
            return scope.last
    raise AssertionError(f"no Adjust hours form beside {business}")


@pytest.fixture
def s3() -> S3:
    return S3()


def test_kitchen_clock_and_settings(app_url):
    api = Api(app_url, ROSA)
    k = kitchen(api)
    assert k["name"] == KITCHEN_NAME
    assert k["time_zone"] == ZONE
    now = parse_instant(k["now"])
    assert now.utcoffset() == now.astimezone(KZ).utcoffset()
    assert k["today"] == now.astimezone(KZ).date().isoformat()
    assert (k["free_cancel_days"], k["check_in_opens_minutes"], k["booking_days_ahead"]) == (2, CHECK_IN_OPENS, BOOKING_DAYS_AHEAD)
    assert k["board"] == {"opens": "05:00", "closes": "24:00", "cell_minutes": CELL}
    assert {s["id"]: (s["name"], s["hourly_rate"], s["cleaning_minutes"]) for s in k["stations"]} == STATIONS
    assert {p["id"]: (p["name"], p["minutes"], p["price"]) for p in k["packs"]} == PACKS
    assert isinstance(k["hold_seconds"], int) and k["hold_seconds"] > 0
    poll(lambda: kitchen(api)["billing"] == "up", SETTLE_SECONDS + POLL_SLACK, "billing to report up")
    board = api.get("/api/board").json()
    assert board["date"] == board["today"] == k["today"]
    assert board["time_zone"] == ZONE
    poll(lambda: server_now(api) > now, POLL_SLACK, "server clock to advance")

    given = "2027-02-10T07:40:00-06:00"
    with app_copy(DATABASE_URL=fresh_database(), PASSBOARD_NOW=given) as copy:
        copied = kitchen(Api(copy.url, ROSA))
        started = parse_instant(copied["now"]) - parse_instant(given)
        assert timedelta(0) <= started < timedelta(seconds=BOOT_SECONDS + POLL_SLACK), copied["now"]
        assert copied["today"] == "2027-02-10"

    bad = Copy({"DATABASE_URL": fresh_database(), "PASSBOARD_NOW": "not-an-instant"})
    try:
        poll(lambda: bad.proc.poll() is not None or bad.healthy(), BOOT_SECONDS, "bad clock copy to stop")
        assert bad.proc.poll() is not None and not bad.healthy(), f"server kept running:\n{bad.tail()}"
        assert bad.tail().strip(), "no error message logged"
    finally:
        bad.stop()


def test_board_anonymity(app_url):
    rosa, owen, abe, tomas, ines = (Api(app_url, e) for e in (ROSA, OWEN, ABE, TOMAS, INES))
    hold = place_hold(rosa, "prep-b", range(5, 27), 60)
    day = date.fromisoformat(hold["date"])
    offset = (day - today_of(rosa)).days
    booking = book(rosa, "prep-b", [offset], 60, earliest=mins(hold["tail_end"]) + CELL)
    for viewer in (owen, abe):
        segs = segments(viewer, "prep-b", day)
        for item in (hold, booking):
            assert [s for s in segs if s["start"] == item["start"]] == [
                {"kind": "occupied", "start": item["start"], "end": item["tail_end"]}]
        raw = viewer.get("/api/board", date=day.isoformat()).text
        for secret in (hold["id"], booking["id"], "mbr-rosa", ROSA_BUSINESS):
            assert secret not in raw
    crew = segments(tomas, "prep-b", day)
    assert [s["kind"] for s in crew if s["start"] == booking["start"]] == ["booking"]
    assert [s for s in crew if s["start"] == hold["start"]] == [
        {"kind": "occupied", "start": hold["start"], "end": hold["tail_end"]}]
    own = segments(rosa, "prep-b", day)
    assert any(s["kind"] == "hold" and s["id"] == hold["id"] and s["tail_end"] == hold["tail_end"] for s in own)
    assert any(s["kind"] == "booking" and s["id"] == booking["id"] for s in own)
    op = [s for s in segments(ines, "prep-b", day) if s.get("id") in (hold["id"], booking["id"])]
    assert len(op) == 2 and all(s["business_name"] == ROSA_BUSINESS and s["member_id"] == "mbr-rosa" for s in op)
    assert rosa.delete(f"/api/holds/{hold['id']}").status_code == 204


def test_private_records(app_url):
    rosa, owen, abe = Api(app_url, ROSA), Api(app_url, OWEN), Api(app_url, ABE)
    booking = book(rosa, "prep-a", range(5, 27), 60)
    purchase = rosa.post(purchase_path(PACK_10), {})
    assert purchase.status_code == 201, purchase.text
    invoice_id = purchase.json()["invoice_id"]
    assert rosa.get(f"/api/invoices/{invoice_id}").status_code == 200
    hold = place_hold(rosa, "prep-a", range(5, 27), 60)
    attempts = [
        (owen, "PATCH", f"/api/holds/{hold['id']}", {"end": hold["end"]}),
        (owen, "DELETE", f"/api/holds/{hold['id']}", None),
        (owen, "POST", f"/api/holds/{hold['id']}/confirm", {}),
        (owen, "GET", f"/api/bookings/{booking['id']}", None),
        (owen, "POST", f"/api/bookings/{booking['id']}/cancel", {}),
        (owen, "GET", f"/api/invoices/{invoice_id}", None),
        (owen, "GET", "/api/invoices?member_id=mbr-rosa", None),
        (owen, "GET", document_path(DOC_ROSA_COI), None),
        (owen, "GET", "/api/ledger?member_id=mbr-rosa", None),
        (abe, "GET", document_path(DOC_ROSA_COI), None),
    ]
    for api, method, path, body in attempts:
        r = api.client.request(method, path, json=body)
        assert r.status_code == 404, f"{method} {path}: {r.status_code} {r.text}"
        assert r.json() == {"error": "not_found"}
    assert all(b["id"] != booking["id"] for b in owen.get("/api/bookings").json()["bookings"])
    assert any(s.get("id") == hold["id"] and s["kind"] == "hold" for s in segments(rosa, "prep-a", date.fromisoformat(hold["date"])))
    assert booking_of(rosa, booking["id"])["status"] == "confirmed"
    assert rosa.delete(f"/api/holds/{hold['id']}").status_code == 204


RACE_CASES = ["same_span", "cleaning_tail"]
RACERS = 8


@pytest.mark.parametrize("case", RACE_CASES, ids=RACE_CASES)
def test_one_hold_wins_each_cell(app_url, case):
    probe = Api(app_url, ROSA)
    _, day, start = find_slot(probe, "oven-2", range(2, 27), 120)
    spans = [(start, start + 60)] * RACERS if case == "same_span" else [
        (start, start + 60) if i % 2 == 0 else (start + 60, start + 120) for i in range(RACERS)]
    clients = [Api(app_url, ROSA if i % 2 == 0 else OWEN) for i in range(RACERS)]
    barrier = threading.Barrier(RACERS)
    results: list[httpx.Response | None] = [None] * RACERS

    def race(i: int) -> None:
        body = {"station_id": "oven-2", "date": day.isoformat(), "start": hm(spans[i][0]), "end": hm(spans[i][1])}
        barrier.wait()
        results[i] = clients[i].post("/api/holds", body)

    threads = [threading.Thread(target=race, args=(i,)) for i in range(RACERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT)
    statuses = [r.status_code for r in results if r is not None]
    assert len(statuses) == RACERS
    winners = [i for i, r in enumerate(results) if r is not None and r.status_code == 201]
    assert len(winners) == 1, statuses
    for i, r in enumerate(results):
        if i not in winners:
            assert r is not None and r.status_code == 409 and r.json() == {"error": "slot_taken"}, r and r.text
    ines = Api(app_url, INES)
    window = [s for s in segments(ines, "oven-2", day) if start <= mins(s["start"]) < start + 120]
    assert len(window) == 1
    hold = results[winners[0]].json()["hold"]
    assert clients[winners[0]].delete(f"/api/holds/{hold['id']}").status_code == 204


PLACEMENT_CASES = ["off_grid", "end_before_start", "past_closing", "in_the_past", "too_far_ahead",
                   "unknown_station", "invalid_date", "day_28_allowed", "insurance_lapsed"]


@pytest.mark.parametrize("case", PLACEMENT_CASES, ids=PLACEMENT_CASES)
def test_hold_placement_rules(app_url, case):
    rosa = Api(app_url, ROSA)
    today = today_of(rosa)
    future = (today + timedelta(days=10)).isoformat()
    bodies = {
        "off_grid": ({"station_id": "oven-1", "date": future, "start": "06:10", "end": "07:00"}, ("start", "not_on_grid")),
        "end_before_start": ({"station_id": "oven-1", "date": future, "start": "08:00", "end": "07:00"}, ("end", "end_before_start")),
        "past_closing": ({"station_id": "oven-1", "date": future, "start": "23:30", "end": "24:00"}, ("end", "outside_board_hours")),
        "in_the_past": ({"station_id": "oven-1", "date": (today - timedelta(days=1)).isoformat(), "start": "06:00", "end": "07:00"}, ("start", "in_the_past")),
        "too_far_ahead": ({"station_id": "oven-1", "date": (today + timedelta(days=BOOKING_DAYS_AHEAD + 1)).isoformat(), "start": "06:00", "end": "07:00"}, ("date", "too_far_ahead")),
        "unknown_station": ({"station_id": "oven-9", "date": future, "start": "06:00", "end": "07:00"}, ("station_id", "unknown")),
        "invalid_date": ({"station_id": "oven-1", "date": "2027-02-30", "start": "06:00", "end": "07:00"}, ("date", "invalid")),
    }
    if case == "day_28_allowed":
        hold = place_hold(rosa, "cold-1", [BOOKING_DAYS_AHEAD], 60)
        assert hold["date"] == (today + timedelta(days=BOOKING_DAYS_AHEAD)).isoformat()
        assert rosa.delete(f"/api/holds/{hold['id']}").status_code == 204
        return
    if case == "insurance_lapsed":
        priya = Api(app_url, PRIYA)
        day = today + timedelta(days=12)
        start = find_free(priya, "cold-1", day, 60)
        assert start is not None
        r = priya.post("/api/holds", {"station_id": "cold-1", "date": day.isoformat(), "start": hm(start), "end": hm(start + 60)})
        assert r.status_code == 409, r.text
        assert r.json() == {"error": "documents_not_current", "missing": ["liability_insurance"]}
        assert not [s for s in segments(priya, "cold-1", day) if s["kind"] == "hold"]
        return
    body, (field, code) = bodies[case]
    r = rosa.post("/api/holds", body)
    assert r.status_code == 422, r.text
    assert r.json()["error"] == "validation_failed"
    assert r.json()["errors"][field] == code
    with contextlib.suppress(ValueError):
        day = date.fromisoformat(body["date"])
        if body["station_id"] in STATIONS and today <= day <= today + timedelta(days=BOOKING_DAYS_AHEAD):
            assert not [s for s in segments(rosa, body["station_id"], day) if s["kind"] == "hold" and s["start"] == body["start"]]


def test_hold_expiry_edge(app_url):
    owen, rosa = Api(app_url, OWEN), Api(app_url, ROSA)
    hold_seconds = kitchen(owen)["hold_seconds"]
    hold = place_hold(owen, "oven-1", range(5, 27), 60)
    expires = parse_instant(hold["expires_at"])
    assert expires - parse_instant(hold["created_at"]) == timedelta(seconds=hold_seconds)
    live = [s for s in segments(owen, "oven-1", date.fromisoformat(hold["date"])) if s.get("id") == hold["id"]]
    assert live and live[0]["kind"] == "hold"
    wait_server_until(owen, expires + timedelta(seconds=1))
    for method, path, body in (("PATCH", f"/api/holds/{hold['id']}", {"end": hm(mins(hold["end"]) - CELL)}),
                               ("DELETE", f"/api/holds/{hold['id']}", None)):
        r = owen.client.request(method, path, json=body)
        assert r.status_code == 409 and r.json() == {"error": "hold_expired"}, f"{method}: {r.text}"
    assert not [s for s in segments(owen, "oven-1", date.fromisoformat(hold["date"])) if s.get("id") == hold["id"]]
    taken = rosa.post("/api/holds", {"station_id": "oven-1", "date": hold["date"], "start": hold["start"], "end": hold["end"]})
    assert taken.status_code == 201, taken.text
    assert rosa.delete(f"/api/holds/{taken.json()['hold']['id']}").status_code == 204


def test_confirm_after_expiry_changes_nothing(app_url, killbill, mail):
    owen, ines = Api(app_url, OWEN), Api(app_url, INES)
    cap_balance(ines, owen, "mbr-crumb", 6 * 60)
    adjust(ines, "mbr-crumb", 60, tag("expired"))
    hold = place_hold(owen, "kettle-1", range(5, 27), balance(owen) + 60)
    assert hold["preview"]["overage_minutes"] == 60
    subject = f"Booking confirmed: Steam Kettle on {hold['date']}"
    mails_before = len(mail_matches(mail, OWEN, subject))
    purchases_before = kb_purchases(killbill, "mbr-crumb")
    ledger_before = ledger(owen)
    wait_server_until(owen, parse_instant(hold["expires_at"]) + timedelta(seconds=1))
    r = confirm(owen, hold)
    assert r.status_code == 409 and r.json() == {"error": "hold_expired"}, r.text
    assert ledger(owen) == ledger_before
    assert not [b for b in owen.get("/api/bookings", **{"from": hold["date"], "to": hold["date"]}).json()["bookings"] if b["hold_id"] == hold["id"]]
    assert new_purchases(killbill, "mbr-crumb", purchases_before) == []
    assert len(mail_matches(mail, OWEN, subject, settle=SWEEP_SETTLE)) == mails_before


def test_resize_and_release(app_url):
    rosa, owen = Api(app_url, ROSA), Api(app_url, OWEN)
    _, day, s = find_slot(rosa, "prep-a", range(3, 27), 180)
    body = {"station_id": "prep-a", "date": day.isoformat(), "start": hm(s), "end": hm(s + 60)}
    hold = rosa.post("/api/holds", body).json()["hold"]
    r = rosa.patch(f"/api/holds/{hold['id']}", {"end": hm(s + 90)})
    assert r.status_code == 200, r.text
    resized = r.json()["hold"]
    assert (resized["start"], resized["end"], resized["tail_end"]) == (hm(s), hm(s + 90), hm(s + 105))
    assert resized["expires_at"] == hold["expires_at"]
    blocker = owen.post("/api/holds", {**body, "start": hm(s + 120), "end": hm(s + 150)})
    assert blocker.status_code == 201, blocker.text
    clash = rosa.patch(f"/api/holds/{hold['id']}", {"end": hm(s + 120)})
    assert clash.status_code == 409 and clash.json() == {"error": "slot_taken"}
    own = [x for x in segments(rosa, "prep-a", day) if x.get("id") == hold["id"]]
    assert own and own[0]["end"] == hm(s + 90)
    bad = rosa.patch(f"/api/holds/{hold['id']}", {"end": hm(s)})
    assert bad.status_code == 422 and bad.json()["errors"]["end"] == "end_before_start"
    assert rosa.delete(f"/api/holds/{hold['id']}").status_code == 204
    retaken = owen.post("/api/holds", body)
    assert retaken.status_code == 201, retaken.text
    again = rosa.delete(f"/api/holds/{hold['id']}")
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition"}
    late = confirm(rosa, hold)
    assert late.status_code == 409 and late.json() == {"error": "invalid_transition"}
    for h in (blocker, retaken):
        assert owen.delete(f"/api/holds/{h.json()['hold']['id']}").status_code == 204


def test_prepaid_first_then_overage(app_url, killbill, mail):
    owen, ines = Api(app_url, OWEN), Api(app_url, INES)
    adjust(ines, "mbr-crumb", 60, tag("goodwill"))
    prepaid = balance(owen)
    duration = prepaid + 120
    rate = STATIONS["oven-1"][1]
    before = kb_purchases(killbill, "mbr-crumb")
    hold = place_hold(owen, "oven-1", range(3, 27), duration)
    assert hold["preview"] == {"booked_minutes": duration, "prepaid_minutes": prepaid,
                               "overage_minutes": 120, "overage_amount": priced(120, rate)}
    r = confirm(owen, hold)
    assert r.status_code == 201, r.text
    booking = r.json()["booking"]
    assert (booking["prepaid_minutes"], booking["overage_minutes"]) == (prepaid, 120)
    assert booking["overage_amount"] == priced(120, rate)
    assert booking["list_amount"] == priced(duration, rate)
    assert booking["status"] == "confirmed"
    poll(lambda: booking_of(owen, booking["id"])["payment"] == "paid", SETTLE_SECONDS, "overage payment")
    book_ledger = ledger(owen)
    debits = [t for t in book_ledger["transactions"] if t["booking_id"] == booking["id"]]
    assert [t["kind"] for t in debits] == ["booking_debit"]
    assert debits[0]["member_minutes"] == -prepaid
    assert {e["account"] for e in debits[0]["entries"]} == {"member:mbr-crumb", "kitchen:used"}
    assert sum(e["minutes"] for e in debits[0]["entries"]) == 0
    assert book_ledger["balance_minutes"] == 0
    account = killbill.account_by_key("mbr-crumb")
    assert account is not None and account.get("email") == OWEN
    assert new_purchases(killbill, "mbr-crumb", before) == [float(priced(120, rate))]
    subject = (f"Invoice notice: ${priced(120, rate)} for Overage {booking['id']}: Convection Oven 1 "
               f"{booking['date']} {booking['start']}–{booking['end']}")
    await_mail(mail, OWEN, subject, 1)


def test_idempotent_replay(app_url, killbill):
    owen, ines = Api(app_url, OWEN), Api(app_url, INES)
    adjust(ines, "mbr-crumb", 60, tag("replay"))
    duration = balance(owen) + 60
    _, day, s = find_slot(owen, "oven-2", range(3, 27), duration)
    body = {"station_id": "oven-2", "date": day.isoformat(), "start": hm(s), "end": hm(s + duration)}
    hold_key = idempotency_key()
    first = owen.post("/api/holds", body, key=hold_key)
    assert first.status_code == 201, first.text
    replay = owen.post("/api/holds", body, key=hold_key)
    assert replay.status_code == 201 and replay.json() == first.json()
    assert replay.headers.get("Idempotent-Replay") == "true"
    assert len([x for x in segments(owen, "oven-2", day) if x["kind"] == "hold" and x["start"] == hm(s)]) == 1
    hold = first.json()["hold"]
    before = kb_purchases(killbill, "mbr-crumb")
    key = idempotency_key()
    c1 = confirm(owen, hold, key)
    assert c1.status_code == 201, c1.text
    c2 = confirm(owen, hold, key)
    assert c2.status_code == 201 and c2.json() == c1.json()
    assert c2.headers.get("Idempotent-Replay") == "true"
    reused = owen.post("/api/holds", {**body, "start": hm(s + CELL)}, key=key)
    assert reused.status_code == 422 and reused.json() == {"error": "idempotency_key_reused"}
    plain = confirm(owen, hold)
    assert plain.status_code == 409 and plain.json() == {"error": "invalid_transition"}
    booking = c1.json()["booking"]
    poll(lambda: booking_of(owen, booking["id"])["payment"] == "paid", SETTLE_SECONDS, "overage payment")
    assert [t["kind"] for t in ledger(owen)["transactions"] if t["booking_id"] == booking["id"]] == ["booking_debit"]
    assert new_purchases(killbill, "mbr-crumb", before) == [float(booking["overage_amount"])]


def test_confirmation_all_or_none(app_url, killbill, mail):
    owen, ines = Api(app_url, OWEN), Api(app_url, INES)
    cap_balance(ines, owen, "mbr-crumb", 6 * 60)
    adjust(ines, "mbr-crumb", 60, tag("allornone"))
    prepaid = balance(owen)
    hold = place_hold(owen, "kettle-1", range(3, 27), prepaid + 60)
    subject = f"Booking confirmed: Steam Kettle on {hold['date']}"
    mails_before = len(mail_matches(mail, OWEN, subject))
    before = kb_purchases(killbill, "mbr-crumb")
    clients = [Api(app_url, OWEN) for _ in range(RACERS)]
    barrier = threading.Barrier(RACERS)
    results: list[httpx.Response | None] = [None] * RACERS

    def race(i: int) -> None:
        barrier.wait()
        results[i] = confirm(clients[i], hold)

    threads = [threading.Thread(target=race, args=(i,)) for i in range(RACERS)]
    for t in threads:
        t.start()
    for t in threads:
        t.join(HTTP_TIMEOUT)
    assert all(r is not None for r in results)
    winners = [r for r in results if r is not None and r.status_code == 201]
    assert len(winners) == 1, [r.status_code for r in results if r is not None]
    for r in results:
        if r is not None and r.status_code != 201:
            assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}, r.text
    booking = winners[0].json()["booking"]
    assert (booking["prepaid_minutes"], booking["overage_minutes"]) == (prepaid, 60)
    poll(lambda: booking_of(owen, booking["id"])["payment"] == "paid", SETTLE_SECONDS, "overage payment")
    debits = [t for t in ledger(owen)["transactions"] if t["booking_id"] == booking["id"]]
    assert [t["kind"] for t in debits] == ["booking_debit"] and debits[0]["member_minutes"] == -prepaid
    assert balance(owen) == 0
    assert len([b for b in owen.get("/api/bookings", **{"from": hold["date"], "to": hold["date"]}).json()["bookings"]
                if b["hold_id"] == hold["id"]]) == 1
    assert new_purchases(killbill, "mbr-crumb", before) == [float(booking["overage_amount"])]
    await_mail(mail, OWEN, subject, mails_before + 1)
    assert len(mail_matches(mail, OWEN, subject, settle=SWEEP_SETTLE)) == mails_before + 1


def test_one_email_per_change(app_url, mail):
    rosa = Api(app_url, ROSA)
    hold = place_hold(rosa, "kettle-1", range(3, 27), 60)
    day = hold["date"]
    confirm_subject = f"Booking confirmed: Steam Kettle on {day}"
    cancel_subject = f"Booking cancelled: Steam Kettle on {day}"
    confirmed_before = len(mail_matches(mail, ROSA, confirm_subject))
    cancelled_before = len(mail_matches(mail, ROSA, cancel_subject))
    key = idempotency_key()
    booking = confirm(rosa, hold, key).json()["booking"]
    assert confirm(rosa, hold, key).status_code == 201
    cancel_key = idempotency_key()
    for _ in range(2):
        r = rosa.post(f"/api/bookings/{booking['id']}/cancel", {}, key=cancel_key)
        assert r.status_code == 200, r.text
    await_mail(mail, ROSA, confirm_subject, confirmed_before + 1)
    await_mail(mail, ROSA, cancel_subject, cancelled_before + 1)
    confirmations = mail_matches(mail, ROSA, confirm_subject, settle=SWEEP_SETTLE)
    assert len(confirmations) == confirmed_before + 1
    assert len(mail_matches(mail, ROSA, cancel_subject)) == cancelled_before + 1
    mine = mail_matches(mail, ROSA, confirm_subject, (f"{booking['start']}–{booking['end']}",
                                                      f"Cleaning turnover until {booking['tail_end']}",
                                                      f"Prepaid hours used: {hours(booking['prepaid_minutes'])}",
                                                      f"Overage: ${booking['overage_amount']}"))
    assert mine and MAIL_FROM in [a.lower() for a in addresses(mine[-1].get("From"))]
    assert mail_matches(mail, ROSA, cancel_subject, (f"Hours returned: {hours(booking['prepaid_minutes'])}", "No cancellation fee"))


def test_cancellation_cutoff(daytime_url):
    rosa = Api(daytime_url, ROSA)
    far = book(rosa, "prep-b", range(3, 27), 60)
    start_day = date.fromisoformat(far["date"])
    assert far["free_cancel_until"] == kitchen_iso(wall(start_day - timedelta(days=2), mins(far["start"])))
    before = balance(rosa)
    r = rosa.post(f"/api/bookings/{far['id']}/cancel", {})
    assert r.status_code == 200, r.text
    assert r.json()["booking"]["status"] == "cancelled_free" and r.json()["booking"]["fee"] is None
    refunds = [t for t in ledger(rosa)["transactions"] if t["booking_id"] == far["id"] and t["kind"] == "cancellation_refund"]
    assert len(refunds) == (1 if far["prepaid_minutes"] else 0)
    assert balance(rosa) == before + far["prepaid_minutes"]
    again = rosa.post(f"/api/bookings/{far['id']}/cancel", {})
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition"}
    assert balance(rosa) == before + far["prepaid_minutes"]

    now = server_now(rosa).astimezone(KZ)
    now_minute = now.hour * 60 + now.minute
    later = book(rosa, "cold-1", [2], 30, earliest=now_minute + 30)
    assert rosa.post(f"/api/bookings/{later['id']}/cancel", {}).json()["booking"]["status"] == "cancelled_free"
    earlier = book(rosa, "cold-1", [2], 30, latest=now_minute - 30)
    assert rosa.post(f"/api/bookings/{earlier['id']}/cancel", {}).json()["booking"]["status"] == "cancelled_with_fee"


def test_late_cancellation_fee(app_url, mail):
    rosa = Api(app_url, ROSA)
    booking = book(rosa, "oven-1", [1], 180)
    before = balance(rosa)
    r = rosa.post(f"/api/bookings/{booking['id']}/cancel", {})
    assert r.status_code == 200, r.text
    cancelled = r.json()["booking"]
    assert cancelled["status"] == "cancelled_with_fee"
    assert cancelled["fee"]["amount"] == "42.00"
    poll(lambda: booking_of(rosa, booking["id"])["fee"]["status"] == "charged", SETTLE_SECONDS, "fee charged")
    refunds = [t for t in ledger(rosa)["transactions"] if t["booking_id"] == booking["id"] and t["kind"] == "cancellation_refund"]
    assert len(refunds) == (1 if booking["prepaid_minutes"] else 0)
    for t in refunds:
        assert t["member_minutes"] == booking["prepaid_minutes"]
        assert sum(e["minutes"] for e in t["entries"]) == 0
        assert {e["account"] for e in t["entries"]} == {"member:mbr-rosa", "kitchen:used"}
    assert balance(rosa) == before + booking["prepaid_minutes"]
    again = rosa.post(f"/api/bookings/{booking['id']}/cancel", {})
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition"}
    assert balance(rosa) == before + booking["prepaid_minutes"]
    notice = f"Invoice notice: $42.00 for Late cancellation {booking['id']}"
    await_mail(mail, ROSA, notice, 1)
    assert len(mail_matches(mail, ROSA, notice, settle=SWEEP_SETTLE)) == 1
    assert mail_matches(mail, ROSA, f"Booking cancelled: Convection Oven 1 on {booking['date']}", ("Late-cancellation fee: $42.00",))


def test_fee_waiver(app_url, killbill):
    rosa, ines = Api(app_url, ROSA), Api(app_url, INES)
    booking = book(rosa, "prep-b", [1], 60)
    assert rosa.post(f"/api/bookings/{booking['id']}/cancel", {}).status_code == 200
    poll(lambda: booking_of(rosa, booking["id"])["fee"]["status"] == "charged", SETTLE_SECONDS, "fee charged")
    r = ines.post(f"/api/bookings/{booking['id']}/waive-fee", {})
    assert r.status_code == 200, r.text
    assert r.json()["booking"]["fee"]["status"] == "waived"
    again = ines.post(f"/api/bookings/{booking['id']}/waive-fee", {})
    assert again.status_code == 409 and again.json() == {"error": "invalid_transition"}
    free = book(rosa, "prep-b", range(4, 27), 60)
    assert rosa.post(f"/api/bookings/{free['id']}/cancel", {}).status_code == 200
    nothing = ines.post(f"/api/bookings/{free['id']}/waive-fee", {})
    assert nothing.status_code == 409 and nothing.json() == {"error": "invalid_transition"}
    credit = f"Waived late cancellation {booking['id']}"
    fee = money(Decimal(booking["list_amount"]) / 2)
    assert killbill.account_by_key("mbr-rosa") is not None

    def credited() -> bool:
        listed = rosa.get("/api/invoices")
        if listed.status_code != 200:
            return False
        items = [item for inv in listed.json()["invoices"] for item in inv.get("items") or []]
        return any(credit in str(item.get("description") or "") and money(abs(Decimal(str(item["amount"])))) == fee
                   for item in items)

    poll(credited, SETTLE_SECONDS, "waiver credit in Kill Bill")


KITCHEN_ACCOUNT = {"opening": "kitchen:issued", "pack_purchase": "kitchen:issued", "adjustment": "kitchen:issued",
                   "booking_debit": "kitchen:used", "cancellation_refund": "kitchen:used"}


def test_paired_ledger(app_url):
    ines, rosa = Api(app_url, INES), Api(app_url, ROSA)
    adjust(ines, "mbr-lake", CELL, tag("pairing"))
    listed = {m["id"]: m["balance_minutes"] for m in ines.get("/api/members").json()["members"]}
    for member_id in ("mbr-rosa", "mbr-crumb", "mbr-lake"):
        book_ledger = ledger(ines, member_id)
        by_id = {t["id"]: t for t in book_ledger["transactions"]}
        total = 0
        for t in book_ledger["transactions"]:
            assert len(t["entries"]) == 2, t
            assert sum(e["minutes"] for e in t["entries"]) == 0, t
            member = [e for e in t["entries"] if e["account"] == f"member:{member_id}"]
            other = [e for e in t["entries"] if e["account"] != f"member:{member_id}"]
            assert len(member) == 1 and member[0]["minutes"] == t["member_minutes"]
            expected = KITCHEN_ACCOUNT.get(t["kind"]) or [e["account"] for e in by_id[t["reverses"]]["entries"] if not e["account"].startswith("member:")][0]
            assert other[0]["account"] == expected, t
            total += t["member_minutes"]
        assert book_ledger["balance_minutes"] == total == listed[member_id]
    openings = {t["id"]: t["member_minutes"] for t in ledger(ines, "mbr-lake")["transactions"] + ledger(ines, "mbr-rosa")["transactions"] if t["kind"] == "opening"}
    assert openings.get("txn-open-lake") == 600
    assert openings.get("txn-open-rosa") == 360
    assert ledger(rosa)["balance_minutes"] == listed["mbr-rosa"]


def test_adjust_and_reverse(app_url):
    ines, priya = Api(app_url, INES), Api(app_url, PRIYA)
    for minutes in (0, 10, MAX_ADJUST + CELL, -(MAX_ADJUST + CELL)):
        r = ines.post("/api/ledger/adjustments", {"member_id": "mbr-lake", "minutes": minutes, "reason": "x"})
        assert r.status_code == 422 and r.json()["errors"]["minutes"] == "invalid", (minutes, r.text)
    for reason in ("", "x" * (MAX_REASON + 1)):
        r = ines.post("/api/ledger/adjustments", {"member_id": "mbr-lake", "minutes": 60, "reason": reason})
        assert r.status_code == 422 and r.json()["errors"]["reason"] == "length"
    start = balance(priya)
    top = adjust(ines, "mbr-lake", MAX_ADJUST, "x" * MAX_REASON)
    assert top["balance_minutes"] == start + MAX_ADJUST
    reason = tag("goodwill")
    made = adjust(ines, "mbr-lake", 60, reason)
    txn = made["transaction"]
    assert (txn["kind"], txn["member_minutes"], txn["reason"]) == ("adjustment", 60, reason)
    bad_reason = ines.post(f"/api/ledger/transactions/{txn['id']}/reverse", {"reason": ""})
    assert bad_reason.status_code == 422 and bad_reason.json()["errors"]["reason"] == "length"
    drains, current = [], balance(priya)
    while current:
        step = min(current, MAX_ADJUST)
        drains.append(adjust(ines, "mbr-lake", -step, "drain")["transaction"])
        current -= step
    short = ines.post("/api/ledger/adjustments", {"member_id": "mbr-lake", "minutes": -CELL, "reason": "x"})
    assert short.status_code == 409 and short.json() == {"error": "insufficient_hours"}
    blocked = ines.post(f"/api/ledger/transactions/{txn['id']}/reverse", {"reason": "mistake"})
    assert blocked.status_code == 409 and blocked.json() == {"error": "insufficient_hours"}
    for d in reversed(drains):
        assert ines.post(f"/api/ledger/transactions/{d['id']}/reverse", {"reason": "undo drain"}).status_code == 201
    r = ines.post(f"/api/ledger/transactions/{txn['id']}/reverse", {"reason": "mistake"})
    assert r.status_code == 201, r.text
    reversal = r.json()["transaction"]
    assert (reversal["kind"], reversal["reverses"], reversal["member_minutes"]) == ("reversal", txn["id"], -60)
    rows = {t["id"]: t for t in ledger(ines, "mbr-lake")["transactions"]}
    assert rows[txn["id"]]["reversed_by"] == reversal["id"] and rows[txn["id"]]["member_minutes"] == 60
    again = ines.post(f"/api/ledger/transactions/{txn['id']}/reverse", {"reason": "mistake"})
    assert again.status_code == 409 and again.json() == {"error": "already_reversed"}
    assert ines.post(f"/api/ledger/transactions/{top['transaction']['id']}/reverse", {"reason": "undo"}).status_code == 201
    assert balance(priya) == start
    history = ledger(ines, "mbr-lake")["transactions"]
    pack = priya.post(purchase_path(PACK_10), {})
    assert pack.status_code == 201, pack.text
    locked = ines.post(f"/api/ledger/transactions/{pack.json()['transaction']['id']}/reverse", {"reason": "no"})
    assert locked.status_code == 409 and locked.json() == {"error": "not_reversible"}
    for method in ("PUT", "PATCH", "DELETE"):
        r = ines.client.request(method, f"/api/ledger/transactions/{txn['id']}", json={"minutes": 0})
        assert r.status_code == 405 and r.json() == {"error": "method_not_allowed"}
        assert ines.client.request(method, "/api/ledger", json={}).status_code == 405
    assert ledger(ines, "mbr-lake")["transactions"][: len(history)] == history


def test_operator_only_actions(app_url):
    rosa, tomas, ines = Api(app_url, ROSA), Api(app_url, TOMAS), Api(app_url, INES)
    today = today_of(ines)
    upload = rosa.upload({"kind": "liability_insurance", "expires_on": (today + timedelta(days=400)).isoformat()},
                         "coi.pdf", PDF_BYTES, "application/pdf")
    assert upload.status_code == 201, upload.text
    doc_id = upload.json()["document"]["id"]
    booking = book(rosa, "cold-1", range(3, 27), 30)
    packet = new_packet(ines, today - timedelta(days=7), today, server_now(ines) + timedelta(hours=1))
    before = balance(rosa)
    cases = [
        ("POST", f"/api/documents/{doc_id}/approve", {}, True),
        ("POST", f"/api/documents/{doc_id}/reject", {"reason": "x"}, True),
        ("POST", f"/api/bookings/{booking['id']}/waive-fee", {}, False),
        ("POST", "/api/ledger/adjustments", {"member_id": "mbr-rosa", "minutes": 60, "reason": "x"}, True),
        ("POST", "/api/ledger/transactions/txn-open-rosa/reverse", {"reason": "x"}, True),
        ("GET", "/api/usage", None, False),
        ("GET", f"/api/exports/usage.csv?month={today:%Y-%m}", None, False),
        ("GET", "/api/members", None, False),
        ("POST", "/api/packets", {"from": today.isoformat(), "to": today.isoformat(), "expires_at": packet["expires_at"]}, False),
        ("GET", "/api/packets", None, False),
        ("POST", f"/api/packets/{packet['id']}/revoke", {}, None),
        ("POST", f"/api/packets/{packet['id']}/regenerate", {}, None),
    ]
    for method, path, body, crew_scope in cases:
        for api in (rosa, tomas):
            r = api.client.request(method, path, json=body)
            allowed = {403, 404} if crew_scope is None or (api is tomas and crew_scope) else {403}
            assert r.status_code in allowed, f"{api.user['email']} {method} {path}: {r.status_code}"
            if r.status_code == 403:
                assert r.json() == {"error": "forbidden"}
    assert ines.get(f"/api/documents/{doc_id}").json()["document"]["status"] == "uploaded"
    assert [p for p in ines.get("/api/packets").json()["packets"] if p["id"] == packet["id"]][0]["status"] == "active"
    assert balance(rosa) == before
    assert booking_of(ines, booking["id"])["fee"] is None


def test_crew_upload_limits(app_url, s3):
    tomas, ines = Api(app_url, TOMAS), Api(app_url, INES)
    expires = (today_of(tomas) + timedelta(days=400)).isoformat()
    keys_before = set(s3.keys("documents/mbr-rosa/"))
    docs_before = {d["id"] for d in ines.get("/api/documents").json()["documents"]}
    for fields in ({"kind": "liability_insurance", "expires_on": expires},
                   {"kind": "food_handler_card", "expires_on": expires, "crew_cook_id": "usr-lena"}):
        r = tomas.upload(fields, "card.pdf", PDF_BYTES, "application/pdf")
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, r.text
    assert set(s3.keys("documents/mbr-rosa/")) == keys_before
    assert {d["id"] for d in ines.get("/api/documents").json()["documents"]} == docs_before
    own = tomas.upload({"kind": "food_handler_card", "expires_on": expires, "crew_cook_id": "usr-tomas"},
                       "card.pdf", PDF_BYTES, "application/pdf")
    assert own.status_code == 201, own.text
    doc = own.json()["document"]
    assert (doc["kind"], doc["crew_cook_id"], doc["status"], doc["expires_on"]) == ("food_handler_card", "usr-tomas", "uploaded", expires)
    queue = {d["id"] for d in ines.get("/api/documents", status="uploaded").json()["documents"]}
    assert doc["id"] in queue
    assert s3.get(f"documents/mbr-rosa/{doc['id']}") == PDF_BYTES


UPLOAD_CASES = {
    "pdf": "accept", "png": "accept", "jpeg": "accept", "exact_limit": "accept", "pdf_named_png": "accept",
    "svg": "refuse", "html_named_pdf": "refuse", "oversize": "refuse", "empty": "refuse",
    "slash_name": "refuse", "backslash_name": "refuse", "dotdot_name": "refuse", "long_name": "refuse",
}


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_upload_rules(app_url, s3, case):
    rosa = Api(app_url, ROSA)
    pad = lambda size: PDF_BYTES + bytes(size - len(PDF_BYTES))
    files = {
        "pdf": ("cert.pdf", PDF_BYTES, "application/pdf"),
        "png": ("cert.png", PNG_BYTES, "image/png"),
        "jpeg": ("cert.jpg", JPEG_BYTES, "image/jpeg"),
        "exact_limit": ("cert.pdf", pad(MAX_FILE_BYTES), "application/pdf"),
        "pdf_named_png": ("cert.png", PDF_BYTES, "image/png"),
        "svg": ("cert.pdf", SVG_BYTES, "application/pdf"),
        "html_named_pdf": ("cert.pdf", HTML_BYTES, "application/pdf"),
        "oversize": ("cert.pdf", pad(MAX_FILE_BYTES + 1), "application/pdf"),
        "empty": ("cert.pdf", b"", "application/pdf"),
        "slash_name": ("a/cert.pdf", PDF_BYTES, "application/pdf"),
        "backslash_name": ("a\\cert.pdf", PDF_BYTES, "application/pdf"),
        "dotdot_name": ("cert..pdf", PDF_BYTES, "application/pdf"),
        "long_name": ("a" * (MAX_NAME_CHARS - 3) + ".pdf", PDF_BYTES, "application/pdf"),
    }
    expected = {"svg": (415, "unsupported_file_type"), "html_named_pdf": (415, "unsupported_file_type"),
                "oversize": (413, "file_too_large"), "empty": (422, "empty"),
                "slash_name": (422, "invalid_filename"), "backslash_name": (422, "invalid_filename"),
                "dotdot_name": (422, "invalid_filename"), "long_name": (422, "invalid_filename")}
    name, content, ctype = files[case]
    expires = (today_of(rosa) + timedelta(days=200)).isoformat()
    keys_before = set(s3.keys("documents/mbr-rosa/"))
    docs_before = {d["id"] for d in rosa.get("/api/documents").json()["documents"]}
    r = rosa.upload({"kind": "liability_insurance", "expires_on": expires}, name, content, ctype)
    if UPLOAD_CASES[case] == "accept":
        assert r.status_code == 201, r.text
        doc = r.json()["document"]
        assert (doc["status"], doc["kind"], doc["expires_on"], doc["size_bytes"]) == ("uploaded", "liability_insurance", expires, len(content))
        detected = {"png": "png", "jpeg": "jpeg"}.get(case)
        assert (detected or "pdf") in doc["content_type"].lower()
        assert s3.get(f"documents/mbr-rosa/{doc['id']}") == content
        return
    status, code = expected[case]
    assert r.status_code == status, r.text
    assert (r.json()["errors"]["file"] if status == 422 else r.json()["error"]) == code
    assert set(s3.keys("documents/mbr-rosa/")) == keys_before
    assert {d["id"] for d in rosa.get("/api/documents").json()["documents"]} == docs_before


def test_files_served_inertly(app_url):
    rosa, ines, owen = Api(app_url, ROSA), Api(app_url, INES), Api(app_url, OWEN)
    r = rosa.upload({"kind": "liability_insurance", "expires_on": (today_of(rosa) + timedelta(days=200)).isoformat()},
                    "cert.html", PNG_BYTES, "text/html")
    assert r.status_code == 201, r.text
    doc = r.json()["document"]
    for api in (rosa, ines):
        got = api.get(f"/api/documents/{doc['id']}/file")
        assert got.status_code == 200 and got.content == PNG_BYTES
        assert got.headers["content-disposition"].lower().startswith("attachment")
        assert got.headers["content-type"].split(";")[0] == doc["content_type"]
        assert got.headers["x-content-type-options"].lower() == "nosniff"
        assert "sandbox" in got.headers["content-security-policy"].lower()
    seeded = poll(lambda: (lambda r: r if r.status_code == 200 else None)(rosa.get(document_path(DOC_ROSA_COI, "/file"))),
                  SETTLE_SECONDS + POLL_SLACK, "seeded document object")
    assert seeded.content.startswith(b"%PDF-")
    assert seeded.headers["content-disposition"].lower().startswith("attachment")
    assert seeded.headers["x-content-type-options"].lower() == "nosniff"
    assert "sandbox" in seeded.headers["content-security-policy"].lower()
    for path in (document_path(doc["id"], "/file"), document_path(DOC_ROSA_COI, "/file")):
        assert owen.get(path).status_code == 404
        assert httpx.get(app_url.rstrip("/") + path, timeout=HTTP_TIMEOUT).status_code == 401


def test_document_review_states(app_url):
    rosa, ines = Api(app_url, ROSA), Api(app_url, INES)
    expires = (today_of(rosa) + timedelta(days=300)).isoformat()
    first = rosa.upload({"kind": "liability_insurance", "expires_on": expires}, "a.pdf", PDF_BYTES, "application/pdf").json()["document"]
    approved = ines.post(f"/api/documents/{first['id']}/approve", {})
    assert approved.status_code == 200 and approved.json()["document"]["status"] == "approved"
    for action, body in (("approve", {}), ("reject", {"reason": "late"})):
        r = ines.post(f"/api/documents/{first['id']}/{action}", body)
        assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    second = rosa.upload({"kind": "liability_insurance", "expires_on": expires}, "b.pdf", PDF_BYTES, "application/pdf").json()["document"]
    empty = ines.post(f"/api/documents/{second['id']}/reject", {"reason": ""})
    assert empty.status_code == 422 and empty.json()["errors"]["reason"] == "length"
    reason = tag("blurry")
    rejected = ines.post(f"/api/documents/{second['id']}/reject", {"reason": reason})
    assert rejected.status_code == 200
    assert (rejected.json()["document"]["status"], rejected.json()["document"]["rejection_reason"]) == ("rejected", reason)
    late = ines.post(f"/api/documents/{second['id']}/approve", {})
    assert late.status_code == 409 and late.json() == {"error": "invalid_transition"}
    assert rosa.get(f"/api/documents/{second['id']}").json()["document"]["status"] == "rejected"
    assert ines.get(document_path(DOC_LAKE_COI)).json()["document"]["status"] == "expired"
    assert ines.get(document_path(DOC_LENA_CARD)).json()["document"]["status"] == "expired"


def test_document_coverage(app_url):
    priya, ines = Api(app_url, PRIYA), Api(app_url, INES)
    today = today_of(priya)
    last = today + timedelta(days=5)
    doc = priya.upload({"kind": "liability_insurance", "expires_on": last.isoformat()}, "coi.pdf", PDF_BYTES, "application/pdf")
    assert doc.status_code == 201, doc.text
    assert ines.post(f"/api/documents/{doc.json()['document']['id']}/approve", {}).status_code == 200
    covered = book(priya, "cold-1", [5], 60, earliest=20 * 60)
    assert covered["date"] == last.isoformat() and covered["status"] == "confirmed"
    assert priya.post(f"/api/bookings/{covered['id']}/cancel", {}).status_code == 200
    day_after = last + timedelta(days=1)
    start = find_free(priya, "cold-1", day_after, 60)
    assert start is not None
    r = priya.post("/api/holds", {"station_id": "cold-1", "date": day_after.isoformat(), "start": hm(start), "end": hm(start + 60)})
    assert r.status_code == 409 and r.json() == {"error": "documents_not_current", "missing": ["liability_insurance"]}


def test_expiry_warnings(app_url, mail):
    rosa, ines = Api(app_url, ROSA), Api(app_url, INES)
    today = today_of(rosa)
    insurance_day = (today + timedelta(days=10)).isoformat()
    card_day = (today + timedelta(days=2)).isoformat()
    s14_ins = "Certificate expires in 14 days: Liability insurance"
    s3_card = "Certificate expires in 3 days: Food handler card – Tomás Reyes"
    s14_card = "Certificate expires in 14 days: Food handler card – Tomás Reyes"
    base = {k: len(mail_matches(mail, ROSA, s, (date_forms(d),))) for k, s, d in
            (("ins", s14_ins, insurance_day), ("card3", s3_card, card_day), ("card14", s14_card, card_day))}
    ins = rosa.upload({"kind": "liability_insurance", "expires_on": insurance_day}, "coi.pdf", PDF_BYTES, "application/pdf").json()["document"]
    card = rosa.upload({"kind": "food_handler_card", "expires_on": card_day, "crew_cook_id": "usr-tomas"},
                       "card.pdf", PDF_BYTES, "application/pdf").json()["document"]
    for doc in (ins, card):
        assert ines.post(f"/api/documents/{doc['id']}/approve", {}).status_code == 200
    await_mail(mail, ROSA, s14_ins, base["ins"] + 1, (date_forms(insurance_day),))
    await_mail(mail, ROSA, s3_card, base["card3"] + 1, (date_forms(card_day),))
    assert len(mail_matches(mail, ROSA, s14_ins, (date_forms(insurance_day),), settle=SWEEP_SETTLE)) == base["ins"] + 1
    assert len(mail_matches(mail, ROSA, s3_card, (date_forms(card_day),))) == base["card3"] + 1
    assert len(mail_matches(mail, ROSA, s14_card, (date_forms(card_day),))) == base["card14"]


def test_payment_pending_outage(killbill):
    url = os.environ["APP_KILLBILL_DOWN_URL"]
    owen, ines = Api(url, OWEN), Api(url, INES)
    poll(lambda: kitchen(owen)["billing"] == "down", SETTLE_SECONDS + POLL_SLACK, "billing down")
    assert owen.get("/api/board").json()["billing"] == "down"
    before = kb_purchases(killbill, "mbr-crumb")
    duration = balance(owen) + 60
    booking = book(owen, "oven-2", range(3, 27), duration)
    assert (booking["status"], booking["payment"]) == ("confirmed", "payment_pending")
    assert booking_of(ines, booking["id"])["payment"] == "payment_pending"
    op = [s for s in segments(ines, "oven-2", date.fromisoformat(booking["date"])) if s.get("id") == booking["id"]]
    assert op and op[0]["payment"] == "payment_pending"
    ledger_before = ledger(owen)
    pack = owen.post(purchase_path(PACK_10), {})
    assert pack.status_code == 503 and pack.json() == {"error": "billing_unavailable"}
    assert ledger(owen) == ledger_before
    invoices = owen.get("/api/invoices")
    assert invoices.status_code == 503 and invoices.json() == {"error": "billing_unavailable"}
    assert new_purchases(killbill, "mbr-crumb", before) == []


def test_billing_recovers(app_url, killbill, mail):
    main_now = kitchen(Api(app_url, ROSA))["now"]
    relay = Relay(os.environ["KILLBILL_URL"])
    try:
        with app_copy(DATABASE_URL=fresh_database(), KILLBILL_URL=relay.url, PASSBOARD_NOW=main_now) as copy:
            owen, rosa, ines = Api(copy.url, OWEN), Api(copy.url, ROSA), Api(copy.url, INES)
            poll(lambda: kitchen(owen)["billing"] == "down", SETTLE_SECONDS + POLL_SLACK, "billing down")
            pending = book(owen, "oven-2", range(4, 27), balance(owen) + 120)
            assert pending["payment"] == "payment_pending"
            voided = book(owen, "kettle-1", range(4, 27), balance(owen) + 60)
            cancelled = owen.post(f"/api/bookings/{voided['id']}/cancel", {}).json()["booking"]
            assert (cancelled["status"], cancelled["payment"]) == ("cancelled_free", "voided")
            waived = book(rosa, "prep-a", [1], 60)
            assert rosa.post(f"/api/bookings/{waived['id']}/cancel", {}).json()["booking"]["fee"]["status"] == "pending"
            assert ines.post(f"/api/bookings/{waived['id']}/waive-fee", {}).json()["booking"]["fee"]["status"] == "waived"
            charged = book(rosa, "prep-b", [1], 60)
            assert rosa.post(f"/api/bookings/{charged['id']}/cancel", {}).json()["booking"]["fee"]["status"] == "pending"
            assert booking_of(ines, pending["id"])["payment"] == "payment_pending"
            before = kb_purchases(killbill, "mbr-crumb")
            relay.up()
            up_at = time.monotonic()
            poll(lambda: kitchen(owen)["billing"] == "up"
                 and booking_of(ines, pending["id"])["payment"] == "paid"
                 and booking_of(ines, charged["id"])["fee"]["status"] == "charged",
                 SETTLE_SECONDS + POLL_SLACK, "queued billing to settle")
            assert time.monotonic() - up_at <= SETTLE_SECONDS + POLL_SLACK
            assert copy.proc.poll() is None, "copy restarted or exited"
            assert booking_of(ines, voided["id"])["payment"] == "voided"
            assert booking_of(ines, waived["id"])["fee"]["status"] == "waived"
            assert new_purchases(killbill, "mbr-crumb", before) == [float(pending["overage_amount"])]
            overage = lambda s: s.startswith("Invoice notice: ") and f"Overage {pending['id']}:" in s
            await_mail(mail, OWEN, overage, 1)
            fee = money(Decimal(charged["list_amount"]) / 2)
            await_mail(mail, ROSA, f"Invoice notice: ${fee} for Late cancellation {charged['id']}", 1)
            assert len(mail_matches(mail, OWEN, overage, settle=SWEEP_SETTLE)) == 1
            assert not mail_matches(mail, OWEN, lambda s: voided["id"] in s)
            assert not mail_matches(mail, ROSA, lambda s: f"Late cancellation {waived['id']}" in s)
    finally:
        relay.stop()


def test_crew_cook_limits(app_url):
    rosa, owen, tomas, abe = Api(app_url, ROSA), Api(app_url, OWEN), Api(app_url, TOMAS), Api(app_url, ABE)
    mine = book(rosa, "cold-1", range(3, 27), 30)
    theirs = book(owen, "cold-1", range(3, 27), 15)
    span = {"from": min(mine["date"], theirs["date"]), "to": max(mine["date"], theirs["date"])}
    listed = tomas.get("/api/bookings", **span).json()["bookings"]
    assert mine["id"] in {b["id"] for b in listed} and theirs["id"] not in {b["id"] for b in listed}
    assert all(b["member_id"] == "mbr-rosa" for b in listed)
    assert tomas.get(f"/api/bookings/{mine['id']}").status_code == 200
    for method, path in (("GET", f"/api/bookings/{mine['id']}"), ("POST", f"/api/bookings/{mine['id']}/check-ins")):
        r = abe.client.request(method, path, json={} if method == "POST" else None)
        assert r.status_code == 404 and r.json() == {"error": "not_found"}, f"{method} {path}: {r.text}"
    assert mine["id"] not in {b["id"] for b in abe.get("/api/bookings", **span).json()["bookings"]}
    assert booking_of(rosa, mine["id"])["check_ins"] == []
    before = balance(rosa)
    day = date.fromisoformat(mine["date"])
    for method, path, body in (("POST", "/api/holds", {"station_id": "cold-1", "date": mine["date"], "start": "05:00", "end": "05:15"}),
                               ("POST", f"/api/bookings/{mine['id']}/cancel", {}),
                               ("POST", purchase_path(PACK_10), {})):
        r = tomas.client.request(method, path, json=body)
        assert r.status_code == 403 and r.json() == {"error": "forbidden"}, f"{path}: {r.text}"
    assert booking_of(rosa, mine["id"])["status"] == "confirmed"
    assert balance(rosa) == before
    assert not [s for s in segments(rosa, "cold-1", day) if s["kind"] == "hold" and s["start"] == "05:00"]


def test_check_in_rules(daytime_url):
    rosa, tomas, lena, ines = (Api(daytime_url, e) for e in (ROSA, TOMAS, LENA, INES))
    now_booking = book_now(rosa)
    tomorrow = book(rosa, "cold-1", [1], 30)
    cancelled = book(rosa, "cold-1", range(3, 27), 30)
    assert rosa.post(f"/api/bookings/{cancelled['id']}/cancel", {}).status_code == 200
    expect = [(lena, now_booking, "food_handler_card_not_current"), (lena, tomorrow, "outside_check_in_window"),
              (tomas, tomorrow, "outside_check_in_window"), (tomas, cancelled, "invalid_transition")]
    for api, b, code in expect:
        r = check_in(api, b["id"])
        assert r.status_code == 409 and r.json() == {"error": code}, f"{api.user['email']}: {r.text}"
    first = check_in(tomas, now_booking["id"])
    assert first.status_code == 201, first.text
    assert first.json()["booking"]["status"] == "checked_in"
    again = check_in(tomas, now_booking["id"])
    assert again.status_code == 200 and again.json()["check_in"] == first.json()["check_in"]
    for api in (ines, rosa):
        b = booking_of(api, now_booking["id"])
        assert b["status"] == "checked_in"
        assert [c["crew_cook_id"] for c in b["check_ins"]] == ["usr-tomas"]
    card = ines.get(f"/api/documents/{first.json()['check_in']['card_document_id']}").json()["document"]
    assert (card["kind"], card["crew_cook_id"], card["status"]) == ("food_handler_card", "usr-tomas", "approved")
    assert booking_of(ines, tomorrow["id"])["check_ins"] == []


def test_packet_contents(daytime_url, s3):
    rosa, tomas, ines = Api(daytime_url, ROSA), Api(daytime_url, TOMAS), Api(daytime_url, INES)
    visit = book_now(rosa)
    assert check_in(tomas, visit["id"]).status_code == 201
    absent = book(rosa, "cold-1", [0], 15, earliest=mins(visit["tail_end"]) + 60)
    today = date.fromisoformat(visit["date"])
    packet = new_packet(ines, today, today, server_now(ines) + timedelta(hours=1))
    anon = httpx.Client(base_url=daytime_url.rstrip("/"), timeout=HTTP_TIMEOUT)
    r = anon.get(f"/api/packet/{packet['token']}")
    assert r.status_code == 200, r.text
    data = r.json()
    assert (data["kitchen"], data["time_zone"], data["from"], data["to"]) == (KITCHEN_NAME, ZONE, today.isoformat(), today.isoformat())
    days = {d["date"]: d["visits"] for d in data["days"]}
    assert set(days) == {today.isoformat()}
    starts = [v["start"] for v in days[today.isoformat()]]
    assert starts == sorted(starts)
    station = STATIONS[visit["station_id"]][0]
    row = [v for v in days[today.isoformat()] if v["station"] == station and v["start"] == visit["start"]]
    assert len(row) == 1
    v = row[0]
    assert set(v) == {"business_name", "station", "start", "end", "liability_insurance", "crew"}
    assert (v["business_name"], v["end"]) == (ROSA_BUSINESS, visit["end"])
    assert v["liability_insurance"]["valid"] is True and v["liability_insurance"]["expires_on"] >= today.isoformat()
    crew = [c for c in v["crew"] if c["name"] == "Tomás Reyes"]
    assert len(crew) == 1 and set(crew[0]) == {"name", "checked_in_at", "food_handler_card"}
    assert crew[0]["food_handler_card"]["valid"] is True
    assert not [x for x in days[today.isoformat()] if x["station"] == STATIONS[absent["station_id"]][0] and x["start"] == absent["start"]]
    for secret in (ROSA, TOMAS, "mbr-rosa", visit["id"], visit["list_amount"]):
        assert secret not in r.text
    pdf = anon.get(f"/api/packet/{packet['token']}/pdf")
    assert pdf.status_code == 200 and pdf.headers["content-type"].split(";")[0] == "application/pdf"
    assert pdf.headers["content-disposition"].lower().startswith("attachment")
    assert f"compliance-packet-{today.isoformat()}-to-{today.isoformat()}.pdf" in pdf.headers["content-disposition"]
    assert pdf.content.startswith(b"%PDF-")
    stored = s3.get(f"packets/{packet['id']}.pdf")
    assert stored.startswith(b"%PDF-")
    for data in (pdf.content, stored):
        body = squash(pdf_text(data))
        assert any(squash(form) in body for form in date_forms(today.isoformat())), "visit date"
        for needle in (KITCHEN_NAME, "Tamal Cart", station, visit["start"], visit["end"], "Reyes", "Valid"):
            assert needle in body, needle


def test_packet_lifecycle(app_url, browser):
    ines = Api(app_url, INES)
    anon = httpx.Client(base_url=app_url.rstrip("/"), timeout=HTTP_TIMEOUT)
    today = today_of(ines)
    now = server_now(ines)
    for body, field, code in (
        ({"from": today.isoformat(), "to": (today - timedelta(days=1)).isoformat(), "expires_at": kitchen_iso(now + timedelta(hours=1))}, "to", "before_from"),
        ({"from": (today - timedelta(days=PACKET_MAX_DAYS)).isoformat(), "to": today.isoformat(), "expires_at": kitchen_iso(now + timedelta(hours=1))}, "to", "range_too_long"),
        ({"from": today.isoformat(), "to": today.isoformat(), "expires_at": kitchen_iso(now - timedelta(minutes=1))}, "expires_at", "not_in_future"),
        ({"from": today.isoformat(), "to": today.isoformat(), "expires_at": kitchen_iso(now + timedelta(days=PACKET_MAX_EXPIRY_DAYS + 1))}, "expires_at", "too_far"),
    ):
        r = ines.post("/api/packets", body)
        assert r.status_code == 422 and r.json()["errors"][field] == code, r.text
    packet = new_packet(ines, today - timedelta(days=7), today - timedelta(days=1), now + timedelta(hours=1))
    token = packet["token"]
    assert len(token) >= MIN_TOKEN_CHARS and re.fullmatch(r"[A-Za-z0-9_-]+=*", token)
    assert packet["url"] == f"/packet/{token}" and packet["status"] == "active"
    ok = anon.get(f"/api/packet/{token}")
    assert ok.status_code == 200
    assert ok.headers["cache-control"].lower() == "no-store" and ok.headers["referrer-policy"].lower() == "no-referrer"
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        assert anon.request(method, f"/api/packet/{token}", json={}).status_code == 405
    regenerated = ines.post(f"/api/packets/{packet['id']}/regenerate", {}).json()["packet"]
    assert regenerated["token"] != token
    assert anon.get(f"/api/packet/{token}").status_code == 404
    assert anon.get(f"/api/packet/{regenerated['token']}").status_code == 200
    revoked = ines.post(f"/api/packets/{packet['id']}/revoke", {})
    assert revoked.status_code == 200
    assert (revoked.json()["packet"]["status"], revoked.json()["packet"]["token"], revoked.json()["packet"]["url"]) == ("revoked", None, None)
    gone = anon.get(f"/api/packet/{regenerated['token']}")
    assert gone.status_code == 404 and gone.json() == {"error": "not_found"}
    assert anon.get(f"/api/packet/{regenerated['token']}/pdf").status_code == 404
    for action in ("revoke", "regenerate"):
        r = ines.post(f"/api/packets/{packet['id']}/{action}", {})
        assert r.status_code == 409 and r.json() == {"error": "invalid_transition"}
    page_response = anon.get(f"/packet/{regenerated['token']}")
    assert page_response.status_code == 404
    assert page_response.headers["cache-control"].lower() == "no-store"
    with entered(open_app(browser, f"{app_url.rstrip('/')}/packet/{regenerated['token']}")) as page:
        wait_for(page, lambda: visible(page.get_by_text("This packet link is not valid.")), "invalid notice")

    short = new_packet(ines, today - timedelta(days=3), today - timedelta(days=2), server_now(ines) + timedelta(seconds=20))
    assert anon.get(f"/api/packet/{short['token']}").status_code == 200
    wait_server_until(ines, parse_instant(short["expires_at"]))
    assert anon.get(f"/api/packet/{short['token']}").status_code == 404
    assert [p for p in ines.get("/api/packets").json()["packets"] if p["id"] == short["id"]][0]["status"] == "expired"
    revived = ines.post(f"/api/packets/{short['id']}/regenerate", {"expires_at": kitchen_iso(server_now(ines) + timedelta(hours=1))})
    assert revived.status_code == 200 and revived.json()["packet"]["status"] == "active"
    assert anon.get(f"/api/packet/{revived.json()['packet']['token']}").status_code == 200


def test_usage_export_neutralised(app_url):
    owen, ines = Api(app_url, OWEN), Api(app_url, INES)
    station_name = STATIONS["prep-a"][0]
    zero = {"booked_minutes": 0, "cleaning_minutes": 0, "bookings": 0}
    usage = lambda d: {s["station_id"]: s for s in ines.get("/api/usage", date=d.isoformat()).json()["stations"]}
    assert ines.get("/api/exports/usage.csv", month="2027-13").json()["errors"]["month"] == "invalid"
    try:
        for prefix in ("=", "+", "-", "@"):
            name = f'{prefix}1+2,"{tag("biz")[:12]}"'
            assert owen.patch("/api/members/me", {"business_name": name}).status_code == 200
            _, day, start = find_slot(owen, "prep-a", range(2, 27), 60, earliest=19 * 60)
            before, next_before = usage(day), usage(day + timedelta(days=1))
            total_before = ines.get("/api/usage", date=day.isoformat()).json()["total_booked_minutes"]
            hold = owen.post("/api/holds", {"station_id": "prep-a", "date": day.isoformat(), "start": hm(start), "end": hm(start + 60)})
            assert hold.status_code == 201, hold.text
            booking = confirm(owen, hold.json()["hold"]).json()["booking"]
            after = usage(day)
            was = before.get("prep-a", zero)
            assert after["prep-a"]["booked_minutes"] - was["booked_minutes"] == 60
            assert after["prep-a"]["cleaning_minutes"] - was["cleaning_minutes"] == STATIONS["prep-a"][2]
            assert after["prep-a"]["bookings"] - was["bookings"] == 1
            assert ines.get("/api/usage", date=day.isoformat()).json()["total_booked_minutes"] - total_before == 60
            assert usage(day + timedelta(days=1)) == next_before
            r = ines.get("/api/exports/usage.csv", month=f"{day:%Y-%m}")
            assert r.status_code == 200
            assert r.headers["content-type"].replace(" ", "").lower() == CSV_TYPE.replace(" ", "")
            assert r.headers["content-disposition"] == f'attachment; filename="passboard-usage-{day:%Y-%m}.csv"'
            assert r.text.splitlines()[0] == CSV_HEADER
            rows = list(csv.DictReader(io.StringIO(r.text)))
            mine = [x for x in rows if x["date"] == day.isoformat() and x["start"] == booking["start"]
                    and x["station"] in {station_name, "prep-a"} and x["status"].lower() == "confirmed"]
            assert len(mine) == 1
            assert mine[0]["business"] == "'" + name
            assert (mine[0]["end"], mine[0]["booked_hours"], mine[0]["status"].lower()) == (booking["end"], "1.00", "confirmed")
            for x in rows:
                for value in x.values():
                    assert not value or value[0] not in NEUTRALISED_LEADS, value
    finally:
        owen.patch("/api/members/me", {"business_name": CRUMB_BUSINESS})


def test_health_and_manifest(app_url):
    for base in (app_url, os.environ["APP_KILLBILL_DOWN_URL"]):
        r = httpx.get(base.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
        assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert manifest()["serve"]
    copy = Copy({"DATABASE_URL": DEAD_DB_URL, "PASSBOARD_NOW": "2027-02-10T07:40:00-06:00"})
    try:
        elapsed = copy.wait_healthy(HEALTH_SECONDS)
        assert elapsed <= HEALTH_SECONDS
        r = httpx.post(copy.url + "/api/session", json={"email": ROSA, "password": PASSWORD}, timeout=HTTP_TIMEOUT)
        assert r.status_code == 503 and r.json() == {"error": "database_unavailable"}
    finally:
        copy.stop()


def test_server_boundary(app_url):
    base = app_url.rstrip("/")
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    login = {"email": ROSA, "password": PASSWORD}
    foreign = anon.post("/api/session", json=login, headers={"Origin": FOREIGN_ORIGIN})
    assert foreign.status_code == 403 and foreign.json() == {"error": "cross_origin"}
    assert SET_COOKIE not in foreign.headers
    origin = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    same = anon.post("/api/session", json=login, headers={"Origin": origin})
    assert same.status_code == 200
    cookies = [c.lower() for c in same.headers.get_list(SET_COOKIE) if c.lower().startswith(SESSION_COOKIE + "=")]
    assert len(cookies) == 1, same.headers.get_list(SET_COOKIE)
    cookie = cookies[0]
    for attribute in COOKIE_ATTRS:
        assert attribute.lower() in cookie, attribute
    assert CORS_HEADER not in anon.get("/api/kitchen", headers={"Origin": FOREIGN_ORIGIN}).headers
    shell = len(json.dumps({"email": "", "password": "x"}).encode())
    exact = json.dumps({"email": "a" * (MAX_JSON_BYTES - shell), "password": "x"}).encode()
    assert len(exact) == MAX_JSON_BYTES
    fresh = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT)
    assert fresh.post("/api/session", content=exact, headers={"Content-Type": "application/json"}).status_code != 413
    over = fresh.post("/api/session", content=json.dumps({"email": "a" * (MAX_JSON_BYTES - shell + 1), "password": "x"}).encode(),
                      headers={"Content-Type": "application/json"})
    assert over.status_code == 413 and over.json() == {"error": "payload_too_large"}
    wrong = fresh.post("/api/session", content=b"email=x", headers={"Content-Type": "text/plain"})
    assert wrong.status_code == 415 and wrong.json() == {"error": "unsupported_media_type"}
    rosa = Api(app_url, ROSA)
    keys_before = {d["id"] for d in rosa.get("/api/documents").json()["documents"]}
    try:
        big = rosa.client.post("/api/documents", data={"kind": "liability_insurance", "expires_on": (today_of(rosa) + timedelta(days=200)).isoformat(),
                                                       "padding": "x" * (MAX_UPLOAD_BYTES - MAX_FILE_BYTES)},
                               files={"file": ("cert.pdf", PDF_BYTES + bytes(MAX_FILE_BYTES - len(PDF_BYTES)), "application/pdf")})
        assert big.status_code == 413 and big.json()["error"] in {"payload_too_large", "file_too_large"}
    except httpx.TransportError:
        rosa = Api(app_url, ROSA)
    assert {d["id"] for d in rosa.get("/api/documents").json()["documents"]} == keys_before
    wrong_method = rosa.delete("/api/kitchen")
    assert wrong_method.status_code == 405 and wrong_method.json() == {"error": "method_not_allowed"}
    for path in ("/run.json", "/package.json", "/package-lock.json", "/tsconfig.json", "/.env",
                 "/.git/config", "/node_modules/.package-lock.json", "/src/server.ts", "/server.ts"):
        assert anon.get(path).status_code == 404, path
    secrets_ = [os.environ.get(k, "") for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "S3_SECRET_ACCESS_KEY", "DATABASE_URL")]
    secrets_ = [s for s in secrets_ if len(s) >= 6 and not s.isalpha()]
    bodies = [rosa.get("/api/kitchen").text, rosa.get("/api/me").text, anon.get("/").text]
    for src in re.findall(r'src="(/[^"]+\.js)"', bodies[-1]):
        bodies.append(anon.get(src).text)
    for body in bodies:
        for secret in secrets_:
            assert secret not in body


def board_scrolls_in_frame(page: Page) -> bool:
    return bool(page.get_by_role("grid", name="Line board").evaluate(
        """g => { const scrolls = e => /(auto|scroll)/.test(getComputedStyle(e).overflowX) && e.scrollWidth > e.clientWidth;
              for (let e = g; e && e !== document.body; e = e.parentElement) if (scrolls(e)) return true;
              return [...g.querySelectorAll('*')].some(scrolls); }"""))


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_responsive_layout(browser, app_url, viewport):
    size = VIEWPORTS[viewport]
    ines = Api(app_url, INES)
    today = today_of(ines)
    packet = new_packet(ines, today - timedelta(days=7), today, server_now(ines) + timedelta(hours=1))
    rosa = Api(app_url, ROSA)
    assert rosa.post(purchase_path(PACK_10), {}).status_code == 201
    assert rosa.upload({"kind": "liability_insurance", "expires_on": (today + timedelta(days=200)).isoformat()},
                       "coi.pdf", PDF_BYTES, "application/pdf").status_code == 201
    with signed_in(browser, app_url, ROSA, viewport=size) as page:
        wait_for(page, lambda: page.get_by_role("gridcell").count() > 0, "board")
        layout(page)
        assert board_scrolls_in_frame(page)
        for header in page.get_by_role("rowheader").all():
            assert header.evaluate("e => (e.closest('[role=row]') || e).getBoundingClientRect().height") >= MIN_TARGET_PX
        menu = page.get_by_role("button", name="Menu")
        if size[0] == VIEWPORTS["375"][0]:
            assert visible(menu)
            click(menu)
            assert menu.get_attribute("aria-expanded") == "true"
        signout = page.get_by_role("button", name="Sign out")
        if visible(signout):
            box = signout.bounding_box()
            assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX
        for screen, landmark in (("Hours", ("heading", "Hours")), ("Documents", ("table", "Documents on file")),
                                 ("Invoices", ("table", "Invoices"))):
            nav(page, screen)
            wait_for(page, lambda: visible(page.get_by_role(landmark[0], name=landmark[1])), screen)
            layout(page)
    with signed_in(browser, app_url, TOMAS, viewport=size) as page:
        wait_for(page, lambda: visible(page.get_by_role("heading", name="Shifts")), "shifts")
        layout(page)
    with signed_in(browser, app_url, INES, viewport=size) as page:
        for screen, landmark in (("Review", ("table", "Documents to review")), ("Members", ("table", "Members")),
                                 ("Usage", ("table", "Daily usage")), ("Packets", ("table", "Packet links"))):
            nav(page, screen)
            wait_for(page, lambda: visible(page.get_by_role(landmark[0], name=landmark[1])), screen)
            layout(page)
    with entered(open_app(browser, f"{app_url.rstrip('/')}/packet/{packet['token']}")) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        wait_for(page, lambda: visible(page.get_by_role("heading", name="Compliance packet")), "packet page")
        layout(page)


MOTION_JS = """() => {
  window.__motion = [];
  const rec = (target, timing) => { const chain = []; for (let e = target; e; e = e.parentElement) chain.push(e);
    window.__motion.push({target, chain, d: typeof timing.duration === 'number' ? timing.duration : 0}); };
  for (const type of ['animationstart', 'transitionrun']) {
    document.addEventListener(type, e => { for (const a of e.target.getAnimations()) if (a.effect) rec(e.target, a.effect.getTiming()); }, true);
  }
  const original = Element.prototype.animate;
  Element.prototype.animate = function (k, o) { const a = original.call(this, k, o); rec(this, a.effect.getTiming()); return a; };
  window.__raf = [];  // script-driven motion (requestAnimationFrame, JS tweens): the frame times it runs on
  const frame = window.requestAnimationFrame.bind(window);
  window.requestAnimationFrame = cb => frame(t => { window.__raf.push(performance.now()); cb(t); });
}"""
RAF_BURSTS_JS = """from => { const ts = window.__raf.slice(from), out = []; let first = null, last = null, n = 0;
  for (const t of ts) { if (last !== null && t - last > 50) { if (n >= 3) out.push(last - first + 16); first = null; n = 0; }
    if (first === null) first = t; last = t; n++; }
  if (n >= 3) out.push(last - first + 16); return out; }"""
MOTION_SINCE_JS = """([from, roots, around]) => window.__motion.slice(from)
  .filter(r => !roots.length || roots.some(x => x && (r.chain.includes(x) || (around && r.target.contains(x))))).map(r => r.d)"""
MOTION_CASES = ["full", "reduced"]


def motion_mark(page: Page) -> tuple[int, int]:
    return tuple(page.evaluate("() => [window.__motion.length, window.__raf.length]"))


def motion_since(page: Page, mark: tuple[int, int], *roots: Any, around: bool = False) -> list[float]:
    handles = [r.element_handle() for r in roots if r.count()]
    return page.evaluate(MOTION_SINCE_JS, [mark[0], handles, around])


def script_motion(page: Page, mark: tuple[int, int]) -> list[float]:
    return page.evaluate(RAF_BURSTS_JS, mark[1])


def within(durations: list[float], bounds: tuple[int, int]) -> bool:
    return any(bounds[0] <= d <= bounds[1] for d in durations)


@pytest.mark.parametrize("mode", MOTION_CASES, ids=MOTION_CASES)
def test_paint_motion(browser, app_url, mode):
    reduced = mode == "reduced"
    rosa, owen = Api(app_url, ROSA), Api(app_url, OWEN)
    offset, day, start = find_slot(rosa, "oven-1", range(2, 27), 240)
    name = STATIONS["oven-1"][0]
    with signed_in(browser, app_url, ROSA, reduced_motion="reduce" if reduced else "no-preference") as page:
        show_date(page, today_of(rosa), offset)
        page.evaluate(MOTION_JS)
        grid = page.get_by_role("grid", name="Line board")
        rail = page.get_by_role("region", name="My tickets")
        drawer = page.get_by_role("complementary", name="Ticket details")
        mark = motion_mark(page)
        paint_down(page, name, start)
        for last in range(start + CELL, start + 60, CELL):
            paint_to(page, name, last)
        tag_loc = page.get_by_role("status", name="Paint cost")
        roll_css = motion_since(page, mark, tag_loc)
        roll = roll_css + script_motion(page, mark)
        page.mouse.up()
        hold_ticket = ticket(page, name, day, start, start + 60, "hold")
        wait_for(page, lambda: visible(hold_ticket), "hold ticket")
        advance(page, 500)
        flight = motion_since(page, mark) + script_motion(page, mark)
        board_motion = motion_since(page, mark, grid, rail)
        still_flight = motion_since(page, mark, grid, rail, drawer)
        mark = motion_mark(page)
        click(hold_ticket)
        wait_for(page, lambda: visible(drawer), "drawer")
        advance(page, 500)
        slide_css = motion_since(page, mark, drawer, around=True)
        slide = slide_css + script_motion(page, mark)
        loss_start = start + 120
        paint_down(page, name, loss_start)
        paint_to(page, name, loss_start + CELL)
        advance(page, 500)
        mark = motion_mark(page)
        rival = owen.post("/api/holds", {"station_id": "oven-1", "date": day.isoformat(), "start": hm(loss_start), "end": hm(loss_start + 30)})
        assert rival.status_code == 201, rival.text
        page.mouse.up()
        loss_copy = f"Another member took {name} at {hm(loss_start)}. Your hold was not placed."
        wait_for(page, shows(updates(page), loss_copy), "loss copy")
        advance(page, 500)
        shake = motion_since(page, mark) + script_motion(page, mark)
        if reduced:
            board_shake = motion_since(page, mark, grid, rail, drawer)
            assert not [d for d in roll_css + board_motion + slide_css + board_shake if d >= STILL_MS], (roll_css, board_motion, slide_css, board_shake)
            assert not within(still_flight, FLIGHT_MS)
        else:
            assert within(roll, ROLL_MS), roll
            assert within(flight, FLIGHT_MS), flight
            assert within(slide, DRAWER_MS), slide
            assert within(shake, SHAKE_MS), shake
            next_day = page.get_by_role("button", name="Next day")
            next_day.hover()
            computed = next_day.evaluate("e => [e, ...e.querySelectorAll('*')].map(x => getComputedStyle(x).transitionDuration).join(',')")
            durations = [float(x.strip().rstrip("ms")) / (1000 if x.strip().endswith("ms") else 1) for x in computed.split(",")]
            assert any(HOVER_S[0] <= d <= HOVER_S[1] for d in durations), durations
    for api, segs in ((rosa, segments(rosa, "oven-1", day)), (owen, segments(owen, "oven-1", day))):
        for s in segs:
            if s["kind"] == "hold":
                api.delete(f"/api/holds/{s['id']}")


def test_wf_sign_in_board_roles(browser, app_url):
    rosa = Api(app_url, ROSA)
    assert rosa.upload({"kind": "liability_insurance", "expires_on": (today_of(rosa) + timedelta(days=200)).isoformat()},
                       "coi.pdf", PDF_BYTES, "application/pdf").status_code == 201
    homes = [(ROSA, ("heading", "Line board"), ["Board", "Hours", "Documents", "Invoices"]),
             (TOMAS, ("heading", "Shifts"), ["Shifts", "Board", "Documents"]),
             (INES, ("table", "Documents to review"), ["Review", "Board", "Members", "Usage", "Packets"])]
    for email, home, links in homes:
        with signed_in(browser, app_url, email) as page:
            wait_for(page, lambda: visible(page.get_by_role(home[0], name=home[1])), f"{email} home")
            main = page.get_by_role("navigation", name="Main")
            for link in links:
                assert main.get_by_role("link", name=link, exact=True).count() == 1
            me = page.request.get(app_url.rstrip("/") + "/api/me")
            assert me.status == 200 and me.json()["user"]["email"] == email
            click(page.get_by_role("button", name="Sign out"))
            wait_for(page, lambda: visible(page.get_by_role("form", name="Sign in")), "sign-in form")
            assert page.request.get(app_url.rstrip("/") + "/api/me").status == 401


def test_wf_sign_in_board_wrong_password(browser, app_url):
    with entered(open_app(browser, app_url.rstrip("/") + "/")) as page:
        wait_for(page, lambda: visible(page.get_by_text("Sign in to Passboard")), "sign-in copy")
        fill(page.get_by_role("textbox", name="Email"), ROSA)
        fill(page.get_by_label("Password"), "wrong-" + PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        wait_for(page, shows(problems(page), "Email or password is wrong."), "credentials alert")
        assert visible(page.get_by_role("form", name="Sign in"))
        assert page.request.get(app_url.rstrip("/") + "/api/me").status == 401


def test_wf_sign_in_board_browser_zone(browser, daytime_url):
    api = Api(daytime_url, ROSA)
    context = browser.new_context(timezone_id=BROWSER_ZONE, viewport={"width": DESKTOP[0], "height": DESKTOP[1]})
    try:
        page = context.new_page()
        page.goto(daytime_url.rstrip("/") + "/")
        page.get_by_role("textbox", name="Email").fill(ROSA)
        page.get_by_label("Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        k = kitchen(api)
        page.get_by_text(board_date(date.fromisoformat(k["today"]))).first.wait_for(timeout=UI_SECONDS * 1000)
        now_line = page.get_by_text(re.compile(r"^Now \d\d:\d\d$"))
        now_line.first.wait_for(timeout=UI_SECONDS * 1000)
        shown = mins(now_line.first.inner_text().split()[1])
        server = server_now(api).astimezone(KZ)
        assert abs(server.hour * 60 + server.minute - shown) <= 2, (shown, server)
    finally:
        context.close()


def test_wf_paint_hold_happy(browser, app_url):
    rosa = Api(app_url, ROSA)
    offset, day, s = find_slot(rosa, "oven-1", range(2, 27), 180)
    name, rate, tail = STATIONS["oven-1"]
    with signed_in(browser, app_url, ROSA) as page:
        show_date(page, today_of(rosa), offset)
        bal = balance(rosa)
        paint_down(page, name, s)
        paint_to(page, name, s + 165)
        wait_for(page, lambda: cell(page, name, s + 165, "painting").count() == 1, "painting band")
        assert cell(page, name, s + 180, "cleaning tail").count() == 1
        assert cell(page, name, s + 180 + tail - CELL, "cleaning tail").count() == 1
        expected = paint_cost(180, bal, rate)
        wait_for(page, lambda: expected.replace(" ", "") in squash(visible_text(page.get_by_role("status", name="Paint cost"))).replace(" ", ""), "cost tag")
        page.mouse.up()
        rail_ticket = ticket(page, name, day, s, s + 180, "hold")
        wait_for(page, lambda: visible(rail_ticket), "hold ticket")
        wait_for(page, shows(updates(page), f"Hold placed: {name}, {hm(s)}–{hm(s + 180)}. Confirm it before the timer runs out."), "hold copy")
        timer = rail_ticket.get_by_role("timer", name="Hold time left")
        assert re.fullmatch(r"\d\d:\d\d", timer.inner_text().strip())
        wait_for(page, lambda: cell(page, name, s, "your hold").count() == 1, "your hold cells")
    holds = [x for x in segments(rosa, "oven-1", day) if x["kind"] == "hold" and x["start"] == hm(s)]
    assert len(holds) == 1 and holds[0]["end"] == hm(s + 180)
    assert rosa.delete(f"/api/holds/{holds[0]['id']}").status_code == 204


def test_wf_paint_hold_conflict(browser, app_url):
    rosa, owen = Api(app_url, ROSA), Api(app_url, OWEN)
    offset, day, s = find_slot(rosa, "oven-1", range(2, 27), 240)
    name = STATIONS["oven-1"][0]
    blocker = owen.post("/api/holds", {"station_id": "oven-1", "date": day.isoformat(), "start": hm(s + 120), "end": hm(s + 180)})
    assert blocker.status_code == 201, blocker.text
    with signed_in(browser, app_url, ROSA) as page:
        show_date(page, today_of(rosa), offset)
        paint_down(page, name, s)
        paint_to(page, name, s + 225)
        conflicts = page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(name)}, \d\d:\d\d, conflict$"))
        wait_for(page, lambda: conflicts.count() > 0, "conflict cells")
        grid = page.get_by_role("grid", name="Line board")
        shown = grid.inner_text() + " ".join(conflicts.evaluate_all(
            "els => els.flatMap(e => ['::before', '::after'].map(p => getComputedStyle(e, p).content))"))
        assert "Taken" in shown or "Cleaning clash" in shown
        assert cell(page, name, s + 75, "painting").count() == 1
        assert cell(page, name, s + 90, "painting").count() == 0
        page.mouse.up()
        wait_for(page, lambda: visible(ticket(page, name, day, s, s + 90, "hold")), "fitting hold ticket")
    mine = [x for x in segments(rosa, "oven-1", day) if x["kind"] == "hold" and x["start"] == hm(s)]
    assert len(mine) == 1 and mine[0]["end"] == hm(s + 90)
    assert rosa.delete(f"/api/holds/{mine[0]['id']}").status_code == 204
    assert owen.delete(f"/api/holds/{blocker.json()['hold']['id']}").status_code in (204, 409)


def keyboard_select(page: Page, name: str, start: int, cells: int) -> None:
    focus_grid(page)
    move_cursor(page, name, start)
    for _ in range(cells - 1):
        page.keyboard.press("Shift+ArrowRight")
    wait_for(page, lambda: cell(page, name, start + (cells - 1) * CELL, "painting").count() == 1, "keyboard selection")


def test_wf_keyboard_board_confirm(browser, app_url, mail):
    rosa = Api(app_url, ROSA)
    offset, day, s = find_slot(rosa, "prep-a", range(2, 27), 90)
    name, rate, _ = STATIONS["prep-a"]
    with signed_in(browser, app_url, ROSA) as page:
        show_date(page, today_of(rosa), offset)
        bal = balance(rosa)
        keyboard_select(page, name, s, 4)
        expected = paint_cost(60, bal, rate)
        wait_for(page, lambda: expected.replace(" ", "") in squash(visible_text(page.get_by_role("status", name="Paint cost"))).replace(" ", ""), "cost tag")
        page.keyboard.press("Enter")
        wait_for(page, lambda: visible(ticket(page, name, day, s, s + 60, "hold")), "hold ticket")
        wait_for(page, lambda: cell(page, name, s, "your hold").count() == 1, "hold cells")
        if not focused(cell(page, name, s + 45)):
            if not page.evaluate("() => document.activeElement && document.activeElement.getAttribute('role') === 'gridcell'"):
                focus_grid(page)
            move_cursor(page, name, s + 45)
        page.keyboard.press("Shift+ArrowRight")
        wait_for(page, shows(updates(page), f"Hold now ends at {hm(s + 75)}."), "resize copy")
        hold = [x for x in segments(rosa, "prep-a", day) if x["kind"] == "hold" and x["start"] == hm(s)]
        assert len(hold) == 1 and hold[0]["end"] == hm(s + 75)
        page.keyboard.press("Enter")
        confirm_button = page.get_by_role("button", name="Confirm booking")
        wait_for(page, lambda: focused(confirm_button), "focus on Confirm booking")
        page.keyboard.press("Enter")
        wait_for(page, lambda: visible(ticket(page, name, day, s, s + 75, "confirmed")), "confirmed ticket")
    bookings = rosa.get("/api/bookings", **{"from": day.isoformat(), "to": day.isoformat()}).json()["bookings"]
    assert [b["status"] for b in bookings if b["station_id"] == "prep-a" and b["start"] == hm(s) and b["end"] == hm(s + 75)] == ["confirmed"]


def test_wf_keyboard_board_release(browser, app_url):
    rosa = Api(app_url, ROSA)
    offset, day, s = find_slot(rosa, "prep-b", range(2, 27), 60)
    name = STATIONS["prep-b"][0]
    with signed_in(browser, app_url, ROSA) as page:
        show_date(page, today_of(rosa), offset)
        keyboard_select(page, name, s, 2)
        page.keyboard.press("Escape")
        wait_for(page, lambda: cell(page, name, s, "painting").count() == 0, "selection cleared")
        assert not [x for x in segments(rosa, "prep-b", day) if x["kind"] == "hold" and x["start"] == hm(s)]
        if not page.evaluate("() => !!document.activeElement && document.activeElement.getAttribute('role') === 'gridcell'"):
            focus_grid(page)
        move_cursor(page, name, s)
        for _ in range(3):
            page.keyboard.press("Shift+ArrowRight")
        wait_for(page, lambda: cell(page, name, s + 45, "painting").count() == 1, "second keyboard selection")
        page.keyboard.press("Enter")
        wait_for(page, lambda: visible(ticket(page, name, day, s, s + 60, "hold")), "hold ticket")
        wait_for(page, lambda: cell(page, name, s, "your hold").count() == 1, "hold cells")
        if not focused(page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(name)}, \d\d:\d\d, your hold$"))):
            if not page.evaluate("() => !!document.activeElement && document.activeElement.getAttribute('role') === 'gridcell'"):
                focus_grid(page)
            move_cursor(page, name, s)
        page.keyboard.press("Escape")
        wait_for(page, shows(updates(page), "Hold released."), "release copy")
    assert not [x for x in segments(rosa, "prep-b", day) if x["kind"] == "hold" and x["start"] == hm(s)]


def test_wf_keyboard_board_lost_slot(browser, app_url):
    rosa, owen = Api(app_url, ROSA), Api(app_url, OWEN)
    offset, day, s = find_slot(rosa, "oven-2", range(2, 27), 60)
    name = STATIONS["oven-2"][0]
    with signed_in(browser, app_url, ROSA) as page:
        show_date(page, today_of(rosa), offset)
        keyboard_select(page, name, s, 4)
        rival = owen.post("/api/holds", {"station_id": "oven-2", "date": day.isoformat(), "start": hm(s), "end": hm(s + 60)})
        assert rival.status_code == 201, rival.text
        page.keyboard.press("Enter")
        copy = f"Another member took {name} at {hm(s)}. Your hold was not placed."
        wait_for(page, shows(updates(page), copy), "lost-slot copy")
        wait_for(page, lambda: page.get_by_role("gridcell", name=re.compile(rf"^{re.escape(name)}, \d\d:\d\d, painting$")).count() == 0, "band cleared")
        assert copy not in squash(problems(page).inner_text())
        assert CRUMB_BUSINESS not in updates(page).inner_text()
    assert not [x for x in segments(rosa, "oven-2", day) if x["kind"] == "hold"]
    assert owen.delete(f"/api/holds/{rival.json()['hold']['id']}").status_code == 204


def paint_hold_ui(page: Page, api: Api, station_id: str, offsets: Any, duration: int) -> tuple[date, int]:
    offset, day, s = find_slot(api, station_id, offsets, duration)
    name = STATIONS[station_id][0]
    show_date(page, today_of(api), offset)
    paint_down(page, name, s)
    paint_to(page, name, s + duration - CELL)
    page.mouse.up()
    wait_for(page, lambda: visible(ticket(page, name, day, s, s + duration, "hold")), "hold ticket")
    return day, s


def test_wf_confirm_booking_happy(browser, app_url, mail):
    rosa = Api(app_url, ROSA)
    name = STATIONS["oven-1"][0]
    with signed_in(browser, app_url, ROSA) as page:
        day, s = paint_hold_ui(page, rosa, "oven-1", range(2, 27), 180)
        subject = f"Booking confirmed: {name} on {day.isoformat()}"
        before_mail = len(mail_matches(mail, ROSA, subject))
        before = balance(rosa)
        click(ticket(page, name, day, s, s + 180, "hold"))
        drawer = page.get_by_role("complementary", name="Ticket details")
        wait_for(page, lambda: visible(drawer), "drawer")
        wait_for(page, shows(drawer, f"Cleaning until {hm(s + 210)}"), "cleaning line")
        click(drawer.get_by_role("button", name="Confirm booking"))
        wait_for(page, shows(updates(page), f"Booking confirmed: {name}, {day.isoformat()} {hm(s)}–{hm(s + 180)}."), "confirmed copy")
        wait_for(page, lambda: visible(ticket(page, name, day, s, s + 180, "confirmed")), "confirmed ticket")
        spent = min(180, before)
        wait_for(page, lambda: f"Prepaid {hours(before - spent)} h" in squash(page.evaluate("() => document.body.innerText")), "rail balance")
    bookings = rosa.get("/api/bookings", **{"from": day.isoformat(), "to": day.isoformat()}).json()["bookings"]
    booking = [b for b in bookings if b["station_id"] == "oven-1" and b["start"] == hm(s)][0]
    assert booking["status"] == "confirmed" and booking["prepaid_minutes"] == spent
    assert balance(rosa) == before - spent
    await_mail(mail, ROSA, subject, before_mail + 1)


def test_wf_confirm_booking_pending(browser, app_url):
    rosa = Api(app_url, ROSA)
    name = STATIONS["kettle-1"][0]
    with signed_in(browser, app_url, ROSA) as page:
        day, s = paint_hold_ui(page, rosa, "kettle-1", range(2, 27), 60)
        click(ticket(page, name, day, s, s + 60, "hold"))
        button = page.get_by_role("complementary", name="Ticket details").get_by_role("button", name="Confirm booking")
        with entered(held(page, "**/api/holds/*/confirm")) as gate:
            click(button)
            wait_for(page, shows(updates(page), "Confirming booking…"), "pending copy")
            assert button.is_disabled() and button.evaluate("e => !!e.closest('[aria-busy=\"true\"]')")
            gate.release()
        wait_for(page, shows(updates(page), f"Booking confirmed: {name}, {day.isoformat()} {hm(s)}–{hm(s + 60)}."), "confirmed copy")
    bookings = rosa.get("/api/bookings", **{"from": day.isoformat(), "to": day.isoformat()}).json()["bookings"]
    assert [b["status"] for b in bookings if b["station_id"] == "kettle-1" and b["start"] == hm(s)] == ["confirmed"]


def open_booking_drawer(page: Page, api: Api, booking: dict[str, Any]) -> Any:
    day = date.fromisoformat(booking["date"])
    show_date(page, today_of(api), (day - today_of(api)).days)
    name = STATIONS[booking["station_id"]][0]
    click(ticket(page, name, day, mins(booking["start"]), mins(booking["end"]), "confirmed"))
    drawer = page.get_by_role("complementary", name="Ticket details")
    wait_for(page, lambda: visible(drawer), "drawer")
    return drawer


def test_wf_cancel_booking_free(browser, app_url, mail):
    rosa = Api(app_url, ROSA)
    booking = book(rosa, "prep-a", range(3, 27), 60)
    cutoff = parse_instant(booking["free_cancel_until"]).astimezone(KZ)
    subject = f"Booking cancelled: Prep Station A on {booking['date']}"
    before_mail = len(mail_matches(mail, ROSA, subject))
    before = balance(rosa)
    with signed_in(browser, app_url, ROSA) as page:
        drawer = open_booking_drawer(page, rosa, booking)
        wait_for(page, shows(drawer, f"Free cancellation until {cutoff.date().isoformat()} {cutoff:%H:%M}"), "cutoff line")
        click(drawer.get_by_role("button", name="Cancel booking"))
        click(drawer.get_by_role("button", name="Keep booking"))
        assert booking_of(rosa, booking["id"])["status"] == "confirmed"
        click(drawer.get_by_role("button", name="Cancel booking"))
        click(drawer.get_by_role("button", name="Yes, cancel booking"))
        wait_for(page, shows(updates(page), f"Booking cancelled. {hours(booking['prepaid_minutes'])} h returned to your prepaid balance."), "cancel copy")
    assert booking_of(rosa, booking["id"])["status"] == "cancelled_free"
    assert balance(rosa) == before + booking["prepaid_minutes"]
    await_mail(mail, ROSA, subject, before_mail + 1, ("No cancellation fee",))


def test_wf_cancel_booking_late_waive(browser, app_url, mail):
    rosa = Api(app_url, ROSA)
    duration = secrets.choice(range(30, 241, CELL))
    booking = book(rosa, "prep-b", [1], duration)
    fee = money(Decimal(booking["list_amount"]) / 2)
    subject = f"Booking cancelled: Prep Station B on {booking['date']}"
    before_mail = len(mail_matches(mail, ROSA, subject))
    with signed_in(browser, app_url, ROSA) as page:
        drawer = open_booking_drawer(page, rosa, booking)
        wait_for(page, shows(drawer, f"Late-cancellation fee: ${fee}"), "fee line")
        click(drawer.get_by_role("button", name="Cancel booking"))
        click(drawer.get_by_role("button", name="Yes, cancel booking"))
        wait_for(page, shows(updates(page), f"Booking cancelled. {hours(booking['prepaid_minutes'])} h returned; late-cancellation fee ${fee}."), "late cancel copy")
    assert booking_of(rosa, booking["id"])["status"] == "cancelled_with_fee"
    with signed_in(browser, app_url, INES) as page:
        nav(page, "Members")
        table = page.get_by_role("table", name="Late cancellations")
        row = table.get_by_role("row").filter(has_text=booking["date"]).filter(has_text="Prep Station B").filter(has_text=fee) \
            .filter(has=page.get_by_role("button", name="Waive fee"))
        wait_for(page, lambda: row.count() > 0, "late cancellation row")
        click(row.first.get_by_role("button", name="Waive fee"))
        wait_for(page, shows(updates(page), "Late-cancellation fee waived."), "waive copy")
    assert booking_of(rosa, booking["id"])["fee"]["status"] == "waived"
    await_mail(mail, ROSA, subject, before_mail + 1, (f"Late-cancellation fee: ${fee}",))


def test_wf_prepaid_hours_buy_pack(browser, app_url, killbill, mail):
    rosa = Api(app_url, ROSA)
    pack_name, minutes, price = PACKS["pack-10"]
    notice = f"Invoice notice: ${price} for {pack_name}"
    before_mail = len(mail_matches(mail, ROSA, notice))
    before_kb = kb_purchases(killbill, "mbr-rosa")
    before = balance(rosa)
    with signed_in(browser, app_url, ROSA) as page:
        nav(page, "Hours")
        wait_for(page, lambda: visible(page.get_by_role("heading", name="Hours")), "Hours screen")
        assert visible(page.get_by_role("table", name="Hours ledger"))
        click(page.get_by_role("button", name=f"Buy {pack_name}"))
        wait_for(page, shows(updates(page), f"{pack_name} added. Balance: {hours(before + minutes)} h."), "pack copy")
    book_ledger = ledger(rosa)
    assert book_ledger["balance_minutes"] == before + minutes
    last = book_ledger["transactions"][-1]
    assert (last["kind"], last["member_minutes"]) == ("pack_purchase", minutes)
    assert {e["account"] for e in last["entries"]} == {"member:mbr-rosa", "kitchen:issued"}
    assert new_purchases(killbill, "mbr-rosa", before_kb) == [float(price)]
    await_mail(mail, ROSA, notice, before_mail + 1)


def test_wf_prepaid_hours_adjust_reverse(browser, app_url):
    priya = Api(app_url, PRIYA)
    reason = tag("goodwill")
    minutes = 105
    before = balance(priya)
    with signed_in(browser, app_url, INES) as page:
        nav(page, "Members")
        wait_for(page, lambda: visible(page.get_by_role("table", name="Members")), "Members table")
        scope = member_scope(page, LAKE_BUSINESS)
        fill(scope.get_by_role("textbox", name="Hours change"), hours(minutes))
        fill(scope.get_by_role("textbox", name="Reason"), reason)
        click(scope.get_by_role("button", name="Adjust hours"))
        wait_for(page, shows(updates(page), f"Hours adjusted. Balance: {hours(before + minutes)} h."), "adjust copy")
        page.on("dialog", lambda d: d.accept(reason))
        row = page.get_by_role("table", name="Member ledger").get_by_role("row") \
            .filter(has_text=re.compile(rf"(?<![\d.]){re.escape(hours(minutes))}(?!\d)")).filter(has=page.get_by_role("button", name="Reverse"))
        with contextlib.suppress(AssertionError):
            wait_for(page, lambda: row.count() > 0, "ledger row", seconds=8)
        if not row.count():
            for role in ("tab", "button", "link", "option", "row"):
                pick = page.get_by_role(role, name=LAKE_BUSINESS).filter(has_not=page.get_by_role("form", name="Adjust hours"))
                if visible(pick):
                    click(pick.first)
                    break
        wait_for(page, lambda: row.count() > 0, "ledger row")
        click(row.first.get_by_role("button", name="Reverse"))
        reversed_copy = shows(updates(page), f"Transaction reversed. Balance: {hours(before)} h.")
        with contextlib.suppress(AssertionError):
            wait_for(page, reversed_copy, "reverse copy", seconds=8)
        if not reversed_copy():
            for box in (page.get_by_role("dialog").get_by_role("textbox"), row.first.get_by_role("textbox")):
                if visible(box):
                    fill(box.first, reason)
                    box.first.press("Enter")
                    break
        wait_for(page, reversed_copy, "reverse copy")
    txns = ledger(priya)["transactions"]
    made = [t for t in txns if t["kind"] == "adjustment" and t["reason"] == reason]
    assert len(made) == 1 and made[0]["member_minutes"] == minutes
    reversal = [t for t in txns if t["reverses"] == made[0]["id"]]
    assert len(reversal) == 1 and made[0]["reversed_by"] == reversal[0]["id"]
    assert balance(priya) == before


def upload_ui(page: Page, kind_label: str, expires: str, name: str, content: bytes, mime: str) -> None:
    form = page.get_by_role("form", name="Upload document")
    wait_for(page, lambda: visible(form), "upload form")
    select(form.get_by_role("combobox", name="Document type"), kind_label)
    fill(form.get_by_role("textbox", name="Expires on"), expires)
    page.get_by_label("File", exact=True).set_input_files(files=[{"name": name, "mimeType": mime, "buffer": content}])
    click(form.get_by_role("button", name="Upload document"))


def test_wf_documents_renew(browser, app_url, s3):
    priya = Api(app_url, PRIYA)
    today = today_of(priya)
    approved = [d["expires_on"] for d in priya.get("/api/documents").json()["documents"]
                if d["kind"] == "liability_insurance" and d["status"] == "approved"]
    refused = max([today + timedelta(days=10)] + [date.fromisoformat(e) + timedelta(days=1) for e in approved])
    assert refused <= today + timedelta(days=BOOKING_DAYS_AHEAD), refused
    expires = (today + timedelta(days=5)).isoformat()
    name = STATIONS["cold-1"][0]
    start = find_free(priya, "cold-1", refused, 60)
    assert start is not None
    keys_before = set(s3.keys("documents/mbr-lake/"))
    with signed_in(browser, app_url, PRIYA) as page:
        show_date(page, today, (refused - today).days)
        paint_down(page, name, start)
        paint_to(page, name, start + 45)
        page.mouse.up()
        wait_for(page, shows(problems(page), f"Your liability insurance is not approved and current for {refused.isoformat()}. Renew it on Documents before booking."), "documents copy")
        nav(page, "Documents")
        upload_ui(page, "Liability insurance", expires, "coi.pdf", PDF_BYTES, "application/pdf")
        wait_for(page, shows(updates(page), "Document uploaded and waiting for review."), "upload copy")
        table = page.get_by_role("table", name="Documents on file")
        wait_for(page, lambda: table.get_by_role("row").filter(has_text=expires).filter(has_text="Waiting for review").count() > 0, "waiting row")
    with signed_in(browser, app_url, INES) as page:
        row = page.get_by_role("table", name="Documents to review").get_by_role("row").filter(has_text=LAKE_BUSINESS).filter(has_text=expires)
        wait_for(page, lambda: row.count() > 0, "review row")
        click(row.first.get_by_role("button", name="Approve"))
        wait_for(page, shows(updates(page), "Document approved."), "approve copy")
    docs = [d for d in priya.get("/api/documents").json()["documents"] if d["expires_on"] == expires and d["status"] == "approved"]
    assert docs
    assert set(s3.keys("documents/mbr-lake/")) - keys_before
    hold = place_hold(priya, "cold-1", [3], 60)
    assert priya.delete(f"/api/holds/{hold['id']}").status_code == 204


def test_wf_documents_bad_file(browser, app_url, s3):
    rosa = Api(app_url, ROSA)
    keys_before = set(s3.keys("documents/mbr-rosa/"))
    docs_before = {d["id"] for d in rosa.get("/api/documents").json()["documents"]}
    with signed_in(browser, app_url, ROSA) as page:
        nav(page, "Documents")
        assert visible(page.get_by_text("PDF, PNG or JPEG, up to 5,000,000 bytes"))
        upload_ui(page, "Liability insurance", (today_of(rosa) + timedelta(days=200)).isoformat(), "cert.svg", SVG_BYTES, "image/svg+xml")
        wait_for(page, shows(problems(page), "Only PDF, PNG or JPEG files are accepted."), "type alert")
        assert page.get_by_role("button", name="Upload document").is_enabled()
    assert set(s3.keys("documents/mbr-rosa/")) == keys_before
    assert {d["id"] for d in rosa.get("/api/documents").json()["documents"]} == docs_before


def test_wf_billing_outage_pending(browser, killbill):
    url = os.environ["APP_KILLBILL_DOWN_URL"]
    owen, ines = Api(url, OWEN), Api(url, INES)
    poll(lambda: kitchen(owen)["billing"] == "down", SETTLE_SECONDS + POLL_SLACK, "billing down")
    before_kb = kb_purchases(killbill, "mbr-crumb")
    name = STATIONS["oven-2"][0]
    duration = balance(owen) + 60
    with signed_in(browser, url, OWEN) as page:
        banner = page.get_by_role("status", name="Billing status")
        wait_for(page, shows(banner, "Billing is unreachable. Bookings that need a charge are confirmed with payment pending and settle automatically."), "billing banner")
        day, s = paint_hold_ui(page, owen, "oven-2", range(2, 27), duration)
        click(ticket(page, name, day, s, s + duration, "hold"))
        drawer = page.get_by_role("complementary", name="Ticket details")
        wait_for(page, lambda: visible(drawer), "drawer")
        advance(page, 500)
        click(drawer.get_by_role("button", name="Confirm booking"))
        wait_for(page, shows(updates(page), f"Booking confirmed: {name}, {day.isoformat()} {hm(s)}–{hm(s + duration)}. Payment pending until billing records it."), "pending copy")
        wait_for(page, lambda: visible(ticket(page, name, day, s, s + duration, "payment pending")), "pending ticket")
    bookings = ines.get("/api/bookings", **{"from": day.isoformat(), "to": day.isoformat()}).json()["bookings"]
    mine = [b for b in bookings if b["station_id"] == "oven-2" and b["start"] == hm(s)]
    assert len(mine) == 1 and (mine[0]["status"], mine[0]["payment"]) == ("confirmed", "payment_pending")
    assert new_purchases(killbill, "mbr-crumb", before_kb) == []


def test_wf_billing_outage_pack(browser, killbill):
    url = os.environ["APP_KILLBILL_DOWN_URL"]
    rosa = Api(url, ROSA)
    poll(lambda: kitchen(rosa)["billing"] == "down", SETTLE_SECONDS + POLL_SLACK, "billing down")
    before_ledger = ledger(rosa)
    before_kb = kb_purchases(killbill, "mbr-rosa")
    pack_name = PACKS["pack-10"][0]
    with signed_in(browser, url, ROSA) as page:
        nav(page, "Hours")
        click(page.get_by_role("button", name=f"Buy {pack_name}"))
        wait_for(page, shows(problems(page), "Billing is unreachable right now. No charge was made; try again shortly."), "outage alert")
        assert page.get_by_role("button", name=f"Buy {pack_name}").is_enabled()
    after = ledger(rosa)
    assert after == before_ledger
    assert after["balance_minutes"] == sum(t["member_minutes"] for t in after["transactions"])
    assert all(sum(e["minutes"] for e in t["entries"]) == 0 for t in after["transactions"])
    assert new_purchases(killbill, "mbr-rosa", before_kb) == []


def test_wf_crew_check_in_happy(browser, daytime_url):
    rosa, ines = Api(daytime_url, ROSA), Api(daytime_url, INES)
    booking = book_now(rosa)
    name = STATIONS[booking["station_id"]][0]
    with signed_in(browser, daytime_url, TOMAS) as page:
        shifts = page.get_by_role("list", name="Upcoming shifts")
        button = shifts.get_by_role("button", name=f"Check in: {name}, {booking['date']} {booking['start']}")
        wait_for(page, lambda: visible(button), "check-in control")
        click(button)
        wait_for(page, shows(updates(page), f"Checked in for {name}, {booking['start']}–{booking['end']}."), "check-in copy")
        wait_for(page, lambda: re.search(r"Checked in \d\d:\d\d", shifts.inner_text()), "checked-in row")
    for api in (rosa, ines):
        b = booking_of(api, booking["id"])
        assert b["status"] == "checked_in" and [c["crew_cook_id"] for c in b["check_ins"]] == ["usr-tomas"]


def test_wf_crew_check_in_window(browser, app_url):
    rosa = Api(app_url, ROSA)
    booking = book(rosa, "cold-1", [1], 30)
    name = STATIONS["cold-1"][0]
    with signed_in(browser, app_url, TOMAS) as page:
        button = page.get_by_role("list", name="Upcoming shifts").get_by_role("button", name=f"Check in: {name}, {booking['date']} {booking['start']}")
        wait_for(page, lambda: visible(button), "check-in control")
        click(button)
        wait_for(page, shows(problems(page), "Check-in opens 15 minutes before the shift starts and closes when it ends."), "window alert")
    b = booking_of(rosa, booking["id"])
    assert b["status"] == "confirmed" and b["check_ins"] == []


def packet_rows(page: Page) -> Any:
    return page.get_by_role("table", name="Packet links").get_by_role("row").filter(has_text=re.compile(r"\b(Active|Revoked|Expired)\b"))


def create_packet_ui(page: Page, ines: "Api", start: date, end: date, expires: datetime) -> tuple[str, int]:
    nav(page, "Packets")
    form = page.get_by_role("form", name="New packet")
    wait_for(page, lambda: visible(form), "packet form")
    assert f"Times are kitchen time ({ZONE})" in squash(page.get_by_role("form", name="New packet").inner_text()) or visible(page.get_by_text(f"Times are kitchen time ({ZONE})"))
    local = expires.astimezone(KZ)
    fill(form.get_by_role("textbox", name="From"), start.isoformat())
    fill(form.get_by_role("textbox", name="To"), end.isoformat())
    rows = packet_rows(page)
    known = len(ines.get("/api/packets").json()["packets"])
    wait_for(page, lambda: rows.count() == known, "packet rows loaded")
    before = rows.all_inner_texts()
    created = f"Packet link created. It expires {local.date().isoformat()} {local:%H:%M}."
    for typed in (f"{local:%Y-%m-%dT%H:%M}", f"{local:%Y-%m-%d %H:%M}"):
        fill(form.get_by_role("textbox", name="Link expires at"), typed)
        click(form.get_by_role("button", name="Create packet link"))
        with contextlib.suppress(AssertionError):
            wait_for(page, lambda: shows(updates(page), created)() or visible(problems(page)) and squash(problems(page).inner_text()), "packet copy or refusal", seconds=8)
        if shows(updates(page), created)():
            break
    wait_for(page, shows(updates(page), created), "packet copy")
    wait_for(page, lambda: rows.count() == known + 1, "packet row")
    after = rows.all_inner_texts()
    fresh = [i for i, text in enumerate(after) if after[: i + 1].count(text) > before.count(text)]
    assert len(fresh) == 1, fresh
    row = rows.nth(fresh[0])
    assert "Active" in row.inner_text()
    page.context.grant_permissions(["clipboard-read", "clipboard-write"])
    click(row.get_by_role("button", name="Copy link"))
    wait_for(page, shows(updates(page), "Link copied."), "copy copy")
    link = page.evaluate("() => navigator.clipboard.readText()")
    assert re.search(r"/packet/[A-Za-z0-9_-]{43,}=*$", link), link
    return link, fresh[0]


def test_wf_compliance_packet_happy(browser, daytime_url, s3):
    rosa, tomas, ines = Api(daytime_url, ROSA), Api(daytime_url, TOMAS), Api(daytime_url, INES)
    visit = book_now(rosa)
    assert check_in(tomas, visit["id"]).status_code == 201
    today = date.fromisoformat(visit["date"])
    start = today - timedelta(days=secrets.randbelow(20) + 1)
    with signed_in(browser, daytime_url, INES) as page:
        link, _ = create_packet_ui(page, ines, start, today, server_now(ines) + timedelta(hours=2))
    token = link.rsplit("/", 1)[1]
    with entered(open_app(browser, f"{daytime_url.rstrip('/')}/packet/{token}")) as page:
        wait_for(page, lambda: visible(page.get_by_role("heading", name="Compliance packet")), "packet page")
        assert page.get_by_role("navigation", name="Main").count() == 0
        table = page.get_by_role("table", name="Kitchen visits")
        row = table.get_by_role("row").filter(has_text=ROSA_BUSINESS).filter(has_text=STATIONS[visit["station_id"]][0]) \
            .filter(has_text=re.compile(rf"{re.escape(visit['start'])}\s*[–-]\s*{re.escape(visit['end'])}"))
        wait_for(page, lambda: row.count() == 1, "visit row")
        assert "Valid" in row.inner_text() and "Tomás Reyes" in row.inner_text()
        with page.expect_download() as download:
            click(page.get_by_role("link", name="Download PDF"))
        pdf = Path(download.value.path()).read_bytes()
        assert pdf.startswith(b"%PDF-")
    packet = [p for p in ines.get("/api/packets").json()["packets"] if p.get("token") == token]
    assert len(packet) == 1
    assert s3.get(f"packets/{packet[0]['id']}.pdf") == pdf


def test_wf_compliance_packet_revoke(browser, app_url):
    ines = Api(app_url, INES)
    today = today_of(ines)
    start = today - timedelta(days=40 + secrets.randbelow(2000))
    with signed_in(browser, app_url, INES) as page:
        end = start + timedelta(days=6)
        link, index = create_packet_ui(page, ines, start, end, server_now(ines) + timedelta(hours=2))
        row = packet_rows(page).nth(index)
        click(row.get_by_role("button", name="Revoke link"))
        wait_for(page, shows(updates(page), "Packet link revoked."), "revoke copy")
        wait_for(page, lambda: "Revoked" in row.inner_text(), "revoked row")
    token = link.rsplit("/", 1)[1]
    assert httpx.get(f"{app_url.rstrip('/')}/api/packet/{token}", timeout=HTTP_TIMEOUT).status_code == 404
    with entered(open_app(browser, f"{app_url.rstrip('/')}/packet/{token}")) as page:
        wait_for(page, lambda: visible(page.get_by_text("This packet link is not valid.")), "invalid notice")
        assert page.request.get(f"{app_url.rstrip('/')}/packet/{token}").status == 404


def test_wf_usage_export_daily(browser, app_url):
    rosa, ines = Api(app_url, ROSA), Api(app_url, INES)
    booking = book(rosa, "prep-a", range(3, 27), 60)
    usage = {s["station_id"]: s for s in ines.get("/api/usage", date=booking["date"]).json()["stations"]}
    assert usage["prep-a"]["bookings"] >= 1
    with signed_in(browser, app_url, INES) as page:
        nav(page, "Usage")
        fill(page.get_by_role("textbox", name="Usage date"), booking["date"])
        page.get_by_role("textbox", name="Usage date").press("Enter")
        row = page.get_by_role("table", name="Daily usage").get_by_role("row").filter(has_text="Prep Station A")
        wait_for(page, lambda: f"{hours(usage['prep-a']['booked_minutes'])} h" in row.first.inner_text(), "usage row")


def test_wf_usage_export_csv(browser, app_url):
    rosa = Api(app_url, ROSA)
    booking = book(rosa, "prep-b", range(3, 27), 60)
    month = booking["date"][:7]
    with signed_in(browser, app_url, INES) as page:
        nav(page, "Usage")
        fill(page.get_by_role("textbox", name="Export month"), month)
        with page.expect_download() as download:
            click(page.get_by_role("link", name="Export month CSV"))
        body = Path(download.value.path()).read_text(encoding="utf-8")
    assert body.splitlines()[0] == CSV_HEADER
    rows = [r for r in csv.DictReader(io.StringIO(body)) if r["date"] == booking["date"] and r["start"] == booking["start"]
            and r["station"] in {"Prep Station B", "prep-b"} and r["status"].lower() == "confirmed"]
    assert len(rows) == 1 and rows[0]["business"] == ROSA_BUSINESS


def shipped_packages() -> list[tuple[str, str, Path | None]]:
    root = Path("/app") if (Path("/app") / "node_modules").exists() else Path(DEPLOYED_APP)
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json"], cwd=root, capture_output=True, text=True, timeout=600)
    tree = json.loads(out.stdout or "{}")
    found: dict[tuple[str, str], Path | None] = {}

    def walk(deps: dict[str, Any], parent: Path) -> None:
        for name, info in (deps or {}).items():
            here = None
            for base in [parent, *parent.parents]:
                candidate = base / "node_modules" / name
                if (candidate / "package.json").exists():
                    here = candidate
                    break
            key = (name, info.get("version", ""))
            if key not in found:
                found[key] = here
                walk(info.get("dependencies", {}), here or parent)

    walk(tree.get("dependencies", {}), root)
    return [(n, v, p) for (n, v), p in found.items()]


def test_if_run_manifest():
    data = json.loads(Path("/app/run.json").read_text())
    assert set(data) == {"_schema", "install", "build", "serve"}
    assert data["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in data.values())


def test_if_third_party_notices():
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    for name, version, _ in shipped_packages():
        assert name in notices, name
        assert version in notices, f"{name} {version}"
    for font in ("Big Shoulders Display", "Public Sans"):
        assert font in notices


def test_if_licences():
    bad = []
    for name, version, path in shipped_packages():
        assert path is not None, f"{name} not installed"
        meta = json.loads((path / "package.json").read_text())
        lic = meta.get("license") or " OR ".join(str(x.get("type") if isinstance(x, dict) else x) for x in meta.get("licenses") or [])
        lic = lic.get("type") if isinstance(lic, dict) else lic
        options = re.split(r"\s+OR\s+", str(lic or "").strip("()"))
        allowed = any(all(part.strip("() ") in ALLOWED_LICENCES for part in re.split(r"\s+AND\s+", o)) for o in options)
        if not lic:
            texts = " ".join(f.read_text(errors="ignore")[:400] for f in path.glob("LICEN[CS]E*") if f.is_file())
            allowed = bool(re.search(r"MIT License|ISC License|Apache License|BSD|Permission is hereby granted", texts))
        if not allowed:
            bad.append(f"{name}@{version}: {lic}")
    assert not bad, bad
    assert re.search(r"OFL-1\.1|Open Font License,? (Version )?1\.1", Path("/app/THIRD_PARTY_NOTICES.md").read_text())


def test_if_no_extra_datastores():
    forbidden = {"sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "lowdb", "nedb",
                 "lmdb", "pouchdb", "mongodb", "mongoose", "mysql", "mysql2", "node-persist", "keyv"}
    app_json = json.loads(((Path("/app") if (Path("/app") / "package.json").exists() else Path(DEPLOYED_APP)) / "package.json").read_text())
    direct = set(app_json.get("dependencies") or {}) | set(app_json.get("optionalDependencies") or {})
    assert not forbidden & direct
    procs = set()
    for comm in Path("/proc").glob("[0-9]*/comm"):
        with contextlib.suppress(OSError):
            procs.add(comm.read_text().strip())
    assert not {"redis-server", "mongod", "mysqld", "memcached", "etcd"} & procs
    skip = {"node_modules", ".git"}
    files = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts)
             and p.suffix in {".sqlite", ".sqlite3", ".db", ".ldb", ".mdb"}]
    assert not files, files


def test_if_services_untouched():
    skip = {"node_modules", ".git"}
    compose = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts)
               and re.fullmatch(r"(docker-)?compose(\.[\w-]+)?\.ya?ml", p.name)]
    assert not compose, compose
    commands = " ".join(json.loads(Path("/app/run.json").read_text())[k] for k in ("install", "build", "serve")).lower()
    for word in ("docker", "podman", "pg_ctl", "minio server", "mailpit", "killbill"):
        assert word not in commands


def test_if_typescript_and_self_hosted_fonts(browser, app_url):
    skip = {"node_modules", ".git", "dist", "build", ".next", "out", ".output", ".vite", "coverage"}
    js = [p for p in Path("/app").rglob("*") if p.is_file() and not skip & set(p.parts)
          and p.suffix in {".js", ".jsx", ".mjs", ".cjs"} and "config" not in p.name and not p.name.startswith(".")
          and not {"scripts", "tools", "bin"} & set(p.relative_to("/app").parts[:-1])]
    assert not js, js
    origin = urlparse(app_url).netloc
    with entered(open_app(browser, app_url.rstrip("/") + "/")) as page:
        seen: list[str] = []
        page.on("request", lambda r: seen.append(r.url))
        sign_in(page, ROSA)
        wait_for(page, lambda: page.get_by_role("gridcell").count() > 0, "board")
        families = lambda: page.evaluate("() => [...document.fonts].filter(f => f.status === 'loaded').map(f => f.family.replace(/[\"']/g, ''))")
        wanted = ("Big Shoulders Display", "Public Sans")
        key = lambda name: re.sub(r"[^a-z]", "", name.lower())
        wait_for(page, lambda: all(any(key(f).startswith(key(w)) for f in families()) for w in wanted), "self-hosted fonts")
        foreign = [u for u in seen if urlparse(u).scheme in ("http", "https") and urlparse(u).netloc != origin]
        assert not foreign, foreign
