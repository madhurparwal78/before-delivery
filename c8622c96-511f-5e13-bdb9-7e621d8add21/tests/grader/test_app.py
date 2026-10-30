from __future__ import annotations

import csv
import io
import json
import os
import random
import re
import signal
import socket
import subprocess
import threading
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urlsplit
from zoneinfo import ZoneInfo

import httpx
import pytest
from PIL import Image, ImageDraw
from PIL.TiffImagePlugin import IFDRational
from playwright.sync_api import Browser, Locator, Page, expect

import conftest as kit
from conftest import (
    addresses,
    advance,
    animations,
    center,
    held,
    idempotency_key,
    layout,
    mail_from_address,
    open_app,
    select,
    session,
    state_styles,
    tab_order,
    text,
    unique,
)

UTC = timezone.utc
COOP = ZoneInfo("America/Chicago")
PASSWORD = "darkroom-proof-26"
MAX_JSON_BYTES = 65536
MAX_UPLOAD_BYTES = 25000000
MAX_FRAMES = 24
HOLD_MINUTES = 30
GRANT_MAX_SECONDS = 300
COMMIT_MS = 900
HALF_MS = 450
RETRACT_MS = 250
TILE_HOVER_MS = 200
EVERYDAY_MAX_MS = 500
INSTANT_MS = 1
TOUCH_SLOP_PX = 10
TAP_PX = 44
TAP_GAP_PX = 8
LIFT_SECONDS = 2
WARNING_HOURS = 24
PENDING_SECONDS = 15
TITLE_MAX = 120
KEY_MAX = 100
FULL_BP = 10000
GRID_PX = 600
STORY_EDGE = 1600
PREVIEW_EDGE = 1200
EX_PRICE = 45000
ST_PRICE = 12000
GPS_IFD = 0x8825
DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)
VIEWPORTS = [PHONE, TABLET, DESKTOP]

HTTP_SECONDS = 30
UI_SECONDS = 30
POLL_MS = 300
TICK_MS = 250
POLL_INTERVAL_S = 0.25
MAIL_SECONDS = 60
QUIET_SECONDS = 12
RECOVERY_SECONDS = 60
BOOT_SECONDS = 180
SLACK_MS = 50
STOOD = (201, 202)
ATTEMPTS = 3
SETTLE_SECONDS = 10
TAB_PRESSES = 30
FRAME_SIZE = (2000, 1500)
COM_SEGMENT_MAX = 65537
UNKNOWN_ESSAY = "no-such-essay-probe"
MULTILINE_CAPTION = "Levee road\nafter the crest"
HOLD_NOTE = "Crop frame 1 tighter"
PROBE_STEM = "portrait"
CAPTIONS = ("first caption", "second caption", "third caption")
UPLOAD_NAMES = ("levee-1.jpg", "levee-2.jpg", "own.jpg")
TAKEDOWN_REFERENCE = "REF-placeholder"
SOURCE_PATHS = ["/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json",
                "/src/server.ts", "/node_modules/.package-lock.json"]

PEOPLE = {
    "ines": "ines@saltprint.example",
    "bram": "bram@saltprint.example",
    "ada": "ada@contributors.saltprint.example",
    "tomas": "tomas@contributors.saltprint.example",
    "noor": "noor@contributors.saltprint.example",
    "priya": "priya@harbor-light.example",
    "dev": "dev@harbor-light.example",
    "june": "june@harbor-light.example",
    "wes": "wes@mesa-sentinel.example",
    "carmen": "carmen@mesa-sentinel.example",
    "hollis": "hollis@thames-post.example",
    "margot": "margot@thames-post.example",
}
NAMES = {
    "ines": "Ines Okafor-Lund", "bram": "Bram Kettleworth", "ada": "Ada Reyes", "tomas": "Tomas Whitcombe",
    "noor": "Noor Haddad", "priya": "Priya Lowell", "dev": "Dev Marsh", "june": "June Castellanos",
    "wes": "Wes Tallbridge", "carmen": "Carmen Oduya", "hollis": "Hollis Brandt", "margot": "Margot Fenwick",
}
ROLES = {
    "ines": "desk_editor", "bram": "treasurer", "ada": "contributor", "tomas": "contributor",
    "noor": "contributor", "priya": "picture_editor", "dev": "picture_editor", "june": "licensing_manager",
    "wes": "picture_editor", "carmen": "licensing_manager", "hollis": "picture_editor", "margot": "licensing_manager",
}
NEWSROOM = {"priya": "harbor-light", "dev": "harbor-light", "june": "harbor-light", "wes": "mesa-sentinel",
            "carmen": "mesa-sentinel", "hollis": "thames-post", "margot": "thames-post"}
NEWSROOMS = {"harbor-light": ("Harbor Light Herald", "America/New_York"),
             "mesa-sentinel": ("Mesa Daily Sentinel", "America/Phoenix"),
             "thames-post": ("Thames Evening Post", "Europe/London")}
MANAGER = {"harbor-light": "june", "mesa-sentinel": "carmen", "thames-post": "margot"}
HANDLE = {"ada": "ada-reyes", "tomas": "tomas-whitcombe", "noor": "noor-haddad"}
PAYOUT_ACCOUNTS = ["Ozark Teachers Credit Union ••4417", "Prairie Mutual Savings ••0932",
                   "Gulfside Community Bank ••2268"]
SEED_DESK_NOTE = "Family on frame 4 gave consent by phone; keep this off newsroom copy."
PLACEHOLDER = "Removed essay (legal takedown)"
TAKEDOWN_SENTENCE = "Stop all use of this essay and delete stored copies."
CSV_COLUMNS = ["licence_id", "essay_title", "caption", "credit_line", "kind", "state", "confirmed_at",
               "window_start", "window_end", "amount", "currency"]
SECTIONS = {
    "contributor": ["Contact sheet", "Studio", "Royalties"],
    "picture_editor": ["Contact sheet", "Shortlist", "Licences", "Following"],
    "licensing_manager": ["Licences", "Usage"],
    "desk_editor": ["Contact sheet", "Review queue", "All essays"],
    "treasurer": ["Rates", "Statements"],
}
TITLE_CONTROL = "Title can't contain line breaks or control characters"
TITLE_LENGTH = "Title must be 1 to 120 characters"
CREDITS_COUNT = "Credits must list 1 to 6 contributors"
CREDIT_ENTRY = "Each credit needs a contributor handle and an integer split_bp from 1 to 10000"
CREDIT_KEYS = "Credits accept only contributor and split_bp"
CREDIT_TWICE = "Each contributor may be credited once"
CREDIT_SELF = "You must credit yourself"
LIFT_MESSAGE = "Enter the lift as a co-op date and time"
EXCLUSIVE_MESSAGE = "Exclusive window must be 1 to 14 days"
STANDARD_MESSAGE = "Standard licence must be 1 to 30 days"
PRICE_MESSAGE = "Price must be $1.00 to $100,000.00"
CAPTION_MESSAGE = "Caption must be at most 2000 characters"
RATE_MESSAGE = "Rate must be 0 to 10000 basis points"
DATE_MESSAGE = "Use YYYY-MM-DD"
FUTURE_DATE_MESSAGE = "Effective date must be after today in co-op time"
MONTH_MESSAGE = "Use YYYY-MM"
MONTH_OPEN_MESSAGE = "That month hasn't closed in co-op time"
WRONG_TYPE = "This field is missing or has the wrong type"
UNKNOWN_FIELD = "Unknown field"
BODY_MESSAGE = "Send a JSON object"
KEY_MESSAGE = "Send an Idempotency-Key header of 1 to 100 visible characters"
KIND_MESSAGE = "Kind must be exclusive or standard"
TARGET_MESSAGE = "Follow one essay or one contributor"
NOTE_MESSAGE = "Desk note must be 1 to 1000 characters"
REFERENCE_MESSAGE = "Legal reference must be 1 to 200 characters"
STALE_COPY = "This essay was changed elsewhere. Reload it before saving; your edits are still in the form."
NO_ANSWER_CLAIM = "Couldn't reach Saltprint Desk. Hold Claim again to check whether your claim went through."
PAYOUTS_STATUS = re.compile(
    r"^(Payouts recorded\.|\d+ payouts queued — billing is unreachable; they are recorded automatically when it returns\.)$"
)
PAYOUT_STATE = re.compile("Recorded|Queued")


def instant(value: str) -> datetime:
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=UTC)


