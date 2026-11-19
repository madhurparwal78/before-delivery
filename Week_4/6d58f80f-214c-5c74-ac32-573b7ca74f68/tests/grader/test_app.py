from __future__ import annotations

import base64
import hashlib
import json
import math
import os
import re
import socket
import ssl
import struct
import subprocess
import threading
import time
import zlib
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable, Iterator
from urllib.parse import parse_qs, urlencode, urljoin, urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Error as PlaywrightError, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    PocketBase,
    Postgres,
    S3,
    advance,
    animations,
    center,
    check as kit_check,
    click as kit_click,
    fill as kit_fill,
    held,
    idempotency_key,
    open_app,
    same_origin,
    session,
    settle,
    shipped_packages as kit_shipped_packages,
    tap as kit_tap,
    unique,
)


STORAGE_DOWN_ENV = "APP_STORAGE_DOWN_URL"
DIRECTORY_DOWN_ENV = "APP_DIRECTORY_DOWN_URL"
CLOCK_ENV = "APP_CLOCK_URL"
APP_DIR = Path("/app")

PASSWORD = "Lintel-demo-2026!"
MARISOL = "marisol.okafor@lintelworks.test"
DEV = "dev.halvorsen@lintelworks.test"
INES = "ines.whitcombe@lintelworks.test"
TOMAS = "tomas.achterberg@lintelworks.test"
AIKO = "aiko.brandt@mesquiterow.test"
CALLUM = "callum.reyes-tran@southerncross-review.test"
ROSA = "rosa.tilden@pimasteel.test"
SEED_PEOPLE = [
    (MARISOL, "Marisol Okafor", "staff", "Lintelworks", "engineer"),
    (DEV, "Dev Halvorsen", "staff", "Lintelworks", "engineer"),
    (INES, "Ines Whitcombe", "staff", "Lintelworks", "controller"),
    (TOMAS, "Tomas Achterberg", "staff", "Lintelworks", "admin"),
    (AIKO, "Aiko Brandt", "partner", "Mesquite Row Architects", None),
    (CALLUM, "Callum Reyes-Tran", "partner", "Southern Cross Review", None),
    (ROSA, "Rosa Tilden", "partner", "Pima Steel Erectors", None),
]
NAMES = {email: name for email, name, *_ in SEED_PEOPLE}
SAGUARO = "2614 Saguaro Medical Office"
RILLITO = "2631 Rillito Bridge Retrofit"
SEED_OWNERS = {SAGUARO: "Marisol Okafor", RILLITO: "Dev Halvorsen"}
SEED_TREE = {
    SAGUARO: {
        "Calculations": ["Gravity calcs rev B.pdf", "Lateral calcs rev A.pdf", "Wind load summary.pdf"],
        "Drawings": [
            "S-101 Foundation Plan.pdf",
            "S-201 Second Floor Framing.pdf",
            "S-202 Roof Framing.pdf",
            "S-501 Typical Details.pdf",
            "S-502 Moment Frame Details.pdf",
        ],
        "Site photos": ["Footing pour 2026-10-14.png", "Rebar inspection 2026-10-21.png"],
        "Issued": ["IFC Set 2026-10-01.pdf", "Transmittal 2026-10-01.pdf"],
        "Reports": [],
    },
    RILLITO: {
        "Calculations": ["Pier capacity check.pdf"],
        "Drawings": ["B-101 General Arrangement.pdf"],
        "Reports": ["Condition survey 2026-09.pdf"],
    },
}
SEED_LOCKED = {"S-101 Foundation Plan.pdf", "S-201 Second Floor Framing.pdf"}
SEED_BIN_FILE = "Old site photo 2026-08-30.png"
SEED_POLICY_FROM = "2026-01-01"
SEED_RETENTION_DAYS = 30
SEED_POLICY_DAYS = 30
SEED_AIKO_DAYS = 30
SEED_CALLUM_VIEWER_DAYS = 60
SEED_CALLUM_EDITOR_DAYS = 14
SEED_ROSA_VIEWER_DAYS = 7
SEED_ROSA_EDITOR_DAYS = 3
SEED_HANDOVER_DAYS = 7
SEED_FILE_MAX_BYTES = 200000

PART_SIZE = 5242880
JSON_LIMIT = 65536
MAX_FILE_BYTES = 2000000000
UPLOAD_TTL_S = 86400
LINK_TTL_S = 60
GRANT_MAX_DAYS = 365
BIN_MAX_DAYS = 90
HANDOVER_MAX_DAYS = 14
HANDOVER_DIALOG_DAYS = 7
SHORT_RETENTION_DAYS = 14
NAME_MAX = 120
Q_MAX = 100
PEOPLE_MAX = 20
RECENT_MAX = 50
PUSH_S = 2
EXPIRY_PUSH_S = 10
STATUS_PROBE_S = 10
CHIP_FLIGHT_MAX_MS = 1000
CHIP_CAP = 8
CURVE_MIN_RATIO = 0.1
TYPEAHEAD_RESET_MS = 500
PICKER_PAUSE_MS = 300
LONG_PRESS_MS = 500
TOUCH_TARGET_PX = 44
PHOENIX = timezone(timedelta(hours=-7))
VIEWPORTS = {"phone": (375, 812), "tablet": (768, 1024), "desktop": (1280, 800)}
VIEWPORT_IDS = ["phone", "tablet", "desktop"]

STORAGE_OUTAGE = "File storage is unreachable. Uploads are paused and previews are unavailable until it returns."
PREVIEW_OUTAGE = "Preview unavailable while file storage is unreachable."
SIGN_IN_OUTAGE = (
    "Sign-in is unavailable while the people directory is unreachable. Anyone already signed in can keep working."
)
PICKER_OUTAGE = "The people directory is unreachable. Existing access is unchanged. Try again in a moment."
WRONG_CREDENTIALS = "Email or password is incorrect."
UNAVAILABLE_FOLDER = "This folder is not available to you."
NO_PREVIEW = "No preview for this file type."
FOOTNOTE = "All dates and times are Phoenix time."
ANOTHER_FOLDER = "another folder"
STAFF_ONLY_GRANTS = "Only outside partners get timed access."
DATE_AFTER_TODAY = "Choose a date after today."
BIN_DAYS_RANGE = "Enter whole days from 1 to 90."
HANDOVER_DAYS_RANGE = "Enter whole days from 1 to 14."
OTHER_THAN_OWNER = "Choose a staff member other than the current owner."
BINARY = "application/octet-stream"


SLACK_S = 20
UI_DEADLINE_S = 45
HTTP_TIMEOUT_S = 60
NPM_TIMEOUT_S = 300
POLL_MS = 250
STEP_MS = 100
FRAME_MS = 16
FLIGHT_SETTLE_MS = 100
SETTLE_MS = 1500
CLOCK_TOLERANCE_S = 30
PDF = "application/pdf"
PNG = "image/png"
PART_TAIL = 7
TTL_MARGIN_S = 120
LINK_EARLY_S = 20
DEVICE_SKEW_DAYS = 3
MOVE_RACERS = 6
FOREIGN_ORIGIN = "http://evil.invalid"
JUNK_ID = "zz-not-an-id-0000"
NEVER_SERVED = ["/.env", "/package-lock.json", "/tsconfig.json", "/src/server.ts", "/no-such-screen-xyz"]
LAST_MINUTE = (23, 59, 0)


def env_url(name: str) -> str:
    return os.environ[name].rstrip("/")


def tok() -> str:
    raw = re.sub(r"[^a-z0-9]", "", f"{unique('lt')[0]}{idempotency_key()}".lower())
    return raw[-10:]


def one(items: Any) -> Any:
    found = list(items)
    assert len(found) == 1, found
    return found[0]


def files_word(n: int) -> str:
    return "1 file" if n == 1 else f"{n} files"


def moved_copy(n: int, folder: str, k: int = 0) -> str:
    text = f"Moved {files_word(n)} to {folder}" if n else "No files moved"
    if k:
        text += f". {k} locked {'file' if k == 1 else 'files'} stayed"
    return text


def bin_days(n: int) -> str:
    return "1 day left" if n == 1 else f"{n} days left"


def grant_days(n: int) -> str:
    return "Last day" if n == 0 else bin_days(n)


def human(n: int) -> str:
    if n < 1000:
        return f"{n} B"
    for power, unit in enumerate(["KB", "MB", "GB", "TB"], start=1):
        if n < 1000 ** (power + 1) or unit == "TB":
            return f"{n / 1000 ** power:.2f} {unit}"
    raise AssertionError(n)


def phx(d: date, hour: int = 0, minute: int = 0, second: int = 0) -> datetime:
    return datetime(d.year, d.month, d.day, hour, minute, second, tzinfo=PHOENIX)


def parse_instant(text: str) -> datetime:
    return datetime.fromisoformat(text.replace("Z", "+00:00"))


def phx_minute(text: str) -> str:
    return parse_instant(text).astimezone(PHOENIX).strftime("%Y-%m-%d %H:%M")


def pdf_bytes(label: str, size: int = 0) -> bytes:
    head = f"%PDF-1.4\n% {label}\n".encode()
    tail = b"%%EOF\n"
    return head + b"0" * max(0, size - len(head) - len(tail)) + tail


def png_bytes(seed: int) -> bytes:
    width = height = 8
    rows = b"".join(b"\x00" + bytes((seed + x * 31 + y * 7) % 256 for x in range(width * 3)) for y in range(height))

    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows)) + chunk(b"IEND", b"")


_NO_BODY = object()


class Api:

    def __init__(self, base: str, email: str | None = None, cookie: str | None = None) -> None:
        self.base = base.rstrip("/")
        headers = {"Cookie": f"lintel_session={cookie}"} if cookie else None
        self.http = httpx.Client(base_url=self.base, timeout=HTTP_TIMEOUT_S, headers=headers)
        self.person: dict[str, Any] = {}
        self._cookie = cookie
        if email:
            self.sign_in(email)

    def sign_in(self, email: str, password: str = PASSWORD) -> httpx.Response:
        r = self.http.post("/api/session", json={"email": email, "password": password})
        assert r.status_code == 200, f"sign-in {email}: {r.status_code} {r.text}"
        self.person = r.json()["person"]
        self._cookie = self.http.cookies.get("lintel_session")
        return r

    @property
    def cookie(self) -> str:
        assert self._cookie
        return self._cookie

    def get(self, path: str, **params: Any) -> httpx.Response:
        return self.http.get(path, params=params)

    def post(self, path: str, body: Any = _NO_BODY, headers: dict[str, str] | None = None) -> httpx.Response:
        if body is _NO_BODY:
            return self.http.post(path, headers=headers)
        return self.http.post(path, json=body, headers=headers)

    def patch(self, path: str, body: Any) -> httpx.Response:
        return self.http.patch(path, json=body)

    def put(self, path: str, content: bytes, content_type: str = BINARY) -> httpx.Response:
        return self.http.put(path, content=content, headers={"Content-Type": content_type})

    def delete(self, path: str) -> httpx.Response:
        return self.http.delete(path)


def status_of(r: httpx.Response, code: int, error: str | None = None) -> dict[str, Any]:
    assert r.status_code == code, f"{r.request.method} {r.request.url}: {r.status_code} {r.text}"
    if code == 204:
        return {}
    body = r.json()
    if error is not None:
        assert body.get("error") == error, body
    return body


def person_id(api: Api, email: str) -> str:
    people = status_of(api.get("/api/people", q=email), 200)["people"]
    return one(p for p in people if p["email"] == email)["id"]


def create_folder(api: Api, name: str, parent: str | None = None) -> dict[str, Any]:
    return status_of(api.post("/api/folders", {"parentId": parent, "name": name}), 201)["folder"]


def make_project(api: Api, *labels: str) -> tuple[dict[str, Any], dict[str, dict[str, Any]]]:
    t = tok()
    project = create_folder(api, f"P{t} Project")
    subs = {label: create_folder(api, f"{label}{t}", project["id"]) for label in labels}
    return project, subs


def start_upload(api: Api, folder_id: str, name: str, size: int, content_type: str = PDF,
                 key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else None
    return api.post("/api/uploads", {"folderId": folder_id, "name": name, "size": size,
                                      "contentType": content_type}, headers)


def send_part(api: Api, upload_id: str, n: int, data: bytes) -> httpx.Response:
    return api.put(f"/api/uploads/{upload_id}/parts/{n}", data[(n - 1) * PART_SIZE: n * PART_SIZE])


def upload(api: Api, folder_id: str, name: str, data: bytes, content_type: str = PDF) -> dict[str, Any]:
    up = status_of(start_upload(api, folder_id, name, len(data), content_type), 201)["upload"]
    for n in range(1, up["partCount"] + 1):
        status_of(send_part(api, up["id"], n, data), 200)
    return status_of(api.post(f"/api/uploads/{up['id']}/complete"), 201)["file"]


def upload_pdf(api: Api, folder_id: str, label: str, size: int = 0) -> dict[str, Any]:
    name = f"{label} {tok()}.pdf"
    return upload(api, folder_id, name, pdf_bytes(name, size))


def give(api: Api, item_type: str, item_id: str, email: str, role: str, end: date | None = None) -> dict[str, Any]:
    body: dict[str, Any] = {"itemType": item_type, "itemId": item_id, "personId": person_id(api, email), "role": role}
    if end is not None:
        body["endDate"] = end.isoformat()
    return status_of(api.post("/api/grants", body), 201)["grant"]


def move(api: Api, to_folder: str, items: list[tuple[str, str]], key: str | None = None) -> httpx.Response:
    headers = {"Idempotency-Key": key} if key else None
    return api.post("/api/moves", {"toFolderId": to_folder,
                                    "items": [{"fileId": f, "fromFolderId": src} for f, src in items]}, headers)


def lock(api: Api, file_id: str) -> None:
    status_of(api.post(f"/api/files/{file_id}/lock"), 200)


def file_of(api: Api, file_id: str) -> dict[str, Any]:
    return status_of(api.get(f"/api/files/{file_id}"), 200)["file"]


def count_of(api: Api, folder_id: str) -> int:
    return status_of(api.get(f"/api/folders/{folder_id}"), 200)["folder"]["fileCount"]


def listing(api: Api, folder_id: str) -> list[dict[str, Any]]:
    return status_of(api.get("/api/files", folderId=folder_id), 200)["files"]


def activity(api: Api, file_id: str) -> list[dict[str, Any]]:
    return status_of(api.get(f"/api/files/{file_id}/activity"), 200)["entries"]


def storage(api: Api) -> dict[str, int]:
    return status_of(api.get("/api/storage"), 200)


def bin_item(api: Api, file_id: str) -> dict[str, Any] | None:
    items = status_of(api.get("/api/bin"), 200)["items"]
    return next((i for i in items if i["file"]["id"] == file_id), None)


def in_force(api: Api, kind: str) -> int:
    policies = status_of(api.get("/api/policies"), 200)["policies"]
    return one(p for p in policies if p["kind"] == kind and p["state"] == "in_force")["days"]


def today_of(base: str) -> date:
    return date.fromisoformat(httpx.get(base + "/api/clock", timeout=HTTP_TIMEOUT_S).json()["today"])


def server_now(base: str) -> datetime:
    return parse_instant(httpx.get(base + "/api/clock", timeout=HTTP_TIMEOUT_S).json()["now"])


def set_clock(base: str, instant: datetime) -> dict[str, Any]:
    r = httpx.put(base + "/api/clock", json={"now": instant.isoformat()}, timeout=HTTP_TIMEOUT_S)
    assert r.status_code == 200, r.text
    return r.json()


def fresh_day(base: str) -> date:
    set_clock(base, phx(today_of(base) + timedelta(days=2), 0, 0, 10))
    return today_of(base)


def poll(probe: Callable[[], Any], seconds: float) -> Any:
    deadline = time.monotonic() + seconds
    expired = False
    while not expired:
        try:
            return probe()
        except (AssertionError, httpx.HTTPError) as error:
            last = error
            expired = time.monotonic() >= deadline
    pytest.fail(f"the server did not reach the expected state within {seconds:g} s: {last}")


def wait_status(base: str, service: str, value: str) -> None:
    def probe() -> None:
        body = httpx.get(base + "/api/status", timeout=HTTP_TIMEOUT_S).json()
        assert body[service] == value, body

    poll(probe, STATUS_PROBE_S + SLACK_S)


def s3_sha(store: S3, key: str) -> str:
    return hashlib.sha256(store.get(key)).hexdigest()


def eventually(page: Page, probe: Callable[[], Any], seconds: float = UI_DEADLINE_S) -> None:
    deadline = time.monotonic() + seconds
    expired = False
    while not expired:
        try:
            probe()
            return
        except (AssertionError, PlaywrightError) as error:
            last = error
            expired = time.monotonic() >= deadline
            if not expired:
                advance(page, STEP_MS)
    pytest.fail(f"the page did not reach the expected state within {seconds:g} s: {last}")


def shows(page: Page, locator: Locator, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=POLL_MS), seconds)


def has_text(page: Page, locator: Locator, text: str | re.Pattern[str], seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(locator).to_contain_text(text, timeout=POLL_MS), seconds)


def lacks_text(page: Page, locator: Locator, text: str, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(locator).not_to_contain_text(text, timeout=POLL_MS), seconds)


def gone(page: Page, locator: Locator, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(locator).to_have_count(0, timeout=POLL_MS), seconds)


LEFT_VIEW_JS = """e => {
  const r = e.getBoundingClientRect();
  const s = getComputedStyle(e);
  return !!e.closest('[inert]') || s.visibility === 'hidden' || Number(s.opacity) === 0 || !r.width || !r.height
    || r.bottom <= 0 || r.top >= innerHeight || r.right <= 0 || r.left >= innerWidth;
}"""


def left_view(page: Page, locator: Locator, seconds: float = UI_DEADLINE_S) -> None:
    def probe() -> None:
        if locator.count() == 0:
            return
        assert all(locator.nth(i).evaluate(LEFT_VIEW_JS) for i in range(locator.count())), "still on screen"

    eventually(page, probe, seconds)


CONTENT_SHOWN_JS = """el => [...el.querySelectorAll('img, iframe, object, embed')].some(e =>
  (e.getAttribute('src') || e.getAttribute('data') || '').includes('/api/content/'))"""


def preview_closed(page: Page, preview: Locator, name: str, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: _assert(preview.count() == 0 or (not preview.evaluate(CONTENT_SHOWN_JS)
                                                              and name not in preview.inner_text())), seconds)


def shows_on_screen(page: Page, text: str, seconds: float = UI_DEADLINE_S) -> None:
    def probe() -> None:
        _assert(any(m.is_visible() and not m.evaluate("e => !!e.closest('[role=status]')")
                    for m in page.get_by_text(text).all()))

    eventually(page, probe, seconds)


def focused(page: Page, locator: Locator) -> None:
    eventually(page, lambda: expect(locator).to_be_focused(timeout=POLL_MS))


TAB_STOPS_JS = """el => [...el.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')].filter(e =>
  e.tabIndex >= 0 && !e.disabled && !e.closest('[inert]') && e.getClientRects().length > 0).length"""


def tabs_stay_inside(page: Page, dialog: Locator) -> None:
    shows(page, dialog)
    presses = 3 * dialog.evaluate(TAB_STOPS_JS) + 1
    for key in ["Tab"] * presses + ["Shift+Tab"] * presses:
        page.keyboard.press(key)
        assert dialog.evaluate("el => el.contains(document.activeElement)"), key


def focused_any(page: Page, *locators: Locator) -> None:
    eventually(page, lambda: _assert(any(loc.count() == 1 and loc.evaluate("e => e === document.activeElement")
                                         for loc in locators)))


def described(page: Page, locator: Locator, text: str, seconds: float = UI_DEADLINE_S) -> None:
    eventually(page, lambda: expect(locator).to_have_accessible_description(text, timeout=POLL_MS), seconds)


def ready(locator: Locator) -> None:
    def probe() -> None:
        expect(locator).to_be_visible(timeout=POLL_MS)
        expect(locator).to_be_enabled(timeout=POLL_MS)

    eventually(locator.page, probe)


def click(locator: Locator) -> None:
    ready(locator)
    kit_click(locator)


def check(locator: Locator) -> None:
    ready(locator)
    kit_check(locator)


def fill(locator: Locator, value: str) -> None:
    ready(locator)
    kit_fill(locator, value)


def tap(locator: Locator) -> None:
    ready(locator)
    kit_tap(locator)


PICK_NATIVE_JS = """(e, v) => {
    const label = o => (o.label || o.text || '').trim().toLowerCase();
    const want = v.toLowerCase();  // L158/L228: the role names Viewer and Editor, in any letter case
    const o = [...e.options].find(o => label(o) === want) || [...e.options].find(o => o.value.toLowerCase() === want);
    if (!o) return [...e.options].map(label);
    e.value = o.value;
    e.dispatchEvent(new Event('input', {bubbles: true}));
    e.dispatchEvent(new Event('change', {bubbles: true}));
    return true;
}"""
SELECTED_JS = ("(e, v) => [...e.selectedOptions].some(o => (o.label || o.text || '').trim().toLowerCase() === v.toLowerCase()"
               " || o.value.toLowerCase() === v.toLowerCase())")


def select(locator: Locator, choice: str) -> None:
    ready(locator)
    if locator.evaluate("e => e.tagName === 'SELECT'"):
        center(locator)
        locator.focus()
        picked = locator.evaluate(PICK_NATIVE_JS, choice)
        assert picked is True, f"no option {choice!r} in the dropdown (options: {picked})"
        eventually(locator.page, lambda: _assert(locator.evaluate(SELECTED_JS, choice)))
        return
    page = locator.page
    center(locator)
    locator.focus()
    locator.click()
    option = page.get_by_role("option", name=re.compile(rf"^{re.escape(choice)}$", re.I)).first
    ready(option)
    option.click()
    if locator.evaluate("e => 'value' in e"):
        eventually(page, lambda: expect(locator).to_have_value(re.compile(re.escape(choice), re.I), timeout=POLL_MS))
    else:
        has_text(page, locator, re.compile(re.escape(choice), re.I))


def layout(page: Page) -> None:
    viewport = page.viewport_size
    assert viewport is not None
    assert page.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"), "horizontal overflow"
    controls = page.get_by_role("button")
    for index in range(controls.count()):
        control = controls.nth(index)
        if control.is_visible() and not control.evaluate("e => !!e.closest('[inert]')"):
            control.evaluate("e => e.scrollIntoView({block:'nearest',inline:'nearest',behavior:'instant'})")
            box = control.bounding_box()
            assert box and box["x"] >= -1 and box["x"] + box["width"] <= viewport["width"] + 1, box


def moving(locator: Locator) -> list[dict[str, Any]]:
    return [a for a in animations(locator) if a["duration"] > FRAME_MS]


def files_list(page: Page) -> Locator:
    return page.get_by_role("listbox", name="Files")


def row(page: Page, name: str) -> Locator:
    return files_list(page).get_by_role("option", name=name, exact=True)


def tree(page: Page) -> Locator:
    return page.get_by_role("tree", name="Folders", exact=True)


def node(page: Page, name: str) -> Locator:
    return tree(page).get_by_role("treeitem", name=name, exact=True)


