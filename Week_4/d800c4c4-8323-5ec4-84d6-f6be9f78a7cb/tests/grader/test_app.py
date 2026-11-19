import base64
import concurrent.futures as cf
import hashlib
import json
import math
import os
import re
import signal
import socket
import struct
import subprocess
import tempfile
import threading
import time
import uuid
import zlib
from contextlib import contextmanager
from datetime import datetime, timedelta
from email.utils import parsedate_to_datetime
from io import BytesIO
from urllib.parse import urljoin, urlparse
from zoneinfo import ZoneInfo

import httpx
from PIL import Image
import pytest
from playwright.sync_api import expect

from conftest import (DEPLOYED_APP, S3, Postgres, addresses, advance, animations, center, decode,
                      difference, held, layout, mail_from_address, open_app, same_origin, session, settle, tap,
                      text, unique)

EXPECT_MS = 15_000
HTTP_TIMEOUT = 60
POLL_PACE_S = 0.25
ACTIVE_DEADLINE_S = 120
MAIL_DEADLINE_S = 90
REMINDER_DEADLINE_S = 150
IDLE_DEADLINE_S = 90
BOOT_DEADLINE_S = 240
PROBE_DEADLINE_S = 15
DESK_POLL_MS = 3000
RIVAL_MS = 2000
REFRESH_MS = 10_000
BANNER_MS = 15_000
PENDING_MS = 3000
FILTER_MS = 1000
DIALOG_EXIT_MS = 150
SPRING_MAX_MS = 450
SETTLE_MS = 100
FOCUS_POLL_MS = 100
FRAME_STEP_MS = 16
SNAP_PX = 24
TARGET_PX = 44
ALIGN_PX = 2
COLUMNS = 10
JSON_LIMIT = 100_000
MULTIPART_LIMIT = 5_100_000
PHOTO_LIMIT = 5_000_000
BIG_PHOTO = (3000, 2000)
PWYC_PRICE = 15.00
REPEATED_TIME = "2026-11-01 01:30"
PLAIN_TIME = "2026-11-01 03:30"
MAX_COST = 1_000_000
LATE_FEE_MAX = 10_000
DAMAGE_FEE_MAX = 100_000
LOAN_PERIOD_MAX = 28
CHECKOUT_WINDOW_DAYS = 120
BACKDATE_DAYS = 40
TAG_BASE = 10_000
TAG_SPAN = 90_000
DEFAULT_COST = 50_000
TAB_LIMIT = 60
RACERS = 4
PHONE = (375, 812)
TABLET = (768, 1024)
LAPTOP = (1280, 800)
VIEWPORTS = (LAPTOP, TABLET, PHONE)
WRONG_CLOCK = "2031-06-15T03:00:00Z"
OTHER_ZONE = "Asia/Tokyo"
EVIL = "http://evil.example"
JOIN_PASSWORD = "join-pass-0001"
UNKNOWN_ID = 987_654_321
SCAN_TEXT = "probe-scan"
OFF_QUARTER = "17:10"
FEE_TEXT = "3.00"
OFFICE_REASON = "Half typed"
CLOSURE_REASON = "Half typed reason"
FAR_DATE = "2099-01-01"
TWO_LINES = "First line\nSecond line"
REASON_LINES = ("Was already cracked", "See checkout photo")
BAD_TAG = " pw-0000x "
RENAMED = "Renamed tool"
SEED_HAMMER_COST = 1800
NEW_LATE_FEE = 1000
NEW_DAMAGE_FEE = 2500
PATCHED_COST = 500
ELI_NAME = "Eli Nakamura"
PENDING_COPY = "Payment pending — your membership starts when billing confirms it."
ACTIVE_COPY = "Your membership is active."
COMPLETE = "Returned complete."

COORD = ("coordinator@pegworth.example", "coordinator-pass-1")
TOMASZ = ("tomasz@pegworth.example", "volunteer-pass-1")
PRIYA = ("priya@pegworth.example", "volunteer-pass-2")
ADA = ("ada@members.example", "member-pass-ada")
BEN = ("ben@members.example", "member-pass-ben")
CLEO = ("cleo@members.example", "member-pass-cleo")
ELI = ("eli@members.example", "member-pass-eli")
ELI_OPTION = f"{ELI_NAME} ({ELI[0]})"
SHORT, STORAGE_DOWN, BILLING_DOWN = "APP_SHORT_SESSION_URL", "APP_STORAGE_DOWN_URL", "APP_BILLING_DOWN_URL"
WEEKDAYS = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
SUMMARY = "Check the highlighted fields."
STORAGE_BANNER = "Photo storage is down. Check-ins are held as pending photo until it is back."
BILLING_BANNER = "Billing is down. Joins, payments, waivers and check-ins that raise a fee will wait until it is back."
BILLING_DOWN_COPY = "Billing is down. Nothing was charged; try again when it is back."


class Api:
    def __init__(self, base, cookies=None):
        self.base = base.rstrip("/")
        self.c = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT, follow_redirects=False, cookies=cookies)

    def __call__(self, method, path, body=None, **kw):
        if body is not None:
            kw["json"] = body
        return self.c.request(method, path, **kw)

    def get(self, path, **kw):
        return self("GET", path, **kw)

    def post(self, path, body=None, **kw):
        return self("POST", path, body, **kw)

    def on(self, base):
        return Api(base, {c.name: c.value for c in self.c.cookies.jar})


TEST_WATCHDOG_S = 900


NAME_JS = """() => { const e = document.activeElement; if (!e || e === document.body) return '';
  const ids = (e.getAttribute('aria-labelledby') || '').split(/\\s+/).filter(Boolean);
  const byIds = ids.map(i => document.getElementById(i)?.textContent || '').join(' ').replace(/\\s+/g, ' ');
  return (byIds || e.getAttribute('aria-label') || e.labels?.[0]?.innerText || e.innerText || e.title || '').trim(); }"""


def tab_names(page, presses):
    names = []
    for _ in range(presses):
        page.keyboard.press("Tab")
        names.append(page.evaluate(NAME_JS))
    return names


_SEEDED_READY = []


@pytest.fixture(autouse=True)
def seeded_members_active(request):
    if "app_url" in request.fixturenames and not _SEEDED_READY:
        base = request.getfixturevalue("app_url")
        for who in (ADA, BEN, CLEO, ELI):
            wait_active(signin(base, who))
        _SEEDED_READY.append(True)
    yield


@pytest.fixture(autouse=True)
def watchdog():
    def expired(_signum, _frame):
        raise AssertionError(f"test exceeded {TEST_WATCHDOG_S} s (watchdog)")

    previous = signal.signal(signal.SIGALRM, expired)
    signal.alarm(TEST_WATCHDOG_S)
    try:
        yield
    finally:
        signal.alarm(0)
        signal.signal(signal.SIGALRM, previous)

def outage(name):
    return os.environ[name].rstrip("/")


def signin(base, who):
    api = Api(base)
    r = api.post("/api/session", {"email": who[0], "password": who[1]})
    assert r.status_code == 200, r.text
    return api


def ok(r, code=200):
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    return r.json() if r.content else None


def err(r, code, message=None):
    assert r.status_code == code, f"{r.request.method} {r.request.url} -> {r.status_code} {r.text[:600]}"
    if message is not None:
        assert r.json()["error"] == message, r.text
    return r.json()


def wait_for(fn, seconds, what):
    end = time.monotonic() + seconds
    while True:
        value = fn()
        if value:
            return value
        assert time.monotonic() < end, f"timed out waiting for {what}"
        threading.Event().wait(POLL_PACE_S)


def race(calls):
    gate = threading.Barrier(len(calls))

    def run(fn):
        gate.wait()
        return fn()

    with cf.ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def server_now(api):
    return parsedate_to_datetime(api.get("/api/health").headers["date"])


def dollars(cents):
    return f"{cents // 100:,}.{cents % 100:02d}"


def queued_line(n):
    return f"Queued holds {n}"


def hold_placed(n):
    return f"Hold placed. You are number {n} in the queue."


def library_stamp(lib, iso):
    return datetime.fromisoformat(iso).astimezone(lib.tz).strftime("%Y-%m-%d %H:%M")


def out_loan_of(staff, tool):
    loans = ok(staff.get("/api/loans", params={"status": "out"}))["loans"]
    return next((x for x in loans if tool["id"] in [i["id"] for i in x["items"]]), None)


def checked_out_copy(loan):
    return f"Loan {loan['ref']} is out. Due {loan['due_date']} by {loan['due_by']}."


def text_among(locator, choices):
    wait_for(lambda: (locator.text_content() or "").strip() in choices, EXPECT_MS / 1000, f"one of {choices}")
    return (locator.text_content() or "").strip()


def counted_copy(locator, head, tail):
    def matches():
        t = (locator.text_content() or "").strip()
        if not (t.startswith(head) and t.endswith(tail)):
            return False
        return t[len(head):len(t) - len(tail)].isdigit()
    wait_for(matches, EXPECT_MS / 1000, head)


def _chunk(kind, data):
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png(width=4, height=4):
    rows = b"".join(b"\x00" + b"\x80\x60\x40" * width for _ in range(height))
    return (b"\x89PNG\r\n\x1a\n" + _chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0))
            + _chunk(b"tEXt", b"salt\x00" + uuid.uuid4().hex.encode()) + _chunk(b"IDAT", zlib.compress(rows))
            + _chunk(b"IEND", b""))


def jpeg():
    return b"\xff\xd8\xff\xe0" + uuid.uuid4().bytes * 8 + b"\xff\xd9"


def webp():
    body = b"WEBPVP8 " + uuid.uuid4().bytes * 8
    return b"RIFF" + struct.pack("<I", len(body)) + body


class Library:
    def __init__(self, staff):
        self.settings = ok(staff.get("/api/settings"))
        self.tz = ZoneInfo(self.settings["time_zone"])
        cal = ok(staff.get("/api/calendar"))
        self.hours = {h["weekday"]: h for h in cal["hours"]}
        self.closed = {c["date"] for c in cal["closures"]}
        self.now = server_now(staff)
        self.today = self.now.astimezone(self.tz).date()

    def is_open(self, d):
        return WEEKDAYS[d.weekday()] in self.hours and d.isoformat() not in self.closed

    def open_from(self, d):
        while not self.is_open(d):
            d += timedelta(days=1)
        return d

    def closing(self, d):
        hh, mm = map(int, self.hours[WEEKDAYS[d.weekday()]]["closes"].split(":"))
        return datetime(d.year, d.month, d.day, hh, mm, tzinfo=self.tz)

    def effective(self, instant):
        d = instant.astimezone(self.tz).date()
        if self.is_open(d) and instant <= self.closing(d):
            return d
        return self.open_from(d + timedelta(days=1))

    def days_late(self, due, instant):
        end, d, n = self.effective(instant), due + timedelta(days=1), 0
        while d <= end:
            n += self.is_open(d)
            d += timedelta(days=1)
        return n

    def nth_open_after(self, d, n):
        for _ in range(n):
            d = self.open_from(d + timedelta(days=1))
        return d


def as_date(text_value):
    return datetime.strptime(text_value, "%Y-%m-%d").date()


def add_tool(coord, parts=(("Body", "generic", 2, 2),), cost=DEFAULT_COST):
    for _ in range(8):
        tag = f"PW-{uuid.uuid4().int % TAG_SPAN + TAG_BASE}"
        body = {"tag": tag, "name": f"Tool {uuid.uuid4().hex[:8]}", "replacement_cost_cents": cost,
                "parts": [{"name": n, "shape": s, "width": w, "height": h} for n, s, w, h in parts]}
        r = coord.post("/api/items", body)
        if r.status_code == 201:
            return r.json()["item"]
        assert r.status_code == 422 and "tag" in r.json()["fields"], r.text
    raise AssertionError("no free tag")


def board_order(parts):
    return sorted(parts, key=lambda p: (p["row"], p["col"]))


def member_ids(staff):
    return {m["email"]: m["id"] for m in ok(staff.get("/api/members"))["members"]}


def reserve(staff, mid, items, at=None):
    body = {"member_id": mid, "item_ids": [i["id"] for i in items]}
    if at:
        body["checked_out_at"] = at
    return staff.post("/api/loans", body)


def checkout(staff, loan, photo=None, kind="image/png", captured=None):
    return staff.post(f"/api/loans/{loan['id']}/checkout", files={"photo": ("photo", photo or png(), kind)},
                      data={"captured_at": captured or server_now(staff).isoformat()})


def lend(coord, email, items, at=None, photo=None):
    loan = ok(reserve(coord, member_ids(coord)[email], items, at), 201)["loan"]
    return ok(checkout(coord, loan, photo))["loan"]


def checkin(staff, loan, grades=None, returned_at=None, photo=None, kind="image/png"):
    data = {"grades": json.dumps(grades or {str(i["id"]): "good" for i in loan["items"]}),
            "captured_at": server_now(staff).isoformat()}
    if returned_at:
        data["returned_at"] = returned_at
    return staff.post(f"/api/loans/{loan['id']}/checkin", files={"photo": ("photo", photo or png(), kind)}, data=data)


def finish(staff, loan, photo=None):
    return staff.post(f"/api/loans/{loan['id']}/finish", files={"photo": ("photo", photo or png(), "image/png")},
                      data={"captured_at": server_now(staff).isoformat()})


def hang(staff, loan, part, peg=None):
    return staff.post(f"/api/loans/{loan['id']}/hang", {"part_id": part["id"], "peg_part_id": (peg or part)["id"]})


def hang_all(staff, loan):
    for part in loan["parts"]:
        ok(hang(staff, loan, part))


def backdated(lib, days=BACKDATE_DAYS):
    return (lib.now - timedelta(days=days)).isoformat()


def raised_fee(coord, email, cost=DEFAULT_COST):
    lib = Library(coord)
    tool = add_tool(coord, cost=cost)
    loan = lend(coord, email, [tool], at=backdated(lib))
    hang_all(coord, loan)
    body = ok(checkin(coord, loan))
    assert body["fee"] and body["fee"]["status"] == "raised", body
    return body["fee"], body["loan"], tool


def recount(board):
    parts = [p for item in board["items"] for p in item["parts"]]
    return {"on_wall": sum(p["state"] == "hung" for p in parts), "out": sum(p["state"] == "out" for p in parts),
            "missing": sum(p["state"] == "missing" for p in parts)}, len(parts)


def wait_active(api):
    wait_for(lambda: ok(api.get("/api/me"))["membership"]["status"] == "active", ACTIVE_DEADLINE_S, "active")


def join_active(base, prefix):
    name, email = unique(prefix)
    api = Api(base)
    ok(api.post("/api/members", {"name": name, "email": email, "password": JOIN_PASSWORD, "tier": "standard"}), 202)
    wait_active(api)
    return name, email.lower(), api


def kb_account(killbill, email):
    acct = killbill.account_by_key(email.lower())
    assert acct, f"no Kill Bill account for {email}"
    return acct


def kb_invoice(killbill, email, invoice_id):
    return next(i for i in killbill.invoices(kb_account(killbill, email)["accountId"]) if i["invoiceId"] == invoice_id)


def kb_fee_payments(killbill, email, fee_id):
    return [p for p in killbill.payments(kb_account(killbill, email)["accountId"])
            if p.get("paymentExternalKey") == f"pegworth-fee-{fee_id}"]


def kb_credits(killbill, email, fee_id):
    return [it for inv in killbill.invoices(kb_account(killbill, email)["accountId"]) for it in inv.get("items", [])
            if it.get("description") == f"Waiver for fee {fee_id}"]


def mails_for(mail, subject, to):
    def found():
        return [m for m in mail.messages() if m.get("Subject") == subject and to in addresses(m.get("To"))]
    wait_for(found, MAIL_DEADLINE_S, subject)
    return [m for m in mail.messages(settle=3) if m.get("Subject") == subject and to in addresses(m.get("To"))]


def put_hours(coord, hours):
    return coord("PUT", "/api/calendar/hours", {"hours": hours})


def current_hours(coord):
    return [{k: h[k] for k in ("weekday", "opens", "closes")} for h in ok(coord.get("/api/calendar"))["hours"]]


@contextmanager
def screen(browser, base, who=None, path="/", size=LAPTOP, **opts):
    with open_app(browser, base + "/signin", **opts) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if who:
            r = page.request.post(base + "/api/session", data={"email": who[0], "password": who[1]})
            assert r.status == 200, r.text()
        page.goto(base + path)
        yield page


def desk_news(page):
    return page.get_by_role("status", name="Desk announcements")


def account_news(page):
    return page.get_by_role("status", name="Account updates")


def scan(page):
    return page.get_by_role("searchbox", name="Scan or find a loan")


def detail(page):
    return page.get_by_role("region", name="Item detail")


def outline(page, item, part, word):
    return page.get_by_role("region", name="Pegboard").get_by_role(
        "button", name=f"{item['name']} — {part['name']}, {word}", exact=True)


def card(page, part):
    return page.get_by_role("button", name=f"Tag card {part['name']}", exact=True)


def box(locator):
    b = locator.bounding_box()
    assert b, "element has no box"
    return b


def big_enough(locator):
    b = box(locator)
    assert b["width"] >= TARGET_PX and b["height"] >= TARGET_PX, b


def select_loan(page, tag):
    scan(page).fill(tag)
    scan(page).press("Enter")


def pick_photo(page, button, data=None):
    with page.expect_file_chooser() as chooser:
        button.focus()
        page.keyboard.press("Enter")
    chooser.value.set_files(files=[{"name": "photo.png", "mimeType": "image/png", "buffer": data or png()}])


def tab_to(page, locator):
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if locator.evaluate("e => e === document.activeElement"):
            return
    raise AssertionError("control never reached by Tab")


def counts_shown(page, counts):
    expect(page.get_by_role("group", name="Board counts")).to_contain_text(re.compile(
        rf"On the wall\D*{counts['on_wall']}(?!\d).*Out on loan\D*{counts['out']}(?!\d).*Missing\D*{counts['missing']}(?!\d)", re.S),
        timeout=EXPECT_MS)


def ui_signin(page, who):
    page.get_by_role("textbox", name="Email").fill(who[0])
    page.get_by_role("textbox", name="Password").fill(who[1])
    page.get_by_role("textbox", name="Password").press("Enter")


def centred(locator):
    locator.evaluate("e => e.scrollIntoView({block:'center',inline:'center',behavior:'instant'})")
    return box(locator)


PANE_OFFSET = """e => { const pane = e.closest('[role=region], section, aside, main') || document.body;
    const a = e.getBoundingClientRect(), b = pane.getBoundingClientRect(); let sx = 0, sy = 0;
    for (let n = e.parentElement; n && n !== pane.parentElement; n = n.parentElement) { sx += n.scrollLeft; sy += n.scrollTop; }
    return {x: a.x - b.x + sx, y: a.y - b.y + sy}; }"""


def in_pane(locator):
    return locator.evaluate(PANE_OFFSET)


def sprung_home(page, locator, start):
    springs = animations(locator)
    assert all(a["duration"] <= SPRING_MAX_MS for a in springs), springs
    advance(page, SPRING_MAX_MS + SETTLE_MS)
    settle(locator)
    end = in_pane(locator)
    assert abs(end["x"] - start["x"]) <= 1 and abs(end["y"] - start["y"]) <= 1, (start, end)


def capture_area(page, area):
    view = page.viewport_size
    shot = base64.b64decode(session(page).send("Page.captureScreenshot", {"format": "png", "captureBeyondViewport": False})["data"])
    with Image.open(BytesIO(shot)) as pixels:
        region = (max(0, math.floor(area["x"])), max(0, math.floor(area["y"])),
                  min(view["width"], math.ceil(area["x"] + area["width"])), min(view["height"], math.ceil(area["y"] + area["height"])))
        out = BytesIO()
        pixels.resize((view["width"], view["height"]), Image.Resampling.BOX).crop(region).save(out, format="PNG")
        return out.getvalue()


def focused(locator):
    page = locator.page
    deadline = time.monotonic() + EXPECT_MS / 1000
    while True:
        try:
            expect(locator).to_be_focused(timeout=FOCUS_POLL_MS)
            return
        except AssertionError:
            if time.monotonic() > deadline:
                raise
            advance(page, FRAME_STEP_MS)


def drag(page, source, target):
    x, y = center(source)
    page.mouse.move(x, y)
    page.mouse.down()
    tb = centred(target)
    page.mouse.move(tb["x"] + tb["width"] / 2, tb["y"] + tb["height"] / 2, steps=6)
    page.mouse.up()


def overdue(read):
    n = read["open_days_late"]
    return f"Overdue — {n} open day{'' if n == 1 else 's'} late, ${dollars(read['late_fee_so_far_cents'])} so far"


def in_view(locator, size):
    def inside():
        b = locator.bounding_box()
        return bool(b) and b["x"] >= 0 and b["y"] >= 0 and b["x"] + b["width"] <= size[0] and b["y"] + b["height"] <= size[1]
    wait_for(inside, EXPECT_MS / 1000, "outline kept in view")


def grade_good(page, item):
    page.get_by_role("radiogroup", name=f"Condition of {item['name']}").get_by_role("radio", name="Good").check()


class Relay:
    def __init__(self, url):
        parsed = urlparse(url)
        self.target, self.scheme = (parsed.hostname, parsed.port or 80), parsed.scheme
        probe = socket.socket()
        probe.bind(("127.0.0.1", 0))
        self.port = probe.getsockname()[1]
        probe.close()
        self.server = None

    @property
    def url(self):
        return f"{self.scheme}://127.0.0.1:{self.port}"

    def up(self):
        self.server = socket.socket()
        self.server.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
        self.server.bind(("127.0.0.1", self.port))
        self.server.listen(64)
        threading.Thread(target=self._accept, args=(self.server,), daemon=True).start()

    def _accept(self, server):
        while True:
            try:
                client, _ = server.accept()
                upstream = socket.create_connection(self.target)
            except OSError:
                return
            for a, b in ((client, upstream), (upstream, client)):
                threading.Thread(target=self._pipe, args=(a, b), daemon=True).start()

    @staticmethod
    def _pipe(a, b):
        try:
            while data := a.recv(65536):
                b.sendall(data)
        except OSError:
            pass
        finally:
            for s in (a, b):
                try:
                    s.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def down(self):
        if self.server:
            try:
                self.server.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            self.server.close()
            self.server = None