def iso(at: datetime) -> str:
    return at.astimezone(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")


def local(day: date, hour: int = 0, minute: int = 0) -> datetime:
    return datetime(day.year, day.month, day.day, hour, minute, tzinfo=COOP).astimezone(UTC)


def coop_day(at: datetime) -> date:
    return at.astimezone(COOP).date()


def wall(at: datetime) -> str:
    return at.astimezone(COOP).strftime("%Y-%m-%dT%H:%M")


def coop_time(at: datetime) -> str:
    lt = at.astimezone(COOP)
    return f"{lt:%a} {lt.day} {lt:%b} {lt.year} · {lt:%H:%M} {lt.tzname()}"


def coop_date(day: date) -> str:
    return f"{day:%a} {day.day} {day:%b} {day.year}"


def csv_time(at: datetime) -> str:
    lt = at.astimezone(COOP)
    return f"{lt:%Y-%m-%d %H:%M} {lt.tzname()}"


def month_label(year: int, month: int) -> str:
    return f"{date(year, month, 1):%B} {year}"


def dollars(cents: int) -> str:
    return f"${cents // 100:,}.{cents % 100:02d}"


def plain_dollars(cents: int) -> str:
    return f"{cents // 100}.{cents % 100:02d}"


def cents(value: str) -> int:
    return int(Decimal(value) * 100)


def percent(bp: int) -> str:
    return f"{bp // 100}.{bp % 100:02d}"


def window_end(confirmed: datetime, lift: datetime, days: int) -> datetime:
    return local(coop_day(max(confirmed, lift)) + timedelta(days=days))


def royalty_split(amount: int, rate_bp: int, splits: list[int]) -> tuple[int, list[int]]:
    commission = amount * rate_bp // FULL_BP
    pool = amount - commission
    shares = [pool * s // FULL_BP for s in splits]
    remainders = [(pool * s) % FULL_BP for s in splits]
    order = sorted(range(len(splits)), key=lambda i: (-remainders[i], i))
    for i in order[: pool - sum(shares)]:
        shares[i] += 1
    return commission, shares


def next_month(year: int, month: int) -> tuple[int, int]:
    return (year + 1, 1) if month == 12 else (year, month + 1)


def month_bounds(year: int, month: int) -> tuple[datetime, datetime]:
    ny, nm = next_month(year, month)
    return local(date(year, month, 1)), local(date(ny, nm, 1))


def fall_back_after(after: datetime) -> date:
    year = after.astimezone(COOP).year
    while True:
        first = date(year, 11, 1)
        sunday = first + timedelta(days=(6 - first.weekday()) % 7)
        if local(sunday) > after:
            return sunday
        year += 1


def etag(version: int) -> str:
    return f'"{version}"'


def credit_line(names: list[str]) -> str:
    joined = names[0] if len(names) == 1 else ", ".join(names[:-1]) + " and " + names[-1]
    return "Photographs by " + joined


def frame_label(n: int, total: int) -> str:
    return f"Frame {n} of {total}"


def fresh_title(prefix: str = "Essay") -> str:
    return f"{prefix} {unique(prefix.lower())[0]}"


class Api:
    def __init__(self, base: str, who: str) -> None:
        self.base = base
        self.who = who
        self.email = PEOPLE[who]
        self.http = httpx.Client(base_url=base, timeout=HTTP_SECONDS)
        r = self.http.post("/api/session", json={"email": self.email, "password": PASSWORD})
        assert r.status_code == 200, r.text
        self.user = r.json()["user"]

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.get(path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.http.post(path, json={} if body is None else body, **kw)

    def patch(self, path: str, body: Any, **kw: Any) -> httpx.Response:
        return self.http.patch(path, json=body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.http.delete(path, **kw)

    def upload(self, essay_id: str, name: str, data: bytes, ctype: str = "image/jpeg",
               caption: str | None = None) -> httpx.Response:
        return self.http.post(f"/api/essays/{essay_id}/frames", files={"file": (name, data, ctype)},
                              data={"caption": caption} if caption is not None else None)


def api_err(r: httpx.Response, status: int, code: str | None = None) -> dict[str, Any]:
    assert r.status_code == status, f"{r.status_code} {r.text}"
    body = r.json()
    assert set(body) == {"error"}, body
    error = body["error"]
    assert isinstance(error["code"], str) and isinstance(error["message"], str) and error["message"]
    if code is not None:
        assert error["code"] == code, error
    return error


def field_err(r: httpx.Response, **fields: str) -> dict[str, Any]:
    error = api_err(r, 422, "validation_failed")
    for key, message in fields.items():
        assert error["fields"].get(key) == message, error
    return error


def server_now(base: str) -> datetime:
    r = httpx.get(f"{base}/api/clock", timeout=HTTP_SECONDS)
    assert r.status_code == 200, r.text
    return instant(r.json()["now"])


def clock_to(base: str, when: datetime) -> None:
    assert when >= server_now(base), "the verifier only moves the shared server clock forward"
    r = httpx.put(f"{base}/api/clock", json={"now": iso(when)}, timeout=HTTP_SECONDS)
    assert r.status_code == 200, (
        f"PUT /api/clock answered {r.status_code} {r.text}; the brief (L380, L806) requires grading to serve the app "
        "with APP_CLOCK_CONTROL=on, as task.spec.yaml services[postgres].env sets it; the serve environment must pass it"
    )


def poll(fetch: Callable[[], Any], done: Callable[[Any], bool], seconds: float) -> Any:
    deadline = monotonic() + seconds
    while True:
        value = fetch()
        if done(value) or monotonic() > deadline:
            return value
        threading.Event().wait(POLL_INTERVAL_S)


def together(calls: list[Callable[[], Any]]) -> list[Any]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], Any]) -> Any:
        barrier.wait()
        return fn()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def outage(name: str) -> str:
    url = os.environ.get(name)
    assert url, f"{name} must name the outage instance"
    return url.rstrip("/")


def credit(handle: str, split: int) -> dict[str, Any]:
    return {"contributor": handle, "split_bp": split}


def essay_fields(title: str, lift_local: str, credits: list[dict[str, Any]], **over: Any) -> dict[str, Any]:
    body: dict[str, Any] = {
        "title": title, "caption": f"Caption for {title}", "lift_local": lift_local,
        "exclusive_days": 3, "standard_days": 7,
        "exclusive_price_minor": EX_PRICE, "standard_price_minor": ST_PRICE, "credits": credits,
    }
    body.update(over)
    return body


def picture(seed: int, kind: str = "jpeg", gps: bool = False, size: tuple[int, int] = FRAME_SIZE) -> bytes:
    img = Image.new("RGB", size, ((seed * 67) % 256, (seed * 131) % 256, (seed * 29) % 256))
    draw = ImageDraw.Draw(img)
    for i in range(0, size[0], max(1, size[0] // 20)):
        y = (i * (seed + 3)) % size[1]
        draw.ellipse((i, y, i + size[0] // 25, y + size[0] // 25), fill=(255 - seed % 255, 40, 90))
    buf = io.BytesIO()
    if kind == "png":
        img.save(buf, "PNG")
    elif kind == "gif":
        img.save(buf, "GIF")
    elif kind == "tiff":
        img.save(buf, "TIFF")
    elif gps:
        exif = Image.Exif()
        exif[GPS_IFD] = {1: "N", 2: (IFDRational(41), IFDRational(52), IFDRational(30)),
                         3: "W", 4: (IFDRational(87), IFDRational(37), IFDRational(50))}
        img.save(buf, "JPEG", quality=85, exif=exif.tobytes())
    else:
        img.save(buf, "JPEG", quality=85)
    return buf.getvalue()


def pad_jpeg(base: bytes, total: int) -> bytes:
    out = bytearray(base[:2])
    need = total - len(base)
    while need > 0:
        size = min(COM_SEGMENT_MAX, need)
        if 0 < need - size < 4:
            size -= 4
        out += b"\xff\xfe" + (size - 2).to_bytes(2, "big") + bytes(size - 4)
        need -= size
    out += base[2:]
    assert len(out) == total
    return bytes(out)


def gps_of(data: bytes) -> dict[int, Any]:
    return dict(Image.open(io.BytesIO(data)).getexif().get_ifd(GPS_IFD))


def create_essay(base: str, *, state: str = "live", author: str = "ada", title: str | None = None,
                 credits: list[dict[str, Any]] | None = None, lift: datetime | None = None, frames: int = 1,
                 formats: list[str] | None = None, gps: bool = False, note: str | None = None,
                 **fields: Any) -> dict[str, Any]:
    writer = Api(base, author)
    desk = Api(base, "ines")
    now = server_now(base)
    if lift is None:
        lift = now - timedelta(days=1) if state == "live" else now + timedelta(days=3)
    title = title or fresh_title()
    body = essay_fields(title, wall(lift), credits or [credit(HANDLE[author], FULL_BP)], **fields)
    r = writer.post("/api/essays", body)
    assert r.status_code == 201, r.text
    essay_id = r.json()["id"]
    originals: dict[str, bytes] = {}
    kinds = formats or ["jpeg"] * frames
    for n, kind in enumerate(kinds, start=1):
        data = picture(n, kind, gps=gps)
        up = writer.upload(essay_id, f"frame-{n}.{'png' if kind == 'png' else 'jpg'}", data,
                           "image/png" if kind == "png" else "image/jpeg", caption=f"{title}, frame {n}")
        assert up.status_code == 201, up.text
        originals[up.json()["id"]] = data
    if state != "draft":
        assert writer.post(f"/api/essays/{essay_id}/submit").status_code == 200
        if note is not None:
            assert desk.post(f"/api/essays/{essay_id}/hold", {"note": note}).status_code == 200
            assert writer.post(f"/api/essays/{essay_id}/submit").status_code == 200
        if state in ("embargoed", "live"):
            pub = desk.post(f"/api/essays/{essay_id}/publish")
            assert pub.status_code == 200 and pub.json()["state"] == state, pub.text
    final = desk.get(f"/api/essays/{essay_id}").json()
    return {
        "id": essay_id, "title": final["title"], "caption": final["caption"], "lift_at": instant(final["lift_at"]),
        "credit_line": final["credit_line"], "body": final, "originals": originals,
        "frames": sorted(({"id": f["id"], "position": f["position"]} for f in final["frames"]),
                         key=lambda f: f["position"]),
    }


def claim(api: Api, essay_id: str, kind: str = "exclusive", key: str | None = None) -> httpx.Response:
    return api.post(f"/api/essays/{essay_id}/licences", {"kind": kind},
                    headers={"Idempotency-Key": key or idempotency_key()})


def granted(r: httpx.Response, api: Api) -> dict[str, Any]:
    assert r.status_code in STOOD, r.text
    body = r.json()
    if r.status_code == 201:
        assert body["state"] == "active" and body["invoice_state"] == "raised", body
        return body
    assert body["state"] == "pending_invoice" and body["invoice_state"] == "pending", body
    assert body["receipt_state"] is None, body
    settled = poll(lambda: api.get(f"/api/licences/{body['id']}"),
                   lambda resp: resp.status_code == 200 and resp.json()["state"] == "active"
                   and resp.json()["invoice_state"] == "raised", SETTLE_SECONDS)
    assert settled.status_code == 200, settled.text
    activated = settled.json()
    assert activated["state"] == "active" and activated["invoice_state"] == "raised", activated
    return activated


def grant_record(s3: Any, licence_id: str) -> dict[str, Any] | None:
    try:
        return json.loads(s3.get(f"grants/{licence_id}.json"))
    except AssertionError:
        return None


def licences_on(api: Api, essay_id: str) -> list[dict[str, Any]]:
    r = api.get("/api/licences")
    assert r.status_code == 200, r.text
    return [lic for lic in r.json()["licences"] if lic["essay_id"] == essay_id]


def usage_csv(api: Api) -> tuple[httpx.Response, str, list[dict[str, str]]]:
    r = api.get("/api/usage.csv")
    assert r.status_code == 200, r.text
    raw = r.content.decode("utf-8")
    return r, raw, list(csv.DictReader(io.StringIO(raw, newline="")))


def current_rate(base: str) -> int:
    r = Api(base, "bram").get("/api/commission-rates")
    assert r.status_code == 200
    return int(r.json()["current"]["rate_bp"])


def schedule_rate(base: str, day: date, rate_bp: int) -> httpx.Response:
    return Api(base, "bram").post("/api/commission-rates", {"effective_from": day.isoformat(), "rate_bp": rate_bp})


def inbox(mail: Any, subject: str) -> list[dict[str, Any]]:
    return [m for m in mail.messages() if m.get("Subject") == subject]


def recipients(message: dict[str, Any]) -> list[str]:
    return [a.lower() for a in addresses(message["To"])]


def to(messages: list[dict[str, Any]], who: str) -> list[dict[str, Any]]:
    return [m for m in messages if PEOPLE[who] in recipients(m)]


def wait_mail(mail: Any, subject: str, people: set[str], seconds: float = MAIL_SECONDS) -> list[dict[str, Any]]:
    wanted = {PEOPLE[p] for p in people}
    deadline = monotonic() + seconds
    while True:
        found = inbox(mail, subject)
        got = {a for m in found for a in recipients(m)}
        if wanted <= got or monotonic() > deadline:
            return inbox(mail, subject)


def quiet(mail: Any, subject: str, people: set[str], seconds: float = QUIET_SECONDS) -> None:
    banned = {PEOPLE[p] for p in people}
    deadline = monotonic() + seconds
    while monotonic() < deadline:
        hits = [m for m in inbox(mail, subject) if set(recipients(m)) & banned]
        assert not hits, f"unexpected mail {subject!r} to {[recipients(m) for m in hits]}"


@contextmanager
def entered(obj: Any) -> Iterator[Any]:
    if hasattr(obj, "__enter__"):
        with obj as value:
            yield value
    else:
        value = next(obj)
        try:
            yield value
        finally:
            obj.close()


def app_page(browser: Browser, url: str, **options: Any) -> Any:
    return entered(open_app(browser, url, **options))


def eventually(page: Page, check: Callable[[], None], seconds: float = UI_SECONDS) -> None:
    deadline = monotonic() + seconds
    while True:
        try:
            check()
            return
        except AssertionError:
            if monotonic() > deadline:
                raise
            advance(page, TICK_MS)


def shows(page: Page, locator: Locator) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=POLL_MS))


def reads(page: Page, locator: Locator, value: str) -> None:
    eventually(page, lambda: expect(locator).to_have_text(value, timeout=POLL_MS))


def ui_signin(page: Page, who: str) -> None:
    email = page.get_by_role("textbox", name="Email")
    shows(page, email)
    email.fill(PEOPLE[who])
    page.get_by_role("textbox", name="Password").fill(PASSWORD)
    page.get_by_role("button", name="Sign in").click()
    shows(page, page.get_by_role("navigation", name="Desk sections"))


@contextmanager
def signed_in(browser: Browser, base: str, who: str, size: tuple[int, int] = DESKTOP,
              **options: Any) -> Iterator[Page]:
    with app_page(browser, f"{base}/sheet", **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        ui_signin(page, who)
        yield page


def go(page: Page, section: str) -> None:
    page.get_by_role("navigation", name="Desk sections").get_by_role("link", name=section, exact=True).click()


def open_story(page: Page, base: str, essay: dict[str, Any], frame: int = 1) -> Locator:
    page.goto(f"{base}/sheet?" + urlencode({"q": essay["title"], "essay": essay["id"], "frame": frame}))
    dialog = page.get_by_role("dialog", name=essay["title"], exact=True)
    shows(page, dialog)
    return dialog


def licence_posts(page: Page) -> list[Any]:
    seen: list[Any] = []
    page.on("request", lambda r: seen.append(r) if r.method == "POST" and "/licences" in r.url else None)
    return seen


def progress(bar: Locator) -> float:
    return float(bar.evaluate("e => Number(e.getAttribute('aria-valuenow') ?? e.value ?? 0)"))


def press_hold(page: Page, button: Locator, ms: float) -> None:
    x, y = center(button)
    page.mouse.move(x, y)
    page.mouse.down()
    advance(page, ms)
    page.mouse.up()


def query(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlsplit(page.url).query)


def assert_query(page: Page, key: str, value: str) -> None:
    assert query(page).get(key) == [value], page.url


def touch(cdp: Any, kind: str, *points: tuple[float, float]) -> None:
    cdp.send("Input.dispatchTouchEvent",
             {"type": kind, "touchPoints": [{"x": x, "y": y, "id": i} for i, (x, y) in enumerate(points)]})


def enable_touch(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 5})
    return cdp


@pytest.fixture
def s3() -> Any:
    return kit.S3()


def test_health_and_served_app(app_url: str) -> None:
    r = httpx.get(f"{app_url}/api/health", timeout=HTTP_SECONDS)
    assert r.status_code == 200 and r.json() == {"status": "ok"}
    assert r.headers["content-type"].startswith("application/json")
    page = httpx.get(f"{app_url}/sheet?q=marsh&essay=salt-marsh-census&frame=3", timeout=HTTP_SECONDS)
    assert page.status_code == 200 and page.text.strip()
    assert not page.headers["content-type"].startswith("application/json")
    clock = httpx.get(f"{app_url}/api/clock", timeout=HTTP_SECONDS).json()
    assert clock["zone"] == "America/Chicago" and clock["now_display"] == coop_time(instant(clock["now"]))


def test_sign_in_and_roles(app_url: str) -> None:
    for who, email in PEOPLE.items():
        user = Api(app_url, who).user
        assert user["email"] == email and user["name"] == NAMES[who] and user["role"] == ROLES[who]
        if who in NEWSROOM:
            slug = NEWSROOM[who]
            assert user["newsroom"] == {"slug": slug, "name": NEWSROOMS[slug][0], "home_zone": NEWSROOMS[slug][1]}
        else:
            assert user["newsroom"] is None
        assert user["contributor_handle"] == HANDLE.get(who)
    bad = httpx.post(f"{app_url}/api/session", json={"email": PEOPLE["priya"], "password": "wrong-proof"},
                     timeout=HTTP_SECONDS)
    api_err(bad, 401, "invalid_credentials")
    api_err(httpx.get(f"{app_url}/api/me", timeout=HTTP_SECONDS), 401, "unauthenticated")
    priya = Api(app_url, "priya")
    assert priya.get("/api/me").json()["user"]["email"] == PEOPLE["priya"]
    future = (coop_day(server_now(app_url)) + timedelta(days=random.randint(4000, 9000))).isoformat()
    api_err(priya.post("/api/commission-rates", {"effective_from": future, "rate_bp": 2500}), 403, "forbidden")
    assert future not in [r["effective_from"] for r in Api(app_url, "bram").get("/api/commission-rates").json()["rates"]]
    june = Api(app_url, "june")
    api_err(claim(june, "floodplain-ledger", "standard"), 403, "forbidden")
    assert all(lic["licensed_by"]["name"] != NAMES["june"] for lic in licences_on(june, "floodplain-ledger"))
    api_err(Api(app_url, "ada").get("/api/usage"), 403, "forbidden")
    api_err(Api(app_url, "wes").get("/api/desk/queue"), 403, "forbidden")
    api_err(Api(app_url, "ines").post("/api/royalty-statements", {"month": "2026-01"}), 403, "forbidden")
    api_err(Api(app_url, "bram").post("/api/essays", essay_fields(fresh_title(), "2026-11-20T08:00",
                                                                     [credit("ada-reyes", FULL_BP)])), 403, "forbidden")
    out = priya.delete("/api/session")
    assert out.status_code == 204
    api_err(priya.get("/api/me"), 401, "unauthenticated")


def test_error_shape_and_precedence(app_url: str) -> None:
    anon = httpx.Client(base_url=app_url, timeout=HTTP_SECONDS)
    api_err(anon.post("/api/essays", content=b"{" + b" " * (MAX_JSON_BYTES + 1) + b"}",
                      headers={"content-type": "application/json"}), 413, "payload_too_large")
    api_err(anon.post("/api/essays", content=b"title=x", headers={"content-type": "text/plain"}), 415,
            "unsupported_media_type")
    api_err(anon.get(f"/api/essays/{UNKNOWN_ESSAY}"), 401, "unauthenticated")
    draft = create_essay(app_url, state="draft")
    live = create_essay(app_url)
    review = create_essay(app_url, state="in_review")
    gone = create_essay(app_url)
    assert Api(app_url, "ines").post(f"/api/essays/{gone['id']}/takedown", {"reference": "REF-probe"}).status_code == 200
    wes = Api(app_url, "wes")
    api_err(wes.post(f"/api/essays/{draft['id']}/submit"), 404, "not_found")
    api_err(wes.get(f"/api/essays/{UNKNOWN_ESSAY}"), 404, "not_found")
    api_err(Api(app_url, "tomas").post(f"/api/essays/{gone['id']}/submit"), 410, "taken_down")
    priya = Api(app_url, "priya")
    api_err(priya.post(f"/api/essays/{live['id']}/publish"), 403, "forbidden")
    api_err(priya.post("/api/commission-rates", {}), 403, "forbidden")
    ada = Api(app_url, "ada")
    api_err(ada.patch(f"/api/essays/{review['id']}", {"title": ""}), 428, "precondition_required")
    version = review["body"]["version"]
    conflict = api_err(ada.patch(f"/api/essays/{review['id']}", {"title": ""},
                                 headers={"If-Match": f'"{version - 1}"'}), 412, "version_conflict")
    assert conflict["current_version"] == version
    api_err(ada.patch(f"/api/essays/{review['id']}", {"title": ""}, headers={"If-Match": f'"{version}"'}), 409,
            "illegal_transition")
    api_err(Api(app_url, "ines").post(f"/api/essays/{live['id']}/hold", {"note": ""}), 409, "illegal_transition")
    error = field_err(Api(app_url, "bram").post("/api/commission-rates", {"rate_bp": 2500}), effective_from=DATE_MESSAGE)
    assert "fields" in error and set(error) <= {"code", "message", "fields"}


def test_server_boundary(app_url: str) -> None:
    foreign = "http://elsewhere.invalid"
    health = httpx.get(f"{app_url}/api/health", headers={"Origin": foreign}, timeout=HTTP_SECONDS)
    assert not [h for h in health.headers if h.lower().startswith("access-control-")]
    body = {"email": PEOPLE["priya"], "password": PASSWORD}
    api_err(httpx.post(f"{app_url}/api/session", json=body, headers={"Origin": foreign}, timeout=HTTP_SECONDS), 403,
            "cross_origin")
    origin = f"{urlsplit(app_url).scheme}://{urlsplit(app_url).netloc}"
    ok = httpx.post(f"{app_url}/api/session", json=body, headers={"Origin": origin}, timeout=HTTP_SECONDS)
    assert ok.status_code == 200
    cookie = ok.headers.get("set-cookie", "")
    assert "HttpOnly".lower() in cookie.lower() and "SameSite=Lax".lower() in cookie.lower()
    frame = b'{"email":"","password":"x"}'
    exact = frame.replace(b'""', b'"' + b"a" * (MAX_JSON_BYTES - len(frame)) + b'"', 1)
    assert len(exact) == MAX_JSON_BYTES
    api_err(httpx.post(f"{app_url}/api/session", content=exact, headers={"content-type": "application/json"},
                       timeout=HTTP_SECONDS), 401, "invalid_credentials")
    over = frame.replace(b'""', b'"' + b"a" * (MAX_JSON_BYTES - len(frame) + 1) + b'"', 1)
    api_err(httpx.post(f"{app_url}/api/session", content=over, headers={"content-type": "application/json"},
                       timeout=HTTP_SECONDS), 413, "payload_too_large")
    for path in SOURCE_PATHS:
        r = httpx.get(f"{app_url}{path}", timeout=HTTP_SECONDS)
        assert r.status_code == 404, path
    sheet = httpx.get(f"{app_url}/sheet?q=anything&essay=x&frame=2", timeout=HTTP_SECONDS)
    assert sheet.status_code == 200 and sheet.text.strip()
    assert not sheet.headers["content-type"].startswith("application/json")


def test_essay_draft_fields(app_url: str) -> None:
    ada, noor = Api(app_url, "ada"), Api(app_url, "noor")
    title = fresh_title()
    credits = [credit("ada-reyes", 5000), credit("tomas-whitcombe", 3333), credit("noor-haddad", 1667)]
    body = essay_fields(title, "2026-11-20T08:00", credits, caption=MULTILINE_CAPTION)
    sneaky = ada.post("/api/essays", {**body, "state": "live", "lift_at": "2026-10-01T00:00:00Z"})
    err = field_err(sneaky, state=UNKNOWN_FIELD, lift_at=UNKNOWN_FIELD)
    assert set(err["fields"]) == {"state", "lift_at"}
    assert title not in [e["title"] for e in ada.get("/api/studio/essays").json()["essays"]]
    r = ada.post("/api/essays", {**body, "title": f"  {title}  "})
    assert r.status_code == 201, r.text
    essay = r.json()
    assert essay["version"] == 1 and essay["state"] == "draft" and essay["title"] == title
    assert essay["caption"] == MULTILINE_CAPTION and essay["lift_local"] == "2026-11-20T08:00"
    assert (essay["exclusive_days"], essay["standard_days"]) == (3, 7)
    assert (essay["exclusive_price_minor"], essay["standard_price_minor"]) == (EX_PRICE, ST_PRICE)
    assert [(c["handle"], c["name"], c["position"], c["split_bp"]) for c in essay["credits"]] == [
        ("ada-reyes", "Ada Reyes", 1, 5000), ("tomas-whitcombe", "Tomas Whitcombe", 2, 3333),
        ("noor-haddad", "Noor Haddad", 3, 1667)]
    assert essay["credit_line"] == credit_line([NAMES["ada"], NAMES["tomas"], NAMES["noor"]])
    assert essay["frames"] == [] and essay["withdrawal_requested"] is False
    edited = noor.patch(f"/api/essays/{essay['id']}", {"credits": [credit("noor-haddad", 6000), credit("tomas-whitcombe", 4000)],
                                                       "exclusive_days": 14, "standard_price_minor": 100},
                        headers={"If-Match": '"1"'})
    assert edited.status_code == 200, edited.text
    after = edited.json()
    assert after["version"] == 2 and edited.headers["etag"] == etag(2)
    assert after["credit_line"] == credit_line([NAMES["noor"], NAMES["tomas"]])
    assert [c["position"] for c in after["credits"]] == [1, 2]
    assert after["exclusive_days"] == 14 and after["standard_price_minor"] == 100 and after["title"] == title
    field_err(noor.patch(f"/api/essays/{essay['id']}", {"credits": [credit("tomas-whitcombe", FULL_BP)]},
                         headers={"If-Match": '"2"'}), credits=CREDIT_SELF)
    for key, value, message in [("exclusive_days", 15, EXCLUSIVE_MESSAGE), ("standard_days", 0, STANDARD_MESSAGE),
                                ("exclusive_price_minor", 99, PRICE_MESSAGE),
                                ("standard_price_minor", 10000001, PRICE_MESSAGE),
                                ("caption", "c" * 2001, CAPTION_MESSAGE), ("lift_local", "2026-11-20 08:00", LIFT_MESSAGE),
                                ("title", "   ", TITLE_LENGTH), ("title", "t" * (TITLE_MAX + 1), TITLE_LENGTH)]:
        field_err(noor.patch(f"/api/essays/{essay['id']}", {key: value}, headers={"If-Match": '"2"'}), **{key: message})
    now = noor.get(f"/api/essays/{essay['id']}")
    assert now.headers["etag"] == etag(2) and now.json()["exclusive_days"] == 14


def test_credit_rules_and_share_total(app_url: str) -> None:
    ada = Api(app_url, "ada")
    title = fresh_title()
    others = [credit(f"probe-{i}", 1000) for i in range(7)]
    cases = [
        ([], CREDITS_COUNT),
        (others, CREDITS_COUNT),
        ([{"contributor": "ada-reyes"}], CREDIT_ENTRY),
        ([credit("ada-reyes", 0)], CREDIT_ENTRY),
        ([{"contributor": "ada-reyes", "split_bp": "5000"}, credit("noor-haddad", 5000)], CREDIT_ENTRY),
        (["ada-reyes"], CREDIT_ENTRY),
        ([{"contributor": "ada-reyes", "split_bp": 5000, "role": "lead"}, credit("nobody-probe", 5000)], CREDIT_KEYS),
        ([credit("ada-reyes", 5000), credit("nobody-probe", 4000)], "Unknown contributor nobody-probe"),
        ([credit("ada-reyes", 5000), credit("ada-reyes", 5000)], CREDIT_TWICE),
        ([credit("tomas-whitcombe", FULL_BP)], CREDIT_SELF),
        ([credit("ada-reyes", 6000), credit("noor-haddad", 3999)], "Shares must total 10000 basis points (now 9999)"),
        ([credit("ada-reyes", 5000), credit("noor-haddad", 5001)], "Shares must total 10000 basis points (now 10001)"),
    ]
    for credits, message in cases:
        field_err(ada.post("/api/essays", essay_fields(title, "2026-11-20T08:00", credits)), credits=message)
    field_err(ada.post("/api/essays", {k: v for k, v in essay_fields(title, "2026-11-20T08:00", []).items()
                                       if k != "credits"}), credits=CREDITS_COUNT)
    assert title not in [e["title"] for e in ada.get("/api/studio/essays").json()["essays"]]
    ok = ada.post("/api/essays", essay_fields(title, "2026-11-20T08:00",
                                              [credit("ada-reyes", 6000), credit("noor-haddad", 4000)]))
    assert ok.status_code == 201 and sum(c["split_bp"] for c in ok.json()["credits"]) == FULL_BP


def test_lift_resolution(app_url: str) -> None:
    ada = Api(app_url, "ada")
    cases = [
        ("2026-11-01T01:30", "2026-11-01T06:30:00Z", "first_occurrence", "Sun 1 Nov 2026 · 01:30 CDT"),
        ("2027-03-14T02:30", iso(local(date(2027, 3, 14), 3, 0)), "shifted_after_gap", "Sun 14 Mar 2027 · 03:00 CDT"),
        ("2026-12-15T09:00", iso(local(date(2026, 12, 15), 9, 0)), "exact", coop_time(local(date(2026, 12, 15), 9, 0))),
    ]
    for lift_local, lift_at, resolution, display in cases:
        r = ada.post("/api/essays", essay_fields(fresh_title(), lift_local, [credit("ada-reyes", FULL_BP)]))
        assert r.status_code == 201, r.text
        essay = r.json()
        assert (essay["lift_local"], essay["lift_at"], essay["lift_resolution"], essay["lift_display"]) == (
            lift_local, lift_at, resolution, display)
    r = ada.post("/api/essays", essay_fields(fresh_title(), "2026-12-15T09:00", [credit("ada-reyes", FULL_BP)]))
    moved = ada.patch(f"/api/essays/{r.json()['id']}", {"lift_local": "2026-11-01T01:30"}, headers={"If-Match": '"1"'})
    assert moved.json()["lift_at"] == "2026-11-01T06:30:00Z" and moved.json()["lift_resolution"] == "first_occurrence"
    for bad in ["2026-02-30T10:00", "2026-11-01 01:30", "2026-11-01T25:00", "01/11/2026 01:30"]:
        field_err(ada.post("/api/essays", essay_fields(fresh_title(), bad, [credit("ada-reyes", FULL_BP)])),
                  lift_local=LIFT_MESSAGE)


UPLOAD_CASES = {
    "jpeg-named-png": ("jpeg", "portrait.png", "text/plain"),
    "png-named-jpg": ("png", "portrait.jpg", "image/jpeg"),
    "gif-named-jpg": ("gif", "portrait.jpg", "image/jpeg"),
    "tiff": ("tiff", "portrait.jpg", "image/jpeg"),
    "svg-with-script": ("svg", "portrait.jpg", "image/jpeg"),
    "html": ("html", "portrait.jpg", "image/jpeg"),
    "text": ("text", "portrait.jpeg", "image/jpeg"),
    "unreadable-jpeg": ("broken", "portrait.jpg", "image/jpeg"),
    "jpeg-at-limit": ("limit", "portrait.jpg", "image/jpeg"),
    "jpeg-over-limit": ("over", "portrait.jpg", "image/jpeg"),
    "path-traversal-name": ("jpeg", "../../etc/cron.d/portrait.jpg", "image/jpeg"),
    "twenty-fifth-frame": ("many", "portrait.jpg", "image/jpeg"),
}


@pytest.mark.parametrize("case", list(UPLOAD_CASES), ids=list(UPLOAD_CASES))
def test_upload_sniffing(app_url: str, s3: Any, case: str) -> None:
    kind, name, declared = UPLOAD_CASES[case]
    essay = create_essay(app_url, state="draft", frames=0)
    ada = Api(app_url, "ada")
    small = picture(5, size=(64, 64))
    payloads = {
        "jpeg": small, "png": picture(6, "png", size=(64, 64)), "gif": picture(7, "gif", size=(64, 64)),
        "tiff": picture(8, "tiff", size=(64, 64)),
        "svg": b'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        "html": b"<!doctype html><html><body>frame</body></html>", "text": b"just some words",
        "broken": b"\xff\xd8\xff" + b"not an image" * 20,
        "limit": pad_jpeg(small, MAX_UPLOAD_BYTES), "over": b"\xff\xd8\xff" + bytes(MAX_UPLOAD_BYTES - 2),
        "many": small,
    }
    if kind == "many":
        for n in range(MAX_FRAMES):
            assert ada.upload(essay["id"], f"f{n}.jpg", picture(n, size=(48, 48))).status_code == 201
        field_err(ada.upload(essay["id"], name, small), file="An essay holds at most 24 frames")
        assert len(ada.get(f"/api/essays/{essay['id']}").json()["frames"]) == MAX_FRAMES
        return
    data = payloads[kind]
    r = ada.upload(essay["id"], name, data, declared)
    if kind in ("jpeg", "png", "limit"):
        assert r.status_code == 201, r.text
        frame = r.json()
        assert frame["type"] == ("image/png" if kind == "png" else "image/jpeg")
        assert frame["bytes"] == len(data) and frame["filename"] == name.rsplit("/", 1)[-1]
        assert s3.get(f"originals/{essay['id']}/{frame['id']}") == data
        assert all(PROBE_STEM not in k and ".." not in k for k in s3.keys(f"originals/{essay['id']}"))
        return
    if kind == "over":
        api_err(r, 413, "file_too_large")
    elif kind == "broken":
        field_err(r, file="This file can't be read as an image")
    else:
        api_err(r, 415, "unsupported_type")
    assert s3.keys(f"originals/{essay['id']}") == []
    after = ada.get(f"/api/essays/{essay['id']}")
    assert after.json()["frames"] == [] and after.headers["etag"] == etag(1)


def test_derivatives_strip_location(app_url: str, s3: Any) -> None:
    essay = create_essay(app_url, gps=True)
    frame_id, original = next(iter(essay["originals"].items()))
    assert gps_of(original), "probe original must carry GPS"
    stored = s3.get(f"originals/{essay['id']}/{frame_id}")
    assert stored == original and gps_of(stored)
    sizes = {"grid": (GRID_PX, GRID_PX), "story": (STORY_EDGE, STORY_EDGE * 3 // 4),
             "preview": (PREVIEW_EDGE, PREVIEW_EDGE * 3 // 4)}
    ada, priya = Api(app_url, "ada"), Api(app_url, "priya")
    for variant, size in sizes.items():
        key = f"derivatives/{essay['id']}/{frame_id}/{variant}.jpg"
        assert key in s3.keys(f"derivatives/{essay['id']}")
        r = ada.get(f"/media/frames/{frame_id}/{variant}")
        assert r.status_code == 200 and r.headers["content-type"].startswith("image/jpeg")
        img = Image.open(io.BytesIO(r.content))
        assert img.format == "JPEG" and img.size == size and gps_of(r.content) == {}
        assert gps_of(s3.get(key)) == {}
    for variant in ("grid", "preview"):
        r = priya.get(f"/media/frames/{frame_id}/{variant}")
        assert r.status_code == 200 and gps_of(r.content) == {}
    assert priya.get(f"/media/frames/{frame_id}/story").status_code == 404


def test_essay_versions(app_url: str) -> None:
    essay = create_essay(app_url, state="draft", frames=0,
                         credits=[credit("ada-reyes", 5000), credit("noor-haddad", 5000)])
    ada, noor = Api(app_url, "ada"), Api(app_url, "noor")
    path = f"/api/essays/{essay['id']}"
    assert ada.get(path).headers["etag"] == etag(1)
    api_err(ada.patch(path, {"caption": "a"}), 428, "precondition_required")
    field_err(ada.patch(path, {"caption": "a", "version": 9}, headers={"If-Match": '"1"'}), version=UNKNOWN_FIELD)
    up = ada.upload(essay["id"], "one.jpg", picture(1, size=(64, 64)))
    assert up.status_code == 201 and up.json()["essay_version"] == 2 and up.headers["etag"] == etag(2)
    frame_id = up.json()["id"]
    cap = ada.patch(f"/api/frames/{frame_id}", {"caption": "Levee at dusk"})
    assert cap.status_code == 200 and cap.json()["essay_version"] == 3 and cap.headers["etag"] == etag(3)
    stale = api_err(noor.patch(path, {"title": fresh_title()}, headers={"If-Match": '"2"'}), 412, "version_conflict")
    assert stale["current_version"] == 3
    results = together([lambda: ada.patch(path, {"caption": "ada wins"}, headers={"If-Match": '"3"'}),
                        lambda: noor.patch(path, {"caption": "noor wins"}, headers={"If-Match": '"3"'})])
    assert sorted(r.status_code for r in results) == [200, 412]
    gone = ada.delete(f"/api/frames/{frame_id}")
    assert gone.status_code == 204 and gone.headers["etag"] == etag(5)
    again = ada.upload(essay["id"], "two.jpg", picture(2, size=(64, 64)))
    assert again.json()["essay_version"] == 6
    sub = ada.post(f"{path}/submit")
    assert sub.status_code == 200 and sub.json()["version"] == 7
    assert ada.get(path).headers["etag"] == etag(7)


def test_wf_contributor_submission_happy(browser: Browser, app_url: str, s3: Any) -> None:
    title = fresh_title("Studio")
    files = [picture(11, size=(640, 480)), picture(12, size=(640, 480))]
    with signed_in(browser, app_url, "ada") as page:
        go(page, "Studio")
        page.get_by_role("button", name="New essay").click()
        form = page.get_by_role("form", name="Essay details")
        shows(page, form)
        form.get_by_role("textbox", name="Title", exact=True).fill(title)
        form.get_by_role("textbox", name="Caption", exact=True).fill("Levee road after the crest")
        lift = form.get_by_role("textbox", name="Embargo lift (co-op time)")
        lift.fill("2026-11-01T01:30")
        lift.press("Tab")
        lift_at = instant("2026-11-01T06:30:00Z")
        shows(page, page.get_by_text(f"Lifts {coop_time(lift_at)}"))
        shows(page, page.get_by_text(
            f"That time happens twice on {coop_date(coop_day(lift_at))}; Saltprint uses the first."))
        form.get_by_role("spinbutton", name="Exclusive window days").fill("3")
        form.get_by_role("spinbutton", name="Standard window days").fill("7")
        form.get_by_role("textbox", name="Exclusive price (USD)").fill("450.00")
        form.get_by_role("textbox", name="Standard price (USD)").fill("120.00")
        first_row, second_row = 1, 2
        share1 = form.get_by_role("textbox", name=f"Share {first_row} (percent)")
        share1.press_sequentially(str(6000 // 100))
        shows(page, page.get_by_text(f"Shares total {percent(6000)}% of 100.00%"))
        form.get_by_role("button", name="Add co-contributor").click()
        combo = form.get_by_role("combobox", name=f"Co-contributor {second_row}")
        expect(combo).to_be_focused()
        select(combo, NAMES["noor"])
        form.get_by_role("textbox", name=f"Share {second_row} (percent)").press_sequentially(str(4000 // 100))
        shows(page, page.get_by_text(f"Shares total {percent(FULL_BP)}% of 100.00%"))
        form.get_by_role("button", name="Save draft").click()
        reads(page, page.get_by_role("status", name="Essay status"), "Draft saved.")
        page.get_by_label("Upload frames").set_input_files([
            {"name": "levee-1.jpg", "mimeType": "image/jpeg", "buffer": files[0]},
            {"name": "levee-2.jpg", "mimeType": "image/jpeg", "buffer": files[1]}])
        reads(page, page.get_by_role("status", name="Upload status"), f"{UPLOAD_NAMES[1]} uploaded.")
        page.get_by_role("button", name="Submit for review").click()
        reads(page, page.get_by_role("status", name="Essay status"), "Submitted. In review.")
        shows(page, page.get_by_text("In review").first)
        shows(page, page.get_by_text("Sun 1 Nov 2026 · 01:30 CDT").first)
    mine = [e for e in Api(app_url, "ada").get("/api/studio/essays").json()["essays"] if e["title"] == title]
    assert len(mine) == 1
    essay = mine[0]
    assert essay["state"] == "in_review" and essay["lift_at"] == "2026-11-01T06:30:00Z"
    assert [(c["handle"], c["split_bp"]) for c in essay["credits"]] == [("ada-reyes", 6000), ("noor-haddad", 4000)]
    assert (essay["exclusive_price_minor"], essay["standard_price_minor"]) == (EX_PRICE, ST_PRICE)
    stored = sorted(s3.get(f"originals/{essay['id']}/{f['id']}") for f in essay["frames"])
    assert stored == sorted(files)


def test_wf_contributor_submission_stale_save(browser: Browser, app_url: str) -> None:
    title = fresh_title("Stale")
    with signed_in(browser, app_url, "ada") as page:
        go(page, "Studio")
        page.get_by_role("button", name="New essay").click()
        form = page.get_by_role("form", name="Essay details")
        shows(page, form)
        form.get_by_role("textbox", name="Title", exact=True).fill(title)
        form.get_by_role("textbox", name="Caption", exact=True).fill(CAPTIONS[0])
        form.get_by_role("textbox", name="Embargo lift (co-op time)").fill("2026-11-20T08:00")
        form.get_by_role("spinbutton", name="Exclusive window days").fill("3")
        form.get_by_role("spinbutton", name="Standard window days").fill("7")
        form.get_by_role("textbox", name="Exclusive price (USD)").fill("450.00")
        form.get_by_role("textbox", name="Standard price (USD)").fill("120.00")
        first_row, second_row = 1, 2
        form.get_by_role("textbox", name=f"Share {first_row} (percent)").fill(str(5000 // 100))
        form.get_by_role("button", name="Add co-contributor").click()
        select(form.get_by_role("combobox", name=f"Co-contributor {second_row}"), NAMES["noor"])
        form.get_by_role("textbox", name=f"Share {second_row} (percent)").fill(str(5000 // 100))
        form.get_by_role("button", name="Save draft").click()
        status = page.get_by_role("status", name="Essay status")
        reads(page, status, "Draft saved.")
        page.get_by_label("Upload frames").set_input_files(
            [{"name": UPLOAD_NAMES[2], "mimeType": "image/jpeg", "buffer": picture(3, size=(320, 240))}])
        reads(page, page.get_by_role("status", name="Upload status"), f"{UPLOAD_NAMES[2]} uploaded.")
        form.get_by_role("textbox", name="Caption", exact=True).fill(CAPTIONS[1])
        form.get_by_role("button", name="Save draft").click()
        reads(page, status, "Draft saved.")
        essay = next(e for e in Api(app_url, "ada").get("/api/studio/essays").json()["essays"] if e["title"] == title)
        noor = Api(app_url, "noor")
        etag = noor.get(f"/api/essays/{essay['id']}").headers["etag"]
        noor_title = fresh_title("Noor")
        assert noor.patch(f"/api/essays/{essay['id']}", {"title": noor_title}, headers={"If-Match": etag}).status_code == 200
        typed = f"{title} revised"
        form.get_by_role("textbox", name="Title", exact=True).fill(typed)
        form.get_by_role("textbox", name="Caption", exact=True).fill(CAPTIONS[2])
        form.get_by_role("button", name="Save draft").click()
        reads(page, page.get_by_role("alert"), STALE_COPY)
        expect(form.get_by_role("textbox", name="Title", exact=True)).to_have_value(typed)
        expect(form.get_by_role("textbox", name="Caption", exact=True)).to_have_value(CAPTIONS[2])
    stored = Api(app_url, "ada").get(f"/api/essays/{essay['id']}").json()
    assert stored["title"] == noor_title and stored["caption"] == CAPTIONS[1]


def test_lifecycle_transitions(app_url: str) -> None:
    ada, desk = Api(app_url, "ada"), Api(app_url, "ines")
    essay = create_essay(app_url, state="draft", frames=0, lift=server_now(app_url) + timedelta(days=4))
    path = f"/api/essays/{essay['id']}"
    e = api_err(desk.post(f"{path}/publish"), 409, "illegal_transition")
    assert e["from"] == "draft" and "action" in e
    field_err(ada.post(f"{path}/submit"), frames="Add at least one frame before submitting")
    assert api_err(ada.post(f"{path}/withdrawal-request"), 409, "illegal_transition")["from"] == "draft"
    api_err(desk.post(f"{path}/takedown", {"reference": "REF-1"}), 409, "illegal_transition")
    ada.upload(essay["id"], "f.jpg", picture(1, size=(64, 64)))
    sub = ada.post(f"{path}/submit")
    assert sub.status_code == 200 and sub.json()["state"] == "in_review"
    assert api_err(ada.post(f"{path}/submit"), 409, "illegal_transition")["from"] == "in_review"
    field_err(desk.post(f"{path}/hold", {}), note=NOTE_MESSAGE)
    field_err(desk.post(f"{path}/hold", {"note": ""}), note=NOTE_MESSAGE)
    field_err(desk.post(f"{path}/publish", {"state": "live"}), state=UNKNOWN_FIELD)
    assert desk.get(path).json()["state"] == "in_review"
    held_back = desk.post(f"{path}/hold", {"note": HOLD_NOTE})
    assert held_back.status_code == 200 and held_back.json()["state"] == "draft"
    assert [n["note"] for n in ada.get(path).json()["desk_notes"]][-1] == HOLD_NOTE
    ada.post(f"{path}/submit")
    pub = desk.post(f"{path}/publish")
    assert pub.json()["state"] == "embargoed"
    assert api_err(desk.post(f"{path}/publish"), 409, "illegal_transition")["from"] == "embargoed"
    api_err(desk.post(f"{path}/hold", {"note": "late"}), 409, "illegal_transition")
    api_err(desk.post(f"{path}/withdraw"), 409, "no_withdrawal_request")
    live = create_essay(app_url, state="in_review", lift=server_now(app_url) - timedelta(days=1))
    assert desk.post(f"/api/essays/{live['id']}/publish").json()["state"] == "live"
    down = desk.post(f"/api/essays/{live['id']}/takedown", {"reference": "REF-2"})
    assert down.status_code == 200 and down.json()["state"] == "taken_down"
    assert api_err(desk.post(f"/api/essays/{live['id']}/takedown", {"reference": "REF-3"}), 409,
                   "illegal_transition")["from"] == "taken_down"


def test_desk_notes_stay_internal(browser: Browser, app_url: str, mail: Any) -> None:
    note = f"Internal desk note {unique('note')[0]}"
    reference = f"LEGAL-{unique('ref')[0]}"
    essay = create_essay(app_url, note=note, credits=[credit("ada-reyes", 6000), credit("noor-haddad", 4000)])
    priya, june = Api(app_url, "priya"), Api(app_url, "june")
    secrets = [note, reference, SEED_DESK_NOTE, *PAYOUT_ACCOUNTS]
    for path in [f"/api/essays/{essay['id']}", "/api/essays/floodplain-ledger", f"/api/feed?q={essay['title']}"]:
        r = priya.get(path)
        assert r.status_code == 200
        assert not any(s in r.text for s in secrets) and "split_bp" not in r.text and "desk_notes" not in r.text
    view = priya.get(f"/api/essays/{essay['id']}").json()
    assert "withdrawal_requested" not in view and all("story_url" not in f for f in view["frames"])
    api_err(priya.get("/api/commission-rates"), 403, "forbidden")
    lic = granted(claim(priya, essay["id"]), priya)
    receipts = wait_mail(mail, f"Licence receipt: {essay['title']}", {"priya", "june"})
    assert receipts and not any(s in text(m) for m in receipts for s in secrets)
    assert Api(app_url, "ines").post(f"/api/essays/{essay['id']}/takedown", {"reference": reference}).status_code == 200
    notices = wait_mail(mail, f"Takedown notice: {essay['title']}", {"priya", "june"})
    assert notices and not any(s in text(m) for m in notices for s in secrets)
    for r in [priya.get("/api/licences"), june.get("/api/usage.csv"), priya.get(f"/api/licences/{lic['id']}")]:
        assert not any(s in r.text for s in secrets)
    other = create_essay(app_url, note=note)
    with signed_in(browser, app_url, "priya") as page:
        open_story(page, app_url, other)
        assert not any(s in page.content() for s in secrets)


def test_contributor_withdrawal(app_url: str) -> None:
    essay = create_essay(app_url, credits=[credit("ada-reyes", 5000), credit("noor-haddad", 5000)], frames=2)
    priya, wes, noor, desk = Api(app_url, "priya"), Api(app_url, "wes"), Api(app_url, "noor"), Api(app_url, "ines")
    lic = granted(claim(priya, essay["id"], "standard"), priya)
    item = wes.post("/api/shortlist", {"frame_id": essay["frames"][0]["id"]})
    assert item.status_code == 201
    api_err(desk.post(f"/api/essays/{essay['id']}/withdraw"), 409, "no_withdrawal_request")
    api_err(Api(app_url, "tomas").post(f"/api/essays/{essay['id']}/withdrawal-request"), 403, "forbidden")
    req = noor.post(f"/api/essays/{essay['id']}/withdrawal-request")
    assert req.status_code == 200 and req.json()["withdrawal_requested"] is True
    queue = desk.get("/api/desk/queue").json()
    assert essay["id"] in [e["id"] for e in queue["withdrawal_requests"]]
    done = desk.post(f"/api/essays/{essay['id']}/withdraw")
    assert done.status_code == 200 and done.json()["state"] == "withdrawn"
    for api in (priya, wes):
        assert essay["id"] not in [e["id"] for e in api.get(f"/api/feed?q={essay['title']}").json()["essays"]]
        assert essay["id"] not in [e["id"] for e in api.get("/api/feed").json()["essays"]]
    assert essay["id"] not in [i["essay_id"] for i in wes.get("/api/shortlist").json()["items"]]
    assert priya.get(f"/api/essays/{essay['id']}").status_code == 200
    api_err(wes.get(f"/api/essays/{essay['id']}"), 404, "not_found")
    assert priya.get(f"/api/licences/{lic['id']}").json()["state"] == "active"
    assert priya.post(f"/api/licences/{lic['id']}/grants", {"frame_id": essay["frames"][1]["id"]}).status_code == 201
    api_err(noor.post(f"/api/essays/{essay['id']}/withdrawal-request"), 409, "illegal_transition")


def test_wf_desk_review_publish_hold(browser: Browser, app_url: str) -> None:
    lift = server_now(app_url) + timedelta(days=5)
    first = create_essay(app_url, state="in_review", lift=lift)
    second = create_essay(app_url, state="in_review")
    note = f"Needs a stronger opener {unique('note')[0]}"
    with signed_in(browser, app_url, "ines") as page:
        go(page, "Review queue")
        queue = page.get_by_role("list", name="Review queue")
        status = page.get_by_role("status", name="Desk status")
        shows(page, queue.get_by_role("button", name=f"Publish {first['title']}", exact=True))
        queue.get_by_role("button", name=f"Publish {first['title']}", exact=True).click()
        reads(page, status, "Published.")
        queue.get_by_role("button", name=f"Hold {second['title']}", exact=True).click()
        dialog = page.get_by_role("dialog", name="Hold essay")
        shows(page, dialog)
        dialog.get_by_role("textbox", name="Desk note").fill(note)
        dialog.get_by_role("button", name="Hold essay").click()
        reads(page, status, "Held and returned to the contributor.")
        for essay in (first, second):
            eventually(page, lambda e=essay: expect(queue.get_by_role(
                "button", name=f"Publish {e['title']}", exact=True)).to_have_count(0, timeout=POLL_MS))
        go(page, "Contact sheet")
        page.get_by_role("searchbox", name="Search essays").fill(first["title"])
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {first['title']}", exact=True)
        eventually(page, lambda: expect(tile).to_contain_text(
            f"EMBARGOED · lifts {coop_time(first['lift_at'])}", timeout=POLL_MS))
    desk = Api(app_url, "ines")
    assert desk.get(f"/api/essays/{first['id']}").json()["state"] == "embargoed"
    held_back = desk.get(f"/api/essays/{second['id']}").json()
    assert held_back["state"] == "draft" and held_back["desk_notes"][-1]["note"] == note
    queued = [e["id"] for e in desk.get("/api/desk/queue").json()["essays"]]
    assert first["id"] not in queued and second["id"] not in queued


def test_wf_desk_review_withdrawal(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    assert Api(app_url, "ada").post(f"/api/essays/{essay['id']}/withdrawal-request").status_code == 200
    with signed_in(browser, app_url, "ines") as page:
        go(page, "Review queue")
        button = page.get_by_role("list", name="Withdrawal requests").get_by_role(
            "button", name=f"Carry out withdrawal of {essay['title']}", exact=True)
        shows(page, button)
        button.click()
        reads(page, page.get_by_role("status", name="Desk status"), "Withdrawal carried out.")
    assert Api(app_url, "ines").get(f"/api/essays/{essay['id']}").json()["state"] == "withdrawn"
    assert essay["id"] not in [e["id"] for e in Api(app_url, "priya").get("/api/feed").json()["essays"]]


def test_follows(app_url: str) -> None:
    essay = create_essay(app_url, state="embargoed")
    draft = create_essay(app_url, state="draft", frames=0)
    priya, dev = Api(app_url, "priya"), Api(app_url, "dev")
    for f in priya.get("/api/follows").json()["follows"]:
        if f.get("contributor") == "tomas-whitcombe":
            assert priya.delete(f"/api/follows/{f['id']}").status_code == 204
    first = priya.post("/api/follows", {"essay_id": essay["id"]})
    assert first.status_code == 201 and first.json()["essay_id"] == essay["id"]
    again = priya.post("/api/follows", {"essay_id": essay["id"]})
    assert again.status_code == 200 and again.json()["id"] == first.json()["id"]
    person = priya.post("/api/follows", {"contributor": "tomas-whitcombe"})
    assert person.status_code == 201 and person.json()["contributor"] == "tomas-whitcombe"
    mine = {f["id"] for f in priya.get("/api/follows").json()["follows"]}
    assert {first.json()["id"], person.json()["id"]} <= mine
    assert not mine & {f["id"] for f in dev.get("/api/follows").json()["follows"]}
    api_err(dev.delete(f"/api/follows/{first.json()['id']}"), 404, "not_found")
    own = dev.post("/api/follows", {"essay_id": essay["id"]})
    assert own.status_code == 201 and own.json()["id"] != first.json()["id"]
    api_err(priya.post("/api/follows", {"essay_id": draft["id"]}), 404, "not_found")
    field_err(priya.post("/api/follows", {}), target=TARGET_MESSAGE)
    field_err(priya.post("/api/follows", {"essay_id": essay["id"], "contributor": "ada-reyes"}), target=TARGET_MESSAGE)
    field_err(priya.post("/api/follows", {"contributor": "nobody-probe"}), contributor="Unknown contributor nobody-probe")
    other = create_essay(app_url, state="embargoed")
    racers = [Api(app_url, "priya") for _ in range(4)]
    results = together([lambda a=a: a.post("/api/follows", {"essay_id": other["id"]}) for a in racers])
    assert sorted(r.status_code for r in results) == [200, 200, 200, 201]
    assert len({r.json()["id"] for r in results}) == 1
    for follow_id in (first.json()["id"], person.json()["id"]):
        assert priya.delete(f"/api/follows/{follow_id}").status_code == 204
        api_err(priya.delete(f"/api/follows/{follow_id}"), 404, "not_found")
    assert own.json()["id"] in {f["id"] for f in dev.get("/api/follows").json()["follows"]}


def test_embargo_lifts_once_on_repeated_hour(app_url: str, mail: Any) -> None:
    sunday = fall_back_after(server_now(app_url) + timedelta(days=2))
    essay = create_essay(app_url, state="embargoed", lift=local(sunday, 1, 30),
                         credits=[credit("ada-reyes", 5000), credit("noor-haddad", 5000)])
    lift = essay["lift_at"]
    assert lift == datetime(sunday.year, 11, sunday.day, 1, 30, tzinfo=COOP).astimezone(UTC)
    priya, dev, wes = Api(app_url, "priya"), Api(app_url, "dev"), Api(app_url, "wes")
    assert priya.post("/api/follows", {"essay_id": essay["id"]}).status_code == 201
    assert dev.post("/api/follows", {"essay_id": essay["id"]}).status_code == 201
    person = dev.post("/api/follows", {"contributor": "noor-haddad"})
    assert person.status_code in (200, 201)
    gone = wes.post("/api/follows", {"essay_id": essay["id"]}).json()["id"]
    assert wes.delete(f"/api/follows/{gone}").status_code == 204
    clock_to(app_url, lift - timedelta(seconds=30))
    assert priya.get(f"/api/essays/{essay['id']}").json()["state"] == "embargoed"
    clock_to(app_url, lift)
    started = monotonic()
    state = poll(lambda: priya.get(f"/api/essays/{essay['id']}").json()["state"], lambda s: s == "live",
                 LIFT_SECONDS + POLL_INTERVAL_S * 8)
    assert state == "live" and monotonic() - started <= LIFT_SECONDS + POLL_INTERVAL_S * 8
    subject = f"Embargo lifted: {essay['title']}"
    wait_mail(mail, subject, {"priya", "dev"})
    clock_to(app_url, lift + timedelta(hours=1, seconds=30))
    quiet(mail, subject, {"wes"})
    alerts = inbox(mail, subject)
    assert len(to(alerts, "priya")) == 1 and len(to(alerts, "dev")) == 1 and not to(alerts, "wes")
    body = text(to(alerts, "priya")[0])
    assert essay["title"] in body and essay["credit_line"] in body and coop_time(lift) in body
    if person.status_code == 201:
        dev.delete(f"/api/follows/{person.json()['id']}")


def test_coop_time_on_stamps(browser: Browser, app_url: str) -> None:
    now = server_now(app_url)
    lift = local(coop_day(now) + timedelta(days=3), 20, 0)
    essay = create_essay(app_url, state="embargoed", lift=lift)
    assert essay["body"]["lift_display"] == coop_time(lift)
    hollis = Api(app_url, "hollis")
    lic = granted(claim(hollis, essay["id"], "standard"), hollis)
    for field in ("confirmed", "window_end"):
        at = instant(lic[f"{field}_at" if field == "confirmed" else field])
        assert lic[f"{field}_display"] == coop_time(at) and lic[f"{field}_display"].endswith(("CST", "CDT"))
    assert instant(lic["window_end"]).astimezone(COOP).strftime("%H:%M") == "00:00"
    item = hollis.post("/api/shortlist", {"frame_id": essay["frames"][0]["id"]}).json()
    assert item["added_display"] == coop_time(instant(item["added_at"]))
    with signed_in(browser, app_url, "hollis") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": "Europe/London"})
        page.reload()
        page.get_by_role("searchbox", name="Search essays").fill(essay["title"])
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {essay['title']}", exact=True)
        eventually(page, lambda: expect(tile).to_contain_text(f"EMBARGOED · lifts {coop_time(lift)}", timeout=POLL_MS))
        go(page, "Licences")
        row = page.get_by_role("table", name="Licences").get_by_role("row").filter(has_text=essay["title"])
        eventually(page, lambda: expect(row).to_contain_text(lic["window_end_display"], timeout=POLL_MS))


def test_wf_embargo_alerts_follow(browser: Browser, app_url: str, mail: Any) -> None:
    lift = server_now(app_url) + timedelta(days=2)
    essay = create_essay(app_url, state="embargoed", lift=lift)
    with signed_in(browser, app_url, "priya") as page:
        dialog = open_story(page, app_url, essay)
        dialog.get_by_role("button", name="Follow essay", exact=True).click()
        pressed = dialog.get_by_role("button", name="Following essay", exact=True)
        eventually(page, lambda: expect(pressed).to_have_attribute("aria-pressed", "true", timeout=POLL_MS))
        reads(page, page.get_by_role("status", name="Follow status"), f"Following {essay['title']}.")
        page.keyboard.press("Escape")
        go(page, "Following")
        shows(page, page.get_by_role("list", name="Following").get_by_role(
            "button", name=f"Unfollow {essay['title']}", exact=True))
    assert essay["id"] in [f["essay_id"] for f in Api(app_url, "priya").get("/api/follows").json()["follows"]]
    clock_to(app_url, essay["lift_at"])
    alerts = wait_mail(mail, f"Embargo lifted: {essay['title']}", {"priya"})
    assert len(to(alerts, "priya")) == 1


def test_wf_embargo_alerts_unfollow(browser: Browser, app_url: str, mail: Any) -> None:
    essay = create_essay(app_url, state="embargoed", lift=server_now(app_url) + timedelta(days=2))
    assert Api(app_url, "dev").post("/api/follows", {"essay_id": essay["id"]}).status_code == 201
    assert Api(app_url, "priya").post("/api/follows", {"essay_id": essay["id"]}).status_code == 201
    with signed_in(browser, app_url, "dev") as page:
        go(page, "Following")
        button = page.get_by_role("list", name="Following").get_by_role(
            "button", name=f"Unfollow {essay['title']}", exact=True)
        shows(page, button)
        button.click()
        reads(page, page.get_by_role("status", name="Follow status"), f"Unfollowed {essay['title']}.")
    assert essay["id"] not in [f["essay_id"] for f in Api(app_url, "dev").get("/api/follows").json()["follows"]]
    clock_to(app_url, essay["lift_at"])
    subject = f"Embargo lifted: {essay['title']}"
    assert to(wait_mail(mail, subject, {"priya"}), "priya")
    quiet(mail, subject, {"dev"})


def test_feed_and_search(app_url: str) -> None:
    token = unique("needle")[0]
    now = server_now(app_url)
    by_caption = create_essay(app_url, lift=now - timedelta(days=3), caption=f"levee {token}",
                              credits=[credit("ada-reyes", 5000), credit("noor-haddad", 5000)])
    by_title = create_essay(app_url, title=f"Title {token}", lift=now - timedelta(days=1))
    embargoed = create_essay(app_url, state="embargoed", title=f"Soon {token}", lift=now + timedelta(days=2))
    hidden = create_essay(app_url, state="draft", title=f"Draft {token}")
    review = create_essay(app_url, state="in_review", title=f"Review {token}")
    ada, desk = Api(app_url, "ada"), Api(app_url, "ines")
    frame_essay = create_essay(app_url, state="draft", frames=0, lift=now - timedelta(days=2))
    up = ada.upload(frame_essay["id"], "f.jpg", picture(9, size=(64, 64)), caption=f"rail nest {token}")
    assert up.status_code == 201
    assert ada.post(f"/api/essays/{frame_essay['id']}/submit").status_code == 200
    assert desk.post(f"/api/essays/{frame_essay['id']}/publish").json()["state"] == "live"
    priya = Api(app_url, "priya")
    for q in (token, token.upper()):
        ids = [e["id"] for e in priya.get("/api/feed", params={"q": q}).json()["essays"]]
        mine = [i for i in ids if i in {by_caption["id"], by_title["id"], embargoed["id"], frame_essay["id"]}]
        assert mine == [embargoed["id"], by_title["id"], frame_essay["id"], by_caption["id"]]
        assert hidden["id"] not in ids and review["id"] not in ids
    by_name = [e["id"] for e in priya.get("/api/feed", params={"q": "NOOR haddad"}).json()["essays"]]
    assert by_caption["id"] in by_name and by_title["id"] not in by_name
    feed = priya.get("/api/feed").json()["essays"]
    assert {by_title["id"], embargoed["id"]} <= {e["id"] for e in feed}
    assert {e["state"] for e in feed} <= {"embargoed", "live"}
    lifts = [instant(e["lift_at"]) for e in feed]
    assert lifts == sorted(lifts, reverse=True)
    item = next(e for e in feed if e["id"] == by_title["id"])
    assert item["frame_count"] == 1 and item["lift_display"] == coop_time(by_title["lift_at"])
    cover = priya.get(item["cover_url"])
    assert cover.status_code == 200 and Image.open(io.BytesIO(cover.content)).size == (GRID_PX, GRID_PX)


def test_story_viewer_sequence(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=3)
    with signed_in(browser, app_url, "priya") as page:
        page.get_by_role("searchbox", name="Search essays").fill(essay["title"])
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {essay['title']}", exact=True)
        shows(page, tile)
        tile.focus()
        page.keyboard.press("Enter")
        dialog = page.get_by_role("dialog", name=essay["title"], exact=True)
        shows(page, dialog)
        prev, nxt = dialog.get_by_role("button", name="Previous frame"), dialog.get_by_role("button", name="Next frame")
        total = len(essay["frames"])
        expect(dialog.get_by_text(frame_label(1, total))).to_be_visible()
        expect(prev).to_be_disabled()
        expect(nxt).to_be_focused()
        expect(dialog.get_by_role("group", name="Story progress")).to_be_visible()
        page.keyboard.press("ArrowRight")
        shows(page, dialog.get_by_text(frame_label(2, total)))
        nxt.click()
        shows(page, dialog.get_by_text(frame_label(3, total)))
        expect(nxt).to_be_disabled()
        page.keyboard.press("ArrowLeft")
        shows(page, dialog.get_by_text(frame_label(2, total)))
        prev.click()
        shows(page, dialog.get_by_text(frame_label(1, total)))
        width, height = DESKTOP
        page.mouse.click(width * 0.5, height * 0.45)
        shows(page, dialog.get_by_text(frame_label(2, total)))
        page.mouse.click(width * 0.12, height * 0.45)
        shows(page, dialog.get_by_text(frame_label(1, total)))
        page.go_back()
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        eventually(page, lambda: expect(tile).to_be_focused(timeout=POLL_MS))
    with signed_in(browser, app_url, "priya", size=PHONE) as page:
        cdp = enable_touch(page)
        dialog = open_story(page, app_url, essay)
        y = PHONE[1] * 0.3
        touch(cdp, "touchStart", (PHONE[0] * 0.8, y))
        for step in range(1, 6):
            touch(cdp, "touchMove", (PHONE[0] * (0.8 - 0.12 * step), y))
        touch(cdp, "touchEnd")
        shows(page, dialog.get_by_text(frame_label(2, len(essay["frames"]))))


def test_sheet_address_state(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=3)
    draft = create_essay(app_url, state="draft")
    with signed_in(browser, app_url, "priya") as page:
        page.goto(f"{app_url}/sheet")
        box = page.get_by_role("searchbox", name="Search essays")
        shows(page, box)
        before = page.evaluate("history.length")
        box.press_sequentially(essay["title"])
        eventually(page, lambda: assert_query(page, "q", essay["title"]))
        assert page.evaluate("history.length") == before
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {essay['title']}", exact=True)
        shows(page, tile)
        tile.click()
        dialog = page.get_by_role("dialog", name=essay["title"], exact=True)
        shows(page, dialog)
        assert query(page) == {"q": [essay["title"]], "essay": [essay["id"]], "frame": ["1"]}
        assert page.evaluate("history.length") == before + 1
        page.keyboard.press("ArrowRight")
        page.keyboard.press("ArrowRight")
        total = len(essay["frames"])
        eventually(page, lambda: expect(dialog.get_by_text(frame_label(3, total))).to_be_visible(timeout=POLL_MS))
        eventually(page, lambda: assert_query(page, "frame", "3"))
        assert page.evaluate("history.length") == before + 1
        page.reload()
        shows(page, dialog)
        expect(dialog.get_by_text(frame_label(3, total))).to_be_visible()
        expect(box).to_have_value(essay["title"])
        eventually(page, lambda: expect(dialog.get_by_role("button", name="Previous frame")).to_be_focused(timeout=POLL_MS))
        page.go_back()
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        page.go_forward()
        shows(page, dialog)
        expect(dialog.get_by_text(frame_label(3, total))).to_be_visible()
        for raw, fixed in [("99", "3"), ("abc", "1"), ("2.4", "2"), ("0", "1")]:
            page.goto(f"{app_url}/sheet?" + urlencode({"q": essay["title"], "essay": essay["id"], "frame": raw}))
            shows(page, dialog.get_by_text(frame_label(int(fixed), total)))
            eventually(page, lambda f=fixed: assert_query(page, "frame", f))
        page.goto(f"{app_url}/sheet?" + urlencode({"q": essay["title"], "essay": essay["id"], "frame": 2}))
        shows(page, dialog)
        length = page.evaluate("history.length")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        assert query(page) == {"q": [essay["title"]]} and page.evaluate("history.length") == length
        for missing in (UNKNOWN_ESSAY, draft["id"]):
            page.goto(f"{app_url}/sheet?" + urlencode({"essay": missing, "frame": 2}))
            reads(page, page.get_by_role("status", name="Sheet status"), "That essay isn't available.")
            expect(page.get_by_role("dialog")).to_have_count(0)
            assert "essay" not in query(page) and "frame" not in query(page)
        page.goto(f"{app_url}/sheet?" + urlencode({"q": "zz-nomatch-probe", "essay": essay["id"], "frame": 1}))
        shows(page, dialog)
        page.get_by_role("button", name="Close story").click()
        eventually(page, lambda: expect(box).to_be_focused(timeout=POLL_MS))


def test_shortlist_per_newsroom(app_url: str) -> None:
    essay = create_essay(app_url, frames=2)
    priya, dev, june, wes, carmen = (Api(app_url, w) for w in ("priya", "dev", "june", "wes", "carmen"))
    mesa_before = carmen.get("/api/shortlist").json()["count"]
    added = priya.post("/api/shortlist", {"frame_id": essay["frames"][1]["id"]})
    assert added.status_code == 201
    item = added.json()
    assert (item["essay_id"], item["frame_id"], item["position"], item["added_by"]) == (
        essay["id"], essay["frames"][1]["id"], 2, NAMES["priya"])
    same = dev.post("/api/shortlist", {"frame_id": essay["frames"][1]["id"]})
    assert same.status_code == 200 and same.json()["id"] == item["id"]
    for api in (dev, june):
        listing = api.get("/api/shortlist").json()
        assert item["id"] in [i["id"] for i in listing["items"]] and listing["count"] == len(listing["items"])
    mesa = wes.get("/api/shortlist").json()
    assert item["id"] not in [i["id"] for i in mesa["items"]] and carmen.get("/api/shortlist").json()["count"] == mesa_before
    assert wes.delete(f"/api/shortlist/{item['id']}").status_code == 404
    assert item["id"] in [i["id"] for i in dev.get("/api/shortlist").json()["items"]]
    rival = wes.post("/api/shortlist", {"frame_id": essay["frames"][1]["id"]})
    assert rival.status_code == 201 and rival.json()["id"] != item["id"]
    assert dev.delete(f"/api/shortlist/{item['id']}").status_code == 204
    assert item["id"] not in [i["id"] for i in priya.get("/api/shortlist").json()["items"]]
    assert rival.json()["id"] in [i["id"] for i in wes.get("/api/shortlist").json()["items"]]


def test_wf_feed_story_shortlist(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=3)
    with signed_in(browser, app_url, "priya") as page:
        page.get_by_role("searchbox", name="Search essays").fill(essay["title"])
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {essay['title']}", exact=True)
        shows(page, tile)
        tile.click()
        dialog = page.get_by_role("dialog", name=essay["title"], exact=True)
        shows(page, dialog)
        page.keyboard.press("ArrowRight")
        position = essay["frames"][1]["position"]
        add = dialog.get_by_role("button", name=f"Add frame {position} to shortlist")
        shows(page, add)
        add.click()
        reads(page, page.get_by_role("status", name="Shortlist status"), f"Frame {position} added to shortlist.")
        done = dialog.get_by_role("button", name="On shortlist")
        shows(page, done)
        expect(done).to_be_disabled()
        page.keyboard.press("Escape")
        go(page, "Shortlist")
        count = Api(app_url, "priya").get("/api/shortlist").json()["count"]
        shows(page, page.get_by_role("heading", name=f"Shortlist · {count} frames"))
        shows(page, page.get_by_role("list", name="Shortlist").get_by_role(
            "button", name=f"Remove frame {position} of {essay['title']} from shortlist", exact=True))
    items = Api(app_url, "dev").get("/api/shortlist").json()["items"]
    assert [(i["position"], i["added_by"]) for i in items if i["essay_id"] == essay["id"]] == [(2, NAMES["priya"])]


def test_wf_feed_story_remove(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=2)
    assert Api(app_url, "dev").post("/api/shortlist", {"frame_id": essay["frames"][0]["id"]}).status_code == 201
    with signed_in(browser, app_url, "priya") as page:
        go(page, "Shortlist")
        position = essay["frames"][0]["position"]
        button = page.get_by_role("button", name=f"Remove frame {position} of {essay['title']} from shortlist",
                                  exact=True)
        shows(page, button)
        button.click()
        reads(page, page.get_by_role("status", name="Shortlist status"), "Removed from shortlist.")
    assert essay["id"] not in [i["essay_id"] for i in Api(app_url, "dev").get("/api/shortlist").json()["items"]]


def test_window_length(app_url: str) -> None:
    sunday = fall_back_after(server_now(app_url) + timedelta(days=2))
    start = local(sunday - timedelta(days=1), 12, 0)
    clock_to(app_url, start)
    live = create_essay(app_url, exclusive_days=3, standard_days=5)
    later = create_essay(app_url, state="embargoed", lift=local(sunday + timedelta(days=2), 8, 0), exclusive_days=2)
    other = create_essay(app_url, standard_days=5)
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, live["id"]), priya_api)
    confirmed = instant(lic["confirmed_at"])
    assert lic["window_start"] == lic["confirmed_at"] and coop_day(confirmed) == coop_day(start)
    assert instant(lic["window_end"]) == local(sunday + timedelta(days=2))
    assert lic["window_end_display"] == coop_time(local(sunday + timedelta(days=2)))
    assert lic["window_end_display"].endswith("00:00 CST")
    wes_api = Api(app_url, "wes")
    embargo = granted(claim(wes_api, later["id"]), wes_api)
    assert instant(embargo["window_end"]) == local(sunday + timedelta(days=4))
    hollis_api = Api(app_url, "hollis")
    standard = granted(claim(hollis_api, other["id"], "standard"), hollis_api)
    assert instant(standard["window_end"]) == window_end(instant(standard["confirmed_at"]), other["lift_at"], 5)


def test_one_winner_per_window(app_url: str, mail: Any) -> None:
    essay = create_essay(app_url)
    people = ["priya", "priya", "dev", "wes", "hollis"]
    apis = [Api(app_url, p) for p in people]
    results = together([lambda a=a: claim(a, essay["id"]) for a in apis])
    winners = [i for i, r in enumerate(results) if r.status_code in STOOD]
    assert len(winners) == 1, [r.status_code for r in results]
    w = winners[0]
    lic = granted(results[w], apis[w])
    held_ends = {results[w].json().get("hold_until"), lic["window_end"]} - {None}
    for i, r in enumerate(results):
        if i == w:
            continue
        e = api_err(r, 409, "window_held")
        assert e["held_until"] in held_ends, (e, held_ends)
        expected = ("you" if people[i] == people[w] else
                    "your_newsroom" if NEWSROOM[people[i]] == NEWSROOM[people[w]] else "another_newsroom")
        assert e["held_by"] == expected
    room = NEWSROOM[people[w]]
    for slug, manager in MANAGER.items():
        assert len(licences_on(Api(app_url, manager), essay["id"])) == (1 if slug == room else 0)
    subject = f"Licence receipt: {essay['title']}"
    wait_mail(mail, subject, {people[w], MANAGER[room]})
    losers = {p for p in people if NEWSROOM[p] != room} | {MANAGER[NEWSROOM[p]] for p in people if NEWSROOM[p] != room}
    quiet(mail, subject, losers)
    assert len(to(inbox(mail, subject), people[w])) == 1


def test_claim_replay(app_url: str, mail: Any) -> None:
    essay, other = create_essay(app_url), create_essay(app_url)
    priya, dev = Api(app_url, "priya"), Api(app_url, "dev")
    key = idempotency_key()
    first = claim(priya, essay["id"], key=key)
    assert first.status_code in STOOD, first.text
    replays = together([lambda: claim(Api(app_url, "priya"), essay["id"], key=key) for _ in range(3)])
    for r in [claim(priya, essay["id"], key=key), *replays]:
        assert r.status_code == first.status_code and r.json() == first.json()
    api_err(claim(priya, essay["id"], "standard", key=key), 409, "idempotency_key_reused")
    api_err(claim(priya, other["id"], key=key), 409, "idempotency_key_reused")
    assert api_err(claim(dev, essay["id"], key=key), 409, "window_held")["held_by"] == "your_newsroom"
    api_err(claim(priya, essay["id"]), 409, "window_held")
    for bad in ["", "k" * (KEY_MAX + 1), "has space"]:
        field_err(priya.post(f"/api/essays/{other['id']}/licences", {"kind": "exclusive"},
                             headers={"Idempotency-Key": bad}), idempotency_key=KEY_MESSAGE)
    field_err(priya.post(f"/api/essays/{other['id']}/licences", {"kind": "exclusive"}), idempotency_key=KEY_MESSAGE)
    assert licences_on(priya, other["id"]) == [] and len(licences_on(priya, essay["id"])) == 1
    receipts = wait_mail(mail, f"Licence receipt: {essay['title']}", {"priya"})
    assert len(to(receipts, "priya")) == 1


def test_claim_resends_unanswered_key(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    keys: list[str | None] = []

    def route(r: Any) -> None:
        keys.append(r.request.headers.get("idempotency-key"))
        if len(keys) == 1:
            r.fetch()
            r.abort("failed")
        else:
            r.continue_()

    with signed_in(browser, app_url, "priya") as page:
        page.route("**/api/essays/*/licences", route)
        dialog = open_story(page, app_url, essay)
        button = dialog.get_by_role("button", name="Claim exclusive window")
        status = page.get_by_role("status", name="Claim status")
        press_hold(page, button, COMMIT_MS + SLACK_MS)
        reads(page, status, NO_ANSWER_CLAIM)
        press_hold(page, button, COMMIT_MS + SLACK_MS)
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)
        reads(page, status, f"EXCLUSIVE · yours until {coop_time(instant(lic[0]['window_end']))}")
    assert len(keys) == 2 and keys[0] and keys[0] == keys[1]
    assert len(licences_on(Api(app_url, "june"), essay["id"])) == 1


def test_claim_hold_pointer(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    tolerance = 100 * SLACK_MS / COMMIT_MS
    with signed_in(browser, app_url, "priya") as page:
        sent = licence_posts(page)
        dialog = open_story(page, app_url, essay)
        button = dialog.get_by_role("button", name="Claim exclusive window")
        bar = page.get_by_role("progressbar", name="Claim progress")
        x, y = center(button)
        page.mouse.move(x, y)
        page.mouse.down()
        advance(page, HALF_MS)
        assert abs(progress(bar) - 50) <= tolerance
        advance(page, HALF_MS / 3)
        at_release = progress(bar)
        assert abs(at_release - 100 * (HALF_MS * 4 / 3) / COMMIT_MS) <= tolerance
        page.mouse.up()
        advance(page, RETRACT_MS / 2)
        assert 0 < progress(bar) < at_release
        advance(page, EVERYDAY_MAX_MS)
        assert progress(bar) == 0 and sent == []
        page.mouse.down()
        advance(page, HALF_MS)
        page.mouse.move(x, y - DESKTOP[1] / 3)
        advance(page, COMMIT_MS)
        page.mouse.up()
        advance(page, EVERYDAY_MAX_MS)
        assert progress(bar) == 0 and sent == []
        page.mouse.move(x, y)
        page.mouse.down()
        advance(page, HALF_MS)
        page.keyboard.press("Escape")
        advance(page, COMMIT_MS)
        page.mouse.up()
        assert sent == [] and dialog.is_visible()
        with entered(held(page, "**/api/essays/*/licences")) as gate:
            page.mouse.move(x, y)
            page.mouse.down()
            advance(page, COMMIT_MS + SLACK_MS)
            page.mouse.up()
            eventually(page, lambda: expect(button).to_be_disabled(timeout=POLL_MS))
            reads(page, page.get_by_role("status", name="Claim status"), "Claiming…")
            gate.release()
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)[0]
        reads(page, page.get_by_role("status", name="Claim status"),
              f"EXCLUSIVE · yours until {coop_time(instant(lic['window_end']))}")
        eventually(page, lambda: expect(button).to_be_enabled(timeout=POLL_MS))
        assert len(sent) == 1
    assert len(licences_on(Api(app_url, "june"), essay["id"])) == 1


def test_claim_result_stamps(browser: Browser, app_url: str) -> None:
    essay, blocked = create_essay(app_url), create_essay(app_url)
    with signed_in(browser, app_url, "priya") as page:
        dialog = open_story(page, app_url, essay)
        press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)[0]
        end = coop_time(instant(lic["window_end"]))
        status = page.get_by_role("status", name="Claim status")
        reads(page, status, f"EXCLUSIVE · yours until {end}")
        page.reload()
        reads(page, status, f"EXCLUSIVE · yours until {end}")
        dialog.get_by_role("button", name="Buy standard licence").click()
        reads(page, page.get_by_role("status", name="Licence status"), "Your newsroom already licenses this essay.")
    for who, copy in [("dev", f"Held by your newsroom until {end}"), ("wes", f"Held by another newsroom until {end}")]:
        with signed_in(browser, app_url, who) as page:
            open_story(page, app_url, essay)
            reads(page, page.get_by_role("status", name="Claim status"), copy)
    hollis_api = Api(app_url, "hollis")
    std = granted(claim(hollis_api, blocked["id"], "standard"), hollis_api)
    with signed_in(browser, app_url, "wes") as page:
        dialog = open_story(page, app_url, blocked)
        press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        reads(page, page.get_by_role("status", name="Claim status"),
              f"Standard licences run until {coop_time(instant(std['window_end']))}; the exclusive opens then.")
    assert licences_on(Api(app_url, "carmen"), blocked["id"]) == []


def test_keyboard_and_reduced_motion_claim(browser: Browser, app_url: str) -> None:
    tolerance = 100 * SLACK_MS / COMMIT_MS
    for who, key in [("priya", "Space"), ("wes", "Enter")]:
        essay = create_essay(app_url)
        with signed_in(browser, app_url, who) as page:
            sent = licence_posts(page)
            dialog = open_story(page, app_url, essay)
            button = dialog.get_by_role("button", name="Claim exclusive window")
            bar = page.get_by_role("progressbar", name="Claim progress")
            button.focus()
            page.keyboard.down(key)
            advance(page, HALF_MS / 2)
            page.keyboard.up(key)
            advance(page, EVERYDAY_MAX_MS)
            assert sent == [] and progress(bar) == 0
            page.keyboard.down(key)
            advance(page, COMMIT_MS / 3)
            page.keyboard.down(key)
            advance(page, COMMIT_MS / 3)
            assert abs(progress(bar) - 100 * 2 / 3) <= tolerance
            page.keyboard.down(key)
            advance(page, COMMIT_MS / 3 + SLACK_MS)
            page.keyboard.up(key)
            lic = poll(lambda e=essay, w=who: licences_on(Api(app_url, w), e["id"]), bool, HTTP_SECONDS)[0]
            reads(page, page.get_by_role("status", name="Claim status"),
                  f"EXCLUSIVE · yours until {coop_time(instant(lic['window_end']))}")
            assert len(sent) == 1
    essay = create_essay(app_url)
    with signed_in(browser, app_url, "hollis", reduced_motion="reduce") as page:
        sent = licence_posts(page)
        dialog = open_story(page, app_url, essay)
        claim_button = dialog.get_by_role("button", name="Claim exclusive window")
        confirm, cancel = dialog.get_by_role("button", name="Confirm claim"), dialog.get_by_role("button", name="Cancel claim")
        claim_button.click()
        shows(page, confirm)
        expect(dialog.get_by_text("Step 2 of 2")).to_be_visible()
        expect(confirm).to_be_focused()
        cancel.click()
        eventually(page, lambda: expect(claim_button).to_be_focused(timeout=POLL_MS))
        page.keyboard.press("Space")
        shows(page, confirm)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(claim_button).to_be_focused(timeout=POLL_MS))
        assert sent == []
        page.keyboard.press("Enter")
        shows(page, confirm)
        confirm.click()
        lic = poll(lambda: licences_on(Api(app_url, "hollis"), essay["id"]), bool, HTTP_SECONDS)[0]
        reads(page, page.get_by_role("status", name="Claim status"),
              f"EXCLUSIVE · yours until {coop_time(instant(lic['window_end']))}")
        eventually(page, lambda: expect(claim_button).to_be_enabled(timeout=POLL_MS))
        assert len(sent) == 1


def test_touch_claim_hold(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    with signed_in(browser, app_url, "priya", size=PHONE) as page:
        cdp = enable_touch(page)
        sent = licence_posts(page)
        dialog = open_story(page, app_url, essay)
        button = dialog.get_by_role("button", name="Claim exclusive window")
        box = button.bounding_box()
        assert box and box["width"] >= TAP_PX and box["height"] >= TAP_PX
        x, y = center(button)
        before = page.evaluate("[window.scrollY, window.visualViewport ? window.visualViewport.scale : 1]")
        touch(cdp, "touchStart", (x, y))
        advance(page, HALF_MS)
        touch(cdp, "touchMove", (x + TOUCH_SLOP_PX + 1, y))
        advance(page, COMMIT_MS)
        touch(cdp, "touchEnd")
        touch(cdp, "touchStart", (x, y))
        advance(page, HALF_MS)
        touch(cdp, "touchStart", (x, y), (x, y - TAP_PX * 3))
        advance(page, COMMIT_MS)
        touch(cdp, "touchEnd")
        touch(cdp, "touchStart", (x, y))
        advance(page, HALF_MS)
        touch(cdp, "touchCancel")
        advance(page, COMMIT_MS)
        assert sent == []
        prevented = button.evaluate(
            "e => { const ev = new MouseEvent('contextmenu', {bubbles: true, cancelable: true});"
            " e.dispatchEvent(ev); return ev.defaultPrevented; }")
        assert prevented
        touch(cdp, "touchStart", (x, y))
        touch(cdp, "touchMove", (x + TOUCH_SLOP_PX / 2, y))
        advance(page, COMMIT_MS + SLACK_MS)
        touch(cdp, "touchEnd")
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)[0]
        reads(page, page.get_by_role("status", name="Claim status"),
              f"EXCLUSIVE · yours until {coop_time(instant(lic['window_end']))}")
        assert len(sent) == 1
        assert page.evaluate("[window.scrollY, window.visualViewport ? window.visualViewport.scale : 1]") == before
        assert page.evaluate("window.getSelection().toString()") == ""


def test_wf_exclusive_claim_rival(browser: Browser, app_url: str, killbill: Any) -> None:
    essay = create_essay(app_url)
    with signed_in(browser, app_url, "priya") as page:
        dialog = open_story(page, app_url, essay)
        press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)[0]
        end = coop_time(instant(lic["window_end"]))
        reads(page, page.get_by_role("status", name="Claim status"), f"EXCLUSIVE · yours until {end}")
    with signed_in(browser, app_url, "wes") as page:
        open_story(page, app_url, essay)
        reads(page, page.get_by_role("status", name="Claim status"), f"Held by another newsroom until {end}")
    assert lic["state"] == "active" and lic["kind"] == "exclusive" and lic["newsroom"]["slug"] == "harbor-light"
    account = killbill.account_by_key("newsroom-harbor-light")
    assert account and account["name"] == "Harbor Light Herald" and account["currency"] == "USD"
    assert licences_on(Api(app_url, "carmen"), essay["id"]) == []


def test_wf_exclusive_claim_colleague(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    wes_api = Api(app_url, "wes")
    lic = granted(claim(wes_api, essay["id"]), wes_api)
    with signed_in(browser, app_url, "dev") as page:
        dialog = open_story(page, app_url, essay)
        press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        reads(page, page.get_by_role("status", name="Claim status"),
              f"Held by another newsroom until {coop_time(instant(lic['window_end']))}")
    assert licences_on(Api(app_url, "june"), essay["id"]) == []


def test_activation_all_or_nothing(app_url: str, s3: Any, mail: Any, killbill: Any) -> None:
    for who, kind in [("priya", "exclusive"), ("hollis", "standard")]:
        essay = create_essay(app_url, frames=2)
        who_api = Api(app_url, who)
        lic = granted(claim(who_api, essay["id"], kind), who_api)
        record = json.loads(s3.get(f"grants/{lic['id']}.json"))
        assert record["licence_id"] == lic["id"] and record["essay_id"] == essay["id"]
        assert sorted(record["frame_ids"]) == sorted(f["id"] for f in essay["frames"])
        assert NEWSROOM[who] in json.dumps(record["newsroom"])
        assert instant(record["window_end"]) == instant(lic["window_end"])
        assert lic["receipt_state"] in ("queued", "sent")
        receipts = wait_mail(mail, f"Licence receipt: {essay['title']}", {who, MANAGER[NEWSROOM[who]]})
        assert len(to(receipts, who)) == 1 and len(to(receipts, MANAGER[NEWSROOM[who]])) == 1
        account = killbill.account_by_key(f"newsroom-{NEWSROOM[who]}")
        assert account and account["currency"] == "USD" and account["name"] == NEWSROOMS[NEWSROOM[who]][0]


def fresh_month(base: str) -> tuple[int, int]:
    now = server_now(base).astimezone(COOP)
    return next_month(now.year, now.month)


def test_pending_hold_deadline(app_url: str, s3: Any, mail: Any) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    for _ in range(ATTEMPTS):
        y, m = fresh_month(app_url)
        _, end = month_bounds(y, m)
        clock_to(app_url, end - timedelta(hours=1))
        essay = create_essay(app_url)
        clock_to(app_url, end - timedelta(minutes=10))
        priya_down, wes_down = Api(down, "priya"), Api(down, "wes")
        started = monotonic()
        r = claim(priya_down, essay["id"])
        answered = monotonic() - started
        rival = claim(wes_down, essay["id"])
        clock_to(app_url, end + timedelta(minutes=1))
        statement = Api(down, "bram").post("/api/royalty-statements", {"month": f"{y:04d}-{m:02d}"})
        if r.status_code != 202 or statement.status_code != 409 or answered >= PENDING_SECONDS:
            continue
        lic = r.json()
        assert lic["state"] == "pending_invoice" and lic["invoice_state"] == "pending" and lic["receipt_state"] is None
        confirmed = instant(lic["confirmed_at"])
        assert instant(lic["hold_until"]) == min(confirmed + timedelta(minutes=HOLD_MINUTES), instant(lic["window_end"]))
        assert instant(lic["hold_until"]) == confirmed + timedelta(minutes=HOLD_MINUTES)
        assert lic["hold_until_display"] == coop_time(instant(lic["hold_until"]))
        e = api_err(rival, 409, "window_held")
        assert e["held_by"] == "another_newsroom" and e["held_until"] == lic["hold_until"]
        api_err(statement, 409, "invoices_pending")
        break
    else:
        pytest.fail("every attempt charged the pending licence before its hold could be read")
    for _ in range(ATTEMPTS):
        y, m = fresh_month(app_url)
        _, end = month_bounds(y, m)
        clock_to(app_url, end - timedelta(hours=1))
        essay = create_essay(app_url, exclusive_days=1)
        clock_to(app_url, end - timedelta(minutes=5))
        r = claim(Api(down, "priya"), essay["id"])
        clock_to(app_url, end)
        if r.status_code != 202:
            continue
        lic = r.json()
        priya_main = Api(app_url, "priya")
        after = poll(lambda: priya_main.get(f"/api/licences/{lic['id']}"),
                     lambda resp: resp.status_code == 404, SETTLE_SECONDS)
        if after.status_code != 404:
            continue
        assert instant(lic["window_end"]) == end and instant(lic["hold_until"]) == end
        assert lic["hold_until_display"] == coop_time(end)
        api_err(after, 404, "not_found")
        assert lic["id"] not in [x["id"] for x in Api(app_url, "june").get("/api/licences").json()["licences"]]
        wes_main = Api(app_url, "wes")
        window = poll(lambda: wes_main.get(f"/api/essays/{essay['id']}").json()["window"],
                      lambda w: w["state"] == "open", SETTLE_SECONDS)
        assert window["state"] == "open" and window["held_by"] is None, window
        granted(claim(wes_main, essay["id"]), wes_main)
        run = Api(app_url, "bram").post("/api/royalty-statements", {"month": f"{y:04d}-{m:02d}"})
        assert run.status_code == 201 and lic["id"] not in [line["licence_id"] for line in run.json()["lines"]]
        assert grant_record(s3, lic["id"]) is None
        subject = f"Licence receipt: {essay['title']}"
        wait_mail(mail, subject, {"wes", "carmen"})
        assert not to(inbox(mail, subject), "priya") and not to(inbox(mail, subject), "june")
        return
    pytest.fail("every attempt activated before the clock reached the hold deadline")


def test_recovery_without_restart(app_url: str, s3: Any, mail: Any) -> None:
    down, mail_down = outage("APP_KILLBILL_DOWN_URL"), outage("APP_MAILPIT_DOWN_URL")
    for base in (down, mail_down):
        assert httpx.get(f"{base}/api/health", timeout=HTTP_SECONDS).json() == {"status": "ok"}
    essay = create_essay(app_url)
    r = claim(Api(down, "hollis"), essay["id"], "standard")
    assert r.status_code in (202, 201) and r.json()["state"] in ("pending_invoice", "active")
    lic_id = r.json()["id"]
    hollis = Api(app_url, "hollis")
    lic = poll(lambda: hollis.get(f"/api/licences/{lic_id}").json(), lambda b: b["state"] == "active", RECOVERY_SECONDS)
    assert lic["state"] == "active" and lic["invoice_state"] == "raised"
    assert f"grants/{lic_id}.json" in s3.keys("grants/")
    receipts = wait_mail(mail, f"Licence receipt: {essay['title']}", {"hollis", "margot"})
    assert len(to(receipts, "hollis")) == 1 and len(to(receipts, "margot")) == 1


def test_starts_with_providers_down(tmp_path: Path) -> None:
    deployed = Path(getattr(kit, "DEPLOYED_APP"))
    serve = json.loads((deployed / "run.json").read_text())["serve"]
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    unreachable = "http://127.0.0.1:9"
    env = {**os.environ, "APP_PUBLIC_PORT": str(port), "APP_CLOCK_CONTROL": "on",
           "DATABASE_URL": "postgres://saltprint:unreachable@127.0.0.1:9/saltprint",
           "S3_ENDPOINT": unreachable, "KILLBILL_URL": unreachable, "SMTP_HOST": "127.0.0.1", "SMTP_PORT": "9"}
    for key, value in {"S3_REGION": "us-east-1", "S3_BUCKET": "saltprint", "S3_FORCE_PATH_STYLE": "true",
                       "S3_ACCESS_KEY_ID": "probe", "S3_SECRET_ACCESS_KEY": "probe", "KILLBILL_USERNAME": "probe",
                       "KILLBILL_PASSWORD": "probe", "KILLBILL_API_KEY": "probe", "KILLBILL_API_SECRET": "probe",
                       "MAIL_FROM": "Saltprint Desk <desk@saltprint.example>"}.items():
        env.setdefault(key, value)
    log = tmp_path / "copy.log"
    with log.open("wb") as out:
        proc = subprocess.Popen(serve, shell=True, cwd=deployed, env=env, stdout=out, stderr=subprocess.STDOUT,
                                start_new_session=True)
        try:
            base = f"http://127.0.0.1:{port}"

            def health() -> int:
                assert proc.poll() is None, log.read_text()[-4000:]
                try:
                    return httpx.get(f"{base}/api/health", timeout=HTTP_SECONDS).status_code
                except httpx.HTTPError:
                    return 0

            assert poll(health, lambda s: s == 200, BOOT_SECONDS) == 200, log.read_text()[-4000:]
            assert httpx.get(f"{base}/api/health", timeout=HTTP_SECONDS).json() == {"status": "ok"}
            r = httpx.post(f"{base}/api/session", json={"email": PEOPLE["priya"], "password": PASSWORD},
                           timeout=HTTP_SECONDS)
            api_err(r, 503, "database_unavailable")
        finally:
            os.killpg(proc.pid, signal.SIGTERM)
            proc.wait(timeout=HTTP_SECONDS)


def test_wf_claim_outage_pending_then_active(browser: Browser, app_url: str, s3: Any) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    essay = create_essay(app_url)
    with signed_in(browser, down, "priya") as page:
        dialog = open_story(page, down, essay)
        with page.expect_response(lambda r: "/licences" in r.url and r.request.method == "POST") as answer:
            press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        body = answer.value.json()
        assert answer.value.status == 202 and body["state"] == "pending_invoice"
        pending_copy = (f"PENDING INVOICE · window held for your newsroom until "
                        f"{coop_time(instant(body['hold_until']))}. "
                        "Billing is unreachable; the invoice is raised automatically when it returns.")
        active_copy = f"EXCLUSIVE · yours until {coop_time(instant(body['window_end']))}"
        reads(page, page.get_by_role("status", name="Claim status"),
              re.compile(f"^({re.escape(pending_copy)}|{re.escape(active_copy)})$"))
        page.keyboard.press("Escape")
        go(page, "Licences")
        row = page.get_by_role("table", name="Licences").get_by_role("row").filter(has_text=essay["title"])
        eventually(page, lambda: expect(row).to_contain_text("Active", timeout=POLL_MS), RECOVERY_SECONDS)
        expect(row).to_contain_text("Raised")
    lic = Api(app_url, "priya").get(f"/api/licences/{body['id']}").json()
    assert lic["state"] == "active" and f"grants/{lic['id']}.json" in s3.keys("grants/")


def test_wf_claim_outage_standard_pending(browser: Browser, app_url: str) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    essay = create_essay(app_url)
    with signed_in(browser, down, "hollis") as page:
        dialog = open_story(page, down, essay)
        with page.expect_response(lambda r: "/licences" in r.url and r.request.method == "POST") as answer:
            dialog.get_by_role("button", name="Buy standard licence").click()
        body = answer.value.json()
        assert answer.value.status == 202 and body["state"] == "pending_invoice"
        assert body["hold_until"] and body["invoice_state"] == "pending" and body["receipt_state"] is None
        pending_copy = (f"PENDING INVOICE · licence held until {coop_time(instant(body['hold_until']))}. "
                        "Billing is unreachable; the invoice is raised automatically when it returns.")
        active_copy = f"STANDARD · licensed until {coop_time(instant(body['window_end']))}"
        reads(page, page.get_by_role("status", name="Licence status"),
              re.compile(f"^({re.escape(pending_copy)}|{re.escape(active_copy)})$"))
    lic = poll(lambda: Api(app_url, "hollis").get(f"/api/licences/{body['id']}").json(),
               lambda b: b["state"] == "active", RECOVERY_SECONDS)
    assert lic["state"] == "active"


def test_standard_licence_rules(app_url: str) -> None:
    essay, held_essay = create_essay(app_url), create_essay(app_url)
    priya, dev, wes, hollis = (Api(app_url, w) for w in ("priya", "dev", "wes", "hollis"))
    first = granted(claim(wes, essay["id"], "standard"), wes)
    second = granted(claim(hollis, essay["id"], "standard"), hollis)
    assert first["kind"] == second["kind"] == "standard" and first["amount_minor"] == ST_PRICE
    e = api_err(claim(priya, essay["id"]), 409, "standard_licences_active")
    latest = max(instant(first["window_end"]), instant(second["window_end"]))
    assert instant(e["blocked_until"]) == latest
    window = priya.get(f"/api/essays/{essay['id']}").json()["window"]
    assert window["state"] == "open" and instant(window["standard_running_until"]) == latest
    api_err(claim(wes, essay["id"], "standard"), 409, "already_licensed")
    solo = create_essay(app_url)
    granted(claim(wes, solo["id"], "standard"), wes)
    api_err(claim(wes, solo["id"]), 409, "already_licensed")
    excl = granted(claim(priya, held_essay["id"]), priya)
    assert excl["amount_minor"] == EX_PRICE
    e = api_err(claim(wes, held_essay["id"], "standard"), 409, "exclusive_held")
    assert e["held_by"] == "another_newsroom" and e["held_until"] == excl["window_end"]
    api_err(claim(dev, held_essay["id"], "standard"), 409, "already_licensed")
    assert licences_on(Api(app_url, "carmen"), held_essay["id"]) == []
    draft = create_essay(app_url, state="draft")
    api_err(claim(priya, draft["id"], "standard"), 404, "not_found")
    field_err(claim(priya, essay["id"], "lifetime"), kind=KIND_MESSAGE)


def test_one_live_licence_under_races(app_url: str) -> None:
    essay = create_essay(app_url)
    racers = [Api(app_url, "priya"), Api(app_url, "priya"), Api(app_url, "dev")]
    results = together([lambda a=a: claim(a, essay["id"], "standard") for a in racers])
    assert len([r for r in results if r.status_code in STOOD]) == 1, [r.status_code for r in results]
    for r in results:
        if r.status_code not in STOOD:
            api_err(r, 409, "already_licensed")
    assert len(licences_on(Api(app_url, "june"), essay["id"])) == 1
    for _ in range(3):
        fresh = create_essay(app_url)
        std, excl = together([lambda f=fresh: claim(Api(app_url, "wes"), f["id"], "standard"),
                              lambda f=fresh: claim(Api(app_url, "priya"), f["id"])])
        codes = [std.status_code, excl.status_code]
        assert len([c for c in codes if c in STOOD]) == 1, codes
        if std.status_code in STOOD:
            api_err(excl, 409, "standard_licences_active")
        else:
            api_err(std, 409, "exclusive_held")
        standing = licences_on(Api(app_url, "carmen"), fresh["id"]) + licences_on(Api(app_url, "june"), fresh["id"])
        assert len(standing) == 1


def test_wf_standard_licence_buy_download(browser: Browser, app_url: str, s3: Any, mail: Any) -> None:
    essay = create_essay(app_url, frames=2)
    with signed_in(browser, app_url, "hollis") as page:
        sent = licence_posts(page)
        dialog = open_story(page, app_url, essay)
        dialog.get_by_role("button", name="Buy standard licence").dblclick()
        lic = poll(lambda: licences_on(Api(app_url, "hollis"), essay["id"]), bool, HTTP_SECONDS)[0]
        reads(page, page.get_by_role("status", name="Licence status"),
              f"STANDARD · licensed until {coop_time(instant(lic['window_end']))}")
        assert len(sent) == 1
        page.keyboard.press("Escape")
        go(page, "Licences")
        opener = page.get_by_role("button", name=f"Download originals for {essay['title']}", exact=True)
        shows(page, opener)
        opener.click()
        originals = page.get_by_role("dialog", name=f"Originals: {essay['title']}", exact=True)
        shows(page, originals)
        first_frame = essay["frames"][0]
        with page.expect_download() as download:
            originals.get_by_role("button", name=f"Download frame {first_frame['position']}").click()
        assert download.value.suggested_filename == f"{essay['id']}-frame-{first_frame['position']}.jpg"
        first = first_frame["id"]
        assert Path(download.value.path()).read_bytes() == essay["originals"][first] == s3.get(
            f"originals/{essay['id']}/{first}")
        reads(page, page.get_by_role("status", name="Download status"), "Download ready.")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS))
    assert lic["kind"] == "standard" and lic["state"] == "active" and lic["invoice_state"] == "raised"
    record = json.loads(s3.get(f"grants/{lic['id']}.json"))
    assert record["licence_id"] == lic["id"] and record["essay_id"] == essay["id"]
    assert sorted(record["frame_ids"]) == sorted(f["id"] for f in essay["frames"])
    receipts = wait_mail(mail, f"Licence receipt: {essay['title']}", {"hollis", "margot"})
    assert len(to(receipts, "hollis")) == 1 and len(to(receipts, "margot")) == 1


def test_wf_standard_licence_exclusive_held(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    priya_api = Api(app_url, "priya")
    excl = granted(claim(priya_api, essay["id"]), priya_api)
    with signed_in(browser, app_url, "wes") as page:
        dialog = open_story(page, app_url, essay)
        buy = dialog.get_by_role("button", name="Buy standard licence")
        buy.click()
        reads(page, page.get_by_role("status", name="Licence status"),
              f"Exclusive held by another newsroom until {coop_time(instant(excl['window_end']))}")
        eventually(page, lambda: expect(buy).to_be_enabled(timeout=POLL_MS))
    assert licences_on(Api(app_url, "carmen"), essay["id"]) == []


def test_receipt_contents(app_url: str, mail: Any) -> None:
    note = f"Private desk note {unique('n')[0]}"
    essay = create_essay(app_url, note=note, credits=[credit("ada-reyes", 6000), credit("noor-haddad", 4000)])
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, essay["id"]), priya_api)
    subject = f"Licence receipt: {essay['title']}"
    msgs = wait_mail(mail, subject, {"priya", "june"})
    quiet(mail, subject, {"dev", "wes", "carmen"}, seconds=1)
    assert len(to(msgs, "priya")) == 1 and len(to(msgs, "june")) == 1
    for m in msgs:
        assert len(recipients(m)) == 1 and not m.get("Cc") and not m.get("Bcc")
        assert [a.lower() for a in addresses(m["From"])] == [mail_from_address().lower()]
        body = text(m)
        for part in [essay["title"], essay["credit_line"], "exclusive", coop_time(instant(lic["window_start"])),
                     coop_time(instant(lic["window_end"])), f"{dollars(EX_PRICE)} USD", lic["id"]]:
            assert part in body, part
        assert not any(s in body for s in [note, *PAYOUT_ACCOUNTS, "6000", "4000"])


def test_expiry_warning(app_url: str, mail: Any) -> None:
    sunday = fall_back_after(server_now(app_url) + timedelta(days=3))
    clock_to(app_url, local(sunday - timedelta(days=1), 12, 0))
    essay = create_essay(app_url, exclusive_days=2)
    late = create_essay(app_url, standard_days=1)
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, essay["id"]), priya_api)
    end = instant(lic["window_end"])
    assert end == local(sunday + timedelta(days=1))
    warn_at = end - timedelta(hours=WARNING_HOURS)
    wall_at = local(sunday)
    assert wall_at < warn_at
    subject = f"Licence ending in 24 hours: {essay['title']}"
    clock_to(app_url, wall_at + (warn_at - wall_at) / 2)
    quiet(mail, subject, {"priya", "june"})
    clock_to(app_url, warn_at)
    msgs = wait_mail(mail, subject, {"priya", "june"})
    body = text(to(msgs, "priya")[0])
    assert essay["title"] in body and "exclusive" in body and coop_time(end) in body and lic["id"] in body
    wes_api = Api(app_url, "wes")
    after = granted(claim(wes_api, late["id"], "standard"), wes_api)
    assert instant(after["window_end"]) == end
    clock_to(app_url, end - timedelta(minutes=30))
    quiet(mail, f"Licence ending in 24 hours: {late['title']}", {"wes", "carmen"})
    msgs = inbox(mail, subject)
    assert len(to(msgs, "priya")) == 1 and len(to(msgs, "june")) == 1


def test_mail_waits_out_outage(app_url: str, mail: Any) -> None:
    mail_down = outage("APP_MAILPIT_DOWN_URL")
    essay = create_essay(app_url)
    priya_down = Api(mail_down, "priya")
    r = claim(priya_down, essay["id"])
    lic = granted(r, priya_down)
    assert lic["receipt_state"] in ("queued", "sent"), lic
    subject = f"Licence receipt: {essay['title']}"
    wait_mail(mail, subject, {"priya", "june"})
    sent = poll(lambda: Api(app_url, "priya").get(f"/api/licences/{lic['id']}").json()["receipt_state"],
                lambda s: s == "sent", RECOVERY_SECONDS)
    assert sent == "sent"
    quiet(mail, subject, set(), seconds=QUIET_SECONDS)
    msgs = inbox(mail, subject)
    assert len(to(msgs, "priya")) == 1 and len(to(msgs, "june")) == 1


def test_exact_mail_subjects(app_url: str, mail: Any) -> None:
    token = unique("t")[0]
    titles = [f"Quotes \"and\" 'marks', commas: colons {token}", f"Looks =?utf-8?q?encoded?= {token}",
              f"Сольпринт 塩の記録 · café {token}", (f"{token} " + "é" * TITLE_MAX)[:TITLE_MAX]]
    ada = Api(app_url, "ada")
    for bad in ["a\nb", "a\rb", "a\tb", "a\x00b", "a\x7fb", "a\x85b", "a\u2028b", "a\u2029b",
                f"x {token}\r\nBcc: someone@elsewhere.invalid"]:
        field_err(ada.post("/api/essays", essay_fields(bad, "2026-11-20T08:00", [credit("ada-reyes", FULL_BP)])),
                  title=TITLE_CONTROL)
    for title in titles:
        essay = create_essay(app_url, title=f"  {title}  ")
        assert essay["title"] == title
        priya_api = Api(app_url, "priya")
        granted(claim(priya_api, essay["id"]), priya_api)
        msgs = wait_mail(mail, f"Licence receipt: {title}", {"priya", "june"})
        assert len(to(msgs, "priya")) == 1 and len(to(msgs, "june")) == 1
        assert all(len(recipients(m)) == 1 and not m.get("Bcc") for m in msgs)


def test_wf_licence_mail_receipt(browser: Browser, app_url: str, mail: Any) -> None:
    essay = create_essay(app_url)
    with signed_in(browser, app_url, "priya") as page:
        dialog = open_story(page, app_url, essay)
        press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)[0]
        reads(page, page.get_by_role("status", name="Claim status"),
              f"EXCLUSIVE · yours until {coop_time(instant(lic['window_end']))}")
    msgs = wait_mail(mail, f"Licence receipt: {essay['title']}", {"priya", "june"})
    assert len(to(msgs, "priya")) == 1 and len(to(msgs, "june")) == 1 and lic["id"] in text(msgs[0])


def test_wf_licence_mail_queued(browser: Browser, app_url: str, mail: Any) -> None:
    mail_down = outage("APP_MAILPIT_DOWN_URL")
    essay = create_essay(app_url)
    with signed_in(browser, mail_down, "priya") as page:
        dialog = open_story(page, mail_down, essay)
        press_hold(page, dialog.get_by_role("button", name="Claim exclusive window"), COMMIT_MS + SLACK_MS)
        lic = poll(lambda: licences_on(Api(app_url, "priya"), essay["id"]), bool, HTTP_SECONDS)[0]
        reads(page, page.get_by_role("status", name="Claim status"),
              f"EXCLUSIVE · yours until {coop_time(instant(lic['window_end']))}")
        page.keyboard.press("Escape")
        go(page, "Licences")
        row = page.get_by_role("table", name="Licences").get_by_role("row").filter(has_text=essay["title"])
        eventually(page, lambda: expect(row).to_contain_text("Sent", timeout=POLL_MS), RECOVERY_SECONDS)
    msgs = wait_mail(mail, f"Licence receipt: {essay['title']}", {"priya", "june"})
    assert len(to(msgs, "priya")) == 1 and len(to(msgs, "june")) == 1


def test_original_grants(app_url: str, s3: Any) -> None:
    essay = create_essay(app_url, frames=3, formats=["jpeg", "jpeg", "png"])
    other = create_essay(app_url)
    priya = Api(app_url, "priya")
    lic = granted(claim(priya, essay["id"], "standard"), priya)
    assert sorted(f["position"] for f in lic["frames"]) == [1, 2, 3]
    path = f"/api/licences/{lic['id']}/grants"
    for frame in essay["frames"][1:]:
        r = priya.post(path, {"frame_id": frame["id"]})
        assert r.status_code == 201, r.text
        grant = r.json()
        remaining = instant(grant["expires_at"]) - server_now(app_url)
        assert timedelta(0) < remaining <= timedelta(seconds=GRANT_MAX_SECONDS)
        got = httpx.get(grant["url"], timeout=HTTP_SECONDS)
        ext, ctype = ("png", "image/png") if frame["position"] == 3 else ("jpg", "image/jpeg")
        assert got.status_code == 200 and got.headers["content-type"] == ctype
        assert f'filename="{essay["id"]}-frame-{frame["position"]}.{ext}"' in got.headers["content-disposition"]
        assert got.headers["content-disposition"].startswith("attachment")
        assert got.content == essay["originals"][frame["id"]] == s3.get(f"originals/{essay['id']}/{frame['id']}")
    url = priya.post(path, {"frame_id": essay["frames"][1]["id"]}).json()["url"]
    tampered = [url.replace(essay["frames"][1]["id"], essay["frames"][0]["id"]), url.replace("frame-2", "frame-1")]
    for bad in tampered:
        assert bad != url and httpx.get(bad, timeout=HTTP_SECONDS).status_code != 200
    assert Api(app_url, "dev").post(path, {"frame_id": essay["frames"][0]["id"]}).status_code == 201
    api_err(Api(app_url, "june").post(path, {"frame_id": essay["frames"][0]["id"]}), 403, "forbidden")
    api_err(Api(app_url, "wes").post(path, {"frame_id": essay["frames"][0]["id"]}), 404, "not_found")
    api_err(priya.post(path, {"frame_id": other["frames"][0]["id"]}), 404, "not_found")
    end = instant(lic["window_end"])
    clock_to(app_url, end - timedelta(seconds=120))
    near = priya.post(path, {"frame_id": essay["frames"][0]["id"]}).json()
    assert instant(near["expires_at"]) <= end


def test_server_judged_end(app_url: str) -> None:
    essay = create_essay(app_url, exclusive_days=1)
    priya, wes = Api(app_url, "priya"), Api(app_url, "wes")
    lic = granted(claim(priya, essay["id"]), priya)
    end = instant(lic["window_end"])
    path = f"/api/licences/{lic['id']}/grants"
    clock_to(app_url, end - timedelta(seconds=30))
    assert priya.get(f"/api/licences/{lic['id']}").json()["state"] == "active"
    assert priya.post(path, {"frame_id": essay["frames"][0]["id"]}).status_code == 201
    api_err(claim(wes, essay["id"]), 409, "window_held")
    clock_to(app_url, end)
    assert priya.get(f"/api/licences/{lic['id']}").json()["state"] == "expired"
    assert [x["state"] for x in licences_on(Api(app_url, "june"), essay["id"])] == ["expired"]
    api_err(priya.post(path, {"frame_id": essay["frames"][0]["id"]}), 410, "licence_ended")
    assert wes.get(f"/api/essays/{essay['id']}").json()["window"]["state"] == "open"
    again = granted(claim(priya, essay["id"]), priya)
    assert again["id"] != lic["id"]


def test_wf_window_expiry_download(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=2)
    priya_api = Api(app_url, "priya")
    granted(claim(priya_api, essay["id"]), priya_api)
    with signed_in(browser, app_url, "priya") as page:
        go(page, "Licences")
        page.get_by_role("button", name=f"Download originals for {essay['title']}", exact=True).click()
        dialog = page.get_by_role("dialog", name=f"Originals: {essay['title']}", exact=True)
        shows(page, dialog)
        second = essay["frames"][1]
        with page.expect_download() as download:
            dialog.get_by_role("button", name=f"Download frame {second['position']}").click()
        assert download.value.suggested_filename == f"{essay['id']}-frame-{second['position']}.jpg"
        assert Path(download.value.path()).read_bytes() == essay["originals"][essay["frames"][1]["id"]]


def test_wf_window_expiry_ended(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, exclusive_days=1)
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, essay["id"]), priya_api)
    end = instant(lic["window_end"])
    with signed_in(browser, app_url, "priya") as page:
        page.clock.set_system_time(end - timedelta(days=1))
        go(page, "Licences")
        page.get_by_role("button", name=f"Download originals for {essay['title']}", exact=True).click()
        dialog = page.get_by_role("dialog", name=f"Originals: {essay['title']}", exact=True)
        shows(page, dialog)
        clock_to(app_url, end)
        dialog.get_by_role("button", name=f"Download frame {essay['frames'][0]['position']}").click()
        reads(page, page.get_by_role("status", name="Download status"),
              f"This licence ended at {coop_time(end)}. Originals are no longer available.")
        page.reload()
        page.clock.set_system_time(end - timedelta(days=1))
        row = page.get_by_role("table", name="Licences").get_by_role("row").filter(has_text=essay["title"])
        eventually(page, lambda: expect(row).to_contain_text("Expired", timeout=POLL_MS))
        expect(page.get_by_role("button", name=f"Download originals for {essay['title']}", exact=True)).to_have_count(0)


def test_usage_scoped(app_url: str) -> None:
    june, carmen = Api(app_url, "june"), Api(app_url, "carmen")
    essay = create_essay(app_url)
    j0, c0 = june.get("/api/usage").json(), carmen.get("/api/usage").json()
    assert j0["newsroom"] == {"slug": "harbor-light", "name": "Harbor Light Herald"}
    wes_api = Api(app_url, "wes")
    wes_lic = granted(claim(wes_api, essay["id"], "standard"), wes_api)
    Api(app_url, "wes").post("/api/shortlist", {"frame_id": essay["frames"][0]["id"]})
    j1, c1 = june.get("/api/usage").json(), carmen.get("/api/usage").json()
    assert c1["active"] == c0["active"] + 1 and c1["standard"] == c0["standard"] + 1
    assert c1["invoiced_minor"] == c0["invoiced_minor"] + ST_PRICE and c1["shortlist_count"] == c0["shortlist_count"] + 1
    for key in ("active", "standard", "invoiced_minor", "shortlist_count"):
        assert j1[key] == j0[key]
    assert wes_lic["id"] not in [x["id"] for x in june.get("/api/licences").json()["licences"]]
    assert wes_lic["id"] not in usage_csv(june)[1]
    api_err(june.get(f"/api/licences/{wes_lic['id']}"), 404, "not_found")
    assert carmen.get(f"/api/licences/{wes_lic['id']}").status_code == 200


def test_usage_csv_export(app_url: str) -> None:
    first = create_essay(app_url, caption='Levee, "north" bank')
    second = create_essay(app_url)
    rival = create_essay(app_url)
    priya_api = Api(app_url, "priya")
    a = granted(claim(priya_api, first["id"]), priya_api)
    clock_to(app_url, server_now(app_url) + timedelta(seconds=2))
    dev_api = Api(app_url, "dev")
    b = granted(claim(dev_api, second["id"], "standard"), dev_api)
    assert instant(b["confirmed_at"]) > instant(a["confirmed_at"])
    wes_api = Api(app_url, "wes")
    c = granted(claim(wes_api, rival["id"], "standard"), wes_api)
    day_before = coop_day(server_now(app_url))
    r, raw, rows = usage_csv(Api(app_url, "june"))
    names = {f'saltprint-usage-harbor-light-{d:%Y-%m-%d}.csv' for d in (day_before, coop_day(server_now(app_url)))}
    assert r.headers["content-type"].lower().replace(" ", "") == "text/csv; charset=utf-8".replace(" ", "")
    assert any(f'attachment; filename="{n}"' in r.headers["content-disposition"] for n in names)
    assert raw.split("\r\n")[0].split(",") == CSV_COLUMNS and raw.endswith("\r\n")
    assert "\n" not in raw.replace("\r\n", "") and list(rows[0]) == CSV_COLUMNS
    ids = [row["licence_id"] for row in rows]
    assert c["id"] not in ids and ids.index(b["id"]) < ids.index(a["id"])
    for lic, essay, kind, price in [(a, first, "exclusive", EX_PRICE), (b, second, "standard", ST_PRICE)]:
        row = rows[ids.index(lic["id"])]
        assert row == {"licence_id": lic["id"], "essay_title": essay["title"], "caption": essay["caption"],
                       "credit_line": essay["credit_line"], "kind": kind, "state": "active",
                       "confirmed_at": csv_time(instant(lic["confirmed_at"])),
                       "window_start": csv_time(instant(lic["window_start"])),
                       "window_end": csv_time(instant(lic["window_end"])), "amount": plain_dollars(price),
                       "currency": "USD"}


CSV_PREFIXES = {"equals": "=", "plus": "+", "minus": "-", "at": "@", "tab": "\t", "carriage-return": "\r"}


@pytest.mark.parametrize("prefix", list(CSV_PREFIXES), ids=list(CSV_PREFIXES))
def test_csv_neutralisation(app_url: str, prefix: str) -> None:
    mark = CSV_PREFIXES[prefix]
    caption = f"{mark}SUM(A1:A9) {unique('c')[0]}"
    title = f"{mark}Essay {unique('t')[0]}" if mark.isprintable() else fresh_title()
    essay = create_essay(app_url, title=title, caption=caption)
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, essay["id"], "standard"), priya_api)
    rows = {row["licence_id"]: row for row in usage_csv(Api(app_url, "june"))[2]}
    row = rows[lic["id"]]
    assert row["caption"] == "'" + caption
    assert row["essay_title"] == ("'" + title if mark.isprintable() else title)
    assert row["credit_line"] == essay["credit_line"] and row["amount"] == plain_dollars(ST_PRICE)


def surfaces(api: Api) -> dict[str, Any]:
    usage = api.get("/api/usage").json()
    listing = api.get("/api/licences").json()["licences"]
    rows = usage_csv(api)[2]
    shortlist = api.get("/api/shortlist").json()
    states = ("active", "pending_invoice", "expired", "revoked")
    assert sum(usage[s] for s in states) == len(listing) == len(rows)
    by_id = {lic["id"]: lic for lic in listing}
    assert sorted(row["licence_id"] for row in rows) == sorted(lic["id"] for lic in listing)
    for s in states:
        assert usage[s] == sum(1 for lic in listing if lic["state"] == s)
    assert all(row["state"] == by_id[row["licence_id"]]["state"] for row in rows)
    assert usage["shortlist_count"] == shortlist["count"]
    assert usage["invoiced_minor"] == sum(cents(row["amount"]) for row in rows
                                          if by_id[row["licence_id"]]["invoice_state"] == "raised")
    confirmed = [instant(lic["confirmed_at"]) for lic in listing]
    assert confirmed == sorted(confirmed, reverse=True)
    return {"usage": usage, "by_id": by_id, "rows": {r["licence_id"]: r for r in rows}, "shortlist": shortlist}


def test_usage_surfaces_agree(app_url: str) -> None:
    june = Api(app_url, "june")
    surfaces(june)
    ends, keeps = create_essay(app_url, exclusive_days=1), create_essay(app_url)
    priya_api = Api(app_url, "priya")
    first = granted(claim(priya_api, ends["id"]), priya_api)
    dev_api = Api(app_url, "dev")
    second = granted(claim(dev_api, keeps["id"], "standard"), dev_api)
    Api(app_url, "priya").post("/api/shortlist", {"frame_id": keeps["frames"][0]["id"]})
    now = surfaces(june)
    assert now["by_id"][first["id"]]["state"] == "active"
    clock_to(app_url, instant(first["window_end"]))
    at_end = surfaces(june)
    assert at_end["by_id"][first["id"]]["state"] == "expired" and at_end["rows"][first["id"]]["state"] == "expired"
    nxt = at_end["usage"]["next_expiry"]
    stamp = server_now(app_url)
    eligible = sorted((lic for lic in at_end["by_id"].values()
                       if lic["state"] == "active" and instant(lic["window_end"]) > stamp),
                      key=lambda lic: (instant(lic["window_end"]), instant(lic["confirmed_at"]), lic["id"]))
    assert (nxt or {}).get("licence_id") == (eligible[0]["id"] if eligible else None)
    before = at_end["usage"]["shortlist_count"]
    assert Api(app_url, "ines").post(f"/api/essays/{keeps['id']}/takedown", {"reference": "REF-agree"}).status_code == 200
    after = surfaces(june)
    assert after["by_id"][second["id"]]["state"] == "revoked" and after["usage"]["shortlist_count"] == before - 1
    assert after["rows"][second["id"]]["essay_title"] == PLACEHOLDER


def test_wf_usage_export_csv(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, essay["id"]), priya_api)
    june = Api(app_url, "june")
    with signed_in(browser, app_url, "june") as page:
        go(page, "Usage")
        totals = page.get_by_role("region", name="Usage totals")
        shows(page, totals)
        eventually(page, lambda: expect(totals).to_contain_text(
            dollars(june.get("/api/usage").json()["invoiced_minor"]), timeout=POLL_MS))
        row = page.get_by_role("table", name="Licence expiries").get_by_role("row").filter(has_text=essay["title"])
        eventually(page, lambda: expect(row).to_contain_text(lic["window_end_display"], timeout=POLL_MS))
        with page.expect_download() as download:
            page.get_by_role("link", name="Export CSV").click()
        assert download.value.suggested_filename.startswith(f"saltprint-usage-{NEWSROOM['june']}-")
        content = Path(download.value.path()).read_text("utf-8")
    rows = {r["licence_id"]: r for r in csv.DictReader(io.StringIO(content, newline=""))}
    assert rows[lic["id"]]["window_end"] == csv_time(instant(lic["window_end"]))
    assert all(r["licence_id"] in {x["id"] for x in june.get("/api/licences").json()["licences"]} for r in rows.values())