def toolbar(page: Page) -> Locator:
    return page.get_by_role("toolbar", name="Selection actions")


def notices(page: Page) -> Locator:
    return page.get_by_role("region", name="Notices")


def meter_value(page: Page) -> tuple[float, float]:
    meter = page.get_by_role("meter", name="Company storage")
    return meter.evaluate(
        "e => [Number(e.getAttribute('aria-valuenow') ?? e.value), Number(e.getAttribute('aria-valuemax') ?? e.max)]"
    )


def qs(page: Page) -> dict[str, list[str]]:
    return parse_qs(urlparse(page.url).query)


def reveal(page: Page, project_name: str) -> None:
    top = node(page, project_name)
    shows(page, top)
    if top.get_attribute("aria-expanded") == "false":
        top.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(top).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))


def choose_in_tree(page: Page, tree_loc: Locator, project_name: str, folder_name: str) -> None:
    advance(page, TYPEAHEAD_RESET_MS + STEP_MS)
    page.keyboard.type(project_name.split()[0])
    top = tree_loc.get_by_role("treeitem", name=project_name, exact=True)
    focused(page, top)
    if top.get_attribute("aria-expanded") == "false":
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(top).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
    advance(page, TYPEAHEAD_RESET_MS + STEP_MS)
    page.keyboard.type(folder_name)
    focused(page, tree_loc.get_by_role("treeitem", name=folder_name, exact=True))


@contextmanager
def signed_in(browser: Browser, base: str, email: str | None, path: str = "/drive", *,
              cookie: str | None = None, viewport: tuple[int, int] | None = None,
              reduced_motion: str = "no-preference") -> Iterator[Page]:
    value = cookie or Api(base, email).cookie
    with open_app(browser, base + "/sign-in", reduced_motion=reduced_motion) as page:
        if viewport:
            page.set_viewport_size({"width": viewport[0], "height": viewport[1]})
        page.context.add_cookies([{"name": "lintel_session", "value": value, "url": base}])
        page.goto(base + path)
        yield page


WATCH_JS = """el => {
  window.__annSnaps = [el.textContent || ''];
  new MutationObserver(() => window.__annSnaps.push(el.textContent || ''))
    .observe(el, {childList: true, subtree: true, characterData: true});
}"""
COUNT_JS = """t => {
  const occ = s => s.split(t).length - 1;
  const s = window.__annSnaps || [];
  let n = 0;
  for (let i = 1; i < s.length; i++) n += Math.max(0, occ(s[i]) - occ(s[i - 1]));
  return n;
}"""
CHIP_LOG_JS = """() => {
  window.__chips = [];
  new MutationObserver(ms => { for (const m of ms) for (const n of m.addedNodes) {
    if (!(n instanceof Element)) continue;
    const found = n.matches('[data-homing-chip]') ? [n] : [...n.querySelectorAll('[data-homing-chip]')];
    for (const c of found) window.__chips.push({id: c.getAttribute('data-homing-chip'),
      text: (c.textContent || '').trim(), animated: c.getAnimations({subtree: true}).length});
  }}).observe(document.body, {childList: true, subtree: true});
}"""


def watch(page: Page) -> None:
    region = page.get_by_role("status", name="Announcements")
    eventually(page, lambda: expect(region).to_have_count(1, timeout=POLL_MS))
    region.evaluate(WATCH_JS)


def announced(page: Page, text: str) -> int:
    return page.evaluate(COUNT_JS, text)


def announced_once(page: Page, text: str, seconds: float = UI_DEADLINE_S) -> None:
    def probe() -> None:
        assert announced(page, text) >= 1, (text, page.evaluate("window.__annSnaps"))

    eventually(page, probe, seconds)
    advance(page, SETTLE_MS)
    assert announced(page, text) == 1, (text, page.evaluate("window.__annSnaps"))


LOAD_WATCH_JS = """(() => {
  const region = () => {
    const all = [...document.querySelectorAll('[role="status"], output, [aria-live="polite"], [aria-live="assertive"]')];
    const label = e => (e.getAttribute('aria-label') || (e.getAttribute('aria-labelledby') || '').split(/\\s+/)
      .map(id => (document.getElementById(id) || {}).textContent || '').join(' ')).trim();
    return all.find(e => label(e) === 'Announcements') || all[0] || null;
  };
  window.__annSnaps = [''];
  const snap = () => {
    const el = region();
    const text = el ? (el.textContent || '') : '';
    const snaps = window.__annSnaps;
    if (snaps[snaps.length - 1] !== text) snaps.push(text);
  };
  new MutationObserver(snap).observe(document, {childList: true, subtree: true, characterData: true});
})()"""


def watch_from_load(page: Page) -> None:
    page.add_init_script(script=LOAD_WATCH_JS)


def unheard(page: Page, text: str) -> None:
    advance(page, SETTLE_MS)
    assert announced(page, text) == 0, (text, page.evaluate("window.__annSnaps"))


def is_events(url: str) -> bool:
    return urlparse(url).path == "/api/events"


class EventGate:

    def __init__(self, page: Page, closed: bool = False) -> None:
        self.held: list[tuple[Any, Any]] | None = [] if closed else None
        page.route_web_socket(is_events, self._route)
        page.reload()

    def _route(self, ws: Any) -> None:
        server = ws.connect_to_server()

        def down(message: Any) -> None:
            if self.held is None:
                ws.send(message)
            else:
                self.held.append((ws, message))

        server.on_message(down)

    def close(self) -> None:
        if self.held is None:
            self.held = []

    def open(self) -> None:
        waiting, self.held = self.held or [], None
        for ws, message in waiting:
            ws.send(message)


def chip(page: Page, chip_id: str) -> Locator:
    return page.locator(f'[data-homing-chip="{chip_id}"]')


def _pt(sample: dict[str, float]) -> tuple[float, float]:
    x = sample.get("x", sample.get("left", 0.0))
    y = sample.get("y", sample.get("top", 0.0))
    return x + sample.get("width", 0.0) / 2, y + sample.get("height", 0.0) / 2


def inside(pt: tuple[float, float], box: dict[str, float], pad: float) -> bool:
    return (box["x"] - pad <= pt[0] <= box["x"] + box["width"] + pad
            and box["y"] - pad <= pt[1] <= box["y"] + box["height"] + pad)


def assert_flight(path: list[dict[str, float]], start: dict[str, float], end: dict[str, float]) -> None:
    pts = [_pt(s) for s in path]
    assert len(pts) >= 3, path
    (sx, sy), (ex, ey) = pts[0], pts[-1]
    assert inside((sx, sy), start, start["height"]), (pts[0], start)
    assert inside((ex, ey), end, end["height"]), (pts[-1], end)
    dist = math.hypot(ex - sx, ey - sy)
    assert dist > 0
    bow = max(abs((ex - sx) * (py - sy) - (ey - sy) * (px - sx)) / dist for px, py in pts)
    assert bow >= CURVE_MIN_RATIO * dist, (bow, dist)


FLIGHT_JS = """(chip, n) => {
  const at = () => {
    const range = document.createRange();
    range.selectNodeContents(chip);
    let r = range.getBoundingClientRect();
    if (!r.width && !r.height) r = chip.getBoundingClientRect();
    return {x: r.x, y: r.y, width: r.width, height: r.height};
  };
  const anims = document.getAnimations().filter(a => {
    const t = a.effect && a.effect.target;
    return t && (t === chip || chip.contains(t) || t.contains(chip))
      && Number.isFinite(a.effect.getComputedTiming().endTime);
  });
  if (!anims.length) return {point: at(), seek: null};
  const total = Math.max(...anims.map(a => a.effect.getComputedTiming().endTime));
  const saved = anims.map(a => [a, a.currentTime, a.playState]);
  anims.forEach(a => a.pause());
  const out = [];
  // the last sample is 1 ms before the end: at endTime itself an animation with fill 'none' is already over and
  // shows the chip's base position, not the frame the person last saw
  const last = Math.max(0, total - 1);
  for (let i = 0; i <= n; i++) { anims.forEach(a => { a.currentTime = last * i / n; }); out.push(at()); }
  saved.forEach(([a, time, state]) => { a.currentTime = time; if (state === 'running') a.play(); });
  return {point: null, seek: out};
}"""


def flight(page: Page, flying: Locator, duration_ms: float, points: int = 24) -> list[dict[str, float]]:
    deadline = time.monotonic() + UI_DEADLINE_S
    while not flying.count():
        assert time.monotonic() < deadline, "no homing chip appeared"
        advance(page, FRAME_MS)
    path: list[dict[str, float]] = []
    for _ in range(math.ceil((duration_ms + FLIGHT_SETTLE_MS) / FRAME_MS) + 1):
        try:
            state = flying.evaluate(FLIGHT_JS, points, timeout=POLL_MS)
        except PlaywrightError:
            break
        if state["seek"]:
            return path + state["seek"]
        path.append(state["point"])
        advance(page, FRAME_MS)
    return path


SWALLOW_CLICK_JS = """() => {
  const off = () => { removeEventListener('click', eat, true); removeEventListener('dblclick', eat2, true);
                      removeEventListener('pointerdown', off, true); };
  const eat = e => { e.preventDefault(); e.stopImmediatePropagation(); removeEventListener('click', eat, true); };
  const eat2 = e => { e.preventDefault(); e.stopImmediatePropagation(); };
  addEventListener('click', eat, true);
  addEventListener('dblclick', eat2, true);
  addEventListener('pointerdown', off, true);
}"""


TAPPABLE_JS = """e => {
  const r = e.getBoundingClientRect();
  const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
  return !!hit && (hit === e || e.contains(hit));
}"""


def tappable(button: Locator) -> bool:
    return button.is_visible() and button.evaluate(TAPPABLE_JS)


def long_press(page: Page, locator: Locator) -> None:
    x, y = center(locator)
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    advance(page, LONG_PRESS_MS + STEP_MS)
    page.evaluate(SWALLOW_CLICK_JS)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def uploads_listed(page: Page, api: Api) -> None:
    panel = page.get_by_role("region", name="Uploads")
    for u in status_of(api.get("/api/uploads"), 200)["uploads"]:
        shows(page, panel.get_by_role("progressbar", name=u["name"], exact=True))


def open_new_upload(page: Page, name: str, data: bytes, content_type: str = PDF) -> None:
    click(page.get_by_role("button", name="New"))
    with page.expect_file_chooser() as chooser:
        click(page.get_by_role("menu", name="New").get_by_role("menuitem", name="Upload files"))
    chooser.value.set_files(files=[{"name": name, "mimeType": content_type, "buffer": data}])


def open_move_dialog(page: Page) -> Locator:
    click(toolbar(page).get_by_role("button", name="Move to", exact=True))
    dialog = page.get_by_role("dialog", name="Move to")
    shows(page, dialog)
    return dialog


