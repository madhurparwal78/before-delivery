from __future__ import annotations

import hashlib
import json
import os
import re
import threading
import time
from collections.abc import Callable, Iterator
from concurrent.futures import ThreadPoolExecutor
from contextlib import contextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, Route, expect

from conftest import (
    S3,
    Mailpit,
    Postgres,
    addresses,
    advance,
    animations,
    center,
    held,
    idempotency_key,
    layout,
    licence_allowed,
    mail_from_address,
    motion,
    open_app,
    same_origin,
    select,
    session,
    shipped_packages,
    tab_order,
    text,
    unique,
)


APP = Path("/app")
TRAJECTORY = Path("/logs/agent/trajectory.json")

PASSCODE = "stand-desk-26"
ROWAN = "rowan@quirewell.test"
PRIYA = "priya@quirewell.test"
TOMASZ = "tomasz@quirewell.test"
HESTER = "vn1-01@players.quirewell.test"
ODILE = "vn2-01@players.quirewell.test"
YUSRA = "vn2-03@players.quirewell.test"
SAOIRSE = "vn1-09@players.quirewell.test"
BRAM = "vn1-10@players.quirewell.test"
HARPIST = "hp@players.quirewell.test"
FLUTE_2 = "fl2@players.quirewell.test"
NAMES = {
    ROWAN: "Rowan Achterberg",
    PRIYA: "Priya Lindqvist",
    TOMASZ: "Tomasz Ebdon",
    HESTER: "Hester Quayle",
    YUSRA: "Yusra Penhaligon",
}

WEIR = "cw-the-weir"
FEN = "cw-fen-country-dances"
LANTERN = "cw-lantern-procession"
FERRY = "cw-ferry-at-dusk"
ORCHARD = "cw-orchard-serenade"
WEIR_TITLE = "The Weir"
FEN_TITLE = "Fen Country Dances"
LANTERN_TITLE = "Lantern Procession"
FERRY_TITLE = "Ferry at Dusk"
ORCHARD_TITLE = "Orchard Serenade"
SEED_P01 = "p01"
YUSRA_CHAIR = "Violin II · chair 03"
WEIR_SPAN = "120–184"
WEIR_SAVED = "4:28"
WEIR_CUT_FLAGS = 14
MARK_CUT = "Mark cut"
NOT_FILED = "Not filed"
REASON_TYPE = "only PDF, PNG or JPEG files can be filed"
REASON_EMPTY = "the file is empty"
REASON_UNFINISHED = "the upload did not finish"
COOKIE_FLAGS = ("HttpOnly", "SameSite=Lax", "Path=/")

SECTION_KEYS = {"vn1": "violin_1", "vn2": "violin_2", "va": "viola", "vc": "cello", "cb": "bass"}
SECTION_NAMES = {"vn1": "Violin I", "vn2": "Violin II", "va": "Viola", "vc": "Cello", "cb": "Bass"}
ROSTER = {"vn1": 10, "vn2": 8, "va": 6, "vc": 5, "cb": 4}
SEED_COUNT = {"violin_1": 8, "violin_2": 7, "viola": 6, "cello": 5, "bass": 4}
RAISED_COUNT = {"violin_1": 10, "violin_2": 8, "viola": 6, "cello": 5, "bass": 4}
P01_HOLDINGS = {"vn1": 5, "vn2": 4, "va": 3, "vc": 3, "cb": 2}
ORCHARD_SLIP = {"vn1": 5, "vn2": 4, "va": 3, "vc": 3, "cb": 2}
WEIR_BAR_MAP = [
    {"from_bar": 1, "to_bar": 119, "bar_ms": 2400},
    {"from_bar": 120, "to_bar": 184, "bar_ms": 4123},
    {"from_bar": 185, "to_bar": 300, "bar_ms": 2500},
]
WEIR_LETTERS = {"A": 25, "B": 61, "C": 97, "D": 133, "E": 169, "F": 205, "G": 241, "H": 277}
WEIR_PART_NAMES = {
    "Violin I", "Violin II", "Viola", "Cello", "Bass", "Flute 1", "Flute 2", "Oboe 1", "Oboe 2",
    "Clarinet 1", "Clarinet 2", "Bassoon 1", "Bassoon 2", "Horn 1", "Timpani", "Harp",
}
WEIR_CUT = (120, 184)
LANTERN_CUT = (97, 128)
FERRY_CUT_A = (31, 61)
FERRY_CUT_B = (121, 151)

BLOCKERS = {
    "illegal_transition": "Folders can only be published while the programme is in preparation.",
    "first_rehearsal_passed": "Folders can't be published after the first rehearsal has started.",
    "no_works": "Add a work before publishing folders.",
}
ONE_COPY_SHORT = "Folders can't be published while 1 copy is short."
STORE_BANNER = (
    "The score store is offline. Scans can't be uploaded or opened right now. "
    "Catalogue, counts and cuts still work."
)
MAIL_BANNER = "Mail is offline. Notices are queued and will be sent when it's back."
SCAN_UNAVAILABLE = (
    "This marked part can't be opened right now. Its cuts and rehearsal letters are shown below."
)
NO_SCAN = "No marked part has been filed yet."
NOT_IN_FOLDER = "That part isn't in your folder."
NO_FOLDERS = "No folders are published for your chair yet."
ACCENTED_NAME = 'Bögen – The Weir "v2".pdf'
ACCENTED_DISPOSITION = (
    "attachment; filename=\"B_gen _ The Weir _v2_.pdf\"; "
    "filename*=UTF-8''B%C3%B6gen%20%E2%80%93%20The%20Weir%20%22v2%22.pdf"
)
ACCENTED_PUBLISHER = "Éditions Côte-Rôtie Location"
DST_PERFORMANCE = "2026-10-24T23:30:00+00:00"
DST_DUE_DATE = "2026-11-08"
DST_DUE_AT = "2026-11-08T23:59:00+00:00"
DST_FINAL_DATE = "2026-10-25"
DST_DUE_LABEL = "Sun 8 Nov 2026"

SCAN_LIMIT = 20_000_000
JSON_LIMIT = 65_536
NAME_BYTE_LIMIT = 255
STATUS_CHECK_MS = 30_000
RENTALS_RELOAD_MS = 60_000
SPLICE_MAX_MS = 1_000
SETTLE_MS = 400
PHONE = (375, 812)
TABLET = (768, 1024)
LAPTOP = (1280, 800)
VIEWPORTS = {"1280x800": (1280, 800), "768x1024": (768, 1024), "375x812": (375, 812)}
SURFACE_VIEWPORTS = {"1280x800": (1280, 800), "375x812": (375, 812)}

HTTP_TIMEOUT_S = 120
MAIL_WAIT_S = 120
QUIET_WAIT_S = 8
SWEEP_WAIT_S = 45
STATUS_WAIT_S = 30
SAMPLE_MS = 50
SPLICE_WAIT_S = 30
COPIES_WAIT_S = 5
ADVANCE_WAIT_MS = 120_000
SWIPE_STEPS = 8
UNKNOWN_ID = "qw-unknown-0"
FOREIGN_ORIGIN = "http://elsewhere.invalid"
UNKNOWN_PATH = "/api/qw-no-such-endpoint"
CORS_HEADER = "access-control-allow-origin"
PERCENT_NAME = "a%41.pdf"
WRONG_PASSCODE = "not-the-passcode"
VALUE_TEXT = "aria-valuetext"
FOREIGN_ZONE = "Pacific/Kiritimati"
WRONG_FUTURE = datetime(2031, 6, 1, 3, 0, tzinfo=timezone.utc)
WRONG_PAST = datetime(2019, 2, 1, 3, 0, tzinfo=timezone.utc)
DST_FIRST_REHEARSAL = "2026-10-20T10:00:00+01:00"
CREDENTIAL_ENV = ("S3_SECRET_ACCESS_KEY", "S3_ACCESS_KEY_ID", "DATABASE_URL")
SERVED_NEVER = ("/run.json", "/package.json", "/package-lock.json", "/.env", "/node_modules/.package-lock.json")
LICENCES = {"MIT", "ISC", "BSD-2-Clause", "BSD-3-Clause", "Apache-2.0", "0BSD", "OFL-1.1"}
DATASTORE_PACKAGES = {
    "sqlite3", "better-sqlite3", "sql.js", "redis", "ioredis", "level", "leveldown", "classic-level",
    "lowdb", "nedb", "@seald-io/nedb", "@electric-sql/pglite", "lokijs", "pouchdb", "lmdb", "realm",
}

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
JPEG_SIGNATURE = b"\xff\xd8\xff\xe0"


def token() -> str:
    return unique("qw")[0]


def signin(base: str, email: str) -> httpx.Client:
    api = httpx.Client(base_url=base, timeout=HTTP_TIMEOUT_S)
    response = api.post("/api/session", json={"email": email, "passcode": PASSCODE})
    assert response.status_code == 200, response.text
    return api


def ok(response: httpx.Response, status: int = 200) -> Any:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url} -> {response.status_code} {response.text[:500]}"
    )
    return response.json() if response.content else None


def refused(response: httpx.Response, status: int, error: str) -> dict:
    assert response.status_code == status, (
        f"{response.request.method} {response.request.url} -> {response.status_code} {response.text[:500]}"
    )
    body = response.json()
    assert body["error"] == error, body
    assert isinstance(body["message"], str) and body["message"], body
    return body


def stamp(days: float) -> str:
    moment = datetime.now(timezone.utc).replace(second=0, microsecond=0) + timedelta(days=days)
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def fmt_date(value: date) -> str:
    return f"{value:%a} {value.day} {value:%b} {value:%Y}"


def fmt_date_time(timestamp: str) -> str:
    moment = datetime.fromisoformat(timestamp)
    return f"{fmt_date(moment.date())}, {moment:%H:%M}"


def create_programme(
    api: httpx.Client,
    *,
    title: str | None = None,
    first_rehearsal: str | None = None,
    performances: list[str] | None = None,
    string_count: dict[str, Any] | None = None,
) -> dict:
    body = {
        "title": title or f"Programme {token()}",
        "first_rehearsal": first_rehearsal or stamp(40),
        "performances": performances or [stamp(44)],
        "string_count": string_count or SEED_COUNT,
    }
    return ok(api.post("/api/programmes", json=body), 201)


def add_work(api: httpx.Client, programme_id: str, catalogue_id: str) -> dict:
    return ok(api.post(f"/api/programmes/{programme_id}/works", json={"catalogue_work_id": catalogue_id}), 201)


def programme(api: httpx.Client, programme_id: str) -> dict:
    return ok(api.get(f"/api/programmes/{programme_id}"))


def work(api: httpx.Client, work_id: str) -> dict:
    return ok(api.get(f"/api/works/{work_id}"))


def part_of(api: httpx.Client, work_id: str, part_id_value: str) -> dict:
    return next(p for p in work(api, work_id)["parts"] if p["id"] == part_id_value)


def move(api: httpx.Client, programme_id: str, to: str) -> httpx.Response:
    return api.post(f"/api/programmes/{programme_id}/transition", json={"to": to})


def hold(api: httpx.Client, part_id_value: str, copies: Any) -> httpx.Response:
    return api.put(f"/api/parts/{part_id_value}/holdings", json={"copies_on_hand": copies})


def set_count(api: httpx.Client, programme_id: str, count: dict[str, Any]) -> httpx.Response:
    return api.put(f"/api/programmes/{programme_id}/string-count", json=count)


def cut(api: httpx.Client, work_id: str, span: tuple[Any, Any]) -> httpx.Response:
    return api.post(f"/api/works/{work_id}/cuts", json={"from_bar": span[0], "to_bar": span[1]})


def mark(api: httpx.Client, part_id_value: str, cut_id: str) -> httpx.Response:
    return api.post(f"/api/parts/{part_id_value}/marks", json={"cut_id": cut_id})


def part_id(work_detail: dict, chair_key: str) -> str:
    return next(p["id"] for p in work_detail["parts"] if p["chair_key"] == chair_key)


def stock(api: httpx.Client, programme_id: str, holdings: dict[str, int] | None = None) -> None:
    for summary in programme(api, programme_id)["works"]:
        for part in work(api, summary["id"])["parts"]:
            if holdings is None:
                wanted = part["copies"]["needed"]
            else:
                wanted = holdings.get(part["chair_key"], 1)
            ok(hold(api, part["id"], wanted))


def build(
    api: httpx.Client, catalogue_ids: list[str], *, prepare: bool = True, stocked: bool = True, **kwargs: Any
) -> tuple[dict, list[dict]]:
    created = create_programme(api, **kwargs)
    works = [add_work(api, created["id"], catalogue_id) for catalogue_id in catalogue_ids]
    if stocked:
        stock(api, created["id"])
    if prepare:
        ok(move(api, created["id"], "in_preparation"))
    return programme(api, created["id"]), works


def publish(api: httpx.Client, programme_id: str, key: str | None = None) -> httpx.Response:
    return api.post(f"/api/programmes/{programme_id}/publish", headers={"Idempotency-Key": key or idempotency_key()})


def published(api: httpx.Client, catalogue_ids: list[str], **kwargs: Any) -> tuple[dict, list[dict]]:
    prog, works = build(api, catalogue_ids, **kwargs)
    ok(publish(api, prog["id"]))
    return programme(api, prog["id"]), works


def pdf_bytes(tag: str) -> bytes:
    return b"%PDF-1.7\n% " + tag.encode() + b"\n%%EOF\n"


def multipart(kind: str, file_param: str, content: bytes, content_type: str) -> tuple[bytes, str]:
    boundary = f"qwboundary{hashlib.sha256(content + file_param.encode()).hexdigest()[:24]}"
    body = b"".join(
        [
            f'--{boundary}\r\nContent-Disposition: form-data; name="kind"\r\n\r\n{kind}\r\n'.encode(),
            (
                f'--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="{file_param}"\r\n'
                f"Content-Type: {content_type}\r\n\r\n"
            ).encode("utf-8")
            + content
            + b"\r\n",
            f"--{boundary}--\r\n".encode(),
        ]
    )
    return body, f"multipart/form-data; boundary={boundary}"


def upload(
    api: httpx.Client,
    part_id_value: str,
    file_name: str,
    content: bytes,
    content_type: str = "application/pdf",
    kind: str = "marked_part",
    key: str | None = None,
    raw_name: bool = False,
) -> httpx.Response:
    param = file_name if raw_name else file_name.replace('"', "%22").replace("\r", "%0D").replace("\n", "%0A")
    body, header = multipart(kind, param, content, content_type)
    headers = {"Content-Type": header}
    if key:
        headers["Idempotency-Key"] = key
    return api.post(f"/api/parts/{part_id_value}/scans", content=body, headers=headers)


def scans(api: httpx.Client, part_id_value: str) -> list[dict]:
    return ok(api.get(f"/api/parts/{part_id_value}/scans"))["scans"]


def scan_prefix(prog: dict, work_detail: dict, part_id_value: str) -> str:
    return f"scans/{prog['id']}/{work_detail['id']}/{part_id_value}/"


def rental(api: httpx.Client, work_detail: dict, publisher: str, slip: dict[str, int] = ORCHARD_SLIP) -> httpx.Response:
    lines = [{"part_id": part_id(work_detail, key), "copies": copies} for key, copies in slip.items()]
    return api.post("/api/rental-sets", json={"work_id": work_detail["id"], "publisher": publisher, "slip": lines})


def rental_move(api: httpx.Client, set_id: str, to: str) -> httpx.Response:
    return api.post(f"/api/rental-sets/{set_id}/transition", json={"to": to})


def rental_sets(api: httpx.Client) -> list[dict]:
    return ok(api.get("/api/rental-sets"))["rental_sets"]


def rental_by_id(api: httpx.Client, set_id: str) -> dict:
    return next(s for s in rental_sets(api) if s["id"] == set_id)


def check_in(api: httpx.Client, set_id: str, counts: list[dict[str, Any]]) -> httpx.Response:
    return api.put(f"/api/rental-sets/{set_id}/check-in", json={"counts": counts})


def in_use(api: httpx.Client, set_id: str) -> None:
    ok(rental_move(api, set_id, "received"))
    ok(rental_move(api, set_id, "in_use"))


def together(calls: list[Callable[[], httpx.Response]]) -> list[httpx.Response]:
    barrier = threading.Barrier(len(calls))

    def run(call: Callable[[], httpx.Response]) -> httpx.Response:
        barrier.wait()
        return call()

    with ThreadPoolExecutor(len(calls)) as pool:
        return list(pool.map(run, calls))


def wait_status(base: str, field: str, value: str) -> dict:
    api = signin(base, ROWAN)
    deadline = time.monotonic() + STATUS_WAIT_S
    while True:
        body = ok(api.get("/api/status"))
        if body[field] == value or time.monotonic() >= deadline:
            return body


def seated_emails(count: dict[str, int]) -> set[str]:
    return {
        f"{key}-{chair:02d}@players.quirewell.test"
        for key, section in SECTION_KEYS.items()
        for chair in range(1, count[section] + 1)
    }


def wait_mail(mail: Mailpit, predicate: Callable[[dict], bool], expected: int, seconds: float = MAIL_WAIT_S) -> list[dict]:
    deadline = time.monotonic() + seconds
    while True:
        found = [m for m in mail.messages(0, settle=1.0) if predicate(m)]
        if len(found) >= expected or time.monotonic() >= deadline:
            return found


def recipients(message: dict) -> list[str]:
    return [address.lower() for address in addresses(message.get("To") or [])]


def assert_single_recipient(message: dict) -> None:
    assert len(addresses(message.get("To") or [])) == 1, message.get("To")
    assert not addresses(message.get("Cc") or []), message.get("Cc")
    assert not addresses(message.get("Bcc") or []), message.get("Bcc")
    assert [a.lower() for a in addresses(message.get("From"))] == [mail_from_address().lower()]


def lines_of(message: dict) -> list[str]:
    return [line.strip() for line in text(message).splitlines() if line.strip()]


def authorise(page: Page, base: str, email: str) -> None:
    api = signin(base, email)
    page.context.add_cookies([{"name": "qw_session", "value": api.cookies.get("qw_session"), "url": base}])


@contextmanager
def app_page(
    browser: Browser,
    base: str,
    email: str | None,
    path: str,
    *,
    size: tuple[int, int] = LAPTOP,
    reduced_motion: str = "no-preference",
) -> Iterator[Page]:
    with open_app(browser, base + "/", reduced_motion=reduced_motion) as page:
        page.set_viewport_size({"width": size[0], "height": size[1]})
        if email:
            authorise(page, base, email)
        page.goto(base + path)
        yield page


@contextmanager
def zoned_page(browser: Browser, base: str, email: str, path: str, *, clock: datetime) -> Iterator[Page]:
    context = browser.new_context(viewport={"width": LAPTOP[0], "height": LAPTOP[1]}, timezone_id=FOREIGN_ZONE)
    try:
        page = context.new_page()
        page.clock.install(time=clock)
        authorise(page, base, email)
        page.goto(base + path)
        yield page
    finally:
        context.close()


def span_text(span: tuple[int, int]) -> str:
    return f"{span[0]}–{span[1]}"


def label(work_title: str, part_name: str) -> str:
    return f"{work_title} — {part_name}"


def caret(bar: int) -> str:
    return f"Bar {bar}"


def selected(span: tuple[int, int]) -> str:
    return f"Bars {span[0]}–{span[1]} selected"


def page_of(index: int, total: int) -> str:
    return f"Part {index} of {total}"


def starts(prefix: str) -> re.Pattern[str]:
    return re.compile("^" + re.escape(prefix))


def value_text(locator: Locator, expected: str) -> None:
    expect(locator).to_have_attribute(VALUE_TEXT, expected)


def reason_line(reason: str) -> str:
    return reason[0].upper() + reason[1:] + "."


def desk_path(prog: dict, work_detail: dict | None = None) -> str:
    path = f"/desk/{prog['id']}"
    return path + (f"?work={work_detail['id']}" if work_detail else "")


