from __future__ import annotations

import concurrent.futures
import hashlib
import json
import math
import os
import re
import socket
import subprocess
import threading
from contextlib import contextmanager
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from time import monotonic
from typing import Any, Callable, Iterator
from urllib.parse import urlparse

import httpx
import pytest
from playwright.sync_api import Browser, Locator, Page, expect

from conftest import (
    DEPLOYED_APP,
    S3,
    Postgres,
    advance,
    capture,
    center,
    check,
    click,
    decode,
    difference,
    fill,
    held,
    idempotency_key,
    layout,
    open_app,
    select,
    session,
    tab_order,
    tap,
    unique,
)

APP = Path("/app")

HTTP_TIMEOUT = 30
UI_DEADLINE = 30
SERVER_DEADLINE = 60
QUICK_MS = 250
STEP_MS = 1000
TAB_LIMIT = 80
CYCLE_LIMIT = 24
ALIGN_TOLERANCE_PX = 3
FULL_WIDTH_SHARE = 0.85
LONGITUDE_TOLERANCE = 0.011

CELLS_PER_DAY = 48
STEPS_PER_PAGE = 48
MAX_STEP_24 = 624
MAX_STEP_168 = 336
STRIP_HOURS = 336
DEFAULT_CLOSE_SECONDS = 172800
SHORT_CLOSE_SECONDS = 5
MAX_BODY = 1000000
TOUCH_MIN_PX = 44
NOTE_MAX = 2000
FLAG_REFERENCE_MAX = 200
FLAG_MAX_HOURS = 336
KEY_MAX = 100
SYNC_MAX = 500
ROTA_MAX_DATES = 28
GLOBE_MID_MS = 100
MOTION_SETTLED_MS = 1000
FRAME_MS = 50
VERDICT_STILL_MS = 600
ARCHIVE_DOWN_PORT = 9
ARCHIVE_STATUS_SECONDS = 15
STATUS_POLLS = ("/api/archive-status", "/months/", "/days/", "/strip", "/rolling", "/api/me")

PHONE = {"width": 375, "height": 812}
TABLET = {"width": 768, "height": 1024}
DESKTOP = {"width": 1280, "height": 800}

PAST_MONTH = "2026-08"
PAST_DAY = "2026-08-11"
PAST_DAY_NEXT = "2026-08-12"
OLDER_MONTH_DAY = "2026-07-14"
JUNK = "no-such-thing-0000"
GARBLED_IDS = ["%ZZ", "no-such%00id"]
FIRST_CHANGE_DAY = "2026-08-01"
FILING_CHANGE_DAY = "2026-08-03"
FIX_LATITUDE = 40.5
DATELINE_LONGITUDE = 170
DATELINE_MARGIN = 5
ENTER_KEY_VESSEL = "Enter key boat"
CORS_HEADER = "access-control-allow-origin"
COOKIE_HTTP_ONLY = "httponly"
COOKIE_SAME_SITE = "samesite"
COOKIE_SAME_SITE_NONE = "samesite=none"
SEED_TOMAS = "crew-tomas"
SEED_MONTH = "2026-09"

AILSA = ("ailsa@tidewrack.example", "fathom-ailsa-2741")
BRAM = ("bram@skerry.example", "fathom-bram-8830")
INES = ("ines@tidewrack.example", "watch-ines-1192")
TOMAS = ("tomas@tidewrack.example", "watch-tomas-3365")
PETRA = ("petra@tidewrack.example", "watch-petra-5507")
SEED_STRIP = "2026-09-07T00:00:00Z"

GOOD_DAY = [["00:00", "04:00", "work"], ["04:00", "12:00", "rest"], ["12:00", "16:00", "work"], ["16:00", "24:00", "rest"]]
BAD_DAY = [["00:00", "20:00", "work"], ["20:00", "24:00", "rest"]]
TEN_HOUR_DAY = [["00:00", "14:00", "work"], ["14:00", "24:00", "rest"]]
THREE_PERIOD_DAY = [
    ["00:00", "02:00", "work"], ["02:00", "08:00", "rest"], ["08:00", "10:00", "work"],
    ["10:00", "14:00", "rest"], ["14:00", "16:00", "work"], ["16:00", "24:00", "rest"],
]
TWO_PERIOD_DAY = [["00:00", "02:00", "work"], ["02:00", "14:00", "rest"], ["14:00", "16:00", "work"], ["16:00", "24:00", "rest"]]

RULE_CASES = {
    "exact_ten_passes": {"before": [], "day": [["00:00", "07:00", "work"], ["07:00", "13:00", "rest"], ["13:00", "20:00", "work"], ["20:00", "24:00", "rest"]], "after": [], "days": 1, "hours": 24, "rest": 10, "verdict": "pass", "rules": []},
    "below_ten": {"before": [], "day": [["00:00", "07:00", "work"], ["07:00", "13:00", "rest"], ["13:00", "20:30", "work"], ["20:30", "24:00", "rest"]], "after": [], "days": 1, "hours": 24, "rest": 9.5, "verdict": "breach", "rules": ["rest_24h"]},
    "three_periods": {"before": [], "day": [["00:00", "02:00", "work"], ["02:00", "08:00", "rest"], ["08:00", "10:00", "work"], ["10:00", "14:00", "rest"], ["14:00", "16:00", "work"], ["16:00", "24:00", "rest"]], "after": [], "days": 1, "hours": 24, "rest": 18, "verdict": "breach", "rules": ["rest_periods"]},
    "no_six_hour_block": {"before": [], "day": [["00:00", "06:30", "work"], ["06:30", "12:00", "rest"], ["12:00", "18:30", "work"], ["18:30", "24:00", "rest"]], "after": [["00:00", "01:00", "work"]], "days": 1, "hours": 24, "rest": 11, "verdict": "breach", "rules": ["six_hour_block"]},
    "six_hour_block_past_edge": {"before": [["21:00", "24:00", "rest"]], "day": [["00:00", "03:00", "rest"], ["03:00", "08:00", "work"], ["08:00", "13:30", "rest"], ["13:30", "18:00", "work"], ["18:00", "20:00", "rest"], ["20:00", "24:00", "work"]], "after": [], "days": 1, "hours": 24, "rest": 10.5, "verdict": "pass", "rules": []},
    "gap_over_fourteen": {"before": [], "day": [["00:00", "14:30", "work"], ["14:30", "24:00", "rest"]], "after": [], "days": 1, "hours": 24, "rest": 9.5, "verdict": "breach", "rules": ["fourteen_hour_gap", "rest_24h"]},
    "gap_exact_fourteen": {"before": [], "day": [["00:00", "14:00", "work"], ["14:00", "24:00", "rest"]], "after": [], "days": 1, "hours": 24, "rest": 10, "verdict": "pass", "rules": []},
    "short_break_not_rest": {"before": [], "day": [["00:00", "07:00", "work"], ["07:00", "13:00", "rest"], ["13:00", "20:00", "work"], ["20:00", "23:00", "rest"], ["23:00", "23:30", "work"], ["23:30", "24:00", "rest"]], "after": [["00:00", "00:30", "work"]], "days": 1, "hours": 24, "rest": 9, "verdict": "breach", "rules": ["rest_24h"]},
    "one_hour_counts": {"before": [], "day": [["00:00", "06:00", "work"], ["06:00", "15:00", "rest"], ["15:00", "23:00", "work"], ["23:00", "24:00", "rest"]], "after": [["00:00", "00:30", "work"]], "days": 1, "hours": 24, "rest": 10, "verdict": "pass", "rules": []},
    "not_fully_logged": {"before": [], "day": [["00:00", "12:00", "work"]], "after": [], "days": 1, "hours": 24, "rest": 0, "verdict": "incomplete", "rules": []},
    "week_below_limit": {"before": [], "day": [["00:00", "14:00", "work"], ["14:00", "24:00", "rest"]], "after": [], "days": 7, "hours": 168, "rest": 70, "verdict": "breach", "rules": ["rest_168h"]},
    "week_exact_limit": {"before": [], "day": [["00:00", "06:30", "work"], ["06:30", "12:00", "rest"], ["12:00", "18:30", "work"], ["18:30", "24:00", "rest"]], "after": [], "days": 7, "hours": 168, "rest": 77, "verdict": "pass", "rules": []},
}