def test_wf_usage_export_licences_scoped(browser: Browser, app_url: str) -> None:
    mine, theirs = create_essay(app_url), create_essay(app_url)
    priya_api = Api(app_url, "priya")
    granted(claim(priya_api, mine["id"], "standard"), priya_api)
    wes_api = Api(app_url, "wes")
    granted(claim(wes_api, theirs["id"], "standard"), wes_api)
    with signed_in(browser, app_url, "june") as page:
        table = page.get_by_role("table", name="Licences")
        shows(page, table.get_by_role("row").filter(has_text=mine["title"]))
        expect(table.get_by_role("row").filter(has_text=theirs["title"])).to_have_count(0)


def test_rate_schedule(app_url: str) -> None:
    now = server_now(app_url)
    target = local(coop_day(now), 20, 30)
    if target <= now:
        target = local(coop_day(now) + timedelta(days=1), 20, 30)
    clock_to(app_url, target)
    today = coop_day(target)
    assert target.date() == today + timedelta(days=1)
    bram = Api(app_url, "bram")
    field_err(schedule_rate(app_url, today, 2500), effective_from=FUTURE_DATE_MESSAGE)
    rate = random.randint(1001, 5999)
    day = today + timedelta(days=1)
    taken = {r["effective_from"] for r in bram.get("/api/commission-rates").json()["rates"]}
    while day.isoformat() in taken:
        day += timedelta(days=1)
    ok = schedule_rate(app_url, day, rate)
    assert ok.status_code == 201 and ok.json() == {"effective_from": day.isoformat(),
                                                   "rate_bp": rate, "status": "scheduled"}
    api_err(schedule_rate(app_url, day, 2000), 409, "rate_date_taken")
    field_err(bram.post("/api/commission-rates", {"effective_from": "2027-02-30", "rate_bp": 2500}),
              effective_from=DATE_MESSAGE)
    field_err(bram.post("/api/commission-rates", {"effective_from": "2099-01-01", "rate_bp": FULL_BP + 1}),
              rate_bp=RATE_MESSAGE)
    table = bram.get("/api/commission-rates").json()
    dates = [r["effective_from"] for r in table["rates"]]
    assert dates == sorted(dates)
    seed = next(r for r in table["rates"] if r["effective_from"] == "2026-01-01")
    assert seed["rate_bp"] == 3000
    assert [r["status"] for r in table["rates"]].count("current") == 1
    assert next(r for r in table["rates"] if r["effective_from"] == ok.json()["effective_from"])["status"] == "scheduled"
    assert table["current"]["effective_from"] <= today.isoformat()


