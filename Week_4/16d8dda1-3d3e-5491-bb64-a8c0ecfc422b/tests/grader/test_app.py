from __future__ import annotations

import concurrent.futures
import copy
import json
import os
import re
import secrets
import struct
import threading
import time
import zlib
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import urljoin
from zoneinfo import ZoneInfo

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    Valkey,
    advance,
    animations,
    camera,
    decode,
    held,
    layout,
    licence_allowed,
    open_app,
    same_origin,
    scene_frames,
    select,
    shipped_packages,
    tab_order,
    tap,
    unique,
)


SECOND_URL = os.environ.get("APP_SECOND_URL", "").rstrip("/")
TIMERS_URL = os.environ.get("APP_TIMERS_URL", "").rstrip("/")
MINIO_DOWN_URL = os.environ.get("APP_MINIO_DOWN_URL", "").rstrip("/")
VALKEY_DOWN_URL = os.environ.get("APP_VALKEY_DOWN_URL", "").rstrip("/")
GRADING_KEY = os.environ.get("GRADING_KEY", "")
APP = Path("/app")

SESSION_COOKIE = "slatehall_session"
TEACHER_PASSWORD = "lamplight-0423"
REF_NOW = "2027-03-09T19:10:00-06:00"

LIVE_MS = 1000
PAGE_READY_MS = 3000
RECOVER_MS = 5000
KEYS_GONE_S = 5
LOAD_MS = 20000
API_WAIT_S = 10
HTTP_TIMEOUT = 120.0
POLL_SLACK_S = 3
REAL_TIMER_WAIT_MS = 60000

DESKTOP = (1280, 800)
TABLET = (768, 1024)
PHONE = (375, 812)

JSON_LIMIT = 100_000
SLIDE_MAX_BYTES = 5_000_000
MODEL_MAX_BYTES = 10_000_000
SLIDES_MAX = 40
CHAT_MAX = 300
BREAKOUT_SECONDS = 480
WARNING_SECONDS = 30
EXTEND_SECONDS = 120
GRACE_SECONDS = 90
TIMERS_BREAKOUT_SECONDS = 20
TIMERS_WARNING_SECONDS = 5
PASSWORD_MIN = 10
TEACHER_NAME_MAX = 60
CLASS_TITLE_MAX = 80
LEARNER_NAME_MAX = 40
POLL_QUESTION_MAX = 200
POLL_OPTION_MAX = 80
TOUCH_MIN_PX = 44
ANNOUNCE_KEEP = 20
DEDUP_PAST_MS = 2500
SHEET_SETTLE_MS = 500
DIALOG_SETTLE_MS = 400
RETURN_STILL_WALKING_MS = 400
RETURN_DONE_MS = 1000
COUNTDOWN_STEP_MS = 5000
MODEL_TURN_WINDOW_MS = 5000
CODE_RE = re.compile(r"^[A-HJKMNP-Z2-9]{6}$")
CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
ALLOWLIST = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "BlueOak-1.0.0"}

DEVICE_FAR_FUTURE = datetime(2031, 6, 1, 3, 0, tzinfo=timezone.utc)
DEVICE_FAR_PAST = datetime(2019, 1, 1, 12, 0, tzinfo=timezone.utc)
FOREIGN_ORIGIN = "http://elsewhere.example"
UNKNOWN_CODE = "ZZZZZZ"
DRAG_PX = 120
CHAT_HELLO = "Hola mesa"
CHAT_WELCOME = "Bienvenidos"
PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_HEAD = b"\xff\xd8\xff\xe0\x00\x10JFIF\x00\x01\x01\x00\x00\x01\x00\x01\x00\x00"
JPEG_TAIL = b"\xff\xd9"
JUNK = b"These are my seminar notes, not a picture.\n"

SPANISH_LAYOUT: dict[str, Any] = {"columns": 8, "rows": 6, "pieces": [
    {"kind": "board", "column": 2, "row": 0},
    {"kind": "table", "column": 1, "row": 2},
    {"kind": "table", "column": 5, "row": 2},
    {"kind": "table", "column": 1, "row": 4},
    {"kind": "seat", "column": 0, "row": 2},
    {"kind": "seat", "column": 2, "row": 2},
    {"kind": "seat", "column": 4, "row": 2},
    {"kind": "seat", "column": 6, "row": 2},
    {"kind": "seat", "column": 0, "row": 4},
    {"kind": "seat", "column": 2, "row": 4},
    {"kind": "seat", "column": 7, "row": 5}]}
DEFAULT_LAYOUT = {"columns": 8, "rows": 6, "pieces": [{"kind": "board", "column": 2, "row": 0}]}

REFERENCE: dict[str, Any] = {
    "now": REF_NOW,
    "teachers": [
        {"key": "ana", "email": "ana.reyes@corbel-slate.test", "password": "lamplight-0423", "displayName": "Ana Reyes"},
        {"key": "ben", "email": "ben.achebe@corbel-slate.test", "password": "lamplight-0424", "displayName": "Ben Achebe"},
        {"key": "clara", "email": "clara.holt@corbel-slate.test", "password": "lamplight-0425", "displayName": "Clara Holt"},
    ],
    "classes": [
        {"key": "spanish", "teacher": "ana", "coTeachers": ["ben"], "title": "Evening Spanish B1", "timeZone": "America/Chicago", "layout": SPANISH_LAYOUT},
        {"key": "law", "teacher": "clara", "coTeachers": [], "title": "Contract Law Seminar", "timeZone": "Europe/London",
         "layout": {"columns": 6, "rows": 4, "pieces": [
             {"kind": "board", "column": 1, "row": 0},
             {"kind": "table", "column": 1, "row": 2},
             {"kind": "seat", "column": 0, "row": 2},
             {"kind": "seat", "column": 2, "row": 2}]}},
    ],
    "lessons": [
        {"key": "week3", "class": "spanish", "title": "Week 3: At the restaurant", "slideCount": 3, "modelCount": 1},
        {"key": "week1", "class": "law", "title": "Week 1: Offer and acceptance", "slideCount": 2, "modelCount": 0},
    ],
    "sessions": [
        {"key": "tue", "class": "spanish", "lesson": "week3", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30", "state": "live", "currentSlide": 1, "locked": False},
        {"key": "lastweek", "class": "spanish", "lesson": "week3", "startsAt": "2027-03-02T19:00", "endsAt": "2027-03-02T20:30", "state": "ended", "currentSlide": 3, "locked": False},
        {"key": "lawmon", "class": "law", "lesson": "week1", "startsAt": "2027-03-08T18:30", "endsAt": "2027-03-08T20:00", "state": "ended", "currentSlide": 2, "locked": False},
    ],
    "learners": [
        {"key": "mira", "displayName": "Mira Okafor", "session": "tue", "seat": "B1", "presence": [{"joinedAt": "2027-03-09T18:55:00-06:00", "leftAt": None}]},
        {"key": "jonas", "displayName": "Jonas Lindqvist", "session": "tue", "seat": "B3", "presence": [{"joinedAt": "2027-03-09T18:56:00-06:00", "leftAt": None}]},
        {"key": "priya", "displayName": "Priya Raman", "session": "tue", "seat": "B5", "presence": [{"joinedAt": "2027-03-09T18:57:00-06:00", "leftAt": None}]},
        {"key": "tomas", "displayName": "Tomas Ferreira", "session": "tue", "seat": "B7", "presence": [{"joinedAt": "2027-03-09T18:58:00-06:00", "leftAt": None}]},
        {"key": "hana", "displayName": "Hana Sato", "session": "tue", "seat": "D1", "presence": [{"joinedAt": "2027-03-09T18:59:00-06:00", "leftAt": None}]},
        {"key": "leo", "displayName": "Leo Brandt", "session": "tue", "seat": None, "presence": [{"joinedAt": "2027-03-09T19:06:00-06:00", "leftAt": None}]},
        {"key": "rosa", "displayName": "Rosa Delgado", "session": "lastweek", "seat": None, "presence": [{"joinedAt": "2027-03-02T19:05:00-06:00", "leftAt": "2027-03-02T19:40:00-06:00"}, {"joinedAt": "2027-03-02T19:41:29-06:00", "leftAt": None}]},
        {"key": "sam", "displayName": "Sam Whitfield", "session": "lastweek", "seat": None, "presence": [{"joinedAt": "2027-03-02T19:05:01-06:00", "leftAt": None}]},
        {"key": "tess", "displayName": "Tess Moreau", "session": "lastweek", "seat": None, "presence": [{"joinedAt": "2027-03-02T18:58:00-06:00", "leftAt": "2027-03-02T19:30:00-06:00"}, {"joinedAt": "2027-03-02T19:31:30-06:00", "leftAt": "2027-03-02T20:20:00-06:00"}]},
        {"key": "omar", "displayName": "Omar Haddad", "session": "lastweek", "seat": None, "presence": [{"joinedAt": "2027-03-02T18:59:00-06:00", "leftAt": "2027-03-02T20:19:59-06:00"}]},
        {"key": "yuki", "displayName": "Yuki Tanaka", "session": "lastweek", "seat": None, "presence": [{"joinedAt": "2027-03-02T19:07:00-06:00", "leftAt": "2027-03-02T20:15:00-06:00"}]},
        {"key": "ines", "displayName": "Ines Duarte", "session": "lastweek", "seat": None, "presence": []},
        {"key": "felix", "displayName": "Felix Grant", "session": "lawmon", "seat": None, "presence": [{"joinedAt": "2027-03-08T18:29:00+00:00", "leftAt": "2027-03-08T20:00:00+00:00"}]},
    ],
    "hands": [{"session": "tue", "learners": ["priya", "jonas"]}],
    "polls": [
        {"key": "bill", "session": "tue", "question": "Which word means the bill?", "options": ["La cuenta", "La mesa", "La carta"], "answers": {"mira": 1, "jonas": 1, "priya": 2}, "state": "open"},
    ],
    "breakouts": [],
}
NAMES = {person["key"]: person["displayName"] for person in REFERENCE["learners"]}
BILL_OPTIONS = ["La cuenta", "La mesa", "La carta"]


def origin_of(url: str) -> str:
    parsed = httpx.URL(url)
    return f"{parsed.scheme}://{parsed.host}" + (f":{parsed.port}" if parsed.port else "")


class Api:

    def __init__(self, base: str, cookie: str | None = None) -> None:
        self.base = base.rstrip("/")
        self.cookie = cookie

    def on(self, base: str | None) -> "Api":
        return Api(base, self.cookie) if base else self

    def call(self, method: str, path: str, body: Any = None, *, files: Any = None,
             headers: dict[str, str] | None = None, content: bytes | str | None = None) -> httpx.Response:
        sent = {"Origin": origin_of(self.base)}
        if self.cookie:
            sent["Cookie"] = f"{SESSION_COOKIE}={self.cookie}"
        sent.update(headers or {})
        extra: dict[str, Any] = {}
        if body is not None:
            extra["json"] = body
        if files is not None:
            extra["files"] = files
        if content is not None:
            extra["content"] = content
        response = httpx.request(method, self.base + path, headers=sent, timeout=HTTP_TIMEOUT, **extra)
        fresh = response.cookies.get(SESSION_COOKIE)
        if fresh:
            self.cookie = fresh
        return response

    def get(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("GET", path, **kw)

    def post(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("POST", path, body, **kw)

    def put(self, path: str, body: Any = None, **kw: Any) -> httpx.Response:
        return self.call("PUT", path, body, **kw)

    def delete(self, path: str, **kw: Any) -> httpx.Response:
        return self.call("DELETE", path, **kw)


def ok(response: httpx.Response, status: int) -> Any:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url.path} answered {response.status_code} "
        f"{response.text[:400]!r}; expected {status}")
    return response.json() if response.content else None


def refused(response: httpx.Response, status: int, text: str) -> None:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url.path} answered {response.status_code} "
        f"{response.text[:400]!r}; expected {status} {text!r}")
    assert response.json().get("error") == text, f"expected error {text!r}, got {response.text[:400]!r}"


def grading_post(base: str, path: str, body: Any, key: str | None = None) -> httpx.Response:
    headers = {"Origin": origin_of(base)}
    used = GRADING_KEY if key is None else key
    if used:
        headers["X-Grading-Key"] = used
    return httpx.post(base.rstrip("/") + path, json=body, headers=headers, timeout=HTTP_TIMEOUT)


def fresh_email(prefix: str) -> str:
    _, email = unique(prefix)
    return email


def sign_up(base: str, name: str = "Ana Reyes") -> tuple[Api, str]:
    email = fresh_email("teacher")
    api = Api(base)
    ok(api.post("/api/teachers", {"email": email, "password": TEACHER_PASSWORD, "displayName": name}), 201)
    return api, email