def parse(instant: str) -> datetime:
    return datetime.strptime(instant, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def iso(moment: datetime) -> str:
    return moment.strftime("%Y-%m-%dT%H:%M:%SZ")


def shift_date(ship_date: str, days: int) -> str:
    return (datetime.strptime(ship_date, "%Y-%m-%d") + timedelta(days=days)).strftime("%Y-%m-%d")


def at(ship_date: str, clock: str, offset: int = 0) -> str:
    hours, minutes = clock.split(":")
    base = datetime.strptime(ship_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
    return iso(base + timedelta(hours=int(hours), minutes=int(minutes) - offset))


def ship_reading(instant: str, offset: int) -> str:
    return (parse(instant) + timedelta(minutes=offset)).strftime("%Y-%m-%d %H:%M")


def floor_half_hour(moment: datetime) -> datetime:
    return moment.replace(minute=moment.minute - moment.minute % 30, second=0, microsecond=0)


class Api:

    def __init__(self, base: str) -> None:
        self.base = base.rstrip("/")
        self.cookies: dict[str, str] = {}

    def call(self, method: str, path: str, body: Any = None, **kwargs: Any) -> httpx.Response:
        headers = dict(kwargs.pop("headers", {}))
        if self.cookies:
            headers["Cookie"] = "; ".join(f"{k}={v}" for k, v in self.cookies.items())
        if body is not None:
            kwargs["json"] = body
        response = httpx.request(method, self.base + path, headers=headers, timeout=HTTP_TIMEOUT, **kwargs)
        for raw in response.headers.get_list("set-cookie"):
            name, _, value = raw.split(";", 1)[0].partition("=")
            if value:
                self.cookies[name.strip()] = value
            else:
                self.cookies.pop(name.strip(), None)
        return response

    def get(self, path: str, **kwargs: Any) -> httpx.Response:
        return self.call("GET", path, **kwargs)

    def post(self, path: str, body: Any = None, **kwargs: Any) -> httpx.Response:
        return self.call("POST", path, body, **kwargs)

    def ok(self, path: str) -> dict[str, Any]:
        response = self.get(path)
        assert response.status_code == 200, f"{path}: {response.status_code} {response.text}"
        return response.json()


def status(response: httpx.Response, code: int, error: str | None = None) -> dict[str, Any]:
    assert response.status_code == code, f"wanted {code}, got {response.status_code}: {response.text}"
    if error is not None:
        assert response.json()["error"] == error, response.text
    if response.content and "json" in response.headers.get("content-type", ""):
        return response.json()
    return {}


def refused_garbled(response: httpx.Response) -> None:
    assert response.status_code in (400, 404), f"wanted 400 or 404, got {response.status_code}: {response.text}"


def invalid(response: httpx.Response) -> dict[str, str]:
    assert response.status_code == 422, f"wanted 422, got {response.status_code}: {response.text}"
    errors = response.json()["errors"]
    assert isinstance(errors, dict) and errors, response.text
    return errors


def identity(prefix: str) -> tuple[str, str, str]:
    token = hashlib.sha1("".join(unique(prefix)).encode()).hexdigest()[:16]
    return f"{prefix.title()} {token}", f"{prefix}.{token}@sixbell.example", f"pass-{token}"


def signed_in(base: str, credentials: tuple[str, str]) -> Api:
    api = Api(base)
    status(api.post("/api/session", {"email": credentials[0], "passcode": credentials[1]}), 200)
    return api


@dataclass
class Crew:
    id: str
    name: str
    email: str
    passcode: str
    api: Api


@dataclass
class World:
    base: str
    owner: Api
    owner_email: str
    owner_passcode: str
    vessel_id: str
    vessel_name: str
    offset: int
    crew: Crew
    others: list[Crew] = field(default_factory=list)


def new_owner(base: str) -> tuple[Api, str, str]:
    name, email, passcode = identity("owner")
    api = Api(base)
    status(api.post("/api/owners", {"name": name, "email": email, "passcode": passcode}), 201)
    return api, email, passcode


def add_crew(base: str, owner: Api, vessel_id: str) -> Crew:
    name, email, passcode = identity("crew")
    body = status(owner.post(f"/api/vessels/{vessel_id}/crew", {"name": name, "rank": "Mate", "email": email, "passcode": passcode}), 201)
    return Crew(body["id"], name, email, passcode, signed_in(base, (email, passcode)))


def make_world(base: str, offset: int | None = 0) -> World:
    owner, email, passcode = new_owner(base)
    if offset is None:
        hour = parse(owner.ok("/api/me")["server_now_utc"]).hour
        offset = (12 - hour) * 60
    vessel_name, _, _ = identity("vessel")
    vessel = status(owner.post("/api/vessels", {"name": vessel_name, "kind": "workboat", "initial_offset_minutes": offset}), 201)
    crew = add_crew(base, owner, vessel["id"])
    return World(base, owner, email, passcode, vessel["id"], vessel_name, offset, crew)


def today(world: World) -> str:
    return world.crew.api.ok("/api/me")["today_ship_date"]


def entry(start: str, end: str, kind: str, key: str | None = None) -> dict[str, str]:
    return {"entry_key": key or idempotency_key(), "start_utc": start, "end_utc": end, "kind": kind}


def log_spans(crew: Crew, ship_date: str, spans: list[list[str]], offset: int = 0) -> None:
    entries = [entry(at(ship_date, s, offset), at(ship_date, e, offset), k) for s, e, k in spans]
    results = status(crew.api.post("/api/watch-entries/sync", {"entries": entries}), 200)["results"]
    assert all(r["outcome"] in ("applied", "late") for r in results), results


def day_of(api: Api, crew_id: str, ship_date: str) -> dict[str, Any]:
    return api.ok(f"/api/crew/{crew_id}/days/{ship_date}")


def window_of(api: Api, crew_id: str, start: str, hours: int = 24) -> dict[str, Any]:
    return api.ok(f"/api/crew/{crew_id}/window?start={start}&hours={hours}")


def sign(crew: Crew, *dates: str) -> httpx.Response:
    return crew.api.post(f"/api/crew/{crew.id}/days/sign", {"ship_dates": list(dates)})


def countersign(world: World, crew: Crew, *dates: str) -> httpx.Response:
    return world.owner.post(f"/api/crew/{crew.id}/days/countersign", {"ship_dates": list(dates)})


def ready_month(world: World, crew: Crew | None = None, dates: tuple[str, ...] = (PAST_DAY,)) -> Crew:
    crew = crew or world.crew
    for ship_date in dates:
        log_spans(crew, ship_date, GOOD_DAY, world.offset)
    status(sign(crew, *dates), 200)
    status(countersign(world, crew, *dates), 200)
    return crew


def poll(fetch: Callable[[], Any], done: Callable[[Any], bool], what: str, seconds: float = SERVER_DEADLINE) -> Any:
    deadline = monotonic() + seconds
    while True:
        value = fetch()
        if done(value):
            return value
        assert monotonic() < deadline, f"{what} not reached: {value}"


def month_of(world: World, crew: Crew, month: str = PAST_MONTH) -> dict[str, Any]:
    return world.owner.ok(f"/api/crew/{crew.id}/months/{month}")


def seal_and_wait(world: World, crew: Crew | None = None, month: str = PAST_MONTH) -> dict[str, Any]:
    crew = crew or world.crew
    assert world.owner.post(f"/api/crew/{crew.id}/months/{month}/seal").status_code in (200, 202)
    return poll(lambda: month_of(world, crew, month), lambda m: m["state"] == "sealed", "sealed month")


def new_link(world: World, from_date: str, to_date: str, expires: str | None = None) -> dict[str, Any]:
    if expires is None:
        expires = iso(parse(world.owner.ok("/api/me")["server_now_utc"]) + timedelta(hours=6))
    return status(world.owner.post(f"/api/vessels/{world.vessel_id}/inspection-links", {"from_date": from_date, "to_date": to_date, "expires_at_utc": expires}), 201)


def token_of(link: dict[str, Any]) -> str:
    return link["url"].rsplit("/", 1)[-1]


def assert_pdf(payload: bytes) -> None:
    assert payload.startswith(b"%PDF-"), payload[:16]
    assert b"%%EOF" in payload[-1024:], payload[-32:]


def closing_world(base: str) -> tuple[World, str, dict[str, Any]]:
    probe = Api(base)
    _, email, passcode = identity("probe")
    status(probe.post("/api/owners", {"name": "Probe owner", "email": email, "passcode": passcode}), 201)
    changes_at = floor_half_hour(parse(probe.ok("/api/me")["server_now_utc"])) - timedelta(minutes=30)
    minutes = changes_at.hour * 60 + changes_at.minute
    new_offset = (1410 - minutes) % 1440
    if new_offset >= 840:
        new_offset -= 1440
    world = make_world(base, new_offset - 120)
    change = {"changes_at_utc": iso(changes_at), "new_offset_minutes": new_offset, "latitude": 10, "longitude": 10}
    return world, today(world), change


def role(scope: Page | Locator, kind: str, name: str) -> Locator:
    return scope.get_by_role(kind, name=name, exact=True)


def eventually(page: Page, verify: Callable[[], None], seconds: float = UI_DEADLINE) -> None:
    deadline = monotonic() + seconds
    while True:
        try:
            verify()
            return
        except AssertionError:
            if monotonic() > deadline:
                raise
            advance(page, STEP_MS)


def see(page: Page, locator: Locator, seconds: float = UI_DEADLINE) -> None:
    eventually(page, lambda: expect(locator).to_be_visible(timeout=QUICK_MS), seconds)


def says(page: Page, locator: Locator, text: str | re.Pattern[str], seconds: float = UI_DEADLINE) -> None:
    eventually(page, lambda: expect(locator).to_contain_text(text, timeout=QUICK_MS), seconds)


def stops_saying(page: Page, locator: Locator, text: str, seconds: float = UI_DEADLINE) -> None:
    eventually(page, lambda: expect(locator).not_to_contain_text(text, timeout=QUICK_MS), seconds)


def gone(page: Page, locator: Locator, seconds: float = UI_DEADLINE) -> None:
    eventually(page, lambda: expect(locator).to_have_count(0, timeout=QUICK_MS), seconds)


def visit(page: Page, url: str) -> None:
    page.goto(url)


def sign_in(page: Page, base: str, email: str, passcode: str) -> None:
    visit(page, f"{base}/")
    fill(role(page, "textbox", "Email"), email)
    fill(role(page, "textbox", "Passcode"), passcode)
    click(role(page, "button", "Sign in"))
    see(page, role(page, "button", "Sign out"))


def open_dialog(page: Page, opener: Locator, name: str) -> Locator:
    click(opener)
    dialog = role(page, "dialog", name)
    see(page, dialog)
    return dialog


def pick(locator: Locator, wanted: str) -> None:
    def squeeze(text: str) -> str:
        return re.sub(r"[^a-z0-9]", "", text.lower())

    key = squeeze(wanted)
    native = locator.evaluate("e => e.tagName === 'SELECT'")
    if not native:
        click(locator)
    deadline = monotonic() + UI_DEADLINE
    while True:
        if native:
            for label, value in locator.evaluate("e => [...e.options].map(o => [o.textContent.trim(), o.value])"):
                if key in squeeze(label) or key in squeeze(value):
                    select(locator, label)
                    return
        else:
            options = locator.page.get_by_role("option")
            for index in range(options.count()):
                if key in squeeze(options.nth(index).inner_text()):
                    click(options.nth(index))
                    return
        assert monotonic() < deadline, f"no option holds {wanted}"


def focus_cell(target: Locator) -> None:
    target.evaluate(
        """e => {
          e.focus();
          if (document.activeElement === e) return;
          for (const inner of e.getElementsByTagName('*')) {
            inner.focus();
            if (document.activeElement === inner) return;
          }
        }"""
    )


def cell(page: Page, clock: str, state: str) -> Locator:
    return page.get_by_role("gridcell", name=f"{clock} {state}", exact=True)


def flagged(scope: Locator) -> int:
    return scope.get_by_role("textbox").evaluate_all("nodes => nodes.filter(n => n.getAttribute('aria-invalid') === 'true').length")


def marked_invalid(page: Page, scope: Locator, expected: bool = True) -> None:
    def verify() -> None:
        assert (flagged(scope) > 0) == expected, "a textbox marked invalid" if expected else "no textbox left marked invalid"
    eventually(page, verify)


def held_with_error(page: Page, dialog: Locator, field: Locator | None = None) -> None:
    see(page, dialog)
    if field is not None:
        eventually(page, lambda: expect(field).to_have_attribute("aria-invalid", "true", timeout=QUICK_MS))
    else:
        marked_invalid(page, dialog)


def clock_change_dialog(page: Page, world: World, when: str, offset: str) -> Locator:
    dialog = open_dialog(page, role(role(page, "region", "Clock changes"), "button", "Log clock change"), "Log clock change")
    fill(role(dialog, "textbox", "Change time in UTC"), when)
    fill(role(dialog, "textbox", "New offset in minutes"), offset)
    fill(role(dialog, "textbox", "Latitude"), "10")
    fill(role(dialog, "textbox", "Longitude"), "15")
    click(role(dialog, "button", "Save clock change"))
    return dialog


def any_cell(page: Page, clock: str) -> Locator:
    return page.get_by_role("gridcell", name=re.compile(rf"^{clock} ")).first


def focused_cell_index(page: Page) -> int:
    return page.get_by_role("gridcell").evaluate_all("els => els.findIndex(e => e.contains(document.activeElement))")


def tab_to(page: Page, locator: Locator) -> None:
    for _ in range(TAB_LIMIT):
        page.keyboard.press("Tab")
        if locator.evaluate("e => e === document.activeElement || e.contains(document.activeElement)"):
            return
    raise AssertionError("control is not reachable by Tab")


def assert_focus_ring(page: Page) -> None:
    drawn = page.evaluate(
        """() => {
          const e = document.activeElement;
          const styles = [getComputedStyle(e), getComputedStyle(e, '::before'), getComputedStyle(e, '::after')];
          return styles.some(s => (s.outlineStyle !== 'none' && parseFloat(s.outlineWidth) > 0) || s.boxShadow !== 'none');
        }"""
    )
    if drawn:
        return
    body = page.locator("body")
    control = page.evaluate_handle("() => document.activeElement")
    focused = decode(capture(body))
    page.evaluate("e => e.blur()", control)
    plain = decode(capture(body))
    page.evaluate("e => e.focus()", control)
    assert difference(focused, plain) > 0, "the focused control shows no focus ring"


@contextmanager
def open_offline_app(browser: Browser, url: str) -> Iterator[Page]:
    import time
    from contextlib import closing
    with closing(browser.new_context(viewport={"width": 1280, "height": 800}, has_touch=True, service_workers="allow")) as context:
        context.add_init_script(path=Path(__file__).resolve().parent / "instrument.js")
        tab = context.new_page()
        tab.set_default_timeout(5000)
        tab.set_default_navigation_timeout(15000)
        now = int(time.time())
        tab.clock.install(time=now)
        tab.clock.pause_at(now + 10)
        tab.goto(url)
        yield tab

def prime_offline(page: Page) -> None:
    has_worker = "() => 'serviceWorker' in navigator"
    active = "async () => { const r = await navigator.serviceWorker.getRegistration(); return !!(r && r.active); }"
    if page.evaluate(has_worker):
        def ready() -> None:
            assert page.evaluate(active), "no active service worker yet"
        eventually(page, ready)
    page.reload()
    see(page, role(page, "grid", "Watch grid"))
    page.wait_for_load_state("networkidle")


def bypass_worker(page: Page) -> None:
    cdp = session(page)
    cdp.send("Network.enable")
    cdp.send("Network.setBypassServiceWorker", {"bypass": True})


def track_drag_requests(page: Page) -> list[str]:
    seen: list[str] = []
    page.on("request", lambda r: seen.append(r.url) if "/api/" in r.url and not any(p in r.url for p in STATUS_POLLS) else None)
    return seen


def track_api(page: Page) -> list[str]:
    seen: list[str] = []
    page.on("request", lambda r: seen.append(r.url) if "/api/" in r.url else None)
    return seen


def fold(page: Page) -> Locator:
    return role(page, "group", "Hour Fold")


def strip_region(page: Page) -> Locator:
    return role(page, "region", "Watch strip")


def record_region(page: Page) -> Locator:
    return role(page, "region", "Record")


def slider(page: Page) -> Locator:
    return role(page, "slider", "Window start")


def open_voyage(page: Page, base: str, vessel_id: str, crew_id: str, start: str | None = None, ship_date: str | None = None) -> None:
    query = "&".join(p for p in (f"start={start}" if start else "", f"date={ship_date}" if ship_date else "") if p)
    visit(page, f"{base}/voyage/{vessel_id}/{crew_id}" + (f"?{query}" if query else ""))
    eventually(page, lambda: expect(fold(page)).to_have_attribute("data-step", "0", timeout=QUICK_MS))


def go_to_step(page: Page, step: int) -> None:
    slider(page).focus()
    page.keyboard.press("Home")
    for _ in range(step // STEPS_PER_PAGE):
        page.keyboard.press("PageUp")
    for _ in range(step % STEPS_PER_PAGE):
        page.keyboard.press("ArrowRight")
    eventually(page, lambda: expect(fold(page)).to_have_attribute("data-step", str(step), timeout=QUICK_MS))


def assert_fold_matches(page: Page, api: Api, crew_id: str, strip_start: str, step: int, hours: int = 24) -> dict[str, Any]:
    start = iso(parse(strip_start) + timedelta(minutes=30 * step))
    server = window_of(api, crew_id, start, hours)
    group = fold(page)
    expected = {
        "data-step": str(step),
        "data-window-start-utc": server["start_utc"],
        "data-window-end-utc": server["end_utc"],
        "data-rest-hours": f"{float(server['rest_hours']):.1f}",
        "data-verdict": server["verdict"],
        "data-longitude": "" if server["longitude"] is None else f"{float(server['longitude']):.2f}",
        "data-fold-state": server["fold_state"],
    }

    def verify() -> None:
        for name, value in expected.items():
            expect(group).to_have_attribute(name, value, timeout=QUICK_MS)
        assert float(group.get_attribute("data-clock-face-hours") or "nan") == float(server["clock_face_hours"])

    eventually(page, verify)
    return server


def globe_longitude(page: Page) -> float:
    return float(role(page, "img", "Voyage globe").get_attribute("data-globe-longitude") or "nan")


def word_showing(word: Locator) -> bool:
    return word.evaluate_all(
        """els => els.some(e => {
          for (let n = e; n; n = n.parentElement) {
            const s = getComputedStyle(n);
            if (s.display === 'none' || s.visibility === 'hidden' || parseFloat(s.opacity) === 0) return false;
          }
          const r = e.getBoundingClientRect();
          return r.width > 0 && r.height > 0;
        })"""
    )


def word_settles(page: Page, word: Locator, showing: bool) -> None:
    def verify() -> None:
        assert word_showing(word) is showing, f"the word should be showing: {showing}"

    eventually(page, verify)


def enable_touch(page: Page) -> Any:
    cdp = session(page)
    cdp.send("Emulation.setTouchEmulationEnabled", {"enabled": True})
    return cdp


def touch_drag(cdp: Any, start: tuple[float, float], end: tuple[float, float], moves: int = 6, before_release: Callable[[], Any] | None = None) -> None:
    def point(x: float, y: float) -> dict[str, list[dict[str, float]]]:
        return {"touchPoints": [{"x": x, "y": y}]}

    cdp.send("Input.dispatchTouchEvent", {"type": "touchStart", **point(*start)})
    for index in range(1, moves + 1):
        share = index / moves
        x = start[0] + (end[0] - start[0]) * share
        y = start[1] + (end[1] - start[1]) * share
        cdp.send("Input.dispatchTouchEvent", {"type": "touchMove", **point(x, y)})
    if before_release:
        before_release()
    cdp.send("Input.dispatchTouchEvent", {"type": "touchEnd", "touchPoints": []})


def provide_bucket(suffix: str) -> None:
    import hmac
    import urllib.request
    import urllib.error
    store = S3(suffix)
    now = datetime.now(timezone.utc)
    amz_date, day = now.strftime("%Y%m%dT%H%M%SZ"), now.strftime("%Y%m%d")
    payload = hashlib.sha256(b"").hexdigest()
    headers = {"host": urlparse(store.endpoint).netloc, "x-amz-content-sha256": payload, "x-amz-date": amz_date}
    signed, scope = ";".join(headers), f"{day}/{store.region}/s3/aws4_request"
    canonical = "\n".join(["PUT", f"/{store.bucket}", "", "".join(f"{k}:{v}\n" for k, v in headers.items()), signed, payload])
    to_sign = f"AWS4-HMAC-SHA256\n{amz_date}\n{scope}\n{hashlib.sha256(canonical.encode()).hexdigest()}"
    key = f"AWS4{store.secret}".encode()
    for part in (day, store.region, "s3", "aws4_request"):
        key = hmac.new(key, part.encode(), hashlib.sha256).digest()
    headers["Authorization"] = (f"AWS4-HMAC-SHA256 Credential={store.key_id}/{scope}, SignedHeaders={signed}, "
                                f"Signature={hmac.new(key, to_sign.encode(), hashlib.sha256).hexdigest()}")
    request = urllib.request.Request(f"{store.endpoint}/{store.bucket}", method="PUT", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=HTTP_TIMEOUT) as response:
            code = response.status
    except urllib.error.HTTPError as error:
        code = error.code
    assert code in (200, 409), f"CreateBucket {store.bucket}: {code}"


@contextmanager
def archive_relay() -> Iterator[None]:
    target = urlparse(os.environ["S3_ENDPOINT"])
    assert target.hostname and target.port, "S3_ENDPOINT must name a host and port"
    listener = socket.socket()
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", ARCHIVE_DOWN_PORT))
    listener.listen()
    open_sockets: list[socket.socket] = []

    def pump(source: socket.socket, sink: socket.socket) -> None:
        try:
            while chunk := source.recv(65536):
                sink.sendall(chunk)
        except OSError:
            pass
        finally:
            for side in (source, sink):
                try:
                    side.shutdown(socket.SHUT_RDWR)
                except OSError:
                    pass

    def accept() -> None:
        while True:
            try:
                client, _ = listener.accept()
            except OSError:
                return
            upstream = socket.create_connection((target.hostname, target.port))
            open_sockets.extend((client, upstream))
            threading.Thread(target=pump, args=(client, upstream), daemon=True).start()
            threading.Thread(target=pump, args=(upstream, client), daemon=True).start()

    threading.Thread(target=accept, daemon=True).start()
    try:
        yield
    finally:
        listener.shutdown(socket.SHUT_RDWR)
        listener.close()
        for sock in open_sockets:
            try:
                sock.close()
            except OSError:
                pass


def archive_down_url() -> str:
    return os.environ["APP_ARCHIVE_DOWN_URL"].rstrip("/")


def short_close_url() -> str:
    return os.environ["APP_SHORT_CLOSE_URL"].rstrip("/")


def archive_state(api: Api) -> str:
    return api.ok("/api/archive-status")["archive"]


def test_sign_up_and_sign_in_api(app_url: str) -> None:
    name, email, passcode = identity("owner")
    api = Api(app_url)
    invalid_errors = invalid(api.post("/api/owners", {"name": name, "email": email, "passcode": "short77"}))
    assert "passcode" in invalid_errors
    created = api.post("/api/owners", {"name": name, "email": email, "passcode": passcode})
    body = status(created, 201)
    assert body["email"] == email and body["name"] == name and body["role"] == "owner_master"
    assert passcode not in created.text
    me = api.ok("/api/me")
    assert me["id"] == body["id"] and me["role"] == "owner_master" and me["vessel_id"] is None
    assert me["today_ship_date"] is None
    parse(me["server_now_utc"])

    status(Api(app_url).post("/api/owners", {"name": name, "email": email, "passcode": passcode}), 409, "email_taken")
    status(api.call("DELETE", "/api/session"), 204)
    status(api.get("/api/me"), 401, "not_signed_in")

    status(Api(app_url).post("/api/session", {"email": email, "passcode": passcode + "x"}), 401, "bad_credentials")
    status(Api(app_url).post("/api/session", {"email": "x" + email, "passcode": passcode}), 401, "bad_credentials")
    again = Api(app_url)
    session_body = status(again.post("/api/session", {"email": email, "passcode": passcode}), 200)
    assert session_body["role"] == "owner_master" and session_body["vessel_id"] is None

    ines = Api(app_url)
    crew_body = status(ines.post("/api/session", {"email": INES[0], "passcode": INES[1]}), 200)
    assert crew_body["id"] == "crew-ines" and crew_body["role"] == "crew" and crew_body["vessel_id"] == "vessel-surveyor"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", ines.ok("/api/me")["today_ship_date"])


def test_protected_pages_and_endpoints_refused_signed_out(app_url: str, browser: Browser) -> None:
    anonymous = Api(app_url)
    for path in (
        "/api/me", "/api/vessels", "/api/archive-status", "/api/vessels/vessel-surveyor/crew",
        "/api/crew/crew-ines/days/2026-09-08", "/api/crew/crew-ines/rolling", "/api/crew/crew-ines/breaches",
        f"/api/vessels/{JUNK}/crew",
    ):
        refused = anonymous.get(path)
        status(refused, 401, "not_signed_in")
        assert "Ines" not in refused.text
    status(anonymous.post("/api/watch-entries", entry(SEED_STRIP, SEED_STRIP, "rest")), 401, "not_signed_in")
    status(anonymous.post("/api/vessels", {"name": "x", "kind": "workboat", "initial_offset_minutes": 0}), 401, "not_signed_in")
    status(anonymous.post(f"/api/crew/{SEED_TOMAS}/months/{SEED_MONTH}/seal"), 401, "not_signed_in")

    with open_app(browser, f"{app_url}/") as page:
        for path in ("/fleet", "/log", "/vessels/vessel-surveyor", "/voyage/vessel-surveyor/crew-ines"):
            visit(page, f"{app_url}{path}")
            eventually(page, lambda: expect(page).to_have_url(f"{app_url.rstrip('/')}/", timeout=QUICK_MS))
            expect(role(page, "heading", "Sixbell Rest Log")).to_be_visible()
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, app_url.rstrip("/"), *AILSA)
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/fleet$"), timeout=QUICK_MS))
        visit(page, f"{app_url}/")
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/fleet$"), timeout=QUICK_MS))
    with open_app(browser, f"{app_url}/") as page:
        sign_in(page, app_url.rstrip("/"), *INES)
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/log$"), timeout=QUICK_MS))


def test_vessel_limit_and_crew(app_url: str) -> None:
    owner, _, _ = new_owner(app_url)
    invalid_errors = invalid(owner.post("/api/vessels", {"name": "Bad kind", "kind": "submarine", "initial_offset_minutes": 0}))
    assert "kind" in invalid_errors
    ids = []
    for index in range(4):
        body = status(owner.post("/api/vessels", {"name": f"Boat {index}", "kind": "coaster", "initial_offset_minutes": 60}), 201)
        assert body["name"] == f"Boat {index}" and body["kind"] == "coaster" and body["current_offset_minutes"] == 60
        ids.append(body["id"])
    status(owner.post("/api/vessels", {"name": "Boat five", "kind": "coaster", "initial_offset_minutes": 0}), 409, "vessel_limit")
    listed = owner.ok("/api/vessels")["vessels"]
    assert sorted(v["id"] for v in listed) == sorted(ids)

    name, email, passcode = identity("crew")
    added = owner.post(f"/api/vessels/{ids[0]}/crew", {"name": name, "rank": "Deckhand", "email": email, "passcode": passcode})
    body = status(added, 201)
    assert body["name"] == name and body["rank"] == "Deckhand" and body["email"] == email
    assert passcode not in added.text
    crew_list = owner.ok(f"/api/vessels/{ids[0]}/crew")["crew"]
    assert [c["id"] for c in crew_list] == [body["id"]]
    assert owner.ok(f"/api/vessels/{ids[1]}/crew")["crew"] == []
    status(owner.post(f"/api/vessels/{ids[1]}/crew", {"name": name, "rank": "Deckhand", "email": email, "passcode": passcode}), 409, "email_taken")
    crew_api = signed_in(app_url, (email, passcode))
    assert crew_api.ok("/api/me")["vessel_id"] == ids[0]
    status(crew_api.post("/api/vessels", {"name": "Mine", "kind": "coaster", "initial_offset_minutes": 0}), 403, "forbidden")


def test_owner_isolation(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    stranger, stranger_email, stranger_passcode = new_owner(world.base)
    log_spans(world.crew, PAST_DAY, GOOD_DAY)
    assert world.vessel_id not in [v["id"] for v in stranger.ok("/api/vessels")["vessels"]]
    for path in (
        f"/api/vessels/{world.vessel_id}/crew", f"/api/vessels/{world.vessel_id}/fixes",
        f"/api/vessels/{world.vessel_id}/clock-changes", f"/api/vessels/{world.vessel_id}/rule-sets",
        f"/api/vessels/{world.vessel_id}/inspection-links", f"/api/crew/{world.crew.id}/days/{PAST_DAY}",
        f"/api/crew/{world.crew.id}/breaches", f"/api/crew/{world.crew.id}/months/{PAST_MONTH}",
    ):
        refused = stranger.get(path)
        status(refused, 404, "not_found")
        assert world.crew.name not in refused.text
    for garbled in GARBLED_IDS:
        refused_garbled(world.owner.get(f"/api/vessels/{garbled}/crew"))
        refused_garbled(world.owner.get(f"/api/crew/{garbled}/days/{PAST_DAY}"))
    status(stranger.post(f"/api/vessels/{world.vessel_id}/crew", {"name": "x", "rank": "y", "email": "z@sixbell.example", "passcode": "longenough1"}), 404, "not_found")
    assert world.owner.ok(f"/api/vessels/{world.vessel_id}/crew")["crew"][0]["id"] == world.crew.id

    neighbour = add_crew(world.base, world.owner, world.vessel_id)
    status(neighbour.api.get(f"/api/crew/{world.crew.id}/days/{PAST_DAY}"), 403, "forbidden")
    status(world.crew.api.post(f"/api/vessels/{world.vessel_id}/events", {"crew_id": world.crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "04:00"), "end_utc": at(PAST_DAY, "05:00"), "description": "x"}), 403, "forbidden")

    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, stranger_email, stranger_passcode)
        see(page, role(page, "heading", "Your vessels"))
        expect(role(page, "link", world.vessel_name)).to_have_count(0)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        see(page, page.locator("body"))
        expect(page.locator("body")).not_to_contain_text(world.vessel_name)
        expect(page.locator("body")).not_to_contain_text(world.crew.name)


def test_clock_change_accepted_with_fix_and_zone(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    path = f"/api/vessels/{world.vessel_id}/clock-changes"

    def change(ship_date: str, clock: str, offset_now: int, new_offset: int, longitude: float) -> dict[str, Any]:
        return status(world.owner.post(path, {"changes_at_utc": at(ship_date, clock, offset_now), "new_offset_minutes": new_offset, "latitude": FIX_LATITUDE, "longitude": longitude}), 201)

    retard = change(FIRST_CHANGE_DAY, "02:00", 0, -60, -12)
    assert retard["old_offset_minutes"] == 0 and retard["new_offset_minutes"] == -60
    assert retard["kind"] == "retard" and retard["label"] == "+1 h"
    assert retard["ship_date"] == FIRST_CHANGE_DAY and retard["ship_date_cells"] == 50
    assert retard["nautical_zone"] == -1 and retard["zone_warning"] is False
    fixes = world.owner.ok(f"/api/vessels/{world.vessel_id}/fixes")["fixes"]
    stored = [f for f in fixes if f["id"] == retard["fix_id"]]
    assert stored and stored[0]["at_utc"] == at(FIRST_CHANGE_DAY, "02:00") and float(stored[0]["longitude"]) == -12 and float(stored[0]["latitude"]) == FIX_LATITUDE
    assert world.owner.ok("/api/vessels")["vessels"][0]["current_offset_minutes"] == -60

    far = change("2026-08-02", "03:00", -60, 30, 90)
    assert far["kind"] == "advance" and far["label"] == f"-{(30 + 60) / 60} h" and far["ship_date_cells"] == 45
    assert far["nautical_zone"] == 6 and far["zone_warning"] is True
    half_up = change("2026-08-03", "03:00", 30, 60, 22.5)
    assert half_up["nautical_zone"] == 2 and half_up["zone_warning"] is False and half_up["label"] == "-0.5 h" and half_up["ship_date_cells"] == 47
    half_down = change("2026-08-04", "03:00", 60, 30, -22.5)
    assert half_down["nautical_zone"] == -2 and half_down["zone_warning"] is True and half_down["ship_date_cells"] == 49
    listed = world.owner.ok(path)["clock_changes"]
    assert {c["id"] for c in listed} >= {retard["id"], far["id"], half_up["id"], half_down["id"]}

    fix_path = f"/api/vessels/{world.vessel_id}/fixes"
    fix = status(world.owner.post(fix_path, {"at_utc": at("2026-08-05", "06:00"), "latitude": 1.5, "longitude": 2.5}), 201)
    assert fix["at_utc"] == at("2026-08-05", "06:00")
    invalid(world.owner.post(fix_path, {"at_utc": at("2026-08-05", "06:00"), "latitude": 1.5, "longitude": 2.5}))
    for garbled in GARBLED_IDS:
        refused_garbled(world.owner.get(f"/api/vessels/{garbled}/clock-changes"))
        refused_garbled(world.owner.get(f"/api/vessels/{garbled}/fixes"))


def test_clock_change_illegal_rejected(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    path = f"/api/vessels/{world.vessel_id}/clock-changes"
    first = {"changes_at_utc": at("2026-08-10", "02:00"), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}
    status(world.owner.post(path, first), 201)
    baseline = len(world.owner.ok(f"/api/vessels/{world.vessel_id}/fixes")["fixes"])
    cases = [
        (at("2026-08-12", "02:15", -60), 0, "changes_at_utc"),
        (at("2026-08-12", "02:00", -60), 15, "new_offset_minutes"),
        (at("2026-08-12", "02:00", -60), 870, "new_offset_minutes"),
        (at("2026-08-12", "02:00", -60), -750, "new_offset_minutes"),
        (at("2026-08-12", "02:00", -60), -60, "new_offset_minutes"),
        (at("2026-08-09", "02:00", 0), 60, "changes_at_utc"),
        (at("2026-08-10", "20:00", -60), 0, "changes_at_utc"),
        (at("2026-08-12", "00:30", -60), -120, "changes_at_utc"),
        (at("2026-08-12", "23:30", -60), 0, "changes_at_utc"),
    ]
    for instant, offset, where in cases:
        errors = invalid(world.owner.post(path, {"changes_at_utc": instant, "new_offset_minutes": offset, "latitude": 1, "longitude": 1}))
        assert where in errors, (instant, offset, errors)
    assert len(world.owner.ok(path)["clock_changes"]) == 1
    assert len(world.owner.ok(f"/api/vessels/{world.vessel_id}/fixes")["fixes"]) == baseline
    status(world.crew.api.post(path, first), 403, "forbidden")


def test_wf_vessel_setup_and_clock_happy(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    owner_name, email, passcode = identity("owner")
    vessel_name, _, _ = identity("vessel")
    crew_name, crew_email, crew_passcode = identity("crew")
    with open_app(browser, f"{base}/") as page:
        expect(role(page, "heading", "Sixbell Rest Log")).to_be_visible()
        dialog = open_dialog(page, role(page, "button", "Create an owner account"), "Create an owner account")
        fill(role(dialog, "textbox", "Your name"), owner_name)
        fill(role(dialog, "textbox", "Email"), email)
        fill(role(dialog, "textbox", "Passcode"), passcode)
        click(role(dialog, "button", "Create account"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/fleet$"), timeout=QUICK_MS))
        see(page, role(page, "heading", "Your vessels"))

        dialog = open_dialog(page, role(page, "button", "Add a vessel"), "Add a vessel")
        fill(role(dialog, "textbox", "Vessel name"), vessel_name)
        pick(role(dialog, "combobox", "Vessel type"), "survey_boat")
        fill(role(dialog, "textbox", "Starting offset in minutes"), "0")
        click(role(dialog, "button", "Save vessel"))
        says(page, role(page, "status", "Feedback"), "Vessel saved.")
        click(role(page, "link", vessel_name))
        see(page, role(page, "heading", vessel_name))
        for region in ("Crew", "Clock changes", "Rota", "Rule sets", "Drills and call-outs", "Inspection links"):
            expect(role(page, "region", region)).to_be_visible()

        crew_region = role(page, "region", "Crew")
        dialog = open_dialog(page, role(crew_region, "button", "Add crew"), "Add crew")
        fill(role(dialog, "textbox", "Name"), crew_name)
        fill(role(dialog, "textbox", "Rank"), "Deckhand")
        fill(role(dialog, "textbox", "Email"), crew_email)
        fill(role(dialog, "textbox", "Passcode"), crew_passcode)
        click(role(dialog, "button", "Save crew member"))
        says(page, role(page, "status", "Feedback"), "Crew member saved.")
        see(page, role(crew_region, "link", f"Review {crew_name}"))

        clock_region = role(page, "region", "Clock changes")
        dialog = open_dialog(page, role(clock_region, "button", "Log clock change"), "Log clock change")
        fill(role(dialog, "textbox", "Change time in UTC"), at(PAST_DAY, "02:00"))
        fill(role(dialog, "textbox", "New offset in minutes"), "-60")
        fill(role(dialog, "textbox", "Latitude"), "49.25")
        fill(role(dialog, "textbox", "Longitude"), "-12.5")
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Clock change saved.")
        says(page, clock_region, "+1 h")
        page.reload()
        says(page, role(page, "region", "Clock changes"), "+1 h")
        says(page, role(page, "region", "Crew"), crew_name)

    api = signed_in(base, (email, passcode))
    vessel = next(v for v in api.ok("/api/vessels")["vessels"] if v["name"] == vessel_name)
    assert vessel["kind"] == "survey_boat" and vessel["current_offset_minutes"] == -60
    change = api.ok(f"/api/vessels/{vessel['id']}/clock-changes")["clock_changes"][0]
    assert change["changes_at_utc"] == at(PAST_DAY, "02:00") and change["new_offset_minutes"] == -60
    fix = api.ok(f"/api/vessels/{vessel['id']}/fixes")["fixes"][0]
    assert fix["at_utc"] == at(PAST_DAY, "02:00") and float(fix["longitude"]) == -12.5
    assert signed_in(base, (crew_email, crew_passcode)).ok("/api/me")["vessel_id"] == vessel["id"]


def test_wf_vessel_setup_and_clock_recovery(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    with open_app(browser, f"{world.base}/") as page:
        dialog = open_dialog(page, role(page, "button", "Create an owner account"), "Create an owner account")
        fill(role(dialog, "textbox", "Your name"), "Second owner")
        fill(role(dialog, "textbox", "Email"), world.owner_email)
        fill(role(dialog, "textbox", "Passcode"), world.owner_passcode)
        click(role(dialog, "button", "Create account"))
        says(page, role(page, "status", "Feedback"), "That email already has an account.")

    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        clock_region = role(page, "region", "Clock changes")
        opener = role(clock_region, "button", "Log clock change")
        dialog = open_dialog(page, opener, "Log clock change")
        fill(role(dialog, "textbox", "Change time in UTC"), at(PAST_DAY, "00:30"))
        fill(role(dialog, "textbox", "New offset in minutes"), "-60")
        fill(role(dialog, "textbox", "Latitude"), "10")
        fill(role(dialog, "textbox", "Longitude"), "30")
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Pick a time that keeps the clock change inside one ship's day.")
        path = f"/api/vessels/{world.vessel_id}/clock-changes"
        assert world.owner.ok(path)["clock_changes"] == []

        if dialog.count():
            page.keyboard.press("Escape")
            gone(page, dialog)
        dialog = open_dialog(page, opener, "Log clock change")
        fill(role(dialog, "textbox", "Change time in UTC"), at(PAST_DAY, "02:00"))
        fill(role(dialog, "textbox", "New offset in minutes"), "-60")
        fill(role(dialog, "textbox", "Latitude"), "10")
        fill(role(dialog, "textbox", "Longitude"), "30")
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Clock change saved.")
        see(page, page.get_by_text("The new offset is more than 1 hour from the nautical zone for this longitude. Ships may keep port time, so the change is saved."))
    saved = world.owner.ok(path)["clock_changes"]
    assert len(saved) == 1 and saved[0]["zone_warning"] is True


def test_wf_vessel_setup_and_clock_unaligned_change(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    path = f"/api/vessels/{world.vessel_id}/clock-changes"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = clock_change_dialog(page, world, "2026-08-11T02:15:00Z", "-60")
        held_with_error(page, dialog, role(dialog, "textbox", "Change time in UTC"))
        assert world.owner.ok(path)["clock_changes"] == []
        fill(role(dialog, "textbox", "Change time in UTC"), at(PAST_DAY, "02:00"))
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Clock change saved.")
    assert len(world.owner.ok(path)["clock_changes"]) == 1


def test_wf_vessel_setup_and_clock_offset_step(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    path = f"/api/vessels/{world.vessel_id}/clock-changes"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = clock_change_dialog(page, world, at(PAST_DAY, "02:00"), "45")
        held_with_error(page, dialog, role(dialog, "textbox", "New offset in minutes"))
        assert world.owner.ok(path)["clock_changes"] == []
        fill(role(dialog, "textbox", "New offset in minutes"), "60")
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Clock change saved.")
    saved = world.owner.ok(path)["clock_changes"]
    assert len(saved) == 1 and saved[0]["new_offset_minutes"] == 60


def test_wf_vessel_setup_and_clock_earlier_change(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    path = f"/api/vessels/{world.vessel_id}/clock-changes"
    status(world.owner.post(path, {"changes_at_utc": at(PAST_DAY, "02:00"), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}), 201)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = clock_change_dialog(page, world, "2026-08-05T02:00:00Z", "60")
        held_with_error(page, dialog, role(dialog, "textbox", "Change time in UTC"))
        assert len(world.owner.ok(path)["clock_changes"]) == 1
        fill(role(dialog, "textbox", "Change time in UTC"), "2026-08-12T05:00:00Z")
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Clock change saved.")
    assert len(world.owner.ok(path)["clock_changes"]) == 2


def test_wf_vessel_setup_and_clock_repeated_fix(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    path = f"/api/vessels/{world.vessel_id}/fixes"
    status(world.owner.post(path, {"at_utc": at(PAST_DAY, "06:00"), "latitude": 1, "longitude": 2}), 201)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = open_dialog(page, role(role(page, "region", "Clock changes"), "button", "Add position fix"), "Add position fix")
        fill(role(dialog, "textbox", "Fix time in UTC"), at(PAST_DAY, "06:00"))
        fill(role(dialog, "textbox", "Latitude"), "3")
        fill(role(dialog, "textbox", "Longitude"), "4")
        click(role(dialog, "button", "Save fix"))
        held_with_error(page, dialog)
        assert len(world.owner.ok(path)["fixes"]) == 1
        fill(role(dialog, "textbox", "Fix time in UTC"), at(PAST_DAY, "06:30"))
        click(role(dialog, "button", "Save fix"))
        says(page, role(page, "status", "Feedback"), "Saved.")
    assert len(world.owner.ok(path)["fixes"]) == 2


def test_wf_vessel_setup_and_clock_ship_time(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    vessel = f"/api/vessels/{world.vessel_id}"
    zone = "Pacific/Kiritimati"
    with open_app(browser, f"{world.base}/") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = open_dialog(page, role(role(page, "region", "Clock changes"), "button", "Log clock change"), "Log clock change")
        fill(role(dialog, "textbox", "Change time in UTC"), at(PAST_DAY, "02:00"))
        fill(role(dialog, "textbox", "New offset in minutes"), "-60")
        fill(role(dialog, "textbox", "Latitude"), "49.25")
        fill(role(dialog, "textbox", "Longitude"), "-12.5")
        click(role(dialog, "button", "Save clock change"))
        says(page, role(page, "status", "Feedback"), "Clock change saved.")
        gone(page, dialog)

        dialog = open_dialog(page, role(role(page, "region", "Rota"), "button", "Add watch"), "Add watch")
        pick(role(dialog, "combobox", "Crew member"), crew.name)
        fill(role(dialog, "textbox", "Watch name"), "Morning watch")
        fill(role(dialog, "textbox", "Start time"), "00:00")
        fill(role(dialog, "textbox", "End time"), "04:00")
        fill(role(dialog, "textbox", "First ship's date"), PAST_DAY)
        fill(role(dialog, "textbox", "Last ship's date"), PAST_DAY_NEXT)
        click(role(dialog, "button", "Save watch"))
        says(page, role(page, "status", "Feedback"), "Saved.")

    days = {d["ship_date"]: d for d in world.owner.ok(f"{vessel}/rota?crew_id={crew.id}&from={PAST_DAY}&to={PAST_DAY_NEXT}")["days"]}
    for ship_date, cells, elapsed in ((PAST_DAY, 50, 5), (PAST_DAY_NEXT, CELLS_PER_DAY, 4)):
        day = days[ship_date]
        watch = day["watches"][0]
        assert day["cell_count"] == cells and float(day["planned_rest_hours"]) == 20
        assert (watch["start_ship_time"], watch["end_ship_time"]) == ("00:00", "04:00") and float(watch["elapsed_hours"]) == elapsed

    body = entry(at(PAST_DAY_NEXT, "00:30"), at(PAST_DAY_NEXT, "01:00"), "work")
    filed = status(crew.api.post("/api/watch-entries/sync", {"entries": [body]}), 200)["results"][0]
    assert filed["entry"]["ship_date"] == PAST_DAY
    with open_app(browser, f"{world.base}/") as page:
        session(page).send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        sign_in(page, world.base, crew.email, crew.passcode)
        visit(page, f"{world.base}/log?date={PAST_DAY}")
        eventually(page, lambda: expect(page.get_by_role("gridcell")).to_have_count(50, timeout=QUICK_MS))
        see(page, cell(page, "23:30", "Work"))
        see(page, cell(page, "01:00", "Not logged repeated"))


def test_ships_day_filing_uses_vessel_offset(app_url: str) -> None:
    base = app_url.rstrip("/")
    east = make_world(base, 120)
    instant = at(PAST_DAY, "22:00")
    results = status(east.crew.api.post("/api/watch-entries/sync", {"entries": [entry(instant, at(PAST_DAY, "22:30"), "rest")]}), 200)["results"]
    assert results[0]["entry"]["ship_date"] == PAST_DAY_NEXT
    day = day_of(east.crew.api, east.crew.id, PAST_DAY_NEXT)
    assert day["start_utc"] == instant and day["cell_count"] == CELLS_PER_DAY
    assert day["cells"][0]["start_utc"] == instant and day["cells"][0]["state"] != "not_logged" and day["cells"][0]["ship_time"] == "00:00"
    assert all(c["state"] == "not_logged" for c in day_of(east.crew.api, east.crew.id, PAST_DAY)["cells"])

    straddle = status(east.crew.api.post("/api/watch-entries/sync", {"entries": [entry(at(PAST_DAY, "21:30"), at(PAST_DAY, "22:30"), "rest")]}), 200)["results"][0]
    assert straddle["outcome"] == "rejected" and straddle["entry"] is None and straddle["errors"]

    world = make_world(base)
    path = f"/api/vessels/{world.vessel_id}/clock-changes"
    status(world.owner.post(path, {"changes_at_utc": at(FILING_CHANGE_DAY, "02:00"), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}), 201)
    late_utc = at("2026-08-04", "00:30")
    filed = status(world.crew.api.post("/api/watch-entries/sync", {"entries": [entry(late_utc, at("2026-08-04", "01:00"), "work")]}), 200)["results"][0]
    assert filed["entry"]["ship_date"] == FILING_CHANGE_DAY
    long_day = day_of(world.crew.api, world.crew.id, FILING_CHANGE_DAY)
    assert long_day["cell_count"] == 50 and len(long_day["cells"]) == 50
    assert [c["ship_time"] for c in long_day["cells"] if c["repeated"]] == ["01:00", "01:30"]
    status(world.owner.post(path, {"changes_at_utc": at("2026-08-05", "03:00", -60), "new_offset_minutes": -30, "latitude": 1, "longitude": 1}), 201)
    assert day_of(world.owner, world.crew.id, "2026-08-05")["cell_count"] == 47
    status(world.owner.post(path, {"changes_at_utc": at("2026-08-06", "03:00", -30), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}), 201)
    assert day_of(world.owner, world.crew.id, "2026-08-06")["cell_count"] == 49

    ines = signed_in(base, INES)
    assert day_of(ines, "crew-ines", "2026-09-10")["cell_count"] == 50
    assert day_of(ines, "crew-ines", "2026-09-16")["cell_count"] == 46
    assert day_of(ines, "crew-ines", "2026-09-09")["cell_count"] == CELLS_PER_DAY


def test_rolling_totals_server_values(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    path = f"/api/crew/{crew.id}/rolling"
    before = crew.api.ok(path)
    assert float(before["rest_hours_24"]) == 0 and float(before["rest_hours_168"]) == 0
    status(crew.api.post("/api/watch-entries", entry(at(date, "08:00", world.offset), at(date, "10:00", world.offset), "rest")), 201)
    after = crew.api.ok(path)
    assert float(after["rest_hours_24"]) == 2 and float(after["rest_hours_168"]) == 2
    assert after["verdict_24"] == "incomplete"
    status(crew.api.post("/api/watch-entries", entry(at(date, "10:30", world.offset), at(date, "11:00", world.offset), "rest")), 201)
    assert float(crew.api.ok(path)["rest_hours_24"]) == 2
    clipped = crew.api.ok(f"{path}?as_of={at(date, '09:00', world.offset)}")
    assert clipped["as_of_utc"] == at(date, "09:00", world.offset) and float(clipped["rest_hours_24"]) == 1
    invalid(crew.api.get(f"{path}?as_of={at(date, '09:10', world.offset)}"))
    for garbled in GARBLED_IDS:
        refused_garbled(crew.api.get(f"/api/crew/{garbled}/rolling"))

    tomas = signed_in(world.base, TOMAS)
    seeded = tomas.ok("/api/crew/crew-tomas/rolling?as_of=2026-09-14T00:00:00Z")
    assert float(seeded["rest_hours_24"]) == 11 and seeded["verdict_24"] == "breach"
    assert float(seeded["rest_hours_168"]) == 77 and seeded["verdict_168"] == "pass"

    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        region = role(page, "region", "Rolling totals")
        says(page, region, "2.0 hours in the last 24 hours")
        says(page, region, "2.0 hours in the last 7 days")
        click(cell(page, "10:00", "Not logged"))
        says(page, region, "3.0 hours in the last 24 hours")
        says(page, region, "3.0 hours in the last 7 days")
    shown = crew.api.ok(path)
    assert float(shown["rest_hours_24"]) == 3 and float(shown["rest_hours_168"]) == 3


def test_keyboard_watch_grid(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    date = today(world)

    def writes() -> int:
        return len(day_of(world.crew.api, world.crew.id, date)["entries"])

    with open_app(browser, f"{world.base}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, world.base, world.crew.email, world.crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        cells = page.get_by_role("gridcell")
        eventually(page, lambda: expect(cells).to_have_count(CELLS_PER_DAY, timeout=QUICK_MS))
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        for _ in range(TAB_LIMIT):
            page.keyboard.press("Tab")
            if focused_cell_index(page) >= 0:
                break
        index = focused_cell_index(page)
        assert index >= 0, "the grid is not reachable by Tab"
        assert_focus_ring(page)
        while index > 20:
            page.keyboard.press("ArrowLeft")
            index -= 1
        while index < 20:
            page.keyboard.press("ArrowRight")
            index += 1
        assert focused_cell_index(page) == 20
        page.keyboard.press("ArrowRight")
        assert focused_cell_index(page) == 21
        page.keyboard.press("ArrowLeft")
        assert focused_cell_index(page) == 20
        page.keyboard.press("ArrowDown")
        assert focused_cell_index(page) == 32
        page.keyboard.press("ArrowUp")
        assert focused_cell_index(page) == 20
        assert_focus_ring(page)

        sync_status = role(page, "status", "Sync status")
        page.keyboard.press("Space")
        see(page, cell(page, "10:00", "Rest under one hour"))
        says(page, sync_status, "Saved.")
        see(page, page.get_by_text("Breaks under one hour do not count as rest."))
        poll(writes, lambda n: n == 1, "one saved entry", UI_DEADLINE)
        page.keyboard.press("r")
        advance(page, QUICK_MS)
        assert writes() == 1
        page.keyboard.press("Space")
        see(page, cell(page, "10:00", "Work"))
        eventually(page, lambda: expect(page.get_by_text("Breaks under one hour do not count as rest.")).to_have_count(0, timeout=QUICK_MS))
        poll(writes, lambda n: n == 2, "two saved entries", UI_DEADLINE)
        page.keyboard.press("w")
        advance(page, QUICK_MS)
        assert writes() == 2
        page.keyboard.press("Enter")
        see(page, cell(page, "10:00", "Rest under one hour"))
        page.keyboard.press("w")
        see(page, cell(page, "10:00", "Work"))
        page.keyboard.press("r")
        see(page, cell(page, "10:00", "Rest under one hour"))
        page.keyboard.press("ArrowRight")
        page.keyboard.press("r")
        see(page, cell(page, "10:00", "Rest"))
        see(page, cell(page, "10:30", "Rest"))
        says(page, sync_status, "Saved.")
        assert focused_cell_index(page) == 21
        assert_focus_ring(page)
        written = poll(writes, lambda n: n == 6, "six saved entries", UI_DEADLINE)

        page.keyboard.press("Tab")
        assert focused_cell_index(page) == -1, "the grid is more than one Tab stop"

    day = day_of(world.crew.api, world.crew.id, today(world))
    assert len(day["entries"]) == written
    assert float(day["rest_hours"]) == 1


def test_wf_crew_daily_log_happy(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    with open_app(browser, f"{world.base}/") as page:
        page.set_viewport_size(PHONE)
        sign_in(page, world.base, world.crew.email, world.crew.passcode)
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/log$"), timeout=QUICK_MS))
        grid = role(page, "grid", "Watch grid")
        see(page, grid)
        eventually(page, lambda: expect(page.get_by_role("gridcell", name=re.compile(r"Not logged$"))).to_have_count(CELLS_PER_DAY, timeout=QUICK_MS))
        says(page, role(page, "status", "Day status"), "Open")
        totals = role(page, "region", "Rolling totals")
        says(page, totals, "0.0 hours in the last 24 hours")
        says(page, totals, "0.0 hours in the last 7 days")

        click(cell(page, "08:00", "Not logged"))
        see(page, cell(page, "08:00", "Rest under one hour"))
        says(page, role(page, "status", "Sync status"), "Saved.")
        says(page, totals, "0.0 hours in the last 24 hours")

        focus_cell(cell(page, "08:30", "Not logged"))
        page.keyboard.press("r")
        see(page, cell(page, "08:00", "Rest"))
        see(page, cell(page, "08:30", "Rest"))
        says(page, totals, "1.0 hours in the last 24 hours")

        first = cell(page, "09:00", "Not logged")
        last = cell(page, "10:00", "Not logged")
        first.scroll_into_view_if_needed()
        page.mouse.move(*center(first))
        page.mouse.down()
        page.mouse.move(*center(cell(page, "09:30", "Not logged")), steps=4)
        page.mouse.move(*center(last), steps=4)
        page.mouse.up()
        for clock in ("09:00", "09:30", "10:00"):
            see(page, cell(page, clock, "Rest"))
        says(page, totals, "2.5 hours in the last 24 hours")
        says(page, totals, "2.5 hours in the last 7 days")

    crew = world.crew
    day = day_of(crew.api, crew.id, today(world))
    assert float(day["rest_hours"]) == 2.5
    rolling = crew.api.ok(f"/api/crew/{crew.id}/rolling")
    assert float(rolling["rest_hours_24"]) == 2.5 and float(rolling["rest_hours_168"]) == 2.5
    assert {e["ship_date"] for e in day["entries"]} == {day["ship_date"]}


def test_wf_crew_daily_log_booked_clock_change(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/clock-changes", {"changes_at_utc": at(shift_date(date, 1), "02:00", world.offset), "new_offset_minutes": world.offset + 60, "latitude": 1, "longitude": 15}), 201)
    closes = day_of(crew.api, crew.id, date)["closes_at_utc"]
    line = f"You can edit this ship's day until {ship_reading(closes, world.offset + 60)}."
    with open_app(browser, f"{world.base}/") as page:
        page.set_viewport_size(PHONE)
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        says(page, role(page, "status", "Day status"), "Open")
        see(page, page.get_by_text(line))
        click(cell(page, "08:00", "Not logged"))
        says(page, role(page, "status", "Sync status"), "Saved.")
        see(page, page.get_by_text(line))
    assert len(day_of(crew.api, crew.id, date)["entries"]) == 1


def test_wf_crew_daily_log_phone_zone(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    date = today(world)
    zone = "Pacific/Kiritimati" if world.offset < 120 else "Etc/GMT+12"
    with open_app(browser, f"{world.base}/") as page:
        cdp = session(page)
        cdp.send("Emulation.setTimezoneOverride", {"timezoneId": zone})
        phone_date = page.evaluate("() => { const d = new Date(); return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join('-'); }")
        sign_in(page, world.base, world.crew.email, world.crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        closes = at(shift_date(date, 3), "00:00", world.offset)
        see(page, page.get_by_text(f"You can edit this ship's day until {ship_reading(closes, world.offset)}."))
        click(cell(page, "00:00", "Not logged"))
        see(page, cell(page, "00:00", "Rest under one hour"))
        click(cell(page, "23:30", "Not logged"))
        see(page, cell(page, "23:30", "Rest under one hour"))
    day = day_of(world.crew.api, world.crew.id, date)
    assert {e["ship_date"] for e in day["entries"]} == {date}
    assert {e["start_utc"] for e in day["entries"]} == {at(date, "00:00", world.offset), at(date, "23:30", world.offset)}
    assert phone_date == date or len(day["entries"]) == 2


def test_wf_offline_sync_happy(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    banner = "Logging on board. Entries will sync when the ship reconnects."
    with open_offline_app(browser, f"{world.base}/") as page:
        page.set_viewport_size(PHONE)
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        click(cell(page, "08:00", "Not logged"))
        says(page, role(page, "status", "Sync status"), "Saved.")
        prime_offline(page)

        page.context.set_offline(True)
        connection = role(page, "status", "Connection")
        says(page, connection, banner)
        says(page, connection, "0 queued")
        click(cell(page, "08:30", "Not logged"))
        see(page, cell(page, "08:30", "Rest"))
        says(page, connection, "1 queued")
        says(page, role(page, "status", "Sync status"), "Queued.")
        click(cell(page, "09:00", "Not logged"))
        see(page, cell(page, "09:00", "Rest"))
        says(page, connection, "2 queued")

        page.reload()
        see(page, role(page, "grid", "Watch grid"))
        connection = role(page, "status", "Connection")
        says(page, connection, banner)
        says(page, connection, "2 queued")
        see(page, cell(page, "08:30", "Rest"))
        see(page, cell(page, "09:00", "Rest"))
        click(cell(page, "09:30", "Not logged"))
        see(page, cell(page, "09:30", "Rest"))
        says(page, connection, "3 queued")
        assert len(day_of(crew.api, crew.id, date)["entries"]) == 1

        page.context.set_offline(False)
        says(page, role(page, "status", "Sync status"), "Synced 3 entries.")
        stops_saying(page, role(page, "status", "Connection"), banner)
        says(page, role(page, "region", "Rolling totals"), "2.0 hours in the last 24 hours")
        see(page, cell(page, "08:00", "Rest"))

    day = day_of(crew.api, crew.id, date)
    assert len(day["entries"]) == 4 and float(day["rest_hours"]) == 2
    assert not any(e["late"] for e in day["entries"])
    assert float(crew.api.ok(f"/api/crew/{crew.id}/rolling")["rest_hours_24"]) == 2


def test_offline_log_earlier_days_after_reload(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date, offset = world.crew, today(world), world.offset
    yesterday, two_ago = shift_date(date, -1), shift_date(date, -2)
    banner = "Logging on board. Entries will sync when the ship reconnects."
    with open_offline_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        prime_offline(page)
        page.context.set_offline(True)
        says(page, role(page, "status", "Connection"), banner)
        says(page, role(page, "status", "Connection"), "0 queued")
        page.reload()
        see(page, role(page, "grid", "Watch grid"))
        says(page, role(page, "status", "Connection"), banner)

        click(role(page, "button", "Previous ship's day"))
        see(page, cell(page, "08:00", "Not logged"))
        click(cell(page, "08:00", "Not logged"))
        see(page, cell(page, "08:00", "Rest"))
        says(page, role(page, "status", "Connection"), "1 queued")
        says(page, role(page, "status", "Sync status"), "Queued.")

        click(role(page, "button", "Previous ship's day"))
        see(page, cell(page, "08:30", "Not logged"))
        click(cell(page, "08:30", "Not logged"))
        see(page, cell(page, "08:30", "Rest"))
        says(page, role(page, "status", "Connection"), "2 queued")

        page.reload()
        see(page, role(page, "grid", "Watch grid"))
        says(page, role(page, "status", "Connection"), banner)
        says(page, role(page, "status", "Connection"), "2 queued")
        assert day_of(crew.api, crew.id, yesterday)["entries"] == []
        assert day_of(crew.api, crew.id, two_ago)["entries"] == []

        page.context.set_offline(False)
        says(page, role(page, "status", "Sync status"), "Synced 2 entries.")
        stops_saying(page, role(page, "status", "Connection"), banner)

    first = day_of(crew.api, crew.id, yesterday)["entries"]
    second = day_of(crew.api, crew.id, two_ago)["entries"]
    assert [(e["start_utc"], e["kind"], e["late"]) for e in first] == [(at(yesterday, "08:00", offset), "rest", False)]
    assert [(e["start_utc"], e["kind"], e["late"]) for e in second] == [(at(two_ago, "08:30", offset), "rest", False)]


def test_offline_actions_stay_in_place(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    log_spans(crew, date, [["08:00", "10:00", "rest"]], world.offset)
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/events", {"crew_id": crew.id, "kind": "drill", "start_utc": at(date, "08:00", world.offset), "end_utc": at(date, "09:00", world.offset), "description": "Boat drill"}), 201)
    with open_offline_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        see(page, role(page, "button", "Add a note to this mismatch"))
        prime_offline(page)
        page.context.set_offline(True)
        says(page, role(page, "status", "Connection"), "0 queued")
        requests = track_api(page)
        day_status = role(page, "status", "Day status")
        for name, dialog_name, message in (
            ("Sign this day", "Sign this day", "Signing needs a connection."),
            ("Add a note", "Add a note", "Notes need a connection."),
            ("Add a note to this mismatch", "Add a note", "Notes need a connection."),
        ):
            button = role(page, "button", name)
            eventually(page, lambda: expect(button).to_have_attribute("aria-disabled", "true", timeout=QUICK_MS))
            assert button.evaluate("e => !e.hasAttribute('disabled')"), f"{name} is natively disabled"
            page.evaluate("() => document.activeElement && document.activeElement.blur()")
            tab_to(page, button)
            page.keyboard.press("Enter")
            says(page, day_status, message)
            expect(role(page, "dialog", dialog_name)).to_have_count(0)
            box = button.bounding_box()
            assert box is not None
            page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            expect(role(page, "dialog", dialog_name)).to_have_count(0)
        assert not [u for u in requests if "/sign" in u or "/notes" in u]
    assert day_of(crew.api, crew.id, date)["notes"] == []


def test_replay_applies_once_and_conflicts_reject(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    offset = world.offset
    body = entry(at(date, "08:00", offset), at(date, "10:00", offset), "rest")
    first = status(crew.api.post("/api/watch-entries", body), 201)["entry"]
    assert first["applied"] is True and first["late"] is False and first["entry_key"] == body["entry_key"]
    rolling = crew.api.ok(f"/api/crew/{crew.id}/rolling")

    again = status(crew.api.post("/api/watch-entries", body), 201)["entry"]
    assert again["id"] == first["id"] and again["received_at_utc"] == first["received_at_utc"]
    replay = status(crew.api.post("/api/watch-entries/sync", {"entries": [body]}), 200)["results"][0]
    assert replay["outcome"] == "replayed" and replay["entry"]["id"] == first["id"] and replay["errors"] is None

    changed = {**body, "kind": "work"}
    status(crew.api.post("/api/watch-entries", changed), 409, "entry_key_conflict")
    conflict = status(crew.api.post("/api/watch-entries/sync", {"entries": [changed]}), 200)["results"][0]
    assert conflict["outcome"] == "conflict" and conflict["entry"] is None and conflict["errors"] is None
    day = day_of(crew.api, crew.id, date)
    assert len(day["entries"]) == 1 and float(day["rest_hours"]) == 2
    now_rolling = crew.api.ok(f"/api/crew/{crew.id}/rolling")
    assert now_rolling["rest_hours_24"] == rolling["rest_hours_24"] and now_rolling["rest_hours_168"] == rolling["rest_hours_168"]

    closed = entry(at(PAST_DAY, "04:00", offset), at(PAST_DAY, "06:00", offset), "rest")
    stored = status(crew.api.post("/api/watch-entries/sync", {"entries": [closed]}), 200)["results"][0]
    assert stored["outcome"] == "late"
    direct = status(crew.api.post("/api/watch-entries", closed), 201)["entry"]
    assert direct["id"] == stored["entry"]["id"] and direct["late"] is True
    status(crew.api.post("/api/watch-entries", {**closed, "kind": "work"}), 409, "entry_key_conflict")

    refused_key = idempotency_key()
    status(crew.api.post("/api/watch-entries", entry(at(PAST_DAY, "08:00", offset), at(PAST_DAY, "08:30", offset), "rest", refused_key)), 409, "day_closed")
    bad = status(crew.api.post("/api/watch-entries/sync", {"entries": [entry(at(date, "12:10", offset), at(date, "13:00", offset), "rest", refused_key)]}), 200)["results"][0]
    assert bad["outcome"] == "rejected" and bad["entry"] is None and bad["errors"]
    reused = status(crew.api.post("/api/watch-entries", entry(at(date, "14:00", offset), at(date, "14:30", offset), "work", refused_key)), 201)["entry"]
    assert reused["applied"] is True

    invalid(crew.api.post("/api/watch-entries", entry(at(date, "15:00", offset), at(date, "15:30", offset), "work", "k" * (KEY_MAX + 1))))
    status(crew.api.post("/api/watch-entries", entry(at(date, "15:00", offset), at(date, "15:30", offset), "work", ("k" * KEY_MAX)[:-16] + idempotency_key().replace("-", "")[:16])), 201)
    invalid(crew.api.post("/api/watch-entries/sync", {}))
    too_many = [entry(at(date, "16:00", offset), at(date, "16:30", offset), "work") for _ in range(SYNC_MAX + 1)]
    invalid(crew.api.post("/api/watch-entries/sync", {"entries": too_many}))
    assert not any(e["start_utc"] == at(date, "16:00", offset) for e in day_of(crew.api, crew.id, date)["entries"])

    mixed = [
        entry(at(date, "17:00", offset), at(date, "17:30", offset), "work"),
        entry(at(date, "18:00", offset), at(date, "18:10", offset), "work"),
        body,
    ]
    ordered = status(crew.api.post("/api/watch-entries/sync", {"entries": mixed}), 200)["results"]
    assert [r["entry_key"] for r in ordered] == [m["entry_key"] for m in mixed]
    assert [r["outcome"] for r in ordered] == ["applied", "rejected", "replayed"]


def test_concurrent_replays_store_one(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    body = entry(at(date, "08:00", world.offset), at(date, "10:00", world.offset), "rest")

    def send(index: int) -> httpx.Response:
        if index % 2:
            return crew.api.post("/api/watch-entries/sync", {"entries": [body]})
        return crew.api.post("/api/watch-entries", body)

    with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
        responses = list(pool.map(send, range(8)))
    ids = set()
    for index, response in enumerate(responses):
        if index % 2:
            result = status(response, 200)["results"][0]
            assert result["outcome"] in ("applied", "replayed")
            ids.add(result["entry"]["id"])
        else:
            ids.add(status(response, 201)["entry"]["id"])
    assert len(ids) == 1
    day = day_of(crew.api, crew.id, date)
    assert len(day["entries"]) == 1 and float(day["rest_hours"]) == 2


def test_wf_offline_sync_replay(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    with open_offline_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        prime_offline(page)
        page.context.set_offline(True)
        says(page, role(page, "status", "Connection"), "0 queued")
        click(cell(page, "08:00", "Not logged"))
        click(cell(page, "08:30", "Not logged"))
        says(page, role(page, "status", "Connection"), "2 queued")
        page.context.set_offline(False)
        says(page, role(page, "status", "Sync status"), "Synced 2 entries.")
    stored = day_of(crew.api, crew.id, date)["entries"]
    assert sorted(e["start_utc"] for e in stored) == [at(date, "08:00", world.offset), at(date, "08:30", world.offset)]
    assert all(e["entry_key"] for e in stored) and len({e["entry_key"] for e in stored}) == 2
    bodies = [{k: e[k] for k in ("entry_key", "start_utc", "end_utc", "kind")} for e in stored]
    rolling = crew.api.ok(f"/api/crew/{crew.id}/rolling")
    assert float(rolling["rest_hours_24"]) == 1
    results = status(crew.api.post("/api/watch-entries/sync", {"entries": bodies}), 200)["results"]
    assert [r["outcome"] for r in results] == ["replayed", "replayed"]
    assert len(day_of(crew.api, crew.id, date)["entries"]) == 2
    assert float(crew.api.ok(f"/api/crew/{crew.id}/rolling")["rest_hours_24"]) == float(rolling["rest_hours_24"])


def test_late_entries_kept_and_marked(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    sent_at = parse(crew.api.ok("/api/me")["server_now_utc"])
    first = status(crew.api.post("/api/watch-entries/sync", {"entries": [entry(at(PAST_DAY, "04:00"), at(PAST_DAY, "12:00"), "rest")]}), 200)["results"][0]
    assert first["outcome"] == "late" and first["entry"]["late"] is True and first["entry"]["applied"] is True
    assert parse(first["entry"]["received_at_utc"]) >= sent_at, "the entry was backdated"
    day = day_of(crew.api, crew.id, PAST_DAY)
    assert float(day["rest_hours"]) == 8
    assert all(c["late"] is True for c in day["cells"] if c["state"] == "rest")
    assert all(c["late"] is False for c in day["cells"] if c["state"] == "not_logged")

    status(crew.api.post("/api/watch-entries", entry(at(PAST_DAY, "13:00"), at(PAST_DAY, "14:00"), "work")), 409, "day_closed")
    assert len(day_of(crew.api, crew.id, PAST_DAY)["entries"]) == 1

    status(sign(crew, PAST_DAY), 200)
    signed = status(crew.api.post("/api/watch-entries/sync", {"entries": [entry(at(PAST_DAY, "04:00"), at(PAST_DAY, "06:00"), "work")]}), 200)["results"][0]
    assert signed["outcome"] == "late" and signed["entry"]["late"] is True and signed["entry"]["applied"] is False
    held_day = day_of(crew.api, crew.id, PAST_DAY)
    assert float(held_day["rest_hours"]) == 8 and held_day["state"] == "signed"
    assert signed["entry"]["id"] in [e["id"] for e in held_day["entries"]]

    status(countersign(world, crew, PAST_DAY), 200)
    countersigned = status(crew.api.post("/api/watch-entries/sync", {"entries": [entry(at(PAST_DAY, "04:00"), at(PAST_DAY, "06:00"), "work")]}), 200)["results"][0]
    assert countersigned["outcome"] == "late" and countersigned["entry"]["applied"] is False
    assert float(day_of(crew.api, crew.id, PAST_DAY)["rest_hours"]) == 8


def test_wf_offline_sync_late(browser: Browser) -> None:
    base = short_close_url()
    world, date, change = closing_world(base)
    crew = world.crew
    with open_offline_app(browser, f"{base}/") as page:
        sign_in(page, base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        says(page, role(page, "status", "Day status"), "Open")
        prime_offline(page)
        page.context.set_offline(True)
        says(page, role(page, "status", "Connection"), "0 queued")
        click(cell(page, "00:00", "Not logged"))
        see(page, cell(page, "00:00", "Rest"))
        says(page, role(page, "status", "Connection"), "1 queued")

        status(world.owner.post(f"/api/vessels/{world.vessel_id}/clock-changes", change), 201)
        poll(lambda: day_of(world.owner, crew.id, date), lambda d: d["state"] == "closed", "closed ship's day")

        page.context.set_offline(False)
        says(page, role(page, "status", "Sync status"), "Synced 1 entries. 1 marked Late entry.")
        stops_saying(page, role(page, "status", "Connection"), "Logging on board.")
        visit(page, f"{base}/log?date={date}")
        see(page, page.get_by_text("Late entry").first)
        says(page, role(page, "status", "Day status"), "Closed")
    day = day_of(crew.api, crew.id, date)
    assert [e["late"] for e in day["entries"]] == [True]
    assert day["entries"][0]["applied"] is True
    assert day["cells"][0]["late"] is True and day["cells"][0]["state"] == "short_break"


def test_server_closes_day_by_server_clock(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    open_day = day_of(crew.api, crew.id, shift_date(date, -2))
    assert open_day["state"] == "open" and open_day["can_edit"] is True
    assert parse(open_day["closes_at_utc"]) == parse(open_day["end_utc"]) + timedelta(seconds=DEFAULT_CLOSE_SECONDS)
    assert parse(open_day["server_now_utc"]) < parse(open_day["closes_at_utc"])
    closed_day = day_of(crew.api, crew.id, shift_date(date, -3))
    assert closed_day["state"] == "closed" and closed_day["can_edit"] is False
    assert parse(closed_day["server_now_utc"]) >= parse(closed_day["closes_at_utc"])

    offset = world.offset
    two_ago, three_ago = shift_date(date, -2), shift_date(date, -3)
    status(crew.api.post("/api/watch-entries", entry(at(two_ago, "04:00", offset), at(two_ago, "06:00", offset), "rest")), 201)
    status(crew.api.post("/api/watch-entries", entry(at(three_ago, "04:00", offset), at(three_ago, "06:00", offset), "rest")), 409, "day_closed")
    assert day_of(crew.api, crew.id, three_ago)["entries"] == []
    listed = crew.api.ok(f"/api/crew/{crew.id}/days?from={three_ago}&to={two_ago}")["days"]
    assert [(d["ship_date"], d["state"], d["can_edit"]) for d in listed] == [(three_ago, "closed", False), (two_ago, "open", True)]
    invalid(crew.api.get(f"/api/crew/{crew.id}/days?from=2026-01-01&to=2026-03-31"))

    short = make_world(short_close_url(), None)
    short_today = today(short)
    yesterday = day_of(short.crew.api, short.crew.id, shift_date(short_today, -1))
    assert yesterday["state"] == "closed" and yesterday["can_edit"] is False
    assert parse(yesterday["closes_at_utc"]) == parse(yesterday["end_utc"]) + timedelta(seconds=SHORT_CLOSE_SECONDS)
    assert day_of(short.crew.api, short.crew.id, short_today)["state"] == "open"
    status(short.crew.api.post("/api/watch-entries", entry(at(shift_date(short_today, -1), "04:00", short.offset), at(shift_date(short_today, -1), "05:00", short.offset), "rest")), 409, "day_closed")


def test_wf_day_closure_and_signing_drifted_clock(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    closed_date, open_date = shift_date(date, -3), shift_date(date, -2)
    now = parse(crew.api.ok("/api/me")["server_now_utc"])
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)

        page.clock.set_fixed_time(now - timedelta(days=30))
        visit(page, f"{world.base}/log?date={closed_date}")
        says(page, role(page, "status", "Day status"), "Closed")
        see(page, page.get_by_text("This ship's day has closed."))
        closed_cell = cell(page, "08:00", "Not logged")
        expect(closed_cell).to_be_disabled()
        box = closed_cell.bounding_box()
        assert box is not None
        page.mouse.click(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
        focus_cell(closed_cell)
        page.keyboard.press("Space")
        advance(page, QUICK_MS)
        expect(closed_cell).to_be_visible()
        assert day_of(crew.api, crew.id, closed_date)["entries"] == []

        page.clock.set_fixed_time(now + timedelta(days=30))
        visit(page, f"{world.base}/log?date={open_date}")
        says(page, role(page, "status", "Day status"), "Open")
        closes = at(shift_date(open_date, 3), "00:00", world.offset)
        see(page, page.get_by_text(f"You can edit this ship's day until {ship_reading(closes, world.offset)}."))
        click(cell(page, "08:00", "Not logged"))
        says(page, role(page, "status", "Sync status"), "Saved.")

        visit(page, f"{world.base}/log")
        says(page, role(page, "status", "Day status"), "Open")
        click(cell(page, "09:00", "Not logged"))
        says(page, role(page, "status", "Sync status"), "Saved.")

    assert len(day_of(crew.api, crew.id, open_date)["entries"]) == 1
    assert len(day_of(crew.api, crew.id, date)["entries"]) == 1
    assert day_of(crew.api, crew.id, closed_date)["entries"] == []


def test_wf_day_closure_and_signing_closing_time_after_change(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    yesterday = shift_date(date, -1)
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/clock-changes", {"changes_at_utc": at(shift_date(date, 1), "02:00", world.offset), "new_offset_minutes": world.offset + 60, "latitude": 1, "longitude": 15}), 201)
    closes = day_of(crew.api, crew.id, yesterday)["closes_at_utc"]
    now = parse(crew.api.ok("/api/me")["server_now_utc"])
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        page.clock.set_fixed_time(now - timedelta(days=20))
        visit(page, f"{world.base}/log?date={yesterday}")
        says(page, role(page, "status", "Day status"), "Open")
        see(page, page.get_by_text(f"You can edit this ship's day until {ship_reading(closes, world.offset + 60)}."))
        click(cell(page, "08:00", "Not logged"))
        says(page, role(page, "status", "Sync status"), "Saved.")
    assert len(day_of(crew.api, crew.id, yesterday)["entries"]) == 1


def test_signature_order(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    other = add_crew(world.base, world.owner, world.vessel_id)
    open_date = shift_date(date, -2)
    log_spans(crew, PAST_DAY, GOOD_DAY, world.offset)
    log_spans(crew, open_date, [["04:00", "12:00", "rest"]], world.offset)
    hours = day_of(crew.api, crew.id, PAST_DAY)["rest_hours"]

    assert status(sign(crew, open_date), 409, "day_not_closed")["ship_date"] == open_date
    assert status(sign(crew, PAST_DAY, open_date), 409, "day_not_closed")["ship_date"] == open_date
    assert day_of(crew.api, crew.id, PAST_DAY)["state"] == "closed", "a refused batch signed a day"
    status(world.owner.post(f"/api/crew/{crew.id}/days/sign", {"ship_dates": [PAST_DAY]}), 403, "forbidden")
    status(other.api.post(f"/api/crew/{crew.id}/days/sign", {"ship_dates": [PAST_DAY]}), 403, "forbidden")
    assert status(countersign(world, crew, PAST_DAY), 409, "day_not_signed")["ship_date"] == PAST_DAY
    assert status(countersign(world, crew, open_date), 409, "day_not_signed")["ship_date"] == open_date

    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        racers = list(pool.map(lambda _: sign(crew, PAST_DAY), range(6)))
    assert sorted(r.status_code for r in racers) == [200] + [409] * 5
    assert all(r.json()["error"] == "already_signed" for r in racers if r.status_code == 409)
    assert status(sign(crew, PAST_DAY), 409, "already_signed")["ship_date"] == PAST_DAY
    signed = day_of(crew.api, crew.id, PAST_DAY)
    assert signed["state"] == "signed" and signed["signed_at_utc"] and signed["countersigned_at_utc"] is None

    status(crew.api.post(f"/api/crew/{crew.id}/days/countersign", {"ship_dates": [PAST_DAY]}), 403, "forbidden")
    with concurrent.futures.ThreadPoolExecutor(max_workers=6) as pool:
        counters = list(pool.map(lambda _: countersign(world, crew, PAST_DAY), range(6)))
    assert sorted(r.status_code for r in counters) == [200] + [409] * 5
    assert all(r.json()["error"] == "already_countersigned" for r in counters if r.status_code == 409)
    status(sign(crew, PAST_DAY), 409, "already_signed")
    final = day_of(crew.api, crew.id, PAST_DAY)
    assert final["state"] == "countersigned" and final["countersigned_at_utc"] and final["rest_hours"] == hours


def test_wf_day_closure_and_signing_happy(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    log_spans(crew, PAST_DAY, GOOD_DAY)
    cells_before = day_of(crew.api, crew.id, PAST_DAY)["cells"]
    note_text = "Deck log shows the survey line finished later."
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        visit(page, f"{world.base}/log?date={PAST_DAY}")
        says(page, role(page, "status", "Day status"), "Closed")
        dialog = open_dialog(page, role(page, "button", "Sign this day"), "Sign this day")
        see(page, dialog.get_by_text(f"By signing you confirm these are your hours for {PAST_DAY}."))
        click(role(dialog, "button", "Confirm signature"))
        says(page, role(page, "status", "Day status"), "Signed")
    assert day_of(crew.api, crew.id, PAST_DAY)["state"] == "signed"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, at(PAST_DAY, "00:00"), PAST_DAY)
        record = record_region(page)
        says(page, role(record, "status", "Day status"), "Signed")
        dialog = open_dialog(page, role(record, "button", "Add a note"), "Add a note")
        fill(role(dialog, "textbox", "Note"), note_text)
        click(role(dialog, "button", "Save note"))
        says(page, role(page, "status", "Feedback"), "Note saved.")
        says(page, record, note_text)
        click(role(record, "button", "Countersign this day"))
        says(page, role(record, "status", "Day status"), "Countersigned")
    day = day_of(crew.api, crew.id, PAST_DAY)
    assert day["state"] == "countersigned" and day["cells"] == cells_before
    assert [(n["text"], n["author_role"]) for n in day["notes"]] == [(note_text, "owner_master")]
    assert day["notes"][0]["created_at_utc"]


def test_keyboard_sign_closed_day(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    log_spans(crew, PAST_DAY, GOOD_DAY)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        visit(page, f"{world.base}/log?date={PAST_DAY}")
        opener = role(page, "button", "Sign this day")
        see(page, opener)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        tab_to(page, opener)
        assert_focus_ring(page)
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Sign this day")
        see(page, dialog)
        confirm = role(dialog, "button", "Confirm signature")
        for _ in range(CYCLE_LIMIT):
            if confirm.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        expect(confirm).to_be_focused()
        assert_focus_ring(page)
        page.keyboard.press("Enter")
        says(page, role(page, "status", "Day status"), "Signed")
    assert day_of(crew.api, crew.id, PAST_DAY)["state"] == "signed"


def test_wf_day_closure_and_signing_keyboard(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    log_spans(crew, PAST_DAY, GOOD_DAY)
    cells_before = day_of(crew.api, crew.id, PAST_DAY)["cells"]
    start = at(PAST_DAY, "00:00")
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, start, PAST_DAY)
        record = record_region(page)
        opener = role(record, "button", "Sign this day")
        see(page, opener)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        tab_to(page, opener)
        assert_focus_ring(page)
        page.keyboard.press("Enter")
        dialog = role(page, "dialog", "Sign this day")
        see(page, dialog)
        confirm = role(dialog, "button", "Confirm signature")
        for _ in range(CYCLE_LIMIT):
            if confirm.evaluate("e => e === document.activeElement"):
                break
            page.keyboard.press("Tab")
        expect(confirm).to_be_focused()
        assert_focus_ring(page)
        page.keyboard.press("Enter")
        says(page, role(record, "status", "Day status"), "Signed")
    assert day_of(crew.api, crew.id, PAST_DAY)["state"] == "signed"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, start, PAST_DAY)
        record = record_region(page)
        countersign_button = role(record, "button", "Countersign this day")
        see(page, countersign_button)
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        tab_to(page, countersign_button)
        assert_focus_ring(page)
        page.keyboard.press("Enter")
        says(page, role(record, "status", "Day status"), "Countersigned")
    day = day_of(crew.api, crew.id, PAST_DAY)
    assert day["state"] == "countersigned" and day["cells"] == cells_before


def test_recurring_watch_keeps_ship_time(app_url: str) -> None:
    base = app_url.rstrip("/")
    ailsa = signed_in(base, AILSA)
    days = ailsa.ok("/api/vessels/vessel-surveyor/rota?crew_id=crew-ines&from=2026-09-09&to=2026-09-16")["days"]
    by_date = {d["ship_date"]: d for d in days}
    for ship_date, cells, elapsed in (("2026-09-09", 48, 4), ("2026-09-10", 50, 5), ("2026-09-16", 46, 3)):
        day = by_date[ship_date]
        assert day["cell_count"] == cells and float(day["planned_rest_hours"]) == 20
        watch = day["watches"][0]
        assert (watch["start_ship_time"], watch["end_ship_time"]) == ("00:00", "04:00") and float(watch["elapsed_hours"]) == elapsed

    world = make_world(base)
    vessel = f"/api/vessels/{world.vessel_id}"
    crew = world.crew
    status(world.owner.post(f"{vessel}/clock-changes", {"changes_at_utc": at("2026-08-03", "02:00"), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}), 201)
    status(world.owner.post(f"{vessel}/clock-changes", {"changes_at_utc": at("2026-08-05", "02:00", -60), "new_offset_minutes": 0, "latitude": 1, "longitude": 1}), 201)

    def watch(label: str, start: str, end: str, first: str, last: str) -> None:
        status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": crew.id, "label": label, "start_time": start, "end_time": end, "from_date": first, "to_date": last}), 201)

    def planned(first: str, last: str) -> dict[str, dict[str, Any]]:
        return {d["ship_date"]: d for d in world.owner.ok(f"{vessel}/rota?crew_id={crew.id}&from={first}&to={last}")["days"]}

    watch("Repeated start", "01:30", "03:00", "2026-08-03", "2026-08-03")
    retard_day = planned("2026-08-03", "2026-08-03")["2026-08-03"]
    first_pass = next(w for w in retard_day["watches"] if w["label"] == "Repeated start")
    assert first_pass["start_utc"] == at("2026-08-03", "01:30")
    assert first_pass["end_utc"] == at("2026-08-03", "04:00") and float(first_pass["elapsed_hours"]) == 2.5
    assert retard_day["cell_count"] == 50 and float(retard_day["planned_rest_hours"]) == 25 - 2.5

    watch("Skipped start", "02:30", "05:00", "2026-08-05", "2026-08-05")
    advance_day = planned("2026-08-05", "2026-08-05")["2026-08-05"]
    skipped = next(w for w in advance_day["watches"] if w["label"] == "Skipped start")
    assert skipped["start_utc"] == at("2026-08-05", "02:00", -60)
    assert float(skipped["elapsed_hours"]) == 2
    assert advance_day["cell_count"] == 46 and float(advance_day["planned_rest_hours"]) == 21

    other = add_crew(world.base, world.owner, world.vessel_id)
    status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": other.id, "label": "Repeated end", "start_time": "00:00", "end_time": "01:30", "from_date": "2026-08-03", "to_date": "2026-08-03"}), 201)
    repeated_end = world.owner.ok(f"{vessel}/rota?crew_id={other.id}&from=2026-08-03&to=2026-08-03")["days"][0]["watches"][0]
    assert repeated_end["end_utc"] == at("2026-08-03", "01:30", -60) and float(repeated_end["elapsed_hours"]) == 2.5

    third = add_crew(world.base, world.owner, world.vessel_id)
    status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": third.id, "label": "Overnight", "start_time": "22:00", "end_time": "02:00", "from_date": "2026-08-07", "to_date": "2026-08-07"}), 201)
    overnight = {d["ship_date"]: d for d in world.owner.ok(f"{vessel}/rota?crew_id={third.id}&from=2026-08-07&to=2026-08-08")["days"]}
    assert float(overnight["2026-08-07"]["planned_rest_hours"]) == 22 and float(overnight["2026-08-08"]["planned_rest_hours"]) == 22
    assert float(overnight["2026-08-07"]["watches"][0]["elapsed_hours"]) == 4

    invalid(world.owner.post(f"{vessel}/rota-watches", {"crew_id": crew.id, "label": "Bad", "start_time": "08:15", "end_time": "09:00", "from_date": "2026-08-07", "to_date": "2026-08-07"}))
    too_far = shift_date("2026-08-01", ROTA_MAX_DATES)
    invalid(world.owner.get(f"{vessel}/rota?crew_id={crew.id}&from=2026-08-01&to={too_far}"))
    status(crew.api.post(f"{vessel}/rota-watches", {"crew_id": crew.id, "label": "Mine", "start_time": "08:00", "end_time": "09:00", "from_date": "2026-08-07", "to_date": "2026-08-07"}), 403, "forbidden")


def test_plan_verdict_names_breaching_windows(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    vessel = f"/api/vessels/{world.vessel_id}"
    status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": world.crew.id, "label": "Long", "start_time": "00:00", "end_time": "16:00", "from_date": PAST_DAY, "to_date": PAST_DAY_NEXT}), 201)
    plan = world.owner.ok(f"{vessel}/rota?crew_id={world.crew.id}&from={PAST_DAY}&to={PAST_DAY_NEXT}")["plan"]
    assert plan["verdict"] == "breach"
    range_start, range_end = parse(at(PAST_DAY, "00:00")), parse(at(PAST_DAY_NEXT, "24:00"))
    starts = set()
    for breach in plan["breaches"]:
        assert breach["window_hours"] == 24 and breach["rule"] in ("rest_24h", "fourteen_hour_gap")
        start, end = parse(breach["window_start_utc"]), parse(breach["window_end_utc"])
        assert start >= range_start and end <= range_end and end - start == timedelta(hours=24)
        starts.add(start)
    assert len(starts) == 2 * CELLS_PER_DAY - CELLS_PER_DAY + 1
    assert {b["rule"] for b in plan["breaches"]} == {"rest_24h", "fourteen_hour_gap"}

    calm = add_crew(world.base, world.owner, world.vessel_id)
    status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": calm.id, "label": "Short", "start_time": "00:00", "end_time": "04:00", "from_date": PAST_DAY, "to_date": PAST_DAY_NEXT}), 201)
    passing = world.owner.ok(f"{vessel}/rota?crew_id={calm.id}&from={PAST_DAY}&to={PAST_DAY_NEXT}")["plan"]
    assert passing == {"verdict": "pass", "breaches": []} or (passing["verdict"] == "pass" and passing["breaches"] == [])


def test_wf_rota_planning_happy(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    calm = add_crew(world.base, world.owner, world.vessel_id)
    vessel = f"/api/vessels/{world.vessel_id}"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        rota = role(page, "region", "Rota")

        def add_watch(crew: Crew, label: str, end_time: str) -> None:
            dialog = open_dialog(page, role(rota, "button", "Add watch"), "Add watch")
            pick(role(dialog, "combobox", "Crew member"), crew.name)
            fill(role(dialog, "textbox", "Watch name"), label)
            fill(role(dialog, "textbox", "Start time"), "00:00")
            fill(role(dialog, "textbox", "End time"), end_time)
            fill(role(dialog, "textbox", "First ship's date"), PAST_DAY)
            fill(role(dialog, "textbox", "Last ship's date"), PAST_DAY_NEXT)
            click(role(dialog, "button", "Save watch"))
            says(page, role(page, "status", "Feedback"), "Saved.")
            gone(page, dialog)

        def check_plan(crew: Crew) -> None:
            pick(role(rota, "combobox", "Plan for"), crew.name)
            fill(role(rota, "textbox", "Plan from"), PAST_DAY)
            fill(role(rota, "textbox", "Plan to"), PAST_DAY_NEXT)
            click(role(rota, "button", "Check plan"))

        add_watch(world.crew, "Long watch", "16:00")
        add_watch(calm, "Short watch", "04:00")
        check_plan(world.crew)
        plan = world.owner.ok(f"{vessel}/rota?crew_id={world.crew.id}&from={PAST_DAY}&to={PAST_DAY_NEXT}")["plan"]
        count = len({(b["window_start_utc"], b["window_hours"]) for b in plan["breaches"]})
        says(page, role(rota, "status", "Plan verdict"), f"This plan breaches the rules in {count} windows.")
        says(page, role(rota, "table", "Planned watches"), "Long watch")

        check_plan(calm)
        says(page, role(rota, "status", "Plan verdict"), "This plan passes the rules.")
        says(page, role(rota, "table", "Planned watches"), "Short watch")
    assert plan["verdict"] == "breach" and count > 0
    assert world.owner.ok(f"{vessel}/rota?crew_id={calm.id}&from={PAST_DAY}&to={PAST_DAY_NEXT}")["plan"]["verdict"] == "pass"


def test_wf_rota_planning_clock_change(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    vessel = f"/api/vessels/{world.vessel_id}"
    status(world.owner.post(f"{vessel}/clock-changes", {"changes_at_utc": at(PAST_DAY, "02:00"), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}), 201)
    status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": world.crew.id, "label": "Morning watch", "start_time": "00:00", "end_time": "04:00", "from_date": PAST_DAY, "to_date": PAST_DAY_NEXT}), 201)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        rota = role(page, "region", "Rota")
        pick(role(rota, "combobox", "Plan for"), world.crew.name)
        fill(role(rota, "textbox", "Plan from"), PAST_DAY)
        fill(role(rota, "textbox", "Plan to"), PAST_DAY_NEXT)
        click(role(rota, "button", "Check plan"))
        table = role(rota, "table", "Planned watches")
        long_row = table.get_by_role("row").filter(has_text=PAST_DAY)
        see(page, long_row.first)
        says(page, long_row.first, "Morning watch")
        says(page, long_row.first, "00:00")
        says(page, long_row.first, "04:00")

        def columns() -> None:
            texts = long_row.first.evaluate("row => [...row.children].map(c => c.textContent.trim())")
            assert len(texts) == 6, texts
            assert re.search(r"\b25(\.0)?\b", texts[1]) and re.search(r"\b5(\.0)?\b", texts[4]) and re.search(r"\b20(\.0)?\b", texts[5]), texts
        eventually(page, columns)
    day = world.owner.ok(f"{vessel}/rota?crew_id={world.crew.id}&from={PAST_DAY}&to={PAST_DAY}")["days"][0]
    assert float(day["day_hours"]) == 25 and day["cell_count"] == 50 and float(day["watches"][0]["elapsed_hours"]) == 5


def test_wf_rota_planning_invalid_recovery(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    vessel = f"/api/vessels/{world.vessel_id}"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = open_dialog(page, role(role(page, "region", "Rota"), "button", "Add watch"), "Add watch")
        pick(role(dialog, "combobox", "Crew member"), world.crew.name)
        fill(role(dialog, "textbox", "Watch name"), "Dog watch")
        fill(role(dialog, "textbox", "Start time"), "16:15")
        fill(role(dialog, "textbox", "End time"), "18:00")
        fill(role(dialog, "textbox", "First ship's date"), PAST_DAY)
        fill(role(dialog, "textbox", "Last ship's date"), PAST_DAY)
        click(role(dialog, "button", "Save watch"))
        eventually(page, lambda: expect(role(dialog, "textbox", "Start time")).to_have_attribute("aria-invalid", "true", timeout=QUICK_MS))
        day = world.owner.ok(f"{vessel}/rota?crew_id={world.crew.id}&from={PAST_DAY}&to={PAST_DAY}")["days"][0]
        assert day["watches"] == []
        fill(role(dialog, "textbox", "Start time"), "16:00")
        click(role(dialog, "button", "Save watch"))
        says(page, role(page, "status", "Feedback"), "Saved.")
    day = world.owner.ok(f"{vessel}/rota?crew_id={world.crew.id}&from={PAST_DAY}&to={PAST_DAY}")["days"][0]
    assert [w["label"] for w in day["watches"]] == ["Dog watch"]


def test_wf_rota_planning_plan_range_error(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        rota = role(page, "region", "Rota")
        pick(role(rota, "combobox", "Plan for"), world.crew.name)
        fill(role(rota, "textbox", "Plan from"), "2026-08-01")
        fill(role(rota, "textbox", "Plan to"), "2026-08-29")
        click(role(rota, "button", "Check plan"))
        marked_invalid(page, rota)
        fill(role(rota, "textbox", "Plan to"), "2026-08-28")
        click(role(rota, "button", "Check plan"))
        says(page, role(rota, "status", "Plan verdict"), "This plan")
        marked_invalid(page, rota, expected=False)


def test_wf_rota_planning_plan_date_error(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        rota = role(page, "region", "Rota")
        pick(role(rota, "combobox", "Plan for"), world.crew.name)
        fill(role(rota, "textbox", "Plan from"), "2026-02-30")
        fill(role(rota, "textbox", "Plan to"), "2026-03-02")
        click(role(rota, "button", "Check plan"))
        marked_invalid(page, rota)
        fill(role(rota, "textbox", "Plan from"), "2026-03-01")
        click(role(rota, "button", "Check plan"))
        says(page, role(rota, "status", "Plan verdict"), "This plan")
        marked_invalid(page, rota, expected=False)


def test_plan_judged_under_rule_set_by_window_end(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    date = today(world)
    vessel = f"/api/vessels/{world.vessel_id}"
    first, last = shift_date(date, 1), shift_date(date, 16)
    status(world.owner.post(f"{vessel}/rota-watches", {"crew_id": world.crew.id, "label": "Fourteen", "start_time": "00:00", "end_time": "14:00", "from_date": first, "to_date": last}), 201)
    begins = parse(at(shift_date(date, 9), "00:00"))
    ends = begins + timedelta(hours=24)
    status(world.owner.post(f"{vessel}/rule-sets", {"rule_set": "flag_exception", "effective_from_utc": iso(begins), "effective_until_utc": iso(ends), "flag_reference": "Flag paper"}), 201)
    plan = world.owner.ok(f"{vessel}/rota?crew_id={world.crew.id}&from={first}&to={last}")["plan"]
    assert plan["verdict"] == "breach"
    ends_at = {parse(b["window_end_utc"]) for b in plan["breaches"] if b["rule"] == "rest_168h"}
    assert begins - timedelta(minutes=30) in ends_at, "a window ending before the start lost the standard rule"
    assert ends in ends_at, "the period's end is exclusive"
    assert not [e for e in ends_at if begins <= e < ends], "a window inside the period was judged by the standard limit"


@pytest.mark.parametrize("case", list(RULE_CASES.values()), ids=list(RULE_CASES))
def test_rest_rules(app_url: str, case: dict[str, Any]) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    if case["before"]:
        log_spans(crew, shift_date(PAST_DAY, -1), case["before"])
    for index in range(case["days"]):
        log_spans(crew, shift_date(PAST_DAY, index), case["day"])
    if case["after"]:
        log_spans(crew, shift_date(PAST_DAY, case["days"]), case["after"])
    start = at(PAST_DAY, "00:00")
    window = window_of(crew.api, crew.id, start, case["hours"])
    assert float(window["rest_hours"]) == case["rest"]
    assert window["verdict"] == case["verdict"]
    assert sorted(window["rules_failed"]) == sorted(case["rules"])
    assert window["rule_set"] == "standard"
    assert parse(window["end_utc"]) - parse(window["start_utc"]) == timedelta(hours=case["hours"])
    invalid(crew.api.get(f"/api/crew/{crew.id}/window?start={at(PAST_DAY, '00:10')}&hours=24"))
    invalid(crew.api.get(f"/api/crew/{crew.id}/window?start={start}&hours=48"))


def test_flag_exception_limits(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    date = today(world)
    offset = world.offset
    path = f"/api/vessels/{world.vessel_id}/rule-sets"
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    midnight = parse(at(shift_date(date, 1), "00:00", offset))
    begins, ends = midnight - timedelta(hours=1), midnight + timedelta(hours=1)

    def schedule(start: datetime, stop: datetime, reference: str = "Flag paper") -> httpx.Response:
        return world.owner.post(path, {"rule_set": "flag_exception", "effective_from_utc": iso(start), "effective_until_utc": iso(stop), "flag_reference": reference})

    invalid(schedule(floor_half_hour(now), ends))
    invalid(schedule(begins + timedelta(minutes=10), ends))
    invalid(schedule(ends, begins))
    far = begins + timedelta(days=3)
    invalid(schedule(far, far + timedelta(hours=FLAG_MAX_HOURS, minutes=30)))
    invalid(schedule(begins, ends, ""))
    invalid(schedule(begins, ends, "x" * (FLAG_REFERENCE_MAX + 1)))
    assert world.owner.ok(path)["rule_sets"] == []
    made = status(schedule(begins, ends, "x" * FLAG_REFERENCE_MAX), 201)
    assert made["rule_set"] == "flag_exception" and made["effective_from_utc"] == iso(begins)
    status(schedule(begins + timedelta(minutes=30), ends + timedelta(hours=1)), 409, "rule_set_overlap")
    status(schedule(far, far + timedelta(hours=FLAG_MAX_HOURS)), 201)
    assert len(world.owner.ok(path)["rule_sets"]) == 2

    crew = world.crew
    for index in range(-7, 1):
        log_spans(crew, shift_date(date, index), THREE_PERIOD_DAY, offset)
    flagged = window_of(crew.api, crew.id, iso(midnight - timedelta(hours=24)))
    assert flagged["rule_set"] == "flag_exception" and flagged["verdict"] == "breach"
    assert flagged["rules_failed"] == ["three_period_days"]
    earlier = window_of(crew.api, crew.id, iso(midnight - timedelta(hours=26)))
    assert earlier["rule_set"] == "standard" and "rest_periods" in earlier["rules_failed"]

    two_days = add_crew(world.base, world.owner, world.vessel_id)
    for index in range(-7, -1):
        log_spans(two_days, shift_date(date, index), TWO_PERIOD_DAY, offset)
    for index in range(-1, 1):
        log_spans(two_days, shift_date(date, index), THREE_PERIOD_DAY, offset)
    allowed = window_of(two_days.api, two_days.id, iso(midnight - timedelta(hours=24)))
    assert allowed["rule_set"] == "flag_exception" and allowed["verdict"] == "pass" and allowed["rules_failed"] == []

    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, iso(midnight - timedelta(hours=24)))
        record = record_region(page)
        says(page, record, "Three rest periods were used on more than two 24-hour periods in these 7 days.")
        says(page, record, "Judged under the flag exception rules.")


def test_effective_dated_rule_set_keeps_earlier_verdicts(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date, offset = world.crew, today(world), world.offset
    for index in range(-9, 2):
        log_spans(crew, shift_date(date, index), TEN_HOUR_DAY, offset)
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    begins = floor_half_hour(now) + timedelta(hours=2)
    ends = begins + timedelta(hours=2)
    before_end = begins - timedelta(minutes=30)
    week = timedelta(hours=168)
    earlier_start = iso(before_end - week)
    judged_before = window_of(crew.api, crew.id, earlier_start, 168)
    assert judged_before["verdict"] == "breach" and judged_before["rule_set"] == "standard"

    status(world.owner.post(f"/api/vessels/{world.vessel_id}/rule-sets", {"rule_set": "flag_exception", "effective_from_utc": iso(begins), "effective_until_utc": iso(ends), "flag_reference": "Flag paper"}), 201)

    before = window_of(crew.api, crew.id, earlier_start, 168)
    assert before["verdict"] == "breach" and before["rule_set"] == "standard" and before["rules_failed"] == ["rest_168h"]
    edge = window_of(crew.api, crew.id, iso(begins - week), 168)
    assert edge["verdict"] == "pass" and edge["rule_set"] == "flag_exception"
    after = window_of(crew.api, crew.id, iso(ends - week), 168)
    assert after["verdict"] == "breach" and after["rule_set"] == "standard"

    rolling_before = crew.api.ok(f"/api/crew/{crew.id}/rolling?as_of={iso(before_end)}")
    assert rolling_before["verdict_168"] == "breach"
    rolling_edge = crew.api.ok(f"/api/crew/{crew.id}/rolling?as_of={iso(begins)}")
    assert rolling_edge["verdict_168"] == "pass"

    strip = crew.api.ok(f"/api/crew/{crew.id}/strip?start={earlier_start}")
    assert strip["windows"]["168"][0]["verdict"] == "breach" and strip["windows"]["168"][0]["rule_set"] == "standard"
    assert strip["windows"]["168"][1]["verdict"] == "pass" and strip["windows"]["168"][1]["rule_set"] == "flag_exception"

    listed = crew.api.ok(f"/api/crew/{crew.id}/breaches?from={earlier_start}&to={earlier_start}")["breaches"]
    assert [(b["rule"], b["rule_set"], b["still_breaching"]) for b in listed if b["window_hours"] == 168] == [("rest_168h", "standard", True)]

    seeded = signed_in(world.base, PETRA)
    standard = window_of(seeded, "crew-petra", "2026-09-08T23:30:00Z", 168)
    assert float(standard["rest_hours"]) == 70 and standard["verdict"] == "breach" and standard["rule_set"] == "standard" and standard["rules_failed"] == ["rest_168h"]
    exception = window_of(seeded, "crew-petra", "2026-09-09T00:00:00Z", 168)
    assert float(exception["rest_hours"]) == 70 and exception["verdict"] == "pass" and exception["rule_set"] == "flag_exception"

    old = make_world(world.base)
    log_spans(old.crew, PAST_DAY, BAD_DAY)
    status(sign(old.crew, PAST_DAY), 200)
    status(countersign(old, old.crew, PAST_DAY), 200)
    seal_and_wait(old)
    future = floor_half_hour(parse(old.owner.ok("/api/me")["server_now_utc"])) + timedelta(hours=2)
    status(old.owner.post(f"/api/vessels/{old.vessel_id}/rule-sets", {"rule_set": "flag_exception", "effective_from_utc": iso(future), "effective_until_utc": iso(future + timedelta(hours=2)), "flag_reference": "Flag paper"}), 201)
    link = new_link(old, PAST_DAY, PAST_DAY)
    shown = Api(old.base).ok(f"/api/inspect/{token_of(link)}")["crew"][0]["breaches"]
    assert shown and {b["rule_set"] for b in shown} == {"standard"}


def rule_set_world(base: str) -> tuple[World, str, datetime]:
    world = make_world(base, None)
    date = today(world)
    for index in range(-9, 2):
        log_spans(world.crew, shift_date(date, index), TEN_HOUR_DAY, world.offset)
    begins = floor_half_hour(parse(world.owner.ok("/api/me")["server_now_utc"])) + timedelta(hours=2)
    return world, date, begins


def test_wf_rule_sets_and_verdicts_old_and_new(app_url: str, browser: Browser) -> None:
    world, date, begins = rule_set_world(app_url.rstrip("/"))
    crew = world.crew
    ends = begins + timedelta(hours=2)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = open_dialog(page, role(role(page, "region", "Rule sets"), "button", "Schedule rule set"), "Schedule rule set")
        fill(role(dialog, "textbox", "Starts in UTC"), iso(begins))
        fill(role(dialog, "textbox", "Ends in UTC"), iso(ends))
        fill(role(dialog, "textbox", "Flag authorisation"), "Flag paper 42")
        click(role(dialog, "button", "Save rule set"))
        says(page, role(page, "status", "Feedback"), "Rule set scheduled.")

        strip_start = iso(begins - timedelta(hours=168) - timedelta(hours=1))
        open_voyage(page, world.base, world.vessel_id, crew.id, strip_start)
        check(role(page, "radio", "168 hours"))
        record = record_region(page)
        verdict = role(page, "status", "Window verdict")

        go_to_step(page, 1)
        server = assert_fold_matches(page, crew.api, crew.id, strip_start, 1, 168)
        assert server["verdict"] == "breach" and server["rule_set"] == "standard"
        advance(page, VERDICT_STILL_MS)
        says(page, verdict, f"{server['start_ship_time']} to {server['end_ship_time']}: 70.0 hours of rest. Breach recorded. It stays on this record.")
        says(page, record, "Judged under the standard rules.")
        says(page, record, "Less than 77 hours of rest in this 168-hour window.")

        go_to_step(page, 2)
        server = assert_fold_matches(page, crew.api, crew.id, strip_start, 2, 168)
        assert server["verdict"] == "pass" and server["rule_set"] == "flag_exception"
        advance(page, VERDICT_STILL_MS)
        says(page, verdict, f"{server['start_ship_time']} to {server['end_ship_time']}: 70.0 hours of rest. This window passes the rules.")
        says(page, record, "Judged under the flag exception rules.")

    period = world.owner.ok(f"/api/vessels/{world.vessel_id}/rule-sets")["rule_sets"]
    assert [(p["effective_from_utc"], p["effective_until_utc"], p["flag_reference"]) for p in period] == [(iso(begins), iso(ends), "Flag paper 42")]


def test_wf_rule_sets_and_verdicts_refused(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    begins = floor_half_hour(now) + timedelta(hours=2)
    ends = begins + timedelta(hours=2)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        opener = role(role(page, "region", "Rule sets"), "button", "Schedule rule set")

        def attempt(start: datetime, stop: datetime, message: str) -> None:
            dialog = role(page, "dialog", "Schedule rule set")
            if not dialog.count():
                dialog = open_dialog(page, opener, "Schedule rule set")
            fill(role(dialog, "textbox", "Starts in UTC"), iso(start))
            fill(role(dialog, "textbox", "Ends in UTC"), iso(stop))
            fill(role(dialog, "textbox", "Flag authorisation"), "Flag paper")
            click(role(dialog, "button", "Save rule set"))
            says(page, role(page, "status", "Feedback"), message)

        attempt(floor_half_hour(now), ends, "Pick a start time after now.")
        attempt(begins, begins + timedelta(hours=FLAG_MAX_HOURS, minutes=30), "A flag exception cannot run longer than two weeks.")
        assert world.owner.ok(f"/api/vessels/{world.vessel_id}/rule-sets")["rule_sets"] == []
        attempt(begins, ends, "Rule set scheduled.")
        attempt(begins + timedelta(minutes=30), ends + timedelta(hours=1), "Another rule set is already in force for those dates.")
    assert len(world.owner.ok(f"/api/vessels/{world.vessel_id}/rule-sets")["rule_sets"]) == 1


SEED_WINDOWS = [
    ("crew-ines", INES, 24, 0, 16, "pass", [], "flat", 24),
    ("crew-ines", INES, 24, 240, 4, "breach", ["fourteen_hour_gap", "rest_24h", "six_hour_block"], "flat", 24),
    ("crew-ines", INES, 24, 100, 16, "pass", [], "flat", 24),
    ("crew-ines", INES, 24, 120, 16, "pass", [], "gap", 23),
    ("crew-ines", INES, 24, 420, 16, "pass", [], "crease", 25),
    ("crew-tomas", TOMAS, 24, 0, 11, "breach", ["six_hour_block"], "flat", 24),
    ("crew-tomas", TOMAS, 168, 0, 77, "pass", [], "gap", 167),
    ("crew-petra", PETRA, 24, 0, 10, "pass", [], "flat", 24),
]


def test_window_values_match_server(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    for crew_id, credentials, hours, step, rest, verdict, rules, fold_state, face in SEED_WINDOWS:
        api = signed_in(base, credentials)
        start = iso(parse(SEED_STRIP) + timedelta(minutes=30 * step))
        window = window_of(api, crew_id, start, hours)
        assert float(window["rest_hours"]) == rest and window["verdict"] == verdict, (crew_id, step, window)
        assert sorted(window["rules_failed"]) == rules and window["fold_state"] == fold_state
        assert float(window["clock_face_hours"]) == face
    ines = signed_in(base, INES)
    strip = ines.ok(f"/api/crew/crew-ines/strip?start={SEED_STRIP}")
    assert len(strip["cells"]) == 2 * STRIP_HOURS and len(strip["windows"]["24"]) == MAX_STEP_24 + 1 and len(strip["windows"]["168"]) == MAX_STEP_168 + 1
    assert strip["windows"]["24"][240]["verdict"] == "breach" and strip["windows"]["24"][240]["step"] == 240

    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *INES)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        for step in (0, 100, 120, 240, 420):
            go_to_step(page, step)
            server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, step)
            value_text = f"{server['start_ship_time']} to {server['end_ship_time']}"
            eventually(page, lambda: expect(slider(page)).to_have_attribute("aria-valuetext", value_text, timeout=QUICK_MS))
            says(page, strip_region(page), server["start_ship_time"])
            says(page, strip_region(page), server["end_ship_time"])
            says(page, strip_region(page), f"{float(server['rest_hours']):.1f} hours of rest")

    world = make_world(base)
    log_spans(world.crew, PAST_DAY, GOOD_DAY)
    log_spans(world.crew, PAST_DAY_NEXT, BAD_DAY)
    start = at(PAST_DAY, "00:00")
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, world.crew.email, world.crew.passcode)
        open_voyage(page, base, world.vessel_id, world.crew.id, start)
        go_to_step(page, 48)
        server = assert_fold_matches(page, world.crew.api, world.crew.id, start, 48)
        assert server["verdict"] != "pass" or float(server["rest_hours"]) == 4


def test_hour_fold_gap_and_crease(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ines = signed_in(base, INES)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *INES)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        for step, fold_state, label, face, first_time, last_time in (
            (120, "gap", "+1 h", 23, "2026-09-09 12:00", "2026-09-10 11:00"),
            (420, "crease", "-1 h", 25, "2026-09-15 17:00", "2026-09-16 18:00"),
        ):
            go_to_step(page, step)
            server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, step)
            assert server["fold_state"] == fold_state and float(server["clock_face_hours"]) == face
            assert server["clock_change_labels"] == [label]
            assert server["start_ship_time"] == first_time and server["end_ship_time"] == last_time
            attrs_start = parse(fold(page).get_attribute("data-window-start-utc") or "")
            attrs_end = parse(fold(page).get_attribute("data-window-end-utc") or "")
            assert attrs_end - attrs_start == timedelta(hours=24)
            advance(page, MOTION_SETTLED_MS)
            see(page, strip_region(page).get_by_text(label, exact=True).first)

        go_to_step(page, 100)
        server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, 100)
        assert server["fold_state"] == "flat" and float(server["longitude"]) == -12

        check(role(page, "radio", "168 hours"))
        go_to_step(page, 144)
        both = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, 144, 168)
        assert both["fold_state"] == "gap_and_crease" and both["clock_change_labels"] == ["+1 h", "-1 h"]

    world = make_world(base)
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/clock-changes", {"changes_at_utc": at(PAST_DAY, "12:00"), "new_offset_minutes": -30, "latitude": 1, "longitude": 1}), 201)
    half = window_of(world.owner, world.crew.id, at(PAST_DAY, "00:00"))
    assert half["fold_state"] == "gap" and float(half["clock_face_hours"]) == 24 - 0.5 and half["clock_change_labels"] == ["+0.5 h"]


def great_circle_longitude(first: tuple[float, float], second: tuple[float, float], share: float) -> float:
    def vector(lat: float, lon: float) -> tuple[float, float, float]:
        phi, lam = math.radians(lat), math.radians(lon)
        return math.cos(phi) * math.cos(lam), math.cos(phi) * math.sin(lam), math.sin(phi)

    a, b = vector(*first), vector(*second)
    angle = math.acos(sum(x * y for x, y in zip(a, b)))
    p = [(math.sin((1 - share) * angle) * x + math.sin(share * angle) * y) / math.sin(angle) for x, y in zip(a, b)]
    return math.degrees(math.atan2(p[1], p[0]))


def test_globe_follows_window(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ines = signed_in(base, INES)
    end = parse("2026-09-08T13:00:00Z")
    share = (end - parse("2026-09-07T00:00:00Z")) / (parse("2026-09-10T02:00:00Z") - parse("2026-09-07T00:00:00Z"))
    expected = great_circle_longitude((50.10, -5.00), (49.00, -12.00), share)
    step = int((end - timedelta(hours=24) - parse(SEED_STRIP)).total_seconds() // 1800)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *INES)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        globe = role(page, "img", "Voyage globe")
        assert globe.evaluate("e => e.tagName.toLowerCase()") == "canvas"
        advance(page, MOTION_SETTLED_MS)
        pixels_before = decode(capture(globe))

        go_to_step(page, step)
        server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, step)
        assert abs(float(server["longitude"]) - expected) <= LONGITUDE_TOLERANCE
        advance(page, MOTION_SETTLED_MS)
        assert abs(globe_longitude(page) - float(server["longitude"])) <= LONGITUDE_TOLERANCE

        go_to_step(page, 240)
        server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, 240)
        advance(page, MOTION_SETTLED_MS)
        assert abs(globe_longitude(page) - float(server["longitude"])) <= LONGITUDE_TOLERANCE
        turned = decode(capture(globe))
        assert difference(pixels_before, turned) > 0, "the globe drew the same picture at another longitude"
        says(page, role(page, "region", "Voyage"), f"{float(server['longitude']):.2f}")

        still_at = globe_longitude(page)
        advance(page, 5 * MOTION_SETTLED_MS)
        assert globe_longitude(page) == still_at, "the globe turned on its own"
        assert difference(turned, decode(capture(globe))) == 0, "the globe redrew while the window was still"

    world = make_world(base)
    vessel = f"/api/vessels/{world.vessel_id}"
    first_fix, last_fix = at(PAST_DAY, "12:00"), at(shift_date(PAST_DAY, 3), "12:00")
    status(world.owner.post(f"{vessel}/fixes", {"at_utc": first_fix, "latitude": 0, "longitude": DATELINE_LONGITUDE}), 201)
    status(world.owner.post(f"{vessel}/fixes", {"at_utc": last_fix, "latitude": 0, "longitude": -DATELINE_LONGITUDE}), 201)
    start = at(PAST_DAY, "00:00")
    assert float(window_of(world.owner, world.crew.id, start)["longitude"]) >= DATELINE_LONGITUDE
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, world.owner_email, world.owner_passcode)
        open_voyage(page, base, world.vessel_id, world.crew.id, start)
        advance(page, MOTION_SETTLED_MS)
        slider(page).focus()
        page.keyboard.press("End")
        advance(page, GLOBE_MID_MS)
        assert abs(globe_longitude(page)) >= DATELINE_LONGITUDE - DATELINE_MARGIN, "the globe went the long way round"
        advance(page, MOTION_SETTLED_MS)
        assert abs(globe_longitude(page) + DATELINE_LONGITUDE) <= LONGITUDE_TOLERANCE

    bare = make_world(base)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, bare.owner_email, bare.owner_passcode)
        open_voyage(page, base, bare.vessel_id, bare.crew.id, start)
        eventually(page, lambda: expect(fold(page)).to_have_attribute("data-longitude", "", timeout=QUICK_MS))
        see(page, role(page, "region", "Voyage").get_by_text("No position logged yet."))
    assert window_of(bare.owner, bare.crew.id, start)["longitude"] is None


def test_fold_sequence_plays(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ines = signed_in(base, INES)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *INES)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        word = strip_region(page).get_by_text("Breach", exact=True)
        advance(page, MOTION_SETTLED_MS)
        word_settles(page, word, False)
        passing = decode(capture(strip_region(page)))

        go_to_step(page, 240)
        server = window_of(ines, "crew-ines", iso(parse(SEED_STRIP) + timedelta(hours=120)))
        says(page, strip_region(page), server["start_ship_time"])
        advance(page, MOTION_SETTLED_MS)
        word_settles(page, word, True)
        says(page, strip_region(page), "4.0 hours of rest")
        breaching = decode(capture(strip_region(page)))
        resized = (breaching.width, breaching.height) != (passing.width, passing.height)
        assert resized or difference(passing, breaching) > 0, "the breach frame changed nothing"
        target = float(server["longitude"])
        assert abs(globe_longitude(page) - target) <= LONGITUDE_TOLERANCE

        step_zero = window_of(ines, "crew-ines", SEED_STRIP)
        page.keyboard.press("Home")
        expect(fold(page)).to_have_attribute("data-step", "0")
        says(page, strip_region(page), step_zero["start_ship_time"])
        advance(page, GLOBE_MID_MS)
        mid = globe_longitude(page)
        goal = float(step_zero["longitude"])
        assert abs(mid - goal) > LONGITUDE_TOLERANCE, "the globe jumped instead of turning"
        low, high = sorted((target, goal))
        assert low - LONGITUDE_TOLERANCE <= mid <= high + LONGITUDE_TOLERANCE
        advance(page, MOTION_SETTLED_MS)
        assert abs(globe_longitude(page) - goal) <= LONGITUDE_TOLERANCE
        says(page, strip_region(page), "16.0 hours of rest")
        word_settles(page, word, False)


def test_reduced_motion_same_values(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ines = signed_in(base, INES)
    with open_app(browser, f"{base}/", reduced_motion="reduce") as page:
        sign_in(page, base, *INES)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        go_to_step(page, 120)
        server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, 120)
        advance(page, FRAME_MS)
        assert abs(globe_longitude(page) - float(server["longitude"])) <= LONGITUDE_TOLERANCE, "the globe did not jump"
        see(page, strip_region(page).get_by_text("+1 h", exact=True).first)
        says(page, strip_region(page), "16.0 hours of rest")
        first = decode(capture(strip_region(page)))
        advance(page, MOTION_SETTLED_MS)
        assert difference(first, decode(capture(strip_region(page)))) == 0, "the fold was still moving under reduced motion"

        page.keyboard.press("Home")
        for _ in range(5):
            page.keyboard.press("PageUp")
        server = assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, 240)
        advance(page, FRAME_MS)
        assert abs(globe_longitude(page) - float(server["longitude"])) <= LONGITUDE_TOLERANCE
        see(page, strip_region(page).get_by_text("Breach", exact=True).first)
        says(page, strip_region(page), "4.0 hours of rest")
        advance(page, VERDICT_STILL_MS)
        says(page, role(page, "status", "Window verdict"), "Breach recorded. It stays on this record.")


def test_wf_crew_daily_log_touch(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    with open_app(browser, f"{world.base}/") as page:
        page.set_viewport_size(PHONE)
        cdp = enable_touch(page)
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        start_cell, end_cell = cell(page, "09:00", "Not logged"), cell(page, "10:00", "Not logged")
        start_cell.scroll_into_view_if_needed()
        scrolled = page.evaluate("() => window.scrollY")
        touch_drag(cdp, center(start_cell), center(end_cell))
        for clock in ("09:00", "09:30", "10:00"):
            see(page, cell(page, clock, "Rest"))
        assert page.evaluate("() => window.scrollY") == scrolled, "dragging in the grid scrolled the page"
        says(page, role(page, "status", "Sync status"), "Saved.")
        says(page, role(page, "region", "Rolling totals"), "1.5 hours in the last 24 hours")
    assert float(day_of(crew.api, crew.id, date)["rest_hours"]) == 1.5
    assert float(crew.api.ok(f"/api/crew/{crew.id}/rolling")["rest_hours_24"]) == 1.5


def test_touch_log_and_drag_window(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date = world.crew, today(world)
    with open_app(browser, f"{world.base}/") as page:
        page.set_viewport_size(PHONE)
        cdp = enable_touch(page)
        sign_in(page, world.base, crew.email, crew.passcode)
        see(page, role(page, "grid", "Watch grid"))
        target = cell(page, "08:00", "Not logged")
        box = target.bounding_box()
        assert box and box["width"] >= TOUCH_MIN_PX and box["height"] >= TOUCH_MIN_PX
        tap(target)
        see(page, cell(page, "08:00", "Rest under one hour"))
        tap(cell(page, "08:30", "Not logged"))
        see(page, cell(page, "08:00", "Rest"))
        see(page, cell(page, "08:30", "Rest"))
        says(page, role(page, "status", "Sync status"), "Saved.")

        strip_start = at(shift_date(date, -13), "00:00", world.offset)
        open_voyage(page, world.base, world.vessel_id, crew.id, strip_start)
        group = fold(page)
        group.scroll_into_view_if_needed()
        box = group.bounding_box()
        assert box and box["height"] >= TOUCH_MIN_PX
        scrolled = page.evaluate("() => window.scrollY")
        page.wait_for_load_state("networkidle")
        requests = track_drag_requests(page)
        during_drag: list[str] = []
        moved = 0
        for share in (0.5, 0.25, 0.75):
            y = box["y"] + box["height"] * share
            requests.clear()
            touch_drag(cdp, (box["x"] + box["width"] * 0.3, y), (box["x"] + box["width"] * 0.7, y), before_release=lambda: during_drag.extend(requests))
            moved = int(group.get_attribute("data-step") or "0")
            if moved:
                break
        assert moved > 0, "touch dragging did not move the window"
        assert not during_drag, f"a drag made network requests: {during_drag}"
        assert page.evaluate("() => window.scrollY") == scrolled, "dragging on the strip scrolled the page"
        assert moved <= MAX_STEP_24
        window_start = parse(group.get_attribute("data-window-start-utc") or "")
        assert window_start == parse(strip_start) + timedelta(minutes=30 * moved), "the window did not snap to its step"
        assert_fold_matches(page, crew.api, crew.id, strip_start, moved)

    assert float(day_of(crew.api, crew.id, date)["rest_hours"]) == 1


def test_keyboard_window_control(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ines = signed_in(base, INES)

    def value(page: Page) -> int:
        return int(slider(page).evaluate("e => e.getAttribute('aria-valuenow') ?? e.value"))

    def maximum(page: Page) -> int:
        return int(slider(page).evaluate("e => e.getAttribute('aria-valuemax') ?? e.max"))

    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, *INES)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        expect(role(page, "radio", "24 hours")).to_be_checked()
        assert value(page) == 0 and maximum(page) == MAX_STEP_24
        slider(page).focus()
        page.keyboard.press("Home")
        assert_focus_ring(page)
        for key, step in (
            ("ArrowRight", 1), ("ArrowUp", 2), ("ArrowLeft", 1), ("ArrowDown", 0),
            ("PageUp", STEPS_PER_PAGE), ("PageDown", 0), ("End", MAX_STEP_24), ("Home", 0),
        ):
            page.keyboard.press(key)
            expect(fold(page)).to_have_attribute("data-step", str(step))
            assert value(page) == step, key
        go_to_step(page, MAX_STEP_168 + 64)
        check(role(page, "radio", "168 hours"))
        eventually(page, lambda: expect(fold(page)).to_have_attribute("data-step", str(MAX_STEP_168), timeout=QUICK_MS))
        assert maximum(page) == MAX_STEP_168
        assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, MAX_STEP_168, 168)
        check(role(page, "radio", "24 hours"))
        eventually(page, lambda: expect(fold(page)).to_have_attribute("data-step", str(MAX_STEP_168), timeout=QUICK_MS))
        assert maximum(page) == MAX_STEP_24
        go_to_step(page, 10)

        for control in (role(page, "button", "Show earlier 14 days"), role(page, "button", "Show later 14 days"), role(page, "radio", "24 hours")):
            control.focus()
            page.keyboard.press("]")
            expect(fold(page)).to_have_attribute("data-step", "11")
            page.keyboard.press("[")
            expect(fold(page)).to_have_attribute("data-step", "10")
            expect(control).to_be_focused()

        role(page, "radio", "24 hours").focus()
        assert_focus_ring(page)
        names = tab_order(page, 5)
        assert "Window start" in names and "Show earlier 14 days" in names and "Show later 14 days" in names, names
        assert names.index("Window start") < names.index("Show earlier 14 days") < names.index("Show later 14 days"), names
        before_slider = names[: names.index("Window start")]
        assert all(n in ("24 hours", "168 hours") for n in before_slider), names

        click(role(page, "button", "Show later 14 days"))
        later = parse(SEED_STRIP) + timedelta(hours=STRIP_HOURS)
        def moved_on() -> None:
            shown = parse(fold(page).get_attribute("data-window-start-utc") or "")
            assert shown >= later, shown
        eventually(page, moved_on)


def test_wf_hour_fold_drag_review(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ailsa = signed_in(base, AILSA)
    with open_app(browser, f"{base}/") as page:
        page.set_viewport_size(DESKTOP)
        sign_in(page, base, *AILSA)
        visit(page, f"{base}/vessels/vessel-surveyor")
        click(role(role(page, "region", "Crew"), "link", "Review Ines Duarte"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/voyage/vessel-surveyor/crew-ines"), timeout=QUICK_MS))
        eventually(page, lambda: expect(fold(page)).to_have_attribute("data-window-start-utc", SEED_STRIP, timeout=QUICK_MS))

        group = fold(page)
        box = group.bounding_box()
        assert box
        page.wait_for_load_state("networkidle")
        requests = track_drag_requests(page)
        during_drag: list[str] = []
        moved = 0
        for share in (0.5, 0.25, 0.75):
            y = box["y"] + box["height"] * share
            page.mouse.move(box["x"] + box["width"] * 0.3, y)
            requests.clear()
            page.mouse.down()
            page.mouse.move(box["x"] + box["width"] * 0.7, y, steps=8)
            during_drag.extend(requests)
            page.mouse.up()
            moved = int(group.get_attribute("data-step") or "0")
            if moved:
                break
        assert moved > 0, "dragging did not move the window"
        assert not during_drag, f"a drag made network requests: {during_drag}"
        assert_fold_matches(page, ailsa, "crew-ines", SEED_STRIP, moved)

        go_to_step(page, 120)
        advance(page, MOTION_SETTLED_MS)
        see(page, strip_region(page).get_by_text("+1 h", exact=True).first)
        go_to_step(page, 240)
        server = assert_fold_matches(page, ailsa, "crew-ines", SEED_STRIP, 240)
        assert server["verdict"] == "breach" and server["rule_set"] == "standard"
        advance(page, VERDICT_STILL_MS)
        says(page, role(page, "status", "Window verdict"), f"{server['start_ship_time']} to {server['end_ship_time']}: 4.0 hours of rest. Breach recorded. It stays on this record.")
        record = record_region(page)
        says(page, record, "Less than 10 hours of rest in this 24-hour window.")
        says(page, record, "No rest period of at least 6 hours touches this 24-hour window.")
        says(page, record, "More than 14 hours passed between rest periods in this 24-hour window.")
        says(page, record, "Judged under the standard rules.")
        says(page, record, "Ship's day 2026-09-12, in month 2026-09.")


def test_wf_hour_fold_keyboard_and_globe(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ines = signed_in(base, INES)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *INES)
        click(role(page, "link", "My voyage"))
        eventually(page, lambda: expect(page).to_have_url(re.compile(r"/voyage/vessel-surveyor/crew-ines"), timeout=QUICK_MS))
        see(page, fold(page))
        page.evaluate("() => document.activeElement && document.activeElement.blur()")
        tab_to(page, slider(page))
        assert_focus_ring(page)
        page.keyboard.press("Home")
        for _ in range(8):
            page.keyboard.press("PageUp")
        for _ in range(36):
            page.keyboard.press("ArrowRight")
        assert_fold_matches(page, ines, "crew-ines", SEED_STRIP, 420)
        assert fold(page).get_attribute("data-fold-state") == "crease"


def test_crew_only_hours_and_notes(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, date, offset = world.crew, today(world), world.offset
    other = add_crew(world.base, world.owner, world.vessel_id)
    body = entry(at(date, "08:00", offset), at(date, "10:00", offset), "rest")
    status(world.owner.post("/api/watch-entries", body), 403, "crew_only")
    status(world.owner.post("/api/watch-entries/sync", {"entries": [body]}), 403, "crew_only")
    status(signed_in(world.base, BRAM).post("/api/watch-entries", body), 403, "crew_only")
    assert day_of(crew.api, crew.id, date)["entries"] == []

    status(other.api.post("/api/watch-entries", {**body, "crew_id": crew.id}), 201)
    assert day_of(crew.api, crew.id, date)["entries"] == [], "crew_id in the body wrote another person's hours"
    assert len(day_of(other.api, other.id, date)["entries"]) == 1

    log_spans(crew, PAST_DAY, GOOD_DAY, offset)
    before = day_of(crew.api, crew.id, PAST_DAY)
    notes = f"/api/crew/{crew.id}/days/{PAST_DAY}/notes"
    made = status(world.owner.post(notes, {"text": "I disagree with these hours."}), 201)
    assert made["author_role"] == "owner_master" and made["ship_date"] == PAST_DAY and made["created_at_utc"] and made["event_id"] is None
    own = status(crew.api.post(notes, {"text": "x" * NOTE_MAX}), 201)
    assert own["author_role"] == "crew"
    invalid(crew.api.post(notes, {"text": ""}))
    invalid(crew.api.post(notes, {"text": "x" * (NOTE_MAX + 1)}))
    status(other.api.post(notes, {"text": "Not mine."}), 403, "forbidden")
    after = day_of(crew.api, crew.id, PAST_DAY)
    assert after["cells"] == before["cells"] and after["rest_hours"] == before["rest_hours"]
    assert {n["id"] for n in after["notes"]} == {made["id"], own["id"]}


def test_breach_stays_on_record(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), None)
    crew, offset = world.crew, world.offset
    date = shift_date(today(world), -1)
    start = at(date, "00:00", offset)
    for s, e, k in BAD_DAY:
        status(crew.api.post("/api/watch-entries", entry(at(date, s, offset), at(date, e, offset), k)), 201)
    assert window_of(crew.api, crew.id, start)["verdict"] == "breach"
    path = f"/api/crew/{crew.id}/breaches"

    def recorded() -> dict[str, dict[str, Any]]:
        rows = crew.api.ok(f"{path}?from={start}&to={start}")["breaches"]
        return {b["rule"]: b for b in rows if b["window_hours"] == 24}

    first = recorded()
    assert set(first) == {"rest_24h", "six_hour_block", "fourteen_hour_gap"}
    assert first["rest_24h"]["still_breaching"] is True and float(first["rest_24h"]["rest_hours"]) == 4
    assert first["rest_24h"]["rule_set"] == "standard" and first["rest_24h"]["window_end_utc"] == iso(parse(start) + timedelta(hours=24))

    status(crew.api.post("/api/watch-entries", entry(at(date, "06:00", offset), at(date, "14:00", offset), "rest")), 201)
    assert window_of(crew.api, crew.id, start)["verdict"] == "pass"
    later = recorded()
    assert set(later) == set(first)
    for rule, breach in later.items():
        assert breach["still_breaching"] is False
        assert (breach["id"], breach["recorded_at_utc"], breach["rest_hours"], breach["rule_set"]) == (first[rule]["id"], first[rule]["recorded_at_utc"], first[rule]["rest_hours"], first[rule]["rule_set"])

    target = first["rest_24h"]["id"]
    for api in (crew.api, world.owner):
        for method, where in (("DELETE", f"{path}/{target}"), ("PUT", f"{path}/{target}"), ("PATCH", f"{path}/{target}"), ("POST", path), ("DELETE", path)):
            status(api.call(method, where, {} if method != "DELETE" else None), 405, "breach_permanent")
    assert recorded() == later

    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, start)
        record = record_region(page)
        says(page, record, "Recorded breach. The hours were later changed.")

    empty = make_world(world.base)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, empty.crew.email, empty.crew.passcode)
        open_voyage(page, world.base, empty.vessel_id, empty.crew.id, at(PAST_DAY, "00:00"))
        says(page, record_region(page), "No breaches recorded.")
        expect(record_region(page)).not_to_contain_text("Recorded breach.")


def test_record_mismatch_api(app_url: str) -> None:
    base = app_url.rstrip("/")
    world = make_world(base)
    crew = world.crew
    log_spans(crew, PAST_DAY, GOOD_DAY)
    events = f"/api/vessels/{world.vessel_id}/events"
    before = day_of(crew.api, crew.id, PAST_DAY)
    overlap = status(world.owner.post(events, {"crew_id": crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "05:00"), "end_utc": at(PAST_DAY, "06:00"), "description": "Fire drill"}), 201)
    assert overlap["mismatch"] is True and overlap["kind"] == "drill"
    clear = status(world.owner.post(events, {"crew_id": crew.id, "kind": "call_out", "start_utc": at(PAST_DAY, "01:00"), "end_utc": at(PAST_DAY, "02:00"), "description": "Engine call-out"}), 201)
    assert clear["mismatch"] is False
    invalid(world.owner.post(events, {"crew_id": crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "05:10"), "end_utc": at(PAST_DAY, "06:00"), "description": "Misaligned"}))
    status(crew.api.post(events, {"crew_id": crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "05:00"), "end_utc": at(PAST_DAY, "06:00"), "description": "Mine"}), 403, "forbidden")

    def flags() -> dict[str, bool]:
        return {e["id"]: e["mismatch"] for e in day_of(world.owner, crew.id, PAST_DAY)["events"]}

    assert flags() == {overlap["id"]: True, clear["id"]: False}
    notes = f"/api/crew/{crew.id}/days/{PAST_DAY}/notes"
    status(world.owner.post(notes, {"text": "A general note."}), 201)
    assert flags()[overlap["id"]] is True, "a note without event_id cleared the mismatch"
    invalid(world.owner.post(notes, {"text": "Unknown event.", "event_id": JUNK}))
    invalid(world.owner.post(f"/api/crew/{crew.id}/days/{PAST_DAY_NEXT}/notes", {"text": "Wrong date.", "event_id": overlap["id"]}))
    status(crew.api.post(notes, {"text": "I was called.", "event_id": overlap["id"]}), 201)
    assert flags()[overlap["id"]] is False

    log_spans(crew, PAST_DAY, [["01:00", "02:00", "rest"]])
    assert flags()[clear["id"]] is True, "a later entry did not start a mismatch"
    after = day_of(crew.api, crew.id, PAST_DAY)
    assert float(after["rest_hours"]) == float(before["rest_hours"]) + 1

    ines = day_of(signed_in(base, INES), "crew-ines", "2026-09-08")
    seeded = [e for e in ines["events"] if e["description"] == "Anchor watch call-out"]
    assert seeded and seeded[0]["kind"] == "call_out" and seeded[0]["mismatch"] is True


def test_wf_record_integrity_note_changes_no_hours(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    log_spans(crew, PAST_DAY, GOOD_DAY)
    before = day_of(crew.api, crew.id, PAST_DAY)
    text = "The deck log disagrees with these hours."
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, at(PAST_DAY, "00:00"), PAST_DAY)
        record = record_region(page)
        opener = role(record, "button", "Add a note")
        dialog = open_dialog(page, opener, "Add a note")
        click(role(dialog, "button", "Save note"))
        says(page, role(page, "status", "Feedback"), "Write a note first.")
        assert day_of(crew.api, crew.id, PAST_DAY)["notes"] == []
        if not dialog.count():
            dialog = open_dialog(page, opener, "Add a note")
        fill(role(dialog, "textbox", "Note"), text)
        click(role(dialog, "button", "Save note"))
        says(page, role(page, "status", "Feedback"), "Note saved.")
        says(page, record, text)
    after = day_of(crew.api, crew.id, PAST_DAY)
    assert after["cells"] == before["cells"] and after["rest_hours"] == before["rest_hours"]
    assert [(n["text"], n["author_role"]) for n in after["notes"]] == [(text, "owner_master")]


def test_wf_record_integrity_mismatch_ships_day(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"), 120)
    crew = world.crew
    notice = "Record mismatch: a drill or call-out overlaps hours logged as rest. Add a note to explain it."
    log_spans(crew, PAST_DAY_NEXT, [["00:00", "04:00", "rest"]], 120)
    event = status(world.owner.post(f"/api/vessels/{world.vessel_id}/events", {"crew_id": crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "23:00"), "end_utc": at(PAST_DAY, "23:30"), "description": "Boat drill"}), 201)
    assert event["id"] in [e["id"] for e in day_of(world.owner, crew.id, PAST_DAY_NEXT)["events"]]
    assert event["id"] not in [e["id"] for e in day_of(world.owner, crew.id, PAST_DAY)["events"]]
    start = at(PAST_DAY_NEXT, "00:00", 120)
    with open_app(browser, f"{world.base}/") as owner_page:
        sign_in(owner_page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(owner_page, world.base, world.vessel_id, crew.id, start, PAST_DAY_NEXT)
        says(owner_page, record_region(owner_page), notice)
        with open_app(browser, f"{world.base}/") as page:
            cdp = session(page)
            cdp.send("Emulation.setTimezoneOverride", {"timezoneId": "Pacific/Kiritimati"})
            sign_in(page, world.base, crew.email, crew.passcode)
            visit(page, f"{world.base}/log?date={PAST_DAY}")
            see(page, role(page, "grid", "Watch grid"))
            expect(page.get_by_text(notice)).to_have_count(0)
            visit(page, f"{world.base}/log?date={PAST_DAY_NEXT}")
            see(page, page.get_by_text(notice))
            dialog = open_dialog(page, role(page, "button", "Add a note to this mismatch"), "Add a note")
            fill(role(dialog, "textbox", "Note"), "I was called from my bunk.")
            click(role(dialog, "button", "Save note"))
            says(page, role(page, "status", "Day status"), "Note saved.")
            page.reload()
            see(page, role(page, "grid", "Watch grid"))
            gone(page, page.get_by_text(notice))
        owner_page.reload()
        see(owner_page, fold(owner_page))
        gone(owner_page, owner_page.get_by_text(notice))
    day = day_of(world.owner, crew.id, PAST_DAY_NEXT)
    assert day["events"][0]["mismatch"] is False and day["notes"][0]["event_id"] == event["id"]


def event_dialog(page: Page, world: World, start: str, end: str) -> Locator:
    dialog = open_dialog(page, role(role(page, "region", "Drills and call-outs"), "button", "Log drill or call-out"), "Log drill or call-out")
    pick(role(dialog, "combobox", "Crew member"), world.crew.name)
    pick(role(dialog, "combobox", "Type"), "drill")
    fill(role(dialog, "textbox", "Start in UTC"), start)
    fill(role(dialog, "textbox", "End in UTC"), end)
    fill(role(dialog, "textbox", "What happened"), "Boat drill")
    click(role(dialog, "button", "Save event"))
    return dialog


def test_wf_record_integrity_event_start_error(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = event_dialog(page, world, "2026-08-11T12:15:00Z", at(PAST_DAY, "13:00"))
        held_with_error(page, dialog, role(dialog, "textbox", "Start in UTC"))
        assert day_of(world.owner, world.crew.id, PAST_DAY)["events"] == []
        fill(role(dialog, "textbox", "Start in UTC"), at(PAST_DAY, "12:00"))
        click(role(dialog, "button", "Save event"))
        says(page, role(page, "status", "Feedback"), "Saved.")
    assert len(day_of(world.owner, world.crew.id, PAST_DAY)["events"]) == 1


def test_wf_record_integrity_event_end_error(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = event_dialog(page, world, at(PAST_DAY, "12:00"), "2026-08-11T13:10:00Z")
        held_with_error(page, dialog, role(dialog, "textbox", "End in UTC"))
        assert day_of(world.owner, world.crew.id, PAST_DAY)["events"] == []
        fill(role(dialog, "textbox", "End in UTC"), at(PAST_DAY, "13:00"))
        click(role(dialog, "button", "Save event"))
        says(page, role(page, "status", "Feedback"), "Saved.")
    assert len(day_of(world.owner, world.crew.id, PAST_DAY)["events"]) == 1


def test_seal_conditions(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = world.crew
    store = S3()
    seal_path = f"/api/crew/{crew.id}/months/{PAST_MONTH}/seal"
    prefix = f"records/{world.vessel_id}/{crew.id}/"
    assert status(world.owner.post(seal_path), 409, "month_not_ready")["blocking_dates"] == []
    log_spans(crew, PAST_DAY, GOOD_DAY)
    log_spans(crew, PAST_DAY_NEXT, GOOD_DAY)
    assert sorted(status(world.owner.post(seal_path), 409, "month_not_ready")["blocking_dates"]) == [PAST_DAY, PAST_DAY_NEXT]
    status(sign(crew, PAST_DAY, PAST_DAY_NEXT), 200)
    status(countersign(world, crew, PAST_DAY), 200)
    assert status(world.owner.post(seal_path), 409, "month_not_ready")["blocking_dates"] == [PAST_DAY_NEXT]
    status(crew.api.post(seal_path), 403, "forbidden")
    status(signed_in(world.base, BRAM).post(seal_path), 404, "not_found")
    assert month_of(world, crew)["state"] == "open"
    assert store.keys(prefix) == []
    status(countersign(world, crew, PAST_DAY_NEXT), 200)
    accepted = world.owner.post(seal_path)
    assert status(accepted, 202)["state"] == "awaiting_archive"

    short = make_world(short_close_url(), None)
    date = today(short)
    month = date[:7]
    yesterday = shift_date(date, -1)
    if yesterday[:7] == month:
        ready_month(short, dates=(yesterday,))
        refused = status(short.owner.post(f"/api/crew/{short.crew.id}/months/{month}/seal"), 409, "month_not_ready")
        assert refused["blocking_dates"] == []
    else:
        log_spans(short.crew, date, GOOD_DAY, short.offset)
        refused = status(short.owner.post(f"/api/crew/{short.crew.id}/months/{month}/seal"), 409, "month_not_ready")
        assert refused["blocking_dates"] == [date]
    assert S3("-short").keys(f"records/{short.vessel_id}/{short.crew.id}/{month}/") == []


def test_sealed_after_archive_confirms(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world)
    store = S3()
    record_key = f"records/{world.vessel_id}/{crew.id}/{PAST_MONTH}/record.pdf"
    copy_key = f"records/{world.vessel_id}/{crew.id}/{PAST_MONTH}/seafarer-copy.pdf"
    opened = month_of(world, crew)
    assert opened["state"] == "open" and opened["record_sha256"] is None and opened["sealed_at_utc"] is None
    with concurrent.futures.ThreadPoolExecutor(max_workers=5) as pool:
        answers = list(pool.map(lambda _: world.owner.post(f"/api/crew/{crew.id}/months/{PAST_MONTH}/seal"), range(5)))
    assert all(a.status_code in (200, 202) for a in answers), [a.text for a in answers]

    def sealed_only_when_stored() -> dict[str, Any]:
        month = month_of(world, crew)
        if month["state"] == "sealed":
            assert record_key in store.keys(record_key), "sealed before the object was stored"
        else:
            assert month["state"] == "awaiting_archive" and month["record_sha256"] is None
        return month

    month = poll(sealed_only_when_stored, lambda m: m["state"] == "sealed", "sealed month")
    assert month["record_key"] == record_key and month["copy_key"] == copy_key and month["sealed_at_utc"]
    payload = store.get(record_key)
    assert_pdf(payload)
    assert hashlib.sha256(payload).hexdigest() == month["record_sha256"]
    assert_pdf(store.get(copy_key))
    repeated = status(world.owner.post(f"/api/crew/{crew.id}/months/{PAST_MONTH}/seal"), 200)
    assert repeated["state"] == "sealed" and repeated["record_sha256"] == month["record_sha256"] and repeated["sealed_at_utc"] == month["sealed_at_utc"]


def test_sealed_month_immutable_and_copy(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world)
    other = add_crew(world.base, world.owner, world.vessel_id)
    status(crew.api.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/copy.pdf"), 409, "month_not_sealed")
    status(crew.api.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/record.pdf"), 409, "month_not_sealed")
    month = seal_and_wait(world)
    before = day_of(crew.api, crew.id, PAST_DAY)

    status(crew.api.post("/api/watch-entries", entry(at(PAST_DAY, "04:00"), at(PAST_DAY, "06:00"), "work")), 409, "month_sealed")
    status(crew.api.post(f"/api/crew/{crew.id}/days/{PAST_DAY}/notes", {"text": "Too late."}), 409, "month_sealed")
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/events", {"crew_id": crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "05:00"), "end_utc": at(PAST_DAY, "06:00"), "description": "Too late"}), 409, "month_sealed")
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/clock-changes", {"changes_at_utc": at(PAST_DAY_NEXT, "02:00"), "new_offset_minutes": -60, "latitude": 1, "longitude": 1}), 409, "month_sealed")
    synced = status(crew.api.post("/api/watch-entries/sync", {"entries": [entry(at(PAST_DAY, "04:00"), at(PAST_DAY, "06:00"), "work")]}), 200)["results"][0]
    assert synced["outcome"] == "late" and synced["entry"]["late"] is True and synced["entry"]["applied"] is False
    after = day_of(crew.api, crew.id, PAST_DAY)
    assert after["cells"] == before["cells"] and after["rest_hours"] == before["rest_hours"] and after["notes"] == before["notes"]

    copy = crew.api.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/copy.pdf")
    status(copy, 200)
    assert copy.content == S3().get(month["copy_key"])
    assert_pdf(copy.content)
    record = world.owner.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/record.pdf")
    status(record, 200)
    assert hashlib.sha256(record.content).hexdigest() == month["record_sha256"]
    status(other.api.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/copy.pdf"), 403, "forbidden")


def test_wf_month_sealing_happy(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        visit(page, f"{world.base}/log?date={PAST_DAY}")
        says(page, role(page, "status", "Day status"), "Countersigned")
        gone(page, role(page, "link", "Download my copy"))
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        open_voyage(page, world.base, world.vessel_id, crew.id, at(PAST_DAY, "00:00"), PAST_DAY)
        month_status = role(page, "status", "Month status")
        says(page, month_status, "Open")
        bypass_worker(page)
        with held(page, "**/months/*/seal") as release:
            click(role(page, "button", "Seal this month"))
            says(page, month_status, "Awaiting archive")
            assert month_of(world, crew)["state"] == "open"
            release()
        says(page, month_status, "Sealed", SERVER_DEADLINE)
    month = month_of(world, crew)
    assert month["state"] == "sealed"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, crew.email, crew.passcode)
        visit(page, f"{world.base}/log?date={PAST_DAY}")
        link = role(page, "link", "Download my copy")
        see(page, link)
        with page.expect_download() as download:
            click(link)
        payload = Path(download.value.path()).read_bytes()
    assert payload == S3().get(month["copy_key"])
    assert_pdf(payload)


def test_wf_month_sealing_outage(browser: Browser) -> None:
    base = archive_down_url()
    banner = "Archive unreachable. Hours are still being logged; sealing resumes on its own."
    status(httpx.get(f"{base}/api/health", timeout=HTTP_TIMEOUT), 200)
    world = make_world(base, None)
    crew = world.crew
    poll(lambda: archive_state(world.owner), lambda s: s == "unreachable", "unreachable archive")
    date = today(world)
    status(crew.api.post("/api/watch-entries", entry(at(date, "08:00", world.offset), at(date, "10:00", world.offset), "rest")), 201)
    ready_month(world)
    provide_bucket("-archive")
    store = S3("-archive")
    prefix = f"records/{world.vessel_id}/{crew.id}/{PAST_MONTH}/"
    seal_path = f"/api/crew/{crew.id}/months/{PAST_MONTH}/seal"
    assert status(world.owner.post(seal_path), 202)["state"] == "awaiting_archive"
    assert status(world.owner.post(seal_path), 202)["state"] == "awaiting_archive"
    assert month_of(world, crew)["record_sha256"] is None
    assert store.keys(prefix) == []
    status(crew.api.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/copy.pdf"), 409, "month_not_sealed")

    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, world.owner_email, world.owner_passcode)
        says(page, role(page, "status", "Archive status"), banner)
        open_voyage(page, base, world.vessel_id, crew.id, at(PAST_DAY, "00:00"), PAST_DAY)
        month_status = role(page, "status", "Month status")
        says(page, month_status, "Awaiting archive")
        says(page, role(page, "status", "Archive status"), banner)
        with archive_relay():
            month = poll(lambda: month_of(world, crew), lambda m: m["state"] == "sealed", "sealed month after return")
            poll(lambda: archive_state(world.owner), lambda s: s == "reachable", "reachable archive", ARCHIVE_STATUS_SECONDS)
            says(page, month_status, "Sealed", SERVER_DEADLINE)
            stops_saying(page, role(page, "status", "Archive status"), banner, SERVER_DEADLINE)
            payload = store.get(month["record_key"])
            assert hashlib.sha256(payload).hexdigest() == month["record_sha256"]
            link = new_link(world, PAST_DAY, PAST_DAY)
            status(Api(base).get(f"/api/inspect/{token_of(link)}/document"), 200)
    poll(lambda: archive_state(world.owner), lambda s: s == "unreachable", "unreachable archive again")
    status(crew.api.get(f"/api/crew/{crew.id}/months/{PAST_MONTH}/copy.pdf"), 503, "archive_unreachable")
    status(Api(base).get(f"/api/inspect/{token_of(link)}"), 200)
    status(Api(base).get(f"/api/inspect/{token_of(link)}/document"), 503, "archive_unreachable")
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, crew.email, crew.passcode)
        visit(page, f"{base}/log?date={PAST_DAY}")
        click(role(page, "link", "Download my copy"))
        says(page, role(page, "status", "Day status"), "The archive is unreachable, so this document cannot be fetched right now.")


def test_scoped_inspection_links(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world, dates=(PAST_DAY, PAST_DAY_NEXT))
    seal_and_wait(world)
    unsealed = add_crew(world.base, world.owner, world.vessel_id)
    log_spans(unsealed, PAST_DAY, GOOD_DAY)
    log_spans(crew, OLDER_MONTH_DAY, GOOD_DAY)
    other = status(world.owner.post("/api/vessels", {"name": "Other boat", "kind": "coaster", "initial_offset_minutes": 0}), 201)
    outsider = add_crew(world.base, world.owner, other["id"])
    vessel = f"/api/vessels/{world.vessel_id}"
    status(world.owner.post(f"{vessel}/fixes", {"at_utc": at(PAST_DAY_NEXT, "06:00"), "latitude": 1, "longitude": 2}), 201)
    status(world.owner.post(f"{vessel}/fixes", {"at_utc": at("2026-08-20", "06:00"), "latitude": 3, "longitude": 4}), 201)
    links = f"{vessel}/inspection-links"
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    future = iso(now + timedelta(hours=6))
    invalid(world.owner.post(links, {"from_date": PAST_DAY, "to_date": PAST_DAY, "expires_at_utc": iso(now - timedelta(hours=1))}))
    invalid(world.owner.post(links, {"from_date": PAST_DAY_NEXT, "to_date": PAST_DAY, "expires_at_utc": future}))
    status(crew.api.post(links, {"from_date": PAST_DAY, "to_date": PAST_DAY, "expires_at_utc": future}), 403, "forbidden")
    assert world.owner.ok(links)["links"] == []

    link = new_link(world, PAST_DAY_NEXT, shift_date(PAST_DAY_NEXT, 1), future)
    assert link["vessel_id"] == world.vessel_id and link["state"] == "active" and link["url"].startswith("/inspect/")
    token = token_of(link)
    inspector = Api(world.base)
    response = inspector.get(f"/api/inspect/{token}")
    body = status(response, 200)
    assert "no-store" in response.headers.get("cache-control", "")
    assert body["vessel"]["id"] == world.vessel_id
    assert outsider.name not in response.text
    shown = {c["id"]: [d["ship_date"] for d in c["days"]] for c in body["crew"]}
    assert PAST_DAY_NEXT in shown[crew.id] and PAST_DAY not in shown[crew.id]
    assert not shown.get(unsealed.id)
    assert {f["at_utc"] for f in body["fixes"]} == {at(PAST_DAY_NEXT, "06:00")}
    day = next(d for c in body["crew"] if c["id"] == crew.id for d in c["days"] if d["ship_date"] == PAST_DAY_NEXT)
    assert float(day["rest_hours"]) == 16 and day["signed_at_utc"] and day["countersigned_at_utc"] and day["cell_count"] == CELLS_PER_DAY

    status(inspector.get(f"/api/inspect/{token}?from={PAST_DAY}"), 403, "outside_scope")
    status(inspector.get(f"/api/inspect/{token}?to=2026-08-25"), 403, "outside_scope")
    status(inspector.get(f"/api/inspect/{JUNK}"), 404, "not_found")
    for garbled in GARBLED_IDS:
        refused_garbled(inspector.get(f"/api/inspect/{garbled}"))
    status(inspector.get("/api/vessels"), 401, "not_signed_in")
    status(inspector.get(f"/api/crew/{crew.id}/days/{PAST_DAY_NEXT}", headers={"Authorization": f"Bearer {token}"}), 401, "not_signed_in")

    older = new_link(world, OLDER_MONTH_DAY, OLDER_MONTH_DAY, future)
    older_body = inspector.ok(f"/api/inspect/{token_of(older)}")
    assert OLDER_MONTH_DAY in older_body["unsealed_dates"]
    assert not [d for c in older_body["crew"] for d in c["days"]]

    document = inspector.get(f"/api/inspect/{token}/document")
    status(document, 200)
    assert_pdf(document.content)
    assert f"inspections/{link['id']}/document.pdf" in S3().keys(f"inspections/{link['id']}/")


def test_wf_inspection_link_expired(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world)
    seal_and_wait(world)
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    expires = now + timedelta(seconds=4)
    link = new_link(world, PAST_DAY, PAST_DAY, iso(expires))
    token = token_of(link)
    inspector = Api(world.base)
    long_link = new_link(world, PAST_DAY, PAST_DAY, iso(now + timedelta(hours=6)))
    with open_app(browser, f"{world.base}/") as page:
        page.clock.set_fixed_time(now + timedelta(days=30))
        visit(page, f"{world.base}{long_link['url']}")
        see(page, role(page, "heading", "Inspection record"))
        says(page, role(page, "table", "Sealed days"), PAST_DAY)

    def still_usable() -> httpx.Response:
        response = inspector.get(f"/api/inspect/{token}")
        if response.status_code == 200:
            assert parse(response.json()["server_now_utc"]) < expires, "served at or after the expiry"
        return response

    expired = poll(still_usable, lambda r: r.status_code != 200, "expired link", UI_DEADLINE)
    status(expired, 410, "link_expired")
    assert "no-store" in expired.headers.get("cache-control", "")
    assert crew.name not in expired.text
    status(inspector.get(f"/api/inspect/{token}/document"), 410, "link_expired")
    state = {l["id"]: l["state"] for l in world.owner.ok(f"/api/vessels/{world.vessel_id}/inspection-links")["links"]}
    assert state[link["id"]] == "expired"
    status(world.owner.post(f"/api/inspection-links/{link['id']}/revoke"), 409, "link_ended")
    status(world.owner.post(f"/api/inspection-links/{link['id']}/regenerate"), 409, "link_ended")
    with open_app(browser, f"{world.base}/") as page:
        page.clock.set_fixed_time(now - timedelta(days=30))
        visit(page, f"{world.base}{link['url']}")
        see(page, role(page, "heading", "This inspection link has expired."))
        expect(role(page, "table", "Sealed days")).to_have_count(0)
        expect(page.locator("body")).not_to_contain_text(crew.name)


def test_revoke_replace_and_read_only(app_url: str) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world)
    seal_and_wait(world)
    inspector = Api(world.base)
    link = new_link(world, PAST_DAY, PAST_DAY)
    token = token_of(link)
    before = day_of(crew.api, crew.id, PAST_DAY)
    for method in ("POST", "PUT", "PATCH", "DELETE"):
        status(inspector.call(method, f"/api/inspect/{token}", {} if method != "DELETE" else None), 405, "read_only")
        status(inspector.call(method, f"/api/inspect/{token}/document", {} if method != "DELETE" else None), 405, "read_only")
    after = day_of(crew.api, crew.id, PAST_DAY)
    assert all(after[k] == before[k] for k in ("cells", "entries", "notes", "state", "rest_hours"))
    status(inspector.get(f"/api/inspect/{token}"), 200)

    status(crew.api.post(f"/api/inspection-links/{link['id']}/revoke"), 403, "forbidden")
    status(signed_in(world.base, BRAM).post(f"/api/inspection-links/{link['id']}/revoke"), 404, "not_found")
    status(inspector.get(f"/api/inspect/{token}"), 200)

    fresh = status(world.owner.post(f"/api/inspection-links/{link['id']}/regenerate"), 201)
    assert fresh["state"] == "active" and fresh["url"] != link["url"]
    assert (fresh["from_date"], fresh["to_date"], fresh["expires_at_utc"]) == (link["from_date"], link["to_date"], link["expires_at_utc"])
    status(inspector.get(f"/api/inspect/{token}"), 410, "link_revoked")
    status(inspector.get(f"/api/inspect/{token}/document"), 410, "link_revoked")
    status(inspector.get(f"/api/inspect/{token_of(fresh)}"), 200)
    status(world.owner.post(f"/api/inspection-links/{link['id']}/regenerate"), 409, "link_ended")

    revoked = status(world.owner.post(f"/api/inspection-links/{fresh['id']}/revoke"), 200)
    assert revoked["state"] == "revoked"
    gone_response = inspector.get(f"/api/inspect/{token_of(fresh)}")
    status(gone_response, 410, "link_revoked")
    assert crew.name not in gone_response.text
    status(world.owner.post(f"/api/inspection-links/{fresh['id']}/revoke"), 409, "link_ended")


def test_wf_inspection_link_happy(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    crew = ready_month(world)
    seal_and_wait(world)
    status(world.owner.post(f"/api/vessels/{world.vessel_id}/events", {"crew_id": crew.id, "kind": "drill", "start_utc": at(PAST_DAY, "12:00"), "end_utc": at(PAST_DAY, "13:00"), "description": "x"}), 409, "month_sealed")
    expires = iso(parse(world.owner.ok("/api/me")["server_now_utc"]) + timedelta(hours=6))
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        region = role(page, "region", "Inspection links")
        dialog = open_dialog(page, role(region, "button", "Share with an inspector"), "Share with an inspector")
        fill(role(dialog, "textbox", "From ship's date"), PAST_DAY)
        fill(role(dialog, "textbox", "To ship's date"), PAST_DAY)
        fill(role(dialog, "textbox", "Expires in UTC"), expires)
        click(role(dialog, "button", "Create link"))
        says(page, role(page, "status", "Feedback"), "Link created.")
        address_box = role(region, "textbox", "Link address")
        see(page, address_box)
        expect(address_box).not_to_be_editable()
        address = address_box.input_value()
        assert "/inspect/" in address
        url = address if address.startswith("http") else f"{world.base}{address}"
        link = world.owner.ok(f"/api/vessels/{world.vessel_id}/inspection-links")["links"][0]
        assert (link["from_date"], link["to_date"], link["expires_at_utc"]) == (PAST_DAY, PAST_DAY, expires)

        with open_app(browser, url) as inspector:
            see(inspector, role(inspector, "heading", "Inspection record"))
            says(inspector, role(inspector, "table", "Sealed days"), PAST_DAY)
            expect(role(inspector, "region", "Voyage events")).to_be_visible()
            expect(inspector.locator("body")).to_contain_text(crew.name)
            with inspector.expect_download() as download:
                click(role(inspector, "link", "Download inspection document"))
            assert_pdf(Path(download.value.path()).read_bytes())
            assert f"inspections/{link['id']}/document.pdf" in S3().keys(f"inspections/{link['id']}/")

            click(role(region, "button", "Revoke link"))
            says(page, role(page, "status", "Feedback"), "Link revoked.")
            gone(page, role(region, "button", "Revoke link"))
            gone(page, role(region, "button", "Replace link"))

            inspector.reload()
            see(inspector, role(inspector, "heading", "This inspection link has been revoked."))
            expect(role(inspector, "table", "Sealed days")).to_have_count(0)
            expect(inspector.locator("body")).not_to_contain_text(crew.name)
    status(Api(world.base).get(f"/api/inspect/{token_of(link)}"), 410, "link_revoked")


def link_dialog(page: Page, first: str, last: str, expires: str) -> Locator:
    dialog = open_dialog(page, role(role(page, "region", "Inspection links"), "button", "Share with an inspector"), "Share with an inspector")
    fill(role(dialog, "textbox", "From ship's date"), first)
    fill(role(dialog, "textbox", "To ship's date"), last)
    fill(role(dialog, "textbox", "Expires in UTC"), expires)
    click(role(dialog, "button", "Create link"))
    return dialog


def test_wf_inspection_link_past_expiry(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    path = f"/api/vessels/{world.vessel_id}/inspection-links"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = link_dialog(page, PAST_DAY, PAST_DAY, iso(floor_half_hour(now) - timedelta(hours=1)))
        held_with_error(page, dialog)
        assert world.owner.ok(path)["links"] == []
        fill(role(dialog, "textbox", "Expires in UTC"), iso(floor_half_hour(now) + timedelta(hours=6)))
        click(role(dialog, "button", "Create link"))
        says(page, role(page, "status", "Feedback"), "Link created.")
    assert len(world.owner.ok(path)["links"]) == 1


def test_wf_inspection_link_reversed_range(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    now = parse(world.owner.ok("/api/me")["server_now_utc"])
    path = f"/api/vessels/{world.vessel_id}/inspection-links"
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        dialog = link_dialog(page, PAST_DAY_NEXT, PAST_DAY, iso(floor_half_hour(now) + timedelta(hours=6)))
        held_with_error(page, dialog)
        assert world.owner.ok(path)["links"] == []
        fill(role(dialog, "textbox", "From ship's date"), PAST_DAY)
        fill(role(dialog, "textbox", "To ship's date"), PAST_DAY_NEXT)
        click(role(dialog, "button", "Create link"))
        says(page, role(page, "status", "Feedback"), "Link created.")
    link = world.owner.ok(path)["links"]
    assert len(link) == 1 and (link[0]["from_date"], link[0]["to_date"]) == (PAST_DAY, PAST_DAY_NEXT)


def test_wf_inspection_link_replace(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    link = new_link(world, OLDER_MONTH_DAY, OLDER_MONTH_DAY)
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        region = role(page, "region", "Inspection links")
        see(page, role(region, "button", "Replace link"))
        click(role(region, "button", "Replace link"))
        says(page, role(page, "status", "Feedback"), "Link replaced. The old link no longer opens.")
        listed = world.owner.ok(f"/api/vessels/{world.vessel_id}/inspection-links")["links"]
        active = next(l for l in listed if l["state"] == "active")
        assert active["url"] != link["url"]
        with open_app(browser, f"{world.base}{link['url']}") as inspector:
            see(inspector, role(inspector, "heading", "This inspection link has been revoked."))
            visit(inspector, f"{world.base}{active['url']}")
            see(inspector, role(inspector, "heading", "Inspection record"))
            see(inspector, inspector.get_by_text("Nothing is sealed in this date range."))
            visit(inspector, f"{world.base}/inspect/{JUNK}")
            see(inspector, role(inspector, "heading", "We couldn't find that inspection link."))

        status(world.owner.post(f"/api/inspection-links/{active['id']}/revoke"), 200)
        click(role(region, "button", "Revoke link").first)
        says(page, role(page, "status", "Feedback"), "This link no longer opens.")


def test_wf_voyage_review_layout_published(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    ailsa = signed_in(base, AILSA)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *AILSA)
        open_voyage(page, base, "vessel-surveyor", "crew-ines", SEED_STRIP)
        for size, shape in (
            (PHONE, "one"), ({"width": 767, "height": 1024}, "one"), (TABLET, "two"),
            ({"width": 1279, "height": 800}, "two"), (DESKTOP, "three"),
        ):
            page.set_viewport_size(size)
            voyage = role(page, "region", "Voyage")
            strip = strip_region(page)
            record = record_region(page)
            layout(page)
            order = page.evaluate(
                """() => {
                  const named = name => [...document.querySelectorAll('[role=region],section,[aria-label]')].find(e => e.getAttribute('aria-label') === name || (e.getAttribute('aria-labelledby') && document.getElementById(e.getAttribute('aria-labelledby'))?.textContent.trim() === name));
                  const [a, b, c] = ['Voyage', 'Watch strip', 'Record'].map(named);
                  return !!a && !!b && !!c && !!(a.compareDocumentPosition(b) & 4) && !!(b.compareDocumentPosition(c) & 4);
                }"""
            )
            assert order, f"pane order at {size}"
            v, s, r = voyage.bounding_box(), strip.bounding_box(), record.bounding_box()
            assert v and s and r
            width = size["width"]
            if shape == "one":
                assert v["y"] < s["y"] < r["y"] and v["y"] + v["height"] <= s["y"] + ALIGN_TOLERANCE_PX
                for box in (v, s, r):
                    assert box["width"] >= width * FULL_WIDTH_SHARE, (size, box)
            elif shape == "two":
                assert v["x"] + v["width"] <= s["x"] + ALIGN_TOLERANCE_PX, (size, v, s)
                assert abs(v["y"] - s["y"]) <= ALIGN_TOLERANCE_PX, (size, v, s)
                assert r["y"] >= max(v["y"] + v["height"], s["y"] + s["height"]) - ALIGN_TOLERANCE_PX, (size, r)
                assert r["width"] >= width * FULL_WIDTH_SHARE, (size, r)
            else:
                assert v["x"] + v["width"] <= s["x"] + ALIGN_TOLERANCE_PX and s["x"] + s["width"] <= r["x"] + ALIGN_TOLERANCE_PX, (size, v, s, r)
                assert abs(v["y"] - s["y"]) <= ALIGN_TOLERANCE_PX and abs(s["y"] - r["y"]) <= ALIGN_TOLERANCE_PX, (size, v, s, r)
            box = fold(page).bounding_box()
            assert box and box["x"] >= s["x"] - ALIGN_TOLERANCE_PX and box["x"] + box["width"] <= s["x"] + s["width"] + ALIGN_TOLERANCE_PX, "the strip left its pane"
            assert_fold_matches(page, ailsa, "crew-ines", SEED_STRIP, 0)

        for size in (PHONE, TABLET, DESKTOP):
            page.set_viewport_size(size)
            for path in ("/fleet", "/vessels/vessel-surveyor"):
                visit(page, f"{base}{path}")
                see(page, role(page, "button", "Sign out"))
                layout(page)
    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, *INES)
        for size, per_row in ((PHONE, 6), (TABLET, 12), (DESKTOP, 12)):
            page.set_viewport_size(size)
            see(page, role(page, "grid", "Watch grid"))
            layout(page)
            row = page.get_by_role("gridcell").evaluate_all("els => els.filter(e => Math.abs(e.getBoundingClientRect().top - els[0].getBoundingClientRect().top) < 2).length")
            assert row == per_row, size


def assert_dialog_contract(page: Page, opener: Locator, name: str) -> None:
    identify = """() => {
      const e = document.activeElement;
      window.__ids = window.__ids || new WeakMap();
      window.__next = window.__next || 1;
      if (!window.__ids.has(e)) window.__ids.set(e, window.__next++);
      return window.__ids.get(e);
    }"""
    dialog = open_dialog(page, opener, name)
    inside = "d => d.contains(document.activeElement)"
    eventually(page, lambda: expect(dialog).to_be_visible(timeout=QUICK_MS))

    def focus_inside() -> None:
        assert dialog.evaluate(inside), f"{name}: opening did not move focus inside"

    def focus_back() -> None:
        expect(opener).to_be_focused(timeout=QUICK_MS)

    eventually(page, focus_inside)
    for key in ("Tab", "Shift+Tab"):
        seen: list[int] = []
        wrapped = False
        for _ in range(CYCLE_LIMIT):
            page.keyboard.press(key)
            assert dialog.evaluate(inside), f"{name}: {key} left the dialog"
            current = page.evaluate(identify)
            if current in seen:
                wrapped = True
                break
            seen.append(current)
        assert wrapped and len(seen) >= 2, f"{name}: {key} did not wrap"
    page.keyboard.press("Escape")
    gone(page, dialog)
    eventually(page, focus_back)
    dialog = open_dialog(page, opener, name)
    click(role(dialog, "button", "Cancel"))
    gone(page, dialog)
    eventually(page, focus_back)


def test_wf_voyage_review_layout_dialogs(app_url: str, browser: Browser) -> None:
    world = make_world(app_url.rstrip("/"))
    log_spans(world.crew, PAST_DAY, GOOD_DAY)
    with open_app(browser, f"{world.base}/") as page:
        assert_dialog_contract(page, role(page, "button", "Create an owner account"), "Create an owner account")
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.owner_email, world.owner_passcode)
        visit(page, f"{world.base}/fleet")
        add_vessel = role(page, "button", "Add a vessel")
        see(page, add_vessel)
        assert_dialog_contract(page, add_vessel, "Add a vessel")
        visit(page, f"{world.base}/vessels/{world.vessel_id}")
        see(page, role(page, "heading", world.vessel_name))
        for name in ("Add crew", "Log clock change", "Add position fix", "Add watch", "Schedule rule set", "Log drill or call-out", "Share with an inspector"):
            assert_dialog_contract(page, role(page, "button", name), name)
        assert len(world.owner.ok(f"/api/vessels/{world.vessel_id}/crew")["crew"]) == 1
        assert world.owner.ok(f"/api/vessels/{world.vessel_id}/clock-changes")["clock_changes"] == []

        visit(page, f"{world.base}/fleet")
        dialog = open_dialog(page, role(page, "button", "Add a vessel"), "Add a vessel")
        fill(role(dialog, "textbox", "Vessel name"), ENTER_KEY_VESSEL)
        pick(role(dialog, "combobox", "Vessel type"), "workboat")
        fill(role(dialog, "textbox", "Starting offset in minutes"), "0")
        role(dialog, "textbox", "Starting offset in minutes").press("Enter")
        says(page, role(page, "status", "Feedback"), "Vessel saved.")
    assert ENTER_KEY_VESSEL in [v["name"] for v in world.owner.ok("/api/vessels")["vessels"]]
    with open_app(browser, f"{world.base}/") as page:
        sign_in(page, world.base, world.crew.email, world.crew.passcode)
        visit(page, f"{world.base}/log?date={PAST_DAY}")
        see(page, role(page, "button", "Sign this day"))
        assert_dialog_contract(page, role(page, "button", "Sign this day"), "Sign this day")
        assert_dialog_contract(page, role(page, "button", "Add a note"), "Add a note")
    day = day_of(world.crew.api, world.crew.id, PAST_DAY)
    assert day["state"] == "closed" and day["notes"] == []


def test_wf_cross_cutting_copy(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    world = make_world(base)
    crew = world.crew
    log_spans(crew, PAST_DAY, THREE_PERIOD_DAY)
    log_spans(crew, OLDER_MONTH_DAY, [["00:00", "04:00", "work"]])
    with open_app(browser, f"{base}/") as page:
        feedback = role(page, "status", "Feedback")
        fill(role(page, "textbox", "Email"), world.owner_email)
        fill(role(page, "textbox", "Passcode"), world.owner_passcode + "x")
        bypass_worker(page)
        with held(page, "**/api/session") as release:
            click(role(page, "button", "Sign in"))
            says(page, feedback, "Signing in.")
            release()
        says(page, feedback, "That email and passcode do not match.")
        response = page.goto(f"{base}/no-such-page")
        assert response and response.status == 404
        see(page, role(page, "heading", "We couldn't find that page."))

    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, world.owner_email, world.owner_passcode)
        feedback = role(page, "status", "Feedback")
        open_voyage(page, base, world.vessel_id, crew.id, at(PAST_DAY, "00:00"), PAST_DAY)
        record = record_region(page)
        says(page, record, f"Ship's day {PAST_DAY}, in month {PAST_MONTH}.")
        says(page, record, "Rest was split into more than 2 periods in this 24-hour window.")
        says(page, role(record, "status", "Day status"), "Closed")
        says(page, record, "This ship's day has closed.")
        click(role(record, "button", "Countersign this day"))
        says(page, role(record, "status", "Day status"), "The crew member has not signed this day yet.")
        click(role(record, "button", "Seal this month"))
        says(page, role(record, "status", "Month status"), "Every logged day must be signed and countersigned first.")

        slider(page).focus()
        page.keyboard.press("ArrowRight")
        says(page, record, f"Ship's day {PAST_DAY_NEXT}, in month {PAST_MONTH}.")
        open_voyage(page, base, world.vessel_id, crew.id, at(OLDER_MONTH_DAY, "00:00"), "2026-13-45")
        server = window_of(world.owner, crew.id, at(OLDER_MONTH_DAY, "00:00"))
        says(page, record_region(page), f"Ship's day {OLDER_MONTH_DAY}, in month {OLDER_MONTH_DAY[:7]}.")
        advance(page, VERDICT_STILL_MS)
        says(page, role(page, "status", "Window verdict"), f"{server['start_ship_time']} to {server['end_ship_time']}: 0.0 hours of rest. This window is not fully logged yet.")

        visit(page, f"{base}/fleet")
        dialog = open_dialog(page, role(page, "button", "Add a vessel"), "Add a vessel")
        fill(role(dialog, "textbox", "Vessel name"), "Pending boat")
        pick(role(dialog, "combobox", "Vessel type"), "coaster")
        fill(role(dialog, "textbox", "Starting offset in minutes"), "0")
        bypass_worker(page)
        with held(page, "**/api/vessels") as release:
            click(role(dialog, "button", "Save vessel"))
            says(page, feedback, "Saving vessel.")
            release()
        says(page, feedback, "Vessel saved.")
        for index in range(2):
            status(world.owner.post("/api/vessels", {"name": f"Filler {index}", "kind": "coaster", "initial_offset_minutes": 0}), 201)
        visit(page, f"{base}/fleet")
        feedback = role(page, "status", "Feedback")
        dialog = open_dialog(page, role(page, "button", "Add a vessel"), "Add a vessel")
        fill(role(dialog, "textbox", "Vessel name"), "Fifth boat")
        pick(role(dialog, "combobox", "Vessel type"), "coaster")
        fill(role(dialog, "textbox", "Starting offset in minutes"), "0")
        click(role(dialog, "button", "Save vessel"))
        says(page, feedback, "You already run four vessels.")

        visit(page, f"{base}/vessels/{world.vessel_id}")
        feedback = role(page, "status", "Feedback")
        bypass_worker(page)
        page.route("**/fixes", lambda route: route.abort() if route.request.method == "POST" else route.continue_())
        dialog = open_dialog(page, role(page, "button", "Add position fix"), "Add position fix")
        fill(role(dialog, "textbox", "Fix time in UTC"), at(PAST_DAY, "06:00"))
        fill(role(dialog, "textbox", "Latitude"), "1")
        fill(role(dialog, "textbox", "Longitude"), "2")
        click(role(dialog, "button", "Save fix"))
        says(page, feedback, "Something went wrong. Try again.")
    assert world.owner.ok(f"/api/vessels/{world.vessel_id}/fixes")["fixes"] == []

    with open_app(browser, f"{base}/") as page:
        sign_in(page, base, crew.email, crew.passcode)
        day_status = role(page, "status", "Day status")
        says(page, day_status, "Open")
        dialog = open_dialog(page, role(page, "button", "Sign this day"), "Sign this day")
        click(role(dialog, "button", "Confirm signature"))
        says(page, day_status, "This ship's day is still open, so it cannot be signed yet.")


def test_wf_cross_cutting_boundary(app_url: str, browser: Browser) -> None:
    base = app_url.rstrip("/")
    for instance in (base, archive_down_url(), short_close_url()):
        health = httpx.get(f"{instance}/api/health", timeout=HTTP_TIMEOUT)
        assert health.status_code == 200 and health.json() == {"status": "ok"}
    assert CORS_HEADER not in httpx.get(f"{base}/api/health", headers={"Origin": "http://elsewhere.example"}, timeout=HTTP_TIMEOUT).headers

    name, email, passcode = identity("owner")
    anonymous = Api(base)
    foreign = anonymous.post("/api/owners", {"name": name, "email": email, "passcode": passcode}, headers={"Origin": "http://elsewhere.example"})
    status(foreign, 403, "cross_origin")
    assert CORS_HEADER not in foreign.headers
    status(Api(base).post("/api/session", {"email": email, "passcode": passcode}), 401, "bad_credentials")
    host = urlparse(base).netloc
    matching = Api(base).post("/api/owners", {"name": name, "email": email, "passcode": passcode}, headers={"Origin": f"http://{host}"})
    status(matching, 201)
    cookie = " ; ".join(matching.headers.get_list("set-cookie")).lower()
    assert COOKIE_HTTP_ONLY in cookie and COOKIE_SAME_SITE in cookie and COOKIE_SAME_SITE_NONE not in cookie
    assert passcode not in json.dumps([row for table in Postgres().tables() for row in Postgres().rows("SELECT * FROM " + ".".join(f'"{part}"' for part in table.split(".")))], default=str), "a passcode is stored in the clear"

    def sized(total: int) -> bytes:
        shell = json.dumps({"email": "a@sixbell.example", "passcode": "x", "pad": ""}).encode()
        return shell[:-2] + b"x" * (total - len(shell)) + shell[-2:]

    json_type = {"Content-Type": "application/json"}
    allowed = httpx.post(f"{base}/api/session", content=sized(MAX_BODY), headers=json_type, timeout=HTTP_TIMEOUT)
    assert allowed.status_code == 401, allowed.status_code
    status(httpx.post(f"{base}/api/session", content=sized(MAX_BODY + 1), headers=json_type, timeout=HTTP_TIMEOUT), 413, "payload_too_large")
    status(httpx.post(f"{base}/api/vessels", content=sized(MAX_BODY + 1), headers=json_type, timeout=HTTP_TIMEOUT), 413, "payload_too_large")
    status(httpx.post(f"{base}/api/session", content=b"email=a", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT), 415, "unsupported_media_type")
    status(httpx.post(f"{base}/api/vessels", content=b"x", headers={"Content-Type": "text/plain"}, timeout=HTTP_TIMEOUT), 415, "unsupported_media_type")

    for path in ("/.env", "/run.json", "/package.json", "/package-lock.json", "/tsconfig.json"):
        assert httpx.get(f"{base}{path}", timeout=HTTP_TIMEOUT).status_code == 404, path
    status(httpx.get(f"{base}/api/{JUNK}", timeout=HTTP_TIMEOUT), 404, "not_found")
    assert httpx.get(f"{base}/api/{JUNK}", timeout=HTTP_TIMEOUT).json()["message"]

    secrets = [os.environ[k] for k in ("S3_SECRET_ACCESS_KEY", "DATABASE_URL") if os.environ.get(k)]
    bodies: list[str] = []
    with open_app(browser, f"{base}/") as page:
        page.on("response", lambda r: bodies.append(r.url))
        sign_in(page, base, *AILSA)
        html = page.content()
        assets = [u for u in bodies if u.startswith(base) and "/api/" not in u]
    for url in assets:
        served = httpx.get(url, timeout=HTTP_TIMEOUT).text
        assert not [s for s in secrets if s in served], f"{url} serves a credential"
    assert not [s for s in secrets if s in html]


SKIPPED_DIRS = {"node_modules", "dist", "build", ".git", "coverage", "public", ".next", "out"}


def source_files() -> Iterator[Path]:
    for path in APP.rglob("*"):
        if path.is_file() and not SKIPPED_DIRS & set(path.relative_to(APP).parts):
            yield path


def shipped_packages() -> list[dict[str, Any]]:
    root = APP if (APP / "node_modules").is_dir() else Path(DEPLOYED_APP)
    done = subprocess.run(["npm", "ls", "--omit=dev", "--all", "--json", "--long"], cwd=root, capture_output=True, text=True, timeout=SERVER_DEADLINE)
    found: dict[str, dict[str, Any]] = {}

    def walk(node: dict[str, Any]) -> None:
        for name, child in (node.get("dependencies") or {}).items():
            if child.get("version"):
                found[f"{name}@{child['version']}"] = {"name": name, **child}
                walk(child)

    walk(json.loads(done.stdout))
    return list(found.values())


def test_if_run_manifest() -> None:
    manifest = json.loads((APP / "run.json").read_text())
    assert manifest["_schema"] == "run-manifest-v1"
    for key in ("install", "build", "serve"):
        assert isinstance(manifest[key], str) and manifest[key].strip()


def test_if_typescript_source() -> None:
    files = list(source_files())
    assert [p for p in files if p.suffix in (".ts", ".tsx")], "no TypeScript source"

    def tooling(p: Path) -> bool:
        return ".config." in p.name or (p.parent == APP and re.search(r"\b(build|config)\b", p.stem) is not None)

    script = [p for p in files if p.suffix in (".js", ".jsx", ".mjs", ".cjs") and not tooling(p)]
    assert not script, script


def test_if_third_party_notices() -> None:
    notices = (APP / "THIRD_PARTY_NOTICES.md").read_text()
    missing = [p["name"] for p in shipped_packages() if p["name"] not in notices]
    assert not missing, missing
    assert "Spectral" in notices and "IBM Plex Sans" in notices


def test_if_licences() -> None:
    allowed = {"MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "ISC", "OFL-1.1"}

    def acceptable(raw: Any) -> bool:
        text = raw.get("type", "") if isinstance(raw, dict) else str(raw or "")
        tokens = re.findall(r"[A-Za-z0-9.\-]+", text.replace(" OR ", " | ").replace(" AND ", " & "))
        if " AND " in text:
            return all(t in allowed for t in tokens)
        return any(t in allowed for t in tokens)

    refused = [(p["name"], p.get("license")) for p in shipped_packages() if not acceptable(p.get("license"))]
    assert not refused, refused


def test_if_no_other_datastore() -> None:
    banned = {"sqlite3", "better-sqlite3", "redis", "ioredis", "lowdb", "nedb"}
    assert not [p["name"] for p in shipped_packages() if p["name"] in banned]
    assert not [p for p in source_files() if p.suffix in (".sqlite", ".sqlite3", ".db", ".rdb")]


def test_if_no_committed_credentials() -> None:
    values = [os.environ.get("S3_SECRET_ACCESS_KEY", ""), urlparse(os.environ.get("DATABASE_URL", "")).password or ""]
    secrets = [v for v in values if len(v) >= 12]
    hits = []
    for path in source_files():
        if path.suffix in (".ts", ".tsx", ".json", ".md", ".env", ".yaml", ".yml", ".sh") or path.name.startswith(".env"):
            text = path.read_text(errors="ignore")
            hits.extend(str(path) for s in secrets if s in text)
    assert not hits, hits