def test_rate_fixed_at_confirmation(app_url: str) -> None:
    y, m = fresh_month(app_url)
    start, end = month_bounds(y, m)
    clock_to(app_url, start + timedelta(days=1, hours=12))
    old_rate = current_rate(app_url)
    first, second = create_essay(app_url), create_essay(app_url)
    priya_api = Api(app_url, "priya")
    a = granted(claim(priya_api, first["id"]), priya_api)
    new_rate = random.choice([r for r in range(1500, 4500, 7) if r != old_rate])
    day = date(y, m, 10)
    while schedule_rate(app_url, day, new_rate).status_code == 409:
        day += timedelta(days=1)
    clock_to(app_url, local(day, 1, 0))
    assert current_rate(app_url) == new_rate
    wes_api = Api(app_url, "wes")
    b = granted(claim(wes_api, second["id"]), wes_api)
    clock_to(app_url, end + timedelta(hours=1))
    statement = Api(app_url, "bram").post("/api/royalty-statements", {"month": f"{y:04d}-{m:02d}"}).json()
    lines = {line["licence_id"]: line for line in statement["lines"]}
    assert lines[a["id"]]["rate_bp"] == old_rate and lines[b["id"]]["rate_bp"] == new_rate
    assert lines[a["id"]]["commission_minor"] == EX_PRICE * old_rate // FULL_BP
    later = Api(app_url, "bram").get(f"/api/royalty-statements/{y:04d}-{m:02d}").json()
    assert {line["licence_id"]: line["rate_bp"] for line in later["lines"]}[a["id"]] == old_rate


