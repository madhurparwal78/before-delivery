from __future__ import annotations

import contextlib
import json
import os
import queue
import re
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta
from decimal import ROUND_HALF_UP, Decimal
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from typing import Any, Iterator

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect
from playwright.sync_api import Error as PlaywrightError

from conftest import (
    DEPLOYED_APP,
    S3,
    addresses,
    advance,
    click,
    fill,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    open_app,
    pdf_text,
    same_origin,
    select,
    session,
    shipped_packages,
    style,
    tap,
    text as mail_text,
    unique,
)

GRADING_KEY = "nightroll-grading-5c1e7a"
BD = "2027-03-05"
SECOND_NIGHT = "2027-03-06"
NOON = "2027-03-05T12:00:00-06:00"
BD_OPEN = "2027-03-06T04:00:00-06:00"
MON = "2027-03-08"
MON_NOON = "2027-03-08T12:00:00-06:00"
MON_OPEN = "2027-03-09T04:00:00-06:00"
TAX_START = "2027-03-09"
OTHER_PHONE = "+1 555 0199"
SHARED_ADDRESS = "1 Mill Lane"
BAD_EMAIL = "not-an-email"
TERMINAL_ONE = "T-1"
TERMINAL_TWO = "T-2"
HTTP_ONLY = "HTTP-only"
SAME_SITE = "SameSite=Lax"
TTL_SECONDS = 259200
PHOTO_LIMIT = 5000000
JSON_LIMIT = 1000000
LIVE_MAX_DELAY_MS = 2000
LIVE_WAIT_MS = LIVE_MAX_DELAY_MS + 3000
BREAKDOWN_MS = 500
SWEEP_MAX_MS = 2500
PANEL_SETTLE_MS = 500
PANEL_MID_MS = 50
MIN_TARGET_PX = 44
KEY_SETTLE_MS = 20
SWEEP_STEP_MS = 100
HTTP_TIMEOUT = 30.0
EXPECT_MS = 15000
MAIL_WAIT_SECONDS = 20
LIVE_READY_SECONDS = 5
BOOT_SECONDS = 120
TAB_LIMIT = 40
NAV_LIMIT = 40
WRAP_PRESSES = 25
GEOM_TOL = 2
DESKTOP = {"width": 1280, "height": 800}
TABLET = {"width": 768, "height": 1024}
PHONE = {"width": 375, "height": 812}
LICENCES = {
    "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "0BSD", "MPL-2.0",
    "BlueOak-1.0.0", "CC0-1.0", "Unlicense", "LGPL-3.0-or-later",
}

expect.set_options(timeout=EXPECT_MS)


def money(cents: int) -> str:
    sign = "-" if cents < 0 else ""
    return f"{sign}${abs(cents) // 100:,}.{abs(cents) % 100:02d}"


def dollars(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def half_up_div(numerator: int, divisor: int) -> int:
    return int((Decimal(numerator) / Decimal(divisor)).quantize(Decimal(1), rounding=ROUND_HALF_UP))


def occupancy(sold: int, available: int) -> str:
    value = (Decimal(sold) * 100 / Decimal(available)).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP)
    return f"{value}%"


def day(value: str, delta: int) -> str:
    return (date.fromisoformat(value) + timedelta(days=delta)).isoformat()


THIRD_NIGHT = day(BD, 2)
PRIOR_NIGHT = day(BD, -1)


def split_shares(cents: int, percents: list[int]) -> list[int]:
    shares = [cents * p // 100 for p in percents]
    for index in range(cents - sum(shares)):
        shares[index] += 1
    return shares


def free_rooms(count: int) -> str:
    return f"{count} rooms free tonight"


def just_taken(number: str) -> str:
    return f"Room {number} was just taken. Choose another room."


def occupied_on(number: str, night: str) -> str:
    return f"Room {number} is occupied on {night}."


def no_check_in(number: str, state: str) -> str:
    return f"Room {number} is {state} and cannot be checked in."


def no_in_house(number: str, state: str) -> str:
    return f"Room {number} is {state} and cannot take an in-house guest."


def not_checked_out(number: str) -> str:
    return f"Room {number} has not checked out."


def closed_notice(night: str, charged: int, no_shows: int) -> str:
    return f"Business date {night} closed. {charged} rooms charged. {no_shows} no-shows."


def charge_added(cents: int) -> str:
    return f"Charge of {money(cents)} added."


def payment_recorded(cents: int) -> str:
    return f"Payment of {money(cents)} recorded."


def split_done(cents: int, count: int) -> str:
    return f"Split {money(cents)} across {count} folios."


def invoice_number(sequence: int) -> str:
    return f"INV-{sequence:06d}"


def folio_entries(letter: str) -> str:
    return f"Folio {letter} entries"


def keep_radio(value: str) -> str:
    return f"Keep {value}"


def fresh_email(prefix: str) -> str:
    made = next((v for v in unique(prefix) if "@" in v), None)
    return made or f"{prefix}-{uuid.uuid4().hex[:10]}@test.example"


def norm(value: str) -> str:
    return " ".join(value.split())


def st(key: str, room: str, name: str, arrival: str, departure: str, status: str = "booked",
       plan: str = "flex", guests: int = 1, link: bool = False, guest: str | None = None) -> dict[str, Any]:
    return {"key": key, "room": room, "name": name, "arrival": arrival, "departure": departure,
            "status": status, "plan": plan, "guests": guests, "link": link, "guest": guest}


def default_plans() -> list[dict[str, Any]]:
    return [
        {"key": "flex", "name": "Flexible", "weeknightCents": 12000, "weekendCents": 15000},
        {"key": "corp", "name": "Corporate", "weeknightCents": 12040, "weekendCents": 12040},
    ]


def grading(base: str, path: str, body: Any, key: str | None = GRADING_KEY) -> httpx.Response:
    headers = {"X-Grading-Key": key} if key is not None else {}
    return httpx.post(f"{base}{path}", json=body, headers=headers, timeout=HTTP_TIMEOUT)


class Hotel:
    def __init__(self, base: str, name: str, data: dict[str, Any], users: dict[str, tuple[str, str]],
                 emails: dict[str, str], guest_keys: dict[str, str]) -> None:
        self.base, self.name, self.data, self.users = base, name, data, users
        self.emails, self.guest_keys = emails, guest_keys
        self._clients: dict[tuple[str, str], httpx.Client] = {}

    @property
    def id(self) -> str:
        return self.data["hotelId"]

    def new_client(self, role: str = "owner", base: str | None = None) -> httpx.Client:
        client = httpx.Client(base_url=base or self.base, timeout=HTTP_TIMEOUT)
        email, password = self.users[role]
        answer = client.post("/api/session", json={"email": email, "password": password})
        assert answer.status_code == 200, f"POST /api/session as {role}: {answer.status_code} {answer.text}"
        return client

    def client(self, role: str = "owner", base: str | None = None) -> httpx.Client:
        slot = (role, base or self.base)
        if slot not in self._clients:
            self._clients[slot] = self.new_client(role, base)
        return self._clients[slot]

    def room(self, key: str) -> str:
        return self.data["rooms"][key]

    def plan(self, key: str = "flex") -> str:
        return self.data["ratePlans"][key]

    def stay_id(self, key: str) -> str:
        return self.data["stays"][key]

    def guest_id(self, key: str) -> str:
        return self.data["guests"][key]

    def entry_id(self, key: str) -> str:
        return self.data["entries"][key]

    def folio_id(self, key: str) -> str:
        return self.data["folios"][key]

    def stay(self, key_or_id: str) -> dict[str, Any]:
        stay_id = self.data["stays"].get(key_or_id, key_or_id)
        answer = self.client("owner").get(f"/api/stays/{stay_id}")
        assert answer.status_code == 200, f"GET /api/stays/{stay_id}: {answer.status_code} {answer.text}"
        return answer.json()

    def clock(self, now: str | None) -> None:
        answer = grading(self.base, "/api/grading/clock", {"hotelId": self.id, "now": now})
        assert answer.status_code == 200, f"POST /api/grading/clock: {answer.status_code} {answer.text}"

    def business_date(self) -> str:
        return self.client("owner").get("/api/desk").json()["hotel"]["businessDate"]

    def close(self, business_date: str) -> httpx.Response:
        return self.client("owner").post("/api/close", json={"businessDate": business_date})

    def board_status(self, room_key: str) -> str:
        rooms = self.client("owner").get("/api/housekeeping/board").json()["rooms"]
        return next(r["status"] for r in rooms if r["roomId"] == self.room(room_key))


def make_hotel(base: str, rooms: dict[str, str] | None = None, stays: list[dict[str, Any]] | None = None,
               folios: list[dict[str, Any]] | None = None, guests: list[dict[str, Any]] | None = None,
               business_date: str = BD, now: str | None = NOON, plans: list[dict[str, Any]] | None = None,
               tax_rates: list[dict[str, Any]] | None = None, second: bool = False) -> Hotel:
    name = f"Test Inn {uuid.uuid4().hex[:8]}"
    users = {
        "owner": (fresh_email("owner"), "pass-owner-1"),
        "desk": (fresh_email("desk"), "pass-desk-1"),
        "desk2": (fresh_email("desktwo"), "pass-desk2-1"),
        "hk": (fresh_email("rooms"), "pass-hk-1"),
    }
    people = {"owner": ("Olu Bright", "owner"), "desk": ("Dee Marsh", "front_desk"),
              "desk2": ("Lena Fisk", "front_desk"), "hk": ("Hal Ferro", "housekeeper")}
    body: dict[str, Any] = {
        "hotel": {"name": name, "timeZone": "America/Chicago", "businessDate": business_date, "now": now},
        "users": [{"key": k, "email": users[k][0], "password": users[k][1], "name": people[k][0], "role": people[k][1]}
                  for k in users],
        "rooms": [{"key": f"r{n}", "number": n, "type": "Queen", "status": s}
                  for n, s in (rooms if rooms is not None else {"101": "clean", "102": "clean"}).items()],
        "ratePlans": plans if plans is not None else default_plans(),
    }
    emails: dict[str, str] = {}
    guest_keys: dict[str, str] = {}
    guest_rows = list(guests or [])
    stay_rows = []
    for row in stays or []:
        guest_key = row["guest"]
        if guest_key is None:
            guest_key = f"g_{row['key']}"
            emails[row["key"]] = fresh_email("guest")
            guest_rows.append({"key": guest_key, "name": row["name"], "email": emails[row["key"]],
                               "phone": "+1 555 0100", "company": "", "address": ""})
        guest_keys[row["key"]] = guest_key
        stay_rows.append({"key": row["key"], "room": row["room"], "guest": guest_key, "ratePlan": row["plan"],
                          "arrival": row["arrival"], "departure": row["departure"], "guests": row["guests"],
                          "status": row["status"], "checkinLink": row["link"]})
    body["guests"] = guest_rows
    body["stays"] = stay_rows
    if folios:
        body["folios"] = folios
    if tax_rates:
        body["taxRates"] = tax_rates
    if second:
        body["secondHotel"] = {
            "hotel": {"name": "Other Inn"},
            "users": [{"key": "owner", "email": fresh_email("ownertwo"), "password": "pass-owner-2",
                       "name": "Rue Dain", "role": "owner"}],
            "rooms": [{"key": "r1", "number": "1", "type": "Queen"}],
        }
    answer = grading(base, "/api/grading/setup", body)
    assert answer.status_code == 201, f"POST /api/grading/setup: {answer.status_code} {answer.text}"
    hotel = Hotel(base, name, answer.json(), users, emails, guest_keys)
    hotel.second_owner = body["secondHotel"]["users"][0] if second else None
    return hotel


def create_body(h: Hotel, room: str, arrival: str, departure: str, name: str = "Ana Vale", email: str | None = None,
                plan: str = "flex", guests: int = 1) -> dict[str, Any]:
    return {"guest": {"name": name, "email": email or fresh_email("guest"), "phone": "+1 555 0100"},
            "arrival": arrival, "departure": departure, "guests": guests,
            "roomId": h.room(room), "ratePlanId": h.plan(plan)}


def post_stay(client: httpx.Client, body: dict[str, Any], key: str | None = None) -> httpx.Response:
    return client.post("/api/stays", json=body, headers={"Idempotency-Key": key or idempotency_key()})


def err(answer: httpx.Response, status_code: int, message: str) -> None:
    assert answer.status_code == status_code, f"expected {status_code} {message!r}: {answer.status_code} {answer.text}"
    assert answer.json()["error"] == message


def field_err(answer: httpx.Response, field: str, message: str) -> None:
    assert answer.status_code == 422, f"expected 422 on {field}: {answer.status_code} {answer.text}"
    assert answer.json()["errors"][field] == message


def minibar_folio(stay_key: str, payer: str, email: str, paid: bool = False, key: str = "f1",
                  name: str = "Folio A", entry: str = "e1", night: str = BD, cents: int = 3333) -> dict[str, Any]:
    entries: list[dict[str, Any]] = [{"key": entry, "kind": "charge", "date": night, "description": "Minibar",
                                      "amountCents": cents, "roomNumber": "101"}]
    if paid:
        entries.append({"key": f"{entry}p", "kind": "payment", "date": night, "description": "Cash payment",
                        "amountCents": cents, "roomNumber": None})
    return {"key": key, "stay": stay_key, "name": name, "payerName": payer, "payerEmail": email, "entries": entries}


def mail_to(mail: Any, email: str, count: int = 1) -> list[dict[str, Any]]:
    wanted = email.lower()

    def mine(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
        return [m for m in messages if wanted in [a.lower() for a in addresses(m.get("To"))]]

    deadline = time.monotonic() + MAIL_WAIT_SECONDS
    while time.monotonic() < deadline:
        if len(mine(mail.messages(settle=0))) >= count:
            return mine(mail.messages())
    pytest.fail(f"Mailpit held fewer than {count} messages to {email} (L537)")


def token_from(message: dict[str, Any]) -> str:
    found = re.search(r"Check in here: (\S+)", mail_text(message))
    assert found, "check-in message lacks the line 'Check in here: <url>' (L537)"
    tail = re.search(r"/checkin/([^/\s?#]+)$", found.group(1))
    assert tail, f"check-in url does not end in /checkin/<token>: {found.group(1)}"
    return tail.group(1)


def only_token(mail: Any, email: str) -> str:
    return token_from(mail_to(mail, email, 1)[0])


def link_dead(base: str, token: str) -> None:
    answer = httpx.get(f"{base}/api/checkin/{token}", timeout=HTTP_TIMEOUT)
    err(answer, 404, "This check-in link is no longer valid.")


def png_bytes(width: int = 4, height: int = 3, exif: bytes | None = None, total: int | None = None) -> bytes:
    def chunk(kind: bytes, body: bytes) -> bytes:
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body))

    raw = b"".join(b"\0" + b"\x55\xaa\x33" * width for _ in range(height))
    head = b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
    head += chunk(b"IDAT", zlib.compress(raw))
    if exif is not None:
        head += chunk(b"eXIf", exif)
    tail = chunk(b"IEND", b"")
    if total is not None:
        pad = total - len(head) - len(tail) - 12 - len(b"Comment\0")
        head += chunk(b"tEXt", b"Comment\0" + b"x" * pad)
    return head + tail


def tiff_with(marker: bytes) -> bytes:
    value = marker + b"\0"
    return (b"II*\0" + struct.pack("<I", 8) + struct.pack("<H", 1)
            + struct.pack("<HHII", 0x010E, 2, len(value), 26) + struct.pack("<I", 0) + value)


def jpeg_bytes(marker: bytes | None = None) -> bytes:
    def segment(code: int, body: bytes) -> bytes:
        return bytes([0xFF, code]) + struct.pack(">H", len(body) + 2) + body

    out = b"\xff\xd8"
    if marker is not None:
        out += segment(0xE1, b"Exif\0\0" + tiff_with(marker))
    out += segment(0xDB, b"\0" + b"\x01" * 64)
    out += segment(0xC0, b"\x08" + struct.pack(">HH", 8, 16) + b"\x01\x01\x11\x00")
    counts = bytes([1] + [0] * 15)
    out += segment(0xC4, b"\x00" + counts + b"\x00")
    out += segment(0xC4, b"\x10" + counts + b"\x00")
    out += segment(0xDA, b"\x01\x01\x00\x00\x3f\x00") + b"\x0f" + b"\xff\xd9"
    return out


def upload(base: str, token: str, data: bytes, name: str = "id.jpg", kind: str = "image/jpeg") -> httpx.Response:
    return httpx.post(f"{base}/api/checkin/{token}/photo", files={"photo": (name, data, kind)}, timeout=HTTP_TIMEOUT)


def decoded_size(browser: Browser, data: bytes) -> dict[str, int]:
    context = browser.new_context()
    try:
        probe = context.new_page()
        return probe.evaluate(
            """async (bytes) => {
                const shot = await createImageBitmap(new Blob([new Uint8Array(bytes)]));
                return {width: shot.width, height: shot.height};
            }""",
            list(data),
        )
    finally:
        context.close()


def cross_origin_read_allowed(browser: Browser, url: str) -> bool:
    context = browser.new_context()
    try:
        probe = context.new_page()
        return probe.evaluate(
            """async (target) => {
                try { await fetch(target); return true; } catch (problem) { return false; }
            }""",
            url,
        )
    finally:
        context.close()


class LiveListener:

    def __init__(self, client: httpx.Client) -> None:
        self.client, self.events, self.raw = client, queue.Queue(), []
        self.ready = threading.Event()
        threading.Thread(target=self._run, daemon=True).start()
        assert self.ready.wait(HTTP_TIMEOUT), "GET /api/live did not answer"

    def _run(self) -> None:
        with contextlib.suppress(httpx.HTTPError):
            with self.client.stream("GET", "/api/live", timeout=httpx.Timeout(HTTP_TIMEOUT, read=None)) as answer:
                self.status, self.content_type = answer.status_code, answer.headers.get("content-type", "")
                self.ready.set()
                for line in answer.iter_lines():
                    self.raw.append(line)
                    if line.startswith("data:"):
                        self.events.put(json.loads(line[5:].strip()))
        self.ready.set()

    def wait_for(self, predicate: Any, contract: str) -> dict[str, Any]:
        deadline = time.monotonic() + LIVE_WAIT_MS / 1000
        while time.monotonic() < deadline:
            with contextlib.suppress(queue.Empty):
                event = self.events.get(timeout=max(deadline - time.monotonic(), 0.01))
                if predicate(event):
                    return event
        pytest.fail(f"GET /api/live sent no event for: {contract}")


class StubGotenberg(BaseHTTPRequestHandler):
    calls: list[tuple[str, bytes]] = []
    PDF = (b"%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Count 0/Kids[]>>endobj\n"
           b"trailer<</Root 1 0 R>>\n%%EOF\n")

    def do_POST(self) -> None:
        body = self.rfile.read(int(self.headers.get("Content-Length", "0")))
        type(self).calls.append((self.path, body))
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(self.PDF)))
        self.end_headers()
        self.wfile.write(self.PDF)

    def do_HEAD(self) -> None:
        self.send_response(200)
        self.end_headers()

    do_GET = do_HEAD

    def log_message(self, *args: Any) -> None:
        return


def free_port() -> int:
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        return probe.getsockname()[1]


@contextmanager
def app_copy(extra_env: dict[str, str]) -> Iterator[str]:
    root = Path(DEPLOYED_APP)
    manifest_path = root / "run.json"
    manifest = json.loads((manifest_path if manifest_path.exists() else Path("/app/run.json")).read_text())
    port = free_port()
    base = f"http://127.0.0.1:{port}"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_PUBLIC_URL": base, **extra_env}
    with tempfile.NamedTemporaryFile("w+", suffix=".log") as log:
        proc = subprocess.Popen(manifest["serve"], shell=True, cwd=root, env=env, stdout=log,
                                stderr=subprocess.STDOUT, start_new_session=True)
        try:
            deadline = time.monotonic() + BOOT_SECONDS
            while time.monotonic() < deadline:
                with contextlib.suppress(httpx.HTTPError):
                    if httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT).status_code == 200:
                        break
                with contextlib.suppress(subprocess.TimeoutExpired):
                    proc.wait(timeout=0.2)
                    log.seek(0)
                    pytest.fail(f"app copy exited at boot: {log.read()[-2000:]}")
            else:
                log.seek(0)
                pytest.fail(f"app copy did not answer /api/health: {log.read()[-2000:]}")
            yield base
        finally:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(proc.pid, 15)
            with contextlib.suppress(subprocess.TimeoutExpired):
                proc.wait(timeout=10)


def status(scope: Any, name: str) -> Locator:
    return scope.get_by_role("status", name=name, exact=True)


def button(scope: Any, name: str) -> Locator:
    return scope.get_by_role("button", name=name, exact=True)


def textbox(scope: Any, name: str) -> Locator:
    return scope.get_by_role("textbox", name=name, exact=True)


def dialog(scope: Any, name: str) -> Locator:
    return scope.get_by_role("dialog", name=name, exact=True)


def combo(scope: Any, name: str) -> Locator:
    return scope.get_by_role("combobox", name=name, exact=True)


def grid(page: Page) -> Locator:
    return page.get_by_role("grid", name="Reservation timeline", exact=True)


def main_area(page: Page) -> Locator:
    return page.get_by_role("main")


def block(page: Page, stay_id: str, first_night: str | None = None) -> Locator:
    tail = f'[data-first-night="{first_night}"]' if first_night else ""
    return page.locator(f'[data-stay-id="{stay_id}"]{tail}')


def cell(page: Page, room_id: str, night: str) -> Locator:
    return grid(page).locator(f'[data-date="{night}"][data-room-id="{room_id}"]')


def room_row(page: Page, room_id: str) -> Locator:
    return grid(page).get_by_role("row").and_(page.locator(f'[data-room-id="{room_id}"]'))


def stay_button(page: Page, guest: str, number: str, arrival: str, departure: str) -> Locator:
    return button(page, f"Stay {guest}, room {number}, {arrival} to {departure}")


def table_rows(table: Locator) -> list[list[str]]:
    rows = table.evaluate(
        """t => [...t.querySelectorAll('tr,[role=row]')].map(r =>
            [...r.querySelectorAll('td,th,[role=cell],[role=gridcell],[role=rowheader],[role=columnheader]')]
            .map(c => c.innerText.trim()))"""
    )
    return [[norm(c) for c in row] for row in rows[1:]]


def selected_text(locator: Locator) -> str:
    return locator.evaluate("s => s.options[s.selectedIndex].text")


def key(page: Page, name: str) -> None:
    page.keyboard.press(name)
    advance(page, KEY_SETTLE_MS)


def visit(page: Page, base: str, path: str) -> None:
    seen = page._nightroll_live
    seen.clear()
    page.goto(f"{base}{path}")
    if path.startswith("/checkin"):
        return
    deadline = time.monotonic() + LIVE_READY_SECONDS
    while not seen and time.monotonic() < deadline:
        page.evaluate("1")


def goto_after_sign_out(page: Page, url: str) -> None:
    try:
        page.goto(url)
    except PlaywrightError as error:
        if "interrupted by another navigation" not in str(error):
            raise
        page.wait_for_load_state()
        page.goto(url)


@contextmanager
def staff(browser: Browser, h: Hotel, role: str = "desk", path: str = "/desk", viewport: dict[str, int] = DESKTOP,
          reduced: Any = "no-preference", base: str | None = None) -> Iterator[Page]:
    origin = base or h.base
    email, password = h.users[role]
    with open_app(browser, f"{origin}/", reduced_motion=reduced) as page:
        page.set_viewport_size(viewport)
        page._nightroll_live = []
        page.on("response", lambda r: page._nightroll_live.append(r.url) if "/api/live" in r.url else None)
        answer = page.context.request.post(f"{origin}/api/session", data={"email": email, "password": password})
        assert answer.status == 200, f"POST /api/session in the browser: {answer.status}"
        visit(page, origin, path)
        yield page


def requests_to(page: Page, method: str, pattern: str) -> list[Any]:
    seen: list[Any] = []
    page.on("request", lambda r: seen.append(r) if r.method == method and re.search(pattern, r.url) else None)
    return seen


CURRENT_JS = """() => {
  const e = document.activeElement;
  if (!e) return null;
  const c = e.closest('[data-date][data-room-id]');
  if (c) return {room: c.getAttribute('data-room-id'), first: c.getAttribute('data-date'), nights: 1};
  const b = e.closest('[data-stay-id]');
  if (b) return {room: b.getAttribute('data-room-id'), first: b.getAttribute('data-first-night'),
                 nights: Number(b.getAttribute('data-nights'))};
  return null;
}"""


def go_to(page: Page, h: Hotel, room_key: str, night: str) -> None:
    numbers = sorted(h.data["rooms"].keys())
    order = [h.room(k) for k in numbers]
    button(page, "Next nights").focus()
    target_room = order.index(h.room(room_key))
    target = date.fromisoformat(night)
    for _ in range(NAV_LIMIT):
        where = page.evaluate(CURRENT_JS)
        if where is None:
            key(page, "ArrowRight")
            continue
        here = order.index(where["room"])
        first = date.fromisoformat(where["first"])
        if here != target_room:
            key(page, "ArrowDown" if here < target_room else "ArrowUp")
        elif target < first:
            key(page, "ArrowLeft")
        elif target >= first + timedelta(days=max(where["nights"], 1)):
            key(page, "ArrowRight")
        else:
            return
    pytest.fail(f"arrow keys did not reach the cell for {room_key} {night}; expected focus to follow (L189)")


def tab_to(page: Page, target: Locator, back: bool = False) -> None:
    target.wait_for(state="attached")
    for _ in range(TAB_LIMIT):
        if target.evaluate("e => e === document.activeElement"):
            return
        page.keyboard.press("Shift+Tab" if back else "Tab")
    pytest.fail(f"Tab never reached {target}; expected every control to be reachable by keyboard")


def type_in(page: Page, target: Locator, value: str) -> None:
    tab_to(page, target)
    page.keyboard.press("Control+a")
    page.keyboard.type(value)


def choose_by_keyboard(page: Page, target: Locator, value: str) -> None:
    tab_to(page, target)
    for _ in range(TAB_LIMIT):
        if selected_text(target).startswith(value):
            return
        page.keyboard.press("ArrowDown")
    pytest.fail(f"ArrowDown never chose an option starting {value!r}; expected a native drop-down list (L175)")


def assert_tab_wraps(page: Page, box: Locator) -> None:
    for chord in ("Tab", "Shift+Tab"):
        tags: list[int] = []
        for _ in range(WRAP_PRESSES):
            page.keyboard.press(chord)
            inside = box.evaluate("d => d.contains(document.activeElement)")
            assert inside, f"{chord} left the open dialog (L197)"
            tags.append(page.evaluate(
                "() => { const e = document.activeElement; window.__tabTag = window.__tabTag || 0;"
                " if (!e.__tag) e.__tag = ++window.__tabTag; return e.__tag; }"))
        assert len(set(tags)) < len(tags), f"{chord} did not wrap inside the dialog (L197)"


def open_new_stay(page: Page) -> Locator:
    click(button(page, "New stay"))
    advance(page, PANEL_SETTLE_MS)
    box = dialog(page, "New stay")
    expect(box).to_be_visible()
    return box


def fill_new_stay(box: Locator, name: str, email: str, arrival: str, departure: str, room: str,
                  plan: str = "Flexible", guests: str = "1") -> None:
    fill(textbox(box, "Guest name"), name)
    fill(textbox(box, "Guest email"), email)
    fill(textbox(box, "Guest phone"), "+1 555 0100")
    fill(textbox(box, "Arrival"), arrival)
    fill(textbox(box, "Departure"), departure)
    fill(box.get_by_role("spinbutton", name="Guests", exact=True), guests)
    select(combo(box, "Room"), room)
    select(combo(box, "Rate plan"), plan)