def status(page: Page, name: str) -> Locator:
    return page.get_by_role("status", name=name, exact=True)


def box(locator: Locator) -> dict[str, float]:
    bounds = locator.bounding_box()
    assert bounds is not None, locator
    return bounds


def on_screen(locator: Locator, width: float) -> bool:
    if locator.count() == 0 or not locator.first.is_visible():
        return False
    bounds = locator.first.bounding_box()
    return bounds is not None and bounds["width"] > 0 and bounds["x"] < width - 1 and bounds["x"] + bounds["width"] > 1


def ruler(page: Page) -> Locator:
    return page.get_by_role("slider", name="Bar ruler")


def press(page: Page, key: str, times: int) -> None:
    for _ in range(times):
        page.keyboard.press(key)


def select_span(page: Page, start: int, end: int) -> None:
    bar_ruler = ruler(page)
    bar_ruler.focus()
    page.keyboard.press("Home")
    press(page, "ArrowRight", start - 1)
    press(page, "Shift+ArrowRight", end - start)
    value_text(bar_ruler, selected((start, end)))


def running_time(page: Page) -> str:
    found = re.search(r"\d+:\d{2}", page.get_by_role("group", name="Running time").inner_text())
    return found.group(0) if found else ""


def run_until_time(page: Page, target: str) -> list[int]:
    seen = [to_seconds(running_time(page))]
    deadline = time.monotonic() + SPLICE_WAIT_S
    while seen[-1] != to_seconds(target) and time.monotonic() < deadline:
        advance(page, SAMPLE_MS)
        seen.append(to_seconds(running_time(page)))
    return seen


TARGET_HALF_PX = 21.5
TARGET_JS = """(e, half) => { e.scrollIntoView({block: 'center', inline: 'center'});
  const r = e.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height / 2;
  return [[-half, -half], [half, -half], [-half, half], [half, half]].every(([dx, dy]) => {
    const hit = document.elementFromPoint(x + dx, y + dy); return !!hit && (hit === e || e.contains(hit)); }); }"""
PLAIN_POINT_JS = """d => { const r = d.getBoundingClientRect();
  const controls = 'a[href],button,input,select,textarea,label,summary,[tabindex],[contenteditable],[role=button],[role=spinbutton]';
  for (let y = r.top + 6; y < r.bottom - 6; y += 6) for (let x = r.left + 6; x < r.right - 6; x += 6) {
    const hit = document.elementFromPoint(x, y);
    if (!hit || !d.contains(hit)) continue;
    const control = hit.closest(controls);
    if (control && control !== d && d.contains(control)) continue;
    return {x, y}; }
  return null; }"""
FOCUS_KEPT_JS = "d => document.activeElement === document.body || d.contains(document.activeElement)"


def hit_target(locator: Locator) -> bool:
    return bool(locator.evaluate(TARGET_JS, TARGET_HALF_PX))


def splice_samples(page: Page, target: str, probe: Callable[[], Any]) -> list[tuple[int, Any]]:
    samples = [(to_seconds(running_time(page)), probe())]
    deadline = time.monotonic() + SPLICE_WAIT_S
    while samples[-1][0] != to_seconds(target) and time.monotonic() < deadline:
        advance(page, SAMPLE_MS)
        samples.append((to_seconds(running_time(page)), probe()))
    return samples


def to_seconds(value: str) -> int:
    minutes, seconds = value.split(":")
    return int(minutes) * 60 + int(seconds)


def time_pattern(value: str) -> re.Pattern[str]:
    return re.compile(rf"(?<!\d){re.escape(value)}(?!\d)")


def figure(label: str, value: int) -> re.Pattern[str]:
    return re.compile(rf"{label}\s*{value}(?!\d)")


SCROLL_TOP_JS = "() => { window.scrollTo(0, 0); for (const e of document.querySelectorAll('*')) if (e.scrollTop) e.scrollTop = 0; }"
SPACED_TEXT_JS = """e => { const walk = document.createTreeWalker(e, NodeFilter.SHOW_TEXT), parts = [];
  while (walk.nextNode()) parts.push(walk.currentNode.textContent);
  return parts.join(' ').replace(/\\s+/g, ' '); }"""


def expect_copies(locator: Locator, copies: dict[str, int]) -> None:
    wanted = [figure(label, copies[key]) for label, key in (("Needed", "needed"), ("On hand", "on_hand"), ("Short", "shortfall"))]
    deadline = time.monotonic() + COPIES_WAIT_S
    while True:
        text = locator.evaluate(SPACED_TEXT_JS)
        missing = [pattern.pattern for pattern in wanted if not pattern.search(text)]
        if not missing:
            return
        assert time.monotonic() < deadline, f"{missing} not found in {text!r}"


def rail_work(page: Page, title: str) -> Locator:
    return (
        page.get_by_role("list", name="Works in programme")
        .get_by_role("listitem")
        .filter(has=page.get_by_role("link", name=title, exact=True))
    )


def part_row(page: Page, part_name: str) -> Locator:
    return (
        page.get_by_role("table", name="Parts")
        .get_by_role("row")
        .filter(has=page.get_by_role("spinbutton", name=f"Copies on hand {part_name}", exact=True))
    )


def part_cell(page: Page, part_name: str, column: str) -> Locator:
    table = page.get_by_role("table", name="Parts")
    expect(table.get_by_role("columnheader").first).to_be_visible()
    headers = [h.strip() for h in table.get_by_role("columnheader").all_inner_texts()]
    index = next(i for i, header in enumerate(headers) if header.startswith(column))
    row = part_row(page, part_name)
    return row.get_by_role("rowheader").or_(row.get_by_role("cell")).nth(index)


def record_buttons(page: Page) -> Locator:
    return page.get_by_role("button", name=starts("Record marked "))


def choose_file(page: Page, button: Locator, name: str, content: bytes, mime: str = "application/pdf") -> None:
    with page.expect_file_chooser() as chooser:
        button.click()
    chooser.value.set_files(files=[{"name": name, "mimeType": mime, "buffer": content}])


def choose(page: Page, combobox: Locator, required: tuple[str, ...], any_of: tuple[re.Pattern[str], ...] = ()) -> None:
    options = combobox.get_by_role("option", include_hidden=True)
    expect(options.filter(has_text=required[0]).first).to_be_attached()
    labels = [" ".join((o.text_content() or "").split()) for o in options.all()]
    matches = [
        label for label in labels
        if all(needle in label for needle in required) and (not any_of or any(p.search(label) for p in any_of))
    ]
    assert matches, f"no option of {labels} holds {required} and one of {[p.pattern for p in any_of]}"
    select(combobox, matches[0])


def inside(dialog: Locator) -> bool:
    return bool(dialog.evaluate("d => d.contains(document.activeElement)"))


def is_focused(locator: Locator) -> bool:
    return bool(locator.evaluate("el => el === document.activeElement"))


def tab_return(page: Page) -> None:
    page.evaluate(
        """() => {
          for (const state of ['hidden', 'visible']) {
            Object.defineProperty(document, 'visibilityState', {value: state, configurable: true});
            Object.defineProperty(document, 'hidden', {value: state === 'hidden', configurable: true});
            document.dispatchEvent(new Event('visibilitychange'));
          }
        }"""
    )


def swipe(page: Page, locator: Locator, distance: float) -> None:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True, "maxTouchPoints": 1})
    x, y = center(locator)
    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", "touchPoints": [{"x": x, "y": y}]})
    for step in range(1, SWIPE_STEPS + 1):
        cdp.send(
            "Input.dispatchTouchEvent",
            {"type": "touchMove", "touchPoints": [{"x": x + distance * step / SWIPE_STEPS, "y": y}]},
        )
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def path_x(point: dict[str, float]) -> float:
    return point.get("x", point.get("left", 0.0))


def mark_window(page: Page) -> None:
    page.evaluate("() => { window.__qwNoReload = true; }")


def assert_no_reload(page: Page) -> None:
    assert page.evaluate("() => window.__qwNoReload === true"), "the page reloaded"


@contextmanager
def ferry_programme(api: httpx.Client) -> Iterator[tuple[dict, dict]]:
    prog, works = build(api, [FERRY], stocked=False)
    try:
        yield prog, works[0]
    finally:
        move(api, prog["id"], "draft")


def fake_storage_down(page: Page) -> None:
    def down_status(route: Route) -> None:
        route.fulfill(status=200, json={"storage": "down", "mail": "up"})

    def down_folder(route: Route) -> None:
        response = route.fetch()
        body = response.json()
        body["scans_available"] = False
        route.fulfill(response=response, json=body)

    page.route("**/api/status", down_status)
    page.route("**/api/folders/*", down_folder)


def restore_storage(page: Page) -> None:
    page.unroute("**/api/status")
    page.unroute("**/api/folders/*")


def test_sign_in(app_url: str, browser: Browser) -> None:
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as api:
        response = api.post("/api/session", json={"email": YUSRA, "passcode": PASSCODE})
        user = ok(response)["user"]
        assert user["email"] == YUSRA and user["role"] == "player" and user["name"] == NAMES[YUSRA]
        assert user["chair"]["label"] == YUSRA_CHAIR
        cookie = next(c for c in response.headers.get_list("set-cookie") if c.split("=", 1)[0] == "qw_session")
        flags = cookie.lower()
        assert all(flag.lower() in flags for flag in COOKIE_FLAGS), cookie
        assert ok(api.get("/api/session"))["user"]["id"] == user["id"]
        assert api.delete("/api/session").status_code == 204
        refused(api.get("/api/session"), 401, "unauthenticated")
    with httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S) as api:
        refused(api.post("/api/session", json={"email": ROWAN, "passcode": WRONG_PASSCODE}), 401, "invalid_credentials")
        refused(api.post("/api/session", json={"email": ROWAN}), 422, "validation")
        refused(api.get("/api/session"), 401, "unauthenticated")
    assert ok(signin(app_url, ROWAN).get("/api/session"))["user"]["role"] == "principal_librarian"
    assert ok(signin(app_url, PRIYA).get("/api/session"))["user"]["role"] == "assistant_librarian"
    hester = ok(signin(app_url, HESTER).get("/api/session"))["user"]
    assert hester["role"] == "section_principal" and hester["name"] == NAMES[HESTER]
    flute = ok(signin(app_url, FLUTE_2).get("/api/session"))["user"]
    assert flute["role"] == "player" and flute["chair"]["label"] == "Flute 2"

    for email, route in ((ROWAN, "/desk"), (HESTER, "/section"), (YUSRA, "/folder")):
        with open_app(browser, app_url + "/") as page:
            page.get_by_role("textbox", name="Email").fill(email)
            passcode = page.get_by_role("textbox", name="Passcode")
            passcode.fill(PASSCODE)
            passcode.press("Enter")
            expect(page).to_have_url(re.compile(re.escape(app_url) + re.escape(route) + r"(?:[/?#].*)?$"))
            expect(page.get_by_role("navigation", name="Library")).to_be_visible()
    with open_app(browser, app_url + "/") as page:
        page.get_by_role("textbox", name="Email").fill(ROWAN)
        page.get_by_role("textbox", name="Passcode").fill(WRONG_PASSCODE)
        page.get_by_role("button", name="Sign in").click()
        expect(page.get_by_role("alert").filter(has_text="That email and passcode don't match.")).to_be_visible()
        expect(page.get_by_role("textbox", name="Email")).to_be_focused()
        page.goto(app_url + "/rentals")
        expect(page).to_have_url(re.compile(re.escape(app_url.rstrip("/")) + r"/?$"))


def test_role_access(app_url: str) -> None:
    api, priya, hester, yusra = (signin(app_url, e) for e in (ROWAN, PRIYA, HESTER, YUSRA))
    anon = httpx.Client(base_url=app_url, timeout=HTTP_TIMEOUT_S)
    prog, works = build(api, [ORCHARD])
    pid, orchard = prog["id"], works[0]
    vn1, vn2 = part_id(orchard, "vn1"), part_id(orchard, "vn2")
    marker = token()
    new_body = {"title": f"Forbidden {marker}", "first_rehearsal": stamp(40), "performances": [stamp(44)], "string_count": SEED_COUNT}

    refused(anon.get("/api/programmes"), 401, "unauthenticated")
    refused(anon.get(f"/api/programmes/{UNKNOWN_ID}"), 401, "unauthenticated")
    refused(anon.post(f"/api/programmes/{pid}/publish", headers={"Idempotency-Key": idempotency_key()}), 401, "unauthenticated")

    refused(priya.post("/api/programmes", json=new_body), 403, "forbidden")
    refused(yusra.post("/api/programmes", json=new_body), 403, "forbidden")
    refused(priya.post(f"/api/programmes/{pid}/transition", json={"to": "draft"}), 403, "forbidden")
    refused(publish(priya, pid), 403, "forbidden")
    refused(set_count(priya, pid, RAISED_COUNT), 403, "forbidden")
    refused(cut(priya, orchard["id"], FERRY_CUT_A), 403, "forbidden")
    refused(publish(priya, UNKNOWN_ID), 404, "not_found")
    refused(rental(priya, {"id": orchard["id"], "parts": [{"chair_key": "vn1", "id": UNKNOWN_ID}]}, marker, {"vn1": 1}), 404, "not_found")
    refused(rental(priya, orchard, marker), 403, "forbidden")
    refused(hold(hester, vn1, 0), 403, "forbidden")
    refused(hester.get("/api/rental-sets"), 403, "forbidden")
    refused(hester.get(f"/api/programmes/{pid}/notices"), 403, "forbidden")
    refused(hester.post(f"/api/programmes/{pid}/works", json={"catalogue_work_id": FEN}), 403, "forbidden")
    refused(yusra.get("/api/catalogue"), 403, "forbidden")
    refused(yusra.get("/api/programmes"), 403, "forbidden")
    refused(yusra.get("/api/rental-sets"), 403, "forbidden")
    refused(yusra.get(f"/api/programmes/{pid}"), 404, "not_found")
    refused(yusra.get(f"/api/works/{orchard['id']}"), 404, "not_found")
    refused(hold(yusra, vn2, 0), 404, "not_found")
    refused(publish(yusra, pid), 404, "not_found")
    refused(yusra.get(f"/api/programmes/{SEED_P01}"), 404, "not_found")

    after = programme(api, pid)
    assert after["status"] == "in_preparation" and after["string_count"] == SEED_COUNT
    assert work(api, orchard["id"])["cuts"] == []
    assert part_of(api, orchard["id"], vn1)["copies"]["shortfall"] == 0
    assert not any(marker in p["title"] for p in ok(api.get("/api/programmes"))["programmes"])
    assert not any(s["publisher"] == marker for s in rental_sets(api))

    ok(publish(api, pid))
    refused(hold(yusra, vn2, 0), 403, "forbidden")
    assert part_of(api, orchard["id"], vn2)["copies"]["on_hand"] > 0


def test_dialogs_keep_focus(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR], prepare=False, stocked=False)
    with app_page(browser, app_url, ROWAN, desk_path(prog, works[0])) as page:
        for opener_name, role, field_name in (("New programme", "textbox", "Title"), ("Add work", "combobox", "Catalogue work")):
            opener = page.get_by_role("button", name=opener_name, exact=True)
            opener.click()
            advance(page, SETTLE_MS)
            dialog = page.get_by_role("dialog", name=opener_name)
            field = dialog.get_by_role(role, name=field_name, exact=True)
            expect(field).to_be_focused()
            wrapped = False
            for _ in range(15):
                page.keyboard.press("Tab")
                assert inside(dialog), f"Tab left the {opener_name} dialog"
                wrapped = wrapped or is_focused(field)
            assert wrapped, f"Tab never wrapped to the first field of {opener_name}"
            for _ in range(15):
                page.keyboard.press("Shift+Tab")
                assert inside(dialog), f"Shift+Tab left the {opener_name} dialog"
            page.keyboard.press("Escape")
            advance(page, SETTLE_MS)
            expect(dialog).to_be_hidden()
            expect(opener).to_be_focused()
        page.set_viewport_size({"width": TABLET[0], "height": TABLET[1]})
        drawer_button = page.get_by_role("button", name="Programmes and works", exact=True)
        drawer_button.click()
        advance(page, SETTLE_MS)
        drawer = page.get_by_role("dialog", name="Programmes and works")
        expect(drawer).to_be_visible()
        assert inside(drawer)
        for key in ["Tab"] * 15 + ["Shift+Tab"] * 15:
            page.keyboard.press(key)
            assert inside(drawer), f"{key} left the drawer"
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        assert not on_screen(drawer, TABLET[0])
        expect(drawer_button).to_be_focused()