def test_strict_request_bodies(app_url: str) -> None:
    bram, priya, desk, ada = (Api(app_url, w) for w in ("bram", "priya", "ines", "ada"))
    day = (coop_day(server_now(app_url)) + timedelta(days=random.randint(9000, 20000))).isoformat()
    e = field_err(bram.post("/api/commission-rates", {"effective_from": day, "rate_bp": 2500, "status": "current",
                                                      "approved": True}), status=UNKNOWN_FIELD, approved=UNKNOWN_FIELD)
    assert set(e["fields"]) == {"status", "approved"}
    for body, field, message in [({"effective_from": day}, "rate_bp", RATE_MESSAGE),
                                 ({"effective_from": day, "rate_bp": "2500"}, "rate_bp", RATE_MESSAGE),
                                 ({"effective_from": day, "rate_bp": 2500.5}, "rate_bp", RATE_MESSAGE),
                                 ({"effective_from": None, "rate_bp": 2500}, "effective_from", DATE_MESSAGE),
                                 ({"effective_from": 20990101, "rate_bp": 2500}, "effective_from", DATE_MESSAGE)]:
        field_err(bram.post("/api/commission-rates", body), **{field: message})
    for raw in [b"[]", b"not json", b'"text"']:
        field_err(bram.http.post("/api/commission-rates", content=raw, headers={"content-type": "application/json"}),
                  body=BODY_MESSAGE)
    assert day not in [r["effective_from"] for r in bram.get("/api/commission-rates").json()["rates"]]
    field_err(bram.post("/api/royalty-statements", {}), month=MONTH_MESSAGE)
    field_err(bram.post("/api/royalty-statements", {"month": 202611}), month=MONTH_MESSAGE)
    field_err(bram.post("/api/royalty-statements", {"month": "2026-13"}), month=MONTH_MESSAGE)
    field_err(httpx.post(f"{app_url}/api/session", json={"email": PEOPLE["priya"]}, timeout=HTTP_SECONDS),
              password=WRONG_TYPE)
    title = fresh_title()
    field_err(ada.post("/api/essays", {}), title=TITLE_LENGTH, caption=CAPTION_MESSAGE, lift_local=LIFT_MESSAGE,
              exclusive_days=EXCLUSIVE_MESSAGE, standard_days=STANDARD_MESSAGE,
              exclusive_price_minor=PRICE_MESSAGE, standard_price_minor=PRICE_MESSAGE, credits=CREDITS_COUNT)
    field_err(ada.post("/api/essays", essay_fields(title, "2026-11-20T08:00", [credit("ada-reyes", FULL_BP)],
                                                   exclusive_days=3.5)), exclusive_days=EXCLUSIVE_MESSAGE)
    field_err(ada.post("/api/essays", essay_fields(title, "2026-11-20T08:00", [credit("ada-reyes", FULL_BP)],
                                                   standard_price_minor="12000")), standard_price_minor=PRICE_MESSAGE)
    field_err(ada.post("/api/essays", essay_fields(title, "2026-11-20T08:00",
                                                   [{"contributor": "ada-reyes", "split_bp": "10000"}])),
              credits=CREDIT_ENTRY)
    assert title not in [x["title"] for x in ada.get("/api/studio/essays").json()["essays"]]
    essay = create_essay(app_url)
    field_err(priya.post(f"/api/essays/{essay['id']}/licences", {}, headers={"Idempotency-Key": idempotency_key()}),
              kind=KIND_MESSAGE)
    field_err(claim(priya, essay["id"], 1), kind=KIND_MESSAGE)
    assert licences_on(priya, essay["id"]) == []
    field_err(priya.post("/api/follows", {"essay_id": 5}), essay_id=WRONG_TYPE)
    field_err(priya.post("/api/shortlist", {"frame_id": None}), frame_id=WRONG_TYPE)
    field_err(desk.post(f"/api/essays/{essay['id']}/takedown", {"reference": None}), reference=REFERENCE_MESSAGE)
    assert desk.get(f"/api/essays/{essay['id']}").json()["state"] == "live"