def at(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def wall(text: str) -> datetime:
    return datetime.fromisoformat(text).replace(tzinfo=None)


def mmss(seconds: int) -> str:
    return f"{seconds // 60:02d}:{seconds % 60:02d}"


def poll_until(fn: Callable[[], Any], what: str, seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    last: Any = None
    while time.monotonic() < deadline:
        last = fn()
        if last:
            return last
    pytest.fail(f"{what} (last seen: {last!r})")


def race(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(fn: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait(timeout=API_WAIT_S)
        return fn()

    with concurrent.futures.ThreadPoolExecutor(max_workers=len(calls)) as pool:
        return list(pool.map(run, calls))


def reference_world(now: str | None = REF_NOW) -> dict[str, Any]:
    world = copy.deepcopy(REFERENCE)
    if now is None:
        world.pop("now")
    else:
        world["now"] = now
    for teacher in world["teachers"]:
        teacher["email"] = fresh_email(teacher["key"])
    return world


class World:
    def __init__(self, base: str, spec: dict[str, Any], ids: dict[str, Any]) -> None:
        self.base = base.rstrip("/")
        self.spec = spec
        self.ids = ids
        self._apis: dict[str, Api] = {}

    @property
    def id(self) -> str:
        return self.ids["worldId"]

    @property
    def now(self) -> datetime:
        return at(self.spec["now"])

    def cls(self, key: str) -> str:
        return self.ids["classes"][key]["id"]

    def code(self, key: str) -> str:
        return self.ids["classes"][key]["code"]

    def lesson(self, key: str) -> str:
        return self.ids["lessons"][key]["id"]

    def slides(self, key: str) -> list[str]:
        return self.ids["lessons"][key]["slides"]

    def models(self, key: str) -> list[str]:
        return self.ids["lessons"][key]["models"]

    def ses(self, key: str) -> str:
        return self.ids["sessions"][key]

    def lrn(self, key: str) -> str:
        return self.ids["learners"][key]

    def poll(self, key: str) -> str:
        return self.ids["polls"][key]

    def api(self, key: str, base: str | None = None) -> Api:
        if key not in self._apis:
            response = grading_post(self.base, "/api/grading/sign-in", {"token": self.ids["signInTokens"][key]})
            ok(response, 200)
            cookie = response.cookies.get(SESSION_COOKIE)
            assert cookie, "POST /api/grading/sign-in set no slatehall_session cookie"
            self._apis[key] = Api(self.base, cookie)
        return self._apis[key].on(base)

    def clock(self, when: datetime | None) -> dict[str, Any]:
        body = {"worldId": self.id, "now": when.isoformat() if when else None}
        return ok(grading_post(self.base, "/api/grading/clock", body), 200)


def setup_world(base: str, spec: dict[str, Any]) -> World:
    return World(base, spec, ok(grading_post(base, "/api/grading/setup", spec), 201))


@contextmanager
def outage(base: str, service: str) -> Iterator[None]:
    ok(grading_post(base, "/api/grading/outage", {"service": service, "down": True}), 200)
    try:
        yield
    finally:
        grading_post(base, "/api/grading/outage", {"service": service, "down": False})


def snapshot(api: Api, sid: str) -> dict[str, Any]:
    return ok(api.get(f"/api/sessions/{sid}"), 200)


def seat_of(snap: dict[str, Any], learner_id: str) -> str | None:
    for item in snap["seats"]:
        if item["learnerId"] == learner_id:
            return item["seatId"]
    return None


def occupant(snap: dict[str, Any], seat_id: str) -> str | None:
    return next(item["learnerId"] for item in snap["seats"] if item["seatId"] == seat_id)


def hand_ids(snap: dict[str, Any]) -> list[str]:
    return [hand["learnerId"] for hand in snap["hands"]]


def spot(snap: dict[str, Any]) -> str | None:
    value = snap["spotlight"]
    return (value.get("learnerId") or value.get("id")) if isinstance(value, dict) else value


def _chunk(kind: bytes, data: bytes) -> bytes:
    return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)


def png_bytes(size: int | None = None, shade: int = 0) -> bytes:
    raw = b"".join(b"\x00" + bytes([shade % 256, 96, 64]) * 2 for _ in range(2))
    head = PNG_SIGNATURE + _chunk(b"IHDR", struct.pack(">IIBBBBB", 2, 2, 8, 2, 0, 0, 0)) + _chunk(b"IDAT", zlib.compress(raw))
    tail = _chunk(b"IEND", b"")
    if size is None:
        return head + tail
    filler = size - len(head) - len(tail) - 12 - 4
    return head + _chunk(b"tEXt", b"pad\x00" + b"x" * filler) + tail


def jpeg_bytes() -> bytes:
    return JPEG_HEAD + JPEG_TAIL


def glb_bytes(size: int | None = None) -> bytes:
    document = b'{"asset":{"version":"2.0"}}'
    total = 12 + 8 + len(document)
    pad = (4 - len(document) % 4) % 4 if size is None else size - total
    document += b" " * pad
    total = 12 + 8 + len(document)
    return b"glTF" + struct.pack("<II", 2, total) + struct.pack("<I", len(document)) + b"JSON" + document


def upload(api: Api, lesson_id: str, files: list[tuple[str, bytes]]) -> httpx.Response:
    parts = [("files", (name, data, "application/octet-stream")) for name, data in files]
    return api.post(f"/api/lessons/{lesson_id}/files", files=parts)


def lesson_keys(lesson_id: str) -> list[str]:
    return S3().keys(f"lessons/{lesson_id}/")


def teacher_with_lesson(base: str, title: str = "Week 3: At the restaurant") -> tuple[Api, str, str]:
    api, _ = sign_up(base)
    class_id = ok(api.post("/api/classes", {"title": "Evening Spanish B1", "timeZone": "America/Chicago"}), 201)["id"]
    lesson_id = ok(api.post(f"/api/classes/{class_id}/lessons", {"title": title}), 201)["id"]
    return api, class_id, lesson_id


@contextmanager
def visit(browser: Browser, base: str, api: Api | None, path: str, *, size: tuple[int, int] = DESKTOP,
          record: list[str] | None = None, **options: Any) -> Iterator[Page]:
    base = base.rstrip("/")
    with open_app(browser, base + "/join", **options) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if record is not None:
            page.on("request", lambda request: record.append(request.url))
        if api is not None and api.cookie:
            page.context.add_cookies([{"name": SESSION_COOKIE, "value": api.cookie, "url": base}])
        page.goto(base + path)
        yield page


def room(page: Page) -> Locator:
    return page.get_by_role("region", name="Classroom")


def seat(page: Page, seat_id: str) -> Locator:
    return room(page).locator(f'[data-seat-id="{seat_id}"]')


def table_item(page: Page, table_id: str) -> Locator:
    return room(page).locator(f'[data-table-id="{table_id}"]')


def board(page: Page) -> Locator:
    return room(page).locator("[data-board]")


def announcements(page: Page) -> Locator:
    return page.get_by_role("status", name="Class announcements")


def exactly(text: str) -> re.Pattern[str]:
    return re.compile(rf"^\s*{re.escape(text)}\s*$")


def option_box(dialog: Locator, number: int) -> Locator:
    return dialog.get_by_role("textbox", name=f"Option {number}")


def fill_option(dialog: Locator, number: int, value: str) -> None:
    box = option_box(dialog, number)
    for _ in range(6):
        if box.count() > 0:
            break
        dialog.get_by_role("button", name="Add option").click()
    box.fill(value)


def announced(page: Page, text: str, timeout: float = LIVE_MS) -> None:
    expect(announcements(page).get_by_role("paragraph").filter(has_text=exactly(text)).last).to_be_attached(timeout=timeout)


def alert_says(scope: Page | Locator, text: str, timeout: float = LOAD_MS) -> None:
    expect(scope.get_by_role("alert").filter(has_text=exactly(text)).first).to_be_visible(timeout=timeout)


def page_status(page: Page, text: str) -> None:
    expect(page.get_by_role("status", name="Page status")).to_have_text(exactly(text), timeout=LOAD_MS)


def fetched(page: Page, requests: list[str], path: str) -> bool:
    page.evaluate("() => document.readyState")
    return any(path in url for url in requests)


def wait_mirror(page: Page, seats: int, timeout: float = LOAD_MS) -> None:
    expect(room(page).get_by_role("list", name="Seats").get_by_role("listitem")).to_have_count(seats, timeout=timeout)


def hand_button(page: Page) -> Locator:
    return page.get_by_role("region", name="Hands").get_by_role("button", name=re.compile(r"^(Raise|Lower) hand$"))


def stays(locator: Locator, attribute: str, value: str, ms: float) -> None:
    deadline = time.monotonic() + ms / 1000
    while time.monotonic() < deadline:
        assert locator.get_attribute(attribute) == value, f"{attribute} moved off {value!r} while the page was frozen"


def me_id(page: Page, base: str) -> str:
    return page.request.get(base.rstrip("/") + "/api/me").json()["id"]


def fetch_bytes(page: Page, src: str) -> bytes:
    return page.request.get(urljoin(page.url, src)).body()


def gone(locator: Locator, viewport_height: int) -> bool:
    if locator.count() == 0 or not locator.first.is_visible():
        return True
    box = locator.first.bounding_box()
    return box is None or box["y"] >= viewport_height - 1


def test_teacher_accounts(app_url: str) -> None:
    email = fresh_email("ana")
    api = Api(app_url)
    response = api.post("/api/teachers", {"email": email, "password": TEACHER_PASSWORD, "displayName": "Ana Reyes"})
    body = ok(response, 201)
    assert body["email"].lower() == email.lower() and body["displayName"] == "Ana Reyes" and body["id"]
    cookie_header = " ".join(response.headers.get_list("set-cookie")).lower()
    attrs = {k.strip(): v.strip() for k, _, v in (part.partition("=") for part in cookie_header.split(";"))}
    assert f"{SESSION_COOKIE}=" in cookie_header and "HttpOnly".lower() in attrs
    assert attrs.get("SameSite".lower()) == "Lax".lower() and attrs.get("path") == "/"
    for base in (app_url, SECOND_URL):
        me = ok(api.on(base).get("/api/me"), 200)
        assert me["role"] == "teacher" and me["id"] == body["id"] and me["displayName"] == "Ana Reyes"

    refused(Api(app_url).post("/api/teachers", {"email": email.upper(), "password": TEACHER_PASSWORD, "displayName": "Ana Reyes"}),
            409, "An account with that email already exists.")
    bad_cases = [
        ({"email": "not-an-email", "password": "short", "displayName": ""}, "Enter a valid email address."),
        ({"email": fresh_email("b"), "password": "x" * (PASSWORD_MIN - 1), "displayName": ""}, "Use at least 10 characters for your password."),
        ({"email": fresh_email("c"), "password": TEACHER_PASSWORD, "displayName": ""}, "Enter a name of 1 to 60 characters."),
        ({"email": fresh_email("d"), "password": TEACHER_PASSWORD, "displayName": "x" * (TEACHER_NAME_MAX + 1)}, "Enter a name of 1 to 60 characters."),
    ]
    for payload, text in bad_cases:
        refused(Api(app_url).post("/api/teachers", payload), 422, text)
        refused(Api(app_url).post("/api/sign-in", {"email": payload["email"], "password": payload["password"]}), 401, "Email or password is wrong.")
    edge = Api(app_url)
    ok(edge.post("/api/teachers", {"email": fresh_email("e"), "password": "x" * PASSWORD_MIN, "displayName": "x" * TEACHER_NAME_MAX}), 201)

    refused(Api(app_url).post("/api/sign-in", {"email": email, "password": TEACHER_PASSWORD + "x"}), 401, "Email or password is wrong.")
    again = Api(SECOND_URL)
    assert ok(again.post("/api/sign-in", {"email": email, "password": TEACHER_PASSWORD}), 200)["id"] == body["id"]
    assert ok(again.on(app_url).get("/api/me"), 200)["id"] == body["id"]
    ok(again.post("/api/sign-out"), 204)
    for base in (app_url, SECOND_URL):
        refused(again.on(base).get("/api/me"), 401, "Sign in first.")
    refused(Api(app_url).get("/api/me"), 401, "Sign in first.")


def test_classes_and_codes(app_url: str) -> None:
    owner, owner_email = sign_up(app_url)
    helper, helper_email = sign_up(app_url, "Ben Achebe")
    created = ok(owner.post("/api/classes", {"title": "Evening Spanish B1", "timeZone": "America/Chicago"}), 201)
    assert created["title"] == "Evening Spanish B1" and created["timeZone"] == "America/Chicago"
    assert CODE_RE.match(created["code"]), created["code"]
    assert created["layout"] == DEFAULT_LAYOUT
    codes = {created["code"]}
    for _ in range(4):
        other = ok(owner.post("/api/classes", {"title": "Contract Law Seminar", "timeZone": "Europe/London"}), 201)
        assert CODE_RE.match(other["code"])
        codes.add(other["code"])
    assert len(codes) == 5, "every class got its own code"

    listed = {c["id"]: c for c in ok(owner.get("/api/classes"), 200)["classes"]}
    assert listed[created["id"]]["role"] == "owner" and listed[created["id"]]["code"] == created["code"]
    assert created["id"] not in {c["id"] for c in ok(helper.get("/api/classes"), 200)["classes"]}

    refused(owner.post("/api/classes", {"title": "", "timeZone": "America/Chicago"}), 422, "Give the class a title of 1 to 80 characters.")
    refused(owner.post("/api/classes", {"title": "x" * (CLASS_TITLE_MAX + 1), "timeZone": "America/Chicago"}), 422, "Give the class a title of 1 to 80 characters.")
    refused(owner.post("/api/classes", {"title": "Evening Spanish B1", "timeZone": "Mars/Olympus"}), 422, "Choose a time zone from the list.")
    ok(owner.post("/api/classes", {"title": "x" * CLASS_TITLE_MAX, "timeZone": "Europe/London"}), 201)

    path = f"/api/classes/{created['id']}/co-teachers"
    added = ok(owner.post(path, {"email": helper_email}), 201)
    assert added["email"].lower() == helper_email.lower() and added["displayName"] == "Ben Achebe" and added["id"]
    assert ok(owner.post(path, {"email": helper_email}), 200) == added
    refused(owner.post(path, {"email": fresh_email("nobody")}), 422, "No teacher has that email.")
    refused(owner.post(path, {"email": owner_email}), 422, "You already own this class.")
    detail = ok(owner.get(f"/api/classes/{created['id']}"), 200)
    assert [c["id"] for c in detail["coTeachers"]] == [added["id"]]
    helper_list = {c["id"]: c for c in ok(helper.get("/api/classes"), 200)["classes"]}
    assert helper_list[created["id"]]["role"] == "co-teacher"


B0 = {"kind": "board", "column": 2, "row": 0}
LAYOUT_CASES: dict[str, Any] = {
    "grid_too_narrow": ({"columns": 3, "rows": 6, "pieces": [{"kind": "board", "column": 0, "row": 0}]}, 422, "A room is 4 to 12 columns by 3 to 10 rows."),
    "grid_too_tall": ({"columns": 8, "rows": 11, "pieces": [B0]}, 422, "A room is 4 to 12 columns by 3 to 10 rows."),
    "unknown_kind": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "sofa", "column": 1, "row": 2}]}, 422, "Piece 2 isn't a board, table or seat."),
    "kind_before_outside": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "sofa", "column": 40, "row": 2}]}, 422, "Piece 2 isn't a board, table or seat."),
    "seat_outside": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "seat", "column": 8, "row": 2}]}, 422, "Piece 2 is outside the room."),
    "board_overhang": ({"columns": 8, "rows": 6, "pieces": [{"kind": "board", "column": 5, "row": 0}]}, 422, "Piece 1 is outside the room."),
    "board_off_wall": ({"columns": 8, "rows": 6, "pieces": [{"kind": "board", "column": 2, "row": 1}]}, 422, "The board must sit on the front wall."),
    "seat_on_wall": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "seat", "column": 0, "row": 0}]}, 422, "Seats and tables can't go on the front wall."),
    "overlap_earliest": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "seat", "column": 0, "row": 2}, {"kind": "table", "column": 1, "row": 2}, {"kind": "seat", "column": 0, "row": 2}]}, 422, "Piece 4 overlaps piece 2."),
    "board_overlap": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "board", "column": 3, "row": 0}]}, 422, "Piece 2 overlaps piece 1."),
    "first_failure_wins": ({"columns": 8, "rows": 6, "pieces": [B0, {"kind": "seat", "column": 8, "row": 2}, {"kind": "sofa", "column": 1, "row": 2}]}, 422, "Piece 2 is outside the room."),
    "no_board": ({"columns": 8, "rows": 6, "pieces": [{"kind": "seat", "column": 0, "row": 2}]}, 422, "A classroom needs exactly one board."),
    "two_boards": ({"columns": 12, "rows": 6, "pieces": [{"kind": "board", "column": 0, "row": 0}, {"kind": "board", "column": 6, "row": 0}]}, 422, "A classroom needs exactly one board."),
    "ids_and_tables": ({"columns": 12, "rows": 6, "pieces": [
        {"kind": "board", "column": 0, "row": 0}, {"kind": "table", "column": 1, "row": 2}, {"kind": "table", "column": 3, "row": 2},
        {"kind": "seat", "column": 2, "row": 2}, {"kind": "seat", "column": 0, "row": 2}, {"kind": "seat", "column": 9, "row": 2},
        {"kind": "seat", "column": 1, "row": 3}]}, 200,
        {"seats": {"B3": "T1", "B1": "T1", "B10": None, "C2": None}, "tables": {"T1": (2, 1), "T2": (2, 3)}}),
    "reference": (SPANISH_LAYOUT, 200, {"seats": {"B1": "T1", "B3": "T1", "B5": "T2", "B7": "T2", "D1": "T3", "D3": "T3", "E8": None},
                                       "tables": {"T1": (2, 1), "T2": (2, 5), "T3": (4, 1)}}),
    "live_session": (SPANISH_LAYOUT, 409, "The room can't change during a live session."),
}


def pieces(layout_json: dict[str, Any]) -> list[tuple[Any, Any, Any]]:
    return [(p["kind"], p["column"], p["row"]) for p in layout_json["pieces"]]


LAYOUT_CASE_IDS = ["grid_too_narrow", "grid_too_tall", "unknown_kind", "kind_before_outside", "seat_outside", "board_overhang",
                   "board_off_wall", "seat_on_wall", "overlap_earliest", "board_overlap", "first_failure_wins", "no_board",
                   "two_boards", "ids_and_tables", "reference", "live_session"]


@pytest.mark.parametrize("case_id", LAYOUT_CASE_IDS, ids=LAYOUT_CASE_IDS)
def test_layout_rules(app_url: str, case_id: str) -> None:
    layout_json, status, expected = LAYOUT_CASES[case_id]
    if case_id == "live_session":
        world = setup_world(app_url, reference_world())
        api, class_id = world.api("ana"), world.cls("spanish")
    else:
        api, _ = sign_up(app_url)
        class_id = ok(api.post("/api/classes", {"title": "Evening Spanish B1", "timeZone": "America/Chicago"}), 201)["id"]
    before = ok(api.get(f"/api/classes/{class_id}"), 200)
    response = api.put(f"/api/classes/{class_id}/layout", layout_json)
    after = ok(api.get(f"/api/classes/{class_id}"), 200)
    if status != 200:
        refused(response, status, expected)
        assert after["layout"] == before["layout"], "a refused save changed the stored room"
        return
    body = ok(response, 200)
    for answer in (body, after):
        assert answer["layout"]["columns"] == layout_json["columns"] and answer["layout"]["rows"] == layout_json["rows"]
        assert pieces(answer["layout"]) == pieces(layout_json)
        assert {s["seatId"]: s["table"] for s in answer["seats"]} == expected["seats"]
        assert {t["tableId"]: (t["row"], t["column"]) for t in answer["tables"]} == expected["tables"]