def test_health(app_url: str) -> None:
    response = httpx.get(app_url + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert response.status_code == 200
    assert response.headers["content-type"].startswith("application/json")
    assert response.json() == {"status": "ok"}


def test_server_boundary(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    marker = token()
    body = {"title": f"Origin {marker}", "first_rehearsal": stamp(40), "performances": [stamp(44)], "string_count": SEED_COUNT}
    cross = api.post("/api/programmes", json=body, headers={"Origin": FOREIGN_ORIGIN})
    refused(cross, 403, "cross_origin")
    assert CORS_HEADER not in cross.headers
    refused(httpx.post(app_url + "/api/programmes", json=body, headers={"Origin": FOREIGN_ORIGIN}), 403, "cross_origin")
    assert not any(p["title"] == body["title"] for p in ok(api.get("/api/programmes"))["programmes"])
    read = api.get("/api/programmes", headers={"Origin": FOREIGN_ORIGIN})
    assert CORS_HEADER not in read.headers
    parsed = urlparse(app_url)
    assert ok(api.post("/api/programmes", json=body, headers={"Origin": f"{parsed.scheme}://{parsed.netloc}"}), 201)["title"] == body["title"]

    base = json.dumps({**body, "title": ""}).encode()
    exact = json.dumps({**body, "title": "x" * (JSON_LIMIT - len(base))}).encode()
    assert len(exact) == JSON_LIMIT
    at_limit = api.post("/api/programmes", content=exact, headers={"Content-Type": "application/json"})
    assert refused(at_limit, 422, "validation")["errors"]["title"] == "Title must be 1 to 120 characters."
    over = json.dumps({**body, "title": "x" * (JSON_LIMIT + 1)}).encode()
    refused(api.post("/api/programmes", content=over, headers={"Content-Type": "application/json"}), 413, "body_too_large")
    refused(api.post("/api/programmes", content=json.dumps(body).encode(), headers={"Content-Type": "text/plain"}), 415, "unsupported_media_type")
    malformed = refused(api.post("/api/programmes", content=b'{"title":', headers={"Content-Type": "application/json"}), 422, "validation")
    assert "body" in malformed["errors"]
    refused(api.get(UNKNOWN_PATH), 404, "not_found")

    for path in SERVED_NEVER:
        assert httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S).status_code == 404, path
    shell = httpx.get(app_url + "/", timeout=HTTP_TIMEOUT_S).text
    asset_paths = sorted(set(re.findall(r'(?:src|href)="(/[^"]+\.(?:js|css))"', shell)))
    assets = [httpx.get(app_url + path, timeout=HTTP_TIMEOUT_S) for path in asset_paths]
    for path in asset_paths:
        assert httpx.get(app_url + path + ".map", timeout=HTTP_TIMEOUT_S).status_code == 404, path
    secrets = [os.environ.get(name, "") for name in CREDENTIAL_ENV]
    database_password = urlparse(os.environ.get("DATABASE_URL", "")).password or ""
    for secret in [s for s in [*secrets, database_password] if len(s) >= 6]:
        assert secret not in shell and all(secret not in asset.text for asset in assets)

    for env in ("APP_STORAGE_DOWN_URL", "APP_MAIL_DOWN_URL"):
        health = httpx.get(os.environ[env] + "/api/health", timeout=HTTP_TIMEOUT_S)
        assert health.status_code == 200 and health.json() == {"status": "ok"}, env


def test_programme_create(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    marker = token()
    first = create_programme(api, title=f"  Rivers {marker}  ")
    assert first["title"] == f"Rivers {marker}"
    assert first["status"] == "draft" and first["works"] == [] and first["string_count"] == SEED_COUNT
    assert re.fullmatch(r"\d{2}", first["number"])
    later, earlier = stamp(46), stamp(44)
    second = create_programme(api, title="x" * 120, performances=[later, earlier])
    assert re.fullmatch(r"\d{2}", second["number"]) and int(second["number"]) == int(first["number"]) + 1
    instants = [datetime.fromisoformat(p) for p in second["performances"]]
    assert instants == sorted(instants) and len(instants) == 2

    def invalid(field: str, message: str | None = None, **overrides: Any) -> None:
        body = {"title": f"Refused {marker}", "first_rehearsal": stamp(40), "performances": [stamp(44)], "string_count": SEED_COUNT, **overrides}
        errors = refused(api.post("/api/programmes", json=body), 422, "validation")["errors"]
        assert field in errors, errors
        if message:
            assert errors[field] == message

    invalid("title", "Title must be one line of text.", title=f"Rivers\n{marker}")
    invalid("title", "Title must be one line of text.", title="x" * 130 + "\t")
    invalid("title", "Title must be 1 to 120 characters.", title="")
    invalid("title", "Title must be 1 to 120 characters.", title="   ")
    invalid("title", "Title must be 1 to 120 characters.", title="x" * 121)
    invalid("first_rehearsal", first_rehearsal=f"next week {marker}")
    invalid("performances", performances=[])
    invalid("performances", first_rehearsal=stamp(40), performances=[stamp(40)])
    invalid("performances", performances=[stamp(44), stamp(44)])
    invalid("performances", performances=[stamp(41 + i) for i in range(11)])
    invalid("string_count.violin_1", string_count={**SEED_COUNT, "violin_1": ROSTER["vn1"] + 1})
    titles = [p["title"] for p in ok(api.get("/api/programmes"))["programmes"]]
    assert not any(marker in t and t != first["title"] for t in titles)


def test_programme_add_works(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog = create_programme(api)
    weir = add_work(api, prog["id"], WEIR)
    assert weir["id"] == f"{prog['id']}-the-weir" and weir["programme_id"] == prog["id"]
    assert weir["catalogue_work_id"] == WEIR and weir["title"] == "The Weir" and weir["composer"] == "Edith Marrow"
    assert weir["bars"] == 300 and weir["cuts"] == []
    assert weir["bar_map"] == WEIR_BAR_MAP
    assert weir["rehearsal_letters"] == [{"letter": k, "bar": v, "cut": False} for k, v in WEIR_LETTERS.items()]
    assert {p["name"] for p in weir["parts"]} == WEIR_PART_NAMES
    for part in weir["parts"]:
        assert part["id"] == f"{weir['id']}-{part['chair_key']}"
        assert part["copies"]["on_hand"] == 0 and part["marks"] == [] and part["mark_cut"] is False
        assert part["latest_marked_scan"] is None and part["latest_bowing_master"] is None
        expected_bars = {"Timpani": (1, 110), "Harp": (185, 300)}.get(part["name"], (1, 300))
        assert (part["bars_from"], part["bars_to"]) == expected_bars, part["name"]
    assert {p["chair_key"]: p["name"] for p in weir["parts"] if p["chair_key"] in SECTION_NAMES} == SECTION_NAMES
    refused(api.post(f"/api/programmes/{prog['id']}/works", json={"catalogue_work_id": WEIR}), 409, "work_already_in_programme")
    refused(api.post(f"/api/programmes/{prog['id']}/works", json={"catalogue_work_id": UNKNOWN_ID}), 404, "not_found")
    fen = add_work(api, prog["id"], FEN)
    assert fen["id"] == f"{prog['id']}-fen-country-dances"
    assert [w["id"] for w in programme(api, prog["id"])["works"]] == [weir["id"], fen["id"]]


def test_programme_transitions(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog = create_programme(api)
    pid = prog["id"]
    orchard = add_work(api, pid, ORCHARD)

    def stuck(current: str, *targets: str) -> None:
        for target in targets:
            refused(move(api, pid, target), 409, "illegal_transition")
            assert programme(api, pid)["status"] == current

    stuck("draft", "draft", "in_performance", "closed")
    refused(move(api, pid, "published"), 422, "validation")
    refused(move(api, pid, "sideways"), 422, "validation")
    assert ok(move(api, pid, "in_preparation"))["status"] == "in_preparation"
    stuck("in_preparation", "in_preparation", "in_performance", "closed")
    assert ok(move(api, pid, "draft"))["status"] == "draft"
    ok(move(api, pid, "in_preparation"))
    stock(api, pid)
    ok(publish(api, pid))
    assert programme(api, pid)["status"] == "published"
    stuck("published", "draft", "in_preparation", "closed")
    refused(api.post(f"/api/programmes/{pid}/works", json={"catalogue_work_id": FEN}), 409, "wrong_status")
    stored_cut = ok(cut(api, orchard["id"], FERRY_CUT_A), 201)["cut"]
    assert ok(move(api, pid, "in_performance"))["status"] == "in_performance"
    stuck("in_performance", "draft", "in_preparation", "in_performance")
    assert ok(move(api, pid, "closed"))["status"] == "closed"
    stuck("closed", "draft", "in_preparation", "in_performance", "closed")
    vn1 = part_id(orchard, "vn1")
    on_hand = part_of(api, orchard["id"], vn1)["copies"]["on_hand"]
    refused(set_count(api, pid, RAISED_COUNT), 409, "programme_closed")
    refused(cut(api, orchard["id"], FERRY_CUT_B), 409, "programme_closed")
    refused(api.delete(f"/api/cuts/{stored_cut['id']}"), 409, "programme_closed")
    refused(hold(api, vn1, 0), 409, "programme_closed")
    refused(mark(api, vn1, stored_cut["id"]), 409, "programme_closed")
    refused(api.post(f"/api/programmes/{pid}/works", json={"catalogue_work_id": FEN}), 409, "wrong_status")
    after = programme(api, pid)
    assert after["string_count"] == SEED_COUNT and len(after["works"]) == 1
    detail = work(api, orchard["id"])
    assert [c["id"] for c in detail["cuts"]] == [stored_cut["id"]]
    assert next(p for p in detail["parts"] if p["id"] == vn1)["copies"]["on_hand"] == on_hand
    assert next(p for p in detail["parts"] if p["id"] == vn1)["marks"] == []


@pytest.mark.parametrize("viewport", list(VIEWPORTS), ids=list(VIEWPORTS))
def test_wf_programme_desk_breakpoints(app_url: str, browser: Browser, viewport: str) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR], prepare=False, stocked=False)
    width, height = VIEWPORTS[viewport]
    with app_page(browser, app_url, ROWAN, desk_path(prog, works[0]), size=(width, height)) as page:
        header = page.get_by_role("region", name="Programme header")
        bar_ruler = ruler(page)
        parts = page.get_by_role("table", name="Parts")
        expect(header.get_by_role("heading", level=1, name=prog["title"])).to_be_visible()
        expect(bar_ruler).to_be_visible()
        expect(parts).to_be_visible()
        layout(page)
        rail = page.get_by_role("complementary", name="Programmes and works")
        drawer_button = page.get_by_role("button", name="Programmes and works", exact=True)
        h, r, t = box(header), box(bar_ruler), box(parts)
        assert h["y"] < r["y"] < t["y"]
        if width >= 1280:
            rail_box = box(rail)
            assert rail_box["x"] <= 1 and rail_box["height"] >= height - 2
            assert h["x"] >= rail_box["x"] + rail_box["width"] - 1
            assert r["y"] + r["height"] <= height and t["y"] < height
        elif width >= 768:
            assert not on_screen(rail, width)
            names = tab_order(page, 25)
            assert not any((name or "").startswith("Programme ") and " · " in (name or "") for name in names), names
            expect(drawer_button).to_be_visible()
            page.evaluate(SCROLL_TOP_JS)
            h, button_box = box(header), box(drawer_button)
            assert button_box["x"] < width / 2 and button_box["y"] <= h["y"] + h["height"]
            drawer_button.click()
            advance(page, SETTLE_MS)
            drawer = page.get_by_role("dialog", name="Programmes and works")
            expect(drawer).to_be_visible()
            assert box(drawer)["x"] <= 1
            drawer.get_by_role("link", name="The Weir", exact=True).click()
            advance(page, SETTLE_MS)
            assert not on_screen(drawer, width)
        else:
            assert drawer_button.count() == 0 or not drawer_button.is_visible()
            works_list = page.get_by_role("list", name="Works in programme")
            expect(works_list).to_be_visible()
            assert h["y"] < box(works_list)["y"] < r["y"]


def test_wf_programme_desk_build(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    title = f"Lantern night {token()}"
    posts: list[str] = []
    with app_page(browser, app_url, ROWAN, "/desk") as page:
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and urlparse(r.url).path == "/api/programmes" else None)
        expect(page.get_by_role("region", name="Programme header")).to_be_visible()
        mark_window(page)
        opener = page.get_by_role("button", name="New programme", exact=True)
        opener.click()
        advance(page, SETTLE_MS)
        dialog = page.get_by_role("dialog", name="New programme")
        dialog.get_by_role("textbox", name="Title", exact=True).fill(title)
        dialog.get_by_role("textbox", name="First rehearsal (London time)").fill("2026-10-25 01:30")
        dialog.get_by_role("textbox", name="Performance 1 (London time)").fill("2026-12-01 10:00")
        for section, label in zip(SEED_COUNT, ("Violin I", "Violin II", "Viola", "Cello", "Bass")):
            dialog.get_by_role("spinbutton", name=label, exact=True).fill(str(SEED_COUNT[section]))
        create = dialog.get_by_role("button", name="Create programme", exact=True)
        dialog.get_by_role("button", name="Add performance", exact=True).click()
        dialog.get_by_role("textbox", name=f"Performance {2} (London time)").fill("  2027-04-01 10:00  ")
        with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == "/api/programmes") as answer:
            create.click()
        sent = json.loads(answer.value.request.post_data or "{}")
        assert sent["title"] == title
        assert sent["first_rehearsal"] == "2026-10-25T01:30:00+01:00"
        assert sent["performances"] == ["2026-12-01T10:00:00+00:00", "2027-04-01T10:00:00+01:00"]
        assert sent["string_count"] == SEED_COUNT
        assert answer.value.status == 201
        created = answer.value.json()
        number = created["number"]
        expect(status(page, "Desk status")).to_have_text(f"Programme {number} created.")
        rail_link = page.get_by_role("link", name=f"Programme {number} · {title}")
        expect(rail_link).to_be_visible()
        assert_no_reload(page)
        advance(page, SETTLE_MS)
        rail_link.click()
        header = page.get_by_role("region", name="Programme header")
        expect(header.get_by_role("heading", level=1, name=title)).to_be_visible()
        mark_window(page)
        page.get_by_role("button", name="Add work", exact=True).click()
        advance(page, SETTLE_MS)
        add_dialog = page.get_by_role("dialog", name="Add work")
        choose(page, add_dialog.get_by_role("combobox", name="Catalogue work"), ("The Weir",))
        add_dialog.get_by_role("button", name="Add", exact=True).click()
        expect(status(page, "Desk status")).to_have_text(f"The Weir added to Programme {number}.")
        advance(page, SETTLE_MS)
        stored = programme(api, created["id"])
        weir_summary = stored["works"][0]
        expect_copies(rail_work(page, "The Weir"), weir_summary["copies"])
        expect_copies(page.get_by_role("group", name="Programme copies"), stored["copies"])
        expect(page.get_by_role("spinbutton", name=starts("Copies on hand "))).to_have_count(len(WEIR_PART_NAMES))
        page.get_by_role("button", name="Start preparation", exact=True).click()
        expect(status(page, "Desk status")).to_have_text(f"Programme {number} is now In preparation.")
        expect(header).to_contain_text("In preparation")
        assert_no_reload(page)
    final = programme(api, created["id"])
    assert final["status"] == "in_preparation" and [w["title"] for w in final["works"]] == ["The Weir"]
    assert final["first_rehearsal"] == "2026-10-25T01:30:00+01:00"
    assert final["performances"] == ["2026-12-01T10:00:00+00:00", "2027-04-01T10:00:00+01:00"]


def test_programme_times_as_instants(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    across = create_programme(api, first_rehearsal="2026-10-25T01:30:00+01:00", performances=["2026-10-25T01:10:00+00:00"])
    assert across["first_rehearsal"] == "2026-10-25T01:30:00+01:00"
    assert across["performances"] == ["2026-10-25T01:10:00+00:00"]
    assert across["final_performance_date"] == "2026-10-25"
    reversed_body = {
        "title": f"Instants {token()}",
        "first_rehearsal": "2026-10-25T01:10:00+00:00",
        "performances": ["2026-10-25T01:30:00+01:00"],
        "string_count": SEED_COUNT,
    }
    assert "performances" in refused(api.post("/api/programmes", json=reversed_body), 422, "validation")["errors"]
    utc = create_programme(
        api,
        first_rehearsal="2026-10-25T00:30:00Z",
        performances=["2027-04-01T09:00:00Z", "2026-12-01T10:00:00Z", "2026-10-25T23:30:00+00:00"],
    )
    assert utc["first_rehearsal"] == "2026-10-25T01:30:00+01:00"
    assert utc["performances"] == ["2026-10-25T23:30:00+00:00", "2026-12-01T10:00:00+00:00", "2027-04-01T10:00:00+01:00"]
    assert utc["final_performance_date"] == "2027-04-01"

    title = f"Wall clock {token()}"
    posts: list[str] = []
    with app_page(browser, app_url, ROWAN, "/desk") as page:
        page.on("request", lambda r: posts.append(r.url) if r.method == "POST" and urlparse(r.url).path == "/api/programmes" else None)
        page.get_by_role("button", name="New programme", exact=True).click()
        advance(page, SETTLE_MS)
        dialog = page.get_by_role("dialog", name="New programme")
        dialog.get_by_role("textbox", name="Title", exact=True).fill(title)
        dialog.get_by_role("textbox", name="First rehearsal (London time)").fill("2026-10-25 01:30")
        performance_1 = dialog.get_by_role("textbox", name="Performance 1 (London time)")
        performance_1.fill("2027-03-28 01:30")
        for section, label in zip(SEED_COUNT, ("Violin I", "Violin II", "Viola", "Cello", "Bass")):
            dialog.get_by_role("spinbutton", name=label, exact=True).fill(str(SEED_COUNT[section]))
        create = dialog.get_by_role("button", name="Create programme", exact=True)
        create.click()
        expect(performance_1).to_have_accessible_description(re.compile(re.escape("There is no 01:30 on Sun 28 Mar 2027 in London time.")))
        expect(performance_1).to_be_focused()
        performance_1.fill("next tuesday")
        create.click()
        expect(performance_1).to_have_accessible_description(re.compile(re.escape("Enter a date and time like 2026-12-01 10:00.")))
        expect(performance_1).to_be_focused()
        assert posts == []
        performance_1.fill("2027-04-01 10:00")
        with page.expect_response(lambda r: r.request.method == "POST" and urlparse(r.url).path == "/api/programmes") as answer:
            create.click()
        sent = json.loads(answer.value.request.post_data or "{}")
        assert sent["first_rehearsal"] == "2026-10-25T01:30:00+01:00"
        assert sent["performances"] == ["2027-04-01T10:00:00+01:00"]
        assert answer.value.status == 201


def needed_for(chair_key: str, count: dict[str, int]) -> int:
    if chair_key in SECTION_KEYS:
        players = count[SECTION_KEYS[chair_key]]
        return -(-players // 2) + (1 if players >= 8 else 0)
    return 1


def test_copies_rule(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    stock(api, prog["id"], P01_HOLDINGS)

    def check(count: dict[str, int]) -> dict[str, int]:
        detail = programme(api, prog["id"])
        totals = {"needed": 0, "on_hand": 0, "shortfall": 0}
        for summary in detail["works"]:
            sums = {"needed": 0, "on_hand": 0, "shortfall": 0}
            for part in work(api, summary["id"])["parts"]:
                copies = part["copies"]
                assert copies["needed"] == needed_for(part["chair_key"], count), part["name"]
                assert copies["shortfall"] == max(copies["needed"] - copies["on_hand"], 0)
                for key in sums:
                    sums[key] += copies[key]
            assert summary["copies"] == sums
            for key in totals:
                totals[key] += sums[key]
        assert detail["copies"] == totals
        return detail["copies"]

    assert check(SEED_COUNT) == {"needed": 57, "on_hand": 57, "shortfall": 0}
    ok(set_count(api, prog["id"], RAISED_COUNT))
    assert check(RAISED_COUNT) == {"needed": 61, "on_hand": 57, "shortfall": 4}
    ok(hold(api, part_id(works[0], "fl1"), 3))
    assert check(RAISED_COUNT) == {"needed": 61, "on_hand": 59, "shortfall": 4}
    no_bass = {**RAISED_COUNT, "bass": 0}
    ok(set_count(api, prog["id"], no_bass))
    check(no_bass)


def test_holdings_api(app_url: str) -> None:
    api, priya, hester = (signin(app_url, e) for e in (ROWAN, PRIYA, HESTER))
    prog, works = build(api, [ORCHARD], prepare=False, stocked=False)
    orchard = works[0]
    vn1 = part_id(orchard, "vn1")
    saved = ok(hold(priya, vn1, 3))
    assert saved["part"]["id"] == vn1
    assert saved["part"]["copies"] == {"needed": 5, "on_hand": 3, "shortfall": 2}
    assert saved["work"]["copies"]["on_hand"] == 3 and saved["work"]["copies"]["shortfall"] == 17 - 3
    assert saved["programme"]["copies"] == saved["work"]["copies"]
    assert part_of(api, orchard["id"], vn1)["copies"] == saved["part"]["copies"]
    assert programme(api, prog["id"])["copies"] == saved["programme"]["copies"]
    again = ok(hold(api, vn1, 7))
    assert again["part"]["copies"] == {"needed": 5, "on_hand": 7, "shortfall": 0}
    for value in (100, -1, 2.5, "3", None):
        refused(hold(priya, vn1, value), 422, "validation")
    refused(hold(hester, vn1, 1), 403, "forbidden")
    refused(hold(priya, UNKNOWN_ID, 1), 404, "not_found")
    assert part_of(api, orchard["id"], vn1)["copies"]["on_hand"] == 7


COUNT_CASES = {
    "over_roster": ({"violin_1": 11}, "violin_1", "The roster has 10 players in Violin I."),
    "bass_over": ({"bass": 5}, "bass", "The roster has 4 players in Bass."),
    "negative": ({"cello": -1}, "cello", "Enter a whole number from 0 to 5."),
    "fraction": ({"viola": 2.5}, "viola", "Enter a whole number from 0 to 6."),
    "text": ({"bass": "4"}, "bass", "Enter a whole number from 0 to 4."),
    "missing": ({"violin_2": None}, "violin_2", None),
}


@pytest.mark.parametrize("case", list(COUNT_CASES), ids=list(COUNT_CASES))
def test_string_count_limits(app_url: str, case: str) -> None:
    api = signin(app_url, ROWAN)
    change, field, message = COUNT_CASES[case]
    body = {k: v for k, v in {**SEED_COUNT, **change}.items() if v is not None}
    prog = create_programme(api)
    errors = refused(set_count(api, prog["id"], body), 422, "validation")["errors"]
    assert field in errors
    if message:
        assert errors[field] == message
    assert programme(api, prog["id"])["string_count"] == SEED_COUNT
    marker = token()
    create_body = {"title": f"Count {marker}", "first_rehearsal": stamp(40), "performances": [stamp(44)], "string_count": body}
    assert f"string_count.{field}" in refused(api.post("/api/programmes", json=create_body), 422, "validation")["errors"]
    assert not any(marker in p["title"] for p in ok(api.get("/api/programmes"))["programmes"])


@pytest.mark.parametrize("viewport", list(SURFACE_VIEWPORTS), ids=list(SURFACE_VIEWPORTS))
def test_wf_string_count_surfaces(app_url: str, browser: Browser, viewport: str) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], stocked=False)
    stock(api, prog["id"], P01_HOLDINGS)
    width, height = SURFACE_VIEWPORTS[viewport]
    delayed: list[tuple[Route, Any]] = []

    def delay_first(route: Route) -> None:
        if delayed:
            route.fallback()
            return
        delayed.append((route, route.fetch()))

    with app_page(browser, app_url, ROWAN, desk_path(prog, works[0]), size=(width, height)) as page:
        header = page.get_by_role("region", name="Programme header")
        expect(header.get_by_role("heading", level=1, name=prog["title"])).to_be_visible()
        page.route("**/api/programmes/*/string-count", delay_first)
        header.get_by_role("spinbutton", name="Violin I", exact=True).fill("10")
        save = header.get_by_role("button", name="Save string count", exact=True)
        save.click()
        saved_copy = f"String count saved: {'10-8-6-5-4'}. Short {4}."
        expect(status(page, "Desk status")).to_have_text("Saving string count")
        header.get_by_role("spinbutton", name="Violin II", exact=True).fill("8")
        save.click()
        expect(status(page, "Desk status")).to_have_text(saved_copy)
        assert len(delayed) == 1
        route, response = delayed[0]
        with page.expect_event("requestfinished", lambda r: "string-count" in r.url):
            route.fulfill(response=response)
        advance(page, SETTLE_MS)
        stored = programme(api, prog["id"])
        assert stored["string_count"] == RAISED_COUNT
        assert stored["copies"] == {"needed": 61, "on_hand": 57, "shortfall": 4}
        expect(status(page, "Desk status")).to_have_text(saved_copy)
        expect_copies(page.get_by_role("group", name="Programme copies"), stored["copies"])
        for summary in stored["works"]:
            expect_copies(rail_work(page, summary["title"]), summary["copies"])
        violin = part_of(api, works[0]["id"], part_id(works[0], "vn1"))["copies"]
        if width >= 1280:
            expect(part_cell(page, "Violin I", "Needed")).to_have_text(re.compile(rf"(?:^|\D){violin['needed']}\s*$"))
            expect(part_cell(page, "Violin I", "Short")).to_have_text(re.compile(rf"(?:^|\D){violin['shortfall']}\s*$"))
        else:
            assert box(header)["y"] < box(page.get_by_role("list", name="Works in programme"))["y"]
        layout(page)


def test_wf_string_count_holdings_latest(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], stocked=False)
    stock(api, prog["id"], P01_HOLDINGS)
    cello = part_id(works[0], "vc")
    delayed: list[tuple[Route, Any]] = []
    sent: list[str] = []

    def delay_first(route: Route) -> None:
        sent.append(route.request.post_data or "")
        if delayed:
            route.fallback()
            return
        delayed.append((route, route.fetch()))

    with app_page(browser, app_url, PRIYA, desk_path(prog, works[0])) as page:
        spin = page.get_by_role("spinbutton", name="Copies on hand Cello", exact=True)
        expect(spin).to_have_value("3")
        page.route(f"**/api/parts/{cello}/holdings", delay_first)
        spin.focus()
        spin.press("Tab")
        spin.fill("4")
        spin.press("Tab")
        expect(status(page, "Desk status")).to_have_text(f"Saving copies for {label(WEIR_TITLE, 'Cello')}")
        spin.fill("5")
        spin.press("Tab")
        expect(status(page, "Desk status")).to_have_text("Copies on hand saved for The Weir — Cello: 5.")
        route, response = delayed[0]
        with page.expect_event("requestfinished", lambda r: r.url.endswith(f"/api/parts/{cello}/holdings")):
            route.fulfill(response=response)
        advance(page, SETTLE_MS)
        expect(status(page, "Desk status")).to_have_text("Copies on hand saved for The Weir — Cello: 5.")
        expect(spin).to_have_value("5")
        stored = programme(api, prog["id"])
        expect_copies(page.get_by_role("group", name="Programme copies"), stored["copies"])
        expect_copies(rail_work(page, "The Weir"), stored["works"][0]["copies"])
    assert len(sent) == 2
    assert part_of(api, works[0]["id"], cello)["copies"]["on_hand"] == 5


def total_ms(bar_map: list[dict], cuts: list[tuple[int, int]]) -> int:
    return sum(
        seg["bar_ms"]
        for seg in bar_map
        for bar in range(seg["from_bar"], seg["to_bar"] + 1)
        if not any(a <= bar <= b for a, b in cuts)
    )


def whole_seconds(ms: int) -> int:
    return (ms + 500) // 1000


def mss(seconds: int) -> str:
    return f"{seconds // 60}:{seconds % 60:02d}"


def test_cuts_api(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    assert programme(api, prog["id"])["running_time"] == "38:40"
    created = ok(cut(api, weir["id"], WEIR_CUT), 201)
    stored = created["cut"]
    assert (stored["from_bar"], stored["to_bar"], stored["work_id"]) == (*WEIR_CUT, weir["id"])
    assert stored["saved"] == "4:28" and stored["saved_seconds"] == to_seconds("4:28")
    assert stored["parts_to_mark"] == 14
    assert created["programme"]["running_time"] == "34:12"
    cut_ms = total_ms(WEIR_BAR_MAP, [WEIR_CUT])
    for detail in (created["work"], work(api, weir["id"])):
        assert detail["running_time_seconds"] == whole_seconds(cut_ms)
        assert detail["running_time"] == mss(whole_seconds(cut_ms))
        assert detail["full_running_time_seconds"] == whole_seconds(total_ms(WEIR_BAR_MAP, []))
        assert {l["letter"]: l["cut"] for l in detail["rehearsal_letters"]} == {
            k: WEIR_CUT[0] <= v <= WEIR_CUT[1] for k, v in WEIR_LETTERS.items()
        }
        assert [c["id"] for c in detail["cuts"]] == [stored["id"]]
    reread = programme(api, prog["id"])
    assert reread["running_time"] == "34:12" and reread["running_time_seconds"] == to_seconds("34:12")
    assert reread["parts_to_mark"] == 14
    bars = weir["bars"]
    for span in ((WEIR_CUT[1], WEIR_CUT[0]), (0, 1), (1, bars + 1), ("a", 1), (1.5, 2)):
        errors = refused(cut(api, weir["id"], span), 422, "validation")["errors"]
        assert {"from_bar", "to_bar"} & set(errors)
    errors = refused(api.post(f"/api/works/{weir['id']}/cuts", json={"to_bar": 1}), 422, "validation")["errors"]
    assert "from_bar" in errors
    assert len(work(api, weir["id"])["cuts"]) == 1
    deleted = ok(api.delete(f"/api/cuts/{stored['id']}"))
    assert deleted["work"]["cuts"] == [] and deleted["programme"]["running_time"] == "38:40"
    refused(api.delete(f"/api/cuts/{stored['id']}"), 404, "not_found")
    assert programme(api, prog["id"])["running_time"] == "38:40"


def test_cuts_overlap(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FERRY, FEN], prepare=False, stocked=False)
    weir, ferry, fen = works
    ok(cut(api, weir["id"], WEIR_CUT), 201)
    for span in ((WEIR_CUT[1], 205), (97, WEIR_CUT[0]), (133, 169)):
        refused(cut(api, weir["id"], span), 409, "cut_overlaps")
    ok(cut(api, weir["id"], (WEIR_CUT[1] + 1, 205)), 201)
    ok(cut(api, weir["id"], (WEIR_CUT[0] - 1, WEIR_CUT[0] - 1)), 201)
    ok(cut(api, ferry["id"], (1, 91)), 201)
    refused(cut(api, ferry["id"], (92, ferry["bars"])), 409, "cut_removes_whole_work")
    refused(cut(api, fen["id"], (1, fen["bars"])), 409, "cut_removes_whole_work")
    assert len(work(api, ferry["id"])["cuts"]) == 1 and work(api, fen["id"])["cuts"] == []
    bar = WEIR_LETTERS["G"]
    spans = [(bar - 10, bar), (bar, bar + 10), (bar - 5, bar + 5), (bar - 1, bar + 1), (bar, bar), (bar - 3, bar + 8)]
    clients = [signin(app_url, ROWAN) for _ in spans]
    answers = together([lambda c=c, s=s: cut(c, weir["id"], s) for c, s in zip(clients, spans)])
    assert sorted(a.status_code for a in answers) == [201] + [409] * (len(spans) - 1)
    for answer in answers:
        if answer.status_code == 409:
            assert answer.json()["error"] == "cut_overlaps"
    near = [c for c in work(api, weir["id"])["cuts"] if c["to_bar"] >= bar - 10 and c["from_bar"] <= bar + 10]
    assert len(near) == 1


def test_wf_cut_splice_keyboard(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        bar_ruler = ruler(page)
        mark_button = page.get_by_role("button", name=starts(MARK_CUT))
        expect(bar_ruler).to_be_visible()
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("38:40"))
        bar_ruler.focus()
        value_text(bar_ruler, caret(1))
        page.keyboard.press("End")
        value_text(bar_ruler, caret(weir["bars"]))
        page.keyboard.press("Home")
        press(page, "ArrowRight", WEIR_CUT[0] - 1)
        value_text(bar_ruler, caret(WEIR_CUT[0]))
        page.keyboard.press("Shift+ArrowRight")
        value_text(bar_ruler, selected((WEIR_CUT[0], WEIR_CUT[0] + 1)))
        page.keyboard.press("Escape")
        value_text(bar_ruler, caret(WEIR_CUT[0] + 1))
        expect(mark_button).to_be_disabled()
        page.keyboard.press("Enter")
        page.keyboard.press("ArrowLeft")
        press(page, "Shift+ArrowRight", WEIR_CUT[1] - WEIR_CUT[0])
        value_text(bar_ruler, selected(WEIR_CUT))
        expect(mark_button).to_be_enabled()
        expect(mark_button).to_contain_text(f"{MARK_CUT} {WEIR_SPAN}")
        assert work(api, weir["id"])["cuts"] == []
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith(f"/api/works/{weir['id']}/cuts")) as answer:
            page.keyboard.press("Enter")
        assert answer.value.status == 201
        expect(bar_ruler).to_be_focused()
        advance(page, SPLICE_MAX_MS)
        expect(status(page, "Ruler status")).to_have_text(f"Cut bars {WEIR_SPAN} · −{WEIR_SAVED} · {WEIR_CUT_FLAGS} parts to mark")
        expect(page.get_by_role("button", name=f"Restore bars {WEIR_SPAN}", exact=True)).to_be_visible()
        assert [(c["from_bar"], c["to_bar"]) for c in work(api, weir["id"])["cuts"]] == [WEIR_CUT]
        expect(bar_ruler).to_be_focused()
        page.keyboard.press("Home")
        press(page, "ArrowRight", WEIR_CUT[0] - 2)
        value_text(bar_ruler, caret(WEIR_CUT[0] - 1))
        page.keyboard.press("ArrowRight")
        value_text(bar_ruler, caret(WEIR_CUT[1] + 1))
        page.keyboard.press("ArrowLeft")
        press(page, "ArrowLeft", 9)
        press(page, "Shift+ArrowRight", 10)
        value_text(bar_ruler, selected((WEIR_CUT[0] - 10, WEIR_CUT[0] - 1)))
        page.keyboard.press("Escape")
        value_text(bar_ruler, caret(WEIR_CUT[0] - 1))
        expect(bar_ruler).to_be_focused()
    assert [(c["from_bar"], c["to_bar"]) for c in work(api, weir["id"])["cuts"]] == [WEIR_CUT]