def test_wf_commission_rates_schedule(browser: Browser, app_url: str) -> None:
    bram = Api(app_url, "bram")
    before = bram.get("/api/commission-rates").json()
    taken = {r["effective_from"] for r in before["rates"]}
    day = coop_day(server_now(app_url)) + timedelta(days=random.randint(800, 8000))
    while day.isoformat() in taken:
        day += timedelta(days=1)
    rate = random.randint(1001, 5999)
    with signed_in(browser, app_url, "bram") as page:
        page.get_by_role("textbox", name="Effective from (co-op date)").fill(day.isoformat())
        page.get_by_role("textbox", name="Rate (percent)").fill(percent(rate))
        page.get_by_role("button", name="Schedule rate").click()
        reads(page, page.get_by_role("status", name="Rate status"),
              f"Rate of {percent(rate)}% scheduled from {coop_date(day)}.")
        table = page.get_by_role("table", name="Commission rates")
        row = table.get_by_role("row").filter(has_text=coop_date(day))
        eventually(page, lambda: expect(row).to_contain_text("Scheduled", timeout=POLL_MS))
        current = table.get_by_role("row").filter(has_text="Current")
        expect(current).to_contain_text(coop_date(date.fromisoformat(before["current"]["effective_from"])))
    after = bram.get("/api/commission-rates").json()
    assert after["current"] == before["current"]
    assert {"effective_from": day.isoformat(), "rate_bp": rate, "status": "scheduled"} in after["rates"]