class EventTap:

    def __init__(self, api: Api) -> None:
        self.lines: list[str] = []
        self.cond = threading.Condition()
        self.ready = threading.Event()
        self.status = 0
        url = urlparse(api.base)
        port = url.port or (443 if url.scheme == "https" else 80)
        raw = socket.create_connection((url.hostname, port), timeout=HTTP_TIMEOUT_S)
        self.sock = ssl.create_default_context().wrap_socket(raw, server_hostname=url.hostname) \
            if url.scheme == "https" else raw
        key = base64.b64encode(os.urandom(16)).decode()
        host = url.hostname + (f":{url.port}" if url.port else "")
        self.sock.sendall((f"GET /api/events HTTP/1.1\r\nHost: {host}\r\nUpgrade: websocket\r\n"
                           f"Connection: Upgrade\r\nSec-WebSocket-Key: {key}\r\nSec-WebSocket-Version: 13\r\n"
                           f"Origin: {url.scheme}://{host}\r\nCookie: lintel_session={api.cookie}\r\n\r\n").encode())
        head = b""
        while b"\r\n\r\n" not in head:
            chunk = self.sock.recv(4096)
            if not chunk:
                break
            head += chunk
        head, _, self.buf = head.partition(b"\r\n\r\n")
        status_line = head.split(b"\r\n", 1)[0].split()
        self.status = int(status_line[1]) if len(status_line) > 1 and status_line[1].isdigit() else 0
        self.sock.settimeout(None)
        if self.status == 101:
            threading.Thread(target=self._run, daemon=True).start()
        self.ready.set()

    def _read(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("closed")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def _send(self, opcode: int, payload: bytes) -> None:
        mask = os.urandom(4)
        size = len(payload)
        head = bytes([0x80 | opcode]) + (bytes([0x80 | size]) if size < 126 else
                                         bytes([0x80 | 126]) + struct.pack("!H", size))
        self.sock.sendall(head + mask + bytes(b ^ mask[i % 4] for i, b in enumerate(payload)))

    def _run(self) -> None:
        message = b""
        try:
            while True:
                b0, b1 = self._read(2)
                opcode, size = b0 & 0x0F, b1 & 0x7F
                if size == 126:
                    size = struct.unpack("!H", self._read(2))[0]
                elif size == 127:
                    size = struct.unpack("!Q", self._read(8))[0]
                mask = self._read(4) if b1 & 0x80 else b""
                payload = self._read(size)
                if mask:
                    payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
                if opcode == 0x8:
                    break
                if opcode == 0x9:
                    self._send(0xA, payload)
                    continue
                if opcode in (0x1, 0x2, 0x0):
                    message += payload
                    if b0 & 0x80:
                        with self.cond:
                            self.lines.append(message.decode("utf-8", "replace"))
                            self.cond.notify_all()
                        message = b""
        except Exception:
            pass

    def wait_for(self, needles: list[str], seconds: float) -> bool:
        with self.cond:
            return self.cond.wait_for(lambda: any(n in l for l in self.lines for n in needles), timeout=seconds)

    def close(self) -> None:
        for step in (lambda: self.sock.shutdown(socket.SHUT_RDWR), self.sock.close):
            try:
                step()
            except OSError:
                pass


def test_health_ok_with_services_down(app_url: str) -> None:
    for base in (app_url.rstrip("/"), env_url(STORAGE_DOWN_ENV), env_url(DIRECTORY_DOWN_ENV)):
        r = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert r.status_code == 200 and r.json() == {"status": "ok"}, (base, r.text)
        clock = httpx.get(base + "/api/clock", timeout=HTTP_TIMEOUT_S)
        assert clock.status_code == 200 and clock.json()["zone"] == "America/Phoenix", (base, clock.text)
        assert httpx.get(base + "/sign-in", timeout=HTTP_TIMEOUT_S).status_code == 200, base


def test_seed_records_in_every_service(app_url: str) -> None:
    base = app_url.rstrip("/")
    pb = PocketBase()
    assert "users" in pb.collections()
    for email, name, kind, firm, role in SEED_PEOPLE:
        rec = one(pb.records("users", f'email="{email}"'))
        assert (rec["name"], rec["kind"], rec["firm"]) == (name, kind, firm), rec
        assert (rec.get("staffRole") or None) == role, rec
    mar = Api(base, MARISOL)
    folders = status_of(mar.get("/api/folders"), 200)["folders"]
    store = S3()
    keys = set(store.keys("files/"))
    ids: dict[tuple[str, str | None], str] = {}
    for project, subs in SEED_TREE.items():
        top = one(f for f in folders if f["name"] == project and f["parentId"] is None)
        ids[(project, None)] = top["id"]
        assert top["owner"]["name"] == SEED_OWNERS[project] and top["fileCount"] == 0
        for sub, names in subs.items():
            folder = one(f for f in folders if f["parentId"] == top["id"] and f["name"] == sub)
            ids[(project, sub)] = folder["id"]
            files = listing(mar, folder["id"])
            assert sorted(f["name"] for f in files) == sorted(names)
            assert folder["fileCount"] == len(names)
            for f in files:
                assert f["locked"] == (f["name"] in SEED_LOCKED), f
                key = f"files/{f['id']}"
                assert key in keys, key
                assert len(store.get(key)) == f["size"] < SEED_FILE_MAX_BYTES
                ups = [e for e in activity(mar, f["id"]) if e["action"] == "uploaded"]
                assert len(ups) == 1 and ups[0]["actor"]["name"] == SEED_OWNERS[project], ups
    item = one(i for i in status_of(mar.get("/api/bin"), 200)["items"] if i["file"]["name"] == SEED_BIN_FILE)
    seed_day = date.fromisoformat(item["binnedDate"])
    assert item["retentionDays"] == SEED_RETENTION_DAYS
    assert item["purgeDate"] == (seed_day + timedelta(days=SEED_RETENTION_DAYS)).isoformat()
    assert item["fromFolder"]["id"] == ids[(SAGUARO, "Site photos")]
    assert f"files/{item['file']['id']}" in keys
    expected = [
        ((SAGUARO, "Drawings"), AIKO, "editor", SEED_AIKO_DAYS),
        ((SAGUARO, None), CALLUM, "viewer", SEED_CALLUM_VIEWER_DAYS),
        ((SAGUARO, "Calculations"), CALLUM, "editor", SEED_CALLUM_EDITOR_DAYS),
        ((SAGUARO, "Issued"), ROSA, "viewer", SEED_ROSA_VIEWER_DAYS),
        ((RILLITO, "Reports"), ROSA, "editor", SEED_ROSA_EDITOR_DAYS),
    ]
    for where, email, role, days in expected:
        grants = status_of(mar.get("/api/grants", itemType="folder", itemId=ids[where]), 200)["grants"]
        g = one(g for g in grants if g["person"]["name"] == NAMES[email])
        assert g["role"] == role and g["endDate"] == (seed_day + timedelta(days=days)).isoformat(), g
    hand = one(h for h in status_of(mar.get("/api/handovers"), 200)["handovers"] if h["folder"]["name"] == RILLITO
               and h["offeredDate"] == seed_day.isoformat())
    assert (hand["from"]["name"], hand["to"]["name"], hand["status"]) == ("Dev Halvorsen", "Marisol Okafor", "offered")
    assert hand["lapseDate"] == (seed_day + timedelta(days=SEED_HANDOVER_DAYS)).isoformat()
    policies = status_of(Api(base, TOMAS).get("/api/policies"), 200)["policies"]
    for kind in ("bin_retention_days", "partner_grant_days"):
        one(p for p in policies if p["kind"] == kind and p["effectiveFrom"] == SEED_POLICY_FROM
            and p["days"] == SEED_POLICY_DAYS)
    clock = env_url(CLOCK_ENV)
    clock_folders = status_of(Api(clock, MARISOL).get("/api/folders"), 200)["folders"]
    for project in SEED_TREE:
        one(f for f in clock_folders if f["name"] == project and f["parentId"] is None)
    assert S3("-clock").keys("files/"), "the clock instance bucket holds its seed objects"


def test_server_boundary(app_url: str) -> None:
    base = app_url.rstrip("/")
    origin = f"{urlparse(base).scheme}://{urlparse(base).netloc}"
    mar, dev = Api(base, MARISOL), Api(base, DEV)
    _, sub = make_project(mar, "A")
    parent = sub["A"]["id"]

    exact = f"J{tok()}"
    raw = json.dumps({"parentId": parent, "name": exact})
    r = mar.http.post("/api/folders", content=(raw + " " * (JSON_LIMIT - len(raw))).encode(),
                      headers={"Content-Type": "application/json"})
    status_of(r, 201)
    over = f"J{tok()}"
    raw = json.dumps({"parentId": parent, "name": over})
    r = mar.http.post("/api/folders", content=(raw + " " * (JSON_LIMIT + 1 - len(raw))).encode(),
                      headers={"Content-Type": "application/json"})
    status_of(r, 413, "too_large")
    status_of(mar.http.post("/api/folders", content=json.dumps({"parentId": parent, "name": f"C{tok()}"}).encode(),
                            headers={"Content-Type": "application/json; charset=utf-8"}), 201)
    plain = f"T{tok()}"
    status_of(mar.http.post("/api/folders", content=json.dumps({"parentId": parent, "name": plain}).encode(),
                            headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    foreign = f"X{tok()}"
    r = mar.http.post("/api/folders", json={"parentId": parent, "name": foreign}, headers={"Origin": FOREIGN_ORIGIN})
    status_of(r, 403, "cross_origin")
    status_of(mar.http.post("/api/folders", json={"parentId": parent, "name": f"O{tok()}"},
                            headers={"Origin": origin}), 201)
    names = {f["name"] for f in status_of(mar.get("/api/files", folderId=parent), 200)["folders"]}
    assert exact in names and not names & {over, plain, foreign}

    cookie = httpx.post(base + "/api/session", json={"email": DEV, "password": PASSWORD},
                        timeout=HTTP_TIMEOUT_S).headers.get("set-cookie", "").lower()
    assert "lintel_session" in cookie and "HttpOnly".lower() in cookie and "SameSite=Lax".lower() in cookie

    up = status_of(start_upload(mar, parent, f"big {tok()}.pdf", PART_SIZE * 2), 201)["upload"]
    status_of(mar.put(f"/api/uploads/{up['id']}/parts/1", b"0" * (PART_SIZE + 1)), 413, "too_large")
    status_of(mar.put(f"/api/uploads/{up['id']}/parts/1", b"0" * PART_SIZE, "text/plain"), 415,
              "unsupported_media_type")
    status_of(mar.put(f"/api/uploads/{up['id']}/parts/1", b"0" * PART_SIZE), 200)
    status_of(mar.delete(f"/api/uploads/{up['id']}"), 204)

    name = f"Sheet {tok()}.pdf"
    data = pdf_bytes(name)
    f = upload(mar, parent, name, data)
    link = status_of(mar.post(f"/api/files/{f['id']}/links", {"purpose": "download"}), 201)
    assert link["url"].startswith("/api/content/")
    got = mar.get(link["url"])
    assert got.status_code == 200 and got.content == data == S3().get(f"files/{f['id']}")
    assert "no-store" in got.headers["cache-control"].lower()
    assert got.headers["x-content-type-options"].lower() == "nosniff"
    assert got.headers["content-type"].startswith(PDF)
    assert got.headers["content-disposition"] == f'attachment; filename="{name}"'
    preview = mar.get(status_of(mar.post(f"/api/files/{f['id']}/links", {"purpose": "preview"}), 201)["url"])
    assert preview.status_code == 200 and preview.headers["content-disposition"].startswith("inline")
    assert "sandbox" in preview.headers["content-security-policy"]
    status_of(dev.get(link["url"]), 404, "not_found")

    shell = httpx.get(base + "/sign-in", timeout=HTTP_TIMEOUT_S)
    assert shell.status_code == 200
    assets = re.findall(r'(?:src|href)="([^"]+?\.(?:js|css))"', shell.text)
    assert assets
    for asset in assets:
        url = urljoin(base + "/drive", asset)
        assert httpx.get(url, timeout=HTTP_TIMEOUT_S).status_code == 200, url
        assert httpx.get(url + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404, url
    for path in NEVER_SERVED:
        assert httpx.get(base + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path


def test_server_clock_in_phoenix(app_url: str) -> None:
    base = app_url.rstrip("/")
    body = httpx.get(base + "/api/clock", timeout=HTTP_TIMEOUT_S).json()
    assert body["zone"] == "America/Phoenix" and body["now"].endswith("Z")
    assert body["today"] == parse_instant(body["now"]).astimezone(PHOENIX).date().isoformat()
    r = httpx.put(base + "/api/clock", json={"now": body["now"]}, timeout=HTTP_TIMEOUT_S)
    status_of(r, 404, "not_found")

    clock = env_url(CLOCK_ENV)
    bad = httpx.put(clock + "/api/clock", json={"now": "not-an-instant"}, timeout=HTTP_TIMEOUT_S)
    status_of(bad, 422, "validation")
    target_day = today_of(clock) + timedelta(days=2)
    target = phx(target_day, 20, 30)
    moved = set_clock(clock, target.astimezone(timezone(timedelta(hours=10))))
    assert abs((parse_instant(moved["now"]) - target).total_seconds()) < CLOCK_TOLERANCE_S
    assert moved["today"] == target_day.isoformat() and moved["zone"] == "America/Phoenix"

    mar = Api(clock, MARISOL)
    _, sub = make_project(mar, "A")
    f = upload_pdf(mar, sub["A"]["id"], "Link")
    before = server_now(clock)
    url = status_of(mar.post(f"/api/files/{f['id']}/links", {"purpose": "download"}), 201)["url"]
    after = server_now(clock)
    set_clock(clock, before + timedelta(seconds=LINK_TTL_S - LINK_EARLY_S))
    assert mar.get(url).status_code == 200
    set_clock(clock, after + timedelta(seconds=LINK_TTL_S))
    status_of(mar.get(url), 410, "link_expired")


def test_error_shape_and_order(app_url: str) -> None:
    base = app_url.rstrip("/")
    anon = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    huge = b'{"name":"' + b"x" * JSON_LIMIT + b'"}'
    r = anon.post("/api/folders", content=huge, headers={"Content-Type": "application/json", "Origin": FOREIGN_ORIGIN})
    assert status_of(r, 413) == {"error": "too_large"}
    r = anon.post("/api/folders", content=b"x", headers={"Content-Type": "text/plain", "Origin": FOREIGN_ORIGIN})
    assert status_of(r, 415) == {"error": "unsupported_media_type"}
    r = anon.post("/api/folders", json={"parentId": None, "name": "x"}, headers={"Origin": FOREIGN_ORIGIN})
    assert status_of(r, 403) == {"error": "cross_origin"}
    assert status_of(anon.get("/api/folders"), 401) == {"error": "unauthenticated"}

    mar, dev, ines = Api(base, MARISOL), Api(base, DEV), Api(base, INES)
    assert status_of(mar.get(f"/api/files/{JUNK_ID}"), 404) == {"error": "not_found"}
    assert status_of(mar.get(f"/api/folders/{JUNK_ID}"), 404) == {"error": "not_found"}
    assert status_of(mar.post("/api/moves", {"toFolderId": JUNK_ID, "items": []}), 404) == {"error": "not_found"}
    _, sub = make_project(mar, "A")
    r = dev.post("/api/grants", {"itemType": "folder", "itemId": sub["A"]["id"],
                                 "personId": person_id(dev, AIKO), "role": "owner"})
    assert status_of(r, 403) == {"error": "forbidden"}
    held_file = upload_pdf(mar, sub["A"]["id"], "Locked")
    lock(ines, held_file["id"])
    assert status_of(mar.patch(f"/api/files/{held_file['id']}", {"name": ""}), 409) == {"error": "locked"}
    free = upload_pdf(mar, sub["A"]["id"], "Free")
    cases = [("", "Enter a name."), ("a/b", "Names cannot contain / or \\."),
             ("n" * (NAME_MAX + 1), "Names can be up to 120 characters.")]
    for bad_name, message in cases:
        body = status_of(mar.patch(f"/api/files/{free['id']}", {"name": bad_name}), 422)
        assert body == {"error": "validation", "fields": {"name": message}}, body
    assert file_of(mar, free["id"])["name"] == free["name"]


@pytest.mark.parametrize("viewport", VIEWPORT_IDS, ids=VIEWPORT_IDS)
def test_three_viewports(browser: Browser, app_url: str, viewport: str) -> None:
    base = app_url.rstrip("/")
    size = VIEWPORTS[viewport]
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    folder = sub["A"]["id"]
    f = upload_pdf(mar, folder, "Viewport")
    give(mar, "folder", folder, AIKO, "viewer")
    with open_app(browser, base + "/sign-in") as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        page.reload()
        shows(page, page.get_by_role("heading", name="Sign in to Lintel Drive"))
        layout(page)
    screens = [(MARISOL, [f"/drive?folder={folder}", "/drive", "/recent", "/bin", "/handovers"]),
               (TOMAS, ["/settings"]), (AIKO, ["/shared", f"/drive?folder={folder}"])]
    for email, paths in screens:
        with signed_in(browser, base, email, paths[0], viewport=size) as page:
            for path in paths:
                page.goto(base + path)
                shows(page, page.get_by_role("searchbox", name="Search files"))
                layout(page)
            if email != MARISOL:
                continue
            page.goto(base + paths[0])
            shows(page, row(page, f["name"]))
            if viewport == "phone":
                shows(page, page.get_by_role("button", name="Open navigation"))
                rail = tree(page)
                eventually(page, lambda: assert_offscreen(rail))
            elif viewport == "tablet":
                shows(page, tree(page))
                expect(page.get_by_role("complementary", name="Details")).to_have_count(0)
                click(row(page, f["name"]))
                click(toolbar(page).get_by_role("button", name="Details"))
                shows(page, page.get_by_role("dialog", name="Details"))
            else:
                shows(page, tree(page))
                click(row(page, f["name"]))
                details = page.get_by_role("complementary", name="Details")
                has_text(page, details, f["name"])
                assert details.bounding_box()["x"] > files_list(page).bounding_box()["x"]
            layout(page)


SHOWN_JS = """e => {
  const vw = innerWidth, vh = innerHeight;
  let r = e.getBoundingClientRect();
  let box = {l: Math.max(0, r.left), t: Math.max(0, r.top), r: Math.min(vw, r.right), b: Math.min(vh, r.bottom)};
  let clipped = false;
  for (let a = e; a && a !== document.documentElement; a = a.parentElement) {
    const s = getComputedStyle(a);
    if (Number(s.opacity) === 0 || s.visibility === 'hidden') return false;
    if (s.clipPath && s.clipPath !== 'none') clipped = true;
    if (a !== e && (s.overflowX !== 'visible' || s.overflowY !== 'visible')) {
      const c = a.getBoundingClientRect();
      box = {l: Math.max(box.l, c.left), t: Math.max(box.t, c.top), r: Math.min(box.r, c.right), b: Math.min(box.b, c.bottom)};
    }
  }
  if (box.r - box.l < 1 || box.b - box.t < 1) return false;
  if (!clipped) return true;
  for (let i = 1; i < 6; i++) for (let j = 1; j < 6; j++) {
    const hit = document.elementFromPoint(box.l + (box.r - box.l) * i / 6, box.t + (box.b - box.t) * j / 6);
    if (hit && (hit === e || e.contains(hit))) return true;
  }
  return false;
}"""


def assert_offscreen(locator: Locator) -> None:
    if locator.count() == 0 or not locator.is_visible():
        return
    assert not locator.evaluate(SHOWN_JS), locator.bounding_box()


def test_homing_flight(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    project, sub = make_project(mar, "A", "B", "C")
    a, b, c = (sub[k]["id"] for k in "ABC")
    free = [upload_pdf(mar, a, f"F{i}") for i in range(1, 4)]
    locked = upload_pdf(mar, a, "Locked")
    lock(ines, locked["id"])
    many = [upload_pdf(mar, c, f"M{i:02d}") for i in range(1, CHIP_CAP + 3)]
    with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
        reveal(page, project["name"])
        first = row(page, free[0]["name"])
        shows(page, first)
        click(first)
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+x")
        start = first.bounding_box()
        page.evaluate(CHIP_LOG_JS)
        dest = node(page, sub["B"]["name"])
        with held(page, "**/api/moves") as hold:
            dest.focus()
            page.keyboard.press("Control+v")
            eventually(page, lambda: expect(first).to_have_attribute("aria-busy", "true", timeout=POLL_MS))
            hold.release()
        path = flight(page, chip(page, free[0]["id"]), CHIP_FLIGHT_MAX_MS)
        assert_flight(path, start, dest.bounding_box())
        has_text(page, row(page, locked["name"]), "Stayed")
        described(page, dest, files_word(3))
        described(page, node(page, sub["A"]["name"]), files_word(1))
        logged = page.evaluate("window.__chips")
        assert locked["id"] not in {x["id"] for x in logged}
        assert {f["id"] for f in free} <= {x["id"] for x in logged}

        page.goto(f"{base}/drive?folder={c}")
        reveal(page, project["name"])
        shows(page, row(page, many[0]["name"]))
        click(row(page, many[0]["name"]))
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+x")
        page.evaluate(CHIP_LOG_JS)
        node(page, sub["B"]["name"]).focus()
        page.keyboard.press("Control+v")
        described(page, node(page, sub["B"]["name"]), files_word(3 + len(many)))
        logged = page.evaluate("window.__chips")
        file_chips = {x["id"] for x in logged if x["id"] != "more"}
        assert len(file_chips) == CHIP_CAP, logged
        more = [x for x in logged if x["id"] == "more"]
        assert more and more[0]["text"] == f"+{len(many) - CHIP_CAP}", logged
    assert {f["folderId"] for f in listing(mar, b)} == {b} and len(listing(mar, b)) == 3 + len(many)


def test_reduced_motion_homing(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B")
    files = [upload_pdf(mar, sub["A"]["id"], f"R{i}") for i in range(1, 4)]
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}", reduced_motion="reduce") as page:
        reveal(page, project["name"])
        shows(page, row(page, files[0]["name"]))
        click(row(page, files[0]["name"]))
        page.keyboard.press("Control+a")
        page.keyboard.press("Control+x")
        page.evaluate(CHIP_LOG_JS)
        dest = node(page, sub["B"]["name"])
        dest.focus()
        page.keyboard.press("Control+v")
        for f in files:
            gone(page, row(page, f["name"]))
        has_text(page, dest, "+3")
        described(page, dest, files_word(3))
        assert moving(tree(page)) == []
        assert moving(files_list(page)) == []
        assert all(x["animated"] == 0 for x in page.evaluate("window.__chips"))
        page.keyboard.press("ArrowUp")
        lacks_text(page, dest, "+3")
    assert len(listing(mar, sub["B"]["id"])) == 3


def test_announcements_once(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    folder = sub["A"]["id"]
    f1, f2 = upload_pdf(mar, folder, "One"), upload_pdf(mar, folder, "Two")
    renamed, created = f"Renamed {tok()}.pdf", f"N{tok()}"
    with signed_in(browser, base, MARISOL, f"/drive?folder={folder}") as page:
        shows(page, row(page, f1["name"]))
        watch(page)
        expect(page.get_by_role("status")).to_have_count(1)
        expect(page.get_by_role("alert")).to_have_count(0)
        live = page.evaluate("() => [...document.querySelectorAll('[aria-live]')]"
                             ".filter(e => e.getAttribute('aria-live') !== 'off').length")
        assert live <= 1
        click(row(page, f1["name"]))
        announced_once(page, "1 selected")
        row(page, f2["name"]).click(modifiers=["Control"])
        announced_once(page, "2 selected")
        page.keyboard.press("Escape")
        announced_once(page, "Selection cleared")
        click(row(page, f1["name"]))
        page.keyboard.press("F2")
        dialog = page.get_by_role("dialog", name="Rename")
        shows(page, dialog)
        fill(dialog.get_by_role("textbox", name="Name", exact=True), renamed)
        click(dialog.get_by_role("button", name="Save"))
        announced_once(page, f"Renamed to {renamed}")
        click(page.get_by_role("button", name="New"))
        click(page.get_by_role("menu", name="New").get_by_role("menuitem", name="New folder"))
        dialog = page.get_by_role("dialog", name="New folder")
        field = dialog.get_by_role("textbox", name="Folder name")
        focused(page, field)
        page.keyboard.type(created)
        click(dialog.get_by_role("button", name="Create"))
        announced_once(page, f"Created {created}")
    assert file_of(mar, f1["id"])["name"] == renamed
    assert created in {x["name"] for x in status_of(mar.get("/api/files", folderId=folder), 200)["folders"]}


def test_live_updates(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev = Api(base, MARISOL), Api(base, DEV)
    project, sub = make_project(mar, "A", "B", "H")
    a, b, h = (sub[k]["id"] for k in "ABH")
    f = upload_pdf(mar, a, "Live")
    new_name = f"Live renamed {tok()}.pdf"
    with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
        reveal(page, project["name"])
        target = row(page, f["name"])
        shows(page, target)
        click(target)
        page.keyboard.press("Enter")
        acts = page.get_by_role("complementary", name="Details").get_by_role("list", name="Activity")
        eventually(page, lambda: expect(acts.get_by_role("listitem")).not_to_have_count(0, timeout=POLL_MS))
        before = acts.get_by_role("listitem").count()
        used_before = meter_value(page)[0]
        status_of(dev.patch(f"/api/files/{f['id']}", {"name": new_name}), 200)
        shows(page, row(page, new_name), PUSH_S + SLACK_S)
        eventually(page, lambda: expect(acts.get_by_role("listitem")).to_have_count(before + 1, timeout=POLL_MS),
                   PUSH_S + SLACK_S)
        extra = upload_pdf(dev, b, "Pushed")
        described(page, node(page, sub["B"]["name"]), files_word(1), PUSH_S + SLACK_S)

        def meter_moved() -> None:
            assert meter_value(page)[0] == used_before + extra["size"]

        eventually(page, meter_moved, PUSH_S + SLACK_S)

    rosa = Api(base, ROSA)
    give(mar, "folder", a, ROSA, "viewer")
    hidden = upload_pdf(mar, h, "Hidden")
    hidden_name, visible_name = f"secret {tok()}.pdf", f"seen {tok()}.pdf"
    tap = EventTap(rosa)
    try:
        assert tap.status == 101
        status_of(mar.patch(f"/api/files/{hidden['id']}", {"name": hidden_name}), 200)
        status_of(mar.patch(f"/api/files/{f['id']}", {"name": visible_name}), 200)
        assert tap.wait_for([visible_name, f["id"]], PUSH_S + SLACK_S), tap.lines
        text = "\n".join(tap.lines)
        assert hidden_name not in text and hidden["id"] not in text and h not in text
    finally:
        tap.close()


def test_sign_in_against_directory(app_url: str) -> None:
    base = app_url.rstrip("/")
    client = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    bad = client.post("/api/session", json={"email": DEV, "password": PASSWORD + "x"})
    assert status_of(bad, 401) == {"error": "invalid_credentials"}
    assert "lintel_session" not in bad.cookies
    status_of(client.get("/api/session"), 401, "unauthenticated")
    status_of(client.post("/api/session", json={"email": f"nobody-{tok()}@lintelworks.test", "password": PASSWORD}),
              401, "invalid_credentials")
    good = client.post("/api/session", json={"email": DEV, "password": PASSWORD})
    person = status_of(good, 200)["person"]
    rec = one(PocketBase().records("users", f'email="{DEV}"'))
    assert (person["name"], person["email"], person["firm"], person["kind"], person["staffRole"]) == \
        (rec["name"], DEV, rec["firm"], rec["kind"], rec["staffRole"])
    assert "lintel_session" in good.cookies
    assert status_of(client.get("/api/session"), 200)["person"]["id"] == person["id"]
    status_of(client.delete("/api/session"), 204)
    status_of(client.get("/api/session"), 401, "unauthenticated")


def test_capabilities(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev, tomas, aiko = (Api(base, e) for e in (MARISOL, DEV, TOMAS, AIKO))
    project, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]
    seen = upload_pdf(mar, a, "Seen")
    hidden = upload_pdf(mar, b, "Hidden")
    binned = upload_pdf(mar, a, "Binned")
    status_of(mar.post("/api/bin", {"fileIds": [binned["id"]]}), 200)
    give(mar, "folder", a, AIKO, "viewer")

    r = dev.post("/api/grants", {"itemType": "folder", "itemId": a, "personId": person_id(dev, ROSA), "role": "viewer"})
    status_of(r, 403, "forbidden")
    assert all(g["person"]["name"] != NAMES[ROSA]
               for g in status_of(mar.get("/api/grants", itemType="folder", itemId=a), 200)["grants"])
    for staff in (dev, mar, tomas):
        status_of(staff.post(f"/api/files/{seen['id']}/lock"), 403, "forbidden")
    assert file_of(mar, seen["id"])["locked"] is False
    status_of(dev.delete(f"/api/bin/{binned['id']}"), 403, "forbidden")
    assert bin_item(mar, binned["id"]) is not None
    status_of(mar.post("/api/policies", {"kind": "bin_retention_days", "days": SHORT_RETENTION_DAYS,
                                         "effectiveFrom": (today_of(base) + timedelta(days=1)).isoformat()}),
              403, "forbidden")
    status_of(dev.post("/api/handovers", {"folderId": project["id"], "toPersonId": person_id(dev, INES),
                                          "days": HANDOVER_DIALOG_DAYS}), 403, "forbidden")
    status_of(mar.get("/api/shared"), 403, "forbidden")
    for path, params in (("/api/storage", {}), ("/api/bin", {}), ("/api/policies", {}), ("/api/handovers", {}),
                         ("/api/grants/defaults", {}), ("/api/people", {"q": "Dev"}),
                         ("/api/grants", {"itemType": "folder", "itemId": a})):
        status_of(aiko.get(path, **params), 403, "forbidden")
    status_of(aiko.post("/api/bin", {"fileIds": [seen["id"]]}), 403, "forbidden")
    status_of(aiko.post("/api/bin", {"fileIds": [hidden["id"]]}), 404, "not_found")
    status_of(aiko.post(f"/api/bin/{binned['id']}/restore"), 404, "not_found")
    status_of(aiko.delete(f"/api/bin/{binned['id']}"), 404, "not_found")
    status_of(aiko.patch(f"/api/files/{seen['id']}", {"name": "x.pdf"}), 403, "forbidden")
    status_of(aiko.post(f"/api/files/{seen['id']}/lock"), 403, "forbidden")
    status_of(aiko.post("/api/folders", {"parentId": a, "name": f"Z{tok()}"}), 403, "forbidden")
    status_of(aiko.post("/api/folders", {"parentId": b, "name": ""}), 404, "not_found")
    status_of(aiko.get(f"/api/files/{hidden['id']}"), 404, "not_found")
    status_of(aiko.get(f"/api/folders/{b}"), 404, "not_found")
    assert file_of(mar, seen["id"])["name"] == seen["name"] and file_of(mar, hidden["id"])["folderId"] == b


def test_people_picker(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    found = status_of(mar.get("/api/people", q="MESQUITE", kind="partner"), 200)["people"]
    aiko = one(p for p in found if p["email"] == AIKO)
    rec = one(PocketBase().records("users", f'email="{AIKO}"'))
    assert (aiko["name"], aiko["firm"], aiko["kind"]) == (rec["name"], rec["firm"], "partner")
    assert status_of(mar.get("/api/people", q="lintelworks", kind="partner"), 200)["people"] == []
    staff = status_of(mar.get("/api/people", q="lintelworks", kind="staff"), 200)["people"]
    assert {p["email"] for p in staff} >= {MARISOL, DEV, INES, TOMAS} and len(staff) <= PEOPLE_MAX
    status_of(mar.get("/api/people", q=""), 422, "validation")
    status_of(mar.get("/api/people", q="a" * (Q_MAX + 1)), 422, "validation")

    project = create_folder(mar, f"P{tok()} Project")
    with signed_in(browser, base, MARISOL, "/drive") as page:
        click(row(page, project["name"]))
        click(page.get_by_role("complementary", name="Details").get_by_role("button", name="Hand over"))
        dialog = page.get_by_role("dialog", name=f"Hand over {project['name']}")
        owner = dialog.get_by_role("combobox", name="New owner")
        focused(page, owner)
        page.keyboard.type("Lintelworks")
        advance(page, PICKER_PAUSE_MS)
        ines_opt = dialog.get_by_role("option", name=re.compile(r"^Ines Whitcombe — Lintelworks"))
        shows(page, ines_opt)
        expect(ines_opt).to_contain_text("Staff")
        expect(dialog.get_by_role("option", name=re.compile(r"^Marisol Okafor"))).to_have_count(0)
        expect(dialog.get_by_role("option", name=re.compile(r"^Aiko Brandt"))).to_have_count(0)
        page.keyboard.press("Control+a")
        page.keyboard.type("Ines")
        advance(page, PICKER_PAUSE_MS)
        eventually(page, lambda: expect(dialog.get_by_role("option")).to_have_count(1, timeout=POLL_MS))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        fill(dialog.get_by_role("spinbutton", name="Days to accept"), "3")
        click(dialog.get_by_role("button", name="Offer"))

        def offered() -> None:
            hands = status_of(mar.get("/api/handovers"), 200)["handovers"]
            h = one(x for x in hands if x["folder"]["id"] == project["id"])
            assert h["to"]["name"] == NAMES[INES] and h["status"] == "offered"

        eventually(page, offered)


def test_directory_outage(app_url: str) -> None:
    base = app_url.rstrip("/")
    down = env_url(DIRECTORY_DOWN_ENV)
    wait_status(down, "directory", "down")
    r = httpx.post(down + "/api/session", json={"email": MARISOL, "password": PASSWORD}, timeout=HTTP_TIMEOUT_S)
    status_of(r, 503, "directory_unavailable")
    mar, aiko = Api(base, MARISOL), Api(base, AIKO)
    project, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    g = give(mar, "folder", a, AIKO, "viewer")
    rosa_id, dev_id = person_id(mar, ROSA), person_id(mar, DEV)
    mdown, adown = Api(down, cookie=mar.cookie), Api(down, cookie=aiko.cookie)
    assert status_of(mdown.get("/api/session"), 200)["person"]["email"] == MARISOL
    status_of(adown.get(f"/api/folders/{a}"), 200)
    status_of(mdown.get("/api/people", q="Aiko"), 503, "directory_unavailable")
    status_of(mdown.post("/api/grants", {"itemType": "folder", "itemId": a, "personId": rosa_id, "role": "viewer"}),
              503, "directory_unavailable")
    grants = status_of(mar.get("/api/grants", itemType="folder", itemId=a), 200)["grants"]
    assert [x["person"]["name"] for x in grants] == [NAMES[AIKO]]
    status_of(mdown.post("/api/handovers", {"folderId": project["id"], "toPersonId": dev_id,
                                            "days": HANDOVER_DIALOG_DAYS}), 503, "directory_unavailable")
    assert all(h["folder"]["id"] != project["id"] for h in status_of(mar.get("/api/handovers"), 200)["handovers"])
    assert status_of(mdown.patch(f"/api/grants/{g['id']}", {"role": "editor"}), 200)["grant"]["role"] == "editor"
    assert status_of(adown.get(f"/api/folders/{a}"), 200)["folder"]["access"] == "editor"
    status_of(mdown.delete(f"/api/grants/{g['id']}"), 204)
    status_of(adown.get(f"/api/folders/{a}"), 404, "not_found")


def test_folder_tree_counts(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev = Api(base, MARISOL), Api(base, DEV)
    project, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]
    upload_pdf(mar, a, "One")
    upload_pdf(mar, a, "Two")
    upload_pdf(mar, b, "Three")
    gone_file = upload_pdf(mar, b, "Binned")
    status_of(mar.post("/api/bin", {"fileIds": [gone_file["id"]]}), 200)
    folders = {f["id"]: f for f in status_of(mar.get("/api/folders"), 200)["folders"]}
    for fid, expected in ((a, 2), (b, 1), (project["id"], 0)):
        assert folders[fid]["fileCount"] == expected == len(listing(mar, fid))
    give(mar, "folder", a, AIKO, "viewer")
    with signed_in(browser, base, MARISOL, "/drive") as page:
        reveal(page, project["name"])
        described(page, node(page, sub["A"]["name"]), files_word(2))
        described(page, node(page, sub["B"]["name"]), files_word(1))
        expect(node(page, sub["A"]["name"])).to_contain_text("2")
        upload_pdf(dev, b, "Pushed")
        described(page, node(page, sub["B"]["name"]), files_word(2), PUSH_S + SLACK_S)
    with signed_in(browser, base, AIKO, "/shared") as page:
        shows(page, node(page, sub["A"]["name"]))
        described(page, node(page, sub["A"]["name"]), files_word(2))
        expect(node(page, sub["B"]["name"])).to_have_count(0)
        expect(node(page, project["name"])).to_have_count(0)
    aiko_ids = {f["id"] for f in status_of(Api(base, AIKO).get("/api/folders"), 200)["folders"]}
    assert a in aiko_ids and b not in aiko_ids and project["id"] not in aiko_ids


def ordered(locators: list[Locator]) -> None:
    boxes = [loc.bounding_box() for loc in locators]
    keys = [(round(bx["y"]), round(bx["x"])) for bx in boxes]
    assert keys == sorted(keys), keys


def test_sort_view_search(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, aiko = Api(base, MARISOL), Api(base, AIKO)
    t = tok()
    _, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]
    made = {}
    for label, size in (("c", 2000), ("a", 3000), ("b", 1000)):
        name = f"{label}{t}.pdf"
        made[label] = upload(mar, a, name, pdf_bytes(name, size))["name"]
    needle = f"z{t}q"
    upload(mar, b, f"{needle}.pdf", pdf_bytes(needle))
    expected = {"name-asc": "abc", "name-desc": "cba", "modified-desc": "bac", "modified-asc": "cab",
                "size-desc": "acb", "size-asc": "bca"}
    for key, order in expected.items():
        got = [f["name"] for f in status_of(mar.get("/api/files", folderId=a, sort=key), 200)["files"]]
        assert got == [made[x] for x in order], (key, got)
    found = status_of(mar.get("/api/files", q=needle.upper()), 200)
    assert [f["name"] for f in found["files"]] == [f"{needle}.pdf"] and found["folders"] == []
    status_of(mar.get("/api/files", folderId=a, sort="bogus"), 422, "validation")
    status_of(mar.get("/api/files", q="q" * (Q_MAX + 1)), 422, "validation")
    give(mar, "folder", a, AIKO, "viewer")
    assert sorted(f["name"] for f in status_of(aiko.get("/api/files", q=t), 200)["files"]) == sorted(made.values())
    with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
        shows(page, row(page, made["a"]))
        select(page.get_by_role("combobox", name="Sort by"), "Largest first")
        eventually(page, lambda: ordered([row(page, made[x]) for x in "acb"]))
        check(page.get_by_role("radio", name="Grid"))
        eventually(page, lambda: expect(page.get_by_role("radio", name="Grid")).to_be_checked(timeout=POLL_MS))
        eventually(page, lambda: ordered([row(page, made[x]) for x in "acb"]))
        box = page.get_by_role("searchbox", name="Search files")
        fill(box, f"nomatch{t}")
        watch(page)
        box.press("Enter")
        announced_once(page, f"No files match nomatch{t}.")
        fill(box, needle)
        box.press("Enter")
        shows(page, row(page, f"{needle}.pdf"))
        expect(row(page, made["a"])).to_have_count(0)


def test_address_state(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    f = upload_pdf(mar, a, "Addr")
    q = f"Addr {f['name'].split()[1][:4]}"
    with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
        shows(page, row(page, f["name"]))
        h0 = page.evaluate("history.length")
        check(page.get_by_role("radio", name="Grid"))
        eventually(page, lambda: assert_param(page, "view", "grid"))
        select(page.get_by_role("combobox", name="Sort by"), "Newest first")
        eventually(page, lambda: assert_param(page, "sort", "modified-desc"))
        box = page.get_by_role("searchbox", name="Search files")
        fill(box, q)
        assert "q" not in qs(page)
        box.press("Enter")
        eventually(page, lambda: assert_param(page, "q", q))
        assert page.evaluate("history.length") == h0 + 3
        box.press("Enter")
        advance(page, SETTLE_MS)
        assert page.evaluate("history.length") == h0 + 3
        page.go_back()
        eventually(page, lambda: assert_param(page, "q", None))
        page.go_back()
        eventually(page, lambda: assert_param(page, "sort", None))
        assert_param(page, "view", "grid")
        assert_param(page, "folder", a)
        page.go_forward()
        eventually(page, lambda: assert_param(page, "sort", "modified-desc"))
        url = page.url
        page.reload()
        eventually(page, lambda: expect(page.get_by_role("radio", name="Grid")).to_be_checked(timeout=POLL_MS))
        shows(page, row(page, f["name"]))
        with signed_in(browser, base, MARISOL, url[len(base):]) as second:
            eventually(second, lambda: expect(second.get_by_role("radio", name="Grid")).to_be_checked(timeout=POLL_MS))
            shows(second, row(second, f["name"]))
        page.goto(f"{base}/drive?folder={JUNK_ID}")
        shows_on_screen(page, UNAVAILABLE_FOLDER)


def assert_param(page: Page, key: str, value: str | None) -> None:
    got = qs(page).get(key)
    assert (got[0] if got else None) == value, (key, page.url)


def test_recent_files(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, aiko = Api(base, MARISOL), Api(base, AIKO)
    _, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]
    fa, fb = upload_pdf(mar, a, "RecA"), upload_pdf(mar, b, "RecB")
    give(mar, "folder", a, AIKO, "viewer")
    recent = status_of(mar.get("/api/files/recent"), 200)["files"]
    assert len(recent) <= RECENT_MAX
    ids = [f["id"] for f in recent]
    assert fa["id"] in ids and fb["id"] in ids and ids.index(fb["id"]) < ids.index(fa["id"])
    assert fb["id"] not in [f["id"] for f in status_of(aiko.get("/api/files/recent"), 200)["files"]]
    status_of(move(mar, a, [(fb["id"], b)]), 200)
    hit = one(f for f in status_of(mar.get("/api/files/recent"), 200)["files"] if f["id"] == fb["id"])
    assert hit["folderId"] == a and hit["folderName"] == sub["A"]["name"]
    assert fb["id"] in [f["id"] for f in status_of(aiko.get("/api/files/recent"), 200)["files"]]
    status_of(mar.post("/api/bin", {"fileIds": [fa["id"]]}), 200)
    for who in (mar, aiko):
        assert fa["id"] not in [f["id"] for f in status_of(who.get("/api/files/recent"), 200)["files"]]


def test_keyboard_tree_and_list(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]
    create_folder(mar, f"B1{tok()}", b)
    files = [upload_pdf(mar, a, f"F{i}") for i in range(1, 6)]
    names = sorted(f["name"] for f in files)
    with signed_in(browser, base, MARISOL, "/drive") as page:
        top = node(page, project["name"])
        shows(page, top)
        if top.get_attribute("aria-expanded") == "true":
            top.focus()
            page.keyboard.press("ArrowLeft")
        eventually(page, lambda: expect(top).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        top.focus()
        page.keyboard.press("ArrowRight")
        eventually(page, lambda: expect(top).to_have_attribute("aria-expanded", "true", timeout=POLL_MS))
        page.keyboard.press("ArrowRight")
        focused_any(page, node(page, sub["A"]["name"]), node(page, sub["B"]["name"]))
        b_open = node(page, sub["B"]["name"]).get_attribute("aria-expanded")
        page.keyboard.press("ArrowLeft")
        focused(page, top)
        page.keyboard.press("ArrowLeft")
        eventually(page, lambda: expect(top).to_have_attribute("aria-expanded", "false", timeout=POLL_MS))
        page.keyboard.press("ArrowRight")
        choose_in_tree(page, tree(page), project["name"], sub["B"]["name"])
        expect(node(page, sub["B"]["name"])).to_have_attribute("aria-expanded", b_open)
        advance(page, TYPEAHEAD_RESET_MS + STEP_MS)
        page.keyboard.type(sub["A"]["name"])
        focused(page, node(page, sub["A"]["name"]))
        page.keyboard.press("Enter")
        eventually(page, lambda: assert_param(page, "folder", a))

        shows(page, row(page, names[0]))
        watch(page)
        page.get_by_role("combobox", name="Sort by").focus()
        page.keyboard.press("Tab")
        focused(page, row(page, names[0]))
        selected = files_list(page).get_by_role("option", selected=True)
        expect(selected).to_have_count(0)
        for _ in range(4):
            page.keyboard.press("Shift+ArrowDown")
        eventually(page, lambda: expect(selected).to_have_count(5, timeout=POLL_MS))
        announced_once(page, "5 selected")
        page.keyboard.press("ArrowUp")
        eventually(page, lambda: expect(row(page, names[3])).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
        expect(selected).to_have_count(1)
        page.keyboard.press("Control+ArrowUp")
        focused(page, row(page, names[2]))
        expect(selected).to_have_count(1)
        page.keyboard.press("Control+Space")
        eventually(page, lambda: expect(selected).to_have_count(2, timeout=POLL_MS))
        page.keyboard.press("Space")
        eventually(page, lambda: expect(selected).to_have_count(1, timeout=POLL_MS))
        expect(row(page, names[2])).to_have_attribute("aria-selected", "true")
        page.keyboard.press("Control+a")
        eventually(page, lambda: expect(selected).to_have_count(5, timeout=POLL_MS))
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(selected).to_have_count(0, timeout=POLL_MS))
        announced_once(page, "Selection cleared")
        page.keyboard.press("End")
        focused(page, row(page, names[4]))
        page.keyboard.press("Home")
        focused(page, row(page, names[0]))
        advance(page, TYPEAHEAD_RESET_MS + STEP_MS)
        page.keyboard.type(names[3][:12])
        focused(page, row(page, names[3]))
        page.keyboard.press("Enter")
        has_text(page, page.get_by_role("complementary", name="Details"), names[3])
        focused(page, row(page, names[3]))
        page.keyboard.press("Home")
        page.keyboard.press("Space")
        toolbar(page).get_by_role("button", name="Move to", exact=True).focus()
        page.keyboard.press("Control+x")
        announced_once(page, "1 file cut")
        has_text(page, row(page, names[0]), "Cut")
        node(page, sub["B"]["name"]).click()
        node(page, sub["B"]["name"]).focus()
        page.keyboard.press("Control+v")
        announced_once(page, moved_copy(1, sub["B"]["name"]))
    moved_id = one(f for f in files if f["name"] == names[0])["id"]
    assert file_of(mar, moved_id)["folderId"] == b


def test_details_and_activity(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev = Api(base, MARISOL), Api(base, DEV)
    _, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]
    img_name = f"Photo {tok()}.png"
    img = upload(mar, a, img_name, png_bytes(3), PNG)
    blob = upload(mar, a, f"Blob {tok()}.bin", b"\x00\x01\x02", BINARY)
    renamed = f"Photo renamed {tok()}.png"
    status_of(mar.patch(f"/api/files/{img['id']}", {"name": renamed}), 200)
    status_of(move(dev, b, [(img["id"], a)]), 200)
    entries = activity(mar, img["id"])
    assert [e["action"] for e in entries[:3]] == ["moved", "renamed", "uploaded"]
    assert [e["actor"]["name"] for e in entries[:3]] == ["Dev Halvorsen", "Marisol Okafor", "Marisol Okafor"]
    stamps = [parse_instant(e["at"]) for e in entries]
    assert stamps == sorted(stamps, reverse=True) and all(e["at"].endswith("Z") for e in entries)
    assert any(e["action"] == "moved" and e["fileId"] == img["id"]
               for e in status_of(mar.get(f"/api/folders/{b}/activity"), 200)["entries"])
    assert file_of(mar, blob["id"])["previewable"] is False
    status_of(mar.post(f"/api/files/{blob['id']}/links", {"purpose": "preview"}), 422, "validation")
    with signed_in(browser, base, MARISOL, f"/drive?folder={b}") as page:
        click(row(page, renamed))
        page.keyboard.press("Enter")
        details = page.get_by_role("complementary", name="Details")
        has_text(page, details, renamed)
        has_text(page, details, FOOTNOTE)
        acts = details.get_by_role("list", name="Activity").get_by_role("listitem")
        eventually(page, lambda: expect(acts).to_have_count(len(entries), timeout=POLL_MS))
        expect(acts.first).to_contain_text("Dev Halvorsen")
        expect(acts.first).to_contain_text(phx_minute(entries[0]["at"]))
        preview = details.get_by_role("region", name="Preview")
        shows(page, preview)
        expect(preview).not_to_contain_text(NO_PREVIEW)
        page.goto(f"{base}/drive?folder={a}")
        click(row(page, blob["name"]))
        page.keyboard.press("Enter")
        has_text(page, page.get_by_role("complementary", name="Details").get_by_role("region", name="Preview"), NO_PREVIEW)


def test_multipart_upload_resume(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    name = f"Package {tok()}.pdf"
    data = pdf_bytes(name, 2 * PART_SIZE + PART_TAIL)
    up = status_of(start_upload(mar, sub["A"]["id"], name, len(data)), 201)["upload"]
    assert (up["state"], up["partCount"], up["partSize"], up["confirmedParts"]) == ("started", 3, PART_SIZE, [])
    one_done = status_of(send_part(mar, up["id"], 1, data), 200)["upload"]
    assert one_done["state"] == "uploading" and one_done["confirmedParts"] == [1]
    bad = status_of(mar.put(f"/api/uploads/{up['id']}/parts/2", data[PART_SIZE:2 * PART_SIZE - 1]), 422, "validation")
    assert "part" in bad["fields"]
    status_of(mar.put(f"/api/uploads/{up['id']}/parts/3", data[2 * PART_SIZE:] + b"x"), 422, "validation")
    assert status_of(mar.post(f"/api/uploads/{up['id']}/pause"), 200)["upload"]["state"] == "paused"
    listed = one(u for u in status_of(mar.get("/api/uploads"), 200)["uploads"] if u["id"] == up["id"])
    assert listed["state"] == "paused" and listed["confirmedParts"] == [1]
    assert status_of(mar.post(f"/api/uploads/{up['id']}/resume"), 200)["upload"]["state"] == "uploading"
    for n in (2, 3):
        status_of(send_part(mar, up["id"], n, data), 200)
    assert sorted(status_of(mar.get(f"/api/uploads/{up['id']}"), 200)["upload"]["confirmedParts"]) == [1, 2, 3]
    assert S3().keys(f"files/{up['id']}") == []
    f = status_of(mar.post(f"/api/uploads/{up['id']}/complete"), 201)["file"]
    assert f["id"] == up["id"] and f["size"] == len(data)
    assert s3_sha(S3(), f"files/{f['id']}") == hashlib.sha256(data).hexdigest()


def test_upload_confirmed_by_storage(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    name = f"Confirm {tok()}.pdf"
    data = pdf_bytes(name, PART_SIZE + PART_TAIL)
    used0 = storage(mar)["usedBytes"]
    up = status_of(start_upload(mar, a, name, len(data)), 201)["upload"]
    for n in (1, 2):
        status_of(send_part(mar, up["id"], n, data), 200)
    status_of(mar.get(f"/api/files/{up['id']}"), 404, "not_found")
    assert count_of(mar, a) == 0 and storage(mar)["usedBytes"] == used0
    down = Api(env_url(STORAGE_DOWN_ENV), cookie=mar.cookie)
    status_of(down.post(f"/api/uploads/{up['id']}/complete"), 503, "storage_unavailable")
    assert status_of(mar.get(f"/api/uploads/{up['id']}"), 200)["upload"]["state"] == "uploading"
    status_of(mar.get(f"/api/files/{up['id']}"), 404, "not_found")
    assert count_of(mar, a) == 0 and storage(mar)["usedBytes"] == used0
    assert not any(e.get("fileId") == up["id"] for e in status_of(mar.get(f"/api/folders/{a}/activity"), 200)["entries"])
    f = status_of(mar.post(f"/api/uploads/{up['id']}/complete"), 201)["file"]
    assert count_of(mar, a) == 1 and storage(mar)["usedBytes"] == used0 + len(data)
    assert len(S3().get(f"files/{f['id']}")) == len(data)
    assert [e["action"] for e in activity(mar, f["id"])] == ["uploaded"]

    other = status_of(start_upload(mar, a, f"Drop {tok()}.pdf", 10), 201)["upload"]
    status_of(mar.put(f"/api/uploads/{other['id']}/parts/1", b"0123456789"), 200)
    status_of(mar.delete(f"/api/uploads/{other['id']}"), 204)
    status_of(mar.get(f"/api/uploads/{other['id']}"), 404, "not_found")
    status_of(mar.get(f"/api/files/{other['id']}"), 404, "not_found")
    assert S3().keys(f"files/{other['id']}") == [] and count_of(mar, a) == 1


def test_upload_state_machine(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    data = pdf_bytes("sm", PART_SIZE + PART_TAIL)
    status_of(start_upload(mar, a, "x.pdf", 0), 422, "validation")
    status_of(start_upload(mar, a, "x.pdf", MAX_FILE_BYTES + 1), 422, "validation")
    status_of(start_upload(mar, a, "a/b.pdf", 10), 422, "validation")
    key = idempotency_key()
    name = f"SM {tok()}.pdf"
    first = status_of(start_upload(mar, a, name, len(data), key=key), 201)["upload"]
    again = start_upload(mar, a, name, len(data), key=key)
    assert again.status_code == 201 and again.json()["upload"]["id"] == first["id"]
    status_of(start_upload(mar, a, name + "x", len(data), key=key), 409, "idempotency_key_reused")
    uid = first["id"]
    status_of(mar.post(f"/api/uploads/{uid}/complete"), 409, "parts_missing")
    assert status_of(mar.post(f"/api/uploads/{uid}/resume"), 200)["upload"]["state"] == "started"
    assert status_of(mar.post(f"/api/uploads/{uid}/pause"), 200)["upload"]["state"] == "paused"
    assert status_of(mar.post(f"/api/uploads/{uid}/pause"), 200)["upload"]["state"] == "paused"
    status_of(send_part(mar, uid, 1, data), 409, "upload_paused")
    status_of(mar.post(f"/api/uploads/{uid}/resume"), 200)
    status_of(send_part(mar, uid, 1, data), 200)
    assert status_of(mar.post(f"/api/uploads/{uid}/resume"), 200)["upload"]["state"] == "uploading"
    missing = status_of(mar.post(f"/api/uploads/{uid}/complete"), 409, "parts_missing")
    assert missing["missing"] == [2]
    status_of(send_part(mar, uid, 2, data), 200)
    assert status_of(mar.post(f"/api/uploads/{uid}/pause"), 200)["upload"]["state"] == "paused"
    status_of(mar.post(f"/api/uploads/{uid}/complete"), 409, "upload_paused")
    status_of(mar.post(f"/api/uploads/{uid}/resume"), 200)
    f = status_of(mar.post(f"/api/uploads/{uid}/complete"), 201)["file"]
    assert status_of(mar.post(f"/api/uploads/{uid}/complete"), 200)["file"]["id"] == f["id"]
    for step in ("pause", "resume"):
        status_of(mar.post(f"/api/uploads/{uid}/{step}"), 409, "upload_confirmed")
    status_of(send_part(mar, uid, 1, data), 409, "upload_confirmed")
    status_of(mar.delete(f"/api/uploads/{uid}"), 409, "upload_confirmed")
    gone_up = status_of(start_upload(mar, a, f"C {tok()}.pdf", 10), 201)["upload"]["id"]
    status_of(mar.delete(f"/api/uploads/{gone_up}"), 204)
    status_of(mar.post(f"/api/uploads/{gone_up}/resume"), 404, "not_found")


def test_abandoned_upload_expires(app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    fresh_day(clock)
    mar = Api(clock, MARISOL)
    _, sub = make_project(mar, "A")
    t0 = server_now(clock)
    paused = status_of(start_upload(mar, sub["A"]["id"], f"Idle {tok()}.pdf", 10), 201)["upload"]["id"]
    status_of(mar.put(f"/api/uploads/{paused}/parts/1", b"0123456789"), 200)
    status_of(mar.post(f"/api/uploads/{paused}/pause"), 200)
    idle = status_of(start_upload(mar, sub["A"]["id"], f"Idle {tok()}.pdf", 10), 201)["upload"]["id"]
    set_clock(clock, t0 + timedelta(seconds=UPLOAD_TTL_S - TTL_MARGIN_S))
    assert status_of(mar.get(f"/api/uploads/{paused}"), 200)["upload"]["state"] == "paused"
    assert status_of(mar.get(f"/api/uploads/{idle}"), 200)["upload"]["state"] == "started"
    set_clock(clock, t0 + timedelta(seconds=UPLOAD_TTL_S + TTL_MARGIN_S))
    listed = {u["id"]: u["state"] for u in status_of(mar.get("/api/uploads"), 200)["uploads"]}
    assert listed.get(paused) == "abandoned" and listed.get(idle) == "abandoned"
    status_of(mar.put(f"/api/uploads/{paused}/parts/1", b"0123456789"), 409, "upload_abandoned")
    status_of(mar.post(f"/api/uploads/{paused}/resume"), 409, "upload_abandoned")
    assert S3("-clock").keys(f"files/{paused}") == []
    status_of(mar.get(f"/api/files/{paused}"), 404, "not_found")
    status_of(mar.delete(f"/api/uploads/{paused}"), 204)
    status_of(mar.get(f"/api/uploads/{paused}"), 404, "not_found")


def test_storage_meter(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A", "B")
    s0 = storage(mar)
    f = upload_pdf(mar, sub["A"]["id"], "Meter", 4321)
    s1 = storage(mar)
    assert s1["usedBytes"] - s0["usedBytes"] == f["size"] == len(S3().get(f"files/{f['id']}"))
    status_of(mar.patch(f"/api/files/{f['id']}", {"name": f"Meter {tok()}.pdf"}), 200)
    status_of(move(mar, sub["B"]["id"], [(f["id"], sub["A"]["id"])]), 200)
    assert storage(mar)["usedBytes"] == s1["usedBytes"]
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    s2 = storage(mar)
    assert s2["usedBytes"] == s1["usedBytes"] and s2["binBytes"] == s1["binBytes"] + f["size"]
    with signed_in(browser, base, MARISOL, "/drive") as page:
        def figures() -> None:
            now = storage(mar)
            assert meter_value(page) == [now["usedBytes"], now["quotaBytes"]]
            expect(page.get_by_text(f"{human(now['usedBytes'])} of {human(now['quotaBytes'])} used")).to_be_visible(
                timeout=POLL_MS)

        eventually(page, figures)
    with signed_in(browser, base, AIKO, "/shared") as page:
        shows(page, page.get_by_role("searchbox", name="Search files"))
        expect(page.get_by_role("meter", name="Company storage")).to_have_count(0)


def test_uploads_refused_storage_outage(app_url: str) -> None:
    base = app_url.rstrip("/")
    down = env_url(STORAGE_DOWN_ENV)
    wait_status(down, "storage", "down")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    mdown = Api(down, cookie=mar.cookie)
    name = f"Outage {tok()}.pdf"
    status_of(start_upload(mdown, sub["A"]["id"], name, 10), 503, "storage_unavailable")
    assert all(u["name"] != name for u in status_of(mar.get("/api/uploads"), 200)["uploads"])
    assert count_of(mar, sub["A"]["id"]) == 0


def test_previews_storage_outage(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A", "B")
    f = upload_pdf(mar, sub["A"]["id"], "Outage preview")
    mdown = Api(env_url(STORAGE_DOWN_ENV), cookie=mar.cookie)
    for purpose in ("preview", "download"):
        status_of(mdown.post(f"/api/files/{f['id']}/links", {"purpose": purpose}), 503, "storage_unavailable")
    assert [x["id"] for x in listing(mdown, sub["A"]["id"])] == [f["id"]]
    status_of(mdown.get(f"/api/files/{f['id']}"), 200)
    assert activity(mdown, f["id"])
    renamed = f"Renamed {tok()}.pdf"
    status_of(mdown.patch(f"/api/files/{f['id']}", {"name": renamed}), 200)
    status_of(move(mdown, sub["B"]["id"], [(f["id"], sub["A"]["id"])]), 200)
    got = file_of(mar, f["id"])
    assert got["name"] == renamed and got["folderId"] == sub["B"]["id"]


def test_moves_with_replay(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev, ines = Api(base, MARISOL), Api(base, DEV), Api(base, INES)
    _, sub = make_project(mar, "A", "B", "C")
    a, b, c = (sub[k]["id"] for k in "ABC")
    free, held_f, lost = (upload_pdf(mar, a, x) for x in ("Free", "Held", "Lost"))
    already = upload_pdf(mar, b, "Already")
    lock(ines, held_f["id"])
    status_of(move(dev, c, [(lost["id"], a)]), 200)
    key = idempotency_key()
    items = [(free["id"], a), (held_f["id"], a), (lost["id"], a), (already["id"], b)]
    first = move(mar, b, items, key)
    body = status_of(first, 200)
    assert body["toFolder"] == {"id": b, "name": sub["B"]["name"]}
    assert body["moved"] == [{"fileId": free["id"], "fromFolderId": a}]
    assert body["stayed"] == [{"fileId": held_f["id"], "reason": "locked"}]
    lost_entry = one(body["lostTo"])
    assert lost_entry["fileId"] == lost["id"] and lost_entry["folder"] == {"id": c, "name": sub["C"]["name"]}
    assert lost_entry["by"]["name"] == "Dev Halvorsen"
    assert body["unchanged"] == [already["id"]]
    assert body["folderCounts"][b] == 2 == count_of(mar, b) and body["folderCounts"][a] == 1 == count_of(mar, a)
    status_of(move(mar, a, [(free["id"], b)]), 200)
    replay = move(mar, b, items, key)
    assert replay.status_code == 200 and replay.json() == body
    assert replay.headers.get("Idempotent-Replayed") == "true"
    assert file_of(mar, free["id"])["folderId"] == a
    assert [e["action"] for e in activity(mar, free["id"])].count("moved") == 2
    status_of(move(mar, c, items, key), 409, "idempotency_key_reused")
    status_of(mar.post("/api/moves", {"toFolderId": b, "items": []}), 422, "validation")
    status_of(move(mar, b, [(free["id"], a), (free["id"], a)]), 422, "validation")
    assert file_of(mar, free["id"])["folderId"] == a


def test_concurrent_moves_one_winner(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev = Api(base, MARISOL), Api(base, DEV)
    labels = [f"D{i}" for i in range(MOVE_RACERS)]
    _, sub = make_project(mar, "S", *labels)
    src = sub["S"]["id"]
    f = upload_pdf(mar, src, "Contested")
    movers = [mar if i % 2 == 0 else dev for i in range(MOVE_RACERS)]
    dests = [sub[x]["id"] for x in labels]
    barrier = threading.Barrier(MOVE_RACERS)

    def race(i: int) -> httpx.Response:
        barrier.wait(HTTP_TIMEOUT_S)
        return move(movers[i], dests[i], [(f["id"], src)])

    with ThreadPoolExecutor(MOVE_RACERS) as pool:
        results = list(pool.map(race, range(MOVE_RACERS)))
    bodies = [status_of(r, 200) for r in results]
    winners = [i for i, bd in enumerate(bodies) if bd["moved"]]
    assert len(winners) == 1, bodies
    w = winners[0]
    for i, bd in enumerate(bodies):
        if i == w:
            continue
        lost = one(bd["lostTo"])
        assert bd["moved"] == [] and lost["fileId"] == f["id"]
        assert lost["folder"] == {"id": dests[w], "name": sub[labels[w]]["name"]}
        assert lost["by"] == {"id": movers[w].person["id"], "name": movers[w].person["name"]}
    assert file_of(mar, f["id"])["folderId"] == dests[w]
    assert count_of(mar, src) == 0
    assert [count_of(mar, d) for d in dests] == [1 if d == dests[w] else 0 for d in dests]
    assert [e["action"] for e in activity(mar, f["id"])].count("moved") == 1


def test_counts_ledger_meter_together(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    _, sub = make_project(mar, "A", "B")
    a, b = sub["A"]["id"], sub["B"]["id"]

    def snap(fid: str | None) -> tuple[int, int, int, int, list[str]]:
        st = storage(mar)
        acts = [e["action"] for e in status_of(mar.get(f"/api/folders/{a}/activity"), 200)["entries"]
                if e.get("fileId") == fid] if fid else []
        for folder in (a, b):
            assert count_of(mar, folder) == len(listing(mar, folder))
        return count_of(mar, a), count_of(mar, b), st["usedBytes"], st["binBytes"], acts

    a0, b0, u0, bin0, _ = snap(None)
    f = upload_pdf(mar, a, "Together", 1234)
    size = f["size"]
    assert snap(f["id"])[:4] == (a0 + 1, b0, u0 + size, bin0)
    status_of(mar.patch(f"/api/files/{f['id']}", {"name": f"Together {tok()}.pdf"}), 200)
    assert activity(mar, f["id"])[0]["action"] == "renamed" and snap(f["id"])[:4] == (a0 + 1, b0, u0 + size, bin0)
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    assert snap(f["id"])[:4] == (a0, b0, u0 + size, bin0 + size)
    status_of(mar.post(f"/api/bin/{f['id']}/restore"), 200)
    assert activity(mar, f["id"])[0]["action"] == "restored" and snap(f["id"])[:4] == (a0 + 1, b0, u0 + size, bin0)
    other = upload_pdf(mar, a, "Locked")
    lock(ines, other["id"])
    before = (snap(other["id"]), len(activity(mar, other["id"])))
    status_of(move(mar, b, [(other["id"], a)]), 200)
    assert (snap(other["id"]), len(activity(mar, other["id"]))) == before
    status_of(move(mar, b, [(f["id"], a)]), 200)
    assert activity(mar, f["id"])[0]["action"] == "moved" and snap(f["id"])[:2] == (a0 + 1, b0 + 1)
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    st = storage(mar)
    status_of(ines.delete(f"/api/bin/{f['id']}"), 204)
    after = storage(mar)
    assert after["usedBytes"] == st["usedBytes"] - size and after["binBytes"] == st["binBytes"] - size
    assert len(purged_entries(mar, b, f["id"])) == 1


def test_move_dialog_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B")
    f = upload_pdf(mar, sub["A"]["id"], "Dialog")
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}") as page:
        click(row(page, f["name"]))
        opener = toolbar(page).get_by_role("button", name="Move to", exact=True)
        dialog = open_move_dialog(page)
        dest_tree = dialog.get_by_role("tree", name="Destination folders")
        eventually(page, lambda: _assert(dest_tree.evaluate("el => el.contains(document.activeElement)")))
        for key in ["Tab"] * 6 + ["Shift+Tab"] * 6:
            page.keyboard.press(key)
            assert dialog.evaluate("el => el.contains(document.activeElement)"), key
        page.keyboard.press("Escape")
        eventually(page, lambda: expect(dialog).to_be_hidden(timeout=POLL_MS))
        focused(page, opener)
        assert file_of(mar, f["id"])["folderId"] == sub["A"]["id"]
        dialog = open_move_dialog(page)
        dest_tree = dialog.get_by_role("tree", name="Destination folders")
        eventually(page, lambda: _assert(dest_tree.evaluate("el => el.contains(document.activeElement)")))
        choose_in_tree(page, dest_tree, project["name"], sub["B"]["name"])
        page.keyboard.press("Enter")
        eventually(page, lambda: _assert(file_of(mar, f["id"])["folderId"] == sub["B"]["id"]))


def _assert(value: Any) -> None:
    assert value


def purged_entries(api: Api, folder_id: str, file_id: str) -> list[dict[str, Any]]:
    return [e for e in status_of(api.get(f"/api/folders/{folder_id}/activity"), 200)["entries"]
            if e["action"] == "purged" and e.get("folderId") == folder_id and e.get("fileId") in (file_id, None)]


def test_lock_badge_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    _, sub = make_project(mar, "A")
    f = upload_pdf(mar, sub["A"]["id"], "Lockable")
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}") as page:
        target = row(page, f["name"])
        shows(page, target)
        expect(target).not_to_contain_text("Locked")
        assert status_of(ines.post(f"/api/files/{f['id']}/lock"), 200)["file"]["locked"] is True
        has_text(page, target, "Locked", PUSH_S + SLACK_S)
        status_of(ines.post(f"/api/files/{f['id']}/lock"), 409, "already_locked")
        assert status_of(ines.delete(f"/api/files/{f['id']}/lock"), 200)["file"]["locked"] is False
        lacks_text(page, target, "Locked", PUSH_S + SLACK_S)
        status_of(ines.delete(f"/api/files/{f['id']}/lock"), 409, "not_locked")
    acts = activity(mar, f["id"])
    assert [e["action"] for e in acts[:2]] == ["unlocked", "locked"]
    assert {e["actor"]["name"] for e in acts[:2]} == {"Ines Whitcombe"}


def test_locked_files_stay_put(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    _, sub = make_project(mar, "A", "B")
    a = sub["A"]["id"]
    held_f, free = upload_pdf(mar, a, "Held"), upload_pdf(mar, a, "Free")
    lock(ines, held_f["id"])
    status_of(mar.patch(f"/api/files/{held_f['id']}", {"name": f"New {tok()}.pdf"}), 409, "locked")
    status_of(move(mar, sub["B"]["id"], [(held_f["id"], a)]), 200)
    assert file_of(mar, held_f["id"])["name"] == held_f["name"] and file_of(mar, held_f["id"])["folderId"] == a
    with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
        click(row(page, held_f["name"]))
        row(page, free["name"]).click(modifiers=["Control"])
        watch(page)
        page.keyboard.press("Delete")
        announced_once(page, "Moved 1 file to the bin. 1 locked file stayed")
    assert bin_item(mar, free["id"]) is not None and bin_item(mar, held_f["id"]) is None
    assert file_of(mar, held_f["id"])["folderId"] == a and count_of(mar, a) == 1
    other = upload_pdf(mar, a, "Other")
    body = status_of(mar.post("/api/bin", {"fileIds": [held_f["id"], other["id"]]}), 200)
    assert body == {"binned": [other["id"]], "stayed": [{"fileId": held_f["id"], "reason": "locked"}]}


def test_timed_grants(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines, aiko = Api(base, MARISOL), Api(base, INES), Api(base, AIKO)
    _, sub = make_project(mar, "A", "B")
    a = sub["A"]["id"]
    f = upload_pdf(mar, sub["B"]["id"], "Granted file")
    d = status_of(mar.get("/api/grants/defaults"), 200)
    today, last = date.fromisoformat(d["today"]), date.fromisoformat(d["maxEndDate"])
    assert last == today + timedelta(days=GRANT_MAX_DAYS)
    aiko_id = person_id(mar, AIKO)

    def post(person: str, end: date) -> httpx.Response:
        return mar.post("/api/grants", {"itemType": "folder", "itemId": a, "personId": person, "role": "viewer",
                                        "endDate": end.isoformat()})

    assert status_of(post(person_id(mar, DEV), today), 422, "validation")["fields"]["personId"] == STAFF_ONLY_GRANTS
    window = f"Choose a date from {today.isoformat()} to {last.isoformat()}."
    for end in (today - timedelta(days=1), last + timedelta(days=1)):
        assert status_of(post(aiko_id, end), 422, "validation")["fields"]["endDate"] == window
    assert all(g["person"]["id"] != aiko_id
               for g in status_of(mar.get("/api/grants", itemType="folder", itemId=a), 200)["grants"])
    g = status_of(post(aiko_id, today + timedelta(days=5)), 201)["grant"]
    assert (g["itemType"], g["itemId"], g["itemName"], g["role"], g["status"], g["endedReason"]) == \
        ("folder", a, sub["A"]["name"], "viewer", "active", None)
    assert g["person"]["name"] == "Aiko Brandt" and g["person"]["firm"] == "Mesquite Row Architects"
    assert g["endDate"] == (today + timedelta(days=5)).isoformat() and g["daysLeft"] == 5
    status_of(post(aiko_id, today), 409, "grant_exists")
    fg = give(ines, "file", f["id"], CALLUM, "editor", last)
    assert fg["itemType"] == "file" and fg["endDate"] == last.isoformat()
    changed = status_of(mar.patch(f"/api/grants/{g['id']}", {"role": "editor",
                                                             "endDate": (today + timedelta(days=9)).isoformat()}), 200)
    assert changed["grant"]["role"] == "editor" and changed["grant"]["daysLeft"] == 9
    assert status_of(aiko.get(f"/api/folders/{a}"), 200)["folder"]["access"] == "editor"
    status_of(mar.patch(f"/api/grants/{g['id']}", {"endDate": (last + timedelta(days=1)).isoformat()}), 422, "validation")
    status_of(mar.delete(f"/api/grants/{g['id']}"), 204)
    assert all(x["id"] != g["id"] for x in status_of(mar.get("/api/grants", itemType="folder", itemId=a), 200)["grants"])
    status_of(mar.patch(f"/api/grants/{g['id']}", {"role": "viewer"}), 409, "grant_ended")
    status_of(mar.delete(f"/api/grants/{g['id']}"), 409, "grant_ended")
    acts = [e["action"] for e in status_of(mar.get(f"/api/folders/{a}/activity"), 200)["entries"]]
    assert {"shared", "access_changed", "access_removed"} <= set(acts)


def test_default_grant_length(app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    tomas, mar = Api(clock, TOMAS), Api(clock, MARISOL)
    _, sub = make_project(mar, "A")
    old = in_force(tomas, "partner_grant_days")
    first = give(mar, "folder", sub["A"]["id"], AIKO, "viewer")
    assert first["endDate"] == (today + timedelta(days=old)).isoformat()
    d = status_of(mar.get("/api/grants/defaults"), 200)
    assert d["defaultEndDate"] == first["endDate"]
    assert d["maxEndDate"] == (today + timedelta(days=GRANT_MAX_DAYS)).isoformat()
    new = SHORT_RETENTION_DAYS if old != SHORT_RETENTION_DAYS else SHORT_RETENTION_DAYS + 1
    eff = today + timedelta(days=1)
    status_of(tomas.post("/api/policies", {"kind": "partner_grant_days", "days": new,
                                           "effectiveFrom": eff.isoformat()}), 201)
    moved = set_clock(clock, phx(eff, 18))
    assert moved["today"] == eff.isoformat()
    assert status_of(mar.get("/api/grants/defaults"), 200)["defaultEndDate"] == (eff + timedelta(days=new)).isoformat()
    second = give(mar, "folder", sub["A"]["id"], CALLUM, "viewer")
    assert second["endDate"] == (eff + timedelta(days=new)).isoformat()
    kept = one(g for g in status_of(mar.get("/api/grants", itemType="folder", itemId=sub["A"]["id"]), 200)["grants"]
               if g["id"] == first["id"])
    assert kept["endDate"] == first["endDate"]


def test_shared_with_me(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, aiko = Api(base, MARISOL), Api(base, AIKO)
    project, sub = make_project(mar, "V", "H")
    v, h = sub["V"]["id"], sub["H"]["id"]
    fv, fh, fx = upload_pdf(mar, v, "Vis"), upload_pdf(mar, h, "Direct"), upload_pdf(mar, h, "Never")
    today = today_of(base)
    end_v, end_f = today + timedelta(days=12), today + timedelta(days=20)
    give(mar, "folder", v, AIKO, "viewer", end_v)
    give(mar, "file", fh["id"], AIKO, "editor", end_f)
    items = status_of(aiko.get("/api/shared"), 200)["items"]
    fi = one(i for i in items if i["itemType"] == "folder" and i["folder"]["id"] == v)
    assert (fi["role"], fi["endDate"], fi["daysLeft"]) == ("viewer", end_v.isoformat(), 12)
    di = one(i for i in items if i["itemType"] == "file" and i["file"]["id"] == fh["id"])
    assert (di["role"], di["endDate"], di["daysLeft"]) == ("editor", end_f.isoformat(), 20)
    assert di["file"]["folderId"] is None and di["file"]["folderName"] == ANOTHER_FOLDER
    folder = status_of(aiko.get(f"/api/folders/{v}"), 200)
    assert folder["folder"]["parentId"] is None and folder["folder"]["projectId"] is None
    assert folder["path"] == [{"id": v, "name": sub["V"]["name"]}]
    got = status_of(aiko.get(f"/api/files/{fv['id']}"), 200)
    assert got["file"]["accessEnds"] == end_v.isoformat() and got["file"]["access"] == "viewer"
    direct = status_of(aiko.get(f"/api/files/{fh['id']}"), 200)
    assert direct["path"] == [] and direct["file"]["folderName"] == ANOTHER_FOLDER
    assert direct["file"]["accessEnds"] == end_f.isoformat()
    for r in (aiko.get(f"/api/files/{fx['id']}"), aiko.get(f"/api/folders/{h}"),
              aiko.get(f"/api/folders/{project['id']}"), aiko.get("/api/files", folderId=h),
              aiko.get(f"/api/files/{fx['id']}/activity"),
              aiko.post(f"/api/files/{fx['id']}/links", {"purpose": "download"}),
              aiko.patch(f"/api/files/{fx['id']}", {"name": "x.pdf"})):
        status_of(r, 404, "not_found")
    ids = {f["id"] for f in status_of(aiko.get("/api/folders"), 200)["folders"]}
    assert v in ids and h not in ids and project["id"] not in ids


def grant_edge_setup() -> dict[str, Any]:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    mar, callum, rosa = Api(clock, MARISOL), Api(clock, CALLUM), Api(clock, ROSA)
    project, sub = make_project(mar, "Calc", "Rep")
    calc, rep = sub["Calc"]["id"], sub["Rep"]["id"]
    fc, fr = upload_pdf(mar, calc, "Calc"), upload_pdf(mar, rep, "Rep")
    end = today + timedelta(days=1)
    long_end = today + timedelta(days=SEED_CALLUM_VIEWER_DAYS)
    give(mar, "folder", project["id"], CALLUM, "viewer", long_end)
    give(mar, "folder", calc, CALLUM, "editor", end)
    give(mar, "folder", rep, ROSA, "editor", end)
    got = file_of(callum, fc["id"])
    assert got["access"] == "editor" and got["accessEnds"] == end.isoformat()
    return {"clock": clock, "mar": mar, "callum": callum, "rosa": rosa, "calc": calc, "rep": rep,
            "fc": fc, "fr": fr, "end": end, "long_end": long_end}


def test_grant_end_edge() -> None:
    g = grant_edge_setup()
    clock, mar, callum, rosa, end = g["clock"], g["mar"], g["callum"], g["rosa"], g["end"]
    fc, fr, rep = g["fc"], g["fr"], g["rep"]
    set_clock(clock, phx(end, 8))
    assert file_of(callum, fc["id"])["access"] == "editor"
    status_of(rosa.get(f"/api/files/{fr['id']}"), 200)
    set_clock(clock, phx(end, *LAST_MINUTE))
    status_of(rosa.get(f"/api/folders/{rep}"), 200)
    renamed = f"Calc late {tok()}.pdf"
    status_of(callum.patch(f"/api/files/{fc['id']}", {"name": renamed}), 200)
    set_clock(clock, phx(end + timedelta(days=1)))
    status_of(rosa.get(f"/api/folders/{rep}"), 404, "not_found")
    status_of(rosa.get(f"/api/files/{fr['id']}"), 404, "not_found")
    status_of(callum.patch(f"/api/files/{fc['id']}", {"name": f"x {tok()}.pdf"}), 403, "forbidden")
    assert file_of(mar, fc["id"])["name"] == renamed


def test_grant_fallback_to_parent() -> None:
    g = grant_edge_setup()
    clock, mar, callum, rosa, end = g["clock"], g["mar"], g["callum"], g["rosa"], g["end"]
    fc, fr = g["fc"], g["fr"]
    set_clock(clock, phx(end + timedelta(days=1)))
    after = file_of(callum, fc["id"])
    assert after["access"] == "viewer" and after["accessEnds"] == g["long_end"].isoformat()
    status_of(callum.patch(f"/api/files/{fc['id']}", {"name": f"x {tok()}.pdf"}), 403, "forbidden")
    assert file_of(mar, fc["id"])["name"] == fc["name"]
    status_of(rosa.get(f"/api/files/{fr['id']}"), 404, "not_found")
    assert all(x["person"]["name"] != NAMES[CALLUM]
               for x in status_of(mar.get("/api/grants", itemType="folder", itemId=g["calc"]), 200)["grants"])


def test_ended_access_refused_everywhere() -> None:
    g = grant_edge_setup()
    clock, rosa, end, fr, rep = g["clock"], g["rosa"], g["end"], g["fr"], g["rep"]
    link = status_of(rosa.post(f"/api/files/{fr['id']}/links", {"purpose": "download"}), 201)["url"]
    set_clock(clock, phx(end + timedelta(days=1)))
    for r in (rosa.get(f"/api/files/{fr['id']}"), rosa.get(f"/api/folders/{rep}"),
              rosa.get(f"/api/files/{fr['id']}/activity"), rosa.get("/api/files", folderId=rep),
              rosa.post(f"/api/files/{fr['id']}/links", {"purpose": "download"}),
              rosa.patch(f"/api/files/{fr['id']}", {"name": "x.pdf"}), rosa.get(link)):
        status_of(r, 404, "not_found")
    assert all(i.get("folder") is None or i["folder"]["id"] != rep for i in status_of(rosa.get("/api/shared"), 200)["items"])
    assert fr["id"] not in [f["id"] for f in status_of(rosa.get("/api/files/recent"), 200)["files"]]
    assert file_of(g["mar"], fr["id"])["name"] == fr["name"]


def test_downgrade_and_removal_next_request(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines, aiko = Api(base, MARISOL), Api(base, INES), Api(base, AIKO)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    f = upload_pdf(mar, a, "Perm")
    g = give(mar, "folder", a, AIKO, "editor")
    first = f"Perm one {tok()}.pdf"
    status_of(aiko.patch(f"/api/files/{f['id']}", {"name": first}), 200)
    status_of(ines.patch(f"/api/grants/{g['id']}", {"role": "viewer"}), 200)
    status_of(aiko.patch(f"/api/files/{f['id']}", {"name": f"Perm two {tok()}.pdf"}), 403, "forbidden")
    status_of(aiko.post("/api/folders", {"parentId": a, "name": f"Z{tok()}"}), 403, "forbidden")
    assert file_of(mar, f["id"])["name"] == first
    assert file_of(aiko, f["id"])["access"] == "viewer"
    status_of(ines.delete(f"/api/grants/{g['id']}"), 204)
    for r in (aiko.get(f"/api/files/{f['id']}"), aiko.get(f"/api/folders/{a}"),
              aiko.get(f"/api/files/{f['id']}/activity"), aiko.get("/api/files", folderId=a),
              aiko.post(f"/api/files/{f['id']}/links", {"purpose": "download"})):
        status_of(r, 404, "not_found")


def test_bin_days_left(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, tomas = Api(base, MARISOL), Api(base, TOMAS)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    f = upload_pdf(mar, a, "Bin me")
    today, rule = today_of(base), in_force(tomas, "bin_retention_days")
    status_of(mar.post("/api/bin", {"fileIds": []}), 422, "validation")
    assert status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200) == {"binned": [f["id"]], "stayed": []}
    item = bin_item(mar, f["id"])
    assert item["fromFolder"] == {"id": a, "name": sub["A"]["name"]} and item["binnedDate"] == today.isoformat()
    assert item["retentionDays"] == rule and item["daysLeft"] == rule and item["purgePending"] is False
    assert item["purgeDate"] == (today + timedelta(days=rule)).isoformat()
    status_of(mar.get(f"/api/files/{f['id']}"), 404, "not_found")
    assert count_of(mar, a) == 0
    with signed_in(browser, base, MARISOL, "/bin") as page:
        line = page.get_by_role("table", name="Binned files").get_by_role("row").filter(has_text=f["name"])
        has_text(page, line, f"{bin_days(rule)} · {rule}-day rule")
        expect(line).to_contain_text(sub["A"]["name"])
        expect(line).to_contain_text(today.isoformat())


def test_restore_and_delete_forever(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    f = upload_pdf(mar, a, "Forever", 2222)
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    restored = status_of(mar.post(f"/api/bin/{f['id']}/restore"), 200)["file"]
    assert restored["folderId"] == a and count_of(mar, a) == 1 and activity(mar, f["id"])[0]["action"] == "restored"
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    st = storage(mar)
    down = Api(env_url(STORAGE_DOWN_ENV), cookie=ines.cookie)
    status_of(down.delete(f"/api/bin/{f['id']}"), 503, "storage_unavailable")
    assert bin_item(mar, f["id"]) is not None and S3().keys(f"files/{f['id']}") == [f"files/{f['id']}"]
    assert storage(mar) == st
    status_of(ines.delete(f"/api/bin/{f['id']}"), 204)
    assert S3().keys(f"files/{f['id']}") == [] and bin_item(mar, f["id"]) is None
    after = storage(mar)
    assert after["usedBytes"] == st["usedBytes"] - f["size"] and after["binBytes"] == st["binBytes"] - f["size"]
    status_of(mar.post(f"/api/bin/{f['id']}/restore"), 404, "not_found")
    assert len(purged_entries(mar, a, f["id"])) == 1


def test_scheduled_purge(app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    fresh_day(clock)
    mar = Api(clock, MARISOL)
    _, sub = make_project(mar, "A")
    f = upload_pdf(mar, sub["A"]["id"], "Purge")
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    purge = date.fromisoformat(bin_item(mar, f["id"])["purgeDate"])
    set_clock(clock, phx(purge - timedelta(days=1), *LAST_MINUTE))
    assert bin_item(mar, f["id"]) is not None and S3("-clock").keys(f"files/{f['id']}") != []
    used = storage(mar)["usedBytes"]
    set_clock(clock, phx(purge, 0, 0, 5))
    assert bin_item(mar, f["id"]) is None
    store = S3("-clock")
    assert store.keys(f"files/{f['id']}") == []
    after = storage(mar)["usedBytes"]
    assert after <= used - f["size"]
    assert after == sum(len(store.get(k)) for k in store.keys("files/"))
    purged = purged_entries(mar, sub["A"]["id"], f["id"])
    assert len(purged) == 1 and purged[0]["actor"] is None


def test_effective_dated_policies(app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    tomas = Api(clock, TOMAS)
    old = in_force(tomas, "bin_retention_days")
    new = SHORT_RETENTION_DAYS if old != SHORT_RETENTION_DAYS else SHORT_RETENTION_DAYS - 1
    eff = today + timedelta(days=1)

    def schedule(kind: str, days: int, when: date) -> httpx.Response:
        return tomas.post("/api/policies", {"kind": kind, "days": days, "effectiveFrom": when.isoformat()})

    assert status_of(schedule("bin_retention_days", new, today), 422, "validation")["fields"]["effectiveFrom"] == DATE_AFTER_TODAY
    for days in (0, BIN_MAX_DAYS + 1):
        assert status_of(schedule("bin_retention_days", days, eff), 422, "validation")["fields"]["days"] == BIN_DAYS_RANGE
    status_of(schedule("partner_grant_days", GRANT_MAX_DAYS + 1, eff), 422, "validation")
    pol = status_of(schedule("bin_retention_days", new, eff), 201)["policy"]
    assert pol["state"] == "scheduled" and pol["days"] == new
    status_of(schedule("bin_retention_days", old, eff), 409, "policy_exists")
    later = status_of(schedule("bin_retention_days", old, eff + timedelta(days=1)), 201)["policy"]
    status_of(tomas.delete(f"/api/policies/{later['id']}"), 204)
    assert all(p["id"] != later["id"] for p in status_of(tomas.get("/api/policies"), 200)["policies"])
    assert in_force(tomas, "bin_retention_days") == old
    set_clock(clock, phx(eff, 0, 0, 10))
    states = {p["id"]: p["state"] for p in status_of(tomas.get("/api/policies"), 200)["policies"]}
    assert states[pol["id"]] == "in_force"
    assert in_force(tomas, "bin_retention_days") == new
    status_of(tomas.delete(f"/api/policies/{pol['id']}"), 409, "policy_started")
    assert any(p["id"] == pol["id"] for p in status_of(tomas.get("/api/policies"), 200)["policies"])


def test_bin_rule_kept_per_binned_date(app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    tomas, mar = Api(clock, TOMAS), Api(clock, MARISOL)
    old = in_force(tomas, "bin_retention_days")
    new = SHORT_RETENTION_DAYS if old != SHORT_RETENTION_DAYS else SHORT_RETENTION_DAYS - 1
    eff = today + timedelta(days=1)
    status_of(tomas.post("/api/policies", {"kind": "bin_retention_days", "days": new,
                                           "effectiveFrom": eff.isoformat()}), 201)
    _, sub = make_project(mar, "A")
    early, late = upload_pdf(mar, sub["A"]["id"], "Early"), upload_pdf(mar, sub["A"]["id"], "Late")
    status_of(mar.post("/api/bin", {"fileIds": [early["id"]]}), 200)
    first = bin_item(mar, early["id"])
    assert first["retentionDays"] == old and first["daysLeft"] == old
    assert first["purgeDate"] == (today + timedelta(days=old)).isoformat()
    set_clock(clock, phx(eff, 0, 0, 10))
    status_of(mar.post("/api/bin", {"fileIds": [late["id"]]}), 200)
    second = bin_item(mar, late["id"])
    assert second["retentionDays"] == new and second["daysLeft"] == new
    assert second["binnedDate"] == eff.isoformat()
    assert second["purgeDate"] == (eff + timedelta(days=new)).isoformat()
    kept = bin_item(mar, early["id"])
    assert kept["retentionDays"] == old and kept["purgeDate"] == first["purgeDate"]
    assert kept["daysLeft"] == old - 1


def test_handover_offers(app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, dev, ines, tomas = (Api(base, e) for e in (MARISOL, DEV, INES, TOMAS))
    project, sub = make_project(mar, "S")
    pid = project["id"]
    dev_id = person_id(mar, DEV)

    def offer(api: Api, folder: str, to: str, days: int) -> httpx.Response:
        return api.post("/api/handovers", {"folderId": folder, "toPersonId": to, "days": days})

    status_of(offer(mar, sub["S"]["id"], dev_id, HANDOVER_DIALOG_DAYS), 422, "validation")
    body = status_of(offer(mar, pid, person_id(mar, MARISOL), HANDOVER_DIALOG_DAYS), 422, "validation")
    assert body["fields"]["toPersonId"] == OTHER_THAN_OWNER
    status_of(offer(mar, pid, person_id(mar, AIKO), HANDOVER_DIALOG_DAYS), 422, "validation")
    for days in (0, HANDOVER_MAX_DAYS + 1):
        assert status_of(offer(mar, pid, dev_id, days), 422, "validation")["fields"]["days"] == HANDOVER_DAYS_RANGE
    today = today_of(base)
    h = status_of(offer(mar, pid, dev_id, HANDOVER_DIALOG_DAYS), 201)["handover"]
    assert (h["status"], h["from"]["name"], h["to"]["name"], h["offeredDate"]) == \
        ("offered", "Marisol Okafor", "Dev Halvorsen", today.isoformat())
    assert h["lapseDate"] == (today + timedelta(days=HANDOVER_DIALOG_DAYS)).isoformat()
    status_of(offer(mar, pid, person_id(mar, INES), 3), 409, "handover_open")
    status_of(tomas.post(f"/api/handovers/{h['id']}/accept"), 404, "not_found")
    status_of(ines.post(f"/api/handovers/{h['id']}/accept"), 403, "forbidden")
    status_of(mar.post(f"/api/handovers/{h['id']}/accept"), 403, "forbidden")
    assert status_of(dev.post(f"/api/handovers/{h['id']}/accept"), 200)["handover"]["status"] == "accepted"
    assert status_of(mar.get(f"/api/folders/{pid}"), 200)["folder"]["owner"]["name"] == "Dev Halvorsen"
    status_of(dev.post(f"/api/handovers/{h['id']}/accept"), 409, "handover_accepted")
    status_of(dev.post(f"/api/handovers/{h['id']}/decline"), 409, "handover_accepted")
    back = status_of(offer(dev, pid, person_id(dev, MARISOL), 3), 201)["handover"]
    assert status_of(mar.post(f"/api/handovers/{back['id']}/decline"), 200)["handover"]["status"] == "declined"
    assert status_of(mar.get(f"/api/folders/{pid}"), 200)["folder"]["owner"]["name"] == "Dev Halvorsen"
    status_of(mar.post(f"/api/handovers/{back['id']}/decline"), 409, "handover_declined")
    acts = {e["action"] for e in status_of(mar.get(f"/api/folders/{pid}/activity"), 200)["entries"]}
    assert {"handover_offered", "handover_accepted", "handover_declined"} <= acts


def test_handover_lapse(browser: Browser, app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    mar, dev = Api(clock, MARISOL), Api(clock, DEV)
    project = create_folder(mar, f"P{tok()} Project")
    h = status_of(mar.post("/api/handovers", {"folderId": project["id"], "toPersonId": person_id(mar, DEV),
                                              "days": 1}), 201)["handover"]
    lapse = today + timedelta(days=1)
    assert h["lapseDate"] == lapse.isoformat()
    set_clock(clock, phx(lapse, *LAST_MINUTE))
    lapsed = f"Your handover of {project['name']} to Dev Halvorsen lapsed. You still own it."
    with signed_in(browser, clock, MARISOL, "/handovers") as page:
        page.clock.set_system_time(phx(lapse + timedelta(days=DEVICE_SKEW_DAYS), 12))
        page.reload()
        line = page.get_by_role("table", name="Handovers").get_by_role("row").filter(has_text=project["name"])
        has_text(page, line, f"Open until {lapse.isoformat()}")
        with signed_in(browser, clock, DEV, "/handovers", cookie=dev.cookie) as recipient:
            accept = recipient.get_by_role("table", name="Handovers").get_by_role(
                "button", name=f"Accept {project['name']}")
            shows(recipient, accept)
            with signed_in(browser, clock, DEV, "/handovers", cookie=dev.cookie) as stale:
                EventGate(stale, closed=True)
                stale_accept = stale.get_by_role("table", name="Handovers").get_by_role(
                    "button", name=f"Accept {project['name']}")
                shows(stale, stale_accept)
                watch(page)
                set_clock(clock, phx(lapse + timedelta(days=1)))
                announced_once(page, lapsed, EXPIRY_PUSH_S + SLACK_S)
                has_text(page, notices(page), lapsed)
                gone(recipient, accept, EXPIRY_PUSH_S + SLACK_S)
                watch(stale)
                click(stale_accept)
                announced_once(stale, f"This handover lapsed at the end of {lapse.isoformat()}.")
        watch_from_load(page)
        page.reload()
        shows(page, line)
        unheard(page, lapsed)
    got = one(x for x in status_of(mar.get("/api/handovers"), 200)["handovers"] if x["id"] == h["id"])
    assert got["status"] == "lapsed"
    assert status_of(mar.get(f"/api/folders/{project['id']}"), 200)["folder"]["owner"]["name"] == "Marisol Okafor"
    status_of(dev.post(f"/api/handovers/{h['id']}/accept"), 409, "handover_lapsed")
    entry = one(e for e in status_of(mar.get(f"/api/folders/{project['id']}/activity"), 200)["entries"]
                if e["action"] == "handover_lapsed")
    assert entry["actor"] is None


def test_phone_layout_and_flight(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B")
    f1, f2 = upload_pdf(mar, sub["A"]["id"], "Phone1"), upload_pdf(mar, sub["A"]["id"], "Phone2")
    with signed_in(browser, base, MARISOL, "/drive", viewport=VIEWPORTS["phone"]) as page:
        click(page.get_by_role("button", name="Open navigation"))
        drawer = page.get_by_role("dialog", name="Navigation")
        shows(page, drawer)
        settle(drawer)
        click(drawer.get_by_role("treeitem", name=project["name"], exact=True))
        eventually(page, lambda: assert_offscreen(drawer))
        tap(row(page, sub["A"]["name"]))
        shows(page, row(page, f1["name"]))
        long_press(page, row(page, f1["name"]))
        eventually(page, lambda: expect(row(page, f1["name"])).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
        tap(row(page, f2["name"]))
        eventually(page, lambda: expect(row(page, f2["name"])).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
        tap(row(page, f2["name"]))
        eventually(page, lambda: expect(row(page, f2["name"])).to_have_attribute("aria-selected", "false", timeout=POLL_MS))
        bar = toolbar(page)
        shows(page, bar)
        box = bar.bounding_box()
        assert abs(box["y"] + box["height"] - VIEWPORTS["phone"][1]) <= 1, box
        for button in bar.get_by_role("button").all():
            if tappable(button):
                b = button.bounding_box()
                assert b["width"] >= TOUCH_TARGET_PX and b["height"] >= TOUCH_TARGET_PX, b
        start = row(page, f1["name"]).bounding_box()
        dialog = open_move_dialog(page)
        dest_tree = dialog.get_by_role("tree", name="Destination folders")
        choose_in_tree(page, dest_tree, project["name"], sub["B"]["name"])
        click(dialog.get_by_role("button", name="Move here"))
        path = flight(page, chip(page, f1["id"]), CHIP_FLIGHT_MAX_MS)
        assert_flight(path, start, page.get_by_role("navigation", name="Folder path").bounding_box())
        layout(page)
    assert file_of(mar, f1["id"])["folderId"] == sub["B"]["id"]


def test_wf_sign_in_keyboard(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    t = tok()
    small = upload(mar, a, f"Deep {t} small.pdf", pdf_bytes("small"))
    big = upload(mar, a, f"Deep {t} big.pdf", pdf_bytes("big", 4000))
    q = f"Deep {t}"
    asked = {"folder": a, "view": "grid", "sort": "size-desc", "q": q}
    with open_app(browser, f"{base}/drive?{urlencode(asked)}") as page:
        heading = page.get_by_role("heading", name="Sign in to Lintel Drive")
        shows(page, heading)
        assert urlparse(page.url).path == "/sign-in"
        page.get_by_role("textbox", name="Email").focus()
        page.keyboard.type(MARISOL)
        page.get_by_label("Password").focus()
        page.keyboard.type(PASSWORD)
        page.keyboard.press("Enter")
        eventually(page, lambda: _assert(urlparse(page.url).path == "/drive"))
        assert {k: v[0] for k, v in qs(page).items()} == asked, page.url
        eventually(page, lambda: expect(page.get_by_role("radio", name="Grid")).to_be_checked(timeout=POLL_MS))
        shows(page, row(page, big["name"]))
        shows(page, row(page, small["name"]))
        eventually(page, lambda: ordered([row(page, big["name"]), row(page, small["name"])]))
        nav = page.get_by_role("navigation", name="Drive")
        for name in ("Projects", "Recent", "Bin", "Handovers"):
            shows(page, nav.get_by_role("link", name=name))
        for name in ("Shared with me", "Settings"):
            expect(nav.get_by_role("link", name=name)).to_have_count(0)
        cookie = one(c for c in page.context.cookies() if c["name"] == "lintel_session")
        assert cookie["httpOnly"] is True
        api = Api(base, cookie=cookie["value"])
        assert status_of(api.get("/api/session"), 200)["person"]["email"] == MARISOL
        second = page.context.new_page()
        second.goto(base + "/recent")
        shows(second, second.get_by_role("navigation", name="Drive").get_by_role("link", name="Recent"))
        assert urlparse(second.url).path == "/recent"
        click(page.get_by_role("button", name="Account"))
        click(page.get_by_role("menu", name="Account").get_by_role("menuitem", name="Sign out"))
        eventually(page, lambda: status_of(api.get("/api/session"), 401, "unauthenticated"))
        second.reload()
        eventually(second, lambda: _assert(urlparse(second.url).path == "/sign-in"))
        shows(second, second.get_by_role("heading", name="Sign in to Lintel Drive"))


def test_wf_sign_in_wrong_password(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    with open_app(browser, base + "/sign-in") as page:
        shows(page, page.get_by_role("heading", name="Sign in to Lintel Drive"))
        watch(page)
        fill(page.get_by_role("textbox", name="Email"), DEV)
        fill(page.get_by_label("Password"), PASSWORD + "x")
        click(page.get_by_role("button", name="Sign in"))
        announced_once(page, WRONG_CREDENTIALS)
        assert all(c["name"] != "lintel_session" for c in page.context.cookies())
        assert urlparse(page.url).path == "/sign-in"


def test_wf_sign_in_directory_outage(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    down = env_url(DIRECTORY_DOWN_ENV)
    wait_status(down, "directory", "down")
    with open_app(browser, down + "/sign-in") as page:
        shows(page, page.get_by_role("heading", name="Sign in to Lintel Drive"))
        watch(page)
        fill(page.get_by_role("textbox", name="Email"), MARISOL)
        fill(page.get_by_label("Password"), PASSWORD)
        click(page.get_by_role("button", name="Sign in"))
        announced_once(page, SIGN_IN_OUTAGE)
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    with signed_in(browser, down, None, f"/drive?folder={sub['A']['id']}", cookie=mar.cookie) as page:
        shows(page, node(page, SAGUARO))
        project_row = page.get_by_role("navigation", name="Folder path")
        shows(page, project_row)
        page.goto(f"{down}/drive")
        click(row(page, _project_of(mar, sub["A"]["id"])))
        click(toolbar(page).get_by_role("button", name="Share"))
        dialog = page.get_by_role("dialog", name=re.compile(r"^Share "))
        person = dialog.get_by_role("combobox", name="Person", exact=True)
        focused(page, person)
        watch(page)
        page.keyboard.type("Aiko")
        advance(page, PICKER_PAUSE_MS)
        has_text(page, dialog, PICKER_OUTAGE)
        eventually(page, lambda: _assert(announced(page, PICKER_OUTAGE) >= 1))


def _project_of(api: Api, folder_id: str) -> str:
    folder = status_of(api.get(f"/api/folders/{folder_id}"), 200)
    return folder["path"][0]["name"]


def test_wf_browse_project(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "D")
    d = sub["D"]["id"]
    files = [upload_pdf(mar, d, f"Sheet{i}") for i in range(1, 4)]
    newest = [f["name"] for f in status_of(mar.get("/api/files", folderId=d, sort="modified-desc"), 200)["files"]]
    with signed_in(browser, base, MARISOL, "/drive") as page:
        reveal(page, project["name"])
        h0 = page.evaluate("history.length")
        click(node(page, sub["D"]["name"]))
        eventually(page, lambda: assert_param(page, "folder", d))
        check(page.get_by_role("radio", name="Grid"))
        eventually(page, lambda: assert_param(page, "view", "grid"))
        select(page.get_by_role("combobox", name="Sort by"), "Newest first")
        eventually(page, lambda: ordered([row(page, n) for n in newest]))
        eventually(page, lambda: assert_param(page, "sort", "modified-desc"))
        box = page.get_by_role("searchbox", name="Search files")
        fill(box, files[1]["name"])
        box.press("Enter")
        shows(page, row(page, files[1]["name"]))
        gone(page, row(page, files[0]["name"]))
        eventually(page, lambda: _assert(page.evaluate("history.length") == h0 + 4))
        box.press("Enter")
        advance(page, SETTLE_MS)
        assert page.evaluate("history.length") == h0 + 4
        page.go_back()
        eventually(page, lambda: assert_param(page, "q", None))
        shows(page, row(page, files[0]["name"]))
        eventually(page, lambda: ordered([row(page, n) for n in newest]))
        page.go_back()
        eventually(page, lambda: assert_param(page, "sort", None))
        assert_param(page, "view", "grid")
        assert_param(page, "folder", d)
        eventually(page, lambda: ordered([row(page, f["name"]) for f in files]))
        page.go_forward()
        eventually(page, lambda: assert_param(page, "sort", "modified-desc"))
        page.go_forward()
        eventually(page, lambda: assert_param(page, "q", files[1]["name"]))
        shows(page, row(page, files[1]["name"]))
        gone(page, row(page, files[0]["name"]))
        click(row(page, files[1]["name"]))
        page.keyboard.press("Enter")
        has_text(page, page.get_by_role("complementary", name="Details"), files[1]["name"])
        url = page.url
        page.reload()
        assert page.url == url
        for key, value in (("view", "grid"), ("sort", "modified-desc"), ("q", files[1]["name"])):
            assert_param(page, key, value)
        eventually(page, lambda: expect(page.get_by_role("radio", name="Grid")).to_be_checked(timeout=POLL_MS))
        shows(page, row(page, files[1]["name"]))
        expect(row(page, files[0]["name"])).to_have_count(0)
        with signed_in(browser, base, MARISOL, url[len(base):]) as second:
            eventually(second, lambda: expect(second.get_by_role("radio", name="Grid")).to_be_checked(timeout=POLL_MS))
            shows(second, row(second, files[1]["name"]))
            expect(row(second, files[0]["name"])).to_have_count(0)
            for key, value in (("view", "grid"), ("sort", "modified-desc"), ("q", files[1]["name"])):
                assert_param(second, key, value)


def test_wf_browse_partner(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, aiko = Api(base, MARISOL), Api(base, AIKO)
    project, sub = make_project(mar, "V", "H")
    end = today_of(base) + timedelta(days=12)
    give(mar, "folder", sub["V"]["id"], AIKO, "editor", end)
    item = one(i for i in status_of(aiko.get("/api/shared"), 200)["items"]
               if i["folder"] and i["folder"]["id"] == sub["V"]["id"])
    with signed_in(browser, base, AIKO, "/drive") as page:
        eventually(page, lambda: _assert(urlparse(page.url).path == "/shared"))
        line = row(page, sub["V"]["name"])
        has_text(page, line, f"Ends {end.isoformat()} · {grant_days(item['daysLeft'])}")
        expect(line).to_contain_text("editor", ignore_case=True)
        page.goto(f"{base}/drive?folder={sub['V']['id']}")
        path = page.get_by_role("navigation", name="Folder path")
        has_text(page, path, "Shared with me")
        expect(path).not_to_contain_text(project["name"])
        page.goto(f"{base}/drive?folder={sub['H']['id']}")
        shows_on_screen(page, UNAVAILABLE_FOLDER)


def test_wf_upload_pause_reload_resume(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A")
    a = sub["A"]["id"]
    name = f"Package {tok()}.pdf"
    data = pdf_bytes(name, 2 * PART_SIZE + PART_TAIL)
    used0 = storage(mar)["usedBytes"]
    with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
        reveal(page, project["name"])
        panel = page.get_by_role("region", name="Uploads")
        with held(page, "**/parts/2") as hold:
            open_new_upload(page, name, data)
            pause = page.get_by_role("button", name=f"Pause {name}")
            shows(page, pause)
            eventually(page, lambda: _assert(1 in one(u for u in status_of(mar.get("/api/uploads"), 200)["uploads"]
                                                      if u["name"] == name)["confirmedParts"]))
            uploads_listed(page, mar)
            click(pause)
            hold.release()
        has_text(page, panel, "Paused")

        def paused() -> dict[str, Any]:
            up = one(u for u in status_of(mar.get("/api/uploads"), 200)["uploads"] if u["name"] == name)
            assert up["state"] == "paused"
            return up

        up = poll(paused, UI_DEADLINE_S)
        assert 1 in up["confirmedParts"] and len(up["confirmedParts"]) < up["partCount"]
        assert storage(mar)["usedBytes"] == used0 and count_of(mar, a) == 0
        sent: list[str] = []
        page.on("request", lambda req: sent.append(req.url) if "/parts/" in req.url else None)
        page.reload()
        resume = page.get_by_role("button", name=f"Resume {name}")
        shows(page, resume)
        watch(page)
        click(resume)
        has_text(page, panel, "Done")
        announced_once(page, f"Uploaded {name}")
        shows(page, row(page, name))
        reveal(page, project["name"])
        described(page, node(page, sub["A"]["name"]), files_word(1))
        eventually(page, lambda: _assert(meter_value(page)[0] == used0 + len(data)))
        assert not any(url.endswith(f"/parts/{n}") for n in up["confirmedParts"] for url in sent), sent
    f = one(listing(mar, a))
    assert f["name"] == name and storage(mar)["usedBytes"] == used0 + len(data)
    assert s3_sha(S3(), f"files/{f['id']}") == hashlib.sha256(data).hexdigest()

    clock = env_url(CLOCK_ENV)
    fresh_day(clock)
    dev = Api(clock, DEV)
    _, csub = make_project(dev, "E")
    idle = f"Idle {tok()}.pdf"
    expired = f"Upload of {idle} expired"
    with signed_in(browser, clock, DEV, f"/drive?folder={csub['E']['id']}", cookie=dev.cookie) as page:
        panel = page.get_by_role("region", name="Uploads")
        with held(page, "**/parts/2") as hold:
            open_new_upload(page, idle, pdf_bytes(idle, 2 * PART_SIZE + PART_TAIL))
            pause = page.get_by_role("button", name=f"Pause {idle}")
            shows(page, pause)
            eventually(page, lambda: _assert(1 in one(u for u in status_of(dev.get("/api/uploads"), 200)["uploads"]
                                                      if u["name"] == idle)["confirmedParts"]))
            click(pause)
            hold.release()
        has_text(page, panel, "Paused")
        poll(lambda: _assert(one(u for u in status_of(dev.get("/api/uploads"), 200)["uploads"]
                                 if u["name"] == idle)["state"] == "paused"), UI_DEADLINE_S)
        shows(page, panel.get_by_role("button", name=f"Resume {idle}"))
        watch(page)
        set_clock(clock, server_now(clock) + timedelta(seconds=UPLOAD_TTL_S + TTL_MARGIN_S))
        announced_once(page, expired, EXPIRY_PUSH_S + SLACK_S)
        has_text(page, panel, "Expired", EXPIRY_PUSH_S + SLACK_S)
        gone(page, panel.get_by_role("button", name=f"Resume {idle}"))
        assert one(u for u in status_of(dev.get("/api/uploads"), 200)["uploads"]
                   if u["name"] == idle)["state"] == "abandoned"
        watch_from_load(page)
        page.reload()
        shows(page, panel.get_by_role("button", name=f"Dismiss {idle}"))
        has_text(page, panel, "Expired")
        expect(panel.get_by_role("button", name=f"Resume {idle}")).to_have_count(0)
        unheard(page, expired)


def test_wf_upload_storage_outage(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    down = env_url(STORAGE_DOWN_ENV)
    wait_status(down, "storage", "down")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    photo = upload(mar, sub["A"]["id"], f"Photo {tok()}.png", png_bytes(5), PNG)
    name = f"Waiting {tok()}.pdf"
    with signed_in(browser, down, None, f"/drive?folder={sub['A']['id']}", cookie=mar.cookie) as page:
        has_text(page, page.get_by_role("region", name="Service status"), STORAGE_OUTAGE)
        watch(page)
        open_new_upload(page, name, pdf_bytes(name))
        has_text(page, page.get_by_role("region", name="Uploads"), "Waiting for storage")
        eventually(page, lambda: _assert(announced(page, STORAGE_OUTAGE) >= 1))
        click(row(page, photo["name"]))
        page.keyboard.press("Enter")
        details = page.get_by_role("complementary", name="Details")
        has_text(page, details.get_by_role("region", name="Preview"), PREVIEW_OUTAGE)
        eventually(page, lambda: expect(details.get_by_role("list", name="Activity").get_by_role("listitem"))
                   .not_to_have_count(0, timeout=POLL_MS))
    assert all(u["name"] != name for u in status_of(mar.get("/api/uploads"), 200)["uploads"])
    assert [f["id"] for f in listing(mar, sub["A"]["id"])] == [photo["id"]]


def test_wf_upload_cancel(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    name = f"Cancel {tok()}.pdf"
    data = pdf_bytes(name, PART_SIZE + PART_TAIL)
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}") as page:
        with held(page, "**/parts/2") as hold:
            open_new_upload(page, name, data)
            cancel = page.get_by_role("button", name=f"Cancel {name}")
            shows(page, cancel)
            uid = poll(lambda: one(u for u in status_of(mar.get("/api/uploads"), 200)["uploads"]
                                   if u["name"] == name)["id"], UI_DEADLINE_S)
            uploads_listed(page, mar)
            watch(page)
            click(cancel)
            hold.release()
        announced_once(page, f"Cancelled upload of {name}")
    poll(lambda: status_of(mar.get(f"/api/uploads/{uid}"), 404, "not_found"), UI_DEADLINE_S)
    status_of(mar.get(f"/api/files/{uid}"), 404, "not_found")
    assert S3().keys(f"files/{uid}") == [] and count_of(mar, sub["A"]["id"]) == 0


def test_wf_move_cut_paste_drag(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    project, sub = make_project(mar, "A", "B", "C")
    a, b, c = (sub[k]["id"] for k in "ABC")
    free = [upload_pdf(mar, a, f"Free{i}") for i in range(1, 4)]
    locked = upload_pdf(mar, a, "Locked")
    lock(ines, locked["id"])
    copy = moved_copy(3, sub["B"]["name"], 1)
    with signed_in(browser, base, DEV, f"/drive?folder={a}") as watcher:
        reveal(watcher, project["name"])
        shows(watcher, row(watcher, free[0]["name"]))
        watch(watcher)
        with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
            reveal(page, project["name"])
            click(row(page, free[0]["name"]))
            page.keyboard.press("Control+a")
            watch(page)
            page.keyboard.press("Control+x")
            announced_once(page, "4 files cut")
            click(node(page, sub["B"]["name"]))
            node(page, sub["B"]["name"]).focus()
            page.keyboard.press("Control+v")
            announced_once(page, copy)
            for f in free:
                gone(watcher, row(watcher, f["name"]), PUSH_S + SLACK_S)
            shows(watcher, row(watcher, locked["name"]))
            page.goto(f"{base}/drive?folder={b}")
            reveal(page, project["name"])
            row(page, free[0]["name"]).drag_to(node(page, sub["C"]["name"]))
            eventually(page, lambda: _assert(file_of(mar, free[0]["id"])["folderId"] == c))
            click(row(page, free[1]["name"]))
            dialog = open_move_dialog(page)
            choose_in_tree(page, dialog.get_by_role("tree", name="Destination folders"), project["name"],
                           sub["C"]["name"])
            click(dialog.get_by_role("button", name="Move here"))
            eventually(page, lambda: _assert(file_of(mar, free[1]["id"])["folderId"] == c))
        described(watcher, node(watcher, sub["C"]["name"]), files_word(2), PUSH_S + SLACK_S)
        assert announced(watcher, copy) == 0
    assert [file_of(mar, f["id"])["folderId"] for f in free] == [c, c, b]
    assert file_of(mar, locked["id"])["folderId"] == a
    assert (count_of(mar, a), count_of(mar, b), count_of(mar, c)) == (1, 1, 2)


def test_wf_move_conflict(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B", "C")
    a, c = sub["A"]["id"], sub["C"]["id"]
    f = upload_pdf(mar, a, "Wind load")
    lost = f"{f['name']} was already moved to {sub['C']['name']} by Dev Halvorsen"
    won = moved_copy(1, sub["C"]["name"])
    with signed_in(browser, base, DEV, f"/drive?folder={a}") as rival:
        reveal(rival, project["name"])
        shows(rival, row(rival, f["name"]))
        with signed_in(browser, base, MARISOL, f"/drive?folder={a}") as page:
            gate = EventGate(page)
            reveal(page, project["name"])
            target = row(page, f["name"])
            click(target)
            start = target.bounding_box()
            dialog = open_move_dialog(page)
            choose_in_tree(page, dialog.get_by_role("tree", name="Destination folders"), project["name"],
                           sub["B"]["name"])
            watch(page)
            gate.close()
            with held(page, "**/api/moves") as hold:
                click(dialog.get_by_role("button", name="Move here"))
                click(row(rival, f["name"]))
                rival.keyboard.press("Control+x")
                click(node(rival, sub["C"]["name"]))
                node(rival, sub["C"]["name"]).focus()
                watch(rival)
                rival.keyboard.press("Control+v")
                announced_once(rival, won)
                poll(lambda: _assert(file_of(mar, f["id"])["folderId"] == c), UI_DEADLINE_S)
                hold.release()
            path = flight(page, chip(page, f["id"]), CHIP_FLIGHT_MAX_MS)
            assert_flight(path, start, node(page, sub["C"]["name"]).bounding_box())
            gate.open()
            announced_once(page, f"No files moved. {lost}")
            has_text(page, notices(page), lost)
            gone(page, target)
            for screen in (page, rival):
                for label, n in (("A", 0), ("B", 0), ("C", 1)):
                    described(screen, node(screen, sub[label]["name"]), files_word(n), PUSH_S + SLACK_S)
            advance(rival, SETTLE_MS)
            assert announced(rival, won) == 1
            assert announced(rival, "No files moved") == 0 and announced(rival, "was already moved") == 0
    assert file_of(mar, f["id"])["folderId"] == c
    assert (count_of(mar, a), count_of(mar, sub["B"]["id"]), count_of(mar, c)) == (0, 0, 1)


def test_wf_move_failure(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B")
    f = upload_pdf(mar, sub["A"]["id"], "Fail")
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}") as page:
        page.route("**/api/moves", lambda route: route.abort())
        click(row(page, f["name"]))
        dialog = open_move_dialog(page)
        choose_in_tree(page, dialog.get_by_role("tree", name="Destination folders"), project["name"], sub["B"]["name"])
        watch(page)
        click(dialog.get_by_role("button", name="Move here"))
        announced_once(page, "Move failed. Nothing was moved.")
        target = row(page, f["name"])
        shows(page, target)
        eventually(page, lambda: expect(target).not_to_have_attribute("aria-busy", "true", timeout=POLL_MS))
    assert file_of(mar, f["id"])["folderId"] == sub["A"]["id"]


def test_wf_lock_issue_set(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "Issued", "Reports")
    issued = sub["Issued"]["id"]
    ifc, trans = upload_pdf(mar, issued, "IFC Set"), upload_pdf(mar, issued, "Transmittal")
    with signed_in(browser, base, MARISOL, f"/drive?folder={issued}") as page:
        shows(page, row(page, ifc["name"]))
        with signed_in(browser, base, INES, f"/drive?folder={issued}") as ctrl:
            click(row(ctrl, ifc["name"]))
            watch(ctrl)
            click(toolbar(ctrl).get_by_role("button", name="Lock", exact=True))
            announced_once(ctrl, "Locked 1 file")
        has_text(page, row(page, ifc["name"]), "Locked", PUSH_S + SLACK_S)
        click(row(page, ifc["name"]))
        watch(page)
        page.keyboard.press("Control+a")
        announced_once(page, "2 selected")
        dialog = open_move_dialog(page)
        choose_in_tree(page, dialog.get_by_role("tree", name="Destination folders"), project["name"],
                       sub["Reports"]["name"])
        page.keyboard.press("Enter")
        announced_once(page, moved_copy(1, sub["Reports"]["name"], 1))
        has_text(page, row(page, ifc["name"]), "Stayed")
        gone(page, row(page, trans["name"]))
        click(row(page, ifc["name"]))
        dialog = open_move_dialog(page)
        choose_in_tree(page, dialog.get_by_role("tree", name="Destination folders"), project["name"],
                       sub["Reports"]["name"])
        click(dialog.get_by_role("button", name="Move here"))
        announced_once(page, moved_copy(0, sub["Reports"]["name"], 1))
        has_text(page, row(page, ifc["name"]), "Stayed")
    assert file_of(mar, ifc["id"])["locked"] is True and file_of(mar, ifc["id"])["folderId"] == issued
    assert file_of(mar, trans["id"])["folderId"] == sub["Reports"]["id"]


def test_wf_lock_unlock_live(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar, ines = Api(base, MARISOL), Api(base, INES)
    _, sub = make_project(mar, "A")
    f = upload_pdf(mar, sub["A"]["id"], "Unlock")
    lock(ines, f["id"])
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}") as page:
        has_text(page, row(page, f["name"]), "Locked")
        with signed_in(browser, base, INES, f"/drive?folder={sub['A']['id']}") as ctrl:
            click(row(ctrl, f["name"]))
            watch(ctrl)
            click(toolbar(ctrl).get_by_role("button", name="Unlock"))
            announced_once(ctrl, "Unlocked 1 file")
        lacks_text(page, row(page, f["name"]), "Locked", PUSH_S + SLACK_S)
        click(row(page, f["name"]))
        page.keyboard.press("F2")
        dialog = page.get_by_role("dialog", name="Rename")
        shows(page, dialog)
        fill(dialog.get_by_role("textbox", name="Name", exact=True), f"Renamed {tok()}.pdf")
        lock(ines, f["id"])
        behind = page.get_by_role("listbox", name="Files", include_hidden=True).get_by_role(
            "option", name=f["name"], exact=True, include_hidden=True)
        has_text(page, behind, "Locked", PUSH_S + SLACK_S)
        watch(page)
        click(dialog.get_by_role("button", name="Save"))
        announced_once(page, f"{f['name']} is locked and was not renamed.")
    after = file_of(mar, f["id"])
    assert after["locked"] is True and after["name"] == f["name"]


def test_wf_share_dialog(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "Site")
    folder = sub["Site"]
    end = (today_of(base) + timedelta(days=10)).isoformat()
    duplicate = f"Aiko Brandt already has access to {folder['name']}. Change it in the list below."

    def pick_aiko(p: Page) -> Locator:
        click(row(p, folder["name"]))
        click(toolbar(p).get_by_role("button", name="Share"))
        dialog = p.get_by_role("dialog", name=f"Share {folder['name']}")
        person = dialog.get_by_role("combobox", name="Person", exact=True)
        focused(p, person)
        p.keyboard.type("Aiko")
        advance(p, PICKER_PAUSE_MS)
        option = dialog.get_by_role("listbox", name="People").get_by_role(
            "option", name=re.compile(r"^Aiko Brandt — Mesquite Row Architects"))
        shows(p, option)
        expect(option).to_contain_text("Partner")
        p.keyboard.press("ArrowDown")
        p.keyboard.press("Enter")
        return dialog

    with signed_in(browser, base, AIKO, "/shared") as partner:
        shows(partner, partner.get_by_role("searchbox", name="Search files"))
        expect(row(partner, folder["name"])).to_have_count(0)
        with signed_in(browser, base, INES, f"/drive?folder={project['id']}") as rival:
            rival_dialog = pick_aiko(rival)
            with signed_in(browser, base, MARISOL, f"/drive?folder={project['id']}") as page:
                dialog = pick_aiko(page)
                check(dialog.get_by_role("radio", name="Editor"))
                fill(dialog.get_by_label("Access ends"), end)
                watch(page)
                click(dialog.get_by_role("button", name="Share"))
                announced_once(page, f"Shared {folder['name']} with Aiko Brandt until {end}")
                entry = dialog.get_by_role("list", name="People with access").get_by_role("listitem").filter(
                    has_text="Aiko Brandt")
                has_text(page, entry, f"Ends {end}")
            g = one(status_of(mar.get("/api/grants", itemType="folder", itemId=folder["id"]), 200)["grants"])
            rival_entries = rival_dialog.get_by_role("list", name="People with access").get_by_role(
                "listitem").filter(has_text="Aiko Brandt")
            has_text(rival, rival_entries, f"Ends {end}", PUSH_S + SLACK_S)
            has_text(partner, row(partner, folder["name"]), f"Ends {end} · {grant_days(g['daysLeft'])}",
                     PUSH_S + SLACK_S)
            check(rival_dialog.get_by_role("radio", name="Viewer"))
            watch(rival)
            click(rival_dialog.get_by_role("button", name="Share"))
            announced_once(rival, duplicate)
            expect(rival_entries).to_have_count(1)
    g = one(status_of(mar.get("/api/grants", itemType="folder", itemId=folder["id"]), 200)["grants"])
    assert (g["person"]["name"], g["role"], g["endDate"]) == ("Aiko Brandt", "editor", end)


def test_wf_share_duplicate_recovery(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "Site")
    folder = sub["Site"]
    give(mar, "folder", folder["id"], AIKO, "viewer")
    with signed_in(browser, base, INES, f"/drive?folder={project['id']}") as page:
        click(row(page, folder["name"]))
        click(toolbar(page).get_by_role("button", name="Share"))
        dialog = page.get_by_role("dialog", name=f"Share {folder['name']}")
        focused(page, dialog.get_by_role("combobox", name="Person", exact=True))
        page.keyboard.type("Aiko")
        advance(page, PICKER_PAUSE_MS)
        shows(page, dialog.get_by_role("option", name=re.compile(r"^Aiko Brandt")))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        check(dialog.get_by_role("radio", name="Viewer"))
        watch(page)
        click(dialog.get_by_role("button", name="Share"))
        duplicate = f"Aiko Brandt already has access to {folder['name']}. Change it in the list below."
        announced_once(page, duplicate)
        select(dialog.get_by_role("combobox", name=f"Access for {NAMES[AIKO]}"), "Editor")
        announced_once(page, f"Aiko Brandt is now editor on {folder['name']}")
    g = one(status_of(mar.get("/api/grants", itemType="folder", itemId=folder["id"]), 200)["grants"])
    assert g["role"] == "editor"


def test_wf_grant_expiry_notice(browser: Browser, app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    mar = Api(clock, MARISOL)
    _, sub = make_project(mar, "Rep")
    rep = sub["Rep"]
    f = upload(mar, rep["id"], f"Survey {tok()}.png", png_bytes(9), PNG)
    end = today + timedelta(days=1)
    give(mar, "folder", rep["id"], ROSA, "editor", end)
    with signed_in(browser, clock, ROSA, f"/drive?folder={rep['id']}") as page:
        page.clock.set_system_time(phx(end + timedelta(days=DEVICE_SKEW_DAYS), 12))
        page.reload()
        target = row(page, f["name"])
        shows(page, target)
        click(target)
        page.keyboard.press("Enter")
        preview = page.get_by_role("region", name="Preview")
        shows(page, preview)
        advance(page, SETTLE_MS)
        expect(target).to_be_visible()
        watch(page)
        set_clock(clock, phx(end + timedelta(days=1), 0, 0, 5))
        notice = f"Your access to {rep['name']} ended at the end of {end.isoformat()}, Phoenix time."
        has_text(page, notices(page), notice, EXPIRY_PUSH_S + SLACK_S)
        gone(page, target, EXPIRY_PUSH_S + SLACK_S)
        preview_closed(page, preview, f["name"], EXPIRY_PUSH_S + SLACK_S)
        announced_once(page, notice)
        watch_from_load(page)
        page.reload()
        shows_on_screen(page, UNAVAILABLE_FOLDER)
        unheard(page, notice)
    status_of(Api(clock, ROSA).get(f"/api/folders/{rep['id']}"), 404, "not_found")


def test_wf_grant_expiry_editor_fallback(browser: Browser, app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    mar = Api(clock, MARISOL)
    project, sub = make_project(mar, "Calc")
    calc = sub["Calc"]
    f = upload_pdf(mar, calc["id"], "Wind")
    end = today + timedelta(days=1)
    give(mar, "folder", project["id"], CALLUM, "viewer", today + timedelta(days=SEED_CALLUM_VIEWER_DAYS))
    give(mar, "folder", calc["id"], CALLUM, "editor", end)
    with signed_in(browser, clock, CALLUM, f"/drive?folder={calc['id']}") as page:
        click(row(page, f["name"]))
        rename = toolbar(page).get_by_role("button", name="Rename")
        shows(page, rename)
        set_clock(clock, phx(end + timedelta(days=1), 0, 0, 5))
        notice = (f"Your editor access to {calc['name']} ended at the end of {end.isoformat()}, Phoenix time. "
                  "You can still view it.")
        has_text(page, notices(page), notice, EXPIRY_PUSH_S + SLACK_S)
        gone(page, rename, EXPIRY_PUSH_S + SLACK_S)
        expect(row(page, f["name"])).to_be_visible()
    assert file_of(Api(clock, CALLUM), f["id"])["access"] == "viewer"


def test_wf_permission_change_downgrade(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "Draw")
    folder = sub["Draw"]
    f = upload_pdf(mar, folder["id"], "S-202")
    give(mar, "folder", folder["id"], AIKO, "editor")
    with signed_in(browser, base, AIKO, f"/drive?folder={folder['id']}") as partner:
        click(row(partner, f["name"]))
        rename = toolbar(partner).get_by_role("button", name="Rename")
        shows(partner, rename)
        with signed_in(browser, base, INES, f"/drive?folder={project['id']}") as ctrl:
            click(row(ctrl, folder["name"]))
            click(toolbar(ctrl).get_by_role("button", name="Share"))
            dialog = ctrl.get_by_role("dialog", name=f"Share {folder['name']}")
            tabs_stay_inside(ctrl, dialog)
            watch(ctrl)
            select(dialog.get_by_role("combobox", name=f"Access for {NAMES[AIKO]}"), "Viewer")
            announced_once(ctrl, f"Aiko Brandt is now viewer on {folder['name']}")
        gone(partner, rename, PUSH_S + SLACK_S)
        has_text(partner, notices(partner), f"Your access to {folder['name']} is now view only.")
    status_of(Api(base, AIKO).patch(f"/api/files/{f['id']}", {"name": f"x {tok()}.pdf"}), 403, "forbidden")


def test_wf_permission_change_removal(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "Draw")
    folder = sub["Draw"]
    f = upload_pdf(mar, folder["id"], "S-501")
    give(mar, "folder", folder["id"], AIKO, "editor")
    with signed_in(browser, base, AIKO, f"/drive?folder={folder['id']}") as partner:
        shows(partner, row(partner, f["name"]))
        with signed_in(browser, base, INES, f"/drive?folder={project['id']}") as ctrl:
            click(row(ctrl, folder["name"]))
            click(toolbar(ctrl).get_by_role("button", name="Share"))
            dialog = ctrl.get_by_role("dialog", name=f"Share {folder['name']}")
            watch(ctrl)
            click(dialog.get_by_role("button", name=f"Remove {NAMES[AIKO]}"))
            announced_once(ctrl, f"Removed Aiko Brandt from {folder['name']}")
        gone(partner, row(partner, f["name"]), PUSH_S + SLACK_S)
        has_text(partner, notices(partner), f"Your access to {folder['name']} has been removed.")
    status_of(Api(base, AIKO).get(f"/api/files/{f['id']}"), 404, "not_found")


def test_wf_bin_restore(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "Photos")
    folder = sub["Photos"]
    f = upload_pdf(mar, folder["id"], "Old photo")
    with signed_in(browser, base, MARISOL, f"/drive?folder={folder['id']}") as page:
        click(row(page, f["name"]))
        watch(page)
        page.keyboard.press("Delete")
        announced_once(page, "Moved 1 file to the bin")
        gone(page, row(page, f["name"]))
        item = poll(lambda: _not_none(bin_item(mar, f["id"])), UI_DEADLINE_S)
        page.goto(base + "/bin")
        table = page.get_by_role("table", name="Binned files")
        line = table.get_by_role("row").filter(has_text=f["name"])
        has_text(page, line, f"{bin_days(item['daysLeft'])} · {item['retentionDays']}-day rule")
        expect(line).to_contain_text(folder["name"])
        watch(page)
        click(table.get_by_role("button", name=f"Restore {f['name']}"))
        announced_once(page, f"Restored {f['name']} to {folder['name']}")
    assert file_of(mar, f["id"])["folderId"] == folder["id"] and bin_item(mar, f["id"]) is None

    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    cmar, cdev = Api(clock, MARISOL), Api(clock, DEV)
    _, csub = make_project(cmar, "Aging")
    aging = upload_pdf(cmar, csub["Aging"]["id"], "Aging", 2500)
    status_of(cmar.post("/api/bin", {"fileIds": [aging["id"]]}), 200)
    item = bin_item(cmar, aging["id"])
    rule, purge = item["retentionDays"], date.fromisoformat(item["purgeDate"])
    assert item["daysLeft"] == rule
    with signed_in(browser, clock, DEV, "/drive", cookie=cdev.cookie) as watcher:
        eventually(watcher, lambda: _assert(meter_value(watcher)[0] == storage(cdev)["usedBytes"]))
        with signed_in(browser, clock, MARISOL, "/bin", cookie=cmar.cookie) as page:
            page.clock.set_system_time(phx(today + timedelta(days=DEVICE_SKEW_DAYS), 12))
            page.reload()
            line = page.get_by_role("table", name="Binned files").get_by_role("row").filter(has_text=aging["name"])
            has_text(page, line, f"{bin_days(rule)} · {rule}-day rule")
            set_clock(clock, phx(today + timedelta(days=1), 0, 0, 10))
            has_text(page, line, f"{bin_days(rule - 1)} · {rule}-day rule", EXPIRY_PUSH_S + SLACK_S)
            before = storage(cdev)["usedBytes"]
            set_clock(clock, phx(purge, 0, 0, 5))
            gone(page, line, EXPIRY_PUSH_S + SLACK_S)
        after = storage(cdev)["usedBytes"]
        assert after <= before - aging["size"]
        eventually(watcher, lambda: _assert(meter_value(watcher)[0] == after), EXPIRY_PUSH_S + SLACK_S)
    assert bin_item(cmar, aging["id"]) is None


def _not_none(value: Any) -> Any:
    assert value is not None
    return value


def test_wf_bin_delete_forever(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "A")
    f = upload_pdf(mar, sub["A"]["id"], "Gone", 3333)
    status_of(mar.post("/api/bin", {"fileIds": [f["id"]]}), 200)
    with signed_in(browser, base, MARISOL, "/drive") as watcher:
        eventually(watcher, lambda: _assert(meter_value(watcher)[0] == storage(mar)["usedBytes"]))
        before = meter_value(watcher)[0]
        with signed_in(browser, base, INES, "/bin") as page:
            table = page.get_by_role("table", name="Binned files")
            click(table.get_by_role("button", name=f"Delete {f['name']} forever"))
            confirm = page.get_by_role("alertdialog", name="Delete forever?")
            has_text(page, confirm, f"{f['name']} will be removed for good.")
            tabs_stay_inside(page, confirm)
            watch(page)
            click(confirm.get_by_role("button", name="Delete forever"))
            announced_once(page, f"Deleted {f['name']} forever")
        eventually(watcher, lambda: _assert(meter_value(watcher)[0] == before - f["size"]), PUSH_S + SLACK_S)
    assert S3().keys(f"files/{f['id']}") == [] and bin_item(mar, f["id"]) is None


def test_wf_policy_schedule_shorter_bin(browser: Browser, app_url: str) -> None:
    clock = env_url(CLOCK_ENV)
    today = fresh_day(clock)
    tomas, mar = Api(clock, TOMAS), Api(clock, MARISOL)
    old = in_force(tomas, "bin_retention_days")
    new = SHORT_RETENTION_DAYS if old != SHORT_RETENTION_DAYS else SHORT_RETENTION_DAYS - 1
    eff = (today + timedelta(days=1)).isoformat()
    later = (today + timedelta(days=2)).isoformat()
    _, sub = make_project(mar, "A")
    early, late = upload_pdf(mar, sub["A"]["id"], "Early"), upload_pdf(mar, sub["A"]["id"], "Late")
    with signed_in(browser, clock, TOMAS, "/settings") as page:
        form = page.get_by_role("form", name="Bin retention")
        shows(page, form)
        watch(page)
        fill(form.get_by_role("spinbutton", name="Days"), str(new))
        fill(form.get_by_label("Effective from"), eff)
        click(form.get_by_role("button", name="Schedule bin retention"))
        announced_once(page, f"Bin retention changes to {new} days from {eff}")
        schedule = page.get_by_role("table", name="Policy schedule")
        line = schedule.get_by_role("row").filter(has_text=eff)
        has_text(page, line, "Scheduled")
        fill(form.get_by_role("spinbutton", name="Days"), str(old))
        fill(form.get_by_label("Effective from"), later)
        click(form.get_by_role("button", name="Schedule bin retention"))
        announced_once(page, f"Bin retention changes to {old} days from {later}")
        with signed_in(browser, clock, TOMAS, "/settings") as other:
            other_line = other.get_by_role("table", name="Policy schedule").get_by_role("row").filter(has_text=later)
            has_text(other, other_line, "Scheduled")
            click(schedule.get_by_role("button", name=f"Withdraw bin retention from {later}"))
            announced_once(page, f"Withdrew the change from {later}")
            gone(other, other_line, PUSH_S + SLACK_S)
        with signed_in(browser, clock, TOMAS, "/settings", cookie=tomas.cookie) as stale:
            EventGate(stale, closed=True)
            stale_schedule = stale.get_by_role("table", name="Policy schedule")
            withdraw = stale_schedule.get_by_role("button", name=f"Withdraw bin retention from {eff}")
            shows(stale, withdraw)
            pol = one(p for p in status_of(tomas.get("/api/policies"), 200)["policies"]
                      if p["kind"] == "bin_retention_days" and p["effectiveFrom"] == eff)
            assert pol["days"] == new and pol["state"] == "scheduled"
            status_of(mar.post("/api/bin", {"fileIds": [early["id"]]}), 200)
            set_clock(clock, phx(date.fromisoformat(eff), 0, 0, 10))
            watch(stale)
            click(withdraw)
            announced_once(stale, "This change has already started.")
            shows(stale, stale_schedule.get_by_role("row").filter(has_text=eff))
    assert all(p["effectiveFrom"] != later for p in status_of(tomas.get("/api/policies"), 200)["policies"]
               if p["kind"] == "bin_retention_days")
    status_of(mar.post("/api/bin", {"fileIds": [late["id"]]}), 200)
    items = {f["id"]: bin_item(mar, f["id"]) for f in (early, late)}
    assert items[early["id"]]["retentionDays"] == old and items[late["id"]]["retentionDays"] == new
    with signed_in(browser, clock, TOMAS, "/bin") as page:
        page.clock.set_system_time(phx(date.fromisoformat(eff) + timedelta(days=DEVICE_SKEW_DAYS * 10), 12))
        page.reload()
        table = page.get_by_role("table", name="Binned files")
        for f in (early, late):
            item = items[f["id"]]
            has_text(page, table.get_by_role("row").filter(has_text=f["name"]),
                     f"{bin_days(item['daysLeft'])} · {item['retentionDays']}-day rule")
    assert one(p for p in status_of(tomas.get("/api/policies"), 200)["policies"]
               if p["id"] == pol["id"])["state"] == "in_force"


def test_wf_policy_invalid_then_withdraw(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    tomas = Api(base, TOMAS)
    today = today_of(base)
    eff = (today + timedelta(days=400 + int(tok()[-3:], 36) % 2000)).isoformat()
    with signed_in(browser, base, TOMAS, "/settings") as page:
        form = page.get_by_role("form", name="Bin retention")
        shows(page, form)
        days = form.get_by_role("spinbutton", name="Days")
        fill(days, str(BIN_MAX_DAYS + 1))
        fill(form.get_by_label("Effective from"), today.isoformat())
        click(form.get_by_role("button", name="Schedule bin retention"))
        has_text(page, form, BIN_DAYS_RANGE)
        has_text(page, form, DATE_AFTER_TODAY)
        focused(page, days)
        fill(days, str(SHORT_RETENTION_DAYS))
        fill(form.get_by_label("Effective from"), eff)
        watch(page)
        click(form.get_by_role("button", name="Schedule bin retention"))
        announced_once(page, f"Bin retention changes to {SHORT_RETENTION_DAYS} days from {eff}")
        click(page.get_by_role("table", name="Policy schedule").get_by_role("button",
                                                                           name=f"Withdraw bin retention from {eff}"))
        announced_once(page, f"Withdrew the change from {eff}")
    assert all(not (p["kind"] == "bin_retention_days" and p["effectiveFrom"] == eff)
               for p in status_of(tomas.get("/api/policies"), 200)["policies"])


def test_wf_handover_accept(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project = create_folder(mar, f"P{tok()} Project")
    lapse = (today_of(base) + timedelta(days=HANDOVER_DIALOG_DAYS)).isoformat()
    with signed_in(browser, base, MARISOL, "/drive") as page:
        click(row(page, project["name"]))
        details = page.get_by_role("complementary", name="Details")
        click(details.get_by_role("button", name="Hand over"))
        dialog = page.get_by_role("dialog", name=f"Hand over {project['name']}")
        focused(page, dialog.get_by_role("combobox", name="New owner"))
        page.keyboard.type("Dev")
        advance(page, PICKER_PAUSE_MS)
        shows(page, dialog.get_by_role("option", name=re.compile(r"^Dev Halvorsen — Lintelworks")))
        page.keyboard.press("ArrowDown")
        page.keyboard.press("Enter")
        fill(dialog.get_by_role("spinbutton", name="Days to accept"), str(HANDOVER_DIALOG_DAYS))
        watch(page)
        click(dialog.get_by_role("button", name="Offer"))
        announced_once(page, f"Offered {project['name']} to Dev Halvorsen until {lapse}")
        with signed_in(browser, base, DEV, "/handovers") as other:
            table = other.get_by_role("table", name="Handovers")
            has_text(other, table.get_by_role("row").filter(has_text=project["name"]), f"Open until {lapse}")
            watch(other)
            click(table.get_by_role("button", name=f"Accept {project['name']}"))
            announced_once(other, f"You now own {project['name']}")
        has_text(page, notices(page), f"Dev Halvorsen accepted {project['name']}.", PUSH_S + SLACK_S)
        has_text(page, details, "Dev Halvorsen", PUSH_S + SLACK_S)
    assert status_of(mar.get(f"/api/folders/{project['id']}"), 200)["folder"]["owner"]["name"] == "Dev Halvorsen"


def test_wf_handover_decline(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project = create_folder(mar, f"P{tok()} Project")
    status_of(mar.post("/api/handovers", {"folderId": project["id"], "toPersonId": person_id(mar, DEV),
                                          "days": HANDOVER_DIALOG_DAYS}), 201)
    with signed_in(browser, base, MARISOL, "/handovers") as page:
        shows(page, page.get_by_role("table", name="Handovers"))
        with signed_in(browser, base, DEV, "/handovers") as other:
            watch(other)
            click(other.get_by_role("table", name="Handovers").get_by_role("button", name=f"Decline {project['name']}"))
            announced_once(other, f"Declined {project['name']}")
        has_text(page, notices(page), f"Dev Halvorsen declined {project['name']}.", PUSH_S + SLACK_S)
    h = one(x for x in status_of(mar.get("/api/handovers"), 200)["handovers"] if x["folder"]["id"] == project["id"])
    assert h["status"] == "declined"
    assert status_of(mar.get(f"/api/folders/{project['id']}"), 200)["folder"]["owner"]["name"] == "Marisol Okafor"


def test_wf_mobile_partner_download(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    _, sub = make_project(mar, "Draw", "Hid")
    folder, hid = sub["Draw"], sub["Hid"]
    f = upload_pdf(mar, folder["id"], "S-101")
    give(mar, "folder", folder["id"], AIKO, "viewer")
    with signed_in(browser, base, AIKO, "/shared", viewport=VIEWPORTS["phone"]) as page:
        click(page.get_by_role("button", name="Open navigation"))
        drawer = page.get_by_role("dialog", name="Navigation")
        shows(page, drawer)
        settle(drawer)
        click(drawer.get_by_role("treeitem", name=folder["name"], exact=True))
        eventually(page, lambda: assert_offscreen(drawer))
        target = row(page, f["name"])
        shows(page, target)
        watch(page)
        long_press(page, target)
        announced_once(page, "1 selected")
        download = toolbar(page).get_by_role("button", name="Download")
        shows(page, download)
        box = download.bounding_box()
        assert box["width"] >= TOUCH_TARGET_PX and box["height"] >= TOUCH_TARGET_PX
        with page.expect_download() as got:
            click(download)
        assert Path(got.value.path()).read_bytes() == S3().get(f"files/{f['id']}")
        extra = upload_pdf(mar, folder["id"], "S-102")
        shows(page, row(page, extra["name"]), PUSH_S + SLACK_S)
        eventually(page, lambda: expect(target).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
        shows(page, toolbar(page))
        tap_stream = EventTap(Api(base, AIKO))
        try:
            assert tap_stream.status == 101
            watch(page)
            status_of(move(mar, hid["id"], [(f["id"], folder["id"])]), 200)
            gone(page, target, PUSH_S + SLACK_S)
            announced_once(page, "Selection cleared", PUSH_S + SLACK_S)
            left_view(page, toolbar(page))
            tap_stream.wait_for([f["id"], folder["id"]], PUSH_S + SLACK_S)
            text = "\n".join(tap_stream.lines)
            assert hid["name"] not in text and hid["id"] not in text, text
        finally:
            tap_stream.close()
        layout(page)
        tap(row(page, extra["name"]))
        shows(page, page.get_by_role("dialog", name="Details"))


def test_wf_mobile_reduced_motion(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    mar = Api(base, MARISOL)
    project, sub = make_project(mar, "A", "B")
    f = upload_pdf(mar, sub["A"]["id"], "Phone move")
    with signed_in(browser, base, MARISOL, f"/drive?folder={sub['A']['id']}", viewport=VIEWPORTS["phone"],
                   reduced_motion="reduce") as page:
        target = row(page, f["name"])
        shows(page, target)
        long_press(page, target)
        eventually(page, lambda: expect(target).to_have_attribute("aria-selected", "true", timeout=POLL_MS))
        dialog = open_move_dialog(page)
        choose_in_tree(page, dialog.get_by_role("tree", name="Destination folders"), project["name"], sub["B"]["name"])
        click(dialog.get_by_role("button", name="Move here"))
        gone(page, target)
        path = page.get_by_role("navigation", name="Folder path")
        has_text(page, path, "+1")
        assert moving(path) == [] and moving(files_list(page)) == []
        layout(page)
    assert file_of(mar, f["id"])["folderId"] == sub["B"]["id"]


ALLOWED_LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}


def shipped_packages() -> list[dict[str, Any]]:
    root = DEPLOYED_APP if (DEPLOYED_APP / "node_modules").is_dir() else APP_DIR
    return [{"name": p.name, "version": p.version, "license": p.licence or None} for p in kit_shipped_packages(root)]


def licence_ok(expr: str | None) -> bool:
    if not expr:
        return False
    text = expr.replace("(", "").replace(")", "").strip()
    if " OR " in text:
        return any(licence_ok(p) for p in text.split(" OR "))
    if " AND " in text:
        return all(licence_ok(p) for p in text.split(" AND "))
    return text in ALLOWED_LICENCES


def test_if_run_manifest() -> None:
    data = json.loads((APP_DIR / "run.json").read_text())
    assert data["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(data[key], str) and data[key].strip(), key


def test_if_third_party_notices() -> None:
    text = (APP_DIR / "THIRD_PARTY_NOTICES.md").read_text()
    assert "IBM Plex" in text and "Lucide" in text
    missing = [f"{p['name']}@{p['version']}" for p in shipped_packages()
               if p["name"] not in text or p["version"] not in text]
    assert not missing, missing


def test_if_licences_allowed() -> None:
    bad = [(p["name"], p["license"]) for p in shipped_packages() if not licence_ok(p["license"])]
    assert not bad, bad


def test_if_only_three_datastores() -> None:
    banned = [word.lower() for word in ("SQLite", "Redis")]
    names = [p["name"].lower() for p in shipped_packages()]
    assert not [n for n in names if any(word in n for word in banned)], names
    stray = [p for p in APP_DIR.rglob("*")
             if "node_modules" not in p.parts and p.is_file() and banned[0] in p.suffix.lower()]
    assert not stray, stray
    assert Postgres().tables()


def test_if_same_origin_assets(browser: Browser, app_url: str) -> None:
    base = app_url.rstrip("/")
    seen: list[str] = []
    with signed_in(browser, base, MARISOL, "/drive") as page:
        page.on("request", lambda req: seen.append(req.url))
        page.reload()
        shows(page, node(page, SAGUARO))
    foreign = [u for u in seen if not u.startswith(("data:", "blob:")) and not same_origin(u, base)]
    assert seen and not foreign, foreign


def test_if_services_unchanged() -> None:
    assert Postgres().tables()
    assert S3().keys("files/")
    assert "users" in PocketBase().collections()


JS_SUFFIXES = {".js", ".jsx", ".mjs", ".cjs"}
TOOLING_DIRS = {"scripts", "tools", "bin"}
TS_SUFFIXES = {".ts", ".tsx", ".mts", ".cts"}
OUTPUT_DIR_NAMES = {"node_modules", "dist", "build", "out", "public", "coverage"}


def output_dirs() -> list[Path]:
    found: list[Path] = []
    for cfg in APP_DIR.rglob("tsconfig*.json"):
        if "node_modules" in cfg.parts:
            continue
        for out_dir in re.findall(r'"outDir"\s*:\s*"([^"]+)"', cfg.read_text(errors="ignore")):
            found.append((cfg.parent / out_dir).resolve())
    ignore = APP_DIR / ".gitignore"
    if ignore.exists():
        for line in ignore.read_text(errors="ignore").splitlines():
            entry = line.strip().strip("/")
            if entry and not entry.startswith(("#", "!")) and "*" not in entry:
                found.append((APP_DIR / entry).resolve())
    return found


def candidate_files() -> list[Path]:
    if (APP_DIR / ".git").exists():
        out = subprocess.run(["git", "ls-files", "-co", "--exclude-standard"], cwd=APP_DIR,
                             capture_output=True, text=True, timeout=NPM_TIMEOUT_S)
        if out.returncode == 0:
            return [APP_DIR / line for line in out.stdout.splitlines() if (APP_DIR / line).is_file()]
    return [p for p in APP_DIR.rglob("*") if p.is_file()]


def is_build_output(p: Path, outs: list[Path]) -> bool:
    rel = p.relative_to(APP_DIR)
    if any(part in OUTPUT_DIR_NAMES or part.startswith(".") for part in rel.parts[:-1]):
        return True
    resolved = p.resolve()
    if any(resolved == d or d in resolved.parents for d in outs):
        return True
    if p.with_name(p.name + ".map").exists():
        return True
    return p.suffix in JS_SUFFIXES and any(p.with_suffix(s).exists() for s in TS_SUFFIXES)


def test_if_typescript_source() -> None:
    outs = output_dirs()
    files = [p for p in candidate_files() if not is_build_output(p, outs)]
    assert any(p.suffix in TS_SUFFIXES for p in files)
    js = [p for p in files if p.suffix in JS_SUFFIXES and ".config." not in p.name
          and len(p.relative_to(APP_DIR).parts) > 1
          and p.relative_to(APP_DIR).parts[0] not in TOOLING_DIRS]
    assert not js, js