def test_wf_cut_splice_motion(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        expect(ruler(page)).to_be_visible()
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("38:40"))
        letter_f = page.get_by_text("F", exact=True).first
        full_x = box(letter_f)["x"]
        select_span(page, *WEIR_CUT)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith(f"/api/works/{weir['id']}/cuts")) as answer:
            page.keyboard.press("Enter")
        assert answer.value.status == 201
        seen = run_until_time(page, "34:12")
        assert seen[-1] == to_seconds("34:12"), seen
        assert all(a >= b for a, b in zip(seen, seen[1:])), seen
        assert any(to_seconds("34:12") < s < to_seconds("38:40") for s in seen), seen
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS)
        expect(page.get_by_text(f"vi–de {WEIR_SPAN}")).to_be_visible()
        expect(rail_work(page, WEIR_TITLE)).to_contain_text(f"{WEIR_CUT_FLAGS} to mark")
        assert box(letter_f)["x"] < full_x
        with page.expect_response(lambda r: r.request.method == "DELETE" and "/api/cuts/" in r.url) as undone:
            page.get_by_role("button", name="Undo cut", exact=True).click()
        assert undone.value.status == 200
        path = motion(letter_f, SPLICE_MAX_MS)
        xs = [path_x(p) for p in path]
        assert xs[-1] > xs[0] and all(b >= a - 0.5 for a, b in zip(xs, xs[1:])), xs
        run_until_time(page, "38:40")
        advance(page, SPLICE_MAX_MS)
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("38:40"))
        expect(status(page, "Ruler status")).to_have_text(f"Restored bars {WEIR_SPAN} · +{WEIR_SAVED}")
        expect(record_buttons(page)).to_have_count(0)
        assert abs(box(letter_f)["x"] - full_x) <= 1
    assert work(api, weir["id"])["cuts"] == []


def test_wf_cut_splice_mark_lands_before_count(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("38:40"))
        mark_label = page.get_by_text(f"vi–de {WEIR_SPAN}")
        select_span(page, *WEIR_CUT)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith(f"/api/works/{weir['id']}/cuts")) as answer:
            page.keyboard.press("Enter")
        assert answer.value.status == 201
        samples = splice_samples(page, "34:12", lambda: (mark_label.count() > 0, record_buttons(page).count()))
        counting = [probe for seconds, probe in samples if to_seconds("34:12") < seconds < to_seconds("38:40")]
        assert counting, samples
        assert all(labelled for labelled, _ in counting), samples
        assert all(flags == 0 for _, flags in counting), samples


def test_wf_cut_splice_restore_dialog(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        select_span(page, *WEIR_CUT)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/cuts")) as answer:
            page.get_by_role("button", name=starts(MARK_CUT)).click()
        assert answer.value.status == 201
        advance(page, SPLICE_MAX_MS)
        expect(ruler(page)).to_be_focused()
        page.reload()
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("34:12"))
        splice = page.get_by_role("button", name=f"Restore bars {WEIR_SPAN}", exact=True)
        expect(splice).to_be_visible()
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS)
        dialog = page.get_by_role("dialog", name=f"Restore bars {WEIR_SPAN}")
        splice.click()
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(splice).to_be_focused()
        splice.click()
        advance(page, SETTLE_MS)
        dialog.get_by_role("button", name="Keep cut", exact=True).click()
        advance(page, SETTLE_MS)
        expect(splice).to_be_focused()
        assert len(work(api, weir["id"])["cuts"]) == 1
        splice.click()
        advance(page, SETTLE_MS)
        with page.expect_response(lambda r: r.request.method == "DELETE") as removed:
            dialog.get_by_role("button", name="Restore bars", exact=True).click()
        assert removed.value.status == 200
        advance(page, SPLICE_MAX_MS)
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("38:40"))
        expect(status(page, "Ruler status")).to_have_text(f"Restored bars {WEIR_SPAN} · +{WEIR_SAVED}")
        expect(splice).to_have_count(0)
        expect(ruler(page)).to_be_focused()
    assert work(api, weir["id"])["cuts"] == []
    assert programme(api, prog["id"])["running_time"] == "38:40"


def test_wf_cut_splice_restore_keyboard(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    ok(cut(api, weir["id"], WEIR_CUT), 201)
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        splice = page.get_by_role("button", name=f"Restore bars {WEIR_SPAN}", exact=True)
        dialog = page.get_by_role("dialog", name=f"Restore bars {WEIR_SPAN}")
        expect(splice).to_be_visible()
        splice.focus()
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        assert inside(dialog)
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(splice).to_be_focused()
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        dialog.get_by_role("button", name="Restore bars", exact=True).focus()
        with page.expect_response(lambda r: r.request.method == "DELETE" and "/api/cuts/" in r.url) as removed:
            page.keyboard.press("Enter")
        assert removed.value.status == 200
        run_until_time(page, "38:40")
        advance(page, SPLICE_MAX_MS)
        expect(status(page, "Ruler status")).to_have_text(f"Restored bars {WEIR_SPAN} · +{WEIR_SAVED}")
        expect(ruler(page)).to_be_focused()
    assert work(api, weir["id"])["cuts"] == []


def test_wf_cut_splice_reduced_motion(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    with app_page(browser, app_url, ROWAN, desk_path(prog, works[0]), reduced_motion="reduce") as page:
        select_span(page, *WEIR_CUT)
        with page.expect_response(lambda r: r.request.method == "POST" and r.url.endswith("/cuts")) as answer:
            page.keyboard.press("Enter")
        assert answer.value.status == 201
        advance(page, 1)
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("34:12"))
        expect(status(page, "Ruler status")).to_have_text(f"Cut bars {WEIR_SPAN} · −{WEIR_SAVED} · {WEIR_CUT_FLAGS} parts to mark")
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS)
        expect(page.get_by_role("button", name=f"Restore bars {WEIR_SPAN}", exact=True)).to_be_visible()
        assert animations(ruler(page)) == []
        with page.expect_response(lambda r: r.request.method == "DELETE") as undone:
            page.get_by_role("button", name="Undo cut", exact=True).click()
        assert undone.value.status == 200
        advance(page, 1)
        expect(page.get_by_role("group", name="Running time")).to_contain_text(time_pattern("38:40"))
        expect(status(page, "Ruler status")).to_have_text(f"Restored bars {WEIR_SPAN} · +{WEIR_SAVED}")
    assert work(api, works[0]["id"])["cuts"] == []


def test_marks_api(app_url: str) -> None:
    api, priya, hester, odile, yusra = (signin(app_url, e) for e in (ROWAN, PRIYA, HESTER, ODILE, YUSRA))
    prog, works = build(api, [WEIR, FEN], stocked=False)
    weir, fen = works
    stored = ok(cut(api, weir["id"], WEIR_CUT), 201)["cut"]
    vn1, vn2, timp = part_id(weir, "vn1"), part_id(weir, "vn2"), part_id(weir, "timp")
    detail = work(api, weir["id"])
    parts = {p["id"]: p for p in detail["parts"]}
    assert parts[vn1]["cuts_to_mark"] == [stored["id"]] and parts[vn1]["mark_cut"] is True
    assert parts[timp]["cuts_to_mark"] == [] and parts[timp]["mark_cut"] is False
    assert parts[part_id(weir, "hp")]["mark_cut"] is False
    assert detail["parts_to_mark"] == 14 and programme(api, prog["id"])["parts_to_mark"] == 14
    first = ok(mark(hester, vn1, stored["id"]), 201)
    entry = first["part"]["marks"][0]
    assert (entry["cut_id"], entry["from_bar"], entry["to_bar"]) == (stored["id"], *WEIR_CUT)
    assert entry["marked_by"]["name"] == NAMES[HESTER] and entry["marked_by"]["role"] == "section_principal"
    datetime.fromisoformat(entry["marked_at"])
    assert first["part"]["mark_cut"] is False and first["part"]["cuts_to_mark"] == []
    second = ok(mark(priya, vn1, stored["id"]), 200)
    assert second["part"]["marks"] == first["part"]["marks"]
    after = work(api, weir["id"])
    assert after["parts_to_mark"] == 13 and programme(api, prog["id"])["parts_to_mark"] == 13
    assert next(c for c in after["cuts"] if c["id"] == stored["id"])["parts_to_mark"] == 13
    refused(mark(odile, vn1, stored["id"]), 403, "forbidden")
    assert ok(mark(odile, vn2, stored["id"]), 201)["part"]["marks"][0]["marked_by"]["name"] == "Odile Farrant"
    refused(mark(yusra, vn2, stored["id"]), 404, "not_found")
    assert "cut_id" in refused(mark(priya, timp, stored["id"]), 422, "validation")["errors"]
    fen_cut = ok(cut(api, fen["id"], (1, 41)), 201)["cut"]
    refused(mark(priya, vn1, fen_cut["id"]), 404, "not_found")
    refused(mark(priya, vn1, UNKNOWN_ID), 404, "not_found")
    early = ok(cut(api, weir["id"], (WEIR_LETTERS["A"], WEIR_LETTERS["B"])), 201)["cut"]
    marks_now = ok(mark(priya, vn1, early["id"]), 201)["part"]["marks"]
    assert [m["from_bar"] for m in marks_now] == [WEIR_LETTERS["A"], WEIR_CUT[0]]
    ok(api.delete(f"/api/cuts/{stored['id']}"))
    assert [m["cut_id"] for m in part_of(api, weir["id"], vn1)["marks"]] == [early["id"]]
    refused(mark(priya, vn1, stored["id"]), 404, "not_found")