def test_wf_commission_rates_invalid(browser: Browser, app_url: str) -> None:
    today = coop_day(server_now(app_url))
    with signed_in(browser, app_url, "bram") as page:
        field = page.get_by_role("textbox", name="Effective from (co-op date)")
        field.fill(today.isoformat())
        page.get_by_role("textbox", name="Rate (percent)").fill("25.00")
        page.get_by_role("button", name="Schedule rate").click()
        eventually(page, lambda: expect(field).to_have_accessible_description(FUTURE_DATE_MESSAGE, timeout=POLL_MS))
        expect(field).to_be_focused()
    rates = Api(app_url, "bram").get("/api/commission-rates").json()["rates"]
    assert not [r for r in rates if r["effective_from"] == today.isoformat() and r["status"] == "scheduled"]


def test_royalty_statement_split(app_url: str) -> None:
    y, m = fresh_month(app_url)
    start, end = month_bounds(y, m)
    month = f"{y:04d}-{m:02d}"
    clock_to(app_url, start + timedelta(days=1, hours=12))
    rate = current_rate(app_url)
    assert royalty_split(25000, 3000, [5000, 3333, 1667]) == (7500, [8750, 5833, 2917])
    plans = [("priya", "exclusive", [credit("ada-reyes", 5000), credit("tomas-whitcombe", 3333),
                                     credit("noor-haddad", 1667)], {"exclusive_price_minor": 25000}),
             ("wes", "exclusive", [credit("noor-haddad", 3333), credit("ada-reyes", 3333),
                                   credit("tomas-whitcombe", 3334)], {"exclusive_price_minor": 10001}),
             ("hollis", "standard", [credit("ada-reyes", 7001), credit("noor-haddad", 2999)],
              {"standard_price_minor": 12345})]
    licences = []
    for who, kind, credits, prices in plans:
        essay = create_essay(app_url, credits=credits, **prices)
        who_api = Api(app_url, who)
        licences.append((granted(claim(who_api, essay["id"], kind), who_api), credits))
    bram = Api(app_url, "bram")
    field_err(bram.post("/api/royalty-statements", {"month": month}), month=MONTH_OPEN_MESSAGE)
    later_rate = random.choice([r for r in range(1500, 4500, 7) if r != rate])
    later_day = date(y, m, 20)
    while schedule_rate(app_url, later_day, later_rate).status_code == 409:
        later_day += timedelta(days=1)
    clock_to(app_url, end + timedelta(hours=1))
    run = bram.post("/api/royalty-statements", {"month": month})
    assert run.status_code == 201, run.text
    statement = run.json()
    assert statement["month"] == month
    lines = {line["licence_id"]: line for line in statement["lines"]}
    for lic, credits in licences:
        line = lines[lic["id"]]
        assert line["amount_minor"] == lic["amount_minor"] and line["rate_bp"] == rate
        commission, shares = royalty_split(lic["amount_minor"], rate, [c["split_bp"] for c in credits])
        assert line["commission_minor"] == commission
        assert [(s["handle"], s["position"], s["split_bp"], s["amount_minor"]) for s in line["shares"]] == [
            (c["contributor"], i + 1, c["split_bp"], shares[i]) for i, c in enumerate(credits)]
        assert commission + sum(shares) == lic["amount_minor"]
    confirmed = [instant(line["confirmed_at"]) for line in statement["lines"]]
    assert confirmed == sorted(confirmed)
    totals = statement["totals"]
    assert totals["invoiced_minor"] == sum(line["amount_minor"] for line in statement["lines"])
    assert totals["commission_minor"] == sum(line["commission_minor"] for line in statement["lines"])
    for person in totals["contributors"]:
        assert person["amount_minor"] == sum(s["amount_minor"] for line in statement["lines"] for s in line["shares"]
                                             if s["handle"] == person["handle"])
    again = bram.post("/api/royalty-statements", {"month": month})
    assert again.status_code == 200 and again.json() == statement
    assert bram.get(f"/api/royalty-statements/{month}").json() == statement
    mine = {x[0]["id"] for x in licences}
    for who in ("ada", "tomas"):
        own = [line for line in Api(app_url, who).get("/api/studio/royalties").json()["lines"]
               if line["licence_id"] in mine]
        expected = {(lid, s["position"], s["amount_minor"]) for lid, line in lines.items() if lid in mine
                    for s in line["shares"] if s["handle"] == HANDLE[who]}
        assert {(line["licence_id"], line["position"], line["amount_minor"]) for line in own} == expected
        assert all(line["month"] == month for line in own)


def november_statement(app_url: str, run_base: str) -> tuple[str, dict[str, Any], dict[str, dict[str, Any]]]:
    now = server_now(app_url).astimezone(COOP)
    year = now.year if now < datetime(now.year, 10, 30, tzinfo=COOP) else now.year + 1
    month = f"{year:04d}-11"
    start, end = month_bounds(year, 11)
    clock_to(app_url, start - timedelta(minutes=30))
    credits = [credit("ada-reyes", 9999), credit("tomas-whitcombe", 1)]
    first = create_essay(app_url, credits=credits, standard_price_minor=100)
    second = create_essay(app_url, credits=credits, standard_price_minor=100)
    priya_api = Api(app_url, "priya")
    licences = {"before": granted(claim(priya_api, first["id"], "standard"), priya_api)}
    clock_to(app_url, start + timedelta(minutes=30))
    wes_api = Api(app_url, "wes")
    licences["inside"] = granted(claim(wes_api, first["id"], "standard"), wes_api)
    clock_to(app_url, end - timedelta(minutes=30))
    hollis_api = Api(app_url, "hollis")
    licences["last"] = granted(claim(hollis_api, first["id"], "standard"), hollis_api)
    clock_to(app_url, end + timedelta(minutes=1))
    priya_api = Api(app_url, "priya")
    licences["after"] = granted(claim(priya_api, second["id"], "standard"), priya_api)
    run = Api(run_base, "bram").post("/api/royalty-statements", {"month": month})
    assert run.status_code == 201, run.text
    return month, run.json(), licences


def test_payouts_recorded_in_billing(app_url: str, killbill: Any) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    month, statement, _ = november_statement(app_url, down)
    queued = Api(down, "bram").post(f"/api/royalty-statements/{month}/payouts")
    assert queued.status_code == 202
    totals = {c["handle"]: c["amount_minor"] for c in statement["totals"]["contributors"]}
    assert totals.get("tomas-whitcombe", 0) == 0
    payouts = {p["handle"]: p for p in queued.json()["payouts"]}
    assert set(payouts) == {h for h, a in totals.items() if a > 0}
    assert all(p["state"] == "queued" and p["amount_minor"] == totals[h] for h, p in payouts.items())
    bram = Api(app_url, "bram")
    done = poll(lambda: bram.get(f"/api/royalty-statements/{month}").json()["payouts"],
                lambda ps: bool(ps) and all(p["state"] == "recorded" for p in ps), RECOVERY_SECONDS)
    assert all(p["state"] == "recorded" for p in done)
    repeat = bram.post(f"/api/royalty-statements/{month}/payouts")
    assert repeat.status_code == 200 and repeat.json()["payouts"] == done
    for handle, amount in totals.items():
        key = f"payout-{month}-{handle}"
        payment = killbill.payment_by_key(key)
        if amount == 0:
            assert payment is None
            continue
        account = killbill.account_by_key(f"contributor-{handle}")
        assert account and account["currency"] == "USD"
        credits_tx = [t for t in payment["transactions"] if t["transactionType"] == "CREDIT"]
        assert len(credits_tx) == 1 and credits_tx[0]["transactionExternalKey"] == key
        assert len([p for p in killbill.payments(account["accountId"]) if p.get("paymentExternalKey") == key]) == 1


def test_month_bounds_and_exact_money(app_url: str, killbill: Any) -> None:
    month, statement, lic = november_statement(app_url, app_url)
    ids = {line["licence_id"] for line in statement["lines"]}
    assert {lic["inside"]["id"], lic["last"]["id"]} <= ids
    assert not ids & {lic["before"]["id"], lic["after"]["id"]}
    lines = statement["lines"]
    assert all(isinstance(line["amount_minor"], int) and isinstance(line["commission_minor"], int) for line in lines)
    assert statement["totals"]["invoiced_minor"] == sum(line["amount_minor"] for line in lines)
    totals = {c["handle"]: c["amount_minor"] for c in statement["totals"]["contributors"]}
    for handle, amount in totals.items():
        assert amount == sum(s["amount_minor"] for line in lines for s in line["shares"] if s["handle"] == handle)
    bram = Api(app_url, "bram")
    assert bram.post(f"/api/royalty-statements/{month}/payouts").status_code == 202
    done = poll(lambda: bram.get(f"/api/royalty-statements/{month}").json()["payouts"],
                lambda ps: bool(ps) and all(p["state"] == "recorded" for p in ps), RECOVERY_SECONDS)
    assert done and all(p["state"] == "recorded" for p in done)
    for payout in done:
        assert payout["amount_minor"] == totals[payout["handle"]]
        key = f"payout-{month}-{payout['handle']}"
        payment = poll(lambda k=key: killbill.payment_by_key(k), bool, RECOVERY_SECONDS)
        assert payment, key
        credits_tx = [t for t in payment["transactions"] if t["transactionType"] == "CREDIT"]
        assert len(credits_tx) == 1
        assert Decimal(str(credits_tx[0]["amount"])) == Decimal(payout["amount_minor"]) / 100