def test_wf_arranging_classroom_keyboard(browser: Browser, app_url: str) -> None:
    email = fresh_email("ana")
    with open_app(browser, app_url.rstrip("/") + "/sign-up") as page:
        page.set_viewport_size({"width": DESKTOP[0], "height": DESKTOP[1]})
        expect(page.get_by_role("heading", name="Create your teacher account")).to_be_visible(timeout=LOAD_MS)
        page.get_by_role("textbox", name="Email").fill(email)
        page.get_by_role("textbox", name="Password").fill(TEACHER_PASSWORD)
        page.get_by_role("textbox", name="Your name").fill("Ana Reyes")
        page.get_by_role("button", name="Create account").click()
        expect(page.get_by_role("heading", name="Your classes")).to_be_visible(timeout=LOAD_MS)
        page.reload()
        expect(page.get_by_role("heading", name="Your classes")).to_be_visible(timeout=LOAD_MS)

        page.get_by_role("button", name="New class").click()
        dialog = page.get_by_role("dialog", name="New class")
        expect(dialog.get_by_role("textbox", name="Title")).to_be_focused(timeout=LOAD_MS)
        dialog.get_by_role("textbox", name="Title").fill("Evening Spanish B1")
        select(dialog.get_by_role("combobox", name="Time zone"), "America/Chicago")
        dialog.get_by_role("button", name="Create class").click()
        expect(page.get_by_role("heading", name="Evening Spanish B1")).to_be_visible(timeout=LOAD_MS)
        class_id = re.search(r"/classes/([^/?#]+)", page.url).group(1)

        page.get_by_role("region", name="Room").get_by_role("link", name="Edit room").click()
        expect(page.get_by_role("heading", name="Arrange the room")).to_be_visible(timeout=LOAD_MS)
        page.get_by_role("spinbutton", name="Columns").focus()
        names = tab_order(page, 4)
        assert names[0] == "Rows" and names[3] == "Save room", f"room editor tab order was {names}"

        def cell(column: int, row: int) -> Locator:
            return page.get_by_role("gridcell", name=f"Cell {column},{row}")

        seat_radio = page.get_by_role("radio", name="Seat")
        seat_radio.focus()
        page.keyboard.press("Space")
        expect(seat_radio).to_be_checked()
        expect(cell(0, 0)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Tab")
        for key in ("ArrowUp", "ArrowLeft"):
            page.keyboard.press(key)
            expect(cell(0, 0)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("ArrowDown")
        page.keyboard.press("ArrowDown")
        expect(cell(0, 2)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Enter")
        expect(cell(0, 2)).to_have_attribute("data-piece", "seat")
        page.keyboard.press("ArrowRight")
        expect(cell(1, 2)).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Shift+Tab")
        page.keyboard.press("ArrowUp")
        expect(page.get_by_role("radio", name="Table")).to_be_checked()
        page.keyboard.press("Tab")
        page.keyboard.press("Enter")
        expect(cell(1, 2)).to_have_attribute("data-piece", "table")
        page.keyboard.press("ArrowRight")
        page.keyboard.press("Enter")
        expect(cell(2, 2)).to_have_attribute("data-piece", "table")
        page.keyboard.press("Delete")
        expect(cell(2, 2)).to_have_attribute("data-piece", "")
        page.keyboard.press("Enter")
        expect(cell(2, 2)).to_have_attribute("data-piece", "table")
        page.keyboard.press("Backspace")
        expect(cell(2, 2)).to_have_attribute("data-piece", "")
        page.keyboard.press("Tab")
        expect(page.get_by_role("button", name="Save room")).to_be_focused()
        page.keyboard.press("Enter")
        page_status(page, "Room saved.")

        api = Api(app_url)
        ok(api.post("/api/sign-in", {"email": email, "password": TEACHER_PASSWORD}), 200)
        detail = ok(api.get(f"/api/classes/{class_id}"), 200)
        assert [(s["seatId"], s["table"]) for s in detail["seats"]] == [("B1", "T1")]
        assert [(t["tableId"], t["row"], t["column"]) for t in detail["tables"]] == [("T1", 2, 1)]

        page.goto(app_url.rstrip("/") + "/classes")
        classes = page.get_by_role("list", name="Classes")
        expect(classes.get_by_role("link", name="Evening Spanish B1")).to_be_visible(timeout=LOAD_MS)
        expect(classes).to_contain_text(f"Code {detail['code']}")
        expect(classes).to_contain_text("Owner")


def test_wf_arranging_classroom_saved_room_cursor(browser: Browser, app_url: str) -> None:
    spec = reference_world()
    spec["sessions"].append({"key": "lawnext", "class": "law", "lesson": "week1", "startsAt": "2027-03-15T18:30",
                             "endsAt": "2027-03-15T20:00", "state": "scheduled", "currentSlide": 1, "locked": False})
    world = setup_world(app_url, spec)
    clara, sid = world.api("clara"), world.ses("lawnext")
    free_cell = "Cell 4,2"
    with visit(browser, app_url, clara, f"/classes/{world.cls('law')}") as page:
        page.get_by_role("region", name="Room").get_by_role("link", name="Edit room").click()
        expect(page.get_by_role("heading", name="Arrange the room")).to_be_visible(timeout=LOAD_MS)
        page.get_by_role("radio", name="Seat").click()
        page.get_by_role("gridcell", name=free_cell).click()
        expect(page.get_by_role("gridcell", name=free_cell)).to_have_attribute("data-piece", "seat")
        page.get_by_role("button", name="Save room").click()
        page_status(page, "Room saved.")
        assert [s["seatId"] for s in ok(clara.get(f"/api/classes/{world.cls('law')}"), 200)["seats"]] == ["B1", "B3", "B5"]

        ok(clara.post(f"/api/sessions/{sid}/open"), 200)
        newcomer = Api(app_url)
        newcomer_id = ok(newcomer.post("/api/join", {"code": world.code("law"), "displayName": "Noor Aziz"}), 201)["learnerId"]
        ok(newcomer.post(f"/api/sessions/{sid}/seat", {"seatId": "B1"}), 200)
        ok(clara.post(f"/api/sessions/{sid}/start"), 200)

        page.goto(app_url.rstrip("/") + f"/sessions/{sid}")
        wait_mirror(page, 3)
        expect(seat(page, "B1")).to_have_attribute("data-occupant", newcomer_id, timeout=LIVE_MS)
        expect(seat(page, "B1")).to_have_attribute("data-selected", "true")
        page.get_by_role("button", name="Take next hand").focus()
        for expected in ("B3", "B5", "B5"):
            page.keyboard.press("ArrowRight")
            expect(seat(page, expected)).to_have_attribute("data-selected", "true")
        expect(room(page).locator('[data-selected="true"]')).to_have_count(1)


def test_wf_arranging_classroom_refusal(browser: Browser, app_url: str) -> None:
    api, _ = sign_up(app_url)
    class_id = ok(api.post("/api/classes", {"title": "Evening Spanish B1", "timeZone": "America/Chicago"}), 201)["id"]
    with visit(browser, app_url, api, f"/classes/{class_id}/room") as page:
        expect(page.get_by_role("heading", name="Arrange the room")).to_be_visible(timeout=LOAD_MS)
        columns = page.get_by_role("spinbutton", name="Columns")
        def cell(column: int, row: int) -> Locator:
            return page.get_by_role("gridcell", name=f"Cell {column},{row}")

        columns.fill("4")
        columns.blur()
        expect(cell(3, 0)).to_be_visible()
        expect(cell(4, 0)).to_have_count(0)
        expect(cell(2, 0)).to_have_attribute("data-piece", "board")
        page.get_by_role("button", name="Save room").click()
        alert_says(page, "Piece 1 is outside the room.")
        expect(cell(2, 0)).to_have_attribute("data-piece", "board")
        assert ok(api.get(f"/api/classes/{class_id}"), 200)["layout"] == DEFAULT_LAYOUT

        columns.fill("8")
        columns.blur()
        page.get_by_role("radio", name="Seat").click()
        cell(4, 3).click()
        expect(cell(4, 3)).to_have_attribute("data-piece", "seat")
        page.get_by_role("button", name="Save room").click()
        page_status(page, "Room saved.")
    detail = ok(api.get(f"/api/classes/{class_id}"), 200)
    assert [s["seatId"] for s in detail["seats"]] == ["C5"]


def join_world() -> dict[str, Any]:
    world = reference_world()
    for key, title in (("drop", "Drop-in Clinic"), ("shut", "Closed Workshop"), ("busy", "Busy Seminar")):
        world["classes"].append({"key": key, "teacher": "ana", "coTeachers": [], "title": title, "timeZone": "America/Chicago", "layout": SPANISH_LAYOUT})
        world["lessons"].append({"key": f"{key}1", "class": key, "title": "Week 3: At the restaurant", "slideCount": 1, "modelCount": 0})
    world["sessions"] += [
        {"key": "dropin", "class": "drop", "lesson": "drop1", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30", "state": "open", "currentSlide": 1, "locked": False},
        {"key": "shutlive", "class": "shut", "lesson": "shut1", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30", "state": "live", "currentSlide": 1, "locked": True},
        {"key": "busylive", "class": "busy", "lesson": "busy1", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30", "state": "live", "currentSlide": 1, "locked": False},
    ]
    for key, seat_id in (("busy_a", "B1"), ("busy_b", "B3")):
        world["learners"].append({"key": key, "displayName": NAMES["rosa"], "session": "busylive", "seat": seat_id,
                                  "presence": [{"joinedAt": "2027-03-09T18:55:00-06:00", "leftAt": None}]})
    world["breakouts"] = [{"session": "busylive", "tables": 2}]
    return world


def test_join_rules(app_url: str) -> None:
    world = setup_world(app_url, join_world())
    code = world.code("spanish")
    messy = f" {code[:3].lower()} {code[3:].lower()} "
    learner = Api(app_url)
    first = ok(learner.post("/api/join", {"code": messy, "displayName": "Mira Okafor"}), 201)
    assert first["sessionId"] == world.ses("tue") and first["learnerId"] and learner.cookie
    assert ok(learner.post("/api/join", {"code": code, "displayName": "Mira Okafor"}), 200) == first
    me = ok(learner.on(SECOND_URL).get("/api/me"), 200)
    assert me == {"role": "learner", "id": first["learnerId"], "displayName": "Mira Okafor"} or (
        me["role"] == "learner" and me["id"] == first["learnerId"] and me["displayName"] == "Mira Okafor")
    assert snapshot(learner, world.ses("tue"))["you"] == {"role": "learner", "learnerId": first["learnerId"]}

    other = ok(learner.post("/api/join", {"code": world.code("drop"), "displayName": "Someone Else"}), 201)
    assert other["sessionId"] == world.ses("dropin") and other["learnerId"] == first["learnerId"]
    assert ok(learner.get("/api/me"), 200)["displayName"] == "Mira Okafor"

    ok(Api(app_url).post("/api/join", {"code": code, "displayName": "x" * LEARNER_NAME_MAX}), 201)
    refused(Api(app_url).post("/api/join", {"code": code, "displayName": "x" * (LEARNER_NAME_MAX + 1)}), 422, "Enter a name of 1 to 40 characters.")
    refused(Api(app_url).post("/api/join", {"code": code, "displayName": "   "}), 422, "Enter a name of 1 to 40 characters.")
    refused(Api(app_url).post("/api/join", {"code": UNKNOWN_CODE, "displayName": "Leo Brandt"}), 404, "Not found.")
    refused(Api(app_url).post("/api/join", {"code": UNKNOWN_CODE, "displayName": ""}), 404, "Not found.")
    refused(Api(app_url).post("/api/join", {"code": world.code("law"), "displayName": "Leo Brandt"}), 409, "This class isn't open right now.")
    refused(Api(app_url).post("/api/join", {"code": world.code("shut"), "displayName": "Leo Brandt"}), 409, "This class is locked. Ask your teacher to let you in.")
    assert ok(Api(app_url).post("/api/join", {"code": world.code("busy"), "displayName": "Leo Brandt"}), 201)["sessionId"] == world.ses("busylive")
    assert ok(Api(SECOND_URL).post("/api/join", {"code": world.code("drop"), "displayName": "Leo Brandt"}), 201)["sessionId"] == world.ses("dropin")


def test_wf_joining_and_seating_closed_class(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    with open_app(browser, SECOND_URL + "/join") as page:
        expect(page.get_by_role("heading", name="Join a class")).to_be_visible(timeout=LOAD_MS)

        def attempt(code: str, name: str) -> None:
            page.get_by_role("textbox", name="Class code").fill(code)
            page.get_by_role("textbox", name="Your name").fill(name)
            page.get_by_role("button", name="Join").click()

        attempt(UNKNOWN_CODE, "Leo Brandt")
        alert_says(page, "That code doesn't match a class.")
        attempt(world.code("law"), "Leo Brandt")
        alert_says(page, "This class isn't open right now.")
        attempt(world.code("spanish"), "   ")
        alert_says(page, "Enter a name of 1 to 40 characters.")
        ok(world.api("ana").post(f"/api/sessions/{world.ses('tue')}/end"), 200)
        attempt(world.code("spanish"), "Leo Brandt")
        alert_says(page, "This class isn't open right now.")
        assert "/sessions/" not in page.url
    refused(Api(app_url).post("/api/join", {"code": world.code("spanish"), "displayName": "Leo Brandt"}), 409, "This class isn't open right now.")


def test_wf_joining_and_seating_keyboard_seat(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher, \
            open_app(browser, SECOND_URL + "/join") as learner:
        wait_mirror(teacher, 7)
        learner.get_by_role("textbox", name="Class code").fill(world.code("spanish").lower())
        learner.get_by_role("textbox", name="Your name").fill("Ines Duarte")
        learner.get_by_role("button", name="Join").click()
        expect(learner.get_by_role("heading", name="Evening Spanish B1")).to_be_visible(timeout=LOAD_MS)
        wait_mirror(learner, 7)
        learner_id = me_id(learner, SECOND_URL)
        expect(seat(learner, "B1")).to_have_attribute("data-selected", "true")
        hand_button(learner).focus()
        for key, expected in (("ArrowRight", "B3"), ("ArrowDown", "D3")):
            learner.keyboard.press(key)
            expect(seat(learner, expected)).to_have_attribute("data-selected", "true")
        learner.keyboard.press("Enter")
        expect(seat(learner, "D3")).to_have_attribute("data-occupant", learner_id, timeout=LOAD_MS)
        expect(seat(teacher, "D3")).to_have_attribute("data-occupant-name", "Ines Duarte", timeout=LIVE_MS)
        assert valkey.hash(f"sh:{sid}:seats").get("D3") == learner_id

        hand_button(learner).focus()
        for key, expected in (("ArrowUp", "B3"), ("ArrowRight", "B5"), ("ArrowRight", "B7"), ("ArrowDown", "E8")):
            learner.keyboard.press(key)
            expect(seat(learner, expected)).to_have_attribute("data-selected", "true")
        learner.keyboard.press("Enter")
        expect(seat(learner, "E8")).to_have_attribute("data-occupant", learner_id, timeout=LOAD_MS)
        expect(seat(teacher, "E8")).to_have_attribute("data-occupant-name", "Ines Duarte", timeout=LIVE_MS)
        expect(seat(teacher, "D3")).to_have_attribute("data-occupant", "", timeout=LIVE_MS)
        seats = valkey.hash(f"sh:{sid}:seats")
        assert seats.get("E8") == learner_id and "D3" not in seats or seats.get("D3") in ("", None)
        assert valkey.hash(f"sh:{sid}:seat-of").get(learner_id) == "E8"


def test_classroom_keyboard_shortcuts(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    ana, mira = world.api("ana"), world.api("mira")
    mira_id = world.lrn("mira")
    with visit(browser, app_url, ana, f"/sessions/{sid}") as teacher:
        wait_mirror(teacher, 7)
        expect(seat(teacher, "B1")).to_have_attribute("data-selected", "true")
        teacher.get_by_role("button", name="Take next hand").focus()
        teacher.keyboard.press("s")
        poll_until(lambda: spot(snapshot(ana, sid)) == mira_id, "S spotlights the learner in the teacher's cursor seat", API_WAIT_S)
        expect(seat(teacher, "B1")).to_have_attribute("data-spotlit", "true", timeout=LIVE_MS)

    with visit(browser, app_url, mira, f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        expect(seat(page, "B1")).to_have_attribute("data-selected", "true")
        hand_button(page).focus()
        path = [("ArrowLeft", "B1"), ("ArrowUp", "B1"), ("ArrowRight", "B3"), ("ArrowDown", "D3"), ("ArrowUp", "B3"),
                ("ArrowRight", "B5"), ("ArrowRight", "B7"), ("ArrowDown", "E8"), ("ArrowRight", "E8"), ("ArrowUp", "B7"), ("ArrowDown", "E8")]
        for key, expected in path:
            page.keyboard.press(key)
            expect(seat(page, expected)).to_have_attribute("data-selected", "true")
        expect(room(page).locator('[data-selected="true"]')).to_have_count(1)

        hand_button(page).focus()
        page.keyboard.press("h")
        poll_until(lambda: hand_ids(snapshot(ana, sid))[-1:] == [mira_id], "H raised the learner's hand", API_WAIT_S)
        expect(page.get_by_role("region", name="Hands").get_by_role("button", name="Lower hand")).to_be_visible(timeout=LIVE_MS)
        hand_button(page).focus()
        page.keyboard.press("h")
        poll_until(lambda: mira_id not in hand_ids(snapshot(ana, sid)), "H lowered the learner's hand", API_WAIT_S)
        hand_button(page).focus()
        page.keyboard.press("2")
        poll_until(lambda: snapshot(mira, sid)["poll"]["yourAnswer"] == 2, "2 answered the open poll with option 2", API_WAIT_S)
        hand_button(page).focus()
        page.keyboard.press("Enter")
        poll_until(lambda: seat_of(snapshot(ana, sid), mira_id) == "E8", "Enter took the cursor's seat", API_WAIT_S)
        expect(seat(page, "E8")).to_have_attribute("data-occupant", mira_id, timeout=LIVE_MS)

        ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
        expect(seat(page, "E8")).to_have_attribute("data-breakout-table", "T1", timeout=LIVE_MS)
        hand_button(page).focus()
        opener = page.evaluate_handle("() => document.activeElement")
        page.keyboard.press("c")
        message_box = page.get_by_role("textbox", name="Message your table")
        expect(message_box).to_be_focused(timeout=LIVE_MS)
        before = snapshot(ana, sid)
        page.keyboard.type("h1")
        page.keyboard.press("ArrowLeft")
        after = snapshot(mira, sid)
        assert hand_ids(snapshot(ana, sid)) == hand_ids(before), "H typed in the chat field changed the hand queue"
        assert after["poll"]["yourAnswer"] == 2, "a digit typed in the chat field answered the poll"
        expect(seat(page, "E8")).to_have_attribute("data-selected", "true")
        message_box.fill(CHAT_HELLO)
        page.keyboard.press("Enter")
        poll_until(lambda: any(m["text"] == CHAT_HELLO for m in ok(ana.get(f"/api/sessions/{sid}/tables/T1/chat"), 200)["messages"]),
                   "Enter in the chat field posted to the learner's table", API_WAIT_S)
        expect(page.get_by_role("log", name="Table messages")).to_contain_text(CHAT_HELLO, timeout=LIVE_MS)
        page.keyboard.press("Escape")
        assert page.evaluate("el => document.activeElement === el", opener), "Escape did not return focus to the control used before C"


def seat_race_world(extra: int) -> dict[str, Any]:
    world = reference_world()
    for index in range(extra):
        world["learners"].append({"key": f"n{index}", "displayName": f"Racer {index}", "session": "tue", "seat": None,
                                  "presence": [{"joinedAt": "2027-03-09T19:00:00-06:00", "leftAt": None}]})
    return world


def test_seat_claims_race(app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, seat_race_world(6))
    sid = world.ses("tue")
    racers = [world.api(f"n{i}", app_url if i % 2 == 0 else SECOND_URL) for i in range(6)]
    first = racers[0]
    both = race([lambda: first.post(f"/api/sessions/{sid}/seat", {"seatId": "D3"}),
                 lambda: first.on(SECOND_URL).post(f"/api/sessions/{sid}/seat", {"seatId": "E8"})])
    assert all(r.status_code in (200, 409) for r in both)
    seats = valkey.hash(f"sh:{sid}:seats")
    held_by_first = [s for s, learner in seats.items() if learner == world.lrn("n0")]
    assert len(held_by_first) == 1, f"one learner holds {held_by_first}"
    free = "E8" if held_by_first == ["D3"] else "D3"

    responses = race([lambda api=api: api.post(f"/api/sessions/{sid}/seat", {"seatId": free}) for api in racers[1:]])
    winners = [i + 1 for i, r in enumerate(responses) if r.status_code == 200]
    assert len(winners) == 1, f"{len(winners)} claims on {free} won; expected exactly one"
    for i, response in enumerate(responses):
        if i + 1 not in winners:
            refused(response, 409, f"Seat {free} was just taken. Pick another seat.")
    winner_id = world.lrn(f"n{winners[0]}")
    seat_of_hash = valkey.hash(f"sh:{sid}:seat-of")
    assert valkey.hash(f"sh:{sid}:seats")[free] == winner_id and seat_of_hash[winner_id] == free
    for i in range(1, 6):
        if i not in winners:
            assert world.lrn(f"n{i}") not in seat_of_hash
    assert occupant(snapshot(world.api("ana", SECOND_URL), sid), free) == winner_id
    values = list(valkey.hash(f"sh:{sid}:seats").values())
    assert len(values) == len(set(v for v in values if v)) + values.count("")

    winner = racers[winners[0] - 1] if False else world.api(f"n{winners[0]}")
    ok(winner.post(f"/api/sessions/{sid}/seat", {"seatId": free}), 200)
    assert valkey.hash(f"sh:{sid}:seat-of")[winner_id] == free
    refused(winner.post(f"/api/sessions/{sid}/seat", {"seatId": "Z9"}), 422, "No such seat.")
    ok(winner.delete(f"/api/sessions/{sid}/seat"), 200)
    assert occupant(snapshot(world.api("ana"), sid), free) is None
    mira = world.api("mira")
    ok(mira.post(f"/api/sessions/{sid}/seat", {"seatId": free}), 200)
    after = snapshot(world.api("ana"), sid)
    assert occupant(after, free) == world.lrn("mira") and occupant(after, "B1") is None
    assert valkey.hash(f"sh:{sid}:seat-of")[world.lrn("mira")] == free


def test_wf_seat_race_move_seat(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("mira"), f"/sessions/{sid}") as mira, \
            visit(browser, SECOND_URL, world.api("jonas", SECOND_URL), f"/sessions/{sid}") as jonas:
        wait_mirror(mira, 7)
        wait_mirror(jonas, 7)
        hand_button(mira).focus()
        for key, expected in (("ArrowDown", "D1"), ("ArrowRight", "D3")):
            mira.keyboard.press(key)
            expect(seat(mira, expected)).to_have_attribute("data-selected", "true")
        mira.keyboard.press("Enter")
        expect(seat(mira, "D3")).to_have_attribute("data-occupant-name", "Mira Okafor", timeout=LOAD_MS)
        expect(seat(jonas, "D3")).to_have_attribute("data-occupant-name", "Mira Okafor", timeout=LIVE_MS)
        expect(seat(jonas, "B1")).to_have_attribute("data-occupant", "", timeout=LIVE_MS)
    assert valkey.hash(f"sh:{sid}:seat-of")[world.lrn("mira")] == "D3"
    assert valkey.hash(f"sh:{sid}:seats").get("B1", "") == ""


def test_wf_seat_race_lost_claim(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    leo_id, hana_id = world.lrn("leo"), world.lrn("hana")
    with visit(browser, SECOND_URL, world.api("leo", SECOND_URL), f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        hand_button(page).focus()
        for key, expected in (("ArrowRight", "B3"), ("ArrowRight", "B5"), ("ArrowRight", "B7"), ("ArrowDown", "E8")):
            page.keyboard.press(key)
            expect(seat(page, expected)).to_have_attribute("data-selected", "true")
        page.keyboard.press("Enter")
        expect(seat(page, "E8")).to_have_attribute("data-occupant", leo_id, timeout=LOAD_MS)
        hand_button(page).focus()
        for key, expected in (("ArrowUp", "B7"), ("ArrowLeft", "B5"), ("ArrowLeft", "B3"), ("ArrowDown", "D3")):
            page.keyboard.press(key)
            expect(seat(page, expected)).to_have_attribute("data-selected", "true")
        with held(page, "**/api/sessions/*/seat") as gate:
            page.keyboard.press("Enter")
            ok(world.api("hana").post(f"/api/sessions/{sid}/seat", {"seatId": "D3"}), 200)
            gate.release()
        announced(page, "Seat D3 was just taken. Pick another seat.", timeout=LOAD_MS)
        expect(seat(page, "D3")).to_have_attribute("data-occupant-name", "Hana Sato", timeout=LIVE_MS)
        expect(seat(page, "E8")).to_have_attribute("data-occupant", leo_id)
    assert valkey.hash(f"sh:{sid}:seat-of")[leo_id] == "E8"
    assert valkey.hash(f"sh:{sid}:seats")["D3"] == hana_id


def test_session_lifecycle(app_url: str, valkey: Valkey) -> None:
    world = reference_world()
    world["sessions"] = [
        {"key": "s1", "class": "spanish", "lesson": "week3", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30", "state": "scheduled", "currentSlide": 1, "locked": False},
        {"key": "s2", "class": "spanish", "lesson": "week3", "startsAt": "2027-03-02T19:00", "endsAt": "2027-03-02T20:30", "state": "scheduled", "currentSlide": 1, "locked": False},
        {"key": "lawmon", "class": "law", "lesson": "week1", "startsAt": "2027-03-08T18:30", "endsAt": "2027-03-08T20:00", "state": "ended", "currentSlide": 2, "locked": False},
    ]
    world["learners"] = [p for p in world["learners"] if p["key"] == "felix"]
    world["hands"], world["polls"] = [], []
    w = setup_world(app_url, world)
    ana, s1, s2 = w.api("ana"), w.ses("s1"), w.ses("s2")

    def state_409(response: httpx.Response, state: str) -> None:
        refused(response, 409, f"That can't be done while the session is {state}.")

    state_409(ana.post(f"/api/sessions/{s1}/start"), "scheduled")
    state_409(ana.post(f"/api/sessions/{s1}/end"), "scheduled")
    state_409(ana.post(f"/api/sessions/{s1}/slide", {"slide": 1}), "scheduled")
    assert ok(ana.post(f"/api/sessions/{s1}/open"), 200)["state"] == "open"
    state_409(ana.post(f"/api/sessions/{s1}/open"), "open")
    refused(ana.post(f"/api/sessions/{s2}/open"), 409, "This class already has a session running.")
    learner = Api(app_url)
    ok(learner.post("/api/join", {"code": w.code("spanish"), "displayName": "Mira Okafor"}), 201)
    assert seat_of(ok(learner.post(f"/api/sessions/{s1}/seat", {"seatId": "B1"}), 200), ok(learner.get("/api/me"), 200)["id"]) == "B1"
    state_409(learner.post(f"/api/sessions/{s1}/hand", {"raised": True}), "open")
    state_409(ana.post(f"/api/sessions/{s1}/breakouts", {"tables": 2}), "open")

    assert ok(ana.post(f"/api/sessions/{s1}/start"), 200)["state"] == "live"
    ok(ana.post(f"/api/sessions/{s1}/polls", {"question": "Which word means the bill?", "options": BILL_OPTIONS}), 201)
    assert ok(ana.post(f"/api/sessions/{s1}/breakouts", {"tables": 2}), 201)["state"] == "breakouts"
    state_409(ana.post(f"/api/sessions/{s1}/start"), "breakouts")
    state_409(ana.post(f"/api/sessions/{s1}/breakouts", {"tables": 2}), "breakouts")
    refused(learner.post(f"/api/sessions/{s1}/seat", {"seatId": "B3"}), 409, "Seats are fixed during breakouts.")
    ended = ok(ana.post(f"/api/sessions/{s1}/end"), 200)
    assert ended["state"] == "ended" and ended["breakout"] is None and ended["poll"]["state"] == "closed"
    state_409(ana.post(f"/api/sessions/{s1}/end"), "ended")
    state_409(ana.post(f"/api/sessions/{s1}/slide", {"slide": 1}), "ended")
    state_409(ana.post(f"/api/sessions/{s1}/open"), "ended")
    refused(ana.post(f"/api/sessions/{s1}/breakouts/extend"), 409, "Breakouts are over.")
    poll_until(lambda: valkey.keys(f"sh:{s1}:*") == [], f"Valkey keys sh:{s1}:* were deleted after the session ended",
               KEYS_GONE_S + POLL_SLACK_S)

    draft = ok(ana.post(f"/api/classes/{w.cls('spanish')}/lessons", {"title": "Week 1: Offer and acceptance"}), 201)
    s3 = ok(ana.post(f"/api/classes/{w.cls('spanish')}/sessions",
                     {"lessonId": draft["id"], "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30"}), 201)
    assert s3["state"] == "scheduled"
    ok(ana.post(f"/api/sessions/{s3['id']}/open"), 200)
    refused(ana.post(f"/api/sessions/{s3['id']}/start"), 409, "The lesson isn't ready to teach.")
    assert ok(ana.post(f"/api/sessions/{s3['id']}/end"), 200)["state"] == "ended"


def test_live_slide_every_instance(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, lesson_id, slides = world.ses("tue"), world.lesson("week3"), world.slides("week3")
    ana, ben = world.api("ana"), world.api("ben", SECOND_URL)
    with visit(browser, app_url, ana, f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("jonas", SECOND_URL), f"/sessions/{sid}") as learner:
        wait_mirror(teacher, 7)
        wait_mirror(learner, 7)
        snap = ok(ana.post(f"/api/sessions/{sid}/slide", {"slide": 2}), 200)
        assert snap["slide"] == {"current": 2, "total": 3, "fileId": slides[1]}
        expect(board(learner)).to_have_attribute("data-slide", "2", timeout=LIVE_MS)
        expect(board(learner)).to_contain_text("Slide 2 of 3")
        announced(learner, "Slide 2 of 3.")
        image = learner.get_by_role("img", name="Slide 2")
        expect(image).to_be_visible(timeout=LIVE_MS)
        assert fetch_bytes(learner, image.get_attribute("src")) == S3().get(f"lessons/{lesson_id}/{slides[1]}")
        assert valkey.command("GET", f"sh:{sid}:slide") == "2"

        ok(ben.post(f"/api/sessions/{sid}/slide", {"slide": 3}), 200)
        expect(board(teacher)).to_have_attribute("data-slide", "3", timeout=LIVE_MS)
        announced(teacher, "Slide 3 of 3.")
        expect(board(learner)).to_have_attribute("data-slide", "3", timeout=LIVE_MS)
    for bad in (4, 0):
        refused(ana.post(f"/api/sessions/{sid}/slide", {"slide": bad}), 422, "No such slide.")
    assert snapshot(ana, sid)["slide"]["current"] == 3


def test_wf_following_the_board_pagekeys(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("jonas", SECOND_URL), f"/sessions/{sid}") as learner:
        wait_mirror(teacher, 7)
        wait_mirror(learner, 7)
        teacher.get_by_role("button", name="Next slide").focus()
        teacher.keyboard.press("PageDown")
        expect(board(learner)).to_have_attribute("data-slide", "2", timeout=LOAD_MS)
        announced(learner, "Slide 2 of 3.")
        expect(learner.get_by_role("img", name="Slide 2")).to_be_visible()
        assert snapshot(world.api("ana"), sid)["slide"]["current"] == 2
        teacher.keyboard.press("PageUp")
        expect(board(learner)).to_have_attribute("data-slide", "1", timeout=LOAD_MS)
        announced(learner, "Slide 1 of 3.")
        expect(board(learner)).to_contain_text("Slide 1 of 3")
        assert snapshot(world.api("ana"), sid)["slide"]["current"] == 1


def test_wf_following_the_board_late_joiner(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    ok(world.api("ana").post(f"/api/sessions/{sid}/slide", {"slide": 3}), 200)
    with open_app(browser, SECOND_URL + "/join") as page:
        page.get_by_role("textbox", name="Class code").fill(world.code("spanish"))
        page.get_by_role("textbox", name="Your name").fill("Leo Brandt")
        page.get_by_role("button", name="Join").click()
        expect(board(page)).to_have_attribute("data-slide", "3", timeout=LOAD_MS)
        expect(board(page)).to_have_attribute("data-slide-total", "3")
        expect(board(page)).to_contain_text("Slide 3 of 3")
        expect(page.get_by_role("img", name="Slide 3")).to_be_visible()
        you = page.request.get(f"{SECOND_URL}/api/sessions/{sid}").json()["you"]
        assert you["role"] == "learner"


def test_wf_following_the_board_late_joiner_model(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, model_id = world.ses("tue"), world.models("week3")[0]
    ok(world.api("ana").post(f"/api/sessions/{sid}/slide", {"slide": 2}), 200)
    requests: list[str] = []
    with visit(browser, SECOND_URL, None, "/join", record=requests) as page:
        page.get_by_role("textbox", name="Class code").fill(world.code("spanish"))
        page.get_by_role("textbox", name="Your name").fill("Noor Aziz")
        page.get_by_role("button", name="Join").click()
        expect(board(page)).to_have_attribute("data-slide", "2", timeout=LOAD_MS)
        expect(board(page)).to_contain_text("Slide 2 of 3")
        expect(room(page).locator("[data-model]")).to_have_attribute("data-model-id", model_id)
        poll_until(lambda: fetched(page, requests, f"/api/files/{model_id}"),
                   "the late joiner's classroom fetched the lesson's first model", LOAD_MS / 1000)


def test_hand_queue_order(app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    lrn = world.lrn
    key = f"sh:{sid}:hands"
    assert valkey.items(key) == [lrn("priya"), lrn("jonas")]
    path = f"/api/sessions/{sid}/hand"
    ok(world.api("mira").post(path, {"raised": True}), 200)
    ok(world.api("mira").post(path, {"raised": True}), 200)
    assert valkey.items(key) == [lrn("priya"), lrn("jonas"), lrn("mira")]
    ok(world.api("priya").post(path, {"raised": False}), 200)
    ok(world.api("priya", SECOND_URL).post(path, {"raised": True}), 200)
    order = [lrn("jonas"), lrn("mira"), lrn("priya")]
    assert valkey.items(key) == order
    assert hand_ids(snapshot(world.api("ana", SECOND_URL), sid)) == order
    assert hand_ids(snapshot(world.api("ana"), sid)) == order
    refused(world.api("leo").post(path, {"raised": True}), 409, "Take a seat to raise your hand.")

    race([lambda: world.api("tomas").post(path, {"raised": True}), lambda: world.api("hana", SECOND_URL).post(path, {"raised": True})])
    queue = valkey.items(key)
    assert queue[:3] == order and sorted(queue[3:]) == sorted([lrn("tomas"), lrn("hana")])

    takes = race([lambda: world.api("ana").post(f"/api/sessions/{sid}/hands/next"),
                  lambda: world.api("ben", SECOND_URL).post(f"/api/sessions/{sid}/hands/next")])
    took = sorted(ok(r, 200)["took"]["learnerId"] for r in takes)
    assert took == sorted([lrn("jonas"), lrn("mira")]), f"concurrent takes took {took}"
    assert valkey.items(key) == queue[2:]


def test_wf_raised_hands_take_in_order(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("priya", SECOND_URL), f"/sessions/{sid}") as learner:
        wait_mirror(teacher, 7)
        wait_mirror(learner, 7)
        queue = teacher.get_by_role("list", name="Raised hands").get_by_role("listitem")
        expect(queue).to_have_text([re.compile("Priya Raman"), re.compile("Jonas Lindqvist")], timeout=LOAD_MS)
        take = teacher.get_by_role("button", name="Take next hand")
        take.focus()
        teacher.keyboard.press("t")
        announced(learner, "Priya Raman has the floor.", timeout=LOAD_MS)
        announced(teacher, "Priya Raman has the floor.")
        expect(queue).to_have_text([re.compile("Jonas Lindqvist")], timeout=LIVE_MS)
        expect(seat(learner, "B5")).to_have_attribute("data-hand", "down", timeout=LIVE_MS)
        take.click()
        announced(learner, "Jonas Lindqvist has the floor.", timeout=LOAD_MS)
        expect(teacher.get_by_role("region", name="Hands")).to_contain_text("No hands raised.", timeout=LIVE_MS)
        expect(learner.get_by_role("region", name="Hands")).to_contain_text("No hands raised.", timeout=LIVE_MS)
        teacher.get_by_role("button", name="Take next hand").focus()
        teacher.keyboard.press("t")
        announced(teacher, "No hands are raised.", timeout=LOAD_MS)
    assert valkey.items(f"sh:{sid}:hands") == []
    ok(world.api("ana").post(f"/api/sessions/{sid}/end"), 200)
    assert ok(world.api("ana").get(f"/api/sessions/{sid}/summary"), 200)["handsTaken"] == 2


def test_wf_raised_hands_learner_h(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    lrn = world.lrn
    with visit(browser, app_url, world.api("mira"), f"/sessions/{sid}") as learner, \
            visit(browser, SECOND_URL, world.api("ana", SECOND_URL), f"/sessions/{sid}") as teacher:
        wait_mirror(learner, 7)
        wait_mirror(teacher, 7)
        queue = teacher.get_by_role("list", name="Raised hands").get_by_role("listitem")
        hand_button(learner).focus()
        learner.keyboard.press("h")
        expect(queue).to_have_text([re.compile("Priya Raman"), re.compile("Jonas Lindqvist"), re.compile("Mira Okafor")], timeout=LOAD_MS)
        announced(teacher, "Mira Okafor raised a hand.")
        expect(learner.get_by_role("region", name="Hands").get_by_role("button", name="Lower hand")).to_be_visible()
        hand_button(learner).focus()
        learner.keyboard.press("h")
        expect(queue).to_have_text([re.compile("Priya Raman"), re.compile("Jonas Lindqvist")], timeout=LOAD_MS)
        assert valkey.items(f"sh:{sid}:hands") == [lrn("priya"), lrn("jonas")]
        raise_button = learner.get_by_role("region", name="Hands").get_by_role("button", name="Raise hand")
        with held(learner, "**/api/sessions/*/hand") as gate:
            raise_button.click()
            expect(raise_button).to_be_disabled()
            expect(raise_button).to_have_attribute("aria-busy", "true")
            gate.release()
        expect(learner.get_by_role("region", name="Hands").get_by_role("button", name="Lower hand")).to_be_visible(timeout=LOAD_MS)
        expect(seat(teacher, "B1")).to_have_attribute("data-hand", "raised", timeout=LIVE_MS)
    assert valkey.items(f"sh:{sid}:hands") == [lrn("priya"), lrn("jonas"), lrn("mira")]


def test_lesson_upload_rules(app_url: str) -> None:
    api, class_id, lesson_id = teacher_with_lesson(app_url)
    png, jpg, glb = png_bytes(), jpeg_bytes(), glb_bytes()
    lesson = ok(upload(api, lesson_id, [("a.png", png), ("b.jpg", jpg), ("m.glb", glb)]), 201)
    assert [(s["name"], s["number"], s["bytes"], s["status"]) for s in lesson["slides"]] == [("a.png", 1, len(png), "confirmed"), ("b.jpg", 2, len(jpg), "confirmed")]
    assert [(m["name"], m["number"], m["bytes"], m["status"]) for m in lesson["models"]] == [("m.glb", 1, len(glb), "confirmed")]
    for item, data, kind in ((lesson["slides"][0], png, "image/png"), (lesson["slides"][1], jpg, "image/jpeg"), (lesson["models"][0], glb, "model/gltf-binary")):
        assert S3().get(f"lessons/{lesson_id}/{item['fileId']}") == data
        served = api.get(f"/api/files/{item['fileId']}")
        assert served.status_code == 200 and served.content == data and served.headers["content-type"].startswith(kind)

    lesson = ok(upload(api, lesson_id, [("c.glb", png)]), 201)
    assert [s["name"] for s in lesson["slides"]] == ["a.png", "b.jpg", "c.glb"] and len(lesson["models"]) == 1

    def unchanged(response: httpx.Response, status: int, text: str) -> None:
        keys_before = set(lesson_keys(lesson_id))
        refused(response, status, text)
        now = ok(api.get(f"/api/lessons/{lesson_id}"), 200)
        assert [s["fileId"] for s in now["slides"]] == [s["fileId"] for s in current["slides"]]
        assert [m["fileId"] for m in now["models"]] == [m["fileId"] for m in current["models"]]
        assert set(lesson_keys(lesson_id)) <= keys_before | set(lesson_keys(lesson_id)) and set(lesson_keys(lesson_id)) == keys_before

    current = lesson
    unchanged(upload(api, lesson_id, [("d.png", png), ("notes.png", JUNK)]), 422, "notes.png isn't a PNG, JPEG or glTF binary.")
    unchanged(upload(api, lesson_id, [("big.bin", JUNK * (SLIDE_MAX_BYTES // len(JUNK) + 1))]), 422, "big.bin isn't a PNG, JPEG or glTF binary.")
    unchanged(upload(api, lesson_id, [("over.png", png_bytes(SLIDE_MAX_BYTES + 1))]), 413, "over.png is larger than the limit.")
    unchanged(upload(api, lesson_id, [("over.png", png_bytes(SLIDE_MAX_BYTES + 1)), ("notes.png", JUNK)]), 413, "over.png is larger than the limit.")
    unchanged(upload(api, lesson_id, [("notes.png", JUNK), ("over.png", png_bytes(SLIDE_MAX_BYTES + 1))]), 422, "notes.png isn't a PNG, JPEG or glTF binary.")
    unchanged(upload(api, lesson_id, [("huge.glb", glb_bytes(MODEL_MAX_BYTES + 1))]), 413, "huge.glb is larger than the limit.")
    boundary = "slatehallprobe"
    empty = (f"--{boundary}\r\nContent-Disposition: form-data; name=\"note\"\r\n\r\nx\r\n--{boundary}--\r\n").encode()
    unchanged(api.post(f"/api/lessons/{lesson_id}/files", content=empty, headers={"Content-Type": f"multipart/form-data; boundary={boundary}"}),
              422, "Choose at least one file.")

    edge_png, edge_glb = png_bytes(SLIDE_MAX_BYTES), glb_bytes(MODEL_MAX_BYTES)
    current = ok(upload(api, lesson_id, [("edge.png", edge_png), ("edge.glb", edge_glb)]), 201)
    assert current["slides"][-1]["bytes"] == SLIDE_MAX_BYTES and current["models"][-1]["bytes"] == MODEL_MAX_BYTES
    assert S3().get(f"lessons/{lesson_id}/{current['slides'][-1]['fileId']}") == edge_png
    room_left = SLIDES_MAX - len(current["slides"])
    current = ok(upload(api, lesson_id, [(f"fill-{i}.png", png_bytes(shade=i)) for i in range(room_left)]), 201)
    assert len(current["slides"]) == SLIDES_MAX
    assert [s["number"] for s in current["slides"]] == list(range(1, SLIDES_MAX + 1))
    unchanged(upload(api, lesson_id, [("one-more.png", png)]), 422, "A lesson holds at most 40 slides.")

    other = ok(api.post(f"/api/classes/{class_id}/lessons", {"title": "Week 1: Offer and acceptance"}), 201)["id"]
    small = ok(upload(api, other, [("s1.png", png_bytes(shade=1)), ("s2.png", png_bytes(shade=2)), ("s3.png", png_bytes(shade=3)), ("m.glb", glb)]), 201)
    ids = [s["fileId"] for s in small["slides"]]
    reordered = ok(api.put(f"/api/lessons/{other}/order", {"slideIds": list(reversed(ids))}), 200)
    assert [(s["fileId"], s["number"]) for s in reordered["slides"]] == list(zip(reversed(ids), [1, 2, 3]))
    for bad in (ids[:2], ids + ids[:1], ids[:2] + [small["models"][0]["fileId"]], ids[:2] + [current["slides"][0]["fileId"]], ids[:2] + ["fil_unknown"]):
        refused(api.put(f"/api/lessons/{other}/order", {"slideIds": bad}), 422, "List every slide once.")
    assert [s["fileId"] for s in ok(api.get(f"/api/lessons/{other}"), 200)["slides"]] == list(reversed(ids))


def test_store_confirmed_and_ready(app_url: str) -> None:
    api, _, lesson_id = teacher_with_lesson(app_url)
    refused(api.post(f"/api/lessons/{lesson_id}/ready"), 409, "Add at least one slide first.")
    glb = glb_bytes()
    ok(upload(api, lesson_id, [("m.glb", glb)]), 201)
    refused(api.post(f"/api/lessons/{lesson_id}/ready"), 409, "Add at least one slide first.")
    first, second = png_bytes(shade=1), png_bytes(shade=2)
    lesson = ok(upload(api, lesson_id, [("one.png", first)]), 201)
    assert lesson["state"] == "draft" and lesson["slides"][0]["status"] == "confirmed"
    one_id = lesson["slides"][0]["fileId"]
    assert S3().get(f"lessons/{lesson_id}/{one_id}") == first
    assert ok(api.post(f"/api/lessons/{lesson_id}/ready"), 200)["state"] == "ready"
    lesson = ok(upload(api, lesson_id, [("two.png", second)]), 201)
    assert lesson["state"] == "draft", "adding files to a ready lesson must take it out of ready"
    two_id = lesson["slides"][1]["fileId"]
    assert ok(api.post(f"/api/lessons/{lesson_id}/ready"), 200)["state"] == "ready"
    assert ok(api.put(f"/api/lessons/{lesson_id}/order", {"slideIds": [two_id, one_id]}), 200)["state"] == "ready"
    after = ok(api.delete(f"/api/lessons/{lesson_id}/files/{one_id}"), 200)
    assert [s["fileId"] for s in after["slides"]] == [two_id] and after["state"] == "ready"
    assert f"lessons/{lesson_id}/{one_id}" not in lesson_keys(lesson_id)
    assert api.get(f"/api/files/{one_id}").status_code == 404
    assert ok(api.delete(f"/api/lessons/{lesson_id}/files/{two_id}"), 200)["state"] == "draft"

    world = setup_world(app_url, reference_world())
    ana, week3 = world.api("ana"), world.lesson("week3")
    keys = lesson_keys(week3)
    assert len(keys) == 4
    text = "This lesson is being taught right now."
    refused(upload(ana, week3, [("late.png", first)]), 409, text)
    refused(ana.delete(f"/api/lessons/{week3}/files/{world.slides('week3')[0]}"), 409, text)
    refused(ana.put(f"/api/lessons/{week3}/order", {"slideIds": list(reversed(world.slides("week3")))}), 409, text)
    assert lesson_keys(week3) == keys
    assert [s["fileId"] for s in ok(ana.get(f"/api/lessons/{week3}"), 200)["slides"]] == world.slides("week3")


def test_wf_preparing_a_lesson_upload_and_ready(browser: Browser, app_url: str) -> None:
    api, _, lesson_id = teacher_with_lesson(app_url)
    files = {"slide-1.png": png_bytes(shade=1), "slide-2.png": png_bytes(shade=2), "model-1.glb": glb_bytes()}
    with visit(browser, app_url, api, f"/lessons/{lesson_id}") as page:
        expect(page.get_by_role("heading", name="Week 3: At the restaurant")).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_text("Status: Draft")).to_be_visible()
        items = page.get_by_role("list", name="Lesson files").get_by_role("listitem")
        with held(page, "**/api/lessons/*/files") as gate:
            page.get_by_label("Add files").set_input_files(
                [{"name": name, "mimeType": "application/octet-stream", "buffer": data} for name, data in files.items()])
            expect(items).to_have_count(3, timeout=LOAD_MS)
            for i in range(3):
                expect(items.nth(i)).to_have_attribute("data-file-status", "pending")
                expect(items.nth(i)).to_contain_text("Pending")
            page_status(page, "Saving...")
            gate.release()
        page_status(page, "Files added: 3.")
        for i in range(3):
            expect(items.nth(i)).to_have_attribute("data-file-status", "confirmed", timeout=LOAD_MS)
            expect(items.nth(i)).to_contain_text("Confirmed")
        expect(items).to_have_text([re.compile("slide-1.png"), re.compile("slide-2.png"), re.compile("model-1.glb")])
        for i, name in enumerate(files):
            file_id = items.nth(i).get_attribute("data-file-id")
            assert S3().get(f"lessons/{lesson_id}/{file_id}") == files[name]
        page.get_by_role("button", name=f"Move {list(files)[1]} up").click()
        page_status(page, "Lesson updated.")
        assert [s["name"] for s in ok(api.get(f"/api/lessons/{lesson_id}"), 200)["slides"]] == ["slide-2.png", "slide-1.png"]
        page.get_by_role("button", name="Mark ready to teach").click()
        page_status(page, "Lesson ready to teach.")
        expect(page.get_by_text("Status: Ready")).to_be_visible(timeout=LOAD_MS)
    assert ok(api.get(f"/api/lessons/{lesson_id}"), 200)["state"] == "ready"


def test_wf_preparing_a_lesson_model_on_show(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    clara, law = world.api("clara"), world.cls("law")
    title = "Week 2: Consideration"
    lesson_id = ok(clara.post(f"/api/classes/{law}/lessons", {"title": title}), 201)["id"]
    sid = ok(clara.post(f"/api/classes/{law}/sessions", {"lessonId": lesson_id, "startsAt": "2027-03-15T18:30",
                                                          "endsAt": "2027-03-15T20:00"}), 201)["id"]
    requests: list[str] = []
    with visit(browser, app_url, clara, f"/lessons/{lesson_id}", record=requests) as page:
        expect(page.get_by_role("heading", name=title)).to_be_visible(timeout=LOAD_MS)
        items = page.get_by_role("list", name="Lesson files").get_by_role("listitem")
        page.get_by_label("Add files").set_input_files(
            [{"name": name, "mimeType": "application/octet-stream", "buffer": data}
             for name, data in (("slide-1.png", png_bytes(shade=3)), ("model-1.glb", glb_bytes()))])
        page_status(page, "Files added: 2.")
        expect(items.nth(1)).to_have_attribute("data-file-status", "confirmed", timeout=LOAD_MS)
        model_id = items.nth(1).get_attribute("data-file-id")
        page.get_by_role("button", name="Mark ready to teach").click()
        page_status(page, "Lesson ready to teach.")
        ok(clara.post(f"/api/sessions/{sid}/open"), 200)
        ok(clara.post(f"/api/sessions/{sid}/start"), 200)
        assert snapshot(clara, sid)["modelFileId"] == model_id

        requests.clear()
        page.goto(app_url.rstrip("/") + f"/sessions/{sid}")
        wait_mirror(page, 2)
        expect(room(page).locator("[data-model]")).to_have_attribute("data-model-id", model_id, timeout=LOAD_MS)
        poll_until(lambda: fetched(page, requests, f"/api/files/{model_id}"),
                   "the classroom fetched the model the teacher added", LOAD_MS / 1000)


def test_wf_preparing_a_lesson_refused(browser: Browser, app_url: str) -> None:
    api, _, lesson_id = teacher_with_lesson(app_url)
    with visit(browser, app_url, api, f"/lessons/{lesson_id}") as page:
        expect(page.get_by_role("heading", name="Week 3: At the restaurant")).to_be_visible(timeout=LOAD_MS)
        page.get_by_label("Add files").set_input_files([
            {"name": "good.png", "mimeType": "image/png", "buffer": png_bytes()},
            {"name": "notes.png", "mimeType": "image/png", "buffer": JUNK}])
        alert_says(page, "notes.png isn't a PNG, JPEG or glTF binary.")
        expect(page.get_by_role("list", name="Lesson files").get_by_role("listitem")).to_have_count(0)
        page.get_by_role("button", name="Mark ready to teach").click()
        alert_says(page, "Add at least one slide first.")
    lesson = ok(api.get(f"/api/lessons/{lesson_id}"), 200)
    assert lesson["slides"] == [] and lesson["models"] == [] and lesson["state"] == "draft"
    assert lesson_keys(lesson_id) == []


def test_file_storage_outage(app_url: str) -> None:
    api, _, lesson_id = teacher_with_lesson(app_url)
    stored = ok(upload(api, lesson_id, [("kept.png", png_bytes())]), 201)["slides"][0]["fileId"]
    down = api.on(MINIO_DOWN_URL)
    refused(upload(down, lesson_id, [("new.png", png_bytes(shade=9)), ("m.glb", glb_bytes())]), 503, "Files can't be saved right now. Try again in a minute.")
    refused(down.get(f"/api/files/{stored}"), 503, "Files can't be loaded right now. Try again in a minute.")
    refused(grading_post(MINIO_DOWN_URL, "/api/grading/setup", reference_world()), 503, "Files can't be loaded right now. Try again in a minute.")
    assert ok(httpx.get(MINIO_DOWN_URL + "/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "unavailable"}
    lesson = ok(api.get(f"/api/lessons/{lesson_id}"), 200)
    assert [s["fileId"] for s in lesson["slides"]] == [stored] and lesson["models"] == []
    assert lesson_keys(lesson_id) == [f"lessons/{lesson_id}/{stored}"]

    second = api.on(SECOND_URL)
    with outage(SECOND_URL, "minio"):
        assert ok(httpx.get(SECOND_URL + "/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "unavailable"}
        refused(upload(second, lesson_id, [("new.png", png_bytes(shade=9))]), 503, "Files can't be saved right now. Try again in a minute.")
        assert lesson_keys(lesson_id) == [f"lessons/{lesson_id}/{stored}"]
    data = png_bytes(shade=9)
    after = ok(upload(second, lesson_id, [("new.png", data)]), 201)
    new_id = after["slides"][-1]["fileId"]
    assert after["slides"][-1]["status"] == "confirmed" and S3().get(f"lessons/{lesson_id}/{new_id}") == data


def test_wf_preparing_a_lesson_storage_outage(browser: Browser, app_url: str) -> None:
    api, _, lesson_id = teacher_with_lesson(app_url)
    with visit(browser, MINIO_DOWN_URL, api, f"/lessons/{lesson_id}") as page:
        expect(page.get_by_role("heading", name="Week 3: At the restaurant")).to_be_visible(timeout=LOAD_MS)
        page.get_by_label("Add files").set_input_files([{"name": "slide-1.png", "mimeType": "image/png", "buffer": png_bytes()}])
        alert_says(page, "Files can't be saved right now. Try again in a minute.")
        expect(page.get_by_role("list", name="Lesson files").get_by_role("listitem")).to_have_count(0)
    lesson = ok(api.get(f"/api/lessons/{lesson_id}"), 200)
    assert lesson["slides"] == [] and lesson_keys(lesson_id) == []


def test_poll_rules(app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, bill = world.ses("tue"), world.poll("bill")
    ana, ben, mira = world.api("ana"), world.api("ben", SECOND_URL), world.api("mira")
    assert snapshot(ana, sid)["poll"]["counts"] == [2, 1, 0]
    assert snapshot(mira, sid)["poll"]["counts"] is None
    assert snapshot(mira, sid)["poll"]["yourAnswer"] == 1
    refused(ana.post(f"/api/sessions/{sid}/polls", {"question": "Which word means the bill?", "options": BILL_OPTIONS}), 409, "Close the open poll first.")
    assert ok(mira.post(f"/api/polls/{bill}/answer", {"option": 3}), 200) == {"pollId": bill, "yourAnswer": 3}
    assert snapshot(ben, sid)["poll"]["counts"] == [1, 1, 1]
    counts = valkey.hash(f"sh:{sid}:poll:{bill}")
    assert [int(counts.get(str(n), "0")) for n in (1, 2, 3)] == [1, 1, 1]
    for bad in (0, 4):
        refused(mira.post(f"/api/polls/{bill}/answer", {"option": bad}), 422, "No such option.")
    refused(mira.post(f"/api/sessions/{sid}/polls", {"question": "Which word means the bill?", "options": BILL_OPTIONS}), 403, "Only the teacher can do that.")
    closed = ok(ben.post(f"/api/polls/{bill}/close"), 200)
    assert closed["total"] == 3 and [r["count"] for r in closed["results"]] == [1, 1, 1]
    refused(ana.post(f"/api/polls/{bill}/close"), 409, "This poll is closed.")
    refused(world.api("jonas").post(f"/api/polls/{bill}/answer", {"option": 2}), 409, "This poll is closed.")
    learner_view = snapshot(mira, sid)["poll"]
    assert learner_view["state"] == "closed" and learner_view["counts"] == [1, 1, 1]

    path = f"/api/sessions/{sid}/polls"
    cases = [
        ({"question": "", "options": ["A"]}, "Write a question of 1 to 200 characters."),
        ({"question": "q" * (POLL_QUESTION_MAX + 1), "options": BILL_OPTIONS}, "Write a question of 1 to 200 characters."),
        ({"question": "Which word means the bill?", "options": ["La cuenta"]}, "Give 2 to 6 options."),
        ({"question": "Which word means the bill?", "options": [f"o{i}" for i in range(7)]}, "Give 2 to 6 options."),
        ({"question": "Which word means the bill?", "options": ["La cuenta", ""]}, "Each option needs 1 to 80 characters."),
        ({"question": "Which word means the bill?", "options": ["La cuenta", "x" * (POLL_OPTION_MAX + 1)]}, "Each option needs 1 to 80 characters."),
        ({"question": "Which word means the bill?", "options": ["La cuenta", "la CUENTA"]}, "Options must be different."),
    ]
    for body, text in cases:
        refused(ana.post(path, body), 422, text)
    opened = ok(ben.post(path, {"question": "q" * POLL_QUESTION_MAX, "options": [f"o{i}" for i in range(6)]}), 201)
    assert opened["state"] == "open" and opened["question"] == "q" * POLL_QUESTION_MAX
    assert snapshot(ana, sid)["poll"]["pollId"] == opened["pollId"]


def test_poll_percentages(app_url: str) -> None:
    world = reference_world()
    world["classes"] = [dict(world["classes"][0], key=f"c{i}", coTeachers=[]) for i in range(3)]
    world["lessons"] = [{"key": f"l{i}", "class": f"c{i}", "title": "Week 3: At the restaurant", "slideCount": 1, "modelCount": 0} for i in range(3)]
    world["sessions"] = [{"key": f"s{i}", "class": f"c{i}", "lesson": f"l{i}", "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30",
                          "state": "live", "currentSlide": 1, "locked": False} for i in range(3)]
    joined = [{"joinedAt": "2027-03-09T18:55:00-06:00", "leftAt": None}]
    world["learners"] = [{"key": f"a{i}", "displayName": f"Voter A{i}", "session": "s0", "seat": None, "presence": joined} for i in range(3)] + \
                        [{"key": f"b{i}", "displayName": f"Voter B{i}", "session": "s1", "seat": None, "presence": joined} for i in range(8)]
    world["hands"] = []
    world["polls"] = [
        {"key": "p0", "session": "s0", "question": "Which word means the bill?", "options": BILL_OPTIONS, "answers": {"a0": 1, "a1": 2, "a2": 2}, "state": "open"},
        {"key": "p1", "session": "s1", "question": "Which word means the bill?", "options": BILL_OPTIONS,
         "answers": {"b0": 1, "b1": 2, "b2": 2, "b3": 2, "b4": 3, "b5": 3, "b6": 3, "b7": 3}, "state": "open"},
        {"key": "p2", "session": "s2", "question": "Which word means the bill?", "options": ["La cuenta", "La mesa"], "answers": {}, "state": "open"},
    ]
    w = setup_world(app_url, world)
    ana = w.api("ana")
    expected = {"p0": (3, [1, 2, 0], [33, 67, 0]), "p1": (8, [1, 3, 4], [13, 38, 50]), "p2": (0, [0, 0], [0, 0])}
    for key, (total, counts, percents) in expected.items():
        closed = ok(ana.post(f"/api/polls/{w.poll(key)}/close"), 200)
        assert closed["pollId"] == w.poll(key) and closed["total"] == total
        assert [r["count"] for r in closed["results"]] == counts and [r["percent"] for r in closed["results"]] == percents
        refused(ana.post(f"/api/polls/{w.poll(key)}/close"), 409, "This poll is closed.")
    ok(ana.post(f"/api/sessions/{w.ses('s1')}/end"), 200)
    summary = ok(ana.get(f"/api/sessions/{w.ses('s1')}/summary"), 200)
    assert [(p["pollId"], p["total"], [r["percent"] for r in p["results"]]) for p in summary["polls"]] == [(w.poll("p1"), 8, [13, 38, 50])]


def closed_bill_world() -> dict[str, Any]:
    world = reference_world()
    world["polls"][0]["state"] = "closed"
    return world


def test_wf_running_a_poll_live(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, closed_bill_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("mira", SECOND_URL), f"/sessions/{sid}") as mira, \
            visit(browser, app_url, world.api("jonas"), f"/sessions/{sid}") as jonas:
        for page in (teacher, mira, jonas):
            wait_mirror(page, 7)
        opener = teacher.get_by_role("button", name="New poll")
        opener.click()
        dialog = teacher.get_by_role("dialog", name="New poll")
        question = dialog.get_by_role("textbox", name="Question")
        expect(question).to_be_focused(timeout=LOAD_MS)
        teacher.keyboard.press("Shift+Tab")
        assert dialog.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab left the New poll dialog"
        expect(question).not_to_be_focused()
        teacher.keyboard.press("Tab")
        expect(question).to_be_focused()
        teacher.keyboard.press("Escape")
        advance(teacher, DIALOG_SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()
        opener.click()
        question.fill("Which word means the bill?")
        fill_option(dialog, 1, "La cuenta")
        fill_option(dialog, 2, "La mesa")
        fill_option(dialog, 3, "La carta")
        dialog.get_by_role("button", name="Open poll").click()
        poll_id = poll_until(lambda: (snapshot(world.api("ana"), sid)["poll"] or {}).get("state") == "open"
                             and snapshot(world.api("ana"), sid)["poll"]["pollId"], "Open poll created a poll", API_WAIT_S)
        counts = teacher.get_by_role("list", name="Poll counts").get_by_role("listitem")
        option = mira.get_by_role("group", name="Poll").get_by_role("button", name="La cuenta", exact=True)
        expect(option).to_be_visible(timeout=LOAD_MS)
        expect(mira.get_by_role("list", name="Poll counts")).to_have_count(0)
        option.focus()
        mira.keyboard.press("2")
        expect(mira.get_by_role("button", name="La mesa", exact=True)).to_have_attribute("aria-pressed", "true", timeout=LOAD_MS)
        expect(counts).to_have_text(["La cuenta: 0", "La mesa: 1", "La carta: 0"], timeout=LOAD_MS)
        jonas.get_by_role("group", name="Poll").get_by_role("button", name="La mesa", exact=True).click()
        expect(counts).to_have_text(["La cuenta: 0", "La mesa: 2", "La carta: 0"], timeout=LOAD_MS)
        mira.get_by_role("button", name="La mesa", exact=True).focus()
        mira.keyboard.press("1")
        expect(counts).to_have_text(["La cuenta: 1", "La mesa: 1", "La carta: 0"], timeout=LOAD_MS)
        stored = valkey.hash(f"sh:{sid}:poll:{poll_id}")
        assert [int(stored.get(str(n), "0")) for n in (1, 2, 3)] == [1, 1, 0]
        teacher.get_by_role("button", name="Close poll").click()
        text = "Poll results: La cuenta 50%, La mesa 50%, La carta 0%."
        for page in (mira, jonas):
            announced(page, text, timeout=LOAD_MS)
        expect(mira.get_by_role("list", name="Poll results").get_by_role("listitem")).to_have_text(["La cuenta 50%", "La mesa 50%", "La carta 0%"])
    final = snapshot(world.api("mira"), sid)["poll"]
    assert final["state"] == "closed" and final["counts"] == [1, 1, 0]


def test_wf_running_a_poll_invalid_options(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, closed_bill_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher:
        wait_mirror(teacher, 7)
        teacher.get_by_role("button", name="New poll").click()
        dialog = teacher.get_by_role("dialog", name="New poll")
        dialog.get_by_role("textbox", name="Question").fill("Which word means the bill?")
        fill_option(dialog, 1, "La cuenta")
        fill_option(dialog, 2, "la cuenta")
        dialog.get_by_role("button", name="Open poll").click()
        alert_says(dialog, "Options must be different.")
        option_box(dialog, 2).fill("La mesa")
        dialog.get_by_role("button", name="Open poll").click()
        poll_until(lambda: (snapshot(world.api("ana"), sid)["poll"] or {}).get("state") == "open", "corrected poll opened", API_WAIT_S)
    poll = snapshot(world.api("ana"), sid)["poll"]
    assert poll["question"] == "Which word means the bill?" and poll["options"] == ["La cuenta", "La mesa"]


def test_breakout_split(app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana, lrn = world.ses("tue"), world.api("ana"), world.lrn
    for bad in (1, 4):
        refused(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": bad}), 422, "Choose 2 to 3 tables.")
    snap = ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
    assert snap["state"] == "breakouts"
    tables = {t["tableId"]: t["learnerIds"] for t in snap["breakout"]["tables"]}
    assert tables == {"T1": [lrn("mira"), lrn("priya"), lrn("hana")], "T2": [lrn("jonas"), lrn("tomas")]}
    homes = {s["seatId"]: (s["learnerId"], s["breakoutTable"]) for s in snap["seats"]}
    assert homes["B1"] == (lrn("mira"), "T1") and homes["B3"] == (lrn("jonas"), "T2") and homes["E8"] == (None, None)
    members = valkey.hash(f"sh:{sid}:breakout:members")
    assert members.get(lrn("priya")) == "T1" and members.get(lrn("tomas")) == "T2" and lrn("leo") not in members

    full = reference_world()
    seats = ["B1", "B3", "B5", "B7", "D1", "D3", "E8"]
    full["learners"] = [{"key": f"k{i}", "displayName": f"Learner {i}", "session": "tue", "seat": s,
                         "presence": [{"joinedAt": "2027-03-09T18:55:00-06:00", "leftAt": None}]} for i, s in enumerate(seats)]
    full["hands"], full["polls"] = [], []
    w2 = setup_world(app_url, full)
    snap = ok(w2.api("ana").post(f"/api/sessions/{w2.ses('tue')}/breakouts", {"tables": 3}), 201)
    dealt = {t["tableId"]: t["learnerIds"] for t in snap["breakout"]["tables"]}
    k = w2.lrn
    assert dealt == {"T1": [k("k0"), k("k3"), k("k6")], "T2": [k("k1"), k("k4")], "T3": [k("k2"), k("k5")]}
    ok(w2.api("ana").post(f"/api/sessions/{w2.ses('tue')}/end"), 200)
    assert ok(w2.api("ana").get(f"/api/sessions/{w2.ses('tue')}/summary"), 200)["breakoutRounds"] == 1


def test_breakout_deadline_server_held(app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana, t0 = world.ses("tue"), world.api("ana"), world.now
    snap = ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
    assert snap["breakout"]["remainingSeconds"] == BREAKOUT_SECONDS and snap["breakout"]["warning"] is False
    assert at(valkey.hash(f"sh:{sid}:breakout")["deadline"]) == t0 + timedelta(seconds=BREAKOUT_SECONDS)
    refused(world.api("ben").post(f"/api/sessions/{sid}/breakouts/extend"), 403, "Only the teacher can do that.")
    refused(world.api("mira").post(f"/api/sessions/{sid}/breakouts/extend"), 403, "Only the teacher can do that.")
    deadline = BREAKOUT_SECONDS + EXTEND_SECONDS
    snap = ok(ana.post(f"/api/sessions/{sid}/breakouts/extend"), 200)
    assert snap["breakout"]["remainingSeconds"] == deadline
    assert at(valkey.hash(f"sh:{sid}:breakout")["deadline"]) == t0 + timedelta(seconds=deadline)

    world.clock(t0 + timedelta(seconds=deadline - WARNING_SECONDS - 1))
    snap = snapshot(ana, sid)
    assert snap["breakout"]["warning"] is False and snap["breakout"]["remainingSeconds"] == WARNING_SECONDS + 1
    world.clock(t0 + timedelta(seconds=deadline - WARNING_SECONDS))
    snap = snapshot(ana, sid)
    assert snap["breakout"]["warning"] is True and snap["breakout"]["remainingSeconds"] == WARNING_SECONDS
    snap = ok(ana.post(f"/api/sessions/{sid}/breakouts/extend"), 200)
    deadline += EXTEND_SECONDS
    assert snap["breakout"]["warning"] is False and snap["breakout"]["remainingSeconds"] == WARNING_SECONDS + EXTEND_SECONDS
    world.clock(t0 + timedelta(seconds=deadline - WARNING_SECONDS))
    assert snapshot(ana, sid)["breakout"]["warning"] is True
    world.clock(t0 + timedelta(seconds=deadline))
    snap = snapshot(world.api("ana", SECOND_URL), sid)
    assert snap["state"] == "live" and snap["breakout"] is None
    assert all(s["breakoutTable"] is None for s in snap["seats"])
    assert seat_of(snap, world.lrn("mira")) == "B1"
    refused(ana.post(f"/api/sessions/{sid}/breakouts/extend"), 409, "Breakouts are over.")

    start = t0 + timedelta(seconds=deadline)
    ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 3}), 201)
    world.clock(start + timedelta(seconds=BREAKOUT_SECONDS * 2))
    assert snapshot(ana, sid)["state"] == "live"


def test_wf_breakouts_bell_return_device_clock(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana = world.ses("tue"), world.api("ana")
    with visit(browser, app_url, ana, f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("mira", SECOND_URL), f"/sessions/{sid}") as mira:
        teacher.clock.set_system_time(DEVICE_FAR_FUTURE)
        teacher.reload()
        mira.clock.set_system_time(DEVICE_FAR_PAST)
        mira.reload()
        wait_mirror(teacher, 7)
        wait_mirror(mira, 7)
        teacher.get_by_role("button", name="Start breakouts").click()
        dialog = teacher.get_by_role("dialog", name="Start breakouts")
        tables = dialog.get_by_role("spinbutton", name="Tables")
        expect(tables).to_be_focused(timeout=LOAD_MS)
        tables.fill("2")
        dialog.get_by_role("button", name="Start", exact=True).click()
        announced(mira, "Breakouts started. You are at table T1.", timeout=LOAD_MS)
        announced(teacher, "Breakouts started at 2 tables.", timeout=LOAD_MS)
        assert snapshot(ana, sid)["breakout"]["remainingSeconds"] == BREAKOUT_SECONDS
        for page in (teacher, mira):
            expect(page.get_by_role("timer", name="Breakout time left")).to_have_text(mmss(BREAKOUT_SECONDS), timeout=LIVE_MS)
        teacher.get_by_role("button", name="Add 2 minutes").click()
        for page in (teacher, mira):
            expect(page.get_by_role("timer", name="Breakout time left")).to_have_text(mmss(BREAKOUT_SECONDS + EXTEND_SECONDS), timeout=LOAD_MS)
        assert snapshot(ana, sid)["breakout"]["remainingSeconds"] == BREAKOUT_SECONDS + EXTEND_SECONDS
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS + EXTEND_SECONDS))
        announced(mira, "Breakouts are over. Everyone is back in their seat.", timeout=LOAD_MS)
        expect(seat(mira, "B1")).to_have_attribute("data-breakout-table", "", timeout=LIVE_MS)
    assert snapshot(ana, sid)["state"] == "live"


def test_table_chat_rules(app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana = world.ses("tue"), world.api("ana")
    ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
    chat = lambda t: f"/api/sessions/{sid}/tables/{t}/chat"
    mira, jonas, leo = world.api("mira"), world.api("jonas", SECOND_URL), world.api("leo")
    posted = ok(mira.post(chat("T1"), {"text": CHAT_HELLO}), 201)
    assert posted["text"] == CHAT_HELLO and posted["messageId"]
    assert ok(ana.post(chat("T2"), {"text": CHAT_WELCOME}), 201)["text"] == CHAT_WELCOME
    for caller, table in ((jonas, "T1"), (leo, "T1"), (mira, "T2")):
        refused(caller.get(chat(table)), 404, "Not found.")
        refused(caller.post(chat(table), {"text": "Hola"}), 404, "Not found.")
    assert [m["text"] for m in ok(mira.get(chat("T1")), 200)["messages"]] == [CHAT_HELLO]
    assert [m["text"] for m in ok(jonas.get(chat("T2")), 200)["messages"]] == [CHAT_WELCOME]
    assert [m["text"] for m in ok(world.api("ben").get(chat("T1")), 200)["messages"]] == [CHAT_HELLO]
    refused(world.api("ben").post(chat("T1"), {"text": "Hola"}), 403, "Only the teacher can do that.")
    for bad in ("   ", "x" * (CHAT_MAX + 1)):
        refused(mira.post(chat("T1"), {"text": bad}), 422, "Write 1 to 300 characters.")
    ok(mira.post(chat("T1"), {"text": "x" * CHAT_MAX}), 201)
    world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS))
    refused(mira.post(chat("T1"), {"text": "Hola"}), 409, "Breakouts are over.")
    assert [m["text"] for m in ok(ana.get(chat("T1")), 200)["messages"]] == [CHAT_HELLO, "x" * CHAT_MAX]


def test_wf_breakouts_bell_return_late_edges(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana, mira = world.ses("tue"), world.api("ana"), world.api("mira")
    ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
    with visit(browser, app_url, mira, f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        field = page.get_by_role("textbox", name="Message your table")
        expect(field).to_be_enabled(timeout=LOAD_MS)
        field.fill(CHAT_HELLO)
        page.get_by_role("button", name="Send").click()
        expect(page.get_by_role("log", name="Table messages")).to_contain_text(CHAT_HELLO, timeout=LOAD_MS)
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS - 1))
        ok(mira.post(f"/api/sessions/{sid}/tables/T1/chat", {"text": "Ultimo"}), 201)
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS))
        refused(mira.post(f"/api/sessions/{sid}/tables/T1/chat", {"text": "Tarde"}), 409, "Breakouts are over.")
        refused(ana.post(f"/api/sessions/{sid}/breakouts/extend"), 409, "Breakouts are over.")
        expect(field).to_be_disabled(timeout=LOAD_MS)
        expect(page.get_by_role("region", name="Table chat")).to_contain_text("Chat opens when breakouts start.")
    assert [m["text"] for m in ok(ana.get(f"/api/sessions/{sid}/tables/T1/chat"), 200)["messages"]] == [CHAT_HELLO, "Ultimo"]


def test_bell_return_mirror(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        expect(region_attr := room(page)).to_have_attribute("data-returning", "false")
        ok(world.api("ana").post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
        timer = page.get_by_role("timer", name="Breakout time left")
        expect(board(page)).to_have_attribute("data-dimmed", "true", timeout=LIVE_MS)
        expect(seat(page, "B1")).to_have_attribute("data-breakout-table", "T1")
        expect(seat(page, "B3")).to_have_attribute("data-breakout-table", "T2")
        expect(table_item(page, "T1")).to_have_attribute("data-breakout-remaining", str(BREAKOUT_SECONDS))
        expect(timer).to_have_text(mmss(BREAKOUT_SECONDS))
        expect(timer).to_have_attribute("data-urgent", "false")
        advance(page, COUNTDOWN_STEP_MS)
        left = BREAKOUT_SECONDS - COUNTDOWN_STEP_MS // 1000
        expect(table_item(page, "T1")).to_have_attribute("data-breakout-remaining", str(left))
        expect(timer).to_have_text(mmss(left))
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS - WARNING_SECONDS))
        expect(timer).to_have_attribute("data-urgent", "true", timeout=LIVE_MS)
        expect(timer).to_have_text(mmss(WARNING_SECONDS))
        expect(table_item(page, "T2")).to_have_attribute("data-breakout-remaining", str(WARNING_SECONDS))
        announced(page, f"Breakouts end in {WARNING_SECONDS} seconds.")
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS))
        expect(region_attr).to_have_attribute("data-returning", "true", timeout=LIVE_MS)
        expect(seat(page, "B1")).to_have_attribute("data-breakout-table", "")
        expect(board(page)).to_have_attribute("data-dimmed", "false")
        expect(table_item(page, "T1")).to_have_attribute("data-breakout-remaining", "")
        announced(page, "Breakouts are over. Everyone is back in their seat.")
        expect(page.get_by_role("textbox", name="Message your table")).to_be_disabled()
        advance(page, RETURN_STILL_WALKING_MS)
        expect(region_attr).to_have_attribute("data-returning", "true")
        advance(page, RETURN_DONE_MS - RETURN_STILL_WALKING_MS)
        expect(region_attr).to_have_attribute("data-returning", "false")


@pytest.mark.timeout(600)
def test_wf_breakouts_bell_return_real_timers(browser: Browser) -> None:
    world = setup_world(TIMERS_URL, reference_world(now=None))
    sid, ana = world.ses("tue"), world.api("ana", TIMERS_URL)
    with visit(browser, TIMERS_URL, ana, f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        snap = ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
        assert 0 < snap["breakout"]["remainingSeconds"] <= TIMERS_BREAKOUT_SECONDS
        warning = announcements(page).get_by_role("paragraph").filter(has_text=re.compile(r"^\s*Breakouts end in (\d+) seconds\.\s*$"))
        expect(warning.first).to_be_attached(timeout=REAL_TIMER_WAIT_MS)
        seconds = int(re.search(r"(\d+)", warning.first.inner_text()).group(1))
        assert seconds <= TIMERS_WARNING_SECONDS
        expect(page.get_by_role("timer", name="Breakout time left")).to_have_attribute("data-urgent", "true", timeout=LIVE_MS)
        announced(page, "Breakouts are over. Everyone is back in their seat.", timeout=REAL_TIMER_WAIT_MS)
        expect(board(page)).to_have_attribute("data-dimmed", "false")
    assert snapshot(ana, sid)["state"] == "live"


BAD_TIME = "2027-03-09 7pm"
GAP_TIME = "2027-03-14T02:30"
TWICE_TIME = "2027-11-07T01:30"
TWICE_END = "2027-11-07T03:00"


def test_session_time_zone(app_url: str) -> None:
    api, class_id, lesson_id = teacher_with_lesson(app_url)
    path = f"/api/classes/{class_id}/sessions"
    snap = ok(api.post(path, {"lessonId": lesson_id, "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30"}), 201)
    assert snap["timeZone"] == "America/Chicago" and snap["state"] == "scheduled"
    assert snap["startsAt"] == "2027-03-09T19:00:00" and snap["endsAt"] == "2027-03-09T20:30:00"
    assert at(snap["startsAtUtc"]) == at("2027-03-10T01:00:00Z") and at(snap["endsAtUtc"]) == at("2027-03-10T02:30:00Z")
    listed = ok(api.get(f"/api/classes/{class_id}"), 200)["sessions"]
    assert any(s["id"] == snap["id"] and s["startsAt"] == "2027-03-09T19:00:00" for s in listed)
    refused(api.post(path, {"lessonId": lesson_id, "startsAt": BAD_TIME, "endsAt": "2027-03-09T20:30"}), 422, "Use a date and time like 2027-03-09T19:00.")
    refused(api.post(path, {"lessonId": lesson_id, "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T19:00"}), 422, "End the session after it starts.")
    refused(api.post(path, {"lessonId": lesson_id, "startsAt": GAP_TIME, "endsAt": TWICE_END}), 422, "That time doesn't exist in America/Chicago.")
    twice = ok(api.post(path, {"lessonId": lesson_id, "startsAt": TWICE_TIME, "endsAt": TWICE_END}), 201)
    first = datetime.fromisoformat(TWICE_TIME).replace(tzinfo=ZoneInfo("America/Chicago"), fold=0)
    assert at(twice["startsAtUtc"]) == first.astimezone(timezone.utc)
    london = ok(api.post("/api/classes", {"title": "Contract Law Seminar", "timeZone": "Europe/London"}), 201)["id"]
    lesson2 = ok(api.post(f"/api/classes/{london}/lessons", {"title": "Week 1: Offer and acceptance"}), 201)["id"]
    snap = ok(api.post(f"/api/classes/{london}/sessions", {"lessonId": lesson2, "startsAt": "2027-03-08T18:30", "endsAt": "2027-03-08T20:00"}), 201)
    assert snap["startsAt"] == "2027-03-08T18:30:00"
    assert at(snap["startsAtUtc"]) == datetime.fromisoformat("2027-03-08T18:30").replace(tzinfo=ZoneInfo("Europe/London"))


def test_wf_attendance_edges_schedule_dialog(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    ana, class_id = world.api("ana"), world.cls("spanish")
    known = {s["id"] for s in ok(ana.get(f"/api/classes/{class_id}"), 200)["sessions"]}
    with visit(browser, app_url, ana, f"/classes/{class_id}") as page:
        page.clock.set_system_time(DEVICE_FAR_FUTURE)
        page.reload()
        page.get_by_role("button", name="Schedule session").click()
        dialog = page.get_by_role("dialog", name="Schedule session")
        expect(dialog).to_contain_text("America/Chicago", timeout=LOAD_MS)
        select(dialog.get_by_role("combobox", name="Lesson"), "Week 3: At the restaurant")
        dialog.get_by_role("textbox", name="Starts").fill("2027-03-09T19:00")
        dialog.get_by_role("textbox", name="Ends").fill("2027-03-09T19:00")
        dialog.get_by_role("button", name="Schedule").click()
        alert_says(dialog, "End the session after it starts.")
        dialog.get_by_role("textbox", name="Ends").fill("2027-03-09T20:30")
        dialog.get_by_role("button", name="Schedule").click()
        page_status(page, "Session scheduled.")
    new = [s for s in ok(ana.get(f"/api/classes/{class_id}"), 200)["sessions"] if s["id"] not in known]
    assert len(new) == 1 and new[0]["startsAt"] == "2027-03-09T19:00:00"
    assert at(snapshot(ana, new[0]["id"])["startsAtUtc"]) == at("2027-03-10T01:00:00Z")


def by_name(rows: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    return {row["displayName"]: row for row in rows}


def test_attendance_statuses(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    ana = world.api("ana")
    rows = by_name(ok(ana.get(f"/api/sessions/{world.ses('lastweek')}/attendance"), 200)["rows"])
    seeds = {p["displayName"]: p["presence"] for p in REFERENCE["learners"]}
    expected = {"Rosa Delgado": ("present", 1), "Sam Whitfield": ("late", 1), "Tess Moreau": ("present", 2),
                "Omar Haddad": ("left_early", 1), "Yuki Tanaka": ("late_left_early", 1)}
    for name, (status, visits) in expected.items():
        row = rows[name]
        assert (row["status"], row["visits"]) == (status, visits), f"{name}: {row}"
        assert wall(row["firstJoined"]) == wall(seeds[name][0]["joinedAt"])
    assert wall(rows["Omar Haddad"]["lastLeft"]) == wall("2027-03-02T20:19:59-06:00")
    assert wall(rows["Tess Moreau"]["lastLeft"]) == wall("2027-03-02T20:20:00-06:00")
    assert wall(rows["Rosa Delgado"]["lastLeft"]) == wall("2027-03-02T20:30")
    assert rows["Ines Duarte"]["status"] == "absent" and rows["Ines Duarte"]["firstJoined"] is None and rows["Ines Duarte"]["lastLeft"] is None
    felix = by_name(ok(world.api("clara").get(f"/api/sessions/{world.ses('lawmon')}/attendance"), 200)["rows"])["Felix Grant"]
    assert felix["status"] == "present" and wall(felix["firstJoined"]) == wall("2027-03-08T18:29:00+00:00")

    sid = world.ses("tue")
    refused(ana.get(f"/api/sessions/{sid}/attendance"), 409, "Attendance is ready when the session ends.")
    refused(ana.get(f"/api/sessions/{sid}/summary"), 409, "Attendance is ready when the session ends.")
    zoe = Api(app_url)
    zoe_id = ok(zoe.post("/api/join", {"code": world.code("spanish"), "displayName": "Zoe Park"}), 201)["learnerId"]
    online = f"sh:{sid}:online"
    with visit(browser, app_url, zoe, f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        poll_until(lambda: zoe_id in valkey.members(online), "an open WebSocket put the learner in the online set", API_WAIT_S)
    world.clock(world.now + timedelta(seconds=GRACE_SECONDS))
    poll_until(lambda: zoe_id not in valkey.members(online), "the learner left the online set once the reconnect grace passed", API_WAIT_S)
    ok(ana.post(f"/api/sessions/{sid}/end"), 200)
    rows = by_name(ok(ana.get(f"/api/sessions/{sid}/attendance"), 200)["rows"])
    row = rows["Zoe Park"]
    assert row["status"] == "late_left_early" and row["visits"] == 1
    assert wall(row["firstJoined"]) == wall(REF_NOW) and wall(row["lastLeft"]) == wall(REF_NOW)
    assert rows["Mira Okafor"]["status"] == "present" and rows["Leo Brandt"]["status"] == "late"


def test_wf_attendance_edges_summary_page(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana = world.ses("tue"), world.api("ana")
    with visit(browser, app_url, ana, f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        page.get_by_role("button", name="Take next hand").click()
        poll_until(lambda: hand_ids(snapshot(ana, sid)) == [world.lrn("jonas")], "Take next hand took Priya", API_WAIT_S)
        page.get_by_role("button", name="Close poll").click()
        poll_until(lambda: snapshot(ana, sid)["poll"]["state"] == "closed", "Close poll closed the poll", API_WAIT_S)
        page.get_by_role("button", name="Start breakouts").click()
        dialog = page.get_by_role("dialog", name="Start breakouts")
        dialog.get_by_role("spinbutton", name="Tables").fill("2")
        dialog.get_by_role("button", name="Start", exact=True).click()
        poll_until(lambda: snapshot(ana, sid)["state"] == "breakouts", "Start began breakouts", API_WAIT_S)
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS))
        expect(page.get_by_role("button", name="End class")).to_be_visible(timeout=LOAD_MS)
        page.get_by_role("button", name="End class").click()
        poll_until(lambda: snapshot(ana, sid)["state"] == "ended", "End class ended the session", API_WAIT_S)
        page.clock.set_system_time(DEVICE_FAR_FUTURE)
        page.goto(f"{app_url.rstrip('/')}/sessions/{sid}/summary")
        expect(page.get_by_role("heading", name="Session summary")).to_be_visible(timeout=LOAD_MS)
        expect(page.get_by_role("list", name="Attendance counts").get_by_role("listitem")).to_have_text(
            ["Present 5", "Late 1", "Left early 0", "Late, left early 0", "Absent 0"])
        results = page.get_by_role("list", name="Poll results")
        for text in ("La cuenta 67%", "La mesa 33%", "La carta 0%"):
            expect(results).to_contain_text(text)
        expect(page.get_by_text("Hands taken: 1")).to_be_visible()
        expect(page.get_by_text("Breakout rounds: 1")).to_be_visible()

        page.goto(f"{app_url.rstrip('/')}/sessions/{world.ses('lastweek')}/summary")
        expect(page.get_by_role("list", name="Attendance counts").get_by_role("listitem")).to_have_text(
            ["Present 2", "Late 1", "Left early 1", "Late, left early 1", "Absent 1"], timeout=LOAD_MS)
        table = page.get_by_role("table", name="Attendance")
        assert [t.strip() for t in table.get_by_role("columnheader").all_inner_texts()] == ["Learner", "Status", "First joined", "Last left"]
        omar = [t.strip() for t in table.get_by_role("row").filter(has_text="Omar Haddad").get_by_role("cell").all_inner_texts()]
        assert "Left early" in omar and "18:59:00" in omar and "20:19:59" in omar, omar
        ines = [t.strip() for t in table.get_by_role("row").filter(has_text="Ines Duarte").get_by_role("cell").all_inner_texts()]
        assert "Absent" in ines and ines.count("-") == 2, ines
        sam = [t.strip() for t in table.get_by_role("row").filter(has_text="Sam Whitfield").get_by_role("cell").all_inner_texts()]
        assert "Late" in sam and "19:05:01" in sam and "20:30:00" in sam, sam
    summary = ok(ana.get(f"/api/sessions/{sid}/summary"), 200)
    assert summary["attendance"] == {"present": 5, "late": 1, "leftEarly": 0, "lateLeftEarly": 0, "absent": 0}
    assert [r["percent"] for r in summary["polls"][0]["results"]] == [67, 33, 0]
    assert summary["handsTaken"] == 1 and summary["breakoutRounds"] == 1
    with visit(browser, app_url, world.api("rosa"), f"/sessions/{world.ses('lastweek')}/summary") as rosa:
        alert_says(rosa, "Only the teacher can do that.")
    with visit(browser, app_url, world.api("mira"), f"/sessions/{world.ses('lastweek')}/summary") as mira:
        expect(mira.get_by_role("heading", name="Page not found")).to_be_visible(timeout=LOAD_MS)
    refused(world.api("rosa").get(f"/api/sessions/{world.ses('lastweek')}/summary"), 403, "Only the teacher can do that.")
    refused(world.api("mira").get(f"/api/sessions/{world.ses('lastweek')}/summary"), 404, "Not found.")


def assert_touch_targets(page: Page) -> None:
    for item in page.get_by_role("button").all() + page.get_by_role("tab").all():
        if not item.is_visible():
            continue
        box = item.bounding_box()
        if box is None:
            continue
        name = item.get_attribute("aria-label") or item.inner_text()
        assert round(box["width"]) >= TOUCH_MIN_PX and round(box["height"]) >= TOUCH_MIN_PX, f"{name!r} is {box['width']}x{box['height']}"


def test_phone_panels(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    with visit(browser, app_url, world.api("leo"), f"/sessions/{world.ses('tue')}", size=PHONE) as page:
        tabs = page.get_by_role("tablist", name="Class panels")
        expect(tabs).to_be_visible(timeout=LOAD_MS)
        expect(tabs.get_by_role("tab")).to_have_text(["Seats", "Hands", "Poll", "Chat"])
        seats_tab = tabs.get_by_role("tab", name="Seats")
        expect(seats_tab).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("button", name="Seat B1, taken by Mira Okafor")).to_be_visible()
        expect(page.get_by_role("button", name="Seat D3", exact=True)).to_be_visible()
        expect(page.get_by_role("button", name=re.compile(r"^Seat [A-I]\d+"))).to_have_count(7)
        expect(page.get_by_role("button", name="Raise hand", include_hidden=True)).to_be_hidden()
        expect(room(page).get_by_role("list", name="Seats")).to_be_attached()
        canvas_box = page.get_by_role("img", name="Classroom view").bounding_box()
        assert canvas_box["y"] + canvas_box["height"] <= tabs.bounding_box()["y"] + 1
        hands_tab = tabs.get_by_role("tab", name="Hands")
        tap(hands_tab)
        expect(hands_tab).to_have_attribute("aria-selected", "true")
        expect(page.get_by_role("button", name="Raise hand")).to_be_visible()
        expect(page.get_by_role("button", name="Seat D3", exact=True, include_hidden=True)).to_be_hidden()
        layout(page)


def test_wf_phone_touch_tap_flow(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, leo_id, ana = world.ses("tue"), world.lrn("leo"), world.api("ana")
    with visit(browser, app_url, world.api("leo"), f"/sessions/{sid}", size=PHONE) as page:
        expect(page.get_by_role("tablist", name="Class panels")).to_be_visible(timeout=LOAD_MS)
        assert_touch_targets(page)
        tap(page.get_by_role("button", name="Seat D3", exact=True))
        expect(page.get_by_role("button", name="Seat D3, taken by Leo Brandt")).to_be_visible(timeout=LOAD_MS)
        assert valkey.hash(f"sh:{sid}:seats")["D3"] == leo_id
        tap(page.get_by_role("tab", name="Hands"))
        assert_touch_targets(page)
        tap(page.get_by_role("button", name="Raise hand"))
        poll_until(lambda: hand_ids(snapshot(ana, sid))[-1:] == [leo_id], "tapping Raise hand queued the learner", API_WAIT_S)
        assert valkey.items(f"sh:{sid}:hands")[-1] == leo_id
        tap(page.get_by_role("tab", name="Poll"))
        assert_touch_targets(page)
        option = page.get_by_role("button", name="La carta", exact=True)
        tap(option)
        expect(option).to_have_attribute("aria-pressed", "true", timeout=LOAD_MS)
    assert snapshot(ana, sid)["poll"]["counts"] == [2, 1, 1]
    assert valkey.hash(f"sh:{sid}:poll:{world.poll('bill')}").get("3") == "1"


def test_wf_phone_touch_seat_taken(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("leo"), f"/sessions/{sid}", size=PHONE) as page:
        target = page.get_by_role("button", name="Seat D3", exact=True)
        expect(target).to_be_visible(timeout=LOAD_MS)
        with held(page, "**/api/sessions/*/seat") as gate:
            tap(target)
            ok(world.api("hana", SECOND_URL).post(f"/api/sessions/{sid}/seat", {"seatId": "D3"}), 200)
            gate.release()
        announced(page, "Seat D3 was just taken. Pick another seat.", timeout=LOAD_MS)
        expect(page.get_by_role("button", name="Seat D3, taken by Hana Sato")).to_be_visible(timeout=LIVE_MS)
    assert valkey.hash(f"sh:{sid}:seats")["D3"] == world.lrn("hana")
    assert world.lrn("leo") not in valkey.hash(f"sh:{sid}:seat-of")


def test_spotlight_rules(browser: Browser, valkey: Valkey) -> None:
    spec = reference_world(now=None)
    spec["learners"].append({"key": "nora", "displayName": "Nora Quinn", "session": "tue", "seat": None, "presence": []})
    world = setup_world(TIMERS_URL, spec)
    other = setup_world(TIMERS_URL, reference_world(now=None))
    sid, ana = world.ses("tue"), world.api("ana", TIMERS_URL)
    path = f"/api/sessions/{sid}/spotlight"
    for key in ("mira", "jonas"):
        assert spot(ok(ana.post(path, {"learnerId": world.lrn(key)}), 200)) == world.lrn(key)
        assert valkey.hash(f"sh:{sid}:flags").get("spotlight") == world.lrn(key)
    assert spot(ok(world.api("ben", TIMERS_URL).post(path, {"learnerId": world.lrn("priya")}), 200)) == world.lrn("priya")
    refused(world.api("mira", TIMERS_URL).post(path, {"learnerId": world.lrn("mira")}), 403, "Only the teacher can do that.")
    refused(ana.post(path, {"learnerId": other.lrn("mira")}), 404, "Not found.")
    refused(ana.post(path, {"learnerId": world.lrn("rosa")}), 404, "Not found.")
    refused(ana.post(path, {"learnerId": world.lrn("nora")}), 409, "That learner isn't in the room.")
    assert spot(ok(ana.post(path, {"learnerId": None}), 200)) is None
    assert valkey.hash(f"sh:{sid}:flags").get("spotlight", "") == ""
    ok(ana.post(path, {"learnerId": world.lrn("mira")}), 200)
    with visit(browser, TIMERS_URL, world.api("mira", TIMERS_URL), f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        poll_until(lambda: world.lrn("mira") in valkey.members(f"sh:{sid}:online"), "the learner's WebSocket is online", API_WAIT_S)
    poll_until(lambda: spot(snapshot(ana, sid)) is None, "the spotlight cleared after the learner left past the grace", API_WAIT_S + POLL_SLACK_S)


def test_wf_spotlight_and_lock_coteacher_spotlight(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, SECOND_URL, world.api("ben", SECOND_URL), f"/sessions/{sid}") as ben, \
            visit(browser, app_url, world.api("mira"), f"/sessions/{sid}") as mira:
        wait_mirror(ben, 7)
        wait_mirror(mira, 7)
        expect(ben.get_by_role("button", name="Next slide")).to_be_visible()
        for name in ("End class", "Start class", "Open class"):
            expect(ben.get_by_role("button", name=name)).to_have_count(0)
        expect(ben.get_by_role("switch", name="Lock class")).to_have_count(0)
        ben.get_by_role("button", name="Next slide").click()
        expect(board(mira)).to_have_attribute("data-slide", "2", timeout=LOAD_MS)
        spotlight = ben.get_by_role("list", name="Learners in seats").get_by_role("button", name=f"Spotlight {NAMES['mira']}")
        spotlight.click()
        expect(spotlight).to_have_attribute("aria-pressed", "true", timeout=LOAD_MS)
        announced(mira, "Mira Okafor is in the spotlight.", timeout=LOAD_MS)
        expect(seat(mira, "B1")).to_have_attribute("data-spotlit", "true")
        assert spot(snapshot(world.api("ana"), sid)) == world.lrn("mira")
        ben.get_by_role("button", name="Clear spotlight").click()
        expect(seat(mira, "B1")).to_have_attribute("data-spotlit", "false", timeout=LOAD_MS)
    assert spot(snapshot(world.api("ana"), sid)) is None


def test_wf_spotlight_and_lock_cursor_spotlight(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, ana = world.ses("tue"), world.api("ana")
    with visit(browser, app_url, ana, f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("mira", SECOND_URL), f"/sessions/{sid}") as mira:
        wait_mirror(teacher, 7)
        wait_mirror(mira, 7)
        expect(seat(teacher, "B1")).to_have_attribute("data-selected", "true")
        teacher.get_by_role("button", name="Take next hand").focus()
        teacher.keyboard.press("s")
        poll_until(lambda: spot(snapshot(ana, sid)) == world.lrn("mira"), "S spotlit the learner under the owner's cursor", API_WAIT_S)
        expect(seat(mira, "B1")).to_have_attribute("data-spotlit", "true", timeout=LIVE_MS)
        announced(mira, "Mira Okafor is in the spotlight.")


def test_wf_spotlight_and_lock_lock(browser: Browser, app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, code = world.ses("tue"), world.code("spanish")
    refused(world.api("ben").post(f"/api/sessions/{sid}/lock", {"locked": True}), 403, "Only the teacher can do that.")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("mira", SECOND_URL), f"/sessions/{sid}") as mira, \
            open_app(browser, SECOND_URL + "/join") as newcomer:
        wait_mirror(teacher, 7)
        wait_mirror(mira, 7)
        lock = teacher.get_by_role("switch", name="Lock class")
        lock.focus()
        teacher.keyboard.press("Space")
        expect(lock).to_be_checked(timeout=LOAD_MS)
        announced(mira, "The class is locked.", timeout=LOAD_MS)
        assert valkey.hash(f"sh:{sid}:flags").get("locked") == "1" and snapshot(world.api("ana"), sid)["locked"] is True
        newcomer.get_by_role("textbox", name="Class code").fill(code)
        newcomer.get_by_role("textbox", name="Your name").fill("Leo Brandt")
        newcomer.get_by_role("button", name="Join").click()
        alert_says(newcomer, "This class is locked. Ask your teacher to let you in.")
        assert "/sessions/" not in newcomer.url
        mira.reload()
        expect(seat(mira, "B1")).to_have_attribute("data-occupant-name", "Mira Okafor", timeout=LOAD_MS)
        assert ok(world.api("mira").post("/api/join", {"code": code, "displayName": "Mira Okafor"}), 200)["sessionId"] == sid
        lock.click()
        expect(lock).not_to_be_checked(timeout=LOAD_MS)
        announced(mira, "The class is unlocked.", timeout=LOAD_MS)
        assert valkey.hash(f"sh:{sid}:flags").get("locked") == "0"
        newcomer.get_by_role("button", name="Join").click()
        expect(newcomer.get_by_role("heading", name="Evening Spanish B1")).to_be_visible(timeout=LOAD_MS)


def test_roles_matrix(app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, cid, lid, last = world.ses("tue"), world.cls("spanish"), world.lesson("week3"), world.ses("lastweek")
    ben, mira, ana = world.api("ben", SECOND_URL), world.api("mira"), world.api("ana")
    ok(ben.post(f"/api/sessions/{sid}/slide", {"slide": 2}), 200)
    assert ok(ben.post(f"/api/sessions/{sid}/hands/next"), 200)["took"]["learnerId"] == world.lrn("priya")
    ok(ben.post(f"/api/polls/{world.poll('bill')}/close"), 200)
    new_poll = ok(ben.post(f"/api/sessions/{sid}/polls", {"question": "Which word means the bill?", "options": BILL_OPTIONS}), 201)["pollId"]
    ok(ben.post(f"/api/sessions/{sid}/spotlight", {"learnerId": world.lrn("mira")}), 200)
    for path in (f"/api/sessions/{last}/attendance", f"/api/sessions/{last}/summary", f"/api/sessions/{last}/review"):
        ok(ben.get(path), 200)
    teacher_only = "Only the teacher can do that."
    ben_refused = [
        ben.put(f"/api/classes/{cid}/layout", SPANISH_LAYOUT),
        ben.post(f"/api/classes/{cid}/lessons", {"title": "Week 1: Offer and acceptance"}),
        upload(ben, lid, [("x.png", png_bytes())]),
        ben.delete(f"/api/lessons/{lid}/files/{world.slides('week3')[0]}"),
        ben.put(f"/api/lessons/{lid}/order", {"slideIds": world.slides("week3")}),
        ben.post(f"/api/lessons/{lid}/ready"),
        ben.post(f"/api/classes/{cid}/sessions", {"lessonId": lid, "startsAt": "2027-03-09T19:00", "endsAt": "2027-03-09T20:30"}),
        ben.post(f"/api/sessions/{sid}/open"), ben.post(f"/api/sessions/{sid}/start"), ben.post(f"/api/sessions/{sid}/end"),
        ben.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), ben.post(f"/api/sessions/{sid}/breakouts/extend"),
        ben.post(f"/api/sessions/{sid}/lock", {"locked": True}),
        ben.post(f"/api/classes/{cid}/co-teachers", {"email": world.spec["teachers"][2]["email"]}),
    ]
    for response in ben_refused:
        refused(response, 403, teacher_only)
    mira_refused = [
        mira.post(f"/api/sessions/{sid}/slide", {"slide": 1}), mira.post(f"/api/sessions/{sid}/hands/next"),
        mira.post(f"/api/sessions/{sid}/polls", {"question": "Which word means the bill?", "options": BILL_OPTIONS}),
        mira.post(f"/api/polls/{new_poll}/close"), mira.post(f"/api/sessions/{sid}/spotlight", {"learnerId": None}),
        mira.post(f"/api/sessions/{sid}/lock", {"locked": True}), mira.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}),
        mira.post(f"/api/sessions/{sid}/breakouts/extend"), mira.post(f"/api/sessions/{sid}/end"),
        mira.get(f"/api/sessions/{sid}/attendance"), mira.get(f"/api/sessions/{sid}/summary"),
    ]
    for response in mira_refused:
        refused(response, 403, teacher_only)
    for response in (mira.get(f"/api/classes/{cid}"), mira.get(f"/api/lessons/{lid}"), mira.post(f"/api/classes/{cid}/lessons", {"title": "x"})):
        refused(response, 404, "Not found.")
    snap = snapshot(ana, sid)
    assert snap["locked"] is False and snap["state"] == "live" and snap["slide"]["current"] == 2
    ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
    ok(ben.get(f"/api/sessions/{sid}/tables/T2/chat"), 200)
    refused(ben.post(f"/api/sessions/{sid}/tables/T1/chat", {"text": "Hola"}), 403, teacher_only)


def test_wf_roles_and_privacy_coteacher_view(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, SECOND_URL, world.api("ben", SECOND_URL), f"/classes/{world.cls('spanish')}") as ben:
        expect(ben.get_by_role("heading", name="Evening Spanish B1")).to_be_visible(timeout=LOAD_MS)
        expect(ben.get_by_role("region", name="Lessons").get_by_role("list", name="Lessons")).to_contain_text("Week 3: At the restaurant")
    with visit(browser, SECOND_URL, world.api("ben", SECOND_URL), f"/sessions/{sid}", reduced_motion="reduce") as ben:
        wait_mirror(ben, 7)
        expect(room(ben)).to_have_attribute("data-motion", "reduced")
        expect(ben.get_by_role("switch", name="Lock class")).to_have_count(0)
        expect(ben.get_by_role("button", name="End class")).to_have_count(0)
        ben.get_by_role("button", name="Take next hand").focus()
        ben.keyboard.press("t")
        announced(ben, "Priya Raman has the floor.", timeout=LOAD_MS)
        expect(seat(ben, "B5")).to_have_attribute("data-hand", "down", timeout=LIVE_MS)
    refused(world.api("mira").post(f"/api/sessions/{sid}/slide", {"slide": 2}), 403, "Only the teacher can do that.")
    assert snapshot(world.api("ana"), sid)["slide"]["current"] == 1


def test_wf_roles_and_privacy_coteacher_sheet(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, SECOND_URL, world.api("ben", SECOND_URL), f"/sessions/{sid}", size=TABLET) as ben:
        wait_mirror(ben, 7)
        ben.get_by_role("button", name="Class panel").click()
        advance(ben, SHEET_SETTLE_MS)
        sheet = ben.get_by_role("dialog", name="Class panel")
        expect(sheet).to_be_visible()
        for name in ("Hands", "Poll", "Breakout", "Table chat"):
            expect(sheet.get_by_role("region", name=name)).to_be_attached()
        sheet.get_by_role("region", name="Hands").get_by_role("button", name="Take next hand").click()
        poll_until(lambda: hand_ids(snapshot(world.api("ana"), sid)) == [world.lrn("jonas")], "the sheet's Take next hand took Priya", API_WAIT_S)
        announced(ben, "Priya Raman has the floor.", timeout=LOAD_MS)


def test_private_by_default(app_url: str) -> None:
    a = setup_world(app_url, reference_world())
    b = setup_world(app_url, reference_world())
    nf = "Not found."
    clara = a.api("clara")
    sid, cid, lid = a.ses("tue"), a.cls("spanish"), a.lesson("week3")
    for response in (clara.get(f"/api/classes/{cid}"), clara.get(f"/api/lessons/{lid}"), clara.get(f"/api/sessions/{sid}"),
                     clara.get(f"/api/files/{a.slides('week3')[0]}"), clara.get(f"/api/sessions/{a.ses('lastweek')}/review"),
                     clara.post(f"/api/sessions/{sid}/slide", {"slide": 2}), clara.put(f"/api/classes/{cid}/layout", SPANISH_LAYOUT),
                     clara.post(f"/api/polls/{a.poll('bill')}/close"),
                     clara.get(f"/ws/sessions/{sid}", headers={"Connection": "Upgrade", "Upgrade": "websocket", "Sec-WebSocket-Version": "13",
                                                               "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ=="})):
        refused(response, 404, nf)
    ana = a.api("ana")
    for response in (ana.get(f"/api/classes/{b.cls('spanish')}"), ana.get(f"/api/sessions/{b.ses('tue')}"),
                     ana.get(f"/api/files/{b.slides('week3')[0]}"), ana.post(f"/api/sessions/{sid}/spotlight", {"learnerId": b.lrn("mira")})):
        refused(response, 404, nf)
    assert b.cls("spanish") not in {c["id"] for c in ok(ana.get("/api/classes"), 200)["classes"]}
    mira = a.api("mira")
    for response in (mira.get(f"/api/sessions/{a.ses('lawmon')}"), mira.get(f"/api/sessions/{a.ses('lawmon')}/review"),
                     mira.get(f"/api/files/{a.slides('week1')[0]}"), mira.post(f"/api/polls/{b.poll('bill')}/answer", {"option": 1})):
        refused(response, 404, nf)
    for key in ("ines", "felix"):
        refused(a.api(key).get(f"/api/sessions/{a.ses('lastweek')}/review"), 404, nf)
        refused(a.api(key).get(f"/api/files/{a.slides('week3')[0]}"), 404, nf)
    ok(ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
    refused(mira.get(f"/api/sessions/{sid}/tables/T2/chat"), 404, nf)
    refused(mira.post(f"/api/sessions/{sid}/tables/T2/chat", {"text": "Hola"}), 404, nf)
    refused(a.api("leo").get(f"/api/sessions/{sid}/tables/T1/chat"), 404, nf)
    assert ok(a.api("jonas").get(f"/api/sessions/{sid}/tables/T2/chat"), 200)["messages"] == []
    refused(Api(app_url).get(f"/api/classes/{cid}"), 401, "Sign in first.")


def test_wf_roles_and_privacy_other_teacher(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    paths = [f"/classes/{world.cls('spanish')}", f"/classes/{world.cls('spanish')}/room", f"/lessons/{world.lesson('week3')}",
             f"/sessions/{world.ses('tue')}", "/no-such-page"]
    with visit(browser, app_url, world.api("clara"), paths[0]) as page:
        for path in paths:
            page.goto(app_url.rstrip("/") + path)
            expect(page.get_by_role("heading", name="Page not found")).to_be_visible(timeout=LOAD_MS)
            expect(page.get_by_text("We couldn't find that page.")).to_be_visible()
            expect(page.get_by_role("heading", name="Evening Spanish B1")).to_have_count(0)


def test_live_bus_outage_api(app_url: str, valkey: Valkey) -> None:
    world = setup_world(app_url, reference_world())
    sid, paused = world.ses("tue"), "Live updates are paused. Try again in a moment."
    ana, mira = world.api("ana", VALKEY_DOWN_URL), world.api("mira", VALKEY_DOWN_URL)
    assert ok(httpx.get(VALKEY_DOWN_URL + "/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "unavailable"}
    assert snapshot(ana, sid)["live"] is False
    for response in (ana.post(f"/api/sessions/{sid}/slide", {"slide": 2}), ana.post(f"/api/sessions/{sid}/lock", {"locked": True}),
                     ana.post(f"/api/sessions/{sid}/spotlight", {"learnerId": world.lrn("mira")}), ana.post(f"/api/sessions/{sid}/hands/next"),
                     ana.post(f"/api/polls/{world.poll('bill')}/close"), ana.post(f"/api/sessions/{sid}/breakouts", {"tables": 2}),
                     mira.post(f"/api/sessions/{sid}/seat", {"seatId": "D3"}), mira.post(f"/api/sessions/{sid}/hand", {"raised": True}),
                     mira.post(f"/api/polls/{world.poll('bill')}/answer", {"option": 3})):
        refused(response, 503, paused)
    snap = snapshot(world.api("ana"), sid)
    assert snap["live"] is True and snap["slide"]["current"] == 1 and snap["locked"] is False and spot(snap) is None
    assert hand_ids(snap) == [world.lrn("priya"), world.lrn("jonas")] and seat_of(snap, world.lrn("mira")) == "B1"
    assert snap["poll"]["state"] == "open" and snap["poll"]["counts"] == [2, 1, 0]
    assert valkey.command("GET", f"sh:{sid}:slide") == "1"
    ok(world.api("ana").post(f"/api/sessions/{sid}/slide", {"slide": 2}), 200)


def test_wf_outage_and_review_bus_returns(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    banner = "Live updates are paused. Your class will resume on its own."
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as teacher, \
            visit(browser, SECOND_URL, world.api("mira", SECOND_URL), f"/sessions/{sid}") as mira:
        wait_mirror(teacher, 7)
        wait_mirror(mira, 7)
        with outage(SECOND_URL, "valkey"):
            alert_says(mira, banner)
            refused(world.api("mira", SECOND_URL).post(f"/api/sessions/{sid}/hand", {"raised": True}), 503, "Live updates are paused. Try again in a moment.")
            assert snapshot(world.api("mira", SECOND_URL), sid)["live"] is False
            ok(world.api("ana").post(f"/api/sessions/{sid}/slide", {"slide": 2}), 200)
            expect(board(teacher)).to_have_attribute("data-slide", "2", timeout=LIVE_MS)
            stays(board(mira), "data-slide", "1", LIVE_MS)
        expect(mira.get_by_role("alert").filter(has_text=exactly(banner))).to_have_count(0, timeout=RECOVER_MS)
        announced(mira, "Live updates are back.", timeout=RECOVER_MS)
        expect(board(mira)).to_have_attribute("data-slide", "2", timeout=RECOVER_MS)
    assert snapshot(world.api("mira", SECOND_URL), sid)["live"] is True


def test_wf_outage_and_review_valkey_down_boot(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, VALKEY_DOWN_URL, world.api("ana", VALKEY_DOWN_URL), f"/sessions/{sid}") as page:
        alert_says(page, "Live updates are paused. Your class will resume on its own.")
        page.get_by_role("button", name="Next slide").click()
        announced(page, "Live updates are paused. Try again in a moment.", timeout=LOAD_MS)
    assert snapshot(world.api("ana"), sid)["slide"]["current"] == 1


def test_wf_outage_and_review_review(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    last, lid = world.ses("lastweek"), world.lesson("week3")
    rosa = world.api("rosa")
    review = ok(rosa.get(f"/api/sessions/{last}/review"), 200)
    assert review["lessonTitle"] == "Week 3: At the restaurant"
    assert [(s["fileId"], s["number"], s["url"]) for s in review["slides"]] == [(f, n, f"/api/files/{f}") for n, f in enumerate(world.slides("week3"), 1)]
    assert [m["fileId"] for m in review["models"]] == world.models("week3")
    with visit(browser, app_url, rosa, f"/review/{last}") as page:
        expect(page.get_by_role("heading", name=f"Review: {review['lessonTitle']}")).to_be_visible(timeout=LOAD_MS)
        prev, nxt = page.get_by_role("button", name="Previous slide"), page.get_by_role("button", name="Next slide")
        expect(page.get_by_text("Slide 1 of 3")).to_be_visible()
        expect(prev).to_be_disabled()
        image = page.get_by_role("img", name="Slide 1")
        assert fetch_bytes(page, image.get_attribute("src")) == S3().get(f"lessons/{lid}/{world.slides('week3')[0]}")
        nxt.click()
        expect(page.get_by_text("Slide 2 of 3")).to_be_visible()
        page.keyboard.press("ArrowRight")
        expect(page.get_by_text("Slide 3 of 3")).to_be_visible()
        expect(page.get_by_role("img", name="Slide 3")).to_be_visible()
        expect(nxt).to_be_disabled()
        page.keyboard.press("ArrowLeft")
        expect(page.get_by_text("Slide 2 of 3")).to_be_visible()
        link = page.get_by_role("list", name="Models").get_by_role("link", name=f"Download model {review['models'][0]['number']}")
        served = page.request.get(urljoin(page.url, link.get_attribute("href")))
        assert served.body() == S3().get(f"lessons/{lid}/{world.models('week3')[0]}")
        assert served.headers["content-type"].startswith("model/gltf-binary")
    with visit(browser, app_url, world.api("ines"), f"/review/{last}") as page:
        expect(page.get_by_role("heading", name="Page not found")).to_be_visible(timeout=LOAD_MS)
    refused(rosa.get(f"/api/files/{world.slides('week1')[0]}"), 404, "Not found.")
    refused(rosa.get(f"/api/sessions/{world.ses('lawmon')}/review"), 404, "Not found.")
    refused(world.api("mira").get(f"/api/sessions/{world.ses('tue')}/review"), 409, "Review opens when the class ends.")
    ok(world.api("ana").get(f"/api/sessions/{last}/review"), 200)


def test_reduced_motion(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}", reduced_motion="reduce") as page:
        wait_mirror(page, 7)
        expect(room(page)).to_have_attribute("data-motion", "reduced")
        canvas = page.get_by_role("img", name="Classroom view")
        expect(canvas).to_be_visible(timeout=LOAD_MS)
        advance(page, MODEL_TURN_WINDOW_MS)
        still = camera(page)
        advance(page, MODEL_TURN_WINDOW_MS)
        assert camera(page) == still, "the scene moved under reduced motion while nothing changed"
        assert animations(room(page)) == []
        box = canvas.bounding_box()
        cx, cy = box["x"] + box["width"] / 2, box["y"] + box["height"] / 2
        page.mouse.move(cx, cy)
        page.mouse.down()
        page.mouse.move(cx + DRAG_PX, cy, steps=8)
        page.mouse.up()
        advance(page, DIALOG_SETTLE_MS)
        assert camera(page) != still, "dragging did not orbit the camera under reduced motion"

        ok(world.api("ana").post(f"/api/sessions/{sid}/breakouts", {"tables": 2}), 201)
        expect(table_item(page, "T1")).to_have_attribute("data-breakout-remaining", str(BREAKOUT_SECONDS), timeout=LIVE_MS)
        advance(page, COUNTDOWN_STEP_MS)
        expect(table_item(page, "T1")).to_have_attribute("data-breakout-remaining", str(BREAKOUT_SECONDS - COUNTDOWN_STEP_MS // 1000))
        world.clock(world.now + timedelta(seconds=BREAKOUT_SECONDS))
        expect(seat(page, "B1")).to_have_attribute("data-breakout-table", "", timeout=LIVE_MS)
        expect(room(page)).to_have_attribute("data-returning", "false")
        advance(page, RETURN_STILL_WALKING_MS)
        expect(room(page)).to_have_attribute("data-returning", "false")
        expect(board(page)).to_have_attribute("data-dimmed", "false")


def test_health_and_instances(app_url: str) -> None:
    primary = httpx.get(app_url.rstrip("/") + "/api/health", timeout=HTTP_TIMEOUT)
    assert ok(primary, 200) == {"status": "ok"} and primary.headers["x-slatehall-instance"] == "a"
    second = httpx.get(SECOND_URL + "/api/health", timeout=HTTP_TIMEOUT)
    assert ok(second, 200) == {"status": "ok"} and second.headers["x-slatehall-instance"] == "b"
    assert httpx.get(app_url.rstrip("/") + "/api/no-such-route", timeout=HTTP_TIMEOUT).headers.get("x-slatehall-instance") == "a"
    for base in (MINIO_DOWN_URL, VALKEY_DOWN_URL):
        assert ok(httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "unavailable"}
    for service in ("valkey", "minio"):
        with outage(SECOND_URL, service):
            assert ok(httpx.get(SECOND_URL + "/api/health", timeout=HTTP_TIMEOUT), 200) == {"status": "unavailable"}
        poll_until(lambda: httpx.get(SECOND_URL + "/api/health", timeout=HTTP_TIMEOUT).json() == {"status": "ok"},
                   f"health returned to ok after the {service} outage ended", RECOVER_MS / 1000 + POLL_SLACK_S)


def test_grading_routes_and_worlds(app_url: str) -> None:
    for path, body in (("/api/grading/setup", reference_world()), ("/api/grading/sign-in", {"token": "x"}),
                       ("/api/grading/clock", {"worldId": "x", "now": None}), ("/api/grading/outage", {"service": "minio", "down": False})):
        for key in ("", "wrong-key"):
            refused(grading_post(app_url, path, body, key=key), 404, "Not found.")
    refused(grading_post(app_url, "/api/grading/outage", {"service": "postgres", "down": True}), 422, "Choose valkey or minio.")

    spec = reference_world()
    spec["breakouts"] = [{"session": "tue", "tables": 2}]
    a = setup_world(app_url, spec)
    ids = a.ids
    assert set(ids["learners"]) == {p["key"] for p in REFERENCE["learners"]}
    assert set(ids["signInTokens"]) == {"ana", "ben", "clara"} | set(ids["learners"])
    for key, lesson in (("week3", (3, 1)), ("week1", (2, 0))):
        assert (len(a.slides(key)), len(a.models(key))) == lesson
        for fid in a.slides(key):
            decode(S3().get(f"lessons/{a.lesson(key)}/{fid}"))
        for fid in a.models(key):
            data = S3().get(f"lessons/{a.lesson(key)}/{fid}")
            assert data[:4] == b"glTF" and struct.unpack("<I", data[4:8])[0] == 2
    lesson = ok(a.api("ana").get(f"/api/lessons/{a.lesson('week3')}"), 200)
    assert lesson["state"] == "ready" and [s["name"] for s in lesson["slides"]] == ["slide-1.png", "slide-2.png", "slide-3.png"]
    assert [m["name"] for m in lesson["models"]] == ["model-1.glb"]
    snap = snapshot(a.api("ana"), a.ses("tue"))
    assert snap["slide"] == {"current": 1, "total": 3, "fileId": a.slides("week3")[0]} and snap["modelFileId"] == a.models("week3")[0]
    assert snap["breakout"]["remainingSeconds"] == BREAKOUT_SECONDS
    assert snapshot(a.api("clara"), a.ses("lawmon"))["state"] == "ended"
    refused(grading_post(app_url, "/api/grading/sign-in", {"token": ids["signInTokens"]["ana"]}), 404, "Not found.")
    refused(grading_post(app_url, "/api/grading/sign-in", {"token": "tok_unknown"}), 404, "Not found.")

    b = setup_world(app_url, copy.deepcopy(spec) | {"teachers": [dict(t, email=fresh_email(t["key"])) for t in spec["teachers"]]})
    moved = a.clock(a.now + timedelta(seconds=60))
    assert moved["worldId"] == a.id and at(moved["now"]) == a.now + timedelta(seconds=60) and at(moved["now"]).utcoffset() == timedelta(0)
    assert snapshot(a.api("ana"), a.ses("tue"))["breakout"]["remainingSeconds"] == BREAKOUT_SECONDS - 60
    assert snapshot(b.api("ana"), b.ses("tue"))["breakout"]["remainingSeconds"] == BREAKOUT_SECONDS
    set_back = ok(grading_post(app_url, "/api/grading/clock", {"worldId": a.id, "now": "2027-03-09T19:04:59-06:00"}), 200)
    assert at(set_back["now"]) == at("2027-03-09T19:04:59-06:00")
    refused(a.api("ana").get(f"/api/classes/{b.cls('spanish')}"), 404, "Not found.")
    assert b.cls("spanish") not in {c["id"] for c in ok(a.api("ana").get("/api/classes"), 200)["classes"]}

    code = "".join(secrets.choice(CODE_ALPHABET) for _ in range(6))
    minimal = {"teachers": [{"key": "ana", "email": fresh_email("ana"), "password": TEACHER_PASSWORD, "displayName": "Ana Reyes"}],
               "classes": [{"key": "spanish", "teacher": "ana", "coTeachers": [], "title": "Evening Spanish B1", "timeZone": "America/Chicago", "code": code}],
               "lessons": [], "sessions": [], "learners": [], "hands": [], "polls": [], "breakouts": []}
    assert setup_world(app_url, minimal).code("spanish") == code
    minimal["teachers"][0]["email"] = fresh_email("ana")
    refused(grading_post(app_url, "/api/grading/setup", minimal), 409, f"Class code {code} is already in use.")
    broken = reference_world()
    broken["classes"][0]["timeZone"] = "Mars/Olympus"
    response = grading_post(app_url, "/api/grading/setup", broken)
    assert response.status_code == 422 and "timeZone" in response.json()["error"]


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    email = fresh_email("ana")
    body = {"email": email, "password": TEACHER_PASSWORD, "displayName": "Ana Reyes"}
    refused(Api(base).post("/api/teachers", body, headers={"Origin": FOREIGN_ORIGIN}), 403, "Cross-site requests are refused.")
    refused(Api(base).post("/api/sign-in", {"email": email, "password": "x"}, headers={"Origin": FOREIGN_ORIGIN}), 403, "Cross-site requests are refused.")
    refused(Api(base).post("/api/teachers", {"email": email, "password": "y" * JSON_LIMIT, "displayName": "Ana Reyes"}), 413, "That request is too large.")
    refused(Api(base).post("/api/teachers", content="email=a", headers={"Content-Type": "application/x-www-form-urlencoded"}), 415, "Send JSON.")
    ok(Api(base).post("/api/teachers", body), 201)
    for path in ("/run.json", "/package.json", "/package-lock.json", "/.env", "/tsconfig.json", "/node_modules/.package-lock.json",
                 "/src/server.ts", "/api/no-such-route"):
        response = httpx.get(base + path, timeout=HTTP_TIMEOUT)
        assert response.status_code == 404, f"{path} answered {response.status_code}"
        assert "run-manifest-v1" not in response.text
    refused(httpx.get(base + "/api/no-such-route", timeout=HTTP_TIMEOUT), 404, "Not found.")
    html = httpx.get(base + "/", timeout=HTTP_TIMEOUT, follow_redirects=True).text
    assets = {urljoin(base + "/", src) for src in re.findall(r'(?:src|href)="([^"]+\.(?:js|css|mjs))"', html)}
    secrets_set = [os.environ[v] for v in ("GRADING_KEY", "DATABASE_URL", "VALKEY_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "S3_ENDPOINT")
                   if len(os.environ.get(v, "")) >= 6]
    texts = [html] + [httpx.get(url, timeout=HTTP_TIMEOUT).text for url in assets]
    for value in secrets_set:
        assert all(value not in text for text in texts), "a configured secret or service URL is served to the browser"
    for url in assets:
        if url.endswith("js"):
            assert httpx.get(url + ".map", timeout=HTTP_TIMEOUT).status_code == 404


def test_classroom_mirror_and_webgl(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, lrn = world.ses("tue"), world.lrn
    requests: list[str] = []
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}", record=requests) as page:
        wait_mirror(page, 7, timeout=PAGE_READY_MS)
        region = room(page)
        expect(region).to_have_attribute("data-webgl", "on")
        expect(region).to_have_attribute("data-motion", "animated")
        b1 = seat(page, "B1")
        for attr, value in (("data-table", "T1"), ("data-row", "2"), ("data-column", "0"), ("data-occupant", lrn("mira")),
                            ("data-occupant-name", "Mira Okafor"), ("data-hand", "down"), ("data-spotlit", "false"), ("data-breakout-table", "")):
            expect(b1).to_have_attribute(attr, value)
        expect(seat(page, "B5")).to_have_attribute("data-hand", "raised")
        expect(seat(page, "E8")).to_have_attribute("data-table", "")
        expect(seat(page, "E8")).to_have_attribute("data-occupant", "")
        expect(region.get_by_role("list", name="Tables").get_by_role("listitem")).to_have_count(3)
        for tid, row, column in (("T1", "2", "1"), ("T2", "2", "5"), ("T3", "4", "1")):
            expect(table_item(page, tid)).to_have_attribute("data-row", row)
            expect(table_item(page, tid)).to_have_attribute("data-column", column)
            expect(table_item(page, tid)).to_have_attribute("data-breakout-remaining", "")
        expect(board(page)).to_have_attribute("data-slide", "1")
        expect(board(page)).to_have_attribute("data-slide-total", "3")
        expect(board(page)).to_have_attribute("data-dimmed", "false")
        expect(board(page)).to_contain_text("Slide 1 of 3")
        expect(page.get_by_role("img", name="Slide 1")).to_be_visible()
        expect(region.locator("[data-model]")).to_have_attribute("data-model-id", world.models("week3")[0])
        canvas = page.get_by_role("img", name="Classroom view")
        frames = scene_frames(canvas)
        assert any(frame["draws"] > 0 for frame in frames), "the WebGL scene drew nothing"
        assert any(f"/api/files/{world.models('week3')[0]}" in url for url in requests), "the lesson model was never fetched"
        before = camera(page)
        advance(page, MODEL_TURN_WINDOW_MS)
        assert camera(page) != before, "the model does not turn while the session is live"
        ok(world.api("ana").post(f"/api/sessions/{sid}/slide", {"slide": 2}), 200)
        expect(board(page)).to_have_attribute("data-slide", "2", timeout=LIVE_MS)
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}", no_webgl=True) as page:
        wait_mirror(page, 7)
        expect(room(page)).to_have_attribute("data-webgl", "off")
        expect(page.get_by_role("status").filter(has_text=exactly("3D view unavailable. The class still works."))).to_be_visible()
        expect(page.get_by_role("img", name="Slide 2")).to_be_visible()
        page.get_by_role("button", name="Next slide").click()
        expect(board(page)).to_have_attribute("data-slide", "3", timeout=LOAD_MS)


def test_class_announcements(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid, mira = world.ses("tue"), world.api("mira")
    hand = f"/api/sessions/{sid}/hand"
    raised = "Mira Okafor raised a hand."
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        paragraphs = announcements(page).get_by_role("paragraph")

        def toggle() -> None:
            ok(mira.post(hand, {"raised": False}), 200)
            expect(seat(page, "B1")).to_have_attribute("data-hand", "down", timeout=LIVE_MS)
            ok(mira.post(hand, {"raised": True}), 200)
            expect(seat(page, "B1")).to_have_attribute("data-hand", "raised", timeout=LIVE_MS)

        ok(mira.post(hand, {"raised": True}), 200)
        announced(page, raised)
        toggle()
        expect(paragraphs.filter(has_text=exactly(raised))).to_have_count(1)
        advance(page, DEDUP_PAST_MS)
        toggle()
        expect(paragraphs.filter(has_text=exactly(raised))).to_have_count(2)
        last = ""
        for step in range(ANNOUNCE_KEEP + 2):
            number = step % 3 + 2 if step % 3 != 2 else 1
            ok(world.api("ana").post(f"/api/sessions/{sid}/slide", {"slide": number}), 200)
            expect(board(page)).to_have_attribute("data-slide", str(number), timeout=LIVE_MS)
            last = f"Slide {number} of 3."
            announced(page, last)
        expect(paragraphs).to_have_count(ANNOUNCE_KEEP)
        expect(paragraphs.last).to_have_text(exactly(last))
        expect(paragraphs.filter(has_text=exactly(raised))).to_have_count(0)


def test_tablet_and_desktop_layout(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    sid = world.ses("tue")
    with visit(browser, app_url, world.api("ana"), f"/sessions/{sid}") as page:
        wait_mirror(page, 7)
        area = room(page).bounding_box()
        assert 0.5 * DESKTOP[0] <= area["width"] <= DESKTOP[0] * 2 / 3, f"classroom width {area['width']}"
        tops = []
        for name in ("Hands", "Poll", "Breakout", "Table chat"):
            box = page.get_by_role("region", name=name).bounding_box()
            assert box["x"] >= area["x"] + area["width"] - 1, f"{name} panel is not right of the classroom"
            tops.append(box["y"])
        assert tops == sorted(tops), f"rail panels out of order: {tops}"
        bar = page.get_by_role("button", name="Next slide").bounding_box()
        assert bar["y"] + bar["height"] <= area["y"] + 1
        expect(page.get_by_role("button", name="Class panel")).to_have_count(0)
        layout(page)

        page.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        opener = page.get_by_role("button", name="Class panel")
        expect(opener).to_be_visible()
        sheet = page.get_by_role("dialog", name="Class panel")
        assert gone(sheet, TABLET[1])
        layout(page)
        opener.click()
        advance(page, SHEET_SETTLE_MS)
        expect(sheet).to_be_visible()
        top = sheet.bounding_box()["y"]
        assert 0.25 * TABLET[1] <= top <= 0.55 * TABLET[1], f"sheet top at {top}"
        assert sheet.evaluate("d => d.contains(document.activeElement)"), "opening the sheet did not move focus into it"
        for name in ("Hands", "Poll", "Breakout", "Table chat"):
            expect(sheet.get_by_role("region", name=name)).to_be_attached()
        page.keyboard.press("Shift+Tab")
        assert sheet.evaluate("d => d.contains(document.activeElement)"), "Shift+Tab escaped the sheet"
        page.keyboard.press("Escape")
        advance(page, SHEET_SETTLE_MS)
        assert gone(sheet, TABLET[1]), "the sheet stayed on screen after Escape"
        expect(opener).to_be_focused()

    anonymous = ["/sign-in", "/sign-up", "/join", "/no-such-page"]
    teacher = ["/classes", f"/classes/{world.cls('spanish')}", f"/classes/{world.cls('spanish')}/room",
               f"/lessons/{world.lesson('week3')}", f"/sessions/{sid}", f"/sessions/{world.ses('lastweek')}/summary"]
    for api, paths in ((None, anonymous), (world.api("ana"), teacher), (world.api("rosa"), [f"/review/{world.ses('lastweek')}"])):
        with visit(browser, app_url, api, paths[0]) as page:
            for size in (PHONE, TABLET, DESKTOP):
                page.set_viewport_size({"width": size[0], "height": size[1]})
                for path in paths:
                    page.goto(app_url.rstrip("/") + path)
                    expect(page.get_by_role("heading").first).to_be_visible(timeout=LOAD_MS)
                    layout(page)


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for field in ("install", "build", "serve"):
        assert isinstance(manifest[field], str) and manifest[field].strip()


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [f"{p.name}@{p.version}" for p in shipped_packages() if p.name not in notices or p.version not in notices]
    assert not missing, f"packages missing from THIRD_PARTY_NOTICES.md: {missing[:20]}"


def test_if_licences_allowed() -> None:
    bad = [f"{p.name} ({p.licence})" for p in shipped_packages() if not licence_allowed(p.licence or "", ALLOWLIST)]
    assert not bad, f"disallowed licences: {bad}"


def test_if_backing_services() -> None:
    package = json.loads((APP / "package.json").read_text())
    deps = set(package.get("dependencies", {})) | set(package.get("devDependencies", {}))
    forbidden = {"sqlite3", "better-sqlite3", "mongodb", "mongoose", "mysql", "mysql2", "pg-mem", "ioredis-mock", "redis-memory-server",
                 "nodemailer", "amqplib", "kafkajs", "lowdb", "nedb", "level", "pdfkit", "puppeteer", "memcached", "lokijs"}
    assert not deps & forbidden, f"extra backing services: {deps & forbidden}"
    assert Postgres().tables(), "the app created no tables in Postgres"


def test_if_service_config_from_environment() -> None:
    values = [os.environ[v] for v in ("DATABASE_URL", "VALKEY_URL", "S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "GRADING_KEY")
              if len(os.environ.get(v, "")) >= 6]
    for path in APP.rglob("*"):
        if any(part in {"node_modules", ".git", "dist", "build"} for part in path.parts):
            continue
        if path.is_file() and path.suffix in {".ts", ".tsx", ".js", ".mjs", ".cjs"} and path.stat().st_size < 2_000_000:
            text = path.read_text(errors="ignore")
            assert all(v not in text for v in values), f"{path} hard-codes a service setting"


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    world = setup_world(app_url, reference_world())
    requests: list[str] = []
    with visit(browser, app_url, world.api("ana"), f"/sessions/{world.ses('tue')}", record=requests) as page:
        wait_mirror(page, 7)
        for path in ("/sign-in", f"/classes/{world.cls('spanish')}", f"/sessions/{world.ses('lastweek')}/summary"):
            page.goto(app_url.rstrip("/") + path)
            expect(page.get_by_role("heading").first).to_be_visible(timeout=LOAD_MS)
    foreign = [u for u in requests if u.startswith("http") and not same_origin(u, origin_of(app_url))]
    assert not foreign, f"cross-origin loads: {foreign[:10]}"


def test_if_lockfile_pins_tree() -> None:
    lock = json.loads((APP / "package-lock.json").read_text())
    entries = lock.get("packages", {})
    unpinned = [f"{p.name}@{p.version}" for p in shipped_packages()
                if not any(k.endswith(f"node_modules/{p.name}") and v.get("version") == p.version for k, v in entries.items())]
    assert not unpinned, f"not pinned by the lockfile: {unpinned[:20]}"