def test_marks_concurrent(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR], stocked=False)
    weir = works[0]
    stored = ok(cut(api, weir["id"], WEIR_CUT), 201)["cut"]
    vn1 = part_id(weir, "vn1")
    callers = [HESTER, PRIYA, TOMASZ, ROWAN] * 2
    clients = [signin(app_url, e) for e in callers]
    answers = together([lambda c=c: mark(c, vn1, stored["id"]) for c in clients])
    codes = [a.status_code for a in answers]
    assert sorted(codes) == [200] * 7 + [201], codes
    winner = callers[codes.index(201)]
    bodies = [a.json()["part"]["marks"] for a in answers]
    assert all(b == bodies[0] for b in bodies)
    assert bodies[0][0]["marked_by"]["name"] == NAMES[winner]
    part = part_of(api, weir["id"], vn1)
    assert len(part["marks"]) == 1 and part["marks"] == bodies[0]
    assert work(api, weir["id"])["parts_to_mark"] == 13
    later = ok(mark(signin(app_url, HESTER), vn1, stored["id"]), 200)
    assert later["part"]["marks"] == bodies[0]


def test_wf_cut_confirmation_section_desk(app_url: str, browser: Browser) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    with ferry_programme(api) as (prog, ferry):
        first = ok(cut(api, ferry["id"], FERRY_CUT_A), 201)["cut"]
        ok(cut(api, ferry["id"], FERRY_CUT_B), 201)
        vn1 = part_id(ferry, "vn1")
        with app_page(browser, app_url, HESTER, "/section") as page:
            expect(page.get_by_role("heading", level=2, name=FERRY_TITLE, exact=True)).to_be_visible()
            confirm_a = page.get_by_role("button", name=f"Confirm cut {span_text(FERRY_CUT_A)}", exact=True)
            confirm_b = page.get_by_role("button", name=f"Confirm cut {span_text(FERRY_CUT_B)}", exact=True)
            expect(confirm_a).to_be_visible()
            expect(confirm_b).to_be_visible()
            expect(page.get_by_role("button", name=f"Upload bowing master {FERRY_TITLE}", exact=True)).to_be_visible()
            ok(mark(priya, vn1, first["id"]), 201)
            with page.expect_response(lambda r: r.url.endswith(f"/api/parts/{vn1}/marks")) as answer:
                confirm_a.click()
            assert answer.value.status == 200
            expect(status(page, "Section status")).to_have_text(
                f"{label(FERRY_TITLE, 'Violin I')} carries cut {span_text(FERRY_CUT_A)}."
            )
            expect(page.get_by_text(f"Confirmed {span_text(FERRY_CUT_A)} by {NAMES[PRIYA]}", exact=True)).to_be_visible()
            expect(confirm_a).to_have_count(0)
            with page.expect_response(lambda r: r.url.endswith(f"/api/parts/{vn1}/marks")) as answer:
                confirm_b.click()
            assert answer.value.status == 201
            expect(page.get_by_text(f"Confirmed {span_text(FERRY_CUT_B)} by {NAMES[HESTER]}", exact=True)).to_be_visible()
        part = part_of(api, ferry["id"], vn1)
        assert [(m["from_bar"], m["marked_by"]["name"]) for m in part["marks"]] == [
            (FERRY_CUT_A[0], NAMES[PRIYA]),
            (FERRY_CUT_B[0], NAMES[HESTER]),
        ]
        assert part["mark_cut"] is False


def test_wf_cut_confirmation_desk_marks(app_url: str, browser: Browser) -> None:
    api, priya, tomasz = (signin(app_url, e) for e in (ROWAN, PRIYA, TOMASZ))
    prog, works = build(api, [WEIR], stocked=False)
    weir = works[0]
    stored = ok(cut(api, weir["id"], WEIR_CUT), 201)["cut"]
    ok(mark(priya, part_id(weir, "vn1"), stored["id"]), 201)
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS - 1)
        expect(rail_work(page, WEIR_TITLE)).to_contain_text(f"{WEIR_CUT_FLAGS - 1} to mark")
        expect(part_row(page, "Violin I")).to_contain_text(f"{WEIR_SPAN} · {NAMES[PRIYA]}")
        for unflagged in ("Violin I", "Timpani"):
            expect(page.get_by_role("button", name=f"Record marked {unflagged}", exact=True)).to_have_count(0)
        expect(part_row(page, "Viola")).to_contain_text(MARK_CUT)
        with page.expect_response(lambda r: r.url.endswith(f"/api/parts/{part_id(weir, 'va')}/marks")) as answer:
            page.get_by_role("button", name=f"Record marked {'Viola'}", exact=True).click()
        assert answer.value.status == 201
        expect(status(page, "Desk status")).to_have_text(f"{label(WEIR_TITLE, 'Viola')} carries cut {WEIR_SPAN}.")
        expect(part_row(page, "Viola")).to_contain_text(f"{WEIR_SPAN} · {NAMES[ROWAN]}")
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS - 2)
        ok(mark(tomasz, part_id(weir, "vc"), stored["id"]), 201)
        with page.expect_response(lambda r: f"/api/works/{weir['id']}" in r.url or f"/api/programmes/{prog['id']}" in r.url, timeout=ADVANCE_WAIT_MS):
            advance(page, STATUS_CHECK_MS)
        expect(part_row(page, "Cello")).to_contain_text(f"{WEIR_SPAN} · {NAMES[TOMASZ]}")
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS - 3)
    viola = part_of(api, weir["id"], part_id(weir, "va"))
    assert viola["marks"][0]["marked_by"]["name"] == NAMES[ROWAN]
    assert work(api, weir["id"])["parts_to_mark"] == WEIR_CUT_FLAGS - 3


def test_wf_cut_confirmation_flags_clear_first(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR, FEN], prepare=False, stocked=False)
    weir = works[0]
    ok(cut(api, weir["id"], WEIR_CUT), 201)
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        expect(record_buttons(page)).to_have_count(WEIR_CUT_FLAGS)
        page.get_by_role("button", name=f"Restore bars {WEIR_SPAN}", exact=True).click()
        advance(page, SETTLE_MS)
        dialog = page.get_by_role("dialog", name=f"Restore bars {WEIR_SPAN}")
        with page.expect_response(lambda r: r.request.method == "DELETE" and "/api/cuts/" in r.url) as removed:
            dialog.get_by_role("button", name="Restore bars", exact=True).click()
        assert removed.value.status == 200
        samples = splice_samples(page, "38:40", lambda: record_buttons(page).count())
        midpoint = (to_seconds("34:12") + to_seconds("38:40")) / 2
        rising = [flags for seconds, flags in samples if midpoint <= seconds < to_seconds("38:40")]
        assert rising, samples
        assert all(flags == 0 for flags in rising), samples
        expect(record_buttons(page)).to_have_count(0)


def test_scan_upload_api(app_url: str) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = build(api, [WEIR], stocked=False)
    weir = works[0]
    vn1 = part_id(weir, "vn1")
    content = pdf_bytes(token())
    name = f"Marked {token()}.pdf"
    scan = ok(upload(priya, vn1, name, content), 201)["scan"]
    assert scan["kind"] == "marked_part" and scan["file_name"] == name and scan["part_id"] == vn1
    assert scan["content_type"] == "application/pdf" and scan["size_bytes"] == len(content)
    assert scan["sha256"] == hashlib.sha256(content).hexdigest()
    assert scan["object_key"] == f"{scan_prefix(prog, weir, vn1)}{scan['id']}"
    assert scan["uploaded_by"]["name"] == NAMES[PRIYA]
    datetime.fromisoformat(scan["filed_at"])
    store = S3()
    assert store.get(scan["object_key"]) == content
    assert store.keys(scan_prefix(prog, weir, vn1)) == [scan["object_key"]]
    listed = scans(api, vn1)
    assert [s["id"] for s in listed] == [scan["id"]]
    assert all(s["object_key"] in store.keys(scan_prefix(prog, weir, vn1)) for s in listed)
    assert part_of(api, weir["id"], vn1)["latest_marked_scan"]["id"] == scan["id"]
    download = api.get(f"/api/scans/{scan['id']}/file")
    assert download.status_code == 200 and download.content == content
    assert download.headers["content-type"].startswith("application/pdf")
    assert int(download.headers["content-length"]) == len(content)


SCAN_CASES = {
    "pdf": ("application/pdf", "pdf", "plain", "marked_part", 201, None),
    "png": ("image/png", "png", "plain", "marked_part", 201, None),
    "jpeg": ("image/jpeg", "jpeg", "plain", "marked_part", 201, None),
    "at_limit": ("application/pdf", "limit", "plain", "marked_part", 201, None),
    "pdf_type_png_bytes": ("application/pdf", "png", "plain", "marked_part", 415, "unsupported_file_type"),
    "text": ("text/plain", "text", "plain", "marked_part", 415, "unsupported_file_type"),
    "too_large": ("application/pdf", "over", "plain", "marked_part", 413, "file_too_large"),
    "empty": ("application/pdf", "empty", "plain", "marked_part", 422, "validation"),
    "bad_kind": ("application/pdf", "pdf", "plain", "score", 422, "validation"),
    "slash_name": ("application/pdf", "pdf", "slash", "marked_part", 422, "validation"),
    "line_break_name": ("application/pdf", "pdf", "lf", "marked_part", 422, "validation"),
    "long_name": ("application/pdf", "pdf", "long", "marked_part", 422, "validation"),
}


@pytest.mark.parametrize("case", list(SCAN_CASES), ids=list(SCAN_CASES))
def test_scan_type_size(app_url: str, case: str) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = build(api, [ORCHARD], prepare=False, stocked=False)
    orchard = works[0]
    vn1 = part_id(orchard, "vn1")
    content_type, payload, naming, kind, expected, error = SCAN_CASES[case]
    tag = token().encode()
    content = {
        "pdf": pdf_bytes(tag.decode()),
        "png": PNG_SIGNATURE + tag,
        "jpeg": JPEG_SIGNATURE + tag,
        "text": b"plain text " + tag,
        "empty": b"",
        "limit": (pdf_bytes(tag.decode()) + b"0" * SCAN_LIMIT)[:SCAN_LIMIT],
        "over": (pdf_bytes(tag.decode()) + b"0" * SCAN_LIMIT)[: SCAN_LIMIT + 1],
    }[payload]
    name = {"plain": f"{token()}.pdf", "slash": "parts/vn1.pdf", "lf": "line\nbreak.pdf", "long": "é" * (NAME_BYTE_LIMIT // 2 + 1) + ".pdf"}[naming]
    response = upload(priya, vn1, name, content, content_type, kind)
    if expected == 201:
        scan = ok(response, 201)["scan"]
        assert scan["content_type"] == content_type and scan["size_bytes"] == len(content)
        assert S3().get(scan["object_key"]) == content
    else:
        body = refused(response, expected, error)
        if expected == 422:
            assert body["errors"]
    assert len(S3().keys(scan_prefix(prog, orchard, vn1))) == (1 if expected == 201 else 0)
    assert len(scans(api, vn1)) == (1 if expected == 201 else 0)


def test_scan_idempotency(app_url: str) -> None:
    api, priya, tomasz = (signin(app_url, e) for e in (ROWAN, PRIYA, TOMASZ))
    prog, works = build(api, [ORCHARD], prepare=False, stocked=False)
    orchard = works[0]
    vn1 = part_id(orchard, "vn1")
    key = idempotency_key()
    content, name = pdf_bytes(token()), f"{token()}.pdf"
    first = ok(upload(priya, vn1, name, content, key=key), 201)
    replay = ok(upload(priya, vn1, name, content, key=key), 201)
    assert replay == first
    prefix = scan_prefix(prog, orchard, vn1)
    assert len(S3().keys(prefix)) == 1 and len(scans(api, vn1)) == 1
    refused(upload(priya, vn1, name, pdf_bytes(token()), key=key), 409, "idempotency_key_reused")
    refused(upload(priya, vn1, f"{token()}.pdf", content, key=key), 409, "idempotency_key_reused")
    assert len(S3().keys(prefix)) == 1
    other_person = ok(upload(tomasz, vn1, name, content, key=key), 201)
    assert other_person["scan"]["id"] != first["scan"]["id"]
    refused(upload(priya, vn1, name, b"", key=(fresh := idempotency_key())), 422, "validation")
    assert ok(upload(priya, vn1, name, content, key=fresh), 201)["scan"]["id"] != first["scan"]["id"]
    assert len(S3().keys(prefix)) == 3 and len(scans(api, vn1)) == 3


def test_wf_marked_scans_upload(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR], stocked=False)
    weir = works[0]
    vn1 = part_id(weir, "vn1")
    content = pdf_bytes(token())
    with app_page(browser, app_url, PRIYA, desk_path(prog, weir)) as page:
        uploads = page.get_by_role("status", name="Upload status")
        with held(page, f"**/api/parts/{vn1}/scans") as gate:
            choose_file(page, page.get_by_role("button", name=f"Upload scan {'Violin I'}", exact=True), ACCENTED_NAME, content)
            expect(uploads.filter(has_text="Uploading scan").first).to_have_text(f"Uploading scan for {label(WEIR_TITLE, 'Violin I')}")
            expect(page.get_by_role("progressbar", name="Upload progress").first).to_be_visible()
            assert scans(api, vn1) == []
            gate.release()
        expect(uploads.filter(has_text="Scan filed").first).to_have_text(f"Scan filed for {label(WEIR_TITLE, 'Violin I')}.")
        link = page.get_by_role("link", name=f"Download {ACCENTED_NAME}", exact=True)
        expect(link).to_be_visible()
        with page.expect_download() as download:
            link.click()
        assert Path(download.value.path()).read_bytes() == content
    listed = scans(api, vn1)
    assert [s["file_name"] for s in listed] == [ACCENTED_NAME]
    assert S3().get(listed[0]["object_key"]) == content


def test_wf_marked_scans_failure(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR], stocked=False)
    weir = works[0]
    vn2 = part_id(weir, "vn2")
    with app_page(browser, app_url, PRIYA, desk_path(prog, weir)) as page:
        button = page.get_by_role("button", name=f"Upload scan {'Violin II'}", exact=True)
        uploads = page.get_by_role("status", name="Upload status")
        failed = f"Scan not filed for {label(WEIR_TITLE, 'Violin II')}: "
        choose_file(page, button, f"{token()}.txt", b"not a scan", "text/plain")
        expect(uploads.filter(has_text="Scan not filed").first).to_have_text(f"{failed}{REASON_TYPE}.")
        choose_file(page, button, f"{token()}.pdf", b"")
        expect(uploads.filter(has_text="Scan not filed").first).to_have_text(f"{failed}{REASON_EMPTY}.")
        page.route(f"**/api/parts/{vn2}/scans", lambda route: route.abort())
        choose_file(page, button, f"{token()}.pdf", pdf_bytes(token()))
        expect(uploads.filter(has_text="Scan not filed").first).to_have_text(f"{failed}{REASON_UNFINISHED}.")
    assert scans(api, vn2) == []
    assert S3().keys(scan_prefix(prog, weir, vn2)) == []


def test_bowing_master_versions_api(app_url: str) -> None:
    api, priya, hester = (signin(app_url, e) for e in (ROWAN, PRIYA, HESTER))
    prog, works = build(api, [WEIR], stocked=False)
    weir = works[0]
    vn1 = part_id(weir, "vn1")
    v1_bytes, v2_bytes = pdf_bytes(token()), PNG_SIGNATURE + token().encode()
    v1 = ok(upload(hester, vn1, ACCENTED_NAME, v1_bytes, kind="bowing_master"), 201)["scan"]
    assert v1["file_name"] == ACCENTED_NAME and v1["kind"] == "bowing_master"
    v2 = ok(upload(hester, vn1, ACCENTED_NAME, v2_bytes, "image/png", kind="bowing_master"), 201)["scan"]
    assert v2["id"] != v1["id"] and v2["object_key"] != v1["object_key"]
    assert [s["id"] for s in scans(api, vn1)] == [v2["id"], v1["id"]]
    assert part_of(api, weir["id"], vn1)["latest_bowing_master"]["id"] == v2["id"]
    for scan, content, content_type in ((v1, v1_bytes, "application/pdf"), (v2, v2_bytes, "image/png")):
        download = priya.get(f"/api/scans/{scan['id']}/file")
        assert download.status_code == 200 and download.content == content
        assert download.headers["content-type"].startswith(content_type)
        assert int(download.headers["content-length"]) == len(content)
        assert download.headers["content-disposition"] == ACCENTED_DISPOSITION
        assert S3().get(scan["object_key"]) == content
    literal = ok(upload(hester, vn1, PERCENT_NAME, pdf_bytes(token()), kind="bowing_master", raw_name=True), 201)["scan"]
    assert literal["file_name"] == PERCENT_NAME
    refused(upload(hester, vn1, "line%0abreak.pdf", pdf_bytes(token()), kind="bowing_master", raw_name=True), 422, "validation")
    refused(upload(hester, vn1, "line%0Dbreak.pdf", pdf_bytes(token()), kind="bowing_master", raw_name=True), 422, "validation")
    refused(upload(hester, part_id(weir, "vn2"), f"{token()}.pdf", pdf_bytes(token()), kind="bowing_master"), 403, "forbidden")
    refused(upload(priya, vn1, f"{token()}.pdf", pdf_bytes(token()), kind="bowing_master"), 403, "forbidden")
    refused(upload(hester, vn1, f"{token()}.pdf", pdf_bytes(token()), kind="marked_part"), 403, "forbidden")
    assert len(scans(api, vn1)) == 3