def test_wf_royalty_statement_run(browser: Browser, app_url: str, killbill: Any) -> None:
    y, m = fresh_month(app_url)
    start, end = month_bounds(y, m)
    clock_to(app_url, start + timedelta(days=2))
    essay = create_essay(app_url)
    priya_api = Api(app_url, "priya")
    lic = granted(claim(priya_api, essay["id"]), priya_api)
    clock_to(app_url, end + timedelta(hours=2))
    month = f"{y:04d}-{m:02d}"
    with signed_in(browser, app_url, "bram") as page:
        go(page, "Statements")
        page.get_by_role("textbox", name="Statement month").fill(month)
        page.get_by_role("button", name="Run statement").click()
        status = page.get_by_role("status", name="Statement status")
        reads(page, status, f"Statement for {month_label(y, m)} ready.")
        row = page.get_by_role("table", name="Statement lines").get_by_role("row").filter(has_text=essay["title"])
        shows(page, row)
        expect(row).to_contain_text(dollars(lic["amount_minor"]))
        page.get_by_role("button", name="Record payouts").click()
        eventually(page, lambda: expect(status).to_have_text(PAYOUTS_STATUS, timeout=POLL_MS))
        ada_row = page.get_by_role("table", name="Payouts").get_by_role("row").filter(has_text="Ada Reyes")
        eventually(page, lambda: expect(ada_row).to_contain_text(PAYOUT_STATE, timeout=POLL_MS))
    payouts = Api(app_url, "bram").get(f"/api/royalty-statements/{month}").json()["payouts"]
    assert "ada-reyes" in {p["handle"] for p in payouts}
    assert poll(lambda: killbill.payment_by_key(f"payout-{month}-ada-reyes"), bool, RECOVERY_SECONDS)


def test_wf_royalty_statement_royalties(browser: Browser, app_url: str) -> None:
    y, m = fresh_month(app_url)
    start, end = month_bounds(y, m)
    clock_to(app_url, start + timedelta(days=2))
    essay = create_essay(app_url, credits=[credit("ada-reyes", 7000), credit("noor-haddad", 3000)])
    wes_api = Api(app_url, "wes")
    lic = granted(claim(wes_api, essay["id"]), wes_api)
    clock_to(app_url, end + timedelta(hours=1))
    statement = Api(app_url, "bram").post("/api/royalty-statements", {"month": f"{y:04d}-{m:02d}"}).json()
    line = next(x for x in statement["lines"] if x["licence_id"] == lic["id"])
    ada_share, noor_share = (s["amount_minor"] for s in line["shares"])
    with signed_in(browser, app_url, "ada") as page:
        go(page, "Royalties")
        row = page.get_by_role("table", name="My royalties").get_by_role("row").filter(has_text=essay["title"])
        shows(page, row)
        expect(row).to_have_count(1)
        expect(row).to_contain_text(month_label(y, m))
        expect(row).to_contain_text(dollars(ada_share))
        if noor_share != ada_share:
            expect(row).not_to_contain_text(dollars(noor_share))


def test_takedown_removes_everywhere(app_url: str, s3: Any) -> None:
    essay = create_essay(app_url, frames=2)
    priya, wes, ada, desk = (Api(app_url, w) for w in ("priya", "wes", "ada", "ines"))
    lic = granted(claim(priya, essay["id"]), priya)
    assert wes.post("/api/shortlist", {"frame_id": essay["frames"][0]["id"]}).status_code == 201
    assert priya.post("/api/shortlist", {"frame_id": essay["frames"][1]["id"]}).status_code == 201
    wes_count = wes.get("/api/shortlist").json()["count"]
    link = priya.post(f"/api/licences/{lic['id']}/grants", {"frame_id": essay["frames"][0]["id"]}).json()["url"]
    assert httpx.get(link, timeout=HTTP_SECONDS).status_code == 200
    r = desk.post(f"/api/essays/{essay['id']}/takedown", {"reference": "REF-everywhere"})
    assert r.status_code == 200 and r.json() == {"id": essay["id"], "state": "taken_down", "revoked_licences": 1}
    for api in (priya, wes):
        assert essay["id"] not in [e["id"] for e in api.get("/api/feed", params={"q": essay["title"]}).json()["essays"]]
        assert essay["id"] not in [i["essay_id"] for i in api.get("/api/shortlist").json()["items"]]
        for frame in essay["frames"]:
            for variant in ("grid", "preview"):
                api_err(api.get(f"/media/frames/{frame['id']}/{variant}"), 410, "taken_down")
    assert wes.get("/api/shortlist").json()["count"] == wes_count - 1
    for api in (priya, wes, ada):
        api_err(api.get(f"/api/essays/{essay['id']}"), 410, "taken_down")
    record = desk.get(f"/api/essays/{essay['id']}")
    assert record.status_code == 200 and record.json()["state"] == "taken_down"
    assert all(not f.get(k) for f in record.json()["frames"] for k in ("grid_url", "story_url", "preview_url"))
    api_err(claim(Api(app_url, "hollis"), essay["id"], "standard"), 410, "taken_down")
    api_err(wes.post("/api/follows", {"essay_id": essay["id"]}), 410, "taken_down")
    row = {x["licence_id"]: x for x in usage_csv(Api(app_url, "june"))[2]}[lic["id"]]
    assert (row["essay_title"], row["caption"], row["credit_line"]) == (PLACEHOLDER, "", "")
    assert s3.keys(f"derivatives/{essay['id']}") == [] and s3.keys(f"originals/{essay['id']}") == []
    assert len(s3.keys(f"legal-hold/{essay['id']}")) == 2
    assert f"grants/{lic['id']}.json" not in s3.keys("grants/")
    assert httpx.get(link, timeout=HTTP_SECONDS).status_code != 200


def takedown_with_history(app_url: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]], httpx.Response]:
    essay = create_essay(app_url, exclusive_days=1)
    priya, dev, hollis = Api(app_url, "priya"), Api(app_url, "dev"), Api(app_url, "hollis")
    old = granted(claim(priya, essay["id"]), priya)
    clock_to(app_url, instant(old["window_end"]) + timedelta(minutes=1))
    assert priya.get(f"/api/licences/{old['id']}").json()["state"] == "expired"
    mine = granted(claim(dev, essay["id"], "standard"), dev)
    theirs = granted(claim(hollis, essay["id"], "standard"), hollis)
    Api(app_url, "wes").post("/api/shortlist", {"frame_id": essay["frames"][0]["id"]})
    r = Api(app_url, "ines").post(f"/api/essays/{essay['id']}/takedown", {"reference": TAKEDOWN_REFERENCE})
    assert r.status_code == 200, r.text
    return essay, {"priya": old, "dev": mine, "hollis": theirs}, r


def test_takedown_placeholders(app_url: str, s3: Any) -> None:
    essay, held_licences, r = takedown_with_history(app_url)
    assert r.json()["revoked_licences"] == 3
    for who, lic in held_licences.items():
        api = Api(app_url, who)
        now = api.get(f"/api/licences/{lic['id']}").json()
        assert now["state"] == "revoked" and now["essay_title"] == PLACEHOLDER
        assert now["credit_line"] is None and now["frames"] == []
        for key in ("window_start", "window_end", "amount_minor", "confirmed_at"):
            assert now[key] == lic[key]
        assert now["invoice_state"] == "raised"
        api_err(api.post(f"/api/licences/{lic['id']}/grants", {"frame_id": essay["frames"][0]["id"]}), 410,
                "licence_revoked")
        assert f"grants/{lic['id']}.json" not in s3.keys("grants/")


def test_takedown_notices(app_url: str, mail: Any) -> None:
    essay, held_licences, _ = takedown_with_history(app_url)
    old, mine, theirs = held_licences["priya"], held_licences["dev"], held_licences["hollis"]
    subject = f"Takedown notice: {essay['title']}"
    notices = wait_mail(mail, subject, {"priya", "dev", "june", "hollis", "margot"})
    quiet(mail, subject, {"wes", "carmen"}, seconds=1)
    for who in ("priya", "dev", "june", "hollis", "margot"):
        assert len(to(notices, who)) == 1
        body = text(to(notices, who)[0])
        assert essay["title"] in body and TAKEDOWN_SENTENCE in body and TAKEDOWN_REFERENCE not in body
    assert old["id"] in text(to(notices, "june")[0]) and mine["id"] in text(to(notices, "june")[0])
    assert theirs["id"] in text(to(notices, "margot")[0])


def test_takedown_serialised_with_licensing(app_url: str, s3: Any, mail: Any) -> None:
    down = outage("APP_KILLBILL_DOWN_URL")
    for base in (down, app_url):
        essay = create_essay(app_url)
        racers = [(Api(base, "priya"), "exclusive"), (Api(base, "wes"), "standard"), (Api(base, "hollis"), "standard")]
        desk = Api(app_url, "ines")
        calls: list[Callable[[], httpx.Response]] = [lambda a=a, k=k: claim(a, essay["id"], k) for a, k in racers]
        calls.append(lambda: desk.post(f"/api/essays/{essay['id']}/takedown", {"reference": "REF-race"}))
        *answers, takedown = together(calls)
        assert takedown.status_code == 200
        assert all(r.status_code in (201, 202, 409, 410) for r in answers)
        stamp = monotonic() + QUIET_SECONDS
        while True:
            found = [lic for m in MANAGER.values() for lic in licences_on(Api(app_url, m), essay["id"])]
            assert all(lic["state"] == "revoked" for lic in found)
            assert not {f"grants/{lic['id']}.json" for lic in found} & set(s3.keys("grants/"))
            if monotonic() > stamp:
                break
        assert takedown.json()["revoked_licences"] == len(found)
        for r in answers:
            if r.status_code in (201, 202):
                assert r.json()["id"] in {lic["id"] for lic in found}
        api_err(claim(Api(app_url, "dev"), essay["id"], "standard"), 410, "taken_down")
        pending_holders = {lic["licensed_by"]["name"] for lic in found if lic["invoice_state"] == "pending"}
        if found:
            wait_mail(mail, f"Takedown notice: {essay['title']}", {MANAGER[lic["newsroom"]["slug"]] for lic in found})
        quiet(mail, f"Licence receipt: {essay['title']}",
              {who for who, name in NAMES.items() if name in pending_holders}, seconds=1)


def test_wf_takedown_action(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    priya_api = Api(app_url, "priya")
    granted(claim(priya_api, essay["id"]), priya_api)
    with signed_in(browser, app_url, "ines") as page:
        go(page, "All essays")
        page.get_by_role("table", name="All essays").get_by_role(
            "button", name=f"Legal takedown for {essay['title']}", exact=True).click()
        dialog = page.get_by_role("dialog", name="Legal takedown")
        shows(page, dialog)
        confirm = dialog.get_by_role("button", name="Take down essay")
        dialog.get_by_role("textbox", name="Legal reference").fill("REF-ui-takedown")
        expect(confirm).to_be_disabled()
        dialog.get_by_role("checkbox", name="I confirm this removes all imagery and revokes every licence").check()
        expect(confirm).to_be_enabled()
        confirm.click()
        reads(page, page.get_by_role("status", name="Desk status"), "Essay taken down. Licensees have been notified.")
    api_err(Api(app_url, "priya").get(f"/api/essays/{essay['id']}"), 410, "taken_down")
    with signed_in(browser, app_url, "priya") as page:
        go(page, "Licences")
        table = page.get_by_role("table", name="Licences")
        rows = table.get_by_role("row").filter(has_text=PLACEHOLDER).filter(has_text="Revoked")
        shows(page, rows.first)
        expect(table).not_to_contain_text(essay["title"])
        expect(table.get_by_role("img")).to_have_count(0)


def test_wf_takedown_cancel(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url)
    with signed_in(browser, app_url, "ines") as page:
        go(page, "All essays")
        opener = page.get_by_role("button", name=f"Legal takedown for {essay['title']}", exact=True)
        shows(page, opener)
        opener.click()
        dialog = page.get_by_role("dialog", name="Legal takedown")
        shows(page, dialog)
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS))
    assert Api(app_url, "ines").get(f"/api/essays/{essay['id']}").json()["state"] == "live"


def test_wf_cross_cutting_sign_in(browser: Browser, app_url: str) -> None:
    token = unique("q")[0]
    with app_page(browser, f"{app_url}/sheet?q={token}") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        shows(page, page.get_by_role("heading", name="Sign in to Saltprint Desk"))
        assert tab_order(page, 1) == ["Email"]
        page.get_by_role("textbox", name="Email").fill(PEOPLE["priya"])
        page.get_by_role("textbox", name="Password").fill("wrong-proof")
        page.get_by_role("button", name="Sign in").click()
        shows(page, page.get_by_role("alert"))
        expect(page.get_by_role("textbox", name="Email")).to_have_value(PEOPLE["priya"])
        page.get_by_role("textbox", name="Password").fill(PASSWORD)
        page.get_by_role("button", name="Sign in").click()
        eventually(page, lambda: assert_query(page, "q", token))
        assert urlsplit(page.url).path == "/sheet"
        expect(page.get_by_text(NAMES["priya"]).first).to_be_visible()
        expect(page.get_by_text("Harbor Light Herald").first).to_be_visible()
    for who in ("ada", "priya", "june", "ines", "bram"):
        with signed_in(browser, app_url, who) as page:
            nav = page.get_by_role("navigation", name="Desk sections")
            links = nav.get_by_role("link").evaluate_all("els => els.map(e => e.textContent.trim())")
            assert links == SECTIONS[ROLES[who]]
            expect(page.get_by_role("button", name="Sign out")).to_be_visible()
            if who in ("ada", "ines", "bram"):
                expect(page.get_by_text("Saltprint Picture Co-operative").first).to_be_visible()
    with app_page(browser, f"{app_url}/sheet?q={token}") as page:
        ui_signin(page, "bram")
        shows(page, page.get_by_role("table", name="Commission rates"))


def test_wf_cross_cutting_layout(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=2)
    screens = {"priya": ["Contact sheet", "Shortlist", "Licences", "Following"], "june": ["Licences", "Usage"],
               "ada": ["Studio", "Royalties"], "ines": ["Review queue", "All essays"], "bram": ["Rates", "Statements"]}
    for who, sections in screens.items():
        with signed_in(browser, app_url, who) as page:
            for width, height in VIEWPORTS:
                page.set_viewport_size({"width": width, "height": height})
                nav = page.get_by_role("navigation", name="Desk sections")
                for section in sections:
                    go(page, section)
                    advance(page, TICK_MS)
                    layout(page)
                    assert nav.evaluate("e => e.scrollWidth <= e.clientWidth")
                if who == "priya":
                    open_story(page, app_url, essay)
                    layout(page)
                    if width == DESKTOP[0]:
                        shows(page, page.get_by_role("complementary", name="Ledger"))
                    else:
                        shows(page, page.get_by_role("region", name="Ledger"))
                        page.get_by_role("button", name="Expand ledger").click()
                        shows(page, page.get_by_role("button", name="Collapse ledger"))
                        expect(page.get_by_role("group", name="Story progress")).to_be_in_viewport()
                        layout(page)
                    page.goto(f"{app_url}/sheet")


def test_motion_and_reduced_motion(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=3)

    def finite_and_within(found: list[dict[str, Any]], limit: float) -> None:
        for anim in found:
            assert anim.get("iterations") not in (float("inf"), "Infinity"), anim
            assert float(anim.get("duration") or 0) <= limit, anim

    with signed_in(browser, app_url, "priya") as page:
        page.get_by_role("searchbox", name="Search essays").fill(essay["title"])
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {essay['title']}", exact=True)
        shows(page, tile)
        tile.hover()
        finite_and_within(animations(tile), TILE_HOVER_MS)
        tile.click()
        dialog = page.get_by_role("dialog", name=essay["title"], exact=True)
        finite_and_within(animations(dialog), EVERYDAY_MAX_MS)
        shows(page, dialog)
        page.keyboard.press("ArrowRight")
        finite_and_within(animations(dialog), EVERYDAY_MAX_MS)
        finite_and_within(animations(page.get_by_role("region", name="Contact sheet")), EVERYDAY_MAX_MS)
    with signed_in(browser, app_url, "dev", reduced_motion="reduce") as page:
        page.get_by_role("searchbox", name="Search essays").fill(essay["title"])
        tile = page.get_by_role("region", name="Contact sheet").get_by_role(
            "button", name=f"Open {essay['title']}", exact=True)
        shows(page, tile)
        tile.hover()
        finite_and_within(animations(tile), INSTANT_MS)
        tile.click()
        dialog = page.get_by_role("dialog", name=essay["title"], exact=True)
        finite_and_within(animations(dialog), INSTANT_MS)
        shows(page, dialog)
        page.keyboard.press("ArrowRight")
        finite_and_within(animations(dialog), INSTANT_MS)
        dialog.get_by_role("button", name="Claim exclusive window").click()
        shows(page, dialog.get_by_role("button", name="Confirm claim"))
        expect(dialog.get_by_text("Step 2 of 2")).to_be_visible()
        dialog.get_by_role("button", name="Cancel claim").click()


def test_keyboard_focus_and_tap_targets(browser: Browser, app_url: str) -> None:
    essay = create_essay(app_url, frames=3)
    review = create_essay(app_url, state="in_review")
    with signed_in(browser, app_url, "priya") as page:
        dialog = open_story(page, app_url, essay, frame=2)
        expect(dialog.get_by_role("button", name="Next frame")).to_be_focused()
        prev = dialog.get_by_role("button", name="Previous frame")
        rest, focused = state_styles(prev, "outline-style", "outline-width", "box-shadow", state="focus")
        assert rest != focused
        names = tab_order(page, TAB_PRESSES)
        cycle = names[: names.index(names[0], 1)] if names[0] in names[1:] else names
        assert "Claim exclusive window" in cycle
        assert "Previous frame" in cycle and "Next frame" in cycle
        marks = [n in ("Previous frame", "Next frame") for n in cycle]
        blocks = sum(1 for i, m in enumerate(marks) if m and not marks[i - 1])
        assert blocks == 1, cycle
        for _ in range(12):
            page.keyboard.press("Tab")
            assert dialog.evaluate("d => d.contains(document.activeElement)")
    with signed_in(browser, app_url, "ines") as page:
        go(page, "Review queue")
        opener = page.get_by_role("button", name=f"Hold {review['title']}", exact=True)
        shows(page, opener)
        opener.click()
        hold = page.get_by_role("dialog", name="Hold essay")
        shows(page, hold)
        expect(hold.get_by_role("textbox", name="Desk note")).to_be_focused()
        for _ in range(6):
            page.keyboard.press("Tab")
            assert hold.evaluate("d => d.contains(document.activeElement)")
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(opener).to_be_focused(timeout=POLL_MS))
    assert Api(app_url, "ines").get(f"/api/essays/{review['id']}").json()["state"] == "in_review"
    with signed_in(browser, app_url, "priya", size=PHONE) as page:
        dialog = open_story(page, app_url, essay)
        boxes = []
        for button in dialog.get_by_role("button").all():
            if button.is_visible():
                box = button.bounding_box()
                assert box and box["width"] >= TAP_PX and box["height"] >= TAP_PX, box
                boxes.append(box)
        for i, a in enumerate(boxes):
            for b in boxes[i + 1:]:
                gap = max(b["x"] - (a["x"] + a["width"]), a["x"] - (b["x"] + b["width"]),
                          b["y"] - (a["y"] + a["height"]), a["y"] - (b["y"] + b["height"]))
                assert gap >= TAP_GAP_PX or gap < -min(a["height"], b["height"]), (a, b)


def npm_tree() -> dict[str, Any]:
    done = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd="/app",
                          capture_output=True, text=True, timeout=BOOT_SECONDS)
    return json.loads(done.stdout)


def walk(node: dict[str, Any]) -> Iterator[tuple[str, Any]]:
    for name, child in (node.get("dependencies") or {}).items():
        yield name, child.get("license")
        yield from walk(child)


def test_if_run_manifest() -> None:
    manifest = json.loads(Path("/app/run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(manifest[k], str) and manifest[k].strip() for k in ("install", "build", "serve"))


def test_if_third_party_notices() -> None:
    notices = Path("/app/THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({name for name, _ in walk(npm_tree()) if name not in notices})
    assert not missing, missing
    for name in ("Newsreader", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert name in notices


def test_if_licence_allowlist() -> None:
    allowed = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0", "OFL-1.1", "CC0-1.0"}
    bad = sorted({(n, str(lic)) for n, lic in walk(npm_tree()) if lic not in allowed})
    assert not bad, bad


def test_if_no_extra_datastore() -> None:
    package = json.loads(Path("/app/package.json").read_text())
    deps = {**package.get("dependencies", {}), **package.get("optionalDependencies", {})}
    banned = {"redis", "ioredis", "sqlite3", "better-sqlite3", "mongodb", "mongoose", "bullmq", "bull",
              "level", "lowdb", "nedb", "memcached", "kafkajs", "amqplib", "lmdb"}
    assert not banned & set(deps)


def test_if_service_config_untouched(killbill: Any, mail: Any, s3: Any) -> None:
    assert isinstance(s3.keys(""), list)
    assert isinstance(mail.messages(), list)
    killbill.account_by_key("newsroom-harbor-light")
    assert kit.Postgres().tables()


def test_if_lockfile() -> None:
    lock = json.loads(Path("/app/package-lock.json").read_text())
    package = json.loads(Path("/app/package.json").read_text())
    assert lock.get("lockfileVersion") and lock.get("name") == package.get("name")