@contextmanager
def app_copy(overrides):
    probe = socket.socket()
    probe.bind(("127.0.0.1", 0))
    port = probe.getsockname()[1]
    probe.close()
    with open(os.path.join(DEPLOYED_APP, "run.json")) as fh:
        serve = json.load(fh)["serve"]
    log = tempfile.NamedTemporaryFile("w+", delete=False, suffix=".log")
    proc = subprocess.Popen(serve, shell=True, cwd=DEPLOYED_APP, stdout=log, stderr=subprocess.STDOUT,
                            env={**os.environ, **overrides, "APP_PUBLIC_PORT": str(port)}, start_new_session=True)
    base = f"http://127.0.0.1:{port}"

    def tail():
        with open(log.name) as fh:
            return fh.read()[-3000:]

    def healthy():
        assert proc.poll() is None, f"app copy exited:\n{tail()}"
        try:
            return httpx.get(base + "/api/health", timeout=5).status_code == 200
        except httpx.HTTPError:
            return False

    try:
        wait_for(healthy, BOOT_DEADLINE_S, "app copy health")
        yield base, tail
    finally:
        os.killpg(proc.pid, signal.SIGTERM)
        proc.wait(30)


def test_join_waits_for_kill_bill(app_url, killbill):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    wait_active(signin(app_url, ADA))
    lend(coord, ADA[0], [tool])
    name, email = unique("joiner")
    visitor = Api(app_url)
    body = ok(visitor.post("/api/members", {"name": name, "email": email.upper(), "password": JOIN_PASSWORD,
                                            "tier": "supporter"}), 202)
    assert body["user"]["email"] == email.lower() and body["user"]["role"] == "member"
    assert body["membership"]["status"] == "pending-payment" and body["membership"]["tier"] == "supporter"
    early = visitor.post("/api/holds", {"item_id": tool["id"]})
    acct = kb_account(killbill, email)
    if early.status_code == 409:
        assert early.json()["error"] == "Your membership is not active."
    else:
        assert early.status_code == 201, early.text
        assert killbill.subscriptions(acct["accountId"])[0]["state"] == "ACTIVE"
    wait_active(visitor)
    subs = killbill.subscriptions(acct["accountId"])
    assert [s["planName"] for s in subs] == ["pegworth-supporter-annual"] and subs[0]["state"] == "ACTIVE"
    assert len(killbill.payments(acct["accountId"])) == 1
    assert any(float(i["balance"]) == 0 and float(i["amount"]) > 0 for i in killbill.invoices(acct["accountId"]))
    if early.status_code == 409:
        ok(visitor.post("/api/holds", {"item_id": tool["id"]}), 201)