def test_wf_bowing_masters_filed(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    names = (f"Bowings {token()}.pdf", f"Bowings {token()} v2.pdf")
    contents = (pdf_bytes(token()), pdf_bytes(token()))
    with ferry_programme(api) as (prog, ferry):
        vn1 = part_id(ferry, "vn1")
        with app_page(browser, app_url, HESTER, "/section") as page:
            button = page.get_by_role("button", name=f"Upload bowing master {FERRY_TITLE}", exact=True)
            state = status(page, f"Bowing master status: {FERRY_TITLE}")
            filed = page.get_by_role("list", name=f"Filed bowing masters: {FERRY_TITLE}")
            expect(button).to_be_visible()
            for name, content in zip(names, contents):
                with held(page, f"**/api/parts/{vn1}/scans") as gate:
                    choose_file(page, button, name, content)
                    expect(state).to_have_text("Uploading")
                    gate.release()
                expect(state).to_have_text("Filed")
                expect(filed.get_by_role("link", name=f"Download {name}", exact=True)).to_be_visible()
            expect(filed.get_by_role("link").first).to_have_accessible_name(f"Download {names[1]}")
            expect(filed.get_by_role("link")).to_have_count(2)
        listed = scans(api, vn1)
        assert [s["file_name"] for s in listed] == [names[1], names[0]]
        assert [S3().get(s["object_key"]) for s in listed] == [contents[1], contents[0]]


def test_wf_bowing_masters_not_filed(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    with ferry_programme(api) as (prog, ferry):
        vn1 = part_id(ferry, "vn1")
        with app_page(browser, app_url, HESTER, "/section") as page:
            button = page.get_by_role("button", name=f"Upload bowing master {FERRY_TITLE}", exact=True)
            state = status(page, f"Bowing master status: {FERRY_TITLE}")
            choose_file(page, button, f"{token()}.pdf", PNG_SIGNATURE + b"mislabelled")
            expect(state).to_contain_text(NOT_FILED)
            expect(state).to_contain_text(reason_line(REASON_TYPE))
            expect(state).not_to_contain_text("Filed")
            page.route(f"**/api/parts/{vn1}/scans", lambda route: route.abort())
            choose_file(page, button, f"{token()}.pdf", pdf_bytes(token()))
            expect(state).to_contain_text(NOT_FILED)
            expect(state).to_contain_text(reason_line(REASON_UNFINISHED))
            expect(state).not_to_contain_text("Filed")
        assert scans(api, vn1) == []
        assert S3().keys(scan_prefix(prog, ferry, vn1)) == []


def blockers_of(api: httpx.Client, programme_id: str) -> list[tuple[str, str]]:
    return [(b["error"], b["message"]) for b in programme(api, programme_id)["publish_blockers"]]


def test_publish_guards_api(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    prog = create_programme(api)
    pid = prog["id"]
    assert blockers_of(api, pid) == [("illegal_transition", BLOCKERS["illegal_transition"]), ("no_works", BLOCKERS["no_works"])]
    assert refused(publish(api, pid), 409, "illegal_transition")["message"] == BLOCKERS["illegal_transition"]
    ok(move(api, pid, "in_preparation"))
    assert blockers_of(api, pid) == [("no_works", BLOCKERS["no_works"])]
    refused(publish(api, pid), 409, "no_works")
    orchard = add_work(api, pid, ORCHARD)
    short = sum(needed_for(k, SEED_COUNT) for k in SECTION_KEYS)
    expected_short = f"Folders can't be published while {short} copies are short."
    assert blockers_of(api, pid) == [("copies_short", expected_short)]
    body = refused(publish(api, pid), 409, "copies_short")
    assert body["message"] == expected_short and body["shortfall"] == short
    stock(api, pid)
    vn1 = part_id(orchard, "vn1")
    ok(hold(api, vn1, needed_for("vn1", SEED_COUNT) - 1))
    assert blockers_of(api, pid) == [("copies_short", ONE_COPY_SHORT)]
    assert refused(publish(api, pid), 409, "copies_short")["shortfall"] == 1
    ok(hold(api, vn1, needed_for("vn1", SEED_COUNT)))
    assert blockers_of(api, pid) == []
    summary = next(p for p in ok(api.get("/api/programmes"))["programmes"] if p["id"] == pid)
    assert summary["publish_blockers"] == []
    for headers in ({}, {"Idempotency-Key": "k" * 81}, {"Idempotency-Key": "has space"}):
        response = api.post(f"/api/programmes/{pid}/publish", headers=headers)
        assert "idempotency_key" in refused(response, 422, "validation")["errors"]
    assert programme(api, pid)["status"] == "in_preparation"
    done = ok(publish(api, pid))
    assert done["programme"]["status"] == "published"
    assert done["notices"]["sent"] + done["notices"]["queued"] == done["programme"]["seated_players"] == sum(SEED_COUNT.values())
    assert blockers_of(api, pid) == [("illegal_transition", BLOCKERS["illegal_transition"])]

    late, _ = build(api, [ORCHARD], first_rehearsal=stamp(-1), performances=[stamp(3)])
    assert blockers_of(api, late["id"]) == [("first_rehearsal_passed", BLOCKERS["first_rehearsal_passed"])]
    refused(publish(api, late["id"]), 409, "first_rehearsal_passed")
    assert programme(api, late["id"])["status"] == "in_preparation"
    old_draft = create_programme(api, first_rehearsal=stamp(-1), performances=[stamp(3)])
    assert [e for e, _ in blockers_of(api, old_draft["id"])] == ["illegal_transition", "first_rehearsal_passed", "no_works"]


def test_publish_emails(app_url: str, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    prog, works = published(api, [ORCHARD])
    subject = f"Your folder is ready: {prog['title']}"
    expected = seated_emails(SEED_COUNT)
    found = wait_mail(mail, lambda m: m.get("Subject") == subject, len(expected))
    assert sorted(r for m in found for r in recipients(m)) == sorted(expected)
    for message in found:
        assert_single_recipient(message)
    yusra = next(m for m in found if recipients(m) == [YUSRA])
    lines = lines_of(yusra)
    assert f"{NAMES[YUSRA]}, your folder for Programme {prog['number']} · {prog['title']} is ready." in lines
    assert f"Chair: {YUSRA_CHAIR}" in lines and "Parts:" in lines
    assert [l for l in lines if " — " in l] == [label(ORCHARD_TITLE, "Violin II")]
    assert f"First rehearsal: {fmt_date_time(prog['first_rehearsal'])} (London time)" in lines
    notices = ok(api.get(f"/api/programmes/{prog['id']}/notices"))["notices"]
    assert {n["email"] for n in notices} == expected
    assert all(n["status"] == "sent" and n["sent_at"] for n in notices)
    assert next(n for n in notices if n["email"] == YUSRA)["chair_label"] == YUSRA_CHAIR
    ok(set_count(api, prog["id"], {**SEED_COUNT, "violin_1": ROSTER["vn1"]}))
    later = wait_mail(mail, lambda m: m.get("Subject") == subject and recipients(m)[0] in (SAOIRSE, BRAM), 2)
    assert sorted(recipients(m)[0] for m in later) == sorted([SAOIRSE, BRAM])
    assert len(ok(api.get(f"/api/programmes/{prog['id']}/notices"))["notices"]) == len(expected) + 2


def test_publish_idempotent_concurrent(app_url: str, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    first, _ = build(api, [ORCHARD])
    second, _ = build(api, [ORCHARD])
    keys = [idempotency_key() for _ in range(5)]
    clients = [signin(app_url, ROWAN) for _ in keys]
    answers = together([lambda c=c, k=k: publish(c, first["id"], k) for c, k in zip(clients, keys)])
    codes = [a.status_code for a in answers]
    assert sorted(codes) == [200] + [409] * 4, codes
    assert all(a.json()["error"] == "illegal_transition" for a in answers if a.status_code == 409)
    winner_key = keys[codes.index(200)]
    stored = answers[codes.index(200)].json()
    seated = sum(SEED_COUNT.values())
    subject = f"Your folder is ready: {first['title']}"
    assert len(wait_mail(mail, lambda m: m.get("Subject") == subject, seated)) == seated
    replay = ok(publish(api, first["id"], winner_key))
    assert replay["notices"] == stored["notices"] and replay["programme"]["id"] == first["id"]
    assert len(wait_mail(mail, lambda m: m.get("Subject") == subject, seated + 1, QUIET_WAIT_S)) == seated
    refused(publish(api, second["id"], winner_key), 409, "idempotency_key_reused")
    assert programme(api, second["id"])["status"] == "in_preparation"
    shared = idempotency_key()
    same = together([lambda c=c: publish(c, second["id"], shared) for c in clients[:4]])
    assert [a.status_code for a in same] == [200] * 4
    assert all(a.json()["notices"] == same[0].json()["notices"] for a in same)
    subject_2 = f"Your folder is ready: {second['title']}"
    assert len(wait_mail(mail, lambda m: m.get("Subject") == subject_2, seated + 1, MAIL_WAIT_S // 4)) == seated


def test_wf_publish_folders_wrong_clock(app_url: str, browser: Browser, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    ready, _ = build(api, [ORCHARD])
    late, _ = build(api, [ORCHARD], first_rehearsal=stamp(-1), performances=[stamp(3)])
    with zoned_page(browser, app_url, ROWAN, desk_path(ready), clock=WRONG_FUTURE) as page:
        page.get_by_role("button", name="Publish folders", exact=True).click()
        dialog = page.get_by_role("dialog", name="Publish folders")
        expect(dialog.get_by_text("Nothing blocks publishing.", exact=True)).to_be_visible()
        expect(dialog.get_by_role("list", name="Publish blockers").get_by_role("listitem")).to_have_count(0)
        expect(dialog).to_contain_text(f"Seated players: {ready['seated_players']}")
        button = dialog.get_by_role("button", name="Publish", exact=True)
        expect(button).to_be_enabled()
        with page.expect_response(
            lambda r: r.request.method == "POST" and r.url.endswith(f"/api/programmes/{ready['id']}/publish")
        ) as answered:
            button.click()
        assert answered.value.request.headers.get("Idempotency-Key".lower())
        counts = answered.value.json()["notices"]
        expect(status(page, "Desk status")).to_have_text(
            f"Folders published. Player notices: {counts['sent']} sent, {counts['queued']} queued."
        )
        assert programme(api, ready["id"])["status"] == "published"
        seated = sum(SEED_COUNT.values())
        assert len(wait_mail(mail, lambda m: m.get("Subject") == f"Your folder is ready: {ready['title']}", seated)) == seated
        page.reload()
        page.get_by_role("link", name="Player notices").click()
        table = page.get_by_role("dialog", name="Player notices").get_by_role("table", name="Player notices")
        expect(table.get_by_role("cell", name="Sent", exact=True)).to_have_count(seated)
        page.clock.set_system_time(WRONG_PAST)
        page.goto(app_url + desk_path(late))
        page.get_by_role("button", name="Publish folders", exact=True).click()
        dialog = page.get_by_role("dialog", name="Publish folders")
        items = dialog.get_by_role("list", name="Publish blockers").get_by_role("listitem")
        expect(items).to_have_count(1)
        expect(items).to_have_text(BLOCKERS["first_rehearsal_passed"])
        expect(dialog.get_by_role("button", name="Publish", exact=True)).to_be_disabled()
    assert programme(api, late["id"])["status"] == "in_preparation"


def test_wf_publish_folders_mail_down(browser: Browser, mail: Mailpit) -> None:
    base = os.environ["APP_MAIL_DOWN_URL"]
    api = signin(base, ROWAN)
    prog, _ = build(api, [ORCHARD])
    seated = sum(SEED_COUNT.values())
    with app_page(browser, base, ROWAN, desk_path(prog)) as page:
        expect(page.get_by_role("alert").filter(has_text=MAIL_BANNER)).to_have_text(MAIL_BANNER)
        page.get_by_role("button", name="Publish folders", exact=True).click()
        page.get_by_role("dialog", name="Publish folders").get_by_role("button", name="Publish", exact=True).click()
        expect(status(page, "Desk status")).to_have_text(f"Folders published. Player notices: 0 sent, {seated} queued.")
        page.reload()
        page.get_by_role("link", name="Player notices").click()
        table = page.get_by_role("dialog", name="Player notices").get_by_role("table", name="Player notices")
        expect(table.get_by_role("cell", name="Queued", exact=True)).to_have_count(seated)
    assert programme(api, prog["id"])["status"] == "published"
    notices = ok(api.get(f"/api/programmes/{prog['id']}/notices"))["notices"]
    assert len(notices) == seated and all(n["status"] == "queued" and n["sent_at"] is None for n in notices)
    assert ok(api.get("/api/status"))["mail"] == "down"
    subject = f"Your folder is ready: {prog['title']}"
    assert wait_mail(mail, lambda m: m.get("Subject") == subject, 1, QUIET_WAIT_S) == []


def test_folder_scope_api(app_url: str, browser: Browser) -> None:
    api, priya, odile, yusra, harpist = (signin(app_url, e) for e in (ROWAN, PRIYA, ODILE, YUSRA, HARPIST))
    prog, works = published(api, [ORCHARD])
    draft, draft_works = build(api, [ORCHARD], prepare=False, stocked=False)
    orchard = works[0]
    vn1, vn2 = part_id(orchard, "vn1"), part_id(orchard, "vn2")
    own_bytes = pdf_bytes(token())
    own = ok(upload(priya, vn2, f"{token()}.pdf", own_bytes), 201)["scan"]
    other = ok(upload(priya, vn1, f"{token()}.pdf", pdf_bytes(token())), 201)["scan"]
    bowing = ok(upload(odile, vn2, f"{token()}.pdf", pdf_bytes(token()), kind="bowing_master"), 201)["scan"]
    entry = next(f for f in ok(yusra.get("/api/folders"))["folders"] if f["programme_id"] == prog["id"])
    assert entry["chair_label"] == "Violin II · chair 03" and entry["part_count"] == 1
    assert entry["number"] == prog["number"] and entry["title"] == prog["title"] and entry["status"] == "published"
    folder = ok(yusra.get(f"/api/folders/{prog['id']}"))
    assert [p["part_id"] for p in folder["pages"]] == [vn2] and folder["scans_available"] is True
    assert folder["pages"][0]["marked_scan"]["id"] == own["id"]
    assert ok(yusra.get(f"/api/folders/{prog['id']}/parts/{vn2}"))["part_name"] == "Violin II"
    refused(yusra.get(f"/api/folders/{prog['id']}/parts/{vn1}"), 404, "not_found")
    download = yusra.get(f"/api/scans/{own['id']}/file")
    assert download.status_code == 200 and download.content == own_bytes
    refused(yusra.get(f"/api/scans/{other['id']}/file"), 404, "not_found")
    refused(yusra.get(f"/api/scans/{bowing['id']}/file"), 404, "not_found")
    for hidden in (draft["id"], "p03", "p04"):
        refused(yusra.get(f"/api/folders/{hidden}"), 404, "not_found")
    refused(yusra.get(f"/api/folders/{draft['id']}/parts/{part_id(draft_works[0], 'vn2')}"), 404, "not_found")
    assert all(f["programme_id"] != prog["id"] for f in ok(harpist.get("/api/folders"))["folders"])
    refused(harpist.get(f"/api/folders/{prog['id']}"), 404, "not_found")
    with app_page(browser, app_url, YUSRA, f"/folder/{prog['id']}/{vn1}", size=PHONE) as page:
        expect(page.get_by_role("heading", level=1, name=NOT_IN_FOLDER)).to_be_visible()
        expect(page.get_by_role("region", name="Folder pages")).to_have_count(0)
        expect(status(page, "Page position")).to_have_count(0)
        page.goto(app_url + f"/folder/{draft['id']}")
        expect(page.get_by_role("heading", level=1, name=NOT_IN_FOLDER)).to_be_visible()


def test_seating_changes(app_url: str, mail: Mailpit) -> None:
    mail.clear()
    api, priya, saoirse = signin(app_url, ROWAN), signin(app_url, PRIYA), signin(app_url, SAOIRSE)
    prog, works = published(api, [ORCHARD])
    orchard = works[0]
    vn1 = part_id(orchard, "vn1")
    refused(saoirse.get(f"/api/folders/{prog['id']}"), 404, "not_found")
    raised = {**SEED_COUNT, "violin_1": ROSTER["vn1"]}
    ok(set_count(api, prog["id"], raised))
    assert ok(saoirse.get(f"/api/folders/{prog['id']}"))["pages"][0]["part_id"] == vn1
    content = pdf_bytes(token())
    scan = ok(upload(priya, vn1, f"{token()}.pdf", content), 201)["scan"]
    assert saoirse.get(f"/api/scans/{scan['id']}/file").content == content
    ok(set_count(api, prog["id"], SEED_COUNT))
    assert all(f["programme_id"] != prog["id"] for f in ok(saoirse.get("/api/folders"))["folders"])
    refused(saoirse.get(f"/api/folders/{prog['id']}"), 404, "not_found")
    refused(saoirse.get(f"/api/folders/{prog['id']}/parts/{vn1}"), 404, "not_found")
    refused(saoirse.get(f"/api/scans/{scan['id']}/file"), 404, "not_found")
    ok(set_count(api, prog["id"], raised))
    ok(saoirse.get(f"/api/folders/{prog['id']}/parts/{vn1}"))
    assert any(n["email"] == SAOIRSE for n in ok(api.get(f"/api/programmes/{prog['id']}/notices"))["notices"])
    subject = f"Your folder is ready: {prog['title']}"
    mine = wait_mail(mail, lambda m: m.get("Subject") == subject and recipients(m) == [SAOIRSE], 2, SWEEP_WAIT_S)
    assert len(mine) == 1


def test_wf_player_folder_phone(app_url: str, browser: Browser) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = build(api, [LANTERN, ORCHARD])
    lantern, orchard = works
    ok(cut(api, lantern["id"], LANTERN_CUT), 201)
    ok(publish(api, prog["id"]))
    content = pdf_bytes(token())
    ok(upload(priya, part_id(lantern, "vn2"), f"{token()}.pdf", content), 201)
    reads = lambda r: f"/api/folders/{prog['id']}/parts/" in r.url
    with app_page(browser, app_url, YUSRA, "/folder", size=PHONE) as page:
        page.get_by_role("list", name="Your folders").get_by_role("link", name=f"Programme {prog['number']} · {prog['title']}").click()
        pages = page.get_by_role("region", name="Folder pages")
        position = status(page, "Page position")
        expect(position).to_have_text(page_of(1, 2))
        advance(page, SETTLE_MS)
        first = pages.get_by_role("group", name=label(LANTERN_TITLE, "Violin II"))
        second = pages.get_by_role("group", name=label(ORCHARD_TITLE, "Violin II"))
        assert on_screen(first, PHONE[0]) and not on_screen(second, PHONE[0])
        expect(first).to_contain_text(span_text(LANTERN_CUT))
        layout(page)
        with page.expect_request(reads):
            page.get_by_role("button", name="Next part", exact=True).click()
        advance(page, SETTLE_MS)
        expect(position).to_have_text(page_of(2, 2))
        expect(page).to_have_url(re.compile(re.escape(f"/folder/{prog['id']}/{part_id(orchard, 'vn2')}") + "$"))
        assert on_screen(second, PHONE[0]) and not on_screen(first, PHONE[0])
        expect(second).to_contain_text(NO_SCAN)
        page.get_by_role("button", name="Previous part", exact=True).focus()
        with page.expect_request(reads):
            page.keyboard.press("ArrowLeft")
        advance(page, SETTLE_MS)
        expect(position).to_have_text(page_of(1, 2))
        with page.expect_request(reads):
            swipe(page, pages, -PHONE[0] / 2)
        advance(page, SETTLE_MS)
        expect(position).to_have_text(page_of(2, 2))
        with page.expect_request(reads):
            swipe(page, pages, PHONE[0] / 2)
        advance(page, SETTLE_MS)
        expect(position).to_have_text(page_of(1, 2))
        with page.expect_request(reads, timeout=ADVANCE_WAIT_MS):
            advance(page, STATUS_CHECK_MS)
        with page.expect_request(reads):
            tab_return(page)
        with page.expect_download() as download:
            first.get_by_role("link", name="Open marked part").click()
        assert Path(download.value.path()).read_bytes() == content


def test_wf_player_folder_targets(app_url: str, browser: Browser) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = build(api, [LANTERN, ORCHARD], title=f"Ode {token()[:4]}")
    ok(publish(api, prog["id"]))
    ok(upload(priya, part_id(works[0], "vn2"), f"{token()}.pdf", pdf_bytes(token())), 201)
    with app_page(browser, app_url, YUSRA, "/folder", size=PHONE) as page:
        folder_link = page.get_by_role("list", name="Your folders").get_by_role(
            "link", name=f"Programme {prog['number']} · {prog['title']}", exact=True
        )
        folders_nav = page.get_by_role("navigation", name="Library").get_by_role("link", name="Folders", exact=True)
        expect(folder_link).to_be_visible()
        for control in (folder_link, folders_nav):
            assert hit_target(control), f"{control} is smaller than 44 by 44 (L314)"
        folder_link.click()
        expect(status(page, "Page position")).to_have_text(page_of(1, 2))
        advance(page, SETTLE_MS)
        for control in (
            page.get_by_role("button", name="Next part", exact=True),
            page.get_by_role("link", name="Open marked part", exact=True),
        ):
            assert hit_target(control), f"{control} is smaller than 44 by 44 (L314)"


def test_wf_player_folder_unseated(app_url: str, browser: Browser, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    raised = {**SEED_COUNT, "violin_1": ROSTER["vn1"]}
    prog, _ = published(api, [ORCHARD], string_count=raised)
    with app_page(browser, app_url, SAOIRSE, f"/folder/{prog['id']}", size=PHONE) as page:
        expect(status(page, "Page position")).to_have_text(page_of(1, 1))
        ok(set_count(api, prog["id"], SEED_COUNT))
        advance(page, STATUS_CHECK_MS)
        expect(page.get_by_role("heading", level=1, name=NOT_IN_FOLDER)).to_be_visible()
        expect(page.get_by_role("region", name="Folder pages")).to_have_count(0)
        expect(status(page, "Page position")).to_have_count(0)
        ok(set_count(api, prog["id"], raised))
        page.reload()
        expect(status(page, "Page position")).to_have_text(page_of(1, 1))
    subject = f"Your folder is ready: {prog['title']}"
    assert len(wait_mail(mail, lambda m: m.get("Subject") == subject and recipients(m) == [SAOIRSE], 2, QUIET_WAIT_S)) == 1


def test_wf_player_folder_states(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [LANTERN, ORCHARD])
    ok(cut(api, works[0]["id"], LANTERN_CUT), 201)
    ok(publish(api, prog["id"]))

    with app_page(browser, app_url, YUSRA, f"/folder/{prog['id']}", size=PHONE, reduced_motion="reduce") as page:
        pages = page.get_by_role("region", name="Folder pages")
        position = status(page, "Page position")
        expect(position).to_have_text(page_of(1, 2))
        first = pages.get_by_role("group", name=label(LANTERN_TITLE, "Violin II"))
        second = pages.get_by_role("group", name=label(ORCHARD_TITLE, "Violin II"))
        expect(first).to_contain_text(span_text(LANTERN_CUT))
        expect(first).to_contain_text(NO_SCAN)
        page.get_by_role("button", name="Next part", exact=True).click()
        expect(position).to_have_text(page_of(2, 2))
        assert on_screen(second, PHONE[0]) and not on_screen(first, PHONE[0])
        assert animations(pages) == []
        expect(second).to_contain_text(NO_SCAN)
    assert ok(signin(app_url, YUSRA).get(f"/api/folders/{prog['id']}"))["pages"][0]["cuts"] == [
        {"from_bar": LANTERN_CUT[0], "to_bar": LANTERN_CUT[1]}
    ]


def test_wf_player_folder_empty(app_url: str, browser: Browser) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = published(api, [LANTERN, ORCHARD])
    ok(upload(priya, part_id(works[0], "vn2"), f"{token()}.pdf", pdf_bytes(token())), 201)
    folder_link = f"Programme {prog['number']} · {prog['title']}"
    with app_page(browser, app_url, HARPIST, "/folder", size=PHONE) as page:
        expect(page.get_by_text(NO_FOLDERS, exact=True)).to_be_visible()
        expect(page.get_by_role("link", name=folder_link)).to_have_count(0)
    lantern_page, orchard_page = label(LANTERN_TITLE, "Violin II"), label(ORCHARD_TITLE, "Violin II")
    with app_page(browser, app_url, YUSRA, f"/folder/{prog['id']}", size=PHONE) as page:
        pages = page.get_by_role("region", name="Folder pages")
        first = pages.get_by_role("group", name=lantern_page)
        second = pages.get_by_role("group", name=orchard_page)
        expect(first.get_by_role("link", name="Open marked part")).to_be_visible()
        page.get_by_role("button", name="Next part", exact=True).click()
        advance(page, SETTLE_MS)
        expect(second).to_contain_text(NO_SCAN)
        expect(second.get_by_role("link", name="Open marked part")).to_have_count(0)
    with app_page(browser, app_url, YUSRA, "/folder", size=PHONE) as page:
        fake_storage_down(page)
        page.goto(app_url + f"/folder/{prog['id']}")
        pages = page.get_by_role("region", name="Folder pages")
        first = pages.get_by_role("group", name=lantern_page)
        second = pages.get_by_role("group", name=orchard_page)
        expect(first).to_contain_text(SCAN_UNAVAILABLE)
        expect(page.get_by_role("link", name="Open marked part")).to_have_count(0)
        page.get_by_role("button", name="Next part", exact=True).click()
        advance(page, SETTLE_MS)
        expect(second).to_contain_text(SCAN_UNAVAILABLE)
        expect(second).not_to_contain_text(NO_SCAN)


def test_rental_lifecycle_api(app_url: str) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = build(api, [ORCHARD, FEN], prepare=False, stocked=False)
    orchard, fen = works
    publisher = f"Hire {token()}"
    created = ok(rental(api, orchard, publisher), 201)
    sid = created["id"]
    assert created["status"] == "requested" and created["display_status"] == "Requested" and created["overdue"] is False
    assert created["publisher"] == publisher and created["work_title"] == "Orchard Serenade"
    assert [l["part_name"] for l in created["slip"]] == list(SECTION_NAMES.values())
    assert created["copies_on_slip"] == 17 and created["copies_checked_in"] == 0 and created["copies_missing"] == 17
    assert created["returned_at"] is None
    refused(rental(api, orchard, publisher), 409, "rental_set_open")
    for bad_slip in ({}, {"vn1": 0}, {"vn1": 100}):
        refused(rental(api, fen, publisher, bad_slip), 422, "validation")
    duplicate = {"work_id": fen["id"], "publisher": publisher, "slip": [{"part_id": part_id(fen, "vn1"), "copies": 1}] * 2}
    refused(api.post("/api/rental-sets", json=duplicate), 422, "validation")
    foreign = {"work_id": fen["id"], "publisher": publisher, "slip": [{"part_id": part_id(orchard, "vn1"), "copies": 1}]}
    refused(api.post("/api/rental-sets", json=foreign), 404, "not_found")

    def stuck(current: str, *targets: str) -> None:
        for target in targets:
            refused(rental_move(api, sid, target), 409, "illegal_transition")
            assert rental_by_id(api, sid)["status"] == current

    stuck("requested", "in_use", "returned", "checked_in")
    refused(rental_move(priya, sid, "received"), 403, "forbidden")
    refused(rental_move(api, sid, "lost"), 422, "validation")
    assert ok(rental_move(api, sid, "received"))["status"] == "received"
    stuck("received", "received", "returned", "checked_in")
    assert ok(rental_move(api, sid, "in_use"))["display_status"] == "In use"
    stuck("in_use", "received", "checked_in")
    refused(rental_move(priya, sid, "returned"), 409, "copies_missing")
    ok(check_in(priya, sid, [{"part_id": l["part_id"], "copies": l["copies"], "expected": 0} for l in created["slip"]]))
    returned = ok(rental_move(priya, sid, "returned"))
    assert returned["status"] == "returned" and returned["returned_at"] and returned["returned_late"] is False
    stuck("returned", "in_use", "returned")
    refused(rental_move(priya, sid, "checked_in"), 403, "forbidden")
    assert ok(rental_move(api, sid, "checked_in"))["display_status"] == "Checked in"
    stuck("checked_in", "received", "in_use", "returned", "checked_in")
    assert ok(rental(api, orchard, publisher), 201)["id"] != sid


def test_rental_due_dates(app_url: str) -> None:
    api = signin(app_url, ROWAN)
    dst, dst_works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=DST_FIRST_REHEARSAL, performances=[DST_PERFORMANCE])
    dst_set = ok(rental(api, dst_works[0], f"Due {token()}"), 201)
    assert dst_set["final_performance_date"] == DST_FINAL_DATE
    assert dst_set["due_date"] == DST_DUE_DATE and dst_set["due_at"] == DST_DUE_AT
    past, past_works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=stamp(-31), performances=[stamp(-30)])
    late = ok(rental(api, past_works[0], f"Late {token()}"), 201)
    assert date.fromisoformat(late["due_date"]) == date.fromisoformat(late["final_performance_date"]) + timedelta(days=14)
    assert late["overdue"] is True and late["display_status"] == "Overdue"
    ok(rental_move(api, late["id"], "received"))
    assert rental_by_id(api, late["id"])["display_status"] == "Overdue"
    ok(rental_move(api, late["id"], "in_use"))
    assert rental_by_id(api, late["id"])["overdue"] is True
    ok(check_in(api, late["id"], [{"part_id": l["part_id"], "copies": l["copies"], "expected": 0} for l in late["slip"]]))
    done = ok(rental_move(api, late["id"], "returned"))
    assert done["overdue"] is False and done["display_status"] == "Returned" and done["returned_late"] is True
    future, future_works = build(api, [ORCHARD], prepare=False, stocked=False)
    upcoming = ok(rental(api, future_works[0], f"Soon {token()}"), 201)
    assert upcoming["overdue"] is False and upcoming["display_status"] == "Requested"
    assert date.fromisoformat(upcoming["due_date"]) == date.fromisoformat(upcoming["final_performance_date"]) + timedelta(days=14)
    assert datetime.fromisoformat(upcoming["due_at"]).strftime("%H:%M") == "23:59"


def test_checkin_api(app_url: str) -> None:
    api, priya, tomasz = (signin(app_url, e) for e in (ROWAN, PRIYA, TOMASZ))
    prog, works = build(api, [ORCHARD], prepare=False, stocked=False)
    orchard = works[0]
    created = ok(rental(api, orchard, f"Count {token()}"), 201)
    sid = created["id"]
    ids = {k: part_id(orchard, k) for k in SECTION_KEYS}
    refused(check_in(priya, sid, [{"part_id": ids["vn1"], "copies": 1, "expected": 0}]), 409, "wrong_status")
    in_use(api, sid)
    first_counts = {"vn1": 5, "vn2": 4, "va": 1, "vc": 2, "cb": 2}
    clients = [signin(app_url, e) for e in (PRIYA, PRIYA, PRIYA, TOMASZ, TOMASZ)]
    answers = together([
        lambda c=c, k=k: check_in(c, sid, [{"part_id": ids[k], "copies": first_counts[k], "expected": 0}])
        for c, k in zip(clients, first_counts)
    ])
    assert [a.status_code for a in answers] == [200] * 5
    stored = {l["part_id"]: l["checked_in"] for l in rental_by_id(api, sid)["slip"]}
    assert stored == {ids[k]: v for k, v in first_counts.items()}
    stale = refused(check_in(priya, sid, [{"part_id": ids["va"], "copies": 3, "expected": 0}, {"part_id": ids["cb"], "copies": 1, "expected": 2}]), 409, "count_changed")
    assert stale["message"] == "Counts changed while you were typing."
    assert stale["lines"] == [{"part_id": ids["va"], "part_name": "Viola", "checked_in": 1}]
    assert next(l for l in rental_by_id(api, sid)["slip"] if l["part_id"] == ids["cb"])["checked_in"] == 2
    two = refused(check_in(priya, sid, [{"part_id": ids["vc"], "copies": 3, "expected": 0}, {"part_id": ids["va"], "copies": 3, "expected": 0}]), 409, "count_changed")
    assert [l["part_name"] for l in two["lines"]] == ["Viola", "Cello"]
    refused(check_in(priya, sid, [{"part_id": ids["va"], "copies": 9, "expected": 0}]), 409, "count_changed")
    for counts in (
        [{"part_id": ids["va"], "copies": 4, "expected": 1}],
        [{"part_id": ids["va"], "copies": -1, "expected": 1}],
        [{"part_id": ids["va"], "copies": 2}],
        [{"part_id": ids["va"], "copies": "2", "expected": 1}],
    ):
        body = refused(check_in(priya, sid, counts), 422, "validation")
        assert body["errors"]["counts"] == "Returned copies must be from 0 to the slip count."
    refused(check_in(priya, sid, [{"part_id": UNKNOWN_ID, "copies": 1, "expected": 0}]), 404, "not_found")
    assert {l["part_id"]: l["checked_in"] for l in rental_by_id(api, sid)["slip"]} == stored
    missing = refused(rental_move(priya, sid, "returned"), 409, "copies_missing")
    assert [(m["part_name"], m["missing"]) for m in missing["missing"]] == [("Viola", 2), ("Cello", 1)]
    assert rental_by_id(api, sid)["status"] == "in_use"
    ok(check_in(priya, sid, [{"part_id": ids["va"], "copies": 3, "expected": 1}, {"part_id": ids["vc"], "copies": 3, "expected": 2}]))
    returners = [signin(app_url, e) for e in (PRIYA, TOMASZ, ROWAN, PRIYA, TOMASZ)]
    moves = together([lambda c=c: rental_move(c, sid, "returned") for c in returners])
    assert sorted(m.status_code for m in moves) == [200] + [409] * 4
    assert all(m.json()["error"] == "illegal_transition" for m in moves if m.status_code == 409)
    final = rental_by_id(api, sid)
    assert final["status"] == "returned" and final["copies_missing"] == 0
    refused(check_in(priya, sid, [{"part_id": ids["va"], "copies": 2, "expected": 3}]), 409, "wrong_status")


def test_wf_rental_sets_checkin_dialog(app_url: str, browser: Browser) -> None:
    api, tomasz = signin(app_url, ROWAN), signin(app_url, TOMASZ)
    prog, works = build(api, [WEIR], prepare=False, stocked=False)
    weir = works[0]
    publisher = f"Slip {token()}"
    created = ok(rental(api, weir, publisher), 201)
    in_use(api, created["id"])
    vn1, vn2 = part_id(weir, "vn1"), part_id(weir, "vn2")
    slip_total = sum(ORCHARD_SLIP.values())
    sets_read = lambda r: r.request.method == "GET" and urlparse(r.url).path == "/api/rental-sets"
    with app_page(browser, app_url, PRIYA, "/rentals") as page:
        row = page.get_by_role("table", name="Rental sets").get_by_role("row").filter(has_text=publisher)
        expect(row).to_contain_text(f"{0} of {slip_total}")
        row.get_by_role("button", name=f"Check in {WEIR_TITLE}", exact=True).click()
        advance(page, SETTLE_MS)
        dialog = page.get_by_role("dialog", name=f"Check in {WEIR_TITLE}")

        def returned(part_name: str) -> Locator:
            return dialog.get_by_role("spinbutton", name=f"Returned {part_name}", exact=True)

        violin_1 = returned("Violin I")
        violin_2 = returned("Violin II")
        viola = returned("Viola")
        expect(violin_1).to_have_value("0")
        violin_1.fill("3")
        viola.focus()
        ok(check_in(tomasz, created["id"], [{"part_id": vn2, "copies": 4, "expected": 0}, {"part_id": vn1, "copies": 2, "expected": 0}]))
        with page.expect_response(sets_read, timeout=ADVANCE_WAIT_MS):
            advance(page, RENTALS_RELOAD_MS)
        with page.expect_response(sets_read):
            tab_return(page)
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        expect(violin_1).to_have_value("3")
        expect(viola).to_be_focused()
        expect(violin_2).to_have_value("4")
        save = dialog.get_by_role("button", name="Save counts", exact=True)
        with page.expect_request(lambda r: r.method == "PUT" and r.url.endswith("/check-in")) as sent:
            save.click()
        counts = json.loads(sent.value.post_data or "{}")["counts"]
        assert [(c["part_id"], c["copies"], c["expected"]) for c in counts] == [(vn1, 3, 0)]
        expect(status(page, "Rental status")).to_have_text(f"Counts changed while you were typing: Violin I is now {2}.")
        expect(violin_1).to_have_value("2")
        expect(dialog).to_be_visible()
        violin_1.fill("5")
        with page.expect_request(lambda r: r.method == "PUT" and r.url.endswith("/check-in")) as sent:
            save.click()
        assert [(c["part_id"], c["copies"], c["expected"]) for c in json.loads(sent.value.post_data or "{}")["counts"]] == [(vn1, 5, 2)]
        saved_copy = f"Check-in counts saved for {WEIR_TITLE}."
        expect(status(page, "Rental status")).to_have_text(saved_copy)
        dialog.get_by_role("button", name="Mark returned", exact=True).click()
        short_lines = {"va": "Viola", "vc": "Cello", "cb": "Bass"}
        missing = sum(ORCHARD_SLIP[k] for k in short_lines)
        listed = ", ".join(f"{name} {ORCHARD_SLIP[k]}" for k, name in short_lines.items())
        expect(status(page, "Rental status")).to_have_text(f"Can't mark returned: {missing} copies missing ({listed}).")
        expect(dialog).to_be_visible()
        for k, name in short_lines.items():
            returned(name).fill(str(ORCHARD_SLIP[k]))
        save.click()
        expect(status(page, "Rental status")).to_have_text(saved_copy)
        dialog.get_by_role("button", name="Mark returned", exact=True).click()
        expect(status(page, "Rental status")).to_have_text(f"{WEIR_TITLE} set is now Returned.")
        if dialog.is_visible():
            dialog.get_by_role("button", name="Close", exact=True).click()
            advance(page, SETTLE_MS)
        expect(row).to_contain_text(f"{slip_total} of {slip_total}")
    final = rental_by_id(api, created["id"])
    assert final["status"] == "returned" and final["copies_checked_in"] == slip_total


def test_wf_rental_sets_checkin_dialog_keys(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    prog, works = build(api, [WEIR], prepare=False, stocked=False)
    weir = works[0]
    publisher = f"Keys {token()}"
    created = ok(rental(api, weir, publisher), 201)
    in_use(api, created["id"])
    sets_read = lambda r: r.request.method == "GET" and urlparse(r.url).path == "/api/rental-sets"
    with app_page(browser, app_url, PRIYA, "/rentals") as page:
        row = page.get_by_role("table", name="Rental sets").get_by_role("row").filter(has_text=publisher)
        opener = row.get_by_role("button", name=f"Check in {WEIR_TITLE}", exact=True)
        dialog = page.get_by_role("dialog", name=f"Check in {WEIR_TITLE}")
        opener.focus()
        page.keyboard.press("Enter")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_visible()
        first = dialog.get_by_role("spinbutton", name="Returned Violin I", exact=True)
        first.focus()
        with page.expect_response(sets_read, timeout=ADVANCE_WAIT_MS):
            advance(page, RENTALS_RELOAD_MS)
        expect(first).to_be_focused()
        point = dialog.evaluate(PLAIN_POINT_JS)
        assert point, "no plain text inside the dialog to click"
        page.mouse.click(point["x"], point["y"])
        for _ in range(3):
            page.keyboard.press("Shift+Tab")
            assert dialog.evaluate(FOCUS_KEPT_JS), "focus reached the page behind the dialog (L259)"
        page.mouse.click(point["x"], point["y"])
        page.keyboard.press("Escape")
        advance(page, SETTLE_MS)
        expect(dialog).to_be_hidden()
        expect(opener).to_be_focused()


def test_wf_rental_sets_overdue_zone(app_url: str, browser: Browser) -> None:
    api = signin(app_url, ROWAN)
    dst, dst_works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=DST_FIRST_REHEARSAL, performances=[DST_PERFORMANCE])
    past, past_works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=stamp(-31), performances=[stamp(-30)])
    future, future_works = build(api, [ORCHARD], prepare=False, stocked=False)
    names = {key: f"{key} {token()}" for key in ("dst", "late", "soon")}
    ok(rental(api, dst_works[0], names["dst"]), 201)
    late = ok(rental(api, past_works[0], names["late"]), 201)
    soon = ok(rental(api, future_works[0], names["soon"]), 201)
    with zoned_page(browser, app_url, PRIYA, "/rentals", clock=WRONG_PAST) as page:
        rows = page.get_by_role("table", name="Rental sets").get_by_role("row")
        expect(rows.filter(has_text=names["dst"])).to_contain_text(DST_DUE_LABEL)
        expect(rows.filter(has_text=names["late"])).to_contain_text("Overdue")
        soon_row = rows.filter(has_text=names["soon"])
        expect(soon_row).to_contain_text("Requested")
        expect(soon_row).not_to_contain_text("Overdue")
    assert rental_by_id(api, late["id"])["overdue"] is True
    assert rental_by_id(api, soon["id"])["overdue"] is False


def test_reminder_emails(app_url: str, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    due_prog, due_works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=stamp(-11), performances=[stamp(-10)])
    publisher = f"Calder Hire {token()}"
    created = ok(rental(api, due_works[0], publisher), 201)
    subject = f"Rental return due {fmt_date(date.fromisoformat(created['due_date']))}: Orchard Serenade · {publisher}"
    found = wait_mail(mail, lambda m: m.get("Subject") == subject, 2)
    assert sorted(recipients(m)[0] for m in found) == sorted([PRIYA, TOMASZ])
    for message in found:
        assert_single_recipient(message)
        lines = lines_of(message)
        assert f"Publisher: {publisher}" in lines
        assert f"Programme {due_prog['number']} · {due_prog['title']}" in lines
        assert f"Copies on slip: {sum(ORCHARD_SLIP.values())}" in lines
        assert created["copies_checked_in"] == 0 and f"Copies checked in: {created['copies_checked_in']}" in lines
        assert f"Due: {fmt_date(date.fromisoformat(created['due_date']))} at 23:59 (London time)" in lines
    future_prog, future_works = build(api, [ORCHARD], prepare=False, stocked=False)
    later_publisher = f"Later Hire {token()}"
    later = ok(rental(api, future_works[0], later_publisher), 201)
    after_sweep = wait_mail(mail, lambda m: publisher in (m.get("Subject") or "") or later_publisher in (m.get("Subject") or ""), 3, SWEEP_WAIT_S)
    assert len(after_sweep) == 2
    reminder = rental_by_id(api, created["id"])["reminder"]
    assert reminder["status"] == "sent" and reminder["sent_at"]
    assert rental_by_id(api, later["id"])["reminder"]["status"] == "none"

    down = os.environ["APP_MAIL_DOWN_URL"]
    down_api = signin(down, ROWAN)
    _, down_works = build(down_api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=stamp(-11), performances=[stamp(-10)])
    queued_publisher = f"Queued Hire {token()}"
    queued = ok(rental(down_api, down_works[0], queued_publisher), 201)
    deadline = time.monotonic() + SWEEP_WAIT_S
    while rental_by_id(down_api, queued["id"])["reminder"]["status"] != "queued" and time.monotonic() < deadline:
        wait_status(down, "mail", "down")
    assert rental_by_id(down_api, queued["id"])["reminder"] == {"status": "queued", "sent_at": None}
    assert wait_mail(mail, lambda m: queued_publisher in (m.get("Subject") or ""), 1, QUIET_WAIT_S) == []


def test_one_line_text(app_url: str, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    prog, works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=stamp(-11), performances=[stamp(-10)])
    marker = token()
    one_line = "Publisher must be one line of text."
    length = "Publisher must be 1 to 120 characters."
    for publisher, message in (
        (f"Hartwell {marker}\nRye", one_line),
        (f"Hartwell {marker}\rRye", one_line),
        (f"Hartwell {marker}\tRye", one_line),
        (f"Hartwell {marker}\x7fRye", one_line),
        (f"Hartwell {marker}\x00Rye", one_line),
        ("x" * 130 + "\n" + marker, one_line),
        ("", length),
        ("   ", length),
        (marker + "x" * 121, length),
    ):
        assert refused(rental(api, works[0], publisher), 422, "validation")["errors"]["publisher"] == message
    for title in (f"Rivers\n{marker}", f"Rivers\t{marker}"):
        body = {"title": title, "first_rehearsal": stamp(40), "performances": [stamp(44)], "string_count": SEED_COUNT}
        assert refused(api.post("/api/programmes", json=body), 422, "validation")["errors"]["title"] == "Title must be one line of text."
    assert not any(marker in s["publisher"] for s in rental_sets(api))
    assert not any(marker in p["title"] for p in ok(api.get("/api/programmes"))["programmes"])
    trimmed = ok(rental(api, works[0], f"  {ACCENTED_PUBLISHER} {marker}  "), 201)
    assert trimmed["publisher"] == f"{ACCENTED_PUBLISHER} {marker}"
    found = wait_mail(mail, lambda m: marker in (m.get("Subject") or ""), 2)
    assert len(found) == 2
    for message in found:
        assert message["Subject"].endswith(f"Orchard Serenade · {ACCENTED_PUBLISHER} {marker}")
        assert_single_recipient(message)
    assert len(wait_mail(mail, lambda m: marker in (m.get("Subject") or ""), 3, QUIET_WAIT_S)) == 2


def test_wf_rental_reminders_new_set(app_url: str, browser: Browser, mail: Mailpit) -> None:
    mail.clear()
    api = signin(app_url, ROWAN)
    prog, works = build(
        api, [FEN], prepare=False, stocked=False, title=f"Rentals {token()}",
        first_rehearsal=DST_FIRST_REHEARSAL, performances=[DST_PERFORMANCE],
    )
    marker = token()
    broken = f"Hartwell {marker}\nRye"
    publisher = f"{ACCENTED_PUBLISHER} {marker}"
    with app_page(browser, app_url, ROWAN, "/rentals") as page:
        page.get_by_role("button", name="New rental set", exact=True).click()
        advance(page, SETTLE_MS)
        dialog = page.get_by_role("dialog", name="New rental set")
        choose(
            page,
            dialog.get_by_role("combobox", name="Work"),
            ("Fen Country Dances",),
            (re.compile(re.escape(prog["title"])), re.compile(rf"(?<!\d){re.escape(prog['number'])}(?!\d)")),
        )
        slips = dialog.get_by_role("spinbutton", name=starts("Slip copies "))
        expect(slips.first).to_be_visible()
        for spin in slips.all():
            spin.fill("1")
        field = dialog.get_by_role("textbox", name="Publisher")
        field.fill(broken)
        with page.expect_request(lambda r: r.method == "POST" and urlparse(r.url).path == "/api/rental-sets") as sent:
            dialog.get_by_role("button", name="Create rental set", exact=True).click()
        assert json.loads(sent.value.post_data or "{}")["publisher"] == broken
        expect(field).to_have_accessible_description(re.compile(re.escape("Publisher must be one line of text.")))
        expect(dialog).to_be_visible()
        expect(field).to_have_value(broken)
        field.fill(publisher)
        dialog.get_by_role("button", name="Create rental set", exact=True).click()
        expect(status(page, "Rental status")).to_have_text(f"Rental set created for {FEN_TITLE}.")
        row = page.get_by_role("table", name="Rental sets").get_by_role("row").filter(has_text=publisher)
        expect(row).to_contain_text(DST_DUE_LABEL)
        subject = f"Rental return due {DST_DUE_LABEL}: Fen Country Dances · {publisher}"
        found = wait_mail(mail, lambda m: m.get("Subject") == subject, 2)
        assert sorted(recipients(m)[0] for m in found) == sorted([PRIYA, TOMASZ])
        for message in found:
            assert_single_recipient(message)
        deadline = time.monotonic() + MAIL_WAIT_S
        reminder = next(s for s in rental_sets(api) if s["publisher"] == publisher)["reminder"]
        while reminder["status"] != "sent" and time.monotonic() < deadline:
            reminder = next(s for s in rental_sets(api) if s["publisher"] == publisher)["reminder"]
        assert reminder["status"] == "sent", reminder
        with page.expect_response(lambda r: urlparse(r.url).path == "/api/rental-sets", timeout=ADVANCE_WAIT_MS):
            advance(page, RENTALS_RELOAD_MS)
        expect(row).to_contain_text(f"Reminder sent {fmt_date(datetime.fromisoformat(reminder['sent_at']).date())}")
    stored = [s for s in rental_sets(api) if marker in s["publisher"]]
    assert [s["publisher"] for s in stored] == [publisher] and stored[0]["due_date"] == DST_DUE_DATE
    assert wait_mail(mail, lambda m: "Hartwell" in (m.get("Subject") or "") and marker in (m.get("Subject") or ""), 1, QUIET_WAIT_S) == []


def test_wf_rental_reminders_mail_down(browser: Browser, mail: Mailpit) -> None:
    base = os.environ["APP_MAIL_DOWN_URL"]
    api = signin(base, ROWAN)
    _, works = build(api, [ORCHARD], prepare=False, stocked=False, first_rehearsal=stamp(-11), performances=[stamp(-10)])
    publisher = f"{ACCENTED_PUBLISHER} {token()}"
    created = ok(rental(api, works[0], publisher), 201)
    with app_page(browser, base, PRIYA, "/rentals") as page:
        expect(page.get_by_role("alert").filter(has_text=MAIL_BANNER)).to_have_text(MAIL_BANNER)
        row = page.get_by_role("table", name="Rental sets").get_by_role("row").filter(has_text=publisher)
        expect(row).to_be_visible()
        for _ in range(3):
            if "Reminder queued" in row.inner_text():
                break
            with page.expect_response(lambda r: urlparse(r.url).path == "/api/rental-sets", timeout=ADVANCE_WAIT_MS):
                advance(page, RENTALS_RELOAD_MS)
        expect(row).to_contain_text("Reminder queued")
    assert rental_by_id(api, created["id"])["reminder"]["status"] == "queued"
    assert wait_mail(mail, lambda m: publisher in (m.get("Subject") or ""), 1, QUIET_WAIT_S) == []


def test_storage_outage_api(app_url: str) -> None:
    base = os.environ["APP_STORAGE_DOWN_URL"]
    assert wait_status(base, "storage", "down") == {"storage": "down", "mail": "up"}
    health = httpx.get(base + "/api/health", timeout=HTTP_TIMEOUT_S)
    assert health.status_code == 200 and health.json() == {"status": "ok"}
    api, priya, yusra = (signin(base, e) for e in (ROWAN, PRIYA, YUSRA))
    assert ok(api.get("/api/catalogue"))["works"]
    prog, works = build(api, [ORCHARD])
    orchard = works[0]
    vn2 = part_id(orchard, "vn2")
    body = refused(upload(priya, vn2, f"{token()}.pdf", pdf_bytes(token())), 503, "storage_unavailable")
    assert body["message"] == "The score store is offline."
    assert scans(api, vn2) == [] and part_of(api, orchard["id"], vn2)["latest_marked_scan"] is None
    assert S3().keys(f"scans/{prog['id']}/") == []
    stored_cut = ok(cut(api, orchard["id"], FERRY_CUT_A), 201)["cut"]
    ok(mark(priya, vn2, stored_cut["id"]), 201)
    ok(hold(priya, vn2, part_of(api, orchard["id"], vn2)["copies"]["needed"]))
    ok(publish(api, prog["id"]))
    assert ok(yusra.get(f"/api/folders/{prog['id']}"))["scans_available"] is False


def test_wf_store_outage_banner(browser: Browser) -> None:
    base = os.environ["APP_STORAGE_DOWN_URL"]
    api = signin(base, ROWAN)
    weir_prog, weir_works = build(api, [WEIR], prepare=False, stocked=False)
    folder_prog, _ = published(api, [ORCHARD])
    with app_page(browser, base, PRIYA, desk_path(weir_prog, weir_works[0])) as page:
        expect(page.get_by_role("alert").filter(has_text=STORE_BANNER)).to_have_text(STORE_BANNER)
        button = page.get_by_role("button", name=f"Upload scan {'Violin I'}", exact=True)
        expect(button).to_have_attribute("aria-disabled", "true")
        expect(button).to_have_accessible_description(STORE_BANNER)
        choosers: list[Any] = []
        page.on("filechooser", lambda chooser: choosers.append(chooser))
        button.click(force=True)
        button.focus()
        page.keyboard.press("Enter")
        page.keyboard.press(" ")
        advance(page, SETTLE_MS)
        assert choosers == []
    with ferry_programme(api):
        with app_page(browser, base, HESTER, "/section") as page:
            expect(page.get_by_role("alert").filter(has_text=STORE_BANNER)).to_have_text(STORE_BANNER)
            expect(page.get_by_role("button", name=f"Upload bowing master {FERRY_TITLE}", exact=True)).to_have_attribute("aria-disabled", "true")
    with app_page(browser, base, YUSRA, f"/folder/{folder_prog['id']}", size=PHONE) as page:
        expect(page.get_by_text(SCAN_UNAVAILABLE, exact=True)).to_be_visible()
        expect(page.get_by_role("link", name="Open marked part")).to_have_count(0)
    assert ok(api.get("/api/status"))["storage"] == "down"


def test_wf_store_outage_in_place(app_url: str, browser: Browser) -> None:
    api, priya = signin(app_url, ROWAN), signin(app_url, PRIYA)
    prog, works = build(api, [WEIR], prepare=False, stocked=False)
    weir = works[0]
    vn1 = part_id(weir, "vn1")
    folder_prog, folder_works = published(api, [ORCHARD])
    ok(upload(priya, part_id(folder_works[0], "vn2"), f"{token()}.pdf", pdf_bytes(token())), 201)
    content = pdf_bytes(token())
    status_read = lambda r: urlparse(r.url).path == "/api/status"
    with app_page(browser, app_url, ROWAN, desk_path(prog, weir)) as page:
        mark_window(page)
        header = page.get_by_role("region", name="Programme header")
        header.get_by_role("spinbutton", name="Violin I", exact=True).fill("10")
        selection = (WEIR_CUT[0], WEIR_CUT[0] + 10)
        select_span(page, *selection)
        button = page.get_by_role("button", name=f"Upload scan {'Violin I'}", exact=True)
        url = page.url
        fake_storage_down(page)
        with page.expect_response(status_read, timeout=ADVANCE_WAIT_MS):
            advance(page, STATUS_CHECK_MS)
        expect(page.get_by_role("alert").filter(has_text=STORE_BANNER)).to_have_text(STORE_BANNER)
        expect(button).to_have_attribute("aria-disabled", "true")
        expect(button).to_have_accessible_description(STORE_BANNER)
        expect(ruler(page)).to_be_focused()
        value_text(ruler(page), selected(selection))
        expect(header.get_by_role("spinbutton", name="Violin I", exact=True)).to_have_value("10")
        assert page.url == url
        assert_no_reload(page)
        restore_storage(page)
        with page.expect_response(status_read, timeout=ADVANCE_WAIT_MS):
            advance(page, STATUS_CHECK_MS)
        expect(page.get_by_role("alert").filter(has_text=STORE_BANNER)).to_have_count(0)
        expect(button).not_to_have_attribute("aria-disabled", "true")
        expect(button).not_to_have_accessible_description(STORE_BANNER)
        value_text(ruler(page), selected(selection))
        assert_no_reload(page)
        choose_file(page, button, f"{token()}.pdf", content)
        expect(page.get_by_role("status", name="Upload status").filter(has_text="Scan filed").first).to_have_text(
            f"Scan filed for {label(WEIR_TITLE, 'Violin I')}."
        )
    assert programme(api, prog["id"])["string_count"] == SEED_COUNT and work(api, weir["id"])["cuts"] == []
    assert S3().get(scans(api, vn1)[0]["object_key"]) == content
    with app_page(browser, app_url, YUSRA, f"/folder/{folder_prog['id']}", size=PHONE) as page:
        link = page.get_by_role("link", name="Open marked part")
        expect(link).to_be_visible()
        position = status(page, "Page position")
        expect(position).to_have_text(page_of(1, 1))
        url = page.url
        fake_storage_down(page)
        with page.expect_response(status_read, timeout=ADVANCE_WAIT_MS):
            advance(page, STATUS_CHECK_MS)
        expect(page.get_by_text(SCAN_UNAVAILABLE, exact=True)).to_be_visible()
        expect(link).to_have_count(0)
        expect(position).to_have_text(page_of(1, 1))
        assert page.url == url
        restore_storage(page)
        with page.expect_response(status_read, timeout=ADVANCE_WAIT_MS):
            advance(page, STATUS_CHECK_MS)
        expect(link).to_be_visible()
        expect(page.get_by_text(SCAN_UNAVAILABLE, exact=True)).to_have_count(0)


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert set(manifest) == {"_schema", "install", "build", "serve"}
    assert manifest["_schema"] == "run-manifest-v1"
    assert all(isinstance(value, str) for value in manifest.values())


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = sorted({p.name for p in shipped_packages() if p.name not in notices})
    assert not missing, missing
    for name in ("Fraunces", "IBM Plex Sans", "IBM Plex Mono", "Lucide"):
        assert name in notices, name


def test_if_licences() -> None:
    refused_packages = [(p.name, p.licence) for p in shipped_packages() if not licence_allowed(p.licence, LICENCES)]
    assert not refused_packages, refused_packages


def test_if_no_extra_datastore() -> None:
    shipped = {p.name for p in shipped_packages()}
    assert not shipped & DATASTORE_PACKAGES, shipped & DATASTORE_PACKAGES
    assert Postgres().tables()


COMPOSE_FILE = re.compile(r"(?:docker-)?compose[\w.-]*\.ya?ml")
SHELL_WRITE = re.compile(r"(?:sed\s+-i|>>?\s*|tee\s+(?:-a\s+)?|rm\s+(?:-\w+\s+)*|mv\s+\S+\s+)[^\s\"';|&]*compose[^\s\"';|&]*\.ya?ml")


def test_if_service_config_untouched() -> None:
    offending: list[str] = []

    def walk(node: Any) -> None:
        if isinstance(node, dict):
            tool = str(node.get("name") or node.get("tool") or node.get("tool_name") or "")
            arguments = node.get("input", node.get("arguments", node.get("args")))
            if arguments is not None:
                blob = arguments if isinstance(arguments, str) else json.dumps(arguments, ensure_ascii=False)
                paths = re.findall(r'"(?:file_)?path"\s*:\s*"([^"]+)"', blob)
                if re.search(r"(?i)write|edit|replace|create", tool) and any(COMPOSE_FILE.search(p) for p in paths):
                    offending.append(f"{tool}: {paths}")
                if re.search(r"(?i)bash|shell|exec|command|terminal", tool) and SHELL_WRITE.search(blob):
                    offending.append(f"{tool}: {SHELL_WRITE.search(blob).group(0)}")
            for value in node.values():
                walk(value)
        elif isinstance(node, list):
            for value in node:
                walk(value)

    if not TRAJECTORY.is_file():
        return
    walk(json.loads(TRAJECTORY.read_text()))
    assert not offending, offending


def test_if_typescript_source() -> None:
    skipped = {"node_modules", "dist", "build", "out", ".git", ".output", "coverage"}
    javascript: list[str] = []
    typescript = 0
    for root, dirs, files in os.walk(APP):
        dirs[:] = [d for d in dirs if d not in skipped]
        for name in files:
            if name.endswith((".ts", ".tsx")):
                typescript += 1
            elif name.endswith((".js", ".jsx", ".mjs", ".cjs")) and not re.search(r"(^\.|config|rc\.)", name):
                javascript.append(str(Path(root) / name))
    assert typescript > 0
    assert not javascript, javascript


def test_if_same_origin_assets(app_url: str, browser: Browser) -> None:
    requested: list[str] = []
    for email, path in ((None, "/"), (ROWAN, "/desk"), (PRIYA, "/rentals"), (YUSRA, "/folder")):
        with app_page(browser, app_url, email, path) as page:
            page.on("request", lambda r: requested.append(r.url))
            page.reload()
            page.wait_for_load_state("networkidle")
    foreign = [u for u in requested if u.startswith("http") and not same_origin(u, app_url)]
    assert not foreign, foreign