def open_stay(page: Page, guest: str, number: str, arrival: str, departure: str) -> Locator:
    click(stay_button(page, guest, number, arrival, departure))
    advance(page, PANEL_SETTLE_MS)
    box = dialog(page, "Stay")
    expect(box).to_be_visible()
    return box


def page_text(page: Page) -> str:
    return page.evaluate("() => document.body.innerText")


def test_wf_stay_create_keyboard_happy(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=MON, now=MON_NOON)
    email = fresh_email("guest")
    with staff(browser, h) as page:
        expect(status(page, "Free rooms")).to_have_text(free_rooms(2))
        go_to(page, h, "r101", MON)
        key(page, "n")
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "New stay")
        expect(box).to_be_visible()
        expect(textbox(box, "Arrival")).to_have_value(MON)
        assert selected_text(combo(box, "Room")) == "101", "N fills in the current cell's room (L190)"
        page.keyboard.press("Escape")
        advance(page, PANEL_SETTLE_MS)
        expect(box).to_be_hidden()
        where = page.evaluate(CURRENT_JS)
        assert where and where["room"] == h.room("r101"), "focus returns to the cell that opened New stay (L197)"

        opener = button(page, "Previous nights")
        opener.focus()
        key(page, "n")
        advance(page, PANEL_SETTLE_MS)
        expect(box).to_be_visible()
        assert_tab_wraps(page, box)
        type_in(page, textbox(box, "Guest name"), "Ana Vale")
        type_in(page, textbox(box, "Guest email"), email)
        type_in(page, textbox(box, "Guest phone"), "+1 555 0100")
        type_in(page, textbox(box, "Arrival"), MON)
        type_in(page, textbox(box, "Departure"), day(MON, 1))
        type_in(page, box.get_by_role("spinbutton", name="Guests", exact=True), "1")
        choose_by_keyboard(page, combo(box, "Rate plan"), "Flexible")
        advance(page, BREAKDOWN_MS)
        expect(status(box, "Stay total")).to_have_text(money(13250))
        tab_to(page, button(box, "Create stay"))
        page.keyboard.press("Enter")
        expect(status(page, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.")
        advance(page, PANEL_SETTLE_MS)
        expect(box).to_be_hidden()
        expect(opener).to_be_focused()
        expect(stay_button(page, "Ana Vale", "101", MON, day(MON, 1))).to_be_visible()
        expect(status(page, "Free rooms")).to_have_text(free_rooms(1))
    blocks = h.client("desk").get("/api/timeline", params={"from": MON, "to": day(MON, 1)}).json()["blocks"]
    assert [b["guestName"] for b in blocks] == ["Ana Vale"]
    assert h.stay(blocks[0]["stayId"])["totalCents"] == 13250
    message = mail_to(mail, email, 1)[0]
    assert message["Subject"] == f"Check in for your stay at {h.name}"


def test_nightly_pricing_worked_examples(app_url: str, browser: Browser) -> None:
    worked = [
        ("flex", "Flexible", 3, "2027-03-11", "2027-03-14",
         [(13775, 1205, 600, 15580), (16625, 1455, 600, 18680), (16625, 1455, 600, 18680)], 52940),
        ("flex", "Flexible", 1, MON, TAX_START, [(12000, 1050, 200, 13250)], 13250),
        ("corp", "Corporate", 1, MON, TAX_START, [(12040, 1054, 200, 13294)], 13294),
    ]
    h = make_hotel(app_url, rooms={"101": "clean"})
    desk = h.client("desk")
    for plan, _, guests, arrival, departure, nights, total in worked:
        answer = desk.post("/api/stays/quote", json={"arrival": arrival, "departure": departure, "guests": guests,
                                                     "ratePlanId": h.plan(plan), "roomId": h.room("r101")})
        assert answer.status_code == 200, answer.text
        body = answer.json()
        assert body["totalCents"] == total
        got = [(n["roomCents"], n["taxCents"], n["cityTaxCents"], n["totalCents"]) for n in body["nightly"]]
        assert got == nights
    with staff(browser, h) as page:
        for plan, plan_name, guests, arrival, departure, nights, total in worked:
            box = open_new_stay(page)
            fill_new_stay(box, "Ana Vale", fresh_email("guest"), arrival, departure, "101", plan_name, str(guests))
            advance(page, BREAKDOWN_MS)
            expect(status(box, "Stay total")).to_have_text(money(total))
            rows = table_rows(box.get_by_role("table", name="Nightly breakdown", exact=True))
            assert [[money(c) for c in n] for n in nights] == [r[1:] for r in rows]
            assert [r[0] for r in rows] == [day(arrival, i) for i in range(len(nights))]
            click(button(box, "Close"))
            advance(page, PANEL_SETTLE_MS)

    posted = make_hotel(app_url, rooms={"101": "clean"}, business_date="2027-03-11", now="2027-03-11T12:00:00-06:00")
    created = post_stay(posted.client("desk"), create_body(posted, "r101", "2027-03-11", "2027-03-14", guests=3))
    assert created.status_code == 201, created.text
    stay_id = created.json()["id"]
    assert posted.client("desk").post(f"/api/stays/{stay_id}/check-in").status_code == 200
    posted.clock("2027-03-12T04:00:00-06:00")
    assert posted.close("2027-03-11").status_code == 200
    posted.clock("2027-03-13T04:00:00-06:00")
    assert posted.close("2027-03-12").status_code == 200
    entries = posted.stay(stay_id)["folios"][0]["entries"]
    assert [(e["date"], e["description"], e["amountCents"]) for e in entries] == [
        ("2027-03-11", "Room charge, room 101", 13775), ("2027-03-11", "Tax, room 101", 1205),
        ("2027-03-11", "City tax, room 101", 600),
        ("2027-03-12", "Room charge, room 101", 16625), ("2027-03-12", "Tax, room 101", 1455),
        ("2027-03-12", "City tax, room 101", 600),
    ]
    assert all(e["roomNumber"] == "101" and e["kind"] == "charge" for e in entries)


def test_tax_rate_from_stated_date(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=MON, now=MON_NOON,
                   stays=[st("s1", "r101", "Ana Vale", MON, "2027-03-10", "in_house"),
                          st("s2", "r102", "Mara Okafor", TAX_START, "2027-03-10")])
    before = h.stay("s1")
    assert [n["taxCents"] for n in before["nightly"]] == [1050, 1050]
    owner = h.client("owner")
    with staff(browser, h, "owner", "/rates") as page:
        fill(textbox(page, "Tax rate percent"), "9.25")
        fill(textbox(page, "Starts on"), MON)
        click(button(page, "Save tax rate"))
        expect(page.get_by_text("The start date must be after the business date.").first).to_be_visible()
        fill(textbox(page, "Starts on"), TAX_START)
        click(button(page, "Save tax rate"))
        expect(status(page, "Rates status")).to_have_text("Rates saved.")
        expect(page.get_by_role("cell", name="9.25%", exact=True)).to_be_visible()
        assert table_rows(page.get_by_role("table", name="Tax rates", exact=True)) == [
            ["8.75%", "—"], ["9.25%", TAX_START]]
    field_err(owner.post("/api/tax-rates", json={"percent": "31", "startDate": TAX_START}), "percent",
              "Enter a rate from 0 to 30 with at most two decimals.")
    field_err(owner.post("/api/tax-rates", json={"percent": "9.25", "startDate": MON}), "startDate",
              "The start date must be after the business date.")
    rates = owner.get("/api/tax-rates").json()["taxRates"]
    assert [r["startDate"] for r in rates] == [None, TAX_START]
    assert Decimal(str(rates[0]["percent"])) == Decimal("8.75") and Decimal(str(rates[1]["percent"])) == Decimal("9.25")

    quote = h.client("desk").post("/api/stays/quote", json={
        "arrival": MON, "departure": "2027-03-10", "guests": 1, "ratePlanId": h.plan(), "roomId": h.room("r102")})
    assert [n["taxCents"] for n in quote.json()["nightly"]] == [1050, 1110]
    assert quote.json()["totalCents"] == 26560
    other = make_hotel(app_url, rooms={"101": "clean"}, business_date=MON, now=MON_NOON,
                       stays=[st("s1", "r101", "Ana Vale", MON, "2027-03-10")])
    assert other.client("owner").post("/api/tax-rates", json={"percent": "9.25", "startDate": TAX_START}).status_code == 201
    booked = other.stay("s1")
    assert [n["taxCents"] for n in booked["nightly"]] == [1050, 1110], "a booked stay follows the rate until posted"
    h.clock("2027-03-08T18:00:00-06:00")
    assert h.stay("s2")["cancellation"]["feeCents"] == 12000 + 1110 + 200, "the fee follows the first night's rate"
    h.clock(MON_OPEN)
    assert h.close(MON).status_code == 200
    h.clock("2027-03-10T04:00:00-06:00")
    assert h.close(TAX_START).status_code == 200
    stay = h.stay("s1")
    taxes = [(e["date"], e["amountCents"]) for e in stay["folios"][0]["entries"] if e["description"].startswith("Tax,")]
    assert taxes == [(MON, 1050), (TAX_START, 1110)]
    folio = stay["folios"][0]
    paid = owner.post(f"/api/folios/{folio['id']}/payments",
                      json={"method": "cash", "amountCents": folio["balanceCents"], "reference": None})
    assert paid.status_code == 201, paid.text
    closed = owner.post(f"/api/folios/{folio['id']}/close")
    assert closed.status_code == 200, closed.text
    number = closed.json()["invoice"]["number"]
    pdf = norm(pdf_text(S3().get(f"invoices/{h.id}/{number}.pdf")))
    assert f"{MON} Tax, room 101 {money(1050)}" in pdf and f"{TAX_START} Tax, room 101 {money(1110)}" in pdf


def test_wf_stay_create_keyboard_double_press(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"})
    email = fresh_email("guest")
    with staff(browser, h) as page:
        sent = requests_to(page, "POST", r"/api/stays$")
        box = open_new_stay(page)
        fill_new_stay(box, "Ana Vale", email, BD, day(BD, 1), "101")
        with held(page, "**/api/stays") as release:
            create = button(box, "Create stay")
            click(create)
            expect(create).to_have_attribute("aria-busy", "true")
            expect(status(page, "Desk notices")).to_have_text("Creating stay…")
            click(create)
            release()
            expect(status(page, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.")
        assert len(sent) == 1, f"a double press sent {len(sent)} requests (L201)"
    blocks = h.client("desk").get("/api/timeline", params={"from": BD, "to": day(BD, 1)}).json()["blocks"]
    assert len(blocks) == 1
    assert len(h.stay(blocks[0]["stayId"])["folios"]) == 1
    assert len(mail_to(mail, email, 1)) == 1


def test_create_replay_and_key_conflict(app_url: str, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"})
    desk = h.client("desk")
    email = fresh_email("guest")
    body = create_body(h, "r101", BD, day(BD, 2), email=email)
    key_value = idempotency_key()
    first = post_stay(desk, body, key_value)
    assert first.status_code == 201, first.text
    replay = post_stay(desk, body, key_value)
    assert replay.status_code == 201 and replay.json()["id"] == first.json()["id"]
    other = post_stay(desk, {**body, "departure": day(BD, 1)}, key_value)
    err(other, 409, "This request was already used for a different stay.")
    field_err(desk.post("/api/stays", json=create_body(h, "r102", BD, day(BD, 1))), "idempotencyKey",
              "Send an Idempotency-Key header.")
    field_err(post_stay(desk, create_body(h, "r102", BD, day(BD, 1)), "k" * 201), "idempotencyKey",
              "Send an Idempotency-Key header.")
    assert post_stay(desk, create_body(h, "r102", BD, day(BD, 1), email=email.upper()), "k" * 200).status_code == 201
    blocks = desk.get("/api/timeline", params={"from": BD, "to": day(BD, 2)}).json()["blocks"]
    assert sorted(b["roomId"] for b in blocks) == sorted([h.room("r101"), h.room("r102")])
    assert len(h.stay(first.json()["id"])["folios"]) == 1
    guests = [g for g in desk.get("/api/guests").json()["guests"] if g["email"].lower() == email.lower()]
    assert len(guests) == 1, "an email already on a profile, in any case, reuses that profile (L452)"
    assert len(mail_to(mail, email, 2)) == 2, "one mail per created stay, none for the replay"


def test_stay_nights_and_overlaps(app_url: str) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    desk = h.client("desk")
    stay = h.stay("s1")
    assert [n["date"] for n in stay["nightly"]] == [BD, SECOND_NIGHT, THIRD_NIGHT]
    turnover = post_stay(desk, create_body(h, "r101", MON, "2027-03-10", name="Mara Okafor"))
    assert turnover.status_code == 201, turnover.text
    err(post_stay(desk, create_body(h, "r101", THIRD_NIGHT, MON, name="Tomas Lindqvist")), 409, just_taken("101"))
    err(post_stay(desk, create_body(h, "r101", TAX_START, "2027-03-11", name="Tomas Lindqvist")), 409, just_taken("101"))
    extend = desk.patch(f"/api/stays/{stay['id']}", json={"version": stay["version"], "departure": TAX_START})
    err(extend, 409, occupied_on("101", MON))
    assert h.stay("s1")["departure"] == MON, "a refused extend changes nothing"
    assert desk.post(f"/api/stays/{turnover.json()['id']}/cancel").status_code == 200
    ok = desk.patch(f"/api/stays/{stay['id']}", json={"version": stay["version"], "departure": TAX_START})
    assert ok.status_code == 200, ok.text
    assert ok.json()["version"] != stay["version"]
    err(desk.patch(f"/api/stays/{stay['id']}", json={"version": stay["version"], "departure": MON}), 409,
        "This stay was changed by someone else. It now shows the latest.")


def test_wf_stay_create_keyboard_invalid_recovery(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"})
    email = fresh_email("guest")
    with staff(browser, h) as page:
        box = open_new_stay(page)
        fill(textbox(box, "Guest email"), BAD_EMAIL)
        fill(textbox(box, "Arrival"), PRIOR_NIGHT)
        fill(textbox(box, "Departure"), PRIOR_NIGHT)
        fill(box.get_by_role("spinbutton", name="Guests", exact=True), "7")
        click(button(box, "Create stay"))
        alert = box.get_by_role("alert", name="Form errors", exact=True)
        expect(alert).to_be_visible()
        cases = [
            ("Guest name", "Enter the guest's name.", textbox(box, "Guest name")),
            ("Guest email", "Enter a valid email address.", textbox(box, "Guest email")),
            ("Arrival", "Arrival cannot be before the business date.", textbox(box, "Arrival")),
            ("Departure", "Departure must be after arrival.", textbox(box, "Departure")),
            ("Guests", "Guests must be between 1 and 6.", box.get_by_role("spinbutton", name="Guests", exact=True)),
            ("Room", "Choose a room.", combo(box, "Room")),
            ("Rate plan", "Choose a rate plan.", combo(box, "Rate plan")),
        ]
        for label, message, target in cases:
            link = alert.get_by_role("link", name=f"{label}: {message}", exact=True)
            expect(link).to_be_visible()
            click(link)
            expect(target).to_be_focused()
        assert h.client("desk").get("/api/timeline", params={"from": BD, "to": day(BD, 1)}).json()["blocks"] == []
        fill_new_stay(box, "Ana Vale", email, BD, day(BD, 1), "101")
        click(button(box, "Create stay"))
        expect(status(page, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.")
    desk = h.client("desk")
    assert [m for m in mail.messages() if BAD_EMAIL in addresses(m.get("To"))] == []
    assert len(mail_to(mail, email, 1)) == 1
    field_err(post_stay(desk, create_body(h, "r101", MON, day(MON, 91))), "departure", "Stays are limited to 90 nights.")
    field_err(post_stay(desk, {**create_body(h, "r101", MON, day(MON, 1)), "guests": 0}), "guests",
              "Guests must be between 1 and 6.")


def test_wf_stay_move_keyboard_place_and_drop(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=MON, now=MON_NOON,
                   stays=[st("s1", "r101", "Ana Vale", MON, "2027-03-10")])
    stay_id = h.stay_id("s1")
    with staff(browser, h) as page:
        sent = requests_to(page, "POST", rf"/api/stays/{stay_id}/move$")
        notices = status(page, "Desk notices")
        go_to(page, h, "r101", MON)
        button(page, "Room 101 status: clean").focus()
        key(page, "m")
        expect(notices).to_have_text("Picked up Ana Vale.")
        expect(block(page, stay_id)).to_have_attribute("data-picked-up", "true")
        key(page, "ArrowDown")
        expect(notices).to_have_text(f"Over room 102, {MON}.")
        for offset in range(1, 5):
            key(page, "ArrowRight")
            expect(notices).to_have_text(f"Over room 102, {day(MON, offset)}.")
        assert sent == [], "nothing is sent before the drop"
        key(page, "Enter")
        expect(notices).to_have_text("Moved Ana Vale to room 102.")
        moved = block(page, stay_id)
        expect(moved).to_have_attribute("data-room-id", h.room("r102"))
        expect(moved).to_have_attribute("data-first-night", "2027-03-12")
        expect(moved).to_have_attribute("data-nights", "2")
        assert moved.get_attribute("data-picked-up") != "true"
        assert len(sent) == 1
        body = json.loads(sent[0].post_data)
        assert body["roomId"] == h.room("r102") and body["arrival"] == "2027-03-12" and "fromNight" not in body
    stay = h.stay("s1")
    assert (stay["arrival"], stay["departure"], stay["totalCents"]) == ("2027-03-12", "2027-03-14", 33026)
    assert [(n["roomCents"], n["taxCents"], n["cityTaxCents"]) for n in stay["nightly"]] == [(15000, 1313, 200)] * 2
    assert [s["roomId"] for s in stay["segments"]] == [h.room("r102")]


def test_wf_stay_move_keyboard_in_house(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=SECOND_NIGHT,
                   now="2027-03-06T12:00:00-06:00",
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    stay_id = h.stay_id("s1")
    target_number = "102"
    with staff(browser, h) as page:
        sent = requests_to(page, "POST", rf"/api/stays/{stay_id}/move$")
        go_to(page, h, "r101", SECOND_NIGHT)
        key(page, "m")
        expect(status(page, "Desk notices")).to_have_text("Picked up Ana Vale.")
        key(page, "ArrowDown")
        expect(status(page, "Desk notices")).to_contain_text(f"Over room {target_number}, ")
        settled = status(page, "Desk notices").inner_text()
        key(page, "ArrowRight")
        key(page, "ArrowLeft")
        assert status(page, "Desk notices").inner_text() == settled, "Left and Right do nothing in house (L191)"
        key(page, "Enter")
        expect(status(page, "Desk notices")).to_have_text("Moved Ana Vale to room 102.")
        expect(block(page, stay_id, BD)).to_have_attribute("data-room-id", h.room("r101"))
        expect(block(page, stay_id, BD)).to_have_attribute("data-nights", "1")
        expect(block(page, stay_id, SECOND_NIGHT)).to_have_attribute("data-room-id", h.room("r102"))
        expect(block(page, stay_id, SECOND_NIGHT)).to_have_attribute("data-nights", "2")
        body = json.loads(sent[0].post_data)
        assert body["fromNight"] == SECOND_NIGHT and "arrival" not in body and body["roomId"] == h.room("r102")
    segments = h.stay("s1")["segments"]
    assert [(s["roomNumber"], s["firstNight"], s["nights"]) for s in segments] == [
        ("101", BD, 1), ("102", SECOND_NIGHT, 2)]


def test_escape_cancels_pick_up(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    stay_id = h.stay_id("s1")
    version = h.stay("s1")["version"]
    with staff(browser, h) as page:
        sent = requests_to(page, "POST", r"/api/stays/.*/move$")
        go_to(page, h, "r101", BD)
        key(page, "m")
        expect(block(page, stay_id)).to_have_attribute("data-picked-up", "true")
        key(page, "ArrowDown")
        expect(status(page, "Desk notices")).to_have_text(f"Over room 102, {BD}.")
        key(page, "Escape")
        expect(status(page, "Desk notices")).to_have_text("Move cancelled.")
        expect(block(page, stay_id)).to_have_attribute("data-room-id", h.room("r101"))
        expect(block(page, stay_id)).not_to_have_attribute("data-picked-up", "true")
        go_to(page, h, "r101", BD)
        key(page, "m")
        expect(status(page, "Desk notices")).to_have_text("Picked up Ana Vale.")
        key(page, "Enter")
        expect(status(page, "Desk notices")).to_have_text("Move cancelled.")
        assert sent == [], "a cancelled pick-up sends nothing to the server (L36)"
    stay = h.stay("s1")
    assert stay["version"] == version and stay["segments"][0]["roomId"] == h.room("r101")


def test_wf_stay_move_keyboard_refused_drop(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, stays=[st("s1", "r101", "Ana Vale", BD, MON), st("s2", "r102", "Mara Okafor", BD, MON)])
    stay_id = h.stay_id("s1")
    refusal = occupied_on("102", BD)
    with staff(browser, h) as page:
        expect(block(page, stay_id)).to_have_attribute("data-room-id", h.room("r101"))
        go_to(page, h, "r101", BD)
        key(page, "m")
        key(page, "ArrowDown")
        expect(status(page, "Desk notices")).to_have_text(f"Over room 102, {BD}.")
        key(page, "Enter")
        expect(status(page, "Desk notices")).to_have_text(refusal)
        expect(block(page, stay_id)).to_have_attribute("data-room-id", h.room("r101"))
        other_folio = h.stay("s2")["folios"][0]["id"]
        other_panel = open_stay(page, "Mara Okafor", "102", BD, MON)
        assert h.client("desk2").post(f"/api/folios/{other_folio}/charges",
                                      json={"description": "Minibar", "amountCents": 3333}).status_code == 201
        expect(other_panel).to_contain_text("Minibar", timeout=LIVE_WAIT_MS)
        expect(status(page, "Desk notices")).to_have_text(refusal)
    stay = h.stay("s1")
    assert [s["roomId"] for s in stay["segments"]] == [h.room("r101")]


def test_stay_panel_keeps_newest_state(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, stays=[st("s1", "r101", "Ana Vale", BD, MON), st("s2", "r102", "Mara Okafor", BD, MON)])
    first, second = h.stay_id("s1"), h.stay_id("s2")
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        click(button(panel, "Close"))
        advance(page, PANEL_MID_MS)
        click(stay_button(page, "Ana Vale", "101", BD, MON))
        advance(page, LIVE_MAX_DELAY_MS)
        expect(panel).to_be_visible()
        assert float(style(panel, "opacity")["opacity"]) > 0, "a reopened Stay is not faded out"
        box = panel.bounding_box()
        assert box and box["x"] < DESKTOP["width"], "a reopened Stay stays inside the viewport"
        click(button(panel, "Close"))
        advance(page, PANEL_SETTLE_MS)
        expect(panel).to_be_hidden()

        with held(page, f"**/api/stays/{first}") as release:
            click(stay_button(page, "Ana Vale", "101", BD, MON))
            click(stay_button(page, "Mara Okafor", "102", BD, MON))
            expect(panel).to_contain_text("Mara Okafor")
            release()
            advance(page, PANEL_SETTLE_MS)
        page.evaluate("1")
        expect(panel).to_contain_text("Mara Okafor")
        expect(panel).not_to_contain_text("Ana Vale")

        sent = requests_to(page, "POST", r"/api/folios/.*/charges$")
        region = panel.get_by_role("region", name="Folio A", exact=True)
        click(button(region, "Add charge"))
        advance(page, PANEL_SETTLE_MS)
        charge = dialog(page, "Add charge")
        fill(textbox(charge, "Description"), "Minibar")
        fill(textbox(charge, "Amount"), dollars(3333))
        with held(page, "**/api/folios/*/charges") as release:
            save = button(charge, "Save charge")
            click(save)
            expect(save).to_have_attribute("aria-busy", "true")
            expect(status(panel, "Folio status")).to_have_text("Saving charge…")
            click(save)
            release()
            expect(status(panel, "Folio status")).to_have_text(charge_added(3333))
        assert len(sent) == 1, "a further press while pending sends nothing (L201)"
        assert h.client("owner").post(f"/api/rooms/{h.room('r101')}/status", json={"status": "dirty"}).status_code == 200
        expect(button(page, "Room 101 status: dirty")).to_be_visible(timeout=LIVE_WAIT_MS)
        expect(status(panel, "Folio status")).to_have_text(charge_added(3333))
    assert [e["amountCents"] for e in h.stay(second)["folios"][0]["entries"]] == [3333]


def test_timeline_published_attributes(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "dirty", "103": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", PRIOR_NIGHT, MON, "in_house"),
                          st("s2", "r103", "Mara Okafor", BD, MON),
                          st("s3", "r102", "Priya Raman", THIRD_NIGHT, MON, "cancelled")])
    with staff(browser, h) as page:
        expect(status(page, "Business date")).to_have_text(BD)

        def assert_attributes() -> None:
            expect(status(page, "Free rooms")).to_have_text(free_rooms(1))
            grid_box = grid(page)
            headers = grid_box.get_by_role("columnheader").and_(page.locator("[data-date]"))
            dates = [day(PRIOR_NIGHT, i) for i in range(14)]
            expect(headers).to_have_count(14)
            assert [headers.nth(i).get_attribute("data-date") for i in range(14)] == dates
            marked = grid_box.locator('[data-business-date="true"]')
            expect(marked).to_have_count(1)
            assert marked.get_attribute("data-date") == BD
            expect(button(page, "Room 102 status: dirty")).to_be_visible()
            for room in ("r101", "r102", "r103"):
                row = room_row(page, h.room(room))
                expect(row).to_have_count(1)
                expect(row).to_have_attribute("data-room-type", "Queen")
                expect(row.get_by_role("rowheader", name=f"Room {room[1:]}", exact=False)).to_be_visible()
                for night in dates:
                    expect(cell(page, h.room(room), night)).to_have_count(1)
            live = block(page, h.stay_id("s1"))
            for name, value in {"data-room-id": h.room("r101"), "data-first-night": PRIOR_NIGHT, "data-nights": "4",
                                "data-status": "in_house"}.items():
                expect(live).to_have_attribute(name, value)
            expect(block(page, h.stay_id("s2"))).to_have_attribute("data-status", "booked")
            expect(block(page, h.stay_id("s3"))).to_have_attribute("data-status", "cancelled")
            expect(main_area(page)).to_have_attribute("data-ground", "day")
            expect(main_area(page)).to_have_attribute("data-close-phase", "idle")

        assert_attributes()
        page.reload()
        assert_attributes()
        click(button(page, "Next nights"))
        advance(page, PANEL_SETTLE_MS)
        headers = grid(page).get_by_role("columnheader").and_(page.locator("[data-date]"))
        expect(headers.first).to_have_attribute("data-date", day(PRIOR_NIGHT, 7))
        click(button(page, "Previous nights"))
        advance(page, PANEL_SETTLE_MS)
        expect(headers.first).to_have_attribute("data-date", PRIOR_NIGHT)
        moved = h.client("desk").post(f"/api/stays/{h.stay_id('s2')}/move", json={
            "version": h.stay("s2")["version"], "roomId": h.room("r102")})
        assert moved.status_code == 200, moved.text
        expect(block(page, h.stay_id("s2"))).to_have_attribute("data-room-id", h.room("r102"), timeout=LIVE_WAIT_MS)
        page.reload()
        expect(block(page, h.stay_id("s2"))).to_have_attribute("data-room-id", h.room("r102"))
    api = h.client("desk").get("/api/timeline", params={"from": PRIOR_NIGHT, "to": day(PRIOR_NIGHT, 13)}).json()
    assert api["businessDate"] == BD and len(api["dates"]) == 14
    assert {b["stayId"]: b["nights"] for b in api["blocks"]}[h.stay_id("s1")] == 4


def test_last_room_parallel_creates(app_url: str, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"})
    racers = 6
    emails = [fresh_email("guest") for _ in range(racers)]
    clients = [h.new_client("desk") for _ in range(racers)]
    bodies = [create_body(h, "r101", BD, day(BD, 2), email=e, name=f"Ana Vale {i}") for i, e in enumerate(emails)]
    gate = threading.Barrier(racers)

    def race(index: int) -> httpx.Response:
        gate.wait()
        return post_stay(clients[index], bodies[index])

    with ThreadPoolExecutor(racers) as pool:
        answers = list(pool.map(race, range(racers)))
    assert sorted(a.status_code for a in answers) == [201] + [409] * (racers - 1), [a.text for a in answers]
    for answer in answers:
        if answer.status_code == 409:
            err(answer, 409, just_taken("101"))
    desk = h.client("desk")
    blocks = [b for b in desk.get("/api/timeline", params={"from": BD, "to": day(BD, 2)}).json()["blocks"]
              if b["roomId"] == h.room("r101")]
    assert len(blocks) == 1
    assert len(h.stay(blocks[0]["stayId"])["folios"]) == 1
    winner = next(i for i, a in enumerate(answers) if a.status_code == 201)
    assert len(mail_to(mail, emails[winner], 1)) == 1
    delivered = mail.messages()
    for index, email in enumerate(emails):
        if index != winner:
            assert not [m for m in delivered if email in [a.lower() for a in addresses(m.get("To"))]]

    same_email = fresh_email("guest")
    same_body = create_body(h, "r102", BD, day(BD, 1), email=same_email)
    same_key = idempotency_key()
    gate_same = threading.Barrier(4)

    def replay(client: httpx.Client) -> httpx.Response:
        gate_same.wait()
        return post_stay(client, same_body, same_key)

    with ThreadPoolExecutor(4) as pool:
        replays = list(pool.map(replay, clients[:4]))
    created = {a.json()["id"] for a in replays if a.status_code == 201}
    assert len(created) == 1, [a.text for a in replays]
    assert len(mail_to(mail, same_email, 1)) == 1


def test_wf_last_room_race_two_browsers(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"})
    won, lost = fresh_email("guest"), fresh_email("guest")
    with staff(browser, h, "desk") as winner, staff(browser, h, "desk2") as loser:
        win_box = open_new_stay(winner)
        fill_new_stay(win_box, "Ana Vale", won, BD, day(BD, 1), "101")
        lose_box = open_new_stay(loser)
        fill_new_stay(lose_box, "Mara Okafor", lost, BD, day(BD, 1), "101")
        with held(loser, "**/api/stays") as release:
            click(button(lose_box, "Create stay"))
            click(button(win_box, "Create stay"))
            expect(status(winner, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.")
            expect(status(loser, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.",
                                                               timeout=LIVE_WAIT_MS)
            release()
            expect(status(loser, "Desk notices")).to_have_text(just_taken("101"))
        expect(loser.locator("[data-stay-id]")).to_have_count(1)
        expect(status(loser, "Free rooms")).to_have_text(free_rooms(0))
    blocks = h.client("desk").get("/api/timeline", params={"from": BD, "to": day(BD, 1)}).json()["blocks"]
    assert [b["guestName"] for b in blocks] == ["Ana Vale"]
    assert len(mail_to(mail, won, 1)) == 1
    assert not [m for m in mail.messages() if lost in [a.lower() for a in addresses(m.get("To"))]]


def test_wf_last_room_race_move_conflict(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", day(BD, 1), MON)])
    stay_id = h.stay_id("s1")
    with staff(browser, h, "desk") as winner, staff(browser, h, "desk2") as loser:
        win_panel = open_stay(winner, "Ana Vale", "101", day(BD, 1), MON)
        lose_panel = open_stay(loser, "Ana Vale", "101", day(BD, 1), MON)
        select(combo(win_panel, "Move to room"), "102")
        select(combo(lose_panel, "Move to room"), "103")
        with held(loser, f"**/api/stays/{stay_id}/move") as release:
            click(button(lose_panel, "Move room"))
            click(button(win_panel, "Move room"))
            expect(status(winner, "Desk notices")).to_have_text("Moved Ana Vale to room 102.")
            expect(status(loser, "Desk notices")).to_have_text("Moved Ana Vale to room 102.", timeout=LIVE_WAIT_MS)
            release()
            expect(status(loser, "Desk notices")).to_have_text(
                "This stay was changed by someone else. It now shows the latest.")
        expect(block(loser, stay_id)).to_have_attribute("data-room-id", h.room("r102"))
    assert h.stay("s1")["segments"][0]["roomId"] == h.room("r102")


def test_free_rooms_live(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "out_of_order"})
    with staff(browser, h, "owner") as owner_page, staff(browser, h, "desk") as desk_page:
        def both(value: str) -> None:
            for page in (owner_page, desk_page):
                expect(status(page, "Free rooms")).to_have_text(value, timeout=LIVE_WAIT_MS)
            assert h.client("desk").get("/api/desk").json()["freeRoomsText"] == value

        both(free_rooms(3))
        created = post_stay(h.client("desk"), create_body(h, "r101", BD, day(BD, 1)))
        assert created.status_code == 201
        both(free_rooms(2))
        future = post_stay(h.client("desk"), create_body(h, "r102", day(BD, 1), day(BD, 2), name="Mara Okafor"))
        assert future.status_code == 201
        assert h.client("owner").post(f"/api/rooms/{h.room('r102')}/status", json={"status": "out_of_order"}).status_code == 200
        both(free_rooms(1))
        assert h.client("desk").post(f"/api/stays/{created.json()['id']}/cancel").status_code == 200
        both(free_rooms(2))


def test_check_in_guards(app_url: str) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "inspected", "103": "dirty", "104": "out_of_order",
                                   "105": "clean", "106": "clean", "107": "clean"},
                   stays=[st("clean", "r101", "Ana Vale", BD, MON), st("inspected", "r102", "Mara Okafor", BD, MON),
                          st("dirty", "r103", "Ines Duarte", BD, MON), st("ooo", "r104", "Priya Raman", BD, MON),
                          st("later", "r105", "Callum Reyes", SECOND_NIGHT, MON),
                          st("inhouse", "r106", "Hana Sato", BD, MON, "in_house"),
                          st("cancelled", "r107", "Sam Whitlock", BD, MON, "cancelled")])
    desk = h.client("desk")
    for good in ("clean", "inspected"):
        answer = desk.post(f"/api/stays/{h.stay_id(good)}/check-in")
        assert answer.status_code == 200, answer.text
        assert answer.json()["status"] == "in_house" and answer.json()["checkInNight"] == BD
    refusals = {
        "dirty": no_check_in("103", "dirty"),
        "ooo": no_check_in("104", "out of order"),
        "later": f"This stay arrives on {SECOND_NIGHT}, not on business date {BD}.",
        "inhouse": "This stay cannot be checked in.",
        "cancelled": "This stay cannot be checked in.",
    }
    for name, message in refusals.items():
        before = h.stay(name)
        err(desk.post(f"/api/stays/{h.stay_id(name)}/check-in"), 409, message)
        after = h.stay(name)
        assert (after["status"], after["version"]) == (before["status"], before["version"])


def test_wf_dirty_room_checkin_phone_to_desk(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    with staff(browser, h, "desk") as desk_page, staff(browser, h, "hk", "/board", viewport=PHONE) as phone:
        go_to(desk_page, h, "r101", BD)
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text(no_check_in("101", "dirty"))
        assert h.stay("s1")["status"] == "booked"
        board = phone.get_by_role("region", name="Room board", exact=True)
        stays_list = phone.get_by_role("list", name="Today's stays", exact=True)
        board_status = status(phone, "Board status")
        expect(board).to_be_visible()
        tops = [board_status.bounding_box()["y"], board.bounding_box()["y"], stays_list.bounding_box()["y"]]
        assert tops == sorted(tops), "phone board order is Board status, Room board, Today's stays (L128)"
        target = button(board, "Room 101 clean")
        size = target.bounding_box()
        assert size["width"] >= MIN_TARGET_PX and size["height"] >= MIN_TARGET_PX
        tap(target)
        expect(board_status).to_have_text("Room 101 is now clean.")
        expect(status(desk_page, "Desk notices")).to_have_text("Room 101 is now clean.", timeout=LIVE_WAIT_MS)
        expect(button(desk_page, "Room 101 status: clean")).to_be_visible(timeout=LIVE_WAIT_MS)
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text("Checked in Ana Vale to room 101.")
        expect(block(desk_page, h.stay_id("s1"))).to_have_attribute("data-status", "in_house")
    assert h.stay("s1")["status"] == "in_house"


def test_wf_dirty_room_checkin_shortcuts(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "clean"},
                   now="2027-03-06T02:30:00-06:00",
                   stays=[st("s1", "r101", "Ana Vale", BD, MON), st("s2", "r102", "Mara Okafor", PRIOR_NIGHT, BD, "in_house"),
                          st("s3", "r103", "Priya Raman", PRIOR_NIGHT, MON, "in_house")])
    with staff(browser, h) as page:
        notices = status(page, "Desk notices")
        go_to(page, h, "r104", BD)
        for letter in ("m", "i", "o"):
            key(page, letter)
            expect(notices).to_have_text("No stay here.")
        go_to(page, h, "r101", BD)
        key(page, "Control+i")
        assert h.stay("s1")["status"] == "booked", "keys are ignored with Ctrl held (L187)"
        button(page, "Next nights").focus()
        key(page, "i")
        expect(notices).to_have_text("Checked in Ana Vale to room 101.")
        assert h.stay("s1")["checkInNight"] == BD, "a 02:30 check-in on 2027-03-06 belongs to the night of 2027-03-05"
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        expect(panel).to_contain_text(f"Checked in for the night of {BD}")
        click(button(panel, "Close"))
        advance(page, PANEL_SETTLE_MS)
        go_to(page, h, "r103", BD)
        key(page, "o")
        expect(notices).to_have_text(f"This stay departs on {MON}. Change its dates before checking out early.")
        assert h.stay("s3")["status"] == "in_house"
        go_to(page, h, "r102", PRIOR_NIGHT)
        button(page, "Previous nights").focus()
        key(page, "o")
        expect(notices).to_have_text("Checked out Mara Okafor from room 102.")
        expect(button(page, "Room 102 status: dirty")).to_be_visible()
    assert h.stay("s2")["status"] == "checked_out"
    assert h.board_status("r102") == "dirty"


def test_wf_housekeeping_phone_tap(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"}, stays=[st("s1", "r102", "Ana Vale", BD, MON, "in_house")])
    email, password = h.users["hk"]
    with open_app(browser, f"{app_url}/") as page:
        page.set_viewport_size(PHONE)
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Password"), password)
        click(button(page, "Sign in"))
        expect(page).to_have_url(re.compile(r"/board$"))
        board = page.get_by_role("region", name="Room board", exact=True)
        expect(board).to_be_visible()
        layout(page)
        items = page.get_by_role("list", name="Today's stays", exact=True).get_by_role("listitem")
        expect(items).to_have_text([f"Room 102: {BD} to {MON}"])
        one = board.get_by_role("group", name="Room 101", exact=True)
        two = board.get_by_role("group", name="Room 102", exact=True)
        expect(one).to_have_attribute("data-status", "dirty")
        assert abs(one.bounding_box()["x"] - two.bounding_box()["x"]) <= GEOM_TOL, "one column at 375x812 (L128)"
        assert one.bounding_box()["y"] < two.bounding_box()["y"], "rooms in room-number order"
        for name in ("Room 101 clean", "Room 101 dirty", "Room 102 clean", "Room 102 dirty"):
            box = button(board, name).bounding_box()
            assert box["width"] >= MIN_TARGET_PX and box["height"] >= MIN_TARGET_PX, f"{name} under the 44 px target"
        expect(button(board, "Room 101 dirty")).to_have_attribute("aria-pressed", "true")
        with held(page, f"**/api/rooms/{h.room('r101')}/status") as release:
            tap(button(board, "Room 101 clean"))
            expect(status(page, "Board status")).to_have_text("Saving status…")
            assert h.board_status("r101") == "dirty"
            release()
            expect(status(page, "Board status")).to_have_text("Room 101 is now clean.")
        expect(one).to_have_attribute("data-status", "clean")
        expect(button(board, "Room 101 clean")).to_have_attribute("aria-pressed", "true")
    assert h.board_status("r101") == "clean"


def test_wf_housekeeping_phone_refused_tap(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "out_of_order"})
    with staff(browser, h, "hk", "/board", viewport=PHONE) as page:
        board = page.get_by_role("region", name="Room board", exact=True)
        tap(button(board, "Room 101 clean"))
        expect(status(page, "Board status")).to_have_text("That room status change is not allowed.")
        expect(board.get_by_role("group", name="Room 101", exact=True)).to_have_attribute("data-status", "clean")
        tap(button(board, "Room 102 dirty"))
        expect(status(page, "Board status")).to_have_text("That room status change is not allowed.")
    assert h.board_status("r101") == "clean" and h.board_status("r102") == "out_of_order"


def test_room_status_moves(app_url: str) -> None:
    allowed = {
        ("dirty", "clean"): {"hk", "desk", "owner"},
        ("clean", "inspected"): {"desk", "owner"},
        ("clean", "dirty"): {"hk", "desk", "owner"},
        ("inspected", "dirty"): {"hk", "desk", "owner"},
        ("dirty", "out_of_order"): {"owner"},
        ("clean", "out_of_order"): {"owner"},
        ("inspected", "out_of_order"): {"owner"},
        ("out_of_order", "dirty"): {"owner"},
    }
    statuses = ["dirty", "clean", "inspected", "out_of_order"]
    cases = [(role, a, b) for role in ("hk", "desk", "owner") for a in statuses for b in statuses]
    rooms = {str(100 + i): case[1] for i, case in enumerate(cases)}
    h = make_hotel(app_url, rooms=rooms)
    for index, (role, start, target) in enumerate(cases):
        number = str(100 + index)
        answer = h.client(role).post(f"/api/rooms/{h.room('r' + number)}/status", json={"status": target})
        if role in allowed.get((start, target), set()):
            assert answer.status_code == 200, f"{role} {start} to {target}: {answer.text}"
            assert set(answer.json()) == {"roomId", "number", "status", "arrival", "departure"}
            assert answer.json()["status"] == target
        else:
            err(answer, 409, "That room status change is not allowed.")
    board = {r["number"]: r["status"] for r in h.client("owner").get("/api/housekeeping/board").json()["rooms"]}
    for index, (role, start, target) in enumerate(cases):
        expected = target if role in allowed.get((start, target), set()) else start
        assert board[str(100 + index)] == expected, f"{role} {start} to {target}"
    any_room = h.room("r100")
    assert "status" in h.client("owner").post(f"/api/rooms/{any_room}/status", json={"status": "swept"}).json()["errors"]


def test_housekeeper_sees_room_dates_status_only(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "dirty", "103": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")],
                   folios=None)
    stay = h.stay("s1")
    email = h.emails["s1"]
    forbidden = ["Ana Vale", email, "+1 555 0100"]
    hk = h.client("hk")
    board = hk.get("/api/housekeeping/board")
    assert board.status_code == 200
    assert set(board.json()) == {"businessDate", "rooms"}
    for room in board.json()["rooms"]:
        assert set(room) == {"roomId", "number", "status", "arrival", "departure"}
    assert not any(value in board.text for value in forbidden)
    folio = stay["folios"][0]["id"]
    for method, path in [("GET", f"/api/stays/{stay['id']}"), ("PATCH", f"/api/stays/{stay['id']}"),
                         ("POST", f"/api/stays/{stay['id']}/check-out"), ("POST", "/api/stays/quote"),
                         ("GET", f"/api/stays/{stay['id']}/id-photo"), ("PATCH", f"/api/folios/{folio}"),
                         ("POST", f"/api/folios/{folio}/charges"), ("POST", f"/api/folios/{folio}/close"),
                         ("GET", "/api/guests"), ("GET", f"/api/guests/{stay['guest']['id']}"),
                         ("GET", "/api/desk"), ("GET", f"/api/timeline?from={BD}&to={MON}"),
                         ("GET", f"/api/reports?from={BD}&to={MON}"), ("GET", "/api/rate-plans")]:
        answer = hk.request(method, path, json={} if method != "GET" else None)
        err(answer, 404, "Not found.")
    listener = LiveListener(h.new_client("hk"))
    assert listener.status == 200 and "text/event-stream" in listener.content_type
    assert h.client("owner").post(f"/api/rooms/{h.room('r102')}/status", json={"status": "clean"}).status_code == 200
    event = listener.wait_for(lambda e: e.get("roomId") == h.room("r102"), "a housekeeper's room change")
    assert set(event) == {"type", "roomId", "number", "status", "arrival", "departure", "notice"}
    assert event["type"] == "room" and event["status"] == "clean"
    created = post_stay(h.client("desk"), create_body(h, "r103", BD, MON, name="Mara Okafor", email=fresh_email("guest")))
    assert created.status_code == 201
    assert h.client("owner").post(f"/api/rooms/{h.room('r102')}/status", json={"status": "dirty"}).status_code == 200
    listener.wait_for(lambda e: e.get("status") == "dirty", "the later room change")
    assert not any(v in line for line in listener.raw for v in [*forbidden, "Mara Okafor"]), "guest data on the stream"
    with staff(browser, h, "hk", "/board") as page:
        bodies: list[Any] = []
        page.on("response", lambda r: bodies.append(r) if "/api/live" not in r.url else None)
        visit(page, app_url, "/board")
        expect(page.get_by_role("region", name="Room board", exact=True)).to_be_visible()
        expect(page.get_by_role("list", name="Today's stays", exact=True).get_by_role("listitem").first).to_be_visible()
        shown = page_text(page)
        assert not any(value in shown for value in forbidden)
        for response in bodies:
            content = ""
            with contextlib.suppress(Exception):
                content = response.text()
            assert not any(value in content for value in forbidden), f"guest data in {response.url}"
        for path in ("/desk", "/guests", "/rates", "/reports"):
            page.goto(f"{app_url}{path}")
            expect(page.get_by_text("Page not found.", exact=True)).to_be_visible()


def test_checkin_link_email_and_resend(app_url: str, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"})
    email = fresh_email("guest")
    created = post_stay(h.client("desk"), create_body(h, "r101", BD, MON, email=email))
    assert created.status_code == 201
    assert created.json()["checkinLinkState"] == "sent"
    message = mail_to(mail, email, 1)[0]
    assert message["Subject"] == f"Check in for your stay at {h.name}"
    assert mail_from_address() in addresses(message.get("From"))
    old = token_from(message)
    assert httpx.get(f"{app_url}/api/checkin/{old}", timeout=HTTP_TIMEOUT).status_code == 200
    resend = h.client("desk").post(f"/api/stays/{created.json()['id']}/checkin-link")
    assert resend.status_code == 200, resend.text
    tokens = {token_from(m) for m in mail_to(mail, email, 2)}
    assert old in tokens and len(tokens) == 2
    new = (tokens - {old}).pop()
    link_dead(app_url, old)
    assert httpx.get(f"{app_url}/api/checkin/{new}", timeout=HTTP_TIMEOUT).status_code == 200
    assert h.client("desk").post(f"/api/stays/{created.json()['id']}/cancel").status_code == 200
    err(h.client("desk").post(f"/api/stays/{created.json()['id']}/checkin-link"), 409,
        "This stay is no longer waiting for check-in.")
    assert len(mail_to(mail, email, 2)) == 2


def test_checkin_link_scope_and_end(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "clean"},
                   stays=[st("ttl", "r101", "Ana Vale", day(BD, 5), day(BD, 7), link=True),
                          st("done", "r102", "Mara Okafor", day(BD, 5), day(BD, 7), link=True),
                          st("gone", "r103", "Ines Duarte", day(BD, 5), day(BD, 7), link=True),
                          st("arrived", "r104", "Priya Raman", BD, day(BD, 2), link=True)])
    tokens = {name: only_token(mail, h.emails[name]) for name in ("ttl", "done", "gone", "arrived")}
    shown = httpx.get(f"{app_url}/api/checkin/{tokens['ttl']}", timeout=HTTP_TIMEOUT)
    assert shown.status_code == 200
    assert shown.json() == {"hotelName": h.name, "arrival": day(BD, 5), "departure": day(BD, 7),
                            "roomType": "Queen", "photo": "none"}
    with open_app(browser, f"{app_url}/checkin/{tokens['ttl']}") as page:
        expect(page.get_by_role("heading", name="Check in", exact=True)).to_be_visible()
        expect(textbox(page, "Full name")).to_be_visible()
        visible = page_text(page)
        assert h.name in visible and day(BD, 5) in visible and "Queen" in visible
        assert "Ana Vale" not in visible and h.emails["ttl"] not in visible and "+1 555 0100" not in visible
    sent = datetime.fromisoformat(NOON)
    h.clock((sent + timedelta(seconds=TTL_SECONDS - 1)).isoformat())
    assert httpx.get(f"{app_url}/api/checkin/{tokens['ttl']}", timeout=HTTP_TIMEOUT).status_code == 200
    h.clock((sent + timedelta(seconds=TTL_SECONDS)).isoformat())
    link_dead(app_url, tokens["ttl"])
    h.clock(NOON)
    assert upload(app_url, tokens["done"], jpeg_bytes()).status_code == 200
    completed = httpx.post(f"{app_url}/api/checkin/{tokens['done']}/complete",
                           json={"fullName": "Mara Okafor", "phone": "+1 555 0100"}, timeout=HTTP_TIMEOUT)
    assert completed.status_code == 200 and completed.json() == {"completed": True}
    link_dead(app_url, tokens["done"])
    assert h.client("desk").post(f"/api/stays/{h.stay_id('gone')}/cancel").status_code == 200
    link_dead(app_url, tokens["gone"])
    assert h.client("desk").post(f"/api/stays/{h.stay_id('arrived')}/check-in").status_code == 200
    link_dead(app_url, tokens["arrived"])
    err(upload(app_url, tokens["gone"], jpeg_bytes()), 404, "This check-in link is no longer valid.")
    err(httpx.post(f"{app_url}/api/checkin/{tokens['gone']}/complete", json={"fullName": "Ines Duarte", "phone": ""},
                   timeout=HTTP_TIMEOUT), 404, "This check-in link is no longer valid.")
    link_dead(app_url, uuid.uuid4().hex)
    with open_app(browser, f"{app_url}/checkin/{tokens['done']}") as page:
        expect(page.get_by_text("This check-in link is no longer valid.", exact=True)).to_be_visible()
        expect(textbox(page, "Full name")).to_have_count(0)


def test_id_photo_limits(app_url: str, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", day(BD, 2), MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    photo_state = lambda: h.stay("s1")["idPhoto"]
    too_big = "That photo is too large."
    wrong = "Please upload a JPEG or PNG photo."
    err(upload(app_url, token, b"plain text, not an image", "id.jpg", "image/jpeg"), 415, wrong)
    err(upload(app_url, token, b"<svg xmlns='http://www.w3.org/2000/svg'><script/></svg>", "id.png", "image/png"), 415, wrong)
    err(upload(app_url, token, b"%PDF-1.4 not an image", "id.jpeg", "image/jpeg"), 415, wrong)
    err(upload(app_url, token, b"x" * (PHOTO_LIMIT + 1), "id.txt", "text/plain"), 413, too_big)
    err(upload(app_url, token, png_bytes(total=PHOTO_LIMIT + 1), "id.png", "image/png"), 413, too_big)
    assert photo_state() == "none", "a refused upload stores nothing"
    assert S3().keys(f"id-photos/{h.id}/") == []
    exact = upload(app_url, token, png_bytes(total=PHOTO_LIMIT), "id.png", "image/png")
    assert exact.status_code == 200 and exact.json() == {"photo": "received"}, exact.text[:200]
    named_wrong = upload(app_url, token, jpeg_bytes(), "notes.txt", "text/plain")
    assert named_wrong.status_code == 200, "content decides, not the file name or declared type"
    assert photo_state() == "received"


def test_stored_photo_without_exif(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", day(BD, 2), MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    stored_key = f"id-photos/{h.id}/{h.stay_id('s1')}"
    marker = f"gps-{uuid.uuid4().hex}".encode()
    err(h.client("desk").get(f"/api/stays/{h.stay_id('s1')}/id-photo"), 404, "Not found.")
    with open_app(browser, f"{app_url}/checkin/{token}") as page:
        page.get_by_label("ID photo").set_input_files(
            {"name": "id.jpg", "mimeType": "image/jpeg", "buffer": jpeg_bytes(marker)})
        with held(page, f"**/api/checkin/{token}/photo") as release:
            click(button(page, "Upload photo"))
            expect(status(page, "Check-in status")).to_have_text("Uploading photo…")
            assert S3().keys(stored_key) == []
            release()
            expect(status(page, "Check-in status")).to_have_text("Received")
    assert stored_key in S3().keys(f"id-photos/{h.id}/")
    stored = S3().get(stored_key)
    assert marker not in stored and b"Exif\0\0" not in stored
    assert decoded_size(browser, stored) == {"width": 16, "height": 8}
    served = h.client("desk").get(f"/api/stays/{h.stay_id('s1')}/id-photo")
    assert served.status_code == 200 and marker not in served.content
    assert decoded_size(browser, served.content) == {"width": 16, "height": 8}

    png_marker = f"gps-{uuid.uuid4().hex}".encode()
    replaced = upload(app_url, token, png_bytes(width=5, height=7, exif=tiff_with(png_marker)), "id.png", "image/png")
    assert replaced.status_code == 200, replaced.text
    stored = S3().get(stored_key)
    assert png_marker not in stored and b"eXIf" not in stored
    assert decoded_size(browser, stored) == {"width": 5, "height": 7}, "a new upload replaces the earlier photo"
    assert S3().keys(f"id-photos/{h.id}/") == [stored_key]


def test_wf_guest_online_checkin_phone(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    with staff(browser, h) as desk_page, open_app(browser, f"{app_url}/checkin/{token}") as guest:
        guest.set_viewport_size(PHONE)
        expect(block(desk_page, h.stay_id("s1"))).to_have_attribute("data-status", "booked")
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.jpg", "mimeType": "image/jpeg", "buffer": jpeg_bytes()})
        click(button(guest, "Upload photo"))
        expect(status(guest, "Check-in status")).to_have_text("Received")
        fill(textbox(guest, "Full name"), "Ana Vale")
        fill(textbox(guest, "Phone"), "+1 555 0100")
        click(button(guest, "Complete check-in"))
        expect(status(guest, "Check-in status")).to_have_text(f"Check-in complete. See you on {BD}.")
        expect(status(desk_page, "Desk notices")).to_have_text("Room 101 guest completed online check-in.",
                                                               timeout=LIVE_WAIT_MS)
        expect(block(desk_page, h.stay_id("s1"))).to_have_attribute("data-checked-in-online", "true",
                                                                    timeout=LIVE_WAIT_MS)
        panel = open_stay(desk_page, "Ana Vale", "101", BD, MON)
        expect(panel).to_contain_text("Checked in online")
    stay = h.stay("s1")
    assert stay["checkedInOnline"] is True and stay["status"] == "booked"
    assert stay["onlineCheckIn"] == {"fullName": "Ana Vale", "phone": "+1 555 0100"}
    assert stay["checkinLinkState"] == "ended" and stay["idPhoto"] == "received"
    link_dead(app_url, token)


def test_wf_guest_online_checkin_refused_recovery(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    err(httpx.post(f"{app_url}/api/checkin/{token}/complete", json={"fullName": "Ana Vale", "phone": ""},
                   timeout=HTTP_TIMEOUT), 409, "Please upload your ID photo first.")
    with open_app(browser, f"{app_url}/checkin/{token}") as guest:
        guest.set_viewport_size(PHONE)
        fill(textbox(guest, "Full name"), "Ana Vale")
        fill(textbox(guest, "Phone"), "+1 555 0100")
        click(button(guest, "Complete check-in"))
        expect(status(guest, "Check-in status")).to_have_text("Please upload your ID photo first.")
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.jpg", "mimeType": "image/jpeg", "buffer": b"plain text, not an image"})
        click(button(guest, "Upload photo"))
        expect(status(guest, "Check-in status")).to_have_text("Please upload a JPEG or PNG photo.")
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.png", "mimeType": "image/png", "buffer": png_bytes()})
        click(button(guest, "Upload photo"))
        expect(status(guest, "Check-in status")).to_have_text("Received")
        fill(textbox(guest, "Full name"), "")
        click(button(guest, "Complete check-in"))
        expect(guest.get_by_text("Enter your full name.").first).to_be_visible()
        assert h.stay("s1")["checkedInOnline"] is False
        fill(textbox(guest, "Full name"), "Ana Vale")
        click(button(guest, "Complete check-in"))
        expect(status(guest, "Check-in status")).to_have_text(f"Check-in complete. See you on {BD}.")
    assert h.stay("s1")["checkedInOnline"] is True


def test_close_opening_edges(app_url: str) -> None:
    closed_text = "The business day has not ended. The close opens at 04:00."
    for business_date, refused, opens, next_day in [
        ("2027-03-13", "2027-03-14T03:59:59-05:00", "2027-03-14T04:00:00-05:00", "2027-03-14"),
        ("2027-11-06", "2027-11-07T03:59:59-06:00", "2027-11-07T04:00:00-06:00", "2027-11-07"),
    ]:
        h = make_hotel(app_url, rooms={"101": "clean"}, business_date=business_date, now=refused,
                       stays=[st("s1", "r101", "Ana Vale", business_date, day(business_date, 2), "in_house")])
        err(h.close(business_date), 409, closed_text)
        err(h.close(day(business_date, 1)), 409, closed_text)
        assert h.stay("s1")["folios"][0]["entries"] == [] and h.business_date() == business_date
        if business_date == "2027-11-06":
            for repeated in ("2027-11-07T01:30:00-05:00", "2027-11-07T01:30:00-06:00"):
                h.clock(repeated)
                err(h.close(business_date), 409, closed_text)
        h.clock(opens)
        answer = h.close(business_date)
        assert answer.status_code == 200, answer.text
        assert answer.json()["newBusinessDate"] == next_day and h.business_date() == next_day
        entries = h.stay("s1")["folios"][0]["entries"]
        assert [(e["description"], e["amountCents"]) for e in entries] == [
            ("Room charge, room 101", 15000), ("Tax, room 101", 1313), ("City tax, room 101", 200)]
    malformed = h.close("not-a-date")
    assert malformed.status_code == 422 and "errors" in malformed.json(), malformed.text


def test_wf_end_of_day_close_browser_zone(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, business_date="2027-03-13", now="2027-03-14T03:59:59-05:00",
                   stays=[st("s1", "r101", "Ana Vale", "2027-03-13", "2027-03-15", "in_house")])
    with staff(browser, h, "owner") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Asia/Tokyo"})
        page.clock.set_fixed_time("2027-03-14T12:00:00-05:00")
        visit(page, app_url, "/desk")
        expect(status(page, "Business date")).to_have_text("2027-03-13")
        click(button(page, "Run close"))
        expect(status(page, "Close status")).to_have_text("The business day has not ended. The close opens at 04:00.")
        assert h.stay("s1")["folios"][0]["entries"] == []
        expect(status(page, "Business date")).to_have_text("2027-03-13")
        page.clock.set_fixed_time("2027-03-13T20:00:00-06:00")
        h.clock("2027-03-14T04:00:00-05:00")
        visit(page, app_url, "/desk")
        click(button(page, "Run close"))
        expect(status(page, "Close status")).to_have_text(closed_notice("2027-03-13", 1, 0))
    assert h.business_date() == "2027-03-14"
    assert len(h.stay("s1")["folios"][0]["entries"]) == 3


def test_close_posts_in_order(app_url: str) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "clean"},
                   stays=[st("two", "r102", "Mara Okafor", BD, MON, "in_house", guests=2),
                          st("one", "r101", "Ana Vale", BD, MON, "in_house"),
                          st("noshow", "r103", "Ines Duarte", BD, SECOND_NIGHT, plan="corp"),
                          st("later", "r104", "Priya Raman", MON, TAX_START),
                          st("out", "r104", "Sam Whitlock", "2027-03-03", BD, "checked_out")])
    h.clock(BD_OPEN)
    answer = h.close(BD)
    assert answer.status_code == 200, answer.text
    result = answer.json()
    assert (result["businessDate"], result["newBusinessDate"]) == (BD, SECOND_NIGHT)
    assert result["roomsCharged"] == 2 and result["noShows"] == 1
    assert h.business_date() == SECOND_NIGHT
    stays = {k: h.stay(k) for k in ("one", "two", "noshow", "later", "out")}
    room = half_up_div(15000 * 95, 100)
    tax = half_up_div(room * 875, 10000)
    assert stays["one"]["nightly"][0]["roomCents"] == room and stays["one"]["nightly"][0]["taxCents"] == tax
    one_total, two_total = room + tax + 200, room + tax + 400
    assert [(r["roomNumber"], r["stayId"], r["postedCents"]) for r in result["rows"]] == [
        ("101", stays["one"]["id"], one_total), ("102", stays["two"]["id"], two_total)]
    for name, city, number in (("one", 200, "101"), ("two", 400, "102")):
        entries = stays[name]["folios"][0]["entries"]
        assert [(e["date"], e["description"], e["amountCents"], e["roomNumber"]) for e in entries] == [
            (BD, f"Room charge, room {number}", room, number), (BD, f"Tax, room {number}", tax, number),
            (BD, f"City tax, room {number}", city, number)]
        assert stays[name]["nightly"][0]["posted"] is True and stays[name]["nightly"][1]["posted"] is False
    assert [e["description"] for e in stays["noshow"]["folios"][0]["entries"]] == ["No-show fee"]
    assert stays["later"]["folios"][0]["entries"] == [] and stays["out"]["folios"][0]["entries"] == []
    figures = result["figures"]
    assert (figures["roomsAvailable"], figures["roomsSold"], figures["roomRevenueCents"]) == (4, 2, room * 2)
    assert figures["occupancy"] == occupancy(2, 4)
    assert figures["averageDailyRate"] == money(room)
    assert figures["revenuePerAvailableRoom"] == money(half_up_div(room * 2, 4))
    assert h.client("owner").get("/api/desk").json()["lastClose"]["businessDate"] == BD


def test_wf_end_of_day_close_blocked(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "clean"},
                   now=BD_OPEN,
                   stays=[st("b2", "r103", "Mara Okafor", "2027-03-03", BD, "in_house"),
                          st("b1", "r102", "Ana Vale", "2027-03-03", BD, "in_house"),
                          st("ok", "r104", "Ines Duarte", BD, MON),
                          st("stay", "r101", "Priya Raman", "2027-03-03", MON, "in_house")])
    reason = not_checked_out("102")
    blocked = h.close(BD)
    assert blocked.status_code == 409 and blocked.json()["error"] == reason
    assert blocked.json()["blockers"] == [
        {"roomId": h.room("r102"), "roomNumber": "102", "text": reason},
        {"roomId": h.room("r103"), "roomNumber": "103", "text": not_checked_out("103")}]
    with staff(browser, h, "owner") as page:
        click(button(page, "Run close"))
        expect(status(page, "Close status")).to_have_text(reason)
        expect(grid(page).get_by_role("rowheader", name="Room 102", exact=False)).to_be_focused()
        expect(room_row(page, h.room("r102"))).to_have_attribute("data-blocked", "true")
        expect(status(page, "Business date")).to_have_text(BD)
    assert h.business_date() == BD
    assert h.stay("stay")["folios"][0]["entries"] == [] and h.stay("ok")["status"] == "booked"
    for name in ("b1", "b2"):
        assert h.client("desk").post(f"/api/stays/{h.stay_id(name)}/check-out").status_code == 200
    assert h.close(BD).status_code == 200


def test_wf_end_of_day_close_double_press(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    with staff(browser, h, "owner") as page:
        sent = requests_to(page, "POST", r"/api/close$")
        run = button(page, "Run close")
        with held(page, "**/api/close") as release:
            click(run)
            expect(run).to_have_attribute("aria-busy", "true")
            expect(status(page, "Close status")).to_have_text("Running close…")
            click(run)
            release()
            expect(status(page, "Close status")).to_have_text(closed_notice(BD, 1, 0))
        assert len(sent) == 1, f"a double press sent {len(sent)} requests (L201)"
        assert json.loads(sent[0].post_data) == {"businessDate": BD}
    entries = h.stay("s1")["folios"][0]["entries"]
    assert len(entries) == 3
    err(h.close(BD), 409, "This business date is already closed.")
    assert h.stay("s1")["folios"][0]["entries"] == entries
    assert h.business_date() == SECOND_NIGHT


def test_no_show_at_close(app_url: str, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, business_date=MON, now=MON_NOON,
                   stays=[st("s1", "r101", "Ana Vale", MON, "2027-03-10", link=True)])
    token = only_token(mail, h.emails["s1"])
    fee = h.stay("s1")["nightly"][0]["totalCents"]
    assert fee == 13250
    h.clock(MON_OPEN)
    result = h.close(MON)
    assert result.status_code == 200, result.text
    body = result.json()
    assert body["noShows"] == 1 and body["roomsCharged"] == 0 and body["rows"] == []
    stay = h.stay("s1")
    assert stay["status"] == "no_show" and stay["cancellation"] is None
    charges = stay["folios"][0]["entries"]
    assert [(e["kind"], e["description"], e["amountCents"], e["date"]) for e in charges] == [
        ("charge", "No-show fee", fee, MON)]
    link_dead(app_url, token)
    assert h.client("desk").get("/api/desk").json()["freeRoomsText"] == free_rooms(1)
    retaken = post_stay(h.client("desk"), create_body(h, "r101", TAX_START, "2027-03-10", name="Mara Okafor"))
    assert retaken.status_code == 201, "a no-show holds no nights"
    err(h.client("desk").post(f"/api/stays/{stay['id']}/check-in"), 409, "This stay cannot be checked in.")


SWEEP_JS = """() => {
  const named = (name) => [...document.querySelectorAll('[aria-label],[aria-labelledby]')].find(e => {
    const label = e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(' ')
      .map(i => (document.getElementById(i) || {}).textContent || '').join(' ').trim();
    return label === name;
  });
  const log = {phases: [], grounds: [], stamps: [], busy: 0, revenue: []};
  const seen = new Set();
  const snap = () => {
    const m = document.querySelector('[data-close-phase]');
    if (m) {
      const p = m.getAttribute('data-close-phase');
      if (log.phases[log.phases.length - 1] !== p) log.phases.push(p);
      const g = m.getAttribute('data-ground');
      if (log.grounds[log.grounds.length - 1] !== g) log.grounds.push(g);
    }
    document.querySelectorAll('[data-stamp]').forEach(c => {
      const id = c.getAttribute('data-date') + '/' + c.getAttribute('data-room-id');
      if (!seen.has(id)) { seen.add(id); log.stamps.push({date: c.getAttribute('data-date'),
        room: c.getAttribute('data-room-id'), stamp: c.getAttribute('data-stamp')}); }
    });
    const rail = named('Tally rail');
    if (rail && rail.getAttribute('aria-busy') === 'true') log.busy += 1;
    const revenue = named('Tally room revenue');
    if (revenue) {
      const t = revenue.textContent.trim();
      if (log.revenue[log.revenue.length - 1] !== t) log.revenue.push(t);
    }
  };
  snap();
  window.__sweep = log;
  new MutationObserver(snap).observe(document.documentElement,
    {subtree: true, attributes: true, childList: true, characterData: true});
}"""


def cents_of(value: str) -> int:
    return int(re.sub(r"[^0-9]", "", value) or 0)


def test_night_close_sweep(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house"),
                          st("s2", "r102", "Mara Okafor", BD, MON, "in_house", guests=2)])
    totals = {k: h.stay(k)["nightly"][0]["totalCents"] for k in ("s1", "s2")}
    with staff(browser, h, "owner") as page:
        expect(status(page, "Tally date")).to_have_text("No night closed yet")
        expect(status(page, "Tally room revenue")).to_have_text("—")
        rail = page.get_by_role("region", name="Tally rail", exact=True)
        page.evaluate(SWEEP_JS, [rail.element_handle(), status(page, "Tally room revenue").element_handle()])
        with held(page, "**/api/close") as release:
            click(button(page, "Run close"))
            expect(status(page, "Close status")).to_have_text("Running close…")
            advance(page, LIVE_MAX_DELAY_MS)
            expect(main_area(page)).to_have_attribute("data-close-phase", "idle")
            expect(main_area(page)).to_have_attribute("data-ground", "day")
            pending = page.evaluate("() => window.__sweep")
            assert pending["phases"] == ["idle"] and pending["stamps"] == [], "no sweep before the server commits (L223)"
            release()
            expect(status(page, "Close status")).to_have_text(closed_notice(BD, 2, 0))
        started = time.monotonic() + EXPECT_MS / 1000
        while page.evaluate("() => window.__sweep.phases.length") < 2:
            advance(page, KEY_SETTLE_MS)
            if time.monotonic() > started:
                pytest.fail("data-close-phase never left idle after the server's success answer (L223)")
        with staff(browser, h, "owner") as reloaded:
            expect(main_area(reloaded)).to_have_attribute("data-close-phase", "idle")
            expect(status(reloaded, "Business date")).to_have_text(SECOND_NIGHT)
            expect(cell(reloaded, h.room("r101"), BD)).to_have_attribute("data-stamp", money(totals["s1"]))
            expect(status(reloaded, "Tally date")).to_have_text(f"Last closed night {BD}")
        spent = 0
        while spent < SWEEP_MAX_MS and page.evaluate("() => window.__sweep.phases.slice(-1)[0]") != "idle":
            advance(page, SWEEP_STEP_MS)
            spent += SWEEP_STEP_MS
        log = page.evaluate("() => window.__sweep")
        assert log["phases"] == ["idle", "night", "stamping", "slide", "idle"], log["phases"]
        assert "night" in log["grounds"] and log["grounds"][-1] == "day"
        expect(main_area(page)).to_have_attribute("data-ground", "day")
        rows = [s for s in log["stamps"] if s["date"] == BD]
        assert [s["room"] for s in rows] == [h.room("r101"), h.room("r102"), h.room("r103")], "stamps go in room order"
        assert log["busy"] > 0, "the rail is aria-busy while counting (L226)"
        committed = h.client("owner").get("/api/desk").json()["lastClose"]["figures"]
        revenue = [cents_of(v) for v in log["revenue"] if v.startswith("$")]
        assert revenue[-1] == committed["roomRevenueCents"]
        counted = revenue[revenue.index(min(revenue)):]
        assert counted == sorted(counted) and len(set(counted)) > 1, f"the rail must count upward: {log['revenue']}"
        expect(status(page, "Business date")).to_have_text(SECOND_NIGHT)
        marked = grid(page).locator('[data-business-date="true"]')
        expect(marked).to_have_attribute("data-date", SECOND_NIGHT)
        expect(grid(page).get_by_role("columnheader").and_(page.locator("[data-date]")).first).to_have_attribute(
            "data-date", BD)
        expect(cell(page, h.room("r102"), BD)).to_have_attribute("data-stamp", money(totals["s2"]))
        expect(cell(page, h.room("r103"), BD)).to_have_attribute("data-stamp", "tick")
        for name, field in [("Tally room revenue", money(committed["roomRevenueCents"])),
                            ("Tally occupancy", committed["occupancy"]),
                            ("Tally average daily rate", committed["averageDailyRate"]),
                            ("Tally revenue per available room", committed["revenuePerAvailableRoom"]),
                            ("Tally rooms sold", str(committed["roomsSold"]))]:
            expect(status(page, name)).to_have_text(field)
        page.reload()
        expect(cell(page, h.room("r101"), BD)).to_have_attribute("data-stamp", money(totals["s1"]))
        expect(main_area(page)).to_have_attribute("data-close-phase", "idle")
    stamps = h.client("owner").get("/api/timeline", params={"from": BD, "to": BD}).json()["stamps"]
    assert {s["roomId"]: s["stamp"] for s in stamps} == {
        h.room("r101"): money(totals["s1"]), h.room("r102"): money(totals["s2"]), h.room("r103"): "tick"}


def test_wf_end_of_day_close_second_screen(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    total = h.stay("s1")["nightly"][0]["totalCents"]
    with staff(browser, h, "owner") as owner_page, staff(browser, h, "desk") as desk_page:
        expect(status(desk_page, "Business date")).to_have_text(BD)
        click(button(owner_page, "Run close"))
        result_text = closed_notice(BD, 1, 0)
        expect(status(owner_page, "Close status")).to_have_text(result_text)
        expect(status(desk_page, "Close status")).to_have_text(result_text, timeout=LIVE_WAIT_MS)
        expect(status(desk_page, "Business date")).to_have_text(SECOND_NIGHT, timeout=LIVE_WAIT_MS)
        expect(cell(desk_page, h.room("r101"), BD)).to_have_attribute("data-stamp", money(total), timeout=LIVE_WAIT_MS)
        expect(status(desk_page, "Tally date")).to_have_text(f"Last closed night {BD}", timeout=LIVE_WAIT_MS)
        expect(main_area(desk_page)).to_have_attribute("data-close-phase", "idle")
        expect(main_area(desk_page)).to_have_attribute("data-ground", "day")
    assert sum(e["amountCents"] for e in h.stay("s1")["folios"][0]["entries"]) == total
    dated = make_hotel(app_url, rooms={"101": "clean"}, business_date=MON, now=MON_OPEN,
                       stays=[st("s1", "r101", "Ana Vale", MON, "2027-03-10", "in_house")])
    assert dated.client("owner").post("/api/tax-rates", json={"percent": "9.25", "startDate": TAX_START}).status_code == 201
    assert dated.close(MON).status_code == 200
    dated.clock("2027-03-10T04:00:00-06:00")
    with staff(browser, dated, "owner") as owner_page, staff(browser, dated, "desk") as desk_page:
        click(button(owner_page, "Run close"))
        expect(status(desk_page, "Close status")).to_have_text(closed_notice(TAX_START, 1, 0), timeout=LIVE_WAIT_MS)
        expect(cell(desk_page, dated.room("r101"), TAX_START)).to_have_attribute(
            "data-stamp", money(12000 + 1110 + 200), timeout=LIVE_WAIT_MS)


CANCEL_CASES = ["one_second_before", "at_deadline", "after_deadline"]


@pytest.mark.parametrize(
    "clock_at,late",
    [("2027-03-10T17:59:59-06:00", False), ("2027-03-10T18:00:00-06:00", True), ("2027-03-10T18:00:01-06:00", True)],
    ids=CANCEL_CASES,
)
def test_cancellation_fee_edges(app_url: str, clock_at: str, late: bool) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, now=clock_at, business_date="2027-03-10",
                   stays=[st("s1", "r101", "Ana Vale", "2027-03-11", "2027-03-14", guests=3)])
    terms = h.stay("s1")["cancellation"]
    expected = {"state": "late", "feeCents": 15580, "text": f"Late cancellation fee: {money(15580)}"} if late else {
        "state": "free", "feeCents": 0, "text": "Free cancellation until 2027-03-10 18:00"}
    assert terms == expected
    answer = h.client("desk").post(f"/api/stays/{h.stay_id('s1')}/cancel")
    assert answer.status_code == 200, answer.text
    assert answer.json()["status"] == "cancelled" and answer.json()["cancellation"] is None
    entries = answer.json()["folios"][0]["entries"]
    if late:
        assert [(e["kind"], e["description"], e["amountCents"]) for e in entries] == [
            ("charge", "Late cancellation fee", 15580)]
    else:
        assert entries == []
    err(h.client("desk").post(f"/api/stays/{h.stay_id('s1')}/cancel"), 409, "This stay can no longer be cancelled.")
    assert h.client("desk").get("/api/desk").json()["freeRoomsText"] == free_rooms(1)


def test_cancellation_terms_from_server(app_url: str, browser: Browser) -> None:
    for hotel_now, browser_now, text in [
        ("2027-03-10T17:59:59-06:00", "2027-03-11T12:00:00-06:00", "Free cancellation until 2027-03-10 18:00"),
        ("2027-03-10T18:00:00-06:00", "2027-03-10T06:00:00-06:00", f"Late cancellation fee: {money(15580)}"),
    ]:
        h = make_hotel(app_url, rooms={"101": "clean"}, now=hotel_now, business_date="2027-03-10",
                       stays=[st("s1", "r101", "Ana Vale", "2027-03-11", "2027-03-14", guests=3)])
        assert h.stay("s1")["cancellation"]["text"] == text
        with staff(browser, h) as page:
            session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Asia/Tokyo"})
            page.clock.set_fixed_time(browser_now)
            visit(page, app_url, "/desk")
            panel = open_stay(page, "Ana Vale", "101", "2027-03-11", "2027-03-14")
            expect(status(panel, "Cancellation terms")).to_have_text(text)
            click(button(panel, "Cancel stay"))
            advance(page, PANEL_SETTLE_MS)
            expect(page.get_by_role("alertdialog", name="Cancel stay", exact=True)).to_contain_text(text)


def test_wf_cancel_deadline_panel_keyboard(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, now="2027-03-10T18:00:00-06:00",
                   business_date="2027-03-10",
                   stays=[st("s1", "r101", "Ana Vale", "2027-03-10", "2027-03-13", guests=3, link=True)])
    token = only_token(mail, h.emails["s1"])
    fee = h.stay("s1")["cancellation"]["feeCents"]
    with staff(browser, h) as page:
        expect(status(page, "Free rooms")).to_have_text(free_rooms(1))
        go_to(page, h, "r101", "2027-03-10")
        key(page, "Enter")
        advance(page, PANEL_SETTLE_MS)
        panel = dialog(page, "Stay")
        expect(panel).to_contain_text("Ana Vale")
        tab_to(page, button(panel, "Cancel stay"))
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        confirm = page.get_by_role("alertdialog", name="Cancel stay", exact=True)
        expect(confirm).to_contain_text(f"Late cancellation fee: {money(fee)}")
        tab_to(page, button(confirm, "Confirm cancellation"))
        page.keyboard.press("Enter")
        expect(status(page, "Desk notices")).to_have_text(f"Cancelled Ana Vale's stay. Fee: {money(fee)}.")
        expect(block(page, h.stay_id("s1"))).to_have_attribute("data-status", "cancelled")
        expect(status(page, "Free rooms")).to_have_text(free_rooms(2))
    stay = h.stay("s1")
    assert stay["status"] == "cancelled"
    assert [e["description"] for e in stay["folios"][0]["entries"]] == ["Late cancellation fee"]
    link_dead(app_url, token)


def test_wf_cancel_deadline_keep_stay(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, now=NOON,
                   stays=[st("s1", "r101", "Ana Vale", "2027-03-10", "2027-03-12", link=True)])
    token = only_token(mail, h.emails["s1"])
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", "2027-03-10", "2027-03-12")
        opener = button(panel, "Cancel stay")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        confirm = page.get_by_role("alertdialog", name="Cancel stay", exact=True)
        expect(confirm).to_be_visible()
        assert_tab_wraps(page, confirm)
        page.keyboard.press("Escape")
        advance(page, PANEL_SETTLE_MS)
        expect(confirm).to_be_hidden()
        expect(panel).to_be_visible()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        tab_to(page, button(confirm, "Keep stay"))
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        expect(confirm).to_be_hidden()
        stay = h.stay("s1")
        assert stay["status"] == "booked" and stay["folios"][0]["entries"] == []
        assert httpx.get(f"{app_url}/api/checkin/{token}", timeout=HTTP_TIMEOUT).status_code == 200
        click(opener)
        advance(page, PANEL_SETTLE_MS)
        click(button(confirm, "Confirm cancellation"))
        expect(status(page, "Desk notices")).to_have_text("Cancelled Ana Vale's stay. No fee.")
    assert h.stay("s1")["folios"][0]["entries"] == []


def split_case(app_url: str, cents: int) -> tuple[Hotel, str, str]:
    payer = fresh_email("payer")
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")],
                   folios=[minibar_folio("s1", "Ana Vale", payer, cents=cents)])
    return h, h.entry_id("e1"), h.folio_id("f1")


def test_exact_folio_splits(app_url: str) -> None:
    for cents, percents, shares in [(3333, [50, 50], [1667, 1666]), (1003, [50, 25, 25], [502, 251, 250]),
                                    (1001, [33, 33, 34], split_shares(1001, [33, 33, 34]))]:
        h, entry, folio = split_case(app_url, cents)
        desk = h.client("desk")
        answer = desk.post(f"/api/entries/{entry}/split", json={"percents": percents})
        assert answer.status_code == 201, answer.text
        stay = h.stay("s1")
        folios = stay["folios"]
        assert [f["name"] for f in folios] == ["Folio A", "Folio B", "Folio C"][:len(percents)]
        first = folios[0]["entries"]
        reversal = next(e for e in first if e["reversesEntryId"] == entry)
        assert reversal["amountCents"] == -cents and reversal["description"] == "Reversal of Minibar"
        posted = [next(e for e in f["entries"] if e["splitOfEntryId"] == entry) for f in folios]
        assert [e["amountCents"] for e in posted] == shares and sum(shares) == cents
        assert [e["description"] for e in posted] == [f"Minibar ({p}%)" for p in percents]
        assert sum(f["balanceCents"] for f in folios) == cents
        assert all(f["payerName"] == "Ana Vale" for f in folios[1:]), "created folios take the guest as payer"
        err(desk.post(f"/api/entries/{entry}/split", json={"percents": [50, 50]}), 409, "This entry cannot be changed again.")
        err(desk.post(f"/api/entries/{reversal['id']}/split", json={"percents": [50, 50]}), 409,
            "This entry cannot be changed again.")
    h, entry, folio = split_case(app_url, 3333)
    desk = h.client("desk")
    message = "Enter 2 to 4 whole percentages that add up to 100."
    for bad in ([50, 40], [100], [20, 20, 20, 20, 20], [50.5, 49.5]):
        field_err(desk.post(f"/api/entries/{entry}/split", json={"percents": bad}), "percents", message)
    assert len(h.stay("s1")["folios"]) == 1 and len(h.stay("s1")["folios"][0]["entries"]) == 1
    paid = desk.post(f"/api/folios/{folio}/payments", json={"method": "cash", "amountCents": 100, "reference": None})
    err(desk.post(f"/api/entries/{paid.json()['id']}/split", json={"percents": [50, 50]}), 409,
        "This entry cannot be changed again.")


def test_wf_folio_split_keyboard_happy(app_url: str, browser: Browser) -> None:
    h, entry, _ = split_case(app_url, 3333)
    with staff(browser, h) as page:
        go_to(page, h, "r101", BD)
        key(page, "Enter")
        advance(page, PANEL_SETTLE_MS)
        panel = dialog(page, "Stay")
        opener = button(panel, "Split Minibar")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Split charge")
        expect(box).to_be_visible()
        assert_tab_wraps(page, box)
        preview = box.get_by_role("table", name="Split preview", exact=True)
        field_a = box.get_by_role("spinbutton", name="Folio A percent", exact=True)
        field_b = box.get_by_role("spinbutton", name="Folio B percent", exact=True)
        assert table_rows(preview) == [["Folio A", "—", "—"], ["Folio B", "—", "—"]]
        type_in(page, field_a, "50")
        advance(page, BREAKDOWN_MS)
        expect(preview.get_by_role("cell", name="50%", exact=True)).to_have_count(1)
        assert table_rows(preview) == [["Folio A", "50%", "—"], ["Folio B", "—", "—"]]
        type_in(page, field_b, "50")
        advance(page, BREAKDOWN_MS)
        expect(preview.get_by_role("cell", name="$16.66", exact=True)).to_have_count(1)
        assert table_rows(preview) == [["Folio A", "50%", "$16.67"], ["Folio B", "50%", "$16.66"]]
        tab_to(page, button(box, "Apply split"))
        page.keyboard.press("Enter")
        expect(status(panel, "Folio status")).to_have_text(split_done(3333, 2))
        advance(page, PANEL_SETTLE_MS)
        expect(box).to_be_hidden()
        expect(opener).to_be_focused()
        expect(status(panel.get_by_role("region", name="Folio A", exact=True), "Folio A balance")).to_have_text("$16.67")
        expect(status(panel.get_by_role("region", name="Folio B", exact=True), "Folio B balance")).to_have_text("$16.66")
        rows = table_rows(panel.get_by_role("table", name=folio_entries("A"), exact=True))
        assert any(r[1].startswith("Reversal of Minibar") and r[2] == money(-3333) for r in rows), rows
    folios = h.stay("s1")["folios"]
    assert [f["balanceCents"] for f in folios] == [1667, 1666]
    assert any(e["reversesEntryId"] == entry for e in folios[0]["entries"])


def test_wf_folio_split_keyboard_bad_percents(app_url: str, browser: Browser) -> None:
    h, _, _ = split_case(app_url, 1003)
    percents = [49, 25, 25, 1]
    shares = split_shares(1003, percents)
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        click(button(panel, "Split Minibar"))
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Split charge")
        percent = lambda letter: box.get_by_role("spinbutton", name=f"Folio {letter} percent", exact=True)
        add = button(box, "Add payer")
        click(add)
        expect(percent("C")).to_be_visible()
        click(add)
        expect(percent("D")).to_be_visible()
        click(add)
        advance(page, BREAKDOWN_MS)
        expect(percent("E")).to_have_count(0)
        preview = box.get_by_role("table", name="Split preview", exact=True)
        assert len(table_rows(preview)) == 4
        fill(percent("A"), str(percents[0]))
        fill(percent("B"), "40")
        advance(page, BREAKDOWN_MS)
        assert [r[2] for r in table_rows(preview)] == ["—"] * 4
        click(button(box, "Apply split"))
        advance(page, PANEL_SETTLE_MS)
        assert len(h.stay("s1")["folios"]) == 1 and len(h.stay("s1")["folios"][0]["entries"]) == 1
        if not box.is_visible():
            click(button(panel, "Split Minibar"))
            advance(page, PANEL_SETTLE_MS)
            click(add)
            expect(percent("C")).to_be_visible()
            click(add)
            expect(percent("D")).to_be_visible()
        fill(percent("A"), str(percents[0]))
        fill(percent("B"), str(percents[1]))
        fill(percent("C"), str(percents[2]))
        fill(percent("D"), str(percents[3]))
        advance(page, BREAKDOWN_MS)
        expect(preview.get_by_role("cell", name=money(shares[0]), exact=True)).to_have_count(1)
        click(button(box, "Apply split"))
        expect(status(panel, "Folio status")).to_have_text(split_done(1003, 4))
    assert [f["balanceCents"] for f in h.stay("s1")["folios"]] == shares


def test_payments_reversals_balances(app_url: str, browser: Browser) -> None:
    h, entry, folio = split_case(app_url, 3333)
    desk = h.client("desk")
    field_err(desk.post(f"/api/folios/{folio}/charges", json={"description": "Minibar", "amountCents": 0}),
              "amountCents", "Enter an amount above zero.")
    field_err(desk.post(f"/api/folios/{folio}/payments", json={"method": "card", "amountCents": 100}),
              "reference", "Enter the terminal reference.")
    cash = desk.post(f"/api/folios/{folio}/payments", json={"method": "cash", "amountCents": 1000, "reference": None})
    assert cash.status_code == 201 and cash.json()["description"] == "Cash payment" and cash.json()["kind"] == "payment"
    card = desk.post(f"/api/folios/{folio}/payments", json={"method": "card", "amountCents": 500, "reference": TERMINAL_ONE})
    assert card.status_code == 201 and card.json()["description"] == f"Card payment {TERMINAL_ONE}"
    balance = lambda: h.stay("s1")["folios"][0]["balanceCents"]
    assert balance() == 3333 - 1000 - 500
    undo = desk.post(f"/api/entries/{cash.json()['id']}/reverse")
    assert undo.status_code == 201, undo.text
    assert (undo.json()["kind"], undo.json()["amountCents"], undo.json()["reversesEntryId"], undo.json()["description"]) == (
        "payment", -1000, cash.json()["id"], "Reversal of Cash payment")
    assert balance() == 3333 - 500
    reversal = desk.post(f"/api/entries/{entry}/reverse")
    assert reversal.status_code == 201 and reversal.json()["amountCents"] == -3333
    assert reversal.json()["description"] == "Reversal of Minibar"
    assert balance() == -500
    entries = h.stay("s1")["folios"][0]["entries"]
    original = next(e for e in entries if e["id"] == entry)
    assert (original["amountCents"], original["description"]) == (3333, "Minibar"), "the original is never edited"
    assert len(entries) == 5, "no entry is deleted"
    message = "This entry cannot be changed again."
    err(desk.post(f"/api/entries/{entry}/reverse"), 409, message)
    err(desk.post(f"/api/entries/{reversal.json()['id']}/reverse"), 409, message)
    assert len(h.stay("s1")["folios"][0]["entries"]) == 5
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        expect(status(region, "Folio A balance")).to_have_text(money(-500))
        click(button(region, "Record payment"))
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Record payment")
        select(combo(box, "Payment method"), "Card")
        fill(textbox(box, "Amount"), dollars(3333))
        fill(textbox(box, "Terminal reference"), TERMINAL_TWO)
        click(button(box, "Save payment"))
        expect(status(panel, "Folio status")).to_have_text(payment_recorded(3333))
    assert any(e["description"] == f"Card payment {TERMINAL_TWO}" and e["amountCents"] == 3333
               for e in h.stay("s1")["folios"][0]["entries"])


def test_move_entry_between_folios(app_url: str, browser: Browser) -> None:
    payer = fresh_email("payer")
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")],
                   folios=[minibar_folio("s1", "Ana Vale", payer),
                           {"key": "f2", "stay": "s1", "name": "Folio B", "payerName": "Brightwell Surveying Ltd",
                            "payerEmail": "accounts@brightwell.example", "entries": []}])
    before = next(e for e in h.stay("s1")["folios"][0]["entries"] if e["id"] == h.entry_id("e1"))
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        click(button(panel, "Move Minibar"))
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Move entry")
        select(combo(box, "To folio"), "Folio B")
        click(button(box, "Save move"))
        expect(status(panel, "Folio status")).to_have_text("Entry moved to Folio B.")
    folios = h.stay("s1")["folios"]
    assert folios[0]["entries"] == [] and folios[1]["entries"] == [before]
    assert (folios[0]["balanceCents"], folios[1]["balanceCents"]) == (0, 3333)
    desk = h.client("desk")
    charge = desk.post(f"/api/folios/{h.folio_id('f1')}/charges", json={"description": "Minibar", "amountCents": 100})
    assert desk.post(f"/api/folios/{h.folio_id('f2')}/payments",
                     json={"method": "cash", "amountCents": 3333, "reference": None}).status_code == 201
    assert desk.post(f"/api/folios/{h.folio_id('f2')}/close").status_code == 200
    err(desk.post(f"/api/entries/{charge.json()['id']}/move", json={"toFolioId": h.folio_id("f2")}), 409,
        "This folio is closed.")
    assert h.stay("s1")["folios"][0]["balanceCents"] == 100


def test_folio_closes_only_at_zero(app_url: str) -> None:
    h, _, folio = split_case(app_url, 3333)
    desk = h.client("desk")
    err(desk.post(f"/api/folios/{folio}/close"), 409, f"This folio still has a balance of {money(3333)}.")
    empty = desk.post(f"/api/stays/{h.stay_id('s1')}/folios", json={"payerName": "Ana Vale", "payerEmail": fresh_email("payer")})
    assert empty.status_code == 201 and empty.json()["name"] == "Folio B"
    err(desk.post(f"/api/folios/{empty.json()['id']}/close"), 409, "This folio has no entries.")
    folios = h.stay("s1")["folios"]
    assert all(f["state"] == "open" and f["invoice"] is None for f in folios)
    assert S3().keys(f"invoices/{h.id}/") == []


def paid_hotel(app_url: str, count: int = 1, base_room: int = 101) -> tuple[Hotel, list[str], str]:
    payer = fresh_email("payer")
    rooms = {str(base_room + i): "clean" for i in range(count)}
    stays = [st(f"s{i}", f"r{base_room + i}", "Ana Vale", BD, MON, "in_house") for i in range(count)]
    folios = [minibar_folio(f"s{i}", "Ana Vale", payer, paid=True, key=f"f{i}", entry=f"e{i}") for i in range(count)]
    h = make_hotel(app_url, rooms=rooms, stays=stays, folios=folios)
    return h, [h.folio_id(f"f{i}") for i in range(count)], payer


def test_invoice_numbers_and_pdf_lines(app_url: str) -> None:
    h, folios, _ = paid_hotel(app_url, 3)
    clients = [h.new_client("desk") for _ in folios]
    with ThreadPoolExecutor(3) as pool:
        answers = list(pool.map(lambda pair: pair[0].post(f"/api/folios/{pair[1]}/close"), zip(clients, folios)))
    assert [a.status_code for a in answers] == [200, 200, 200], [a.text for a in answers]
    numbers = sorted(a.json()["invoice"]["number"] for a in answers)
    assert numbers == [invoice_number(n) for n in (1, 2, 3)]
    first_number = invoice_number(1)
    first_index = next(i for i, a in enumerate(answers) if a.json()["invoice"]["number"] == first_number)
    first = answers[first_index].json()
    first_room = str(101 + first_index)
    assert first["state"] == "closed" and first["invoice"]["state"] == "issued"
    assert first["invoice"]["mailState"] == "not_sent" and first["invoice"]["billToName"] == "Ana Vale"
    key_name = f"invoices/{h.id}/{first_number}.pdf"
    assert key_name in S3().keys(f"invoices/{h.id}/")
    stored = norm(pdf_text(S3().get(key_name)))
    amount = money(3333)
    for line in [f"Invoice {first_number}", h.name, "Bill to: Ana Vale", f"Stay: {BD} to {MON}", f"Room {first_room}",
                 f"{BD} Minibar {amount}", f"{BD} Cash payment {amount}", f"Total: {amount}", f"Paid: {amount}",
                 "Balance: $0.00"]:
        assert line in stored, f"PDF lacks the published line {line!r}: {stored}"
    served = h.client("desk").get(f"/api/invoices/{first['invoice']['id']}/pdf")
    assert served.status_code == 200 and served.headers["content-type"].startswith("application/pdf")
    assert f"Invoice {first_number}" in norm(pdf_text(served.content))
    other, other_folios, _ = paid_hotel(app_url, 1)
    separate = other.client("desk").post(f"/api/folios/{other_folios[0]}/close")
    assert separate.json()["invoice"]["number"] == first_number, "each hotel has its own series"


def test_wf_invoice_mail_outage_email_sent(app_url: str, browser: Browser, mail: Any) -> None:
    h, _, payer = paid_hotel(app_url, 1)
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        expect(status(region, "Invoice state")).to_have_text("Draft")
        click(button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text("Invoice INV-000001 issued.")
        expect(status(region, "Invoice state")).to_have_text("Issued")
        expect(status(region, "Mail state")).to_have_text("Not sent")
        href = region.get_by_role("link", name="Download invoice", exact=True).evaluate("a => a.href")
        assert same_origin(href, app_url), f"the invoice link leaves the app: {href}"
        with held(page, "**/api/invoices/*/email") as release:
            click(button(region, "Email invoice"))
            expect(status(panel, "Folio status")).to_have_text("Sending invoice…")
            expect(status(region, "Mail state")).to_have_text("Not sent")
            release()
            expect(status(panel, "Folio status")).to_have_text(f"Invoice INV-000001 sent to {payer}.")
        expect(status(region, "Mail state")).to_have_text("Sent")
    message = mail_to(mail, payer, 1)[0]
    assert message["Subject"] == f"Invoice INV-000001 from {h.name}"
    assert "Your invoice INV-000001 is attached." in mail_text(message)
    assert mail_from_address() in addresses(message.get("From"))
    attachment = message["Attachments"][0]
    assert attachment["FileName"] == "INV-000001.pdf" and attachment["ContentType"].startswith("application/pdf")
    invoice = h.stay("s0")["folios"][0]["invoice"]
    assert invoice["mailState"] == "sent"
    again = h.client("desk").post(f"/api/invoices/{invoice['id']}/email")
    assert again.status_code == 200 and again.json()["mailState"] == "sent"
    assert len(mail_to(mail, payer, 2)) == 2


def test_wf_invoice_mail_outage_pdf_recovery(app_url: str, browser: Browser) -> None:
    down = os.environ["APP_GOTENBERG_DOWN_URL"]
    message = "The invoice could not be created. The PDF service is unavailable. Nothing was saved."
    h, folios, _ = paid_hotel(app_url, 2)
    err(h.client("desk", down).post(f"/api/folios/{folios[0]}/close"), 503, message)
    with staff(browser, h, base=down) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        click(button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text(message)
        expect(status(region, "Invoice state")).to_have_text("Draft")
        expect(button(region, "Close folio")).to_be_visible()
    folio = h.stay("s0")["folios"][0]
    assert folio["state"] == "open" and folio["invoice"] is None
    assert S3().keys(f"invoices/{h.id}/") == []
    recovered = h.client("desk").post(f"/api/folios/{folios[0]}/close")
    assert recovered.status_code == 200 and recovered.json()["invoice"]["number"] == invoice_number(1), recovered.text
    err(h.client("desk", down).post(f"/api/folios/{folios[1]}/close"), 503, message)
    assert h.client("desk").post(f"/api/folios/{folios[1]}/close").json()["invoice"]["number"] == invoice_number(2)


def test_file_store_outage_and_recovery(app_url: str, browser: Browser, mail: Any) -> None:
    down = os.environ["APP_MINIO_DOWN_URL"]
    close_text = "The invoice could not be created. The file store is unavailable. Nothing was saved."
    photo_text = "Your photo could not be saved. Please try again."
    store_text = "The file store is unavailable."
    h, folios, _ = paid_hotel(app_url, 1)
    err(h.client("desk", down).post(f"/api/folios/{folios[0]}/close"), 503, close_text)
    folio = h.stay("s0")["folios"][0]
    assert folio["state"] == "open" and folio["invoice"] is None
    with staff(browser, h, base=down) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        click(button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text(close_text)
        expect(status(region, "Invoice state")).to_have_text("Draft")
    closed = h.client("desk").post(f"/api/folios/{folios[0]}/close")
    assert closed.status_code == 200 and closed.json()["invoice"]["number"] == invoice_number(1), "no number was consumed"
    invoice = closed.json()["invoice"]["id"]
    err(h.client("desk", down).get(f"/api/invoices/{invoice}/pdf"), 503, store_text)

    g = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, g.emails["s1"])
    err(upload(down, token, jpeg_bytes()), 503, photo_text)
    assert g.stay("s1")["idPhoto"] == "none" and g.stay("s1")["checkedInOnline"] is False
    assert S3().keys(f"id-photos/{g.id}/") == []
    with open_app(browser, f"{down}/checkin/{token}") as guest:
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.jpg", "mimeType": "image/jpeg", "buffer": jpeg_bytes()})
        click(button(guest, "Upload photo"))
        expect(status(guest, "Check-in status")).to_have_text(photo_text)
    assert httpx.get(f"{app_url}/api/checkin/{token}", timeout=HTTP_TIMEOUT).status_code == 200, "the link stays alive"
    assert upload(app_url, token, jpeg_bytes()).status_code == 200
    assert f"id-photos/{g.id}/{g.stay_id('s1')}" in S3().keys(f"id-photos/{g.id}/")
    err(g.client("desk", down).get(f"/api/stays/{g.stay_id('s1')}/id-photo"), 503, store_text)
    assert g.client("desk").get(f"/api/stays/{g.stay_id('s1')}/id-photo").status_code == 200


def test_mail_outage_and_recovery(app_url: str, browser: Browser, mail: Any) -> None:
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    link_text = "The check-in link could not be sent. The mail service is unavailable."
    invoice_text = "The invoice could not be emailed. The mail service is unavailable."
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean"},
                   stays=[st("sent", "r103", "Mara Okafor", day(BD, 2), MON, link=True)])
    email = fresh_email("guest")
    with staff(browser, h, base=down) as page:
        box = open_new_stay(page)
        fill_new_stay(box, "Ana Vale", email, BD, MON, "101")
        click(button(box, "Create stay"))
        expect(status(page, "Desk notices")).to_have_text(
            "Stay created for Ana Vale in room 101. The check-in link could not be sent. The mail service is unavailable.")
    blocks = h.client("desk").get("/api/timeline", params={"from": BD, "to": BD}).json()["blocks"]
    stay_id = next(b["stayId"] for b in blocks if b["guestName"] == "Ana Vale")
    assert h.stay(stay_id)["checkinLinkState"] == "not_sent"
    assert not [m for m in mail.messages() if email in [a.lower() for a in addresses(m.get("To"))]]
    err(h.client("desk", down).post(f"/api/stays/{stay_id}/checkin-link"), 503, link_text)
    assert h.stay(stay_id)["checkinLinkState"] == "not_sent"
    assert h.client("desk").post(f"/api/stays/{stay_id}/checkin-link").status_code == 200
    assert h.stay(stay_id)["checkinLinkState"] == "sent"
    assert len(mail_to(mail, email, 1)) == 1

    earlier = only_token(mail, h.emails["sent"])
    err(h.client("desk", down).post(f"/api/stays/{h.stay_id('sent')}/checkin-link"), 503, link_text)
    assert httpx.get(f"{app_url}/api/checkin/{earlier}", timeout=HTTP_TIMEOUT).status_code == 200, "the earlier link is unchanged"

    i, folios, payer = paid_hotel(app_url, 1)
    closed = i.client("desk").post(f"/api/folios/{folios[0]}/close")
    invoice = closed.json()["invoice"]["id"]
    err(i.client("desk", down).post(f"/api/invoices/{invoice}/email"), 503, invoice_text)
    assert i.stay("s0")["folios"][0]["invoice"]["mailState"] == "not_sent"
    with staff(browser, i, base=down) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        click(button(region, "Email invoice"))
        expect(status(panel, "Folio status")).to_have_text(invoice_text)
        expect(status(region, "Invoice state")).to_have_text("Issued")
        expect(status(region, "Mail state")).to_have_text("Not sent")
    assert not [m for m in mail.messages() if payer in [a.lower() for a in addresses(m.get("To"))]]
    assert i.client("desk").post(f"/api/invoices/{invoice}/email").json()["mailState"] == "sent"
    assert len(mail_to(mail, payer, 1)) == 1


def test_wf_room_move_night_chosen_night(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=SECOND_NIGHT,
                   now="2027-03-06T12:00:00-06:00",
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house", guests=2)])
    stay_id = h.stay_id("s1")
    before = h.stay("s1")
    prices = [(n["date"], n["roomCents"], n["taxCents"], n["cityTaxCents"], n["totalCents"]) for n in before["nightly"]]
    desk = h.client("desk")
    message = "Choose a night of this stay that is not before the business date."
    for bad in (BD, MON, "2027-03-20"):
        field_err(desk.post(f"/api/stays/{stay_id}/move", json={"version": before["version"], "roomId": h.room("r102"),
                                                                "fromNight": bad}), "fromNight", message)
    answer = desk.post(f"/api/stays/{stay_id}/move", json={"version": before["version"], "roomId": h.room("r102"),
                                                           "fromNight": SECOND_NIGHT, "arrival": SECOND_NIGHT})
    field_err(answer, "arrival", "Send arrival or fromNight, not both.")
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", BD, MON)
        select(combo(panel, "Move to room"), "102")
        fill(textbox(panel, "Move from night"), THIRD_NIGHT)
        click(button(panel, "Move room"))
        expect(status(page, "Desk notices")).to_have_text("Moved Ana Vale to room 102.")
        early = block(page, stay_id, BD)
        late = block(page, stay_id, THIRD_NIGHT)
        expect(early).to_have_attribute("data-room-id", h.room("r101"))
        expect(early).to_have_attribute("data-nights", "2")
        expect(late).to_have_attribute("data-room-id", h.room("r102"))
        expect(late).to_have_attribute("data-nights", "1")
    after = h.stay("s1")
    assert [(s["roomNumber"], s["firstNight"], s["nights"]) for s in after["segments"]] == [
        ("101", BD, 2), ("102", THIRD_NIGHT, 1)]
    assert [(n["date"], n["roomCents"], n["taxCents"], n["cityTaxCents"], n["totalCents"]) for n in after["nightly"]] == prices
    assert [n["roomNumber"] for n in after["nightly"]] == ["101", "101", "102"]
    assert after["totalCents"] == before["totalCents"]
    assert h.board_status("r101") == "clean", "a move starting on a later night changes no room status (L466)"


def test_in_house_move_keeps_posted(app_url: str) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "inspected", "103": "dirty", "104": "out_of_order", "105": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house"),
                          st("s2", "r105", "Mara Okafor", SECOND_NIGHT, THIRD_NIGHT)])
    h.clock(BD_OPEN)
    assert h.close(BD).status_code == 200
    desk = h.client("desk")
    stay = h.stay("s1")
    posted = stay["folios"][0]["entries"]
    version = stay["version"]
    move = lambda room, **extra: desk.post(f"/api/stays/{stay['id']}/move",
                                           json={"version": version, "roomId": h.room(room), **extra})
    err(move("r103"), 409, no_in_house("103", "dirty"))
    err(move("r104"), 409, no_in_house("104", "out of order"))
    err(move("r105"), 409, occupied_on("105", SECOND_NIGHT))
    field_err(move("r102", arrival=SECOND_NIGHT), "arrival", "Only a booked stay can change its dates this way.")
    assert h.board_status("r101") == "clean", "a refused move leaves the room alone"
    answer = move("r102")
    assert answer.status_code == 200, answer.text
    assert [(s["roomNumber"], s["firstNight"], s["nights"]) for s in answer.json()["segments"]] == [
        ("101", BD, 1), ("102", SECOND_NIGHT, 2)]
    assert h.board_status("r101") == "dirty" and h.board_status("r102") == "inspected"
    err(move("r101"), 409, "This stay was changed by someone else. It now shows the latest.")
    after = h.stay("s1")["folios"][0]["entries"]
    assert after == posted and all(e["roomNumber"] == "101" for e in after)
    h.clock("2027-03-07T04:00:00-06:00")
    assert h.close(SECOND_NIGHT).status_code == 200
    latest = h.stay("s1")["folios"][0]["entries"]
    assert latest[:len(posted)] == posted
    fresh = latest[len(posted):]
    assert [(e["description"], e["roomNumber"]) for e in fresh] == [
        ("Room charge, room 102", "102"), ("Tax, room 102", "102"), ("City tax, room 102", "102")]


def test_wf_room_move_night_second_screen(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=SECOND_NIGHT,
                   now="2027-03-06T12:00:00-06:00",
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    stay_id = h.stay_id("s1")
    with staff(browser, h, "desk") as mover, staff(browser, h, "desk2") as watcher:
        panel = open_stay(mover, "Ana Vale", "101", BD, MON)
        expect(block(watcher, stay_id, BD)).to_have_attribute("data-nights", "3")
        select(combo(panel, "Move to room"), "102")
        click(button(panel, "Move room"))
        expect(status(mover, "Desk notices")).to_have_text("Moved Ana Vale to room 102.")
        expect(status(watcher, "Desk notices")).to_have_text("Moved Ana Vale to room 102.", timeout=LIVE_WAIT_MS)
        expect(block(watcher, stay_id, BD)).to_have_attribute("data-room-id", h.room("r101"), timeout=LIVE_WAIT_MS)
        expect(block(watcher, stay_id, BD)).to_have_attribute("data-nights", "1", timeout=LIVE_WAIT_MS)
        expect(block(watcher, stay_id, SECOND_NIGHT)).to_have_attribute("data-room-id", h.room("r102"), timeout=LIVE_WAIT_MS)
        expect(button(watcher, "Room 101 status: dirty")).to_be_visible(timeout=LIVE_WAIT_MS)
        open_panel = open_stay(watcher, "Ana Vale", "102", BD, MON) if button(
            watcher, f"Stay Ana Vale, room 102, {BD} to {MON}").count() else None
        if open_panel is None:
            click(block(watcher, stay_id, SECOND_NIGHT))
            advance(watcher, PANEL_SETTLE_MS)
            open_panel = dialog(watcher, "Stay")
        h.clock("2027-03-07T04:00:00-06:00")
        assert h.close(SECOND_NIGHT).status_code == 200
        entries = open_panel.get_by_role("table", name=folio_entries("A"), exact=True)
        expect(entries).to_contain_text("Room charge, room 102", timeout=LIVE_WAIT_MS)
        expect(open_panel).to_be_visible()
    assert any(e["description"] == "Room charge, room 102" for e in h.stay("s1")["folios"][0]["entries"])


def test_wf_room_move_night_refused_message(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", BD, MON), st("s2", "r102", "Mara Okafor", SECOND_NIGHT, MON)])
    refusal = occupied_on("102", SECOND_NIGHT)
    with staff(browser, h, "desk") as mover, staff(browser, h, "desk2") as watcher:
        panel = open_stay(mover, "Ana Vale", "101", BD, MON)
        select(combo(panel, "Move to room"), "102")
        with held(mover, f"**/api/stays/{h.stay_id('s1')}/move") as release:
            click(button(panel, "Move room"))
            expect(status(mover, "Desk notices")).to_have_text("Moving stay…")
            release()
            expect(status(mover, "Desk notices")).to_have_text(refusal)
        folio = h.stay("s1")["folios"][0]["id"]
        assert h.client("owner").post(f"/api/folios/{folio}/charges",
                                      json={"description": "Minibar", "amountCents": 3333}).status_code == 201
        expect(panel).to_contain_text("Minibar", timeout=LIVE_WAIT_MS)
        expect(status(mover, "Desk notices")).to_have_text(refusal)
        expect(block(mover, h.stay_id("s1"))).to_have_attribute("data-room-id", h.room("r101"))
        expect(block(watcher, h.stay_id("s1"))).to_have_attribute("data-room-id", h.room("r101"))
    assert [s["roomId"] for s in h.stay("s1")["segments"]] == [h.room("r101")]


def merge_guests() -> list[dict[str, Any]]:
    return [
        {"key": "keep", "name": "Sam Whitlock", "email": "sam@guests.example", "phone": "+1 555 0100",
         "company": "", "address": SHARED_ADDRESS},
        {"key": "drop", "name": "Samuel Whitlock", "email": "samuel@guests.example", "phone": OTHER_PHONE,
         "company": "Brightwell Surveying Ltd", "address": SHARED_ADDRESS},
    ]


def test_merge_field_rules(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, guests=merge_guests())
    survivor, merged = h.guest_id("keep"), h.guest_id("drop")
    desk = h.client("desk")
    field_err(desk.post("/api/guests/merge", json={"survivorId": survivor, "mergedId": survivor}), "mergedId",
              "Choose two different guests.")
    with staff(browser, h, "desk", "/guests") as page:
        click(button(page, "Merge guests"))
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Merge guests")
        select(combo(box, "Surviving guest"), "Sam Whitlock sam@guests.example")
        select(combo(box, "Merged guest"), "Samuel Whitlock samuel@guests.example")
        click(button(box, "Review merge"))
        conflicts = box.get_by_role("table", name="Merge conflicts", exact=True)
        expect(conflicts).to_be_visible()
        for value in ("Sam Whitlock", "Samuel Whitlock", "sam@guests.example", "samuel@guests.example",
                      "+1 555 0100", OTHER_PHONE):
            expect(conflicts).to_contain_text(value)
        for field in ("Name", "Email", "Phone"):
            expect(box.get_by_role("radiogroup", name=field, exact=True)).to_be_visible()
        for field in ("Company", "Address"):
            expect(box.get_by_role("radiogroup", name=field, exact=True)).to_have_count(0)
        expect(box.get_by_role("radio", name=keep_radio("Sam Whitlock"), exact=True)).to_be_checked()
        expect(box.get_by_role("radio", name=keep_radio("Samuel Whitlock"), exact=True)).not_to_be_checked()
        phone = box.get_by_role("radio", name=keep_radio(OTHER_PHONE), exact=True)
        click(phone)
        expect(phone).to_be_checked()
        click(button(box, "Confirm merge"))
        expect(status(page, "Desk notices")).to_have_text("Guests merged. 0 stays moved.")
    guest = desk.get(f"/api/guests/{survivor}").json()
    assert (guest["name"], guest["email"], guest["phone"], guest["company"], guest["address"]) == (
        "Sam Whitlock", "sam@guests.example", OTHER_PHONE, "Brightwell Surveying Ltd", SHARED_ADDRESS)
    err(desk.get(f"/api/guests/{merged}"), 404, "Not found.")
    err(desk.post("/api/guests/merge", json={"survivorId": survivor, "mergedId": merged}), 404, "Not found.")

    other = make_hotel(app_url, rooms={"101": "clean"}, guests=merge_guests())
    answer = other.client("desk").post("/api/guests/merge", json={"survivorId": other.guest_id("keep"),
                                                                  "mergedId": other.guest_id("drop")})
    assert answer.status_code == 200, answer.text
    assert answer.json()["guest"]["phone"] == "+1 555 0100", "an omitted field takes the survivor's"
    assert answer.json()["guest"]["company"] == "Brightwell Surveying Ltd"
    assert answer.json()["staysMoved"] == 0


def test_wf_guest_merge_keyboard(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, guests=merge_guests(),
                   stays=[st("s1", "r101", "Samuel Whitlock", BD, MON, "in_house", guest="drop")],
                   folios=[minibar_folio("s1", "Samuel Whitlock", "samuel@guests.example", paid=True)])
    closed = h.client("desk").post(f"/api/folios/{h.folio_id('f1')}/close")
    assert closed.status_code == 200, closed.text
    invoice = closed.json()["invoice"]
    with staff(browser, h, "desk", "/guests") as page, staff(browser, h, "desk2") as other:
        opener = button(page, "Merge guests")
        tab_to(page, opener)
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Merge guests")
        expect(box).to_be_visible()
        assert_tab_wraps(page, box)
        choose_by_keyboard(page, combo(box, "Surviving guest"), "Sam Whitlock")
        choose_by_keyboard(page, combo(box, "Merged guest"), "Samuel Whitlock")
        tab_to(page, button(box, "Review merge"))
        page.keyboard.press("Enter")
        expect(box.get_by_role("table", name="Merge conflicts", exact=True)).to_be_visible()
        tab_to(page, button(box, "Confirm merge"))
        page.keyboard.press("Enter")
        expect(status(page, "Desk notices")).to_have_text("Guests merged. 1 stays moved.")
        expect(status(other, "Desk notices")).to_have_text("Guests merged. 1 stays moved.", timeout=LIVE_WAIT_MS)
        advance(page, PANEL_SETTLE_MS)
        expect(box).to_be_hidden()
        expect(opener).to_be_focused()
    desk = h.client("desk")
    survivor = desk.get(f"/api/guests/{h.guest_id('keep')}").json()
    assert h.stay_id("s1") in survivor["stayIds"] and h.folio_id("f1") in survivor["folioIds"]
    stay = h.stay("s1")
    assert stay["guest"]["id"] == h.guest_id("keep")
    assert stay["folios"][0]["payerName"] == "Samuel Whitlock"
    assert stay["folios"][0]["invoice"]["billToName"] == "Samuel Whitlock"
    assert stay["folios"][0]["invoice"]["number"] == invoice["number"]
    err(desk.get(f"/api/guests/{h.guest_id('drop')}"), 404, "Not found.")


def test_wf_guest_merge_pending_repeat(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, guests=merge_guests(),
                   stays=[st("s1", "r101", "Samuel Whitlock", BD, MON, guest="drop")])
    with staff(browser, h, "desk", "/guests") as page:
        sent = requests_to(page, "POST", r"/api/guests/merge$")
        click(button(page, "Merge guests"))
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Merge guests")
        select(combo(box, "Surviving guest"), "Sam Whitlock sam@guests.example")
        select(combo(box, "Merged guest"), "Samuel Whitlock samuel@guests.example")
        click(button(box, "Review merge"))
        confirm = button(box, "Confirm merge")
        expect(confirm).to_be_visible()
        with held(page, "**/api/guests/merge") as release:
            click(confirm)
            expect(confirm).to_have_attribute("aria-busy", "true")
            expect(status(page, "Desk notices")).to_have_text("Merging guests…")
            click(confirm)
            release()
            expect(status(page, "Desk notices")).to_have_text("Guests merged. 1 stays moved.")
        assert len(sent) == 1, f"a double press sent {len(sent)} merges (L201)"
        expect(status(page, "Desk notices")).to_have_text("Guests merged. 1 stays moved.")
    assert h.stay("s1")["guest"]["id"] == h.guest_id("keep")


def test_report_figures(app_url: str, browser: Browser) -> None:
    rooms = {str(301 + i): "clean" for i in range(14)}
    rooms["314"] = "out_of_order"
    plans = [{"key": "a", "name": "Flexible", "weeknightCents": 13700, "weekendCents": 13700},
             {"key": "b", "name": "Corporate", "weeknightCents": 13850, "weekendCents": 13850}]
    stays = [st(f"s{i}", f"r{301 + i}", f"Guest {i}", MON, TAX_START, plan="b" if i == 8 else "a") for i in range(9)]
    h = make_hotel(app_url, rooms=rooms, plans=plans, stays=stays, business_date=MON, now=MON_NOON)
    owner = h.client("owner")
    worked = owner.get("/api/reports", params={"from": MON, "to": MON}).json()
    assert (worked["roomsAvailable"], worked["roomsSold"], worked["roomRevenueCents"]) == (13, 9, 123450)
    assert (worked["occupancy"], worked["averageDailyRate"], worked["revenuePerAvailableRoom"]) == (
        "69.2%", "$137.17", "$94.96")
    with staff(browser, h, "owner", "/reports") as page:
        expect(textbox(page, "From")).to_have_value(MON)
        expect(textbox(page, "To")).to_have_value(MON)
        for name, value in [("Rooms available", "13"), ("Rooms sold", "9"), ("Room revenue", "$1,234.50"),
                            ("Occupancy", "69.2%"), ("Average daily rate", "$137.17"),
                            ("Revenue per available room", "$94.96")]:
            expect(status(page, name)).to_have_text(value)
        expect(page.get_by_role("table", name="Nightly figures", exact=True)).to_contain_text("$1,234.50")
        assert table_rows(page.get_by_role("table", name="Nightly figures", exact=True)) == [
            [MON, "13", "9", "$1,234.50", "69.2%", "$137.17", "$94.96"]]
    zero = owner.get("/api/reports", params={"from": TAX_START, "to": TAX_START}).json()
    assert (zero["occupancy"], zero["averageDailyRate"], zero["revenuePerAvailableRoom"]) == ("0.0%", "—", "$0.00")
    both = owner.get("/api/reports", params={"from": MON, "to": TAX_START}).json()
    assert (both["roomsAvailable"], both["roomsSold"], both["roomRevenueCents"]) == (13 * 2, 9, 123450)
    assert both["occupancy"] == occupancy(9, 13 * 2) and both["revenuePerAvailableRoom"] == money(half_up_div(123450, 13 * 2))
    assert [n["date"] for n in both["nights"]] == [MON, TAX_START]
    assert all(isinstance(n[k], str) for n in both["nights"]
               for k in ("occupancy", "averageDailyRate", "revenuePerAvailableRoom"))
    message = "Enter a valid date range."
    field_err(owner.get("/api/reports", params={"from": "nope", "to": MON}), "from", message)
    assert "errors" in owner.get("/api/reports", params={"from": MON, "to": day(MON, 366)}).json()

    empty = make_hotel(app_url, rooms={"101": "out_of_order"})
    none = empty.client("owner").get("/api/reports", params={"from": BD, "to": BD}).json()
    assert (none["occupancy"], none["averageDailyRate"], none["revenuePerAvailableRoom"]) == ("—", "—", "—")

    f = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "clean"},
                   stays=[st("in", "r101", "Ana Vale", BD, THIRD_NIGHT, "in_house"),
                          st("miss", "r102", "Mara Okafor", BD, SECOND_NIGHT),
                          st("off", "r103", "Ines Duarte", BD, SECOND_NIGHT)])
    assert f.client("desk").post(f"/api/stays/{f.stay_id('off')}/cancel").json()["folios"][0]["entries"], "a late fee posts"
    f.clock(BD_OPEN)
    assert f.close(BD).status_code == 200
    closed = f.client("owner").get("/api/reports", params={"from": BD, "to": BD}).json()
    assert (closed["roomsAvailable"], closed["roomsSold"], closed["roomRevenueCents"]) == (4, 1, 15000)
    assert closed["occupancy"] == occupancy(1, 4)
    assert f.client("owner").post(f"/api/rooms/{f.room('r104')}/status", json={"status": "out_of_order"}).status_code == 200
    fixed = f.client("owner").get("/api/reports", params={"from": BD, "to": SECOND_NIGHT}).json()["nights"]
    assert [n["roomsAvailable"] for n in fixed] == [4, 3], "a closed night keeps its count; an open night uses now"


def test_wf_reports_live_reduced_live_update(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    with staff(browser, h, "owner", "/reports", reduced="reduce") as page, staff(browser, h, "desk") as clerk:
        navigations = requests_to(page, "GET", r"/reports$")
        expect(status(page, "Rooms sold")).to_have_text("1")
        first_night_total = h.stay("s1")["nightly"][0]["totalCents"]
        panel = open_stay(clerk, "Ana Vale", "101", BD, MON)
        click(button(panel, "Cancel stay"))
        advance(clerk, PANEL_SETTLE_MS)
        confirm = clerk.get_by_role("alertdialog", name="Cancel stay", exact=True)
        click(button(confirm, "Confirm cancellation"))
        expect(status(clerk, "Desk notices")).to_have_text(
            f"Cancelled Ana Vale's stay. Fee: {money(first_night_total)}.")
        expect(status(page, "Rooms sold")).to_have_text("0", timeout=LIVE_WAIT_MS)
        expect(status(page, "Room revenue")).to_have_text("$0.00", timeout=LIVE_WAIT_MS)
        expect(status(page, "Occupancy")).to_have_text("0.0%", timeout=LIVE_WAIT_MS)
        expect(status(page, "Average daily rate")).to_have_text("—", timeout=LIVE_WAIT_MS)
        expect(status(page, "Revenue per available room")).to_have_text("$0.00", timeout=LIVE_WAIT_MS)
        assert [r for r in navigations if r.is_navigation_request()] == [], "the figures change without a reload"
    report = h.client("owner").get("/api/reports", params={"from": BD, "to": BD}).json()
    assert report["roomsSold"] == 0 and report["roomRevenueCents"] == 0


def test_wf_reports_live_reduced_close(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    total = h.stay("s1")["nightly"][0]["totalCents"]
    with staff(browser, h, "owner", reduced="reduce") as page:
        rail = page.get_by_role("region", name="Tally rail", exact=True)
        page.evaluate(SWEEP_JS, [rail.element_handle(), status(page, "Tally room revenue").element_handle()])
        click(button(page, "Run close"))
        expect(status(page, "Close status")).to_have_text(closed_notice(BD, 1, 0))
        expect(status(page, "Business date")).to_have_text(SECOND_NIGHT)
        expect(cell(page, h.room("r101"), BD)).to_have_attribute("data-stamp", money(total))
        expect(cell(page, h.room("r102"), BD)).to_have_attribute("data-stamp", "tick")
        results = page.get_by_role("table", name="Close results", exact=True)
        expect(results).to_be_visible()
        assert table_rows(results) == [["101", money(total)]]
        committed = h.client("owner").get("/api/desk").json()["lastClose"]["figures"]
        expect(status(page, "Tally room revenue")).to_have_text(money(committed["roomRevenueCents"]))
        expect(status(page, "Tally date")).to_have_text(f"Last closed night {BD}")
        log = page.evaluate("() => window.__sweep")
        assert log["phases"] == ["idle"], f"reduced motion keeps data-close-phase idle: {log['phases']}"
        assert log["grounds"] == ["day"], f"reduced motion keeps data-ground day: {log['grounds']}"
        assert log["busy"] == 0, "reduced motion has no count"
        assert len({v for v in log["revenue"] if v.startswith("$")}) == 1, f"no count: {log['revenue']}"


def test_wf_cross_cutting_signin_routes(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url)
    with open_app(browser, f"{app_url}/desk") as page:
        expect(page).to_have_url(re.compile(r"/$"))
        email, password = h.users["desk"]
        fill(textbox(page, "Email"), email)
        fill(textbox(page, "Password"), "wrong-password")
        click(button(page, "Sign in"))
        expect(status(page, "Sign-in status")).to_have_text("That email or password is not right.")
        fill(textbox(page, "Password"), password)
        click(button(page, "Sign in"))
        expect(page).to_have_url(re.compile(r"/desk$"))
        nav = page.get_by_role("navigation", name="Main", exact=True)
        for name in ("Desk", "Guests", "Board"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
        for name in ("Rates", "Reports"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_have_count(0)
        expect(button(page, "Run close")).to_have_count(0)
        for path in ("/rates", "/reports"):
            page.goto(f"{app_url}{path}")
            expect(page.get_by_text("Page not found.", exact=True)).to_be_visible()
        page.goto(f"{app_url}/")
        expect(page).to_have_url(re.compile(r"/desk$"))
        with page.expect_response(lambda r: r.url.endswith("/api/session") and r.request.method == "DELETE"):
            click(button(page, "Sign out"))
        assert page.context.request.get(f"{app_url}/api/session").status == 401
        for path in ("/board", "/guests", "/rates", "/reports"):
            goto_after_sign_out(page, f"{app_url}{path}")
            expect(page).to_have_url(re.compile(r"/$"))
            expect(textbox(page, "Email")).to_be_visible()
    with staff(browser, h, "owner", "/") as page:
        expect(page).to_have_url(re.compile(r"/desk$"))
        nav = page.get_by_role("navigation", name="Main", exact=True)
        for name in ("Desk", "Guests", "Rates", "Reports", "Board"):
            expect(nav.get_by_role("link", name=name, exact=True)).to_be_visible()
        expect(button(page, "Run close")).to_be_visible()
    with staff(browser, h, "hk", "/") as page:
        expect(page).to_have_url(re.compile(r"/board$"))


def test_role_and_hotel_isolation(app_url: str) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, second=True,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")],
                   folios=[minibar_folio("s1", "Ana Vale", fresh_email("payer"), paid=True)])
    anonymous = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    stay_id = h.stay_id("s1")
    for method, path in [("GET", "/api/session"), ("GET", "/api/desk"), ("GET", f"/api/stays/{stay_id}"),
                         ("GET", "/api/live"), ("GET", "/api/housekeeping/board"), ("POST", "/api/close")]:
        err(anonymous.request(method, path, json={} if method == "POST" else None), 401, "Please sign in.")
    login = httpx.post(f"{app_url}/api/session", json={"email": h.users["desk"][0], "password": h.users["desk"][1]},
                       timeout=HTTP_TIMEOUT)
    assert login.status_code == 200
    assert set(login.json()["user"]) == {"id", "email", "name", "role", "hotelId"}
    assert login.json()["user"]["role"] == "front_desk" and login.json()["user"]["hotelId"] == h.id
    cookie = login.headers["set-cookie"].lower().replace("-", "")
    assert HTTP_ONLY.lower().replace("-", "") in cookie and SAME_SITE.lower() in cookie
    err(httpx.post(f"{app_url}/api/session", json={"email": h.users["desk"][0], "password": "nope"},
                   timeout=HTTP_TIMEOUT), 401, "That email or password is not right.")
    desk = h.client("desk")
    for method, path in [("POST", "/api/close"), ("GET", f"/api/reports?from={BD}&to={BD}"),
                         ("PATCH", f"/api/rate-plans/{h.plan()}"), ("POST", "/api/tax-rates")]:
        err(desk.request(method, path, json={} if method != "GET" else None), 404, "Not found.")
    other = h.data["secondHotel"]
    outsider = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    second = h.second_owner
    assert outsider.post("/api/session", json={"email": second["email"], "password": second["password"]}).status_code == 200
    folio = h.folio_id("f1")
    closed = desk.post(f"/api/folios/{folio}/close")
    invoice = closed.json()["invoice"]["id"]
    for method, path in [("GET", f"/api/stays/{stay_id}"), ("POST", f"/api/stays/{stay_id}/cancel"),
                         ("POST", f"/api/rooms/{h.room('r101')}/status"), ("PATCH", f"/api/folios/{folio}"),
                         ("POST", f"/api/folios/{folio}/charges"), ("POST", f"/api/entries/{h.entry_id('e1')}/reverse"),
                         ("GET", f"/api/invoices/{invoice}/pdf"), ("POST", f"/api/invoices/{invoice}/email"),
                         ("GET", f"/api/guests/{h.guest_id(h.guest_keys['s1'])}"),
                         ("PATCH", f"/api/rate-plans/{h.plan()}")]:
        err(outsider.request(method, path, json={} if method != "GET" else None), 404, "Not found.")
    err(desk.post(f"/api/rooms/{other['rooms']['r1']}/status", json={"status": "bogus"}), 404, "Not found.")
    assert "Ana Vale" not in outsider.get("/api/guests").text
    assert outsider.get("/api/desk").json()["hotel"]["id"] == other["hotelId"]
    err(outsider.post(f"/api/stays/{stay_id}/move", json={}), 404, "Not found.")
    assert desk.delete("/api/session").status_code == 204
    err(desk.get("/api/session"), 401, "Please sign in.")


def test_grading_setup_and_clock(app_url: str, mail: Any) -> None:
    good = {"hotel": {"name": f"Test Inn {uuid.uuid4().hex[:8]}"}}
    for wrong in ("wrong-key", None):
        err(grading(app_url, "/api/grading/setup", good, wrong), 404, "Not found.")
        err(grading(app_url, "/api/grading/clock", {"hotelId": "x", "now": None}, wrong), 404, "Not found.")
    assert grading(app_url, "/api/grading/clock", {"hotelId": uuid.uuid4().hex, "now": None}).status_code == 404
    owner_email = fresh_email("owner")
    made = grading(app_url, "/api/grading/setup", {
        "hotel": {"name": good["hotel"]["name"], "now": "2027-03-06T02:30:00-06:00"},
        "users": [{"key": "owner", "email": owner_email, "password": "pass-owner-1", "name": "Olu Bright", "role": "owner"}],
        "rooms": [{"key": "r101", "number": "101", "type": "Queen"}]})
    assert made.status_code == 201, made.text
    data = made.json()
    assert isinstance(data["hotelId"], str) and isinstance(data["rooms"]["r101"], str)
    client = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert client.post("/api/session", json={"email": owner_email, "password": "pass-owner-1"}).status_code == 200
    desk = client.get("/api/desk").json()
    assert desk["hotel"]["businessDate"] == BD, "02:30 on 2027-03-06 belongs to the night of 2027-03-05 (L412)"
    assert desk["hotel"]["timeZone"] == "America/Chicago" and desk["lastClose"] is None
    plans = {p["name"]: (p["weeknightCents"], p["weekendCents"]) for p in client.get("/api/rate-plans").json()["ratePlans"]}
    assert plans == {"Flexible": (12000, 15000), "Corporate": (12040, 12040)}
    rates = client.get("/api/tax-rates").json()["taxRates"]
    assert len(rates) == 1 and Decimal(str(rates[0]["percent"])) == Decimal("8.75") and rates[0]["startDate"] is None
    assert client.get("/api/housekeeping/board").json()["rooms"][0]["status"] == "clean"
    at_four = grading(app_url, "/api/grading/setup", {"hotel": {"name": f"Test Inn {uuid.uuid4().hex[:8]}",
                                                                "now": "2027-03-06T04:00:00-06:00"},
                                                      "users": [{"key": "owner", "email": (four := fresh_email("owner")),
                                                                 "password": "pass-owner-1", "name": "Olu Bright", "role": "owner"}]})
    assert at_four.status_code == 201
    other = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT)
    assert other.post("/api/session", json={"email": four, "password": "pass-owner-1"}).status_code == 200
    assert other.get("/api/desk").json()["hotel"]["businessDate"] == SECOND_NIGHT

    refused = {"hotel": {"name": "Test Inn"}, "rooms": [{"key": "r1", "number": "1", "type": "Queen"}],
               "stays": [{"key": "s1", "room": "missing", "guest": "nobody", "ratePlan": "flex",
                          "arrival": BD, "departure": MON, "guests": 1}]}
    answer = grading(app_url, "/api/grading/setup", refused)
    assert answer.status_code == 422 and "setup" in answer.json()["errors"]
    guest = {"key": "g", "name": "Ana Vale", "email": fresh_email("guest"), "phone": "", "company": "", "address": ""}
    overlap = {"hotel": {"name": "Test Inn", "businessDate": BD, "now": NOON},
               "rooms": [{"key": "r1", "number": "1", "type": "Queen"}], "ratePlans": default_plans(), "guests": [guest],
               "stays": [{"key": k, "room": "r1", "guest": "g", "ratePlan": "flex", "arrival": BD, "departure": MON,
                          "guests": 1} for k in ("s1", "s2")]}
    answer = grading(app_url, "/api/grading/setup", overlap)
    assert answer.status_code == 422 and "setup" in answer.json()["errors"]

    arrival, departure = "2027-03-11", "2027-03-14"
    one = make_hotel(app_url, rooms={"101": "clean"}, business_date="2027-03-10", now="2027-03-10T17:59:59-06:00",
                     stays=[st("s1", "r101", "Ana Vale", arrival, departure, link=True),])
    two = make_hotel(app_url, rooms={"101": "clean"}, business_date="2027-03-10", now="2027-03-10T17:59:59-06:00",
                     stays=[st("s1", "r101", "Ana Vale", arrival, departure)])
    answer = grading(app_url, "/api/grading/clock", {"hotelId": two.id, "now": "2027-03-10T18:00:00-06:00"})
    assert answer.status_code == 200 and answer.json()["hotelId"] == two.id and answer.json()["now"]
    assert one.stay("s1")["cancellation"]["state"] == "free" and two.stay("s1")["cancellation"]["state"] == "late"
    assert len(mail_to(mail, one.emails["s1"], 1)) == 1, "checkinLink true emails the link"
    assert not [m for m in mail.messages() if two.emails["s1"] in [a.lower() for a in addresses(m.get("To"))]]
    back = grading(app_url, "/api/grading/clock", {"hotelId": two.id, "now": None})
    assert back.status_code == 200 and back.json()["now"] is None


def test_health_boot_and_per_call_provider(app_url: str) -> None:
    assert httpx.get(f"{app_url}/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"}
    for name in ("APP_GOTENBERG_DOWN_URL", "APP_MINIO_DOWN_URL", "APP_MAILPIT_DOWN_URL"):
        answer = httpx.get(f"{os.environ[name]}/api/health", timeout=HTTP_TIMEOUT)
        assert answer.status_code == 200 and answer.json() == {"status": "unavailable"}, name
    h, folios, _ = paid_hotel(app_url, 1)
    port = free_port()
    with app_copy({"GOTENBERG_URL": f"http://127.0.0.1:{port}", "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}) as base:
        health = httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT)
        assert health.status_code == 200 and health.json() == {"status": "unavailable"}
        err(h.client("desk", base).post(f"/api/folios/{folios[0]}/close"), 503,
            "The invoice could not be created. The PDF service is unavailable. Nothing was saved.")
        StubGotenberg.calls = []
        server = HTTPServer(("127.0.0.1", port), StubGotenberg)
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            recovered = h.client("desk", base).post(f"/api/folios/{folios[0]}/close")
            assert recovered.status_code == 200, f"no recovery without restart: {recovered.text}"
            assert recovered.json()["invoice"]["number"] == invoice_number(1)
            renders = [c for c in StubGotenberg.calls if c[0] == "/forms/chromium/convert/html"]
            assert renders and b"index.html" in renders[0][1], "the render goes to the published Gotenberg route"
        finally:
            server.shutdown()
            server.socket.shutdown(socket.SHUT_RDWR)
            server.server_close()


VIEW_IDS = ["desktop", "tablet", "phone"]


@pytest.mark.parametrize("view", [DESKTOP, TABLET, PHONE], ids=VIEW_IDS)
def test_wf_cross_cutting_layouts(app_url: str, browser: Browser, view: dict[str, int]) -> None:
    rooms = {str(101 + i): "clean" for i in range(6)}
    h = make_hotel(app_url, rooms=rooms, stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house"),
                                                st("s2", "r102", "Mara Okafor", BD, MON)])
    width, height = view["width"], view["height"]
    with staff(browser, h, "owner", viewport=view) as page:
        expect(status(page, "Business date")).to_have_text(BD)
        layout(page)
        rail = page.get_by_role("region", name="Tally rail", exact=True)
        notices = status(page, "Desk notices").bounding_box()
        closing = status(page, "Close status").bounding_box()
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            assert not page.evaluate(
                "() => { const e = document.activeElement; const r = e.getBoundingClientRect();"
                " return e !== document.body && r.width === 0 && r.height === 0; }"), "Tab reached a hidden control (L197)"
            assert page.evaluate("() => document.activeElement.innerText !== 'Confirm cancellation'")
        if view is PHONE:
            expect(grid(page)).to_have_count(0)
            rooms_list = page.get_by_role("list", name="Today's rooms", exact=True)
            items = rooms_list.get_by_role("listitem")
            expect(items).to_have_count(6)
            numbers = [re.search(r"\d{3}", items.nth(i).inner_text()).group(0) for i in range(6)]
            assert numbers == sorted(rooms), "phone rooms are in room-number order"
            assert rail.bounding_box()["y"] >= rooms_list.bounding_box()["y"] + rooms_list.bounding_box()["height"] - GEOM_TOL
            for control in (button(page, "Open stay Ana Vale"), button(page, "Check in Mara Okafor"),
                            button(page, "Check out Ana Vale")):
                size = control.bounding_box()
                assert size["width"] >= MIN_TARGET_PX and size["height"] >= MIN_TARGET_PX
            tap(button(page, "Open stay Ana Vale"))
            advance(page, PANEL_SETTLE_MS)
            panel = dialog(page, "Stay").bounding_box()
            assert panel["width"] >= width - GEOM_TOL and panel["height"] >= height - GEOM_TOL, "Stay fills the phone screen"
        else:
            assert abs(notices["y"] - closing["y"]) <= notices["height"], "the live regions share one line (L107)"
            timeline = grid(page).evaluate(
                """g => { let e = g;
                    while (e && e !== document.body) {
                        const o = getComputedStyle(e).overflowX;
                        if (e.scrollWidth > e.clientWidth + 1 && (o === 'auto' || o === 'scroll')) break;
                        e = e.parentElement;
                    }
                    if (!e || e === document.body) e = g;
                    const r = e.getBoundingClientRect();
                    return {x: r.x, y: r.y, width: r.width, height: r.height}; }""")
            assert rail.bounding_box()["width"] >= width - 2 * GEOM_TOL - 16, "the rail runs the full width"
            assert rail.bounding_box()["y"] + rail.bounding_box()["height"] <= height + GEOM_TOL, "the rail is inside the viewport"
            today = page.get_by_role("complementary", name="Today", exact=True)
            if view is DESKTOP:
                side = today.bounding_box()
                assert side["x"] >= timeline["x"] + timeline["width"] - GEOM_TOL, "Today sits right of the timeline"
                assert timeline["width"] > 2 * side["width"], "the timeline takes about three quarters of the width"
                expect(button(page, "Today")).to_have_count(0)
            else:
                expect(today).to_be_hidden()
                assert timeline["width"] >= width - 2 * GEOM_TOL - 32, "the timeline takes the full width at 768"
                click(button(page, "Today"))
                advance(page, PANEL_SETTLE_MS)
                expect(today).to_be_visible()
                side = today.bounding_box()
                assert side["x"] > 0 and side["x"] + side["width"] >= width - GEOM_TOL - 16, "Today is a right-hand overlay"
                page.keyboard.press("Escape")
                advance(page, PANEL_SETTLE_MS)
                if today.is_visible():
                    click(button(page, "Today"))
                    advance(page, PANEL_SETTLE_MS)
            panel_box = open_stay(page, "Ana Vale", "101", BD, MON).bounding_box()
            assert panel_box["x"] + panel_box["width"] >= width - GEOM_TOL - 16
            if view is TABLET:
                assert panel_box["x"] >= width / 2 - GEOM_TOL, "Stay docks over the right half at 768"
        layout(page)
        for path, form, table in [("/guests", page.get_by_role("searchbox", name="Search guests", exact=True),
                                   page.get_by_role("table", name="Guests", exact=True)),
                                  ("/rates", textbox(page, "Tax rate percent"), page.get_by_role("table", name="Tax rates", exact=True)),
                                  ("/reports", textbox(page, "From"), page.get_by_role("table", name="Nightly figures", exact=True))]:
            visit(page, app_url, path)
            expect(form).to_be_visible()
            expect(table).to_be_visible()
            layout(page)
            left, right = form.bounding_box(), table.bounding_box()
            if view is DESKTOP:
                assert left["x"] + left["width"] <= right["x"] + GEOM_TOL, f"{path}: form left of the table at 1280"
            else:
                assert right["y"] >= left["y"] + left["height"] - GEOM_TOL, f"{path}: one column at this size"
    with staff(browser, h, "hk", "/board", viewport=view) as page:
        board = page.get_by_role("region", name="Room board", exact=True)
        expect(board).to_be_visible()
        layout(page)
        lefts = {round(board.get_by_role("group", name=f"Room {n}", exact=True).bounding_box()["x"]) for n in rooms}
        expected_columns = {"1280": 3, "768": 2, "375": 1}[str(width)]
        assert len(lefts) == expected_columns, f"{len(lefts)} board columns at {width} (L128)"
        for n in rooms:
            for name in (f"Room {n} clean", f"Room {n} dirty"):
                size = button(board, name).bounding_box()
                assert size["width"] >= MIN_TARGET_PX and size["height"] >= MIN_TARGET_PX
        tops = [status(page, "Board status").bounding_box()["y"], board.bounding_box()["y"],
                page.get_by_role("list", name="Today's stays", exact=True).bounding_box()["y"]]
        assert tops == sorted(tops)


def test_server_boundary(app_url: str, browser: Browser) -> None:
    h, folios, _ = paid_hotel(app_url, 1)
    email, password = h.users["desk"]
    login = {"email": email, "password": password}
    err(httpx.post(f"{app_url}/api/session", json=login, headers={"Origin": "http://elsewhere.example"},
                   timeout=HTTP_TIMEOUT), 404, "Not found.")
    same = httpx.post(f"{app_url}/api/session", json=login, headers={"Origin": app_url}, timeout=HTTP_TIMEOUT)
    assert same.status_code == 200
    assert not cross_origin_read_allowed(browser, f"{app_url}/api/health"), "the app grants cross-origin reads (L626)"
    err(httpx.post(f"{app_url}/api/session", content="email", headers={"Content-Type": "text/plain"},
                   timeout=HTTP_TIMEOUT), 415, "Send JSON.")
    shell = b'{"email":"a@test.example","password":""}'

    def padded(size: int) -> bytes:
        return shell[:-2] + b"x" * (size - len(shell)) + b'"}'

    at_limit = httpx.post(f"{app_url}/api/session", content=padded(JSON_LIMIT),
                          headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT)
    assert at_limit.status_code == 401, f"the limit itself is allowed: {at_limit.status_code}"
    err(httpx.post(f"{app_url}/api/session", content=padded(JSON_LIMIT + 1),
                   headers={"Content-Type": "application/json"}, timeout=HTTP_TIMEOUT), 413, "That request is too large.")
    for path in ("/package.json", "/package-lock.json", "/.env", "/run.json", "/tsconfig.json", "/.git/config",
                 "/src/server.ts", "/node_modules/pg/package.json", "/../package.json"):
        assert httpx.get(f"{app_url}{path}", timeout=HTTP_TIMEOUT).status_code == 404, path
    secrets = [os.environ[n] for n in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY") if os.environ.get(n)] + [GRADING_KEY]
    with staff(browser, h, "owner") as page:
        served: list[Any] = []
        page.on("response", lambda r: served.append(r) if "/api/live" not in r.url else None)
        visit(page, app_url, "/desk")
        expect(status(page, "Business date")).to_have_text(BD)
        for response in served:
            content = ""
            with contextlib.suppress(Exception):
                content = response.text()
            assert not any(s in content for s in secrets), f"a credential was served by {response.url}"
    closed = h.client("desk").post(f"/api/folios/{folios[0]}/close")
    invoice = closed.json()["invoice"]
    assert same_origin(str(httpx.URL(app_url).join(invoice["pdfUrl"])), app_url), invoice["pdfUrl"]
    got = h.client("desk").get(f"/api/invoices/{invoice['id']}/pdf")
    assert got.status_code == 200 and not got.is_redirect and got.content.startswith(b"%PDF")
    err(httpx.get(f"{app_url}/api/invoices/{invoice['id']}/pdf", timeout=HTTP_TIMEOUT), 401, "Please sign in.")
    if os.environ.get("S3_ENDPOINT") and os.environ.get("S3_BUCKET"):
        anonymous = httpx.get(f"{os.environ['S3_ENDPOINT']}/{os.environ['S3_BUCKET']}/invoices/{h.id}/{invoice['number']}.pdf",
                              timeout=HTTP_TIMEOUT)
        assert anonymous.status_code != 200, "the bucket's objects must not be readable without credentials"


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k] for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = [p.name for p in shipped_packages() if p.name not in notices]
    assert not missing, f"not in THIRD_PARTY_NOTICES.md: {missing}"


def test_if_licences_allowed() -> None:
    refused = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not refused, f"licences outside the allowlist: {refused}"


def test_if_no_extra_datastore() -> None:
    others = {"redis", "ioredis", "mongodb", "mongoose", "mysql", "mysql2", "sqlite3", "better-sqlite3", "amqplib",
              "kafkajs", "nats", "memcached"}
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & others, f"other datastore or broker clients shipped: {shipped & others}"


def test_if_no_cross_origin_assets(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    with staff(browser, h, "owner", "/") as page:
        loaded: list[Any] = []
        page.on("request", lambda request: loaded.append(request))
        for path in ("/desk", "/board", "/guests", "/rates", "/reports"):
            visit(page, app_url, path)
            expect(page.get_by_role("navigation", name="Main", exact=True)).to_be_visible()
        foreign = [r.url for r in loaded if r.url.startswith("http") and not same_origin(r.url, app_url)]
        assert not foreign, f"loaded from another origin: {foreign}"
        fonts = [r.url for r in loaded if r.resource_type == "font"]
        assert not fonts, f"font files loaded: {fonts}"


def test_if_no_credentials_in_source() -> None:
    assert os.environ.get("MAIL_FROM", "Nightroll Desk <desk@nightroll.example>") == "Nightroll Desk <desk@nightroll.example>"
    assert os.environ.get("GRADING_KEY", GRADING_KEY) == GRADING_KEY
    secrets = [os.environ[n] for n in ("DATABASE_URL", "S3_SECRET_ACCESS_KEY") if os.environ.get(n)]
    skipped = {"node_modules", "dist", "build", ".git"}
    for path in Path("/app").rglob("*"):
        if path.suffix in {".ts", ".tsx", ".js", ".mjs", ".cjs"} and path.is_file() and not skipped & set(path.parts):
            content = path.read_text(errors="ignore")
            assert not any(s in content for s in secrets), f"a supplied credential is hard-coded in {path}"


LAUNDRY = "Laundry"
NO_LOOPS_JS = """() => document.getAnimations().filter(a => {
  const timing = a.effect && a.effect.getTiming();
  return timing && timing.iterations === Infinity;
}).length"""


def assert_no_loops(page: Page) -> None:
    assert page.evaluate(NO_LOOPS_JS) == 0, "under reduced motion every loop stops (L234)"


def open_stay_by_keyboard(page: Page, h: Hotel, room_key: str, night: str) -> Locator:
    go_to(page, h, room_key, night)
    key(page, "Enter")
    advance(page, PANEL_SETTLE_MS)
    panel = dialog(page, "Stay")
    expect(panel).to_be_visible()
    return panel


def press_control(page: Page, target: Locator) -> None:
    tab_to(page, target)
    page.keyboard.press("Enter")


def test_wf_stay_create_keyboard_empty_cell_reduced(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=MON, now=MON_NOON)
    with staff(browser, h, reduced="reduce") as page:
        go_to(page, h, "r102", MON)
        key(page, "Enter")
        box = dialog(page, "New stay")
        expect(box).to_be_visible()
        page.keyboard.press("Escape")
        expect(box).to_be_hidden()
        key(page, "n")
        expect(box).to_be_visible()
        expect(textbox(box, "Arrival")).to_have_value(MON)
        assert selected_text(combo(box, "Room")) == "102", "N fills in the current cell's room (L190)"
        assert_tab_wraps(page, box)
        page.keyboard.press("Escape")
        expect(box).to_be_hidden()
        where = page.evaluate(CURRENT_JS)
        assert where and where["room"] == h.room("r102"), "focus returns to the opening cell (L197)"
        key(page, "m")
        expect(status(page, "Desk notices")).to_have_text("No stay here.")


def test_wf_last_room_race_keyboard_loser(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"})
    lost = fresh_email("guest")
    with staff(browser, h) as page:
        button(page, "Next nights").focus()
        key(page, "n")
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "New stay")
        expect(box).to_be_visible()
        type_in(page, textbox(box, "Guest name"), "Mara Okafor")
        type_in(page, textbox(box, "Guest email"), lost)
        type_in(page, textbox(box, "Guest phone"), "+1 555 0100")
        type_in(page, textbox(box, "Arrival"), BD)
        type_in(page, textbox(box, "Departure"), day(BD, 1))
        choose_by_keyboard(page, combo(box, "Room"), "101")
        choose_by_keyboard(page, combo(box, "Rate plan"), "Flexible")
        taken = post_stay(h.client("desk2"), create_body(h, "r101", BD, day(BD, 1)))
        assert taken.status_code == 201, taken.text
        expect(status(page, "Free rooms")).to_have_text(free_rooms(0), timeout=LIVE_WAIT_MS)
        press_control(page, button(box, "Create stay"))
        expect(status(page, "Desk notices")).to_have_text(just_taken("101"))
    blocks = h.client("desk").get("/api/timeline", params={"from": BD, "to": day(BD, 1)}).json()["blocks"]
    assert [b["guestName"] for b in blocks] == ["Ana Vale"]
    assert not [m for m in mail.messages() if lost in [a.lower() for a in addresses(m.get("To"))]]


def test_wf_last_room_race_reduced_motion(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"})
    with staff(browser, h, "desk", reduced="reduce") as winner, staff(browser, h, "desk2", reduced="reduce") as loser:
        click(button(winner, "New stay"))
        win_box = dialog(winner, "New stay")
        expect(win_box).to_be_visible()
        fill_new_stay(win_box, "Ana Vale", fresh_email("guest"), BD, day(BD, 1), "101")
        click(button(loser, "New stay"))
        lose_box = dialog(loser, "New stay")
        expect(lose_box).to_be_visible()
        fill_new_stay(lose_box, "Mara Okafor", fresh_email("guest"), BD, day(BD, 1), "101")
        with held(loser, "**/api/stays") as release:
            click(button(lose_box, "Create stay"))
            click(button(win_box, "Create stay"))
            expect(status(winner, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.")
            expect(status(loser, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.",
                                                               timeout=LIVE_WAIT_MS)
            release()
            expect(status(loser, "Desk notices")).to_have_text(just_taken("101"), timeout=LIVE_WAIT_MS)
        expect(loser.locator("[data-stay-id]")).to_have_count(1, timeout=LIVE_WAIT_MS)
        assert_no_loops(loser)


def test_wf_dirty_room_checkin_phone_marks_dirty(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    with staff(browser, h, "desk") as desk_page, staff(browser, h, "hk", "/board", viewport=PHONE) as phone:
        board = phone.get_by_role("region", name="Room board", exact=True)
        tap(button(board, "Room 101 dirty"))
        expect(status(phone, "Board status")).to_have_text("Room 101 is now dirty.")
        expect(status(desk_page, "Desk notices")).to_have_text("Room 101 is now dirty.", timeout=LIVE_WAIT_MS)
        expect(button(desk_page, "Room 101 status: dirty")).to_be_visible(timeout=LIVE_WAIT_MS)
        go_to(desk_page, h, "r101", BD)
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text(no_check_in("101", "dirty"))
        assert h.stay("s1")["status"] == "booked"
        tap(button(board, "Room 101 clean"))
        expect(status(desk_page, "Desk notices")).to_have_text("Room 101 is now clean.", timeout=LIVE_WAIT_MS)
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text("Checked in Ana Vale to room 101.")
    assert h.stay("s1")["status"] == "in_house"


def test_wf_dirty_room_checkin_reduced_motion(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    with staff(browser, h, "desk", reduced="reduce") as desk_page, staff(
            browser, h, "hk", "/board", viewport=PHONE, reduced="reduce") as phone:
        board = phone.get_by_role("region", name="Room board", exact=True)
        tap(button(board, "Room 101 clean"))
        expect(button(desk_page, "Room 101 status: clean")).to_be_visible(timeout=LIVE_WAIT_MS)
        answer = h.client("owner").post(f"/api/rooms/{h.room('r101')}/status", json={"status": "inspected"})
        assert answer.status_code == 200, answer.text
        expect(button(desk_page, "Room 101 status: inspected")).to_be_visible(timeout=LIVE_WAIT_MS)
        expect(board.get_by_role("group", name="Room 101", exact=True)).to_have_attribute(
            "data-status", "inspected", timeout=LIVE_WAIT_MS)
        go_to(desk_page, h, "r101", BD)
        button(desk_page, "Room 101 status: inspected").focus()
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text("Checked in Ana Vale to room 101.")
        assert_no_loops(desk_page)
        assert_no_loops(phone)
    assert h.stay("s1")["status"] == "in_house"


def test_wf_dirty_room_checkin_out_of_order(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "out_of_order", "102": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    with staff(browser, h, "desk") as desk_page, staff(browser, h, "hk", "/board", viewport=PHONE) as phone:
        board = phone.get_by_role("region", name="Room board", exact=True)
        go_to(desk_page, h, "r101", BD)
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text(no_check_in("101", "out of order"))
        tap(button(board, "Room 101 clean"))
        expect(status(phone, "Board status")).to_have_text("That room status change is not allowed.")
        answer = h.client("owner").post(f"/api/rooms/{h.room('r101')}/status", json={"status": "dirty"})
        assert answer.status_code == 200, answer.text
        expect(board.get_by_role("group", name="Room 101", exact=True)).to_have_attribute(
            "data-status", "dirty", timeout=LIVE_WAIT_MS)
        tap(button(board, "Room 101 clean"))
        expect(status(desk_page, "Desk notices")).to_have_text("Room 101 is now clean.", timeout=LIVE_WAIT_MS)
        key(desk_page, "i")
        expect(status(desk_page, "Desk notices")).to_have_text("Checked in Ana Vale to room 101.")


def test_wf_housekeeping_phone_live_from_desk(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"})
    with staff(browser, h, "hk", "/board", viewport=PHONE) as page:
        board = page.get_by_role("region", name="Room board", exact=True)
        answer = h.client("desk").post(f"/api/rooms/{h.room('r101')}/status", json={"status": "clean"})
        assert answer.status_code == 200, answer.text
        group = board.get_by_role("group", name="Room 101", exact=True)
        expect(group).to_have_attribute("data-status", "clean", timeout=LIVE_WAIT_MS)
        expect(button(board, "Room 101 clean")).to_have_attribute("aria-pressed", "true")
        created = post_stay(h.client("desk"), create_body(h, "r102", BD, MON, name="Ana Vale"))
        assert created.status_code == 201, created.text
        items = page.get_by_role("list", name="Today's stays", exact=True).get_by_role("listitem")
        expect(items).to_have_text([f"Room 102: {BD} to {MON}"], timeout=LIVE_WAIT_MS)
        assert "Ana Vale" not in page_text(page), "a housekeeper never sees a guest's name (L514)"
        tap(button(board, "Room 101 dirty"))
        expect(status(page, "Board status")).to_have_text("Room 101 is now dirty.")
    assert h.board_status("r101") == "dirty"


def test_wf_housekeeping_phone_reduced_motion(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"})
    with staff(browser, h, "hk", "/board", viewport=PHONE, reduced="reduce") as page:
        board = page.get_by_role("region", name="Room board", exact=True)
        with held(page, f"**/api/rooms/{h.room('r101')}/status") as release:
            tap(button(board, "Room 101 clean"))
            expect(status(page, "Board status")).to_have_text("Saving status…")
            assert_no_loops(page)
            release()
            expect(status(page, "Board status")).to_have_text("Room 101 is now clean.")
        expect(board.get_by_role("group", name="Room 101", exact=True)).to_have_attribute("data-status", "clean")
        assert_no_loops(page)
    assert h.board_status("r101") == "clean"


def test_wf_housekeeping_phone_wider_layouts(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "dirty", "103": "clean", "104": "clean"})
    with staff(browser, h, "hk", "/board", viewport=TABLET) as page:
        board = page.get_by_role("region", name="Room board", exact=True)
        for size, columns, number in ((TABLET, 2, "101"), (DESKTOP, 3, "102")):
            page.set_viewport_size(size)
            expect(board).to_be_visible()
            layout(page)
            lefts = {round(board.get_by_role("group", name=f"Room {n}", exact=True).bounding_box()["x"])
                     for n in ("101", "102", "103", "104")}
            assert len(lefts) == columns, f"{columns} columns at width {size['width']}: {sorted(lefts)} (L128)"
            tap(button(board, f"Room {number} clean"))
            expect(status(page, "Board status")).to_have_text(f"Room {number} is now clean.")


def test_wf_guest_online_checkin_keyboard(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    with open_app(browser, f"{app_url}/checkin/{token}") as guest:
        guest.set_viewport_size(PHONE)
        expect(guest.get_by_role("heading", name="Check in", exact=True)).to_be_visible()
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.jpg", "mimeType": "image/jpeg", "buffer": jpeg_bytes()})
        press_control(guest, button(guest, "Upload photo"))
        expect(status(guest, "Check-in status")).to_have_text("Received")
        type_in(guest, textbox(guest, "Full name"), "Ana Vale")
        type_in(guest, textbox(guest, "Phone"), "+1 555 0100")
        press_control(guest, button(guest, "Complete check-in"))
        expect(status(guest, "Check-in status")).to_have_text(f"Check-in complete. See you on {BD}.")
    stay = h.stay("s1")
    assert stay["checkedInOnline"] is True and stay["idPhoto"] == "received"
    link_dead(app_url, token)


def test_wf_guest_online_checkin_reduced_touch(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    with staff(browser, h, reduced="reduce") as desk_page, open_app(
            browser, f"{app_url}/checkin/{token}", reduced_motion="reduce") as guest:
        guest.set_viewport_size(PHONE)
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.png", "mimeType": "image/png", "buffer": png_bytes()})
        with held(guest, "**/api/checkin/*/photo") as release:
            tap(button(guest, "Upload photo"))
            expect(status(guest, "Check-in status")).to_have_text("Uploading photo…")
            assert h.stay("s1")["idPhoto"] == "none"
            assert_no_loops(guest)
            release()
            expect(status(guest, "Check-in status")).to_have_text("Received")
        fill(textbox(guest, "Full name"), "Ana Vale")
        tap(button(guest, "Complete check-in"))
        expect(status(guest, "Check-in status")).to_have_text(f"Check-in complete. See you on {BD}.")
        expect(status(desk_page, "Desk notices")).to_have_text("Room 101 guest completed online check-in.",
                                                               timeout=LIVE_WAIT_MS)
        expect(block(desk_page, h.stay_id("s1"))).to_have_attribute("data-checked-in-online", "true",
                                                                    timeout=LIVE_WAIT_MS)


def test_wf_end_of_day_close_no_show_keyboard(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house"), st("s2", "r102", "Mara Okafor", BD, MON)])
    total = h.stay("s1")["nightly"][0]["totalCents"]
    fee = h.stay("s2")["nightly"][0]["totalCents"]
    with staff(browser, h, "owner") as page, staff(browser, h, "desk") as other:
        press_control(page, button(page, "Run close"))
        expect(status(page, "Close status")).to_have_text(closed_notice(BD, 1, 1))
        expect(status(other, "Close status")).to_have_text(closed_notice(BD, 1, 1), timeout=LIVE_WAIT_MS)
        expect(block(other, h.stay_id("s2"))).to_have_attribute("data-status", "no_show", timeout=LIVE_WAIT_MS)
        visit(page, app_url, "/desk")
        expect(cell(page, h.room("r101"), BD)).to_have_attribute("data-stamp", money(total))
        expect(cell(page, h.room("r102"), BD)).to_have_attribute("data-stamp", "tick")
    assert [(e["description"], e["amountCents"]) for e in h.stay("s2")["folios"][0]["entries"]] == [("No-show fee", fee)]


def test_wf_cancel_deadline_guest_link_dies(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, now=NOON, stays=[st("s1", "r101", "Ana Vale", SECOND_NIGHT, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    with staff(browser, h, "desk") as page, staff(browser, h, "desk2") as other, open_app(
            browser, f"{app_url}/checkin/{token}") as guest:
        expect(guest.get_by_role("heading", name="Check in", exact=True)).to_be_visible()
        panel = open_stay(page, "Ana Vale", "101", SECOND_NIGHT, MON)
        expect(status(panel, "Cancellation terms")).to_have_text(f"Free cancellation until {BD} 18:00")
        press_control(page, button(panel, "Cancel stay"))
        advance(page, PANEL_SETTLE_MS)
        confirm = page.get_by_role("alertdialog", name="Cancel stay", exact=True)
        press_control(page, button(confirm, "Confirm cancellation"))
        notice = "Cancelled Ana Vale's stay. No fee."
        expect(status(page, "Desk notices")).to_have_text(notice)
        expect(status(other, "Desk notices")).to_have_text(notice, timeout=LIVE_WAIT_MS)
        answer = guest.reload()
        assert answer.status == 404, f"a dead link answers 404 on the page: {answer.status}"
        expect(guest.get_by_text("This check-in link is no longer valid.").first).to_be_visible()


def test_wf_cancel_deadline_crossed_while_open(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, now="2027-03-10T17:59:59-06:00", business_date="2027-03-10",
                   stays=[st("s1", "r101", "Ana Vale", "2027-03-11", "2027-03-14", guests=3)])
    with staff(browser, h, reduced="reduce") as page:
        click(stay_button(page, "Ana Vale", "101", "2027-03-11", "2027-03-14"))
        panel = dialog(page, "Stay")
        expect(status(panel, "Cancellation terms")).to_have_text("Free cancellation until 2027-03-10 18:00")
        h.clock("2027-03-10T18:00:00-06:00")
        click(button(panel, "Cancel stay"))
        confirm = page.get_by_role("alertdialog", name="Cancel stay", exact=True)
        expect(confirm).to_contain_text(f"Late cancellation fee: {money(15580)}")
        click(button(confirm, "Confirm cancellation"))
        expect(status(page, "Desk notices")).to_have_text(f"Cancelled Ana Vale's stay. Fee: {money(15580)}.")
        assert_no_loops(page)
    assert [e["amountCents"] for e in h.stay("s1")["folios"][0]["entries"]] == [15580]


def test_wf_cancel_deadline_stale_dialog_keyboard(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, now="2027-03-10T17:59:59-06:00", business_date="2027-03-10",
                   stays=[st("s1", "r101", "Ana Vale", "2027-03-11", "2027-03-14", guests=3)])
    with staff(browser, h) as page:
        panel = open_stay(page, "Ana Vale", "101", "2027-03-11", "2027-03-14")
        press_control(page, button(panel, "Cancel stay"))
        advance(page, PANEL_SETTLE_MS)
        confirm = page.get_by_role("alertdialog", name="Cancel stay", exact=True)
        expect(confirm).to_contain_text("Free cancellation until 2027-03-10 18:00")
        h.clock("2027-03-10T18:00:00-06:00")
        press_control(page, button(confirm, "Confirm cancellation"))
        notice = f"Cancelled Ana Vale's stay. Fee: {money(15580)}."
        late = confirm.filter(has_text=f"Late cancellation fee: {money(15580)}")
        expect(status(page, "Desk notices").filter(has_text=notice).or_(late).first).to_be_visible()
        if h.stay("s1")["status"] == "booked":
            press_control(page, button(confirm, "Confirm cancellation"))
        expect(status(page, "Desk notices")).to_have_text(notice)
    assert h.stay("s1")["status"] == "cancelled"


def test_wf_folio_split_keyboard_reverse_and_close(app_url: str, browser: Browser) -> None:
    payer = fresh_email("payer")
    folio = minibar_folio("s1", "Ana Vale", payer)
    folio["entries"].append({"key": "e2", "kind": "charge", "date": BD, "description": LAUNDRY, "amountCents": 500,
                             "roomNumber": "101"})
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")], folios=[folio])
    with staff(browser, h) as page:
        panel = open_stay_by_keyboard(page, h, "r101", BD)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        balance = status(region, "Folio A balance")
        expect(balance).to_have_text(money(3833))
        press_control(page, button(region, f"Reverse {LAUNDRY}"))
        expect(status(panel, "Folio status")).to_have_text("Reversal posted.")
        expect(balance).to_have_text(money(3333))
        press_control(page, button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text(f"This folio still has a balance of {money(3333)}.")
        opener = button(region, "Record payment")
        press_control(page, opener)
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Record payment")
        expect(box).to_be_visible()
        assert_tab_wraps(page, box)
        choose_by_keyboard(page, combo(box, "Payment method"), "Cash")
        type_in(page, textbox(box, "Amount"), dollars(3333))
        press_control(page, button(box, "Save payment"))
        expect(status(panel, "Folio status")).to_have_text(payment_recorded(3333))
        advance(page, PANEL_SETTLE_MS)
        expect(box).to_be_hidden()
        expect(opener).to_be_focused()
        expect(balance).to_have_text(money(0))
        press_control(page, button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text(f"Invoice {invoice_number(1)} issued.")
    stored = h.stay("s1")["folios"][0]
    assert stored["state"] == "closed" and stored["balanceCents"] == 0
    assert any(e["description"] == f"Reversal of {LAUNDRY}" and e["amountCents"] == -500 for e in stored["entries"])


def test_wf_folio_split_keyboard_reduced_motion(app_url: str, browser: Browser) -> None:
    h, _, _ = split_case(app_url, 1003)
    with staff(browser, h, reduced="reduce") as page:
        click(stay_button(page, "Ana Vale", "101", BD, MON))
        panel = dialog(page, "Stay")
        expect(panel).to_be_visible()
        click(button(panel, "Split Minibar"))
        box = dialog(page, "Split charge")
        expect(box).to_be_visible()
        click(button(box, "Add payer"))
        for letter, percent in (("A", "50"), ("B", "25"), ("C", "25")):
            fill(box.get_by_role("spinbutton", name=f"Folio {letter} percent", exact=True), percent)
        advance(page, BREAKDOWN_MS)
        preview = box.get_by_role("table", name="Split preview", exact=True)
        expect(preview.get_by_role("cell", name=money(250), exact=True)).to_have_count(1)
        assert table_rows(preview) == [["Folio A", "50%", money(502)], ["Folio B", "25%", money(251)],
                                       ["Folio C", "25%", money(250)]]
        click(button(box, "Apply split"))
        expect(status(panel, "Folio status")).to_have_text(split_done(1003, 3))
        expect(box).to_be_hidden()
        assert_no_loops(page)
    assert [f["balanceCents"] for f in h.stay("s1")["folios"]] == [502, 251, 250]


def test_wf_invoice_mail_outage_keyboard_recovery(app_url: str, browser: Browser, mail: Any) -> None:
    down = os.environ["APP_MAILPIT_DOWN_URL"]
    h, _, payer = paid_hotel(app_url, 1)
    number = invoice_number(1)
    with staff(browser, h, base=down) as page:
        panel = open_stay_by_keyboard(page, h, "r101", BD)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        press_control(page, button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text(f"Invoice {number} issued.")
        press_control(page, button(region, "Email invoice"))
        expect(status(panel, "Folio status")).to_have_text(
            "The invoice could not be emailed. The mail service is unavailable.")
        expect(status(region, "Invoice state")).to_have_text("Issued")
        expect(status(region, "Mail state")).to_have_text("Not sent")
    assert not [m for m in mail.messages() if payer in [a.lower() for a in addresses(m.get("To"))]]
    with staff(browser, h) as page:
        panel = open_stay_by_keyboard(page, h, "r101", BD)
        region = panel.get_by_role("region", name="Folio A", exact=True)
        press_control(page, button(region, "Email invoice"))
        expect(status(panel, "Folio status")).to_have_text(f"Invoice {number} sent to {payer}.")
        expect(status(region, "Mail state")).to_have_text("Sent")
    assert mail_to(mail, payer, 1)[0]["Subject"] == f"Invoice {number} from {h.name}"


def test_wf_invoice_mail_outage_message_survives(app_url: str, browser: Browser) -> None:
    down = os.environ["APP_GOTENBERG_DOWN_URL"]
    message = "The invoice could not be created. The PDF service is unavailable. Nothing was saved."
    h, folios, _ = paid_hotel(app_url, 1)
    with staff(browser, h, base=down, reduced="reduce") as page:
        click(stay_button(page, "Ana Vale", "101", BD, MON))
        panel = dialog(page, "Stay")
        region = panel.get_by_role("region", name="Folio A", exact=True)
        click(button(region, "Close folio"))
        expect(status(panel, "Folio status")).to_have_text(message)
        answer = h.client("owner").post(f"/api/rooms/{h.room('r101')}/status", json={"status": "dirty"})
        assert answer.status_code == 200, answer.text
        expect(button(page, "Room 101 status: dirty")).to_be_visible(timeout=LIVE_WAIT_MS)
        expect(status(panel, "Folio status")).to_have_text(message)
        expect(status(region, "Invoice state")).to_have_text("Draft")
        assert_no_loops(page)
    recovered = h.client("desk").post(f"/api/folios/{folios[0]}/close")
    assert recovered.status_code == 200 and recovered.json()["invoice"]["number"] == invoice_number(1), recovered.text


def test_wf_room_move_night_keyboard(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=SECOND_NIGHT,
                   now="2027-03-06T12:00:00-06:00", stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    stay_id = h.stay_id("s1")
    total = h.stay("s1")["totalCents"]
    with staff(browser, h, "desk") as page, staff(browser, h, "desk2") as watcher:
        panel = open_stay_by_keyboard(page, h, "r101", SECOND_NIGHT)
        choose_by_keyboard(page, combo(panel, "Move to room"), "102")
        type_in(page, textbox(panel, "Move from night"), THIRD_NIGHT)
        press_control(page, button(panel, "Move room"))
        expect(status(page, "Desk notices")).to_have_text("Moved Ana Vale to room 102.")
        expect(status(watcher, "Desk notices")).to_have_text("Moved Ana Vale to room 102.", timeout=LIVE_WAIT_MS)
        expect(block(watcher, stay_id, BD)).to_have_attribute("data-nights", "2", timeout=LIVE_WAIT_MS)
        expect(block(watcher, stay_id, THIRD_NIGHT)).to_have_attribute("data-room-id", h.room("r102"), timeout=LIVE_WAIT_MS)
    assert h.stay("s1")["totalCents"] == total


def test_wf_room_move_night_reduced_status_follows(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=SECOND_NIGHT,
                   now="2027-03-06T12:00:00-06:00", stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    with staff(browser, h, "desk", reduced="reduce") as page, staff(
            browser, h, "hk", "/board", viewport=PHONE, reduced="reduce") as phone:
        board = phone.get_by_role("region", name="Room board", exact=True)
        click(stay_button(page, "Ana Vale", "101", BD, MON))
        panel = dialog(page, "Stay")
        select(combo(panel, "Move to room"), "102")
        click(button(panel, "Move room"))
        expect(status(page, "Desk notices")).to_have_text("Moved Ana Vale to room 102.")
        expect(board.get_by_role("group", name="Room 101", exact=True)).to_have_attribute(
            "data-status", "dirty", timeout=LIVE_WAIT_MS)
        items = phone.get_by_role("list", name="Today's stays", exact=True).get_by_role("listitem")
        expect(items).to_have_text([re.compile(r"^Room 102: ")], timeout=LIVE_WAIT_MS)
        tap(button(board, "Room 101 clean"))
        expect(status(page, "Desk notices")).to_have_text("Room 101 is now clean.", timeout=LIVE_WAIT_MS)
        expect(button(page, "Room 101 status: clean")).to_be_visible(timeout=LIVE_WAIT_MS)
        assert_no_loops(page)


def test_wf_guest_merge_radio_keyboard(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, guests=merge_guests())
    with staff(browser, h, "desk", "/guests") as page:
        press_control(page, button(page, "Merge guests"))
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Merge guests")
        expect(box).to_be_visible()
        choose_by_keyboard(page, combo(box, "Surviving guest"), "Sam Whitlock")
        choose_by_keyboard(page, combo(box, "Merged guest"), "Samuel Whitlock")
        press_control(page, button(box, "Review merge"))
        expect(box.get_by_role("table", name="Merge conflicts", exact=True)).to_be_visible()
        group = box.get_by_role("radiogroup", name="Phone", exact=True)
        kept = group.get_by_role("radio", name=keep_radio("+1 555 0100"), exact=True)
        other = group.get_by_role("radio", name=keep_radio(OTHER_PHONE), exact=True)
        expect(kept).to_be_checked()
        tab_to(page, kept)
        page.keyboard.press("ArrowDown")
        expect(other).to_be_checked()
        press_control(page, button(box, "Confirm merge"))
        expect(status(page, "Desk notices")).to_have_text("Guests merged. 0 stays moved.")
    guest = h.client("desk").get(f"/api/guests/{h.guest_id('keep')}").json()
    assert guest["phone"] == OTHER_PHONE and guest["name"] == "Sam Whitlock"


def test_wf_guest_merge_reduced_second_screen(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, guests=merge_guests())
    with staff(browser, h, "desk", "/guests", reduced="reduce") as page, staff(browser, h, "desk2", "/guests") as other:
        table = other.get_by_role("table", name="Guests", exact=True)
        expect(table).to_contain_text("samuel@guests.example")
        click(button(page, "Merge guests"))
        box = dialog(page, "Merge guests")
        select(combo(box, "Surviving guest"), "Sam Whitlock sam@guests.example")
        select(combo(box, "Merged guest"), "Samuel Whitlock samuel@guests.example")
        click(button(box, "Review merge"))
        click(button(box, "Confirm merge"))
        expect(status(page, "Desk notices")).to_have_text("Guests merged. 0 stays moved.")
        expect(box).to_be_hidden()
        expect(status(other, "Desk notices")).to_have_text("Guests merged. 0 stays moved.", timeout=LIVE_WAIT_MS)
        expect(table).not_to_contain_text("samuel@guests.example", timeout=LIVE_WAIT_MS)
        assert_no_loops(page)


def test_wf_reports_live_reduced_range_keyboard(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=MON, now=MON_NOON,
                   stays=[st("s1", "r101", "Ana Vale", MON, TAX_START)])
    with staff(browser, h, "owner", "/reports", reduced="reduce") as page:
        type_in(page, textbox(page, "From"), MON)
        type_in(page, textbox(page, "To"), TAX_START)
        press_control(page, button(page, "Show figures"))
        table = page.get_by_role("table", name="Nightly figures", exact=True)
        expect(table).to_contain_text(TAX_START)
        for name, value in [("Rooms available", "4"), ("Rooms sold", "1"), ("Room revenue", money(12000)),
                            ("Occupancy", occupancy(1, 4)), ("Average daily rate", money(12000)),
                            ("Revenue per available room", money(half_up_div(12000, 4)))]:
            expect(status(page, name)).to_have_text(value)
        assert table_rows(table) == [
            [MON, "2", "1", money(12000), occupancy(1, 2), money(12000), money(half_up_div(12000, 2))],
            [TAX_START, "2", "0", money(0), occupancy(0, 2), "—", money(0)]]
        assert_no_loops(page)


def test_wf_reports_live_reduced_new_stay(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, business_date=MON, now=MON_NOON,
                   stays=[st("s1", "r101", "Ana Vale", MON, TAX_START)])
    with staff(browser, h, "owner", "/reports", reduced="reduce") as page, staff(browser, h, "desk") as clerk:
        navigations = requests_to(page, "GET", r"/reports$")
        expect(status(page, "Rooms sold")).to_have_text("1")
        box = open_new_stay(clerk)
        fill_new_stay(box, "Mara Okafor", fresh_email("guest"), MON, TAX_START, "102", "Corporate")
        click(button(box, "Create stay"))
        expect(status(clerk, "Desk notices")).to_have_text("Stay created for Mara Okafor in room 102.")
        expect(status(page, "Rooms sold")).to_have_text("2", timeout=LIVE_WAIT_MS)
        expect(status(page, "Room revenue")).to_have_text(money(24040), timeout=LIVE_WAIT_MS)
        expect(status(page, "Occupancy")).to_have_text(occupancy(2, 2), timeout=LIVE_WAIT_MS)
        expect(status(page, "Average daily rate")).to_have_text(money(12020), timeout=LIVE_WAIT_MS)
        expect(status(page, "Revenue per available room")).to_have_text(money(12020), timeout=LIVE_WAIT_MS)
        assert [r for r in navigations if r.is_navigation_request()] == [], "the figures change without a reload"


def test_wf_reports_live_reduced_phone_close(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house")])
    total = h.stay("s1")["nightly"][0]["totalCents"]
    with staff(browser, h, "owner", viewport=PHONE, reduced="reduce") as page:
        expect(page.get_by_role("list", name="Today's rooms", exact=True)).to_be_visible()
        tap(button(page, "Run close"))
        expect(status(page, "Close status")).to_have_text(closed_notice(BD, 1, 0))
        expect(status(page, "Business date")).to_have_text(SECOND_NIGHT)
        results = page.get_by_role("table", name="Close results", exact=True)
        expect(results).to_be_visible()
        assert table_rows(results) == [["101", money(total)]]
        expect(status(page, "Tally date")).to_have_text(f"Last closed night {BD}")
        expect(main_area(page)).to_have_attribute("data-close-phase", "idle")
        expect(main_area(page)).to_have_attribute("data-ground", "day")
        layout(page)


def test_wf_last_room_race_conflict_survives_charge(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, stays=[st("s2", "r102", "Mara Okafor", BD, MON)])
    with staff(browser, h, "desk") as winner, staff(browser, h, "desk2") as loser:
        win_box = open_new_stay(winner)
        fill_new_stay(win_box, "Ana Vale", fresh_email("guest"), BD, day(BD, 1), "101")
        lose_box = open_new_stay(loser)
        fill_new_stay(lose_box, "Noor Hale", fresh_email("guest"), BD, day(BD, 1), "101")
        with held(loser, "**/api/stays") as release:
            click(button(lose_box, "Create stay"))
            click(button(win_box, "Create stay"))
            expect(status(winner, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.")
            expect(status(loser, "Desk notices")).to_have_text("Stay created for Ana Vale in room 101.",
                                                               timeout=LIVE_WAIT_MS)
            release()
            expect(status(loser, "Desk notices")).to_have_text(just_taken("101"))
        if lose_box.is_visible():
            click(button(lose_box, "Close"))
            advance(loser, PANEL_SETTLE_MS)
        panel = open_stay(loser, "Mara Okafor", "102", BD, MON)
        folio = h.stay("s2")["folios"][0]["id"]
        assert h.client("owner").post(f"/api/folios/{folio}/charges",
                                      json={"description": "Minibar", "amountCents": 3333}).status_code == 201
        expect(panel).to_contain_text("Minibar", timeout=LIVE_WAIT_MS)
        expect(status(loser, "Desk notices")).to_have_text(just_taken("101"))


def test_wf_dirty_room_checkin_refusal_survives_charge(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", BD, MON), st("s2", "r102", "Mara Okafor", BD, MON)])
    with staff(browser, h, "desk") as page:
        go_to(page, h, "r101", BD)
        key(page, "i")
        expect(status(page, "Desk notices")).to_have_text(no_check_in("101", "dirty"))
        panel = open_stay(page, "Mara Okafor", "102", BD, MON)
        folio = h.stay("s2")["folios"][0]["id"]
        assert h.client("desk2").post(f"/api/folios/{folio}/charges",
                                      json={"description": "Minibar", "amountCents": 3333}).status_code == 201
        expect(panel).to_contain_text("Minibar", timeout=LIVE_WAIT_MS)
        expect(status(page, "Desk notices")).to_have_text(no_check_in("101", "dirty"))
    assert h.stay("s1")["status"] == "booked"


def test_wf_guest_online_checkin_notice_survives_charge(app_url: str, browser: Browser, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    notice = "Room 101 guest completed online check-in."
    with staff(browser, h) as desk_page, open_app(browser, f"{app_url}/checkin/{token}") as guest:
        guest.get_by_label("ID photo").set_input_files(
            {"name": "id.jpg", "mimeType": "image/jpeg", "buffer": jpeg_bytes()})
        click(button(guest, "Upload photo"))
        expect(status(guest, "Check-in status")).to_have_text("Received")
        fill(textbox(guest, "Full name"), "Ana Vale")
        fill(textbox(guest, "Phone"), "+1 555 0100")
        click(button(guest, "Complete check-in"))
        expect(status(desk_page, "Desk notices")).to_have_text(notice, timeout=LIVE_WAIT_MS)
        panel = open_stay(desk_page, "Ana Vale", "101", BD, MON)
        folio = h.stay("s1")["folios"][0]["id"]
        assert h.client("owner").post(f"/api/folios/{folio}/charges",
                                      json={"description": "Minibar", "amountCents": 3333}).status_code == 201
        expect(panel).to_contain_text("Minibar", timeout=LIVE_WAIT_MS)
        expect(status(desk_page, "Desk notices")).to_have_text(notice)


def test_wf_folio_split_keyboard_pending(app_url: str, browser: Browser) -> None:
    h, _, _ = split_case(app_url, 3333)
    with staff(browser, h) as page:
        panel = open_stay_by_keyboard(page, h, "r101", BD)
        tab_to(page, button(panel, "Split Minibar"))
        page.keyboard.press("Enter")
        advance(page, PANEL_SETTLE_MS)
        box = dialog(page, "Split charge")
        type_in(page, box.get_by_role("spinbutton", name="Folio A percent", exact=True), "50")
        type_in(page, box.get_by_role("spinbutton", name="Folio B percent", exact=True), "50")
        apply_split = button(box, "Apply split")
        tab_to(page, apply_split)
        sent = requests_to(page, "POST", r"/api/entries/.*/split$")
        with held(page, "**/api/entries/*/split") as release:
            page.keyboard.press("Enter")
            expect(apply_split).to_have_attribute("aria-busy", "true")
            expect(status(panel, "Folio status")).to_have_text("Splitting charge…")
            page.keyboard.press("Enter")
            release()
            expect(status(panel, "Folio status")).to_have_text(split_done(3333, 2))
        assert len(sent) == 1, "a further press while pending sends nothing (L201)"
    assert [f["balanceCents"] for f in h.stay("s1")["folios"]] == [1667, 1666]


def test_wf_cancel_deadline_fee_follows_new_tax(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, business_date=MON, now="2027-03-08T18:00:00-06:00",
                   stays=[st("s1", "r101", "Ana Vale", TAX_START, "2027-03-10")])
    text = f"Late cancellation fee: {money(12000 + 1110 + 200)}"
    with staff(browser, h, "owner", "/rates") as owner_page, staff(browser, h, "desk") as page:
        fill(textbox(owner_page, "Tax rate percent"), "9.25")
        fill(textbox(owner_page, "Starts on"), TAX_START)
        click(button(owner_page, "Save tax rate"))
        expect(status(owner_page, "Rates status")).to_have_text("Rates saved.")
        panel = open_stay(page, "Ana Vale", "101", TAX_START, "2027-03-10")
        expect(status(panel, "Cancellation terms")).to_have_text(text, timeout=LIVE_WAIT_MS)
        click(button(panel, "Cancel stay"))
        advance(page, PANEL_SETTLE_MS)
        expect(page.get_by_role("alertdialog", name="Cancel stay", exact=True)).to_contain_text(text)
    assert h.stay("s1")["cancellation"]["feeCents"] == 12000 + 1110 + 200


def test_wf_end_of_day_close_parallel_replay(app_url: str) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean", "104": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, MON, "in_house"),
                          st("s2", "r102", "Mara Okafor", BD, MON, "in_house", guests=2),
                          st("s3", "r103", "Ines Duarte", BD, MON, "in_house"),
                          st("ns", "r104", "Priya Raman", BD, MON)])
    totals = {k: h.stay(k)["nightly"][0]["totalCents"] for k in ("s1", "s2", "s3")}
    clients = [h.new_client("owner") for _ in range(4)]
    gate = threading.Barrier(len(clients), timeout=HTTP_TIMEOUT)

    def run_close(client: httpx.Client) -> httpx.Response:
        gate.wait()
        return client.post("/api/close", json={"businessDate": BD})

    with ThreadPoolExecutor(len(clients)) as pool:
        answers = list(pool.map(run_close, clients))
    assert sorted(a.status_code for a in answers) == [200, 409, 409, 409], (
        f"one close posts and every other names an already-closed date (L418, L427): "
        f"{[(a.status_code, a.text) for a in answers]}")
    for refused in (a for a in answers if a.status_code != 200):
        err(refused, 409, "This business date is already closed.")
    won = next(a.json() for a in answers if a.status_code == 200)
    assert (won["businessDate"], won["newBusinessDate"]) == (BD, SECOND_NIGHT)
    assert won["roomsCharged"] == 3 and won["noShows"] == 1
    assert h.business_date() == SECOND_NIGHT
    for name, total in totals.items():
        entries = h.stay(name)["folios"][0]["entries"]
        assert len(entries) == 3 and sum(e["amountCents"] for e in entries) == total, f"{name} charged once (L427)"
    assert [e["description"] for e in h.stay("ns")["folios"][0]["entries"]] == ["No-show fee"]
    assert h.client("owner").get("/api/desk").json()["lastClose"]["businessDate"] == BD
    err(h.close(BD), 409, "This business date is already closed.")


def test_wf_invoice_mail_outage_parallel_close(app_url: str) -> None:
    h, folios, _ = paid_hotel(app_url, 2)
    clients = [h.new_client("desk") for _ in range(3)]
    gate = threading.Barrier(len(clients), timeout=HTTP_TIMEOUT)

    def close_folio(client: httpx.Client) -> httpx.Response:
        gate.wait()
        return client.post(f"/api/folios/{folios[0]}/close")

    with ThreadPoolExecutor(len(clients)) as pool:
        answers = list(pool.map(close_folio, clients))
    assert sorted(a.status_code for a in answers) == [200, 409, 409], (
        f"one close issues the invoice and the others write to a closed folio (L489): "
        f"{[(a.status_code, a.text) for a in answers]}")
    for refused in (a for a in answers if a.status_code != 200):
        err(refused, 409, "This folio is closed.")
    won = next(a.json() for a in answers if a.status_code == 200)
    assert won["state"] == "closed" and won["invoice"]["number"] == invoice_number(1)
    folio = h.stay("s0")["folios"][0]
    assert folio["invoice"]["number"] == invoice_number(1) and folio["invoice"]["mailState"] == "not_sent"
    following = h.client("desk").post(f"/api/folios/{folios[1]}/close")
    assert following.status_code == 200 and following.json()["invoice"]["number"] == invoice_number(2), following.text


def test_wf_housekeeping_phone_follows_close(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean"}, now=BD_OPEN,
                   stays=[st("s1", "r101", "Ana Vale", BD, SECOND_NIGHT, "in_house"),
                          st("s2", "r102", "Mara Okafor", SECOND_NIGHT, THIRD_NIGHT)])
    with staff(browser, h, "hk", "/board", viewport=PHONE) as page:
        board = page.get_by_role("region", name="Room board", exact=True)
        items = page.get_by_role("list", name="Today's stays", exact=True).get_by_role("listitem")
        expect(items).to_have_text([f"Room 101: {BD} to {SECOND_NIGHT}"])
        closed = h.close(BD)
        assert closed.status_code == 200, closed.text
        expect(items).to_have_text([f"Room 102: {SECOND_NIGHT} to {THIRD_NIGHT}"], timeout=LIVE_WAIT_MS)
        expect(board.get_by_role("group", name="Room 102", exact=True)).to_contain_text(
            f"{SECOND_NIGHT} to {THIRD_NIGHT}")
        expect(board.get_by_role("group", name="Room 101", exact=True)).not_to_contain_text(BD)
        assert "Mara Okafor" not in page_text(page), "a housekeeper never sees a guest's name (L514)"
    assert h.client("hk").get("/api/housekeeping/board").json()["businessDate"] == SECOND_NIGHT


def test_wf_guest_online_checkin_single_completion(app_url: str, mail: Any) -> None:
    h = make_hotel(app_url, rooms={"101": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON, link=True)])
    token = only_token(mail, h.emails["s1"])
    assert upload(app_url, token, jpeg_bytes()).status_code == 200
    racers = 6
    clients = [httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT) for _ in range(racers)]
    for client in clients:
        assert client.get(f"/api/checkin/{token}").status_code == 200
    gate = threading.Barrier(racers)

    def race(index: int) -> httpx.Response:
        gate.wait()
        return clients[index].post(f"/api/checkin/{token}/complete",
                                   json={"fullName": f"Ana Vale {index}", "phone": "+1 555 0100"})

    try:
        with ThreadPoolExecutor(racers) as pool:
            answers = list(pool.map(race, range(racers)))
    finally:
        for client in clients:
            client.close()
    assert sorted(a.status_code for a in answers) == [200] + [404] * (racers - 1), [a.text for a in answers]
    for answer in answers:
        if answer.status_code == 404:
            err(answer, 404, "This check-in link is no longer valid.")
    winner = next(i for i, a in enumerate(answers) if a.status_code == 200)
    stay = h.stay("s1")
    assert stay["checkedInOnline"] is True and stay["checkinLinkState"] == "ended"
    assert stay["onlineCheckIn"] == {"fullName": f"Ana Vale {winner}", "phone": "+1 555 0100"}
    link_dead(app_url, token)


def test_wf_stay_move_keyboard_shift_split_booked(app_url: str, browser: Browser) -> None:
    arrival, departure = day(BD, 1), day(BD, 4)
    h = make_hotel(app_url, rooms={"101": "clean", "102": "clean", "103": "clean"},
                   stays=[st("s1", "r101", "Ana Vale", arrival, departure)])
    stay_id = h.stay_id("s1")
    split = h.client("desk").post(f"/api/stays/{stay_id}/move", json={
        "version": h.stay("s1")["version"], "roomId": h.room("r102"), "fromNight": day(BD, 2)})
    assert split.status_code == 200, split.text
    assert [(s["roomNumber"], s["firstNight"], s["nights"]) for s in split.json()["segments"]] == [
        ("101", arrival, 1), ("102", day(BD, 2), 2)]
    with staff(browser, h) as page:
        sent = requests_to(page, "POST", rf"/api/stays/{stay_id}/move$")
        notices = status(page, "Desk notices")
        expect(block(page, stay_id, day(BD, 2))).to_have_attribute("data-room-id", h.room("r102"))
        go_to(page, h, "r102", day(BD, 2))
        key(page, "m")
        expect(notices).to_have_text("Picked up Ana Vale.")
        key(page, "ArrowRight")
        assert sent == [], "nothing is sent before the drop"
        key(page, "Enter")
        expect(notices).to_have_text("Moved Ana Vale to room 102.")
        assert len(sent) == 1
        body = json.loads(sent[0].post_data)
        assert body["roomId"] == h.room("r102") and "fromNight" not in body
        assert body["arrival"] == day(arrival, 1), "one Right shifts the stay's dates by one night (L191, L466)"
        moved = block(page, stay_id)
        expect(moved).to_have_count(1)
        expect(moved).to_have_attribute("data-room-id", h.room("r102"))
        expect(moved).to_have_attribute("data-first-night", day(arrival, 1))
        expect(moved).to_have_attribute("data-nights", "3")
    stay = h.stay("s1")
    assert (stay["arrival"], stay["departure"]) == (day(arrival, 1), day(departure, 1))
    assert [(s["roomNumber"], s["firstNight"], s["nights"]) for s in stay["segments"]] == [("102", day(arrival, 1), 3)]


def test_wf_dirty_room_checkin_split_stay_room(app_url: str, browser: Browser) -> None:
    h = make_hotel(app_url, rooms={"101": "dirty", "102": "clean"}, stays=[st("s1", "r101", "Ana Vale", BD, MON)])
    stay_id = h.stay_id("s1")
    split = h.client("desk").post(f"/api/stays/{stay_id}/move", json={
        "version": h.stay("s1")["version"], "roomId": h.room("r102"), "fromNight": SECOND_NIGHT})
    assert split.status_code == 200, split.text
    with staff(browser, h, "desk") as desk_page, staff(browser, h, "hk", "/board", viewport=PHONE) as phone:
        notices = status(desk_page, "Desk notices")
        go_to(desk_page, h, "r101", BD)
        key(desk_page, "i")
        expect(notices).to_have_text(no_check_in("101", "dirty"))
        assert h.stay("s1")["status"] == "booked"
        board = phone.get_by_role("region", name="Room board", exact=True)
        tap(button(board, "Room 101 clean"))
        expect(status(phone, "Board status")).to_have_text("Room 101 is now clean.")
        expect(notices).to_have_text("Room 101 is now clean.", timeout=LIVE_WAIT_MS)
        expect(button(desk_page, "Room 101 status: clean")).to_be_visible(timeout=LIVE_WAIT_MS)

        answered: list = []

        def answer_later(route: Any) -> None:
            answered.append((route, route.fetch()))

        pattern = f"**/api/stays/{stay_id}/check-in"
        desk_page.route(pattern, answer_later)
        key(desk_page, "i")
        expect(block(desk_page, stay_id, BD)).to_have_attribute("data-status", "in_house", timeout=LIVE_WAIT_MS)
        assert len(answered) == 1
        held_route, answer = answered[0]
        held_route.fulfill(response=answer)
        desk_page.unroute(pattern, answer_later)
        expect(notices).to_have_text("Checked in Ana Vale to room 101.")
    stay = h.stay("s1")
    assert stay["status"] == "in_house" and stay["checkInNight"] == BD
    assert [(s["roomNumber"], s["firstNight"]) for s in stay["segments"]] == [("101", BD), ("102", SECOND_NIGHT)]