def test_join_race_one_kill_bill_account(app_url, killbill):
    name2, email2 = unique("racer")
    bases = [app_url, outage(SHORT)]
    results = race([lambda i=i: Api(bases[i % 2]).post("/api/members", {
        "name": name2, "email": email2.upper() if i % 2 else email2, "password": JOIN_PASSWORD, "tier": "standard"})
        for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(202) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == "An account with this email already exists." for r in results if r.status_code == 409)
    wait_active(signin(app_url, (email2, JOIN_PASSWORD)))
    acct2 = kb_account(killbill, email2)
    assert len(killbill.subscriptions(acct2["accountId"])) == 1
    assert len(killbill.payments(acct2["accountId"])) == 1


def test_join_refusal_order(killbill):
    base = outage(BILLING_DOWN)
    name, email = unique("refused")
    taken = {"name": name, "email": ADA[0], "password": JOIN_PASSWORD, "tier": "standard"}
    big = json.dumps({**taken, "pad": "x" * JSON_LIMIT})
    v = Api(base)
    err(v.post("/api/members", content=big, headers={"content-type": "text/plain", "origin": EVIL}), 403,
        "Cross-site request refused.")
    err(v.post("/api/members", content=big, headers={"content-type": "text/plain"}), 415, "Send JSON.")
    err(v.post("/api/members", content=big, headers={"content-type": "application/json"}), 413, "Request is too large.")
    r = err(v.post("/api/members", {**taken, "password": "abcdefghi"}), 422, SUMMARY)
    assert list(r["fields"]) == ["password"]
    r = err(v.post("/api/members", {"name": "", "email": "nope", "password": "short", "tier": "gold"}), 422, SUMMARY)
    assert list(r["fields"]) == ["name", "email", "password", "tier"]
    err(v.post("/api/members", taken), 409, "An account with this email already exists.")
    err(v.post("/api/members", {**taken, "email": email}), 503, BILLING_DOWN_COPY)
    err(Api(base).post("/api/session", {"email": email, "password": JOIN_PASSWORD}), 401, "Email or password is incorrect.")
    assert killbill.account_by_key(email.lower()) is None


def test_wf_join_membership_keyboard_join(browser, app_url, killbill):
    name, email = unique("kbjoin")
    with screen(browser, app_url, None, "/join", PHONE) as page:
        first = page.get_by_role("radio", name="Pay what you can — $15.00 a year")
        standard = page.get_by_role("radio", name="Standard — $40.00 a year")
        supporter = page.get_by_role("radio", name="Supporter — $75.00 a year")
        name_box = page.get_by_role("textbox", name="Name")
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            if page.evaluate("() => document.activeElement?.getAttribute('type') === 'radio' || document.activeElement?.getAttribute('role') === 'radio'"):
                break
        expect(first).to_be_focused()
        for radio in (first, standard, supporter):
            expect(radio).not_to_be_checked()
        page.keyboard.press("ArrowLeft")
        expect(supporter).to_be_checked()
        page.keyboard.press("ArrowRight")
        expect(first).to_be_checked()
        page.keyboard.press("ArrowRight")
        expect(standard).to_be_checked()
        assert tab_names(page, 4) == ["Name", "Email", "Password", "Pay and join"]
        for _ in range(3):
            page.keyboard.press("Shift+Tab")
        expect(name_box).to_be_focused()
        for i, value in enumerate([name, "not-an-email", JOIN_PASSWORD]):
            if i:
                page.keyboard.press("Tab")
            page.keyboard.type(value)
        page.keyboard.press("Enter")
        problems = page.get_by_role("alert", name="Form problems")
        focused(problems)
        expect(problems).to_contain_text(SUMMARY)
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        email_box = page.get_by_role("textbox", name="Email")
        expect(email_box).to_be_focused()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type(email)
        sent = []
        page.on("request", lambda r: sent.append(r) if r.method == "POST" and r.url.endswith("/api/members") else None)
        with held(page, "**/api/members") as gate:
            page.keyboard.press("Enter")
            pending = page.get_by_role("button", name="Starting your membership...")
            expect(pending).to_have_attribute("aria-busy", "true")
            expect(pending).to_have_attribute("aria-disabled", "true")
            page.keyboard.press("Enter")
            page.keyboard.press("Enter")
            pending.focus()
            page.keyboard.press("Space")
            gate.release()
        expect(page).to_have_url(app_url + "/account", timeout=EXPECT_MS)
        assert len(sent) == 1
    wait_active(signin(app_url, (email, JOIN_PASSWORD)))
    acct = kb_account(killbill, email)
    assert [s["planName"] for s in killbill.subscriptions(acct["accountId"])] == ["pegworth-standard-annual"]
    assert len(killbill.payments(acct["accountId"])) == 1


def test_wf_join_membership_cancel_term(browser, app_url, killbill):
    _, email, member = join_active(app_url, "leaver")
    with screen(browser, app_url, (email, JOIN_PASSWORD), "/account") as page:
        opener = page.get_by_role("button", name="Cancel at end of term")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Cancel membership")
        confirm = dialog.get_by_role("button", name="Confirm cancel")
        keep = dialog.get_by_role("button", name="Keep membership")
        expect(confirm).to_be_focused()
        page.keyboard.press("Tab")
        expect(keep).to_be_focused()
        page.keyboard.press("Tab")
        expect(confirm).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(keep).to_be_focused()
        advance(page, REFRESH_MS * 2)
        expect(dialog).to_be_visible()
        expect(keep).to_be_focused()
        page.keyboard.press("Escape")
        advance(page, DIALOG_EXIT_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        assert ok(member.get("/api/me"))["membership"]["ends_at_term"] is False
        page.keyboard.press("Enter")
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        focused(page.get_by_role("heading", name="Your membership"))
        end = ok(member.get("/api/me"))["membership"]["active_until"]
        expect(account_news(page)).to_have_text(f"Your membership ends on {end}.")
        advance(page, DIALOG_EXIT_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_have_count(0)
    assert ok(member.get("/api/me"))["membership"]["ends_at_term"] is True


def test_wf_holds_queue_race(app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    lend(coord, ADA[0], [tool])
    short = outage(SHORT)
    ben, cleo, eli = signin(app_url, BEN), signin(app_url, CLEO), signin(app_url, ELI)
    calls = [lambda i=i: ben.on(app_url if i % 2 else short).post("/api/holds", {"item_id": tool["id"]})
             for i in range(RACERS)]
    calls += [lambda: cleo.on(short).post("/api/holds", {"item_id": tool["id"]}),
              lambda: eli.post("/api/holds", {"item_id": tool["id"]})]
    results = race(calls)
    ben_codes = [r.status_code for r in results[:RACERS]]
    assert ben_codes.count(201) == 1 and ben_codes.count(409) == RACERS - 1, ben_codes
    assert all(r.json()["error"] == "You already have a hold on this tool." for r in results[:RACERS] if r.status_code == 409)
    assert [r.status_code for r in results[RACERS:]] == [201, 201]

    def queue():
        holds = [h for h in ok(coord.get(f"/api/holds?item_id={tool['id']}"))["holds"] if h["status"] == "queued"]
        return sorted(holds, key=lambda h: (datetime.fromisoformat(h["placed_at"]), h["id"]))
    q = queue()
    assert [h["position"] for h in q] == [1, 2, 3]
    assert ok(coord.get(f"/api/items/{tool['id']}"))["item"]["hold_queue_length"] == 3
    middle = q[1]
    by_user = {ok(a.get("/api/me"))["user"]["id"]: a for a in (ben, cleo, eli)}
    owner = by_user[middle["member_id"]]
    stranger = next(a for uid_, a in by_user.items() if uid_ != middle["member_id"])
    err(stranger("DELETE", f"/api/holds/{middle['id']}"), 404, "Not found.")
    cancelled = ok(owner("DELETE", f"/api/holds/{middle['id']}"))["hold"]
    assert cancelled["status"] == "cancelled" and cancelled["position"] is None
    after = queue()
    assert [h["id"] for h in after] == [q[0]["id"], q[2]["id"]] and [h["position"] for h in after] == [1, 2]
    assert ok(coord.get(f"/api/items/{tool['id']}"))["item"]["hold_queue_length"] == 2
    err(owner("DELETE", f"/api/holds/{middle['id']}"), 409, "This hold is no longer active.")


def test_wf_holds_desk_and_account(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    part = tool["parts"][0]
    loan = lend(coord, ADA[0], [tool])
    ben, cleo = signin(app_url, BEN), signin(app_url, CLEO)
    ben_hold = ok(ben.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]
    hang_all(coord, loan)
    ok(checkin(coord, loan))
    with screen(browser, app_url, TOMASZ, "/desk") as desk, screen(browser, app_url, CLEO, "/account") as acct:
        outline(desk, tool, part, "held").click()
        expect(detail(desk)).to_contain_text(queued_line(1), timeout=EXPECT_MS)
        desk.keyboard.press("/")
        expect(scan(desk)).to_be_focused()
        desk.keyboard.type(SCAN_TEXT)
        cleo_short = signin(outage(SHORT), CLEO)
        cleo_hold = ok(cleo_short.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]
        assert cleo_hold["position"] == 1
        advance(desk, REFRESH_MS)
        expect(detail(desk)).to_contain_text(queued_line(2), timeout=EXPECT_MS)
        expect(scan(desk)).to_be_focused()
        expect(scan(desk)).to_have_value(SCAN_TEXT)
        advance(acct, REFRESH_MS)
        row = acct.get_by_role("table", name="Your holds").get_by_role("row").filter(has_text=tool["tag"])
        expect(row).to_contain_text("queued", timeout=EXPECT_MS)
        before = account_news(acct).text_content()
        ok(ben("DELETE", f"/api/holds/{ben_hold['id']}"))
        advance(acct, REFRESH_MS)
        sentence = f"Your hold on {tool['name']} is ready."
        expect(account_news(acct)).to_have_text(sentence, timeout=EXPECT_MS)
        assert before != sentence
        advance(acct, REFRESH_MS * 2)
        expect(account_news(acct)).to_have_text(sentence)
        expect(row).to_contain_text("ready")
        advance(desk, REFRESH_MS)
        expect(detail(desk)).to_contain_text(queued_line(1), timeout=EXPECT_MS)
    holds = ok(cleo.get("/api/holds"))["holds"]
    assert [h["status"] for h in holds if h["id"] == cleo_hold["id"]] == ["ready"]


def test_reserve_checkout_due_date(app_url):
    vol, coord = signin(app_url, TOMASZ), signin(app_url, COORD)
    tool = add_tool(coord, parts=(("Body", "drill", 3, 3), ("Case", "case", 3, 2)))
    mid = member_ids(vol)[ADA[0]]
    loan = ok(reserve(vol, mid, [tool]), 201)["loan"]
    assert loan["status"] == "reserved" and re.fullmatch(r"L-\d{4}", loan["ref"])
    for key in ("due_date", "due_by", "fee_rules", "open_days_late", "late_fee_so_far_cents"):
        assert loan[key] is None, key
    item = ok(vol.get(f"/api/items/{tool['id']}"))["item"]
    assert item["status"] == "reserved" and {p["state"] for p in item["parts"]} == {"hung"}
    out = ok(checkout(vol, loan))["loan"]
    lib = Library(coord)
    assert out["status"] == "out" and as_date(out["due_date"]) >= lib.today and out["due_by"]
    assert out["fee_rules"] == {"late_fee_cents": lib.settings["late_fee_cents"],
                                "damage_fee_cents": lib.settings["damage_fee_cents"],
                                "replacement_costs_cents": {str(tool["id"]): tool["replacement_cost_cents"]}}
    assert {p["state"] for p in out["parts"]} == {"out"}
    item = ok(vol.get(f"/api/items/{tool['id']}"))["item"]
    assert item["status"] == "out" and item["due_date"] == out["due_date"]
    err(checkout(vol, loan), 409, "This loan is already checked out.")
    err(vol("DELETE", f"/api/loans/{loan['id']}"), 409, "Only a reserved loan can be cancelled.")
    spare = add_tool(coord)
    held_loan = ok(reserve(vol, mid, [spare]), 201)["loan"]
    assert vol("DELETE", f"/api/loans/{held_loan['id']}").status_code == 204
    assert ok(vol.get(f"/api/items/{spare['id']}"))["item"]["status"] == "on-wall"


def test_loan_request_refusal_order(app_url):
    vol, coord = signin(app_url, TOMASZ), signin(app_url, COORD)
    ids = member_ids(coord)
    out_tool = add_tool(coord)
    lend(coord, BEN[0], [out_tool])
    body = {"member_id": ids[ADA[0]], "item_ids": [], "checked_out_at": "2026-10-30T10:00:00-05:00"}
    err(Api(app_url).post("/api/loans", body), 401, "Sign in to continue.")
    plain = {"content-type": "text/plain"}
    err(vol.post("/api/loans", content=json.dumps(body), headers=plain), 403, "Only the coordinator can do that.")
    no_time = {"member_id": ids[ADA[0]], "item_ids": []}
    err(vol.post("/api/loans", content=json.dumps(no_time), headers=plain), 415, "Send JSON.")
    r = err(vol.post("/api/loans", no_time), 422, SUMMARY)
    assert list(r["fields"]) == ["item_ids"]
    err(vol.post("/api/loans", {**no_time, "item_ids": [out_tool["id"]]}), 409, f"{out_tool['tag']} is not on the wall.")
    staff_id = ok(vol.get("/api/me"))["user"]["id"]
    err(vol.post("/api/loans", {"member_id": staff_id, "item_ids": [out_tool["id"]]}), 404, "Not found.")
    err(vol.post("/api/loans", {"member_id": UNKNOWN_ID, "item_ids": []}), 404, "Not found.")
    r = err(coord.post("/api/loans", {"member_id": "x", "item_ids": [1, 1], "checked_out_at": "not-a-time"}), 422)
    assert list(r["fields"]) == ["member_id", "item_ids", "checked_out_at"]


def test_wf_checkout_race_reservations(app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    ids = list(member_ids(coord).values())[:RACERS]
    staff = [signin(app_url, TOMASZ), signin(outage(SHORT), PRIYA)]
    results = race([lambda i=i: staff[i % 2].post("/api/loans", {"member_id": ids[i % len(ids)], "item_ids": [tool["id"]]})
                    for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(201) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == f"{tool['tag']} is not on the wall." for r in results if r.status_code == 409)
    loan = next(r.json()["loan"] for r in results if r.status_code == 201)
    photos = [png() for _ in range(RACERS)]
    outs = race([lambda i=i: checkout(staff[i % 2], loan, photos[i]) for i in range(RACERS)])
    codes = [r.status_code for r in outs]
    assert codes.count(200) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == "This loan is already checked out." for r in outs if r.status_code == 409)
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "out"


def test_wf_checkout_keyboard_phone(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord, parts=(("Body", "drill", 3, 3), ("Case", "case", 3, 2)))
    with screen(browser, app_url, TOMASZ, "/desk", PHONE) as page:
        page.get_by_role("button", name="New loan").focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New loan")
        b = box(dialog)
        assert (b["x"], b["y"], b["width"], b["height"]) == (0, 0, PHONE[0], PHONE[1])
        member = dialog.get_by_role("combobox", name="Member")
        expect(member).to_be_focused()
        page.keyboard.type(ELI_NAME.split()[-1].lower())
        page.keyboard.press("ArrowDown")
        option = page.get_by_role("listbox", name="Members").get_by_role("option", name=ELI_OPTION)
        big_enough(member)
        big_enough(option)
        active_id = member.get_attribute("aria-activedescendant")
        assert active_id and option.get_attribute("id") == active_id
        page.keyboard.press("Enter")
        expect(member).to_have_value("Eli Nakamura")
        tag_box = dialog.get_by_role("textbox", name="Add tool by tag")
        expect(tag_box).to_be_focused()
        page.keyboard.type(tool["tag"].lower())
        page.keyboard.press("Enter")
        remove = dialog.get_by_role("list", name="Tools on this loan").get_by_role("button", name=f"Remove {tool['tag']}")
        expect(remove).to_be_visible()
        big_enough(remove)
        expect(tag_box).to_have_value("")
        expect(tag_box).to_be_focused()
        page.keyboard.type(BAD_TAG)
        page.keyboard.press("Enter")
        message = dialog.get_by_text(f"No tool has tag {BAD_TAG.strip().upper()}.")
        expect(message).to_be_visible()
        expect(tag_box).to_be_focused()
        assert box(message)["y"] >= box(tag_box)["y"] + box(tag_box)["height"] - ALIGN_PX
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.type(tool["tag"])
        expect(message).to_have_count(0)
        page.keyboard.press("Enter")
        expect(dialog.get_by_text(f"{tool['tag']} is already on this loan.")).to_be_visible()
        page.keyboard.press("ControlOrMeta+a")
        page.keyboard.press("Backspace")
        layout(page)
        pick_photo(page, dialog.get_by_role("button", name="Take or choose photo"))
        dialog.get_by_role("button", name="Check out").focus()
        page.keyboard.press("Enter")
        loan = wait_for(lambda: out_loan_of(coord, tool), EXPECT_MS / 1000, "loan out")
        expect(desk_news(page)).to_have_text(checked_out_copy(loan), timeout=EXPECT_MS)
        expect(scan(page)).to_be_focused()
    assert loan["member_name"] == ELI_NAME and [i["id"] for i in loan["items"]] == [tool["id"]]
    assert len(S3().keys(f"loans/{loan['ref']}/checkout/")) == 1


def test_wf_checkout_rival_dialog(browser, app_url):
    coord, priya = signin(app_url, COORD), signin(app_url, PRIYA)
    tool, scanned = add_tool(coord), add_tool(coord)
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        opener = page.get_by_role("button", name="New loan")
        dialog = page.get_by_role("dialog", name="New loan")
        member = dialog.get_by_role("combobox", name="Member")
        opener.focus()
        page.keyboard.press("Enter")
        expect(member).to_be_focused()
        page.keyboard.press("Escape")
        advance(page, DIALOG_EXIT_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        page.keyboard.press("Enter")
        expect(member).to_be_focused()
        page.keyboard.press("Shift+Tab")
        expect(dialog.get_by_role("button", name="Discard")).to_be_focused()
        page.keyboard.press("Tab")
        expect(member).to_be_focused()
        page.keyboard.type("nakamura")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        page.keyboard.type(tool["tag"])
        page.keyboard.press("Enter")
        tag_box = dialog.get_by_role("textbox", name="Add tool by tag")
        expect(tag_box).to_be_focused()
        page.keyboard.press("Escape")
        prompt = page.get_by_role("alertdialog", name="Discard this loan?")
        expect(prompt).to_contain_text("Discard this loan? The member, tools and photo you entered will be cleared.")
        keep = prompt.get_by_role("button", name="Keep editing")
        expect(keep).to_be_focused()
        page.keyboard.press("Tab")
        expect(prompt.get_by_role("button", name="Discard loan")).to_be_focused()
        page.keyboard.press("Tab")
        expect(keep).to_be_focused()
        page.keyboard.press("Escape")
        advance(page, DIALOG_EXIT_MS)
        expect(prompt).to_be_hidden()
        expect(tag_box).to_be_focused()
        expect(dialog.get_by_role("button", name=f"Remove {tool['tag']}")).to_be_visible()
        pick_photo(page, dialog.get_by_role("button", name="Take or choose photo"))
        ok(reserve(priya, member_ids(priya)[ADA[0]], [tool]), 201)
        dialog.get_by_role("button", name="Check out").focus()
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{tool['tag']} is not on the wall.", timeout=EXPECT_MS)
        expect(dialog).to_be_visible()
        expect(member).to_be_focused()
        expect(member).to_have_value("Eli Nakamura")
        expect(dialog.get_by_role("button", name=f"Remove {tool['tag']}")).to_be_visible()
        dialog.get_by_role("button", name="Discard").focus()
        page.keyboard.press("Enter")
        prompt.get_by_role("button", name="Discard loan").focus()
        page.keyboard.press("Enter")
        advance(page, DIALOG_EXIT_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        select_loan(page, scanned["tag"])
        expect(dialog).to_be_visible(timeout=EXPECT_MS)
        expect(dialog.get_by_role("button", name=f"Remove {scanned['tag']}")).to_be_visible()
        page.keyboard.press("Escape")
        page.get_by_role("alertdialog", name="Discard this loan?").get_by_role("button", name="Discard loan").click()
        advance(page, DIALOG_EXIT_MS)
        expect(scan(page)).to_be_focused()
    eli = member_ids(coord)[ELI[0]]
    loans = ok(coord.get(f"/api/loans?member_id={eli}"))["loans"]
    assert not [x for x in loans if {i["id"] for i in x["items"]} & {tool["id"], scanned["id"]}]
    assert ok(coord.get(f"/api/items/{scanned['id']}"))["item"]["status"] == "on-wall"


def test_hang_rules_api(app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    single, elsewhere = add_tool(coord), add_tool(coord)
    loan = lend(coord, ELI[0], [kit, single])
    reserved = ok(reserve(coord, member_ids(coord)[ADA[0]], [elsewhere]), 201)["loan"]
    first, second = board_order(kit["parts"])
    lone = single["parts"][0]
    wrong = err(hang(coord, loan, first, lone), 422)
    assert wrong == {"error": "That peg belongs to a different tool.",
                     "fields": {"peg_part_id": "That peg belongs to a different tool."}}
    err(hang(coord, loan, elsewhere["parts"][0]), 404, "Not found.")
    assert {p["id"]: p["state"] for p in ok(hang(coord, loan, first))["loan"]["parts"]}[first["id"]] == "hung"
    err(hang(coord, loan, first), 409, f"{first['name']} is already on its peg.")
    down = ok(coord("DELETE", f"/api/loans/{loan['id']}/hang/{first['id']}"))["loan"]
    assert {p["id"]: p["state"] for p in down["parts"]}[first["id"]] == "out"
    ok(hang(coord, loan, first))
    err(hang(coord, reserved, elsewhere["parts"][0]), 409, "This loan has not been checked out.")
    err(coord("DELETE", f"/api/loans/{reserved['id']}/hang/{elsewhere['parts'][0]['id']}"), 409,
        "This loan has not been checked out.")
    assert ok(checkin(coord, loan))["loan"]["status"] == "returned-partial"
    err(coord("DELETE", f"/api/loans/{loan['id']}/hang/{first['id']}"), 409, "This loan is already checked in.")
    err(hang(coord, loan, first), 409, f"{first['name']} is already on its peg.")


def test_wf_shadow_board_checkin_keyboard(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    single = add_tool(coord, parts=(("Lone part", "generic", 2, 2),))
    loan = lend(coord, ELI[0], [kit, single])
    order = board_order(kit["parts"] + single["parts"])
    first, rest = order[0], order[1:]
    owner = {p["id"]: item for item in (kit, single) for p in item["parts"]}
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        focused(scan(page))
        counts_shown(page, ok(coord.get("/api/board"))["counts"])
        page.keyboard.type(kit["tag"])
        page.keyboard.press("Enter")
        focused(card(page, first))
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text("That peg belongs to a different tool.", timeout=EXPECT_MS)
        expect(page.get_by_role("alert", name="Form problems")).not_to_contain_text("That peg belongs to a different tool.")
        card(page, first).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        counts_shown(page, ok(coord.get("/api/board"))["counts"])
        for part in rest:
            focused(card(page, part))
            page.keyboard.press("Space")
            page.keyboard.press("Enter")
            expect(desk_news(page)).to_have_text(f"{part['name']} is on its peg.", timeout=EXPECT_MS)
        kit_group = page.get_by_role("radiogroup", name=f"Condition of {kit['name']}")
        focused(kit_group.get_by_role("radio").first)
        outline(page, owner[first["id"]], first, "on the wall").focus()
        page.keyboard.press("Enter")
        detail(page).get_by_role("button", name=f"Take down {first['name']}").focus()
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{first['name']} is off its peg.", timeout=EXPECT_MS)
        expect(card(page, first)).to_be_visible()
        card(page, first).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        page.keyboard.press("Control+Enter")
        focused(page.get_by_role("alert", name="Form problems"))
        for item in (kit, single):
            page.get_by_role("radiogroup", name=f"Condition of {item['name']}").get_by_role("radio", name="Good").focus()
            page.keyboard.press("Space")
        photo = detail(page).get_by_role("button", name="Take or choose photo")
        pick_photo(page, photo)
        photo.focus()
        page.keyboard.press("/")
        expect(scan(page)).to_be_focused()
        page.keyboard.press("Control+Enter")
        dialog = page.get_by_role("dialog", name="Confirm check-in")
        confirm = dialog.get_by_role("button", name="Confirm")
        focused(confirm)
        page.keyboard.press("Tab")
        expect(dialog.get_by_role("button", name="Back")).to_be_focused()
        page.keyboard.press("Tab")
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text("Returned complete.", timeout=EXPECT_MS)
        expect(scan(page)).to_be_focused()
        counts_shown(page, ok(coord.get("/api/board"))["counts"])
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert final["status"] == "returned-complete" and {i["grade"] for i in final["items"]} == {"good"}
    assert len(S3().keys(f"loans/{loan['ref']}/checkin/")) == 1


def test_wf_shadow_board_checkin_drag_reduced(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 3, 3), ("Arm", "wrench", 2, 3)))
    first, second = board_order(kit["parts"])
    lend(coord, ADA[0], [kit])
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        select_loan(page, kit["tag"])
        target = outline(page, kit, first, "out")
        expect(card(page, first)).to_be_visible(timeout=EXPECT_MS)
        cx, cy = center(card(page, first))
        page.mouse.move(cx, cy)
        page.mouse.down()
        ob = centred(target)
        page.mouse.move(ob["x"] - 3 * SNAP_PX, ob["y"] + ob["height"] / 2, steps=6)
        advance(page, DIALOG_EXIT_MS * 2)
        area = {"x": ob["x"] - SNAP_PX, "y": ob["y"] - SNAP_PX, "width": ob["width"] + 2 * SNAP_PX, "height": ob["height"] + 2 * SNAP_PX}
        far = decode(capture_area(page, area))
        page.mouse.move(ob["x"] - SNAP_PX + 4, ob["y"] + ob["height"] / 2, steps=3)
        advance(page, DIALOG_EXIT_MS * 2)
        near = decode(capture_area(page, area))
        assert difference(far, near) > 0, "own outline did not thicken inside the snap radius"
        page.mouse.up()
        expect(outline(page, kit, first, "on the wall")).to_be_visible(timeout=EXPECT_MS)
        expect(desk_news(page)).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        sx, sy = center(card(page, second))
        start = in_pane(card(page, second))
        page.mouse.move(sx, sy)
        page.mouse.down()
        page.mouse.move(sx + 5, sy + LAPTOP[1] / 3, steps=6)
        page.mouse.up()
        sprung_home(page, card(page, second), start)
        sx, sy = center(card(page, second))
        page.mouse.move(sx, sy)
        page.mouse.down()
        hung = centred(outline(page, kit, first, "on the wall"))
        page.mouse.move(hung["x"] + hung["width"] / 2, hung["y"] + hung["height"] / 2, steps=6)
        page.mouse.up()
        expect(desk_news(page)).to_have_text("That peg belongs to a different tool.", timeout=EXPECT_MS)
        sprung_home(page, card(page, second), start)
        expect(outline(page, kit, second, "out")).to_be_visible()
    calm = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    c1, c2 = board_order(calm["parts"])
    lend(coord, BEN[0], [calm])
    with screen(browser, app_url, PRIYA, "/desk", PHONE, reduced_motion="reduce") as page:
        select_loan(page, calm["tag"])
        focused(card(page, c1))
        start = in_pane(card(page, c1))
        tap(card(page, c1))
        tap(outline(page, calm, c2, "out"))
        expect(desk_news(page)).to_have_text("That peg belongs to a different tool.", timeout=EXPECT_MS)
        assert animations(card(page, c1)) == []
        again = in_pane(card(page, c1))
        assert abs(again["x"] - start["x"]) <= 1 and abs(again["y"] - start["y"]) <= 1, (start, again)
        expect(outline(page, calm, c2, "out")).to_be_visible()
        expect(outline(page, calm, c1, "out")).to_be_visible()


def test_wf_partial_returns_concurrent_api(app_url, mail):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3), ("Lid", "case", 3, 2)))
    first, second, third = board_order(kit["parts"])
    loan = lend(coord, ADA[0], [kit])
    ben, cleo = signin(app_url, BEN), signin(app_url, CLEO)
    ben_hold = ok(ben.post("/api/holds", {"item_id": kit["id"]}), 201)["hold"]
    cleo_hold = ok(cleo.post("/api/holds", {"item_id": kit["id"]}), 201)["hold"]
    ok(hang(coord, loan, first))
    partial = ok(checkin(coord, loan))["loan"]
    assert partial["status"] == "returned-partial" and partial["missing_parts"] == [second["name"], third["name"]]
    a, b = race([lambda: hang(coord, loan, second), lambda: coord.on(outage(SHORT)).post(
        f"/api/loans/{loan['id']}/hang", {"part_id": third["id"], "peg_part_id": third["id"]})])
    bodies = [ok(a), ok(b)]
    statuses = [x["loan"]["status"] for x in bodies]
    assert sorted(statuses) == ["returned-complete", "returned-partial"], statuses
    for x in bodies:
        if x["loan"]["status"] == "returned-partial":
            assert len(x["loan"]["missing_parts"]) == 1
    holds = {h["id"]: h for h in ok(coord.get(f"/api/holds?item_id={kit['id']}"))["holds"]}
    assert holds[ben_hold["id"]]["status"] == "ready" and holds[cleo_hold["id"]]["status"] == "queued"
    assert holds[cleo_hold["id"]]["position"] == 1
    assert ok(coord.get(f"/api/items/{kit['id']}"))["item"]["status"] == "held"
    subject = f"Your hold is ready: {kit['name']} ({kit['tag']})"
    assert len(mails_for(mail, subject, BEN[0])) == 1
    assert not [m for m in mail.messages() if m.get("Subject") == subject and CLEO[0] in addresses(m.get("To"))]


def test_wf_partial_returns_two_desks(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3), ("Lid", "case", 3, 2)))
    first, second, third = board_order(kit["parts"])
    loan = lend(coord, ADA[0], [kit])
    ok(hang(coord, loan, first))
    ok(checkin(coord, loan))
    with screen(browser, app_url, TOMASZ, "/desk") as left, \
            screen(browser, app_url, PRIYA, "/desk", PHONE, reduced_motion="reduce") as right:
        for part in (second, third):
            expect(outline(left, kit, part, "missing")).to_be_visible(timeout=EXPECT_MS)
        select_loan(left, kit["tag"])
        select_loan(right, kit["tag"])
        focused(card(right, second))
        right.keyboard.press("Tab")
        expect(card(right, third)).to_be_focused()
        right.keyboard.press("Space")
        cx, cy = center(card(left, second))
        left.mouse.move(cx, cy)
        left.mouse.down()
        target = centred(outline(left, kit, second, "missing"))
        left.mouse.move(target["x"] + target["width"] / 2, target["y"] + target["height"] / 2, steps=6)
        left.mouse.up()
        right.keyboard.press("Enter")
        mine = [f"{second['name']} is on its peg.", f"{third['name']} is on its peg."]
        news = []
        for page, own_copy in ((left, mine[0]), (right, mine[1])):
            news.append(text_among(desk_news(page), (own_copy, f"{own_copy} {COMPLETE}")))
        assert sum(n.endswith(COMPLETE) for n in news) == 1, news
        filled = outline(right, kit, third, "on the wall")
        expect(filled).to_be_visible(timeout=EXPECT_MS)
        assert animations(filled) == []
        counts = ok(coord.get("/api/board"))["counts"]
        for page in (left, right):
            advance(page, DESK_POLL_MS)
            counts_shown(page, counts)
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "returned-complete"


def test_open_day_cutoff_and_overdue_so_far(app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tools = [add_tool(coord) for _ in range(3)]
    loans = [lend(coord, ELI[0], [t], at=backdated(lib)) for t in tools]
    due = as_date(loans[0]["due_date"])
    assert lib.is_open(due) and loans[0]["due_by"] == lib.hours[WEEKDAYS[due.weekday()]]["closes"]
    cutoff = lib.closing(due)
    for loan in loans[:2]:
        hang_all(coord, loan)
    first = ok(checkin(coord, loans[0], returned_at=cutoff.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")))
    assert first["loan"]["open_days_late"] == 0 and first["fee"] is None
    echoed = datetime.fromisoformat(first["loan"]["returned_at"])
    assert echoed == cutoff and echoed.utcoffset() == cutoff.utcoffset()
    late = cutoff + timedelta(seconds=1)
    second = ok(checkin(coord, loans[1], returned_at=late.astimezone(ZoneInfo(OTHER_ZONE)).isoformat()))
    assert second["loan"]["open_days_late"] == lib.days_late(due, late) == 1
    rate, cost = loans[1]["fee_rules"]["late_fee_cents"], tools[1]["replacement_cost_cents"]
    assert second["fee"]["total_cents"] == min(rate, cost)
    third = loans[2]
    before = datetime.fromisoformat(third["checked_out_at"]) - timedelta(minutes=1)
    assert "returned_at" in err(checkin(coord, third, returned_at=before.isoformat()), 422)["fields"]
    future = lib.now + timedelta(days=1)
    assert "returned_at" in err(checkin(coord, third, returned_at=future.isoformat()), 422)["fields"]
    assert ok(coord.get(f"/api/loans/{third['id']}"))["loan"]["status"] == "out"


def test_fee_lines_caps_and_receipt(app_url, killbill):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    rate = lib.settings["late_fee_cents"]
    n = 3
    equal, capped, roomy = add_tool(coord, cost=rate * n), add_tool(coord, cost=rate * n - 1), add_tool(coord, cost=MAX_COST)
    loan = lend(coord, BEN[0], [equal, capped, roomy], at=backdated(lib))
    due = as_date(loan["due_date"])
    returned = lib.closing(lib.nth_open_after(due, n))
    assert returned <= lib.now
    hang_all(coord, loan)
    grades = {str(equal["id"]): "good", str(capped["id"]): "worn", str(roomy["id"]): "damaged"}
    body = ok(checkin(coord, loan, grades=grades, returned_at=returned.isoformat()))
    fee, rules = body["fee"], body["loan"]["fee_rules"]
    by_id = {t["id"]: t for t in (equal, capped, roomy)}
    expected = []
    for item in body["loan"]["items"]:
        t = by_id[item["id"]]
        recorded = rules["replacement_costs_cents"][str(t["id"])]
        over = rules["late_fee_cents"] * n > recorded
        expected.append({"item_id": t["id"], "kind": "late", "open_days": n,
                         "amount_cents": recorded if over else rules["late_fee_cents"] * n,
                         "description": f"Late fee — {t['name']} ({t['tag']}) — {n} open days late"
                                        + (", capped at replacement cost" if over else "")})
        if grades[str(t["id"])] == "damaged":
            expected.append({"item_id": t["id"], "kind": "damage", "open_days": None,
                             "amount_cents": rules["damage_fee_cents"],
                             "description": f"Damage fee — {t['name']} ({t['tag']})"})
    assert [{k: line[k] for k in expected[0]} for line in fee["lines"]] == expected
    assert sum(e["description"].endswith(", capped at replacement cost") for e in expected) == 1
    total = sum(e["amount_cents"] for e in expected)
    assert fee["total_cents"] == total and fee["status"] == "raised" and body["loan"]["fee_id"] == fee["id"]
    invoice = kb_invoice(killbill, BEN[0], fee["killbill_invoice_id"])
    assert [(it["description"], round(float(it["amount"]) * 100)) for it in invoice["items"]] == \
        [(e["description"], e["amount_cents"]) for e in expected]
    assert round(float(invoice["balance"]) * 100) == total


def test_return_times_across_clock_change(app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    t = lib.now
    window = timedelta(days=CHECKOUT_WINDOW_DAYS - 10)
    while (t - timedelta(hours=1)).astimezone(lib.tz).utcoffset() <= t.astimezone(lib.tz).utcoffset() and lib.now - t < window:
        t -= timedelta(hours=1)
    if lib.now - t >= window:
        tool = add_tool(coord)
        loan = lend(coord, CLEO[0], [tool], at=(lib.now - timedelta(days=2)).isoformat())
        hang_all(coord, loan)
        sent = (lib.now - timedelta(hours=1)).astimezone(ZoneInfo("UTC"))
        echoed = datetime.fromisoformat(ok(checkin(coord, loan, returned_at=sent.isoformat().replace("+00:00", "Z")))["loan"]["returned_at"])
        assert echoed == sent and echoed.utcoffset() == sent.astimezone(lib.tz).utcoffset()
        return
    wall = (t - timedelta(minutes=30)).astimezone(lib.tz).replace(tzinfo=None)
    early, late = wall.replace(tzinfo=lib.tz, fold=0), wall.replace(tzinfo=lib.tz, fold=1)
    assert early.utcoffset() != late.utcoffset()
    start = datetime.combine(wall.date() - timedelta(days=8), datetime.min.time()).replace(hour=11, tzinfo=lib.tz)
    results = []
    for when in (early, late):
        tool = add_tool(coord)
        loan = lend(coord, CLEO[0], [tool], at=start.isoformat())
        hang_all(coord, loan)
        sent = when.astimezone(ZoneInfo("UTC")).isoformat().replace("+00:00", "Z")
        results.append(ok(checkin(coord, loan, returned_at=sent))["loan"])
    for when, loan in zip((early, late), results):
        echoed = datetime.fromisoformat(loan["returned_at"])
        assert echoed.timestamp() == when.timestamp() and echoed.utcoffset() == when.utcoffset()
    assert results[0]["open_days_late"] == results[1]["open_days_late"] == lib.days_late(as_date(results[0]["due_date"]), early)


def test_settings_and_fee_rules_fixed(app_url):
    coord, vol = signin(app_url, COORD), signin(app_url, TOMASZ)
    s0 = ok(coord.get("/api/settings"))
    lib = Library(coord)
    old_tool, new_tool = add_tool(coord, cost=SEED_HAMMER_COST), add_tool(coord, cost=SEED_HAMMER_COST)
    old = lend(coord, BEN[0], [old_tool], at=backdated(lib))
    changed_rules = {**s0, "late_fee_cents": NEW_LATE_FEE, "damage_fee_cents": NEW_DAMAGE_FEE}
    assert changed_rules != s0
    try:
        assert ok(coord("PUT", "/api/settings", changed_rules)) == changed_rules
        assert ok(coord("PATCH", f"/api/items/{old_tool['id']}", {"replacement_cost_cents": PATCHED_COST}))["item"][
            "replacement_cost_cents"] == PATCHED_COST
        fresh = lend(coord, BEN[0], [new_tool], at=backdated(lib))
        assert fresh["fee_rules"]["late_fee_cents"] == changed_rules["late_fee_cents"]
        assert fresh["fee_rules"]["damage_fee_cents"] == changed_rules["damage_fee_cents"]
        kept = ok(coord.get(f"/api/loans/{old['id']}"))["loan"]
        assert kept["fee_rules"] == {"late_fee_cents": s0["late_fee_cents"], "damage_fee_cents": s0["damage_fee_cents"],
                                     "replacement_costs_cents": {str(old_tool["id"]): SEED_HAMMER_COST}}
        n = kept["open_days_late"]
        assert n > 0 and kept["late_fee_so_far_cents"] == min(s0["late_fee_cents"] * n, SEED_HAMMER_COST)
        hang_all(coord, kept)
        fee = ok(checkin(coord, kept, grades={str(old_tool["id"]): "damaged"}))["fee"]
        late_line, damage_line = fee["lines"]
        assert late_line["amount_cents"] == min(s0["late_fee_cents"] * late_line["open_days"], SEED_HAMMER_COST)
        assert late_line["description"].endswith(", capped at replacement cost") == (
            s0["late_fee_cents"] * late_line["open_days"] > SEED_HAMMER_COST)
        assert damage_line["amount_cents"] == s0["damage_fee_cents"]
    finally:
        ok(coord("PUT", "/api/settings", s0))


def test_fee_and_inventory_settings(app_url):
    coord, vol = signin(app_url, COORD), signin(app_url, TOMASZ)
    s0 = ok(coord.get("/api/settings"))
    err(vol("PUT", "/api/settings", s0), 403, "Only the coordinator can do that.")
    for field, value in (("time_zone", "Mars/Olympus"), ("late_fee_cents", LATE_FEE_MAX + 1),
                         ("damage_fee_cents", DAMAGE_FEE_MAX + 1), ("loan_period_days", 0),
                         ("loan_period_days", LOAN_PERIOD_MAX + 1)):
        assert field in err(coord("PUT", "/api/settings", {**s0, field: value}), 422, SUMMARY)["fields"]
    edge = {**s0, "late_fee_cents": LATE_FEE_MAX, "damage_fee_cents": DAMAGE_FEE_MAX, "loan_period_days": LOAN_PERIOD_MAX}
    earlier = lend(coord, ELI[0], [add_tool(coord)])
    try:
        assert ok(coord("PUT", "/api/settings", edge)) == edge
        ok(coord("PUT", "/api/settings", {**s0, "time_zone": OTHER_ZONE, "loan_period_days": 1}))
        assert ok(Api(app_url).get("/api/calendar"))["time_zone"] == OTHER_ZONE
        stamp = datetime.fromisoformat(ok(coord.get(f"/api/loans/{earlier['id']}"))["loan"]["checked_out_at"])
        assert stamp.utcoffset() == stamp.astimezone(ZoneInfo(OTHER_ZONE)).utcoffset()
        lib = Library(coord)
        fresh = lend(coord, ELI[0], [add_tool(coord)])
        start = datetime.fromisoformat(fresh["checked_out_at"]).astimezone(lib.tz).date()
        assert fresh["due_date"] == lib.open_from(start + timedelta(days=1)).isoformat()
    finally:
        ok(coord("PUT", "/api/settings", s0))
    patchable = add_tool(coord)
    patched = ok(coord("PATCH", f"/api/items/{patchable['id']}", {"name": RENAMED, "replacement_cost_cents": PATCHED_COST}))["item"]
    assert (patched["name"], patched["replacement_cost_cents"]) == (RENAMED, PATCHED_COST)
    err(vol.post("/api/items", {"tag": "PW-123", "name": "x", "replacement_cost_cents": 1, "parts": []}), 403,
        "Only the coordinator can do that.")
    for bad, field in (({"tag": "PX-1"}, "tag"), ({"parts": [{"name": "p", "shape": "generic", "width": 11, "height": 2}]}, "parts"),
                       ({"replacement_cost_cents": MAX_COST + 1}, "replacement_cost_cents")):
        body = {"tag": "PW-1", "name": "x", "replacement_cost_cents": 1,
                "parts": [{"name": "p", "shape": "generic", "width": 2, "height": 2}], **bad}
        assert field in err(coord.post("/api/items", body), 422)["fields"]
    before = ok(coord.get("/api/board"))
    placed = add_tool(coord, parts=(("Wide", "generic", 4, 2), ("Tall", "ladder", 2, 8)))
    occupied = {(p["col"] + dx, p["row"] + dy) for it in before["items"] for p in it["parts"]
                for dx in range(p["width"]) for dy in range(p["height"])}
    for part in sorted(placed["parts"], key=lambda p: p["id"]):
        row = 0
        while True:
            spot = next((c for c in range(COLUMNS - part["width"] + 1) if not any(
                (c + dx, row + dy) in occupied for dx in range(part["width"]) for dy in range(part["height"]))), None)
            if spot is not None:
                break
            row += 1
        assert (part["col"], part["row"]) == (spot, row), part
        occupied |= {(spot + dx, row + dy) for dx in range(part["width"]) for dy in range(part["height"])}


def test_wf_late_fees_overdue_line(browser, app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tool = add_tool(coord, cost=MAX_COST)
    loan = lend(coord, CLEO[0], [tool], at=backdated(lib))
    hours0 = current_hours(coord)

    def line():
        read = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
        n = read["open_days_late"]
        return f"Overdue — {n} open day{'' if n == 1 else 's'} late, ${dollars(read['late_fee_so_far_cents'])} so far"

    context = browser.new_context(timezone_id=OTHER_ZONE, viewport={"width": PHONE[0], "height": PHONE[1]})
    staff_context = browser.new_context(timezone_id=OTHER_ZONE)
    try:
        page, desk = context.new_page(), staff_context.new_page()
        for p, who in ((page, CLEO), (desk, TOMASZ)):
            p.clock.install(time=WRONG_CLOCK)
            p.clock.pause_at(WRONG_CLOCK)
            p.goto(app_url + "/signin")
            assert p.request.post(app_url + "/api/session", data={"email": who[0], "password": who[1]}).status == 200
        page.goto(app_url + "/account")
        desk.goto(app_url + "/desk")
        first = line()
        loans_table = page.get_by_role("table", name="Your loans")
        expect(loans_table).to_contain_text(first, timeout=EXPECT_MS)
        expect(desk.get_by_role("list", name="Open loans")).to_contain_text(first, timeout=EXPECT_MS)
        news_before = account_news(page).text_content()
        page.clock.set_system_time(datetime.fromisoformat(WRONG_CLOCK.replace("Z", "+00:00")) + timedelta(days=3))
        advance(page, REFRESH_MS)
        expect(loans_table).to_contain_text(line())
        extra = next(w for w in WEEKDAYS if w not in {h["weekday"] for h in hours0})
        ok(put_hours(coord, hours0 + [{"weekday": extra, "opens": "10:00", "closes": "12:00"}]))
        second = line()
        assert second != first
        for p in (page, desk):
            advance(p, REFRESH_MS)
        expect(loans_table).to_contain_text(second, timeout=EXPECT_MS)
        expect(desk.get_by_role("list", name="Open loans")).to_contain_text(second, timeout=EXPECT_MS)
        assert account_news(page).text_content() == news_before
        page.goto(app_url + f"/loans/{loan['id']}")
        expect(page.get_by_text(second)).to_be_visible(timeout=EXPECT_MS)
    finally:
        ok(put_hours(coord, hours0))
        context.close()
        staff_context.close()


def test_wf_late_fees_drop_box(browser, app_url, killbill):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tool = add_tool(coord, cost=MAX_COST)
    loan = lend(coord, BEN[0], [tool], at=backdated(lib))
    when = lib.closing(lib.nth_open_after(as_date(loan["due_date"]), 2))
    t = lib.now
    while (t - timedelta(hours=1)).astimezone(lib.tz).utcoffset() >= t.astimezone(lib.tz).utcoffset():
        t -= timedelta(hours=1)
    lo, hi = t - timedelta(hours=1), t
    while hi - lo > timedelta(minutes=1):
        mid = lo + (hi - lo) / 2
        if mid.astimezone(lib.tz).utcoffset() == hi.astimezone(lib.tz).utcoffset():
            hi = mid
        else:
            lo = mid
    jump = hi.astimezone(lib.tz).utcoffset() - lo.astimezone(lib.tz).utcoffset()
    gap_start = hi.astimezone(lib.tz).replace(tzinfo=None) - jump
    skipped_text = (gap_start + jump / 2).replace(second=0, microsecond=0).strftime("%Y-%m-%d %H:%M")
    context = browser.new_context(timezone_id=OTHER_ZONE)
    try:
        page = context.new_page()
        page.goto(app_url + "/signin")
        assert page.request.post(app_url + "/api/session", data={"email": TOMASZ[0], "password": TOMASZ[1]}).status == 200
        page.goto(app_url + "/desk")
        select_loan(page, tool["tag"])
        focused(card(page, tool["parts"][0]))
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        group = page.get_by_role("radiogroup", name=f"Condition of {tool['name']}")
        focused(group.get_by_role("radio").first)
        group.get_by_role("radio", name="Good").focus()
        page.keyboard.press("Space")
        pick_photo(page, detail(page).get_by_role("button", name="Take or choose photo"))
        returned = page.get_by_role("textbox", name="Return time")
        returned.fill("yesterday")
        page.keyboard.press("Control+Enter")
        focused(page.get_by_role("alert", name="Form problems"))
        expect(page.get_by_text("Use YYYY-MM-DD HH:MM in library time.").first).to_be_visible()
        returned.fill(skipped_text)
        page.keyboard.press("Control+Enter")
        expect(page.get_by_text("That time does not exist in library time because the clocks go forward.").first).to_be_visible()
        returned.fill(when.strftime("%Y-%m-%d %H:%M"))
        page.keyboard.press("Control+Enter")
        page.get_by_role("dialog", name="Confirm check-in").get_by_role("button", name="Confirm").press("Enter")
        total = min(loan["fee_rules"]["late_fee_cents"] * 2, MAX_COST)
        expect(desk_news(page)).to_have_text(f"Returned complete. Fee raised: ${dollars(total)}.", timeout=EXPECT_MS)
    finally:
        context.close()
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert datetime.fromisoformat(final["returned_at"]) == when and final["open_days_late"] == 2
    fee = ok(coord.get(f"/api/fees/{final['fee_id']}"))["fee"]
    invoice = kb_invoice(killbill, BEN[0], fee["killbill_invoice_id"])
    assert [(it["description"], round(float(it["amount"]) * 100)) for it in invoice["items"]] == \
        [(ln["description"], ln["amount_cents"]) for ln in fee["lines"]]
    with screen(browser, app_url, BEN, f"/fees/{fee['id']}") as page:
        lines = page.get_by_role("table", name="Fee lines")
        for ln in fee["lines"]:
            expect(lines).to_contain_text(ln["description"], timeout=EXPECT_MS)
            expect(lines).to_contain_text(f"${dollars(ln['amount_cents'])}")
        expect(page.get_by_role("button", name=f"Pay ${dollars(fee['total_cents'])}")).to_be_visible()


def test_pay_fee_once(app_url, killbill):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, ELI[0])
    eli, ben = signin(app_url, ELI), signin(app_url, BEN)
    err(coord.post(f"/api/fees/{fee['id']}/pay"), 403, "Only members can do that.")
    err(ben.post(f"/api/fees/{fee['id']}/pay"), 404, "Not found.")
    ok(eli.post(f"/api/fees/{fee['id']}/waiver-request", {"reason": "Please"}), 201)
    results = race([lambda i=i: eli.on(app_url if i % 2 else outage(SHORT)).post(f"/api/fees/{fee['id']}/pay")
                    for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(200) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == "This fee is already settled." for r in results if r.status_code == 409)
    settled = next(r.json()["fee"] for r in results if r.status_code == 200)
    assert settled["status"] == "settled" and settled["waiver"]["status"] == "requested"
    assert len(kb_fee_payments(killbill, ELI[0], fee["id"])) == 1
    assert killbill.payment_by_key(f"pegworth-fee-{fee['id']}")
    assert float(kb_invoice(killbill, ELI[0], fee["killbill_invoice_id"])["balance"]) == 0
    err(coord.post(f"/api/fees/{fee['id']}/waiver-decision", {"decision": "approve"}), 409, "This fee is already settled.")


def test_waiver_decisions_api(app_url, killbill):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, ADA[0])
    ada, vol = signin(app_url, ADA), signin(app_url, TOMASZ)
    path = f"/api/fees/{fee['id']}"
    for reason in ("", "x" * 501):
        assert "reason" in err(ada.post(path + "/waiver-request", {"reason": reason}), 422)["fields"]
    asked = ok(ada.post(path + "/waiver-request", {"reason": TWO_LINES}), 201)["fee"]
    assert asked["waiver"]["status"] == "requested" and asked["waiver"]["reason"] == TWO_LINES
    err(ada.post(path + "/waiver-request", {"reason": "again"}), 409, "A waiver request is already waiting.")
    err(vol.post(path + "/waiver-decision", {"decision": "approve"}), 403, "Only the coordinator can do that.")
    assert "decision" in err(coord.post(path + "/waiver-decision", {"decision": "maybe"}), 422)["fields"]
    declined = ok(coord.post(path + "/waiver-decision", {"decision": "decline"}))["fee"]
    assert declined["status"] == "raised" and declined["waiver"]["status"] == "declined"
    err(coord.post(path + "/waiver-decision", {"decision": "approve"}), 409, "There is no waiver request to decide.")
    assert not kb_credits(killbill, ADA[0], fee["id"])
    ok(ada.post(path + "/waiver-request", {"reason": "Please reconsider"}), 201)
    results = race([lambda i=i: coord.on(app_url if i % 2 else outage(SHORT)).post(
        path + "/waiver-decision", {"decision": "approve"}) for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(200) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == "This fee has been waived." for r in results if r.status_code == 409)
    assert ok(coord.get(path))["fee"]["status"] == "waived-by-coordinator"
    credits = kb_credits(killbill, ADA[0], fee["id"])
    assert len(credits) == 1 and round(abs(float(credits[0]["amount"])) * 100) == fee["total_cents"]
    assert float(kb_invoice(killbill, ADA[0], fee["killbill_invoice_id"])["balance"]) == 0
    err(ada.post(path + "/pay"), 409, "This fee has been waived.")


def test_wf_fee_settlement_pay_keyboard(browser, app_url, killbill):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, BEN[0])
    with screen(browser, app_url, BEN, "/account") as page:
        links = page.get_by_role("table", name="Your fees").get_by_role("link")
        expect(links.first).to_be_visible(timeout=EXPECT_MS)
        hrefs = [links.nth(i).get_attribute("href") or "" for i in range(links.count())]
        links.nth(next(i for i, h in enumerate(hrefs) if h.endswith(f"/fees/{fee['id']}"))).click()
        expect(page).to_have_url(app_url + f"/fees/{fee['id']}", timeout=EXPECT_MS)
        expect(page.get_by_role("heading", name=f"Fee {fee['id']}")).to_be_visible()
        pay = page.get_by_role("button", name=f"Pay ${dollars(fee['total_cents'])}")
        tab_to(page, pay)
        pays = []
        page.on("request", lambda r: pays.append(r) if r.method == "POST" and r.url.endswith("/pay") else None)
        with held(page, f"**/api/fees/{fee['id']}/pay") as gate:
            page.keyboard.press("Enter")
            pending = page.get_by_role("button", name="Paying...")
            expect(pending).to_have_attribute("aria-busy", "true")
            page.keyboard.press("Enter")
            gate.release()
        expect(account_news(page)).to_have_text("Fee settled.", timeout=EXPECT_MS)
        expect(page.get_by_role("table", name="Fee lines")).to_be_focused()
        expect(page.get_by_role("button", name="Request a waiver")).to_have_count(0)
        expect(pay).to_have_count(0)
        assert len(pays) == 1
        page.goto(app_url + "/account")
        rows = page.get_by_role("table", name="Your fees").get_by_role("row")
        expect(rows.first).to_be_visible(timeout=EXPECT_MS)
        mine = [rows.nth(i) for i in range(rows.count())
                if any((a.get_attribute("href") or "").endswith(f"/fees/{fee['id']}")
                       for a in rows.nth(i).get_by_role("link").all())]
        assert len(mine) == 1
        expect(mine[0]).to_contain_text("settled")
    assert ok(coord.get(f"/api/fees/{fee['id']}"))["fee"]["status"] == "settled"
    assert len(kb_fee_payments(killbill, BEN[0], fee["id"])) == 1


def test_wf_fee_settlement_waiver_keyboard(browser, app_url, killbill):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, CLEO[0])
    total = f"Pay ${dollars(fee['total_cents'])}"
    with screen(browser, app_url, CLEO, f"/fees/{fee['id']}") as member, \
            screen(browser, app_url, COORD, f"/fees/{fee['id']}", PHONE) as office:
        ask = member.get_by_role("button", name="Request a waiver")
        tab_to(member, ask)
        member.keyboard.press("Enter")
        dialog = member.get_by_role("dialog", name="Request a waiver")
        reason = dialog.get_by_role("textbox", name="Reason")
        expect(reason).to_be_focused()
        member.keyboard.type(REASON_LINES[0])
        member.keyboard.press("Enter")
        member.keyboard.type(REASON_LINES[1])
        expect(dialog).to_be_visible()
        advance(member, REFRESH_MS * 2)
        expect(reason).to_have_value("\n".join(REASON_LINES))
        expect(reason).to_be_focused()
        member.keyboard.press("Tab")
        send = dialog.get_by_role("button", name="Send request")
        expect(send).to_be_focused()
        member.keyboard.press("Tab")
        expect(reason).to_be_focused()
        member.keyboard.press("Shift+Tab")
        expect(send).to_be_focused()
        member.keyboard.press("Enter")
        expect(account_news(member)).to_have_text("Waiver requested. The coordinator will decide.", timeout=EXPECT_MS)
        expect(member.get_by_role("button", name=total)).to_be_focused()
        office.reload()
        approve = office.get_by_role("button", name="Approve waiver")
        tab_to(office, approve)
        office.keyboard.press("Enter")
        expect(account_news(office)).to_have_text("Fee waived.", timeout=EXPECT_MS)
        expect(office.get_by_role("table", name="Fee lines")).to_be_focused()
    final = ok(coord.get(f"/api/fees/{fee['id']}"))["fee"]
    assert final["status"] == "waived-by-coordinator" and final["waiver"]["reason"] == "\n".join(REASON_LINES)
    assert len(kb_credits(killbill, CLEO[0], fee["id"])) == 1


def test_signin_next_rules(browser, app_url):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, BEN[0])
    cases = [(ADA, "%2F%2Fevil.example%2Fx", "/account"), (ADA, "https%3A%2F%2Fevil.example", "/account"),
             (ADA, "%2F%5Cevil.example", "/account"), (ADA, "%2Foffice", "/account"), (TOMASZ, "%2Faccount", "/desk"),
             (ADA, "%2F", "/"), (COORD, "%2Fdesk", "/desk"), (ADA, "", "/account"), (COORD, "", "/office")]
    for who, nxt, landing in cases:
        with open_app(browser, app_url + "/signin" + (f"?next={nxt}" if nxt else "")) as page:
            ui_signin(page, who)
            expect(page).to_have_url(app_url + landing, timeout=EXPECT_MS)
    with open_app(browser, app_url + f"/signin?next=%2Ffees%2F{fee['id']}") as page:
        ui_signin(page, ADA)
        expect(page).to_have_url(app_url + f"/fees/{fee['id']}", timeout=EXPECT_MS)
        expect(page.get_by_role("heading", name="We couldn't find that page.")).to_be_visible()
        expect(page.get_by_role("link", name="Pegboard").first).to_be_visible()
        page.goto(app_url + "/signin")
        expect(page).to_have_url(app_url + "/account", timeout=EXPECT_MS)
        expect(page.get_by_role("link", name="Account")).to_be_visible()
        expect(page.get_by_role("link", name="Desk")).to_have_count(0)
    with open_app(browser, app_url + f"/fees/{fee['id']}") as page:
        expect(page).to_have_url(app_url + f"/signin?next=%2Ffees%2F{fee['id']}", timeout=EXPECT_MS)
        ui_signin(page, (BEN[0], "wrong-password"))
        expect(account_news(page)).to_have_text("Email or password is incorrect.", timeout=EXPECT_MS)
        expect(page).to_have_url(app_url + f"/signin?next=%2Ffees%2F{fee['id']}")
        ui_signin(page, BEN)
        expect(page).to_have_url(app_url + f"/fees/{fee['id']}", timeout=EXPECT_MS)
        expect(page.get_by_role("heading", name=f"Fee {fee['id']}")).to_be_visible()


def test_roles_reach_own_screens(browser, app_url):
    coord = signin(app_url, COORD)
    for who, path in ((ADA, "/desk"), (ADA, "/office"), (TOMASZ, "/office"), (TOMASZ, "/account"), (COORD, "/account")):
        with screen(browser, app_url, who, path) as page:
            expect(page).to_have_url(app_url + path)
            expect(page.get_by_role("heading", name="We couldn't find that page.")).to_be_visible(timeout=EXPECT_MS)
    for who, role in ((COORD, "coordinator"), (TOMASZ, "volunteer"), ((ADA[0].upper(), ADA[1]), "member")):
        assert ok(Api(app_url).post("/api/session", {"email": who[0], "password": who[1]}))["user"]["role"] == role
    err(Api(app_url).post("/api/session", {"email": ADA[0], "password": "nope-nope-nope"}), 401,
        "Email or password is incorrect.")
    err(signin(app_url, TOMASZ)("PUT", "/api/settings", {}), 403, "Only the coordinator can do that.")
    err(signin(app_url, ADA).get("/api/members"), 403, "Only desk staff can do that.")
    err(coord.post("/api/holds", {"item_id": add_tool(coord)["id"]}), 403, "Only members can do that.")


def test_wf_photo_evidence_isolation(app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tool = add_tool(coord)
    first, second = jpeg(), webp()
    captured = (lib.now - timedelta(minutes=5)).astimezone(ZoneInfo(OTHER_ZONE)).replace(microsecond=0)
    loan = ok(reserve(coord, member_ids(coord)[ADA[0]], [tool], backdated(lib)), 201)["loan"]
    loan = ok(checkout(coord, loan, first, "image/jpeg", captured.isoformat()))["loan"]
    hang_all(coord, loan)
    body = ok(checkin(coord, loan, photo=second, kind="image/webp"))
    fee = body["fee"]
    ada, ben = signin(app_url, ADA), signin(app_url, BEN)
    busy = add_tool(coord)
    lend(coord, BEN[0], [busy])
    hold = ok(ada.post("/api/holds", {"item_id": busy["id"]}), 201)["hold"]
    photos = {p["event"]: p for p in body["loan"]["photos"]}
    for p in photos.values():
        assert ada.get(f"/api/photos/{p['id']}").status_code == 200
        err(ben.get(f"/api/photos/{p['id']}"), 404, "Not found.")
    err(ben.get(f"/api/loans/{loan['id']}"), 404, "Not found.")
    err(ben.get(f"/api/fees/{fee['id']}"), 404, "Not found.")
    err(ben.post(f"/api/fees/{fee['id']}/pay"), 404, "Not found.")
    err(ben.post(f"/api/fees/{fee['id']}/waiver-request", {"reason": ""}), 404, "Not found.")
    err(ben.get(f"/api/loans?member_id={member_ids(coord)[ADA[0]]}"), 404, "Not found.")
    assert loan["id"] not in [x["id"] for x in ok(ben.get("/api/loans"))["loans"]]
    assert fee["id"] not in [x["id"] for x in ok(ben.get("/api/fees"))["fees"]]
    if hold:
        err(ben("DELETE", f"/api/holds/{hold['id']}"), 404, "Not found.")


def test_wf_photo_evidence_compare(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    loan = lend(coord, BEN[0], [tool], photo=png(*BIG_PHOTO))
    hang_all(coord, loan)
    store_down = coord.on(outage(STORAGE_DOWN))
    pend = ok(checkin(store_down, loan, grades={str(tool["id"]): "damaged"}), 202)["loan"]
    assert pend["status"] == "pending-photo"
    lib = Library(coord)
    shot = next(p for p in pend["photos"] if p["event"] == "checkout")
    stamp = library_stamp(lib, shot["captured_at"])
    with screen(browser, app_url, COORD, f"/loans/{loan['id']}") as page:
        expect(page.get_by_role("img", name=f"Checkout photo, captured {stamp}")).to_be_visible(timeout=EXPECT_MS)
        expect(page.get_by_text("No check-in photo yet.")).to_be_visible()
        fetches = []
        page.on("request", lambda r: fetches.append(r.url) if f"/api/photos/{shot['id']}" in r.url else None)
        link = page.get_by_role("link", name="Open original").first
        link.focus()
        scroll = page.evaluate("() => window.scrollY")
        done = ok(finish(coord, pend))
        late = next(p for p in done["loan"]["photos"] if p["event"] == "checkin")
        advance(page, REFRESH_MS)
        expect(page.get_by_role("img", name=f"Check-in photo, captured {library_stamp(lib, late['captured_at'])}")
               ).to_be_visible(timeout=EXPECT_MS)
        expect(link).to_be_focused()
        assert page.evaluate("() => window.scrollY") == scroll
        assert fetches == []


def test_photo_comparison_widths(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    loan = lend(coord, BEN[0], [tool], photo=png(*BIG_PHOTO))
    hang_all(coord, loan)
    done = ok(checkin(coord, loan, grades={str(tool["id"]): "damaged"}))
    fee = done["fee"]
    lib = Library(coord)
    stamps = {p["event"]: library_stamp(lib, p["captured_at"]) for p in done["loan"]["photos"]}
    with screen(browser, app_url, COORD, f"/fees/{fee['id']}") as page:
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.reload()
            out_img = page.get_by_role("img", name=f"Checkout photo, captured {stamps['checkout']}")
            in_img = page.get_by_role("img", name=f"Check-in photo, captured {stamps['checkin']}")
            expect(in_img).to_be_visible(timeout=EXPECT_MS)
            a, b = box(out_img), box(in_img)
            if width == PHONE[0]:
                assert a["y"] + a["height"] <= b["y"] + ALIGN_PX and a["width"] <= width
            else:
                assert abs(a["y"] - b["y"]) <= ALIGN_PX and a["x"] + a["width"] <= b["x"]
                assert a["width"] <= width / 2 and b["width"] <= width / 2
            for p in done["loan"]["photos"]:
                expect(page.get_by_text(p["sha256"])).to_be_visible()
            layout(page)
    seeded = next(x for x in ok(coord.get("/api/loans"))["loans"] if x["ref"] == "L-0001")
    with screen(browser, app_url, COORD, f"/loans/{seeded['id']}", PHONE) as page:
        expect(page.get_by_text("No checkout photo — this loan predates photos.")).to_be_visible(timeout=EXPECT_MS)
        layout(page)


def test_wf_storage_outage_finish_race(app_url, killbill, mail):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    down = coord.on(outage(STORAGE_DOWN))
    tool_a, tool_b, tool_c = add_tool(coord), add_tool(coord), add_tool(coord)
    first = lend(coord, BEN[0], [tool_a], at=backdated(lib))
    hang_all(coord, first)
    photos = [png() for _ in range(RACERS)]
    other = coord.on(outage(SHORT))
    results = race([lambda i=i: checkin(coord if i % 2 else other, first, photo=photos[i]) for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(200) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == "This loan is already checked in." for r in results if r.status_code == 409)
    keys = S3().keys(f"loans/{first['ref']}/checkin/")
    assert len(keys) == 1 and S3().get(keys[0]) == photos[codes.index(200)]
    fee = results[codes.index(200)].json()["fee"]
    acct = kb_account(killbill, BEN[0])
    assert len([i for i in killbill.invoices(acct["accountId"])
                if any(tool_a["tag"] in (it.get("description") or "") for it in i.get("items", []))]) == 1
    assert len(mails_for(mail, f"Pegworth fees for loan {first['ref']}: ${dollars(fee['total_cents'])}", BEN[0])) == 1

    second = lend(coord, BEN[0], [tool_b], at=backdated(lib))
    ok(hang(down, second, second["parts"][0]))
    held_back = ok(checkin(down, second), 202)
    pend = held_back["loan"]
    assert pend["status"] == "pending-photo" and held_back["fee"] is None and pend["fee_id"] is None
    assert S3().keys(f"loans/{second['ref']}/checkin/") == []
    assert not [i for i in killbill.invoices(acct["accountId"])
                if any(tool_b["tag"] in (it.get("description") or "") for it in i.get("items", []))]
    results = race([lambda i=i: finish(coord if i % 2 else other, second, photos[i]) for i in range(RACERS)])
    codes = [r.status_code for r in results]
    assert codes.count(200) == 1 and codes.count(409) == RACERS - 1, codes
    assert all(r.json()["error"] == "This loan is not waiting for a photo." for r in results if r.status_code == 409)
    won = results[codes.index(200)].json()
    assert len(mails_for(mail, f"Pegworth fees for loan {second['ref']}: ${dollars(won['fee']['total_cents'])}", BEN[0])) == 1
    keys = S3().keys(f"loans/{second['ref']}/checkin/")
    assert len(keys) == 1 and S3().get(keys[0]) == photos[codes.index(200)]
    racer = ok(reserve(coord, member_ids(coord)[ADA[0]], [tool_c]), 201)["loan"]
    shots = [png() for _ in range(RACERS)]
    outs = race([lambda i=i: checkout(coord if i % 2 else other, racer, shots[i]) for i in range(RACERS)])
    codes = [r.status_code for r in outs]
    assert codes.count(200) == 1 and codes.count(409) == RACERS - 1, codes
    winner = shots[codes.index(200)]
    keys = S3().keys(f"loans/{racer['ref']}/checkout/")
    assert len(keys) == 1 and S3().get(keys[0]) == winner
    records = [p for p in ok(coord.get(f"/api/loans/{racer['id']}"))["loan"]["photos"] if p["event"] == "checkout"]
    assert len(records) == 1 and records[0]["sha256"] == hashlib.sha256(winner).hexdigest()


def test_wf_storage_outage_recover(app_url):
    billing, storage = Relay(os.environ["KILLBILL_URL"]), Relay(os.environ["S3_ENDPOINT"])
    try:
        with app_copy({"KILLBILL_URL": billing.url, "S3_ENDPOINT": storage.url}) as (base, tail):
            wait_for(lambda: ok(Api(base).get("/api/status")) == {"storage": "down", "billing": "down"}, PROBE_DEADLINE_S,
                     "both providers reported down")
            billing.up()
            wait_for(lambda: ok(Api(base).get("/api/status"))["billing"] == "up", PROBE_DEADLINE_S, "billing up")
            coord = signin(app_url, COORD)
            tool = add_tool(coord)
            loan = lend(coord, ELI[0], [tool])
            copy = coord.on(base)
            hang_all(copy, loan)
            pend = ok(checkin(copy, loan), 202)["loan"]
            assert pend["status"] == "pending-photo"
            storage.up()
            wait_for(lambda: ok(Api(base).get("/api/status"))["storage"] == "up", PROBE_DEADLINE_S, "storage up")
            data = png()
            done = ok(finish(copy, loan, data))
            assert done["loan"]["status"] == "returned-complete" and done["fee"] is None
            keys = S3().keys(f"loans/{loan['ref']}/checkin/")
            assert len(keys) == 1 and S3().get(keys[0]) == data
    finally:
        billing.down()
        storage.down()


def test_wf_storage_outage_two_desks(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    first, second = board_order(kit["parts"])
    loan = lend(coord, ELI[0], [kit])
    with screen(browser, outage(STORAGE_DOWN), TOMASZ, "/desk") as down, screen(browser, app_url, PRIYA, "/desk") as rival:
        expect(down.get_by_role("status", name="Service status")).to_contain_text(STORAGE_BANNER, timeout=EXPECT_MS)
        select_loan(down, kit["tag"])
        focused(card(down, first))
        down.keyboard.press("Space")
        down.keyboard.press("Enter")
        expect(desk_news(down)).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        down.get_by_role("radiogroup", name=f"Condition of {kit['name']}").get_by_role("radio", name="Good").check()
        pick_photo(down, detail(down).get_by_role("button", name="Take or choose photo"))
        down.keyboard.press("Control+Enter")
        down.get_by_role("dialog", name="Confirm check-in").get_by_role("button", name="Confirm").press("Enter")
        expect(desk_news(down)).to_have_text("Saved as pending photo. Nothing has been charged.", timeout=EXPECT_MS)
        assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "pending-photo"
        assert S3().keys(f"loans/{loan['ref']}/checkin/") == []
        assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["fee_id"] is None
        rival_item = rival.get_by_role("list", name="Open loans").get_by_role("listitem").filter(has_text=loan["ref"])

        def rival_sees_pending():
            advance(rival, REFRESH_MS // 10)
            return "pending photo" in (rival_item.text_content() or "")

        wait_for(rival_sees_pending, EXPECT_MS / 1000, "rival desk shows the loan pending photo")
        select_loan(rival, kit["tag"])
        photo = detail(rival).get_by_role("button", name="Take or choose photo")
        focused(photo)
        pick_photo(rival, photo)
        advance(rival, DESK_POLL_MS)
        finish_button = detail(rival).get_by_role("button", name="Finish check-in")
        expect(finish_button).to_be_enabled(timeout=EXPECT_MS)
        finish_button.click()
        expect(desk_news(rival)).to_have_text(f"Returned — partial. Missing: {second['name']}.", timeout=EXPECT_MS)
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert final["status"] == "returned-partial" and final["missing_parts"] == [second["name"]]
    assert len(S3().keys(f"loans/{loan['ref']}/checkin/")) == 1


def test_wf_billing_outage_retry(app_url, killbill):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    fee, _, _ = raised_fee(coord, ADA[0])
    base = outage(BILLING_DOWN)
    ada, cdown = signin(app_url, ADA).on(base), coord.on(base)
    assert ok(cdown.get("/api/status"))["billing"] == "down"
    err(ada.post(f"/api/fees/{fee['id']}/pay"), 503, BILLING_DOWN_COPY)
    assert kb_fee_payments(killbill, ADA[0], fee["id"]) == []
    ok(ada.post(f"/api/fees/{fee['id']}/waiver-request", {"reason": "Please"}), 201)
    err(cdown.post(f"/api/fees/{fee['id']}/waiver-decision", {"decision": "approve"}), 503,
        "Billing is down. The waiver was not posted; try again when it is back.")
    assert kb_credits(killbill, ADA[0], fee["id"]) == []
    assert ok(coord.get(f"/api/fees/{fee['id']}"))["fee"]["status"] == "raised"
    late_tool, fresh_tool = add_tool(coord), add_tool(coord)
    late = lend(coord, ADA[0], [late_tool], at=backdated(lib))
    hang_all(cdown, late)
    err(checkin(cdown, late), 503, "Billing is down. This check-in was not saved; try again when it is back.")
    kept = ok(coord.get(f"/api/loans/{late['id']}"))["loan"]
    assert kept["status"] == "out" and {p["state"] for p in kept["parts"]} == {"hung"} and kept["fee_id"] is None
    assert S3().keys(f"loans/{late['ref']}/checkin/") == []
    fresh = ok(reserve(cdown, member_ids(coord)[ADA[0]], [fresh_tool]), 201)["loan"]
    fresh = ok(checkout(cdown, fresh))["loan"]
    ok(signin(app_url, BEN).on(base).post("/api/holds", {"item_id": fresh_tool["id"]}), 201)
    hang_all(cdown, fresh)
    assert ok(checkin(cdown, fresh))["fee"] is None
    assert ok(signin(app_url, ADA).post(f"/api/fees/{fee['id']}/pay"))["fee"]["status"] == "settled"
    assert len(kb_fee_payments(killbill, ADA[0], fee["id"])) == 1


def test_wf_billing_outage_refusals_stay(browser, app_url):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, ELI[0])
    base = outage(BILLING_DOWN)
    label = f"Pay ${dollars(fee['total_cents'])}"
    with screen(browser, base, ELI, f"/fees/{fee['id']}") as page:
        pay = page.get_by_role("button", name=label)
        tab_to(page, pay)
        page.keyboard.press("Enter")
        expect(account_news(page)).to_have_text(BILLING_DOWN_COPY, timeout=EXPECT_MS)
        for step in (BANNER_MS, REFRESH_MS * 2):
            advance(page, step)
            expect(account_news(page)).to_have_text(BILLING_DOWN_COPY)
            expect(pay).to_be_focused()
            assert pay.get_attribute("aria-disabled") is None and pay.get_attribute("aria-busy") is None
        expect(page.get_by_role("status", name="Service status")).to_contain_text(BILLING_BANNER, timeout=EXPECT_MS)
        page.goto(base + "/account")
        opener = page.get_by_role("button", name="Cancel at end of term")
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Cancel membership")
        confirm = dialog.get_by_role("button", name="Confirm cancel")
        expect(confirm).to_be_focused()
        page.keyboard.press("Enter")
        expect(account_news(page)).to_have_text(BILLING_DOWN_COPY, timeout=EXPECT_MS)
        for step in (BANNER_MS, REFRESH_MS * 2):
            advance(page, step)
            expect(dialog).to_be_visible()
            expect(confirm).to_be_focused()
            expect(account_news(page)).to_have_text(BILLING_DOWN_COPY)
    assert ok(coord.get(f"/api/fees/{fee['id']}"))["fee"]["status"] == "raised"
    assert ok(signin(app_url, ELI).get("/api/me"))["membership"]["ends_at_term"] is False


def test_closure_moves_due_dates(app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    loan = lend(coord, ADA[0], [tool])
    due = loan["due_date"]
    try:
        made = ok(coord.post("/api/closures", {"date": due, "reason": f"Probe {uuid.uuid4().hex[:6]}"}), 201)
        lib = Library(coord)
        nxt = lib.open_from(as_date(due) + timedelta(days=1))
        assert made["new_due_date"] == nxt.isoformat() and made["moved_loans"] >= 1
        moved = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
        assert moved["due_date"] == nxt.isoformat() and moved["due_by"] == lib.hours[WEEKDAYS[nxt.weekday()]]["closes"]
        err(coord.post("/api/closures", {"date": due, "reason": "Again"}), 409, "That day is already closed.")
        yesterday = (lib.today - timedelta(days=1)).isoformat()
        assert "date" in err(coord.post("/api/closures", {"date": yesterday, "reason": "Past"}), 422)["fields"]
        shut = next(lib.today + timedelta(days=k) for k in range(1, 8) if WEEKDAYS[(lib.today + timedelta(days=k)).weekday()] not in lib.hours)
        assert "date" in err(coord.post("/api/closures", {"date": shut.isoformat(), "reason": "Shut"}), 422)["fields"]
    finally:
        assert coord("DELETE", f"/api/closures/{due}").status_code == 204
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["due_date"] == nxt.isoformat()


def test_hours_edits_change_due_by(app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    extra = next(w for w in WEEKDAYS if w not in {h["weekday"] for h in hours0})
    fee, _, _ = raised_fee(coord, CLEO[0])
    try:
        ok(put_hours(coord, hours0 + [{"weekday": extra, "opens": "10:00", "closes": "12:00"}]))
        lib = Library(coord)
        back = (lib.today.weekday() - WEEKDAYS.index(extra)) % 7
        tool = add_tool(coord)
        loan = lend(coord, ADA[0], [tool], at=(lib.now - timedelta(days=back)).isoformat())
        assert WEEKDAYS[as_date(loan["due_date"]).weekday()] == extra and loan["due_by"] == "12:00"
        shortened = ok(put_hours(coord, hours0 + [{"weekday": extra, "opens": "10:00", "closes": "11:00"}]))
        assert shortened["moved_loans"] == 0
        read = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
        assert read["due_date"] == loan["due_date"] and read["due_by"] == "11:00"
    finally:
        ok(put_hours(coord, hours0))
    assert ok(coord.get(f"/api/fees/{fee['id']}"))["fee"]["lines"] == fee["lines"]


def test_hours_refusal_order(app_url):
    coord, vol = signin(app_url, COORD), signin(app_url, TOMASZ)
    before = current_hours(coord)
    body = {"hours": [{"weekday": "saturday", "opens": "10:00", "closes": "09:00"},
                      {"weekday": "thursday", "opens": "16:10", "closes": "16:00"}]}
    err(vol("PUT", "/api/calendar/hours", body), 403, "Only the coordinator can do that.")
    err(vol("PUT", "/api/calendar/hours", content=json.dumps(body), headers={"content-type": "text/plain"}), 403,
        "Only the coordinator can do that.")
    err(coord("PUT", "/api/calendar/hours", content=json.dumps(body), headers={"content-type": "text/plain"}), 415, "Send JSON.")
    err(coord("PUT", "/api/calendar/hours", content=json.dumps({**body, "pad": "x" * JSON_LIMIT}),
              headers={"content-type": "application/json"}), 413, "Request is too large.")
    r = err(put_hours(coord, body["hours"]), 422)
    assert r == {"error": SUMMARY, "fields": {"hours.thursday.opens": "Use a 24-hour time on the quarter hour, like 18:15.",
                                              "hours.saturday.closes": "Closing time must be later than opening time."}}
    assert list(r["fields"]) == ["hours.thursday.opens", "hours.saturday.closes"]
    for bad in ([], [{"weekday": "funday", "opens": "10:00", "closes": "12:00"}],
                [{"weekday": "monday", "opens": "10:00", "closes": "12:00"}] * 2):
        assert list(err(put_hours(coord, bad), 422)["fields"]) == ["hours"]
    assert list(err(coord("PUT", "/api/calendar/hours", {"hours": "monday"}), 422)["fields"]) == ["hours"]
    r = err(put_hours(coord, [{"weekday": "sunday", "opens": "12:05", "closes": "16:00"},
                              {"weekday": "monday", "opens": "10:00", "closes": "25:00"}]), 422)
    assert list(r["fields"]) == ["hours.monday.closes", "hours.sunday.opens"]
    assert current_hours(coord) == before


def test_due_tomorrow_reminder(app_url, mail):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    lifted = None
    try:
        ok(put_hours(coord, [{"weekday": w, "opens": "10:00", "closes": "16:00"} for w in WEEKDAYS]))
        tomorrow = (Library(coord).today + timedelta(days=1)).isoformat()
        lifted = next((c for c in ok(coord.get("/api/calendar"))["closures"] if c["date"] == tomorrow), None)
        if lifted:
            assert coord("DELETE", f"/api/closures/{tomorrow}").status_code == 204
        lib = Library(coord)
        tool = add_tool(coord)
        period = lib.settings["loan_period_days"]
        at = lib.now.astimezone(lib.tz).replace(hour=12, minute=0, second=0, microsecond=0) - timedelta(days=period - 1)
        loan = lend(coord, ADA[0], [tool], at=at.isoformat())
        assert loan["due_date"] == tomorrow, loan["due_date"]
        found = mails_for(mail, f"Due tomorrow at Pegworth: {loan['ref']}", ADA[0])
        assert len(found) == 1
        body = text(found[0])
        for piece in (tool["name"], tool["tag"], loan["due_date"], "16:00"):
            assert piece in body
        hang_all(coord, loan)
        ok(checkin(coord, loan))
    finally:
        ok(put_hours(coord, hours0))
        if lifted:
            ok(coord.post("/api/closures", {"date": lifted["date"], "reason": lifted["reason"]}), 201)


def test_wf_opening_calendar_office_phone(browser, app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    open_days = [h["weekday"] for h in hours0]
    edit, extra, other = open_days[0], next(w for w in WEEKDAYS if w not in open_days), open_days[-1]
    cap = str.capitalize
    try:
        with screen(browser, app_url, COORD, "/office", PHONE) as page:
            table = page.get_by_role("table", name="Opening hours")

            def cb(w):
                return table.get_by_role("checkbox", name=f"Open on {cap(w)}")

            def opens(w):
                return table.get_by_role("textbox", name=f"{cap(w)} opens")

            def closes(w):
                return table.get_by_role("textbox", name=f"{cap(w)} closes")

            expected = []
            for w in WEEKDAYS:
                expected += [f"Open on {cap(w)}"] + ([f"{cap(w)} opens", f"{cap(w)} closes"] if w in open_days else [])
            expected.append("Save hours")
            cb("monday").focus()
            assert tab_names(page, len(expected) - 1) == expected[1:]
            cb(extra).focus()
            page.keyboard.press("Space")
            expect(cb(extra)).to_be_checked()
            expect(opens(extra)).to_be_enabled()
            for field, value in ((opens(extra), "09:00"), (closes(extra), "08:00"), (closes(edit), "17:10")):
                field.focus()
                page.keyboard.press("ControlOrMeta+a")
                page.keyboard.type(value)
            page.keyboard.press("Enter")
            problems = page.get_by_role("alert", name="Form problems")
            focused(problems)
            order = sorted([extra, edit], key=WEEKDAYS.index)
            links = problems.get_by_role("link")
            expect(links).to_have_count(2)
            for i, w in enumerate(order):
                links.nth(i).focus()
                page.keyboard.press("Enter")
                expect(closes(w)).to_be_focused()
            cb(extra).focus()
            page.keyboard.press("Space")
            expect(cb(extra)).not_to_be_checked()
            expect(opens(extra)).to_be_disabled()
            expect(opens(extra)).to_have_value("09:00")
            following = f"Open on {cap(WEEKDAYS[WEEKDAYS.index(extra) + 1])}" if extra != "sunday" else "Save hours"
            assert tab_names(page, 1) == [following]
            cb(extra).focus()
            page.keyboard.press("Space")
            expect(opens(extra)).to_be_enabled()
            start_h = int(next(h for h in hours0 if h["weekday"] == edit)["opens"][:2])
            shorter = f"{start_h + 1:02d}:00"
            for field, value in ((closes(extra), "12:00"), (closes(edit), shorter)):
                field.focus()
                page.keyboard.press("ControlOrMeta+a")
                page.keyboard.type(value)
            page.keyboard.press("Enter")
            counted_copy(desk_news(page), "Opening hours saved. ", " loans moved to the next open day.")
        saved = {h["weekday"]: h for h in current_hours(coord)}
        assert saved[edit]["closes"] == shorter and (saved[extra]["opens"], saved[extra]["closes"]) == ("09:00", "12:00")
    finally:
        ok(put_hours(coord, hours0))


def test_wf_opening_calendar_desks_follow(browser, app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    tool = add_tool(coord)
    loan = lend(coord, ADA[0], [tool])
    due = as_date(loan["due_date"])
    weekday = WEEKDAYS[due.weekday()]
    row = next(h for h in hours0 if h["weekday"] == weekday)
    shorter = f"{int(row['opens'][:2]) + 1:02d}:00"
    try:
        with screen(browser, app_url, TOMASZ, "/desk") as desk:
            select_loan(desk, tool["tag"])
            expect(detail(desk)).to_contain_text(f"Due {due.isoformat()} by {row['closes']}", timeout=EXPECT_MS)
            focused(card(desk, tool["parts"][0]))
            desk.keyboard.press("/")
            desk.keyboard.press("ControlOrMeta+a")
            desk.keyboard.type(SCAN_TEXT)
            before = desk_news(desk).text_content()
            ok(put_hours(signin(outage(SHORT), COORD), [{**h, "closes": shorter} if h["weekday"] == weekday else h
                                                        for h in hours0]))
            advance(desk, REFRESH_MS)
            expect(detail(desk)).to_contain_text(f"Due {due.isoformat()} by {shorter}", timeout=EXPECT_MS)
            assert desk_news(desk).text_content() == before
            expect(scan(desk)).to_be_focused()
            expect(scan(desk)).to_have_value(SCAN_TEXT)
        assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["due_by"] == shorter
    finally:
        coord("DELETE", f"/api/closures/{due.isoformat()}")
        ok(put_hours(coord, hours0))


def test_wf_mobile_board_phone_hold(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    lend(coord, ADA[0], [tool])
    ok(signin(app_url, CLEO).post("/api/holds", {"item_id": tool["id"]}), 201)
    token = tool["name"].split()[-1]
    with screen(browser, app_url, ELI, "/", PHONE) as page:
        layout(page)
        find = page.get_by_role("searchbox", name="Find a tool")
        tools = page.get_by_role("table", name="Tools")
        find.focus()
        page.keyboard.type(token)
        advance(page, FILTER_MS)
        expect(tools.get_by_role("row").filter(has_text=tool["tag"])).to_have_count(1, timeout=EXPECT_MS)
        row = tools.get_by_role("row").filter(has_text=tool["tag"])
        expect(row).to_contain_text("out")
        tap(row)

        def detail_in_view():
            advance(page, FRAME_STEP_MS)
            d = box(detail(page))
            return d["y"] < PHONE[1] and d["y"] + d["height"] > 0

        wait_for(detail_in_view, EXPECT_MS / 1000, "item detail scrolled into view")
        expect(detail(page)).to_contain_text(queued_line(1))
        place = page.get_by_role("button", name="Place hold")
        big_enough(place)
        tap(place)
        expect(account_news(page)).to_have_text(hold_placed(2), timeout=EXPECT_MS)
        layout(page)
    mine = [h for h in ok(signin(app_url, ELI).get("/api/holds"))["holds"] if h["item_id"] == tool["id"]]
    assert [(h["status"], h["position"]) for h in mine] == [("queued", 2)]


def test_wf_mobile_board_layouts(browser, app_url):
    with screen(browser, app_url, ELI, "/") as page:
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(app_url + "/")
            t, b, d = (box(page.get_by_role("region", name=n)) for n in ("Tool list", "Pegboard", "Item detail"))
            if width == LAPTOP[0]:
                assert t["x"] + t["width"] <= b["x"] + ALIGN_PX and b["x"] + b["width"] <= d["x"] + ALIGN_PX
                assert abs(t["y"] - b["y"]) <= ALIGN_PX and abs(b["y"] - d["y"]) <= ALIGN_PX
            elif width == TABLET[0]:
                assert t["x"] + t["width"] <= b["x"] + ALIGN_PX and abs(t["y"] - b["y"]) <= ALIGN_PX
                assert d["y"] >= b["y"] + b["height"] - ALIGN_PX and abs(d["x"] - b["x"]) <= ALIGN_PX
            else:
                assert b["y"] < d["y"] < t["y"]
                assert b["x"] >= 0 and b["x"] + b["width"] <= width
            layout(page)
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        for width, height in VIEWPORTS:
            page.set_viewport_size({"width": width, "height": height})
            page.goto(app_url + "/desk")
            q, b, d = (box(page.get_by_role("region", name=n)) for n in ("Loan queue", "Pegboard", "Item detail"))
            if width == LAPTOP[0]:
                assert q["x"] + q["width"] <= b["x"] + ALIGN_PX and b["x"] + b["width"] <= d["x"] + ALIGN_PX
                assert abs(q["y"] - b["y"]) <= ALIGN_PX and abs(b["y"] - d["y"]) <= ALIGN_PX
                assert q["width"] < b["width"] and d["width"] < b["width"]
            elif width == TABLET[0]:
                assert q["x"] + q["width"] <= b["x"] + ALIGN_PX and abs(q["y"] - b["y"]) <= ALIGN_PX
                assert d["y"] >= b["y"] + b["height"] - ALIGN_PX and abs(d["x"] - b["x"]) <= ALIGN_PX
            else:
                s = box(scan(page))
                heads_queue = q["y"] - ALIGN_PX <= s["y"] and s["y"] + s["height"] <= q["y"] + q["height"] + ALIGN_PX
                assert s["y"] < q["y"] or heads_queue, (s, q)
                assert q["y"] < b["y"] < d["y"]
                assert b["x"] >= 0 and b["x"] + b["width"] <= width
            layout(page)


def test_health_and_shell(app_url):
    r = Api(app_url).get("/api/health")
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    shell = Api(app_url).get("/")
    assert shell.status_code == 200 and shell.text.strip()


def test_server_boundary(app_url):
    anon = Api(app_url)
    r = anon.get("/api/health", headers={"origin": EVIL})
    assert not [h for h in r.headers if h.lower().startswith("access-control-")]
    err(anon.post("/api/session", {"email": "a@b.example", "password": "x"}, headers={"origin": EVIL}), 403,
        "Cross-site request refused.")
    base = json.dumps({"email": "nobody@members.example", "password": "nothing-at-all", "pad": ""})
    exact = base.replace('"pad": ""', '"pad": "' + "x" * (JSON_LIMIT - len(base)) + '"')
    assert len(exact.encode()) == JSON_LIMIT
    jh = {"content-type": "application/json"}
    err(anon.post("/api/session", content=exact, headers=jh), 401, "Email or password is incorrect.")
    over_json = exact[:-2] + 'x"}'
    assert len(over_json.encode()) == JSON_LIMIT + 1
    err(anon.post("/api/session", content=over_json, headers=jh), 413, "Request is too large.")
    err(anon.post("/api/session", content=base, headers={"content-type": "text/plain"}), 415, "Send JSON.")
    coord = signin(app_url, COORD)
    loan = ok(reserve(coord, member_ids(coord)[ADA[0]], [add_tool(coord)]), 201)["loan"]
    path = f"/api/loans/{loan['id']}/checkout"
    err(coord.post(path, {"captured_at": "x"}), 415, "Send JSON.")
    over = png() + b"\0" * PHOTO_LIMIT
    err(coord.post(path, files={"photo": ("p", over[:PHOTO_LIMIT + 1], "image/png")},
                   data={"captured_at": server_now(coord).isoformat()}), 413, "Photo must be 5,000,000 bytes or smaller.")
    err(coord.post(path, files={"photo": ("p", over[:MULTIPART_LIMIT + 1], "image/png")},
                   data={"captured_at": server_now(coord).isoformat()}), 413, "Photo must be 5,000,000 bytes or smaller.")
    exact_photo = over[:PHOTO_LIMIT]
    assert ok(checkout(coord, loan, exact_photo))["loan"]["status"] == "out"
    for probe in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/%2e%2e/run.json",
                  "/..%2frun.json", "/.git/config", "/src/server.ts"):
        assert anon.get(probe).status_code == 404, probe
    html = anon.get("/").text
    assets = [anon.get(src).text for src in re.findall(r'(?:src|href)="(/[^"]+)"', html)]
    secrets = [os.environ.get(k) for k in ("KILLBILL_PASSWORD", "KILLBILL_API_SECRET", "KILLBILL_API_KEY", "S3_SECRET_ACCESS_KEY",
                                           "S3_ACCESS_KEY_ID", "DATABASE_URL", "KILLBILL_URL", "S3_ENDPOINT", "S3_BUCKET")]
    for secret in [s for s in secrets if s and len(s) >= 6 and not s.isalpha()]:
        token = re.compile(rf"(?<![\w]){re.escape(secret)}(?![\w])")
        assert not any(token.search(body) for body in [html] + assets), "a credential or provider address reached the browser"
    for name, key in ((STORAGE_DOWN, "storage"), (BILLING_DOWN, "billing")):
        down = Api(outage(name))
        assert down.get("/api/health").status_code == 200
        assert ok(down.get("/api/status"))[key] == "down"


def test_write_refusal_order(app_url):
    coord, vol, ada = signin(app_url, COORD), signin(app_url, TOMASZ), signin(app_url, ADA)
    fee, _, _ = raised_fee(coord, BEN[0])
    pay = f"/api/fees/{fee['id']}/pay"
    err(Api(app_url).post(pay, headers={"origin": EVIL}), 403, "Cross-site request refused.")
    err(Api(app_url).post(pay), 401, "Sign in to continue.")
    err(ada.post(pay), 404, "Not found.")
    err(coord.post(f"/api/fees/{UNKNOWN_ID}/pay"), 404, "Not found.")
    err(coord.post(pay), 403, "Only members can do that.")
    err(vol.post(f"/api/fees/{fee['id']}/waiver-decision", content="{}", headers={"content-type": "text/plain"}), 403,
        "Only the coordinator can do that.")
    tool, lone = add_tool(coord), add_tool(coord)
    reserved = ok(reserve(coord, member_ids(coord)[BEN[0]], [tool]), 201)["loan"]
    hang_path = f"/api/loans/{reserved['id']}/hang"
    err(ada.post(hang_path, {"part_id": tool["parts"][0]["id"], "peg_part_id": tool["parts"][0]["id"]}), 404, "Not found.")
    err(vol.post(hang_path, {"part_id": lone["parts"][0]["id"], "peg_part_id": lone["parts"][0]["id"]}), 404, "Not found.")
    err(vol.post(hang_path, content="{}", headers={"content-type": "text/plain"}), 415, "Send JSON.")
    err(vol.post(hang_path, content=json.dumps({"pad": "x" * JSON_LIMIT}), headers={"content-type": "application/json"}), 413,
        "Request is too large.")
    err(vol.post(hang_path, {"part_id": tool["parts"][0]["id"], "peg_part_id": lone["parts"][0]["id"]}), 422,
        "That peg belongs to a different tool.")
    err(vol.post(hang_path, {"part_id": tool["parts"][0]["id"], "peg_part_id": tool["parts"][0]["id"]}), 409,
        "This loan has not been checked out.")
    day = ok(coord.get("/api/calendar"))["next_open_days"][-1]
    try:
        ok(coord.post("/api/closures", {"date": day, "reason": "Probe"}), 201)
        err(vol.post("/api/closures", {"date": day, "reason": ""}), 403, "Only the coordinator can do that.")
        assert "reason" in err(coord.post("/api/closures", {"date": day, "reason": ""}), 422)["fields"]
        err(coord.post("/api/closures", {"date": day, "reason": "Again"}), 409, "That day is already closed.")
    finally:
        coord("DELETE", f"/api/closures/{day}")
    err(ada("PATCH", f"/api/items/{UNKNOWN_ID}", {"name": ""}), 404, "Not found.")
    err(vol("PATCH", f"/api/items/{tool['id']}", {"name": ""}), 403, "Only the coordinator can do that.")


def test_sessions_end_after_idle(browser, app_url):
    base = outage(SHORT)
    busy, idle = signin(base, BEN), signin(base, ADA)
    started = time.monotonic()
    coord = signin(app_url, COORD)
    wall = ok(coord.get(f"/api/items/{add_tool(coord)['id']}"))["item"]

    def still_busy():
        err(busy.post("/api/holds", {"item_id": wall["id"]}), 409)
        return time.monotonic() - started > IDLE_DEADLINE_S / 3
    wait_for(still_busy, IDLE_DEADLINE_S, "busy session")
    assert busy.get("/api/me").status_code == 200
    wait_for(lambda: idle.get("/api/me").status_code == 401, IDLE_DEADLINE_S, "idle end")
    err(idle.get("/api/me"), 401, "Your session has ended. Sign in again.")
    err(idle.post("/api/holds", {"item_id": wall["id"]}), 401, "Your session has ended. Sign in again.")
    with screen(browser, base, COORD, "/office") as page:
        date_box, reason = page.get_by_role("textbox", name="Closure date"), page.get_by_role("textbox", name="Closure reason")
        date_box.fill(FAR_DATE)
        reason.fill(CLOSURE_REASON)
        jar = {c["name"]: c["value"] for c in page.context.cookies()}
        watcher = Api(base, jar)
        wait_for(lambda: watcher.get("/api/me").status_code == 401, IDLE_DEADLINE_S, "office session end")
        page.get_by_role("button", name="Declare closure").click()
        expect(desk_news(page)).to_have_text("Your session has ended. Sign in again.", timeout=EXPECT_MS)
        again = page.get_by_role("link", name="Sign in again")
        expect(again).to_be_focused()
        expect(reason).to_have_value(CLOSURE_REASON)
        again.click()
        expect(page).to_have_url(base + "/signin?next=%2Foffice", timeout=EXPECT_MS)
        ui_signin(page, COORD)
        expect(page).to_have_url(base + "/office", timeout=EXPECT_MS)
        expect(page.get_by_role("textbox", name="Closure date")).to_have_value(FAR_DATE, timeout=EXPECT_MS)
        expect(page.get_by_role("textbox", name="Closure reason")).to_have_value(CLOSURE_REASON)
    assert FAR_DATE not in {c["date"] for c in ok(signin(app_url, COORD).get("/api/calendar"))["closures"]}


def test_join_kill_bill_records(app_url, killbill):
    name, email = unique("tiered")
    visitor = Api(app_url)
    body = ok(visitor.post("/api/members", {"name": name, "email": email.upper(), "password": JOIN_PASSWORD,
                                            "tier": "pay-what-you-can"}), 202)
    assert body["user"]["name"] == name and body["user"]["email"] == email.lower() and body["user"]["role"] == "member"
    assert body["membership"]["tier"] == "pay-what-you-can"
    assert ok(visitor.get("/api/me"))["user"]["email"] == email.lower()
    wait_active(signin(app_url, (email, JOIN_PASSWORD)))
    acct = kb_account(killbill, email)
    assert acct["email"].lower() == email.lower() and acct["name"] == name and acct["currency"] == "USD"
    assert [s["planName"] for s in killbill.subscriptions(acct["accountId"])] == ["pegworth-pay-what-you-can-annual"]
    assert len(killbill.payments(acct["accountId"])) == 1
    paid = [i for i in killbill.invoices(acct["accountId"]) if float(i["amount"]) == PWYC_PRICE]
    assert len(paid) == 1 and float(paid[0]["balance"]) == 0


def test_wf_join_membership_journey(browser, app_url, killbill):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    lend(coord, ADA[0], [tool])
    name, email = unique("journey")
    with screen(browser, app_url, None, "/join") as page:
        page.get_by_role("radio", name="Standard — $40.00 a year").check()
        page.get_by_role("textbox", name="Name").fill(name)
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("textbox", name="Password").fill(JOIN_PASSWORD)
        page.get_by_role("button", name="Pay and join").click()
        expect(page).to_have_url(app_url + "/account", timeout=EXPECT_MS)
        news = account_news(page)
        text_among(news, (PENDING_COPY, ACTIVE_COPY))

        def active_seen():
            advance(page, PENDING_MS)
            return (news.text_content() or "").strip() == ACTIVE_COPY
        wait_for(active_seen, ACTIVE_DEADLINE_S, "active announcement")
        expect(page.get_by_role("button", name="Cancel at end of term")).to_be_visible(timeout=EXPECT_MS)
        page.goto(app_url + "/")
        page.get_by_role("table", name="Tools").get_by_role("row").filter(has_text=tool["tag"]).click()
        page.get_by_role("button", name="Place hold").click()
        expect(account_news(page)).to_have_text(hold_placed(1), timeout=EXPECT_MS)
    acct = kb_account(killbill, email)
    assert [s["planName"] for s in killbill.subscriptions(acct["accountId"])] == ["pegworth-standard-annual"]
    assert len(killbill.payments(acct["accountId"])) == 1
    mine = [h for h in ok(signin(app_url, (email, JOIN_PASSWORD)).get("/api/holds"))["holds"] if h["item_id"] == tool["id"]]
    assert [(h["status"], h["position"]) for h in mine] == [("queued", 1)]


def test_account_page_keeps_state(browser, app_url):
    name, email = unique("keeper")
    with open_app(browser, app_url + "/signin") as page:
        joined = page.request.post(app_url + "/api/members", data={"name": name, "email": email,
                                                                   "password": JOIN_PASSWORD, "tier": "standard"})
        assert joined.status == 202, joined.text()
        page.goto(app_url + "/account")
        expect(page.get_by_role("heading", name="Your membership")).to_be_visible(timeout=EXPECT_MS)
        page.goto(app_url + "/")
        page.goto(app_url + "/account")
        news = account_news(page)
        expect(page.get_by_role("heading", name="Your membership")).to_be_visible(timeout=EXPECT_MS)
        assert (news.text_content() or "").strip() == ""
        opener = page.get_by_role("button", name="Cancel at end of term")

        def active_shown():
            advance(page, PENDING_MS)
            return opener.count() == 1
        wait_for(active_shown, ACTIVE_DEADLINE_S, "active membership on Account")
        written = (news.text_content() or "").strip()
        assert written in ("", ACTIVE_COPY)
        me_calls = []
        page.on("request", lambda r: me_calls.append(r.url) if r.url.endswith("/api/me") else None)
        opener.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="Cancel membership")
        confirm = dialog.get_by_role("button", name="Confirm cancel")
        expect(confirm).to_be_focused()
        advance(page, REFRESH_MS * 3)
        expect(dialog).to_be_visible()
        expect(confirm).to_be_focused()
        assert (news.text_content() or "").strip() == written
        assert len(me_calls) <= REFRESH_MS * 3 // REFRESH_MS + 1, me_calls


def test_cancel_at_end_of_term(browser, app_url, killbill):
    _, email, member = join_active(app_url, "ender")
    cancelled = ok(member.post("/api/membership/cancel"))["membership"]
    acct = kb_account(killbill, email)
    sub = killbill.subscriptions(acct["accountId"])[0]
    end = (sub.get("billingEndDate") or "")[:10]
    assert end and end == sub["chargedThroughDate"][:10]
    assert (cancelled["status"], cancelled["ends_at_term"], cancelled["active_until"]) == ("active", True, end)
    me = ok(member.get("/api/me"))["membership"]
    assert (me["status"], me["ends_at_term"], me["active_until"]) == ("active", True, end)
    assert as_date(end) > Library(signin(app_url, COORD)).today
    err(member.post("/api/membership/cancel"), 409, "This membership already ends at the end of its term.")
    with screen(browser, app_url, (email, JOIN_PASSWORD), "/account") as page:
        expect(page.get_by_text(f"Active until {end}")).to_be_visible(timeout=EXPECT_MS)
        expect(page.get_by_role("button", name="Cancel at end of term")).to_have_count(0)
        advance(page, REFRESH_MS * 2)
        expect(page.get_by_text(f"Active until {end}")).to_be_visible()
        page.reload()
        expect(page.get_by_text(f"Active until {end}")).to_be_visible(timeout=EXPECT_MS)


def test_hold_queue_rules(app_url):
    coord = signin(app_url, COORD)
    tool, wall = add_tool(coord), add_tool(coord)
    lend(coord, ADA[0], [tool])
    ben, eli = signin(app_url, BEN), signin(app_url, ELI)
    err(ben.post("/api/holds", {"item_id": wall["id"]}), 409, "This tool is on the wall. Ask at the desk to borrow it.")
    err(coord.post("/api/holds", {"item_id": tool["id"]}), 403, "Only members can do that.")
    first = ok(ben.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]
    assert (first["item_id"], first["status"], first["position"]) == (tool["id"], "queued", 1)
    err(ben.post("/api/holds", {"item_id": tool["id"]}), 409, "You already have a hold on this tool.")
    second = ok(eli.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]
    assert second["position"] == 2
    assert ok(coord.get(f"/api/items/{tool['id']}"))["item"]["hold_queue_length"] == 2
    err(eli("DELETE", f"/api/holds/{first['id']}"), 404, "Not found.")
    gone = ok(ben("DELETE", f"/api/holds/{first['id']}"))["hold"]
    assert (gone["status"], gone["position"]) == ("cancelled", None)
    assert [h["position"] for h in ok(eli.get("/api/holds"))["holds"] if h["id"] == second["id"]] == [1]
    err(ben("DELETE", f"/api/holds/{first['id']}"), 409, "This hold is no longer active.")
    assert ok(ben.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]["position"] == 2


def test_hold_ready_notice(app_url, mail):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    loan = lend(coord, ADA[0], [tool])
    ben, cleo = signin(app_url, BEN), signin(app_url, CLEO)
    first = ok(ben.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]
    second = ok(cleo.post("/api/holds", {"item_id": tool["id"]}), 201)["hold"]
    hang_all(coord, loan)
    ok(checkin(coord, loan))
    holds = {h["id"]: h for h in ok(coord.get(f"/api/holds?item_id={tool['id']}"))["holds"]}
    assert (holds[first["id"]]["status"], holds[first["id"]]["position"]) == ("ready", None)
    assert (holds[second["id"]]["status"], holds[second["id"]]["position"]) == ("queued", 1)
    assert ok(coord.get(f"/api/items/{tool['id']}"))["item"]["status"] == "held"
    subject = f"Your hold is ready: {tool['name']} ({tool['tag']})"
    ready = mails_for(mail, subject, BEN[0])
    assert len(ready) == 1 and tool["name"] in text(ready[0])
    assert mail_from_address().lower() in [a.lower() for a in addresses(ready[0].get("From"))]
    assert not [m for m in mail.messages() if m.get("Subject") == subject and CLEO[0] in addresses(m.get("To"))]
    ok(ben("DELETE", f"/api/holds/{first['id']}"))
    assert [h["status"] for h in ok(cleo.get("/api/holds"))["holds"] if h["id"] == second["id"]] == ["ready"]
    assert len(mails_for(mail, subject, CLEO[0])) == 1


def test_wf_holds_pegboard_hold(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    lend(coord, ADA[0], [tool])
    with screen(browser, app_url, ELI, "/") as page:
        row = page.get_by_role("table", name="Tools").get_by_role("row").filter(has_text=tool["tag"])
        expect(row).to_contain_text("out", timeout=EXPECT_MS)
        row.click()
        expect(detail(page)).to_contain_text("No one is waiting for this tool.", timeout=EXPECT_MS)
        expect(detail(page)).to_contain_text(tool["name"])
        page.get_by_role("button", name="Place hold").click()
        expect(account_news(page)).to_have_text(hold_placed(1), timeout=EXPECT_MS)
        page.goto(app_url + "/account")
        held_row = page.get_by_role("table", name="Your holds").get_by_role("row").filter(has_text=tool["tag"])
        expect(held_row).to_contain_text("queued", timeout=EXPECT_MS)
    mine = [h for h in ok(signin(app_url, ELI).get("/api/holds"))["holds"] if h["item_id"] == tool["id"]]
    assert [(h["status"], h["position"]) for h in mine] == [("queued", 1)]
    assert ok(coord.get(f"/api/items/{tool['id']}"))["item"]["hold_queue_length"] == 1


def test_due_date_first_open_day(app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    mid = member_ids(coord)[ADA[0]]
    period = lib.settings["loan_period_days"]
    for offset in range(7):
        at = (lib.now - timedelta(days=BACKDATE_DAYS + offset)).astimezone(lib.tz).replace(
            hour=11, minute=0, second=0, microsecond=0)
        loan = ok(checkout(coord, ok(reserve(coord, mid, [add_tool(coord)], at.isoformat()), 201)["loan"]))["loan"]
        assert datetime.fromisoformat(loan["checked_out_at"]) == at
        due = lib.open_from(at.date() + timedelta(days=period))
        assert loan["due_date"] == due.isoformat() and loan["due_by"] == lib.hours[WEEKDAYS[due.weekday()]]["closes"]
    fresh = lend(coord, ADA[0], [add_tool(coord)])
    start = datetime.fromisoformat(fresh["checked_out_at"]).astimezone(lib.tz).date()
    assert fresh["due_date"] == lib.open_from(start + timedelta(days=period)).isoformat()


def test_wf_checkout_scan_journey(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord, parts=(("Body", "drill", 3, 3), ("Battery", "battery", 2, 2)))
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        for part in tool["parts"]:
            expect(outline(page, tool, part, "on the wall")).to_be_visible(timeout=EXPECT_MS)
        expect(scan(page)).to_be_focused()
        page.keyboard.type(tool["tag"])
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name="New loan")
        expect(dialog.get_by_role("button", name=f"Remove {tool['tag']}")).to_be_visible(timeout=EXPECT_MS)
        dialog.get_by_role("combobox", name="Member").focus()
        page.keyboard.type(ELI_NAME.split()[-1])
        page.get_by_role("listbox", name="Members").get_by_role("option", name=ELI_OPTION).click()
        pick_photo(page, dialog.get_by_role("button", name="Take or choose photo"))
        dialog.get_by_role("button", name="Check out").click()
        loan = wait_for(lambda: out_loan_of(coord, tool), EXPECT_MS / 1000, "loan out")
        expect(desk_news(page)).to_have_text(checked_out_copy(loan), timeout=EXPECT_MS)
        for part in tool["parts"]:
            expect(outline(page, tool, part, "out")).to_be_visible(timeout=EXPECT_MS)
        counts_shown(page, ok(coord.get("/api/board"))["counts"])
    assert [i["id"] for i in loan["items"]] == [tool["id"]] and {p["state"] for p in loan["parts"]} == {"out"}
    assert len(S3().keys(f"loans/{loan['ref']}/checkout/")) == 1


def test_other_desks_see_checkout(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord, parts=(("Body", "drill", 3, 3), ("Battery", "battery", 2, 2)))
    reserved = ok(reserve(coord, member_ids(coord)[ELI[0]], [tool]), 201)["loan"]
    with screen(browser, app_url, PRIYA, "/desk") as desk:
        for part in tool["parts"]:
            expect(outline(desk, tool, part, "reserved")).to_be_visible(timeout=EXPECT_MS)
        expect(scan(desk)).to_be_focused()
        desk.keyboard.type(SCAN_TEXT)
        ok(checkout(signin(outage(SHORT), TOMASZ), reserved))
        advance(desk, DESK_POLL_MS)
        for part in tool["parts"]:
            expect(outline(desk, tool, part, "out")).to_be_visible(timeout=EXPECT_MS)
        expect(scan(desk)).to_be_focused()
        expect(scan(desk)).to_have_value(SCAN_TEXT)


def test_checkin_outcome(app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    single = add_tool(coord)
    loan = lend(coord, ELI[0], [kit, single])
    first, second = board_order(kit["parts"])
    lone = single["parts"][0]
    ok(hang(coord, loan, first))
    assert "grades" in err(checkin(coord, loan, grades={str(kit["id"]): "good"}), 422)["fields"]
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "out"
    done = ok(checkin(coord, loan, grades={str(kit["id"]): "good", str(single["id"]): "worn"}))["loan"]
    assert done["status"] == "returned-partial"
    assert done["missing_parts"] == [p["name"] for p in board_order([second, lone])]
    assert {i["id"]: i["grade"] for i in done["items"]} == {kit["id"]: "good", single["id"]: "worn"}
    assert {p["id"]: p["state"] for p in done["parts"]} == {first["id"]: "hung", second["id"]: "missing",
                                                            lone["id"]: "missing"}
    assert ok(coord.get(f"/api/items/{kit['id']}"))["item"]["status"] == "incomplete"
    whole = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    complete = lend(coord, ELI[0], [whole])
    hang_all(coord, complete)
    back = ok(checkin(coord, complete, grades={str(whole["id"]): "worn"}))["loan"]
    assert back["status"] == "returned-complete" and back["missing_parts"] == [] and back["items"][0]["grade"] == "worn"
    assert ok(coord.get(f"/api/items/{whole['id']}"))["item"]["status"] == "on-wall"


def test_checkin_announcements(browser, app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)), cost=MAX_COST)
    first, second = board_order(kit["parts"])
    loan = lend(coord, BEN[0], [kit], at=backdated(lib))
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        news = desk_news(page)
        select_loan(page, kit["tag"])
        focused(card(page, first))
        page.keyboard.press("Space")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(news).to_have_text("That peg belongs to a different tool.", timeout=EXPECT_MS)
        card(page, first).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(news).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        outline(page, kit, first, "on the wall").focus()
        page.keyboard.press("Enter")
        page.get_by_role("button", name=f"Take down {first['name']}").focus()
        page.keyboard.press("Enter")
        expect(news).to_have_text(f"{first['name']} is off its peg.", timeout=EXPECT_MS)
        card(page, first).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(news).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        grade_good(page, kit)
        pick_photo(page, page.get_by_role("button", name="Take or choose photo"))
        total = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["late_fee_so_far_cents"]
        page.keyboard.press("Control+Enter")
        page.get_by_role("dialog", name="Confirm check-in").get_by_role("button", name="Confirm").click()
        expect(news).to_have_text(f"Returned — partial. Missing: {second['name']}. Fee raised: ${dollars(total)}.",
                                  timeout=EXPECT_MS)
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert ok(coord.get(f"/api/fees/{final['fee_id']}"))["fee"]["total_cents"] == total


def test_wf_shadow_board_checkin_journey(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "drill", 3, 3), ("Battery", "battery", 2, 2)))
    loan = lend(coord, ADA[0], [kit])
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        select_loan(page, kit["tag"])
        for part in board_order(kit["parts"]):
            expect(card(page, part)).to_be_visible(timeout=EXPECT_MS)
            drag(page, card(page, part), outline(page, kit, part, "out"))
            expect(outline(page, kit, part, "on the wall")).to_be_visible(timeout=EXPECT_MS)
        counts_shown(page, ok(coord.get("/api/board"))["counts"])
        grade_good(page, kit)
        pick_photo(page, page.get_by_role("button", name="Take or choose photo"))
        page.get_by_role("button", name="Confirm check-in").click()
        page.get_by_role("dialog", name="Confirm check-in").get_by_role("button", name="Confirm").click()
        expect(desk_news(page)).to_have_text("Returned complete.", timeout=EXPECT_MS)
        counts_shown(page, ok(coord.get("/api/board"))["counts"])
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert final["status"] == "returned-complete" and [i["grade"] for i in final["items"]] == ["good"]
    assert len(S3().keys(f"loans/{loan['ref']}/checkin/")) == 1


def test_wf_mobile_board_touch_reduced(browser, app_url):
    coord = signin(app_url, COORD)
    other = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    a, b = board_order(other["parts"])
    loan = lend(coord, BEN[0], [other])
    with screen(browser, app_url, PRIYA, "/desk", PHONE, reduced_motion="reduce") as page:
        select_loan(page, other["tag"])
        focused(card(page, a))
        for p in other["parts"]:
            big_enough(outline(page, other, p, "out"))
            big_enough(card(page, p))
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        filled = outline(page, other, a, "on the wall")
        expect(filled).to_be_visible(timeout=EXPECT_MS)
        assert animations(filled) == []
        tap(card(page, b))
        tap(outline(page, other, b, "out"))
        expect(desk_news(page)).to_have_text(f"{b['name']} is on its peg.", timeout=EXPECT_MS)
        assert animations(outline(page, other, b, "on the wall")) == []
    assert {p["state"] for p in ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["parts"]} == {"hung"}


def test_late_parts_complete_return(app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3), ("Lid", "case", 3, 2)))
    first, second, third = board_order(kit["parts"])
    loan = lend(coord, ELI[0], [kit])
    ok(hang(coord, loan, first))
    ok(checkin(coord, loan))
    ada = member_ids(coord)[ADA[0]]
    err(reserve(coord, ada, [kit]), 409, f"{kit['tag']} is missing parts.")
    mid = ok(hang(coord, loan, second))["loan"]
    assert mid["status"] == "returned-partial" and mid["missing_parts"] == [third["name"]]
    last = ok(hang(coord, loan, third))["loan"]
    assert last["status"] == "returned-complete" and last["missing_parts"] == []
    err(hang(coord, loan, third), 409, f"{third['name']} is already on its peg.")
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "returned-complete"
    assert ok(coord.get(f"/api/items/{kit['id']}"))["item"]["status"] == "on-wall"
    assert ok(reserve(coord, ada, [kit]), 201)["loan"]["status"] == "reserved"


def test_board_counts_match_parts(app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    first, second = board_order(kit["parts"])

    def read():
        board = ok(coord.get("/api/board"))
        assert board["counts"] == recount(board)[0] and board["columns"] == COLUMNS
        return board["counts"]
    start = read()
    loan = lend(coord, ADA[0], [kit])
    out = read()
    assert (out["on_wall"], out["out"], out["missing"]) == (start["on_wall"] - 2, start["out"] + 2, start["missing"])
    hung = ok(hang(coord, loan, first))["counts"]
    assert (hung["on_wall"], hung["out"]) == (out["on_wall"] + 1, out["out"] - 1) and hung == read()
    ok(checkin(coord, loan))
    partial = read()
    assert (partial["out"], partial["missing"]) == (hung["out"] - 1, hung["missing"] + 1)
    late = ok(hang(coord, loan, second))["counts"]
    assert (late["on_wall"], late["missing"]) == (partial["on_wall"] + 1, partial["missing"] - 1) and late == read()


def test_wf_partial_returns_journey(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3), ("Lid", "case", 3, 2)))
    first, second, third = board_order(kit["parts"])
    loan = lend(coord, ADA[0], [kit])
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        select_loan(page, kit["tag"])
        focused(card(page, first))
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{first['name']} is on its peg.", timeout=EXPECT_MS)
        grade_good(page, kit)
        pick_photo(page, page.get_by_role("button", name="Take or choose photo"))
        page.get_by_role("button", name="Confirm check-in").click()
        page.get_by_role("dialog", name="Confirm check-in").get_by_role("button", name="Confirm").click()
        expect(desk_news(page)).to_have_text(f"Returned — partial. Missing: {second['name']}, {third['name']}.",
                                             timeout=EXPECT_MS)
        page.reload()
        for part in (second, third):
            expect(outline(page, kit, part, "missing")).to_be_visible(timeout=EXPECT_MS)
        expect(outline(page, kit, first, "on the wall")).to_be_visible()
        expect(page.get_by_role("list", name="Open loans").get_by_role("listitem").filter(
            has_text=loan["ref"])).to_contain_text("incomplete")
        select_loan(page, kit["tag"])
        focused(card(page, second))
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{second['name']} is on its peg.", timeout=EXPECT_MS)
        card(page, third).focus()
        page.keyboard.press("Space")
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{third['name']} is on its peg. Returned complete.", timeout=EXPECT_MS)
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert final["status"] == "returned-complete" and final["missing_parts"] == []


def test_completed_return_reaches_waiting_member(browser, app_url, mail):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3), ("Lid", "case", 3, 2)))
    first, second, third = board_order(kit["parts"])
    loan = lend(coord, ADA[0], [kit])
    ok(signin(app_url, BEN).post("/api/holds", {"item_id": kit["id"]}), 201)
    ok(hang(coord, loan, first))
    ok(checkin(coord, loan))
    with screen(browser, app_url, BEN, "/account") as holder:
        row = holder.get_by_role("table", name="Your holds").get_by_role("row").filter(has_text=kit["tag"])
        expect(row).to_contain_text("queued", timeout=EXPECT_MS)
        before = account_news(holder).text_content()
        other = signin(outage(SHORT), PRIYA)
        results = race([lambda: hang(coord, loan, second), lambda: hang(other, loan, third)])
        assert [r.status_code for r in results] == [200, 200]
        advance(holder, REFRESH_MS)
        sentence = f"Your hold on {kit['name']} is ready."
        expect(account_news(holder)).to_have_text(sentence, timeout=EXPECT_MS)
        assert before != sentence
        expect(row).to_contain_text("ready")
        advance(holder, REFRESH_MS * 2)
        expect(account_news(holder)).to_have_text(sentence)
    assert len(mails_for(mail, f"Your hold is ready: {kit['name']} ({kit['tag']})", BEN[0])) == 1


def test_keyboard_finishing_hang_phone(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3), ("Lid", "case", 3, 2)))
    first, second, third = board_order(kit["parts"])
    loan = lend(coord, ADA[0], [kit])
    ok(hang(coord, loan, first))
    ok(checkin(coord, loan))
    with screen(browser, app_url, TOMASZ, "/desk", PHONE) as page:
        select_loan(page, kit["tag"])
        focused(card(page, second))
        page.keyboard.press("Space")
        in_view(outline(page, kit, second, "missing"), PHONE)
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowLeft")
        in_view(outline(page, kit, second, "missing"), PHONE)
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{second['name']} is on its peg.", timeout=EXPECT_MS)
        expect(card(page, third)).to_be_focused()
        page.keyboard.press("Space")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowUp")
        in_view(outline(page, kit, third, "missing"), PHONE)
        page.keyboard.press("Enter")
        expect(desk_news(page)).to_have_text(f"{third['name']} is on its peg. Returned complete.", timeout=EXPECT_MS)
        expect(scan(page)).to_be_focused()
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "returned-complete"


def test_open_day_lateness(app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    for k in (1, 2, 8):
        tool = add_tool(coord)
        loan = lend(coord, ELI[0], [tool], at=backdated(lib))
        due = as_date(loan["due_date"])
        returned = lib.closing(lib.nth_open_after(due, k)) - timedelta(minutes=1)
        assert returned <= lib.now
        hang_all(coord, loan)
        body = ok(checkin(coord, loan, returned_at=returned.isoformat()))
        assert body["loan"]["open_days_late"] == k == lib.days_late(due, returned)
        assert [ln["open_days"] for ln in body["fee"]["lines"]] == [k]
        assert (returned.date() - due).days >= k
    tool = add_tool(coord)
    loan = lend(coord, ELI[0], [tool], at=backdated(lib))
    due = as_date(loan["due_date"])
    noon = datetime.combine(due + timedelta(days=1), datetime.min.time()).replace(hour=12, tzinfo=lib.tz)
    hang_all(coord, loan)
    body = ok(checkin(coord, loan, returned_at=noon.isoformat()))
    assert body["loan"]["open_days_late"] == lib.days_late(due, noon)


def test_server_decided_overdue_figures(browser, app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    cheap = add_tool(coord, cost=lib.settings["late_fee_cents"])
    out_loan = lend(coord, ELI[0], [cheap], at=backdated(lib))
    read = ok(coord.get(f"/api/loans/{out_loan['id']}"))["loan"]
    n = Library(coord).days_late(as_date(read["due_date"]), server_now(coord))
    assert n > 1 and read["open_days_late"] == n
    assert read["late_fee_so_far_cents"] == min(read["fee_rules"]["late_fee_cents"] * n, cheap["replacement_cost_cents"])
    reserved = ok(reserve(coord, member_ids(coord)[ELI[0]], [add_tool(coord)]), 201)["loan"]
    assert reserved["open_days_late"] is None and reserved["late_fee_so_far_cents"] is None
    done = lend(coord, ELI[0], [add_tool(coord)], at=backdated(lib))
    hang_all(coord, done)
    body = ok(checkin(coord, done))
    later = ok(coord.get(f"/api/loans/{done['id']}"))["loan"]
    assert later["open_days_late"] == body["loan"]["open_days_late"]
    assert later["late_fee_so_far_cents"] == sum(ln["amount_cents"] for ln in body["fee"]["lines"] if ln["kind"] == "late")
    context = browser.new_context(timezone_id=OTHER_ZONE)
    try:
        page = context.new_page()
        page.clock.install(time=WRONG_CLOCK)
        page.clock.pause_at(WRONG_CLOCK)
        page.goto(app_url + "/signin")
        assert page.request.post(app_url + "/api/session", data={"email": TOMASZ[0], "password": TOMASZ[1]}).status == 200
        page.goto(app_url + f"/loans/{out_loan['id']}")
        expect(page.get_by_text(overdue(read)).first).to_be_visible(timeout=EXPECT_MS)
        page.goto(app_url + "/desk")
        select_loan(page, cheap["tag"])
        expect(detail(page)).to_contain_text(overdue(read), timeout=EXPECT_MS)
    finally:
        context.close()


def test_fee_receipt_email(app_url, killbill, mail):
    coord = signin(app_url, COORD)
    fee, loan, _ = raised_fee(coord, ELI[0])
    invoice = kb_invoice(killbill, ELI[0], fee["killbill_invoice_id"])
    found = mails_for(mail, f"Pegworth fees for loan {loan['ref']}: ${dollars(fee['total_cents'])}", ELI[0])
    assert len(found) == 1
    assert mail_from_address().lower() in [a.lower() for a in addresses(found[0].get("From"))]
    body = text(found[0])
    for line in fee["lines"]:
        assert line["description"] in body and dollars(line["amount_cents"]) in body
    assert dollars(fee["total_cents"]) in body and str(invoice["invoiceNumber"]) in body
    public = os.environ.get("APP_PUBLIC_URL", "").rstrip("/")
    assert f"{public}/fees/{fee['id']}" in body
    quiet = lend(coord, ELI[0], [add_tool(coord)])
    hang_all(coord, quiet)
    assert ok(checkin(coord, quiet))["fee"] is None
    assert not [m for m in mail.messages(settle=3)
                if (m.get("Subject") or "").startswith(f"Pegworth fees for loan {quiet['ref']}:")]


def test_second_hour_checkbox(browser, app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tool = add_tool(coord)
    lend(coord, ADA[0], [tool], at=backdated(lib))
    with screen(browser, app_url, TOMASZ, "/desk") as page:
        select_loan(page, tool["tag"])
        focused(card(page, tool["parts"][0]))
        returned = page.get_by_role("textbox", name="Return time")
        returned.fill(REPEATED_TIME)
        second = page.get_by_role("checkbox", name="Second 1 o'clock hour (CST)")
        expect(second).to_be_visible()
        expect(second).not_to_be_checked()
        second.check()
        returned.fill(PLAIN_TIME)
        expect(second).to_have_count(0)
        returned.fill(REPEATED_TIME)
        expect(second).not_to_be_checked()
        second.check()
        grade_good(page, tool)
        pick_photo(page, page.get_by_role("button", name="Take or choose photo"))
        sent = []
        page.on("request", lambda r: sent.append(r.post_data_buffer or b"")
                if r.method == "POST" and r.url.endswith("/checkin") else None)
        page.keyboard.press("Control+Enter")
        page.get_by_role("dialog", name="Confirm check-in").get_by_role("button", name="Confirm").click()
        wait_for(lambda: sent, EXPECT_MS / 1000, "check-in request")
    assert b"2026-11-01T01:30:00-06:00" in sent[0]


def test_waiver_reaches_member_fee_page(browser, app_url, killbill):
    coord = signin(app_url, COORD)
    fee, _, _ = raised_fee(coord, ADA[0])
    ok(signin(app_url, ADA).post(f"/api/fees/{fee['id']}/waiver-request", {"reason": "Please"}), 201)
    with screen(browser, app_url, ADA, f"/fees/{fee['id']}") as page:
        pay = page.get_by_role("button", name=f"Pay ${dollars(fee['total_cents'])}")
        expect(pay).to_be_visible(timeout=EXPECT_MS)
        pay.focus()
        ok(signin(outage(SHORT), COORD).post(f"/api/fees/{fee['id']}/waiver-decision", {"decision": "approve"}))
        advance(page, REFRESH_MS)
        news = account_news(page)
        expect(news).to_have_text(f"Fee {fee['id']} was waived.", timeout=EXPECT_MS)
        expect(pay).to_have_count(0)
        expect(page.get_by_role("heading", name=f"Fee {fee['id']}")).to_be_focused()
        expect(page.get_by_text("waived").first).to_be_visible()
        advance(page, REFRESH_MS * 2)
        expect(news).to_have_text(f"Fee {fee['id']} was waived.")
    assert len(kb_credits(killbill, ADA[0], fee["id"])) == 1


def test_photos_kept_as_submitted(app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tool = add_tool(coord)
    first, second = jpeg(), webp()
    captured = (lib.now - timedelta(minutes=5)).astimezone(ZoneInfo(OTHER_ZONE)).replace(microsecond=0)
    loan = ok(reserve(coord, member_ids(coord)[ADA[0]], [tool]), 201)["loan"]
    loan = ok(checkout(coord, loan, first, "image/jpeg", captured.isoformat()))["loan"]
    hang_all(coord, loan)
    body = ok(checkin(coord, loan, photo=second, kind="image/webp"))
    photos = {p["event"]: p for p in body["loan"]["photos"]}
    ada = signin(app_url, ADA)
    for event, data, kind in (("checkout", first, "image/jpeg"), ("checkin", second, "image/webp")):
        p = photos[event]
        assert (p["content_type"], p["byte_size"], p["sha256"]) == (kind, len(data), hashlib.sha256(data).hexdigest())
        assert S3().get(f"loans/{loan['ref']}/{event}/{p['id']}") == data
        served = ada.get(f"/api/photos/{p['id']}")
        assert served.status_code == 200 and served.content == data
        assert served.headers["content-type"].startswith(kind) and served.headers["cache-control"] == "private, no-store"
    assert datetime.fromisoformat(photos["checkout"]["captured_at"]) == captured
    reserved = ok(reserve(coord, member_ids(coord)[ADA[0]], [add_tool(coord)]), 201)["loan"]
    assert "photo" in err(checkout(coord, reserved, jpeg(), "image/png"), 422)["fields"]
    assert S3().keys(f"loans/{reserved['ref']}/") == []


def test_wf_photo_evidence_dispute(browser, app_url):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    tool = add_tool(coord)
    before, after = png(), png()
    loan = lend(coord, CLEO[0], [tool], photo=before)
    hang_all(coord, loan)
    body = ok(checkin(coord, loan, grades={str(tool["id"]): "damaged"}, photo=after))
    fee = body["fee"]
    assert [ln["kind"] for ln in fee["lines"]] == ["damage"]
    ok(signin(app_url, CLEO).post(f"/api/fees/{fee['id']}/waiver-request", {"reason": "Crack was there\nSee photo"}), 201)
    shots = {p["event"]: p for p in body["loan"]["photos"]}
    with screen(browser, app_url, COORD, f"/fees/{fee['id']}", PHONE) as page:
        for event, label in (("checkout", "Checkout photo"), ("checkin", "Check-in photo")):
            p = shots[event]
            stamp = library_stamp(lib, p["captured_at"])
            expect(page.get_by_role("img", name=f"{label}, captured {stamp}")).to_be_visible(timeout=EXPECT_MS)
            expect(page.get_by_text(p["sha256"]).first).to_be_visible()
        links = page.get_by_role("link", name="Open original")
        expect(links).to_have_count(2)
        for i, data in enumerate((before, after)):
            served = page.request.get(urljoin(app_url + "/", links.nth(i).get_attribute("href")))
            assert served.status == 200 and served.body() == data
        page.get_by_role("button", name="Decline waiver").click()
        expect(account_news(page)).to_have_text("Waiver declined.", timeout=EXPECT_MS)
    decided = ok(coord.get(f"/api/fees/{fee['id']}"))["fee"]
    assert decided["status"] == "raised" and decided["waiver"]["status"] == "declined"


def test_pending_photo_during_outage(app_url, killbill):
    coord = signin(app_url, COORD)
    lib = Library(coord)
    down = coord.on(outage(STORAGE_DOWN))
    tool, spare = add_tool(coord), add_tool(coord)
    loan = lend(coord, BEN[0], [tool], at=backdated(lib))
    ok(hang(down, loan, tool["parts"][0]))
    held_back = ok(checkin(down, loan), 202)
    pend = held_back["loan"]
    assert pend["status"] == "pending-photo" and held_back["fee"] is None and pend["fee_id"] is None
    assert pend["open_days_late"] > 0
    assert S3().keys(f"loans/{loan['ref']}/checkin/") == []
    acct = kb_account(killbill, BEN[0])
    assert not [i for i in killbill.invoices(acct["accountId"])
                if any(tool["tag"] in (it.get("description") or "") for it in i.get("items", []))]
    assert ok(down.get("/api/status"))["storage"] == "down"
    err(hang(coord, loan, tool["parts"][0]), 409, "This check-in is waiting for its photo.")
    err(finish(down, loan), 503, "Photo storage is down. This check-in is still pending photo; finish it when storage is back.")
    assert down.get(f"/api/photos/{pend['photos'][0]['id']}").status_code == 503
    reread = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert (reread["open_days_late"], reread["late_fee_so_far_cents"]) == (pend["open_days_late"], pend["late_fee_so_far_cents"])
    done = ok(finish(coord, loan))
    assert done["loan"]["status"] == "returned-complete" and done["loan"]["open_days_late"] == pend["open_days_late"]
    assert [ln["open_days"] for ln in done["fee"]["lines"]] == [pend["open_days_late"]]
    assert len(S3().keys(f"loans/{loan['ref']}/checkin/")) == 1
    reserved = ok(reserve(coord, member_ids(coord)[ADA[0]], [spare]), 201)["loan"]
    err(checkout(down, reserved), 503, "Photo storage is down. The loan stays reserved; check it out when storage is back.")
    assert ok(coord.get(f"/api/loans/{reserved['id']}"))["loan"]["status"] == "reserved"
    assert S3().keys(f"loans/{reserved['ref']}/") == []


def test_rival_desk_wins_honestly(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    first, second = board_order(kit["parts"])
    loan = lend(coord, ELI[0], [kit])
    with screen(browser, app_url, PRIYA, "/desk") as rival:
        select_loan(rival, kit["tag"])
        focused(card(rival, first))
        ok(checkin(coord.on(outage(STORAGE_DOWN)), loan), 202)
        rival.keyboard.press("Space")
        rival.keyboard.press("Enter")
        expect(desk_news(rival)).to_have_text("This check-in is waiting for its photo.", timeout=EXPECT_MS)
        advance(rival, RIVAL_MS)
        expect(detail(rival).get_by_role("button", name="Finish check-in")).to_be_visible(timeout=EXPECT_MS)
        expect(detail(rival).get_by_role("button", name="Take or choose photo")).to_be_visible()
        for part in (first, second):
            expect(outline(rival, kit, part, "pending photo")).to_be_visible(timeout=EXPECT_MS)
        counts_shown(rival, ok(coord.get("/api/board"))["counts"])
    after = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert after["status"] == "pending-photo" and {p["state"] for p in after["parts"]} == {"out"}


def test_other_desks_follow_in_place(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    part = tool["parts"][0]
    loan = lend(coord, ELI[0], [tool])
    with screen(browser, app_url, PRIYA, "/desk") as desk:
        select_loan(desk, tool["tag"])
        focused(card(desk, part))
        desk.keyboard.press("Space")
        desk.keyboard.press("Enter")
        expect(desk_news(desk)).to_have_text(f"{part['name']} is on its peg.", timeout=EXPECT_MS)
        grade_good(desk, tool)
        pick_photo(desk, desk.get_by_role("button", name="Take or choose photo"))
        desk.keyboard.press("/")
        expect(scan(desk)).to_be_focused()
        desk.keyboard.press("ControlOrMeta+a")
        desk.keyboard.type(SCAN_TEXT)
        ok(checkin(coord.on(outage(STORAGE_DOWN)), loan), 202)
        advance(desk, DESK_POLL_MS)
        item = desk.get_by_role("list", name="Open loans").get_by_role("listitem").filter(has_text=loan["ref"])
        expect(item).to_contain_text("pending photo", timeout=EXPECT_MS)
        finish_button = detail(desk).get_by_role("button", name="Finish check-in")
        expect(finish_button).to_be_visible(timeout=EXPECT_MS)
        expect(scan(desk)).to_be_focused()
        expect(scan(desk)).to_have_value(SCAN_TEXT)
        advance(desk, DESK_POLL_MS)
        expect(finish_button).to_be_enabled(timeout=EXPECT_MS)
        finish_button.click()
        expect(desk_news(desk)).to_have_text("Returned complete.", timeout=EXPECT_MS)
    assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["status"] == "returned-complete"
    assert len(S3().keys(f"loans/{loan['ref']}/checkin/")) == 1
    with screen(browser, outage(STORAGE_DOWN), TOMASZ, "/desk") as other:
        expect(other.get_by_role("status", name="Service status")).to_contain_text(STORAGE_BANNER, timeout=EXPECT_MS)


def test_storage_return_reaches_every_desk(browser, app_url):
    coord = signin(app_url, COORD)
    kit = add_tool(coord, parts=(("Body", "generic", 2, 2), ("Arm", "wrench", 2, 3)))
    first, second = board_order(kit["parts"])
    loan = lend(coord, ELI[0], [kit])
    down_api = coord.on(outage(STORAGE_DOWN))
    ok(hang(down_api, loan, first))
    ok(checkin(down_api, loan), 202)
    with screen(browser, outage(STORAGE_DOWN), TOMASZ, "/desk") as down, \
            screen(browser, app_url, PRIYA, "/desk") as a, screen(browser, app_url, COORD, "/desk") as b:
        select_loan(down, kit["tag"])
        down_photo = detail(down).get_by_role("button", name="Take or choose photo")
        focused(down_photo)
        pick_photo(down, down_photo)
        for _ in range(3):
            advance(down, DESK_POLL_MS)
            expect(detail(down).get_by_role("button", name="Finish check-in")).to_be_disabled()
        buttons = []
        for desk in (a, b):
            select_loan(desk, kit["tag"])
            photo = detail(desk).get_by_role("button", name="Take or choose photo")
            focused(photo)
            pick_photo(desk, photo)
            advance(desk, DESK_POLL_MS)
            button = detail(desk).get_by_role("button", name="Finish check-in")
            expect(button).to_be_enabled(timeout=EXPECT_MS)
            expect(photo).to_be_focused()
            buttons.append(button)
        for button in buttons:
            button.click()
        win, lose = f"Returned — partial. Missing: {second['name']}.", "This loan is not waiting for a photo."
        shown = [text_among(desk_news(desk), (win, lose)) for desk in (a, b)]
        assert sorted(shown) == sorted([win, lose])
    final = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
    assert final["status"] == "returned-partial" and final["missing_parts"] == [second["name"]]
    assert len(S3().keys(f"loans/{loan['ref']}/checkin/")) == 1


def test_closing_weekday_moves_due_dates(app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    extra = next(w for w in WEEKDAYS if w not in {h["weekday"] for h in hours0})
    try:
        ok(put_hours(coord, hours0 + [{"weekday": extra, "opens": "10:00", "closes": "12:00"}]))
        lib = Library(coord)
        back = (lib.today.weekday() - WEEKDAYS.index(extra)) % 7
        loan = lend(coord, ADA[0], [add_tool(coord)], at=(lib.now - timedelta(days=back)).isoformat())
        assert WEEKDAYS[as_date(loan["due_date"]).weekday()] == extra
        closed = ok(put_hours(coord, hours0))
        assert closed["moved_loans"] >= 1
        lib = Library(coord)
        nxt = lib.open_from(as_date(loan["due_date"]) + timedelta(days=1))
        moved = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
        assert moved["due_date"] == nxt.isoformat() and moved["due_by"] == lib.hours[WEEKDAYS[nxt.weekday()]]["closes"]
        ok(put_hours(coord, hours0 + [{"weekday": extra, "opens": "10:00", "closes": "12:00"}]))
        assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["due_date"] == nxt.isoformat()
    finally:
        ok(put_hours(coord, hours0))


def test_opening_hours_on_every_width(browser, app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    edit = hours0[0]["weekday"].capitalize()
    message_copy = "Use a 24-hour time on the quarter hour, like 18:15."
    try:
        with screen(browser, app_url, COORD, "/office") as page:
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                page.reload()
                table = page.get_by_role("table", name="Opening hours")
                opens = table.get_by_role("textbox", name=f"{edit} opens")
                closes = table.get_by_role("textbox", name=f"{edit} closes")
                tick = table.get_by_role("checkbox", name=f"Open on {edit}")
                expect(closes).to_be_visible(timeout=EXPECT_MS)
                o, c, k = box(opens), box(closes), box(tick)
                assert abs(o["y"] - c["y"]) <= ALIGN_PX and o["x"] + o["width"] <= c["x"]
                if width == PHONE[0]:
                    assert k["y"] + k["height"] <= o["y"] + ALIGN_PX
                else:
                    assert k["x"] + k["width"] <= o["x"] and abs(k["y"] - o["y"]) <= ALIGN_PX + k["height"]
                for loc in (opens, closes, page.get_by_role("button", name="Save hours"),
                            page.get_by_role("button", name="Declare closure"),
                            page.get_by_role("textbox", name="Closure date"), page.get_by_role("textbox", name="Closure reason")):
                    big_enough(loc)
                closes.fill("17:10")
                page.get_by_role("button", name="Save hours").click()
                messages = page.get_by_text(message_copy, exact=True)
                expect(messages.first).to_be_visible(timeout=EXPECT_MS)
                field = box(closes)
                spots = [box(messages.nth(i)) for i in range(messages.count())]
                assert any(m["y"] >= field["y"] + field["height"] - ALIGN_PX and m["x"] >= 0 and m["x"] + m["width"] <= width
                           for m in spots), spots
                layout(page)
    finally:
        ok(put_hours(coord, hours0))


def test_office_keeps_unsaved_edits(browser, app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    edit, other = hours0[0]["weekday"], hours0[-1]["weekday"]
    try:
        with screen(browser, app_url, COORD, "/office") as page:
            table = page.get_by_role("table", name="Opening hours")
            closes = table.get_by_role("textbox", name=f"{edit.capitalize()} closes")
            other_opens = table.get_by_role("textbox", name=f"{other.capitalize()} opens")
            expect(closes).to_be_visible(timeout=EXPECT_MS)
            closes.fill(OFF_QUARTER)
            page.get_by_role("button", name="Save hours").click()
            problems = page.get_by_role("alert", name="Form problems")
            expect(problems).to_contain_text(SUMMARY, timeout=EXPECT_MS)
            reason = page.get_by_role("textbox", name="Closure reason")
            reason.fill(OFFICE_REASON)
            late_fee = page.get_by_role("region", name="Fee rules").get_by_role("textbox", name="Late fee per open day")
            late_fee.fill(FEE_TEXT)
            row = next(h for h in hours0 if h["weekday"] == other)
            new_opens = "10:00" if row["opens"] != "10:00" else "10:15"
            ok(put_hours(signin(outage(SHORT), COORD), [{**h, "opens": new_opens} if h["weekday"] == other else h
                                                        for h in hours0]))
            closes.focus()
            advance(page, REFRESH_MS * 2)
            expect(other_opens).to_have_value(new_opens, timeout=EXPECT_MS)
            expect(closes).to_have_value(OFF_QUARTER)
            expect(reason).to_have_value(OFFICE_REASON)
            expect(late_fee).to_have_value(FEE_TEXT)
            expect(problems).to_contain_text(SUMMARY)
            expect(closes).to_be_focused()
    finally:
        ok(put_hours(coord, hours0))


def test_wf_opening_calendar_journey(browser, app_url):
    coord = signin(app_url, COORD)
    hours0 = current_hours(coord)
    tool = add_tool(coord)
    loan = lend(coord, ADA[0], [tool])
    due = as_date(loan["due_date"])
    lib = Library(coord)
    lib.closed.add(due.isoformat())
    nxt = lib.open_from(due + timedelta(days=1))
    weekday = WEEKDAYS[nxt.weekday()]
    row = next(h for h in hours0 if h["weekday"] == weekday)
    shorter = f"{int(row['opens'][:2]) + 1:02d}:00"
    try:
        with screen(browser, app_url, COORD, "/office") as office:
            office.get_by_role("textbox", name="Closure date").fill(due.isoformat())
            office.get_by_role("textbox", name="Closure reason").fill("Holiday eve")
            office.get_by_role("button", name="Declare closure").click()
            counted_copy(desk_news(office), "Closure saved. ", f" loans now due {nxt.isoformat()}.")
            office.get_by_role("table", name="Opening hours").get_by_role(
                "textbox", name=f"{weekday.capitalize()} closes").fill(shorter)
            office.get_by_role("button", name="Save hours").click()
            counted_copy(desk_news(office), "Opening hours saved. ", " loans moved to the next open day.")
        moved = ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]
        assert (moved["due_date"], moved["due_by"]) == (nxt.isoformat(), shorter)
        line = f"Due {nxt.isoformat()} by {shorter}"
        with screen(browser, app_url, TOMASZ, "/desk") as desk:
            select_loan(desk, tool["tag"])
            expect(detail(desk)).to_contain_text(line, timeout=EXPECT_MS)
        with screen(browser, app_url, ADA, f"/loans/{loan['id']}") as page:
            expect(page.get_by_text(line).first).to_be_visible(timeout=EXPECT_MS)
    finally:
        coord("DELETE", f"/api/closures/{due.isoformat()}")
        ok(put_hours(coord, hours0))


def test_desks_follow_moved_due_date(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    loan = lend(coord, ADA[0], [tool])
    due = loan["due_date"]
    try:
        with screen(browser, app_url, TOMASZ, "/desk") as desk:
            select_loan(desk, tool["tag"])
            expect(detail(desk)).to_contain_text(f"Due {due} by {loan['due_by']}", timeout=EXPECT_MS)
            desk.keyboard.press("/")
            desk.keyboard.press("ControlOrMeta+a")
            desk.keyboard.type(SCAN_TEXT)
            made = ok(signin(outage(SHORT), COORD).post("/api/closures", {"date": due, "reason": "Probe closure"}), 201)
            nxt = made["new_due_date"]
            advance(desk, REFRESH_MS)
            expect(detail(desk)).to_contain_text(f"Due {nxt} by", timeout=EXPECT_MS)
            expect(desk_news(desk)).to_have_text(f"Due date moved to {nxt}.", timeout=EXPECT_MS)
            advance(desk, REFRESH_MS * 2)
            expect(desk_news(desk)).to_have_text(f"Due date moved to {nxt}.")
            expect(scan(desk)).to_be_focused()
            expect(scan(desk)).to_have_value(SCAN_TEXT)
        assert ok(coord.get(f"/api/loans/{loan['id']}"))["loan"]["due_date"] == nxt
    finally:
        coord("DELETE", f"/api/closures/{due}")


def test_live_tool_filter(browser, app_url):
    coord = signin(app_url, COORD)
    tool = add_tool(coord)
    token = tool["name"].split()[-1]
    total = len(ok(coord.get("/api/board"))["items"])
    with screen(browser, app_url, ELI, "/") as page:
        find = page.get_by_role("searchbox", name="Find a tool")
        tools = page.get_by_role("table", name="Tools")
        mine = tools.get_by_role("row").filter(has_text=tool["tag"])
        expect(mine).to_have_count(1, timeout=EXPECT_MS)
        find.focus()
        page.keyboard.type(token)
        advance(page, FILTER_MS)
        expect(account_news(page)).to_have_text("1 tool matches.", timeout=EXPECT_MS)
        expect(mine).to_have_count(1)
        expect(tools.get_by_role("row").filter(has_text="PW-102")).to_have_count(0)
        assert page.url.rstrip("/") == app_url.rstrip("/")
        page.keyboard.type("zzqq")
        advance(page, FILTER_MS)
        expect(tools.get_by_text("No tools match that search.")).to_be_visible(timeout=EXPECT_MS)
        expect(account_news(page)).to_have_text("0 tools match.")
        find.fill("")
        advance(page, FILTER_MS)
        expect(account_news(page)).to_have_text(f"{total} tools match.", timeout=EXPECT_MS)
        find.focus()
        page.keyboard.type(token)
        advance(page, FILTER_MS)
        expect(account_news(page)).to_have_text("1 tool matches.", timeout=EXPECT_MS)
        advance(page, REFRESH_MS * 2)
        expect(find).to_have_value(token)
        expect(mine).to_have_count(1)
        expect(tools.get_by_role("row").filter(has_text="PW-102")).to_have_count(0)
        expect(account_news(page)).to_have_text("1 tool matches.")


ALLOWED = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD"}


def shipped():
    out = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app", capture_output=True, text=True)
    found = {}

    def walk(deps):
        for name, info in (deps or {}).items():
            if info.get("version"):
                found[(name, info["version"])] = info.get("license")
            walk(info.get("dependencies"))
    walk(json.loads(out.stdout).get("dependencies"))
    return found


def test_if_run_manifest():
    with open("/app/run.json") as fh:
        manifest = json.load(fh)
    assert set(manifest) == {"_schema", "install", "build", "serve"} and manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(v, str) and v for v in manifest.values())


def test_if_third_party_notices():
    with open("/app/THIRD_PARTY_NOTICES.md") as fh:
        notices = fh.read()
    for (name, version), _ in shipped().items():
        assert name in notices and version in notices, f"{name}@{version}"
    for font in ("Archivo Black", "IBM Plex Sans", "IBM Plex Mono"):
        assert font in notices


def test_if_licences():
    for (name, version), lic in shipped().items():
        lic = lic.get("type") if isinstance(lic, dict) else lic
        assert lic, f"{name}@{version} has no licence"
        ids = [t for t in re.findall(r"[A-Za-z0-9.\-]+", lic) if t not in {"OR", "AND", "WITH"}]
        good = any(i in ALLOWED for i in ids) if " OR " in lic else all(i in ALLOWED for i in ids)
        assert good, f"{name}@{version}: {lic}"
    with open("/app/THIRD_PARTY_NOTICES.md") as fh:
        assert "OFL-1.1" in fh.read()


def test_if_no_extra_datastore():
    names = {name for name, _ in shipped()}
    assert not names & {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb", "level", "lmdb"}
    for root, dirs, files in os.walk("/app"):
        dirs[:] = [d for d in dirs if d not in {"node_modules", ".git"}]
        assert not [f for f in files if f.endswith((".sqlite", ".sqlite3", ".db", ".rdb"))], root
    assert Postgres().tables()


def test_if_providers_unchanged(killbill, mail):
    assert killbill.account_by_key(ADA[0])
    assert isinstance(S3().keys("loans/"), list)
    assert isinstance(mail.messages(), list)


LOCKFILE_INSTALLS = ("npm ci", "npm install")
LOCK_BYPASS = "--no-package-lock"


def test_if_lockfile():
    with open("/app/package-lock.json") as fh:
        assert json.load(fh)["lockfileVersion"]
    with open("/app/run.json") as fh:
        install = json.load(fh)["install"]
    assert any(cmd in install for cmd in LOCKFILE_INSTALLS) and LOCK_BYPASS not in install, install


def test_if_same_origin_assets(browser, app_url):
    with screen(browser, app_url, TOMASZ, "/") as page:
        urls = []
        page.on("request", lambda r: urls.append(r.url))
        page.reload()
        page.goto(app_url + "/desk")
        expect(page.get_by_role("region", name="Pegboard")).to_be_visible(timeout=EXPECT_MS)
    assert urls and all(same_origin(u, app_url) for u in urls if u.startswith("http")), urls
